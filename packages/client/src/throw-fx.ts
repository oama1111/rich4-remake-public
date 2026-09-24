/*
 * 放置類道具的**投掷动效** + 棋盘上的物件图标 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「那一件此刻画在哪、长什么样」，不碰任何规则。
 *   ★ C-DET-4：动效**绝不进 state/history** —— 丢了只是少一段动画。
 *
 * ── 出处（需求方 2026-09-16：「没有从人物身上丢到目标点的动效」）────────
 *
 * @source 三个 `use_tool_*` 在 `place_object` 之后**同一个形状**地调
 *   `_rich4_animate_object`（VA 0x0040e669），六个参数：
 *
 * ```asm
 * rich4_tool_luzhang.asm（地雷/定時炸彈两份逐字相同，只差物件种类与音效号）
 * 00446c01  push 0 / push 0 / push ebx / push 0x10   ; place_object(16, 目标格, 0, 0)
 * 00446c08  call _rich4_place_object                  ; → eax = 物件 handle（下标+1）
 * 00446c12  push 0x64                                 ; arg6 = **100 ms 收尾停顿**
 * 00446c26  movsx edx, word [目标格 + 2] / push edx   ; arg5 = 目标格 y（地图像素）
 * 00446c2b  movsx eax, word [目标格]     / push eax   ; arg4 = 目标格 x
 * 00446c3f  push 玩家 y（player + 0xa）
 * 00446c4c  push 玩家 x（player + 0x8）
 * 00446c4d  push ecx（handle）                        ; arg1 = 物件 handle
 * 00446c4e  call _rich4_animate_object
 * 00446c58  push 0x48236a / call rich4_play_sound_effect   ; ★ 动画**播完**才响
 * ```
 *   ⇒ `animate_object(handle, 玩家x, 玩家y, 目标格x, 目标格y, 100)`。
 *
 * `_rich4_animate_object` 的规格（VA 0x0040e669，`rich4_animate_object.asm`）：
 * ```asm
 * 0040e6c4  起：两个端点各经 fcn_00409a23 换算成**屏幕**坐标（越出 29×29 窗口
 *           就返回 0，两轴都为 0 → 0040e6f2 直接返回，什么都不播）
 * 0040e724  edx = Δx ; ecx = Δy
 * 0040e73c  fild (Δx²+Δy²) / call sqrt / fmul [0x46324c] / fld1 / faddp
 *           ; ★ 0x46324c = 0x3E000000 = **0.125f**（前面那 4 字节是 0）
 * 0040e74f  call round_toward_zero（向零截断）
 * 0040e754  fistp [esp+0x60]                 ; ★ **帧数 N = trunc(√(Δx²+Δy²) × 0.125 + 1)**
 * 0040e770  fdiv 帧数 → stepX ; 0040e780 → stepY     ; 线性等分（不是弧线）
 * 0040e794  curX = 起点x + stepX ; 0040e7a8 curY = 起点y + stepY
 *           ; ★ 第一帧就已经离起点一步，第 N 帧**正好落在终点**
 * 0040e987  cmp eax, 0x18 / jae 下一帧 / 否则 sleep(0x18 − 已用时)
 *           ; ★ 每帧补到 **0x18 = 24 ms**（≈41.7 fps）
 * 0040e9a0  curX += stepX ; curY += stepY ; 0040e9b8 dec 帧数
 * 0040e9bd  sleep(arg6 = **100 ms**)          ; ★ 收尾停顿（此后调用方才放落地音）
 * ```
 *   每帧贴的是**物件自己那套图**（`[type×4 + 0x49692c]`，与棋盘上静止那件同一套，
 *   见下面的 `objectSpriteResource`），图号 = `8 − 视角 + 物件朝向`（`& 7`）。
 *   注意它**不走绘制槽** —— 直接贴到屏幕上，故恒压在所有立体物之上。
 *
 * ⚠️ 「動畫過程」设定关掉时这一段播不播**没查到**：`animate_object` 本身没有任何
 *   开关检查（整支函数读过），调用点也没有。故本模块不设闸门，照 exe 恒播。
 *   登记在 `docs/deviations/Q-TOOL-1.md`。
 *
 * ── Q-TOOL-5 追加：另外 23 个调用点（卡片 / 請神符）────────────────────────
 *
 * 全 exe 一共 **26** 个 `animate_object` 调用点：3 个是放置類道具（上面那套），
 * 另外 **23** 个全在卡片函数里（0x00442xxx..0x004459xx）+ 1 个在請神符里。
 * 它们有**两种形状**：
 *
 * 1. **卡片飞行**（22 个点）：`push 0` 当 arg1（handle = 0）——
 *    `_rich4_animate_object` 的 0x0040e6b9 那一支就取 `[0x49697c]`（物件图集表
 *    下标 19 = **物件种类 20** → `Data.mkf` **415**）并 `xor ebp, ebp`（**恒第 0 帧**）。
 *    415 实测只有 1 张 20×26 图（一张卡片）。
 * 2. **神明飞回主人**（請神符 23，VA 0x00444efa）：arg1 = 神明的 handle，
 *    起点是**神明所在的格**、终点是**出牌者**（与卡片**反向**），arg6 = **0**。
 *
 * ★ 卡片那 22 个点前面**几乎都**有一条闸门（唯一的例外是天使卡作用于地块那一个，
 *   VA 0x0044360f，见下面的表）：
 * ```asm
 * imul eax, [0x49910c], 0x68
 * cmp  byte [eax + 0x496b7d], 1     ; who_plays == 1（纯人类）
 * je   跳过整段                        ; ★ 人类出牌不播；电脑（或被托管）才播
 * ```
 *   同一条函数开头就是这个字段的另一个用法（`cmp …,1 / jne AI 选目标`），
 *   所以 1 = 人类是**两端互证**的，不是猜的。
 */

