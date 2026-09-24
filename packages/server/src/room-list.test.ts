/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 房間列表（協議 v5）：listRooms 訂閱 / 推送、列哪些房間、join.mode、不洩漏 clientId
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  decideAction,
  parseMap,
  roomJoinability,
  type Action,
  type ClientMessage,
  type GameState,
  type RoomSummary,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type ClientHandle, type Conn } from './hub.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

/** 按名字派生一個穩定的 32 位十六進位 clientId（與 hub.test.ts 同一個寫法） */
const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

class FakeConn implements Conn {
  readonly inbox: ServerMessage[] = [];
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
  /** 最近一份推來的列表 */
  rooms(): RoomSummary[] {
    return this.last('rooms')?.rooms ?? [];
  }
}

function setup(opts: { roomIdleMs?: number; takeoverAfterMs?: number } = {}) {
  let now = 1_000_000;
  const hub = new RoomHub({
    map: loadMap(),
    globalMapId: 0,
    seedFor: () => 4242,
    now: () => now,
    turnMs: 0,
    ...opts,
  });
  return {
    hub,
    tick(ms: number) {
      now += ms;
      return now;
    },
    get now() {
      return now;
    },
  };
}

/** 開一條連接（身份由各條消息裡的 clientId 決定）*/
function client(hub: RoomHub): { conn: FakeConn; h: ClientHandle; send(m: ClientMessage): void } {
  const conn = new FakeConn();
  const h = hub.connect(conn);
  return { conn, h, send: (m) => h.onMessage(m) };
}

const join = (room: string, name: string, mode?: 'create' | 'join'): ClientMessage => ({
  t: 'join',
  version: PROTOCOL_VERSION,
  room,
  name,
  clientId: idFor(name),
  ...(mode === undefined ? {} : { mode }),
});
const list = (name: string): ClientMessage => ({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: idFor(name) });

describe('★ 房間列表：訂閱與推送', () => {
  run('訂閱立刻回一份（空的也回）；有人建房 ⇒ 推送；內容沒變不重推；進房後不再推', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send(list('W'));
    expect(w.conn.count('rooms')).toBe(1);
    expect(w.conn.rooms()).toEqual([]);

    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    expect(w.conn.count('rooms')).toBe(2);
    expect(w.conn.rooms()).toEqual([
      {
        id: 'K7M2QP',
        host: 'A',
        humans: 1,
        seatCount: 4,
        started: false,
        globalMapId: 0,
        ageMs: 0,
        rejoin: false,
      },
    ]);
    expect(roomJoinability(w.conn.rooms()[0]!)).toBe('join');

    // 改角色不改列表上的任何一欄 ⇒ 不推
    a.send({ t: 'setCharacter', character: 7 });
    expect(w.conn.count('rooms')).toBe(2);
    // 換地圖要推（列表上有地圖名）
    a.send({ t: 'setMap', globalMapId: 0 });
    expect(w.conn.count('rooms')).toBe(2); // 同一張：冪等
    // 「重新整理」= 再訂一次 ⇒ 無論變沒變都再給一份
    w.send(list('W'));
    expect(w.conn.count('rooms')).toBe(3);

    // W 進房 ⇒ 之後列表怎麼變都不再推給它
    w.send(join('K7M2QP', 'W', 'join'));
    expect(w.h.seat).toBe(1);
    const before = w.conn.count('rooms');
    const b = client(hub);
    b.send(join('ABCDEF', 'B', 'create'));
    expect(w.conn.count('rooms')).toBe(before);
  });

  run('人數 / 總人數 / 已滿：房主把總人數改成 2、第二人入座 ⇒ 2 / 2 已滿', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send(list('W'));
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    a.send({ t: 'setOptions', options: { seatCount: 2 } });
    expect(w.conn.rooms()[0]).toMatchObject({ humans: 1, seatCount: 2 });
    const b = client(hub);
    b.send(join('K7M2QP', 'B', 'join'));
    expect(w.conn.rooms()[0]).toMatchObject({ humans: 2, seatCount: 2, started: false });
    expect(roomJoinability(w.conn.rooms()[0]!)).toBe('full');
  });

  run('★ 開局 ⇒ 遊戲中；座位數 = 開局時的總人數；外人不能進、斷線的座位主人看到「重新連線」', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send(list('W'));
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    const b = client(hub);
    b.send(join('K7M2QP', 'B', 'join'));
    a.send({ t: 'start' });
    expect(w.conn.rooms()[0]).toMatchObject({ humans: 2, seatCount: 4, started: true, rejoin: false });
    expect(roomJoinability(w.conn.rooms()[0]!)).toBe('playing');

    // B 掉線 ⇒ 以 B 的身份看列表：這一桌是「重新連線」；別人看還是「遊戲中」
    b.h.onClose(0);
    expect(hub.listRooms(idFor('B'))[0]).toMatchObject({ rejoin: true });
    expect(roomJoinability(hub.listRooms(idFor('B'))[0]!)).toBe('rejoin');
    expect(hub.listRooms(idFor('W'))[0]).toMatchObject({ rejoin: false });

    // B 從列表點「重新連線」（mode: 'join'）⇒ 認回原座
    const b2 = client(hub);
    b2.send(list('B'));
    expect(b2.conn.rooms()[0]?.rejoin).toBe(true);
    b2.send(join('K7M2QP', 'B', 'join'));
    expect(b2.h.seat).toBe(1);
    expect(b2.conn.last('start')).toBeDefined();
    expect(hub.listRooms(idFor('B'))[0]?.rejoin).toBe(false);

    // 外人硬闖一間開了局的房 ⇒ 拒（沿用舊的「已满」）
    const c = client(hub);
    c.send(join('K7M2QP', 'C', 'join'));
    expect(c.conn.last('error')?.message).toContain('已满');
  });

  run('★ 不洩漏 clientId：推給看列表的人的每一個字節裡都找不到任何人的身份令牌', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send(list('W'));
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    const b = client(hub);
    b.send(join('K7M2QP', 'B', 'join'));
    a.send({ t: 'start' });
    b.h.onClose(0);
    const wire = JSON.stringify(w.conn.inbox.filter((m) => m.t === 'rooms'));
    expect(wire).not.toContain(idFor('A'));
    expect(wire).not.toContain(idFor('B'));
    expect(wire).not.toContain('clientId');
    // 連自己的也不回（列表只給一個布林 `rejoin`）
    const bList = JSON.stringify(hub.listRooms(idFor('B')));
    expect(bList).not.toContain(idFor('B'));
    expect(Object.keys(hub.listRooms(idFor('B'))[0]!).sort()).toEqual(
      ['ageMs', 'globalMapId', 'host', 'humans', 'id', 'rejoin', 'seatCount', 'started'].sort(),
    );
  });
});

