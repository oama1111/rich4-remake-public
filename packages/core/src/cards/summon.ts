/*
 * 請神符（23）与物件附身
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：
 *   卡片本体      VA 0x00444e1a
 *   附身          `attach_object` VA 0x0040ead7
 *   可附身性判定  VA 0x0040ea62
 *
 * 与送神符（22）成对：那张把附身物送走，这张把地图上的物件请到身上。
 */

import type { Player } from '../state/types.ts';
import { objectTypeOf } from '../rules/objects.ts';

/**
 * 地图物件表的结构。
 *
 * @source 基址 **0x00496d08**，每项 24 字节（`byte [i*3*8 + 0x496d08]`）：
 * ```
 * +0x00  type      物件种类（byte）
 * +0x02  nodeId    所在节点（word），0 表示不在地图上
 * +0x04  state     附身后写入：死神(15) 写 13，其余写 7
 * +0x05  attached  附身于谁（玩家下标 + 1），0 表示未附身
 * ```
 *
 * ⚠️ 先前 rules/objects.ts 只记了 type 在偏移 0；nodeId 与 attached
 * 是本次解请神符时补上的。
 */
// 条目大小已在 rules/objects.ts 定义（OBJECT_ENTRY_SIZE = 24），此处不重复导出
export const OBJECT_OFFSET_TYPE = 0x00;
export const OBJECT_OFFSET_NODE = 0x02;
export const OBJECT_OFFSET_STATE = 0x04;
export const OBJECT_OFFSET_ATTACHED = 0x05;

/** 附身后写入 `+0x04` 的状态值 */
export const ATTACH_STATE_REAPER = 13;
export const ATTACH_STATE_NORMAL = 7;
/** 死神的物件类型 */
export const OBJECT_TYPE_REAPER = 15;
/** 惡犬 —— 不可附身 */
export const OBJECT_TYPE_DOG = 11;

/** 地图上的一个物件 */
export interface MapObject {
  /** 物件种类 */
  type: number;
  /** 所在节点；0 表示不在地图上（已被请走或拾取） */
  nodeId: number;
  /** 附身状态值 */
  state: number;
  /** 附身于谁：玩家下标 + 1，0 表示未附身 */
  attached: number;
}

/**
 * 该物件能否被请到身上。
 *
 * @source VA 0x0040ea62：
 * ```asm
 * if (objectIndex == 0) return 0
 * eax = objects[objectIndex - 1].type
 * cmp eax, 0xc / jg  查15
 * cmp eax, 0xb / jne 可附身        ; ★ type <= 12 且 != 11 → 可
 * 查15:
 * cmp eax, 0xf / jne 不可          ; ★ type == 15（死神）→ 可
 * 可附身: edx = 1
 * ```
 *
 * 即 **`(type <= 12 && type !== 11) || type === 15`**。
 *
 * 落在外面的是：惡犬(11)、禮物(13)、寶箱(14)、以及 16 以上的
 * 路障/地雷/定時炸彈——前两类是拾取物，后几类是障碍，都不附身。
 */
export function canAttach(type: number): boolean {
  if (type <= 12) return type !== OBJECT_TYPE_DOG;
  return type === OBJECT_TYPE_REAPER;
}

export type SummonFailure =
  /** 物件下标为 0（原版以 0 表示「无」） */
  | 'noObject'
  /** 该种类不可附身 */
  | 'notAttachable'
  /** 下标越界 */
  | 'outOfRange';

export interface SummonResult {
  ok: boolean;
  reason: SummonFailure | null;
  player: Player;
  objects: MapObject[];
  /** 若原本已有附身物，这里给出它的下标（1 基），供调用方走送神流程 */
  displaced: number;
}

