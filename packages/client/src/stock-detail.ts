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
 * ⚠️ 图标与底图都是**不透明**贴的（`fcn_004563f5`，@source `call 0x4563f5` @0x00429dae /
 * @0x00429f25）—— 资源 75 是 **SMP**（无 alpha），抠黑会把電子那台显示器屏镂空。
 *
 * ## ★ 两支：**有上市公司** / **没有上市公司**
 *
 * 贴完底图、画完股票名之后立刻分叉 @source `fcn_00429d65` 的
 * `mov dx, word [eax + (_stocks_on_map + 4)]` / `test dx, dx` / `je near loc_00429fc5`：
 * 股票记录 **+4 = 1 基企业序号，0 = 这支股票没有上市公司**（与 `stock-screen.ts`
 * 的 `listed` 同一个判据）。
 *
 * | 画什么 | 有公司（`dx != 0`）| 没有公司（`dx == 0`）|
 * |---|---|---|
 * | 企业图标 (50,107) | 表 `0x475530` 查出的图号 | **整格不画** @source `loc_00429f05` |
 * | (309,123) `本月盈餘` | `currency(企業+0x28)` | **整格不画** |
 * | (309,162) `平均盈餘` | `currency(企業+0x2c ÷ 總天數)` | **整格不画** |
 * | (269,203) `經 營 者` | 業主名（`企業+0x18 != 0` 才画）| **整格不画** |
 * | 右列那 8 个数字 | 一样 | 一样 |
 *
 * 分叉点在 `loc_00429dae` 的尾巴：`mov edx,[eax+0x496984] / test dx,dx / je 0x429fc5`
 * （@source VA **0x00429e9a**–**0x00429ea3**）—— 没有公司直接跳去 `loc_00429fc5`
 * （跳过图标与左列三格）；有公司则画完图标与左列、若業主为 0 再跳一次
 * （@source VA **0x00429f99** 的 `cmp byte [esi+0x18],0` / `je 0x429fc5`，只跳掉「經營者」）。
 * ⇒ **没有公司时卡上只剩右侧那 8 个数字**（左下三格与图标全空）；
 * 底图、走势线、持股饼图都照旧 —— 原版**没有**第二张「简版卡」底图。
 *
 * 三列数值，全部 **16 号白字、flag 6（右对齐）**，右边缘 x = **309 / 453 / 589**：
 *
 * | y | 左列（标签在 x=186）| 中列（369）| 右列（505）|
 * |---|---|---|---|
 * | 123 | `本月盈餘` = 企業 +0x28（`companyFunds`）★ | `成交價` | `交易量`（`%d`，f10）|
 * | 162 | `平均盈餘` = +0x2c ÷ 總天數（`companyProfit / totalDays`）★ | `漲  跌` | `漲跌幅`（现价与开盘之差 ÷ 开盘 × 100，`%.2f`）|
 * | 203 | `經 營 者` = 業主名字（**居中** x=269）★ | `週均價`（近 6 日）| `月均價`（近 24 日）|
 * | 243 | — | — | `歷史高價`（144 日最大）|
 * | 283 | — | — | `歷史低價`（144 日最小）|
 *
 * ★ = **只有那一支有上市公司时才画**（见上「两支」）。「漲跌」与「漲跌幅」
 * 的位数不同：涨跌跟**成交價**一样走 `0x475524` 那张 `%+.*f` 表（同一枚 `dec`），
 * 漲跌幅恒为 `%.2f`（`ref_00463f64`）。
 *
 * ⚠️ 右列那三个统计**无条件画**：高低价各扫满 144 格后**原样 sprintf**
 * （初值 `高 = 0.0f`、`低 = 10000.0f`，@source VA 0x0042a290 / 0x0042a299），
 * 一格历史都没有时就照打 `0` 与 `10000`；一个非零项都没有的均价照打 **`-nan`**
 * （原版 `fild 计数` + `fdivr` = `0/0`，Watcom 的 `_cvt` 把那个负 QNaN 写成 `-nan`
 * —— 见 `fixedOrNan` 与 `docs/deviations/Q-STOCK-6.md` 的 d）。
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
 * 折线画完还有**两个价格标签**（@source `loc_0042a8bf` 起那两段，**12 号**白字）：
 * 最高价右对齐到 **x=88**、y = 折线最高点的 y **− 8**；最低价同样 x=88、
 * y = 折线最低点的 y **+ 8**（就是折线左右两端旁边的价签）。它们与高低价格子一样
 * **无条件画**，两支都有。
 *
 * ## 持股比例（`loc_0042a324` 起，GDI 的 Pie）
 *
 * 一个圆心 (502,365)、半径 (88,29) 的饼：`ratio = 自己的持股 ÷ 10000`
 * （[0x464020]），从**正上方**起顺时针。角 = `π/2 − ratio × 2π`，
 * 端点 = `(502 + 88·cos, 365 − 29·sin)`。
 *
 * ⚠️ **颜色是 COLORREF（`0x00BBGGRR`）**，别照 `#rrggbb` 读：
 * `0xd00000` = `RGB(0,0,208)` 是**深蓝**、`0xd0` = `RGB(208,0,0)` 是**深红**。
 * `持股 ÷ 10000` 那一份（自己那份）是**深红** `0xd0`（@source `push 0xd0` @0x0042a586），
 * 其余那一份是**深蓝** `0xd00000`（@source `push 0xd00000` @0x0042a50a）。
 *
 * | ratio | 地盘（`box` 椭圆）| 两段扇 / 上盘（`topBox` 椭圆）|
 * |---|---|---|
 * | 0 < r < 1 | 深蓝 `0xd00000` @0x0042a542 | 深红扇 = r 那一份（Pie@0x0042a5d3）+ 深蓝扇 = 其余（Pie@0x0042a580）|
 * | r == 0 | 深蓝 `0xd00000` @0x0042a681 | 深蓝 `0xd00000` @0x0042a71d |
 * | r ≥ 1 | 深红 `0xd0` @0x0042a6e1 | 深红 `0xd0` @0x0042a71d |
 *
 * 三支都是**两个椭圆**（`box` = (414,343)-(591,401) 是「厚度」底盘，
 * `topBox` = (414,336)-(591,394) 是饼本身，两者同尺寸、只差 7px 纵向平移）；
 * 三支都先画两道「厚度」端帽短竖线 `(414,365)-(414,372)`、`(590,365)-(590,372)`
 * （@source 0x0042a3e9 / 0x0042a41d）。笔是黑 1px（`CreatePen(0,1,0)` @0x0042a3cc），
 * 所以两个椭圆各自还有一圈**黑描边**（`Ellipse` 与 `Pie` 都描边）。
 *
 * `0 < r < 1` 那一支还有两件东西（本轮补上，取证见 `docs/deviations/Q-STOCK-6.md`）：
 *
 * 1. 先铺**一整块**深蓝底盘椭圆 `(414,343)-(591,401)`（@source 0x0042a526）——
 *    被上面两张扇盖住后，只在下缘露出那条**7px 厚的月牙**（就是「厚度」）。
 * 2. 之后一道 `FloodFill(dc, 589, 374, 0)`（**涂黑**，@source 0x0042a638）：
 *    种子 (589,374) 正好落在那条月牙上、且在端点竖线**右边**，
 *    于是月牙的**右半截**被涂黑（没有端点竖线时整条月牙连通、一起变黑）。
 *
 * 端点在**下半**（`yend ≥ 365`）时原版还从端点往下再画 7px 竖线
 * （@source 0x0042a5da 的 `cmp eax,0x16d` / 0x0042a5fd 的 `add eax,7`）——
 * 它正好把月牙切开，就是上面 FloodFill 的那道左边界。
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
import { FONT_FAMILY } from './font.ts';

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

