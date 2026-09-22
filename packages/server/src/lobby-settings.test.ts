/*
 * Q-NET-2：大厅设置（改角色 / 换地图）—— **服务器**这一侧的校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 三条硬规矩，各一个 describe：
 *   ① **权限**：换地图只有房主（0 号座）；改角色只能改自己的座位
 *      —— 消息体里根本没有 `seat`，服务器从**连接**上认，客户端连
 *      「改别人的角色」都表达不出来；
 *   ② **撞车**：同一房内角色唯一（含开局时电脑补位，也不许撞）；
 *   ③ **未开局**：开局之后两者都拒 —— 角色/地图在 `newGame` 里就烧进
 *      局面了，开局后再改会让服务器镜像与各客户端当场分歧。
 *
 * ★ 这些校验刻意全部放在**服务器**：客户端的命中测试只是别让 UI 骗玩家
 *   「这个能点」，绕过去也改不动房间。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  GAME_INITIAL_FUNDS,
  LOBBY_DEFAULT_OPTIONS,
  PROTOCOL_VERSION,
  parseMap,
  roomOptions,
  winConditionsOf,
  withLobbyDefaults,
  type LobbyOptions,
  type Rich4Map,
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
const loadMap = (): Rich4Map => parseMap(new Uint8Array(readFileSync(MAP)));

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
  clear(): void {
    this.inbox.length = 0;
  }
}

/** 服务器只「端得出」第 0、1 两张图；其余地图元数据缺失（模拟真实缺图） */
function hubWith(map: Rich4Map, mapIds: readonly number[] = [0, 1]) {
  return new RoomHub({
    map,
    globalMapId: 0,
    seedFor: () => 7,
    mapFor: (id) => (mapIds.includes(id) ? map : null),
  });
}

/** 两人进同一房：返回 [hub, 房主句柄+连接, 客人句柄+连接] */
function twoPlayers(map: Rich4Map) {
  const hub = hubWith(map);
  const a = new FakeConn();
  const b = new FakeConn();
  const ha = hub.connect(a);
  const hb = hub.connect(b);
  ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
  hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'B', clientId: idFor('B') });
  return { hub, a, b, ha, hb };
}

// ============================================================
//  ① 权限
// ============================================================

describe('★ Q-NET-2 权限', () => {
  run('换地图只有房主：非房主发 setMap 被拒，房间地图纹丝不动', () => {
    const { hub, b, ha, hb } = twoPlayers(loadMap());
    hb.onMessage({ t: 'setMap', globalMapId: 1 });
    expect(b.last('error')?.message).toContain('房主');
    expect(hub.roomInfo(ROOM)?.globalMapId).toBe(0);

    // 房主改得动，并且是**广播给全房**（不是只回给房主）
    ha.onMessage({ t: 'setMap', globalMapId: 1 });
    expect(hub.roomInfo(ROOM)?.globalMapId).toBe(1);
    expect(b.last('room')?.room.globalMapId).toBe(1);
  });

  run('服务器手上没有那张图 → 拒（不是等开局才发现）', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    a.clear();
    ha.onMessage({ t: 'setMap', globalMapId: 5 }); // mapFor 只认 0/1
    expect(a.last('error')?.message).toContain('沒有地圖');
    expect(hub.roomInfo(ROOM)?.globalMapId).toBe(0);
  });

  run('地图号越界 / 非整数 → 拒', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    for (const bad of [8, 99, -1, 1.5, Number.NaN]) {
      a.clear();
      ha.onMessage({ t: 'setMap', globalMapId: bad });
      expect(a.last('error')?.message, String(bad)).toContain('不合法');
    }
    expect(hub.roomInfo(ROOM)?.globalMapId).toBe(0);
  });

  run('改角色只改得动自己那一格（消息里没有座位号，服务器按连接认）', () => {
    const { hub, a, ha, hb } = twoPlayers(loadMap());
    hb.onMessage({ t: 'setCharacter', character: 5 });
    expect(hub.roomInfo(ROOM)?.seats.map((s) => s.character)).toEqual([0, 5]);
    // 房主自己那格没被动过
    expect(a.count('error')).toBe(0);
    // 房主改自己的，也不影响别人
    ha.onMessage({ t: 'setCharacter', character: 9 });
    expect(hub.roomInfo(ROOM)?.seats.map((s) => s.character)).toEqual([9, 5]);
  });
});

