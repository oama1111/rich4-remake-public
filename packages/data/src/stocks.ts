/*
 * 股票数值表（96 支 = 8 张地图 × 12 支）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **由脚本直接从 `Rich4/rich4.exe` 提取**（VA 0x47f072，每项 36 字节），
 *   不经由 rich4-re 的 C 转录。见 docs/reverse-engineering-audit.md。
 *   常驻校验：packages/data/src/binary-truth.test.ts
 *
 * 原版结构 @source rich4-re/asm/rich4_stocks.h `stock_info`：
 *   name_ptr(0) f4(4,u16) f6(6) f7(7) f8(8,u16) f10(10,u16)
 *   f12/f16/f20(float) f24(float) f28(float) f32(u32)
 *   初始表中 f12 == f16 == f20，三者皆为股价。
 */

export interface StockDef {
  /** 原版名称（繁体） */
  name: string;
  /**
   * 该股在地图上是否有对应的上市企业。
   *
   * 初始表中取值 0 或 1；**开局初始化时会被改写成企业下标**
   * @source rich4_stocks.asm `_rich4_init_stock_commercial`：
   *   `mov word [eax*4 + stocks_on_map+4], dx`（dx = 企业下标）
   */
  hasCommercial: number;
  /** TODO: semantics unknown @source stock_info +6（新聞事件 28 依此判定） */
  f6: number;
  /** TODO: semantics unknown @source stock_info +7 */
  f7: number;
  /**
   * 可流通股数 @source stock_info +8 (u16)
   * 买入时 `sub word [+8], amount`，卖出时 `add word [+8], amount`
   */
  shares: number;
  /** TODO: semantics unknown @source stock_info +10 (u16)，与 shares 同步增减 */
  f10: number;
  /** 股价 @source stock_info +20 (float) —— 估值与买卖都取这个字段 */
  price: number;
  /** 波动系数 @source stock_info +24 (float)，取值 0.40 ~ 2.00 */
  volatility: number;
  /** TODO: semantics unknown @source stock_info +28 (float)，初值恒为 0 */
  f28: number;
  /** TODO: semantics unknown @source stock_info +32 (u32)，初值恒为 0 */
  f32: number;
}

/** 每张地图的股票支数 @source `cmp edx, 0xc / jl` */
export const STOCKS_PER_MAP = 12;

