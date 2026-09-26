/*
 * 第二十一份（`20260924-122205095`「获得经营权好像有个提示音」）的兄弟框：在公佈欄买股票买成了董事長 ——
 * 公佈欄自己那只訊息框弹「恭喜您獲得經營權！」（1500 ms，只给真人），**不放音效**。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `fcn_004255da` 股票那一支：`0x0042571e call 0x4294d5` → `0x00425726 cmp eax,1` →
 *   `0x00425732 cmp byte [買家+0x15],1` → `0x0042573d push 0x463e5f / call 0x424502` → `0x0042574a push 0x5dc / call 0x4528b9`。
 *
 * 用真的 `reduce` 走一遍「P1 挂股票 → P0 在公佈欄买下 → 持股最多易主」，再把前后局面交给 `boardScreen.event`。
 * 单机与联机都走这一条（联机时 action 由服务器广播回来、`notifyApplied` 照样把前后局面派给各屏）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { LISTING, newGame, parseMap, reduce, type GameState, type MapTopology } from '@rich4/core';
import {
  BOARD_CHAIRMAN_MSG,
  BOARD_MSG_MS,
  boardChairmanGained,
  boardScreen,
  resetBoardScreen,
} from './board-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

function scene(p0Kind: 'human' | 'computer'): { before: GameState; after: GameState; topo: MapTopology } {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
  const g = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i === 0 ? p0Kind : ('computer' as const) })),
    seed: 11,
  });
  // 找一支挂在企業上的股票，让 P1 持 2000 股、当董事長
  const k = g.market.stocks.findIndex((s) => (s.commercialIndex ?? 0) !== 0);
  expect(k).toBeGreaterThanOrEqual(0);
  const cid = g.market.stocks[k]!.commercialIndex;
  const holdings = g.holdings.map((row, p) => row.map((h, j) => (j === k && p === 1 ? { ...h, amount: 2000, avgCost: 10 } : h)));
  const commercialOwners = g.commercialOwners.map((o, i) => (i === cid ? { ...o, owner: 2, ranking: [2, 0, 0, 0] } : o));
  // 开局还没「降落」的玩家 `whoPlays` 是 0（出局）—— 照座位种类摆好（1 = 真人、2 = 电脑）
  const players = g.players.map((p, i) => ({ ...p, whoPlays: i === 0 && p0Kind === 'human' ? 1 : 2, nodeId: 1 }));
  let s: GameState = { ...g, players, holdings, commercialOwners, currentPlayer: 1, phase: 'awaitingRoll', pending: null };
  // P1 把 2000 股全挂出去
  s = reduce(s, { type: 'noticeBoard', op: 'list', kind: LISTING.stock, id: k, price: 100, amount: 2000 }, topo);
  expect(s.noticeBoard[1]?.some((x) => x !== null)).toBe(true);
  const slot = s.noticeBoard[1]!.findIndex((x) => x !== null);
  const before: GameState = { ...s, currentPlayer: 0, players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 500_000 } : p)) };
  const after = reduce(before, { type: 'noticeBoard', op: 'buy', seller: 1, slot }, topo);
  return { before, after, topo };
}

function envOf(state: GameState, topo: MapTopology, now = 1000): UiScreenEnv & { logs: string[] } {
  const logs: string[] = [];
  return {
    screen: 'game',
    state,
    topo,
    now,
    log: (m: string) => logs.push(m),
    logs,
    requestRender: () => undefined,
    dispatch: () => undefined,
  } as unknown as UiScreenEnv & { logs: string[] };
}

describe('★★ 公佈欄买股票买成董事長 ⇒ 「恭喜您獲得經營權！」', () => {
  run('core：公佈欄成交后持股最多易主（`0x0042571e call 0x4294d5`）', () => {
    const { before, after } = scene('human');
    expect(boardChairmanGained(before, after, 0)).toBe(true);
    expect(boardChairmanGained(before, after, 1)).toBe(false);
  });

  run('真人买家、公佈欄开着 ⇒ 弹那只框 1500 ms（串 `0x463e5f`），到时自己收', () => {
    const { before, after, topo } = scene('human');
    resetBoardScreen();
    const env = envOf(before, topo);
    expect(boardScreen.hotkey?.(13, env)).toBe(true);
    const env2 = envOf(after, topo);
    boardScreen.event?.(before, after, env2);
    expect(env2.logs).toContain('公佈欄：恭喜您獲得經營權！');
    expect(BOARD_CHAIRMAN_MSG).toBe('恭喜您獲得經營權！');
    // 到时自己收（`0x4528b9(0x5dc)` → `0x424620`）
    boardScreen.tick?.(envOf(after, topo, 1000 + BOARD_MSG_MS - 1));
    const still = envOf(after, topo, 1000 + BOARD_MSG_MS - 1);
    boardScreen.event?.(after, after, still); // 同一局面再派一次不会重弹
    expect(still.logs).toEqual([]);
  });

  run('电脑买家 ⇒ 不弹（`0x00425732 cmp [+0x15],1 / jne`）', () => {
    const { before, after, topo } = scene('computer');
    resetBoardScreen();
    const env = envOf(before, topo);
    boardScreen.hotkey?.(13, env);
    const env2 = envOf(after, topo);
    boardScreen.event?.(before, after, env2);
    expect(env2.logs).not.toContain('公佈欄：恭喜您獲得經營權！');
  });

  it('`boardChairmanGained`：不是公佈欄成交（noticeBoard 没变）⇒ false', () => {
    const s = { noticeBoard: [], commercialOwners: [{ owner: 0, ranking: [0, 0, 0, 0] }] } as unknown as GameState;
    const t = { ...s, commercialOwners: [{ owner: 1, ranking: [1, 0, 0, 0] }] } as unknown as GameState;
    expect(boardChairmanGained(s, t, 0)).toBe(false);
  });
});
