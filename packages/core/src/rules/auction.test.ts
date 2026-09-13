/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 拍賣 —— 以 run_auction（VA 0x0043bde5）为准
 */

import { describe, expect, it } from 'vitest';
import { makeLand, makePlayer } from '../testing/factories.ts';
import {
  AUCTION_LEVEL_FACTOR,
  auctionBasePrice,
  eligibleBidders,
  settleAuction,
} from './auction.ts';

const four = () =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 }));

describe('★ 起拍价 = round(地价 × (1 + 等级×0.5)) × 物价指数', () => {
  it('等级 0 时就是地价', () => {
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 0 }), 1)).toBe(2000);
  });

  it('每级加半成地价', () => {
    expect(AUCTION_LEVEL_FACTOR).toBe(0.5);
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 1 }), 1)).toBe(3000);
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 2 }), 1)).toBe(4000);
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 5 }), 1)).toBe(7000);
  });

  it('再乘物价指数', () => {
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 1 }), 7)).toBe(21_000);
  });

  it('★ 取整在乘物价指数**之前**', () => {
    // 地价 999、等级 1 → 999×1.5 = 1498.5 → 取偶 → 1498 → ×3 = 4494
    // 若先乘后取整：999×1.5×3 = 4495.5 → 4496，差 2
    expect(auctionBasePrice(makeLand({ landPrice: 999, level: 1 }), 3)).toBe(4494);
  });

  it('★ 取整是就近取偶（与 percentage.ts 同一个 0x457dbc）', () => {
    // 1001 × 1.5 = 1501.5 → 取偶 → 1502
    expect(auctionBasePrice(makeLand({ landPrice: 1001, level: 1 }), 1)).toBe(1502);
    // 999 × 1.5 = 1498.5 → 取偶 → 1498
    expect(auctionBasePrice(makeLand({ landPrice: 999, level: 1 }), 1)).toBe(1498);
  });
});

describe('★ 流拍 → 地块变无主', () => {
  it('原主失去地产，且没人付钱', () => {
    const land = makeLand({ id: 1, owner: 2, level: 3 });
    const r = settleAuction(four(), land, { winner: -1, price: 0 }, 500);
    expect(r.passedIn).toBe(true);
    expect(r.land.owner).toBe(0);
    expect(r.pool).toBe(500);
    expect(r.players.map((p) => p.cash)).toEqual([100_000, 100_000, 100_000, 100_000]);
  });

  it('★ 这是拍賣卡的要害：即便没人接手，原主也失去它', () => {
    const land = makeLand({ owner: 3 });
    expect(settleAuction(four(), land, { winner: -1, price: 0 }).land.owner).toBe(0);
  });
});

describe('得标', () => {
  it('买家付钱、地块易主、款项进公库', () => {
    const land = makeLand({ id: 1, owner: 2 });
    const r = settleAuction(four(), land, { winner: 0, price: 3000 }, 0);
    expect(r.passedIn).toBe(false);
    expect(r.land.owner).toBe(1); // winner + 1
    expect(r.players[0]!.cash).toBe(97_000);
    expect(r.pool).toBe(3000);
  });

  it('★ 与购地卡不同——那张是把钱给原主，这里进公库', () => {
    const r = settleAuction(four(), makeLand({ owner: 2 }), { winner: 0, price: 3000 });
    // 原主（下标 1）分文未得
    expect(r.players[1]!.cash).toBe(100_000);
    expect(r.players[1]!.moneyInBank).toBe(0);
  });

  it('买家钱不够会动存款并可能破产', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, cash: 100, moneyInBank: 50 });
    const r = settleAuction(ps, makeLand({ owner: 2 }), { winner: 0, price: 9999 });
    expect(r.bankrupted).toBe(true);
  });
});

describe('参与资格', () => {
  it('★ 排除现任地主', () => {
    const land = makeLand({ owner: 3 });
    expect(eligibleBidders(four(), land)).toEqual([0, 1, 3]);
  });

  it('排除出局者', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, whoPlays: 0 });
    expect(eligibleBidders(ps, makeLand({ owner: 0 }))).toEqual([0, 2, 3]);
  });

  it('★ 不按现金过滤——是否举得起牌由出价方自己判断', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, cash: 0, moneyInBank: 0 });
    expect(eligibleBidders(ps, makeLand({ owner: 0 }))).toContain(2);
  });
});
