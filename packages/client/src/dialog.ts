/*
 * 待决交互的画法 —— 画在棋盘上，不是 HTML
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：这里**一条规则都没有**。它拿 `interactions.ts` 翻好的
 *   `InteractionUi`（标题、说明、几个选项），把它摆成一块对话框，
 *   再把点中的那一项原样交回去。
 *
 * ★ 位置照原版。通用询问框 VA 0x00440ba8：
 * ```asm
 * 00440bc9  rect = { 0, 0x28, 0x1b8, 0x1e0 }     ; (0, 40, 440, 480) —— 棋盘那一栏
 * 00440be7  call 0x451e7e(&rect)                 ; 在这块区域上开对话框
 * 00440c0f  call 0x456418(字体, skin+0x48, 0xdc, 0x8c)   ; 框画在 (220, 140)
 * 00440c33  call 0x44fabc(0, 文字, 0xdc, 0x8c, 4)        ; 文字同点，对齐码 4
 * ```
 * `0x1b8 = 440`、`0x1e0 = 480`、`0x28 = 40` —— 这是 640×480 定屏的**第四条**
 * 独立证据（另三条：工具栏底条 439×40、`Panel.mkf` 资源 66 的 440×480
 * 「NEWS」遮罩、設定對話框 `x0 = 0x140 − w/2`）。
 *
 * ⚠️ 框本身那张图没认出来：`0x456418` 画的是 `[0x48bad8] + 0x48`，那是一份
 *   界面皮肤结构，要跟到它的初始化才知道是哪张位图。故**框是我们自己画的**，
 *   只有位置是原版的。记作 Q-UI-2。
 */

import type { InteractionUi } from './interactions.ts';
import {
  DIALOG_ANCHOR_SCREEN,
  DIALOG_SKIN_IMAGE,
  DIALOG_SKIN_RESOURCE,
  DICE_RESOURCE,
  DICE_TOGGLE_AT,
  DICE_TOGGLE_IMAGE,
  DICE_TOGGLE_SIZE,
  GO_DEFAULT,
  GO_RESOURCE,
  GO_SIZE,
  YESNO_IMAGE,
  YESNO_RESOURCE,
  YESNO_CENTER_SCREEN,
  YESNO_SIZE,
  boardRect,
  diceImage,
  inRect,
  toBoard,
  yesNoHalves,
  type Rect,
  type SpriteFn,
} from './gameui.ts';
import { LAYOUT } from './stage.ts';

/** 框心（棋盘区坐标）—— 由屏幕坐标换算，见 gameui.ts */
export const DIALOG_ANCHOR = toBoard(DIALOG_ANCHOR_SCREEN);

/**
 * 訊息框在屏幕上的位置 —— 由锚点倒推。
 * @source VA 0x004191df：`x0 = 0xdc − 图5.anchorX`、`y0 = 0x8c − 图5.anchorY`。
 * 图 5 是 249×170、锚点 (123,101)，于是框占 (97,39)-(346,209)。
 */
export const BOX_SCREEN: Rect = { x: 0xdc - 123, y: 0x8c - 101, w: 249, h: 170 };

/**
 * 框内可写字的那一块（相对框左上角）。
 *
 * ⚠️ 是**照解出来的位图量的**：在图 5 上横切竖切，看颜色跳变——
 *   平坦的棕色内场是 x 12..230、y 41..160（上面那圈金边与顶部的王冠饰件
 *   占掉 y 0..40）。原版把字排在哪由绘制代码决定，那段没定位。
 */
const INNER = { dx: 12, dy: 41, w: 219, h: 120 } as const;

const LINE_H = 20;
const TITLE_H = 24;
const BTN_H = 24;
const BTN_GAP = 5;
const BTN_MIN_W = 56;

const FONT_TITLE = 'bold 16px "PingFang TC", "Microsoft JhengHei", sans-serif';
const FONT_BODY = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';


// ============================================================
//  GO 鈕、骰子数切换、骰子
// ============================================================

