/*
 * 台词的「掷硬币」—— 原版台词阶梯里那几次 `rand()` 的**确定性替身**（WP-3；Q-SPEECH-3 改判）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 原版
 *
 * 金额分档函数的**中间档**、事件 18 的闸、街區獨佔的 17、新聞 / 命運「房子被拆」那一句，
 * 都是 `call _libc_rand`（0x456f2d）当场掷一次，再从相邻两句（或说 / 不说）里挑：
 *
 * | 站点（`call rand` 的 VA） | 所在函数 | 用法 | 结果 |
 * |---|---|---|---|
 * | `0x0044f280` | `fcn_0044f230` 點入帳 | `and eax,1` | 事件 0 \| 1 |
 * | `0x0044f312` | `fcn_0044f2c2` 小额损失（旅館天数） | `and eax,1` | 事件 3 \| 4 |
 * | `0x0044f3d1` | `fcn_0044f354` 進帳 | `and eax,1` | 事件 6 \| 7 |
 * | `0x0044f4a7` | `fcn_0044f42d` 付錢 | `and eax,1` | 事件 9 \| 10 |
 * | `0x0044f525` | `fcn_0044f4ed` 最敵對玩家 | `test al,1 / je 不说` | 1/2 说事件 18 |
 * | `0x0044f5e1` | `fcn_0044f567` 罰款免付 | `and eax,1` | 事件 12 \| 13 |
 * | `0x0044f67b` | `fcn_0044f627` 街區獨佔（加蓋支） | `idiv 3 / test edx,edx / jne 不说` | 1/3 说事件 17 |
 * | `0x0044bf86` | 命運 0 強制拆除房屋 | `and eax,1` | 事件 3 \| 4 |
 * | `0x0044c5ad` | 命運 5 生日收卡（收完之后寿星那一句） | `and eax,1` | 事件 0 \| 1 |
 * | `0x004494b4` / `0x0044a5b0` / `0x0044ab00` / `0x0044ae74` | 新聞 5 / 15 / 19 / 21 房主 | `and eax,1` | 事件 3 \| 4 |
 *
 * ## 本引擎
 *
 * 这些 `rand()` **只决定说哪句话**，不影响任何规则数值；原版里它们与规则共用同一条全局随机流
 * （见 `docs/deviations/T-052.md` Q-SPEECH-3 的「全局结论」）。本引擎的 core RNG 只给规则用，
 * 表现层**不许**从里面抽（C-DET-1/2/4；抽了旧回报就重放不回同一个指纹、还得 bump 协议）。
 *
 * 协调方裁定（WP-3 选项 b）：**客户端对「那一刻的共享状态」做哈希**当硬币 ——
 *   - 输入只取**进指纹**的量（`stateFingerprint`：`rngState` / `turnCount` / 日期 / 说话人的 `cash`）
 *     + 说话人下标 + 站点 VA。联机各端重放同一条 action 得到同一个 `after` ⇒ **同一句**；
 *     单机、`replay-report`、服务器镜像也都是同一个值。
 *   - **不推进** `rngState`：纯读。core 的随机序列、协议、旧回报的指纹都不变。
 *   - 每次过路费之间至少隔着一次掷骰（`rngState` 变）+ 付款人现金变 ⇒ 连续几次过路费各掷各的，
 *     不会「永远同一句」；两句的比例 ≈ 1:1、17 的出声率 ≈ 1/3（单测按大量种子核）。
 *
 * ⚠️ 与原版的差别只剩「掷出来的是哪一面」：原版那一面取决于全局随机流的位置（与帧率 / 操作有关，
 *   无头引擎本来就对不齐），本引擎取决于状态哈希。**分布**（1/2、1/3）与原版一致。
 */

import type { GameState } from '@rich4/core';

