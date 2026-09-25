/*
 * 联机：pt26-input 三条输入语义在服务器那一侧的前提 —— 真人自己改託管、樂透投注窗只归「正好 1」的那位
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 客户端那一半（按下 / 抬手、谁能点）钉在：
 *   · `packages/client/src/ai-settings.test.ts`（託管AI 屏：先选中、再点才翻；联机只改本机座位那一行）；
 *   · `packages/client/src/lottery-screen.test.ts`（投注窗：旁观 / 被託管时点不动）；
 *   · `packages/client/src/touch-input.test.ts` / `board-screen.test.ts` / `amount-keys.test.ts`（填数窗按下放音、抬手动作）。
 * 这里钉住服务器与两端重放：
 *   ① 託管AI 的「確定」只发本机座位那一行 `setAi` —— 轮到自己时受理、两端重放一致；旁观座位改自己的
 *      `setAi` 仍按原规矩被拒（`notYourTurn`，定序器那一道不变）。
 *   ② 樂透：电脑落点**不挂** `pending{lottery}`（0x004315e1 `jne` 电脑那支不开窗）；真人落点挂出、服务器不替他答；
 *      旁观答不了；超时託管（`setAi 5`）后 AI 替他收掉这扇窗 —— 此刻客户端那扇窗已不认人点（`lotteryLocked`）。
 *   ③ 填数窗的音与动作只在本机那一台：抬手派的那一条 action 与先前同形（协议不变），由行动座位受理、旁观被拒。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type SeatInfo,
} from '@rich4/core';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials });

/** 0、1 号真人（1 号在旁观），2、3 号电脑 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i <= 1 ? ('human' as const) : ('computer' as const) }));

function scene(map: Map0, at: number, onKind: number): GameState {
  const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 11, mode: 'multiplayer' });
  const node = map.nodes.find((n) => n.specialKind === onKind);
  if (node === undefined) throw new Error(`地图里找不到特殊格 ${onKind}`);
  return {
    ...base,
    currentPlayer: at,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: base.players.map((p, i) => ({
      ...p,
      whoPlays: i <= 1 ? WHO_PLAYS_HUMAN : 2,
      cash: 50_000,
      nodeId: i === at ? node.id : p.nodeId,
    })),
  };
}

function harness(map: Map0, state: GameState) {
  const topo = topoOf(map);
  const room = new Room({ id: 'PT26IN', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
  room.start();
  const mirrors = [{ s: state }, { s: state }];
  const apply = (a: Action): void => {
    for (const m of mirrors) {
      m.s = reduce(m.s, a, topo);
      expect(stateFingerprint(m.s)).toBe(room.fingerprint);
    }
  };
  const submit = (seat: number, a: Action) => {
    const r = room.submit(seat, a);
    if (r.ok) apply(r.broadcast.action);
    return r;
  };
  return { room, mirrors, apply, submit };
}

describe('★ pt26-input 联机', () => {
  run('① 託管AI：本机座位自己的 setAi 轮到时受理、两端一致；旁观座位照旧被拒', () => {
    const map = loadMap();
    const h = harness(map, { ...scene(map, 0, SPECIAL_KIND.PARK), phase: 'awaitingRoll' });
    // 0 号（行动者）在屏上「先选中自己那一行、再点一下」翻上託管，改了个性 → 確定只发自己那一行
    const mine: Action = { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT, aiFlags: 3, personality: 2, cashRatio: 40, stockRatio: 60 };
    expect(h.submit(0, mine).ok).toBe(true);
    for (const m of h.mirrors) {
      expect(m.s.players[0]).toMatchObject({ whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT, personality: 2, cashRatio: 40, stockRatio: 60 });
    }
    // 1 号（旁观）在自己那台上点了確定：不是他的回合 ⇒ 定序器拒（这一道不变）
    const r = h.submit(1, { type: 'setAi', player: 1, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
    expect(r).toMatchObject({ ok: false });
    expect(h.room.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
  });

  run('② 樂透：电脑落点不开窗；真人落点开窗、旁观答不了、超时託管后 AI 收窗 —— 两端一致', () => {
    const map = loadMap();
    // 电脑（2 号）落在投注站：`pending` 不挂（原版电脑那支当场买完、不弹屏）
    const ai = harness(map, scene(map, 2, SPECIAL_KIND.LOTTERY));
    const settleAi = ai.room.decideForCurrent();
    expect(settleAi).toEqual({ type: 'settle' });
    expect(ai.submit(2, settleAi!).ok).toBe(true);
    expect(ai.room.state.pending?.kind).not.toBe('lottery');

    // 真人（0 号）落在投注站
    const h = harness(map, scene(map, 0, SPECIAL_KIND.LOTTERY));
    expect(h.submit(0, { type: 'settle' }).ok).toBe(true);
    expect(h.room.state.pending?.kind).toBe('lottery');
    expect(h.room.decideForCurrent()).toBeNull(); // 服务器不替真人买
    // 旁观（1 号）：送了也是 notYourTurn —— 客户端那扇窗本来就不让他点
    expect(h.submit(1, { type: 'lottery', number: 0 })).toMatchObject({ ok: false });
    // 超时託管：服务器 setAi 5 ⇒ 这一回合归电脑，本机那扇窗此刻也不认点（`lotteryLocked`）
    const taken = h.room.submitSystem({ type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
    expect(taken.ok).toBe(true);
    if (taken.ok) h.apply(taken.broadcast.action);
    let guard = 0;
    while (h.room.state.pending?.kind === 'lottery' && guard++ < 5) {
      const act = h.room.decideForCurrent();
      expect(act).not.toBeNull();
      expect(h.submit(0, act!).ok).toBe(true);
    }
    for (const m of h.mirrors) expect(m.s.pending?.kind).not.toBe('lottery');
  });

  run('③ 真人落点买号（投注窗 / 填数窗抬手派的那一条）：行动座位受理、旁观被拒、两端一致', () => {
    const map = loadMap();
    const h = harness(map, scene(map, 0, SPECIAL_KIND.LOTTERY));
    expect(h.submit(0, { type: 'settle' }).ok).toBe(true);
    const p = h.room.state.pending;
    if (p?.kind !== 'lottery') throw new Error('没开投注窗');
    const n = p.available[0]!;
    expect(h.submit(1, { type: 'lottery', number: n })).toMatchObject({ ok: false });
    expect(h.submit(0, { type: 'lottery', number: n }).ok).toBe(true);
    for (const m of h.mirrors) {
      expect(m.s.pending).toBeNull();
      expect(m.s.players[0]!.cash).toBe(50_000 - 1000);
    }
  });
});
