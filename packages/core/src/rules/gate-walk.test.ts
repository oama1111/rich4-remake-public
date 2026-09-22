/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 「走回棋盘」那一段动画**有多长、从哪到哪** —— 规格几何（`rules/gate-walk.ts`）。
 *
 * 原版把「刑满释放」拆成两段（见 `rich4-spec/docs/systems/game-loop.md`
 * §「释放是两段式」）：
 *   ① `0x0040d6be`（立 `+0x15 & 0x10` 标记，**不动** `+0x32..+0x35`）；
 *   ② `0x0040c05c` 走路例程的 `0x10` 分支把棋子从**贴图位置**走回 `player.nodeId` 那一格，
 *      并在**半程**才 `mov dword [player+0x32], 0` —— **有条件**：
 *      `+0x15 & 0x30` 且 `[0x4749dc] < [0x48baf4]`，其中
 *      `[0x4749dc]` = 拍数、`[0x48baf4]` = 总拍数 >> 1。
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
// 释放时的朝向那条用它 —— `0x454fb4` 就是 `reduce.ts` 的 `directionOf`
import { directionOf } from '../state/reduce.ts';
import { CONFINEMENT_GATE_TYPE } from './confinement.ts';
import { GATE_WALK_SPEED_RECIP, GATE_WALK_STEPS, gateWalkPlan, gateWalkPlanFrom } from './gate-walk.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

/**
 * 普通走法的速度表 —— 只用来**反证**「走回棋盘不能用交通方式」。
 * @source VA 0x004749d8（走路 8 / 機車 12 / 汽車 16 / 船 8）
 */
const WALK_SPEED = [8, 12, 16, 8] as const;

