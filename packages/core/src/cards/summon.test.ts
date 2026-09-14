/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 請神符与物件附身 —— 以 VA 0x0040ead7 / 0x0040ea62 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { OBJECT_TYPE_TABLE, objectTypeOf } from '../rules/objects.ts';
import {
  ATTACH_STATE_NORMAL,
  ATTACH_STATE_REAPER,
  OBJECT_TYPE_DOG,
  OBJECT_TYPE_REAPER,
  applySummonCard,
  attachObject,
  canAttach,
  makeObjects,
  summonableObjects,
  type MapObject,
} from './summon.ts';

const obj = (over: Partial<MapObject> = {}): MapObject => ({
  type: 1, nodeId: 10, state: 0, attached: 0, ...over,
});

describe('★ 可附身性：(type ≤ 12 且 ≠ 11) 或 type == 15', () => {
  it('財神/福神/窮神/衰神/天使/惡魔/土地公 都可请', () => {
    for (const t of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
      expect(canAttach(t), `type ${t}`).toBe(true);
    }
  });

  it('★ 惡犬(11) 不可请——它是障碍不是神', () => {
    expect(OBJECT_TYPE_DOG).toBe(11);
    expect(canAttach(11)).toBe(false);
  });

  it('★ 禮物(13)/寶箱(14) 不可请——是拾取物', () => {
    expect(canAttach(13)).toBe(false);
    expect(canAttach(14)).toBe(false);
  });

  it('★ 死神(15) 可请——是 12 以上唯一的例外', () => {
    expect(OBJECT_TYPE_REAPER).toBe(15);
    expect(canAttach(15)).toBe(true);
    expect(canAttach(16)).toBe(false);
    expect(canAttach(17)).toBe(false);
  });
});

describe('附身', () => {
  it('★ god_info 存的是**下标 + 1**，即入参 handle 本身（0x40eb55）', () => {
    const r = attachObject(makePlayer({ index: 1, nodeId: 42 }), [obj(), obj()], 2);
    expect(r.ok).toBe(true);
    expect(r.player.godInfo).toBe(2);
  });

  it('物件跟到玩家所在节点，并记下附身于谁', () => {
    const r = attachObject(makePlayer({ index: 2, nodeId: 42 }), [obj()], 1);
    expect(r.objects[0]!.nodeId).toBe(42);
    expect(r.objects[0]!.attached).toBe(3); // index + 1
  });

  it('★ 死神写状态 13，其余写 7', () => {
    const a = attachObject(makePlayer(), [obj({ type: OBJECT_TYPE_REAPER })], 1);
    expect(a.objects[0]!.state).toBe(ATTACH_STATE_REAPER);
    const b = attachObject(makePlayer(), [obj({ type: 1 })], 1);
    expect(b.objects[0]!.state).toBe(ATTACH_STATE_NORMAL);
  });

  it('★ 已有附身物时报告被顶替的那个，由调用方走送神流程', () => {
    const p = makePlayer({ godInfo: 5 });
    const r = attachObject(p, [obj()], 1);
    expect(r.displaced).toBe(5);
    expect(r.player.godInfo).toBe(1); // 新的覆盖旧的
  });

  it('原本无附身物时 displaced 为 0', () => {
    const r = attachObject(makePlayer({ godInfo: 0 }), [obj()], 1);
    expect(r.displaced).toBe(0);
  });
});

describe('拒绝的情形', () => {
  it('★ 下标 0 表示「无」，直接拒绝', () => {
    const r = attachObject(makePlayer(), [obj()], 0);
    expect(r).toMatchObject({ ok: false, reason: 'noObject' });
  });

  it('越界', () => {
    expect(attachObject(makePlayer(), [obj()], 9).reason).toBe('outOfRange');
  });

  it('不可附身的种类', () => {
    const r = attachObject(makePlayer(), [obj({ type: OBJECT_TYPE_DOG })], 1);
    expect(r.reason).toBe('notAttachable');
  });

  it('拒绝时玩家与物件都不变', () => {
    const p = makePlayer({ godInfo: 3 });
    const objs = [obj({ type: 13 })];
    const r = attachObject(p, objs, 1);
    expect(r.player).toBe(p);
    expect(r.objects).toEqual(objs);
  });
});

describe('可请清单', () => {
  it('★ 排除已被附身与不在地图上的', () => {
    const objs = [
      obj({ type: 1, nodeId: 10, attached: 0 }), // 可
      obj({ type: 1, nodeId: 10, attached: 2 }), // 已被附身
      obj({ type: 1, nodeId: 0, attached: 0 }),  // 不在地图上
      obj({ type: OBJECT_TYPE_DOG, nodeId: 10 }), // 不可附身
      obj({ type: OBJECT_TYPE_REAPER, nodeId: 5 }), // 可
    ];
    expect(summonableObjects(objs)).toEqual([1, 5]);
  });
});

describe('与既有物件表一致', () => {
  it('makeObjects 的种类取自 OBJECT_TYPE_TABLE', () => {
    const objs = makeObjects(5);
    for (let i = 0; i < 5; i++) expect(objs[i]!.type).toBe(objectTypeOf(i));
    expect(objs[0]!.type).toBe(OBJECT_TYPE_TABLE[0]);
  });

  it('新建的物件都不在地图上、未附身', () => {
    for (const o of makeObjects(8)) {
      expect(o.nodeId).toBe(0);
      expect(o.attached).toBe(0);
    }
  });
});

describe('請神符本体', () => {
  it('等价于 attachObject —— 卡片里的清零/恢复只是动画', () => {
    const p = makePlayer({ index: 0, nodeId: 7 });
    const objs = [obj({ type: 2, nodeId: 33 })];
    expect(applySummonCard(p, objs, 1)).toEqual(attachObject(p, objs, 1));
  });
});
