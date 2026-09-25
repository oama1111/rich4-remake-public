/*
 * 归约器测试 —— 重点是 C-DET-4 确定性
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { WatcomRng } from '../rng/watcom.ts';
import { readFileSync, existsSync } from 'node:fs';
import { toolCount } from '../rules/tools.ts';
import { reduce, reduceAll, nextCandidates, nextAlivePlayer, applyMagicRequest, pickNextNode } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { Action } from './actions.ts';
import { WHO_PLAYS_RETURN_TO_BOARD, type GameState, type Player } from './types.ts';
import { makePlayer as basePlayer } from '../testing/factories.ts';
import { makeGameState, makeNode, makeLand, makeFacility, makePlayer as factoryPlayer } from '../testing/factories.ts';
import { emptyOwnership } from '../places/commercial.ts';
import { INDUSTRY } from '../places/company.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { takeSnapshot } from '../rules/time-machine.ts';

/** 本文件的简写：第一参为下标 */
const makePlayer = (index: number, over: Partial<Player> = {}): Player =>
  basePlayer({ index, character: index, cash: 500_000, moneyInBank: 0, ...over });
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_DEAD } from './types.ts';
import { parseMap } from '../loaders/map.ts';

const ROOT = (process.env.RICH4_WORKSPACE ?? '');
const MAP0 = `${ROOT}/extracted/map/0001.bin`;


/** 委托共享工厂——新增 GameState 字段时不必逐个测试文件补 */
function makeState(over: Partial<GameState> = {}): GameState {
  return makeGameState({
    players: [makePlayer(0), makePlayer(1), makePlayer(2), makePlayer(3)],
    landOwner: [],
    landLevel: [],
    ...over,
  });
}

