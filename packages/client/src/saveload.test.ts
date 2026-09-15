/*
 * 存讀檔屏的版式与槽位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { initSaveStore, saveStore, type SaveStore } from './host.ts';
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
  readSlot,
  readSlots,
  importRect,
  hitImport,
  formatGaps,
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

describe('★ 存档槽的读写口（T-053）—— 只测「口」本身，序列化是 core 的事', () => {
  /** 假的内存存档口，模拟桌面壳那套（预载进内存 + 写回落文件） */
  function memoryStore(): SaveStore & { files: Map<number, string> } {
    const files = new Map<number, string>();
    return {
      files,
      read: (slot) => files.get(slot) ?? null,
      write: (slot, json) => {
        files.set(slot, json);
        return null;
      },
      slots: () => [...files.keys()].sort((a, b) => a - b),
    };
  }

  it('★ 写进去、读出来一致；slots 只列存在的槽', async () => {
    const store = memoryStore();
    await initSaveStore(store);
    expect(saveStore().write(3, 'AAA')).toBeNull();
    expect(saveStore().write(0, 'BBB')).toBeNull();
    expect(saveStore().read(3)).toBe('AAA');
    expect(saveStore().read(1)).toBeNull();
    expect(saveStore().slots()).toEqual([0, 3]);
  });

  it('★ 读档屏读空槽：state 与 error 都是 null（空槽不是错）', async () => {
    await initSaveStore(memoryStore());
    expect(readSlot(4)).toEqual({ slot: 4, state: null, error: null });
  });

  it('★ 坏档不抛错，只把说明放进 error（读档屏要能显示出来）', async () => {
    const store = memoryStore();
    store.files.set(2, '{ not json');
    await initSaveStore(store);
    const info = readSlot(2);
    expect(info.state).toBeNull();
    expect(info.error).not.toBeNull();
  });

  it('readSlots 逐槽给出概览（空槽也在）', async () => {
    const store = memoryStore();
    store.files.set(0, 'x');
    await initSaveStore(store);
    const all = readSlots(3);
    expect(all.map((s) => s.slot)).toEqual([0, 1, 2]);
    expect(all.map((s) => s.state !== null)).toEqual([false, false, false]);
  });
});

describe('★ 匯入原版存檔的入口（T-054）', () => {
  it('钮只在讀取屏有；位置在底图内、不压行', () => {
    expect(hitImport('load', 48 + 60, 15 + 451 - 32 + 12)).toBe(true);
    // 儲存屏没有这个钮
    expect(hitImport('save', 48 + 60, 15 + 451 - 32 + 12)).toBe(false);
    // 钮落在底图范围内（不越界）
    const b = importRect('load');
    const p = panelRect('load');
    expect(b.x).toBeGreaterThanOrEqual(p.x);
    expect(b.y + b.h).toBeLessThanOrEqual(p.y + p.h);
  });

  it('★ 缺口如实翻译，一条一行；没缺口就是空数组', () => {
    expect(formatGaps({})).toEqual([]);
    expect(formatGaps({ hostility: '原版没有对应字段', cards: '手牌数对不上' })).toEqual([
      'hostility：原版没有对应字段',
      'cards：手牌数对不上',
    ]);
  });

  it('匯入钮与行命中不重叠（点钮不会被当成点行）', () => {
    const b = importRect('load');
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    expect(hitSaveLoad('load', cx, cy)).toBeNull();
  });
});