/** 各站点 = 原版那一次 `call 0x456f2d`（`_libc_rand`）的 VA —— 同时充当哈希的盐 */
export const SPEECH_RAND_SITE = {
  /** `fcn_0044f230`（點入帳 0/1/2）中档 @source 0x0044f280 `call rand / and eax,1` */
  smallGain: 0x0044f280,
  /** `fcn_0044f2c2`（旅館天数 3/4/5）中档 @source 0x0044f312 */
  smallLoss: 0x0044f312,
  /** `fcn_0044f354`（進帳 6/7/8）中档 @source 0x0044f3d1 */
  gain: 0x0044f3d1,
  /** `fcn_0044f42d`（付錢 9/10/11）中档 @source 0x0044f4a7 */
  pay: 0x0044f4a7,
  /** `fcn_0044f4ed`（事件 18）的 1/2 闸 @source 0x0044f525 `call rand / test al,1 / je` */
  hostile: 0x0044f525,
  /** `fcn_0044f567`（罰款免付 12/13/14）中档 @source 0x0044f5e1 */
  fine: 0x0044f5e1,
  /** `fcn_0044f627`（街區獨佔，加蓋支 17）的 1/3 闸 @source 0x0044f67b `call rand / idiv 3` */
  areaMonopoly: 0x0044f67b,
  /** 命運 0「強制拆除房屋」房主 3/4 @source 0x0044bf86 */
  demolished: 0x0044bf86,
  /** 命運 5「生日收卡」收完之后寿星 0/1 @source 0x0044c5ad `call rand / and eax,1` → 0x0044c5c5 `player_say` */
  birthday: 0x0044c5ad,
} as const;

/**
 * 新聞「挑一处建筑」那一族房主那句（事件 3|4）的站点，按新聞号。
 * @source 新聞 5 `0x004494b4`、15 `0x0044a5b0`、19 `0x0044ab00`、21 `0x0044ae74`（都是 `call 0x456f2d / and eax,1`）
 */
export const NEWS_OWNER_RAND_SITE: ReadonlyMap<number, number> = new Map([
  [5, 0x004494b4],
  [15, 0x0044a5b0],
  [19, 0x0044ab00],
  [21, 0x0044ae74],
]);

/** 原版 Watcom `rand()` 的值域上限（`0..0x7fff`）—— 调用方照抄 `& 1` / `% 3` 的写法 */
export const SPEECH_RAND_MAX = 0x7fff;

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

/** murmur3 的一步（32 位）*/
function mixIn(h: number, k: number): number {
  let x = Math.imul(k | 0, 0xcc9e2d51);
  x = rotl(x, 15);
  x = Math.imul(x, 0x1b873593);
  let y = h ^ x;
  y = rotl(y, 13);
  return (Math.imul(y, 5) + 0xe6546b64) | 0;
}

/** murmur3 的收尾雪崩 */
function fmix(h: number): number {
  let x = h ^ (h >>> 16);
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * 那一刻的「`rand()`」—— 返回 `0..0x7fff`（与原版同值域），调用方照 exe 写 `& 1` / `% 3`。
 *
 * 纯函数：同一个 `state`（= 同一条 action 之后的局面）、同一个说话人、同一个站点 ⇒ 同一个值。
 * 只读进指纹的字段（见文件头），所以指纹一致的两端一定掷出同一面。
 *
 * @param state  这一条 action **之后**的局面（探测器的 `after`）
 * @param player 说话人下标（`players` 数组下标）
 * @param site   站点 VA（`SPEECH_RAND_SITE` / `NEWS_OWNER_RAND_SITE`）
 */
export function speechRand(
  state: Pick<GameState, 'rngState' | 'turnCount' | 'day' | 'month' | 'year' | 'players'>,
  player: number,
  site: number,
): number {
  let h = site | 0;
  h = mixIn(h, state.rngState);
  h = mixIn(h, state.turnCount);
  h = mixIn(h, state.year * 400 + state.month * 32 + state.day);
  h = mixIn(h, player);
  h = mixIn(h, state.players[player]?.cash ?? 0);
  h = fmix(h ^ 20);
  // 取高 15 位（雪崩之后各位都均匀；取高位只是与 `rand()` 同值域）
  return h >>> 17;
}

/** `speechRand(…) & 1` —— 中间档二选一（0 = 前一句，1 = 后一句）*/
export function speechCoin(
  state: Parameters<typeof speechRand>[0],
  player: number,
  site: number,
): 0 | 1 {
  return (speechRand(state, player, site) & 1) as 0 | 1;
}
