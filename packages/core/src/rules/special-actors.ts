/*
 * 替身走子 —— 棋盘上除四个玩家之外还会走路的那五个
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的「当前行动者」`[0x49910c]` **不止 0..3**：
 *
 * ```
 *   0..3  四个玩家
 *   4..7  小偷 / 強盜 / 流氓 / 間諜 —— 蹲在監獄里，被人保釋出来就上路
 *   8     機器娃娃（道具 1）
 * ```
 *
 *   这五个共用一张表 `_rich4_all_special_players_state` @ **0x498e28**，
 *   **步长 16，下标 = actor − 4**，五项正好 80 字节。
 *
 * ```c
 * struct special_player {   // 16 字节
 *   uint16 x;            // +0
 *   uint16 y;            // +2
 *   uint16 node_id;      // +4   ← 落点处理就是从这里取格子的
 *   uint16 last_node_id; // +6
 *   uint8  owner;        // +8   ★ 主人（玩家下标）
 *   uint8  direction;    // +9
 *   uint8  f10;          // +10
 *   uint8  state;        // +11  出獄置 1；节点类型 == 4 时 |= 0x80
 *   uint8  f12_13[2];    // +12..13
 *   uint8  halted;       // +14  非 0 → 这一步不走，收场
 *   uint8  single_step;  // +15  非 0 → 只走一步
 * };
 * ```
 *
 *   ⚠️ **known-deviations 的 Q-OBJ-3 里写的「`[0x498dec]` 步长 16，
 *   `+4` 记着主人是谁」有两处错**，本模块按 exe 改正：
 *   - `0x498dec` 是**把 actor（而非 actor−4）乘 16 之后**的基址，
 *     即 `0x498dec + actor*16 == 0x498e28 + (actor−4)*16`，同一张表；
 *   - **`+4` 是 `node_id`，`+8` 才是主人**。
 *     证据：落点处理 VA 0x0041b472 `mov si, word [actor*16 + 0x498dec]`
 *     取到的值随即被当作节点号去查 `[0x498e80]` 那张节点表。
 *
 * ★ 而 Q-OBJ-3 里「8 = 飞行物，一路清掉沿途物件」这条**是对的，
 *   只是没认出它就是機器娃娃**。见下面 `ACTOR_DOLL`。
 */

import type { GameState } from '../state/types.ts';
import type { MapObject } from '../cards/summon.ts';
import type { WatcomRng } from '../rng/watcom.ts';

// ============================================================
//  谁是替身
// ============================================================

/** 替身的 actor 号从 4 起 */
export const SPECIAL_ACTOR_BASE = 4;
/** 一共五个：四个 NPC + 機器娃娃 @source 表 0x498e28 共 5 × 16 字节 */
export const SPECIAL_ACTOR_COUNT = 5;

/**
 * 機器娃娃 = **actor 8**。
 * @source `mov dword [0x49910c], 8`（VA 0x00446b94，道具 1 的使用处理）
 */
export const ACTOR_DOLL = 8;

/** 四个 NPC 的 actor 号，与監獄占用表的槽 4..7 是**同一批人** */
export const NPC_ACTORS: readonly number[] = [4, 5, 6, 7];

/**
 * 四个 NPC 的名字，与 `rules/visit.ts` 的 `INMATE_NAMES` 同源同序。
 * @source 名字表 0x0046662c 起，每项 5 字节
 */
export const NPC_NAMES: readonly string[] = ['小偷', '強盜', '流氓', '間諜'];

/** actor 号 → 表下标；不是替身返回 −1 */
export function specialSlotOf(actor: number): number {
  const slot = actor - SPECIAL_ACTOR_BASE;
  return slot >= 0 && slot < SPECIAL_ACTOR_COUNT ? slot : -1;
}

/** 是不是替身（4..8） */
export function isSpecialActor(actor: number): boolean {
  return specialSlotOf(actor) >= 0;
}

// ============================================================
//  状态
// ============================================================

/**
 * 一个替身。**只保留规则用得上的字段** —— 原版那 16 字节里
 * `x/y` 是给动画用的插值坐标，本引擎由 `nodeId` 现算，不进状态（C-ARC-2）。
 */