// ============================================================
//  ② 撞车
// ============================================================

describe('★ Q-NET-2 角色不能撞车', () => {
  run('选别人已占的角色 → 拒，谁的角色都没变', () => {
    const { hub, b, hb } = twoPlayers(loadMap());
    hb.onMessage({ t: 'setCharacter', character: 0 }); // 0 号是房主的
    expect(b.last('error')?.message).toContain('已經有人');
    expect(hub.roomInfo(ROOM)?.seats.map((s) => s.character)).toEqual([0, 1]);
  });

  run('角色号越界 / 非整数 → 拒', () => {
    const { hub, b, hb } = twoPlayers(loadMap());
    for (const bad of [12, -1, 2.5, Number.NaN]) {
      b.clear();
      hb.onMessage({ t: 'setCharacter', character: bad });
      expect(b.last('error')?.message, String(bad)).toContain('不合法');
    }
    expect(hub.roomInfo(ROOM)?.seats.map((s) => s.character)).toEqual([0, 1]);
  });

  run('改回自己原来的角色是幂等（不算撞车、也不白广播一次）', () => {
    const { b, hb } = twoPlayers(loadMap());
    b.clear();
    hb.onMessage({ t: 'setCharacter', character: 1 });
    expect(b.count('error')).toBe(0);
    expect(b.count('room')).toBe(0);
  });

  run('★ 开局补电脑时也不许撞车 —— 真人挑过的号要跳过', () => {
    const { a, ha } = twoPlayers(loadMap());
    // 房主把 0 号让出去、自己抢 3 号；客人保留 1 号
    ha.onMessage({ t: 'setCharacter', character: 3 });
    a.clear();
    ha.onMessage({ t: 'start' });
    const st = a.last('start')!;
    const chars = st.seats.map((s) => s.character);
    expect(chars).toEqual([3, 1, 0, 2]); // 电脑取最小空号，确定性
    expect(new Set(chars).size).toBe(chars.length);
  });
});

// ============================================================
//  ③ 开局后拒绝
// ============================================================

describe('★ Q-NET-2 开局后一律拒绝', () => {
  run('开局后改角色被拒，服务器镜像/房间快照不变', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'start' });
    const before = hub.roomInfo(ROOM)!;
    a.clear();
    ha.onMessage({ t: 'setCharacter', character: 6 });
    expect(a.last('error')?.message).toContain('已開局');
    expect(hub.roomInfo(ROOM)?.seats.map((s) => s.character)).toEqual(before.seats.map((s) => s.character));
  });

  run('开局后换地图被拒（房主也不行），房间地图不变', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'start' });
    a.clear();
    ha.onMessage({ t: 'setMap', globalMapId: 1 });
    expect(a.last('error')?.message).toContain('已開局');
    expect(hub.roomInfo(ROOM)?.globalMapId).toBe(0);
    expect(hub.room(ROOM)!.lobby.globalMapId).toBe(0);
  });
});

// ============================================================
//  ④ 开局用的就是这份大厅设置
// ============================================================

describe('★ Q-NET-2 开局读服务器那份设置', () => {
  run('start 广播与 core 镜像都用改过的角色 + 换过的地图', () => {
    const map = loadMap();
    const { hub, a, ha, hb } = twoPlayers(map);
    ha.onMessage({ t: 'setMap', globalMapId: 1 });
    hb.onMessage({ t: 'setCharacter', character: 7 });
    hb.onMessage({ t: 'setCharacter', character: 5 }); // 再改一次，取最后一次
    a.clear();
    ha.onMessage({ t: 'start' });

    const st = a.last('start')!;
    expect(st.globalMapId).toBe(1);
    expect(st.seats.map((s) => s.character)).toEqual([0, 5, 1, 2]);

    // Room 保存的大厅设置就是这一份，镜像里的角色也照它建
    const room = hub.room(ROOM)!;
    expect(room.globalMapId).toBe(1);
    expect(room.lobby.globalMapId).toBe(1);
    expect(room.lobby.seats.map((s) => s.character)).toEqual([0, 5, 1, 2]);
    expect(room.state.players.map((p) => p.character)).toEqual([0, 5, 1, 2]);
  });
});

