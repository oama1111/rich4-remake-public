/*
 * 樂透開獎动画屏的版面、擦除矩形、察觉判据与播放节拍
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4_ui_letou.asm`（窗口过程 `fcn_0043010c`）抄，把最容易写错的
 * 几条钉住：
 *   · 状态 3/4/7/8 那几块**擦除矩形**是从干净底图原样拷回来的，`x1/y1` 是
 *     **闭区间端点**（宽度 = `x1 − dx + 1`），不是宽高；
 *   · 各人持号表的起点是 `铭牌 + (0x36, 0x1e)`、号码间距 0x28、个位 +0x10，
 *     超过 12 个字符才折行；
 *   · 中奖号那两颗球**不滚**，直接用 37..46 贴出来；
 *   · ANM 的帧间隔是原版那个 880 ms（不是 FLIC 头里的 71）。
 */
import { describe, expect, it } from 'vitest';
import type { CeremonyStep, GameState } from '@rich4/core';
import { ENTRY, POSE_RIGHT, TALLY_PLATES, lotteryCeremony } from '@rich4/core';
import {
  ANM_FRAME_MS,
  CEREMONY_BALLS,
  CEREMONY_BLIT,
  CEREMONY_ERASE,
  DRAW_BUBBLE_AT,
  DRAW_DIGIT_RESOURCE,
  DRAW_DRUM_RESOURCE,
  DRAW_FLOWER_RESOURCE,
  DRAW_PORTRAIT_RESOURCE,
  DRAW_RESOURCE,
  FACE_MOUTH_RECT,
  FACE_SLOT_FRAMES,
  FACE_SLOT_RECT,
  BLIT_BALL_RANGE,
  TALLY_ART_AT,
  TALLY_BAND,
  TALLY_DIGIT_DX,
  TALLY_FRAME,
  TALLY_LINE_DY,
  TALLY_PITCH,
  anmDone,
  anmFrameAt,
  badgeEntry,
  bubbleLines,
  currency,
  drawBalls,
  drawCeremony,
  drawTally,
  faceCtlStart,
  faceStep,
  isBallEntry,
  lotteryDrawActive,
  lotteryDrawCue,
  lotteryDrawPhase,
  lotteryDrawScreen,
  lotteryDrawStep,
  lotteryDrawView,
  resetLotteryDrawScreenState,
  resolveErase,
  tallyArtAt,
  tallyDigits,
  tallyFrameAt,
  tallyString,
  voiceOf,
} from './lottery-draw-screen.ts';
import type { DrawView, DrawSprite, EraseRect } from './lottery-draw-screen.ts';
import type { LoadedFlic, Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  素材与常量
// ============================================================

describe('用到的图 @source rich4_ui_letou.asm 0x00431712 一带', () => {
  it('★ 舞台是 Panel.mkf 15；摇球 16；礼花 17；数字牌 13；人像条 Data.mkf 517', () => {
    expect(DRAW_RESOURCE).toBe(15);
    expect(DRAW_DRUM_RESOURCE).toBe(0x10);
    expect(DRAW_FLOWER_RESOURCE).toBe(0x11);
    expect(DRAW_DIGIT_RESOURCE).toBe(0x0d);
    expect(DRAW_PORTRAIT_RESOURCE).toBe(0x205);
  });

  it('★ 号码球 = 37..46；徽章 = 25 + 角色号', () => {
    expect(ENTRY.ball).toBe(37);
    expect(ENTRY.badge).toBe(25);
    expect(badgeEntry(0)).toBe(25);
    expect(badgeEntry(11)).toBe(36);
  });

  it('★ 气泡在 (300, −10)，字心左移 10', () => {
    expect(DRAW_BUBBLE_AT).toEqual([0x12c, -0x0a]);
  });

  it('★ 持号表那一条带 (16,340) 608×130 —— 与 core 脚本的 CLEAR_PLATES_BAND 同值', () => {
    expect(TALLY_BAND).toEqual({ x: 0x10, y: 0x154, w: 0x260, h: 0x82 });
    expect(TALLY_BAND.w).toBe(608);
    expect(TALLY_BAND.h).toBe(130);
  });
});

// ============================================================
//  擦除矩形 —— 与 exe 逐条对
// ============================================================

describe('台面擦除 @source fcn_0045643d 的各个调用点', () => {
  /** `(dx, dy, x1, y1)` → 宽度/高度（**闭区间端点**）*/
  /** 开区间端点 ⇒ 尺寸就是 `x1 − dx` */
  const size = (r: EraseRect): [number, number] => [r.x1 - r.dx, r.y1 - r.dy];

  it('★ 摇球（步 2 / 状态 3 第一段）：右主持人整片 (472,66)-(592,346) 与她的左半 (472,116)-(516,205)', () => {
    const rows = CEREMONY_ERASE[2]!;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42, x1: 0x250, y1: 0x15b });
    expect(size(rows[0]!)).toEqual([120, 281]);
    expect(rows[1]).toMatchObject({ dx: 7, dy: 0x74, sx: 7, sy: 0x74, x1: 0x8d, y1: 0xf7 });
    expect(size(rows[1]!)).toEqual([134, 131]);
    expect(rows[2]).toMatchObject({ dx: 0x1d8, dy: 0x74, sx: 0x1d8, sy: 0x74, x1: 0x205, y1: 0xce });
    expect(size(rows[2]!)).toEqual([45, 90]);
  });

  it('★ 得主（步 4）/ 空号（步 7）的擦除完全一样：右脸 (472,66)-(520,346)、左脸 (7,66)-(141,346)、右下半身', () => {
    const rows = CEREMONY_ERASE[4]!;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x74, x1: 0x209, y1: 0x1fb });
    expect(size(rows[0]!)).toEqual([49, 441]);
    expect(rows[1]).toMatchObject({ dx: 7, dy: 0x42, sx: 7, sy: 0x74, x1: 0x8e, y1: 0x1fb });
    expect(size(rows[1]!)).toEqual([135, 441]);
    expect(rows[2]).toMatchObject({ dx: 0x1d8, dy: 0x74, sx: 0x1d8, sy: 0x74, x1: 0x259, y1: 0x1fb });
    expect(size(rows[2]!)).toEqual([129, 391]);
    // 空号（步 7 / 状态 7）与得主那一步的擦除完全一样
    expect(CEREMONY_ERASE[7]).toEqual(CEREMONY_ERASE[4]);
    // 收尾（步 8 / 状态 8）用的是**另一组**：只擦右臂 + 还原左脸
    expect(CEREMONY_ERASE[8]).toHaveLength(2);
  });

  it('★ 数帧（步 5 / 状态 5）那两块：(0,150)-(418,270) 与 (150,270)-(300,360)', () => {
    const rows = CEREMONY_ERASE[5]!;
    expect(size(rows[0]!)).toEqual([419, 121]);
    expect(size(rows[1]!)).toEqual([151, 91]);
  });

  it('★ 收尾（步 8 / 状态 8）：右臂 (472,116)-(516,205) + 左脸还原用的是**图 3**的 (45,23)-(45,23)', () => {
    const rows = CEREMONY_ERASE[8]!;
    expect(rows[0]).toMatchObject({ from: ENTRY.stage, dx: 0x1d8, dy: 0x74, x1: 0x205, y1: 0xce });
    // 左脸那一条：源与目标都从子图自己的 (0x2d,0x17) 起，只有 1×1
    expect(rows[1]).toMatchObject({ from: ENTRY.board, dx: 0x34, dy: 0x59, sx: 0x2d, sy: 0x17, x1: 0x5b, y1: 0x3f });
  });

  it('★ 摇球那一步要重画两个主持人、数帧那一步重画举板、收尾那一步重画点手指的姿势', () => {
    // ★ 重画与擦除**同一格**：擦的是他们身上的板与腿（CEREMONY_ERASE[2]），
    //   擦完紧接着把他们自己贴回去（@source 0x430379 / 0x430402）
    expect(CEREMONY_BLIT[2]).toEqual([
      { entry: ENTRY.board, at: [7, 0x42] },
      { entry: ENTRY.presenting, at: [0x1d8, 0x42] },
    ]);
    expect(CEREMONY_BLIT[5]).toEqual([{ entry: ENTRY.jumpBoard, at: [0, 0] }]);
    expect(CEREMONY_BLIT[8]).toEqual([{ entry: ENTRY.pointing, at: POSE_RIGHT }]);
  });

  it('★ 号码球：开号（状态 3 第二段）与 4/5/6/7 各重贴一次', () => {
    // 步 0=状态1 1=状态2 2=状态3摇球 3=状态3开号 4=状态4
    // 5=状态5 6=状态6 7=状态7(空号)/状态8(收尾) 8=状态9 9=状态10
    expect(CEREMONY_BALLS).toEqual([
      false, false, false, true, true, true, true, true, false, false,
    ]);
  });

  it('★ 开号那一步就是 `CEREMONY_BALLS` 为真的那一步（含 0/1/9 的号码也当场画球）', () => {
    // core 脚本里状态 3 **连续出现两次**：`steps[2]` 是摇球、`steps[3]` 才是开号。
    // ★ 步号就是数组下标 —— `begin()` 不往前面插「建屏」那一步
    //   （建屏 = `CEREMONY_BASE`，是 WM_CREATE 直接画的），所以开号 = 步 **3**，
    //   不是步 4。探针：把 `CEREMONY_BALLS[3]` 改回 false，下面这条会红。
    const win = lotteryCeremony({ number: 6, winner: 0, prize: 5, lottery: [], pool: 0, rigged: false });
    const threes = win.map((s, i) => (s.state === 3 ? i : -1)).filter((i) => i >= 0);
    expect(threes).toEqual([2, 3]);
    const openIdx = threes[1]!;
    expect(openIdx).toBe(3);
    expect(win[openIdx]!.state).toBe(3);
    expect(CEREMONY_BALLS[openIdx]).toBe(true);
    // 摇球那一步（前一段状态 3）不画球 —— 那时还没开号
    expect(CEREMONY_BALLS[openIdx - 1]).toBe(false);
    // 每一步（含末步）都要有定义，否则 `drawBalls` 会读到 undefined
    for (let i = 0; i < win.length; i++) expect(CEREMONY_BALLS[i]).toBeDefined();
    expect(CEREMONY_BALLS.length).toBe(win.length);
  });

  it('★ 号码球那 10 张子图（37..46）整段都在「从 core 脚本里摘掉」的范围里', () => {
    expect(BLIT_BALL_RANGE).toEqual({ from: 37, to: 46 });
    for (let e = 37; e <= 46; e++) expect(isBallEntry(e)).toBe(true);
    // 边界：36（徽章末号）与 47 都不是球
    expect(isBallEntry(36)).toBe(false);
    expect(isBallEntry(47)).toBe(false);
  });
});

