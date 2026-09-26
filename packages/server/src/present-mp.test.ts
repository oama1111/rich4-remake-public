/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * gap-audit #7（协议 v8）：纯演出提示 `present` —— 亮牌 / 用卡失败 / 道具台词 / 选格取消。
 *
 * 原版真人用卡：`_rich4_ui_use_card_entry` 卡片欄选定 → `0x00441cbc call 0x441f73` **亮牌**（在卡片函数 /
 * 选目标之前）→ 卡片函数返回 0（目标取消）⇒ `0x00441cd9` 失败音 3 → `0x00441ce3` 卡片欄重开。
 * 原版是一块屏大家一起看 ⇒ 联机时这几件事要**转给同桌**，否则旁观端要等最后那条 `useCard` 才亮牌、
 * 失败的那几次根本看不到（`known-deviations.md` 第 3 条「仍剩的一点」）。
 *
 * 服务器这一侧的契约：
 *   · 只收**轮到的那一座**（`actingSeat`）的真人自己的连接，而且手里真有那张卡 / 那件道具；
 *   · 限速 `PRESENT_RATE`；
 *   · 不进 action 日志 / 重放 / 指纹，不发回发起者。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  PRESENT_RATE,
  PROTOCOL_VERSION,
  deserializeGame,
  parseMap,
  serializeGame,
  toolCount,
  type ClientMessage,
  type ServerMessage,
} from '@rich4/core';
import { RoomHub, type ClientHandle, type Conn } from './hub.ts';
import { MemorySaveStore } from './saves.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

class FakeConn implements Conn {
  readonly inbox: ServerMessage[] = [];
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  all<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
}

interface Client {
  conn: FakeConn;
  h: ClientHandle;
  send(m: ClientMessage): void;
}
function client(hub: RoomHub): Client {
  const conn = new FakeConn();
  const h = hub.connect(conn);
  return { conn, h, send: (m) => h.onMessage(m) };
}
const join = (room: string, who: string, extra: Partial<Extract<ClientMessage, { t: 'join' }>> = {}): ClientMessage => ({
  t: 'join',
  version: PROTOCOL_VERSION,
  room,
  name: who,
  clientId: idFor(who),
  ...extra,
});

/** 随便挑两张卡 —— 服务器只看「手里有没有」，卡号本身不重要 */
const HELD_CARD = 7;
const OTHER_CARD = 8;

/**
 * 两真人（A = 0 号、B = 1 号）+ 两电脑，开局即轮到 A。A 手里塞一张卡：先存一份开局存档，
 * 改快照里 A 的手牌后另存，再从它建房（走正规的「从存档继续」路，不碰服务器镜像）。
 */
function table(now: { t: number }) {
  const map = loadMap();
  const store = new MemorySaveStore();
  const mk = () =>
    new RoomHub({ map, globalMapId: 0, seedFor: () => 4242, now: () => now.t, turnMs: 0, saves: store, today: null });
  {
    const hub = mk();
    const a = client(hub);
    const b = client(hub);
    a.send(join('K7M2QP', 'A', { mode: 'create' }));
    b.send(join('K7M2QP', 'B', { mode: 'join' }));
    a.send({ t: 'start' });
    a.send({ t: 'save', name: '開局' });
  }
  const base = store.list()[0]!;
  const st = deserializeGame(base.snapshot);
  // A 手里一张 HELD_CARD，B 手里一张 OTHER_CARD（B 有卡、但不是轮到他 —— 考「只收轮到的那一座」）
  const players = st.players.map((p, i) => (i === 0 ? { ...p, cards: [HELD_CARD] } : i === 1 ? { ...p, cards: [OTHER_CARD] } : p));
  store.put({ ...base, id: 'm-present', name: '有卡', snapshot: serializeGame({ ...st, players }) });
  const hub = mk();
  const a = client(hub);
  const b = client(hub);
  a.send(join('ABCDEF', 'A', { mode: 'create', fromSave: 'm-present' }));
  b.send(join('ABCDEF', 'B', { mode: 'join' }));
  a.send({ t: 'start' });
  const room = hub.room('ABCDEF')!;
  expect(a.h.seat).toBe(0);
  expect(b.h.seat).toBe(1);
  expect(room.actingSeat).toBe(0);
  expect(room.state.players[0]!.cards).toEqual([HELD_CARD]);
  return { hub, room, a, b };
}

