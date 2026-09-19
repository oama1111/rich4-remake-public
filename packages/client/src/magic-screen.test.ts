/*
 * 魔法屋屏的版面表、命中几何、回放帧序与「从状态 diff 反推落点」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编/掩膜/素材抄（VA 见 `magic-screen.ts` 的注释）。这里钉的是
 * **改坏了就变红**的那几条不变量：
 *
 *   ① **一圈那十二格的中心 = 表 `0x4756e8`**（不是记录表 `0x475718` 的 x/y）；
 *   ② 十二个中心**各自命中自己那一格**（`sectorAt`），且十二格互不重叠；
 *   ③ 十二个楔形**以 90° 为第一条中线、每 30° 一条、顺时针**（不是以 0° 起）；
 *   ④ 女巫**每一拍只有一只**：beat 1 = 图 1 落 (241,140)、beat 2 = 图 2 落 (182,142)；
 *   ⑤ 一圈里**每一项都点得到**（`down` 不被吞），落点/条件图标都取对了图号。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Sprite } from './assets.ts';
import {
  MAGIC_TARGET_NAMES,
  SPECIAL_KIND,
  newGame,
  parseMap,
  reduce,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { MAGIC_HOUSE_OPTIONS, parseVoiceCode } from '@rich4/data';
import { setVoiceSink } from './voice-sink.ts';
import {
  MAGIC_CENTER,
  MAGIC_GREET_LINES,
  MAGIC_GREET_MS,
  MAGIC_MSG_BOX,
  MAGIC_MSG_FONT_SIZE,
  magicGreetText,
  MAGIC_CHUNK,
  MAGIC_HIT_CENTER,
  MAGIC_HOLD_MS,
  MAGIC_KEYED,
  MAGIC_INNER_RADIUS,
  MAGIC_OUTER_RADIUS,
  MAGIC_REACHABLE_OPTIONS,
  MAGIC_RESOURCE,
  MAGIC_RING_AT,
  MAGIC_SECTOR_COUNT,
  MAGIC_SECTOR_HALF_DEG,
  MAGIC_SECTOR1_DEG,
  MAGIC_SPIN_MS,
  MAGIC_SPIN_OPTIONS,
  MAGIC_SPIN_SLOW,
  magicFrameAt,
  magicFrameChunk,
  MAGIC_EYES_AT,
  MAGIC_EYELID_AT,
  magicIconAngle,
  magicIconAt,
  magicIconChunk,
  magicPopupAt,
  magicRingAt,
  magicTargetIconChunk,
  MAGIC_CRITERION_MS,
  MAGIC_ROLL_TICKS,
  MAGIC_ROLL_TICKS_FAST,
  MAGIC_SPELL_LINE,
  MAGIC_TIMER_MS,
  MAGIC_TURN_LINE,
  MAGIC_TARGET_ICON_BASE,
  magicBoxLineFor,
  magicPlaybackStart,
  magicScreen,
  magicScreenState,
  magicViewOfSpin,
  resetMagicScreen,
  magicPlaybackTick,
  magicSpinDone,
  magicSpinStart,
  magicSpinSteps,
  magicSpinTick,
  magicTextAt,
  magicView,
  optionOfSector,
  hitMagicOption,
  drawMagicScreen,
  type MagicDraw,
  type MagicSprite,
  sectorAt,
  MAGIC_MOUTH_AT,
  MAGIC_RESULT_ICON_AT,
  MAGIC_RESULT_ICON_BASE,
  MAGIC_WITCH_BEAT2_AT,
  MAGIC_WITCH_HAND_AT,
  MAGIC_WITCH_BALL_AT,
  MAGIC_WITCH_INTRO_AT,
  MAGIC_SOUND_PRESS,
  MAGIC_VOICE_MAX_ASKS,
  MAGIC_VOICE_RETRY_MS,
} from './magic-screen.ts';

/** 从圆心按角度（度，逆时针，屏幕 y 向下）取一点（**不取整**，免得磨掉边界）*/
function atf(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: MAGIC_CENTER.x + r * Math.cos(rad), y: MAGIC_CENTER.y - r * Math.sin(rad) };
}

/** 从圆心按角度（度，逆时针，屏幕 y 向下）取一点 */
function at(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.round(MAGIC_CENTER.x + r * Math.cos(rad)),
    y: Math.round(MAGIC_CENTER.y - r * Math.sin(rad)),
  };
}

// ============================================================
//  ① 一圈十二格：中心 = 表 0x4756e8
// ============================================================

/** 表 `0x4756e8` 的 12 项，逐个 dump 出来（x、y 各是 word） */
const RING_TABLE: readonly [number, number][] = [
  [322, 91],
  [414, 82],
  [453, 157],
  [509, 242],
  [458, 314],
  [415, 387],
  [322, 394],
  [239, 393],
  [188, 316],
  [131, 222],
  [184, 161],
  [225, 83],
];

describe('★★ 一圈十二格的布局表 @source 表 0x4756e8（12 × (word x, word y)）', () => {
  it('★★ 十二个中心逐项钉死 —— 挪一个就变红', () => {
    expect(MAGIC_RING_AT).toHaveLength(MAGIC_SECTOR_COUNT);
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      expect([MAGIC_RING_AT[k]?.x, MAGIC_RING_AT[k]?.y]).toEqual(RING_TABLE[k]);
      expect(magicRingAt(k)).toEqual(MAGIC_RING_AT[k]);
    }
  });

  it('★ 十二个中心都在环上：半径 150..192、中线 90°/60°/…（顺时针每 30°）', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const p = MAGIC_RING_AT[k]!;
      const r = Math.hypot(p.x - MAGIC_CENTER.x, p.y - MAGIC_CENTER.y);
      expect(r).toBeGreaterThan(145);
      expect(r).toBeLessThan(193);
      const want = (90 - 30 * k + 360) % 360;
      const got = magicIconAngle(k);
      const off = Math.abs(((got - want + 540) % 360) - 180);
      expect(off).toBeLessThan(6); // 手绘中线与 30° 整数格差 ≤ 5°
    }
  });

  it('★★ 图标位置**不是**弹窗位置（两张不同的表）', () => {
    // @source 图标 = 0x4756e8；弹窗框/功能名 = 记录表 0x475718 的 x/y
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      expect(magicIconAt(k)).not.toEqual(magicPopupAt(k));
      expect(magicPopupAt(k)).toEqual({ x: MAGIC_HOUSE_OPTIONS[k]!.x, y: MAGIC_HOUSE_OPTIONS[k]!.y });
    }
    // 记录表的 x/y 散得满屏（半径 130..290）—— 拿它当图标位置就是玩家报的「排版混乱」
    const radii = MAGIC_HOUSE_OPTIONS.map((o) => Math.hypot(o.x - MAGIC_CENTER.x, o.y - MAGIC_CENTER.y));
    expect(Math.min(...radii)).toBeLessThan(140);
    expect(Math.max(...radii)).toBeGreaterThan(260);
  });

  it('★ 每个功能的高亮图标 = 图 23..34（扇区 + 22）@source 0x00432cee', () => {
    expect(MAGIC_CHUNK.ringFirst).toBe(23);
    expect(magicIconChunk(0)).toBe(23);
    expect(magicIconChunk(11)).toBe(34);
    // 条件图 = 图 11..22（条件号 + 11）@source 0x004327aa
    expect(MAGIC_TARGET_ICON_BASE).toBe(0x0b);
    expect(MAGIC_CHUNK.targetIconFirst).toBe(11);
    expect(magicTargetIconChunk(0)).toBe(11);
    expect(magicTargetIconChunk(11)).toBe(22);
  });

  it('★ 十二个中心两两不同、且相邻两格的中心至少隔开 80px', () => {
    // ⚠️ 原版那一笔的 `(x±0x20, y±0x20)` 是 **Lock 的裁剪矩形**，不是「格子互不重叠」
    //   的声明（实测 (131,222) 与 (184,161) 两个裁剪矩形是叠着的）。
    //   真正要钉的是「十二个图标各自有独立的位置」。
    const seen = new Set<string>();
    for (const p of MAGIC_RING_AT) seen.add(`${p.x},${p.y}`);
    expect(seen.size).toBe(MAGIC_SECTOR_COUNT);
    for (let i = 0; i < MAGIC_SECTOR_COUNT; i++) {
      const a = MAGIC_RING_AT[i]!;
      const b = MAGIC_RING_AT[(i + 1) % MAGIC_SECTOR_COUNT]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(79);
    }
  });
});