describe('resolveErase —— 闭区间端点、夹边界', () => {
  const stage = { from: 0, dx: 10, dy: 10, sx: 10, sy: 10, x1: 20, y1: 20 };

  it('★ 宽度是 x1 − dx（开区间端点）', () => {
    expect(resolveErase(stage, 640, 480)).toEqual({ dx: 10, dy: 10, sx: 10, sy: 10, w: 10, h: 10 });
  });

  it('★ 源超出子图就夹到子图（不照抄原版的越界读）', () => {
    const r = resolveErase({ from: 0, dx: 0, dy: 0, sx: 0, sy: 0, x1: 700, y1: 500 }, 100, 100);
    expect(r).toEqual({ dx: 0, dy: 0, sx: 0, sy: 0, w: 100, h: 100 });
  });

  it('★ 源与目标完全在子图外 → null', () => {
    expect(resolveErase({ from: 0, dx: 700, dy: 0, sx: 700, sy: 0, x1: 800, y1: 10 }, 100, 100)).toBeNull();
  });
});

// ============================================================
//  察觉「刚开了奖」
// ============================================================

/** 一份最小的 GameState —— 本屏只读这几项 */
function makeState(over: Partial<GameState> = {}): GameState {
  return {
    day: 14,
    totalDays: 100,
    year: 1,
    month: 1,
    pool: 1000,
    lottery: new Array<number>(36).fill(0),
    players: [
      { index: 0, cash: 10000, character: 0 },
      { index: 1, cash: 10000, character: 1 },
    ] as GameState['players'],
    ...over,
  } as unknown as GameState;
}

