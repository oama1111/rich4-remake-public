/*
 * 每月結算 + 頒獎 —— 照 exe 逐状态重写之后的钉子（第二十一份 `20260924-144653022`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回报：「这个页面应该有台词，评比本月最倒霉和最幸运…2 个评比，不是这样直接发利息」。
 * 状态表与 VA 见 `monthly-screen.ts` 文件头；这里钉住：
 *   ① 整段**自己往下走**（100 ms 一拍、每一步等上一句字框挂满 2000 ms / 语音说完），从不等点击；
 *   ② 台词（语音号）与音效的**次序**：#0092 → #0093 →（悲情）#0095 + 27 → 名字 #0096+c + 60 → 影片 → #0108
 *      → #0109 + 27 → 名字 #0110+c + 28 → 奖座影片 → #0122 → 1 秒后关屏；
 *   ③ 没有悲情人物 / 悲情 = 冠軍 ⇒ 直接冠軍那一段；「動畫過程」关 ⇒ 只说 #0093、3 秒后关；
 *   ④ 点一下 = 收掉字框 + 停语音 + 跳过（`0x00439b62`）；影片放着时点的是影片；
 *   ⑤ 名牌写**加息前**的存款与 `trunc(存款×0.1)`（有贷款写红字 `貸款中`），贴在 (360, 行 y − 36)；
 *   ⑥ 起播判据 = core 交下来的 `lastMonthlySettle`（只活一条 action），单机 / 联机同一条。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeGameState, makePlayer, type GameState, type MonthlySettleHint } from '@rich4/core';
import {
  MONTHLY_BLINK,
  MONTHLY_BOX_BUBBLE,
  MONTHLY_BOX_COURAGE,
  MONTHLY_BOX_FAREWELL,
  MONTHLY_CHUNK,
  MONTHLY_FLIC_OFFSETS,
  MONTHLY_LINE_MS,
  MONTHLY_LINEUP_X,
  MONTHLY_LINES,
  MONTHLY_MOUTH,
  MONTHLY_PLATE_AT,
  MONTHLY_ROW_Y,
  MONTHLY_SOUND_CHAMP_NAME,
  MONTHLY_SOUND_INTRO,
  MONTHLY_SOUND_SAD_NAME,
  MONTHLY_SPOT_CHUNK,
  MONTHLY_SPOT_X,
  MONTHLY_TICK_MS,
  drawMonthlyScreen,
  monthlyAdvance,
  monthlyAvatarChunk,
  monthlyClick,
  monthlyFlicResource,
  monthlyFlicSpec,
  monthlyNameLine,
  monthlyPlateText,
  monthlyScreen,
  monthlyScreenState,
  monthlyStart,
  monthlyViewOf,
  resetMonthlyScreen,
  setMonthlyRand,
  type MonthlyEffect,
  type MonthlyIo,
  type MonthlyRun,
  type MonthlyView,
} from './monthly-screen.ts';
import type { Sprite } from './assets.ts';
import { PresentationHost } from './presentation-host.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  夹具
// ============================================================

/** 一位在场者的结算现场 */
function row(player: number, over: Partial<MonthlySettleHint['rows'][number]> = {}): MonthlySettleHint['rows'][number] {
  return {
    player,
    bankBefore: 100_000,
    interest: 10_000,
    loan: 0,
    unexpectedLoss: 0,
    unexpectedGain: 0,
    unluckyDays: 0,
    cash: 50_000,
    bank: 110_000,
    wealth: 300_000,
    ...over,
  };
}

function stateWith(hint: MonthlySettleHint, characters = [4, 0, 1, 7]): GameState {
  return makeGameState({
    totalMonths: 1,
    players: characters.map((c, i) => makePlayer({ index: i, character: c, whoPlays: 1 })),
    lastMonthlySettle: hint,
  });
}

