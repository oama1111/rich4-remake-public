/*
 * 放置類道具的投掷动效与物件图 —— 数值全部照 exe 钉死
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 出处见 `throw-fx.ts` 的文件头：`_rich4_animate_object`（VA 0x0040e669）
 * 与 `_rich4_place_object`（VA 0x0040e033）/ `_rich4_load_map`（VA 0x004080b2）。
 * 这里连数值一起钉住 —— 改了帧数公式、每帧 24 ms、图集基号，表现就与原版不一样。
 */
import { describe, expect, it } from 'vitest';
import { directionOf } from '@rich4/core';
import { screenDirection } from './assets.ts';
import {
  OBJECT_SPRITE_BASE,
  THROW_FRAME_MS,
  THROW_SETTLE_MS,
  flightDone,
  flightPosAt,
  flightRunning,
  makeObjectFlight,
  objectFacing,
  objectImageIndex,
  objectSpriteResource,
  throwFrameAt,
  throwFrameCount,
  throwTotalMs,
} from './throw-fx.ts';

describe('throwFrameCount —— 照 exe 的帧数公式', () => {
  it('★ 就是 trunc(√(dx²+dy²) × 0.125 + 1)', () => {
    // @source VA 0x0040e73c..0x0040e754，常量 0x46324c = 0.125f
    expect(throwFrameCount(0, 0)).toBe(1);
    expect(throwFrameCount(8, 0)).toBe(2); // 1 + 1
    expect(throwFrameCount(36, 0)).toBe(5); // 4.5 + 1 = 5.5 → 5
    expect(throwFrameCount(40, 0)).toBe(6); // 5 + 1
    expect(throwFrameCount(50, 0)).toBe(7); // 6.25 + 1 = 7.25 → 7
    expect(throwFrameCount(80, 0)).toBe(11); // 10 + 1
  });

  it('合成距离按欧氏算（√(dx²+dy²)）', () => {
    expect(throwFrameCount(30, 40)).toBe(throwFrameCount(50, 0));
    expect(throwFrameCount(30, 40)).toBe(7);
  });

  it('截断是**向零**（@source fcn_00457dbc），不是四舍五入', () => {
    // 49 × 0.125 + 1 = 7.125 → 7（round 会给 7，但 56 → 8.0 边界要显式挡住）
    expect(throwFrameCount(49, 0)).toBe(7);
    expect(throwFrameCount(56, 0)).toBe(8);
    // 47.9 × 0.125 + 1 = 6.9875 → 6
    expect(throwFrameCount(47.9, 0)).toBe(6);
  });
});

describe('throwFrameAt —— 线性等分（不是弧线）', () => {
  const from = { x: 10, y: 20 };
  const to = { x: 90, y: 60 };

  it('★ 第 N 帧**正好落在终点**（原版 curX = 起点 + N × step）', () => {
    const last = throwFrameAt(from, to, 8, 8);
    expect(last.x).toBeCloseTo(90, 9);
    expect(last.y).toBeCloseTo(60, 9);
  });

  it('★ 第一帧就已经离起点一步（原版先加一次 step 才进循环）', () => {
    const first = throwFrameAt(from, to, 8, 1);
    expect(first.x).toBeCloseTo(10 + 80 / 8, 9);
    expect(first.y).toBeCloseTo(20 + 40 / 8, 9);
  });

  it('中间帧按 k/N 等分', () => {
    expect(throwFrameAt(from, to, 4, 3)).toEqual({ x: 70, y: 50 });
  });

  it('k 越界就夹在 1..N（不会画到线段外）', () => {
    expect(throwFrameAt(from, to, 4, 0)).toEqual(throwFrameAt(from, to, 4, 1));
    expect(throwFrameAt(from, to, 4, 9)).toEqual(throwFrameAt(from, to, 4, 4));
  });
});

describe('节拍 —— 每帧 24 ms，收尾再停 100 ms', () => {
  it('@source VA 0x0040e987 `cmp eax, 0x18` / VA 0x00446c12 `push 0x64`', () => {
    expect(THROW_FRAME_MS).toBe(24);
    expect(THROW_SETTLE_MS).toBe(100);
    expect(throwTotalMs(6)).toBe(6 * 24 + 100);
    expect(throwTotalMs(0)).toBe(24 + 100); // 兜底：至少一帧
  });
});

