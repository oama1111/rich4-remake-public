/*
 * 均富卡验证 —— 基准为原版 exe 反汇编
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyAverageCashCard, HOSTILITY_DIVISOR } from './average-cash.ts';
import type { Player } from '../state/types.ts';
import { makePlayer } from '../testing/factories.ts';

/** 本文件的简写：按 (下标, 现金, 控制方) 构造 */
const player = (index: number, cash: number, whoPlays = WHO_PLAYS_HUMAN): Player =>
  makePlayer({ index, character: index, whoPlays, cash, moneyInBank: 999_999 });
import { WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_DEAD } from '../state/types.ts';


describe('均富卡', () => {
  it('把在场玩家现金拉平到平均值', () => {
    const r = applyAverageCashCard([
      player(0, 100_000), player(1, 200_000), player(2, 300_000), player(3, 400_000),
    ], 0);
    expect(r.average).toBe(250_000);
    expect(r.players.map((p) => p.cash)).toEqual([250_000, 250_000, 250_000, 250_000]);
  });

  it('★ 只影响现金，不动存款', () => {
    const r = applyAverageCashCard([player(0, 0), player(1, 100_000)], 0);
    expect(r.players.every((p) => p.moneyInBank === 999_999)).toBe(true);
  });

  it('★ 出局玩家既不计入平均，也不被改动', () => {
    const r = applyAverageCashCard([
      player(0, 100_000),
      player(1, 900_000, WHO_PLAYS_DEAD), // 不计入
      player(2, 300_000),
    ], 0);
    expect(r.average).toBe(200_000); // (100000 + 300000) / 2
    expect(r.players[1]!.cash).toBe(900_000); // 原样保留
  });

  it('电脑玩家照常参与', () => {
    const r = applyAverageCashCard([
      player(0, 0), player(1, 100_000, WHO_PLAYS_COMPUTER),
    ], 0);
    expect(r.average).toBe(50_000);
  });

  it('平均值用整数除法（向零取整）', () => {
    // (100 + 101 + 101) / 3 = 100.67 → 100
    const r = applyAverageCashCard([player(0, 100), player(1, 101), player(2, 101)], 0);
    expect(r.average).toBe(100);
  });

  it('负现金也参与平均（原版为有符号除法）', () => {
    const r = applyAverageCashCard([player(0, -100_000), player(1, 100_000)], 0);
    expect(r.average).toBe(0);
  });
});

describe('★ 敌意结算 —— 两代逆向版曾在此矛盾', () => {
  it('增量为「损失额 / 100」，而非「平均值 / 100」', () => {
    // @source exe VA 0x00442171: sub edx, esi (cash - average) / idiv 100
    // csrc/cards.c（2018）误写为 average / 100 —— 已由反汇编裁决
    const r = applyAverageCashCard([player(0, 0), player(1, 1_000_000)], 0);
    expect(r.average).toBe(500_000);
    expect(r.hostilityDeltas).toEqual([
      { from: 1, to: 0, delta: 5_000 }, // (1000000 - 500000) / 100
    ]);
    // 若按旧版错误公式，增量会是 500000/100 = 5000 —— 本例恰好相同，
    // 故再用一个能区分两者的用例：
  });

  it('★ 用能区分两代公式的用例', () => {
    // 三人：0、0、900000 → average = 300000
    // 正确（新版）：(900000 - 300000)/100 = 6000
    // 错误（旧版）：300000/100 = 3000
    const r = applyAverageCashCard([player(0, 0), player(1, 0), player(2, 900_000)], 0);
    expect(r.average).toBe(300_000);
    expect(r.hostilityDeltas.length).toBe(1);
    expect(r.hostilityDeltas[0]!.delta).toBe(6_000); // 不是 3000
  });

  it('现金被拉高的玩家不产生敌意', () => {
    const r = applyAverageCashCard([player(0, 0), player(1, 100_000)], 0);
    // 玩家0 被拉高，不恨人；只有玩家1 受损
    expect(r.hostilityDeltas.map((h) => h.from)).toEqual([1]);
  });

  it('现金恰等于平均值时不产生敌意（jge 分支）', () => {
    const r = applyAverageCashCard([player(0, 100), player(1, 100)], 0);
    expect(r.hostilityDeltas).toEqual([]);
  });

  it('敌意指向出牌者', () => {
    const r = applyAverageCashCard([player(0, 0), player(1, 0), player(2, 300_000)], 2);
    expect(r.hostilityDeltas[0]!.to).toBe(2);
  });

  it('除数为 100', () => {
    expect(HOSTILITY_DIVISOR).toBe(100);
  });

  it('★★ 求和按 32 位回绕（通道 2 证据：0x7FFFFFFF×2+1 ⇒ −1，avg = 0）', () => {
    // @source `add esi, [player+0x1c]` 是 32 位寄存器加法 ⇒ 溢出回绕；
    //   rich4-spec/tests/test_average_cards.py 钉住：三家 0x7FFFFFFF/0x7FFFFFFF/1
    //   求和 = −1，`idiv 3` = 0 ⇒ 三家都变 0，且前两家 delta = 2147483647/100
    const r = applyAverageCashCard(
      [player(0, 0x7fffffff), player(1, 0x7fffffff), player(2, 1)],
      0,
    );
    expect(r.average).toBe(0);
    expect(r.players.map((p) => p.cash)).toEqual([0, 0, 0]);
    expect(r.hostilityDeltas).toEqual([
      { from: 0, to: 0, delta: 21_474_836 },
      { from: 1, to: 0, delta: 21_474_836 },
      { from: 2, to: 0, delta: 0 },
    ]);
  });

  it('不原地修改入参', () => {
    const ps = [player(0, 100), player(1, 900)];
    const snapshot = JSON.stringify(ps);
    applyAverageCashCard(ps, 0);
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});
