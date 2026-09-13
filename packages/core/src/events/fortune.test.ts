/*
 * 命運事件判定验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { checkFortune, TRAFFIC_EVENT_BASE, CONSTRAINED_FORTUNE_IDS, FORTUNE_DATA_IDX } from './fortune.ts';
import type { FortuneContext } from './fortune.ts';
import { FORTUNE_DECK_SIZE } from './deck.ts';
import type { LandInfo } from '../loaders/map.ts';
import { makePlayer } from '../testing/factories.ts';

function land(over: Partial<LandInfo> = {}): LandInfo {
  return {
    id: 1, x: 0, y: 0, name: 'A', priceStatus: 0, type: 0, owner: 0, level: 0, facing: 0,
    landPrice: 0, housePrice: 0, rentByLevel: [0, 0, 0, 0, 0, 0], flast: 0, ...over,
  };
}
function ctx(over: Partial<FortuneContext> = {}): FortuneContext {
  return {
    currentPlayer: makePlayer(), otherPlayers: [], lands: [],
    stockAmount: new Array<number>(12).fill(0), gameStage: 0, ...over,
  };
}

describe('地产类', () => {
  it('事件 0 需要自有地中有已建房', () => {
    expect(checkFortune(0, ctx({ lands: [land({ owner: 1, level: 0 })] })).feasible).toBe(false);
    expect(checkFortune(0, ctx({ lands: [land({ owner: 1, level: 3 })] })).feasible).toBe(true);
    // 别人的房子不算
    expect(checkFortune(0, ctx({ lands: [land({ owner: 2, level: 3 })] })).feasible).toBe(false);
  });

  it('事件 1 需要自有地中有空地', () => {
    expect(checkFortune(1, ctx({ lands: [land({ owner: 1, level: 2 })] })).feasible).toBe(false);
    expect(checkFortune(1, ctx({ lands: [land({ owner: 1, level: 0 })] })).feasible).toBe(true);
  });
});

describe('其他玩家手牌', () => {
  it('事件 5 需要其他玩家手上有牌', () => {
    expect(checkFortune(5, ctx({ otherPlayers: [makePlayer({ cards: [] })] })).feasible).toBe(false);
    expect(checkFortune(5, ctx({ otherPlayers: [makePlayer({ cards: [3] })] })).feasible).toBe(true);
  });
  it('自己的手牌不算', () => {
    const c = ctx({ currentPlayer: makePlayer({ cards: [1, 2, 3] }), otherPlayers: [makePlayer({ cards: [] })] });
    expect(checkFortune(5, c).feasible).toBe(false);
  });
});

describe('股票类', () => {
  it('事件 8/9 需要当前玩家持股', () => {
    for (const id of [8, 9]) {
      expect(checkFortune(id, ctx()).feasible).toBe(false);
      const holdings = new Array<number>(12).fill(0);
      holdings[3] = 10;
      expect(checkFortune(id, ctx({ stockAmount: holdings })).feasible).toBe(true);
    }
  });
});

describe('★ 交通方式重映射', () => {
  const withTraffic = (t: number) => ctx({ currentPlayer: makePlayer({ trafficMethod: t }) });

  it('事件 10/11 要求 traffic 为 1 或 2', () => {
    expect(checkFortune(10, withTraffic(0)).feasible).toBe(false);
    expect(checkFortune(11, withTraffic(0)).feasible).toBe(false);
    expect(checkFortune(10, withTraffic(3)).feasible).toBe(false);
  });

  it('事件 10 在 traffic=2 时被改写为 11', () => {
    expect(checkFortune(10, withTraffic(2))).toEqual({ feasible: true, eventId: 11 });
    expect(checkFortune(10, withTraffic(1))).toEqual({ feasible: true, eventId: 10 });
  });

  it('事件 11 在 traffic=1 时被改写为 10', () => {
    expect(checkFortune(11, withTraffic(1))).toEqual({ feasible: true, eventId: 10 });
    expect(checkFortune(11, withTraffic(2))).toEqual({ feasible: true, eventId: 11 });
  });

  it('事件 12/13 要求 traffic 为 0 或 1 并互换', () => {
    expect(checkFortune(12, withTraffic(2)).feasible).toBe(false);
    expect(checkFortune(12, withTraffic(1))).toEqual({ feasible: true, eventId: 13 });
    expect(checkFortune(13, withTraffic(0))).toEqual({ feasible: true, eventId: 12 });
  });

  it('★★ 事件 14/15/16 统一映射为 14 + traffic_method', () => {
    // 这条是按**汇编**实现的；csrc/fortune.c 在 case 15 有转录错误
    expect(TRAFFIC_EVENT_BASE).toBe(14);
    for (const src of [14, 15, 16]) {
      for (const t of [0, 1, 2]) {
        expect(checkFortune(src, withTraffic(t)), `事件${src} traffic=${t}`)
          .toEqual({ feasible: true, eventId: 14 + t });
      }
    }
  });

  it('★★ case 15 + traffic=0 映射到 14（而非 C 版写的 15）', () => {
    // @source rich4.asm loc_0044bdd1: test ch,ch / jne / mov dword [edx], 0xe
    expect(checkFortune(15, withTraffic(0)).eventId).toBe(14);
  });

  it('traffic > 2 时 14/15/16 均不可行', () => {
    for (const id of [14, 15, 16]) {
      expect(checkFortune(id, withTraffic(3)).feasible).toBe(false);
    }
  });
});

describe('关卡限定', () => {
  it('事件 33-36 仅第一关可触发', () => {
    for (const id of [33, 34, 35, 36]) {
      expect(checkFortune(id, ctx({ gameStage: 0 })).feasible).toBe(true);
      expect(checkFortune(id, ctx({ gameStage: 1 })).feasible).toBe(false);
    }
  });
});

describe('未约束的事件恒可触发', () => {
  it('不在约束集合中的编号一律可行且不被改写', () => {
    const c = ctx();
    for (let id = 0; id < FORTUNE_DECK_SIZE; id++) {
      if (CONSTRAINED_FORTUNE_IDS.includes(id)) continue;
      expect(checkFortune(id, c), `事件 ${id}`).toEqual({ feasible: true, eventId: id });
    }
  });
});

describe('资源索引表', () => {
  it('49 项，含重复（多个事件共用同一张图）', () => {
    expect(FORTUNE_DATA_IDX.length).toBe(49);
    expect(new Set(FORTUNE_DATA_IDX).size).toBeLessThan(49);
    // 0x01f1 出现三次
    expect(FORTUNE_DATA_IDX.filter((v) => v === 0x01f1).length).toBe(3);
  });
});
