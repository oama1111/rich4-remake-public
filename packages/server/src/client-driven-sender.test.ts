/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * core `clientDrivenSender` 的**真值核对**：对着真的 `RoomHub` 打一局（2 真人 + 2 电脑），
 * 每一条广播都问「客户端镜像反推出的派出者」与「服务器这边实际是谁交的意图」是否一致。
 *
 * 用途（第十二份試玩回報续）：联机旁观端「队首是别的真人自己派的 ⇒ 他那台演完了 ⇒ 本台跟着收场」
 * （`client/follow-presenter.ts`）。反推错一次的后果：
 *   - 把服务器替电脑 / 託管出的当成真人 ⇒ 旁观端的演出被无故掐掉；
 *   - 反过来只是少跟一次（保守）—— 但这里要求**逐条相等**，两个方向都不许错。
 *
 * 覆盖的现场（每一种都断言「走到过」，种子走不到时宁可红）：
 *   · 真人自己的回合、电脑的回合；
 *   · 拍賣：回合主人是电脑、轮到真人举牌（issue #9 那条路，`actingSeat` ≠ `currentPlayer`）；
 *   · 超时託管：服务器 `setAi(HUMAN|AUTOPILOT)` 后替他把那一回合走完，回合完再 `setAi(HUMAN)` 还给他；
 *   · 掉线接管：同上，但之后一直由服务器出。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  auctionNextBid,
  clientDrivenSender,
  decideAction,
  isGameOver,
  newGame,
  parseMap,
  reduce,
  type Action,
  type GameState,
  type MapTopology,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type Conn } from './hub.ts';

const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

const ROOM = 'F7LWQP';
const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
/** 与 `auction-acting-seat.test.ts` 同一个种子：走得到「电脑回合、真人举牌」 */
// ★ 2026-09-23 換種子（E-41 移植）：「走回棋盤」那一回合收尾不換人，改了輪轉；原 12 走不到（電腦回合、真人舉牌）現場，
//   跟 `auction-acting-seat.test.ts` 的 `SEED_HUMAN_BIDS_ON_COMPUTER_TURN` 一起換成 5（搜索器：该现场 8 次）。
// ★ 2026-09-23 再換（第十四份試玩回報 #2：開局擺人每人多抽一次「來路」）：跟著換成 14（搜索器：该现场 6 次）。
// ★ 2026-09-24 再換（開局惰性擺人：第 2..N 位輪到自己才落地）：跟著換成 12（搜索器：该现场 6 次）。
const SEED = 12;
const HUMANS = 2;
/** 第几回合让 H1 超时一次、第几回合让 H1 掉线 */
const TIMEOUT_AT_TURN = 150;
const DISCONNECT_AT_TURN = 170;
const TURNS = 200;

interface Seen {
  seq: number;
  action: Action;
  /** 本端镜像反推出的派出者 */
  inferred: number | null;
}

class Observer implements Conn {
  state: GameState | null = null;
  readonly seen: Seen[] = [];
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
      this.seen.push({ seq: msg.seq, action: msg.action, inferred: clientDrivenSender(this.state!, msg.action) });
      this.state = reduce(this.state!, msg.action, this.topo);
    }
    if (msg.t === 'desync') throw new Error(`desync @${msg.seq}`);
  }
}

/** 借 AI 的脑子替真人拿主意（不提交 setAi）—— 同 `auction-acting-seat.test.ts` */
function asAi(state: GameState, seat: number): GameState {
  return {
    ...state,
    players: state.players.map((p, i) => (i === seat ? { ...p, whoPlays: p.whoPlays | WHO_PLAYS_AUTOPILOT } : p)),
  };
}

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
  return a;
}

