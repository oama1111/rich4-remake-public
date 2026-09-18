/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 探監與探病：保釋
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { CONFINEMENT_SLOTS } from './confinement.ts';
import {
  BAIL_COST_INMATE,
  BAIL_COST_PLAYER,
  BAIL_INMATE_POINTS_REQUIRED,
  BAIL_STYLE,
  INMATE_NAMES,
  RELEASE_FLAG,
  applyBail,
  bailCandidates,
  bailCost,
  canAffordBail,
  decideBail,
} from './visit.ts';

const empty = (): number[] => new Array<number>(CONFINEMENT_SLOTS).fill(0);
const occWith = (...slots: number[]): number[] => {
  const o = empty();
  for (const s of slots) o[s] = 1;
  return o;
};
const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, points: 0 }));

describe('赎金', () => {
  it('玩家 30、犯人 300', () => {
    expect(bailCost(0)).toBe(BAIL_COST_PLAYER);
    expect(bailCost(3)).toBe(30);
    expect(bailCost(4)).toBe(BAIL_COST_INMATE);
    expect(bailCost(7)).toBe(300);
  });

  it('★ 保玩家要點券**严格大于**赎金 —— 刚好 30 是不够的', () => {
    expect(canAffordBail(29, 0)).toBe(false);
    expect(canAffordBail(30, 0)).toBe(false);
    expect(canAffordBail(31, 0)).toBe(true);
  });

  it('★ 保犯人的门槛是 700，但只扣 300 —— 两条判据形状都不一样', () => {
    expect(BAIL_INMATE_POINTS_REQUIRED).toBe(700);
    expect(canAffordBail(699, 4)).toBe(false);
    expect(canAffordBail(700, 4)).toBe(true);
    expect(bailCost(4)).toBe(300);
  });
});

describe('里面关着谁', () => {
  it('只列占用表非空的槽', () => {
    const c = bailCandidates(occWith(1, 5), four(), 9999, (i) => `P${i}`);
    expect(c.map((x) => x.slot)).toEqual([1, 5]);
    expect(c[0]).toMatchObject({ player: 1, name: 'P1', cost: 30 });
    expect(c[1]).toMatchObject({ player: -1, name: '強盜', cost: 300 });
  });

  it('四个 NPC 的名字', () => {
    expect(INMATE_NAMES).toEqual(['小偷', '強盜', '流氓', '間諜']);
  });

  it('付不起的也列出来，但标明付不起', () => {
    const c = bailCandidates(occWith(0, 4), four(), 100, (i) => `P${i}`);
    expect(c[0]!.affordable).toBe(true);
    expect(c[1]!.affordable).toBe(false);
  });
});

describe('★ 电脑玩家怎么挑 —— f23 就是这个', () => {
  /** 第一个随机数必须是奇数才「肯管」 */
  const care = 1;

  it('★ 第一掷就有一半概率什么都不做', () => {
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(1), 9999, [0]).slot).toBe(-1);
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(1), 9999, [2]).slot).toBe(-1);
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(1), 9999, [care, 0]).slot).toBe(1);
  });

  it('0 只救玩家 —— 关着的全是犯人就不管', () => {
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(4, 5), 9999, [care, 0]).slot).toBe(-1);
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(2), 9999, [care, 0]).slot).toBe(2);
  });

  it('2 只放犯人 —— 关着的全是玩家就不管', () => {
    expect(decideBail(BAIL_STYLE.INMATES_ONLY, occWith(0, 1), 9999, [care, 0]).slot).toBe(-1);
    expect(decideBail(BAIL_STYLE.INMATES_ONLY, occWith(6), 9999, [care, 0]).slot).toBe(6);
  });

  it('★ 1 是居中的：总考虑玩家，再掷 rand()%3，为 0 才把犯人也算进来', () => {
    // 第二掷 % 3 == 0 → 候选是 [1, 4]，第三掷 % 2 选中下标 1 → 槽 4
    expect(decideBail(BAIL_STYLE.PLAYERS_MAYBE_INMATES, occWith(1, 4), 9999, [care, 3, 1]).slot)
      .toBe(4);
    // 第二掷 % 3 != 0 → 候选只有 [1]
    expect(decideBail(BAIL_STYLE.PLAYERS_MAYBE_INMATES, occWith(1, 4), 9999, [care, 1, 5]).slot)
      .toBe(1);
  });

  it('★★ 個性 > 2（原版没有的取值）⇒ 候选池为空、一掷之后放弃 @source 0x43d404', () => {
    // 原版的三路判断只有 0/1/2，其余值直接 `jmp 0x43d4a4`（esi 仍为 0 ⇒ 空池）。
    // 通道 2：`rich4-spec/tests/test_bail.py` §D 末条。
    expect(decideBail(3, occWith(1, 5), 9999, [care, 0]).slot).toBe(-1);
    expect(decideBail(9, occWith(1, 5), 9999, [care, 0]).randomsUsed).toBe(1);
  });

  it('★ 用掉几个随机数要报准 —— 多推一个整条序列就错位', () => {
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(1), 9999, [0]).randomsUsed).toBe(1);
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(1), 9999, [care, 0]).randomsUsed).toBe(2);
    // 风格 1 多掷一次「要不要把犯人算进来」
    expect(
      decideBail(BAIL_STYLE.PLAYERS_MAYBE_INMATES, occWith(1), 9999, [care, 1, 0]).randomsUsed,
    ).toBe(3);
  });

  it('付不起就不保', () => {
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, occWith(1), 30, [care, 0]).slot).toBe(-1);
    expect(decideBail(BAIL_STYLE.INMATES_ONLY, occWith(4), 699, [care, 0]).slot).toBe(-1);
  });

  it('里面空着就不管', () => {
    expect(decideBail(BAIL_STYLE.PLAYERS_ONLY, empty(), 9999, [care, 0]).slot).toBe(-1);
  });
});

describe('放人', () => {
  it('扣點券、清占用表、给目标挂上释放位', () => {
    const players = four().map((p) => (p.index === 0 ? { ...p, points: 500 } : p));
    const r = applyBail(players, occWith(2), 'prison', 0, 2);
    expect(r.ok).toBe(true);
    expect(r.paid).toBe(30);
    expect(r.players[0]!.points).toBe(470);
    expect(r.occupancy[2]).toBe(0);
    // ★ 0x80 就是 blocking.ts 说的「待释放」位 —— 保釋直接挂上，不等天数走完
    expect(r.players[2]!.blocking.inPrison).toBe(RELEASE_FLAG);
  });

  it('醫院走同一套，只改计数字段', () => {
    const players = four().map((p) => (p.index === 0 ? { ...p, points: 500 } : p));
    const r = applyBail(players, occWith(3), 'hospital', 0, 3);
    expect(r.players[3]!.blocking.inHospital).toBe(RELEASE_FLAG);
    expect(r.players[3]!.blocking.inPrison).toBe(0);
  });

  it('空槽、付不起都不成交', () => {
    const players = four().map((p) => (p.index === 0 ? { ...p, points: 500 } : p));
    expect(applyBail(players, empty(), 'prison', 0, 2).ok).toBe(false);
    expect(applyBail(four(), occWith(2), 'prison', 0, 2).ok).toBe(false);
  });

  it('保釋犯人扣 300，但玩家那一栏不动', () => {
    const players = four().map((p) => (p.index === 0 ? { ...p, points: 800 } : p));
    const r = applyBail(players, occWith(5), 'prison', 0, 5);
    expect(r.ok).toBe(true);
    expect(r.paid).toBe(300);
    expect(r.players[0]!.points).toBe(500);
  });
});
