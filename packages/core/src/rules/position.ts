/*
 * 玩家在棋盘上的「位置三元组」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版把「站在哪一格」记在**三个字段**里，它们必须一起变：
 *   `player+0x0c` = `node_id`、`player+0x08` = `xpos`、`player+0x0a` = `ypos`。
 *
 * **实测（两份真实存档，8/8）**：每一个**站在格子上**的玩家，`xpos/ypos`
 * 都**精确等于该节点的 `x/y`**；`node_id == 0`（不在盘上）的那些则是 `0/0`：
 *
 * ★★ **一个例外（2026-09-18 第 86 条）**：**被关押期间** `x/y` 取的是
 *   **特殊景观记录**（監獄 → 记录 2「綠島」、醫院 → 记录 1「醫院大樓」，
 *   `@source 0x43d643 mov si, word [eax+0x38]`/`0x43ecef`），与 `node_id`
 *   所在的監獄/醫院格**不是同一个地方** —— 原版的 `x/y` 本就是**贴图位置**，
 *   `node_id` 才是逻辑所在格。复刻照抄（见 `rules/confinement.ts`），
 *   并在「走回棋盘」那一回合的收尾把 `x/y` 同步回节点坐标
 *   （原版是走路例程逐帧改回去的）。⇒ 不变量应表述为
 *   「**不在押、也不在走回棋盘那一回合**时 `x/y == node.x/y`」。
 *   `state/full-game.test.ts` 的运行时哨兵就是按这个口径写的。
 *
 * ```text
 * Save0 玩家0: xpos/ypos=1935/1039  node(60).x/y=1935/1039
 * Save0 玩家1: xpos/ypos=1215/1120  node(87).x/y=1215/1120
 * SAVE1 玩家1..3: nodeId=0  ⇒ xpos/ypos=0/0
 * ```
 *
 * ## 为什么必须维护它（不是"可选的渲染细节"）
 *
 * 原版有一批**判据直接用 `xpos != 0` 当「在不在盘上」的哨兵**：
 *   · 冬眠卡：`@source 0x0044415d` `cmp word [player+0x08], 0 / je skip`
 *     （见 `cards/hibernate.ts`）；
 *   · 大地图画人：`@source 0x0040a8b0` `cmp word [player+0x08], 0`
 *     （见 `client/big-map-screen.ts`）。
 * ⇒ 只要 `xpos` 不跟着 `node_id` 走，这些判据就会**把在场玩家当成不在场**。
 *
 * ⚠️ 本引擎的移动是**按节点**的（一步一格、走完才落点），不需要复刻原版
 *   逐像素的中间态；**落点时**把三项写成「节点坐标」即可 —— 这正是
 *   `rules/teleport.ts` 一直在做的（`@source 0x004477e2` 同时写 `node_id` 与 `x/y`）。
 */

import type { MapNode } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';

/**
 * 把玩家放到**一个已知的节点记录**上（`node === undefined` ⇒ 视为不在盘上）。
 *
 * 三项**原子**更新：`nodeId` / `xpos` / `ypos`。返回新对象，不改入参。
 */
export function placeOnNode(p: Player, node: MapNode | undefined): Player {
  if (node === undefined) {
    return { ...p, nodeId: 0, xpos: 0, ypos: 0 };
  }
  return { ...p, nodeId: node.id, xpos: node.x, ypos: node.y };
}

/**
 * 按节点号放置（`nodeId <= 0` 或越界 ⇒ 不在盘上，三项清 0）。
 *
 * `nodes` 是**从 0 开始**的节点数组（下标 = 节点号 − 1），与 `MapTopology.nodes` 同形。
 */
export function placeOnNodeId(p: Player, nodes: readonly MapNode[], nodeId: number): Player {
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return { ...p, nodeId: 0, xpos: 0, ypos: 0 };
  }
  return placeOnNode(p, nodes[nodeId - 1]);
}

/**
 * 玩家此刻**是否在棋盘上**。
 *
 * ⚠️ 判据用 `nodeId`（本引擎的权威字段），**不要**用 `xpos != 0` ——
 * 原版那样写是因为它没有别的"在不在盘上"字段；本引擎有 `nodeId`，
 * 而 `xpos` 只是它的派生坐标（改 `nodeId` 而忘了同步 `xpos` 时，
 * 用 `nodeId` 判据仍然正确）。
 */
export function isOnBoard(p: Player): boolean {
  return p.nodeId > 0;
}
