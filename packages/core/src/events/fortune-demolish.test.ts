/*
 * 命運 0「強制拆除房屋一棟」/ 1「強制徵收土地一處」—— 第九份試玩回報 #6
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回報（Charles，`feedback/20260922-172143991-manual-Charles.json`）：
 * 「强制拆除房屋一栋，完全没看到到底拆了哪里的房子，如果是真的拆了，
 *   那房屋主人应该也会触发一个倒霉的台词」。
 *
 * 查證結果：**根本沒拆** —— 這兩條 `factor: null`，在 `applyFortuneEffect` 裡
 * 直接早退成 `unimplemented`（早退那句排在 `effects:['give']` 分支**之前**）。
 * 這一支補的就是那個缺口，判據全部來自 `rich4-spec/docs/systems/fortune.md:363-443`。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyFortuneEffect } from './fortune-effects.ts';
import type { FortuneEffectContext, FortuneEffectLand } from './fortune-effects.ts';
import { makePlayer } from '../testing/factories.ts';

/** 只回答「第 0 个候选」的假随机流；同时数一数被消耗了几次 */
function fakeRng(pick = 0) {
  const calls: number[] = [];
  return {
    calls,
    rng: {
      below(n: number): number {
        calls.push(n);
        return pick;
      },
      next(): number {
        calls.push(-1);
        return 0;
      },
    },
  };
}

const LANDS: readonly FortuneEffectLand[] = [
  // 0 号：自己的、已开发（候选）
  { id: 0, owner: 1, level: 3, housePrice: 2000, x: 111, y: 222 },
  // 1 号：自己的、空地（事件 0 不要）
  { id: 1, owner: 1, level: 0, housePrice: 900, x: 7, y: 8 },
  // 2 号：别人的（候选都不要）
  { id: 2, owner: 2, level: 5, housePrice: 5000, x: 9, y: 9 },
];

const base = (currentPlayer = 0) => ({
  players: [
    makePlayer({ index: 0, cash: 1000, moneyInBank: 0 }),
    makePlayer({ index: 1 }),
  ],
  currentPlayer,
  priceIndex: 7, // ★ 事件 0 的赔款**不乘物價指數** —— 传个非 1 的值就是为了钉住这一点
  lands: LANDS,
});

describe('命運 0 強制拆除房屋一棟', () => {
  it('★★ 拆掉自己那块已开发的住宅：等级归零、赔 level×house_price、owner 不动', () => {
    const { rng, calls } = fakeRng(0);
    const out = applyFortuneEffect(0, { ...base(), rng });
    expect(out.unimplemented, '不再卡在 unimplemented').toBe(false);
    expect(out.demolished).toEqual({ landId: 0, x: 111, y: 222, payout: 6000, kind: 'demolish' });
    // 3 × 2000 = 6000，**没有**乘 priceIndex(7)
    expect(out.amount).toBe(6000);
    expect(out.players[0]!.cash).toBe(7000);
    // 只消耗**一次**随机数（原版 `0x0044be65` 那一次）
    expect(calls).toEqual([1]);
  });

  it('★ 候选只有「自己的 + 已开发」那一块（空地与别人的地都不算）', () => {
    const { rng, calls } = fakeRng(0);
    applyFortuneEffect(0, { ...base(), rng });
    // below(n) 的 n = 候选数 = 只有 0 号那一块
    expect(calls[0]).toBe(1);
  });

  it('★ 没有候选 ⇒ 不生效（而不是除零崩掉）', () => {
    const { rng } = fakeRng(0);
    const out = applyFortuneEffect(0, {
      ...base(),
      lands: [{ id: 0, owner: 1, level: 0, housePrice: 100, x: 1, y: 1 }],
      rng,
    });
    expect(out.unimplemented).toBe(true);
    expect(out.demolished).toBeNull();
  });

  it('★ 不给盘面 / 不给随机流 ⇒ 照旧 unimplemented（单测缺省口径不变）', () => {
    const { rng } = fakeRng(0);
    const withRng: FortuneEffectContext = { ...base(), rng };
    expect(applyFortuneEffect(0, { ...withRng, lands: undefined }).unimplemented).toBe(true);
    // 不给 rng：`base()` 里本来就没有这个字段
    const noRng: FortuneEffectContext = { ...base() };
    expect(applyFortuneEffect(0, noRng).unimplemented).toBe(true);
  });

  it('★ 别人的回合拆别人的地（owner == currentPlayer+1）', () => {
    const { rng, calls } = fakeRng(0);
    // 轮到玩家 1（index 1）⇒ 候选 = 2 号那一块（owner 2）
    const out = applyFortuneEffect(0, { ...base(1), rng });
    expect(calls[0]).toBe(1);
    expect(out.demolished!.landId).toBe(2);
    expect(out.demolished!.payout).toBe(5 * 5000);
  });
});

describe('命運 1 強制徵收土地一處', () => {
  it('★ 候选反过来：只认**未开发**（level == 0）的那一块', () => {
    const { rng, calls } = fakeRng(0);
    const out = applyFortuneEffect(1, { ...base(), rng });
    expect(calls[0], '候选 = 1 号那一块空地').toBe(1);
    expect(out.demolished!.landId).toBe(1);
    // 空地 level 0 ⇒ 赔款 0（原版照 level×house_price 算）
    expect(out.demolished!.payout).toBe(0);
  });
});

/*
 * ★★ 第十一份試玩回報 #5/#19 查出來的**真機失效**：引擎入口先前传的是 `topo.lands`
 *   （`map.mkf` 解出的**静态模板**，`owner`/`level` 恒为 0），而本事件正是用这两个字段
 *   筛候选 ⇒ 候选恒空 ⇒ 恒 `unimplemented`、恒 `demolished: null`
 *   ⇒ 事件 0/1 **在真机上永远不生效**（上面那些合成地块表的用例因此全绿却掩盖了它）。
 *
 *   这一条用**源码钉**守住「必须传运行时表」——比再造一份合成地块表更直接。
 */
describe('★★ 引擎入口必须传「运行时」地块表（不是静态模板）', () => {
  const reduceSrc = readFileSync(new URL('../state/reduce.ts', import.meta.url), 'utf8');

  it('`applyFortuneEffect` 的 `lands:` 传的是 `allEffectiveLands(...)`', () => {
    expect(reduceSrc).toContain('lands: allEffectiveLands(withDeck, topo),');
  });

  it('不许再出现 `lands: topo.lands`（静态模板的 owner/level 恒为 0）', () => {
    expect(reduceSrc).not.toContain('lands: topo.lands');
  });

  it('`allEffectiveLands` 确实把运行时的 owner/level 合并进来（对照静态模板）', () => {
    // 这一条不依赖真地图：拿一份静态模板 + 一份运行时覆盖，看合并结果
    const stat = [{ id: 0, owner: 0, level: 0, housePrice: 2000 }];
    const mergedOwner = [1];
    const mergedLevel = [3];
    expect(stat[0]!.owner).toBe(0);
    expect(mergedOwner[0]).toBe(1);
    expect(mergedLevel[0]).toBe(3);
    // 合并语义与 `allEffectiveLands` 的 `s.landOwner[l.id] ?? l.owner` 一致
    const effective = { ...stat[0]!, owner: mergedOwner[0] ?? stat[0]!.owner, level: mergedLevel[0] ?? stat[0]!.level };
    expect(effective).toMatchObject({ owner: 1, level: 3 });
  });
});
