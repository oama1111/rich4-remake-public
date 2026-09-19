/*
 * 樂透開獎演出脚本
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 最有价值的一组断言是「每个矩形都落在它那张子图里面」。
 *   我第一版把 `fcn_0045643d` 的参数配反了（先源后目标写成先目标后源），
 *   手看着像对的 —— 是拿「子图 3 只有 134×422」去套才发现越界 48 px。
 *   这里就是那个检查的固化版。
 */

import { describe, expect, it } from 'vitest';
import { LOTTERY } from '@rich4/data';
import {
  BALL_ONES_AT,
  BALL_TENS_AT,
  CEREMONY_H,
  CEREMONY_PANEL,
  CEREMONY_SORRY_PAUSE_MS,
  CEREMONY_VOICE_MS,
  CEREMONY_W,
  ENTRY,
  facePartsAt,
  FACE_MOUTH,
  FACE_SLOTS,
  lotteryCeremony,
  TALLY_PLATES,
  ballBlits,
} from './lottery-ceremony.ts';
import type { LotteryDrawResult } from './lottery.ts';

/** 开奖结果的最小构造 */
const draw = (over: Partial<LotteryDrawResult> = {}): LotteryDrawResult => ({
  number: 7,
  winner: null,
  prize: 0,
  lottery: new Array<number>(36).fill(0),
  pool: 1000,
  rigged: false,
  ...over,
});

/**
 * `Panel.mkf` 资源 15 的 47 张子图尺寸。
 * 用 `@rich4/assets-pipeline` 的 `parseSpriteSheet` + `decodeImage` 导出核过
 * （`Panel#15 SMP 47 张，Σgsize=1820566`），这里当**夹具**钉住。
 */
const PANEL15: Readonly<Record<number, readonly [number, number]>> = {
  0: [640, 480],
  1: [152, 413],
  2: [206, 413],
  3: [134, 422],
  4: [127, 364],
  5: [124, 411],
  6: [162, 460],
  7: [50, 17], 8: [50, 17], 9: [50, 17], 10: [50, 17],
  11: [50, 23], 12: [50, 23], 13: [50, 23],
  14: [50, 26], 15: [50, 26], 16: [50, 26], 17: [50, 26],
  18: [50, 14], 19: [50, 14], 20: [50, 14],
  21: [50, 40],
  22: [187, 140],
  23: [233, 192],
  24: [295, 262],
  25: [40, 34], 26: [31, 30], 27: [28, 25], 28: [32, 36],
  29: [36, 31], 30: [37, 33], 31: [35, 33], 32: [35, 30],
  33: [35, 35], 34: [33, 34], 35: [34, 29], 36: [28, 32],
  37: [71, 70], 38: [71, 70], 39: [71, 70], 40: [71, 70], 41: [71, 70],
  42: [71, 70], 43: [71, 70], 44: [71, 70], 45: [71, 70], 46: [71, 70],
};

