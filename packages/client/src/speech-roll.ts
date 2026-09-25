/*
 * 台词阶梯里那几次 `rand()` —— 读 core 在 exe 掷的那一刻掷出来的值（`GameState.lastSpeechRolls`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 原版
 *
 * 金额分档函数的**中间档**、事件 18 的闸、街區獨佔的 17、新聞 / 命運「房子被拆」那一句、寿星那一句，
 * 都是 `call _libc_rand`（0x456f2d）当场掷一次，再从相邻两句（或说 / 不说）里挑。这一次 `rand()`
 * 与规则**共用同一条**全局随机流 —— 掷了，之后所有随机事件就往后挪一格。
 * 站点表见 `packages/core/src/rules/speech-rand.ts`（`SPEECH_SITE` / `NEWS_OWNER_SITE`）。
 *
 * ## 本引擎
 *
 * ★★ 2026-09-25（provenance 审计 events 第二轮，需求方「一切照原版」）：先前（WP-3 选项 b）由这里对
 *   「那一刻的共享状态」做哈希当硬币、**不推进** core 的随机流 ⇒ 台词之后的随机事件与原版整体错位。
 *   现在 core 在 exe 掷的那一刻掷（推进 `rngState`），掷出来的原值按先后记进 `after.lastSpeechRolls`
 *   （站点 VA、说话人、原值；纯表现瞬态，不进指纹）。这里只按站点 + 说话人**查**它：
 *   单机、联机各端、`replay-report`、服务器镜像重放同一条 action ⇒ 同一个值 ⇒ 同一句。
 *
 * 「这一条 action 掷的」= `after.lastSpeechRolls` 与 `before` 的**引用不同**（core 最外层 `reduce`
 *   出口整份覆写、没掷就是 null；逐段演出的每一段各盖自己那一截），同一套规矩见 `lastCardPlay`。
 */

import { NEWS_OWNER_SITE, SPEECH_SITE, type GameState, type SpeechRoll } from '@rich4/core';

/** 各站点 = 原版那一次 `call 0x456f2d`（`_libc_rand`）的 VA（与 core 同一份表）*/
export const SPEECH_RAND_SITE = SPEECH_SITE;

/** 新聞 5 / 15 / 19 / 21 房主那句（事件 3|4）的站点，按新聞号（与 core 同一份表）*/
export const NEWS_OWNER_RAND_SITE: ReadonlyMap<number, number> = NEWS_OWNER_SITE;

type RollHolder = Pick<GameState, 'lastSpeechRolls'>;

/** 这一对前后状态之间掷过的台词随机（按先后）；没有 ⇒ 空 */
export function speechRollsOf(before: RollHolder, after: RollHolder): readonly SpeechRoll[] {
  const rolls = after.lastSpeechRolls ?? null;
  if (rolls === null || rolls === (before.lastSpeechRolls ?? null)) return [];
  return rolls;
}

/**
 * 那一刻的 `rand()` 原值（`0..0x7fff`），调用方照 exe 写 `& 1` / `% 3`。
 * core 这一条没在那个站点替那个人掷（= 原版那一档不掷）⇒ `null`。
 *
 * @param nth 同一站点、同一说话人在这一条里掷了几次时取第几次（0 起）
 */
export function speechRand(
  before: RollHolder,
  after: RollHolder,
  player: number,
  site: number,
  nth = 0,
): number | null {
  let seen = 0;
  for (const r of speechRollsOf(before, after)) {
    if (r.site !== site || r.player !== player) continue;
    if (seen === nth) return r.value;
    seen += 1;
  }
  return null;
}

/** `speechRand(…) & 1` —— 中间档二选一（0 = 前一句，1 = 后一句）；没掷（不该发生）按前一句 */
export function speechCoin(
  before: RollHolder,
  after: RollHolder,
  player: number,
  site: number,
  nth = 0,
): 0 | 1 {
  return ((speechRand(before, after, player, site, nth) ?? 0) & 1) as 0 | 1;
}
