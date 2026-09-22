/*
 * 联机客户端：意图外发、按序施加、乱序缓冲、校验和、重连 since
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  LOBBY_DEFAULT_OPTIONS,
  PROTOCOL_VERSION,
  type Action,
  type ClientMessage,
  type SeatInfo,
  type ServerMessage,
} from '@rich4/core';
import { NetClient, netParamsFrom, type NetClientOptions } from './net-client.ts';

function harness(extra: Partial<NetClientOptions> = {}) {
  const sent: ClientMessage[] = [];
  const applied: { action: Action; seq: number }[] = [];
  const events: string[] = [];
  const resyncs: { seed: number; globalMapId: number; seats: SeatInfo[]; actions: Action[] }[] = [];
  let fp = 0;
  const client = new NetClient(
    { send: (text) => sent.push(JSON.parse(text) as ClientMessage) },
    {
      room: 'r1',
      name: '小明',
      // ★ W-73：join 必带的身份令牌
      clientId: CLIENT_ID,
      onStart: (s) => events.push(`start:${s.seed}`),
      onAction: (action, seq) => {
        applied.push({ action, seq });
        fp++;
      },
      onRoom: (r) => events.push(`room:${r.seats.length}`),
      onJoined: (seat) => events.push(`joined:${seat}`),
      onError: (m) => events.push(`error:${m}`),
      onDesync: (d) => events.push(`desync:${d.seq}`),
      // 模拟上层（main.ts）的「整体替换本地状态」
      onResync: (r) => {
        resyncs.push(r);
        applied.length = 0;
        fp = 0;
        r.actions.forEach((action, seq) => {
          applied.push({ action, seq });
          fp++;
        });
      },
      fingerprint: () => `fp${fp}`,
      ...extra,
    },
  );
  const push = (msg: ServerMessage) => client.receive(JSON.stringify(msg));
  return { client, sent, applied, events, resyncs, push };
}

const roll: Action = { type: 'rollDice' };
const step: Action = { type: 'step' };

/** ★ W-73：join 必带的身份令牌（32 位小写十六进制） */
const CLIENT_ID = '0123456789abcdef0123456789abcdef';

