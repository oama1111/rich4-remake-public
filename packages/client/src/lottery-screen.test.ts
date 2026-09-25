/*
 * 樂透投注屏的版面、命中与流程
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4_ui_letou.asm`（窗口过程 `fcn_0042f7fc`）抄，把最容易写错的
 * 几条钉住：
 *   号格 9×4、格距 64×48、从 (30,271) 起 —— 而**原版判据比这个多放 30/16 像素**
 *   （`x` 到 606、`y` 到 463 都算，会算到 col=9 / row=4 去读越界），本模块**不照抄**；
 *   貓女郎：**图 1 托腮 @(210,−5)**（建屏只画这一张）、**图 2 招手 @(154,−8)**
 *   只在买中之后画；
 *   气泡（图 8，237×192）在 **(360,20)**、字再右移 20；蓝板（图 9，172×28）在 (28,27)；
 *   奖池金额是 `Panel#13` 的**字形逐位贴**（从右往左、最右那位中心 x=184、y=41），
 *   本屏一次 `_rich4_draw_text` 都不调；
 *   ★ 两张貓女郎都得**抠黑**（原版走带透明的 `fcn_00456418`），底图**绝不能抠**。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Action, GameState } from '@rich4/core';
import type { LoadedFlic, Sprite } from './assets.ts';
import {
  LOT_AMOUNT,
  LOT_BG_AT,
  LOT_BLINK_FRAMES,
  LOT_BONUS_AT,
  LOT_BONUS_FRAMES,
  LOT_BONUS_MS,
  LOT_BONUS_RESOURCE,
  LOT_BUBBLE_AT,
  LOT_BUBBLE_MS,
  LOT_BUBBLE_TEXT,
  LOT_CHUNK,
  LOT_DIGIT_RESOURCE,
  LOT_EYE_AT,
  LOT_GRID,
  LOT_IMAGE,
  LOT_KITTY_AT,
  LOT_KITTY_HI_AT,
  LOT_MOUTH_AT,
  LOT_NUMBERS,
  LOT_PHASE_CODE,
  LOT_PHASE_MS,
  LOT_PLATE_AT,
  LOT_RESOURCE,
  LOT_SOLD_SHADE,
  LOT_TICK_MS,
  amountGlyphs,
  animStart,
  animStep,
  bonusFrameAt,
  currency,
  drawBonusMarquee,
  drawLotteryScreen,
  hitNumber,
  lotMessageOf,
  lotView,
  lotteryBubbleForTest,
  lotteryPending,
  LOTTERY_BUY_SOUND,
  lotteryPhase,
  lotteryPicked,
  lotteryScreen,
  numberCenter,
  numberRect,
  resetLotteryScreenState,
  soldNumbers,
  soldShadeRect,
  stripVoice,
  type LotSprite,
  type LotView,
} from './lottery-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';
import { LOTTERY } from '@rich4/data';
import { CAPTION_MIN_MS, setVoiceBusyProbe, setVoiceSink, setVoiceStopper } from './voice-sink.ts';

// ============================================================
//  用到的图 @source `disasm.py xref 0x48c35c`
// ============================================================

describe('用到的图 @source rich4_ui_letou.asm', () => {
  it('★ 底图是 Panel.mkf 资源 12；金额字形 13；跑馬燈 14', () => {
    expect(LOT_RESOURCE).toBe(12);
    expect(LOT_DIGIT_RESOURCE).toBe(13);
    expect(LOT_BONUS_RESOURCE).toBe(14);
  });

  it('★ 图号 ↔ 尺寸/锚点（拿 `parseSpriteSheet` 的记录核过）', () => {
    expect(LOT_CHUNK).toEqual({
      bg: 0,
      kitty: 1,
      kittyHi: 2,
      eyeOpen: 3,
      eyeShut: 4,
      mouthSmile: 5,
      mouthPurse: 6,
      chalk: 7,
      bubble: 8,
      plate: 9,
    });
    expect(LOT_IMAGE[0]).toMatchObject({ w: 640, h: 480 });
    expect(LOT_IMAGE[1]).toMatchObject({ w: 358, h: 298 });
    expect(LOT_IMAGE[2]).toMatchObject({ w: 414, h: 302 });
    expect(LOT_IMAGE[3]).toMatchObject({ w: 70, h: 42 });
    expect(LOT_IMAGE[4]).toMatchObject({ w: 70, h: 42 });
    expect(LOT_IMAGE[5]).toMatchObject({ w: 70, h: 18 });
    expect(LOT_IMAGE[6]).toMatchObject({ w: 70, h: 18 });
    // 粉笔弧是唯一带非零锚点的（锚点居中，所以画在格子正中）
    expect(LOT_IMAGE[7]).toMatchObject({ w: 58, h: 47, ax: 28, ay: 25 });
    expect(LOT_IMAGE[8]).toMatchObject({ w: 237, h: 192 });
    expect(LOT_IMAGE[9]).toMatchObject({ w: 172, h: 28 });
  });

  it('★ 眨眼帧表就是 0x475660 那三个字节 {3,4,3}', () => {
    expect(LOT_BLINK_FRAMES).toEqual([3, 4, 3]);
  });

  it('★ 抠黑的只有 1/2/7/8（原版走 fcn_00456418）—— 底图绝不能抠', () => {
    expect(LOT_IMAGE[0]!.key).toBe(false); // 底图 8.9% 黑是画里的黑
    expect(LOT_IMAGE[1]!.key).toBe(true); // 貓女郎 · 托腮 49.1% 黑
    expect(LOT_IMAGE[2]!.key).toBe(true); // 貓女郎 · 招手 55.2%
    expect(LOT_IMAGE[3]!.key).toBe(false); // 眼睛 0% 黑（原版不透明贴）
    expect(LOT_IMAGE[4]!.key).toBe(false);
    expect(LOT_IMAGE[5]!.key).toBe(false); // 嘴 0%
    expect(LOT_IMAGE[6]!.key).toBe(false);
    expect(LOT_IMAGE[7]!.key).toBe(true); // 粉笔 75.5%
    expect(LOT_IMAGE[8]!.key).toBe(true); // 气泡 32.0%
    expect(LOT_IMAGE[9]!.key).toBe(false); // 蓝板 0%（整块纯蓝，原版不透明贴）
  });
});

// ============================================================
//  版面
// ============================================================

describe('版面 @source 0x42f32c / 0x42f417 / 0x42f974 / 0x42f3fe', () => {
  it('★ 底图在 (0,0)', () => {
    expect(LOT_BG_AT).toEqual({ x: 0, y: 0 });
  });

  it('★ 貓女郎：图 1 托腮 @(210,−5)（建屏只画这张）、图 2 招手 @(154,−8)', () => {
    expect(LOT_KITTY_AT).toEqual({ x: 0xd2, y: -5 });
    expect(LOT_KITTY_AT).toEqual({ x: 210, y: -5 });
    expect(LOT_KITTY_HI_AT).toEqual({ x: 0x9a, y: -8 });
    expect(LOT_KITTY_HI_AT).toEqual({ x: 154, y: -8 });
  });

  it('★ 眼睛 (273,63)、嘴 (273,105) —— 与「图 1 在 (210,−5)」互相印证', () => {
    expect(LOT_EYE_AT).toEqual({ x: 273, y: 63 });
    expect(LOT_MOUTH_AT).toEqual({ x: 273, y: 105 });
    // 原版从图 1 上把这两块拷回来的源偏移 = 屏幕偏移 − 图 1 的落点
    expect({ sx: LOT_EYE_AT.x - LOT_KITTY_AT.x, sy: LOT_EYE_AT.y - LOT_KITTY_AT.y }).toEqual({
      sx: 63,
      sy: 68,
    });
    expect({ sx: LOT_MOUTH_AT.x - LOT_KITTY_AT.x, sy: LOT_MOUTH_AT.y - LOT_KITTY_AT.y }).toEqual({
      sx: 63,
      sy: 110,
    });
  });

  it('★ 蓝色底板 (28,27)、跑馬燈 (8,8)、气泡 (360,20)', () => {
    expect(LOT_PLATE_AT).toEqual({ x: 0x1c, y: 0x1b });
    expect(LOT_PLATE_AT).toEqual({ x: 28, y: 27 });
    expect(LOT_BONUS_AT).toEqual({ x: 8, y: 8 });
    expect(LOT_BUBBLE_AT).toEqual({ x: 0x168, y: 0x14 });
    expect(LOT_BUBBLE_AT).toEqual({ x: 360, y: 20 });
  });

  it('★ 气泡活 2 秒；字居中在气泡正中、再右移 20（`push 0x14`）', () => {
    expect(LOT_BUBBLE_MS).toBe(2000);
    expect(LOT_BUBBLE_TEXT).toEqual({ dx: 20, dy: 0, size: 0x14 });
    const cx = LOT_BUBBLE_AT.x + 237 / 2 + LOT_BUBBLE_TEXT.dx;
    const cy = LOT_BUBBLE_AT.y + Math.trunc(192 / 2) + LOT_BUBBLE_TEXT.dy;
    expect({ cx, cy }).toEqual({ cx: 498.5, cy: 116 });
  });

  it('★ 底板恰好盖住跑馬燈的镂空：x 28..199 / y 27..54', () => {
    expect(LOT_PLATE_AT.x + 172).toBe(200);
    expect(LOT_PLATE_AT.y + 28).toBe(55);
  });
});

// ============================================================
//  奖池金额（Panel#13 字形）
// ============================================================

describe('奖池金额 @source loc_0042fdfe', () => {
  it('★ 最右那位中心 x=184、y=41、步距 18；逗号 12 + 先右移 6', () => {
    expect(LOT_AMOUNT).toEqual({
      firstX: 0xb8,
      y: 0x29,
      step: 0x12,
      commaStep: 0x0c,
      commaShift: 6,
      commaIndex: 0x0a,
      otherIndex: 0x0b,
    });
  });

  it('★ 千分位由 `_rich4_num_to_currency_string` 出（带 $ 与逗号）', () => {
    expect(currency(0)).toBe('$0');
    expect(currency(1032)).toBe('$1,032');
    expect(currency(1234567)).toBe('$1,234,567');
  });

  it('★ 从右往左摆：`$1,000` = 三个 0 + 逗号 + 1 + $', () => {
    expect(amountGlyphs('$1,000')).toEqual([
      { index: 0, x: 184, y: 41 },
      { index: 0, x: 166, y: 41 },
      { index: 0, x: 148, y: 41 },
      { index: 0x0a, x: 136, y: 41 },
      { index: 1, x: 124, y: 41 },
      { index: 0x0b, x: 106, y: 41 },
    ]);
  });

  it('★ 逗号比数字少占 6 像素：`$1,000` 与 `$1000` 的 $ 位置差 6', () => {
    const withComma = amountGlyphs('$1,000').find((x) => x.index === 0x0b)!;
    const without = amountGlyphs('$1000').find((x) => x.index === 0x0b)!;
    expect(without.x - withComma.x).toBe(6);
  });

  it('★ 空串给空数组；数字以外、逗号以外的字符都落到 $ 那一格（图号 11）', () => {
    expect(amountGlyphs('')).toEqual([]);
    expect(amountGlyphs('$').map((g) => g.index)).toEqual([0x0b]);
    expect(amountGlyphs('-%').map((g) => g.index)).toEqual([0x0b, 0x0b]);
  });
});

// ============================================================
//  号格
// ============================================================

describe('号格 9×4 @source VA 0x0042feae', () => {
  it('★ 36 格、格 64×48、除算基准 (30,271)', () => {
    expect(LOT_NUMBERS).toBe(36);
    expect(LOT_GRID).toEqual({
      baseX: 30,
      baseY: 271,
      rawEndX: 606,
      rawEndY: 463,
      w: 64,
      h: 48,
      cols: 9,
      rows: 4,
    });
  });

  it('★ 首格 01 在 (30,271)，第 9 格 09 在 (542,271)，第 10 格 10 在 (30,319)', () => {
    expect(numberRect(0)).toMatchObject({ x: 30, y: 271 });
    expect(numberRect(8)).toMatchObject({ x: 30 + 8 * 64, y: 271 });
    expect(numberRect(9)).toMatchObject({ x: 30, y: 271 + 48 });
    expect(numberRect(35)).toMatchObject({ x: 30 + 8 * 64, y: 271 + 3 * 48 });
  });

  it('★ 越界的号码不认', () => {
    expect(numberRect(-1)).toBeNull();
    expect(numberRect(36)).toBeNull();
    expect(numberRect(NaN)).toBeNull();
    expect(numberCenter(36)).toBeNull();
  });

  it('★ 粉笔弧画在格子正中（锚点 28/25 会把它对到中心）', () => {
    expect(numberCenter(0)).toEqual({ x: 62, y: 295 });
    expect(numberCenter(35)).toEqual({ x: 574, y: 439 });
  });

  it('★ 每格的左上角与正中都命中自己', () => {
    for (let n = 0; n < LOT_NUMBERS; n++) {
      const r = numberRect(n)!;
      expect(hitNumber(r.x, r.y)).toBe(n);
      expect(hitNumber(r.x + r.w / 2, r.y + r.h / 2)).toBe(n);
      expect(hitNumber(r.x + r.w - 1, r.y + r.h - 1)).toBe(n);
    }
  });

  it('★ 四角：左上 (30,271) 认 0，右下那一格末像素 (605,462) 认 35', () => {
    expect(hitNumber(30, 271)).toBe(0);
    expect(hitNumber(605, 462)).toBe(35);
    expect(hitNumber(29, 271)).toBeNull();
    expect(hitNumber(30, 270)).toBeNull();
  });

  it('★ 原版多放的那两条边**不认**：col=9 / row=4 是越界读', () => {
    expect(hitNumber(605, 271)).toBe(8);
    expect(hitNumber(606, 271)).toBeNull();
    expect(hitNumber(606, 462)).toBeNull();
    expect(hitNumber(30, 462)).toBe(27);
    expect(hitNumber(30, 463)).toBeNull();
    expect(hitNumber(605, 463)).toBeNull();
  });

  it('★ 格与格之间没有缝：前格的右邻像素就是后一格', () => {
    expect(hitNumber(93, 271)).toBe(0);
    expect(hitNumber(94, 271)).toBe(1);
    expect(hitNumber(30, 318)).toBe(0);
    expect(hitNumber(30, 319)).toBe(9);
  });
});

// ============================================================
//  流程
// ============================================================

describe('流程 @source 状态机 [0x48c370] + 串表 0x4755f8', () => {
  it('★ 六个状态各有台词，且台词就是 LOTTERY 那几条', () => {
    expect(lotMessageOf('hello')).toContain('一券在手');
    expect(lotMessageOf('price')).toContain('只要一千元');
    expect(lotMessageOf('pick')).toContain('幸運號碼');
    expect(lotMessageOf('bye')).toContain('拜拜');
    expect(lotMessageOf('noCash')).toContain('現金不足');
    expect(lotMessageOf('closing')).toContain('下次再來');
  });

  it('★ 状态的数值编码与 [0x48c370] 对齐', () => {
    expect(LOT_PHASE_CODE).toEqual({ hello: 1, price: 2, pick: 3, bye: 4, noCash: 4, closing: 5 });
  });

  it('★ #NNNN 语音号被吃掉（原版 `_rich4_draw_text` 开头那一段）', () => {
    expect(stripVoice('#0011哈囉！')).toBe('哈囉！');
    expect(stripVoice('哈囉！')).toBe('哈囉！');
    expect(stripVoice(lotMessageOf('hello')!)).not.toContain('#');
  });

  it('★ 一拍 100 ms（SetTimer(hwnd, 0x64, …)），一段气泡 2 秒', () => {
    expect(LOT_TICK_MS).toBe(100);
    expect(LOT_PHASE_MS).toBe(LOT_BUBBLE_MS);
  });
});

describe('眨眼 / 嘴 / 跑馬燈 @source loc_0042fa9e / loc_0042fc24', () => {
  it('★ 眨眼：帧表走 3→4→3，第 4 步不画（原版那一步是把眼睛从图 1 拷回来）', () => {
    const a = animStart(0);
    const always = (): number => 0; // 过 `rand()>>10 == 0` 那道闸
    const never = (): number => 0.5; // 过不了任何闸
    expect(animStep(a, 100, always).eye).toBe(LOT_CHUNK.eyeOpen);
    expect(animStep(a, 200, never).eye).toBe(LOT_CHUNK.eyeShut);
    expect(animStep(a, 300, never).eye).toBe(LOT_CHUNK.eyeOpen);
    expect(animStep(a, 400, never).eye).toBeNull();
    expect(a.ctl).toBe(0);
  });

  it('★ 眨眼那道闸是 `rand() >> 10 == 0`（≈5×10⁻⁷）—— 基本一辈子不眨', () => {
    const a = animStart(0);
    const never = (): number => 0.5;
    for (let t = 100; t <= 3000; t += 100) expect(animStep(a, t, never).eye).toBeNull();
    expect(a.ctl).toBe(0);
  });

  it('★ 不到 100 ms 不动（定时器就是 100 ms）', () => {
    const a = animStart(0);
    expect(animStep(a, 99, () => 0)).toEqual({ eye: null, mouth: null });
    expect(a.ctl).toBe(0);
  });

  it('★ 嘴：过闸后按 `rand()&1` 选 5/6，持续 `rand()&7`（0 取 1）拍', () => {
    const a = animStart(0);
    let n = 0;
    // 调用序：① 眨眼闸 ② 嘴闸 ③ 选嘴 ④ 持续多少拍
    const seq = [0, 0, 0.9, 0.3];
    const rnd = (): number => seq[n++] ?? 0;
    expect(animStep(a, 100, rnd).mouth).toBe(LOT_CHUNK.mouthPurse); // floor(0.9*2)&1 = 1
    expect(a.mouthHold).toBe(2); // floor(0.3*8)&7 = 2
    // 下一拍只是递减，不再换
    expect(animStep(a, 200, () => 0.9).mouth).toBeNull();
    expect(a.mouthHold).toBe(1);
  });

  it('★ 嘴那道闸是 `rand() >> 11 < 4`（≈4×10⁻⁶）—— 也是基本不发生', () => {
    const a = animStart(0);
    const never = (): number => 0.5;
    for (let t = 100; t <= 3000; t += 100) expect(animStep(a, t, never).mouth).toBeNull();
    expect(a.mouthHold).toBe(0);
  });

  it('★ 跑馬燈：5 帧、每 71 ms 一帧、循环', () => {
    expect(LOT_BONUS_FRAMES).toBe(5);
    expect(LOT_BONUS_MS).toBe(71);
    expect(bonusFrameAt(0)).toBe(0);
    expect(bonusFrameAt(70)).toBe(0);
    expect(bonusFrameAt(71)).toBe(1);
    expect(bonusFrameAt(71 * 5)).toBe(0);
    expect(bonusFrameAt(71 * 7)).toBe(2);
  });
});

// ============================================================
//  视图
// ============================================================

/** 只填这一屏用得到的字段 */
function mkState(over: { pending?: unknown; cash?: number; pool?: number } = {}): GameState {
  return {
    pending: over.pending ?? null,
    pool: over.pool ?? 3000,
    currentPlayer: 0,
    players: [{ index: 0, cash: over.cash ?? 5000 }],
  } as unknown as GameState;
}