function viewOf(hint: MonthlySettleHint, characters?: number[]): MonthlyView {
  const v = monthlyViewOf(stateWith(hint, characters));
  if (v === null) throw new Error('view');
  return v;
}

/** 悲情 = 2 号（角色 1 沙隆巴斯）、冠軍 = 0 号（角色 4 阿土伯）*/
const HINT_A: MonthlySettleHint = {
  rows: [row(0, { unexpectedGain: 900 }), row(1, { loan: 3 }), row(2, { unexpectedLoss: 88_000, unluckyDays: 4 }), row(3)],
  unlucky: 2,
  champion: 0,
};
const HINT_B: MonthlySettleHint = { ...HINT_A, unlucky: -1 };

/** 语音一句 ≈ 0（字框按 2000 ms 算）、影片一遍 500 ms、`rand()` 恒大（不眨眼、不张嘴）*/
const IO: MonthlyIo = { voiceBusy: false, rand: () => 0x7fff, filmMs: () => 500 };

interface Trace {
  voices: string[];
  sfx: number[];
  films: number[];
  closedAt: number | null;
  states: { t: number; st: number }[];
}

/** 从 t=0 起一路推到关屏（或到 `until`），每 50 ms 推一次（真机是每帧）*/
function play(view: MonthlyView, animation: boolean, io: MonthlyIo = IO, until = 120_000): { run: MonthlyRun; trace: Trace } {
  const s = monthlyStart(view, animation, 0);
  const run = s.run;
  const trace: Trace = { voices: [], sfx: [], films: [], closedAt: null, states: [{ t: 0, st: run.st }] };
  const eat = (effects: readonly MonthlyEffect[], t: number) => {
    for (const e of effects) {
      if (e.k === 'voice') trace.voices.push(e.line.slice(0, 5));
      if (e.k === 'sfx') trace.sfx.push(e.id);
      if (e.k === 'loadFilm') trace.films.push(e.resource);
      if (e.k === 'close') trace.closedAt = t;
    }
  };
  eat(s.effects, 0);
  for (let t = 50; t <= until && !run.closed; t += 50) {
    const before = run.st;
    eat(monthlyAdvance(run, t, io), t);
    if (run.st !== before) trace.states.push({ t, st: run.st });
  }
  return { run, trace };
}

// ============================================================
//  ① ② 整段次序
// ============================================================

describe('★★ 路径 A：有悲情人物且 ≠ 冠軍（状态 1 → 2 → 5 → 6 → 7 → 8 → 9 → 0xf → 0x10 → 0x11 → 0x12 → 0x13 → 0x16）', () => {
  const view = viewOf(HINT_A);
  const { trace } = play(view, true);

  it('台词（语音号）逐句：#0092 → #0093 → #0095 → 悲情名字 → #0108 → #0109 → 冠軍名字 → #0122', () => {
    expect(trace.voices).toEqual([
      '#0092',
      '#0093',
      '#0095',
      `#${String(96 + 1).padStart(4, '0')}`, // 悲情 = 2 号座 = 角色 1 ⇒ #0097
      '#0108',
      '#0109',
      `#${String(110 + 4).padStart(4, '0')}`, // 冠軍 = 0 号座 = 角色 4 ⇒ #0114
      '#0122',
    ]);
  });

  it('音效：27（悲情引出）→ 60（悲情名字）→ 27（冠軍引出）→ 28（冠軍名字）', () => {
    expect(trace.sfx).toEqual([MONTHLY_SOUND_INTRO, MONTHLY_SOUND_SAD_NAME, MONTHLY_SOUND_INTRO, MONTHLY_SOUND_CHAMP_NAME]);
  });

  it('两段影片：先悲情 `0x1a1+2c`、后奖座 `0x1a0+2c`', () => {
    expect(trace.films).toEqual([monthlyFlicResource(1, 'sad'), monthlyFlicResource(4, 'trophy')]);
  });

  it('状态序与 exe 一致，最后关屏', () => {
    expect(trace.states.map((s) => s.st)).toEqual([1, 2, 5, 6, 7, 8, 9, 0xf, 0x10, 0x11, 0x12, 0x13, 0x16]);
    expect(trace.closedAt).not.toBeNull();
  });

  it('每一句都挂满 2000 ms 才走下一步（`0x44ee18` 的闸）；状态 5 / 0xf 各数 30 拍（3 秒）', () => {
    const at = (st: number) => trace.states.find((s) => s.st === st)!.t;
    expect(at(2) - 0).toBeGreaterThanOrEqual(MONTHLY_LINE_MS); // #0092 挂满才到 1 → 2
    expect(at(5) - at(2)).toBeGreaterThanOrEqual(MONTHLY_LINE_MS); // #0093
    expect(at(6) - at(5)).toBeGreaterThanOrEqual(30 * MONTHLY_TICK_MS);
    expect(at(0x10) - at(0xf)).toBeGreaterThanOrEqual(MONTHLY_LINE_MS); // #0108 挂满才开始数
  });
});

