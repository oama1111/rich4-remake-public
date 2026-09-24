/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 「走回棋盘」的**端到端**可证伪回归（第 86/87 条 + 2026-09-19 的 `special` 修正）：
 * 真的跑一遍 core 的 `reduce`（刑满 → 释放那一回合），再看客户端会不会起位移补间。
 *
 * 本文件盯两件**会分别变红**的事：
 *  ① 释放那一刻**必须起补间**（起点 = 綠島／醫院大樓、终点 = 關押格）——
 *     若谁把它退回「直接把 x/y 吸附过去」（或删掉 `walkTweenFor` 的
 *     `startTurn` 分支），第一条就红；
 *  ② 补间必须走**特殊支**（`dist × 0.125`，8 世界单位/拍，与交通方式无关）——
 *     若退回按 `trafficMethod` 查速度表，第三条里「開車」那一档就红。
 *
 * 出处（逐条读过 `rich4.exe`，详见 `tween.ts` / core `rules/gate-walk.ts`）：
 * - 起点 `0x40c0c1/0x40c0cc`、终点 `0x40c0dc/0x40c0e4`、`0x10` 分支判据 `0x40c0ba`；
 * - 特殊支判据 `0x40c26d`、乘数 `0x40c27a fmul [0x4631dc]`；
 * - 只走一格 `0x40dd40 mov dword [0x48baf8], 1`。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  RELEASE_PENDING,
  gateWalkPlan,
  landAll,
  newGame,
  parseMap,
  reduce,
  type GameState,
} from '@rich4/core';
import { tweenTickCount, walkTweenFor } from './tween.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

const load = () => {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  return { map, topo: { nodes: map.nodes, lands: map.lands, landscapes: map.landscapes } };
};

/**
 * 造一个「**下一位**玩家（1 号）刑满待释放、占用表里还记着他」的回合边界局面。
 * 与 `core/src/state/release-chain.test.ts` 的 `pendingRelease` 同一构造。
 */
function pendingRelease(field: 'inPrison' | 'inHospital', occ: 'prisonOccupancy' | 'hospitalOccupancy'): GameState {
  const { map } = load();
  // 夹具：大家都已落地（开局只摆第 1 位，见 core 的 `rules/start-placement.ts`）
  const s = landAll(
    newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    }),
    map.nodes,
  );
  return {
    ...s,
    phase: 'turnEnd',
    pendingNpcSlots: [],
    currentPlayer: 0,
    [occ]: (s[occ] as number[]).map((_v, i) => (i === 1 ? 1 : 0)),
    players: s.players.map((p, i) =>
      i === 1 ? { ...p, blocking: { ...p.blocking, [field]: RELEASE_PENDING } } : p,
    ),
  } as GameState;
}

/** 走到「释放那一回合的 startTurn」之前：`before` 的人还在景观坐标上 */
function onLandscape(kind: 'prison' | 'hospital') {
  const { map, topo } = load();
  const field = kind === 'prison' ? 'inPrison' : 'inHospital';
  const occ = kind === 'prison' ? 'prisonOccupancy' : 'hospitalOccupancy';
  const flagged = reduce(pendingRelease(field, occ), { type: 'endTurn' }, topo);
  // 关押格（`type` 判据）与在押期间的贴图位（景观记录）
  const gate = map.nodes.find((n) => n.type === (kind === 'prison' ? 0x1f42 : 0x1f41))!;
  const land = map.landscapes[kind === 'prison' ? 1 : 0]!;
  const before: GameState = {
    ...flagged,
    phase: 'turnStart',
    currentPlayer: 1,
    players: flagged.players.map((p, i) =>
      i === 1 ? { ...p, nodeId: gate.id, xpos: land.x, ypos: land.y } : p,
    ),
  };
  const after = reduce(before, { type: 'startTurn' }, topo);
  return { map, topo, before, after, gate, land };
}

