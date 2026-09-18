/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 拍賣 —— 以 run_auction（VA 0x0043bde5）为准
 */

import { WatcomRng } from '../rng/watcom.ts';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from '../state/reduce.ts';
import type { MapTopology } from '../state/reduce.ts';
import { decideAction } from '../ai/policy.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_AUTOPILOT, WHO_PLAYS_HUMAN,} from '../state/types.ts';
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

  it('★★ 公式按 x87 的**逐步 double 舍入**算（PC = 0x027F ⇒ 53 位）', () => {
    // 原版实测（rich4-spec/tests/test_land_auction_cards.py，真跑 0x40df69）：
    //   (地价 3、物价 1、等级 0) ⇒ 3 × (2/5)：
    //     · 逐步 double（本实现）  = 1.2000000000000002 → 低 32 位 = **858993460**
    //     · 「精确乘积 ÷ 5」      = 1.2                → 低 32 位 = 858993459
    //   原版给的是 **858993460** ⇒ 必须逐步舍入（x87 默认精度控制字是 double）。
    expect(auctionCardHostility(3, 0, 1)).toBe(858_993_460);
    // 另一组原版实测值：(地价 1001、物价 1、等级 2) ⇒ +1717986919
    expect(auctionCardHostility(1001, 2, 1)).toBe(1_717_986_919);
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

  it('★★ 开场席位从 slot 0 起找第一个 active 的（loc_0043a365 的清零 + 绕圈）', () => {
    const status: AuctionSeatStatus[] = ['passed', 'active', 'active', 'active'];
    expect(auctionFirstSeat([0, 1, 2, 3], status)).toBe(1);
    // 从 slot 0 起 —— 不是「从 currentPlayer 起」（旧行为，见 A-3 订正）
    expect(auctionFirstSeat([0, 1, 2, 3], ['active', 'active', 'active', 'active'])).toBe(0);
  });

  it('★★ 一个可出价的都没有时返回 -1，**绝不能返回 0**（A-3 的卡死根因）', () => {
    // 病根：卖家在座位编码里是「非 0 状态」，一个 active 都没有时旧实现返回 0,
    //   那正好可能是卖家那一格 ⇒ 客户端把出价权交给卖家、屏上等真人点，整局卡死。
    expect(auctionFirstSeat([0, 1, 2, 3], ['givenUp', 'givenUp', 'givenUp', 'givenUp'])).toBe(-1);
    expect(auctionFirstSeat([], [])).toBe(-1);
    // 卖家被跳过：slot 0 是卖家（givenUp），第一个可出价的是 slot 1
    const sellerFirst: AuctionSeatStatus[] = ['givenUp', 'active', 'active', 'active'];
    expect(auctionFirstSeat([0, 1, 2, 3], sellerFirst)).toBe(1);
  });

  it('★ 无主地自拍（bidders 含卖家自己）时，出价权必须给**别人**', () => {
    // 审查 A-3 场景⑤：真人站在无主地上打拍賣卡 ⇒ bidders=[0,1,2,3]（无主地不排除任何人），
    //   status[0] = 'active'（卖家手里确实有钱、也不是「出不起底价」）。
    //   原版此时 slot 0 就是出卡人自己（原版建表不看「谁是卖家」以外的资格）。
    //   ★ 这里钉住的是**引擎不再把出价权丢给卖家**这条不变量：
    //     一旦卖家被标成非 active（自己的地 / 出不起），首个席位必须跳过它。
    expect(auctionFirstSeat([0, 1, 2, 3], ['givenUp', 'active', 'active', 'active'])).toBe(1);
    // 卖家在中间（bidders 不含它时下标会错位）—— 用 bidders 与玩家号**不同**的数组钉住
    //   「用 bidders[i] 取 status，而不是用 i 取 status」：
    //   bidders=[2,0,3]，status 按**玩家下标**索引 ⇒ slot0=玩家2(active) → 返回 0
    expect(auctionFirstSeat([2, 0, 3], ['givenUp', 'active', 'active', 'active'])).toBe(0);
    // 玩家2 出不起、玩家0 与玩家3 可出价 ⇒ slot0 被跳过，返回 slot1
    expect(auctionFirstSeat([2, 0, 3], ['active', 'active', 'givenUp', 'active'])).toBe(1);
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

describe('★ 心理价位表（建表循环 0x43c5d0 只在开拍时算一次）', () => {
  const ENTITY = {
    basePrice: 3000,
    priceIndex: 1,
    landPrice: 3000,
    level: 0,
    total: 10,
    unowned: 4,
    sameNameOwned: () => 0,
  };
  /** 按开拍时的口径造状态：出得起底价且在名单里才 'active' */
  const st = (...ps: ReturnType<typeof makePlayer>[]): AuctionSeatStatus[] =>
    ps.map((p) => (p.whoPlays === 0 || p.cash <= ENTITY.basePrice ? 'givenUp' : 'active'));
  /** 计数的随机源：返回固定序列并记录消费次数 */
  const counter = (vals: number[] = [0.5]) => {
    let n = 0;
    const f = (): number => {
      const v = vals[n % vals.length] ?? 0;
      n += 1;
      return v;
    };
    return { f, count: () => n };
  };

  it('★ 只给「电脑」算：真人/出局那两格留 0，且**一次随机数都不掷**', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: 0 }), // 出局
      makePlayer({ index: 1, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
      makePlayer({ index: 2, cash: 100_000 }), // 真人（makePlayer 默认）
      makePlayer({ index: 3, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
    ];
    const r = counter();
    const limits = auctionAiLimits(ENTITY, players, [0, 1, 2, 3], st(...players), -1, r.f);
    expect(limits[0]).toBe(0); // 出局（原版连座位都没有）
    expect(limits[1]).toBeGreaterThan(0);
    // ★★ 订正：原版 `test byte [player+0x15], 6 / je 跳过` —— 真人**不算也不掷**。
    //    先前这里断言「真人那一格也算了值」，那是把实现当成了真值。
    expect(limits[2], '真人座位留 0').toBe(0);
    expect(limits[3]).toBeGreaterThan(0);
    // @source 0x439f0d 内部 `call rand` **两次**（入口 0x439f1c + 地块支
    //   0x43a015 / 設施支 0x43a0fb 二选一）⇒ 两个电脑座位 = 4 次
    expect(r.count(), '★ 两个电脑座位 × 每家 2 次 = 4 次').toBe(4);
  });

  it('★ 托管的人类座位（whoPlays bit2）照样算 —— `test ...,6` 的 bit2', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }),
      makePlayer({ index: 1, cash: 100_000, whoPlays: WHO_PLAYS_HUMAN }),
    ];
    const r = counter();
    const limits = auctionAiLimits(ENTITY, players, [0, 1], st(...players), -1, r.f);
    expect(limits[0]).toBeGreaterThan(0);
    expect(limits[1]).toBe(0);
    expect(r.count(), '一个电脑座位 × 2 次').toBe(2);
  });

  it('★ 出不起底价（状态 8）/ 卖家（状态 7）都不掷', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
      makePlayer({ index: 1, cash: 100, whoPlays: WHO_PLAYS_COMPUTER }), // 出不起
      makePlayer({ index: 2, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }), // 卖家
    ];
    const r = counter();
    const limits = auctionAiLimits(ENTITY, players, [0, 1, 2], st(...players), 2, r.f);
    expect(limits[0]).toBeGreaterThan(0);
    expect(limits[1], '出不起底价 → 价位停在 0').toBe(0);
    expect(limits[2], '卖家状态 7 → 不算').toBe(0);
    expect(r.count(), '★ 只有 1 家可出价 ⇒ 掷 2 次').toBe(2);
  });

  it('★ 消费次数与座位顺序无关地确定：两家电脑 → 恰好 2 次', () => {
    const players = [0, 1].map((i) =>
      makePlayer({ index: i, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
    );
    const r = counter([0.25, 0.75]);
    const limits = auctionAiLimits(ENTITY, players, [0, 1], st(...players), -1, r.f);
    expect(r.count(), '两家 × 2 次').toBe(4);
    // 同一条随机流算两遍必然一致（联机两端对得上）
    const r2 = counter([0.25, 0.75]);
    expect(auctionAiLimits(ENTITY, players, [0, 1], st(...players), -1, r2.f)).toEqual(limits);
  });
});

