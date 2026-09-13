/*
 * 道具数值表（13 个，完整）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_tool_table.c
 * 结构与卡片同构：{ name_ptr, init_amount, price, f6, f7 }
 */

export interface ToolDef {
  /** 道具编号，**1 基** */
  id: number;
  key: ToolKey;
  /** 原版名称（繁体） */
  name: string;
  /**
   * 初始数量。注意后 5 个道具为 **0**——它们不出现在初始道具堆里，
   * 只能通过商店/事件获得（这是原版设定，不可改）。
   */
  initAmount: number;
  /** 价格 */
  price: number;
  /** TODO: semantics unknown —— 取值 0、1 或 2；疑似"使用时机/目标类型"分类 */
  f6: number;
  /** TODO: semantics unknown —— 取值 0、1 或 2 */
  f7: number;
}

export type ToolKey =
  | 'jiqiwawa' | 'luzhang' | 'dilei' | 'dingshizhadan' | 'jiche' | 'qiche'
  | 'feidan' | 'yaokongtouzi' | 'jiqigongren' | 'shiguangji' | 'chuansongji'
  | 'gongchengche' | 'hezifeidan';

export const TOOLS: readonly ToolDef[] = [
  { id: 1,  key: 'jiqiwawa',      name: '機器娃娃', initAmount: 10, price: 15,  f6: 0, f7: 0 },
  { id: 2,  key: 'luzhang',       name: '路障',     initAmount: 10, price: 30,  f6: 0, f7: 1 },
  { id: 3,  key: 'dilei',         name: '地雷',     initAmount: 10, price: 25,  f6: 0, f7: 1 },
  { id: 4,  key: 'dingshizhadan', name: '定時炸彈', initAmount: 10, price: 25,  f6: 0, f7: 1 },
  { id: 5,  key: 'jiche',         name: '機車',     initAmount: 10, price: 80,  f6: 0, f7: 0 },
  { id: 6,  key: 'qiche',         name: '汽車',     initAmount: 10, price: 150, f6: 1, f7: 0 },
  { id: 7,  key: 'feidan',        name: '飛彈',     initAmount: 10, price: 100, f6: 1, f7: 2 },
  { id: 8,  key: 'yaokongtouzi',  name: '遙控骰子', initAmount: 10, price: 30,  f6: 1, f7: 0 },
  { id: 9,  key: 'jiqigongren',   name: '機器工人', initAmount: 0,  price: 30,  f6: 2, f7: 1 },
  { id: 10, key: 'shiguangji',    name: '時光機',   initAmount: 0,  price: 40,  f6: 2, f7: 2 },
  { id: 11, key: 'chuansongji',   name: '傳送機',   initAmount: 0,  price: 95,  f6: 2, f7: 1 },
  { id: 12, key: 'gongchengche',  name: '工程車',   initAmount: 0,  price: 150, f6: 2, f7: 2 },
  { id: 13, key: 'hezifeidan',    name: '核子飛彈', initAmount: 0,  price: 250, f6: 2, f7: 2 },
] as const;

const byKey = new Map(TOOLS.map((t) => [t.key, t]));
const byId = new Map(TOOLS.map((t) => [t.id, t]));

export function toolByKey(key: ToolKey): ToolDef {
  const t = byKey.get(key);
  if (t === undefined) throw new Error(`未知道具: ${key}`);
  return t;
}

export function toolById(id: number): ToolDef | undefined {
  return byId.get(id);
}