/**
 * 走势线旁边那两个价签 @source `loc_0042a8bf` 起的两段 `draw_text`：
 * `push 0xc` 建的是 **12 号**字（其余数值格是 16 号），`push 0x58` = x=88（右对齐），
 * y = 折线端点的 y ∓ 8（@source VA 0x0042a952 的 `sub eax,8`、0x0042a9b9 的 `add eax,8`）。
 */
export const DETAIL_CHART_TAG = { x: 0x58, size: 0xc, gap: 8 } as const;

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
  /** 「厚度」底盘椭圆 @source `Ellipse(414,343,591,401)` @0x0042a526（三支都画）*/
  box: { left: 0x19e, top: 0x157, right: 0x24f, bottom: 0x191 },
  /** 饼本身 / 两段扇的 bounding box @source `Pie(…,414,336,591,394,…)` @0x0042a580 */
  topBox: { left: 0x19e, top: 0x150, right: 0x24f, bottom: 0x18a },
  /** 两道「厚度」端帽短竖线 @source `MoveToEx/LineTo` @0x0042a3e9 / @0x0042a41d */
  ticks: [
    { x: 0x19e, y0: 0x16d, y1: 0x174 },
    { x: 0x24e, y0: 0x16d, y1: 0x174 },
  ],
  /**
   * 底盘与饼的纵向平移量 = 7px（`box` 比 `topBox` 低 7）——
   * 月牙厚度、端点竖线长度（@source `add eax,7` @0x0042a5fd）都是它。
   */
  thickness: 7,
  /** `ratio = 持股 ÷ 10000` @source `fdiv [0x464020]` */
  totalShares: 10000,
  /**
   * `FloodFill(dc,589,374,0)` 的两道闸 @source 0x0042a611–0x0042a632：
   * `ratio > 0.25`（@source qword 0x464054）且端点 x `< 589`（0x24d）。
   */
  floodRatio: 0.25,
  /** 那道 FloodFill 的种子像素 @source `push 0x176 / push 0x24d` @0x0042a63a */
  floodSeed: { x: 0x24d, y: 0x176 },
  /**
   * 自己那份 / 其余 —— **COLORREF 是 `0x00BBGGRR`**：
   * `0xd0` = RGB(208,0,0) 深红（自己那份），`0xd00000` = RGB(0,0,208) 深蓝（其余）。
   */
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