describe('★★ 路径 B：没有悲情人物 ⇒ 状态 2 直接跳 0xf（`0x00438267 cmp ch, 0xff`）', () => {
  it('只有冠軍那一段', () => {
    const { trace } = play(viewOf(HINT_B), true);
    expect(trace.voices).toEqual(['#0092', '#0093', '#0109', '#0114', '#0122']);
    expect(trace.sfx).toEqual([MONTHLY_SOUND_INTRO, MONTHLY_SOUND_CHAMP_NAME]);
    expect(trace.films).toEqual([monthlyFlicResource(4, 'trophy')]);
    expect(trace.states.map((s) => s.st)).toEqual([1, 2, 0xf, 0x10, 0x11, 0x12, 0x13, 0x16]);
  });

  it('悲情 = 冠軍 同样跳过悲情那一段（`0x00438263 cmp al, ch / je`）', () => {
    const { trace } = play(viewOf({ ...HINT_A, unlucky: 0, champion: 0 }), true);
    expect(trace.voices).not.toContain('#0095');
    expect(trace.states.map((s) => s.st)).toEqual([1, 2, 0xf, 0x10, 0x11, 0x12, 0x13, 0x16]);
  });
});

describe('★★ 路径 C：「動畫過程」关（`0x00437f39` / `0x0043827e`）', () => {
  it('不说 #0092；#0093 照说；状态 2 → 0x16（30 拍）→ 关屏；不颁奖', () => {
    const { trace } = play(viewOf(HINT_A), false);
    expect(trace.voices).toEqual(['#0093']);
    expect(trace.sfx).toEqual([]);
    expect(trace.films).toEqual([]);
    expect(trace.states.map((s) => s.st)).toEqual([1, 2, 0x16]);
    const at2 = trace.states.find((s) => s.st === 0x16)!.t;
    expect(trace.closedAt! - at2).toBeGreaterThanOrEqual(29 * MONTHLY_TICK_MS);
  });
});

// ============================================================
//  ④ 点击
// ============================================================