import { WHO_PLAYS_HUMAN, type CardTarget } from '@rich4/core';
import { screenDirection } from './assets.ts';

/** 一个屏幕坐标点（棋盘局部像素） */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * 一帧补到多少毫秒 —— **固定 24 ms**。
 * @source VA 0x0040e987 `cmp eax, 0x18` / 0x0040e98c `mov edx, 0x18`
 */
export const THROW_FRAME_MS = 0x18; // 24

/**
 * 动画播完之后的收尾停顿（毫秒）—— 原版在这之后才放落地音、才刷新屏幕。
 * @source VA 0x00446c12 `push 0x64`（arg6）+ VA 0x0040e9bd 的 `sleep(arg6)`
 */
export const THROW_SETTLE_MS = 0x64; // 100

/**
 * 帧数公式里的系数 —— 每 8 屏幕像素一帧。
 * @source VA 0x0040e745 `fmul dword [0x46324c]`，该处 = `0x3E000000` = 0.125f
 */
export const THROW_FRAME_SCALE = 0.125;

/**
 * 这个距离要播几帧。
 *
 * @source VA 0x0040e73c..0x0040e754：`trunc(√(Δx²+Δy²) × 0.125 + 1)`。
 *   注意**没有**「至少 1 帧」的钳位 —— 公式本身恒 ≥ 1。
 *   （`+1` 在截断之内，与截断之外等价：`trunc(x+1) === trunc(x)+1`。）
 */
export function throwFrameCount(dx: number, dy: number): number {
  return Math.trunc(Math.hypot(dx, dy) * THROW_FRAME_SCALE + 1);
}

/**
 * 第 k 帧（k = 1..N）落在哪 —— 屏幕坐标上的线性等分。
 *
 * @source VA 0x0040e794/0x0040e7a8（起点先加一步）+ 0x0040e9a0（每帧再累加）：
 *   第 k 帧 = `from + (to − from) × k / N`，故**第 N 帧正好是终点**。
 *   与 `tween.ts` 的 `framesFor` 是同一个公式（那边是走子，这边是道具）。
 */
export function throwFrameAt(
  from: ScreenPoint,
  to: ScreenPoint,
  frames: number,
  k: number,
): ScreenPoint {
  const n = frames < 1 ? 1 : frames;
  const j = k < 1 ? 1 : k > n ? n : k;
  return {
    x: from.x + ((to.x - from.x) * j) / n,
    y: from.y + ((to.y - from.y) * j) / n,
  };
}

/** 这条动效总共要播多久（毫秒）= 帧数 × 24 + 收尾停顿
 *
 * 收尾停顿缺省 100 ms（三个放置類道具），但**請神符是 0**
 * （VA 0x00444ebe `push 0` 当 arg6）—— 见 `makeObjectFlight` 的 `settleMs`。
 */
export function throwTotalMs(frames: number, settleMs: number = THROW_SETTLE_MS): number {
  return Math.max(1, frames) * THROW_FRAME_MS + settleMs;
}

// ============================================================
//  物件（路障 / 地雷 / 定時炸彈 / 神明…）的图
// ============================================================

/**
 * 物件图集的资源基号 —— `Data.mkf` 的 **0x18c**（396）。
 *
 * @source `_rich4_load_map`（VA 0x004080b2..0x004080cc）：
 * ```asm
 * xor ebx, ebx
 * loc_004080b2:
 *   lea eax, [ebx + 0x18c]              ; ★ 资源号 = 0x18c + i
 *   push eax / push [0x48a0e4]          ; [0x48a0e4] = Data.mkf 句柄
 *   call _read_mkf
 *   mov [ebx*4 + 0x496930], eax         ; ★ 存进「物件图集表」下标 i+1
 *   inc ebx / cmp ebx, 0x14 / jl loc_004080b2
 * ```
 * 读图那一侧在绘制槽里（VA 0x00408f49..0x00408f59）与投掷动画里
 * （VA 0x0040e6a1）都是 `mov al, [objects_info[i].type]` /
 * `mov eax, [type*4 + 0x49692c]` ⇒ **表下标 = 物件种类**，故
 * `资源号 = 0x18c + 种类 − 1`。
 */
