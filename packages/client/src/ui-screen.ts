/*
 * 整屏 UI 的登记契约
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么有这一层：`main.ts` 是唯一同时握有 `stageCtx` / `state` / `dispatch`
 *   的地方，但它是四千多行的一个文件。若每一屏都往里面塞自己的绘制与命中，
 *   两屏同时改这个文件必然互相踩。
 *
 *   所以这里定一份**契约**：每一屏是 `src/` 下一个**自己的文件**，导出一个
 *   `UiScreen`，登记在 `screens.ts`。`main.ts` 只在三处按契约走一遍登记表 ——
 *   画、鼠标、每帧 —— 一屏一行的改动都不需要再动 `main.ts`。
 *
 * ⚠️ 这一层**不含任何规则**（C-ARC-2）：它只是把「谁在接管画面」这件事
 *   从 main.ts 里摘出来。规则永远在 `@rich4/core`。
 *
 * ## 一屏的生命周期（顺序即优先级）
 *
 * ```
 * 每帧：  tick(env)       ← 所有登记的屏都收，用来**察觉**状态变化 / 推进动画
 * 状态变：event(before, after, env)
 * 画：    active(env) 为真的**第一屏** draw(env)，其余不画，棋盘也不画
 *        （`windowed: true` 的屏例外：先照常画一整帧棋盘，再叠这扇浮窗）
 * 鼠标：  同一屏的 move / down / up，坐标是**舞台坐标**（0..639 × 0..479）
 * 右键：  声明了 `contextmenu` 的屏收 `WM_RBUTTONUP` 那一拍（浏览器里是 contextmenu）
 * 工具列：toolbar(i, env) 返回 true 表示这颗钮归本屏
 * 熱鍵：  hotkey(fn, env) 返回 true 表示已处理（fn 见 hotkeys.ts 的 HOTKEY）
 * ```
 *
 * ## 写一屏的规矩（与 docs/handoff.md 的铁律同源）
 *
 * 1. **位置一律从 exe 抄**，不许照截图量。工具：`python3 tools/disasm.py`。
 *    每个常量和判据都要带 `@source VA`。
 * 2. **不许改良**：原版没有的东西不要加。
 * 3. 纯函数（版式 / 命中 / 帧序）放模块顶层并导出，`draw()` 只做 IO —— 这样
 *    单测不需要 canvas。
 * 4. 解不出的写进 `docs/known-deviations.md`，不静默。
 */

import type { Action, GameState, MapTopology, Rich4Map } from '@rich4/core';
import type { LoadedFlic, Sprite } from './assets.ts';

