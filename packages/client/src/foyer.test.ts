/*
 * W-73：门厅的**纯逻辑** —— 房间码、名字、旧邀请链接、身份令牌、入口路由
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 覆盖层本身（`showFoyer`）不在这里测：那要引一个 DOM 实现，为一个覆盖层不值。
 *   它的两个入口（單人模式 / 在線聯機 → 房间列表）在浏览器里验收。
 * ★ 2026-09-23 房间列表：房间码输入框与「複製邀請連結」从主路径拿掉了 ——
 *   `looksLikeRoomCode` / `inviteLink` 随之删除（它们测的是我们自己的 UI，不是原版真值）；
 *   旧 `?room=` 链接仍然要认（`inviteRoomFrom`），下面那组照旧钉着。
 */

import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isClientId, isRoomCode } from '@rich4/core';
import {
  CLIENT_ID_BYTES,
  CLIENT_ID_STORAGE_KEY,
  NAME_STORAGE_KEY,
  type FoyerStorage,
  foyerEntry,
  inviteRoomFrom,
  loadClientId,
  loadName,
  newClientId,
  newRoomCode,
  normalizeRoomCode,
  saveName,
  validateName,
  withoutRoomParam,
} from './foyer.ts';

/** 只存在内存里的假 localStorage */
function fakeStorage(seed: Record<string, string> = {}): { store: Map<string, string>; storage: FoyerStorage } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
    },
  };
}

/** 依次吐出给定字节的假随机源 */
function bytesFrom(values: number[]): (bytes: Uint8Array) => void {
  let at = 0;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = values[at++ % values.length]!;
  };
}

