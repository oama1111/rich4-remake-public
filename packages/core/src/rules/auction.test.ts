/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 拍賣 —— 以 run_auction（VA 0x0043bde5）为准
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from '../state/reduce.ts';
import type { MapTopology } from '../state/reduce.ts';
import { decideAction } from '../ai/policy.ts';
import { WHO_PLAYS_COMPUTER } from '../state/types.ts';
import type { GameState } from '../state/types.ts';
import { parseMap, type Rich4Map } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { housingIndexOf } from '../rules/land.ts';
import {
  AUCTION_LEVEL_FACTOR,
  AUCTION_LIMIT_RAND_DIVISOR,
  AUCTION_RAISE_STEPS,
  auctionAdvanceSeat,
  auctionAiChoice,
  auctionAiLimit,
  auctionAiLimits,
  auctionAiRaise,
  auctionBasePrice,
  auctionCanAfford,
  auctionCardHostility,
  auctionFinished,
  auctionFirstSeat,
  auctionOutcome,
  auctionSeatStatus,
  eligibleBidders,
  settleAuction,
  settleFacilityAuction,
  truncTowardZero,
  type AuctionSeatStatus,
} from './auction.ts';

const four = () =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 }));

describe('★ 起拍价 = trunc(地价 × (1 + 等级×0.5)) × 物价指数', () => {
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
    // 地价 999、等级 1 → 999×1.5 = 1498.5 → trunc → 1498 → ×3 = 4494
    // 若先乘后取整：999×1.5×3 = 4495.5 → trunc → 4495，差 1
    expect(auctionBasePrice(makeLand({ landPrice: 999, level: 1 }), 3)).toBe(4494);
  });

  it('★ 取整是**向零截断**（`__round_toward_zero` @ 0x457dbc，RC=11）', () => {
    // 1001 × 1.5 = 1501.5 → 截断 → 1501（不是就近取偶的 1502）
    expect(auctionBasePrice(makeLand({ landPrice: 1001, level: 1 }), 1)).toBe(1501);
    // 999 × 1.5 = 1498.5 → 截断 → 1498
    expect(auctionBasePrice(makeLand({ landPrice: 999, level: 1 }), 1)).toBe(1498);
    // 负数也向零：-3.5 → -3
    expect(truncTowardZero(-3.5)).toBe(-3);
    expect(truncTowardZero(2.5)).toBe(2);
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

describe('★ 設施起拍价与结算（run_auction 設施分支 0x0043bf3a 起）', () => {
  it('底价公式与地块同式（地价读 +0x22）', () => {
    expect(auctionBasePrice(makeFacility({ landPrice: 4000, level: 2 }), 3)).toBe(4000 * 2 * 3);
  });

  it('流拍 → 設施变无主', () => {
    const r = settleFacilityAuction(four(), makeFacility({ id: 1, owner: 2, level: 1 }), { winner: -1, price: 0 });
    expect(r.passedIn).toBe(true);
    expect(r.facility.owner).toBe(0);
  });

  it('得标：买家付款进公库、設施归得标者', () => {
    const r = settleFacilityAuction(four(), makeFacility({ id: 1, owner: 2, level: 1 }), { winner: 3, price: 5000 }, 0);
    expect(r.facility.owner).toBe(4);
    expect(r.players[3]!.cash).toBe(95_000);
    expect(r.pool).toBe(5000);
  });
});

describe('★ 拍賣卡敌意 = double 压栈的原版 bug（0x00443286 起）', () => {
  it('常规地价：double 尾数低 32 位为 0 → 敌意恒为 0', () => {
    // 1000 × 1 × (0+2)/5 = 400.0 → 0x4079000000000000，低 32 位 = 0
    expect(auctionCardHostility(1000, 0, 1)).toBe(0);
    // 2000 × 3 × (4+2)/5 = 7200.0 → 低 32 位仍为 0
    expect(auctionCardHostility(2000, 4, 3)).toBe(0);
  });

  it('特大数值：低 32 位是尾数垃圾（可为负），照原样复刻', () => {
    // 10485765 × 1 × (0+2)/5 = 4194306.0 = 2^22 + 2
    //   尾数 2^-21 落在低 32 位最高位 → 0x80000000 → int32 最小值
    expect(auctionCardHostility(10485765, 0, 1)).toBe(-2147483648);
  });

  it('公式本身是 地价 × 物价 × (等级+2)/5（fadd 2.0 / fdiv 5.0）', () => {
    // 选一个低 32 位恰有非零尾数的值验证公式：3×(0+2)/5 = 1.2 →
    // 1.2 = 0x3FF3333333333333 → 低 32 位 = 0x33333333
    expect(auctionCardHostility(3, 0, 1)).toBe(0x33333333);
  });
});

// ============================================================
//  ★ AI 出价：心理价位 fcn_00439f0d @ 0x00439f0d + 挑档 loc_0043b124 @ 0x0043b124
// ============================================================

describe('★ AI 心理价位 auctionAiLimit（fcn_00439f0d）', () => {
  /** 序列恒为 0 或 0.5 的假随机源（0 → rand() = 0；0.5 → rand() = 16384） */
  const fixed = (v: number) => () => v;

  it('★ 除数常量取 exe：0x465014 = f32 32767.0（不是 32766）', () => {
    // 逐字节 dump：0x465014 的 dword = 0x46fffe00 = 32767.0f
    expect(AUCTION_LIMIT_RAND_DIVISOR).toBe(32767);
  });

  it('★ 抽到最小随机数时，上限 = 起拍价 × 持地系数 × 缺地系数 × 0.5', () => {
    // 底价 1000、物价 1、总 10 块里 5 块无主 → 缺地系数 6 − 4×0.5 = 4
    // (等级 2 >> 1) + 1 + 同名 1 = 3 → 3 × 1000 × 1 = 3000
    // v1 = 3000 × 4 × 0.5 = 6000；v2 = 8000 × 3 = 24000 → 取小 = 6000
    expect(
      auctionAiLimit(
        {
          level: 2,
          landPrice: 8000,
          cash: 100_000,
          priceIndex: 1,
          basePrice: 1000,
          total: 10,
          unowned: 5,
          sameNameOwned: 1,
        },
        fixed(0),
      ),
    ).toBe(6000);
  });

  it('★ 两式取小：地价那一式更小时用 v2 = 地价 × 物价 × [3,4)', () => {
    // v1 = ((0>>1)+1+0) × 1000 × 1 × 缺地 6 × 0.5 = 3000
    // v2 = 500 × 1 × 3 = 1500 → 1500
    expect(
      auctionAiLimit(
        { level: 0, landPrice: 500, cash: 100_000, priceIndex: 1, basePrice: 1000, total: 10, unowned: 0 },
        fixed(0),
      ),
    ).toBe(1500);
  });

  it('★ 上限**夹到现金**（原版最后一条 `cmp eax, esi / jge`）', () => {
    const inputs = {
      level: 2,
      landPrice: 8000,
      priceIndex: 1,
      basePrice: 1000,
      total: 10,
      unowned: 5,
      sameNameOwned: 1,
    };
    expect(auctionAiLimit({ ...inputs, cash: 100_000 }, fixed(0))).toBe(6000);
    expect(auctionAiLimit({ ...inputs, cash: 6000 }, fixed(0))).toBe(6000); // 等于上限不夹
    expect(auctionAiLimit({ ...inputs, cash: 5999 }, fixed(0))).toBe(5999); // 少一块就夹到现金
    expect(auctionAiLimit({ ...inputs, cash: 0 }, fixed(0))).toBe(0); // 没钱 → 心理价位 0
  });

  it('★ 越缺地越敢出价（缺地系数 6 − 4×无主率）', () => {
    const base = { level: 0, landPrice: 100_000, cash: 100_000, priceIndex: 1, basePrice: 1000 };
    // 全无主：6 − 4×1 = 2 → v1 = 1×1000×2×0.5 = 1000
    expect(auctionAiLimit({ ...base, total: 10, unowned: 10 }, fixed(0))).toBe(1000);
    // 全有主：6 − 0 = 6 → v1 = 1×1000×6×0.5 = 3000
    expect(auctionAiLimit({ ...base, total: 10, unowned: 0 }, fixed(0))).toBe(3000);
  });

  it('★ 空地那一支照抄原版「乘两次物价指数」', () => {
    // 底价 3000 已经是 auctionBasePrice(地价 1000, 等级 0) × 物价 3；
    // v1 = 1×3000×6×0.5 = 9000，再 ×3 = 27000（第二次物价）
    // v2 = 10,000,000 × 3 × 3 = 90,000,000 → 取小 = 27000
    expect(
      auctionAiLimit(
        {
          level: 0,
          landPrice: 10_000_000,
          cash: 100_000,
          priceIndex: 3,
          basePrice: 3000,
          total: 10,
          unowned: 0,
        },
        fixed(0),
      ),
    ).toBe(27_000);
  });
});

describe('★ AI 挑档 auctionAiRaise（loc_0043b124 / loc_0043b183）', () => {
  const fixed = (v: number) => () => v;

  it('★ 五档金额照表 0x475ba2 的 1..5 项', () => {
    expect(AUCTION_RAISE_STEPS).toEqual([100, 500, 1000, 5000, 10000]);
  });

  it('★ 从上往下挑最大的一口：心理价位够 +10000 就 +10000', () => {
    expect(auctionAiRaise(20_000, 1000, 100_000)).toBe(10_000);
  });

  it('★ 挑不到整档就降一档（现价 + 5000 > 心理价位 → 试 1000）', () => {
    // 1000 + 10000 = 11000 > 4500；+5000 = 6000 > 4500；+1000 = 2000 ≤ 4500
    expect(auctionAiRaise(4500, 1000, 100_000)).toBe(1000);
  });

  it('★ 连最小一档都超过心理价位 → PASS（返回 0）', () => {
    // 1000 + 100 = 1100 > 1050
    expect(auctionAiRaise(1050, 1000, 100_000)).toBe(0);
  });

  it('★ 现金 < 现价 → PASS（0x43b10c 的 `jle`，早于挑档）', () => {
    expect(auctionAiRaise(1_000_000, 1000, 999)).toBe(0);
    // 现金恰好等于现价不算出不起，照挑档
    expect(auctionAiRaise(1_000_000, 1000, 1000)).toBe(10_000);
  });

  it('★ 档位金额是「不超过心理价位」的意思：超不过 100 就不加价', () => {
    // 心理价位 1050：现价 1000 已经贴着它，任何一档都超 → PASS
    expect(auctionAiRaise(1050, 1000, 1_000_000)).toBe(0);
    // 其余情况加的**档位金额**不超过心理价位与现价之差
    for (const limit of [1200, 5200, 12_000]) {
      const step = auctionAiRaise(limit, 1000, 1_000_000);
      expect(step).toBeLessThanOrEqual(limit - 1000);
    }
  });

  it('★ 出价**不超过现金**：心理价位被夹到现金后，挑档自然守住', () => {
    const cash = 3300;
    const limit = auctionAiLimit(
      { level: 0, landPrice: 100_000, cash, priceIndex: 1, basePrice: 3000, total: 10, unowned: 0 },
      fixed(0),
    ); // min(3000×6×0.5 = 9000, 100000×3, cash 3300) = 3300
    expect(limit).toBe(3300);
    const step = auctionAiRaise(limit, 3000, cash);
    expect(step).toBe(100); // 3000 + 500 > 3300 → 落到最小一档
    expect(3000 + step).toBeLessThanOrEqual(cash);
  });

  it('★ 超出最高出价者「现金 + 500」时把档位压回去（loc_0043b183）', () => {
    // 心理这一口 1000+10000；最高者现金 2000 → 线 2500 < 11000 → 压档
    // room = 线 − 现价 = 2500 − 1000 = 1500 ∈ [1000,5000] → 改成 5000
    // （原版只改档、不保证这一口 ≤ 2500）
    expect(auctionAiRaise(20_000, 1000, 100_000, 2000)).toBe(5000);
    // room = 1900 − 1000 = 900 ∈ [500,1000) → 1000
    expect(auctionAiRaise(20_000, 1000, 100_000, 1400)).toBe(1000);
    // ⚠️ room 恰好是 1000 时走的是 **5000** 档（照 `cmp 1000 / jle` 那对）
    expect(auctionAiRaise(20_000, 1000, 100_000, 1500)).toBe(5000);
    // room = 1600 − 1000 = 600 ∈ [500,1000) → 1000（比原档小，才换）
    expect(auctionAiRaise(20_000, 1000, 100_000, 1100)).toBe(1000);
    // room = 850 − 1000 < 100 → 给 100
    expect(auctionAiRaise(20_000, 1000, 100_000, 500)).toBe(100);
    // 不超线就原样保留
    expect(auctionAiRaise(20_000, 1000, 100_000, 50_000)).toBe(10_000);
    // 还没有最高出价者（top == -1）→ 不压
    expect(auctionAiRaise(20_000, 1000, 100_000, null)).toBe(10_000);
  });

  it('PASS 时不会因为压价那一段又冒出一口价', () => {
    expect(auctionAiRaise(1050, 1000, 100_000, 2000)).toBe(0);
  });
});

describe('★ 真人那一手「出不起就不响应」（loc_0043a478）', () => {
  it('现价 + 档位 > 现金 才拒收，恰好等于可以', () => {
    expect(auctionCanAfford(1000, 100, 1100)).toBe(true);
    expect(auctionCanAfford(1000, 100, 1099)).toBe(false);
  });
});

// ============================================================
//  ★ Q-AUC-1：竞价循环归 core —— 座位表、终局判据、与 reduce/policy 合起来跑
// ============================================================

const LAND = 1;
const topo: MapTopology = {
  nodes: [
    makeNode({
      id: 1,
      adjacent: [1],
      type: 0x7d0 + LAND,
      ref: { kind: 'land', index: LAND },
    }),
  ],
  lands: [makeLand({ id: LAND, name: '測試地', landPrice: 3000, housePrice: 500, owner: 1 })],
};
const asMap = { ...topo, facilities: [], commercials: [], landscapes: [], dataSize: 0 } as unknown as Rich4Map;

/** 四个电脑玩家，0 号手上有一张拍賣卡（8）、站在 1 号的地上 */
function auctionGame(cash: number | ((i: number) => number) = 60_000): GameState {
  const players = [0, 1, 2, 3].map((i) =>
    makePlayer({
      index: i,
      character: i,
      nodeId: 1,
      cash: typeof cash === 'function' ? cash(i) : cash,
      moneyInBank: 0,
      whoPlays: WHO_PLAYS_COMPUTER,
      cards: i === 0 ? [8] : [],
    }),
  );
  return makeGameState({
    players,
    currentPlayer: 0,
    phase: 'turnStart',
    landOwner: [0, 2],
    landLevel: [0, 0],
  });
}

/** 跑到 pending 不再是 auction 为止；返回 { state, actions } */
function runAuction(s: GameState): { state: GameState; actions: string[] } {
  const actions: string[] = [];
  for (let i = 0; i < 40 && s.pending?.kind === 'auction'; i++) {
    const a = decideAction({ state: s, map: asMap });
    if (a === null) break;
    actions.push(`${a.type}:${JSON.stringify(a)}`);
    const next = reduce(s, a, topo);
    expect(next, `第 ${i} 口没有推进状态`).not.toBe(s);
    s = next;
  }
  return { state: s, actions };
}

describe('★ 座位表（loc_0043c110 / loc_00439f72 的建表段）', () => {
  it('出局者与出不起底价者都不是 active', () => {
    const ps = four();
    ps[3] = { ...ps[3]!, whoPlays: 0 };
    ps[1] = { ...ps[1]!, cash: 999 }; // 底价 1000
    expect(auctionSeatStatus(ps, [0, 1, 2, 3], 1000)).toEqual([
      'active',
      'givenUp', // 出不起（现金 < 底价）
      'active',
      'givenUp', // 已出局
    ]);
  });

  it('★ 恰好等于底价也出不起（原版 `cmp / jg`）', () => {
    const ps = four();
    ps[1] = { ...ps[1]!, cash: 1000 };
    expect(auctionSeatStatus(ps, [0, 1], 1000)[1]).toBe('givenUp');
    // 少一块钱的底价 → 现金 1000 > 999，可出价
    expect(auctionSeatStatus(ps, [0, 1], 999)[1]).toBe('active');
  });

  it('排座位时跳过非 active 的（loc_0043b3c2 的取模绕圈）', () => {
    const status: AuctionSeatStatus[] = ['passed', 'active', 'givenUp', 'active'];
    expect(auctionAdvanceSeat([0, 1, 2, 3], status, 1)).toBe(3);
    expect(auctionAdvanceSeat([0, 1, 2, 3], status, 3)).toBe(1);
    // 一个可出价的都没有 → 原样返回（此时已判流标）
    expect(auctionAdvanceSeat([0, 1], ['passed', 'passed'], 0)).toBe(0);
  });

  it('第一个座位从 currentPlayer 起找', () => {
    const status: AuctionSeatStatus[] = ['passed', 'active', 'active', 'active'];
    expect(auctionFirstSeat([0, 1, 2, 3], status, 0)).toBe(1);
    expect(auctionFirstSeat([0, 1, 2, 3], status, 2)).toBe(2);
  });
});

describe('★ 终局判据（loc_0043b295）', () => {
  const base = { bidders: [0, 1, 2], top: -1 };

  it('全都还能出价 → 没完', () => {
    expect(auctionFinished({ ...base, status: ['active', 'active', 'active'] })).toBe(false);
  });

  it('一个能出价的都没有 → 完（流标）', () => {
    expect(auctionFinished({ ...base, status: ['passed', 'passed', 'givenUp'] })).toBe(true);
  });

  it('★ 只剩最高出价者一个人能出价 → 完（成交）', () => {
    expect(auctionFinished({ bidders: [0, 1, 2], top: 0, status: ['active', 'passed', 'passed'] })).toBe(true);
  });

  it('★ 只剩一个能出价、但还没人出过价 → 没完（那一位还要先举一次牌）', () => {
    expect(auctionFinished({ bidders: [0, 1], top: -1, status: ['active', 'passed'] })).toBe(false);
  });

  it('流拍时 outcome 是 winner = -1', () => {
    expect(auctionOutcome({ bidders: [0], status: ['passed'], top: -1, price: 0, basePrice: 100 })).toEqual({
      winner: -1,
      price: 0,
    });
  });

  it('成交时 outcome 是最高出价者与现价', () => {
    expect(
      auctionOutcome({ bidders: [0, 1], status: ['passed', 'active'], top: 1, price: 8000, basePrice: 1000 }),
    ).toEqual({ winner: 1, price: 8000 });
  });
});

describe('★ AI 一口：心理价位 / 现金 / 压价三条一起看（auctionAiChoice）', () => {
  it('心理价位够 → 加价', () => {
    expect(auctionAiChoice({ limit: 20_000, price: 1000, cash: 100_000, topCash: null })).toEqual({
      step: 10_000,
      kind: 'raise',
    });
  });

  it('出不起现价 → PASS', () => {
    expect(auctionAiChoice({ limit: 20_000, price: 5000, cash: 1000, topCash: null })).toEqual({
      step: 0,
      kind: 'pass',
    });
  });

  it('★ 心理价位为 0（真人的座位 / 没算过）→ PASS', () => {
    expect(auctionAiChoice({ limit: 0, price: 1000, cash: 100_000, topCash: null })).toEqual({
      step: 0,
      kind: 'pass',
    });
  });

  it('★ 压在穷对手现金 + 500 之下（loc_0043b183）', () => {
    // 最高者现金 2000 → 线 2500；room = 1500 → 5000 档
    expect(auctionAiChoice({ limit: 20_000, price: 1000, cash: 100_000, topCash: 2000 })).toEqual({
      step: 5000,
      kind: 'raise',
    });
  });
});

describe('★ 心理价位表（入口 0x43c5d9 只在开拍时算一次）', () => {
  it('真人座位留 0；电脑座位按 fcn_00439f0d 算', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: 0 }), // 出局
      makePlayer({ index: 1, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
      makePlayer({ index: 2, cash: 100_000 }), // 真人
      makePlayer({ index: 3, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
    ];
    const entity = {
      basePrice: 3000,
      priceIndex: 1,
      landPrice: 3000,
      level: 0,
      total: 10,
      unowned: 4,
      sameNameOwned: () => 0,
    };
    const limits = auctionAiLimits(entity, players, [0, 1, 2, 3], 12345);
    expect(limits[0]).toBe(0); // 出局（原版连座位都没有）
    expect(limits[1]).toBeGreaterThan(0);
    // ⚠️ 真人这一格也算了值：原版**只给电脑**算（真人那一手是手点的），
    //   本函数按「出价者」逐位算好，真人那一位的值由 `decidePending`
    //   拒用（`isAiControlled` 那道闸），屏上也不会读它。
    expect(limits[2]).toBeGreaterThan(0);
    expect(limits[3]).toBeGreaterThan(0);
  });

  it('★ 同一种子算两遍完全一样（联机两端要对得上）', () => {
    const players = [0, 1].map((i) => makePlayer({ index: i, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }));
    const entity = {
      basePrice: 3000,
      priceIndex: 1,
      landPrice: 3000,
      level: 0,
      total: 10,
      unowned: 4,
      sameNameOwned: () => 0,
    };
    expect(auctionAiLimits(entity, players, [0, 1], 777)).toEqual(
      auctionAiLimits(entity, players, [0, 1], 777),
    );
  });
});

describe('★ Q-AUC-1 端到端：电脑打出拍賣卡 → 竞价一直跑到落槌', () => {
  it('★ 不再走 declineDecision —— 竞价真的发生了', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    expect(s.pending?.kind).toBe('auction');
    // 开拍时字段齐全（现价 = 起拍价、还没人出价、轮到某一家）
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.price).toBe(3000);
    expect(s.pending.top).toBe(-1);
    expect(s.pending.bidders).toEqual([0, 2, 3]); // 排除地主 1 号
    expect(s.pending.status[1]).toBe('givenUp'); // 地主不参与

    const { state, actions } = runAuction(s);
    expect(state.pending).toBeNull();
    expect(state.phase).toBe('turnEnd');
    // 至少有人举过牌（原缺口下这里一口都没有）
    expect(actions.some((a) => a.includes('"status":"raise"'))).toBe(true);
  });

  it('★ 成交：得标者按成交价付钱、地块易主、款项进公库', () => {
    // 2、3 号出不起底价 → 只有 0 号能出，举一次牌就成交（价格 = 底价 + 那一口）
    let s = auctionGame((i) => (i === 0 ? 60_000 : 2999));
    const before = s.players.map((p) => p.cash);
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    const { state, actions } = runAuction(s);
    expect(actions).toHaveLength(1);
    const bid = JSON.parse(actions[0]!.slice(actions[0]!.indexOf('{'))) as { step: number };
    const price = 3000 + bid.step; // 起拍价 3000 + 唯一那一口
    const owner = state.landOwner[LAND] ?? 0;
    expect(owner).toBe(1); // 0 号得标（owner 编码 = 下标 + 1）
    expect(owner).not.toBe(2); // 原主（1 号 → 编码 2）失去它
    expect(state.players[0]!.cash).toBe(before[0]! - price);
    expect(state.pool).toBe(price);
    expect(state.players[1]!.cash).toBe(2999); // 原主分文未得（款项进公库）
  });

  it('★ 出价永远不超过心理价位与现金', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    for (let i = 0; i < 40; i++) {
      const pending = s.pending;
      if (pending === null || pending.kind !== 'auction' || !('seat' in pending)) break;
      const bidder = pending.bidders[pending.seat]!;
      const who = s.players[bidder]!;
      const a = decideAction({ state: s, map: asMap });
      if (a === null || a.type !== 'auctionBid') break;
      if (a.status === 'raise') {
        expect(a.step).toBeGreaterThan(0);
        expect(pending.price + a.step).toBeLessThanOrEqual(pending.limits[bidder]!);
        expect(pending.price + a.step).toBeLessThanOrEqual(who.cash);
      }
      const next = reduce(s, a, topo);
      // 现价单调不减
      if (next.pending?.kind === 'auction' && 'price' in next.pending) {
        expect(next.pending.price).toBeGreaterThanOrEqual(pending.price);
      }
      s = next;
    }
    expect(s.pending).toBeNull();
  });

  it('★ 出不起 / 已 PASS 的座位不会再出价', () => {
    // 2、3 号连底价（3000）都出不起 → 只有 0 号举一次牌就成交
    let s = auctionGame((i) => (i === 0 ? 60_000 : 2999));
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.bidders).toEqual([0, 2, 3]);
    expect(s.pending.status[2]).toBe('givenUp');
    expect(s.pending.status[3]).toBe('givenUp');
    const { state, actions } = runAuction(s);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('"status":"raise"');
    expect(state.landOwner[LAND]).toBe(1); // 0 号得标（owner 编码 = 下标 + 1）
    // 2、3 号从头到尾没出过价 —— 只有 0 号那一口
    expect(actions.filter((a) => a.includes('"bidder":2'))).toHaveLength(0);
    expect(actions.filter((a) => a.includes('"bidder":3'))).toHaveLength(0);
  });

  it('★ 加价的那一口出不起 → reducer 拒收（状态原样）', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const seat = s.pending.seat;
    const bidder = s.pending.bidders[seat]!;
    // 现金压到刚好等于现价：加 100 都超（原版 `cmp / jg`），但 PASS 仍允许
    s = { ...s, players: s.players.map((p, i) => (i === bidder ? { ...p, cash: 3000 } : p)) };
    expect(reduce(s, { type: 'auctionBid', bidder, status: 'raise', step: 5000 }, topo)).toBe(s);
    expect(reduce(s, { type: 'auctionBid', bidder, status: 'raise', step: 100 }, topo)).toBe(s);
    // PASS 仍然可以（出不起也允许退出竞价）
    expect(reduce(s, { type: 'auctionBid', bidder, status: 'pass', step: 0 }, topo)).not.toBe(s);
  });

  it('★ 不是轮到你 → reducer 拒收', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const seat = s.pending.seat;
    const notMyTurn = s.pending.bidders.find((b, i) => i !== seat)!;
    expect(reduce(s, { type: 'auctionBid', bidder: notMyTurn, status: 'pass', step: 0 }, topo)).toBe(s);
  });

  it('★ 流拍：全场都出不起底价 → 原主照样失去地产（拍賣卡的要害）', () => {
    // 底价 = 地价 3000 × 物价 1 = 3000；现金 2999 → `cmp / jg` 判出不起
    let s = auctionGame(2999);
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    // 所有座位一开拍就 givenUp → **当场**流标（pending 都不挂）
    expect(s.pending).toBeNull();
    expect(s.phase).toBe('turnEnd');
    expect(s.landOwner[LAND]).toBe(0); // 变无主
    expect(s.players.map((p) => p.cash)).toEqual([2999, 2999, 2999, 2999]); // 一分钱没动
  });
});

