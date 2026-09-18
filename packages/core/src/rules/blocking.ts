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
 *
 * ★★ **原版的释放是两段式**（2026-09-18 第 84 条查清 + 通道 2 差分）：
 *
 * | 段 | 位置 | 做什么 |
 * |---|---|---|
 * | ① | 本文件的递减流程看到 `0x80` → `call 释放函数` | 住宿／监狱／医院走 `0x40d6be`：**只立标记** `+0x15 \|= 0x10`（走回棋盘）、算朝向、置节点占用位，**一个字都不写 `+0x32..0x35`**；消失走 `0x40d4e5`：**自己把 `+0x33` 清 0**、**不置** `0x10` |
 * | ② | **走路例程 `0x40c05c`** 的 `0x40c3cf` | `mov dword [player+0x32], 0` —— ★ **一次清四个**，条件是 `+0x15 & 0x30` 且 `trunc(距离/步长) >= 2` |
 * | ③ | **回合推进 `0x418ebd`** 的 `0x418f04` | 带 `+0x15 & 0x10` 的人**整回合不掷骰**（`00418f8e jmp 0x419058`），随后 `00418f87 and …, 0xf` 清标记 |
 *
 * ⇒ ① 与 ③ 落在**同一个回合**上（原版在新玩家回合开头递减：`0x419033`），
 * 所以「刑满」之后还要**白丢一回合**（从綠島／醫院大樓走回棋盘那一回合）——
 * 这正是状态栏「還剩 `(raw & 0x7f) + 1` 天」的口径（显示的 = 还会丢几个回合）。
 *
 * 本引擎的递减时机与原版**同刻**：`reduce.ts` 的 `endTurn` 先推进游标、
 * 再给**新**当前玩家递减（对应原版 `0x418f95` → `0x419039`），于是 ①③ 天然同回合；
 * ② 的清账（四项计数一次清光）折叠到 `startTurn`（本引擎移动是原子的，没有"动画中途"）。
 * 标记由 `endTurn` 的 `released` 分支置上（`WHO_PLAYS_RETURN_TO_BOARD`，消失除外）。
 *
 * ⚠️ 一处**已知的残留差异**（极小）：原版 ② 的清账**有条件**（本趟走法短于
 * 2×步长就不清 ⇒ 多关一回合），本引擎无条件清。
 *
 */

