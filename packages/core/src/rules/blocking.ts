/*
 * 阻碍状态的每日递减
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：VA 0x0041c8d5 起，对每名玩家逐项处理。
 *
 * ⚠️ 本模块纠正了一个此前的错误模型。先前以为「高位 0x80 是标志位，
 * 递减时只动低 7 位」——**不是**。真实语义是一个两段式状态机：
 *
 * ```asm
 * d = counter
 * test d, 0x80
 * jne  → call 释放函数(player)        ; ★ 高位已置 = 刑满，今天放出来
 * test d, d / je 跳过                  ; 为 0 = 本就不在该状态
 * dec  d                               ; ★ 整字节递减，不做掩码
 * counter = d
 * jne  跳过                            ; 减完还没到 0 → 继续关着
 * counter = d | 0x80                   ; ★ 减到 0 → 置高位，等下一次放人
 * ```
 *
 * 也就是说 `0x80` 不是「标志位」，而是**「刑期已满、待释放」**这个状态本身。
 * 天数归零时并不直接清零，而是先挂上 0x80，**下一次推进**才真正执行
 * 出狱／出院流程（那里还有动画与位置移动）。
 */

import type { BlockingDays, Player } from '../state/types.ts';

/** 刑满待释放标记 @source `or ch, 0x80` */
export const RELEASE_PENDING = 0x80;

/**
 * `days_disappearing` 的归零判据用 `& 0x3f`，其余项用整字节。
 * @source `test dh, 0x3f / jne 跳过`（VA 0x0041c8e3）
 *   对比监狱 `dec cl / jne 跳过`（0x0041c912）——后者是整字节的零标志。
 */
export const DISAPPEARING_MASK = 0x3f;

/** 一次递减的结果 */
export interface TickOutcome {
  /** 递减后的计数值 */
  value: number;
  /** 本次是否应当执行**释放**流程（出狱／出院等） */
  release: boolean;
}

/**
 * 推进一个阻碍计数器一天。
 *
 * @param raw  当前计数值
 * @param mask 归零判据的掩码；`days_disappearing` 用 0x3f，其余用 0xff
 */
export function tickBlockingCounter(raw: number, mask = 0xff): TickOutcome {
  // @source test d, 0x80 / jne → 释放
  if ((raw & RELEASE_PENDING) !== 0) {
    return { value: 0, release: true };
  }
  // @source test d, d / je 跳过
  if (raw === 0) return { value: 0, release: false };

  // @source dec d —— ★ 整字节递减，不掩码
  const next = (raw - 1) & 0xff;
  // @source jne 跳过 / or d, 0x80
  if ((next & mask) === 0) {
    return { value: next | RELEASE_PENDING, release: false };
  }
  return { value: next, release: false };
}

/**
 * 参与递减的计数器、归零掩码，以及各自的释放函数地址。
 *
 * 恰好是 `+0x32..+0x35` 这四个字节——与 `isBlocked` 一次性比较
 * `dword [player+0x32]` 的那一组完全一致。
 */
export const TICKED_COUNTERS: readonly (readonly [keyof BlockingDays, number, string])[] = [
  ['inHotel', 0xff, '0x0040d6be'],
  ['disappearing', DISAPPEARING_MASK, '0x0040d4e5'],
  ['inPrison', 0xff, '0x0043d7bf'],
  ['inHospital', 0xff, '0x0043ee6e'],
];

export interface BlockingTickResult {
  blocking: BlockingDays;
  /** 本次需要执行释放流程的项 */
  released: (keyof BlockingDays)[];
}

/**
 * 推进某玩家的阻碍计数器一天。
 *
 * ★ **调用时机已查清**（此前是 reduce.ts 里的一个 TODO）：
 * ```asm
 * 00419033  mov  eax, dword [0x49910c]     ; ★ 当前玩家
 * 00419039  call 0x41c84f                  ; 递减其阻碍计数
 * ```
 * 就在回合边界，且**只作用于当前玩家**（不是全体）。
 * 紧邻其前的 `call 0x41cf67` 是另一件事——推进日期与物价指数。
 *
 * ⚠️ `tickBlocking` 只管 `+0x32..+0x35` 四项（住宿／消失／监狱／医院），
 * 每项都有自己的释放函数。冬眠、梦游、停留、乌龟等**也在同一个函数里**，只是排在
 * 后面（0x0041caf4 起）——见文件末尾的 `tickTurnCounters`。（先前那句「不在此处」是错的。）
 */
