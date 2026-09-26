/*
 * 台词里的那几次 `rand()` —— 规则态（全局随机流），选中的那一面交给表现层
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 2026-09-25（provenance 审计 events 第二轮，需求方「一切照原版」）：原版台词阶梯里的 `rand()`
 *   与规则**共用同一条**全局随机流（`call 0x456f2d`）。先前（WP-3 选项 b）由客户端对状态做哈希当硬币、
 *   不推进 core 的随机流 ⇒ 之后所有随机事件与原版错位。现在一律**在 exe 掷的那一刻由 core 掷**，
 *   掷出来的值记进 `GameState.lastSpeechRolls`（纯表现瞬态，不进指纹），客户端按站点查它挑那一句。
 *
 * | 站点（`call rand` 的 VA） | 所在函数 | 何时掷 |
 * |---|---|---|
 * | `0x0044f280` | `fcn_0044f230` 點入帳 | 50 < 點數 ≤ 100 |
 * | `0x0044f312` | `fcn_0044f2c2` 小额损失 | 3 < 天数 ≤ 6 |
 * | `0x0044f3d1` | `fcn_0044f354` 進帳 | 5000×物價 ≤ 金额 < 9000×物價 |
 * | `0x0044f4a7` | `fcn_0044f42d` 付錢 | 同上 |
 * | `0x0044f525` | `fcn_0044f4ed` 最敵對玩家 | 收款方 = 付款方最恨的人 且 金额 ≥ 5000×物價 |
 * | `0x0044f5e1` | `fcn_0044f567` 罰款免付 | 5000×物價 ≤ 金额 < 9000×物價 |
 * | `0x0044f67b` | `fcn_0044f627` 街區獨佔（加蓋支） | 同名地 ≥ 3 块且第 2 参 ≠ 0 |
 * | `0x0044bf86` | 命運 0/1 房主 | 无条件 |
 * | `0x0044c5ad` | 命運 5 寿星 | 合格人数 ≠ 0 |
 * | `0x004494b4` / `0x0044a5b0` / `0x0044ab00` / `0x0044ae74` | 新聞 5/15/19/21 房主 | 有主 |
 *
 * 其余已在 core 掷、各有专用提示的（得點券格 `0x0041b1f8`、小游戏不玩 `0x004154b6`、命運 10 `0x0044cb28`、
 * 福神白送 `0x0040fa49`、回合被挡 `0x0040ca20` 等）不走这里。
 */

/** 各站点 = 原版那一次 `call 0x456f2d` 的 VA */
export const SPEECH_SITE = {
  smallGain: 0x0044f280,
  smallLoss: 0x0044f312,
  gain: 0x0044f3d1,
  pay: 0x0044f4a7,
  hostile: 0x0044f525,
  fine: 0x0044f5e1,
  areaMonopoly: 0x0044f67b,
  demolished: 0x0044bf86,
  birthday: 0x0044c5ad,
} as const;

/** 新聞 5/15/19/21 房主那句的站点 */
export const NEWS_OWNER_SITE: ReadonlyMap<number, number> = new Map([
  [5, 0x004494b4],
  [15, 0x0044a5b0],
  [19, 0x0044ab00],
  [21, 0x0044ae74],
]);

/** 一次台词随机：站点、说话人（玩家下标）、`rand()` 原值（0..0x7fff） */
export interface SpeechRoll {
  readonly site: number;
  readonly player: number;
  readonly value: number;
}

/** 金额阶梯的上下线（`fcn_0044f354` / `0x44f42d` / `0x44f567` 共用）@source 0x0044f36d / 0x0044f3b0 */
const TIER_HIGH = 9000;
const TIER_MID = 5000;

/** 「好消息」台词阶梯 `fcn_0044f230(玩家, 點數)` 会不会掷 @source 0x0044f23f / 0x0044f262 / 0x0044f280 */
export function goodNewsSpeechDrawsRand(points: number): boolean {
  return points > 0x32 && points <= 0x64;
}

/** `fcn_0044f2c2(玩家, 天数)` 会不会掷 @source 0x0044f2d1 `cmp edx,6` / 0x0044f2f4 `cmp edx,3` / 0x0044f312 */
export function smallLossDrawsRand(days: number): boolean {
  return days > 3 && days <= 6;
}

/** 進帳 / 付錢 / 罰款免付三条阶梯的中间档才掷 @source 0x0044f3b0 / 0x0044f486 / 0x0044f5c0 */
export function moneyTierDrawsRand(amount: number, priceIndex: number): boolean {
  return amount >= TIER_MID * priceIndex && amount < TIER_HIGH * priceIndex;
}

/**
 * 最恨的人（`0x40d2d3`）：在场、不是自己、`hostility` 严格更大（初值 0 ⇒ 须 > 0），并列取前。
 * @source 0x0040d2e3..0x0040d316
 */
export function mostHostileOf(
  players: readonly { whoPlays: number; hostility: readonly number[] }[],
  who: number,
): number {
  const me = players[who];
  if (me === undefined) return -1;
  let best = 0;
  let pick = -1;
  for (let i = 0; i < players.length; i++) {
    if (i === who || (players[i]?.whoPlays ?? 0) === 0) continue;
    const h = me.hostility[i] ?? 0;
    if (best < h) {
      best = h;
      pick = i;
    }
  }
  return pick;
}

/**
 * `fcn_0044f4ed(付款人, 收款人, 金额)` 会不会掷：收款人是付款人最恨的人、且金额 ≥ 5000×物價。
 * @source 0x0044f4f7 call 0x40d2d3 / 0x0044f4ff cmp / 0x0044f51f `cmp 5000×物價, 金额 / jg 不掷`
 */
export function hostileDrawsRand(
  players: readonly { whoPlays: number; hostility: readonly number[] }[],
  payer: number,
  payee: number,
  amount: number,
  priceIndex: number,
): boolean {
  return mostHostileOf(players, payer) === payee && amount >= TIER_MID * priceIndex;
}

// ============================================================
//  收集器 —— 一条 action 里掷过的台词随机，按先后
// ============================================================

let sink: SpeechRoll[] | null = null;

/** 最外层 `reduce` 进门时开一个新的收集器（嵌套的 `reduce` 共用） */
export function beginSpeechRolls(): void {
  sink = [];
}

/** 最外层 `reduce` 出门时取走收集到的（并关掉收集器） */
export function endSpeechRolls(): SpeechRoll[] {
  const out = sink ?? [];
  sink = null;
  return out;
}

/** 收集器此刻的位置（逐段演出的分界用） */
export function speechRollsMark(): number {
  return sink === null ? 0 : sink.length;
}

/**
 * `[from, to)` 那一段掷过的（给逐段演出的每一段盖戳用）；一次都没有 ⇒ `null`
 * （与最外层出口「没掷就是 null」同一个口径，表现层按「引用变了 ⇒ 整份都是这一段的」读）。
 */
export function speechRollsBetween(from: number, to?: number): readonly SpeechRoll[] | null {
  if (sink === null) return null;
  const seg = sink.slice(from, to);
  return seg.length > 0 ? seg : null;
}

type AnyRng = { next(): number } | { below(n: number): number };

/**
 * 在台词站点掷一次 `rand()`（推进调用方那条随机流），并记下来。返回原值 0..0x7fff。
 * `rng` 可以是 `WatcomRng`（`next`）或效果层的 `{ below }`（`below(0x8000)` 就是 `rand()` 原值）。
 */
export function speechDraw(rng: AnyRng, site: number, player: number): number {
  const value = 'next' in rng ? rng.next() : rng.below(0x8000);
  sink?.push({ site, player, value });
  return value;
}
