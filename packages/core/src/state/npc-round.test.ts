/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 四大惡人每輪走一趟 @source 0x00418f93（下一名行动者依次轮到棋盘上的 4..7）+ 0x0040dd1f（步数）
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { autoAction, pickNextNode, reduce, type MapTopology } from './reduce.ts';
import {
  ACTOR_PLACE,
  DOLL_STEPS,
  NPC_ACTORS,
  SPECIAL_ACTOR_BASE,
  initialConfinement,
  npcTurnSteps,
  releaseNpc,
  tickNpcCounters,
} from '../rules/special-actors.ts';
import { runNpc } from '../rules/npc-walk.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { WatcomRng } from '../rng/watcom.ts';
import type { GameState } from './types.ts';

/** 一条 30 格的环 */
const ring: MapTopology = {
  nodes: Array.from({ length: 30 }, (_, i) => makeNode({ id: i + 1, adjacent: [((i + 1) % 30) + 1] })),
  lands: [],
};

function withThief(over: Partial<GameState> = {}, actor: Partial<ReturnType<typeof releaseNpc>> = {}): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 20 })),
    phase: 'turnEnd',
    currentPlayer: 1,
    ...over,
  });
  const specialActors = [...s.specialActors];
  specialActors[0] = { ...releaseNpc(1, 0, 0), ...actor }; // 小偷（actor 4）站在 1 号格
  return { ...s, specialActors };
}

describe('★ 步数 @source 0x0040de09', () => {
  it('★★ 冬眠（+0x0c）整回合不行动，且**不掷随机数** @source 0x0040cbf6', () => {
    // 通道 2：`rich4-spec/tests/test_turn_start.py` §F —— 回合开始判定 `0x40c912` 的
    // actor 分支在 `[slot+0x0c] != 0` 时直接返回 0（连 `0x40dd1f` 都不进）。
    const rng = new WatcomRng();
    rng.setState(7);
    const before = rng.getState();
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), hibernating: 1 }, rng)).toBe(0);
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), hibernating: 0x80 }, rng)).toBe(0);
    expect(rng.getState(), '冬眠那一支不许动随机流').toBe(before);
    // 夢遊（+0x0d）与龜行（+0x0f）**不**拦 —— 原版的 actor 分支不查它们
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), sleepwalkDays: 5 }, rng)).toBeGreaterThanOrEqual(2);
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), singleStep: 1 }, rng)).toBe(1);
  });

  it('停留 → 0；龜行 → 1；否则 rand()%9+2', () => {
    const rng = new WatcomRng();
    rng.setState(1);
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), halted: 2 }, rng)).toBe(0);
    expect(npcTurnSteps({ ...releaseNpc(1, 0, 0), singleStep: 1 }, rng)).toBe(1);
    const n = npcTurnSteps(releaseNpc(1, 0, 0), rng);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(10);
  });

  it('计数与玩家同一套：递减、到 0 挂 0x80、再来一天清零', () => {
    const a = tickNpcCounters({ ...releaseNpc(1, 0, 0), halted: 1, singleStep: 2 });
    expect(a.halted).toBe(RELEASE_PENDING);
    expect(a.singleStep).toBe(1);
    const b = tickNpcCounters(a);
    expect(b.halted).toBe(0);
    expect(b.singleStep).toBe(RELEASE_PENDING);
  });
});

