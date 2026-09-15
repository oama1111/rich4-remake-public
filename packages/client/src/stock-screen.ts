/*
 * 股市屏（`Panel.mkf` 资源 75）—— T-030
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 入口 `_rich4_ui_stock_entry`（VA 0x42b58f）—— 由**工具栏第 11 颗「股市」**
 * 打开（`rich4_ui_clicking_top_panel.asm:101`，参数 0 = 买卖模式）；
 * 紅卡／黑卡选股票那两张卡也走这一屏（参数 1／2，见文末）。
 *
 * ## 资源 75 的 29 张图
 *
 * | 图 | 尺寸 | 是什么 |
 * |---|---|---|
 * | 0 | 640×480 | **股價表页**（绿桌布）—— 六列表头烘在上面 |
 * | 1 | 640×480 | **持股页**（黄桌布）—— 同一张桌子换个色 |
 * | 2 | 587×375 | 「上市公司資訊」那张详情卡（**本卡没做**，见 T-030b）|
 * | 3..28 | 80×112 | 26 张企业图标（详情卡左上的框里用）|
 *
 * ★ **两张 640×480 是「两页」**，不是两个状态：点第 1 块牌子（页码牌）
 *   `[0x48c2ec] ^= 1` 换页（@source `loc_0042aec4`），`fcn_004297f7(page)`
 *   把 chunk[page] 整张贴上去再画这一页的动态值。
 *   ⚠️ 两页的**标题是反的**：图 0 的标题写着 `持有股數表` 却是行情表，
 *   图 1 写着 `股 價 表` 却是持股表。这里是照抄原版（字烘在图里）。
 *
 * ## 顶带五块牌子 —— 表 `0x4754c8`（每项 16 字节 x0,y0,x1,y1）
 *
 * 命中在 `loc_0042ad6c`（0x200 mousemove）与 `loc_0042ae26`（点击），
 * 判定 `x0 < x < x1 && y0 < y < y1`；表里的顺序就是跳表 `ref_0042aaeb` 的下标。
 *
 * | # | 矩形 | 是什么 | @source |
 * |---|---|---|---|
 * | 0 | (16,9)-(124,39) | 页码牌 —— 点一下换页 | `loc_0042aec4` |
 * | 1 | (128,9)-(198,39) | **買進** | `loc_0042aee4` |
 * | 2 | (202,9)-(272,39) | **賣出** | `loc_0042afff` |
 * | 3 | (276,9)-(410,39) | **上市公司資訊** | `loc_0042b0b7` |
 * | 4 | (552,8)-(623,40) | **EXIT**（小人 + 红门那张图烘在图里）| `loc_0042b0c2` |
 *
 * `買進`/`賣出`/`上市公司資訊` 三个字是**运行时**画的：`fcn_004296c1` 里
 * 三次 `draw_text`，落点 (163,24)/(237,24)/(343,24)、16 号、居中。
 *
 * ## 12 行行情 —— 行几何
 *
 * 命中（`loc_0042ae2c`）：`15 < x < 625` 且 `80 < y < 464`，
 * 行号 = `(y − 80) / 32`（**0 基**）。所以每行高 **32**、第一行顶 **80**。
 * 行内文字用 flag 6（右中）画在 **y = 96 + 32×行号**上。
 *
 * | 列 | 表头（烘在图里，y=64）| 值右边缘 x | 画法 @source |
 * |---|---|---|---|
 * | 股票名稱 | 76 | 76（居中，名字直接画在那儿）| `loc_0042b75b` |
 * | 成交價 | 188 | **225** | `loc_0042994c` |
 * | 漲跌 | 280 | **305** | `loc_004299e7` |
 * | 交易量 | 368 | **401**（停牌时改画 `暫停交易` 于 368 居中）| 同上 |
 * | 持有股數 | 468 | **504**（只在自己持股 ≠ 0 时画）| `loc_00429ac9` |
 * | 平均成本 | 572 | **609**（`%.2f`，同上）| 同上 |
 * 顶带最右还有**存款**：`$` + 千分位，右对齐 x=**540**、y=24（@source `loc_004297f7` 开头）。
 *
 * ## 颜色（`fcn_00429691` 定小数位、`fcn_004295ea` 定涨跌类）
 *
 * `fcn_00429691(价)`：`< 15` → 0（`%.2f`）、`< 150` → 1（`%.1f`）、否则 2（`%.0f`）。
 * 成交價与漲跌**共用**这个位数（`ref_00475518` / `ref_00475524`）。
 *
 * `fcn_004295ea(股)` 就是 core 的 `stockStatus`（0 漲 / 1 漲停 / 2 跌 / 3 跌停 / 4 平），
 * 跳表 `ref_004297cf` 决定字色与「底色框」：
 *
 * | 类 | 字色 | 框 | 备注 |
 * |---|---|---|---|
 * | 0 漲 | 0xff0000 红 | — | |
 * | 1 **漲停** | 白 | 0xd00000 暗红，框 (144, y−10, 89, 20) | **不能買進**（`漲停無法買進！`）|
 * | 2 跌 | 0x00ff00 绿 | — | |
 * | 3 **跌停** | 0x101010 黑 | 0x00d000 暗绿，同一矩形 | **不能賣出**（`跌停無法賣出！`）|
 * | 4 平 | 0xf0f0f0 白 | — | |
 *
 * ⚠️ `create_font` 的第 2 个参数是 **RGB**（函数内部再按 `RRGGBB → BBGGRR` 翻成
 * COLORREF，@source VA 0x44f9e1 起那一串 `and/shl/or`）。
 * 持股那两列：**该股有对应企业时字色是 `0xf0f0`**（= RGB 青），否则 `0xf0f0f0` 白
 * （@source `loc_0042b7a9` / `loc_004299af`）。原版这里多半想写 `0xf0f000`（黄），
 * 但字节就是 `68 f0 f0 00 00` —— 照抄，不替它改。
 *
 * ## 休市 —— 整屏只剩「本日休市」四个字，且**点哪儿都退屏**
 *
 * 入口 `call fcn_00428d01 / cmp eax, 1 / jne loc_0042b745`：
 *
 * - **休市（eax == 1）**：把 `本日休市` 写进**图 0**（72 号字，**(324,244) 黑 +
 *   (320,240) 白**，两个落点叠出描边），然后 `Wait_0402_Message(fcn_0042b2ec)`
 *   —— ★ 走的是**訊息框**那个窗口过程：它只会重贴图 0 和三颗钮的字，
 *   **然后任何一下鼠标（0x202/0x205）都 `Post_0402_Message(0)` 直接退屏**。
 *   所以休市时：没有表头、没有股票名、没有任何行情数字，**也根本点不到买卖**。
 * - **开市（eax != 1）**：`jmp loc_0042b745` 才去画股票名、页头、然后进真正的
 *   窗口过程 `fcn_0042aaff`。
 *
 * ⚠️ 先前把这两支读反了（以为休市照画全屏、开市才写那四个字）。
 *   `fcn_00428d01` 在整支 exe 里只被两处调用：这里，与每日行情
 *   `fcn_004291d6`（休市日不跳价）—— 买卖函数里没有这道闸，
 *   但休市时那一屏压根没有能点的东西。
 *
 * ⚠️ **本卡没做**（另开 T-030b）：图 2 那张「上市公司資訊」详情卡（含 26 张企业图标、
 * 半年走势线图、持股比例）、以及持股页（图 1）每行**各玩家持股数**那一排。
 * 现在换页能看到黄桌子 + 列的动态值（保留股份／累積盈餘），但玩家持股那一排还没画。
 *
 * ## ★ 选股模式（紅卡 24 / 黑卡 25）—— Q-PICK-2
 *
 * `_rich4_ui_stock_entry(mode)` 的那个参数不是布尔，是**模式**：
 * 紅卡 `push 1`（VA 0x00444ff8）、黑卡 `push 2`（VA 0x004450bc）、
 * 工具栏第 11 颗「股市」传 0（买卖）。窗口过程把模式存进 `[0x48c2ed]`
 * （@source `loc_0042ab75` 的 WM_CREATE `mov byte [0x48c2ed], dl`）。
 *
 * 模式 ≠ 0 时这一屏**只干一件事：点一行 → 把选择抛回去**：
 *
 * ```asm
 * loc_0042abbb  ; 0x200 悬停：y ∈ (80, 464) → 行 = (y−80)/32（0 基）
 *               ;   画一个**白框** fcn_0045620f(surface, 0xf, top, 0x262, 0x20, 0xffffff)
 * loc_0042b0da  ; 0x202 点击（选择号 ≥ 10 = 某一行）：
 *               ;   [0x48c2eb] = 选择号 − 0xa
 *               ;   mode == 1 → newsFlag = 0x20（利多）@source `loc_0042b137`
 *               ;   mode != 1 → newsFlag = 2  （利空）@source `loc_0042b11e`
 *               ;   call 0x429040(row)     ; ★ 当场把价格算出来（= core 的 applyStockNews）
 *               ;   重画该页 → blit → 0x45285e(0x3e8) 停 1 秒 → Post_0402_Message(row)
 * loc_0042b22f  ; 0x205 右键：page == 0 → 取消（Post(0)）
 * ```
 *
 * ★ **价格是 UI 当场改的，不是等第二天** —— 紅/黑卡都把 `0x429040` 叫了一遍
 *   （真人这一支在 UI 里、AI 那一支在卡函数里），所以「选中」的反馈就是
 *   **那一支当场涨/跌 10%**，然后停一秒再抛回卡函数。本引擎把这一步收进
 *   core（UI 不写行情，C-ARC-2），见 `cards/registry.ts` 的 24/25 分支。
 *
 * ★ 抛回去的值是**行号**（1 基，= 股票号）：黑卡拿它去算敌意
 *   （`[esp + ebx*4 + 0x7c]` 那个 1 基快照数组），所以「取消」（0）时卡不消耗。
 */