/** 全部 96 支股票，按 `地图编号 * 12 + 下标` 排列 */
export const STOCKS: readonly StockDef[] = [
  // ── 地图 0 ──
  { name: '中國信託', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 100, volatility: 1, f28: 0, f32: 0 },
  { name: '臺灣人壽', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 40, volatility: 0.6, f28: 0, f32: 0 },
  { name: '大宇百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 25, volatility: 1.5, f28: 0, f32: 0 },
  { name: '台積電', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 180, volatility: 1.6, f28: 0, f32: 0 },
  { name: '大宇資訊', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 80, volatility: 1.2, f28: 0, f32: 0 },
  { name: '台灣塑膠', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 60, volatility: 1, f28: 0, f32: 0 },
  { name: '裕隆汽車', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 60, volatility: 1.4, f28: 0, f32: 0 },
  { name: '遠東紡織', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 27, volatility: 0.9, f28: 0, f32: 0 },
  { name: '統一超商', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 310, volatility: 0.7, f28: 0, f32: 0 },
  { name: '震旦行', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 66, volatility: 1, f28: 0, f32: 0 },
  { name: '萊爾富', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 171, volatility: 1.4, f28: 0, f32: 0 },
  { name: '聯合報', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 280, volatility: 0.8, f28: 0, f32: 0 },
  // ── 地图 1 ──
  { name: '上海銀行', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 70, volatility: 1.2, f28: 0, f32: 0 },
  { name: '中國人壽', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 36, volatility: 1, f28: 0, f32: 0 },
  { name: '王府井百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 20, volatility: 1.6, f28: 0, f32: 0 },
  { name: '中國石油', hasCommercial: 1, f6: 0, f7: 0, shares: 0, f10: 0, price: 15, volatility: 1.5, f28: 0, f32: 0 },
  { name: '聯想科技', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 300, volatility: 2, f28: 0, f32: 0 },
  { name: '頂新食品', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 296, volatility: 1.8, f28: 0, f32: 0 },
  { name: '東方實業', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 133, volatility: 1.4, f28: 0, f32: 0 },
  { name: '匯豐證券', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 170, volatility: 1.5, f28: 0, f32: 0 },
  { name: '大慶石油', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 121, volatility: 0.8, f28: 0, f32: 0 },
  { name: '長城電機', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 60, volatility: 0.4, f28: 0, f32: 0 },
  { name: '長江建設', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 92, volatility: 0.6, f28: 0, f32: 0 },
  { name: '大眾軟件', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 366, volatility: 1, f28: 0, f32: 0 },
  // ── 地图 2 ──
  { name: '富士銀行', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 160, volatility: 0.8, f28: 0, f32: 0 },
  { name: '三井生命', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 99, volatility: 1.4, f28: 0, f32: 0 },
  { name: '三越百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 22, volatility: 2, f28: 0, f32: 0 },
  { name: '日產建設', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 28, volatility: 2, f28: 0, f32: 0 },
  { name: 'ＳＥＧＡ', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 300, volatility: 1, f28: 0, f32: 0 },
  { name: '豐田汽車', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 35, volatility: 1.2, f28: 0, f32: 0 },
  { name: '松下電機', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 540, volatility: 1, f28: 0, f32: 0 },
  { name: '日立機電', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 830, volatility: 1, f28: 0, f32: 0 },
  { name: 'ＳＯＮＹ', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 300, volatility: 1.2, f28: 0, f32: 0 },
  { name: '三菱工業', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 225, volatility: 0.7, f28: 0, f32: 0 },
  { name: '任天堂', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 300, volatility: 1, f28: 0, f32: 0 },
  { name: '德間書店', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 150, volatility: 0.8, f28: 0, f32: 0 },
  // ── 地图 3 ──
  { name: '花旗銀行', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 200, volatility: 1, f28: 0, f32: 0 },
  { name: '喬治亞人壽', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 55, volatility: 0.8, f28: 0, f32: 0 },
  { name: '環球百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 20, volatility: 2, f28: 0, f32: 0 },
  { name: '聯合航空', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 18, volatility: 1, f28: 0, f32: 0 },
  { name: '福特汽車', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 16, volatility: 1.4, f28: 0, f32: 0 },
  { name: 'ＩＢＭ', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 550, volatility: 2, f28: 0, f32: 0 },
  { name: '德州儀器', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 245, volatility: 1.5, f28: 0, f32: 0 },
  { name: '摩扥羅拉', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 166, volatility: 1.3, f28: 0, f32: 0 },
  { name: '迪士尼', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 955, volatility: 1.4, f28: 0, f32: 0 },
  { name: '可口可樂', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 1030, volatility: 0.8, f28: 0, f32: 0 },
  { name: '麥當勞', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 1440, volatility: 1, f28: 0, f32: 0 },
  { name: '百事可樂', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 310, volatility: 1.2, f28: 0, f32: 0 },
  // ── 地图 4 ──
  { name: '行星銀行', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 50, volatility: 1, f28: 0, f32: 0 },
  { name: '銀河保險', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 40, volatility: 0.6, f28: 0, f32: 0 },
  { name: '宇宙百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 25, volatility: 1.5, f28: 0, f32: 0 },
  { name: '火星移民', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 90, volatility: 1.6, f28: 0, f32: 0 },
  { name: '隕石礦業', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 45, volatility: 1.2, f28: 0, f32: 0 },
  { name: '星球電視', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 60, volatility: 1, f28: 0, f32: 0 },
  { name: '金星科技', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 60, volatility: 1.4, f28: 0, f32: 0 },
  { name: '星海通訊', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 27, volatility: 0.9, f28: 0, f32: 0 },
  { name: '銀河航運', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 110, volatility: 0.7, f28: 0, f32: 0 },
  { name: '月世界旅遊', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 66, volatility: 1, f28: 0, f32: 0 },
  { name: '宇宙地產', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 71, volatility: 1.4, f28: 0, f32: 0 },
  { name: '太陽能電力', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 80, volatility: 0.8, f28: 0, f32: 0 },
  // ── 地图 5 ──
  { name: '聚寶銀樓', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 70, volatility: 1.2, f28: 0, f32: 0 },
  { name: '狂徒鏢局', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 70, volatility: 1, f28: 0, f32: 0 },
  { name: '南北貨場', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 20, volatility: 1.6, f28: 0, f32: 0 },
  { name: '少林派', hasCommercial: 1, f6: 0, f7: 0, shares: 3000, f10: 0, price: 250, volatility: 1.5, f28: 0, f32: 0 },
  { name: '武當派', hasCommercial: 1, f6: 0, f7: 0, shares: 3000, f10: 0, price: 101, volatility: 2, f28: 0, f32: 0 },
  { name: '蜀山派', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 96, volatility: 1.8, f28: 0, f32: 0 },
  { name: '嵩山派', hasCommercial: 1, f6: 0, f7: 0, shares: 6000, f10: 0, price: 120, volatility: 1.4, f28: 0, f32: 0 },
  { name: '恆山派', hasCommercial: 1, f6: 0, f7: 0, shares: 4000, f10: 0, price: 47, volatility: 1.5, f28: 0, f32: 0 },
  { name: '泰山派', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 40, volatility: 0.8, f28: 0, f32: 0 },
  { name: '衡山派', hasCommercial: 1, f6: 0, f7: 0, shares: 4000, f10: 0, price: 30, volatility: 0.4, f28: 0, f32: 0 },
  { name: '華山派', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 90, volatility: 0.6, f28: 0, f32: 0 },
  { name: '逍遙客棧', hasCommercial: 1, f6: 0, f7: 0, shares: 4000, f10: 0, price: 300, volatility: 1, f28: 0, f32: 0 },
  // ── 地图 6 ──
  { name: '黃金銀行', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 60, volatility: 0.8, f28: 0, f32: 0 },
  { name: '肥龍保險', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 33, volatility: 1.4, f28: 0, f32: 0 },
  { name: '飛龍百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 22, volatility: 2, f28: 0, f32: 0 },
  { name: '雷龍電子', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 18, volatility: 2, f28: 0, f32: 0 },
  { name: '侏羅紀影業', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 100, volatility: 1, f28: 0, f32: 0 },
  { name: '長毛象紡織', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 15, volatility: 1.2, f28: 0, f32: 0 },
  { name: '迅猛汽車', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 40, volatility: 1, f28: 0, f32: 0 },
  { name: '恐龍蛋食品', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 30, volatility: 1, f28: 0, f32: 0 },
  { name: '火山岩保險', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 100, volatility: 1.2, f28: 0, f32: 0 },
  { name: '三葉蟲百貨', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 25, volatility: 0.7, f28: 0, f32: 0 },
  { name: '始祖化石', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 100, volatility: 1, f28: 0, f32: 0 },
  { name: '翼龍航空', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 50, volatility: 0.8, f28: 0, f32: 0 },
  // ── 地图 7 ──
  { name: '假期銀行', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 100, volatility: 1, f28: 0, f32: 0 },
  { name: '假期百貨', hasCommercial: 1, f6: 0, f7: 0, shares: 10000, f10: 0, price: 33, volatility: 0.8, f28: 0, f32: 0 },
  { name: '狂徒大飯店', hasCommercial: 1, f6: 0, f7: 0, shares: 3000, f10: 0, price: 500, volatility: 2, f28: 0, f32: 0 },
  { name: '豪華大飯店', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 100, volatility: 1, f28: 0, f32: 0 },
  { name: '第一大飯店', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 130, volatility: 1.4, f28: 0, f32: 0 },
  { name: '金金大飯店', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 150, volatility: 2, f28: 0, f32: 0 },
  { name: '世界大飯店', hasCommercial: 1, f6: 0, f7: 0, shares: 5000, f10: 0, price: 70, volatility: 1.5, f28: 0, f32: 0 },
  { name: '百事可樂', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 66, volatility: 1.3, f28: 0, f32: 0 },
  { name: '狄士尼', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 55, volatility: 1.4, f28: 0, f32: 0 },
  { name: '可口可樂', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 30, volatility: 0.8, f28: 0, f32: 0 },
  { name: '麥當勞', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 44, volatility: 1, f28: 0, f32: 0 },
  { name: '愛迪達', hasCommercial: 0, f6: 0, f7: 0, shares: 10000, f10: 0, price: 30, volatility: 1.2, f28: 0, f32: 0 },
] as const;

/** 取某张地图的 12 支股票 @source game_init.c: memcpy(stocks, &game_stocks[m*12], ...) */
export function stocksOfMap(globalMapId: number): readonly StockDef[] {
  const at = globalMapId * STOCKS_PER_MAP;
  return STOCKS.slice(at, at + STOCKS_PER_MAP);
}