describe('★ 一輪结束时惡人走一趟', () => {
  it('最后一名玩家收回合 → 棋盘上的惡人动了；不是最后一名 → 不动', () => {
    const s = withThief();
    const after = reduce(s, { type: 'endTurn' }, ring);
    const thief = after.specialActors[0]!;
    expect(thief.place).toBe(ACTOR_PLACE.board);
    expect(thief.nodeId).toBeGreaterThanOrEqual(3);
    expect(thief.nodeId).toBeLessThanOrEqual(11);
    expect(thief.stepsRemaining).toBe(0);
    const mid = reduce({ ...s, currentPlayer: 0 }, { type: 'endTurn' }, ring);
    expect(mid.specialActors[0]!.nodeId).toBe(1);
  });

  it('★ 停留中的惡人这一輪不走，计数走一天', () => {
    const s = withThief({}, { halted: 2 });
    const after = reduce(s, { type: 'endTurn' }, ring);
    expect(after.specialActors[0]).toMatchObject({ nodeId: 1, halted: 1 });
  });

  it('★ 龜行中的惡人只走一步', () => {
    const s = withThief({}, { singleStep: 3 });
    const after = reduce(s, { type: 'endTurn' }, ring);
    expect(after.specialActors[0]).toMatchObject({ nodeId: 2, singleStep: 2 });
  });

  it('不在棋盘上的（蹲監獄/未出场）不轮到', () => {
    const s = withThief({}, { place: ACTOR_PLACE.prison });
    const after = reduce(s, { type: 'endTurn' }, ring);
    expect(after.specialActors[0]!.nodeId).toBe(1);
    expect(NPC_ACTORS).toEqual([4, 5, 6, 7]);
  });

  it('★ 走到有玩家的格子照样结算（小偷偷點券）', () => {
    // 玩家 1 站在 5 号格，小偷从 1 号出发走 4 步会经过它；用固定种子找一个恰好踩上的
    for (let seed = 1; seed < 200; seed++) {
      const s = withThief({ rngState: seed, players: [0, 1].map((i) => makePlayer({ index: i, nodeId: i === 1 ? 5 : 20, points: 100 })) });
      const after = reduce(s, { type: 'endTurn' }, ring);
      if (after.players[1]!.points !== 100) {
        expect(after.players[1]!.points).toBe(50);
        expect(after.players[0]!.points).toBe(150);
        return;
      }
    }
    throw new Error('200 个种子都没踩到 5 号格？');
  });

  it('同一种子重放一致', () => {
    const a = reduce(withThief({ rngState: 77 }), { type: 'endTurn' }, ring);
    const b = reduce(withThief({ rngState: 77 }), { type: 'endTurn' }, ring);
    expect(a.specialActors).toEqual(b.specialActors);
    expect(a.rngState).toBe(b.rngState);
  });
});

