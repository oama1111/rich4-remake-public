/*
 * GO 鈕的**位置**与拖动 —— 这一份才是位置的真值来源
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这里答的是 Q-UI-6（`known-deviations.md`）。原来只有一句转述
 *   「可拖动、初始 180/120、夹在 640−w / 480−h」，下面是把 exe 逐条走完的结论。
 *
 * ## 1. 那两个全局就是位置本身（`[0x475284]` = x、`[0x475288]` = y）
 *
 * | 用途 | VA | 说明 |
 * |---|---|---|
 * | 初值 | `0x00475284` 的数据 | `dump` 出来 = **180 / 120**（数据段里的静态初值） |
 * | 窗口创建时抄到「上次画的」 | 0x004180ad | `[0x48bdec] = [0x475284]`、`[0x48bde8] = [0x475288]` |
 * | 绘制 | 0x004172a6 | `push [0x475288] / push [0x475284]` → 贴图函数 |
 * | 命中 | 0x00417172 | `cmp esi, [0x475284]` … `cmp edx, [0x475288]`（点在钮上） |
 * | 拖动写入 | 0x00418aa8 | 见下 |
 *
 * ## 2. 尺寸与夹取范围（都是**同一条** 640×480 坐标系）
 *
 * ```asm
 * 004180c1  mov  eax, [0x48be04]        ; GO 的图集（Panel.mkf 7）
 * 004180c6  movsx edx, word [eax + 0x0c]  ; 图0 宽 → [0x48bdd8]
 * 004180d0  movsx eax, word [eax + 0x0e]  ; 图0 高 → [0x48bddc]
 * ...
 * 00418ac0  eax = 0x280 − [0x48bdd8]    ; 640 − w
 * 00418ae9  eax = 0x1e0 − [0x48bddc]    ; 480 − h
 * ```
 * 图0 的尺寸我直接从 `assets/game/Panel.mkf` 资源 7 的 SMP 头上量过：
 * **72×67**（图 0..5 全是 72×67，图 6..11 是 15×15 的骰子数切换）。
 * 所以夹的是 **x ∈ [0, 568]、y ∈ [0, 413]**。
 *
 * ★ 那 `0x280`/`0x1e0` 是**舞台**（640×480）不是棋盘那一栏（439×440）：
 *   同一份窗口过程里 `0x1b8`/`0x1e0`/`0x28` 才是棋盘/訊息框那些区域。
 *
 * ## 3. 坐标空间：位置是**窗口客户区**坐标，不是棋盘画布坐标
 *
 * 鼠标那两个坐标在窗口过程里是**原样**用的，没有任何减去棋盘原点的动作：
 * 命中（0x0041815e `mov si, dx` / `shr edx,0x10`）与拖动（0x00418a86）读的是
 * 同一对寄存器，而 0x00417172 的命中矩形又和 0x004172a6 的贴图坐标是同一对全局。
 * 同理棋盘那些区域也都按客户区量（訊息框 `0x28..0x1e0`、工具钮 `y < 0x28`）。
 *
 * ⇒ 本引擎把 640×480 切成「工具栏 40 + 棋盘 440」，棋盘画布的原点在屏幕
 *   **(0, 40)**（见 `stage.ts` 的 `LAYOUT.board`）。所以：
 *   **屏幕坐标 = 棋盘画布坐标 + (0, 40)**，夹取范围搬过来就是
 *   x ∈ [0−0, 640−w−0]、y ∈ [0−40, 480−h−40]（见 `clampBoard`）。
 *
 * ## 4. 拖动期间的语义（原版怎么写的就怎么写）
 *
 * ```asm
 * 00418a73  cmp  byte [0x48be2a], 0   ; 没在拖 → 走别的那几条路
 * 00418a80  edi = [0x48be2b]          ; 按下时记的鼠标 x
 * 00418a86  ebx = esi − edi           ; = 鼠标 x − 按下时的鼠标 x
 * 00418a8a  ebp = [0x48be2f]          ; 按下时记的鼠标 y
 * 00418a8f  esi = edx − ebp
 * 00418a94  cmp ebx, [0x475284] / jne … / cmp esi, [0x475288] / je 返回
 * 00418aa8  [0x475284] = ebx ; [0x475288] = esi   ; 位置 += 鼠标位移
 * ```
 * - **锚点是按下那一刻的鼠标**（0x004182b5 在**按下**时写 `[0x48be2b]/[0x48be2f]`
 *   与标志 `[0x48be2a] = 1`），**不是**钮的位置 ⇒ 没有抓取偏移，
 *   第一帧位移为 0（`jne` 短路，连重画都不发）。
 * - **抬手才结束**（0x0041885c：`WM_LBUTTONUP` 把 `[0x48be2a]` 清 0，
 *   清完继续走到原来那条抬手路，没有再动位置）。
 * - **拖动期间不继续接受点击** —— 那条拖动分支直接 `jmp 0x418c30` 返回，
 *   而同一次 `WM_MOUSEMOVE` 里「镜头平移」（`[0x48be29]`）那一支在
 *   0x00418927 处 `cmp [0x48be29],0 / je 0x418a73` → 拖动标志为 1 时**先做拖动**
 *   （并且因为拖动分支直接返回，镜头那一段这一拍不动）。
 *   所以「按着 GO 钮拖」= 只拖钮，不点、也不平移镜头。
 * - **没有**吸附、回弹、双击复位、记忆到存档之类的东西 —— 一个都没加。
 */

