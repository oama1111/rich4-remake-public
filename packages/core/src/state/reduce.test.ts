/*
 * 归约器测试 —— 重点是 C-DET-4 确定性
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { reduce, reduceAll, nextCandidates, nextAlivePlayer } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { Action } from './actions.ts';
import type { GameState, Player } from './types.ts';
import { WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_DEAD } from './types.ts';
import { parseMap } from '../loaders/map.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;

function makePlayer(index: number, over: Partial<Player> = {}): Player {
  return {
    index,
    character: index,
    whoPlays: WHO_PLAYS_HUMAN,
    nodeId: 1,
    lastNodeId: 0,
    direction: 0,
    trafficMethod: 0,
    ndices: 1,
    cash: 100000,
    moneyInBank: 0,
    loan: 0,
    points: 0,
    blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: 0 },
    godInfo: 0,
    cards: [],
    tools: new Array<number>(13).fill(0),
    alliedPlayer: 0,
    alliedDays: 0,
    ...over,
  };
}

function makeState(over: Partial<GameState> = {}): GameState {
  return {
    mode: 'single',
    rngState: 1,
    globalMapId: 0,
    day: 1,
    month: 1,
    year: 1998,
    players: [makePlayer(0), makePlayer(1), makePlayer(2), makePlayer(3)],
    currentPlayer: 0,
    phase: 'turnStart',
    priceIndex: 1,
    dice: [],
    stepsRemaining: 0,
    stepsTotal: 0,
    cardAmount: new Array<number>(30).fill(0),
    landOwner: [],
    landLevel: [],
    turnCount: 0,
    ...over,
  };
}

/** 一张环形小地图，便于精确推演：1→2→3→4→1 */
const ring: MapTopology = {
  nodes: [1, 2, 3, 4].map((id) => ({
    id,
    x: 0,
    y: 0,
    name: `节点${id}`,
    adjacent: [id === 1 ? 4 : id - 1, id === 4 ? 1 : id + 1],
    type: 0,
    ref: { kind: 'special' as const },
    decorIndex: 0,
    flags: 0,
    specialKind: 0,
    noObjects: false,
    walkable: true,
  })),
};

describe('nextCandidates —— 不折返', () => {
  it('环形地图上只有一个前进方向', () => {
    expect(nextCandidates(ring, 2, 1)).toEqual([3]);
    expect(nextCandidates(ring, 3, 2)).toEqual([4]);
  });

  it('起点（无来路）时两个方向都是候选', () => {
    expect(nextCandidates(ring, 1, 0).sort()).toEqual([2, 4]);
  });

  it('死路时允许折返，避免卡死', () => {
    const dead: MapTopology = {
      nodes: [
        { ...ring.nodes[0]!, id: 1, adjacent: [2] },
        { ...ring.nodes[1]!, id: 2, adjacent: [1] },
      ],
    };
    expect(nextCandidates(dead, 2, 1)).toEqual([1]);
  });
});

describe('回合流程', () => {
  it('startTurn 后进入等待掷骰', () => {
    const s = reduce(makeState(), { type: 'startTurn' }, ring);
    expect(s.phase).toBe('awaitingRoll');
  });

  it('被阻碍的玩家直接进入回合结束', () => {
    const st = makeState();
    st.players[0]!.blocking.inPrison = 2;
    const s = reduce(st, { type: 'startTurn' }, ring);
    expect(s.phase).toBe('turnEnd');
  });

  it('掷骰产生点数并进入移动', () => {
    let s = reduce(makeState(), { type: 'startTurn' }, ring);
    s = reduce(s, { type: 'rollDice' }, ring);
    expect(s.phase).toBe('moving');
    expect(s.dice.length).toBe(1);
    expect(s.stepsTotal).toBe(s.dice[0]);
    expect(s.stepsRemaining).toBe(s.stepsTotal);
  });

  it('遥控骰子不消耗随机数且强制点数', () => {
    let s = reduce(makeState({ rngState: 12345 }), { type: 'startTurn' }, ring);
    const before = s.rngState;
    s = reduce(s, { type: 'rollDice', forced: 4 }, ring);
    expect(s.dice).toEqual([4]);
    expect(s.stepsTotal).toBe(4);
    expect(s.rngState).toBe(before); // 状态未推进
  });

  it('逐步移动，步数耗尽后进入结算', () => {
    let s = makeState({ phase: 'moving', stepsRemaining: 3, stepsTotal: 3 });
    s.players[0] = makePlayer(0, { nodeId: 1, lastNodeId: 4 }); // 来自 4，故朝 2 前进
    for (let i = 0; i < 3; i++) s = reduce(s, { type: 'step' }, ring);
    expect(s.players[0]!.nodeId).toBe(4); // 1→2→3→4
    expect(s.stepsRemaining).toBe(0);
    expect(s.phase).toBe('settling');
  });

  it('岔路时停下等待选择', () => {
    const s = reduce(
      makeState({ phase: 'moving', stepsRemaining: 2, stepsTotal: 2 }),
      { type: 'step' },
      ring,
    );
    // 起点 lastNodeId=0，两个方向都可走
    expect(s.phase).toBe('awaitingDirection');
    expect(s.players[0]!.nodeId).toBe(1); // 未移动
  });

  it('选择方向后继续移动', () => {
    let s = makeState({ phase: 'awaitingDirection', stepsRemaining: 2, stepsTotal: 2 });
    s = reduce(s, { type: 'chooseDirection', nodeId: 4 }, ring);
    expect(s.players[0]!.nodeId).toBe(4);
    expect(s.stepsRemaining).toBe(1);
    expect(s.phase).toBe('moving');
  });

  it('非法的方向选择被忽略', () => {
    const st = makeState({ phase: 'awaitingDirection', stepsRemaining: 2, stepsTotal: 2 });
    const s = reduce(st, { type: 'chooseDirection', nodeId: 3 }, ring); // 3 不相邻
    expect(s).toBe(st); // 原样返回
  });

  it('endTurn 轮转到下一位在场玩家并递减天数', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[0]!.blocking.inPrison = 3;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.currentPlayer).toBe(1);
    expect(s.players[0]!.blocking.inPrison).toBe(2);
    expect(s.turnCount).toBe(1);
    expect(s.phase).toBe('turnStart');
  });

  it('天数递减保留高位标志位', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[0]!.blocking.inHospital = 0x80 | 5; // 标志位 + 5 天
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.players[0]!.blocking.inHospital).toBe(0x80 | 4);
  });

  it('出局玩家被跳过', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[1]!.whoPlays = WHO_PLAYS_DEAD;
    st.players[2]!.whoPlays = WHO_PLAYS_DEAD;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.currentPlayer).toBe(3);
  });

  it('nextAlivePlayer 在全员出局时返回原值', () => {
    const st = makeState();
    for (const p of st.players) p.whoPlays = WHO_PLAYS_DEAD;
    expect(nextAlivePlayer(st, 2)).toBe(2);
  });
});