// ============================================================
//  ② 命中：每格点得到、互不重叠
// ============================================================

describe('★★ 命中几何 @source Panel.mkf #19 的掩膜', () => {
  it('★ 圆心 (320,238)、内外半径 126 / 241、第一条中线在 90°', () => {
    expect(MAGIC_CENTER).toEqual({ x: 320, y: 238 });
    expect(MAGIC_INNER_RADIUS).toBe(126);
    expect(MAGIC_OUTER_RADIUS).toBe(241);
    expect(MAGIC_SECTOR_HALF_DEG).toBe(15);
    expect(MAGIC_SECTOR1_DEG).toBe(90);
    expect(MAGIC_HIT_CENTER).toBe(13);
  });

  it('★★ 十二个**图标中心**各自命中自己那一格（「点得到」的最小保证）', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const p = MAGIC_RING_AT[k]!;
      expect(sectorAt(p.x, p.y), `第 ${k} 格的中心没命中自己`).toBe(k + 1);
      expect(hitMagicOption(p.x, p.y)).toBe(k);
      expect(optionOfSector(sectorAt(p.x, p.y))).toBe(k);
    }
  });

  it('★★ 方位是 90° 起、顺时针：上=1、右上=2、右=4、下=7、左=10', () => {
    expect(sectorAt(...(Object.values(at(90, 180)) as [number, number]))).toBe(1);
    expect(sectorAt(...(Object.values(at(60, 180)) as [number, number]))).toBe(2);
    expect(sectorAt(...(Object.values(at(0, 180)) as [number, number]))).toBe(4);
    expect(sectorAt(...(Object.values(at(-90, 180)) as [number, number]))).toBe(7);
    expect(sectorAt(...(Object.values(at(180, 180)) as [number, number]))).toBe(10);
    // 扇区 1 的楔形 = (75°, 105°]（中线 90°，半宽 15°）——
    //   掩膜里它量出来是 61.2°..118.4°（手绘的边比 30° 宽），中线与边界都落在这里
    expect(sectorAt(...(Object.values(at(90, 200)) as [number, number]))).toBe(1);
    expect(sectorAt(...(Object.values(at(80, 200)) as [number, number]))).toBe(1);
    expect(sectorAt(...(Object.values(at(100, 200)) as [number, number]))).toBe(1);
    expect(sectorAt(...(Object.values(at(74, 200)) as [number, number]))).toBe(2);
    expect(sectorAt(...(Object.values(at(106, 200)) as [number, number]))).toBe(12);
  });

  it('★ 每条楔形：中线 ±10° 都算自己，±20° 就换人（逐条）', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const mid = 90 - 30 * k;
      const self = k + 1;
      const next = ((k + 1) % MAGIC_SECTOR_COUNT) + 1;
      const prev = ((k + MAGIC_SECTOR_COUNT - 1) % MAGIC_SECTOR_COUNT) + 1;
      expect(sectorAt(...(Object.values(at(mid + 10, 200)) as [number, number]))).toBe(self);
      expect(sectorAt(...(Object.values(at(mid - 10, 200)) as [number, number]))).toBe(self);
      expect(sectorAt(...(Object.values(at(mid - 20, 200)) as [number, number]))).toBe(next);
      expect(sectorAt(...(Object.values(at(mid + 20, 200)) as [number, number]))).toBe(prev);
    }
  });

  it('★★ 十二格互不重叠、且把整圈分完：每 30° 恰好一格（0.5° 采样）', () => {
    const count = new Array<number>(13).fill(0);
    for (let deg = 0; deg < 360; deg += 0.5) {
      const p = atf(deg, 180);
      const sec = sectorAt(p.x, p.y);
      expect(sec).toBeGreaterThanOrEqual(1);
      expect(sec).toBeLessThanOrEqual(12);
      count[sec] = (count[sec] ?? 0) + 1;
    }
    // 30° / 0.5° = 60 个采样点 —— 十二格各自不多不少
    for (let k = 1; k <= 12; k++) expect(count[k], `扇区 ${k} 覆盖了 ${count[k]} 个采样点`).toBe(60);
  });

  it('★ 半径边界：内圈算中间那块、外圈谁都不认', () => {
    expect(sectorAt(MAGIC_CENTER.x, MAGIC_CENTER.y)).toBe(MAGIC_HIT_CENTER);
    expect(sectorAt(MAGIC_CENTER.x, MAGIC_CENTER.y - (MAGIC_INNER_RADIUS - 1))).toBe(MAGIC_HIT_CENTER);
    expect(sectorAt(MAGIC_CENTER.x, MAGIC_CENTER.y - MAGIC_INNER_RADIUS)).toBe(1); // 正上方 = 1 号
    expect(sectorAt(...(Object.values(at(90, MAGIC_OUTER_RADIUS)) as [number, number]))).toBe(1);
    expect(sectorAt(MAGIC_CENTER.x + MAGIC_OUTER_RADIUS + 1, MAGIC_CENTER.y)).toBe(0);
  });

  it('★ 扇区号 = 功能号 + 1；13 / 0 都不是功能', () => {
    expect(optionOfSector(1)).toBe(0);
    expect(optionOfSector(12)).toBe(11);
    expect(optionOfSector(MAGIC_HIT_CENTER)).toBeNull();
    expect(optionOfSector(0)).toBeNull();
  });
});

