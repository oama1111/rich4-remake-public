/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 魔法屋：两个转盘
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import type { Player } from '../state/types.ts';
import { WHO_PLAYS_COMPUTER } from '../state/types.ts';
import { MAGIC_HOUSE_OPTIONS, TOOLS } from '@rich4/data';
import { TOOL_SLOTS_PER_PLAYER, emptyTools, initialToolStock } from '../rules/tools.ts';
import {
  MAGIC_CONFINE_DAYS,
  MAGIC_HOSTILITY_FACTOR,
  MAGIC_OPTION_MODULUS,
  MAGIC_OPTION_SELF_GIFT,
  MAGIC_TARGET_COUNT,
  MAGIC_TARGET_NAMES,
  MAX_MAGIC_TARGETS,
  applyMagicEffect,
  magicTargets,
  spinMagicHouse,
  type MagicEffectContext,
  type MagicTargetContext,
} from './magic-house.ts';

const four = (over: Partial<Player>[] = []): Player[] =>
  [0, 1, 2, 3].map((i) =>
    makePlayer({
      index: i,
      whoPlays: WHO_PLAYS_COMPUTER,
      cash: 0,
      moneyInBank: 0,
      points: 0,
      trafficMethod: 0,
      nodeId: 10 + i,
      ...(over[i] ?? {}),
    }),
  );

const targetCtx = (players: Player[], over: Partial<MagicTargetContext> = {}): MagicTargetContext => ({
  players,
  landCountOf: () => 0,
  houseCountOf: () => 0,
  wealthOf: () => 0,
  ...over,
});

const effectCtx = (
  players: Player[],
  over: Partial<MagicEffectContext> = {},
): MagicEffectContext => ({
  players,
  cardAmount: new Array<number>(30).fill(3),
  tools: emptyTools(4),
  toolStock: initialToolStock(),
  priceIndex: 2,
  initiator: 0,
  nodeOf: () => ({ type: 2100, buildable: true }),
  nextRandom: () => 0,
  ...over,
});

// ============================================================

describe('目标转盘：12 个「对谁做」', () => {
  it('名称与原版一致', () => {
    expect(MAGIC_TARGET_COUNT).toBe(12);
    expect(MAGIC_TARGET_NAMES[0]).toBe('財產最多的人');
    expect(MAGIC_TARGET_NAMES[9]).toBe('神明附身的人');
    expect(MAGIC_TARGET_NAMES[11]).toBe('所有女生');
  });

  it('現金最多的人', () => {
    const ps = four([{ cash: 100 }, { cash: 900 }, { cash: 300 }, { cash: 0 }]);
    expect(magicTargets(3, targetCtx(ps))).toEqual([1]);
  });

  it('★ 并列的一起点到 —— 原版 `else if (best == v) 收录`', () => {
    const ps = four([{ cash: 500 }, { cash: 500 }, { cash: 200 }, { cash: 0 }]);
    expect(magicTargets(3, targetCtx(ps))).toEqual([0, 1]);
  });

  it('★ 現金/存款/點券为 0 的人不参选 —— 全是 0 就一个也选不出', () => {
    expect(magicTargets(3, targetCtx(four()))).toEqual([]);
    expect(magicTargets(4, targetCtx(four()))).toEqual([]);
    expect(magicTargets(5, targetCtx(four()))).toEqual([]);
  });

  it('★ 但「財產最多的人」不查零 —— 全员身家 0 也照样点得到', () => {
    expect(magicTargets(0, targetCtx(four()))).toEqual([0, 1, 2, 3]);
  });

  it('出局的人不参选', () => {
    const ps = four([{ cash: 900, whoPlays: 0 }, { cash: 100 }]);
    expect(magicTargets(3, targetCtx(ps))).toEqual([1]);
  });

  it('土地最多 vs 房屋最多 —— 后者只数已开发的', () => {
    const ps = four();
    const ctx = targetCtx(ps, {
      landCountOf: (i) => [5, 2, 0, 0][i] ?? 0,
      houseCountOf: (i) => [0, 2, 0, 0][i] ?? 0,
    });
    expect(magicTargets(1, ctx)).toEqual([0]);
    expect(magicTargets(2, ctx)).toEqual([1]);
  });

  it('按交通方式分组 —— 工程車的 traffic & 3 是 3，三组都不属于', () => {
    const ps = four([
      { trafficMethod: 0 },
      { trafficMethod: 1 },
      { trafficMethod: 2 },
      { trafficMethod: 0x1f },
    ]);
    expect(magicTargets(6, targetCtx(ps))).toEqual([0]);
    expect(magicTargets(7, targetCtx(ps))).toEqual([1]);
    expect(magicTargets(8, targetCtx(ps))).toEqual([2]);
  });

  it('神明附身的人', () => {
    const ps = four([{}, { godInfo: 3 }, {}, { godInfo: 1 }]);
    expect(magicTargets(9, targetCtx(ps))).toEqual([1, 3]);
  });

  it('★ 男女两条把 sex 的编码钉死了：非 0 是男、0 是女', () => {
    const ps = four([{ isMale: true }, { isMale: false }, { isMale: true }, { isMale: false }]);
    expect(magicTargets(10, targetCtx(ps))).toEqual([0, 2]);
    expect(magicTargets(11, targetCtx(ps))).toEqual([1, 3]);
  });

  it('名单最多 4 人', () => {
    const ps = four();
    expect(magicTargets(0, targetCtx(ps)).length).toBeLessThanOrEqual(MAX_MAGIC_TARGETS);
  });
});

