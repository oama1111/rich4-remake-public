/*
 * 命運 pass 1 送人进監獄 / 醫院 / 消失：框在第一段收尾时让位给棋盘，影片之后再对着棋盘停 800 ms
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 协调方裁定（第十五份試玩回報 #1 的后续）：命運那一族要照 exe 的时序 ——
 *   1600 ms 框（`0x0044dd44`）→ pass 1（`0x0044dd71`）：`send_to_*` 开头的 `view_to` 重画棋盘把框抹掉
 *   → 警车 / 救护车 / 飛機（`fcn_0045144f`）→ 理賠框 → 回来 800 ms（`0x0044dd7b`，可点掉）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type GameState } from '@rich4/core';
import {
  eventBoxPlaybackStart,
  eventBoxPlaybackTick,
  eventBoxPlan,
  eventBoxScreen,
  eventBoxTailPending,
  eventBoxTailTick,
  eventBoxYieldsToBoard,
  eventTailScreen,
  fortuneView,
  resetEventBoxScreen,
  FORTUNE_HOLD_MS,
  FORTUNE_SECOND_HOLD_MS,
  NEWS_HOLD_MS,
} from './event-box-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const runExe = existsSync(EXE) ? it : it.skip;
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}
/** `call rel32` 的目标 */
function callTarget(va: number): number {
  const b = exeBytes(va, 5);
  expect(b[0]).toBe(0xe8);
  const rel = (b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24)) | 0;
  return va + 5 + rel;
}

function env(state: GameState, now: number, logs: string[] = []): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [], facilities: [] },
    map: { nodes: [], lands: [] } as never,
    now,
    stage: null as never,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: (m: string) => logs.push(m),
    playEffect: () => undefined,
  } as unknown as UiScreenEnv;
}

/** 0 号抽到 `kind`/`id`；`jailed` = 这一张把他关进監獄（首次） */
function drew(kind: 'news' | 'fortune', id: number, jailed: boolean): { before: GameState; after: GameState } {
  const before = makeGameState({
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, nodeId: 2 + i })),
    currentPlayer: 0,
    lastEvent: null,
  });
  const after: GameState = {
    ...before,
    lastEvent: { kind, id },
    prisonOccupancy: before.prisonOccupancy.map((v, i) => (jailed && i === 0 ? 1 : v)),
    players: before.players.map((p, i) =>
      jailed && i === 0 ? { ...p, nodeId: 1, blocking: { ...p.blocking, inPrison: 3 } } : p,
    ),
  };
  return { before, after };
}