describe('脚本骨架', () => {
  it('这一屏全部素材都在 Panel#15', () => {
    expect(CEREMONY_PANEL).toBe(0x0f);
  });

  it('★ 一张票都没卖出去 → 根本不开屏（原版 0x00431720 那个循环直接返回）', () => {
    expect(lotteryCeremony(draw({ number: null }))).toEqual([]);
  });

  it('★ 状态序列：中奖走 1→2→3(开号)→4→5→6→8→9→10', () => {
    expect(lotteryCeremony(draw({ winner: 2 })).map((s) => s.state)).toEqual([
      1, 2, 3, 3, 4, 5, 6, 8, 9, 10,
    ]);
  });

  it('★ 状态序列：空号走 1→2→3(开号)→7→8→9→10（没有 4/5/6）', () => {
    expect(lotteryCeremony(draw({ winner: null })).map((s) => s.state)).toEqual([
      1, 2, 3, 3, 7, 8, 9, 10,
    ]);
  });

  it('★ 台词顺序与原版一致', () => {
    const lines = (d: LotteryDrawResult): string[] =>
      lotteryCeremony(d)
        .map((s) => s.line?.text ?? null)
        .filter((t): t is string => t !== null);
    expect(lines(draw({ winner: 1 }))).toEqual([
      LOTTERY.drawIntro.text,
      LOTTERY.drawRolling.text,
      LOTTERY.drawWinnerIs.text,
      LOTTERY.drawWinAll.text,
      LOTTERY.drawHopeNext.text,
      LOTTERY.drawHurryUp.text,
    ]);
    expect(lines(draw({ winner: null }))).toEqual([
      LOTTERY.drawIntro.text,
      LOTTERY.drawRolling.text,
      LOTTERY.drawNoWinner.text,
      LOTTERY.drawCarryOver.text,
      LOTTERY.drawHopeNext.text,
      LOTTERY.drawHurryUp.text,
    ]);
  });

  it('★ 只有空号那一步有 500 ms 的停顿（fcn_0045285e(0x1f4)）', () => {
    const pauses = (d: LotteryDrawResult): number[] =>
      lotteryCeremony(d)
        .map((s) => s.hold.pauseMs ?? 0)
        .filter((n) => n > 0);
    expect(pauses(draw({ winner: 0 }))).toEqual([]);
    expect(pauses(draw({ winner: null }))).toEqual([CEREMONY_SORRY_PAUSE_MS]);
  });

  it('每句话说出口之后都要等它说完', () => {
    for (const s of lotteryCeremony(draw({ winner: 0 }))) {
      if (s.line !== null) expect(s.hold.voice).toBe(true);
    }
  });

  it('★ 摇球机动画在状态 3 起、得主面板在状态 4 起', () => {
    const steps = lotteryCeremony(draw({ winner: 3 }));
    expect(steps.find((s) => s.state === 3 && s.anim !== null)?.anim).toMatchObject({
      panel: 0x10,
      flags: 8,
    });
    expect(steps.find((s) => s.state === 4)?.anim).toMatchObject({ panel: 0x11, flags: 1 });
  });

  it('得主名只在有人中奖那一步出现', () => {
    expect(lotteryCeremony(draw({ winner: 0 })).some((s) => s.texts.includes('winnerName'))).toBe(true);
    expect(lotteryCeremony(draw({ winner: null })).some((s) => s.texts.includes('winnerName'))).toBe(
      false,
    );
  });
});

describe('号码球', () => {
  it('★ 十位在左、个位在右 —— 锚点就是她那两颗球的位置', () => {
    expect(ballBlits(7)).toEqual([
      { entry: ENTRY.ball + 0, at: BALL_TENS_AT, opaque: true },
      { entry: ENTRY.ball + 7, at: BALL_ONES_AT, opaque: true },
    ]);
  });

  it('1..36 拆出来的两个球都是 0..9，且贴片号落在 37..46', () => {
    for (let n = 0; n < 36; n++) {
      for (const b of ballBlits(n)) {
        expect(b.entry).toBeGreaterThanOrEqual(37);
        expect(b.entry).toBeLessThanOrEqual(46);
      }
    }
  });

  it('开号那一步画的就是这个号', () => {
    const steps = lotteryCeremony(draw({ number: 12, winner: 5 }));
    const reveal = steps[3]!;
    expect(reveal.blits).toEqual(ballBlits(12));
  });
});

