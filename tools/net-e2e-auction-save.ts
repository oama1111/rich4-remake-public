/*
 * 联机拍卖 e2e 的**存档夹具**（gap-audit #4 的活体验收用）—— 写一份服务器存档，让房主「從存檔繼續」直接走到一场拍卖。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 为什么是存档而不是 dev 钩子：联机里本机状态必须与服务器镜像逐字节一致，客户端的 `__rich4.auction()` 会改坏本地状态；
 * 服务器的「從存檔繼續」（协议 v6，`--saves <dir>`）本来就是生产路径 —— 夹具只是一份**合法的**存档文件，
 * 服务器 / 客户端都不必加任何只给测试用的后门。
 *
 * 局面：4 座（0 = 真人 A、1 = 真人 B、2/3 = 电脑），先用 core 的 AI 把每一座都走上盘，停在 A 的回合开头；
 * 再给 A 一张拍賣卡（卡 8）并把 A 挪到一块地上。A 一用卡，A 就是卖方（原版 arg0，状态 7 不举牌），
 * B 与两家电脑竞价 ⇒ A = 旁观的真人、B = 举牌的真人。候选地逐块预演一遍整场竞价（B 按 e2e 的打法：
 * 前 `B_RAISES` 次轮到他 +100、之后 PASS），挑出口数最多、且 B 至少举牌两次的那一块。
 *
 * 用法：[FIXTURE_SEED=7] node --experimental-transform-types tools/net-e2e-auction-save.ts <savesDir> <clientIdA> <clientIdB>
 * 输出（stdout 最后一行）：JSON `{ id, land, basePrice, predicted: { bids, bTurns, aiBids } }`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MkfArchive } from '../packages/assets-pipeline/src/mkf.ts';
import {
  DEFAULT_INITIAL_FUND,
  GAME_INITIAL_FUNDS,
  LOBBY_DEFAULT_OPTIONS,
  WHO_PLAYS_AUTOPILOT,
  auctionAway,
  auctionNextBid,
  decideAction,
  isInGame,
  newGame,
  parseMap,
  reduce,
  serializeGame,
  teleportPlayer,
  winConditionsOf,
  type Action,
  type GameState,
  type MapTopology,
} from '../packages/core/src/index.ts';

export const SAVE_ID = 'e2e-auction';
/** B 轮到举牌时前几次 +100（之后 PASS）—— 与 `net-e2e-auction.mjs` 的打法同一个数 */
export const B_RAISES = 3;

const [dir, idA, idB] = process.argv.slice(2);
if (dir === undefined || idA === undefined || idB === undefined) {
  console.error('用法：net-e2e-auction-save.ts <savesDir> <clientIdA> <clientIdB>');
  process.exit(2);
}
const SEED = Number(process.env.FIXTURE_SEED ?? '7');

const mapFile = fileURLToPath(new URL('../assets/game/map.mkf', import.meta.url));
const map = parseMap(new MkfArchive(new Uint8Array(readFileSync(mapFile))).read(1));
const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
const o = LOBBY_DEFAULT_OPTIONS;
const seats = [
  { seat: 0, name: 'A', character: 0, kind: 'human' as const, clientId: idA },
  { seat: 1, name: 'B', character: 1, kind: 'human' as const, clientId: idB },
  { seat: 2, name: '電腦3', character: 2, kind: 'computer' as const, clientId: null },
  { seat: 3, name: '電腦4', character: 3, kind: 'computer' as const, clientId: null },
];

/** 「假装这位真人开了託管」的拷贝 —— 只借 AI 的脑子（同 `server/auction-acting-seat.test.ts`）*/
const asAi = (s: GameState, seat: number): GameState => ({
  ...s,
  players: s.players.map((p, i) => (i === seat ? { ...p, whoPlays: p.whoPlays | WHO_PLAYS_AUTOPILOT } : p)),
});

/** 谁都按 AI 走一步（真人座位在拷贝上借 AI；竞价归举牌那位）*/
function aiStep(s: GameState): Action {
  const p = s.pending;
  if (p !== null && p.kind === 'auction' && 'seat' in p) {
    const bidder = p.bidders[p.seat]!;
    const bid = auctionNextBid(asAi(s, bidder), p);
    if (bid === null) throw new Error('竞价拿不出主意');
    return bid;
  }
  // 真人座位掷骰前不用卡 / 道具（AI 那一手对真人不合法，同 `auction-acting-seat.test.ts` 的 `humanAction`）
  if (s.phase === 'awaitingRoll' && s.currentPlayer <= 1) return { type: 'rollDice' };
  const a = decideAction({ state: asAi(s, s.currentPlayer), map });
  if (a !== null && a.type === 'bank' && a.op === 'auto' && s.currentPlayer <= 1) return { type: 'declineDecision' };
  if (a === null) throw new Error(`无决策：${s.phase} / ${s.pending?.kind ?? '-'}`);
  return a;
}

