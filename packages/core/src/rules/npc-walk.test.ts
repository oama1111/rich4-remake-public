/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 四大惡人的走子循环
 */

import { describe, expect, it } from 'vitest';
import { applyNpcEvents, runNpc, thugFeeAt, type NpcMap } from './npc-walk.ts';
import { ACTOR_PLACE, releaseNpc } from './special-actors.ts';
import { NPC } from './npc-actions.ts';
import { TREASURE_POINTS } from './object-landing.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { toolCount } from './tools.ts';
import type { GameState } from '../state/types.ts';
import type { MapObject } from '../cards/summon.ts';

/** 一条直路 1→2→3→…，21 格 */
function straight(special: Record<number, number> = {}): NpcMap {
  return {
    nodes: Array.from({ length: 21 }, (_, i) =>
      makeNode({
        id: i + 1,
        adjacent: i === 0 ? [2] : [i, i + 2],
        specialKind: special[i + 1] ?? 0,
      }),
    ),
  };
}
const line = (from: number): number => from + 1;

function rng(seed = 7): WatcomRng {
  const r = new WatcomRng();
  r.setState(seed);
  return r;
}

function obj(type: number, nodeId: number): MapObject {
  return { type, nodeId, state: 0, attached: 0 };
}

describe('走子本身', () => {
  it('走满给定步数，路径含起点', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })] });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 5), s, straight(), line, rng());
    expect(w.path).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('★ 起点那一格不结算 —— 他是从那儿起步的', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 9 })],
      objects: [obj(14, 1)], // 寶箱就在起点
    });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 3), s, straight(), line, rng());
    expect(w.events).toEqual([]);
  });

  it('★ 走完留在原地、仍在棋盘上，下一輪接着走（0x00418f93 每輪都轮到 +10 == 0 的惡人）', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })] });
    const w = runNpc(NPC.robber, releaseNpc(1, 0, 3), s, straight(), line, rng());
    expect(w.actor.nodeId).toBe(4);
    expect(w.actor.lastNodeId).toBe(3);
    expect(w.actor.place).toBe(ACTOR_PLACE.board);
    expect(w.actor.stepsRemaining).toBe(0);
    expect(w.actor.owner).toBe(0);
  });
});

describe('★ 小偷：沿路捡东西、拆陷阱', () => {
  const owner = 0;
  const base = (objects: MapObject[]): GameState =>
    makeGameState({ players: [makePlayer({ index: 0, nodeId: 20, points: 100 })], objects });

  it('★ 拆下来的陷阱原样回收成道具 2/3/4', () => {
    const s = base([obj(16, 2), obj(17, 3), obj(18, 4)]);
    const w = runNpc(NPC.thief, releaseNpc(1, owner, 5), s, straight(), line, rng());
    expect(w.events.filter((e) => e.kind === 'loot').map((e) => e.kind === 'loot' && e.tool))
      .toEqual([2, 3, 4]);

    const out = applyNpcEvents(s, owner, w.events).state;
    expect(out.objects.every((o) => o.nodeId === 0)).toBe(true);
    expect(toolCount(out.tools, owner, 2)).toBe(1);
    expect(toolCount(out.tools, owner, 3)).toBe(1);
    expect(toolCount(out.tools, owner, 4)).toBe(1);
  });

  it('★ 寶箱不折道具 —— 给主人 500 點券', () => {
    const s = base([obj(14, 3)]);
    const w = runNpc(NPC.thief, releaseNpc(1, owner, 5), s, straight(), line, rng());
    const loot = w.events.find((e) => e.kind === 'loot');
    expect(loot?.kind === 'loot' && loot.tool).toBe(0);

    const out = applyNpcEvents(s, owner, w.events).state;
    expect(out.players[owner]?.points).toBe(100 + TREASURE_POINTS);
  });

  it('禮物抽一件道具（1..8，按库存加权）', () => {
    const s = base([obj(13, 3)]);
    const w = runNpc(NPC.thief, releaseNpc(1, owner, 5), s, straight(), line, rng());
    const loot = w.events.find((e) => e.kind === 'loot');
    expect(loot?.kind).toBe('loot');
    const tool = loot?.kind === 'loot' ? loot.tool : 0;
    expect(tool).toBeGreaterThanOrEqual(1);
    expect(tool).toBeLessThanOrEqual(8);
  });

  it('★ 神明碰不得 —— 小偷偷不走神', () => {
    const s = base([obj(5, 3), obj(15, 4)]); // 財神、死神
    const w = runNpc(NPC.thief, releaseNpc(1, owner, 6), s, straight(), line, rng());
    expect(w.events.filter((e) => e.kind === 'loot')).toEqual([]);
  });

  it('★ 另外三个不「捡」东西 —— 那五个分支都以 `cmp 4` 开头（但他们会**挨陷阱**）', () => {
    const s = base([obj(14, 3), obj(18, 4)]); // 寶箱 / 定時炸彈：5..7 踩上去什么也不发生
    for (const actor of [NPC.robber, NPC.thug, NPC.spy]) {
      const w = runNpc(actor, releaseNpc(1, owner, 5), s, straight(), line, rng());
      expect(w.events, `actor ${actor}`).toEqual([]);
    }
  });
});

