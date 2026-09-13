/*
 * 怪獸卡（11）与地块改造 helper
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：
 *   卡片本体 VA 0x00443917
 *   效果     `mutate_land(entityId, mode)` @ VA 0x0040ab4a
 *
 * ★ `mutate_land` 是个**被复用的三模式 helper**，不是怪獸卡独有：
 *   mode 0 拆一级（拆除卡走这条）、mode 1 清归属、mode 2 夷平。
 *   怪獸卡用的是 **mode 2**。
 */

import type { LandInfo } from '../loaders/map.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';

/** `mutate_land` 的三种模式 */
export const MUTATE_DEMOLISH_ONE = 0;
export const MUTATE_CLEAR_OWNER = 1;
export const MUTATE_FLATTEN = 2;

/**
 * 怪獸卡的敌意系数。
 *
 * @source VA 0x004439bd：
 * ```asm
 * dl = byte [land + 0x1a]      ; level
 * add edx, edx                 ; 2×level
 * eax = edx<<4                 ; 32×level
 * eax -= edx                   ; ★ 30×level
 * imul eax, [0x4990e8]         ; × 物价指数
 * ```
 * 即 `等级 × 30 × 物价指数`。
 *
 * ⚠️ 无主地不记敌意（`mov cl, [land+0x19] / test cl,cl / je 跳过`）。
 */
export const MONSTER_HOSTILITY_PER_LEVEL = 30;

export interface MutateResult {
  land: LandInfo;
  /** 原版返回值：1 表示确实改动了，0 表示什么都没发生 */
  changed: boolean;
}

/**
 * 改造一块住宅地。
 *
 * @source VA 0x0040ab4a 的三个分支：
 * ```asm
 * ; mode 0 —— 拆一级
 * ch = [land+0x1a]; test ch,ch; je 不变
 * [land+0x1a] = ch - 1
 * if ([land+0x18] != 0) { [land+0x1a] = 0; [land+0x18] = 0; }   ; 连锁店直接清空
 *
 * ; mode 1 —— 清归属
 * [land+0x19] = 0; [land+0x18] = 0; [land+0x30] = 0
 *
 * ; mode 2 —— 夷平
 * if ([land+0x1a] == 0) 不变
 * [land+0x1a] = 0; [land+0x18] = 0
 * ```
 *
 * ★ mode 0 对**连锁店**的处理值得注意：不是减一级，而是直接
 *   清空并变回住宅——连锁店本就只有 1 级（见 rebuild.ts 的
 *   CHAIN_STORE_MAX_LEVEL）。
 *
 * ★ mode 2 **保留归属**——怪獸踏平建筑，地还是原主的。
 */
export function mutateLand(land: LandInfo, mode: number): MutateResult {
  switch (mode) {
    case MUTATE_DEMOLISH_ONE: {
      if (land.level === 0) return { land, changed: false };
      if (land.type !== LAND_TYPE_HOUSE) {
        return { land: { ...land, level: 0, type: LAND_TYPE_HOUSE }, changed: true };
      }
      return { land: { ...land, level: land.level - 1 }, changed: true };
    }
    case MUTATE_CLEAR_OWNER:
      return { land: { ...land, owner: 0, type: LAND_TYPE_HOUSE }, changed: true };
    case MUTATE_FLATTEN: {
      if (land.level === 0) return { land, changed: false };
      return { land: { ...land, level: 0, type: LAND_TYPE_HOUSE }, changed: true };
    }
    default:
      return { land, changed: false };
  }
}

export interface MonsterResult {
  ok: boolean;
  land: LandInfo;
  /** 敌意变化：原主对出牌者 */
  hostilityDeltas: { from: number; to: number; delta: number }[];
}

/**
 * 使用怪獸卡：把目标地块上的建筑**全部夷平**。
 *
 * ⚠️ 与拆除卡（只拆一级）的区别就在这里——怪獸是一次踏平。
 * 归属不变，地还是原主的。
 *
 * ⚠️ 设施分支（entityId 落在 0xfa0..0x1770，VA 0x0040abdb 起）
 * 结构类似但字段偏移不同，**尚未实现**。
 */
export function applyMonsterCard(
  land: LandInfo,
  priceIndex: number,
  currentPlayer: number,
): MonsterResult {
  // @source test cl,cl / je —— 无主地不记敌意
  const hostilityDeltas =
    land.owner === 0
      ? []
      : [
          {
            from: land.owner - 1,
            to: currentPlayer,
            delta: land.level * MONSTER_HOSTILITY_PER_LEVEL * priceIndex,
          },
        ];

  const out = mutateLand(land, MUTATE_FLATTEN);
  return { ok: out.changed, land: out.land, hostilityDeltas };
}
