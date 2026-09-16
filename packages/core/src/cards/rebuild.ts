/*
 * 改建卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 7`
 *   函数 VA 0x0044309b
 */

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { housingIndexOf } from '../rules/land.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';

/**
 * 改成连锁店后的等级上限。
 * @source `cmp byte [land+0x1a], 1 / jbe skip / mov byte [land+0x1a], 1`
 */
export const CHAIN_STORE_MAX_LEVEL = 1;

export type RebuildFailure =
  /** 落点不是住宅地块 */
  | 'notHousingLand'
  /** 空地（等级为 0）不可改建 */
  | 'emptyLot'
  /** 落点不是設施格（改建卡只认**脚下**那一格，見 target.ts 的 C-ARC-2） */
  | 'notFacility'
  /** 等級 0 的設施（还没盖起来）不可改建 */
  | 'emptyFacility'
  /** 没给「要改成哪一种」—— 真人必须先过选類別窗（`fcn_00440aac`） */
  | 'facilityTypeRequired'
  /** 给的种类不在 0..4（`FACILITY_TYPE` 之外） */
  | 'badFacilityType';

export interface RebuildResult {
  ok: boolean;
  reason: RebuildFailure | null;
  /** 改建后的地块；失败时为 null */
  land: LandInfo | null;
}

/**
 * 改建卡：把落点地块在**住宅 ↔ 连锁店**之间互换。
 *
 * 原版核心（VA 0x00443128）：
 * ```asm
 * mov ah, byte [land + 0x18]
 * xor ah, 1                      ; ★ type ^= 1，住宅(0) ↔ 连锁店(1)
 * mov byte [land + 0x18], ah
 * je  done                       ; 结果为 0（变回住宅）→ 不动等级
 * cmp byte [land + 0x1a], 1
 * jbe done
 * mov byte [land + 0x1a], 1      ; ★ 变成连锁店时，等级 > 1 则压到 1
 * done:
 * mov esi, 1                     ; 返回 1
 * ```
 *
 * 前置条件（VA 0x004430c7 起）：
 * - 落点 type 必须落在住宅区间 `(0x7d0, 0xfa0)`
 * - `land.level != 0` —— **空地不可改建**
 *
 * ★ 設施那一支见 `applyRebuildFacilityCard`（VA 0x0044315d 起）。
 */
export function applyRebuildCard(
  nodeType: number,
  land: LandInfo | null,
): RebuildResult {
  const landIndex = housingIndexOf(nodeType);
  if (landIndex === null || land === null) {
    return { ok: false, reason: 'notHousingLand', land: null };
  }
  // @source cmp byte [land+0x1a], 0 / je → 失败
  if (land.level === 0) {
    return { ok: false, reason: 'emptyLot', land: null };
  }

  // @source xor ah, 1
  const nextType = land.type ^ 1;
  const becomesChainStore = nextType !== LAND_TYPE_HOUSE;

  return {
    ok: true,
    reason: null,
    land: {
      ...land,
      type: nextType,
      // 变成连锁店时把等级压到 1；变回住宅则保持原等级
      level: becomesChainStore && land.level > CHAIN_STORE_MAX_LEVEL
        ? CHAIN_STORE_MAX_LEVEL
        : land.level,
    },
  };
}

export interface RebuildFacilityResult {
  ok: boolean;
  reason: RebuildFailure | null;
  /** 改建后的設施；失败时为 null */
  facility: FacilityInfo | null;
}

/**
 * 等級上限为 1 的設施种类 —— 改成它们时要把等级压到 1。
 *
 * @source 加蓋卡 VA 0x004431e8 起：
 * ```asm
 * mov byte [ebx + 0x18], al     ; ★ 直接写掉种类（不是 xor）
 * mov dh, byte [ebx + 0x18]
 * test dh, dh / je   clamp      ; 種類 0（公園）
 * cmp dh, 3 / jne    done       ; 種類 3（加油站）
 * clamp:
 * cmp byte [ebx + 0x1a], 1 / jbe done
 * mov byte [ebx + 0x1a], 1      ; ★ 等级 > 1 压到 1
 * ```
 * 这两个种类正是 `FACILITY_MAX_LEVEL` 里上限为 1 的那两个
 * （`0x00474940` = `[1, 5, 5, 1, 5]`：公園 / 加油站）。
 * 写出时**原版不复核**返回的种类是否与现状相同 —— 改成同一种照样消耗卡片。
 */
