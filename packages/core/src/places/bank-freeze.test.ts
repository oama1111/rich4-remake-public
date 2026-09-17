/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 銀行暫停放款（player +0x3c，新聞 #171）
 */
import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { applyNewsEffect } from '../events/news-effects.ts';
import { borrow } from './bank.ts';
import { borrowSpecial } from './special-finance.ts';
import { tickTurnCounters } from '../rules/blocking.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';

describe('★ 新聞 #171 銀行擠兌停止放款１５天 @source 0x0044ae89', () => {
  it('所有在场玩家 +0x3c = 15（不看 affected）；出局者不写', () => {
    const players = [0, 1, 2].map((i) => makePlayer({ index: i, whoPlays: i === 2 ? 0 : 1 }));
    const r = applyNewsEffect(22, { players, affected: [0], priceIndex: 1, pool: 0 });
    expect(r.unimplemented).toBe(false);
    expect(r.players.map((p) => p.bankFreezeDays)).toEqual([15, 15, 0]);
  });

  it('停放期内借不到（普通贷款与特別融資都拒）；每輪递减，到 0 挂 0x80', () => {
    const p = makePlayer({ index: 0, bankFreezeDays: 1, cash: 100_000 });
    expect(borrow(p, 1000, 1_000_000).borrowed).toBe(0);
    expect(borrowSpecial([p, makePlayer({ index: 1, moneyInBank: 50_000 })], 0, 1000)).toBeNull();
    const t = tickTurnCounters(p);
    expect(t.player.bankFreezeDays).toBe(RELEASE_PENDING);
    expect(tickTurnCounters(t.player).player.bankFreezeDays).toBe(0);
    expect(borrow({ ...p, bankFreezeDays: 0 }, 1000, 1_000_000).borrowed).toBe(1000);
  });
});