describe('★ 房間列表：哪些房間不列', () => {
  run('開局前房主（0 號座）斷線 ⇒ 別人看不到（進去也沒人能按開始）；房主自己看到「重新連線」', () => {
    const { hub } = setup();
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    const b = client(hub);
    b.send(join('K7M2QP', 'B', 'join'));
    a.h.onClose(0);
    expect(hub.listRooms(idFor('W'))).toEqual([]);
    expect(hub.listRooms(idFor('A'))).toMatchObject([{ id: 'K7M2QP', rejoin: true }]);
    // 房主回來 ⇒ 又列出來了
    const a2 = client(hub);
    a2.send(join('K7M2QP', 'A', 'join'));
    expect(a2.h.seat).toBe(0);
    expect(hub.listRooms(idFor('W'))).toMatchObject([{ id: 'K7M2QP', rejoin: false }]);
  });

  run('開了局、真人全掉線 ⇒ 外人看不到；掉線的人自己看得到（重新連線）', () => {
    const { hub } = setup();
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    a.send({ t: 'start' });
    a.h.onClose(0);
    expect(hub.listRooms(idFor('W'))).toEqual([]);
    expect(hub.listRooms(idFor('A'))).toMatchObject([{ started: true, rejoin: true }]);
  });

  run('★ 回收：全桌無人滿 roomIdleMs ⇒ 房間沒了，訂閱者收到不含它的新列表', () => {
    const t = setup({ roomIdleMs: 60_000 });
    const w = client(t.hub);
    w.send(list('W'));
    const a = client(t.hub);
    a.send(join('K7M2QP', 'A', 'create'));
    expect(w.conn.rooms()).toHaveLength(1);
    a.h.onClose(t.now);
    // 房主斷線 ⇒ 先從外人的列表上消失
    expect(w.conn.rooms()).toHaveLength(0);
    const pushes = w.conn.count('rooms');
    t.hub.sweepDisconnected(t.now); // 記下「從此刻起無人」
    t.hub.sweepDisconnected(t.tick(60_000)); // 滿了 ⇒ 刪
    expect(t.hub.roomInfo('K7M2QP')).toBeNull();
    // 對 W 來說列表內容沒變（本來就看不到）⇒ 不重推
    expect(w.conn.count('rooms')).toBe(pushes);
    // 對房主自己：原本是「重新連線」，回收後就沒了
    expect(t.hub.listRooms(idFor('A'))).toEqual([]);
  });

  run('建房時刻：`ageMs` 按服務器時鐘算', () => {
    const t = setup();
    const a = client(t.hub);
    a.send(join('K7M2QP', 'A', 'create'));
    t.tick(125_000);
    expect(t.hub.listRooms(null)[0]?.ageMs).toBe(125_000);
  });

  run('★ 終局的不列（`phase === gameOver`）：兩人局、遊戲時間一個月，打到分出勝負', () => {
    const { hub } = setup();
    const map = loadMap();
    const w = client(hub);
    w.send(list('W'));
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    a.send({ t: 'setOptions', options: { seatCount: 2, timeIndex: 5 } });
    a.send({ t: 'start' });
    const room = hub.room('K7M2QP')!;
    expect(w.conn.rooms()).toHaveLength(1);
    const script = (state: GameState): Action => {
      const me = state.players[0]!;
      if ((me.whoPlays & WHO_PLAYS_AUTOPILOT) === 0) {
        return { type: 'setAi', player: 0, whoPlays: me.whoPlays | WHO_PLAYS_AUTOPILOT };
      }
      const act = decideAction({ state, map });
      if (act === null) throw new Error(`無決策：${state.phase}`);
      return act;
    };
    let guard = 0;
    while (room.state.phase !== 'gameOver' && guard++ < 50_000) {
      expect(room.actingSeat).toBe(0); // 電腦那一家由服務器自己走完
      a.send({ t: 'intent', action: script(room.state) });
    }
    expect(room.state.phase).toBe('gameOver');
    expect(hub.listRooms(idFor('W'))).toEqual([]);
    expect(hub.listRooms(idFor('A'))).toEqual([]);
    expect(w.conn.rooms()).toEqual([]);
  });
});