// ============================================================
//  ③ 女巫：每一拍只有一只
// ============================================================

/** 两张女巫的**素材尺寸**（`assets-clean/Panel/0018_001/002.png` 量出来）*/
const WITCH_BALL_SIZE = { w: 165, h: 213 };
const WITCH_HAND_SIZE = { w: 284, h: 210 };

interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  sprite: MagicSprite;
  images: { chunk: number; x: number; y: number }[];
  texts: string[];
}

/** 只认**图号**的假 sprite：尺寸/锚点按需覆盖，默认 280×173 锚点 (0,0) */
function fakeGreetCtx(over: Record<number, Partial<{ w: number; h: number; ax: number; ay: number }>> = {}): FakeCtx {
  const images: { chunk: number; x: number; y: number }[] = [];
  const texts: string[] = [];
  const ctx = {
    save() {}, restore() {},
    drawImage(bitmap: { chunk: number }, x: number, y: number) {
      images.push({ chunk: bitmap.chunk, x, y });
    },
    strokeText(t: string) { void t; },
    fillText(t: string) { texts.push(t); },
    beginPath() {}, arc() {}, stroke() {},
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    set lineWidth(_v: number) {}, set strokeStyle(_v: string) {}, set fillStyle(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  const sprite: MagicSprite = (_a, _r, chunk) => {
    const o = over[chunk] ?? {};
    const sp = {
      bitmap: { chunk } as unknown as ImageBitmap,
      width: o.w ?? 280,
      height: o.h ?? 173,
      anchorX: o.ax ?? 0,
      anchorY: o.ay ?? 0,
    } as Sprite;
    return sp;
  };
  return { ctx, sprite, images, texts };
}

const fakeView = { caster: 0, option: 4, name: '均富', targets: [], criterionName: '', criterion: -1 } as never;

function drawBeat(beat: 1 | 2, over: Partial<MagicDraw> = {}): FakeCtx {
  const f = fakeGreetCtx({
    [MAGIC_CHUNK.witchIntro]: WITCH_BALL_SIZE,
    [MAGIC_CHUNK.witchIdle]: WITCH_HAND_SIZE,
  });
  drawMagicScreen(f.ctx, f.sprite, {
    view: fakeView,
    pointer: -1,
    witchBlink: false,
    beat,
    eyesShut: true,
    hover: 0,
    ring: -1,
    greet: null,
    boxLine: null,
    ...over,
  });
  return f;
}

const witches = (f: FakeCtx) =>
  f.images.filter((i) => i.chunk === MAGIC_CHUNK.witchIntro || i.chunk === MAGIC_CHUNK.witchIdle);

describe('★★ 女巫：每一拍**只有一只**（玩家报的「2 个女巫」）', () => {
  it('★★ beat 1：只画图 1（抱水晶球）落 (241,140)，**不画**图 2', () => {
    const f = drawBeat(1);
    const w = witches(f);
    expect(w).toHaveLength(1);
    expect(w[0]!.chunk).toBe(MAGIC_CHUNK.witchIntro);
    expect(w[0]).toMatchObject({ x: 241, y: 140 });
    expect(MAGIC_WITCH_BALL_AT).toEqual({ x: 0xf1, y: 0x8c });
    expect(MAGIC_WITCH_INTRO_AT).toEqual(MAGIC_WITCH_BALL_AT); // 旧名同值
    // ★ 锚点落点 ⇒ drawImage 收到的是 (x − anchorX, y − anchorY)；(0,0) 锚点就是原值
    expect(f.images.some((i) => i.chunk === MAGIC_CHUNK.witchIdle)).toBe(false);
  });

  it('★★ beat 2：只画图 2（抬手）落 (182,142)，**不画**图 1', () => {
    const f = drawBeat(2);
    const w = witches(f);
    expect(w).toHaveLength(1);
    expect(w[0]!.chunk).toBe(MAGIC_CHUNK.witchIdle);
    expect(w[0]).toMatchObject({ x: 182, y: 142 });
    expect(MAGIC_WITCH_HAND_AT).toEqual({ x: 0xb6, y: 0x8e });
    expect(MAGIC_WITCH_BEAT2_AT).toEqual(MAGIC_WITCH_HAND_AT);
    expect(f.images.some((i) => i.chunk === MAGIC_CHUNK.witchIntro)).toBe(false);
  });

  it('★★ 图 2 的框把图 1 的框盖掉 95% 以上（两张叠在同一块脸上）', () => {
    const a = MAGIC_WITCH_BALL_AT;
    const b = MAGIC_WITCH_HAND_AT;
    const ox = Math.max(0, Math.min(a.x + WITCH_BALL_SIZE.w, b.x + WITCH_HAND_SIZE.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + WITCH_BALL_SIZE.h, b.y + WITCH_HAND_SIZE.h) - Math.max(a.y, b.y));
    // 原版两张的落点差 (241−182, 140−142) = (59, −2)：错开一点点，但都盖在同一处
    expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(64);
    expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(8);
    expect((ox * oy) / (WITCH_BALL_SIZE.w * WITCH_BALL_SIZE.h)).toBeGreaterThan(0.95);
  });

  it('★ 入口台詞那三拍也只画图 1（先前那一路同样画了两只）', () => {
    const f = fakeGreetCtx({
      [MAGIC_CHUNK.witchIntro]: WITCH_BALL_SIZE,
      [MAGIC_CHUNK.witchIdle]: WITCH_HAND_SIZE,
    });
    drawMagicScreen(f.ctx, f.sprite, {
      view: fakeView, pointer: -1, witchBlink: false, beat: 1, eyesShut: false, hover: 0, ring: -1,
      greet: 0, boxLine: MAGIC_GREET_LINES[0] ?? null,
    });
    const w = witches(f);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ chunk: MAGIC_CHUNK.witchIntro, x: 241, y: 140 });
  });

  it('★ 脸上的贴片（图 3 闭眼 / 图 5 嘴）只在 beat 1；beat 2 被图 2 盖住', () => {
    const b1 = drawBeat(1, { witchBlink: true });
    expect(b1.images.filter((i) => i.chunk === MAGIC_CHUNK.eyesShut)).toHaveLength(1);
    expect(b1.images.filter((i) => i.chunk === MAGIC_CHUNK.mouthTalk)).toHaveLength(1);
    const b2 = drawBeat(2, { witchBlink: true });
    expect(b2.images.filter((i) => i.chunk === MAGIC_CHUNK.eyesShut)).toHaveLength(0);
    expect(b2.images.filter((i) => i.chunk === MAGIC_CHUNK.mouthTalk)).toHaveLength(0);
  });

  it('★ 第二拍**没有**「压一张 280×173 结果条」这回事（原版那张是不存在的）', () => {
    const f = drawBeat(2, { boxLine: null });
    // 图 8 只在字框那一处出现；`boxLine: null` 时一笔都不该有
    expect(f.images.some((i) => i.chunk === MAGIC_CHUNK.resultBar)).toBe(false);
    expect(MAGIC_EYELID_AT).toEqual({ x: 0x11e, y: 0xdc });
    // 那个 (286,220) 的矩形是 60×18 的**合嘴**贴片，不是 280×173 的框
    expect(0x15a - 0x11e).toBe(60);
    expect(0xee - 0xdc).toBe(18);
  });
});

