/*
 * 待决交互 → 界面：**填数一定走通用的那一扇窗**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-15 报的第 2 条：「这里买股票应该调用通用的那个计算器，
 * 而不是自己写个模块」。原版踩到上市企業是
 * `訊息框 fcn_00440ba8`（VA 0x0041d24d）→ `通用填数窗 fcn_00453544`
 * （VA 0x0041d25b）→ `_rich4_buy_stock(…, 0)`（VA 0x0041d281）。
 *
 * 本引擎的「通用填数窗」就是 `dialog.ts` 的 `AmountPage` + `drawDialog` /
 * `hitDialog` / `layoutDialog` 那一套（銀行、公佈欄、股市柜台共用同一套）。
 * 本文件钉住买卖股那条**确实**接在它上面，而且上限是 core 给的、界面不算。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type GameState, type PendingInteraction } from '@rich4/core';
import { hitDialog, layoutDialog } from './dialog.ts';
import { interactionUi, type InteractionUi } from './interactions.ts';
import { stockCounterBuyMax } from './stock-screen.ts';

/**
 * 一个够用的假 2D 上下文 —— 与 `dialog.test.ts` 同一手法（只喂版式）。
 * 宽度按「一个字 14 像素」估，测的是**相对关系**，不依赖环境字体。
 */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length * 14 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

/** 一个「踩到上市企業」的待决交互（数值照 core 现行实现给，界面只读不算） */
const MAX_SHARES = 1000;
const pending: PendingInteraction = {
  kind: 'buyShares',
  commercialId: 1,
  name: '臺灣人壽',
  stock: 1,
  unitPrice: 40,
  available: 5000,
  // 上限 = min(1000, 現金 150000 ÷ 40, 5000) —— core 的 `shareWindowLimit`
  max: MAX_SHARES,
  cash: 150_000,
};

const state = (): GameState =>
  makeGameState({
    currentPlayer: 0,
    players: [
      makePlayer({ index: 0, character: 0, cash: 150_000, moneyInBank: 0 }),
      makePlayer({ index: 1, character: 1 }),
    ],
  });

function uiOf(p: PendingInteraction = pending): InteractionUi {
  const ui = interactionUi(p, state());
  if (ui === null) throw new Error('这一种待决交互应当有界面');
  return ui;
}

describe('★ 買股份：訊息框 → 通用填数窗', () => {
  it('★ 第一步是原版的 YES/NO 訊息框（`fcn_00440ba8`）', () => {
    const ui = uiOf();
    // 题面是原版那一整句（`@rich4/data` 的 PROMPT.buyShares，逐字对过 exe）
    expect(ui.detail).toContain('臺灣人壽');
    expect(ui.detail).toContain('是否認購股份？');
    // 两个选项 → `dialog.ts` 判定走原版 YES/NO 控件（不是我们排的按钮列）
    const l = layoutDialog(fakeCtx(), ui, null);
    expect(l.yesNo).toBe(true);
    expect(l.buttons.map((b) => b.label)).toEqual(['YES', 'NO']);
  });

  it('★ 「買」带的是一个 `amount` —— 即通用填数页，而不是这条交互自画的窗', () => {
    const ui = uiOf();
    const buy = ui.choices[0];
    expect(buy?.amount).toBeDefined();
    expect(buy?.amount?.step).toBe(1);
    // ★ 上限来自 core（`pending.max`），界面**不许**自己再算一遍（C-ARC-2）
    expect(buy?.amount?.max).toBe(MAX_SHARES);
    // 填出来的 action 就是 core 认的那一条
    expect(buy?.amount?.fill(7)).toEqual({ type: 'buyShares', shares: 7 });
    expect(ui.choices[1]?.action).toEqual({ type: 'declineDecision' });
  });

  it('★★ 开了填数页后：走**原版数字键盘窗**（B-5(i)/B-6(i)）', () => {
    const ui = uiOf();
    const page = { choice: 0, value: 1000 };
    const l = layoutDialog(fakeCtx(), ui, page);
    // 填数页不是 YES/NO，而是原版那扇窗的命中区
    expect(l.yesNo).toBe(false);
    expect(l.amountWindow).toBe(true);
    // 键盘 14 颗（2..0xf）+ 一颗自加的「取消」；金额栏两颗光标故意不接
    expect(l.buttons).toHaveLength(15);
    expect(l.buttons.filter((b) => b.hit.kind === 'amountSlot')).toHaveLength(14);
    expect(l.buttons[l.buttons.length - 1]!.hit).toEqual({ kind: 'amountCancel' });
    // 每颗按钮的正中一定命中它自己（绘制与命中同源）
    for (const b of l.buttons) {
      expect(hitDialog(fakeCtx(), ui, page, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2)).toEqual(
        b.hit,
      );
    }
    // 數字欄画的是「当前值 + 上限」——上限就是 core 给的那个
    expect(l.lines.join(' ')).toContain('1,000');
    expect(l.lines.join(' ')).toContain('（上限 1,000）');
  });

  it('★ 同一条路上没有第二个自绘的填数窗：整条 `pending` 只给出 `amount` 这一种入口', () => {
    const ui = uiOf();
    // 「買」只开一页（`amount`），不是先派 action 再自己弹窗
    expect(ui.choices.filter((c) => c.amount !== undefined)).toHaveLength(1);
    // 且它两边都不是「直接成交」的按钮 —— 成交那一手只从填数页的「確定」出去
    expect(ui.choices[0]?.action).toEqual({ type: 'buyShares', shares: 1 });
  });
});