export const OBJECT_SPRITE_BASE = 0x18c; // 396

/** 表里装了多少种（`cmp ebx, 0x14`）—— 种类 1..20；引擎里实际用到 1..18 */
export const OBJECT_SPRITE_TYPES = 0x14; // 20

/**
 * 物件种类 → `Data.mkf` 资源号；超出表范围返回 null。
 *
 * 目视核过（`assets-clean/Data/`）：
 * - 种类 1..14 → 396..409（神明與拾取物）
 * - 种类 15 → 410（死神）
 * - 种类 **16 → 411 路障（STOP 牌）**、**17 → 412 地雷（刺球）**、
 *   **18 → 413 定時炸彈（带表的炸药捆）**
 */
export function objectSpriteResource(type: number): number | null {
  if (!Number.isInteger(type) || type < 1 || type > OBJECT_SPRITE_TYPES) return null;
  return OBJECT_SPRITE_BASE + type - 1;
}

/**
 * 物件图画哪一张 —— 每个资源恰好 **8 张图 = 8 向各 1 帧**（实测 411/412/413）。
 *
 * @source 绘制槽登记处 VA 0x00408ee2..0x00408ef2 与投掷动画 VA 0x0040e6a1 附近：
 * ```asm
 * mov al, 8
 * sub al, byte [0x499088]              ; − 当前视角
 * add al, byte [objects_info + 1]      ; + 物件朝向（place_object 写入）
 * and al, 7
 * ```
 * 与玩家的 `screenDirection(direction, view)` **同一个公式**，故直接复用
 * （不在这里写第二份）。
 */
export function objectImageIndex(facing: number, view: number): number {
  return screenDirection(facing, view);
}

/**
 * 物件摆在某一格时朝向哪 —— 原版在 `place_object` 里**算一次存进 `+1`**。
 *
 * @source `_rich4_place_object` VA 0x0040e0dc..0x0040e10a：
 * ```asm
 * xor edx, edx
 * loc_0040e0ea:
 *   mov ax, word [节点 + edx*2 + 0x18]     ; ★ 4 个邻接槽里**第一个非 0** 的
 *   and eax, 0xffff
 *   je 下一个（edx++ / cmp edx,4）
 * loc_0040e10a:
 *   push 节点号 / push 邻接节点号
 *   call fcn_00407a8c                      ; = rich4_calculate_direction(本格 − 邻格)
 *   mov byte [objects_info[i] + 1], dl     ; ★ 朝向 = 「从那个邻格→本格」的方向
 * ```
 * 即物件**面朝来路**。（`fcn_00407a8c` 就是 `directionOf(dx, dy)`：
 * `rich4_calculate_direction` VA 0x004454fb4，与 core 的 `directionOf` 同源。）
 *
 * ⚠️ 引擎的 `MapObject` 里**没有** `facing` 字段（core 不改规则），故这里按同一
 *   条规则**当场推**。四个槽全 0 时原版算的是「从 0 号空节点出发」的方向，
 *   无意义；这里退回 0。
 */
export function objectFacing(
  node: { x: number; y: number; adjacentSlots: readonly number[] },
  nodes: readonly { x: number; y: number }[],
  directionOf: (dx: number, dy: number) => number,
): number {
  let neighbor = 0;
  for (const slot of node.adjacentSlots) {
    if (slot !== 0) {
      neighbor = slot;
      break;
    }
  }
  const n = nodes[neighbor - 1];
  if (neighbor === 0 || n === undefined) return 0;
  // @source fcn_00407a8c(邻格, 本格) → 方向 = 本格 − 邻格
  return directionOf(node.x - n.x, node.y - n.y) & 7;
}

// ============================================================
//  一条正在播的投掷（纯表现，不进 state）
// ============================================================

/**
 * 一件正在从角色身上飞向目标格的物件。
 *
 * ★ 端点存的是**屏幕**坐标：原版两个端点只在开播前经 `fcn_00409a23` 换算一次
 *   （VA 0x0040e6c4 起），之后每帧都在屏幕空间线性累加 —— 镜头中途动也不改端点。
 */
