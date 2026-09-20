/*
 * 走子补间 —— tick 数与端点
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 数值全部**照 exe 抄的**（`fcn_0040c05c`，VA 0x0040c05c）：
 * `tick 数 = trunc(屏幕距离 / 走子速度)`，速度表 `[8, 12, 16, 8]` 像素/tick。
 * 所以这里连数值一起钉住：改了速度表或那个截断，走路节奏就与原版不一样了。
 *
 * ⚠️ 上一版这里钉的是 `trunc(距离 × 0.125) + 1` / 24 ms —— 那是把出处挂到了
 *   `_rich4_animate_object`（道具飞行动画）上，两个字都不是玩家走子的规格。
 *   见 `known-deviations.md` Q-TURN-1 §6。
 */
import { describe, expect, it } from 'vitest';
import {
  WALK_SPEED_PX_PER_TICK,
  framesFor,
  tweenTickCount,
  tweenTickExact,
  walkFramesFor,
  walkTweenFor,
} from './tween.ts';

describe('WALK_SPEED_PX_PER_TICK —— 照 exe 的速度表', () => {
  it('★ 表就是 [8, 12, 16, 8]（走路/機車/汽車/船）@source VA 0x004749d8', () => {
    expect([...WALK_SPEED_PX_PER_TICK]).toEqual([8, 12, 16, 8]);
  });
});

describe('tweenTickCount —— 照 exe 的 tick 数公式', () => {
  it('★ 就是 trunc(距离 / 速度)，**没有 +1**', () => {
    // 一格屏幕距离中位数约 50 px，走路 8 px/tick → 6
    expect(tweenTickCount(50, 0, 0)).toBe(6);
    // 機車 12 → 4
    expect(tweenTickCount(50, 0, 1)).toBe(4);
    // 汽車 16 → 3
    expect(tweenTickCount(50, 0, 2)).toBe(3);
    // 船 8 → 6
    expect(tweenTickCount(50, 0, 3)).toBe(6);
  });

  it('取整是**向零**（@source fcn_00457dbc 把 FPU 舍入位置成 11b）', () => {
    // 79 / 8 = 9.875 → 9（不是 10）
    expect(tweenTickCount(79, 0, 0)).toBe(9);
    // 7 / 8 = 0.875 → 0 → 但 N==0 要钳到 1（@source VA 0x0040c31f）
    expect(tweenTickCount(7, 0, 0)).toBe(1);
    expect(tweenTickCount(0, 0, 0)).toBe(1);
  });

  it('合成距离按欧氏算（√(dx²+dy²)）', () => {
    expect(tweenTickCount(30, 40, 0)).toBe(tweenTickCount(50, 0, 0));
    expect(tweenTickCount(30, 40, 0)).toBe(6);
  });

  it('★ 特殊态走 dist × 0.125 那一支（乘骑 / 被抬走）', () => {
    // 0.125 的倒数就是 8 —— 与走路同速，所以拿 8 那档对一下
    expect(tweenTickCount(50, 0, 2, true)).toBe(tweenTickCount(50, 0, 0));
    expect(tweenTickCount(50, 0, 1, true)).toBe(6);
  });
});

describe('★ 走子逐拍位置 —— 与原版同一套（T-WALK-1 已修）', () => {
  it('★★ 除数用**未截断**的 N_f，末拍吸附落点 @source 0x0040c2ae / 0x0040c3ec', () => {
    // 通道 2 实测（rich4-spec/tests/test_walk_step.py §F）：100 px、走路 8 px/拍
    //   ⇒ N_f = 12.5、共 12 拍、每拍 8.0 px（108/116/…/188），第 12 拍吸附 200。
    expect(tweenTickExact(100, 0, 0)).toBeCloseTo(12.5, 9);
    expect(tweenTickCount(100, 0, 0)).toBe(12);
    const frames = walkFramesFor({ x: 100, y: 100 }, { x: 200, y: 100 }, 12, 12.5);
    expect(frames).toHaveLength(12);
    expect(frames[0]!.x).toBeCloseTo(108, 9);      // 100 + 8.0（不是 108.33）
    expect(frames[10]!.x).toBeCloseTo(188, 9);     // 第 11 拍
    expect(frames[11]!.x).toBe(200);               // ★ 末拍吸附
  });

  it('★ 特殊态（被抬走/走回棋盘）同样按 dist × 0.125 的**未截断**值走', () => {
    // test_walk_step.py §H：(300,100) → (200,160) 特殊支 ⇒ N_f = 14.577、14 拍
    const dist = Math.hypot(-100, 60);
    expect(tweenTickExact(-100, 60, 0, true)).toBeCloseTo(dist * 0.125, 9);
    const ticks = tweenTickCount(-100, 60, 0, true);
    const frames = walkFramesFor({ x: 300, y: 100 }, { x: 200, y: 160 }, ticks,
                                 tweenTickExact(-100, 60, 0, true));
    expect(ticks).toBe(14);
    expect(frames[0]!.x).toBeCloseTo(300 - 100 / (dist * 0.125 * 8) * 8, 6);
    expect(frames[0]!.x).toBeGreaterThan(292);
    expect(frames[0]!.x).toBeLessThan(294);       // exe 截断后是 293
    expect(frames[frames.length - 1]).toEqual({ x: 200, y: 160 });
  });

  it('极端短距离（N_f < 1 ⇒ 只 1 拍）也吸附到终点', () => {
    const frames = walkFramesFor({ x: 0, y: 0 }, { x: 3, y: 0 }, 1, 0.375);
    expect(frames).toEqual([{ x: 3, y: 0 }]);
  });

  it('exactTicks 非法（0 / NaN）时退回 ticks，不产生 NaN 坐标', () => {
    for (const bad of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const frames = walkFramesFor({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, bad);
      expect(frames.every((f) => Number.isFinite(f.x))).toBe(true);
      expect(frames[1]).toEqual({ x: 10, y: 0 });
    }
  });
});

describe('framesFor —— 线性等分', () => {
  it('★ 最后一帧**正好落在终点**（原版 curX = from + N 步 = to）', () => {
    const frames = framesFor({ x: 10, y: 20 }, { x: 90, y: 20 }, 6);
    const last = frames[frames.length - 1]!;
    expect(last.x).toBeCloseTo(90, 6);
    expect(last.y).toBeCloseTo(20, 6);
  });

  it('★ 第一帧**已经离起点一步**（原版 curX = fromX + stepX，不是 from）', () => {
    const frames = framesFor({ x: 0, y: 0 }, { x: 48, y: 0 }, 6);
    expect(frames).toHaveLength(6);
    expect(frames[0]!.x).toBeCloseTo(8, 6);
    expect(frames[0]!.x).toBeGreaterThan(0);
  });

  it('各帧单调、等距', () => {
    const frames = framesFor({ x: 0, y: 0 }, { x: 0, y: 90 }, 5);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.y).toBeGreaterThan(frames[i - 1]!.y);
      if (i > 1) {
        expect(frames[i]!.y - frames[i - 1]!.y).toBeCloseTo(frames[1]!.y - frames[0]!.y, 6);
      }
    }
  });

  it('★ tick 数为 0 → 0 帧（「動畫過程」关掉时调用方根本不放补间）', () => {
    expect(framesFor({ x: 0, y: 0 }, { x: 100, y: 100 }, 0)).toEqual([]);
  });

  it('原地不动也要 1 帧', () => {
    expect(framesFor({ x: 5, y: 5 }, { x: 5, y: 5 }, 1)).toHaveLength(1);
  });
});

