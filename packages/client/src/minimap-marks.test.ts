/*
 * 小地圖／大地圖的归属色块 —— 第十三份試玩回報
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉住：三张表、各自的 owner 偏移、图号基数、朝向取低位、缩放位数、颜色 = 地主角色色、
 * 烙的顺序（地 → 設施 → 企業）。数据全部对 exe 逐字节校验。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import { minimapAt } from './hud.ts';
import { bigMapAt } from './big-map-screen.ts';
import {
  MINIMAP_MARK_IMAGE,
  MINIMAP_MARK_RESOURCE,
  MINIMAP_MARK_SHIFT,
  drawMinimapMarks,
  minimapMarks,
  type MinimapMarkTopo,
} from './minimap-marks.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const run = existsSync(EXE) ? it : it.skip;
/** AUTO：VA 0x401000 → 文件偏移 1024 */
const codeOff = (va: number): number => 1024 + (va - 0x401000);
const bytesAt = (d: Buffer, va: number, n: number): number[] => [...d.subarray(codeOff(va), codeOff(va) + n)];

function state(over: Partial<GameState> = {}): GameState {
  return {
    players: [
      { index: 0, character: 9 }, // 孫小美 0xcc1a20
      { index: 1, character: 10 }, // 小丹尼 0x2017fe
    ],
    landOwner: [],
    facilityOwner: [],
    commercialOwners: [],
    ...over,
  } as unknown as GameState;
}

const TOPO: MinimapMarkTopo = {
  lands: [
    { id: 1, x: 1024, y: 512, facing: 0 },
    { id: 2, x: 1100, y: 540, facing: 5 },
    { id: 3, x: 1200, y: 600, facing: 2 },
  ],
  facilities: [{ id: 1, x: 512, y: 1024, facing: 3 }],
  commercials: [
    { id: 1, x: 2000, y: 100, facing: 6 },
    { id: 2, x: 300, y: 300 }, // 手写夹具没有朝向 ⇒ 按 0
  ],
};

describe('★ 常量对 exe：`fcn_0040a4e1`（VA 0x0040a4e1）', () => {
  run('图号基数：地 0x16/0x1a、設施与企業 0x18/0x1c（`add eax, imm8`，前面是 `and eax, 0xff`）', () => {
    const d = readFileSync(EXE);
    const addEaxImm8 = (va: number): number => {
      expect(bytesAt(d, va, 2), `VA ${va.toString(16)}`).toEqual([0x83, 0xc0]);
      return d[codeOff(va) + 2]!;
    };
    expect(addEaxImm8(0x0040a57e)).toBe(MINIMAP_MARK_IMAGE.big.land);
    expect(addEaxImm8(0x0040a5c2)).toBe(MINIMAP_MARK_IMAGE.small.land);
    expect(addEaxImm8(0x0040a676)).toBe(MINIMAP_MARK_IMAGE.big.facility);
    expect(addEaxImm8(0x0040a6ba)).toBe(MINIMAP_MARK_IMAGE.small.facility);
    expect(addEaxImm8(0x0040a770)).toBe(MINIMAP_MARK_IMAGE.big.commercial);
    expect(addEaxImm8(0x0040a7b4)).toBe(MINIMAP_MARK_IMAGE.small.commercial);
  });

  run('朝向只取最低位：`mov al, [ebx+0x1b] / and al, 1`（六处）', () => {
    const d = readFileSync(EXE);
    for (const va of [0x0040a574, 0x0040a5b8, 0x0040a66c, 0x0040a6b0, 0x0040a766, 0x0040a7aa]) {
      expect(bytesAt(d, va, 5), `VA ${va.toString(16)}`).toEqual([0x8a, 0x43, 0x1b, 0x24, 0x01]);
    }
  });

  run('三张表与各自的 owner 偏移：地/設施 +0x19，★ 企業 +0x18', () => {
    const d = readFileSync(EXE);
    // mov ebx, [表基址]
    expect(bytesAt(d, 0x0040a51c, 6)).toEqual([0x8b, 0x1d, 0x84, 0x8e, 0x49, 0x00]); // 0x498e84 住宅
    expect(bytesAt(d, 0x0040a614, 6)).toEqual([0x8b, 0x1d, 0x88, 0x8e, 0x49, 0x00]); // 0x498e88 設施
    expect(bytesAt(d, 0x0040a70e, 6)).toEqual([0x8b, 0x1d, 0x7c, 0x8e, 0x49, 0x00]); // 0x498e7c 企業
    // cmp byte [ebx + off], 0
    expect(bytesAt(d, 0x0040a531, 4)).toEqual([0x80, 0x7b, 0x19, 0x00]);
    expect(bytesAt(d, 0x0040a629, 4)).toEqual([0x80, 0x7b, 0x19, 0x00]);
    expect(bytesAt(d, 0x0040a723, 4)).toEqual([0x80, 0x7b, 0x18, 0x00]);
  });

  run('颜色 = 地主 `player+0x04`：`push [ebp + 0x496b6c]`（三处），图集 = `[0x48bad8]`', () => {
    const d = readFileSync(EXE);
    for (const va of [0x0040a5cd, 0x0040a6c5, 0x0040a7bf]) {
      expect(bytesAt(d, va, 6), `VA ${va.toString(16)}`).toEqual([0xff, 0xb5, 0x6c, 0x6b, 0x49, 0x00]);
    }
    expect(bytesAt(d, 0x0040a5d5, 6)).toEqual([0x8b, 0x0d, 0xd8, 0xba, 0x48, 0x00]);
    expect(MINIMAP_MARK_RESOURCE).toBe(517);
  });

  run('缩放：侧栏 `shl ecx, 6`（>>10）、大地圖 `shl ecx, 7`（>>9），再 `sar 0x10`', () => {
    const d = readFileSync(EXE);
    expect(bytesAt(d, 0x0040a597, 6)).toEqual([0xc1, 0xe1, 0x06, 0xc1, 0xf9, 0x10]);
    expect(bytesAt(d, 0x0040a553, 6)).toEqual([0xc1, 0xe1, 0x07, 0xc1, 0xf9, 0x10]);
    expect(MINIMAP_MARK_SHIFT).toEqual({ small: 10, big: 9 });
  });

  run('`fcn_00456384` = 按锚点摆、非 0 像素写成同一种颜色', () => {
    const d = readFileSync(EXE);
    // sub [ebp+0x10], [esi+4] 之前取锚点：movsx eax, word [esi+4] / sub [ebp+0x10], eax
    expect(bytesAt(d, 0x0045639c, 7)).toEqual([0x0f, 0xbf, 0x46, 0x04, 0x29, 0x45, 0x10]);
    // lodsw / or ax,ax / je / mov [edi], bx
    expect(bytesAt(d, 0x004563d8, 10)).toEqual([0x66, 0xad, 0x66, 0x0b, 0xc0, 0x74, 0x03, 0x66, 0x89, 0x1f]);
  });
});

