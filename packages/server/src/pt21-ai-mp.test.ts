/*
 * 联机：第二十一份試玩回報的三条（外星人镜头 / 背炸彈开车掷几颗 / 骑车照样用機器娃娃扫狗）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 三份回报都是联机现场（服务器替电脑座位出手 `#driveComputers` → `decideForCurrent`）。
 * 这里钉住联机与单机同一条路：服务器镜像出的 action / 状态，客户端按广播重放后逐条指纹一致。
 *
 *   ① `20260924-143640603`：新聞 4 爆心的镜头（`view_to(x, y, 2)` @ 0x0044921d）—— `lastViewTarget`
 *      是 core 在 `settle` 里写的，客户端重放同一条 action 得到同一个目标（纯表现，不进指纹）。
 *   ② `20260924-143945394`：电脑开汽車、背着引信 7 的定時炸彈 ⇒ 起步前 `setDiceCount(1)`
 *      （`fcn_004221c0` 0x00422202 `cmp 引信, 0xf / jl`），然后只掷 1 颗。
 *   ③ `20260924-144526993`：电脑骑機車、前方有惡犬 ⇒ **照样**用機器娃娃（原版判定 0x00420efa
 *      从不读 `+0x11`），与单机一致。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
  decideAction,
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

/** 0 号真人（房主），其余电脑 —— 三份回报的座位 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/**
 * 联机开局 + 把还没上盘的电脑直接落到 0 号那一格（开局惰性摆人见 `unplaced-start.test.ts`；
 * 这里只要一个「人人在盘上」的局面，落地同 `landAt`：`who_plays ← landingWhoPlays`）。
 */
const baseGame = (map: Map0): GameState => {
  const s = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 7, mode: 'multiplayer' });
  const home = s.players[0]!;
  return {
    ...s,
    players: s.players.map((p) =>
      p.whoPlays !== 0
        ? p
        : { ...p, whoPlays: p.landingWhoPlays ?? 0, nodeId: home.nodeId, lastNodeId: home.lastNodeId, xpos: home.xpos, ypos: home.ypos },
    ),
  };
};

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'PT21AI',
    map,
    globalMapId: 0,
    seed: 7,
    seats: seats(),
    options: LOBBY_DEFAULT_OPTIONS,
    base: { state, snapshot: '' },
  });
  room.start();
  return room;
}

/** 提交并在「客户端镜像」上照广播重放，逐条对指纹 */
function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

/** 定時炸彈的第一个物件槽（槽 36..45 = 类型 18）；惡犬 = 槽 10（类型 11） */
const BOMB_SLOT = 36;
const DOG_SLOT = 10;

