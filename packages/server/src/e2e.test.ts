/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * T-077：四个客户端同进程跑一局 —— 每个客户端只按服务器广播重放，
 * 结束时四份镜像与服务器指纹相同；且与「单机用同一套决策」跑出来的状态逐字节一致。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  decideAction,
  isGameOver,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type MapTopology,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type Conn } from './hub.ts';

const E2E = 'E2E2E2';
const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
/**
 * ★ W-73：`join` 多了必填的 `clientId`。测试里按名字派生一个稳定的 32 位十六进制 ——
 * 同名 ⇒ 同身份，于是「两个同名的人各占一座」要靠**显式传不同的 clientId** 来构造
 * （那正是 W-73 §3 要钉住的判据）。
 */
const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

const run = existsSync(MAP) ? it : it.skip;

class Client implements Conn {
  state: GameState | null = null;
  expected = 0;
  readonly log: Action[] = [];
  constructor(private readonly map: ReturnType<typeof parseMap>, private readonly topo: MapTopology) {}
  send(msg: ServerMessage): void {
    if (msg.t === 'start') {
      this.state = newGame({
        map: this.map,
        globalMapId: msg.globalMapId,
        seed: msg.seed,
        players: msg.seats.map((s) => ({ character: s.character, kind: s.kind })),
        mode: 'multiplayer',
      });
      return;
    }
    if (msg.t === 'action') {
      if (msg.seq !== this.expected) throw new Error(`乱序：期望 ${this.expected} 收到 ${msg.seq}`);
      this.expected++;
      this.state = reduce(this.state!, msg.action, this.topo);
      this.log.push(msg.action);
    }
    if (msg.t === 'error') throw new Error(msg.message);
    if (msg.t === 'desync') throw new Error(`desync @${msg.seq}`);
  }
}

/**
 * 真人座位的「脚本」：第一次轮到自己先发 setAi 把自己託管（1 → 5），之后每一步都由 core 的 AI 拿主意。
 * ★ 决策必须在**与镜像一致**的状态上做——託管位在镜像里也置上了，`aiNext` 才合法。
 */
function scripted(state: GameState, map: ReturnType<typeof parseMap>, seat: number): Action {
  const me = state.players[seat]!;
  if ((me.whoPlays & WHO_PLAYS_AUTOPILOT) === 0) return { type: 'setAi', player: seat, whoPlays: me.whoPlays | WHO_PLAYS_AUTOPILOT };
  const a = decideAction({ state, map });
  if (a === null) throw new Error(`座位 ${seat} 无决策：${state.phase}`);
  return a;
}

describe('★ 联机端到端', () => {
  run('四客户端 + 服务器代打三個電腦，跑 120 回合：镜像一致，且与单机同决策逐字节一致', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    // ★ 客户端与服务器镜像必须用同一份完整 topo（含設施、企业表）
    // ★ 2026-09-25：与客户端（main.ts 建 topo 那一行）逐项一致，含 `landscapes`。
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
    const hub = new RoomHub({ map, globalMapId: 0, seedFor: () => 20240914 });
    const host = new Client(map, topo);
    const watchers = [new Client(map, topo), new Client(map, topo), new Client(map, topo)];
    const hHost = hub.connect(host);
    hHost.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: E2E, name: 'host', clientId: idFor('host') });
    const hw = watchers.map((w, i) => {
      const h = hub.connect(w);
      h.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: E2E, name: `w${i}`, clientId: idFor(`w${i}`) });
      return h;
    });
    hHost.onMessage({ t: 'start' });
    const room = hub.room(E2E)!;

    // 真人座位 0..3 都是真人（四个客户端），每到谁就由那个客户端用脚本决定并发意图
    const handles = [hHost, ...hw];
    let guard = 0;
    while (!isGameOver(room.state) && room.state.turnCount < 120 && guard++ < 50_000) {
      const seat = room.actingSeat;
      const client = seat === 0 ? host : watchers[seat - 1]!;
      handles[seat]!.onMessage({ t: 'intent', action: scripted(client.state!, map, seat) });
    }
    expect(room.state.turnCount).toBeGreaterThanOrEqual(120);

    // ① 四份客户端镜像 == 服务器
    const fp = room.fingerprint;
    expect(stateFingerprint(host.state!)).toBe(fp);
    for (const w of watchers) expect(stateFingerprint(w.state!)).toBe(fp);

    // ② 单机：同种子、同座位、同一套决策，逐字节一致
    let local = newGame({
      map,
      globalMapId: 0,
      seed: 20240914,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'human' as const })),
      mode: 'multiplayer',
    });
    guard = 0;
    while (!isGameOver(local) && local.turnCount < 120 && guard++ < 50_000) {
      local = reduce(local, scripted(local, map, local.currentPlayer), topo);
    }
    expect(stateFingerprint(local)).toBe(fp);
    expect(local.rngState).toBe(room.state.rngState);
  });
});
