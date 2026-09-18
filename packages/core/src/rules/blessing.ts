/*
 * 神明加持：事件金额的倍率
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：VA 0x0044b896
 *
 * 新聞／命運事件在**施加阶段**先调用它拿一个倍率，再用它去乘金额。
 * 四条提示语把语义钉得很死：
 *
 * | 返回 | 奖金情形 | 罚金情形 |
 * |---|---|---|
 * | 2 | `%s保佑\n\n獎金加倍！` | `%s作祟\n\n罰金加倍！` |
 * | 1 | `%s作祟\n\n獎金作廢！` | `%s保佑\n\n免付罰金！` |
 * | 0 | （无提示） | （无提示） |
 *
 * ★ 所以返回值**不是「是否加倍」，而是倍率档位**：
 *   `0 → ×1`、`1 → ×0`、`2 → ×2`。
 *   对奖金 ×0 叫「作廢」，对罚金 ×0 叫「免付」——同一个机制，
 *   好坏只取决于钱的方向。提示语里的「保佑／作祟」也随之互换。
 */

import type { Player } from '../state/types.ts';

/** 倍率档位 */
export const BLESSING_NONE = 0;
/** 金额归零：奖金作廢 / 免付罚金 */
export const BLESSING_VOID = 1;
/** 金额加倍：奖金加倍 / 罚金加倍 */
export const BLESSING_DOUBLE = 2;

/**
 * 把档位翻译成实际倍率。
 * @source 施加阶段对返回值的用法：
 *   `cmp ecx, 2 / jne … / mov esi, [0x48c5b4] / add esi, esi`（×2）
 *   `cmp ecx, 1 / jne …`（该分支不再执行付款，等价于 ×0）
 */
export function blessingMultiplier(level: number): number {
  switch (level) {
    case BLESSING_DOUBLE:
      return 2;
    case BLESSING_VOID:
      return 0;
    default:
      return 1;
  }
}

/**
 * 决定倍率档位的阈值。
 *
 * @source VA 0x0044b8c1 起，读 `word [player + 0x46]`（**有符号**）：
 * ```asm
 * mov  si, word [player + 0x46]
 * cmp  si, 0x64          ; 100
 * jle  查50
 * mov  ebx, 2            ; ★ > 100 → 必定加倍
 * jmp  出口
 * 查50:
 * cmp  si, 0x32          ; 50
 * jle  查负
 * call rand
 * mov  ebx, eax / and ebx, 1 / add ebx, ebx   ; ★ 50..100 → 一半概率加倍
 * jmp  出口
 * 查负:
 * test si, si
 * jge  出口              ; 0..50 → 0，不变
 * mov  ebx, 1            ; ★ < 0 → 金额归零
 * ```
 */
export const BLESSING_DOUBLE_THRESHOLD = 100;
export const BLESSING_CHANCE_THRESHOLD = 50;

/**
 * 由玩家的加持值算出倍率档位。
 *
 * ⚠️ `50 < blessing <= 100` 这一档要掷一次随机数（`rand() & 1`），
 * 故本函数需要外部注入随机源——core 内禁止 `Math.random`（C-DET-1）。
 *
 * @param coinFlip `rand() & 1` 的结果，0 或 1
 */
export function blessingLevel(blessing: number, coinFlip: number): number {
  // @source cmp si, 100 / jle …
  if (blessing > BLESSING_DOUBLE_THRESHOLD) return BLESSING_DOUBLE;
  // @source cmp si, 50 / jle … / rand & 1 / ×2
  if (blessing > BLESSING_CHANCE_THRESHOLD) return (coinFlip & 1) * 2;
  // @source test si,si / jge 出口 —— 只有**负值**才归零
  if (blessing < 0) return BLESSING_VOID;
  return BLESSING_NONE;
}

// ============================================================
//  三条调用形态
// ============================================================