/** GO 鈕初始位置（**屏幕**坐标）@source 数据 `[0x475284] = 180`、`[0x475288] = 120` */
export const GO_DEFAULT = { x: 180, y: 120 } as const;

/**
 * GO 鈕尺寸 = `Panel.mkf` 资源 7 图 0 的 72×67。
 *
 * @source 尺寸来自图集头（VA 0x004180c6 / 0x004180d0 从 `[0x48be04]` 读宽高），
 *   数值直接从 `assets/game/Panel.mkf` 资源 7 的 SMP 头量出（图 0..5 同尺寸）。
 */
export const GO_SIZE = { w: 72, h: 67 } as const;

/** 原版夹取用的那颗常量 @source VA 0x00418ac0 `mov eax, 0x280` / 0x00418ae9 `mov eax, 0x1e0` */
export const GO_BOUNDS = { w: 0x280, h: 0x1e0 } as const;

/**
 * 棋盘画布原点在屏幕上的位置 —— 夹取在屏幕坐标里做，换算到画布坐标时减去它。
 * @source `stage.ts` 的 `LAYOUT.board`（顶部工具栏 439×40，所以棋盘从 y=40 起）
 */
export const GO_CANVAS_ORIGIN = { x: 0, y: 40 } as const;

export interface GoPos {
  x: number;
  y: number;
}

export function samePos(a: GoPos, b: GoPos): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * 夹取 —— `[0, 640−w] × [0, 480−h]`（**屏幕**坐标）。
 *
 * @source VA 0x00418ab4 `test ebx,ebx / jge / xor ecx,ecx`、
 *   0x00418ac0 `0x280 − [0x48bdd8]`、0x00418ad8 `cmp [0x475288],0 / jge`、
 *   0x00418ae9 `0x1e0 − [0x48bddc]`。上界用 `jge`（**相等也保留**），
 *   下界用 `test/jge` ⇒ 与 `Math.min/max` 等价。
 */
export function clampScreen(x: number, y: number): GoPos {
  return {
    x: Math.min(GO_BOUNDS.w - GO_SIZE.w, Math.max(0, x)),
    y: Math.min(GO_BOUNDS.h - GO_SIZE.h, Math.max(0, y)),
  };
}

