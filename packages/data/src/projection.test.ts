/*
 * 世界坐标 → 屏幕投影 —— 含「摄像机的亚格余量」（Q-PICK-1 贴边推镜头）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `projectWorld` 是 `fcn_004090fc`（VA 0x004090fc）的逐行翻译：
 * 先按 32 取整得块坐标查表，再用块内余数走 `SUBTILE_MATRIX` 补亚像素。
 *
 * ★ 2026-09-16 加的 `subX` / `subY` 两个参数是为**拾取模式的贴边推镜头**
 *   （Q-PICK-1）：原版那一段把镜头中心当作**像素**坐标逐 tick 推 8..68 px
 *   （@source `rich4_ui_use_tool.asm:392`），整格粒度会把 8 px 变成 0/32 px 跳变。
 */
import { describe, expect, it } from 'vitest';
import {
  SUBTILE_MATRIX,
  VIEW_COUNT,
  projectCell,
  projectWorld,
  subtileOffset,
} from './projection.ts';

describe('projectWorld 的基本形状', () => {
  it('屏幕中心那一格投影到 (0,0) 附近', () => {
    const p = projectWorld(0, 32 * 5, 32 * 5, 5, 5);
    expect(p).not.toBeNull();
    expect(Number.isFinite(p!.x)).toBe(true);
    expect(Number.isFinite(p!.y)).toBe(true);
  });

  it('越界（超出那张 29×29 表）返回 null', () => {
    expect(projectWorld(0, 1, 1, 999, 999)).toBeNull();
  });

  it('八个视角都能投影（不抛、不返回 NaN）', () => {
    for (let v = 0; v < VIEW_COUNT; v++) {
      const p = projectWorld(v, 100, 100, 3, 3);
      expect(p, `视角 ${v}`).not.toBeNull();
      expect(Number.isNaN(p!.x), `视角 ${v}`).toBe(false);
      expect(Number.isNaN(p!.y), `视角 ${v}`).toBe(false);
    }
  });
});

describe('★ Q-PICK-1：投影支持摄像机的**亚格**余量', () => {
  it('余量 0 时与不传完全一致', () => {
    for (const [x, y] of [[0, 0], [32, 64], [321, 655]] as const) {
      expect(projectWorld(0, x, y, 5, 5)).toEqual(projectWorld(0, x, y, 5, 5, 0, 0));
    }
  });

  // ★★ 2026-09-19 订正：下面三条原先断言的是「余量 ≡ 把世界点平移 `sub` 再投影」——
  //   那是旧实现的复述，不是 exe 的算法。exe（`fcn_0040829d`）是：
  //   块差按**各自** `>> 5`（VA 0x00408590 `sar eax,5 / sub eax,[esp+0x50]`）、
  //   物件余量过矩阵后**减**（VA 0x004085ff）、镜头余量过矩阵后**加**（VA 0x004083cc/0x00408603）。
  it('★ @source 0x004085f8：屏幕 = 表[块差] − o(物件余量) + o(镜头余量)', () => {
    for (let v = 0; v < VIEW_COUNT; v++) {
      for (const [x, y, cx, cy] of [
        [320, 320, 168, 160],
        [200, 200, 97, 127],
        [4, 32, 8, 32],
        [1023, 1024, 1000, 1055],
      ] as const) {
        const got = projectWorld(v, x, y, cx >> 5, cy >> 5, cx & 31, cy & 31);
        const cell = projectCell(v, (y >> 5) - (cy >> 5) + 14, (x >> 5) - (cx >> 5) + 14);
        expect(cell, `视角 ${v}`).not.toBeNull();
        const o = subtileOffset(v, x & 31, y & 31);
        const c = subtileOffset(v, cx & 31, cy & 31);
        expect(got, `视角 ${v} 点 (${x},${y}) 镜头 (${cx},${cy})`).toEqual({
          x: cell!.x - o.x + c.x,
          y: cell!.y - o.y + c.y,
        });
      }
    }
  });

  it('★ 镜头正对着的那个点恒落在屏幕中心 (0,0) —— 八视角 × 任意余量', () => {
    // 同块、同余量 ⇒ 表项 (0,0)、两份偏移相消。走子时镜头跟的就是行动者自己
    // ⇒ 行动者恒在正中，滚动的是棋盘（第五份回报第 1 条的判据）
    for (let v = 0; v < VIEW_COUNT; v++) {
      for (const [x, y] of [[0, 0], [321, 655], [1000, 1055], [2084, 220]] as const) {
        expect(projectWorld(v, x, y, x >> 5, y >> 5, x & 31, y & 31)).toEqual({ x: 0, y: 0 });
      }
    }
  });

  it('★ 镜头每挪 1 px，静止物件在屏幕上最多动 6 px（不再整格跳变）', () => {
    // 反证旧毛病：`tileX = x >> 5` 的镜头在 31 → 32 那一步让全屏跳一整格（实测最大 53 px）；
    // 逐像素镜头实测最大 6 px（跨块那一拍：投影表带透视、矩阵带取整 —— exe 同样如此）
    for (let v = 0; v < VIEW_COUNT; v++) {
      let prev = projectWorld(v, 400, 400, 384 >> 5, 384 >> 5, 0, 0)!;
      for (let c = 385; c <= 448; c++) {
        const cur = projectWorld(v, 400, 400, c >> 5, 384 >> 5, c & 31, 0)!;
        expect(Math.abs(cur.x - prev.x), `视角 ${v} 镜头 x=${c}`).toBeLessThanOrEqual(6);
        expect(Math.abs(cur.y - prev.y), `视角 ${v} 镜头 x=${c}`).toBeLessThanOrEqual(6);
        prev = cur;
      }
      // 旧口径（丢掉余量）在跨块那一步的跳变 —— 留着当对照
      const before = projectWorld(v, 400, 400, 415 >> 5, 384 >> 5, 0, 0)!;
      const after = projectWorld(v, 400, 400, 416 >> 5, 384 >> 5, 0, 0)!;
      expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20);
    }
  });

  it('`subtileOffset` 逐行照 `fcn_00407a2c`：两项**各自**算术右移 5 再相加', () => {
    // 视角 0 的矩阵 = (-34, 11, -14, -25)（`dump 0x474910`）
    expect(subtileOffset(0, 31, 0)).toEqual({ x: (-34 * 31) >> 5, y: (11 * 31) >> 5 });
    expect(subtileOffset(0, 1, 1)).toEqual({ x: -2 + -1, y: 0 + -1 });
    expect(subtileOffset(0, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('余量不动边界判定的语义（越界仍 null）', () => {
    expect(projectWorld(0, 1, 1, 999, 999, 31, 31)).toBeNull();
  });

  it('`SUBTILE_MATRIX` 八项都是 2×2（投影靠它补亚像素）', () => {
    expect(SUBTILE_MATRIX).toHaveLength(VIEW_COUNT);
    for (const m of SUBTILE_MATRIX) expect(m).toHaveLength(4);
  });

  it('`projectCell` 与 `projectWorld` 在整块坐标上一致（余量 0）', () => {
    const p = projectWorld(0, 32 * 8, 32 * 6, 5, 5, 0, 0);
    const c = projectCell(0, 6 - 5 + 14, 8 - 5 + 14);
    // 14 = VIEW_CENTER；这里只断言两者都能算出值、且形状一致
    expect(p).not.toBeNull();
    if (c !== null) expect(Object.keys(p!)).toEqual(Object.keys(c));
  });
});
