/*
 * 設定屏的几何与取值
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这些数字**全部来自 exe 的数据表**（`0x474b92` 控件矩形表、`0x474b38` 文字坐标表、
 *   `0x474a54`/`0x474abc` 串表、`0x41034b` 处理跳表），不是照底图量的。
 *   它们是「原版长什么样」的断言 —— 谁改了都得回来解释为什么。
 */

import { describe, expect, it } from 'vitest';
import {
  BAR_AT,
  CELL,
  CONTROL,
  CONTROL_RECTS,
  DEFAULT_OPTIONS,
  DIALOG,
  HOTKEY_NAMES,
  IMG,
  LAMP_AT,
  OPTION_LABELS,
  SIDE_ART_AT,
  SIDE_BUTTONS,
  SIDE_TEXT,
  TRACK_NAMES,
  TRACK_ROWS,
  WINDOW_LAMP,
  applyOptionsHit,
  controlHit,
  drawOptions,
  hitControl,
  hitOptions,
  volumeOf,
  type GameOptions,
} from './options.ts';

describe('設定屏的版式', () => {
  it('对话框居中于 640×480 —— @source VA 0x00411dac', () => {
    // x0 = 0x140 − (w >> 1)，y0 = 0x0f0 − (h >> 1)
    expect(DIALOG.x).toBe(320 - (347 >> 1));
    expect(DIALOG.y).toBe(240 - (363 >> 1));
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

  it('16 个控件矩形就是表 0x474b92 里的原值', () => {
    expect(CONTROL_RECTS.map((r) => [r.x, r.y, r.w, r.h])).toEqual([
      [81, 17, 47, 16], // 遊戲速度条
      [89, 81, 63, 16], // 音 樂条
      [89, 113, 63, 16], // 音 效条
      [227, 14, 100, 35], // 右上角钮 ×3
      [227, 68, 100, 35],
      [227, 119, 100, 35],
      [18, 226, 159, 119], // 樂曲列表
      [194, 314, 62, 30], // 取 消
      [266, 314, 62, 30], // 確 定
      [98, 50, 15, 15], // 四盏灯
      [66, 82, 15, 15],
      [66, 114, 15, 15],
      [98, 146, 15, 15],
      [217, 214, 107, 22], // 視窗三行
      [217, 246, 107, 22],
      [217, 278, 107, 22],
    ]);
    expect(CONTROL_RECTS).toHaveLength(16);
  });

  it('三条进度条的档位数与各自能点出来的范围', () => {
    // 速度：3 格，(relx − 81) >> 4 → 0..2
    expect(CONTROL_RECTS[CONTROL.SPEED_BAR]!.w).toBe(3 * CELL.pitch - 1);
    // 音樂/音效：4 格，(relx − 89) >> 4 **再 +1** → 1..4（0 只能靠灯关）
    expect(CONTROL_RECTS[CONTROL.MUSIC_BAR]!.w).toBe(4 * CELL.pitch - 1);
    expect(CONTROL_RECTS[CONTROL.SOUND_BAR]!.w).toBe(4 * CELL.pitch - 1);
  });

  it('四条灯与視窗三选的贴图位置就在各自控件的左上角', () => {
    const at = [
      [CONTROL.ANIM_LAMP, LAMP_AT.animation],
      [CONTROL.MUSIC_LAMP, LAMP_AT.music],
      [CONTROL.SOUND_LAMP, LAMP_AT.sound],
      [CONTROL.AUTOSAVE_LAMP, LAMP_AT.autoSave],
    ] as const;
    for (const [ctrl, p] of at) {
      expect({ x: CONTROL_RECTS[ctrl]!.x, y: CONTROL_RECTS[ctrl]!.y }).toEqual(p);
    }
    // 視窗的灯：x 固定 218（`x + 0xda`），y 查表 0x474c92
    expect(WINDOW_LAMP.x).toBe(218);
    expect([...WINDOW_LAMP.y]).toEqual([218, 250, 281]);
  });

  it('八首樂曲与三组按钮文字都是表里的原串', () => {
    expect(TRACK_NAMES).toHaveLength(8);
    expect(TRACK_NAMES[0]).toBe('1.星際總動員');
    expect(TRACK_NAMES[7]).toBe('8.漫步星空下');
    expect(TRACK_ROWS.rows).toBe(TRACK_NAMES.length);
    expect(SIDE_BUTTONS[0]).toEqual(['日期更改', '熱鍵設定', '遊戲說明']);
    expect(SIDE_BUTTONS[1]).toEqual(['重新遊戲', '認輸投降', '結束遊戲']);
    // 右上角三条文字挂在按钮组图（嵌在主面板 (168,2)）里的 (108, 31/85/136)
    expect(SIDE_ART_AT).toEqual({ x: 168, y: 2 });
    expect([SIDE_TEXT.x, ...SIDE_TEXT.y]).toEqual([108, 31, 85, 136]);
    // 熱鍵頁两列各 14 条 @source VA 0x00411c20 `cmp ebx, 0xe`
    expect(HOTKEY_NAMES).toHaveLength(28);
  });

  it('资源 3 的图号角色不许挪 —— 每一个都钉在代码里', () => {
    expect(IMG.PANEL).toBe(0);
    expect(IMG.HOTKEY_PAGE).toBe(1);
    expect(IMG.DATE_PAGE).toBe(2);
    expect(IMG.CANCEL_DOWN).toBe(3);
    expect(IMG.OK_DOWN).toBe(4);
    expect(IMG.CELL).toBe(5);
    expect(IMG.SIDE_DOWN).toBe(6);
    expect(IMG.LAMP).toBe(9);
    expect(IMG.SIDE_TITLE).toBe(10);
    expect(IMG.SIDE_GAME).toBe(11);
  });
});

describe('設定屏的命中判定', () => {
  const at = (x: number, y: number) => hitOptions(DIALOG.x + x, DIALOG.y + y);

  it('对话框外一律不响应', () => {
    expect(hitOptions(0, 0)).toBeNull();
    expect(hitOptions(639, 479)).toBeNull();
  });

  it('矩形是左闭右开 —— 右/下边界那一个像素不算', () => {
    const r = CONTROL_RECTS[CONTROL.OK]!;
    expect(hitControl(r.x, r.y)).toBe(CONTROL.OK);
    expect(hitControl(r.x + r.w - 1, r.y + r.h - 1)).toBe(CONTROL.OK);
    expect(hitControl(r.x + r.w, r.y)).toBeNull();
    expect(hitControl(r.x, r.y + r.h)).toBeNull();
  });

  it('点进度条给出那一格的档位', () => {
    expect([0, 1, 2].map((i) => at(BAR_AT.speed.x + i * 16 + 7, BAR_AT.speed.y + 8))).toEqual([
      { kind: 'bar', ctrl: CONTROL.SPEED_BAR, field: 'speed', value: 0 },
      { kind: 'bar', ctrl: CONTROL.SPEED_BAR, field: 'speed', value: 1 },
      { kind: 'bar', ctrl: CONTROL.SPEED_BAR, field: 'speed', value: 2 },
    ]);
    // 音樂/音效四格给的是 1..4 —— 第 0 档只能靠灯关出来
    expect([0, 1, 2, 3].map((i) => {
      const h = at(BAR_AT.music.x + i * 16 + 7, BAR_AT.music.y + 8);
      return h?.kind === 'bar' ? h.value : null;
    })).toEqual([1, 2, 3, 4]);
    expect(controlHit(CONTROL.SOUND_BAR, BAR_AT.sound.x + 63 - 1, 0)!.kind).toBe('bar');
  });

  it('点标记给出那一项', () => {
    expect(at(LAMP_AT.autoSave.x + 7, LAMP_AT.autoSave.y + 8)).toEqual({
      kind: 'lamp',
      ctrl: CONTROL.AUTOSAVE_LAMP,
      field: 'autoSave',
    });
  });

  it('視窗三选一 —— 三行各不相同', () => {
    const got = [0, 1, 2].map((i) => at(217 + 60, 214 + i * 32 + 8));
    expect(got).toEqual([
      { kind: 'window', ctrl: CONTROL.WINDOW_0, value: 0 },
      { kind: 'window', ctrl: CONTROL.WINDOW_1, value: 1 },
      { kind: 'window', ctrl: CONTROL.WINDOW_2, value: 2 },
    ]);
  });

  it('八行樂曲各自可点，且不会串行', () => {
    for (let i = 0; i < TRACK_ROWS.rows; i++) {
      expect(at(TRACK_ROWS.x + 20, TRACK_ROWS.y + i * TRACK_ROWS.rowH + 7)).toEqual({
        kind: 'track',
        ctrl: CONTROL.TRACK_LIST,
        value: i,
      });
    }
  });

  it('確定与取消分得开', () => {
    expect(at(194 + 5, 314 + 5)).toEqual({ kind: 'cancel', ctrl: CONTROL.CANCEL });
    expect(at(266 + 5, 314 + 5)).toEqual({ kind: 'ok', ctrl: CONTROL.OK });
  });
});

describe('設定屏画了什么', () => {
  type Rec =
    | { kind: 'img'; index: number; x: number; y: number }
    | { kind: 'text'; text: string; x: number; y: number; font: string; align: string }
    | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string };

  function record(o: GameOptions, variant: number, pressed: number | null, playing: number) {
    const log: Rec[] = [];
    let font = '';
    let textAlign = 'left';
    let fillStyle = '';
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      drawImage(bmp: { id: number }, x: number, y: number) {
        log.push({ kind: 'img', index: bmp.id, x, y });
      },
      fillText(text: string, x: number, y: number) {
        log.push({ kind: 'text', text, x, y, font, align: textAlign });
      },
      strokeText() {},
      fillRect(x: number, y: number, w: number, h: number) {
        log.push({ kind: 'rect', x, y, w, h, fill: fillStyle });
      },
      get font() {
        return font;
      },
      set font(v: string) {
        font = v;
      },
      get textAlign() {
        return textAlign;
      },
      set textAlign(v: string) {
        textAlign = v;
      },
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(v: string) {
        fillStyle = v;
      },
      textBaseline: 'alphabetic',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprite = ((i: number) => ({ bitmap: { id: i } }) as any) as Parameters<typeof drawOptions>[5];
    drawOptions(ctx, o, variant, pressed, playing, sprite);
    return log;
  }

  const imgs = (log: Rec[], index: number) =>
    log.filter((r): r is Extract<Rec, { kind: 'img' }> => r.kind === 'img' && r.index === index);

  it('底图与右上角按钮组：variant 选 10 / 11，都贴在 (168,2)', () => {
    for (const [variant, want] of [
      [0, IMG.SIDE_TITLE],
      [1, IMG.SIDE_GAME],
    ] as const) {
      const log = record(DEFAULT_OPTIONS, variant, null, 0);
      expect(log[0]).toEqual({ kind: 'img', index: IMG.PANEL, x: 0, y: 0 });
      expect(log[1]).toEqual({ kind: 'img', index: want, x: SIDE_ART_AT.x, y: SIDE_ART_AT.y });
    }
  });

  it('进度条：速度点亮「值+1」格、音樂/音效点亮「值」格，每格靠图 5', () => {
    const log = record({ ...DEFAULT_OPTIONS, speed: 1, music: 3, sound: 0 }, 1, null, 0);
    const cells = imgs(log, IMG.CELL);
    const row = (y: number) =>
      cells.filter((c) => c.y === y).map((c) => c.x).sort((a, b) => a - b);
    // 速度 1 → 2 格 @(81,17) +16 步进
    expect(row(BAR_AT.speed.y)).toEqual([81, 97]);
    // 音樂 3 → 3 格
    expect(row(BAR_AT.music.y)).toEqual([89, 105, 121]);
    // 音效 0 → 一格都不亮
    expect(row(BAR_AT.sound.y)).toEqual([]);
  });

  it('灯：亮着才贴图 9；視窗那一盏贴在 (218, 218/250/281)', () => {
    const log = record({ ...DEFAULT_OPTIONS, animation: false, music: 0, sound: 4, windowView: 2 }, 1, null, 0);
    const lamps = imgs(log, IMG.LAMP).map((l) => [l.x, l.y]);
    // 動畫關、音樂關、自動存檔預設關 → 只剩音效那一盏 + 視窗那一盏
    expect(lamps).toEqual([
      [LAMP_AT.sound.x, LAMP_AT.sound.y],
      [WINDOW_LAMP.x, WINDOW_LAMP.y[2]],
    ]);
  });

  it('樂曲列表：正在放的那一行整行红底（159×14），不是选的哪一行', () => {
    const log = record(DEFAULT_OPTIONS, 1, null, 5);
    const red = log.filter((r): r is Extract<Rec, { kind: 'rect' }> => r.kind === 'rect');
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ x: TRACK_ROWS.x, y: TRACK_ROWS.y + 5 * TRACK_ROWS.rowH, w: TRACK_ROWS.w, h: TRACK_ROWS.h });
    // 八行文字都在（白字黑边）
    for (let i = 0; i < 8; i++) {
      expect(log.some((r) => r.kind === 'text' && r.text === TRACK_NAMES[i])).toBe(true);
    }
  });

  it('字号：面板 15px、取消/確定与右上角三条 20px、列表 12px', () => {
    const log = record(DEFAULT_OPTIONS, 1, null, 0);
    const textOf = (t: string) =>
      log.find((r): r is Extract<Rec, { kind: 'text' }> => r.kind === 'text' && r.text === t);
    const fontOf = (t: string) => textOf(t)?.font;
    expect(fontOf('遊戲速度')).toContain('15px');
    expect(fontOf('取 消')).toContain('20px');
    expect(fontOf('確 定')).toContain('20px');
    expect(fontOf('重新遊戲')).toContain('20px');
    expect(fontOf('1.星際總動員')).toContain('12px');
    // 对齐：面板那五条左对齐，取消/確定居中
    const alignOf = (t: string) => textOf(t)?.align ?? null;
    expect(alignOf('遊戲速度')).toBe('left');
    expect(alignOf('取 消')).toBe('center');
  });

  it('按下时贴钮面，且**画在字之后**（原版会把字盖掉）', () => {
    const log = record(DEFAULT_OPTIONS, 1, CONTROL.CANCEL, 0);
    const i = log.findIndex((r) => r.kind === 'img' && r.index === IMG.CANCEL_DOWN);
    const t = log.findIndex((r) => r.kind === 'text' && r.text === '取 消');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(i).toBeGreaterThan(t);
    expect(log[i]).toEqual({
      kind: 'img',
      index: IMG.CANCEL_DOWN,
      x: CONTROL_RECTS[CONTROL.CANCEL]!.x,
      y: CONTROL_RECTS[CONTROL.CANCEL]!.y,
    });
    // 確定 / 左上角那颗没被按住 → 不贴
    expect(log.some((r) => r.kind === 'img' && r.index === IMG.OK_DOWN)).toBe(false);
    expect(log.some((r) => r.kind === 'img' && r.index === IMG.SIDE_DOWN)).toBe(false);
  });

  it('按住右上角钮时贴图 6，位置就那颗的矩形', () => {
    const log = record(DEFAULT_OPTIONS, 1, CONTROL.SIDE_1, 0);
    const r = CONTROL_RECTS[CONTROL.SIDE_1]!;
    expect(log.some((x) => x.kind === 'img' && x.index === IMG.SIDE_DOWN && x.x === r.x && x.y === r.y)).toBe(true);
  });
});

