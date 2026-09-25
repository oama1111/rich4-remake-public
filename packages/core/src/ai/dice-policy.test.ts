/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * AI 掷几颗骰子 —— `fcn_004221c0`（唯一调用点 VA 0x00418e70）
 *
 * 第二十一份試玩回報（`20260924-143945394`，第 66 回合）：「明明背着定时炸弹还要开车并且扔3颗骰子，
 * 这样车也炸没了」。现场：P3 引信 7、徒步 → 用汽車（原版也会，`0x00421675` 不看 `+0x40`）→
 * **掷 3 颗**（4+6+5）→ 第 7 格炸、车一起没。原版掷骰前 `0x00422202 cmp 引信, 0xf / jl` ⇒ 只掷 1 颗。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { GameState } from '../state/types.ts';
import type { MapNode, Rich4Map } from '../loaders/map.ts';
import type { MapTopology } from '../state/reduce.ts';
import { reduce } from '../state/reduce.ts';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { makeObjects } from '../cards/summon.ts';
import { OBJECT_COUNT } from '../rules/objects.ts';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { AI_BOMB_FUSE_ONE_DIE, AI_DICE_LOOKAHEAD, aiDiceCount } from './dice-policy.ts';
import { decideAction } from './policy.ts';
import { WatcomRng } from '../rng/watcom.ts';

/** 定時炸彈的第一个物件槽（槽 36..45 = 类型 18）@source `0x0041c025` 一带的槽位表 */
const BOMB_SLOT = 36;

/** 一条直线步道 1→2→…→n；refs 指定哪几格是地块 / 設施 */
function lineNodes(n: number, refs: Map<number, MapNode['ref']> = new Map()): MapNode[] {
  const out: MapNode[] = [];
  for (let i = 1; i <= n; i++) {
    const adjacent = [i - 1, i + 1].filter((j) => j >= 1 && j <= n);
    out.push(makeNode({ id: i, x: i * 10, y: 0, adjacent, ref: refs.get(i) ?? { kind: 'special' } }));
  }
  return out;
}

interface Scene {
  traffic: number;
  fuse?: number;
  /** 前方 5 格（节点 2..6）各是谁的：'mine' / 'free' / 'theirs' / 'none'（非地产） */
  ahead?: ('mine' | 'free' | 'theirs' | 'none')[];
  facilityAt?: number;
  rngState?: number;
  blocking?: Partial<GameState['players'][number]['blocking']>;
}

function scene(s: Scene): { state: GameState; topo: MapTopology; lands: ReturnType<typeof makeLand>[]; facilities: ReturnType<typeof makeFacility>[] } {
  const ahead = s.ahead ?? ['none', 'none', 'none', 'none', 'none'];
  const refs = new Map<number, MapNode['ref']>();
  const lands: ReturnType<typeof makeLand>[] = [];
  const facilities: ReturnType<typeof makeFacility>[] = [];
  ahead.forEach((kind, k) => {
    if (kind === 'none') return;
    const nodeId = k + 2;
    const owner = kind === 'mine' ? 1 : kind === 'theirs' ? 2 : 0;
    if (s.facilityAt === nodeId) {
      refs.set(nodeId, { kind: 'facility', index: nodeId });
      facilities.push(makeFacility({ id: nodeId, owner }));
    } else {
      refs.set(nodeId, { kind: 'land', index: nodeId });
      lands.push(makeLand({ id: nodeId, owner }));
    }
  });
  const nodes = lineNodes(10, refs);
  const objects = makeObjects(OBJECT_COUNT);
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, nodeId: 10 }));
  players[0] = makePlayer({
    index: 0,
    character: 0,
    nodeId: 1,
    lastNodeId: 0,
    trafficMethod: s.traffic,
    ndices: s.traffic === 2 ? 3 : s.traffic === 1 ? 2 : 1,
    blocking: { ...players[0]!.blocking, ...s.blocking },
  });
  if (s.fuse !== undefined) {
    objects[BOMB_SLOT]!.attached = 1;
    objects[BOMB_SLOT]!.state = s.fuse;
    players[0] = { ...players[0]!, f64: BOMB_SLOT + 1 };
  }
  const state = makeGameState({ players, currentPlayer: 0, objects, rngState: s.rngState ?? 0 });
  return { state, topo: { nodes, lands, facilities }, lands, facilities };
}

const count = (s: Scene): number | null => {
  const { state, topo, lands, facilities } = scene(s);
  return aiDiceCount(state, topo, lands, facilities);
};

describe('★ 常量 = 原版立即数', () => {
  it('引信门槛 0xf（0x00422202 / 0x0042234e）、前瞻 5 格（0x0042221e / 0x0042235d）', () => {
    expect(AI_BOMB_FUSE_ONE_DIE).toBe(15);
    expect(AI_DICE_LOOKAHEAD).toBe(5);
  });
});

