/*
 * 樂透開獎动画屏的版面、察觉判据与播放次序
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 次序与坐标全部照 `rich4_ui_letou.asm`（窗口过程 `fcn_0043010c`）抄 —— 逐拍的
 * 原版次序表在 `core/places/lottery-ceremony.ts` 的文件头。这里钉住最容易写错的几条：
 *   · 开号那一拍**两颗号码球 + 屏幕正中的大号数字**（`Data.mkf#517` 图 8..17），
 *     号码是 `%02d` 的**槽号 + 1**（第十二份試玩回報「沒展現出本期開獎號碼」）；
 *   · 分紅屏占着整屏时本屏**不起算**（否则开场白被吃掉）；
 *   · 「本月份的得主是．．．。」说完才揭晓得主；空号那两句写在正中的**黄色爆炸框**里；
 *   · 各人持号表的起点是 `铭牌 + (0x36, 0x1e)`、号码间距 0x28、个位 +0x10，
 *     超过 12 个字符才折行；
 *   · ANM 的帧间隔 = 開獎屏定时器的 50 ms（一拍推一帧）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseSpriteSheet, decodeImage } from '@rich4/assets-pipeline';
import type { GameState, LotteryDrawHint } from '@rich4/core';
import { ENTRY, TALLY_PLATES, WHO_PLAYS_HUMAN, lotteryCeremony } from '@rich4/core';
import {
  ceremonyStepsFor,
  ANM_FRAME_MS,
  CEREMONY_BAKE_RETRIES,
  CEREMONY_LOAD_WAIT_MS,
  CEREMONY_STEP_MAX_MS,
  DRAW_BIG_DIGIT_RESOURCE,
  DRAW_BUBBLE_AT,
  DRAW_BUBBLE_TEXT,
  DRAW_DIGIT_RESOURCE,
  DRAW_DRUM_RESOURCE,
  DRAW_FLOWER_RESOURCE,
  DRAW_RESOURCE,
  FACE_MOUTH_RECT,
  FACE_SLOT_FRAMES,
  FACE_SLOT_RECT,
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
  clipSrc,
  currency,
  drawCeremony,
  drawTally,
  faceCtlStart,
  faceStep,
  frameTextCenter,
  lotteryDrawActive,
  lotteryDrawCue,
  lotteryDrawPhase,
  lotteryDrawScreen,
  lotteryDrawStep,
  lotteryDrawView,
  resetLotteryDrawScreenState,
  tallyArtAt,
  tallyDigits,
  tallyFrameAt,
  tallyString,
  voiceOf,
  setCeremonySurfaceFactory,
  DRAW_VOICE_MAX_ASKS,
  DRAW_VOICE_RETRY_MS,
} from './lottery-draw-screen.ts';
import type { DrawSprite } from './lottery-draw-screen.ts';
import * as mod from './lottery-draw-screen.ts';
import type { LoadedFlic, Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';
import { setVoiceBusyProbe, setVoiceSink, setVoiceStopper } from './voice-sink.ts';

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

  it('★★ 开号那一拍中央的大号数字在 `Data.mkf` 517（图 8..17）@source 0x0040808f `push 0x205` → `[0x48bad8]`', () => {
    expect(DRAW_BIG_DIGIT_RESOURCE).toBe(0x205);
  });

  it('★ 号码球 = 37..46；徽章 = 25 + 角色号', () => {
    expect(ENTRY.ball).toBe(37);
    expect(ENTRY.badge).toBe(25);
    expect(badgeEntry(0)).toBe(25);
    expect(badgeEntry(11)).toBe(36);
  });

  it('★★ 气泡在 (300, 47)，字心左移 10 —— `fcn_0044ec30` 的第 2/3 参是落点、第 4/5 参才是字心偏移', () => {
    // @source 0x0042f7b7–0x0042f7d4 `push 0 / 0x101010 / 0 / −0xa / 0x2f / 0x12c / 图22`
    //   先前读成 (300, −10)：把字心偏移 −0xa 当成了 y。
    expect(DRAW_BUBBLE_AT).toEqual([0x12c, 0x2f]);
    expect(DRAW_BUBBLE_TEXT).toEqual({ dx: -0x0a, dy: 0, size: 0x14 });
  });

  it('★ 持号表那一条带 (16,340) 608×130 —— 与 core 脚本的 CLEAR_PLATES_BAND 同值', () => {
    expect(TALLY_BAND).toEqual({ x: 0x10, y: 0x154, w: 0x260, h: 0x82 });
    expect(TALLY_BAND.w).toBe(608);
    expect(TALLY_BAND.h).toBe(130);
  });
});

describe('字框里字心的位置 @source `fcn_0044ecb6` 0x0044ed7b–0x0044eda6', () => {
  it('★ 气泡：框左上 (300,47) + (⌊187/2⌋, ⌊140/2⌋) + (−10, 0) = (383, 117)', () => {
    expect(frameTextCenter('bubble', { width: 187, height: 140, anchorX: 0, anchorY: 0 })).toEqual({ x: 383, y: 117 });
  });

  it('★ 黄色爆炸框：锚点 (120,98) 落在 (320,200) ⇒ 框左上 (200,102)，字心 (316, 198)', () => {
    expect(frameTextCenter('burst', { width: 233, height: 192, anchorX: 120, anchorY: 98 })).toEqual({ x: 316, y: 198 });
  });
});

describe('clipSrc —— 局部贴的源矩形是**宽高**（不是端点），越出子图的部分不画', () => {
  it('★ 原样', () => {
    expect(clipSrc([0, 274, 134, 130], 134, 422)).toEqual({ sx: 0, sy: 274, w: 134, h: 130 });
  });

  it('★ 越出子图就夹掉', () => {
    expect(clipSrc([600, 0, 50, 10], 640, 480)).toEqual({ sx: 600, sy: 0, w: 40, h: 10 });
    expect(clipSrc([700, 0, 50, 10], 640, 480)).toBeNull();
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
      { index: 0, cash: 10000, character: 0, whoPlays: WHO_PLAYS_HUMAN },
      { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
    ] as GameState['players'],
    lastLotteryDraw: null,
    ...over,
  } as unknown as GameState;
}


/**
 * 一次开奖的 before/after —— `after` 带 core 交出来的 `lastLotteryDraw`（本期号码）。
 *
 * @param slot 开出的**槽号**（屏上显示 `slot + 1`）
 * @param holder 谁持这个号（玩家下标）；`null` = 没人买（空号）
 */
