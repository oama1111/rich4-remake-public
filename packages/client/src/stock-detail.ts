/*
 * 股市 —— **上市公司資訊**详情卡（T-030b）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 股市屏（T-030）里点「上市公司資訊」、或在选中那一行上再点一下会开这张卡
 * （@source `loc_0042b0b7` / `loc_0042b1a4` 都 `PostMessage(0x40b)`，
 * 由 `loc_0042b203` → `Wait_0402_Message(fcn_00429d65, 选中行−1)` 打开）。
 *
 * ## 一张卡 = 资源 75 的图 2 + 一堆运行时画的数字
 *
 * 整张卡是 `Panel.mkf` 资源 75 的**图 2**（587×375），贴到 **(26,52)**
 * （@source `loc_00429dae` 的 `push 0x34 / push 0x1a / add eax,0x24`）。
 * 卡上的**文字标签烘在图里**（入口函数写进图 2，见下），运行时只画数字。
 *
 * | 是什么 | 落点（屏幕）| @source |
 * |---|---|---|
 * | 股票名（20 号白字，居中）| (320,82) | `loc_00429dae` 的 `push 0x52 / push 0x140` |
 * | 企业图标（图 `索引`，80×112）| (50,107) | 同上 `push 0x6b / push 0x32` |
 *
 * 三列数值，全部 **16 号白字、flag 6（右对齐）**，右边缘 x = **309 / 453 / 589**：
 *
 * | y | 左列（标签在 x=186）| 中列（369）| 右列（505）|
 * |---|---|---|---|
 * | 123 | `本月盈餘` = 企業 +0x28（`companyFunds`）| `成交價` | `交易量`（`%d`，f10）|
 * | 162 | `平均盈餘` = +0x2c ÷ 總天數（`companyProfit / totalDays`）| `漲  跌` | `漲跌幅`（现价与开盘之差 ÷ 开盘 × 100，`%.2f`）|
 * | 203 | `經 營 者` = 業主名字（**居中** x=269）| `週均價`（近 6 日）| `月均價`（近 24 日）|
 * | 243 | — | — | `歷史高價`（144 日最大）|
 * | 283 | — | — | `歷史低價`（144 日最小）|
 *
 * ★ 那三个均价与高低都是**扫历史环形缓冲**（`[0x497328]`，每支 **144** 个 float）：
 * 均价从「今天往前」数 6 / 24 个**非零**项取平均，高低扫满 144 项。
 * `test dword [..], 0x7fffffff / je 跳过` —— 去掉符号位后为 0 的算「没写过」。
 *
 * ## 半年走势线（`loc_0042a724` 起）
 *
 * 白色 1px 折线，画在卡片左下那条色带上：
 *
 * ```
 * mid = (最高 + 最低) / 2                        ; [0x46405c] = 0.5
 * if (最高 − 最低) / mid > 0.3 → scale = 109 / (最高 − 最低)
 *                              else scale = 109 / (mid × 0.6)
 * x 从 92.0 起、每点 +2.0；y = 324 − (价 − mid) × scale
 * 从「今天」那一格起画，**遇到 ±0 就停**，最多 144 点
 * ```
 *
 * ## 持股比例（`loc_0042a324` 起，GDI 的 Pie）
 *
 * 一个圆心 (502,365)、半径 (88,29) 的饼：`ratio = 自己的持股 ÷ 10000`
 * （[0x464020]），从**正上方**起顺时针。角 = `π/2 − ratio × 2π`，
 * 端点 = `(502 + 88·cos, 365 − 29·sin)`。
 *
 * | ratio | 画法 |
 * |---|---|
 * | 0 < r < 1 | 深红 `0xd00000` 扇（自己那份）+ 深蓝 `0x0000d0` 扇（其余）|
 * | r == 0 | 整个椭圆深红 + 上方那条 `(414,336)-(591,394)` 的深红椭圆 |
 * | r ≥ 1 | 同样两个椭圆，换深蓝 |
 *
 * 外框是黑 1px 的椭圆 `(414,343)-(591,401)`，另外两侧各一道短竖线
 * `(414,365)-(414,372)`、`(590,365)-(590,372)`。
 *
 * ## 关掉
 *
 * 这一屏**没有可点的东西**：0x202 / 0x205（左键或右键**抬起**）都直接
 * `Post_0402_Message(0)` 退卡（@source `loc_0042aa08`）。
 * 它也不收 mousemove，所以没有悬停态。
 */

