/*
 * 联机镜像：傳送機（道具 11）真人的**两段拾取**（`5256fa6`）—— 服务器与客户端走同一个 core
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `5256fa6` 把真人那一支改成原版的两次拾取：第一段选**来源**
 * （`0x00447469 push 0x1200036`，类别 0x36 = 地塊 | 設施 | 棋子 | 物件，组字节 0 = **不看归属**），
 * 第二段选**目标**（地塊 `0x2090802` / 設施 `0x2090804` / 一格 `0x2090001`）。
 * 两段的编码就是拾取器返回的那个 int（`rules/teleport.ts` 的 `decodeTeleportSource` / `decodeTeleport`）：
 *
 * - `0x7d0 + 地塊 id` / `0xfa0 + 設施 id`；
 * - `0x8000 | (1 << 玩家下标)`，`0x8000 | (1 << actor)`（actor 4..7 = 小偷 / 強盜 / 流氓 / 間諜）；
 * - `0x8000 | ((物件槽 + 1) << 8)`；**附身中**的物件 ⇒ 解成它的附身者（`0x00447495`）。
 *
 * 这一改动会改状态，按 `wt28/AUDIT.md` 的口径必须补一条联机镜像：服务器只跑**同一份** `reduce`，
 * 每一条合法编码都要与本地重放同一条（`stateFingerprint` 相同 **且**逐字段深比相同 —— 理由见 `applyMirror`）；
 * 非法编码则连同一条都不进日志、两边都不动。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  ACTOR_MIN,
  ACTOR_PLACE,
  LOBBY_DEFAULT_OPTIONS,
  TELEPORT_LAND_BASE,
  TELEPORT_SPRITE,
  TOOL_SLOTS_PER_PLAYER,
  TOOL_TELEPORTER,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_HUMAN,
  actorActive,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  toolCount,
  type Action,
  type GameState,
  type MapTopology,
  type SeatInfo,
} from '@rich4/core';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
/** 与客户端 `main.ts` 的 topo 同形（多一个 `landscapes`，服务器那份没有 —— 这个道具两处都不读它） */
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes });

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((character, i) => ({ seat: i, name: `P${i}`, character, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/**
 * 本图（`extracted/map/0001.bin`）里用得到的几处，每条都在用例里先断言一遍，
 * 免得换了图之后测试悄悄空过：
 * - 节点 5 / 20：空着的路面，都有邻格（`pickFacingAt` 要挑朝向）；
 * - 节点 39 = 地塊 #1、节点 40 = 地塊 #2（`ref.index` 就是 `landOwner` 的下标）；
 * - 节点 10：开局就摆着一件地上的物件（物件槽 0，type 1 神明）。
 */
const NODE_A = 5;
const NODE_B = 20;
const LAND_1 = 1;
const LAND_2 = 2;

/** 每个局面都要有的三件事：轮到 0 号（真人）、按 GO 之前、手里有一台傳送機 */
function armed(s: GameState): GameState {
  const tools = [...s.tools];
  tools[0 * TOOL_SLOTS_PER_PLAYER + TOOL_TELEPORTER] = 1;
  return { ...s, currentPlayer: 0, phase: 'awaitingRoll', pending: null, tools };
}

function roomWith(id: string, patch: (s: GameState) => GameState = (s) => s) {
  const map = loadMap();
  const s0 = newGame({
    map,
    players: seats().map((x) => ({ character: x.character, kind: x.kind })),
    seed: 17,
    mode: 'multiplayer',
  });
  const base = armed(patch(s0));
  const room = new Room({
    id,
    map,
    globalMapId: 0,
    seed: 17,
    seats: seats(),
    options: LOBBY_DEFAULT_OPTIONS,
    base: { state: base, snapshot: '' },
  });
  room.start();
  return { room, base, topo: topoOf(map) };
}

/**
 * 提交 → 用**广播回来的同一条 action** 在本地重放 → 指纹必须与服务器一致。
 *
 * 先本地预演一遍并确认它**真的改了状态**：否则「指纹相同」可能只是双方都没动（空过）。
 *
 * ⚠️ 这里**不止**比指纹：`stateFingerprint` 只收 `players` 的 `index/cash/moneyInBank/loan/nodeId/whoPlays`
 *   （`protocol.ts`），**不收** `specialActors`（惡人整段都不在里面）、不收玩家的 `xpos/ypos/direction/lastNodeId`、
 *   也不收 `landTenure/landType/landLastToll` —— 而傳送機恰好会改这几样（搬惡人、挑朝向、搬到期日）。
 *   实测：把服务器那份地图的目标格挪 137 像素，`xpos` 1385 vs 1248、指纹却仍然相等。
 *   ⇒ 逐字段的 `toEqual(room.state, mirror)` 才是这一条真正的判据。
 */
function applyMirror(room: Room, base: GameState, topo: MapTopology, action: Action): GameState | null {
  expect(reduce(base, action, topo)).not.toBe(base);
  const r = room.submit(0, action);
  expect(r.ok).toBe(true);
  if (!r.ok) return null;
  const mirror = reduce(base, r.broadcast.action, topo);
  expect(stateFingerprint(mirror)).toBe(room.fingerprint);
  expect(room.fingerprint).not.toBe(stateFingerprint(base)); // 服务器那边**真的**往前走了
  expect(room.state).toEqual(mirror); // 指纹盖不到的那几样（惡人 / 坐标 / 到期日）也逐字段对上
  return mirror;
}

/** 拒收：本地什么也不改、服务器不收、日志里不留痕、道具还在手上 */
function applyRejected(room: Room, base: GameState, topo: MapTopology, action: Action): void {
  expect(reduce(base, action, topo)).toBe(base);
  const before = room.fingerprint;
  const r = room.submit(0, action);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.reason).toBe('illegalAction');
  expect(room.sequenceLength).toBe(0); // 编号在校验通过之后才分配 ⇒ 非法 action 不进日志
  expect(room.fingerprint).toBe(before);
  expect(toolCount(room.state.tools, 0, TOOL_TELEPORTER)).toBe(1);
}

describe('★★ 联机：傳送機（11）真人两段拾取（5256fa6）在服务器与镜像上是同一条', () => {
  run('① 搬自己（来源 = 棋子码 0x8001）⇒ 换格 + 进停步结算；指纹相同', () => {
    const { room, base, topo } = roomWith('TPA');
    // 开局 0 号就上了盘（这张图的起点 24），而且 `whoPlays` = 真人 ——
    // 「目标格必须是空路面」那道闸（`0x409bc0`）只对真人开，这条用例要真的走到它
    expect(base.players[0]!.nodeId).toBe(24);
    expect(base.players[0]!.whoPlays & 0xff).toBe(WHO_PLAYS_HUMAN);
    const mirror = applyMirror(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_SPRITE | (1 << 0),
      value: NODE_B,
    });
    if (mirror === null) return;
    // 换格 + 换坐标 / 朝向
    const node = topo.nodes[NODE_B - 1]!;
    expect(mirror.players[0]!.nodeId).toBe(NODE_B);
    expect(mirror.players[0]!.xpos).toBe(node.x);
    expect(mirror.players[0]!.ypos).toBe(node.y);
    expect(mirror.players[0]!.nodeId).not.toBe(base.players[0]!.nodeId);
    // 搬**自己**：先拍時光機快照、剩余步数清 0、直接进停步结算（`0x004477c3..0x004477d6`）
    expect(mirror.snapshots[0]).toBeTruthy();
    expect(mirror.stepsRemaining).toBe(0);
    expect(mirror.phase).toBe('settling');
    expect(toolCount(mirror.tools, 0, TOOL_TELEPORTER)).toBe(0);
    expect(room.state.players[0]).toEqual(mirror.players[0]);
    expect(room.state.snapshots[0]).toEqual(mirror.snapshots[0]);
  });

  run('② 搬惡人（actor 4 = 小偷，来源 0x8010）⇒ 惡人换格；指纹相同', () => {
    const { room, base, topo } = roomWith('TPB', (s) => ({
      ...s,
      specialActors: s.specialActors.map((a, i) =>
        i === 0 ? { ...a, nodeId: NODE_A, lastNodeId: 0, direction: 0, place: ACTOR_PLACE.board } : a,
      ),
    }));
    expect(base.specialActors[0]!.nodeId).toBe(NODE_A);
    expect(actorActive(base.specialActors[0])).toBe(true); // 在棋盘上才搬得动
    const mirror = applyMirror(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_SPRITE | (1 << ACTOR_MIN), // actor 4
      value: NODE_B,
    });
    if (mirror === null) return;
    expect(mirror.specialActors[0]!.nodeId).toBe(NODE_B);
    expect(mirror.specialActors[0]!.nodeId).not.toBe(NODE_A);
    // 另外三个惡人（強盜 / 流氓 / 間諜）一个都没动
    expect(mirror.specialActors.slice(1)).toEqual(base.specialActors.slice(1));
    expect(room.state.specialActors).toEqual(mirror.specialActors);
    // 施法者自己没动
    expect(mirror.players[0]!.nodeId).toBe(24);
    expect(toolCount(mirror.tools, 0, TOOL_TELEPORTER)).toBe(0);
  });

  run('③ 搬地上的物件（神明槽 0，来源 0x8100）⇒ 物件换格、种类/状态不动；指纹相同', () => {
    const { room, base, topo } = roomWith('TPC');
    const slot = 0;
    expect(base.objects[slot]!.nodeId).toBe(10); // 开局就摆在地上
    expect(base.objects[slot]!.attached).toBe(0);
    const mirror = applyMirror(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_SPRITE | ((slot + 1) << 8),
      value: NODE_B,
    });
    if (mirror === null) return;
    expect(mirror.objects[slot]!.nodeId).toBe(NODE_B);
    // 只是换格：种类 / 状态 / 附身者一个都不动
    expect(mirror.objects[slot]).toEqual({ ...base.objects[slot]!, nodeId: NODE_B });
    expect(room.state.objects[slot]).toEqual(mirror.objects[slot]);
    expect(toolCount(mirror.tools, 0, TOOL_TELEPORTER)).toBe(0);
  });

  run('④ 點到附身中的物件（同一个物件码）⇒ 搬的是附身者，神明跟着走；指纹相同', () => {
    const CARRIER = 11;
    const { room, base, topo } = roomWith('TPD', (s) => ({
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, whoPlays: WHO_PLAYS_COMPUTER, nodeId: CARRIER, direction: 0, godInfo: 1 } : p,
      ),
      objects: s.objects.map((o, i) => (i === 0 ? { ...o, nodeId: CARRIER, attached: 2 } : o)),
    }));
    expect(base.objects[0]!.attached).toBe(2); // 附身者 = 玩家下标 1（`attached` = 下标 + 1）
    expect(base.players[1]!.godInfo).toBe(1); // 身上的神明 = 物件槽 0（`godInfo` = 下标 + 1）
    const mirror = applyMirror(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_SPRITE | ((0 + 1) << 8),
      value: NODE_B,
    });
    if (mirror === null) return;
    // 搬的是**人**（不是把神明当地上物件搬）
    expect(mirror.players[1]!.nodeId).toBe(NODE_B);
    expect(mirror.players[1]!.nodeId).not.toBe(CARRIER);
    // 神明跟着附身者搬（`0x00447844 call 0x40fc00` = `syncEscortNodes`）
    expect(mirror.objects[0]!.nodeId).toBe(NODE_B);
    expect(mirror.players[0]!.nodeId).toBe(24); // 施法者没动
    expect(room.state.players[1]).toEqual(mirror.players[1]);
    expect(room.state.objects[0]).toEqual(mirror.objects[0]);
    expect(toolCount(mirror.tools, 0, TOOL_TELEPORTER)).toBe(0);
  });

  run('⑤ 地產 → 地產（两段都用地塊码）⇒ 整块地搬家、源头清零；指纹相同', () => {
    const { room, base, topo } = roomWith('TPE', (s) => {
      const landOwner = [...s.landOwner];
      const landLevel = [...s.landLevel];
      const landType = [...s.landType];
      const landTenure = [...s.landTenure];
      const landLastToll = [...s.landLastToll];
      landOwner[LAND_1] = 1;
      landLevel[LAND_1] = 3;
      landType[LAND_1] = 1; // 非 0 = 连锁店（`land.h` +0x18）—— 用一个非 0 值才验证得了「type 也搬」
      landTenure[LAND_1] = 777;
      landLastToll[LAND_1] = 55;
      landLastToll[LAND_2] = 300; // 新址原来那笔：搬过来之后**保持原样**（`0x0044760f` 只清源）
      return { ...s, landOwner, landLevel, landType, landTenure, landLastToll };
    });
    expect(topo.nodes[38]!.ref).toEqual({ kind: 'land', index: LAND_1 }); // 节点 39 = 地塊 #1
    expect(topo.nodes[39]!.ref).toEqual({ kind: 'land', index: LAND_2 }); // 节点 40 = 地塊 #2
    const mirror = applyMirror(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_LAND_BASE + LAND_1,
      value: TELEPORT_LAND_BASE + LAND_2,
    });
    if (mirror === null) return;
    // 归属 / 等级 / 种类 / 到期日整块搬走
    expect(mirror.landOwner[LAND_2]).toBe(1);
    expect(mirror.landLevel[LAND_2]).toBe(3);
    expect(mirror.landType[LAND_2]).toBe(1);
    expect(mirror.landTenure[LAND_2]).toBe(777);
    expect(mirror.landLastToll[LAND_2]).toBe(300);
    // 源头清零
    expect(mirror.landOwner[LAND_1]).toBe(0);
    expect(mirror.landLevel[LAND_1]).toBe(0);
    expect(mirror.landType[LAND_1]).toBe(0);
    expect(mirror.landTenure[LAND_1]).toBe(0);
    expect(mirror.landLastToll[LAND_1]).toBe(0);
    expect(room.state.landOwner).toEqual(mirror.landOwner);
    expect(room.state.landLevel).toEqual(mirror.landLevel);
    expect(room.state.landType).toEqual(mirror.landType);
    expect(room.state.landTenure).toEqual(mirror.landTenure);
    expect(room.state.landLastToll).toEqual(mirror.landLastToll);
    expect(toolCount(mirror.tools, 0, TOOL_TELEPORTER)).toBe(0);
  });

  run('⑥ 目标格有人站着 ⇒ 服务器拒收（真人那道 `0x409bc0`），双方都不动', () => {
    const { room, base, topo } = roomWith('TPF', (s) => ({
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, whoPlays: WHO_PLAYS_COMPUTER, nodeId: NODE_B } : p,
      ),
    }));
    expect(base.players[1]!.nodeId).toBe(NODE_B);
    applyRejected(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_SPRITE | (1 << 0),
      value: NODE_B,
    });
    expect(room.state.players[0]!.nodeId).toBe(24);
    expect(room.state.players[1]!.nodeId).toBe(NODE_B);
  });

  run('⑦ 源拾不到（物件槽 1 不在地图上）⇒ 服务器拒收，双方都不动', () => {
    const { room, base, topo } = roomWith('TPG');
    const slot = 1;
    expect(base.objects[slot]!.nodeId).toBe(0); // 空槽：拾取器根本不会列它（`at(o.nodeId)` 是 undefined）
    applyRejected(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_SPRITE | ((slot + 1) << 8),
      value: NODE_B,
    });
    expect(room.state.objects[slot]!.nodeId).toBe(0);
  });

  run('⑧ 地產目标不是「无主 0 级」⇒ 服务器拒收（`0x0044658c` 子类 8），双方都不动', () => {
    const { room, base, topo } = roomWith('TPH', (s) => {
      const landOwner = [...s.landOwner];
      landOwner[LAND_1] = 1;
      landOwner[LAND_2] = 2;
      return { ...s, landOwner };
    });
    applyRejected(room, base, topo, {
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: TELEPORT_LAND_BASE + LAND_1,
      value: TELEPORT_LAND_BASE + LAND_2,
    });
    expect(room.state.landOwner[LAND_1]).toBe(1);
    expect(room.state.landOwner[LAND_2]).toBe(2);
  });
});
