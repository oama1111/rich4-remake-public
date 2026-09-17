/*
 * 特殊格子结算（17 路跳表）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_player_core_actions.asm
 *   `_rich4_handle_player_land_on_node` 的跳表 `ref_004197e9` @ VA 0x004197e9
 *   `jmp dword [ebx*4 + 0x4197e9]`，其中 `ebx = node.flags & 0xff`
 *
 * 跳表共 17 项（0..16），索引即 `specialKind`——这与先前从地图数据
 * 统计得到的特殊格类型枚举完全吻合（双向印证）。
 */

import { SPECIAL_KIND } from '../loaders/map.ts';
import { WatcomRng, drawRandomCard } from '../rng/watcom.ts';
import type { Player } from '../state/types.ts';

/**
 * 每个特殊格对应的原版处理函数（= 状态机的分派名）。
 *
 * ★ 2026-09-17：**16 种全部已接** —— 先前那些 ⏳（「待子系统」）是分阶段落地时
 *   留下的记号；随新聞/命運事件表、保釋窗、小游戏、樂透、銀行、百貨、魔法屋
 *   陆续接上，现在没有待办项。落点跳表的逐条 VA 见 `docs/known-deviations.md`
 *   的 Q-SPECIAL 一节。
 *
 * ⚠️ 本文件底下的 `settleSpecialSquare` 只算**无状态的那几支**
 *   （公園/得点/卡片）；新聞/命運/監獄/醫院/樂透/銀行/百貨/魔法屋/小游戏
 *   要动状态与交互，一律走 `state/reduce.ts`（那里 `unimplemented` 才会出现）。
 */
export const SPECIAL_HANDLERS = {
  /** 0：非特殊格，走地产分支 ✅ */
  [SPECIAL_KIND.NONE]: 'land',
  /** 1 公園：**落地无任何效果**（跳表直接指向结束标号）✅ */
  [SPECIAL_KIND.PARK]: 'noop',
  /** 2 新聞 @source fcn_0044b6df（docs/special_place.txt 记为 news_events）✅ 36/36 效果 */
  [SPECIAL_KIND.NEWS]: 'news',
  /** 3 命運 @source fcn_0044db81（docs 记为 fortune_events）✅ 37/37 效果 */
  [SPECIAL_KIND.FORTUNE]: 'fortune',
  /** 4 監獄 @source _rich4_ui_prison_entry ✅ 保釋窗 `rules/visit.ts` */
  [SPECIAL_KIND.PRISON]: 'prison',
  /** 5 醫院 @source _rich4_ui_hospital_entry ✅ 保釋窗 `rules/visit.ts` */
  [SPECIAL_KIND.HOSPITAL]: 'hospital',
  /** 6 企鵝挖寶 @source _rich4_ui_game_penguin_treasure ✅ `places/minigame.ts` + `client/minigame-screen.ts` */
  [SPECIAL_KIND.PENGUIN_DIG]: 'minigamePenguin',
  /** 7 七彩氣球 @source _rich4_ui_game_balloon ✅ 同上 */
  [SPECIAL_KIND.BALLOON]: 'minigameBalloon',
  /** 8 喜從天降 @source _rich4_ui_game_xicongtianjiang ✅ 同上 */
  [SPECIAL_KIND.GIFT_FROM_SKY]: 'minigameGift',
  /** 9 樂透 @source _rich4_ui_letou_bar_entry ✅ T-036 */
  [SPECIAL_KIND.LOTTERY]: 'lottery',
  /** 10 得５０點 ✅ */
  [SPECIAL_KIND.POINTS_50]: 'points',
  /** 11 得３０點 ✅ */
  [SPECIAL_KIND.POINTS_30]: 'points',
  /** 12 得１０點 ✅ */
  [SPECIAL_KIND.POINTS_10]: 'points',
  /** 13 卡片 @source _rich4_player_receive_random_card ✅ */
  [SPECIAL_KIND.CARD]: 'card',
  /** 14 銀行 @source _rich4_ui_bank_atm_entry ⏳ */
  [SPECIAL_KIND.BANK]: 'bank',
  /** 15 百貨公司 @source _rich4_ui_shop_entry ⏳ */
  [SPECIAL_KIND.DEPARTMENT_STORE]: 'shop',
  /** 16 魔法屋 @source fcn_0043380a（docs 记为 magic_house）⏳ */
  [SPECIAL_KIND.MAGIC_HOUSE]: 'magicHouse',
} as const;

