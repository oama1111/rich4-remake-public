/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * issue #9：联机 4 座（2 真人 + 2 电脑）——回合主人是电脑、轮到真人举牌时拍賣永久卡死。
 *
 * 契约（core `net/acting-seat.ts`）：**谁举牌谁提交**。
 *   · 定序器竞价期间只收 `pending.bidders[pending.seat]` 那一端的意图；
 *   · AI 控制的那一口（电脑 / 掉线代打 / 託管）由服务器出，**哪怕回合主人是真人**；
 *   · 别的真人（含回合主人）替他出价 ⇒ 拒。
 *
 * ★ 这里的真人**不开託管**（开了的话每一口都归服务器，考不到「真人举牌」那条路）：
 *   决策借 core 的 AI 算（在一份「假装託管」的拷贝上），提交的是真人自己的座位。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  auctionNextBid,
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

/** ★ W-73：`join` 多了必填的 `clientId`；测试里按名字派生一个稳定的 32 位十六进制 */
const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);


const ROOM = 'K7M2QP';
const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

/**
 * 本文件钉住的两个种子（一局里拍賣难得开一场，30 个种子里没有一个两种现场都走到，故各钉一个）。
 * 下面每条都断言「现场数 > 0」—— 种子走不到现场时宁可红。换种子用文末的搜索器。
 */
// ★ 2026-09-22 換種子：福神附身買地/買設施/建設施/加蓋白送一級改了進程；原 5 走不到（真人回合、電腦舉牌）現場，兩個一併重掃（原 12 / 5）。
// ★ 2026-09-22 換種子（E-41）：「走回棋盤」那一回合收尾不換人，改了輪轉；原 12 走不到（電腦回合、真人舉牌）現場，重掃取 5（8 次）。
// ★ 2026-09-23 換種子（第十四份試玩回報 #2）：開局擺人每人多抽一次「來路」（`0x00408328`），隨機序列整體後移；
//   重掃 1..40：14 = 電腦回合真人舉牌 6 次，5 = 真人回合電腦舉牌 6 次（兩個恰好對調）。
// ★ 2026-09-24 換種子（開局惰性擺人：第 2..N 位輪到自己才落地、兩次抽籤挪到各自回合開頭）：
//   重掃 1..40：12 = 電腦回合真人舉牌 6 次，18 = 真人回合電腦舉牌 7 次。
// ★ 2026-09-24 可成交量 `0x42915a` 挪到每位玩家回合開頭之後重掃：12 = 8 次、18 = 7 次，兩個種子不用換。
// ★ 2026-09-24 換種子（第 24 份：魔法屋「向後轉」重挑來路要 `rand()`、機器娃娃不掃附身物件並走 `0x40e14d`、
//   電腦用娃娃的判據不再把別人身上的神明當路上的 —— 對局走向又變了）：重掃 1..40：
//   14 = 電腦回合真人舉牌 8 次，21 = 真人回合電腦舉牌 8 次（原 12 / 18 都掉到 0）。
// ★ 2026-09-25 換種子（审计 provenance-ai-econ：电脑买股 / 卖股挪进 reducer 按原版掷全局 `rand()`、公佈欄 / 銀行对账补齐 ——
//   对局走向又变了）：重掃 1..40：12 = 電腦回合真人舉牌 8 次（原 14 掉到 0），21 = 真人回合電腦舉牌 5 次（不用換）。
// ★ 2026-09-25 換種子（审计 provenance-econ：拍賣开场席位 = 末位座位、收費记敌意、分紅按人加总……）：重掃 1..40：
//   10 = 電腦回合真人舉牌 6 次（与 cards 合并后 12 掉到 0），18 = 真人回合電腦舉牌 5 次（原 21 掉到 0）。
const SEED_HUMAN_BIDS_ON_COMPUTER_TURN = 10;
const SEED_COMPUTER_BIDS_ON_HUMAN_TURN = 18;
const TURNS = 200;
const HUMANS = 2;

