/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 神明加持倍率 —— 以 VA 0x0044b896 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import {
  BLESSING_CHANCE_THRESHOLD,
  BLESSING_DOUBLE,
  BLESSING_DOUBLE_THRESHOLD,
  BLESSING_NONE,
  BLESSING_VOID,
  blessingFieldOf,
  blessingLevel,
  blessingMultiplier,
  blessingLevelWithDraw,
} from './blessing.ts';

/** 把「固定 coinFlip」写成新入口的形状：`draw` 只在中间档被调用 */
const multWith = (p: Parameters<typeof blessingLevelWithDraw>[0], coinFlip: number, kind: 'reward' | 'penalty' | 'misfortune' = 'reward'): number =>
  blessingMultiplier(blessingLevelWithDraw(p, kind, () => coinFlip));

describe('★ 返回的是倍率档位，不是布尔开关', () => {
  it('0 → ×1、1 → ×0、2 → ×2', () => {
    expect(blessingMultiplier(BLESSING_NONE)).toBe(1);
    expect(blessingMultiplier(BLESSING_VOID)).toBe(0);
    expect(blessingMultiplier(BLESSING_DOUBLE)).toBe(2);
  });

  it('未知档位按不变处理', () => {
    expect(blessingMultiplier(7)).toBe(1);
  });
});

describe('阈值分档', () => {
  it('> 100 必定加倍', () => {
    expect(BLESSING_DOUBLE_THRESHOLD).toBe(100);
    expect(blessingLevel(101, 0)).toBe(BLESSING_DOUBLE);
    expect(blessingLevel(9999, 0)).toBe(BLESSING_DOUBLE);
  });

  it('★ 恰好 100 不走必定档（原版是 jle）', () => {
    expect(blessingLevel(100, 0)).not.toBe(BLESSING_DOUBLE);
  });

  it('50 < x <= 100 一半概率加倍', () => {
    expect(BLESSING_CHANCE_THRESHOLD).toBe(50);
    expect(blessingLevel(75, 1)).toBe(BLESSING_DOUBLE);
    expect(blessingLevel(75, 0)).toBe(BLESSING_NONE);
    // 只看最低位
    expect(blessingLevel(75, 3)).toBe(BLESSING_DOUBLE);
    expect(blessingLevel(75, 2)).toBe(BLESSING_NONE);
  });

  it('★ 恰好 50 落到不变档（jle）', () => {
    expect(blessingLevel(50, 1)).toBe(BLESSING_NONE);
  });

  it('0..50 不变', () => {
    for (const v of [0, 1, 25, 50]) expect(blessingLevel(v, 1)).toBe(BLESSING_NONE);
  });

  it('★ 只有负值才归零（test si,si / jge）', () => {
    expect(blessingLevel(-1, 0)).toBe(BLESSING_VOID);
    expect(blessingLevel(-999, 1)).toBe(BLESSING_VOID);
    expect(blessingLevel(0, 0)).toBe(BLESSING_NONE);
  });
});

describe('从玩家取值', () => {
  it('默认財運为 0 → 不变', () => {
    expect(multWith(makePlayer(), 1)).toBe(1);
  });

  it('負財運 → 獎金归零', () => {
    expect(multWith(makePlayer({ fortune: -5 }), 1)).toBe(0);
  });

  it('高財運 → 獎金加倍', () => {
    expect(multWith(makePlayer({ fortune: 200 }), 0)).toBe(2);
  });
});