export interface SpecialActor {
  /** 所在节点号；**0 = 不在场** */
  nodeId: number;
  /** 上一格，用来防止掉头 */
  lastNodeId: number;
  /** 朝向 0..7 */
  direction: number;
  /**
   * 主人（玩家下标）。
   *
   * - 機器娃娃：用道具的那个人（@source 0x00446b7b `[0x498e70] = [0x49910c]`）
   * - NPC：**把他保釋出来的那个人**（@source 0x0043d7e6，同一条赋值）
   */
  owner: number;
  /** 还剩几步 */
  stepsRemaining: number;
}

/** 不在场的替身 */
export function idleActor(): SpecialActor {
  return { nodeId: 0, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: 0 };
}

/** 开局的五个空位 */
export function initialSpecialActors(): SpecialActor[] {
  return Array.from({ length: SPECIAL_ACTOR_COUNT }, idleActor);
}

/** 这个替身在不在场上 */
export function actorActive(a: SpecialActor | undefined): boolean {
  return a !== undefined && a.nodeId > 0;
}

// ============================================================
//  走几步
// ============================================================

/**
 * 機器娃娃**固定走 9 步**。
 *
 * @source VA 0x0040deb9 —— actor 8 那一路根本不掷骰子：
 * ```asm
 * 0040deb9  mov esi, 9
 * 0040debe  mov dword [0x48baf8], esi        ; 剩余步数 = 9
 * 0040dec4  mov byte [actor*0x34 + 0x498ea2], 1
 * 0040decb  mov dword [0x4749d4], esi        ; 动画/音效索引也用 9
 * ```
 */
export const DOLL_STEPS = 9;

/**
 * NPC 走 `rand() % 9 + 2` 步，即 **2..10 步**。
 *
 * @source VA 0x0040de50（actor 4..7 那一路）：
 * ```asm
 * 0040de50  call 0x456f2d                    ; rand()
 * 0040de57  mov ecx, 9 / idiv ecx
 * 0040de61  add edx, 2
 * 0040de64  mov dword [0x48baf8], edx        ; 剩余步数
 * ```
 *
 * ⚠️ **不掷骰子** —— 用的是裸 `rand()`，与玩家的掷骰是两条路。
 */
export const NPC_STEP_MIN = 2;
export const NPC_STEP_SPAN = 9;

export function npcSteps(rng: WatcomRng): number {
  return (rng.next() % NPC_STEP_SPAN) + NPC_STEP_MIN;
}

// ============================================================
//  上路
// ============================================================

/**
 * 用道具 1，把機器娃娃放到主人脚下。
 *
 * @source VA 0x00446b3e 起，整段就是**把主人的位置原样抄一份**：
 * ```asm
 * 00446b3e  [0x498e68] = player.+0x08    ; x
 * 00446b4b  [0x498e6a] = player.+0x0a    ; y
 * 00446b59  [0x498e6c] = player.+0x0c    ; node_id
 * 00446b67  [0x498e6e] = player.+0x0e    ; last_node_id
 * 00446b75  [0x498e70] = [0x49910c]      ; ★ owner = 用道具的人
 * 00446b81  [0x498e71] = player.+0x10    ; direction
 * 00446b8e  [0x498e72] = 0
 * 00446b94  [0x49910c] = 8               ; 行动者切成娃娃
 * 00446b9e  call 0x40dd1f                ; 起步
 * ```
 *
 * ★ 注意 `0x498e68 = 0x498e28 + 64`，即**下标 4** —— actor 8 − 4 = 4。
 *   这是「表按 actor−4 索引」最直接的一条证据。
 */
export function spawnDoll(state: GameState, owner: number): SpecialActor | null {
  const p = state.players[owner];
  if (p === undefined) return null;
  if (p.nodeId <= 0) return null;
  return {
    nodeId: p.nodeId,
    lastNodeId: p.lastNodeId,
    direction: p.direction,
    owner,
    stepsRemaining: DOLL_STEPS,
  };
}

