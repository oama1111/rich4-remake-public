/*
 * 託管AI（工具列 #3）—— 原版那一屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 入口 VA 0x0041e345（见 `docs/original-screens.md` S3）：
 * ```
 * 0041e34f  push 0x4d / push [0x48a05c] / call 0x450441   ; ★ 建对话框
 * ```
 *
 * ⚠️ **这一屏的档案被记错过一次。** `original-screens.md` 写的是「Data.mkf 资源
 *   0x4d = 77」，但入口用的是 `[0x48a05c]`，而 `[0x48a0e4]` 才是 Data.mkf
 *   （见 `assets.ts` 角色精灵那段对同一张全局表的注释）。实测：
 *
 *   | 档案 | 资源 77 |
 *   |---|---|
 *   | `Data.mkf` | 80000 字节、头 `ff 26 de 22`，`parseSpriteSheet` 解不出来 |
 *   | **`Panel.mkf`** | **SMP 18 张，图 0 = 435×355 的对话框底图** ← 就是这一屏 |
 *
 *   渲染图 0 出来一看就是那张绿面板（左侧木纹条、右侧粉条上两颗米色按钮、
 *   中间五个圆点、底部两条滑槽）。故资源在 **`Panel.mkf`**。
 *
 * 资源内的分工（逐张渲染确认）：
 * | 图 | 尺寸 | 是什么 |
 * |---|---|---|
 * | 0 | 435×355 | 对话框底图（含标题条、五个圆点、两条滑槽、两颗按钮面）|
 * | 1 | 116×86 | **玩家行**底板·**亮**（选中的那一行，WM_PAINT `loc_0041dbe0` 才贴）|
 * | 2 | 116×86 | **玩家行**底板·**暗** —— 图 1 整体压暗约六成；入口 0x0041e61c 给每位真人都贴一张 |
 * | 3 | 15×15 | 圆点单图 |
 * | 4 / 5 | 9×20 | 滑槽两端的箭头 |
 * | 6..17 | 各约 70×70 | **12 个角色的头像**（与開局设置的 12 张同序）|
 *
 * 文字坐标全部来自反汇编（VA 0x0041e37d 起），且与底图上的图形**逐项吻合**：
 * 圆点在 x=193、文字中心在 x=244（居中对齐），两者的 y 最多差 2 像素。
 */

