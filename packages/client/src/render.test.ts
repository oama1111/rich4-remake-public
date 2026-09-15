/*
 * 工具栏摆位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { fitCamera, hitToolbar, TOOLBAR } from './render.ts';
import { TOOLBAR_ICON_COUNT, TOOLBAR_STRIP_IMAGE } from './assets.ts';
import { LAYOUT } from './stage.ts';
import type { Rich4Map } from '@rich4/core';

describe('★ 11 个图标在 439 宽的底条里居中', () => {
  it('两侧留边相等 —— 先前是 6 / 4，图标块整体偏右 1 像素', () => {
    const used = TOOLBAR.pitch * TOOLBAR_ICON_COUNT;
    const padLeft = TOOLBAR.padX;
    const padRight = LAYOUT.toolbar.w - used - TOOLBAR.padX;
    expect(padLeft).toBe(padRight);
  });

  it('图标块的中心与底条的中心重合', () => {
    const first = TOOLBAR.padX + TOOLBAR.pitch / 2;
    const last = TOOLBAR.padX + TOOLBAR.pitch * (TOOLBAR_ICON_COUNT - 1) + TOOLBAR.pitch / 2;
    expect((first + last) / 2).toBe(LAYOUT.toolbar.w / 2);
  });
});

describe('hitToolbar 与图标一一对应', () => {
  it('★ 每个图标格的中心点回它自己', () => {
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      const cx = TOOLBAR.x + TOOLBAR.padX + i * TOOLBAR.pitch + TOOLBAR.pitch / 2;
      const cy = TOOLBAR.y + TOOLBAR.height / 2;
      expect({ i, hit: hitToolbar(cx, cy) }).toMatchObject({ hit: i });
    }
  });

  it('底条之外（含下面一行）→ null', () => {
    expect(hitToolbar(TOOLBAR.padX + 5, TOOLBAR.height)).toBeNull();
    expect(hitToolbar(TOOLBAR.padX + 5, -1)).toBeNull();
    expect(hitToolbar(TOOLBAR.x - 1, 10)).toBeNull();
    // 底条右端之外（439 之后是側欄）
    expect(hitToolbar(LAYOUT.toolbar.w + 5, 10)).toBeNull();
  });

  it('底条自身的图号是 0', () => {
    expect(TOOLBAR_STRIP_IMAGE).toBe(0);
  });
});

describe('fitCamera —— 地图视角要「整张铺满」（S6）', () => {
  /** 造一个 w×h 的节点包围盒 */
  const fakeMap = (w: number, h: number): Rich4Map =>
    ({
      nodes: [
        { id: 1, x: 0, y: 0, name: '', adjacent: [], adjacentSlots: [0, 0, 0, 0], type: 0, ref: { kind: 'unknown', raw: 0 }, decorIndex: 0, flags: 0, specialKind: 0, noObjects: 0, walkable: true },
        { id: 2, x: w, y: h, name: '', adjacent: [], adjacentSlots: [0, 0, 0, 0], type: 0, ref: { kind: 'unknown', raw: 0 }, decorIndex: 0, flags: 0, specialKind: 0, noObjects: 0, walkable: true },
      ],
      lands: [],
      facilities: [],
      commercials: [],
      landscapes: [],
      dataSize: 0,
    }) as unknown as Rich4Map;

  it('★ 整张地图落在给定的视口内（含留边）', () => {
    const m = fakeMap(2304, 2304);
    const cam = fitCamera(m, LAYOUT.board.w, LAYOUT.board.h);
    expect(cam.mode).toBe('map');
    // 地图右下角在视口里的位置
    const brX = (2304 - cam.x) * cam.scale;
    const brY = (2304 - cam.y) * cam.scale;
    expect(brX).toBeLessThanOrEqual(LAYOUT.board.w);
    expect(brY).toBeLessThanOrEqual(LAYOUT.board.h);
    expect(brX).toBeGreaterThan(0);
    expect(brY).toBeGreaterThan(0);
  });

  it('★ 至少占满一个方向 —— 不是缩成一小块', () => {
    const m = fakeMap(2304, 2304);
    const cam = fitCamera(m, LAYOUT.board.w, LAYOUT.board.h);
    const w = 2304 * cam.scale;
    const h = 2304 * cam.scale;
    // 正方形地图放进近似正方形的棋盘区：应当两边都接近占满
    expect(Math.max(w / LAYOUT.board.w, h / LAYOUT.board.h)).toBeGreaterThan(0.85);
  });

  it('★ 按棋盘区取景 ≠ 按整个窗口取景（这正是先前那个 bug）', () => {
    const m = fakeMap(2304, 2304);
    const board = fitCamera(m, LAYOUT.board.w, LAYOUT.board.h);
    const window_ = fitCamera(m, 1280, 960);
    // 窗口大得多，缩放就一定更大；拿窗口尺寸去算，地图会被放大后裁掉大半
    expect(window_.scale).toBeGreaterThan(board.scale);
  });
});
