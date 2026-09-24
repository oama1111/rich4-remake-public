/*
 * ★★ 整个客户端**一次都不许**给 canvas 的 `filter` 赋值（2026-09-24）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * WebKit（Safari、iOS 上所有浏览器）不支持 `CanvasRenderingContext2D.filter`（WebKit bug 198416）：
 * 赋值被**静默忽略**，效果在 iPhone / iPad / Mac Safari 上直接消失 —— 需求方就是这样报的
 * 「连着一条街收过路费时地块闪烁特效怎么没了」。冬眠 / 冻住的棋子去色也是同一个坑。
 * 现在两处都改成了 WebKit 也认的做法（`sprite-brightness.ts`：`lighter` 叠加 / 黑剪影 / 逐像素灰版）。
 *
 * 两道闸：
 *   ① 静态：`packages/client/src` 下所有非测试源码里没有 `.filter = …` 这种赋值；
 *   ② 运行：渲染器画一帧**把能用到的效果全开**（冬眠的玩家、冬眠的惡人、過路費闪亮 / 闪暗），
 *      假画布的 `filter` 一被赋值就记下来 —— 必须一次都没有，而且灰版 / 叠层真的画了。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Rich4Map } from '@rich4/core';
import { initialSpecialActors, makeGameState, makeLand, makeNode, makePlayer, releaseNpc } from '@rich4/core';
import { BoardRenderer, type RenderInput } from './render.ts';
import { SpriteCache } from './assets.ts';
import { asleepGrey, asleepSpriteOf, greyPixels } from './sprite-brightness.ts';

const SRC = new URL('.', import.meta.url);

describe('★★ 静态：客户端源码里没有 canvas `filter` 赋值', () => {
  it('packages/client/src/**/*.ts（测试除外）一处 `.filter =` 都没有', () => {
    const hits: string[] = [];
    const walk = (dir: URL): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          walk(new URL(`${e.name}/`, dir));
          continue;
        }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.test.ts')) continue;
        const text = readFileSync(new URL(e.name, dir), 'utf8');
        text.split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (/\.filter\s*=(?!=)/.test(code) && !/^\s*\*/.test(code)) hits.push(`${e.name}:${i + 1}: ${line.trim()}`);
        });
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });
});

