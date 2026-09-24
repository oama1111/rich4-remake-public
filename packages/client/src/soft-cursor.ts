/*
 * 软件指针 —— 原版的鼠标指针是**自己画的**，本模块照那一套来（gap-audit WP-1：#5 #8 #9 #10）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 原版那一套（全部读自 rich4.exe）
 *
 * | 是什么 | @source |
 * |---|---|
 * | 开局：`read_mkf(Data.mkf, 0)` → `[0x46cb10]`（指针图集）、`ShowCursor(0)` 藏掉系统指针 | 0x00402108..0x0040211a、0x00402154 |
 * | 动画节拍：`timeSetEvent(0x14, 5, 0x401f98, 0, 1)` —— **每 20 ms 一拍** | 0x00402198..0x004021a5 |
 * | 默认形状：`fcn_004021f8(0x29, …, 0)` —— 图 **0x29**（箭头，锚点 (1,1)）| 0x004017a6 |
 * | **换形状** `fcn_004021f8(图, 帧数, 每帧几拍)`：`[0x48a0f4] = 图集 + 0xc + 图×12`、帧数 → `[0x48a170]`、拍数 → `[0x48a174]`，**帧号 `[0x48a172]` 与拍计数 `[0x48a176]` 清 0** | 0x004021f8..0x00402234 |
 * | **显示 / 藏起** `fcn_00402460(1/0)`：写 `[0x48a178]`，当场画 / 擦（`0x402250` / `0x40235d`）| 0x00402460..0x004024a0 |
 * | 取「此刻显示没有」`fcn_004024a1`（模态窗进门先存、出门还原）| 0x004024a1 |
 * | 热点 = **贴图自带的锚点**：画在 `(光标 x − [帧表项+4], 光标 y − [帧表项+6])` | 0x004022ac..0x004022bf、0x004024ea |
 * | 拍回调：只在**画着**时走（`test [0x48a179],1`）；`++拍 >= 每帧几拍` ⇒ 拍清 0、`++帧`，`帧 == 帧数` 回 0 | 0x00401fdd、0x00402015..0x0040205a |
 *
 * 显示 / 藏起的时机（`fcn_00402460` 全 exe 143 处调用，逐一归到了各窗口）：
 *
 * - 按 GO（鼠标 0x004182de、热键 0x00401271）就**藏起**；走子、落点、影片、訊息框
 *   （`fcn_00440ba8` 进门 0x00440cc4 先藏、出门 0x00440e09 还原）一路都不画。
 * - 轮到本机真人、GO 鈕上场（0x00417e1c / 0x00418db9，与 `SetCursorPos` 同一拍）才**放出来**。
 * - 每一扇**要人作答**的窗口在 `WM_CREATE` 里放出来：YES/NO 0x00453722、填数窗 0x00452cbb、
 *   公佈欄各层 0x00425af1..0x004283ab、商店 0x0042dc08、樂透 0x0042f91c、魔法屋 0x00432a18、
 *   銀行 0x0043479a / 0x004356db / 0x00435e98、ATM 0x004370c4 / 0x00437157、拍賣 0x0043b093、
 *   監獄/醫院 0x0043cb5a / 0x0043daf0、設施类别 0x0043fb5d、嫁禍 0x0043ffcb、研究所 0x0044035e、
 *   搶奪 0x00441461 / 0x00441752、道具/卡片欄 0x00445c76、选目标 0x00445f3b、遥控骰子 0x004467e7、
 *   說明 0x0044e53c、大地圖 0x0040a837、資產表 0x00423dad、股市 0x0042a9e0、设定 0x00410491…
 * - **演出类**的窗口一处都不调：分紅屏、開獎屏、月結屏、新聞/命運框、轉盤、神明老虎机
 *   （它们的地址段里没有 `call 0x402460`）⇒ 从按 GO 起一直藏着。
 *
 * 各屏换的形状（`fcn_004021f8` 全 exe 25 处）：
 *
 * | 屏 | 形状 | @source |
 * |---|---|---|
 * | 默认 / 各屏关窗换回 | 图 0x29 箭头 | 0x004017a6、0x0042fb08、0x0043776c… |
 * | 樂透投注 | 图 **0x1c**（铅笔）| 0x0042f912（关屏 0x0042fb08 换回）|
 * | ATM | 图 **0x1b**（手指）| 0x004370ba / 0x0043714d |
 * | 通用填数窗 `fcn_00453544` | 图 **0x1b** | 0x00452cb1（关窗 0x00453135 换回）|
 * | 紅卡 / 黑卡选股（真人走股市屏）| 图 **12 起 15 帧、每帧 10 拍**（翻转的卡片）| 0x00444ff0 / 0x004450b4 |
 * | 选目标 | 见 `picking.ts` 的 `pickCursorSpec` | 0x004465dd / 0x00446606 / 0x00446185 |
 * | 七彩氣球 | 图 9 起 3 帧、每帧 5 拍 | 0x00414d8b |
 * | 企鵝挖寶 | 图 0x2a | 0x00414a95 |
 * | 財神接金幣 | ——（整屏**从不** `fcn_00402460(1)`，指针一直藏着）| 0x004155fc 整段 |
 *
 * ## 本引擎怎么做
 *
 * 原版是命令式的（谁开窗谁换、谁关窗谁还原）；本引擎的屏是**按状态画**的，所以反过来：
 * 每一帧由 `resolveCursor` 按「此刻谁在接管、要不要本机作答」**算出**要哪一支指针（或藏起），
 * `CursorClock` 负责原版那两条副作用语义（换形状清帧号、只在画着时走拍）。
 * 画在一块**盖在画布上的透明画布**上（`createSoftCursorLayer`），不进舞台 —— 鼠标一动只重画
 * 这块小东西，不用整屏重绘；放大倍数与舞台同一个（原版指针也是 640×480 屏上的 32×32 点阵）。
 *
 * ★ **仅本机**：指针不进 `GameState`、不上线。联机旁观（别人的回合）不作答 ⇒ 藏起，
 *   别人那几屏的专用指针（樂透铅笔、ATM 手指…）旁观端一概不换。
 * ★ **触屏**没有指针：只有鼠标（`pointerType === 'mouse'`）才画；唯一的例外是
 *   七彩氣球 / 企鵝挖寶的准星 / 靶圈（`CursorRequest.touch`），它跟着手指走。
 */