function drawPair(slot: number, holder: number | null, pool = 5000): [GameState, GameState] {
  const sold = new Array<number>(36).fill(0);
  if (holder !== null) sold[slot] = holder + 1;
  else sold[(slot + 1) % 36] = 1; // 至少卖出一张（否则原版不开屏），但不是开出的那个号
  const players = [
    { index: 0, cash: 10000, character: 4, whoPlays: WHO_PLAYS_HUMAN },
    { index: 1, cash: 10000, character: 1, whoPlays: WHO_PLAYS_HUMAN },
  ] as GameState['players'];
  const before = makeState({ day: 14, totalDays: 100, pool, lottery: sold, players });
  const hint: LotteryDrawHint = { number: slot, winner: holder, pool, sold: [...sold] };
  const after = makeState({
    day: 15,
    totalDays: 101,
    pool: holder === null ? pool : 0,
    lottery: holder === null ? [...sold] : new Array<number>(36).fill(0),
    players: holder === null ? players : players.map((p, i) => (i === holder ? { ...p, cash: p.cash + pool } : p)),
    lastLotteryDraw: hint,
  });
  return [before, after];
}

/** 造一次「中奖」的 before/after：玩家 0（阿土伯，角色 4）持 07 号（槽 6）*/
function winPair(): [GameState, GameState] {
  return drawPair(6, 0);
}

/** 造一次「空号」的 before/after：开出 23 号（槽 22），没人买 */
function losePair(): [GameState, GameState] {
  return drawPair(22, null);
}