describe('★ 一圈里只画**高亮的那一格**（其余十一格在底图里）', () => {
  it('★★ `ring = k` ⇒ 只多贴图 `23+k`，落点 = `MAGIC_RING_AT[k]`', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const f = drawBeat(1, { ring: k });
      const icons = f.images.filter((i) => i.chunk >= 23 && i.chunk <= 34);
      expect(icons, `ring=${k} 时贴了 ${icons.length} 张图标`).toHaveLength(1);
      expect(icons[0]!.chunk).toBe(23 + k);
      expect(icons[0]).toMatchObject({ x: MAGIC_RING_AT[k]!.x, y: MAGIC_RING_AT[k]!.y });
    }
  });

  it('★★ `ring = -1` ⇒ 一张图标都不贴（十二格全靠底图）', () => {
    const f = drawBeat(1, { ring: -1 });
    expect(f.images.filter((i) => i.chunk >= 23 && i.chunk <= 34)).toHaveLength(0);
  });

  it('★★ 条件图标取 `criterion + 11` 落 (326,296)—— 不是 `option + 11`', () => {
    const f = drawBeat(1, {
      view: { caster: 0, option: 3, name: '原地停留一回合', targets: [1], criterion: 7, criterionName: '騎機車的人' } as never,
    });
    const icons = f.images.filter((i) => i.chunk >= 11 && i.chunk <= 22);
    expect(icons).toHaveLength(1);
    expect(icons[0]!.chunk).toBe(MAGIC_RESULT_ICON_BASE + 7);
    expect(icons[0]).toMatchObject({ x: MAGIC_RESULT_ICON_AT.x, y: MAGIC_RESULT_ICON_AT.y });
    expect(MAGIC_RESULT_ICON_AT).toEqual({ x: 0x146, y: 0x128 });
  });
});

// ============================================================
//  ④ 点击：一圈每一项都点得到
// ============================================================

interface FakeEnv {
  env: Parameters<NonNullable<typeof magicScreen.down>>[2];
  logs: string[];
  effects: number[];
  renders: number;
}

function fakeEnv(): FakeEnv {
  const logs: string[] = [];
  const effects: number[] = [];
  const renders = { n: 0 };
  const env = {
    screen: 'game',
    state: null,
    topo: null,
    map: null,
    now: 0,
    stage: null,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => { renders.n++; },
    log: (m: string) => { logs.push(m); },
    playEffect: (id: number) => { effects.push(id); },
    stopEffect: () => undefined,
    animation: true,
  } as unknown as Parameters<NonNullable<typeof magicScreen.down>>[2];
  return {
    env,
    logs,
    effects,
    get renders() { return renders.n; },
  } as FakeEnv;
}

/** 起一次回放（不碰地图：`lastEvent.kind === 'magicHouse'` 那条通道就够） */
function startPlayback(animation = true): FakeEnv {
  resetMagicScreen();
  const f = fakeEnv();
  const before = { currentPlayer: 0, players: [] } as unknown as GameState;
  const after = {
    currentPlayer: 0,
    players: [],
    lastEvent: { kind: 'magicHouse', id: 3, criterion: 5, targets: [0] },
  } as unknown as GameState;
  (f.env as { animation?: boolean }).animation = animation;
  magicScreen.event!(before, after, f.env);
  f.logs.length = 0;
  return f;
}

describe('★★ 一圈每一项都点得到（`down` 不再吞点击）', () => {
  it('★★ 十二个中心逐个点：报告出这一项的名字、hover 落在本格、且状态推进到 hold', () => {
    const f = startPlayback(false); // 关动画：直接从 roll 起
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const p = MAGIC_RING_AT[k]!;
      f.logs.length = 0;
      magicScreen.down!(p.x, p.y, f.env);
      expect(f.logs, `第 ${k} 格点下去没有日志`).toHaveLength(1);
      expect(f.logs[0]).toBe(`魔法屋：選定 ${k + 1}（${MAGIC_HOUSE_OPTIONS[k]!.name}）`);
      const st = magicScreenState();
      expect(st.hover).toBe(k + 1);
      expect(st.phase).toBe('hold'); // 状态 7 → 8：抬手那张女巫 + 条件图标
      expect(f.effects).toContain(MAGIC_SOUND_PRESS);
    }
    resetMagicScreen();
  });

  it('★ 点中央那块（13）报抽中的条件名，不改状态', () => {
    const f = startPlayback(false);
    magicScreen.down!(MAGIC_CENTER.x, MAGIC_CENTER.y, f.env);
    expect(f.logs).toEqual([`魔法屋：條件 ${MAGIC_TARGET_NAMES[5]}`]);
    expect(magicScreenState().hover).toBe(MAGIC_HIT_CENTER);
    resetMagicScreen();
  });

  it('★ 点在命中表不认的地方（0）：一声不响、一个音不放', () => {
    const f = startPlayback(false);
    magicScreen.down!(5, 5, f.env);
    expect(f.logs).toEqual([]);
    expect(f.effects).toEqual([]);
    resetMagicScreen();
  });

  it('★ 入口台詞那几拍点一下就跳过（原版 `[0x48c3a2] = 3` + `fcn_0044ee18(1)`）', () => {
    const f = startPlayback(true);
    expect(magicScreenState().phase).toBe('greet');
    magicScreen.down!(MAGIC_CENTER.x, MAGIC_CENTER.y, f.env);
    expect(f.logs).toEqual(['魔法屋：跳過開場台詞']);
    expect(magicScreenState().phase).toBe('roll');
    resetMagicScreen();
  });

  it('★★ `move` 换了一格会 `requestRender`（否则高亮刷不出来）+ 悬停音', () => {
    const f = startPlayback(true);
    const before = f.renders;
    const p = MAGIC_RING_AT[2]!;
    magicScreen.move!(p.x, p.y, f.env);
    expect(magicScreenState().hover).toBe(3);
    expect(f.effects).toContain(0); // MAGIC_SOUND_HOVER
    expect(f.renders).toBeGreaterThan(before);
    // 同一格再动一次不重复响/不重复重画
    const mid = f.renders;
    const effects = f.effects.length;
    magicScreen.move!(p.x + 1, p.y + 1, f.env);
    expect(f.renders).toBe(mid);
    expect(f.effects).toHaveLength(effects);
    resetMagicScreen();
  });
});

