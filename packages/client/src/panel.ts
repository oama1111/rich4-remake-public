/*
 * 右側欄四页的**文字** —— 量在 core（`panelValues`），这里只负责排版
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只把 core 算好的数翻成字符串，不含任何规则。
 *
 * 每页三行的**格式**也要照原版 —— 同一页里各行用的函数可能不同：
 *
 * | 页 | 行1 | 行2 | 行3 |
 * |---|---|---|---|
 * | 資金 | `num_to_currency_string` | 同左 | 同左 |
 * | 地產 | `itoa` | 同左 | 同左 |
 * | 股票 | `num_to_currency_string` | 同左 | `itoa` |
 * | 其他 | `itoa` | `num_to_currency_string` | `sprintf("%d天")` |
 *
 * @source 四个页处理函数 VA 0x004162d4 / 0x00416355 / 0x0041646c / 0x004165e1；
 *   货币格式串是 `"$%d"` 那一类（`rich4_num_to_currency_string`，VA 0x00452793），
 *   天数是 `"%d天"`（串表 `0x463902`）。
 */

import { PANEL_PAGE_COUNT, panelValues, type GameState, type MapTopology } from '@rich4/core';

/**
 * ★ 第十九份（iPhone 发烫）：側欄每帧都格式化这几行，`toLocaleString('en-US')` 每次都现建一个
 *   `Intl.NumberFormat`（实测是每帧 JS 里最重的一项）。同一 locale、同一（缺省）选项的
 *   `NumberFormat#format` 按规范就是 `Number#toLocaleString` 的实现 —— 输出逐字相同。
 */
const EN_US = new Intl.NumberFormat('en-US');

/** 货币串 —— 原版 `rich4_num_to_currency_string` 输出带千分位的 `$` 前缀 */
export const currency = (n: number): string => `$${EN_US.format(n)}`;

/** 某一页三行的最终文字，顺序与标签一一对应 */
export function panelRows(
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
  page: number,
): readonly [string, string, string] {
  const v = panelValues(state, topo, playerIndex);
  switch (((page % PANEL_PAGE_COUNT) + PANEL_PAGE_COUNT) % PANEL_PAGE_COUNT) {
    case 0: // 資金：現金 / 存款 / 總資產
      return [currency(v.funds[0]), currency(v.funds[1]), currency(v.funds[2])];
    case 1: // 地產：土地 / 連鎖店 / 設施
      return [String(v.estate[0]), String(v.estate[1]), String(v.estate[2])];
    case 2: // 股票：總市值 / 成本 / 經營權
      return [currency(v.stocks[0]), currency(v.stocks[1]), String(v.stocks[2])];
    default: // 其他：點卷 / 貸款 / 保險期
      return [String(v.misc[0]), currency(v.misc[1]), `${v.misc[2]}天`];
  }
}