export const FACILITY_TYPE_SINGLE_LEVEL: readonly number[] = [
  FACILITY_TYPE.park,
  FACILITY_TYPE.gasStation,
];

/**
 * 改建卡：把**脚下那栋設施**改成指定的种类。
 *
 * 原版核心（VA 0x0044315d 起，`_rich4_use_card_gaijianka` 的設施那一支）：
 * ```asm
 * ; 落点 type 必须落在設施区间 (0xfa0, 0x1770)，否则返回 0（卡片不消耗）
 * cmp byte [ebx + 0x1a], 0 / je fail        ; ★ 等级 0（空地）→ 不生效
 * ; 报台词（与地块那一支同一条串：card_strings[卡号] + 0x18）
 * cmp byte [player + 21], 1 / jne ai        ; ★ 真人 / 电脑两条来路
 *   push 1 / call fcn_00440aac              ;   真人：开「請選擇設施類別」窗
 *   cmp eax, -1 / jne use                   ;   右键取消 → esi = 0，卡片不消耗
 * ai:
 *   push 0 / call _rich4_get_ai_card_param_value  ; 电脑：种类来自 AI 预先算好的参数
 * use:
 * mov byte [ebx + 0x18], al                 ; ★ 种类 = 选中的值
 * ; 種類 0 / 3 → 等级压到 1（见 FACILITY_TYPE_SINGLE_LEVEL）
 * mov esi, 1 / …                            ; 返回 1 → 消耗卡片 + refresh_screen
 * ```
 *
 * 与地块那一支的三点不同（都是原版明写的）：
 * 1. 种类是**选出来的**，不是 `xor 1`（所以外部必须给 `chosenType`）；
 * 2. 真人那一支**要先过选類別窗**，右键取消 = 这张卡不消耗（返回 0）；
 * 3. 种类 0 / 3 之外**不看等级**（旅館/購物中心/研究所保留原等级）。
 *
 * ⚠️ 原版**不看业主**：站在谁的設施上就改谁的（与地块那一支一致）。
 *
 * @param facility 脚下的設施记录（不是設施格给 null）
 * @param chosenType 要改成的 `FACILITY_TYPE`（0..4）；真人的来源是选類別窗，
 *   电脑的来源是 AI 参数（@source `[0x48be58]`：自己的公園 → `rand()%4+1`，
 *   对手的 → **0 = 公園**）
 */
export function applyRebuildFacilityCard(
  facility: FacilityInfo | null,
  chosenType: number | undefined,
): RebuildFacilityResult {
  if (facility === null) {
    return { ok: false, reason: 'notFacility', facility: null };
  }
  if (chosenType === undefined) {
    return { ok: false, reason: 'facilityTypeRequired', facility: null };
  }
  // 原版这一支不做范围检查 —— 0..4 由选類別窗（五格）与 AI 参数（rand()%4+1 / 0）保证。
  // 本引擎把外部参数当不可信输入复核一道（C-ARC-2：core 负责校验目标）。
  if (
    !Number.isInteger(chosenType)
    || chosenType < 0
    || chosenType > FACILITY_TYPE.lab
  ) {
    return { ok: false, reason: 'badFacilityType', facility: null };
  }
  // @source cmp byte [ebx + 0x1a], 0 / je → 返回 0，卡片不消耗
  if (facility.level === 0) {
    return { ok: false, reason: 'emptyFacility', facility: null };
  }

  const singleLevel = FACILITY_TYPE_SINGLE_LEVEL.includes(chosenType);
  return {
    ok: true,
    reason: null,
    facility: {
      ...facility,
      type: chosenType,
      // 公園 / 加油站等级上限 1；其余种类保留原等级
      level: singleLevel && facility.level > CHAIN_STORE_MAX_LEVEL
        ? CHAIN_STORE_MAX_LEVEL
        : facility.level,
    },
  };
}
