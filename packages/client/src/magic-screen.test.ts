/*
 * 魔法屋屏（女巫窗口）的版面表、命中几何、状态机与「真人点一格」的交互
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编/掩膜/素材抄（VA 见 `magic-screen.ts` 的注释）。这里钉的是
 * **改坏了就变红**的那几条不变量：
 *
 *   ① **一圈那十二格的中心 = 表 `0x4756e8`**（不是记录表 `0x475718` 的 x/y）；
 *   ② 十二个中心**各自命中自己那一格**（`sectorAt`），且十二格互不重叠；
 *   ③ 十二个楔形**以 90° 为第一条中线、每 30° 一条、顺时针**（不是以 0° 起）；
 *   ④ 女巫**每一拍只有一只**：状态 1..7 = 图 1 落 (241,140)、状态 8 = 图 2 落 (182,142)；
 *   ⑤ 窗口状态机照 `[0x48c3a2]` 1..8 走；**字框到期就收起**（第十二份回报「文案挡住转盘」）；
 *   ⑥ **效果由真人在状态 7 点定**，关窗时派 `{type:'magicHouse', option}`
 *      （第十二份回报「选所有女生存入现金，金貝貝不受影响」「默认就展示就地拆除房屋」）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import type { Sprite } from './assets.ts';
import { MAGIC_TARGET_NAMES, type Action, type GameState } from '@rich4/core';
import { MAGIC_HOUSE_OPTIONS, parseVoiceCode } from '@rich4/data';
import { setVoiceBusyProbe, setVoiceSink, setVoiceStopper } from './voice-sink.ts';
import {
  MAGIC_CENTER,
  MAGIC_CRITERION_LINES,
  MAGIC_GREET_LINES,
  MAGIC_GREET_MS,
  MAGIC_LINE_MS,
  MAGIC_MSG_BOX,
  MAGIC_MSG_FONT_SIZE,
  magicGreetText,
  MAGIC_CHUNK,
  MAGIC_HIT_CENTER,
  MAGIC_KEYED,
  MAGIC_INNER_RADIUS,
  MAGIC_OUTER_RADIUS,
  MAGIC_RESOURCE,
  MAGIC_RING_AT,
  MAGIC_SECTOR_COUNT,
  MAGIC_SECTOR_HALF_DEG,
  MAGIC_SECTOR1_DEG,
  MAGIC_SOUND_HOVER,
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
  MAGIC_ROLL_TICKS,
  MAGIC_ROLL_TICKS_FAST,
  MAGIC_SPELL_LINE,
  MAGIC_TIMER_MS,
  MAGIC_TURN_LINE,
  MAGIC_TARGET_ICON_BASE,
  magicCriterionLine,
  magicAwaitingPick,
  magicCursor,
  magicHumanPickPoint,
  magicLineExpired,
  magicScreen,
  magicScreenState,
  magicViewOfSpin,
  magicWindowAdvance,
  magicWindowAskCriterion,
  magicWindowOpen,
  magicWindowPick,
  magicWindowResolve,
  magicWindowSkip,
  magicWindowTimer,
  resetMagicScreen,
  magicTextAt,
  optionOfSector,
  hitMagicOption,
  drawMagicScreen,
  type MagicDraw,
  type MagicSprite,
  type MagicWindow,
  sectorAt,
  MAGIC_MOUTH_AT,
  MAGIC_MOUTH_GATE,
  MAGIC_MOUTH_REST_SRC,
  MAGIC_CLOSE_FILM,
  setMagicMouthRand,
  type MagicFacePatch,
  MAGIC_RESULT_ICON_AT,
  MAGIC_RESULT_ICON_BASE,
  MAGIC_WITCH_BEAT2_AT,
  MAGIC_WITCH_HAND_AT,
  MAGIC_WITCH_BALL_AT,
  MAGIC_WITCH_INTRO_AT,
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
//  ③ 绘制：女巫每一拍只有一只 / 字框只在有话时画
// ============================================================

/** 两张女巫的**素材尺寸**（`assets-clean/Panel/0018_001/002.png` 量出来）*/
const WITCH_BALL_SIZE = { w: 165, h: 213 };
const WITCH_HAND_SIZE = { w: 284, h: 210 };
/** 字框（图 8）的素材尺寸与锚点（`assets-clean/manifest.json`：Panel 18 图 8 = 280×173、锚点 (140,86)）*/
const BOX_SIZE = { w: 280, h: 173, ax: 140, ay: 86 };

interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  sprite: MagicSprite;
  images: { chunk: number; x: number; y: number }[];
  texts: string[];
}

/** 只认**图号**的假 sprite：尺寸/锚点按需覆盖，默认 280×173 锚点 (0,0) */
function fakeCtx(over: Record<number, Partial<{ w: number; h: number; ax: number; ay: number }>> = {}): FakeCtx {
  const images: { chunk: number; x: number; y: number }[] = [];
  const texts: string[] = [];
  // 阴影那一遍（第二色 #202020，`font.ts` 的 `drawGdiText`）不记，只记正文
  let fill = '';
  const ctx = {
    save() {}, restore() {},
    drawImage(bitmap: { chunk: number }, x: number, y: number) {
      images.push({ chunk: bitmap.chunk, x, y });
    },
    strokeText(t: string) { void t; },
    fillText(t: string) { if (fill !== '#202020') texts.push(t); },
    beginPath() {}, arc() {}, stroke() {},
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    set lineWidth(_v: number) {}, set strokeStyle(_v: string) {}, set fillStyle(v: string) { fill = v; },
  } as unknown as CanvasRenderingContext2D;
  const sprite: MagicSprite = (_a, _r, chunk) => {
    const o = over[chunk] ?? {};
    return {
      bitmap: { chunk } as unknown as ImageBitmap,
      width: o.w ?? 280,
      height: o.h ?? 173,
      anchorX: o.ax ?? 0,
      anchorY: o.ay ?? 0,
    } as Sprite;
  };
  return { ctx, sprite, images, texts };
}

function drawState(over: Partial<MagicDraw> = {}): FakeCtx {
  const f = fakeCtx({
    [MAGIC_CHUNK.witchIntro]: WITCH_BALL_SIZE,
    [MAGIC_CHUNK.witchIdle]: WITCH_HAND_SIZE,
  });
  drawMagicScreen(f.ctx, f.sprite, {
    state: 7,
    criterion: 5,
    chosen: -1,
    hover: 0,
    boxLine: null,
    ...over,
  });
  return f;
}

const witches = (f: FakeCtx) =>
  f.images.filter((i) => i.chunk === MAGIC_CHUNK.witchIntro || i.chunk === MAGIC_CHUNK.witchIdle);
const ringIcons = (f: FakeCtx) => f.images.filter((i) => i.chunk >= 23 && i.chunk <= 34);
const boxes = (f: FakeCtx) => f.images.filter((i) => i.chunk === MAGIC_MSG_BOX.chunk);

