/*
 * 联机镜像：econ 审计（2026-09-24）改到的几条收费 / 破产规则，服务器与旁观端逐条一致
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 1. 过路费记敌意（`0x00419df3 call 0x40df69(当前玩家, 地主, 实付/100)`）—— 电脑踩真人的地；
 * 2. 真人全出局即收局（`0x0040d029 test esi, esi`）—— 1 真人 + 3 电脑，真人付不起过路费 ⇒ 当场 gameOver，
 *    清算跳过（先前继续清算、电脑自己打到底）。
 *
 * 服务器 `Room` 与单机走同一个 `reduce`；这里把广播逐条喂给镜像，指纹必须一路相等。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  actingSeat,
  makeGameState,
  makeLand,
  makeNode,
  makePlayer,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  WHO_PLAYS_COMPUTER,
  type Action,
  type GameState,
  type MapTopology,
  type Rich4Map,
  type SeatInfo,
  aiShopVisit,
} from '@rich4/core';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/** `payer` 站在 `owner` 的 2 级地上，结算前 */
function scene(map: Map0, mode: 'single' | 'multiplayer', payer: number, owner: number, payerCash: number): GameState {
  const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 11, mode });
  const node = map.nodes.find((n) => n.ref.kind === 'land' && n.specialKind === 0)!;
  if (node.ref.kind !== 'land') throw new Error('地图上没有地块格');
  const landIndex = node.ref.index;
  const landOwner = [...s0.landOwner];
  const landLevel = [...s0.landLevel];
  landOwner[landIndex] = owner + 1;
  landLevel[landIndex] = 2;
  return {
    ...s0,
    day: 5,
    currentPlayer: payer,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    landOwner,
    landLevel,
    players: s0.players.map((p, i) => ({
      ...p,
      whoPlays: p.landingWhoPlays ?? p.whoPlays,
      ...(i === payer ? { nodeId: node.id, cash: payerCash, moneyInBank: 0 } : {}),
    })),
  };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'ECOMP',
    map,
    globalMapId: 0,
    seed: 11,
    seats: seats(),
    options: LOBBY_DEFAULT_OPTIONS,
    base: { state, snapshot: '' },
  });
  room.start();
  return room;
}

