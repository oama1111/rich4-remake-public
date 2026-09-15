/*
 * 機器娃娃（道具 1）的表现层 —— 走子动画 + 音效
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方报的：「使用道具-机器娃娃后没有看到动画和音效」。
 *
 * 取证结论（VA 全部写在 `render.ts` / `audio.ts` 的注释里）：
 *
 *  - 娃娃的图组是**写死**的 `Data.mkf` 0x209（站姿 8 张）/ 0x20a（走姿 40 张
 *    = 8 向 × 5 帧），**不与 NPC 那套基号连号**（VA 0x0040bf02 / 0x0040bf55）。
 *  - 娃娃固定走 9 步（VA 0x0040deb9），走在盘上时 `place` 一直是 0，**走完**
 *    才收场（VA 0x00418ebd）。本引擎 core 一次把整趟走完、回来就已经
 *    `idleActor()`，于是 `actorTokens` 那句 `place != 0 → 跳过` 会把整趟都吞掉
 *    —— 补间起得来、棋盘上却没有人。本文件钉住这一条。
 *  - 音效只有**一声** 38（VA 0x0040ded1..0x0040dedc，移动音效表 0x48234a 的
 *    第 9 项），走子途中没有逐格音效。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorTokens,
  actorWalkDirection,
  actorWalkSteps,
  actorWalkTotalMs,
  BoardRenderer,
  type Camera,
} from './render.ts';
import { SpriteCache, screenDirection, type Sprite } from './assets.ts';
import {
  ACTOR_DOLL,
  ACTOR_PLACE,
  makeGameState,
  makeNode,
  type GameState,
  type MapNode,
  type Rich4Map,
  type SpecialActor,
} from '@rich4/core';

// ============================================================
//  工具
// ============================================================

/** 一条直线地图，节点间隔 40 世界单位（与 render.test.ts 同一套） */
function lineNodes(n: number): MapNode[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode({ id: i + 1, x: i * 40, y: 0, adjacent: [i, i + 2].filter((v) => v >= 1 && v <= n) }),
  );
}

function lineMap(n: number): Rich4Map {
  return {
    nodes: lineNodes(n),
    lands: [],
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  };
}

/** 地图视角、单位缩放 —— 世界坐标 == 屏幕坐标，好算 */
const CAM: Camera = { x: 0, y: 0, scale: 1, view: 0, tileX: 0, tileY: 0 };

/** 一個「未出場」的替身记录 —— `runDoll` 走完就是它 */
function idle(place: SpecialActor['place'] = ACTOR_PLACE.offBoard): SpecialActor {
  return {
    nodeId: 0,
    lastNodeId: 0,
    direction: 0,
    owner: 0,
    stepsRemaining: 0,
    halted: 0,
    singleStep: 0,
    place,
  };
}

/** 造一个「娃娃刚走完、记录已收场」的 state（= `reduce` 里 `runDoll` 那一步的产物） */
function afterDollWalk(path: readonly number[]): GameState {
  const s = makeGameState();
  const specialActors = [...s.specialActors];
  specialActors[ACTOR_DOLL - 4] = idle();
  return { ...s, specialActors, lastNpcWalks: [{ slot: ACTOR_DOLL - 4, path: [...path] }] };
}

// ============================================================
//  ① 补间的「这一格朝哪」——娃娃的朝向只能从补间现算
// ============================================================

describe('★ 替身逐格的朝向（`actorWalkDirection`）—— 与 exe 的 `_rich4_calculate_direction` 同源', () => {
  it('世界位移 → 八向：屏幕下 = 0，顺时针每 45° 一个（@source VA 0x00454fb4 + 重映射表 0x482414）', () => {
    const step = (dx: number, dy: number): number =>
      actorWalkDirection({ from: { x: 0, y: 0 }, to: { x: dx, y: dy } });
    // 屏幕 y 向下，故「向下」是 0（面朝镜头那一支）
    expect(step(0, 10)).toBe(0); // ↓
    expect(step(10, 10)).toBe(1); // ↘
    expect(step(10, 0)).toBe(2); // →
    expect(step(10, -10)).toBe(3); // ↗
    expect(step(0, -10)).toBe(4); // ↑
    expect(step(-10, -10)).toBe(5); // ↖
    expect(step(-10, 0)).toBe(6); // ←
    expect(step(-10, 10)).toBe(7); // ↙
  });

  it('原地不动（位移 0）= 0 —— 原版 `0x454fe5` 两个都是 0 那支不改朝向', () => {
    expect(actorWalkDirection({ from: { x: 5, y: 5 }, to: { x: 5, y: 5 } })).toBe(0);
  });

  it('★ **面朝去路**，不是倒着走 —— 向下走的那一格拿到「正面」那一组图', () => {
    // 节点 2 在节点 1 的正下方（屏幕 y 向下）
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), makeNode({ id: 2, x: 0, y: 40 })];
    const steps = actorWalkSteps([1, 2], nodes, (x, y) => ({ x, y }), 20);
    expect(steps).toHaveLength(1);
    // 0 = 面朝屏幕下 = 正面（见 0380_000 那张正面图）
    expect(actorWalkDirection(steps[0]!)).toBe(0);
    // 视角 0 时图组就是 0；走姿 0x20a 的第 0..4 张 = 正面 5 帧
    expect(screenDirection(0, 0)).toBe(0);
    // 往回走（向上）= 背面那一组（4），与玩家同一套
    const up = actorWalkSteps([2, 1], nodes, (x, y) => ({ x, y }), 20);
    expect(actorWalkDirection(up[0]!)).toBe(4);
  });
});

