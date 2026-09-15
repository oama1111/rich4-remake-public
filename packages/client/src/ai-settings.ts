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
 * | 1 | 116×86 | 选项行底色·**亮**（选中/可用）|
 * | 2 | 116×86 | 选项行底色·**暗** —— 实测就是图 1 整体压暗约六成 |
 * | 3 | 15×15 | 圆点单图 |
 * | 4 / 5 | 9×20 | 滑槽两端的箭头 |
 * | 6..17 | 各约 70×70 | **12 个角色的头像**（与開局设置的 12 张同序）|
 *
 * 文字坐标全部来自反汇编（VA 0x0041e37d 起），且与底图上的图形**逐项吻合**：
 * 圆点在 x=193、文字中心在 x=244（居中对齐），两者的 y 最多差 2 像素。
 */

import type { GameState, Player } from '@rich4/core';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';

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
/** 居中于 640×480 —— 与 `options.ts` 同一条约定（VA 0x00411dac） */
export const AI_ORIGIN = { x: 320 - (AI_W >> 1), y: 240 - (AI_H >> 1) } as const;

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
 * 五个选项圆点的位置 —— **从底图上量出来的**（找粉红圆点的连通块）：
 * `(193,52) (193,84)` 是「使用卡片 / 使用道具」，`(193,140) (193,172) (193,204)`
 * 是「乖寶寶 / 普通人 / 大老奸」。与上面反汇编的文字 y 逐个对得上（差 ≤1）。
 */
export const AI_DOT_AT = [52, 84, 140, 172, 204] as const;
export const AI_DOT_X = 193;

/** 选项行底色图 116×86 里，圆点在自己的 (18,43)；对齐时按它平移 */
const ROW_IMAGE_DOT = { x: 18, y: 43 } as const;
/** 一行的高度（相邻圆点间距）*/
export const AI_ROW_H = 32;

/**
 * 两颗竖排按钮的矩形。
 *
 * ⚠️ **这两个是推出来的，不是量出来的**：底图右条是颗粒纹理，按颜色切不出干净的
 *   按钮边界。反汇编只给了竖排文字的位置（`確定` y=0x7d=125、`取消` y=0xd5=213），
 *   故按钮取「以文字为中心、宽度撑满右侧粉条（x 365..431）」。
 *   视觉上与原版截图吻合（截图里两颗米色按钮就压在这两处）。
 */
export const AI_BTN_OK = { x: 365, y: 90, w: 66, h: 72 } as const;
export const AI_BTN_CANCEL = { x: 365, y: 178, w: 66, h: 72 } as const;

/**
 * 两条滑槽的矩形。同样**由文字锚点推出**：`現金` 右对齐于 x=191、`存款` 左对齐于
 * x=305，故滑槽落在两者之间；y 取文字基线上下各 10。
 */
export const AI_SLIDERS = {
  cash: { x: 195, y: 267, w: 106, h: 20 },
  stock: { x: 195, y: 300, w: 106, h: 20 },
} as const;

/** 每位可托管玩家一行：LED 在 (8, edi)，头像在 (80, edi+40)，行距 0x53 = 83 @source VA 0x0041e61c */
export const AI_ROW_FIRST_Y = 8;
export const AI_ROW_PITCH = 0x53; // 83
export const AI_LED_AT = { x: 8, dx: 80 } as const;
export const AI_PORTRAIT_DY = 0x28; // 40

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
  /** 托管总开关（左侧那颗 LED）*/
  | { kind: 'autopilot'; row: number }
  /** 会用卡（bit0）/ 会用道具（bit1）*/
  | { kind: 'ability'; row: number; bit: number }
  /** 個性 0/1/2 */
  | { kind: 'personality'; row: number; value: number }
  /** 两条比例滑槽；`value` 由点击的 x 位置换算 */
  | { kind: 'ratio'; row: number; which: 'cash' | 'stock'; value: number }
  | { kind: 'ok' }
  | { kind: 'cancel' };

const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/**
 * 滑槽上点在 x 处的值（0..100，百分比）。
 *
 * ★ 除的是 `w - 1` 而不是 `w`：滑槽占的像素是 `x .. x+w-1`（命中区是半开区间），
 *   除以 `w` 的话最右那一格只到 99%，**拖到底也调不出 100%** —— 而「全存银行」
 *   恰恰是最常用的那一档。除以 `w-1` 让首尾两格恰好落在 0 与 100。
 */