// ============================================================
//  ⑤ ★★ 第十一份試玩回報 #1：開局設定六行（人數 = 總人數）
// ============================================================

describe('★★ 大厅「開局設定」（第十一份試玩回報 #1）', () => {
  run('★ 新房间的初值 = 服务器 --seats（老用法还成立），且一定落在合法区间', () => {
    const map = loadMap();
    expect(hubWith(map).roomInfo(ROOM)).toBeNull(); // 还没人进过房
    const hub = new RoomHub({ map, globalMapId: 0, seedFor: () => 7, seatCount: 2 });
    const a = new FakeConn();
    hub.connect(a).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'A', clientId: idFor('A') });
    expect(roomOptions(hub.roomInfo(ROOM)).seatCount).toBe(2);

    // 越界的 `--seats` 不该造出一个打不开的房间
    const hub9 = new RoomHub({ map, globalMapId: 0, seedFor: () => 7, seatCount: 9 });
    const c = new FakeConn();
    hub9.connect(c).onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'C', clientId: idFor('C') });
    expect(roomOptions(hub9.roomInfo(ROOM)).seatCount).toBe(4);
  });

  run('房主改得动，并且广播给全房（含其它五项）', () => {
    const { hub, b, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'setOptions', options: { fundIndex: 3, vehicle: 2, landTenure: 1, timeIndex: 2, victoryIndex: 5 } });
    expect(b.last('error')).toBeUndefined();
    const o = roomOptions(hub.roomInfo(ROOM));
    expect(o).toMatchObject({ fundIndex: 3, vehicle: 2, landTenure: 1, timeIndex: 2, victoryIndex: 5 });
    expect(b.last('room')?.room.options).toEqual(o); // 广播里带着整份
  });

  run('★ 非房主改不动（消息里根本没有座位号，服务器按连接认）', () => {
    const { hub, b, hb } = twoPlayers(loadMap());
    hb.onMessage({ t: 'setOptions', options: { fundIndex: 4 } });
    expect(b.last('error')?.message).toContain('房主');
    expect(roomOptions(hub.roomInfo(ROOM)).fundIndex).toBe(0);
  });

  run('★ 逐项越界 / 非整数 → 拒，整份设置纹丝不动（不是「改一半」）', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    const bads: Partial<LobbyOptions>[] = [
      { seatCount: 1 },
      { seatCount: 5 },
      { seatCount: 2.5 },
      { fundIndex: 6 },
      { fundIndex: -1 },
      { vehicle: 3 },
      { landTenure: 6 },
      { timeIndex: 6 },
      { victoryIndex: 6 },
      { fundIndex: Number.NaN },
    ];
    for (const bad of bads) {
      a.clear();
      ha.onMessage({ t: 'setOptions', options: bad });
      expect(a.last('error'), JSON.stringify(bad)).toBeDefined();
      expect(roomOptions(hub.roomInfo(ROOM)), JSON.stringify(bad)).toEqual(LOBBY_DEFAULT_OPTIONS);
    }
    // ★ 一份 patch 里**只要有一项不合法，整份都不落地**：否则会留下半份设置
    a.clear();
    ha.onMessage({ t: 'setOptions', options: { fundIndex: 5, vehicle: 9 } });
    expect(a.last('error')).toBeDefined();
    expect(roomOptions(hub.roomInfo(ROOM)).fundIndex).toBe(0);
  });

  run('★ 人數不能少于**已经在座的真人**（房主不能把人踢出局）', () => {
    const { hub, a, ha } = twoPlayers(loadMap()); // 默认 4 人，A/B 在座
    // 两人在座，改成 2 人是允许的（正好坐下）
    ha.onMessage({ t: 'setOptions', options: { seatCount: 2 } });
    expect(roomOptions(hub.roomInfo(ROOM)).seatCount).toBe(2);

    // 改回 4 人再放进第 3 个人，然后想缩回 2 人就该被拒
    ha.onMessage({ t: 'setOptions', options: { seatCount: 4 } });
    const c = new FakeConn();
    const hc = hub.connect(c);
    hc.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'C', clientId: idFor('C') });
    expect(hub.roomInfo(ROOM)?.seats.length).toBe(3);
    // ⚠️ 拒绝只回给**发起者**（`#sendTo(conn)`），不是广播 —— 别人看不到这条错
    a.clear();
    ha.onMessage({ t: 'setOptions', options: { seatCount: 2 } });
    expect(a.last('error')?.message).toContain('不能少於');
    expect(roomOptions(hub.roomInfo(ROOM)).seatCount).toBe(4); // 停在原来那个数，不受影响
  });

  run('★ 人數满了之后第 N+1 个人进不来（进房上限看的是房间设的总人数）', () => {
    const { hub, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'setOptions', options: { seatCount: 2 } });
    const c = new FakeConn();
    const hc = hub.connect(c);
    hc.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: ROOM, name: 'C', clientId: idFor('C') });
    expect(c.last('error')?.message).toContain('已满');
    expect(hub.roomInfo(ROOM)?.seats.map((s) => s.name)).toEqual(['A', 'B']);
  });

  run('★ 开局后一律拒绝（房主也不行），房间设置不变', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'start' });
    const before = roomOptions(hub.roomInfo(ROOM));
    a.clear();
    ha.onMessage({ t: 'setOptions', options: { fundIndex: 2 } });
    expect(a.last('error')?.message).toContain('開局');
    expect(roomOptions(hub.roomInfo(ROOM))).toEqual(before);
  });
});