describe('★★ 背着定時炸彈（`+0x40 != 0`）：只看引信', () => {
  it('★★ 回报现场：汽車 + 引信 7 ⇒ **1 颗**（0x00422202 `cmp edx,0xf / jl 0x422439`）', () => {
    expect(count({ traffic: 2, fuse: 7 })).toBe(1);
  });
  it('汽車：引信 14 ⇒ 1 颗；15 / 20 ⇒ 3 颗（0x0042220e `jle` 直接返回，默认 3）；38 ⇒ 3 颗', () => {
    expect(count({ traffic: 2, fuse: 14 })).toBe(1);
    expect(count({ traffic: 2, fuse: 15 })).toBe(3);
    expect(count({ traffic: 2, fuse: 20 })).toBe(3);
    expect(count({ traffic: 2, fuse: 38 })).toBe(3);
  });
  it('機車：引信 < 15 ⇒ 1 颗，否则 2 颗（0x00422351）', () => {
    expect(count({ traffic: 1, fuse: 3 })).toBe(1);
    expect(count({ traffic: 1, fuse: 15 })).toBe(2);
  });
  it('背着炸彈时**不看**前方地产（前方全是别人的也照引信走）', () => {
    const theirs = ['theirs', 'theirs', 'theirs', 'theirs', 'theirs'] as const;
    expect(count({ traffic: 2, fuse: 30, ahead: [...theirs] })).toBe(3);
    expect(count({ traffic: 2, fuse: 5, ahead: [...theirs] })).toBe(1);
  });
});

describe('★ 没背炸彈：前瞻 5 格数地产', () => {
  it('前方 ≥2 块「无主或我的」、别人的 ≤1 块 ⇒ 1 颗（0x004222fb / 0x00422428）', () => {
    expect(count({ traffic: 2, ahead: ['free', 'mine', 'theirs', 'none', 'none'] })).toBe(1);
    expect(count({ traffic: 1, ahead: ['free', 'free', 'none', 'none', 'none'] })).toBe(1);
  });
  it('設施也算（`0xfa0 < 实体 < 0x1770`，`+0x19` 主人）', () => {
    expect(count({ traffic: 2, ahead: ['free', 'mine', 'none', 'none', 'none'], facilityAt: 3 })).toBe(1);
  });
  it('前方全是别人的（>2 块）⇒ 汽車 2 + (rand & 1)，機車 2（0x004222e1 / 0x00422421）', () => {
    const theirs = ['theirs', 'theirs', 'theirs', 'none', 'none'] as const;
    const car = new Set<number | null>();
    for (let r = 0; r < 16; r++) car.add(count({ traffic: 2, ahead: [...theirs], rngState: r }));
    expect(car).toEqual(new Set([2, 3]));
    expect(count({ traffic: 1, ahead: [...theirs] })).toBe(2);
  });
  it('其余情形保持默认（汽車 3 / 機車 2）', () => {
    expect(count({ traffic: 2 })).toBe(3);
    expect(count({ traffic: 1, ahead: ['free', 'theirs', 'theirs', 'none', 'none'] })).toBe(2);
  });
});

describe('闸门：不改的情形', () => {
  it('步行 / 工程車（`+0x11` 整字节既不是 1 也不是 2）⇒ 不改', () => {
    expect(count({ traffic: 0, fuse: 3 })).toBeNull();
    expect(count({ traffic: 0x1f, fuse: 3 })).toBeNull();
  });
  it('住院 / 睡眠 / 夢遊（0x00418e36..0x00418e4f）⇒ 不调它', () => {
    expect(count({ traffic: 2, fuse: 3, blocking: { inHospital: 1 } })).toBeNull();
    expect(count({ traffic: 2, fuse: 3, blocking: { sleeping: 1 } })).toBeNull();
    expect(count({ traffic: 2, fuse: 3, blocking: { sleepWalking: 1 } })).toBeNull();
  });
});

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

/**
 * ★★ FU-2（2026-09-25 审计）：骰子数那一步现在**在 reducer 的 `aiAdvance` 第 3 步里算**
 *   （`0x00418e70 call 0x4221c0` 一回合只算一次）。
 *
 *   先前策略层出 `setDiceCount`：`aiDiceCount` 里的前瞻岔路与 `rand()&1` 每帧重算一次，
 *   换成真随机流之后会一次比一次多掷、`ndices` 还会来回改。搬进 reducer 之后
 *   「算一次、掷一次、写一次」，策略层到这一步只剩 `rollDice`。
 */