class Client implements Conn {
  state: GameState | null = null;
  expected = 0;
  readonly errors: string[] = [];
  /** 施加前的 (回合主人, 出价者) —— 用来数「电脑在真人回合里举牌」 */
  readonly bids: { owner: number; bidder: number }[] = [];
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
      if (msg.action.type === 'auctionBid') {
        this.bids.push({ owner: this.state!.currentPlayer, bidder: msg.action.bidder });
      }
      this.state = reduce(this.state!, msg.action, this.topo);
    }
    if (msg.t === 'error') this.errors.push(msg.message);
    if (msg.t === 'desync') throw new Error(`desync @${msg.seq}`);
  }
}

/** 「假装这位真人开了託管」的拷贝 —— 只用来借 AI 的脑子，不提交 setAi */
function asAi(state: GameState, seat: number): GameState {
  return {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, whoPlays: p.whoPlays | WHO_PLAYS_AUTOPILOT } : p)),
  };
}

/** 真人这一手：机械阶梯自己走，待决交互借 AI 的答案，掷骰前不用卡/道具（`aiNext` 对真人不合法）*/
function humanAction(state: GameState, map: ReturnType<typeof parseMap>, seat: number): Action {
  const p = state.pending;
  if (p !== null && p.kind === 'auction' && 'seat' in p) {
    const bid = auctionNextBid(asAi(state, seat), p);
    if (bid === null) throw new Error(`座位 ${seat} 的竞价拿不出主意`);
    return bid;
  }
  if (state.phase === 'awaitingRoll') return { type: 'rollDice' };
  const a = decideAction({ state: asAi(state, seat), map });
  if (a === null) throw new Error(`座位 ${seat} 无决策：${state.phase} / ${state.pending?.kind ?? '-'}`);
  // ★ 貸款屏上 AI 给的是「托管 ⇒ 按电脑那一支办」（`bank/auto`），恰好真人不认这一手 ⇒ 真人这一端按 EXIT 离开
  if (a.type === 'bank' && a.op === 'auto') return { type: 'declineDecision' };
  // ★ 选種類窗上 AI 给的是 `facilityType: null`（托管 ⇒ 电脑那一支掷），恰好真人不认 ⇒ 真人这一端点一格（旅館）
  if (a.type === 'buildFacility' && a.facilityType === null) return { type: 'buildFacility', facilityType: 1 };
  return a;
}

interface Played {
  room: NonNullable<ReturnType<RoomHub['room']>>;
  clients: Client[];
  /** 回合主人是**电脑**、轮到**真人**举牌的次数（issue #9 的死锁现场）*/
  humanBidOnComputerTurn: number;
  /** 回合主人是**真人**、由服务器替**电脑**举牌的次数（反方向）*/
  computerBidOnHumanTurn: number;
  /** 旁人替举牌者出价被拒的次数 */
  proxyRejected: number;
}

function play(seed: number, turns: number): Played {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
  const hub = new RoomHub({ map, globalMapId: 0, seedFor: () => seed });
  const clients = Array.from({ length: HUMANS }, () => new Client(map, topo));
  const handles = clients.map((c, i) => {
    const h = hub.connect(c);
    h.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: `H${i}`, clientId: idFor(`H${i}`) });
    return h;
  });
  handles[0]!.onMessage({ t: 'start' }); // 空座位由 hub 补电脑 ⇒ 座位 2、3 是电脑
  const room = hub.room(ROOM)!;

  let humanBidOnComputerTurn = 0;
  let proxyRejected = 0;
  let guard = 0;
  while (!isGameOver(room.state) && room.state.turnCount < turns && guard++ < 100_000) {
    const seat = room.actingSeat;
    // ★ W-74：**竞价期间计时的是举牌者，不是回合主人** —— 判据就是 `room.actingSeat`
    //   （与 74-a 的「直接用 `room.actingSeat`，不要另写一套」同一条）
    if (room.actingSeat !== room.currentSeat) {
      const clock = hub.clockOf(ROOM);
      expect(clock, `競價中應當有計時器（舉牌者 ${seat}，回合主人 ${room.currentSeat}）`).not.toBeNull();
      expect(clock!.seat, `舉牌者 ${seat} vs 回合主人 ${room.currentSeat}`).toBe(seat);
    }
    if (seat >= HUMANS) {
      // 轮到电脑却没被服务器推走 = 卡死（修之前停在这里的是「回合主人」判据）
      throw new Error(
        `卡死：seed ${seed} 第 ${room.state.turnCount} 回合，phase=${room.state.phase} ` +
          `pending=${room.state.pending?.kind ?? '-'} currentPlayer=${room.currentSeat} actingSeat=${seat}`,
      );
    }
    const action = humanAction(clients[seat]!.state!, map, seat);
    if (action.type === 'auctionBid' && room.currentSeat !== seat) {
      if (room.currentSeat >= HUMANS) humanBidOnComputerTurn++;
      // ★ 旁人（另一位真人，可能正是回合主人）替他出这一口 ⇒ 必须被拒，且不推进
      const other = 1 - seat;
      const before = room.sequenceLength;
      const errs = clients[other]!.errors.length;
      handles[other]!.onMessage({ t: 'intent', action });
      expect(room.sequenceLength, '旁人代出价不该被定序').toBe(before);
      expect(clients[other]!.errors.length).toBe(errs + 1);
      expect(clients[other]!.errors.at(-1)).toContain('notYourTurn');
      proxyRejected++;
    }
    const before = room.sequenceLength;
    handles[seat]!.onMessage({ t: 'intent', action });
    if (room.sequenceLength === before) {
      throw new Error(`座位 ${seat} 的 ${action.type} 被拒：${clients[seat]!.errors.at(-1) ?? '?'}`);
    }
  }
  const computerBidOnHumanTurn = clients[0]!.bids.filter((b) => b.owner < HUMANS && b.bidder >= HUMANS).length;
  return { room, clients, humanBidOnComputerTurn, computerBidOnHumanTurn, proxyRejected };
}

