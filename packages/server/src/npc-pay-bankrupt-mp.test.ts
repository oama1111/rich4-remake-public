/*
 * 联机镜像：FU-6 —— 強盜踩銀行把人**抢到破产**（破产在 `pay_money` 里当场发生）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `pay_money` VA 0x0041d2c6：`0x0041d375 push esi / call 0x40cd87` ——
 *   两个口袋都掏空的那一刻就破产（搭档挑格 `0x40e297` / 下線拍卖 `0x40d1f7` 都要 `rand()`），
 *   收款方 `0x0041d37e` 之后才入账。強盜抢银行那圈（`0x0041c34f..0x0041c3ab`）是**逐个**叫的
 *   （`0x0041c39b`），所以被抢破产的那位在**那一格**就出局了：同一趟后面几步的
 *   `0x0041c35a` / `0x0041c1d6` 两处 `cmp byte [player+0x15],0` 都会跳过他，
 *   破产清算掷的随机数也排在后面几步的随机数之前。
 *
 * 这一改会**改随机数消耗次序与状态**，按 `wt28/AUDIT.md` 的口径补一条联机镜像：
 * 服务器只跑同一份 `reduce`，两端必须逐字段相同（`stateFingerprint` 相同 **且**深比相同 ——
 * 理由见 `teleport-mp.test.ts`：指纹不收 `specialActors` / `objects` 的落点等字段）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
  isAlive,
  landAll,
  newGame,
  parseMap,
  reduce,
  releaseNpc,
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

/** 0/1 真人、2/3 电脑 —— 破产拍卖的 AI 心理价位（`0x439f0d` 每家掷两次）也跟着走一遍 */
const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i < 2 ? ('human' as const) : ('computer' as const) }));

function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

describe('★★ 联机：強盜抢银行把人抢破产（FU-6，0x0041d375 当场破产）', () => {
  run('銀行门口起步 → 那一格就把人抢破产：服务器与镜像逐字段相同', () => {
    const map = loadMap();
    const topo = topoOf(map);
    // 全图只有一格銀行（19 号），它的两个邻居 56 / 57 度都为 2
    const bank = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BANK)!;
    const [a, b] = bank.adjacent as [number, number];
    const base = landAll(
      newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 21, mode: 'multiplayer' }),
      map.nodes,
    );
    const specialActors = base.specialActors.map((x) => ({ ...x }));
    // 強盜（槽 1 = actor 5）站在 a、来路 = b ⇒ 第一步的候选只有銀行那一格（确定）
    specialActors[1] = { ...releaseNpc(a, 0, 0), lastNodeId: b };
    // 1 号：存款为负（两成 = 负数 ⇒ 两个口袋掏空也付不出）、身上背着小財神（离身要给搭档挑格）、
    //      名下 4 处地产（> 3 ⇒ 破产清算当场挑 3 处开拍，挑签要 rand）
    const landOwner = base.landOwner.map((v, i) => (i < 4 ? 2 : v));
    const objects = base.objects.map((o, i) => (i === 0 ? { ...o, nodeId: base.players[1]!.nodeId, state: 7, attached: 2 } : o));
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'turnEnd',
      pending: null,
      pendingNpcSlots: [1],
      specialActors,
      landOwner,
      objects,
      players: base.players.map((p, i) => (i === 1 ? { ...p, moneyInBank: -50, cash: 10, godInfo: 1 } : p)),
    };
    const room = new Room({ id: 'FUBK1', map, globalMapId: 0, seed: 21, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };

    expect(submitBoth(room, mirror, topo, room.actingSeat, { type: 'npcStep' }).ok).toBe(true);

    // 这一趟确实踩到了銀行格（第 1 步 = 19），破产就是在那儿发生的
    const walk = room.state.lastNpcWalks[0]!;
    expect(walk.slot).toBe(1);
    expect(walk.path[0]).toBe(a);
    expect(walk.path[1]).toBe(bank.id);

    // 1 号当场出局、地产全部释放、`+0x3f` 上的小財神被收走（搭档登场）
    expect(isAlive(room.state.players[1]!)).toBe(false);
    expect(room.state.players[1]!.godInfo).toBe(0);
    expect(room.state.landOwner.filter((v) => v === 2)).toEqual([]);
    // 破产清算的下線拍卖当场挂上（> 3 处 ⇒ 挑 3 场）—— 走完这一趟时它已经在了
    expect(room.state.pending !== null || room.state.pendingQueue.length > 0).toBe(true);

    // 指纹之外再逐字段深比一遍（恶人走位 / 物件落点 / 随机流都不在指纹里或不在同一栏）
    expect(mirror.s.specialActors).toEqual(room.state.specialActors);
    expect(mirror.s.objects).toEqual(room.state.objects);
    expect(mirror.s.rngState).toBe(room.state.rngState);
    expect(mirror.s.pendingQueue).toEqual(room.state.pendingQueue);
    expect(mirror.s.pending).toEqual(room.state.pending);
    expect(mirror.s.players.map((p) => p.cards)).toEqual(room.state.players.map((p) => p.cards));
  });

  run('★ 抢破产之后同一趟再停到那个人身上也不夺卡（0x0041c1d6 看 who_plays）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const bank = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BANK)!;
    const [a, b] = bank.adjacent as [number, number];
    const base = landAll(
      newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 21, mode: 'multiplayer' }),
      map.nodes,
    );
    const specialActors = base.specialActors.map((x) => ({ ...x }));
    specialActors[1] = { ...releaseNpc(a, 0, 0), lastNodeId: b };
    // 1 号站在強盜**撞完银行之后**会走到的那一格（a / b 都是銀行邻居，踩完银行必到另一格）
    const next = bank.adjacent.find((n) => n !== a) ?? b;
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'turnEnd',
      pending: null,
      pendingNpcSlots: [1],
      specialActors,
      players: base.players.map((p, i) =>
        i === 1 ? { ...p, nodeId: next, moneyInBank: -50, cash: 10, cards: [3, 5, 7] } : p,
      ),
    };
    const room = new Room({ id: 'FUBK2', map, globalMapId: 0, seed: 21, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
    room.start();
    const mirror = { s: state };

    expect(submitBoth(room, mirror, topo, room.actingSeat, { type: 'npcStep' }).ok).toBe(true);
    // 出局 ⇒ 那一格上的他不被夺卡：他的牌一张都没到主人手上
    expect(isAlive(room.state.players[1]!)).toBe(false);
    expect(room.state.players[0]!.cards.filter((c) => [3, 5, 7].includes(c))).toEqual([]);
    expect(mirror.s.players.map((p) => p.cards)).toEqual(room.state.players.map((p) => p.cards));
  });
});