/**
 * 「GO」鈕 —— 轮到人、还没掷骰时画在棋盘上。
 *
 * ★ 这是**原版的按钮**，不是我们加的：`Panel.mkf` 资源 7 图 0/1（72×67 的
 *   黄底 GO 牌子），默认位置 (180,120)，原版还允许拖着它走。下方那三对
 *   15×15 的小骰子是**骰子数切换**（1/2/3 颗，对应走路/機車/汽車）。
 *   全部常量与出处见 `gameui.ts`。
 *
 * ⚠️ 原版的「拖动」没做：位置固定在默认值上。
 */
export function hitAdvance(x: number, y: number): boolean {
  return inRect(x, y, boardRect({ ...GO_DEFAULT, ...GO_SIZE }));
}

/** 骰子数切换钮的第 i 个（棋盘区坐标） */
export function diceToggleRect(i: number): Rect {
  return boardRect({
    x: GO_DEFAULT.x + DICE_TOGGLE_AT.dx,
    y: GO_DEFAULT.y + DICE_TOGGLE_AT.dy + i * DICE_TOGGLE_AT.pitch,
    ...DICE_TOGGLE_SIZE,
  });
}

/** 点在第几颗骰子的切换钮上（返回颗数 1..maxDice）；没点中返回 null */
export function hitDiceToggle(x: number, y: number, maxDice: number): number | null {
  for (let i = 0; i < maxDice; i++) {
    if (inRect(x, y, diceToggleRect(i))) return i + 1;
  }
  return null;
}

/**
 * 画 GO 鈕与骰子数切换。
 *
 * ★ GO 鈕的图号 = **组 + 帧**（`[0x48bdd4] + ebx`，@source VA 0x004172b9）：
 * - 组：`[player+0x38]`（停留）非 0 → **2 禁止通行**；`[player+0x39]`（烏龜）非 0
 *   → **4 烏龜**；否则 **0 普通**。两项都为非 0 时烏龜优先（原版后写的覆盖前面的）。
 * - 帧：`[0x48bdd4]`，由 **500 ms 的窗口定时器**翻转
 *   （`SetTimer(hwnd, 0x1f4=500, …)` @source VA 0x0041801e；翻转在 WM_TIMER
 *   处理里 VA 0x00418b7e `xor byte [0x48bdd4], 1`）。
 *   ⇒ **不点它也在闪**，一暗一亮。
 *
 * ⚠️ 原版**没有**鼠标悬停效果（棋盘窗口过程的 WM_MOUSEMOVE 只处理侧栏/工具栏），
 *   先前我们用悬停换图，那是自己加的，已去掉。
 *
 * @param goImage 上面算好的图号（`GO_IMAGE` 的某个值 + 闪烁帧）
 * @param maxDice 这个玩家最多能掷几颗（走路 1、機車 2、汽車 3）
 * @param ndices  当前选了几颗
 */
export function drawAdvance(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFn,
  goImage: number,
  maxDice: number,
  ndices: number,
): void {
  const at = toBoard(GO_DEFAULT);
  const go = sprite('Panel.mkf', GO_RESOURCE, goImage, true);
  if (go !== null) ctx.drawImage(go.bitmap, at.x, at.y);

  for (let i = 0; i < maxDice; i++) {
    const pair = DICE_TOGGLE_IMAGE[i];
    if (pair === undefined) continue;
    // 亮的那张表示「这一颗算数」
    const img = sprite('Panel.mkf', GO_RESOURCE, i < ndices ? pair[1] : pair[0], true);
    if (img === null) continue;
    const r = diceToggleRect(i);
    ctx.drawImage(img.bitmap, r.x, r.y);
  }
}

/**
 * 画已掷出的骰子 —— 原版是 `Panel.mkf` 资源 3，三颗各六面，
 * 图号 = `颗号 × 6 + 点数 − 1`（@source VA 0x0041965e）。
 *
 * ⚠️ **摆在哪是我们定的**：原版那段（VA 0x00419653）把三颗都画在
 *   `(edi + 0x55, ebp + 0x91)`，而 `edi/ebp` 来自一块没跟到的临时面板。
 *   这里摆在 GO 鈕右边，竖着排。
 */
