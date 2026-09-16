/*
 * 上市企业的持股排名与归属
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 逐行翻译 `_rich4_update_commercial_owner` @ VA 0x004294d5。
 *
 *   企业记录里有两个字段管这件事：
 *   - `+0x18`  **拥有者**（玩家下标 + 1，0 表示无主）
 *   - `+0x1c..+0x1f`  **持股排名表**，4 项，存玩家下标 + 1，0 表示空位
 *
 *   每次**持股变动**（买或卖）后都会调它一次，把那名玩家从排名表里摘掉再按
 *   持股数插回去，最后**排名第一的人就是这家公司的老板**。
 *
 * ★ **买入与卖出都会调** —— 两个函数的尾部各有一条
 *   `call _rich4_update_commercial_owner`：
 *   - 买入：`_rich4_buy_stock` VA 0x00428d2a → 0x00428e14
 *   - 卖出：`_rich4_sell_stock` VA 0x00428e23 → **0x00428eb7**
 *     （`rich4_stocks.asm:214-219`）
 *   所以卖光股票（或卖到不再第一）**当场**就让出企业归属。
 *
 * ⚠️ 本文件先前写着「卖出不调用它、这看着像原版的疏漏，但照搬」——
 *   那是把 `rich4_stocks.asm` 的 `call` 读漏了（2026-09-16 订正，
 *   调用点补在 `state/reduce.ts` 的 `tradeStock` 卖出分支）。
 */

/** 排名表的长度 @source `cmp eax, 4 / jge` 与 `mov ecx, 2` 起的倒序循环 */
export const RANK_SLOTS = 4;

/** 一家企业里与归属相关的状态 */
export interface CommercialOwnership {
  /** 拥有者：玩家下标 + 1，0 表示无主 @source commercial +0x18 */
  owner: number;
  /** 持股排名，4 项，值为玩家下标 + 1，0 表示空位 @source commercial +0x1c..+0x1f */
  ranking: number[];
}

export function emptyOwnership(): CommercialOwnership {
  return { owner: 0, ranking: new Array<number>(RANK_SLOTS).fill(0) };
}

export interface UpdateResult {
  ownership: CommercialOwnership;
  /** 归属是否易主 —— 原版靠这个返回值决定要不要刷新显示 */
  changed: boolean;
}

/**
 * 某人买入之后，重排这家企业的持股名次。
 *
 * @source VA 0x004294d5 全文：
 * ```asm
 * ; ① 先把该玩家从排名表里摘掉
 * for (ecx = 0; ecx < 4; ecx++)
 *     if (com[0x1c + ecx] == player + 1) {
 *         memcpy(&com[0x1c+ecx], &com[0x1c+ecx+1], 3 - ecx)   ; 后面的前移
 *         com[0x1f] = 0
 *         break
 *     }
 *
 * ; ② 按持股数插回去（从末位往前找插入点）
 * if (我的持股 != 0) {
 *     插入位 = 0
 *     for (ecx = 2; ecx >= 0; ecx--) {
 *         if (com[0x1c + ecx] == 0) continue          ; 空位跳过
 *         if (对方持股 < 我的持股) com[0x1d + ecx] = com[0x1c + ecx]   ; 对方后移
 *         else { 插入位 = ecx + 1; break }
 *     }
 *     com[0x1c + 插入位] = player + 1
 * }
 *
 * ; ③ 排名第一者即老板
 * if (com[0x18] != com[0x1c]) { com[0x18] = com[0x1c]; 刷新; return 1 }
 * return 0
 * ```
 *
 * @param sharesOf 取某玩家在这支股票上的持股数
 */
export function updateCommercialOwner(
  prev: CommercialOwnership,
  buyer: number,
  sharesOf: (playerIndex: number) => number,
): UpdateResult {
  const ranking = [...prev.ranking];
  const code = buyer + 1;

  // ① 摘掉
  // @source for (ecx=0; ecx<4; ecx++) … memcpy 前移 + [0x1f] = 0
  const at = ranking.indexOf(code);
  if (at >= 0) {
    for (let i = at; i < RANK_SLOTS - 1; i++) ranking[i] = ranking[i + 1]!;
    ranking[RANK_SLOTS - 1] = 0;
  }

  // ② 插回
  const mine = sharesOf(buyer);
  if (mine !== 0) {
    // @source mov ecx, 2 —— 从倒数第二个槽开始往前扫
    let insertAt = 0;
    for (let i = RANK_SLOTS - 2; i >= 0; i--) {
      const other = ranking[i] ?? 0;
      // @source test dl,dl / je —— 空位跳过，继续往前
      if (other === 0) continue;
      if (sharesOf(other - 1) < mine) {
        // @source mov [eax+0x1d], dl —— 对方名次后移一位
        ranking[i + 1] = other;
      } else {
        // @source inc ecx —— 就插在他后面
        insertAt = i + 1;
        break;
      }
    }
    ranking[insertAt] = code;
  }

  // ③ 第一名即老板
  const owner = ranking[0] ?? 0;
  return {
    ownership: { owner, ranking },
    // @source cmp al, dh / je —— 相等就没易主
    changed: owner !== prev.owner,
  };
}

/** 这家企业归谁；-1 表示无主 */
export function ownerOf(o: CommercialOwnership): number {
  return o.owner === 0 ? -1 : o.owner - 1;
}