describe('★ econ 审计：收费敌意 / 真人全出局收局 —— 联机与单机同一条路', () => {
  run('电脑 3 号踩真人 0 号的地：付过路费、记敌意；旁观端重放一致；单机同结果', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = scene(map, 'multiplayer', 3, 0, 500_000);
    const room = roomFrom(map, state);
    let mirror = state;
    const submit = (seat: number, action: Action) => {
      const r = room.submit(seat, action);
      expect(r.ok).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    };
    submit(3, { type: 'settle' });
    const paid = 500_000 - room.state.players[3]!.cash;
    expect(paid).toBeGreaterThan(0);
    expect(room.state.players[3]!.hostility[0]).toBe(Math.trunc(paid / 100));
    expect(mirror.players[3]!.hostility).toEqual(room.state.players[3]!.hostility);

    const single = reduce(scene(map, 'single', 3, 0, 500_000), { type: 'settle' }, topo);
    expect(single.players[3]!.hostility).toEqual(room.state.players[3]!.hostility);
    expect(single.players[3]!.cash).toBe(room.state.players[3]!.cash);
  });

  run('唯一的真人 0 号付不起电脑的过路费 ⇒ 当场收局（码 1 那条路），地产不清算；旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state = scene(map, 'multiplayer', 0, 2, 0);
    const room = roomFrom(map, state);
    let mirror = state;
    const r = room.submit(0, { type: 'settle' });
    expect(r.ok).toBe(true);
    if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.players[0]!.whoPlays).toBe(0);
    expect(room.state.phase).toBe('gameOver');
    expect(mirror.phase).toBe('gameOver');
    // 电脑 1..3 号都还在 —— 原版照样结束
    expect(room.state.players.filter((p, i) => i > 0 && p.whoPlays !== 0).length).toBe(3);

    const single = reduce(scene(map, 'single', 0, 2, 0), { type: 'settle' }, topo);
    expect(single.phase).toBe('gameOver');
  });

  run('15 日分紅按人加总：一家负一家正 ⇒ 电脑 1 号只进净额，不误判破产；旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = scene(map, 'multiplayer', 3, 0, 500_000);
    const [a, b] = map.commercials;
    const companyFunds = [...s0.companyFunds];
    companyFunds[a!.id] = -5_000;
    companyFunds[b!.id] = 8_000;
    const state: GameState = {
      ...s0,
      day: 14,
      phase: 'turnEnd',
      companyFunds,
      holdings: s0.holdings.map((row, p) =>
        row.map((h, i) => ({ ...h, amount: p === 1 && (i === a!.stockIndex || i === b!.stockIndex) ? 100 : 0 })),
      ),
      players: s0.players.map((p, i) => (i === 1 ? { ...p, cash: 100, moneyInBank: 0 } : p)),
    };
    const room = roomFrom(map, state);
    let mirror = state;
    const r = room.submit(3, { type: 'endTurn' });
    expect(r.ok).toBe(true);
    if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.day).toBe(15);
    expect(room.state.players[1]!.whoPlays).not.toBe(0);
    expect(room.state.players[1]!.moneyInBank).toBe(3_000);
  });

  run('真人 0 号在百貨格买道具 ⇒ 百貨企業盈餘 += 標價×10（0x0042ed75）；旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const store = map.nodes.find((n) => n.type > 0x1770 && n.type < 0x1f40 && n.specialKind !== 0)!;
    const s0 = scene(map, 'multiplayer', 0, 1, 500_000);
    const state: GameState = {
      ...s0,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, nodeId: store.id, points: 1000 } : p)),
    };
    const room = roomFrom(map, state);
    let mirror = state;
    const submit = (action: Action) => {
      const r = room.submit(0, action);
      expect(r.ok).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    };
    submit({ type: 'settle' });
    const p = room.state.pending;
    if (p === null || p.kind !== 'shop') throw new Error('没进商店');
    const item = p.tools.find((t) => t.price <= 1000 && (t.stock ?? 1) > 0)!;
    const cid = store.type - 0x1770;
    const before = room.state.companyFunds[cid] ?? 0;
    submit({ type: 'shop', op: 'buyTool', id: item.id });
    expect(room.state.companyFunds[cid]).toBe(before + item.price * 10);
    expect(mirror.companyFunds).toEqual(room.state.companyFunds);
  });

  run('★★ 电脑 3 号踩百貨格 ⇒ 同一趟營業額也进企業帳（0x42f24f jge 0x42ed50 → 0x42ed75）；旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const store = map.nodes.find((n) => n.type > 0x1770 && n.type < 0x1f40 && n.specialKind !== 0)!;
    const cid = store.type - 0x1770;
    const s0 = scene(map, 'multiplayer', 3, 0, 500_000);
    const state: GameState = {
      ...s0,
      // 电脑那一支在 `settle` 里当场买完就走（不挂 pending），
      // 营业额 = Σ 每次买卖函数的返回值（买 10×價 / 卖標價）
      players: s0.players.map((p, i) => (i === 3 ? { ...p, nodeId: store.id, points: 1000, whoPlays: 2 } : p)),
    };
    const room = roomFrom(map, state);
    let mirror = state;
    const before = state.companyFunds[cid] ?? 0;
    const beforeProfit = state.companyProfit[cid] ?? 0;
    const submit = (action: Action) => {
      const r = room.submit(3, action);
      expect(r.ok).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    };
    submit({ type: 'settle' });
    // 电脑那一支不挂商店交互（`0x0042ea2b cmp [+0x15],1 / jne 0x42ed8d`）
    expect(room.state.pending).toBeNull();
    // 真的买了东西：點券变少（否则这条用例可能空转）
    expect(room.state.players[3]!.points).toBeLessThan(1000);
    const visit = aiShopVisit({
      player: state.players[3]!,
      tools: state.tools,
      toolStock: state.toolStock,
      cardAmount: state.cardAmount,
    });
    expect(visit.revenue).toBeGreaterThan(0);
    expect(room.state.companyFunds[cid]).toBe(before + visit.revenue);
    expect(room.state.companyProfit[cid]).toBe(beforeProfit + visit.revenue);
    expect(mirror.companyFunds).toEqual(room.state.companyFunds);
    expect(mirror.companyProfit).toEqual(room.state.companyProfit);
    // 单机同一局面：同一个 reducer ⇒ 同一笔
    const single = reduce(state, { type: 'settle' }, topo);
    expect(single.companyFunds[cid]).toBe(before + visit.revenue);
  });

  run('★ 电脑踩的不是百貨格 ⇒ 企業帳一分不动（格值不在 0x1770..0x1f40 内，0x0042ed57 jle）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = scene(map, 'multiplayer', 3, 0, 500_000);
    const room = roomFrom(map, s0);
    const beforeFunds = [...s0.companyFunds];
    const beforeProfit = [...s0.companyProfit];
    const r = room.submit(3, { type: 'settle' });
    expect(r.ok).toBe(true);
    expect(room.state.companyFunds).toEqual(beforeFunds);
    expect(room.state.companyProfit).toEqual(beforeProfit);
    const single = reduce(s0, { type: 'settle' }, topo);
    expect(single.companyFunds).toEqual(beforeFunds);
  });

  run('真人 0 号关股市屏 ⇒ 欠着特別融資的非董事長当场还清（0x0042ba88）；服务器与旁观端一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const bankCo = map.commercials.find((c) => c.type === 7)!;
    const s0 = scene(map, 'multiplayer', 0, 1, 500_000);
    const commercialOwners = [...s0.commercialOwners];
    commercialOwners[bankCo.id] = { owner: 2, ranking: [2, 0, 0, 0] };
    const state: GameState = {
      ...s0,
      phase: 'awaitingRoll',
      commercialOwners,
      players: s0.players.map((p, i) => (i === 0 ? { ...p, specialFinance: 7000, moneyInBank: 50_000 } : p)),
    };
    const room = roomFrom(map, state);
    let mirror = state;
    const r = room.submit(0, { type: 'stockScreen', op: 'close' });
    expect(r.ok).toBe(true);
    if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.players[0]!.specialFinance).toBe(0);
    expect(room.state.players[0]!.moneyInBank).toBe(43_000);
    // 不是本人回合的座位交这一条 ⇒ 被拒
    expect(room.submit(2, { type: 'stockScreen', op: 'close' }).ok).toBe(false);
  });

  run('真人 0 号現金 999 踩樂透 ⇒ 也挂投注屏，关屏不买；服务器与旁观端一致（LOT-09）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const lot = map.nodes.find((n) => n.specialKind === 9)!;
    const s0 = scene(map, 'multiplayer', 0, 1, 999);
    const state: GameState = { ...s0, players: s0.players.map((p, i) => (i === 0 ? { ...p, nodeId: lot.id } : p)) };
    const room = roomFrom(map, state);
    let mirror = state;
    const submit = (action: Action) => {
      const r = room.submit(0, action);
      expect(r.ok).toBe(true);
      if (r.ok) mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    };
    submit({ type: 'settle' });
    expect(room.state.pending?.kind).toBe('lottery');
    submit({ type: 'declineDecision' });
    expect(room.state.pending).toBeNull();
    expect(room.state.players[0]!.cash).toBe(999);
  });
});