describe('★ 陷阱：小偷拆、另外三个挨（分派器玩家分支，@source 0x41bceb / 0x41be5f）', () => {
  const owner = 0;
  const base = (objects: MapObject[]): GameState =>
    makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })], objects });

  it('★ 路障**半途**就拦下另外三个（不看剩余步数）', () => {
    const s = base([obj(16, 2)]);
    for (const actor of [NPC.robber, NPC.thug, NPC.spy]) {
      const w = runNpc(actor, releaseNpc(1, owner, 5), s, straight(), line, rng());
      // 走到第 2 格被拦下 —— 只走了两步，人还留在那一格
      expect(w.path, `actor ${actor}`).toEqual([1, 2]);
      expect(w.actor.nodeId).toBe(2);
      expect(w.actor.place).toBe(ACTOR_PLACE.board);
      expect(w.events).toEqual([
        { kind: 'trap', node: 2, object: 0, objectType: 16, hospital: false },
      ]);
      const out = applyNpcEvents(s, owner, w.events).state;
      expect(out.objects[0]?.nodeId).toBe(0);
      expect(out.toolStock[2]).toBe(100); // 预置 99 → 回商店库存 +1
      expect(toolCount(out.tools, owner, 2)).toBe(0); // ★ 不进任何人的道具栏
    }
  });

  it('★ 地雷**只有停在这一格**才炸 —— 路过没事', () => {
    const s = base([obj(17, 2)]);
    const w = runNpc(NPC.robber, releaseNpc(1, owner, 5), s, straight(), line, rng());
    expect(w.path).toEqual([1, 2, 3, 4, 5, 6]);
    expect(w.events).toEqual([]);
  });

  it('★★ 地雷踩在最后一格 ⇒ 拆除 + 替身进医院（3 天由原版 `0x43ec3f(actor,3)` 给）', () => {
    const s = base([obj(17, 6)]);
    const w = runNpc(NPC.thug, releaseNpc(1, owner, 5), s, straight(), line, rng());
    expect(w.path).toEqual([1, 2, 3, 4, 5, 6]);
    expect(w.events).toEqual([
      { kind: 'trap', node: 6, object: 0, objectType: 17, hospital: true },
    ]);
    expect(w.actor.place).toBe(ACTOR_PLACE.hospital);
    const out = applyNpcEvents(s, owner, w.events).state;
    expect(out.objects[0]?.nodeId).toBe(0);
    expect(out.toolStock[3]).toBe(100);
    expect(toolCount(out.tools, owner, 3)).toBe(0);
  });

  it('★ 小偷不上当 —— 地雷照拆、进的是**主人**的道具栏，人没事', () => {
    const s = base([obj(17, 5)]);
    const w = runNpc(NPC.thief, releaseNpc(1, owner, 5), s, straight(), line, rng());
    expect(w.actor.place).toBe(ACTOR_PLACE.board);
    expect(w.events.map((e) => e.kind)).toEqual(['loot']);
    const out = applyNpcEvents(s, owner, w.events).state;
    expect(toolCount(out.tools, owner, 3)).toBe(1);
  });
});