export interface ObjectFlight {
  /**
   * 飞的那一件在 `state.objects` 里的下标（静态层要把它藏起来，别画两遍）。
   * ★ **`-1` = 棋盘上没有这一件**（卡片飞行：原版 arg1 = 0，物件表里没有对应项）。
   */
  objectIndex: number;
  /** 物件种类（16 路障 / 17 地雷 / 18 定時炸彈 / 20 卡片 / 神明 1..15）→ 查图集 */
  type: number;
  /** 物件朝向（见 `objectFacing`）→ 决定画哪一张（`image` 给了就不用它） */
  facing: number;
  /**
   * 图号。**缺省 = 按 `8 − 视角 + 朝向` 现算**（放地上的物件那套）。
   *
   * ★ handle == 0（卡片）那一支恒为 **0**：`xor ebp, ebp` @source VA 0x0040e6b9，
   *   而卡片图集只有 1 张图，按角度算会取到不存在的图号（画不出来）。
   */
  image?: number;
  /** 屏幕起点 */
  from: ScreenPoint;
  /** 屏幕终点 */
  to: ScreenPoint;
  /** 帧数 = `throwFrameCount(Δx, Δy)` */
  frames: number;
  /** 起播时刻（`performance.now()`） */
  start: number;
  /**
   * 收尾停顿毫秒（`animate_object` 的 arg6）。缺省 `THROW_SETTLE_MS` = 100。
   * @source 請神符 VA 0x00444ebe 是 `push 0` ⇒ 0；三个放置類道具是 `push 0x64`。
   */
  settleMs?: number;
}

/** 造一条投掷 —— 帧数在这里按 exe 的公式定死一次 */
export function makeObjectFlight(args: {
  objectIndex: number;
  type: number;
  facing: number;
  image?: number;
  from: ScreenPoint;
  to: ScreenPoint;
  start: number;
  settleMs?: number;
}): ObjectFlight {
  return { ...args, frames: throwFrameCount(args.to.x - args.from.x, args.to.y - args.from.y) };
}

/**
 * 这一帧该把物件画在哪；`null` = 还没到第一帧（调用方不画）。
 *
 * 第 k 帧的 k 由已经过去的毫秒数定：`k = floor((now − start) / 24) + 1`，
 * 与 exe「每帧补到 24 ms」等价（exe 是阻塞补时，这里是按时间取帧）。
 */
export function flightPosAt(f: ObjectFlight, now: number): ScreenPoint | null {
  const elapsed = now - f.start;
  if (elapsed < 0) return null;
  const k = Math.floor(elapsed / THROW_FRAME_MS) + 1;
  return throwFrameAt(f.from, f.to, f.frames, k);
}

/** 这条投掷连收尾停顿一起播完了吗（播完才放落地音、才让静态那件露出来） */
export function flightDone(f: ObjectFlight, now: number): boolean {
  return now - f.start >= throwTotalMs(f.frames, f.settleMs);
}

/** 这一帧还没画完（还要再排一帧）*/
export function flightRunning(f: ObjectFlight, now: number): boolean {
  return !flightDone(f, now);
}

// ============================================================
//  ★ Q-TOOL-5 ①：卡片 / 請神符 的飞行 —— 另外 23 个 `animate_object` 调用点
// ============================================================

/**
 * `handle == 0` 那一支用的**物件种类** = 20。
 *
 * @source `_rich4_animate_object` VA 0x0040e6b9（`test edx,edx / je` 的目标）：
 * ```asm
 * loc_0040e6b9:
 *   xor ebp, ebp                             ; ★ 帧号恒 0
 *   mov edi, dword [0x49697c]                ; ★ 图集 = 物件图集表下标 19
 *   lea ebx, [edi + 0xc]                     ; 取第 0 帧的 graph_st
 * ```
 * `0x49697c = 0x49692c + 20*4` ⇒ **种类 20**；`_rich4_load_map` 读的是
 * `0x18c + (20−1)` = **415**，实测只有 1 张 20×26 的 SPR（一张卡片）。
 * 这也是全 exe **唯一**一处引用 `0x49697c`（`xref 0x49697c` 只命中 0x0040e6bb）。
 */
export const CARD_FLIGHT_TYPE = 20;

/** `handle == 0` 那一支恒画第 0 帧 @source VA 0x0040e6b9 `xor ebp, ebp` */
export const CARD_FLIGHT_IMAGE = 0;

/**
 * 卡片飞行用的 `ObjectFlight.objectIndex` —— 棋盘上没有这一件可藏
 * （静态层按 `hidden` 逐下标比，`-1` 永不命中）。
 */
export const CARD_FLIGHT_NO_OBJECT = -1;

/**
 * 出牌者是**纯人类**时，原版整段跳过飞行动效。
 *
 * @source 22 个卡片调用点前面的同一形状（逐点见表 `CARD_FLIGHT_SITES`）：
 * ```asm
 * imul eax, dword [0x49910c], 0x68
 * cmp  byte [eax + 0x496b7d], 1     ; player_info +0x15 = who_plays
 * je   跳过整段
 * ```
 * ★ 同一条函数开头就是这个字段的另一个用法（`cmp …,1 / jne AI 选目标`，
 *   例如拆除卡 VA 0x00443b1f、路障 VA 0x00446bd9），故 **1 = 人类** 是两端互证。
 * ★ 比的是**整字节**：人类 + 被托管（`0x05`）**不**等于 1，所以照播 —— 照抄。
 */
export function flightAllowed(whoPlays: number): boolean {
  return whoPlays !== WHO_PLAYS_HUMAN;
}