/**
 * 从 `day` 往前数 `count` 个**非零**项取平均 @source `loc_0042a147`（週）/ `loc_0042a1f8`（月）
 *
 * ★ **一个非零项都没有时原版出的是 NaN，不是 0**：原版把计数也压进栈再
 * `fild 计数`、`fdivr 求和`（週 @source 0x0042a194 / 0x0042a19b；
 * 月 @source 0x0042a245 / 0x0042a24c），
 * 计数为 0 时就是 `0/0` → x87 的 **QNaN indefinite**（`0xFFC00000`，**符号位是 1**）。
 * 那一格照 `sprintf(表 0x475518[dec])` 打出来是 **`-nan`**（Watcom 自己的 `_cvt`
 * @0x0045c3b2 写 `nan` + 负号；取证见 `docs/deviations/Q-STOCK-6.md` 的 d）。
 */
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
  return n === 0 ? NaN : sum / n;
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

/**
 * 数值格那一步 `sprintf`（表 `0x475518` 的 `%.*f`）。
 *
 * ★ **NaN 打出来是 `-nan`**，不是 `0`、也不是 JS 的 `NaN`：原版走的 Watcom 自带
 * `_cvt`（@source 0x45c3b2，由 FP 支持初始化入口 0x459ce1 从表 0x4898d8 装上，
 * 没装时那份桩函数是 0x45c4fb 的 `Floating-point support not loaded`），
 * 它把非数写成小写 `nan`（@source 0x45d55d 的 `mov byte [eax],0x6e` = 'n'…'n'），
 * 而 x87 的 `0/0` 给的是**符号位为 1** 的 QNaN indefinite → 又补一个 `-`（@source 0x45c494）。
 *
 * @source 取表 0x475518 的那两处 `sprintf`：週均價 @0x0042a1bc、月均價 @0x0042a26d
 *   （两个计数/除法在 @0x0042a194 `fild` / @0x0042a19b `fdivr` 与
 *   @0x0042a245 `fild` / @0x0042a24c `fdivr`）
 */
export function fixedOrNan(v: number, dec: number): string {
  return Number.isNaN(v) ? '-nan' : v.toFixed(dec);
}

/** 走势线的纵向比例 @source `loc_0042a724` 起那两路 */
export function chartScale(high: number, low: number): number {
  const mid = (high + low) * 0.5;
  const span = high - low;
  if (mid <= 0) return 0;
  if (span / mid > DETAIL_CHART.wideRatio) return span === 0 ? 0 : DETAIL_CHART.half / span;
  return DETAIL_CHART.half / (mid * DETAIL_CHART.narrowScale);
}

/** 某个价在走势线上的 y @source `loc_0042a834` 那两段（`fsubr 324` 后截断）*/
export function chartYAt(high: number, low: number, v: number): number {
  const mid = (high + low) * 0.5;
  return Math.trunc(DETAIL_CHART.midY - (v - mid) * chartScale(high, low));
}