// ============================================================
//  ⑤ 语音：只在「换词那一拍」请求一次
// ============================================================

/**
 * 语音请求的**唯一合法位置**是状态推进（`event` / `tick` / `down`），
 * 不是绘制。先前它挂在 `magicGreetText` 里 —— 而那条链每帧都跑，
 * 一句台词 2 秒被请求 126 次（还会一次绘制请求两遍）。
 */
describe('★★ 女巫语音：换词那一拍请求一次（绘制链一次都不许请求）', () => {
  const voices: number[] = [];
  function spyOnVoice(): void {
    voices.length = 0;
    setVoiceSink((v) => { voices.push(v); });
  }
  const v37 = parseVoiceCode(MAGIC_GREET_LINES[0]!).voice;
  const v38 = parseVoiceCode(MAGIC_GREET_LINES[1]!).voice;

  it('★★ 同一句字框画 200 帧：**一次语音请求都没有**', () => {
    spyOnVoice();
    const f = fakeGreetCtx();
    for (let i = 0; i < 200; i++) {
      drawMagicScreen(f.ctx, f.sprite, {
        view: fakeView, pointer: -1, witchBlink: false, beat: 1, eyesShut: false, hover: 0,
        ring: -1, greet: 0, boxLine: MAGIC_GREET_LINES[0] ?? null,
      });
    }
    expect(voices).toEqual([]);
    setVoiceSink(null);
  });

  it('★★ 起播请求第一句 `#0037`；整句停留期间**最多两次**（不是每帧）', () => {
    spyOnVoice();
    expect(v37).toBe(37);
    const f = startPlayback(true); // 从入口三句开始
    expect(voices).toEqual([37]);
    // 三句台詞期间每帧都在 tick（`env.now` 每帧推进 16ms，共 1.92 s）
    let now = 0;
    for (let i = 0; i < 120; i++) {
      now += 16;
      magicScreen.tick!({ ...f.env, now } as typeof f.env);
    }
    // ★ 换词那一次 + 一次兜底补问（`Speaking.mkf` 懒加载），此后一声不响
    expect(voices).toEqual([37, 37]);
    expect(MAGIC_VOICE_MAX_ASKS).toBe(2);
    resetMagicScreen();
    setVoiceSink(null);
  });

  it('★★ 补问只在过了 `MAGIC_VOICE_RETRY_MS`、且只补一次', () => {
    spyOnVoice();
    const f = startPlayback(true);
    expect(voices).toEqual([37]);
    // 差 1 ms 不补
    magicScreen.tick!({ ...f.env, now: MAGIC_VOICE_RETRY_MS - 1 } as typeof f.env);
    expect(voices).toEqual([37]);
    magicScreen.tick!({ ...f.env, now: MAGIC_VOICE_RETRY_MS } as typeof f.env);
    expect(voices).toEqual([37, 37]);
    // 再晚也不补（上限 2 次）
    magicScreen.tick!({ ...f.env, now: MAGIC_VOICE_RETRY_MS * 3 } as typeof f.env);
    expect(voices).toEqual([37, 37]);
    resetMagicScreen();
    setVoiceSink(null);
  });

  it('★ 换了词（第一句 → 第二句）立刻请求新的那一句', () => {
    spyOnVoice();
    const f = startPlayback(true);
    expect(voices).toEqual([37]);
    // 2 秒后换第二句：即使去抖没到期也必须立刻请求（换了号）
    magicScreen.tick!({ ...f.env, now: MAGIC_GREET_MS } as typeof f.env);
    expect(magicScreenState().phase).toBe('greet');
    expect(voices).toEqual([37, 38]);
    expect(v38).toBe(38);
    resetMagicScreen();
    setVoiceSink(null);
  });
});

// ============================================================
//  ⑥ 素材与抠黑表
// ============================================================

describe('用到的图 @source magic_house 0x00432511 / 0x00432cfd', () => {
  it('★ 底图与十二个功能的高亮图标都在 Panel.mkf 资源 18', () => {
    expect(MAGIC_RESOURCE).toBe(18);
    expect(MAGIC_CHUNK.bg).toBe(0);
  });

  it('★ 指针高亮框的图号**按功能而异**：9/10/7/6 @source 0x00432dc4', () => {
    expect([0, 1, 2, 6, 7, 11].map((i) => magicFrameChunk(i))).toEqual([9, 10, 7, 7, 6, 9]);
    expect(MAGIC_CHUNK.frame).toBe(6);
    expect(MAGIC_CHUNK.frameAlt).toBe(7);
  });

  it('★ 弹窗框与功能名**同点**，且跟着落点的功能走', () => {
    for (let option = 0; option < MAGIC_SECTOR_COUNT; option++) {
      const at = magicPopupAt(option);
      expect(magicFrameAt(option)).toEqual(at);
      expect(magicTextAt(option)).toEqual(at);
    }
    expect(magicTextAt(-1)).toEqual(MAGIC_CENTER);
    expect(magicFrameAt(0)).not.toEqual(MAGIC_CENTER);
  });

  it('★ 女巫脸上的三张（眼睛/合嘴/张嘴）图号与落点', () => {
    expect(MAGIC_CHUNK.eyesShut).toBe(3);
    expect(MAGIC_CHUNK.eyelid).toBe(4);
    expect(MAGIC_CHUNK.mouth).toBe(5);
    expect(MAGIC_CHUNK.mouthTalk).toBe(MAGIC_CHUNK.mouth);
    expect(MAGIC_EYES_AT).toEqual({ x: 0x11e, y: 0xbc });
    expect(MAGIC_MOUTH_AT).toEqual({ x: 0x11e, y: 0xd9 });
    expect(0x15a - 0x11e).toBe(60);
    expect(0xdf - 0xbc).toBe(35);
  });
});

