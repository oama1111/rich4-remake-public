/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 集线器：加入／开局／意图／重连补发／校验和／掉线代打 —— 全用内存连接
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type Conn } from './hub.ts';

const ROOM = 'K7M2QP';
const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
/**
 * ★ W-73：`join` 多了必填的 `clientId`。测试里按名字派生一个稳定的 32 位十六进制 ——
 * 同名 ⇒ 同身份，于是「两个同名的人各占一座」要靠**显式传不同的 clientId** 来构造
 * （那正是 W-73 §3 要钉住的判据）。
 */
const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);


class FakeConn implements Conn {
  readonly inbox: ServerMessage[] = [];
  /** ★ W-73：服务端主动断开过这条连接吗 */
  closed = false;
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.inbox.length - 1; i >= 0; i--) {
      const m = this.inbox[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
  count(t: ServerMessage['t']): number {
    return this.inbox.filter((m) => m.t === t).length;
  }
}

function hubWith(map = loadMap(), takeoverAfterMs = 1000) {
  return new RoomHub({ map, globalMapId: 0, seedFor: () => 4242, takeoverAfterMs });
}

/** 客户端侧的镜像：只按服务器广播的 action 顺序重放 */
function mirror(map: ReturnType<typeof loadMap>, conn: FakeConn): GameState {
  // ★ 与 Room / 客户端 main.ts 同一份完整 topo（含設施、企业表），否则重放必然走岔
  const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
  const start = conn.last('start')!;
  let s = newGame({ map, globalMapId: 0, seed: start.seed, players: start.seats.map((x) => ({ character: x.character, kind: x.kind })), mode: 'multiplayer' });
  for (const m of conn.inbox) if (m.t === 'action') s = reduce(s, m.action, topo);
  return s;
}

describe('★ 加入与开局', () => {
  run('版本不符拒；依次占座；房主开局后空座补电脑并广播 start', () => {
    const hub = hubWith();
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: 99, room: ROOM, name: 'A', clientId: idFor('A') });
    expect(a.last('error')?.message).toContain('协议版本');
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    const hb = hub.connect(b);
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    expect(ha.seat).toBe(0);
    expect(hb.seat).toBe(1);
    expect(a.last('room')?.room.seats.map((s) => s.name)).toEqual(['A', 'B']);
    // 只有房主能开局
    hb.onMessage({ t: 'start' });
    expect(b.last('error')?.message).toContain('房主');
    ha.onMessage({ t: 'start' });
    const st = b.last('start')!;
    expect(st.seed).toBe(4242);
    expect(st.seats.map((s) => s.kind)).toEqual(['human', 'human', 'computer', 'computer']);
    expect(hub.roomInfo(ROOM)?.started).toBe(true);
    // 开局后不再放新人
    const c = new FakeConn();
    hub.connect(c).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'C', clientId: idFor('C') });
    expect(c.last('error')?.message).toContain('已满');
  });
});

describe('★ 意图与广播', () => {
  run('合法意图被编号广播给所有人；非法的只回 error 且不占序号；不是你的回合也拒', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    const hb = hub.connect(b);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    ha.onMessage({ t: 'start' });
    hb.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    expect(b.last('error')?.message).toContain('notYourTurn');
    ha.onMessage({ t: 'intent', action: { type: 'rollDice' } }); // turnStart 阶段掷骰非法
    expect(a.last('error')?.message).toContain('illegalAction');
    expect(a.count('action')).toBe(0);
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    expect(a.count('action')).toBe(1);
    expect(b.last('action')).toMatchObject({ seq: 0, action: { type: 'startTurn' } });
    // 客户端按广播重放 == 服务器镜像
    expect(stateFingerprint(mirror(map, b))).toBe(hub.room(ROOM)!.fingerprint);
  });

  run('★ 轮到电脑座位时服务器自己替它走完，直到轮回真人', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    ha.onMessage({ t: 'start' }); // 1..3 号全是电脑
    // 真人把自己的回合走完
    const play = (act: Action) => ha.onMessage({ t: 'intent', action: act });
    play({ type: 'startTurn' });
    let guard = 0;
    while (hub.room(ROOM)!.currentSeat === 0 && guard++ < 50) {
      const s = hub.room(ROOM)!.state;
      const next: Action =
        s.phase === 'awaitingRoll' ? { type: 'rollDice' }
        : s.phase === 'moving' ? { type: 'step' }
        : s.phase === 'settling' ? { type: 'settle' }
        : s.phase === 'awaitingDecision' ? { type: 'declineDecision' }
        : { type: 'endTurn' };
      play(next);
    }
    // 三个电脑的回合应当已经由服务器推完，又轮回 0 号
    expect(hub.room(ROOM)!.currentSeat).toBe(0);
    expect(hub.room(ROOM)!.state.turnCount).toBe(4);
    expect(a.count('action')).toBeGreaterThan(8);
    expect(stateFingerprint(mirror(map, a))).toBe(hub.room(ROOM)!.fingerprint);
  });
});

