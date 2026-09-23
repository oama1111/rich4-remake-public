/*
 * 联机旁观：跟着行动者收场（第十二份試玩回報续）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 问题
 *
 * 两位真人联机时，行动的那位把整屏演出（訊息框 / 事件框 / 转盘 / 老虎机 / 月結 …）点掉就接着走了，
 * 另一位的客户端还按自己的计时一段一段放完 —— 越落越远（回报 #1 魔法屋是其中最显眼的一例）。
 * 需求方拍板：**所有点得掉的整屏提示，在旁观端都跟着行动者一起关**。
 *
 * ## 信号：「收件箱队首是别的真人座位派的下一条」
 *
 * 真人那一台**要等自己台上的演出全部收场**才会派下一条 action：
 *   - 回合驱动（`scheduleHumanTurn` / `scheduleAi`）每一步先过 `holdForActorWalk`（`stageBusy()` +
 *     台词），`BLOCKING_PRESENTATIONS` 那几屏在的时候不派；
 *   - 手点的那些（GO / 买地框 / 拍卖举牌 …）画在演出屏**底下**，演出接管整屏时点不到；
 *   - 魔法屋的点选在**关窗那一刻**才派（`magic-screen.ts` 的 `closeWindow`）。
 * 而服务器**不替在线真人出手**（`hub.ts` 的 `#driveComputers` 只驱动电脑 / 掉线接管 / 超时託管）
 * ⇒ 队首那条若是某位**由自己客户端驱动的真人**派的，他那台已经把**此前所有 action** 的演出演完了。
 * 本台此刻还在演的、还排着队的，全都属于这些已施加的 action ⇒ 直接落到终态。
 *
 * 「谁派的」不需要改协议：由锁步镜像反推（core `clientDrivenSender`，推理与服务器端的真值核对
 * 见那个文件）—— 施加队首**之前**的 `actingSeat`（平时是回合主人，拍賣时是举牌者），
 * 且那一位在镜像里是「活着、真人、不带託管位」（掉线接管与超时託管都先广播 `setAi(… | AUTOPILOT)`）。
 *
 * ## 边界
 *
 * | 队首 | 跟不跟 | 理由 |
 * |---|---|---|
 * | 电脑座位的（服务器替它出） | 否 | 服务器同一瞬间把整串算完广播，不代表任何人点了什么 |
 * | 掉线接管 / 超时託管的真人（`whoPlays` 带 AUTOPILOT）| 否 | 同上，是服务器在出手 |
 * | 真人自己开了託管（同样带 AUTOPILOT）| 否（保守） | 他的客户端仍会等演出，但分不出是不是服务器替他举的牌（拍賣） |
 * | `setAi` | 否 | 服务器的系统 action（接管 / 归还），也可能是真人自己点託管钮 —— 都不代表演出收场 |
 * | `aiNext` | 否 | AI 决策链的内部簿记，只有 AI 座位会有 |
 * | 本机座位的 | 否 | 本机的回合驱动本来就等着本机的演出（掷骰回包另有 `awaitingOwnRoll` 放行） |
 * | 出局的座位 | 否 | 不是「真人在点」 |
 * | 别的真人（含拍賣时举牌的那位，哪怕回合主人是本机或电脑）| **是** | 见上 |
 *
 * 「这段演出是谁的事」**不看**：别人付我过路费、那扇訊息框讲的是我的钱 —— 仍然跟着
 * 行动的那位（他才是那一刻在点的人）。
 *
 * 纯函数、无 DOM，单测见 `follow-presenter.test.ts`。
 */

import { clientDrivenSender, type Action, type GameState } from '@rich4/core';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/**
 * 收件箱队首那条 action 说明「行动者那台已经收场」吗。
 *
 * = 它是某位真人**自己的客户端**派的（core `clientDrivenSender`，由锁步镜像反推），而且不是本机。
 *
 * @param state 本台镜像（**施加队首之前**）
 * @param head 收件箱队首（还没施加）
 * @param localSeat 本机座位；未入座（纯旁观）为 `null`
 */
export function presenterMovedOn(state: GameState, head: Action, localSeat: number | null): boolean {
  const sender = clientDrivenSender(state, head);
  return sender !== null && sender !== localSeat;
}

/**
 * 把登记表里**演出类**的那几屏（`ids`，即 `main.ts` 的 `BLOCKING_PRESENTATIONS`）一律落到终态。
 *
 * ★ 不只收「此刻接管整屏」的那一屏：同一条 action 可能起了好几段（15 号那天分紅屏 + 開獎屏、
 *   訊息框排队的好几扇、等影片收场才起的老虎机），它们都属于已施加的 action。
 *   每屏的 `fastForward` 在没在播时是空操作，所以逐个问一遍即可。
 *
 * @returns 真的收掉了的那几屏的 `id`（按登记表顺序）
 */
export function fastForwardPresentations(
  screens: readonly UiScreen[],
  ids: ReadonlySet<string>,
  env: UiScreenEnv,
): string[] {
  const closed: string[] = [];
  for (const s of screens) {
    if (!ids.has(s.id) || s.fastForward === undefined) continue;
    if (s.fastForward(env)) closed.push(s.id);
  }
  return closed;
}