/**
 * 原版这个函数收**两个开关**，合起来是三种用法。
 *
 * @source `callers 0x44b896` 的 15 处调用点，只出现三种压栈组合，
 *   与函数头的两级分派一一对应：
 * ```asm
 * cmp dword [esp+0x14], 0 / jne 0x44b9d3   ; arg0 → 读 +0x48 福運
 * cmp dword [esp+0x18], 0 / jne 0x44b94b   ; arg1 → 读 +0x46，罰金口吻
 *                                          ; 都为 0 → 读 +0x46，獎金口吻
 * ```
 *
 * | 组合 | 读哪个字段 | 高值 → | 低值 → | 提示语 |
 * |---|---|---|---|---|
 * | `(0,0)` 獎金 | `+0x46` 財運 | 2 加倍 | 1 作廢 | 獎金加倍／獎金作廢 |
 * | `(0,1)` 罰金 | `+0x46` 財運 | 1 免付 | 2 加倍 | 免付罰金／罰金加倍 |
 * | `(1,1)` 劫难 | `+0x48` 福運 | 1 逃過 | 2 加倍 | 逃過此劫／倒霉加倍 |
 *
 * ★ **注意后两种的档位是反的**：字段值越高越好，而「好」对罚金
 *   意味着 ×0、对奖金意味着 ×2。原版就是在这两个分支里把
 *   `mov ebx, 2` 与 `mov ebx, 1` 对调实现的，不是另算一套。
 *
 * ⚠️ 先前本模块只实现了 `(0,0)` 一种，把它当成通用规则。
 *   直接拿去算罚金会**恰好算反**——财神附身反而让你多付一倍。
 */
export type BlessingKind =
  /** 獎金：財運高 → 加倍 */
  | 'reward'
  /** 罰金：財運高 → 免付 */
  | 'penalty'
  /** 劫难：福運高 → 逃過 */
  | 'misfortune';

/** 该用法读玩家的哪个字段 */
export function blessingFieldOf(p: Player, kind: BlessingKind): number {
  // @source arg0 != 0 → word [player + 0x48]
  return kind === 'misfortune' ? p.luck : p.fortune;
}

/**
 * 按用法算出倍率档位。
 *
 * `reward` 直接沿用 `blessingLevel`；另外两种把 1 与 2 对调。
 * @source 0x44b94b / 0x44b9d3 两段与 0x44b8c1 逐条同构，
 *   只有 `mov ebx, 1` / `mov ebx, 2` 互换。
 */
export function blessingLevelFor(value: number, coinFlip: number, kind: BlessingKind): number {
  const level = blessingLevel(value, coinFlip);
  if (kind === 'reward') return level;
  // @source 高值分支 mov ebx,1；低值分支 mov ebx,2 —— 与 reward 正好相反
  if (level === BLESSING_DOUBLE) return BLESSING_VOID;
  if (level === BLESSING_VOID) return BLESSING_DOUBLE;
  return BLESSING_NONE;
}

/**
 * 从玩家身上取值并算出**倍率档位** —— 随机数**按需**消费。
 *
 * ★ 这是引擎**唯一该用**的入口（先前的 `playerBlessingMultiplier(p, coinFlip, kind)`
 *   已删：它要求调用方**先算好 `coinFlip`**，而「先算」就意味着**无条件掷一次** ——
 *   第 37 条踩过这个坑：每一次带神明加持的命運事件都让随机序列多走一步，
 *   之后所有随机事件整体错位）。
 *
 * @source `0x0044b8c1` 的分档：`cmp si,0x64 / jle 查50`（> 100 直接定档、**不掷**）
 *   → `cmp si,0x32 / jle 查负`（≤ 50 也**不掷**）⇒ 只有 `50 < 加持值 ≤ 100`
 *   才 `call 0x456f2d` 掷一次。
 *
 * @param draw 掷一次 `rand()&1`；**只在中间档被调用一次**，其余档一次都不调
 */
export function blessingLevelWithDraw(p: Player, kind: BlessingKind, draw: () => number): number {
  const value = blessingFieldOf(p, kind);
  // 其余两档传 0 是安全的：`blessingLevel` 在这两档里根本不看 coinFlip
  if (value > BLESSING_DOUBLE_THRESHOLD) return blessingLevelFor(value, 0, kind);
  if (value > BLESSING_CHANCE_THRESHOLD) return blessingLevelFor(value, draw() & 1, kind);
  return blessingLevelFor(value, 0, kind);
}