function mkPending(available: number[] = [0, 1, 2], owned = 0, price = 1000): unknown {
  return { kind: 'lottery', available, price, owned };
}

describe('视图 lotView', () => {
  it('★ 不是樂透的待决交互 → null', () => {
    expect(lotView(mkState(), 'pick', null, null, null, 0)).toBeNull();
    expect(lotView(mkState({ pending: { kind: 'bank' } }), 'pick', null, null, null, 0)).toBeNull();
  });

  it('★ 奖池取 state.pool、票价取 pending.price、可用号码照抄', () => {
    const v = lotView(mkState({ pending: mkPending([3, 5]) }), 'pick', null, null, null, 0)!;
    expect(v.pool).toBe(3000);
    expect(v.price).toBe(1000);
    expect(v.available).toEqual([3, 5]);
    expect(v.owned).toBe(0);
    expect(v.message).toContain('幸運號碼');
  });

  it('★ 圈中的号与两个贴片照传进来的走', () => {
    const v = lotView(mkState({ pending: mkPending() }), 'pick', 12, LOT_CHUNK.eyeShut, null, 3)!;
    expect(v.picked).toBe(12);
    expect(v.eye).toBe(LOT_CHUNK.eyeShut);
    expect(v.mouth).toBeNull();
    expect(v.bonusFrame).toBe(3);
  });

  it('★ 现金不足那一段说 #0015', () => {
    const v = lotView(mkState({ pending: mkPending() }), 'noCash', null, null, null, 0)!;
    expect(v.message).toContain('現金不足');
  });

  it('★ lotteryPending 只在 kind 是 lottery 时给东西', () => {
    expect(lotteryPending(mkState({ pending: mkPending() }))).toMatchObject({ kind: 'lottery' });
    expect(lotteryPending(mkState())).toBeNull();
    expect(lotteryPending(mkState({ pending: { kind: 'bank' } }))).toBeNull();
  });
});

