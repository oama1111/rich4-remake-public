/*
 * 三个小游戏：企鵝挖寶 / 七彩氣球 / 喜從天降
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 三个小游戏在**规则层面只做一件事**：给一笔點券。
 *   落点跳表 VA 0x004197e9 的第 6/7/8 项都是同一个形状：
 * ```asm
 * ebx = 当前玩家 * 0x68
 * call 小游戏               ; 返回值 = 得分
 * add word [ebx + 0x496b98], ax   ; ★ 點券 += 得分
 * ```
 *   除此之外它们不碰任何状态——不动钱、不动地、不动道具。
 *
 * ★ **三个小游戏共用同一条「不玩」的出口**（VA 0x00415457）：
 * ```asm
 * if (player.who_plays != 1)  goto 0x415457      ; 不是真人
 * if ([0x497159] == 0)        goto 0x415457      ; 小游戏被关掉了
 * …真正的小游戏…
 * 0x415457:
 *   得分 = 50 + rand() % 20                       ; ★ 50..69
 *   显示「得點券%d點」
 * ```
 *   也就是说**电脑玩家从来不玩小游戏**，直接按 50..69 抽一个数拿走。
 *   `[0x497159]` 是设置里的小游戏开关，关掉之后真人也走这条。
 *
 * ⚠️ 真人那条路的得分由玩法本身决定（写进 `[0x48bcec]`，上限 999），
 *   那是**表现层的游戏**，不属于 core（C-ARC-2）。本模块给出规则边界：
 *   得分从外部作为 action 参数送进来，没人送就走「不玩」那条。
 *   玩法本身见 known-deviations 的 Q-MINI-1。
 */

/** 三个小游戏 */
export const MINIGAME = {
  /** 6 企鵝挖寶 @source 0x00415215 */
  PENGUIN: 6,
  /** 7 七彩氣球 @source 0x004154dc */
  BALLOON: 7,
  /** 8 喜從天降 @source 0x004155fc */
  GIFT: 8,
} as const;

export const MINIGAME_NAMES: Readonly<Record<number, string>> = {
  [MINIGAME.PENGUIN]: '企鵝挖寶',
  [MINIGAME.BALLOON]: '七彩氣球',
  [MINIGAME.GIFT]: '喜從天降',
};

export function isMinigame(specialKind: number): boolean {
  return specialKind in MINIGAME_NAMES;
}

/**
 * 不玩时的得分区间。
 * @source VA 0x00415457：
 * ```asm
 * call rand
 * ebx = 0x14 ; idiv ebx        ; edx = rand() % 20
 * add edx, 0x32               ; + 50
 * ```
 */
export const MINIGAME_AUTO_BASE = 50;
export const MINIGAME_AUTO_SPREAD = 20;

/** 得分上限 @source `mov dword [0x48bcec], 0x3e7`（VA 0x00414eed） */
export const MINIGAME_MAX_SCORE = 999;

/** 不玩时抽一个 50..69 @param randValue `rand()` 的返回值 */
export function autoMinigameScore(randValue: number): number {
  return MINIGAME_AUTO_BASE + (randValue % MINIGAME_AUTO_SPREAD);
}

/**
 * 真人玩完之后报上来的分数，收进合法范围。
 *
 * ⚠️ 这道夹逼不是原版有的——原版的分数由它自己的玩法产生，天然在范围内。
 *   本引擎的分数来自**外部 action**，联机时可能是别人构造的，
 *   必须拦：不拦的话一条消息就能刷出任意多點券。
 */
export function clampMinigameScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  const n = Math.trunc(score);
  if (n < 0) return 0;
  return n > MINIGAME_MAX_SCORE ? MINIGAME_MAX_SCORE : n;
}
