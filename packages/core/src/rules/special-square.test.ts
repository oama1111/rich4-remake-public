/*
 * 特殊格结算验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  handlerFor,
  settleSpecialSquare,
  addPoints,
  POINTS_AWARD,
  MAX_SPECIAL_KIND,
  SPECIAL_HANDLERS,
} from './special-square.ts';
import { SPECIAL_KIND, parseMap } from '../loaders/map.ts';
import type { Player } from '../state/types.ts';
import { WHO_PLAYS_HUMAN } from '../state/types.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const d = existsSync(MAP0) ? describe : describe.skip;

function player(over: Partial<Player> = {}): Player {
  return {
    index: 0, character: 0, whoPlays: WHO_PLAYS_HUMAN,
    nodeId: 1, lastNodeId: 0, direction: 0, trafficMethod: 0, ndices: 1,
    cash: 100000, moneyInBank: 0, loan: 0, specialFinance: 0, f44: 0, points: 0,
    blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: 0 },
    daysRejectedByBank: 0,
    godInfo: 0, cards: [], tools: new Array<number>(13).fill(0),
    alliedPlayer: 0, alliedDays: 0,
    ...over,
  };
}

describe('17 路跳表', () => {
  it('恰好覆盖 kind 0..16', () => {
    expect(MAX_SPECIAL_KIND).toBe(16);
    expect(Object.keys(SPECIAL_HANDLERS).length).toBe(17);
    for (let k = 0; k <= 16; k++) {
      expect(handlerFor(k), `kind ${k}`).not.toBe('none');
    }
  });

  it('超出上界的 kind 无效果（原版 cmp 0x10 / ja → end）', () => {
    expect(handlerFor(17)).toBe('none');
    expect(handlerFor(255)).toBe('none');
  });

  it('跳表映射与原版一致', () => {
    expect(handlerFor(SPECIAL_KIND.NONE)).toBe('land');
    expect(handlerFor(SPECIAL_KIND.PARK)).toBe('noop');
    expect(handlerFor(SPECIAL_KIND.NEWS)).toBe('news');
    expect(handlerFor(SPECIAL_KIND.FORTUNE)).toBe('fortune');
    expect(handlerFor(SPECIAL_KIND.PRISON)).toBe('prison');
    expect(handlerFor(SPECIAL_KIND.HOSPITAL)).toBe('hospital');
    expect(handlerFor(SPECIAL_KIND.LOTTERY)).toBe('lottery');
    expect(handlerFor(SPECIAL_KIND.CARD)).toBe('card');
    expect(handlerFor(SPECIAL_KIND.BANK)).toBe('bank');
    expect(handlerFor(SPECIAL_KIND.MAGIC_HOUSE)).toBe('magicHouse');
  });
});

describe('公園 —— 落地无任何效果', () => {
  it('这是原版行为，不是未实现', () => {
    const out = settleSpecialSquare(SPECIAL_KIND.PARK, player(), [], 123);
    expect(out.handler).toBe('noop');
    expect(out.unimplemented).toBe(false); // 关键：不是待办
    expect(out.pointsDelta).toBe(0);
    expect(out.cardDrawn).toBe(0);
    expect(out.rngState).toBe(123); // 不消耗随机数
  });
});

describe('得点格', () => {
  it('三档点数分别为 50 / 30 / 10', () => {
    expect(POINTS_AWARD[SPECIAL_KIND.POINTS_50]).toBe(50);
    expect(POINTS_AWARD[SPECIAL_KIND.POINTS_30]).toBe(30);
    expect(POINTS_AWARD[SPECIAL_KIND.POINTS_10]).toBe(10);
  });

  it.each([
    [SPECIAL_KIND.POINTS_50, 50],
    [SPECIAL_KIND.POINTS_30, 30],
    [SPECIAL_KIND.POINTS_10, 10],
  ])('kind %i 给 %i 点', (kind, pts) => {
    const out = settleSpecialSquare(kind, player(), [], 1);
    expect(out.pointsDelta).toBe(pts);
    expect(out.rngState).toBe(1); // 得点不消耗随机数
  });

  it('★ points 是 uint16，溢出会回绕（原版行为，保留不修）', () => {
    // @source 原版用 add word，不做饱和处理
    expect(addPoints(65535, 1)).toBe(0);
    expect(addPoints(65530, 50)).toBe(44);
    expect(addPoints(100, 50)).toBe(150);
  });
});

describe('卡片格', () => {
  it('按牌堆剩余量抽卡并推进 PRNG', () => {
    const amounts = new Array<number>(30).fill(0);
    amounts[6] = 5; // 只有改建卡
    const out = settleSpecialSquare(SPECIAL_KIND.CARD, player(), amounts, 1);
    expect(out.handler).toBe('card');
    expect(out.cardDrawn).toBe(7); // 1 基
    expect(out.rngState).not.toBe(1); // 消耗了随机数
  });

  it('牌堆为空时抽不到卡', () => {
    const out = settleSpecialSquare(SPECIAL_KIND.CARD, player(), new Array<number>(30).fill(0), 1);
    expect(out.cardDrawn).toBe(0);
  });
});

describe('尚未实现的格子被如实标记', () => {
  it.each([
    SPECIAL_KIND.NEWS,
    SPECIAL_KIND.FORTUNE,
    SPECIAL_KIND.PRISON,
    SPECIAL_KIND.HOSPITAL,
    SPECIAL_KIND.PENGUIN_DIG,
    SPECIAL_KIND.BALLOON,
    SPECIAL_KIND.GIFT_FROM_SKY,
    SPECIAL_KIND.LOTTERY,
    SPECIAL_KIND.BANK,
    SPECIAL_KIND.DEPARTMENT_STORE,
    SPECIAL_KIND.MAGIC_HOUSE,
  ])('kind %i 标记为 unimplemented', (kind) => {
    const out = settleSpecialSquare(kind, player(), [], 1);
    expect(out.unimplemented).toBe(true);
    // 未实现不等于「静默无效果」——状态不被悄悄改动
    expect(out.pointsDelta).toBe(0);
    expect(out.cardDrawn).toBe(0);
    expect(out.rngState).toBe(1);
  });
});

d('真实地图上的特殊格覆盖率', () => {
  it('地图0 的特殊格全部落在跳表范围内', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP0)));
    const kinds = new Map<number, number>();
    for (const n of map.nodes) {
      if (n.type !== 0) continue; // 只看特殊格
      kinds.set(n.specialKind, (kinds.get(n.specialKind) ?? 0) + 1);
    }
    for (const [kind] of kinds) {
      expect(kind).toBeLessThanOrEqual(MAX_SPECIAL_KIND);
      expect(handlerFor(kind)).not.toBe('none');
    }
    expect(kinds.size).toBeGreaterThan(5);
  });

  it('统计已实现 vs 待实现的格子占比', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP0)));
    let done = 0;
    let todo = 0;
    for (const n of map.nodes) {
      if (n.type !== 0) continue;
      const out = settleSpecialSquare(n.specialKind, player(), [], 1);
      if (out.unimplemented) todo++;
      else done++;
    }
    console.log(`  地图0 特殊格：已实现 ${done} 个，待实现 ${todo} 个`);
    expect(done).toBeGreaterThan(0);
  });
});
