/*
 * 過路費閃爍的**绘制**那一段（W-69）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 纯函数（节拍表）在 `toll-flash-fx.test.ts`；这里钉的是渲染器真的把
 * 「算进这笔过路费的那几块地」调亮 / 调暗，而且合成状态**画完就还原**
 * （否则会漏到后面所有绘制 —— 与 T-047 的冬眠去色同一个坑）。
 *
 * ★★ 2026-09-24（需求方 iPhone 上「闪烁特效没了」）：**不许再用 `ctx.filter`** ——
 *   WebKit 不支持它，赋值被静默忽略。改成「本体 → 同图 `lighter` 叠加 / 黑剪影盖上」
 *   （`sprite-brightness.ts`）。这里用假画布记下每一次 `drawImage` 当时的合成模式与透明度。
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Rich4Map } from '@rich4/core';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '@rich4/core';
import { BoardRenderer, type RenderInput } from './render.ts';
import { SpriteCache } from './assets.ts';

interface FakeBitmap {
  close: () => void;
  res: number;
  idx: number;
}

/**
 * 假画布：记**每一次** `drawImage`（连同当时的 `globalCompositeOperation` / `globalAlpha`），
 * 以及任何一次 `filter` 赋值（应当一次都没有）。`save` / `restore` 真的压栈出栈。
 */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D;
  log: string[];
} {
  const log: string[] = [];
  const noop = (): void => undefined;
  const stack: { op: string; alpha: number }[] = [];
  const target = {
    save: () => {
      stack.push({ op: target.globalCompositeOperation, alpha: target.globalAlpha });
    },
    restore: () => {
      const top = stack.pop();
      if (top !== undefined) {
        target.globalCompositeOperation = top.op;
        target.globalAlpha = top.alpha;
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
    setTransform: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
    drawImage: (b: unknown) => {
      const bmp = b as FakeBitmap & { mask?: FakeBitmap };
      const tag = bmp?.mask !== undefined ? `mask:${bmp.mask.res}:${bmp.mask.idx}` : `draw:${bmp?.res ?? -1}:${bmp?.idx ?? -1}`;
      const mode = target.globalCompositeOperation === 'source-over' && target.globalAlpha === 1
        ? ''
        : `@${target.globalCompositeOperation}/${target.globalAlpha}`;
      log.push(tag + mode);
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    imageSmoothingEnabled: true,
  };
  // `filter` 用存取器记下来 —— 渲染器若**赋值**给它就会留痕
  Object.defineProperty(target, 'filter', {
    get: () => '',
    set: (v: string) => log.push(`filter:${v}`),
  });
  return { ctx: target as unknown as CanvasRenderingContext2D, log };
}

/** 假离屏画布：剪影就是一个带 `mask` 标记的对象（好认出是哪张图的剪影） */
function stubOffscreenCanvas(): void {
  class FakeOffscreen {
    drawn: FakeBitmap | null = null;
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(): unknown {
      return {
        drawImage: (b: FakeBitmap) => {
          this.drawn = b;
        },
        fillRect: () => undefined,
        globalCompositeOperation: 'source-over',
        fillStyle: '',
      };
    }
    get mask(): FakeBitmap | undefined {
      return this.drawn ?? undefined;
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
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
    vi.unstubAllGlobals();
  });

  it('★★ 被标记的地块（level > 0）：本体之后紧跟同一张图的 `lighter` 叠加（α = level/32），画完还原', async () => {
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([12]), level: 16 } });
    // ★★ 一次 `filter` 都不许设（Safari 不认）
    expect(log.some((s) => s.startsWith('filter:'))).toBe(false);
    const lit = log.filter((s) => s.includes('@lighter/0.5'));
    expect(lit).toHaveLength(1);
    // 叠加的就是**刚画的那一张**（紧挨着的前一条是同一张图的本体）
    const at = log.indexOf(lit[0]!);
    expect(log[at - 1]).toBe(lit[0]!.replace('@lighter/0.5', ''));
    // 还原之后继续画别的：后面没有一条还带着合成模式
    expect(log.slice(at + 1).some((s) => s.startsWith('draw:'))).toBe(true);
    expect(log.slice(at + 1).some((s) => s.includes('@'))).toBe(false);
  });

  it('★★ level < 0：盖一张**同一张图的黑剪影**（α = |level|/32）', async () => {
    stubOffscreenCanvas();
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([12]), level: -8 } });
    expect(log.some((s) => s.startsWith('filter:'))).toBe(false);
    const dark = log.filter((s) => s.startsWith('mask:'));
    expect(dark).toHaveLength(1);
    expect(dark[0]).toMatch(/@source-over\/0\.25$/);
    const at = log.indexOf(dark[0]!);
    expect(log[at - 1]).toBe(dark[0]!.replace(/^mask:/, 'draw:').replace(/@.*$/, ''));
  });

  it('★ 没在播（`null`）⇒ 不叠任何东西', async () => {
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: null });
    expect(log.some((s) => s.startsWith('filter:') || s.includes('@') || s.startsWith('mask:'))).toBe(false);
    expect(log.some((s) => s.startsWith('draw:'))).toBe(true);
  });

  it('★ 集合里的 id 不是住宅地块（虚空 id）⇒ 一块都不亮，也不报错', async () => {
    stubOffscreenCanvas();
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([9999]), level: -16 } });
    expect(log.some((s) => s.startsWith('mask:') || s.includes('@') || s.startsWith('filter:'))).toBe(false);
  });

  it('★ 三块都在集合里 ⇒ 三层叠加', async () => {
    stubOffscreenCanvas();
    const { input } = streetMap();
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    // ★ 精灵是**异步**解的：第一帧只发起取图、什么都画不出来（与 doll-tool 那条同一个坑）
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([11, 12, 13]), level: -16 } });
    expect(log.filter((s) => s.startsWith('mask:') && s.endsWith('@source-over/0.5'))).toHaveLength(3);
    log.length = 0;
    renderer.draw({ ...input, landFlash: { lands: new Set([11, 12, 13]), level: 12 } });
    expect(log.filter((s) => s.endsWith('@lighter/0.375'))).toHaveLength(3);
  });

  it('★ 第二十二份（新聞 18 / 19 挑中設施）：`facilities` 里的設施同样调亮；地块集合空着 ⇒ 地块一块不亮', async () => {
    const { input } = streetMap();
    const fac = makeFacility({ id: 3, x: 96, y: 0 });
    const map = { ...input.map, facilities: [fac] } as unknown as Rich4Map;
    const facilityLevel = [...input.state.facilityLevel];
    const facilityOwner = [...input.state.facilityOwner];
    const facilityType = [...input.state.facilityType];
    facilityLevel[3] = 1;
    facilityOwner[3] = 2;
    facilityType[3] = 1;
    const withFac = { ...input, map, state: { ...input.state, facilityLevel, facilityOwner, facilityType } };
    const { ctx, log } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    renderer.draw(withFac);
    await new Promise((r) => setTimeout(r, 0));

    log.length = 0;
    renderer.draw({ ...withFac, landFlash: { lands: new Set(), facilities: new Set([3]), level: 16 } });
    expect(log.filter((s) => s.includes('@lighter/0.5'))).toHaveLength(1);
    expect(log.some((s) => s.startsWith('filter:'))).toBe(false);
    // 同一个号放在「地块」那一张里不算（地块 3 不存在；設施按自己那一张认）
    log.length = 0;
    renderer.draw({ ...withFac, landFlash: { lands: new Set([3]), level: 16 } });
    expect(log.some((s) => s.includes('@'))).toBe(false);
  });
});