import type { GameState } from '@rich4/core';
import { STOCK_STATUS, marketOpenOn, stockStatus } from '@rich4/core';
import type { ArchiveName, Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type StockSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 图集 @source 入口 VA 0x42b5b0 的 `read_mkf(panel_mkf, 0x4b, 0, 0)` */
export const STOCK_RESOURCE = 75;
/** 两页 = 图 0 / 图 1 @source `fcn_004297f7` 的表头 */
export const STOCK_PAGE_COUNT = 2;

/** 一块牌子的屏幕矩形 */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 五块牌子 @source 表 `0x4754c8` */
export const STOCK_PLATES: readonly Rect[] = [
  { x0: 16, y0: 9, x1: 124, y1: 39 }, // 页码牌
  { x0: 128, y0: 9, x1: 198, y1: 39 }, // 買進
  { x0: 202, y0: 9, x1: 272, y1: 39 }, // 賣出
  { x0: 276, y0: 9, x1: 410, y1: 39 }, // 上市公司資訊
  { x0: 552, y0: 8, x1: 623, y1: 40 }, // EXIT
] as const;

export const STOCK_PLATE_PAGE = 0;
export const STOCK_PLATE_BUY = 1;
export const STOCK_PLATE_SELL = 2;
export const STOCK_PLATE_INFO = 3;
export const STOCK_PLATE_EXIT = 4;

/** 三颗运行时画的牌子字 @source `fcn_004296c1` 的三次 `draw_text` */
export const STOCK_PLATE_LABELS = [
  { plate: STOCK_PLATE_BUY, text: '買進', x: 163, y: 24 },
  { plate: STOCK_PLATE_SELL, text: '賣出', x: 237, y: 24 },
  { plate: STOCK_PLATE_INFO, text: '上市公司資訊', x: 343, y: 24 },
] as const;

/** 12 行 @source `loc_0042ae2c` 的 `15 < x < 625 && 80 < y < 464`、步长 0x20 */
export const STOCK_ROWS = {
  count: 12,
  top: 80,
  height: 32,
  hitX0: 15,
  hitX1: 625,
  textDy: 16,
} as const;

/** 高亮矩形：x 从 15 到 610、高 32 @source `loc_0042ac9e` 的 `0xf / 0x262 / 0x20` */
export const STOCK_HILITE = { x: 15, w: 610 } as const;

/** 六列表头（字烘在图里，y=64）@source 入口 VA 0x42b5c8 起 */
export const STOCK_HEADERS = [
  { text: '股票名稱', x: 76 },
  { text: '成交價', x: 188 },
  { text: '漲跌', x: 280 },
  { text: '交易量', x: 368 },
  { text: '持有股數', x: 468 },
  { text: '平均成本', x: 572 },
] as const;

/** 值的落点 @source 各行 `draw_text` 的 x */
export const STOCK_VALUE_X = {
  /** 名字：图 0 在 76，图 1 在 71 @source `loc_0042b75b` / `loc_0042b78b` */
  name: [76, 71] as const,
  price: 225,
  change: 305,
  volume: 401,
  suspended: 368,
  shares: 504,
  cost: 609,
} as const;

/** 顶带右上的存款 @source `loc_004297f7` 的 `push 0x21c / push 0x18` */
export const STOCK_CASH = { x: 540, y: 24 } as const;

/** 漲停／跌停那个底色框 @source `loc_004298cc` 的 `0x90 / 0x59 / 0x14` */
export const STOCK_STATUS_BOX = { x: 144, w: 89, h: 20 } as const;

/**
 * **持股页（图 1）的页头** —— 与行情页完全不同 @source 入口 VA 0x42b856 起。
 *
 * | 字 | 落点 |
 * |---|---|
 * | `股票名稱` | x=**71**, y=64 |
 * | **每个玩家的名字**（`player+0`）| x=**168 + 80×座次**, y=64 |
 * | `保留股份` | x=**492** |
 * | `累積盈餘` | x=**580** |
 */
export const STOCK_HEADERS_PAGE1 = {
  name: 71,
  playerFirst: 0xa8,
  playerStep: 0x50,
  retained: 0x1ec,
  surplus: 0x244,
} as const;
/** 持股页各玩家持股数的落点 @source `loc_00429ccd` 的 `mov edi, 0xc0` */
export const STOCK_HOLDER_X = 0xc0;
export const STOCK_HOLDER_STEP = 0x50;
/**
 * **董事長那一格的标识** —— 蓝底 + 黄字 @source `loc_00429ba1`。
 *
 * 判据是 `commercial + 0x18`（= 董事会主席，玩家下标 + 1）；命中的那一格先
 * `fill_rect(edi−0x38, y−10, 0x40, 0x14, 0xff)` 再换 `0xf0f000` 的字。
 * （`0xff` 是 RGB 蓝 —— `fcn_004561be` 与 `create_font` 一样按 RGB 解释。）
 */
export const STOCK_BOSS_MARK = { dx: -0x38, w: 0x40, h: 0x14, box: '#0000ff', fg: '#f0f000' } as const;

/** 停牌那格的字 @source 串 0x46400f */
export const STOCK_SUSPENDED = '暫停交易';
/** 休市那两个 @source 串 0x4640e8，72 号字，(324,244) 黑 + (320,240) 白 */
export const STOCK_CLOSED = '本日休市';
export const STOCK_CLOSED_AT = [{ x: 324, y: 244 }, { x: 320, y: 240 }] as const;
export const STOCK_CLOSED_SIZE = 72;

/** 买不进／卖不掉 @source 串 0x464088 / 0x464097 */
export const STOCK_NO_BUY = '漲停無法買進！';
export const STOCK_NO_SELL = '跌停無法賣出！';

/**
 * 股市柜台按「買進」时，那个**通用填数窗**（`fcn_00453544`）的上限。
 *
 * @source `loc_0042af30`（入口 `loc_0042aee4`）：
 * ```asm
 * eax = [stock + 0x10]      ; 流通量
 * edx:eax = 玩家存款（player + 0x20）
 * idiv [stock + 0x14]       ; ÷ 股價 → 買得起的股數
 * 上限 = min(流通量, 存款 ÷ 股價)
 * ```
 *
 * ★ 与上市企業落点那条（`core` 的 `shareWindowLimit`，VA 0x0041d1a9）是
 *   **两个不同的上限**：那条从**現金**付、夹 1000；这条从**存款**付、夹流通量。
 *   两条都把上限交给同一个 `AmountPage`（`main.ts` → `dialog.ts`），
 *   界面不许自己再算（C-ARC-2）。
 *
 * ⚠️ 股价为 0（未开盘/脏数据）时原版 `idiv` 会崩；这里给 0 = 不开窗。
 */
export function stockCounterBuyMax(deposit: number, price: number, floating: number): number {
  if (price <= 0) return 0;
  const byDeposit = Math.trunc(deposit / price);
  return Math.max(0, Math.min(Math.trunc(floating), byDeposit));
}

/** 一行行情的显示数据（已格式化好）*/
export interface StockRowView {
  name: string;
  /** core 的 `STOCK_STATUS`（0 漲 / 1 漲停 / 2 跌 / 3 跌停 / 4 平）*/
  status: number;
  /** 成交價 —— 已按量级定小数位 */
  price: string;
  /** 漲跌（带正负号）*/
  change: string;
  /** 交易量；停牌时是 `null`（那一格改画「暫停交易」）*/
  volume: string | null;
  /** 持有股數；没持股是 `null` */
  shares: string | null;
  /** 平均成本（`%.2f`）；没持股是 `null` */
  cost: string | null;
  /** 这一页要画的东西（图 1 那页用）*/
  retained: string;
  surplus: string;
  /** 各玩家持股数（图 1 那页用；0 的不画）*/
  holders: readonly number[];
  /** 这一支的**董事長**（玩家下标 + 1，0 = 无主）@source `commercial + 0x18` */
  boss: number;
  /** 该股有没有对应的地图企业 —— 决定持股两列的字色 @source word [stocks+4] */
  listed: boolean;
}

/** 画一屏要的全部东西 */
export interface StockView {
  /** 0 = 股價表页（绿）／1 = 持股页（黄）*/
  page: number;
  /** 休市（画「本日休市」）*/
  closed: boolean;
  /** 顶带右上的存款 */
  deposit: number;
  /** 12 行 */
  rows: readonly StockRowView[];
  /** 各玩家的名字 —— **持股页的页头**要竖着排它们 @source 入口 0x42b820 */
  playerNames: readonly string[];
  /** 鼠标悬停的行（0 基；null = 没有）*/
  hover: number | null;
  /** 选中的行（0 基；null = 没有）*/
  selected: number | null;
  /**
   * **选股模式**下悬停的行（0 基；null = 没有）。
   *
   * 这一档与原版的普通屏**不是同一套反馈**：模式 ≠ 0 时原版走的是
   * `loc_0042abbb` 那条支路，只画**白框**（不碰 `hover`/`selected` 那套选中高亮）。
   */
  pickHover?: number | null;
}

// ============================================================
//  几何
// ============================================================

/** 点在哪块牌子上；没点中返回 `null` @source `loc_0042ad93` */
export function hitStockPlate(x: number, y: number): number | null {
  for (let i = 0; i < STOCK_PLATES.length; i++) {
    const p = STOCK_PLATES[i]!;
    if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1) return i;
  }
  return null;
}