// ============================================================
//  整屏出口
// ============================================================

/** 收集 dispatch / requestRender 的最小环境 */
function mkEnv(
  state: GameState,
  now: number,
  animation?: boolean,
  localSeat?: number | null,
): {
  env: UiScreenEnv;
  actions: Action[];
  effects: number[];
  renders: () => number;
  flics: { archive: string; resource: number }[];
} {
  const actions: Action[] = [];
  const effects: number[] = [];
  const flics: { archive: string; resource: number }[] = [];
  let renders = 0;
  const env = {
    screen: 'game',
    state,
    now,
    // `animation` 省略 = 按 true 算（契约里就是 optional）
    ...(animation === undefined ? {} : { animation }),
    ...(localSeat === undefined ? {} : { localSeat }),
    dispatch: (a: Action) => actions.push(a),
    playEffect: (id: number) => effects.push(id),
    requestRender: () => {
      renders++;
    },
    // ★ W-68-c：開屏那一下要预取 `Panel#16/#17` —— 这里只记「问过哪一段」
    flic: (archive: string, resource: number) => {
      flics.push({ archive, resource });
      return null;
    },
  } as unknown as UiScreenEnv;
  return { env, actions, effects, renders: () => renders, flics };
}

/** 让这一屏一路演到「可以点号」那一段，返回当时的时刻 */
function advanceToPick(s: GameState, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < 4 && lotteryPhase() !== 'pick'; i++) {
    lotteryScreen.tick!(mkEnv(s, t).env);
    t += LOT_PHASE_MS;
  }
  return t;
}

