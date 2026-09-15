/*
 * 設定（OPTION）——原版那一屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 本文件里的**每一个坐标、每一个取值**都取自 exe 的数据表，不是照底图量的。
 *   入口 `_rich4_ui_options_entry` VA 0x00411b53，窗口过程 `fcn_004103a3` VA 0x004103a3。
 *
 * ## 资源：`Data.mkf` 资源 3，**16 张图**
 *
 * ★ 不是 3 张。`png/Data/` 那份旧产物只解出 3 张，别再照它数。
 *   exe 里的用法把每张图的角色钉死了（下标 = `ctx0 + 0xc + 12*i`，
 *   每个 `graph_st` 12 字节，见 `csrc/mkf/graph_struct.h`）：
 *
 * | 图 | 尺寸 | 角色 | @source |
 * |---|---|---|---|
 * | 0 | 347×363 | 主面板底图 | `fcn_0040fd49` 第一笔 |
 * | 1 | 328×336 | 熱鍵頁底图 | `fcn_00410158` 第一笔 |
 * | 2 | 199×220 | 日期頁底图 | `fcn_004119e3` / `fcn_0040ff4b` |
 * | 3 | 62×30 | 取消钮按下 | `fcn_004106c1`（`idx−4 = 3`） |
 * | 4 | 62×30 | 確定钮按下 | `fcn_004106c1`（`idx−4 = 4`） |
 * | 5 | 15×16 | **点亮的格子** | `fcn_0040fd49` 的三条进度条 |
 * | 6 | 101×36 | 右上角钮按下 | `fcn_004105f4` |
 * | 7/8 | 16×16 | 上/下箭头（带红底） | 日期頁 |
 * | 9 | 15×15 | **亮着的灯** | `fcn_0040fd49` 的四处灯 + 視窗三选一 |
 * | 10/11 | 177×174 | 右上角按钮组（標題頁 / 遊戲中） | `0x00411d10` 起按 `arg` 取 |
 * | 12/13 | 17×11 | 上/下微调 | 日期頁 |
 * | 14/15 | 56×31 / 80×41 | 蓝钮 / 灰钮 | 日期頁 |
 *
 * ★ **哪些图要抠黑**：`fcn_004563f5`（不抠）与 `fcn_00456418`（抠黑，
 *   多压一个 `0` 当透明色）是两个包装，看调用点就知道：
 *   底图 0/2、格子 5 走**不抠**；灯 9、按钮 3/4/6、按钮组 10/11、熱鍵頁 1 走**抠黑**。
 *
 * ## 底图本身已经画好的东西 —— 不要自己再画
 *
 * 底图 0 上已经有：未点亮的格子（深绿、白边）、灯的底座（暗红圆）、
 * 右上角按钮组、樂曲列表的绿底与行线、取消/確定两颗钮的面。
 * 运行时只往上**贴**：点亮的格子、亮着的灯、按钮组、按下时的钮面、文字。
 *
 * ## 控件矩形表 `0x474b92`（16 项 × 16 字节，left/top/right/bottom）
 *
 * ```asm
 * 004104eb  mov eax, [0x474d74]      ; 控件号
 *           shl eax, 4
 *           cmp ebx, [eax + 0x474b92]  ; ebx = relx
 *           jl  下一个
 *           cmp esi, [eax + 0x474b96]  ; esi = rely
 *           jl  下一个
 *           cmp ebx, [eax + 0x474b9a]  ; right  —— 不含
 *           jge 下一个
 *           cmp esi, [eax + 0x474b9e]  ; bottom —— 不含
 *           jge 下一个
 * 00410522  jmp dword [eax*4 + 0x41034b]   ; 16 路处理跳表
 * ```
 *
 * ★ `png/` 与 `options.ts` 旧版里那些「量出来的」位置，逐条与这张表对不上
 *   （灯差 (2,1)、視窗三行差 (3,5)、右上角钮差 (3,2)）—— 以这张表为准。
 *
 * ## 兩个「照着做」而不是「改好」
 *
 * 1. **取消/確定是按下去时才贴图 3/4**，而图 3/4 上**没有字** —— 于是按住时
 *    钮面把字盖掉、看起来是空的。原版就是这样，别自作主张把字补回去。
 * 2. **按下后拖到别处再松手，仍然算点的是原来那颗** —— `0x00410820` 用的是
 *    按下时记下的 `[0x474d74]`，松手时不重新命中判定。
 */