import type { GameState } from '@rich4/core';
import type { ArchiveName, Sprite } from './assets.ts';
import { comma, magnitudeClass, priceText } from './stock-screen.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type DetailSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 图集就是股市那一份 @source `read_mkf(panel, 0x4b, …)` */
export const DETAIL_RESOURCE = 75;
/** 详情卡那张图 @source `loc_00429dae` 的 `add eax, 0x24`（图 2）*/
export const DETAIL_IMAGE = 2;
/** 贴到 (26,52)，尺寸 587×375 @source `push 0x34 / push 0x1a` */
export const DETAIL_ORIGIN = { x: 0x1a, y: 0x34 } as const;
export const DETAIL_SIZE = { w: 587, h: 375 } as const;

/** 股票名 @source `push 0x52 / push 0x140`，20 号白字居中 */
export const DETAIL_TITLE = { x: 0x140, y: 0x52, size: 0x14 } as const;
/** 企业图标 @source `push 0x6b / push 0x32` */
export const DETAIL_ICON = { x: 0x32, y: 0x6b } as const;

/** 三列数值的**右边缘** x @source 各 `draw_text` 的第 3 个 push */
export const DETAIL_VALUE_X = { c1: 0x135, c2: 0x1c5, c3: 0x24d } as const;
/** 五行数值的 y @source `push 0x7b / 0xa2 / 0xcb / 0xf3 / 0x11b` */
export const DETAIL_VALUE_Y = [0x7b, 0xa2, 0xcb, 0xf3, 0x11b] as const;
/** 「經營者」那一格是**居中**画的 @source `push 0xcb / push 0x10d` */
export const DETAIL_BOSS_X = 0x10d;

/** 走势线 @source `loc_0042a724` 起 */
export const DETAIL_CHART = {
  /** 起点 x（0x42b80000 = 92.0f）*/
  x0: 92,
  /** 每点步长（[0x464084] = 2.0f）*/
  step: 2,
  /** 中线 y（[0x464080] = 324.0f）*/
  midY: 324,
  /** 半高（[0x464074] = 109.0f）*/
  half: 109,
  /** 波动够大就用「109 ÷ 价差」@source `fcomp [0x464064]` = 0.3 */
  wideRatio: 0.3,
  /** 否则用「109 ÷ (中线 × 0.6)」@source `fmul [0x46406c]` = 0.6 */
  narrowScale: 0.6,
  /** 历史天数 @source 环形缓冲 144 项 */
  days: 144,
  /** 週/月均价各取几项 @source `cmp esi, 6` / `cmp esi, 0x18` */
  week: 6,
  month: 0x18,
} as const;

/** 持股比例那个饼 @source `loc_0042a324` 起 */
export const DETAIL_PIE = {
  cx: 502,
  cy: 365,
  rx: 88,
  ry: 29,
  /** 外框椭圆 @source `Ellipse(414,343,591,401)` */
  box: { left: 0x19e, top: 0x157, right: 0x24f, bottom: 0x191 },
  /** 上面那条「厚度」椭圆 @source `Ellipse(414,336,591,394)` */
  topBox: { left: 0x19e, top: 0x150, right: 0x24f, bottom: 0x18a },
  /** 两道短竖线 @source `MoveToEx/LineTo` */
  ticks: [
    { x: 0x19e, y0: 0x16d, y1: 0x174 },
    { x: 0x24e, y0: 0x16d, y1: 0x174 },
  ],
  /** `ratio = 持股 ÷ 10000` @source `fdiv [0x464020]` */
  totalShares: 10000,
  /** 自己那份 / 其余 */
  mine: '#d00000',
  rest: '#0000d0',
} as const;

/**
 * **企业图标索引表** —— `0x475530`，每张地图 12 字节（= 12 个行業別，1 基），
 * 共 8 张地图 96 字节，逐字节 dump 自 exe。
 *
 * @source `loc_00429dae`：`行 = 地圖號（[0x4991b6]*4 + [0x4991b8]）`、
 *   `列 = 企業.行業別 − 1`（`mov bl, byte [esi+0x1a]`）。
 *
 * ★ 表里的值**就是资源 75 的图号**（不是偏移）—— 地图 0 的銀行是 `3`、
 *   汽車是 `6`、航空是 `11`；图 3 正是那栋带 `$` 的银行、图 6 是那辆汽车
 *   （导出来对过）。两个特殊值才是**算式**：
 *   - `0x0f` → `+ (企業.股票下標 − 3)`（@source `sub eax, 3`）
 *   - `0x18` → `+ (企業.股票下標 − 2)`（@source `sub eax, 2`）
 *
 * 图标本体是资源 75 的图 **3..28**（26 张 80×112）。
 */
