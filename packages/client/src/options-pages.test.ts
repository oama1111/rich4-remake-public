/*
 * 設定屏三个副屏的版式 / 命中 / 取值 —— Q-OPT-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这些数字**全部来自 exe 的表与指令**（`0x474ce8` 控件矩形表、`0x474cc8` 串表、
 *   `0x410a87`/`0x410aa7` 跳表、`0x4113d9` 起的命中判定、`0x47edc2` 出厂键位表、
 *   `0x47edfa` 键名表、`0x453a32`/`0x45367e` YES/NO 框），不是照截图量的。
 *   谁改了都得回来解释为什么。
 */

import { describe, expect, it } from 'vitest';
import { HOTKEY_NAMES, IMG } from './options.ts';
import {
  DATE_AT,
  DATE_BUTTON_LABELS,
  DATE_BUTTON_TEXT,
  DATE_CELL,
  DATE_CTRL,
  DATE_MIN_YEAR,
  DATE_RECTS,
  DATE_W,
  DATE_H,
  HOTKEY_AT,
  HOTKEY_BUTTON_BOXES,
  HOTKEY_BUTTON_LABELS,
  HOTKEY_BUTTON_TEXT,
  HOTKEY_COUNT,
  HOTKEY_DEFAULT_KEYS,
  HOTKEY_FIXED,
  HOTKEY_KEY_NAMES,
  HOTKEY_KEY_X,
  HOTKEY_NAME_X,
  HOTKEY_PITCH,
  HOTKEY_ROW_BOX,
  HOTKEY_Y0,
  MONTH_NAMES,
  YESNO_AT,
  YESNO_CENTER,
  YESNO_H,
  YESNO_W,
  applyDateHit,
  confirmOutcome,
  dateDayCells,
  hitDateControl,
  hitDateDay,
  hitDatePage,
  hitHotkeyPage,
  hitYesNo,
  hotkeyAssign,
  hotkeyEditSlot,
  hotkeyPressedRect,
  hotkeyRowRect,
  hotkeySpot,
  keyText,
  packDate,
  unpackDate,
  yesNoImage,
  type DateDraft,
} from './options-pages.ts';

// ============================================================
//  日期頁
// ============================================================

