/*
 * 总资产与物价指数验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  INITIAL_PRICE_INDEX,
  STOCK_COUNT,
  calculatePlayerWealth,
  updatePriceIndex,
} from './wealth.ts';
import { DEFAULT_INITIAL_FUND, GAME_INITIAL_FUNDS } from './setup.ts';
import type { StockValuation } from './wealth.ts';
import { parseMap } from '../loaders/map.ts';
import { parseSave } from '../loaders/save.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { makePlayer as basePlayer, makeFacility } from '../testing/factories.ts';

/** 本文件显式声明默认资金（0/0），避免依赖共用工厂的默认值 */
const makePlayer = (over: Partial<Player> = {}): Player =>
  basePlayer({ cash: 0, moneyInBank: 0, ...over });
import { WHO_PLAYS_DEAD, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const SAVE0 = `${ROOT}/Rich4/Save0.dat`;


function land(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1, x: 0, y: 0, name: 'A', priceStatus: 0, type: 0, owner: 0, level: 0,
    landPrice: 1000, housePrice: 200, rentByLevel: [200, 500, 1200, 2800, 6000, 10000],
    flast: 0, ...over,
  };
}

/** 委托共享工厂：新增字段时不必逐个测试文件补 */
const facility = (over: Partial<FacilityInfo> = {}): FacilityInfo =>
  makeFacility({ name: 'F', ...over });

describe('calculatePlayerWealth', () => {
  it('基础：现金 + 存款 − 贷款', () => {
    const p = makePlayer({ cash: 10000, moneyInBank: 5000, loan: 3000 });
    expect(calculatePlayerWealth(p, [], [])).toBe(12000);
  });

  it('贷款为负资产', () => {
    const p = makePlayer({ cash: 100, loan: 5000 });
    expect(calculatePlayerWealth(p, [], [])).toBe(-4900);
  });

  it('住宅：地价 + 等级 × 房价', () => {
    const p = makePlayer({ cash: 0 });
    const lands = [land({ owner: 1, level: 3 })];
    expect(calculatePlayerWealth(p, lands, [])).toBe(1000 + 3 * 200);
  });

  it('空地只算地价', () => {
    expect(calculatePlayerWealth(makePlayer(), [land({ owner: 1, level: 0 })], [])).toBe(1000);
  });

  it('★ 连锁店与住宅不对称：连锁店加一份房价，不乘等级', () => {
    // @source cmp byte [eax+0x18], 0 / jne → 直接加 house_price
    const chain = [land({ owner: 1, type: 1, level: 5 })];
    expect(calculatePlayerWealth(makePlayer(), chain, [])).toBe(1000 + 200); // 不是 1000 + 5*200
    const house = [land({ owner: 1, type: 0, level: 5 })];
    expect(calculatePlayerWealth(makePlayer(), house, [])).toBe(1000 + 5 * 200);
  });

  it('只算自己的地产', () => {
    const lands = [land({ id: 1, owner: 1 }), land({ id: 2, owner: 2 }), land({ id: 3, owner: 0 })];
    expect(calculatePlayerWealth(makePlayer(), lands, [])).toBe(1000);
  });

  it('设施：地价 + 等级 × 房价', () => {
    const facs = [facility({ owner: 1, level: 2 })];
    expect(calculatePlayerWealth(makePlayer(), [], facs)).toBe(5000 + 2 * 1000);
  });

  it('多项资产累加', () => {
    const p = makePlayer({ cash: 50000, moneyInBank: 10000, loan: 20000 });
    const lands = [land({ id: 1, owner: 1, level: 2 }), land({ id: 2, owner: 1, type: 1 })];
    const facs = [facility({ owner: 1, level: 1 })];
    expect(calculatePlayerWealth(p, lands, facs)).toBe(
      50000 + 10000 - 20000 + (1000 + 2 * 200) + (1000 + 200) + (5000 + 1000),
    );
  });

  it('股票按持股 × 股价计入', () => {
    const stocks: StockValuation[] = [{ amount: 10, price: 100 }];
    expect(calculatePlayerWealth(makePlayer({ cash: 500 }), [], [], stocks)).toBe(500 + 1000);
  });

  it('★ 股票逐支截断（非最后统一取整）', () => {
    // 原版每支算完就 fistp 截断。两支各 0.6 元：
    //   逐支截断: trunc(0.6+0)=0, trunc(0.6+0)=0 → 0
    //   统一取整: trunc(0.6+0.6)=1
    const stocks: StockValuation[] = [
      { amount: 1, price: 0.6 },
      { amount: 1, price: 0.6 },
    ];
    expect(calculatePlayerWealth(makePlayer({ cash: 0 }), [], [], stocks)).toBe(0);
  });

  it('固定 12 支股票', () => {
    expect(STOCK_COUNT).toBe(12);
    // 超出 12 支的部分被忽略
    const stocks: StockValuation[] = Array.from({ length: 20 }, () => ({ amount: 1, price: 100 }));
    expect(calculatePlayerWealth(makePlayer(), [], [], stocks)).toBe(12 * 100);
  });
});