describe('★★ 女巫：每一拍**只有一只**（玩家报的「2 个女巫」）', () => {
  it('★★ 状态 1..7：只画图 1（抱水晶球）落 (241,140)，**不画**图 2', () => {
    for (let state = 1; state <= 7; state++) {
      const f = drawState({ state });
      const w = witches(f);
      expect(w, `状态 ${state}`).toHaveLength(1);
      expect(w[0]!.chunk).toBe(MAGIC_CHUNK.witchIntro);
      expect(w[0]).toMatchObject({ x: 241, y: 140 });
    }
    expect(MAGIC_WITCH_BALL_AT).toEqual({ x: 0xf1, y: 0x8c });
    expect(MAGIC_WITCH_INTRO_AT).toEqual(MAGIC_WITCH_BALL_AT); // 旧名同值
  });

  it('★★ 状态 8（点下去之后）：图 2（抬手）落 (182,142) **抠黑**盖在图 1 上 —— 图 1 仍在底下', () => {
    // @source `loc_00432e8e`：只把悬停弹窗贴回（0x00432f1a），**没有**还原图 1 那块；
    //   图 2 走抠黑那支（0x00432f72 `fcn_00456418`）⇒ 图 2 的透明处露出图 1（两边袖口，约 4170 像素）。
    //   ★ 2026-09-23 订正：先前本条断言「状态 8 不画图 1」，那几块于是露出底图。
    const f = drawState({ state: 8, chosen: 3 });
    const w = witches(f);
    expect(w.map((i) => i.chunk)).toEqual([MAGIC_CHUNK.witchIntro, MAGIC_CHUNK.witchIdle]);
    expect(w[0]).toMatchObject({ x: 241, y: 140 });
    expect(w[1]).toMatchObject({ x: 182, y: 142 });
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.witchIdle)).toBe(true);
    expect(MAGIC_WITCH_HAND_AT).toEqual({ x: 0xb6, y: 0x8e });
    expect(MAGIC_WITCH_BEAT2_AT).toEqual(MAGIC_WITCH_HAND_AT);
  });

  it('★★ 图 2 的框把图 1 的框盖掉 95% 以上（两张叠在同一块脸上）', () => {
    const a = MAGIC_WITCH_BALL_AT;
    const b = MAGIC_WITCH_HAND_AT;
    const ox = Math.max(0, Math.min(a.x + WITCH_BALL_SIZE.w, b.x + WITCH_HAND_SIZE.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + WITCH_BALL_SIZE.h, b.y + WITCH_HAND_SIZE.h) - Math.max(a.y, b.y));
    expect((ox * oy) / (WITCH_BALL_SIZE.w * WITCH_BALL_SIZE.h)).toBeGreaterThan(0.95);
  });

  it('★ 脸上的贴片按先后叠在图 1 上（闭眼 = 图 3、合嘴 = 图 4、张嘴 = 图 5、原嘴 = 图 1 的一块）', () => {
    const f = drawState({ state: 4, face: ['eyes', 'mouthOpen', 'mouthShut'] });
    const patches = f.images.filter((i) => [3, 4, 5].includes(i.chunk));
    expect(patches).toEqual([
      { chunk: MAGIC_CHUNK.eyesShut, x: 0x11e, y: 0xbc },
      { chunk: MAGIC_CHUNK.mouth, x: 0x11e, y: 0xd9 },
      { chunk: MAGIC_CHUNK.eyelid, x: 0x11e, y: 0xdc },
    ]);
    // 贴片在图 1 之后
    expect(f.images.findIndex((i) => i.chunk === MAGIC_CHUNK.witchIntro)).toBeLessThan(f.images.indexOf(patches[0]!));
    // 没有贴片 ⇒ 图 1 原样
    expect(drawState({ state: 4 }).images.filter((i) => [3, 4, 5].includes(i.chunk))).toEqual([]);
    expect(MAGIC_EYES_AT).toEqual({ x: 0x11e, y: 0xbc });
    expect(MAGIC_EYELID_AT).toEqual({ x: 0x11e, y: 0xdc });
    // 原嘴 = 图 1 的 (0x2d,0x4d) 起 60×21 贴回 (0x11e,0xd9)（= 图 1 落 (0xf1,0x8c) 时这块本来的位置）
    expect(MAGIC_MOUTH_REST_SRC).toEqual({ x: 0x2d, y: 0x4d, w: 0x3c, h: 0x15 });
    expect(MAGIC_WITCH_BALL_AT.x + MAGIC_MOUTH_REST_SRC.x).toBe(MAGIC_MOUTH_AT.x);
    expect(MAGIC_WITCH_BALL_AT.y + MAGIC_MOUTH_REST_SRC.y).toBe(MAGIC_MOUTH_AT.y);
  });

  it('★★ 条件图标取 `criterion + 11` 落 (326,296)，状态 5 起才有（`loc_00432719` 才贴）', () => {
    for (let state = 1; state <= 8; state++) {
      const f = drawState({ state, criterion: 7 });
      const icons = f.images.filter((i) => i.chunk >= 11 && i.chunk <= 22);
      if (state < 5) {
        expect(icons, `状态 ${state}`).toHaveLength(0);
        continue;
      }
      expect(icons, `状态 ${state}`).toHaveLength(1);
      expect(icons[0]!.chunk).toBe(MAGIC_RESULT_ICON_BASE + 7);
      expect(icons[0]).toMatchObject({ x: MAGIC_RESULT_ICON_AT.x, y: MAGIC_RESULT_ICON_AT.y });
    }
    expect(MAGIC_RESULT_ICON_AT).toEqual({ x: 0x146, y: 0x128 });
    expect(MAGIC_TARGET_ICON_BASE).toBe(0x0b);
  });
});

describe('★ 一圈里只画**悬停 / 选中的那一格**（其余十一格在底图里）', () => {
  it('★★ 状态 7 悬停第 k 格 ⇒ 只多贴图 `23+k`（落 `MAGIC_RING_AT[k]`）+ 锦缎框 + 功能名', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const f = drawState({ state: 7, hover: k + 1 });
      const icons = ringIcons(f);
      expect(icons, `hover=${k + 1}`).toHaveLength(1);
      expect(icons[0]!.chunk).toBe(23 + k);
      expect(icons[0]).toMatchObject({ x: MAGIC_RING_AT[k]!.x, y: MAGIC_RING_AT[k]!.y });
      const frame = f.images.find((i) => i.chunk === magicFrameChunk(k));
      expect(frame).toMatchObject(magicPopupAt(k));
      expect(f.texts).toContain(MAGIC_HOUSE_OPTIONS[k]!.name);
    }
  });

  it('★★ 没悬停 / 悬停在中央 / 不是状态 7 ⇒ 一张图标、一个弹窗都不贴', () => {
    for (const d of [
      { state: 7, hover: 0 },
      { state: 7, hover: MAGIC_HIT_CENTER },
      { state: 4, hover: 3 },
      { state: 6, hover: 3 },
    ]) {
      const f = drawState(d);
      expect(ringIcons(f), JSON.stringify(d)).toHaveLength(0);
      expect(f.texts, JSON.stringify(d)).toEqual([]);
    }
  });

  it('★ 状态 8：选中那一格的高亮还在（压在抬手女巫底下），悬停弹窗已还原掉', () => {
    const f = drawState({ state: 8, chosen: 4, hover: 5 });
    const icons = ringIcons(f);
    expect(icons).toHaveLength(1);
    expect(icons[0]!.chunk).toBe(23 + 4);
    // 高亮先画、女巫后画（女巫在上）
    const iconAt = f.images.indexOf(icons[0]!);
    const witchAt = f.images.findIndex((i) => i.chunk === MAGIC_CHUNK.witchIdle);
    expect(iconAt).toBeLessThan(witchAt);
    expect(f.images.some((i) => [6, 7, 9, 10].includes(i.chunk))).toBe(false);
  });
});

