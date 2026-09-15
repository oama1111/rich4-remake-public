/*
 * 联机客户端：意图外发、按序施加、乱序缓冲、校验和、重连 since
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Action, type ClientMessage, type ServerMessage } from '@rich4/core';
import { NetClient, netParamsFrom, type NetClientOptions } from './net-client.ts';

function harness(extra: Partial<NetClientOptions> = {}) {
  const sent: ClientMessage[] = [];
  const applied: { action: Action; seq: number }[] = [];
  const events: string[] = [];
  let fp = 0;
  const client = new NetClient(
    { send: (text) => sent.push(JSON.parse(text) as ClientMessage) },
    {
      room: 'r1',
      name: '小明',
      onStart: (s) => events.push(`start:${s.seed}`),
      onAction: (action, seq) => {
        applied.push({ action, seq });
        fp++;
      },
      onRoom: (r) => events.push(`room:${r.seats.length}`),
      onJoined: (seat) => events.push(`joined:${seat}`),
      onError: (m) => events.push(`error:${m}`),
      onDesync: (d) => events.push(`desync:${d.seq}`),
      fingerprint: () => `fp${fp}`,
      ...extra,
    },
  );
  const push = (msg: ServerMessage) => client.receive(JSON.stringify(msg));
  return { client, sent, applied, events, push };
}

const roll: Action = { type: 'rollDice' };
const step: Action = { type: 'step' };

describe('NetClient', () => {
  it('join 带协议版本与房间名；start / submit 只发消息不施加', () => {
    const h = harness();
    h.client.join();
    h.client.start();
    h.client.submit(roll);
    expect(h.sent).toEqual([
      { t: 'join', version: PROTOCOL_VERSION, room: 'r1', name: '小明' },
      { t: 'start' },
      { t: 'intent', action: roll },
    ]);
    expect(h.applied).toEqual([]);
  });

  it('joined / room / start / error / desync 各自回调', () => {
    const h = harness();
    h.push({ t: 'joined', version: PROTOCOL_VERSION, seat: 2, room: { id: 'r1', seats: [], started: false } });
    expect(h.client.seat).toBe(2);
    h.push({ t: 'room', room: { id: 'r1', seats: [{ seat: 0, name: 'a', character: 0, kind: 'human' }], started: false } });
    h.push({ t: 'start', seed: 7, globalMapId: 0, seats: [] });
    h.push({ t: 'error', message: '拒绝' });
    h.push({ t: 'desync', seq: 9, expected: 'a', got: 'b', seat: 1 });
    expect(h.events).toEqual(['joined:2', 'room:1', 'start:7', 'error:拒绝', 'desync:9']);
    expect(h.client.room?.seats).toHaveLength(1);
  });

  it('★ 广播按序号施加；乱序的先攒着，凑齐再一口气按序施加', () => {
    const h = harness();
    h.push({ t: 'action', seq: 0, action: roll });
    h.push({ t: 'action', seq: 2, action: roll });
    h.push({ t: 'action', seq: 3, action: step });
    expect(h.applied.map((x) => x.seq)).toEqual([0]);
    expect(h.client.expectedSeq).toBe(1);
    h.push({ t: 'action', seq: 1, action: step });
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1, 2, 3]);
    expect(h.applied[1]?.action).toEqual(step);
    expect(h.client.expectedSeq).toBe(4);
  });

  it('重复的序号（重连补发时的重叠）直接丢，不会施加两次', () => {
    const h = harness();
    h.push({ t: 'action', seq: 0, action: roll });
    h.push({ t: 'action', seq: 0, action: roll });
    h.push({ t: 'action', seq: 1, action: step });
    h.push({ t: 'action', seq: 0, action: roll });
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1]);
  });

  it('★ 每 10 号上报一次校验和，带的是施加那条之后的指纹', () => {
    const h = harness();
    for (let i = 0; i < 25; i++) h.push({ t: 'action', seq: i, action: roll });
    const sums = h.sent.filter((m) => m.t === 'checksum');
    expect(sums).toEqual([
      { t: 'checksum', seq: 9, hash: 'fp10' },
      { t: 'checksum', seq: 19, hash: 'fp20' },
    ]);
  });

  it('checksumEvery 可调；0 关掉', () => {
    const h = harness({ checksumEvery: 0 });
    for (let i = 0; i < 25; i++) h.push({ t: 'action', seq: i, action: roll });
    expect(h.sent.filter((m) => m.t === 'checksum')).toEqual([]);
  });

  it('重连：join 带 since，本地从 since+1 开始期待', () => {
    const h = harness({ since: 41 });
    h.client.join();
    expect(h.sent[0]).toEqual({ t: 'join', version: PROTOCOL_VERSION, room: 'r1', name: '小明', since: 41 });
    expect(h.client.expectedSeq).toBe(42);
    h.push({ t: 'action', seq: 40, action: roll });
    h.push({ t: 'action', seq: 41, action: roll });
    h.push({ t: 'action', seq: 42, action: step });
    expect(h.applied.map((x) => x.seq)).toEqual([42]);
  });

  it('坏文本与不认识的消息一律忽略', () => {
    const h = harness();
    h.client.receive('{not json');
    h.client.receive('42');
    h.client.receive('{"t":"whatever"}');
    expect(h.applied).toEqual([]);
    expect(h.events).toEqual([]);
  });
});

describe('netParamsFrom', () => {
  it('没有 ws 参数就是单机', () => {
    expect(netParamsFrom('')).toBeNull();
    expect(netParamsFrom('?humans=1&ai=3')).toBeNull();
    expect(netParamsFrom('?ws=')).toBeNull();
  });

  it('有 ws 就联机；room 默认 default，name 缺省随机', () => {
    expect(netParamsFrom('?ws=ws://localhost:8787&room=r9&name=%E5%B0%8F%E6%98%8E')).toEqual({
      url: 'ws://localhost:8787',
      room: 'r9',
      name: '小明',
    });
    const p = netParamsFrom('?ws=ws://h:1');
    expect(p?.room).toBe('default');
    expect(p?.name).toMatch(/^玩家\d+$/);
  });
});