describe('updatePriceIndex', () => {
  const wealth = (map: Map<number, number>) => (p: Player) => map.get(p.index) ?? 0;

  it('平均总资产 ÷ 初始资金', () => {
    const players = [makePlayer({ index: 0 }), makePlayer({ index: 1 })];
    const w = wealth(new Map([[0, 300_000], [1, 500_000]])); // 平均 400000
    expect(updatePriceIndex(players, w, 100_000, 1)).toBe(4);
  });

  it('★ 只升不降', () => {
    const players = [makePlayer({ index: 0 })];
    const w = wealth(new Map([[0, 100_000]])); // 新指数 = 1
    expect(updatePriceIndex(players, w, 100_000, 5)).toBe(5); // 保持 5，不降到 1
  });

  it('已出局玩家不计入', () => {
    const players = [
      makePlayer({ index: 0 }),
      makePlayer({ index: 1, whoPlays: WHO_PLAYS_DEAD }),
    ];
    const w = wealth(new Map([[0, 600_000], [1, 0]]));
    // 只算玩家0 → 平均 600000 / 100000 = 6
    expect(updatePriceIndex(players, w, 100_000, 1)).toBe(6);
  });

  it('电脑玩家同样计入', () => {
    const players = [makePlayer({ index: 0 }), makePlayer({ index: 1, whoPlays: WHO_PLAYS_COMPUTER })];
    const w = wealth(new Map([[0, 200_000], [1, 200_000]]));
    expect(updatePriceIndex(players, w, 100_000, 1)).toBe(2);
  });

  it('整数除法向零取整', () => {
    const players = [makePlayer({ index: 0 })];
    // 199999 / 100000 = 1.99999 → 1
    expect(updatePriceIndex(players, wealth(new Map([[0, 199_999]])), 100_000, 0)).toBe(1);
  });

  it('全员出局时保持原值', () => {
    const players = [makePlayer({ index: 0, whoPlays: WHO_PLAYS_DEAD })];
    expect(updatePriceIndex(players, () => 0, 100_000, 3)).toBe(3);
  });

  it('初始资金为 0 时保持原值（避免除零）', () => {
    expect(updatePriceIndex([makePlayer()], () => 100, 0, 2)).toBe(2);
  });

  it('负总资产不会把指数拉低', () => {
    const players = [makePlayer({ index: 0 })];
    expect(updatePriceIndex(players, () => -500_000, 100_000, 3)).toBe(3);
  });
});