describe('★★ walkTweenFor：走一格 / 「走回棋盘」两种位移补间（第 86/87 条）', () => {
  const nodeAt = (id: number) =>
    id === 12 ? { x: 1248, y: 1583 } : id === 7 ? { x: 768, y: 1008 } : undefined;
  const P = (nodeId: number, xpos: number, ypos: number) => ({ nodeId, xpos, ypos });
  const st = (p: ReturnType<typeof P>) => ({ currentPlayer: 0, players: [p] });

  it('走一格：起终点 = `lastNodeId`/`nodeId` 两格，**不走特殊支**', () => {
    expect(
      walkTweenFor('step', st(P(7, 768, 1008)), st(P(12, 1248, 1583)), nodeAt),
    ).toEqual({
      player: 0,
      from: { x: 768, y: 1008 },
      to: { x: 1248, y: 1583 },
      // 普通走子查速度表 `[0x4749d8]`（@source 0x40c282..0x40c29e）
      special: false,
    });
  });

  it('没真的挪窝（被阻碍）⇒ 不起补间', () => {
    expect(walkTweenFor('step', st(P(12, 1248, 1583)), st(P(12, 1248, 1583)), nodeAt)).toBeNull();
  });

  it('★★ 「走回棋盘」：x/y 从綠島回填到監獄格 ⇒ 起终点就是这两个坐标', () => {
    // 綠島（景观记录 2）= (1817,1960)、監獄格 12 = (1248,1583)
    const t = walkTweenFor('startTurn', st(P(12, 1817, 1960)), st(P(12, 1248, 1583)), nodeAt);
    expect(t).toEqual({
      player: 0,
      from: { x: 1817, y: 1960 },
      to: { x: 1248, y: 1583 },
      special: true,
    });
  });

  it('★★ 走回棋盘**必须**走特殊支（`dist × 0.125`），与交通方式无关', () => {
    // 可证伪：`special=false` 时，開車的人（16/tick）这一段会快一倍。
    // @source 0x40c0ba（0x10 分支）与 0x40c26d（0x30 特殊支）读的是同一个
    //   `player+0x15` 字节，中间无写入 ⇒ 走回棋盘恒走 0x40c27a。
    const t = walkTweenFor('startTurn', st(P(12, 1817, 1960)), st(P(12, 1248, 1583)), nodeAt)!;
    expect(t.special).toBe(true);
    const dx = t.to.x - t.from.x;
    const dy = t.to.y - t.from.y;
    const dist = Math.hypot(dx, dy);
    // 特殊支：不管交通方式
    for (const traffic of [0, 1, 2, 3]) {
      expect(tweenTickCount(dx, dy, traffic, t.special)).toBe(Math.trunc(dist * 0.125));
    }
    // 反证：若按交通方式（这里 2 = 汽車），拍数会明显更少
    expect(tweenTickCount(dx, dy, 2, false)).toBeLessThan(
      tweenTickCount(dx, dy, 2, t.special),
    );
  });

  it('startTurn 但 x/y 没变（普通开局）⇒ 不起补间', () => {
    expect(
      walkTweenFor('startTurn', st(P(12, 1248, 1583)), st(P(12, 1248, 1583)), nodeAt),
    ).toBeNull();
  });

  it('别的 action 一律不起补间', () => {
    expect(walkTweenFor('rollDice', st(P(12, 1817, 1960)), st(P(12, 1248, 1583)), nodeAt)).toBeNull();
    expect(walkTweenFor('endTurn', st(P(12, 1817, 1960)), st(P(12, 1248, 1583)), nodeAt)).toBeNull();
  });
});
