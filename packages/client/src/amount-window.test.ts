/*
 * 通用填数窗的**面板** —— 版面纯函数（B-5/B-6 的最后一步）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 键盘与语义见 `amount-keys.test.ts`（逐项对过 exe）；这里钉**画出来的样子**：
 * 图号算式、数字落点、位数上限、以及「底图没解好就整扇窗都不画」这条兜底。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_DIGIT_MAX,
  AMOUNT_KEY_RECTS,
  AMOUNT_WINDOW,
  amountWindowHit,
} from './amount-keys.ts';
// ★ W-62：画的那一半要用 `boardRect()` 换算（与 `dialog.ts` 的命中框同源）
import { boardRect } from './gameui.ts';
import { LAYOUT } from './stage.ts';
import {
  AMOUNT_BAR_DRAG_SOUND,
  AMOUNT_BAR_RECT,
  amountBarDragValue,
  AMOUNT_GAUGE,
  AMOUNT_GAUGE_WIDTHS,
  amountCharImage,
  amountDigits,
  amountGaugeIndex,
  AMOUNT_RESOURCE,
  amountWindowHitMapped,
  amountWindowPlan,
  drawAmountWindow,
  parseAmountHitMap,
} from './amount-window.ts';
import type { Sprite } from './assets.ts';

describe('★ 金额窗的字：图号与落点 @source fcn_0045297e（2026-09-19 整支重读）', () => {
  it('★★ 图号 = 字符 − 0x20（0x00452a0f `sub eax,0x20`）⇒ 图 16..25 —— 液晶字模，不是键帽', () => {
    expect(amountCharImage('0')).toBe(16);
    expect(amountCharImage('5')).toBe(21);
    expect(amountCharImage('9')).toBe(25);
    // 非数字（金额栏里不会出现）返回 −1，让调用方跳过，不去贴越界的图
    expect(amountCharImage('C')).toBe(-1);
    expect(amountCharImage(' ')).toBe(-1);
    const imgs = new Set(Array.from({ length: 10 }, (_, d) => amountCharImage(String(d))));
    expect(imgs.size).toBe(10);
  });

  // ★ 旧测试写的是「图 5..14，目视核过」—— 目视核的是**键帽**（上面也印着数字），不是字模。
  //   这一条拿解包出来的真图量尺寸，把两者分开：字模 9×19，键帽 33×17。
  const PANEL_DIR = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/Panel';
  const sizeOf = (i: number): [number, number] => {
    const png = readFileSync(`${PANEL_DIR}/0021_${String(i).padStart(3, '0')}.png`);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  (existsSync(`${PANEL_DIR}/0021_016.png`) ? it : it.skip)(
    '★★ 真图对账：`amountCharImage` 指到的十张都是 9×19 的字模；图 5..14 是 33×17 的键帽',
    () => {
      for (let d = 0; d <= 9; d++) expect(sizeOf(amountCharImage(String(d)))).toEqual([9, 19]);
      for (let i = 5; i <= 14; i++) expect(sizeOf(i)).toEqual([33, 17]);
      expect(sizeOf(1)).toEqual([108, 12]); // 暗的比例条
    },
  );

  it('★★ 右对齐：末位落在 (0x6b, 0x0b)，往前每一位 −0xc @source 0x00452985 / 0x0045298f / 0x00452a28', () => {
    expect(AMOUNT_WINDOW.valueAt).toEqual({ dx: 0x6b, dy: 0x0b });
    expect(amountDigits(7)).toEqual([{ ch: '7', image: 23, x: 0x6b, y: 0x0b }]);
    const three = amountDigits(123);
    expect(three.map((d) => d.ch)).toEqual(['1', '2', '3']);
    expect(three.map((d) => d.x)).toEqual([0x6b - 24, 0x6b - 12, 0x6b]);
    expect(new Set(three.map((d) => d.y))).toEqual(new Set([0x0b]));
  });

  it('★ 最多 9 位（超过就画后 9 位），负数/小数先夹到非负整数；9 位也放得进液晶屏', () => {
    expect(AMOUNT_DIGIT_MAX).toBe(9);
    expect(amountDigits(1234567890).map((d) => d.ch).join('')).toBe('234567890');
    expect(amountDigits(-5).map((d) => d.ch).join('')).toBe('0');
    expect(amountDigits(12.9).map((d) => d.ch).join('')).toBe('12');
    const nine = amountDigits(123456789);
    expect(nine).toHaveLength(9);
    // 首位 x = 0x6b − 8×0xc = 11 ≥ 面板左边框；末位 x + 9 = 116 < 128 ⇒ 整串都在窗内
    expect(nine[0]!.x).toBe(11);
    expect(nine[8]!.x + 9).toBeLessThan(AMOUNT_WINDOW.w);
    // ★ 整串都在**比例条之上**（先前落在 y = 0x21、紧贴 0x2a 的条，液晶屏永远是空的）
    for (const d of nine) expect(d.y + 19).toBeLessThanOrEqual(AMOUNT_GAUGE.y);
  });
});

describe('★ 比例条 @source 0x00452a64..0x00452ad1 / 表 0x47e725', () => {
  it('档位 = trunc(float32(值/上限) × 33)；值为 0 ⇒ −1（整条都暗）', () => {
    expect(amountGaugeIndex(0, 1000)).toBe(-1);
    expect(amountGaugeIndex(5, 0)).toBe(-1);
    expect(amountGaugeIndex(1, 1000)).toBe(0);
    expect(amountGaugeIndex(500, 1000)).toBe(16);
    expect(amountGaugeIndex(999, 1000)).toBe(32);
    expect(amountGaugeIndex(1000, 1000)).toBe(33);
    expect(amountGaugeIndex(5000, 1000)).toBe(33); // 不越表
  });

  it('宽度表 34 项、严格递增、末项 107（< 暗条图的 108 宽）', () => {
    expect(AMOUNT_GAUGE_WIDTHS).toHaveLength(34);
    expect(AMOUNT_GAUGE_WIDTHS[0]).toBe(3);
    expect(AMOUNT_GAUGE_WIDTHS[33]).toBe(107);
    for (let i = 1; i < 34; i++) expect(AMOUNT_GAUGE_WIDTHS[i]!).toBeGreaterThan(AMOUNT_GAUGE_WIDTHS[i - 1]!);
  });
});

describe('★ 金额窗的版面与绘制', () => {
  it('★ 一张底图 + 暗条 + 亮条那一截 + 每个数字一格', () => {
    const plan = amountWindowPlan(42, 1000);
    expect(plan.panel).toEqual({ image: 0, x: 0, y: 0 });
    expect(plan.gaugeDim).toEqual({ image: 1, x: 0x0a, y: 0x2a });
    expect(plan.gaugeLit).toEqual({ x: 0x0a, y: 0x2a, w: AMOUNT_GAUGE_WIDTHS[1], h: 0x0c });
    expect(plan.digits.map((d) => d.ch)).toEqual(['4', '2']);
    expect(amountWindowPlan(0, 1000).gaugeLit).toBeNull();
    expect(AMOUNT_RESOURCE).toBe(0x15);
  });

  it('★ 底图没解好 → 整扇窗都不画（返回 false，别画半扇）', () => {
    const drawImage = (): void => undefined;
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
    const nullSprite = (): Sprite | null => null;
    expect(drawAmountWindow(ctx, nullSprite, 100)).toBe(false);
  });

  it('★★ 逐张贴图对账：底图 → 暗条 → 亮条（从底图身上裁）→ 数字', () => {
    const calls: { image: number; args: number[] }[] = [];
    const ctx = {
      drawImage: (b: { image: number }, ...args: number[]) => {
        calls.push({ image: b.image, args });
      },
    } as unknown as CanvasRenderingContext2D;
    const sprite = (a: string, r: number, i: number): Sprite => {
      expect(a).toBe('Panel.mkf');
      expect(r).toBe(AMOUNT_RESOURCE);
      return { bitmap: { image: i } as unknown as ImageBitmap, width: 9, height: 19, anchorX: 0, anchorY: 0 };
    };
    expect(drawAmountWindow(ctx, sprite, 7, 10)).toBe(true);
    // ★ W-62 订正：`ctx` 是**棋盘画布**，而 `AMOUNT_WINDOW` 是原版的**屏幕**坐标
    //   ⇒ 期望值要用 `boardRect()` 换算后的原点（先前这里写的是屏幕坐标本身，
    //     那正是「画的位置比命中框低 40 px」的 bug 被测试固化的样子）。
    const { x: wx, y: wy } = boardRect(AMOUNT_WINDOW);
    expect(calls[0]).toEqual({ image: 0, args: [wx, wy] });
    expect(calls[1]).toEqual({ image: 1, args: [wx + 0x0a, wy + 0x2a] });
    const w = AMOUNT_GAUGE_WIDTHS[amountGaugeIndex(7, 10)]!;
    expect(calls[2]).toEqual({ image: 0, args: [0x0a, 0x2a, w, 0x0c, wx + 0x0a, wy + 0x2a, w, 0x0c] });
    expect(calls[3]).toEqual({ image: 23, args: [wx + 0x6b, wy + 0x0b] });
    expect(calls).toHaveLength(4);
  });

  it('★★ W-62：面板画在**棋盘坐标**上 —— 与命中框同源，不再低 40 px', () => {
    const calls: { args: number[] }[] = [];
    const ctx = {
      drawImage: (_b: unknown, ...args: number[]) => {
        calls.push({ args });
      },
    } as unknown as CanvasRenderingContext2D;
    const sprite = (_a: string, _r: number, i: number): Sprite => ({
      bitmap: { image: i } as unknown as ImageBitmap,
      width: 9,
      height: 19,
      anchorX: 0,
      anchorY: 0,
    });
    expect(drawAmountWindow(ctx, sprite, 7, 10)).toBe(true);
    // 第一张贴的是底图（`plan.panel` = (0,0)）
    expect(calls[0]!.args[0]).toBe(AMOUNT_WINDOW.x - LAYOUT.board.x);
    expect(calls[0]!.args[1]).toBe(AMOUNT_WINDOW.y - LAYOUT.board.y);
    // 反证：就是这 40 px —— 屏幕 y 与棋盘 y 差 `LAYOUT.board.y`
    expect(LAYOUT.board.y).toBe(40);
    expect(calls[0]!.args[1]).not.toBe(AMOUNT_WINDOW.y);
  });

  it("★★ W-62：画的位置与**命中框**同源 —— 序号 7（'7'）那颗钮对得上", () => {
    // 命中框那一半（`dialog.ts`）：它把**屏幕**坐标 `AMOUNT_WINDOW.x + r.x` 过一遍
    //   `boardRect()` 换成棋盘坐标再判定；画这一半现在也走同一个 `boardRect()`。
    //   两边只要有一边忘了换算，键就会整排错开 40 px（本条的 bug）。
    const box = boardRect(AMOUNT_WINDOW);
    const drawnOrigin = { x: AMOUNT_WINDOW.x - LAYOUT.board.x, y: AMOUNT_WINDOW.y - LAYOUT.board.y };
    expect(box.x).toBe(drawnOrigin.x);
    expect(box.y).toBe(drawnOrigin.y);

    const key7 = AMOUNT_KEY_RECTS[7]!;
    // ① 画的落点 + 键矩形 = 命中框（棋盘坐标）
    const hitBoard = boardRect({
      x: AMOUNT_WINDOW.x + key7.x,
      y: AMOUNT_WINDOW.y + key7.y,
      w: key7.w,
      h: key7.h,
    });
    expect({ x: hitBoard.x, y: hitBoard.y }).toEqual({
      x: drawnOrigin.x + key7.x,
      y: drawnOrigin.y + key7.y,
    });
    // ② 与命中判据的真值自洽：那颗钮的**屏幕**中心必须命中 7 号
    const cx = AMOUNT_WINDOW.x + key7.x + key7.w / 2;
    const cy = AMOUNT_WINDOW.y + key7.y + key7.h / 2;
    expect(amountWindowHit(cx, cy)).toBe(7);
    // ③ 反证：不换算（= 旧写法）时，同一颗钮的中心会落到「1 2 3」那一排的号上
    const wrong = amountWindowHit(cx, cy - LAYOUT.board.y);
    expect(wrong).not.toBe(7);
  });
});

describe('★★ 逐像素 id 图（Panel#0x16）＝ 命中的真值（2026-09-16 接入）', () => {
  const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/Panel/0022.bin';
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

  it('★★ 金额栏那一片（id 0x10）= 实心矩形 `x∈[9,118] y∈[41,54]`，常量与素材逐像素对得上', () => {
    if (!hasMap || bytes === null) return;
    const pts: number[] = [];
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x10) pts.push(i);
    const xs = pts.map((i) => i % AMOUNT_WINDOW.w);
    const ys = pts.map((i) => Math.floor(i / AMOUNT_WINDOW.w));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    expect([x0, x1, y0, y1]).toEqual([
      AMOUNT_BAR_RECT.x,
      AMOUNT_BAR_RECT.x + AMOUNT_BAR_RECT.w - 1,
      AMOUNT_BAR_RECT.y,
      AMOUNT_BAR_RECT.y + AMOUNT_BAR_RECT.h - 1,
    ]);
    // ★ 像素数 == 外接矩形面积 ⇒ 那一片没有洞，矩形判定与逐像素查 id 等价
    expect(pts.length).toBe(AMOUNT_BAR_RECT.w * AMOUNT_BAR_RECT.h);
  });

  it('★★ 在金额栏上滑动 → 值按窗内 x 换算（`loc_00453394` 那条式子）', () => {
    const X = AMOUNT_WINDOW.x;
    const Y = AMOUNT_WINDOW.y;
    // 栏的最左一列 x=9：`x−0xa ≤ 0` ⇒ 值 0
    expect(amountBarDragValue(X + 9, Y + 45, 99_999)).toBe(0);
    // x=0x40 = 64（`H` 的按下点）⇒ trunc(上限 × 17/33)
    expect(amountBarDragValue(X + 0x40, Y + 45, 100)).toBe(51);
    // 栏的最右一列 x=118：表里没有 ≥ 108 的项 ⇒ 原版什么都不做（值不变）
    expect(amountBarDragValue(X + 118, Y + 45, 100)).toBeNull();
    expect(amountBarDragValue(X + 117, Y + 45, 99)).toBe(99);
    // 栏以外的窗内位置（金额显示框 / 钮区）不认
    expect(amountBarDragValue(X + 64, Y + 20, 100)).toBeNull();
    expect(amountBarDragValue(X + 2, Y + 45, 100)).toBeNull();
    // 窗外不认
    expect(amountBarDragValue(X - 1, Y + 45, 100)).toBeNull();
    expect(amountBarDragValue(X + 64, Y + 0xc1, 100)).toBeNull();
    // 音效号（`[0x482352]` 表值 9）
    expect(AMOUNT_BAR_DRAG_SOUND).toBe(9);
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