/**
 * 把一个地图物件请到玩家身上。
 *
 * 原版流程（VA 0x0040ead7）：
 * ```asm
 * if (objectIndex == 0) return
 * if (!can_attach(objectIndex)) return
 * i = objectIndex - 1
 * type = objects[i].type
 * objects[i].nodeId = 0                 ; ★ 先从地图上摘掉
 * if (player.god_info != 0)
 *     call 0x40e32c(player)             ; ★ 已有附身物则先送走
 * player.god_info = objectIndex + 1     ; ★ 存的是**下标 + 1**
 * objects[i].nodeId   = player.node_id  ; 物件跟到玩家身上
 * objects[i].attached = player + 1
 * objects[i].state    = (type == 15) ? 13 : 7
 * ```
 *
 * ★ `god_info = 下标 + 1`：`0x40eb55` 先把入参（1 基 handle）`dec` 成
 *   0 基下标，存的时候 `inc al` 还原——所以 `god_info` 就等于**入参 handle**。
 *   这印证了 `rules/objects.ts` 早先从送神符推出的结论——两张卡各自
 *   独立给出同一个编码。（本函数早先误写成 `objectIndex + 1`，
 *   对照 0x40eb55 修正。）
 *
 * ⚠️ 「先送走旧的」只返回 `displaced` 交给调用方，本函数不代为执行——
 *   送神流程另有动画与副作用，属于更外层的职责。
 * ⚠️ 本函数只搬字段，**不加三项修正**；要完整语义用
 *   `rules/object-landing.ts` 的 `attachGod`（registry 走的就是它）。
 */
export function attachObject(
  player: Player,
  objects: readonly MapObject[],
  objectIndex: number,
): SummonResult {
  const fail = (reason: SummonFailure): SummonResult => ({
    ok: false,
    reason,
    player,
    objects: [...objects],
    displaced: 0,
  });

  // ⚠️ 见 `applySummonCard` 的说明：請神符的正式实现是 `attachGod`，
  //   本函数的功能是它的**真子集**（缺旧神送走 / 三项修正 / 搭档登场）。
  // @source test edx, edx / je 结束
  if (objectIndex === 0) return fail('noObject');
  const i = objectIndex - 1;
  const obj = objects[i];
  if (obj === undefined) return fail('outOfRange');
  if (!canAttach(obj.type)) return fail('notAttachable');

  const displaced = player.godInfo;

  const next = [...objects];
  next[i] = {
    ...obj,
    // @source word [i*24 + 0x496d0a] = player.node_id
    nodeId: player.nodeId,
    // @source byte [i*24 + 0x496d0d] = player + 1
    attached: player.index + 1,
    // @source cmp esi, 0xf / 13 : 7
    state: obj.type === OBJECT_TYPE_REAPER ? ATTACH_STATE_REAPER : ATTACH_STATE_NORMAL,
  };

  return {
    ok: true,
    reason: null,
    // @source 0x40eb55：入参 handle 先 dec 成 0 基下标，存 god_info 时 inc 还原
    //   —— god_info 值 == 入参 handle（下标 + 1）
    player: { ...player, godInfo: objectIndex },
    objects: next,
    displaced,
  };
}

/**
 * 使用請神符 —— **已被 `rules/god-power.ts` 的 `attachGod` 取代**。
 *
 * ⚠️ **不要接这条**。請神符（卡 23）在 `cards/registry.ts` 里走的是
 *   `attachGod`（@source 0x0040ead7 的完整版）：它除了这里的附身三件事，
 *   还会**把旧神送走**（0x40eb3e）、重算三项修正（0x0040ebcc 起）、
 *   处理「搭档登场」（`respawn`），并带上 `tools`/`toolStock`。
 *   本函数只是最初那版薄壳，功能**比 `attachGod` 少**，留着仅作
 *   `attachObject` 的单元测试入口。
 *
 * 卡片本体（VA 0x00444e1a）在附身之前还做了一件事：把物件的 `nodeId`
 * 暂存后清零、播完飞过来的动画、再写回——那是**纯表现**，
 * 目的只是动画期间别把物件画在原地。core 不需要复现，
 * 直接走 `attachObject` 即可。
 *
 * ⚠️ 目标物件由外部选择（原版是 `0x41e6f2` 的 AI 选择路径，
 *   见 card-registry 的 `selection: 'ai'`）。
 */
export function applySummonCard(
  player: Player,
  objects: readonly MapObject[],
  objectIndex: number,
): SummonResult {
  return attachObject(player, objects, objectIndex);
}

/** 地图上还站着、且可被请的物件下标（1 基） */
export function summonableObjects(objects: readonly MapObject[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o === undefined) continue;
    // 已被人附身或不在地图上的，不能再请
    if (o.attached !== 0 || o.nodeId === 0) continue;
    if (canAttach(o.type)) out.push(i + 1);
  }
  return out;
}

/** 由物件表构造初始布局——`objectTypeOf` 给出各下标的种类 */
export function makeObjects(count: number): MapObject[] {
  return Array.from({ length: count }, (_, i) => ({
    type: objectTypeOf(i),
    nodeId: 0,
    state: 0,
    attached: 0,
  }));
}
