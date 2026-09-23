/*
 * `_rich4_create_font` 的字效位 —— bit0 阴影 / bit1 粗体 / bit2 描边
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOX_TEXT_STYLE, gdiFont, gdiPasses } from './font.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const EXE = `${ROOT}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;
const bytes = (va: number, n: number): number[] => {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
};

describe('★ 字效 @source 0x0044fc31 / 0x0044fccc / 0x0044fe1e / 0x0044fa3f', () => {
  it('bit0 = 第二色在 (+1,+1) 一遍阴影，正文在 (0,0)', () => {
    expect(gdiPasses(1)).toEqual([
      { dx: 1, dy: 1, second: true },
      { dx: 0, dy: 0, second: false },
    ]);
    expect(gdiPasses(3)).toEqual(gdiPasses(1));
  });
  it('bit2（bit0 没置）= 四遍描边 (1,0)(1,2)(0,1)(2,1)，正文挪到 (+1,+1)', () => {
    expect(gdiPasses(4).map((p) => [p.dx, p.dy, p.second])).toEqual([
      [1, 0, true],
      [1, 2, true],
      [0, 1, true],
      [2, 1, true],
      [1, 1, false],
    ]);
  });
  it('bit1 = 粗体；0/2 都只有正文一遍', () => {
    expect(gdiFont({ ...BOX_TEXT_STYLE, flags: 2 })).toMatch(/^bold 16px/);
    expect(gdiFont({ ...BOX_TEXT_STYLE, flags: 1 })).toMatch(/^16px/);
    expect(gdiPasses(0)).toEqual([{ dx: 0, dy: 0, second: false }]);
    expect(gdiPasses(2)).toEqual([{ dx: 0, dy: 0, second: false }]);
  });

  runExe('exe：阴影支 `mov eax,1` 两个偏移都是 1；描边支四组偏移；粗体 0x2bc / 0x190', () => {
    expect(bytes(0x0044fc37, 3)).toEqual([0xf6, 0xc6, 0x01]); // test dh, 1
    expect(bytes(0x0044fc56, 5)).toEqual([0xb8, 0x01, 0x00, 0x00, 0x00]); // mov eax, 1 → (1,1)
    expect(bytes(0x0044fccc, 3)).toEqual([0xf6, 0xc6, 0x04]); // test dh, 4
    expect(bytes(0x0044fe1e, 7)).toEqual([0xf6, 0x05, 0xd8, 0x62, 0x47, 0x00, 0x04]); // test byte [0x4762d8], 4
    expect(bytes(0x0044fa3f, 5)).toEqual([0xf6, 0x44, 0x24, 0x14, 0x02]); // test byte [esp+0x14], 2
    expect(bytes(0x0044fa46, 5)).toEqual([0xbb, 0xbc, 0x02, 0x00, 0x00]); // mov ebx, 0x2bc
  });

  runExe('★ 八处框模板的 create_font 逐字节同参 `push 1 / push 3 / push 0x101010 / push 0xf0f0f0 / push 0x10`', () => {
    // 每处 call 之前 15 字节：6a 01 6a 03 68 10 10 10 00 68 f0 f0 f0 00 6a 10
    const want = [0x6a, 0x01, 0x6a, 0x03, 0x68, 0x10, 0x10, 0x10, 0x00, 0x68, 0xf0, 0xf0, 0xf0, 0x00, 0x6a, 0x10];
    for (const call of [0x0044073a, 0x0044094e, 0x00440ac2, 0x00440bbf, 0x00440d16, 0x00440f10, 0x004410fd, 0x00441fa1]) {
      expect({ call, b: bytes(call - 16, 16) }).toEqual({ call, b: want });
    }
    expect(BOX_TEXT_STYLE).toEqual({ size: 0x10, color: '#f0f0f0', color2: '#101010', flags: 3, spacing: 1 });
  });
});
