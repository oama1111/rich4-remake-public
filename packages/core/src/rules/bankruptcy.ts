/*
 * 付款与破产
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source rich4-re/asm/rich4_player_core_actions.asm:5088-5120（付款级联与破产触发）
 * @source rich4-re/asm/rich4_player_bankrupt.asm `_rich4_player_bankrupt` @ VA 0x0040cd87
 */

import type { Player } from '../state/types.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import { debitPlayer } from './payment.ts';

// ============================================================
//  付款级联
// ============================================================

export interface PaymentResult {
  player: Player;
  /** 实际支付出去的金额（可能少于要求金额，此时玩家破产） */
  paid: number;
  /** 未能支付的差额 */
  shortfall: number;
  /** 是否因此破产 */
  bankrupt: boolean;
}

/**
 * 向玩家收取一笔钱。
 *
 * 原版级联：**先扣现金，不足则扣存款，两者都不足即破产**。
 * 贷款额度**不会**被自动动用来抵付。
 *
 * @source loc_0041d33d:
 * ```asm
 * edx = cash - amount;  cash = edx
 * if (edx >= 0) done;                  ; 现金够
 * money_in_bank += edx;  cash = 0      ; edx 为负，即从存款扣
 * if (money_in_bank >= 0) done;        ; 存款够
 * remaining += money_in_bank
 * money_in_bank = 0
 * player_bankrupt()                    ; ★ 破产
 * ```
 */
export function payMoney(player: Player, amount: number): PaymentResult {
  if (amount <= 0) return { player, paid: 0, shortfall: 0, bankrupt: false };

  // ★ 级联本身由 rules/payment.ts 的 debitPlayer 唯一实现，
  //   本函数只是「单方扣款」这一常见场景的便捷包装。
  //   `monthlyPaid` 的累计**不在**此处发生——那属于 transferMoney 的职责。
  const out = debitPlayer(player.cash, player.moneyInBank, amount, false);
  return {
    player: { ...player, cash: out.cash, moneyInBank: out.bank },
    paid: out.paid,
    shortfall: amount - out.paid,
    bankrupt: out.bankrupted,
  };
}

/** 玩家是否已无力支付该金额（不改动状态的纯判定） */
export function canAfford(player: Player, amount: number): boolean {
  return player.cash + player.moneyInBank >= amount;
}

// ============================================================
//  破产处置
// ============================================================

/**
 * 节点占位标记：玩家 i 对应 flags 的 bit (8 + i)。
 *
 * @source rich4_player_bankrupt.asm:84-86
 * ```asm
 * mov ebx, 0x100
 * shl ebx, cl              ; cl = playerIdx
 * or dword [node + 0x24], ebx
 * ```
 * 这解释了 `OCCUPIED_MASK = 0x80ffff00` 中 bits 8-23 的用途。
 */
export function playerOccupancyBit(playerIndex: number): number {
  return 0x100 << playerIndex;
}

/**
 * 破产时被清零的玩家字段范围。
 *
 * @source rich4_player_bankrupt.asm:172-180
 * ```asm
 * eax = &player + 0x1c
 * memset(eax, 0, 0x68 - 0x1c)      ; 清零 0x1c .. 0x67
 * ```
 * **0x00–0x1b 被保留**：角色编号、坐标、所在节点、骰子数、性别等。
 * 这正是原版存档中已出局玩家仍带有角色编号的原因。
 */
export const BANKRUPT_CLEAR_FROM = 0x1c;

/**
 * 把玩家置为破产状态。
 *
 * 仅对应原版的 `who_plays = 0` 与 `memset(player + 0x1c, 0, 0x4c)`。
 *
 * ⚠️ **不清空手牌与道具**。它们不在玩家结构体内，而是两个独立的全局数组
 * （`rich4_player_cards[60]` / `rich4_player_tool_amount[60]`，
 * 存档偏移 0x654 / 0x690），memset 碰不到。原版是靠
 * `_rich4_player_sell_all_the_card` / `sell_all_tools` **变卖**掉的，
 * 而那两步只在「非终局」路径上执行（见 `resolveBankruptcyOutcome`）。
 *
 * 实证：`Save0.dat` 中最后破产的玩家 0 仍持有 2 张手牌。
 */
export function markPlayerBankrupt(player: Player): Player {
  return {
    ...player,
    // who_plays = 0 → 出局 @source mov byte [player+21], 0
    whoPlays: 0,
    // 以下对应 memset(player + 0x1c, 0, 0x4c)
    cash: 0,
    moneyInBank: 0,
    loan: 0,
    specialFinance: 0,
    f44: 0,
    points: 0,
    blocking: {
      inHotel: 0,
      disappearing: 0,
      inPrison: 0,
      inHospital: 0,
      sleeping: 0,
      sleepWalking: 0,
      stopping: 0,
      tortoiseWalking: 0,
    },
    daysRejectedByBank: 0,
    godInfo: 0,
    f64: 0,
    totalWinterSleepDays: 0,
    alliedPlayer: 0,
    alliedDays: 0,
    // +0x46（加持）、+0x4c（敌意）与 +0x5c / +0x60 同在 memset 区间内
    savedTrafficMethod: 0,
    savedNdices: 0,
    misfortune: 0,
    fortune: 0,
    luck: 0,
    hostility: [0, 0, 0, 0],
    monthlyPaid: 0,
    monthlyReceived: 0,
    // 保留：index / character / nodeId / lastNodeId / direction / ndices
    // 保留：cards / tools（不在结构体内，见上方说明）
  };
}

