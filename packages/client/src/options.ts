/*
 * 設定（OPTION）——原版那一屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一屏的**字串与坐标全部取自 exe 的数据表**，不是照截图排的。
 *   入口 `_rich4_ui_options_entry` VA 0x00411b53：
 *
 * ```asm
 * ; 用 Data.mkf 资源 3 建对话框
 * 00411b67  push 3 / push [0x48a0e4] / call 0x450441    ; → ctx = [0x48bb60]
 *
 * ; ① 主面板上的 12 条文字：串表 0x474a54[i]，坐标表 0x474b38 每项 3 个 word
 * 00411b94  for (i = 0; i < 10; i++)
 *             add_text(ctx+0x0c, str[i], w[3i], w[3i+1], w[3i+2])
 * 00411c7b  add_text(ctx+0x0c, str[10]=取消, 224, 328, 2)
 * 00411caa  add_text(ctx+0x0c, str[11]=確定, 296, 328, 2)
 *
 * ; ② 右上角三个黄按钮：串号随入口参数 arg 走
 * 00411cda  for (i = 12; i < 15; i++)
 *             add_text(widget[arg+10], str[3*arg + i], w[3i], w[3i+1], w[3i+2])
 *
 * ; ③ 热键页 28 条：串表 0x474abc，两列各 14，x=62/208，y 从 33 起每条 +16
 * 00411c20  for (i = 0; i < 28; i++) { add_text(ctx+0x18, hotkey[i], x, y, 2); y += 16;
 *                                      if (i == 14) { x = 0xd0; y = 0x21; } }
 * 00411bdc  三个按钮 原始設定/取 消/確 定 @ x = 52/165/278, y = 296
 *
 * ; ④ 对话框**居中于 640×480**
 * 00411dac  x0 = 0x140 - (对话框宽 >> 1)      ; 320 - w/2
 *           y0 = 0x0f0 - (对话框高 >> 1)      ; 240 - h/2
 * ```
 *
 * ★ 最后那两行是本项目 640×480 定屏的又一条独立证据（另两条：
 *   `Panel.mkf` 资源 1 图 0 是 439×40 的工具栏底条、资源 66 的两张
 *   440×480「NEWS」遮罩正好盖住左半边）。
 *
 * ⚠️ 没解出来的：各个控件（进度条、勾选框、列表）本身是 `0x450441`
 *   按资源建出来的，那段没跟进去。故**控件的位置是照底图量的**——
 *   量法见下面每一处的注释。语义则有 RICH4.CFG 的字段说明兜底。
 */

import type { Sprite } from './assets.ts';

/** Data.mkf 里这一屏的资源号 */
export const OPTIONS_RESOURCE = 3;
/** 图 0 = 主面板 347×363；图 1 = 熱鍵頁 328×336；图 2 = 日期頁 199×220 */
export const OPTIONS_BG = 0;
/** 右上角那块黄区（常态 / 另一态），盖在主面板的 (168,2) 上 —— 位置是**逐像素对出来的**（差值 0） */
const YELLOW_IMAGE = 10;
const YELLOW_AT = { x: 168, y: 2 } as const;
/** 選中 / 未選中 的小标记 */
const MARK_ON = 5;
const MARK_OFF = 7;
/** 按钮面 62×30：常态 / 按下 */
const BUTTON_FACE = 3;
const BUTTON_FACE_DOWN = 4;

/** 主面板尺寸 @source Data.mkf 资源 3 图 0 */
export const DIALOG_W = 347;
export const DIALOG_H = 363;
/** @source VA 0x00411dac：x0 = 320 − w/2，y0 = 240 − h/2 */
export const DIALOG = {
  x: 320 - (DIALOG_W >> 1),
  y: 240 - (DIALOG_H >> 1),
  w: DIALOG_W,
  h: DIALOG_H,
} as const;

// ============================================================
//  文字：串与坐标都是表里的原值
// ============================================================

