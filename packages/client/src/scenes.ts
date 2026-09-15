/*
 * 場所的全屏背景
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的每个场所都是**整屏一张画**，不是棋盘上弹个框。这些画都在
 *   `Panel.mkf` 里，每个占一个资源，图 0 是底、后面几十张是这一屏的部件：
 *
 * | 资源 | 图数 | 是哪一屏 |
 * |---|---|---|
 * | 9  | 25 | **個人資產表**（右下角那块是自己持有的卡片／道具欄）|
 * | 10 | 38 | **卡片商店／道具商店** —— ⚠️ **不走本模块**：它要用这个资源里的十几张图叠出来（底图／老板娘／气泡／货架栏／两个钮／點數底板），由 `shop-screen.ts` 整屏接管 |
 * | 12 | 10 | 樂透投注站（畫面上有隻貓女，還有獎池金額；点了在下面选号码）|
 * | 15 | 47 | 樂透開獎（中间的奖球会**模拟真实滚动摇晃**）|
 * | 18 | 35 | 魔法屋（中间有个女巫；鼠标划过外圈的选项会高亮 + 中间出文字提示 + 提示音）|
 * | 23 | 24 | 銀行（下面那张白卡左半是申請貸款、右半是償還貸款；**窗户里的人只有当玩家是银行董事长（持有銀行股票最多）时才看得见**，点了进特別融資）|
 * | 25 | 83 | **每月結算**的背景 |
 * | 26 | 184 | 拍賣（左侧有人挥锤，右侧是当局玩家的 Q 版小人、资产金额与加价钮）|
 * | 63 | 1 | 監獄 |
 * | 65 | 10 | 醫院 |
 * | 73 | 20 | **公佈欄** —— 玩家或 NPC 把自己的卡片／道具／地產挂上去出售的地方 |
 * | 75 | 29 | **股市** |
 * | 76 | 1 | **每個人的持股情況彙總** |
 * | 80 | 10 | 企鵝挖寶 |
 * | 91 | 1 | 七彩氣球 |
 * | help #0 | 12 | **輔助說明** —— 点右上角红色问号弹出的游戏内百科 |
 *
 * ⚠️ 上面这张表里，9 / 10 / 25 / 75 / 76 / 73 六项**先前认错了**（当成
 *   股市／魔法屋／百貨公司／資產清單／清單表格／公佈欄）。现在这一版来自
 *   **玩过原版的人的口述**，见 `docs/original-ui.md` —— 那是与反汇编并列的
 *   一类证据，不是我从图上猜的。
 *
 * ⚠️ 本模块**只铺底图**。每一屏自己的控件都还没做（Q-SCENE-1）；按需求方的
 *   意思，这些控件要**逐屏去代码里找规则**，不能套一套通用的。
 */

import type { PendingInteraction } from '@rich4/core';
import { SPECIAL_KIND } from '@rich4/core';

/** 場所背景所在的档案 —— 全在 Panel.mkf */
export const SCENE_ARCHIVE = 'Panel.mkf' as const;

export const SCENE = {
  /** 個人資產表（含自己的卡片／道具欄）*/
  assets: 9,
  lotteryCounter: 12,
  lotteryDraw: 15,
  magicHouse: 18,
  bank: 23,
  /** 每月結算 */
  monthlySettle: 25,
  auction: 26,
  /** 公佈欄：玩家／NPC 挂卖卡片、道具、地產 */
  noticeBoard: 73,
  stockMarket: 75,
  /** 每個人的持股彙總 */
  shareholdings: 76,
  prison: 63,
  hospital: 65,
  penguinDig: 80,
  balloons: 91,
} as const;

/** 三个小游戏各自的背景；没认出来的返回 null */
function minigameScene(game: number): number | null {
  switch (game) {
    case SPECIAL_KIND.PENGUIN_DIG:
      return SCENE.penguinDig;
    case SPECIAL_KIND.BALLOON:
      return SCENE.balloons;
    // ⚠️ 喜從天降（GIFT_FROM_SKY）那一屏没认出来 —— 没找到对得上的整屏图
    default:
      return null;
  }
}

/**
 * 这个待决交互该配哪张场所底图；没有就返回 `null`（照旧在棋盘上弹框）。
 */
export function sceneFor(pending: PendingInteraction | null): number | null {
  if (pending === null) return null;
  switch (pending.kind) {
    case 'bank':
      return SCENE.bank;
    case 'lottery':
      return SCENE.lotteryCounter;
    // ★ 棋盤上那格叫「百貨公司」，但屏其实是**卡片商店／道具商店** ——
    //   它不在这条「一张底图 + 通用对话框」的路上：那一屏要用 `Panel.mkf` 资源 10
    //   的十几张图叠出来，由 `shop-screen.ts` 整屏接管（见 `main.ts` 的 `drawShopStage`）。
    case 'auction':
      return SCENE.auction;
    case 'bail':
      return pending.place === 'prison' ? SCENE.prison : SCENE.hospital;
    case 'minigame':
      return minigameScene(pending.game);
    default:
      return null;
  }
}