import type { BlockingDays, Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';

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
  // @source 0x41c895 `test cl, 0x80 / je 递减`；0x41c89a `push ebx / call 释放函数`
  //   ★★ 这一支**不写计数器**（`jmp 0x41c8bc` 跳过递减那几句），四个释放函数里
  //   只有「消失」那一支自己清 `+0x33`（`0x40d52c`）—— 住宿／监狱／医院三支
  //   一个字都不写，于是释放之后计数**仍停在 0x80**，那一个回合依然是"被阻碍"
  //   （状态栏也照 `(0x80 & 0x7f) + 1` 显示「還剩 1 天」）。
  //   通道 2 证据：`rich4-spec/tests/test_day_tick.py`（28/28）。
  if ((raw & RELEASE_PENDING) !== 0) {
    return { value: 0, release: true };
  }
  // @source test d, d / je 跳过
  if (raw === 0) return { value: 0, release: false };

  // @source dec d —— ★ 整字节递减，不掩码
  const next = (raw - 1) & 0xff;
  // @source 0x41c8e3 `test dh, 0x3f / jne`（消失）/ `test dl, dl / jne`（其余）
  //         0x41c8ea `or ch, 0x80` —— ★ 减到 0 时**挂 0x80（待释放）**，
  //   真正的释放（`call 0x43d7bf` 等）发生在**下一次**推进里。
  //   ⇒ 释放那一回合同时是「走回棋盘」那一回合（见 blocking.ts 顶部长注释），
  //   状态栏显示的 `(raw & 0x7f) + 1` 就是"还会丢几个回合"。
  //   本引擎的递减时机与原版**同刻**（在旧玩家回合的 `endTurn` 里给新玩家递减，
  //   对应原版 `0x419033` 推进游标之后那一次），故两段式**照抄不再折叠**。
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
 * ★ **调用时机**（2026-09-18 第 84 条订正 —— 此前记成"当前玩家"是**读早了**）：
 * ```asm
 * 00418f93  xor  ebx, ebx
 * 00418f95  inc  esi / mov [0x49910c], esi   ; ★★ 先把游标推进到下一位
 * 00418fa2  …（越界则跳惡人段 / 绕回 0 号并把 ebx 置 1）
 * 0041902e  call 0x41cf67                    ; ★ 绕回 0 号那一次：推进日期/物价/行情/開獎/月結
 * 00419033  mov  eax, dword [0x49910c]
 * 00419039  call 0x41c84f                    ; ★ 递减的是**新**当前玩家（= 即将行动的那位）
 * ```
 * 也就是说：递减发生在**新玩家回合的开头**，不是旧玩家回合的末尾。
 * 本引擎的相位机在 `endTurn` 里只拿得到旧玩家，故**有意**把这一步放在旧玩家
 * 回合末尾（见 `reduce.ts` 的 `endTurn` 注释）——对同一个玩家而言，两者只差
 * 「占用表在同轮内的哪一刻被清」，**丢掉的回合数完全一致**（N 天 = N+1 个回合）。
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
/**
 * 拆除类改造的**全场释放** `0x0040dffa()` —— 无参数，遍历全体玩家：
 * 把**在场**且 `blocking.inHotel != 0` 的人置成「释放挂起」（`0x80`），
 * 于是他们下一天就出来。
 *
 * @source 差分实证 `rich4-spec/tests/test_mutate_release.py`（7/7）：
 * ```asm
 * 0040dffc  cmp edx, [0x499114] / jge 出
 * 0040e007  cmp byte [eax + 0x496b7d], 0 / je 下一人   ; 出局者跳过
 * 0040e010  cmp byte [eax + 0x496b9a], 0 / je 下一人   ; 本来就是 0 跳过
 * 0040e019  mov byte [eax + 0x496b9a], 0x80            ; 置释放挂起
 * ```
 *
 * ★★ **一刀切**：它不看地点、也不接受参数 —— 任何一次「把旅馆/医院拆掉」
 *   都会把**全场所有**被关押的在场玩家一起放出来。原版如此，别"改良"成只放
 *   该设施里的那几位。
 *
 * ★ 调用点（原版自扫，全在 `mutate_land`/`mutate_facility` 里，共 5 处）：
 *   `0x40ac33`（設施 mode 0 拆到 0 级）、`0x40ac4d`（設施 mode 1）、
 *   `0x40ac6c`（設施 mode 2）、`0x40ae0d`（住宅 mode 0 拆到 0 级）、
 *   `0x40ae58`（住宅 mode 1/2）。⇒ 复刻的 `mutateLand`/`mutateFacility`
 *   在同样三种情形下**必须**调本函数（见 `cards/monster.ts` 的返回值
 *   `releasesConfined`）。
 */
export function releaseConfinedPlayers(players: readonly Player[]): Player[] {
  return players.map((p) => {
    if (!isAlive(p)) return p;
    if (p.blocking.inHotel === 0) return p;
    return { ...p, blocking: { ...p.blocking, inHotel: RELEASE_PENDING } };
  });
}

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
 * 0041cbb8  +0x3c 銀行暫停放款（新聞 #171，Q-TURN-1 已解）：同上
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
  // @source 0x0041cbb8 +0x3c 銀行暫停放款
  const frozen = tickBlockingCounter(player.bankFreezeDays);
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
      bankFreezeDays: frozen.value,
      alliedDays: allied.value,
    },
    wakeFromSleepwalk: sleepWalking.release,
    allianceExpired: allied.release,
    alliedTick,
  };
}
