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

import { FACILITY_NAMES, type Action, type GameState, type PendingInteraction } from '@rich4/core';
import { BAIL, BANK, BUTTON, CHARACTERS, FIELD, NOTICE, PLACE, PROMPT, formatOriginal } from '@rich4/data';

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
const decline: InteractionChoice = { label: BUTTON.cancel.text, action: { type: 'declineDecision' } };

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

    // ★ 问句用原版的整段文字（@rich4/data 的 messages.ts，逐字对过 exe）。
    //   我们只补上原版画在别处的「現金」，不改它自己那一句。
    // ★ 不另起标题：原版那一句的第一段本来就是地名，再加个标题栏就重了
    case 'buyLand':
      return {
        title: '',
        detail:
          formatOriginal(PROMPT.buyLand.text, pending.name, pending.price) +
          `\n${FIELD.cash.text} ${money(cash)}`,
        choices: [
          { label: BUTTON.ok.text, action: { type: 'buyLand' } },
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    case 'upgradeLand':
      return {
        title: '',
        detail:
          formatOriginal(PROMPT.upgradeLand.text, pending.name, pending.cost) +
          `\n${FIELD.cash.text} ${money(cash)}`,
        choices: [
          { label: BUTTON.ok.text, action: { type: 'upgradeLand' } },
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    // ★ 買設施与買地共用同一句原文（@source 0x0041a8a5 push 0x4639e1）
    case 'buyFacility':
      return {
        title: '',
        detail:
          formatOriginal(PROMPT.buyLand.text, pending.name, pending.price) +
          `\n${FIELD.cash.text} ${money(cash)}`,
        choices: [
          { label: BUTTON.ok.text, action: { type: 'buyFacility' } },
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    // ★ 原版是一屏五种建筑让你点（0x440aac）；这里先用五颗按钮，画面属 P2-14
    case 'buildFacility':
      return {
        title: pending.name,
        detail: `建築費用 ${money(pending.price)}　${FIELD.cash.text} ${money(cash)}`,
        choices: [
          ...pending.choices.map((t) => ({
            label: FACILITY_NAMES[t] ?? `建築${t}`,
            action: { type: 'buildFacility' as const, facilityType: t },
          })),
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    case 'upgradeFacility':
      return {
        title: '',
        detail:
          formatOriginal(PROMPT.upgradeLand.text, pending.name, pending.cost) +
          `\n${FIELD.cash.text} ${money(cash)}`,
        choices: [
          { label: BUTTON.ok.text, action: { type: 'upgradeFacility' } },
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    // ★ 建設公司：原版是点地图选一处自己的地（0x446ae8）；先用按钮列出可选项，画面属 P2
    case 'chooseBuildTarget':
      return {
        title: pending.name,
        detail: pending.charge ? '選一處加蓋一級，工程費 = 該地地價 × 物價指數' : '董事長免費加蓋一級',
        choices: [
          ...pending.choices.map((id) => ({
            label: id >= 0xfa0 ? `設施 #${id - 0xfa0}` : `土地 #${id - 0x7d0}`,
            action: { type: 'buildTarget' as const, entityId: id },
          })),
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    case 'bank':
      return {
        title: BANK.greeting.text.replace('%s', CHARACTERS[me?.character ?? 0]?.name ?? ''),
        detail:
          `${FIELD.totalAssets.text} ${money(pending.wealth)}　${BANK.creditLeft.text} ${money(pending.loanCapacity)}` +
          `　${FIELD.cash.text} ${money(cash)}　${FIELD.deposit.text} ${money(me?.moneyInBank ?? 0)}` +
          `　${FIELD.loan.text} ${money(me?.loan ?? 0)}`,
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
            label: BANK.applyLoan.text,
            action: { type: 'bank', op: 'borrow', amount: pending.loanCapacity },
            amount: {
              label: '借多少',
              max: pending.loanCapacity,
              step: 1000,
              fill: (n) => ({ type: 'bank', op: 'borrow', amount: n }),
            },
          },
          {
            label: BANK.repayLoan.text,
            action: { type: 'bank', op: 'repay', amount: me?.loan ?? 0 },
            amount: {
              label: '還多少',
              max: me?.loan ?? 0,
              step: 1000,
              fill: (n) => ({ type: 'bank', op: 'repay', amount: n }),
            },
          },
          // ★ 特別融資 —— 只有銀行董事長看得见这两项
          //   （原版那扇窗户里的人，持有銀行股票最多才出现）
          ...(pending.specialFinance === null
            ? []
            : [
                {
                  label: BANK.specialFinance.text,
                  action: { type: 'bank' as const, op: 'financeBorrow' as const, amount: pending.specialFinance.available },
                  amount: {
                    label: `${BANK.creditLeft.text} ${money(pending.specialFinance.available)}`,
                    max: pending.specialFinance.available,
                    step: 1000,
                    fill: (n: number): Action => ({ type: 'bank', op: 'financeBorrow', amount: n }),
                  },
                },
                {
                  label: BANK.returnFunds.text,
                  action: { type: 'bank' as const, op: 'financeRepay' as const, amount: pending.specialFinance.owed },
                  amount: {
                    label: `${BANK.currentCredit.text} ${money(pending.specialFinance.owed)}`,
                    max: pending.specialFinance.owed,
                    step: 1000,
                    fill: (n: number): Action => ({ type: 'bank', op: 'financeRepay', amount: n }),
                  },
                },
              ]),
          { label: BUTTON.exit.text, action: { type: 'declineDecision' } },
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
        title: '',
        detail:
          formatOriginal(PROMPT.buyShares.text, pending.name, pending.unitPrice) +
          `\n尚餘 ${pending.available} 股　${FIELD.cash.text} ${money(pending.cash)}`,
        choices: [
          {
            label: BUTTON.buy.text,
            action: { type: 'buyShares', shares: 1 },
            amount: {
              label: '買幾股',
              max: pending.available,
              step: 1,
              fill: (n) => ({ type: 'buyShares', shares: n }),
            },
          },
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    case 'shop': {
      // ★ 這一屏花的是**點券**，不是錢。
      //   需求方描述的原版长这样：左侧是可买的卡片列表、右下是自己已有的卡片
      //   （点了卖掉换點數）、右上角一个三角钮切到道具商店。
      //   本引擎还没做那一屏的版式，但**买与卖两边都在这里出**，功能是全的。
      const affordableTools = pending.tools.filter(
        (t) => t.price <= pending.points && (t.stock === null || t.stock > 0),
      );
      const affordableCards = pending.cards.filter((c) => c.price <= pending.points);
      return {
        title: PLACE.departmentStore.text,
        detail:
          `${FIELD.points.text} ${pending.points}` +
          `　買得起 ${affordableCards.length} 種卡、${affordableTools.length} 種道具` +
          (pending.owned.cards.length + pending.owned.tools.length > 0
            ? `　手上 ${pending.owned.cards.length} 種卡、${pending.owned.tools.length} 種道具可賣`
            : ''),
        choices: [
          ...affordableTools.map((t) => ({
            label: `${BUTTON.buy.text} ${t.name} ${t.price}點`,
            action: { type: 'shop' as const, op: 'buyTool' as const, id: t.id },
          })),
          ...affordableCards.slice(0, 8).map((c) => ({
            label: `${BUTTON.buy.text} ${c.name} ${c.price}點`,
            action: { type: 'shop' as const, op: 'buyCard' as const, id: c.id },
          })),
          // ★ 卖 —— 退九成點數（places/shop.ts 的 resellValue）
          ...pending.owned.cards.map((c) => ({
            label: `${BUTTON.sell.text} ${c.name} +${c.refund}點`,
            action: { type: 'shop' as const, op: 'sellCard' as const, id: c.id },
          })),
          ...pending.owned.tools.map((t) => ({
            label: `${BUTTON.sell.text} ${t.name}×${t.count} +${t.refund}點`,
            action: { type: 'shop' as const, op: 'sellTool' as const, id: t.id, count: 1 },
          })),
          { label: BUTTON.exit.text, action: { type: 'declineDecision' } },
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
        title: pending.place === 'prison' ? PLACE.prison.text : PLACE.hospital.text,
        detail: `${BAIL.bailPoints.text} ${formatOriginal(BAIL.pointsN.text, pending.points)}`,
        choices: [
          ...pending.candidates.map((c) => ({
            label:
              formatOriginal(BAIL.bailWho.text, c.name) +
              `（${formatOriginal(BAIL.pointsN.text, c.cost)}）` +
              (c.affordable ? '' : `　${NOTICE.cashShort.text}`),
            action: { type: 'bail' as const, slot: c.slot },
          })),
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
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
