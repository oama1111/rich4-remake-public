/*
 * 機器娃娃把物件**打飞** —— `fcn_0040fafd` + 逐 tick 消耗
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-22 的回报（`feedback/20260922-172529335-manual-Charles.json` (a)）：
 * 「机器娃娃清扫路面时应该是**撞到哪个再播放哪个被扫出去的动画**」。
 * 修之前那一件在娃娃走到它那一格的**那一刻直接不见**（`render.ts` 的 `hideAt`）。
 *
 * 判据（不许猜，全部回 exe / 通道 2）：
 *   ① 起手 `fcn_0040fafd(objIdx, fromNode, toNode)` —— 规格
 *      `rich4-spec/docs/systems/tools.md` §6.1.0 + 通道 2 用例
 *      `rich4-spec/tests/test_object_float_move.py`（13/13）。本文件把它的
 *      **13 条口径逐条移植成 TS**（第 [1]..[4] 组，编号与原文件同）；
 *   ② 逐 tick 的消耗 `rich4-re/asm/rich4.asm:1746-1810`（第 [5] 组）：
 *      先判 29×29 窗口 → `dec +0x06` → 按当时的 `+0x08/+0x0c` 画 → 最后才 `+= 速度`；
 *      越出窗口 ⇒ `+0x06 = 0`（停），而这一件的 `nodeId` 已被清 0 ⇒ 不再画；
 *   ③ 哪个物件在哪一格被打飞：`rich4_player_core_actions.asm:2663-2681`
 *      （VA 0x0041b519 `call fcn_0040fafd` **紧接** VA 0x0041b529 `call _rich4_remove_object`）。
 *
 * ⚠️ 原版这一趟**没有任何音效**（这一支里既没有 `push <音效号>` 也没有
 *   `call 0x4542ce`）—— 唯一那一声是娃娃上路时的音效 38（`0x0040deb9`），
 *   已经由 `main.ts` 播了。详见 `docs/deviations/Q-TOOL-1.md` 本轮的报告。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorWalkSteps,
  BoardRenderer,
  OBJECT_KNOCK_TIMER0,
  objectKnockAt,
  objectKnockStart,
  objectKnockTick,
  sweptObjectFrameAt,
  sweptObjectHideTimes,
  worldToScreen,
  type Camera,
  type KnockPoint,
} from './render.ts';
import { screenDirection, SpriteCache, type Sprite } from './assets.ts';
import { objectFacing } from './throw-fx.ts';
import {
  ACTOR_DOLL,
  ACTOR_PLACE,
  makeGameState,
  makeNode,
  OBJECT_TYPE_MINE,
  directionOf,
  type GameState,
  type MapNode,
  type Rich4Map,
} from '@rich4/core';

const P = (x: number, y: number): KnockPoint => ({ x, y });

/** IEEE-754 单精度 —— 原版每一处落点都是 `fstp dword`（Python 那份的 `f32`） */
const f32 = (x: number): number => Math.fround(x);

// ============================================================
//  [1]..[4]：`test_object_float_move.py` 的 13 条口径（逐条对应）
// ============================================================