function expectConsistent(r: Played): void {
  expect(r.room.state.turnCount).toBeGreaterThanOrEqual(TURNS);
  // 两端镜像与服务器一致；除了故意造的「代出价被拒」，没有别的报错
  for (const c of r.clients) expect(stateFingerprint(c.state!)).toBe(r.room.fingerprint);
  const stray = r.clients.flatMap((c) => c.errors).filter((e) => !e.includes('notYourTurn'));
  expect(stray).toEqual([]);
}

describe('★ issue #9：联机竞价的提交权归举牌者（2 真人 + 2 电脑）', () => {
  run('回合主人是电脑、轮到真人举牌 ⇒ 真人那一端提交得进去，拍賣收得了场（原先永久卡死）', () => {
    const r = play(SEED_HUMAN_BIDS_ON_COMPUTER_TURN, TURNS);
    expect(r.humanBidOnComputerTurn, '这个种子没走到 issue #9 的现场').toBeGreaterThan(0);
    expect(r.proxyRejected, '没考到「旁人代出价被拒」').toBeGreaterThan(0);
    expectConsistent(r);
  });

  run('回合主人是真人、轮到电脑举牌 ⇒ 服务器替电脑出那一口（不靠回合主人的客户端代发）', () => {
    const r = play(SEED_COMPUTER_BIDS_ON_HUMAN_TURN, TURNS);
    expect(r.computerBidOnHumanTurn, '这个种子没走到「真人回合、电脑举牌」').toBeGreaterThan(0);
    expectConsistent(r);
  });
});

/**
 * 换种子用的搜索器（平时不跑）：
 *   RICH4_AUCTION_SEARCH=60 pnpm vitest run packages/server/src/auction-acting-seat.test.ts
 * 打印前 N 个种子各自走到了几次两种现场；挑一个两边都 > 0 的填进 `SEED`。
 */
// ★ 平时**不登记**这条用例（不是 `it.skip`）：本仓库的门禁口径是「有原版目录时 0 skipped」
const searchCount = Number(process.env.RICH4_AUCTION_SEARCH ?? 0);
if (searchCount > 0 && existsSync(MAP)) describe('种子搜索', () => {
  const n = searchCount;
  it('列出各种子走到的现场数', () => {
    const rows: string[] = [];
    for (let seed = 1; seed <= n; seed++) {
      try {
        const r = play(seed, TURNS);
        rows.push(`seed ${seed}: 电脑回合真人举牌 ${r.humanBidOnComputerTurn} / 真人回合电脑举牌 ${r.computerBidOnHumanTurn}`);
      } catch (e) {
        rows.push(`seed ${seed}: ✗ ${(e as Error).message}`);
      }
    }
    console.log(rows.join('\n'));
  }, 600_000);
});
