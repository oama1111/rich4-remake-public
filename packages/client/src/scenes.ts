/*
 * 場所的全屏背景
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的每个场所都是**整屏一张画**，不是棋盘上弹个框。这些画都在
 *   `Panel.mkf` 里，每个占一个资源，图 0 是底、后面几十张是这一屏的部件：
 *
 * | 资源 | 图数 | 是哪一屏 | 认法 |
 * |---|---|---|---|
 * | 9  | 25 | 股市 | 整屏的行情表格 |
 * | 10 | 38 | 魔法屋（房间）| 女巫的屋子：坩埚、骷髅、药瓶、魔法书 |
 * | 12 | 10 | 樂透投注站 | 吧台上一整面号码牌 |
 * | 15 | 47 | 樂透開獎 | 蓝幕舞台 + 摇奖球，标题写着「大富翁樂透開獎」 |
 * | 18 | 35 | 魔法屋（法陣）| 六芒星外圈 12 个图标，正是 12 种魔法；下方写着 MAGIC |
 * | 23 | 24 | 銀行 | 柜台与行员 |
 * | 25 | 83 | 百貨公司 | 「大富翁4」花纹壁纸 + 蝴蝶结 |
 * | 26 | 184 | 拍賣 | 讲台与画作；那对 PASS / +1000 / +5000 药丸钮就在这个资源里 |
 * | 63 | 1 | 監獄 | 八间牢房 |
 * | 65 | 10 | 醫院 | 走廊挂着「內科」，八张吊点滴的病床 |
 * | 80 | 10 | 企鵝挖寶 | 冰面上的企鹅与计分条 |
 * | 91 | 1 | 七彩氣球 | 游乐园：摩天轮、彩旗，下方计时与计分条 |
 *
 * ⚠️ 本模块**只铺底图**。每一屏自己的控件（銀行的存取款按钮、股市的行情表、
 *   百貨的货架…）都还没做，上面盖的仍是通用对话框。这样至少「进了哪个场所」
 *   一眼看得出来，而不是所有场所长一个样。记在 known-deviations 的 Q-SCENE-1。
 */

import type { PendingInteraction } from '@rich4/core';
import { SPECIAL_KIND } from '@rich4/core';

/** 場所背景所在的档案 —— 全在 Panel.mkf */
export const SCENE_ARCHIVE = 'Panel.mkf' as const;

export const SCENE = {
  stockMarket: 9,
  magicHouseRoom: 10,
  lotteryCounter: 12,
  lotteryDraw: 15,
  magicHouseCircle: 18,
  bank: 23,
  departmentStore: 25,
  auction: 26,
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
    case 'shop':
      return SCENE.departmentStore;
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
