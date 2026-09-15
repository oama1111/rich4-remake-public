/*
 * FLIC 解码器测试 —— 钉住「掷骰那 36 帧」的头部与关键几何
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 断言是**从原版素材本身**算出来的（`Panel.mkf` 资源 4/5/6），
 *   不是拿别的解码器的输出当基准 —— 唯一的真值是 exe 与素材。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MkfArchive } from './mkf.ts';
import { parseFlicInfo, decodeFlic } from './flic.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = join(HERE, '..', '..', '..', 'assets', 'game', 'Panel.mkf');

const panel = new MkfArchive(new Uint8Array(readFileSync(PANEL)));

/** 一帧里不透明的像素数 */
function opaqueCount(rgba: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! > 0) n += 1;
  return n;
}

/** 某一行的不透明像素（连续 x 区间） */
function rowSpans(rgba: Uint8ClampedArray, width: number, y: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const on = x < width && rgba[(y * width + x) * 4 + 3]! > 0;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      spans.push([start, x - 1]);
      start = -1;
    }
  }
  return spans;
}

describe('FLIC —— 滚骰影片（Panel.mkf 4/5/6）', () => {
  it.each([4, 5, 6])('资源 %i 的头部与 exe 一致', (res) => {
    const info = parseFlicInfo(panel.read(res));
    // @source VA 0x00450d00 `cmp word [eax+4], 0xaf12` 与数据本身
    expect(info).toEqual({ width: 189, height: 285, frames: 36, frameMs: 14 });
  });

  it.each([4, 5, 6])('资源 %i 解出的帧数与头部一致', (res) => {
    const flic = decodeFlic(panel.read(res));
    expect(flic).not.toBeNull();
    expect(flic!.frames).toHaveLength(36);
    for (const f of flic!.frames) {
      expect(f).toHaveLength(189 * 285 * 4);
    }
  });

  /**
   * ★ 第 0 帧全透明 —— 原版对 FLI_COPY（类型 18）整块跳过，
   *   剩下的「BLACK」在 exe 里是段 RLE。见 `flic.ts` 文件头的取舍说明。
   */
  it.each([4, 5, 6])('资源 %i 第 0 帧全透明', (res) => {
    const flic = decodeFlic(panel.read(res))!;
    expect(opaqueCount(flic.frames[0]!)).toBe(0);
  });

  /**
   * ★ 末帧的骰子落点必须与 `Panel.mkf` 资源 3 的点数图**逐像素对齐**。
   *
   * 资源 3 是 SPR，18 张 = 3 槽 × 6 面，各槽自带锚点；
   * 原版把它们画在 `(edi + 0x55 - 锚点x, ebp + 0x91 - 锚点y)`
   * （`fcn_0045663e`，VA 0x0045663e），于是三颗骰子分别落在
   * x = 1 / 96 / 153，宽 35 / 30 / 34。
   * 如果解码器把 delta 解错（行号、skip 或少写索引 0），这里会对不上。
   */
  it('末帧三颗骰子的落点与点数图锚点吻合', () => {
    const flic = decodeFlic(panel.read(6))!;
    const last = flic.frames[35]!;
    // 末帧骰子躺平，取一条穿过三颗的横线
    const mid = rowSpans(last, 189, 265);
    // 第 1 颗 x 1..35、第 2 颗 96..125、第 3 颗 154..187
    // （= 点数图 `Panel.mkf` 3 的三槽尺寸/锚点算出来的落点，见 known-deviations Q-TURN-1 §4）
    expect(mid[0]![0]).toBe(1);
    expect(mid[1]).toEqual([96, 125]);
    expect(mid[2]![1]).toBe(187);
  });

  /**
   * 骰子是**抛物线**：先往上抛（第 1→10 帧最下一行从 138 升到 51），
   * 再落下来（10→35 帧降到 281）。单调断言会误判成 bug。
   */
  it('骰子先上抛再下落', () => {
    const flic = decodeFlic(panel.read(4))!;
    const bottom = (i: number): number => {
      const f = flic.frames[i]!;
      for (let y = 284; y >= 0; y--) {
        for (let x = 0; x < 189; x++) if (f[(y * 189 + x) * 4 + 3]! > 0) return y;
      }
      return -1;
    };
    expect(bottom(10)).toBeLessThan(bottom(1));
    expect(bottom(10)).toBeLessThan(bottom(20));
    expect(bottom(35)).toBeGreaterThan(bottom(20));
    // 落地后停在画面下半部
    expect(bottom(35)).toBeGreaterThan(270);
  });

  it('不是 FLIC 的资源返回 null', () => {
    expect(parseFlicInfo(panel.read(3))).toBeNull();
    expect(decodeFlic(panel.read(3))).toBeNull();
  });
});
