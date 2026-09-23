/*
 * 关押 / 消失影片前后的镜头（`view_to`）—— `confineViewTargets`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第十四份試玩回報追加（协调方）：警车起播前原版先把镜头移到受害者身上（`0x0043d5cc`），
 * 救护车（`0x0043ec78`）/ 飛碟・飛機（`0x0040d3e6`）同形；監獄 / 醫院播完再移到新位置
 * （`0x0043d6f1` / `0x0043eda0`）。序列见 `confine-view.ts` 文件头。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import { confineViewTargets } from './confine-view.ts';

const EXE = `${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;

function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}
/** `call rel32` 的落点 */
function callTarget(va: number): number {
  const b = exeBytes(va, 5);
  expect(b[0]).toBe(0xe8);
  const rel = (b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24)) | 0;
  return va + 5 + rel;
}

describe('★ 回 exe 钉：三个函数里的 view_to（0x41d476）', () => {
  runExe('送監獄：① 0x0043d5cc、② 0x0043d6f1；加刑那一支（test dh,dh / jne）跳过的是播片，不是 ①', () => {
    expect(callTarget(0x43d5cc)).toBe(0x41d476);
    expect(callTarget(0x43d6f1)).toBe(0x41d476);
    expect(exeBytes(0x43d5da, 8)).toEqual([0x84, 0xf6, 0x0f, 0x85, 0xdb, 0x00, 0x00, 0x00]);
  });
  runExe('送醫院：① 0x0043ec78、② 0x0043eda0', () => {
    expect(callTarget(0x43ec78)).toBe(0x41d476);
    expect(callTarget(0x43eda0)).toBe(0x41d476);
  });
  runExe('消失：① 0x0040d3e6，前面 0x0040d3a4 `test ah,ah / jne` —— 本来在消失就整段跳过', () => {
    expect(callTarget(0x40d3e6)).toBe(0x41d476);
    expect(exeBytes(0x40d3a4, 4)).toEqual([0x84, 0xe4, 0x0f, 0x85]);
  });
  runExe('view_to：目标 == 行动者坐标 ⇒ 清标记（0x0041d4d0..0x0041d4de）', () => {
    expect(exeBytes(0x41d4d0, 20)).toEqual([
      0x3b, 0x54, 0x24, 0x08, 0x75, 0x10, 0x3b, 0x44, 0x24, 0x0c, 0x75, 0x0a, 0x31, 0xed, 0x89, 0x2d, 0x18, 0xbe,
      0x48, 0x00,
    ]);
  });
});

describe('confineViewTargets', () => {
  const blocking = makePlayer().blocking;
  const occ = (i: number): number[] => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0));

  it('★ 陷害别人（P0 行动、P1 入獄）：① 受害者原位置、② 監獄', () => {
    const before = makeGameState({
      currentPlayer: 0,
      players: [makePlayer({ index: 0, xpos: 10, ypos: 20 }), makePlayer({ index: 1, xpos: 300, ypos: 400 })],
    });
    const after = makeGameState({
      currentPlayer: 0,
      prisonOccupancy: occ(1),
      players: [
        before.players[0]!,
        makePlayer({ index: 1, xpos: 900, ypos: 950, blocking: { ...blocking, inPrison: 5 } }),
      ],
    });
    expect(confineViewTargets(before, after)).toEqual([
      { player: 1, kind: 'prison', from: { x: 300, y: 400 }, to: { x: 900, y: 950 }, extended: false },
    ]);
  });

  it('受害者就是行动者（踩狗 / 陷害自己）⇒ from / to 都是 null（view_to 清标记，看行动者）', () => {
    const before = makeGameState({ currentPlayer: 0, players: [makePlayer({ index: 0, xpos: 10, ypos: 20 })] });
    const after = makeGameState({
      currentPlayer: 0,
      hospitalOccupancy: occ(0),
      players: [makePlayer({ index: 0, xpos: 700, ypos: 800, blocking: { ...blocking, inHospital: 3 } })],
    });
    expect(confineViewTargets(before, after)).toEqual([{ player: 0, kind: 'hospital', from: null, to: null, extended: false }]);
  });

  it('飛碟 / 飛機：只有 ①（to = null）；本来就在消失 ⇒ 不移', () => {
    const before = makeGameState({
      currentPlayer: 0,
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1, xpos: 50, ypos: 60 })],
    });
    const after = makeGameState({
      currentPlayer: 0,
      players: [before.players[0]!, makePlayer({ index: 1, xpos: 50, ypos: 60, blocking: { ...blocking, disappearing: 0x43 } })],
    });
    expect(confineViewTargets(before, after)).toEqual([{ player: 1, kind: 'disappear', from: { x: 50, y: 60 }, to: null, extended: false }]);
    const again = makeGameState({
      currentPlayer: 0,
      players: [before.players[0]!, makePlayer({ index: 1, blocking: { ...blocking, disappearing: 0x42 } })],
    });
    const more = makeGameState({
      currentPlayer: 0,
      players: [before.players[0]!, makePlayer({ index: 1, blocking: { ...blocking, disappearing: 0x45 } })],
    });
    expect(confineViewTargets(again, more)).toEqual([]);
  });

  it('★ 加刑（原计数非 0，含待释放 0x80）：extended = true，① ② 照给（都在监獄里）', () => {
    const at = { xpos: 900, ypos: 950 };
    const before = makeGameState({
      currentPlayer: 0,
      prisonOccupancy: occ(1),
      hospitalOccupancy: occ(1),
      players: [
        makePlayer({ index: 0 }),
        makePlayer({ index: 1, ...at, blocking: { ...blocking, inPrison: 2, inHospital: 0x80 } }),
      ],
    });
    const after = makeGameState({
      currentPlayer: 0,
      prisonOccupancy: occ(1),
      hospitalOccupancy: occ(1),
      players: [
        before.players[0]!,
        makePlayer({ index: 1, ...at, blocking: { ...blocking, inPrison: 7, inHospital: 3 } }),
      ],
    });
    expect(confineViewTargets(before, after)).toEqual([
      { player: 1, kind: 'hospital', from: { x: 900, y: 950 }, to: { x: 900, y: 950 }, extended: true },
      { player: 1, kind: 'prison', from: { x: 900, y: 950 }, to: { x: 900, y: 950 }, extended: true },
    ]);
  });

  it('计数高位 0x80（待释放）不算加刑：1 → 0x80 没有镜头', () => {
    const before = makeGameState({
      currentPlayer: 0,
      hospitalOccupancy: occ(1),
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1, blocking: { ...blocking, inHospital: 1 } })],
    });
    const after = makeGameState({
      currentPlayer: 0,
      hospitalOccupancy: occ(1),
      players: [before.players[0]!, makePlayer({ index: 1, blocking: { ...blocking, inHospital: 0x80 } })],
    });
    expect(confineViewTargets(before, after)).toEqual([]);
  });

  it('什么都没发生 ⇒ 空', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })] });
    expect(confineViewTargets(s, s)).toEqual([]);
  });
});