describe('lotteryDrawCue —— 读 core 交出来的 `lastLotteryDraw`', () => {
  it('★ 没有提示（不是开奖那一条 action）→ null', () => {
    expect(lotteryDrawCue(makeState(), makeState())).toBeNull();
    // 日期跨到 15 号但 core 没写提示（一张票都没卖出，原版不开屏）→ null
    expect(lotteryDrawCue(makeState({ day: 14, totalDays: 100 }), makeState({ day: 15, totalDays: 101 }))).toBeNull();
  });

  it('★ 同一份提示（上一条 action 留下的）不重播', () => {
    const [, after] = winPair();
    expect(lotteryDrawCue(after, after)).toBeNull();
    expect(lotteryDrawCue(after, { ...after, turnCount: 9 } as GameState)).toBeNull();
  });

  it('★ 有人中奖：号、得主、奖金、开奖前号码表', () => {
    const [before, after] = winPair();
    expect(lotteryDrawCue(before, after)).toEqual({
      number: 6,
      winner: 0,
      prize: 5000,
      sold: before.lottery,
      owner: 0,
    });
  });

  it('★★ 没人中奖：号码照样拿得到（先前反推不出，只好「当 0 号播」—— 屏上一直是 00）', () => {
    const [before, after] = losePair();
    const cue = lotteryDrawCue(before, after)!;
    expect(cue).toMatchObject({ number: 22, winner: null, prize: 5000, owner: null });
    expect(Object.keys(cue)).not.toContain('numberUnknown');
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
  // 图 0..3 = 对话框底板（持号表**不许**取）；图 8..17 = 开号那一拍中央的大号数字 0..9
  'Data.mkf:517': Object.fromEntries([
    ...[0, 1, 2, 3].map((i) => [i, { w: 189, h: 116 }] as const),
    ...[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => [i, { w: 35, h: 43 }] as const),
  ]),
};

/** 素材自带的锚点（`graph_st` 的热点）—— 只列这几条用例会量到的那几张 */
function anchorOf(archive: string, resource: number, index: number): [number, number] {
  if (archive === 'Panel.mkf' && resource === 15) {
    if (index >= 37) return [35, 35]; // 号码球
    if (index === 23) return [120, 98]; // 黄色爆炸框
    if (index === 24) return [147, 130]; // 红色爆炸框
  }
  if (archive === 'Data.mkf' && resource === 517 && index >= 8) return [17, 21]; // 大号数字
  return [0, 0];
}

interface Drawn {
  index: number;
  archive: string;
  resource: number;
  x: number;
  y: number;
  /** 实参个数 —— 9 个的是「从子图拷一块」（擦除 / 局部贴），3 个的是整张贴 */
  argc: number;
  /** 9 个实参时的源矩形 `[sx, sy, w, h]`（此时 `x/y` 记的是**落点**）*/
  src?: [number, number, number, number];
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
      const argc = args.length;
      // 9 个实参 = `drawImage(img, sx, sy, w, h, dx, dy, w, h)`：记**落点**，源矩形另存
      const x = (argc === 9 ? args[5] : args[1]) as number;
      const y = (argc === 9 ? args[6] : args[2]) as number;
      const src = argc === 9 ? (args.slice(1, 5) as [number, number, number, number]) : undefined;
      // ★ W-68-b：`drawImage(surface, 0, 0)` 传进来的是一块**画布**（没有 index/archive）
      //   —— 记成 `surface`，于是「持久表面只贴一次」也能断言。
      if (b === null || typeof b !== 'object' || b.index === undefined) {
        images.push({ index: -1, archive: 'surface', resource: -1, x, y, argc });
        return;
      }
      images.push({
        index: b.index,
        archive: b.archive ?? '',
        resource: b.resource ?? -1,
        x,
        y,
        argc,
        ...(src === undefined ? {} : { src }),
      });
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
      anchorX: anchorOf(archive, resource, index)[0],
      anchorY: anchorOf(archive, resource, index)[1],
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
  /** `playEffect` 收到的音效号（按先后）*/
  effects: number[];
  /** `music` 收到的曲名（按先后）*/
  tracks: string[];
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
    playEffect: (id: number) => {
      env.effects.push(id);
    },
    music: (file: string) => {
      env.tracks.push(file);
    },
    logs: [] as string[],
    effects: [] as number[],
    tracks: [] as string[],
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

/** 一拍（50 ms）推一次 */
function tickOnce(env: FakeEnv): void {
  env.now += 50;
  lotteryDrawScreen.tick!(env);
}

/** 推到第 `step` 步（含），返回推了几拍 */
function tickUntilStep(env: FakeEnv, step: number): number {
  let n = 0;
  for (; n < 4000 && lotteryDrawStep() >= 0 && lotteryDrawStep() < step; n++) tickOnce(env);
  return n;
}

/** 一直播到结束，记下「每一步」与「每一步的状态值」 */
function playToEnd(env: FakeEnv): { steps: number[]; phases: number[] } {
  const steps: number[] = [];
  const phases: number[] = [];
  for (let i = 0; i < 4000; i++) {
    if (lotteryDrawStep() < 0) break;
    steps.push(lotteryDrawStep());
    phases.push(lotteryDrawPhase());
    tickOnce(env);
  }
  steps.push(lotteryDrawStep());
  phases.push(lotteryDrawPhase());
  return { steps: dedupe(steps), phases: dedupe(phases) };
}

/** 把「每一步的连续帧」压成「走过哪几步」 */
function dedupe(xs: number[]): number[] {
  return xs.filter((v, i) => i === 0 || v !== xs[i - 1]);
}

const FLICS = (): Record<number, LoadedFlic> => ({ 16: fakeFlic(42), 17: fakeFlic(37) });

describe('整屏的播放 @source 0x0043010c 的状态机（次序表见 core `lottery-ceremony.ts` 文件头）', () => {
  it('★ 察觉開獎就排好脚本，`active()` 在播期间为真', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    expect(lotteryDrawActive()).toBe(false);
    lotteryDrawScreen.event!(before, after, env);
    expect(lotteryDrawActive()).toBe(true);
    expect(lotteryDrawScreen.active(env)).toBe(true);
    expect(lotteryDrawStep()).toBe(0);
    expect(env.logs.join('')).toContain('第 7 號');
    expect(env.logs.join('')).toContain('得主 0');
  });

  it('★★ 分紅屏占着整屏时**不起算**：真正上屏那一拍才说开场白、才换 BGM（第十二份試玩回報）', () => {
    // 原版 0x0041d08f 先 `call 0x42ba97`（分紅屏，模态）、0x0041d094 才 `call 0x431712`（本屏）。
    // 本引擎两屏在同一条 action 里一起收到 `event`，分紅屏排在前面 —— 本屏这时收不到 `tick`。
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    expect(env.tracks).toEqual([]); // 还没换曲
    env.now += 3000; // 分紅屏自动收屏要 3 秒（这期间本屏一拍都收不到）
    lotteryDrawScreen.tick!(env); // 第一次轮到本屏
    expect(env.tracks).toEqual(['midi09.mid']);
    expect(lotteryDrawStep()).toBe(0); // 还在开场白 —— 先前这里已经直接跳到「現在馬上…」
    expect(lotteryDrawView(env)!.lines.join('')).toContain('開獎時間');
    expect(env.logs.some((l) => l.includes('開獎時間'))).toBe(true);
    // 开场白照样念满 2 秒才报幕
    for (let i = 0; i < 39; i++) tickOnce(env);
    expect(lotteryDrawStep()).toBe(0);
    tickOnce(env);
    tickOnce(env);
    expect(lotteryDrawStep()).toBe(1);
  });

  it('★★ 素材没到货就不上屏起算（原版开屏前同步读档）；到货那一拍才说开场白', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    // 大号数字那张资源（`Data.mkf#517`）迟到 —— 第一次开奖时就是这样
    let arrived = false;
    const base = fakeSprite();
    const asked = new Set<string>();
    (env as { sprite: DrawSprite }).sprite = ((archive, resource, index, key) => {
      asked.add(`${archive}:${resource}:${index}`);
      return archive === 'Data.mkf' && !arrived ? null : base(archive, resource, index, key);
    }) as DrawSprite;
    lotteryDrawScreen.event!(before, after, env);
    // `event` 那一刻就把要用的图都叫了一遍（分紅屏占着的时间拿来加载）
    expect(asked.has('Data.mkf:517:8')).toBe(true);
    expect(asked.has('Data.mkf:517:15')).toBe(true);
    for (let i = 0; i < 20; i++) tickOnce(env);
    expect(env.tracks).toEqual([]);
    expect(lotteryDrawView(env)!.lines).toEqual([]);
    arrived = true;
    tickOnce(env);
    expect(env.tracks).toEqual(['midi09.mid']);
    expect(lotteryDrawView(env)!.lines.join('')).toContain('開獎時間');
  });

  it('★ 素材一直不到货：等满 `CEREMONY_LOAD_WAIT_MS` 照样起播（不许把整局钉死）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, {}); // 两段 ANM 都解不出来
    lotteryDrawScreen.event!(before, after, env);
    const n = CEREMONY_LOAD_WAIT_MS / 50;
    for (let i = 0; i < n; i++) tickOnce(env);
    expect(env.tracks).toEqual([]);
    tickOnce(env);
    expect(env.tracks).toEqual(['midi09.mid']);
  });

  it('★ 中奖那一路：状态 1→2→3→3→4(开号+「得主是」)→5(揭晓)→6→8→9→10，走完自己关', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    const { steps, phases } = playToEnd(env);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1]);
    expect(phases).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, -1]);
    expect(lotteryDrawActive()).toBe(false);
    expect(lotteryDrawScreen.active(env)).toBe(false);
  });

  it('★ 空号那一路：开号后停 0.5 秒 → 7 → 8 → 9 → 10（没有 4/5/6）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    const { steps, phases } = playToEnd(env);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, -1]);
    expect(phases).toEqual([1, 2, 3, 7, 8, 9, 10, -1]);
  });

  it('★ 台词日志的先后与原版一致（空号）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    playToEnd(env);
    const said = env.logs.filter((l) => l.startsWith('樂透開獎：') && !/^樂透開獎：第 \d+ 號/.test(l));
    expect(said.map((l) => l.replace('樂透開獎：', '').slice(0, 4))).toEqual([
      '嗨！又到', // #0017
      '現在馬上', // #0018
      'SORR', // #0033
      '獎金將累', // #0034
      '希望下次', // #0035
      '行動要快', // #0036
      '演出结束',
    ]);
  });

  it('★★ 「動畫過程」关掉：开场白与报幕**两句都不说**，直接起摇球 @source 0x004301d4', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS(), false);
    lotteryDrawScreen.event!(before, after, env);
    const { phases } = playToEnd(env);
    expect(phases).toEqual([3, 4, 5, 6, 8, 9, 10, -1]);
    const log = env.logs.join('');
    expect(log).not.toContain('開獎時間');
    expect(log).not.toContain('現在馬上');
  });

  it('★ `ceremonyStepsFor` 只丢状态 1 与 2 那两句话，其余一步不动（纯函数）', () => {
    const all = lotteryCeremony({ number: 12, winner: 0, prize: 100, lottery: [], pool: 0, rigged: false });
    expect(ceremonyStepsFor(all, true)).toBe(all);
    const trimmed = ceremonyStepsFor(all, false);
    expect(trimmed.length).toBe(all.length - 2);
    expect(trimmed.map((x) => x.state)).toEqual(all.slice(2).map((x) => x.state));
  });

  it('★ 两个音效：进摇球那一步放 57，公布得主那一步放 58', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 2);
    expect(env.effects).toEqual([57]);
    tickUntilStep(env, 5);
    expect(env.effects).toEqual([57, 58]);
  });

  it('★ 摇球机先停 20 拍（手指重新竖起那一拍）才开始转；转完才开号', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 2);
    const t0 = env.now;
    tickUntilStep(env, 3);
    expect(env.now - t0).toBe(20 * 50);
    tickUntilStep(env, 4);
    // 42 帧 × 50 ms 转完才开号
    expect(env.now - t0).toBeGreaterThanOrEqual(20 * 50 + 42 * ANM_FRAME_MS);
    expect(env.now - t0).toBeLessThanOrEqual(20 * 50 + 43 * ANM_FRAME_MS);
  });

  it('★ 每推进一步都续帧（否则屏永远关不掉）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    const before2 = env.renders;
    env.now = 5000;
    lotteryDrawScreen.tick!(env);
    expect(env.renders).toBeGreaterThan(before2);
  });
});

