/*
 * 「此刻该谁拿主意」—— 联机提交权的唯一判据
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么不能直接用 `state.currentPlayer`：
 *   绝大多数待决交互都属于**回合主人**（他落在格子上，引擎才问他「買不買」），
 *   唯独**拍賣**不是 —— 整场竞价挂在出卡人/落点人那个回合里，四家**轮流**举牌，
 *   轮到谁由 `pending.seat` 决定，与 `currentPlayer` 无关（原版 `[0x48c4a4] & 3`）。
 *
 *   单机下这不成问题：只有一块屏，谁的牌都在这块屏上点（热座）。
 *   联机下「只收回合主人的意图」就会互锁（issue #9）：回合主人是电脑座、
 *   下一个举牌的是真人时，电脑那一端没有页面、真人那一端没有提交权，
 *   拍卖永远收不了场。反过来（回合主人是真人、轮到**别的**真人举牌）虽不卡死，
 *   却等于让回合主人替别人出价 —— 同样不对。
 *
 * ⇒ 联机契约：**谁举牌谁提交**。竞价期间的提交权属于 `pending.bidders[pending.seat]`，
 *   其余时刻属于 `currentPlayer`。服务器的定序器、代打循环与客户端的拍賣屏
 *   都只认这一个函数，不各写各的判据。
 *
 * （`birthdayCard` 的 `seats[0]` 是**被挑牌的人**，拿主意的仍是寿星 = 回合主人，
 *   故不在此列。日后若再出现「非回合主人作答」的交互，加在这里。）
 */

import type { GameState } from '../state/types.ts';
import { cardPassiveHolder } from '../rules/interaction.ts';

/** 此刻在等哪个座位（玩家下标）拿主意 */
export function actingSeat(state: GameState): number {
  const p = state.pending;
  // ★★ 卡片路径里被打的那一位答他的被动卡（免費卡 / 嫁禍卡）—— 答的是**持卡人**，不是出牌者
  //   （`0x444a60` / `0x44476a` 真人支问的是 `[esp+..]` 那个持卡人，见 `CardPassiveTail`）
  const holder = cardPassiveHolder(p);
  if (holder >= 0) return holder;
  // 只认**完整**的拍賣 pending（带 seat 那一支）；刚挂出来的「开拍请求」还没人举牌
  if (p !== null && p.kind === 'auction' && 'seat' in p) {
    const bidder = p.bidders[p.seat];
    if (bidder !== undefined) return bidder;
  }
  return state.currentPlayer;
}
