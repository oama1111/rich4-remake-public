/*
 * 联机：七彩氣球小游戏（第二十一份試玩回報「打气球时鼠标指针没换成瞄准镜……」，联机第 12 回合）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 玩法（准星、气球、「?」效果）全在客户端屏里跑，**只有分数**以 `{type:'minigame', score}` 进 core
 * （`minigame-screen.ts` 的 `finish`）。这里钉住联机与单机同一条路：
 *   ① 真人停在七彩氣球格 ⇒ 服务器镜像挂出 `pending{minigame, game: 7}`，**服务器不替他答**
 *      （`decideForCurrent` 为 null）；旁观座位送的分一律拒（不占序号）—— 客户端旁观端本来就不送；
 *   ② 他自己送的分编号广播，客户端照广播重放，指纹逐条一致；點券 += 分数（@source 0x004155ec 之后的
 *      `add word [player + 0x30], ax`）；
 *   ③ 单机（不经服务器）同一条 action 落到同一份状态。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
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

/** 0、1 号真人（回报现场是房主 + 电脑；多加一个真人座位来验「旁观端送不了分」）*/
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({
    seat: i,
    name: `P${i}`,
    character: i,
    kind: i <= 1 ? ('human' as const) : ('computer' as const),
  }));

/** 0 号站在七彩氣球格上、等落点结算 */
function scene(map: Map0, mode: 'multiplayer' | 'single'): GameState {
  const base = newGame({
    map,
    players: seats().map((s) => ({ character: s.character, kind: s.kind })),
    seed: 12,
    ...(mode === 'multiplayer' ? { mode: 'multiplayer' as const } : {}),
  });
  const node = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BALLOON);
  if (node === undefined) throw new Error('地图里找不到七彩氣球格');
  return {
    ...base,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: base.players.map((p, i) => (i === 0 ? { ...p, nodeId: node.id, points: 100 } : p)),
  };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'BALLMP',
    map,
    globalMapId: 0,
    seed: 12,
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

describe('★★ 联机：七彩氣球只收玩家本人的分，镜像与服务器一致', () => {
  run('★ ① 落点挂出小游戏待决；服务器不代答；旁观座位送分被拒', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const room = roomFrom(map, scene(map, 'multiplayer'));
    const mirror = { s: room.state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
    expect(room.state.pending).toMatchObject({ kind: 'minigame', game: SPECIAL_KIND.BALLOON });
    expect(room.actingSeat).toBe(0);
    expect(room.decideForCurrent()).toBeNull();
    const before = room.sequenceLength;
    expect(room.submit(1, { type: 'minigame', score: 999 }).ok).toBe(false);
    expect(room.sequenceLength).toBe(before);
    expect(room.state.pending?.kind).toBe('minigame');
  });

  run('★ ② 玩家本人送的分：编号广播、點券 += 分数、指纹一致；③ 单机同一条 action 落到同一份状态', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const room = roomFrom(map, scene(map, 'multiplayer'));
    const mirror = { s: room.state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
    expect(submitBoth(room, mirror, topo, 0, { type: 'minigame', score: 37 }).ok).toBe(true);
    expect(room.state.pending).toBeNull();
    expect(room.state.phase).toBe('turnEnd');
    expect(room.state.players[0]?.points).toBe(137);
    // 玩过的那一支不掷随机数、不出「得點券」框（分数由小游戏屏自己亮 2 秒）
    expect(room.state.notices ?? []).not.toContainEqual(expect.objectContaining({ key: 'points.minigame' }));

    // ③ 单机：同样的起点、同样两条 action
    let solo = scene(map, 'single');
    solo = reduce(solo, { type: 'settle' }, topo);
    expect(solo.pending).toMatchObject({ kind: 'minigame', game: SPECIAL_KIND.BALLOON });
    solo = reduce(solo, { type: 'minigame', score: 37 }, topo);
    expect(solo.players[0]?.points).toBe(137);
    expect(solo.phase).toBe('turnEnd');
    expect(solo.rngState).toBe(mirror.s.rngState);
  });
});