// ============================================================
//  ⑥ ★★ 开局**用的就是**这份设置（人数补电脑 / 五项都烧进局面）
// ============================================================

describe('★★ 开局读房间那份開局設定', () => {
  run('★ 设总人数 4、只有 2 个真人 → 开局自动补 2 个电脑凑齐 4 人', () => {
    const { a, ha } = twoPlayers(loadMap()); // 默认 4 人
    ha.onMessage({ t: 'setOptions', options: { seatCount: 4 } });
    a.clear();
    ha.onMessage({ t: 'start' });
    const st = a.last('start')!;
    expect(st.seats).toHaveLength(4);
    expect(st.seats.map((s) => s.kind)).toEqual(['human', 'human', 'computer', 'computer']);
    // 补进来的电脑名字是「電腦3/電腦4」，座位号连号
    expect(st.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
  });

  run('★ 设总人数 2 → 就只有 2 个座位（不多补）', () => {
    const { a, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'setOptions', options: { seatCount: 2 } });
    a.clear();
    ha.onMessage({ t: 'start' });
    const st = a.last('start')!;
    expect(st.seats).toHaveLength(2);
    expect(st.seats.every((s) => s.kind === 'human')).toBe(true);
  });

  run('★ start 广播与 core 镜像都带上那五项设置，并且真的生效', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    ha.onMessage({
      t: 'setOptions',
      options: { fundIndex: 5, vehicle: 2, landTenure: 1, timeIndex: 2, victoryIndex: 3 },
    });
    a.clear();
    ha.onMessage({ t: 'start' });

    const st = a.last('start')!;
    const want = withLobbyDefaults({ fundIndex: 5, vehicle: 2, landTenure: 1, timeIndex: 2, victoryIndex: 3, seatCount: 4 });
    expect(st.options).toEqual(want);
    expect(hub.room(ROOM)!.lobby.options).toEqual(want);

    // ★ 不是「广播里带着好看的字段」—— 局面里必须真的是这一档
    const state = hub.room(ROOM)!.state;
    const fund = GAME_INITIAL_FUNDS[5]!;
    expect(state.initialFund).toBe(fund);
    expect(state.landTenureIndex).toBe(1);
    expect(state.winConditions).toEqual(winConditionsOf(5, 2, 3));
    // 載具是 `trafficMethod`（原版 `player+0x11`），开局对所有人一律生效
    expect(new Set(state.players.map((p) => p.trafficMethod))).toEqual(new Set([2]));
  });
});
