/*
 * 待决交互的界面
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**一条规则都不含**。它读 `GameState.pending`——
 *   那是 core 算好的「现在要你做什么决定，以及做这个决定需要知道什么」——
 *   把它翻译成一组控件，再把玩家的答复原样变成 action 交回去。
 *
 * ★ C-ARC-4：这里产出的 action 与 AI 产出的、与将来从网络收到的
 *   **是同一种东西**。引擎分不出来源，也不需要分。
 *
 * ⚠️ 能不能买、买得起几股、哪些号码还没卖 —— 一律**不在这里算**。
 *   `pending` 里已经带齐了（`price` / `available` / `loanCapacity` …），
 *   UI 自己再算一遍就等于把规则抄了第二份，迟早两边对不上。
 */

import type { Action, GameState, PendingInteraction } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

export interface InteractionUi {
  /** 面板标题，例如「銀行」 */
  title: string;
  /** 一句话说明当前局面 */
  detail: string;
  /** 可选的操作 */
  choices: InteractionChoice[];
}

export interface InteractionChoice {
  label: string;
  action: Action;
  /** 需要玩家先填一个数（金额、股数…）；控件用它决定要不要给输入框 */
  amount?: { label: string; max: number; step: number; fill: (n: number) => Action };
}

/** 放弃 —— 任何待决交互都接受它 */
const decline: InteractionChoice = { label: '不了', action: { type: 'declineDecision' } };

/**
 * 把一个待决交互翻译成界面。
 *
 * 返回 `null` 表示这一种不需要玩家动手（例如 `none`）。
 */
