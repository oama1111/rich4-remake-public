/*
 * 地块类卡片：天使 / 恶魔 / 拆除 / 涨价 / 查封
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 全部以原版 exe 反汇编为准（`python3 tools/disasm.py card N`）。
 * 共用底座见 rules/land-mutation.ts 与 cards/target.ts。
 */

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import { MAX_LAND_LEVEL } from '../loaders/map.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { PRICE_STATUS, demolishLand } from '../rules/land-mutation.ts';
import type { DemolishResult } from '../rules/land-mutation.ts';
import {
  OBJECT_TYPE_BOMB,
  OBJECT_TYPE_MINE,
  OBJECT_TYPE_ROADBLOCK,
  releaseObject,
} from '../rules/object-landing.ts';
import type { ObjectWorld, ReleaseOutcome } from '../rules/object-landing.ts';
import { MUTATE_DEMOLISH_ONE, MUTATE_FLATTEN, mutateFacility } from './monster.ts';
import { MONSTER_HOSTILITY_PER_LEVEL } from './monster.ts';
import { FACILITY_MAX_LEVEL } from '../rules/facility.ts';

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
//  拆除卡（12）—— 打**地图物件**那一支
// ============================================================

/**
 * 拆除卡(12) / 怪獸卡(11) 的**目标限制** —— 不能打自己的，也不能打空地。
 *
 * ★ 2026-09-16 补（Q-CARD-1 §4 ①）：原版在**拾取窗**里就把这两种目标挡掉（红叉），
 *   我们先前只在效果里判「有没有变化」，于是 UI 会让你选自己的地、选空地块。
 *
 * @source 拾取跳表 `ref_00445e2d`（VA 0x00445e2d）的**组 4**（`loc_00446457`，
 *   怪獸卡 `0xe0c0506`）与**组 5**（`loc_004464c3`，拆除卡 `0xe0c0626`），两组同形：
 * ```asm
 * cmp code, 0x7d0 / jle → 不是地块，转設施那支（0xfa0 < code < 0x1770）
 * mov dl, byte [target+0x19]      ; owner（1 基）
 * mov eax, [current_player] / inc eax
 * cmp edx, eax / je  拒绝          ; ★ 不能打**自己的**
 * cmp byte [target+0x1a], 0 / je 拒绝 ; ★ 不能打**空地**（等级 0）
 * ```
 * 表的下标 = `((参数 & 0xff00) >> 8) - 1`（VA 0x0044630a 起），
 * 低字节才是类别位 —— 所以「组」与「类别」是两件事，别混。
 */
export function demolishLikeTargetAllowed(
  owner: number,
  level: number,
  currentPlayer: number,
): boolean {
  if (owner === currentPlayer + 1) return false; // 自己的
  if (level === 0) return false; // 空地
  return true;
}

/**
 * 拆除卡能打的地图物件种类：**路障 16 / 地雷 17 / 定時炸彈 18**。
 *
 * @source 拾取窗口的额外规则（跳表组 6）VA 0x00446528：
 * ```asm
 * test bh, 0x80            ; 编码带 bit15（物件编码 0x8000 | handle<<8）
 * je   拒绝
 * ecx = (code >> 8) & 0x7f ; handle
 * ecx = objects[handle - 1].type
 * cmp ecx, 0x10 / je 收     ; 路障
 * cmp ecx, 0x11 / je 收     ; 地雷
 * cmp ecx, 0x12 / jne 拒绝  ; 定時炸彈
 * ```
 * 神明/禮物/寶箱等**不在**可打之列（它们没有这一段编码上的 handle 前缀语义）。
 */
export const DEMOLISHABLE_OBJECT_TYPES: readonly number[] = [
  OBJECT_TYPE_ROADBLOCK,
  OBJECT_TYPE_MINE,
  OBJECT_TYPE_BOMB,
];

/**
 * 拆除卡对**地图物件**：把那个物件从地图上收回。
 *
 * @source 拆除卡 VA 0x00443d22 起（编码走完地块/設施两条区间之后的第三支）：
 * ```asm
 * test byte [esp + 1], 0x80     ; ★ 物件编码的 bit15
 * je   收场                      ; 不是物件 → 什么都不做
 * esi = ([esp] & 0x7f00) >> 8   ; handle
 * ... 播一次动画（此处略）...
 * push esi / call _rich4_remove_object   ; VA 0x0040e14d
 * ```
 *
 * `_rich4_remove_object` 的完整语义已在 `rules/object-landing.ts` 的
 * `releaseObject` 里逐条译过，这里直接复用：
 *   - 路障/地雷/定時炸彈 → **回道具库存**（`remain_tool_amount` +1，即道具 2/3/4）
 *   - 物件从地图上摘掉（`nodeId`/`state`/`attached` 清零）
 *   - 定時炸彈另清携带者的 `f64`
 *   - 这三种物件**无搭档**，故不会触发搭档登场
 *
 * ⚠️ 原版物件分支**不记敌意**（地块/設施两支各有一处 `update_hostility`，
 *   第三支没有），故本函数也不产出敌意。
 *
 * @returns `null` = 这个 handle 不是「地图上的路障/地雷/定時炸彈」，
 *          此时原版拾取窗口根本不会放行（红叉），引擎按「不生效、不扣卡」处理。
 */
