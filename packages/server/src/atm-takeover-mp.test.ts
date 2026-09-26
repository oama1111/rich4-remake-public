/*
 * 联机：ATM 那一格被**别处**答掉（回合计时 / 掉线託管）—— pt22 「ATM 窗关不掉」的服务器那一半
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 客户端那一半（本机 ATM 面板随 `pending{atm}` / 本机回合收掉）钉在
 * `packages/client/src/turn-modals.test.ts`。这里钉住「别处答掉」这条路在联机里真的存在，且两端重放一致：
 *   ① 真人落在銀行 ⇒ 镜像挂出 `pending{atm}`，服务器不替真人答（`decideForCurrent` 为 null）；
 *   ② 旁观座位答不了（`notYourTurn`）—— 旁观端从来不该有这扇窗；
 *   ③ 计时 / 掉线託管：`setAi(…, HUMAN | AUTOPILOT)`（`hub.ts` 扫描那一句）后 core 的 AI 替他答掉，
 *      `pending{atm}` 消失 —— 本机那扇 ATM 面板此刻必须收掉（先前只有 EXIT / 確認 / 右键会关）；
 *   ④ 客户端按广播重放，与服务器指纹逐条一致。
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

/** 0、1 号真人（1 号在旁观），其余电脑 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i <= 1 ? ('human' as const) : ('computer' as const) }));

function scene(map: Map0): GameState {
  const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 7, mode: 'multiplayer' });
  const bank = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BANK);
  if (bank === undefined) throw new Error('地图里找不到銀行');
  return {
    ...base,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: base.players.map((p, i) => ({ ...p, whoPlays: i <= 1 ? WHO_PLAYS_HUMAN : 2, nodeId: i === 0 ? bank.id : p.nodeId })),
  };
}

describe('★★ 联机：ATM 那一格被计时 / 掉线託管答掉', () => {
  run('★ ① 挂出 pending{atm} ② 旁观答不了 ③ 託管后 AI 答掉 ④ 重放一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = scene(map);
    const room = new Room({ id: 'ATMMP', map, globalMapId: 0, seed: 7, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };
    const apply = (a: Action): void => {
      mirror.s = reduce(mirror.s, a, topo);
      expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
    };

    const settled = room.submit(0, { type: 'settle' });
    expect(settled.ok).toBe(true);
    if (settled.ok) apply(settled.broadcast.action);
    expect(room.state.pending?.kind).toBe('atm');
    // ① 真人的 ATM：服务器不替他答
    expect(room.decideForCurrent()).toBeNull();
    // ② 旁观座位（1 号）答不了 —— 他那一端从来不该开这扇窗
    expect(room.submit(1, { type: 'declineDecision' })).toMatchObject({ ok: false });

    // ③ 回合计时到点 / 掉线：服务器把 0 号改成「真人 + 託管」，再让 core 的 AI 替他答
    const taken = room.submitSystem({ type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
    expect(taken.ok).toBe(true);
    if (taken.ok) apply(taken.broadcast.action);
    // 託管那一拍 pending 还在：本机面板此刻就该收（回合已不在本机真人手里）
    expect(mirror.s.pending?.kind).toBe('atm');
    let guard = 0;
    while (mirror.s.pending?.kind === 'atm' && guard++ < 5) {
      const act = room.decideForCurrent();
      expect(act).not.toBeNull();
      const r = room.submit(0, act!);
      expect(r.ok).toBe(true);
      if (r.ok) apply(r.broadcast.action);
    }
    // ④ 别处答掉了：pending{atm} 没了（两端一致）
    expect(mirror.s.pending?.kind).not.toBe('atm');
    expect(room.state.pending?.kind).not.toBe('atm');
  });
});