/** 点在第几行（0 基）；没点中返回 `null` @source `loc_0042ae2c` */
export function hitStockRow(x: number, y: number): number | null {
  if (x <= STOCK_ROWS.hitX0 || x >= STOCK_ROWS.hitX1) return null;
  if (y <= STOCK_ROWS.top) return null;
  const bottom = STOCK_ROWS.top + STOCK_ROWS.count * STOCK_ROWS.height;
  if (y >= bottom) return null;
  const row = Math.floor((y - STOCK_ROWS.top) / STOCK_ROWS.height);
  return row >= 0 && row < STOCK_ROWS.count ? row : null;
}

/** 第 `row` 行的矩形（高亮用）*/
export function stockRowRect(row: number): { x: number; y: number; w: number; h: number } {
  return {
    x: STOCK_HILITE.x,
    y: STOCK_ROWS.top + row * STOCK_ROWS.height,
    w: STOCK_HILITE.w,
    h: STOCK_ROWS.height,
  };
}

/** 第 `row` 行文字的 y（flag 6 的右中对齐点）*/
export function stockRowTextY(row: number): number {
  return STOCK_ROWS.top + row * STOCK_ROWS.height + STOCK_ROWS.textDy;
}

// ============================================================
//  选股模式（紅卡 / 黑卡）—— Q-PICK-2
// ============================================================