describe('★ 点一下（`0x00439b62`）：收字框 + 停语音 + 跳过', () => {
  it('字框挂着时点：交出 stopVoice、下一拍就往下走', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    monthlyAdvance(run, 500, IO);
    expect(run.st).toBe(1);
    expect(monthlyClick(run, 500, IO)).toEqual([{ k: 'stopVoice' }]);
    expect(run.line).toBeNull();
    monthlyAdvance(run, 600, IO);
    expect(run.st).toBe(2); // 状态 1 走过去了，#0093 挂上
    expect(run.line?.text).toContain('加發１０％的儲金利息');
  });

  it('状态 5 的 30 拍：点一下就跳到悲情引出', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    let t = 0;
    while (run.st !== 5) monthlyAdvance(run, (t += 50), IO);
    monthlyClick(run, t, IO);
    monthlyAdvance(run, t + 100, IO);
    expect(run.st).toBe(6);
  });

  it('影片放着时点的是影片（flags bit1 可点掉），不置跳过', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    let t = 0;
    const io: MonthlyIo = { ...IO, filmMs: () => 60_000 };
    while (run.film === null || run.film.startedAt === null) monthlyAdvance(run, (t += 50), io);
    expect(run.film.kind).toBe('sad');
    monthlyClick(run, t, io);
    expect(run.film).toBeNull();
    expect(run.st).toBe(9);
    expect(run.skip).toBe(false);
    // 影片停在最后一帧（原版逐帧直接贴屏）+ 图 38 姿势
    expect(run.ops.some((o) => o.k === 'film')).toBe(true);
    expect(run.ops.some((o) => o.k === 'img' && o.chunk === MONTHLY_CHUNK.pose4)).toBe(true);
  });

  it('影片一直解不出来 ⇒ 等 4 秒就当没有（演出照走，不卡回合）', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    const io: MonthlyIo = { ...IO, filmMs: () => null };
    let t = 0;
    while (!run.closed && t < 200_000) monthlyAdvance(run, (t += 50), io);
    expect(run.closed).toBe(true);
    expect(run.ops.some((o) => o.k === 'film')).toBe(false);
  });

  it('语音还在响（`0x4544b9`）就一直挂着', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    monthlyAdvance(run, 10_000, { ...IO, voiceBusy: true });
    expect(run.st).toBe(1);
    monthlyAdvance(run, 10_100, IO);
    expect(run.st).toBe(2);
  });
});

// ============================================================
//  ⑤ 版面
// ============================================================

