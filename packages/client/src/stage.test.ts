/*
 * 定屏舞台的缩放与坐标换算
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一层先前**一条测试都没有**，而它决定「画面多大、摆在窗口哪儿」——
 * 需求方 2026-09-14 提出要适配不同分辨率，故把规则钉死在这里。
 */
import { describe, expect, it } from 'vitest';
import { inRect, LAYOUT, SCREEN_H, SCREEN_W, stageMetrics, toStage } from './stage.ts';

describe('LAYOUT —— 各区块合起来正好是 640×480', () => {
  it('★ 横竖两个方向都严丝合缝（不是凑出来的）', () => {
    expect(LAYOUT.toolbar.w + LAYOUT.panel.w).toBe(SCREEN_W - 1); // 439 + 200 = 639
    expect(LAYOUT.board.x + LAYOUT.board.w).toBe(LAYOUT.toolbar.w);
    expect(LAYOUT.board.y + LAYOUT.board.h).toBe(SCREEN_H);
    expect(LAYOUT.panel.y + LAYOUT.panel.h).toBe(LAYOUT.sidebar.y);
    expect(LAYOUT.sidebar.y + LAYOUT.sidebar.h).toBe(SCREEN_H);
  });

  it('四块互不重叠', () => {
    const rects = [LAYOUT.toolbar, LAYOUT.board, LAYOUT.panel, LAYOUT.sidebar];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect({ pair: `${i},${j}`, overlap }).toMatchObject({ overlap: false });
      }
    }
  });
});

describe('stageMetrics —— 整数倍优先，差得多就按小数倍填满', () => {
  it('★ 正好整数倍时用整数倍（像素逐个对齐，最锐利）', () => {
    expect(stageMetrics(1280, 960).scale).toBe(2);
    expect(stageMetrics(1920, 1440).scale).toBe(3);
    expect(stageMetrics(640, 480).scale).toBe(1);
  });

  it('★ 整数倍够贴近（差值 < 0.25）时仍用整数倍，宁可留一点黑边', () => {
    // 1366×768：raw = min(2.13, 1.6) = 1.6 → floor 1，差 0.6 ≥ 0.25 → 用小数
    expect(stageMetrics(1366, 768).scale).toBeCloseTo(1.6, 6);
    // 1300×980：raw = min(2.03, 2.04) = 2.03 → floor 2，差 0.03 < 0.25 → 用 2
    expect(stageMetrics(1300, 980).scale).toBe(2);
  });

  it('★ 1600×900 不被压成 1 倍（那会让画面缩在一角）', () => {
    const m = stageMetrics(1600, 900);
    expect(m.scale).toBeCloseTo(1.875, 6);
    // 铺满高度方向
    expect(SCREEN_H * m.scale).toBeCloseTo(900, 6);
  });

  it('★ 窗口比 640×480 还小时按比例缩小 —— 整屏看得全，不裁切', () => {
    const m = stageMetrics(320, 240);
    expect(m.scale).toBeCloseTo(0.5, 6);
    expect(SCREEN_W * m.scale).toBeLessThanOrEqual(320);
    expect(SCREEN_H * m.scale).toBeLessThanOrEqual(240);
    expect(m.offsetX).toBeGreaterThanOrEqual(0);
    expect(m.offsetY).toBeGreaterThanOrEqual(0);
  });

  it('★ 居中留边：两条边上的黑边之差不超过 1 像素', () => {
    for (const [w, h] of [
      [1600, 900],
      [1366, 768],
      [1280, 1024],
      [800, 600],
      [320, 240],
    ] as const) {
      const m = stageMetrics(w, h);
      const left = m.offsetX;
      const right = w - (m.offsetX + SCREEN_W * m.scale);
      const top = m.offsetY;
      const bottom = h - (m.offsetY + SCREEN_H * m.scale);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
    }
  });

  it('放大后的舞台不超出画布（不裁切）', () => {
    for (const [w, h] of [
      [1600, 900],
      [1366, 768],
      [1000, 1000],
      [320, 240],
    ] as const) {
      const m = stageMetrics(w, h);
      expect(SCREEN_W * m.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(SCREEN_H * m.scale).toBeLessThanOrEqual(h + 1e-9);
    }
  });
});

describe('toStage —— 画布坐标 → 舞台坐标', () => {
  it('★ 舞台四角来回换算一致（整数倍）', () => {
    const m = stageMetrics(1280, 960);
    expect(toStage(m.offsetX + 0.5 * m.scale, m.offsetY + 0.5 * m.scale, m)).toEqual({ x: 0.5, y: 0.5 });
    const lastX = m.offsetX + (SCREEN_W - 0.5) * m.scale;
    const lastY = m.offsetY + (SCREEN_H - 0.5) * m.scale;
    expect(toStage(lastX, lastY, m)).toEqual({ x: SCREEN_W - 0.5, y: SCREEN_H - 0.5 });
  });

  it('★ 小数倍下同样来回一致（自适应那一档）', () => {
    const m = stageMetrics(1600, 900);
    expect(m.scale).not.toBe(Math.floor(m.scale)); // 确认走的确实是小数额
    const p = toStage(m.offsetX + 123 * m.scale, m.offsetY + 45 * m.scale, m);
    expect(p!.x).toBeCloseTo(123, 6);
    expect(p!.y).toBeCloseTo(45, 6);
  });

  it('舞台之外（含黑边）→ null', () => {
    // ⚠️ 得挑一个**真的有黑边**的尺寸：1280×960 正好 2 倍、偏移为 0，
    //    (0,0) 就是舞台左上角，那不是「之外」。
    const m = stageMetrics(1300, 980);
    expect(m.offsetX).toBeGreaterThan(0);
    expect(m.offsetY).toBeGreaterThan(0);
    expect(toStage(0, 0, m)).toBeNull(); // 黑边里
    expect(toStage(m.offsetX - 1, m.offsetY + 10, m)).toBeNull();
    expect(toStage(m.offsetX + SCREEN_W * m.scale, m.offsetY, m)).toBeNull();
    expect(toStage(m.offsetX, m.offsetY + SCREEN_H * m.scale, m)).toBeNull();
  });
});

describe('inRect', () => {
  const r = { x: 10, y: 20, w: 30, h: 40 };
  it('半开区间：上/左含，下/右不含', () => {
    expect(inRect(10, 20, r)).toBe(true);
    expect(inRect(39, 59, r)).toBe(true);
    expect(inRect(40, 20, r)).toBe(false);
    expect(inRect(10, 60, r)).toBe(false);
  });
  it('中心命中自身', () => {
    expect(inRect(r.x + r.w / 2, r.y + r.h / 2, r)).toBe(true);
  });
});