/**
 * @source 串 `0x474a54[0..11]`，坐标 `0x474b38[0..11]` 每项三个 word：x、y、对齐码。
 *
 * ⚠️ 对齐码只有 5 与 2 两种，**具体含义没查证**。但它跟底图对得上：
 *   码 5 的五条都在 x=14（左栏标题，左对齐说得通），码 2 的七条 x 都落在
 *   对应控件的正中（取消 224 ↔ 按钮 193..255、確定 296 ↔ 265..327），
 *   故本引擎把 5 当左对齐、2 当居中。
 */
export const OPTION_LABELS: readonly { text: string; x: number; y: number; align: number }[] = [
  { text: '遊戲速度', x: 14, y: 25, align: 5 },
  { text: '動畫過程', x: 14, y: 58, align: 5 },
  { text: '音 樂', x: 14, y: 90, align: 5 },
  { text: '音 效', x: 14, y: 122, align: 5 },
  { text: '自動存檔', x: 14, y: 155, align: 5 },
  { text: '樂  曲', x: 49, y: 202, align: 2 },
  { text: '視  窗', x: 209, y: 202, align: 2 },
  { text: '日、月曆', x: 286, y: 226, align: 2 },
  { text: '縮小地圖', x: 286, y: 258, align: 2 },
  { text: '組合畫面', x: 286, y: 290, align: 2 },
  { text: '取 消', x: 224, y: 328, align: 2 },
  { text: '確 定', x: 296, y: 328, align: 2 },
];

/** @source 串 `0x474a54[18..25]` —— 八首可选配乐 */
export const TRACK_NAMES: readonly string[] = [
  '1.星際總動員',
  '2.重回侏儸紀',
  '3.夢幻伊甸園',
  '4.打拼為將來',
  '5.椰林風情畫',
  '6.浪漫月世界',
  '7.熱情的夏夜',
  '8.漫步星空下',
];

/**
 * 右上角三个黄按钮的文字 —— **随入口参数变**。
 * @source VA 0x00411d10 `str[3*arg + i]`，i = 12..14
 * - arg 0 → 12/13/14 日期更改・熱鍵設定・遊戲說明
 * - arg 1 → 15/16/17 重新遊戲・認輸投降・結束遊戲
 */
export const SIDE_BUTTONS: readonly (readonly string[])[] = [
  ['日期更改', '熱鍵設定', '遊戲說明'],
  ['重新遊戲', '認輸投降', '結束遊戲'],
];

/** @source 串 `0x474abc[0..27]`，两列各 14 条 —— 熱鍵頁 */
export const HOTKEY_NAMES: readonly string[] = [
  '游標上移', '游標右移', '游標下移', '游標左移',
  '確定執行', '取消指令', '切換選項', '切換視窗組',
  '是<YES>', '否<NO>', '前進指令', '選擇骰子數',
  '股市', '交易', '卡片', '道具',
  '查詢', '地圖', '地圖向左旋轉', '地圖向右旋轉',
  '託管', '系統', 'SAVE GAME', 'LOAD GAME',
  '輔助說明', '向上換頁', '向下換頁', '結束程式',
];

// ============================================================
//  控件：位置照底图量的
// ============================================================

/**
 * 三条格子进度条。
 *
 * ⚠️ 量法：在底图上横切一行，看颜色跳变的位置。
 * - `遊戲速度` y=25 那行：深格 81..95 / 97..111 / 113..127 → 三格，步进 16
 * - `音 樂`   y=90 那行：深格 89..103 起，共五格
 * - `音 效`   y=122 那行：同上
 * 纵向 x=90 那列的跳变给出格子高度：17..33 / 81..97 / 113..129，即 17 高，
 * 顶边 = 文字 y − 8。
 *
 * 档位数与 RICH4.CFG 对得上：`game speed: 00,01,02`、`music/sound: 00~04`。
 */
export const BARS = {
  speed: { x: 81, y: 17, cells: 3 },
  music: { x: 89, y: 81, cells: 5 },
  sound: { x: 89, y: 113, cells: 5 },
} as const;
export const BAR_CELL = { w: 15, h: 17, pitch: 16 } as const;

