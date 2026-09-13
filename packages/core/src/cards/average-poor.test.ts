/*
 * 均贫卡验证 —— 基准为原版 exe 反汇编（VA 0x004421b4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyAveragePoorCard, AVERAGE_POOR_SELECTION_PARAM } from './average-poor.ts';
import { applyAverageCashCard } from './average-cash.ts';
import { makePlayer } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';

const withCash = (cs: number[]) =>
  cs.map((c, i) => makePlayer({ index: i, character: i, cash: c }));

describe('均贫卡', () => {
  it('选择参数与清单一致', () => {
    expect(cardImpl(2)!.selectionParam).toBe(AVERAGE_POOR_SELECTION_PARAM);
  });

  it('★ 只拉平出牌者与目标两人', () => {
    const r = applyAveragePoorCard(withCash([100_000, 500_000, 900_000, 700_000]), 0, {
      kind: 'player', index: 1,
    });
    expect(r.average).toBe(300_000);
    expect(r.players[0]!.cash).toBe(300_000);
    expect(r.players[1]!.cash).toBe(300_000);
    // ★ 其余玩家不受影响
    expect(r.players[2]!.cash).toBe(900_000);
    expect(r.players[3]!.cash).toBe(700_000);
  });

  it('★ 与均富卡的差别：均富拉平全场', () => {
    const ps = withCash([100_000, 500_000, 900_000, 700_000]);
    const poor = applyAveragePoorCard(ps, 0, { kind: 'player', index: 1 });
    const rich = applyAverageCashCard(ps, 0);
    expect(poor.players[2]!.cash).toBe(900_000); // 均贫：不动
    expect(rich.players[2]!.cash).toBe(550_000); // 均富：拉平
  });

  it('除以 2 向零取整', () => {
    const r = applyAveragePoorCard(withCash([100, 101, 0, 0]), 0, { kind: 'player', index: 1 });
    expect(r.average).toBe(100); // 201 / 2 = 100.5 → 100
  });

  it('负现金也参与（有符号除法）', () => {
    const r = applyAveragePoorCard(withCash([-100_000, 100_000, 0, 0]), 0, { kind: 'player', index: 1 });
    expect(r.average).toBe(0);
  });

  it('★ 不可对自己使用', () => {
    expect(applyAveragePoorCard(withCash([1, 2, 3, 4]), 1, { kind: 'player', index: 1 }).error)
      .toBe('cannotTargetSelf');
  });
});

describe('敌意结算', () => {
  it('目标被拉低时按损失额 / 100 记敌意', () => {
    const r = applyAveragePoorCard(withCash([0, 1_000_000, 0, 0]), 0, { kind: 'player', index: 1 });
    expect(r.average).toBe(500_000);
    expect(r.hostilityDeltas).toEqual([{ from: 1, to: 0, delta: 5_000 }]);
  });

  it('目标被拉高时不记敌意（是出牌者亏）', () => {
    const r = applyAveragePoorCard(withCash([1_000_000, 0, 0, 0]), 0, { kind: 'player', index: 1 });
    expect(r.hostilityDeltas).toEqual([]);
  });

  it('两人现金相等时不记敌意（jge 分支）', () => {
    const r = applyAveragePoorCard(withCash([500, 500, 0, 0]), 0, { kind: 'player', index: 1 });
    expect(r.hostilityDeltas).toEqual([]);
  });
});

describe('失败与纯净性', () => {
  it('目标缺失/种类错误/越界时失败', () => {
    const ps = withCash([1, 2, 3, 4]);
    expect(applyAveragePoorCard(ps, 0, { kind: 'none' }).error).toBe('targetRequired');
    expect(applyAveragePoorCard(ps, 0, { kind: 'entity', entityId: 2001 }).error).toBe('wrongTargetKind');
    expect(applyAveragePoorCard(ps, 0, { kind: 'player', index: 9 }).error).toBe('playerOutOfRange');
  });

  it('不原地修改入参', () => {
    const ps = withCash([100, 900, 0, 0]);
    const snap = JSON.stringify(ps);
    applyAveragePoorCard(ps, 0, { kind: 'player', index: 1 });
    expect(JSON.stringify(ps)).toBe(snap);
  });
});
