/*
 * 設定屏的几何与取值
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这些数字全部来自 exe 的数据表或原版底图的量测（见 options.ts 的注释）。
 *   它们是「原版长什么样」的断言，不是本引擎的实现细节 —— 谁改了都得回来
 *   解释为什么。
 */

import { describe, expect, it } from 'vitest';
import {
  BARS,
  BOTTOM_BUTTONS,
  DEFAULT_OPTIONS,
  DIALOG,
  HOTKEY_NAMES,
  MARKS,
  OPTION_LABELS,
  SIDE_BUTTONS,
  TRACK_LIST,
  TRACK_NAMES,
  WINDOW_MARKS,
  applyOptionsHit,
  hitOptions,
  volumeOf,
} from './options.ts';

describe('設定屏的版式', () => {
  it('对话框居中于 640×480 —— @source VA 0x00411dac', () => {
    // x0 = 0x140 − (w >> 1)，y0 = 0x0f0 − (h >> 1)
    expect(DIALOG.x).toBe(320 - (347 >> 1));
    expect(DIALOG.y).toBe(240 - (363 >> 1));
    // 整个对话框必须落在 640×480 之内
    expect(DIALOG.x + DIALOG.w).toBeLessThanOrEqual(640);
    expect(DIALOG.y + DIALOG.h).toBeLessThanOrEqual(480);
  });

  it('12 条文字的坐标就是表 0x474b38 里的原值', () => {
    expect(OPTION_LABELS.map((l) => [l.text, l.x, l.y, l.align])).toEqual([
      ['遊戲速度', 14, 25, 5],
      ['動畫過程', 14, 58, 5],
      ['音 樂', 14, 90, 5],
      ['音 效', 14, 122, 5],
      ['自動存檔', 14, 155, 5],
      ['樂  曲', 49, 202, 2],
      ['視  窗', 209, 202, 2],
      ['日、月曆', 286, 226, 2],
      ['縮小地圖', 286, 258, 2],
      ['組合畫面', 286, 290, 2],
      ['取 消', 224, 328, 2],
      ['確 定', 296, 328, 2],
    ]);
  });

  it('底部两个按钮的文字正好落在按钮面的正中', () => {
    for (const r of [BOTTOM_BUTTONS.cancel, BOTTOM_BUTTONS.ok]) {
      // 按钮面 62×30，文字锚点 (30,14) @source VA 0x00411d74
      expect(r.w).toBe(62);
      expect(r.h).toBe(30);
    }
    expect(BOTTOM_BUTTONS.cancel.x + 31).toBe(224);
    expect(BOTTOM_BUTTONS.ok.x + 31).toBe(296);
  });

  it('三条进度条的档位数与 RICH4.CFG 对得上', () => {
    expect(BARS.speed.cells).toBe(3); // offset 0: 00,01,02
    expect(BARS.music.cells).toBe(5); // offset 2: 00~04
    expect(BARS.sound.cells).toBe(5); // offset 3: 00~04
  });

  it('每条进度条、每个标记都在对话框内，且彼此不重叠', () => {
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const b of Object.values(BARS)) {
      boxes.push({ x: b.x, y: b.y, w: b.cells * 16 - 1, h: 17 });
    }
    for (const m of Object.values(MARKS)) boxes.push({ ...m, w: 15, h: 16 });
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(DIALOG.w);
      expect(b.y + b.h).toBeLessThanOrEqual(DIALOG.h);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(hit).toBe(false);
      }
    }
  });

  it('八首樂曲与三组按钮文字都是表里的原串', () => {
    expect(TRACK_NAMES).toHaveLength(8);
    expect(TRACK_NAMES[0]).toBe('1.星際總動員');
    expect(TRACK_NAMES[7]).toBe('8.漫步星空下');
    expect(TRACK_LIST.rows).toBe(TRACK_NAMES.length);
    expect(SIDE_BUTTONS[0]).toEqual(['日期更改', '熱鍵設定', '遊戲說明']);
    expect(SIDE_BUTTONS[1]).toEqual(['重新遊戲', '認輸投降', '結束遊戲']);
    // 熱鍵頁两列各 14 条 @source VA 0x00411c52 `cmp ebx, 0xe`
    expect(HOTKEY_NAMES).toHaveLength(28);
  });
});

