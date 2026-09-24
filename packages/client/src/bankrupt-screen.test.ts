/*
 * 「破產」整屏動畫 —— 判据 / 规格 / 时序（第二十五份試玩回報 `20260924-223238961`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type GameState } from '@rich4/core';
import {
  BANKRUPT_BGM,
  BANKRUPT_FILM,
  bankruptFilmActive,
  bankruptFxTriggers,
  bankruptScreen,
  resetBankruptScreen,
} from './bankrupt-screen.ts';
import { BLOCKING_PRESENTATIONS } from './presentation-host.ts';
import { selectOverlay } from './overlay.ts';
import { SCREENS } from './screens.ts';
import type { LoadedFlic } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const stateWith = (whoPlays: readonly number[], over: Partial<GameState> = {}): GameState => ({
  ...makeGameState({
    players: whoPlays.map((w, i) => makePlayer({ index: i, character: i, whoPlays: w })),
  }),
  ...over,
});

/** 假的影片：10 帧、每帧一张占位位图（`boardFilmBitmap` 只要求能取到帧） */
const fakeFlic = (): LoadedFlic =>
  ({
    frames: Array.from({ length: BANKRUPT_FILM.frames }, (_, i) => ({ i }) as unknown as ImageBitmap),
    width: BANKRUPT_FILM.width,
    height: BANKRUPT_FILM.height,
    frameMs: BANKRUPT_FILM.frameMs,
    close: () => undefined,
  }) as unknown as LoadedFlic;

interface Recorder {
  effects: number[];
  music: string[];
  logs: string[];
}

const mkEnv = (
  state: GameState,
  now: number,
  flic: LoadedFlic | null,
  rec: Recorder,
): UiScreenEnv =>
  ({
    state,
    now,
    flic: () => flic,
    playEffect: (id: number) => rec.effects.push(id),
    music: (file: string) => rec.music.push(file),
    log: (m: string) => rec.logs.push(m),
    requestRender: () => undefined,
  }) as unknown as UiScreenEnv;

describe('规格 —— 逐字节核过 `Data.mkf` 0x22b 的资源头与调用点', () => {
  it('资源 / 帧数 / 尺寸 / 落点 / 音效 / flags / 片后静置', () => {
    expect(BANKRUPT_FILM.archive).toBe('Data.mkf');
    expect(BANKRUPT_FILM.resource).toBe(0x22b);
    expect(BANKRUPT_FILM.frames).toBe(10);
    expect(BANKRUPT_FILM.width).toBe(440);
    expect(BANKRUPT_FILM.height).toBe(440);
    expect(BANKRUPT_FILM.frameMs).toBe(71);
    // @source 0x0040cfaa `push 0` / 0x0040cfa8 `push 0x28`
    expect({ x: BANKRUPT_FILM.x, y: BANKRUPT_FILM.y }).toEqual({ x: 0, y: 0x28 });
    // @source 0x0040cfa4 `push 0x64`（Effect.mkf 100）
    expect(BANKRUPT_FILM.sound).toBe(0x64);
    // @source 0x0040cfa6 `push 1` —— bit1 = 0 ⇒ 点不掉
    expect(BANKRUPT_FILM.flags).toBe(0x1);
    // @source 0x0040cfbb `push 0x7d0 / call 0x45285e`
    expect(BANKRUPT_FILM.holdMs).toBe(0x7d0);
    // @source 0x0040cf79 `push 2` ⇒ MIDI03（`SCREEN_BGM.bankrupt`）
    expect(BANKRUPT_BGM).toBe('midi03.mid');
  });
});