// ============================================================
//  破产的两条路径
// ============================================================

/**
 * 破产处理的结果分支。
 *
 * @source rich4_player_bankrupt.asm:276-307
 * ```asm
 * test esi, esi            ; esi = 破产后剩余在场人数
 * jne  ...
 * mov byte [0x46caf8], 1   ; 全员出局 → 结束码 1，**跳过清算**
 * jmp end
 * cmp eax, 1
 * jne  loc_0040d089        ; 剩余 > 1 人 → 正常清算 + 拍卖
 * ; 只剩 1 人：
 * player_say(赢家胜利台词)
 * [0x46caf8] = (num_human_players == 1) ? 2 : 3   ; **同样跳过清算**
 * ```
 *
 * 也就是说：**当破产导致对局结束时，地产清算与拍卖被整个跳过**，
 * 破产者名下的地产原样留在地图上。
 *
 * 实证（`Save0.dat`）：
 * - 玩家 2、3 先破产 → 走正常路径 → 名下 0 地产、0 手牌
 * - 玩家 0 最后破产、只剩玩家 1 → 走终局路径 → **仍持有 10 块地与 2 张牌**
 */
export type BankruptcyOutcome =
  | { kind: 'liquidate' }
  | { kind: 'gameOver'; code: 1 | 2 | 3 };

/** 对局结束码 @source ref_0046caf8 */
export const GAME_OVER_ALL_OUT = 1;
export const GAME_OVER_SINGLE_HUMAN = 2;
export const GAME_OVER_MULTI_HUMAN = 3;

/**
 * 判定破产后走哪条路径。
 *
 * @param remainingAlive  该玩家出局**之后**仍在场的人数
 * @param numHumanPlayers 本局的人类玩家数 `_num_human_players`
 */
export function resolveBankruptcyOutcome(
  remainingAlive: number,
  numHumanPlayers: number,
): BankruptcyOutcome {
  if (remainingAlive === 0) return { kind: 'gameOver', code: GAME_OVER_ALL_OUT };
  if (remainingAlive > 1) return { kind: 'liquidate' };
  return {
    kind: 'gameOver',
    code: numHumanPlayers === 1 ? GAME_OVER_SINGLE_HUMAN : GAME_OVER_MULTI_HUMAN,
  };
}

/** 破产清算中被释放的一件资产 */
export interface ReleasedAsset {
  kind: 'land' | 'facility' | 'commercial';
  /** 表内下标（1 基） */
  index: number;
  /** 实体 id：住宅 2000+i，设施 4000+i @source add edi, 0x7d0 / 0xfa0 */
  entityId: number;
}

/** 实体 id 基数 @source rich4_player_bankrupt.asm:325 / 350 */
export const ENTITY_BASE_LAND = 0x7d0; // 2000
export const ENTITY_BASE_FACILITY = 0xfa0; // 4000

/**
 * 释放破产玩家名下的全部地产。
 *
 * ⚠️ 三点易错细节：
 * 1. **只清 `owner`，不动 `level`** —— 房子原样保留，随后进入拍卖。
 * 2. **上市企业的 owner 字段在 `0x18`**，而住宅/设施在 `0x19`。
 * 3. 住宅与设施会被收集成实体 id 列表交给拍卖流程；上市企业不进拍卖。
 *
 * @source rich4_player_bankrupt.asm:308-372
 * @returns 被释放的资产列表（供拍卖流程使用），以及更新后的表
 */
export function releaseAssets(
  playerIndex: number,
  lands: readonly LandInfo[],
  facilities: readonly FacilityInfo[],
): {
  lands: LandInfo[];
  facilities: FacilityInfo[];
  released: ReleasedAsset[];
} {
  const ownerId = playerIndex + 1;
  const released: ReleasedAsset[] = [];

  const newLands = lands.map((l) => {
    if (l.owner !== ownerId) return l;
    released.push({ kind: 'land', index: l.id, entityId: l.id + ENTITY_BASE_LAND });
    // 只清归属，等级保留 @source mov byte [eax+0x19], 0
    return { ...l, owner: 0, flast: 0 };
  });

  const newFacilities = facilities.map((f) => {
    if (f.owner !== ownerId) return f;
    released.push({ kind: 'facility', index: f.id, entityId: f.id + ENTITY_BASE_FACILITY });
    return { ...f, owner: 0 };
  });

  return { lands: newLands, facilities: newFacilities, released };
}
