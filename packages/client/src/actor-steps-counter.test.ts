/*
 * 替身（四大惡人 / 機器娃娃）走子时那串**剩余步数**（E-22）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 棋盘绘制例程 `0x00409951 cmp eax,4 / jge 直接画`：替身**跳过**关押/被挪两道闸，
 *   画的同样是 `[0x48baf8]`；初值 `0x0040de64`（惡人 `rand()%9+2`）/ `0x0040de3d`（龜行 1）/
 *   `0x0040debe`（機器娃娃 9），**走完一格的那一拍**才减 1（`0x0040d960 dec`）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeNode } from '@rich4/core';
import { actorStepsLeft, actorWalkSteps, actorWalkTotalMs } from './render.ts';

/** 一条直路：相邻两格相距 40 世界单位 ⇒ 每格 5 tick（`dist × 0.125`）= 100 ms @ 20 ms/tick */
const line = (n: number) => Array.from({ length: n }, (_, i) => makeNode({ id: i + 1, x: i * 40, y: 0 }));

describe('actorStepsLeft —— 值 = 掷出的步数 − 已走完的格数', () => {
  const steps = actorWalkSteps([1, 2, 3, 4], line(4), 20);
  const per = steps[0]!.ms;

  it('前提：三格、每格等长', () => {
    expect(steps).toHaveLength(3);
    expect(per).toBeGreaterThan(0);
    expect(actorWalkTotalMs(steps)).toBe(per * 3);
  });

  it('走第一格的途中显示掷出的点数；每走完一格减 1；走完最后一格消失', () => {
    expect(actorStepsLeft(steps, 3, 0)).toBe(3);
    expect(actorStepsLeft(steps, 3, per - 1)).toBe(3);
    expect(actorStepsLeft(steps, 3, per)).toBe(2);
    expect(actorStepsLeft(steps, 3, per * 2)).toBe(1);
    expect(actorStepsLeft(steps, 3, per * 3 - 1)).toBe(1);
    expect(actorStepsLeft(steps, 3, per * 3)).toBe(0);
  });

  it('★ 路径提前断（半路被收回去）：从**掷出的步数**往下数，不是从路径长度', () => {
    // 掷了 8、只走了 3 格 ⇒ 8 → 7 → 6，然后补间结束 = 不画
    expect(actorStepsLeft(steps, 8, 0)).toBe(8);
    expect(actorStepsLeft(steps, 8, per)).toBe(7);
    expect(actorStepsLeft(steps, 8, per * 2)).toBe(6);
    expect(actorStepsLeft(steps, 8, per * 3)).toBe(0);
  });

  it('没起步 / 空补间 = 0', () => {
    expect(actorStepsLeft(steps, 3, -1)).toBe(0);
    expect(actorStepsLeft([], 9, 0)).toBe(0);
  });
});

describe('接线（读源码钉住）', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('function drawStepsCounter('), main.indexOf('function drawGameStage('));

  it('★ 玩家那一支只看**玩家自己**的补间 —— `walkDone()` 含替身，拿它补 1 会在替身走子时凭空画个「1」', () => {
    expect(body).toContain('renderer.playerWalkDone(now)');
    expect(body).not.toContain('renderer.walkDone(');
  });

  it('★ 替身那一支先问、且**不过** `stepsCounterShown` 那两道玩家闸', () => {
    const actorAt = body.indexOf('renderer.actorStepsLeft(now)');
    const gateAt = body.indexOf('stepsCounterShown(');
    expect(actorAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(actorAt);
  });
});