describe('效果转盘：12 个「做什么」', () => {
  it('选项名与 @rich4/data 对得上', () => {
    expect(MAGIC_HOUSE_OPTIONS[0]!.name).toBe('變賣所有卡片');
    expect(MAGIC_HOUSE_OPTIONS[6]!.name).toBe('得一張卡片');
  });

  it('0 變賣所有卡片 —— ★ 按標價**全额**入點券，不是商店那个九折', () => {
    const ps = four([{ cards: [1, 2] }]); // 均富卡 200 + 均貧卡 200
    const r = applyMagicEffect(0, [0], effectCtx(ps));
    expect(r.players[0]!.cards).toEqual([]);
    expect(r.players[0]!.points).toBe(400);
    // 牌堆张数加回去
    expect(r.cardAmount[0]).toBe(4);
    expect(r.cardAmount[1]).toBe(4);
  });

  it('1 抽取命運三張 —— 交给外层抽三次', () => {
    const r = applyMagicEffect(1, [2], effectCtx(four()));
    expect(r.requests).toEqual([{ player: 2, kind: 'drawFortune', amount: 3 }]);
  });

  it('2 立刻坐牢三天 —— 连带记一笔敌意', () => {
    const r = applyMagicEffect(2, [1], effectCtx(four(), { priceIndex: 3, initiator: 0 }));
    expect(r.requests).toEqual([{ player: 1, kind: 'prison', amount: MAGIC_CONFINE_DAYS }]);
    expect(r.hostilityDeltas).toEqual([{ from: 1, to: 0, delta: 3 * MAGIC_HOSTILITY_FACTOR }]);
  });

  it('3 原地停留一回合 —— 累加，并清掉进位到的标志位', () => {
    const ps = four([{}, { blocking: { ...makePlayer().blocking, stopping: 0x7f } }]);
    const r = applyMagicEffect(3, [0, 1], effectCtx(ps));
    expect(r.players[0]!.blocking.stopping).toBe(1);
    // 0x7f + 1 = 0x80，& 0x7f 归零 —— 与原版 `and cl, 0x7f` 一致
    expect(r.players[1]!.blocking.stopping).toBe(0);
  });

  it('4 存入所有現金', () => {
    const ps = four([{ cash: 12_345, moneyInBank: 1_000 }]);
    const r = applyMagicEffect(4, [0], effectCtx(ps));
    expect(r.players[0]!.cash).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(13_345);
  });

  it('6 得一張卡片 —— 按牌堆剩余加权抽', () => {
    const cardAmount = new Array<number>(30).fill(0);
    cardAmount[4] = 7; // 只有 5 号卡有货
    const r = applyMagicEffect(6, [0], effectCtx(four(), { cardAmount }));
    expect(r.players[0]!.cards).toEqual([5]);
    expect(r.cardAmount[4]).toBe(6);
  });

  it('牌堆全空时什么也不给', () => {
    const r = applyMagicEffect(6, [0], effectCtx(four(), { cardAmount: new Array<number>(30).fill(0) }));
    expect(r.players[0]!.cards).toEqual([]);
  });

  it('7 向後轉 —— 方向 +4 取模 8', () => {
    const ps = four([{ direction: 1 }, { direction: 6 }]);
    const r = applyMagicEffect(7, [0, 1], effectCtx(ps));
    expect(r.players[0]!.direction).toBe(5);
    expect(r.players[1]!.direction).toBe(2);
  });

  it('★ 8 變賣所有道具 —— 先把座驾折回道具栏再一起卖', () => {
    const tools = emptyTools(4);
    tools[0 * TOOL_SLOTS_PER_PLAYER + 3] = 2; // 两个地雷，單價 25
    const ps = four([{ trafficMethod: 2, ndices: 3 }]); // 开汽車，標價 150
    const r = applyMagicEffect(8, [0], effectCtx(ps, { tools }));

    expect(r.players[0]!.points).toBe(2 * 25 + 150);
    expect(r.players[0]!.trafficMethod).toBe(0);
    expect(r.players[0]!.ndices).toBe(1);
    // 道具栏清空
    for (const t of TOOLS) expect(r.tools[0 * TOOL_SLOTS_PER_PLAYER + t.id]).toBe(0);
    // 编号 ≤ 8 的回库存：地雷 +2、汽車 +1
    expect(r.toolStock[3]).toBe((initialToolStock()[3] ?? 0) + 2);
    expect(r.toolStock[6]).toBe((initialToolStock()[6] ?? 0) + 1);
  });

  it('10 住院檢查三天', () => {
    const r = applyMagicEffect(10, [3], effectCtx(four(), { priceIndex: 1 }));
    expect(r.requests).toEqual([{ player: 3, kind: 'hospital', amount: MAGIC_CONFINE_DAYS }]);
  });

  it('★ 就地加蓋/拆除/拍賣：坐牢住院中的人免疫（原版先查 +0x32）', () => {
    const ps = four([{ blocking: { ...makePlayer().blocking, inPrison: 2 } }]);
    for (const option of [5, 9, 11]) {
      expect(applyMagicEffect(option, [0], effectCtx(ps)).requests).toEqual([]);
    }
  });

  it('★ 就地加蓋/拆除/拍賣：不是住宅也不是设施的格子上什么都不做', () => {
    const ctx = effectCtx(four(), { nodeOf: () => ({ type: 7, buildable: false }) });
    for (const option of [5, 9, 11]) {
      expect(applyMagicEffect(option, [0], ctx).requests).toEqual([]);
    }
  });

  it('★ 效果是对**名单里每个人**逐一执行的，不是只对自己', () => {
    const ps = four([{ cash: 100 }, { cash: 200 }, { cash: 300 }, { cash: 400 }]);
    const r = applyMagicEffect(4, [0, 1, 2, 3], effectCtx(ps));
    expect(r.players.map((p) => p.cash)).toEqual([0, 0, 0, 0]);
    expect(r.players.map((p) => p.moneyInBank)).toEqual([100, 200, 300, 400]);
  });
});