describe('★★ 字框只在「有话挂着」时画（第十二份回报「魔法屋的文案挡住了最下面的转盘」）', () => {
  it('★★ `boxLine: null` ⇒ 不画图 8、不写字', () => {
    const f = drawState({ state: 7, boxLine: null });
    expect(boxes(f)).toHaveLength(0);
    expect(f.texts).toEqual([]);
  });

  it('★ 有话时画**图 8 字框**在 (320,384)，并把那句写进框里（`#NNNN` 去掉、`\\n` 拆行）', () => {
    const f = drawState({ state: 1, boxLine: MAGIC_GREET_LINES[0] ?? null });
    expect(boxes(f)).toEqual([{ chunk: MAGIC_MSG_BOX.chunk, x: MAGIC_MSG_BOX.x, y: MAGIC_MSG_BOX.y }]);
    expect(f.texts).toEqual(['進來魔法屋，就得', '完全照我的指示！']);
  });

  it('★★ 那只框（280×173，锚点居中）确实盖得住下半圈 —— 所以等玩家点时它**必须**收起', () => {
    // `fcn_0044ec30`：框左上 = (x − 锚点x, y − 锚点y)（0x0044ec61..0x0044ec7b）⇒ (180,298)..(460,471)
    const left = MAGIC_MSG_BOX.x - BOX_SIZE.ax;
    const top = MAGIC_MSG_BOX.y - BOX_SIZE.ay;
    const covered = MAGIC_RING_AT.map((p, k) => ({ k, p })).filter(
      ({ p }) => p.x >= left && p.x <= left + BOX_SIZE.w && p.y >= top && p.y <= top + BOX_SIZE.h,
    );
    // 下半圈五格的中心都在框里：存入所有現金 / 就地加蓋 / 得一張卡片 / 向後轉 / 變賣所有道具
    expect(covered.map(({ k }) => k)).toEqual([4, 5, 6, 7, 8]);
  });
});

// ============================================================
//  ④ 窗口状态机 `[0x48c3a2]`（纯函数）
// ============================================================

/** 一直走定时器，直到状态变成 `state`（或超时）；返回那一刻的窗口与时刻 */
function runUntil(w0: MagicWindow, state: number, from: number, limitMs = 60_000): { w: MagicWindow; t: number } {
  let w: MagicWindow | null = w0;
  let t = from;
  while (w !== null && w.state !== state && t - from < limitMs) {
    t += MAGIC_TIMER_MS;
    w = magicWindowTimer(w, t);
  }
  if (w === null) throw new Error('窗口提前关了');
  return { w, t };
}

describe('★★ 女巫窗口状态机 @source `loc_004326e5` + 跳表 `0x4325a2` + `fcn_0044ee18`', () => {
  it('★ 常量：100 ms 一拍、一句话 2000 ms、摇签 10 / 1 拍', () => {
    expect(MAGIC_TIMER_MS).toBe(0x64);
    expect(MAGIC_LINE_MS).toBe(0x7d0);
    expect(MAGIC_GREET_MS).toBe(MAGIC_LINE_MS);
    expect(MAGIC_ROLL_TICKS).toBe(0xa);
    expect(MAGIC_ROLL_TICKS_FAST).toBe(1);
  });

  it('★ 字框 = 图 8 落 (320,384)、20 号、`#e0e0e0`/`#202020` 描边 3', () => {
    // @source 0x00432596 那一段 `push 0x202020 / 0xe0e0e0 / 0 / 0 / 0x180 / 0x140 / [0x48c398]+0x6c`
    expect(MAGIC_MSG_BOX).toEqual({
      chunk: 8, x: 0x140, y: 0x180, dx: 0, dy: 0, fill: '#e0e0e0', outline: '#202020', outlineWidth: 3,
    });
    expect(MAGIC_MSG_BOX.chunk).toBe(MAGIC_CHUNK.resultBar);
    expect(MAGIC_MSG_FONT_SIZE).toBe(0x14);
  });

  it('★ 串：开场三句 / 輪到你了 / 天靈靈地靈靈 / 十二个条件名（带 `#0046`..`#0057` 语音号）', () => {
    expect(MAGIC_GREET_LINES).toEqual([
      '#0037進來魔法屋，就得\n完全照我的指示！',
      '#0038我選出符合條件的人。',
      '#0039你來決定他們的命運～',
    ]);
    expect(MAGIC_TURN_LINE).toBe('#0040嘿～輪到你了！');
    expect(MAGIC_SPELL_LINE).toBe('#0041天靈靈地靈靈～');
    // @source 串表 0x4756b8 逐个 dump：0x4646cc '#0046財產最多的人' … 0x464786 '#0057所有女生'
    expect(MAGIC_CRITERION_LINES[0]).toBe('#0046財產最多的人');
    expect(MAGIC_CRITERION_LINES[10]).toBe('#0056所有男生');
    expect(MAGIC_CRITERION_LINES[11]).toBe('#0057所有女生');
    for (let i = 0; i < 12; i++) {
      expect(parseVoiceCode(MAGIC_CRITERION_LINES[i]!).voice).toBe(46 + i);
      expect(magicGreetText(magicCriterionLine(i))).toBe(MAGIC_TARGET_NAMES[i]);
    }
    expect(magicCriterionLine(12)).toBe('');
  });

  it('★★ 完整时间轴（动画开）：1 → 2 → 3 →（框收起）4 摇 10 拍 → 5 条件名 → 6 輪到你了 → **7 等点、框收起**', () => {
    let w = magicWindowOpen(11, 0, true);
    expect(w).toMatchObject({ state: 1, line: MAGIC_GREET_LINES[0], quick: false, chosen: -1 });
    // 每句 2000 ms：第 19 拍（1900 ms）还挂着，第 20 拍（2000 ms）换下一句
    let r = runUntil(w, 2, 0);
    expect(r.t).toBe(2000);
    expect(r.w.line).toBe(MAGIC_GREET_LINES[1]);
    r = runUntil(r.w, 3, r.t);
    expect(r.t).toBe(4000);
    expect(r.w.line).toBe(MAGIC_GREET_LINES[2]);
    // 第三句到期 ⇒ 框收起、进状态 4（摇签）
    r = runUntil(r.w, 4, r.t);
    expect(r.t).toBe(6000);
    expect(r.w.line).toBeNull();
    expect(r.w.rollLeft).toBe(MAGIC_ROLL_TICKS);
    // 摇 10 拍 ⇒ 状态 5，字框挂上**条件名**（带语音号）
    r = runUntil(r.w, 5, r.t);
    expect(r.t).toBe(7000);
    expect(r.w.line).toBe('#0057所有女生');
    // 条件名挂满 2000 ms ⇒ 状态 6 + 「輪到你了」
    r = runUntil(r.w, 6, r.t);
    expect(r.t).toBe(9000);
    expect(r.w.line).toBe(MAGIC_TURN_LINE);
    // 再 2000 ms ⇒ 状态 7：**字框收起**（最下面三格露出来），等玩家点
    r = runUntil(r.w, 7, r.t);
    expect(r.t).toBe(11000);
    expect(r.w.line).toBeNull();
    // 状态 7 自己不会往下走（没有自动转盘、没有默认落点）
    w = r.w;
    for (let i = 0; i < 1000; i++) {
      const n = magicWindowTimer(w, r.t + (i + 1) * MAGIC_TIMER_MS);
      expect(n).not.toBeNull();
      w = n!;
    }
    expect(w).toMatchObject({ state: 7, line: null, chosen: -1 });
  });

  it('★★ 「動畫過程」关掉：直接状态 3、三句不说；摇 1 拍；**不说**「輪到你了」', () => {
    const w0 = magicWindowOpen(3, 0, false);
    expect(w0).toMatchObject({ state: 3, line: null, quick: true });
    let r = runUntil(w0, 4, 0);
    expect(r.t).toBe(100);
    expect(r.w.rollLeft).toBe(MAGIC_ROLL_TICKS_FAST);
    r = runUntil(r.w, 5, r.t);
    expect(r.t).toBe(200);
    expect(r.w.line).toBe(magicCriterionLine(3));
    r = runUntil(r.w, 6, r.t);
    expect(r.w.line).toBeNull();
    r = runUntil(r.w, 7, r.t);
    expect(r.w.line).toBeNull();
  });

  it('★★ 开场白里点一下 = 跳过：进状态 3、框立刻收起，之后按「动画关掉」走（0x00432e71 置 `[0x48c3a5] = 1`）', () => {
    const w = magicWindowSkip(magicWindowOpen(0, 0, true));
    expect(w).toMatchObject({ state: 3, line: null, quick: true });
    const r = runUntil(w, 4, 0);
    expect(r.w.rollLeft).toBe(MAGIC_ROLL_TICKS_FAST);
    // 状态 ≥ 3 时再点不算跳过
    expect(magicWindowSkip(r.w)).toBe(r.w);
  });

  it('★★ 状态 7 点中 1..12 格 ⇒ 状态 8 + `#0041`；到期那一拍进**关窗那一段**（`loc_00432a4c`：KillTimer → 影片）', () => {
    const r = runUntil(magicWindowOpen(11, 0, false), 7, 0);
    // 不是状态 7 时点格子不算
    expect(magicWindowPick(magicWindowOpen(11, 0, true), 4, 0).state).toBe(1);
    const w = magicWindowPick(r.w, 4, r.t);
    expect(w).toMatchObject({ state: 8, chosen: 4, line: MAGIC_SPELL_LINE, lineAt: r.t, closing: false });
    expect(magicLineExpired(w, r.t + MAGIC_LINE_MS - 1)).toBe(false);
    let cur: MagicWindow = w;
    let t = r.t;
    while (!cur.closing) {
      t += MAGIC_TIMER_MS;
      cur = magicWindowTimer(cur, t);
    }
    expect(t - r.t).toBe(MAGIC_LINE_MS);
    expect(cur).toMatchObject({ state: 8, chosen: 4, line: null, closing: true });
    // 定时器停了：之后再来 0x113 也不动（KillTimer）
    expect(magicWindowTimer(cur, t + 5000)).toBe(cur);
    expect(magicWindowAdvance(cur, t + 5000)).toBe(cur);
  });

  it('★ 12 格都选得到（含 6「得一張卡片」、11「拍賣當格土地」）；越界不算', () => {
    const r = runUntil(magicWindowOpen(0, 0, false), 7, 0);
    for (let k = 0; k < 12; k++) expect(magicWindowPick(r.w, k, r.t).chosen).toBe(k);
    expect(magicWindowPick(r.w, 12, r.t)).toBe(r.w);
    expect(magicWindowPick(r.w, -1, r.t)).toBe(r.w);
  });

  it('★ 状态 7 点中央（13）⇒ 回状态 6 再报一次条件名，到期又回 7（`loc_00432ff7`）', () => {
    const r = runUntil(magicWindowOpen(9, 0, false), 7, 0);
    const w = magicWindowAskCriterion(r.w, r.t);
    expect(w).toMatchObject({ state: 6, line: magicCriterionLine(9) });
    const back = runUntil(w, 7, r.t);
    expect(back.t - r.t).toBe(MAGIC_LINE_MS);
    expect(back.w.line).toBeNull();
  });

  it('★ 别处答掉（託管 / 联机别家点的）⇒ 任何一拍都直接进状态 8 演「天靈靈地靈靈」', () => {
    const w = magicWindowResolve(magicWindowOpen(2, 0, true), 7, 500);
    expect(w).toMatchObject({ state: 8, chosen: 7, line: MAGIC_SPELL_LINE, lineAt: 500 });
    expect(magicWindowResolve(w, 3, 900)).toBe(w);
  });

  it('★ `magicWindowAdvance` 一次补齐该走的拍子', () => {
    const w = magicWindowOpen(0, 0, false);
    const a = magicWindowAdvance(w, 250);
    expect(a.tickAt).toBe(200);
    expect(a.state).toBe(5);
  });

  it('★★ 一句话挂 **max(2000 ms, 语音时长)**：满 2000 ms 但语音还在响 ⇒ 还挂着（`fcn_0044ee18` 0x0044ee6c `call 0x4544b9`）', () => {
    const w = magicWindowOpen(0, 0, true);
    expect(magicLineExpired(w, MAGIC_LINE_MS, false)).toBe(true);
    expect(magicLineExpired(w, MAGIC_LINE_MS, true)).toBe(false);
    expect(magicLineExpired(w, MAGIC_LINE_MS - 1, false)).toBe(false);
    // 语音一直响到 3300 ms：3300 那一拍之前都不换句；语音停下的那一拍才换
    let cur = w;
    let t = 0;
    while (cur.state === 1) {
      t += MAGIC_TIMER_MS;
      cur = magicWindowTimer(cur, t, { voiceBusy: t < 3300 });
    }
    expect(t).toBe(3300);
    expect(cur.line).toBe(MAGIC_GREET_LINES[1]);
    // 不到 2000 ms 时语音早就停了也不换（下限还是 2000）
    const r = runUntil(cur, 3, t);
    expect(r.t - t).toBe(MAGIC_LINE_MS);
  });
});