/**
 * ★★ 开拍要**消费全局随机流**（原版 `0x439f0d` 内部 `call rand` 两次）。
 *
 * 旧实现（已撤销的 D-T034-5）用 `rngState ^ 实体号` 派生一条**独立**序列，
 * 于是 `rngState` 一动不动 —— 每开一场拍卖，之后所有随机事件就与原版错位一次。
 */
describe('★★ 开拍消费全局随机流（订正 D-T034-5）', () => {
  it('★ 3 个电脑座位 × 每家 2 次 ⇒ rngState 恰好前进 6 步', () => {
    let s = auctionGame();
    const before = s.rngState;
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.bidders).toEqual([0, 2, 3]);

    const expectRng = new WatcomRng();
    expectRng.setState(before);
    for (let i = 0; i < 6; i++) expectRng.next();
    expect(s.rngState, '★ 开拍必须推进全局随机流').toBe(expectRng.getState());
    expect(s.rngState).not.toBe(before);
  });

  it('★★ 心理价位与流位置都出自那条全局流（同序复算逐项相等）', () => {
    let s = auctionGame();
    const before = s.rngState;
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');

    // 独立复算：从**同一个** rngState 起，按 bidders 升序喂给同一个算法
    const rng = new WatcomRng();
    rng.setState(before);
    const rand01 = (): number => rng.next() / 32768;
    const entity = {
      basePrice: s.pending.basePrice,
      priceIndex: s.priceIndex,
      landPrice: 3000, // makeLand 的地价（见本文件 topo）
      level: 0,
      total: 1, // topo.lands 只有一块
      unowned: 0, // 那块地归卖家（玩家 1）
      sameNameOwned: () => 0,
    };
    const status = auctionSeatStatus(s.players, s.pending.bidders, s.pending.basePrice);
    const manual = auctionAiLimits(entity, s.players, s.pending.bidders, status, 1, rand01);

    expect(s.pending.limits).toEqual(manual);
    expect(rng.getState(), '复算消耗的步数必须与引擎一致').toBe(s.rngState);
  });

  it('★ 真人座位不消费随机数：全真人时开拍不推进 rngState', () => {
    let s = auctionGame();
    // ★ 四个人全改成真人 —— 出价者是 0/2/3，**0 号（出卡人）也在名单里**，
    //   只改 1/2/3 的话还会剩一个电脑座位在掷随机数。
    const players = s.players.map((p) => ({ ...p, whoPlays: WHO_PLAYS_HUMAN }));
    s = { ...s, players };
    const before = s.rngState;
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.limits.every((v) => v === 0), '真人座位心理价位留 0').toBe(true);
    expect(s.rngState, '★ 一个电脑座位都没有 ⇒ 一次都不掷').toBe(before);
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
    // ★★ A-3（外部审查）：开场席位必须是**第一个可出价的人**，不能是卖家/地主。
    //   判断的敌人是「第一格不可出价却返回 0」：把 0 号弄成出不起底价
    //   （bidders[0] 仍是 0，但 status[0] = 'givenUp'），开场席位必须落到别人头上。
    //   旧实现「绕一圈找不到就返回 0」在这里给出 0 号 ⇒ 客户端把出价权交给一个
    //   不能出价的人、屏上等真人点，整局卡死（外部审查 A-3 的真根因）。
    {
      const poor = auctionGame((i) => (i === 0 ? 1 : 60_000));
      const after = reduce(poor, { type: 'useCard', cardId: 8 }, topo);
      if (after.pending?.kind !== 'auction' || !('seat' in after.pending)) {
        throw new Error('no auction');
      }
      expect(after.pending.status[0]).toBe('givenUp'); // 0 号出不起底价
      const first = after.pending.bidders[after.pending.seat];
      expect(first, '第一格出不起底价时开场席位不能是他').not.toBe(0);
      expect(after.pending.status[first!]).toBe('active');
    }
    expect(s.pending.bidders[s.pending.seat]).toBe(0); // 正常局面下 0 号可出价
    expect(s.pending.status[s.pending.bidders[s.pending.seat]!]).toBe('active');

    const { state, actions } = runAuction(s);
    expect(state.pending).toBeNull();
    expect(state.phase).toBe('turnEnd');
    // 至少有人举过牌（原缺口下这里一口都没有）
    expect(actions.some((a) => a.includes('"status":"raise"'))).toBe(true);
  });

  it('★★ A-3 回归：地主自己打出拍賣卡时，开场席位必须跳过地主', () => {
    // 场景：0 号**是地主**（landOwner 指向自己），手上还有拍賣卡 —— 他卖自己的地。
    //   `eligibleBidders` 会排除地主 ⇒ bidders 里没有 0；此时开场席位必须落在
    //   某个**别人**头上。先前的实现会返回 0（= bidders 的第一格），而那一格
    //   可能是被标成非 active 的座位 ⇒ 客户端把出价权交给一个不能出价的人、
    //   屏上摆着「請意者出價」等真人点，整局卡死（外部审查 A-3）。
    const players = [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        character: i,
        nodeId: 1,
        cash: 60_000,
        moneyInBank: 0,
        whoPlays: WHO_PLAYS_COMPUTER,
        cards: i === 0 ? [8] : [],
      }),
    );
    const owned: MapTopology = {
      ...topo,
      lands: [makeLand({ id: LAND, name: '測試地', landPrice: 3000, housePrice: 500, owner: 1 })],
    };
    const s0 = makeGameState({
      players,
      currentPlayer: 0,
      phase: 'turnStart',
      landOwner: [0, 1], // ★ 1 号编码 = 0 号玩家 ⇒ 0 号卖自己的地
      landLevel: [0, 0],
    });
    const s = reduce(s0, { type: 'useCard', cardId: 8 }, owned);
    expect(s.pending?.kind).toBe('auction');
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('no auction');
    expect(s.pending.bidders).toEqual([1, 2, 3]); // 地主 0 号被排除
    const seatPlayer = s.pending.bidders[s.pending.seat];
    expect(seatPlayer, '开场席位不能落空').toBeDefined();
    expect(seatPlayer, '开场席位必须是可出价的人').not.toBe(0);
    expect(s.pending.status[seatPlayer!]).toBe('active');
    // 竞价能自己跑完，不需要「卖家先点一次 PASS」
    const { state } = runAuction(s);
    expect(state.pending).toBeNull();
  });

  it('★★ A-3 回归：**无主地**自拍时出价权不能落回卖家（原版卖家状态 7 会被绕开）', () => {
    // 外部审查实测的那一幕：真人站在**无主地**上打拍賣卡。
    //   `eligibleBidders` 只排除「现任地主」，无主地（owner === 0）谁都匹配不上
    //   ⇒ bidders = [0,1,2,3]，卖家 0 号自己也在名单里且状态是 'active'。
    //   旧实现于是把开场席位给了 0 号 ⇒ 屏上等真人自己点、三台电脑一口不出。
    //   原版给卖家那一格写状态 7，绕圈永远跳过他。
    const players = [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        character: i,
        nodeId: 1,
        cash: 60_000,
        moneyInBank: 0,
        whoPlays: WHO_PLAYS_COMPUTER,
        cards: i === 0 ? [8] : [],
      }),
    );
    const unowned: MapTopology = {
      ...topo,
      lands: [makeLand({ id: LAND, name: '無主地', landPrice: 3000, housePrice: 500, owner: 0 })],
    };
    const s = reduce(
      makeGameState({
        players,
        currentPlayer: 0,
        phase: 'turnStart',
        landOwner: [0, 0],
        landLevel: [0, 0],
      }),
      { type: 'useCard', cardId: 8 },
      unowned,
    );
    expect(s.pending?.kind).toBe('auction');
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('no auction');
    expect(s.pending.bidders).toEqual([0, 1, 2, 3]); // 无主地不排除任何人
    expect(s.pending.seller).toBe(0); // 卖家 = 出卡人
    const first = s.pending.bidders[s.pending.seat];
    expect(first, '无主地自拍时开场席位不能是卖家自己').not.toBe(0);
    expect(s.pending.status[first!]).toBe('active');
    // 而且整条竞价能自己跑完（没有「卖家先点一次 PASS」这一步）
    const { state, actions } = runAuction(s);
    expect(state.pending).toBeNull();
    expect(actions.length).toBeGreaterThan(0);
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
