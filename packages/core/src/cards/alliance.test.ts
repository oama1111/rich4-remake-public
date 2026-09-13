/*
 * 同盟卡验证 —— 基准为原版 exe 反汇编（VA 0x00445710）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyAllianceCard, ALLIANCE_DAYS, ALLIANCE_SELECTION_PARAM } from './alliance.ts';
import { makePlayer } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));

describe('同盟卡', () => {
  it('选择参数与清单一致，属 player 组', () => {
    expect(cardImpl(29)!.selectionParam).toBe(ALLIANCE_SELECTION_PARAM);
    expect(ALLIANCE_SELECTION_PARAM).toBe(0xe0c0410);
  });

  it('★ 双方互指对方，各 7 天', () => {
    expect(ALLIANCE_DAYS).toBe(7);
    const r = applyAllianceCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.ok).toBe(true);
    // allied_player 存的是下标 + 1
    expect(r.players[0]!.alliedPlayer).toBe(3);
    expect(r.players[2]!.alliedPlayer).toBe(1);
    expect(r.players[0]!.alliedDays).toBe(7);
    expect(r.players[2]!.alliedDays).toBe(7);
  });

  it('★ 不可对自己使用（player 组）', () => {
    expect(applyAllianceCard(four(), 1, { kind: 'player', index: 1 }).error)
      .toBe('cannotTargetSelf');
  });

  it('未参与的玩家不受影响', () => {
    const r = applyAllianceCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.players[1]!.alliedPlayer).toBe(0);
    expect(r.players[3]!.alliedPlayer).toBe(0);
  });
});

describe('★ 结盟前先解除旧同盟', () => {
  it('出牌者原有的同盟被双向解除', () => {
    const ps = four();
    // 玩家0 与 玩家1 原本是同盟
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 3 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 3 });

    const r = applyAllianceCard(ps, 0, { kind: 'player', index: 2 });
    // 旧盟友玩家1 被清空
    expect(r.players[1]!.alliedPlayer).toBe(0);
    expect(r.players[1]!.alliedDays).toBe(0);
    // 新同盟成立
    expect(r.players[0]!.alliedPlayer).toBe(3);
    expect(r.players[2]!.alliedPlayer).toBe(1);
  });

  it('目标原有的同盟也被双向解除', () => {
    const ps = four();
    // 玩家2 与 玩家3 原本是同盟
    ps[2] = makePlayer({ index: 2, alliedPlayer: 4, alliedDays: 5 });
    ps[3] = makePlayer({ index: 3, alliedPlayer: 3, alliedDays: 5 });

    const r = applyAllianceCard(ps, 0, { kind: 'player', index: 2 });
    expect(r.players[3]!.alliedPlayer).toBe(0);
    expect(r.players[3]!.alliedDays).toBe(0);
    expect(r.players[2]!.alliedPlayer).toBe(1);
  });

  it('两边都有旧同盟时，两个都被解除', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 3 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 3 });
    ps[2] = makePlayer({ index: 2, alliedPlayer: 4, alliedDays: 5 });
    ps[3] = makePlayer({ index: 3, alliedPlayer: 3, alliedDays: 5 });

    const r = applyAllianceCard(ps, 0, { kind: 'player', index: 2 });
    expect(r.dissolved.length).toBe(2);
    expect(r.players[1]!.alliedPlayer).toBe(0);
    expect(r.players[3]!.alliedPlayer).toBe(0);
    expect(r.players[0]!.alliedPlayer).toBe(3);
    expect(r.players[2]!.alliedPlayer).toBe(1);
  });

  it('无旧同盟时不产生解除记录', () => {
    expect(applyAllianceCard(four(), 0, { kind: 'player', index: 2 }).dissolved).toEqual([]);
  });
});

describe('失败与纯净性', () => {
  it('目标缺失/种类错误/越界时失败', () => {
    expect(applyAllianceCard(four(), 0, { kind: 'none' }).error).toBe('targetRequired');
    expect(applyAllianceCard(four(), 0, { kind: 'entity', entityId: 2001 }).error).toBe('wrongTargetKind');
    expect(applyAllianceCard(four(), 0, { kind: 'player', index: 9 }).error).toBe('playerOutOfRange');
  });

  it('不原地修改入参', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 3 });
    const snap = JSON.stringify(ps);
    applyAllianceCard(ps, 0, { kind: 'player', index: 2 });
    expect(JSON.stringify(ps)).toBe(snap);
  });
});