/**
 * `_rich4_ui_stock_entry` 的那个参数。
 * 1 = 紅卡（利多）、2 = 黑卡（利空）、0 = 普通买卖（本引擎另有 `stockTrade`）。
 */
export type StockPickMode = 1 | 2;

/** 紅卡（24）走模式 **1** @source VA 0x00444ff8 `push 1; call 0x42b58f` */
export const STOCK_PICK_RED: StockPickMode = 1;
/** 黑卡（25）走模式 **2** @source VA 0x004450bc `push 2; call 0x42b58f` */
export const STOCK_PICK_BLACK: StockPickMode = 2;
/** 卡片号 → 模式；不是这两张就返回 `null` */
export const STOCK_PICK_CARD = { red: 24, black: 25 } as const;

export function stockPickModeOfCard(cardId: number): StockPickMode | null {
  if (cardId === STOCK_PICK_CARD.red) return STOCK_PICK_RED;
  if (cardId === STOCK_PICK_CARD.black) return STOCK_PICK_BLACK;
  return null;
}

/**
 * 模式 → 打到该股 `newsFlag` 上的字节。
 *
 * @source `loc_0042b137`：`mov byte [eax*4 + 0x496987], 0x20`（模式 1）
 * @source `loc_0042b11e`：`mov byte [eax*4 + 0x496987], 2`（模式 2）
 *   —— 与 core `swap-and-stock.ts` 的 `RED_CARD_NEWS_FLAG` / `BLACK_CARD_NEWS_FLAG` 同值。
 */