/** 一段飞行要飞的目标种类 —— 就是 `CardTarget.kind` 里那四种有坐标的 */
export type CardFlightTargetKind = 'player' | 'entity' | 'facility' | 'object';

/**
 * 一个 `animate_object` 调用点的取证记录。
 *
 * 表里 **25 行 / 23 个不同的 VA**：怪獸卡(11) 与漲價卡(27) 各只有**一个**调用点，
 * 却同时服务「地块」与「設施」两种目标（两条分支汇到同一段动画），故各占两行。
 */
export interface CardFlightSite {
  /** 卡片编号（1 基，与 `CARDS` 同序） */
  readonly cardId: number;
  /** 这一行服务的 `CardTarget.kind` */
  readonly target: CardFlightTargetKind;
  /**
   * `who_plays == 1`（纯人类）时**整段不播**吗。
   * ★ 只有两个点是 `false`：天使卡(9)作用于**地块**那一支（VA 0x0044360f）
   *   与請神符(23)（VA 0x00444efa）—— 那两处的 0x496b7d 比较只用来选目标，不闸动画。
   */
  readonly humanSkips: boolean;
  /** 收尾停顿毫秒（arg6）：`push 0x64` → 100，請神符 `push 0` → 0 */
  readonly settleMs: number;
  /** `true` = **从目标飞向出牌者**（只有請神符） */
  readonly reversed: boolean;
  /**
   * 本引擎能不能走到这一支。
   * `false` 的三行是 core 不接受那种目标（見 `docs/deviations/Q-TOOL-5.md`）：
   * 換地卡作用于設施、換屋卡作用于設施、拆除卡作用于地圖物件。
   */
  readonly supported: boolean;
  /** 调用点 VA @source */
  readonly va: number;
}

/**
 * 23 个调用点逐条登记（顺序 = 卡片编号，同卡按目标种类）。
 * 每一行的 `va` 都能用 `python3 tools/disasm.py callers 0x40e669` 复核。
 */
export const CARD_FLIGHT_SITES: readonly CardFlightSite[] = [
  // 均貧卡：把钱从最富的人身上搬到最穷的人 → 卡片飞到**目标玩家**
  { cardId: 2, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x004422d6 },
  // 換地卡：换的是「脚下的那块 / 对方那块」，两支互斥
  { cardId: 4, target: 'entity', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x004427b3 },
  { cardId: 4, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: false, va: 0x00442a01 },
  // 換屋卡：同上（脚下的房子 / 对方那栋）—— 本引擎这张卡只认住宅/连锁店
  { cardId: 5, target: 'entity', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00442c81 },
  { cardId: 5, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: false, va: 0x00442e9c },
  // 轉向卡：卡片飞到目标玩家身上（对四大惡人那一支原版把 actor 号当玩家下标算坐标，见 deviation）
  { cardId: 6, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x0044301c },
  // 天使卡：地块那一支**没有** who_plays 闸门（原版的不对称，照抄）
  { cardId: 9, target: 'entity', humanSkips: false, settleMs: 100, reversed: false, supported: true, va: 0x0044360f },
  { cardId: 9, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x0044369f },
  // 惡魔卡：地块（同區批量）/ 設施（单个）
  { cardId: 10, target: 'entity', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x0044383b },
  { cardId: 10, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00443905 },
  // 怪獸卡：两条分支汇到**同一段**动画（ebx 是地块或設施记录）
  { cardId: 11, target: 'entity', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00443a6a },
  { cardId: 11, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00443a6a },
  // 拆除卡：地块（同區）/ 設施（单个）/ **地圖物件**（第三个点，本引擎这张卡不收 object 目标）
  { cardId: 12, target: 'entity', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00443bf1 },
  { cardId: 12, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00443cbd },
  { cardId: 12, target: 'object', humanSkips: true, settleMs: 100, reversed: false, supported: false, va: 0x00443d8f },
  { cardId: 13, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00443ef7 },
  { cardId: 14, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00444050 },
  { cardId: 16, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x004442aa },
  { cardId: 17, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00444591 },
  // ★ 請神符：**神明**从它所在的格飞向出牌者，飞完才附身；arg6 = 0；没有 who_plays 闸门
  { cardId: 23, target: 'object', humanSkips: false, settleMs: 0, reversed: true, supported: true, va: 0x00444efa },
  { cardId: 26, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x004452c6 },
  // 漲價卡：地块（同區批量）与設施（单个）汇到同一段动画
  { cardId: 27, target: 'entity', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00445576 },
  { cardId: 27, target: 'facility', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x00445576 },
  { cardId: 29, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x004457e0 },
  { cardId: 30, target: 'player', humanSkips: true, settleMs: 100, reversed: false, supported: true, va: 0x004459af },
];

/** 一个世界坐标点（地图像素，与 `land.x/y`、`node.x/y` 同一套） */
export interface FlightAnchor {
  x: number;
  y: number;
}

/**
 * 目标位置的解析器 —— 由调用方（`main.ts`）从 `state` / `map` 里查。
 *
 * C-ARC-2：本模块不碰规则，也不认识 `map`；「目标是谁」到这里已经定完了。
 */