import { isAiTurn } from '@rich4/core';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

/** 指针图集 @source 0x00402108..0x0040211a `read_mkf([0x48a0e4] = Data.mkf, 0)` */
export const CURSOR_ARCHIVE = 'Data.mkf' as const;
export const CURSOR_RESOURCE = 0;

/** 动画一拍多少毫秒 @source 0x004021a3 `push 0x14`（`timeSetEvent` 的 uDelay）*/
export const CURSOR_TICK_MS = 20;

/** 一支指针 = `fcn_004021f8` 的三个实参 */
export interface CursorShape {
  /** 起始图号（`Data.mkf` #0）*/
  readonly image: number;
  /** 帧数（`[0x48a170]`；≤ 1 = 不动）*/
  readonly frames: number;
  /** 每帧几拍（`[0x48a174]`；一拍 20 ms）*/
  readonly ticks: number;
}

/** 照 `fcn_004021f8(图, 帧数, 每帧几拍)` 的实参顺序造一支指针 */
export function cursorShape(image: number, frames = 1, ticks = 0): CursorShape {
  return { image, frames, ticks };
}

/** 默认箭头 @source 0x004017a6 `push 0x29`；各屏关窗换回也是它（0x0042fb08 / 0x0043776c / 0x00453135 …）*/
export const ARROW_CURSOR = cursorShape(0x29);
/** ATM 与通用填数窗的「手指」@source 0x004370ba / 0x0043714d / 0x00452cb1 `push 0x1b` */
export const HAND_CURSOR = cursorShape(0x1b);
/** 樂透投注的「铅笔」@source 0x0042f90c `push 0` / `push 1` / `push 0x1c` / 0x0042f912 call */
export const LOTTERY_CURSOR = cursorShape(0x1c);
/**
 * 翻转的卡片（图 12..26）@source 紅卡 0x00444fea `push 0xa` / `push 0xf` / `push 0xc` / 0x00444ff0 call；
 * 黑卡 0x004450ae..0x004450b4 同一组数。选目标的卡片指针也是它（`pickCursorSpec(0xe0c….)`）。
 */
export const CARD_CURSOR = cursorShape(0xc, 0xf, 0xa);

/** 一次请求：要哪一支、触屏上画不画（默认不画）*/
export interface CursorRequest {
  readonly shape: CursorShape;
  /** ★ 触屏上也画（跟着手指走）—— 只有小游戏的准星 / 靶圈这么要 */
  readonly touch?: boolean;
}