// ============================================================
//  AUC-45：掷骰前打出拍賣卡 ⇒ 落槌后**回到 awaitingRoll**，用卡者照常掷骰
// ============================================================

/**
 * 手工拓扑：一格地块（编号 1，地价 3000、物價 1 ⇒ 起拍价 3000）+ 一格空地。
 *
 * 与 `packages/core/src/rules/auction.test.ts` 的夹具同形 —— 那里用 `makeNode/makeLand`
 * 手工建表，服务器这边也走同一套（`Room` 只要求一个形状对得上的 `Rich4Map`）。
 */
const LAND = 1;
function auctionScene(opponentCash: number): { map: Rich4Map; topo: MapTopology; state: GameState } {
  const map = {
    nodes: [
      makeNode({ id: 1, adjacent: [1], type: 0x7d0 + LAND, ref: { kind: 'land', index: LAND } }),
      makeNode({ id: 2, adjacent: [2], type: 0 }),
    ],
    lands: [makeLand({ id: LAND, name: '測試地', landPrice: 3000, housePrice: 500, owner: 1 })],
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  } as unknown as Rich4Map;
  const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: [], commercials: [] };
  const players = [0, 1, 2, 3].map((i) =>
    makePlayer({
      index: i,
      character: i,
      nodeId: 1,
      cash: i === 0 ? 60_000 : opponentCash,
      moneyInBank: 0,
      // ★ 四位都用**电脑**那一档：竞价要一路跑到落槌，而服务器只在「轮到电脑」时
      //   替它出价（`decideAuctionBid` → `auctionSeatWaitsForHuman`，真人那一档要等本人在屏上点）。
      //   `humanPlayers` 仍是 4（那是开局人数、与 `whoPlays` 无关）—— 与联机里
      //   「真人座位由服务器代打」的局面同形。
      whoPlays: WHO_PLAYS_COMPUTER,
      cards: i === 0 ? [8] : [],
    }),
  );
  const state: GameState = makeGameState({
    mode: 'multiplayer',
    players,
    humanPlayers: 4, // 开局真人人数（`[0x499104]`）：破产终局判据读它，不读 whoPlays
    currentPlayer: 0,
    // 卡片只能在按 GO 之前出（`canUseItemsNow` 只认 awaitingRoll）
    phase: 'awaitingRoll',
    landOwner: [0, 1],
    landLevel: [0, 0],
  });
  return { map, topo, state };
}

