/*
 * 新聞／命運事件表
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 由 rich4.exe 的两张函数指针表提取：
 *   新聞 `events_calls_table[]`  @ VA 0x00475e24（36 项）
 *   命運 `fortune_call_table[]`  @ VA 0x00475ef0（37 项）
 *   复核：`python3 tools/disasm.py scan news all` / `scan fortune all`
 *
 * `factor`：该事件的金额 = `物价指数 × factor`。
 *   原版用 `shl/add/sub` 移位链凑乘法，没有现成立即数可读，
 *   故由符号执行还原。还原出的系数**全部是整百**，这条不变式本身
 *   就是还原正确的佐证（见测试）。`null` 表示不涉及固定金额
 *   （可能是百分比、天数、或作用于企业而非玩家）。
 *
 * `text`：原版提示语，含 `#NNNN` 编号前缀与 `%d`/`%s` 占位符。
 *   `stripEventCode()` 可去掉编号前缀。
 *   （素材约束见 DEVELOPMENT_PLAN.md 的 C-LEG-2：本项目为个人练习，
 *   文案入库；图素／音乐等大体积二进制仍不入库。）
 */

/** 一条事件的结构信息 */
export interface EventEntry {
  id: number;
  /** 效果函数在原版 exe 中的虚拟地址 */
  va: number;
  /** 金额系数：金额 = 物价指数 × factor；null 表示不适用 */
  factor: number | null;
  /**
   * 该事件触达的关键效果，由**控制流可达性**分析得出
   * （从事件函数入口做有界遍历，看能走到哪个已知函数）：
   *
   * - `pay`      → `pay_money(current, -1, 金额, 0)`：进公库，
   *                **含存款级联与破产判定**
   * - `give`     → `give_money(current, 金额, 1)`（VA 0x0041d3f4）：
   *                **直接加现金**，无级联、不会破产
   * - `prison`   → `send_to_prison`
   * - `hospital` → `send_to_hospital`
   * - `loan`     → 直接给 `player.loan`(+0x24) 加钱（冒貸）
   * - `bankBan`  → `add byte [player+0x3b], 0x1e`，银行拒绝往来 30 天
   *
   * ★ `pay` 与 `give` **不是对称的**——这条差异必须保留。
   *
   * 空数组表示效果不落在以上任何一条上（多半作用于企业或地块，
   * 或尚未分析），并非"无效果"。
   */
  effects: readonly ('pay' | 'give' | 'prison' | 'hospital' | 'loan' | 'bankBan' | 'loanFreeze')[];
  /** 提示文案在 exe 数据段中的虚拟地址 */
  textVa: number;
  /** 原版提示语（BIG5 解码后） */
  text: string;
  /**
   * 文案里 `%d` 处代入的**字面常量**（公告阶段 `mov [0x48c5b4], imm`）。
   *
   * ⚠️ 它的单位由文案决定，**不一定是天数**：
   * - 「坐牢%d天」「住院%d天」→ 天
   * - 「損失股票%d％」→ 百分比
   *
   * 故字段名不叫 days。为 null 表示该事件的 `%d` 来自 `factor × 物价指数`
   * 而非字面常量。
   */
  literal: number | null;
}

/**
 * 去掉文案开头的 `#NNNN` 四位编号。
 * 该前缀是原版的格式码——显示函数 `0x0044fabc` 以 `cmp ah, 0x23`（'#'）
 * 识别并解析它，不是注释。
 */