describe('★★ 开号那一拍：两颗号码球 + 屏幕正中的大号数字（第十二份試玩回報「沒展現出本期開獎號碼」）', () => {
  /** 推到开号那一步，把这一帧画出来，返回屏上的每一张图 */
  function revealFrame(pair: [GameState, GameState]): ReturnType<typeof fakeCtx> {
    resetLotteryDrawScreenState();
    const [before, after] = pair;
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 4);
    expect(lotteryDrawStep()).toBe(4);
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.draw(env);
    return spy;
  }

  it('★★ 空号也画号码：开出 23 号 → 球 2、3，正中大号 2、3', () => {
    const spy = revealFrame(losePair());
    const balls = spy.images.filter((i) => i.resource === 15 && i.index >= 37 && i.index <= 46);
    expect(balls.map((b) => b.index)).toEqual([37 + 2, 37 + 3]);
    expect(balls.map((b) => ({ x: b.x, y: b.y }))).toEqual([
      { x: 286 - 35, y: 405 - 35 },
      { x: 358 - 35, y: 405 - 35 },
    ]);
    const big = spy.images.filter((i) => i.archive === 'Data.mkf' && i.resource === 517);
    expect(big.map((b) => b.index)).toEqual([8 + 2, 8 + 3]);
    // @source 0x00430c88 (300,220) / 0x00430cc2 (340,220)，扣图自己的锚点 (17,21)
    expect(big.map((b) => ({ x: b.x, y: b.y }))).toEqual([
      { x: 300 - 17, y: 220 - 21 },
      { x: 340 - 17, y: 220 - 21 },
    ]);
  });

  it('★★ 中奖：07 号的票（槽 6）球上就是 0、7 —— 先前把槽号当号码，画成 06', () => {
    const spy = revealFrame(winPair());
    const balls = spy.images.filter((i) => i.resource === 15 && i.index >= 37 && i.index <= 46);
    expect(balls.map((b) => b.index)).toEqual([37 + 0, 37 + 7]);
    const big = spy.images.filter((i) => i.archive === 'Data.mkf' && i.resource === 517);
    expect(big.map((b) => b.index)).toEqual([8 + 0, 8 + 7]);
    // 与铭牌上的号同一口径（持号表：`%02d` 的 n + 1）
    expect(tallyString(winPair()[0].lottery, 0)).toBe('07');
  });

  it('★ 号码里有 0 / 1 / 9 时两颗球都画得出来（10 号 / 21 号 / 09 号）', () => {
    for (const [slot, want] of [[9, [38, 37]], [20, [39, 38]], [8, [37, 46]]] as const) {
      const spy = revealFrame(drawPair(slot, 0));
      const balls = spy.images.filter((i) => i.resource === 15 && i.index >= 37 && i.index <= 46);
      expect(balls.map((b) => b.index), `槽 ${slot}`).toEqual([...want]);
    }
  });

  it('★ 摇球那两步一颗球都不画（还没开号）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() < 4; i++) {
      lotteryDrawScreen.draw(env);
      tickOnce(env);
    }
    expect(spy.images.filter((i) => i.resource === 15 && i.index >= 37 && i.index <= 46)).toEqual([]);
    expect(spy.images.filter((i) => i.archive === 'Data.mkf')).toEqual([]);
    expect(lotteryDrawView(env)!.revealed).toBe(true);
  });
});

