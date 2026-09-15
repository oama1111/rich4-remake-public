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
   * **全局库存**的初始值（不是每个玩家的持有量）。
   *
   * ★ 语义已由 `give_tool`（VA 0x00445a4d）确定：
   *   编号 ≤ 8 的道具发放时会查 `stock[toolId]`，为 0 就发不出来，
   *   发一个扣一个；`take_tool`（0x00445aa2）收回时再加回去。
   *   编号 > 8 的**根本不查库存**——`cmp edx, 8 / jg 跳过`。
   *
   * ⚠️ 先前把它读成「初始道具堆数量」并据此认为后 5 个道具
   *   「只能通过商店/事件获得」——**那是误读**。后 5 个是 0 不代表
   *   稀缺，恰恰相反：它们**不受库存限制**，要多少有多少。
   *   前 8 个各 10 份才是真正有限的。
   */
  initAmount: number;
  /** 价格 */
  price: number;
  /**
   * @source tool.h f6 —— 取值 {0, 1, 2}。
   *
   * ★ **Q4 结案（2026-09-15）：本字段在原版 exe 里没有任何读取点。**
   *   取证同卡片表：`_tool_table`（0x47fee2）每项 8 字节，f6 的可能地址只有
   *   `0x47fee8 + i*8`（0 基）/ `0x47fee0 + n*8`（1 基）；
   *   整个 `.text` 扫不到这两个地址（见 binary-truth.test.ts 的 `f6 零引用` 断言），
   *   而 name/init/price/f7 都能扫到。
   *
   * 所以它**只是表面数据**。取值分组（纯数据事实）：
   *
   * | f6 | 道具 | 说明 |
   * |---|---|---|
   * | 0 | 1..5 機器娃娃/路障/地雷/定時炸彈/機車 | `initAmount` 10 |
   * | 1 | 6..8 汽車/飛彈/遙控骰子 | `initAmount` 10 |
   * | 2 | 9..13 機器工人/時光機/傳送機/工程車/核子飛彈 | `initAmount` 0 |
   *
   * ⚠️ 「9..13 只能由研究所研發、不上商店货架」**不是 f6 在起作用**，而是两条硬编码：
   *   ① 開局进货只填前 8 个（VA 0x004071ba：`[ebx*8+0x47fee6] → remain_tool_amount[ebx]`，
   *      `cmp ebx, 8 / jl`），商店货架又只扫 `remain_tool_amount[0..7]`
   *      （VA 0x0042ec23），所以 9..13 永远不上架；
   *   ② 研究所完工时直接发 `道具 = 項目 + 8`（VA 0x0041ce1b `add eax, 8`、
   *      0x0041ce25 `call 0x445a4d receive_tool`；項目取自 `[facility+0x1d]`，0x0041ce18），
   *      而項目 = 研究所等级（VA 0x004411e9..0x004411f8，等级上限 5）→ 恰好是 9..13。
   *   原版意图（疑似「取得途径」/编辑器字段）**未解，不许猜**。
   *   登记在 `docs/known-deviations.md` 的 Q4。
   */
  f6: number;
  /**
   * ★ **凶狠度 0..2**（语义名 `ferocity`）—— 与卡片表 f7 同义。
   *   AI 用道具的個性闸门 `f7 − 個性 ≥ 2/==1/≤0`：
   *   公佈欄挂牌候选 0x0042899b、AI 逛店卖出 0x0042ee64 / 0x0042f289、
   *   统一的 `personalityAllows` 出口 0x00420ea0。见 core/ai/personality.ts。
   */
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