describe('★ 房间码', () => {
  it('6 位，且每一个字符都在那 32 个里', () => {
    for (let i = 0; i < 200; i++) {
      const code = newRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const c of code) expect(ROOM_CODE_ALPHABET).toContain(c);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it('★ 字符集里没有 I / O / 0 / 1（口头念给朋友不会听错）', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  });

  it('注入随机源时是确定的；`byte % 32` 不引入取模偏差', () => {
    expect(newRoomCode(bytesFrom([0, 1, 2, 3, 4, 5]))).toBe('ABCDEF');
    expect(newRoomCode(bytesFrom([31, 30, 29, 28, 27, 26]))).toBe('987654');
    // 255=8*31+7 ⇒ 最后一个字符；256 是 32 的整数倍 ⇒ 均匀
    expect(newRoomCode(bytesFrom([255]))).toBe('999999');
    expect(newRoomCode(bytesFrom([32]))).toBe('AAAAAA');
  });
});

describe('★ 旧邀请链接（`?room=`）仍然认', () => {
  it('去空格、转大写', () => {
    expect(normalizeRoomCode(' k7m2 qp ')).toBe('K7M2QP');
    expect(normalizeRoomCode('k7m2qp')).toBe('K7M2QP');
    expect(normalizeRoomCode('\tk7m2qp\n')).toBe('K7M2QP');
  });

  it('解析：读得回来；缺参数 / 不合法一律 `null`', () => {
    expect(inviteRoomFrom('?room=K7M2QP')).toBe('K7M2QP');
    expect(inviteRoomFrom('?ws=ws://x&room=k7m2qp&name=A')).toBe('K7M2QP');
    expect(inviteRoomFrom('')).toBeNull();
    expect(inviteRoomFrom('?ws=ws://x&name=A')).toBeNull();
    expect(inviteRoomFrom('?room=K7M2Q')).toBeNull(); // 少一位
    expect(inviteRoomFrom('?room=IK7M2Q')).toBeNull(); // 含 I
  });

  it('用过一次就从地址里拿掉 `room`，其余参数原样保留', () => {
    expect(withoutRoomParam('?room=K7M2QP')).toBe('');
    expect(withoutRoomParam('?mute=1&room=K7M2QP')).toBe('?mute=1');
    expect(new URLSearchParams(withoutRoomParam('?room=K7M2QP&ws=ws://h:1/ws&mute=1')).get('ws')).toBe('ws://h:1/ws');
    expect(withoutRoomParam('')).toBe('');
  });
});

describe('★ 入口路由（`foyerEntry`）', () => {
  it('`?ws=` + `?room=` 同时出现 ⇒ 老调试入口（`tools/net-e2e.js`），不经门厅', () => {
    expect(foyerEntry('?ws=ws://localhost:8787/ws&room=K7M2QP&name=A')).toEqual({ kind: 'direct' });
    // 老入口对房间码不做本地校验（服务器会校验）—— 路由只看参数在不在
    expect(foyerEntry('?ws=ws://x/ws&room=r1')).toEqual({ kind: 'direct' });
  });

  it('只有 `?ws=` ⇒ 门厅，但列表 / 进房都连这台服务器（本机调试）', () => {
    expect(foyerEntry('?mute=1&ws=ws://localhost:8799/ws')).toEqual({
      kind: 'foyer',
      wsUrl: 'ws://localhost:8799/ws',
      inviteRoom: null,
    });
  });

  it('只有 `?room=` ⇒ 门厅带着邀请（直接进那一间）；码不合法当没有', () => {
    expect(foyerEntry('?room=k7m2qp')).toEqual({ kind: 'foyer', wsUrl: null, inviteRoom: 'K7M2QP' });
    expect(foyerEntry('?room=nope')).toEqual({ kind: 'foyer', wsUrl: null, inviteRoom: null });
  });

  it('什么都没有 ⇒ 门厅首页；`?ws=` 为空串当没给', () => {
    expect(foyerEntry('')).toEqual({ kind: 'foyer', wsUrl: null, inviteRoom: null });
    expect(foyerEntry('?ws=')).toEqual({ kind: 'foyer', wsUrl: null, inviteRoom: null });
  });
});

describe('★ 名字', () => {
  it('1~12 个**码点**；去首尾空白', () => {
    expect(validateName(' 小明 ')).toEqual({ ok: true, name: '小明' });
    expect(validateName('a')).toEqual({ ok: true, name: 'a' });
    expect(validateName('x'.repeat(12))).toEqual({ ok: true, name: 'x'.repeat(12) });
    expect(validateName('x'.repeat(13)).ok).toBe(false);
  });

  it('★ 按码点数，不按 UTF-16 单元（`[...name].length`）', () => {
    // 「𠮷」是一个码点、两个 UTF-16 单元 —— 数错了 6 个这样的字就会被误判成 12
    expect(validateName('𠮷'.repeat(12))).toEqual({ ok: true, name: '𠮷'.repeat(12) });
    expect(validateName('𠮷'.repeat(13)).ok).toBe(false);
    expect(validateName('👍'.repeat(12)).ok).toBe(true);
  });

  it('空 / 只有空白 / 只有控制字符 → 拒', () => {
    expect(validateName('').ok).toBe(false);
    expect(validateName('   ').ok).toBe(false);
    expect(validateName('\u0000\u0007').ok).toBe(false);
  });

  it('控制字符被**去掉**（不是整条拒掉）', () => {
    expect(validateName('小\u0000明')).toEqual({ ok: true, name: '小明' });
    expect(validateName('\u0007小明\n')).toEqual({ ok: true, name: '小明' });
  });

  it('读 / 写上次用的名字；存的是脏的就当没有', () => {
    const { store, storage } = fakeStorage();
    expect(loadName(storage)).toBe('');
    saveName(storage, '小明');
    expect(store.get(NAME_STORAGE_KEY)).toBe('小明');
    expect(loadName(storage)).toBe('小明');
    expect(loadName(fakeStorage({ [NAME_STORAGE_KEY]: '\u0000' }).storage)).toBe('');
    expect(loadName(null)).toBe('');
  });
});

describe('★ 身份令牌（clientId）', () => {
  it('16 字节 → 32 位小写十六进制，且服务器认这个形状', () => {
    const id = newClientId(bytesFrom([0xab, 0x01, 0xff, 0x10]));
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(isClientId(id)).toBe(true);
    expect(CLIENT_ID_BYTES).toBe(16);
  });

  it('★ 第一次生成并存下来；第二次原样取回（断线重连认的就是同一个）', () => {
    const { store, storage } = fakeStorage();
    const first = loadClientId(storage, bytesFrom([7]));
    expect(isClientId(first)).toBe(true);
    expect(store.get(CLIENT_ID_STORAGE_KEY)).toBe(first);
    const second = loadClientId(storage, bytesFrom([9]));
    expect(second).toBe(first);
  });

  it('存坏了（长度不对 / 大写 / 不是十六进制）⇒ 重新生成，不拿坏值去 join', () => {
    for (const bad of ['', 'abc', 'A'.repeat(32), 'z'.repeat(32), '0'.repeat(31)]) {
      const { storage } = fakeStorage({ [CLIENT_ID_STORAGE_KEY]: bad });
      const id = loadClientId(storage, bytesFrom([3]));
      expect(isClientId(id), bad).toBe(true);
      expect(id).not.toBe(bad);
    }
  });

  it('没有存储（隐私模式）也能拿到一个合法的 —— 只是这次有效', () => {
    const id = loadClientId(null, bytesFrom([5]));
    expect(isClientId(id)).toBe(true);
  });
});
