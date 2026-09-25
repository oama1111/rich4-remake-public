/*
 * 查税卡验证 —— 基准为原版 exe 反汇编（VA 0x004451f0）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyTaxCard, TAX_RATE } from './tax.ts';
import { PASSIVE_CARDS } from './passive.ts';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import type { Player } from '../state/types.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, WHO_PLAYS_AUTOPILOT } from '../state/types.ts';
import { reduce } from '../state/reduce.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { HOUSING_TYPE_MIN } from '../rules/land.ts';

const four = (cash = 100_000) =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, cash }));

/**
 * 记录调用次数的随机出口替身 —— 用来钉「原版在这里消耗了几次 `rand()`」。
 * `next()` 依次返回 `values`，用完之后一直返回最后一个（没有就给 0）。
 */
function countingRng(...values: number[]): { calls: number; next(): number } {
  let i = 0;
  const src: { calls: number; next(): number } = {
    calls: 0,
    next(): number {
      src.calls += 1;
      const v = values[i] ?? values[values.length - 1] ?? 0;
      i += 1;
      return v;
    },
  };
  return src;
}

/** 4 人桌：0 号是施卡者（真人，100_000 现金）；1 号是受害者（由参数决定） */
const table = (
  victimCash: number,
  victimWhoPlays: number,
  victimCards: number[],
): Player[] =>
  [0, 1, 2, 3].map((i) =>
    i === 1
      ? makePlayer({
          index: i,
          character: i,
          cash: victimCash,
          whoPlays: victimWhoPlays,
          cards: victimCards,
        })
      : makePlayer({ index: i, character: i, cash: i === 0 ? 100_000 : 10_000 }),
  );

// ★★ 税金必须**转给施卡者**（原版 `0x004453a4` `0x41d2c6(目标, 使用者, tax2, 0)`；
//   旗标 0 ⇒ 目标**现金扣**、施卡者**存款收**，且施卡者 `+0x60` 本月收入累加）。
//   此前 remake 只 `cash - tax`，钱凭空消失、施卡者一分拿不到。
describe('★ 税金转给施卡者（不是凭空消失）', () => {
  it('目标现金 −tax、施卡者存款 +tax、施卡者本月收入 +tax', () => {
    const ps = four(500_000);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.players[1]!.cash).toBe(400_000); // 目标现金扣
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + 100_000); // ★ 施卡者存款收
    expect(r.players[0]!.cash).toBe(500_000); // 不进现金（旗标 0）
    expect(r.players[0]!.monthlyReceived).toBe(ps[0]!.monthlyReceived + 100_000); // ★ +0x60
    // 目标的本月支出也累加（0x41d2c6 付款方侧 `add [+0x5c], paid`）
    expect(r.players[1]!.monthlyPaid).toBe(ps[1]!.monthlyPaid + 100_000);
  });

  it('目标现金不足时级联到存款', () => {
    const ps = four(1_000).map((p, i) => (i === 1 ? { ...p, cash: 100, moneyInBank: 10_000 } : p));
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.tax).toBe(20); // trunc(100 × 0.2)
    expect(r.players[1]!.cash).toBe(80);
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + 20);
  });
});

