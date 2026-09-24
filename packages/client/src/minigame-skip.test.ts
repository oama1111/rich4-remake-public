/*
 * 结算大号分数那 2 秒能不能点掉 —— 三屏逐个对 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * - 企鵝：左键 / 双击入口 0x00414aa9 `cmp [0x48bd58], 2` → 0x00414ab2 `mov [0x48bd2c], 1`，
 *   下一个 100ms WM_TIMER `dec` 到 0 → `KillTimer` + `fcn_00401966(0)`（0x0041491d..0x0041494a）⇒ **能跳，下一拍关**。
 * - 七彩氣球：左键入口 0x00414d9f `cmp [0x48bd58], 2 / je` 直接忽略；2 秒是 `fcn_0045285e(0x7d0)`
 *   @0x00414d3d 的阻塞忙等，`PeekMessage(PM_REMOVE)` 把点击吃掉 ⇒ **跳不过**。
 * - 財神：窗口过程根本不收 0x201/0x203（0x00414fdb..0x0041500a 只分派 0xf/0x113/0x401/0x405）；
 *   2 秒同样是 `fcn_0045285e(0x7d0)` @0x00415144 ⇒ **跳不过**。
 *
 * 联机：只有玩家本人那台能跳（旁观端 `down` 开头就返回，照旧等玩家那台的 `minigame` 广播）；
 * 跳只挪「何时关屏」，送分仍只在 `tick` 里送一次。
 */
import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '@rich4/core';
import type { GameState } from '@rich4/core';
import {
  MINI_END_MS,
  PENGUIN_TICK_MS,
  minigameRunPhase,
  minigameScreen,
  minigameTickMs,
  penguinSkipScore,
  penguinStart,
} from './minigame-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

type Sink = { dispatched: unknown[] };

const mkEnv = (game: number, now: number, localSeat: number | undefined, sink: Sink, pending = true): UiScreenEnv => {
  const state = {
    pending: pending ? { kind: 'minigame', game } : null,
    currentPlayer: 0,
    players: [
      { whoPlays: 1, points: 0, character: 0 },
      { whoPlays: 1, points: 0, character: 0 },
    ],
    day: 1,
    month: 1,
    year: 1,
  } as unknown as GameState;
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [], facilities: [] } as never,
    map: null as never,
    now,
    stage: { drawImage: () => undefined } as unknown as CanvasRenderingContext2D,
    animation: false,
    sprite: () => null,
    flic: () => null,
    dispatch: (a) => sink.dispatched.push(a),
    requestRender: () => undefined,
    log: () => undefined,
    playEffect: () => undefined,
    stopEffect: () => undefined,
    ...(localSeat === undefined ? {} : { localSeat }),
  };
};

/**
 * 开一局，每 `step` ms 推一拍，推到进入 `score`（大号分数）相为止。
 * @returns 进入 `score` 那一刻的时间
 */
function playToScore(game: number, seat: number | undefined, sink: Sink): number {
  minigameScreen.tick!(mkEnv(game, 0, seat, sink, false)); // 清掉上一局
  const step = minigameTickMs(game);
  let now = 1000;
  minigameScreen.tick!(mkEnv(game, now, seat, sink));
  for (let i = 0; i < 5000 && minigameRunPhase() !== 'score'; i++) {
    now += step;
    minigameScreen.tick!(mkEnv(game, now, seat, sink));
  }
  expect(minigameRunPhase()).toBe('score');
  expect(sink.dispatched).toEqual([]);
  return now;
}

/** 从 `from` 起每 `step` ms 推一拍（期间可每拍点一下），推到送分或到 `until` 为止；返回送分时刻 */
function runUntilSent(
  game: number,
  seat: number | undefined,
  sink: Sink,
  from: number,
  until: number,
  clickEachTick = false,
): number | null {
  const step = 10; // 比定时器细，才量得出「下一拍」
  for (let now = from + step; now <= until; now += step) {
    if (clickEachTick) minigameScreen.down!(100, 100, mkEnv(game, now, seat, sink));
    minigameScreen.tick!(mkEnv(game, now, seat, sink));
    if (sink.dispatched.length > 0) return now;
  }
  return null;
}

describe('★ penguinSkipScore @source 0x00414aa9..0x00414ab2', () => {
  it('只在 score 相生效，且只会提前、不会推后', () => {
    const base = penguinStart(7);
    expect(penguinSkipScore({ ...base, phase: 'play' }, 10)).toEqual({ ...base, phase: 'play' });
    expect(penguinSkipScore({ ...base, phase: 'end' }, 10)).toEqual({ ...base, phase: 'end' });
    const scoring = { ...base, phase: 'score' as const, scoreUntil: 5000 };
    expect(penguinSkipScore(scoring, 3100).scoreUntil).toBe(3100);
    expect(penguinSkipScore(scoring, 6000)).toBe(scoring);
  });
});