describe('★ 校验和与失步', () => {
  run('指纹一致不响；不一致广播 desync', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    ha.onMessage({ t: 'start' });
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    const seq = a.last('action')!.seq;
    ha.onMessage({ t: 'checksum', seq, hash: hub.room(ROOM)!.fingerprintAt(seq)! });
    expect(a.count('desync')).toBe(0);
    ha.onMessage({ t: 'checksum', seq, hash: 'bogus' });
    expect(a.last('desync')).toMatchObject({ seq, got: 'bogus', seat: 0 });
  });
});

describe('★ Q-NET-1 失步自愈（resync → replay）', () => {
  run('篡改校验和触发 desync；resync 拿回全量重放，重建后指纹与服务器相等', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    ha.onMessage({ t: 'start' });
    // 0 号是真人，1..3 是电脑（服务器代打）——把自己的回合走完，出去一长串 action
    const play = (act: Action) => ha.onMessage({ t: 'intent', action: act });
    play({ type: 'startTurn' });
    let guard = 0;
    while (hub.room(ROOM)!.currentSeat === 0 && guard++ < 50) {
      const s = hub.room(ROOM)!.state;
      play(
        s.phase === 'awaitingRoll' ? { type: 'rollDice' }
        : s.phase === 'moving' ? { type: 'step' }
        : s.phase === 'settling' ? { type: 'settle' }
        : s.phase === 'awaitingDecision' ? { type: 'declineDecision' }
        : { type: 'endTurn' },
      );
    }
    const seq = a.last('action')!.seq;

    // 客户端本地状态被篡改 → 上报的指纹对不上 → 服务器广播 desync
    ha.onMessage({ t: 'checksum', seq, hash: 'tampered' });
    expect(a.last('desync')).toMatchObject({ seq, got: 'tampered', seat: 0 });

    // 客户端请求全量重放
    a.inbox.length = 0;
    ha.onMessage({ t: 'resync' });
    const rep = a.last('replay')!;
    expect(rep.seed).toBe(4242);
    expect(rep.through).toBe(hub.room(ROOM)!.sequenceLength - 1);
    expect(rep.actions.map((x) => x.seq)).toEqual(Array.from({ length: rep.actions.length }, (_, i) => i));
    expect(rep.actions.length).toBeGreaterThan(1);

    // ★ 用服务器给的参数 newGame + 从头 reduce 整串 → 与服务器镜像同一个指纹
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
    let healed = newGame({
      map,
      globalMapId: rep.globalMapId,
      seed: rep.seed,
      players: rep.seats.map((s) => ({ character: s.character, kind: s.kind })),
      mode: 'multiplayer',
    });
    for (const x of rep.actions) healed = reduce(healed, x.action, topo);
    expect(stateFingerprint(healed)).toBe(hub.room(ROOM)!.fingerprint);
  });

  run('★ 反作弊：没进房、冒名、掉线后的连接都拿不到重放；重放也不广播', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    ha.onMessage({ t: 'start' });
    expect(a.count('replay')).toBe(0);

    // ① 从未 join 的连接
    const b = new FakeConn();
    hub.connect(b).onMessage({ t: 'resync' });
    expect(b.count('replay')).toBe(0);
    expect(b.last('error')?.message).toContain('還沒開局');

    // ② 开局后想冒用还在线的 A 的名字 → 进不来，自然也没有重放
    const c = new FakeConn();
    const hc = hub.connect(c);
    hc.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    expect(hc.seat).toBeNull();
    hc.onMessage({ t: 'resync' });
    expect(c.count('replay')).toBe(0);

    // ③ 重放只回请求者，不广播给任何人
    a.inbox.length = 0;
    ha.onMessage({ t: 'resync' });
    expect(a.count('replay')).toBe(1);
    expect(b.count('replay')).toBe(0);
    expect(c.count('replay')).toBe(0);

    // ④ 掉线后旧句柄再发 resync 也不再放行（座位已不归这条连接）
    ha.onClose(100);
    a.inbox.length = 0;
    ha.onMessage({ t: 'resync' });
    expect(a.count('replay')).toBe(0);
    expect(a.last('error')?.message).toContain('不是該座位');
  });
});

describe('★ 不可信输入', () => {
  run('★ 不认识的 action type 被拒绝，镜像不动、服务器不崩', () => {
    const hub = hubWith();
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    ha.onMessage({ t: 'start' });
    a.inbox.length = 0;
    const fp = hub.room(ROOM)!.fingerprint;
    ha.onMessage({ t: 'intent', action: { type: 'respond', response: { kind: 'choice', index: 0 } } as unknown as Action });
    ha.onMessage({ t: 'intent', action: 'rollDice' as unknown as Action });
    ha.onMessage({ t: 'intent', action: null as unknown as Action });
    expect(a.inbox.filter((m) => m.t === 'error')).toHaveLength(3);
    expect(a.inbox.filter((m) => m.t === 'action')).toHaveLength(0);
    expect(hub.room(ROOM)!.fingerprint).toBe(fp);
    // 之后照常能玩。★ 开局后 phase 是 turnStart，此时唯一合法动作是 startTurn
    //   —— 掷骰要等 awaitingRoll（reduce.ts 的 rollDice 分支要求 phase==='awaitingRoll'），
    //   这里若发 rollDice 会被正常拒绝，测的就不是「服务器没被畸形输入搞坏」了。
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    expect(a.inbox.filter((m) => m.t === 'action').length).toBeGreaterThan(0);
  });
});

