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

/** 卡片目标（REQ-06.1 / REQ-05.1 扩后，与 PRD §4.2 一致） */
export type CardTarget =
  /**
   * 指向某个玩家。
   * `steal` 仅搶奪卡（13）使用：抢什么由外部（UI/AI）选定（C-ARC-2），
   * 原版是模态选单 `0x004018e7`；缺省时 registry 拒收（targetRequired）。
   */
  | {
      kind: 'player';
      index: number;
      steal?: { kind: 'card' | 'tool'; id: number };
    }
  /** 指向某块地（住宅/连锁店，用实体 id 表示） */
  | { kind: 'entity'; entityId: number }
  /**
   * 指向某个設施（公園/旅館/購物中心/加油站/研究所），id 1 基。
   * `buildType` 仅天使卡（9）首建（level==0）时使用：要建的设施种类，
   * 由外部选定（C-ARC-2）——AI 自己有钱时 `rand()%4+1`、对別人给 0（公園）、
   * 真人走 UI 选择器（VA 0x00440aac）；缺省 0 = 公園。
   */
  | { kind: 'facility'; facilityId: number; buildType?: number }
  /** 指向某支股票（紅/黑卡），下标 0 基，与 commercial.stockIndex 对齐 */
  | { kind: 'stock'; index: number }
  /** 指向某个物件（請神符），下标 1 基（原版物件 handle = 下标 + 1） */
  | { kind: 'object'; objectIndex: number }
  /**
   * 指向特殊棋子（REQ-05.1）：四大惡人 4..7（小偷/強盜/流氓/間諜）、
   * 機器娃娃 8 —— 即 `state.specialActors[actor - 4]`
   */
  | { kind: 'actor'; actor: number }
  /** 指向某个棋盘格（放置类道具：路障/地雷/定時炸彈），nodeId 1 基 */
  | { kind: 'node'; nodeId: number }
  /** 该卡不需要目标 */
  | { kind: 'none' };

/** 特殊棋子的合法编号区间（REQ-05.1） @source PRD §4.2 */
export const ACTOR_MIN = 4;
export const ACTOR_MAX = 8;

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
  /** 地块（仅住宅/连锁店）—— 0xe0c0202 换地/换屋 */
  | 'land'
  /**
   * 地块**或設施** —— 0xe0c0006（天使/惡魔/漲價/查封）、
   * 0xe0c0506（怪獸）、0xe0c0626（拆除）。
   * @source REQ-06.1：这些卡按原版同样作用于設施
   */
  | 'landOrFacility'
  /** 股票 —— 紅卡/黑卡（selection 'ai'，无 selectionParam） */
  | 'stock'
  /** 物件 —— 請神符（selection 'ai'，无 selectionParam） */
  | 'object'
  /** 玩家或特殊棋子 —— REQ-05.1 控制类卡对四大惡人/機器娃娃 */
  | 'playerOrActor'
  | 'none';

/**
 * 由选择参数归类目标类别。
 *
 * @source 实测分组（card-registry.ts）：
 *   0xe0c0010 → 转向/停留/乌龟（**可对自己使用**，由 2026 版 C 的
 *               自我目标分支佐证）
 *   0xe0c0410 → 均贫/抢夺/查税/同盟
 *   0xe0c0710 → 梦游/陷害
 *   0xe0c0202 → 换地/换屋（仅住宅/连锁店）
 *   0xe0c0006 / 0506 / 0626 → 天使/惡魔/漲價/查封/怪獸/拆除
 *               （REQ-06.1：按原版同样作用于設施 → landOrFacility）
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
      // 换地/换屋只认住宅/连锁店（換的是房契），不认設施
      return 'land';
    case 0xe0c0006:
    case 0xe0c0506:
    case 0xe0c0626:
      // @source REQ-06.1：天使/惡魔/漲價/查封/怪獸/拆除按原版同样作用于設施
      return 'landOrFacility';
    default:
      // 未登记的参数：保守起见按「需要目标但类别未知」处理
      return 'none';
  }
}

/**
 * 目标类别的**卡片级**判定。
 *
 * 紅卡/黑卡/請神符没有 selectionParam（选择不走 `0x446ae8`，原版只有
 * 电脑参数取值 `0x41e6f2`，登记为 selection 'ai'），光靠参数归不了类，
 * 必须按卡片本身判：
 *   - 請神符（23，VA 0x00444e1a）→ object
 *   - 紅卡（24，VA 0x00444f25）/ 黑卡（25，VA 0x0044503f）→ stock
 * 其余卡片一律按 selectionParam 归类（与 targetClassOf 相同）。
 */