describe('抠黑表 @source 逐调用点对照（0x004563f5 不透明 / 0x00456418 抠黑）', () => {
  it('★ 两只女巫、四个锦缎框都要抠黑', () => {
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.witchIdle)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.witchIntro)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.frame)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.frameAlt)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.hoverFrame)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.hoverFrameAlt)).toBe(true);
  });

  it('★ 图 3/4/5（脸上的贴片）**不抠** —— 原版走不透明那支', () => {
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.eyesShut)).toBe(false);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.eyelid)).toBe(false);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.mouth)).toBe(false);
  });

  it('★ 条件图标 11..22 与功能高亮图标 23..34 全部抠黑 @source 0x004327c9 / 0x00432d0e', () => {
    for (let k = 0; k < 12; k++) {
      expect(MAGIC_KEYED.has(magicTargetIconChunk(k))).toBe(true);
      expect(MAGIC_KEYED.has(magicIconChunk(k))).toBe(true);
      expect(magicTargetIconChunk(k)).toBeLessThan(35);
      expect(magicIconChunk(k)).toBeLessThan(35);
    }
  });

  it('★ 底图与中央木牌（图 8）**不抠** —— 原版走的是不透明那支', () => {
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.bg)).toBe(false);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.resultBar)).toBe(false);
  });
});

describe('转盘帧序 @source VA 0x004325c2 的 100ms 定时器', () => {
  it('★ 每一位 200ms 起、每位多停 45ms', () => {
    expect(MAGIC_SPIN_MS).toBe(200);
    expect(MAGIC_SPIN_SLOW).toBe(45);
    expect(magicSpinStart(3, 0)).toMatchObject({ step: 0, wait: 200, option: 3 });
  });

  it('★ 没到时间不动', () => {
    const s = magicSpinStart(5, 0);
    expect(magicSpinTick(s, 5, 199)).toBe(s);
    expect(magicSpinTick(s, 5, 199).step).toBe(0);
  });

  it('★ 转两圈（24 位）最后停在目标上，每一位往后挪一格', () => {
    const total = magicSpinSteps();
    expect(total).toBe(MAGIC_SECTOR_COUNT * 2);
    let s = magicSpinStart(9, 0);
    let now = 0;
    const visited: number[] = [];
    for (let i = 0; i < 60 && !magicSpinDone(s); i++) {
      now += 2000;
      s = magicSpinTick(s, 9, now);
      visited.push(s.option);
    }
    expect(magicSpinDone(s)).toBe(true);
    expect(s.step).toBe(total);
    expect(s.option).toBe(9);
    expect(visited.slice(0, -1)).toEqual(
      Array.from({ length: total - 1 }, (_, i) => (9 + 1 + i) % MAGIC_SECTOR_COUNT),
    );
    expect(new Set(visited).size).toBe(MAGIC_SECTOR_COUNT);
  });

  it('★ 到位后再 tick 还是停在目标上', () => {
    let s = magicSpinStart(0, 0);
    for (let i = 0; i < 60; i++) s = magicSpinTick(s, 0, i * 1000);
    expect(s.option).toBe(0);
    expect(magicSpinTick(s, 0, 99999).option).toBe(0);
  });
});

describe('★ 入口台詞那一拍：绘制（Q-ANIM-1 / D-MAGIC-12）', () => {
  const view = fakeView;

  it('★ 台詞那一拍画**图 8 字框**在 (320,384)，并把那两句写进框里', () => {
    const f = fakeGreetCtx();
    drawMagicScreen(f.ctx, f.sprite, {
      view, pointer: 4, witchBlink: false, beat: 1, hover: 0, ring: -1, greet: 0,
      eyesShut: false,          // ★ 入口三句那几拍原版还没到状态 3，女巫不闭眼
      boxLine: MAGIC_GREET_LINES[0] ?? null,
    });
    const box = f.images.find((i) => i.chunk === MAGIC_MSG_BOX.chunk);
    expect(box).toMatchObject({ x: MAGIC_MSG_BOX.x, y: MAGIC_MSG_BOX.y });
    // 第 0 句是两行（`\n` 拆开、`#0037` 前缀去掉）
    expect(f.texts).toEqual(['進來魔法屋，就得', '完全照我的指示！']);
  });

  it('★ 不是台詞那一拍（greet = null / beat 1）不画那只框 —— 不会与结果条撞车', () => {
    const f = fakeGreetCtx();
    drawMagicScreen(f.ctx, f.sprite, {
      view, pointer: 4, witchBlink: false, beat: 1, hover: 0, ring: -1, greet: null,
      eyesShut: true,           // 过了入口 = 状态 3 起，闭眼贴片在
      boxLine: null,
    });
    expect(f.images.some((i) => i.chunk === MAGIC_MSG_BOX.chunk)).toBe(false);
  });
});