describe('铭牌与得主', () => {
  it('★ 中奖那一路：铭牌上的号码整场都在（`state.lottery` 已被 core 清空，取的是 `cue.sold`）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    // 开奖后 core 给的那一份是**全 0**（`emptyLottery()`）—— 这就是「中奖反而四块空铭牌」的现场
    expect(after.lottery.every((v) => v === 0)).toBe(true);
    const env = makeEnv(after, FLICS());
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env);
    const seen: string[] = [];
    for (let i = 0; i < 4000 && lotteryDrawStep() >= 0; i++) {
      seen.push(tallyString(lotteryDrawView(env)!.lottery, 0));
      lotteryDrawScreen.draw(env);
      tickOnce(env);
    }
    expect(new Set(seen)).toEqual(new Set(['07']));
    // 每次重画持号表都把 0、7 两张数字牌贴上（建屏 + 每一步擦过那条带之后）
    const digits = spy.images.filter((i) => i.resource === 13).map((i) => i.index);
    expect(new Set(digits)).toEqual(new Set([0, 7]));
    expect(digits.length).toBeGreaterThanOrEqual(2 * 6);
  });

  it('★ 空号那一路不公布得主、不画得主名、不起礼花', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() >= 0; i++) {
      expect(lotteryDrawView(env)!.winner).toBeNull();
      lotteryDrawScreen.draw(env);
      tickOnce(env);
    }
    expect(spy.images.some((i) => i.resource === 15 && i.index === ENTRY.burstWin)).toBe(false);
    expect(env.effects).toEqual([57]);
  });

  it('★ 空号那一路：「SORRY」时右边捂嘴、左边苦笑脸；收尾那一步两边都还原', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 5);
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.draw(env);
    // @source 0x00430eed 图 4 @ (489,116)；0x00430f0b 图 21 @ (52,89)（不透明）
    expect(spy.images.find((i) => i.resource === 15 && i.index === ENTRY.oops)).toMatchObject({ x: 489, y: 116 });
    expect(spy.images.find((i) => i.resource === 15 && i.index === ENTRY.faceWry)).toMatchObject({ x: 52, y: 89 });
    tickUntilStep(env, 7);
    const spy2 = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy2.ctx;
    lotteryDrawScreen.draw(env);
    // @source 0x004309b0 图 1 @ (472,66)；0x004309d4 图 3 的 (45,23)+50×40 → (52,89)
    expect(spy2.images.find((i) => i.resource === 15 && i.index === ENTRY.pointing && i.argc === 3)).toMatchObject({ x: 472, y: 66 });
    expect(spy2.images.find((i) => i.resource === 15 && i.index === ENTRY.board && i.argc === 9 && i.x === 52)).toMatchObject({
      y: 89,
      src: [45, 23, 50, 40],
    });
  });
});

