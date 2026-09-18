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
 * ★ 落点分派器是 `0x41982d`，17 路跳表在 `0x4197e9`，索引 = `[node+0x24] & 0xff`。
 *   逐项实测（通道 2 `rich4-spec/tests/test_event_square_dispatch.py` 66/66）：
 *   `[9] 樂透 0x41b17a`、`[10] 得50點 0x41b184`、`[11] 得30點 0x41b21e`、
 *   `[12] 得10點 0x41b2a3`、`[13] **抽卡** 0x41b302`、`[14] 銀行 0x41b396`、
 *   `[15] 百貨 0x41b3b9`、`[16] 魔法屋 0x41b3cb`。
 *   ⚠️ 得点三档是 **10/11/12**（`0x41b184`/`0x41b21e`/`0x41b2a3`），不是 9/10/11。
 *   ⚠️ `0x41b211`（13 字节）**不是函数**，只是 `0x41b184` 尾部的
 *   `call player_say / jmp 尾声` 退出块（`rich4dis.py` 按 call 目标切出来的碎片）。
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
// ★ 點券是 **16 位字段**，实现搬到 `rules/points.ts`（那里有全 exe 38 处访问的宽度普查）。
//   这里保留 re-export：既有调用方与测试的 import 路径不变。
export { addPoints } from './points.ts';

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
  /**
   * ★ **得５０點**那一格选中的台词下标（0 或 1）。
   *
   * @source `0x0041b1f8`：`call 0x456f2d / and eax,1` →
   *   `mov ecx, [角色*0x6C + eax*4 + 0x48084a]`（角色台词表的事件 0／1）→ `player_say`。
   * ★ **只有 50 點这一档掷**（`0x0041b184`）；30 點（`0x0041b21e`）与
   *   10 點（`0x0041b2a3`）两条路径里**没有** `call rand`。
   * 表现层按它播/显示台词；core 的职责是**按原版把随机数用掉**。
   */
  phraseIndex?: number;
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

    case 'points': {
      const delta = POINTS_AWARD[specialKind] ?? 0;
      // ★ 只有 **50 點** 这一档消耗一次随机数（选台词）。
      //   @source 0x0041b1f8 `call 0x456f2d` / `and eax,1`
      //     30 點 `0x0041b21e` 与 10 點 `0x0041b2a3` 两条桩里都没有 `call rand`。
      //
      // ★★ 2026-09-19（第 94 条，通道 2：`rich4-spec/tests/test_points_squares.py` 18/18）：
      //   三档**都说/不说台词**这件事也钉住了 ——
      //     50 點：`player_say(玩家, 0, 角色表事件 0 或 1)`（表基址 `0x48084a`，用 `rand&1` 选）
      //     30 點：`player_say(玩家, 0, 角色表事件 **2**)`（`0x480852 − 0x48084a = 8` ⇒ **固定 idx 2**、不掷）
      //     10 點：**一句都不说**（`0x41b2fd` 直接 `jmp` 尾声）
      //   ⇒ 30 點必须交出 `phraseIndex = 2`，否则表现层会漏掉那句（此前就是漏的）。
      if (specialKind === SPECIAL_KIND.POINTS_30) {
        return { ...base, pointsDelta: delta, phraseIndex: 2 };
      }
      if (specialKind !== SPECIAL_KIND.POINTS_50) {
        return { ...base, pointsDelta: delta };
      }
      const rng = new WatcomRng();
      rng.setState(rngState);
      const phraseIndex = rng.next() & 1;
      return { ...base, pointsDelta: delta, phraseIndex, rngState: rng.getState() };
    }

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