/** 交给每一屏的环境 —— 只读的现状 + 三个副作用出口 */
export interface UiScreenEnv {
  /** 当前主屏（`title` / `game` / `stock` …），见 main.ts 的 `Screen` */
  readonly screen: string;
  readonly state: GameState;
  readonly topo: MapTopology;
  readonly map: Rich4Map;
  /** `performance.now()`，一帧内同一个值 */
  readonly now: number;
  /** 整块 640×480 的舞台画布（`stageCtx`）—— 整屏的东西直接画在这上面 */
  readonly stage: CanvasRenderingContext2D;
  /**
   * 遊戲設定的「動畫過程」开着没有（`RICH4.CFG+1` bit0，见 `options.ts` 的 `animation`）。
   *
   * ★ 2026-09-16 加：原版有几屏**只在动画开着时**才播那一段定时器演出 ——
   *   拍賣（`SetTimer(hwnd, …, 0x64, 0)` @source 0x0043a365）、轉盤
   *   （`rich4.asm:19975` 那处闸）、小游戏入场 FLIC（`rich4_small_games.asm:4230-4233`）。
   *   关掉时应当**直接落结果**、不走那个状态机。先前 `UiScreenEnv` 没有这个出口，
   *   那几屏只好恒按「开」处理（见 T-034 的 D-T034-2）。
   *
   * ⚠️ 可省略：不填按 **`true`**（= 恒开）算 —— 与加这个出口之前的行为一致，
   *   于是既有的测试替身不必逐个补字段。
   */
  readonly animation?: boolean;
  /** 按需取图（就是 main.ts 的 `spriteNow`，带 LRU 与 hd 回退） */
  sprite(archive: string, resource: number, index: number, colorKeyBlack?: boolean): Sprite | null;
  /**
   * 按需取一段 **FLIC / ANM 影片**（樂透的跑馬燈 `Panel#14`、摇球 `#16`、
   * 礼花 `#17` 都是这一类）。
   *
   * ⚠️ **异步**：第一次问一定返回 `null`（在后台解），解完 main.ts 会自己重画一帧，
   *   所以屏只要在 `draw` 里照常问一次就行，**别缓存 `null`**。
   */
  flic(archive: string, resource: number): LoadedFlic | null;
  dispatch(action: Action): void;
  requestRender(): void;
  log(message: string): void;
  /**
   * 放一个音效（`Effect.mkf` 的资源号）。
   *
   * @param loop 循环播（原版 `_rich4_play_sound_effect(flags=1, …)` 的
   *   `DSBPLAY_LOOPING`）。默认一次性。循环的那一路要自己用 `stopEffect` 收，
   *   否则会一直响到关屏（旅館/購物中心转盘 52 号就属于这一种）。
   */
  playEffect(id: number, loop?: boolean): void;
  /**
   * 停掉某一路循环音（原版 `fcn_004542e9` = `IDirectSoundBuffer::Stop`）。
   *
   * ★ 与 `playEffect` 一样是**必须实现**的出口：`main.ts` 的 `uiEnv()` 里
   *   `(id) => sound.stop('Effect.mkf', id)`。
   */
  stopEffect(id: number): void;
  /**
   * 放一段**背景音乐**（按屏取曲）。
   *
   * @param file 磁盘文件名（小写，如 `'midi10.mid'`）—— 由
   *   `@rich4/assets-pipeline` 的 `bgmAssetFileFor(id)` 给出。
   *
   * ★ 对应原版 `fcn_004549cf(id)`（VA 0x004549cf）：`id` 查 13 项文件名表
   *   `0x47e793` → `MIDI{id+1}.MID`，再 `MCI "open sequencer!%s alias mid"`。
   *   曲号与场景的对应见 `SCREEN_BGM`（22 处调用点逐处读出）。
   *   ⚠️ 原版那句有闸门：`cmp byte [0x49715a], 0 / je 直接返回`（配置里关了配乐）；
   *   本引擎的开关在宿主侧（`main.ts` 的音乐开关），屏这边只管**请求**放哪一首。
   */
  music?(file: string): void;
}

/**
 * 交给 `UiScreen.key` 的一次按键 —— **与 DOM 无关**，便于单测。
 *
 * ⚠️ 原版那几处等待**只看消息号**（`0x101` 就跳过），不看是哪个键；
 *   所以多数屏只要「有键按下」这一件事。`vk` / 修饰键留着给将来
 *   真正按键分派的屏（例如填数窗那种按 `0x30..0x39` 的）。
 */
