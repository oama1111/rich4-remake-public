/*
 * 新聞事件可行性判定验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { isNewsFeasible, CONSTRAINED_NEWS_IDS } from './news.ts';
import type { NewsContext } from './news.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import { makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_DEAD } from '../state/types.ts';
import { NEWS_DECK_SIZE } from './deck.ts';

function land(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1, x: 0, y: 0, name: 'A', priceStatus: 0, type: 0, owner: 0, level: 0,
    landPrice: 1000, housePrice: 200, rentByLevel: [0, 0, 0, 0, 0, 0], flast: 0, ...over,
  };
}
function facility(over: Partial<FacilityInfo> = {}): FacilityInfo {
  return { id: 1, x: 0, y: 0, name: 'F', type: 0, owner: 0, level: 0, priceStatus: 0, landPrice: 0, housePrice: 0, ...over };
}
function ctx(over: Partial<NewsContext> = {}): NewsContext {
  return {
    players: [makePlayer()], lands: [], facilities: [],
    stockAmount: [[]], commercials: [], stockF6: new Array<number>(12).fill(0),
    flag496b30: 0, flag496b60: 0, checkCommercialOwner: () => false, ...over,
  };
}

describe('未约束的事件恒可触发', () => {
  it('不在约束集合中的编号一律返回 true', () => {
    const c = ctx();
    for (let id = 0; id < NEWS_DECK_SIZE; id++) {
      if (CONSTRAINED_NEWS_IDS.includes(id)) continue;
      expect(isNewsFeasible(id, c), `事件 ${id}`).toBe(true);
    }
  });
});

describe('全局标志类（0/1 与 2/3）', () => {
  it('事件 0、1 依赖 flag496b30', () => {
    expect(isNewsFeasible(0, ctx({ flag496b30: 0 }))).toBe(false);
    expect(isNewsFeasible(1, ctx({ flag496b30: 0 }))).toBe(false);
    expect(isNewsFeasible(0, ctx({ flag496b30: 1 }))).toBe(true);
  });
  it('事件 2、3 依赖 flag496b60', () => {
    expect(isNewsFeasible(2, ctx({ flag496b60: 0 }))).toBe(false);
    expect(isNewsFeasible(3, ctx({ flag496b60: 5 }))).toBe(true);
  });
});

describe('地产类', () => {
  it('事件 4/5/15 需要场上有已建房屋', () => {
    for (const id of [4, 5, 15]) {
      expect(isNewsFeasible(id, ctx({ lands: [land({ level: 0 })] }))).toBe(false);
      expect(isNewsFeasible(id, ctx({ lands: [land({ level: 2 })] }))).toBe(true);
      // 设施也算
      expect(isNewsFeasible(id, ctx({ facilities: [facility({ level: 1 })] }))).toBe(true);
    }
  });

  it('事件 7 需要有无主地块', () => {
    expect(isNewsFeasible(7, ctx({ lands: [land({ owner: 1 })] }))).toBe(false);
    expect(isNewsFeasible(7, ctx({ lands: [land({ owner: 0 })] }))).toBe(true);
  });

  it('事件 8/9/12 需要有有主地块', () => {
    for (const id of [8, 9, 12]) {
      expect(isNewsFeasible(id, ctx({ lands: [land({ owner: 0 })] }))).toBe(false);
      expect(isNewsFeasible(id, ctx({ lands: [land({ owner: 2 })] }))).toBe(true);
    }
  });
});

describe('股票类', () => {
  it('事件 10/13 需要有在场玩家持股', () => {
    for (const id of [10, 13]) {
      expect(isNewsFeasible(id, ctx({ stockAmount: [[0, 0, 0]] }))).toBe(false);
      expect(isNewsFeasible(id, ctx({ stockAmount: [[0, 5, 0]] }))).toBe(true);
    }
  });

  it('★ 已出局玩家的持股不算数', () => {
    const c = ctx({
      players: [makePlayer({ whoPlays: WHO_PLAYS_DEAD })],
      stockAmount: [[10, 10]],
    });
    expect(isNewsFeasible(10, c)).toBe(false);
  });

  it('事件 28 依赖 12 支股票的 f6 字段', () => {
    expect(isNewsFeasible(28, ctx())).toBe(false);
    const f6 = new Array<number>(12).fill(0);
    f6[4] = 1;
    expect(isNewsFeasible(28, ctx({ stockF6: f6 }))).toBe(true);
  });
});

describe('移动方式类（16/17 互补）', () => {
  it('事件 16 需要有 trafficMethod === 0 的在场玩家', () => {
    expect(isNewsFeasible(16, ctx({ players: [makePlayer({ trafficMethod: 0 })] }))).toBe(true);
    expect(isNewsFeasible(16, ctx({ players: [makePlayer({ trafficMethod: 1 })] }))).toBe(false);
  });
  it('事件 17 需要有 trafficMethod !== 0 的在场玩家', () => {
    expect(isNewsFeasible(17, ctx({ players: [makePlayer({ trafficMethod: 1 })] }))).toBe(true);
    expect(isNewsFeasible(17, ctx({ players: [makePlayer({ trafficMethod: 0 })] }))).toBe(false);
  });
  it('出局玩家不计入', () => {
    const c = ctx({ players: [makePlayer({ whoPlays: WHO_PLAYS_DEAD, trafficMethod: 0 })] });
    expect(isNewsFeasible(16, c)).toBe(false);
  });
});

describe('上市企业类', () => {
  it('事件 29 需要有主企业且通过附加判定', () => {
    const coms = [{ owner: 2, field0x28: 0 }];
    expect(isNewsFeasible(29, ctx({ commercials: coms, checkCommercialOwner: () => false }))).toBe(false);
    expect(isNewsFeasible(29, ctx({ commercials: coms, checkCommercialOwner: () => true }))).toBe(true);
    // 无主企业直接跳过
    expect(isNewsFeasible(29, ctx({ commercials: [{ owner: 0, field0x28: 0 }], checkCommercialOwner: () => true }))).toBe(false);
  });

  it('事件 29 传给附加判定的是 owner-1（0 基）', () => {
    let got = -1;
    isNewsFeasible(29, ctx({
      commercials: [{ owner: 3, field0x28: 0 }],
      checkCommercialOwner: (i) => { got = i; return true; },
    }));
    expect(got).toBe(2);
  });

  it('事件 35 需要有企业的 field0x28 > 10000', () => {
    expect(isNewsFeasible(35, ctx({ commercials: [{ owner: 1, field0x28: 10_000 }] }))).toBe(false);
    expect(isNewsFeasible(35, ctx({ commercials: [{ owner: 1, field0x28: 10_001 }] }))).toBe(true);
  });
});