describe('判据 —— `who_plays` 从「在场」变「出局」', () => {
  it('刚破产那一位命中（一条 action 里可以不止一位）', () => {
    expect(bankruptFxTriggers(stateWith([1, 2, 2, 2]), stateWith([0, 2, 2, 2]))).toEqual([0]);
    expect(bankruptFxTriggers(stateWith([1, 2, 2, 2]), stateWith([0, 0, 2, 2]))).toEqual([0, 1]);
  });

  it('在场 / 开局未上盘（`whoPlays = 0` → 非 0）/ 原地不动 ⇒ 都不演', () => {
    expect(bankruptFxTriggers(stateWith([1, 2, 2, 2]), stateWith([1, 2, 2, 2]))).toEqual([]);
    // 开局第 2..N 位 who_plays == 0（还没上盘），落地是 **0 → 非 0**，方向相反
    expect(bankruptFxTriggers(stateWith([1, 0, 0, 0]), stateWith([1, 2, 2, 2]))).toEqual([]);
  });

  it('★ 勝利結算清 `who_plays` 那一条 action **不演**（原版走 `0x41d89e`，不经破产函数）', () => {
    const victory = {
      victory: { winner: 1, reason: 'wealthTarget', wealth: 1, code: 2 },
    } as Partial<GameState>;
    expect(bankruptFxTriggers(stateWith([1, 2, 2, 2]), stateWith([0, 2, 0, 0], victory))).toEqual([]);
    // 反例：同样的人出局、但不是胜利结束 ⇒ 照演
    expect(bankruptFxTriggers(stateWith([1, 2, 2, 2]), stateWith([0, 2, 0, 0]))).toEqual([0, 2, 3]);
  });
});

describe('时序 —— 解好才起播；帧放完 + 2000 ms 静置才让位给拍賣屏', () => {
  it('影片还没解出来：排着不播（音频一声都不放），仍占着整屏', () => {
    resetBankruptScreen();
    const rec: Recorder = { effects: [], music: [], logs: [] };
    const dead = stateWith([0, 2, 2, 2]);
    bankruptScreen.event!(stateWith([1, 2, 2, 2]), dead, mkEnv(dead, 0, null, rec));
    expect(bankruptFilmActive()).toBe(true);
    bankruptScreen.tick!(mkEnv(dead, 0, null, rec));
    expect(rec.effects).toEqual([]);
    expect(rec.music).toEqual([]);
    expect(bankruptFilmActive()).toBe(true);
    resetBankruptScreen();
  });

  it('解好后起播：曲 MIDI03 + 音效 100；`10×71 + 2000` ms 到点才收场', () => {
    resetBankruptScreen();
    const rec: Recorder = { effects: [], music: [], logs: [] };
    const flic = fakeFlic();
    const dead = stateWith([0, 2, 2, 2]);
    bankruptScreen.event!(stateWith([1, 2, 2, 2]), dead, mkEnv(dead, 0, flic, rec));
    bankruptScreen.tick!(mkEnv(dead, 0, flic, rec));
    expect(rec.music).toEqual(['midi03.mid']);
    expect(rec.effects).toEqual([0x64]);
    expect(rec.logs[0]).toContain('破產');
    // 片尾之后、静置没等满 ⇒ 还在播
    bankruptScreen.tick!(mkEnv(dead, 10 * 71 + 1000, flic, rec));
    expect(bankruptFilmActive()).toBe(true);
    // 到点 ⇒ 收场，拍賣屏才轮得到
    bankruptScreen.tick!(mkEnv(dead, 10 * 71 + 2000, flic, rec));
    expect(bankruptFilmActive()).toBe(false);
    resetBankruptScreen();
  });

  it('一次 action 里有两位破产 ⇒ 两段接着演（第一段收场后第二段才起播）', () => {
    resetBankruptScreen();
    const rec: Recorder = { effects: [], music: [], logs: [] };
    const flic = fakeFlic();
    const dead = stateWith([0, 0, 2, 2]);
    bankruptScreen.event!(stateWith([1, 2, 2, 2]), dead, mkEnv(dead, 0, flic, rec));
    bankruptScreen.tick!(mkEnv(dead, 0, flic, rec));
    expect(rec.music).toHaveLength(1);
    bankruptScreen.tick!(mkEnv(dead, 10 * 71 + 2000, flic, rec));
    expect(bankruptFilmActive()).toBe(true);
    bankruptScreen.tick!(mkEnv(dead, 10 * 71 + 2001, flic, rec));
    expect(rec.music).toHaveLength(2);
    resetBankruptScreen();
  });

  it('★ `fastForward`（联机旁观被甩下 / 死锁自解）把排着与在播的一并作废', () => {
    resetBankruptScreen();
    const rec: Recorder = { effects: [], music: [], logs: [] };
    const flic = fakeFlic();
    const dead = stateWith([0, 0, 2, 2]);
    bankruptScreen.event!(stateWith([1, 2, 2, 2]), dead, mkEnv(dead, 0, flic, rec));
    bankruptScreen.tick!(mkEnv(dead, 0, flic, rec));
    expect(bankruptScreen.fastForward!(mkEnv(dead, 0, flic, rec))).toBe(true);
    expect(bankruptFilmActive()).toBe(false);
    // 已经空了 ⇒ 再问一次什么都不做
    expect(bankruptScreen.fastForward!(mkEnv(dead, 0, flic, rec))).toBe(false);
    resetBankruptScreen();
  });
});

