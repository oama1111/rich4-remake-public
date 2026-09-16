/*
 * 走子/走姿**不许空帧** —— 需求方 2026-09-16 报的「人物行动时仍然是闪烁的」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ── 复现到的是哪一种（真浏览器 + DEV 钩子 `__rich4`，逐帧抓 `drawImage`）──
 *
 * 在 `?screen=game` 里让电脑走一格，按帧记下画进棋盘画布的每一张图，同一只棋子
 * 的走姿图号序列是连续的，但**每隔一次换图号就整整一帧什么都没有**：
 *
 * ```
 * f184 113(53x75)@238,119   f188  ← 这一帧没有这只棋子
 * f189 114(58x75)@234,126   f192 107(55x76)@231,133
 * f197 108(52x77)@224,143   f202 109(56x78)@213,158
 * f207  ← 没有            f208 115(61x82)@220,147
 * f210  ← 没有            f211 116(59x81)@270,107
 * f216 / f221 / f230 ← 都没有
 * ```
 *
 * 即 **「有的帧不画」**（不是画两次、也不是图号跳）：
 * `#sprite()` 在新图号上**第一次**必然返回 null（`createImageBitmap` 是异步的），
 * 玩家那条退回**色块**（棋子↔色球交替闪）、替身那条直接 `continue`（整帧不画）。
 * 而原版这里是**常驻指针**：`read_mkf` 把整组图同步读进内存，
 * `[0x498eb4 + pose*8 + slot*4]` 走子过程中永远非空
 * （@source 绘制槽 VA 0x0040829d 读 `[slot + 0]` 那张图；
 *  `_rich4_update_player_sprite` VA 0x0040bbd8 起一次读一整组）。
 *
 * ── 修法（表现层）──
 * `render.ts` 的 `#spriteHeld`：能画当前帧就画当前帧；画不了就退回**本槽上一张
 * 画出来的图**（同一个人的上一帧走姿，或上场前的站姿），绝不空一帧；
 * 并且顺手把**下一帧**先丢进解码队列（一 tick 一帧，tick 之间隔着好几个 rAF）。
 *
 * ⚠️ 原版这一段并没有「补间」这个东西的中间态：它逐 tick 就地改玩家记录里的
 *    屏幕坐标，一个 tick 画一次。本引擎是「一次 dispatch 走完整趟 + 补间回放」，
 *    所以「每一帧都得画出来」这条契约只能由渲染器自己保证 —— 本文件钉住它。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BoardRenderer, type Camera } from './render.ts';
import { SpriteCache, type Sprite } from './assets.ts';
import {
  ACTOR_DOLL,
  ACTOR_PLACE,
  makeGameState,
  makeNode,
  makePlayer,
  type GameState,
  type MapNode,
  type Rich4Map,
} from '@rich4/core';

// ============================================================
//  工具（与 render.test.ts / doll-tool.test.ts 同一套）
// ============================================================

/** 一条直线地图，节点间隔 40 世界单位 */
function lineNodes(n: number): MapNode[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode({ id: i + 1, x: i * 40, y: 0, adjacent: [i, i + 2].filter((v) => v >= 1 && v <= n) }),
  );
}

function lineMap(n: number): Rich4Map {
  return { nodes: lineNodes(n), lands: [], facilities: [], commercials: [], landscapes: [], dataSize: 0 };
}

/** 地图视角、单位缩放 —— 世界坐标 == 屏幕坐标 */
const CAM: Camera = { x: 0, y: 0, scale: 1, view: 0, tileX: 0, tileY: 0 };

/** 假位图：资源号/图号挂在位图上，才认得出这一帧画的是哪一张 */
interface FakeBitmap {
  close: () => void;
  res: number;
  idx: number;
  /** 被 `close()` 过没有 —— 画一张已关闭的位图会画成空白 */
  closed: { v: boolean };
}

/** 假画布：记下每次 `drawImage` 画了哪张图、画在哪儿（色块走 `arc`，另计） */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D;
  images: { bitmap: FakeBitmap; x: number; y: number }[];
  arcs: { n: number };
} {
  const images: { bitmap: FakeBitmap; x: number; y: number }[] = [];
  const arcs = { n: 0 };
  const noop = (): void => undefined;
  const ctx = {
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: () => {
      arcs.n += 1;
    },
    ellipse: noop, fill: noop, stroke: noop, fillRect: noop, setTransform: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
    drawImage: (b: unknown, x: number, y: number) => { images.push({ bitmap: b as FakeBitmap, x, y }); },
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, images, arcs };
}

