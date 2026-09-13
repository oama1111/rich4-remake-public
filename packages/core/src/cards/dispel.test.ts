/*
 * 送神符验证 —— 基准为原版 exe 反汇编（VA 0x00444c45）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyDispelCard } from './dispel.ts';
import { makePlayer } from '../testing/factories.ts';

describe('送神符', () => {
  it('★ 送走穷神（类型 5、6）', () => {
    const r = applyDispelCard(makePlayer({ godInfo: 5 }));
    expect(r.ok).toBe(true);
    expect(r.player.godInfo).toBe(0);
    expect(r.removed).toEqual([5]);
  });

  it('★ 送不走财神（类型 1、2）', () => {
    for (const g of [1, 2]) {
      const r = applyDispelCard(makePlayer({ godInfo: g }));
      expect(r.ok).toBe(false);
      expect(r.player.godInfo).toBe(g); // 原样保留
    }
  });

  it('★ 什么都没送走时不消耗卡片', () => {
    // @source test ebx, ebx / je end
    const p = makePlayer({ godInfo: 0, f64: 0 });
    const r = applyDispelCard(p);
    expect(r.ok).toBe(false);
    expect(r.player).toBe(p); // 同一引用，状态未变
  });

  it('★ f64 无类型判定，有就送', () => {
    // 原版对 +0x40 直接 remove_object，不查类型
    const r = applyDispelCard(makePlayer({ f64: 3, godInfo: 0 }));
    expect(r.ok).toBe(true);
    expect(r.player.f64).toBe(0);
    expect(r.removed).toEqual([3]);
  });

  it('两者都有时都送走，顺序为先 f64 后 god_info', () => {
    const r = applyDispelCard(makePlayer({ f64: 3, godInfo: 6 }));
    expect(r.removed).toEqual([3, 6]);
    expect(r.player.f64).toBe(0);
    expect(r.player.godInfo).toBe(0);
  });

  it('f64 有、god_info 是财神时，只送 f64', () => {
    const r = applyDispelCard(makePlayer({ f64: 3, godInfo: 1 }));
    expect(r.ok).toBe(true);
    expect(r.removed).toEqual([3]);
    expect(r.player.godInfo).toBe(1); // 财神留下
  });

  it('不原地修改入参', () => {
    const p = makePlayer({ godInfo: 5 });
    applyDispelCard(p);
    expect(p.godInfo).toBe(5);
  });
});