describe('★★ 次序：得主揭晓在「本月份的得主是．．．。」**说完之后**', () => {
  it('★★ 说那句话时屏上只有号码；说完那一步才出红爆炸框、得主名、起礼花', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 4);
    lotteryDrawScreen.draw(env);
    const v4 = lotteryDrawView(env)!;
    expect(v4.lines.join('')).toContain('本月份的得主');
    expect(v4.winner).toBeNull();
    expect(spy.images.some((i) => i.resource === 15 && i.index === ENTRY.burstWin)).toBe(false);
    expect(spy.text.some((t) => t.t === '阿土伯')).toBe(false);
    // 说完（2 秒）→ 揭晓
    tickUntilStep(env, 5);
    lotteryDrawScreen.draw(env);
    expect(lotteryDrawPhase()).toBe(5);
    expect(spy.images.some((i) => i.resource === 15 && i.index === ENTRY.burstWin)).toBe(true);
    expect(spy.text.some((t) => t.t === '阿土伯')).toBe(true);
    expect(lotteryDrawView(env)!.winner).toBe('阿土伯');
  });

  it('★ 礼花先停 30 拍才开始放，放完才说「恭喜」', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 5);
    const t0 = env.now;
    tickUntilStep(env, 6);
    expect(env.now - t0).toBeGreaterThanOrEqual(30 * 50 + 37 * ANM_FRAME_MS);
    expect(lotteryDrawView(env)!.lines.join('')).toContain('恭喜');
  });
});

describe('★★ 空号：号码亮 0.5 秒 → 「SORRY」写在屏幕正中的**黄色爆炸框**里', () => {
  it('★ 开号之后停 500 ms 才进状态 7 @source 0x00430d85 `fcn_0045285e(0x1f4)`', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 4);
    const t0 = env.now;
    tickUntilStep(env, 5);
    expect(env.now - t0).toBe(500);
    expect(lotteryDrawPhase()).toBe(7);
  });

  it('★★ 「SORRY」与「結轉」画在黄色爆炸框（图 23 @ (200,102)）里，字心 (316,198)；「希望下次」换回右上的气泡', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    for (const [step, frame, x, y] of [
      [5, 23, 200, 102],
      [6, 23, 200, 102],
      [7, 22, 300, 47],
    ] as const) {
      tickUntilStep(env, step);
      const spy = fakeCtx();
      (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
      lotteryDrawScreen.draw(env);
      const framed = spy.images.filter((i) => i.resource === 15 && (i.index === 22 || i.index === 23));
      expect(framed.map((i) => ({ index: i.index, x: i.x, y: i.y })), `步 ${step}`).toEqual([{ index: frame, x, y }]);
      const lines = lotteryDrawView(env)!.lines;
      const drawn = spy.text.filter((t) => lines.includes(t.t));
      expect(drawn.length, `步 ${step}`).toBe(lines.length);
      if (frame === 23) expect(drawn.map((t) => t.x)).toEqual(lines.map(() => 316));
      else expect(drawn.map((t) => t.x)).toEqual(lines.map(() => 383));
    }
  });

  it('★★ 字框只在说话那几秒可见；爆炸框从来不烤进表面（不会留在台上）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    const spy = fakeCtx();
    (env as { stage: CanvasRenderingContext2D }).stage = spy.ctx;
    const surface = fakeCtx();
    setCeremonySurfaceFactory(() => ({ canvas: {} as CanvasImageSource, ctx: surface.ctx }));
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawStep() >= 0; i++) {
      lotteryDrawScreen.draw(env);
      tickOnce(env);
    }
    expect(surface.images.filter((i) => i.resource === 15 && (i.index === 22 || i.index === 23))).toEqual([]);
    resetLotteryDrawScreenState();
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
//  真值：右侧主持人换姿势时台上只有**一个**她（用素材自己的像素量）
// ============================================================

/**
 * 长跑第 23 条（「右侧主持人画了两个」）与第十二份試玩回報的回归。
 *
 * 原版摇球那一拍只擦掉**竖起的手指** `擦(472,116,45,90)`（@source 0x004303fa），再把摊手那张
 * （图 2，206 宽）贴在 **(418,66)**（@source 0x00430418）—— 图 2 比图 1 左边多出 54 点的手臂，
 * 身子正好压在原来那张（图 1 @ (472,66)）上。这里**直接量素材**：按 core 脚本把两张叠好，
 * 数一数图 1 还露在外面的像素 —— 必须只剩零星的描边差（实测 76 点，图 1 不透明像素的 < 1%）。
 *
 * 先前的读法把 `fcn_00456418`（贴图）当成了擦除、把摊手那张贴在 472：身子右移 54 点、
 * 被屏幕右缘切掉一截 —— 这一条会红。
 */