describe('lotteryDrawCue —— 从 before → after 反推', () => {
  it('★ 没开奖那天（日期没动）→ null', () => {
    expect(lotteryDrawCue(makeState(), makeState())).toBeNull();
  });

  it('★ 15 号但一张票都没卖出 → null（原版那个循环直接返回）', () => {
    const before = makeState({ day: 14, totalDays: 100 });
    const after = makeState({ day: 15, totalDays: 101 });
    expect(lotteryDrawCue(before, after)).toBeNull();
  });

  it('★ 有人中奖：号码表被清空、公库清零 → 中奖号与得主都反推得出来', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 2; // 玩家 1 持 07 号
    lottery[13] = 1; // 玩家 0 持 14 号
    const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery });
    const players = [
      { index: 0, cash: 10000, character: 0 },
      { index: 1, cash: 10000, character: 1 },
    ] as GameState['players'];
    const after = makeState({
      day: 15,
      totalDays: 101,
      pool: 0,
      lottery: new Array<number>(36).fill(0),
      // 玩家 1 拿走整个公库
      players: [players[0]!, { ...players[1]!, cash: 15000 }],
    });
    const cue = lotteryDrawCue(before, after);
    expect(cue).toMatchObject({ number: 6, winner: 1, prize: 5000, owner: 1, numberUnknown: false });
  });

  it('★ 没人中奖：号码表与公库都原样 → 照样起播，但号码标成「猜不回来」', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery });
    const after = makeState({ day: 15, totalDays: 101, pool: 5000, lottery: [...lottery] });
    const cue = lotteryDrawCue(before, after);
    expect(cue).toMatchObject({ numberUnknown: true, winner: null, prize: 5000 });
  });
});

// ============================================================
//  各人持号表
// ============================================================

describe('各人持号表 @source fcn_0042f417', () => {
  it('★ 号码串就是 `%02d` 拼接', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[0] = 1;
    lottery[9] = 1;
    expect(tallyString(lottery, 0)).toBe('0110');
    expect(tallyString(lottery, 1)).toBe('');
  });

  it('★ 起点 = 铭牌 + (0x36, 0x1e)，两位数字相距 0x10、号码间距 0x28', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[0] = 1; // 01
    lottery[7] = 1; // 08
    const d = tallyDigits(lottery, 0);
    const [px, py] = TALLY_PLATES[0]!;
    expect(d[0]).toEqual({ digit: 0, x: px + 0x36, y: py + 0x1e });
    expect(d[1]).toEqual({ digit: 1, x: px + 0x36 + TALLY_DIGIT_DX, y: py + 0x1e });
    expect(d[2]).toEqual({ digit: 0, x: px + 0x36 + TALLY_PITCH, y: py + 0x1e });
    expect(d[3]).toEqual({ digit: 8, x: px + 0x36 + TALLY_PITCH + TALLY_DIGIT_DX, y: py + 0x1e });
  });

  it('★ 超过 12 个字符（= 6 个号码）才折行，折行后 y 再加 0x1e', () => {
    const lottery = new Array<number>(36).fill(0);
    // 7 个号码 = 14 个字符
    for (const n of [0, 1, 2, 3, 4, 5, 6]) lottery[n] = 1;
    const d = tallyDigits(lottery, 0);
    expect(d).toHaveLength(14);
    const [px, py] = TALLY_PLATES[0]!;
    // 第 7 个号码（下标 12 起）换行
    expect(d[12]).toEqual({ digit: 0, x: px + 0x36, y: py + 0x1e + TALLY_LINE_DY });
    expect(d[13]).toEqual({ digit: 7, x: px + 0x36 + TALLY_DIGIT_DX, y: py + 0x1e + TALLY_LINE_DY });
  });

  it('★ 铭牌与人像条同点 —— 表里存的就是「舞台坐标 − 0x14/−0x1e」', () => {
    expect(tallyArtAt(0)).toEqual([16, 340]);
    expect(tallyArtAt(3)).toEqual([328, 410]);
    expect(TALLY_ART_AT).toEqual({ dx: 0x14, dy: 0x1e });
  });
});