describe('設定屏的命中判定', () => {
  const at = (x: number, y: number) => hitOptions(DIALOG.x + x, DIALOG.y + y);

  it('对话框外一律不响应', () => {
    expect(hitOptions(0, 0)).toBeNull();
    expect(hitOptions(639, 479)).toBeNull();
  });

  it('点进度条给出那一格的档位', () => {
    for (let i = 0; i < BARS.music.cells; i++) {
      expect(at(BARS.music.x + i * 16 + 7, BARS.music.y + 8)).toEqual({
        kind: 'bar',
        field: 'music',
        value: i,
      });
    }
  });

  it('点标记给出那一项', () => {
    expect(at(MARKS.autoSave.x + 7, MARKS.autoSave.y + 8)).toEqual({
      kind: 'mark',
      field: 'autoSave',
    });
  });

  it('視窗三选一 —— 三行各不相同', () => {
    const got = [0, 1, 2].map((i) =>
      at(WINDOW_MARKS.x + 60, WINDOW_MARKS.y0 + i * WINDOW_MARKS.pitch + 8),
    );
    expect(got).toEqual([
      { kind: 'window', value: 0 },
      { kind: 'window', value: 1 },
      { kind: 'window', value: 2 },
    ]);
  });

  it('八行樂曲各自可点，且不会串行', () => {
    for (let i = 0; i < TRACK_LIST.rows; i++) {
      expect(at(TRACK_LIST.x + 20, TRACK_LIST.y + i * TRACK_LIST.rowH + 7)).toEqual({
        kind: 'track',
        value: i,
      });
    }
  });

  it('確定与取消分得开', () => {
    expect(at(BOTTOM_BUTTONS.ok.x + 5, BOTTOM_BUTTONS.ok.y + 5)).toEqual({ kind: 'ok' });
    expect(at(BOTTOM_BUTTONS.cancel.x + 5, BOTTOM_BUTTONS.cancel.y + 5)).toEqual({ kind: 'cancel' });
  });
});

describe('設定屏的取值', () => {
  it('点进度条直接落成档位', () => {
    const o = applyOptionsHit(DEFAULT_OPTIONS, { kind: 'bar', field: 'sound', value: 4 });
    expect(o.sound).toBe(4);
    // 其余字段一个都不能动
    expect({ ...o, sound: DEFAULT_OPTIONS.sound }).toEqual(DEFAULT_OPTIONS);
  });

  it('音樂/音效的标记是「0 = 關」的开关，关掉再开回到 3', () => {
    const off = applyOptionsHit(DEFAULT_OPTIONS, { kind: 'mark', field: 'music' });
    expect(off.music).toBe(0);
    expect(applyOptionsHit(off, { kind: 'mark', field: 'music' }).music).toBe(3);
  });

  it('動畫/自動存檔是纯开关', () => {
    const a = applyOptionsHit(DEFAULT_OPTIONS, { kind: 'mark', field: 'animation' });
    expect(a.animation).toBe(false);
    expect(applyOptionsHit(a, { kind: 'mark', field: 'animation' }).animation).toBe(true);
  });

  it('確定/取消本身不改任何取值', () => {
    expect(applyOptionsHit(DEFAULT_OPTIONS, { kind: 'ok' })).toEqual(DEFAULT_OPTIONS);
    expect(applyOptionsHit(DEFAULT_OPTIONS, { kind: 'cancel' })).toEqual(DEFAULT_OPTIONS);
  });

  it('音量档 0..4 映到 0..1，且 0 就是静音', () => {
    expect(volumeOf(0)).toBe(0);
    expect(volumeOf(4)).toBe(1);
    expect(volumeOf(2)).toBeCloseTo(0.5);
    // 越界要夹住，不能给出负数或大于 1
    expect(volumeOf(-3)).toBe(0);
    expect(volumeOf(99)).toBe(1);
  });
});