describe('★ clientDrivenSender 对着真服务器逐条核对（2 真人 + 2 电脑，含拍賣 / 超时託管 / 掉线接管）', () => {
  run('每一条广播：镜像反推的派出者 = 服务器那边实际交意图的真人座位（服务器替人出的一律 null）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
    let now = 1_000_000;
    const hub = new RoomHub({ map, globalMapId: 0, seedFor: () => SEED, now: () => now });
    const clients = Array.from({ length: HUMANS }, () => new Observer(map, topo));
    const handles = clients.map((c, i) => {
      const h = hub.connect(c);
      h.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: `H${i}`, clientId: idFor(`H${i}`) });
      return h;
    });
    handles[0]!.onMessage({ t: 'start' }); // 空座位由 hub 补电脑 ⇒ 座位 2、3 是电脑
    const room = hub.room(ROOM)!;

    /** 真值：哪一号是哪位真人**自己**交的意图 */
    const truth = new Map<number, number>();
    let timedOut = false;
    let disconnected = false;
    let humanBidOnComputerTurn = 0;
    let guard = 0;
    while (!isGameOver(room.state) && room.state.turnCount < TURNS && guard++ < 100_000) {
      const seat = room.actingSeat;
      // ── 超时託管：轮到 H1 掷骰时它不动，服务器兜底开始数（45 s）→ 到点（60 s）替他走完这一回合 ──
      if (!timedOut && room.state.turnCount >= TIMEOUT_AT_TURN && seat === 1 && room.state.phase === 'awaitingRoll') {
        timedOut = true;
        const before = room.sequenceLength;
        now += 45_001;
        hub.sweepDisconnected(now);
        now += 60_001;
        hub.sweepDisconnected(now);
        expect(room.sequenceLength, 'H1 超时后服务器应当替他走').toBeGreaterThan(before);
        continue;
      }
      // ── 掉线接管：别人的回合里 H1 断线，30 s 后由服务器接管 ──
      if (!disconnected && room.state.turnCount >= DISCONNECT_AT_TURN && seat === 0) {
        disconnected = true;
        handles[1]!.onClose(now);
        now += 30_001;
        expect(hub.sweepDisconnected(now)).toEqual([{ roomId: ROOM, seat: 1 }]);
        continue;
      }
      if (seat >= HUMANS || (disconnected && seat === 1)) {
        throw new Error(`卡死：第 ${room.state.turnCount} 回合 actingSeat=${seat} 没人推`);
      }
      const action = humanAction(clients[seat]!.state!, map, seat);
      if (action.type === 'auctionBid' && room.currentSeat >= HUMANS) humanBidOnComputerTurn++;
      const seq = room.sequenceLength;
      handles[seat]!.onMessage({ t: 'intent', action });
      expect(room.sequenceLength, `座位 ${seat} 的 ${action.type} 被拒`).toBeGreaterThan(seq);
      truth.set(seq, seat);
    }
    expect(room.state.turnCount).toBeGreaterThanOrEqual(TURNS);

    // 观察者 = H0（全程在线）
    const seen = clients[0]!.seen;
    expect(seen.length).toBe(room.sequenceLength);
    const wrong = seen.filter((s) => s.inferred !== (truth.get(s.seq) ?? null));
    expect(
      wrong.slice(0, 5).map((s) => `#${s.seq} ${s.action.type}: 反推 ${s.inferred} / 实际 ${truth.get(s.seq) ?? null}`),
    ).toEqual([]);

    // ── 现场都走到了 ──
    expect(seen.filter((s) => s.inferred === 1).length, 'H1 自己派的').toBeGreaterThan(0);
    expect(humanBidOnComputerTurn, '电脑回合、真人举牌').toBeGreaterThan(0);
    const setAi = seen.filter((s) => s.action.type === 'setAi');
    // 超时一次（託管 + 归还）+ 掉线接管 = 3 条系统 action
    expect(setAi.map((s) => ((s.action as Extract<Action, { type: 'setAi' }>).whoPlays ?? 0) & WHO_PLAYS_AUTOPILOT)).toEqual([
      WHO_PLAYS_AUTOPILOT,
      0,
      WHO_PLAYS_AUTOPILOT,
    ]);
    // 超时那一回合与接管之后，服务器替 H1 出的那几条都判成 null（不在 truth 里、反推也是 null）
    const firstTakeover = setAi[0]!.seq;
    const restore = setAi[1]!.seq;
    const between = seen.filter((s) => s.seq > firstTakeover && s.seq < restore);
    expect(between.length, '超时那一回合服务器替 H1 出的').toBeGreaterThan(0);
    expect(between.every((s) => s.inferred === null)).toBe(true);
    const afterTakeover = seen.filter((s) => s.seq > setAi[2]!.seq && !truth.has(s.seq));
    expect(afterTakeover.length).toBeGreaterThan(0);
    expect(afterTakeover.every((s) => s.inferred === null)).toBe(true);
  }, 60_000);
});