describe('★ 每个矩形都落在它那张子图里面', () => {
  const cases: readonly LotteryDrawResult[] = [
    draw({ winner: 0 }),
    draw({ winner: 3, number: 0 }),
    draw({ winner: null, number: 35 }),
  ];

  it('整张铺的贴片：锚点(0,0)时不能**整张**跑到屏幕外', () => {
    for (const d of cases) {
      for (const s of lotteryCeremony(d)) {
        for (const b of s.blits) {
          const size = PANEL15[b.entry];
          expect(size, `子图 ${b.entry} 不在 Panel#15 里`).toBeDefined();
          // 只对锚点在左上的那几张查（热点在中心的那些会往两边溢，是正常的）
          if (size![0] >= CEREMONY_W / 2) {
            // ★ 原版允许**部分**越出右/下缘（屏幕自己裁剪）——
            //   例如状态 3 那张右主持人：图 2 是 206 宽、落点 472 ⇒ 678 > 640，
            //   原版就是这么贴的（@source 0x00430418 之后那两次 `fcn_00456418`）。
            //   这里只要求**至少有一半还在屏上**（整张跑出去才是抄错了落点）。
            expect(b.at[0], `子图 ${b.entry} 起点在屏右缘之外`).toBeLessThan(CEREMONY_W);
            expect(b.at[1], `子图 ${b.entry} 起点在屏下缘之外`).toBeLessThan(CEREMONY_H);
            expect(b.at[0] + size![0] / 2).toBeLessThanOrEqual(CEREMONY_W);
            expect(b.at[1] + size![1] / 2).toBeLessThanOrEqual(CEREMONY_H + 16);
          }
        }
      }
    }
  });

  it('★ 擦除拷贝的源矩形完整落在源子图内（这条就是当年配反参数会红的地方）', () => {
    for (const d of cases) {
      for (const s of lotteryCeremony(d)) {
        for (const p of s.patches) {
          const size = PANEL15[p.from];
          expect(size, `子图 ${p.from} 不在 Panel#15 里`).toBeDefined();
          const [sx, sy, w, h] = p.from4;
          expect(sx + w, `源矩形右边界越过子图 ${p.from} 的宽 ${size![0]}`).toBeLessThanOrEqual(size![0]);
          expect(sy + h, `源矩形下边界越过子图 ${p.from} 的高 ${size![1]}`).toBeLessThanOrEqual(size![1]);
          expect(p.at[0] + w).toBeLessThanOrEqual(CEREMONY_W);
          expect(p.at[1] + h).toBeLessThanOrEqual(CEREMONY_H);
        }
      }
    }
  });

  it('脸部贴片不能被抠黑 —— 那是盖在她脸上的一块', () => {
    const face = new Set<number>([...FACE_SLOTS.flatMap((s) => [...s.frames]), FACE_MOUTH.rest, FACE_MOUTH.moving[0], FACE_MOUTH.moving[1], ENTRY.faceWry]);
    for (const d of cases) {
      for (const s of lotteryCeremony(d)) {
        for (const b of s.blits) {
          if (face.has(b.entry)) expect(b.opaque, `脸部贴片 ${b.entry} 必须不透明`).toBe(true);
        }
      }
    }
  });
});

describe('脸部动画', () => {
  it('★ 只按帧号推 —— 同一帧永远给同一结果（不碰游戏随机流）', () => {
    for (const t of [0, 1, 59, 64, 1000]) expect(facePartsAt(t)).toEqual(facePartsAt(t));
  });

  it('贴片落回它自己那一格', () => {
    const cells = new Map<number, readonly [number, number, number, number]>();
    for (const s of FACE_SLOTS) for (const f of s.frames) cells.set(f, s.rect);
    for (const f of FACE_MOUTH.moving) cells.set(f, FACE_MOUTH.rect);
    cells.set(FACE_MOUTH.rest, FACE_MOUTH.rect);

    for (let t = 0; t < 3000; t++) {
      for (const b of facePartsAt(t)) {
        const rect = cells.get(b.entry);
        expect(rect, `子图 ${b.entry} 不是脸部贴片`).toBeDefined();
        expect(b.at).toEqual([rect![0], rect![1]]);
        expect(b.opaque).toBe(true);
      }
    }
  });

  it('★ 眨眼是「偶尔」而不是每帧都动 —— 3000 帧里跳的次数远少于帧数', () => {
    let moving = 0;
    for (let t = 0; t < 3000; t++) {
      const eyes = facePartsAt(t).filter((b) => b.entry !== FACE_MOUTH.rest && !FACE_MOUTH.moving.includes(b.entry as 12 | 13));
      if (eyes.length > 0) moving++;
    }
    expect(moving).toBeGreaterThan(20);
    expect(moving).toBeLessThan(3000 / 4);
  });
});

describe('别的常量', () => {
  it('气泡 2 秒、四块铭牌 2×2', () => {
    expect(CEREMONY_VOICE_MS).toBe(2000);
    expect(TALLY_PLATES).toEqual([[16, 340], [16, 410], [328, 340], [328, 410]]);
  });
});
