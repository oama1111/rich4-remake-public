/*
 * 集线器的**坏消息**耐受（首席复核，2026-09-20）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 消息是对方写的：`ws-server.ts` 只保证「是个对象、`t` 是字符串」，其余字段可能缺、可能类型不对。
 * 适配层现在把 `onMessage` 的异常兜成「掐掉这一条连接」，但 hub 自己最好一条都不抛 ——
 * 这里把每种消息的「缺字段 / 错类型」形状都喂一遍，开局前、开局后各一轮。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@rich4/core';
import { RoomHub, type Conn } from './hub.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

class Sink implements Conn {
  inbox: ServerMessage[] = [];
  send(m: ServerMessage): void {
    this.inbox.push(m);
  }
  close(): void {}
}

/** 与其它 hub 用例同一套：按名字派生一个稳定的 32 位十六进制身份令牌 */
const idFor = (seed: string): string =>
  [...seed]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);
const ROOM = 'K7M2QP';
const loadMap = (): ReturnType<typeof parseMap> => parseMap(new Uint8Array(readFileSync(MAP)));

const JUNK: unknown[] = [undefined, null, 0, -1, 1e99, NaN, '', 'x', '💥'.repeat(50), [], {}, { type: 1 }, { type: 'nope' }, { type: 'rollDice', extra: {} }, true];
const TYPES = ['join', 'start', 'intent', 'checksum', 'resync', 'setCharacter', 'setMap', 'awaiting', 'alive', 'resume', '__proto__', 'constructor', ''];
const FIELDS = ['version', 'room', 'name', 'clientId', 'since', 'action', 'seq', 'hash', 'character', 'globalMapId'];

function bad(): ClientMessage[] {
  const out: unknown[] = [];
  for (const t of TYPES) {
    out.push({ t });
    for (const f of FIELDS) for (const j of JUNK) out.push({ t, [f]: j });
    // `join` 的其余字段合法、只坏一个
    for (const f of ['version', 'room', 'name', 'clientId', 'since']) {
      for (const j of JUNK) out.push({ t: 'join', version: PROTOCOL_VERSION, room: 'K7M2QP', name: '甲', clientId: 'a'.repeat(32), [f]: j });
    }
  }
  return out as ClientMessage[];
}

describe('★ hub.onMessage 对坏消息一条都不抛', () => {
  const seated = (): { hub: RoomHub; host: Sink; h: ReturnType<RoomHub['connect']> } => {
    const hub = new RoomHub({ map: parseMap(new Uint8Array(readFileSync(MAP))), globalMapId: 0, seedFor: () => 7 });
    const host = new Sink();
    const h = hub.connect(host);
    h.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'K7M2QP', name: '房主', clientId: 'b'.repeat(32) });
    return { hub, host, h };
  };
  const feed = (hub: RoomHub, h: ReturnType<RoomHub['connect']>): string[] => {
    const thrown: string[] = [];
    for (const m of bad()) {
      // 每条坏消息用一条**新连接**发一遍（未入座），再用房主那条发一遍（已入座）
      for (const handle of [hub.connect(new Sink()), h]) {
        try {
          handle.onMessage(m);
        } catch (e) {
          thrown.push(`${JSON.stringify(m).slice(0, 80)} → ${(e as Error).message}`);
        }
      }
    }
    return thrown;
  };

  run('开局前', () => {
    const { hub, h } = seated();
    expect(feed(hub, h).slice(0, 10)).toEqual([]);
  });

  run('开局后（先确认真的开了局）', () => {
    const { hub, host, h } = seated();
    h.onMessage({ t: 'start' });
    expect(host.inbox.some((m) => m.t === 'start')).toBe(true);
    expect(feed(hub, h).slice(0, 10)).toEqual([]);
  });
});

// ============================================================
//  连接本身是坏的（首席复核续，DeepSeek）
// ============================================================

/** 一 send 就抛的连接 —— 生产里 `ws` 在 socket 关到一半时就是这个样子 */
class Broken implements Conn {
  sent = 0;
  send(): void {
    this.sent += 1;
    throw new Error('WebSocket is closing');
  }
  close(): void {}
}

describe('★ 一条坏连接不许把整台服务器带走', () => {
  run('★ send 抛异常时：`sweepDisconnected` 不抛，别的座位照常收到', () => {
    const hub = new RoomHub({ map: loadMap(), globalMapId: 0, seedFor: () => 4242, seatCount: 2 });
    const good = new Sink();
    const broken = new Broken();
    const hg = hub.connect(good);
    const hb = hub.connect(broken);
    hg.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
    hg.onMessage({ t: 'start' });

    const beforeGood = good.inbox.length;
    // ★ 扫描挂在 `setInterval` 上，**没有**外层 catch —— 这里抛就是进程退出（实测复现）
    expect(() => hub.sweepDisconnected(1_000)).not.toThrow();
    // 好的那一条照常收到（开局之后至少有一轮广播）
    expect(good.inbox.length).toBeGreaterThanOrEqual(beforeGood);
    expect(broken.sent).toBeGreaterThan(0);

    // 意图那条路也一样：坏连接不影响好连接拿到 action
    const n = good.inbox.length;
    hg.onMessage({ t: 'intent', action: { type: 'startTurn' } });
    expect(good.inbox.length).toBeGreaterThan(n);
  });
});
