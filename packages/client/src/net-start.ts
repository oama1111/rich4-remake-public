/*
 * 聯機開局的**起點局面** —— `start` / `replay` 到了之後本機從哪裡開始（協議 v6）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 兩條路，**與服務器 `room.ts` 逐字段同源**（否則 `stateFingerprint` 對不上）：
 *   · 帶 `snapshot`（從存檔繼續的局）⇒ `deserializeGame(snapshot)`，之後的 action 從 0 號接著施加；
 *   · 不帶 ⇒ 照舊 `newGame(seed + 座位 + 開局設定)`。
 *
 * 抽成純函數是為了讓 `onStart` 與 `onResync` 走**同一段**（兩處各寫一份，遲早漂），
 * 也讓它能在 node 裡單測（`net-start.test.ts` 對著服務器鏡像比指紋）。
 */

import {
  DEFAULT_INITIAL_FUND,
  GAME_INITIAL_FUNDS,
  deserializeGame,
  newGame,
  winConditionsOf,
  type GameState,
  type LobbyOptions,
  type Rich4Map,
  type SeatInfo,
} from '@rich4/core';

export interface NetStartParams {
  seed: number;
  globalMapId: number;
  seats: readonly SeatInfo[];
  options: LobbyOptions;
  /** ★ v6：開局日期（服務器的今天）；舊服務器不帶 ⇒ core 缺省 */
  startDate?: { year: number; month: number; day: number };
  snapshot?: string;
}

export function initialNetState(start: NetStartParams, map: Rich4Map): GameState {
  if (start.snapshot !== undefined) return deserializeGame(start.snapshot);
  return newGame({
    map,
    globalMapId: start.globalMapId,
    players: start.seats.map((s) => ({ character: s.character, kind: s.kind })),
    seed: start.seed,
    mode: 'multiplayer',
    ...(start.startDate === undefined ? {} : { startDate: start.startDate }),
    // ★★ 第十一份試玩回報 #1：房间的**开局选项**（总人数 + 单机那五项）。
    // ★ 用 core 的规则表（不是 setup.ts 的显示表）—— 服务器 `room.ts` 用的就是它，
    //   两处只有**逐字节同一个数**才能保证 `stateFingerprint` 一致。
    initialFund: GAME_INITIAL_FUNDS[start.options.fundIndex] ?? DEFAULT_INITIAL_FUND,
    startingVehicle: start.options.vehicle,
    landTenure: start.options.landTenure,
    winConditions: winConditionsOf(start.options.fundIndex, start.options.timeIndex, start.options.victoryIndex),
  });
}
