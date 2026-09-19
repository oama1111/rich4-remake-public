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
import { PROTOCOL_VERSION, parseMap, type Rich4Map, type ServerMessage } from '@rich4/core';
import { RoomHub, type Conn } from './hub.ts';

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
  ha.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'A' });
  hb.onMessage({ t: 'join', version: PROTOCOL_VERSION, room: 'r', name: 'B' });
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
    expect(hub.roomInfo('r')?.globalMapId).toBe(0);

    // 房主改得动，并且是**广播给全房**（不是只回给房主）
    ha.onMessage({ t: 'setMap', globalMapId: 1 });
    expect(hub.roomInfo('r')?.globalMapId).toBe(1);
    expect(b.last('room')?.room.globalMapId).toBe(1);
  });

  run('服务器手上没有那张图 → 拒（不是等开局才发现）', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    a.clear();
    ha.onMessage({ t: 'setMap', globalMapId: 5 }); // mapFor 只认 0/1
    expect(a.last('error')?.message).toContain('沒有地圖');
    expect(hub.roomInfo('r')?.globalMapId).toBe(0);
  });

  run('地图号越界 / 非整数 → 拒', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    for (const bad of [8, 99, -1, 1.5, Number.NaN]) {
      a.clear();
      ha.onMessage({ t: 'setMap', globalMapId: bad });
      expect(a.last('error')?.message, String(bad)).toContain('不合法');
    }
    expect(hub.roomInfo('r')?.globalMapId).toBe(0);
  });

  run('改角色只改得动自己那一格（消息里没有座位号，服务器按连接认）', () => {
    const { hub, a, ha, hb } = twoPlayers(loadMap());
    hb.onMessage({ t: 'setCharacter', character: 5 });
    expect(hub.roomInfo('r')?.seats.map((s) => s.character)).toEqual([0, 5]);
    // 房主自己那格没被动过
    expect(a.count('error')).toBe(0);
    // 房主改自己的，也不影响别人
    ha.onMessage({ t: 'setCharacter', character: 9 });
    expect(hub.roomInfo('r')?.seats.map((s) => s.character)).toEqual([9, 5]);
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
    expect(hub.roomInfo('r')?.seats.map((s) => s.character)).toEqual([0, 1]);
  });

  run('角色号越界 / 非整数 → 拒', () => {
    const { hub, b, hb } = twoPlayers(loadMap());
    for (const bad of [12, -1, 2.5, Number.NaN]) {
      b.clear();
      hb.onMessage({ t: 'setCharacter', character: bad });
      expect(b.last('error')?.message, String(bad)).toContain('不合法');
    }
    expect(hub.roomInfo('r')?.seats.map((s) => s.character)).toEqual([0, 1]);
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
    const before = hub.roomInfo('r')!;
    a.clear();
    ha.onMessage({ t: 'setCharacter', character: 6 });
    expect(a.last('error')?.message).toContain('已開局');
    expect(hub.roomInfo('r')?.seats.map((s) => s.character)).toEqual(before.seats.map((s) => s.character));
  });

  run('开局后换地图被拒（房主也不行），房间地图不变', () => {
    const { hub, a, ha } = twoPlayers(loadMap());
    ha.onMessage({ t: 'start' });
    a.clear();
    ha.onMessage({ t: 'setMap', globalMapId: 1 });
    expect(a.last('error')?.message).toContain('已開局');
    expect(hub.roomInfo('r')?.globalMapId).toBe(0);
    expect(hub.room('r')!.lobby.globalMapId).toBe(0);
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
    const room = hub.room('r')!;
    expect(room.globalMapId).toBe(1);
    expect(room.lobby.globalMapId).toBe(1);
    expect(room.lobby.seats.map((s) => s.character)).toEqual([0, 5, 1, 2]);
    expect(room.state.players.map((p) => p.character)).toEqual([0, 5, 1, 2]);
  });
});