/**
 * 真图数（`assets/game/Data.mkf` 逐资源数出来的）。
 * - 角色 0：站 128（8 张 = 8 向 × 1）、走 129（72 张 = 8 向 × 9）
 * - 惡人 actor 4：站 380（8 张）、走 381（152 张 = 8 向 × 19）
 * - 機器娃娃：站 521（8 张）、走 522（40 张 = 8 向 × 5）
 */
const COUNTS: Record<number, number> = {
  128: 8, 129: 72, 380: 8, 381: 152, 521: 8, 522: 40,
};

/**
 * 假图集缓存。
 *
 * @param delay 每一次取图要等几个宏任务才回来 —— 模拟 `createImageBitmap` 的异步。
 *   ★ 这个参数就是「闪烁」的成因：`delay` 越大，未解码的帧越多。
 * @param never 哪些 (资源, 图号) **永远解不出来**（`promise` 挂着不 resolve）——
 *   用来钉「就算一张都还没到，也不许空帧」。
 * @param made 收下每一次造出来的精灵（淘汰那一条用例要拿着它去模拟缓存淘汰）
 */
function fakeCache(
  delay = 1,
  never?: (res: number, idx: number) => boolean,
  made?: Sprite[],
): SpriteCache {
  const cache = new SpriteCache({ get: () => ({ read: () => new Uint8Array(0) }) } as never, {});
  vi.spyOn(cache, 'imageCount').mockImplementation((_a, res) => COUNTS[res] ?? 8);
  vi.spyOn(cache, 'get').mockImplementation(async (_a, res, idx) => {
    if (never?.(res, idx) === true) await new Promise<never>(() => undefined);
    for (let i = 0; i < delay; i++) await new Promise((r) => setTimeout(r, 0));
    const closed = { v: false };
    const sp = {
      bitmap: {
        close: () => {
          closed.v = true;
        },
        res,
        idx,
        closed,
      },
      width: 50,
      height: 58,
      anchorX: 25,
      anchorY: 56,
    } as unknown as Sprite;
    made?.push(sp);
    return sp;
  });
  return cache;
}

/** 一帧一帧地画，每一帧之间放一次宏任务（= 真机上解码有机会落地） */
async function frames(
  renderer: BoardRenderer,
  input: Parameters<BoardRenderer['draw']>[0],
  images: { bitmap: FakeBitmap; x: number; y: number }[],
  times: readonly number[],
  clock: { now: number },
): Promise<string[][]> {
  const out: string[][] = [];
  for (const t of times) {
    clock.now = t;
    images.length = 0;
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));
    out.push(images.map((i) => `${i.bitmap.res}#${i.bitmap.idx}@${i.x},${i.y}`));
  }
  return out;
}

// ============================================================
//  ① 玩家自己的棋子：走一步的补间，每一帧都得画出来
// ============================================================

