/*
 * 改建卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 7`
 *   函数 VA 0x0044309b
 */

import type { LandInfo } from '../loaders/map.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { housingIndexOf } from '../rules/land.ts';

/**
 * 改成连锁店后的等级上限。
 * @source `cmp byte [land+0x1a], 1 / jbe skip / mov byte [land+0x1a], 1`
 */
export const CHAIN_STORE_MAX_LEVEL = 1;

export type RebuildFailure =
  /** 落点不是住宅地块 */
  | 'notHousingLand'
  /** 空地（等级为 0）不可改建 */
  | 'emptyLot';

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
 * ⚠️ 设施地块分支（type 落在 `(0xfa0, 0x1770)`，VA 0x0044315d 起）
 * 结构类似但另有一次 `call 0x440aac`，语义未明，**尚未实现**。
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