describe('整屏出口 @source 窗口过程 0x0042f7fc', () => {
  it('★ 只有 pending.kind === lottery 才接管整屏', () => {
    resetLotteryScreenState();
    expect(lotteryScreen.active(mkEnv(mkState({ pending: mkPending() }), 0).env)).toBe(true);
    expect(lotteryScreen.active(mkEnv(mkState(), 0).env)).toBe(false);
    expect(lotteryScreen.active(mkEnv(mkState({ pending: { kind: 'bank' } }), 0).env)).toBe(false);
  });

  it('★★ 開屏那一下预取開獎屏的两段 ANM（`Panel#16` 摇球 / `#17` 礼花）—— 只问一次', () => {
    // ★ W-68-c：进開獎屏那一下要在主线程一次解完两段 ⇒ 首席实测 ≈ 1001 ms 的长帧。
    //   在**投注屏開屏**这一下就各问一次（值丢掉，只为解进缓存）。
    resetLotteryScreenState();
    const before = mkState();
    const after = mkState({ pending: mkPending() });
    const { env, flics } = mkEnv(after, 0);
    lotteryScreen.event!(before, after, env);
    expect(flics).toEqual([
      { archive: 'Panel.mkf', resource: 0x10 },
      { archive: 'Panel.mkf', resource: 0x11 },
    ]);
    // 同一屏里再来一条 action（选号 / 别人的行动）不再重复预取
    lotteryScreen.event!(after, after, env);
    expect(flics).toHaveLength(2);
  });

  it('★ 时间轴：哈囉 → 报价 → 可点（每段 2 秒）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending() });
    expect(lotteryPhase()).toBe('hello');

    lotteryScreen.tick!(mkEnv(s, 0).env);
    expect(lotteryPhase()).toBe('hello');

    lotteryScreen.tick!(mkEnv(s, 2000).env);
    expect(lotteryPhase()).toBe('price');
    lotteryScreen.tick!(mkEnv(s, 4000).env);
    expect(lotteryPhase()).toBe('pick');
    lotteryScreen.tick!(mkEnv(s, 6000).env);
    expect(lotteryPhase()).toBe('pick');
  });

  it('★ 「動畫過程」关掉 → 开屏直接是**可点号**那一段（跳过 hello/price）', () => {
    // @source `loc_0042f8f6`（VA 0x0042f8f6）：`cmp byte [0x497159],0 / je 0x42f905`
    //   → `mov byte [0x48c370], 3`（3 = pick，见 `LOT_PHASE_CODE`）。
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([7, 8, 9]) });
    lotteryScreen.tick!(mkEnv(s, 0, false).env);
    expect(lotteryPhase()).toBe('pick');
    // 也可以当场买
    const { env, actions } = mkEnv(s, 10, false);
    const cell = numberRect(7)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env);
    expect(actions).toEqual([{ type: 'lottery', number: 7 }]);
  });

  it('★ 「動畫過程」默认（省略）仍然是 hello 起（旧测试替身不受影响）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending() });
    lotteryScreen.tick!(mkEnv(s, 0).env);
    expect(lotteryPhase()).toBe('hello');
  });

  it('★ 可点之前先点一下（点在格外面）只是把这段跳过：清气泡 + 置 3', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending() });
    lotteryScreen.tick!(mkEnv(s, 0).env);
    lotteryScreen.down!(100, 100, mkEnv(s, 10).env);
    expect(lotteryPhase()).toBe('pick');
  });

  it('★ 开场白还没说完就点中号格 —— **同一下就能买**（原版 0x42fe8c 直落 0x42feae）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([7, 8, 9]) });
    lotteryScreen.tick!(mkEnv(s, 0).env); // 还在 hello
    expect(lotteryPhase()).toBe('hello');

    const { env, actions } = mkEnv(s, 100);
    const cell = numberRect(7)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env);
    expect(actions).toEqual([{ type: 'lottery', number: 7 }]);
    expect(lotteryPhase()).toBe('bye');
  });

  it('★ 买号在**按下**那一下；抬手什么都不做（0x202 这一屏没有分支）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([4, 5, 6]) });
    const t = advanceToPick(s);
    const cell = numberRect(4)!;
    const { env } = mkEnv(s, t);
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env);
    expect(lotteryPicked()).toBe(4);
    // 抬手不改任何东西
    lotteryScreen.up!(cell.x + 1, cell.y + 1, env);
    expect(lotteryPicked()).toBe(4);
    expect(lotteryPhase()).toBe('bye');
  });

  it('★ 点中未售出的号 → 派发 { type: "lottery" } 并换图 2', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([4, 5, 6]) });
    const t = advanceToPick(s);
    expect(lotteryPhase()).toBe('pick');

    const { env, actions } = mkEnv(s, t);
    const cell = numberRect(4)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env); // 第 5 格 = 号码 4（未售出）
    expect(actions).toEqual([{ type: 'lottery', number: 4 }]);
    expect(lotteryPicked()).toBe(4);
    expect(lotteryPhase()).toBe('bye');
  });

  it('★ 已售出的号点不动（原版 `cmp byte [号码表+idx], 0 / jne`）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([0, 2]) }); // 1 号已售出
    const t = advanceToPick(s);

    const { env, actions } = mkEnv(s, t);
    const cell = numberRect(1)!;
    lotteryScreen.down!(cell.x, cell.y, env);
    expect(actions).toEqual([]);
    expect(lotteryPicked()).toBeNull();
    expect(lotteryPhase()).toBe('pick');
  });

  it('★ 格子外面点不动', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([0, 1, 2]) });
    const t = advanceToPick(s);
    const { env, actions } = mkEnv(s, t);
    lotteryScreen.down!(5, 5, env);
    lotteryScreen.down!(30, 270, env);
    expect(actions).toEqual([]);
  });

  it('★ 现金不足：说 #0015 → #0016 → 自己关屏', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending(), cash: 999 });
    expect(lotteryScreen.active(mkEnv(s, 0).env)).toBe(true);
    lotteryScreen.tick!(mkEnv(s, 0).env);
    expect(lotteryPhase()).toBe('noCash');
    lotteryScreen.tick!(mkEnv(s, 2000).env);
    expect(lotteryPhase()).toBe('closing');
    const last = mkEnv(s, 4000);
    lotteryScreen.tick!(last.env);
    expect(lotteryScreen.active(mkEnv(s, 4000).env)).toBe(false);
    // ★ 审计（LOT-09）：关屏那一拍交「不买」（core 现在也给現金不足的真人挂 pending）
    expect(last.actions).toEqual([{ type: 'declineDecision' }]);
  });

  it('★ 现金刚好 1000 可以买（原版是 `jge 0x3e8`）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending(), cash: 1000 });
    lotteryScreen.tick!(mkEnv(s, 0).env);
    expect(lotteryPhase()).toBe('hello');
  });

  it('★ 买中之后 `pending` 被收走 —— 但「拜拜」那一拍还要画完（原版等到下一拍才关屏）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([4, 5, 6]) });
    const t = advanceToPick(s);
    const cell = numberRect(4)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, mkEnv(s, t).env);
    expect(lotteryPhase()).toBe('bye');

    // reducer 收了 pending 之后的那一份状态
    const bought = mkState();
    expect(lotteryScreen.active(mkEnv(bought, t).env)).toBe(true);
    // ★★ 第二十六份 panel #2：「拜拜」那一句要挂满 `0x44ee18` 的 2000 ms（0x0042fa16 状态 5 + 0x44ecb6，
    //   关屏 0x0042faf8 要等 0x0042fa5d 判它到期）—— 不是「下一拍 100 ms」
    lotteryScreen.tick!(mkEnv(bought, t + LOT_TICK_MS).env);
    expect(lotteryScreen.active(mkEnv(bought, t + LOT_TICK_MS).env)).toBe(true);
    expect(lotteryBubbleForTest(mkEnv(bought, t + LOT_TICK_MS).env)).toBe(LOTTERY.counterBye.text);
    lotteryScreen.tick!(mkEnv(bought, t + CAPTION_MIN_MS - 1).env);
    expect(lotteryScreen.active(mkEnv(bought, t + CAPTION_MIN_MS - 1).env)).toBe(true);
    lotteryScreen.tick!(mkEnv(bought, t + CAPTION_MIN_MS).env);
    expect(lotteryScreen.active(mkEnv(bought, t + CAPTION_MIN_MS).env)).toBe(false);
  });

  it('★★ 第二十六份 panel #2：音效开着、语音还在响 ⇒ 气泡撑到语音放完（`0x0044ee6c call 0x4544b9`）；各句只放一次语音', () => {
    resetLotteryScreenState();
    const played: number[] = [];
    let busy = true;
    setVoiceSink((v) => played.push(v));
    setVoiceBusyProbe(() => busy);
    try {
      const s = mkState({ pending: mkPending([4, 5, 6]) });
      lotteryScreen.tick!(mkEnv(s, 0).env); // 开屏：#0011
      for (let t = 0; t <= 3000; t += 100) lotteryScreen.tick!(mkEnv(s, t).env);
      expect(lotteryPhase(), '语音还在响：满 2000 ms 也不换句').toBe('hello');
      // 每帧都画，也只放一次（先前每帧 `stripVoice` 会在一句念完后重放）
      const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 1 }) : () => undefined), set: () => true });
      const v = lotView(s, 'hello', null, null, null, 0)!;
      expect(v.message).toBe(LOTTERY.counterHello.text);
      for (let i = 0; i < 5; i++) drawLotteryScreen(ctx as CanvasRenderingContext2D, () => null, () => null, v, 3000);
      expect(played).toEqual([11]);
      busy = false;
      lotteryScreen.tick!(mkEnv(s, 3100).env);
      expect(lotteryPhase()).toBe('price');
      expect(played).toEqual([11, 12]);
    } finally {
      setVoiceSink(null);
      setVoiceBusyProbe(null);
    }
  });

  it('★★ 第二十六份 panel #2：「請圈選」那一句到期也擦掉（状态 3 的跳表项 0x0042fa9e 空做，气泡由 0x44ee18 擦）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([4, 5, 6]) });
    lotteryScreen.tick!(mkEnv(s, 0).env);
    lotteryScreen.tick!(mkEnv(s, CAPTION_MIN_MS).env);
    lotteryScreen.tick!(mkEnv(s, CAPTION_MIN_MS * 2).env);
    expect(lotteryPhase()).toBe('pick');
    expect(lotteryBubbleForTest(mkEnv(s, CAPTION_MIN_MS * 2).env)).toBe(LOTTERY.counterPick.text);
    lotteryScreen.tick!(mkEnv(s, CAPTION_MIN_MS * 3).env);
    expect(lotteryPhase()).toBe('pick');
    expect(lotteryBubbleForTest(mkEnv(s, CAPTION_MIN_MS * 3).env)).toBeNull();
  });

  it('★★ 第二十六份 panel #2：开场白里点一下 ⇒ 收掉那一句并停语音，直接到 pick、**不**再挂「請圈選」（0x0042fe9d）', () => {
    resetLotteryScreenState();
    let stopped = 0;
    setVoiceStopper(() => stopped++);
    try {
      const s = mkState({ pending: mkPending([4, 5, 6]) });
      lotteryScreen.tick!(mkEnv(s, 0).env);
      expect(lotteryPhase()).toBe('hello');
      lotteryScreen.down!(0, 0, mkEnv(s, 300).env);
      expect(stopped).toBe(1);
      expect(lotteryPhase()).toBe('pick');
      expect(lotteryBubbleForTest(mkEnv(s, 300).env)).toBeNull();
    } finally {
      setVoiceStopper(null);
    }
  });

  it('★★ 第二十六份 panel #2：右键不买 ⇒ 挂「下次再來吧！」（0x406 wParam 5 → 0x4755f8[5]），同样挂满才关', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([4, 5, 6]) });
    const t = advanceToPick(s);
    lotteryScreen.contextmenu!(0, 0, mkEnv(s, t).env);
    const gone = mkState();
    expect(lotteryBubbleForTest(mkEnv(gone, t).env)).toBe(LOTTERY.counterComeAgain.text);
    lotteryScreen.tick!(mkEnv(gone, t + CAPTION_MIN_MS - 1).env);
    expect(lotteryScreen.active(mkEnv(gone, t + CAPTION_MIN_MS - 1).env)).toBe(true);
    lotteryScreen.tick!(mkEnv(gone, t + CAPTION_MIN_MS).env);
    expect(lotteryScreen.active(mkEnv(gone, t + CAPTION_MIN_MS).env)).toBe(false);
  });

  it('★ 买中那一下 `event` 收到 `pending=null` **不能**把相位打回 hello（否则拜拜那一拍就没了）', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([4, 5, 6]) });
    const t = advanceToPick(s);
    const cell = numberRect(4)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, mkEnv(s, t).env);
    expect(lotteryPhase()).toBe('bye');

    const bought = mkState();
    lotteryScreen.event!(s, bought, mkEnv(bought, t).env);
    expect(lotteryPhase()).toBe('bye');
    expect(lotteryScreen.active(mkEnv(bought, t).env)).toBe(true);
  });

  it('★ 没买过的屏不会因为 `bye` 相位赖着不走', () => {
    resetLotteryScreenState();
    expect(lotteryScreen.active(mkEnv(mkState(), 5000).env)).toBe(false);
  });

  it('★ 换一份新的 pending 就从头演（`event` 里察觉）', () => {
    resetLotteryScreenState();
    const s1 = mkState({ pending: mkPending() });
    lotteryScreen.tick!(mkEnv(s1, 0).env);
    lotteryScreen.tick!(mkEnv(s1, 2000).env);
    expect(lotteryPhase()).toBe('price');

    const s2 = mkState({ pending: mkPending([5, 6]) });
    lotteryScreen.event!(s1, s2, mkEnv(s2, 3000).env);
    expect(lotteryPhase()).toBe('hello');
  });

  it('★ 抬手什么都不做（买号在 WM_LBUTTONDOWN）', () => {
    resetLotteryScreenState();
    expect(lotteryScreen.up).toBeTypeOf('function');
    expect(() => lotteryScreen.up!(0, 0, mkEnv(mkState(), 0).env)).not.toThrow();
  });
});

