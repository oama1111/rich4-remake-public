/*
 * 音效**单路**（Stop→Play）—— 浏览器里才有的「叠加」缺口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ── 这一条钉的是什么 ──
 *
 * 原版的移动音效是**单路**的：索引存在 `[0x4749d4]`，每一格 `rich4_play_sound_effect`
 * （VA 0x0040d9f2）之前会先把同一路 `Stop`（`fcn_004542e9` = `IDirectSoundBuffer::Stop`；
 * 「整趟走完」那一次在 VA 0x0040d8dc）。所以原版永远只有**一路**在响。
 *
 * 浏览器里每个 `BufferSource` 都是独立的一路 —— `SoundPlayer` 先前每次都新建一个、
 * 从不停上一个，于是走一格叠一路：汽車 2.72 s / 機車 1.50 s 的引擎声会叠几十层。
 * 那是本引擎与 exe 真正不一致的地方（次数没错，见 `move-sound.test.ts` /
 * `docs/deviations/Q-SOUND-1.md`）。
 *
 * ⚠️ 需求方第 5 轮那条「走子音效像逐格响」**不是**「次数放多了」：
 *   原版就是每格一次。详见 `docs/deviations/Q-SOUND-1.md`。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SoundPlayer } from './audio.ts';

const EFFECT = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Effect.mkf';
const haveEffect = existsSync(EFFECT) ? it : it.skip;

/** 记账用的假 source —— 只要「有没有被立刻停掉」 */
class FakeParam {
  value = 0;
  setValueAtTime(): void { /* 不关心 */ }
}
class FakeSource {
  buffer: unknown = null;
  readonly stops: number[] = [];
  readonly starts: number[] = [];
  stopped = false;
  readonly #ended: (() => void)[] = [];
  start(when = 0): void {
    this.starts.push(when);
  }
  stop(when = 0): void {
    if (when <= 0) this.stopped = true;
    this.stops.push(when);
  }
  addEventListener(type: string, cb: () => void): void {
    if (type === 'ended') this.#ended.push(cb);
  }
  connect(): this {
    return this;
  }
  /** 手动静悄悄地模拟「自然播完」 */
  emitEnded(): void {
    for (const cb of this.#ended) cb();
  }
}
class FakeGain {
  readonly gain = new FakeParam();
  connect(): this {
    return this;
  }
}
class FakeCtx {
  readonly sampleRate = 22050;
  readonly destination = { kind: 'destination' };
  readonly sources: FakeSource[] = [];
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({ kind: 'buffer' });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

let ctx: FakeCtx;
let player: SoundPlayer;

beforeEach(() => {
  ctx = new FakeCtx();
  (globalThis as unknown as { window: unknown }).window = {
    AudioContext: function AudioContext(this: unknown) {
      return ctx;
    },
  };
  player = new SoundPlayer();
  player.addArchive('Effect.mkf', new Uint8Array(readFileSync(EFFECT)));
  player.unlock();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('★ SoundPlayer 的单路语义 —— 一路一个实例', () => {
  haveEffect('★ 同一路连播两次：第一个 source 必须先被 Stop（@source VA 0x0040d9f2 → 0x004542e9）', async () => {
    player.play('Effect.mkf', 46);
    await Promise.resolve(); // 让 decodeAudioData 的 then 跑完
    await Promise.resolve();
    expect(ctx.sources).toHaveLength(1);

    player.play('Effect.mkf', 46);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sources).toHaveLength(2);
    // ★ 关键：第 1 个被停了 —— 不会两路引擎声一起响
    expect(ctx.sources[0]?.stopped).toBe(true);
    expect(ctx.sources[1]?.stopped).toBe(false);
  });

  haveEffect('不同号互不影响（骰子声不会掐掉引擎声）', async () => {
    player.play('Effect.mkf', 46);
    await Promise.resolve();
    await Promise.resolve();
    player.play('Effect.mkf', 10);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]?.stopped).toBe(false); // 46 还在响
    expect(ctx.sources[1]?.stopped).toBe(false); // 10 起播
  });

  haveEffect('play 之前显式 stop 也认（V A 0x0040d8dc 那种「走完收声」）', async () => {
    player.play('Effect.mkf', 44);
    await Promise.resolve();
    await Promise.resolve();
    player.stop('Effect.mkf', 44);
    expect(ctx.sources[0]?.stopped).toBe(true);
  });

  haveEffect('已经自然播完的再 play，不会误停新的一路', async () => {
    player.play('Effect.mkf', 44);
    await Promise.resolve();
    await Promise.resolve();
    ctx.sources[0]?.emitEnded(); // 第一声自然播完
    player.play('Effect.mkf', 44);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1]?.stopped).toBe(false);
  });

  haveEffect('stopAll 把所有在响的都收掉', async () => {
    player.play('Effect.mkf', 44);
    player.play('Effect.mkf', 45);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sources).toHaveLength(2);
    player.stopAll();
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
  });
});
