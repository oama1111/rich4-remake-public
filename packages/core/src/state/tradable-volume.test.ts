/*
 * 股市可成交量重算（`fcn_0042915a`）的**调用时机** —— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 全 exe 只有两个调用点：
 *   · 开局 `0x00407dfe`（摆完物件、算完各企业自留股之后，第 1 位摆人之前）→ `newGame`；
 *   · 每位**玩家**回合开头 `0x0041c868`（`fcn_0041c84f` 第一句，惡人槽 `cmp ebx, 4 / jge` 跳过，
 *     在 who_plays 判定 `0x0041c875` 之前 ⇒ 没上盘的人也调）→ `beginActorTurn`。
 *   推日期 `0x41cf67` 里**没有**它（先前本引擎每天调一次，第 2..N 位回合开头那几次都少抽）。
 *
 * 断言都对一份**独立重写**的算式：股本 ≤ 1000 原样；否则 `trunc(股本 × (rand()%2000 + 1000) / 10000)`，
 * 每支大盘股一次 `rand()`、按股票下标顺序。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { createDeck, FORTUNE_DECK_SIZE, NEWS_DECK_SIZE } from '../events/deck.ts';
import { INITIAL_OBJECT_TYPES } from '../rules/object-landing.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { landAll, topoOf } from '../testing/factories.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const MAP = `${ROOT}/extracted/map/0001.bin`;
const EXE = `${ROOT}/Rich4/rich4.exe`;
const run = existsSync(MAP) ? it : it.skip;
const runExe = existsSync(EXE) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const computers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ character: (i * 3) % 12, kind: 'computer' as const }));

/** 独立重写的 `fcn_0042915a`：返回新的 f10 表与推进后的 rngState */
function refRefresh(stocks: readonly { shares: number }[], rngState: number): { f10: number[]; rngState: number } {
  const rng = new WatcomRng();
  rng.setState(rngState);
  const f10 = stocks.map((s) => (s.shares <= 1000 ? s.shares : Math.trunc((s.shares * ((rng.next() % 2000) + 1000)) / 10000) & 0xffff));
  return { f10, rngState: rng.getState() };
}

describe('★ 调用点只有两处（exe 字节）', () => {
  runExe('全代码段里 `call 0x42915a` 恰好是 0x00407dfe 与 0x0041c868；后者前面是「惡人槽跳过」', () => {
    const d = readFileSync(EXE);
    const CODE_VA = 0x401000;
    const CODE_OFF = 1024;
    const CODE_SIZE = 394240;
    const hits: number[] = [];
    for (let off = CODE_OFF; off < CODE_OFF + CODE_SIZE - 5; off++) {
      if (d[off] !== 0xe8) continue;
      const va = off - CODE_OFF + CODE_VA;
      if (va + 5 + d.readInt32LE(off + 1) === 0x42915a) hits.push(va);
    }
    expect(hits).toEqual([0x407dfe, 0x41c868]);
    // 0041c85f  83 fb 04        cmp ebx, 4
    // 0041c862  0f 8d …         jge 0x41ce39（惡人槽那一段）
    const at = 0x41c85f - CODE_VA + CODE_OFF;
    expect([...d.subarray(at, at + 5)]).toEqual([0x83, 0xfb, 0x04, 0x0f, 0x8d]);
  });
});

describe('★ 开局那一次（`0x00407dfe`）', () => {
  run('摆完 8 个物件之后重算一次，然后才轮到第 1 位摆人', () => {
    const map = loadMap();
    for (const seed of [1, 99, 4242]) {
      // `startNodeId` 钩子不抽摆人签 ⇒ 它的 rngState / 行情正好停在「开局重算之后」
      const s = newGame({ map, players: computers(4), seed, startNodeId: 1 });
      const rng = new WatcomRng(seed >>> 0);
      createDeck(rng, NEWS_DECK_SIZE);
      createDeck(rng, FORTUNE_DECK_SIZE);
      for (let i = 0; i < INITIAL_OBJECT_TYPES.length; i++) rng.next(); // 开局摆物件每个一次（`0x00407d6a`）
      const want = refRefresh(s.market.stocks, rng.getState());
      expect(s.market.stocks.map((x) => x.f10), `种子 ${seed}`).toEqual(want.f10);
      expect(s.rngState, `种子 ${seed}`).toBe(want.rngState);
      // 有鉴别力：确实有大盘股（抽过签），也确实有小盘股（原样）
      expect(s.market.stocks.some((x) => x.shares > 1000)).toBe(true);
    }
  });
});

describe('★ 每位玩家回合开头（`0x0041c868`）', () => {
  run('换人那条 endTurn（不绕回、不推日期）：新当前玩家回合开头重算一次，抽签在一切之前', () => {
    const map = loadMap();
    const topo = topoOf(map);
    for (const seed of [3, 17]) {
      const s0 = landAll(newGame({ map, players: computers(4), seed }), map.nodes);
      for (const from of [0, 1, 2]) {
        const before: GameState = { ...s0, currentPlayer: from, phase: 'turnEnd', pendingNpcSlots: [] };
        const after = reduce(before, { type: 'endTurn' }, topo);
        expect(after.currentPlayer).toBe(from + 1);
        expect(after.year * 10000 + after.month * 100 + after.day).toBe(before.year * 10000 + before.month * 100 + before.day);
        const want = refRefresh(before.market.stocks, before.rngState);
        expect(after.market.stocks.map((x) => x.f10), `种子 ${seed} P${from + 1}→P${from + 2}`).toEqual(want.f10);
        // 新开局的人没有阻碍 / 贷款 ⇒ 回合开头别的都不抽 ⇒ rngState 正好推进这么多
        expect(after.rngState).toBe(want.rngState);
      }
    }
  });

  run('还没上盘的人也照调（在 who_plays 判定之前）：先重算、再摆人', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: computers(3), seed: 5 });
    const before: GameState = { ...s0, phase: 'turnEnd', pendingNpcSlots: [] };
    const after = reduce(before, { type: 'endTurn' }, topo);
    const want = refRefresh(before.market.stocks, before.rngState);
    expect(after.market.stocks.map((x) => x.f10)).toEqual(want.f10);
    // 摆人的两次抽签接在它后面（逐项对照见 `rules/start-placement.test.ts` ②）
    expect(after.rngState).not.toBe(want.rngState);
    expect(after.players[1]!.xpos).toBeGreaterThan(0);
  });

  run('「走回棋盘」那一回合不换人、不调 `0x41c84f` ⇒ 不重算（`0x00418f8e jmp 0x419058`）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = landAll(newGame({ map, players: computers(2), seed: 8 }), map.nodes);
    const before: GameState = {
      ...s0,
      phase: 'turnEnd',
      pendingNpcSlots: [],
      players: s0.players.map((p, i) => (i === 0 ? { ...p, whoPlays: p.whoPlays | 0x10 } : p)),
    };
    const after = reduce(before, { type: 'endTurn' }, topo);
    expect(after.currentPlayer).toBe(0);
    expect(after.market).toBe(before.market);
    expect(after.rngState).toBe(before.rngState);
  });
});