export interface CardFlightAnchors {
  player(index: number): FlightAnchor | null;
  land(entityId: number): FlightAnchor | null;
  facility(facilityId: number): FlightAnchor | null;
  /** 地圖物件：除了位置还要**种类与朝向**（請神符飞的是物件自己那套图） */
  object(objectIndex: number): (FlightAnchor & { type: number; facing: number }) | null;
}

/** 一次出牌该起的那段飞行动效（纯规格；屏幕换算在调用方） */
export interface CardFlightPlan {
  /** 飞的是**卡片**（资源 415、恒第 0 帧）还是棋盘上那件**物件**（請神符） */
  sprite: { kind: 'card' } | { kind: 'object'; objectIndex: number; type: number; facing: number };
  /** 世界坐标起点 */
  from: FlightAnchor;
  /** 世界坐标终点 */
  to: FlightAnchor;
  /** 收尾停顿毫秒（arg6） */
  settleMs: number;
  /** 飞行期间要从静态层藏起来的那一件（卡片 = null） */
  hideObjectIndex: number | null;
}

export interface CardFlightQuery {
  cardId: number;
  /** 出牌者 `player_info +0x15` 原字节（人类 == 1） */
  whoPlays: number;
  target: CardTarget;
  /** 出牌者所在位置（原版读 `player + 0x8/+0xa`） */
  actor: FlightAnchor;
  anchor: CardFlightAnchors;
}

/** `CardTarget.kind` → 表里的目标种类；查不到（actor/stock/node/none）返回 null */
export function cardFlightTargetKind(target: CardTarget): CardFlightTargetKind | null {
  switch (target.kind) {
    case 'player':
      return 'player';
    case 'entity':
      return 'entity';
    case 'facility':
      return 'facility';
    case 'object':
      return 'object';
    default:
      return null;
  }
}

/**
 * 找出这次出牌对应的调用点 —— 没有（不需要动效 / 本引擎走不到）返回 null。
 * 同卡同目标种类只会有一行。
 */
export function cardFlightSite(cardId: number, target: CardTarget): CardFlightSite | null {
  const kind = cardFlightTargetKind(target);
  if (kind === null) return null;
  return CARD_FLIGHT_SITES.find((s) => s.cardId === cardId && s.target === kind) ?? null;
}

/**
 * 这一次 `useCard` 该起哪段飞行动效 —— `null` = 不起。
 *
 * 判据**逐条照 exe**（每一步都指向 `CARD_FLIGHT_SITES` 里那一行的 VA）：
 * 1. 目标种类得是四种有坐标的之一（actor/stock/node/none 原版也没有这一段）；
 * 2. 该卡该目标种类得有调用点，且 `supported`；
 * 3. `humanSkips && whoPlays == 1` → 不播（22 个点里的 20 个如此）；
 * 4. 目标位置能查到（查不到 = 不在图上，不播）。
 *
 * ★ 两端点**完全相同**时不播 —— 这不是本函数的事：`_rich4_animate_object`
 *   VA 0x0040e6f2 在换算成屏幕坐标后自己 `test/jne + test/je` 直接返回，
 *   调用方（`main.ts`）照抄那一条。
 */
export function cardFlightPlan(q: CardFlightQuery): CardFlightPlan | null {
  const site = cardFlightSite(q.cardId, q.target);
  if (site === null || !site.supported) return null;
  if (site.humanSkips && !flightAllowed(q.whoPlays)) return null;

  let sprite: CardFlightPlan['sprite'] = { kind: 'card' };
  let hideObjectIndex: number | null = null;
  let target: FlightAnchor | null = null;

  switch (q.target.kind) {
    case 'player':
      target = q.anchor.player(q.target.index);
      break;
    case 'entity':
      target = q.anchor.land(q.target.entityId);
      break;
    case 'facility':
      target = q.anchor.facility(q.target.facilityId);
      break;
    case 'object': {
      const o = q.anchor.object(q.target.objectIndex);
      if (o === null) break;
      target = { x: o.x, y: o.y };
      sprite = { kind: 'object', objectIndex: q.target.objectIndex, type: o.type, facing: o.facing };
      // @source VA 0x00444ea8 `mov word [objects_info[i] + 2], 0` —— 飞行期间
      //   神明先从地图上摘掉，飞完才写回并附身（VA 0x00444f02 / 0x00444f18）
      hideObjectIndex = q.target.objectIndex - 1;
      break;
    }
    default:
      break;
  }
  if (target === null) return null;

  return site.reversed
    ? { sprite, from: target, to: q.actor, settleMs: site.settleMs, hideObjectIndex }
    : { sprite, from: q.actor, to: target, settleMs: site.settleMs, hideObjectIndex };
}

// ============================================================
//  ★ Q-TOOL-5 ②：**附身于人**的物件画在主人身上
// ============================================================

