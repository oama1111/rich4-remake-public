/*
 * 「此刻谁接管整屏」与「谁在排队等起播」—— 第十六份：线上卡死（`20260923-234517253`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 那一次是怎么卡死的
 *
 * 联机补帧（收件箱积压 ⇒ 一口气施加）时，第 112 条（P2 踩到小窮神）排下了一局神明老虎机
 * （等附身影片 / 开场白 / 台词），第 118 条（P3 电脑用地雷）当场弹出「使用地雷」訊息框（`lead` 档），
 * 道具台词押在框后面。三方：
 *
 *   老虎机（排着）── 等 ──▶ 押着的道具台词（`beforeStage`，档比它小）
 *   道具台词 ────── 等 ──▶ 屏上那扇「使用地雷」框收掉（互斥）
 *   訊息框（开着）── 等 ──▶ `tick`（到点才收）—— 可 `main.ts` 只给**第一个 active 的屏** `tick`，
 *                          而 `SCREENS` 里老虎机排在訊息框前面、又因为「排着」而 active ⇒ 訊息框永远收不到 tick
 *
 * 回合驱动 / 联机收件箱又在等「台上没有演出」⇒ 整局停在「第 28 回合 turnStart」。
 *
 * ## 两条规矩（根治）
 *
 *  1. **开着的屏优先接管**（`selectOverlay`）：只在排队、屏上没画东西的屏（`pendingOnly`）不抢位置；
 *  2. **排着的屏每帧都问一次闸**（`pendingScreens`）：它们的 `tick` 只做「闸开了就起播」，
 *     不必等轮到自己当第一屏。
 *  （另一半在各屏的起播闸里：屏上已经开着一扇框时，别的框不起 —— 原版全是阻塞调用，同一时刻只有一扇。）
 *
 * 纯函数，能单测。
 */

import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 此刻接管整屏（收 `draw` / `tick` / 输入）的那一屏：优先**开着**的，其次才是排着的 */
export function selectOverlay(screens: readonly UiScreen[], env: UiScreenEnv): UiScreen | null {
  let queued: UiScreen | null = null;
  for (const s of screens) {
    if (!s.active(env)) continue;
    if (s.pendingOnly?.(env) === true) {
      queued ??= s;
      continue;
    }
    return s;
  }
  return queued;
}

/** 除了接管整屏的那一屏之外、还在排队等起播的那几屏（每帧也给它们一次 `tick` 去问闸）*/
export function pendingScreens(screens: readonly UiScreen[], overlay: UiScreen | null, env: UiScreenEnv): UiScreen[] {
  return screens.filter((s) => s !== overlay && s.active(env) && s.pendingOnly?.(env) === true);
}