// ============================================================
//  ⑤ 屏幕本体：开窗 / 点选 / 关窗派答复
// ============================================================

interface FakeEnv {
  env: Parameters<NonNullable<typeof magicScreen.event>>[2] & { now: number; state: GameState };
  logs: string[];
  effects: number[];
  sent: Action[];
  renders: number;
}

const players = (whoPlays1 = 1) =>
  [
    { index: 0, whoPlays: 1 },
    { index: 1, whoPlays: whoPlays1 },
    { index: 2, whoPlays: 2 },
    { index: 3, whoPlays: 2 },
  ] as unknown as GameState['players'];

function stateOf(pending: GameState['pending'], whoPlays1 = 1, lastEvent: GameState['lastEvent'] = null): GameState {
  return { currentPlayer: 1, players: players(whoPlays1), pending, lastEvent, phase: 'turnEnd' } as unknown as GameState;
}

function fakeEnv(state: GameState, localSeat: number | null = null, animation = true): FakeEnv {
  const logs: string[] = [];
  const effects: number[] = [];
  const sent: Action[] = [];
  const renders = { n: 0 };
  const env = {
    screen: 'game',
    state,
    topo: null,
    map: null,
    now: 0,
    stage: null,
    sprite: () => null,
    flic: () => null,
    dispatch: (a: Action) => { sent.push(a); },
    localSeat,
    requestRender: () => { renders.n++; },
    log: (m: string) => { logs.push(m); },
    playEffect: (id: number) => { effects.push(id); },
    stopEffect: () => undefined,
    animation,
  } as unknown as FakeEnv['env'];
  return { env, logs, effects, sent, get renders() { return renders.n; } } as FakeEnv;
}

const PENDING = { kind: 'magicHouse', criterion: 11, targets: [0] } as const;

/** 挂出 pending ⇒ 开窗；返回 env（`env.state` = 挂着 pending 的那一份）*/
function open(localSeat: number | null = null, animation = true): FakeEnv {
  resetMagicScreen();
  const before = stateOf(null);
  const after = stateOf({ ...PENDING, targets: [...PENDING.targets] });
  const f = fakeEnv(after, localSeat, animation);
  magicScreen.event!(before, after, f.env);
  return f;
}

/** 让屏走到 `now` */
function tickTo(f: FakeEnv, now: number): void {
  f.env.now = now;
  magicScreen.tick!(f.env);
}

/** 从开窗一路走到状态 7（动画关掉 = 最快）*/
function openAtPick(localSeat: number | null = null): FakeEnv {
  const f = open(localSeat, false);
  for (let t = 100; t <= 5000 && magicScreenState().state !== 7; t += 100) tickTo(f, t);
  expect(magicScreenState().state).toBe(7);
  return f;
}

