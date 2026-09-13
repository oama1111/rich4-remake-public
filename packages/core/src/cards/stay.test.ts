/*
 * 停留卡验证 —— 基准为原版 exe 反汇编（VA 0x00443f80）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyStayCard, STAY_DAYS, STAY_SELECTION_PARAM } from './stay.ts';
import { targetClassOf } from './target.ts';
import { makePlayer } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));

describe('停留卡', () => {
  it('选择参数与清单一致', () => {
    expect(cardImpl(14)!.selectionParam).toBe(STAY_SELECTION_PARAM);
    expect(STAY_SELECTION_PARAM).toBe(0xe0c0010);
  });

  it('目标类别为 anyPlayer', () => {
    expect(targetClassOf(STAY_SELECTION_PARAM)).toBe('anyPlayer');
  });

  it('把目标的 stopping 设为 1', () => {
    expect(STAY_DAYS).toBe(1);
    const r = applyStayCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.ok).toBe(true);
    expect(r.players[2]!.blocking.stopping).toBe(1);
  });

  it('只影响目标，其他玩家不变', () => {
    const r = applyStayCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.players.filter((p) => p.blocking.stopping !== 0).length).toBe(1);
  });

  it('★ 可以对自己使用（anyPlayer 组）', () => {
    const r = applyStayCard(four(), 1, { kind: 'player', index: 1 });
    expect(r.ok).toBe(true);
    expect(r.players[1]!.blocking.stopping).toBe(1);
  });

  it('目标缺失时失败', () => {
    const r = applyStayCard(four(), 0, { kind: 'none' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('targetRequired');
  });

  it('目标种类错误时失败', () => {
    const r = applyStayCard(four(), 0, { kind: 'entity', entityId: 2001 });
    expect(r.error).toBe('wrongTargetKind');
  });

  it('目标越界时失败', () => {
    expect(applyStayCard(four(), 0, { kind: 'player', index: 9 }).error).toBe('playerOutOfRange');
  });

  it('失败时不改动任何玩家', () => {
    const ps = four();
    const r = applyStayCard(ps, 0, { kind: 'none' });
    expect(r.players.every((p) => p.blocking.stopping === 0)).toBe(true);
  });

  it('不原地修改入参', () => {
    const ps = four();
    const snapshot = JSON.stringify(ps);
    applyStayCard(ps, 0, { kind: 'player', index: 2 });
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});
