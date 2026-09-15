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
 */

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

/** 这条动效总共要播多久（毫秒）= 帧数 × 24 + 100 收尾 */
export function throwTotalMs(frames: number): number {
  return Math.max(1, frames) * THROW_FRAME_MS + THROW_SETTLE_MS;
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
  /** 飞的那一件在 `state.objects` 里的下标（静态层要把它藏起来，别画两遍） */
  objectIndex: number;
  /** 物件种类（16 路障 / 17 地雷 / 18 定時炸彈）→ 查图集 */
  type: number;
  /** 物件朝向（见 `objectFacing`）→ 决定画哪一张 */
  facing: number;
  /** 屏幕起点 = 角色位置 */
  from: ScreenPoint;
  /** 屏幕终点 = 目标格 */
  to: ScreenPoint;
  /** 帧数 = `throwFrameCount(Δx, Δy)` */
  frames: number;
  /** 起播时刻（`performance.now()`） */
  start: number;
}

/** 造一条投掷 —— 帧数在这里按 exe 的公式定死一次 */
export function makeObjectFlight(args: {
  objectIndex: number;
  type: number;
  facing: number;
  from: ScreenPoint;
  to: ScreenPoint;
  start: number;
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
  return now - f.start >= throwTotalMs(f.frames);
}

/** 这一帧还没画完（还要再排一帧）*/
export function flightRunning(f: ObjectFlight, now: number): boolean {
  return !flightDone(f, now);
}
