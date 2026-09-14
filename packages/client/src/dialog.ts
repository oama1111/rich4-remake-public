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
import { LAYOUT } from './stage.ts';

/** 框心 —— 棋盘区内的坐标 @source VA 0x00440c0f `push 0x8c / push 0xdc` */
export const DIALOG_ANCHOR = { x: 0xdc, y: 0x8c } as const;

const PAD = 14;
const LINE_H = 20;
const TITLE_H = 26;
const BTN_H = 26;
const BTN_GAP = 6;
const BTN_MIN_W = 64;
const MAX_W = 400;

const FONT_TITLE = 'bold 17px "PingFang TC", "Microsoft JhengHei", sans-serif';
const FONT_BODY = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';

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

interface Rect { x: number; y: number; w: number; h: number }

interface Layout {
  box: Rect;
  title: string;
  lines: string[];
  buttons: { label: string; rect: Rect; hit: DialogHit }[];
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
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
 * 绘制与命中判定**共用**它 —— 两边各算一遍迟早对不上，那种错还特别难看出来
 * （看得见却点不中）。
 */
export function layoutDialog(
  ctx: CanvasRenderingContext2D,
  ui: InteractionUi,
  page: AmountPage | null,
): Layout {
  ctx.font = FONT_BODY;
  const innerW = MAX_W - PAD * 2;

  const choice = page === null ? null : ui.choices[page.choice];
  const amount = choice?.amount;
  const detail =
    page !== null && amount !== undefined
      ? `${ui.detail}\n\n${amount.label}：${page.value.toLocaleString('en-US')}　（上限 ${amount.max.toLocaleString('en-US')}）`
      : ui.detail;
  const lines = wrap(ctx, detail, innerW);

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

  // 按钮排成几行 —— 先量宽，再装行
  ctx.font = FONT_BODY;
  const widths = labels.map((l) => Math.max(BTN_MIN_W, Math.ceil(ctx.measureText(l.label).width) + 20));
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (let i = 0; i < labels.length; i++) {
    const w = widths[i]!;
    if (row.length > 0 && used + BTN_GAP + w > innerW) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(i);
    used += (row.length > 1 ? BTN_GAP : 0) + w;
  }
  if (row.length > 0) rows.push(row);

  const titleH = ui.title === '' ? 0 : TITLE_H;
  const bodyH = lines.length * LINE_H;
  const btnH = rows.length * BTN_H + Math.max(0, rows.length - 1) * BTN_GAP;
  const boxH = PAD * 2 + titleH + bodyH + (rows.length > 0 ? BTN_GAP + btnH : 0);

  // ★ 框心就是原版那一点；框顶由高度倒推，故框长高时是**往两边长**的
  const box: Rect = {
    x: DIALOG_ANCHOR.x - MAX_W / 2,
    y: DIALOG_ANCHOR.y - Math.round(boxH / 2),
    w: MAX_W,
    h: boxH,
  };
  // 别顶出棋盘区
  box.y = Math.max(4, Math.min(box.y, LAYOUT.board.h - boxH - 4));

  const buttons: Layout['buttons'] = [];
  let by = box.y + PAD + titleH + bodyH + BTN_GAP;
  for (const r of rows) {
    const total = r.reduce((s, i) => s + widths[i]!, 0) + (r.length - 1) * BTN_GAP;
    let bx = box.x + Math.round((MAX_W - total) / 2);
    for (const i of r) {
      buttons.push({ label: labels[i]!.label, rect: { x: bx, y: by, w: widths[i]!, h: BTN_H }, hit: labels[i]!.hit });
      bx += widths[i]! + BTN_GAP;
    }
    by += BTN_H + BTN_GAP;
  }

  return { box, title: ui.title, lines, buttons };
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
  ui: InteractionUi,
  page: AmountPage | null,
  hot: DialogHit | null,
): void {
  const l = layoutDialog(ctx, ui, page);
  ctx.save();

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, LAYOUT.board.w, LAYOUT.board.h);

  // 框：⚠️ 原版那张位图没认出来（Q-UI-2），这里自己画一个同位置的
  ctx.fillStyle = '#efe7d6';
  ctx.strokeStyle = '#6b5a39';
  ctx.lineWidth = 2;
  ctx.fillRect(l.box.x, l.box.y, l.box.w, l.box.h);
  ctx.strokeRect(l.box.x + 1, l.box.y + 1, l.box.w - 2, l.box.h - 2);

  let y = l.box.y + PAD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (l.title !== '') {
    ctx.font = FONT_TITLE;
    ctx.fillStyle = '#2a1d0e';
    ctx.fillText(l.title, DIALOG_ANCHOR.x, y);
    y += TITLE_H;
  }
  ctx.font = FONT_BODY;
  ctx.fillStyle = '#2a2a2a';
  for (const line of l.lines) {
    ctx.fillText(line, DIALOG_ANCHOR.x, y);
    y += LINE_H;
  }

  for (const b of l.buttons) {
    const on = hot !== null && JSON.stringify(hot) === JSON.stringify(b.hit);
    ctx.fillStyle = on ? '#e8d24a' : '#d6c6a5';
    ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
    ctx.strokeStyle = '#6b5a39';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.rect.x + 0.5, b.rect.y + 0.5, b.rect.w - 1, b.rect.h - 1);
    ctx.fillStyle = '#2a1d0e';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2 + 1);
    ctx.textBaseline = 'top';
  }
  ctx.restore();
}