describe('★ 入口台詞那一拍：时序（Q-ANIM-1 / D-MAGIC-12）', () => {
  it('★ 三句台詞、每句停 2000 ms —— 与 `fcn_0044ee18` 的 `cmp eax, 0x7d0` 同数', () => {
    expect(MAGIC_GREET_MS).toBe(0x7d0);
    expect(MAGIC_GREET_MS).toBe(2000);
    expect(MAGIC_GREET_LINES).toHaveLength(3);
    // 串表指针 0x475694 / 0x475698 / 0x47569c，逐个 dump
    expect(MAGIC_GREET_LINES[0]).toBe('#0037進來魔法屋，就得\n完全照我的指示！');
    expect(MAGIC_GREET_LINES[1]).toBe('#0038我選出符合條件的人。');
    expect(MAGIC_GREET_LINES[2]).toBe('#0039你來決定他們的命運～');
  });

  it('★ 字框 = 图 8 落 (320,384)、20 号、`#e0e0e0`/`#202020` 描边 3', () => {
    // @source 0x00432596 那一段 `push 0x202020 / 0xe0e0e0 / 0 / 0 / 0x180 / 0x140 / [0x48c398]+0x6c`
    expect(MAGIC_MSG_BOX.chunk).toBe(8);
    expect(MAGIC_MSG_BOX.chunk).toBe(MAGIC_CHUNK.resultBar);
    expect(MAGIC_MSG_BOX.x).toBe(0x140);
    expect(MAGIC_MSG_BOX.y).toBe(0x180);
    expect(MAGIC_MSG_BOX.dx).toBe(0);
    expect(MAGIC_MSG_BOX.dy).toBe(0);
    expect(MAGIC_MSG_BOX.fill).toBe('#e0e0e0');
    expect(MAGIC_MSG_BOX.outline).toBe('#202020');
    expect(MAGIC_MSG_BOX.outlineWidth).toBe(3);
    expect(MAGIC_MSG_FONT_SIZE).toBe(0x14);
  });

  it('★ 可见文字去掉 `#NNNN` 前缀（`\n` 留着，画的时候拆行）', () => {
    expect(magicGreetText('#0037進來魔法屋，就得\n完全照我的指示！')).toBe('進來魔法屋，就得\n完全照我的指示！');
    expect(magicGreetText('沒有前綴')).toBe('沒有前綴');
  });

  it('★ 时间轴：台詞 0 → 1 → 2 → **摇签** → **条件名** → spin（每句 2000 ms、摇 10×100 ms）', () => {
    let p = magicPlaybackStart(4, 0, true, '財產最多的人');
    expect(p.phase).toBe('greet');
    expect(p.greet).toBe(0);
    // 差 1 ms 不换句
    p = magicPlaybackTick(p, MAGIC_GREET_MS - 1)!;
    expect(p).toMatchObject({ phase: 'greet', greet: 0 });
    p = magicPlaybackTick(p, MAGIC_GREET_MS)!;
    expect(p).toMatchObject({ phase: 'greet', greet: 1 });
    p = magicPlaybackTick(p, MAGIC_GREET_MS * 2)!;
    expect(p).toMatchObject({ phase: 'greet', greet: 2 });
    // 三句说完 → **摇签那一拍**（原版状态 4），字框仍是最后那句
    p = magicPlaybackTick(p, MAGIC_GREET_MS * 3)!;
    expect(p.phase).toBe('roll');
    expect(magicBoxLineFor(p)).toBe(MAGIC_GREET_LINES[2]);
    // 摇签 10 拍 × 100 ms：差 1 ms 还在摇
    const rollMs = MAGIC_ROLL_TICKS * MAGIC_TIMER_MS;
    expect(MAGIC_ROLL_TICKS).toBe(0xa);
    expect(MAGIC_TIMER_MS).toBe(0x64);
    expect(rollMs).toBe(1000);
    const rollStart = MAGIC_GREET_MS * 3;
    p = magicPlaybackTick(p, rollStart + rollMs - 1)!;
    expect(p.phase).toBe('roll');
    // 摇完 → 状态 5：字框写**抽中的条件名**（只停一拍）
    p = magicPlaybackTick(p, rollStart + rollMs)!;
    expect(p.phase).toBe('criterion');
    expect(magicBoxLineFor(p)).toBe('財產最多的人');
    p = magicPlaybackTick(p, rollStart + rollMs + MAGIC_CRITERION_MS - 1)!;
    expect(p.phase).toBe('criterion');
    // 再一拍 → 状态 6/7：字框换成 `#0040嘿～輪到你了！` 并起转盘
    const spinStart = rollStart + rollMs + MAGIC_CRITERION_MS;
    p = magicPlaybackTick(p, spinStart)!;
    expect(p.phase).toBe('spin');
    expect(magicBoxLineFor(p)).toBe(MAGIC_TURN_LINE);
    // 起转盘的节拍从**这一刻**算，不是从开屏算
    expect(p.spin.at).toBe(spinStart);
    expect(MAGIC_TURN_LINE).toBe('#0040嘿～輪到你了！');
  });

  it('★★ `greet = false`（「動畫過程」关掉）：三句不说，但**摇签那一拍照走**（只摇 1 拍）', () => {
    const p = magicPlaybackStart(4, 0, false, '土地最多的人');
    // @source `loc_00432951`：关掉时 `[0x48c3a1] = 1` ⇒ 只摇 1 拍
    expect(p.phase).toBe('roll');
    expect(p.rollTicks).toBe(MAGIC_ROLL_TICKS_FAST);
    expect(MAGIC_ROLL_TICKS_FAST).toBe(1);
    expect(p.spin.at).toBe(0);
    // 1 拍之后就到了条件名那一拍
    const q = magicPlaybackTick(p, MAGIC_TIMER_MS)!;
    expect(q.phase).toBe('criterion');
    expect(magicBoxLineFor(q)).toBe('土地最多的人');
  });

  it('★ 结果那一拍的台词 = `#0041天靈靈地靈靈～`', () => {
    let p = magicPlaybackStart(4, 0, false, '現金最多的人');
    let now = 0;
    for (let i = 0; i < 80 && p.phase !== 'hold'; i++) {
      now += 1000;
      p = magicPlaybackTick(p, now)!;
    }
    expect(p.phase).toBe('hold');
    expect(magicBoxLineFor(p)).toBe(MAGIC_SPELL_LINE);
    expect(MAGIC_SPELL_LINE).toBe('#0041天靈靈地靈靈～');
  });
});

describe('★★ core 交出来的那一趟优先（D-MAGIC-1 的近似收口）', () => {
  it('★★ `magicViewOfSpin`：条件号 → 条件名、`id` → 功能名，名单原样', () => {
    const v = magicViewOfSpin({ id: 4, criterion: 7, targets: [1, 3] }, 2);
    expect(v).not.toBeNull();
    expect(v!.caster).toBe(2);
    expect(v!.option).toBe(4);
    expect(v!.name).toBe(MAGIC_HOUSE_OPTIONS[4]?.name ?? '');
    expect(v!.criterion).toBe(7);
    expect(v!.criterionName).toBe(MAGIC_TARGET_NAMES[7] ?? '');
    expect(v!.targets).toEqual([1, 3]);
  });

  it('★ 缺条件号 / 越界 → `null`（调用方退回 diff 反推）', () => {
    expect(magicViewOfSpin({ id: 4 }, 0)).toBeNull();
    expect(magicViewOfSpin({ id: 4, criterion: -1, targets: [] }, 0)).toBeNull();
    expect(magicViewOfSpin({ id: 4, criterion: 12, targets: [] }, 0)).toBeNull();
  });

});

describe('回放生命周期', () => {
  it('★ 转完进 hold、再停 1.5 秒才该关屏', () => {
    expect(MAGIC_HOLD_MS).toBe(1500);
    // 这一段只看**转盘 → hold → 关屏**，故跳过入口台詞（那一拍另有专门用例）
    let p = magicPlaybackStart(4, 0, false);
    let now = 0;
    // 先走过「摇签 → 条件名」两拍（各一拍 100 ms）
    while (p.phase !== 'spin') {
      now += 1000;
      p = magicPlaybackTick(p, now)!;
    }
    for (let i = 0; i < 80 && p.phase === 'spin'; i++) {
      now += 1000;
      const next = magicPlaybackTick(p, now);
      expect(next).not.toBeNull();
      p = next!;
    }
    expect(p.phase).toBe('hold');
    expect(magicPlaybackTick(p, now + MAGIC_HOLD_MS - 1)).not.toBeNull();
    expect(magicPlaybackTick(p, now + MAGIC_HOLD_MS)).toBeNull();
  });
});

// ============================================================
//  从状态 diff 反推落点（end-to-end，用真地图）
// ============================================================

const MAP_PATH = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const runMap = existsSync(MAP_PATH) ? it : it.skip;

function load(): { map: ReturnType<typeof parseMap>; topo: MapTopology } {
  const map = parseMap(new Uint8Array(readFileSync(MAP_PATH)));
  return { map, topo: { nodes: map.nodes, lands: map.lands, facilities: map.facilities } };
}

