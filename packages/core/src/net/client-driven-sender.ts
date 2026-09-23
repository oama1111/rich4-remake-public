/*
 * 「这条广播是哪位真人**自己的客户端**派的」—— 从锁步镜像反推，不改协议
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 用途：联机旁观端「跟着行动者收场」（第十二份試玩回報续，`client/follow-presenter.ts`）。
 *   真人的客户端要等自己台上的演出收场才派下一条 ⇒ 收件箱队首若是某位真人**自己**派的，
 *   他那台已经把此前所有 action 的演出演完了。
 *
 * ## 为什么反推得出来
 *
 *   1. 定序器只收 `actingSeat(镜像)` 那一座的意图（`sequencer.ts` 注入的 `currentSeat`），
 *      服务器替人出手也是替 `room.actingSeat` 出；锁步下客户端在**施加这一条之前**的镜像
 *      与服务器受理它那一刻逐字节相同 ⇒ `actingSeat(施加前)` 就是这一条的座位。
 *   2. 那一座是自己的客户端在出、还是服务器在出，服务器只按三件事分（`hub.ts` 的 `#driveComputers`）：
 *      电脑座位 / 掉线接管 / 超时託管 —— 后两种**先广播** `setAi(… | AUTOPILOT)` 再动手，
 *      所以镜像里那一位已经带着託管位；拍賣里电脑那一口（`decideAuctionBid`）也是按镜像的
 *      `isAiControlled` 判的。⇒ 镜像里「活着、真人、不带託管位」的座位，只可能是他自己的客户端在出。
 *   3. `setAi` 由服务器以**系统 action** 发（不属于任何座位的意图），真人自己点託管钮也发它 ——
 *      都不代表「演完了」；`aiNext` 只有 AI 座位会有。这两种一律不算。
 *
 * ⚠️ 保守的一侧：真人**自己**开了託管（镜像里同样带託管位）时，他的客户端仍在出手、也仍等演出，
 *   但本函数认不出（与服务器替他举牌分不开）⇒ 返回 null。宁可少跟一次，不可替电脑跟。
 *
 * 真值由 `server/src/client-driven-sender.test.ts` 对着真的 `RoomHub` 逐条核（2 真人 + 2 电脑，
 * 含拍賣、超时託管、掉线接管）。
 */

import type { Action } from '../state/actions.ts';
import { isAiControlled, isAlive, WHO_PLAYS_HUMAN, WHO_PLAYS_MASK, type GameState } from '../state/types.ts';
import { actingSeat } from './acting-seat.ts';

/**
 * @param before 施加这一条**之前**的镜像
 * @param action 这一条广播
 * @returns 派它的真人座位；服务器替人出的 / 系统 action ⇒ `null`
 */
export function clientDrivenSender(before: GameState, action: Action): number | null {
  if (action.type === 'setAi' || action.type === 'aiNext') return null;
  const seat = actingSeat(before);
  const p = before.players[seat];
  if (p === undefined || !isAlive(p)) return null;
  if ((p.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_HUMAN || isAiControlled(p)) return null;
  return seat;
}