/**
 * 定時炸彈的种类号。
 * @source `cmp byte [objects_info[i]], 0x12`（VA 0x004090a9）
 */
export const OBJECT_TYPE_TIMEBOMB = 18;

/**
 * 附身物相对主人的**屏幕**偏移表（普通那张，8 项，按图号取）。
 *
 * @source `fcn_0040829d` 的附身那一支 VA 0x00408c65：
 * ```asm
 * 00408c65  esi = [esp+0x54]                    ; ★ 图号（见 `attachedImageIndex`）
 * 00408c69  eax = dword [esi*8 + 0x474951]      ; ★ 表项 +0
 * 00408c70  add [esp+0x30], eax                 ; ★ +0 加到**屏幕 X**
 * 00408c74  eax = dword [esi*8 + 0x474955]      ; ★ 表项 +4
 * 00408c7b  add [esp+0x3c], eax                 ; ★ +4 加到**屏幕 Y**
 * ```
 * ★★ **表项的内存顺序是 `(X, Y)`，不是 `(Y, X)`** —— 2026-09-19 逐条核过
 *   （试玩3 #10）。`[esp+0x30]` 是 X、`[esp+0x3c]` 是 Y，证据在紧邻的上游：
 *   VA 0x00409042..0x00409053 用投影表的 `0x46ccf2`（**第 2 个 int16 = X**，
 *   见 `@rich4/data` 的 `projection.ts` 那段订正）算出 X 存 `[esp+0x30]`；
 *   VA 0x00409057..0x00409068 用 `0x46ccf0`（Y）算出 Y 存 `[esp+0x3c]`。
 *   写入绘制槽那一侧也是同一个顺序：VA 0x00408f28 `[esp+0x30] → 槽 +4`（Y）、
 *   VA 0x00408f34 `[esp+0x3c] → 槽 +6`（X），而 blitter `fcn_00456770`
 *   （VA 0x0040988e/0x00409896）先 push 槽 +6 当**列**、再 push 槽 +4 当**行**。
 *   下面这两个数组的 **`dx` 就是表项 +0（喂 X）、`dy` 是表项 +4（喂 Y）** ——
 *   名字与喂法一一对应，`render.ts` 的 `p.x + t.offsetX` / `p.y + t.offsetY`
 *   即照抄。
 *
 * 数值逐字节核过（`python3 tools/disasm.py dump 0x474951 16 4`，见
 * `throw-fx.test.ts` 那条逐 dword 对照）——8 项围成一圈，半径 22/10。
 * ⚠️ 这一圈与 8 个朝向**不是**简单旋转：它是**逐格手摆的**（X 只取 ±10/±22、
 *   Y 也是），故「它在不在主人背后」这件事**不要按旋转推**，要看
 *   `throw-fx.test.ts` 里那条用 `directionOf` 现算朝向、再与偏移求点积的用例。
 */
export const ATTACHED_OFFSETS: readonly { x: number; y: number }[] = [
  { x: -10, y: -22 },
  { x: -22, y: -10 },
  { x: -22, y: 10 },
  { x: -10, y: 22 },
  { x: 10, y: 22 },
  { x: 22, y: 10 },
  { x: 22, y: -10 },
  { x: 10, y: -22 },
];

/**
 * 主人**已经有神明**时、且附身物是定時炸彈(18) 才用的那一圈 —— 半径放大到 44/18。
 *
 * @source VA 0x004090a9..0x004090dd：
 * ```asm
 * 004090a9  cmp byte [objects_info[i]], 0x12     ; ★ 种类 == 18 定時炸彈？
 *           jne 0x408c65                        ;   不是 → 用上面那张表
 * 004090ba  cmp byte [ownerBase + 0x496ba7], 0   ; ★ 主人 +0x3f = god_info
 *           je  0x408c65                        ;   主人身上没神 → 还是上面那张表
 * 004090cb  eax = dword [esi*8 + 0x474991]      ; 换这一张（+0x40 = 8 项之后）
 * 004090d2  add [esp+0x30], eax                 ; ★ +0 → 屏幕 X（同上面那张）
 * 004090d6  eax = dword [esi*8 + 0x474995]
 * 004090dd  jmp 0x408c7b                        ; → +4 加到屏幕 Y
 * ```
 * 即「主人身上已经有神 ⇒ 炸弹往外挪一圈，别把神挡了」。
 * 表项的 `(X, Y)` 顺序与基址同源，见 `ATTACHED_OFFSETS` 的说明。
 */
export const ATTACHED_OFFSETS_WITH_GOD: readonly { x: number; y: number }[] = [
  { x: -18, y: -44 },
  { x: -44, y: -18 },
  { x: -44, y: 18 },
  { x: -18, y: 44 },
  { x: 18, y: 44 },
  { x: 44, y: 18 },
  { x: 44, y: -18 },
  { x: 18, y: -44 },
];

