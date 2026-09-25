/*
 * 時光機（道具 10）—— 把这一回合退回去重来
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版是**靠还原快照**实现的，不是逐项撤销：
 *
 * ```asm
 * ; 回合开始时存快照 VA 0x004480a0
 * 004480a0  test byte [player + 0x15], 1   ; ★ who_plays & 1 —— 只给真人存
 * 004480a7  je   不存
 * 004480ce  [槽 + 0x00] = 1                ; 有效位
 * 004480d8  [槽 + 0x04] = [0x497160]       ; 日期
 * 004480e4  memcpy(槽 + 0x008, 0x496b68, 0x1a0)   ; 4 个玩家结构
 * 004480ff  memcpy(槽 + 0x1a8, 0x498e28, 0x050)   ; 特殊角色
 * 00448602  memcpy(槽 + 0x1f8, 0x496d08, 0x450)   ; 物件
 * 00448640  memcpy(槽 + 0x648, 0x499120, 0x03c)   ; 卡片
 * ...                                             ; 道具等
 *
 * ; 用道具时还原 VA 0x00448544
 * 00448568  if (槽.有效位 == 0) return 0    ; ★ 没快照 → 失败
 * 0044857d  [0x497160] = 槽.日期
 * 00448590  memcpy(0x496b68, 槽 + 8, 0x1a0)
 * ...                                       ; 逐块拷回去
 * ```
 * 调用方 `rich4_tool_shiguangji.asm`：
 * ```asm
 * call _rich4_restore_last_state
 * test eax, eax
 * je   loc_00447423          ; ★ 还原失败就**不消耗道具**
 * ...
 * call _rich4_after_player_use_tool(玩家, 10)
 * ```
 *
 * ★ 每个玩家一份快照，槽号就是玩家下标（步长 0x2718，见 loaders/save.ts 的
 *   `PLAYER_SNAPSHOT_SIZE`）。只有 `who_plays == 1`（真人）才会存 ——
 *   这道具本来就是给人用的「后悔药」。
 *
 * ⚠️ **PRNG 不在被拷回的那几块里**，所以退回去重掷骰子点数会不一样。
 *   这正是这个道具的用处；本引擎照此办理（`rngState` 不还原）。
 *
 * ⚠️ 快照里当然不能再套快照，否则一层套一层没完。存的时候把
 *   `snapshots` 清空（见 `takeSnapshot`）。
 */

import type { GameState } from '../state/types.ts';
import { WHO_PLAYS_HUMAN } from '../state/types.ts';

/** 时光机道具编号 */
export const TOOL_TIME_MACHINE = 10;

/**
 * 拍一张快照。
 *
 * 用 JSON 是因为它**天然是深拷贝**：状态里有数组和嵌套对象，浅拷贝
 * 会让快照跟着后续的改动一起变，那种 bug 只在真的用了道具时才现形。
 */
export function takeSnapshot(state: GameState): string {
  // ★ 把 `snapshots` 排除掉：快照里再套快照会一层套一层
  return JSON.stringify(state, (key, value) => (key === 'snapshots' ? undefined : value));
}

/**
 * 给当前玩家存一张時光機快照（`fcn_0044808a`）。
 *
 * @source 0x004480a0 `test byte [player + 0x15], 1` / `0x004480a7 je` —— 只看 **bit0**：
 *   电脑（2）不存；託管中的真人（1|4 = 5）bit0 仍是 1 ⇒ **照存**。
 *
 * ★★ **什么时候拍**（审计 2026-09-24 订正 —— 先前在 `startTurn` 可行动支拍，即「回合开头」）：
 *   `call 0x44808a` 全 exe 只有三处 ——
 *   ```asm
 *   0040dd53  call 0x44808a   ; 起步 `fcn_0040dd1f`：按 GO / 夢遊自动起步（不带 0x30 的人）⇒ `rollDice`
 *   0040c97c  call 0x44808a   ; 回合开头被挡（住宿/消失/坐牢/住院/冬眠，不带 0x30）⇒ `startTurn` 的 skip 支
 *   004477c3  call 0x44808a   ; 傳送機把**自己**传走（工具那一支，归道具区）
 *   ```
 *   ⇒ 用時光機（在自己回合按 GO 之前）退回的是**上一次起步那一刻**（上一回合掷骰之前，含那回合出过的牌），
 *   不是「这一回合开头」—— 后者等于只能撤销这回合按 GO 之前的操作，退不回上一掷。
 */
export function snapshotForTimeMachine(state: GameState): GameState {
  const me = state.players[state.currentPlayer];
  // ★ 2026-09-23 订正：`test byte, 1` 看的是 **bit0** —— 託管的真人（1|4）也存；先前写成整字节 `== 1`
  if (me === undefined || (me.whoPlays & WHO_PLAYS_HUMAN) === 0) return state;
  const snapshots = [...state.snapshots];
  snapshots[state.currentPlayer] = takeSnapshot(state);
  return { ...state, snapshots };
}

/** @deprecated 旧名（时机已改到起步 / 被挡的回合开头，见 `snapshotForTimeMachine`） */
export const snapshotOnTurnStart = snapshotForTimeMachine;

/**
 * 还原当前玩家的快照。
 *
 * 还原不了（没存过）返回 `null` —— 调用方据此决定**不消耗道具**
 * （@source `test eax, eax / je loc_00447423`）。
 */
export function restoreSnapshot(state: GameState): GameState | null {
  const raw = state.snapshots[state.currentPlayer];
  if (raw === undefined || raw === null) return null;
  let restored: unknown;
  try {
    restored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof restored !== 'object' || restored === null) return null;
  return {
    ...(restored as Omit<GameState, 'snapshots'>),
    // ★ 快照本身不回滚：回滚了的话这一份快照会连同「已经用掉一个时光机」
    //   一起复活，等于无限次后悔。
    snapshots: state.snapshots,
    // ⚠️ PRNG 不还原 —— 见文件头
    rngState: state.rngState,
  };
}