export function stockPickNewsFlag(mode: StockPickMode): number {
  return mode === STOCK_PICK_RED ? 0x20 : 0x02;
}

/**
 * 选中之后停多久才把画面收掉 —— **1 秒** @source `push 0x3e8; call 0x45285e`
 * （`fcn_0045285e` 是 GetTickCount + PeekMessage 的等待循环）。
 * 这一秒里玩家看到的就是「那一支已经涨/跌好了」。
 */
export const STOCK_PICK_FEEDBACK_MS = 0x3e8;

/**
 * 悬停反馈 = **整行白框**，不是填充。
 *
 * @source `loc_0042ac9e`：`fcn_0045620f(surface, 0xf, 32×行+0x30, 0x262, 0x20, 0xffffff)`
 *   —— `0x45620f` 是**画框**（首行整行填色，其余只填左右两列，@source VA 0x00456245 起），
 *   矩形与 `stockRowRect` 完全相同。
 *
 * 返回 4 条 1 像素宽的边（上/下/左/右），调用方 `fillRect` 逐条画 ——
 * 与 canvas 的 `strokeRect`（会把线压在边界两侧）不同，这样与 `draw_rect` 的像素一致。
 */
export function stockPickFrameRects(
  row: number,
): { x: number; y: number; w: number; h: number }[] {
  const r = stockRowRect(row);
  return [
    { x: r.x, y: r.y, w: r.w, h: 1 }, // 上
    { x: r.x, y: r.y + r.h - 1, w: r.w, h: 1 }, // 下
    { x: r.x, y: r.y + 1, w: 1, h: r.h - 2 }, // 左
    { x: r.x + r.w - 1, y: r.y + 1, w: 1, h: r.h - 2 }, // 右
  ];
}

/** 选中之后要发的 action —— 形状与 `core/state/actions.ts` 的 `useCard` 一致 */
export type StockPickAction = { type: 'useCard'; cardId: number; target: { kind: 'stock'; index: number } };