describe('日期頁的版式 —— fcn_00410ac3 / fcn_0040ff4b', () => {
  it('底图 199×220，居中在 (221,130) —— @source 0x00410b42 起', () => {
    expect([DATE_W, DATE_H]).toEqual([199, 220]);
    // x = 0x140 − (199 >> 1) = 320 − 99、y = 0x0f0 − (220 >> 1) = 240 − 110
    expect(DATE_AT).toEqual({ x: 221, y: 130 });
  });

  it('8 个控件矩形就是表 0x474ce8 的原值', () => {
    expect(DATE_RECTS.map((r) => [r.x, r.y, r.x + r.w, r.y + r.h])).toEqual([
      [74, 21, 90, 31], // 月 ↑（图 12）
      [74, 31, 90, 41], // 月 ↓（图 13）
      [160, 21, 176, 31], // 年 ↑
      [160, 31, 176, 41], // 年 ↓
      [9, 180, 64, 210], // 熱 鍵（→ 今天）
      [72, 180, 127, 210], // 取 消
      [134, 180, 189, 210], // 確 定
      [15, 70, 181, 177], // 日曆格
    ]);
  });

  it('三个蓝钮的字与落点 —— 串表 0x474cc8 + 坐标表 0x474cdc/cde', () => {
    expect(DATE_BUTTON_LABELS).toEqual(['熱 鍵', '取 消', '確 定']);
    expect(DATE_BUTTON_TEXT).toEqual([
      { x: 38, y: 196 },
      { x: 101, y: 196 },
      { x: 163, y: 196 },
    ]);
    // 三颗钮的矩形中心与字落点只差 1~2px（原版自己也不是严格居中）
    for (let i = 0; i < 3; i++) {
      const r = DATE_RECTS[DATE_CTRL.TODAY + i]!;
      expect(Math.abs(DATE_BUTTON_TEXT[i]!.x - (r.x + r.w / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs(DATE_BUTTON_TEXT[i]!.y - (r.y + r.h / 2))).toBeLessThanOrEqual(2);
    }
  });

  it('日曆格几何：x 步进 23、满 7 列（x=166）换行、y += 18 —— @source 0x00410064 起', () => {
    expect(DATE_CELL.x0).toBe(28);
    expect(DATE_CELL.y0).toBe(80);
    expect(DATE_CELL.dx).toBe(23);
    expect(DATE_CELL.dy).toBe(18);
    expect(DATE_CELL.wrapX).toBe(28 + 6 * 23);
    expect(MONTH_NAMES).toHaveLength(13);
    expect(MONTH_NAMES[1]).toBe('一月');
    expect(MONTH_NAMES[12]).toBe('十二月');
  });

  it('1 号落在星期几那一列（1998-01-01 = 星期四）', () => {
    const cells = dateDayCells({ year: 1998, month: 1, day: 1 });
    expect(cells).toHaveLength(31);
    expect(cells[0]).toEqual({ day: 1, x: DATE_CELL.x0 + DATE_CELL.dx * 4, y: 80 });
    // 前三格在同一行（四、五、六），第 4 天换到下一行的第 0 列
    expect(cells[2]).toEqual({ day: 3, x: DATE_CELL.wrapX, y: 80 });
    expect(cells[3]).toEqual({ day: 4, x: DATE_CELL.x0, y: 98 });
  });

  it('闰年 2 月多一格（原版只判 4 的倍数）', () => {
    expect(dateDayCells({ year: 2000, month: 2, day: 1 })).toHaveLength(29);
    expect(dateDayCells({ year: 1999, month: 2, day: 1 })).toHaveLength(28);
  });
});

describe('日期頁的命中与取值', () => {
  const draft: DateDraft = { year: 1998, month: 1, day: 1 };

  it('四颗微调钮与三颗蓝钮都按控件表判 —— 左闭右开', () => {
    expect(hitDateControl(74, 21)).toBe(DATE_CTRL.MONTH_UP);
    expect(hitDateControl(89, 30)).toBe(DATE_CTRL.MONTH_UP);
    expect(hitDateControl(90, 21)).toBeNull(); // 右端不含
    expect(hitDateControl(74, 31)).toBe(DATE_CTRL.MONTH_DOWN);
    expect(hitDateControl(160, 21)).toBe(DATE_CTRL.YEAR_UP);
    expect(hitDateControl(160, 31)).toBe(DATE_CTRL.YEAR_DOWN);
    expect(hitDateControl(9, 180)).toBe(DATE_CTRL.TODAY);
    expect(hitDateControl(126, 209)).toBe(DATE_CTRL.CANCEL);
    expect(hitDateControl(134, 180)).toBe(DATE_CTRL.OK);
    expect(hitDateControl(189, 180)).toBeNull();
  });

  it('按下语义：月 ± / 年 ± / 熱鍵 / 取消 / 確定', () => {
    expect(hitDatePage(80, 25, draft)).toMatchObject({ kind: 'spin', field: 'month', delta: -1 });
    expect(hitDatePage(80, 35, draft)).toMatchObject({ kind: 'spin', field: 'month', delta: 1 });
    expect(hitDatePage(165, 25, draft)).toMatchObject({ kind: 'spin', field: 'year', delta: -1 });
    expect(hitDatePage(165, 35, draft)).toMatchObject({ kind: 'spin', field: 'year', delta: 1 });
    expect(hitDatePage(38, 196, draft)).toMatchObject({ kind: 'button', action: 'today' });
    expect(hitDatePage(101, 196, draft)).toMatchObject({ kind: 'button', action: 'cancel' });
    expect(hitDatePage(163, 196, draft)).toMatchObject({ kind: 'button', action: 'ok' });
  });

  it('格块里点中哪一天：命中框 ±10 × ±8，格与格之间有空隙', () => {
    const cells = dateDayCells(draft);
    const first = cells[0]!;
    expect(hitDatePage(first.x, first.y, draft)).toMatchObject({ kind: 'day', day: 1 });
    expect(hitDateDay(first.x + DATE_CELL.hitDX - 1, first.y, draft)).toBe(1);
    expect(hitDateDay(first.x - DATE_CELL.hitDX, first.y, draft)).toBe(1);
    // 两格中心之间的空档（x + 10 起就不算这一格了）
    expect(hitDateDay(first.x + DATE_CELL.hitDX, first.y, draft)).not.toBe(1);
    // 第一行上方不是格块（控件的 y 从 70 起）
    expect(hitDatePage(first.x, 69, draft)).toBeNull();
  });

  it('抬手才落到日期上：月 1↔12 翻、年 1998 见底、上限不管', () => {
    const hit = (x: number, y: number) => {
      const h = hitDatePage(x, y, draft);
      expect(h).not.toBeNull();
      return h!;
    };
    // 月 −：1 月 → 12 月
    expect(applyDateHit(draft, hit(80, 25), draft).month).toBe(12);
    // 月 +：12 月 → 1 月
    expect(applyDateHit({ ...draft, month: 12 }, hit(80, 35), { ...draft, month: 12 }).month).toBe(1);
    // 年 −：1998 不再减（@source 0x410fff 的 `cmp ebx,0x7ce / jle`）
    expect(applyDateHit({ ...draft, year: DATE_MIN_YEAR }, hit(165, 25), draft).year).toBe(
      DATE_MIN_YEAR,
    );
    expect(applyDateHit({ ...draft, year: 2000 }, hit(165, 25), draft).year).toBe(1999);
    // 年 +：没有上限
    expect(applyDateHit({ ...draft, year: 2100 }, hit(165, 35), draft).year).toBe(2101);
  });

  it('「熱 鍵」那颗其实是回到今天（原版如此）', () => {
    const today: DateDraft = { year: 2026, month: 9, day: 15 };
    expect(applyDateHit(draft, { kind: 'button', ctrl: 4, action: 'today' }, today)).toEqual(today);
    // 取消 / 確定 不改草稿（由调用方决定去留）
    expect(applyDateHit(draft, { kind: 'button', ctrl: 5, action: 'cancel' }, today)).toEqual(draft);
    expect(applyDateHit(draft, { kind: 'button', ctrl: 6, action: 'ok' }, today)).toEqual(draft);
  });

  it('点某一天只改「日」', () => {
    const cells = dateDayCells({ year: 1998, month: 1, day: 1 });
    const last = cells[cells.length - 1]!;
    const hit = hitDatePage(last.x, last.y, draft)!;
    expect(applyDateHit(draft, hit, draft)).toEqual({ year: 1998, month: 1, day: 31 });
  });

  it('打包/解开与 core 同一套（年<<16 | 月<<8 | 日）', () => {
    expect(packDate({ year: 1998, month: 1, day: 1 })).toBe(0x07ce0101);
    expect(unpackDate(0x07ce0101)).toEqual({ year: 1998, month: 1, day: 1 });
  });
});

// ============================================================
//  熱鍵頁
// ============================================================

describe('熱鍵頁的版式 —— fcn_00411122 / fcn_00410158', () => {
  it('底图 328×336，居中在 (156,72) —— @source 0x004111b6 起', () => {
    expect(HOTKEY_AT).toEqual({ x: 156, y: 72 });
    expect(IMG.HOTKEY_PAGE).toBe(1);
  });

  it('两列各 14 行：名字列 x 62/208、键位列 x 132/284，y 33 起每行 +16', () => {
    expect(HOTKEY_NAME_X).toEqual([62, 208]);
    expect(HOTKEY_KEY_X).toEqual([132, 284]);
    expect(HOTKEY_Y0).toBe(33);
    expect(HOTKEY_PITCH).toBe(16);
    expect(HOTKEY_COUNT).toBe(28);
    expect(HOTKEY_NAMES).toHaveLength(28);
  });

  it('28 条出厂键位 = 表 0x47edc2 逐字节', () => {
    expect(HOTKEY_DEFAULT_KEYS).toHaveLength(28);
    expect(HOTKEY_DEFAULT_KEYS.slice(0, 8)).toEqual([38, 39, 40, 37, 13, 27, 9, 9]);
    expect(HOTKEY_DEFAULT_KEYS[8]).toBe(89); // 是<YES> = Y
    expect(HOTKEY_DEFAULT_KEYS[9]).toBe(78); // 否<NO> = N
    expect(HOTKEY_DEFAULT_KEYS[24]).toBe(72); // 輔助說明 = H
    expect(HOTKEY_DEFAULT_KEYS[27]).toBe(0x1151); // 結束程式 = CTRL-Q
  });

  it('键名表 0x47edfa：特殊键有长名字、字母就是自己', () => {
    expect(HOTKEY_KEY_NAMES.size).toBe(78);
    expect(HOTKEY_KEY_NAMES.get(17)).toBe('CTRL-');
    expect(HOTKEY_KEY_NAMES.get(38)).toBe('↑');
    expect(HOTKEY_KEY_NAMES.get(33)).toBe('PG UP');
    expect(keyText(38)).toBe('↑');
    expect(keyText(0x1151)).toBe('CTRL-Q'); // 先高字节后低字节
    expect(keyText(0)).toBe('');
    expect(keyText(0x0100)).toBe(''); // 表里没有 1 —— 原版这半截不画
  });

  it('三个钮的判定框与字落点 —— 串表 0x474b2c', () => {
    expect(HOTKEY_BUTTON_LABELS).toEqual(['原始設定', '取 消', '確 定']);
    expect(HOTKEY_BUTTON_BOXES).toEqual([
      { x0: 0x11, y0: 0x119, x1: 0x57, y1: 0x137 },
      { x0: 0x82, y0: 0x119, x1: 0xc8, y1: 0x137 },
      { x0: 0xf2, y0: 0x119, x1: 0x138, y1: 0x137 },
    ]);
    expect(HOTKEY_BUTTON_TEXT).toEqual([
      { x: 52, y: 296 },
      { x: 165, y: 296 },
      { x: 278, y: 296 },
    ]);
    for (let i = 0; i < 3; i++) {
      const b = HOTKEY_BUTTON_BOXES[i]!;
      expect(Math.abs(HOTKEY_BUTTON_TEXT[i]!.x - (b.x0 + b.x1) / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(HOTKEY_BUTTON_TEXT[i]!.y - (b.y0 + b.y1) / 2)).toBeLessThanOrEqual(2);
    }
  });
});

describe('熱鍵頁的命中与改键', () => {
  it('行：左列 x 105..160、右列 x 257..312、y 25..264，两端都算', () => {
    expect(hitHotkeyPage(HOTKEY_ROW_BOX.x0[0], HOTKEY_ROW_BOX.y0)).toMatchObject({
      kind: 'row',
      col: 0,
      row: 0,
      ctrl: 1,
    });
    expect(hitHotkeyPage(HOTKEY_ROW_BOX.x1[0], HOTKEY_ROW_BOX.y0 + 15)).toMatchObject({
      kind: 'row',
      col: 0,
      row: 0,
    });
    // 第一列第 2 行（y = 25 + 16 = 41）
    expect(hitHotkeyPage(120, 41)).toMatchObject({ kind: 'row', col: 0, row: 1, ctrl: 2 });
    // 第二列第 1 行（x 257..、ctrl = 行 + 16）
    expect(hitHotkeyPage(260, 25)).toMatchObject({ kind: 'row', col: 1, row: 0, ctrl: 16 });
    expect(hitHotkeyPage(260, 265)).toBeNull(); // 行只到 y 264，下面那排钮从 281 起
    expect(hitHotkeyPage(200, 100)).toBeNull(); // 两列之间
  });

  it('三个钮：原始設定 / 取 消 / 確 定（0x64/0x65/0x66）', () => {
    expect(hitHotkeyPage(20, 290)).toMatchObject({ kind: 'button', ctrl: 0x64, action: 'defaults' });
    expect(hitHotkeyPage(150, 300)).toMatchObject({ kind: 'button', ctrl: 0x65, action: 'cancel' });
    expect(hitHotkeyPage(280, 285)).toMatchObject({ kind: 'button', ctrl: 0x66, action: 'ok' });
    expect(hitHotkeyPage(300, 330)).toBeNull();
  });

  it('★ 原版第二列改键差一行（照抄）', () => {
    // 第一列：行号 = 数组下标
    expect(hotkeyEditSlot(0, 0)).toBe(0);
    expect(hotkeyEditSlot(0, 13)).toBe(13);
    // 第二列：行号 + 15（= 下一行）
    expect(hotkeyEditSlot(1, 0)).toBe(15);
    expect(hotkeyEditSlot(1, 3)).toBe(18);
    // 第二列最下面那条空档算到 29 —— 越界，不写
    expect(hotkeyEditSlot(1, 14)).toBeNull();
    // 行的 ctrl 值 → 列/行 再回到 slot
    expect(hotkeySpot(1)).toEqual({ col: 0, row: 0, slot: 0 });
    expect(hotkeySpot(16)).toEqual({ col: 1, row: 0, slot: 15 });
    expect(hotkeySpot(97)).toBeNull(); // 按钮不在这里
  });

  it('按下的凹块与行矩形（第一列 x 105..160、第二列 x 257..312）', () => {
    expect(hotkeyRowRect(0, 0)).toEqual({ x: 105, y: 25, w: 56, h: 15 });
    expect(hotkeyRowRect(1, 0)).toEqual({ x: 257, y: 25, w: 56, h: 15 });
    expect(hotkeyPressedRect(1)).toEqual(hotkeyRowRect(0, 0));
    expect(hotkeyPressedRect(100)).toEqual({ x: 17, y: 281, w: 71, h: 31 });
    expect(hotkeyPressedRect(500)).toBeNull();
  });

  it('改键：or 进低字节；CTRL 是前缀；撞车与查不到的键都不改', () => {
    const keys = [...HOTKEY_DEFAULT_KEYS];
    // ★ 原版按下那一行时先把该条清 0（`0x411826`），再拿按键去 `or` —— 所以这里照做
    const armed = [...keys];
    armed[8] = 0;
    const a = hotkeyAssign(armed, 8, 90); // 按 Z
    expect(a?.[8]).toBe(90);
    expect(keys[8]).toBe(89); // 原表不动
    // CTRL（0x11）→ 整条 0x1100；再按一个字母就成了 `CTRL-X` 的显示
    const armed20 = [...keys];
    armed20[20] = 0;
    const b = hotkeyAssign(armed20, 20, 0x11);
    expect(b?.[20]).toBe(0x1100);
    expect(keyText(hotkeyAssign(b!, 20, 0x44)![20]!)).toBe('CTRL-D');
    // ★ `CTRL-Q` 已经被「結束程式」占着（出厂表第 27 条 0x1151）→ 原版也会拒
    expect(hotkeyAssign(b!, 20, 0x51)).toBeNull();
    // 撞车（TAB=9 在出厂表里已有两条：切換選項 / 切換視窗組）→ 拒绝
    const armed10 = [...keys];
    armed10[10] = 0;
    expect(hotkeyAssign(armed10, 10, 9)).toBeNull();
    // 键名表里没有的键号 → 拒绝
    expect(hotkeyAssign(armed10, 10, 1)).toBeNull();
    // 越界 → 拒绝（原版会写坏相邻内存）
    expect(hotkeyAssign(keys, 29, 90)).toBeNull();
  });

  it('前 8 条不许改 —— 抬手处理里 `cmp edi,8 / jle` 直接跳过', () => {
    expect(HOTKEY_FIXED).toBe(8);
    for (let row = 0; row < 8; row++) expect(hitHotkeyPage(120, 25 + row * 16)).toMatchObject({ row });
    // 第 9 行起才是可改的
    expect(hitHotkeyPage(120, 25 + 8 * 16)).toMatchObject({ row: 8, slot: 8 });
  });
});

// ============================================================
//  YES/NO 框
// ============================================================

describe('通用 YES/NO 框 —— fcn_00453a32 / fcn_0045367e', () => {
  it('资源 440、96×48，画在中心 (320,200) → 左上 (272,176)', () => {
    expect([YESNO_W, YESNO_H]).toEqual([96, 48]);
    expect(YESNO_CENTER).toEqual({ x: 320, y: 200 });
    expect(YESNO_AT).toEqual({ x: 272, y: 176 });
  });

  it('左半 = YES、右半 = NO；框外不算', () => {
    expect(hitYesNo(272, 176)).toBe(1);
    expect(hitYesNo(319, 223)).toBe(1); // 左半最后一列
    expect(hitYesNo(320, 176)).toBe(2); // 右半第一列
    expect(hitYesNo(367, 223)).toBe(2);
    expect(hitYesNo(271, 200)).toBeNull();
    expect(hitYesNo(368, 200)).toBeNull();
    expect(hitYesNo(300, 175)).toBeNull();
    expect(hitYesNo(300, 224)).toBeNull();
    expect(yesNoImage(null)).toBe(0);
    expect([yesNoImage(1), yesNoImage(2)]).toEqual([1, 2]);
  });

  it('答「是」才往回抛 1/2/3 —— @source 0x00410911 起', () => {
    expect(confirmOutcome(0, true)).toBe('restart');
    expect(confirmOutcome(1, true)).toBe('surrender');
    expect(confirmOutcome(2, true)).toBe('quit');
    // 答「否」（含右键）→ 什么都不做
    expect(confirmOutcome(0, false)).toBeNull();
    expect(confirmOutcome(1, false)).toBeNull();
    expect(confirmOutcome(2, false)).toBeNull();
    expect(confirmOutcome(3, true)).toBeNull();
  });
});