describe('★ 两条买股的路共用同一个「计算器」', () => {
  it('★ 股市柜台的上限也在模块里算好（@source loc_0042af30），界面只把它交给同一扇窗', () => {
    // 存款 100000 ÷ 股價 50 = 2000 股；流通量只放 1500 ⇒ 夹到 1500
    expect(stockCounterBuyMax(100_000, 50, 1500)).toBe(1500);
    // 存款买不起那么多 ⇒ 由存款决定
    expect(stockCounterBuyMax(1000, 50, 1500)).toBe(20);
    // 股价 0（未开盘/脏数据）：不开窗，不是 Infinity
    expect(stockCounterBuyMax(100_000, 0, 1500)).toBe(0);
  });
});

// ============================================================
//  ★ Q-BANK-1a：銀行那扇窗把**四种 op** 都铺出来了
//    （`main.ts` 的 `openLoanAmount(op)` 就是按 `action.op` 找回那一项的
//     —— 少了任何一项，贷款屏／特別融資子对话框点了就什么都不发生）
// ============================================================

describe('★ 銀行對話：四種 op 都在 choices 裡', () => {
  /** 董事長（`specialFinance != null`）那一刻的待決交互 */
  const chairPending: PendingInteraction = {
    kind: 'bank',
    wealth: 500_000,
    loanCapacity: 400_000,
    specialFinance: { owed: 30_000, available: 90_000 },
  };

  const chairState = (): GameState =>
    makeGameState({
      currentPlayer: 0,
      players: [makePlayer({ index: 0, character: 0, cash: 50_000, moneyInBank: 200_000 })],
      pending: chairPending,
    });

  const ui = (): InteractionUi => interactionUi(chairPending, chairState())!;

  it('★ `specialFinance != null` 時四種 op 都在（borrow / repay / financeBorrow / financeRepay）', () => {
    const ops = ui()
      .choices.filter((c) => c.action.type === 'bank')
      .map((c) => (c.action.type === 'bank' ? c.action.op : null));
    expect(ops).toContain('borrow');
    expect(ops).toContain('repay');
    expect(ops).toContain('financeBorrow');
    expect(ops).toContain('financeRepay');
  });

  it('★ 每一种都带 `amount`（`openLoanAmount` 找不到就静默不开窗）', () => {
    for (const op of ['borrow', 'repay', 'financeBorrow', 'financeRepay'] as const) {
      const c = ui().choices.find((x) => x.action.type === 'bank' && x.action.op === op);
      expect(c, op).toBeDefined();
      expect(c!.amount, op).toBeDefined();
      // `fill` 要给出**同一个 op** 的 action（否则填完数会走错账）
      const filled = c!.amount!.fill(1000);
      expect(filled.type).toBe('bank');
      if (filled.type === 'bank') expect(filled.op).toBe(op);
    }
  });

  it('★ 兩筆特別融資的上限來自 core：週轉 = 可用額度、還款 = 已融資金額', () => {
    const borrow = ui().choices.find((x) => x.action.type === 'bank' && x.action.op === 'financeBorrow');
    const repay = ui().choices.find((x) => x.action.type === 'bank' && x.action.op === 'financeRepay');
    expect(borrow!.amount!.max).toBe(90_000); // available = limit − owed
    expect(repay!.amount!.max).toBe(30_000); // owed
  });

  it('★ 不是董事長（`specialFinance == null`）時那兩項**不出現**', () => {
    const s = makeGameState({
      currentPlayer: 0,
      players: [makePlayer({ index: 0, character: 0 })],
      pending: { kind: 'bank', wealth: 500_000, loanCapacity: 400_000, specialFinance: null },
    });
    const ops = interactionUi(
      { kind: 'bank', wealth: 500_000, loanCapacity: 400_000, specialFinance: null },
      s,
    )!
      .choices.filter((c) => c.action.type === 'bank')
      .map((c) => (c.action.type === 'bank' ? c.action.op : null));
    expect(ops).not.toContain('financeBorrow');
    expect(ops).not.toContain('financeRepay');
  });
});