describe('★ 掉线：重连补发、超时代打、归还', () => {
  run('断线后同名重连认回座位并补发漏掉的 action（since 之后）', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    const hb = hub.connect(b);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    ha.onMessage({ t: 'start' });
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    hb.onClose(100);
    expect(a.last('room')?.room.seats[1]?.connected).toBe(false);
    ha.onMessage({ t: 'intent', action: { type: 'rollDice' } });
    const b2 = new FakeConn();
    const hb2 = hub.connect(b2);
    hb2.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B'), since: 0 });
    expect(hb2.seat).toBe(1);
    expect(b2.last('start')?.seed).toBe(4242);
    expect(b2.inbox.filter((m) => m.t === 'action').map((m) => (m as { seq: number }).seq)).toEqual([1]);
    // 全量重连
    const b3 = new FakeConn();
    hb2.onClose(200);
    hub.connect(b3).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    expect(b3.inbox.filter((m) => m.t === 'action').length).toBe(2);
  });

  run('★★ 第十二份試玩回報：中途进房的 start 带 through = 进房那一刻日志的最后一号；开局广播不带', () => {
    // 客户端据此把 `seq <= through` 的补发**静默**追上，不把整局的演出重演一遍
    //（`20260923-014329884`「断线重连后莫名其妙又进入魔法屋」/ `…014349833`「所有文本提示又重新触发了一轮」）
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    const hb = hub.connect(b);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    ha.onMessage({ t: 'start' });
    expect(a.last('start')?.through).toBeUndefined();
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    ha.onMessage({ t: 'intent', action: { type: 'rollDice' } });
    const lastSeq = Math.max(...a.inbox.filter((m) => m.t === 'action').map((m) => (m as { seq: number }).seq));
    expect(lastSeq).toBeGreaterThanOrEqual(1);
    hb.onClose(100);
    // 刷新（不带 since）：整段补发，through 指着最后一条
    const b2 = new FakeConn();
    const hb2 = hub.connect(b2);
    hb2.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    expect(b2.last('start')?.through).toBe(lastSeq);
    const sent = b2.inbox.filter((m) => m.t === 'action').map((m) => (m as { seq: number }).seq);
    expect(sent.at(-1)).toBe(lastSeq);
    // `start` 排在补发之前（客户端要先知道 through 才分得出补发与实时）
    expect(b2.inbox.findIndex((m) => m.t === 'start')).toBeLessThan(b2.inbox.findIndex((m) => m.t === 'action'));
    // 断线重连（带 since）：through 同样是那一刻的最后一号
    hb2.onClose(200);
    const b3 = new FakeConn();
    hub.connect(b3).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B'), since: 0 });
    expect(b3.last('start')?.through).toBe(lastSeq);
  });

  run('★ 超时后由电脑代打（镜像里 setAi 託管）；重连归还', () => {
    const map = loadMap();
    const hub = hubWith(map, 1000);
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    const hb = hub.connect(b);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    ha.onMessage({ t: 'start' });
    // A 走完自己的回合，轮到 B；B 早已断线
    hb.onClose(0);
    const play = (act: Action) => ha.onMessage({ t: 'intent', action: act });
    play({ type: 'startTurn' });
    let guard = 0;
    while (hub.room(ROOM)!.currentSeat === 0 && guard++ < 50) {
      const s = hub.room(ROOM)!.state;
      play(
        s.phase === 'awaitingRoll' ? { type: 'rollDice' }
        : s.phase === 'moving' ? { type: 'step' }
        : s.phase === 'settling' ? { type: 'settle' }
        : s.phase === 'awaitingDecision' ? { type: 'declineDecision' }
        : { type: 'endTurn' },
      );
    }
    expect(hub.room(ROOM)!.currentSeat).toBe(1);
    // 没到超时：不动
    expect(hub.sweepDisconnected(500)).toEqual([]);
    expect(hub.room(ROOM)!.currentSeat).toBe(1);
    // 超时：託管 + 立刻代打，直到又轮回真人 A
    expect(hub.sweepDisconnected(1500)).toEqual([{ roomId: ROOM, seat: 1 }]);
    expect(hub.room(ROOM)!.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect(hub.room(ROOM)!.currentSeat).toBe(0);
    // 重连：改回真人
    const b2 = new FakeConn();
    hub.connect(b2).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    expect(hub.room(ROOM)!.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    // 客户端 A 按广播重放仍与服务器一致（含 setAi 两条系统 action）
    expect(stateFingerprint(mirror(map, a))).toBe(hub.room(ROOM)!.fingerprint);
  });
});

// ============================================================
//  W-73：身份令牌、房间码、房间生命周期
// ============================================================

/** 一条 `join`（自选房间码 / 名字 / 令牌） */
function joinReq(room: string, name: string, clientId: string, since?: number) {
  return {
    t: 'join' as const,
    version: PROTOCOL_VERSION,
    room,
    name,
    clientId,
    ...(since === undefined ? {} : { since }),
  };
}

/** 第 i 个合法房间码（32 进制展开，字符集与服务器一致） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCodeOf(i: number): string {
  let n = i;
  let out = '';
  for (let k = 0; k < 6; k++) {
    out = CODE_ALPHABET[n % 32]! + out;
    n = Math.trunc(n / 32);
  }
  return out;
}

describe('★ W-73 同名不串座（身份令牌）', () => {
  run('同名两人各占一座（名字重复是允许的）', () => {
    const hub = hubWith();
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    const hb = hub.connect(b);
    ha.onMessage(joinReq('K7M2QP', '小明', idFor('one')));
    hb.onMessage(joinReq('K7M2QP', '小明', idFor('two')));
    expect(ha.seat).toBe(0);
    expect(hb.seat).toBe(1);
    expect(a.last('room')?.room.seats.map((s) => s.name)).toEqual(['小明', '小明']);
  });

  run('★ 同 clientId 断线重连认回原座 —— **名字改了也认回**', () => {
    const hub = hubWith();
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage(joinReq('K7M2QP', '小明', idFor('me')));
    expect(ha.seat).toBe(0);
    ha.onClose(0);
    // ⚠️ 断线的那条连接自己收不到这条 `room` 广播（它已经不在座位表里了），
    //    所以看服务器手上的房间快照，而不是看它自己的收件箱。
    expect(hub.roomInfo('K7M2QP')?.seats[0]?.connected).toBe(false);

    const again = new FakeConn();
    const h2 = hub.connect(again);
    h2.onMessage(joinReq('K7M2QP', '小红', idFor('me')));
    expect(h2.seat).toBe(0); // 还是原来那座
    expect(again.last('joined')?.room.seats).toHaveLength(1); // 没有多出一座
    expect(again.last('joined')?.room.seats[0]?.name).toBe('小红'); // 显示名跟着改
  });

  run('★ 不同 clientId 同名 **不** 认回 —— 另占一座，原座仍是断线中', () => {
    const hub = hubWith();
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage(joinReq('K7M2QP', '小明', idFor('me')));
    ha.onClose(0);

    const impostor = new FakeConn();
    const hb = hub.connect(impostor);
    hb.onMessage(joinReq('K7M2QP', '小明', idFor('someone-else')));
    expect(hb.seat).toBe(1);
    const seats = impostor.last('joined')!.room.seats;
    expect(seats.map((s) => s.name)).toEqual(['小明', '小明']);
    expect(seats[0]?.connected).toBe(false); // 原座还空着等他
    expect(seats[1]?.connected).toBe(true);
  });
});

describe('★ W-73 加入信息的服务器校验', () => {
  run('★ 非法 clientId / 房间码 / 名字：回 error **并断开**', () => {
    const hub = hubWith();
    const bad: { room: string; name: string; clientId: string }[] = [
      { room: 'K7M2QP', name: 'A', clientId: 'not-hex' },
      { room: 'K7M2QP', name: 'A', clientId: 'A'.repeat(32) }, // 大写不认
      { room: 'K7M2QP', name: 'A', clientId: '0'.repeat(31) }, // 少一位
      { room: 'K7M2Q', name: 'A', clientId: idFor('A') }, // 房间码少一位
      { room: 'IK7M2Q', name: 'A', clientId: idFor('A') }, // 含被排除的 I
      { room: 'K7M2Q0', name: 'A', clientId: idFor('A') }, // 含被排除的 0
      { room: 'K7M2QP', name: '', clientId: idFor('A') },
      { room: 'K7M2QP', name: '   ', clientId: idFor('A') },
      { room: 'K7M2QP', name: '\u0000\u0007', clientId: idFor('A') },
      { room: 'K7M2QP', name: 'x'.repeat(13), clientId: idFor('A') },
    ];
    for (const req of bad) {
      const c = new FakeConn();
      hub.connect(c).onMessage({ t: 'join', version: PROTOCOL_VERSION, ...req });
      const label = JSON.stringify(req);
      expect(c.last('error'), label).toBeDefined();
      expect(c.closed, label).toBe(true);
      expect(c.last('joined'), label).toBeUndefined();
    }
  });

  run('名字里的控制字符被**去掉**而不是整条拒掉；12 个码点算合法', () => {
    const hub = hubWith();
    const c = new FakeConn();
    hub.connect(c).onMessage(joinReq('K7M2QP', '\u0007小明', idFor('c')));
    expect(c.last('joined')?.room.seats[0]?.name).toBe('小明');

    const long = new FakeConn();
    hub.connect(long).onMessage(joinReq('QQQQQQ', '𠮷'.repeat(12), idFor('long')));
    expect(long.last('joined'), '12 个码点（24 个 UTF-16 单元）应当合法').toBeDefined();
    expect(long.closed).toBe(false);
  });
});

describe('★ W-73 房间生命周期', () => {
  run('★ 全桌无人在线满 10 分钟 ⇒ 房间被删；没到就留着', () => {
    const hub = new RoomHub({ map: loadMap(), globalMapId: 0, seedFor: () => 4242, roomIdleMs: 600_000 });
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage(joinReq('K7M2QP', 'A', idFor('A')));
    expect(hub.roomInfo('K7M2QP')).not.toBeNull();

    // 有人在线：扫描只把「无人」的计时清掉，不删
    hub.sweepDisconnected(1_000);
    expect(hub.roomInfo('K7M2QP')).not.toBeNull();

    // 掉线：第一次扫描记下「从此刻起无人」
    ha.onClose(2_000);
    hub.sweepDisconnected(2_000);
    expect(hub.roomInfo('K7M2QP')).not.toBeNull();

    // 差 1 ms 还在
    hub.sweepDisconnected(2_000 + 599_999);
    expect(hub.roomInfo('K7M2QP')).not.toBeNull();

    // 满 10 分钟：删
    hub.sweepDisconnected(2_000 + 600_000);
    expect(hub.roomInfo('K7M2QP')).toBeNull();
  });

  run('掉线后**又有人进来** ⇒ 计时清零，房间不会被回收', () => {
    const hub = new RoomHub({ map: loadMap(), globalMapId: 0, seedFor: () => 4242, roomIdleMs: 600_000 });
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage(joinReq('K7M2QP', 'A', idFor('A')));
    ha.onClose(0);
    hub.sweepDisconnected(1_000); // emptySince = 1000

    const b = new FakeConn();
    hub.connect(b).onMessage(joinReq('K7M2QP', 'B', idFor('B')));
    hub.sweepDisconnected(500_000);
    expect(hub.roomInfo('K7M2QP')).not.toBeNull();
    // 再过很久（B 还连着）也不删
    hub.sweepDisconnected(5_000_000);
    expect(hub.roomInfo('K7M2QP')).not.toBeNull();
  });

  run('★ 同时存在的房间上限 50：第 51 个被拒，**已有的照常进出**', () => {
    const hub = hubWith();
    for (let i = 0; i < 50; i++) {
      const c = new FakeConn();
      hub.connect(c).onMessage(joinReq(roomCodeOf(i), 'P', idFor(`p${i}`)));
      expect(c.last('joined'), `第 ${i + 1} 間`).toBeDefined();
    }
    const over = new FakeConn();
    hub.connect(over).onMessage(joinReq(roomCodeOf(50), 'P', idFor('over')));
    expect(over.last('error')?.message).toContain('房間已滿');
    expect(over.last('joined')).toBeUndefined();
    expect(over.closed).toBe(false); // 房间满了只是拒绝这一次，不必断开

    // 已有的第 1 间照常进人
    const again = new FakeConn();
    hub.connect(again).onMessage(joinReq(roomCodeOf(0), 'Q', idFor('q')));
    expect(again.last('joined')).toBeDefined();

    // 上限判的是**当前**房间数：回收掉一间之后（这里靠 `roomIdleMs: 0` 的一次扫描）
    // 立刻又能建新的 —— 不是「一辈子只许建 50 间」。
    const reaper = new RoomHub({
      map: loadMap(),
      globalMapId: 0,
      seedFor: () => 4242,
      maxRooms: 1,
      roomIdleMs: 0,
    });
    const first = new FakeConn();
    const hFirst = reaper.connect(first);
    hFirst.onMessage(joinReq('AAAAAA', 'P', idFor('p')));
    expect(first.last('joined')).toBeDefined();
    const second = new FakeConn();
    reaper.connect(second).onMessage(joinReq('BBBBBB', 'P', idFor('q')));
    expect(second.last('error')?.message).toContain('房間已滿');

    hFirst.onClose(1); // 上一间没人了
    reaper.sweepDisconnected(2); // `roomIdleMs: 0` ⇒ 一次扫描就回收
    expect(reaper.roomInfo('AAAAAA')).toBeNull();
    const third = new FakeConn();
    reaper.connect(third).onMessage(joinReq('CCCCCC', 'P', idFor(ROOM)));
    expect(third.last('joined')).toBeDefined();
  });
});

// ============================================================
//  W-74：回合计时（60 秒不动 ⇒ 电脑代打；连续两次 ⇒ 託管）
// ============================================================

/** 这个客户端**收到过**「座位 seat 被超时託管」那条 `setAi` 吗 */
function sawTimeout(target: FakeConn, seat: number): boolean {
  return target.inbox.some(
    (m) =>
      m.t === 'action' &&
      m.action.type === 'setAi' &&
      m.action.player === seat &&
      ((m.action.whoPlays ?? 0) & WHO_PLAYS_AUTOPILOT) !== 0,
  );
}

/** 一个**注入了时钟**的房间：两个真人 A/B，`now` 由测试推（一秒都不真睡） */
function clockHub(opts: { turnMs?: number; aliveExtendMs?: number; hardCapMs?: number; awaitingFallbackMs?: number } = {}) {
  let now = 0;
  const a = new FakeConn();
  const b = new FakeConn();
  const hub = new RoomHub({
    map: loadMap(),
    globalMapId: 0,
    seedFor: () => 4242,
    seatCount: 2,
    now: () => now,
    ...opts,
  });
  const ha = hub.connect(a);
  const hb = hub.connect(b);
  ha.onMessage(joinReq(ROOM, 'A', idFor('A')));
  hb.onMessage(joinReq(ROOM, 'B', idFor('B')));
  ha.onMessage({ t: 'start' });
  const room = hub.room(ROOM)!;
  return {
    hub,
    a,
    b,
    ha,
    hb,
    room,
    setNow: (t: number): void => {
      now = t;
    },
    /** `awaiting` 要带**最新**那条广播的序号 */
    latestSeq: (): number => room.sequenceLength - 1,
  };
}

/** 让 `seat` 超时一次（报 awaiting → 推时间 → 扫） */
function timeoutSeat(h: ReturnType<typeof clockHub>, seat: 0 | 1, at: number): void {
  (seat === 0 ? h.ha : h.hb).onMessage({ t: 'awaiting', seq: h.latestSeq() });
  h.setNow(at);
  h.hub.sweepDisconnected(at);
}

/** 一桌**只有一个真人**、其余三座电脑（首席复核：W-74 原有用例全是「两真人、无电脑」，漏掉了这一种）*/
function soloClockHub(opts: { turnMs?: number } = {}) {
  let now = 0;
  const a = new FakeConn();
  const hub = new RoomHub({ map: loadMap(), globalMapId: 0, seedFor: () => 4242, seatCount: 4, now: () => now, ...opts });
  const ha = hub.connect(a);
  ha.onMessage(joinReq(ROOM, 'A', idFor('A')));
  ha.onMessage({ t: 'start' });
  const room = hub.room(ROOM)!;
  const startTurns = (): number => a.inbox.filter((m) => m.t === 'action' && m.action.type === 'startTurn').length;
  return {
    hub,
    a,
    ha,
    room,
    startTurns,
    /** 让 A 超时一次 */
    timeout: (at: number): void => {
      ha.onMessage({ t: 'awaiting', seq: room.sequenceLength - 1 });
      now = at;
      hub.sweepDisconnected(at);
    },
    setNow: (t: number): void => {
      now = t;
    },
  };
}

describe('★★ 首席复核：一桌只有一个真人时，超时**不许**让服务器把整局打完', () => {
  run('超时一次 ⇒ 电脑替他走**这一回合** + 三个电脑各一回合，然后**停在他身上**等他（已还给真人）', () => {
    const h = soloClockHub();
    expect(h.room.actingSeat).toBe(0);
    const before = h.startTurns();
    h.timeout(60_000);
    // 实测修之前：同一瞬间连打几十个回合，直到 guard（10 000 条 action）才停
    expect(h.startTurns() - before).toBeLessThanOrEqual(5);
    expect(h.room.currentSeat).toBe(0);
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(h.a.last('room')?.room.seats[0]?.autopilot).toBeUndefined();
  });

  run('连续两次 ⇒ 长期託管；此后**没有真人在场** ⇒ 服务器停手等人，不往下打；resume 才接着走', () => {
    const h = soloClockHub();
    h.timeout(60_000);
    h.timeout(120_000);
    expect(h.a.last('room')?.room.seats[0]?.autopilot).toBe('idle');
    const frozen = h.room.sequenceLength;
    // 时间再怎么走、再怎么扫，都不许自己往下打
    for (const t of [180_000, 600_000, 3_600_000]) {
      h.setNow(t);
      h.hub.sweepDisconnected(t);
    }
    expect(h.room.sequenceLength).toBe(frozen);

    h.ha.onMessage({ t: 'resume' });
    expect(h.a.last('room')?.room.seats[0]?.autopilot).toBeUndefined();
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    // 收回之后电脑座位把该走的走完，最后停在他身上
    expect(h.room.actingSeat).toBe(0);
  });

  run('唯一的真人掉线被代打 ⇒ 同样停手等人；重连后接着走并停在他身上', () => {
    let now = 0;
    const a = new FakeConn();
    const hub = new RoomHub({ map: loadMap(), globalMapId: 0, seedFor: () => 4242, seatCount: 4, takeoverAfterMs: 1000, now: () => now });
    const ha = hub.connect(a);
    ha.onMessage(joinReq(ROOM, 'A', idFor('A')));
    ha.onMessage({ t: 'start' });
    const room = hub.room(ROOM)!;
    ha.onClose(0);
    now = 5000;
    hub.sweepDisconnected(5000);
    const frozen = room.sequenceLength;
    // （别推过 10 分钟：全桌无人那么久房间会被回收，那是 W-73 §4 的另一条规矩）
    now = 300_000;
    hub.sweepDisconnected(now);
    expect(room.sequenceLength).toBe(frozen);

    const a2 = new FakeConn();
    hub.connect(a2).onMessage(joinReq(ROOM, 'A', idFor('A')));
    expect(room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(room.actingSeat).toBe(0);
  });
});

describe('★ W-74 回合计时', () => {
  run('★ awaiting 之后 60 秒不动 ⇒ 电脑代打这一回合；**回合结束就还给他**', () => {
    const h = clockHub();
    expect(h.room.actingSeat).toBe(0);
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.a.last('clock')).toMatchObject({ seat: 0, remainingMs: 60_000, hardRemainingMs: 180_000 });

    // 差 1 ms 不动
    h.setNow(59_999);
    h.hub.sweepDisconnected(59_999);
    expect(sawTimeout(h.b, 0)).toBe(false);
    expect(h.room.currentSeat).toBe(0);

    // 到点：电脑替他把这一回合走完 ⇒ 轮到 B
    h.setNow(60_000);
    h.hub.sweepDisconnected(60_000);
    expect(sawTimeout(h.b, 0)).toBe(true);
    expect(h.room.currentSeat).toBe(1);
    // ★ 只超时**一次** ⇒ 他的回合一结束就自动改回真人
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(h.b.last('room')?.room.seats[0]?.autopilot).toBeUndefined();
    // 「作废」那条 clock 也广播过
    expect(h.a.inbox.some((m) => m.t === 'clock' && m.remainingMs === -1)).toBe(true);
  });

  run('★ 连续两次超时 ⇒ **保持託管**，SeatInfo.autopilot === "idle"', () => {
    const h = clockHub();
    timeoutSeat(h, 0, 60_000); // A 第一次
    expect(h.room.currentSeat).toBe(1);
    timeoutSeat(h, 1, 120_000); // B 第一次（这样回合又回到 A）
    expect(h.room.currentSeat).toBe(0);
    expect(h.room.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);

    timeoutSeat(h, 0, 180_000); // A **连续**第二次
    expect(h.room.currentSeat).toBe(1);
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect(h.b.last('room')?.room.seats[0]?.autopilot).toBe('idle');
  });

  run('★ resume ⇒ 归还座位、清零 strikes（下一次超时只算第一次）', () => {
    const h = clockHub();
    timeoutSeat(h, 0, 60_000);
    timeoutSeat(h, 1, 120_000);
    timeoutSeat(h, 0, 180_000);
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);

    h.ha.onMessage({ t: 'resume' });
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(h.a.last('room')?.room.seats[0]?.autopilot).toBeUndefined();

    // strikes 清零了：再超时一次仍然只是「第一次」⇒ 回合结束就还
    timeoutSeat(h, 0, 240_000);
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
  });

  run('★ alive 把截止往后延，但**延不过硬上限 180 秒**', () => {
    const h = clockHub();
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.a.last('clock')?.remainingMs).toBe(60_000);

    // 已经过去 50 秒 ⇒ 延到 now+30s = 80s（比原来的 60s 远）
    h.setNow(50_000);
    h.ha.onMessage({ t: 'alive' });
    expect(h.a.last('clock')?.remainingMs).toBe(30_000);

    // 一路 alive 顶到硬上限（起点 + 180 秒）就再也延不动了
    for (let t = 90_000; t <= 180_000; t += 30_000) {
      h.setNow(t);
      h.ha.onMessage({ t: 'alive' });
    }
    expect(h.a.last('clock')).toMatchObject({ remainingMs: 0, hardRemainingMs: 0 });

    // 硬上限到点：照样超时
    h.setNow(180_000);
    h.hub.sweepDisconnected(180_000);
    expect(sawTimeout(h.b, 0)).toBe(true);
  });

  run('★ 没收到 awaiting ⇒ 广播后 45 秒兜底开始数，之后照常 60 秒超时', () => {
    const h = clockHub();
    h.setNow(44_999);
    h.hub.sweepDisconnected(44_999);
    expect(h.a.last('clock')).toBeUndefined(); // 还没开始数（装表本身不广播）

    h.setNow(45_000);
    h.hub.sweepDisconnected(45_000);
    expect(h.a.last('clock')).toMatchObject({ seat: 0, remainingMs: 60_000 });

    h.setNow(104_999);
    h.hub.sweepDisconnected(104_999);
    expect(sawTimeout(h.b, 0)).toBe(false);

    h.setNow(105_000);
    h.hub.sweepDisconnected(105_000);
    expect(sawTimeout(h.b, 0)).toBe(true);
  });

  run('★ 非 awaited 座位发的 awaiting / alive 一律忽略；过期的 seq 也忽略', () => {
    const h = clockHub();
    // 现在等的是 A(0)，B 来说「我准备好了」不算
    h.hb.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.b.last('clock')).toBeUndefined();
    expect(h.a.last('clock')).toBeUndefined();
    h.hb.onMessage({ t: 'alive' });
    expect(h.b.last('clock')).toBeUndefined();

    // A 报**过期**的 seq 也不算
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() - 1 });
    expect(h.a.last('clock')).toBeUndefined();

    // A 报最新那条才算
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.a.last('clock')?.remainingMs).toBe(60_000);
  });

  run('掉线座位不计时：clock 立刻作废，且不会走「超时」那条路', () => {
    const h = clockHub();
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.a.last('clock')?.remainingMs).toBe(60_000);

    h.ha.onClose(1_000);
    expect(h.b.last('clock')?.remainingMs).toBe(-1); // 作废
    // 还没到掉线代打的阈值（30 s）：什么都没发生
    h.setNow(21_000);
    h.hub.sweepDisconnected(21_000);
    expect(sawTimeout(h.b, 0)).toBe(false);
    expect(h.b.last('room')?.room.seats[0]?.autopilot).toBeUndefined();

    // 过了阈值：走的是**掉线代打**那条路（`autopilot: 'offline'`），不是超时
    h.setNow(31_000);
    h.hub.sweepDisconnected(31_000);
    expect(h.b.last('room')?.room.seats[0]?.autopilot).toBe('offline');
  });

  run('被电脑管着的座位不计时（电脑座位走的是同一个 `kind !== "human"` 分支）', () => {
    const h = clockHub();
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.a.last('clock')?.remainingMs).toBe(60_000);

    // A 把自己交给电脑（`setAi` 是公开 action，谁都发得出来）
    h.ha.onMessage({
      t: 'intent',
      action: { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT },
    });
    expect(h.hub.clockOf(ROOM)).toBeNull();
    expect(h.a.last('clock')?.remainingMs).toBe(-1);
  });

  run('★ 重连认回原座：**当场装表**，随后的 awaiting 立刻起数（不用等下一次扫描，更不用等 45 秒兜底）', () => {
    const h = clockHub();
    // A 掉线（表被作废），随后**带着同一个 clientId** 回来 —— 认回原座、改回真人。
    // ★ 首席复核：认回这一段现在会 `#driveComputers` + `#advance`（一桌「停手等人」时得有人把它踢起来），
    //   于是表在这里就装上了；原先要等下一次 5 秒一扫才装。
    h.ha.onClose(1_000);
    h.setNow(2_000);
    const back = new FakeConn();
    const hBack = h.hub.connect(back);
    hBack.onMessage(joinReq(ROOM, 'A', idFor('A')));
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(h.hub.clockOf(ROOM)).toMatchObject({ seat: 0, counting: false });

    hBack.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(back.last('clock')).toMatchObject({ seat: 0, remainingMs: 60_000, hardRemainingMs: 180_000 });
    // 60 秒后照样超时
    h.setNow(62_000);
    h.hub.sweepDisconnected(62_000);
    expect(sawTimeout(back, 0)).toBe(true);
  });

  run('★ 首席复核续：**连续两次超时之后重连** ⇒ 座位也要回到真人手里（原来是死座）', () => {
    const h = clockHub();
    timeoutSeat(h, 0, 60_000);
    timeoutSeat(h, 1, 120_000);
    timeoutSeat(h, 0, 180_000);
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect(h.b.last('room')?.room.seats[0]?.autopilot).toBe('idle');

    // A 刷新页面回来
    h.ha.onClose(200_000);
    const back = new FakeConn();
    const hBack = h.hub.connect(back);
    hBack.onMessage(joinReq(ROOM, 'A', idFor('A')));
    // ★ 镜像里必须改回纯真人 —— 否则 `#shouldTime` 不再给他计时、
    //   `#driveComputers` 又认不出他（它只认 `takenOver` 与 `autopilot`）⇒ 这一座从此没人推
    expect(h.room.state.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    // 而且这一桌重新「有人在」⇒ 计时表回来了（此刻轮到的是 B，所以等的是 1 号座）
    expect(h.hub.clockOf(ROOM)).not.toBeNull();
  });

  run('★ --turn-ms 0 ⇒ 永不超时', () => {
    const h = clockHub({ turnMs: 0 });
    expect(h.hub.clockOf(ROOM)).toBeNull();
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    expect(h.a.last('clock')).toBeUndefined();

    h.setNow(10_000_000);
    h.hub.sweepDisconnected(10_000_000);
    expect(sawTimeout(h.b, 0)).toBe(false);
    expect(h.room.currentSeat).toBe(0);
  });

  run('自己发 intent 走完一回合 ⇒ 计时作废、strikes 清零', () => {
    const h = clockHub();
    h.ha.onMessage({ t: 'awaiting', seq: h.latestSeq() });
    h.setNow(10_000);
    h.ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    expect(h.a.inbox.some((m) => m.t === 'clock' && m.remainingMs === -1)).toBe(true);
    // 新局面的表装给了**下一位**（还是 A，因为他这一回合没走完）—— 无论如何不再倒计时旧的
    h.setNow(10_000 + 59_999);
    h.hub.sweepDisconnected(10_000 + 59_999);
    expect(sawTimeout(h.b, 0)).toBe(false);
  });
});