// ============================================================
//  绘制（假 ctx，只查「哪张图落在哪」）
// ============================================================

describe('drawLotteryScreen（假 ctx，只查落点与文字）', () => {
  function fakeCtx() {
    const images: { index: number; resource: number; x: number; y: number; flic: boolean }[] = [];
    const textAt: { t: string; x: number; y: number }[] = [];
    const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    /** 画的先后（图号 / `rect`）—— 查压暗块夹在哪两张图之间 */
    const ops: string[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
      save: () => undefined,
      restore: () => undefined,
      strokeText: () => undefined,
      strokeRect: () => undefined,
      drawImage: (b: { index: number; resource: number; flic?: boolean }, dx: number, dy: number) => {
        images.push({ index: b.index, resource: b.resource, x: dx, y: dy, flic: b.flic === true });
        ops.push(`${b.flic === true ? 'flic' : b.resource}:${b.index}`);
      },
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push({ x, y, w, h, fill: String((this as { fillStyle: string }).fillStyle) });
        ops.push('rect');
      },
      fillText: (t: string, x: number, y: number) => {
        textAt.push({ t, x, y });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, images, textAt, rects, ops };
  }

  /** 跑馬燈的假影片：5 帧，每帧带自己的帧号 */
  function fakeBonusFlic(frames = LOT_BONUS_FRAMES): LoadedFlic {
    return {
      frames: Array.from({ length: frames }, (_, i) => ({ index: i, resource: LOT_BONUS_RESOURCE, flic: true }) as unknown as ImageBitmap),
      width: 213,
      height: 68,
      frameMs: LOT_BONUS_MS,
      close: () => undefined,
    };
  }

  const noFlic = (): null => null;

  /**
   * 资源 13（奖池金额的字形）的真实记录 —— 尺寸与锚点都自 `Panel.mkf` 的 SMP 表 dump。
   * @source 0x431612 `push 0xd`
   */
  const DIGIT_IMAGE: Record<number, { w: number; h: number; ax: number; ay: number }> = {
    0: { w: 16, h: 18, ax: 8, ay: 9 },
    1: { w: 7, h: 18, ax: 3, ay: 9 },
    2: { w: 13, h: 18, ax: 6, ay: 9 },
    3: { w: 13, h: 18, ax: 6, ay: 9 },
    4: { w: 13, h: 18, ax: 6, ay: 9 },
    5: { w: 13, h: 18, ax: 6, ay: 9 },
    6: { w: 12, h: 18, ax: 6, ay: 9 },
    7: { w: 13, h: 18, ax: 6, ay: 9 },
    8: { w: 14, h: 18, ax: 7, ay: 9 },
    9: { w: 12, h: 18, ax: 6, ay: 9 },
    10: { w: 3, h: 5, ax: 2, ay: -3 },
    11: { w: 16, h: 18, ax: 6, ay: 9 },
  };

  /** 记录图号与调用时的 colorKey 开关；尺寸取真实记录 */
  function spySprite(): { fn: LotSprite; keys: Map<string, boolean> } {
    const keys = new Map<string, boolean>();
    const fn: LotSprite = (archive, resource, index, key) => {
      keys.set(`${resource}:${index}`, key === true);
      const info = resource === LOT_RESOURCE ? LOT_IMAGE[index] : DIGIT_IMAGE[index];
      if (info === undefined) return null;
      return {
        bitmap: { index, resource } as unknown as ImageBitmap,
        width: info.w,
        height: info.h,
        anchorX: info.ax,
        anchorY: info.ay,
      } as Sprite;
    };
    return { fn, keys };
  }

  const view = (over: Partial<LotView> = {}): LotView => ({
    phase: 'pick',
    message: null,
    pool: 1000,
    price: 1000,
    available: [0, 1, 2],
    owned: 0,
    picked: null,
    eye: null,
    mouth: null,
    bonusFrame: 0,
    ...over,
  });

  /**
   * ★ 第十九份回报「已经被买的彩票号码没有变成灰色」。
   * @source 建屏 `fcn_0042f32c`：号码表[i] != 0 ⇒ `fcn_004552e7(图 0, 0x1f+col*0x40, 0x110+row*0x30, 0x3e, 0x2e, −0xa)`
   */
  describe('★ 已售出号格压暗（0x42f32c）', () => {
    it('常量逐个对 exe 立即数：内缩 1 px 的 62×46、换色表 −0xa ⇒ 叠 10/32 的黑', () => {
      expect(LOT_SOLD_SHADE).toEqual({ x: 0x1f, y: 0x110, w: 0x3e, h: 0x2e, level: -0x0a, alpha: 10 / 32 });
      expect(soldShadeRect(0)).toEqual({ x: 0x1f, y: 0x110, w: 62, h: 46 });
      // 第 1 行最后一格 / 第 2 行第一格：9 列换行（ebx 到 0x25f 就回 0x1f）
      expect(soldShadeRect(8)).toEqual({ x: 0x1f + 8 * 0x40, y: 0x110, w: 62, h: 46 });
      expect(soldShadeRect(9)).toEqual({ x: 0x1f, y: 0x140, w: 62, h: 46 });
      expect(soldShadeRect(35)).toEqual({ x: 0x21f, y: 0x1a0, w: 62, h: 46 });
      expect(soldShadeRect(36)).toBeNull();
      // 压暗块整个落在命中格里（命中格左上角 −1 px）
      for (let n = 0; n < LOT_NUMBERS; n++) {
        const hit = numberRect(n)!;
        const sh = soldShadeRect(n)!;
        expect(sh.x - hit.x).toBe(1);
        expect(sh.y - hit.y).toBe(1);
        expect(hitNumber(sh.x, sh.y)).toBe(n);
        expect(hitNumber(sh.x + sh.w - 1, sh.y + sh.h - 1)).toBe(n);
      }
    });

    it('soldNumbers = 36 个号里不在 available 的那些', () => {
      expect(soldNumbers(Array.from({ length: 36 }, (_, i) => i))).toEqual([]);
      expect(soldNumbers([0, 1, 2]).length).toBe(33);
      expect(soldNumbers([0, 1, 2])[0]).toBe(3);
    });

    it('卖出去的号（不论谁买的）各压一块、没卖的不压；叠的是 10/32 的黑', () => {
      const f = fakeCtx();
      const sold = [3, 10, 23, 35];
      const available = Array.from({ length: 36 }, (_, i) => i).filter((n) => !sold.includes(n));
      drawLotteryScreen(f.ctx, spySprite().fn, noFlic, view({ available }));
      expect(f.rects.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(sold.map((n) => soldShadeRect(n)));
      for (const r of f.rects) expect(r.fill).toBe(`rgba(0,0,0,${10 / 32})`);
    });

    it('一个都没卖 ⇒ 一块都不压', () => {
      const f = fakeCtx();
      drawLotteryScreen(f.ctx, spySprite().fn, noFlic, view({ available: Array.from({ length: 36 }, (_, i) => i) }));
      expect(f.rects).toEqual([]);
    });

    it('★ 改的是底图 ⇒ 紧跟底图、在貓女郎之前（貓女郎盖住第一行上半，不能被压暗）', () => {
      const f = fakeCtx();
      drawLotteryScreen(f.ctx, spySprite().fn, noFlic, view({ available: [0] }));
      const bg = f.ops.indexOf(`${LOT_RESOURCE}:${LOT_CHUNK.bg}`);
      const cat = f.ops.indexOf(`${LOT_RESOURCE}:${LOT_CHUNK.kitty}`);
      const firstRect = f.ops.indexOf('rect');
      const lastRect = f.ops.lastIndexOf('rect');
      expect(bg).toBeGreaterThanOrEqual(0);
      expect(firstRect).toBe(bg + 1);
      expect(lastRect).toBeLessThan(cat);
      expect(f.rects).toHaveLength(35);
    });
  });

  it('★ 默认一段（无气泡、无贴片）：底图 → 貓女郎图 1 → 蓝板 → 金额字形', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view());
    // 金额 `$1,000` = 6 个字形（从右往左）
    expect(f.images.map((i) => i.index)).toEqual([0, 1, 9, 0, 0, 0, 0x0a, 1, 0x0b]);
  });

  it('★ **只画一只貓女郎**：默认图 1 @(210,−5)，买中之后才是图 2 @(154,−8)', () => {
    const f1 = fakeCtx();
    const s1 = spySprite();
    drawLotteryScreen(f1.ctx, s1.fn, noFlic, view());
    const cat1 = f1.images.filter((i) => i.resource === LOT_RESOURCE && i.index === LOT_CHUNK.kitty);
    expect(cat1).toHaveLength(1);
    expect(cat1[0]).toMatchObject({ x: 210, y: -5 });
    expect(
      f1.images.some((i) => i.resource === LOT_RESOURCE && i.index === LOT_CHUNK.kittyHi),
    ).toBe(false);

    const f2 = fakeCtx();
    const s2 = spySprite();
    drawLotteryScreen(f2.ctx, s2.fn, noFlic, view({ phase: 'bye' }));
    expect(f2.images.some((i) => i.resource === LOT_RESOURCE && i.index === LOT_CHUNK.kitty)).toBe(
      false,
    );
    expect(
      f2.images.find((i) => i.resource === LOT_RESOURCE && i.index === LOT_CHUNK.kittyHi),
    ).toMatchObject({ x: 154, y: -8 });
  });

  it('★ 每个落点都对：底图 (0,0)、眼 (273,63)、嘴 (273,105)、蓝板 (28,27)', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view({ eye: LOT_CHUNK.eyeOpen, mouth: LOT_CHUNK.mouthPurse }));
    const at = (index: number): { x: number; y: number } => {
      const i = f.images.find((v) => v.index === index)!;
      return { x: i.x, y: i.y };
    };
    expect(at(0)).toEqual({ x: 0, y: 0 });
    expect(at(LOT_CHUNK.eyeOpen)).toEqual({ x: 273, y: 63 });
    expect(at(LOT_CHUNK.mouthPurse)).toEqual({ x: 273, y: 105 });
    expect(at(LOT_CHUNK.plate)).toEqual({ x: 28, y: 27 });
  });

  it('★ 金额字形从右往左：最右那位**中心**在 (184,41)（贴出来是左上 (176,32)）', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view({ pool: 1000 }));
    const plateAt = f.images.findIndex((i) => i.index === LOT_CHUNK.plate);
    const glyphs = f.images.slice(plateAt + 1);
    // 数字 0 的锚点是 (8,9) → 左上 = (184−8, 41−9)
    expect(glyphs[0]).toMatchObject({ index: 0, x: 176, y: 32 });
    // `$` 的中心在 x=106，锚点 (6,9)
    expect(glyphs.at(-1)).toMatchObject({ index: 0x0b, x: 100, y: 32 });
  });

  it('★ 粉笔弧减掉它自己的锚点 (28,25) —— 落在那一格正中 (62,295)', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view({ picked: 0 }));
    const chalk = f.images.find((i) => i.index === LOT_CHUNK.chalk)!;
    expect(chalk).toEqual({
      index: LOT_CHUNK.chalk,
      resource: LOT_RESOURCE,
      x: 62 - 28,
      y: 295 - 25,
      flic: false, // 不是 FLIC 帧
    });
  });

  it('★ 气泡落在 (360,20)；文字块中心 (360+237/2+20, 20+96)', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view({ message: lotMessageOf('pick') }));
    expect(f.images.find((i) => i.index === LOT_CHUNK.bubble)).toMatchObject({ x: 360, y: 20 });
    expect(f.textAt.map((l) => l.t)).toEqual(['請圈選您的', '幸運號碼～']);
    const cx = 360 + 237 / 2 + 20;
    const cy = 20 + 96;
    expect(f.textAt[0]).toMatchObject({ x: cx, y: cy - 13 });
    expect(f.textAt[1]).toMatchObject({ x: cx, y: cy + 13 });
  });

  it('★ 语音号 `#NNNN` 不上屏', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view({ message: lotMessageOf('hello') }));
    const all = f.textAt.map((t) => t.t).join('');
    expect(all).not.toContain('#');
    expect(all).toContain('一券在手');
  });

  it('★ 抠黑逐图判定：图 2/7/8 抠、底图与图 9 不抠、字形一律抠', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view({ phase: 'bye', picked: 1, message: 'x' }));
    expect(sp.keys.get(`${LOT_RESOURCE}:0`)).toBe(false); // 底图
    expect(sp.keys.get(`${LOT_RESOURCE}:2`)).toBe(true); // 那一帧画的是图 2（貓女郎）
    expect(sp.keys.get(`${LOT_RESOURCE}:7`)).toBe(true); // 粉笔
    expect(sp.keys.get(`${LOT_RESOURCE}:8`)).toBe(true); // 气泡
    expect(sp.keys.get(`${LOT_RESOURCE}:9`)).toBe(false); // 蓝板
    expect(sp.keys.get(`${LOT_DIGIT_RESOURCE}:0`)).toBe(true); // 字形
  });

  it('★ 没有圈中的号就不画粉笔、没有说话就不画气泡', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, noFlic, view());
    expect(f.images.some((i) => i.index === LOT_CHUNK.chalk)).toBe(false);
    expect(f.images.some((i) => i.index === LOT_CHUNK.bubble)).toBe(false);
  });

  it('★ 獎金跑馬燈（Panel#14）画在 (8,8)，帧号由 `bonusFrameAt(now)` 决定', () => {
    // @source 0x42f3fe `push 5 / push 8 / push 8 / call fcn_00450ced`
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, () => fakeBonusFlic(), view(), 0);
    const marquee = f.images.find((i) => i.flic === true)!;
    expect(marquee).toMatchObject({ resource: LOT_BONUS_RESOURCE, index: 0, x: 8, y: 8 });
    expect(LOT_BONUS_AT).toEqual({ x: 8, y: 8 });

    // 第 71 ms = 第 1 帧、第 5×71 ms 回到第 0 帧（5 帧循环）
    for (const [now, frame] of [[0, 0], [LOT_BONUS_MS, 1], [LOT_BONUS_MS * 4, 4], [LOT_BONUS_MS * 5, 0]] as const) {
      const g = fakeCtx();
      drawLotteryScreen(g.ctx, sp.fn, () => fakeBonusFlic(), view(), now);
      const m = g.images.find((i) => i.flic === true)!;
      expect(m, `now=${now}`).toMatchObject({ index: frame, x: 8, y: 8 });
    }
  });

  it('★ 跑馬燈画在最底层：底图与蓝板都压在它上面（原版建屏顺序）', () => {
    const f = fakeCtx();
    const sp = spySprite();
    drawLotteryScreen(f.ctx, sp.fn, () => fakeBonusFlic(), view(), 0);
    // 第一张画的就是跑馬燈的帧（它在建屏那一段的最后起播，
    // 但每帧重绘时原版先 Blt 影片、再铺台面图；本模块同样先画它）
    expect(f.images[0]).toMatchObject({ flic: true, x: 8, y: 8 });
    expect(f.images.some((i) => i.resource === LOT_RESOURCE && i.index === LOT_CHUNK.bg)).toBe(true);
  });

  it('★ 影片还没解出来（`flic()` 返回 null）时不画、不炸 —— 解好后同一帧就能补上', () => {
    const f = fakeCtx();
    const sp = spySprite();
    let film: LoadedFlic | null = null;
    expect(drawBonusMarquee(f.ctx, () => film, 0)).toBe(false);
    drawLotteryScreen(f.ctx, sp.fn, () => film, view(), 0);
    expect(f.images.some((i) => i.flic === true)).toBe(false);
    // 解码完成之后（main.ts 会自己重画一帧）
    film = fakeBonusFlic();
    const g = fakeCtx();
    expect(drawBonusMarquee(g.ctx, () => film, 0)).toBe(true);
    drawLotteryScreen(g.ctx, sp.fn, () => film, view(), 0);
    expect(g.images.some((i) => i.flic === true)).toBe(true);
  });

  it('★ 缺图时静默跳过（不炸）', () => {
    const f = fakeCtx();
    const none: LotSprite = () => null;
    expect(() =>
      drawLotteryScreen(f.ctx, none, noFlic, view({ picked: 0, eye: 3, message: 'x' })),
    ).not.toThrow();
    expect(f.images).toEqual([]);
  });
});

