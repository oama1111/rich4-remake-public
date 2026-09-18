#!/usr/bin/env python3
"""第 43 条测试：替身四个计时字节都走一天 + 明确「不闸门」是有意为之。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/rules/special-actors.test.ts"

BLOCK = r'''
/**
 * ★★ 替身的**四个**计时字节都要走一天（第 43 条）。
 *
 * @source `tick_blocking` 的 actor 分支 `0x0041ce39`：依次处理 `0x498e34..0x498e37`
 *   四个字节（= 替身记录 `+12..+15` = `hibernating`/`sleepwalkDays`/`halted`/`singleStep`），
 *   每个都是「`test 0x80` → 清零；否则 `dec`，到 0 `or 0x80`」。
 *   复刻先前只走了后两个 ⇒ 冬眠卡/夢遊卡打在替身上之后，那两个计数**永不递减**
 *   （`client/render.ts` 的 `isActorAsleep` 会永远把替身画成灰的）。
 */
describe('★★ 替身四个计时字节各走一天（第 43 条）', () => {
  it('四项一起递减', () => {
    const a = {
      ...idleActor(),
      hibernating: 5,
      sleepwalkDays: 3,
      halted: 2,
      singleStep: 4,
    };
    const t1 = tickNpcCounters(a);
    expect([t1.hibernating, t1.sleepwalkDays, t1.halted, t1.singleStep]).toEqual([4, 2, 1, 3]);
  });

  it('冬眠/梦游到 0 时挂 0x80（释放待清），再走一天清零 —— 与玩家的四项同一套', () => {
    let a = { ...idleActor(), hibernating: 2, sleepwalkDays: 2 };
    a = tickNpcCounters(a);
    expect([a.hibernating, a.sleepwalkDays]).toEqual([1, 1]);
    a = tickNpcCounters(a);
    expect([a.hibernating, a.sleepwalkDays]).toEqual([0x80, 0x80]); // 到 0 → |0x80
    a = tickNpcCounters(a);
    expect([a.hibernating, a.sleepwalkDays]).toEqual([0, 0]); // 0x80 → 清零
  });

  it('★ 走满 6 天后灰化状态消失（`isActorAsleep` 读的就是这两项）', () => {
    // 冬眠卡写 5（`cards/hibernate.ts` 的 HIBERNATE_DAYS）
    let a = { ...idleActor(), hibernating: 5 };
    // 客户端判据：`(hibernating ?? 0) !== 0` 就是"睡着"（`client/render.ts`）
    const asleep = (x: typeof a): boolean => ((x.hibernating ?? 0) !== 0);
    for (let day = 0; day < 5; day++) {
      expect(asleep(a), `第 ${day} 天应仍是睡着`).toBe(true);
      a = tickNpcCounters(a);
    }
    expect(a.hibernating).toBe(0x80); // 第 5 天走完挂释放位（当天仍显示睡着）
    a = tickNpcCounters(a);
    expect(asleep(a)).toBe(false); // 第 6 天起恢复正常
  });

  it('★ 0 不会被弄成 0x80（`dec` 只在原本非 0 时走）', () => {
    const a = tickNpcCounters({ ...idleActor(), hibernating: 0, sleepwalkDays: 0 });
    expect([a.hibernating, a.sleepwalkDays]).toEqual([0, 0]);
  });
});

describe('★ 「冬眠/梦游对替身不闸门」是**有意为之**（原版如此）', () => {
  it('冬眠中的替身照样按 rand()%9+2 步走（`0x40de09` 只读 +14/+15）', () => {
    const base = idleActor();
    const asleep = { ...base, hibernating: 5 };
    const sleepy = { ...base, sleepwalkDays: 5 };
    // 同一颗种子下三者步数完全相同 ⇒ 这两个字段不参与步数判定
    const stepsOf = (a: typeof base): number[] =>
      [1, 2, 3].map((seed) => {
        const rng = new WatcomRng();
        rng.setState(seed);
        return npcTurnSteps(tickNpcCounters(a), rng);
      });
    expect(stepsOf(asleep)).toEqual(stepsOf(base));
    expect(stepsOf(sleepy)).toEqual(stepsOf(base));
  });
});
'''
src = P.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
P.write_text(src, encoding="utf-8")
print("✓ 已追加测试")