export function tickBlocking(blocking: BlockingDays): BlockingTickResult {
  const next: BlockingDays = { ...blocking };
  const released: (keyof BlockingDays)[] = [];

  for (const [key, mask] of TICKED_COUNTERS) {
    const out = tickBlockingCounter(next[key], mask);
    next[key] = out.value;
    if (out.release) released.push(key);
  }

  return { blocking: next, released };
}

/**
 * 剩余天数的**显示值**。
 *
 * 与内部计数不同：界面显示 `(value & 0x7f) + 1`
 * （`days_disappearing` 用 `& 0x3f`）。
 */
export function displayRemainingDays(raw: number, mask = 0x7f): number {
  return (raw & mask) + 1;
}

// ============================================================
//  ★ 同一函数的后半段：冬眠／梦游／停留／龜行／銀行拒貸／同盟 也在这里走一天
// ============================================================

/**
 * ⚠️ 纠正文件头那句「冬眠、梦游、停留、乌龟不在此处」——它们**就在**同一个
 * 回合边界函数里，只是排在 +0x32..+0x35 之后（0x0041caf4 起）：
 * ```asm
 * 0041caf7  cmp dword [p+0x32], 0 / jne 跳过冬眠与梦游   ; ★ 住宿/消失/监狱/医院期间这两项不走
 * 0041cb04  +0x36 冬眠：dec；到 0 → |0x80
 * 0041cb28  +0x37 梦游：同上
 * 0041cb4c  +0x39 龜行：同上（不受上面那条 cmp 限制）
 * 0041cb70  +0x38 停留：同上
 * 0041cb94  +0x3b 銀行拒貸：同上
 * 0041cbb8  +0x3c（字段未名）：同上
 * 0041cbdc  +0x3d 同盟：先 update_hostility(我, 盟友, −20×物價) 与 (盟友, 我, −20×物價)，再 dec；到 0 → 0x80
 * 0041cc4b  +0x3e 保險：同上（本引擎在 startTurn 走，早一拍，见 reduce.ts）
 * ```
 * 释放（前半段 0x0041c9a7..0x0041caf4）：带 0x80 的清零；梦游醒来还要**把交通工具拿回来**
 * （0x0041c9bc：按 +0x66 存的方式，道具栏里还有那辆才还，没有就步行、骰子 1）；
 * 同盟到期走 0x40cc1a 解除双方。
 */
export interface TurnCounterTick {
  player: Player;
  /** 本次梦游期满（0x80 已清）：调用方去还交通工具 */
  wakeFromSleepwalk: boolean;
  /** 本次同盟期满：调用方去解除双方 */
  allianceExpired: boolean;
  /** 同盟仍在：调用方给双方敌意各 −20×物價 */
  alliedTick: boolean;
}

/** 后半段各项走一天（不含 +0x3c 未名字段与保險）。纯函数，只动这名玩家自己的字段 */
export function tickTurnCounters(player: Player): TurnCounterTick {
  const b = player.blocking;
  const confined = (b.inHotel | b.disappearing | b.inPrison | b.inHospital) !== 0;
  const sleeping = confined ? { value: b.sleeping, release: false } : tickBlockingCounter(b.sleeping);
  const sleepWalking = confined ? { value: b.sleepWalking, release: false } : tickBlockingCounter(b.sleepWalking);
  const tortoise = tickBlockingCounter(b.tortoiseWalking);
  const stopping = tickBlockingCounter(b.stopping);
  const rejected = tickBlockingCounter(player.daysRejectedByBank);
  const alliedTick = player.alliedDays !== 0 && (player.alliedDays & RELEASE_PENDING) === 0;
  const allied = tickBlockingCounter(player.alliedDays);
  return {
    player: {
      ...player,
      blocking: {
        ...b,
        sleeping: sleeping.value,
        sleepWalking: sleepWalking.value,
        tortoiseWalking: tortoise.value,
        stopping: stopping.value,
      },
      daysRejectedByBank: rejected.value,
      alliedDays: allied.value,
    },
    wakeFromSleepwalk: sleepWalking.release,
    allianceExpired: allied.release,
    alliedTick,
  };
}