describe('★ 补间每一格带上自己的节点号（娃娃收场后 state 里已经没有它了）', () => {
  it('`fromNode` / `toNode` 就是 `path` 上相邻的两个节点', () => {
    const steps = actorWalkSteps([3, 4, 5], lineNodes(5), (x, y) => ({ x, y }), 20);
    expect(steps.map((s) => [s.fromNode, s.toNode])).toEqual([
      [3, 4],
      [4, 5],
    ]);
  });
});

// ============================================================
//  ② 不在盘上、但这一帧还在走 → 照样要画（需求方报的那一条）
// ============================================================

describe('★ 機器娃娃走完就收场 —— 补间还在播的这几帧必须照画', () => {
  const s = afterDollWalk([1, 2, 3]);
  const nodes = lineNodes(3);

  it('★ 不喂 `walkingOffBoard` 就整趟画不出人（= 修之前的行为，钉住别退回去）', () => {
    // `place = offBoard` → 按原版那句 `place != 0 跳过`
    expect(s.specialActors[ACTOR_DOLL - 4]!.place).toBe(ACTOR_PLACE.offBoard);
    expect(actorTokens(s, nodes, { view: 0, walking: () => true })).toEqual([]);
  });

  it('★ 喂了 → 出一个**走姿** token，图组是娃娃专用的 0x20a', () => {
    const tokens = actorTokens(s, nodes, {
      view: 0,
      walking: () => true,
      frame: () => 3,
      currentActor: ACTOR_DOLL,
      // ★ 只有娃娃那个槽在走 —— 其余四个回调给 null（宿主也是这么喂的）
      walkingOffBoard: (slot) => (slot === ACTOR_DOLL - 4 ? { nodeId: 2, direction: 2 } : null),
    });
    expect(tokens).toHaveLength(1);
    const t = tokens[0]!;
    expect(t.actor).toBe(ACTOR_DOLL);
    expect(t.slot).toBe(ACTOR_DOLL - 4);
    expect(t.resource).toBe(0x20a); // 走姿 40 张：8 向 × 5 帧
    expect(t.walking).toBe(true);
    expect(t.frame).toBe(3);
    expect(t.screenDir).toBe(2); // (direction 2 + 8 − view 0) & 7
    expect(t.nodeId).toBe(2);
    expect(t.x).toBe(40);
  });

  it('回老家的惡人（place = 監獄）同一条路 —— 也照画', () => {
    const jailed = afterDollWalk([1, 2]);
    const specialActors = [...jailed.specialActors];
    specialActors[0] = idle(ACTOR_PLACE.prison);
    const tokens = actorTokens({ ...jailed, specialActors }, lineNodes(2), {
      view: 0,
      walking: () => true,
      walkingOffBoard: (slot) => (slot === 0 ? { nodeId: 2, direction: 0 } : null),
    });
    expect(tokens.map((t) => [t.slot, t.resource])).toEqual([[0, 381]]); // 380 + 1 = 走姿
  });

  it('回调返回 null（这一帧没有补间）= 收场，不画 —— 走完娃娃就消失', () => {
    expect(
      actorTokens(s, nodes, { view: 0, walking: () => false, walkingOffBoard: () => null }),
    ).toEqual([]);
  });

  it('回调给的节点号越界 → 不画（不许凭空画一格不存在的）', () => {
    expect(
      actorTokens(s, nodes, {
        view: 0,
        walking: () => true,
        walkingOffBoard: (slot) => (slot === ACTOR_DOLL - 4 ? { nodeId: 99, direction: 0 } : null),
      }),
    ).toEqual([]);
  });

  it('★ 在盘上的替身**不走**这条路（{place:board} 照旧从 state 取节点/朝向）', () => {
    const boardState = afterDollWalk([1, 2]);
    const specialActors = [...boardState.specialActors];
    specialActors[0] = { ...idle(), nodeId: 1, place: ACTOR_PLACE.board, direction: 6 };
    const tokens = actorTokens({ ...boardState, specialActors }, lineNodes(2), {
      view: 0,
      walking: () => false,
      // 就算宿主给了个假的，也不该盖过 state
      walkingOffBoard: (slot) => (slot === 0 ? { nodeId: 2, direction: 0 } : null),
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.nodeId).toBe(1);
    expect(tokens[0]!.screenDir).toBe(6);
    expect(tokens[0]!.resource).toBe(380); // 站姿
  });
});

// ============================================================
//  ③ 端到端：`BoardRenderer.draw()` 真的把娃娃画出来了、走完真的收掉
// ============================================================

/**
 * 假的位图 —— 渲染器 `drawImage` 传的是 **`sprite.bitmap`**，不是精灵本身，
 * 所以资源号要挂在位图上才认得出画的是哪一组图。
 */
interface FakeBitmap {
  close: () => void;
  res: number;
  idx: number;
}

/** 假画布：只记 `drawImage` 画了哪张图（按位图上挂的资源号认） */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D;
  images: { bitmap: FakeBitmap; x: number; y: number }[];
  clear: () => void;
} {
  const images: { bitmap: FakeBitmap; x: number; y: number }[] = [];
  const noop = (): void => undefined;
  const ctx = {
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
    drawImage: (b: unknown, x: number, y: number) => {
      images.push({ bitmap: b as FakeBitmap, x, y });
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  // 每帧只看**这一帧**画了什么 —— 上一帧的记录先清掉
  return { ctx, images, clear: () => (images.length = 0) };
}

/** 假图集缓存：按资源号发精灵，`imageCount` 给真帧数（娃娃 8 / 40） */
function fakeCache(): SpriteCache {
  const cache = new SpriteCache({ get: () => ({ read: () => new Uint8Array(0) }) } as never, {});
  vi.spyOn(cache, 'imageCount').mockImplementation((_a, res) =>
    res === 0x209 ? 8 : res === 0x20a ? 40 : 8,
  );
  vi.spyOn(cache, 'get').mockImplementation(async (_a, res, idx) => {
    const sp = {
      bitmap: { close: () => undefined, res, idx },
      width: 16,
      height: 24,
      anchorX: 8,
      anchorY: 16,
    } as unknown as Sprite;
    return sp;
  });
  return cache;
}

describe('★ 端到端：`draw()` 里娃娃那一趟真的画得出来（需求方报的「没有动画」）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ 补间在播的几帧画出走姿 0x20a；播完就收场不再画', async () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    const path = [1, 2, 3];
    const state = afterDollWalk(path);
    const map = lineMap(3);
    const { ctx, images, clear } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    const input = {
      map,
      state,
      camera: CAM,
      hoverNode: null,
      viewport: { w: 440, h: 440 },
      actorWalks: state.lastNpcWalks,
      tickMs: 20,
    };

    const dollDraws = (): { x: number; y: number }[] =>
      images.filter((i) => i.bitmap.res === 0x20a).map((i) => ({ x: i.x, y: i.y }));

    // 第 1 帧：补间刚起、精灵还在解码 —— 这一帧画不出来是正常的（原版同样跳过空指针）
    clear();
    renderer.draw(input);
    expect(dollDraws()).toHaveLength(0);

    // 解码落地（`#sprite` 是异步的），再画一帧
    await new Promise((r) => setTimeout(r, 0));
    clock = 1000 + 5; // 还在第一格里
    clear();
    renderer.draw(input);
    const first = dollDraws();
    expect(first).toHaveLength(1);

    // ★ 娃娃**不在盘上**（走完就 idleActor），却画出来了 —— 这就是修好的那一条
    expect(state.specialActors[ACTOR_DOLL - 4]!.nodeId).toBe(0);

    // 走过一格之后位置必须变了（不是钉死在起点）
    const total = actorWalkTotalMs(
      actorWalkSteps(path, map.nodes, (x, y) => ({ x, y }), 20),
    );
    clock = 1000 + Math.floor(total / 2);
    clear();
    renderer.draw(input);
    const mid = dollDraws();
    expect(mid).toHaveLength(1);
    expect(mid[0]!.x).not.toBe(first[0]!.x);

    // 整趟播完 → 补间被清掉 → 娃娃收场，画面里不再有 0x20a
    clock = 1000 + total + 1;
    clear();
    renderer.draw(input);
    expect(dollDraws()).toHaveLength(0);
  });

  it('「動畫過程」关掉 → 补间压根不起，也不画（与原版同一条开关）', () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const state = afterDollWalk([1, 2, 3]);
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    const input = {
      map: lineMap(3),
      state,
      camera: CAM,
      hoverNode: null,
      viewport: { w: 440, h: 440 },
      actorWalks: state.lastNpcWalks,
      tickMs: 20,
      animation: false,
    };
    renderer.draw(input);
    clock = 1005;
    renderer.draw(input);
    expect(images.filter((i) => i.bitmap.res === 0x20a)).toHaveLength(0);
  });
});