// ============================================================
//  ANM 节拍
// ============================================================

describe('ANM 的帧间隔 @source 0x00450eb1', () => {
  it('★ 不是 FLIC 头里的 71 ms，是原版那个 880', () => {
    expect(ANM_FRAME_MS).toBe(0x370);
  });

  it('★ 逐帧推进、放完停在最后一帧', () => {
    expect(anmFrameAt(0, 0, 42)).toBe(0);
    expect(anmFrameAt(ANM_FRAME_MS - 1, 0, 42)).toBe(0);
    expect(anmFrameAt(ANM_FRAME_MS, 0, 42)).toBe(1);
    expect(anmFrameAt(ANM_FRAME_MS * 1000, 0, 42)).toBe(41);
    expect(anmDone(ANM_FRAME_MS * 41, 0, 42)).toBe(false);
    expect(anmDone(ANM_FRAME_MS * 42, 0, 42)).toBe(true);
  });

  it('★ 礼花可以循环（原版 `flags & 4`）', () => {
    expect(anmFrameAt(ANM_FRAME_MS * 37, 0, 37, true)).toBe(0);
  });
});

// ============================================================
//  脸
// ============================================================

describe('脸贴片 @source 0x004310ff 的跳表与 0x00475660 的帧表', () => {
  it('★ 帧表逐字节照抄：槽 2 = 8,7,8,10；槽 3 = 16,17,16,15；槽 4 = 9,10；槽 5 = 14,15', () => {
    expect(FACE_SLOT_FRAMES[1]).toEqual([8, 7, 8, 10]);
    expect(FACE_SLOT_FRAMES[2]).toEqual([16, 17, 16, 15]);
    expect(FACE_SLOT_FRAMES[3]).toEqual([9, 10]);
    expect(FACE_SLOT_FRAMES[4]).toEqual([14, 15]);
  });

  it('★ 矩形：右眼 (512,102)-(562,118)、左眼 (52,89)-(102,115)', () => {
    expect(FACE_SLOT_RECT.right).toEqual([0x200, 0x66, 0x232, 0x76]);
    expect(FACE_SLOT_RECT.left).toEqual([0x34, 0x59, 0x66, 0x73]);
    expect(FACE_MOUTH_RECT).toEqual([0x200, 0x77, 0x232, 0x8d]);
  });

  it('★ 空档时抽不到槽就什么都不画', () => {
    const f = faceCtlStart();
    expect(faceStep(f, 0, () => 0.9)).toEqual([]);
    expect(f.ctl).toBe(0);
  });

  it('★ 抽中槽 1 之后逐帧走 8,7,8,10，第四帧停下', () => {
    const f = faceCtlStart();
    // 第一次抽中槽 1（roll = 0）
    let calls = 0;
    const rnd = (): number => (calls++ === 0 ? 0 : 0.9);
    expect(faceStep(f, 0, rnd)).toEqual([]); // 这一帧刚起跳、还没画
    expect(f.ctl & 0x0f).toBe(1);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const out = faceStep(f, i + 1, () => 0.9);
      const eye = out.find((b) => b.at[0] === FACE_SLOT_RECT.right[0]);
      if (eye !== undefined) seen.push(eye.entry);
    }
    expect(seen).toEqual([8, 7, 8, 10]);
    // 放完就回空档（低 4 位清零）
    expect(f.ctl & 0x0f).toBe(0);
  });

  it('★ 抽中槽 2 走左眼那一串 16,17,16,15', () => {
    const f = faceCtlStart();
    let calls = 0;
    // roll = 1 → 槽 2
    const rnd = (): number => {
      calls += 1;
      return calls === 1 ? 1 / 64 : 0.9;
    };
    faceStep(f, 0, rnd);
    expect(f.ctl & 0x0f).toBe(2);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const out = faceStep(f, i + 1, () => 0.9);
      const eye = out.find((b) => b.at[0] === FACE_SLOT_RECT.left[0]);
      if (eye !== undefined) seen.push(eye.entry);
    }
    expect(seen).toEqual([16, 17, 16, 15]);
  });
});

// ============================================================
//  台词
// ============================================================

