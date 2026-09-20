/*
 * 过路费计算
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_player_core_actions.asm:229
 *         `_rich4_calculate_land_toll` @ VA 0x00419750
 * @source 同文件:199 `_rich4_get_player_num_chain_store` @ VA 0x00419715
 *
 * C-DET-3：全程整数运算。
 */

import type { LandInfo } from '../loaders/map.ts';

/**
 * 连锁店的单店过路费基数。
 * @source rich4_player_core_actions.asm:293 `add edi, 0x7d0`（0x7d0 = 2000）
 */
export const CHAIN_STORE_TOLL = 0x7d0;

/**
 * 地块类型：0 = 住宅，非 0 = 连锁店。
 * @source rich4-re/csrc/land.h `uint8_t type; // 0x18: chained store or house`
 * 两个分支在过路费函数里分别以 `cmp byte [ebx+0x18],0` 的 je / jne 区分。
 */
export const LAND_TYPE_HOUSE = 0;

/** 拥有者字段：0 表示无主，否则为玩家 index + 1 */
export function isOwnedBy(land: LandInfo, ownerId: number): boolean {
  return land.owner === ownerId;
}

/**
 * 统计某玩家拥有的连锁店数量。
 *
 * @source `_rich4_get_player_num_chain_store`：
 *   遍历 lands[1..num_lands]，取 `type != 0` 且 `owner == 该玩家` 的计数。
 */
export function countChainStores(lands: readonly LandInfo[], ownerId: number): number {
  let n = 0;
  for (const land of lands) {
    if (land.type === LAND_TYPE_HOUSE) continue;
    if (!isOwnedBy(land, ownerId)) continue;
    n++;
  }
  return n;
}

/**
 * 「算进这笔过路费」的每一块地。
 *
 * ★ W-69：与 `calculateLandToll` **同一套判据**，单列出来是给收费前那段
 *   「把算进去的地一起闪一遍」的演出用（原版在棋盘 id 图上把这几块标 0xffff）。
 *   两个函数共用本判据，免得日后一边改了另一边没改。
 *
 * @source `_rich4_calculate_land_toll` 的两个分支（loc_00419760 / loc_004197a5）：
 *   住宅支按「同主人 + 同名 + 住宅」，连锁店支按「同主人的每一家连锁店」。
 */
export function tollLands(
  lands: readonly LandInfo[],
  ownerId: number,
  districtName: string | null,
): LandInfo[] {
  const out: LandInfo[] = [];
  for (const land of lands) {
    if (!isOwnedBy(land, ownerId)) continue;
    if (districtName !== null) {
      if (land.type !== LAND_TYPE_HOUSE) continue;
      if (land.name !== districtName) continue;
    } else if (land.type === LAND_TYPE_HOUSE) {
      continue;
    }
    out.push(land);
  }
  return out;
}

/**
 * 计算过路费。
 *
 * 原版有两条互斥分支，由第二个参数（地块名）是否为空决定：
 *
 * **住宅**（传入地块名）：把该玩家名下**同名**（即同一区）的所有住宅地块，
 * 各按自身等级查 `rentByLevel` 累加。
 * 这解释了大富翁"整片区连号加成"的手感——不是乘系数，而是把同区地块的
 * 租金**直接相加**。
 *
 * **连锁店**（不传地块名）：该玩家名下每个连锁店固定 2000。
 *
 * 两者最后都 **× 物价指数**。
 *
 * @param lands       该地图的全部住宅/连锁店地块表
 * @param ownerId     地块拥有者（玩家 index + 1；0 为无主）
 * @param priceIndex  物价指数
 * @param districtName 住宅分支传入地块名；连锁店分支传 null
 */
export function calculateLandToll(
  lands: readonly LandInfo[],
  ownerId: number,
  priceIndex: number,
  districtName: string | null,
): number {
  let base = 0;

  // 住宅支按等级查表相加 @source loc_00419760；连锁店支每店固定 @source loc_004197a5
  for (const land of tollLands(lands, ownerId, districtName)) {
    base += districtName !== null ? (land.rentByLevel[land.level] ?? 0) : CHAIN_STORE_TOLL;
  }

  // @source loc_004197d8: imul eax, price_index
  return base * priceIndex;
}
