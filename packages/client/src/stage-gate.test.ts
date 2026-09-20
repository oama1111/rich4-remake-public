/*
 * 「演出还在跑吗」判据 —— 单测（W-51）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 纯函数，不碰 DOM / 音频 / 时钟（时间由下面的模型自己推）。
 * 每一位各一条用例 + 一条**死锁自查**（W-50 §2.3 第 5 点）。
 */
import { describe, expect, it } from 'vitest';
import {
  deferSpeech,
  filmWaitsForSpeech,
  stageBusy,
  type SpeechOrder,
  type StageFlags,
} from './stage-gate.ts';

/** 全 false 的清单（下面的用例只翻自己那一位） */
const IDLE: StageFlags = {
  blockingPresentation: false,
  boardFilm: false,
  pendingBoardFilm: false,
  pendingBoardFilmAfter: false,
  buildFx: false,
  pendingBuildFx: false,
  objectFlight: false,
  walkDone: true,
  diceFxActive: false,
};

/** 只翻**一位**的简写 */
const only = (patch: Partial<StageFlags>): StageFlags => ({ ...IDLE, ...patch });

describe('stageBusy —— 每一位各一条（清单与 holdForActorWalk 同一份）', () => {
  it('全 false ⇒ 台上没人，可以派下一步 / 台词直接上台', () => {
    expect(stageBusy(IDLE)).toBe(false);
  });

  it.each([
    ['blockingPresentation', { blockingPresentation: true }],
    ['boardFilm', { boardFilm: true }],
    ['pendingBoardFilm', { pendingBoardFilm: true }],
    ['pendingBoardFilmAfter', { pendingBoardFilmAfter: true }],
    ['buildFx', { buildFx: true }],
    ['pendingBuildFx', { pendingBuildFx: true }],
    ['objectFlight（卡片飞行也是这一位）', { objectFlight: true }],
    ['!walkDone', { walkDone: false }],
    ['diceFxActive', { diceFxActive: true }],
  ] as const)('只有 %s ⇒ busy', (_name, patch) => {
    expect(stageBusy(only(patch))).toBe(true);
  });

  it('全 true ⇒ busy（九位一位都不少地参与或运算）', () => {
    const all: StageFlags = {
      blockingPresentation: true,
      boardFilm: true,
      pendingBoardFilm: true,
      pendingBoardFilmAfter: true,
      buildFx: true,
      pendingBuildFx: true,
      objectFlight: true,
      walkDone: false,
      diceFxActive: true,
    };
    expect(stageBusy(all)).toBe(true);
  });
});

describe('deferSpeech —— 只有 afterStage 会被押后', () => {
  it('beforeStage 无论台上忙不忙都**不押后**（死锁自查的规则面）', () => {
    expect(deferSpeech('beforeStage', false)).toBe(false);
    expect(deferSpeech('beforeStage', true)).toBe(false);
  });

  it('afterStage：台上闲 ⇒ 直接上台；台上忙 ⇒ 押后', () => {
    expect(deferSpeech('afterStage', false)).toBe(false);
    expect(deferSpeech('afterStage', true)).toBe(true);
  });
});

describe('filmWaitsForSpeech —— 影片起播前等台词说完', () => {
  it('队列空 ⇒ 起播；队列非空 ⇒ 等', () => {
    expect(filmWaitsForSpeech(0)).toBe(false);
    expect(filmWaitsForSpeech(1)).toBe(true);
    expect(filmWaitsForSpeech(3)).toBe(true);
  });
});

// ============================================================
//  死锁自查
// ============================================================

/**
 * `main.ts` 那三条**互相牵制**的规则的极小模型（时间自推，可复现）：
 *
 * | 模型里这一段 | `main.ts` 里的对应 |
 * |---|---|
 * | 起手按 `deferSpeech(order, busy)` 决定入队还是押后 | `queueSpeech()` |
 * | `freezeQueueWhileBusy` 为真 ⇒ busy 时整个 tick 跳过 | **旧**写法：`speechTick` 开头 `if (…busy) return`（连队列也冻住） |
 * | `if (!busy && deferred)` 放行押后的句子 | `speechTick()` 的 `deferredSpeech` 放行 |
 * | `filmPending && !filmWaitsForSpeech(queue)` ⇒ 起播 | `tickBoardFilm()` 的起播闸 |
 *
 * ⚠️ 影片起播只看 **`queue`**（`speechQueue.length`）—— 押在 `deferredSpeech` 里的
 *    是 `afterStage`，本来就该排在影片**之后**，不能反过来挡影片（挡了就死锁）。
 */