describe('真值：摇球那一拍台上只有一个右主持人', () => {
  const ROOT = process.env.RICH4_WORKSPACE ?? '';
  const hasAssets = existsSync(`${ROOT}/Rich4/Panel.mkf`);
  const d = hasAssets ? describe : describe.skip;

  d('@source Panel#15 图 1 / 图 2 的不透明像素', () => {
    function decoded(index: number): { w: number; h: number; opaque: (x: number, y: number) => boolean } {
      const raw = new MkfArchive(new Uint8Array(readFileSync(`${ROOT}/Rich4/Panel.mkf`))).read(15, 'none');
      const sheet = parseSpriteSheet(raw)!;
      const im = decodeImage(sheet, raw, index, { colorKeyBlack: true });
      return {
        w: im.width,
        h: im.height,
        opaque: (x, y) => x >= 0 && y >= 0 && x < im.width && y < im.height && im.rgba[(y * im.width + x) * 4 + 3] !== 0,
      };
    }

    it('★★ 按脚本叠：图 1 @ (472,66) → 擦手指 → 图 2 @ (418,66) ⇒ 图 1 露在外面的只剩零星描边', () => {
      const [pointing, presenting] = [decoded(ENTRY.pointing), decoded(ENTRY.presenting)];
      expect([pointing.w, presenting.w]).toEqual([152, 206]);
      const steps = lotteryCeremony({ number: 3, winner: null, prize: 0, lottery: [], pool: 0, rigged: false });
      const drum = steps[2]!;
      const wipes = drum.patches.filter((p) => p.from === ENTRY.stage);
      const pose = drum.blits.find((b) => b.entry === ENTRY.presenting)!;
      expect(pose.at).toEqual([418, 66]);

      let shown = 0;
      let total = 0;
      for (let y = 0; y < pointing.h; y++) {
        for (let x = 0; x < pointing.w; x++) {
          if (!pointing.opaque(x, y)) continue;
          total++;
          const sx = 472 + x;
          const sy = 66 + y;
          if (sx >= 640 || sy >= 480) continue;
          const wiped = wipes.some(
            (p) => sx >= p.at[0] && sx < p.at[0] + p.from4[2] && sy >= p.at[1] && sy < p.at[1] + p.from4[3],
          );
          if (wiped) continue;
          if (presenting.opaque(sx - pose.at[0], sy - pose.at[1])) continue;
          shown++;
        }
      }
      expect(total).toBeGreaterThan(10_000);
      expect(shown / total).toBeLessThan(0.01);
    });
  });
});

describe('死锁保护：影片解不出来时屏也必须能关掉', () => {
  it('★ 每步最多停 90 秒 —— 摇球那一段的正常时长（20 拍 + 42 帧 × 50 ms ≈ 3.1 秒）远在它之下', () => {
    // 20 拍停顿 + 42 帧 × 50 ms
    expect(CEREMONY_STEP_MAX_MS).toBeGreaterThan(42 * ANM_FRAME_MS + 20 * 50);
    expect(CEREMONY_STEP_MAX_MS).toBeLessThanOrEqual(180_000); // 看门狗报停摆的阈值之下
  });

  it('★★ 反证：`flic()` 永远返回 null 时，演出也会自己走完（不再钉死整局）', () => {
    resetLotteryDrawScreenState();
    // ★ 关键：`flic` 恒 null —— 模拟 `uiFlicNow` 把「解不出来」缓存成 null 的那种局面
    const env = makeEnv(makeState({ players: [] }), {});
    const [before, after] = winPair();
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

describe('★ 联机旁观：跟着行动者收场（`fastForward`）', () => {
  it('★ 演到一半 ⇒ 直接关屏（原版点不掉，但行动者那台已经演完）；没在播 ⇒ false', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    tickUntilStep(env, 2);
    expect(lotteryDrawActive()).toBe(true);
    expect(lotteryDrawScreen.fastForward!(env)).toBe(true);
    expect(lotteryDrawActive()).toBe(false);
    expect(lotteryDrawScreen.active(env)).toBe(false);
    expect(env.logs).toContain('樂透開獎：跟著行動者收場');
    expect(lotteryDrawScreen.fastForward!(env)).toBe(false);
  });

  it('★ 收屏时把本台正在念的那一句停掉（需求方拍板 2026-09-23）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = winPair();
    const env = makeEnv(after, FLICS());
    let stops = 0;
    setVoiceStopper(() => {
      stops += 1;
    });
    try {
      lotteryDrawScreen.event!(before, after, env);
      tickUntilStep(env, 2);
      expect(lotteryDrawScreen.fastForward!(env)).toBe(true);
      expect(stops).toBe(1);
    } finally {
      setVoiceStopper(null);
    }
  });

  it('★ 还没上屏就收 ⇒ 不去停别人的语音（本屏一句都还没说）', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    let stops = 0;
    setVoiceStopper(() => {
      stops += 1;
    });
    try {
      lotteryDrawScreen.event!(before, after, env);
      expect(lotteryDrawScreen.fastForward!(env)).toBe(true);
      expect(stops).toBe(0);
    } finally {
      setVoiceStopper(null);
    }
  });

  it('★ 还没上屏（分紅屏还占着）也一并收', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    expect(env.tracks).toEqual([]);
    expect(lotteryDrawScreen.fastForward!(env)).toBe(true);
    lotteryDrawScreen.tick!(env);
    expect(env.tracks).toEqual([]); // 不会再上屏换曲
    expect(lotteryDrawActive()).toBe(false);
  });
});

