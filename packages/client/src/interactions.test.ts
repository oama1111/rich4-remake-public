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

  it('★ 开了填数页后：版式与命中都走 dialog.ts 那一套（−/＋/最大/確定/取消）', () => {
    const ui = uiOf();
    const page = { choice: 0, value: 1000 };
    const l = layoutDialog(fakeCtx(), ui, page);
    // 填数页不是 YES/NO，而是通用那五颗
    expect(l.yesNo).toBe(false);
    expect(l.buttons.map((b) => b.label)).toEqual(['− 1', '+ 1', '最大', '確定', '取消']);
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