describe('★★ 骰子数在 reducer 的第 3 步（`aiAdvance`）：算一次、写一次，再掷', () => {
  run('★★ 电脑开汽車、背着引信 7 的炸彈 ⇒ 第 3 步把 ndices 写成 1 → rollDice 只掷 1 颗；不来回改', () => {
    const map: Rich4Map = parseMap(new Uint8Array(readFileSync(MAP)));
    const s0 = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 3 });
    const objects = s0.objects.map((o) => ({ ...o }));
    objects[BOMB_SLOT]!.attached = s0.currentPlayer + 1;
    objects[BOMB_SLOT]!.state = 7;
    const s1: GameState = {
      ...s0,
      phase: 'awaitingRoll',
      aiStep: 2,
      objects,
      players: s0.players.map((p, i) =>
        i === s0.currentPlayer ? { ...p, trafficMethod: 2, ndices: 3, f64: BOMB_SLOT + 1, cards: [], } : p,
      ),
      // 手里没卡没道具 ⇒ 策略层在第 2 步发 aiNext，reducer 顺势走到第 3 步
      tools: s0.tools.map(() => 0),
    };
    expect(decideAction({ state: s1, map })).toEqual({ type: 'aiNext' });
    const s2 = reduce(s1, { type: 'aiNext' }, map);
    expect(s2.aiStep).toBe(3);
    expect(s2.players[s2.currentPlayer]!.ndices).toBe(1);
    expect(s2.players[s2.currentPlayer]!.trafficMethod).toBe(2); // 车照开（原版汽車判定不看炸彈）
    // 下一步就是掷骰（骰子数已定，不会再改）
    const a2 = decideAction({ state: s2, map });
    expect(a2).toEqual({ type: 'rollDice' });
    const s3 = reduce(s2, a2!, map);
    expect(s3.dice).toHaveLength(1);
    expect(s3.players[s3.currentPlayer]!.ndices).toBe(1);
    // 再走一次第 3 步也不重算（`s.aiStep < 3` 的闸门）—— 掷数与 ndices 都不动
    const again = reduce(s3, { type: 'aiNext' }, map);
    expect(again.players[again.currentPlayer]!.ndices).toBe(1);
  });

  run('★ 第 3 步在 reducer 里**现掷**：rngState 恰好前进「决策掷数」（前瞻岔路 + `rand()&1`）', () => {
    // 一条直线 1→2→…→10，前方 5 格全是别人的 ⇒ `0x004222d8` 那支：先前瞻（`0x0042221e`），
    // 再 `rand()&1`（`0x004222e1`）。起点/终点都只有一条路 ⇒ 前瞻不掷；这里只钉「掷数一致」。
    const { state, topo, lands, facilities } = scene({ traffic: 2, ahead: ['theirs', 'theirs', 'theirs', 'theirs', 'theirs'] });
    const s1: GameState = {
      ...state,
      phase: 'awaitingRoll',
      aiStep: 2,
      aiBranch: 0,
      players: state.players.map((p, i) => (i === 0 ? { ...p, whoPlays: 2, cards: [] } : p)),
      tools: state.tools.map(() => 0),
    };
    // 决策掷了几次（记账脚本）
    let calls = 0;
    const counting = new WatcomRng();
    counting.setState(s1.rngState);
    const want = aiDiceCount(s1, topo, lands, facilities, () => (calls++, counting.next()));
    expect(want).not.toBeNull();
    const after = reduce(s1, { type: 'aiNext' }, topo);
    expect(after.aiStep).toBe(3);
    expect(after.players[after.currentPlayer]!.ndices).toBe(want);
    const replay = new WatcomRng();
    replay.setState(s1.rngState);
    for (let i = 0; i < calls; i++) replay.next();
    expect(after.rngState).toBe(replay.getState());
  });

  run('步行的电脑背着炸彈 ⇒ 第 3 步不改 ndices（`0x0042231c jne 0x422440`），策略层直接掷', () => {
    const map: Rich4Map = parseMap(new Uint8Array(readFileSync(MAP)));
    const s0 = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 3 });
    const objects = s0.objects.map((o) => ({ ...o }));
    objects[BOMB_SLOT]!.attached = s0.currentPlayer + 1;
    objects[BOMB_SLOT]!.state = 3;
    const s1: GameState = {
      ...s0,
      phase: 'awaitingRoll',
      aiStep: 2,
      objects,
      players: s0.players.map((p, i) => (i === s0.currentPlayer ? { ...p, f64: BOMB_SLOT + 1, cards: [] } : p)),
      tools: s0.tools.map(() => 0),
    };
    const s2 = reduce(s1, { type: 'aiNext' }, map);
    expect(s2.players[s2.currentPlayer]!.ndices).toBe(s1.players[s1.currentPlayer]!.ndices);
    expect(decideAction({ state: s2, map })).toEqual({ type: 'rollDice' });
  });
});
