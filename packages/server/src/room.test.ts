/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 房间：定序 + 镜像
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { newGame, parseMap, reduce, stateFingerprint } from '@rich4/core';
import type { SeatInfo } from '@rich4/core';
import { Room } from './room.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

const makeRoom = () =>
  new Room({ id: 'r1', map: loadMap(), globalMapId: 0, seed: 1234, seats: seats() });

describe('开局', () => {
  run('未 start 时拒绝意图', () => {
    const r = makeRoom();
    expect(r.submit(0, { type: 'startTurn' })).toMatchObject({ ok: false, reason: 'notRunning' });
  });

  run('start 后当前座位可以行动', () => {
    const r = makeRoom();
    r.start();
    expect(r.currentSeat).toBe(0);
    expect(r.submit(0, { type: 'startTurn' }).ok).toBe(true);
  });
});

describe('★ 非法 action 不占序号', () => {
  run('在 turnStart 阶段掷骰会被拒，且不消耗序号', () => {
    const r = makeRoom();
    r.start();
    const bad = r.submit(0, { type: 'rollDice' });
    expect(bad).toMatchObject({ ok: false, reason: 'illegalAction' });
    expect(r.sequenceLength).toBe(0);

    const good = r.submit(0, { type: 'startTurn' });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.broadcast.seq).toBe(0);
  });

  run('★ 这是联机层最关键的一条：日志里不能有施加不了的 action', () => {
    const r = makeRoom();
    r.start();
    for (const a of [{ type: 'settle' }, { type: 'buyLand' }, { type: 'endTurn' }] as const) {
      expect(r.submit(0, a).ok, a.type).toBe(false);
    }
    expect(r.sequenceLength).toBe(0);
  });
});

describe('回合归属', () => {
  run('非当前座位被拒', () => {
    const r = makeRoom();
    r.start();
    expect(r.submit(2, { type: 'startTurn' })).toMatchObject({ ok: false, reason: 'notYourTurn' });
  });
});

describe('★ 客户端重放房间日志得到同一状态', () => {
  run('逐条广播后指纹一致', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const room = makeRoom();
    room.start();

    let client = newGame({
      map,
      globalMapId: 0,
      players: seats().map((s) => ({ character: s.character, kind: s.kind })),
      seed: 1234,
      mode: 'multiplayer',
    });

    const script = ['startTurn', 'rollDice', 'step', 'step', 'settle'] as const;
    for (const t of script) {
      const res = room.submit(room.currentSeat, { type: t });
      if (!res.ok) continue; // 有些阶段可能已跳过（例如没有岔路）
      client = reduce(client, res.broadcast.action, topo);
    }

    expect(room.fingerprint).toBe(stateFingerprint(client));
  });

  run('★ since(0) 补发足以让新客户端追上——无需状态快照', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const room = makeRoom();
    room.start();

    for (const t of ['startTurn', 'rollDice', 'step', 'step'] as const) {
      room.submit(room.currentSeat, { type: t });
    }

    let rejoin = newGame({
      map,
      globalMapId: 0,
      players: seats().map((s) => ({ character: s.character, kind: s.kind })),
      seed: 1234,
      mode: 'multiplayer',
    });
    for (const b of room.since(0)) rejoin = reduce(rejoin, b.action, topo);

    expect(stateFingerprint(rejoin)).toBe(room.fingerprint);
  });
});
