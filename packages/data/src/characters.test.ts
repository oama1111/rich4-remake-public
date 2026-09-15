/*
 * ★ 角色 `color` 的**字节序**溯源测试（原 DEVELOPMENT_PLAN Q6）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Q6 的问题是：`CHARACTERS[i].color` 这个 32 位值是 `0xRRGGBB` 还是 `0xBBGGRR`？
 * 两种读法给出的屏上颜色互为「红蓝互换」，肉眼看图标名称猜不出来，必须证。
 *
 * 本文件钉两条**互相独立**的判据：
 *
 *  A. **exe 侧**：原版把这个 32 位原值送进 `_rich4_convert_color`
 *     （VA 0x004551f0；像素格式号 0 = RGB555 的实现 @VA 0x0045523e），
 *     再由 0x0040987d 写进精灵表调色板 #255。下面把那段取位**逐指令复刻**，
 *     断言「写进调色板的那 16 位」的红/绿/蓝三个分量分别取自原值的
 *     bit19..23 / bit11..15 / bit3..7，即 byte2/byte1/byte0 = R/G/B。
 *
 *  B. **素材侧**：角色的 Q 版棋子（`Data.mkf` 资源 `0x80 + 21×角色`，
 *     解包在 `assets-clean/Data/`）就是他/她的主题色。取图的**最大通道**
 *     与两种读法比对——孫小美（红/蓝）、小丹尼（蓝/红）、約翰喬（棕/蓝）
 *     三例互为补色，故这条判据**能区分**两种读法，不是「看着像」。
 *     主色数值由直方图（饱和像素、去掉灰与暗）量出，写在下面。
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS, characterColorRgb } from './characters.ts';

/**
 * 逐指令复刻 `VA 0x0045523e`（像素格式号 0 = RGB555）：
 *
 * ```asm
 * 0045523e  shld ebx, eax, 0x1d / and ebx, 0x1f   ; 蓝 ← 原值 bit 3..7   → 目标 bit 0..4
 * 00455245  shld edx, eax, 0x1a / and edx, 0x3e0  ; 绿 ← 原值 bit 11..15 → 目标 bit 5..9
 * 0045524f  shr  eax, 9        / and eax, 0x7c00  ; 红 ← 原值 bit 19..23 → 目标 bit 10..14
 * ```
 *
 * 输入是 24 位「屏幕色」，输出是写进调色板 #255 的 16 位 RGB555。
 */
function convertColor555(v: number): number {
  const blue = (v >>> 3) & 0x1f;
  const green = (v >>> 11) & 0x1f;
  const red = (v >>> 19) & 0x1f;
  return (red << 10) | (green << 5) | blue;
}

/**
 * 素材实测主色 —— `assets-clean/Data/<资源>_000.png` 的**饱和像素直方图峰值**
 * （去 alpha<128、去 |max−min|<40 的灰、去 max<60 的暗）。
 *
 * 资源号 = `0x80 + 21×角色` @source `client/assets.ts` 的 `CHARACTER_SET_BASE`。
 * 这些值是**从原版美术量出来的**，与 exe 的表是两条独立证据。
 */
const SPRITE_DOMINANT: Readonly<Record<number, readonly [number, number, number]>> = {
  0: [0x50, 0x30, 0x10], // 約翰喬    Data/0128_*  棕
  6: [0x20, 0x50, 0x00], // 宮本寶藏  Data/0254_*  深绿
  9: [0xe0, 0x30, 0x00], // 孫小美    Data/0317_*  红
  10: [0x00, 0x10, 0x70], // 小丹尼   Data/0338_*  蓝
};

/** 32 位值的最大通道 —— 用来判「主色是红/绿/蓝」 */
function maxChannel(rgb: readonly [number, number, number]): 0 | 1 | 2 {
  if (rgb[0] >= rgb[1] && rgb[0] >= rgb[2]) return 0;
  return rgb[1] >= rgb[2] ? 1 : 2;
}

/** 按 BGR 读法解同一个 32 位值（Q6 要排除的那一种） */
function asBgr(v: number): readonly [number, number, number] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
}

describe('★ Q6：角色 color 的字节序（0xRRGGBB，R 在高字节）', () => {
  it('A. exe：写进调色板 #255 的 16 位就是从 byte2/1/0 取的红/绿/蓝', () => {
    for (const c of CHARACTERS) {
      const [r, g, b] = characterColorRgb(c.color);
      const code = convertColor555(c.color);
      expect((code >> 10) & 0x1f, `${c.name} 红分量`).toBe(r >> 3);
      expect((code >> 5) & 0x1f, `${c.name} 绿分量`).toBe(g >> 3);
      expect(code & 0x1f, `${c.name} 蓝分量`).toBe(b >> 3);
    }
  });

  it('B. 素材：棋子的主题色与 RGB 读法同色相（且能排除 BGR 读法）', () => {
    for (const [idText, dominant] of Object.entries(SPRITE_DOMINANT)) {
      const c = CHARACTERS[Number(idText)]!;
      expect(maxChannel(characterColorRgb(c.color)), `${c.name} RGB 读法的最大通道`)
        .toBe(maxChannel(dominant));
    }
    // ★ 这条判据**能区分**两种读法：下面三人红蓝互换，BGR 读法会与素材矛盾
    for (const id of [0, 9, 10]) {
      const c = CHARACTERS[id]!;
      const dominant = SPRITE_DOMINANT[id]!;
      expect(maxChannel(asBgr(c.color)), `${c.name} BGR 读法必须与素材矛盾`)
        .not.toBe(maxChannel(dominant));
    }
  });

  it('逐角色钉死解码结果（改表或改移位都会红）', () => {
    const expected: Readonly<Record<string, string>> = {
      yuehanqiao: '148,97,38',
      shalongbasi: '189,195,198',
      rentailang: '65,50,59',
      qianfuren: '198,38,195',
      atubo: '197,184,48',
      shalagongzhu: '237,157,157',
      gongbenbaozang: '0,240,56',
      tangtang: '255,255,160',
      wumi: '231,124,8',
      sunxiaomei: '204,26,32',
      xiaodanni: '32,23,254',
      jinbeibei: '14,189,189',
    };
    expect(CHARACTERS.length).toBe(12);
    for (const c of CHARACTERS) {
      expect(characterColorRgb(c.color).join(','), c.name).toBe(expected[c.key]);
    }
  });

  it('白色兜底也走同一条路（渲染侧无主时用 0xffffff）', () => {
    expect(characterColorRgb(0xffffff)).toEqual([255, 255, 255]);
  });
});