describe('`minimapMarks`：这一帧要烙哪几块', () => {
  it('★ 无主的一块都不画', () => {
    expect(minimapMarks(state(), TOPO, 'small')).toEqual([]);
  });

  it('★ 地 → 設施 → 企業 的顺序；图号 = 基数 + (朝向 & 1)；颜色 = 地主角色色', () => {
    const s = state({
      landOwner: [0, 1, 0, 2],
      facilityOwner: [0, 2],
      commercialOwners: [undefined, { owner: 1 }, { owner: 2 }] as unknown as GameState['commercialOwners'],
    });
    const small = minimapMarks(s, TOPO, 'small');
    expect(small.map((m) => [m.image, m.owner])).toEqual([
      [0x16, 1], // 地 1，朝向 0 ⇒ 方
      [0x16, 2], // 地 3，朝向 2 ⇒ 方
      [0x19, 2], // 設施 1，朝向 3 ⇒ 菱
      [0x18, 1], // 企業 1，朝向 6 ⇒ 方
      [0x18, 2], // 企業 2，无朝向 ⇒ 方
    ]);
    expect(small[0]!.color).toBe(CHARACTERS[9]!.color);
    expect(small[1]!.color).toBe(CHARACTERS[10]!.color);
    // 位置：与 hud 的 `minimapAt` 同一段定点乘法
    expect([small[0]!.x, small[0]!.y]).toEqual([minimapAt(1024), minimapAt(512)]);

    const big = minimapMarks(s, TOPO, 'big');
    expect(big.map((m) => m.image)).toEqual([0x1a, 0x1a, 0x1d, 0x1c, 0x1c]);
    expect([big[2]!.x, big[2]!.y]).toEqual([bigMapAt(512), bigMapAt(1024)]);
  });

  it('奇数朝向 ⇒ 菱形那张（地 5 ⇒ 0x17）', () => {
    const s = state({ landOwner: [0, 0, 1] });
    expect(minimapMarks(s, TOPO, 'small').map((m) => m.image)).toEqual([0x17]);
  });
});

describe('`drawMinimapMarks`：取抠黑的图、按锚点摆', () => {
  it('★ 取图用抠黑的 Data.mkf 517；取不到图就跳过', () => {
    const asked: number[] = [];
    const ctx = { drawImage: () => undefined } as unknown as CanvasRenderingContext2D;
    drawMinimapMarks(
      ctx,
      (image) => {
        asked.push(image);
        return null;
      },
      [{ image: 0x16, x: 1, y: 2, owner: 1, color: 0xff0000 }],
      0,
      0,
    );
    expect(asked).toEqual([0x16]);
  });
});