describe('★ D-T047-5 串行化：一輪的惡人**逐个**走，不是并排滑', () => {
  /** 四个惡人全在盘上（各站一格），玩家 3 是最后一名 —— endTurn 就该开始惡人段 */
  function fourVillains(over: Partial<GameState> = {}): GameState {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      phase: 'turnEnd',
      currentPlayer: 3,
      ...over,
    });
    const specialActors = [...s.specialActors];
    for (let slot = 0; slot < 4; slot++) {
      // `releaseNpc(gateNodeId, owner, steps)` —— 让每个惡人站在**自己的**格上
      specialActors[slot] = {
        ...releaseNpc(slot + 1, slot + 4, 0),
        stepsRemaining: 0,
      };
    }
    return { ...s, specialActors };
  }

  it('★ `endTurn` 只走**第一个**惡人，并把剩下的记进 `pendingNpcSlots`', () => {
    const s = fourVillains({ rngState: 7 });
    const after = reduce(s, { type: 'endTurn' }, ring);
    // ⚠️ 先前这里是一次把 4 个全走完（`lastNpcWalks` 有 4 条、四个并排滑）
    expect(after.lastNpcWalks).toHaveLength(1);
    expect(after.lastNpcWalks[0]!.slot).toBe(0);
    expect(after.pendingNpcSlots).toEqual([1, 2, 3]);
    // 相位停在 turnEnd —— 还没轮到下一位玩家
    expect(after.phase).toBe('turnEnd');
    // ★ 日期**没**推（原版是游标到 8 才 `call 0x41cf67`）
    expect(after.day).toBe(s.day);
    expect(after.totalDays).toBe(s.totalDays);
    // 还没走的那三个一步没动
    for (let slot = 1; slot < 4; slot++) {
        expect(after.specialActors[slot]!.nodeId).toBe(slot + 1);
    }
  });

  it('★ 每一条 `npcStep` 只走一个，且 `lastNpcWalks` 每次只有**那一条**', () => {
    let s = reduce(fourVillains({ rngState: 7 }), { type: 'endTurn' }, ring);
    const walked: number[] = [s.lastNpcWalks[0]!.slot];
    for (let i = 0; i < 3; i++) {
      s = reduce(s, { type: 'npcStep' }, ring);
      expect(s.lastNpcWalks, `第 ${i + 2} 个`).toHaveLength(1);
      walked.push(s.lastNpcWalks[0]!.slot);
    }
    // 顺序 = 槽位升序（原版游标 4→5→6→7）
    expect(walked).toEqual([0, 1, 2, 3]);
    expect(s.pendingNpcSlots).toEqual([]);
  });

  it('★ 最后一个走完才推日期并轮到下一位玩家', () => {
    const start = fourVillains({ rngState: 7 });
    let s = reduce(start, { type: 'endTurn' }, ring);
    for (let i = 0; i < 2; i++) {
      s = reduce(s, { type: 'npcStep' }, ring);
      expect(s.day, `第 ${i + 2} 步不该推日期`).toBe(start.day);
      expect(s.phase).toBe('turnEnd');
    }
    s = reduce(s, { type: 'npcStep' }, ring); // 第 4 个
    expect(s.day).toBe(start.day + 1); // ★ 现在才推
    expect(s.totalDays).toBe(start.totalDays + 1);
    expect(s.phase).toBe('turnStart');
    expect(s.currentPlayer).toBe(0); // 绕回 0 号玩家
    expect(s.pendingNpcSlots).toEqual([]);
  });

  it('★★ 惡人段走完后，下一位玩家的「一天」照样要走（第 85 条）', () => {
    // ★ 递减（`0x419039 call 0x41c84f`）是给**新**当前玩家走的，而惡人段把
    //   "轮到下一位"这一步交给了 `npcStep` ⇒ 那一条路径也必须补上这一天。
    const s = fourVillains({ rngState: 7 });
    const withSleep: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, sleeping: 5 } } : p,
      ),
    };
    let t = reduce(withSleep, { type: 'endTurn' }, ring);
    while ((t.pendingNpcSlots ?? []).length > 0) t = reduce(t, { type: 'npcStep' }, ring);
    expect(t.currentPlayer).toBe(0);
    expect(t.players[0]!.blocking.sleeping).toBe(4);
  });

  it('★ `autoAction` 在惡人段优先派 `npcStep`（不然下家会插到惡人前面）', () => {
    const s = reduce(fourVillains({ rngState: 7 }), { type: 'endTurn' }, ring);
    expect(autoAction(s)).toEqual({ type: 'npcStep' });
    // 走完最后一个之后才轮到 endTurn
    let t = s;
    for (let i = 0; i < 3; i++) t = reduce(t, { type: 'npcStep' }, ring);
    expect(t.phase).toBe('turnStart');
  });

  it('★ 队列为空时 `npcStep` 是幂等的（重复派不会多走）', () => {
    const s = reduce(fourVillains({ rngState: 7 }), { type: 'endTurn' }, ring);
    expect(reduce(s, { type: 'npcStep' }, ring).pendingNpcSlots).toEqual([2, 3]);
    const atTurnStart = { ...s, phase: 'turnStart' as const, pendingNpcSlots: [] };
    expect(reduce(atTurnStart, { type: 'npcStep' }, ring)).toBe(atTurnStart);
  });

  it('★ 只有**一**个惡人在盘上时，两次 action 就走完并推日期（等价旧行为）', () => {
    const s = withThief({ rngState: 7 });
    // withThief 的 currentPlayer 是 1（两人局里的最后一名）
    const afterFirst = reduce(s, { type: 'endTurn' }, ring);
    expect(afterFirst.pendingNpcSlots).toEqual([]); // 只有一个，endTurn 里就走完
    expect(afterFirst.day).not.toBe(s.day); // 日期已推
    expect(afterFirst.phase).toBe('turnStart');
  });

  it('★ 队列里过期的槽会被跳过（这一轮中间被抓回老家）', () => {
    const s = reduce(fourVillains({ rngState: 7 }), { type: 'endTurn' }, ring);
    // 人为把 1 号槽从盘上撤掉（模拟中途回家）—— 走它时应当跳过、不炸
    const specialActors = [...s.specialActors];
    specialActors[1] = { ...specialActors[1]!, place: ACTOR_PLACE.prison };
    const t = reduce({ ...s, specialActors }, { type: 'npcStep' }, ring);
    // ★ 一条 action 只走**一个**惡人：跳过 1 号（不在盘上），走到 2 号为止
    expect(t.pendingNpcSlots).toEqual([3]);
    expect(t.lastNpcWalks).toHaveLength(1);
    expect(t.lastNpcWalks[0]!.slot).toBe(2); // 跳过了 1
    // 2 号真的动了，3 号一步没动
    expect(t.specialActors[2]!.nodeId).toBeGreaterThan(3);
    expect(t.specialActors[3]!.nodeId).toBe(4);
  });

  it('★ 惡人段没走完时 `endTurn` **不动状态**（否则同一轮惡人会走两遍）', () => {
    const s = reduce(fourVillains({ rngState: 7 }), { type: 'endTurn' }, ring);
    expect(s.pendingNpcSlots).toEqual([1, 2, 3]);
    const again = reduce(s, { type: 'endTurn' }, ring);
    expect(again).toBe(s);
    // 计数也没被 tick 第二次
    expect(again.specialActors.map((a) => a.stepsRemaining)).toEqual(
      s.specialActors.map((a) => a.stepsRemaining),
    );
  });

  it('★ 相位不是 turnEnd 时 `npcStep` 不动状态', () => {
    const s = reduce(fourVillains({ rngState: 7 }), { type: 'endTurn' }, ring);
    const moving = { ...s, phase: 'moving' as const };
    expect(reduce(moving, { type: 'npcStep' }, ring)).toBe(moving);
  });
});

