/*
 * 地块类卡片：天使 / 恶魔 / 拆除 / 涨价 / 查封
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 全部以原版 exe 反汇编为准（`python3 tools/disasm.py card N`）。
 * 共用底座见 rules/land-mutation.ts 与 cards/target.ts。
 */

import type { LandInfo } from '../loaders/map.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { PRICE_STATUS, demolishLand } from '../rules/land-mutation.ts';
import type { DemolishResult } from '../rules/land-mutation.ts';

// ============================================================
//  天使卡（9）—— 升级地块
// ============================================================

/**
 * 天使卡：给目标地块加一级。
 *
 * @source VA 0x004435b9:
 * ```asm
 * cmp byte [land + 0x18], 0     ; 是住宅吗？
 * je  0x4435cb                   ; 住宅 → inc level
 * cmp byte [land + 0x1a], 0      ; 连锁店：level == 0？
 * jne 0x4435ce                   ; 非 0 → **不变**
 * mov byte [land + 0x1a], 1      ; 为 0 → 设成 1
 * jmp 0x4435ce
 * 0x4435cb:
 * inc byte [land + 0x1a]         ; 住宅：level++
 * 0x4435ce:
 * cmp byte [land + 0x18], 0 / jne ...
 * cmp byte [land + 0x1a], 5      ; 住宅才做上限检查
 * ```
 *
 * 要点：**住宅可逐级升，连锁店只能从 0 升到 1，已有等级则原地不动**。
 */
export function applyAngelCard(land: LandInfo): LandInfo {
  if (land.type === LAND_TYPE_HOUSE) {
    // 住宅：升一级，受 MAX_LAND_LEVEL 上限约束
    const level = Math.min(land.level + 1, MAX_LAND_LEVEL);
    return { ...land, level };
  }
  // 连锁店：仅当等级为 0 时提到 1
  return land.level === 0 ? { ...land, level: 1 } : land;
}

// ============================================================
//  恶魔卡（10）—— 夷平地块
// ============================================================

/**
 * 恶魔卡：把目标地块**夷平并退回住宅**。
 *
 * @source VA 0x004437f8:
 * ```asm
 * mov byte [land + 0x1a], 0     ; level = 0
 * mov byte [land + 0x18], 0     ; type = 0（退回住宅）
 * inc esi / jmp 循环             ; ★ 在循环中执行，可作用于多块地
 * ```
 *
 * ⚠️ 与拆除卡的区别：**拆除卡对住宅只掉一级**，恶魔卡直接归零。
 */
export function applyDevilCard(land: LandInfo): LandInfo {
  return { ...land, level: 0, type: LAND_TYPE_HOUSE };
}

// ============================================================
//  拆除卡（12）
// ============================================================

/** 拆除卡：复用地块变更底座（住宅掉一级、连锁店夷平） */
export function applyDemolishCard(land: LandInfo, priceIndex: number): DemolishResult {
  return demolishLand(land, priceIndex);
}

// ============================================================
//  涨价卡（27）/ 查封卡（28）—— 按地块名批量标记
// ============================================================

/**
 * 涨价卡与查封卡都是**按地块名批量作用于同一区**。
 *
 * @source 涨价卡 VA 0x004454e3:
 * ```asm
 * call 0x458370        ; strcmp(land.name, 目标名)
 * test eax, eax
 * jne  跳过             ; 名称不同 → 跳过
 * mov  byte [land + 0x17], 0x50
 * inc  esi / jmp 循环   ; ★ 遍历全部地块
 * ```
 *
 * 这与过路费「同区地块租金相加」的机制互相呼应——
 * 原版一贯用**地块名**来标识「同一区」。
 */
export function applyDistrictMark(
  lands: readonly LandInfo[],
  districtName: string,
  status: (typeof PRICE_STATUS)[keyof typeof PRICE_STATUS],
): { lands: LandInfo[]; affected: number[] } {
  const affected: number[] = [];
  const next = lands.map((l) => {
    // @source strcmp == 0 才处理
    if (l.name !== districtName) return l;
    affected.push(l.id);
    return { ...l, priceStatus: status };
  });
  return { lands: next, affected };
}

/** 涨价卡：把同名地块群标记为涨价 */
export function applyRaisePriceCard(
  lands: readonly LandInfo[],
  districtName: string,
): { lands: LandInfo[]; affected: number[] } {
  return applyDistrictMark(lands, districtName, PRICE_STATUS.RAISED);
}

/** 查封卡：把同名地块群标记为查封 */
export function applySealCard(
  lands: readonly LandInfo[],
  districtName: string,
): { lands: LandInfo[]; affected: number[] } {
  return applyDistrictMark(lands, districtName, PRICE_STATUS.SEALED);
}