/** 此刻要的指针；`null` = 藏起（`fcn_00402460(0)`）*/
export type CursorWant = CursorRequest | null;

/** 把一支形状包成「显示」请求 */
export function showCursor(shape: CursorShape, touch = false): CursorRequest {
  return touch ? { shape, touch: true } : { shape };
}

export function sameShape(a: CursorShape, b: CursorShape): boolean {
  return a.image === b.image && a.frames === b.frames && a.ticks === b.ticks;
}

/**
 * 画着过了 `shownMs` 毫秒，此刻该画第几张图 —— 纯函数。
 * @source 拍回调 0x00402015..0x0040205a：`++拍 >= 每帧几拍` ⇒ 拍清 0、`++帧`，`帧 == 帧数` 回 0；
 *   `帧数 <= 1`（0x0040200b `cmp word [0x48a170], 1 / jle`）就不走。
 */
export function cursorImageAt(shape: CursorShape, shownMs: number): number {
  if (shape.frames <= 1 || shape.ticks <= 0) return shape.image;
  const beats = Math.max(0, Math.floor(shownMs / CURSOR_TICK_MS));
  return shape.image + (Math.floor(beats / shape.ticks) % shape.frames);
}

/**
 * 原版那两个全局的副作用语义 —— 纯状态机，时间由调用方喂。
 *
 * - 换了一支**不同的**形状 ⇒ 帧号、拍计数清 0（`fcn_004021f8` 0x0040222b..0x00402234）；
 * - 拍只在**画着**时走（0x00401fdd `test [0x48a179], 1 / je`）⇒ 藏起期间动画停住，放出来接着走；
 * - 藏起不换形状（`fcn_00402460(0)` 不碰 `[0x48a0f4]`）。
 */
export class CursorClock {
  #shape: CursorShape = ARROW_CURSOR;
  #shown = false;
  /** 当前形状已经画了多久（只计画着的时间）*/
  #shownMs = 0;
  /** 上一次 `step` 的时刻（画着时用来累计）*/
  #at: number | null = null;
  #touch = false;