export interface UiKeyEvent {
  /** Windows 虚拟键码（`hotkeys.ts` 的 `vkOf` 会给）；认不出来时为 `null` */
  readonly vk: number | null;
  /** DOM 的 `KeyboardEvent.code`（`'Enter'` / `'KeyQ'` …）；只用于日志与测试 */
  readonly code: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface UiScreen {
  /** 稳定标识，只用于日志与调试（如 `notice-board`）*/
  readonly id: string;

  /**
   * **浮窗**（原版只是把被盖住的那块盖上去的那种）：`draw` 之前先照常画一整帧
   * 棋盘 —— 周围的棋盘 / 工具栏 / 侧栏照旧露着，不是整屏黑底。
   *
   * ★ 大地圖彈窗就是这样（`fcn_0040a801` 只 Blt `RECT(20,60,420,460)`，
   *   实机截图 S6 里右侧栏照样显示「資金」页）；道具欄 / 設定 / 存讀檔那几扇
   * 浮窗走的是 `main.ts` 的历史那条路，不在此表。
   *   不给（或 false）= 整屏接管：除了本屏什么都不画。
   */
  readonly windowed?: boolean;

  /**
   * 本屏此刻要不要**接管整屏**。
   *
   * ⚠️ 必须是**纯查询**：会被高频调用（每次鼠标事件、每帧）。
   *   要开／关本屏请改本模块自己的开关变量，别在 `active` 里改。
   */
  active(env: UiScreenEnv): boolean;

  /** 画整屏（`windowed` 的屏则是画那一扇浮窗）。只在 `active` 为真时调用 */
  draw(env: UiScreenEnv): void;

  /** 鼠标移动（舞台坐标）—— 要重画就自己 `env.requestRender()` */
  move?(x: number, y: number, env: UiScreenEnv): void;
  /** 鼠标按下（原版 `WM_LBUTTONDOWN`）*/
  down?(x: number, y: number, env: UiScreenEnv): void;
  /** 鼠标抬起（原版 `WM_LBUTTONUP`）*/
  up?(x: number, y: number, env: UiScreenEnv): void;

  /**
   * 右键（原版 `WM_RBUTTONUP`，浏览器里就是 `contextmenu` 那一拍）。
   *
   * ★ **声明了它**的屏会在 `main.ts` 那条 `contextmenu` 处理**最前面**收到这一拍，
   *   之后的棋盘/工具栏分支一概不走 —— 这就是各屏「右键关掉最上面那扇窗」的落点。
   *   没声明的屏不受影响（照旧落到下面那些分支）。
   */
  contextmenu?(x: number, y: number, env: UiScreenEnv): void;

  /**
   * 键盘按下（原版 `WM_KEYDOWN` = **0x101**）。
   *
   * ★ 为什么要有这个出口：原版那一族**可跳过的等待**（`fcn_004544f6` /
   *   `fcn_004528b9` / `fcn_0045144f` / 转盘的 `fcn_0043f5xx` / 頒獎屏的
   *   `fcn_00437e61`）在自己的 `PeekMessage` 循环里认**三种**消息：
   *   `0x202`（左键抬起）、`0x205`（右键抬起）、**`0x101`（按键）** ——
   *   三者一律置「跳过」标志。本引擎的 `up` / `contextmenu` 已覆盖前两种，
   *   但 `hotkey` 出口只送**映射过的那 28 个功能**，收不到「任意键」。
   *
   * @param key 这次按下的键（DOM 自由的形状，便于单测）
   * @returns `true` = 本屏已消费（`main.ts` 会 `preventDefault` 并停下）
   *
   * ⚠️ 声明了它的屏会在 keydown 处理里**排在填数窗/ATM/熱鍵之前**收到这一拍 ——
   *   与「这些都是模态窗口、`WM_KEYDOWN` 先到它手里」一致。
   */
  key?(key: UiKeyEvent, env: UiScreenEnv): boolean;

  /**
   * 每帧一次（**所有**登记的屏都收，不只是 active 的）。
   *
   * 两件事：① 推进自己的动画并调 `env.requestRender()` 续帧；
   * ② 察觉刚刚发生的状态变化（想干净一点就用下面的 `event`）。
   */
  tick?(env: UiScreenEnv): void;

  /** 一次 action 让状态变了 —— 演出类屏幕（開獎 / 月結 / 魔法屋）靠它起播 */
  event?(before: GameState, after: GameState, env: UiScreenEnv): void;

  /** 工具列第 `index` 颗钮被点了；返回 true 表示这颗归本屏 */
  toolbar?(index: number, env: UiScreenEnv): boolean;

  /** 熱鍵 `fn`（`HOTKEY.*` 的值）被按了；返回 true 表示已处理 */
  hotkey?(fn: number, env: UiScreenEnv): boolean;
}