describe('★★ 命運 pass 1 里有 `send_to_*` ⇒ 第一段收尾让出框，800 ms 挪到演出之后', () => {
  it('纯函数：只有带 `yieldAfterFirst` 的那一张、且正好跨进第二段的那一拍才让', () => {
    const p = eventBoxPlaybackStart(eventBoxPlan(fortuneView(33, 1, '甲', 0)), 0);
    const into = eventBoxPlaybackTick(p, FORTUNE_HOLD_MS, null);
    expect(into?.secondAt).toBe(FORTUNE_HOLD_MS);
    expect(eventBoxYieldsToBoard(p, into)).toBe(false);
    expect(eventBoxYieldsToBoard({ ...p, yieldAfterFirst: true }, into)).toBe(true);
    expect(eventBoxYieldsToBoard({ ...p, yieldAfterFirst: true }, p)).toBe(false);
  });

  it('★ 命運 33 入獄：1600 ms 后框收掉 → 等影片 → 800 ms（点不掉影片、点得掉那 800 ms）', () => {
    resetEventBoxScreen();
    const { before, after } = drew('fortune', 33, true);
    const logs: string[] = [];
    eventBoxScreen.event!(before, after, env(after, 0, logs));
    expect(eventBoxScreen.active(env(after, 10))).toBe(true);
    eventBoxScreen.tick!(env(after, FORTUNE_HOLD_MS - 1));
    expect(eventBoxScreen.active(env(after, FORTUNE_HOLD_MS - 1))).toBe(true);
    // 第一段停满：框让位（`view_to` 重画棋盘），后面那一截挂着
    eventBoxScreen.tick!(env(after, FORTUNE_HOLD_MS, logs));
    expect(eventBoxScreen.active(env(after, FORTUNE_HOLD_MS))).toBe(false);
    expect(eventBoxTailPending()).toBe(true);
    expect(eventTailScreen.active(env(after, FORTUNE_HOLD_MS))).toBe(false);
    // 警车在播（busy）：不开始数；也没有屏接点击
    eventBoxTailTick(true, 3000);
    expect(eventTailScreen.active(env(after, 3000))).toBe(false);
    // 片子 / 理賠框都收了 ⇒ 开始数 800 ms
    eventBoxTailTick(false, 4200);
    expect(eventTailScreen.active(env(after, 4200))).toBe(true);
    eventTailScreen.tick!(env(after, 4200 + FORTUNE_SECOND_HOLD_MS - 1));
    expect(eventBoxTailPending()).toBe(true);
    eventTailScreen.tick!(env(after, 4200 + FORTUNE_SECOND_HOLD_MS));
    expect(eventBoxTailPending()).toBe(false);
    resetEventBoxScreen();
  });

  it('★ 那 800 ms 可以点掉（`fcn_004528b9` 认 0x202 / 0x205 / 0x101）；跳过第一段同样让位', () => {
    resetEventBoxScreen();
    const { before, after } = drew('fortune', 33, true);
    eventBoxScreen.event!(before, after, env(after, 0));
    eventBoxScreen.up!(0, 0, env(after, 100)); // 跳过第一段
    expect(eventBoxScreen.active(env(after, 100))).toBe(false);
    expect(eventBoxTailPending()).toBe(true);
    eventBoxTailTick(false, 200);
    eventTailScreen.contextmenu!(0, 0, env(after, 300));
    expect(eventBoxTailPending()).toBe(false);
    resetEventBoxScreen();
  });

  it('反向：没送人的命運照旧（第二段仍在框上停）；新聞 29 也不让（pass 1 在 2400 ms 之后，框已收）', () => {
    resetEventBoxScreen();
    const plain = drew('fortune', 25, false);
    eventBoxScreen.event!(plain.before, plain.after, env(plain.after, 0));
    eventBoxScreen.tick!(env(plain.after, FORTUNE_HOLD_MS));
    expect(eventBoxScreen.active(env(plain.after, FORTUNE_HOLD_MS))).toBe(true);
    expect(eventBoxTailPending()).toBe(false);
    resetEventBoxScreen();
    const news = drew('news', 29, true);
    eventBoxScreen.event!(news.before, news.after, env(news.after, 0));
    eventBoxScreen.tick!(env(news.after, FORTUNE_HOLD_MS));
    expect(eventBoxScreen.active(env(news.after, FORTUNE_HOLD_MS))).toBe(true);
    eventBoxScreen.tick!(env(news.after, NEWS_HOLD_MS));
    expect(eventBoxScreen.active(env(news.after, NEWS_HOLD_MS))).toBe(false);
    expect(eventBoxTailPending()).toBe(false);
    resetEventBoxScreen();
  });

  runExe('★ 回 exe 钉：`send_to_*` / 消失开头的 `view_to` 无条件重画棋盘并刷屏', () => {
    // 三处 `view_to` 调用点（在 `test dh, dh` / 加刑判断**之前**）
    expect(callTarget(0x43d5cc)).toBe(0x41d476); // send_to_prison
    expect(callTarget(0x43ec78)).toBe(0x41d476); // send_to_hospital
    expect(callTarget(0x40d3e6)).toBe(0x41d476); // 消失 0x40d375
    // view_to：0x41d50e call 0x415e70(0) → 0x41d53f call 0x4192f7
    expect(callTarget(0x41d50e)).toBe(0x415e70);
    expect(callTarget(0x41d53f)).toBe(0x4192f7);
    // 0x415e70：call 0x40829d（整块棋盘重画进后台面）→ 0x415f4f or byte [0x475110], 2
    expect(callTarget(0x415ed7)).toBe(0x40829d);
    expect(exeBytes(0x415f4f, 7)).toEqual([0x80, 0x0d, 0x10, 0x51, 0x47, 0x00, 0x02]);
    // 0x4192f7：test dh, 2 → 把棋盘区 (0,0x28)-(0x1b8,0x1e0) 从后台面刷到前台面
    expect(exeBytes(0x4193c4, 3)).toEqual([0xf6, 0xc6, 0x02]);
    // 命運 fcn_0044db81：pass 1 调用 → 0x0044dd7b push 0x320 / call 0x4528b9（800 ms）
    expect(exeBytes(0x44dd71, 7)).toEqual([0xff, 0x94, 0x03, 0xf0, 0x5e, 0x47, 0x00]);
    expect(callTarget(0x44dd80)).toBe(0x4528b9);
  });
});