export function drawDice(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFn,
  dice: readonly number[],
): void {
  const at = toBoard({ x: GO_DEFAULT.x + GO_SIZE.w + 8, y: GO_DEFAULT.y });
  let y = at.y;
  for (let i = 0; i < dice.length; i++) {
    const img = sprite('Panel.mkf', DICE_RESOURCE, diceImage(i, dice[i] ?? 1), true);
    if (img === null) continue;
    ctx.drawImage(img.bitmap, at.x, y);
    y += img.height + 4;
  }
}

/** 一次点击可能落在哪 */
export type DialogHit =
  | { kind: 'choice'; index: number }
  | { kind: 'amountStep'; delta: number }
  | { kind: 'amountMax' }
  | { kind: 'amountOk' }
  | { kind: 'amountCancel' };

/** 正在填数的那一页；`null` 表示还在选项页 */
export interface AmountPage {
  choice: number;
  value: number;
}



interface Layout {
  /** 訊息框整块（棋盘区坐标） */
  box: Rect;
  /** 框内可写字的那一块 */
  inner: Rect;
  title: string;
  lines: string[];
  /** 按钮是不是原版的 YES/NO 控件 */
  yesNo: boolean;
  buttons: { label: string; rect: Rect; hit: DialogHit }[];
}

/** 按框宽折行；原版自己那几段 `\n\n` 先照分 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line !== '') {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * 算出这一帧对话框的版式。
 *
 * 绘制与命中判定**共用**它 —— 两边各算一遍迟早对不上，而且错法特别难看出来
 * （按钮看得见却点不中）。
 *
 * ★ 两个选项时用原版的 YES/NO 控件（`Data.mkf` 资源 440，96×48，居中在
 *   屏幕 (220,320)）。三个以上时原版走的是各自的专屏（銀行柜台、百貨公司、
 *   股市…），那些还没做，故先在框下面排一列普通按钮 —— 这一部分是**我们的**。
 */
export function layoutDialog(
  ctx: CanvasRenderingContext2D,
  ui: InteractionUi,
  page: AmountPage | null,
): Layout {
  ctx.font = FONT_BODY;
  const box = boardRect(BOX_SCREEN);
  const inner: Rect = {
    x: box.x + INNER.dx,
    y: box.y + INNER.dy,
    w: INNER.w,
    h: INNER.h,
  };

  const choice = page === null ? null : ui.choices[page.choice];
  const amount = choice?.amount;
  const detail =
    page !== null && amount !== undefined
      ? `${amount.label}\n${page.value.toLocaleString('en-US')}\n（上限 ${amount.max.toLocaleString('en-US')}）`
      : ui.detail;
  const lines = wrap(ctx, detail, inner.w);

  const labels: { label: string; hit: DialogHit }[] =
    page !== null && amount !== undefined
      ? [
          { label: `− ${amount.step}`, hit: { kind: 'amountStep', delta: -amount.step } },
          { label: `+ ${amount.step}`, hit: { kind: 'amountStep', delta: amount.step } },
          { label: '最大', hit: { kind: 'amountMax' } },
          { label: '確定', hit: { kind: 'amountOk' } },
          { label: '取消', hit: { kind: 'amountCancel' } },
        ]
      : ui.choices.map((c, i) => ({ label: c.label, hit: { kind: 'choice' as const, index: i } }));

  // ——— 两个选项 → 原版的 YES/NO ———
  const useYesNo = page === null && ui.choices.length === 2;
  if (useYesNo) {
    const halves = yesNoHalves();
    return {
      box,
      inner,
      title: ui.title,
      lines,
      yesNo: true,
      buttons: [
        { label: 'YES', rect: boardRect(halves.yes), hit: { kind: 'choice', index: 0 } },
        { label: 'NO', rect: boardRect(halves.no), hit: { kind: 'choice', index: 1 } },
      ],
    };
  }

  // ——— 其余：框下面排一列按钮（⚠️ 我们的做法，不是原版）———
  ctx.font = FONT_BODY;
  const widths = labels.map((l) => Math.max(BTN_MIN_W, Math.ceil(ctx.measureText(l.label).width) + 18));
  const rowW = box.w;
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (let i = 0; i < labels.length; i++) {
    const w = widths[i]!;
    if (row.length > 0 && used + BTN_GAP + w > rowW) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(i);
    used += (row.length > 1 ? BTN_GAP : 0) + w;
  }
  if (row.length > 0) rows.push(row);

  const buttons: Layout['buttons'] = [];
  let by = box.y + box.h + 4;
  for (const r of rows) {
    const total = r.reduce((sum, i) => sum + widths[i]!, 0) + (r.length - 1) * BTN_GAP;
    let bx = box.x + Math.round((rowW - total) / 2);
    for (const i of r) {
      buttons.push({
        label: labels[i]!.label,
        rect: { x: bx, y: by, w: widths[i]!, h: BTN_H },
        hit: labels[i]!.hit,
      });
      bx += widths[i]! + BTN_GAP;
    }
    by += BTN_H + BTN_GAP;
  }
  // 排不下就整体上移，别掉出棋盘
  const overflow = by - LAYOUT.board.h + 4;
  if (overflow > 0) for (const b of buttons) b.rect.y -= overflow;

  return { box, inner, title: ui.title, lines, yesNo: false, buttons };
}