/**
 * 「点中第 `row` 行」→ action；行号越界返回 `null`（**不发 action**，卡不消耗）。
 *
 * 行号在这里已经是 **0 基下标**（`hitStockRow` 的返回值），正好是 core 的
 * `CardTarget.stock.index`；原版抛回的是 1 基行号，只在它自己算敌意时用。
 */
export function stockPickCardAction(cardId: number, row: number): StockPickAction | null {
  if (!Number.isInteger(row) || row < 0 || row >= STOCK_ROWS.count) return null;
  return { type: 'useCard', cardId, target: { kind: 'stock', index: row } };
}

// ============================================================
//  数值格式
// ============================================================

/**
 * 价格的「量级类」= 取几位小数 @source `fcn_00429691`（阈值 15 / 150）
 */
export function magnitudeClass(price: number): number {
  if (price < 15) return 0;
  if (price < 150) return 1;
  return 2;
}

const DECIMALS = [2, 1, 0] as const;

/** 成交價 @source `ref_00475518` = `%.2f / %.1f / %.0f` */
export function priceText(price: number): string {
  return price.toFixed(DECIMALS[magnitudeClass(price)] ?? 2);
}

/** 漲跌 @source `ref_00475524` = `%+.2f / %+.1f / %+.0f`（位数跟**现价**走）*/
export function changeText(price: number, open: number): string {
  const d = DECIMALS[magnitudeClass(price)] ?? 2;
  const v = price - open;
  return `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(d)}`;
}

/** 千分位（原版 `num_to_currency_string` 只加逗号，不带 `$`）@source VA 0x452793 */
export function comma(n: number): string {
  return Math.trunc(n).toLocaleString('en-US');
}

// ============================================================
//  颜色
// ============================================================

/**
 * 涨跌类 → **成交價那一格**的字色 / 底色框。
 *
 * @source 跳表 `ref_004297cf`（`jmp dword [eax*4 + 0x4297cf]`，索引 = `fcn_004295ea` 的返回）：
 *   `loc_004298b9` 0 漲红 / `loc_004298cc` 1 漲停白+暗红框 / `loc_004298f8` 2 跌绿 /
 *   `loc_00429908` 3 跌停**黑**+暗绿框 / `loc_00429934` 4 平白。
 *
 * ⚠️ 这张表**只管成交價那一格**（绘制在 x=0xe1，@source VA 0x0042994c 那一段）。
 *   涨跌列与交易量列走的是**另一张表**，见 `stockTrendColor()`。
 */
export function stockStatusColor(status: number): { fg: string; box: string | null } {
  switch (status) {
    case STOCK_STATUS.up:
      return { fg: '#ff0000', box: null };
    case STOCK_STATUS.limitUp:
      return { fg: '#f0f0f0', box: '#d00000' };
    case STOCK_STATUS.down:
      return { fg: '#00ff00', box: null };
    case STOCK_STATUS.limitDown:
      return { fg: '#101010', box: '#00d000' };
    default:
      return { fg: '#f0f0f0', box: null };
  }
}

/**
 * 涨跌类 → **涨跌列与交易量列**的字色 —— 与 `stockStatusColor()` 是**两张不同的表**。
 *
 * ★ 2026-09-16 订正：原版在这里**第二次**跳转（`cmp ebx,4 / ja … / jmp [ebx*4 + 0x4297e3]`），
 *   表 `ref_004297e3` 只分三类：
 *   ```
 *   0 漲 / 1 漲停 → loc_004299af  红 0xff0000
 *   2 跌 / 3 跌停 → loc_004299bf  绿 0x00ff00      ← 跌停是**绿字**，不是黑字
 *   4 平          → loc_004299cf  白 0xf0f0f0
 *   ```
 *   ⇒ 「成交價那格是黑字+暗绿框」与「涨跌列是绿字」**同时成立**，互不矛盾。
 *   交易量列紧跟在涨跌列之后画、中间没有新建字体（@source VA 0x00429a66 起），所以同色。
 *
 * @source VA 0x004299af / 0x004299bf / 0x004299cf（各自 `create_font(0x10, fg, 0x101010, 3, 1)`）
 */
export function stockTrendColor(status: number): string {
  switch (status) {
    case STOCK_STATUS.up:
    case STOCK_STATUS.limitUp:
      return '#ff0000';
    case STOCK_STATUS.down:
    case STOCK_STATUS.limitDown:
      return '#00ff00';
    default:
      return '#f0f0f0';
  }
}

/** 有对应企业的股票，持股那两列的字色 @source `loc_0042b7a9` 的 `push 0xf0f0` */
export const STOCK_LISTED_COLOR = '#00f0f0';
/** 其余白字 @source `push 0xf0f0f0` */
export const STOCK_PLAIN_COLOR = '#f0f0f0';

// ============================================================
//  从局面取一屏
// ============================================================

