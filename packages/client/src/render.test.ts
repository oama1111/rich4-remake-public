/*
 * 工具栏摆位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { hitToolbar, TOOLBAR } from './render.ts';
import { TOOLBAR_ICON_COUNT, TOOLBAR_STRIP_IMAGE } from './assets.ts';
import { LAYOUT } from './stage.ts';

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