/** 一张环形小地图，便于精确推演：1→2→3→4→1 */
const ring: MapTopology = {
  nodes: [1, 2, 3, 4].map((id) => ({
    id,
    x: 0,
    y: 0,
    name: `节点${id}`,
    adjacent: [id === 1 ? 4 : id - 1, id === 4 ? 1 : id + 1],
    adjacentSlots: [id === 1 ? 4 : id - 1, id === 4 ? 1 : id + 1, 0, 0] as [number, number, number, number],
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

  it('★ 死路时候选为空 —— 折返由 pickNextNode 处理，不混进候选里', () => {
    const dead: MapTopology = {
      nodes: [
        { ...ring.nodes[0]!, id: 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0] },
        { ...ring.nodes[1]!, id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0] },
      ],
    };
    // @source 0x0040c17c：原版是先筛出候选，**空了才**回到 last_node_id
    expect(nextCandidates(dead, 2, 1)).toEqual([]);
  });

  it('★ 封路位按**槽号**生效，不是按剔零后的下标', () => {
    // 槽 0 通往 4、槽 1 通往 2；封掉槽 0
    const blocked: MapTopology = {
      nodes: ring.nodes.map((n) =>
        n.id === 1 ? { ...n, flags: n.flags | 0x40000000 } : n,
      ),
    };
    expect(nextCandidates(blocked, 1, 0)).toEqual([2]);
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
    // ★ 起点 lastNodeId=0，两条路都通 —— 原版**不问玩家**，直接 rand() 挑一条
    //   （@source VA 0x0040c196）。所以这里必定已经走掉一步。
    expect(s.phase).toBe('moving');
    expect([2, 4]).toContain(s.players[0]!.nodeId);
    expect(s.stepsRemaining).toBe(1);
  });

  it('★ 岔路的随机选路会推进 PRNG —— 否则回放对不上', () => {
    const st = makeState({ phase: 'moving', stepsRemaining: 2, stepsTotal: 2 });
    const s = reduce(st, { type: 'step' }, ring);
    expect(s.rngState).not.toBe(st.rngState);
  });

  // ★ 簇 C 修复（2026-09-17）：**只有一条路时照样消耗一次随机数**。
  //   原版 `0x0040c17c test esi,esi / jne 0x40c196` 只判「有没有候选」，
  //   **不判「有几个」**；只要候选 ≥1 就 `call 0x456f2d`（rand）。
  //   先前这条测试写的是「不消耗随机数」，把错行为当成了期望值。
  it('★ 只有一条路时**仍然**消耗一次随机数（原版 0x0040c17e）', () => {
    const st = makeState({ phase: 'moving', stepsRemaining: 2, stepsTotal: 2 });
    st.players[0]!.lastNodeId = 4; // 从 4 来，只能往 2 去
    const s = reduce(st, { type: 'step' }, ring);
    expect(s.players[0]!.nodeId).toBe(2); // 单候选 ⇒ rand()%1 === 0，仍走那一条
    expect(s.rngState).not.toBe(st.rngState); // ★ 但随机状态必须前进一步
  });

  it('★ 随机状态恰好前进一次（不是两次、也不是零次）', () => {
    const st = makeState({ phase: 'moving', stepsRemaining: 2, stepsTotal: 2 });
    st.players[0]!.lastNodeId = 4;
    const s = reduce(st, { type: 'step' }, ring);
    // 用同一颗种子手工推进一步，比对状态是否**正好**等于那一步之后的值
    const probe = new WatcomRng();
    probe.setState(st.rngState);
    probe.next();
    expect(s.rngState).toBe(probe.getState());
  });

  it('★ 死路原路返回，而不是卡住', () => {
    // 1 只连 2，从 2 走到 1 之后无路可走
    const deadEnd: MapTopology = {
      nodes: [
        { ...ring.nodes[0]!, adjacent: [2], adjacentSlots: [2, 0, 0, 0] },
        { ...ring.nodes[1]!, adjacent: [1], adjacentSlots: [1, 0, 0, 0] },
      ],
    };
    const st = makeState({ phase: 'moving', stepsRemaining: 2, stepsTotal: 2 });
    st.players[0]!.nodeId = 1;
    st.players[0]!.lastNodeId = 2;
    const s = reduce(st, { type: 'step' }, deadEnd);
    expect(s.players[0]!.nodeId).toBe(2); // @source 0x0040c180
  });

  it('★ 封路位把那条支线关掉 —— 岔路就退化成单行道', () => {
    // 节点 1 的槽 1（通往 2）被封 → 从起点只能走 4
    const blocked: MapTopology = {
      nodes: ring.nodes.map((n) =>
        n.id === 1 ? { ...n, flags: n.flags | (0x40000000 >>> 1) } : n,
      ),
    };
    const st = makeState({ phase: 'moving', stepsRemaining: 2, stepsTotal: 2 });
    const s = reduce(st, { type: 'step' }, blocked);
    expect(s.players[0]!.nodeId).toBe(4);
    // ★ 只剩一条**也**要掷一次（原版只看「有没有候选」，见 pickNextNode 的注释）
    expect(s.rngState).not.toBe(st.rngState);
  });

  it('endTurn 轮转到下一位在场玩家并给他递减天数', () => {
    // ★★ 第 84 条订正：递减的是**新**当前玩家，不是刚走完的这位 ——
    //   原版 `0x418f95 inc esi` 先把游标 ++，`0x419039 call 0x41c84f` 才用它。
    const st = makeState({ phase: 'turnEnd' });
    st.players[1]!.blocking.inPrison = 3;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.currentPlayer).toBe(1);
    expect(s.players[1]!.blocking.inPrison).toBe(2);
    expect(s.turnCount).toBe(1);
    expect(s.phase).toBe('turnStart');
  });

  it('★ 天数正常递减', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[1]!.blocking.inHospital = 5;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.players[1]!.blocking.inHospital).toBe(4);
  });

  it('★ 减到 0 时挂 0x80 待释放，而不是清零', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[1]!.blocking.inPrison = 1;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.players[1]!.blocking.inPrison).toBe(0x80);
  });

  it('★ 释放（0x80 那次推进）要清占用表 + 置「走回棋盘」标记', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[1]!.blocking.inPrison = 0x80;
    st.prisonOccupancy[1] = 1;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.players[1]!.blocking.inPrison).toBe(0);
    expect(s.prisonOccupancy[1]).toBe(0);
    expect(s.players[1]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(
      WHO_PLAYS_RETURN_TO_BOARD,
    );
  });

  it('★ 冬眠/停留也走同一次「新玩家的一天」', () => {
    const st = makeState({ phase: 'turnEnd' });
    st.players[1]!.blocking.sleeping = 5;
    st.players[1]!.blocking.stopping = 3;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.players[1]!.blocking.sleeping).toBe(4);
    expect(s.players[1]!.blocking.stopping).toBe(2);
  });

  it('★ 只递减**新**当前玩家（原版 `0x419033` 时下标已经 ++ 过）', () => {
    const st = makeState({ phase: 'turnEnd', currentPlayer: 0 });
    st.players[0]!.blocking.inHospital = 5;
    st.players[1]!.blocking.inHospital = 5;
    const s = reduce(st, { type: 'endTurn' }, ring);
    expect(s.players[0]!.blocking.inHospital).toBe(5); // 刚走完的这位不动
    expect(s.players[1]!.blocking.inHospital).toBe(4); // 即将行动的这位走一天
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
      while (s.phase === 'moving') {
        // 路过銀行给真人开的 ATM 窗：关掉接着走（见 bank-passby.test.ts）
        s = reduce(s, { type: s.pending?.kind === 'atm' ? 'declineDecision' : 'step' }, topo);
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

/**
 * ★★ 第十三份試玩回報 `20260923-150207228`（地图 7，第 38 回合）：「为什么这个回合沙隆巴斯走了个回环」。
 *
 * 沙隆巴斯（P2，电脑，三颗骰 6+4+6 = 16 步）从 87（来自 88）出发：
 * `87 → 21 → 22 → 23 → 24 → 25 → 26 → 81 → 82 → 83 → 84 → 85 → 86 → 21 → 87 → 88 → 89`
 * （第 16 步踩到自己上回合反瞻放下的地雷 ⇒ 醫院）。绕 21–26–86 那一圈又从 21 拐回 87，
 * 看起来像「掉头」，其实是**三次岔路各掷一次 `rand() % 候选数`**：
 *
 * | 岔路 | 来路 | 候选（去掉来路 / 空槽 / 封路位）| 掷到 |
 * |---|---|---|---|
 * | 21 | 87 | [22, 20, 86] | 22 |
 * | 26 | 25 | [80, 81, 27] | 81 |
 * | 21 | 86 | [22, 20, **87**] | 87 |
 *
 * 规则 @source 走路例程 `0x0040c12c..0x0040c1a5`（spec `game-loop.md`「走路例程 0x40c05c 已整段差分」）：
 * 只排除 `player.last_node`（+0x0e）、空槽、`node.flags & (0x40000000 >> slot)` 的封路槽；
 * **没有**「方向 / 顺逆时针 / 单行道」的概念 —— 地图文件的邻接是无向的（地图 7 逐条互指），
 * 唯一的「单行」手段是封路位（地图 7 只有 51 号的槽 2 → 95 那条支线被封）。
 * 下面三个 rng 值就是回报轨迹里那三步 `step` 之前的 `rngState`（重放指纹一致 579fc9d1）。
 */
describe('★★ 地图 7 的岔路（第十三份試玩回報 150207「沙隆巴斯走了个回环」）', () => {
  const MAP7 = `${ROOT}/extracted/map/0015.bin`;
  const has7 = existsSync(MAP7);

  it.skipIf(!has7)('地图 7：邻接逐条互指（无单行道），四个岔路口 21/26/51/62，封路位只在 51 号槽 2', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP7)));
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const n of map.nodes) {
      for (const a of n.adjacentSlots) {
        if (a === 0) continue;
        expect(byId.get(a)!.adjacentSlots).toContain(n.id);
      }
    }
    const forks = map.nodes.filter((n) => n.adjacentSlots.filter((a) => a !== 0).length > 2).map((n) => n.id);
    expect(forks).toEqual([21, 26, 51, 62]);
    expect(byId.get(21)!.adjacentSlots).toEqual([22, 20, 87, 86]);
    expect(byId.get(26)!.adjacentSlots).toEqual([80, 25, 81, 27]);
    const blocked = map.nodes.filter((n) => (n.flags & 0x78000000) !== 0).map((n) => [n.id, n.flags & 0x78000000]);
    expect(blocked).toEqual([[51, 0x10000000]]); // 0x40000000 >> 2 ⇒ 槽 2（= 95）
  });

  it.skipIf(!has7)('★ 回报那一趟的三次岔路：21←87 掷到 22、26←25 掷到 81、21←86 掷到 87（原版 rand()%n）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP7)));
    const topo: MapTopology = { nodes: map.nodes };
    const pick = (from: number, prev: number, state: number): number | null => {
      const rng = new WatcomRng();
      rng.setState(state);
      return pickNextNode(topo, from, prev, rng);
    };
    expect(nextCandidates(topo, 21, 87)).toEqual([22, 20, 86]);
    expect(pick(21, 87, 2415734341)).toBe(22);
    expect(nextCandidates(topo, 26, 25)).toEqual([80, 81, 27]);
    expect(pick(26, 25, 40306022)).toBe(81);
    // ★ 绕完一圈回到 21：来路是 86，87 **重新成了候选** —— 原版只禁「上一格」，不记更早走过哪
    expect(nextCandidates(topo, 21, 86)).toEqual([22, 20, 87]);
    expect(pick(21, 86, 2442039289)).toBe(87);
  });
});

