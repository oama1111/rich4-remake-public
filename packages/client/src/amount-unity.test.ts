/*
 * 「所有涉及输入数字的都调用**同一个计算器**」—— 用结构钉住
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-16 第 1、2 条：
 *   「游戏里所有涉及输入数字的应该调用的都是同一个计算器」
 *   「股市里购买股票应该也是调用那个通用计算器」。
 *
 * ★ 裁决手段是 exe：整份 rich4.exe 里 `call 0x453544` **只有 12 处**
 *   （`python3 tools/disasm.py callers 0x00453544`），全在这张表里：
 *
 * | # | 调用点 VA | 哪一屏的哪一处 | 本引擎对应入口 |
 * |---|---|---|---|
 * | 1 | 0x0041d25b | 上市企業落点「認購股份」`fcn_0041d1a9` | `interactions.ts` `buyShares` |
 * | 2 | 0x0042af92 | 股市柜台 **買進** `fcn_0042aaff` | `amount-form.ts` `stockAmountForm(buy)` |
 * | 3 | 0x0042b07e | 股市柜台 **賣出** `fcn_0042aaff` | `amount-form.ts` `stockAmountForm(sell)` |
 * | 4 | 0x00434671 | 特別融資 **借** `fcn_00434492` | `interactions.ts` `bank.financeBorrow` |
 * | 5 | 0x004346c2 | 特別融資 **還** `fcn_00434492` | `interactions.ts` `bank.financeRepay` |
 * | 6 | 0x00435245 | 貸款屏 **借** `fcn_00435062` | `interactions.ts` `bank.borrow` |
 * | 7 | 0x00435367 | 貸款屏 **還** `fcn_00435062` | `interactions.ts` `bank.repay` |
 * | 8 | 0x00425ee9 | 個人資產表 **賣股票** `fcn_004258c1` | `board-screen.ts` `boardPriceUi(stock)` |
 * | 9 | 0x00425f6b | 個人資產表 **賣股票**（另一支）| 同上 |
 * | 10 | 0x00426631 | 個人資產表 **賣地產** `fcn_0042608f` | `boardPriceUi(estate)` |
 * | 11 | 0x00426b35 | 個人資產表 **賣道具** `fcn_004267a4` | `boardPriceUi(tool)` |
 * | 12 | 0x00426f57 | 個人資產表 **賣卡片** `fcn_00426c2e` | `boardPriceUi(card)` |
 *
 * ★ 「同一个计算器」的**判据**（本文件钉的就是这三条）：
 *   ① 每一处都交出一个 `choices[i].amount`（通用 `InteractionChoice` 的那一份形状），
 *      **不自己画**任何版式 —— 版式/命中只有一个来源：`dialog.ts` 的 `layoutDialog`
 *      / `hitDialog`（这也就是原版那扇 `fcn_00453544` 的位置）；
 *   ② 同一个 `AmountPage`（只有 `choice` / `value` 两个字段）喂给这五处，
 *      排出来的都是那五颗钮（− + 最大 確定 取消）—— 页对象可以互换；
 *   ③ **不许有第二个数字入口**：原版另有专窗的那几处（見文末）明确不在表里。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LISTING, makeGameState, makePlayer, type GameState, type PendingInteraction } from '@rich4/core';
import { hitDialog, layoutDialog, type AmountPage } from './dialog.ts';
import { interactionUi, type InteractionUi } from './interactions.ts';
import { stockAmountForm } from './amount-form.ts';
import { boardPriceUi } from './board-screen.ts';

// ── 去 exe 取证的那一段（素材不在就整块跳过，与 `hotkeys.test.ts` 同一手法）──
const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
/** 代码段：这个 PE 的节表 VirtualSize 全是 0，故用 SizeOfRawData（同 `tools/disasm.py`）*/
const CODE_VA = 0x401000;
const CODE_OFF = 1024;
const CODE_SIZE = 394240;
const buf = existsSync(EXE) ? readFileSync(EXE) : Buffer.alloc(0);

