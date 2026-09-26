/*
 * 电脑换车那一扇「使用汽車」框底下，棋子**还是换车之前那一套图** —— 纯表现
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 第二十六份試玩回報（`20260924-234350490`，联机）：「约翰乔的汽车哪里来的」。
 *
 * 原版电脑用道具（`0x00448039..0x0044807e`）是**先**弹框、**再**进道具函数：
 *
 * ```asm
 * 0044804c  mov  edx, [eax*8 + 0x47feda]      ; 道具名
 * 00448054  push 0x4653e5                     ; 「使用%s」
 * 0044805e  call 0x457110                     ; sprintf
 * 00448066  push 0x5dc
 * 00448070  call 0x440cac                     ; ★ 訊息框，阻塞 1500 ms —— 此时棋子还是旧图组
 * 0044807e  call [eax*4 + 0x475dd5]           ; 道具函数
 * ```
 * 汽車（`_rich4_use_tool_qiche` 0x00446f05，表 `0x475dd5 + 6*4`；機車 0x00446e4a 同形）：
 * ```asm
 * 00446f3d  mov byte [player+0x11], 2 / mov byte [player+0x12], 3   ; 交通 = 汽車、骰子 = 3
 *           push 當前玩家 / call 0x40b93b                          ; ★ _rich4_update_player_sprite：换图组
 *           push 1 / push 0 / push 0 / call 0x41d476               ; view_to(0,0,1)：只重画，不动镜头
 *           push [_tool_strings + 角色*0x68 + 20] / push 0 / push 當前玩家
 *           call 0x44ef41                                          ; 道具台词「#0235 嗨！寶貝～一起去兜風吧！」
 * ```
 * ⇒ 旁观者看到的次序是：**框（旧图）→ 换成车 → 台词**。
 *
 * core 一条 `useTool` 就把 `trafficMethod` / `ndices` 写完，棋盘照 `state` 画就会在框**还没弹完**时
 * 先露出车来。本模块只做一件事：认出「这一条 action 是电脑换车、且弹了『使用%s』框」，
 * 框没收之前让棋盘上那一位按换车**之前**的交通方式画；框收掉那一拍放开（= 原版 `0x40b93b` 那一刻）。
 * 道具台词本来就排在框之后（`presentation-order.ts`：`tool.aiUse` 是 `lead` 档、道具台词 `beforeStage`）。
 *
 * ★ 真人用车没有这扇框（真人走道具欄 `0x447d97`，不经 `0x00448070`）⇒ 不按住，当场换图 —— 与原版一致。
 * ★ 单机 / 联机同一条路：两边都是 `startActionFx` 认 `before → after`（联机旁观端收到的是同一条 action）。
 * ★ C-DET-4：只返回给渲染器看的副本，不写 `state`；判据只读 core 交出来的 `lastToolUsed` 与 `notices`。
 */

import { VEHICLE_TOOLS, type GameState } from '@rich4/core';

/** 电脑用道具那一扇框的文案键（`0x00448054 push 0x4653e5`「使用%s」）*/
export const AI_TOOL_NOTICE_KEY = 'tool.aiUse';

export interface VehicleHold {
  /** 换车的那一位 */
  player: number;
  /** 框底下该画的交通方式（换车之前）*/
  trafficMethod: number;
  /** 同时按住的骰子数（换车之前）—— 掷骰 UI 读它，框没收之前不该先变 */
  ndices: number;
}

/**
 * 这一条 action 要不要按住。
 *
 * 三条都要：`lastToolUsed` 换了引用（= 本 action 真的用出去了一件）、那件是交通工具、
 * `notices` 换了引用且里面有「使用%s」（= 本 action 弹的，电脑那一支）；
 * 另外那一位的交通方式真的变了（换乘同种车原版 `jmp 结束`，core 不会写 `lastToolUsed`，这条只是保险）。
 */
export function vehicleHoldOf(
  before: Pick<GameState, 'lastToolUsed' | 'notices' | 'players'>,
  after: Pick<GameState, 'lastToolUsed' | 'notices' | 'players'>,
): VehicleHold | null {
  const use = after.lastToolUsed ?? null;
  if (use === null || use === (before.lastToolUsed ?? null)) return null;
  if (!VEHICLE_TOOLS.has(use.toolId)) return null;
  if (after.notices === before.notices) return null;
  if (!after.notices.some((n) => n.key === AI_TOOL_NOTICE_KEY)) return null;
  const was = before.players[use.player];
  const now = after.players[use.player];
  if (was === undefined || now === undefined) return null;
  if (was.trafficMethod === now.trafficMethod) return null;
  return { player: use.player, trafficMethod: was.trafficMethod, ndices: was.ndices };
}

/** 按住：`view` 里那一位换回换车之前的交通方式与骰子数（其余一个字节不动）*/
export function applyVehicleHold(view: GameState, hold: VehicleHold | null): GameState {
  if (hold === null) return view;
  const p = view.players[hold.player];
  if (p === undefined) return view;
  if (p.trafficMethod === hold.trafficMethod && p.ndices === hold.ndices) return view;
  const players = [...view.players];
  players[hold.player] = { ...p, trafficMethod: hold.trafficMethod, ndices: hold.ndices };
  return { ...view, players };
}
