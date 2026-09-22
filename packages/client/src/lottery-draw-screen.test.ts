/*
 * 樂透開獎动画屏的版面、擦除矩形、察觉判据与播放节拍
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4_ui_letou.asm`（窗口过程 `fcn_0043010c`）抄，把最容易写错的
 * 几条钉住：
 *   · 状态 3/4/5/7 那几块**擦除矩形**是从干净底图原样拷回来的，
 *     `x1/y1` 是**开区间**端点（宽度 = `x1 − dx`）—— exe 的实参逐个核过；
 *   · 各人持号表的起点是 `铭牌 + (0x36, 0x1e)`、号码间距 0x28、个位 +0x10，
 *     超过 12 个字符才折行；
 *   · 中奖号那两颗球**不滚**，直接用 37..46 贴出来；
 *   · ANM 的帧间隔 = 開獎屏定时器的 50 ms（一拍推一帧；既不是 FLIC 头里的 71，更不是先前误读的 880）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseSpriteSheet, decodeImage } from '@rich4/assets-pipeline';
import type { CeremonyStep, GameState } from '@rich4/core';
import { ENTRY, POSE_RIGHT, TALLY_PLATES, WHO_PLAYS_HUMAN, lotteryCeremony } from '@rich4/core';
import {
  ceremonyStepsFor,
  ANM_FRAME_MS,
  CEREMONY_BAKE_RETRIES,
  CEREMONY_BALLS,
  CEREMONY_STEP_MAX_MS,
  CEREMONY_BLIT,
  CEREMONY_ERASE,
  DRAW_BUBBLE_AT,
  DRAW_DIGIT_RESOURCE,
  DRAW_DRUM_RESOURCE,
  DRAW_FLOWER_RESOURCE,
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
  setCeremonySurfaceFactory,
} from './lottery-draw-screen.ts';
import type { DrawView, DrawSprite, EraseRect } from './lottery-draw-screen.ts';
import * as mod from './lottery-draw-screen.ts';
import type { LoadedFlic, Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  素材与常量
// ============================================================

describe('用到的图 @source rich4_ui_letou.asm 0x00431712 一带', () => {
  it('★ 舞台是 Panel.mkf 15；摇球 16；礼花 17；数字牌 13（**没有人像条**，W-68-a）', () => {
    expect(DRAW_RESOURCE).toBe(15);
    expect(DRAW_DRUM_RESOURCE).toBe(0x10);
    expect(DRAW_FLOWER_RESOURCE).toBe(0x11);
    expect(DRAW_DIGIT_RESOURCE).toBe(0x0d);
    // ★ W-68-a：`Data.mkf #0x205` 的图 0..3 是**对话框底板**（189×116），
    //   不是人像条 —— 持号表那一屏一次都不该取它。
    expect(Object.keys(mod)).not.toContain('DRAW_PORTRAIT_RESOURCE');
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
  /**
   * `(dx, dy) → 尺寸`：`x1/y1` 是**开区间**端点 ⇒ 宽 = `x1 − dx`、高 = `y1 − dy`。
   * 这一条是拿 exe 的实参核过的：右主持人那张 `Panel#2` 是 **206 宽**，
   * 擦除宽度必须够把她整片盖掉（@source 0x00430418 的 `push 0x1a2`）。
   */
  const size = (r: EraseRect): [number, number] => [r.x1 - r.dx, r.y1 - r.dy];

  it('★ 摇球（步 2 / 状态 3 第一段）：右主持人**整片** 418×140，不是 120×281', () => {
    // ★★ 旧值把宽度当成了闭区间端点、y1 又多算 100 点 ⇒ 只擦掉 120 宽的一条，
    //    而那两张站姿/摊手图重叠区有 87 点 ⇒ 屏上出现**两个主持人**（长跑第 23 条）。
    const rows = CEREMONY_ERASE[2]!;
    // 两条：右主持人整片（exe 的 472,66 + 418×168）与她那一段手臂（474,116 + 418×140）
    expect(rows).toHaveLength(2);
    // @source 0x00430418 `push 0x42 / 0x1a2 / [0x48c360]+0x24` → 图 8 @ (472,66)
    expect(rows[0]).toMatchObject({ from: ENTRY.stage, dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42 });
    // `push 0x42 / 0x1a2` ⇒ (dx,dy)=(472,66)、(x1,y1)=(890,234) ⇒ 418×168（右缘越出 640，照原版不夹）
    expect(size(rows[0]!)).toEqual([0x1a2, 0x8c]);
    // @source 0x00430448 的 `fcn_00456495(dst, 图2, 0,340, 7,116, 134,130)` —— core 脚本已给
    //   「左主持人的腿」那一条，本模块**不再重复**。
    expect(rows).not.toContainEqual(expect.objectContaining({ dx: 7, dy: 0x74 }));
  });

  it('★ 得主（步 4）/ 空号（步 7）的擦除完全一样：414×168 + 414×140', () => {
    const rows = CEREMONY_ERASE[4]!;
    expect(rows).toHaveLength(2);
    // @source 0x00430519 `push 0xa8 / 0x19e / 0x42 / 0x1d8 / 0x42 / 0x1d8` —— 大笑那张（图 5）的地
    expect(rows[0]).toMatchObject({ dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42 });
    // `push 0xa8 / 0x19e` ⇒ (dx,dy)=(472,66)、(x1,y1)=(168,414) ⇒ 168×414
    expect(size(rows[0]!)).toEqual([0xa8, 0x19e]);
    // @source 0x00430543 `push 0x8c / 0x19e / 0x42 / 7 / 0x42 / 7` —— 左板 + 号码球那一片
    expect(rows[1]).toMatchObject({ dx: 7, dy: 0x42, sx: 7, sy: 0x42 });
    // `push 0x8c / 0x19e` ⇒ (dx,dy)=(7,66)、(x1,y1)=(140,414) ⇒ 133×348
    expect(size(rows[1]!)).toEqual([0x8c, 0x19e]);
    // ★ 两张图都**至少覆盖住前一个姿势**：图 5 是 124 宽、图 6 是 162 宽，
    //   落点差 33 点（472→505）—— 擦除宽度小于 33 就会叠出第二个主持人。
    expect(size(rows[0]!)[0]).toBeGreaterThan(505 - 472);
    // 空号（步 7 / 状态 7）与得主那一步的擦除完全一样 @source 0x00430e2f / 0x00430e5f
    expect(CEREMONY_ERASE[7]).toEqual(CEREMONY_ERASE[4]);
    // 收尾（步 8 / 状态 8）那一条由 core 脚本给（右臂），本模块为空
    expect(CEREMONY_ERASE[8]).toEqual([]);
  });

  it('★ 数帧（步 5 / 状态 5）：一条 120×162（号码球台座那一带）', () => {
    // @source 0x00430fe1 `push 0xa2 / 0x78 / 0x154 / 0 / 0x154 / 0`
    const rows = CEREMONY_ERASE[5]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dx: 0, dy: 0x154, sx: 0, sy: 0x154 });
    expect(size(rows[0]!)).toEqual([0x78, 0xa2]);
  });

  it('★ 收尾（步 8 / 状态 8）的右臂擦除由 core 脚本给 @source 0x00430961', () => {
    // 这一步 core 的 `patches` 已经带了两条：
    //   ① 右主持人整条（从舞台 (489,116) 拷 151×364 回同点）@source 0x00430961 那一支
    //   ② 左脸（从**图 3** 自己的 (45,23) 拷 50×40 回 (52,89)）@source 0x004309d4
    const own = lotteryCeremony({ number: 6, winner: 0, prize: 5, lottery: [], pool: 0, rigged: false })
      .find((s) => s.state === 8)!;
    expect(own.patches).toHaveLength(2);
    expect(own.patches[0]).toMatchObject({ from: ENTRY.stage, at: [489, 116], from4: [489, 116, 151, 364] });
    expect(own.patches[1]).toMatchObject({ from: ENTRY.board, at: [52, 89], from4: [45, 23, 50, 40] });
  });

  it('★ 擦除矩形都不许越过 640×480 舞台（除原版自己越界的那两条）', () => {
    for (const rows of CEREMONY_ERASE) {
      for (const r of rows) {
        expect(r.dx).toBeGreaterThanOrEqual(0);
        expect(r.dy).toBeGreaterThanOrEqual(0);
        expect(r.x1).toBeGreaterThan(r.dx);
        expect(r.y1).toBeGreaterThan(r.dy);
      }
    }
  });

  it('★ 摇球那一步要重画两个主持人、数帧那一步重画举板；收尾那一步由 core 贴', () => {
    // ★ 重画与擦除**同一格**：擦的是他们身上的板与腿（CEREMONY_ERASE[2]），
    //   擦完紧接着把他们自己贴回去（@source 0x00430418 之后那两次 `fcn_00456418`）
    expect(CEREMONY_BLIT[2]).toEqual([
      { entry: ENTRY.board, at: [7, 0x42] },
      { entry: ENTRY.presenting, at: [0x1d8, 0x42] },
    ]);
    expect(CEREMONY_BLIT[5]).toEqual([{ entry: ENTRY.jumpBoard, at: [0, 0] }]);
    // ★ core 脚本的状态 8 自己带了 `{ entry: 图1, at: POSE_RIGHT }` —— 这里不再重复贴
    const own = lotteryCeremony({ number: 6, winner: 0, prize: 5, lottery: [], pool: 0, rigged: false })
      .find((s) => s.state === 8)!;
    expect(own.blits).toEqual([{ entry: ENTRY.pointing, at: POSE_RIGHT }]);
    expect(CEREMONY_BLIT[8]).toEqual([]);
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
function withTicket(number: number, player: number): number[] {
  const lot = new Array<number>(36).fill(0);
  lot[number] = player + 1;
  return lot;
}

function makeState(over: Partial<GameState> = {}): GameState {
  return {
    day: 14,
    totalDays: 100,
    year: 1,
    month: 1,
    pool: 1000,
    lottery: new Array<number>(36).fill(0),
    players: [
      { index: 0, cash: 10000, character: 0, whoPlays: WHO_PLAYS_HUMAN },
      { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
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
      { index: 0, cash: 10000, character: 0, whoPlays: WHO_PLAYS_HUMAN },
      { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
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

describe('ANM 的帧间隔 @source 開獎屏 WM_TIMER 每拍 `0x00430351 call 0x450f04` 推一帧', () => {
  it('★★ 一帧 = 一拍 = 50 ms（第八份 #7；先前的 880 ms 是把 pitch 读成了延时）', () => {
    expect(ANM_FRAME_MS).toBe(50);
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
  /** 实参个数 —— 9 个的是 `erase()` 的「从子图拷一块」，3 个的是 `blit()` */
  argc: number;
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
    drawImage: (...args: unknown[]) => {
      const b = args[0] as { index?: number; archive?: string; resource?: number };
      const x = args[1] as number;
      const y = args[2] as number;
      const argc = args.length;
      // ★ W-68-b：`drawImage(surface, 0, 0)` 传进来的是一块**画布**（没有 index/archive）
      //   —— 记成 `surface`，于是「持久表面只贴一次」也能断言。
      if (b === null || typeof b !== 'object' || b.index === undefined) {
        images.push({ index: -1, archive: 'surface', resource: -1, x, y, argc });
        return;
      }
      images.push({ index: b.index, archive: b.archive ?? '', resource: b.resource ?? -1, x, y, argc });
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

function makeEnv(
  state: GameState,
  flics: Record<number, LoadedFlic | null> = {},
  animation?: boolean,
): FakeEnv {
  const env = {
    screen: 'game',
    state,
    topo: {} as UiScreenEnv['topo'],
    map: {} as UiScreenEnv['map'],
    now: 0,
    // `animation` 省略 = 按 true 算（契约里就是 optional）
    ...(animation === undefined ? {} : { animation }),
    stage: fakeCtx().ctx,
    // ★ W-68-b：持久表面 —— 单测里与舞台**共用同一个记录 ctx**，
    //   于是「烤进表面的那几步」照样出现在 `images` 里可按原样断言。
    //   （生产代码用真的 `OffscreenCanvas` / `<canvas>`，见 `defaultSurface`。）
    __surface: fakeCtx(),
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
  const out = env as unknown as FakeEnv & { __surface: ReturnType<typeof fakeCtx> };
  // ★ W-68-b：把「表面工厂」接到**当前的** `env.stage` 上（**惰性读**）——
  //   有几条用例会在 `makeEnv` 之后把 `env.stage` 换成一个新的记录 ctx
  //   （`.stage = spy.ctx`），惰性读才能让烤进表面的东西也进那个 spy。
  //   生产代码不设这一项（走真的 `OffscreenCanvas` / `<canvas>`）。
  setCeremonySurfaceFactory(() => ({
    canvas: { surface: true } as unknown as CanvasImageSource,
    // ★ 用 **getter**：`begin()` 是在 `event()` 里调的，而有些用例在那之后才
    //   把 `env.stage` 换成新的记录 ctx —— 取值时才读，才跟得上那一次替换。
    get ctx(): CanvasRenderingContext2D {
      return out.stage;
    },
  }));
  return out;
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

describe('drawTally —— 压暗底框 + 徽章 + 数字牌（W-68-a 订正）', () => {
  /**
   * ★★ 2026-09-20 订正（W-68-a）：先前这里还画过一条「人像条」
   *   （`Data.mkf #0x205` 的图 = 玩家号）—— **那一步根本不存在**：
   *   `Data.mkf #0x205` 的图 0..3 是四块带尖角的**对话框底板**
   *   （189×116，锚点分别在四个角），属于 `player_say` 那一段（W-50 的气泡图
   *   就是同一张资源的图 6）。原版 `fcn_0042f417` 每个人只画三样：
   *   ① 压暗的 296×60 底框、② `Panel#15` 图 `25 + **角色号**` 的徽章、③ 号码数字。
   *   ⇒ 「一进去四个空白对话框」就是那一步画的。
   */
  it('★ 每个人先罩一块 296×60 的压暗底框（「四个蓝框」）@source 0x0042f482', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1; // 玩家 0 持 07
    const f = fakeCtx();
    drawTally(f.ctx, fakeSprite(), lottery, [0, 1], [true, true]);
    // 两个人 → 两块框，落点就是铭牌（表 0x0042f30c 那两对坐标）
    expect(f.rects).toHaveLength(2);
    expect(f.rects[0]).toMatchObject({ x: 16, y: 340, w: 0x128, h: 0x3c });
    expect(f.rects[1]).toMatchObject({ x: 16, y: 410, w: 0x128, h: 0x3c });
    expect(TALLY_FRAME).toEqual({ w: 296, h: 60, alpha: 0.5 });
    expect(tallyFrameAt(0)).toEqual({ x: 16, y: 340 });
    expect(tallyFrameAt(3)).toEqual({ x: 328, y: 410 });
    expect(tallyFrameAt(4)).toBeNull();
  });

  it('★★ 整张持号表**一次都不取** `Data.mkf #0x205`（那四张是对话框底板，不是人像条）', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const f = fakeCtx();
    drawTally(f.ctx, fakeSprite(), lottery, [3, 0], [true, true]);
    expect(f.images.filter((i) => i.archive === 'Data.mkf')).toEqual([]);
    expect(f.images.every((i) => i.archive === 'Panel.mkf')).toBe(true);
  });

  it('★★ 徽章图号 = `ENTRY.badge + **角色号**`（不是玩家下标）@source 0x0042f4b1', () => {
    const lottery = new Array<number>(36).fill(0);
    const f = fakeCtx();
    // 角色号与下标**故意错开**：[3, 0, 7, 5]
    drawTally(f.ctx, fakeSprite(), lottery, [3, 0, 7, 5], [true, true, true, true]);
    const badges = f.images.filter((i) => i.resource === 15).map((i) => i.index);
    expect(badges).toEqual([
      ENTRY.badge + 3,
      ENTRY.badge + 0,
      ENTRY.badge + 7,
      ENTRY.badge + 5,
    ]);
    // 反证：旧实现（`ENTRY.badge + 玩家下标`）会得到 25/26/27/28
    expect(badges[0]).not.toBe(ENTRY.badge + 0);
  });

  it('★★ 第 2 位出局时，第 3 位玩家画在**第 2 块**铭牌上（铭牌号与玩家号分开数）', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const f = fakeCtx();
    // 玩家 0 活着、玩家 1 **出局**、玩家 2 活着
    drawTally(f.ctx, fakeSprite(), lottery, [3, 0, 7], [true, false, true]);
    // 两块框（只有两个活人）⇒ 第二块还是第 1 块铭牌的位置
    expect(f.rects).toHaveLength(2);
    // 徽章按**玩家**顺序取角色号，但落点按**铭牌**顺序
    const badges = f.images.filter((i) => i.resource === 15);
    expect(badges.map((b) => b.index)).toEqual([ENTRY.badge + 3, ENTRY.badge + 7]);
    expect(badges[0]).toMatchObject({ x: 16 + 0x14, y: 340 + 0x1e }); // 第 1 块
    expect(badges[1]).toMatchObject({ x: 16 + 0x14, y: 410 + 0x1e }); // 第 2 块
  });

  it('★★ 出局的人被跳过时，**号码**也跟着玩家走（内容按玩家号、落点按铭牌号）', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 3; // 玩家 2（下标 2）持 07 号
    const f = fakeCtx();
    // 玩家 1 出局 ⇒ 玩家 2 落在第 2 块铭牌上
    drawTally(f.ctx, fakeSprite(), lottery, [3, 0, 7], [true, false, true]);
    // 号码 07 的两张数字牌必须在**第 2 块**铭牌（y = 410 + 0x1e）上
    const digits = f.images.filter((i) => i.resource === 13);
    expect(digits.map((d) => d.index)).toEqual([0, 7]);
    expect(digits.map((d) => d.y)).toEqual([410 + 0x1e, 410 + 0x1e]);
    // 反证：旧实现（拿铭牌号当玩家号读 `state.lottery`）什么都不会画
    expect(digits.length).toBeGreaterThan(0);
  });

  it('★ 底框压在 徽章/数字 之前（原版是先压暗再落图）', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1;
    const f = fakeCtx();
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
    drawTally(f.ctx, sp, lottery, [0], [true]);
    expect(order[0]).toBe('fill'); // 先压暗
    expect(order.slice(1)).toEqual(['draw', 'draw', 'draw']); // 徽章 + 07 两张
  });

  it('★ 徽章落在 铭牌 + (0x14, 0x1e)；号码数字照旧', () => {
    const lottery = new Array<number>(36).fill(0);
    lottery[6] = 1; // 玩家 0 持 07
    const f = fakeCtx();
    drawTally(f.ctx, fakeSprite(), lottery, [2, 1], [true, true]);
    const badge = f.images.find((i) => i.resource === 15)!;
    expect(badge).toMatchObject({ index: ENTRY.badge + 2, x: 16 + 0x14, y: 340 + 0x1e });
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
      { index: 0, cash: 15000, character: 4, whoPlays: WHO_PLAYS_HUMAN },
      { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
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

  it('★ 「動畫過程」关掉：**跳过状态 1**（主持人开场那句），从 2 开始', () => {
    // @source `loc_004301b0`（VA 0x004301b0）：`cmp [0x497159],0 / je → [0x48c37b] = 2`
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) }, false);
    lotteryDrawScreen.event!(before, after, env);
    const { phases } = playToEnd(env);
    expect(phases).toEqual([2, 3, 4, 5, 6, 8, 9, 10, -1]);
    // 开场那一句（`#0017`）也不再念
    expect(env.logs.join('')).not.toContain('開獎時間');
  });

  it('★ `ceremonyStepsFor` 只丢状态 1，其余一步不动（纯函数）', () => {
    const all = lotteryCeremony({ number: 123, winner: 0, prize: 100, lottery: [], pool: 0, rigged: false });
    expect(ceremonyStepsFor(all, true)).toBe(all);
    const trimmed = ceremonyStepsFor(all, false);
    expect(trimmed.length).toBe(all.length - 1);
    expect(all.some((x) => x.state === 1)).toBe(true);
    expect(trimmed.some((x) => x.state === 1)).toBe(false);
    // 其余状态序原样
    expect(trimmed.map((x) => x.state)).toEqual(all.filter((x) => x.state !== 1).map((x) => x.state));
  });

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
    // ★ W-68-b：表面是**持久的**，数字牌因此画了不止一次（建屏那一步一次；步 2 把
    //   铭牌那一条带擦回干净底图之后又补一次）。这里要的是「一直画得出来」：
    //   号码始终是 0 与 7 这两张数字牌，且至少画过两轮。
    const digits = spy.images.filter((i) => i.resource === 13).map((i) => i.index);
    expect(new Set(digits)).toEqual(new Set([0, 7]));
    expect(digits.length).toBeGreaterThanOrEqual(4);
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
        { index: 0, cash: 15000, character: 4, whoPlays: WHO_PLAYS_HUMAN },
        { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
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

// ============================================================
//  持久表面（W-68-b）
// ============================================================

describe('持久表面 —— 建屏画一次，之后只在上面擦一块补一块', () => {
  /**
   * 2026-09-20（W-68-b）：先前 `drawCeremony()` **每帧**从底图重画、却只画当前这一步，
   * 于是建屏那一步（`CEREMONY_BASE`）画的主持人与「累積獎金」到下一步就没了。
   * 原版整屏是一块**持久的离屏表面**。
   */
  function playThrough(drawsPerTick: number): { spy: ReturnType<typeof fakeCtx>; env: FakeEnv } {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() >= 0; i++) {
      for (let k = 0; k < drawsPerTick; k++) lotteryDrawScreen.draw(env);
      env.now += 50;
      lotteryDrawScreen.tick!(env);
    }
    return { spy, env };
  }

  it('★★ 底图（`Panel#15` 图 0）整场只贴一次 —— 先前每帧一次', () => {
    const { spy } = playThrough(3);
    // 只数**贴图**（3 个实参）；9 个实参的是 `erase()` 从底图拷回来，不算「重画底图」
    expect(spy.images.filter((i) => i.resource === 15 && i.index === 0 && i.argc === 3)).toHaveLength(1);
    // 合成表面那一句每帧一次（这里是 3 次/拍），说明帧还在走、只是不再重画底图
    expect(spy.images.filter((i) => i.archive === 'surface').length).toBeGreaterThan(10);
  });

  it('★★ 建屏画的「累積獎金」那次 fillText 在第一次合成**之前**，且整场只画一次', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, { 16: fakeFlic(42), 17: fakeFlic(37) });
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    // 把两种记录并到一条时间线上，才能断言「文字在表面合成之前」
    const log: string[] = [];
    const c = spy.ctx as unknown as {
      fillText: (t: string, x: number, y: number) => void;
      drawImage: (b: unknown, x: number, y: number) => void;
    };
    const realText = c.fillText;
    const realImage = c.drawImage;
    c.fillText = (t, x, y) => {
      log.push(`text:${t}`);
      realText.call(c, t, x, y);
    };
    c.drawImage = (b, x, y) => {
      log.push(b !== null && typeof b === 'object' && 'index' in b ? 'sprite' : 'surface');
      realImage.call(c, b, x, y);
    };
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() < 3; i++) {
      lotteryDrawScreen.draw(env);
      env.now += 50;
      lotteryDrawScreen.tick!(env);
    }
    expect(lotteryDrawStep()).toBeGreaterThanOrEqual(3);
    const amount = currency(5000);
    expect(spy.text.filter((t) => t.t === amount)).toHaveLength(1);
    const at = log.indexOf(`text:${amount}`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('surface')).toBeGreaterThan(at);
  });

  it('★★ 有图没解好时整步不烤：表面上零次绘制（不许烤一半）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, {});
    const stage = fakeCtx();
    const surface = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = stage.ctx;
    setCeremonySurfaceFactory(() => ({ canvas: {} as CanvasImageSource, ctx: surface.ctx }));
    (env as { sprite: unknown }).sprite = () => null;
    lotteryDrawScreen.event!(before, after, env);
    lotteryDrawScreen.draw(env);
    expect(surface.images).toEqual([]);
    expect(surface.rects).toEqual([]);
    expect(surface.text).toEqual([]);
    // 舞台上只贴了一次（还是空的）表面
    expect(stage.images).toHaveLength(1);
    resetLotteryDrawScreenState();
  });

  it('★★ 徽章没到货时建屏那一步也不烤 —— 先前只查底图/文字，铭牌会**永远**缺头像', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, {});
    const stage = fakeCtx();
    const surface = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = stage.ctx;
    setCeremonySurfaceFactory(() => ({ canvas: {} as CanvasImageSource, ctx: surface.ctx }));
    // 只让「角色徽章」这一族解不出来，别的都正常
    const base = fakeSprite();
    (env as { sprite: DrawSprite }).sprite = ((archive, resource, index, key) =>
      archive === 'Panel.mkf' && resource === 15 && index >= ENTRY.badge
        ? null
        : base(archive, resource, index, key)) as DrawSprite;
    lotteryDrawScreen.event!(before, after, env);
    lotteryDrawScreen.draw(env);
    expect(surface.images).toEqual([]); // 一张都不许烤（不许烤一半）
    // 等得太久还是没到货 ⇒ 照烤 —— 否则一张永远解不出来的图会把整场戏钉成空白
    for (let i = 0; i <= CEREMONY_BAKE_RETRIES; i++) lotteryDrawScreen.draw(env);
    expect(surface.images.length).toBeGreaterThan(0);
    resetLotteryDrawScreenState();
  });

  it('★★ 擦除不再回读像素：源码里 `getImageData` / `putImageData` 一次都没有（68-c）', () => {
    const src = readFileSync(new URL('./lottery-draw-screen.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('getImageData');
    expect(src).not.toContain('putImageData');
  });
});

// ============================================================
//  真值：擦除矩形必须**真的盖住**那个姿势（用素材自己的像素量）
// ============================================================

/**
 * 2026-09-19 长跑第 23 条的回归。
 *
 * 症状：右侧主持人画了两个（原来那张 + 新姿势那张叠在一起）。
 * 根因：`CEREMONY_ERASE` 的值抄错了 —— 宽度被当成闭区间端点、
 *   `y1` 又多算 100 点。这里不看常量、**直接量素材**：
 *   把那两张图各自的**不透明包围盒**算出来，检查「擦掉旧的」那句是不是兑现了。
 *
 * 掉进这个坑的门槛很低（三个调用点的实参形状各不相同），所以这一条按
 * 「几何覆盖」写，而不是按「等于某个数」写 —— 换更好的抄法也不会误红。
 */
describe('真值：右侧主持人不会被画两次（长跑第 23 条）', () => {
  const ROOT = process.env.RICH4_WORKSPACE ?? '';
  const hasAssets = existsSync(`${ROOT}/Rich4/Panel.mkf`);
  const d = hasAssets ? describe : describe.skip;

  /**
   * 屏上真正会被改到的范围 = `resolveErase` 出来的那块（源被夹到子图、再夹到舞台）。
   * 这就是「擦掉」的可见效果 —— 按屏上像素算，不按传进去的端点算。
   */
  function eraseHits(step: number, spriteW: number, spriteH: number): { x0: number; y0: number; x1: number; y1: number }[] {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const r of CEREMONY_ERASE[step] ?? []) {
      if (r.from !== ENTRY.stage) continue; // 只有从舞台拷回才是「变回背景」
      const c = resolveErase(r, spriteW, spriteH);
      if (c === null) continue;
      out.push({ x0: c.dx, y0: c.dy, x1: c.dx + c.w - 1, y1: c.dy + c.h - 1 });
    }
    return out;
  }

  /** 屏上可见范围 —— 越出 640×480 的像素看不见，不必擦 */
  function onScreen(rect: { x: number; y: number; w: number; h: number }): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.max(0, rect.x),
      y0: Math.max(0, rect.y),
      x1: Math.min(639, rect.x + rect.w - 1),
      y1: Math.min(479, rect.y + rect.h - 1),
    };
  }

  /** 这些擦除能不能盖住 `rect` 的屏上可见范围 */
  function covered(
    hits: readonly { x0: number; y0: number; x1: number; y1: number }[],
    rect: { x: number; y: number; w: number; h: number },
  ): boolean {
    const v = onScreen(rect);
    for (let y = v.y0; y <= v.y1; y++) {
      for (let x = v.x0; x <= v.x1; x++) {
        if (!hits.some((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1)) return false;
      }
    }
    return true;
  }

  d('@source Panel#2 / #5 / #6 的可见范围', () => {
    /** `Panel#15` 每张子图的真实尺寸（从素材表里问，别抄） */
    function sizeOf(index: number): { w: number; h: number } {
      const raw = new MkfArchive(new Uint8Array(readFileSync(`${ROOT}/Rich4/Panel.mkf`))).read(15, 'none');
      const sheet = parseSpriteSheet(raw)!;
      const im = decodeImage(sheet, raw, index);
      return { w: im.width, h: im.height };
    }

    it('★ 素材：图 2 = 206×413、图 5 = 124×411、图 6 = 162×460（擦除尺寸要按这个来）', () => {
      expect(sizeOf(2)).toEqual({ w: 206, h: 413 });
      expect(sizeOf(5)).toEqual({ w: 124, h: 411 });
      expect(sizeOf(6)).toEqual({ w: 162, h: 460 });
    });

    it('★★ 摇球（步 2）：图 2 的**上段（头 + 上身）**被擦掉，且摊手那张仍贴在原位', () => {
      const s2 = sizeOf(2);
      const hits = eraseHits(2, 640, 480);
      // 右主持人换姿势时**只有头/上身那一段**被换掉（@source 0x00430418 擦 472,66 + 418×168）
      // ⇒ 这一段必须全被擦到；旧值（x1=0x250）只盖到 592 ⇒ 这一条会红。
      expect(covered(hits, { x: 472, y: 66, w: 168, h: 168 })).toBe(true);
      // 旧的 120 宽版本盖不住 (592,66)-(639,233) 那一段
      const oldHits = resolveErase(
        { from: ENTRY.stage, dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42, x1: 0x250, y1: 0x15b },
        640,
        480,
      )!;
      expect(covered([{ x0: oldHits.dx, y0: oldHits.dy, x1: oldHits.dx + oldHits.w - 1, y1: oldHits.dy + oldHits.h - 1 }], {
        x: 472,
        y: 66,
        w: 168,
        h: 168,
      })).toBe(false);
      // 擦完必须把摊手那张**贴回同一格**（不然头被擦掉就没了）
      expect(CEREMONY_BLIT[2]).toContainEqual({ entry: ENTRY.presenting, at: [0x1d8, 0x42] });
      expect(s2.w).toBe(206);
    });

    it('★★ 得主（步 4）/ 空号（步 7）：图 2 的屏上可见范围全被擦掉', () => {
      const s2 = sizeOf(2);
      for (const step of [4, 7]) {
        expect(covered(eraseHits(step, 640, 480), { x: 472, y: 66, w: s2.w, h: s2.h })).toBe(true);
      }
      expect(CEREMONY_ERASE[7]).toEqual(CEREMONY_ERASE[4]);
    });

    it('★ 分辩力：旧值（`x1 = 0x1d8+49`）盖不住图 2 的右半 —— 那正是「两个主持人」', () => {
      const s2 = sizeOf(2);
      const oldStep4 = [
        { from: ENTRY.stage, dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42, x1: 0x1d8 + 49, y1: 0x42 + 441 },
        { from: ENTRY.stage, dx: 7, dy: 0x42, sx: 7, sy: 0x42, x1: 7 + 135, y1: 0x42 + 441 },
      ] as EraseRect[];
      const hits = oldStep4
        .map((r) => resolveErase(r, 640, 480))
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .map((c) => ({ x0: c.dx, y0: c.dy, x1: c.dx + c.w - 1, y1: c.dy + c.h - 1 }));
      expect(covered(hits, { x: 472, y: 66, w: s2.w, h: s2.h })).toBe(false);
      // 露出来的宽度 = 206 里没擦到的那一段
      expect(hits[0]!.x1).toBe(520);
    });
  });

});

describe('死锁保护：影片解不出来时屏也必须能关掉', () => {
  it('★ 每步最多停 90 秒 —— 摇球那步的正常时长（37 秒 + 1 秒）离它还有一倍', () => {
    // 42 帧 × 880 ms + 20 拍 × 50 ms
    expect(CEREMONY_STEP_MAX_MS).toBeGreaterThan(42 * ANM_FRAME_MS + 20 * 50);
    expect(CEREMONY_STEP_MAX_MS).toBeLessThanOrEqual(180_000); // 看门狗报停摆的阈值之下
  });

  it('★★ 反证：`flic()` 永远返回 null 时，演出也会自己走完（不再钉死整局）', () => {
    resetLotteryDrawScreenState();
    // ★ 关键：`flic` 恒 null —— 模拟 `uiFlicNow` 把「解不出来」缓存成 null 的那种局面
    const env = makeEnv(makeState({ players: [] }), {});
    const before = makeState({ day: 14, totalDays: 100, pool: 5000, lottery: withTicket(6, 0) });
    const after = makeState({
      day: 15,
      totalDays: 101,
      pool: 0,
      lottery: new Array<number>(36).fill(0),
      players: [
        { index: 0, cash: 15000, character: 4, whoPlays: WHO_PLAYS_HUMAN },
        { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
      ] as GameState['players'],
    });
    lotteryDrawScreen.event!(before, after, env);
    expect(lotteryDrawActive()).toBe(true);
    let ticks = 0;
    while (lotteryDrawActive() && ticks < 4000) {
      env.now += 50;
      lotteryDrawScreen.tick!(env);
      ticks++;
    }
    expect(lotteryDrawActive()).toBe(false);
  });
});
