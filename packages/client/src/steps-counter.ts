/*
 * 走子时那串**大数字**（剩余步数）—— 纯函数（W-66-a）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第六份试玩回报第 1 条：「原版有、本引擎没有」的那一块。
 *
 * ## 原版规格 @source 棋盘绘制例程 `0x00409937..0x004099fb`
 *
 * ```asm
 * 00409937  cmp byte [0x46cafb], 0 / je 跳过      ; 行动状态机在跑
 * 00409944  cmp dword [0x48baf8], 0 / je 跳过     ; 剩余步数 != 0
 * 00409951  eax = [0x49910c] ; cmp eax,4 / jge 直接画   ; 替身（4..7）不看下面两条
 * 00409964  test byte [player+0x15], 0x30 / jne 跳过     ; 走回棋盘 / 被挪过 ⇒ 不画
 * 00409971  cmp dword [player+0x32], 0 / jne 跳过        ; 住宿/消失/坐牢/住院 ⇒ 不画
 * 0040998f  sprintf(buf, "%d", [0x48baf8])
 * 004099a8  x = 0xf5 − (strlen × 0x32) / 2         ; 245 − 25×位数
 * 004099c5  每一位：图 = Data.mkf #0x205 的第 (字符 − 0x28) 张（'0' → 图 8 … '9' → 图 17），
 *           带透明（fcn_00456418）贴到 (x, 0x190)；x += 0x32
 * ```
 *
 * `[0x48baf8]` 在**走完一格的那一拍**才减 1
 * （`0x0040d950 call 0x40c05c` 返回 1 → `0x0040d960 dec`）。
 * ⇒ 显示的是**还没走完的格数**：走第一格的途中显示掷出的点数，走到一格减 1，
 *   走完最后一格消失。
 *
 * ⚠️ **本引擎的 `state.stepsRemaining` 在 `step` 这条 action 一派出去就减了**
 *   （补间才刚开始）⇒ 显示值要**补回来**（见 `stepsCounterValue`）。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4），能单测。
 */

/** 数字取自 `Data.mkf` 的那张资源 @source VA 0x004099c5 的 `[0x48bad8]` */
export const STEPS_COUNTER_ARCHIVE = 'Data.mkf';
/** 图 8..17 是十个数字 @source `0x004099c5`：`[0x48bad8]` 里 `'0'` 是第 8 张 */
export const STEPS_COUNTER_RESOURCE = 0x205;
/** `'0'` 的图号；`'9'` = 8 + 9 = 17 @source 同上 */
export const STEPS_DIGIT_BASE_IMAGE = 8;
/** 每一位的横向步进 @source `0x004099d8` 那一族：`x += 0x32` */
export const STEPS_DIGIT_STEP = 0x32;
/** 整串的横向中心 —— `x = 0xf5 − (位数 × 0x32) / 2` @source `0x004099a8`：`0xf5` = 245 */
export const STEPS_COUNTER_CENTER_X = 0xf5;
/** 落点的 y @source `0x004099c5` 的 `0x190` = 400（**屏幕**坐标）*/
export const STEPS_COUNTER_Y = 0x190;

/**
 * 去掉 `stepsRemaining` 那**早减的一格**。
 *
 * 本引擎 `step` 一 action 落地就把 `stepsRemaining` 减了、补间才开始；
 * 而原版是**走完一格的那一拍**才减（`0x0040d960 dec`）—— 所以补间期间要把
 * 那 1 补回来，最后一格补间时显示的是 1（走完才归 0、数字消失）。
 *
 * @param stepsRemaining `state.stepsRemaining`
 * @param walking 此刻是不是**玩家自己**的走子补间在跑
 *   （`!renderer.playerWalkDone()` —— **不是** `walkDone()`，后者含替身；
 *   替身那一趟另走 `renderer.actorStepsLeft()`，见 `render.ts` 的 `actorStepsLeft`，E-22）
 */
export function stepsCounterValue(stepsRemaining: number, walking: boolean): number {
  return stepsRemaining + (walking ? 1 : 0);
}

/** 画这个数字要看的玩家字段 —— 只列判据用到的那几个 */
export interface StepsCounterPlayer {
  /** `player.whoPlays`：`& 0x30` 非 0（走回棋盘 / 被挪过）⇒ 不画 */
  readonly whoPlays: number;
  /** 住宿 / 消失 / 坐牢 / 住院 —— 四项任一非 0 就不画 @source `cmp dword [player+0x32], 0` */
  readonly blocking: {
    readonly inHotel: number;
    readonly disappearing: number;
    readonly inPrison: number;
    readonly inHospital: number;
  };
}

/**
 * 此刻要不要画那串数字。
 *
 * @source 上面那段 `0x00409937..0x00409971` 的四道闸（值 > 0 / 不关押 / 不是被挪）。
 * ★ **不要拿 `phase === 'moving'` 当条件**：最后一格的补间期间 `state.phase`
 *   已经是 `'settling'`，而数字还要显示 1（原版看的是 `[0x48baf8]`，不是相位）。
 */
export function stepsCounterShown(value: number, player: StepsCounterPlayer): boolean {
  if (!(value > 0)) return false;
  if ((player.whoPlays & 0x30) !== 0) return false;
  const b = player.blocking;
  return b.inHotel === 0 && b.disappearing === 0 && b.inPrison === 0 && b.inHospital === 0;
}

/** 一位数字贴在**屏幕**上的哪里 */
export interface StepsDigit {
  /** `Data.mkf #0x205` 的图号（`'0'` → 8 … `'9'` → 17）*/
  readonly image: number;
  /** 屏幕 x（**锚点**，不是左上角 —— 图的锚点在中心，贴图时要减） */
  readonly x: number;
  /** 屏幕 y（同上）*/
  readonly y: number;
}

/**
 * 这串数字每一位贴在哪。
 *
 * @source `0x004099a8` 的 `x = 0xf5 − (位数 × 0x32) / 2` 与逐位 `x += 0x32` ——
 *   即「整串以 `x = 245` 为中心、每位 50、从左边开始」。
 *   1 位 ⇒ 220；2 位 ⇒ 195 / 245；3 位 ⇒ 170 / 220 / 270。
 */
export function stepsCounterPlan(value: number): readonly StepsDigit[] {
  const n = Math.trunc(value);
  if (!(n > 0)) return [];
  const s = String(n);
  const left = STEPS_COUNTER_CENTER_X - ((s.length * STEPS_DIGIT_STEP) >> 1);
  return [...s].map((ch, k) => ({
    image: STEPS_DIGIT_BASE_IMAGE + (ch.charCodeAt(0) - 0x30),
    x: left + STEPS_DIGIT_STEP * k,
    y: STEPS_COUNTER_Y,
  }));
}
