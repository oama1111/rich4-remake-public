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
  fortuneRedrawsBoard,
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

  it('反向：施加阶段不重画棋盘的命運（4 挪用存款）照旧在框上停第二段；新聞 29 也不让（pass 1 在 2400 ms 之后，框已收）', () => {
    resetEventBoxScreen();
    const plain = drew('fortune', 4, false);
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

  it('★ 逐张判据：32 张无条件；2 / 3 / 8 看有没有弹加持框；5 看有没有收到卡；4 从不', () => {
    const { before, after } = drew('fortune', 0, false);
    for (const id of [0, 1, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]) {
      expect(fortuneRedrawsBoard(before, after, id), `命運 ${id}`).toBe(true);
    }
    expect(fortuneRedrawsBoard(before, after, 4)).toBe(false);
    for (const id of [2, 3, 8]) {
      expect(fortuneRedrawsBoard(before, after, id), `命運 ${id} 没弹框`).toBe(false);
      const blessed: GameState = { ...after, notices: [{ key: 'blessing.penaltyVoid', args: ['天使'] }] };
      expect(fortuneRedrawsBoard(before, blessed, id), `命運 ${id} 弹了框`).toBe(true);
    }
    expect(fortuneRedrawsBoard(before, after, 5)).toBe(false);
    const b5: GameState = { ...before, players: before.players.map((p, i) => (i === 1 ? { ...p, cards: [3] } : p)) };
    const a5: GameState = { ...after, players: after.players.map((p, i) => (i === 0 ? { ...p, cards: [3] } : p)) };
    expect(fortuneRedrawsBoard(b5, a5, 5)).toBe(true);
  });

  runExe('★ 回 exe 钉：逐张施加入口后的那一次 `view_to`（0x41d476）', () => {
    // [施加入口 jne 所在, 入口, view_to 调用点]
    const rows: [number, number, number][] = [
      [0x44be27, 0x44becf, 0x44bee8], // 0
      [0x44bfc2, 0x44c067, 0x44c080], // 1
      [0x44c5e9, 0x44c658, 0x44c66f], // 6
      [0x44c6fe, 0x44c76d, 0x44c784], // 7
      [0x44c928, 0x44c978, 0x44c98f], // 9
      [0x44cb5c, 0x44cbac, 0x44cbc3], // 11
      [0x44cc65, 0x44ccd4, 0x44cceb], // 12（13 跳进来）
      [0x44cdab, 0x44ce35, 0x44ce4c], // 14
      [0x44d0e8, 0x44d172, 0x44d189], // 17 18 19 23 24 26 30
      [0x44d235, 0x44d2a9, 0x44d2c0], // 20 21 22 25 27 28 29 31
      [0x44d680, 0x44d6d0, 0x44d6e7], // 32
      [0x44d795, 0x44d80b, 0x44d822], // 33（34–36 跳进来）
    ];
    for (const [jne, entry, call] of rows) {
      const j = exeBytes(jne, 2);
      // jne rel8（0x75）或 jne rel32（0x0f 0x85）
      const target = j[0] === 0x75 ? jne + 2 + ((j[1]! << 24) >> 24) : (() => {
        const b = exeBytes(jne, 6);
        return jne + 6 + ((b[2]! | (b[3]! << 8) | (b[4]! << 16) | (b[5]! << 24)) | 0);
      })();
      expect(target, `jne @${jne.toString(16)}`).toBe(entry);
      expect(callTarget(call), `view_to @${call.toString(16)}`).toBe(0x41d476);
    }
    // 4 挪用存款整支（0x44c2c2..0x44c3b7）没有 `call 0x41d476`
    const d = exeBytes(0x44c2c2, 0x44c3b7 - 0x44c2c2);
    for (let i = 0; i + 5 <= d.length; i++) {
      if (d[i] !== 0xe8) continue;
      const rel = (d[i + 1]! | (d[i + 2]! << 8) | (d[i + 3]! << 16) | (d[i + 4]! << 24)) | 0;
      expect(0x44c2c2 + i + 5 + rel).not.toBe(0x41d476);
    }
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

  runExe('★ 命運 33 那一句（入獄台词）的位置：影片 → 镜头 ② → 台词 → 理賠框 → 回到命運 → 800 ms', () => {
    // send_to_prison：0x0043d6aa 影片 → 0x0043d6f1 view_to(監獄) → 0x0043d71c player_say → 0x0043d749 理賠
    expect(callTarget(0x43d6aa)).toBe(0x45144f);
    expect(callTarget(0x43d6f1)).toBe(0x41d476);
    expect(callTarget(0x43d71c)).toBe(0x44ef41);
    expect(callTarget(0x43d749)).toBe(0x44ba63);
    // 命運 33：0x0044d8c2 send_to_prison 之后 0x0044d8ca jmp 0x44d800（收尾返回）⇒ 回到 0x0044dd7b 的 800 ms
    expect(callTarget(0x44d8c2)).toBe(0x43d593);
    const j = exeBytes(0x44d8ca, 5); // jmp rel32
    expect(j[0]).toBe(0xe9);
    expect(0x44d8ca + 5 + ((j[1]! | (j[2]! << 8) | (j[3]! << 16) | (j[4]! << 24)) | 0)).toBe(0x44d800);
  });

  it('★ 宿主接线：800 ms 要等 pass 1 的台词说完（含押着的）才开始数；数的时候台词不许上台', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const tick = src.slice(src.indexOf('eventBoxTailTick('), src.indexOf('performance.now(),', src.indexOf('eventBoxTailTick(')));
    expect(tick).toContain('speechQueue.length > 0');
    expect(tick).toContain('heldSpeech.length > 0');
    expect(tick).toContain('boardFilm !== null');
    expect(tick).toContain('noticeBoxScreenActive()');
    // 第十六份：「屏上开着一扇框」的判据搬到 `presentation-host.ts`（`eventTail` 在逐屏问 `active()` 的那一组里）
    const host = readFileSync(new URL('./presentation-host.ts', import.meta.url), 'utf8');
    expect(host).toContain("new Set([...DAY_AND_MAGIC_BOXES, 'eventTail'])");
  });
});