/**
 * 四个小标记。
 *
 * ⚠️ 量法：底图上洋红色连通块的外接框（11×12）。
 * `動畫過程`(100,51)、`音 樂`(68,83)、`音 效`(68,115)、`自動存檔`(100,147)。
 *
 * ⚠️ 音樂/音效既有标记又有进度条，而 RICH4.CFG 每项只存**一个字节**
 *   （00~04）。本引擎因此把标记当作「0 = 關」的显示与开关，而不是
 *   另一个独立的状态位。原版是不是这么理解的，没查证。
 */
export const MARKS = {
  animation: { x: 100, y: 51 },
  music: { x: 68, y: 83 },
  sound: { x: 68, y: 115 },
  autoSave: { x: 100, y: 147 },
} as const;
export const MARK_SIZE = { w: 15, h: 16 } as const;

/**
 * 視窗（右下角那块 200×200 显示什么）三选一。
 *
 * ⚠️ 标记框量得 (220,219)/(220,251)/(220,282)，与三条文字 y=226/258/290
 *   一一对应（步进 32，取 219 + 32i）。
 * @source 语义见 RICH4.CFG offset 5：00 日曆 / 01 小地圖 / 02 兩者輪流
 */
export const WINDOW_MARKS = { x: 220, y0: 219, pitch: 32, count: 3 } as const;

/**
 * 樂曲列表。
 *
 * ⚠️ 量法：x=100 那列在 y=226/241/256/…/331/345 处有横线 → 8 行，行高 15。
 *   列表框本身 x 13..181。
 */
export const TRACK_LIST = { x: 16, y: 226, w: 162, rowH: 15, rows: 8 } as const;

/**
 * 右上角三个黄按钮的可点区域。
 *
 * ⚠️ 量法：在黄块图（`YELLOW_IMAGE`）内竖切 x=110、横切 y=31，
 *   得三块 62..157 × 14..46 / 68..100 / 119..151；再加上 `YELLOW_AT`。
 */
export const SIDE_BUTTON_RECTS = [0, 1, 2].map((i) => ({
  x: YELLOW_AT.x + 62,
  y: YELLOW_AT.y + [14, 68, 119][i]!,
  w: 96,
  h: 33,
}));

/**
 * 底部两个按钮。
 *
 * ⚠️ 按钮面是 62×30（图 3/4），文字在按钮内的 (30,14)
 *   @source VA 0x00411d74 `push 0x1e / push 0xe`。
 *   文字在对话框里的 x/y 是表里的 (224,328)/(296,328)，倒推按钮左上角
 *   = 文字位置 − (31,15)。
 */
export const BOTTOM_BUTTONS = {
  cancel: { x: 224 - 31, y: 328 - 14 - 1, w: 62, h: 30 },
  ok: { x: 296 - 31, y: 328 - 14 - 1, w: 62, h: 30 },
} as const;

// ============================================================
//  状态
// ============================================================

/**
 * 一屏设定的取值。
 * @source 字段与取值范围照 RICH4.CFG（`rich4-re/docs/rich4_cfg.txt`）：
 * ```
 * offset 0 game speed   00,01,02
 * offset 1 animation    01 enabled
 * offset 2 music        00~04
 * offset 3 sound effect 00~04
 * offset 4 auto save    01 enabled
 * offset 5 view         00 日曆 / 01 小地圖 / 02 兩者輪流
 * ```
 */
export interface GameOptions {
  speed: number;
  animation: boolean;
  music: number;
  sound: number;
  autoSave: boolean;
  /** 右下角那块显示什么 0/1/2 */
  windowView: number;
  /** 第几首配乐 0..7 —— `Midi.txt` 的前 8 条正好是这 8 首 */
  track: number;
}

export const DEFAULT_OPTIONS: GameOptions = {
  speed: 1,
  animation: true,
  music: 3,
  sound: 3,
  autoSave: false,
  windowView: 0,
  track: 0,
};

/** 音量档 0..4 → 0..1 */
export function volumeOf(level: number): number {
  return Math.max(0, Math.min(4, level)) / 4;
}

// ============================================================
//  命中判定
// ============================================================

