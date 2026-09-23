/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * `clientDrivenSender` —— 「这条广播是哪位真人自己的客户端派的」（联机旁观跟着行动者收场用）。
 * 对着真服务器的逐条真值核对在 `server/src/client-driven-sender.test.ts`；这里是判据的真值表。
 */
import { describe, expect, it } from 'vitest';
import { clientDrivenSender } from './client-driven-sender.ts';
import type { Action } from '../state/actions.ts';
import type { GameState } from '../state/types.ts';

const HUMAN = 1;
const COMPUTER = 2;
const AUTOPILOT = 0x04;
const DEAD = 0;

/** 只造判据读得到的几格：座位的 `whoPlays`、回合主人、pending */
const st = (whoPlays: number[], currentPlayer: number, pending: unknown = null): GameState =>
  ({ currentPlayer, pending, players: whoPlays.map((w, index) => ({ index, whoPlays: w })) }) as unknown as GameState;

const auction = (bidders: number[], seat: number): unknown => ({
  kind: 'auction',
  entityId: 1,
  basePrice: 1000,
  bidders,
  price: 1000,
  top: -1,
  topCash: 0,
  seat,
  status: ['active', 'active', 'active', 'active'],
  limits: [0, 0, 0, 0],
});

const roll: Action = { type: 'rollDice' };

describe('clientDrivenSender', () => {
  it('回合主人是在线真人 ⇒ 就是他', () => {
    expect(clientDrivenSender(st([HUMAN, HUMAN, COMPUTER, COMPUTER], 1), roll)).toBe(1);
  });

  it('电脑座位 ⇒ null（服务器替它出）', () => {
    expect(clientDrivenSender(st([HUMAN, HUMAN, COMPUTER, COMPUTER], 2), roll)).toBeNull();
  });

  it('真人带託管位（掉线接管 / 超时託管 / 自己开的託管）⇒ null', () => {
    expect(clientDrivenSender(st([HUMAN, HUMAN | AUTOPILOT, COMPUTER, COMPUTER], 1), roll)).toBeNull();
  });

  it('出局的座位 ⇒ null', () => {
    expect(clientDrivenSender(st([HUMAN, DEAD, COMPUTER, COMPUTER], 1), roll)).toBeNull();
  });

  it('拍賣：看举牌者，不看回合主人', () => {
    // 回合主人是电脑 2、轮到真人 1 举牌 ⇒ 1
    const bid: Action = { type: 'auctionBid', bidder: 1, status: 'raise', step: 1 };
    expect(clientDrivenSender(st([HUMAN, HUMAN, COMPUTER, COMPUTER], 2, auction([2, 1, 0], 1)), bid)).toBe(1);
    // 回合主人是真人 0、轮到电脑 3 举牌 ⇒ null（服务器出那一口）
    expect(clientDrivenSender(st([HUMAN, HUMAN, COMPUTER, COMPUTER], 0, auction([0, 3], 1)), bid)).toBeNull();
  });

  it('`setAi`（服务器的系统 action / 託管钮）与 `aiNext` 一律不算', () => {
    const s = st([HUMAN, HUMAN, COMPUTER, COMPUTER], 1);
    expect(clientDrivenSender(s, { type: 'setAi', player: 1, whoPlays: HUMAN | AUTOPILOT } as Action)).toBeNull();
    expect(clientDrivenSender(s, { type: 'aiNext' })).toBeNull();
  });
});
