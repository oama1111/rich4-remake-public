/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 飞行记录仪：记下来的东西**必须真的能重放回现场** —— 这是它存在的全部理由。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive } from '@rich4/assets-pipeline';
import {
  decideAction,
  deserializeGame,
  newGame,
  parseMap,
  replayTrail,
  serializeGame,
  stateFingerprint,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { FlightRecorder, KEEP_ERRORS, KEEP_TURNS, REPORT_VERSION, reportFileName } from './flight-recorder.ts';
import { reduceWithHostRng } from './rng-host.ts';

// ★ 地图读仓库里随包的那份（不依赖仓库外目录）；CI 上没拉 LFS 时它是指针文件 ⇒ 不登记
const MAP_MKF = new URL('../../../assets/game/map.mkf', import.meta.url);
const haveMap = existsSync(MAP_MKF) && readFileSync(MAP_MKF).length > 1_000_000;

const entry = (n: number) => ({ t: n, action: { type: 'step' } as const, seed: n });
const reportOf = (r: FlightRecorder, finalState = 'NOW') =>
  r.report({
    reason: 'manual', note: '', env: {}, finalState, finalFingerprint: 'fp', finalTurn: 99,
    screenshot: null, now: new Date(2026, 8, 19, 15, 30, 12),
  });

describe('FlightRecorder：分段与容量', () => {
  it('还没记过 action 就出报告 ⇒ 起点 = 此刻、轨迹为空', () => {
    const rep = reportOf(new FlightRecorder());
    expect(rep.version).toBe(REPORT_VERSION);
    expect(rep.base).toBe('NOW');
    expect(rep.baseTurn).toBe(99);
    expect(rep.trail).toEqual([]);
  });

  it('同一回合只在第一条 action 时取一次快照（惰性，不是每步序列化）', () => {
    const r = new FlightRecorder();
    let calls = 0;
    const snap = () => `S${++calls}`;
    r.record(entry(1), 5, snap);
    r.record(entry(2), 5, snap);
    r.record(entry(3), 5, snap);
    r.record(entry(4), 6, snap);
    expect(calls).toBe(2);
    const rep = reportOf(r);
    expect(rep.base).toBe('S1');
    expect(rep.baseTurn).toBe(5);
    expect(rep.trail.map((e) => e.seed)).toEqual([1, 2, 3, 4]);
  });

  it(`只留最近 ${KEEP_TURNS} 个回合：更早的快照连同它名下的 action 一起丢，起点随之后移`, () => {
    const r = new FlightRecorder();
    for (let turn = 0; turn < KEEP_TURNS + 5; turn++) {
      r.record(entry(turn * 10), turn, () => `T${turn}`);
      r.record(entry(turn * 10 + 1), turn, () => 'never');
    }
    const rep = reportOf(r);
    expect(rep.baseTurn).toBe(5);
    expect(rep.base).toBe('T5');
    expect(rep.trail).toHaveLength(KEEP_TURNS * 2);
    expect(rep.trail[0]!.seed).toBe(50);
  });

  it('reset() 之后旧现场整段作废', () => {
    const r = new FlightRecorder();
    r.record(entry(1), 1, () => 'OLD');
    r.reset();
    expect(r.trailLength).toBe(0);
    expect(reportOf(r).base).toBe('NOW');
  });

  it(`错误是环形缓冲（${KEEP_ERRORS} 条），reset 不清它 —— 报错往往正是换局面的原因`, () => {
    const r = new FlightRecorder();
    for (let i = 0; i < KEEP_ERRORS + 7; i++) r.error({ t: i, kind: 'error', message: `e${i}`, stack: null });
    r.reset();
    const rep = reportOf(r);
    expect(rep.errors).toHaveLength(KEEP_ERRORS);
    expect(rep.errors[0]!.message).toBe('e7');
  });

  it('文件名用本地时间，带原因', () => {
    expect(reportFileName(new Date(2026, 8, 19, 5, 3, 9), 'error')).toBe('rich4-report-20260919-050309-error.json');
  });
});

if (haveMap) {
  describe('★ 记下来的现场能逐字节重放回去', () => {
    const map = parseMap(new MkfArchive(new Uint8Array(readFileSync(MAP_MKF))).read(1));
    const topo: MapTopology = {
      nodes: map.nodes, lands: map.lands, facilities: map.facilities,
      commercials: map.commercials, landscapes: map.landscapes,
    };

    /** 与 main.ts 的 `reduceRecorded` 同形：种子取一次，既施加也记录 */
    function play(turns: number, seedOf: (n: number) => number): { r: FlightRecorder; state: GameState } {
      const r = new FlightRecorder();
      let state = newGame({
        map, globalMapId: 0, seed: 7,
        players: [0, 3, 5, 7].map((character) => ({ character, kind: 'computer' as const })),
      });
      for (let n = 0; n < 200_000 && state.turnCount < turns; n++) {
        const action = decideAction({ state, map });
        if (action === null) break;
        const seed = seedOf(n);
        const before = state;
        const next = reduceWithHostRng(before, action, topo, seed);
        if (next !== before) r.record({ t: n, action, seed }, before.turnCount, () => serializeGame(before));
        state = next;
      }
      return { r, state };
    }

    it('40 回合（跨越多次日推进的重播种、且起点已被容量淘汰过）⇒ 重放指纹相等', () => {
      const { r, state } = play(40, (n) => (n * 2654435761) >>> 1);
      const rep = r.report({
        reason: 'manual', note: '', env: {}, finalState: serializeGame(state),
        finalFingerprint: stateFingerprint(state), finalTurn: state.turnCount, screenshot: null, now: new Date(),
      });
      expect(rep.baseTurn).toBeGreaterThan(0); // 起点不是开局 —— 考的是「从半路快照放起」
      // 走一遍 JSON（落盘再读回来的形状）
      const back = JSON.parse(JSON.stringify(rep)) as typeof rep;
      const end = replayTrail(deserializeGame(back.base), back.trail, topo);
      expect(stateFingerprint(end)).toBe(back.finalFingerprint);
      expect(end.rngState).toBe(state.rngState);
    });

    it('★ 种子没记对就放不回去（证明「记种子」这件事不是摆设）', () => {
      const { r, state } = play(40, (n) => (n * 2654435761) >>> 1);
      const rep = reportOf(r);
      const wrong = rep.trail.map((e) => ({ ...e, seed: 1 }));
      const end = replayTrail(deserializeGame(rep.base), wrong, topo);
      expect(end.rngState).not.toBe(state.rngState);
    });
  });
}
