/*
 * 屏幕提示条（toast）—— F9 问题回报的落盘确认
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 试玩回报：「另外我F9保存日志的时候能不能有个提示让我知道自己保存成功了」。
 * 这里钉三件事：① 成功一定立提示、且带落盘路径；② 失败立的是**另一类**
 * （红底 error，不能被当成存好了）；③ 到点自己收（渲染循环据此停帧）。
 */
import { describe, expect, it } from 'vitest';
import {
  TOAST_BG,
  TOAST_FADE_MS,
  TOAST_MS,
  raiseToast,
  reportToast,
  toastAlpha,
  toastExpired,
  toastVisible,
} from './toast.ts';

describe('★ F9 问题回报 → 明显的 toast', () => {
  it('★ 存成功 → 立一条 info，文字里有落盘路径', () => {
    const t = reportToast(0, '/Users/x/rich4-report-20260920-1.json');
    expect(t).not.toBeNull();
    expect(t!.kind).toBe('info');
    expect(t!.text).toContain('已存');
    expect(t!.text).toContain('/Users/x/rich4-report-20260920-1.json');
    expect(toastVisible(t, 0)).toBe(true);
  });

  it('★ 写失败 → 立的是 error（与成功不同类），文案也不同', () => {
    const ok = reportToast(0, '/x/rich4-report.json');
    const bad = reportToast(0, null);
    expect(bad).not.toBeNull();
    expect(bad!.kind).toBe('error');
    expect(ok!.kind).not.toBe(bad!.kind);
    expect(bad!.text).not.toBe(ok!.text);
    expect(bad!.text).not.toContain('已存');
    expect(toastVisible(bad, 0)).toBe(true);
  });

  it('★ 两类**都必须看得见**（成功不能不提示、失败也不能不提示）', () => {
    for (const where of ['/x/a.json', null]) {
      const t = reportToast(1234, where);
      expect(t, `where=${String(where)}`).not.toBeNull();
      expect(toastVisible(t, 1234), `where=${String(where)}`).toBe(true);
    }
  });

  it('★ 失败与成功的底色不同（红底才认得出没存成）', () => {
    expect(TOAST_BG.error).not.toBe(TOAST_BG.info);
  });
});

describe('toast 的节拍（自己收掉，不挡操作）', () => {
  it('★ 停留 `TOAST_MS`，到点自己收 —— 渲染循环靠它停帧', () => {
    const t = raiseToast(1000, 'hi');
    expect(toastVisible(t, 1000)).toBe(true);
    expect(toastVisible(t, 1000 + TOAST_MS - 1)).toBe(true);
    expect(toastExpired(t, 1000 + TOAST_MS)).toBe(true);
    expect(toastVisible(t, 1000 + TOAST_MS)).toBe(false);
    // 没有提示时不画、也不要帧
    expect(toastVisible(null, 0)).toBe(false);
    expect(toastExpired(null, 0)).toBe(true);
  });

  it('★ 末尾淡出：最后 `TOAST_FADE_MS` 之内 alpha 从 1 掉到 0', () => {
    const t = raiseToast(0, 'hi')!;
    expect(toastAlpha(t, 0)).toBe(1);
    expect(toastAlpha(t, TOAST_MS - TOAST_FADE_MS)).toBe(1);
    expect(toastAlpha(t, TOAST_MS - TOAST_FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(toastAlpha(t, TOAST_MS)).toBe(0);
    expect(toastAlpha(t, TOAST_MS + 500)).toBe(0);
    expect(toastAlpha(null, 0)).toBe(0);
  });

  it('空文案不立（不画空气泡）', () => {
    expect(raiseToast(0, '')).toBeNull();
    expect(raiseToast(0, '   ')).toBeNull();
  });
});
