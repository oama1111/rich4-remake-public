/*
 * 存讀檔屏的版式与槽位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_SLOT,
  LOAD_SLOTS,
  ROW,
  SAVELOAD_AT,
  SAVELOAD_SIZE,
  SAVE_SLOTS,
  hitSaveLoad,
  outsideSaveLoad,
  panelRect,
  rowCount,
  rowRect,
  slotKey,
  slotOfRow,
} from './saveload.ts';
import { SCREEN_H, SCREEN_W } from './stage.ts';

describe('存讀檔屏的版式', () => {
  it('屏幕位置与行距都是 exe 里的常量', () => {
    // @source 0x00403dbd `mov edi, 0x28` / `mov ebp, 0xf`
    expect(SAVELOAD_AT).toEqual({ x: 0x28, y: 0x0f });
    // @source 0x00403f4b `edi = 72*slot + 0x18`、0x00403f59 `push 0x81`
    expect(ROW.pitch).toBe(72);
    expect(ROW.y0).toBe(0x18);
    expect(ROW.x).toBe(0x81);
  });

  it('两张底图都放得进 640×480', () => {
    for (const mode of ['load', 'save'] as const) {
      const p = panelRect(mode);
      expect(p.x + p.w).toBeLessThanOrEqual(SCREEN_W);
      expect(p.y + p.h).toBeLessThanOrEqual(SCREEN_H);
    }
  });

  it('★ LOAD 六槽、SAVE 五槽 —— 差的那一槽是自動存檔', () => {
    expect(LOAD_SLOTS).toBe(6);
    expect(SAVE_SLOTS).toBe(5);
    expect(rowCount('load')).toBe(6);
    expect(rowCount('save')).toBe(5);
    // LOAD 的第 0 行就是自動存檔；SAVE 的第 0 行是 1 号槽
    expect(slotOfRow('load', 0)).toBe(AUTOSAVE_SLOT);
    expect(slotOfRow('save', 0)).toBe(1);
    // 两张底图高度差正好是一行多一点（451 − 381 = 70）
    expect(SAVELOAD_SIZE.load.h - SAVELOAD_SIZE.save.h).toBe(70);
  });

  it('每一行都在底图里，且互不重叠', () => {
    for (const mode of ['load', 'save'] as const) {
      const p = panelRect(mode);
      const rects = Array.from({ length: rowCount(mode) }, (_, i) => rowRect(mode, i));
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(p.x);
        expect(r.x + r.w).toBeLessThanOrEqual(p.x + p.w);
        expect(r.y + r.h).toBeLessThanOrEqual(p.y + p.h);
      }
      for (let i = 1; i < rects.length; i++) {
        expect(rects[i]!.y).toBeGreaterThanOrEqual(rects[i - 1]!.y + rects[i - 1]!.h);
      }
    }
  });

  it('每一行的正中都命中它自己', () => {
    for (const mode of ['load', 'save'] as const) {
      for (let i = 0; i < rowCount(mode); i++) {
        const r = rowRect(mode, i);
        expect(hitSaveLoad(mode, r.x + r.w / 2, r.y + r.h / 2)).toBe(i);
      }
    }
  });

  it('屏外的点算「点空白」，屏内没中行的不算', () => {
    expect(outsideSaveLoad('load', 0, 0)).toBe(true);
    const p = panelRect('load');
    expect(outsideSaveLoad('load', p.x + 2, p.y + 2)).toBe(false);
    expect(hitSaveLoad('load', p.x + 2, p.y + 2)).toBeNull();
  });

  it('存档键照原版的文件名来', () => {
    expect(slotKey(0)).toBe('RICH4-REMAKE:SAVE0.DAT');
    expect(slotKey(5)).toBe('RICH4-REMAKE:SAVE5.DAT');
  });
});
