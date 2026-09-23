/*
 * 物件投放时「这一格有没有人」—— 照原版节点 `+0x24` 的玩家 / 惡人占用位
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第十五份試玩回報 #2 的后续（协调方裁定「照原版的占用位」）：
 * 关押 / 消失 / 住店那几支进去时把自己那一位**清掉、新格不置**，释放时才重新登记 ⇒
 * 这期间他站的那一格（監獄 / 醫院关押格、旅館格…）照样能冒出神明。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { runtimeOccupiedNodes } from './object-landing.ts';
import { ACTOR_PLACE } from './special-actors.ts';

const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const runExe = existsSync(EXE) ? it : it.skip;
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}

const blocked = (field: 'inPrison' | 'inHospital' | 'inHotel' | 'disappearing', v: number) => {
  const p = makePlayer({ index: 0, nodeId: 9 });
  return { ...p, blocking: { ...p.blocking, [field]: v } };
};

describe('★★ runtimeOccupiedNodes：关着 / 住店 / 消失的人不占位', () => {
  it('站在格上的自由人占位（原样）', () => {
    expect(runtimeOccupiedNodes([makePlayer({ index: 0, nodeId: 9 })], []).has(9)).toBe(true);
  });

  for (const field of ['inPrison', 'inHospital', 'inHotel', 'disappearing'] as const) {
    it(`${field} 计数非 0（含 0x80 待释放）⇒ 不占位`, () => {
      expect(runtimeOccupiedNodes([blocked(field, 3)], []).has(9)).toBe(false);
      expect(runtimeOccupiedNodes([blocked(field, 0x80)], []).has(9)).toBe(false);
    });
  }

  it('★ 在棋盘上的惡人占位（bits 12..15）；关着的 / 没出场的 / 機器娃娃不占', () => {
    const actors = [
      { nodeId: 5, place: ACTOR_PLACE.board },
      { nodeId: 6, place: ACTOR_PLACE.prison },
      { nodeId: 0, place: ACTOR_PLACE.hospital },
      { nodeId: 7, place: ACTOR_PLACE.board },
      { nodeId: 8, place: ACTOR_PLACE.board }, // 第 5 项 = 機器娃娃
    ];
    const occ = runtimeOccupiedNodes([], [], actors);
    expect([...occ].sort()).toEqual([5, 7]);
  });

  runExe('★ 回 exe 钉：进去时 `and [node+0x24], ~(0x100<<idx)`，释放时才 `or` 回来', () => {
    // send_to_prison 0x0043d61d  and dword [eax + esi*8 + 0x24], edi（edi = ~(0x100<<idx)，0x0043d5a2 not edi）
    expect(exeBytes(0x43d61d, 4)).toEqual([0x21, 0x7c, 0xf0, 0x24]);
    expect(exeBytes(0x43d5a2, 2)).toEqual([0xf7, 0xd7]);
    // 消失 0x0040d444  and dword [esi + 0x24], eax（eax = ~edi，0x0040d442 not eax）
    expect(exeBytes(0x40d442, 5)).toEqual([0xf7, 0xd0, 0x21, 0x46, 0x24]);
    // 住店 0x0040d5d2  and dword [edx + eax*8 + 0x24], ecx（ecx = ~(0x100<<idx)，0x0040d5b5 not ecx）
    expect(exeBytes(0x40d5d2, 4)).toEqual([0x21, 0x4c, 0xc2, 0x24]);
    expect(exeBytes(0x40d5b5, 2)).toEqual([0xf7, 0xd1]);
    // 释放：0x0040d737 or [..+0x24], esi（住店 / 監獄 / 醫院共用 0x40d6be）；消失 0x0040d526 or [..+0x24], ebx
    expect(exeBytes(0x40d737, 4)).toEqual([0x09, 0x74, 0xc2, 0x24]);
    expect(exeBytes(0x40d526, 4)).toEqual([0x09, 0x5c, 0xc1, 0x24]);
  });
});