describe('★ `fcn_0040fafd` 起手 —— 通道 2 `test_object_float_move.py` 13/13 的 TS 复算', () => {
  /** Python 的 `nodes`：1:(100,200) 2:(300,260) 3:(7,9) 4:(-40,16) */
  const N1 = P(100, 200);
  const N2 = P(300, 260);
  const N3 = P(7, 9);
  const N4 = P(-40, 16);

  it('[1] 速度 = (from − to) × 0.5；位置 = from + 速度（4 条）', () => {
    const k = objectKnockStart(N1, N2, 3);
    const dx = 100 - 300;
    const dy = 200 - 260;
    const vx = f32(dx * 0.5);
    const vy = f32(dy * 0.5);
    expect(k.vx).toBe(vx); // −100
    expect(k.vy).toBe(vy); // −30
    expect(k.x).toBe(f32(100 + vx)); // 0
    expect(k.y).toBe(f32(200 + vy)); // 170
    // 字面值也钉一遍（与 Python 的注释同）
    expect([k.vx, k.vy, k.x, k.y]).toEqual([-100, -30, 0, 170]);
  });

  it('[2] 反向 / 负坐标也照同一式子（4 条）', () => {
    const k = objectKnockStart(N4, N3, 3);
    const dx = -40 - 7;
    const dy = 16 - 9;
    const vx = f32(dx * 0.5);
    const vy = f32(dy * 0.5);
    expect(k.vx).toBe(vx); // −23.5
    expect(k.vy).toBe(vy); // 3.5
    expect(k.x).toBe(f32(-40 + vx)); // −63.5
    expect(k.y).toBe(f32(16 + vy)); // 19.5
    expect([k.vx, k.vy, k.x, k.y]).toEqual([-23.5, 3.5, -63.5, 19.5]);
  });

  it('★ [3] 计时位与朝向副本（3 条）', () => {
    const k = objectKnockStart(N1, N2, 3);
    expect(k.timer).toBe(0xff); // `+0x06 = 0xFF`（@source 0x0040fb9b）
    expect(k.timer).toBe(OBJECT_KNOCK_TIMER0);
    expect(k.facing).toBe(3); // ★★ `+0x07 ← +0x01`（@source 0x0040fba3/0x0040fbaa）
    expect(objectKnockStart(N1, N2, 7).facing).toBe(7); // 换个朝向再验一次
  });

  it('★ [4] 没有东西可飞 ⇒ 一个字节都不写（2 条；原用例是 `objIdx == 0` 直接 return）', () => {
    // ① 「空槽」在本引擎的对应物 = 拿不到那件物件 / 拿不到节点 ⇒ 不产出飞行参数
    const nodes = [makeNode({ id: 1, x: 0, y: 0 }), makeNode({ id: 2, x: 40, y: 0 })];
    const steps = actorWalkSteps([1, 2], nodes, 20);
    const objects = [{ type: OBJECT_TYPE_MINE, nodeId: 0, state: 0, attached: 0 }];
    // `cleared` 指着一个不存在的下标 → 整条跳过（不写任何东西）
    expect(sweptObjectHideTimes(steps, objects, [1, 2], [{ index: 9, step: 1 }], nodes)).toEqual([]);
    // `step <= 0`（出发格，`runDoll` 不会产生）⇒ 有 hideAt、但**没有方向** ⇒ 不打飞
    const at0 = sweptObjectHideTimes(steps, objects, [1, 2], [{ index: 0, step: 0 }], nodes);
    expect(at0).toHaveLength(1);
    expect(at0[0]!.knock).toBeNull();
    expect(sweptObjectFrameAt(at0[0]!, 999, 20, () => true)).toBeNull();
    // ② 「不写入」= 纯函数不改入参（起手的 from/to 原样）
    const from = P(100, 200);
    const to = P(300, 260);
    objectKnockStart(from, to, 3);
    expect(from).toEqual({ x: 100, y: 200 });
    expect(to).toEqual({ x: 300, y: 260 });
  });
});

// ============================================================
//  [5] 逐 tick 的消耗 —— `rich4.asm:1746-1810`
// ============================================================