export const DETAIL_ICON_TABLE: readonly number[] = [
  11, 0, 7, 5, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 0
  11, 0, 7, 5, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 1
  11, 0, 8, 5, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 2
  11, 0, 7, 5, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 3
  11, 0, 7, 12, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 4
  11, 23, 7, 14, 6, 9, 3, 0, 0, 4, 10, 15, // 地图 5
  11, 0, 7, 13, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 6
  11, 24, 7, 5, 6, 9, 3, 0, 0, 4, 10, 0, // 地图 7
] as const;

/**
 * 某张企业图标该用图几。
 *
 * @param globalMapId 地图号（= `game_stage * 4 + game_map`）
 * @param type 企業.行業別（1 基）
 * @param stockIndex 企業对应的股票下标（`commercial + 0x19`）
 * @returns 资源 75 的**图号**（表里就是图号，直接返回）
 */
export function iconImageOf(globalMapId: number, type: number, stockIndex: number): number {
  const row = Math.max(0, Math.min(7, Math.trunc(globalMapId))) * 12;
  const col = Math.trunc(type) - 1;
  let v = col >= 0 && col < 12 ? (DETAIL_ICON_TABLE[row + col] ?? 0) : 0;
  if (v === 0x0f) v += stockIndex - 3;
  else if (v === 0x18) v += stockIndex - 2;
  return Math.max(0, v);
}

// ============================================================
//  历史统计
// ============================================================

/**
 * 一项历史价「写过没有」—— 去掉符号位为 0 就是没写过 @source `test eax, 0x7fffffff`。
 *
 * ⚠️ 要**看浮点的位模式**，不是把值转成整数：`-0.0` 与 `+0.0` 都算没写过，
 *   而 `1e-4` 这种小到不像价格的值仍然算写过（原版就是这么判的）。
 */
const BITS = new Int32Array(1);
const FLOAT = new Float32Array(BITS.buffer);
export function historyFilled(v: number): boolean {
  FLOAT[0] = v;
  return (BITS[0]! & 0x7fffffff) !== 0;
}

