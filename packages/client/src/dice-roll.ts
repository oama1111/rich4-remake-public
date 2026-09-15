/*
 * 掷骰这一段的表现：预动作 → 滚骰 → 定格点数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 全部照 exe 的三段来，**不是**自创的滚动动画：
 *
 * | 段 | 时长 | 画面 | 出处 |
 * |---|---|---|---|
 * | 预动作 | `每向帧数` 个 tick（走路 9） | 角色播「手持骰子的走路」 | `fcn_0040d7c4` state 2，VA 0x0040d975 |
 * | 滚骰 | 36 × 14 ms ≈ 504 ms | `Panel.mkf` 4/5/6 的 **FLIC** | `fcn_00419572` → `fcn_0045144f` |
 * | 定格 | 500 ms | 盖 `Panel.mkf` 3 的点数图 | `fcn_00419572` 尾 `fcn_0045285e(0x1f4)` |
 *
 * ★ 三条铁律：
 *   1. **不读也不改 `state`**：这一段纯表现，进了 `history`/自动存档就会破坏
 *      C-DET-4 的同种子重放一致性。
 *   2. **不用 `Math.random`**：点数一律由 core 的 `rollDice` 决定，这里只负责「什么时候画」。
 *   3. **不预测点数**：原版是先播完预动作才掷，所以顺序是
 *      预动作 →（调用方 dispatch `rollDice`）→ 滚骰 → 定格。
 *
 * ★ 角色在整段里都保持「手持骰子」那一组图：原版把 state 设成 1（走子）
 *   是在 `fcn_00419572` **返回之后**，也就是 500 ms 定格走完之后。
 */

import type { LoadedFlic } from './assets.ts';

/** 这一段的三个子阶段 */
export type DicePhase = 'idle' | 'anticipate' | 'tumble' | 'hold';

/**
 * 定格点数的时长（毫秒）。
 * @source VA 0x004196da `push 0x1f4; call fcn_0045285e`（0x1f4 = 500）
 */
export const DICE_HOLD_MS = 500;

/** 掷骰子音效 —— 表 `0x48234a` 索引 2 → 音效 **10**（@source VA 0x0041962a / 0x004196f4） */
export const DICE_SOUND = 10;

export class DiceRollFx {
  #phase: DicePhase = 'idle';
  /** 当前子阶段是什么时候开始的 */
  #at = 0;
  /** 预动作要几个 tick */
  #anticipateTicks = 9;
  /** 一个 tick 多少毫秒 */
  #tickMs = 80;
  /** 这一掷几颗骰子 */
  #count = 1;
  /** 点数（`rollDice` 回来之后才有） */
  #dice: readonly number[] = [];
  #flic: LoadedFlic | null = null;
  /** 这一掷的 `rollDice` 是不是已经被本模块催出去过 */
  #rollRequested = false;

  get phase(): DicePhase {
    return this.#phase;
  }

  /** 整段还在进行（含 500 ms 定格）—— 期间不该开始走子 */
  get active(): boolean {
    return this.#phase !== 'idle';
  }

  /** 点数到手之前，本模块要不要替调用方按一次「掷骰」 */
  get wantsRoll(): boolean {
    return this.#phase === 'anticipate' && !this.#rollRequested;
  }

  /** 这一掷几颗骰子（滚骰 FLIC 的选片依据：4/5/6） */
  get diceCount(): number {
    return this.#count;
  }

  /** 角色现在该摆哪一组图 —— 整段都保持「手持骰子」 */
  get characterPose(): 'dice' | null {
    return this.active ? 'dice' : null;
  }

  /**
   * 开局那一按（GO）之后调它：进入预动作。
   *
   * @param anticipateTicks 「手持骰子的走路」每向帧数（走路 = 72 / 8 = 9）
   * @param tickMs          一个 tick 多少毫秒（见 `tick.ts`）
   * @param count           这一掷几颗骰子
   */
  begin(now: number, anticipateTicks: number, tickMs: number, count: number): void {
    this.#phase = 'anticipate';
    this.#at = now;
    this.#anticipateTicks = Math.max(1, anticipateTicks);
    this.#tickMs = Math.max(1, tickMs);
    this.#count = Math.max(1, count);
    this.#dice = [];
    this.#flic = null;
    this.#rollRequested = false;
  }

  /**
   * 预动作数满了吗。数满就该由调用方 `dispatch(rollDice)`。
   * @source VA 0x0040d975：`[0x498ea3] == 每向帧数` 的那一 tick 才掷
   */
  anticipationDone(now: number): boolean {
    return this.#phase === 'anticipate' && now - this.#at >= this.#anticipateTicks * this.#tickMs;
  }