export function applyDemolishObjectCard(
  world: ObjectWorld,
  handle: number,
): ReleaseOutcome | null {
  const obj = world.objects[handle - 1];
  if (obj === undefined) return null;
  // 已不在图上的物件点不到（拾取是像素级命中）
  if (obj.nodeId === 0) return null;
  if (!DEMOLISHABLE_OBJECT_TYPES.includes(obj.type)) return null;
  return releaseObject(world, handle);
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

// ============================================================
//  設施分支 —— 天使 / 惡魔 / 拆除对設施同样生效
// ============================================================

// 最高等级表（公園 1、旅館 5、購物中心 5、加油站 1、研究所 5）
// 见 rules/facility.ts 的 FACILITY_MAX_LEVEL @source 0x00474940

export interface AngelFacilityResult {
  ok: boolean;
  facility: FacilityInfo;
  /**
   * 原版返回值：`0x81` 表示本次升到了 5 级（天使卡只凭
   *   `test al, 0x80` 放音效），`1` 表示建成/升级，`0` 表示没动。
   *   core 不需要音效，但保留档位以便测试比对。
   */
  resultCode: number;
}

/**
 * 天使卡对設施：`fcn_0040b110` 的設施分支（VA 0x0040b170..0x0040b220）。
 *
 * @source
 * ```asm
 * cmp byte [fac + 0x1a], 0     ; level == 0？
 * jne 升级
 * ; —— 首建：种类由外部给（AI 自己 rand()%4+1、別人 0=公園、
 * ;    真人走 UI 选择器 0x440aac），此处由参数传入
 * mov byte [fac + 0x18], 种类
 * mov byte [fac + 0x1a], 1
 * 升级:
 * mov al, byte [type + 0x474940]   ; 该种类的最高等级
 * cmp [fac + 0x1a], al
 * jae 返回 0                        ; 已满级 → 不动
 * inc byte [fac + 0x1a]
 * ; 升到 5 级时返回 0x81，否则返回 1
 * ```
 */
export function applyAngelFacilityCard(
  facility: FacilityInfo,
  buildType: number,
): AngelFacilityResult {
  if (facility.level === 0) {
    // 首建：种类由 target.buildType 给（缺省 0 = 公園）
    return { ok: true, facility: { ...facility, type: buildType, level: 1 }, resultCode: 1 };
  }
  const maxLevel = FACILITY_MAX_LEVEL[facility.type] ?? 0;
  if (facility.level >= maxLevel) {
    // @source jae → 返回 0：满级不动
    return { ok: false, facility, resultCode: 0 };
  }
  const level = facility.level + 1;
  // @source 升到 5 级返回 0x81
  return { ok: true, facility: { ...facility, level }, resultCode: level >= 5 ? 0x81 : 1 };
}

export interface DevilFacilityResult {
  ok: boolean;
  facility: FacilityInfo;
  /** 敌意变化：原主对出牌者（无主设施不记） */
  hostilityDeltas: { from: number; to: number; delta: number }[];
}

/**
 * 惡魔卡对設施：敌意同怪獸式（等级 × 30 × 物价指数，无主不记），
 * 再单个夷平（level=0、type=0 退回公園）。
 *
 * @source VA 0x004437a7（惡魔卡敌意段，与怪獸卡同式）
 *   + VA 0x0040ac5e（mutate mode 2 設施分支）；
 *   尾部的 `call 0x40dffa` 是表现层刷新，core 无可落副作用。
 */
export function applyDevilFacilityCard(
  facility: FacilityInfo,
  priceIndex: number,
  currentPlayer: number,
): DevilFacilityResult {
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
  return { ok: out.changed, facility: out.facility, hostilityDeltas };
}

export interface DemolishFacilityResult {
  ok: boolean;
  facility: FacilityInfo;
  /** 平坦敌意：30 × 物价指数（不按等级），无主不记 */
  hostilityDelta: number;
  /** 被拆设施原主（玩家下标）；无主时为 -1 */
  victim: number;
}

/**
 * 拆除卡对設施：拆一级；拆到 0 级时种类归零（退回公園）。
 * 敌意与地块路径同样是**平坦 30 × 物价指数**（不按等级）。
 *
 * @source VA 0x00443cee..0x00443d1d（拆除卡設施段：
 *   `dec byte [fac+0x1a]`、0 级时 `mov byte [fac+0x18], 0`、
 *   敌意 `pi*30 → 0x40df69`、`cmp byte [fac+0x19], 0 / je 不记`）
 *   + mutate mode 0 設施分支（VA 0x0040abdb）
 */
export function applyDemolishFacilityCard(
  facility: FacilityInfo,
  priceIndex: number,
): DemolishFacilityResult {
  const out = mutateFacility(facility, MUTATE_DEMOLISH_ONE);
  const owned = facility.owner !== 0;
  return {
    ok: out.changed,
    facility: out.facility,
    hostilityDelta: owned ? priceIndex * 30 : 0,
    victim: owned ? facility.owner - 1 : -1,
  };
}
