/*
 * 通用填数窗的**面板** —— 版面纯函数（B-5/B-6 的最后一步）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 键盘与语义见 `amount-keys.test.ts`（逐项对过 exe）；这里钉**画出来的样子**：
 * 图号算式、数字落点、位数上限、以及「底图没解好就整扇窗都不画」这条兜底。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AMOUNT_DIGIT_MAX, AMOUNT_KEY_RECTS, AMOUNT_WINDOW } from './amount-keys.ts';
import {
  amountCharImage,
  amountDigits,
  AMOUNT_RESOURCE,
  amountWindowHitMapped,
  amountWindowPlan,
  drawAmountWindow,
  parseAmountHitMap,
} from './amount-window.ts';
import type { Sprite } from './assets.ts';

describe('★ 金额窗的字：图号与落点 @source loc_00452a05 / fcn_00456512', () => {
  it('★★ 图号 = 字符 − 0x2b（= − 43）（目视核过：图 4 = C、图 5 = 0、图 13 = 1）', () => {
    // ★ 不是照抄 `sub eax,0x20` —— 那段汇编后半截在**自己拼图素表项的内存地址**，
    //   照抄会得到 39 这种越界值。哪张图是什么是**目视核过**的（数字连排）。
    expect(amountCharImage('0')).toBe(5);
    expect(amountCharImage('1')).toBe(6);
    expect(amountCharImage('9')).toBe(14);
    // 非数字（金额栏里不会出现）返回 −1，让调用方跳过，不去贴越界的图
    expect(amountCharImage('C')).toBe(-1);
    expect(amountCharImage(' ')).toBe(-1);
    // 每个十进制数字都必须落在 Panel#21 那张 33×17 的字库里（图 4..15）
    for (let d = 0; d <= 9; d++) {
      const img = amountCharImage(String(d));
      expect(img).toBeGreaterThanOrEqual(4);
      expect(img).toBeLessThanOrEqual(15);
    }
    // 十个数字的图号必须**互不相同**（否则就是公式错了）
    const imgs = new Set(Array.from({ length: 10 }, (_, d) => amountCharImage(String(d))));
    expect(imgs.size).toBe(10);
  });

  it('★★ 数字从 `valueAtChar` 起、往右每格 +0xc；末位在最后', () => {
    const one = amountDigits(7);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      ch: '7',
      x: AMOUNT_WINDOW.valueAtChar.dx,
      y: AMOUNT_WINDOW.valueAtChar.dy,
    });
    const three = amountDigits(123);
    expect(three.map((d) => d.ch)).toEqual(['1', '2', '3']);
    expect(three.map((d) => d.x)).toEqual([
      AMOUNT_WINDOW.valueAtChar.dx,
      AMOUNT_WINDOW.valueAtChar.dx + AMOUNT_WINDOW.valueDigitPitch,
      AMOUNT_WINDOW.valueAtChar.dx + 2 * AMOUNT_WINDOW.valueDigitPitch,
    ]);
  });

  it('★ 最多 9 位（超过就画后 9 位），负数/小数先夹到非负整数', () => {
    expect(AMOUNT_DIGIT_MAX).toBe(9);
    expect(amountDigits(1234567890).map((d) => d.ch).join('')).toBe('234567890');
    expect(amountDigits(-5).map((d) => d.ch).join('')).toBe('0');
    expect(amountDigits(12.9).map((d) => d.ch).join('')).toBe('12');
    // 9 位是原版自己的上限（`cmp eax,9 / jge`），本引擎照抄；
    // ⚠️ 起点 0x40 + 9×0xc 会超出 128 宽的窗 —— 这是**照抄原版的算式**，
    //   没有替它改成右对齐（两种读法都无法在静态证据上排除，见 amount-keys.ts）
    const nine = amountDigits(123456789);
    expect(nine).toHaveLength(9);
    expect(nine.map((d) => d.ch).join('')).toBe('123456789');
  });
});

describe('★ 金额窗的版面与绘制', () => {
  it('★ 一张底图 + 每个数字一格', () => {
    const plan = amountWindowPlan(42);
    expect(plan.panel).toEqual({ image: 0, x: 0, y: 0 });
    expect(plan.digits.map((d) => d.ch)).toEqual(['4', '2']);
    expect(AMOUNT_RESOURCE).toBe(0x15);
  });

  it('★ 底图没解好 → 整扇窗都不画（返回 false，别画半扇）', () => {
    const drawImage = (): void => undefined;
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
    const nullSprite = (): Sprite | null => null;
    expect(drawAmountWindow(ctx, nullSprite, 100)).toBe(false);
  });

  it('★★ 画的位置 = 窗落点 + 面板内偏移（逐张贴图对账）', () => {
    const calls: { x: number; y: number }[] = [];
    const ctx = {
      drawImage: (_b: unknown, x: number, y: number) => {
        calls.push({ x, y });
      },
    } as unknown as CanvasRenderingContext2D;
    const sprite = (a: string, r: number, i: number): Sprite => {
      expect(a).toBe('Panel.mkf');
      expect(r).toBe(AMOUNT_RESOURCE);
      expect(i).toBeGreaterThanOrEqual(0);
      return { bitmap: {} as ImageBitmap, width: 9, height: 19, anchorX: 0, anchorY: 0 };
    };
    expect(drawAmountWindow(ctx, sprite, 7)).toBe(true);
    // ① 底图落在窗左上角；② 数字落在窗落点 + valueAtChar
    expect(calls[0]).toEqual({ x: AMOUNT_WINDOW.x, y: AMOUNT_WINDOW.y });
    expect(calls[1]).toEqual({
      x: AMOUNT_WINDOW.x + AMOUNT_WINDOW.valueAtChar.dx,
      y: AMOUNT_WINDOW.y + AMOUNT_WINDOW.valueAtChar.dy,
    });
  });
});

describe('★★ 逐像素 id 图（Panel#0x16）＝ 命中的真值（2026-09-16 接入）', () => {
  const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/assets-clean/Panel/0022.bin';
  const hasMap = existsSync(MAP);
  const bytes = hasMap ? new Uint8Array(readFileSync(MAP)) : null;

  it('★ 尺寸就是面板的 128×192，且字节值只出现 0..15', () => {
    if (!hasMap || bytes === null) return;
    expect(bytes.length).toBe(AMOUNT_WINDOW.w * AMOUNT_WINDOW.h);
    const ids = new Set(bytes);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(0);
      // 0..16：16 是原版给「金额栏」留的那一号（`[0x48cac2]=0x10`，见 `amount-keys.ts`）
      expect(id).toBeLessThanOrEqual(16);
    }
  });

  it('★★ 每颗钮内部读到的 id 与**矩形表的下标**完全一致（身份核对）', () => {
    if (!hasMap || bytes === null) return;
    const map = parseAmountHitMap(bytes);
    expect(map).not.toBeNull();
    for (let i = 2; i < AMOUNT_KEY_RECTS.length; i++) {
      const r = AMOUNT_KEY_RECTS[i]!;
      // 取钮内左上角一点（避开描边），窗内坐标 → 舞台坐标
      const x = AMOUNT_WINDOW.x + r.x + 2;
      const y = AMOUNT_WINDOW.y + r.y + (r.h >> 1);
      expect(amountWindowHitMapped(map, x, y), `第 ${i} 号钮`).toBe(i);
    }
  });

  it('★ 窗外的点一律不认；没有 id 图时退回矩形表', () => {
    if (!hasMap || bytes === null) return;
    const map = parseAmountHitMap(bytes);
    expect(amountWindowHitMapped(map, AMOUNT_WINDOW.x - 1, AMOUNT_WINDOW.y + 5)).toBeNull();
    expect(amountWindowHitMapped(map, AMOUNT_WINDOW.x + 200, AMOUNT_WINDOW.y + 5)).toBeNull();
    // 空图退回矩形表
    expect(amountWindowHitMapped(null, AMOUNT_WINDOW.x + 8 + 20, AMOUNT_WINDOW.y + 63 + 10)).toBe(2);
    // 长度不足 → `parseAmountHitMap` 返回 null
    expect(parseAmountHitMap(new Uint8Array(10))).toBeNull();
    expect(parseAmountHitMap(null)).toBeNull();
  });
});
