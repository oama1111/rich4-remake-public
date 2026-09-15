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

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

class FakeConn implements Conn {
  readonly inbox: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
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
    ha.onMessage({ t: 'join', version: 99, room: 'r', name: 'A' });
    expect(a.last('error')?.message).toContain('协议版本');
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    const hb = hub.connect(b);
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
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
    expect(hub.roomInfo('r')?.started).toBe(true);
    // 开局后不再放新人
    const c = new FakeConn();
    hub.connect(c).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'C' });
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
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
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
    expect(stateFingerprint(mirror(map, b))).toBe(hub.room('r')!.fingerprint);
  });

  run('★ 轮到电脑座位时服务器自己替它走完，直到轮回真人', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    ha.onMessage({ t: 'start' }); // 1..3 号全是电脑
    // 真人把自己的回合走完
    const play = (act: Action) => ha.onMessage({ t: 'intent', action: act });
    play({ type: 'startTurn' });
    let guard = 0;
    while (hub.room('r')!.currentSeat === 0 && guard++ < 50) {
      const s = hub.room('r')!.state;
      const next: Action =
        s.phase === 'awaitingRoll' ? { type: 'rollDice' }
        : s.phase === 'moving' ? { type: 'step' }
        : s.phase === 'settling' ? { type: 'settle' }
        : s.phase === 'awaitingDecision' ? { type: 'declineDecision' }
        : { type: 'endTurn' };
      play(next);
    }
    // 三个电脑的回合应当已经由服务器推完，又轮回 0 号
    expect(hub.room('r')!.currentSeat).toBe(0);
    expect(hub.room('r')!.state.turnCount).toBe(4);
    expect(a.count('action')).toBeGreaterThan(8);
    expect(stateFingerprint(mirror(map, a))).toBe(hub.room('r')!.fingerprint);
  });
});

describe('★ 校验和与失步', () => {
  run('指纹一致不响；不一致广播 desync', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    ha.onMessage({ t: 'start' });
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    const seq = a.last('action')!.seq;
    ha.onMessage({ t: 'checksum', seq, hash: hub.room('r')!.fingerprintAt(seq)! });
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
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    ha.onMessage({ t: 'start' });
    // 0 号是真人，1..3 是电脑（服务器代打）——把自己的回合走完，出去一长串 action
    const play = (act: Action) => ha.onMessage({ t: 'intent', action: act });
    play({ type: 'startTurn' });
    let guard = 0;
    while (hub.room('r')!.currentSeat === 0 && guard++ < 50) {
      const s = hub.room('r')!.state;
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
    expect(rep.through).toBe(hub.room('r')!.sequenceLength - 1);
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
    expect(stateFingerprint(healed)).toBe(hub.room('r')!.fingerprint);
  });

  run('★ 反作弊：没进房、冒名、掉线后的连接都拿不到重放；重放也不广播', () => {
    const map = loadMap();
    const hub = hubWith(map);
    const a = new FakeConn();
    const ha = hub.connect(a);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
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
    hc.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
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
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    ha.onMessage({ t: 'start' });
    a.inbox.length = 0;
    const fp = hub.room('r')!.fingerprint;
    ha.onMessage({ t: 'intent', action: { type: 'respond', response: { kind: 'choice', index: 0 } } as unknown as Action });
    ha.onMessage({ t: 'intent', action: 'rollDice' as unknown as Action });
    ha.onMessage({ t: 'intent', action: null as unknown as Action });
    expect(a.inbox.filter((m) => m.t === 'error')).toHaveLength(3);
    expect(a.inbox.filter((m) => m.t === 'action')).toHaveLength(0);
    expect(hub.room('r')!.fingerprint).toBe(fp);
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
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
    ha.onMessage({ t: 'start' });
    ha.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    hb.onClose(100);
    expect(a.last('room')?.room.seats[1]?.connected).toBe(false);
    ha.onMessage({ t: 'intent', action: { type: 'rollDice' } });
    const b2 = new FakeConn();
    const hb2 = hub.connect(b2);
    hb2.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B', since: 0 });
    expect(hb2.seat).toBe(1);
    expect(b2.last('start')?.seed).toBe(4242);
    expect(b2.inbox.filter((m) => m.t === 'action').map((m) => (m as { seq: number }).seq)).toEqual([1]);
    // 全量重连
    const b3 = new FakeConn();
    hb2.onClose(200);
    hub.connect(b3).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
    expect(b3.inbox.filter((m) => m.t === 'action').length).toBe(2);
  });

  run('★ 超时后由电脑代打（镜像里 setAi 託管）；重连归还', () => {
    const map = loadMap();
    const hub = hubWith(map, 1000);
    const a = new FakeConn();
    const b = new FakeConn();
    const ha = hub.connect(a);
    const hb = hub.connect(b);
    ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
    ha.onMessage({ t: 'start' });
    // A 走完自己的回合，轮到 B；B 早已断线
    hb.onClose(0);
    const play = (act: Action) => ha.onMessage({ t: 'intent', action: act });
    play({ type: 'startTurn' });
    let guard = 0;
    while (hub.room('r')!.currentSeat === 0 && guard++ < 50) {
      const s = hub.room('r')!.state;
      play(
        s.phase === 'awaitingRoll' ? { type: 'rollDice' }
        : s.phase === 'moving' ? { type: 'step' }
        : s.phase === 'settling' ? { type: 'settle' }
        : s.phase === 'awaitingDecision' ? { type: 'declineDecision' }
        : { type: 'endTurn' },
      );
    }
    expect(hub.room('r')!.currentSeat).toBe(1);
    // 没到超时：不动
    expect(hub.sweepDisconnected(500)).toEqual([]);
    expect(hub.room('r')!.currentSeat).toBe(1);
    // 超时：託管 + 立刻代打，直到又轮回真人 A
    expect(hub.sweepDisconnected(1500)).toEqual([{ roomId: 'r', seat: 1 }]);
    expect(hub.room('r')!.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    expect(hub.room('r')!.currentSeat).toBe(0);
    // 重连：改回真人
    const b2 = new FakeConn();
    hub.connect(b2).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
    expect(hub.room('r')!.state.players[1]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    // 客户端 A 按广播重放仍与服务器一致（含 setAi 两条系统 action）
    expect(stateFingerprint(mirror(map, a))).toBe(hub.room('r')!.fingerprint);
  });
});
