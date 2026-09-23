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
  BIG_DIGIT_ONES_AT,
  BIG_DIGIT_TENS_AT,
  CEREMONY_BASE,
  CEREMONY_BIG_DIGIT_BASE,
  CEREMONY_BIG_DIGIT_RESOURCE,
  CEREMONY_FRAMES,
  CEREMONY_H,
  CEREMONY_HOLD_TICKS,
  CEREMONY_ROLL_TICKS,
  CEREMONY_SOUND,
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
  bigDigitBlits,
  displayNumber,
  numberDigits,
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

  it('★ 状态序列：中奖 1→2→3(摇球)→3(第 20 拍)→4(开号 + 「得主是」)→5(公布)→6→8→9→10', () => {
    // @source 开号那一拍同时置 4（0x00430d5d）；4 的处理器（0x00430485）置 5；
    //   5 的尾巴置 6（0x004310d6）；6 的处理器置 8、不说话（0x004308d4）；8 的处理器置 9（0x00430a91）
    expect(lotteryCeremony(draw({ winner: 2 })).map((s) => s.state)).toEqual([
      1, 2, 3, 3, 4, 5, 6, 8, 9, 10,
    ]);
  });

  it('★ 状态序列：空号 1→2→3→3→3(开号，停 500 ms)→7→8→9→10（没有 4/5/6）', () => {
    // @source 空号那一支先 `fcn_0045285e(0x1f4)` 再置 7（0x00430d85 / 0x00430d92）；
    //   7 的处理器置 8 并说「結轉」（0x004308e0）；8 的处理器置 9（0x00430a91）
    expect(lotteryCeremony(draw({ winner: null })).map((s) => s.state)).toEqual([
      1, 2, 3, 3, 3, 7, 8, 9, 10,
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

  it('★ 摇球机在状态 3 起（先停 20 拍）、礼花在状态 5 起（先停 30 拍）', () => {
    const steps = lotteryCeremony(draw({ winner: 3 }));
    // @source 0x0043038a `fcn_00450ced(Panel#16, 0xb7, 0x4b, 8)`；0x00430267 `cmp dh,0x14 / jb` 跳过推帧
    expect(steps[2]!.anim).toEqual({ panel: 0x10, entry: 0, at: [183, 75], flags: 8, delayTicks: CEREMONY_ROLL_TICKS });
    // @source 0x004304a4 `fcn_00450ced(Panel#17, 0xcd, 0, 1)`；0x00430f5e `cmp dl,0x1e / jbe` 跳过推帧
    expect(steps.find((s) => s.state === 5)?.anim).toEqual({
      panel: 0x11,
      entry: 0,
      at: [205, 0],
      flags: 1,
      delayTicks: CEREMONY_HOLD_TICKS,
    });
    expect(steps.filter((s) => s.anim !== null)).toHaveLength(2);
  });

  it('★★ 「本月份的得主是．．．。」那一步**只说话**：换姿势 / 红爆炸框 / 得主名 / 礼花都在它说完之后', () => {
    // 第十二份試玩回報「動畫順序和原版不一樣」：先前这些与那句话同一拍出现。
    // @source 开号那一拍只 `置 4 + 说 [0x475618]`（0x00430d5d–0x00430d7b）；
    //   换装与揭晓在状态 4 的处理器 0x00430485（气泡说完才进得去，0x00430209 `call 0x44ee18`）
    const steps = lotteryCeremony(draw({ winner: 1 }));
    const say = steps.findIndex((s) => s.line === LOTTERY.drawWinnerIs);
    const reveal = steps.findIndex((s) => s.texts.includes('winnerName'));
    expect(say).toBe(4);
    expect(reveal).toBe(say + 1);
    expect(steps[say]!.blits.map((b) => b.entry)).not.toContain(ENTRY.burstWin);
    expect(steps[say]!.anim).toBeNull();
    expect(steps[reveal]!.blits.map((b) => b.entry)).toEqual([ENTRY.jumpBoard, ENTRY.laugh, ENTRY.burstWin]);
    expect(steps[reveal]!.line).toBeNull();
  });

  it('得主名只在有人中奖那一步出现', () => {
    expect(lotteryCeremony(draw({ winner: 0 })).some((s) => s.texts.includes('winnerName'))).toBe(true);
    expect(lotteryCeremony(draw({ winner: null })).some((s) => s.texts.includes('winnerName'))).toBe(
      false,
    );
  });

  it('★ 两个音效：摇球 57、公布得主 58（空号那一路只有 57）', () => {
    // @source 0x00430471 `push 0 / push 0x47567b / call 0x4542ce`、0x004306f3 `push 0x475683`；
    //   `disasm.py dump 0x47567b 8 4` ⇒ 57, 0, 58, 0
    expect(CEREMONY_SOUND).toEqual({ drum: 57, winner: 58 });
    const sounds = (d: LotteryDrawResult): number[] =>
      lotteryCeremony(d).flatMap((s) => (s.sound === undefined ? [] : [s.sound]));
    expect(sounds(draw({ winner: 0 }))).toEqual([57, 58]);
    expect(sounds(draw({ winner: null }))).toEqual([57]);
  });
});

describe('★ 字框：气泡 (300,47)；空号那两句在屏幕正中的黄色爆炸框里', () => {
  it('★★ 气泡落点是 `fcn_0044ec30` 的第 2/3 参 (0x12c,0x2f)，字心偏移 (−10,0) 是第 4/5 参', () => {
    // @source 0x0042f7b7 `push 0 / 0x101010 / 0 / −0xa / 0x2f / 0x12c / 图22`；
    //   0x0044ec3d `[0x48c624] = [esp+8]`（x）、0x0044ec47 `[0x48c620] = [esp+0xc]`（y）、
    //   0x0044ed45 `fcn_00456418(dst, 框, [0x48c624], [0x48c620])`
    expect(CEREMONY_FRAMES.bubble).toEqual({ entry: 22, at: [300, 47], text: [-10, 0] });
    // @source 0x00430d99 `push 0 / 0x101010 / 0 / 0 / 0xc8 / 0x140 / 图23`
    expect(CEREMONY_FRAMES.burst).toEqual({ entry: 23, at: [320, 200], text: [0, 0] });
  });

  it('★★ 建屏只**设**气泡字框、不画它（它只在说话那几秒出现）', () => {
    expect(CEREMONY_BASE.frame).toBe('bubble');
    expect(CEREMONY_BASE.blits.map((b) => b.entry)).not.toContain(ENTRY.bubble);
    expect(CEREMONY_BASE.blits).toEqual([
      { entry: ENTRY.stage, at: [0, 0], opaque: true },
      { entry: ENTRY.pointing, at: [472, 66] },
      { entry: ENTRY.board, at: [7, 66] },
    ]);
  });

  it('★★ 空号：「SORRY」与「結轉」写在黄色爆炸框里，「希望下次」换回气泡；爆炸框**不是**贴图', () => {
    const steps = lotteryCeremony(draw({ winner: null }));
    const sorry = steps.find((s) => s.line === LOTTERY.drawNoWinner)!;
    const carry = steps.find((s) => s.line === LOTTERY.drawCarryOver)!;
    const hope = steps.find((s) => s.line === LOTTERY.drawHopeNext)!;
    expect(sorry.frame).toBe('burst');
    expect(carry.frame).toBeUndefined(); // 沿用爆炸框（0x004308e0 不调 0x44ec30）
    expect(hope.frame).toBe('bubble'); // 0x00430a89
    for (const s of steps) expect(s.blits.map((b) => b.entry)).not.toContain(ENTRY.burstSorry);
  });

  it('★ 中奖那一路一直是气泡', () => {
    const frames = lotteryCeremony(draw({ winner: 2 })).map((s) => s.frame ?? null).filter((f) => f !== null);
    expect(frames).toEqual(['bubble']);
  });
});

describe('号码球与中央大号数字 —— 屏上是 `%02d` 的**槽号 + 1**', () => {
  it('★★ 显示的号 = 槽号 + 1（与投注屏、持号表同一口径）@source 0x00430b77 `lea ebx,[edx+1]`', () => {
    expect(displayNumber(0)).toBe(1);
    expect(displayNumber(35)).toBe(36);
    // 槽 6 = 07 号 —— 先前球上画的是 06（把槽号当号码）
    expect(numberDigits(6)).toEqual([0, 7]);
    expect(numberDigits(9)).toEqual([1, 0]);
    expect(numberDigits(35)).toEqual([3, 6]);
  });

  it('★ 十位在左、个位在右 —— 落在台座显示窗里 @source 0x00430c48 / 0x00430c80（抠黑贴）', () => {
    expect(ballBlits(6)).toEqual([
      { entry: ENTRY.ball + 0, at: BALL_TENS_AT },
      { entry: ENTRY.ball + 7, at: BALL_ONES_AT },
    ]);
    expect(BALL_TENS_AT).toEqual([286, 405]);
    expect(BALL_ONES_AT).toEqual([358, 405]);
  });

  it('1..36 拆出来的两个球都是 0..9，且贴片号落在 37..46', () => {
    for (let n = 0; n < 36; n++) {
      for (const b of ballBlits(n)) {
        expect(b.entry).toBeGreaterThanOrEqual(37);
        expect(b.entry).toBeLessThanOrEqual(46);
      }
    }
  });

  it('★★ 中央大号数字：`Data.mkf#517` 图 8 + 数字，落在 (300,220)/(340,220)', () => {
    // @source 0x00430c99 `lea edx,[eax−0x1d]`（`eax` = `'0'+d − 0xb`）⇒ 8 + d；
    //   0x00430c88 `push 0xdc / push 0x12c`、0x00430cc2 `push 0xdc / push 0x154`；`[0x48bad8]` ← 0x0040808f `push 0x205`
    expect(CEREMONY_BIG_DIGIT_RESOURCE).toBe(517);
    expect(CEREMONY_BIG_DIGIT_BASE).toBe(8);
    expect(BIG_DIGIT_TENS_AT).toEqual([300, 220]);
    expect(BIG_DIGIT_ONES_AT).toEqual([340, 220]);
    expect(bigDigitBlits(22)).toEqual([
      { entry: 8 + 2, at: BIG_DIGIT_TENS_AT },
      { entry: 8 + 3, at: BIG_DIGIT_ONES_AT },
    ]);
  });

  it('★★ 开号那一步（中奖、空号都一样）贴球 + 中央大号数字；之后各步只重贴球', () => {
    for (const d of [draw({ number: 12, winner: 5 }), draw({ number: 12, winner: null })]) {
      const steps = lotteryCeremony(d);
      const firstBalls = steps.findIndex((s) => s.balls === true);
      expect(firstBalls).toBe(4);
      expect(steps[4]!.digits).toBe(true);
      expect(steps.filter((s) => s.digits === true)).toHaveLength(1);
      // 摇球那两步都还没开号
      expect(steps[2]!.balls ?? false).toBe(false);
      expect(steps[3]!.balls ?? false).toBe(false);
    }
  });

  it('★ 空号那一路：号码亮着先停 500 ms，然后才出「SORRY」', () => {
    const steps = lotteryCeremony(draw({ winner: null }));
    expect(steps[4]!.hold).toEqual({ pauseMs: CEREMONY_SORRY_PAUSE_MS });
    expect(steps[4]!.line).toBeNull();
    expect(steps[5]!.line).toBe(LOTTERY.drawNoWinner);
  });
});

describe('★ 主持人换姿势（逐条对 exe 的调用；擦除最后两参是**宽高**）', () => {
  it('★★ 摇球：只擦竖起的手指 (472,116)+45×90，摊手那张落在 (418,66) —— 身子正好压在原来那张上', () => {
    // @source 0x004303fa `fcn_0045643d(dst, 图0, 0x1d8,0x74, 0x1d8,0x74, 0x2d,0x5a)`；
    //   0x00430418 `fcn_00456418(dst, 图2, 0x1a2, 0x42)`（这一句是**贴图**，不是擦除）
    const s = lotteryCeremony(draw({ winner: 0 }))[2]!;
    expect(s.patches).toContainEqual({ from: ENTRY.stage, at: [472, 116], from4: [472, 116, 45, 90] });
    expect(s.blits[0]).toEqual({ entry: ENTRY.presenting, at: [418, 66] });
  });

  it('★ 第 20 拍：擦摊开的手 (418,171)+80×80，竖起手指（图 1 的 (0,51)+38×90 → (472,117)）', () => {
    // @source 0x004302b4 / 0x004302db
    const s = lotteryCeremony(draw({ winner: 0 }))[3]!;
    expect(s.patches).toEqual([{ from: ENTRY.stage, at: [418, 171], from4: [418, 171, 80, 80] }]);
    expect(s.blits).toEqual([{ entry: ENTRY.pointing, at: [472, 117], src: [0, 51, 38, 90] }]);
    expect(s.hold).toEqual({ anim: true });
  });

  it('★ 收尾（8→9）：擦 (489,116)+151×364，右边回到竖手指，左脸从图 3 的 (45,23)+50×40 不透明拷回', () => {
    // @source 0x00430961 / 0x004309b0 / 0x004309d4
    for (const d of [draw({ winner: 0 }), draw({ winner: null })]) {
      const s = lotteryCeremony(d).find((x) => x.state === 9)!;
      expect(s.patches).toContainEqual({ from: ENTRY.stage, at: [489, 116], from4: [489, 116, 151, 364] });
      expect(s.blits).toContainEqual({ entry: ENTRY.pointing, at: [472, 66] });
      expect(s.blits).toContainEqual({ entry: ENTRY.board, at: [52, 89], src: [45, 23, 50, 40], opaque: true });
    }
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
          const [sx, sy, w0, h0] = p.from4;
          // ★ 原版的拷贝先按**屏幕**裁（`0x455ee1` 起：x+w 超过 `[0x4861c0]` 就把 w 减掉超出的量），
          //   再去读源 —— 唯一一处越界是空号那一步的 `擦(472,0,169,480)`（472+169 = 641，exe 原值
          //   `push 0xa9` @0x00430e0c），裁完正好 168。这里按裁完的宽高量。
          expect(p.at[0], `落点 x 在屏外`).toBeLessThan(CEREMONY_W);
          expect(p.at[1], `落点 y 在屏外`).toBeLessThan(CEREMONY_H);
          expect(p.at[0] + w0 - CEREMONY_W, '越出屏幕右缘最多 1 点（exe 原值）').toBeLessThanOrEqual(1);
          const w = Math.min(w0, CEREMONY_W - p.at[0]);
          const h = Math.min(h0, CEREMONY_H - p.at[1]);
          expect(sx + w, `源矩形右边界越过子图 ${p.from} 的宽 ${size![0]}`).toBeLessThanOrEqual(size![0]);
          expect(sy + h, `源矩形下边界越过子图 ${p.from} 的高 ${size![1]}`).toBeLessThanOrEqual(size![1]);
        }
      }
    }
  });

  it('★ 局部贴（`fcn_00456495` / 左脸还原）的源矩形完整落在那张子图里', () => {
    for (const d of cases) {
      for (const s of lotteryCeremony(d)) {
        for (const b of s.blits) {
          if (b.src === undefined) continue;
          const size = PANEL15[b.entry]!;
          const [sx, sy, w, h] = b.src;
          expect(sx + w, `图 ${b.entry} 的 src 越过宽 ${size[0]}`).toBeLessThanOrEqual(size[0]);
          expect(sy + h, `图 ${b.entry} 的 src 越过高 ${size[1]}`).toBeLessThanOrEqual(size[1]);
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
