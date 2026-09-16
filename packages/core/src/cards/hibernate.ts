/*
 * 冬眠卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py card 15`
 *   函数 VA 0x004440ea
 */

import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import type { SpecialActor } from '../rules/special-actors.ts';

/** 冬眠天数 @source `mov dh, 5` / `mov byte [esi+0x36], dh` */
export const HIBERNATE_DAYS = 5;

/**
 * 敌意增量的物价指数系数。
 *
 * @source VA 0x00444170 处的移位序列：
 * ```asm
 * mov edx, [price_index]
 * mov eax, edx / shl eax, 2 / add eax, edx   ; pi*5
 * add eax, eax                                ; pi*10
 * mov edx, eax                                ; edx = pi*10
 * shl eax, 4                                  ; pi*160
 * sub eax, edx                                ; ★ pi*150
 * ```
 */
export const HIBERNATE_HOSTILITY_FACTOR = 150;

export interface HibernateResult {
  players: Player[];
  hostilityDeltas: { from: number; to: number; delta: number }[];
  /** 实际被冬眠的玩家下标 */
  affected: number[];
}

/**
 * 原版冬眠卡对替身那一条支路覆盖哪些槽 —— **只有四大惡人 0..3**。
 *
 * @source `rich4_card_dongmianka.asm:36-40 与 :86-92`：
 * ```asm
 * 00444136  mov dh, 5
 * 00444138  inc ebx
 *           cmp ebx, 8
 *           jge near loc_004441c9        ; ★ 到 8 就收工 ⇒ ebx 只到 7
 *           cmp ebx, 4
 *           jge loc_004441a9             ; ★ ebx >= 4 → 替身那一支
 * loc_004441a9:
 *           mov eax, ebx
 *           shl eax, 4                   ; 记录步长 16
 *           mov ch, [eax + 0x498df2]     ; +10 = 在不在盘上
 *           test ch, ch
 *           jne loc_00444138             ; 不在盘上 → 跳过
 *           mov [eax + 0x498df5], ch     ; ★ +13（夢遊）清 0
 *           mov [eax + 0x498df4], dh     ; ★ +12（冬眠）= 5
 * ```
 * ⇒ 与玩家的那一支**同构**：先清梦游、再置冬眠。故冬眠卡也是「夢遊卡的反面」。
 */
export const HIBERNATE_ACTOR_SLOTS: readonly number[] = [0, 1, 2, 3];

/**
 * 把**在盘上的四大惡人**置入冬眠。
 *
 * `+12`（`hibernating`）= 5、`+13`（`sleepwalkDays`）清 0；
 * 不在盘上（監獄/醫院/未出场）的跳过 —— 原版那条 `jne` 就是这个意思。
 *
 * ★ 渲染那边正是用 `+12` 把替身画成灰的
 *   （@source `rich4.asm:1533` `cmp byte [eax + 0x498e34], 0`，
 *   `0x498e34` = 记录基址 `0x498e28` + 12）——
 *   见 `client/render.ts` 的 `isActorAsleep`。
 */
export function hibernateActors(actors: readonly SpecialActor[]): {
  actors: SpecialActor[];
  affected: number[];
} {
  const out = [...actors];
  const affected: number[] = [];
  for (const slot of HIBERNATE_ACTOR_SLOTS) {
    const a = out[slot];
    if (a === undefined) continue;
    // @source cmp byte [eax + 0x498df2], 0 / jne 跳过（+10 == 0 才在盘上）
    if (a.place !== 0 || a.nodeId <= 0) continue;
    affected.push(slot);
    out[slot] = { ...a, hibernating: HIBERNATE_DAYS, sleepwalkDays: 0 };
  }
  return { actors: out, affected };
}

/**
 * 冬眠卡：让**其他所有**在场玩家冬眠 5 天。
 *
 * 原版逐条判断（VA 0x00444147 起）：
 * ```asm
 * cmp ebx, [current_player] / je skip        ; ★ 不影响自己
 * cmp byte [player + 0x15], 0 / je skip      ; 出局者跳过
 * cmp word [player + 0x08], 0 / je skip      ; ★ xpos == 0 跳过
 * cmp dword [player + 0x32], 0 / jne skip    ; ★ 已被阻碍者跳过
 * update_hostility(i, current, price_index * 150)
 * mov byte [player + 0x37], 0                ; 梦游清零
 * mov byte [player + 0x36], 5                ; 冬眠 5 天
 * add byte [player + 0x42], 5                ; 冬眠天数累计 += 5
 * ```
 *
 * 注意 `dword [player + 0x32]` 一次覆盖住宿/消失/坐牢/住院四个字节，
 * 即**任一阻碍状态存在就跳过**（与 `isBlocked` 的前四项一致，但
 * **不含** `days_sleeping`）。
 *
 * ★ 顺带佐证：`+0x42` 确为 `total_winter_sleep_days`（冬眠天数累计），
 *   此处随冬眠同步 +5。原先对该字段命名的怀疑（Q15）不成立。
 */
export function applyHibernateCard(
  players: readonly Player[],
  currentPlayer: number,
  priceIndex: number,
): HibernateResult {
  const delta = priceIndex * HIBERNATE_HOSTILITY_FACTOR;
  const hostilityDeltas: { from: number; to: number; delta: number }[] = [];
  const affected: number[] = [];

  const next = players.map((p, i) => {
    if (i === currentPlayer) return p; // 不影响自己
    if (!isAlive(p)) return p;
    // @source cmp word [player+0x08], 0 / je skip
    if (p.xpos === 0) return p;
    // @source cmp dword [player+0x32], 0 / jne skip —— 覆盖住宿/消失/坐牢/住院
    const b = p.blocking;
    if (b.inHotel !== 0 || b.disappearing !== 0 || b.inPrison !== 0 || b.inHospital !== 0) {
      return p;
    }

    hostilityDeltas.push({ from: i, to: currentPlayer, delta });
    affected.push(i);
    return {
      ...p,
      blocking: { ...b, sleeping: HIBERNATE_DAYS, sleepWalking: 0 },
      totalWinterSleepDays: p.totalWinterSleepDays + HIBERNATE_DAYS,
    };
  });

  return { players: next, hostilityDeltas, affected };
}
