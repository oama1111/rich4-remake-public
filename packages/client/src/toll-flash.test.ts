/*
 * 過路費閃爍的**绘制**那一段（W-69）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 纯函数（节拍表）在 `toll-flash-fx.test.ts`；这里钉的是渲染器真的把
 * 「算进这笔过路费的那几块地」调亮，而且**画完立刻把 filter 清掉**
 * （否则会漏到后面所有绘制 —— 与 T-047 的冬眠去色同一个坑）。
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Rich4Map } from '@rich4/core';
import { makeGameState, makeLand, makeNode, makePlayer } from '@rich4/core';
import { BoardRenderer, type RenderInput } from './render.ts';
import { SpriteCache } from './assets.ts';

interface FakeBitmap {
  close: () => void;
  res: number;
  idx: number;
}

/** 假画布：记**每一次** `filter` 的设置与它之后的 `drawImage`（按顺序） */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D;
  log: string[];
} {
  const log: string[] = [];
  const noop = (): void => undefined;
  const target = {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    setTransform: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
    drawImage: (b: unknown) => {
      const bmp = b as FakeBitmap;
      log.push(`draw:${bmp?.res ?? -1}:${bmp?.idx ?? -1}`);
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    imageSmoothingEnabled: true,
  };
  // `filter` 用存取器记下来 —— 渲染器是**赋值**给它，不是调用
  Object.defineProperty(target, 'filter', {
    get: () => '',
    set: (v: string) => log.push(`filter:${v}`),
  });
  return { ctx: target as unknown as CanvasRenderingContext2D, log };
}

/** 假图集：任何资源都给一张 16×24 的图（资源号挂在位图上，好认） */
function fakeCache(): SpriteCache {
  const cache = new SpriteCache({ get: () => ({ read: () => new Uint8Array(0) }) } as never, {});
  vi.spyOn(cache, 'imageCount').mockImplementation(() => 8);
  vi.spyOn(cache, 'get').mockImplementation(async (_a, res, idx) => {
    return {
      bitmap: { close: () => undefined, res, idx },
      width: 16,
      height: 24,
      anchorX: 8,
      anchorY: 16,
    } as never;
  });
  return cache;
}

/** 一条街上的三块地，玩家 1（owner 2）各 1 级；0 号踩在中间那块 */
function streetMap(): { map: Rich4Map; input: Omit<RenderInput, 'landFlash'> } {
  const lands = [
    makeLand({ id: 11, x: 0, y: 0, name: '台北市', owner: 2, level: 1, facing: 0 }),
    makeLand({ id: 12, x: 32, y: 0, name: '台北市', owner: 2, level: 1, facing: 0 }),
    makeLand({ id: 13, x: 64, y: 0, name: '台北市', owner: 2, level: 1, facing: 0 }),
  ];
  const map = {
    nodes: [
      makeNode({ id: 1, x: 0, y: 0, adjacent: [2], type: 0x7d0 + 11, ref: { kind: 'land', index: 11 } }),
      makeNode({ id: 2, x: 32, y: 0, adjacent: [1, 3], type: 0x7d0 + 12, ref: { kind: 'land', index: 12 } }),
      makeNode({ id: 3, x: 64, y: 0, adjacent: [2], type: 0x7d0 + 13, ref: { kind: 'land', index: 13 } }),
    ],
    lands,
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  } as unknown as Rich4Map;
  // ★ 运行时归属在 `state.landOwner/landLevel`（不是地图模板里的 owner/level）
  const base = makeGameState({
    players: [makePlayer({ index: 0, nodeId: 2 }), makePlayer({ index: 1, nodeId: 1 })],
  });
  const landOwner = [...base.landOwner];
  const landLevel = [...base.landLevel];
  for (const id of [11, 12, 13]) {
    landOwner[id] = 2;
    landLevel[id] = 1;
  }
  const state = { ...base, landOwner, landLevel };
  const input: Omit<RenderInput, 'landFlash'> = {
    map,
    state,
    // 地图视角、单位缩放 —— 世界坐标 == 屏幕坐标，好算（与 doll-tool 那条同源）
    camera: { x: 0, y: 0, scale: 1, view: 0, tileX: 0, tileY: 0 } as RenderInput['camera'],
    hoverNode: null,
    viewport: { w: 440, h: 440 },
    tickMs: 20,
  };
  return { map, input };
}

describe('★ W-69：`landFlash` 只调亮那几块地', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★★ 被标记的地块：`filter` 夹着它的 `drawImage`，画完立刻清掉', async () => {
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([12]), level: 16 } });
    // 恰好一对「设 → 画 → 清」
    expect(log.filter((s) => s.startsWith('filter:'))).toEqual([
      'filter:brightness(1.5)',
      'filter:none',
    ]);
    const set = log.indexOf('filter:brightness(1.5)');
    const clear = log.indexOf('filter:none');
    expect(log.slice(set, clear).some((s) => s.startsWith('draw:'))).toBe(true);
    // 清掉之后还要继续画别的（不然就是漏了 filter）
    expect(log.slice(clear).some((s) => s.startsWith('draw:'))).toBe(true);
  });

  it('★ 没在播（`null`）⇒ 一次 filter 都不设', async () => {
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: null });
    expect(log.some((s) => s.startsWith('filter:'))).toBe(false);
    expect(log.some((s) => s.startsWith('draw:'))).toBe(true);
  });

  it('★ 集合里的 id 不是住宅地块（虚空 id）⇒ 一块都不亮，也不报错', async () => {
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([9999]), level: -16 } });
    expect(log.filter((s) => s.startsWith('filter:'))).toEqual([]);
  });

  it('★ 三块都在集合里 ⇒ 三对「设 → 画 → 清」', async () => {
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([11, 12, 13]), level: -16 } });
    expect(log.filter((s) => s === 'filter:brightness(0.5)')).toHaveLength(3);
    expect(log.filter((s) => s === 'filter:none')).toHaveLength(3);
  });
});