describe('★ 版面（绘制指令）', () => {
  it('建屏：图 0 → 图 19 抠黑 (24,70) → 各行头像 `3c+47` 抠黑 (600, 行 y)；字框预开在图 1 (190,10)', () => {
    const view = viewOf(HINT_A);
    const { run } = monthlyStart(view, true, 0);
    expect(run.ops[0]).toEqual({ k: 'img', chunk: 0, x: 0, y: 0, keyed: false });
    expect(run.ops[1]).toEqual({ k: 'img', chunk: MONTHLY_CHUNK.panel, x: 24, y: 70, keyed: true });
    expect(run.ops.slice(2)).toEqual(
      view.rows.map((r, i) => ({ k: 'img', chunk: monthlyAvatarChunk(r.character, 0), x: 600, y: MONTHLY_ROW_Y[4]![i], keyed: true })),
    );
    expect(run.box).toEqual(MONTHLY_BOX_BUBBLE);
    expect(run.line?.text).toBe(MONTHLY_LINES.intro.slice(5));
  });

  it('状态 2：名牌（加息前存款 / `trunc(×0.1)` / 贷款红字）贴 (360, 行 y − 36)、头像换 `3c+49`', () => {
    const view = viewOf(HINT_A);
    const { run } = monthlyStart(view, true, 0);
    let t = 0;
    while (run.st !== 5) monthlyAdvance(run, (t += 50), IO);
    const plates = run.ops.filter((o) => o.k === 'plate');
    expect(plates).toHaveLength(4);
    expect(plates[0]).toMatchObject({ row: 0, x: MONTHLY_PLATE_AT.x, y: 60 - 36, bank: '$100,000', interest: '$10,000', loan: false });
    expect(plates[1]).toMatchObject({ row: 1, interest: '貸款中', loan: true });
    expect(run.ops.filter((o) => o.k === 'img' && o.chunk === monthlyAvatarChunk(4, 2))).toHaveLength(1);
    expect(monthlyPlateText({ ...view.rows[0]!, bankBefore: 123_456 }).interest).toBe('$12,345');
  });

  it('状态 6：聚光查表（人数 × 名次）+ 图 37 (0,89) + 全员站队；状态 7：悲情表四行 + 站队除悲情者', () => {
    const view = viewOf(HINT_A);
    const { run } = monthlyStart(view, true, 0);
    let t = 0;
    while (run.st !== 7) monthlyAdvance(run, (t += 50), IO);
    expect(run.ops).toContainEqual({ k: 'img', chunk: MONTHLY_SPOT_CHUNK[4]![2], x: MONTHLY_SPOT_X[4]![2], y: 0, keyed: false });
    expect(run.ops).toContainEqual({ k: 'img', chunk: MONTHLY_CHUNK.pose3, x: 0, y: 0x59, keyed: true });
    expect(run.ops.filter((o) => o.k === 'figure')).toHaveLength(4);
    while ((run.st as number) !== 8) monthlyAdvance(run, (t += 50), IO);
    const texts = run.ops.filter((o) => o.k === 'text').map((o) => (o.k === 'text' ? o.text : ''));
    expect(texts).toEqual(['獲獎原因：', '本月意外損失：', '$88,000', '本月意外之財：', '$0', '本月倒楣天數：', '4天']);
    const figs = run.ops.filter((o) => o.k === 'figure').map((o) => (o.k === 'figure' ? o.x : 0));
    expect(figs).toEqual([MONTHLY_LINEUP_X[4]![0], MONTHLY_LINEUP_X[4]![1], MONTHLY_LINEUP_X[4]![3]]);
  });

  it('影片落点 = 站队 x + dx、330 + dy（左上角）；播几遍 = flags 第二字节（至少 1）', () => {
    const view = viewOf(HINT_A);
    const { run } = monthlyStart(view, true, 0);
    let t = 0;
    while (run.film === null) monthlyAdvance(run, (t += 50), IO);
    const spec = monthlyFlicSpec(1, 'sad');
    expect(spec).toMatchObject({ dx: -48, dy: -90, plays: 6, skippable: true });
    expect(run.film).toMatchObject({ x: MONTHLY_LINEUP_X[4]![2]! - 48, y: 330 - 90, plays: 6 });
    expect(monthlyFlicSpec(0, 'sad').plays).toBe(1); // flags 3 ⇒ 第二字节 0 ⇒ 只播一遍
    expect(MONTHLY_FLIC_OFFSETS).toHaveLength(12);
  });

  it('状态 9 / 0x13 换字框（图 3 / 图 4），状态 0xf 换回图 1', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    let t = 0;
    const seen: number[] = [];
    while (!run.closed) {
      monthlyAdvance(run, (t += 50), IO);
      if (run.line !== null && seen.at(-1) !== run.box.chunk) seen.push(run.box.chunk);
    }
    expect(seen).toEqual([MONTHLY_BOX_BUBBLE.chunk, MONTHLY_BOX_COURAGE.chunk, MONTHLY_BOX_BUBBLE.chunk, MONTHLY_BOX_FAREWELL.chunk]);
  });

  it('站队那一笔：头像按锚点 x、脚底落在 330（`0x14a − 高 + 锚点 y`）', () => {
    const calls: number[][] = [];
    const ctx = {
      drawImage: (...a: unknown[]) => calls.push(a.slice(1).map(Number)),
      fillText: () => undefined,
      set font(_v: string) {},
      set fillStyle(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const spr = { bitmap: {} as ImageBitmap, width: 60, height: 72, anchorX: 30, anchorY: 36 } as Sprite;
    const run = monthlyStart(viewOf(HINT_A), true, 0).run;
    run.ops = [{ k: 'figure', character: 4, x: 324 }];
    run.line = null;
    drawMonthlyScreen(ctx, () => spr, () => null, run, 0);
    expect(calls).toEqual([[324 - 30, 330 - 72]]);
  });
});

// ============================================================
//  待机
// ============================================================

describe('★ 待机（`0x00439196`）：眨眼三帧 + 第 4 拍还原；说话时摆嘴型', () => {
  it('`rand()>>10 == 0` ⇒ 眨眼：姿势 0 贴 21/20/21 于 (76,120)，第 4 拍从图 19 拷回', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    const n0 = run.ops.length;
    let k = 0;
    // 第一拍 rand 给 0（眨眼），其余给大数（不张嘴）
    const io: MonthlyIo = { ...IO, rand: () => (k++ === 0 ? 0 : 0x7fff) };
    for (let t = 100; t <= 400; t += 100) monthlyAdvance(run, t, io);
    const added = run.ops.slice(n0);
    const b = MONTHLY_BLINK[0]!;
    expect(added.slice(0, 3)).toEqual(b.frames.map((chunk) => ({ k: 'img', chunk, x: b.at.x, y: b.at.y, keyed: false })));
    expect(added[3]).toMatchObject({ k: 'copy', chunk: 19, x: 76, y: 120, w: 80, h: 40 });
  });

  it('字框挂着且 `rand()>>11 < 4` ⇒ 张嘴，停 `(rand&7)+1` 拍后闭嘴', () => {
    const { run } = monthlyStart(viewOf(HINT_A), true, 0);
    const n0 = run.ops.length;
    const seq = [0x7fff, 0, 1, 0]; // 不眨眼 / 张嘴 / rand&1=1 选张嘴图 / 停 1 拍
    let k = 0;
    const io: MonthlyIo = { ...IO, rand: () => seq[k++] ?? 0x7fff };
    monthlyAdvance(run, 100, io);
    monthlyAdvance(run, 200, io);
    const m = MONTHLY_MOUTH[0]!;
    expect(run.ops.slice(n0)).toEqual([
      { k: 'img', chunk: m.open, x: m.at.x, y: m.at.y, keyed: false },
      { k: 'img', chunk: m.closed, x: m.at.x, y: m.at.y, keyed: false },
    ]);
  });
});