describe('NetClient', () => {
  it('join 带协议版本与房间名；start / submit 只发消息不施加', () => {
    const h = harness();
    h.client.join();
    h.client.start();
    h.client.submit(roll);
    expect(h.sent).toEqual([
      { t: 'join', version: PROTOCOL_VERSION, room: 'r1', name: '小明', clientId: CLIENT_ID },
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
    h.push({ t: 'start', seed: 7, globalMapId: 0, seats: [], options: LOBBY_DEFAULT_OPTIONS });
    h.push({ t: 'error', message: '拒绝' });
    h.push({ t: 'desync', seq: 9, expected: 'a', got: 'b', seat: 1 });
    expect(h.events).toEqual(['joined:2', 'room:1', 'start:7', 'error:拒绝', 'desync:9']);
    expect(h.client.room?.seats).toHaveLength(1);
  });

  it('★ Q-NET-2：setCharacter / setMap 只发请求不先改本地；收到 room 广播才更新座位板', () => {
    const h = harness();
    h.client.setCharacter(5);
    h.client.setMap(1);
    expect(h.sent).toEqual([
      { t: 'setCharacter', character: 5 },
      { t: 'setMap', globalMapId: 1 },
    ]);
    // ★ 本地不等确认：刚发出去时本地快照还是空的
    expect(h.client.room).toBeNull();

    // 服务器校验通过后广播整份房间快照 —— 座位板照它更新
    h.push({
      t: 'room',
      room: {
        id: 'r1',
        globalMapId: 1,
        started: false,
        seats: [{ seat: 0, name: '小明', character: 5, kind: 'human' }],
      },
    });
    expect(h.client.room?.globalMapId).toBe(1);
    expect(h.client.room?.seats[0]?.character).toBe(5);
    expect(h.events).toContain('room:1');

    // 被拒时不会伪造本地改动
    h.push({ t: 'error', message: '拒絕：這個角色已經有人選了' });
    expect(h.events).toContain('error:拒絕：這個角色已經有人選了');
    expect(h.client.room?.seats[0]?.character).toBe(5);
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

  it('★ deferChecksum：收下时**不报**；宿主真的施加到第 10 / 20 号时才报，带的是**那一刻**的指纹（第七份试玩回报 #1）', () => {
    // 宿主把广播排队按演出节拍播：`onAction` 返回时本地状态还没动，那一刻取指纹必然「失步」。
    const sent: ClientMessage[] = [];
    const inbox: number[] = [];
    let appliedCount = 0;
    const client = new NetClient(
      { send: (text) => sent.push(JSON.parse(text) as ClientMessage) },
      {
        room: 'r1',
        name: '小明',
        clientId: CLIENT_ID,
        deferChecksum: true,
        onStart: () => undefined,
        onAction: (_a, seq) => inbox.push(seq),
        fingerprint: () => `fp${appliedCount}`,
      },
    );
    for (let i = 0; i < 25; i++) client.receive(JSON.stringify({ t: 'action', seq: i, action: roll }));
    expect(inbox).toHaveLength(25);
    expect(sent.filter((m) => m.t === 'checksum')).toEqual([]); // 一条都还没施加 ⇒ 一条都不报
    for (const seq of inbox) {
      appliedCount++;
      client.noteApplied(seq);
    }
    expect(sent.filter((m) => m.t === 'checksum')).toEqual([
      { t: 'checksum', seq: 9, hash: 'fp10' },
      { t: 'checksum', seq: 19, hash: 'fp20' },
    ]);
  });

  it('不开 deferChecksum 时 `noteApplied` 是空操作（老路径不重复报）', () => {
    const h = harness();
    for (let i = 0; i < 10; i++) h.push({ t: 'action', seq: i, action: roll });
    h.client.noteApplied(9);
    expect(h.sent.filter((m) => m.t === 'checksum')).toHaveLength(1);
  });

  it('checksumEvery 可调；0 关掉', () => {
    const h = harness({ checksumEvery: 0 });
    for (let i = 0; i < 25; i++) h.push({ t: 'action', seq: i, action: roll });
    expect(h.sent.filter((m) => m.t === 'checksum')).toEqual([]);
  });

  it('重连：join 带 since，本地从 since+1 开始期待', () => {
    const h = harness({ since: 41 });
    h.client.join();
    expect(h.sent[0]).toEqual({
      t: 'join',
      version: PROTOCOL_VERSION,
      room: 'r1',
      name: '小明',
      clientId: CLIENT_ID,
      since: 41,
    });
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

  it('★ Q-NET-1：desync 自动请求重放；replay 到达后整体替换本地状态并接上序号', () => {
    const h = harness();
    h.push({ t: 'action', seq: 0, action: roll });
    h.push({ t: 'action', seq: 1, action: step });
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1]);
    expect(h.sent.filter((m) => m.t === 'resync')).toEqual([]);

    // 服务器广播失步（广播给所有人，未必是本座位）
    h.push({ t: 'desync', seq: 9, expected: 'aaaa', got: 'bbbb', seat: 2 });
    expect(h.events).toContain('desync:9');
    expect(h.sent.filter((m) => m.t === 'resync')).toEqual([{ t: 'resync' }]);
    expect(h.client.resyncing).toBe(true);

    // 未决期间再来的 desync 不重复请求
    h.push({ t: 'desync', seq: 9, expected: 'aaaa', got: 'bbbb', seat: 2 });
    expect(h.sent.filter((m) => m.t === 'resync')).toHaveLength(1);

    // 服务器回全量重放 0..4
    const seats: SeatInfo[] = [{ seat: 0, name: '小明', character: 0, kind: 'human' }];
    const actions = [roll, step, roll, step, roll];
    h.push({
      t: 'replay',
      options: LOBBY_DEFAULT_OPTIONS,
      seed: 7,
      globalMapId: 0,
      seats,
      through: 4,
      actions: actions.map((action, seq) => ({ seq, action })),
    });

    expect(h.resyncs).toHaveLength(1);
    expect(h.resyncs[0]?.seed).toBe(7);
    expect(h.resyncs[0]?.actions).toEqual(actions);
    // ★ 是**替换**不是叠加：旧的 0/1 记录被清掉，重建后是整串
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(h.client.expectedSeq).toBe(5);
    expect(h.client.resyncing).toBe(false);

    // 之后接着重放末尾往下走；指纹也按重建后的状态算
    for (let seq = 5; seq <= 9; seq++) h.push({ t: 'action', seq, action: step });
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(h.client.expectedSeq).toBe(10);
    expect(h.sent.filter((m) => m.t === 'checksum')).toEqual([{ t: 'checksum', seq: 9, hash: 'fp10' }]);
  });

  it('形状不对的 replay 不碰序号；被拒的 resync 之后还能再请求', () => {
    const h = harness();
    h.push({ t: 'action', seq: 0, action: roll });
    h.push({ t: 'desync', seq: 0, expected: 'a', got: 'b', seat: 0 });
    expect(h.client.resyncing).toBe(true);
    // 缺 through/actions：当没收到，指针不动，但解锁以便重试
    h.push({ t: 'replay' } as unknown as ServerMessage);
    expect(h.client.expectedSeq).toBe(1);
    expect(h.client.resyncing).toBe(false);

    // 服务器回 error（例如还没开局）→ 解锁，下一次 desync 仍会请求
    h.push({ t: 'desync', seq: 0, expected: 'a', got: 'b', seat: 0 });
    h.push({ t: 'error', message: '還沒開局' });
    h.push({ t: 'desync', seq: 0, expected: 'a', got: 'b', seat: 0 });
    expect(h.sent.filter((m) => m.t === 'resync')).toHaveLength(3);
  });

  it('replay 会丢掉攒着没施加的旧广播（它们都在重放里了）', () => {
    const h = harness();
    h.push({ t: 'action', seq: 1, action: step }); // 缺 0，先攒着
    expect(h.applied).toEqual([]);
    h.push({
      t: 'replay',
      options: LOBBY_DEFAULT_OPTIONS,
      seed: 1,
      globalMapId: 0,
      seats: [],
      through: 2,
      actions: [roll, step, roll].map((action, seq) => ({ seq, action })),
    });
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1, 2]);
    // 之后补发来的 1 号是重复的，直接丢
    h.push({ t: 'action', seq: 1, action: step });
    expect(h.applied.map((x) => x.seq)).toEqual([0, 1, 2]);
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