// ============================================================================
//  ★★ README §7.142(5) E6 —— `0x40b110` 返回值的 bit7（剛好升到 5 級）
// ============================================================================

/**
 * 一张最小的两格地图：1 号是**住宅**（`0x7d0 + 1`）、2 号是**設施**（`0xfa0 + 1`）。
 *
 * @source 区间判据 `0x40b117 cmp edx, 0x7d0` / `0x40b11f cmp edx, 0xfa0`
 *   （住宅 2000..4000）、`0x40b170 cmp edx, 0xfa0` / `0x40b17c cmp edx, 0x1770`
 *   （設施 4000..6000）—— 都是**开区间**。
 */
function twoEntityMap(): MapTopology {
  return {
    nodes: [
      makeNode({ id: 1, type: 0x7d0 + 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
      makeNode({ id: 2, type: 0xfa0 + 1, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
    ],
    lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 0, level: 0 })],
    // type 1 = 旅館，`0x474940[1] = 5` ⇒ 能升到 5 级
    facilities: [makeFacility({ id: 1, name: '測試旅館', type: 1, owner: 0, level: 0 })],
  };
}

describe('★★ E6：加蓋返回值 bit7（剛好升到 5 級）的 core 契约', () => {
  /** 玩家 0 手里一件機器工人（9）@source 全局道具表 60 项，下标 = 玩家*15 + 道具号 */
  const withTool = (s: GameState): GameState => {
    const tools = [...s.tools];
    tools[9] = 1;
    return { ...s, tools };
  };

  it('★★ 住宅 4→5 ⇒ hint.reachedMaxLevel = true（bit7 置位）', () => {
    const topo = twoEntityMap();
    const s = withTool(makeState({ landLevel: [0, 4], landType: [0, 0] }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 1 }, topo);
    expect(after.landLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: true, source: 'robotWorker' },
    ]);
  });

  it('★★ 設施（旅館）4→5 ⇒ **也**置 bit7（0x0040b21a mov eax, 0x81）', () => {
    // 先前 `client/build-fx.ts` 的注释写着「設施那一支不置位」——**读反了**：
    //   只有「等級 0 → 定种类首建」那一条（0x0040b1f4）没有 bit7。
    const topo = twoEntityMap();
    const s = withTool(makeState({ facilityLevel: [0, 4], facilityType: [0, 1] }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 2 }, topo);
    expect(after.facilityLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0xfa0 + 1, reachedMaxLevel: true, source: 'robotWorker' },
    ]);
  });

  it('★ 設施 3→4 ⇒ 不置 bit7（新等级不是 5）', () => {
    const topo = twoEntityMap();
    const s = withTool(makeState({ facilityLevel: [0, 3], facilityType: [0, 1] }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 2 }, topo);
    expect(after.facilityLevel[1]).toBe(4);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0xfa0 + 1, reachedMaxLevel: false, source: 'robotWorker' },
    ]);
  });

  it('★ 設施等級 0 → 首建 ⇒ **不**置 bit7（0x0040b1f4 mov eax, 1 / inc / ret）', () => {
    const topo = twoEntityMap();
    // 电脑玩家：等级 0 的設施走「自己的 → rand()%4+1」那条，不需要 UI 选种类
    const s = withTool(makeState({
      facilityLevel: [0, 0],
      facilityType: [0, 0],
      players: [makePlayer(0, { whoPlays: WHO_PLAYS_COMPUTER }), makePlayer(1), makePlayer(2), makePlayer(3)],
    }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 2 }, topo);
    expect(after.facilityLevel[1]).toBe(1);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0xfa0 + 1, reachedMaxLevel: false, source: 'robotWorker' },
    ]);
  });

  it('★ 住宅 3→4 ⇒ 不置 bit7', () => {
    const topo = twoEntityMap();
    const s = withTool(makeState({ landLevel: [0, 3], landType: [0, 0] }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 1 }, topo);
    expect(after.landLevel[1]).toBe(4);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'robotWorker' },
    ]);
  });

  // ★ 2026-09-24 审计订正：take_tool（`0x004472fb`）在 `0x40b110`（`0x00447345`）之前 ⇒ 蓋不成**照样扣道具**
  it('★ 蓋不成（住宅已满 5）⇒ 等级不动、没有加蓋事件，但道具照扣', () => {
    const topo = twoEntityMap();
    const s = withTool(makeState({ landLevel: [0, 5], landType: [0, 0] }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 1 }, topo);
    expect(after.landLevel).toEqual([0, 5]);
    expect(after.lastBuildUpgrades ?? []).toEqual([]);
    expect(toolCount(after.tools, 0, 9)).toBe(toolCount(s.tools, 0, 9) - 1);
  });

  it('★ 魔法屋「就地加蓋房屋」也记 bit7（@source 0x00432085）', () => {
    const topo = twoEntityMap();
    const s = makeState({ landLevel: [0, 4], landType: [0, 0] });
    const after = applyMagicRequest(s, topo, { player: 0, kind: 'build', amount: 1 });
    expect(after.landLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: true, source: 'magicHouse' },
    ]);
  });

  it('★ 魔法屋的多次加蓋是 **append**（一条 action 里多位中签者各盖一级）', () => {
    const topo = twoEntityMap();
    const s = makeState({ landLevel: [0, 4], landType: [0, 0] });
    const once = applyMagicRequest(s, topo, { player: 0, kind: 'build', amount: 1 });
    const twice = applyMagicRequest(once, topo, { player: 0, kind: 'build', amount: 1 });
    // 第一次 4→5 置位；第二次已满级 ⇒ 状态原样返回、提示不再追加
    expect(twice).toBe(once);
    expect(twice.lastBuildUpgrades).toHaveLength(1);
  });

  it('★★ 天使卡（9）地块支也记 bit7（@source 0x004435d4 / 0x004436b5）', () => {
    // 天使卡的地块支在原版里是**内联**的（不走 0x40b110）：
    //   `0x004435cb inc byte [ebx+0x1a]` → `0x004435d4 cmp byte [ebx+0x1a], 5`
    //   → `0x004435da mov dword [esp], 1`，最后 `0x004436d4 call 0x40b0cd`。
    //   `cards/land-cards.ts` 的 `applyAngelCard` 只回 level，bit7 得由 core 补齐。
    const topo = twoEntityMap();
    const base = makeState({ landLevel: [0, 4], landType: [0, 0] });
    const s: GameState = { ...base, players: [{ ...base.players[0]!, cards: [9] }, ...base.players.slice(1)] };
    const after = reduce(s, { type: 'useCard', cardId: 9, target: { kind: 'entity', entityId: 1 } }, topo);
    expect(after.landLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: true, source: 'angelCard' },
    ]);
  });

  it('★★ 天使卡（9）設施支也记 bit7（旅館 4→5 ⇒ 0x81）', () => {
    // @source `0x004436ad call 0x40b110` → `0x004436b5 test al, 0x80`
    //   → `0x004436d4 call 0x40b0cd`（天使卡**不播大锤**，见 BuildUpgradeSource）
    const topo = twoEntityMap();
    const base = makeState({ facilityLevel: [0, 4], facilityType: [0, 1] });
    const s: GameState = { ...base, players: [{ ...base.players[0]!, cards: [9] }, ...base.players.slice(1)] };
    const after = reduce(
      s,
      { type: 'useCard', cardId: 9, target: { kind: 'facility', facilityId: 1 } },
      topo,
    );
    expect(after.facilityLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0xfa0 + 1, reachedMaxLevel: true, source: 'angelCard' },
    ]);
  });

  it('★ 天使卡没升到 5 级 ⇒ 记事件但 bit7 = false', () => {
    const topo = twoEntityMap();
    const base = makeState({ landLevel: [0, 3], landType: [0, 0] });
    const s: GameState = { ...base, players: [{ ...base.players[0]!, cards: [9] }, ...base.players.slice(1)] };
    const after = reduce(s, { type: 'useCard', cardId: 9, target: { kind: 'entity', entityId: 1 } }, topo);
    expect(after.landLevel[1]).toBe(4);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'angelCard' },
    ]);
  });

  it('★★ 上一条 action 的 bit7 **不能**污染本条（幽灵 0x20b）', () => {
    // 提示表是「本 action」的：core 每次加蓋都整份覆写（单次加蓋用
    // `withSingleBuildUpgrade` = 先清空再记）。若写成往旧表上 append，
    // 就会出现「上一次 4→5 置了 bit7、这一次 3→4 没置 ⇒ `some(bit7)` 仍为真
    // ⇒ 多播一段 0x20b」。
    const topo = twoEntityMap();
    const base = makeState({
      landLevel: [0, 3],
      landType: [0, 0],
      facilityLevel: [0, 4],
      facilityType: [0, 1],
    });
    const tools = [...base.tools];
    tools[9] = 2; // 两件機器工人，够跑两条 action
    // 第一条：設施 4→5 ⇒ bit7 置位
    const s1 = reduce({ ...base, tools }, { type: 'useTool', toolId: 9, nodeId: 2 }, topo);
    expect(s1.lastBuildUpgrades).toEqual([
      { entity: 0xfa0 + 1, reachedMaxLevel: true, source: 'robotWorker' },
    ]);
    // 第二条：住宅 3→4 ⇒ **不**置位，表里只该有这一条
    const s2 = reduce(s1, { type: 'useTool', toolId: 9, nodeId: 1 }, topo);
    expect(s2.landLevel[1]).toBe(4);
    expect(s2.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'robotWorker' },
    ]);
  });

  it('★★ 瞬态提示**不进指纹**（C-DET-4）—— 与 `lastNpcWalks` 同一条约定', () => {
    const topo = twoEntityMap();
    const s = withTool(makeState({ landLevel: [0, 4], landType: [0, 0] }));
    const after = reduce(s, { type: 'useTool', toolId: 9, nodeId: 1 }, topo);
    expect(after.lastBuildUpgrades).toHaveLength(1);
    const base = stateFingerprint(after);
    // ⚠️ 得过一次变量：`stateFingerprint` 的形参是一张**显式字段表**，
    //   对象字面量直接多写一个字段会被 excess property check 挡下 ——
    //   这本身就是「它不参与指纹」最硬的证据。
    const blanked = { ...after, lastBuildUpgrades: [] };
    const other = { ...after, lastBuildUpgrades: [{ entity: 9999, reachedMaxLevel: false, source: 'angelCard' as const }] };
    expect(stateFingerprint(blanked)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });

  it('★★ 時光機（10）倒带后**不带**加蓋提示（快照是 JSON，回来的是新数组）', () => {
    // `takeSnapshot` 是 `JSON.stringify(state)` ⇒ 快照里带着当时那份
    // `lastBuildUpgrades`，`JSON.parse` 回来是**新数组** —— 若不显式清掉，
    // 客户端的「引用变了 = 本 action 有加蓋」就会在倒退时凭空播一段动效。
    const topo = twoEntityMap();
    const base = withTool(makeState({ landLevel: [0, 4], landType: [0, 0] }));
    const tools = [...base.tools];
    tools[9] = 1;
    tools[10] = 1; // 再给一件時光機
    const built = reduce({ ...base, tools }, { type: 'useTool', toolId: 9, nodeId: 1 }, topo);
    expect(built.lastBuildUpgrades).toHaveLength(1);
    // 拍一张快照（真人回合开局那一张的等价物），再动一次状态，然后倒带
    const snapped = { ...built, snapshots: [takeSnapshot(built), null, null, null] as (string | null)[] };
    const back = reduce(snapped, { type: 'useTool', toolId: 10, nodeId: 0 }, topo);
    expect(back).not.toBe(snapped);
    expect(back.lastBuildUpgrades ?? []).toEqual([]);
  });

  // ── 建設公司那一族（原版 `0x0041ad7e` / `0x0041aae8`，同样是「大锤 + 0x20b」）──

  /** 一个上市企業格（行業別可換）+ 一块自己的住宅地，@source 与 company.test.ts 同构 */
  const CID = 1;
  const companyTopo = (industry: number): MapTopology => ({
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3], type: 6001, ref: { kind: 'commercial', index: CID } }),
      makeNode({ id: 3, adjacent: [2] }),
    ],
    lands: [makeLand({ id: 1, type: 0, landPrice: 1000, rentByLevel: [50, 100, 200, 300, 400, 500] })],
    commercials: [{
      id: CID, x: 0, y: 0, name: '測試公司', stockIndex: 0, landPrice: 500, type: industry,
      spriteIndex: 0, assetValue: 1_000_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 1000,
    }],
  });

  /** 站在企業格上的玩家 0（电脑），企業老闆 = chairman（null = 无主）*/
  const landingOnCompany = (chairman: number | null, level: number): GameState => {
    const base = makeState({
      players: [0, 1].map((i) => makePlayer(i, { nodeId: i === 0 ? 2 : 1, whoPlays: WHO_PLAYS_COMPUTER })),
      phase: 'settling',
      priceIndex: 1,
      totalDays: 40,
      stepsTotal: 6,
      landLevel: [0, level],
      landType: [0, 0],
      landOwner: [0, 1],
      commercialShares: [0, 1000],
    });
    const commercialOwners = [...base.commercialOwners];
    while (commercialOwners.length <= CID) commercialOwners.push(emptyOwnership());
    commercialOwners[CID] = { ...emptyOwnership(), owner: chairman === null ? 0 : chairman + 1 };
    return { ...base, commercialOwners };
  };

  it('★★ 建設公司（自家、电脑）4→5 ⇒ source = companyBuild 且 bit7 置位', () => {
    // @source 0x0041abde / 0x0041ad7e：`call 0x40b110` → `0x0041ad99 call 0x45144f`
    //   （大锤）→ `0x0041adaa test byte [esp+0xbc], 0x80` → `0x0041adb4 call 0x40b0cd`
    const topo = companyTopo(INDUSTRY.construction);
    const after = reduce(landingOnCompany(0, 4), { type: 'settle' }, topo);
    expect(after.landLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: true, source: 'companyBuild' },
    ]);
  });

  it('★ 建設公司（自家、电脑）0→2（蓋两次，`0x0041aae8` / `0x0041aafb`）⇒ 记一条 companyBuild、bit7 = false', () => {
    const topo = companyTopo(INDUSTRY.construction);
    const after = reduce(landingOnCompany(0, 0), { type: 'settle' }, topo);
    expect(after.landLevel[1]).toBe(2);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'companyBuild' },
    ]);
  });

  it('★★ 建設公司（自家）3→5：第二次才到 5 级 ⇒ 提示里的 bit7 取**第一次**的（false）—— 原版只看 `[esp+0xbc]`（`0x0041ab21`），不说也不放烟花', () => {
    const topo = companyTopo(INDUSTRY.construction);
    const after = reduce(landingOnCompany(0, 3), { type: 'settle' }, topo);
    expect(after.landLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'companyBuild' },
    ]);
  });

  it('★ 建設公司（自家、真人选目标，`charge: false`）也蓋两次；别人的（`charge: true`）只蓋一次', () => {
    const topo = companyTopo(INDUSTRY.construction);
    const own = landingOnCompany(0, 1);
    const s: GameState = {
      ...own,
      players: own.players.map((p, i) => (i === 0 ? factoryPlayer({ index: 0, nodeId: 2 }) : p)),
      landOwner: [0, 1],
    };
    const asked = reduce(s, { type: 'settle' }, topo);
    expect(asked.pending).toMatchObject({ kind: 'chooseBuildTarget', charge: false });
    const done = reduce(asked, { type: 'buildTarget', entityId: 0x7d0 + 1 }, topo);
    expect(done.landLevel[1]).toBe(3);
    expect(done.lastBuildUpgrades).toEqual([{ entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'companyBuild' }]);
  });

  it('★ 建設公司（真人选目标那一支，`buildTarget`）也记 companyBuild', () => {
    const topo = companyTopo(INDUSTRY.construction);
    const human = landingOnCompany(1, 4);
    const s: GameState = {
      ...human,
      players: human.players.map((p, i) => (i === 0 ? factoryPlayer({ index: 0, nodeId: 2 }) : p)),
      landOwner: [0, 1],
    };
    const asked = reduce(s, { type: 'settle' }, topo);
    expect(asked.pending).toMatchObject({ kind: 'chooseBuildTarget', charge: true });
    // ★ 2026-09-23：真人选地之前先弹「%s\n\n請選擇欲加蓋地點」（`0x0041acf7`，`%s` = 企業名）
    expect(asked.notices).toEqual([{ key: 'company.pickBuildSite', args: ['測試公司'] }]);
    const done = reduce(asked, { type: 'buildTarget', entityId: 0x7d0 + 1 }, topo);
    expect(done.landLevel[1]).toBe(5);
    expect(done.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: true, source: 'companyBuild' },
    ]);
  });
});

