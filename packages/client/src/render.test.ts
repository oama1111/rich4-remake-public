/*
 * 工具栏摆位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { DRAW_CLASS, drawKey, fitCamera, hitToolbar, TOOLBAR } from './render.ts';
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

describe('★ 绘制槽的排序键（Q-DRAW-1）—— 遮挡关系全靠它', () => {
  it('主序是**屏幕 Y**：屏幕 Y 小的先画（先画 = 会被后画的盖住）', () => {
    // 屏幕 Y 小 = 靠后（远），必须先画；这正是等距视角的画家顺序
    expect(drawKey(100, DRAW_CLASS.building)).toBeLessThan(drawKey(101, DRAW_CLASS.building));
    expect(drawKey(-50, DRAW_CLASS.building)).toBeLessThan(drawKey(0, DRAW_CLASS.building));
  });

  it('★ 同屏幕 Y 时：建筑先画、人物后画 —— 这就是「建筑挡得住人物」的机制', () => {
    const y = 200;
    // 建筑类别 0x0 < 玩家 0xc/0xd ⇒ 建筑排在前面 ⇒ 后画的人物盖住建筑
    expect(drawKey(y, DRAW_CLASS.building)).toBeLessThan(drawKey(y, DRAW_CLASS.player));
    expect(drawKey(y, DRAW_CLASS.player)).toBeLessThan(drawKey(y, DRAW_CLASS.currentPlayer));
  });

  it('类别只做同 Y 的 tie-break，不会盖过屏幕 Y 的主序', () => {
    // 屏幕 Y 差 1，键差 16；类别最大 0xf < 16，故跨 Y 时类别翻不过来
    expect(drawKey(200, DRAW_CLASS.building)).toBeLessThan(drawKey(201, DRAW_CLASS.currentPlayer));
    // 反例检查：若把类别当主序，这一条会失败
    expect(drawKey(200, 0xf) - drawKey(200, 0x0)).toBe(0xf);
  });

  it('★ 关键症状：站在高大建筑**背后**的棋子必须排在建筑前面', () => {
    // 建筑底座在屏幕 Y=300；棋子站在它背后（屏幕 Y 更小 = 更远）
    const building = drawKey(300, DRAW_CLASS.building);
    const behind = drawKey(260, DRAW_CLASS.currentPlayer);
    const inFront = drawKey(340, DRAW_CLASS.currentPlayer);
    expect(behind).toBeLessThan(building); // 远处的人先画 ⇒ 被建筑盖住 ✓
    expect(building).toBeLessThan(inFront); // 近处的人后画 ⇒ 盖住建筑 ✓
  });

  it('负数屏幕 Y 按 12 位截断后仍排在正数之前（原版就是这么算的）', () => {
    expect(drawKey(-1, DRAW_CLASS.building)).toBeLessThan(drawKey(0, DRAW_CLASS.building));
    expect(drawKey(-1, DRAW_CLASS.building)).toBeLessThan(0);
  });
});