describe('C-ARC-3：不原地修改入参', () => {
  it('reduce 不改动传入的 state', () => {
    const st = makeState();
    const snapshot = JSON.stringify(st);
    reduce(st, { type: 'startTurn' }, ring);
    reduce({ ...st, phase: 'awaitingRoll' }, { type: 'rollDice' }, ring);
    expect(JSON.stringify(st)).toBe(snapshot);
  });
});

describe('★ C-DET-4：确定性', () => {
  /** 一局完整推演：开局播种 → 若干回合 */
  function script(): Action[] {
    const acts: Action[] = [{ type: 'reseed', seed: 0x1234abcd }];
    for (let turn = 0; turn < 40; turn++) {
      acts.push({ type: 'startTurn' });
      acts.push({ type: 'rollDice' });
      for (let i = 0; i < 12; i++) {
        acts.push({ type: 'step' });
        acts.push({ type: 'chooseDirection', nodeId: 2 });
      }
      acts.push({ type: 'settle' });
      acts.push({ type: 'endTurn' });
    }
    return acts;
  }

  it('同一 action 序列重放两次，结果逐字节相同', () => {
    const acts = script();
    const a = reduceAll(makeState(), acts, ring);
    const b = reduceAll(makeState(), acts, ring);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('种子不同则结果必然不同（证明随机确实参与）', () => {
    const mk = (seed: number): Action[] => [
      { type: 'reseed', seed },
      ...script().slice(1),
    ];
    const a = reduceAll(makeState(), mk(111), ring);
    const b = reduceAll(makeState(), mk(222), ring);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('中途快照恢复后继续推演，与不中断的结果一致', () => {
    const acts = script();
    const cut = Math.floor(acts.length / 2);

    // 不中断
    const straight = reduceAll(makeState(), acts, ring);

    // 中途序列化 → 反序列化 → 继续（模拟联机断线重连）
    const mid = reduceAll(makeState(), acts.slice(0, cut), ring);
    const restored = JSON.parse(JSON.stringify(mid)) as GameState;
    const resumed = reduceAll(restored, acts.slice(cut), ring);

    expect(JSON.stringify(resumed)).toBe(JSON.stringify(straight));
  });
});

describe('在真实地图上推演', () => {
  const hasMap = existsSync(MAP0);
  it.skipIf(!hasMap)('地图 0 上跑 200 回合不崩溃且玩家始终在有效节点', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP0)));
    const topo: MapTopology = { nodes: map.nodes };

    let s = makeState({ globalMapId: 0 });
    s.players[1]!.whoPlays = WHO_PLAYS_COMPUTER;
    s = reduce(s, { type: 'reseed', seed: 0xdeadbeef }, topo);

    for (let turn = 0; turn < 200; turn++) {
      s = reduce(s, { type: 'startTurn' }, topo);
      if (s.phase === 'awaitingRoll') s = reduce(s, { type: 'rollDice' }, topo);

      let guard = 0;
      while (s.phase === 'moving' || s.phase === 'awaitingDirection') {
        if (s.phase === 'awaitingDirection') {
          const p = s.players[s.currentPlayer]!;
          const options = nextCandidates(topo, p.nodeId, p.lastNodeId);
          s = reduce(s, { type: 'chooseDirection', nodeId: options[0]! }, topo);
        } else {
          s = reduce(s, { type: 'step' }, topo);
        }
        if (++guard > 100) throw new Error('移动未收敛');
      }
      if (s.phase === 'settling') s = reduce(s, { type: 'settle' }, topo);
      s = reduce(s, { type: 'endTurn' }, topo);

      for (const p of s.players) {
        expect(p.nodeId).toBeGreaterThanOrEqual(1);
        expect(p.nodeId).toBeLessThanOrEqual(map.nodes.length);
      }
    }
    expect(s.turnCount).toBe(200);
  });
});