describe('★ 同格有人', () => {
  const map = straight();

  it('小偷偷一半點券给主人', () => {
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 20, points: 100 }),
        makePlayer({ index: 1, nodeId: 3, points: 901 }),
      ],
    });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 5), s, map, line, rng());
    expect(w.events).toContainEqual({ kind: 'points', victim: 1, amount: 450 });

    const out = applyNpcEvents(s, 0, w.events).state;
    expect(out.players[1]?.points).toBe(451);
    expect(out.players[0]?.points).toBe(550);
  });

  it('★ 主人自己踩上去不被偷', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 3, points: 900 })],
    });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 5), s, map, line, rng());
    expect(w.events).toEqual([]);
  });

  it('★ 強盜/流氓/間諜 抽一张牌给主人', () => {
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 20, cards: [] }),
        makePlayer({ index: 1, nodeId: 3, cards: [7] }),
      ],
    });
    for (const actor of [NPC.robber, NPC.thug, NPC.spy]) {
      const w = runNpc(actor, releaseNpc(1, 0, 5), s, map, line, rng());
      expect(w.events, `actor ${actor}`).toContainEqual({ kind: 'card', victim: 1, card: 7 });
      const out = applyNpcEvents(s, 0, w.events).state;
      expect(out.players[1]?.cards).toEqual([]);
      expect(out.players[0]?.cards).toEqual([7]);
    }
  });

  it('空手的抽不到牌', () => {
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 20 }),
        makePlayer({ index: 1, nodeId: 3, cards: [] }),
      ],
    });
    const w = runNpc(NPC.robber, releaseNpc(1, 0, 5), s, map, line, rng());
    expect(w.events).toEqual([]);
  });
});

describe('★ 強盜踩銀行', () => {
  const map = straight({ 4: SPECIAL_KIND.BANK });

  const players = [
    makePlayer({ index: 0, nodeId: 20, cash: 0, moneyInBank: 0 }),
    makePlayer({ index: 1, nodeId: 20, cash: 60_000, moneyInBank: 50_000 }),
    makePlayer({ index: 2, nodeId: 20, cash: 60_000, moneyInBank: 100_000 }),
  ];

  it('每个对手掏两成存款，钱归主人', () => {
    const s = makeGameState({ players });
    const w = runNpc(NPC.robber, releaseNpc(1, 0, 5), s, map, line, rng());
    expect(w.events).toEqual([
      { kind: 'robBank', from: 1, amount: 10_000 },
      { kind: 'robBank', from: 2, amount: 20_000 },
    ]);

    // ★ 搶銀行那笔**進現金**（@source `push 5`，bit0 = 進現金）
    const out = applyNpcEvents(s, 0, w.events).state;
    expect(out.players[0]?.cash).toBe(30_000);
  });

  it('★ 只有強盜会抢 —— 另外三个路过银行什么也不做', () => {
    const s = makeGameState({ players });
    for (const actor of [NPC.thief, NPC.thug, NPC.spy]) {
      const w = runNpc(actor, releaseNpc(1, 0, 5), s, map, line, rng());
      expect(w.events.filter((e) => e.kind === 'robBank'), `actor ${actor}`).toEqual([]);
    }
  });

  it('★ 主人自己不被抢', () => {
    const s = makeGameState({ players });
    const w = runNpc(NPC.robber, releaseNpc(1, 1, 5), s, map, line, rng());
    // 0 号存款为零（抢不到），1 号是主人（不抢），只剩 2 号
    expect(w.events).toEqual([{ kind: 'robBank', from: 2, amount: 20_000 }]);
  });
});