/**
 * 整份 exe 里 `call 0x453544` 的调用点 —— 与 `python3 tools/disasm.py callers 0x00453544`
 * 同一套算法：x86 的 `call rel32`（0xE8）存的是相对位移，反推 `目标 = 地址 + 5 + rel32`。
 * ⚠️ 这个 PE 的节表 VirtualSize 全是 0（老 Watcom 链接器），VA→文件偏移要用
 * SizeOfRawData（常量与 disasm.py 一致）。
 */
function hitsOfGenericWindow(): number[] {
  const hits: number[] = [];
  for (let off = CODE_OFF; off < CODE_OFF + CODE_SIZE - 5; off++) {
    if (buf[off] !== 0xe8) continue;
    const rel = buf.readInt32LE(off + 1);
    const site = CODE_VA + (off - CODE_OFF);
    if (site + 5 + rel === 0x453544) hits.push(site);
  }
  return hits;
}

/** 与 `dialog.test.ts` 同一手法：只喂版式要用的两样，测**相对关系** */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length * 14 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

function gameState(): GameState {
  return makeGameState({
    currentPlayer: 0,
    players: [
      makePlayer({ index: 0, character: 0, cash: 150_000, moneyInBank: 80_000, loan: 20_000 }),
      makePlayer({ index: 1, character: 1 }),
    ],
  });
}

const state = gameState();

/** 那五颗钮的**命中种类**（与 `dialog.ts` 的 `DialogHit` 一一对应）*/
const GENERIC_HIT_KINDS = ['amountStep', 'amountStep', 'amountMax', 'amountOk', 'amountCancel'];

/** 上市企業落点那份待决交互（照 core 现行实现给，界面只读不算）*/
const buyShares: PendingInteraction = {
  kind: 'buyShares',
  commercialId: 1,
  name: '臺灣人壽',
  stock: 1,
  unitPrice: 40,
  available: 5000,
  max: 1000,
  cash: 150_000,
};

const bank: PendingInteraction = {
  kind: 'bank',
  wealth: 230_000,
  loanCapacity: 100_000,
  specialFinance: { owed: 30_000, available: 70_000 },
};

/** 从一条 `InteractionUi` 里按 op 找那一项「要填数」的 */
function byAction(ui: InteractionUi, op: string): { max: number; fill: (n: number) => unknown } {
  const c = ui.choices.find((x) => x.action.type === 'bank' && x.action.op === op);
  if (c?.amount === undefined) throw new Error(`没有 op=${op} 的填数项`);
  return { max: c.amount.max, fill: c.amount.fill };
}

/**
 * 12 处 exe 调用点 → 本引擎的入口。**这张表就是清单**：exe 里多一处、
 * 本引擎少一条，都得在这里对账。
 */
const ENTRIES: readonly {
  readonly exe: string;
  readonly what: string;
  readonly ui: () => InteractionUi;
}[] = [
  { exe: '0x0041d25b', what: '上市企業 · 認購股份', ui: () => interactionUi(buyShares, state)! },
  { exe: '0x0042af92', what: '股市柜台 · 買進', ui: () => stockAmountForm({ kind: 'buy', stock: 0, max: 1500 }, '台積電') },
  { exe: '0x0042b07e', what: '股市柜台 · 賣出', ui: () => stockAmountForm({ kind: 'sell', stock: 0, max: 320 }, '台積電') },
  { exe: '0x00434671', what: '特別融資 · 借', ui: () => interactionUi(bank, state)! },
  { exe: '0x004346c2', what: '特別融資 · 還', ui: () => interactionUi(bank, state)! },
  { exe: '0x00435245', what: '貸款屏 · 借', ui: () => interactionUi(bank, state)! },
  { exe: '0x00435367', what: '貸款屏 · 還', ui: () => interactionUi(bank, state)! },
  { exe: '0x00425ee9', what: '個人資產表 · 賣股票', ui: () => boardPriceUi(LISTING.stock, 0, 12, 55) },
  { exe: '0x00425f6b', what: '個人資產表 · 賣股票（另一支）', ui: () => boardPriceUi(LISTING.stock, 0, 12, 55) },
  { exe: '0x00426631', what: '個人資產表 · 賣地產', ui: () => boardPriceUi(LISTING.estate, 0, 0, 4000) },
  { exe: '0x00426b35', what: '個人資產表 · 賣道具', ui: () => boardPriceUi(LISTING.tool, 3, 0, 500) },
  { exe: '0x00426f57', what: '個人資產表 · 賣卡片', ui: () => boardPriceUi(LISTING.card, 7, 0, 800) },
];

