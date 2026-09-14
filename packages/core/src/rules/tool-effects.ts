/*
 * 道具效果
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 对照 `rich4-re/asm/rich4_tool_*.asm` 逐个翻译，并以 exe 复核。
 *
 * 多数道具的「选谁／选哪一格」走 `_rich4_select_instance_with_mouse`
 * （0x446ae8，与卡片目标选择同一个模态 UI），按 C-ARC-2 不进 core——
 * 目标作为参数传入。
 */

import type { Player } from '../state/types.ts';
import type { MapObject } from '../cards/summon.ts';
import { TOOL_SLOTS_PER_PLAYER } from './tools.ts';
import { placeObjectOfType } from './object-landing.ts';

// ============================================================
//  交通工具
// ============================================================

/**
 * 交通方式与骰子数。
 *
 * @source `rich4_tool_jiche.asm` / `rich4_tool_qiche.asm`：
 * ```asm
 * ; 機車
 * mov byte [player + 0x11], 1      ; traffic_method = 1
 * mov byte [player + 0x12], 2      ; ★ ndices = 2
 * ; 汽車
 * mov byte [player + 0x11], 2
 * mov byte [player + 0x12], 3      ; ★ ndices = 3
 * ```
 *
 * ★ 这条解释了两件既有的事：
 *   - 玩家默认 `ndices = 1`（步行）
 *   - 设施过路费的交通倍率 `1 << ((traffic & 3) - 1)`（见 rules/god-toll.ts）
 */
export const VEHICLE_DICE: ReadonlyMap<number, number> = new Map([
  [0, 1], // 步行
  [1, 2], // 機車
  [2, 3], // 汽車
]);

/** 交通方式编号 */
export const TRAFFIC_WALK = 0;
export const TRAFFIC_MOTORCYCLE = 1;
export const TRAFFIC_CAR = 2;
/**
 * 工程車的交通方式。
 * @source `mov byte [player + 0x11], 0x1f`（rich4_tool_gongchengche.asm）
 *
 * ⚠️ 注意 `0x1f & 3 === 3`，故设施过路费倍率会取到 `1 << 2 = 4`——
 * 是三种交通工具里最贵的。这是该值的直接后果，不是巧合。
 */
export const TRAFFIC_ENGINEERING = 0x1f;

/** 道具编号 → 它给予的交通方式 */
export const VEHICLE_TOOLS: ReadonlyMap<number, number> = new Map([
  [5, TRAFFIC_MOTORCYCLE],
  [6, TRAFFIC_CAR],
  [12, TRAFFIC_ENGINEERING],
]);

/** 交通方式 → 被换下时退还的道具编号 */
export const TRAFFIC_REFUND: ReadonlyMap<number, number> = new Map([
  [TRAFFIC_MOTORCYCLE, 5],
  [TRAFFIC_CAR, 6],
]);

export interface VehicleResult {
  ok: boolean;
  player: Player;
  tools: number[];
}

/**
 * 换乘交通工具。
 *
 * @source `rich4_tool_jiche.asm` 全文：
 * ```asm
 * dl = byte [player + 0x11]
 * cmp dl, 1 / jne 查2
 * xor edx, edx / jmp 结束            ; ★ 已经是機車 → 什么都不做
 * 查2:
 * cmp dl, 2 / jne 设置
 * inc byte [player*15 + 0x499161]    ; ★ 原本开汽車 → 把汽車退还成道具
 * 设置:
 * byte [player + 0x11] = 1
 * byte [player + 0x12] = 2
 * ```
 * 汽車版本对称（已是汽車则不做；原本骑機車则退还機車）。
 *
 * ★ 「已经是同一种就白用」是原版行为——道具会被消耗吗？
 *   `jmp 结束` 直接跳到函数尾，**没有走 take_tool**，故**不消耗**。
 */