function standOnMagic(s: GameState, topo: MapTopology): GameState | null {
  const node = topo.nodes.find((n) => n.specialKind === SPECIAL_KIND.MAGIC_HOUSE);
  if (node === undefined) return null;
  return {
    ...s,
    players: s.players.map((p, i) => (i === s.currentPlayer ? { ...p, nodeId: node.id } : p)),
    phase: 'settling' as const,
  };
}

describe('★ trigger 判据：站在魔法屋上才算 @source VA 0x0043381b', () => {
  runMap('★★ `event()` 认 core 那条通道：`lastEvent.kind === \'magicHouse\'` 就起播', () => {
    const { map, topo } = load();
    const base = standOnMagic(
      newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })) }),
      topo,
    );
    if (base === null) return;
    resetMagicScreen();
    const before = base;
    const after: GameState = {
      ...base,
      lastEvent: { kind: 'magicHouse', id: 3, criterion: 5, targets: [0] },
    };
    const env = {
      screen: 'game',
      state: after,
      topo,
      map,
      now: 0,
      stage: null,
      sprite: () => null,
      flic: () => null,
      dispatch: () => undefined,
      requestRender: () => undefined,
      log: () => undefined,
      playEffect: () => undefined,
      stopEffect: () => undefined,
      animation: true,
    } as unknown as Parameters<NonNullable<typeof magicScreen.event>>[2];
    magicScreen.event!(before, after, env);
    const st = magicScreenState();
    expect(st.playing).toBe(true);
    // ★ 条件号来自 core（不是从 diff 反推）
    expect(st.view?.criterion).toBe(5);
    expect(st.view?.criterionName).toBe(MAGIC_TARGET_NAMES[5] ?? '');
    expect(st.view?.name).toBe(MAGIC_HOUSE_OPTIONS[3]?.name ?? '');
    resetMagicScreen();
  });

  runMap('★★★ 进过一次之后**不许再自己起播**：`lastEvent` 没换、人还站在魔法屋上，后续 action 一律不触发（试玩回报 #12）', () => {
    const { map, topo } = load();
    const base = standOnMagic(
      newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })) }),
      topo,
    );
    if (base === null) return;
    const envOf = (state: GameState) =>
      ({
        screen: 'game', state, topo, map, now: 0, stage: null,
        sprite: () => null, flic: () => null, dispatch: () => undefined,
        requestRender: () => undefined, log: () => undefined,
        playEffect: () => undefined, stopEffect: () => undefined, animation: true,
      }) as unknown as Parameters<NonNullable<typeof magicScreen.event>>[2];

    // 第一趟：settle 写出一条新的 lastEvent ⇒ 起播
    const spun: GameState = {
      ...base,
      phase: 'turnEnd',
      lastEvent: { kind: 'magicHouse', id: 3, criterion: 5, targets: [0] },
    };
    resetMagicScreen();
    magicScreen.event!(base, spun, envOf(spun));
    expect(magicScreenState().playing).toBe(true);
    resetMagicScreen(); // = 这一段演完收屏了

    // 之后的每一条 action：`lastEvent` 还是**同一个对象**、人还站在魔法屋那一格
    //   —— endTurn / 别人 startTurn / 自己下一回合的 startTurn、rollDice……都不许再起播
    for (const phase of ['turnStart', 'awaitingRoll', 'moving', 'turnEnd'] as const) {
      const before: GameState = { ...spun, phase };
      const after: GameState = { ...before, turnCount: before.turnCount + 1 };
      magicScreen.event!(before, after, envOf(after));
      expect(magicScreenState().playing, `phase=${phase} 不该再起播`).toBe(false);
    }
    resetMagicScreen();
  });

  runMap('★ 站在魔法屋上且名单只有自己之外的一个人 → 认出来', () => {
    const { map, topo } = load();
    const base = standOnMagic(
      newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })) }),
      topo,
    );
    if (base === null) return;
    // 把 1 号的现金做成全场最多，好让「現金最多的人」这一条筛出他
    const s: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 1 ? { ...p, cash: 999999 } : p)),
    };
    const after: GameState = { ...s, phase: 'turnEnd' };

    // 站对了 → magicView 不返回 null（落点可能解不出，但演出必须起）
    const v = magicView(s, after, topo);
    expect(v).not.toBeNull();
    expect(v?.caster).toBe(s.currentPlayer);
  });

  runMap('★ 没站在魔法屋上 → 一次都不起播', () => {
    const { map, topo } = load();
    const s = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    const other = topo.nodes.find((n) => n.specialKind !== SPECIAL_KIND.MAGIC_HOUSE);
    if (other === undefined) return;
    const moved: GameState = {
      ...s,
      players: s.players.map((p, i) => (i === s.currentPlayer ? { ...p, nodeId: other.id } : p)),
      phase: 'settling',
    };
    expect(magicView(moved, { ...moved, phase: 'turnEnd' }, topo)).toBeNull();
  });

  runMap('★ 端到端：reduce 落一次魔法屋，屏能从 diff 认出「得一張卡片」这一手', () => {
    const { map, topo } = load();
    const base = standOnMagic(
      newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })) }),
      topo,
    );
    if (base === null) return;

    // 只留 0 号一个人在场（其余破产），这样名单必然是他自己 →
    // 效果被强制成「得一張卡片」；再把他的手牌清空，diff 就一定解释得通。
    const solo: GameState = {
      ...base,
      players: base.players.map((p, i) => ({
        ...p,
        whoPlays: i === 0 ? p.whoPlays : 0,
        cards: [],
        cash: i === 0 ? 0 : p.cash,
      })),
    };
    const after = reduce(solo, { type: 'settle' }, topo);
    const v = magicView(solo, after, topo);
    expect(v).not.toBeNull();
    // 名单里有自己 → option 固定为 6「得一張卡片」@source VA 0x0043395a
    expect(v?.option).toBe(6);
    expect(v?.name).toBe('得一張卡片');
    expect(v?.targets).toEqual([0]);
  });
});

describe('可转到的功能 @source VA 0x0043396d', () => {
  it('★ 随机只抽得到十个（抽到 6 改成 7）；第 11 条永远转不到', () => {
    expect(MAGIC_SPIN_OPTIONS).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9, 10]);
    expect(MAGIC_SPIN_OPTIONS).not.toContain(6);
    expect(MAGIC_SPIN_OPTIONS).not.toContain(11);
  });

  it('★ 反推时要算上「得一張卡片」—— 名单里有自己时它被直接定死（`mov esi, 6`）', () => {
    expect(MAGIC_REACHABLE_OPTIONS).toContain(6);
    expect(MAGIC_REACHABLE_OPTIONS).not.toContain(11);
    expect([...MAGIC_SPIN_OPTIONS, 6].sort((a, b) => a - b)).toEqual([...MAGIC_REACHABLE_OPTIONS]);
  });
});