/**
 * 保釋 NPC 出獄 —— 他从**監獄那一格**起步，主人记成保釋他的人。
 *
 * @source `_rich4_release_player_from_prison` 的 slot >= 4 分支（VA 0x0043d7e0）：
 * ```asm
 * 0043d7e0  eax = (slot - 4) * 16
 * 0043d7e6  [eax + 0x498e30] = [0x49910c]   ; +8  owner = 當前玩家
 * 0043d7f0  [eax + 0x498e32] = 0            ; +10
 * 0043d7f9  [eax + 0x498e2c] = [0x48bae0]   ; +4  node_id = 監獄节点
 * 0043d801  [eax + 0x498e2e] = 0            ; +6  last_node = 0 ← ★ 出獄那一步没有「来路」
 * 0043d80a  [eax + 0x498e28] = node.x       ; +0
 * 0043d82b  [eax + 0x498e2a] = node.y       ; +2
 * 0043d833  [eax + 0x498e33] = 1            ; +11 state
 * 0043d84e  if ((node.flags & 0xff) == 4) [eax + 0x498e33] |= 0x80
 * 0043d87b  [0x496b30 + slot] = 0           ; 監獄占用表清空
 * ```
 *
 * ⚠️ `last_node = 0` 是有讲究的：`pickNextNode` 拿 `prev === 0` 当
 *   「没有来路」，于是出獄第一步**四个方向都可以走**，不受「不走回头路」限制。
 */
export function releaseNpc(prisonNodeId: number, owner: number, steps: number): SpecialActor {
  return {
    nodeId: prisonNodeId,
    lastNodeId: 0,
    direction: 0,
    owner,
    stepsRemaining: steps,
  };
}

// ============================================================
//  機器娃娃的落点效果：把沿途的物件一路扫光
// ============================================================

/**
 * 機器娃娃踩到一格时做什么 —— **只做一件事：把这一格上的物件清掉**。
 *
 * @source 落点处理 VA 0x0041b4e7，在种类跳表**之前**就被截住：
 * ```asm
 * 0041b4e7  eax = [0x49910c]
 * 0041b4ec  cmp eax, 8
 * 0041b4ef  jne 0x41b536                    ; 不是娃娃 → 走正常那一路
 * 0041b4f1  if (这一格没有物件) goto 结束
 * 0041b4ff  push [0x498e6e]                 ; 娃娃的 last_node
 * 0041b50a  push [0x498e6c]                 ; 娃娃的 node_id
 * 0041b519  call 0x40fafd(物件下标, node, last)  ; 把物件「打飞」的动画
 * 0041b529  call 0x40e14d(物件下标)             ; ★ 释放物件
 * 0041b531  goto 结束                            ; ★ 不再走种类跳表
 * ```
 *
 * ★ 所以娃娃**不吃禮物、不中地雷、不被神明附身、也不会被路障拦下**，
 *   它就是一台**清道夫**：沿路九格，见物件就轰走。
 *   `0x40fafd` 算的是一个速度向量（当前格 − 上一格）× 常数，
 *   写进物件表的 `+0x08..+0x14` 四个 float —— 纯动画，不进 core。
 */
export function dollSweepNode(objects: readonly MapObject[], nodeId: number): MapObject[] | null {
  const at = objects.findIndex((o) => o.nodeId === nodeId);
  if (at === -1) return null;
  const next = objects.map((o, i) =>
    i === at ? { ...o, nodeId: 0, state: 0, attached: 0 } : o,
  );
  return next;
}

/**
 * 走完整条路 —— 逐格前进并清物件。
 *
 * `advance` 由调用方给（`reduce.ts` 的 `pickNextNode`），
 * 这样本模块不依赖地图拓扑，也就不用在 core 内部再绕一圈。
 */
export interface SweepResult {
  actor: SpecialActor;
  objects: MapObject[];
  /** 被扫掉的物件下标，按清除顺序 */
  cleared: number[];
  /** 走过的节点，含起点 */
  path: number[];
}

export function runDoll(
  actor: SpecialActor,
  objects: readonly MapObject[],
  advance: (from: number, prev: number) => number,
): SweepResult {
  let cur = actor.nodeId;
  let prev = actor.lastNodeId;
  let objs = objects.map((o) => ({ ...o }));
  const cleared: number[] = [];
  const path: number[] = [cur];

  for (let step = 0; step < actor.stepsRemaining; step++) {
    const next = advance(cur, prev);
    if (next <= 0 || next === cur) break;
    prev = cur;
    cur = next;
    path.push(cur);
    const at = objs.findIndex((o) => o.nodeId === cur);
    const swept = dollSweepNode(objs, cur);
    if (swept !== null) {
      cleared.push(at);
      objs = swept;
    }
  }

  return {
    // ★ 走完就收场：原版把 actor 切回玩家，替身记录不再参与落点处理
    actor: idleActor(),
    objects: objs,
    cleared,
    path,
  };
}