export function interactionUi(
  pending: PendingInteraction,
  state: GameState,
): InteractionUi | null {
  const me = state.players[state.currentPlayer];
  const cash = me?.cash ?? 0;

  switch (pending.kind) {
    case 'none':
      return null;

    case 'buyLand':
      return {
        title: '買地',
        detail: `地價 ${money(pending.price)}　現金 ${money(cash)}`,
        choices: [{ label: '買下', action: { type: 'buyLand' } }, decline],
      };

    case 'upgradeLand':
      return {
        title: '蓋房',
        detail: `造價 ${money(pending.cost)}　現金 ${money(cash)}`,
        choices: [{ label: '蓋', action: { type: 'upgradeLand' } }, decline],
      };

    case 'bank':
      return {
        title: '銀行',
        detail:
          `身家 ${money(pending.wealth)}　可貸 ${money(pending.loanCapacity)}` +
          `　現金 ${money(cash)}　存款 ${money(me?.moneyInBank ?? 0)}　欠款 ${money(me?.loan ?? 0)}`,
        choices: [
          {
            label: '存款',
            action: { type: 'bank', op: 'deposit', amount: cash },
            amount: {
              label: '存多少',
              max: cash,
              step: 1000,
              fill: (n) => ({ type: 'bank', op: 'deposit', amount: n }),
            },
          },
          {
            label: '取款',
            action: { type: 'bank', op: 'withdraw', amount: me?.moneyInBank ?? 0 },
            amount: {
              label: '取多少',
              max: me?.moneyInBank ?? 0,
              step: 1000,
              fill: (n) => ({ type: 'bank', op: 'withdraw', amount: n }),
            },
          },
          {
            label: '借款',
            action: { type: 'bank', op: 'borrow', amount: pending.loanCapacity },
            amount: {
              label: '借多少',
              max: pending.loanCapacity,
              step: 1000,
              fill: (n) => ({ type: 'bank', op: 'borrow', amount: n }),
            },
          },
          {
            label: '還款',
            action: { type: 'bank', op: 'repay', amount: me?.loan ?? 0 },
            amount: {
              label: '還多少',
              max: me?.loan ?? 0,
              step: 1000,
              fill: (n) => ({ type: 'bank', op: 'repay', amount: n }),
            },
          },
          { label: '離開', action: { type: 'declineDecision' } },
        ],
      };

    case 'lottery': {
      // 号码多，全铺出来会淹掉面板；给前 12 个 + 一个「随手买一个」
      const shown = pending.available.slice(0, 12);
      return {
        title: '樂透',
        detail: `每注 ${money(pending.price)}　手上 ${pending.owned} 注　還剩 ${pending.available.length} 個號碼`,
        choices: [
          ...shown.map((n) => ({
            label: String(n + 1),
            action: { type: 'lottery' as const, number: n },
          })),
          { label: '離開', action: { type: 'declineDecision' } },
        ],
      };
    }

    case 'auction': {
      const name = (i: number): string => CHARACTERS[state.players[i]?.character ?? 0]?.name ?? `玩家${i + 1}`;
      return {
        title: '拍賣',
        detail: `底價 ${money(pending.basePrice)}　可競標：${pending.bidders.map(name).join('、')}`,
        choices: [
          ...pending.bidders.map((i) => ({
            label: `${name(i)} 以底價得標`,
            action: { type: 'auction' as const, winner: i, price: pending.basePrice },
            amount: {
              label: `${name(i)} 出價`,
              max: state.players[i]?.cash ?? 0,
              step: 1000,
              fill: (n: number): Action => ({ type: 'auction', winner: i, price: n }),
            },
          })),
          // ★ 流拍不是「什么都没发生」：原地主照样失去这块地
          { label: '流標', action: { type: 'auction', winner: -1, price: 0 } },
        ],
      };
    }

    case 'buyShares':
      return {
        title: `${pending.name}　入股`,
        detail:
          `每股 ${money(pending.unitPrice)}　尚餘 ${pending.available} 股　現金 ${money(pending.cash)}`,
        choices: [
          {
            label: '買入',
            action: { type: 'buyShares', shares: 1 },
            amount: {
              label: '買幾股',
              max: pending.available,
              step: 1,
              fill: (n) => ({ type: 'buyShares', shares: n }),
            },
          },
          { label: '不入股', action: { type: 'declineDecision' } },
        ],
      };

    case 'shop': {
      // ★ 百貨公司花的是**點券**，不是錢
      const affordableTools = pending.tools.filter(
        (t) => t.price <= pending.points && (t.stock === null || t.stock > 0),
      );
      const affordableCards = pending.cards.filter((c) => c.price <= pending.points);
      return {
        title: '百貨公司',
        detail: `點券 ${pending.points}　（買得起 ${affordableCards.length} 種卡、${affordableTools.length} 種道具）`,
        choices: [
          ...affordableTools.map((t) => ({
            label: `${t.name} ${t.price}點`,
            action: { type: 'shop' as const, op: 'buyTool' as const, id: t.id },
          })),
          ...affordableCards.slice(0, 10).map((c) => ({
            label: `${c.name} ${c.price}點`,
            action: { type: 'shop' as const, op: 'buyCard' as const, id: c.id },
          })),
          { label: '離開', action: { type: 'declineDecision' } },
        ],
      };
    }

    case 'minigame':
      return {
        title: pending.name,
        detail: `玩法尚未實作 —— 按「不玩」走原版的那條出口（${50}..${69} 點券）`,
        choices: [
          {
            label: '不玩，隨便給點',
            action: { type: 'minigame', score: null },
          },
          {
            label: '報成績',
            action: { type: 'minigame', score: 0 },
            amount: {
              label: '得分',
              max: pending.maxScore,
              step: 1,
              fill: (n) => ({ type: 'minigame', score: n }),
            },
          },
        ],
      };

    case 'bail':
      return {
        title: pending.place === 'prison' ? '探監' : '探病',
        detail: `點券 ${pending.points}`,
        choices: [
          ...pending.candidates.map((c) => ({
            label: `保釋 ${c.name}（${c.cost} 點）${c.affordable ? '' : '　點券不足'}`,
            action: { type: 'bail' as const, slot: c.slot },
          })),
          { label: '看看就走', action: { type: 'declineDecision' } },
        ],
      };

    case 'unimplemented':
      return {
        title: pending.place,
        detail: '这里的规则还没做 —— 引擎明确报出来，而不是静默跳过',
        choices: [decline],
      };

    default:
      return null;
  }
}