// ============================================================
//  ⑥ 屏幕本体
// ============================================================

function fakeEnv(state: GameState, logs: string[], extra: Partial<UiScreenEnv> = {}): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo: { nodes: [] },
    now: 0,
    animation: true,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: (m: string) => logs.push(m),
    playEffect: () => undefined,
    stopEffect: () => undefined,
    ...extra,
  } as unknown as UiScreenEnv;
}

describe('★ 屏幕本体：起播判据 = core 的 `lastMonthlySettle`', () => {
  it('跨月 + 新写的现场 ⇒ 起播、点 midi10；没有现场（旧状态 / 月中）不起播', () => {
    resetMonthlyScreen();
    setMonthlyRand(() => 0x7fff);
    const after = stateWith(HINT_A);
    const before: GameState = { ...after, totalMonths: 0, lastMonthlySettle: null };
    const logs: string[] = [];
    const music: string[] = [];
    const env = fakeEnv(after, logs, { music: (f: string) => music.push(f) });
    monthlyScreen.event!(before, { ...after, lastMonthlySettle: null }, env);
    expect(monthlyScreenState().playing).toBe(false);
    monthlyScreen.event!(before, after, env);
    expect(monthlyScreenState().playing).toBe(true);
    expect(music).toEqual(['midi10.mid']);
    expect(monthlyScreen.active(env)).toBe(true);
    // 自己走完（不点）
    let t = 0;
    while (monthlyScreenState().playing && t < 200_000) {
      t += 50;
      monthlyScreen.tick!(fakeEnv(after, logs, { now: t }));
    }
    expect(monthlyScreenState().playing).toBe(false);
    expect(logs).toContain('每月結算：演出结束');
    setMonthlyRand(null);
  });

  it('★ 演出宿主（与 `main.ts` 同一份 `PresentationHost`）：月结屏在演时挡住回合驱动 / 联机收件箱，**不点也会自己演完放行**', () => {
    resetMonthlyScreen();
    setMonthlyRand(() => 0x7fff);
    const after = stateWith(HINT_A);
    let now = 0;
    const env = (): UiScreenEnv => fakeEnv(after, [], { now });
    const host = new PresentationHost({
      screens: [monthlyScreen],
      env,
      filmsBusy: () => false,
      godLine: () => ({ showing: false, pending: false }),
      speech: () => ({ onStage: 0, held: [] }),
      cueDone: () => true,
      deferredScreens: () => 0,
      magicAwaitingPick: () => false,
      bailClosing: () => false,
    });
    monthlyScreen.event!({ ...after, totalMonths: 0, lastMonthlySettle: null }, after, env());
    expect(host.screensBlocking()).toBe(true);
    expect(host.boxShowing()).toBe(true);
    while (monthlyScreenState().playing && now < 200_000) {
      now += 16;
      monthlyScreen.tick!(env());
    }
    expect(monthlyScreenState().playing).toBe(false);
    expect(host.screensBlocking()).toBe(false);
    // 影片素材拿不到（`flic` 恒 null）也只多等 4 秒一段 —— 整段一分钟内收场
    expect(now).toBeLessThan(60_000);
    setMonthlyRand(null);
  });

  it('联机旁观：`fastForward` 直接收场', () => {
    resetMonthlyScreen();
    const after = stateWith(HINT_B);
    const env = fakeEnv(after, []);
    monthlyScreen.event!({ ...after, totalMonths: 0, lastMonthlySettle: null }, after, env);
    expect(monthlyScreen.fastForward!(env)).toBe(true);
    expect(monthlyScreenState().playing).toBe(false);
  });

  it('按键被吃掉但不推进（窗口过程不收 `0x100/0x101`）', () => {
    resetMonthlyScreen();
    const after = stateWith(HINT_A);
    const env = fakeEnv(after, []);
    monthlyScreen.event!({ ...after, totalMonths: 0, lastMonthlySettle: null }, after, env);
    const st = monthlyScreenState().run!.st;
    expect(monthlyScreen.key!({ vk: 13, code: 'Enter' } as never, env)).toBe(true);
    expect(monthlyScreenState().run!.st).toBe(st);
    expect(monthlyScreenState().run!.skip).toBe(false);
    resetMonthlyScreen();
  });
});

