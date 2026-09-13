/*
 * 卡片数值表（30 张，完整）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_card_table.c（与 rich4-re/csrc/cards.c:11-42 的 cards_table 完全一致）
 * 原版结构 @source rich4-re/csrc/card.h:
 *   typedef struct { const char *name_ptr; uint8_t init_amount, price, f6, f7; } rich4_card;
 */

export interface CardDef {
  /** 卡片编号，**1 基**（原版 card_functions 表的 0 号是 NULL 占位） */
  id: number;
  /** 稳定标识符，供代码引用 */
  key: CardKey;
  /** 原版名称（繁体，原版为 BIG5 编码） */
  name: string;
  /** 牌堆初始张数 @source card.h init_amount */
  initAmount: number;
  /** 价格 @source card.h price */
  price: number;
  /** TODO: semantics unknown @source card.h f6 —— 取值 0 或 2 */
  f6: number;
  /** TODO: semantics unknown @source card.h f7 —— 取值 0、1 或 2 */
  f7: number;
}

export type CardKey =
  | 'junfu' | 'junpin' | 'goudi' | 'huandi' | 'huanwu' | 'zhuanxiang'
  | 'gaijian' | 'paimai' | 'tianshi' | 'emo' | 'guaishou' | 'chaichu'
  | 'qiangduo' | 'tingliu' | 'dongmian' | 'mengyou' | 'xianhai' | 'fuchou'
  | 'jiahuo' | 'mianfei' | 'mianzui' | 'songshen' | 'qingshen' | 'hong'
  | 'hei' | 'chashui' | 'zhangjia' | 'chafeng' | 'tongmeng' | 'wugui';

/**
 * 30 张卡片。顺序即原版 `cards_table[]` 的顺序，
 * `id` = 数组下标 + 1（对应 `card_functions[]` 的下标）。
 */
export const CARDS: readonly CardDef[] = [
  { id: 1,  key: 'junfu',      name: '均富卡', initAmount: 1, price: 200, f6: 2, f7: 2 },
  { id: 2,  key: 'junpin',     name: '均貧卡', initAmount: 2, price: 200, f6: 2, f7: 2 },
  { id: 3,  key: 'goudi',      name: '購地卡', initAmount: 4, price: 35,  f6: 0, f7: 1 },
  { id: 4,  key: 'huandi',     name: '換地卡', initAmount: 4, price: 25,  f6: 0, f7: 0 },
  { id: 5,  key: 'huanwu',     name: '換屋卡', initAmount: 4, price: 20,  f6: 0, f7: 0 },
  { id: 6,  key: 'zhuanxiang', name: '轉向卡', initAmount: 3, price: 20,  f6: 0, f7: 0 },
  { id: 7,  key: 'gaijian',    name: '改建卡', initAmount: 8, price: 15,  f6: 0, f7: 0 },
  { id: 8,  key: 'paimai',     name: '拍賣卡', initAmount: 3, price: 20,  f6: 0, f7: 1 },
  { id: 9,  key: 'tianshi',    name: '天使卡', initAmount: 2, price: 160, f6: 2, f7: 0 },
  { id: 10, key: 'emo',        name: '惡魔卡', initAmount: 1, price: 180, f6: 2, f7: 2 },
  { id: 11, key: 'guaishou',   name: '怪獸卡', initAmount: 2, price: 60,  f6: 0, f7: 2 },
  { id: 12, key: 'chaichu',    name: '拆除卡', initAmount: 5, price: 15,  f6: 0, f7: 1 },
  { id: 13, key: 'qiangduo',   name: '搶奪卡', initAmount: 4, price: 25,  f6: 0, f7: 2 },
  { id: 14, key: 'tingliu',    name: '停留卡', initAmount: 4, price: 20,  f6: 0, f7: 0 },
  { id: 15, key: 'dongmian',   name: '冬眠卡', initAmount: 2, price: 100, f6: 2, f7: 2 },
  { id: 16, key: 'mengyou',    name: '夢遊卡', initAmount: 4, price: 25,  f6: 0, f7: 1 },
  { id: 17, key: 'xianhai',    name: '陷害卡', initAmount: 4, price: 20,  f6: 0, f7: 2 },
  { id: 18, key: 'fuchou',     name: '復仇卡', initAmount: 4, price: 20,  f6: 0, f7: 0 },
  { id: 19, key: 'jiahuo',     name: '嫁禍卡', initAmount: 4, price: 40,  f6: 0, f7: 0 },
  { id: 20, key: 'mianfei',    name: '免費卡', initAmount: 4, price: 25,  f6: 0, f7: 0 },
  { id: 21, key: 'mianzui',    name: '免罪卡', initAmount: 4, price: 25,  f6: 0, f7: 0 },
  { id: 22, key: 'songshen',   name: '送神符', initAmount: 3, price: 10,  f6: 0, f7: 0 },
  { id: 23, key: 'qingshen',   name: '請神符', initAmount: 3, price: 20,  f6: 0, f7: 0 },
  { id: 24, key: 'hong',       name: '紅卡',   initAmount: 3, price: 50,  f6: 0, f7: 0 },
  { id: 25, key: 'hei',        name: '黑卡',   initAmount: 3, price: 30,  f6: 0, f7: 1 },
  { id: 26, key: 'chashui',    name: '查稅卡', initAmount: 4, price: 35,  f6: 0, f7: 1 },
  { id: 27, key: 'zhangjia',   name: '漲價卡', initAmount: 3, price: 35,  f6: 0, f7: 0 },
  { id: 28, key: 'chafeng',    name: '查封卡', initAmount: 3, price: 35,  f6: 0, f7: 1 },
  { id: 29, key: 'tongmeng',   name: '同盟卡', initAmount: 2, price: 40,  f6: 0, f7: 0 },
  { id: 30, key: 'wugui',      name: '烏龜卡', initAmount: 3, price: 70,  f6: 0, f7: 0 },
] as const;

/** 牌堆初始张数总和 —— 洗牌算法的牌袋容量上限（原版缓冲区 128 字节） */
export const TOTAL_INITIAL_CARDS = CARDS.reduce((s, c) => s + c.initAmount, 0);

const byKey = new Map(CARDS.map((c) => [c.key, c]));
const byId = new Map(CARDS.map((c) => [c.id, c]));

export function cardByKey(key: CardKey): CardDef {
  const c = byKey.get(key);
  if (c === undefined) throw new Error(`未知卡片: ${key}`);
  return c;
}

export function cardById(id: number): CardDef | undefined {
  return byId.get(id);
}