describe('转盘怎么转', () => {
  /** 依次吐出给定值的假随机源 */
  const feed = (...vals: number[]) => {
    let i = 0;
    return () => vals[i++] ?? 0;
  };

  it('先抽目标，选不出人就重抽', () => {
    const ps = four([{ trafficMethod: 1 }]); // 只有 0 号骑機車
    // 第一抽 criterion 8（開汽車的人）→ 空 → 重抽 7（騎機車的人）→ 命中
    const spin = spinMagicHouse(targetCtx(ps), 3, feed(8, 7, 0));
    expect(spin.criterion).toBe(7);
    expect(spin.targets).toEqual([0]);
  });

  it('★ 名单里有自己 → 效果固定是「得一張卡片」，不再抽', () => {
    const ps = four([{ cash: 100 }]);
    const spin = spinMagicHouse(targetCtx(ps), 0, feed(3, 99));
    expect(spin.hitSelf).toBe(true);
    expect(spin.option).toBe(MAGIC_OPTION_SELF_GIFT);
  });

  it('★ 效果只抽 0..10，且 6 会被改成 7 —— 6 是自己人的专属', () => {
    const ps = four([{ cash: 100 }]);
    // 目标 criterion 3 命中玩家 0；当前玩家是 3，没点到自己
    for (let r = 0; r < MAGIC_OPTION_MODULUS; r++) {
      const spin = spinMagicHouse(targetCtx(ps), 3, feed(3, r));
      expect(spin.hitSelf).toBe(false);
      expect(spin.option).toBe(r === MAGIC_OPTION_SELF_GIFT ? 7 : r);
    }
  });

  it('★ 电脑那一支：第 11 条「拍賣當格土地」永远转不到 —— 取模底数是 11 不是 12（真人点得到，见 state/magic-choice.test.ts）', () => {
    expect(MAGIC_OPTION_MODULUS).toBe(11);
    const ps = four([{ cash: 100 }]);
    const seen = new Set<number>();
    for (let r = 0; r < 200; r++) seen.add(spinMagicHouse(targetCtx(ps), 3, feed(3, r)).option);
    expect(seen.has(11)).toBe(false);
    expect(seen.has(6)).toBe(false); // 6 也只能靠「点到自己」拿到
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9, 10]);
  });

  it('怎么也选不出人时退回「財產最多」，不会死循环', () => {
    // 全员出局 → 每一条都选不出人
    const dead = four().map((p) => ({ ...p, whoPlays: 0 }));
    const spin = spinMagicHouse(targetCtx(dead), 0, () => 5);
    expect(spin.targets).toEqual([]);
    expect(spin.criterion).toBe(0);
  });
});

// ============================================================
//  T-011：魔法屋的「男生/女生」等按人筛的功能只在玩家里选，四大惡人不在候选里
// ============================================================

describe('★ 魔法屋候选只含玩家（四大惡人不受男性效果影响）', () => {
  it('12 种判据的候选下标都 < 玩家数', () => {
    const ps = [0, 1, 2, 3].map((i) => makePlayer({ index: i, isMale: i % 2 === 0, cash: 100 + i }));
    for (let c = 0; c < 12; c++) {
      const picked = magicTargets(c, {
        players: ps,
        wealthOf: (i) => ps[i]?.cash ?? 0,
        landCountOf: () => 0,
        houseCountOf: () => 0,
      });
      for (const i of picked) expect(i).toBeLessThan(ps.length);
    }
  });
});