/** 棋盘区坐标 → 点中了什么 */
export function hitDialog(
  ctx: CanvasRenderingContext2D,
  ui: InteractionUi,
  page: AmountPage | null,
  x: number,
  y: number,
): DialogHit | 'inside' | null {
  const l = layoutDialog(ctx, ui, page);
  for (const b of l.buttons) if (inRect(x, y, b.rect)) return b.hit;
  // ★ 落在框上但没中按钮：也要**吃掉**这一次点击，否则会穿透到棋盘上
  //   去选格子 —— 那正是「点了个按钮结果棋子动了」这类怪事的来源。
  return inRect(x, y, l.box) ? 'inside' : null;
}

/** 画在**棋盘区**的画布上（坐标即棋盘区坐标） */
export function drawDialog(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFn,
  ui: InteractionUi,
  page: AmountPage | null,
  hot: DialogHit | null,
): void {
  const l = layoutDialog(ctx, ui, page);
  ctx.save();

  // ——— 框：原版的 Data.mkf 资源 517 图 5 ———
  const skin = sprite('Data.mkf', DIALOG_SKIN_RESOURCE, DIALOG_SKIN_IMAGE, true);
  if (skin !== null) {
    ctx.drawImage(skin.bitmap, l.box.x, l.box.y);
  } else {
    ctx.fillStyle = '#6b4a21';
    ctx.fillRect(l.box.x, l.box.y, l.box.w, l.box.h);
  }

  // ——— 文字 ———
  const cx = l.inner.x + l.inner.w / 2;
  let y = l.inner.y + 4;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // 金框上的字要够亮，且描一圈黑边才压得住底纹
  const line = (text: string, font: string, fill: string): void => {
    ctx.font = font;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, cx, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, cx, y);
  };
  if (l.title !== '') {
    line(l.title, FONT_TITLE, '#ffe8a5');
    y += TITLE_H;
  }
  for (const t of l.lines) {
    line(t, FONT_BODY, '#fff6e0');
    y += LINE_H;
  }

  // ——— 按钮 ———
  if (l.yesNo) {
    // 原版控件：整块一张图，哪半亮由图号决定
    const which =
      hot?.kind === 'choice' && hot.index === 0
        ? YESNO_IMAGE.yes
        : hot?.kind === 'choice' && hot.index === 1
          ? YESNO_IMAGE.no
          : YESNO_IMAGE.none;
    const img = sprite('Data.mkf', YESNO_RESOURCE, which, true);
    const at = boardRect({
      x: YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2,
      y: YESNO_CENTER_SCREEN.y - YESNO_SIZE.h / 2,
      ...YESNO_SIZE,
    });
    if (img !== null) ctx.drawImage(img.bitmap, at.x, at.y);
  } else {
    for (const b of l.buttons) {
      const on = hot !== null && JSON.stringify(hot) === JSON.stringify(b.hit);
      ctx.fillStyle = on ? '#e8d24a' : '#c6a56b';
      ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      ctx.strokeStyle = '#4a3110';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.rect.x + 0.5, b.rect.y + 0.5, b.rect.w - 1, b.rect.h - 1);
      ctx.fillStyle = '#2a1d0e';
      ctx.font = FONT_BODY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2 + 1);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