describe('走回棋盘的拍数 —— 证明「清四个计数」的折叠等价', () => {
  const map = existsSync(MAP) ? parseMap(new Uint8Array(readFileSync(MAP))) : null;

  run('关押格 → 各自的景观记录（綠島／醫院大樓）：拍数远大于 2', () => {
    const m = map!;
    const gate = (kind: 'prison' | 'hospital', landscapeIdx: number) => {
      const nodes = m.nodes.filter((n) => n.type === CONFINEMENT_GATE_TYPE[kind]);
      expect(nodes.length, `地图里应当恰好有一个 type=${kind} 的关押格`).toBe(1);
      const n = nodes[0]!;
      const l = m.landscapes[landscapeIdx]!;
      const plan = gateWalkPlan(kind, m.nodes, m.landscapes)!;
      // 起点必须是**景观记录**（在押期间的贴图位置），终点必须是**关押格节点**
      expect(plan.from).toEqual({ x: l.x, y: l.y });
      expect(plan.to).toEqual({ x: n.x, y: n.y });
      expect(plan.gateNodeId).toBe(n.id);
      return { n, l, dist: plan.distance, frames: plan.ticks, plan };
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
    for (const [kind, name] of [
      ['hospital', '醫院'],
      ['prison', '監獄'],
    ] as const) {
      const f = gateWalkPlan(kind, m.nodes, m.landscapes)!.ticks;
      expect(f, `${name}：拍数`).toBeGreaterThanOrEqual(2);
      expect(f >> 1, `${name}：半程`).toBeGreaterThan(0);
    }
  });
});

/**
 * ★★ 可证伪：走回棋盘的拍数**只由世界距离定**（`dist × 0.125`），
 *   与交通方式无关。若照普通走子查速度表 `[0x4749d8]`，機車/汽車会算出更少的拍
 *   ⇒ 下面每一条都会红。
 *
 * @source `0x40c26d test byte [player+0x15], 0x30 / je 0x40c282`（特殊支）
 *   + `0x40c27a fmul dword [0x4631dc]`；`0x40c0ba` 与 `0x40c26d` 读的是同一个字节，
 *   中间无写入 ⇒ 走回棋盘必然走这一支。
 */
describe('★ 走回棋盘：走几格、用什么速度（与交通方式无关）', () => {
  const map = existsSync(MAP) ? parseMap(new Uint8Array(readFileSync(MAP))) : null;

  it('只走**一格** @source 0x0040dd40 `mov dword [0x48baf8], 1`', () => {
    expect(GATE_WALK_STEPS).toBe(1);
  });

  it('速度倒数就是 0.125f @source VA 0x004631dc', () => {
    expect(GATE_WALK_SPEED_RECIP).toBe(0.125);
  });

  run('★★ 四种交通方式算出来的拍数**必须一样**（機車/汽車不许更快）', () => {
    const m = map!;
    for (const kind of ['hospital', 'prison'] as const) {
      const plan = gateWalkPlan(kind, m.nodes, m.landscapes)!;
      const byTraffic = WALK_SPEED.map((s) => Math.trunc(plan.distance / s));
      // 特殊支：一个值；普通支：機車/汽車会明显更少
      expect(plan.ticks).toBe(Math.trunc(plan.distance * GATE_WALK_SPEED_RECIP));
      expect(byTraffic[0], `${kind}：走路（恰好同为 8/tick）`).toBe(plan.ticks);
      expect(byTraffic[1], `${kind}：機車若走普通支会少`).not.toBe(plan.ticks);
      expect(byTraffic[2], `${kind}：汽車若走普通支会少`).not.toBe(plan.ticks);
      // 更具体地钉住那个「错的数」，免得有人把公式改成查表还碰巧相等
      expect(plan.ticks).toBeGreaterThan(byTraffic[2]!);
    }
    // 0001.bin 上的定值（前面那条已断言，这里再点名一次機車/汽車的错值）
    const jail = gateWalkPlan('prison', m.nodes, m.landscapes)!;
    expect(jail.ticks).toBe(13);
    expect(Math.trunc(jail.distance / 12)).toBe(9); // 機車
    expect(Math.trunc(jail.distance / 16)).toBe(6); // 汽車
  });

  run('起点也可以由调用方给（玩家当时的 `xpos/ypos`）', () => {
    const m = map!;
    const land = m.landscapes[1]!;
    const gate = m.nodes.find((n) => n.type === CONFINEMENT_GATE_TYPE.prison)!;
    // 真实调用方传的就是 `player.xpos/ypos` —— 释放那一刻它正是景观记录坐标
    const plan = gateWalkPlanFrom('prison', gate.id, { x: land.x, y: land.y }, gate);
    expect(plan.from).toEqual({ x: land.x, y: land.y });
    expect(plan.to).toEqual({ x: gate.x, y: gate.y });
    expect(plan.ticks).toBe(gateWalkPlan('prison', m.nodes, m.landscapes)!.ticks);
  });
});

// ============================================================
//  ★ 释放那一回合的**朝向**（E-13）
// ============================================================

/**
 * 原版 `0x0043d7cb call 0x40d6be` 除了置「走回棋盘」位，还写了一次朝向：
 * `directionOf(景观位 − 關押格位)`（`0x0040d6f9..0x0040d717`，见 `reduce.ts`
 * 释放分支里那段 @source）。**不是**关押前的旧朝向 —— 棋子朝**棋盘方向**走回来。
 *
 * 0001.bin 上的两个真值（`directionOf` 直接算）：
 *   監獄關押格 1 @(1752,1871) ← 綠島 @(1817,1960)：dx=1752−1817=−65、dy=1871−1960=−89 ⇒ **5**
 *   醫院關押格 23 @(384,1056) ← 醫院大樓 @(319,990)：dx=384−319=+65、dy=1056−990=+66 ⇒ **1**
 *
 * ★★ 2026-09-22 订正（第十一份試玩回報 #13「从监狱和医院出来时为什么都是背对着路倒退出来」）：
 *   本文件先前把「谁减谁」钉反了 —— `describe` 写的「景观位 − 關押格位」与 exe 相反，
 *   两条断言也钉的是反的那一组值（而且 describe 的文字与算式自相矛盾）。
 *   原版（`0x0040d6ee/f2` 读關押格、`0x0040d6f9/704` 读景觀位、`sub` 后 `0x40d70f call 0x454fb4`）
 *   算的是 **`directionOf(關押格 − 景觀位)`** —— 棋子朝**要走的方向**，不是背对棋盤。
 */
describe('★ 释放时的朝向 = directionOf(關押格位 − 景观位)', () => {
  it('★ 監獄那一路是 5、醫院那一路是 1（用 0001.bin 的实测坐标）', () => {
    expect(directionOf(1752 - 1817, 1871 - 1960)).toBe(5);
    expect(directionOf(384 - 319, 1056 - 990)).toBe(1);
  });

  it('★ 反着算会落到对面那一向（钉住「谁减谁」）', () => {
    expect(directionOf(1817 - 1752, 1960 - 1871)).toBe(1);
    expect(directionOf(319 - 384, 990 - 1056)).toBe(5);
  });
});
