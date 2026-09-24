/*
 * 存讀檔屏的版式与槽位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { decideAction, newGame, parseMap, reduce, type GameState } from '@rich4/core';
import { initSaveStore, saveStore, type SaveStore } from './host.ts';
import {
  AUTOSAVE_SLOT,
  autosaveStep,
  gameDateKey,
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
  drawSaveLoad,
  rowTexts,
  ROW_TEXT_STYLE,
  ROW_FACE_X0,
  ROW_FACE_PITCH,
  ROW_THUMB_X,
  EMPTY_CELL_IMAGE,
  PORTRAIT_RESOURCE,
  type SlotInfo,
} from './saveload.ts';
import { BOX_TEXT_STYLE } from './font.ts';
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

// ============================================================
//  ★★ 自動存檔的时机（第十六份回报续，2026-09-24）
// ============================================================

describe('★★ 自動存檔：推过日期、新一天第一位的回合边界走完才存 @source 0x00419041..0x0041904d', () => {
  const at = (
    y: number,
    m: number,
    d: number,
    extra: Partial<Pick<GameState, 'phase' | 'pending' | 'deferredTurnStart'>> = {},
  ) => ({ year: y, month: m, day: d, phase: 'turnStart' as const, pending: null, deferredTurnStart: null, ...extra });

  it('`gameDateKey` 按年·月·日单调', () => {
    expect(gameDateKey({ year: 1998, month: 1, day: 31 })).toBeLessThan(gameDateKey({ year: 1998, month: 2, day: 1 }));
    expect(gameDateKey({ year: 1998, month: 12, day: 31 })).toBeLessThan(gameDateKey({ year: 1999, month: 1, day: 1 }));
  });

  it('新局 / 读档之后第一次看到：只记下、不存（开局那天游标没绕回过）', () => {
    expect(autosaveStep(at(1998, 1, 1), null)).toEqual({ save: false, key: gameDateKey(at(1998, 1, 1)) });
  });

  it('同一天里的回合（不分人机）都不存；推过日期那一刻存一次', () => {
    const k0 = gameDateKey(at(1998, 1, 1));
    expect(autosaveStep(at(1998, 1, 1), k0)).toEqual({ save: false, key: k0 });
    const step = autosaveStep(at(1998, 1, 2), k0);
    expect(step.save).toBe(true);
    // 记下之后同一天不再存
    expect(autosaveStep(at(1998, 1, 2), step.key).save).toBe(false);
  });

  it('推日期里开出了拍卖 / 还款提醒窗 ⇒ 等它们收掉、落回 turnStart 才存（原版是阻塞调用）', () => {
    const k0 = gameDateKey(at(1998, 1, 1));
    const auction = autosaveStep(at(1998, 1, 2, { phase: 'awaitingDecision', deferredTurnStart: 0 }), k0);
    expect(auction).toEqual({ save: false, key: k0 });
    const reminder = autosaveStep(
      at(1998, 1, 2, { pending: { kind: 'loanReminder' } as unknown as GameState['pending'] }),
      k0,
    );
    expect(reminder).toEqual({ save: false, key: k0 });
    expect(autosaveStep(at(1998, 1, 2), auction.key).save).toBe(true);
  });

  it('日期往回走（時光機）不算推进：跟着记下、不存；之后再推进才存', () => {
    const k5 = gameDateKey(at(1998, 1, 5));
    const back = autosaveStep(at(1998, 1, 3), k5);
    expect(back).toEqual({ save: false, key: gameDateKey(at(1998, 1, 3)) });
    expect(autosaveStep(at(1998, 1, 4), back.key).save).toBe(true);
  });

  it('★ 真跑一局（4 电脑）：存的次数 = 推过的天数，且每次都在 turnStart', () => {
    const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
    expect(existsSync(MAP), MAP).toBe(true);
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
    let state = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 4242 });
    let key: number | null = null;
    let saves = 0;
    const startKey = gameDateKey(state);
    for (let i = 0; i < 20_000 && state.turnCount < 60; i++) {
      const step = autosaveStep(state, key);
      key = step.key;
      if (step.save) {
        saves++;
        expect(state.phase).toBe('turnStart');
      }
      const a = decideAction({ state, map });
      if (a === null) break;
      state = reduce(state, a, topo);
    }
    const lastStep = autosaveStep(state, key);
    if (lastStep.save) saves++;
    const days = Math.round((Date.UTC(state.year, state.month - 1, state.day) - Date.UTC(
      Math.trunc(startKey / 10000), Math.trunc(startKey / 100) % 100 - 1, startKey % 100)) / 86_400_000);
    expect(days).toBeGreaterThan(5);
    expect(saves).toBe(days);
  });
});

describe('★ gap-audit #18：一行的字与图全照 0x00403f1d..0x00404094', () => {
  it('★ 字样 = `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)`（16 号米白、粗体 + 阴影）', () => {
    expect(ROW_TEXT_STYLE).toEqual({ size: 0x10, color: '#f0f0f0', color2: '#101010', flags: 3, spacing: 1 });
    expect(ROW_TEXT_STYLE).toBe(BOX_TEXT_STYLE);
  });

  it('★ 0 号槽：AUTO / 年 / 月日，都以 x = 0xa5 为中心，dy = 0x0f / 0x24 / 0x39', () => {
    expect(rowTexts(0, { year: 1998, month: 3, day: 7 })).toEqual([
      { text: 'AUTO', x: 0xa5, dy: 0x0f },
      { text: '1998', x: 0xa5, dy: 0x24 },
      { text: '3/7', x: 0xa5, dy: 0x39 },
    ]);
  });

  it('其余槽不写 AUTO；空槽 / 坏档一句都不写（整槽跳过 0x00403e55）', () => {
    expect(rowTexts(2, { year: 1998, month: 12, day: 31 }).map((t) => t.text)).toEqual(['1998', '12/31']);
    expect(rowTexts(0, null)).toEqual([]);
    expect(rowTexts(3, null)).toEqual([]);
  });

  it('★ 画出来：有档的槽 = 粉底板 + 字 + 縮圖 + 每位玩家的头像；空槽什么都不画（连粉底板都没有）', () => {
    const images: { res: number; index: number; x: number; y: number }[] = [];
    const texts: { text: string; x: number; y: number; fill: string; font: string }[] = [];
    const ctx = {
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText(this: { fillStyle: string; font: string }, text: string, x: number, y: number) {
        texts.push({ text, x, y, fill: String(this.fillStyle), font: String(this.font) });
      },
      drawImage: (b: { res: number; index: number }, x: number, y: number) => images.push({ ...b, x, y }),
      fillStyle: '',
      strokeStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    const sprite = (_a: string, res: number, index: number) =>
      ({ bitmap: { res, index } as unknown as ImageBitmap, width: 72, height: 72, anchorX: 0, anchorY: 0 }) as never;
    const st = {
      year: 1999,
      month: 5,
      day: 20,
      globalMapId: 5,
      players: [{ character: 3 }, { character: 7 }, { character: 0 }],
    } as unknown as GameState;
    const slots: SlotInfo[] = [
      { slot: 0, state: null, error: null },
      { slot: 1, state: st, error: null },
    ];
    drawSaveLoad(ctx, 'load', slots, null, sprite);
    const y1 = ROW.y0 + ROW.pitch;
    // 空的 0 号槽：一张行图都没有
    expect(images.filter((i) => i.y === ROW.y0)).toEqual([]);
    expect(texts.some((t) => t.text === 'AUTO')).toBe(false);
    // 1 号槽：粉底板、縮圖（2 + 5）、三位玩家头像
    expect(images.filter((i) => i.y === y1)).toEqual([
      { res: 0x208, index: EMPTY_CELL_IMAGE, x: ROW.x, y: y1 },
      { res: 0x208, index: 2 + 5, x: ROW_THUMB_X, y: y1 },
      { res: PORTRAIT_RESOURCE, index: 3, x: ROW_FACE_X0, y: y1 },
      { res: PORTRAIT_RESOURCE, index: 7, x: ROW_FACE_X0 + ROW_FACE_PITCH, y: y1 },
      { res: PORTRAIT_RESOURCE, index: 0, x: ROW_FACE_X0 + 2 * ROW_FACE_PITCH, y: y1 },
    ]);
    // 字：正文米白画在 (+0,+0)，阴影深色在 (+1,+1)；16 号粗体
    const year = texts.filter((t) => t.text === '1999');
    expect(year).toEqual([
      { text: '1999', x: 0xa5 + 1, y: y1 + 0x24 + 1, fill: '#101010', font: expect.stringMatching(/^bold 16px /) },
      { text: '1999', x: 0xa5, y: y1 + 0x24, fill: '#f0f0f0', font: expect.stringMatching(/^bold 16px /) },
    ]);
    expect(texts.filter((t) => t.text === '5/20').map((t) => t.y)).toEqual([y1 + 0x39 + 1, y1 + 0x39]);
  });
});