// ============================================================
//  串 / 名字表逐字节对 exe
// ============================================================

describe('★ 台词串与名字表对 exe', () => {
  const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
  const runExe = existsSync(EXE) ? it : it.skip;
  const cstr = (buf: Buffer, va: number): string => {
    const off = 398848 + (va - 0x463000); // .data 那一节的 VA → 文件偏移（同旧测试）
    return new TextDecoder('big5').decode(buf.subarray(off, buf.indexOf(0, off)));
  };
  runExe('六句台词逐字节（含 `#NNNN` 语音号与换行）', () => {
    const buf = readFileSync(EXE);
    expect(cstr(buf, 0x464d60)).toBe(MONTHLY_LINES.intro);
    expect(cstr(buf, 0x464d92)).toBe(MONTHLY_LINES.interest);
    expect(cstr(buf, 0x464dca)).toBe(MONTHLY_LINES.sad);
    expect(cstr(buf, 0x464e21)).toBe(MONTHLY_LINES.courage);
    expect(cstr(buf, 0x464e39)).toBe(MONTHLY_LINES.champion);
    expect(cstr(buf, 0x464e66)).toBe(MONTHLY_LINES.farewell);
  });
  runExe('名字那一句：悲情 `0x464c30` 起（#0096..）、冠軍 `0x464cc2` 起（#0110..），按角色号', () => {
    const buf = readFileSync(EXE);
    expect(cstr(buf, 0x464c30)).toBe(monthlyNameLine(0, 'sad'));
    expect(cstr(buf, 0x464cb6)).toBe(monthlyNameLine(11, 'sad'));
    expect(cstr(buf, 0x464cc2)).toBe(monthlyNameLine(0, 'champion'));
    expect(cstr(buf, 0x464d48)).toBe(monthlyNameLine(11, 'champion'));
  });
});