const EMPTY_ROW: StockRowView = {
  name: '',
  status: STOCK_STATUS.flat,
  price: '',
  change: '',
  volume: null,
  shares: null,
  cost: null,
  retained: '',
  surplus: '',
  holders: [],
  boss: 0,
  listed: false,
};

/**
 * 把局面摊成 12 行。
 *
 * 只有**当前玩家**的持股是他自己的（原版也只取 `[0x49910c]` 那位）。
 *
 * @param names 12 支股票的名字 —— 原版是记录里的 `name_ptr`（+0），
 *   core 的 `StockState` 不带名字（在 `@rich4/data` 的表里），故由调用方喂进来。
 */
export function stockRowsFrom(
  state: GameState,
  player: number,
  names: readonly string[] = [],
): StockRowView[] {
  const stocks = state.market?.stocks ?? [];
  const mine = state.holdings[player] ?? [];
  const players = state.players.length;
  const rows: StockRowView[] = [];
  for (let i = 0; i < STOCK_ROWS.count; i++) {
    const s = stocks[i];
    if (s === undefined) {
      rows.push(EMPTY_ROW);
      continue;
    }
    const holding = mine[i];
    const held = holding?.amount ?? 0;
    const holders: number[] = [];
    for (let p = 0; p < players; p++) holders.push(state.holdings[p]?.[i]?.amount ?? 0);
    const comm = s.commercialIndex;
    rows.push({
      name: names[i] ?? '',
      status: stockStatus(s.openPrice, s.price),
      price: priceText(s.price),
      change: changeText(s.price, s.openPrice),
      // @source `cmp byte [stocks+6], 0` —— 停牌那一格改画「暫停交易」
      volume: s.f6 !== 0 ? null : comma(s.f10),
      shares: held > 0 ? comma(held) : null,
      cost: held > 0 ? (holding?.avgCost ?? 0).toFixed(2) : null,
      // 图 1 那页：企业还剩多少股（+0x30）与累積盈餘（+0x28）
      retained: comma(state.commercialShares[comm] ?? 0),
      surplus: comma(state.companyFunds[comm] ?? 0),
      holders,
      boss: state.commercialOwners[comm]?.owner ?? 0,
      listed: comm !== 0,
    });
  }
  return rows;
}

/** 今天柜台开不开 @source `fcn_00428d01`（VA 0x428d01）*/
export function stockCounterClosed(state: GameState): boolean {
  return !marketOpenOn(state.globalMapId, state.year, state.month, state.day);
}

// ============================================================
//  画
// ============================================================

const FONT = FONT_FAMILY;

/** 一行字 */
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

/** 钱（带 `$`）—— 原版在缓冲区首字节写 `0x24` @source `loc_004297f7` */
function cash(n: number): string {
  return `$${comma(n)}`;
}

/**
 * 画整屏（640×480）。
 *
 * `view.rows[i].name` 为空的就不用画名字 —— 原版把**股票名烘进底图**
 * （`loc_0042b75b` 那一循环），这里每帧照同样坐标画一遍（与個人資產表同一做法）。
 */
