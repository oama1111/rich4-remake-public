/*
 * 走子音效（MOVE_SOUND）—— **这一拍该不该放音** 的纯函数
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只做「读一个已知状态 → 给一个布尔」的判断，不含任何规则、
 *   不碰 DOM、不碰音频。宿主（`main.ts`）拿它的结果去 `SoundPlayer`。
 *
 * ── 为什么要有这个模块 ──
 *
 * 需求方第 5 轮反馈里有一条「走子音效像逐格响」。查证 exe 之后**原版就是逐格响**
 * （下面那张 VA 表），所以这一条不是「音效次数」的缺口；真正与 exe 不一致的是
 * **同一段音频会叠着播**：原版每一格都是 `Stop` 了上一路再 `Play`，永远只有一路
 * （`[0x4749d4]` 就是「当前这一路移动音效」的索引）。本模块因此把原版那一拍的
 * **转移**（stop / play / 什么都不做）算清楚，宿主照做即可。
 *
 * ⚠️ 上一轮 `docs/deviations/Q-DOLL-1.md` 的残留项②把这段读成
 *   **「一次移动只放一次」**，并在 `known-deviations.md` 的 Q-TURN-1 §5 里把
 *   跳表的 state 1 / state 2 **对调了**。两处都已在 `docs/deviations/Q-SOUND-1.md`
 *   订正 —— 判据是 `fcn_0040d7c4`（VA 0x0040d7c4）的跳表 `0x40d7b4` 本身。
 *
 * ── exe 取证（VA 逐条）──
 *
 * | 时刻 | 做什么 | 出处 |
 * |---|---|---|
 * | 掷完骰、起步 | `Play` 一次（索引 = `traffic_method & 3 + 0xb`）| VA 0x0040d9f2（state 2 尾）、0x0040dde1（`fcn_0040dd1f` 的 `state == 1` 支）|
 * | 每走完一格、进下一格 | 再 `Play` 一次（**同一路**，不先 Stop）| VA 0x0040d9f2，由 `[0x498ea3] == 每向帧数` 门控 |
 * | 整趟走完（剩 0 步）| `Stop`（同一个 `[0x4749d4]`）| VA 0x0040d8dc |
 * | `[0x498ea1] != 0`（备用精灵组）| 改播索引 15 → 音效 **47** | VA 0x0040d9ce |
 * | 逐格推进本身 | **一个 `play_sound_effect` 都没有** | `fcn_0040c05c`（VA 0x0040c05c）的全部 call 里没有 0x4542ce |
 *
 * 两个函数别再混：**0x4542ce = `rich4_play_sound_effect`（放）**、
 * **0x4542e9 = 停止**（内部是 `IDirectSoundBuffer::Stop`，vtable +0x48）。
 */

import { MOVE_SOUND } from '@rich4/assets-pipeline';

/** 备用精灵组的移动音效号 —— `[0x498ea1 + 玩家号] != 0` 时原版改播这一号 @source VA 0x0040d9ce（索引 15 = 表 0x4823c2）*/
export const MOVE_SOUND_ALT = 47;

/** 走子音效的一拍 |
 * `null` = 这一拍什么都不做 */
export type MoveSoundStep = 'play' | 'stop' | null;

/** 上一拍留下的、算这一拍要用到的**全部**状态 */
export interface MoveSoundState {
  /** 上一拍是哪一号（`null` = 没有音效在放）—— 对应原版的 `[0x4749d4]` */
  moveSoundId: number | null;
  /** 上一次「起步/换格」时玩家在哪一格（`0` = 还没起过步）—— 对应 `[0x48bafc]` */
  moveSoundCell: number;
}

/** 初始状态：没有任何移动音效在放 */
export const MOVE_SOUND_IDLE: MoveSoundState = { moveSoundId: null, moveSoundCell: 0 };

/**
 * 走/gate 的那一号 —— 按 `traffic_method` 查表。
 *
 * @source VA 0x0040d9da 起（`fcn_0040d7c4` 的 state 2 尾）：
 * ```asm
 * mov al, byte [player + 0x11]   ; traffic_method
 * and al, 3
 * add eax, 0xb                   ; → 索引 11..14
 * mov [0x4749d4], eax
 * ```
 * 表 `0x48234a` 每项 8 字节、第一 dword 就是 `Effect.mkf` 的资源号：
 * 索引 11 → 0x4823a2 = **44**（走路）、12 → 0x4823aa = **45**（機車）、
 * 13 → 0x4823b2 = **46**（汽車）、14 → 0x4823ba = **53**（船）。
 *
 * @param trafficMethod 玩家记录的 `traffic_method`（`player + 0x11`）
 * @param altSlot 原版 `[0x498ea1]`（备用精灵组）非 0 —— 本引擎目前恒为 `false`
 *   （那个语义「精灵刚重载?」没查实，**没有**按它分流的授权）
 */
export function moveSoundId(trafficMethod: number, altSlot = false): number {
  if (altSlot) return MOVE_SOUND_ALT;
  const id = MOVE_SOUND[trafficMethod & 3];
  // 表只有 4 项、下标被 &3 夹住，理论上到不了这里；真到了就返回一个明确的值
  return id ?? MOVE_SOUND[0] ?? MOVE_SOUND_ALT;
}

/**
 * 这一拍该放音还是该停 —— 纯函数。
 *
 * 规则严格照 `fcn_0040d7c4` 的两支：
 *  - `moving === false`：走子段不再推进（`[0x48baf8] == 0`）→ 若上一拍有音在放就 **stop**，
 *    并把状态清干净。@source VA 0x0040d8dc
 *  - `moving === true`：
 *    - `cellId !== 上一拍的格` → **play**（起步那一拍也是这条：`moveSoundCell` 还是 0）
 *      @source VA 0x0040d9f2
 *    - `cellId === 上一拍的格` → `null`（**这一拍什么都不做** —— 这就是
 *      「补间还没走完/同一个格子」的那几 tick，原版由 `[0x498ea3]` 计满才放）
 *
 * ★ 于是「走 N 格 = **N 次** play」是**期望值**，不是 bug：起步算第 1 格。
 *   这条钉子见 `move-sound.test.ts`。
 */
export function moveSoundStep(
  prev: MoveSoundState,
  context: { trafficMethod: number; cellId: number; moving: boolean; altSlot?: boolean },
): { step: MoveSoundStep; id: number | null; state: MoveSoundState } {
  if (!context.moving) {
    return {
      step: prev.moveSoundId === null ? null : 'stop',
      id: null,
      state: MOVE_SOUND_IDLE,
    };
  }
  if (context.cellId !== prev.moveSoundCell) {
    const id = moveSoundId(context.trafficMethod, context.altSlot === true);
    return { step: 'play', id, state: { moveSoundId: id, moveSoundCell: context.cellId } };
  }
  return { step: null, id: null, state: prev };
}