/** 走势线的点（最多 144 个，遇到没写过的就停）@source `loc_0042a834` 那圈 */
export function chartPoints(
  history: readonly number[],
  day: number,
  high: number,
  low: number,
): { x: number; y: number }[] {
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
      y: chartYAt(high, low, v),
    });
    i = (i + 1) % days;
    x += DETAIL_CHART.step;
  }
  return out;
}

/**
 * 饼图那一刀切到哪儿（原点在正上方，顺时针）@source `loc_0042a324` 起
 *
 * `角 = π/2 − ratio × 2π`（@source `fmul [0x464024]`=2π、`fsubr [0x46402c]`=π/2），
 * 端点 = `(502 + 88·cos, 365 − 29·sin)`（@source 0x464034/0x46403c/0x464044/0x46404c），
 * 两个坐标都经 `__round_toward_zero` @0x0042a4fe / @0x0042a503
 * —— **截断朝零**（不是四舍五入），端点 x 还要拿去和 589 比（FloodFill 那道闸）。
 */
export function pieEnd(ratio: number): { x: number; y: number } {
  const angle = Math.PI / 2 - ratio * Math.PI * 2;
  return {
    x: Math.trunc(DETAIL_PIE.cx + DETAIL_PIE.rx * Math.cos(angle)),
    y: Math.trunc(DETAIL_PIE.cy - DETAIL_PIE.ry * Math.sin(angle)),
  };
}

// ============================================================
//  从局面取一张卡
// ============================================================

/** 卡上要画的东西（数字都已经格式化成串）*/
export interface StockDetailView {
  /** 股票名 */
  name: string;
  /**
   * 这支股票有没有上市公司（股票记录 +4 != 0）。
   * 没有 → 左列三格与图标都不画，就是原版的**简版卡**。
   */
  listed: boolean;
  /**
   * 企业图标图号；**`null` = 这一格不画**。
   *
   * ⚠️ 没有上市公司时原版**整格跳过**（那条路根本没走到 `loc_00429f05` 的贴图）；
   * 给 0 会被当成「图 0」，而资源 75 的图 0/1 是**两张 640×480 的整屏页**，
   * 一贴就把整张卡盖掉 —— 那就是需求方看到的「弹窗错误」。
   */
  icon: number | null;
  /** 五行 × 三列的数字；`null` = 这一格不画 */
  cells: readonly (readonly (string | null)[])[];
  /** 「經營者」那一格（居中画）*/
  boss: string | null;
  /** 走势线的点 */
  chart: readonly { x: number; y: number }[];
  /**
   * 走势线旁边那两个价签（12 号字、右对齐到 x=88、上下各离折线端点 8px）
   * @source `loc_0042a8bf` 起那两段 —— **两支都画**，没有「没历史就不画」这一说。
   */
  chartLabels: {
    high: string;
    highY: number;
    low: string;
    lowY: number;
  };
  /** 持股比例 = 自己的持股 ÷ 10000 */
  ratio: number;
}