describe('接线 —— 必须排在拍賣屏之前，且算「纯演出整屏」', () => {
  const screens = readFileSync(new URL('./screens.ts', import.meta.url), 'utf8');

  it('`bankruptScreen` 在 `boardScreen` / `auctionScreen` 之前登记', () => {
    const bankrupt = screens.indexOf('  bankruptScreen,');
    const board = screens.indexOf('  boardScreen,');
    const auction = screens.indexOf('  auctionScreen,');
    expect(bankrupt).toBeGreaterThan(0);
    expect(board).toBeGreaterThan(bankrupt);
    expect(auction).toBeGreaterThan(bankrupt);
  });

  it('在 `BLOCKING_PRESENTATIONS` 里（回合驱动 / 联机收件箱据此等它）', () => {
    expect(BLOCKING_PRESENTATIONS.has('bankrupt')).toBe(true);
  });

  it('`stageBusyFlags` 里接了 `bankruptFx`（事件 25 是 `afterStage`，要等影片）', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('bankruptFx: bankruptFilmActive(),');
  });

  it('★ 破产清算那一刻：`pending` 已是 auction，但接管整屏的必须是 `bankrupt`', () => {
    resetBankruptScreen();
    const rec: Recorder = { effects: [], music: [], logs: [] };
    const flic = fakeFlic();
    // 回報現場的终点：P0 出局、名下地块挂上了破产清算那场拍卖（`seller = −1`）
    const auction = {
      kind: 'auction' as const,
      entityId: 41,
      basePrice: 1500,
      bidders: [1, 2, 3],
      seller: -1,
      seat: 0,
    };
    const dead = {
      ...stateWith([0, 2, 2, 2], { phase: 'awaitingDecision', currentPlayer: 0 }),
      pending: auction as unknown as GameState['pending'],
    };
    const alive = stateWith([1, 2, 2, 2]);
    bankruptScreen.event!(alive, dead, mkEnv(dead, 0, flic, rec));
    // 拍賣屏这一拍也 active（`pending.kind === 'auction'`）—— 顺序决定谁先接管
    expect(SCREENS.find((s) => s.id === 'auction')!.active(mkEnv(dead, 0, flic, rec))).toBe(true);
    expect(selectOverlay(SCREENS, mkEnv(dead, 0, flic, rec))?.id).toBe('bankrupt');
    // 影片收场之后才轮到拍賣屏
    bankruptScreen.tick!(mkEnv(dead, 0, flic, rec));
    bankruptScreen.tick!(mkEnv(dead, 10 * 71 + 2000, flic, rec));
    expect(selectOverlay(SCREENS, mkEnv(dead, 10 * 71 + 2000, flic, rec))?.id).toBe('auction');
    resetBankruptScreen();
  });
});
