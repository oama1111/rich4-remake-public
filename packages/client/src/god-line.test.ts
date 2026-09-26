/*
 * 神明附身的开场白（`fcn_0040e2a2`）—— 第八份试玩回报 #5
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  GOD_LINES,
  GOD_LINE_AT,
  GOD_LINE_MS,
  GOD_LINE_WRAP,
  godFilmFrameHeld,
  godLineActive,
  godLineRows,
  godLineShown,
  godLineTrigger,
} from './god-line.ts';
import { GOD_FX_IDS, godFilmSpec } from './god-fx.ts';

describe('常数 @source fcn_0040e2a2', () => {
  it('2400 ms（push 0x960）、底边中点 (220, 460−40)、换行宽 320', () => {
    expect(GOD_LINE_MS).toBe(2400);
    expect(GOD_LINE_AT).toEqual({ x: 220, y: 420 });
    expect(GOD_LINE_WRAP).toBe(320);
  });
  it('十二位神明各一句；11 / 13 / 14（惡犬 / 禮物 / 寶箱）没有', () => {
    expect(Object.keys(GOD_LINES).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15]);
    expect(GOD_LINES[3]).toBe('Ｙｅａｈ!!不要看我小喔\n\n我可以讓你投資事半功倍！');
    expect(GOD_LINES[15]).toBe('嘿嘿嘿嘿﹒﹒你慘了！\n\n被我盯上，你完蛋了。');
  });
});

describe('godLineTrigger', () => {
  const objects = Array.from({ length: 16 }, (_, i) => ({ type: i + 1 }));
  it('godInfo 从 0 变成 3（小福神）⇒ 小福神那句', () => {
    const before = { players: [{ godInfo: 0 }, { godInfo: 0 }] };
    const after = { players: [{ godInfo: 0 }, { godInfo: 3 }], objects };
    expect(godLineTrigger(before, after)).toBe(GOD_LINES[3]);
  });
  it('换神（5 → 7）也算；没变 / 变回 0 / 变成 13（禮物）不算', () => {
    expect(godLineTrigger({ players: [{ godInfo: 5 }] }, { players: [{ godInfo: 7 }], objects })).toBe(GOD_LINES[7]);
    expect(godLineTrigger({ players: [{ godInfo: 5 }] }, { players: [{ godInfo: 5 }], objects })).toBeNull();
    expect(godLineTrigger({ players: [{ godInfo: 5 }] }, { players: [{ godInfo: 0 }], objects })).toBeNull();
    expect(godLineTrigger({ players: [{ godInfo: 0 }] }, { players: [{ godInfo: 13 }], objects })).toBeNull();
  });
});

describe('godLineRows —— 先按 \\n 切、再按 320 折', () => {
  const mono = (s: string) => [...s].length * 28; // 28 px 一字
  it('空行保留（原版串里的 \\n\\n 就是一行空白）', () => {
    expect(godLineRows('a\n\nb', mono)).toEqual(['a', '', 'b']);
  });
  it('超过 320 px 的一行折成两行（13 字：11 × 28 = 308 放得下、第 12 字起折）', () => {
    const rows = godLineRows('投資加倍順利、買地不用錢。', mono);
    expect(rows).toEqual(['投資加倍順利、買地不用', '錢。']);
  });
  it('刚好 320 不折', () => {
    expect(godLineRows('x'.repeat(11), (s) => s.length * 29)).toEqual(['x'.repeat(11)]);
  });
});

describe('godLineActive', () => {
  it('2399 ms 还在、2400 ms 收场', () => {
    expect(godLineActive(1000, 3399)).toBe(true);
    expect(godLineActive(1000, 3400)).toBe(false);
  });
});

describe('第十八份：开场白与附身影片的最后一帧同屏 @source 0x0045144f flags=1 不重画 + 0x40e2a2 直接写屏', () => {
  it('十二位有影片的神明：影片播完、开场白排着 ⇒ 钉住最后一帧', () => {
    for (const id of GOD_FX_IDS) {
      const spec = godFilmSpec(id)!;
      expect(spec.flags).toBe(1); // bit3 = 0、第三字节 = 0 ⇒ 片尾不走 0x409b18
      expect(godFilmFrameHeld(spec.id, true)).toBe(true);
      expect(godFilmFrameHeld(spec.id, false)).toBe(false);
    }
  });
  it('别的棋盘影片（救护车 / 入獄 / 老虎机…）不钉', () => {
    expect(godFilmFrameHeld('hospital', true)).toBe(false);
    expect(godFilmFrameHeld('god-slot', true)).toBe(false);
  });
  it('「動畫過程」关掉 ⇒ 没有开场白（十二支的 je 连 0x40e2a2 一起跳过）', () => {
    expect(godLineShown(false)).toBe(false);
    expect(godLineShown(true)).toBe(true);
  });
});
