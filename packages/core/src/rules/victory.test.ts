/*
 * 勝負判定 `fcn_0041d89e` @ 0x0041d89e —— 原版真码回归
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这是全局**唯一**的「时间/资产达标就结束」判定点，返回值直接决定日推进要不要
 * 当场收摊。此前 `checkVictory` / `victoryEndCode` **一个用例都没有**。
 *
 * 期望值全部来自 Unicorn 跑原版机器码（`rich4-spec/tests/test_victory.py`，23/23）。
 */
import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';
import type { Player } from '../state/types.ts';
import { checkVictory, clearLosers, victoryEndCode } from './victory.ts';

/** 只有现金、无地无股 —— 总资产就是现金 */
const wealthOf = (p: Player) => p.cash;

function ps(cashs: readonly number[], kinds?: readonly ('h' | 'c')[]): Player[] {
  return cashs.map((cash, i) => makePlayer({
    index: i,
    cash,
    moneyInBank: 0,
    loan: 0,
    whoPlays: (kinds?.[i] ?? 'h') === 'h' ? WHO_PLAYS_HUMAN : WHO_PLAYS_COMPUTER,
  }));
}

const NO_LIMIT = { targetDays: 0, targetWealth: 0 };
const HUMANS = (n: number) => n;

describe('checkVictory @ 0x0041d89e —— 两条胜利条件', () => {
  it('两条都没开 → 直接 null（连遍历都不做）', () => {
    expect(checkVictory(ps([1000, 2000]), wealthOf, NO_LIMIT, 0, HUMANS(2))).toBeNull();
  });

  it('金额达标：赢家 = 在世首富', () => {
    const v = checkVictory(ps([1000, 2000]), wealthOf,
      { targetDays: 0, targetWealth: 1500 }, 0, HUMANS(2));
    expect(v).toMatchObject({ winner: 1, reason: 'wealthTarget', wealth: 2000 });
  });

  it('★ 恰好达标即可（`>=` 而非 `>`）', () => {
    expect(checkVictory(ps([1000, 2000]), wealthOf,
      { targetDays: 0, targetWealth: 2000 }, 0, HUMANS(2))).not.toBeNull();
  });

  it('未达标 → null', () => {
    expect(checkVictory(ps([1000, 2000]), wealthOf,
      { targetDays: 0, targetWealth: 2500 }, 0, HUMANS(2))).toBeNull();
  });

  it('天数达标：`目标 <= 已过`（恰好到期也算）', () => {
    const c = { targetDays: 5, targetWealth: 0 };
    expect(checkVictory(ps([1000, 2000]), wealthOf, c, 5, HUMANS(2)))
      .toMatchObject({ reason: 'timeLimit' });
    expect(checkVictory(ps([1000, 2000]), wealthOf, c, 4, HUMANS(2))).toBeNull();
    expect(checkVictory(ps([1000, 2000]), wealthOf, { targetDays: 1, targetWealth: 0 },
      5, HUMANS(2))).toMatchObject({ reason: 'timeLimit' });
  });

  it('★★ 首富资产为 0 时**天数条件整个跳过**（原版如此，不是笔误）', () => {
    expect(checkVictory(ps([0, 0]), wealthOf, { targetDays: 1, targetWealth: 0 },
      5, HUMANS(2))).toBeNull();
    // 只要有人 > 0 就恢复生效
    expect(checkVictory(ps([0, 500]), wealthOf, { targetDays: 1, targetWealth: 0 },
      5, HUMANS(2))).not.toBeNull();
  });

  it('★ 平手取**下标小的**（严格大于才替换）', () => {
    const v = checkVictory(ps([2000, 2000]), wealthOf,
      { targetDays: 0, targetWealth: 1500 }, 0, HUMANS(2));
    expect(v?.winner).toBe(0);
  });

  it('出局者不参评（既不算他的资产，也不会被选为赢家）', () => {
    const players = ps([500, 2000]);
    players[1] = { ...players[1]!, whoPlays: 0 };
    expect(checkVictory(players, wealthOf,
      { targetDays: 0, targetWealth: 1000 }, 0, HUMANS(2))).toBeNull();
    const v = checkVictory(players, wealthOf,
      { targetDays: 0, targetWealth: 400 }, 0, HUMANS(2));
    expect(v?.winner).toBe(0);
  });
});

describe('victoryEndCode —— 终局码取**开局存下的**人类数', () => {
  it('赢家是真人 + 单人类局 → 2；多人类局 → 3', () => {
    expect(victoryEndCode(1, WHO_PLAYS_HUMAN)).toBe(2);
    expect(victoryEndCode(2, WHO_PLAYS_HUMAN)).toBe(3);
  });

  it('赢家是电脑 → 1（无论几个人类）', () => {
    expect(victoryEndCode(1, WHO_PLAYS_COMPUTER)).toBe(1);
    expect(victoryEndCode(2, WHO_PLAYS_COMPUTER)).toBe(1);
  });

  it('★★★ 回归：多人局里有人先出局，终局码仍按**开局人数**算',
    () => {
      // 2 个人类开局；0 号破产出局（whoPlays → 0）；1 号靠金额达标结束。
      // 原版 `[0x499104]` 只在开新局写一次、破产 `0x40cd87` 不写它
      // ⇒ 终局码 **3**（多人）。若按 whoPlays 现数会得到 1 个人类 ⇒ 错成 2。
      const players = ps([0, 2000]);
      players[0] = { ...players[0]!, whoPlays: 0 };
      const liveHumans = players.filter((p) => p.whoPlays === WHO_PLAYS_HUMAN).length;
      expect(liveHumans).toBe(1);            // 现数会得 1 —— 正是错的来源
      const v = checkVictory(players, wealthOf,
        { targetDays: 0, targetWealth: 1500 }, 0, HUMANS(2));
      expect(v?.code).toBe(3);               // 原版真值
    });
});

describe('clearLosers —— 只清 who_plays，钱与地产留着', () => {
  it('赢家不动，其余人 whoPlays = 0', () => {
    const out = clearLosers(ps([1000, 2000, 3000]), 1);
    expect(out.map((p) => p.whoPlays)).toEqual([0, WHO_PLAYS_HUMAN, 0]);
    expect(out.map((p) => p.cash)).toEqual([1000, 2000, 3000]);
  });
});