/** 从 `day` 往前数 `count` 个**非零**项取平均；一个都没有返回 0 @source `loc_0042a147` */
export function recentAverage(history: readonly number[], day: number, count: number): number {
  const days = DETAIL_CHART.days;
  let sum = 0;
  let n = 0;
  let i = Math.trunc(day);
  for (let k = 0; k < count; k++) {
    i = i - 1;
    if (i < 0) i = days - 1;
    const v = history[i] ?? 0;
    if (!historyFilled(v)) continue;
    sum += v;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** 144 日的最高/最低 @source `loc_0042a2b3`（最低的初值 10000.0f）*/
export function historyRange(history: readonly number[]): { high: number; low: number } {
  let high = 0;
  let low = 10000;
  for (let i = 0; i < DETAIL_CHART.days; i++) {
    const v = history[i] ?? 0;
    if (!historyFilled(v)) continue;
    if (v > high) high = v;
    if (v < low) low = v;
  }
  return { high, low };
}

/** 走势线的纵向比例 @source `loc_0042a724` 起那两路 */
export function chartScale(high: number, low: number): number {
  const mid = (high + low) * 0.5;
  const span = high - low;
  if (mid <= 0) return 0;
  if (span / mid > DETAIL_CHART.wideRatio) return span === 0 ? 0 : DETAIL_CHART.half / span;
  return DETAIL_CHART.half / (mid * DETAIL_CHART.narrowScale);
}

/** 走势线的点（最多 144 个，遇到没写过的就停）@source `loc_0042a834` 那圈 */
export function chartPoints(
  history: readonly number[],
  day: number,
  high: number,
  low: number,
): { x: number; y: number }[] {
  const mid = (high + low) * 0.5;
  const scale = chartScale(high, low);
  const days = DETAIL_CHART.days;
  // 起点：今天那一格写过就从今天起，否则从头
  let i = historyFilled(history[day] ?? 0) ? Math.trunc(day) : 0;
  const out: { x: number; y: number }[] = [];
  let x = DETAIL_CHART.x0;
  for (let n = 0; n < days; n++) {
    const v = history[i] ?? 0;
    if (!historyFilled(v)) break;
    out.push({
      x: Math.trunc(x),
      y: Math.trunc(DETAIL_CHART.midY - (v - mid) * scale),
    });
    i = (i + 1) % days;
    x += DETAIL_CHART.step;
  }
  return out;
}

/** 饼图那一刀切到哪儿（原点在正上方，顺时针）@source `loc_0042a324` */
export function pieEnd(ratio: number): { x: number; y: number } {
  const angle = Math.PI / 2 - ratio * Math.PI * 2;
  return {
    x: Math.round(DETAIL_PIE.cx + DETAIL_PIE.rx * Math.cos(angle)),
    y: Math.round(DETAIL_PIE.cy - DETAIL_PIE.ry * Math.sin(angle)),
  };
}

// ============================================================
//  从局面取一张卡
// ============================================================

/** 卡上要画的东西（数字都已经格式化成串）*/
export interface StockDetailView {
  /** 股票名 */
  name: string;
  /** 企业图标图号 */
  icon: number;
  /** 五行 × 三列的数字；`null` = 这一格不画 */
  cells: readonly (readonly (string | null)[])[];
  /** 「經營者」那一格（居中画）*/
  boss: string | null;
  /** 走势线的点 */
  chart: readonly { x: number; y: number }[];
  /** 持股比例 = 自己的持股 ÷ 10000 */
  ratio: number;
}

/** 一格都没有对应的企业时，那三行留空 */
const NO_COMMERCIAL: readonly (string | null)[] = [null, null, null];

/**
 * 摊出一张卡。
 *
 * @param stockIndex 选中那一支（0 基）
 * @param player 看这张卡的人（持股比例按他算）
 * @param names 12 支股票的名字（core 的状态不带名字，见 `stock-screen.ts`）
 * @param playerNames 各玩家的名字（「經營者」用）
 * @param commType 该股对应的企業的行業別与股票下标（没企业时给 null）
 */
export function stockDetailFrom(
  state: GameState,
  stockIndex: number,
  player: number,
  names: readonly string[],
  playerNames: readonly string[],
  commType: { type: number; stockIndex: number } | null,
): StockDetailView | null {
  const stock = state.market.stocks[stockIndex];
  if (stock === undefined) return null;
  const cls = magnitudeClass(stock.price);
  const history = state.market.history[stockIndex] ?? [];
  const comm = stock.commercialIndex;
  const days = state.totalDays;

  const funds = state.companyFunds[comm] ?? 0;
  const profit = state.companyProfit[comm] ?? 0;
  const owner = state.commercialOwners[comm]?.owner ?? 0;

  const month = recentAverage(history, state.market.day, DETAIL_CHART.week);
  const quarter = recentAverage(history, state.market.day, DETAIL_CHART.month);
  const { high, low } = historyRange(history);

  const chg = stock.price - stock.openPrice;
  const chgPct = stock.openPrice === 0 ? 0 : (chg / stock.openPrice) * 100;
  const dec = cls === 0 ? 2 : cls === 1 ? 1 : 0;

  const cells: (readonly (string | null)[])[] = [
    // 第 1 行：本月盈餘 / 成交價 / 交易量
    [comma(funds), priceText(stock.price), String(stock.f10)],
    // 第 2 行：平均盈餘 / 漲跌 / 漲跌幅
    [
      comma(days === 0 ? profit : Math.trunc(profit / days)),
      `${chg < 0 ? '-' : '+'}${Math.abs(chg).toFixed(dec)}`,
      chgPct.toFixed(2),
    ],
    // 第 3 行：經營者（另画）/ 週均價 / 月均價
    [null, month.toFixed(dec), quarter.toFixed(dec)],
    // 第 4/5 行：歷史高低
    NO_COMMERCIAL,
    NO_COMMERCIAL,
  ];
  if (high !== 0 || low !== 10000) {
    cells[3] = [null, null, high.toFixed(dec)];
    cells[4] = [null, null, low === 10000 ? (0).toFixed(dec) : low.toFixed(dec)];
  }

  const mine = state.holdings[player]?.[stockIndex]?.amount ?? 0;
  return {
    name: names[stockIndex] ?? '',
    icon: commType === null ? 0 : iconImageOf(state.globalMapId, commType.type, commType.stockIndex),
    cells,
    boss: owner === 0 ? null : (playerNames[owner - 1] ?? null),
    chart: chartPoints(history, state.market.day, high, low),
    ratio: mine / DETAIL_PIE.totalShares,
  };
}

// ============================================================
//  画
// ============================================================

const FONT = '"PingFang TC", "Microsoft JhengHei", sans-serif';

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  align: CanvasTextAlign,
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/**
 * 画这张卡（坐标就是**屏幕**坐标，卡贴在 (26,52)）。
 *
 * ⚠️ 原版这一屏用 GDI 直接画（`GetDC` + `Pie` / `Ellipse` / `MoveToEx` + 白笔折线），
 * 这里用 canvas 等价地画：折线一条 `Path2D`，饼图两段 `arc` + 两个 `ellipse`。
 */
export function drawStockDetail(
  ctx: CanvasRenderingContext2D,
  sprite: DetailSprite,
  view: StockDetailView,
): void {
  const ox = DETAIL_ORIGIN.x;
  const oy = DETAIL_ORIGIN.y;

  const card = sprite('Panel.mkf', DETAIL_RESOURCE, DETAIL_IMAGE, false);
  if (card !== null) ctx.drawImage(card.bitmap, ox, oy);

  text(ctx, view.name, DETAIL_TITLE.x, DETAIL_TITLE.y, DETAIL_TITLE.size, '#f0f0f0', 'center');

  const icon = sprite('Panel.mkf', DETAIL_RESOURCE, view.icon, true);
  if (icon !== null) ctx.drawImage(icon.bitmap, DETAIL_ICON.x, DETAIL_ICON.y);

  const cols = [DETAIL_VALUE_X.c1, DETAIL_VALUE_X.c2, DETAIL_VALUE_X.c3];
  for (let r = 0; r < view.cells.length && r < DETAIL_VALUE_Y.length; r++) {
    const row = view.cells[r]!;
    const y = DETAIL_VALUE_Y[r]!;
    for (let c = 0; c < cols.length; c++) {
      const v = row[c];
      if (v === undefined || v === null) continue;
      text(ctx, v, cols[c]!, y, 16, '#f0f0f0', 'right');
    }
  }
  if (view.boss !== null) {
    text(ctx, view.boss, DETAIL_BOSS_X, DETAIL_VALUE_Y[2]!, 16, '#f0f0f0', 'center');
  }

  // ── 半年走势线：白 1px 折线 @source `loc_0042a724` 起的 MoveToEx/LineTo 圈 ──
  const pts = view.chart;
  if (pts.length > 0) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i === 0) ctx.moveTo(p.x + 0.5, p.y + 0.5);
      else ctx.lineTo(p.x + 0.5, p.y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPie(ctx, view.ratio);
}

/** 持股比例那个饼 @source `loc_0042a324` / `loc_0042a658` / `loc_0042a6c2` */
function drawPie(ctx: CanvasRenderingContext2D, ratio: number): void {
  const { cx, cy, rx, ry, box, topBox, ticks, mine, rest } = DETAIL_PIE;
  const ellipse = (b: { left: number; top: number; right: number; bottom: number }, fill: string): void => {
    ctx.beginPath();
    ctx.ellipse(
      (b.left + b.right) / 2, (b.top + b.bottom) / 2,
      (b.right - b.left) / 2, (b.bottom - b.top) / 2,
      0, 0, Math.PI * 2,
    );
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (ratio > 0 && ratio < 1) {
    // 两份扇：从正上方顺时针，自己那份是深红
    const end = pieEnd(ratio);
    const top = { x: cx, y: cy - ry };
    const wedge = (from: { x: number; y: number }, to: { x: number; y: number }, fill: string): void => {
      const a0 = Math.atan2((from.y - cy) / ry, (from.x - cx) / rx);
      const a1 = Math.atan2((to.y - cy) / ry, (to.x - cx) / rx);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, a0, a1, false);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    wedge(top, end, mine);
    wedge(end, top, rest);
  } else if (ratio === 0) {
    ellipse(box, mine);
    ellipse(topBox, mine);
  } else {
    ellipse(box, rest);
    ellipse(topBox, rest);
  }

  // 外框 + 两道短竖线
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    (box.left + box.right) / 2, (box.top + box.bottom) / 2,
    (box.right - box.left) / 2, (box.bottom - box.top) / 2,
    0, 0, Math.PI * 2,
  );
  ctx.stroke();
  ctx.beginPath();
  for (const t of ticks) {
    ctx.moveTo(t.x + 0.5, t.y0);
    ctx.lineTo(t.x + 0.5, t.y1);
  }
  ctx.stroke();
  ctx.restore();
}
