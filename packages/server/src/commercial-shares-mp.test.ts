/*
 * 联机：电脑踩上市企業认购几股 —— pt27 回报 `20260925-030023875`「忍太郎怎么一下就买了3000股保险公司？」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 重放结论：第 27 回合忍太郎（P3，电脑）落在中國人壽（單價 28、餘量 3000），現金 188000，
 * 服务器替它答 `buyShares 3000` —— 那是自拟策略「现金一半 ÷ 單價、只夹企業餘量」。
 * 原版（`fcn_0041d1a9`）：`0x0041d20a..0x0041d21d` 把上限夹成 `min(1000, 現金÷單價, 餘量)` 放进 esi，
 * 这在 `0x0041d22a cmp byte [p+0x15],1` 真人/电脑分叉**之前**；电脑那支
 * `0x0041d267 push esi / push ecx / call 0x41d839` 拿它当上限，再扣 trunc(開局×0.30)×物價 的安全垫
 * ⇒ 这一格原版只买 **1000 股**。从企業认购（`0x428d2a` 末参 0 那支）不动股价、不动可成交量。
 *
 * 联机与单机同一条路：服务器 `decideForCurrent()` 与单机 `decideAction` 是同一个函数；
 * 客户端按广播重放逐条指纹一致。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  decideAction,
  emptyOwnership,
  updateCommercialOwner,
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

function scene(map: Map0, mode: 'single' | 'multiplayer', cash: number): GameState {
  const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 7, mode });
  const node = map.nodes.find((n) => n.ref.kind === 'commercial' && n.specialKind === 0)!;
  const c = map.commercials.find((x) => node.ref.kind === 'commercial' && x.id === node.ref.index)!;
  const commercialShares = [...s0.commercialShares];
  commercialShares[c.id] = 3000; // 回报现场的餘量
  // 0 号真人先持 2694 股（回报现场）——电脑买 1000 股不该把董事長抢走
  const holdings = s0.holdings.map((row, i) =>
    i === 0 ? row.map((h, j) => (j === c.stockIndex ? { amount: 2694, avgCost: 30 } : h)) : row,
  );
  const commercialOwners = [...s0.commercialOwners];
  commercialOwners[c.id] = updateCommercialOwner(emptyOwnership(), 0, (i) => (i === 0 ? 2694 : 0)).ownership;
  expect(commercialOwners[c.id]!.owner).toBe(1);
  return {
    ...s0,
    commercialOwners,
    day: 5,
    currentPlayer: 3,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    commercialShares,
    holdings,
    players: s0.players.map((p, i) => ({
      ...p,
      whoPlays: p.landingWhoPlays ?? p.whoPlays,
      ...(i === 3 ? { nodeId: node.id, cash } : {}),
    })),
  };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'SHRMP',
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

describe('★★ pt27：电脑认购上市企業股份 —— 一次最多 1000 股，联机与单机同一条路', () => {
  run('★ 現金 188000、餘量 3000 ⇒ 服务器替电脑答 1000 股；旁观端重放一致；单机同结果；股价 / 可成交量不动', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const cash = 188_000;
    const state = scene(map, 'multiplayer', cash);
    const room = roomFrom(map, state);
    let mirror = state;
    const submit = (action: Action) => {
      const r = room.submit(3, action);
      expect(r.ok).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    };
    submit({ type: 'settle' });
    const p = room.state.pending;
    if (p === null || p.kind !== 'buyShares') throw new Error('没拿到待决交互');
    expect(p.max).toBe(1000);
    const ai = room.decideForCurrent();
    expect(ai).toEqual({ type: 'buyShares', shares: 1000 });
    const before = room.state;
    submit(ai!);
    const after = room.state;
    expect(after.holdings[3]![p.stock]!.amount).toBe(1000);
    expect(after.commercialShares[p.commercialId]).toBe(2000);
    // 踩的是 0 号的企業，先付了費（`0x41b022`）—— 认购从付完费的現金里扣
    expect(after.players[3]!.cash).toBe(p.cash - 1000 * p.unitPrice);
    // `0x428d2a` 末参 0（从企業买）：只扣企業餘量 `[+0x30]`，股价 / 流通 / 可成交量一概不动
    expect(after.market.stocks[p.stock]).toEqual(before.market.stocks[p.stock]);
    // 1000 < 2694 ⇒ 不易主、不弹「獲得經營權」
    expect(after.notices).toEqual(before.notices);
    expect(after.commercialOwners[p.commercialId]!.owner).toBe(1);

    // 单机：同一个局面、同一套 AI ⇒ 同一个答案、同一个结果
    const single0 = reduce(scene(map, 'single', cash), { type: 'settle' }, topo);
    const aiSingle = decideAction({ state: single0, map });
    expect(aiSingle).toEqual(ai);
    const single = reduce(single0, aiSingle!, topo);
    expect(single.holdings).toEqual(after.holdings);
    expect(single.commercialShares).toEqual(after.commercialShares);
    expect(single.players[3]!.cash).toBe(after.players[3]!.cash);
  });

  run('★ 旧客户端 / 手写的 3000 股会被服务器拒（上限 max 在 reducer 里）', () => {
    const map = loadMap();
    const state = scene(map, 'multiplayer', 188_000);
    const room = roomFrom(map, state);
    expect(room.submit(3, { type: 'settle' }).ok).toBe(true);
    const fp = room.fingerprint;
    const r = room.submit(3, { type: 'buyShares', shares: 3000 });
    // 被 reduce 拒收 = 局面不变（服务器可能不广播，也可能作为空操作广播；两种都不许改局面）
    expect(room.fingerprint).toBe(fp);
    expect(room.state.pending?.kind).toBe('buyShares');
    void r;
  });
});
