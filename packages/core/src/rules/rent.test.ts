/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 过路费与同盟分账 —— 以落点结算函数 VA 0x00419a9d 起为准
 */

import { describe, expect, it } from 'vitest';
import { makeLand, makePlayer } from '../testing/factories.ts';
import { allianceShareOf, collectRent } from './rent.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';

/** 地主(玩家1)与同盟(玩家2)各有一块「台北市」 */
function scene(over: { ownerRent?: number; allyRent?: number } = {}) {
  const rent = (n: number) => [0, n, 0, 0, 0, 0];
  return [
    makeLand({
      id: 1, name: '台北市', type: LAND_TYPE_HOUSE, owner: 2, level: 1,
      rentByLevel: rent(over.ownerRent ?? 1000),
    }),
    makeLand({
      id: 2, name: '台北市', type: LAND_TYPE_HOUSE, owner: 3, level: 1,
      rentByLevel: rent(over.allyRent ?? 500),
    }),
  ];
}

/** ★ 收款金额直接进存款，故各方存款一律显式归零，别依赖 factory 默认值 */
const players = (allied: boolean) => [
  makePlayer({ index: 0, cash: 100000, moneyInBank: 0 }),
  makePlayer({ index: 1, cash: 0, moneyInBank: 0, alliedPlayer: allied ? 3 : 0 }),
  makePlayer({ index: 2, cash: 0, moneyInBank: 0, alliedPlayer: allied ? 2 : 0 }),
  makePlayer({ index: 3, cash: 0, moneyInBank: 0 }),
];

describe('无同盟：单笔付全额', () => {
  it('地主收到全部租金，进存款', () => {
    const lands = scene();
    const r = collectRent(players(false), lands, 0, lands[0]!, 1);
    expect(r.total).toBe(1000);
    expect(r.shares).toEqual([{ payee: 1, amount: 1000 }]);
    expect(r.players[0]!.cash).toBe(99000);
    expect(r.players[1]!.moneyInBank).toBe(1000);
  });

  it('无主地块不收租', () => {
    const lands = [makeLand({ id: 1, owner: 0 })];
    expect(collectRent(players(false), lands, 0, lands[0]!, 1).total).toBe(0);
  });

  it('自己的地不收租', () => {
    const lands = scene();
    const r = collectRent(players(false), lands, 1, lands[0]!, 1);
    expect(r.total).toBe(0);
    expect(r.shares).toEqual([]);
  });
});

describe('★ 同盟：盟友的同名地块并入收租，再按比例分账', () => {
  it('总额 = 地主份 + 同盟份，分两笔付出', () => {
    const lands = scene({ ownerRent: 1000, allyRent: 500 });
    const r = collectRent(players(true), lands, 0, lands[0]!, 1);

    // ★ 关键：付款方付的是 1500，而不是地主自己的 1000
    expect(r.total).toBe(1500);
    expect(r.players[0]!.cash).toBe(100000 - 1500);

    expect(r.shares).toEqual([
      { payee: 1, amount: 1000 },
      { payee: 2, amount: 500 },
    ]);
    expect(r.players[1]!.moneyInBank).toBe(1000);
    expect(r.players[2]!.moneyInBank).toBe(500);
  });

  it('结盟使收租显著变多', () => {
    const lands = scene({ ownerRent: 1000, allyRent: 500 });
    const solo = collectRent(players(false), lands, 0, lands[0]!, 1);
    const allied = collectRent(players(true), lands, 0, lands[0]!, 1);
    expect(allied.total).toBeGreaterThan(solo.total);
  });

  it('先付地主、后付同盟（顺序照搬原版）', () => {
    const lands = scene();
    const r = collectRent(players(true), lands, 0, lands[0]!, 1);
    expect(r.shares.map((s) => s.payee)).toEqual([1, 2]);
  });
});

describe('★ 分账比例走 float32，保留原版的精度损失', () => {
  it('能整除时与精确值一致', () => {
    expect(allianceShareOf(1000, 500)).toBe(500);
    expect(allianceShareOf(3000, 1000)).toBe(1000);
  });

  it('两份相等时各半', () => {
    expect(allianceShareOf(777, 777)).toBe(777);
  });

  it('同盟份为 0 时不分账', () => {
    expect(allianceShareOf(1000, 0)).toBe(0);
  });

  it('总额为 0 时不除零', () => {
    expect(allianceShareOf(0, 0)).toBe(0);
  });

  it('★ 分账后两份之和恒等于总额（地主得 = 总额 - 同盟得）', () => {
    for (const [a, b] of [[1000, 333], [7, 11], [123457, 98765], [1, 2]]) {
      const total = a! + b!;
      const ally = allianceShareOf(a!, b!);
      expect(total - ally + ally).toBe(total);
      expect(ally).toBeGreaterThanOrEqual(0);
      expect(ally).toBeLessThanOrEqual(total);
    }
  });
});