describe('★★ 开窗：`pending{magicHouse}` 挂出来才开（第十二份回报「默认就展示就地拆除房屋」）', () => {
  it('★★ 开窗那一刻：状态 1、只有开场白，**没有任何效果被选中**，日志不报效果名', () => {
    const f = open();
    const st = magicScreenState();
    expect(st).toMatchObject({ playing: true, state: 1, chosen: -1, hover: 0, interactive: true, criterion: 11 });
    expect(st.line).toBe(MAGIC_GREET_LINES[0]);
    expect(f.logs).toEqual(['魔法屋：開屏']);
    for (const o of MAGIC_HOUSE_OPTIONS) expect(f.logs.join('')).not.toContain(o.name);
    resetMagicScreen();
  });

  it('★ 同一份 pending 不重复开；电脑（`whoPlays != 1`）不开', () => {
    const f = open();
    const s = f.env.state;
    magicScreen.event!(s, { ...s, turnCount: 1 } as GameState, f.env);
    expect(f.logs).toEqual(['魔法屋：開屏']);
    resetMagicScreen();
    const cpu = stateOf({ ...PENDING, targets: [0] }, 2);
    const g = fakeEnv(cpu);
    magicScreen.event!(stateOf(null, 2), cpu, g.env);
    expect(magicScreenState().playing).toBe(false);
  });

  it('★ 电脑那一趟 core 当场结算、只写 `lastEvent` —— 不开窗（第十一份回报 #10）', () => {
    resetMagicScreen();
    const after = stateOf(null, 2, { kind: 'magicHouse', id: 3, criterion: 5, targets: [0] });
    const f = fakeEnv(after);
    magicScreen.event!(stateOf(null, 2), after, f.env);
    expect(magicScreenState().playing).toBe(false);
  });

  it('★★ 字框：开场白挂着 → 摇签收起 → 条件名 → 輪到你了 → **等点时收起**', () => {
    const f = open();
    const lines: (string | null)[] = [];
    let last: string | null | undefined;
    for (let t = 100; t <= 12000; t += 100) {
      tickTo(f, t);
      const l = magicScreenState().line;
      if (l !== last) lines.push(l);
      last = l;
    }
    expect(lines).toEqual([
      MAGIC_GREET_LINES[0], MAGIC_GREET_LINES[1], MAGIC_GREET_LINES[2],
      null, '#0057所有女生', MAGIC_TURN_LINE, null,
    ]);
    expect(magicScreenState().state).toBe(7);
    expect(f.logs).toContain('魔法屋：條件 所有女生');
    resetMagicScreen();
  });
});

describe('★★ 点选：效果由真人点定、关窗时交给 core（第十二份回报「选所有女生存入现金，金貝貝不受影响」）', () => {
  it('★★ 回报现场：条件「所有女生」、点「存入所有現金」⇒ 关窗时派 `{type:\'magicHouse\', option: 4}`', () => {
    const f = openAtPick();
    const p = MAGIC_RING_AT[4]!;
    magicScreen.move!(p.x, p.y, f.env);
    expect(magicScreenState().hover).toBe(5);
    magicScreen.down!(p.x, p.y, f.env);
    expect(magicScreenState()).toMatchObject({ state: 8, chosen: 4, line: MAGIC_SPELL_LINE });
    expect(f.logs).toContain(`魔法屋：選定 5（${MAGIC_HOUSE_OPTIONS[4]!.name}）`);
    // 点下去那一拍**还没**派（原版关窗之后才 `call 0x431caa`）
    expect(f.sent).toEqual([]);
    const t0 = f.env.now;
    tickTo(f, t0 + MAGIC_LINE_MS - 100);
    expect(f.sent).toEqual([]);
    tickTo(f, t0 + MAGIC_LINE_MS);
    expect(f.sent).toEqual([{ type: 'magicHouse', option: 4 }]);
    expect(magicScreenState().playing).toBe(false);
    expect(f.logs.at(-1)).toBe('魔法屋：結束');
  });

  it('★★ 十二个中心逐个点：每一格都能选、派出去的就是那一格', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const f = openAtPick();
      const p = MAGIC_RING_AT[k]!;
      magicScreen.down!(p.x, p.y, f.env);
      expect(magicScreenState().chosen, `第 ${k} 格`).toBe(k);
      tickTo(f, f.env.now + MAGIC_LINE_MS);
      expect(f.sent, `第 ${k} 格`).toEqual([{ type: 'magicHouse', option: k }]);
    }
  });

  it('★ 状态 7 之前点格子不算（只有开场白那几拍的「跳过」）', () => {
    const f = open();
    const p = MAGIC_RING_AT[4]!;
    magicScreen.down!(p.x, p.y, f.env);
    expect(f.logs).toContain('魔法屋：跳過開場台詞');
    expect(magicScreenState()).toMatchObject({ state: 3, chosen: -1, line: null });
    magicScreen.down!(p.x, p.y, f.env); // 状态 3：什么都不做
    expect(magicScreenState()).toMatchObject({ state: 3, chosen: -1 });
    resetMagicScreen();
  });

  it('★ 右键在开场白里也是跳过（`loc_00432e64`），之后无效', () => {
    const f = open();
    magicScreen.contextmenu!(0, 0, f.env);
    expect(magicScreenState().state).toBe(3);
    resetMagicScreen();
  });

  it('★ 点中央（13）再报一次条件名；点在不认的地方（0）什么都不做', () => {
    const f = openAtPick();
    magicScreen.down!(5, 5, f.env);
    expect(magicScreenState().state).toBe(7);
    magicScreen.down!(MAGIC_CENTER.x, MAGIC_CENTER.y, f.env);
    expect(magicScreenState()).toMatchObject({ state: 6, line: '#0057所有女生' });
    expect(f.logs).toContain('魔法屋：條件 所有女生');
    resetMagicScreen();
  });

  it('★★ 悬停：只在状态 7 认；换一格响 39（0x00432e42），同一格不重复；0 / 13 不响', () => {
    const f = open();
    const p = MAGIC_RING_AT[2]!;
    magicScreen.move!(p.x, p.y, f.env); // 状态 1：不认
    expect(magicScreenState().hover).toBe(0);
    expect(f.effects).toEqual([]);
    resetMagicScreen();
    const g = openAtPick();
    const before = g.renders;
    magicScreen.move!(p.x, p.y, g.env);
    expect(magicScreenState().hover).toBe(3);
    expect(g.effects).toEqual([MAGIC_SOUND_HOVER]);
    expect(MAGIC_SOUND_HOVER).toBe(0x27);
    expect(g.renders).toBeGreaterThan(before);
    magicScreen.move!(p.x + 1, p.y + 1, g.env);
    expect(g.effects).toHaveLength(1);
    magicScreen.move!(MAGIC_CENTER.x, MAGIC_CENTER.y, g.env);
    expect(g.effects).toHaveLength(1);
    // 点下去**不放音**（`loc_00432e8e` 里没有 play_sound_effect）
    magicScreen.down!(p.x, p.y, g.env);
    expect(g.effects).toHaveLength(1);
    resetMagicScreen();
  });

  it('★ 进状态 7 那一拍按当前鼠标位置补一次悬停（0x00432a0f `GetCursorPos` + `WM_MOUSEMOVE`）', () => {
    const f = open(null, false);
    const p = MAGIC_RING_AT[9]!;
    magicScreen.move!(p.x, p.y, f.env); // 还在状态 3：只记位置
    for (let t = 100; t <= 5000 && magicScreenState().state !== 7; t += 100) tickTo(f, t);
    expect(magicScreenState().hover).toBe(10);
    resetMagicScreen();
  });

  it('★★ 只有状态 7 算「等点」（联机收件箱据此放行，否则别家的答复进不来 ⇒ 死锁）', () => {
    open();
    expect(magicAwaitingPick()).toBe(false);
    resetMagicScreen();
    const g = openAtPick(0);
    expect(magicAwaitingPick()).toBe(true);
    magicScreen.down!(MAGIC_CENTER.x, MAGIC_CENTER.y, g.env); // 状态 6：又在演
    expect(magicAwaitingPick()).toBe(false);
    resetMagicScreen();
    expect(magicAwaitingPick()).toBe(false);
  });

  it('★ `magicHumanPickPoint`：只在状态 7、且本机能点时给出一格', () => {
    open();
    expect(magicHumanPickPoint()).toBeNull();
    resetMagicScreen();
    openAtPick();
    expect(magicHumanPickPoint()).toEqual(magicRingAt(7));
    resetMagicScreen();
  });
});