describe('★ T-036 残留：買中定格的「拜拜」那一拍**不能画成全黑**', () => {
  /*
   * 机制（目视才抓到的）：`main.ts` 的帧序是
   *   1. `const overlay = activeUiScreen();`   ← 这一拍**取好**了
   *   2. `overlay.tick?.(uiEnv())`             ← tick 里可能把屏关掉
   *   3. `overlay.draw(uiEnv())`               ← 画的还是第 1 步那一张
   * 于是 `tick()` 在收尾那一拍若把 `byeView` 清掉，第 3 步的 `currentView()`
   * 就返回 null、`draw()` 什么都不画 —— **整整一帧全黑**（只剩背景填充）。
   * 原版是「先画完拜拜那一拍，下一拍 100 ms 定时器才 `Post_0402_Message(0)` 关屏」。
   */
  it('★ 在收尾那一拍，`byeView` 仍留着（draw 有东西可画）', () => {
    const src = readFileSync(new URL('./lottery-screen.ts', import.meta.url), 'utf8');
    const at = src.indexOf('ui.dismissed = true;');
    expect(at).toBeGreaterThan(0);
    // 同一段里（到下一个 `}` 结束）不许再出现 `byeView = null`
    const tail = src.slice(at, at + 700);
    expect(tail, '收尾那一拍不得清掉 byeView（会画成全黑）').not.toContain('byeView = null');
    // 而 reset 那一条必须还在（下一局开屏时清）
    const resetAt = src.indexOf('export function resetLotteryScreenState');
    expect(src.slice(resetAt, resetAt + 300)).toContain('ui.byeView = null;');
  });

  it('★ 结构：`active()` 在 `dismissed` 之后立刻返回 false（关了就是关了）', () => {
    const src = readFileSync(new URL('./lottery-screen.ts', import.meta.url), 'utf8');
    const at = src.indexOf('active(env: UiScreenEnv): boolean {');
    expect(src.slice(at, at + 220)).toContain('if (ui.dismissed) return false;');
  });

  it('`resetLotteryScreenState` 把 byeView 与 dismissed 一起复位', () => {
    resetLotteryScreenState();
    expect(lotteryPhase()).toBe('hello');
    expect(lotteryPicked()).toBeNull();
  });
});