  /** 喂一帧：此刻要什么。返回此刻该画的图号；藏起返回 `null` */
  step(want: CursorWant, now: number): number | null {
    if (this.#shown && this.#at !== null) this.#shownMs += Math.max(0, now - this.#at);
    this.#at = now;
    if (want === null) {
      this.#shown = false;
      return null;
    }
    if (!sameShape(want.shape, this.#shape)) {
      this.#shape = want.shape;
      this.#shownMs = 0;
    }
    this.#shown = true;
    this.#touch = want.touch === true;
    return cursorImageAt(this.#shape, this.#shownMs);
  }

  get shape(): CursorShape {
    return this.#shape;
  }
  get shown(): boolean {
    return this.#shown;
  }
  /** 触屏上也画（见 `CursorRequest.touch`）*/
  get touch(): boolean {
    return this.#shown && this.#touch;
  }
  /** 这支会动（要按拍续帧）*/
  get animated(): boolean {
    return this.#shown && this.#shape.frames > 1 && this.#shape.ticks > 0;
  }
}

// ============================================================
//  此刻该要哪一支（纯函数）
// ============================================================

/** `resolveCursor` 要看的那几项 —— 都由 `main.ts` 每帧现取 */
export interface CursorFrame {
  /** 主屏（`title` / `game` / `stock` / `inventory` …）*/
  readonly screen: string;
  /**
   * 此刻接管整屏（或浮窗）的那一屏要什么；没有接管的屏 = `undefined`。
   * 屏没实现 `UiScreen.cursor` 就是 `null`（演出类：一直藏着）。
   */
  readonly overlay?: CursorWant | undefined;
  /** 选目标（`picking.ts`）此刻那一支；不在选 = `null` */
  readonly pick: CursorShape | null;
  /** 遥控骰子的点数盘开着（0x004467e7）*/
  readonly dicePick: boolean;
  /** 紅卡 / 黑卡：真人在股市屏里选股（0x00444ff0 / 0x004450b4）*/
  readonly stockPick: boolean;
  /** 通用填数窗（`fcn_00453544`）开着 —— 棋盘上、銀行里、股市屏里都算（0x00452cb1）*/
  readonly amountWindow: boolean;
  /** ATM 窗开着（0x004370ba）*/
  readonly atm: boolean;
  /** 棋盘上别的**要本机作答**的窗开着：YES/NO 与各选项框、商店、銀行、監獄/醫院、还款提醒… */
  readonly localInput: boolean;
  /** 轮到本机真人、GO 鈕在场等掷骰（0x00417e1c / 0x00418db9）*/
  readonly goPhase: boolean;
}

/** 不在棋盘上的那几屏（标题、设定、存读档、大厅、資產表…）：原版都是放出箭头的窗口 */
const BOARD_SCREENS: ReadonlySet<string> = new Set(['game', 'stock', 'inventory']);

/**
 * 此刻要哪一支指针（`null` = 藏起）—— 纯函数，判据与出处见文件头。
 *
 * 次序 = 谁盖在最上面：接管整屏 / 浮窗的屏 → （股市屏）→ 选目标 → 遥控骰子 → 填数窗 → ATM →
 * 别的作答窗 → GO 鈕；都没有 = 「按过 GO、还没到下一次要人作答」⇒ 藏起。
 */
export function resolveCursor(f: CursorFrame): CursorWant {
  // 开局入场（角色逐个登场，`fcn_00415872`）：开局设定窗收场时 0x0040698e `fcn_00402460(0)` 收起，
  // 这一段没有地方再放出来，直到第一位真人的 GO 鈕上场（0x00417e1c）
  if (f.screen === 'intro') return null;
  if (!BOARD_SCREENS.has(f.screen)) return showCursor(ARROW_CURSOR);
  // 道具 / 卡片欄 @source 0x00445c76 `fcn_00402460(1)`
  if (f.screen === 'inventory') return showCursor(ARROW_CURSOR);
  // 盖在上面的那一屏（股市屏上也会弹訊息框，如「漲停無法買進！」0x0042af23 —— 訊息框期间藏着）
  if (f.overlay !== undefined) return f.overlay;
  if (f.screen === 'stock') {
    // 股市屏（0x0042a9e0 放出箭头）；紅卡/黑卡那一趟进屏前先换上卡片（0x00444ff0）；买卖填数窗换手指
    if (f.amountWindow) return showCursor(HAND_CURSOR);
    return showCursor(f.stockPick ? CARD_CURSOR : ARROW_CURSOR);
  }
  if (f.pick !== null) return showCursor(f.pick);
  if (f.dicePick) return showCursor(ARROW_CURSOR);
  if (f.amountWindow) return showCursor(HAND_CURSOR);
  if (f.atm) return showCursor(HAND_CURSOR);
  if (f.localInput) return showCursor(ARROW_CURSOR);
  if (f.goPhase) return showCursor(ARROW_CURSOR);
  return null;
}

/**
 * 这一屏归不归**本机**作答：单机 / 热座（`localSeat` 为 null / 不给）只看当前玩家是不是真人；
 * 联机还要轮到本机的座位 —— 别人的回合里本机只是旁观，不放指针、不换那一屏的专用指针。
 * 电脑 / 託管的回合（core 的 `isAiTurn`，与回合驱动同一条判据）也不放。
 */
export function localTurn(env: Pick<UiScreenEnv, 'state' | 'localSeat'>): boolean {
  const seat = env.localSeat;
  if (seat !== undefined && seat !== null && seat !== env.state.currentPlayer) return false;
  return env.state.players[env.state.currentPlayer] !== undefined && !isAiTurn(env.state);
}

// ============================================================
//  画出来（DOM 胶水 —— 浏览器里验收）
// ============================================================

/** 画布坐标换算：设备像素下的放大倍数与舞台左上角 */
export interface CursorMetrics {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface SoftCursorDeps {
  /** 游戏画布（`#board`）*/
  readonly board: HTMLCanvasElement;
  /** 取指针图（`Data.mkf` #0 第 `image` 张）；还没解码好返回 `null` */
  sprite(image: number): Sprite | null;
  /** client 坐标 → 舞台坐标；落在舞台外 `null`（就是 `main.ts` 的 `eventToStage`）*/
  toStage(clientX: number, clientY: number): { x: number; y: number } | null;
  /** 舞台在画布里的放大倍数与偏移（设备像素，`main.ts` 的 `currentMetrics`）*/
  metrics(): CursorMetrics;
  now(): number;
}

export interface SoftCursorLayer {
  /** 每帧（状态可能变了）喂一次此刻要什么 */
  update(want: CursorWant): void;
  /** 测试 / 调试：此刻画着的图号与舞台落点；没画 = `null` */
  drawn(): { image: number; x: number; y: number } | null;
}

/**
 * 在 `#board` 上盖一块同大小的透明画布画指针；舞台上一律藏掉系统指针（原版开局 `ShowCursor(0)`）。
 *
 * - 指针在舞台外（四周黑边）/ 离开画布：不画，系统指针照常；
 * - 触屏（最后一次是 `pointerType` 为 touch / pen）：只画 `touch` 请求（小游戏准星），系统指针不管；
 * - 图还没解码好：先**不**藏系统指针（免得屏上一时没有指针），到货那一帧 `update` 再补上。
 */
export function createSoftCursorLayer(deps: SoftCursorDeps): SoftCursorLayer {
  const { board } = deps;
  const clock = new CursorClock();
  let want: CursorWant = null;
  /** 最近一次是鼠标（`pointerType === 'mouse'`）；一碰触屏就置 false */
  let mouse = false;
  /** 指针在舞台上的哪儿（舞台坐标）；不在舞台上 = `null` */
  let at: { x: number; y: number } | null = null;
  let last: { image: number; x: number; y: number } | null = null;
  let lastKey = '';
  let queued = false;
  let osCursor = '';

  const layer = document.createElement('canvas');
  layer.id = 'softcursor';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '0px',
    height: '0px',
    pointerEvents: 'none',
    zIndex: '30',
    imageRendering: 'pixelated',
  });
  document.body.appendChild(layer);
  const ctx = layer.getContext('2d');

  const setOsCursor = (v: string): void => {
    if (v === osCursor) return;
    osCursor = v;
    board.style.cursor = v;
  };

  const schedule = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };

  function paint(): void {
    const image = clock.step(want, deps.now());
    const drawable = at !== null && image !== null && (mouse || clock.touch);
    const sprite = drawable ? deps.sprite(image) : null;
    // 系统指针：鼠标在舞台上就藏（原版开局就藏了），唯独「要显示、图还没到」那一刻先留着
    setOsCursor(mouse && at !== null && !(image !== null && sprite === null) ? 'none' : '');

    const r = board.getBoundingClientRect();
    const m = deps.metrics();
    const next =
      sprite !== null && at !== null && image !== null ? { image, x: Math.floor(at.x), y: Math.floor(at.y) } : null;
    const key =
      next === null
        ? ''
        : `${next.image}|${next.x}|${next.y}|${m.scale}|${m.offsetX}|${m.offsetY}|${board.width}x${board.height}|${r.left},${r.top},${r.width},${r.height}`;
    if (key !== lastKey) {
      lastKey = key;
      if (layer.width !== board.width || layer.height !== board.height) {
        layer.width = board.width;
        layer.height = board.height;
      }
      Object.assign(layer.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      if (ctx !== null) {
        ctx.clearRect(0, 0, layer.width, layer.height);
        if (next !== null && sprite !== null) {
          ctx.imageSmoothingEnabled = false;
          // @source 0x004022ac..0x004022bf：画在 (光标 − 锚点)
          ctx.drawImage(
            sprite.bitmap,
            m.offsetX + (next.x - sprite.anchorX) * m.scale,
            m.offsetY + (next.y - sprite.anchorY) * m.scale,
            sprite.width * m.scale,
            sprite.height * m.scale,
          );
        }
      }
      last = next;
    }
    // 会动的指针按拍续帧（原版 20 ms 一拍的定时器）
    if (clock.animated && next !== null) schedule();
  }

  const onPointer = (e: PointerEvent): void => {
    const m = e.pointerType === 'mouse';
    if (m !== mouse) {
      mouse = m;
      schedule();
    }
  };
  board.addEventListener('pointermove', onPointer);
  board.addEventListener('pointerdown', onPointer);
  // 位置：真鼠标与触屏手势派出来的合成 `mousemove`（`touch-input.ts`）都走这一条
  const onMove = (e: MouseEvent): void => {
    at = deps.toStage(e.clientX, e.clientY);
    schedule();
  };
  board.addEventListener('mousemove', onMove);
  board.addEventListener('mousedown', onMove);
  board.addEventListener('mouseleave', () => {
    at = null;
    schedule();
  });
  window.addEventListener('resize', schedule);

  return {
    update(w: CursorWant): void {
      want = w;
      paint();
    },
    drawn: () => last,
  };
}