describe('★ 總月數 @source [0x499084]', () => {
  it('跨月 +1，不跨月不动', () => {
    const jan31 = makeGameState({ year: 1998, month: 1, day: 31, phase: 'turnEnd', currentPlayer: 3 });
    const feb1 = reduce(jan31, { type: 'endTurn' }, ring);
    expect(feb1.totalMonths).toBe(1);
    expect(feb1.totalDays).toBe(1);
    const feb2 = reduce({ ...feb1, phase: 'turnEnd', currentPlayer: 3 }, { type: 'endTurn' }, ring);
    expect(feb2.totalMonths).toBe(1);
    expect(feb2.totalDays).toBe(2);
  });
});

describe('★ 涨价/查封状态每日递减（T-084）@source 0x0041d0ff 起', () => {
  // currentPlayer 3（最后一名）endTurn → 跨轮 → advanceGameDay
  const day = (s: GameState): GameState =>
    reduce({ ...s, phase: 'turnEnd', currentPlayer: 3 }, { type: 'endTurn' }, ring);

  it('landPriceStatus / facilityPriceStatus 每天 −0x10', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      landPriceStatus: [0, 0x50, 0x51, 0],
      facilityPriceStatus: [0, 0x51, 0x20],
    });
    const after = day(s);
    expect(after.landPriceStatus).toEqual([0, 0x40, 0x41, 0]);
    expect(after.facilityPriceStatus).toEqual([0, 0x41, 0x10]);
  });

  it('★ 查封 5 天后整字节解封（查封位不残存）', () => {
    let s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      landPriceStatus: [0, 0x51],
    });
    for (let i = 0; i < 4; i++) {
      s = day(s);
      expect(s.landPriceStatus[1]).not.toBe(0); // 前 4 天仍封着
    }
    s = day(s);
    expect(s.landPriceStatus[1]).toBe(0); // 第 5 天解封
  });

  it('★ 漲價 5 天后回落', () => {
    let s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      facilityPriceStatus: [0, 0x50],
    });
    for (let i = 0; i < 5; i++) s = day(s);
    expect(s.facilityPriceStatus[1]).toBe(0);
  });

  it('高 nibble 为 0 的状态不被误伤', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      landPriceStatus: [0, 0, 1],
    });
    expect(day(s).landPriceStatus).toEqual([0, 0, 1]);
  });
});