function simulate(opts: { order: SpeechOrder; freezeQueueWhileBusy: boolean }): {
  speechDoneAt: number;
  filmStartedAt: number;
  filmDoneAt: number;
  ticks: number;
} {
  const HOLD = 1000; // 一句台词的显示时长（原版 `0x3e8`）
  const FILM = 620; // 一段影片（住院 62 帧 × 10 ms 之类，取个够短的）
  const STEP = 16; // 一帧
  const LIMIT = 2000; // 「2 秒内」这条验收线

  let now = 0;
  let queue: number[] = [];
  let deferred: number[] = [];
  let filmPending = true;
  let filmLeft = 0;
  let speechDoneAt = -1;
  let filmStartedAt = -1;
  let filmDoneAt = -1;

  // ── ① queueSpeech（壞神附身：这一条 action 派生的一句）──
  const busyAtPush = stageBusy(only({ pendingBoardFilm: true }));
  expect(busyAtPush).toBe(true); // 影片已经 pending —— 这正是死锁的形状
  if (deferSpeech(opts.order, busyAtPush)) deferred.push(HOLD);
  else queue.push(HOLD);

  let ticks = 0;
  while (now < LIMIT) {
    ticks += 1;
    now += STEP;
    const busy = stageBusy(
      only({ pendingBoardFilm: filmPending, boardFilm: filmLeft > 0 }),
    );

    // ── ② speechTick ──
    if (!opts.freezeQueueWhileBusy || !busy) {
      if (!busy && deferred.length > 0) {
        queue = queue.concat(deferred);
        deferred = [];
      }
      if (queue.length > 0) {
        queue[0] = (queue[0] ?? 0) - STEP;
        if ((queue[0] ?? 0) <= 0) {
          queue.shift();
          if (queue.length === 0 && speechDoneAt < 0) speechDoneAt = now;
        }
      }
    }

    // ── ③ tickBoardFilm 的起播闸 ──
    if (filmPending && !filmWaitsForSpeech(queue.length)) {
      filmPending = false;
      filmStartedAt = now;
      filmLeft = FILM;
    }
    if (filmLeft > 0) {
      filmLeft = Math.max(0, filmLeft - STEP);
      if (filmLeft === 0) filmDoneAt = now;
    }
    if (speechDoneAt >= 0 && filmDoneAt >= 0) break;
  }

  return { speechDoneAt, filmStartedAt, filmDoneAt, ticks };
}

describe('★ 死锁自查：壞神附身（台词 beforeStage + 影片 pending）', () => {
  it('2 秒内台词与影片都走完，且 beforeStage **一次都没**进过 deferred', () => {
    const r = simulate({ order: 'beforeStage', freezeQueueWhileBusy: false });
    expect(r.speechDoneAt).toBeGreaterThan(0);
    expect(r.filmStartedAt).toBeGreaterThan(0);
    expect(r.filmDoneAt).toBeGreaterThan(0);
    // 台词说完（1000 ms 上下）影片才起播，影片再播 620 ms —— 合计 < 2000 ms
    expect(r.filmStartedAt).toBeLessThanOrEqual(2000);
    expect(r.filmDoneAt).toBeLessThanOrEqual(2000);
    // 原版次序：台词在前、影片在后
    expect(r.speechDoneAt).toBeLessThanOrEqual(r.filmStartedAt);
  });

  it('反例（可证伪）：把「队列照常推进」改坏 ⇒ 2 秒内走不完（就是那条互等）', () => {
    const r = simulate({ order: 'beforeStage', freezeQueueWhileBusy: true });
    expect(r.filmDoneAt).toBe(-1); // 影片永远起不来
    expect(r.speechDoneAt).toBe(-1); // 台词也永远说不完
    expect(r.ticks).toBe(2000 / 16); // 跑满模型上限仍未收敛
  });

  it('afterStage 的壞神台词不该反过来挡影片（它排在影片之后）', () => {
    // 反过来验证 `filmWaitsForSpeech` 只看 `speechQueue.length`：
    // 押在 deferredSpeech 里的句子不参与起播闸，影片照常先走。
    const r = simulate({ order: 'afterStage', freezeQueueWhileBusy: false });
    expect(r.filmStartedAt).toBe(16); // 第一拍就起播
    expect(r.filmDoneAt).toBeGreaterThan(0);
    expect(r.speechDoneAt).toBeGreaterThanOrEqual(r.filmDoneAt); // 影片收摊后才轮到台词
  });
});