describe('台词 @source `_rich4_draw_text` 的 `#NNNN` 前缀', () => {
  it('★ 语音号被吃掉', () => {
    expect(bubbleLines('#0017嗨！\n又到了每月\n十五號樂透\n開獎時間～')).toEqual([
      '嗨！',
      '又到了每月',
      '十五號樂透',
      '開獎時間～',
    ]);
  });

  it('★ 语音号抽得出来（本屏不播，留给语音那一层）', () => {
    expect(voiceOf('#0017嗨！')).toBe(17);
    expect(voiceOf('累積獎金')).toBeNull();
  });

  it('★ 金额带千分位', () => {
    expect(currency(1234567)).toBe('$1,234,567');
  });
});

// ============================================================
//  绘制与播放
// ============================================================

const SIZES: Record<string, Record<number, { w: number; h: number }>> = {
  'Panel.mkf:15': Object.fromEntries(
    Object.entries({
      0: { w: 640, h: 480 },
      1: { w: 152, h: 413 },
      2: { w: 206, h: 413 },
      3: { w: 134, h: 422 },
      4: { w: 127, h: 364 },
      5: { w: 124, h: 411 },
      6: { w: 162, h: 460 },
      7: { w: 50, h: 17 },
      8: { w: 50, h: 17 },
      9: { w: 50, h: 17 },
      10: { w: 50, h: 17 },
      11: { w: 50, h: 23 },
      12: { w: 50, h: 23 },
      13: { w: 50, h: 23 },
      14: { w: 50, h: 26 },
      15: { w: 50, h: 26 },
      16: { w: 50, h: 26 },
      17: { w: 50, h: 26 },
      21: { w: 50, h: 40 },
      22: { w: 187, h: 140 },
      23: { w: 233, h: 192 },
      24: { w: 295, h: 262 },
      25: { w: 40, h: 34 },
      26: { w: 31, h: 30 },
      27: { w: 28, h: 25 },
      28: { w: 32, h: 36 },
      29: { w: 36, h: 31 },
      30: { w: 37, h: 33 },
      31: { w: 35, h: 33 },
      32: { w: 35, h: 30 },
      33: { w: 35, h: 35 },
      34: { w: 33, h: 34 },
      35: { w: 34, h: 29 },
      36: { w: 28, h: 32 },
      37: { w: 71, h: 70 },
      38: { w: 71, h: 70 },
      39: { w: 71, h: 70 },
      40: { w: 71, h: 70 },
      41: { w: 71, h: 70 },
      42: { w: 71, h: 70 },
      43: { w: 71, h: 70 },
      44: { w: 71, h: 70 },
      45: { w: 71, h: 70 },
      46: { w: 71, h: 70 },
    }),
  ),
  'Panel.mkf:13': Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i, { w: 14, h: 18 }])),
  'Data.mkf:517': Object.fromEntries([0, 1, 2, 3].map((i) => [i, { w: 189, h: 116 }])),
};

interface Drawn {
  index: number;
  archive: string;
  resource: number;
  x: number;
  y: number;
}

interface Filled {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function fakeCtx(): {
  ctx: CanvasRenderingContext2D;
  images: Drawn[];
  text: { t: string; x: number; y: number; color: string }[];
  rects: Filled[];
} {
  const images: Drawn[] = [];
  const text: { t: string; x: number; y: number; color: string }[] = [];
  const rects: Filled[] = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h, color: String(ctx.fillStyle) });
    },
    drawImage: (b: { index: number; archive: string; resource: number }, x: number, y: number) => {
      images.push({ index: b.index, archive: b.archive, resource: b.resource, x, y });
    },
    fillText: (t: string, x: number, y: number) => {
      text.push({ t, x, y, color: String(ctx.fillStyle) });
    },
    strokeText: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h }),
    putImageData: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images, text, rects };
}

/** 每个图号都带 `index/archive/resource` 的假精灵 */
function fakeSprite(): DrawSprite {
  return (archive, resource, index) => {
    const s = SIZES[`${archive}:${resource}`]?.[index];
    if (s === undefined) return null;
    return {
      bitmap: { index, archive, resource } as unknown as ImageBitmap,
      width: s.w,
      height: s.h,
      anchorX: archive === 'Panel.mkf' && resource === 15 && index >= 37 ? 35 : 0,
      anchorY: archive === 'Panel.mkf' && resource === 15 && index >= 37 ? 35 : 0,
    } as Sprite;
  };
}

function fakeFlic(frames: number): LoadedFlic {
  const list = Array.from({ length: frames }, (_, i) => ({ index: i, flic: true }) as unknown as ImageBitmap);
  return { frames: list, width: 275, height: 270, frameMs: 71, close: () => undefined };
}

interface FakeEnv extends UiScreenEnv {
  now: number;
  logs: string[];
  renders: number;
  state: GameState;
}

function makeEnv(state: GameState, flics: Record<number, LoadedFlic | null> = {}): FakeEnv {
  const env = {
    screen: 'game',
    state,
    topo: {} as UiScreenEnv['topo'],
    map: {} as UiScreenEnv['map'],
    now: 0,
    stage: fakeCtx().ctx,
    sprite: fakeSprite(),
    flic: (archive: string, resource: number) => flics[resource] ?? null,
    dispatch: () => undefined,
    requestRender: () => {
      env.renders += 1;
    },
    log: (m: string) => env.logs.push(m),
    playEffect: () => undefined,
    logs: [] as string[],
    renders: 0,
  };
  void archiveUnused;
  return env as unknown as FakeEnv;
}
const archiveUnused = 0;