describe('★ 玩家走子：补间的每一帧都出 token（不许空帧、不许画两次）', () => {
  it('★ 一 tick 一帧、rAF 比 tick 密：整段补间里**没有任何一帧**漏画棋子', async () => {
    const clock = { now: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);

    // 只留一个玩家 —— 免得别的玩家的棋子混进统计
    const players = [makePlayer({ index: 0, character: 0, whoPlays: 1, nodeId: 2, lastNodeId: 1 })];
    const state: GameState = makeGameState({ players, phase: 'moving', currentPlayer: 0 });
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache(1));
    const input = {
      map: lineMap(4), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 },
    };

    // 起步前先画几帧站姿，让「上一张」有东西顶着（真机上也是这样：先站着，再迈步）
    await frames(renderer, input, images, [980, 990, 999], clock);

    // 一步：世界距离 40 → 走路速度 8 px/tick → 5 tick；一 tick 20 ms，rAF 8 ms
    renderer.startWalk(0, { x: 0, y: 0 }, { x: 40, y: 0 }, true, CAM, input.viewport, 0, false, 20);
    const times = Array.from({ length: 14 }, (_, f) => 1000 + f * 8);
    const log = await frames(renderer, input, images, times, clock);

    const perFrame = log.map((f) => f.filter((d) => d.startsWith('128#') || d.startsWith('129#')));
    // ★ 每一帧**恰好一张** —— 0 张 = 一闪一灭，2 张 = 画两次
    expect(perFrame.map((f) => f.length)).toEqual(new Array(times.length).fill(1));

    // 走过一帧就换一张（不是钉死在第一帧上）
    const framesSeen = new Set(perFrame.flat().map((d) => d.split('#')[1]!.split('@')[0]));
    expect(framesSeen.size).toBeGreaterThan(1);
  });

  it('★ 完全解不出来时也照画（退回上一张）—— 这条就是「不许空帧」的本体', async () => {
    const clock = { now: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const players = [makePlayer({ index: 0, character: 0, whoPlays: 1, nodeId: 2, lastNodeId: 1 })];
    const state: GameState = makeGameState({ players, phase: 'moving', currentPlayer: 0 });
    const { ctx, images, arcs } = recordingCtx();
    // ★ 走姿那张（129）**永远解不出来** —— 站姿（128）照常到货
    const renderer = new BoardRenderer(ctx, fakeCache(0, (res) => res === 129));
    const input = {
      map: lineMap(4), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 },
    };

    // 站姿先解出来：`phase != moving` 时棋子摆的是站姿 128（真机上走之前就是这样）
    const idle = { ...input, state: { ...state, phase: 'awaitingRoll' as const } };
    clock.now = 999;
    images.length = 0;
    renderer.draw(idle);
    await new Promise((r) => setTimeout(r, 0));
    images.length = 0;
    renderer.draw(idle);
    expect(images.filter((i) => i.bitmap.res === 128)).toHaveLength(1);

    renderer.startWalk(0, { x: 0, y: 0 }, { x: 40, y: 0 }, true, CAM, input.viewport, 0, false, 20);
    arcs.n = 0; // 冷启动那一帧（这个槽一张图都还没有）会退回色块，不计入
    const times = Array.from({ length: 8 }, (_, f) => 1000 + f * 8);
    const log = await frames(renderer, input, images, times, clock);
    // 走姿一张都没解出来，但**每一帧仍然有棋子**（退回上一张 = 站姿那张 128）
    for (const f of log) {
      expect(f.filter((d) => d.startsWith('128#') || d.startsWith('129#'))).toHaveLength(1);
    }
    // 也不会退回色块（色块 = 棋子凭空变一个球，比晚一帧更糟）
    expect(log.every((f) => f.some((d) => d.startsWith('128#')))).toBe(true);
    expect(arcs.n).toBe(0);
  });
});

// ============================================================
//  ② 替身（四大惡人）：走一趟，每一帧都得画出来，帧号不回头
// ============================================================

/** 造一个「替身 slot 0 在盘上、刚走完 path 这一趟」的 state */
function afterActorWalk(path: readonly number[]): GameState {
  const s = makeGameState();
  const specialActors = [...s.specialActors];
  specialActors[0] = {
    nodeId: path[path.length - 1] ?? 1,
    lastNodeId: path[0] ?? 1,
    direction: 0,
    owner: 0,
    stepsRemaining: 0,
    halted: 0,
    singleStep: 0,
    place: ACTOR_PLACE.board,
  };
  return { ...s, specialActors, lastNpcWalks: [{ slot: 0, path: [...path] }] };
}