export type OptionsHit =
  | { kind: 'bar'; field: 'speed' | 'music' | 'sound'; value: number }
  | { kind: 'mark'; field: 'animation' | 'music' | 'sound' | 'autoSave' }
  | { kind: 'window'; value: number }
  | { kind: 'track'; value: number }
  | { kind: 'side'; index: number }
  | { kind: 'ok' }
  | { kind: 'cancel' };

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** 舞台坐标 → 这一屏的命中；`null` 表示没点中任何控件 */
export function hitOptions(sx: number, sy: number): OptionsHit | null {
  const x = sx - DIALOG.x;
  const y = sy - DIALOG.y;
  if (x < 0 || y < 0 || x >= DIALOG.w || y >= DIALOG.h) return null;

  for (const [field, bar] of Object.entries(BARS) as [keyof typeof BARS, { x: number; y: number; cells: number }][]) {
    for (let i = 0; i < bar.cells; i++) {
      const r = { x: bar.x + i * BAR_CELL.pitch, y: bar.y, w: BAR_CELL.w, h: BAR_CELL.h };
      if (inRect(x, y, r)) return { kind: 'bar', field, value: i };
    }
  }
  for (const [field, m] of Object.entries(MARKS) as [keyof typeof MARKS, { x: number; y: number }][]) {
    if (inRect(x, y, { ...m, ...MARK_SIZE })) return { kind: 'mark', field };
  }
  for (let i = 0; i < WINDOW_MARKS.count; i++) {
    const r = { x: WINDOW_MARKS.x, y: WINDOW_MARKS.y0 + i * WINDOW_MARKS.pitch, ...MARK_SIZE };
    // 文字也可点：整行都算
    if (inRect(x, y, { x: r.x, y: r.y, w: 130, h: MARK_SIZE.h })) return { kind: 'window', value: i };
  }
  for (let i = 0; i < TRACK_LIST.rows; i++) {
    const r = { x: TRACK_LIST.x, y: TRACK_LIST.y + i * TRACK_LIST.rowH, w: TRACK_LIST.w, h: TRACK_LIST.rowH };
    if (inRect(x, y, r)) return { kind: 'track', value: i };
  }
  for (let i = 0; i < SIDE_BUTTON_RECTS.length; i++) {
    if (inRect(x, y, SIDE_BUTTON_RECTS[i]!)) return { kind: 'side', index: i };
  }
  if (inRect(x, y, BOTTOM_BUTTONS.ok)) return { kind: 'ok' };
  if (inRect(x, y, BOTTOM_BUTTONS.cancel)) return { kind: 'cancel' };
  return null;
}

/**
 * 把一次点击落到取值上。
 *
 * ⚠️ 音樂/音效的标记是「0 = 關」的开关：关掉记住原来的档位，再开回来
 *   （原版怎么做没查证，见 `MARKS` 的注释）。
 */
export function applyOptionsHit(o: GameOptions, hit: OptionsHit): GameOptions {
  switch (hit.kind) {
    case 'bar':
      return { ...o, [hit.field]: hit.value };
    case 'mark':
      if (hit.field === 'animation') return { ...o, animation: !o.animation };
      if (hit.field === 'autoSave') return { ...o, autoSave: !o.autoSave };
      return { ...o, [hit.field]: o[hit.field] === 0 ? 3 : 0 };
    case 'window':
      return { ...o, windowView: hit.value };
    case 'track':
      return { ...o, track: hit.value };
    default:
      return o;
  }
}

// ============================================================
//  绘制
// ============================================================

/** 取一张 `Data.mkf` 资源 3 的图；未解码好时返回 null（调用方会被重绘补上） */
export type OptionsSpriteFn = (index: number, colorKeyBlack?: boolean) => Sprite | null;

const TEXT_FONT = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
const TEXT_COLOR = '#101010';