describe('★ 逐 tick 消耗（`rich4.asm:1746-1810`）—— 计时递减 / 位置累加 / 越界停止', () => {
  const from = P(100, 200);
  const to = P(300, 260);

  it('`+0x06` 每画一拍减 1；减到 0 之后的下一拍不再画', () => {
    // `00408d47 dec byte [obj+6]` —— 先画后减？不：**先减再画**（dec 在落点之前）
    expect(objectKnockAt(from, to, 3, 0)!.timer).toBe(0xfe);
    expect(objectKnockAt(from, to, 3, 1)!.timer).toBe(0xfd);
    expect(objectKnockAt(from, to, 3, 10)!.timer).toBe(0xff - 1 - 10);
    // 第 0..0xFE 拍可画（第 0xFE 拍时计时刚减到 0）
    expect(objectKnockAt(from, to, 3, 0xfe)).not.toBeNull();
    expect(objectKnockAt(from, to, 3, 0xfe)!.timer).toBe(0);
    // 第 0xFF 拍：进循环前 `cmp byte [obj+6], 0` 命中 ⇒ 静态那支，而 node 已清 0 ⇒ 不画
    expect(objectKnockAt(from, to, 3, 0xff)).toBeNull();
    expect(objectKnockAt(from, to, 3, -1)).toBeNull();
  });

  it('位置按 **float32** 逐拍累加（`+0x08 += +0x10`），第 0 拍就已经推进半格', () => {
    // from=(100,200) to=(300,260) ⇒ v=(−100,−30)；起手 (0,170)
    expect(objectKnockAt(from, to, 3, 0)).toMatchObject({ x: 0, y: 170 });
    expect(objectKnockAt(from, to, 3, 1)).toMatchObject({ x: -100, y: 140 });
    expect(objectKnockAt(from, to, 3, 2)).toMatchObject({ x: -200, y: 110 });
    // 与 `objectKnockTick` 逐步算的一致
    let s = objectKnockStart(from, to, 3);
    for (let t = 0; t < 3; t++) s = objectKnockTick(s);
    expect([s.x, s.y]).toEqual([-300, 80]);
    expect(objectKnockAt(from, to, 3, 3)).toMatchObject({ x: -300, y: 80 });
  });

  it('★ 单精度不是装饰：2^25 上 `from + 速度` 与双精度算的不是同一个数', () => {
    // 原版 `fild from.x / fadd dword [速度] / fstp dword` —— 只有**一次**单精度舍入
    const a = 2 ** 25; // 33554432；这一档 f32 的间距是 4
    const k = objectKnockStart(P(a, 0), P(a + 1, 0), 0);
    expect(k.vx).toBe(-0.5);
    expect(k.x).toBe(f32(a + k.vx)); // 33554432（33554431.5 舍到最近的可表示值）
    expect(k.x).toBe(a);
    expect(k.x).not.toBe(a + k.vx); // 双精度会是 33554431.5
  });

  it('★ 越出 29×29 窗口 ⇒ `+0x06 = 0` 停，而且**这一拍就不画**', () => {
    // 上面那条速度向左：x = 0, −100, −200 …
    const inWindow = (x: number): boolean => x >= -100; // 假窗口：x < −100 就算出去
    expect(objectKnockAt(from, to, 3, 1, (x) => inWindow(x))).not.toBeNull(); // x = −100 还在
    expect(objectKnockAt(from, to, 3, 2, (x) => inWindow(x))).toBeNull(); // x = −200 ⇒ 停
    // 窗口判定用的是**截断后的整数**坐标（原版 `__round_toward_zero` + `sar 5`）
    const seen: number[] = [];
    objectKnockAt(P(0.9, 0), P(1.9, 0), 0, 0, (x) => (seen.push(x), true));
    expect(seen).toEqual([0]); // 不是 0.9
  });

  it('完全在窗口里 ⇒ 一路画到计时耗尽（不去动它）', () => {
    const k = objectKnockAt(from, to, 3, 5, () => true);
    expect(k).not.toBeNull();
    expect(k!.timer).toBe(0xff - 1 - 5);
  });
});

// ============================================================
//  [6] 「哪一件在哪一格被打飞」—— `sweptObjectHideTimes`
// ============================================================

/** 一条直线地图，节点间隔 40 世界单位（与 `doll-tool.test.ts` 同一套） */
function lineNodes(n: number): MapNode[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode({ id: i + 1, x: i * 40, y: 0, adjacent: [i, i + 2].filter((v) => v >= 1 && v <= n) }),
  );
}