describe('★ 替身走子：整趟补间**每一帧都出 token**', () => {
  it('★ 一 tick 一帧、图号换一次解一次：没有任何一帧漏画（需求方报的闪烁）', async () => {
    const clock = { now: 5000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const path = [1, 2, 3, 4, 5, 6, 7];
    const state = afterActorWalk(path);
    const map = lineMap(12);
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache(1));
    const input = {
      map, state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 },
      actorWalks: state.lastNpcWalks, tickMs: 20,
    };

    // 先在盘上站着（替身本来就在盘上，走之前是站姿 380）
    await frames(renderer, input, images, [4980, 4990, 4999], clock);

    // 每格 5 tick × 20 ms = 100 ms，6 格 = 600 ms；每 8 ms 画一帧
    const times = Array.from({ length: 76 }, (_, f) => 5000 + f * 8);
    const log = await frames(renderer, input, images, times, clock);

    const moved = log.map((f) => f.filter((d) => d.startsWith('380#') || d.startsWith('381#')));
    // ★ 整趟（含最后停下的那一帧）每一帧恰好一只替身
    expect(moved.map((f) => f.length)).toEqual(new Array(times.length).fill(1));

    // 位置必须真的在动（不是钉死在起点）
    const xs = new Set(moved.map((f) => f[0]!.split('@')[1]));
    expect(xs.size).toBeGreaterThan(3);
  });

  it('★ 走姿帧号**单调不回头**（一 tick 进一帧，一轮走满才回零）', async () => {
    const clock = { now: 9000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const path = [1, 2, 3, 4, 5, 6, 7];
    const state = afterActorWalk(path);
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache(1));
    const input = {
      map: lineMap(12), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 },
      actorWalks: state.lastNpcWalks, tickMs: 20,
    };
    await frames(renderer, input, images, [8980, 8990, 8999], clock);
    const times = Array.from({ length: 76 }, (_, f) => 9000 + f * 8);
    const log = await frames(renderer, input, images, times, clock);

    // 381 = 走姿（8 向 × 19 帧）→ 每向 19 帧
    const per = 19;
    const idx = log
      .map((f) => f.find((d) => d.startsWith('381#')))
      .filter((d): d is string => d !== undefined)
      .map((d) => Number(d.split('#')[1]!.split('@')[0]) % per);
    expect(idx.length).toBeGreaterThan(10);
    for (let i = 1; i < idx.length; i++) {
      // 允许原地不动（退回上一张时重复一帧）或 +1；绝不允许 -1（回头）
      const delta = (idx[i]! - idx[i - 1]! + per) % per;
      expect(delta === 0 || delta === 1).toBe(true);
    }
  });
});

// ============================================================
//  ③ 機器娃娃（走完就收场、不在盘上）：同一份契约
// ============================================================

describe('★ 機器娃娃走完收场那一趟：补间在播的每一帧都要画出来', () => {
  it('★ 9 步（Q-DOLL-1 的 `walkingOffBoard` 那条路）—— 冷启动只许缺第一帧', async () => {
    const clock = { now: 200 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const path = Array.from({ length: 10 }, (_, i) => i + 1); // 9 步
    const s = makeGameState();
    const specialActors = [...s.specialActors];
    // `runDoll` 走完就是它：不在盘上（这个槽一张图都还没画过 = 冷启动）
    specialActors[ACTOR_DOLL - 4] = {
      nodeId: 0, lastNodeId: 0, direction: 0, owner: 0, stepsRemaining: 0,
      halted: 0, singleStep: 0, place: ACTOR_PLACE.offBoard,
    };
    const state: GameState = { ...s, specialActors, lastNpcWalks: [{ slot: ACTOR_DOLL - 4, path }] };
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache(1));
    const input = {
      map: lineMap(12), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 },
      actorWalks: state.lastNpcWalks, tickMs: 20,
    };

    // 9 步 × 5 tick × 20 ms = 900 ms；只量补间还活着的那 800 ms（一帧 8 ms）
    const times = Array.from({ length: 100 }, (_, f) => 200 + f * 8);
    const log = await frames(renderer, input, images, times, clock);
    const counts = log.map((f) => f.filter((d) => d.startsWith('522#')).length);

    // ★ 这个槽上路前一张图都没有（娃娃是凭空出现的）——「下一帧提前解」也追不上
    //   第 0 帧，所以**只允许缺第一帧**；从第 1 帧起一帧都不许漏。
    expect(counts[0]).toBeLessThanOrEqual(1);
    expect(counts.slice(1).every((n) => n === 1)).toBe(true);
  }, 30000);
});

// ============================================================
//  ④ 「上一张」与缓存淘汰的交界：**不许画一张已经 close 掉的位图**
// ============================================================