export function ratioFromX(x: number, r: { x: number; w: number }): number {
  if (r.w <= 1) return 0;
  const t = (x - r.x) / (r.w - 1);
  return Math.max(0, Math.min(100, Math.round(t * 100)));
}

/**
 * 命中测试，坐标是**对话框相对坐标**（调用方先减去 `AI_ORIGIN`）。
 *
 * @param local 已减去 `AI_ORIGIN` 的点
 * @param rows  当前草稿（决定有几行、能点哪里）
 * @param currentPlayer 轮到的玩家下标 —— 底图上只有**一对**滑槽，它编的是
 *   「当前玩家」那一行（原版 `if (i == 当前玩家) [0x48be4c] = n` 就是记这个）。
 */
export function hitAiSettings(
  local: { x: number; y: number },
  rows: readonly AiSettingRow[],
  currentPlayer: number,
): AiSettingsHit | null {
  const { x, y } = local;

  // 按钮：先判，免得被下面的行区抢走
  if (inRect(x, y, AI_BTN_OK)) return { kind: 'ok' };
  if (inRect(x, y, AI_BTN_CANCEL)) return { kind: 'cancel' };

  // 那对滑槽改的是「当前玩家」那一行；他不在可编辑之列（电脑/出局）就退回第一行
  const ratioRow = Math.max(0, rows.findIndex((r) => r.player === currentPlayer));
  if (inRect(x, y, AI_SLIDERS.cash)) {
    return { kind: 'ratio', row: ratioRow, which: 'cash', value: ratioFromX(x, AI_SLIDERS.cash) };
  }
  if (inRect(x, y, AI_SLIDERS.stock)) {
    return { kind: 'ratio', row: ratioRow, which: 'stock', value: ratioFromX(x, AI_SLIDERS.stock) };
  }

  for (let n = 0; n < rows.length; n++) {
    const ry = rowY(n);

    // 托管总开关
    if (inRect(x, y, { x: AI_LED_AT.x, y: ry, w: 15, h: 15 })) return { kind: 'autopilot', row: n };

    // 两个能力圆点：点圆点或它右边的文字都算
    for (let k = 0; k < 2; k++) {
      if (inRect(x, y, { x: AI_DOT_X - 8, y: AI_DOT_AT[k]! - 8, w: 108, h: 16 })) {
        return { kind: 'ability', row: n, bit: k };
      }
    }

    // 三个個性单选
    for (let k = 0; k < 3; k++) {
      if (inRect(x, y, { x: AI_DOT_X - 8, y: AI_DOT_AT[2 + k]! - 8, w: 108, h: 16 })) {
        return { kind: 'personality', row: n, value: k };
      }
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
): void {
  const ox = AI_ORIGIN.x;
  const oy = AI_ORIGIN.y;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.textBaseline = 'top';

  // 底图（含标题条、五个圆点、两条滑槽、两颗按钮面）
  const bg = sprite(AI_ARCHIVE, AI_RESOURCE, AI_BG);
  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);

  // ★ 未选中的项：把「暗」版行图贴上去覆盖底图自带的亮色。
  //   对齐靠**行图内嵌的圆点**：图里圆点在 (18,43)，所以
  //   drawAt = (圆点x − 18, 圆点y − 43)，再按一行的高度裁掉多余部分。
  //   ⚠️ 裁高度这一下是**本项目自己的做法**：原版图是 116×86（够盖一组），
  //   而没有跟到它到底盖一行还是一组。见 known-deviations 的 Q-LAYOUT-1。
  const off = sprite(AI_ARCHIVE, AI_RESOURCE, AI_ROW_OFF);
  if (off !== null) {
    rows.forEach((row) => {
      const flags = rowFlags(row);
      for (let k = 0; k < flags.length; k++) {
        if (flags[k]) continue; // 亮着的不盖
        const dy = AI_DOT_AT[k]!;
        const x = AI_DOT_X - ROW_IMAGE_DOT.x;
        const y = dy - ROW_IMAGE_DOT.y;
        const top = dy - (AI_ROW_H >> 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top, off.width, AI_ROW_H);
        ctx.clip();
        ctx.drawImage(off.bitmap, x, y);
        ctx.restore();
      }
    });
  }

  // 五颗圆点（底图自带，这里再画一次是为了在「暗」版盖过之后仍然看得见状态）
  const dotOn = sprite(AI_ARCHIVE, AI_RESOURCE, AI_DOT);
  if (dotOn !== null) {
    rows.forEach((row) => {
      const flags = rowFlags(row);
      flags.forEach((on, k) => {
        if (!on) return;
        ctx.drawImage(dotOn.bitmap, AI_DOT_X - (dotOn.width >> 1), AI_DOT_AT[k]! - (dotOn.height >> 1));
      });
    });
  }

  // 文字：字号取自反汇编（大字 0x14=20、小字 0x10=16），对齐全按 AI_TEXT 的标志走
  ctx.fillStyle = '#f0f0f0';
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

  // 比例：两侧标签 + 滑槽里的**填充**
  const row0 = rows[0];
  const cash = row0?.cashRatio ?? 0;
  const stock = row0?.stockRatio ?? 0;
  label(ctx, AI_LABELS.cash, AI_TEXT.cash);
  label(ctx, AI_LABELS.deposit, AI_TEXT.deposit);
  label(ctx, AI_LABELS.stock, AI_TEXT.stock);
  label(ctx, AI_LABELS.fund, AI_TEXT.fund);

  // ★ 只填、不写数字 —— 原版这一屏**没有百分比文字**，它靠条子的填充长度表达。
  //   加个「50%」上去看着方便，但那是「改良」，C-FID-1/4 明令禁止。
  fillRatio(ctx, AI_SLIDERS.cash, cash);
  fillRatio(ctx, AI_SLIDERS.stock, stock);

  // 竖排的確定/取消
  ctx.font = `20px ${FONT}`;
  label(ctx, AI_LABELS.ok, AI_TEXT.ok);
  label(ctx, AI_LABELS.cancel, AI_TEXT.cancel);

  // 每位真人一行：LED + 头像 + 名字
  ctx.font = `15px ${FONT}`;
  rows.forEach((row, n) => {
    const ry = rowY(n);
    // LED：托管中点亮
    if (dotOn !== null && (row.whoPlays & WHO_PLAYS_AUTOPILOT) !== 0) {
      ctx.drawImage(dotOn.bitmap, AI_LED_AT.x, ry);
    }
    const p = state.players[row.player];
    if (p === undefined) return;
    // 头像取自**同一张对话框资源**里的 12 张（图 6..17，与開局设置的 12 张同序）——
    // @source VA 0x0041e634 `add_widget(... x=0x50, y=edi+0x28, 图号由 character 算出)`
    const portrait = sprite(AI_ARCHIVE, AI_RESOURCE, AI_PORTRAIT_BASE + p.character);
    if (portrait !== null) {
      ctx.drawImage(portrait.bitmap, AI_LED_AT.dx, ry + AI_PORTRAIT_DY);
    }
    ctx.fillStyle = '#f0e6d2';
    const name = CHARACTERS[p.character]?.name ?? `${row.player + 1} 號`;
    ctx.fillText(name, AI_LED_AT.dx + 74, ry + AI_PORTRAIT_DY + 20);
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
    case 'autopilot':
      return { x: AI_LED_AT.x, y: rowY(hit.row), w: 15, h: 15 };
    case 'ability':
      return { x: AI_DOT_X - 8, y: AI_DOT_AT[hit.bit]! - 8, w: 108, h: 16 };
    case 'personality':
      return { x: AI_DOT_X - 8, y: AI_DOT_AT[2 + hit.value]! - 8, w: 108, h: 16 };
    case 'ratio':
      return hit.which === 'cash' ? AI_SLIDERS.cash : AI_SLIDERS.stock;
    default:
      return null;
  }
}

/** 滑槽里按百分比填一格亮色条（原版没有数字，只有填充长度）*/
function fillRatio(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, percent: number): void {
  const inner = { x: r.x + FILL_INSET, y: r.y + FILL_INSET, w: r.w - FILL_INSET * 2, h: r.h - FILL_INSET * 2 };
  const filled = Math.round((inner.w * Math.max(0, Math.min(100, percent))) / 100);
  if (filled <= 0) return;
  ctx.fillStyle = FILL_COLOR;
  ctx.fillRect(inner.x, inner.y, filled, inner.h);
}

/** 填充条相对滑槽四周留的空，免得盖住底图描边 */
const FILL_INSET = 4;
/** 填充色：比底图的深绿亮一档，在截图尺寸下能一眼看出长度 */
const FILL_COLOR = '#8fd45a';

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