  /** 预动作跑到第几帧了（画角色用） */
  anticipationFrame(now: number): number {
    const k = Math.floor((now - this.#at) / this.#tickMs);
    return Math.min(this.#anticipateTicks - 1, Math.max(0, k));
  }

  /** 催过一次 `rollDice` 了，别重复催 */
  markRollRequested(): void {
    this.#rollRequested = true;
  }

  /**
   * 点数到手（`rollDice` 已 dispatch）→ 进入滚骰。
   *
   * @param flic 已解好的 FLIC；还没到货就先给 `null`，画面会停在预动作最后一帧
   */
  roll(now: number, dice: readonly number[], flic: LoadedFlic | null): void {
    this.#phase = 'tumble';
    this.#at = now;
    this.#dice = [...dice];
    this.#count = Math.max(1, dice.length);
    this.#flic = flic;
  }

  /** 滚骰总时长（毫秒）；没 FLIC 就 0 */
  tumbleMs(): number {
    return this.#flic === null ? 0 : this.#flic.frames.length * this.#flic.frameMs;
  }

  /**
   * 现在该画 FLIC 的第几帧；不在滚骰段返回 null。
   *
   * ★ 帧序照原版：`fcn_0045144f` 一帧解一次、等 `[0x48c870]`（= FLIC 头里的
   *   `speed` = 14 ms）再进下一帧，**播完停下**、不循环。
   */
  flicFrame(now: number): number | null {
    this.#advance(now);
    if (this.#phase !== 'tumble') return null;
    const flic = this.#flic;
    if (flic === null || flic.frames.length === 0) return null;
    const k = Math.floor((now - this.#at) / flic.frameMs);
    return Math.min(flic.frames.length - 1, Math.max(0, k));
  }

  /** 当前这一帧的位图；不在滚骰段或没 FLIC 时 null */
  flicBitmap(now: number): ImageBitmap | null {
    const k = this.flicFrame(now);
    return k === null ? null : (this.#flic?.frames[k] ?? null);
  }

  /**
   * 现在该画点数了吗。
   *
   * ★ 原版是**滚完之后**才把 `Panel.mkf` 3 的点数图盖上去，并且一直留到
   *   500 ms 定格结束（`fcn_00419572` 的绘图循环在 `fcn_0045144f` 之后）。
   */
  pips(now: number): readonly number[] | null {
    this.#advance(now);
    if (this.#phase !== 'hold') return null;
    return this.#dice;
  }

  /**
   * 这一掷的点数（点数一到手就有，与画不画无关）。
   *
   * ★ 单独给一个口子是给「影片还没解好」兜底用的：那时只能先把点数摆出来，
   *   总比空着强。正常路径走 `flicBitmap` → `pips`。
   */
  get dice(): readonly number[] {
    return this.#dice;
  }

  /** 整段跑完了吗（定格 500 ms 走满） */
  done(now: number): boolean {
    this.#advance(now);
    return this.#phase === 'idle' && !this.active;
  }

  /** 收摊（读档、换屏、断线时用） */
  cancel(): void {
    this.#phase = 'idle';
    this.#flic = null;
    this.#dice = [];
    this.#rollRequested = false;
  }

  /** 把 FLIC 补上（刚解好）—— 只影响正在滚的这一段 */
  attachFlic(flic: LoadedFlic | null): void {
    if (this.#phase === 'tumble' || this.#phase === 'anticipate') this.#flic = flic;
  }

  /**
   * 推进子阶段 —— **不依赖绘制**。
   *
   * ★★ 2026-09-16 加（长跑抓到的硬卡死）：子阶段的推进原本只挂在
   *   `flicBitmap()` / `pips()` / `anticipationFrame()` 里，也就是**只有这一帧
   *   真的画到骰子**才会推进。可一旦有整屏接管盖住棋盘（上市公司分紅 / 樂透開獎 /
   *   魔法屋 / 百貨公司…），`drawDiceFx()` 就不再被调用 ⇒ 相位永远停在 `tumble`
   *   ⇒ `active` 恒为真 ⇒ `scheduleAi()` / `scheduleHumanTurn()` / `requestRoll()`
   *   三处都以它为闸，**整局永久冻死**（实测：AI 停在 `awaitingRoll` 84 秒不动，
   *   且不再恢复）。
   *   ⇒ 现在由 `main.ts` 的 `dicePoll`（16 ms 定时器，动画期间一直在跑）调它，
   *   与画不画无关。
   */
  tick(now: number): void {
    this.#advance(now);
  }

  /** 子阶段到点就自己往下走：tumble → hold → idle */
  #advance(now: number): void {
    if (this.#phase === 'tumble' && now - this.#at >= this.tumbleMs()) {
      this.#phase = 'hold';
      this.#at += this.tumbleMs();
    }
    if (this.#phase === 'hold' && now - this.#at >= DICE_HOLD_MS) {
      this.#phase = 'idle';
      this.#flic = null;
    }
  }
}