/**
 * 附身物的**图号** —— 用**主人**的朝向，不是物件自己的。
 *
 * @source VA 0x0040906e..0x00409088：
 * ```asm
 * mov dl, byte [ownerBase + 0x496b78]    ; ★ 主人 +0x10 = direction
 * mov eax, 8 / sub eax, [0x499088]       ; 8 − 视角
 * add eax, edx / and eax, 7              ; 图号 = 8 − 视角 + 主人朝向
 * mov [esp+0x54], eax                    ; ← 同时也是偏移表的下标
 * ```
 */
export function attachedImageIndex(ownerDirection: number, view: number): number {
  return screenDirection(ownerDirection, view);
}

/**
 * 真正贴上去的那一帧 = **图号 + 4**。
 *
 * @source VA 0x0040908c..0x004090a2：
 * ```asm
 * mov dl, byte [esp+0x54]   ; 图号
 * add dl, 4
 * and dl, 7
 * mov byte [槽 + 0x48a853], dl   ; ★ 槽 +7 = 画的时候真正的帧号
 * ```
 * 而消费方 `fcn_00456770(surface, graphics, **[槽+7]**, x, y)`（VA 0x004098a0）
 * 把它当帧号用 —— 所以**神明背对主人**（偏移那一圈它站在主人面朝的方向上）。
 * 对照：放在地上的物件写的是 `+7 = 图号`（VA 0x00408ef2），两者正好差 4。
 */
export function attachedFrameIndex(image: number): number {
  return (image + 4) & 7;
}

/**
 * 附身物这一帧的偏移 —— 定時炸彈(18) 且主人身上已有神时用大圈。
 *
 * @param type      物件种类
 * @param ownerGod  主人的 `godInfo`（**物件下标 + 1**，0 = 没有）
 * @param image     `attachedImageIndex(主人朝向, 视角)`
 */
export function attachedOffset(
  type: number,
  ownerGod: number,
  image: number,
): { x: number; y: number } {
  const table = type === OBJECT_TYPE_TIMEBOMB && ownerGod !== 0
    ? ATTACHED_OFFSETS_WITH_GOD
    : ATTACHED_OFFSETS;
  return table[image & 7] ?? { x: 0, y: 0 };
}

/**
 * 主人此刻**不在地图上**时整个不画。
 *
 * @source VA 0x00408fbd..0x00408fc4：
 * ```asm
 * 00408fb6  eax = (attached − 1) * 0x68          ; 主人记录
 * 00408fbd  cmp dword [eax + 0x496b9a], 0        ; ★ 主人 +0x32 起的**一个 dword**
 * 00408fc4  jne 跳过                              ;   住宿/消失/坐牢/住院 任一非 0 → 不画
 * ```
 * ★ 只比这**四个字节**（+0x32..+0x35），**不含** `days_sleeping`(+0x36) ——
 *   所以冬眠中的人身上照样画着神明（与 `isBlocked` 不是同一条判据）。
 */
export function attachedOwnerVisible(blocking: {
  inHotel: number;
  disappearing: number;
  inPrison: number;
  inHospital: number;
}): boolean {
  return blocking.inHotel === 0
    && blocking.disappearing === 0
    && blocking.inPrison === 0
    && blocking.inHospital === 0;
}

// ============================================================
//  轉向卡（6）飞完之后那一声 —— `0x40c78c` 开头的音效 56
// ============================================================

/**
 * 掉头函数 `0x40c78c` 开头放的音效号。
 * @source 0x0040c793 `push 0` / 0x0040c795 `push 0x4823f2` / 0x0040c79a `call 0x4542ce`；`[0x4823f2]` = **56**。
 *   全 exe 只有两个调用点：轉向卡 0x00443025、魔法屋向後轉 0x004321d0（后者走訊息框的 `closeSfx`）。
 */
export const TURN_AROUND_SFX = 56;

/**
 * 这一次用卡落地之后（卡片飞完 / 不飞就是当场）要不要放掉头那一声。
 *
 * @source 轉向卡函数：出牌台词 0x00442fc1 → 选目标 → 电脑才飞 0x0044301c `animate_object(…, 100)`
 *   （真人 `who_plays == 1` 跳过，0x00442fe4）→ ★ 0x00443025 `call 0x40c78c` = 音效 56 + 掉头 + 重挑来路。
 *   ⇒ 声音在**飞行（含 100 ms 收尾停顿）之后**；判据看状态：有人 / 惡人的朝向真的变了 = 0x40c78c 真的跑了。
 */
export function cardLandSfx(
  cardId: number,
  before: { players: readonly { direction: number }[]; specialActors: readonly { direction: number }[] },
  after: { players: readonly { direction: number }[]; specialActors: readonly { direction: number }[] },
): number | null {
  if (cardId !== 6) return null;
  const turned =
    after.players.some((p, i) => p.direction !== before.players[i]?.direction) ||
    after.specialActors.some((a, i) => a.direction !== before.specialActors[i]?.direction);
  return turned ? TURN_AROUND_SFX : null;
}