describe('★ 联机 / 託管：别处答掉就只演、不再派', () => {
  it('★★ 联机里不是自己的魔法屋：能看不能点', () => {
    const f = openAtPick(0); // 本机坐 0 号，触发者是 1 号
    expect(magicScreenState().interactive).toBe(false);
    const p = MAGIC_RING_AT[4]!;
    magicScreen.down!(p.x, p.y, f.env);
    expect(magicScreenState()).toMatchObject({ state: 7, chosen: -1 });
    expect(magicHumanPickPoint()).toBeNull();
    resetMagicScreen();
  });

  it('★★ 那一端点定了（pending 没了、`lastEvent` 是这一趟）⇒ 演状态 8 并高亮那一格，关窗时**不派**', () => {
    const f = openAtPick(0);
    const before = f.env.state;
    const after = stateOf(null, 1, { kind: 'magicHouse', id: 4, criterion: 11, targets: [0] });
    f.env.state = after;
    magicScreen.event!(before, after, f.env);
    expect(magicScreenState()).toMatchObject({ state: 8, chosen: 4, resolved: true, line: MAGIC_SPELL_LINE });
    tickTo(f, f.env.now + MAGIC_LINE_MS);
    expect(magicScreenState().playing).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it('★ 本机点完、还在念咒时被託管抢答了 ⇒ 关窗时不再重复派', () => {
    const f = openAtPick();
    const p = MAGIC_RING_AT[4]!;
    magicScreen.down!(p.x, p.y, f.env);
    const before = f.env.state;
    const after = stateOf(null, 5, { kind: 'magicHouse', id: 7, criterion: 11, targets: [0] });
    f.env.state = after;
    magicScreen.event!(before, after, f.env);
    tickTo(f, f.env.now + MAGIC_LINE_MS);
    expect(f.sent).toEqual([]);
    expect(magicScreenState().playing).toBe(false);
  });

  it('★ pending 被冲掉却没收到那一拍（重连 / 同步）⇒ tick 兜底收场，不卡在状态 7', () => {
    const f = openAtPick(0);
    f.env.state = stateOf(null);
    tickTo(f, f.env.now + 100);
    expect(magicScreenState()).toMatchObject({ state: 8, chosen: -1, resolved: true });
    tickTo(f, f.env.now + MAGIC_LINE_MS);
    expect(magicScreenState().playing).toBe(false);
    expect(f.sent).toEqual([]);
  });
});

// ============================================================
//  ⑥ 语音：只在「换词那一拍」请求
// ============================================================

describe('★★ 女巫语音：换词那一拍请求一次（绘制链一次都不许请求）', () => {
  const voices: number[] = [];
  function spyOnVoice(): void {
    voices.length = 0;
    setVoiceSink((v) => { voices.push(v); });
  }

  it('★★ 同一句字框画 200 帧：**一次语音请求都没有**', () => {
    spyOnVoice();
    const f = fakeCtx();
    for (let i = 0; i < 200; i++) {
      drawMagicScreen(f.ctx, f.sprite, {
        state: 1, criterion: 0, chosen: -1, hover: 0, boxLine: MAGIC_GREET_LINES[0] ?? null,
      });
    }
    expect(voices).toEqual([]);
    setVoiceSink(null);
  });

  it('★★ 开窗请求 `#0037`；整句停留期间最多两次；换词立刻请求；条件名那句也有语音（#0057）', () => {
    spyOnVoice();
    const f = open();
    expect(voices).toEqual([37]);
    for (let t = 16; t < MAGIC_LINE_MS; t += 16) tickTo(f, t);
    expect(voices).toEqual([37, 37]);
    expect(MAGIC_VOICE_MAX_ASKS).toBe(2);
    expect(MAGIC_VOICE_RETRY_MS).toBe(500);
    tickTo(f, MAGIC_LINE_MS);
    expect(voices.at(-1)).toBe(38);
    for (let t = MAGIC_LINE_MS; t <= 7000; t += 100) tickTo(f, t);
    expect(voices).toContain(57);
    resetMagicScreen();
    setVoiceSink(null);
  });

  it('★ 点下去那一拍请求 `#0041`', () => {
    spyOnVoice();
    const f = openAtPick();
    voices.length = 0;
    const p = MAGIC_RING_AT[1]!;
    magicScreen.down!(p.x, p.y, f.env);
    expect(voices).toEqual([41]);
    resetMagicScreen();
    setVoiceSink(null);
  });
});

// ============================================================
//  ⑦ core 交出来的那一趟 → 名字
// ============================================================

describe('★ `magicViewOfSpin`', () => {
  it('★ 条件号 → 条件名、`id` → 功能名，名单原样；缺条件号 / 越界 → null', () => {
    const v = magicViewOfSpin({ id: 4, criterion: 7, targets: [1, 3] }, 2);
    expect(v).toEqual({
      caster: 2,
      option: 4,
      name: MAGIC_HOUSE_OPTIONS[4]!.name,
      targets: [1, 3],
      criterion: 7,
      criterionName: MAGIC_TARGET_NAMES[7],
    });
    expect(magicViewOfSpin({ id: 4 }, 0)).toBeNull();
    expect(magicViewOfSpin({ id: 4, criterion: 12, targets: [] }, 0)).toBeNull();
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

  it('★ 底图**不抠**（0x0043253b `fcn_004563f5`）；中央木牌（图 8）**抠黑**（`fcn_0044ecb6` 0x0044ed45 `fcn_00456418`）', () => {
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.bg)).toBe(false);
    // ★ 2026-09-23 订正：先前「2% 黑、看不出差别」就沿用不抠 —— 调用点是抠黑那支
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.resultBar)).toBe(true);
  });
});

// ============================================================
//  ⑧ 2026-09-23 再审：摆嘴型 / 闭眼 / 语音计时 / 关窗影片
// ============================================================

/** 一串确定的 `rand()` 返回值（用完就一直给最后一个）*/
function seq(...vals: number[]): () => number {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)]!;
}