describe('objectSpriteResource —— 物件种类 → Data.mkf 资源号', () => {
  it('★ 基号 0x18c = 396（@source VA 0x004080b6 `lea eax,[ebx+0x18c]`）', () => {
    expect(OBJECT_SPRITE_BASE).toBe(0x18c);
    expect(objectSpriteResource(1)).toBe(396);
  });

  it('★ 三件道具：路障(16)=411、地雷(17)=412、定時炸彈(18)=413', () => {
    expect(objectSpriteResource(16)).toBe(411);
    expect(objectSpriteResource(17)).toBe(412);
    expect(objectSpriteResource(18)).toBe(413);
  });

  it('表尾是种类 20 → 415（`cmp ebx, 0x14`）；越界返回 null', () => {
    expect(objectSpriteResource(20)).toBe(415);
    expect(objectSpriteResource(0)).toBeNull();
    expect(objectSpriteResource(21)).toBeNull();
    expect(objectSpriteResource(-1)).toBeNull();
    expect(objectSpriteResource(1.5)).toBeNull();
  });
});

describe('objectImageIndex —— 图号 = 8 − 视角 + 朝向', () => {
  it('★ 与玩家的 screenDirection 是同一个公式（不另写一份）', () => {
    for (let view = 0; view < 8; view++) {
      for (let facing = 0; facing < 8; facing++) {
        expect(objectImageIndex(facing, view)).toBe(screenDirection(facing, view));
      }
    }
  });

  it('@source VA 0x00408ee2..0x00408ef2：视角 0 时图号 = 朝向', () => {
    expect(objectImageIndex(0, 0)).toBe(0);
    expect(objectImageIndex(4, 0)).toBe(4);
    // 视角 1 时整体回绕一格
    expect(objectImageIndex(0, 1)).toBe(7);
    expect(objectImageIndex(7, 1)).toBe(6);
  });
});

describe('objectFacing —— 物件面朝来路（第一个非 0 邻接槽）', () => {
  // 造一张小地图：1 在 (0,0)、2 在 (100,0)、3 在 (0,100)
  const nodes = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const at = (slots: [number, number, number, number], x: number, y: number): number =>
    objectFacing({ x, y, adjacentSlots: slots }, nodes, directionOf);

  it('第一个非 0 槽决定朝向（后面的槽忽略）', () => {
    // 本格在 (100,0)，来路是 (0,0)：本格 − 邻格 = (+100, 0) → 朝右
    expect(at([1, 0, 0, 0], 100, 0)).toBe(directionOf(100, 0));
    // 同样两格，但槽顺序反过来（先 3 后 1）→ 朝向变成 (100,0) − (0,100) = (+100,−100)
    expect(at([3, 1, 0, 0], 100, 0)).toBe(directionOf(100, -100));
  });

  it('★ 是「从邻格指向本格」的方向，不是反过来', () => {
    const forward = at([1, 0, 0, 0], 100, 0);
    const backward = at([2, 0, 0, 0], 0, 0);
    expect(forward).toBe(directionOf(100, 0));
    expect(backward).toBe(directionOf(-100, 0));
    expect(forward).not.toBe(backward);
  });

  it('四个槽全 0（孤立格）退回 0，不抛', () => {
    expect(at([0, 0, 0, 0], 0, 0)).toBe(0);
  });
});

describe('makeObjectFlight / flightPosAt —— 一条投掷的时间线', () => {
  const f = makeObjectFlight({
    objectIndex: 16,
    type: 16,
    facing: 2,
    from: { x: 0, y: 0 },
    to: { x: 50, y: 0 },
    start: 1000,
  });

  it('帧数在开播时按屏幕距离定死一次（7 帧 = 150px 内）', () => {
    expect(f.frames).toBe(7);
    expect(f.objectIndex).toBe(16);
    expect(f.type).toBe(16);
  });

  it('k = floor(已过毫秒 / 24) + 1，第一帧在 start 那一刻', () => {
    expect(flightPosAt(f, 1000)).toEqual(throwFrameAt(f.from, f.to, 7, 1));
    expect(flightPosAt(f, 1023)).toEqual(throwFrameAt(f.from, f.to, 7, 1));
    expect(flightPosAt(f, 1024)).toEqual(throwFrameAt(f.from, f.to, 7, 2));
  });

  it('★ 画到最后一帧时正好在目标格上（此后不再动）', () => {
    const last = flightPosAt(f, 1000 + 6 * 24);
    expect(last?.x).toBeCloseTo(50, 9);
    // 再往后（收尾停顿那 100 ms）也停在终点
    expect(flightPosAt(f, 1000 + 6 * 24 + 99)?.x).toBeCloseTo(50, 9);
  });

  it('还没到 start（时钟回拨）返回 null，不画', () => {
    expect(flightPosAt(f, 999)).toBeNull();
  });

  it('播完的判据含那 100 ms 收尾停顿', () => {
    const end = 1000 + throwTotalMs(7);
    expect(flightRunning(f, end - 1)).toBe(true);
    expect(flightDone(f, end - 1)).toBe(false);
    expect(flightDone(f, end)).toBe(true);
    expect(flightRunning(f, end)).toBe(false);
  });
});