describe('★★ 第十四份（D-008 收口）：收費那一段真人的被动卡', () => {
  const tail = { route: { path: 'rent' as const, landId: 1 }, payer: 0, who: 0, toll: 3000, feeName: '過路費', freeDone: false };
  const st = makeGameState({ players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })] });

  it('免費卡：原版那一句（`0x465388`），YES / NO 各一个 action', () => {
    const ui = interactionUi({ kind: 'freeCard', name: '沙隆巴斯', tail }, st)!;
    expect(ui.detail).toBe('沙隆巴斯\n\n是否使用免費卡？');
    expect(ui.choices.map((c) => c.action)).toEqual([
      { type: 'answerFreeCard', use: true },
      { type: 'answerFreeCard', use: false },
    ]);
  });

  it('嫁禍卡：恰好一位 ⇒ YES/NO「是否嫁禍給%s？」；两位以上 ⇒ 不走对话框（选人窗）', () => {
    const one = interactionUi({ kind: 'scapegoat', candidates: [1], names: ['忍太郎'], tail }, st)!;
    expect(one.detail).toBe('是否嫁禍給忍太郎？');
    expect(one.choices.map((c) => c.action)).toEqual([
      { type: 'answerScapegoat', target: 1 },
      { type: 'answerScapegoat', target: -1 },
    ]);
    expect(interactionUi({ kind: 'scapegoat', candidates: [1, 2], names: ['a', 'b'], tail }, st)).toBeNull();
  });
});

describe('★ 20260925-153539948：建設公司选地窗是**地图上点**，不是清单', () => {
  const st = makeGameState({ players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })] });
  const pend: PendingInteraction = {
    kind: 'chooseBuildTarget',
    commercialId: 1,
    name: '建設公司',
    choices: [0x7d0 + 1, 0xfa0 + 1],
    charge: true,
  };

  it('★★ 通用对话框**不留壳子** —— 这一屏由 `picking.ts` 的 `{ kind: buildTarget }` 接管', () => {
    // @source `0x0041aa6a` / `0x0041acff push 0x2090086 / call 0x446ae8`：原版开的是
    //   盖在棋盘上的窗口（窗口过程 `0x00445e4d`），**没有**任何一列候选清单。
    //   先前这里是一排「土地 #N / 設施 #N」按钮 —— 需求方回报的正是这一处。
    expect(interactionUi(pend, st)).toBeNull();
  });
});