describe('★ gap-audit #13：买中那一下放成交音 31 @source 0x00430029..0x00430030（表 0x47566b）', () => {
  it('★ 单机：点中未售出的号 → 31，且在 dispatch 之前', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([7, 8, 9]) });
    lotteryScreen.tick!(mkEnv(s, 0, false).env);
    const { env, actions, effects } = mkEnv(s, 10, false);
    const cell = numberRect(8)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env);
    expect(LOTTERY_BUY_SOUND).toBe(31);
    expect(effects).toEqual([31]);
    expect(actions).toEqual([{ type: 'lottery', number: 8 }]);
  });

  it('点空 / 点已售出的号 → 不放', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([7, 8, 9]) });
    lotteryScreen.tick!(mkEnv(s, 0, false).env);
    const { env, effects } = mkEnv(s, 10, false);
    lotteryScreen.down!(5, 5, env);
    const sold = numberRect(3)!;
    lotteryScreen.down!(sold.x + 1, sold.y + 1, env);
    expect(effects).toEqual([]);
  });

  it('★ 联机·行动者那台：照样放；联机·旁观那台：点了不算、不放、不送', () => {
    resetLotteryScreenState();
    const s = mkState({ pending: mkPending([7, 8, 9]) });
    lotteryScreen.tick!(mkEnv(s, 0, false, 1).env);
    const spect = mkEnv(s, 10, false, 1);
    const cell = numberRect(7)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, spect.env);
    expect(spect.effects).toEqual([]);
    expect(spect.actions).toEqual([]);
    expect(lotteryPhase()).toBe('pick');
    // 旁观端右键也不替人家放弃
    lotteryScreen.contextmenu!(0, 0, spect.env);
    expect(spect.actions).toEqual([]);

    const actor = mkEnv(s, 20, false, s.currentPlayer);
    lotteryScreen.down!(cell.x + 1, cell.y + 1, actor.env);
    expect(actor.effects).toEqual([31]);
    expect(actor.actions).toEqual([{ type: 'lottery', number: 7 }]);
  });
});