describe('★ 12 处 `call 0x453544` 一一对应到同一个计算器', () => {
  for (const e of ENTRIES) {
    it(`${e.exe} ${e.what}：交给的是通用填数页，不是自绘的一页`, () => {
      const ui = e.ui();
      const withAmount = ui.choices.filter((c) => c.amount !== undefined);
      expect(withAmount.length).toBeGreaterThanOrEqual(1);
      const a = withAmount[0]!.amount!;
      // 通用 `amount` 那一份形状：label / max / step / fill 四样，一个不多一个不少
      expect(Object.keys(a).sort()).toEqual(['fill', 'label', 'max', 'step']);
      expect(typeof a.label).toBe('string');
      expect(Number.isFinite(a.max)).toBe(true);
      expect(Number.isInteger(a.step)).toBe(true);
      expect(typeof a.fill).toBe('function');
      // ★ 界面壳子本身**只有** title / detail / choices —— 没有自己一份版式
      expect(Object.keys(ui).sort()).toEqual(['choices', 'detail', 'title']);
      for (const c of ui.choices) {
        for (const k of Object.keys(c)) expect(['action', 'label', 'amount']).toContain(k);
      }
    });
  }
});

describe('★ 同一个 `AmountPage` 喂给五处，排出来的都是那五颗钮', () => {
  // ★ **同一个对象**喂给所有入口 —— 能互换才叫同一个计算器
  const page: AmountPage = { choice: 0, value: 7 };

  const five: readonly { what: string; ui: InteractionUi; step: number }[] = [
    { what: '上市企業認購', ui: interactionUi(buyShares, state)!, step: 1 },
    {
      what: '股市柜台買進',
      ui: stockAmountForm({ kind: 'buy', stock: 0, max: 1500 }, '台積電'),
      step: 1,
    },
    {
      what: '股市柜台賣出',
      ui: stockAmountForm({ kind: 'sell', stock: 0, max: 320 }, '台積電'),
      step: 1,
    },
    {
      what: '貸款屏借款',
      ui: (() => {
        const ui = interactionUi(bank, state)!;
        const idx = ui.choices.findIndex(
          (c) => c.action.type === 'bank' && c.action.op === 'borrow',
        );
        return { ...ui, choices: [ui.choices[idx]!] };
      })(),
      step: 1000,
    },
    { what: '公佈欄賣地產', ui: boardPriceUi(LISTING.estate, 0, 0, 4000), step: 1 },
  ];

  for (const f of five) {
    it(`${f.what}：五颗钮与命中完全一致 @source loc_00452c02`, () => {
      const l = layoutDialog(fakeCtx(), f.ui, page);
      expect(l.yesNo).toBe(false);
      // ★ 五颗钮的**种类**一模一样（− / ＋ / 最大 / 確定 / 取消）；
      //   只有步长那一对写着各自的 `step`（金額那几处是 1000，股數/張數是 1）。
      expect(l.buttons.map((b) => b.label)).toEqual([
        `− ${f.step}`,
        `+ ${f.step}`,
        '最大',
        '確定',
        '取消',
      ]);
      // 命中那一份也只差步长
      expect(l.buttons.map((b) => b.hit.kind)).toEqual(GENERIC_HIT_KINDS);
      expect(l.buttons.map((b) => b.hit)).toEqual([
        { kind: 'amountStep', delta: -f.step },
        { kind: 'amountStep', delta: f.step },
        { kind: 'amountMax' },
        { kind: 'amountOk' },
        { kind: 'amountCancel' },
      ]);
      // 绘制与命中同源：每颗钮正中一定命中它自己
      for (const b of l.buttons) {
        expect(
          hitDialog(fakeCtx(), f.ui, page, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2),
        ).toEqual(b.hit);
      }
      // 数字栏画的是「当前值 + 上限」，值就取 `page.value`
      expect(l.lines.join(' ')).toContain('7');
    });
  }
});

