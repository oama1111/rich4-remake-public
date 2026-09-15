/*
 * 右側欄那四页的数值 —— 纯查询，不含任何规则改动
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版的面板是**一页一张 200×280 底图**（`Panel.mkf` 资源 0 的图 0..3），
 * 行标签也是**开局时用代码画进那四张图**的（`rich4_draw_text(页面图, 串, …)`，
 * VA 0x00417eba 起把 12 个标签分别画进 4 个页面图），所以归档资源里只有图标、
 * 没有文字。四页的标签与数值：

 * | 页 | 行1 | 行2 | 行3 |
 * |---|---|---|---|
 * | 0 資金 | 現  金 | 存  款 | 總資產 |
 * | 1 地產 | 土  地 | 連鎖店 | 設  施 |
 * | 2 股票 | 總市值 | 成  本 | 經營權 |
 * | 3 其他 | 點  卷 | 貸  款 | 保險期 |
 *
 * 页号是**每个玩家一份**（`0x48be24 + 玩家号`），由 PgUp/PgDn 那对熱鍵
 * 切换 `(页 ∓ 1) & 3`（VA 0x004014b1 / 0x004014ee）。**点 tag 不换页** ——
 * 标签表 `0x475274` 只在绘制处被引用，没有任何命中判定。
 */

import type { GameState } from './types.ts';
import {
  allEffectiveFacilities,
  allEffectiveLands,
  valuationsOf,
  type MapTopology,
} from './reduce.ts';
import { calculatePlayerWealth } from '../rules/wealth.ts';

/** 面板页数 @source `(页 + 1) & 3` 的回绕范围 */
export const PANEL_PAGE_COUNT = 4;

/** 一页三行的数值，顺序与标签一一对应 */
export type PanelRows = readonly [number, number, number];

export interface PanelPages {
  /** 0 資金：現金 / 存款 / 總資產 */
  funds: PanelRows;
  /** 1 地產：土地 / 連鎖店 / 設施 */
  estate: PanelRows;
  /** 2 股票：總市值 / 成本 / 經營權 */
  stocks: PanelRows;
  /** 3 其他：點卷 / 貸款 / 保險期（天） */
  misc: PanelRows;
}

/**
 * 算出四条页的全部数值（不管当前显示哪页，四页一起给）。
 *
 * 每页的算法逐条照 exe 的四个页处理函数（跳表 `0x415f59`）：
 * ```asm
 * [0] 0x004162d4   資金   [1] 0x00416355   地產
 * [2] 0x0041646c   股票   [3] 0x004165e1   其他
 * ```
 */
export function panelValues(
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
): PanelPages {
  const p = state.players[playerIndex];
  if (p === undefined) {
    const zero: PanelRows = [0, 0, 0];
    return { funds: zero, estate: zero, stocks: zero, misc: zero };
  }

  const lands = allEffectiveLands(state, topo);
  const facilities = allEffectiveFacilities(state, topo);
  const me = playerIndex + 1;

  // ── 0 資金 @source VA 0x004162d4 ──
  //   現金 = player+0x1c、存款 = player+0x20、總資產 = calculate_player_wealth
  const funds: PanelRows = [
    p.cash,
    p.moneyInBank,
    calculatePlayerWealth(p, lands, facilities, valuationsOf(state, playerIndex)),
  ];

  // ── 1 地產 @source VA 0x00416355 ──
  //   原版两个循环共用一个累加器 `[esp+0xac]`：
  //     地块 → 有主的 +1；设施 → 有主的再 +1  ⇒ 行1 其实是**不動產总数**
  //   行2 = 有主的**地块**里 level≠0 的个数；行3 = 有主的**设施**里 level≠0 的个数
  let ownedRealEstate = 0;
  let chainStores = 0;
  for (const land of lands) {
    if (land.owner !== me) continue;
    ownedRealEstate++;
    if (land.level !== 0) chainStores++;
  }
  let developedFacilities = 0;
  for (const fac of facilities) {
    if (fac.owner !== me) continue;
    ownedRealEstate++;
    if (fac.level !== 0) developedFacilities++;
  }
  const estate: PanelRows = [ownedRealEstate, chainStores, developedFacilities];

  // ── 2 股票 @source VA 0x0041646c ──
  //   總市值 = Σ trunc(持股 × 股价)、成本 = Σ trunc(持股 × 均价)（逐支向零取整，
  //   照原版的 x87 写法）；經營權 = 自己是所有人的企業个数
  //
  //   ⚠️ 成本用 `holdings` 的均价，市值用 `valuationsOf` 的实时价 —— 两者来源不同，
  //     别混用（原版也是分开累加的）。
  let marketValue = 0;
  let cost = 0;
  const holdings = state.holdings[playerIndex] ?? [];
  const vals = valuationsOf(state, playerIndex);
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    if (h === undefined) continue;
    const price = vals[i]?.price ?? 0;
    marketValue = Math.trunc(h.amount * price + marketValue);
    cost = Math.trunc(h.amount * h.avgCost + cost);
  }
  let chairmanships = 0;
  for (const own of state.commercialOwners) {
    if (own.owner === me) chairmanships++;
  }
  const stocks: PanelRows = [marketValue, cost, chairmanships];

  // ── 3 其他 @source VA 0x004165e1 ──
  //   點卷 = word player+0x30、貸款 = dword player+0x24、保險期 = byte player+0x3e
  const misc: PanelRows = [p.points, p.loan, p.insuranceDays];

  return { funds, estate, stocks, misc };
}
