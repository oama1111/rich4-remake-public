/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 过路费与同盟分账 —— 以落点结算函数 VA 0x00419a9d 起为准
 */

import { describe, expect, it } from 'vitest';
import { makeLand, makePlayer } from '../testing/factories.ts';
import { allianceShareOf, collectRent, rentHostility } from './rent.ts';
import { LAND_TYPE_HOUSE } from './toll.ts';
import { truncTowardZero } from './rounding.ts';

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

  it('★ 恰好 .5 时向零截断（0x419f84 的 `call 0x457dbc`），不是 Math.round', () => {
    // 比例 1/2 精确，实付 1 → 0.5：截断 0、Math.round 1
    expect(allianceShareOf(1, 1, 1)).toBe(0);
    expect(allianceShareOf(1, 1, 1)).toBe(truncTowardZero(Math.fround(Math.fround(1 / 2) * 1)));
    // 实付 3 → 1.5：截断 1、Math.round 2、就近取偶 2
    expect(allianceShareOf(1, 1, 3)).toBe(1);
    // 实付 5 → 2.5：截断 2、Math.round 3
    expect(allianceShareOf(1, 1, 5)).toBe(2);
  });

  it('★ 每一组都与 truncTowardZero 一致', () => {
    for (const [own, ally] of [[1, 1], [3, 1], [7, 11], [1000, 333], [123457, 98765]]) {
      const total = own! + ally!;
      const ratio = Math.fround(ally! / total);
      // ★ 审计订正：乘回去那一步是扩展精度（`fmul dword` 只把比例当单精度读进来），**不再**压回 float32
      expect(allianceShareOf(own!, ally!)).toBe(truncTowardZero(total * ratio));
    }
  });

  it('★ 审计订正：比例是 float32、乘积不是 —— 总额 10、同盟 7 ⇒ 同盟得 6（不是 7）', () => {
    // fround(0.7) = 0.699999988…；10 × 它 = 6.99999988 → 向零 6。旧式把乘积再 fround 成 7.0 → 7
    expect(allianceShareOf(3, 7)).toBe(6);
    // [7, 11]：fround(11/18) × 18 = 10.9999998 → 10
    expect(allianceShareOf(7, 11)).toBe(10);
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

// ============================================================
//  W-69：算进这笔过路费的**每一块地**（那段「一起闪一遍」的演出要用）
// ============================================================

describe('★★ counted —— 「同一条街的连号地块」到底算了几块（W-69）', () => {
  const rent1200 = [0, 1200, 0, 0, 0, 0];
  /** 一条街 4 块（同主人、同名、各 1 级），外加别处一块同名的（别人）与一块自己别名的 */
  function street(over: {
    owner?: number;
    ally?: number;
    allyStreet?: number;
    chain?: number;
    otherStreet?: number;
  } = {}): ReturnType<typeof makeLand>[] {
    const owner = over.owner ?? 2;
    const lands = [
      makeLand({ id: 11, name: '台北市', type: LAND_TYPE_HOUSE, owner, level: 1, rentByLevel: rent1200 }),
      makeLand({ id: 12, name: '台北市', type: LAND_TYPE_HOUSE, owner, level: 1, rentByLevel: rent1200 }),
      makeLand({ id: 13, name: '台北市', type: LAND_TYPE_HOUSE, owner, level: 1, rentByLevel: rent1200 }),
      makeLand({ id: 14, name: '台北市', type: LAND_TYPE_HOUSE, owner, level: 1, rentByLevel: rent1200 }),
      // 别人的同名地（不算）
      makeLand({ id: 15, name: '台北市', type: LAND_TYPE_HOUSE, owner: 4, level: 1, rentByLevel: rent1200 }),
      // 自己别的街（不算）
      makeLand({ id: 16, name: '高雄市', type: LAND_TYPE_HOUSE, owner, level: 1, rentByLevel: rent1200 }),
    ];
    for (let i = 0; i < (over.chain ?? 0); i++) {
      lands.push(makeLand({ id: 30 + i, name: '連鎖', type: 1, owner, level: 1, rentByLevel: rent1200 }));
    }
    for (let i = 0; i < (over.allyStreet ?? 0); i++) {
      lands.push(makeLand({ id: 40 + i, name: '台北市', type: LAND_TYPE_HOUSE, owner: over.ally ?? 3, level: 1, rentByLevel: rent1200 }));
    }
    for (let i = 0; i < (over.otherStreet ?? 0); i++) {
      lands.push(makeLand({ id: 50 + i, name: '台中市', type: LAND_TYPE_HOUSE, owner, level: 1, rentByLevel: rent1200 }));
    }
    return lands;
  }

  it('★★ 金额回归：4 块同街同主、各 1 级 ⇒ 实付 4800 = 1200 × 4（规则不许动）', () => {
    const lands = street();
    const r = collectRent(players(false), lands, 0, lands[0]!, 1);
    expect(r.total).toBe(4800);
    expect(r.baseTotal).toBe(4800);
    expect(r.shares).toEqual([{ payee: 1, amount: 4800 }]);
    expect(r.counted).toEqual([11, 12, 13, 14]);
  });

  it('★ 只有一块地 ⇒ counted 就那一个 id（原版块数 ≤ 1 时整段演出跳过，由 core 判）', () => {
    const lands = [
      makeLand({ id: 21, name: '台北市', type: LAND_TYPE_HOUSE, owner: 2, level: 1, rentByLevel: rent1200 }),
      makeLand({ id: 22, name: '高雄市', type: LAND_TYPE_HOUSE, owner: 2, level: 1, rentByLevel: rent1200 }),
    ];
    const r = collectRent(players(false), lands, 0, lands[0]!, 1);
    expect(r.total).toBe(1200);
    expect(r.counted).toEqual([21]);
  });

  it('★ 有同盟时，同盟者名下的同街地块也算进去（顺序照棋盘顺序）', () => {
    const lands = street({ ally: 3, allyStreet: 2 });
    const r = collectRent(players(true), lands, 0, lands[0]!, 1);
    // 4 块自己的 + 2 块同盟的 = 6 块 ⇒ 金额也含同盟那份
    expect(r.counted).toHaveLength(6);
    expect(r.counted).toEqual([11, 12, 13, 14, 40, 41]);
    expect(r.total).toBe(7200);
  });

  it('★ 連鎖店支：地主名下**每一家**連鎖店（同名与否无关）', () => {
    const lands = street({ chain: 3, otherStreet: 2 });
    const chain = lands.filter((l) => l.type !== LAND_TYPE_HOUSE);
    const r = collectRent(players(false), lands, 0, chain[0]!, 1);
    expect(r.total).toBe(3 * 2000);
    expect(r.counted).toEqual([30, 31, 32]);
  });

  it('★ 无主 / 自己的地：counted 是空的（不收租当然不闪）', () => {
    const lands = street();
    expect(collectRent(players(false), lands, 0, { ...lands[0]!, owner: 0 }, 1).counted).toEqual([]);
    // 自己踩自己的：玩家 1（下标 1）踩 owner 2 的地 = 自己的
    expect(collectRent(players(false), lands, 1, lands[0]!, 1).counted).toEqual([]);
  });

  it('★ 免費卡 / 神明把金额抹成 0 时，counted 仍然照给（原版先标地、后走那段）', () => {
    const ps = players(false);
    ps[0] = makePlayer({ index: 0, cash: 100000, moneyInBank: 0, godInfo: 2 });
    const lands = street();
    const r = collectRent(ps, lands, 0, lands[0]!, 1);
    expect(r.total).toBe(0);
    expect(r.counted).toEqual([11, 12, 13, 14]);
  });
});

describe('★ 2026-09-24 审计：rentHostility / 涨价地的分账分母', () => {
  it('rentHostility：无同盟 → (付款人, 地主, 总额/100)；有同盟 → (总额 − 同盟份)/100 与 同盟份/100，向零', () => {
    const ps = [0, 1, 2].map((i) => makePlayer({ index: i }));
    const a = rentHostility(ps, 0, 1, 0, 1299, 0);
    expect(a[0]!.hostility).toEqual([0, 12, 0, 0]);
    const b = rentHostility(ps, 0, 1, 3, 3000, 1050);
    expect(b[0]!.hostility).toEqual([0, 19, 10, 0]);
    // 小財神减半后「总额 − 同盟份」为负 ⇒ 对地主的敌意下降（有下限 0）
    const hated = ps.map((p, i) => (i === 0 ? { ...p, hostility: [0, 30, 0, 0] } : p));
    const c = rentHostility(hated, 0, 1, 3, 500, 1050);
    expect(c[0]!.hostility).toEqual([0, 25, 10, 0]);
  });

  it('★ 涨价地 + 有同盟：分母用**翻倍后**的地主份（0x00419b0f 在 0x00419cbd 之前）', () => {
    // 地主 1 号（2 级 1200，涨价 ×2 = 2400）与同盟 2 号（同名 2 级 1200）
    const lands = [
      makeLand({ id: 1, owner: 2, level: 2, priceStatus: 0x50 }),
      makeLand({ id: 2, owner: 3, level: 2 }),
    ];
    const ps = [
      makePlayer({ index: 0, cash: 100_000 }),
      makePlayer({ index: 1, alliedPlayer: 3 }),
      makePlayer({ index: 2, alliedPlayer: 2 }),
    ];
    const r = collectRent(ps, lands, 0, lands[0]!, 1);
    expect(r.total).toBe(3600);
    expect(r.allyToll).toBe(1200);
    // 比例 = fround(1200/3600)；同盟得 trunc(3600 × 比例) = 1200，地主得 2400（旧式按 1200/2400 算成 1800/1800）
    const ally = r.shares.find((x) => x.payee === 2)!;
    const owner = r.shares.find((x) => x.payee === 1)!;
    expect(ally.amount).toBe(allianceShareOf(2400, 1200, 3600));
    expect(ally.amount).toBe(1200);
    expect(owner.amount).toBe(2400);
  });
});