// ============================================================
//  绘制
// ============================================================

describe('drawBalls —— 中奖号那两颗球是直接贴的', () => {
  const view = (number: number, step: number): DrawView => ({
    step,
    state: 3,
    cue: { number, numberUnknown: false, winner: null, prize: 0, sold: [], owner: null },
    face: [],
    lines: [],
    balls: [ENTRY.ball + Math.floor(number / 10) % 10, ENTRY.ball + (number % 10)],
    winner: null,
    lottery: [],
    players: 2,
  });

  it('★ 十位在 (286,405)、个位在 (358,405)，减掉球自己的锚点 (35,35)', () => {
    const f = fakeCtx();
    drawBalls(f.ctx, fakeSprite(), view(28, 3)); // 步 3 = 开号
    // 28 → 十位 2（图 39）、个位 8（图 45）
    expect(f.images.map((i) => i.index)).toEqual([39, 45]);
    expect(f.images[0]).toMatchObject({ x: 286 - 35, y: 405 - 35 });
    expect(f.images[1]).toMatchObject({ x: 358 - 35, y: 405 - 35 });
  });

  it('★ 该贴的那几步才贴：摇球（步 2）一颗都不画', () => {
    const f = fakeCtx();
    drawBalls(f.ctx, fakeSprite(), view(28, 2));
    expect(f.images).toEqual([]);
    // 开号（步 3）与状态 4/5/6/7 都要贴
    for (const step of [3, 4, 5, 6, 7]) {
      const g = fakeCtx();
      drawBalls(g.ctx, fakeSprite(), view(28, step));
      expect(g.images.map((i) => i.index), `步 ${step}`).toEqual([39, 45]);
    }
    // 收场那几步不贴
    for (const step of [8, 9]) {
      const g = fakeCtx();
      drawBalls(g.ctx, fakeSprite(), view(28, step));
      expect(g.images, `步 ${step}`).toEqual([]);
    }
  });
});

describe('drawTally —— 压暗底框 + 人像条 + 徽章 + 数字牌', () => {
  it('★ 每个人先罩一块 296×60 的压暗底框（「四个蓝框」）@source 0x0042f482', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1; // 玩家 0 持 07
    const f = fakeCtx();
    drawTally(f.ctx, fakeSprite(), lottery, 2);
    // 两个人 → 两块框，落点就是铭牌（表 0x0042f30c 那两对坐标）
    expect(f.rects).toHaveLength(2);
    expect(f.rects[0]).toMatchObject({ x: 16, y: 340, w: 0x128, h: 0x3c });
    expect(f.rects[1]).toMatchObject({ x: 16, y: 410, w: 0x128, h: 0x3c });
    expect(TALLY_FRAME).toEqual({ w: 296, h: 60, alpha: 0.5 });
    expect(tallyFrameAt(0)).toEqual({ x: 16, y: 340 });
    expect(tallyFrameAt(3)).toEqual({ x: 328, y: 410 });
    expect(tallyFrameAt(4)).toBeNull();
  });

  it('★ 底框压在 人像条/徽章/数字 之前（原版是先压暗再落图）', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const f = fakeCtx();
    // 用调用序记一遍：drawImage 与 fillRect 共用一条时间线
    const order: string[] = [];
    const sp = fakeSprite();
    const ctx = f.ctx as unknown as {
      fillRect: (x: number, y: number, w: number, h: number) => void;
      drawImage: (b: unknown, x: number, y: number) => void;
    };
    const realFill = ctx.fillRect;
    const realDraw = ctx.drawImage;
    ctx.fillRect = (x, y, w, h) => {
      order.push('fill');
      realFill.call(ctx, x, y, w, h);
    };
    ctx.drawImage = (b, x, y) => {
      order.push('draw');
      realDraw.call(ctx, b, x, y);
    };
    drawTally(f.ctx, sp, lottery, 1);
    expect(order[0]).toBe('fill'); // 先压暗
    expect(order.slice(1)).toEqual(['draw', 'draw', 'draw', 'draw']); // 人像条 + 徽章 + 07 两张
  });

  it('★ 人像条与徽章都落在 铭牌 + (0x14, 0x1e)', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1; // 玩家 0 持 07
    const f = fakeCtx();
    drawTally(f.ctx, fakeSprite(), lottery, 2);
    const portrait = f.images.find((i) => i.archive === 'Data.mkf')!;
    expect(portrait).toMatchObject({ index: 0, x: 16 + 0x14, y: 340 + 0x1e });
    const badge = f.images.find((i) => i.resource === 15)!;
    expect(badge).toMatchObject({ index: ENTRY.badge, x: 16 + 0x14, y: 340 + 0x1e });
    const digit = f.images.find((i) => i.resource === 13)!;
    expect(digit).toMatchObject({ index: 0, x: 16 + 0x36, y: 340 + 0x1e });
    // 07 → 十位 0、个位 7
    expect(f.images.filter((i) => i.resource === 13).map((i) => i.index)).toEqual([0, 7]);
  });
});

// ============================================================
//  整屏的播放
// ============================================================

