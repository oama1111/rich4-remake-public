/*
 * 联机：研究所研發清单（第十九份試玩回報「为什么研究所修好了还没有自动呼出研究清单」，联机现场）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 现场（`20260924-105216869`）：研究所是**機器工人**在掷骰前蓋的 —— 原版那一支本来就不开面板
 *   （`0x44101d` 全 exe 唯一调用点是落点尾块 `0x0041b109`；機器工人 `0x00447295` 蓋完直接 `ret`）。
 * 这里钉住联机与单机同一条路：
 *   ① 真人座位用機器工人蓋研究所 ⇒ 服务器镜像里**没有** research 待决（与单机 `lab-after-build.test.ts` 同）；
 *   ② 真人停在自己的研究所上 ⇒ 镜像出 research 待决，**服务器不替他答**（`decideForCurrent` 为 null，
 *      `#driveComputers` 对真人座位收手），别的座位答不了，只有他自己的 `research` 被编号广播；
 *   ③ 客户端按广播重放 ⇒ 与服务器指纹逐条一致（研發清单那一屏读的就是这份 `pending`）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  FACILITY_TYPE,
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

/** 0 号真人（房主），其余电脑 —— 回报现场的座位 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/** 联机开局的局面上摆好：0 号的回合、那处設施归 0 号，等级 / 种类 / 站位按参数 */
function scene(
  map: Map0,
  opts: { phase: GameState['phase']; level: number; type: number; standOnFacility: boolean; robotWorker: boolean },
): { state: GameState; nodeId: number; fac: number } {
  const base = newGame({
    map,
    players: seats().map((s) => ({ character: s.character, kind: s.kind })),
    seed: 7,
    mode: 'multiplayer',
  });
  const facNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'facility');
  if (facNode === undefined || facNode.ref.kind !== 'facility') throw new Error('地图里找不到設施格');
  const fac = facNode.ref.index;
  const elsewhere = map.nodes.find((n) => n.id !== facNode.id && n.specialKind === 0)!.id;
  const facilityOwner = [...base.facilityOwner];
  const facilityLevel = [...base.facilityLevel];
  const facilityType = [...base.facilityType];
  facilityOwner[fac] = 1;
  facilityLevel[fac] = opts.level;
  facilityType[fac] = opts.type;
  const tools = [...base.tools];
  if (opts.robotWorker) tools[9] = 1; // 道具表下标 = 玩家×15 + 道具号
  const state: GameState = {
    ...base,
    currentPlayer: 0,
    phase: opts.phase,
    pending: null,
    stepsRemaining: 0,
    facilityOwner,
    facilityLevel,
    facilityType,
    tools,
    players: base.players.map((p, i) =>
      i === 0 ? { ...p, nodeId: opts.standOnFacility ? facNode.id : elsewhere, cash: 500_000, moneyInBank: 0 } : p,
    ),
  };
  return { state, nodeId: facNode.id, fac };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'LABMP1',
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

describe('★★ 联机：研究所研發清单与单机同一条路', () => {
  run('★ ① 真人座位用機器工人蓋研究所 ⇒ 镜像里没有 research 待决（原版 `0x00447295` 不开面板）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const { state, nodeId, fac } = scene(map, {
      phase: 'awaitingRoll',
      level: 0,
      type: 0,
      standOnFacility: false,
      robotWorker: true,
    });
    const room = roomFrom(map, state);
    const mirror = { s: state };
    const r = submitBoth(room, mirror, topo, 0, { type: 'useTool', toolId: 9, nodeId, value: FACILITY_TYPE.lab });
    expect(r.ok).toBe(true);
    expect(room.state.facilityType[fac]).toBe(FACILITY_TYPE.lab);
    expect(room.state.facilityLevel[fac]).toBe(1);
    expect(room.state.pending).toBeNull();
    expect(room.state.phase).toBe('awaitingRoll');
  });

  run('★ ② 真人停在自己的研究所上 ⇒ research 待决等他自己答；服务器不代答、别的座位答不了', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const { state, fac } = scene(map, {
      phase: 'settling',
      level: 5, // 满级：没有加蓋那一问，落点尾块直接到研究所面板
      type: FACILITY_TYPE.lab,
      standOnFacility: true,
      robotWorker: false,
    });
    const room = roomFrom(map, state);
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
    expect(room.state.pending).toMatchObject({ kind: 'research', facilityId: fac, level: 5 });
    expect(room.actingSeat).toBe(0);
    // ★ 服务器的「替电脑走」拿不出主意 ⇒ `#driveComputers` 在真人座位上收手，不会把面板自动关掉
    expect(room.decideForCurrent()).toBeNull();
    // 别的座位替他选 ⇒ 拒（不占序号）
    const before = room.sequenceLength;
    expect(room.submit(1, { type: 'research', facilityId: fac, project: 3 }).ok).toBe(false);
    expect(room.sequenceLength).toBe(before);
    // 他自己选 ⇒ 编号广播，客户端重放一致
    expect(submitBoth(room, mirror, topo, 0, { type: 'research', facilityId: fac, project: 3 }).ok).toBe(true);
    expect(room.state.pending).toBeNull();
    expect(room.state.facilityResearchProject[fac]).toBe(3);
  });
});