export type SpecialHandler = (typeof SPECIAL_HANDLERS)[keyof typeof SPECIAL_HANDLERS];

/** 跳表上界：`cmp ebx, 0x10 / ja → end`，故 kind > 16 一律无效果 */
export const MAX_SPECIAL_KIND = 0x10;

export function handlerFor(specialKind: number): SpecialHandler | 'none' {
  if (specialKind > MAX_SPECIAL_KIND) return 'none';
  return SPECIAL_HANDLERS[specialKind as keyof typeof SPECIAL_HANDLERS] ?? 'none';
}

/**
 * 得点格的点数。
 * @source rich4_player_core_actions.asm:2412 / 2459 / 2498
 *   `add word [player + 48], 0x32 / 0x1e / 0xa`
 *   （+48 = 0x30 = player_info 的 `points` 字段）
 */
export const POINTS_AWARD: Readonly<Record<number, number>> = {
  [SPECIAL_KIND.POINTS_50]: 0x32, // 50
  [SPECIAL_KIND.POINTS_30]: 0x1e, // 30
  [SPECIAL_KIND.POINTS_10]: 0x0a, // 10
};

/**
 * 累加点数。
 *
 * ⚠️ 原版用 `add word`，`points` 是 **uint16**，超过 65535 会**回绕**。
 * 按 C-FID-4，此行为原样保留，不做饱和处理。
 */
export function addPoints(current: number, delta: number): number {
  return (current + delta) & 0xffff;
}

/** 特殊格结算的产出 */
export interface SpecialOutcome {
  handler: SpecialHandler | 'none';
  /** 点数变化量（得点格） */
  pointsDelta: number;
  /** 抽到的卡片编号（1 基）；未抽卡时为 0 */
  cardDrawn: number;
  /** 归约后的 PRNG 状态 */
  rngState: number;
  /** 该格尚未实现，需要留待对应子系统 */
  unimplemented: boolean;
}

/**
 * 结算落在特殊格上的效果（已实现的部分）。
 *
 * @param specialKind `node.flags & 0xff`
 * @param player      当前玩家
 * @param cardAmount  牌堆各卡剩余张数
 * @param rngState    当前 PRNG 状态
 */
export function settleSpecialSquare(
  specialKind: number,
  player: Player,
  cardAmount: readonly number[],
  rngState: number,
): SpecialOutcome {
  const handler = handlerFor(specialKind);
  const base: SpecialOutcome = {
    handler,
    pointsDelta: 0,
    cardDrawn: 0,
    rngState,
    unimplemented: false,
  };

  switch (handler) {
    case 'none':
    case 'land':
    case 'noop':
      // 公園落地无效果 —— 这是原版行为，不是缺漏
      return base;

    case 'points':
      return { ...base, pointsDelta: POINTS_AWARD[specialKind] ?? 0 };

    case 'card': {
      const rng = new WatcomRng();
      rng.setState(rngState);
      const card = drawRandomCard(rng, cardAmount);
      return { ...base, cardDrawn: card, rngState: rng.getState() };
    }

    default:
      // 新聞/命運/監獄/醫院/樂透/銀行/百貨/魔法屋/三个小游戏
      return { ...base, unimplemented: true };
  }
}

/** 玩家手牌上限 @source 存档中每人 15 个卡片槽位 */
export const MAX_HAND_CARDS = 15;