describe('★ 上限一律由规则那一侧算好，界面只把它交出去', () => {
  it('股市柜台：買進上限 = `stockCounterBuyMax`，賣出上限 = 持有股數', () => {
    const buy = stockAmountForm({ kind: 'buy', stock: 0, max: 1500 }, '台積電');
    expect(buy.choices[0]?.amount?.max).toBe(1500);
    const sell = stockAmountForm({ kind: 'sell', stock: 0, max: 320 }, '台積電');
    expect(sell.choices[0]?.amount?.max).toBe(320);
  });

  it('上市企業：上限就用 core 给的那个（界面不重算）', () => {
    expect(interactionUi(buyShares, state)!.choices[0]?.amount?.max).toBe(1000);
  });

  it('貸款屏 / 特別融資：上限取 core 的 `loanCapacity` 与 `specialFinance`', () => {
    const ui = interactionUi(bank, state)!;
    expect(byAction(ui, 'borrow').max).toBe(100_000);
    expect(byAction(ui, 'repay').max).toBe(20_000);
    expect(byAction(ui, 'financeBorrow').max).toBe(70_000);
    expect(byAction(ui, 'financeRepay').max).toBe(30_000);
  });
});

describe('★ 原版另有专窗的那几处**没有**被并进来（不许多一个数字入口）', () => {
  it('銀行存款／取款走 ATM 数字键盘，不是通用填数窗', () => {
    // 它们虽然带 `amount`（上限与 fill 要给 ATM 用），但原版 exe 里
    // `_rich4_ui_bank_atm_entry` / `fcn_00436ef8` **从不 call 0x453544** ——
    // 那台机器自己的数字键在 `Panel.mkf` #24 上（`fcn_00436ef8` 的 0x100 分支）。
    const ui = interactionUi(bank, state)!;
    // 存款上限 = 手上現金；取款上限 = 存款（两条都交给 ATM 自己那把数字键盘）
    expect(byAction(ui, 'deposit').max).toBe(150_000);
    expect(byAction(ui, 'withdraw').max).toBe(80_000);
  });

  it.skipIf(!existsSync(EXE))(
    '★ 取证：整份 exe 里 `call 0x453544` **恰好这 12 处**，且与上表逐一对上',
    () => {
      const hits = hitsOfGenericWindow();
      expect(hits).toEqual([
        0x41d25b, 0x425ee9, 0x425f6b, 0x426631, 0x426b35, 0x426f57, 0x42af92, 0x42b07e,
        0x434671, 0x4346c2, 0x435245, 0x435367,
      ]);
      // 上表每一行的 VA 都在这 12 处里 —— exe 多一处、本引擎少一条，这里就要红
      for (const e of ENTRIES) expect(hits).toContain(Number.parseInt(e.exe, 16));
    },
  );

  it.skipIf(!existsSync(EXE))('拍賣的加价 / 樂透的号格 / 小游戏：原版**没有** call 0x453544', () => {
    // `rich4_ui_auction.asm`（七颗加价钮 + PASS/放棄）与 `rich4_small_games.asm`
    // 全文没有 0x453544；`rich4_ui_letou.asm` 也没有（输入是号格）。
    // 所以本文件**不**把它们并进上表 —— 详见 `docs/deviations/Q-UI-7.md`。
    // 这里能做的硬断言：那 12 处调用点一个都不落在它们的代码区间里。
    const ranges: readonly [string, number, number][] = [
      ['樂透投注 fcn_0042f7fc', 0x42f7fc, 0x43010c],
      ['樂透開獎 fcn_0043010c', 0x43010c, 0x431000],
      ['拍賣 fcn_00439f0d..', 0x439f0d, 0x43c000],
      ['小游戏 fcn_00412014..', 0x412014, 0x415000],
    ];
    const hits = hitsOfGenericWindow();
    for (const [what, lo, hi] of ranges) {
      for (const va of hits) {
        expect(va >= lo && va < hi, `${what} 区间里混进了 0x${va.toString(16)}`).toBe(false);
      }
    }
  });
});
