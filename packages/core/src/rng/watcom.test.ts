/*
 * PRNG 黄金测试 —— 测试向量直接来自对 Rich4/rich4.exe 的反汇编与模拟执行
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { WatcomRng, RAND_MAX, rollDice, drawRandomCard } from './watcom.ts';

describe('WatcomRng — 与原版 rich4.exe 位级一致', () => {
  it('RAND_MAX = 32767', () => {
    expect(RAND_MAX).toBe(32767);
  });

  // 以下四组向量为原版 LCG 的精确输出
  // @source Rich4/rich4.exe VA 0x00456F2D
  it.each([
    { seed: 1, expected: [16838, 5758, 10113, 17515, 31051, 5627, 23010, 7419, 16212, 4086] },
    { seed: 0, expected: [0, 21468, 9988, 22117, 3498, 16927, 16045, 19741, 12122, 8410] },
    { seed: 12345, expected: [21468, 9988, 22117, 3498, 16927, 16045, 19741, 12122, 8410, 12261] },
    { seed: 0x12345678, expected: [2929, 28487, 11805, 6548, 9708, 30601, 8339, 27335, 9796, 5052] },
  ])('srand($seed) 的前 10 个 rand()', ({ seed, expected }) => {
    const rng = new WatcomRng(seed);
    const got = Array.from({ length: 10 }, () => rng.next());
    expect(got).toEqual(expected);
  });

  it('默认种子为 1（原版 CRT 启动值）', () => {
    // @source rich4.exe __initthread @ VA 0x0045C8E3
    expect(new WatcomRng().next()).toBe(16838);
  });

  it('输出恒在 [0, 32767] 内', () => {
    const rng = new WatcomRng(0xdeadbeef);
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(RAND_MAX);
    }
  });

  it('状态可存取，用于存档与断线重连', () => {
    const a = new WatcomRng(1);
    for (let i = 0; i < 37; i++) a.next();
    const snapshot = a.getState();

    const b = new WatcomRng();
    b.setState(snapshot);

    expect(Array.from({ length: 20 }, () => b.next()))
      .toEqual(Array.from({ length: 20 }, () => a.next()));
  });

  it('C-DET-4：同种子必然产出逐位相同的序列', () => {
    const seq = (s: number) => {
      const r = new WatcomRng(s);
      return Array.from({ length: 500 }, () => r.next());
    };
    expect(seq(42)).toEqual(seq(42));
  });
});

describe('rollDice — 原版掷骰', () => {
  it('srand(1) 下单骰序列 = rand()%6+1', () => {
    // @source 原版 fcn_00419572
    const rng = new WatcomRng(1);
    const got = Array.from({ length: 10 }, () => rollDice(rng, 1).sum);
    expect(got).toEqual([3, 5, 4, 2, 2, 6, 1, 4, 1, 1]);
  });

  it('多骰按下标顺序消耗 rand()，消耗次数 = diceCount', () => {
    const a = new WatcomRng(1);
    const three = rollDice(a, 3);
    expect(three.dice).toEqual([3, 5, 4]); // 与单骰序列的前三个一致
    expect(three.sum).toBe(12);

    // 验证恰好消耗 3 次
    const b = new WatcomRng(1);
    b.next(); b.next(); b.next();
    expect(b.getState()).toBe(a.getState());
  });

  it('遥控骰子：不消耗 rand()，且骰子数被强制压成 1', () => {
    const rng = new WatcomRng(1);
    const before = rng.getState();
    const r = rollDice(rng, 3, 5); // 即使有 3 颗骰
    expect(r.dice).toEqual([5]);   // 也只出 1 颗
    expect(r.sum).toBe(5);
    expect(rng.getState()).toBe(before); // 状态未推进
  });

  it('C-FID-4：必须保留原版的 %6 模偏差，不得"修正"为无偏采样', () => {
    // 32768 = 6*5461 + 2，故点数 1 和 2 的出现频率略高
    const rng = new WatcomRng(1);
    const tally = [0, 0, 0, 0, 0, 0, 0];
    const N = 600_000;
    for (let i = 0; i < N; i++) tally[rollDice(rng, 1).sum]! += 1;

    // 六个面都接近 N/6，但不完全相等——正是模偏差的体现
    for (let face = 1; face <= 6; face++) {
      expect(tally[face]).toBeGreaterThan(N / 6 - 2000);
      expect(tally[face]).toBeLessThan(N / 6 + 2000);
    }
    // 低面点数总和应当略高于高面点数总和
    const low = tally[1]! + tally[2]!;
    const high = tally[5]! + tally[6]!;
    expect(low).toBeGreaterThan(high);
  });
});

describe('drawRandomCard — 牌袋算法', () => {
  it('按剩余数量加权，而非等概率取模', () => {
    const remain = new Array<number>(30).fill(0);
    remain[0] = 99; // 卡 id 0 占绝大多数
    remain[5] = 1;
    const rng = new WatcomRng(1);
    let idx0 = 0;
    for (let i = 0; i < 1000; i++) {
      if (drawRandomCard(rng, remain) === 1) idx0++; // 返回值是 1 基
    }
    expect(idx0).toBeGreaterThan(950);
  });

  it('返回 1 基卡号', () => {
    const remain = new Array<number>(30).fill(0);
    remain[7] = 1; // 只有 id=7 这一张
    expect(drawRandomCard(new WatcomRng(1), remain)).toBe(8);
  });

  it('牌袋为空时返回 0', () => {
    expect(drawRandomCard(new WatcomRng(1), new Array<number>(30).fill(0))).toBe(0);
  });
});