/**
 * 摊出一张卡。
 *
 * ★ 股票记录 +4 为 0（没有上市公司）时走**简版卡**：图标与左列三格都不画，
 * 右列那 8 个数字照旧（@source `loc_00429dae` 尾部的 `je near loc_00429fc5`）。
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
  // ★ 「这支股票有没有上市公司」= 记录 +4 是否为 0，与股市屏的 listed 同一判据
  const listed = comm !== 0;
  const days = state.totalDays;

  // 没有上市公司时**一个企业字段都不读** —— 企业表是 1 基的，下标 0 是垃圾
  const funds = listed ? state.companyFunds[comm] ?? 0 : 0;
  const profit = listed ? state.companyProfit[comm] ?? 0 : 0;
  const owner = listed ? state.commercialOwners[comm]?.owner ?? 0 : 0;

  const week = recentAverage(history, state.market.day, DETAIL_CHART.week);
  const month = recentAverage(history, state.market.day, DETAIL_CHART.month);
  const { high, low } = historyRange(history);

  const chg = stock.price - stock.openPrice;
  const chgPct = stock.openPrice === 0 ? 0 : (chg / stock.openPrice) * 100;
  const dec = cls === 0 ? 2 : cls === 1 ? 1 : 0;

  const cells: (readonly (string | null)[])[] = [
    // 第 1 行：本月盈餘（★ 只有上市公司才有）/ 成交價 / 交易量
    [listed ? comma(funds) : null, priceText(stock.price), String(stock.f10)],
    // 第 2 行：平均盈餘（★ 只有上市公司才有）/ 漲跌 / 漲跌幅
    [
      listed ? comma(days === 0 ? profit : Math.trunc(profit / days)) : null,
      `${chg < 0 ? '-' : '+'}${Math.abs(chg).toFixed(dec)}`,
      chgPct.toFixed(2),
    ],
    // 第 3 行：經營者（另画）/ 週均價 / 月均價
    [null, fixedOrNan(week, dec), fixedOrNan(month, dec)],
    // 第 4/5 行：歷史高低 —— ★ 原版**无条件画**（初值 0 与 10000.0f 原样 sprintf）
    [null, null, high.toFixed(dec)],
    [null, null, low.toFixed(dec)],
  ];

  const mine = state.holdings[player]?.[stockIndex]?.amount ?? 0;
  return {
    name: names[stockIndex] ?? '',
    listed,
    icon: listed && commType !== null
      ? iconImageOf(state.globalMapId, commType.type, commType.stockIndex)
      : null,
    cells,
    boss: listed && owner !== 0 ? (playerNames[owner - 1] ?? null) : null,
    chart: chartPoints(history, state.market.day, high, low),
    chartLabels: {
      high: high.toFixed(dec),
      highY: chartYAt(high, low, high),
      low: low.toFixed(dec),
      lowY: chartYAt(high, low, low),
    },
    ratio: mine / DETAIL_PIE.totalShares,
  };
}

// ============================================================
//  画
// ============================================================

const FONT = FONT_FAMILY;

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

  // ★ 没有上市公司时原版**整格不画**（图 0 是 640×480 的整屏页，画了就盖住整张卡）
  //
  // ★ 图标是**不透明**贴的，别抠黑：原版这里与底图走的是**同一个** `fcn_004563f5`
  //   （@source `call 0x4563f5` @0x00429f25），它进到 0x455b3a = 连 0 一起拷的
  //   不透明 blit；抠黑的是另一个入口 0x456418 → 0x455c52（`push 0` 传键色）。
  //   资源 75 是 **SMP**（无 alpha），图标里那些「纯黑」是真画面：圖 7（電子）的
  //   显示器屏 12%、圖 9 有 39.6% 是纯黑，抠掉就会把屏幕/底色镂空。
  const icon = view.icon === null
    ? null
    : sprite('Panel.mkf', DETAIL_RESOURCE, view.icon, false);
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

  // ── 折线两端旁的两个价签（12 号字、右对齐到 88）@source `loc_0042a8bf` 起 ──
  text(
    ctx, view.chartLabels.high,
    DETAIL_CHART_TAG.x, view.chartLabels.highY - DETAIL_CHART_TAG.gap,
    DETAIL_CHART_TAG.size, '#f0f0f0', 'right',
  );
  text(
    ctx, view.chartLabels.low,
    DETAIL_CHART_TAG.x, view.chartLabels.lowY + DETAIL_CHART_TAG.gap,
    DETAIL_CHART_TAG.size, '#f0f0f0', 'right',
  );

  drawPie(ctx, view.ratio);
}

/**
 * 持股比例那个饼 @source `loc_0042a3cc` 起（笔是黑 1px：`CreatePen(0,1,0)` @0x0042a3cc）
 *
 * 画序（exe 就是这个顺序）：
 * 1. 两道「厚度」端帽短竖线 @0x0042a3e9 / @0x0042a41d —— 三支都画；
 * 2. `0 < r < 1`：底盘椭圆 @0x0042a526 → `Pie` 两份扇 @0x0042a580 / @0x0042a5d3
 *    → 端点在**下半**时那道 7px 竖线 @0x0042a5e3 → `FloodFill(dc,589,374,0)` @0x0042a638；
 *    `r == 0` / `r ≥ 1`：两个椭圆各一次（@0x0042a681+ / @0x0042a6e1+，共用 0x0042a71d）。
 *
 * ★ 三支的**颜色**：自己那份 = 深红 `0xd0`（COLORREF → RGB(208,0,0)），
 *   其余 = 深蓝 `0xd00000`（→ RGB(0,0,208)）。所以 `r == 0` 整块是**蓝**、
 *   `r ≥ 1` 整块是**红** —— 与「自己那份占 r」自洽（@source 两支的 `push`）。
 * ★ `Ellipse` 与 `Pie` 都会用当前笔画一圈边，所以两个椭圆各有黑描边；
 *   两份扇的路径本身就带那两条半径，描一次边就是原版的两条黑半径线。
 */