/** 造一次「中奖」的 before/after */
function winPair(): [GameState, GameState] {
  const lottery = new Array<number>(36).fill(0);
  lottery[6] = 1;
  const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery });
  const after = makeState({
    day: 15,
    totalDays: 101,
    pool: 0,
    lottery: new Array<number>(36).fill(0),
    players: [
      { index: 0, cash: 15000, character: 4 },
      { index: 1, cash: 10000, character: 1 },
    ] as GameState['players'],
  });
  return [before, after];
}

describe('整屏的播放 @source 0x0043010c 的状态机', () => {
  /**
   * 一直播到结束，记下「每一步」。
   *
   * ⚠️ 状态 3 要「数 20 帧**且**等摇球放完」—— 摇球 42 帧 × 880 ms ≈ 37 秒
   *   （`0x00430f43` 那条判据），所以整场戏是**分钟级**的，循环要给够。
   */
  function playToEnd(env: FakeEnv): { steps: number[]; phases: number[] } {
    const steps: number[] = [];
    const phases: number[] = [];
    for (let i = 0; i < 4000; i++) {
      if (lotteryDrawStep() < 0) break;
      const cur = lotteryDrawStep();
      env.now += 50;
      lotteryDrawScreen.tick!(env);
      if (lotteryDrawStep() < 0) {
        steps.push(-1);
        phases.push(-1);
        break;
      }
      if (cur >= 0) {
        steps.push(cur);
        phases.push(lotteryDrawPhase());
      }
    }
    return { steps: dedupe(steps), phases: dedupe(phases) };
  }

  /** 把「每一步的连续帧」压成「走过哪几步」 */
  function dedupe(xs: number[]): number[] {
    return xs.filter((v, i) => i === 0 || v !== xs[i - 1]);
  }

  it('★ 察觉開獎就起播，`active()` 在播期间为真', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    expect(lotteryDrawActive()).toBe(false);
    lotteryDrawScreen.event!(before, after, env);
    expect(lotteryDrawActive()).toBe(true);
    expect(lotteryDrawScreen.active(env)).toBe(true);
    expect(lotteryDrawStep()).toBe(0);
    expect(env.logs.join('')).toContain('得主 0');
  });

  it('★ 中奖那一路：12 步走完自己关，状态序列 0→1→2→3→3→4→5→6→8→9→10', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    lotteryDrawScreen.event!(before, after, env);
    const { steps, phases } = playToEnd(env);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1]);
    expect(phases).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, -1]);
    expect(lotteryDrawActive()).toBe(false);
    expect(lotteryDrawScreen.active(env)).toBe(false);
  });

  it('★ 空号那一路：走 7 而不走 4，状态序列 0→1→2→3→3→7→8→9→10', () => {
    resetLotteryDrawScreenState();
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery });
    const after = makeState({ day: 15, totalDays: 101, pool: 5000, lottery: [...lottery] });
    const env = makeEnv(after, { 16: fakeFlic(42) });
    lotteryDrawScreen.event!(before, after, env);
    const { phases } = playToEnd(env);
    expect(phases).toEqual([1, 2, 3, 7, 8, 9, 10, -1]);
    expect(lotteryDrawActive()).toBe(false);
  });

  it('★ 每推进一步都续帧（否则屏永远关不掉）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    lotteryDrawScreen.event!(before, after, env);
    const before2 = env.renders;
    env.now = 5000;
    lotteryDrawScreen.tick!(env);
    expect(env.renders).toBeGreaterThan(before2);
  });

  it('★ 开号那一步之后号码球是 37 + 数字（07 号 → 十位 0、个位 7）', () => {
    // 步 4 = 状态 4（得主）—— 球这时也在（脚本原本给了球，被 localizeStep 摘掉后由 CEREMONY_BALLS 补回）
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() < 4; i++) {
      env.now += 50;
      lotteryDrawScreen.tick!(env);
    }
    const v = lotteryDrawView(env)!;
    expect(v.step).toBe(4);
    expect(v.balls).toEqual([ENTRY.ball, ENTRY.ball + 6]);
  });

  it('★ 中奖那一路第 4 步公布得主名字（角色 4 = 阿土伯）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() < 5; i++) {
      env.now += 50;
      lotteryDrawScreen.tick!(env);
    }
    expect(lotteryDrawStep()).toBe(5);
    const v = lotteryDrawView(env)!;
    expect(v.winner).toBe('阿土伯');
  });

  it('★ 中奖那一路：铭牌上的号码还在（`state.lottery` 已被 core 清空，取的是 `cue.sold`）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    // 开奖后 core 给的那一份是**全 0**（`emptyLottery()`）——
    // 这就是「中奖反而四块空铭牌」的现场
    expect(after.lottery.every((v) => v === 0)).toBe(true);
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    lotteryDrawScreen.event!(before, after, env);

    const seen: string[] = [];
    for (let i = 0; i < 4000 && lotteryDrawStep() >= 0; i++) {
      const v = lotteryDrawView(env)!;
      seen.push(tallyString(v.lottery, 0));
      env.now += 50;
      lotteryDrawScreen.tick!(env);
    }
    // 玩家 0 持 07 号（`winPair` 里 lottery[6] = 1）—— 整场演出都看得见
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['07']));
    // 绘制那一次也真的把两张数字牌贴上了（开号那一步）
    resetLotteryDrawScreenState();
    const env2 = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    const spy = fakeCtx();
    (env2 as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env2);
    for (let i = 0; i < 4000 && lotteryDrawStep() < 4; i++) {
      env2.now += 50;
      lotteryDrawScreen.tick!(env2);
    }
    expect(lotteryDrawStep()).toBe(4);
    lotteryDrawScreen.draw(env2);
    expect(spy.images.filter((i) => i.resource === 13).map((i) => i.index)).toEqual([0, 7]);
  });

  it('★ 号码里有 0 / 1 / 9 时，开号那一步两颗球都画得出来', () => {
    // 21 号 → 十位 2（图 39）、个位 1（图 38）；10 号 → 十位 1（38）、个位 0（37）；
    // 09 号 → 十位 0（37）、个位 9（46）
    for (const [number, want] of [[21, [39, 38]], [10, [38, 37]], [9, [37, 46]]] as const) {
      resetLotteryDrawScreenState();
      const lottery = new Array<number>(36).fill(0);
      lottery[number] = 1;
      const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery });
      const players = [
        { index: 0, cash: 15000, character: 4 },
        { index: 1, cash: 10000, character: 1 },
      ] as GameState['players'];
      const after = makeState({
        day: 15,
        totalDays: 101,
        pool: 0,
        lottery: new Array<number>(36).fill(0),
        players,
      });
      const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
      lotteryDrawScreen.event!(before, after, env);
      // 开号 = 步 3（摇球那一步走完 20 帧 + 摇球 ANM 放完之后）
      for (let i = 0; i < 4000 && lotteryDrawStep() < 3; i++) {
        env.now += 50;
        lotteryDrawScreen.tick!(env);
      }
      expect(lotteryDrawStep()).toBe(3);
      const spy = fakeCtx();
      (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
      lotteryDrawScreen.draw(env);
      const balls = spy.images.filter((i) => i.resource === 15 && i.index >= 37 && i.index <= 46);
      expect(balls.map((b) => b.index), `号码 ${number}`).toEqual([...want]);
      expect(balls.map((b) => ({ x: b.x, y: b.y }))).toEqual([
        { x: 286 - 35, y: 405 - 35 },
        { x: 358 - 35, y: 405 - 35 },
      ]);
    }
  });

  it('★ 空号那一路不公布得主', () => {
    resetLotteryDrawScreenState();
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery });
    const after = makeState({ day: 15, totalDays: 101, pool: 5000, lottery: [...lottery] });
    const env = makeEnv(after, { 16: fakeFlic(42) });
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() < 5; i++) {
      env.now += 50;
      lotteryDrawScreen.tick!(env);
    }
    expect(lotteryDrawView(env)!.winner).toBeNull();
  });
});