/** 同上，但收的是**棋盘画布**坐标（= 屏幕坐标 − 画布原点） */
export function clampBoard(x: number, y: number): GoPos {
  const s = clampScreen(x + GO_CANVAS_ORIGIN.x, y + GO_CANVAS_ORIGIN.y);
  return { x: s.x - GO_CANVAS_ORIGIN.x, y: s.y - GO_CANVAS_ORIGIN.y };
}

/** 画布坐标 ≡ 屏幕坐标 − 原点 */
export function boardToScreen(p: GoPos): GoPos {
  return { x: p.x + GO_CANVAS_ORIGIN.x, y: p.y + GO_CANVAS_ORIGIN.y };
}

/** 鼠标位移（= 新鼠标 − 锚点鼠标）@source VA 0x00418a86 `ebx = esi − edi` */
export function dragDelta(anchor: GoPos, mouse: GoPos): GoPos {
  return { x: mouse.x - anchor.x, y: mouse.y - anchor.y };
}

/** 点在 GO 鈕上（**棋盘画布**坐标） */
export function pointInGo(x: number, y: number, pos: GoPos): boolean {
  return x >= pos.x && x < pos.x + GO_SIZE.w && y >= pos.y && y < pos.y + GO_SIZE.h;
}

export interface GoButton {
  /** 当前位置（**棋盘画布**坐标；屏幕坐标 = 它 + `GO_CANVAS_ORIGIN`） */
  position(): GoPos;
  /** 是否正被拖着（对应 `[0x48be2a]`） */
  dragging(): boolean;
  /** 回到初值、清掉拖动 —— 原版窗口创建时 `[0x475284]/[0x475288]` 是静态初值 */
  reset(): void;
  /**
   * 按下：在钮上就**记下按下那一刻的鼠标**、进入拖动、并返回 true
   * （调用方照原版**在按下这一拍就把动作做掉**）。
   */
  press(x: number, y: number, mouse: GoPos): boolean;
  /** 移动：只有正拖着才动位置（位移进位置） */
  move(mouse: GoPos): void;
  /** 抬手：结束拖动（原版只清标志，位置不动） */
  release(): void;
}

/** 初值换算到棋盘画布坐标：屏幕 (180,120) → 画布 (180,80) */
const GO_DEFAULT_BOARD: GoPos = { x: GO_DEFAULT.x - GO_CANVAS_ORIGIN.x, y: GO_DEFAULT.y - GO_CANVAS_ORIGIN.y };

/**
 * 建一个 GO 鈕状态。参数只是为了测试能换个起点，生产上一律用默认。
 *
 * @param initial 起点（**棋盘画布**坐标）—— 原版那个全局是屏幕坐标，
 *   换算就是减去 `GO_CANVAS_ORIGIN`（见 `boardToScreen`）。
 */
export function createGoButton(initial: GoPos = GO_DEFAULT_BOARD): GoButton {
  let pos = clampBoard(initial.x, initial.y);
  let anchor: GoPos | null = null;

  return {
    position: () => pos,
    dragging: () => anchor !== null,
    reset: () => {
      pos = clampBoard(GO_DEFAULT_BOARD.x, GO_DEFAULT_BOARD.y);
      anchor = null;
    },
    press: (x, y, mouse) => {
      if (!pointInGo(x, y, pos)) return false;
      anchor = mouse;
      return true;
    },
    move: (mouse) => {
      if (anchor === null) return;
      const d = dragDelta(anchor, mouse);
      pos = clampBoard(pos.x + d.x, pos.y + d.y);
      anchor = mouse; // 原版位置是 `鼠标 − 锚点`；把锚点推进到当前鼠标才等价于「位置 += 位移」
    },
    release: () => {
      anchor = null;
    },
  };
}

/**
 * 全局那一颗 —— 原版 `[0x475284]/[0x475288]` 也是**整个进程一份**，
 * 所以这里同样只放一份，不做成「每个玩家一份」。
 */
export const goButton = createGoButton();