import type { Action, GameState, Player } from '@rich4/core';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from '@rich4/core';
import type { ArchiveName, Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import { drawSprite } from './hd-stage.ts';

// ============================================================
//  资源
// ============================================================

export const AI_ARCHIVE: ArchiveName = 'Panel.mkf';
/** 对话框资源号 @source VA 0x0041e34f 的 `push 0x4d` */
export const AI_RESOURCE = 0x4d; // 77
export const AI_BG = 0;
export const AI_ROW_ON = 1;
export const AI_ROW_OFF = 2;
export const AI_DOT = 3;
/** 12 个角色头像从这张开始，按 character 顺序排 */
export const AI_PORTRAIT_BASE = 6;

/** 对话框尺寸 @source 图 0 */
export const AI_W = 435;
export const AI_H = 355;
/**
 * 对话框左上角。
 *
 * ★ **不是「居中」算出来的**，是 exe 直给的：整个对话框被画进图 0 的缓冲区，
 *   再整体贴到屏幕的 `(0x66, 0x3e) = (102, 62)`（`fcn_004563f5(dst, 图0, 102, 62)`），
 *   窗口矩形也是 `InvalidateRect(0x66, 0x3e, 0x219, 0x1a1)` → 435×355。
 *   先前按 `320 − 435/2` 推出 (103, 63)，**整整差 1 像素**；
 *   这一屏里所有文字/控件坐标都是对话框相对坐标，1 像素会一路带着走。
 */
export const AI_ORIGIN = { x: 0x66, y: 0x3e } as const;

// ============================================================
//  文字（全部对话框相对坐标，来自反汇编）
// ============================================================

/**
 * @source VA 0x0041e37d 起的一串 `text(...)`：
 * ```asm
 * 0041e37d  text("託管AI",       x=0x0ad, y=0x01a, 2)   ; 大字
 * 0041e39c  text("個 性",        x=0x0ad, y=0x072, 2)
 * 0041e3bb  text("資金運用比例", x=0x0f9, y=0x0f6, 2)
 * 0041e3f5  text("使用卡片",     x=0x0f4, y=0x035, 2)   ; 小字
 * 0041e414  text("使用道具",     x=0x0f4, y=0x054, 2)
 * 0041e433  text("乖寶寶",       x=0x0f4, y=0x08d, 2)
 * 0041e455  text("普通人",       x=0x0f4, y=0x0ad, 2)
 * 0041e477  text("大老奸",       x=0x0f4, y=0x0ce, 2)
 * 0041e499  text("現金",         x=0x0bf, y=0x115, 6)
 * 0041e4bb  text("存款",         x=0x131, y=0x115, 5)
 * 0041e4dd  text("股票",         x=0x0bf, y=0x136, 6)
 * 0041e4ff  text("資金",         x=0x131, y=0x136, 5)
 * 0041e536  text("確定",         x=0x18d, y=0x07d, 3)
 * 0041e555  text("取消",         x=0x18d, y=0x0d5, 3)
 * ```
 *
 * ★ 末位那个数字是**对齐方式**，不是可忽略的标志位 —— 先前当成注释丢掉了，
 *   于是整屏文字都按「左对齐 + 顶边」画，位置全偏，看着还像字号过大。
 *
 *   语义**不靠推断**，在画字函数 `0x44fabc` 里：末尾 `lea eax,[flag-1]` +
 *   `jmp [eax*4 + 0x44faa0]` 是一张 7 路跳表：
 *
 *   | flag | 水平 | 垂直 |
 *   |---|---|---|
 *   | 0 或 >7 | 左 | 上（**不调整**）|
 *   | 1 | 右 | 上 |
 *   | **2 / 3 / 4** | **中** | **中** |
 *   | 5 | 左 | 中 |
 *   | **6** | 右 | 中 |
 *   | 7 | 中 | 下 |
 *
 *   即 `x`/`y` 是**文字块的中心**（flag 0 除外，那是左上角）。
 *   本屏用到的：`託管AI`/`個 性`/`資金運用比例`/五个选项 = 2（正中），
 *   `存款`/`資金` = 5（左+中），`現金`/`股票` = 6（右+中）。
 *
 * ⚠️ **一处未解**：`確定`/`取消` 在 exe 里是 flag **3**，按跳表也是「正中」（水平），
 *   而实机截图（S3）上它们是**竖排**的两个字。`set_font` 的第 4 参是个位域
 *   （存在 `0x4762d8`，普通文字传 6、这两颗传 2），但读下来 bit2 只影响测量盒
 *   的 ±1 像素，不足以造成竖排；换行规则尚未跟到。按项目文档「截图是画面的
 *   最终裁判」，这里**按截图做竖排**，并把差异记在 known-deviations。
 *
 * 字号本身取自 exe：大字 `0x14=20`、小字 `0x10=16`。
 */
export interface AiTextAt {
  x: number;
  y: number;
  /** 对齐方式，即反汇编里的末位参数 */
  align: 2 | 3 | 5 | 6;
}

export const AI_TEXT = {
  title: { x: 0x0ad, y: 0x01a, align: 2 },
  personality: { x: 0x0ad, y: 0x072, align: 2 },
  ratios: { x: 0x0f9, y: 0x0f6, align: 2 },
  useCards: { x: 0x0f4, y: 0x035, align: 2 },
  useTools: { x: 0x0f4, y: 0x054, align: 2 },
  goodBoy: { x: 0x0f4, y: 0x08d, align: 2 },
  normal: { x: 0x0f4, y: 0x0ad, align: 2 },
  villain: { x: 0x0f4, y: 0x0ce, align: 2 },
  cash: { x: 0x0bf, y: 0x115, align: 6 },
  deposit: { x: 0x131, y: 0x115, align: 5 },
  stock: { x: 0x0bf, y: 0x136, align: 6 },
  fund: { x: 0x131, y: 0x136, align: 5 },
  ok: { x: 0x18d, y: 0x07d, align: 3 },
  cancel: { x: 0x18d, y: 0x0d5, align: 3 },
} as const satisfies Record<string, AiTextAt>;

/** 原版四个字的写法（照抄截图：是「個 性」不是「個性」，中间有空格） */
export const AI_LABELS = {
  title: '託管AI',
  personality: '個 性',
  ratios: '資金運用比例',
  useCards: '使用卡片',
  useTools: '使用道具',
  goodBoy: '乖寶寶',
  normal: '普通人',
  villain: '大老奸',
  cash: '現金',
  deposit: '存款',
  stock: '股票',
  fund: '資金',
  ok: '確定',
  cancel: '取消',
} as const;

// ============================================================
//  控件摆位
// ============================================================

/**
 * 五个选项圆点的**中心**。
 *
 * 出处不是量图，是 `fcn_0041db91` 的两处绘制：亮圆点（图 3，15×15）画在
 * `(0x120, 107/139)`（屏幕）→ 对话框相对 `(186, 45/77)`，而 `fcn_004562a5` 会
 * 减掉图自己的锚点（这里是 (0,0)），故圆点中心 = `(186 + 7, 45 + 7) = (193, 52)`。
 * 三个個性行同理，y 取自表 `0x4752b8 = [195, 227, 259]`（屏幕）→ 中心 140/172/204。
 */
export const AI_DOT_AT = [52, 84, 140, 172, 204] as const;
export const AI_DOT_X = 193;

/**
 * 五个选项行的**命中框 / 悬停框** —— 直接抄 exe 的矩形表。
 *
 * @source 表 `0x4752ae`，每项 4 个 `int16` = `(x0, y0, x1, y1)`（**屏幕**坐标）。
 *   索引 2..6 依次是「使用卡片 / 使用道具 / 乖寶寶 / 普通人 / 大老奸」：
 *   `(287,106,383,124) (287,137,383,155) (287,194,383,212) (287,226,383,244) (287,259,383,277)`。
 *   减掉对话框原点 (102,62) 得相对框 `x 185..281`、y 见下。
 */
export const AI_OPTION_ROWS = [
  { x: 185, y: 44, w: 97, h: 19 },
  { x: 185, y: 75, w: 97, h: 19 },
  { x: 185, y: 132, w: 97, h: 19 },
  { x: 185, y: 164, w: 97, h: 19 },
  { x: 185, y: 197, w: 97, h: 19 },
] as const;

/**
 * 两颗竖排按钮的矩形 —— **从 exe 的矩形表直抄，不再靠猜**。
 *
 * @source 表 `0x4752ae` 索引 11/12：`(479,159,519,215)` = 確定、`(479,247,519,303)` = 取消
 *   （屏幕坐标）→ 相对 `x 377..417`、`y 97..153` / `185..241`。
 *   按钮中心 x = 397、y = 125 / 213，与竖排文字 anchors 逐个吻合。
 *
 * ⚠️ 先前是按「以文字为中心、宽度撑满右侧粉条」**推**出来的 (365,90,66,72) ——
 *   推导这件事本身就不该做：同一张表里就写着真值。
 */
export const AI_BTN_OK = { x: 377, y: 97, w: 41, h: 57 } as const;
export const AI_BTN_CANCEL = { x: 377, y: 185, w: 41, h: 57 } as const;

/**
 * 两条滑槽的**可拖动区**矩形（相对坐标）。
 *
 * @source 表 `0x4752ae` 索引 13/14：`(310,327,390,351)` 現金、`(310,360,390,384)` 股票 ——
 *   两张都是 80 宽，由左右两颗箭头夹着（箭头自身是索引 7..10，画在底图里）。
 *   减对话框原点得相对 `x 208..288`、y `265..289` / `298..322`。
 */
export const AI_SLIDERS = {
  cash: { x: 208, y: 265, w: 80, h: 24 },
  stock: { x: 208, y: 298, w: 80, h: 24 },
} as const;

/**
 * 比例条的**分段填充**：一格 7 宽、22 高、间距 8，第一格在拖动区左边 +1。
 *
 * @source `fcn_0041da61`：每格 `fill_rect(0x46caec, 311 + 8k, 328, 7, 22, 0xff0000)`
 *   （屏幕）→ 相对 `x = 209 + 8k`、y `266`（現金）/ `299`（股票）。
 *   格数 = `[比例 / 10]`（下文 `AI_RATIO_STEP`）。
 *
 * ⚠️ **不是一条连续色条，更不是绿色的** —— 先前画成一条浅绿填充，与原版不符。
 */
export const AI_SEG = { dx: 209, dy: 1, w: 7, h: 22, pitch: 8, color: '#ff0000' } as const;
/** 一档 = 10%，即一格 */
export const AI_RATIO_STEP = 10;

/**
 * 滑槽两端那两颗箭头 —— **不是装饰，是 ±10 的档位钮**，也是 100% 的唯一来路。
 *
 * @source 表 `0x4752ae` 索引 7..10：`(298,328,309,350) (392,328,403,350) (298,361,309,383) (392,361,403,383)`
 *   （屏幕）→ 相对 `x 196..207`（左）/ `290..301`（右）。
 *   按下后走 `loc_0041e15a`（−10，`>10` 才减，否则归 0）与 `loc_0041e191`（+10，`<90` 才加，否则 100）。
 *
 * ★ 拖动区是 `310 < x < 390`（**两端都不含**）→ 拖到最右只到 `(389−310)/8×10 = 90`；
 *   要 100 就得按右箭头。原版这两条路是配套的，少一条就调不出「全存/全投」。
 */
export const AI_ARROWS: Record<'cash' | 'stock', readonly { x: number; y: number; w: number; h: number; delta: number }[]> = {
  cash: [
    { x: 196, y: 266, w: 12, h: 23, delta: -AI_RATIO_STEP },
    { x: 290, y: 266, w: 12, h: 23, delta: AI_RATIO_STEP },
  ],
  stock: [
    { x: 196, y: 299, w: 12, h: 23, delta: -AI_RATIO_STEP },
    { x: 290, y: 299, w: 12, h: 23, delta: AI_RATIO_STEP },
  ],
};

/**
 * 每位可托管玩家一行，行距 `0x53 = 83`，首行 `edi = 8`。@source VA 0x0041e577
 *
 * 一行由三样东西叠成（都在**对话框相对坐标**里）：
 * 1. **行底板** —— 图 1（当前行）/ 图 2（其余），画在 `(8, y)`，116×86。
 *    这张图与背景同为绿色，肉眼几乎看不出来，**只有上面那个红点显形** ——
 *    这也是先前把它误当成「一颗 LED」的原因。
 * 2. **头像** —— 图 `6 + character`，画在 `(0x50, y + 0x28)` = `(80, y+40)`。
 *    ★ 必须**减锚点**（`fcn_004562a5` 会减，头像锚点约在图心）：
 *    减完头像占 x 约 38..123，正好落在底板里。
 * 3. **点亮的圆点** —— 图 3（15×15），画在 `(0x79, y_screen + 0x24)` → 相对 `(19, y+36)`，
 *    中心 `(26, y+43)` 与底板上烤进的那个暗点重合。托管开着时才画。
 *
 * ★ **原版这一屏不画角色名**：入口函数里 14 次 `draw_text` 的串全是
 *   `ref_00463cxx/dxx` 这种**常量**（十二个标签 + 確定 + 取消），没有任何一处
 *   从玩家记录里取名字。先前我们自作主张补了一个名字，位置又按「头像左上角 + 74」
 *   算，正好压在头像上 —— 需求方 2026-09-15 看到的「头像和名字错位」就是这个。
 */
export const AI_ROW_FIRST_Y = 8;
export const AI_ROW_PITCH = 0x53; // 83
/** 行底板的 x；116×86 的图 1/图 2 画在这里 */
export const AI_PLATE_X = 8;
/** 点亮的圆点相对行首的偏移（图 3 是 15×15、锚点 (0,0)，故这是左上角）*/
export const AI_LED_AT = { x: 19, dy: 36 } as const;
/** 头像相对行首的偏移；绘制时要减图自己的锚点 */
export const AI_PORTRAIT_AT = { x: 0x50, dy: 0x28 } as const;

// ============================================================
//  草稿
// ============================================================

/** 一行 = 一名**人類**座位当前可编辑的托管设置 */
export interface AiSettingRow {
  player: number;
  whoPlays: number;
  aiFlags: number;
  personality: number;
  cashRatio: number;
  stockRatio: number;
}

/**
 * 取草稿：**只列真人座位**。
 *
 * @source VA 0x0041e5a6 `if ((player[i].+0x15 & 1) == 0) continue` ——
 *   原版这一屏只列人類（截图里也只有一个头像）。**托管 = 把自己的座位交给 AI**，
 *   不是调对手的 AI。
 */
export function aiSettingsDraft(state: GameState): AiSettingRow[] {
  const rows: AiSettingRow[] = [];
  for (const p of state.players) {
    if (isHumanSeat(p)) rows.push(rowOf(p));
  }
  return rows;
}

function isHumanSeat(p: Player): boolean {
  return (p.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN;
}

function rowOf(p: Player): AiSettingRow {
  return {
    player: p.index,
    whoPlays: p.whoPlays,
    aiFlags: p.aiFlags,
    personality: p.personality,
    cashRatio: p.cashRatio,
    stockRatio: p.stockRatio,
  };
}

/** 这一行跟状态里的是不是已经一样了（决定「確定」要不要发 action） */
export function rowMatchesPlayer(row: AiSettingRow, p: Player): boolean {
  return (
    row.whoPlays === p.whoPlays &&
    row.aiFlags === p.aiFlags &&
    row.personality === p.personality &&
    row.cashRatio === p.cashRatio &&
    row.stockRatio === p.stockRatio
  );
}

/** 草稿里第 n 行画在哪（对话框相对坐标） */
export function rowY(n: number): number {
  return AI_ROW_FIRST_Y + n * AI_ROW_PITCH;
}

// ============================================================
//  命中
// ============================================================

export type AiSettingsHit =
  /**
   * 点在第 `row` 位玩家那一行（行底板）上 —— **命中**只报这一种；
   * 选中 / 翻托管由 `aiSettingsDown` 按「是不是已选中那一行」决定（`loc_0041def4`）。
   */
  | { kind: 'row'; row: number }
  /** 翻托管位（真人 ↔ 真人+托管）—— 只作为**动作**出现，命中测试不直接给它 */
  | { kind: 'autopilot'; row: number }
  /** 会用卡（bit0）/ 会用道具（bit1）*/
  | { kind: 'ability'; row: number; bit: number }
  /** 個性 0/1/2 */
  | { kind: 'personality'; row: number; value: number }
  /** 两条比例滑槽；`value` 由点击的 x 位置换算 */
  | { kind: 'ratio'; row: number; which: 'cash' | 'stock'; value: number }
  /** 滑槽两端的箭头：按一下 ±10 */
  | { kind: 'ratioStep'; row: number; which: 'cash' | 'stock'; delta: number }
  | { kind: 'ok' }
  | { kind: 'cancel' };

const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/**
 * 第 `n` 行的行底板命中 —— **两端都不含**（开区间）。
 *
 * @source `loc_0041de95` 起（屏幕坐标，`ecx = 0x46 + 0x53·n`）：
 * ```asm
 * 0041decd  cmp esi, 0x6e / jle 跳过      ; x > 110
 * 0041ded2  cmp esi, 0xe2 / jge 跳过      ; x < 226
 * 0041deda  cmp edi, ecx  / jle 跳过      ; y > 70 + 83n
 * 0041dede  lea ebx,[ecx+0x53] / cmp edi, ebx / jge 跳过   ; y < 153 + 83n
 * ```
 * 减对话框原点 (0x66, 0x3e) → 相对 `8 < x < 124`、`8+83n < y < 91+83n`。
 */
function inRowPlate(x: number, y: number, n: number): boolean {
  const ry = rowY(n);
  return x > AI_PLATE_X && x < AI_PLATE_X + 116 && y > ry && y < ry + AI_ROW_PITCH;
}

/**
 * 滑槽上点在 x 处的值（0..100，**只能取 10 的整数倍**）。
 *
 * @source `loc_0041de44`（WM_LBUTTONUP）：
 * ```asm
 * 0041de52  sub esi, word [0x4752ae + idx*8]   ; dx = x − 拖动区左缘
 * 0041de60  sar eax, 3                          ; dx / 8
 * 0041de6a  shl eax,2 / add eax,edx / add eax,eax   ; × 10
 * 0041de77  byte [rec + idx + 0x48be2b] = al    ; 存进现-存 / 股-資比例
 * ```
 * 即 `值 = (x − x0) / 8 × 10`（整除）—— 11 档，正好对着 11 格位置；
 * 右端 `(288−208)/8×10 = 100`，左端 0。
 *
 * ⚠️ 先前按「连续百分比」算（除 `w−1` 再四舍五入），于是能拖出 37% 这种
 *   原版没有的档位，填充也画成了一条连续色条。
 */
export function ratioFromX(x: number, r: { x: number; w: number }): number {
  const step = Math.floor((x - r.x) / AI_SEG.pitch);
  return Math.max(0, Math.min(100, step * AI_RATIO_STEP));
}

/**
 * 命中测试，坐标是**对话框相对坐标**（调用方先减去 `AI_ORIGIN`）。
 *
 * @param local 已减去 `AI_ORIGIN` 的点
 * @param rows  当前草稿（决定有几行、能点哪里）
 * @param sel   **选中的那一行**（草稿下标，原版 `[0x48be4c]`）—— 底图上只有**一套**
 *   选项与**一对**滑槽，它们改的都是选中那一行（`loc_0041e0d7..0x0041e228` 全以 `[0x48be4c]` 取行）。
 */
export function hitAiSettings(
  local: { x: number; y: number },
  rows: readonly AiSettingRow[],
  sel: number,
): AiSettingsHit | null {
  const { x, y } = local;

  // ★ 顺序照原版 `loc_0041de95`：**先判玩家行底板，再判那张控件表**。
  //   两块区域不重叠，但摆成同一个顺序省得以后改动时踩到。
  for (let n = 0; n < rows.length; n++) {
    if (inRowPlate(x, y, n)) return { kind: 'row', row: n };
  }

  // 使用卡片 / 使用道具 / 乖寶寶 / 普通人 / 大老奸 —— 直接用 exe 的矩形表；改的是**选中那一行**
  if (rows.length > 0) {
    for (const [k, r] of AI_OPTION_ROWS.entries()) {
      if (!inRect(x, y, r)) continue;
      return k < 2
        ? { kind: 'ability', row: sel, bit: k }
        : { kind: 'personality', row: sel, value: k - 2 };
    }
  }

  // 两颗按钮
  if (inRect(x, y, AI_BTN_OK)) return { kind: 'ok' };
  if (inRect(x, y, AI_BTN_CANCEL)) return { kind: 'cancel' };

  // 那对滑槽同样改选中那一行
  const ratioRow = sel;
  for (const which of ['cash', 'stock'] as const) {
    for (const arrow of AI_ARROWS[which]) {
      if (inRect(x, y, arrow)) {
        return { kind: 'ratioStep', row: ratioRow, which, delta: arrow.delta };
      }
    }
    if (inRect(x, y, AI_SLIDERS[which])) {
      return { kind: 'ratio', row: ratioRow, which, value: ratioFromX(x, AI_SLIDERS[which]) };
    }
  }

  return null;
}

/** 把一次命中应用到草稿上，返回**新的**草稿（不就地改）*/
export function applyAiSettingsHit(rows: readonly AiSettingRow[], hit: AiSettingsHit): AiSettingRow[] {
  if (hit.kind === 'ok' || hit.kind === 'cancel') return [...rows];
  const out = rows.map((r) => ({ ...r }));
  const row = out[hit.row];
  if (row === undefined) return out;

  switch (hit.kind) {
    case 'row':
      // 命中行本身不改数据 —— 选中 / 翻托管由 `aiSettingsDown` 决定
      break;
    case 'autopilot':
      // 原版那颗 LED 就是托管总开关：在「真人」与「真人+托管」之间翻
      row.whoPlays = (row.whoPlays & ~WHO_PLAYS_AUTOPILOT) | ((row.whoPlays & WHO_PLAYS_AUTOPILOT) ? 0 : WHO_PLAYS_AUTOPILOT);
      break;
    case 'ability':
      row.aiFlags ^= 1 << hit.bit;
      break;
    case 'personality':
      row.personality = hit.value;
      break;
    case 'ratio':
      if (hit.which === 'cash') row.cashRatio = hit.value;
      else row.stockRatio = hit.value;
      break;
    case 'ratioStep': {
      // @source `loc_0041e15a`（−10，>10 才减否则归 0）/ `loc_0041e191`（+10，<90 才加否则 100）
      const cur = hit.which === 'cash' ? row.cashRatio : row.stockRatio;
      const next = Math.max(0, Math.min(100, cur + hit.delta));
      if (hit.which === 'cash') row.cashRatio = next;
      else row.stockRatio = next;
      break;
    }
  }
  return out;
}

// ============================================================
//  按下 / 抬手 —— 原版的「先选中、再点一次才翻」
// ============================================================

/**
 * 这一屏的交互状态（草稿之外那两个全局）。
 *
 * - `sel` = 原版 `[0x48be4c]`：**选中的那一行**。选项圆点、两条滑槽都只显示/只改这一行，
 *   行底板图 1（亮）也只贴在这一行（WM_PAINT `loc_0041dbe0 cmp ebx, [0x48be4c]`）。
 * - `pressed` = 原版 `[0x48be54]`：`WM_LBUTTONDOWN` 那一刻按在哪颗控件上；`WM_LBUTTONUP`
 *   **只认它、不再看抬手的坐标**（`loc_0041e0b1` 直接按 `[0x48be54] − 2` 查跳表 `0x41dd7d`），
 *   处理完清 0（`0x0041e2af`）。
 */
export interface AiSettingsModel {
  rows: AiSettingRow[];
  sel: number;
  pressed: AiSettingsHit | null;
}

/** 这一行本机能不能改 —— 单机/热座恒真；联机只有本机座位那一行（见 `main.ts` 的 `aiCanEdit`）*/
export type AiRowEditable = (row: AiSettingRow) => boolean;

/**
 * 开屏时选中哪一行。
 *
 * @source 入口 `0x0041e5b3..0x0041e5be`：逐位真人建行时 `if (i == [0x49910c]) [0x48be4c] = 行号` ——
 *   即**轮到的那位**（联机里本机能动的只有自己那一座，调用方传 `net.seat`）。
 *   ⚠️ `[0x48be4c]` **不在** `memset(0x48be34, 0, 0x18)` 的范围里（0x48be34 + 0x18 = 0x48be4c，恰好不含），
 *   所以轮到的不是真人时它保留**上一次开屏**的值 —— 这里照样沿用 `prev`；越界（行数变少了）才退回 0。
 */
export function aiInitialSelection(rows: readonly AiSettingRow[], seat: number | null, prev: number): number {
  const i = seat === null ? -1 : rows.findIndex((r) => r.player === seat);
  if (i >= 0) return i;
  return prev >= 0 && prev < rows.length ? prev : 0;
}

/** 开屏：抄草稿、定选中行、清按下 */
export function openAiSettingsModel(state: GameState, seat: number | null, prev: number): AiSettingsModel {
  const rows = aiSettingsDraft(state);
  return { rows, sel: aiInitialSelection(rows, seat, prev), pressed: null };
}

/**
 * `WM_LBUTTONDOWN`（以及 `WM_LBUTTONDBLCLK` 0x203，同一支 `loc_0041de95`）。
 *
 * ★ 点在**玩家行**上 —— 按下这一拍就生效：
 * ```asm
 * 0041dee5  cmp edx, [0x48be4c] / jne 0x41def4   ; 点的不是已选中那一行 ⇒ 只选中
 * 0041deed  xor byte [行 + 0x48be35], 4           ; ★ 已选中那一行 ⇒ 翻托管位
 * 0041def4  mov [0x48be4c], edx                   ; 选中它
 * 0041defa  mov byte [0x48be54], 1                ; 记「按在行上」（抬手那一支对 1 什么都不做）
 * ```
 * ★ 点在**滑槽**上（控件号 13/14）按下就改值（`0x0041e09a → loc_0041de44`），按住拖也跟着改（见 `aiSettingsDrag`）。
 * ★ 其余控件（五个选项、四颗箭头、確定/取消）按下**只记账**，抬手才动作（见 `aiSettingsUp`）。
 *
 * @param editable 联机时别人座位那一行：**照样能选中**（看他的设置），但不翻、不改
 */
export function aiSettingsDown(
  m: AiSettingsModel,
  hit: AiSettingsHit | null,
  editable: AiRowEditable = () => true,
): AiSettingsModel {
  if (hit === null) return { ...m, pressed: null };
  if (hit.kind === 'row') {
    const row = m.rows[hit.row];
    if (row === undefined) return { ...m, pressed: null };
    const rows =
      hit.row === m.sel && editable(row) ? applyAiSettingsHit(m.rows, { kind: 'autopilot', row: hit.row }) : m.rows;
    return { rows, sel: hit.row, pressed: hit };
  }
  if (hit.kind === 'ratio') {
    const row = m.rows[hit.row];
    const rows = row !== undefined && editable(row) ? applyAiSettingsHit(m.rows, hit) : m.rows;
    return { ...m, rows, pressed: hit };
  }
  return { ...m, pressed: hit };
}

/**
 * `WM_MOUSEMOVE`：按在滑槽上没松手 ⇒ 按 x 跟着改（`loc_0041de2e`：`[0x48be54]` 是 13/14 才做）。
 *
 * ⚠️ 原版这里**不夹紧**（拖出槽外 `(x − 310) / 8 × 10` 会写出负数或 > 100 的字节）；
 *   本引擎照 `ratioFromX` 夹在 0..100 —— 引擎的 `setAi` 本来就拒越界值，照抄只会让「確定」整条被拒。
 */
export function aiSettingsDrag(
  m: AiSettingsModel,
  local: { x: number; y: number },
  editable: AiRowEditable = () => true,
): AiSettingsModel {
  const p = m.pressed;
  if (p === null || p.kind !== 'ratio') return m;
  const row = m.rows[p.row];
  if (row === undefined || !editable(row)) return m;
  const value = ratioFromX(local.x, AI_SLIDERS[p.which]);
  const cur = p.which === 'cash' ? row.cashRatio : row.stockRatio;
  if (value === cur) return m;
  return { ...m, rows: applyAiSettingsHit(m.rows, { ...p, value }) };
}

/**
 * `WM_LBUTTONUP`：照**按下时记下的**控件动作（不看抬手的坐标），然后清掉。
 *
 * @source `loc_0041e0b1`：`[0x48be54]` 为 0 ⇒ 什么都不做；否则 `−2` 查跳表 `0x41dd7d`
 *   （2 卡片 / 3 道具 / 4..6 個性 / 7..10 箭头 / 11 確定 / 12 取消），越界（1 = 行、13/14 = 滑槽）
 *   只重画 + 清 0（`loc_0041e2a8`）。確定 = 把暂存表拷回玩家（`0x0041e234..0x0041e295`）再
 *   `PostMessage(0x205)` 关窗；取消 = 直接 `PostMessage(0x205)`。
 *
 * @returns `close`：`'ok'` / `'cancel'` = 该关屏了（前者要提交草稿）
 */
export function aiSettingsUp(
  m: AiSettingsModel,
  editable: AiRowEditable = () => true,
): { model: AiSettingsModel; close: 'ok' | 'cancel' | null } {
  const p = m.pressed;
  const cleared: AiSettingsModel = { ...m, pressed: null };
  if (p === null) return { model: cleared, close: null };
  switch (p.kind) {
    case 'ok':
      return { model: cleared, close: 'ok' };
    case 'cancel':
      return { model: cleared, close: 'cancel' };
    case 'ability':
    case 'personality':
    case 'ratioStep': {
      const row = m.rows[p.row];
      if (row === undefined || !editable(row)) return { model: cleared, close: null };
      return { model: { ...cleared, rows: applyAiSettingsHit(m.rows, p) }, close: null };
    }
    default:
      // 行（1）与滑槽（13/14）在按下 / 拖动时就办完了
      return { model: cleared, close: null };
  }
}

/**
 * 「確定」要发的 action：草稿里**变过、且本机能改**的每一行一条 `setAi`。
 *
 * @source 確定 `0x0041e234..0x0041e295`：逐行把暂存表拷回玩家结构（引擎这边按玩家给 action）；
 *   没变过的行不发，免得往 `history` 里塞空动作、联机时白占序号。
 */
export function aiCommitActions(
  rows: readonly AiSettingRow[],
  players: readonly Player[],
  editable: AiRowEditable = () => true,
): Action[] {
  const out: Action[] = [];
  for (const row of rows) {
    const p = players[row.player];
    if (p === undefined || rowMatchesPlayer(row, p) || !editable(row)) continue;
    out.push({
      type: 'setAi',
      player: row.player,
      whoPlays: row.whoPlays,
      aiFlags: row.aiFlags,
      personality: row.personality,
      cashRatio: row.cashRatio,
      stockRatio: row.stockRatio,
    });
  }
  return out;
}

// ============================================================
//  绘制
// ============================================================

export type SpriteFn = (archive: ArchiveName, resource: number, index: number) => Sprite | null;

const FONT = FONT_FAMILY;

/**
 * 画一帧。
 *
 * @param rows 草稿（可编辑的真人座位）
 * @param state 当前状态（取头像用）
 * @param hot 当前悬停的命中项
 */
export function drawAiSettings(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  rows: readonly AiSettingRow[],
  hot: AiSettingsHit | null,
  sprite: SpriteFn,
  selected?: number,
): void {
  // 选中的那一行（原版 `[0x48be4c]`）；没给就按「轮到的玩家那一行」（开屏时的初值，见 `aiInitialSelection`）
  const sel = selected ?? Math.max(0, rows.findIndex((r) => r.player === state.currentPlayer));
  const selRow = rows[sel];
  const ox = AI_ORIGIN.x;
  const oy = AI_ORIGIN.y;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.textBaseline = 'top';

  // 底图（含标题条、五个暗色选项底板、五个暗圆点、两条滑槽与箭头、两颗按钮面）
  const bg = sprite(AI_ARCHIVE, AI_RESOURCE, AI_BG);
  if (bg !== null) drawSprite(ctx, bg, 0, 0);

  const dotOn = sprite(AI_ARCHIVE, AI_RESOURCE, AI_DOT);

  // 五个选项：底图里那排暗圆点就是「关」，图 3 那颗亮的是「开」——
  // **不换底板**（先前拿图 2 去盖一行底色，是把「玩家行底板」当成「选项行底板」用了）。
  // ★ 只画**选中那一行**的（WM_PAINT `0x0041dc7b..0x0041dd26` 全以 `[0x48be4c]` 取行）——
  //   先前把每一行的圆点叠画在同一组位置上，两位真人时互相串味。
  if (dotOn !== null && selRow !== undefined) {
    rowFlags(selRow).forEach((on, k) => {
      if (!on) return;
      drawSprite(
        ctx,
        dotOn,
        AI_DOT_X - (dotOn.width >> 1),
        AI_DOT_AT[k]! - (dotOn.height >> 1),
      );
    });
  }

  // 文字：字号取自反汇编（大字 0x14=20、小字 0x10=16），对齐全按 AI_TEXT 的标志走
  ctx.fillStyle = FILL;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.font = `20px ${FONT}`;
  label(ctx, AI_LABELS.title, AI_TEXT.title);
  if (rows[0] !== undefined) label(ctx, AI_LABELS.personality, AI_TEXT.personality);
  label(ctx, AI_LABELS.ratios, AI_TEXT.ratios);

  ctx.font = `16px ${FONT}`;
  label(ctx, AI_LABELS.useCards, AI_TEXT.useCards);
  label(ctx, AI_LABELS.useTools, AI_TEXT.useTools);
  label(ctx, AI_LABELS.goodBoy, AI_TEXT.goodBoy);
  label(ctx, AI_LABELS.normal, AI_TEXT.normal);
  label(ctx, AI_LABELS.villain, AI_TEXT.villain);

  // 比例：两侧标签 + 滑槽里的**分段填充** —— 选中那一行的（`fcn_0041da61` 同样按 `[0x48be4c]` 取）
  const cash = selRow?.cashRatio ?? 0;
  const stock = selRow?.stockRatio ?? 0;
  label(ctx, AI_LABELS.cash, AI_TEXT.cash);
  label(ctx, AI_LABELS.deposit, AI_TEXT.deposit);
  label(ctx, AI_LABELS.stock, AI_TEXT.stock);
  label(ctx, AI_LABELS.fund, AI_TEXT.fund);

  // ★ 只填、不写数字 —— 原版这一屏**没有百分比文字**，它靠格数表达。
  fillRatio(ctx, AI_SLIDERS.cash, cash);
  fillRatio(ctx, AI_SLIDERS.stock, stock);

  // 竖排的確定/取消 —— ★ **黑字、无描边**，与上面那些白字黑边**不是同一套颜色**。
  //   @source `set_font(0x14, 0x101010, 0, 2, 1)`：前景 0x101010、描边 0。
  //   先前一律按白字画，需求方 2026-09-15 报「确认/取消的按钮字体颜色不对」。
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = OK_CANCEL_FILL;
  ctx.strokeStyle = OK_CANCEL_FILL;
  label(ctx, AI_LABELS.ok, AI_TEXT.ok);
  label(ctx, AI_LABELS.cancel, AI_TEXT.cancel);
  ctx.strokeStyle = OUTLINE;

  // 每位真人一行：底板 + 头像 + 点亮的圆点。
  // @source `_rich4_ui_ai_settings_entry` VA 0x0041e61c 那两句 blit；
  //   「选中行」= `[0x48be4c]`（开屏初值见 `aiInitialSelection`，之后随点行改）。
  rows.forEach((row, n) => {
    const ry = rowY(n);
    // ① 行底板：图 1 = 当前行（亮）、图 2 = 其余。锚点是 (0,0)，直接落点
    const plate = sprite(
      AI_ARCHIVE, AI_RESOURCE,
      n === sel ? AI_ROW_ON : AI_ROW_OFF,
    );
    if (plate !== null) drawSprite(ctx, plate, AI_PLATE_X, ry);

    // ② 圆点：托管开着才点亮（底板里那颗暗点已经烤在图上）
    if (dotOn !== null && (row.whoPlays & WHO_PLAYS_AUTOPILOT) !== 0) {
      drawSprite(ctx, dotOn, AI_LED_AT.x, ry + AI_LED_AT.dy);
    }

    // ③ 头像：图 `6 + character`，画在 (80, y+40) —— ★ **要减锚点**
    const p = state.players[row.player];
    if (p === undefined) return;
    const portrait = sprite(AI_ARCHIVE, AI_RESOURCE, AI_PORTRAIT_BASE + p.character);
    if (portrait !== null) {
      drawSprite(
        ctx,
        portrait,
        AI_PORTRAIT_AT.x - portrait.anchorX,
        ry + AI_PORTRAIT_AT.dy - portrait.anchorY,
      );
    }
  });

  // 悬停高亮
  if (hot !== null && hot.kind !== 'ok' && hot.kind !== 'cancel') {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    const r = hotRect(hot);
    if (r !== null) ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  ctx.restore();
}

/** 五个选项当前是亮是暗：[使用卡片, 使用道具, 乖寶寶, 普通人, 大老奸] */
export function rowFlags(row: AiSettingRow): boolean[] {
  return [
    (row.aiFlags & 1) !== 0,
    (row.aiFlags & 2) !== 0,
    row.personality === 0,
    row.personality === 1,
    row.personality === 2,
  ];
}

function hotRect(hit: AiSettingsHit): { x: number; y: number; w: number; h: number } | null {
  switch (hit.kind) {
    case 'row':
    case 'autopilot':
      return { x: AI_PLATE_X, y: rowY(hit.row), w: 116, h: AI_ROW_PITCH };
    case 'ability':
      return AI_OPTION_ROWS[hit.bit]!;
    case 'personality':
      return AI_OPTION_ROWS[2 + hit.value]!;
    case 'ratio':
      return hit.which === 'cash' ? AI_SLIDERS.cash : AI_SLIDERS.stock;
    case 'ratioStep':
      return AI_ARROWS[hit.which].find((a) => a.delta === hit.delta) ?? null;
    default:
      return null;
  }
}

/**
 * 比例条：**一格一格地填红色方块**，不是一条连续色条。
 *
 * @source `fcn_0041da61`：`格数 = [比例 / 10]`，第 k 格画在 `(209 + 8k, 266|299)`、7×22、纯红。
 */
function fillRatio(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  percent: number,
): void {
  const cells = Math.floor(Math.max(0, Math.min(100, percent)) / AI_RATIO_STEP);
  if (cells <= 0) return;
  ctx.fillStyle = AI_SEG.color;
  for (let k = 0; k < cells; k++) {
    ctx.fillRect(AI_SEG.dx + k * AI_SEG.pitch, r.y + AI_SEG.dy, AI_SEG.w, AI_SEG.h);
  }
}

/** 普通文字：白字 + 黑描边 @source `set_font(0x14, 0xf0f0f0, 0x101010, 3, 1)` */
const FILL = '#f0f0f0';
const OUTLINE = '#101010';
/** 確定/取消：**黑字、无描边** @source `set_font(0x14, 0x101010, 0, 2, 1)` */
const OK_CANCEL_FILL = '#101010';

/**
 * 按 `align` 画一条文字。
 *
 * ★ `at.x` / `at.y` 是**文字块的中心**（反汇编的坐标语义如此，见 `AI_TEXT` 的注释），
 *   所以基线一律取 `middle`，水平按标志取 left/center/right。
 */
function label(ctx: CanvasRenderingContext2D, s: string, at: AiTextAt): void {
  if (at.align === 3) {
    verticalText(ctx, s, at);
    return;
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = at.align === 5 ? 'left' : at.align === 6 ? 'right' : 'center';
  // ★ 原版的字体带一层描边（`set_font` 的第 3 参 0x101010）——
  //   白字直接落在绿底上会比原版「糊」一圈。先描边再填字。
  if (ctx.strokeStyle !== ctx.fillStyle) ctx.strokeText(s, at.x, at.y);
  ctx.fillText(s, at.x, at.y);
  ctx.textAlign = 'left';
}

/**
 * 竖排：`at.x` 是**列的水平中心**，`at.y` 是**整列的垂直中心**。
 *
 * 字距 25 是照实机截能量出来的：`確定` 两字在图上跨 320..420 像素，除以该截图的
 * 1.975 倍缩放得 50.6 逻辑像素，即每字 25。
 */
const VERTICAL_ADVANCE = 25;

function verticalText(ctx: CanvasRenderingContext2D, s: string, at: AiTextAt): void {
  const n = s.length;
  const top = at.y - ((n - 1) * VERTICAL_ADVANCE) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) ctx.fillText(s[i]!, at.x, top + i * VERTICAL_ADVANCE);
  ctx.textAlign = 'left';
}