export function stripEventCode(text: string): string {
  return text.replace(/^#\d{4}/, '');
}

/** 新聞事件，36 项 */
export const NEWS_EVENTS: readonly EventEntry[] = [
  { id: 0, va: 0x00448eca, factor: null, effects: [], textVa: 0x465424, text: "#0149獄中囚犯無罪開釋", literal: null },
  { id: 1, va: 0x00448f45, factor: null, effects: [], textVa: 0x46543a, text: "#0150獄中囚犯延長刑期%d天", literal: null },
  { id: 2, va: 0x00449006, factor: null, effects: [], textVa: 0x465454, text: "#0151住院中病患提前出院", literal: null },
  { id: 3, va: 0x00449081, factor: null, effects: [], textVa: 0x46546c, text: "#0152住院中病患延長住院%d天", literal: null },
  { id: 4, va: 0x0044913d, factor: null, effects: ['hospital'], textVa: 0x465488, text: "#0153外星人攻打地球", literal: null },
  { id: 5, va: 0x004492a0, factor: null, effects: [], textVa: 0x46549c, text: "#0154外星怪獸襲擊%s\n摧毀建築一棟", literal: null },
  { id: 6, va: 0x004494e0, factor: null, effects: [], textVa: 0x4654bd, text: "#0155%s公告地價調漲３０％", literal: null },
  { id: 7, va: 0x00449735, factor: null, effects: [], textVa: 0x4654e4, text: "#0156公開拍賣%s\n公有土地一處", literal: null },
  { id: 8, va: 0x004498b3, factor: 10000, effects: ['give'], textVa: 0x465501, text: "#0157公開表揚第一大地主\n%s獲得%d元獎勵", literal: null },
  { id: 9, va: 0x00449a8a, factor: 5000, effects: ['give'], textVa: 0x465528, text: "#0158公開補助土地最少者\n%s獲得%d元補助", literal: null },
  { id: 10, va: 0x00449b9c, factor: 10000, effects: ['give'], textVa: 0x46554f, text: "#0159公開表揚股市第一大戶\n%s獲得%d元獎勵", literal: null },
  { id: 11, va: 0x00449c7c, factor: null, effects: ['pay'], textVa: 0x465578, text: "#0160所有人繳交所得稅５％", literal: null },
  { id: 12, va: 0x00449de6, factor: null, effects: ['pay'], textVa: 0x4655ac, text: "#0161所有人繳交地價稅５％", literal: null },
  { id: 13, va: 0x0044a029, factor: null, effects: ['pay'], textVa: 0x4655d4, text: "#0162所有人繳交證交稅５％", literal: null },
  { id: 14, va: 0x0044a220, factor: null, effects: [], textVa: 0x4655fc, text: "#0163%s房屋鬧鬼\n地價下跌３０％", literal: null },
  { id: 15, va: 0x0044a453, factor: null, effects: [], textVa: 0x465624, text: "#0164%s一處民宅瓦斯爆炸\n房屋失火", literal: null },
  { id: 16, va: 0x0044a5d6, factor: null, effects: [], textVa: 0x465645, text: "#0165豪雨特報\n行人休息一回合", literal: null },
  { id: 17, va: 0x0044a657, factor: null, effects: [], textVa: 0x465662, text: "#0166交通阻塞\n汽車停止一回合", literal: null },
  { id: 18, va: 0x0044a6e0, factor: null, effects: [], textVa: 0x46567f, text: "#0167%s強烈地震房屋倒塌", literal: null },
  { id: 19, va: 0x0044a91e, factor: null, effects: [], textVa: 0x465697, text: "#0168%s山洪爆發土地流失", literal: null },
  { id: 20, va: 0x0044ab2c, factor: null, effects: [], textVa: 0x4656af, text: "#0169超級颱風侵襲%s\n多處房屋受損", literal: null },
  { id: 21, va: 0x0044ac99, factor: null, effects: [], textVa: 0x4656d0, text: "#0170龍捲風侵襲%s\n摧毀房屋一棟", literal: null },
  // @source 0x0044aeb6 `mov bh, 0xf` → 所有在场玩家 +0x3c = 15（0x0044aed2）
  { id: 22, va: 0x0044ae89, factor: null, effects: ['loanFreeze'], textVa: 0x4656ef, text: "#0171銀行擠兌停止放款１５天", literal: null },
  { id: 23, va: 0x0044aedb, factor: null, effects: ['give'], textVa: 0x46570b, text: "#0172銀行加發１０％儲金紅利", literal: null },
  { id: 24, va: 0x0044b00a, factor: null, effects: [], textVa: 0x46573c, text: "#0173股市低迷不振重挫崩盤", literal: null },
  { id: 25, va: 0x0044b055, factor: null, effects: [], textVa: 0x465756, text: "#0174股市氣勢如虹全面上漲", literal: null },
  { id: 26, va: 0x0044b0a0, factor: null, effects: [], textVa: 0x465770, text: "#0175股市暫停交易１０天", literal: null },
  { id: 27, va: 0x0044b0d1, factor: null, effects: [], textVa: 0x465788, text: "#0176%s股票暫停交易１０天", literal: null },
  { id: 28, va: 0x0044b1a3, factor: null, effects: [], textVa: 0x4657a2, text: "#0177%s股票恢復上市交易", literal: null },
  { id: 29, va: 0x0044b25b, factor: null, effects: ['prison'], textVa: 0x4657ba, text: "#0178%s違法超貸\n經營者%s坐牢５天", literal: null },
  { id: 30, va: 0x0044b374, factor: null, effects: [], textVa: 0x4657db, text: "#0179%s工廠排放污水\n罰款10000元", literal: null },
  { id: 31, va: 0x0044b419, factor: null, effects: [], textVa: 0x4657fb, text: "#0180%s海外投資\n獲利20000元", literal: null },
  { id: 32, va: 0x0044b4a8, factor: null, effects: [], textVa: 0x465817, text: "#0181%s海外投資\n虧損20000元", literal: null },
  { id: 33, va: 0x0044b53f, factor: null, effects: [], textVa: 0x465833, text: "#0182%s違規開發山坡地\n罰款10000元", literal: null },
  { id: 34, va: 0x0044b57d, factor: null, effects: [], textVa: 0x465855, text: "#0183%s製造噪音公害\n罰款5000元", literal: null },
  { id: 35, va: 0x0044b5f5, factor: null, effects: [], textVa: 0x465874, text: "#0184%s獲利調高一倍", literal: null },
];

/** 命運事件，37 项 */
export const FORTUNE_EVENTS: readonly EventEntry[] = [
  { id: 0, va: 0x0044be16, factor: null, effects: ['give'], textVa: 0x465915, text: "#0185強制拆除房屋一棟", literal: null },
  { id: 1, va: 0x0044bfb1, factor: null, effects: ['give'], textVa: 0x46592b, text: "#0186強制徵收土地一處", literal: null },
  { id: 2, va: 0x0044c0e8, factor: 10000, effects: ['loan'], textVa: 0x465941, text: "#0187人頭被盜用冒貸%d元", literal: null },
  { id: 3, va: 0x0044c229, factor: null, effects: ['bankBan'], textVa: 0x465959, text: "#0188支票跳票\n銀行拒絕往來一個月", literal: null },
  { id: 4, va: 0x0044c2c2, factor: null, effects: ['pay'], textVa: 0x46597a, text: "#0189侵入銀行電腦\n挪用其他人存款%d％", literal: null },
  { id: 5, va: 0x0044c3b7, factor: null, effects: [], textVa: 0x4659a4, text: "#0190今天是你生日\n向每人收取一張卡片", literal: null },
  { id: 6, va: 0x0044c5d8, factor: null, effects: [], textVa: 0x4659d8, text: "#0191強迫出國觀光%d天", literal: 3 },
  { id: 7, va: 0x0044c6ed, factor: null, effects: [], textVa: 0x4659ee, text: "#0192被外星人綁架%d天", literal: 3 },
  { id: 8, va: 0x0044c7ef, factor: null, effects: [], textVa: 0x465a04, text: "#0193股票違約交割損失股票%d％", literal: 10 },
  { id: 9, va: 0x0044c91f, factor: null, effects: [], textVa: 0x465a28, text: "#0194變賣所有股票求現", literal: null },
  { id: 10, va: 0x0044ca46, factor: null, effects: [], textVa: 0x465a3e, text: "#0195機車被偷遺失", literal: null },
  { id: 11, va: 0x0044cb53, factor: null, effects: [], textVa: 0x465a50, text: "#0196汽車撞電線桿全毀", literal: null },
  { id: 12, va: 0x0044cc53, factor: null, effects: ['hospital'], textVa: 0x465a66, text: "#0197掉進水溝就醫%d天", literal: 3 },
  { id: 13, va: 0x0044cd6c, factor: null, effects: ['hospital'], textVa: 0x465a7c, text: "#0198騎機車摔傷住院%d天", literal: 3 },
  { id: 14, va: 0x0044cd99, factor: 3000, effects: ['pay'], textVa: 0x465a94, text: "#0199行人闖越馬路罰款%d元", literal: null },
  { id: 15, va: 0x0044cf1e, factor: 3000, effects: ['pay'], textVa: 0x465aae, text: "#0200騎機車未戴安全帽\n罰款%d元", literal: null },
  { id: 16, va: 0x0044d06d, factor: 3000, effects: ['pay'], textVa: 0x465acd, text: "#0201汽車超速罰款%d元", literal: null },
  { id: 17, va: 0x0044d0d6, factor: 6000, effects: ['pay'], textVa: 0x465ae3, text: "#0202請所有人吃大餐\n花費%d元", literal: null },
  { id: 18, va: 0x0044d1a5, factor: 600, effects: ['pay'], textVa: 0x465b00, text: "#0203亂丟垃圾罰款%d元", literal: null },
  { id: 19, va: 0x0044d1e0, factor: 1500, effects: ['pay'], textVa: 0x465b16, text: "#0204你家小狗亂大小便\n罰款%d元", literal: null },
  { id: 20, va: 0x0044d224, factor: 1000, effects: ['give'], textVa: 0x465b35, text: "#0205在路邊撿到%d元", literal: null },
  { id: 21, va: 0x0044d33b, factor: 2000, effects: ['give'], textVa: 0x465b49, text: "#0206在路邊撿到%d元", literal: null },
  { id: 22, va: 0x0044d3db, factor: 3000, effects: ['give'], textVa: 0x465b5d, text: "#0207在路邊撿到%d元", literal: null },
  { id: 23, va: 0x0044d41e, factor: 1000, effects: ['pay'], textVa: 0x465b71, text: "#0208遺失錢包損失%d元", literal: null },
  { id: 24, va: 0x0044d462, factor: 2000, effects: ['pay'], textVa: 0x465b87, text: "#0209遺失錢包損失%d元", literal: null },
  { id: 25, va: 0x0044d4a6, factor: 10000, effects: ['give'], textVa: 0x465b9d, text: "#0210意外獲得遺產%d元", literal: null },
  { id: 26, va: 0x0044d4e7, factor: 8000, effects: ['pay'], textVa: 0x465bb3, text: "#0211被倒會損失%d元", literal: null },
  { id: 27, va: 0x0044d52b, factor: 4000, effects: ['give'], textVa: 0x465bc7, text: "#0212發票中獎%d元", literal: null },
  { id: 28, va: 0x0044d56e, factor: 6000, effects: ['give'], textVa: 0x465bd9, text: "#0213發票中獎%d元", literal: null },
  { id: 29, va: 0x0044d5b1, factor: 8000, effects: ['give'], textVa: 0x465beb, text: "#0214發票中獎%d元", literal: null },
  { id: 30, va: 0x0044d5f4, factor: 5000, effects: ['pay'], textVa: 0x465bfd, text: "#0215付保險金%d元", literal: null },
  { id: 31, va: 0x0044d636, factor: 5000, effects: ['give'], textVa: 0x465c0f, text: "#0216領取保險金%d元", literal: null },
  { id: 32, va: 0x0044d677, factor: null, effects: [], textVa: 0x465c23, text: "#0217變賣所有卡片道具", literal: null },
  { id: 33, va: 0x0044d783, factor: null, effects: ['prison'], textVa: 0x465c39, text: "#0218酒醉大鬧警局坐牢%d天", literal: 3 },
  { id: 34, va: 0x0044d8cf, factor: null, effects: ['prison'], textVa: 0x465c53, text: "#0219防礙風化坐牢%d天", literal: 5 },
  { id: 35, va: 0x0044d8fd, factor: null, effects: ['prison'], textVa: 0x465c69, text: "#0220走私毒品坐牢%d天", literal: 7 },
  { id: 36, va: 0x0044d92b, factor: null, effects: ['prison'], textVa: 0x465c7f, text: "#0221販賣大補帖坐牢%d天", literal: 9 },
];

export function newsEvent(id: number): EventEntry | undefined {
  return NEWS_EVENTS.find((e) => e.id === id);
}

export function fortuneEvent(id: number): EventEntry | undefined {
  return FORTUNE_EVENTS.find((e) => e.id === id);
}

/** 金额 = 物价指数 × factor */
export function eventAmount(entry: EventEntry, priceIndex: number): number {
  return entry.factor === null ? 0 : entry.factor * priceIndex;
}
