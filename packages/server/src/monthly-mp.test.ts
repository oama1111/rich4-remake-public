/*
 * 联机：月结现场（第二十一份 `20260924-144653022`）—— 服务器与客户端镜像同一份 `lastMonthlySettle`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 月结屏（`client/src/monthly-screen.ts`）照 exe 的状态机演「本月悲情人物 / 本月冠軍」两段评比，
 * 演什么全取 core 在结算那一刻交出的 `lastMonthlySettle`（加息前存款、清零前累加器、悲情 / 冠軍）。
 * 联机时每一端都按广播重放同一条 action ⇒ 这份现场必须逐字节相同（否则行动者与旁观者演的不是同一个人）；
 * 它是纯表现：不进指纹，下一条 action 就清掉。表现层那一半（自己往下走、不等点击、旁观 `fastForward`）
 * 钉在 `packages/client/src/monthly-screen.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
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

/** 四个座位都是真人（服务器不替谁走）*/
const seats = (): SeatInfo[] => [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

function monthEnd(map: Map0): GameState {
  const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
  return {
    ...base,
    month: 1,
    day: 31,
    currentPlayer: 3,
    phase: 'turnEnd',
    pending: null,
    // 开局还没「降落」的玩家 `whoPlays` 是 0 —— 摆成在场的真人；2 号本月倒楣（悲情分最高且领先 0.4）
    players: base.players.map((p, i) => ({
      ...p,
      whoPlays: 1,
      nodeId: 1,
      moneyInBank: 100_000 + i * 1000,
      monthlyPaid: i === 2 ? 90_000 : 500,
      monthlyReceived: 100,
      totalWinterSleepDays: i === 2 ? 5 : 0,
    })),
  };
}

function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

describe('★★ 联机：月结现场两端一致', () => {
  run('最后一位收回合跨月 ⇒ 服务器与镜像的 `lastMonthlySettle` 逐字段相同；悲情 = 2 号；下一条就清掉', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = monthEnd(map);
    const room = new Room({ id: 'MONMP1', map, globalMapId: 0, seed: 5, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 3, { type: 'endTurn' }).ok).toBe(true);
    const h = room.state.lastMonthlySettle;
    expect(h).toBeTruthy();
    expect(mirror.s.lastMonthlySettle).toEqual(h);
    expect(room.state.month).toBe(2);
    expect(h!.rows.map((r) => r.player)).toEqual([0, 1, 2, 3]);
    expect(h!.rows.map((r) => r.bankBefore)).toEqual([100_000, 101_000, 102_000, 103_000]);
    expect(h!.unlucky).toBe(2);
    expect(h!.rows[2]).toMatchObject({ unexpectedLoss: 90_000, unluckyDays: 5 });
    // 状态本体照原版清零（`0x00439ec6`）
    expect(room.state.players.every((p) => p.monthlyPaid === 0 && p.totalWinterSleepDays === 0)).toBe(true);
    // 下一条 action（0 号开回合）⇒ 现场清掉，旁观端不会再演一遍
    expect(submitBoth(room, mirror, topo, room.actingSeat, { type: 'startTurn' }).ok).toBe(true);
    expect(room.state.lastMonthlySettle ?? null).toBeNull();
    expect(mirror.s.lastMonthlySettle ?? null).toBeNull();
  });
});