// ★ 免費卡(20) 被**消耗**：原版 `0x444a60` 内部 `0x444b30 push 0x14 / call 0x441343`
describe('★ 免費卡(20)：免掉税金且被消耗', () => {
  it('持免費卡则不转账，且该卡被扣掉', () => {
    const ps = four(500_000).map((p, i) =>
      i === 1 ? { ...p, cards: [PASSIVE_CARDS.FREE, 3] } : p,
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.defended).toBe(true);
    expect(r.players[1]!.cash).toBe(500_000); // 没扣钱
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank); // 施卡者也没收到
    expect(r.players[1]!.cards).toEqual([3]); // ★ 免費卡没了
    expect(ps[1]!.cards).toContain(PASSIVE_CARDS.FREE); // 原数组不变
  });

  it('★ 敌意照记（原版在免費卡判定**之前**就算好 `tax/100`）', () => {
    const ps = four(500_000).map((p, i) =>
      i === 1 ? { ...p, cards: [PASSIVE_CARDS.FREE] } : p,
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.defended).toBe(true);
    expect(r.hostilityDelta).toBe(1000); // 100_000 / 100
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  ★★ §7.142(5) 的 E5：`0x444a60` 内部那道 **AI 門檻**（`0x444a9b`–`0x444ad3`）
//
//  原版 `0x44532d call 0x444a60` 的**返回值**才是裁决，不是「有卡就免单」：
//  ```asm
//  00444a9b  call 0x456f2d                    ; ★ 电脑：先无条件吃掉一次 rand()
//  00444aaa  idiv esi (esi=0xbb8=3000)
//  00444aac  add  edx, esi                    ; 3000 + rand()%3000
//  00444ab4  imul esi, edx                    ; 门槛 = pi × (3000 + rand()%3000)
//  00444abe  cmp  eax, [ebx + 0x496b84]       ; 税额 vs 受害者现金
//  00444ac4  jg   0x444aca                    ; 税额 > 现金 ⇒ 用
//  00444ac8  jge  0x444ad1                    ; 门槛 >= 税额 ⇒ ★ 不用（卡留着、照付）
//  ```
//  电脑受害者小额查稅在原版**留着免费卡照付**；复刻旧版只要有卡就免税且烧卡。
// ══════════════════════════════════════════════════════════════════════════
describe('★★ 免費卡(20) 的 AI 門檻（原版 0x444a60）', () => {
  it('★ 门槛以下（税额 2000 < 门槛 3000）⇒ **不扣卡 + 照付**', () => {
    // pi=1、rand()=0 ⇒ 门槛 = 1 × (3000 + 0) = 3000；现金 10_000 ⇒ 税额 2000
    const ps = table(10_000, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const rng = countingRng(0);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);

    expect(Math.trunc(ps[1]!.cash * 0.2)).toBe(2000); // 前提：税额 2000
    expect(r.defended).toBe(false);
    expect(r.players[1]!.cards).toContain(PASSIVE_CARDS.FREE); // ★ 卡留着
    expect(r.players[1]!.cash).toBe(ps[1]!.cash - 2000); // ★ 一分不少地付
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + 2000); // 税金照转
    expect(rng.calls).toBe(1); // ★ 判「不用」也照样消耗一次
  });

  it('★ 税额 == 门槛（3000）⇒ 不用卡（严格大于：`jge 0x444ad1` 判不用）', () => {
    // 现金 15_000 ⇒ 税额 3000；pi=1、rand()=0 ⇒ 门槛 3000（边界）
    const ps = table(15_000, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const rng = countingRng(0);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);

    expect(Math.trunc(ps[1]!.cash * 0.2)).toBe(3000); // 前提：税额 == 门槛
    expect(r.defended).toBe(false); // ★ 相等 ⇒ 不用（严格 `>`）
    expect(r.players[1]!.cards).toEqual([PASSIVE_CARDS.FREE]);
    expect(r.players[1]!.cash).toBe(15_000 - 3000);
    expect(rng.calls).toBe(1);
  });

  it('★ 门槛以上（税额 3001 > 门槛 3000）⇒ **扣卡 + 免单**', () => {
    const ps = table(15_005, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const rng = countingRng(0);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);

    expect(Math.trunc(ps[1]!.cash * 0.2)).toBe(3001);
    expect(r.defended).toBe(true);
    expect(r.players[1]!.cards).toEqual([]); // ★ 卡被消耗
    expect(r.players[1]!.cash).toBe(15_005); // 免单
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank); // 施卡者收不到
    expect(r.tax).toBe(3001); // 税额仍被算出
    expect(rng.calls).toBe(1);
  });

  it('★ 门槛确实含 `3000 + rand()%3000` 两项：rand=1 ⇒ 门槛 3001（税额 3001 就**不用**了）', () => {
    // 若门槛写成 `rand()%3000`（漏了 +3000），rand=1 时门槛是 1 ⇒ 会误判「用」
    const ps = table(15_005, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const use = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, countingRng(0));
    const skip = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, countingRng(1));
    expect(use.defended).toBe(true); // 门槛 3000 ≤ 税额−1
    expect(skip.defended).toBe(false); // ★ 门槛 3001 == 税额 ⇒ 不用
    expect(skip.players[1]!.cards).toEqual([PASSIVE_CARDS.FREE]);
  });

  it('★ 物價指數参与：pi=2 ⇒ 门槛 6000（税额 6000 不用、6001 用）', () => {
    const boundary = table(30_000, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const above = table(30_005, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const b = applyTaxCard(boundary, 0, { kind: 'player', index: 1 }, 2, () => -1, countingRng(0));
    const a = applyTaxCard(above, 0, { kind: 'player', index: 1 }, 2, () => -1, countingRng(0));
    expect(Math.trunc(boundary[1]!.cash * 0.2)).toBe(6000);
    expect(b.defended).toBe(false); // 门槛 2×3000 = 6000 == 税额
    expect(a.defended).toBe(true); // 6001 > 6000
  });

  it('★ 判「不用」之后**继续往下走**（嫁祸卡分支照查 —— 不是提前返回）', () => {
    // 现金 25_000 ⇒ 税额 5000；rand=2999 ⇒ 门槛 5999 ≥ 5000 ⇒ 不用免費卡
    // 但税额 5000 > 2000 且持 19、cash > 20000×pi ⇒ 嫁祸卡分支照走
    const ps = table(25_000, WHO_PLAYS_COMPUTER, [
      PASSIVE_CARDS.FREE,
      PASSIVE_CARDS.SCAPEGOAT,
    ]);
    const rng = countingRng(2999);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);

    expect(r.defended).toBe(false);
    // ★ 免費卡还在；嫁祸卡也还在：决定者返回 −1（放弃）⇒ 不扣 19（`0x004449e7` 在扣卡点之前）
    expect(r.players[1]!.cards).toEqual([PASSIVE_CARDS.FREE, PASSIVE_CARDS.SCAPEGOAT]);
    expect(r.players[1]!.cash).toBe(25_000 - 5000); // 照付
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + 5000);
    expect(rng.calls).toBe(1); // 只消耗这一次（嫁祸那支没有 rand）
  });

  it('★★ 恰好消耗**一次** `rand()`：判「用」也一次、判「不用」也一次（同一状态两次跑法一致）', () => {
    const ps = table(15_005, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const yes = countingRng(0, 123, 456); // 若多取一次，calls 会是 2
    const no = countingRng(2999, 123);
    applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, yes);
    applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, no);
    expect(yes.calls).toBe(1);
    expect(no.calls).toBe(1);
  });

  it('★ 受害者**没有**免費卡 ⇒ 一次 `rand()` 都不消耗（原版先 `has_card` 才调 0x444a60）', () => {
    const ps = table(15_005, WHO_PLAYS_COMPUTER, [3, 7]);
    const rng = countingRng(0);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);
    expect(r.defended).toBe(false);
    expect(rng.calls).toBe(0); // @source 0x44530d `call 0x4413ad` 不过就不调 0x444a60
  });

  it('★ 真人走确认框那一支（`0x444a92 cmp byte,1 / je 0x444ad8`）⇒ **不碰随机流**、默认「用」', () => {
    // 若把电脑判据套到真人身上：门槛 5999 > 税额 3000 ⇒ 会判「不用」，且会多吃一次 rand()
    const ps = table(15_000, WHO_PLAYS_HUMAN, [PASSIVE_CARDS.FREE]);
    const rng = countingRng(2999);
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);
    expect(r.defended).toBe(true); // core 无弹窗 ⇒ 默认为是（见 tax.ts 注 / 报告）
    expect(rng.calls).toBe(0); // ★ 原版真人那一支里没有 `call 0x456f2d`
    expect(r.players[1]!.cards).toEqual([]);
  });

  it('★ 判据用**整字节** `whoPlays == 1`：带托管位(0x04)的人落进电脑支', () => {
    // @source 0x444a92 `cmp byte ptr [ebx+0x496b7d], 1` —— 精确等于 1，不是位测试
    const ps = table(15_005, WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT, [PASSIVE_CARDS.FREE]);
    const rng = countingRng(2999); // 门槛 5999 > 税额 3001 ⇒ 电脑支判「不用」
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);
    expect(r.defended).toBe(false);
    expect(rng.calls).toBe(1); // 走了电脑支 ⇒ 吃了一次 rand()
  });

  it('★ 第一析取 `税额 > 现金`（现金为负时才可能，过路费那支是它起作用的地方）', () => {
    // 原版 `0x444abe cmp eax,[ebx+0x496b84] / jg 0x444aca`：现金 -1000、税额 -200
    const ps = table(-1_000, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]);
    const rng = countingRng(2999); // 门槛 5999，靠第一析取才用
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, rng);
    expect(r.tax).toBe(-200);
    expect(r.defended).toBe(true); // -200 > -1000 ⇒ 用
    expect(r.players[1]!.cards).toEqual([]);
    expect(rng.calls).toBe(1); // ★ 随机数在比较**之前**就消耗掉了（原版次序）
  });

  it('★ 预览路径（没有随机流）⇒ 退化成 `rand() == 0`（门槛 = pi×3000）', () => {
    const atBoundary = table(15_000, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]); // 税额 3000
    const above = table(15_005, WHO_PLAYS_COMPUTER, [PASSIVE_CARDS.FREE]); // 税额 3001
    const b = applyTaxCard(atBoundary, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    const a = applyTaxCard(above, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(b.defended).toBe(false);
    expect(a.defended).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  ★★ 接驳：`0x444a9b` 那一次 `rand()` 必须**真的**从引擎的全局随机流里拿
//  （`registry.ts` 的 case 26 把 `ctx.rng` 传进来；`reduce.ts` 的 `playCard`
//   再把 `rngState` 写回 —— C-DET-4）。少了这一步，AI 受害者的门槛会退化成
//   `pi×3000`，且整局 RNG 流比原版少走一格。
// ══════════════════════════════════════════════════════════════════════════
describe('★★ 接驳：AI 门槛真的动了全局随机流（rngState）', () => {
  /** 找一个 `rngState`，使其第一次 `rand()` 的 `% 3000` 恰为 `want` */
  const stateWithRoll = (want: number): number => {
    const rng = new WatcomRng();
    for (let x = 1; x < 1_000_000; x++) {
      rng.setState(x);
      if (rng.next() % 3000 === want) return x;
    }
    throw new Error(`找不到 rand()%3000 == ${want} 的种子`);
  };

  /** 0 号持查稅卡（26）打 1 号；1 号是**电脑**且持免費卡 */
  const scene = (victimCash: number, roll: number) => {
    const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
    const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
    const base = makeGameState({ rngState: stateWithRoll(roll), priceIndex: 1 });
    const state = {
      ...base,
      players: base.players.map((p, i) =>
        i === 0
          ? { ...p, cards: [26] }
          : i === 1
            ? {
                ...p,
                whoPlays: WHO_PLAYS_COMPUTER,
                cash: victimCash,
                cards: [PASSIVE_CARDS.FREE],
              }
            : p,
      ),
    };
    return { state, topo: { nodes: [node], lands: [land] } };
  };

  const play = (victimCash: number, roll: number) => {
    const { state, topo } = scene(victimCash, roll);
    return {
      before: state,
      after: reduce(
        state,
        { type: 'useCard', cardId: 26, target: { kind: 'player', index: 1 } },
        topo,
      ),
    };
  };

  it('★ 税额 3001 > 门槛 3000（rand%3000 == 0）⇒ 免单 + 扣卡 + rngState 前进', () => {
    const { before, after } = play(15_005, 0);
    expect(after).not.toBe(before);
    expect(after.rngState).not.toBe(before.rngState); // ★ 那一次 rand() 真的被消耗
    expect(after.players[1]!.cash).toBe(15_005); // 免单
    expect(after.players[1]!.cards).toEqual([]); // 卡被扣
  });

  it('★ 税额 3001 ≤ 门槛 5999（rand%3000 == 2999）⇒ 卡留着、照付，但 rngState **照样**前进', () => {
    const { before, after } = play(15_005, 2999);
    expect(after.rngState).not.toBe(before.rngState); // ★ 判「不用」也消耗一次
    expect(after.players[1]!.cash).toBe(15_005 - 3001); // 一分不少地付
    expect(after.players[1]!.cards).toEqual([PASSIVE_CARDS.FREE]); // 卡留着
  });
});

// ★ 嫁祸卡(19) 分支：**税额 > 2000** 且目标持有 19 时可换目标，
//   且 `tax2` **按最终目标的现金重算**（原版 `0x0044534e` / `0x0044537d`–`0x00445391`）。
describe('★ 查稅卡的嫁祸分支与 tax2 重算', () => {
  it('税额 > 2000 且持嫁祸卡 ⇒ 换目标，金额按**新目标**现金重算', () => {
    // 目标 1：cash 100_000 ⇒ tax 20_000 > 2000；持嫁祸卡
    // 新目标 3：cash 50_000 ⇒ tax2 = 10_000
    const ps = four(0).map((p, i) => {
      if (i === 1) return { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] };
      if (i === 3) return { ...p, cash: 50_000 };
      return { ...p, cash: 10_000 };
    });
    // 期望值**从实际玩家值推导**，不写死 —— 这样测的是"重算"这个行为本身
    const taxOrig = Math.trunc(ps[1]!.cash * 0.2);
    const taxNew = Math.trunc(ps[3]!.cash * 0.2);
    expect(taxOrig).toBeGreaterThan(2000); // 前提：超过嫁祸门槛
    expect(taxNew).not.toBe(taxOrig); // 前提：两个数不同，否则测不出"重算"

    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => 3, undefined);
    expect(r.tax).toBe(taxNew); // ★ 按**新目标**重算，不是 taxOrig
    expect(r.players[3]!.cash).toBe(ps[3]!.cash - taxNew); // 新目标付钱
    expect(r.players[1]!.cash).toBe(ps[1]!.cash); // 原目标不动
    expect(r.players[0]!.moneyInBank).toBe(ps[0]!.moneyInBank + taxNew); // 施卡者收款
    expect(r.players[1]!.cards).not.toContain(PASSIVE_CARDS.SCAPEGOAT); // 嫁祸卡被消耗
  });

  it('★ 税额 ≤ 2000 时**不查**嫁祸卡（原版 `jle 0x44536f`）', () => {
    const ps = four(0).map((p, i) =>
      i === 1 ? { ...p, cash: 10_000, cards: [PASSIVE_CARDS.SCAPEGOAT] } : { ...p, cash: 1_000 },
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => 3, undefined);
    const taxOrig = Math.trunc(ps[1]!.cash * 0.2);
    expect(taxOrig).toBeLessThanOrEqual(2000); // 前提：未过门槛
    expect(r.tax).toBe(taxOrig); // 未换目标 ⇒ 金额不变
    expect(r.players[1]!.cash).toBe(ps[1]!.cash - taxOrig);
    expect(r.players[1]!.cards).toContain(PASSIVE_CARDS.SCAPEGOAT); // 没被消耗
  });

  // ★★ 2026-09-24 审计订正：旧用例钉的是「放弃也扣 19」—— 原版 `0x004449e7 cmp ebx,-1 / je 0x444a53`
  //   在扣卡点 `0x004449ef call 0x441343` **之前** ⇒ 放弃转嫁**不扣**。
  it('放弃转嫁（-1）⇒ 保持原目标，嫁祸卡**不扣**（0x004449e7 在 0x004449ef 之前）', () => {
    const ps = four(0).map((p, i) =>
      i === 1 ? { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] } : { ...p, cash: 1_000 },
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.tax).toBe(Math.trunc(ps[1]!.cash * 0.2));
    expect(r.players[1]!.cards).toContain(PASSIVE_CARDS.SCAPEGOAT);
  });

  it('★ 嫁禍回查稅的人自己 ⇒ 不收税（0x00445375 je 0x445421），嫁祸卡照扣', () => {
    const ps = four(0).map((p, i) =>
      i === 1 ? { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] } : { ...p, cash: 1_000 },
    );
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => 0, undefined);
    expect(r.ok).toBe(true);
    expect(r.tax).toBe(0);
    expect(r.players[0]!.cash).toBe(1_000);
    expect(r.players[1]!.cash).toBe(100_000);
    expect(r.players[1]!.cards).not.toContain(PASSIVE_CARDS.SCAPEGOAT);
  });

  it('★ 敌意仍按**最初**的税额算（在嫁祸之前，`0x004452fa`）', () => {
    const ps = four(0).map((p, i) => {
      if (i === 1) return { ...p, cash: 100_000, cards: [PASSIVE_CARDS.SCAPEGOAT] };
      if (i === 3) return { ...p, cash: 50_000 };
      return { ...p, cash: 0 };
    });
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => 3, undefined);
    expect(r.tax).toBe(Math.trunc(ps[3]!.cash * 0.2)); // 转移额是重算后的
    // ★ 但敌意 = **最初**那个税额 / 100（`0x004452fa` 在嫁祸之前）
    expect(r.hostilityDelta).toBe(Math.trunc(Math.trunc(ps[1]!.cash * 0.2) / 100));
  });
});

