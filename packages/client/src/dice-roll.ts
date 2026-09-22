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
    // ★★ 联机预测（`predictRoll`）已经把这一段滚起来了：这里只把**权威点数**补上，
    //   **不重启相位、不重置起始时刻** —— 否则服务器回包一到，骰子会从头再滚一遍，
    //   那正是第九份试玩回报「掷骰延迟」要修的手感（3 秒白等之外的第二段顿挫）。
    if (this.#phase === 'tumble' || this.#phase === 'hold') {
      if (dice.length > 0) this.#count = Math.max(1, dice.length);
      this.#dice = [...dice];
      if (flic !== null) this.#flic = flic;
      return;
    }
    this.#phase = 'tumble';
    this.#at = now;
    this.#dice = [...dice];
    this.#count = Math.max(1, dice.length);
    this.#flic = flic;
  }

  /**
   * ★★ 联机预测：**不知道点数**就先开滚（第九份试玩回报「聯機擲骰延遲」，2026-09-22）。
   *
   * 为什么「预测」在这里是合法的、也不破坏 C-DET-1/4：
   *
   * - 滚骰这一段画的是 `Panel.mkf` 4/5/6 的 **FLIC**，那是一段「骰子在滚」的画面，
   *   **不含点数**；点数图是滚完之后才盖上去的（`pips()` 只在 `hold` 相位返回非 `null`）。
   *   ⇒ 「先滚起来」既不需要知道点数、也猜不到点数。
   * - 本模块仍然不读 `state`、不写 `state`、不用 `Math.random`（文件头三条铁律不变）；
   *   权威点数一律由 `roll()` 在服务器回包到达时补上。**预测的只是「什么时候画」。**
   *
   * 为什么必须预测：联机时 `dispatch` 只把 intent 发给服务器、本地不 reduce
   * （`main.ts` 的 `dispatch`），若不在这一刻开滚，玩家点 GO 之后要一直等到
   * 「服务器回包 + 本地节拍」才看见骰子动 —— 那就是卡顿。
   *
   * @param flic 必须已经解好；没解好就不预测（那时 `tumbleMs()` 会是 0，相位会当场滑过去）
   * @returns 这一拍**真的**从预动作进了滚骰 ⇒ 调用方据此放骰子音效（别放两次）
   */
  predictRoll(now: number, flic: LoadedFlic | null): boolean {
    if (this.#phase !== 'anticipate' || flic === null) return false;
    this.#phase = 'tumble';
    this.#at = now;
    this.#flic = flic;
    return true;
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
  tick(now: number): boolean {
    return this.#advance(now);
  }

  /**
   * 子阶段到点就自己往下走：tumble → hold → idle
   *
   * @returns 这一拍**刚好把定格播完**（`hold → idle`）时 `true`。
   *
   * ★ 返回值是给 `main.ts` 的 `dicePoll` 用的：它是在函数**中部**调 `tick()`，
   *   所以「动画有没有在这一拍结束」只有 `tick()` 自己知道。尾部那句
   *   `if (active) setTimeout(...)` 在结束那一拍必然为假 —— 靠它去重排，
   *   最后一次「补驱动」就被吞掉了（2026-09-16「掷完骰子人不走」的真根因）。
   *   给一个显式的 `ended` 信号，比让调用方去猜「进来时 active、出去时 idle」可靠。
   */
  #advance(now: number): boolean {
    if (this.#phase === 'tumble' && now - this.#at >= this.tumbleMs()) {
      this.#phase = 'hold';
      this.#at += this.tumbleMs();
    }
    if (this.#phase === 'hold' && now - this.#at >= DICE_HOLD_MS) {
      this.#phase = 'idle';
      this.#flic = null;
      return true;
    }
    return false;
  }
}
