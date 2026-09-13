/*
 * 敌意值
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py va 0x0040df69`
 *   原版签名：`void update_hostility(int a, int b, int delta)`
 *   —— 「玩家 a 对玩家 b 的敌意」增加 delta。
 *
 * 敌意驱动 AI 的针对性（打谁的卡、拒不交易等），是 M3 的必要前置。
 * 此前各张卡只是把敌意变化**记录**在结果里，本模块负责真正落到状态上。
 */

import type { Player } from '../state/types.ts';

/**
 * 敌意表在玩家结构体内的位置：`+0x4c`，**4 个 int**。
 *
 * @source `mov edi, dword [a*0x68 + b*4 + 0x496bb4]`
 *   （玩家数组基址 0x496b68，故 0x496bb4 = +0x4c）
 *
 * ★ 这从两侧共同证伪了 `rich4-re/asm/rich4_player_info.h` 的
 *   `hostility[6]`：本函数只按 `b*4` 寻址 4 个玩家，而紧随其后的
 *   +0x5c / +0x60 被 `pay_money` 当作本月支出/收入读写
 *   （见 rules/payment.ts）。两者相加恰好填满原先记成 6 项的空间。
 */
export const HOSTILITY_COUNT = 4;

export interface HostilityResult {
  players: Player[];
  /** 是否因敌意上升而解除了同盟 */
  allianceBroken: boolean;
}

/**
 * 更新「a 对 b」的敌意。
 *
 * 原版全文（VA 0x0040df69）：
 * ```asm
 * cmp edx, ebx / je end              ; ★ a == b 直接返回
 * cmp dword [esp+0x14], 0
 * jge 继续
 * cmp dword [a*0x68 + b*4 + 0x496bb4], 0
 * je  end                            ; ★ 负增量且当前已为 0 → 直接返回
 * 继续:
 * edi = hostility[a][b] + delta
 * hostility[a][b] = edi
 * test edi, edi / jge 跳过
 * hostility[a][b] = 0                ; ★ 下限 0
 * 跳过:
 * cmp dword [esp+0x14], 0 / jle end  ; 仅在**正增量**时继续
 * cl = byte [a + 0x41]               ; a 的同盟对象（下标 + 1）
 * cmp ecx, ebx + 1 / jne end
 * push edx / call 0x40cc1a           ; ★ 敌意上升会**解除同盟**
 * ```
 *
 * 那条「负增量且已为 0 就提前返回」的分支看似多余（下限逻辑本就会兜住），
 * 但它**跳过了同盟检查**——不过同盟检查只在正增量时才跑，所以两条路径
 * 结果一致。照搬是为了万一日后发现别的副作用。
 */
export function updateHostility(
  players: readonly Player[],
  a: number,
  b: number,
  delta: number,
): HostilityResult {
  const next = [...players];
  const pa = next[a];
  // @source cmp edx, ebx / je end
  if (a === b || pa === undefined || b < 0 || b >= HOSTILITY_COUNT) {
    return { players: next, allianceBroken: false };
  }

  const current = pa.hostility[b] ?? 0;
  // @source 负增量且当前为 0 → 直接返回
  if (delta < 0 && current === 0) {
    return { players: next, allianceBroken: false };
  }

  const raw = current + delta;
  const hostility = [...pa.hostility];
  // @source test edi,edi / jge / 置 0 —— 下限 0，无上限
  hostility[b] = raw < 0 ? 0 : raw;
  next[a] = { ...pa, hostility };

  // @source cmp dword [esp+0x14], 0 / jle end —— 只有正增量才会解盟
  if (delta > 0 && pa.alliedPlayer === b + 1) {
    return { players: breakAlliance(next, a), allianceBroken: true };
  }
  return { players: next, allianceBroken: false };
}

/**
 * 解除玩家 a 的同盟（双向清空）。
 *
 * @source VA 0x0040cc1a：
 * ```asm
 * byte [a + 0x3d] = 0                ; a.allied_days
 * edx = byte [a + 0x41] - 1          ; 对方下标
 * byte [partner + 0x41] = 0
 * byte [partner + 0x3d] = 0
 * byte [a + 0x41] = 0
 * ```
 */
export function breakAlliance(players: readonly Player[], a: number): Player[] {
  const next = [...players];
  const pa = next[a];
  if (pa === undefined || pa.alliedPlayer === 0) return next;

  const partnerIdx = pa.alliedPlayer - 1;
  const partner = next[partnerIdx];
  if (partner !== undefined) {
    next[partnerIdx] = { ...partner, alliedPlayer: 0, alliedDays: 0 };
  }
  next[a] = { ...pa, alliedPlayer: 0, alliedDays: 0 };
  return next;
}

/** 依次施加一组敌意变化（各卡产生的 hostilityDeltas） */
export function applyHostilityDeltas(
  players: readonly Player[],
  deltas: readonly { from: number; to: number; delta: number }[],
): Player[] {
  let next = [...players];
  for (const d of deltas) {
    next = updateHostility(next, d.from, d.to, d.delta).players;
  }
  return next;
}