// ============================================================
//  第十三份試玩回報：「乐透开奖的语音重复」
// ============================================================

/**
 * 跑完整场：每拍之间画 3 帧（生产里 `draw` 每帧都来），收集送进语音出口的号。
 *
 * `busy` 模拟 `main.ts` 注册的「语音还在响吗」：给出每个语音号的时长（ms），
 * 以最近一次起播为准 —— 与 `0x4544b9` 只问**唯一那一路**缓冲一样。
 */
/** `Speaking.mkf` 实测时长（ms）*/
const REAL_VOICE_MS: Record<number, number> = { 17: 3122, 18: 2511, 19: 1282, 32: 1629, 33: 2780, 34: 1725, 35: 1836, 36: 963 };

function runWithVoices(
  pair: [GameState, GameState],
  durations: Record<number, number> = REAL_VOICE_MS,
  at: number[] = [],
): number[] {
  resetLotteryDrawScreenState();
  const [before, after] = pair;
  const env = makeEnv(after, FLICS());
  const voices: number[] = [];
  let last: { code: number; at: number } | null = null;
  setVoiceSink((v) => {
    voices.push(v);
    at.push(env.now);
    last = { code: v, at: env.now };
  });
  setVoiceBusyProbe(() => {
    const l = last as { code: number; at: number } | null;
    return l !== null && env.now - l.at < (durations[l.code] ?? 0);
  });
  try {
    lotteryDrawScreen.event!(before, after, env);
    for (let i = 0; i < 4000 && lotteryDrawActive(); i++) {
      tickOnce(env);
      for (let k = 0; k < 3; k++) lotteryDrawScreen.draw(env);
    }
    expect(lotteryDrawActive()).toBe(false);
  } finally {
    setVoiceSink(null);
    setVoiceBusyProbe(null);
  }
  return voices;
}

describe('★★ 第十三份試玩回報「乐透开奖的语音重复」：每句台词的语音**只请求一次**', () => {
  it('★ 空号那一场：#0017 → #0018 → #0033 → #0034 → #0035 → #0036，各一次（先前短句在 2 秒字框里每帧重请求）', () => {
    // 次序 @source 0x0043010c（core `lottery-ceremony.ts` 文件头的表）
    expect(runWithVoices(losePair())).toEqual([17, 18, 33, 34, 35, 36]);
  });

  it('★ 兜底：语音一直没响起来（桌面版 `Speaking.mkf` 还没到货）⇒ 每句**只补一次**、在 +500 ms', () => {
    const at: number[] = [];
    const got = runWithVoices(losePair(), {}, at);
    expect(got).toEqual([17, 17, 18, 18, 33, 33, 34, 34, 35, 35, 36, 36]);
    for (let i = 0; i < got.length; i += 2) expect(at[i + 1]! - at[i]!).toBe(DRAW_VOICE_RETRY_MS);
    expect(DRAW_VOICE_RETRY_MS).toBe(500);
    expect(DRAW_VOICE_MAX_ASKS).toBe(2);
  });

  it('★ 有人中那一场：#0017 → #0018 → #0019 → #0032 →（6→8 不说话）→ #0035 → #0036，各一次', () => {
    expect(runWithVoices(winPair())).toEqual([17, 18, 19, 32, 35, 36]);
  });

  it('★ 绘制链只剥不播：`bubbleLines` 不碰语音出口', () => {
    const voices: number[] = [];
    setVoiceSink((v) => voices.push(v));
    try {
      expect(bubbleLines('#0036行動要快喔！')).toEqual(['行動要快喔！']);
      expect(voices).toEqual([]);
    } finally {
      setVoiceSink(null);
    }
  });
});

describe('★★ 字框寿命 = max(2 秒, 语音时长) @source `fcn_0044ee18` 0x0044ee4e / 0x0044ee6c', () => {
  it('★ 语音还在响（#0017 实长 3122 ms）⇒ 满 2 秒也不报幕；响完那一拍才进下一句', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    let busyUntil = -1;
    setVoiceSink(() => {
      busyUntil = env.now + 3122;
    });
    setVoiceBusyProbe(() => env.now < busyUntil);
    try {
      lotteryDrawScreen.event!(before, after, env);
      lotteryDrawScreen.tick!(env); // 上屏：说开场白
      expect(lotteryDrawStep()).toBe(0);
      while (env.now < 3100) tickOnce(env);
      expect(lotteryDrawStep()).toBe(0); // 先前固定 2 秒：这里早已跳到「現在馬上…」，把 #0017 截在半路
      expect(lotteryDrawView(env)!.lines.join('')).toContain('開獎時間');
      tickOnce(env);
      expect(lotteryDrawStep()).toBe(1);
    } finally {
      setVoiceSink(null);
      setVoiceBusyProbe(null);
    }
  });

  it('★ 没有「语音在响」（音效档关着 / 单测）⇒ 仍是 2 秒', () => {
    resetLotteryDrawScreenState();
    const [before, after] = losePair();
    const env = makeEnv(after, FLICS());
    lotteryDrawScreen.event!(before, after, env);
    lotteryDrawScreen.tick!(env);
    while (env.now < 1950) tickOnce(env);
    expect(lotteryDrawStep()).toBe(0);
    tickOnce(env);
    expect(lotteryDrawStep()).toBe(1);
  });
});