describe.skipIf(!existsSync(MAP0) || !existsSync(SAVE0))('真实存档交叉验证', () => {
  it('用 Save0.dat 的玩家与地产算总资产', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE0)));
    const map = parseMap(save.mapData);
    const alive = save.players.filter((p) => p.isAlive);
    expect(alive.length).toBeGreaterThan(0);

    for (const sp of alive) {
      const p = makePlayer({
        index: sp.index,
        cash: sp.cash,
        moneyInBank: sp.moneyInBank,
        loan: sp.loan,
      });
      const w = calculatePlayerWealth(p, map.lands, map.facilities);
      // 总资产应当 ≥ 现金+存款−贷款（地产只会增加）
      expect(w).toBeGreaterThanOrEqual(sp.cash + sp.moneyInBank - sp.loan);
      const owned = map.lands.filter((l) => l.owner === sp.index + 1).length;
      console.log(
        `  玩家${sp.index}: 现金${sp.cash} 存款${sp.moneyInBank} 地产${owned}处 → 总资产 ${w}`,
      );
    }
  });

  it('存档中的物价指数与推算结果方向一致（只升不降）', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE0)));
    const map = parseMap(save.mapData);
    const players = save.players
      .filter((p) => p.isAlive)
      .map((sp) => makePlayer({ index: sp.index, cash: sp.cash, moneyInBank: sp.moneyInBank, loan: sp.loan }));

    const next = updatePriceIndex(
      players,
      (p) => calculatePlayerWealth(p, map.lands, map.facilities),
      150_000, // SAVE1 显示新开局为 150000 现金，推测初始资金量级
      save.priceIndex,
    );
    // 只升不降：结果不可能小于存档里记录的值
    expect(next).toBeGreaterThanOrEqual(save.priceIndex);
    console.log(`  存档物价指数 ${save.priceIndex} → 推算 ${next}`);
  });
});

// ============================================================
//  ★ Q17 结案：开局资金档位与「只增不减」的后果
// ============================================================

describe('★ 开局资金档位表（VA 0x46cb94）', () => {
  it('恰好 6 档，300000 为默认', () => {
    expect(GAME_INITIAL_FUNDS).toEqual([300_000, 200_000, 100_000, 50_000, 30_000, 10_000]);
    expect(DEFAULT_INITIAL_FUND).toBe(300_000);
    expect(INITIAL_PRICE_INDEX).toBe(1);
  });

  it('★ SAVE1.DAT 验证：人均总资产 300000 → 指数 1', () => {
    const ps = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    expect(updatePriceIndex(ps, () => 300_000, DEFAULT_INITIAL_FUND, 0)).toBe(1);
  });

  it('★ 选的初始资金越少，通胀越快', () => {
    const ps = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    const slow = updatePriceIndex(ps, () => 1_000_000, GAME_INITIAL_FUNDS[0]!, 0);
    const fast = updatePriceIndex(ps, () => 1_000_000, GAME_INITIAL_FUNDS[5]!, 0);
    expect(slow).toBe(3);
    expect(fast).toBe(100);
  });
});

describe('★ 只增不减带来的后果', () => {
  it('经济崩盘也压不回来', () => {
    const ps = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    expect(updatePriceIndex(ps, () => 0, DEFAULT_INITIAL_FUND, 7)).toBe(7);
  });

  it('相等时不写（原版用 jle，不是 jl）', () => {
    const ps = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    expect(updatePriceIndex(ps, () => 300_000, DEFAULT_INITIAL_FUND, 1)).toBe(1);
  });

  it('连续采样得到的是历史最大值', () => {
    const ps = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    let idx = INITIAL_PRICE_INDEX;
    for (const w of [300_000, 2_400_000, 600_000, 300_000]) {
      idx = updatePriceIndex(ps, () => w, DEFAULT_INITIAL_FUND, idx);
    }
    expect(idx).toBe(8); // 峰值之后不回落
  });

  it('★ 复现 Save0.dat 的疑点：终局只剩一名巨富，公式值远高于存档值', () => {
    const mk = (cash: number, dead = false) => (i: number) =>
      makePlayer({ index: i, whoPlays: dead ? WHO_PLAYS_DEAD : WHO_PLAYS_HUMAN, cash });
    const wealth = [3_300_000, 600_000, 300_000, 300_000];
    const wealthOf = (p: { index: number }) => wealth[p.index]!;

    // 最后一次**采样**时：四人都还在场
    const atLastSample = [0, 1, 2, 3].map((i) => mk(wealth[i]!)(i));
    const sampled = updatePriceIndex(atLastSample, wealthOf, DEFAULT_INITIAL_FUND, 0);

    // 终局状态：三人出局，平均只按剩下的巨富算
    const atGameOver = [0, 1, 2, 3].map((i) => mk(wealth[i]!, i !== 0)(i));
    const naive = updatePriceIndex(atGameOver, wealthOf, DEFAULT_INITIAL_FUND, 0);

    expect(sampled).toBe(3);
    expect(naive).toBe(11);
    // ★ 拿终局状态套公式会高得多——存档里的低值才是对的
    expect(naive).toBeGreaterThan(sampled);
  });
});
