/*
 * 联机：真人从工具列开 / 关公佈欄 —— 进门清理（`0x42483e`）与收尾收回特別融資（`0x436b0a(0)`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版工具列第 10 颗（`0x00417dee call 0x4284be`）与电脑调度步（`0x00418e13`）进的是**同一个函数**：
 * `0x004284c5 call 0x42483e` 先撤掉挂着却已不归挂牌人的东西，窗关上后 `0x0042885c push 0 / call 0x436b0a`
 * 把「不是銀行董事長却欠着特別融資」的人当场收回。本引擎把这两步做成 `noticeBoard` 的 `open` / `close`，
 * 由开窗那一端（回合主人）提交、服务器定序、各端按广播重放 —— 与单机同一个 reducer。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  LISTING,
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

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/** 0 号（真人）回合；0 号栏里挂着一张手上已没有的卡 5 与手上有的卡 3；1 号欠特別融資 4000、没有銀行董事長 */
function scene(map: Map0, mode: 'single' | 'multiplayer'): GameState {
  const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 7, mode });
  const col = (ids: number[]) =>
    [...ids.map((id) => ({ kind: LISTING.card, id, price: 100, amount: 0 })), null, null, null, null, null, null, null].slice(0, 7);
  return {
    ...s0,
    currentPlayer: 0,
    phase: 'awaitingRoll',
    pending: null,
    noticeBoard: s0.noticeBoard.map((c, i) => (i === 0 ? col([5, 3]) : c)),
    players: s0.players.map((p, i) => ({
      ...p,
      whoPlays: p.landingWhoPlays ?? p.whoPlays,
      ...(i === 0 ? { cards: [3] } : {}),
      ...(i === 1 ? { moneyInBank: 10_000, specialFinance: 4000 } : {}),
    })),
  };
}

describe('★ 真人开 / 关公佈欄：进门清理 + 收尾收回特別融資（0x42483e / 0x436b0a(0)），联机与单机同一条路', () => {
  run('开 ⇒ 撤掉卡 5；关 ⇒ 1 号的特別融資收回；服务器定序、旁观端重放一致；单机同结果', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = scene(map, 'multiplayer');
    const room = new Room({
      id: 'BOARD',
      map,
      globalMapId: 0,
      seed: 7,
      seats: seats(),
      options: LOBBY_DEFAULT_OPTIONS,
      base: { state, snapshot: '' },
    });
    room.start();
    let mirror = state;
    const submit = (action: Action) => {
      const r = room.submit(0, action);
      expect(r.ok, action.type).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
      expect(mirror.noticeBoard).toEqual(room.state.noticeBoard);
    };
    // 别人的座位不能替 0 号开窗
    expect(room.submit(1, { type: 'noticeBoard', op: 'open' }).ok).toBe(false);
    submit({ type: 'noticeBoard', op: 'open' });
    expect(room.state.noticeBoard[0]!.map((x) => x?.id ?? 0)).toEqual([3, 0, 0, 0, 0, 0, 0]);
    // 再开一次什么都不做 ⇒ 服务器拒（客户端只在会生效时才发）
    expect(room.submit(0, { type: 'noticeBoard', op: 'open' }).ok).toBe(false);
    submit({ type: 'noticeBoard', op: 'close' });
    expect(room.state.players[1]).toMatchObject({ specialFinance: 0, moneyInBank: 6000 });
    expect(room.state.notices.map((n) => n.key)).toEqual(['bank.chairmanChanged', 'bank.forcedSpecialRepay']);

    // 单机：同一局面、同两步 ⇒ 同结果
    let single = scene(map, 'single');
    single = reduce(single, { type: 'noticeBoard', op: 'open' }, topo);
    single = reduce(single, { type: 'noticeBoard', op: 'close' }, topo);
    expect(single.noticeBoard).toEqual(room.state.noticeBoard);
    expect(single.players).toEqual(room.state.players);
  });
});
