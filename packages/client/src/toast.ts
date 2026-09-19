/*
 * 屏幕提示条（toast）—— F9 问题回报的落盘确认
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ **原版没有这个东西**，是需求方明确要求的（第四份试玩回报）：
 *   「另外我F9保存日志的时候能不能有个提示让我知道自己保存成功了」——
 *   先前的确认只有日志栏里的一行小字，试玩时根本注意不到。
 *   所以这里刻意做成**非叙事**的样子（黑底/红底、居中、黄字），
 *   一眼就看得出是开发/回报用的界面，不与原版 UI 混同。
 *
 * ★ 只有**最新一条**（后来的顶掉前面的），不排队 —— 回报这件事一次只有一件。
 *
 * 纯状态部分（`raiseToast` / `toastVisible` / `toastAlpha` / `reportToast`）
 * 不碰 canvas，单测直接跑；`drawToast` 才需要 `ctx`。
 */

import { boldFont } from './font.ts';

export type ToastKind = 'info' | 'error';

/** 一条提示 */
export type Toast = {
  text: string;
  kind: ToastKind;
  /** 立起来的时刻（`performance.now()`）*/
  at: number;
};

/** 停留多久（毫秒）—— 「两秒多」，够看清落盘路径 */
export const TOAST_MS = 2600;
/** 末尾这一段淡出 */
export const TOAST_FADE_MS = 400;
/** 条高（640×480 舞台坐标）*/
export const TOAST_H = 46;

/**
 * 立一条提示。`text` 去掉空白后为空 → **不立**（返回 `null`）。
 * 传 `at` 而不是在里面取时间：纯函数，单测才好钉。
 */
export function raiseToast(at: number, text: string, kind: ToastKind = 'info'): Toast | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : { text: trimmed, kind, at };
}

/** 到点了吗（`null` 也算到点）*/
export function toastExpired(toast: Toast | null, now: number): boolean {
  return toast === null || now - toast.at >= TOAST_MS;
}

/** 这一刻还看得见吗 —— 渲染循环靠它决定要不要继续要帧 */
export function toastVisible(toast: Toast | null, now: number): boolean {
  return !toastExpired(toast, now);
}

/** 这一刻的不透明度 0..1（末尾 `TOAST_FADE_MS` 线性淡出）*/
export function toastAlpha(toast: Toast | null, now: number): number {
  if (toast === null) return 0;
  const left = toast.at + TOAST_MS - now;
  if (left <= 0) return 0;
  return left >= TOAST_FADE_MS ? 1 : left / TOAST_FADE_MS;
}

/**
 * F9 问题回报落盘之后的那条提示。
 *
 * ★ 成功与失败**必须长得不一样**：失败时用红底 + 独立文案，不能被当成「存好了」。
 *   `where === null` 就是写不出去（`writeReport` 的契约，见 `report-file.ts`）。
 */
export function reportToast(at: number, where: string | null): Toast | null {
  return where === null
    ? raiseToast(at, '⚠ 問題回報寫不出去（詳見日誌欄）', 'error')
    : raiseToast(at, `📝 問題回報已存：${where}`, 'info');
}

/** 底色 / 字色 / 边框 —— 两类的对比要一眼分得出 */
export const TOAST_BG: Record<ToastKind, string> = {
  info: 'rgba(0, 0, 0, 0.86)',
  error: 'rgba(128, 0, 0, 0.90)',
};
export const TOAST_FG: Record<ToastKind, string> = {
  info: '#ffd34d',
  error: '#ffffff',
};
export const TOAST_BORDER: Record<ToastKind, string> = {
  info: '#ffd34d',
  error: '#ff8080',
};

/**
 * 画在**最上面**（整屏接管、模态窗、台词之后）：居中的一条横幅。
 * 舞台坐标 640×480，`width/height` 传进来是为了单测与将来换分辨率。
 */
export function drawToast(
  ctx: CanvasRenderingContext2D,
  toast: Toast | null,
  now: number,
  width: number,
  height: number,
): void {
  const alpha = toastAlpha(toast, now);
  if (toast === null || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = boldFont(20);
  const padX = 24;
  const textW = ctx.measureText(toast.text).width;
  const w = Math.min(width - 32, Math.ceil(textW) + padX * 2);
  const h = TOAST_H;
  const x = Math.round((width - w) / 2);
  const y = Math.round(height / 2 - h / 2);
  ctx.fillStyle = TOAST_BG[toast.kind];
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = TOAST_BORDER[toast.kind];
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = TOAST_FG[toast.kind];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(toast.text, width / 2, y + h / 2);
  ctx.restore();
}
