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

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
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
  /**
   * 原版在 `mutate_land` 尾部是否调了 `0x0040dffa()`（**全场释放被关押者**）。
   *
   * ★★ 这条以前被漏掉了：调用方必须自己把 `players` 过一遍
   *   `rules/blocking.ts` 的 `releaseConfinedPlayers()`。
   *   三种 mode 的门控见下方各分支注释（差分证据
   *   `rich4-spec/tests/test_mutate_release.py`）。
   */
  releasesConfined: boolean;
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
 * ; mode 1 —— **完全清除**（无前置判据，一定会改）
 * [land+0x19] = 0; [land+0x1a] = 0; [land+0x18] = 0; [land+0x30] = 0
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
      if (land.level === 0) return { land, changed: false, releasesConfined: false };
      if (land.type !== LAND_TYPE_HOUSE) {
        // @source 0x40ae0a `[+0x18] = 0` 紧跟 `0x40ae0d call 0x40dffa`（拆到 0 级）
        return {
          land: { ...land, level: 0, type: LAND_TYPE_HOUSE },
          changed: true,
          releasesConfined: true,
        };
      }
      const level = land.level - 1;
      // @source 0x40ae03 `test al,al / jne 0x40ae67` —— **只有归零才**放人
      return {
        land: { ...land, level },
        changed: true,
        releasesConfined: level === 0,
      };
    }
    // ★★ mode 1 是**完全清除**：owner + **level** + type + **flast** 四项全清
    //   （原版 `0x0040abae`–`0x0040abc3`，无任何前置判据）：
    //   ```asm
    //   0040abae  mov byte ptr [eax + 0x19], 0   ; owner
    //   0040abb2  mov byte ptr [eax + 0x1a], 0   ; ★ level
    //   0040abb6  mov byte ptr [eax + 0x18], 0   ; type
    //   0040abba  mov dword ptr [eax + 0x30], edx ; ★ flast = 0
    //   0040abbd  push edx / call 0x40a4e1        ; ★ 地图数组重算（复刻**未实现**，见 §7.46）
    //   ```
    //   此前只清 owner/type，**level 与 flast 留着** ⇒ 新聞 5/19（拆屋类）
    //   会在地图上留下**无主的"残楼"**（等级还在、地契却没了），
    //   玩家能直接看到"房子还在但没人拥有"。
    case MUTATE_CLEAR_OWNER:
      // @source 0x40ae58 `call 0x40dffa` —— mode 1 无条件放人
      return {
        land: { ...land, owner: 0, level: 0, type: LAND_TYPE_HOUSE, flast: 0 },
        changed: true,
        releasesConfined: true,
      };
    case MUTATE_FLATTEN: {
      if (land.level === 0) return { land, changed: false, releasesConfined: false };
      // @source 0x40ae58 `call 0x40dffa`（mode 2：level != 0 时）
      return {
        land: { ...land, level: 0, type: LAND_TYPE_HOUSE },
        changed: true,
        releasesConfined: true,
      };
    }
    default:
      return { land, changed: false, releasesConfined: false };
  }
}

export interface MonsterResult {
  ok: boolean;
  land: LandInfo;
  /** 敌意变化：原主对出牌者 */
  hostilityDeltas: { from: number; to: number; delta: number }[];
  /** 原版 `mutate_land` 尾部是否调了 `0x40dffa()`（全场释放被关押者） */
  releasesConfined: boolean;
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
  return {
    ok: out.changed,
    land: out.land,
    hostilityDeltas,
    releasesConfined: out.releasesConfined,
  };
}

// ============================================================
//  設施分支（entityId 落在 0xfa0..0x1770，VA 0x0040abdb 起）
// ============================================================

export interface FacilityMutateResult {
  facility: FacilityInfo;
  changed: boolean;
  /** 同 `MutateResult.releasesConfined` —— 原版 `0x40dffa()` 的门控 */
  releasesConfined: boolean;
}