export function useVehicleTool(
  player: Player,
  tools: readonly number[],
  toolId: number,
): VehicleResult {
  const traffic = VEHICLE_TOOLS.get(toolId);
  if (traffic === undefined) return { ok: false, player, tools: [...tools] };

  // @source cmp dl, 1 / jne … / xor edx,edx / jmp 结束
  if (player.trafficMethod === traffic) {
    return { ok: false, player, tools: [...tools] };
  }

  const nextTools = [...tools];
  // @source 原本的交通工具退还成道具
  const refund = TRAFFIC_REFUND.get(player.trafficMethod);
  if (refund !== undefined) {
    const at = player.index * TOOL_SLOTS_PER_PLAYER + refund;
    nextTools[at] = (nextTools[at] ?? 0) + 1;
  }

  return {
    ok: true,
    player: {
      ...player,
      trafficMethod: traffic,
      // @source byte [player + 0x12] = 2 / 3 / 1
      ndices: VEHICLE_DICE.get(traffic) ?? 1,
    },
    tools: nextTools,
  };
}

// ============================================================
//  放置类道具
// ============================================================

/**
 * 放置类道具与其物件种类。
 *
 * @source 三个 asm 都走 `_rich4_place_object`（0x0040e033），
 *   压入的种类分别是：
 * ```
 * rich4_tool_luzhang.asm        push 0x10   → 16 路障
 * rich4_tool_dilei.asm          push 0x11   → 17 地雷
 * rich4_tool_dingshizhadan.asm  push 0x12   → 18 定時炸彈
 * ```
 * 与物件名表（rules/purchase.ts 的 OBJECT_NAMES）下标 16/17/18 一一对上。
 */
export const PLACEMENT_TOOLS: ReadonlyMap<number, number> = new Map([
  [2, 16], // 路障
  [3, 17], // 地雷
  [4, 18], // 定時炸彈
]);

export interface PlaceResult {
  ok: boolean;
  objects: MapObject[];
  /** 被占用的物件槽下标（0 基）；失败为 -1 */
  slot: number;
}

/**
 * 在地图上放一个物件。
 *
 * 目标格由 `_rich4_select_instance_with_mouse`（0x446ae8）选定，
 * 按 C-ARC-2 作为参数传入。
 *
 * ★ 槽位**按种类分区**，不是随手找空位——见 `rules/objects.ts` 的
 *   `slotRangeForType`（@source `place_object` VA 0x0040e033）。
 *
 * ⚠️ 先前这里取的是「第一个空槽」，那是**错的**：放一个路障可能占掉
 *   0 号槽并把它的种类改写成 16，而 0 号槽在原版里永远是小財神。
 *   物件表的「下标决定种类」是全局不变量，`OBJECT_TYPE_TABLE`、
 *   `god_info = 下标 + 1`、送神符的类型判定全都依赖它。
 */
export function placeObject(
  objects: readonly MapObject[],
  nodeId: number,
  objectType: number,
): PlaceResult {
  const r = placeObjectOfType(objects, objectType, nodeId);
  return { ok: r.slot >= 0, objects: r.objects, slot: r.slot };
}

// ============================================================
//  尚未实现
// ============================================================

/**
 * 效果**尚未实现**的道具。
 *
 * 各自的入口与已知线索：
 * | 编号 | 道具 | 线索 |
 * |---|---|---|
 * | 1 | 機器娃娃 | 写 `_rich4_all_special_players_state`(0x498e28) +64..+74，创建一个替身走子 |
 * | 7 | 飛彈 | 选择参数 0x300c0，随后 `push 0x26` |
 * | 8 | 遙控骰子 | 自带一套 UI（`push 0x446774` 为窗口过程），由玩家指定点数 |
 * | 9 | 機器工人 | 选目标后 `_rich4_get_ai_tool_param_value` |
 * | 10 | 時光機 | `call _rich4_restore_last_state`(0x448544) —— **读档式撤销** |
 * | 11 | 傳送機 | 连续三次选择（0x1200036 / 0x2090802 / 0x2090804） |
 * | 13 | 核子飛彈 | 选择参数 0x400c0，`push 0xd` |
 *
 * ★ 特别记一笔：**時光機是靠还原存档实现撤销的**。
 *   若要在本项目复现，得有一份「上一步状态」的快照——
 *   这与确定性引擎的 action 日志天然契合（重放到前一步即可），
 *   反而比原版更干净。
 */
export const UNIMPLEMENTED_TOOLS: readonly number[] = [1, 7, 8, 9, 10, 11, 13];

export function isToolImplemented(toolId: number): boolean {
  return !UNIMPLEMENTED_TOOLS.includes(toolId);
}
