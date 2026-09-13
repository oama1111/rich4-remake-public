/*
 * 乌龟卡验证 —— 基准为原版 exe 反汇编（VA 0x004458df）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyTortoiseCard, TORTOISE_DAYS_SELF, TORTOISE_DAYS_OTHER, TORTOISE_SELECTION_PARAM,
} from './tortoise.ts';
import { makePlayer } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));

describe('乌龟卡', () => {
  it('选择参数与清单一致', () => {
    expect(cardImpl(30)!.selectionParam).toBe(TORTOISE_SELECTION_PARAM);
  });

  it('★ 对别人用 = 3 天', () => {
    expect(TORTOISE_DAYS_OTHER).toBe(3);
    const r = applyTortoiseCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.days).toBe(3);
    expect(r.players[2]!.blocking.tortoiseWalking).toBe(3);
  });

  it('★ 对自己用 = 2 天（比对别人少一天）', () => {
    // @source cmp esi, [current] / jne → 3；否则 → 2
    expect(TORTOISE_DAYS_SELF).toBe(2);
    const r = applyTortoiseCard(four(), 1, { kind: 'player', index: 1 });
    expect(r.days).toBe(2);
    expect(r.players[1]!.blocking.tortoiseWalking).toBe(2);
  });

  it('只影响目标', () => {
    const r = applyTortoiseCard(four(), 0, { kind: 'player', index: 3 });
    expect(r.players.filter((p) => p.blocking.tortoiseWalking !== 0).length).toBe(1);
  });

  it('目标缺失/种类错误/越界时失败', () => {
    expect(applyTortoiseCard(four(), 0, { kind: 'none' }).error).toBe('targetRequired');
    expect(applyTortoiseCard(four(), 0, { kind: 'entity', entityId: 2001 }).error).toBe('wrongTargetKind');
    expect(applyTortoiseCard(four(), 0, { kind: 'player', index: 7 }).error).toBe('playerOutOfRange');
  });

  it('失败时不改动任何玩家', () => {
    const r = applyTortoiseCard(four(), 0, { kind: 'none' });
    expect(r.players.every((p) => p.blocking.tortoiseWalking === 0)).toBe(true);
    expect(r.days).toBe(0);
  });

  it('不原地修改入参', () => {
    const ps = four();
    const snap = JSON.stringify(ps);
    applyTortoiseCard(ps, 0, { kind: 'player', index: 2 });
    expect(JSON.stringify(ps)).toBe(snap);
  });
});
