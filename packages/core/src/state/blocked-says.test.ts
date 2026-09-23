/*
 * 回合开始被挡：坐牢 / 住院 / 冬眠三句台词各自的 1/2 判定（第十三份試玩回報，需求方拍板「按原版」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `fcn_0040c912`（主循环 `0x00418d70 push 0` 那一路）：
 *   坐牢 `0x0040ca20`、住院 `0x0040ca99`、冬眠 `0x0040cb1b` 各 `call rand / test al,1 / je`；
 *   冬眠还要 `dword [+0x32] == 0`（`0x0040cb12`：住宿/消失/坐牢/住院全为 0）。
 */
import { describe, expect, it } from 'vitest';
import { WatcomRng } from '../rng/watcom.ts';
import { rollBlockedSays } from './reduce.ts';
import type { Player } from './types.ts';

const blocking = (over: Partial<Player['blocking']>): Player['blocking'] =>
  ({ inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, ...over }) as Player['blocking'];

/** 从 `seed` 起连取 n 个 rand() 的最低位 */
function bits(seed: number, n: number): number[] {
  const r = new WatcomRng();
  r.setState(seed);
  return Array.from({ length: n }, () => r.next() & 1);
}

/** 找一个种子，使前 n 个 rand() 的最低位恰为 `want` */
function seedFor(want: number[]): number {
  for (let s = 1; s < 100000; s++) if (bits(s, want.length).join() === want.join()) return s;
  throw new Error('找不到种子');
}

function advance(seed: number, n: number): number {
  const r = new WatcomRng();
  r.setState(seed);
  for (let i = 0; i < n; i++) r.next();
  return r.getState();
}

describe('rollBlockedSays（fcn_0040c912 的三处 rand）', () => {
  it('★ 坐牢：掷一次，最低位 1 ⇒ 说事件 19；0 ⇒ 不说；两种都只消耗一个 rand', () => {
    const odd = seedFor([1]);
    expect(rollBlockedSays(odd, blocking({ inPrison: 3 }))).toEqual({ rngState: advance(odd, 1), says: [19] });
    const even = seedFor([0]);
    expect(rollBlockedSays(even, blocking({ inPrison: 3 }))).toEqual({ rngState: advance(even, 1), says: [] });
  });

  it('★ 坐牢与住院各掷一次、互相独立（先坐牢后住院）', () => {
    const s = seedFor([0, 1]);
    expect(rollBlockedSays(s, blocking({ inPrison: 2, inHospital: 2 }))).toEqual({ rngState: advance(s, 2), says: [20] });
  });

  it('★ 冬眠：只有住宿/消失/坐牢/住院全为 0 才掷（`cmp dword [+0x32],0`）', () => {
    const s = seedFor([1, 1]);
    expect(rollBlockedSays(s, blocking({ sleeping: 4 }))).toEqual({ rngState: advance(s, 1), says: [21] });
    // 同时在住院：只掷住院那一次，冬眠不掷
    expect(rollBlockedSays(s, blocking({ sleeping: 4, inHospital: 2 }))).toEqual({ rngState: advance(s, 1), says: [20] });
    // 同时住宿：冬眠不掷，住宿本身也不掷（原版住宿/消失只出文字）
    expect(rollBlockedSays(s, blocking({ sleeping: 4, inHotel: 1 }))).toEqual({ rngState: s, says: [] });
  });

  it('★ 住宿 / 消失：不掷随机数', () => {
    expect(rollBlockedSays(12345, blocking({ inHotel: 3 }))).toEqual({ rngState: 12345, says: [] });
    expect(rollBlockedSays(12345, blocking({ disappearing: 3 }))).toEqual({ rngState: 12345, says: [] });
  });

  it('大样本约一半说', () => {
    let said = 0;
    for (let s = 1; s <= 2000; s++) said += rollBlockedSays(s * 7919, blocking({ inPrison: 1 })).says.length;
    expect(said).toBeGreaterThan(800);
    expect(said).toBeLessThan(1200);
  });
});