describe('★★ 女巫摆嘴型 @source `loc_00432871` / `loc_00432894` / `loc_00432a85`', () => {
  it('★ 门槛：`rand() >> 11` 小于 4 才摆（= 1/4 的拍子）；过了门槛再 `rand() & 1` 选嘴型、`rand() & 7` 定停几拍（0 当 1）', () => {
    expect(MAGIC_MOUTH_GATE).toBe(4);
    const w = magicWindowOpen(0, 0, true); // 状态 1，字框挂着 = 在说话
    // 门槛没过（4 << 11）：不动
    expect(magicWindowTimer(w, 100, { rand: seq(4 << 11) })).toMatchObject({ face: [], mouthHold: 0 });
    // 过了门槛、偶数 ⇒ 图 5 张嘴；停 5 拍
    const a = magicWindowTimer(w, 100, { rand: seq(3 << 11, 2, 5) });
    expect(a).toMatchObject({ face: ['mouthOpen'], mouthHold: 5 });
    // 奇数 ⇒ 图 1 原嘴；`rand()&7 == 0` ⇒ 停 1 拍
    const b = magicWindowTimer(w, 100, { rand: seq(0, 1, 8) });
    expect(b).toMatchObject({ face: ['mouthRest'], mouthHold: 1 });
  });

  it('★★ 嘴型停满那一拍贴**图 4（合嘴）**，之后一直留着；字框收起后也会把没停满的停完', () => {
    let w = magicWindowTimer(magicWindowOpen(0, 0, true), 100, { rand: seq(0, 0, 2) });
    expect(w).toMatchObject({ face: ['mouthOpen'], mouthHold: 2 });
    w = magicWindowTimer(w, 200, { rand: seq(0x7fff) });
    expect(w).toMatchObject({ face: ['mouthOpen'], mouthHold: 1 });
    w = magicWindowTimer(w, 300, { rand: seq(0x7fff) });
    // 图 4（60×18 @ (0x11e,0xdc)）只盖住张嘴那张的下面 18 行 ⇒ 两张都留在列表里
    expect(w).toMatchObject({ face: ['mouthOpen', 'mouthShut'], mouthHold: 0 });
    // 不在说话、也没有没停满的嘴型 ⇒ 一次 rand 都不调
    let calls = 0;
    const quiet = { ...w, line: null };
    magicWindowTimer({ ...quiet, state: 7 }, 400, { rand: () => { calls++; return 0; } });
    expect(calls).toBe(0);
    // 字框收起了但嘴型还没停满 ⇒ 照样倒数、停满贴图 4
    const hold = magicWindowTimer({ ...quiet, state: 7, mouthHold: 1, face: ['mouthRest'] }, 400, { rand: seq(0) });
    expect(hold).toMatchObject({ face: ['mouthRest', 'mouthShut'], mouthHold: 0 });
  });

  it('★ 新嘴型整块盖住旧嘴型（列表里只留还看得见的）；闭眼那张不被去掉', () => {
    const w: MagicWindow = { ...magicWindowOpen(0, 0, true), face: ['eyes', 'mouthOpen', 'mouthShut'] };
    const n = magicWindowTimer(w, 100, { rand: seq(0, 1, 3) });
    expect(n.face).toEqual<MagicFacePatch[]>(['eyes', 'mouthRest']);
  });

  it('★★ 状态 8（抬手）起不再摆嘴型（`0x00432871 cmp [0x48c3a2], 8 / je`）', () => {
    const r = runUntil(magicWindowOpen(0, 0, false), 7, 0);
    const picked = magicWindowPick(r.w, 3, r.t);
    let calls = 0;
    const n = magicWindowTimer(picked, r.t + 100, { rand: () => { calls++; return 0; } });
    expect(calls).toBe(0);
    expect(n.face).toEqual(picked.face);
  });

  it('★★ 闭眼：状态 3 → 4 贴图 3，状态 4 → 5 图 1 整张重贴（贴片全抹掉、眼睛睁开）', () => {
    const quiet = { rand: seq(0x7fff) };
    let w = magicWindowOpen(2, 0, false); // 直接状态 3
    w = magicWindowTimer(w, 100, quiet);
    expect(w).toMatchObject({ state: 4, face: ['eyes'] });
    w = magicWindowTimer(w, 200, quiet);
    expect(w).toMatchObject({ state: 5, face: [] });
  });
});

describe('★★ 开场白跳过时停掉语音（`fcn_0044ee18(1)` → 0x0044ee30 `call 0x454493`）', () => {
  it('★ 左键 / 右键跳过都停语音；状态 ≥ 3 再点不停', () => {
    let stops = 0;
    setVoiceStopper(() => { stops++; });
    const f = open();
    magicScreen.down!(5, 5, f.env);
    expect(stops).toBe(1);
    magicScreen.down!(5, 5, f.env);
    expect(stops).toBe(1);
    resetMagicScreen();
    const g = open();
    magicScreen.contextmenu!(0, 0, g.env);
    expect(stops).toBe(2);
    resetMagicScreen();
    setVoiceStopper(null);
  });
});

describe('★★ 语音还在响 ⇒ 字框不换句（屏幕本体按 `voiceBusy()` 每拍问）', () => {
  it('★ 满 2000 ms、语音还在响 ⇒ 仍是第一句；语音一停那一拍换第二句', () => {
    let busy = true;
    setVoiceBusyProbe(() => busy);
    const f = open();
    for (let t = 100; t <= 3000; t += 100) tickTo(f, t);
    expect(magicScreenState()).toMatchObject({ state: 1, line: MAGIC_GREET_LINES[0] });
    busy = false;
    tickTo(f, 3100);
    expect(magicScreenState()).toMatchObject({ state: 2, line: MAGIC_GREET_LINES[1] });
    resetMagicScreen();
    setVoiceBusyProbe(null);
  });
});

describe('★ 进状态 7 那一拍补发的 `WM_MOUSEMOVE` 与普通移动同一支：格号变了就响 39', () => {
  it('★ 鼠标本来就停在第 k 格上 ⇒ 进状态 7 那一拍高亮它并响一声；停在中央 / 外面不响', () => {
    const f = open(null, false);
    const p = MAGIC_RING_AT[9]!;
    magicScreen.move!(p.x, p.y, f.env);
    for (let t = 100; t <= 5000 && magicScreenState().state !== 7; t += 100) tickTo(f, t);
    expect(magicScreenState().hover).toBe(10);
    expect(f.effects).toEqual([MAGIC_SOUND_HOVER]);
    resetMagicScreen();
    const g = open(null, false);
    magicScreen.move!(MAGIC_CENTER.x, MAGIC_CENTER.y, g.env);
    for (let t = 100; t <= 5000 && magicScreenState().state !== 7; t += 100) tickTo(g, t);
    expect(magicScreenState().hover).toBe(MAGIC_HIT_CENTER);
    expect(g.effects).toEqual([]);
    resetMagicScreen();
  });
});