// ============================================================
//  lastNpcWalks —— 交给表现层的整趟路径（T-047）
// ============================================================

/**
 * 監獄格在**路头**的直路：出獄之后每一步只有一个候选，整趟是确定的。
 *
 * ★★ 1 号同时是**落点特殊格**（`specialKind` 4）与**关押格**（`type` 0x1f42，
 *   = 原版 `[0x48bae0]`）；出獄上路的起点取的是后者 —— 见
 *   `rules/confinement.ts` 的 `CONFINEMENT_GATE_TYPE`。
 */
const away: MapTopology = {
  nodes: [
    makeNode({
      id: 1, adjacent: [2],
      type: 0x1f42, ref: { kind: 'landscape', index: 2 },
      specialKind: SPECIAL_KIND.PRISON,
    }),
    ...Array.from({ length: 19 }, (_, i) =>
      makeNode({ id: i + 2, adjacent: i === 18 ? [i + 1] : [i + 1, i + 3] }),
    ),
  ],
};

describe('★ lastNpcWalks：整趟路径交给表现层（T-047）', () => {
  it('一輪之后：与 runNpc 实走的格一致，含起点', () => {
    // 多个种子都复算一遍 —— 只对一个种子成立说明不了「路径确实是那一趟」
    for (const seed of [42, 7, 123, 999]) {
      const s = withThief({ rngState: seed });
      const after = reduce(s, { type: 'endTurn' }, ring);

      const hint = after.lastNpcWalks;
      expect(hint).toHaveLength(1); // 只有小偷在盘上
      expect(hint[0]!.slot).toBe(0); // actor 4 → slot 0
      const path = hint[0]!.path;

      // ① 独立复算同一趟 —— 同序消耗同一个 PRNG，路径必须逐格相同
      //   （⚠️ 不能顺手比 `after.rngState`：那是**走完之后** advanceGameDay
      //     又抽过签的状态，比它只会证明两件事无关。）
      const rng = new WatcomRng();
      rng.setState(s.rngState);
      const ticked = tickNpcCounters(s.specialActors[0]!);
      const steps = npcTurnSteps(ticked, rng);
      const walk = runNpc(
        SPECIAL_ACTOR_BASE,
        { ...ticked, stepsRemaining: steps },
        s,
        ring,
        (from, prev) => pickNextNode(ring, from, prev, rng) ?? 0,
        rng,
      );
      expect(path).toEqual(walk.path);

      // ② 再从拓扑独立验一遍（这条环线每一步只有一个候选，路径是被逼出来的）：
      //    起点 = 出发格、末格 = state 里的落点、逐格相邻、步数 2..10
      expect(path[0]).toBe(1);
      expect(path[path.length - 1]).toBe(after.specialActors[0]!.nodeId);
      expect(path.length).toBe(steps + 1);
      // ★ E-22：**掷出的步数**原样交出去（走子时那串剩余步数从它往下数）
      expect(hint[0]!.steps).toBe(steps);
      expect(steps).toBeGreaterThanOrEqual(2);
      expect(steps).toBeLessThanOrEqual(10);
      for (let i = 0; i + 1 < path.length; i++) {
        expect(ring.nodes[path[i]! - 1]!.adjacent).toContain(path[i + 1]);
      }
    }
  });

  it('这一輪没人走 → 空数组（覆写掉上一轮的，不累积）', () => {
    const first = reduce(withThief({ rngState: 42 }), { type: 'endTurn' }, ring);
    expect(first.lastNpcWalks.length).toBeGreaterThan(0);
    // 让小偷「停留」：这一趟不走，提示必须被覆写成空
    const halted = withThief({ rngState: first.rngState }, { halted: 2 });
    const after = reduce(halted, { type: 'endTurn' }, ring);
    expect(after.lastNpcWalks).toEqual([]);
  });

  it('★ 保釋那一下**不**走（0x0043d7e0 只摆到门口）⇒ 没有新的走子提示；等轮到他那一趟才从監獄门口起步', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1, points: 900 })),
      prisonOccupancy: initialConfinement('prison', 8),
      phase: 'turnEnd',
      currentPlayer: 3,
      pending: {
        kind: 'bail',
        place: 'prison',
        candidates: [{ slot: 4, player: -1, name: '', cost: 300, affordable: true }],
        points: 900,
      },
    });
    const bailed = reduce(s, { type: 'bail', slot: 4 }, away);
    expect(bailed.lastNpcWalks).toBe(s.lastNpcWalks);
    expect(bailed.specialActors[0]!.nodeId).toBe(1);
    const after = reduce(bailed, { type: 'endTurn' }, away);
    const hint = after.lastNpcWalks;
    expect(hint).toHaveLength(1);
    expect(hint[0]!.slot).toBe(0);
    const path = hint[0]!.path;
    expect(path[0]).toBe(1); // 監獄格
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[path.length - 1]).toBe(after.specialActors[0]!.nodeId);
    for (let i = 0; i + 1 < path.length; i++) {
      expect(away.nodes[path[i]! - 1]!.adjacent).toContain(path[i + 1]);
    }
  });

  it('★ 機器娃娃那九格也记下来（runDoll 的 path 原先同样被丢掉）', () => {
    // 一条 12 格的直路：每一步只有一个候选，九步走出的路径是确定的
    const line: MapTopology = {
      nodes: Array.from({ length: 12 }, (_, i) =>
        makeNode({ id: i + 1, adjacent: i === 0 ? [2] : i === 11 ? [11] : [i, i + 2] }),
      ),
    };
    const tools = new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);
    tools[1] = 1; // 道具 1 = 機器娃娃
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1, lastNodeId: 0 })),
      tools,
    });
    const after = reduce(s, { type: 'useTool', toolId: 1 }, line);
    const hint = after.lastNpcWalks;
    expect(hint).toHaveLength(1);
    expect(hint[0]!.slot).toBe(4); // actor 8 → slot 4
    expect(hint[0]!.path).toEqual(Array.from({ length: DOLL_STEPS + 1 }, (_, i) => i + 1));
    // ★ E-22 @source `0x0040deb9 mov esi,9 / 0x0040debe mov [0x48baf8],esi`
    expect(hint[0]!.steps).toBe(DOLL_STEPS);
  });

  it('★ C-DET：它不进 stateFingerprint（改它不影响校验和）', () => {
    const after = reduce(withThief({ rngState: 42 }), { type: 'endTurn' }, ring);
    expect(after.lastNpcWalks.length).toBeGreaterThan(0);
    const base = stateFingerprint(after);
    // ⚠️ 得过一次变量：`stateFingerprint` 的形参是一张**显式字段表**，
    //   对象字面量直接多写一个字段会被 TS 的 excess property check 挡下 ——
    //   这本身就是「它不参与指纹」最硬的证据。
    const blanked = { ...after, lastNpcWalks: [] };
    const other = { ...after, lastNpcWalks: [{ slot: 3, path: [9, 8, 7] }] };
    expect(stateFingerprint(blanked)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });
});

