/*
 * 請神符（卡 23）的目标 —— 「请**最近**的那尊神」 Q-PICK-2
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 去 exe 核过的结论：**原版没有列表 UI，也没有棋盘拾取窗口**。
 *
 * `rich4_card_qingshenfu.asm` / VA 0x00444e1a 的真身只有两行：
 * ```asm
 * cmp byte [player + 0x15], 1     ; 是不是真人
 * jne short loc_00444e35
 * call fcn_00444d1a               ; ★ 真人：自动挑「最近的物件」
 * ...
 * loc_00444e35:
 * push 0 / call 0x41e6f2          ; 电脑：参数表取值
 * ```
 * 而 `fcn_00444d1a`（VA 0x00444d1a）从头到尾**不碰任何窗口** —— 它只是
 * 把地图上的物件扫一遍、比距离、返回**最近那一个的 handle**（0 = 一个都没有）：
 *
 * ```asm
 * 00444d2b  push -1 / call 0x40a45c     ; 把当前视野的格子摊平进 0x48b8c4
 * 00444d43  mov ax, word [ebx*2 + 0x48b8c4]
 * 00444d4b  test ah, 0x80 / je 下一个    ; 高位 = 「这一格有东西」
 * 00444d5d  and ah, 0x7f / sar eax,8     ; handle = (格值 >> 8) & 0x7f
 * 00444d70  call 0x40ea62 / cmp eax,1    ; ★ 物件种类可附身？（`canAttach`）
 * 00444d8e  cmp byte [objects + 0x5], 0 / jne 下一个   ; 已附身于人的不要
 * 00444db1  movsx edx, word [node]       ; 物件所在节点的 x
 * 00444db4  movsx ecx, word [node + 2]   ; y
 * 00444dc1  mov di, word [player + 8]    ; 当前玩家的 x
 * 00444dca  mov ax, word [player + 0xa]  ; y
 * 00444dda  imul edx,edx / imul eax,eax / add   ; d² = dx² + dy²
 * 00444dea  call 0x4582bc                ; sqrt
 * 00444dfe  jbe 下一个                   ; ★ best <= d 就跳过 → 严格更小才换
 * 00444e08  mov ebp, esi                 ; best = 这一件的 handle
 * ```
 *
 * 所以本引擎照抄：**不问玩家**，直接算「离当前玩家最近的可附身物件」，
 * 拿到 handle 就发 `useCard{cardId:23, target:{kind:'object'}}`。
 * 一个都没有（`ebp` 停在 0）时卡不消耗 —— 原版那张卡的返回值就是 0。
 *
 * ⚠️ 原版扫的是**地图格**（`0x474938` 那张 440 宽的格表被 `0x40a45c` 摊平），
 *   所以等距时取的是**行序在先**的那一格。本引擎按 `(y, x, handle)` 排序
 *   近似那个行序（格表 → 世界坐标的换算没取证，等距时的差异已登记
 *   `docs/deviations/Q-PICK-2.md`）。
 */

import { canAttach, type CardTarget, type GameState, type MapTopology } from '@rich4/core';

/** 請神符的卡号 @source 卡片表第 23 项 → `rich4_card_qingshenfu.asm` */
export const SUMMON_CARD_ID = 23;

/** 一个可以请的物件：handle（下标 + 1）与它离玩家的平方距离 */
export interface ObjectCandidate {
  /** 物件 handle = 下标 + 1（原版 `objects_info` 的 1 基 handle） */
  handle: number;
  /** 平方距离（原版开方后比大小，单调，等价） */
  d2: number;
  /** 物件所在节点的世界坐标 —— 只用于复现原版的**行序** */
  x: number;
  y: number;
}

/**
 * 地图上**此刻能被请**的物件（原版 `0x48b8c4` 那一遍扫描的筛子）。
 *
 * 三条与 exe 一一对应：
 *   - `fcn_0040ea62(handle) == 1` → `canAttach(type)`（`(type<=12 && type!=11) || type==15`）
 *   - `objects[handle-1].f5 == 0` → `attached === 0`（没被别人请走）
 *   - 距离要用节点坐标 → `nodeId !== 0`（不在图上就没法算）
 *
 * `canAttach` 与 `summonableObjects` 都是 core 的既有实现（同一个 `0x40ea62`），
 * 这里直接用，免得规则出现第二份。
 */
export function pickableObjects(
  state: GameState,
  topo: MapTopology,
): ObjectCandidate[] {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return [];
  const here = topo.nodes[me.nodeId - 1];
  if (here === undefined) return [];

  const out: ObjectCandidate[] = [];
  for (let i = 0; i < state.objects.length; i++) {
    const o = state.objects[i];
    if (o === undefined || o.nodeId === 0 || o.attached !== 0) continue;
    if (!canAttach(o.type)) continue;
    const node = topo.nodes[o.nodeId - 1];
    if (node === undefined) continue;
    const dx = node.x - here.x;
    const dy = node.y - here.y;
    out.push({ handle: i + 1, d2: dx * dx + dy * dy, x: node.x, y: node.y });
  }
  return out;
}

/**
 * 請神符会请到哪一尊 —— **纯函数**，返回物件 handle；`0` = 一个都请不到。
 *
 * @source VA 0x00444d1a（见文件头）。距离用**平方**比（原版开方后比，
 * 两者单调等价，而且省掉浮点）。
 */
export function nearestSummonableObject(state: GameState, topo: MapTopology): number {
  const cands = pickableObjects(state, topo);
  // ★ 原版按地图格行序扫，等距取先遇到的 —— 这里按 (y, x, handle) 复现行序
  cands.sort((a, b) => a.y - b.y || a.x - b.x || a.handle - b.handle);
  let best = 0;
  let bestD2 = Infinity;
  for (const c of cands) {
    // @source `jbe` → 只有**严格更近**才换
    if (c.d2 < bestD2) {
      bestD2 = c.d2;
      best = c.handle;
    }
  }
  return best;
}

/** 选中之后要发的 action —— 形状与 `core/state/actions.ts` 的 `useCard` 一致 */
export type UseCardAction = { type: 'useCard'; cardId: number; target: CardTarget };

/**
 * handle → action；`0`（没得请）返回 `null` ⇒ **不发 action、卡不消耗**。
 * 原版此时 `0x444e3f` 的 `test esi,esi / je` 直接跳过扣卡。
 */
export function summonCardAction(objectIndex: number): UseCardAction | null {
  if (!Number.isInteger(objectIndex) || objectIndex <= 0) return null;
  return { type: 'useCard', cardId: SUMMON_CARD_ID, target: { kind: 'object', objectIndex } };
}