describe('★ 缓存淘汰时，「上一张」必须一起摘掉（Q-PERF-1 的位图 close 在帧边界）', () => {
  it('★ 被淘汰的那张再画就是空白 —— `#held` 要跟着 `#ready` 一起摘', async () => {
    const clock = { now: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    const players = [makePlayer({ index: 0, character: 0, whoPlays: 1, nodeId: 2, lastNodeId: 1 })];
    const state: GameState = makeGameState({ players, phase: 'moving', currentPlayer: 0 });

    const made: Sprite[] = [];
    // ★ 走姿永远解不出来 → 走子那几帧全靠「上一张」（站姿那张）
    const cache = fakeCache(1, (res) => res === 129, made);
    // 渲染器在构造里挂的淘汰监听：拦下来，用例里手动触发一次淘汰
    let evict: ((s: Sprite) => void) | null = null;
    vi.spyOn(cache, 'addEvictListener').mockImplementation((fn) => {
      evict = fn as (s: Sprite) => void;
    });
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, cache);
    const input = {
      map: lineMap(4), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 },
    };

    // 站姿先解出来（真机上走之前就是这样），它同时是这一槽的「上一张」
    const idle = { ...input, state: { ...state, phase: 'awaitingRoll' as const } };
    renderer.draw(idle);
    await new Promise((r) => setTimeout(r, 0));
    clock.now = 1000;
    images.length = 0;
    renderer.draw(idle);
    expect(images.filter((i) => i.bitmap.res === 128)).toHaveLength(1);
    const stand = made.find((s) => (s.bitmap as unknown as FakeBitmap).res === 128);
    expect(stand).toBeDefined();

    // 走起来（走姿解不出来 → 画的是上一张 128）
    renderer.startWalk(0, { x: 0, y: 0 }, { x: 40, y: 0 }, true, CAM, input.viewport, 0, false, 20);
    clock.now = 1008;
    images.length = 0;
    renderer.draw(input);
    expect(images.filter((i) => i.bitmap.res === 128)).toHaveLength(1);

    // ★ 缓存把这站姿淘汰掉（真机上 LRU 溢出时就会发生）：监听回调 + 下一帧的 drain
    expect(evict).not.toBeNull();
    evict!(stand!);
    clock.now = 1016;
    images.length = 0;
    renderer.draw(input); // 这一帧开头 `#evicted.drain()` 会把位图 close

    // 画的每一张都不许是已关闭的位图（否则原版画面里就是一块空白）
    expect(images.every((i) => i.bitmap.closed.v === false)).toBe(true);
    expect((stand!.bitmap as unknown as FakeBitmap).closed.v).toBe(true);
    // 而且不许再把那张已关闭的当「上一张」顶着用
    expect(images.filter((i) => i.bitmap.res === 128)).toHaveLength(0);
  });
});

describe('动效出口两条来源共用 @source Q-TOOL-5 ⑤14', () => {
  it('★ 电脑那条直路也调 startActionFx（否则 AI 用道具看不到动效）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // 定义 1 处 + 调用 2 处（applyAction 与 scheduleAi 的直路）
    const hits = src.split('startActionFx(').length - 1;
    expect(hits, 'startActionFx 应当有 1 处定义 + 2 处调用').toBe(3);
    // 两条来源都必须在
    expect(src).toContain('startActionFx(action, before);');
    // 三处旧钩子都收进 `startActionFx` 里了 —— 全文件只该出现这 3 次
    const hooks = src
      .split('\n')
      .filter((l) => /if \(action\.type === 'use(Tool|Card)'\) start/.test(l));
    expect(hooks.length, '三处动效钩子只该在 startActionFx 里各一次').toBe(3);
  });
});

describe('★ 真人走子也必须逐格滑（T-047 ④ 第 1 条，2026-09-16 修）', () => {
  it('applyAction 里要调 tweenStepIfMoved，且与 AI 那条共用 startStepTween', () => {
    // 先前只有 AI 那条（scheduleAi 的 reduce 直路）起补间 —— 真人走
    // `dispatch → applyAction` 完全没起，于是自己走的一步是瞬移。
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src, 'tweenStepIfMoved 必须存在').toContain('function tweenStepIfMoved(');
    // 定义 1 处 + applyAction 里调用 1 处
    expect(src.split('tweenStepIfMoved(').length - 1).toBe(2);
    expect(src).toContain('tweenStepIfMoved(action, before);');
    // 两条来源共用同一个 startStepTween（定义 1 处 + 调用 2 处）
    expect(src.split('startStepTween(').length - 1).toBe(3);
  });
});