describe('★★ 第二十六份 panel #1：`lastNpcTurn` —— 行动者游标在惡人身上的那一整条 action（侧栏画他那一版）', () => {
  /** 四个惡人全在盘上（各站一格），玩家 3 是最后一名 */
  function four(over: Partial<GameState> = {}): GameState {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 20 })),
      phase: 'turnEnd',
      currentPlayer: 3,
      ...over,
    });
    const specialActors = [...s.specialActors];
    for (let slot = 0; slot < 4; slot++) specialActors[slot] = { ...releaseNpc(slot + 1, slot + 4, 0), stepsRemaining: 0 };
    return { ...s, specialActors };
  }

  it('@source 0x00418f9c 游标 4→5→6→7：`endTurn` 交出 actor 4，之后每条 `npcStep` 交出下一个（含推日期那一条）', () => {
    let s = reduce(four({ rngState: 7 }), { type: 'endTurn' }, ring);
    const seen = [s.lastNpcTurn?.actor];
    while ((s.pendingNpcSlots ?? []).length > 0) {
      s = reduce(s, { type: 'npcStep' }, ring);
      seen.push(s.lastNpcTurn?.actor);
    }
    expect(seen).toEqual([4, 5, 6, 7]);
    // 最后一个惡人那一条连推日期、换到 0 号 —— 侧栏仍是他，直到下一条 action（原版 0x00418c55 那次重画才换走）
    expect(s.phase).toBe('turnStart');
    expect(s.currentPlayer).toBe(0);
    expect(s.lastNpcTurn).toEqual({ actor: 7 });
    const next = reduce(s, { type: 'startTurn' }, ring);
    expect(next).not.toBe(s);
    expect(next.lastNpcTurn ?? null).toBeNull();
  });

  it('★ 停留（+0x0e）的惡人：不走（`lastNpcWalks` 空）但这一回合照样是他的 @source 0x00418d5f 重画在 0x0040de2b 判停留之前', () => {
    const after = reduce(withThief({ rngState: 3 }, { halted: 2 }), { type: 'endTurn' }, ring);
    expect(after.lastNpcWalks).toEqual([]);
    expect(after.lastNpcTurn).toEqual({ actor: SPECIAL_ACTOR_BASE });
  });

  it('不绕回的 `endTurn`、不在盘上的惡人、機器娃娃 ⇒ 都不写', () => {
    expect(reduce({ ...withThief(), currentPlayer: 0 }, { type: 'endTurn' }, ring).lastNpcTurn ?? null).toBeNull();
    expect(reduce(withThief({}, { place: ACTOR_PLACE.prison }), { type: 'endTurn' }, ring).lastNpcTurn ?? null).toBeNull();
    const tools = new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);
    tools[1] = 1;
    const s = makeGameState({ players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1, lastNodeId: 0 })), tools });
    const doll = reduce(s, { type: 'useTool', toolId: 1 }, ring);
    expect(doll.lastNpcWalks[0]?.slot).toBe(4);
    expect(doll.lastNpcTurn ?? null).toBeNull();
  });

  it('★ 保釋那一下不写（原版保釋 0x0043d7e0 不动 `[0x49910c]`，侧栏仍是保釋的那位玩家）；轮到他那条才写', () => {
    const s = makeGameState({
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 1, points: 900 })),
      prisonOccupancy: initialConfinement('prison', 8),
      phase: 'turnEnd',
      pending: { kind: 'bail', place: 'prison', candidates: [{ slot: 4, player: -1, name: '', cost: 300, affordable: true }], points: 900 },
    });
    const after = reduce(s, { type: 'bail', slot: 4 }, away);
    expect(after.lastNpcWalks).toBe(s.lastNpcWalks);
    expect(after.lastNpcTurn ?? null).toBeNull();
    const round = reduce({ ...after, currentPlayer: 3 }, { type: 'endTurn' }, away);
    expect(round.lastNpcTurn).toEqual({ actor: 4 });
  });

  it('只活一条 action：没生效的 action 原样留着（恒等），生效的清成 null', () => {
    const s = reduce(four({ rngState: 7 }), { type: 'endTurn' }, ring);
    expect(s.lastNpcTurn).toEqual({ actor: 4 });
    // 惡人段里 `endTurn` 不动状态 ⇒ 原样返回（提示也还在）
    expect(reduce(s, { type: 'endTurn' }, ring)).toBe(s);
    // 同一个号再来一条 action 也是**新**对象（按引用判「这一条新写的」）
    const t = reduce(s, { type: 'npcStep' }, ring);
    expect(t.lastNpcTurn).not.toBe(s.lastNpcTurn);
  });

  it('★ C-DET：不进 stateFingerprint；两份独立重放（单机 / 联机旁观端）得到同一份', () => {
    const a = reduce(four({ rngState: 11 }), { type: 'endTurn' }, ring);
    const b = reduce(structuredClone(four({ rngState: 11 })), { type: 'endTurn' }, ring);
    expect(b.lastNpcTurn).toEqual(a.lastNpcTurn);
    const base = stateFingerprint(a);
    const blanked = { ...a, lastNpcTurn: null };
    const other = { ...a, lastNpcTurn: { actor: 6 } };
    expect(stateFingerprint(blanked)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });
});