describe('★ 娃娃走到 `path[step]` 那一格 ⇒ 那一件按 (本格 − 来路) 被打飞', () => {
  const nodes = lineNodes(4);
  const objects = [{ type: OBJECT_TYPE_MINE, nodeId: 0, state: 0, attached: 0 }];
  const path = [1, 2, 3, 4];
  const steps = actorWalkSteps(path, nodes, 20);

  it('from = `path[step]`、to = `path[step − 1]`（= `0x40fafd` 的两个参数）', () => {
    const out = sweptObjectHideTimes(steps, objects, path, [{ index: 0, step: 2 }], nodes);
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.o.nodeId).toBe(3); // 娃娃清它的那一格
    expect(s.knock).toEqual({
      from: { x: 80, y: 0 }, // path[2] = 节点 3
      to: { x: 40, y: 0 }, // path[1] = 节点 2（来路）
      facing: objectFacing(nodes[2]!, nodes, directionOf),
    });
    // 打飞时刻 = 走到那一格**走完**（= 那一步的 at + ms）
    expect(s.hideAt).toBe(steps[1]!.at + steps[1]!.ms);
    // 起手位置 = 本格 + (本格 − 来路) × 0.5 = 80 + 20 = 100（**已经在飞**）
    expect(objectKnockAt(s.knock!.from, s.knock!.to, s.knock!.facing, 0)).toMatchObject({
      x: 100,
      y: 0,
    });
  });

  it('★ 行为钉子：`hideAt` 之前画在原地、`hideAt` 之后**按飞行位置画**（而不是不画）', () => {
    const s = sweptObjectHideTimes(steps, objects, path, [{ index: 0, step: 2 }], nodes)[0]!;
    const vis = (): boolean => true;
    // 还没走到 → 原地（地面那一段）
    expect(sweptObjectFrameAt(s, s.hideAt - 1, 20, vis)).toEqual({ kind: 'ground' });
    // ★ 恰好走到 = 第 0 拍：**已经在半格外飞着**
    expect(sweptObjectFrameAt(s, s.hideAt, 20, vis)).toEqual({
      kind: 'fly',
      x: 100,
      y: 0,
      facing: s.knock!.facing,
    });
    // 再一拍：又前进半格（80 + 20 + 20）
    expect(sweptObjectFrameAt(s, s.hideAt + 20, 20, vis)).toMatchObject({ kind: 'fly', x: 120 });
    // 越出窗口（`worldToScreen` 返回 null 的那一问）⇒ 飞行结束、这一拍不画
    expect(sweptObjectFrameAt(s, s.hideAt + 20, 20, () => false)).toBeNull();
    // 过了计时上限（0xFF 拍）⇒ 也不画
    expect(sweptObjectFrameAt(s, s.hideAt + OBJECT_KNOCK_TIMER0 * 20, 20, vis)).toBeNull();
  });

  it('图号按 `+0x07`（朝向副本）算 —— 与放地上时同一张图', () => {
    const s = sweptObjectHideTimes(steps, objects, path, [{ index: 0, step: 2 }], nodes)[0]!;
    const ground = objectFacing(nodes[2]!, nodes, directionOf);
    expect(s.knock!.facing).toBe(ground); // `+0x07 ← +0x01`
    for (let view = 0; view < 8; view++) {
      expect(screenDirection(s.knock!.facing, view)).toBe(screenDirection(ground, view));
    }
  });

  it('被打飞的那一件在 `state.objects` 里已经没有 `nodeId`（core 清的）—— 位置只能来自 `path`', () => {
    // 这正是「不靠新字段也能画出来」的依据：`cleared[].step` 是 core 按同一次循环写下的
    const s = sweptObjectHideTimes(
      steps,
      objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 })),
      path,
      [{ index: 0, step: 3 }],
      nodes,
    )[0]!;
    expect(s.o.nodeId).toBe(4);
    expect(s.knock!.from).toEqual({ x: 120, y: 0 });
  });
});

// ============================================================
//  [7] 端到端：`draw()` 里那件真的**飞出去**（不是直接不见）
// ============================================================

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
  return { ctx, images, clear: () => (images.length = 0) };
}