describe('★ gap-audit #7：`present`（协议 v8）', () => {
  it('协议版本 +1（7 → 8；之后第二十六份 pt26-car 又 +1 ⇒ 至少 8）', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(8);
  });

  run('轮到的那一座亮牌 ⇒ 转给同桌其余各端（带 `after` = 此刻日志末号）；不发回本人；不进日志、不动指纹', () => {
    const now = { t: 1000 };
    const { room, a, b } = table(now);
    const seqBefore = room.sequenceLength;
    const fpBefore = room.fingerprint;
    const aBefore = a.conn.inbox.length;
    a.send({ t: 'present', cue: { kind: 'cardReveal', cardId: HELD_CARD } });
    expect(b.conn.all('present')).toEqual([
      { t: 'present', seat: 0, after: seqBefore - 1, cue: { kind: 'cardReveal', cardId: HELD_CARD } },
    ]);
    expect(a.conn.inbox.length).toBe(aBefore);
    a.send({ t: 'present', cue: { kind: 'cardFailed', cardId: HELD_CARD } });
    expect(b.conn.all('present').map((m) => m.cue.kind)).toEqual(['cardReveal', 'cardFailed']);
    expect(room.sequenceLength).toBe(seqBefore);
    expect(room.fingerprint).toBe(fpBefore);
    // 重放（失步自愈）里也没有它
    b.send({ t: 'resync' });
    const replay = b.conn.all('replay').at(-1)!;
    expect(replay.actions.length).toBe(seqBefore);
  });

  run('不是轮到的那一座 / 手里没那张卡 / 形状不对 ⇒ 静默丢弃', () => {
    const now = { t: 1000 };
    const { room, a, b } = table(now);
    // B 不是轮到的那一座 —— 他手里**有**这张也不收
    expect(room.state.players[1]!.cards).toEqual([OTHER_CARD]);
    b.send({ t: 'present', cue: { kind: 'cardReveal', cardId: OTHER_CARD } });
    // A 手里没有这张
    a.send({ t: 'present', cue: { kind: 'cardReveal', cardId: OTHER_CARD } });
    // 形状不对
    a.send({ t: 'present', cue: { kind: 'cardReveal', cardId: 0 } } as unknown as ClientMessage);
    a.send({ t: 'present', cue: { kind: 'explode', cardId: HELD_CARD } } as unknown as ClientMessage);
    a.send({ t: 'present', cue: null } as unknown as ClientMessage);
    a.send({ t: 'present', cue: { kind: 'toolLine', toolId: 2.5 } } as unknown as ClientMessage);
    expect(a.conn.all('present')).toEqual([]);
    expect(b.conn.all('present')).toEqual([]);
    expect(a.conn.all('error')).toEqual([]);
    // 道具：手里有的那件转、没有的不转（开局每人有几件道具，见 core `newGame`）
    const tools = room.state.tools;
    const held = [...Array(15).keys()].map((i) => i + 1).find((id) => toolCount(tools, 0, id) > 0)!;
    const missing = [...Array(15).keys()].map((i) => i + 1).find((id) => toolCount(tools, 0, id) === 0)!;
    a.send({ t: 'present', cue: { kind: 'toolLine', toolId: missing } });
    a.send({ t: 'present', cue: { kind: 'toolLine', toolId: held } });
    a.send({ t: 'present', cue: { kind: 'toolCancel', toolId: held } });
    expect(b.conn.all('present').map((m) => m.cue)).toEqual([
      { kind: 'toolLine', toolId: held },
      { kind: 'toolCancel', toolId: held },
    ]);
  });

  run('限速：每座每窗口至多 `PRESENT_RATE.max` 条，窗口过了再收', () => {
    const now = { t: 1000 };
    const { a, b } = table(now);
    for (let i = 0; i < PRESENT_RATE.max + 3; i++) a.send({ t: 'present', cue: { kind: 'cardReveal', cardId: HELD_CARD } });
    expect(b.conn.all('present')).toHaveLength(PRESENT_RATE.max);
    now.t += PRESENT_RATE.windowMs;
    a.send({ t: 'present', cue: { kind: 'cardReveal', cardId: HELD_CARD } });
    expect(b.conn.all('present')).toHaveLength(PRESENT_RATE.max + 1);
  });
});