describe('查税卡', () => {
  it('★ 税率为 20%', () => {
    expect(TAX_RATE).toBe(0.2);
    const r = applyTaxCard(four(500_000), 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.tax).toBe(100_000);
    expect(r.players[1]!.cash).toBe(400_000);
  });

  it('税额向零取整', () => {
    // 999 × 0.2 = 199.8 → 199
    const r = applyTaxCard(four(999), 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.tax).toBe(199);
  });

  it('只影响目标', () => {
    const r = applyTaxCard(four(500_000), 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.players[0]!.cash).toBe(500_000);
    expect(r.players[2]!.cash).toBe(500_000);
  });

  it('敌意 = 税额 / 100', () => {
    const r = applyTaxCard(four(500_000), 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.hostilityDelta).toBe(1_000);
  });

  it('不可对自己使用', () => {
    expect(
      applyTaxCard(four(), 1, { kind: 'player', index: 1 }, 1, () => -1, undefined).error,
    ).toBe('cannotTargetSelf');
  });
});

describe('★ 免费卡防御', () => {
  it('目标持有免费卡时不扣钱', () => {
    // @source push 0x14 (20 = 免费卡) / call has_card
    const ps = four(500_000);
    ps[1] = makePlayer({ index: 1, cash: 500_000, cards: [PASSIVE_CARDS.FREE] });
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.defended).toBe(true);
    expect(r.players[1]!.cash).toBe(500_000); // 未被扣
    expect(r.tax).toBe(100_000);               // 但税额仍被算出
  });

  it('持有其他防御卡不管用', () => {
    const ps = four(500_000);
    // 免罪卡(21) 防的是梦游那类，不防查税
    ps[1] = makePlayer({ index: 1, cash: 500_000, cards: [PASSIVE_CARDS.ABSOLUTION] });
    const r = applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(r.defended).toBe(false);
    expect(r.players[1]!.cash).toBe(400_000);
  });

  it('★ 不同有害卡查不同的防御卡', () => {
    // 查税卡查免费卡(20)；梦游卡查免罪卡(21)与嫁祸卡(19)
    expect(PASSIVE_CARDS.FREE).toBe(20);
    expect(PASSIVE_CARDS.ABSOLUTION).toBe(21);
    expect(PASSIVE_CARDS.SCAPEGOAT).toBe(19);
  });
});

describe('纯净性', () => {
  it('不原地修改入参', () => {
    const ps = four(500_000);
    const snap = JSON.stringify(ps);
    applyTaxCard(ps, 0, { kind: 'player', index: 1 }, 1, () => -1, undefined);
    expect(JSON.stringify(ps)).toBe(snap);
  });
});