describe('★ 再踩到老家就回去', () => {
  it('小偷（監獄出身）踩到監獄格 → 回監獄，这趟就此结束', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })] });
    const map = straight({ 3: SPECIAL_KIND.PRISON });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 9), s, map, line, rng());
    expect(w.events.at(-1)).toEqual({ kind: 'home', place: 'prison', node: 3 });
    expect(w.actor.place).toBe(ACTOR_PLACE.prison);
    // 走到 3 就打住，不会继续到 10
    expect(w.path).toEqual([1, 2, 3]);
  });

  it('★ 監獄出身的踩醫院格没事，反之亦然', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })] });
    const hospital = straight({ 3: SPECIAL_KIND.HOSPITAL });
    const w = runNpc(NPC.thief, releaseNpc(1, 0, 5), s, hospital, line, rng());
    expect(w.events.filter((e) => e.kind === 'home')).toEqual([]);

    const prison = straight({ 3: SPECIAL_KIND.PRISON });
    const w2 = runNpc(NPC.spy, releaseNpc(1, 0, 5), s, prison, line, rng());
    expect(w2.events.filter((e) => e.kind === 'home')).toEqual([]);
  });

  it('間諜（醫院出身）踩到醫院格 → 回醫院', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 20 })] });
    const map = straight({ 4: SPECIAL_KIND.HOSPITAL });
    const w = runNpc(NPC.spy, releaseNpc(1, 0, 9), s, map, line, rng());
    expect(w.events.at(-1)).toEqual({ kind: 'home', place: 'hospital', node: 4 });
    expect(w.actor.place).toBe(ACTOR_PLACE.hospital);
  });
});

describe('★ 流氓勒索保護費', () => {
  /** 3 号与 5 号都是「台北市」，4 号是「高雄市」 */
  const lands = [
    { id: 1, name: '台北市', landPrice: 1000 },
    { id: 2, name: '高雄市', landPrice: 500 },
    { id: 3, name: '台北市', landPrice: 2000 },
  ].map((l) => ({
    ...l,
    x: 0, y: 0, priceStatus: 0, type: 0, owner: 0, level: 0, facing: 0,
    housePrice: 0, rentByLevel: [0, 0, 0, 0, 0, 0], flast: 0,
  }));

  const map: NpcMap = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3] }),
      makeNode({ id: 3, adjacent: [2, 4], type: 2001, ref: { kind: 'land', index: 1 } }),
      makeNode({ id: 4, adjacent: [3, 5], type: 2002, ref: { kind: 'land', index: 2 } }),
      makeNode({ id: 5, adjacent: [4] }),
    ],
    lands,
  };

  function withOwners(owner: number[]): GameState {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20 }), makePlayer({ index: 1, nodeId: 20, cash: 99_999 })],
      priceIndex: 1,
    });
    const landOwner = [...s.landOwner];
    owner.forEach((o, i) => { landOwner[i + 1] = o; });
    return { ...s, landOwner };
  }

  it('★ 同名同主的地價全加起来 —— 1 与 3 都是台北市', () => {
    const s = withOwners([2, 0, 2]); // 1 号与 3 号归玩家 1（1 基 = 2）
    const node = map.nodes[2]!;
    expect(thugFeeAt(s, map, node)).toEqual({ landlord: 1, amount: 1000 + 2000 });
  });

  it('无主地勒索不到', () => {
    const s = withOwners([0, 0, 0]);
    expect(thugFeeAt(s, map, map.nodes[2]!)).toBeNull();
  });

  it('★ 主人自己的地不勒索', () => {
    const s = withOwners([1, 0, 1]); // 归玩家 0
    const w = runNpc(NPC.thug, releaseNpc(1, 0, 4), s, map, line, rng());
    expect(w.events.filter((e) => e.kind === 'protection')).toEqual([]);
  });

  it('钱从地主转给主人', () => {
    const s = withOwners([2, 0, 2]);
    const w = runNpc(NPC.thug, releaseNpc(1, 0, 4), s, map, line, rng());
    expect(w.events).toContainEqual({ kind: 'protection', landlord: 1, amount: 3000 });
    // ★ 保護費那笔**進存款**（@source `push 0`）—— 与搶銀行不同口
    const out = applyNpcEvents(s, 0, w.events).state;
    expect(out.players[0]!.moneyInBank - s.players[0]!.moneyInBank).toBe(3000);
    expect(out.players[0]!.cash).toBe(s.players[0]!.cash);
    expect(s.players[1]!.cash - out.players[1]!.cash).toBe(3000);
  });

  it('★ 只有流氓勒索 —— 小偷/強盜/間諜路过不收钱', () => {
    const s = withOwners([2, 0, 2]);
    for (const actor of [NPC.thief, NPC.robber, NPC.spy]) {
      const w = runNpc(actor, releaseNpc(1, 0, 4), s, map, line, rng());
      expect(w.events.filter((e) => e.kind === 'protection'), `actor ${actor}`).toEqual([]);
    }
  });
});