describe('★★ 「走回棋盘」真跑一遍：释放必须**走**回去，不许吸附', () => {
  run('監獄：釋放那一回合起补间，起点 = 綠島、终点 = 關押格 1', () => {
    const { map, before, after, gate, land } = onLandscape('prison');
    const t = walkTweenFor('startTurn', before, after, (id) => map.nodes[id - 1]);
    // ★ 可证伪：若释放把 x/y 直接吸附过去而不改（或删掉 startTurn 分支）⇒ null
    expect(t, '释放那一回合必须起位移补间').not.toBeNull();
    expect(t!.player).toBe(1);
    expect(t!.from).toEqual({ x: land.x, y: land.y }); // 綠島 (1817,1960)
    expect(t!.to).toEqual({ x: gate.x, y: gate.y }); //   關押格 1 (1752,1871)
    expect(t!.special).toBe(true);
  });

  run('醫院：同构（起 = 醫院大樓、终 = 關押格 23）', () => {
    const { map, before, after, gate, land } = onLandscape('hospital');
    const t = walkTweenFor('startTurn', before, after, (id) => map.nodes[id - 1]);
    expect(t).not.toBeNull();
    expect(t!.from).toEqual({ x: land.x, y: land.y }); // 醫院大樓 (319,990)
    expect(t!.to).toEqual({ x: gate.x, y: gate.y }); //   關押格 23 (384,1056)
    expect(t!.special).toBe(true);
  });

  run('反例（负对照）：普通开局 x/y 没变 ⇒ **不起**补间', () => {
    const { map, before, after } = onLandscape('prison');
    // 把这一位放回關押格坐标（= 已经没有位移），且不带「走回棋盘」标记
    const settled: GameState = {
      ...before,
      players: before.players.map((p, i) =>
        i === 1 ? { ...p, xpos: after.players[1]!.xpos, ypos: after.players[1]!.ypos } : p,
      ),
    };
    expect(walkTweenFor('startTurn', settled, after, (id) => map.nodes[id - 1])).toBeNull();
  });
});

describe('★ 走回棋盘的拍数：与交通方式无关（走 `dist × 0.125`）', () => {
  run('四种交通方式下拍数都是 11 / 13，且等于 core 的 `gateWalkPlan`', () => {
    for (const [kind, want] of [
      ['hospital', 11],
      ['prison', 13],
    ] as const) {
      const { map, before, after } = onLandscape(kind);
      const t = walkTweenFor('startTurn', before, after, (id) => map.nodes[id - 1])!;
      const dx = t.to.x - t.from.x;
      const dy = t.to.y - t.from.y;
      const plan = gateWalkPlan(kind, map.nodes, map.landscapes)!;
      expect(plan.ticks, `${kind}：core 规格`).toBe(want);
      for (const traffic of [0, 1, 2, 3]) {
        expect(tweenTickCount(dx, dy, traffic, t.special), `${kind} traffic=${traffic}`).toBe(want);
      }
      // ★ 可证伪（本次修正的那条）：按交通方式算的话，開車那一档会明显更少
      //   —— 若 main.ts 退回硬编码 `special = false`，上面四条里 1/2 两档就红。
      expect(tweenTickCount(dx, dy, 2, false), `${kind}：開車的错值`).not.toBe(want);
    }
  });
});

/*
 * 接线护栏：`walkTweenFor` 的结论必须真的传到 `startWalk`，而且「走回棋盘」
 * 要摆**走**姿（`phase` 那一回合是 `turnEnd`，光看 phase 会滑着站姿走完）。
 * 与 `walk-flicker.test.ts` 同一套「按源码计数」的写法（这里只钉两处关键接线）。
 */
describe('★ 接线：special 与「走」姿', () => {
  it('`main.ts` 把 `t.special` 传给 `renderer.startWalk`（不许写死 false）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const at = src.indexOf('renderer.startWalk(\n    t.player,');
    expect(at, '`tweenStepIfMoved` 里那一处 startWalk 调用').toBeGreaterThanOrEqual(0);
    const call = src.slice(at, src.indexOf(');', at));
    expect(call).toContain('t.special');
    expect(call).not.toContain('false,');
  });

  it('`render.ts` 的棋子姿态把「正在补间」也算成走姿', () => {
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    expect(src).toContain('this.isWalking(pl.index, nowMs)');
    expect(src).toContain('isWalking(player: number, now = performance.now())');
  });
});
