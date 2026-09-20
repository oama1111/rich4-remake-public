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

import { researchTool, type Action, type GameState, type PendingInteraction } from '@rich4/core';
import { BAIL, BANK, BUTTON, CHARACTERS, FIELD, PLACE, PROMPT, TOOLS, formatOriginal } from '@rich4/data';

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
  amount?: {
    label: string;
    max: number;
    step: number;
    fill: (n: number) => Action;
    /**
     * 开窗时先填几股 —— **不给就是 0**。
     *
     * ★ 上市企業認購那一支原版开窗时把上限**当第一个实参**压进去
     *   （`@source 0x0041d25a push esi / call 0x453544`，`esi` 就是
     *   上面那三道夹出来的 `min(1000, 現金÷每股, 企業餘量)`）——
     *   也就是**一开窗就是满额**，直接按 Enter 就买满（试玩 4：「MAX 按钮
     *   应该也有功能（股市中一键拉满）」）。股市柜台那两支没有这个实参，
     *   所以只有這一处给 `initial`。
     */
    initial?: number;
  };
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

    // ★ `buildFacility`（落点在等级 0 的設施上，要选建哪一种）**不在这里** ——
    //   原版那是一扇整屏的浮窗（`fcn_00440aac`，五种建筑让你点），本引擎由
    //   `facility-picker.ts` 的 `facilityPickerScreen` 接管（`active()` 认这个
    //   pending），所以这里返回 null、连通用对话框都不画。先前这里放的是
    //   「五颗按钮」的临时画面（Q-TOOL-4）。

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

    // ★ 研究所面板（0x44101d）：原版是一屏項目让你点（0x4402d7）；先用按钮，画面属 P2-14 / T-040
    case 'research':
      return {
        title: pending.name,
        detail: `研究所 ${pending.level} 級　選一個研發項目（固定 5 天）`,
        choices: [
          ...pending.choices.map((project) => ({
            label: TOOLS.find((t) => t.id === researchTool(project))?.name ?? `項目 ${project}`,
            action: { type: 'research' as const, facilityId: pending.facilityId, project },
          })),
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
      // ★ 一次落点只买一注：选中之后 pending 就收了（原版买完投注屏自行关闭）。
      // 号码多，全铺出来会淹掉面板；给前 12 个 + 一个「離開」。
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

    // ★ 原版这条路是 **訊息框 → 通用填数窗 → dispatch**：
    //   `fcn_00440ba8`（訊息框，VA 0x0041d24d）→ `fcn_00453544(上限)`
    //   （填数窗，VA 0x0041d25b）→ `_rich4_buy_stock(…, 0)`（VA 0x0041d281）。
    //
    //   本引擎的对应物就是这里：两个选项 → `dialog.ts` 的原版 YES/NO 訊息框；
    //   选了「買」→ `main.ts` 的 `onDialogHit` 开*同一个*通用填数页
    //   `AmountPage`（与銀行、公佈欄、股市柜台那条**同一套** `drawDialog` /
    //   `hitDialog`），確定后把 `fill(n)` 出来的 action 交回去。
    //
    //   ⚠️ 上限 `max` 是 core 按 `fcn_0041d1a9` 算好的
    //   （`min(1000, 現金 ÷ 每股售價, 企業餘量)`），**这里不许再算一遍**。
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
              max: pending.max,
              // 原版开窗即满额（见 `amount.initial` 的 @source）—— 按 Enter 就买满
              initial: pending.max,
              step: 1,
              fill: (n) => ({ type: 'buyShares', shares: n }),
            },
          },
          { label: BUTTON.cancel.text, action: { type: 'declineDecision' } },
        ],
      };

    case 'shop': {
      // ★ 這一屏花的是**點數**，不是錢。
      //
      // ★★ **这一屏不走通用对话框**（U-2 / P2-8）：原版是整屏一屏，左侧是可买的
      //   卡片／道具清单、右下是自己的 5×3 格（点了卖掉换點數）、右上角三角钮切页、
      //   右下 EXIT 走人；位置与命中都在 `shop-screen.ts`，`main.ts` 的
      //   `drawShopStage` / `hitShop` 直接接管鼠标。
      //
      //   这里留一份**最小**的交互壳，只为两件事：
      //   ① 别的路径（AI、联机广播）问到 `interactionUi` 时有个东西返回；
      //   ② 万一商店屏没画出来，至少还剩一个「離開」能把这局继续下去。
      //   买与卖**不在这里出**（否则同一个动作会有两条入口）。
      return {
        title: PLACE.departmentStore.text,
        detail: `${FIELD.points.text} ${pending.points}`,
        choices: [{ label: BUTTON.exit.text, action: { type: 'declineDecision' } }],
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
      // ★★ **这一屏不走通用对话框**（T-038）：原版是整屏一屏 —— 砖墙/病房底图、
      //   八个窗格各摆一张脸、右下（医院是左下）一块點券底板，点有人的窗格就保釋；
      //   位置与命中都在 `bail-screen.ts`，`main.ts` 的 `drawBailStage` / `hitBailSlot`
      //   直接接管鼠标。
      //
      //   这里留一份**最小**的交互壳，只为两件事：
      //   ① 别的路径问到 `interactionUi` 时有个东西返回；
      //   ② 万一那一屏没画出来，至少还剩一个「離開」能把这局继续下去。
      //   保釋本身**不在这里出**（否则同一个动作会有两条入口）。
      return {
        title: pending.place === 'prison' ? PLACE.prison.text : PLACE.hospital.text,
        detail: `${BAIL.bailPoints.text} ${formatOriginal(BAIL.pointsN.text, pending.points)}`,
        choices: [{ label: BUTTON.cancel.text, action: { type: 'declineDecision' } }],
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