describe('★★ 联机：第二十一份三条与单机同一条路', () => {
  run('★ ① 新聞 4：镜头移到爆心（`lastViewTarget`），服务器与客户端重放一致；踩新聞格的人不住院', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = baseGame(map);
    const news = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.NEWS)!;
    const far = map.lands.find((l) => Math.abs(l.x - news.x) > 300 && Math.abs(l.y - news.y) > 300)!;
    const state: GameState = {
      ...s0,
      currentPlayer: 0,
      phase: 'settling',
      pending: null,
      stepsRemaining: 0,
      players: s0.players.map((p) => ({ ...p, nodeId: news.id })),
      landOwner: s0.landOwner.map((o, i) => (i === far.id ? 3 : o)),
      landLevel: s0.landLevel.map((_, i) => (i === far.id ? 1 : 0)),
      facilityLevel: s0.facilityLevel.map(() => 0),
      newsDeck: { order: [4, ...s0.newsDeck.order.filter((x) => x !== 4)], cursor: 0 },
    };
    const room = roomFrom(map, state);
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
    expect(room.state.lastEvent).toMatchObject({ kind: 'news', id: 4 });
    expect(room.state.lastViewTarget).toEqual({ x: far.x, y: far.y });
    expect(mirror.s.lastViewTarget).toEqual({ x: far.x, y: far.y });
    for (const p of room.state.players) expect(p.blocking.inHospital).toBe(0);
  });

  run('★★ ② 电脑开汽車背引信 7 的炸彈：服务器先出 setDiceCount(1) 再掷，只掷 1 颗；客户端重放一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = baseGame(map);
    const objects = s0.objects.map((o) => ({ ...o }));
    objects[BOMB_SLOT]!.attached = 2;
    objects[BOMB_SLOT]!.state = 7;
    const state: GameState = {
      ...s0,
      currentPlayer: 1,
      phase: 'awaitingRoll',
      aiStep: 3,
      pending: null,
      objects,
      players: s0.players.map((p, i) => (i === 1 ? { ...p, trafficMethod: 2, ndices: 3, f64: BOMB_SLOT + 1 } : p)),
    };
    const room = roomFrom(map, state);
    const mirror = { s: state };
    const a1 = room.decideForCurrent();
    expect(a1).toEqual({ type: 'setDiceCount', count: 1 });
    // 单机同一个局面给出同一手
    expect(decideAction({ state, map })).toEqual(a1);
    expect(submitBoth(room, mirror, topo, 1, a1!).ok).toBe(true);
    expect(room.state.players[1]!.ndices).toBe(1);
    const a2 = room.decideForCurrent();
    expect(a2).toEqual({ type: 'rollDice' });
    expect(submitBoth(room, mirror, topo, 1, a2!).ok).toBe(true);
    expect(room.state.dice).toHaveLength(1);
    expect(mirror.s.dice).toEqual(room.state.dice);
  });

  run('★ ③ 电脑骑機車、前方有惡犬 ⇒ 服务器照样出 useTool(機器娃娃)（原版 0x00420efa 不看交通方式）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = baseGame(map);
    // 找一段 4 格都没有岔路的路（原版前瞻遇岔路就不用：0x00420f13 `jne 0x421078`）
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    let from = -1;
    let prev = -1;
    let dogAt = -1;
    outer: for (const n of map.nodes) {
      for (const p of n.adjacent) {
        let cur = n.id;
        let last = p;
        const path: number[] = [];
        let ok = true;
        for (let k = 0; k < 4; k++) {
          const c = byId.get(cur)!.adjacent.filter((x) => x !== last);
          if (c.length !== 1) {
            ok = false;
            break;
          }
          last = cur;
          cur = c[0]!;
          path.push(cur);
        }
        if (ok && path.every((x) => byId.get(x)!.walkable !== false)) {
          from = n.id;
          prev = p;
          dogAt = path[1]!;
          break outer;
        }
      }
    }
    expect(from).toBeGreaterThan(0);
    const objects = s0.objects.map((o, i) => ({ ...o, nodeId: i === DOG_SLOT ? dogAt : 0, attached: 0 }));
    const tools = s0.tools.map(() => 0);
    tools[3 * 15 + 1] = 1; // 道具表下标 = 玩家×15 + 道具号；1 = 機器娃娃
    const state: GameState = {
      ...s0,
      currentPlayer: 3,
      phase: 'awaitingRoll',
      aiStep: 2,
      aiBranch: 0,
      pending: null,
      objects,
      tools,
      players: s0.players.map((p, i) =>
        i === 3
          ? { ...p, nodeId: from, lastNodeId: prev, trafficMethod: 1, ndices: 2, f64: 0, aiFlags: 3, personality: 10 }
          : p,
      ),
    };
    const room = roomFrom(map, state);
    const mirror = { s: state };
    const a = room.decideForCurrent();
    expect(a).toEqual({ type: 'useTool', toolId: 1 });
    expect(decideAction({ state, map })).toEqual(a);
    expect(submitBoth(room, mirror, topo, 3, a!).ok).toBe(true);
    // 狗被扫掉了（物件离开棋盘）
    expect(room.state.objects[DOG_SLOT]!.nodeId).not.toBe(dogAt);
  });
});