describe('★★ 关窗影片 `Panel #20`（`loc_00432a4c`，D-MAGIC-15 收口）', () => {
  /** 假影片：`frames` 帧、每帧 `ms` 毫秒 */
  function withFilm(f: FakeEnv, frames = 25, ms = 71): { asked: string[] } {
    const asked: string[] = [];
    const bitmaps = Array.from({ length: frames }, (_, i) => ({ frame: i }) as unknown as ImageBitmap);
    (f.env as unknown as { flic: (a: string, r: number) => unknown }).flic = (a: string, r: number) => {
      asked.push(`${a}#${r}`);
      return { frames: bitmaps, width: 640, height: 480, frameMs: ms, close: () => undefined };
    };
    return { asked };
  }

  it('★ 规格：Panel.mkf #20、25 帧 × 71 ms、落 (0,0)、音效 0x3b、flags 0（打断不了）', () => {
    expect(MAGIC_CLOSE_FILM).toMatchObject({
      archive: 'Panel.mkf', resource: 0x14, frames: 0x19, frameMs: 0x47, width: 640, height: 480,
      x: 0, y: 0, sound: 0x3b, flags: 0,
    });
  });

  const PANEL_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Panel.mkf';
  const runPanel = existsSync(PANEL_MKF) ? it : it.skip;
  runPanel('★ 真值：Panel.mkf #20 的资源头 = 25 帧 × 71 ms、640×480（`+0x06 = 0x19`、`+0x10 = 0x47`）', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(PANEL_MKF)));
    const info = parseFlicInfo(a.read(MAGIC_CLOSE_FILM.resource));
    expect(info).toEqual({
      width: MAGIC_CLOSE_FILM.width,
      height: MAGIC_CLOSE_FILM.height,
      frames: MAGIC_CLOSE_FILM.frames,
      frameMs: MAGIC_CLOSE_FILM.frameMs,
    });
  });

  it('★★ 念完「天靈靈地靈靈」⇒ 播影片（第一帧响 59）⇒ 播完（25×71 ms）才关窗、派答复', () => {
    const f = openAtPick();
    const { asked } = withFilm(f);
    const p = MAGIC_RING_AT[4]!;
    magicScreen.down!(p.x, p.y, f.env);
    const t0 = f.env.now;
    tickTo(f, t0 + MAGIC_LINE_MS);
    expect(magicScreenState()).toMatchObject({ playing: true, state: 8, closing: true, line: null });
    expect(asked).toContain('Panel.mkf#20');
    expect(f.effects.at(-1)).toBe(0x3b);
    expect(f.sent).toEqual([]);
    // 影片期间点击 / 右键都不算（flags 0）
    magicScreen.down!(p.x, p.y, f.env);
    magicScreen.contextmenu!(0, 0, f.env);
    tickTo(f, t0 + MAGIC_LINE_MS + 25 * 71 - 1);
    expect(magicScreenState().playing).toBe(true);
    expect(f.sent).toEqual([]);
    tickTo(f, t0 + MAGIC_LINE_MS + 25 * 71);
    expect(magicScreenState().playing).toBe(false);
    expect(f.sent).toEqual([{ type: 'magicHouse', option: 4 }]);
    expect(f.logs).toContain('魔法屋：關窗影片（25 帧 × 71 ms）');
    expect(f.logs.at(-1)).toBe('魔法屋：結束');
  });

  it('★ 影片不看「動畫過程」（`loc_00432a4c` 里没有 `[0x48c3a5]` 的判断）；别处答掉那一支也照样播', () => {
    const f = openAtPick(0); // 联机旁观
    withFilm(f);
    const before = f.env.state;
    const after = stateOf(null, 1, { kind: 'magicHouse', id: 4, criterion: 11, targets: [0] });
    f.env.state = after;
    magicScreen.event!(before, after, f.env);
    tickTo(f, f.env.now + MAGIC_LINE_MS);
    expect(magicScreenState()).toMatchObject({ playing: true, closing: true });
    tickTo(f, f.env.now + 25 * 71);
    expect(magicScreenState().playing).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it('★ 开窗那一刻就先把影片要起来（原版 `read_mkf(Panel, 0x14)` 在进窗口时，0x0043386d）', () => {
    resetMagicScreen();
    const before = stateOf(null);
    const after = stateOf({ ...PENDING, targets: [...PENDING.targets] });
    const f = fakeEnv(after);
    const { asked } = withFilm(f);
    magicScreen.event!(before, after, f.env);
    expect(asked).toEqual(['Panel.mkf#20']);
    resetMagicScreen();
  });

  it('★ 影片取不到（没有素材 / 还没解好）⇒ 不卡：直接关窗、照样派答复', () => {
    const f = openAtPick();
    const p = MAGIC_RING_AT[2]!;
    magicScreen.down!(p.x, p.y, f.env);
    tickTo(f, f.env.now + MAGIC_LINE_MS);
    expect(magicScreenState().playing).toBe(false);
    expect(f.sent).toEqual([{ type: 'magicHouse', option: 2 }]);
  });
});

describe('★ 摆嘴型的 rand 可替换（单测用）', () => {
  it('★ `setMagicMouthRand` 生效、`null` 还原', () => {
    setMagicMouthRand(seq(0, 0, 3));
    const f = open();
    tickTo(f, 100);
    expect(magicScreenState()).toMatchObject({ face: ['mouthOpen'], mouthHold: 3 });
    resetMagicScreen();
    setMagicMouthRand(null);
  });
});

describe('★ 联机旁观：跟着行动者收场（`fastForward`）', () => {
  it('★ 别人的魔法屋、本台还在开场白 ⇒ 直接关窗、不派 action；随后施法者那条答复施加时不再开窗', () => {
    const f = open(0); // 本机 0 号、施法者 1 号
    expect(magicScreenState()).toMatchObject({ playing: true, state: 1, interactive: false });
    expect(magicScreen.fastForward!(f.env)).toBe(true);
    expect(magicScreenState().playing).toBe(false);
    expect(f.sent).toEqual([]);
    expect(f.logs).toContain('魔法屋：跟著行動者收場');
    // 施法者的 `{type:'magicHouse'}` 到了：pending 撤掉
    const answered = stateOf(null, 1, { kind: 'magicHouse', id: 3 } as GameState['lastEvent']);
    magicScreen.event!(f.env.state, answered, f.env);
    expect(magicScreenState().playing).toBe(false);
  });

  it('★ 已经在演「点完」那一拍（答复到了之后的 hold）⇒ 也收', () => {
    const f = openAtPick(0);
    const answered = stateOf(null, 1, { kind: 'magicHouse', id: 3 } as GameState['lastEvent']);
    magicScreen.event!(f.env.state, answered, f.env);
    expect(magicScreenState()).toMatchObject({ playing: true, resolved: true });
    expect(magicScreenState().state).not.toBe(7);
    expect(magicScreen.fastForward!(f.env)).toBe(true);
    expect(magicScreenState().playing).toBe(false);
  });

  it('★★ 状态 7（等点选）是待决交互，不是演出 ⇒ 不动', () => {
    const f = openAtPick(0);
    expect(magicScreen.fastForward!(f.env)).toBe(false);
    expect(magicScreenState()).toMatchObject({ playing: true, state: 7 });
  });

  it('★★ 本机自己的窗口、效果号还没交出去 ⇒ 不动（关掉就吞了这位真人的点选）', () => {
    const f = open(1); // 本机就是施法者
    expect(magicScreenState().interactive).toBe(true);
    expect(magicScreen.fastForward!(f.env)).toBe(false);
    expect(magicScreenState().playing).toBe(true);
    expect(f.sent).toEqual([]);
  });

  it('没开窗 ⇒ false', () => {
    resetMagicScreen();
    expect(magicScreen.fastForward!(fakeEnv(stateOf(null)).env)).toBe(false);
  });
});

describe('★ 指针：只有等玩家点那一拍有（`fcn_00402460`：0x00432a16 放出、0x00432fd4 收起）', () => {
  it('★ 开窗（开场白）藏；状态 7 放出箭头 0x29；点下去（状态 8）又藏；关窗后也藏（交回棋盘那套判据）', () => {
    const f = open(null, false);
    expect(magicCursor()).toBeNull();
    expect(magicScreen.cursor!(f.env)).toBeNull();
    for (let t = 100; t <= 5000 && magicScreenState().state !== 7; t += 100) tickTo(f, t);
    expect(magicCursor()).toEqual({ shape: { image: 0x29, frames: 1, ticks: 0 } });
    expect(magicScreen.cursor!(f.env)).toEqual(magicCursor());
    const p = MAGIC_RING_AT[3]!;
    magicScreen.down!(p.x, p.y, f.env);
    expect(magicCursor()).toBeNull();
    resetMagicScreen();
    expect(magicCursor()).toBeNull();
  });

  it('★ 联机：本机就是触发者 ⇒ 状态 7 放出箭头；旁观端（触发者是 1 号、本机坐 0 号）一直藏着', () => {
    openAtPick(1);
    expect(magicCursor()).toEqual({ shape: { image: 0x29, frames: 1, ticks: 0 } });
    openAtPick(0);
    expect(magicScreenState().state).toBe(7);
    expect(magicCursor()).toBeNull();
    resetMagicScreen();
  });
});