function auctionRoom(map: Rich4Map, state: GameState): Room {
  const room = new Room({
    id: 'AU45',
    map,
    globalMapId: 0,
    seed: 11,
    seats: seats(),
    options: LOBBY_DEFAULT_OPTIONS,
    base: { state, snapshot: '' },
  });
  room.start();
  return room;
}

describe('★ AUC-45：拍賣卡在掷骰前打出 —— 服务器与旁观端都回到 awaitingRoll', () => {
  run('挂牌后有人举牌、成交 ⇒ 两端相位与指纹一致，用卡者还能掷骰', () => {
    const { map, topo, state } = auctionScene(60_000);
    const room = auctionRoom(map, state);
    let mirror = state;
    /** 逐条广播喂给「单机 / 旁观端」的同一份 reduce；每步都比指纹，并核 `actingSeat` */
    const submit = (seat: number, action: Action) => {
      const r = room.submit(seat, action);
      expect(r.ok, `座位 ${seat} 的 ${action.type} 被拒`).toBe(true);
      if (!r.ok) return;
      mirror = reduce(mirror, r.broadcast.action, topo);
      expect(stateFingerprint(mirror)).toBe(room.fingerprint);
      // ★ 提交权的判据只有 `actingSeat` 一处（服务器与客户端算的是同一个函数）
      expect(room.actingSeat).toBe(actingSeat(mirror));
    };
    // ① 出卡：pending 挂出来、相位进 awaitingDecision，且记下「落槌回哪儿」
    submit(0, { type: 'useCard', cardId: 8 });
    const opened = room.state.pending;
    if (opened === null || opened.kind !== 'auction') throw new Error('没挂出拍賣 pending');
    expect(opened.resumePhase).toBe('awaitingRoll');
    expect(room.state.phase).toBe('awaitingDecision');

    // ② 每个举牌者各出一口（服务器自己就是权威：`decideAuctionBid` 给的是电脑座位的这一口）
    let guard = 0;
    let raised = 0;
    while (room.state.pending?.kind === 'auction' && guard++ < 40) {
      const bidder = room.actingSeat;
      const bid = room.decideAuctionBid();
      if (bid === null) throw new Error(`座位 ${bidder} 拿不出这一口`);
      submit(bidder, bid);
      if (bid.type === 'auctionBid' && bid.status === 'raise') raised++;
    }
    expect(guard, '竞价循环没停下来').toBeLessThan(40);
    expect(raised, '一口都没人举 ⇒ 没验到成交那条路').toBeGreaterThan(0);

    // ③ 落槌：相位回到出卡时的 awaitingRoll，且真的还能掷骰
    expect(room.state.pending).toBeNull();
    expect(room.state.phase).toBe('awaitingRoll');
    expect(mirror.phase).toBe('awaitingRoll');
    submit(0, { type: 'rollDice' });
    expect(room.state.phase).not.toBe('awaitingRoll');
    expect(mirror.phase).toBe(room.state.phase);
  });

  run('全场都出不起底价 ⇒ 开拍即流拍，相位照样回到 awaitingRoll、地块变无主', () => {
    // 底价 3000；对手現金 2999 ⇒ `cmp / jg` 判出不起（与 core 的流拍用例同一档）
    const { map, topo, state } = auctionScene(2999);
    const room = auctionRoom(map, state);
    let mirror = state;
    const r = room.submit(0, { type: 'useCard', cardId: 8 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    mirror = reduce(mirror, r.broadcast.action, topo);
    expect(stateFingerprint(mirror)).toBe(room.fingerprint);
    expect(room.state.pending).toBeNull(); // 一开拍就全体 givenUp ⇒ 当场流拍
    expect(room.state.phase).toBe('awaitingRoll');
    expect(mirror.phase).toBe('awaitingRoll');
    expect(room.state.landOwner[LAND]).toBe(0); // 拍賣卡的要害：流拍也失去地产
    expect(mirror.landOwner[LAND]).toBe(0);
    // 还能掷骰（用卡者不丢这一掷）—— 服务器与旁观端都受理
    expect(room.submit(0, { type: 'rollDice' }).ok).toBe(true);
    expect(room.state.phase).not.toBe('awaitingRoll');
  });
});