describe('★ 付租金会动用存款（与买地不同）', () => {
  it('现金不足时从存款补', () => {
    const ps = players(false);
    ps[0] = makePlayer({ index: 0, cash: 400, moneyInBank: 5000 });
    const lands = scene();
    const r = collectRent(ps, lands, 0, lands[0]!, 1);
    expect(r.players[0]!.cash).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(4400);
    expect(r.bankrupted).toBe(false);
  });

  it('两个口袋都空则破产，地主只收到实付部分', () => {
    const ps = players(false);
    ps[0] = makePlayer({ index: 0, cash: 300, moneyInBank: 200 });
    const lands = scene();
    const r = collectRent(ps, lands, 0, lands[0]!, 1);
    expect(r.bankrupted).toBe(true);
    expect(r.shares[0]!.amount).toBe(500); // 不是 1000
    expect(r.players[1]!.moneyInBank).toBe(500);
  });
});

describe('物价指数', () => {
  it('租金按物价指数放大', () => {
    const lands = scene();
    expect(collectRent(players(false), lands, 0, lands[0]!, 7).total).toBe(7000);
  });
});

describe('★ 神明在付款前调整租金', () => {
  const withGod = (god: number) => {
    const ps = players(false);
    ps[0] = makePlayer({ index: 0, cash: 100000, moneyInBank: 0, godInfo: god });
    return ps;
  };
  const lands = () => scene();

  it('大財神附身 → 全免，且无人收到钱', () => {
    const r = collectRent(withGod(2), lands(), 0, lands()[0]!, 1);
    expect(r.baseTotal).toBe(1000);
    expect(r.total).toBe(0);
    expect(r.godAdjusted).toBe(true);
    expect(r.shares).toEqual([]);
    expect(r.players[0]!.cash).toBe(100000);
  });

  it('小財神附身 → 只付一半', () => {
    const r = collectRent(withGod(1), lands(), 0, lands()[0]!, 1);
    expect(r.total).toBe(500);
    expect(r.players[0]!.cash).toBe(99500);
    expect(r.players[1]!.moneyInBank).toBe(500);
  });

  it('大窮神附身 → 加倍付', () => {
    const r = collectRent(withGod(6), lands(), 0, lands()[0]!, 1);
    expect(r.total).toBe(2000);
    expect(r.players[1]!.moneyInBank).toBe(2000);
  });

  it('★ 福神附身不影响租金', () => {
    for (const god of [3, 4]) {
      const r = collectRent(withGod(god), lands(), 0, lands()[0]!, 1);
      expect(r.total).toBe(1000);
      expect(r.godAdjusted).toBe(false);
    }
  });

  it('★ 神明调整后，同盟分账之和仍等于实付总额', () => {
    const ps = players(true);
    ps[0] = makePlayer({ index: 0, cash: 100000, moneyInBank: 0, godInfo: 1 }); // 小財神
    const ls = scene({ ownerRent: 1000, allyRent: 500 });
    const r = collectRent(ps, ls, 0, ls[0]!, 1);

    expect(r.baseTotal).toBe(1500);
    expect(r.total).toBe(750); // 减半
    const got = r.shares.reduce((t, s) => t + s.amount, 0);
    expect(got).toBe(750);
    expect(100000 - r.players[0]!.cash).toBe(750);
  });
});

describe('★ 涨价标记：地主那份租金 ×2 @source 0x00419b09', () => {
  it('无同盟：落点地块 priceStatus 非 0 → 总租金翻倍', () => {
    const lands = scene();
    const raised = lands.map((l, i) => (i === 0 ? { ...l, priceStatus: 0x50 } : l));
    const r = collectRent(players(false), raised, 0, raised[0]!, 1);
    expect(r.total).toBe(2000);
    expect(r.shares).toEqual([{ payee: 1, amount: 2000 }]);
  });

  it('★ 同盟：只有地主那份翻倍，盟友那份不跟着翻', () => {
    // 原版 `add ebp, ebp` 只落在地主租金（ebp）上
    const lands = scene();
    const raised = lands.map((l, i) => (i === 0 ? { ...l, priceStatus: 0x50 } : l));
    const r = collectRent(players(true), raised, 0, raised[0]!, 1);
    expect(r.baseTotal).toBe(2500); // 1000×2 + 500
  });

  it('priceStatus 为 0 不翻倍（回归）', () => {
    const lands = scene();
    expect(collectRent(players(false), lands, 0, lands[0]!, 1).total).toBe(1000);
  });
});