/**
 * 改造一处设施 —— `mutate_land` 的設施分支（VA 0x0040abdb..0x0040ac76），
 * 与住宅地分支同构，但记录长 56 字节、字段语义略有不同：
 *
 * @source
 * ```asm
 * ; mode 0 —— 拆一级
 * cl = [fac+0x1a]; test cl,cl; je 不变
 * [fac+0x1a] = cl - 1
 * if (结果 == 0) { [fac+0x18] = 0; call 0x40dffa }   ; 拆到 0 级退回公園
 *
 * ; mode 1 —— 清归属
 * [fac+0x19] = 0; [fac+0x1a] = 0; [fac+0x18] = 0; [fac+0x34] = 0
 *
 * ; mode 2 —— 夷平
 * if ([fac+0x1a] == 0) 不变
 * [fac+0x1a] = 0; [fac+0x18] = 0; call 0x40dffa
 * ```
 *
 * ★ 与地块分支的两处不同：
 *   - mode 0 没有「连锁店直接清空」的说法，但拆到 0 级时**种类归零（退回公園）**；
 *   - ★★ **`0x40dffa` 不是表现层**（此前这里写错了）：它把**全场所有在场
 *     且被关押的玩家**（`+0x32 != 0`）置成「下一天释放」（`0x80`）。
 *     差分实证 `rich4-spec/tests/test_mutate_release.py`（7/7）。
 *     本函数因此返回 `releasesConfined`，**调用方必须**把它落到 `players` 上
 *     （`rules/blocking.ts` 的 `releaseConfinedPlayers`）—— 已在
 *     `cards/registry.ts`（4 处）与 `events/news-effects.ts`（6 处）接好。
 *   - 原版紧随其后还有一次 `call 0x40a4e1`（地图数组重算）—— 复刻仍未实现，
 *     记为待办（见 `docs/gaps/README.md` §7.46）。
 *   归属同样保留（mode 2 不动 +0x19）。
 */
export function mutateFacility(facility: FacilityInfo, mode: number): FacilityMutateResult {
  switch (mode) {
    case MUTATE_DEMOLISH_ONE: {
      if (facility.level === 0) return { facility, changed: false, releasesConfined: false };
      const level = facility.level - 1;
      // @source jne 0x40ac71 —— 拆到 0 级才清种类（退回公園）**并 call 0x40dffa**
      return {
        facility: level === 0 ? { ...facility, level, type: 0 } : { ...facility, level },
        changed: true,
        releasesConfined: level === 0,
      };
    }
    // ★ 同上：設施的 mode 1 还要清 `flast`（**在 `+0x34`**，与住宅的 `+0x30` 不同）
    //   —— 原版 `0x0040abe...` 的設施支：`[fac+0x19]=0; [+0x1a]=0; [+0x18]=0; [+0x34]=0`
    //   （见本文件上方 mode 1 的注释）。此前漏了 `flast`。
    case MUTATE_CLEAR_OWNER:
      // @source 0x40ac4d `call 0x40dffa` —— mode 1 无条件放人（后跟 0x40a4e1）
      return {
        facility: { ...facility, owner: 0, level: 0, type: 0, flast: 0 },
        changed: true,
        releasesConfined: true,
      };
    case MUTATE_FLATTEN: {
      if (facility.level === 0) return { facility, changed: false, releasesConfined: false };
      // @source 0x40ac6c `call 0x40dffa`（mode 2：level != 0 时）
      return {
        facility: { ...facility, level: 0, type: 0 },
        changed: true,
        releasesConfined: true,
      };
    }
    default:
      return { facility, changed: false, releasesConfined: false };
  }
}

export interface MonsterFacilityResult {
  ok: boolean;
  facility: FacilityInfo;
  /** 敌意变化：原主对出牌者 */
  hostilityDeltas: { from: number; to: number; delta: number }[];
  /** 同 `MonsterResult.releasesConfined` */
  releasesConfined: boolean;
}

/**
 * 怪獸卡踏**设施**：与地块路径完全同构 —— 敌意先按原等级算好
 * （`level × 30 × 物价指数`，无主设施不记），再 mode 2 夷平。
 *
 * @source VA 0x004439e8..0x00443a2f（怪獸卡的設施敌意段：
 *   `dl = [fac+0x1a]; 30×level×[0x4990e8] → 0x40df69`，
 *   `cmp byte [fac+0x19], 0 / je 跳过敌意`）+ mutate mode 2（0x0040ac5e）
 */
export function applyMonsterFacilityCard(
  facility: FacilityInfo,
  priceIndex: number,
  currentPlayer: number,
): MonsterFacilityResult {
  // @source cmp byte [ebx+0x19], 0 / je —— 无主设施不记敌意
  const hostilityDeltas =
    facility.owner === 0
      ? []
      : [
          {
            from: facility.owner - 1,
            to: currentPlayer,
            delta: facility.level * MONSTER_HOSTILITY_PER_LEVEL * priceIndex,
          },
        ];

  const out = mutateFacility(facility, MUTATE_FLATTEN);
  return {
    ok: out.changed,
    facility: out.facility,
    hostilityDeltas,
    releasesConfined: out.releasesConfined,
  };
}
