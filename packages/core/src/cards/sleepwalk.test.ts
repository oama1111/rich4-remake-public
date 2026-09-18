/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 夢遊卡 —— 以 VA 0x004441dc 为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { PASSIVE_CARDS } from './passive.ts';
import { emptyTools, toolCount } from '../rules/tools.ts';
import {
  REVENGE_DAYS,
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

// ★ 敌意：**在防御卡判定之前**就记（`@source 0x004442cb`–`0x004442ea`）
//   系数 = `150 × price_index`（汇编里 `shl 2/add/shl 1/…` 合成 150，见常量注释）。
describe('★ 敌意增量 150 × priceIndex（位置在防御卡之前）', () => {
  it('普通命中：目标 → 出牌者，delta = 150 × pi', () => {
    const r = applySleepwalkCard(four(), 0, tgt(2), emptyTools(4), () => -1, 3);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 450 }]);
  });

  it('★ 被免罪卡(21)挡下时**照样**记（原版在 0x4442f5 之前就 call）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => -1, 2);
    expect(r.outcome!.kind).toBe('applied');
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 300 }]);
  });

  it('★ 被嫁祸改写后仍记在**原始目标**头上（敌意在改写之前）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => 3, 1);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 150 }]);
  });

  // ★ 冬眠闸门（原版 `0x004442be cmp [eax+0x496b9e],0 / jne 0x44449b`）：
  //   目标已在冬眠 ⇒ **不记敌意、不查防御卡、不施加效果**，但**卡仍被消耗**
  //   （原版由调用方在进入处理函数前就 remove_card）⇒ `ok` 仍是 `true`。
  it('★ 目标**已在冬眠**：效果不施加、不记敌意，但 `ok` 仍为 true（卡照扣）', () => {
    const ps = four();
    ps[2] = { ...ps[2]!, blocking: { ...ps[2]!.blocking, sleeping: 3 } };
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => -1, 5);
    expect(r.ok).toBe(true); // ★ 不是 fail —— 卡已消耗
    expect(r.outcome).toEqual({ kind: 'ineffective', victim: 2, reason: 'sleeping' });
    expect(r.hostilityDeltas).toEqual([]);
    expect(r.players[2]!.blocking.sleepWalking).toBe(0); // 没被施加
  });

  it('★ 冬眠闸门**优先于**防御卡：目标同时持免罪卡也不消耗它', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    ps[2] = { ...ps[2]!, blocking: { ...ps[2]!.blocking, sleeping: 3 } };
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => -1, 1);
    expect(r.outcome!.kind).toBe('ineffective');
    expect(r.players[2]!.cards).toContain(PASSIVE_CARDS.ABSOLUTION); // 没被查、没被扣
  });
});