describe('★ pt26 #2：投注窗只归「正好 who_plays == 1」的那位 @source 0x004315d3..0x004315e1（`cmp byte [+0x15],1 / jne` 电脑那支不开窗）', () => {
  /** 当前玩家（0 号）被託管：真人 + 託管位 = 5 */
  const autopiloted = (s: GameState): GameState =>
    ({ ...s, players: [{ ...s.players[0]!, whoPlays: 0x05 }] }) as unknown as GameState;
  const human = (s: GameState): GameState =>
    ({ ...s, players: [{ ...s.players[0]!, whoPlays: 0x01 }] }) as unknown as GameState;

  it('★ 单机：这一回合归电脑（被託管的真人）时，点号 / 跳开场白 / 右键 都不动；「取消」钮也不露', () => {
    resetLotteryScreenState();
    const s = autopiloted(mkState({ pending: mkPending([7, 8, 9]) }));
    lotteryScreen.tick!(mkEnv(s, 0, true).env);
    expect(lotteryPhase()).toBe('hello');
    const { env, actions, effects } = mkEnv(s, 10, true);
    const cell = numberRect(8)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env);
    expect(lotteryPhase()).toBe('hello'); // 连开场白都不替电脑跳
    expect(actions).toEqual([]);
    expect(effects).toEqual([]);
    expect(lotteryScreen.contextmenuLive!(env)).toBe(false);
    lotteryScreen.contextmenu!(0, 0, env);
    expect(actions).toEqual([]);
    expect(lotteryPhase()).toBe('hello');
  });

  it('单机：正好 who_plays == 1 的真人照常能买、能右键走人', () => {
    resetLotteryScreenState();
    const s = human(mkState({ pending: mkPending([7, 8, 9]) }));
    lotteryScreen.tick!(mkEnv(s, 0, false).env);
    const { env, actions, effects } = mkEnv(s, 10, false);
    expect(lotteryScreen.contextmenuLive!(env)).toBe(true);
    const cell = numberRect(9)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, env);
    expect(actions).toEqual([{ type: 'lottery', number: 9 }]);
    expect(effects).toEqual([LOTTERY_BUY_SOUND]);

    resetLotteryScreenState();
    lotteryScreen.tick!(mkEnv(s, 20, false).env);
    const r = mkEnv(s, 30, false);
    lotteryScreen.contextmenu!(0, 0, r.env);
    expect(r.actions).toEqual([{ type: 'declineDecision' }]);
  });

  it('★ 联机：本机座位此刻被超时託管（服务器 setAi 5）→ 本机也点不动；旁观端照旧点不动', () => {
    resetLotteryScreenState();
    const s = autopiloted(mkState({ pending: mkPending([7, 8, 9]) }));
    lotteryScreen.tick!(mkEnv(s, 0, false, 0).env);
    const own = mkEnv(s, 10, false, 0);
    const cell = numberRect(7)!;
    lotteryScreen.down!(cell.x + 1, cell.y + 1, own.env);
    lotteryScreen.contextmenu!(0, 0, own.env);
    expect(own.actions).toEqual([]);
    expect(own.effects).toEqual([]);
    expect(lotteryScreen.contextmenuLive!(own.env)).toBe(false);

    const spect = mkEnv(human(s), 20, false, 1);
    lotteryScreen.down!(cell.x + 1, cell.y + 1, spect.env);
    lotteryScreen.contextmenu!(0, 0, spect.env);
    expect(spect.actions).toEqual([]);
    expect(lotteryScreen.contextmenuLive!(spect.env)).toBe(false);

    // 託管收回（服务器 setAi 1）之后，本机那一座又能买了
    const back = mkEnv(human(s), 30, false, 0);
    lotteryScreen.down!(cell.x + 1, cell.y + 1, back.env);
    expect(back.actions).toEqual([{ type: 'lottery', number: 7 }]);
  });
});