// 1) 开局 + 走到每一座都上了盘、停在 A（0 号座）的回合开头
let state = newGame({
  map,
  globalMapId: 0,
  players: seats.map((s) => ({ character: s.character, kind: s.kind })),
  seed: SEED,
  mode: 'multiplayer',
  initialFund: GAME_INITIAL_FUNDS[o.fundIndex] ?? DEFAULT_INITIAL_FUND,
  startingVehicle: o.vehicle,
  landTenure: o.landTenure,
  winConditions: winConditionsOf(o.fundIndex, o.timeIndex, o.victoryIndex),
});
for (let guard = 0; ; guard++) {
  if (guard > 20_000) throw new Error(`走不到 A 的回合开头：turn ${state.turnCount} cur ${state.currentPlayer} ${state.phase} nodes ${state.players.map((p) => p.nodeId)}`);
  // 每一座都上了盘、且没人不在场（住院 / 坐牢 / 住旅館…不在场的开拍即 givenUp，`auctionAway`）
  const placed = state.players.every((p) => p.nodeId > 0 && !auctionAway(p));
  if (placed && state.turnCount >= 8 && state.currentPlayer === 0 && state.phase === 'turnStart' && state.pending === null) break;
  state = reduce(state, aiStep(state), topo);
}
if (!state.players.every((p) => isInGame(p))) throw new Error('热身时有人出局了，换 FIXTURE_SEED');

/** 预演：A 开始回合 → 用拍賣卡 → 整场竞价（B 前 `B_RAISES` 次 +100、之后 PASS；电脑问 core）*/
function rehearse(s0: GameState): { bids: number; bTurns: number; aiBids: number; basePrice: number } | null {
  let s = reduce(s0, { type: 'startTurn' }, topo);
  if (s.phase !== 'awaitingRoll' || s.pending !== null) return null;
  s = reduce(s, { type: 'useCard', cardId: 8, target: { kind: 'none' } }, topo);
  const p0 = s.pending;
  if (p0 === null || p0.kind !== 'auction' || !('seat' in p0)) return null;
  let bids = 0;
  let bTurns = 0;
  let aiBids = 0;
  for (let guard = 0; guard < 500; guard++) {
    const p = s.pending;
    if (p === null || p.kind !== 'auction' || !('seat' in p)) break;
    const bidder = p.bidders[p.seat]!;
    let a: Action | null;
    if (bidder === 1) {
      a = { type: 'auctionBid', bidder: 1, status: bTurns < B_RAISES ? 'raise' : 'pass', step: bTurns < B_RAISES ? 100 : 0 };
      bTurns++;
    } else {
      a = auctionNextBid(s, p);
      aiBids++;
    }
    if (a === null) return null;
    s = reduce(s, a, topo);
    bids++;
  }
  return { bids, bTurns, aiBids, basePrice: p0.basePrice };
}

// 2) 候选地逐块预演，挑口数最多的
let best: { land: number; state: GameState; r: NonNullable<ReturnType<typeof rehearse>> } | null = null;
for (const land of map.lands) {
  const moved = teleportPlayer(state, map.nodes, 0, land.id);
  if (moved === null) continue;
  const cand: GameState = {
    ...moved,
    players: moved.players.map((p, i) => ({
      ...p,
      // 人人有钱：电脑的心理价位按地价算，钱够才举得动；B 也别半路出不起
      cash: Math.max(p.cash, 200_000),
      cards: i === 0 ? [...p.cards.filter((c) => c !== 8), 8] : p.cards,
    })),
  };
  const r = rehearse(cand);
  // `DEBUG_FIXTURE=1`：逐块地打出预演结果（换种子 / 调打法时看分布）
  if (process.env.DEBUG_FIXTURE) console.error(land.id, JSON.stringify(r));
  if (r === null || r.bTurns < 2 || r.aiBids < 4) continue;
  if (best === null || r.bids > best.r.bids) best = { land: land.id, state: cand, r };
}
if (best === null) throw new Error('没有一块地能开出够长的拍卖，换 FIXTURE_SEED');

mkdirSync(dir, { recursive: true });
const st = best.state;
const save = {
  format: 1,
  id: SAVE_ID,
  kind: 'manual',
  name: '拍賣e2e',
  savedAt: Date.now(),
  globalMapId: 0,
  options: { ...o, seatCount: 4 },
  seats,
  snapshot: serializeGame(st),
  meta: { year: st.year, month: st.month, day: st.day, turnCount: st.turnCount, alive: st.players.map((p) => isInGame(p)) },
};
writeFileSync(join(dir, `${SAVE_ID}.json`), JSON.stringify(save));
console.log(JSON.stringify({ id: SAVE_ID, land: best.land, basePrice: best.r.basePrice, predicted: best.r }));
