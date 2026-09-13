/*
 * 卡片目标：类型定义与合法性校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 架构决定：**目标选择是 UI 行为，不进 core。**
 *
 * 原版的选择函数 `0x446ae8` 只是把窗口过程 `0x445e4d` 交给模态消息循环
 * （`0x4018e7`）。该窗口过程按消息 id 分派 —— 0x200 WM_MOUSEMOVE、
 * 0x202 WM_LBUTTONUP、0x00f WM_PAINT、0x113 WM_TIMER 等 —— 是彻头彻尾的
 * 鼠标拾取 UI，没有游戏规则。
 *
 * 因此按 C-ARC-2（逻辑与表现严格分离）与 C-ARC-4（action 不区分来源）：
 *   - 目标由**外部**（人类 UI 或 AI）决定，作为 action 参数传入
 *   - core 只负责**校验目标是否合法**，以及执行效果
 * 这样本地玩家、远程玩家、AI 产出的 action 在引擎看来完全一样，
 * 联机无需为「谁在选目标」做任何特殊处理。
 *
 * 原版把选择结果表示为**位集合**（`selected_player_bitset`），
 * 再用 CTZ 取下标 —— 见 `asm/rich4_card_zhuanxiangka.c` 的
 * `count_trailing_zero_u8(...)`。本模块保留该表示以便比对。
 */

/** 卡片目标 */
export type CardTarget =
  /** 指向某个玩家 */
  | { kind: 'player'; index: number }
  /** 指向某块地（住宅/设施/企业，用实体 id 表示） */
  | { kind: 'entity'; entityId: number }
  /** 该卡不需要目标 */
  | { kind: 'none' };

/**
 * 目标类别 —— 由卡片的选择参数 `0xe0c0XYZ` 归纳得出。
 *
 * ⚠️ 参数的**逐位含义未证实**，这里只按实测分组归类。
 * 依据见 `packages/data/src/card-registry.ts` 的 SELECTION_GROUPS。
 */
export type TargetClass =
  /** 任意玩家，**含自己** —— 0xe0c0010 */
  | 'anyPlayer'
  /** 玩家 —— 0xe0c0410 / 0xe0c0710 */
  | 'player'
  /** 地块 —— 0xe0c0202 / 0xe0c0006 / 0xe0c0506 / 0xe0c0626 */
  | 'land'
  | 'none';

/**
 * 由选择参数归类目标类别。
 *
 * @source 实测分组（card-registry.ts）：
 *   0xe0c0010 → 转向/停留/乌龟（**可对自己使用**，由 2026 版 C 的
 *               自我目标分支佐证）
 *   0xe0c0410 → 均贫/抢夺/查税/同盟
 *   0xe0c0710 → 梦游/陷害
 *   0xe0c0202 / 0006 / 0506 / 0626 → 各类地块
 */
export function targetClassOf(selectionParam: number | null): TargetClass {
  if (selectionParam === null) return 'none';
  switch (selectionParam) {
    case 0xe0c0010:
      return 'anyPlayer';
    case 0xe0c0410:
    case 0xe0c0710:
      return 'player';
    case 0xe0c0202:
    case 0xe0c0006:
    case 0xe0c0506:
    case 0xe0c0626:
      return 'land';
    default:
      // 未登记的参数：保守起见按「需要目标但类别未知」处理
      return 'none';
  }
}

export type TargetError =
  | 'targetRequired'
  | 'targetNotAllowed'
  | 'wrongTargetKind'
  | 'playerOutOfRange'
  | 'cannotTargetSelf';

/**
 * 校验目标是否合法。
 *
 * @param cls           该卡的目标类别
 * @param target        外部给出的目标
 * @param currentPlayer 出牌者下标
 * @param playerCount   玩家总数
 */
export function validateTarget(
  cls: TargetClass,
  target: CardTarget,
  currentPlayer: number,
  playerCount = 4,
): TargetError | null {
  if (cls === 'none') {
    return target.kind === 'none' ? null : 'targetNotAllowed';
  }
  if (target.kind === 'none') return 'targetRequired';

  if (cls === 'land') {
    return target.kind === 'entity' ? null : 'wrongTargetKind';
  }

  // anyPlayer / player
  if (target.kind !== 'player') return 'wrongTargetKind';
  if (target.index < 0 || target.index >= playerCount) return 'playerOutOfRange';
  // 只有 anyPlayer 允许指向自己
  if (cls === 'player' && target.index === currentPlayer) return 'cannotTargetSelf';
  return null;
}

// ============================================================
//  位集合表示（与原版对齐）
// ============================================================

/**
 * 原版把选择结果表示为位集合：bit i 置位表示选中第 i 项，
 * 再用 CTZ 取出下标。
 * @source asm/rich4_card_zhuanxiangka.c `count_trailing_zero_u8(bitset)`
 */
export function bitsetOf(index: number): number {
  return 1 << index;
}

/**
 * 取位集合中最低置位的下标（等价于原版的 CTZ）。
 * @returns 下标；位集合为 0 时返回 -1（原版此时不会走到这里，
 *          因为调用方先判过 `test ebx, ebx / je end`）
 */
export function indexOfBitset(bitset: number): number {
  if (bitset === 0) return -1;
  let i = 0;
  let b = bitset;
  while ((b & 1) === 0) {
    b >>>= 1;
    i++;
  }
  return i;
}

/** 选择被取消（位集合为 0）—— 原版此时**不消耗卡片**并返回 0 */
export function isCancelled(bitset: number): boolean {
  return bitset === 0;
}