// ============================================================
//  与 core 脚本的接口
// ============================================================

describe('core 脚本的步号与本屏的订正表对齐', () => {
  it('★ 中奖那一路 11 步、空号 10 步，步号一一对上', () => {
    const win = lotteryCeremony({ number: 6, winner: 0, prize: 5, lottery: [], pool: 0, rigged: false });
    const lose = lotteryCeremony({ number: 6, winner: null, prize: 5, lottery: [], pool: 5, rigged: false });
    expect(win.map((s: CeremonyStep) => s.state)).toEqual([1, 2, 3, 3, 4, 5, 6, 8, 9, 10]);
    expect(lose.map((s: CeremonyStep) => s.state)).toEqual([1, 2, 3, 3, 7, 8, 9, 10]);
  });

  it('★ 订正表的长度盖得住每一步', () => {
    const win = lotteryCeremony({ number: 6, winner: 0, prize: 5, lottery: [], pool: 0, rigged: false });
    const lose = lotteryCeremony({ number: 6, winner: null, prize: 5, lottery: [], pool: 5, rigged: false });
    for (const steps of [win, lose]) {
      // 建屏（步 0 前面那一下）到末步都要有一条（可以是空数组）
      for (let i = 0; i < steps.length; i++) {
        expect(CEREMONY_ERASE[i], `CEREMONY_ERASE[${i}]`).toBeDefined();
        expect(CEREMONY_BLIT[i], `CEREMONY_BLIT[${i}]`).toBeDefined();
        expect(CEREMONY_BALLS[i], `CEREMONY_BALLS[${i}]`).toBeDefined();
      }
      expect(CEREMONY_BALLS.length).toBeGreaterThanOrEqual(steps.length);
    }
  });

  it('★ 一张票都没卖出去时 core 直接给空脚本（原版此时不开屏）', () => {
    expect(lotteryCeremony({ number: null, winner: null, prize: 0, lottery: [], pool: 0, rigged: false })).toEqual([]);
  });
});

// ============================================================
//  draw 不炸
// ============================================================

describe('drawCeremony 只做 IO', () => {
  it('★ 缺图 / 缺影片时不抛', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, {});
    lotteryDrawScreen.event!(before, after, env);
    expect(() => lotteryDrawScreen.draw(env)).not.toThrow();
    expect(() => drawCeremony(env.stage, env, lotteryDrawView(env)!)).not.toThrow();
  });

  it('★ 底图永远画在最前面（0 号图）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, {});
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env);
    lotteryDrawScreen.draw(env);
    expect(spy.images[0]).toMatchObject({ resource: 15, index: 0, x: 0, y: 0 });
  });
});
