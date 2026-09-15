/*
 * 「这一步会不会生效」的预演 —— AI 与 UI 候选高亮**共用同一份**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么要有这个模块：目标选择（选哪块地 / 哪个玩家 / 哪一格）是**表现层**的事
 *   （C-ARC-2，见 `cards/target.ts` 头部）。但 UI 得知道「光标底下这个目标
 *   算不算数」—— 那是**规则**，不能搬到 client 去重写一遍。
 *
 *   所以规则仍然只有一份：`cards/registry.ts` 的 `useCard` 与 `reduce.ts` 的
 *   `useToolAction` 本来就是纯函数，这里只是把它们包成「会不会生效」的问句。
 *   AI 出牌前的 `willWork` 原本自己拼上下文，现在也走这里，两边不会漂移。
 *
 * ⚠️ 预演**不消耗、不改状态**：`useToolAction` 被拒时原样返回传入的 state，
 *   故「返回值 !== 原 state」就是「会生效」的判据。
 */

import type { CardTarget } from '../cards/target.ts';
import { useCard, type UseCardContext } from '../cards/registry.ts';
import { allEffectiveFacilities, allEffectiveLands, type MapTopology } from './reduce.ts';
import { marketOpenOn } from '../places/stock-market.ts';
import { useToolAction } from './reduce.ts';
import type { GameState } from './types.ts';

/**
 * 从 `(state, topo)` 拼出 `useCard` 的上下文。
 *
 * @param scapegoatPicker 嫁祸卡的新目标选择器；缺省放弃转嫁（`-1`）。
 *   UI 若要做「嫁祸时再选一次」，把选择器传进来即可。
 */
export function cardUseContext(
  state: GameState,
  topo: MapTopology,
  scapegoatPicker: (from: number) => number = () => -1,
): UseCardContext {
  return {
    players: state.players,
    lands: allEffectiveLands(state, topo),
    nodes: topo.nodes,
    currentPlayer: state.currentPlayer,
    priceIndex: state.priceIndex,
    tools: state.tools,
    toolStock: state.toolStock,
    objects: state.objects,
    market: state.market,
    marketOpen: marketOpenOn(state.globalMapId, state.year, state.month, state.day),
    facilities: allEffectiveFacilities(state, topo),
    actors: state.specialActors,
    scapegoatPicker,
  };
}

/**
 * 这张卡对这个目标**会不会生效**（空跑一遍规则，不改任何状态）。
 *
 * ★ 「不生效」不止一种原因：目标类别不对、目标本身不合法（比如換地卡选到
 *   别人的地）、或者效果算下来没变化。**原版的拾取也是这么判的** ——
 *   它的每卡额外规则表（VA 0x445e2d 那张 8 路跳表）与各卡实现是同一件事。
 */
export function canUseCard(
  state: GameState,
  topo: MapTopology,
  cardId: number,
  target: CardTarget = { kind: 'none' },
  scapegoatPicker?: (from: number) => number,
): boolean {
  const ctx =
    scapegoatPicker === undefined
      ? cardUseContext(state, topo)
      : cardUseContext(state, topo, scapegoatPicker);
  return useCard(ctx, cardId, target).ok;
}

/**
 * 这件道具对这个目标会不会生效。
 *
 * @param nodeId 放置类/飛彈/機器工人/傳送機/工程車的目标格
 * @param value  遙控骰子的点数，或傳送機的第二个参数
 */
export function canUseTool(
  state: GameState,
  topo: MapTopology,
  toolId: number,
  nodeId = 0,
  value = 0,
): boolean {
  return useToolAction(state, topo, toolId, nodeId, value) !== state;
}
