/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 夢遊卡 —— 以 VA 0x004441dc 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { PASSIVE_CARDS } from './passive.ts';
import { emptyTools, toolCount } from '../rules/tools.ts';
import {
  SLEEPWALK_DAYS_OTHER,
  SLEEPWALK_DAYS_SELF,
  SLEEPWALK_WINTER_DAYS,
  TRAFFIC_TO_TOOL,
  applySleepwalkCard,
  wakeFromSleepwalk,
} from './sleepwalk.ts';

const four = (cards: number[][] = [[], [], [], []], traffic = 0) =>
  [0, 1, 2, 3].map((i) =>
    makePlayer({ index: i, cards: cards[i] ?? [], trafficMethod: traffic, ndices: 2 }),
  );
const tgt = (index: number) => ({ kind: 'player' as const, index });

describe('基本效果', () => {
  it('目标进入梦游 5 天', () => {
    const r = applySleepwalkCard(four(), 0, tgt(2), emptyTools(4));
    expect(r.ok).toBe(true);
    expect(r.players[2]!.blocking.sleepWalking).toBe(SLEEPWALK_DAYS_OTHER);
  });

  it('★ 对自己只有 4 天——与停留卡、陷害卡同一模式', () => {
    const r = applySleepwalkCard(four(), 1, tgt(1), emptyTools(4));
    expect(r.players[1]!.blocking.sleepWalking).toBe(SLEEPWALK_DAYS_SELF);
    expect(SLEEPWALK_DAYS_SELF).toBeLessThan(SLEEPWALK_DAYS_OTHER);
  });

  it('冬眠天数累计 +5', () => {
    const r = applySleepwalkCard(four(), 0, tgt(2), emptyTools(4));
    expect(r.players[2]!.totalWinterSleepDays).toBe(SLEEPWALK_WINTER_DAYS);
  });

  it('★ 清空交通方式、骰子数归 1', () => {
    const r = applySleepwalkCard(four([[], [], [], []], 2), 0, tgt(2), emptyTools(4));
    expect(r.players[2]!.trafficMethod).toBe(0);
    expect(r.players[2]!.ndices).toBe(1);
  });
});

describe('★ 交通工具退还成道具，不是凭空消失', () => {
  it('機車(traffic 1) → 道具 5', () => {
    expect(TRAFFIC_TO_TOOL.get(1)).toBe(5);
    const r = applySleepwalkCard(four([[], [], [], []], 1), 0, tgt(2), emptyTools(4));
    expect(toolCount(r.tools, 2, 5)).toBe(1);
  });

  it('汽車(traffic 2) → 道具 6', () => {
    expect(TRAFFIC_TO_TOOL.get(2)).toBe(6);
    const r = applySleepwalkCard(four([[], [], [], []], 2), 0, tgt(2), emptyTools(4));
    expect(toolCount(r.tools, 2, 6)).toBe(1);
  });

  it('没有交通工具时不发道具', () => {
    const r = applySleepwalkCard(four([[], [], [], []], 0), 0, tgt(2), emptyTools(4));
    expect(r.tools.every((v) => v === 0)).toBe(true);
  });

  it('★ 退还的是目标自己的道具栏', () => {
    const r = applySleepwalkCard(four([[], [], [], []], 1), 0, tgt(3), emptyTools(4));
    expect(toolCount(r.tools, 3, 5)).toBe(1);
    expect(toolCount(r.tools, 0, 5)).toBe(0);
  });
});

describe('★ 復仇卡(18)：把效果反弹给出牌者', () => {
  it('目标持復仇卡 → 出牌者自己梦游', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(r.outcome).toEqual({ kind: 'reflected', victim: 0, days: SLEEPWALK_DAYS_SELF });
    expect(r.players[2]!.blocking.sleepWalking).toBe(0);
    expect(r.players[0]!.blocking.sleepWalking).toBe(SLEEPWALK_DAYS_SELF);
  });

  it('★ 反弹后按「对自己」算天数——4 天而非 5 天', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(r.outcome!.days).toBe(4);
  });

  it('★ 反弹时退还的是出牌者的交通工具', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []], 1);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(toolCount(r.tools, 0, 5)).toBe(1);
    expect(toolCount(r.tools, 2, 5)).toBe(0);
  });

  it('其他被动卡不反弹', () => {
    for (const c of [PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.FREE, PASSIVE_CARDS.ABSOLUTION]) {
      const ps = four([[], [], [c], []]);
      const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
      expect(r.outcome!.kind, `card ${c}`).toBe('applied');
    }
  });
});

describe('醒来', () => {
  it('★ 恢复梦游前的交通方式与骰子数', () => {
    const r = applySleepwalkCard(four([[], [], [], []], 2), 0, tgt(2), emptyTools(4));
    const asleep = r.players[2]!;
    expect(asleep.savedTrafficMethod).toBe(2);
    expect(asleep.savedNdices).toBe(2);

    const awake = wakeFromSleepwalk(asleep);
    expect(awake.trafficMethod).toBe(2);
    expect(awake.ndices).toBe(2);
    expect(awake.blocking.sleepWalking).toBe(0);
  });
});

describe('目标校验', () => {
  it('地块目标被拒', () => {
    const r = applySleepwalkCard(four(), 0, { kind: 'entity', entityId: 1 }, emptyTools(4));
    expect(r.error).toBe('wrongTargetKind');
  });

  it('越界被拒且状态不变', () => {
    const ps = four();
    const r = applySleepwalkCard(ps, 0, tgt(9), emptyTools(4));
    expect(r.error).toBe('playerOutOfRange');
    expect(r.players).toEqual(ps);
  });
});