export function targetClassOfCard(impl: {
  id: number;
  selection: 'none' | 'ui' | 'ai';
  selectionParam: number | null;
}): TargetClass {
  if (impl.selectionParam !== null) return targetClassOf(impl.selectionParam);
  if (impl.selection === 'ai') {
    if (impl.id === 23) return 'object';
    if (impl.id === 24 || impl.id === 25) return 'stock';
  }
  return 'none';
}

export type TargetError =
  | 'targetRequired'
  | 'targetNotAllowed'
  | 'wrongTargetKind'
  | 'playerOutOfRange'
  | 'cannotTargetSelf'
  | 'facilityOutOfRange'
  | 'stockOutOfRange'
  | 'objectOutOfRange'
  | 'actorOutOfRange';

/**
 * 目标校验的附加信息（可选）。
 * 缺省时不做对应的范围检查（与 'land' 类只校验种类一致）。
 */
export interface TargetLimits {
  /** 設施总数（facilityId 合法范围 1..facilityCount） */
  facilityCount?: number;
  /** 股票总数（stock 下标合法范围 0..stockCount-1） */
  stockCount?: number;
  /** 物件表长度（objectIndex 合法范围 1..objectCount） */
  objectCount?: number;
  /**
   * REQ-05.1：控制类卡（anyPlayer/player 类）是否允许指向
   * 特殊棋子（四大惡人/機器娃娃）。
   */
  allowActor?: boolean;
}

/** actor 编号是否合法（4..8：小偷/強盜/流氓/間諜/機器娃娃） */
function actorInRange(actor: number): boolean {
  return Number.isInteger(actor) && actor >= ACTOR_MIN && actor <= ACTOR_MAX;
}

/**
 * 校验目标是否合法。
 *
 * @param cls           该卡的目标类别
 * @param target        外部给出的目标
 * @param currentPlayer 出牌者下标
 * @param playerCount   玩家总数
 * @param extra         范围上限与 actor 闸门（见 TargetLimits）
 */
export function validateTarget(
  cls: TargetClass,
  target: CardTarget,
  currentPlayer: number,
  playerCount = 4,
  extra: TargetLimits = {},
): TargetError | null {
  if (cls === 'none') {
    return target.kind === 'none' ? null : 'targetNotAllowed';
  }
  if (target.kind === 'none') return 'targetRequired';

  switch (cls) {
    case 'land':
      return target.kind === 'entity' ? null : 'wrongTargetKind';

    case 'landOrFacility': {
      if (target.kind === 'entity') return null;
      if (target.kind !== 'facility') return 'wrongTargetKind';
      if (extra.facilityCount !== undefined) {
        if (!Number.isInteger(target.facilityId)
          || target.facilityId < 1
          || target.facilityId > extra.facilityCount) {
          return 'facilityOutOfRange';
        }
      }
      return null;
    }

    case 'stock': {
      if (target.kind !== 'stock') return 'wrongTargetKind';
      if (extra.stockCount !== undefined) {
        if (!Number.isInteger(target.index)
          || target.index < 0
          || target.index >= extra.stockCount) {
          return 'stockOutOfRange';
        }
      }
      return null;
    }

    case 'object': {
      if (target.kind !== 'object') return 'wrongTargetKind';
      if (extra.objectCount !== undefined) {
        if (!Number.isInteger(target.objectIndex)
          || target.objectIndex < 1
          || target.objectIndex > extra.objectCount) {
          return 'objectOutOfRange';
        }
      }
      return null;
    }

    case 'playerOrActor': {
      // REQ-05.1：控制类效果对玩家（含自己）或特殊棋子
      if (target.kind === 'actor') {
        return actorInRange(target.actor) ? null : 'actorOutOfRange';
      }
      if (target.kind !== 'player') return 'wrongTargetKind';
      if (target.index < 0 || target.index >= playerCount) return 'playerOutOfRange';
      return null;
    }

    case 'anyPlayer':
    case 'player': {
      // REQ-05.1：allowActor 时这两类也接受特殊棋子目标
      if (target.kind === 'actor') {
        if (extra.allowActor !== true) return 'wrongTargetKind';
        return actorInRange(target.actor) ? null : 'actorOutOfRange';
      }
      if (target.kind !== 'player') return 'wrongTargetKind';
      if (target.index < 0 || target.index >= playerCount) return 'playerOutOfRange';
      // 只有 anyPlayer 允许指向自己
      if (cls === 'player' && target.index === currentPlayer) return 'cannotTargetSelf';
      return null;
    }
  }
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