describe('★ Q-AUC-1 soak：4 个电脑跑满 300 回合，拍卖不得卡死', () => {
  const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
  const runSoak = existsSync(MAP) ? it : it.skip;

  runSoak('★ 300 回合不卡死', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const mapTopo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 4242,
    });
    let steps = 0;
    for (; steps < 200_000; steps++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      const next = reduce(state, a, mapTopo);
      if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
      state = next;
      if (state.turnCount >= 300) break;
    }
    expect(state.turnCount).toBeGreaterThanOrEqual(300);
    expect(state.pending?.kind).not.toBe('auction');
  });

  /**
   * ★ 真正的拍賣护栏。
   *
   * ⚠️ **自然对局里抽不到拍賣卡**：牌是随机的，AI 又只在「脚下是对手的
   *   ≥3 级地产」时才肯出（`card-policy.ts` 的 `paimai`，@source 0x0041ef26）。
   *   实测 300 回合 / 种子 4242 里 `cardId === 8` 一次都没出现 ——
   *   所以上一条 soak 其实**盖不到拍賣**。这里改成：在真对局上、走到对手地产
   *   那一步塞一张拍賣卡并强制打出，把竞价循环放进完整状态机里连续压 60 次。
   */
  runSoak('★ 连续多场拍賣：不卡死、每一口形状正确、每场都落槌', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const mapTopo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 91,
    });

    let auctions = 0;
    let bids = 0;
    let settled = 0;
    let guard = 0;
    for (let steps = 0; steps < 200_000 && auctions < 20 && guard < 300; steps++) {
      const me = state.currentPlayer;
      // 正处在「用卡」那一步、且脚下就是**对手的地产** → 塞一张拍賣卡并当场打出。
      // ⚠️ 只在真的用得上时才塞：脚下不是对手地产的话 `useCard` 失败、牌还在手上，
      //    下回合又会被塞一张（先前就是这么把牌堆塞爆、拍卖一场没开成的）。
      if (state.phase === 'awaitingRoll' && state.aiStep === 2) {
        const p = state.players[me]!;
        const node = map.nodes[p.nodeId - 1];
        const li = node === undefined ? null : housingIndexOf(node.type);
        const land = li === null ? undefined : map.lands.find((l) => l.id === li);
        const owner = land === undefined ? 0 : (state.landOwner[land.id] ?? land.owner);
        if (land !== undefined && owner !== 0 && owner !== me + 1) {
          guard++;
          state = {
            ...state,
            players: state.players.map((x, i) => (i === me ? { ...x, cards: [...x.cards, 8] } : x)),
            phase: 'turnStart',
          };
          state = reduce(state, { type: 'startTurn' }, mapTopo);
          state = reduce(state, { type: 'useCard', cardId: 8 }, mapTopo);
          if (state.pending?.kind !== 'auction') continue;
          auctions++;
          // 一场拍賣：一直答到落槌
          for (let k = 0; k < 40 && state.pending?.kind === 'auction'; k++) {
            const pending = state.pending;
            if (!('seat' in pending)) break;
            const seat = pending.seat;
            const bidder = pending.bidders[seat]!;
            const a = decideAction({ state, map });
            if (a === null) throw new Error('轮到电脑却拿不出出价');
            if (a.type !== 'auctionBid') throw new Error(`拍賣里给了 ${a.type}`);
            bids++;
            expect(a.bidder).toBe(bidder); // 只许轮到的这一家出
            if (a.status === 'raise') {
              expect(a.step).toBeGreaterThan(0);
              // 出价不超过心理价位，也不超过现金
              expect(pending.price + a.step).toBeLessThanOrEqual(pending.limits[bidder]!);
              expect(pending.price + a.step).toBeLessThanOrEqual(state.players[bidder]!.cash);
            }
            const next = reduce(state, a, mapTopo);
            if (next === state) throw new Error(`拍賣第 ${k} 口没推进`);
            state = next;
          }
          expect(state.pending?.kind).not.toBe('auction'); // 必须落槌，不许挂着
          settled++;
        }
      }
      const a = decideAction({ state, map });
      if (a === null) break;
      const next = reduce(state, a, mapTopo);
      if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
      state = next;
    }
    expect(auctions).toBeGreaterThanOrEqual(5);
    expect(settled).toBe(auctions);
    expect(bids).toBeGreaterThan(0);
  });
});