import type { Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';

/** Data.mkf 里这一屏的资源号 */
export const OPTIONS_RESOURCE = 3;

/** 资源 3 的 16 张图 —— 名字即角色，逐条 @source 见文件头 */
export const IMG = {
  PANEL: 0,
  HOTKEY_PAGE: 1,
  DATE_PAGE: 2,
  CANCEL_DOWN: 3,
  OK_DOWN: 4,
  CELL: 5,
  SIDE_DOWN: 6,
  ARROW_UP: 7,
  ARROW_DOWN: 8,
  LAMP: 9,
  SIDE_TITLE: 10,
  SIDE_GAME: 11,
  SPIN_UP: 12,
  SPIN_DOWN: 13,
  BLUE_BUTTON: 14,
  GREY_BUTTON: 15,
} as const;

/** 走**抠黑**那支包装（`fcn_00456418`）的图号 */
export const KEYED_IMAGES: readonly number[] = [
  IMG.HOTKEY_PAGE,
  IMG.CANCEL_DOWN,
  IMG.OK_DOWN,
  IMG.SIDE_DOWN,
  IMG.ARROW_UP,
  IMG.ARROW_DOWN,
  IMG.LAMP,
  IMG.SIDE_TITLE,
  IMG.SIDE_GAME,
  IMG.SPIN_UP,
  IMG.SPIN_DOWN,
  IMG.BLUE_BUTTON,
  IMG.GREY_BUTTON,
];

/** 主面板尺寸 @source `Data.mkf` 资源 3 图 0 */
export const DIALOG_W = 347;
export const DIALOG_H = 363;
/** @source VA 0x00411dac：x0 = 320 − w/2，y0 = 240 − h/2（`0x140` / `0x0f0`） */
export const DIALOG = {
  x: 320 - (DIALOG_W >> 1),
  y: 240 - (DIALOG_H >> 1),
  w: DIALOG_W,
  h: DIALOG_H,
} as const;

// ============================================================
//  文字
// ============================================================

/**
 * 主面板的 12 条文字。
 * @source 串表 `0x474a54[0..11]`，坐标表 `0x474b38` 每项三个 word：x、y、对齐码。
 *
 * ★ 对齐码：`2` = 以 (x,y) 为中心；`5` = 左边贴 x、竖直居中。
 *   证据：码 5 那五条的 y 正好是各自控件竖直中心（遊戲速度 25 ↔ 速度条 17..33），
 *   码 2 那些的 (x,y) 落在控件正中（取消 224,328 ↔ 钮 194..256 × 314..344）。
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
 * 右上角三个黄按钮的文字 —— **随入口参数 `arg` 走**。
 * @source VA 0x00411cdf `str[3*arg + i]`，i = 12..14
 * - arg 0（標題頁）→ 12/13/14 日期更改・熱鍵設定・遊戲說明
 * - arg 1（遊戲中）→ 15/16/17 重新遊戲・認輸投降・結束遊戲
 */
export const SIDE_BUTTONS: readonly (readonly string[])[] = [
  ['日期更改', '熱鍵設定', '遊戲說明'],
  ['重新遊戲', '認輸投降', '結束遊戲'],
];

/** @source 图 10/11 是嵌在主面板里 (168,2) 的那块 177×174 */
export const SIDE_ART_AT = { x: 168, y: 2 } as const;
/**
 * 三个黄钮的字（相对那块按钮组图的坐标）。
 * @source 坐标表 `0x474b38` 的第 12..14 项：(108,31) (108,85) (108,136)，对齐码 2
 */
export const SIDE_TEXT = { x: 108, y: [31, 85, 136] as const };

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
/** @source VA 0x00411c20：兩列各 14，x = 62 / 208，y 從 33 起每條 +16 */
export const HOTKEY_COLUMNS = { x: [62, 208] as const, y0: 33, pitch: 16, rows: 14 };

// ============================================================
//  控件表
// ============================================================

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 控件号 —— 与 `0x474b92` 的项号、`0x41034b` 跳表的下标一一对应 */
export const CONTROL = {
  SPEED_BAR: 0,
  MUSIC_BAR: 1,
  SOUND_BAR: 2,
  SIDE_0: 3,
  SIDE_1: 4,
  SIDE_2: 5,
  TRACK_LIST: 6,
  CANCEL: 7,
  OK: 8,
  ANIM_LAMP: 9,
  MUSIC_LAMP: 10,
  SOUND_LAMP: 11,
  AUTOSAVE_LAMP: 12,
  WINDOW_0: 13,
  WINDOW_1: 14,
  WINDOW_2: 15,
} as const;

/**
 * ★ 原版的控件矩形表，**逐字照抄** `0x474b92`。
 *   判定用左闭右开：`x >= left && x < right`。
 */
export const CONTROL_RECTS: readonly Rect[] = [
  { x: 81, y: 17, w: 47, h: 16 },   // 0  遊戲速度条（3 格 ×16，右端不含）
  { x: 89, y: 81, w: 63, h: 16 },   // 1  音 樂条（4 格）
  { x: 89, y: 113, w: 63, h: 16 },  // 2  音 效条（4 格）
  { x: 227, y: 14, w: 100, h: 35 }, // 3  右上角钮 1
  { x: 227, y: 68, w: 100, h: 35 }, // 4  右上角钮 2
  { x: 227, y: 119, w: 100, h: 35 },// 5  右上角钮 3
  { x: 18, y: 226, w: 159, h: 119 },// 6  樂曲列表
  { x: 194, y: 314, w: 62, h: 30 }, // 7  取 消
  { x: 266, y: 314, w: 62, h: 30 }, // 8  確 定
  { x: 98, y: 50, w: 15, h: 15 },   // 9  動畫過程 灯
  { x: 66, y: 82, w: 15, h: 15 },   // 10 音 樂 灯
  { x: 66, y: 114, w: 15, h: 15 },  // 11 音 效 灯
  { x: 98, y: 146, w: 15, h: 15 },  // 12 自動存檔 灯
  { x: 217, y: 214, w: 107, h: 22 },// 13 日、月曆（整行可点）
  { x: 217, y: 246, w: 107, h: 22 },// 14 縮小地圖（整行可点）
  { x: 217, y: 278, w: 107, h: 22 },// 15 組合畫面（整行可点）
];

/** 格子图 15×16，步进 16（@source `fcn_00410537`：`(relx − 81) >> 4`） */
export const CELL = { w: 15, h: 16, pitch: 16 } as const;
/** 三条进度条第一格的 x 与各自第一格的 y */
export const BAR_AT = {
  speed: { x: 81, y: 17 },
  music: { x: 89, y: 81 },
  sound: { x: 89, y: 113 },
} as const;
/** 四条灯的贴图位置（＝各自控件的 left/top）@source 0x474c22 / c32 / c42 / c52 */
export const LAMP_AT = {
  animation: { x: 98, y: 50 },
  music: { x: 66, y: 82 },
  sound: { x: 66, y: 114 },
  autoSave: { x: 98, y: 146 },
} as const;
/** 視窗三选一的灯：x 固定 218（`x + 0xda`），y 查表 `0x474c92` = 218 / 250 / 281 */
export const WINDOW_LAMP = { x: 218, y: [218, 250, 281] as const };

/** 樂曲列表的行几何 @source `fcn_0040fc57` */
export const TRACK_ROWS = {
  /** 行高与行数 */
  rowH: 15,
  rows: 8,
  /** 反白条：(x+0x12, y+0xe2+15i)，159×14，纯红 `0xff0000` */
  x: 18,
  y: 226,
  w: 159,
  h: 14,
  /** 行文字：(x+0x1a, y+0xe9+15i)，对齐码 5 */
  textX: 26,
  textDY: 7,
} as const;

/** 字号（原版 `rich4_create_font` 的 size 参数） */
export const FONT_SIZE = { label: 15, big: 20, list: 12 } as const;

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
  /**
   * 第几首配乐 0..7 —— `Midi.txt` 的前 8 条正好是这 8 首。
   *
   * ⚠️ 原版**没有**把这个存进 cfg：列表里反白的那一行是「当前正在放的那首」
   *   （`fcn_00454f5b()` 问播放器），点一下**立刻换曲**，取消也不回退。
   *   本引擎多存一个字段只是为了知道自己点了哪首；反白仍以正在放的那首为准。
   */
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
  | { kind: 'bar'; ctrl: number; field: 'speed' | 'music' | 'sound'; value: number }
  | { kind: 'lamp'; ctrl: number; field: 'animation' | 'music' | 'sound' | 'autoSave' }
  | { kind: 'window'; ctrl: number; value: number }
  | { kind: 'track'; ctrl: number; value: number }
  | { kind: 'side'; ctrl: number; index: number }
  | { kind: 'cancel'; ctrl: number }
  | { kind: 'ok'; ctrl: number };

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** 对话框内坐标 → 控件号；`null` = 没点中任何控件 */
export function hitControl(x: number, y: number): number | null {
  for (let i = 0; i < CONTROL_RECTS.length; i++) {
    if (inRect(x, y, CONTROL_RECTS[i]!)) return i;
  }
  return null;
}

/** 舞台坐标 → 这一屏的命中；`null` 表示没点中任何控件 */
export function hitOptions(sx: number, sy: number): OptionsHit | null {
  const x = sx - DIALOG.x;
  const y = sy - DIALOG.y;
  if (x < 0 || y < 0 || x >= DIALOG.w || y >= DIALOG.h) return null;
  const ctrl = hitControl(x, y);
  if (ctrl === null) return null;
  return controlHit(ctrl, x, y);
}

/** 控件号 → 语义命中（按下/松手都走这里） */
export function controlHit(ctrl: number, x: number, y: number): OptionsHit | null {
  switch (ctrl) {
    case CONTROL.SPEED_BAR:
      // @source fcn_00410537：(relx − 81) >> 4，不 +1
      return { kind: 'bar', ctrl, field: 'speed', value: clamp(Math.floor((x - 81) / 16), 0, 2) };
    case CONTROL.MUSIC_BAR:
      // @source fcn_00410572：(relx − 89) >> 4 再 +1 → 1..4（0 只能靠灯关）
      return { kind: 'bar', ctrl, field: 'music', value: clamp(Math.floor((x - 89) / 16) + 1, 1, 4) };
    case CONTROL.SOUND_BAR:
      // @source fcn_004105b9：同上
      return { kind: 'bar', ctrl, field: 'sound', value: clamp(Math.floor((x - 89) / 16) + 1, 1, 4) };
    case CONTROL.SIDE_0:
    case CONTROL.SIDE_1:
    case CONTROL.SIDE_2:
      return { kind: 'side', ctrl, index: ctrl - CONTROL.SIDE_0 };
    case CONTROL.TRACK_LIST:
      // @source fcn_00410668：(rely − 0xe2) / 0xf
      return { kind: 'track', ctrl, value: clamp(Math.floor((y - TRACK_ROWS.y) / TRACK_ROWS.rowH), 0, 7) };
    case CONTROL.CANCEL:
      return { kind: 'cancel', ctrl };
    case CONTROL.OK:
      return { kind: 'ok', ctrl };
    case CONTROL.ANIM_LAMP:
      return { kind: 'lamp', ctrl, field: 'animation' };
    case CONTROL.MUSIC_LAMP:
      return { kind: 'lamp', ctrl, field: 'music' };
    case CONTROL.SOUND_LAMP:
      return { kind: 'lamp', ctrl, field: 'sound' };
    case CONTROL.AUTOSAVE_LAMP:
      return { kind: 'lamp', ctrl, field: 'autoSave' };
    case CONTROL.WINDOW_0:
    case CONTROL.WINDOW_1:
    case CONTROL.WINDOW_2:
      // @source fcn_004107f3：`[0x474d74] − 0xd`
      return { kind: 'window', ctrl, value: ctrl - CONTROL.WINDOW_0 };
    default:
      return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 把一次点击落到取值上。
 *
 * ★ 樂曲那一项**不动 `GameOptions.track` 以外的任何东西**：原版点一下就直接换曲，
 *   所以调用方（main.ts）拿到 `kind === 'track'` 时要立刻起播。
 */
export function applyOptionsHit(o: GameOptions, hit: OptionsHit): GameOptions {
  switch (hit.kind) {
    case 'bar':
      return { ...o, [hit.field]: hit.value };
    case 'lamp':
      if (hit.field === 'animation') return { ...o, animation: !o.animation };
      if (hit.field === 'autoSave') return { ...o, autoSave: !o.autoSave };
      // @source fcn_0041076e / fcn_0041079c：0 ↔ 4（不是 0 ↔ 3）
      return { ...o, [hit.field]: o[hit.field] === 0 ? 4 : 0 };
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

const FONT = FONT_FAMILY;
const TEXT_COLOR = '#101010';
/** 列表里的字：白字黑边 @source `create_font(0xc, 0xf0f0f0, 0x101010, …)` */
const LIST_FILL = '#f0f0f0';
const OUTLINE = '#101010';
/** 选中行的红底 @source `fcn_004561be(…, 0xff0000)` */
const TRACK_SELECTED = '#ff0000';

function blit(
  ctx: CanvasRenderingContext2D,
  sprite: OptionsSpriteFn,
  index: number,
  x: number,
  y: number,
): void {
  const s = sprite(index, KEYED_IMAGES.includes(index));
  if (s !== null) ctx.drawImage(s.bitmap, x, y);
}

/** 白字黑边（原版是点阵字自带描边） */
function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = LIST_FILL;
  ctx.fillText(text, x, y);
}

export function drawOptions(
  ctx: CanvasRenderingContext2D,
  o: GameOptions,
  /** 右上角三个钮用哪一组（0 標題頁 / 1 遊戲中） */
  variant: number,
  /** 当前按住不放的控件号（`null` = 没按）；原版**没有悬停高亮** */
  pressed: number | null,
  /** 正在放的那首（反白那一行）@source `fcn_00454f5b()` */
  playingTrack: number,
  sprite: OptionsSpriteFn,
): void {
  ctx.save();
  ctx.translate(DIALOG.x, DIALOG.y);

  // ——— 底图 0：不抠黑 ———
  const panel = sprite(IMG.PANEL, false);
  if (panel !== null) ctx.drawImage(panel.bitmap, 0, 0);
  else {
    ctx.fillStyle = '#6b7b6b';
    ctx.fillRect(0, 0, DIALOG.w, DIALOG.h);
  }

  // ——— 右上角按钮组：10 / 11 按 variant 选 ———
  blit(ctx, sprite, variant === 0 ? IMG.SIDE_TITLE : IMG.SIDE_GAME, SIDE_ART_AT.x, SIDE_ART_AT.y);

  // ——— 三条进度条：点亮格 = 图 5，不抠黑，逐格 16 步进 ———
  // @source fcn_0040fd49：速度 `esi <= 值`（0..值 共 值+1 格）；
  //                       音樂/音效 `esi < 值`（0..值−1 共 值 格）
  drawBar(ctx, sprite, BAR_AT.speed, o.speed + 1);
  drawBar(ctx, sprite, BAR_AT.music, o.music);
  drawBar(ctx, sprite, BAR_AT.sound, o.sound);

  // ——— 四处灯：亮着才贴图 9（不亮时底图的暗红灯座自己就够） ———
  lamp(ctx, sprite, LAMP_AT.animation, o.animation);
  lamp(ctx, sprite, LAMP_AT.music, o.music > 0);
  lamp(ctx, sprite, LAMP_AT.sound, o.sound > 0);
  lamp(ctx, sprite, LAMP_AT.autoSave, o.autoSave);

  // ——— 視窗三选一的灯 ———
  const wy = WINDOW_LAMP.y[clamp(o.windowView, 0, 2)]!;
  blit(ctx, sprite, IMG.LAMP, WINDOW_LAMP.x, wy);

  // ——— 樂曲列表 ———
  ctx.font = `${FONT_SIZE.list}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < TRACK_ROWS.rows; i++) {
    const rowY = TRACK_ROWS.y + i * TRACK_ROWS.rowH;
    if (i === playingTrack) {
      ctx.fillStyle = TRACK_SELECTED;
      ctx.fillRect(TRACK_ROWS.x, rowY, TRACK_ROWS.w, TRACK_ROWS.h);
    }
    outlinedText(ctx, TRACK_NAMES[i] ?? '', TRACK_ROWS.textX, rowY + TRACK_ROWS.textDY);
  }

  // ——— 文字：先 10 条（15px），再取消/確定（20px），再右上角三条（20px） ———
  // ★ 上面列表那段把 font 改成了 12px，这里必须**先设回来** ——
  //   原版是每段各自 `rich4_create_font` 一次，不存在"沿用上一段的字号"。
  ctx.font = `${FONT_SIZE.label}px ${FONT}`;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const l of OPTION_LABELS.slice(0, 10)) {
    ctx.fillText(l.text, l.x, l.y);
  }
  ctx.font = `${FONT_SIZE.big}px ${FONT}`;
  for (const l of OPTION_LABELS.slice(10)) {
    ctx.textAlign = 'center';
    ctx.fillText(l.text, l.x, l.y);
  }
  const side = SIDE_BUTTONS[variant] ?? SIDE_BUTTONS[0]!;
  ctx.textAlign = 'center';
  for (let i = 0; i < side.length; i++) {
    ctx.fillText(side[i]!, SIDE_ART_AT.x + SIDE_TEXT.x, SIDE_ART_AT.y + SIDE_TEXT.y[i]!);
  }

  // ——— 按下时的钮面：**画在字之后**，原版就是这样把字盖掉的 ———
  if (pressed === CONTROL.CANCEL) blitRect(ctx, sprite, IMG.CANCEL_DOWN, CONTROL.CANCEL);
  if (pressed === CONTROL.OK) blitRect(ctx, sprite, IMG.OK_DOWN, CONTROL.OK);
  if (pressed === CONTROL.SIDE_0 || pressed === CONTROL.SIDE_1 || pressed === CONTROL.SIDE_2) {
    blitRect(ctx, sprite, IMG.SIDE_DOWN, pressed);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  sprite: OptionsSpriteFn,
  at: { x: number; y: number },
  cells: number,
): void {
  for (let i = 0; i < cells; i++) {
    blit(ctx, sprite, IMG.CELL, at.x + i * CELL.pitch, at.y);
  }
}

function lamp(
  ctx: CanvasRenderingContext2D,
  sprite: OptionsSpriteFn,
  at: { x: number; y: number },
  on: boolean,
): void {
  if (on) blit(ctx, sprite, IMG.LAMP, at.x, at.y);
}

function blitRect(
  ctx: CanvasRenderingContext2D,
  sprite: OptionsSpriteFn,
  index: number,
  ctrl: number,
): void {
  const r = CONTROL_RECTS[ctrl]!;
  blit(ctx, sprite, index, r.x, r.y);
}