export function drawStockScreen(
  ctx: CanvasRenderingContext2D,
  sprite: StockSprite,
  view: StockView,
): void {
  const page = view.page % STOCK_PAGE_COUNT;
  const bg = sprite('Panel.mkf', STOCK_RESOURCE, page, false);
  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);

  // 页码牌与 EXIT 上的字是**烘在图里**的；这里补**运行时画的那几处**。
  text(ctx, PAGE_TITLES[page] ?? '', 70, 24, 16, '#f0f0f0', 'center');
  for (const l of STOCK_PLATE_LABELS) text(ctx, l.text, l.x, l.y, 16, '#f0f0f0', 'center');
  text(ctx, cash(view.deposit), STOCK_CASH.x, STOCK_CASH.y, 16, '#f0f0f0', 'right');

  // ★ 休市：整屏就到此为止 —— 原版那一支走的是訊息框，
  //   表头、股票名、任何行情数字**都不画**，也没有能点的东西。
  if (view.closed) {
    for (const at of STOCK_CLOSED_AT) {
      const dark = at === STOCK_CLOSED_AT[0];
      text(ctx, STOCK_CLOSED, at.x, at.y, STOCK_CLOSED_SIZE, dark ? '#101010' : '#f0f0f0', 'center');
    }
    return;
  }

  // 表头分两页：行情页是六列行情，持股页是「股票名 + 各玩家 + 保留股份 + 累積盈餘」
  if (page === 0) {
    for (const h of STOCK_HEADERS) text(ctx, h.text, h.x, HDR_Y, 16, '#f0f0f0', 'center');
  } else {
    text(ctx, '股票名稱', STOCK_HEADERS_PAGE1.name, HDR_Y, 16, '#f0f0f0', 'center');
    for (let p = 0; p < view.playerNames.length; p++) {
      text(
        ctx, view.playerNames[p] ?? '',
        STOCK_HEADERS_PAGE1.playerFirst + p * STOCK_HEADERS_PAGE1.playerStep,
        HDR_Y, 16, '#f0f0f0', 'center',
      );
    }
    text(ctx, '保留股份', STOCK_HEADERS_PAGE1.retained, HDR_Y, 16, '#f0f0f0', 'center');
    text(ctx, '累積盈餘', STOCK_HEADERS_PAGE1.surplus, HDR_Y, 16, '#f0f0f0', 'center');
  }

  // 高亮：悬停与选中都是**整行白框** @source `loc_0042ac9e` / `loc_00429745`
  for (const row of [view.hover, view.selected]) {
    if (row === null || row < 0 || row >= STOCK_ROWS.count) continue;
    const r = stockRowRect(row);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // ★ 选股模式（紅卡/黑卡）：悬停反馈是**白框**，不是上面那种填充
  //   @source `loc_0042ac9e` 的 `fcn_0045620f(…, 0xffffff)`
  const pick = view.pickHover;
  if (pick !== undefined && pick !== null && pick >= 0 && pick < STOCK_ROWS.count) {
    ctx.fillStyle = '#ffffff';
    for (const r of stockPickFrameRects(pick)) ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  for (let i = 0; i < view.rows.length && i < STOCK_ROWS.count; i++) {
    const row = view.rows[i]!;
    const y = stockRowTextY(i);
    const color = stockStatusColor(row.status);
    // ★ 涨跌 / 交易量是**另一张表**：跌停在这里是绿字（成交價那格才是黑字+暗绿框）
    const trend = stockTrendColor(row.status);

    // 名字的字色也跟「有没有对应企业」走 @source `loc_0042b7a9`
    const nc = row.listed ? STOCK_LISTED_COLOR : STOCK_PLAIN_COLOR;
    if (page === 0) {
      if (row.name !== '') text(ctx, row.name, STOCK_VALUE_X.name[0], y, 16, nc, 'center');
      // 漲停／跌停那个底色框画在**成交價那一格**后面
      if (color.box !== null) {
        ctx.fillStyle = color.box;
        ctx.fillRect(STOCK_STATUS_BOX.x, y - 10, STOCK_STATUS_BOX.w, STOCK_STATUS_BOX.h);
      }
      text(ctx, row.price, STOCK_VALUE_X.price, y, 16, color.fg, 'right');
      text(ctx, row.change, STOCK_VALUE_X.change, y, 16, trend, 'right');
      if (row.volume === null) {
        text(ctx, STOCK_SUSPENDED, STOCK_VALUE_X.suspended, y, 16, '#f0f0f0', 'center');
      } else {
        text(ctx, row.volume, STOCK_VALUE_X.volume, y, 16, trend, 'right');
      }
      // 持股那两列：有对应企业时是青字，否则白字
      const hc = row.listed ? STOCK_LISTED_COLOR : STOCK_PLAIN_COLOR;
      if (row.shares !== null) {
        text(ctx, row.shares, STOCK_VALUE_X.shares, y, 16, hc, 'right');
        text(ctx, row.cost ?? '', STOCK_VALUE_X.cost, y, 16, hc, 'right');
      }
    } else {
      // 图 1 那页：名字 + 各玩家持股数（每格 80）+ 保留股份 + 累積盈餘
      if (row.name !== '') text(ctx, row.name, STOCK_VALUE_X.name[1], y, 16, nc, 'center');
      const hc = row.listed ? STOCK_LISTED_COLOR : STOCK_PLAIN_COLOR;
      for (let p = 0; p < row.holders.length; p++) {
        const n = row.holders[p] ?? 0;
        if (n === 0) continue;
        const hx = STOCK_HOLDER_X + p * STOCK_HOLDER_STEP;
        // 董事长那一格：蓝底 + 黄字 @source `loc_00429ba1`
        if (row.boss === p + 1) {
          ctx.fillStyle = STOCK_BOSS_MARK.box;
          ctx.fillRect(hx + STOCK_BOSS_MARK.dx, y - 10, STOCK_BOSS_MARK.w, STOCK_BOSS_MARK.h);
          text(ctx, comma(n), hx, y, 16, STOCK_BOSS_MARK.fg, 'right');
          continue;
        }
        text(ctx, comma(n), hx, y, 16, hc, 'right');
      }
      text(ctx, row.retained, STOCK_RETAINED_X, y, 16, hc, 'right');
      text(ctx, row.surplus, STOCK_VALUE_X.cost, y, 16, hc, 'right');
    }
  }

}

/** 表头那一行的 y（烘在图里，y=64）*/
const HDR_Y = 64;
/** 两页标题（烘在图里，x=70,y=24）—— ⚠️ 原版就是反的，见文件头 */
const PAGE_TITLES = ['持有股數表', '股 價 表'] as const;
/** 保留股份那一列（值）@source `push 0x208` */
const STOCK_RETAINED_X = 0x208;
