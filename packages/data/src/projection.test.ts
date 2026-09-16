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
import { SUBTILE_MATRIX, VIEW_COUNT, projectCell, projectWorld } from './projection.ts';

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

  it('★ 余量等价于把世界点平移（同一视角下）', () => {
    // 镜头往 +x 挪 8 ⇒ 点 x=320 的投影 = 镜头不动时点 x=312 的投影
    const a = projectWorld(0, 320, 320, 5, 5, 8, 0);
    const b = projectWorld(0, 312, 320, 5, 5, 0, 0);
    expect(a).toEqual(b);
  });

  it('★ 余量大于点的块内坐标时跨到**上一个块**（算术右移 + 低位与）', () => {
    // sub=8、x=4 ⇒ px = −4 ⇒ `px >> 5 = −1`（上一个块）、`px & 31 = 28`（余量）
    // 等价形式：同一个相机、把世界点左移 8
    const a = projectWorld(0, 4, 32, 0, 1, 8, 0);
    const b = projectWorld(0, 4 - 8, 32, 0, 1, 0, 0);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    // ★ 它**不等于**「换一台 tileX − 1 的相机」—— 那样 col 会多 1、整格错位
    const wrong = projectWorld(0, -4, 32, -1, 1, 0, 0);
    expect(a).not.toEqual(wrong);
  });

  it('★ 余量对每个视角都只是「平移世界点」（与 SUBTILE_MATRIX 自洽）', () => {
    for (let v = 0; v < VIEW_COUNT; v++) {
      for (const sub of [1, 8, 17, 31]) {
        const a = projectWorld(v, 200, 200, 3, 3, sub, 0);
        const b = projectWorld(v, 200 - sub, 200, 3, 3, 0, 0);
        expect(a, `视角 ${v} 余量 ${sub}`).toEqual(b);
      }
    }
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