/** 假画布：`filter` 一被赋值就记；`drawImage` 记下画的是原图 / 灰版 / 剪影以及合成模式 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; log: string[]; filters: string[] } {
  const log: string[] = [];
  const filters: string[] = [];
  const noop = (): void => undefined;
  const stack: { op: string; alpha: number }[] = [];
  const target = {
    save: () => stack.push({ op: target.globalCompositeOperation, alpha: target.globalAlpha }),
    restore: () => {
      const t = stack.pop();
      if (t !== undefined) {
        target.globalCompositeOperation = t.op;
        target.globalAlpha = t.alpha;
      }
    },
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    setTransform: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
    drawImage: (b: unknown) => {
      const x = b as { kind?: string; res?: number; op?: string };
      const tag = x.kind ?? `draw:${x.res ?? -1}`;
      log.push(target.globalCompositeOperation === 'lighter' ? `${tag}@lighter` : tag);
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
  };
  Object.defineProperty(target, 'filter', {
    get: () => 'none',
    set: (v: string) => filters.push(v),
  });
  return { ctx: target as unknown as CanvasRenderingContext2D, log, filters };
}

/** 假离屏画布：灰版 / 剪影各带一个 `kind` 标记，好认出画的是哪一种 */
function stubOffscreen(): void {
  class FakeOffscreen {
    kind = 'offscreen';
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(): unknown {
      return {
        drawImage: () => undefined,
        fillRect: () => {
          this.kind = 'mask';
        },
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => {
          this.kind = 'grey';
        },
        globalCompositeOperation: 'source-over',
        fillStyle: '',
      };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
}

function fakeCache(): SpriteCache {
  const cache = new SpriteCache({ get: () => ({ read: () => new Uint8Array(0) }) } as never, {});
  vi.spyOn(cache, 'imageCount').mockImplementation(() => 8);
  vi.spyOn(cache, 'get').mockImplementation(async (_a, res, idx) => {
    return { bitmap: { close: () => undefined, res, idx }, width: 16, height: 24, anchorX: 8, anchorY: 16 } as never;
  });
  return cache;
}

/** 三块同街地（1 级）+ 冬眠的 0 号玩家站在中间 + 冬眠的 0 号惡人站在左边 */
function scene(): Omit<RenderInput, 'landFlash'> {
  const lands = [11, 12, 13].map((id, i) => makeLand({ id, x: i * 32, y: 0, name: '台北市', owner: 2, level: 1, facing: 0 }));
  const nodes = [11, 12, 13].map((id, i) =>
    makeNode({ id: i + 1, x: i * 32, y: 0, adjacent: [i, i + 2].filter((j) => j >= 1 && j <= 3), type: 0x7d0 + id, ref: { kind: 'land', index: id } }),
  );
  const map = { nodes, lands, facilities: [], commercials: [], landscapes: [], dataSize: 0 } as unknown as Rich4Map;
  const base = makeGameState({
    players: [
      makePlayer({ index: 0, nodeId: 2, blocking: { ...makePlayer({ index: 0 }).blocking, sleeping: 3 } }),
      makePlayer({ index: 1, nodeId: 3 }),
    ],
    specialActors: initialSpecialActors().map((a, i) => (i === 0 ? { ...releaseNpc(1, 0, 0), hibernating: 4 } : a)),
  });
  const landOwner = [...base.landOwner];
  const landLevel = [...base.landLevel];
  for (const id of [11, 12, 13]) {
    landOwner[id] = 2;
    landLevel[id] = 1;
  }
  return {
    map,
    state: { ...base, landOwner, landLevel },
    camera: { x: 32, y: 0, scale: 1, view: 0, tileX: 0, tileY: 0 } as RenderInput['camera'],
    hoverNode: null,
    viewport: { w: 440, h: 440 },
    tickMs: 20,
  };
}

describe('★★ 运行：渲染器把效果全开画一帧，`filter` 一次都不许赋值', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const level of [16, -16]) {
    it(`冬眠玩家 + 冬眠惡人 + 過路費闪（level ${level}）`, async () => {
      stubOffscreen();
      const input = scene();
      const { ctx, log, filters } = recordingCtx();
      const r = new BoardRenderer(ctx, fakeCache());
      r.draw(input);
      await new Promise((res) => setTimeout(res, 0));
      log.length = 0;
      r.draw({ ...input, landFlash: { lands: new Set([11, 12, 13]), level } });
      expect(filters).toEqual([]);
      // 灰版真的画了（玩家 + 惡人各一张）
      expect(log.filter((s) => s === 'grey').length).toBeGreaterThanOrEqual(2);
      // 过路费那三块真的叠了层
      if (level > 0) expect(log.filter((s) => s.endsWith('@lighter'))).toHaveLength(3);
      else expect(log.filter((s) => s === 'mask')).toHaveLength(3);
    });
  }
});

describe('★ 去色算式（与先前 `saturate(0) brightness(1.24)` 在 Chromium 上逐像素相同）', () => {
  it('几个定点（Chromium 实测值）', () => {
    // Playwright Chromium：`ctx.filter = 'saturate(0) brightness(1.24)'` 画出来的值
    expect(asleepGrey(0, 0, 0)).toBe(0);
    expect(asleepGrey(255, 255, 255)).toBe(255);
    expect(asleepGrey(255, 0, 0)).toBe(66);
    expect(asleepGrey(0, 255, 0)).toBe(225);
    expect(asleepGrey(0, 0, 255)).toBe(22);
    expect(asleepGrey(128, 128, 128)).toBe(158);
    expect(asleepGrey(200, 100, 50)).toBe(146);
    expect(asleepGrey(10, 20, 30)).toBe(23);
  });

  it('`greyPixels`：三通道同值、透明度不动', () => {
    const d = new Uint8ClampedArray([255, 0, 0, 255, 10, 20, 30, 0]);
    greyPixels(d);
    expect([...d]).toEqual([66, 66, 66, 255, 23, 23, 23, 0]);
  });

  it('没有离屏画布（做不出来）⇒ 返回 null，调用方照画原图', () => {
    expect(asleepSpriteOf({} as CanvasImageSource, 4, 4, () => null)).toBeNull();
  });
});