/** 假图集缓存：任何资源发一张 16×24、锚点 (8,16) 的精灵 */
function fakeCache(): SpriteCache {
  const cache = new SpriteCache({ get: () => ({ read: () => new Uint8Array(0) }) } as never, {});
  vi.spyOn(cache, 'imageCount').mockImplementation(() => 8);
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

/** 地图视角、单位缩放（与 `doll-tool.test.ts` 同一套） */
const CAM: Camera = { x: 0, y: 0, scale: 1, view: 0, tileX: 0, tileY: 0 };

describe('★ 端到端：機器娃娃扫到那一格，物件**飞出去**（需求方回报的 (a)）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ `hideAt` 那一刻物件不再原地消失，而是出现在半格之外，之后逐拍往外飞', async () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    const map: Rich4Map = {
      nodes: lineNodes(4),
      lands: [],
      facilities: [],
      commercials: [],
      landscapes: [],
      dataSize: 0,
    };
    // 娃娃刚走完：`state.objects` 里那一件的 nodeId 已被清 0（`dollSweepNode`）
    const state: GameState = {
      ...makeGameState(),
      objects: [{ type: OBJECT_TYPE_MINE, nodeId: 0, state: 0, attached: 0 }],
      lastNpcWalks: [
        { slot: ACTOR_DOLL - 4, path: [1, 2, 3, 4], cleared: [{ index: 0, step: 2 }] },
      ],
    };
    expect(state.specialActors[ACTOR_DOLL - 4]!.place).toBe(ACTOR_PLACE.offBoard);

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

    /** 这一帧画出来的**物件**（地雷 = Data.mkf 412） */
    const mineDraws = (): { x: number; y: number }[] =>
      images
        .filter((i) => i.bitmap.res === 0x18c + OBJECT_TYPE_MINE - 1)
        .map((i) => ({ x: i.x + 8, y: i.y + 16 })); // 加回锚点 = 屏幕落点

    const steps = actorWalkSteps([1, 2, 3, 4], map.nodes, 20);
    const hideAt = steps[1]!.at + steps[1]!.ms;

    // 第 1 帧：精灵还在解码（原版同样跳过空指针）
    clear();
    renderer.draw(input);
    expect(mineDraws()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 0));

    // ① 还没走到那一格 → 画在**原地**（节点 3 = 世界 (80, 0)）
    clock = 1000 + Math.max(0, hideAt - 1);
    clear();
    renderer.draw(input);
    const ground = mineDraws();
    expect(ground).toHaveLength(1);
    expect(ground[0]).toEqual(worldToScreen(80, 0, CAM, { w: 440, h: 440 }));

    // ② ★ 走到那一格的那一刻 → **按飞行位置画**（本格 + 半格 = 世界 (100, 0)），
    //    而不是像修之前那样整件消失
    clock = 1000 + hideAt;
    clear();
    renderer.draw(input);
    const fly0 = mineDraws();
    expect(fly0).toHaveLength(1);
    expect(fly0[0]).toEqual(worldToScreen(100, 0, CAM, { w: 440, h: 440 }));
    expect(fly0[0]).not.toEqual(ground[0]);

    // ③ 再一拍：又前进半格（世界 (120, 0)）
    clock = 1000 + hideAt + 20;
    clear();
    renderer.draw(input);
    const fly1 = mineDraws();
    expect(fly1).toHaveLength(1);
    expect(fly1[0]).toEqual(worldToScreen(120, 0, CAM, { w: 440, h: 440 }));
    expect(fly1[0]).not.toEqual(fly0[0]);
  });

  it('★ 被扫在**最后一格**上的那一件照样飞得出来（飞行不随替身补间一起被删）', async () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    const map: Rich4Map = {
      nodes: lineNodes(4),
      lands: [],
      facilities: [],
      commercials: [],
      landscapes: [],
      dataSize: 0,
    };
    const state: GameState = {
      ...makeGameState(),
      objects: [{ type: OBJECT_TYPE_MINE, nodeId: 0, state: 0, attached: 0 }],
      // 物件在**末格**（`path[3]`）上 ⇒ hideAt = 整趟总时长
      lastNpcWalks: [
        { slot: ACTOR_DOLL - 4, path: [1, 2, 3, 4], cleared: [{ index: 0, step: 3 }] },
      ],
    };
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
    const mineDraws = (): { x: number; y: number }[] =>
      images
        .filter((i) => i.bitmap.res === 0x18c + OBJECT_TYPE_MINE - 1)
        .map((i) => ({ x: i.x + 8, y: i.y + 16 }));

    const steps = actorWalkSteps([1, 2, 3, 4], map.nodes, 20);
    const last = steps[steps.length - 1]!;
    const total = last.at + last.ms;

    clear();
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));

    // 整趟走完的那一拍（`#actorWalks` 里那条已经被删）—— 物件仍在飞
    clock = 1000 + total;
    clear();
    renderer.draw(input);
    const fly = mineDraws();
    expect(fly).toHaveLength(1);
    // from = 世界 (120, 0)、to = (80, 0) ⇒ 半格后 = (140, 0)
    expect(fly[0]).toEqual(worldToScreen(140, 0, CAM, { w: 440, h: 440 }));
    // ★ 还在飞 ⇒ 宿主据此续帧（`main.ts` 那一帧的「要不要再画」里就这一条）
    expect(renderer.sweptFlightActive()).toBe(true);

    // 一直飞到**越出 29×29 窗口**（x > 479 的那一拍）⇒ 这一件收掉、不再续帧
    clock = 1000 + total + 20 * 20;
    clear();
    renderer.draw(input);
    expect(mineDraws()).toHaveLength(0);
    expect(renderer.sweptFlightActive()).toBe(false);
  });
});