describe('三条调用形态 —— 罰金那两种的档位是反的', () => {
  // @source callers 0x44b896 只出现 (0,0)/(0,1)/(1,1) 三种压栈组合
  it('★ 高財運对罰金是**免付**，不是加倍', () => {
    const rich = makePlayer({ fortune: 200 });
    expect(multWith(rich, 0, 'reward')).toBe(2);
    expect(multWith(rich, 0, 'penalty')).toBe(0);
  });

  it('★ 負財運对罰金是**加倍**', () => {
    const poor = makePlayer({ fortune: -5 });
    expect(multWith(poor, 0, 'reward')).toBe(0);
    expect(multWith(poor, 0, 'penalty')).toBe(2);
  });

  it('劫难读的是福運 +0x48，不是財運', () => {
    const p = makePlayer({ fortune: 200, luck: -5 });
    // 財運高但福運为负 → 倒霉加倍
    expect(multWith(p, 0, 'misfortune')).toBe(2);
    expect(blessingFieldOf(p, 'misfortune')).toBe(-5);
    expect(blessingFieldOf(p, 'penalty')).toBe(200);
  });

  it('中间档（0..50）三种用法都不变', () => {
    const p = makePlayer({ fortune: 10, luck: 10 });
    expect(multWith(p, 1, 'reward')).toBe(1);
    expect(multWith(p, 1, 'penalty')).toBe(1);
    expect(multWith(p, 1, 'misfortune')).toBe(1);
  });
});

describe('★★ `blessingLevelWithDraw`：`draw` **只在中间档**被调用恰好一次', () => {
  const counter = (): { draw: () => number; count: () => number } => {
    let n = 0;
    return {
      draw: () => {
        n += 1;
        return 1;
      },
      count: () => n,
    };
  };

  it('> 100：一次都不掷（原版 jle 直接定档）', () => {
    const c = counter();
    expect(blessingLevelWithDraw(makePlayer({ fortune: 101 }), 'reward', c.draw)).toBe(2);
    expect(c.count()).toBe(0);
  });

  it('恰好 100：进中间档 ⇒ 掷一次', () => {
    const c = counter();
    expect(blessingLevelWithDraw(makePlayer({ fortune: 100 }), 'reward', c.draw)).toBe(2);
    expect(c.count()).toBe(1);
  });

  it('51..99：掷一次，且用掷出来的那一位', () => {
    const c = counter();
    expect(blessingLevelWithDraw(makePlayer({ fortune: 60 }), 'reward', c.draw)).toBe(2); // draw→1
    expect(c.count()).toBe(1);
    const zero = { draw: (): number => 0, count: () => 0 };
    expect(blessingLevelWithDraw(makePlayer({ fortune: 60 }), 'reward', zero.draw)).toBe(0);
  });

  it('恰好 50 与 0..50：一次都不掷（jle 落到不变档）', () => {
    for (const fortune of [50, 1, 0]) {
      const c = counter();
      expect(blessingLevelWithDraw(makePlayer({ fortune }), 'reward', c.draw)).toBe(0);
      expect(c.count(), `fortune=${fortune}`).toBe(0);
    }
  });

  it('★ 负值：一次都不掷（test si,si / jge）', () => {
    const c = counter();
    expect(blessingLevelWithDraw(makePlayer({ fortune: -1 }), 'reward', c.draw)).toBe(1);
    expect(c.count()).toBe(0);
  });

  it('★ 三种用法的中间档都各掷一次，且罚金/劫难的**档位是反的**', () => {
    // 本函数返回的是**档位**（0/1/2），不是倍率：reward 中间档掷出 1 → 2（加倍）；
    // penalty/misfortune 同一掷 → 1（归零档，语义是「免付」「逃过」）。
    const c1 = counter();
    expect(blessingLevelWithDraw(makePlayer({ fortune: 60 }), 'penalty', c1.draw)).toBe(1);
    expect(c1.count()).toBe(1);
    const c2 = counter();
    expect(blessingLevelWithDraw(makePlayer({ luck: 60 }), 'misfortune', c2.draw)).toBe(1);
    expect(c2.count()).toBe(1);
    const c3 = counter();
    expect(blessingLevelWithDraw(makePlayer({ fortune: 60 }), 'reward', c3.draw)).toBe(2);
    expect(c3.count()).toBe(1);
  });
});