describe('★★ 企鵝：大号分数那 2 秒点一下 → 下一拍关屏、只送一次分', () => {
  const G = SPECIAL_KIND.PENGUIN_DIG;

  for (const [name, seat] of [
    ['单机', undefined],
    ['联机·玩家本人', 0],
  ] as const) {
    it(`${name}：不点满 2 秒才送；点了下一拍（≤ 100ms）就送，且之后再点再推都不重送`, () => {
      // 不点：照旧 2000ms
      {
        const sink: Sink = { dispatched: [] };
        const t0 = playToScore(G, seat, sink);
        const sent = runUntilSent(G, seat, sink, t0, t0 + 3000);
        expect(sent).not.toBeNull();
        expect(sent! - t0).toBeGreaterThanOrEqual(MINI_END_MS);
      }
      // 点：300ms 时点一下
      const sink: Sink = { dispatched: [] };
      const t0 = playToScore(G, seat, sink);
      expect(runUntilSent(G, seat, sink, t0, t0 + 300)).toBeNull();
      const clickAt = t0 + 305;
      minigameScreen.down!(100, 100, mkEnv(G, clickAt, seat, sink));
      // 点的当下不送（原版只把剩余拍数改成 1）
      expect(sink.dispatched).toEqual([]);
      const sent = runUntilSent(G, seat, sink, clickAt, clickAt + 1000);
      expect(sent).not.toBeNull();
      expect(sent! - clickAt).toBeLessThanOrEqual(PENGUIN_TICK_MS);
      expect(sink.dispatched).toEqual([{ type: 'minigame', score: 0 }]);
      // 再点、再推：不重送
      for (let i = 1; i <= 50; i++) {
        minigameScreen.down!(100, 100, mkEnv(G, sent! + i * 10, seat, sink));
        minigameScreen.tick!(mkEnv(G, sent! + i * 10, seat, sink));
      }
      expect(sink.dispatched).toHaveLength(1);
    });
  }

  it('结算姿势那一段（score 之前）点了不算：不会提前送分', () => {
    const sink: Sink = { dispatched: [] };
    minigameScreen.tick!(mkEnv(G, 0, undefined, sink, false));
    let now = 1000;
    minigameScreen.tick!(mkEnv(G, now, undefined, sink));
    let scoreAt: number | null = null;
    for (let i = 0; i < 1000 && sink.dispatched.length === 0; i++) {
      now += PENGUIN_TICK_MS;
      // 每拍都点（入场、挖宝、结算姿势都点）—— 只有进了 score 才能跳
      if (minigameRunPhase() !== 'score') minigameScreen.down!(100, 100, mkEnv(G, now, undefined, sink));
      minigameScreen.tick!(mkEnv(G, now, undefined, sink));
      if (scoreAt === null && minigameRunPhase() === 'score') scoreAt = now;
    }
    expect(scoreAt).not.toBeNull();
    // 姿势段的点击没有把 score 相缩短
    expect(now - scoreAt!).toBeGreaterThanOrEqual(MINI_END_MS);
    expect(sink.dispatched).toHaveLength(1);
  });

  it('联机·旁观：点了不跳、也从不送分；玩家那台的分到了（pending 清）才关', () => {
    const sink: Sink = { dispatched: [] };
    const t0 = playToScore(G, 1, sink);
    expect(runUntilSent(G, 1, sink, t0, t0 + 5000, true)).toBeNull();
    expect(sink.dispatched).toEqual([]);
    expect(minigameScreen.active(mkEnv(G, t0 + 5000, 1, sink))).toBe(true);
    minigameScreen.tick!(mkEnv(G, t0 + 5010, 1, sink, false));
    expect(minigameScreen.active(mkEnv(G, t0 + 5010, 1, sink, false))).toBe(false);
  });
});

describe('★★ 七彩氣球 / 財神：大号分数那 2 秒是 fcn_0045285e 的阻塞忙等，点了也跳不过', () => {
  for (const [label, G] of [
    ['七彩氣球', SPECIAL_KIND.BALLOON],
    ['財神接金幣', SPECIAL_KIND.GIFT_FROM_SKY],
  ] as const) {
    for (const [name, seat] of [
      ['单机', undefined],
      ['联机·玩家本人', 0],
      ['联机·旁观', 1],
    ] as const) {
      it(`${label}（${name}）：score 相里一直点，仍满 2000ms 才送（旁观端从不送）`, () => {
        const sink: Sink = { dispatched: [] };
        const t0 = playToScore(G, seat, sink);
        const sent = runUntilSent(G, seat, sink, t0, t0 + 4000, true);
        if (seat === 1) {
          expect(sent).toBeNull();
          expect(sink.dispatched).toEqual([]);
          return;
        }
        expect(sent).not.toBeNull();
        expect(sent! - t0).toBeGreaterThanOrEqual(MINI_END_MS);
        expect(sink.dispatched).toHaveLength(1);
      });
    }
  }
});
