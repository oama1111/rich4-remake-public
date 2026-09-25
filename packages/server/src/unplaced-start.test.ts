/*
 * 联机：开局惰性摆人（第 2..N 位轮到自己才落地）—— 开局 / 掉线代打 / 重连补发 / 失步重放
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-24：「其他玩家在第一回合要轮到了才有个降落伞特效出现在地图上」。
 * 摆人在 reducer 里（回合交接那一刻，`core/src/rules/start-placement.ts`）⇒ 各端照同一串 action
 * 重放必然同一个结果；这里钉的是联机那几条旁路：
 *   · 开局广播之后的镜像：只有 0 号在盘上；
 *   · 还没上盘就掉线 ⇒ 掉线代打（`setAi`）改的是**落地之后**那一份，落地时由电脑代打；
 *   · 还没上盘就掉线又回来 ⇒ 归还（`setAi` 真人）同样落在那一份上，落地后等他自己掷骰；
 *   · 重连补发 / 失步重放：从 `newGame` 起重放到第一輪中途（有人还没上盘）与服务器指纹一致。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_HUMAN,
  isUnplaced,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type ClientHandle, type Conn } from './hub.ts';

const ROOM = 'P4R8QT';
const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

class FakeConn implements Conn {
  readonly inbox: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  close(): void {}
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}

type Map0 = ReturnType<typeof loadMap>;
// ★ 2026-09-25：与客户端（main.ts 建 topo 那一行）逐项一致，含 `landscapes`。
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes });

/** 客户端镜像：`start` 的参数 newGame，再按广播的 action 重放 */
function mirror(map: Map0, conn: FakeConn): GameState {
  const start = conn.last('start')!;
  let s = newGame({
    map,
    globalMapId: 0,
    seed: start.seed,
    players: start.seats.map((x) => ({ character: x.character, kind: x.kind })),
    mode: 'multiplayer',
  });
  for (const m of conn.inbox) if (m.t === 'action') s = reduce(s, m.action, topoOf(map));
  return s;
}

function setup() {
  const map = loadMap();
  let now = 0;
  const hub = new RoomHub({ map, globalMapId: 0, seedFor: () => 2468, takeoverAfterMs: 1000, now: () => now });
  const a = new FakeConn();
  const b = new FakeConn();
  const ha = hub.connect(a);
  const hb = hub.connect(b);
  ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
  hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
  ha.onMessage({ t: 'start' });
  return { map, hub, a, b, ha, hb, setNow: (t: number) => (now = t) };
}

/** 真人 A 把自己这一回合走完（机械地答） */
function playTurn(hub: RoomHub, h: ClientHandle, seat: number): void {
  const room = hub.room(ROOM)!;
  if (room.state.phase === 'turnStart' && room.currentSeat === seat) h.onMessage({ t: 'intent', action: { type: 'startTurn' } });
  let guard = 0;
  while (room.currentSeat === seat && guard++ < 80) {
    const s = room.state;
    const act: Action =
      s.phase === 'awaitingRoll' ? { type: 'rollDice' }
      : s.phase === 'moving' ? { type: 'step' }
      : s.phase === 'settling' ? { type: 'settle' }
      : s.phase === 'awaitingDecision' ? { type: 'declineDecision' }
      : s.phase === 'turnStart' ? { type: 'startTurn' }
      : { type: 'endTurn' };
    const before = room.sequenceLength;
    h.onMessage({ t: 'intent', action: act });
    if (room.sequenceLength === before) break;
  }
}

describe('★ 联机开局：只有 0 号在盘上，其余轮到自己才落地', () => {
  run('开局镜像 = 服务器；1..3 号还没上盘（who_plays 0、坐标 0、落地后那一份 = 真人 / 电脑）', () => {
    const { map, hub, a, b } = setup();
    const st = hub.room(ROOM)!.state;
    expect(st.players.map((p) => isUnplaced(p))).toEqual([false, true, true, true]);
    expect(st.players.map((p) => p.landingWhoPlays)).toEqual([WHO_PLAYS_HUMAN, WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_COMPUTER]);
    for (const c of [a, b]) expect(stateFingerprint(mirror(map, c))).toBe(hub.room(ROOM)!.fingerprint);
  });

  run('★ 还没上盘就掉线 ⇒ 代打改落地后那一份；轮到他时落地并由电脑代打，各端镜像一致；重连补发后指纹一致', () => {
    const { map, hub, a, ha, hb, setNow } = setup();
    hb.onClose(0);
    setNow(1500);
    expect(hub.sweepDisconnected(1500)).toEqual([{ roomId: ROOM, seat: 1 }]);
    const p1 = hub.room(ROOM)!.state.players[1]!;
    expect(isUnplaced(p1)).toBe(true);
    expect(p1.whoPlays).toBe(0);
    expect(p1.landingWhoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);

    // A 走完自己这一回合 ⇒ 1 号落地（託管身份）、服务器代打，2/3 号电脑依次落地，又轮回 A
    playTurn(hub, ha, 0);
    const room = hub.room(ROOM)!;
    expect(room.currentSeat).toBe(0);
    expect(room.state.players.map((p) => isUnplaced(p))).toEqual([false, false, false, false]);
    expect(room.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect(stateFingerprint(mirror(map, a))).toBe(room.fingerprint);

    // 重连（带 since = 0）：补发之后镜像一致；座位归还给真人
    const b2 = new FakeConn();
    hub.connect(b2).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B'), since: 0 });
    expect(room.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    // b2 只收到 since 之后的；拼上 A 那份完整日志的前一段再重放（= 客户端手里本来就有的那部分）
    const full = new FakeConn();
    full.inbox.push(a.last('start')!, ...a.inbox.filter((m) => m.t === 'action'));
    expect(stateFingerprint(mirror(map, full))).toBe(room.fingerprint);
  });

  run('★ 还没上盘时掉线又回来 ⇒ 归还落在落地后那一份上；轮到他时落地、停着等他自己掷骰', () => {
    const { map, hub, a, ha, hb, setNow } = setup();
    hb.onClose(0);
    setNow(1500);
    hub.sweepDisconnected(1500);
    const b2 = new FakeConn();
    const hb2 = hub.connect(b2);
    hb2.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    const room = hub.room(ROOM)!;
    expect(room.state.players[1]!.landingWhoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(isUnplaced(room.state.players[1]!)).toBe(true);
    playTurn(hub, ha, 0);
    // 轮到 1 号：已落地，真人，服务器不代打 ⇒ 停在他的回合开头
    expect(room.currentSeat).toBe(1);
    expect(room.state.phase).toBe('turnStart');
    expect(room.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(room.state.players[1]!.xpos).toBeGreaterThan(0);
    expect(room.state.players.map((p) => isUnplaced(p))).toEqual([false, false, true, true]);
    for (const c of [a, b2]) expect(stateFingerprint(mirror(map, c))).toBe(room.fingerprint);

    // ★ 失步重放（第一輪中途、2/3 号还没上盘）：从头重放与服务器一致
    b2.inbox.length = 0;
    hb2.onMessage({ t: 'resync' });
    const rep = b2.last('replay')!;
    let healed = newGame({
      map,
      globalMapId: rep.globalMapId,
      seed: rep.seed,
      players: rep.seats.map((s) => ({ character: s.character, kind: s.kind })),
      mode: 'multiplayer',
    });
    for (const x of rep.actions) healed = reduce(healed, x.action, topoOf(map));
    expect(healed.players.map((p) => isUnplaced(p))).toEqual([false, false, true, true]);
    expect(stateFingerprint(healed)).toBe(room.fingerprint);
  });
});