describe('★ join.mode（v5）', () => {
  run('create：碼已經有人用 ⇒ 拒（不斷開，換個碼再建）', () => {
    const { hub } = setup();
    client(hub).send(join('K7M2QP', 'A', 'create'));
    const b = client(hub);
    b.send(join('K7M2QP', 'B', 'create'));
    expect(b.conn.last('error')?.message).toContain('撞上');
    expect(b.h.seat).toBeNull();
    expect(b.conn.closed).toBe(false);
    expect(hub.roomInfo('K7M2QP')?.seats).toHaveLength(1);
  });

  run('★ join：房間已經不在 ⇒ 拒，而且**不會**順手建一間出來', () => {
    const { hub } = setup();
    const b = client(hub);
    b.send(join('K7M2QP', 'B', 'join'));
    expect(b.conn.last('error')?.message).toContain('不在');
    expect(b.h.seat).toBeNull();
    expect(hub.roomInfo('K7M2QP')).toBeNull();
  });

  run('不帶 mode ⇒ 舊語義（有就進、沒有就建）—— 舊 `?room=` 連結與 net-e2e 走這條', () => {
    const { hub } = setup();
    const a = client(hub);
    a.send(join('K7M2QP', 'A'));
    expect(a.h.seat).toBe(0);
    const b = client(hub);
    b.send(join('K7M2QP', 'B'));
    expect(b.h.seat).toBe(1);
  });

  run('mode 不認識 ⇒ error 並斷開', () => {
    const { hub } = setup();
    const a = client(hub);
    a.send({ ...join('K7M2QP', 'A'), mode: 'spectate' } as unknown as ClientMessage);
    expect(a.conn.last('error')?.message).toContain('mode');
    expect(a.conn.closed).toBe(true);
    expect(hub.roomInfo('K7M2QP')).toBeNull();
  });
});

describe('★ listRooms 的校驗', () => {
  run('版本不符 ⇒ 清楚的 error（老頁面）；不訂閱', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send({ t: 'listRooms', version: PROTOCOL_VERSION - 1, clientId: idFor('W') });
    expect(w.conn.last('error')?.message).toContain('协议版本');
    expect(w.conn.count('rooms')).toBe(0);
    client(hub).send(join('K7M2QP', 'A', 'create'));
    expect(w.conn.count('rooms')).toBe(0);
  });

  run('★ 老客戶端（v4）進門就被擋：join 帶舊版本號 ⇒ 協議版本不符', () => {
    const { hub } = setup();
    const old = client(hub);
    old.send({ t: 'join', version: 4, room: 'K7M2QP', name: 'O', clientId: idFor('O') });
    expect(old.conn.last('error')?.message).toContain('协议版本不符');
    expect(old.h.seat).toBeNull();
  });

  run('clientId 不合法 ⇒ error 並斷開', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send({ t: 'listRooms', version: PROTOCOL_VERSION, clientId: 'nope' });
    expect(w.conn.closed).toBe(true);
    expect(w.conn.count('rooms')).toBe(0);
  });

  run('訂閱者斷線 ⇒ 不再往它那兒推（也不拋）', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send(list('W'));
    w.h.onClose(0);
    const n = w.conn.count('rooms');
    client(hub).send(join('K7M2QP', 'A', 'create'));
    expect(w.conn.count('rooms')).toBe(n);
  });
});