describe('設定屏的取值', () => {
  it('点进度条直接落成档位', () => {
    const o = applyOptionsHit(DEFAULT_OPTIONS, {
      kind: 'bar',
      ctrl: CONTROL.SOUND_BAR,
      field: 'sound',
      value: 4,
    });
    expect(o.sound).toBe(4);
    // 其余字段一个都不能动
    expect({ ...o, sound: DEFAULT_OPTIONS.sound }).toEqual(DEFAULT_OPTIONS);
  });

  it('音樂/音效的灯是「0 = 關」的开关，关掉再开回到 4（不是 3）', () => {
    const off = applyOptionsHit(DEFAULT_OPTIONS, {
      kind: 'lamp',
      ctrl: CONTROL.MUSIC_LAMP,
      field: 'music',
    });
    expect(off.music).toBe(0);
    // @source fcn_0041076e / fcn_0041079c：`mov byte [0x48bb4a], 4`
    expect(
      applyOptionsHit(off, { kind: 'lamp', ctrl: CONTROL.MUSIC_LAMP, field: 'music' }).music,
    ).toBe(4);
  });

  it('動畫/自動存檔是纯开关', () => {
    const a = applyOptionsHit(DEFAULT_OPTIONS, {
      kind: 'lamp',
      ctrl: CONTROL.ANIM_LAMP,
      field: 'animation',
    });
    expect(a.animation).toBe(false);
    expect(
      applyOptionsHit(a, { kind: 'lamp', ctrl: CONTROL.ANIM_LAMP, field: 'animation' }).animation,
    ).toBe(true);
  });

  it('確定/取消本身不改任何取值', () => {
    expect(applyOptionsHit(DEFAULT_OPTIONS, { kind: 'ok', ctrl: CONTROL.OK })).toEqual(
      DEFAULT_OPTIONS,
    );
    expect(applyOptionsHit(DEFAULT_OPTIONS, { kind: 'cancel', ctrl: CONTROL.CANCEL })).toEqual(
      DEFAULT_OPTIONS,
    );
  });

  it('音量档 0..4 映到 0..1，且 0 就是静音', () => {
    expect(volumeOf(0)).toBe(0);
    expect(volumeOf(4)).toBe(1);
    expect(volumeOf(2)).toBeCloseTo(0.5);
    expect(volumeOf(-3)).toBe(0);
    expect(volumeOf(99)).toBe(1);
  });
});