function drawPie(ctx: CanvasRenderingContext2D, ratio: number): void {
  const { cx, cy, rx, ry, box, topBox, ticks, thickness, floodRatio, mine, rest } = DETAIL_PIE;
  /** 一个椭圆的路径；`dy` 是纵向平移（底盘相对饼低 `thickness`）*/
  const ellipsePath = (
    b: { left: number; top: number; right: number; bottom: number },
    dy = 0,
  ): void => {
    ctx.beginPath();
    ctx.ellipse(
      (b.left + b.right) / 2, (b.top + b.bottom) / 2 + dy,
      (b.right - b.left) / 2, (b.bottom - b.top) / 2,
      0, 0, Math.PI * 2,
    );
  };
  /** 填 + 描（原版 `Ellipse` / `Pie` 都是填完再用黑笔画边）*/
  const fillStroke = (fill: string): void => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  /**
   * 底盘露在饼下面那条**月牙**（`box ∖ topBox`：两个椭圆同尺寸、只差 `thickness` 的
   * 纵向平移，所以月牙处处正好 `thickness` 厚）。
   *
   * `from`/`to` 是椭圆参数角：0 = 最右、π = 最左、中间过最下点。
   * FloodFill 只涂到端点竖线右边（`to = acos((xend − cx) / rx)`）；
   * 端点在上班时没有那道竖线，整条月牙连通，`from..to` = `0..π`。
   */
  const crescentPath = (from: number, to: number): void => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, from, to, false); // 上边＝饼那张椭圆的下弧
    ctx.ellipse(cx, cy + thickness, rx, ry, 0, to, from, true); // 下边＝底盘的下弧（原路回）
    ctx.closePath();
  };

  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;

  // ① 两道「厚度」端帽短竖线 @0x0042a3e9 / @0x0042a41d
  ctx.beginPath();
  for (const t of ticks) {
    ctx.moveTo(t.x + 0.5, t.y0);
    ctx.lineTo(t.x + 0.5, t.y1);
  }
  ctx.stroke();

  if (ratio > 0 && ratio < 1) {
    const end = pieEnd(ratio);
    // 端点在下半（yend ≥ 365）→ 原版多画一道 7px 竖线 @0x0042a5da（它把月牙切开）
    const capped = end.y >= cy;
    const top = { x: cx, y: cy - ry };
    const wedge = (from: { x: number; y: number }, to: { x: number; y: number }, fill: string): void => {
      const a0 = Math.atan2((from.y - cy) / ry, (from.x - cx) / rx);
      const a1 = Math.atan2((to.y - cy) / ry, (to.x - cx) / rx);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, a0, a1, false);
      ctx.closePath();
      fillStroke(fill);
    };

    // ① 底盘椭圆（深蓝＝「其余」那支的颜色）@0x0042a50a–0x0042a542
    ellipsePath(box);
    fillStroke(rest);
    // ② 两份扇：正上方起顺时针，自己那份（占 ratio）= 深红
    wedge(top, end, mine);
    wedge(end, top, rest);
    // ③ 端点在上班时不画竖线 @0x0042a5da 的 `jl`
    if (capped) {
      ctx.beginPath();
      ctx.moveTo(end.x + 0.5, end.y);
      ctx.lineTo(end.x + 0.5, end.y + thickness);
      ctx.stroke();
    }
    // ④ FloodFill(dc,589,374,0) @0x0042a638：两道闸 —— ratio > 0.25 且端点 x < 589
    if (ratio > floodRatio && end.x < DETAIL_VALUE_X.c3) {
      crescentPath(0, capped ? Math.acos((end.x - cx) / rx) : Math.PI);
      fillStroke('#000000');
    }
  } else if (ratio === 0) {
    // 自己一份都没有 → 整块都是「其余」那支的深蓝 @0x0042a665 / @0x0042a71d
    ellipsePath(box);
    fillStroke(rest);
    ellipsePath(topBox);
    fillStroke(rest);
  } else {
    // ratio ≥ 1（或负）→ 整块都是自己那份的深红 @0x0042a6c2 / @0x0042a71d
    ellipsePath(box);
    fillStroke(mine);
    ellipsePath(topBox);
    fillStroke(mine);
  }

  ctx.restore();
}