describe('★ 房主交接（v6）', () => {
  run('房主按「離開」⇒ 後面的人往前挪、下一位在線真人當房主（能改設定、能開局）；列表照樣看得到', () => {
    const { hub } = setup();
    const a = client(hub);
    const b = client(hub);
    const c = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    b.send(join('K7M2QP', 'B', 'join'));
    c.send(join('K7M2QP', 'C', 'join'));
    a.send({ t: 'leave' });
    a.h.onClose(0);
    expect(b.h.seat).toBe(0);
    expect(c.h.seat).toBe(1);
    expect(b.conn.last('joined')?.seat).toBe(0);
    expect(c.conn.last('joined')?.seat).toBe(1);
    const info = hub.roomInfo('K7M2QP')!;
    expect(info.seats.map((s) => [s.seat, s.name])).toEqual([
      [0, 'B'],
      [1, 'C'],
    ]);
    expect(info.hostSeat).toBe(0);
    // 新房主能改設定；C 不能
    c.send({ t: 'setOptions', options: { seatCount: 3 } });
    expect(c.conn.last('error')?.message).toContain('房主');
    b.send({ t: 'setOptions', options: { seatCount: 3 } });
    expect(hub.roomInfo('K7M2QP')!.options?.seatCount).toBe(3);
    expect(hub.listRooms(idFor('W'))).toMatchObject([{ host: 'B', humans: 2 }]);
    b.send({ t: 'start' });
    expect(hub.room('K7M2QP')).not.toBeNull();
  });

  run('非房主「離開」⇒ 只讓出座位，房主不變', () => {
    const { hub } = setup();
    const a = client(hub);
    const b = client(hub);
    const c = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    b.send(join('K7M2QP', 'B', 'join'));
    c.send(join('K7M2QP', 'C', 'join'));
    b.send({ t: 'leave' });
    expect(hub.roomInfo('K7M2QP')!.seats.map((s) => s.name)).toEqual(['A', 'C']);
    expect(hub.roomInfo('K7M2QP')!.hostSeat).toBe(0);
    expect(c.h.seat).toBe(1);
  });

  run('★ 最後一個人（房主）按「離開」⇒ 房間當場關掉，列表上消失', () => {
    const { hub } = setup();
    const w = client(hub);
    w.send(list('W'));
    const a = client(hub);
    a.send(join('K7M2QP', 'A', 'create'));
    expect(w.conn.rooms()).toHaveLength(1);
    a.send({ t: 'leave' });
    expect(hub.roomInfo('K7M2QP')).toBeNull();
    expect(w.conn.rooms()).toEqual([]);
  });

  run('★ 房主只是斷線（刷新 / 網路）⇒ 給 takeoverAfterMs 的時間回來；過了還沒回來才交接', () => {
    const t = setup({ takeoverAfterMs: 30_000 });
    const a = client(t.hub);
    const b = client(t.hub);
    a.send(join('K7M2QP', 'A', 'create'));
    b.send(join('K7M2QP', 'B', 'join'));
    a.h.onClose(t.now);
    t.hub.sweepDisconnected(t.now);
    t.hub.sweepDisconnected(t.tick(29_999));
    expect(t.hub.roomInfo('K7M2QP')!.hostSeat).toBe(0); // 還是 A 的
    t.hub.sweepDisconnected(t.tick(1));
    const info = t.hub.roomInfo('K7M2QP')!;
    expect(info.seats.map((s) => s.name)).toEqual(['B']);
    expect(info.hostSeat).toBe(0);
    expect(b.h.seat).toBe(0);
    expect(b.conn.last('room')?.room.hostSeat).toBe(0);
  });

  run('房主斷線、趕在時限內回來 ⇒ 原座原房主，什麼都不變', () => {
    const t = setup({ takeoverAfterMs: 30_000 });
    const a = client(t.hub);
    const b = client(t.hub);
    a.send(join('K7M2QP', 'A', 'create'));
    b.send(join('K7M2QP', 'B', 'join'));
    a.h.onClose(t.now);
    t.hub.sweepDisconnected(t.tick(10_000));
    const a2 = client(t.hub);
    a2.send(join('K7M2QP', 'A', 'join'));
    expect(a2.h.seat).toBe(0);
    t.hub.sweepDisconnected(t.tick(60_000));
    expect(t.hub.roomInfo('K7M2QP')!.hostSeat).toBe(0);
    expect(t.hub.roomInfo('K7M2QP')!.seats.map((s) => s.name)).toEqual(['A', 'B']);
  });
});
