/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 「走回棋盘」那一段动画**有多长** —— 用来证明「清四个计数」的两段折叠**等价**。
 *
 * 原版把「刑满释放」拆成两段（见 `rich4-spec/docs/systems/game-loop.md`
 * §「释放是两段式」）：
 *   ① `0x0040d6be`（立 `+0x15 & 0x10` 标记，**不动** `+0x32..+0x35`）；
 *   ② `0x0040c05c` 走路例程里才 `mov dword [player+0x32], 0` —— **有条件**：
 *      `+0x15 & 0x30` 且 `[0x4749dc] < [0x48baf4]`，其中
 *      `[0x4749dc] = trunc(距离 × 0.125)`、`[0x48baf4] = 帧数 >> 1`。
 *
 * 本引擎在 `reduce.ts` 的 `startTurn` 里把两段折叠成一段（看到 `0x10` 就清四个计数），
 * 这是**有意偏离**。本测试用**出厂地图** 0001.bin 的实测几何把「折叠安全」钉死：
 * 走回棋盘的起终点（綠島／醫院大樓 景观记录 → **关押格**）距离恒 > 16 px，
 * 于是 `trunc(dist × 0.125) >= 2` ⇒ 半程 > 0 ⇒ 原版那一次清账**必然发生**。
 *
 * ★★ 2026-09-19 订正：关押格是**节点 `type` == 0x1f42/0x1f41** 的那一格
 *   （原版载入时扫进 `[0x48bae0]`/`[0x48bae2]`，见 `rules/confinement.ts` 的
 *   `CONFINEMENT_GATE_TYPE`），不是 `specialKind` 4/5 的**落点**特殊格。
 *   0001.bin 上：監獄 = **节点 1** @(1752,1871)、醫院 = **节点 23** @(384,1056)；
 *   带保釋菜单的落点格是另外两个（12 @(1248,1583) / 16 @(767,1631)）。
 *   释放那一回合的走路终点是 `player.nodeId` = 关押格，故本测试改用关押格测距。
 *
 * 通道 2 证据（帧数公式本身）：`rich4-spec/tests/test_walk_step.py` §E/§G/§H。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { CONFINEMENT_GATE_TYPE } from './confinement.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

/** 原版走回棋盘的拍数：`trunc(dist × 0.125)`（`@source 0x0040c5e6` 那条特殊支） */
const frames = (dist: number) => Math.trunc(dist * 0.125);

describe('走回棋盘的拍数 —— 证明「清四个计数」的折叠等价', () => {
  const map = existsSync(MAP) ? parseMap(new Uint8Array(readFileSync(MAP))) : null;

  run('关押格 → 各自的景观记录（綠島／醫院大樓）：拍数远大于 2', () => {
    const m = map!;
    const gate = (kind: 'prison' | 'hospital', landscapeIdx: number) => {
      const nodes = m.nodes.filter((n) => n.type === CONFINEMENT_GATE_TYPE[kind]);
      expect(nodes.length, `地图里应当恰好有一个 type=${kind} 的关押格`).toBe(1);
      const n = nodes[0]!;
      const l = m.landscapes[landscapeIdx]!;
      const dist = Math.hypot(l.x - n.x, l.y - n.y);
      return { n, l, dist, frames: frames(dist) };
    };
    // 醫院 = 景观记录 1（数组下标 0），監獄 = 记录 2（下标 1）
    const hosp = gate('hospital', 0);
    expect(hosp.n.id, '醫院关押格').toBe(23);
    expect([hosp.n.x, hosp.n.y]).toEqual([384, 1056]);
    expect([hosp.l.x, hosp.l.y]).toEqual([319, 990]); // 醫院大樓
    expect(hosp.dist).toBeCloseTo(92.63, 1);
    expect(hosp.frames).toBe(11);

    const jail = gate('prison', 1);
    expect(jail.n.id, '監獄关押格').toBe(1);
    expect([jail.n.x, jail.n.y]).toEqual([1752, 1871]);
    expect([jail.l.x, jail.l.y]).toEqual([1817, 1960]); // 綠島
    expect(jail.dist).toBeCloseTo(110.21, 1);
    expect(jail.frames).toBe(13);
  });

  run('★ 折叠条件：半程 = 拍数 >> 1 必须 > 0（否则原版那一次清账会被跳过）', () => {
    const m = map!;
    for (const [kind, idx, name] of [
      ['hospital', 0, '醫院'],
      ['prison', 1, '監獄'],
    ] as const) {
      const n = m.nodes.find((x) => x.type === CONFINEMENT_GATE_TYPE[kind])!;
      const l = m.landscapes[idx]!;
      const f = frames(Math.hypot(l.x - n.x, l.y - n.y));
      expect(f, `${name}：拍数`).toBeGreaterThanOrEqual(2);
      expect(f >> 1, `${name}：半程`).toBeGreaterThan(0);
    }
  });
});
