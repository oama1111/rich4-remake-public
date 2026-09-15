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
 * 页号是**每个玩家一份**（`0x48be24 + 玩家号`）。三条切换通路：
 *   - PgUp/PgDn 熱鍵 → `(页 ∓ 1) & 3`（VA 0x004014b1 / 0x004014ee）；
 *   - **点右上角那四条彩色竖条** → 页号 = `y / 70`（VA 0x004182fa）。
 *
 * ★ 先前这里写着「点 tag 不换页」，**是错的** —— 依据是「标签表 `0x475274`
 *   只在绘制处被引用」。但原版根本不用那张表做命中判定，而是拿**坐标**算：
 *   `x ≥ 616 且 y < 280` 就按 `y / 70` 换页。`0x475274` 只是那四页的**名字**。
 *   （2026-09-15 经需求方提醒后回 exe 复核，见 `known-deviations.md` 的 Q-PANEL-1。）
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
 * 個人資產表（S7）中列那四条计数 —— 土地 / 連鎖店 / 房屋 / 設施。
 *
 * @source VA 0x00423583（地块循环）与 0x004235c3（设施循环）：
 * ```asm
 * 地块: cmp byte [eax+0x19], 我+1 / jne skip      ; 只算我名下的
 *       inc [esp+0x80]                            ; ★ 两个循环**共用**这一个累加器
 *       cmp byte [eax+0x18], 0 / je +            ; type（連鎖店/房屋）
 *       inc esi                                   ; 行2 連鎖店 = type ≠ 0
 *       cmp byte [eax+0x1a], 0 / je skip          ; level
 *       inc edi                                   ; 行3 房屋 = type==0 且 level ≠ 0
 * 设施: inc [esp+0x80] / cmp byte [eax+0x1a],0 / inc ebp   ; 行4 設施 = level ≠ 0
 * ```
 * ★ 两个循环共用累加器，所以**行1「土地」其实是不動產总数**（地块 + 设施），
 *   侧栏地產页的「土地」行也是这么算的（VA 0x00416355 的 `[esp+0xac]`）。
 * ★ 行2 的判据是**地块的 `type`（+0x18）**，不是 `level` —— `land.h` 写明
 *   `+0x18: chained store or house`。
 */
export function assetCounts(
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
): readonly [number, number, number, number] {
  const me = playerIndex + 1;
  let total = 0;
  let chainStores = 0;
  let houses = 0;
  for (const land of allEffectiveLands(state, topo)) {
    if (land.owner !== me) continue;
    total++;
    if (land.type !== 0) chainStores++;
    else if (land.level !== 0) houses++;
  }
  let developedFacilities = 0;
  for (const fac of allEffectiveFacilities(state, topo)) {
    if (fac.owner !== me) continue;
    total++;
    if (fac.level !== 0) developedFacilities++;
  }
  return [total, chainStores, houses, developedFacilities];
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
  //   侧栏这页只取個人資產表那四条的**前三/第四条**（见 `assetCounts`）。
  const counts = assetCounts(state, topo, playerIndex);
  const estate: PanelRows = [counts[0], counts[1], counts[3]];

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