// ============================================================================
//  ★★ 試玩回报第 4 份 #3 —— 落点「升級房子」那一支（`0x004198b9` 自有地分支）
// ============================================================================

/**
 * 玩家 0 走到**自己的**地块上、落点已经问出「升級房子」那一步。
 *
 * @source 自有地分支 `0x00419911..0x00419a26`：
 *   `0x004199d1 inc byte [esi + 0x1a]`（**不走 `0x40b110`**）→
 *   `0x004199eb cmp byte [esi + 0x1a], 5` → `0x00419a21 call 0x40b0cd`（只播 0x20b）。
 *   整段里没有 `push 0x229`（大锤全 exe 只有 4 处：`0x0041aab8` / `0x0041ad4d`
 *   / `0x00432028` / `0x0044731a`）。
 */
describe('★★ 自己的地落点問「升級房子」⇒ source = ownUpgrade（客户端据此不播大锤）', () => {
  /** 一格是自己的住宅（`0x7d0 + 1`）的小地图 */
  const ownLandTopo: MapTopology = {
    nodes: [
      makeNode({ id: 1, type: 0x7d0 + 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
      makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
    ],
    lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 1, level: 0, landPrice: 1000 })],
  };

  /** 站在自己的地上、pending = 那一步的 `upgradeLand` */
  const asked = (level: number): GameState =>
    makeState({
      players: [makePlayer(0, { nodeId: 1, cash: 500_000 }), makePlayer(1), makePlayer(2), makePlayer(3)],
      phase: 'awaitingDecision',
      pending: { kind: 'upgradeLand', landId: 1, name: '測試路', cost: 200 },
      landOwner: [0, 1],
      landLevel: [0, level],
      landType: [0, 0],
    });

  it('★★★ 4 → 5 ⇒ 记一条 ownUpgrade 且 bit7 置位', () => {
    const after = reduce(asked(4), { type: 'upgradeLand' }, ownLandTopo);
    expect(after.landLevel[1]).toBe(5);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: true, source: 'ownUpgrade' },
    ]);
  });

  it('★ 2 → 3 ⇒ 记 ownUpgrade 但 bit7 = false（原版 `jne 0x419a2b` 跳过 0x20b）', () => {
    const after = reduce(asked(2), { type: 'upgradeLand' }, ownLandTopo);
    expect(after.landLevel[1]).toBe(3);
    expect(after.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'ownUpgrade' },
    ]);
  });

  it('★ 可证伪：source **必须**是 ownUpgrade —— 写成 robotWorker 会让客户端播大锤', () => {
    const after = reduce(asked(4), { type: 'upgradeLand' }, ownLandTopo);
    expect(after.lastBuildUpgrades?.[0]?.source).toBe('ownUpgrade');
    expect(after.lastBuildUpgrades?.[0]?.source).not.toBe('robotWorker');
  });

  it('★ 不是那一个交互就什么都不记（phase/pending 不对 ⇒ 状态原样返回）', () => {
    const s: GameState = { ...asked(4), phase: 'turnEnd' };
    expect(reduce(s, { type: 'upgradeLand' }, ownLandTopo)).toBe(s);
  });
});