describe('★ 復仇卡(18)：把效果反弹给出牌者', () => {
  // ★ 原版是**两人都梦游**，不是"效果被替换"：
  //   `0x004443e6 call 0x40b93b`（主效果施加给**最终目标**）
  //   → `0x004443ef cmp ebx,ebp` 检查是否被嫁祸改写
  //   → `0x0044440b call 0x444691`（復仇卡生效）→ `0x0044441d` 给**施卡者** `+0x37 = 5`。
  //   先前这条测试断言目标 `sleepWalking === 0`，把"替换"当成了语义。
  it('目标持復仇卡 → 目标与出牌者**都**梦游（主效果先施加，再反弹给施卡者）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(r.outcome).toEqual({ kind: 'reflected', victim: 0, days: REVENGE_DAYS });
    expect(r.players[2]!.blocking.sleepWalking).toBe(SLEEPWALK_DAYS_OTHER); // ★ 目标照样中
    expect(r.players[0]!.blocking.sleepWalking).toBe(REVENGE_DAYS); // ★ 施卡者也中 5 天
  });

  // ★ 原版是**硬编码 5**：`0x0044441d mov byte ptr [eax+0x496b9f], 5`
  //   （eax = `[0x49910c]` 的玩家结构，即施卡者），**不是**「对自己 4 天」那条式子
  //   （那条是 `0x0044435e cmp ebx,[0x49910c] / setne al / add al,4`，用在主效果上）。
  //   先前这条测试的名字与断言都写成 4，把错值钉死了。
  it('★ 反弹天数恒为 5（硬编码，不走「对自己 4 天」）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(r.outcome).toMatchObject({ kind: 'reflected', days: 5 });
    expect(r.players[0]!.blocking.sleepWalking).toBe(5);
  });

  it('★ 復仇卡被**消耗**（原版 0x4446f0 remove_card(持有者, 18)）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []]);
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(r.players[2]!.cards).not.toContain(PASSIVE_CARDS.REVENGE);
  });

  it('★ 反弹时退还的是出牌者的交通工具（目标自己那份也退，因为他也梦游）', () => {
    // 出牌者(0) 骑機車(1→道具 5)；目标(2) 骑汽車(2→道具 6)
    // （`TRAFFIC_TO_TOOL` 只认 1/2，见 rules/tools.ts 的记号）
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []], 1);
    ps[2] = { ...ps[2]!, trafficMethod: 2, ndices: 2 };
    const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
    expect(toolCount(r.tools, 0, 5)).toBe(1); // 出牌者的機車退了
    expect(toolCount(r.tools, 2, 6)).toBe(1); // ★ 目标的汽車也退了（`0x004443e6` 主效果照走）
  });

  // ★ 防御卡链（原版顺序：免罪(21) → 嫁祸(19) → 復仇(18)），且命中即**消耗**
  describe('★ 防御卡链按 21→19 查，命中即消耗', () => {
    it('目标持免罪卡(21)：完全抵消，且**不再**查復仇卡', () => {
      const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION, PASSIVE_CARDS.REVENGE], []]);
      const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
      expect(r.outcome).toEqual({ kind: 'applied', victim: 2, days: 0, absolved: true });
      expect(r.players[2]!.blocking.sleepWalking).toBe(0);
      expect(r.players[0]!.blocking.sleepWalking).toBe(0); // 没被反弹
      expect(r.players[2]!.cards).toContain(PASSIVE_CARDS.REVENGE); // 復仇卡还在（没被查）
    });

    it('免罪卡被消耗（原版 0x444c11 remove_card(持有者, 21)）', () => {
      const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
      const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4));
      expect(r.players[2]!.cards).not.toContain(PASSIVE_CARDS.ABSOLUTION);
    });

    it('目标持嫁祸卡(19)：改用 picker 给的新目标，且嫁祸卡被消耗', () => {
      const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
      const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => 3);
      expect(r.outcome!.victim).toBe(3);
      expect(r.players[3]!.blocking.sleepWalking).toBe(SLEEPWALK_DAYS_OTHER);
      expect(r.players[2]!.blocking.sleepWalking).toBe(0);
      expect(r.players[2]!.cards).not.toContain(PASSIVE_CARDS.SCAPEGOAT);
    });

    it('★ 被嫁祸改写后，**不再**查復仇卡（原版 cmp ebx,ebp / jne）', () => {
      const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.REVENGE], []]);
      const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => 3);
      expect(r.outcome!.kind).toBe('applied'); // 没反弹
      expect(r.players[0]!.blocking.sleepWalking).toBe(0);
      expect(r.players[2]!.cards).toContain(PASSIVE_CARDS.REVENGE);
    });

    it('嫁祸 picker 放弃（-1）时保持原目标，復仇卡仍会被查', () => {
      const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.REVENGE], []]);
      const r = applySleepwalkCard(ps, 0, tgt(2), emptyTools(4), () => -1);
      expect(r.outcome!.kind).toBe('reflected'); // 最终目标 == 原始目标 ⇒ 查復仇
      expect(r.players[0]!.blocking.sleepWalking).toBe(REVENGE_DAYS);
    });
  });

  it('其他被动卡不反弹（免費卡(20) 在梦游路径上无作用）', () => {
    for (const c of [PASSIVE_CARDS.FREE]) {
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