export function drawOptions(
  ctx: CanvasRenderingContext2D,
  o: GameOptions,
  /** 右上角三个按钮用哪一组文字（0 標題頁 / 1 遊戲中） */
  variant: number,
  hot: OptionsHit | null,
  sprite: OptionsSpriteFn,
): void {
  const bg = sprite(OPTIONS_BG);
  ctx.save();
  ctx.translate(DIALOG.x, DIALOG.y);

  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);
  else {
    ctx.fillStyle = '#6b7b6b';
    ctx.fillRect(0, 0, DIALOG.w, DIALOG.h);
  }
  const yellow = sprite(YELLOW_IMAGE);
  if (yellow !== null) ctx.drawImage(yellow.bitmap, YELLOW_AT.x, YELLOW_AT.y);

  // ——— 进度条：已选档位之前的格子点亮 ———
  for (const [field, bar] of Object.entries(BARS) as [keyof typeof BARS, { x: number; y: number; cells: number }][]) {
    const value = o[field];
    for (let i = 0; i < bar.cells; i++) {
      if (i > value) continue;
      ctx.fillStyle = i === value ? 'rgba(255,225,74,0.85)' : 'rgba(255,225,74,0.35)';
      ctx.fillRect(bar.x + i * BAR_CELL.pitch, bar.y, BAR_CELL.w, BAR_CELL.h);
    }
  }

  // ——— 四个小标记 ———
  const mark = (x: number, y: number, on: boolean): void => {
    const s = sprite(on ? MARK_ON : MARK_OFF, true);
    if (s !== null) ctx.drawImage(s.bitmap, x, y);
    else {
      ctx.fillStyle = on ? '#c64a31' : '#efefe7';
      ctx.fillRect(x + 2, y + 2, MARK_SIZE.w - 4, MARK_SIZE.h - 4);
    }
  };
  mark(MARKS.animation.x, MARKS.animation.y, o.animation);
  mark(MARKS.music.x, MARKS.music.y, o.music > 0);
  mark(MARKS.sound.x, MARKS.sound.y, o.sound > 0);
  mark(MARKS.autoSave.x, MARKS.autoSave.y, o.autoSave);
  for (let i = 0; i < WINDOW_MARKS.count; i++) {
    mark(WINDOW_MARKS.x, WINDOW_MARKS.y0 + i * WINDOW_MARKS.pitch, o.windowView === i);
  }

  // ——— 樂曲列表 ———
  ctx.font = '12px "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < TRACK_LIST.rows; i++) {
    const y = TRACK_LIST.y + i * TRACK_LIST.rowH;
    if (o.track === i) {
      ctx.fillStyle = 'rgba(255,225,74,0.55)';
      ctx.fillRect(TRACK_LIST.x, y, TRACK_LIST.w, TRACK_LIST.rowH);
    }
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(TRACK_NAMES[i] ?? '', TRACK_LIST.x + 6, y + TRACK_LIST.rowH / 2);
  }

  // ——— 底部两个按钮 ———
  for (const [kind, r] of Object.entries(BOTTOM_BUTTONS)) {
    const down = hot?.kind === kind;
    const face = sprite(down ? BUTTON_FACE_DOWN : BUTTON_FACE);
    if (face !== null) ctx.drawImage(face.bitmap, r.x, r.y);
  }

  // ——— 文字 ———
  ctx.font = TEXT_FONT;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textBaseline = 'middle';
  for (const l of OPTION_LABELS) {
    ctx.textAlign = l.align === 2 ? 'center' : 'left';
    ctx.fillText(l.text, l.x, l.y);
  }

  // 右上角三个按钮的文字：表里给的是**黄块内**坐标，故要加上黄块的位置
  ctx.textAlign = 'center';
  const side = SIDE_BUTTONS[variant] ?? SIDE_BUTTONS[0]!;
  const SIDE_TEXT_Y = [31, 85, 136];
  for (let i = 0; i < side.length; i++) {
    if (hot?.kind === 'side' && hot.index === i) {
      const r = SIDE_BUTTON_RECTS[i]!;
      ctx.fillStyle = 'rgba(255,225,74,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = TEXT_COLOR;
    }
    ctx.fillText(side[i]!, YELLOW_AT.x + 108, YELLOW_AT.y + SIDE_TEXT_Y[i]!);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
