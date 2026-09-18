/*
 * 魔法屋屏的命中几何、回放帧序与「从状态 diff 反推落点」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编抄（VA 见 `magic-screen.ts` 的注释），把最容易写错的几条钉住：
 *   十二个扇区是 **以 0°/30°/…/330° 为中线的 ±15° 楔形**（不是按图标位置分的）；
 *   半径有**内外两条**：`r < 118` 是中间那块、`r > 241` 谁都不认；
 *   扇区号 = 功能号 + 1；
 *   转盘是「先转两圈、最后一位停在结果上」，停稳后停 1.5 秒关屏。
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
import { MAGIC_HOUSE_OPTIONS } from '@rich4/data';
import {
  MAGIC_AIR_MS,
  MAGIC_CENTER,
  MAGIC_GREET_LINES,
  MAGIC_GREET_MS,
  MAGIC_MSG_BOX,
  MAGIC_MSG_FONT_SIZE,
  magicGreetText,
  MAGIC_CHUNK,
  MAGIC_HIT_CENTER,
  MAGIC_HOLD_MS,
  MAGIC_ICON_STRIDE,
  MAGIC_KEYED,
  MAGIC_INNER_RADIUS,
  MAGIC_OUTER_RADIUS,
  MAGIC_REACHABLE_OPTIONS,
  MAGIC_RESOURCE,
  MAGIC_SECTOR_COUNT,
  MAGIC_SECTOR_HALF_DEG,
  MAGIC_SPIN_MS,
  MAGIC_SPIN_OPTIONS,
  MAGIC_SPIN_SLOW,
  magicAnimationFrame,
  magicFrameAt,
  magicFrameChunk,
  MAGIC_EYES_AT,
  magicIconAngle,
  magicIconAt,
  magicIconChunk,
  magicIconFrameCount,
  magicIconFrame,
  MAGIC_CRITERION_MS,
  MAGIC_ROLL_TICKS,
  MAGIC_ROLL_TICKS_FAST,
  MAGIC_SPELL_LINE,
  MAGIC_TIMER_MS,
  MAGIC_TURN_LINE,
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
  drawMagicScreen,
  type MagicSprite,
  sectorAt,
  MAGIC_MOUTH_AT,
  MAGIC_RESULT_ICON_AT,
  MAGIC_RESULT_ICON_BASE,
  MAGIC_WITCH_BEAT2_AT,
  MAGIC_WITCH_AT,
  MAGIC_RESULT_AT,
} from './magic-screen.ts';

/**
 * 外部审查 B-2 的三条症状：结果字画在框外 / 第二拍空白 / 女巫消失。
 * 这里钉的是**几何不变量**，不是具体像素。
 */
describe('★ B-2 版面订正（2026-09-16）', () => {
  it('★★ 结果字与弹窗框**同点**，且跟着落点的功能走（先前字在框外 107px）', () => {
    for (let option = 0; option < MAGIC_SECTOR_COUNT; option++) {
      const at = magicIconAt(option);
      expect(magicFrameAt(option)).toEqual(at);
      expect(magicTextAt(option)).toEqual(at);
    }
    // 解不出落点时退回五芒星中心（悬停兜底那一支）
    expect(magicTextAt(-1)).toEqual(MAGIC_CENTER);
    // 第 0 个功能的框心确实不在中心 —— 否则「同点」这条断言没有意义
    expect(magicFrameAt(0)).not.toEqual(MAGIC_CENTER);
  });

  it('★★ 女巫的嘴是图 5 那张 60×21，画在 (0x11e,0xd9)；不是图 9/10', () => {
    // 图 9/10 = 指针高亮框（142×120），画在女巫位置上会把她整个盖掉
    expect(MAGIC_CHUNK.mouthTalk).toBe(5);
    expect(MAGIC_CHUNK.hoverFrame).toBe(9);
    expect(MAGIC_CHUNK.hoverFrameAlt).toBe(10);
    expect(MAGIC_CHUNK.mouthTalk).not.toBe(MAGIC_CHUNK.hoverFrame);
    // @source 0x00432b0f：`[0x48c398]+0x48`（= 图 5）贴到 (0x11e, 0xd9)
    //   ★ 第 101 条订正：先前写 (0x11e, 0xdc) —— 那是**图 4**（60×18）那一笔的落点。
    expect(MAGIC_MOUTH_AT).toEqual({ x: 0x11e, y: 0xd9 });
    expect(MAGIC_CHUNK.eyelid).toBe(4);
    expect(MAGIC_EYES_AT).toEqual({ x: 0x11e, y: 0xbc });
    expect(MAGIC_CHUNK.eyesShut).toBe(3);
  });

  it('★★ 两拍各有各的女巫落点，第二拍另有长条结果框', () => {
    expect(MAGIC_WITCH_AT).toEqual({ x: 0x11e, y: 0xd9 }); // 第一拍 @source loc_00432719
    expect(MAGIC_WITCH_BEAT2_AT).toEqual({ x: 0xb6, y: 0x8e }); // 第二拍 @source loc_00432e8e
    expect(MAGIC_WITCH_BEAT2_AT).not.toEqual(MAGIC_WITCH_AT);
    expect(MAGIC_RESULT_AT).toEqual({ x: 0x11e, y: 0xdc });
    expect(MAGIC_CHUNK.resultBar).toBe(8);
  });

  it('★ 结果图标的落点与图号 @source loc_00432719 尾 `0x146 / 0x128` + `option + 0xb`', () => {
    expect(MAGIC_RESULT_ICON_AT).toEqual({ x: 0x146, y: 0x128 });
    expect(MAGIC_RESULT_ICON_BASE).toBe(0x0b);
  });
});

/** 从圆心按角度（度，逆时针，屏幕 y 向下）取一点 */
function at(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.round(MAGIC_CENTER.x + r * Math.cos(rad)),
    y: Math.round(MAGIC_CENTER.y - r * Math.sin(rad)),
  };
}

describe('用到的图 @source magic_house 0x00432511 / 0x00432cfd', () => {
  it('★ 底图与十二个功能图标都在 Panel.mkf 资源 18', () => {
    expect(MAGIC_RESOURCE).toBe(18);
    expect(MAGIC_CHUNK.bg).toBe(0);
    expect(MAGIC_CHUNK.ringFirst).toBe(22);
  });

  it('★ 第 k 个功能的图标 = 图 22+k（相邻两个功能共用一张）@source 0x00432cee', () => {
    expect(magicIconChunk(0)).toBe(22);
    expect(magicIconChunk(1)).toBe(23);
    expect(magicIconChunk(11)).toBe(33);
    // 最后一张是 34 —— 正好是零售包里 #18 的最后一张（共 35 张，0..34）
    expect(magicIconChunk(11) + MAGIC_ICON_STRIDE - 1).toBe(34);
  });

  it('★ 十二个功能图标摆在哪：照 `MAGIC_HOUSE_OPTIONS` 的 x/y（第 101 条整表订正）', () => {
    // @source 0x475718 + 16i 记录 {+0 img, +4 x, +8 y, +12 name}
    //   ★ 先前整表错位一格（用了 0x475724 当基址），十二个图标被旋转了一位
    expect(magicIconAt(0)).toEqual({ x: 208, y: 167 });
    expect(magicIconAt(1)).toEqual({ x: 510, y: 150 });
    expect(magicIconAt(7)).toEqual({ x: 134, y: 318 });
    expect(magicIconAt(11)).toEqual({ x: 122, y: 154 });
  });

  it('★ 指针高亮框的图号**按功能而异**：9/10/7/6 @source 0x00432dc4', () => {
    expect([0, 1, 2, 6, 7, 11].map((i) => magicFrameChunk(i))).toEqual([9, 10, 7, 7, 6, 9]);
    expect(MAGIC_CHUNK.frame).toBe(6);
    expect(MAGIC_CHUNK.frameAlt).toBe(7);
  });
});

describe('抠黑表 @source 逐调用点对照（0x004563f5 不透明 / 0x00456418 抠黑）', () => {
  it('★ 女巫的两张都必须抠黑 —— 不抠就是一块遮住底图的黑矩形', () => {
    // 图 2：284×210、43% 纯黑背景，画在 (317,238)。
    // 原版走 `fcn_00456418`（VA 0x0043259c），浏览器里漏抠已复现过。
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.witchIdle)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.witchIntro)).toBe(true);
    // ★ 2026-09-16 订正（B-2 症状③）：图 9/10 是**悬停弹窗框**，不是女巫的头；
    //   它们仍要抠黑（画在功能名同点），但**绝不能**再画到女巫的位置上。
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.hoverFrame)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.hoverFrameAlt)).toBe(true);
    // ★ 第 101 条订正：图 3/4/5 是**女巫脸上的贴片**（眼睛 60×35 / 眼睑 60×18 / 嘴 60×21），
    //   原版三处都用**不透明** blit（0x4563f5）⇒ **不能**进抠黑表。
    expect(MAGIC_CHUNK.mouthTalk).toBe(MAGIC_CHUNK.mouth);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.eyesShut)).toBe(false);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.eyelid)).toBe(false);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.mouth)).toBe(false);
  });

  it('★ 十二个功能图标（图 22..34）全部抠黑 @source 0x00432d0e', () => {
    for (let k = 0; k < 12; k++) {
      const chunk = magicIconChunk(k);
      expect(chunk).toBeGreaterThanOrEqual(MAGIC_CHUNK.ringFirst);
      expect(MAGIC_KEYED.has(chunk)).toBe(true);
    }
    // 第二张（+1）也在表里
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.ringFirst + 12)).toBe(true);
  });

  it('★ 底图与长条结果框**不抠** —— 原版走的是不透明那支', () => {
    // 底图 0 @source 0x0043256d；长条结果框 8 @source 0x00432a85 起
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.bg)).toBe(false);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.resultBar)).toBe(false);
  });

  it('★ 锦缎框 6/7 抠黑 @source 0x00432cc4', () => {
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.frame)).toBe(true);
    expect(MAGIC_KEYED.has(MAGIC_CHUNK.frameAlt)).toBe(true);
  });

  it('★ 十二个功能的图号一个都不越界（0..34）', () => {
    for (let k = 0; k < 12; k++) {
      expect(magicIconChunk(k)).toBeLessThan(35);
      expect(magicIconChunk(k, 1)).toBeLessThan(35);
    }
  });
});

describe('角度 → 扇区 @source Panel.mkf #19 的掩膜', () => {
  it('★ 圆心在 (320,238)、内外半径 118 / 241', () => {
    expect(MAGIC_CENTER).toEqual({ x: 320, y: 238 });
    expect(MAGIC_INNER_RADIUS).toBe(118);
    expect(MAGIC_OUTER_RADIUS).toBe(241);
    expect(MAGIC_SECTOR_HALF_DEG).toBe(15);
    expect(MAGIC_HIT_CENTER).toBe(13);
  });

  it('★ 十二条：0°→1 号、30°→2 号 …… 330°→12 号', () => {
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const seen: number[] = [];
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const p = at(30 * k, 180);
      seen.push(sectorAt(p.x, p.y));
    }
    expect(seen).toEqual(expected);
  });

  it('★ 每条楔形的中线与两侧边界：中线 ±14° 都算自己，±16° 就换人', () => {
    for (let k = 0; k < MAGIC_SECTOR_COUNT; k++) {
      const mid = 30 * k;
      const self = k + 1;
      // 角度顺时针增大（屏幕 y 向下），故 +16° 是「下一格」、−16° 是「上一格」
      const next = (k + 1) % MAGIC_SECTOR_COUNT + 1;
      const prev = (k + MAGIC_SECTOR_COUNT - 1) % MAGIC_SECTOR_COUNT + 1;
      const a = at(mid + 14, 200);
      const b = at(mid - 14, 200);
      const c = at(mid + 16, 200);
      const d = at(mid - 16, 200);
      expect(sectorAt(a.x, a.y)).toBe(self);
      expect(sectorAt(b.x, b.y)).toBe(self);
      expect(sectorAt(c.x, c.y)).toBe(next);
      expect(sectorAt(d.x, d.y)).toBe(prev);
    }
  });

  it('★ 半径边界：内圈算中间那块、外圈谁都不认', () => {
    // 中间
    expect(sectorAt(MAGIC_CENTER.x, MAGIC_CENTER.y)).toBe(MAGIC_HIT_CENTER);
    expect(sectorAt(MAGIC_CENTER.x + 117, MAGIC_CENTER.y)).toBe(MAGIC_HIT_CENTER);
    // 118 起就进楔形（0° 那一格 = 1 号）
    expect(sectorAt(MAGIC_CENTER.x + MAGIC_INNER_RADIUS, MAGIC_CENTER.y)).toBe(1);
    expect(sectorAt(MAGIC_CENTER.x - MAGIC_INNER_RADIUS, MAGIC_CENTER.y)).toBe(7);
    // 241 是最后一个认的像素
    const out = at(0, MAGIC_OUTER_RADIUS);
    expect(sectorAt(out.x, out.y)).toBe(1);
    expect(sectorAt(MAGIC_CENTER.x + MAGIC_OUTER_RADIUS + 1, MAGIC_CENTER.y)).toBe(0);
  });

  it('★ 四个正方向：右 1、上 4、左 7、下 10', () => {
    const right = at(0, 200);
    const up = at(90, 200);
    const left = at(180, 200);
    const down = at(270, 200);
    expect(sectorAt(right.x, right.y)).toBe(1);
    expect(sectorAt(up.x, up.y)).toBe(4);
    expect(sectorAt(left.x, left.y)).toBe(7);
    expect(sectorAt(down.x, down.y)).toBe(10);
  });

  it('★ 扇区号 = 功能号 + 1；13 / 0 都不是功能', () => {
    expect(optionOfSector(1)).toBe(0);
    expect(optionOfSector(12)).toBe(11);
    expect(optionOfSector(MAGIC_HIT_CENTER)).toBeNull();
    expect(optionOfSector(0)).toBeNull();
  });

  it('★ 图标位置与掩膜的楔形中线不是一回事（表里的角度离 30° 的整数倍 1..10°）', () => {
    // 取证出来的事实：掩膜的十二条楔形中线在 0°/30°/…/330°，
    // 而 `MAGIC_HOUSE_OPTIONS` 那十二个 (x,y) 是另一个坐标系下摆的点，
    // 每个都落在某个 30° 边界的**附近**（差 1..10°）。两者各自独立，
    // 所以**不能**拿「图标在哪个扇区里」去校验命中几何 —— 只能校验半径档位。
    for (let k = 0; k < 10; k++) {
      const p = magicIconAt(k);
      const deg = magicIconAngle(k);
      const off = Math.abs(deg - Math.round(deg / 30) * 30);
      expect(off).toBeLessThan(11);
      // 都在中间那块之外；最远的几个会探到外半径以外（(545,88) 是 270）
      const r = Math.hypot(p.x - MAGIC_CENTER.x, p.y - MAGIC_CENTER.y);
      expect(r).toBeGreaterThan(MAGIC_INNER_RADIUS);
    }
  });
});

describe('图标帧序', () => {
  it('★ 图 22..34 共 13 张，够十二个功能相邻共用（每个功能主图 = 22+k）', () => {
    expect(MAGIC_ICON_STRIDE).toBe(2);
    // 22..34 这 13 张；`frames` 字段（10 7 7 …）与逐张看图的结论对不上，
    // 这里按「每个功能至少一张」读，见 deviations D-MAGIC-3。
    expect(magicIconFrameCount(0)).toBeGreaterThanOrEqual(1);
    for (let k = 0; k < 12; k++) {
      expect(magicIconChunk(k)).toBe(22 + k);
      expect(magicIconChunk(k)).toBeLessThan(35);
    }
  });

  it('★ 两帧的功能轮着翻，一帧的功能永远第 0 张', () => {
    expect(magicIconFrame(0, 0)).toBe(0);
    expect(magicIconFrame(0, 1)).toBe(1);
    expect(magicIconFrame(0, 2)).toBe(0);
    for (let f = 0; f < 5; f++) {
      expect(magicIconFrame(1, f)).toBe(0);
      expect(magicIconFrame(5, f)).toBe(0);
    }
  });

  it('★ 帧计数器按 MAGIC_AIR_MS 走', () => {
    expect(magicAnimationFrame(0)).toBe(0);
    expect(magicAnimationFrame(MAGIC_AIR_MS - 1)).toBe(0);
    expect(magicAnimationFrame(MAGIC_AIR_MS)).toBe(1);
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
    // 每一步的等待都在变长，所以一次跨大一点（但别跨过整段）
    for (let i = 0; i < 60 && !magicSpinDone(s); i++) {
      now += 2000;
      s = magicSpinTick(s, 9, now);
      visited.push(s.option);
    }
    expect(magicSpinDone(s)).toBe(true);
    expect(s.step).toBe(total);
    // 最后一位停在目标上
    expect(s.option).toBe(9);
    // 前面 23 位是「从落点的下一格起转一整圈」
    expect(visited.slice(0, -1)).toEqual(
      Array.from({ length: total - 1 }, (_, i) => (9 + 1 + i) % MAGIC_SECTOR_COUNT),
    );
    // 走过的扇区覆盖全部十二个
    expect(new Set(visited).size).toBe(MAGIC_SECTOR_COUNT);
  });

  it('★ 到位后再 tick 还是停在目标上', () => {
    let s = magicSpinStart(0, 0);
    for (let i = 0; i < 60; i++) s = magicSpinTick(s, 0, i * 1000);
    expect(s.option).toBe(0);
    expect(magicSpinTick(s, 0, 99999).option).toBe(0);
  });
});

// ============================================================
//  入口台詞那一拍：画出来的东西（假 ctx，只记 drawImage / fillText）
// ============================================================

interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  sprite: MagicSprite;
  images: { chunk: number; x: number; y: number }[];
  texts: string[];
}

/** 只认**图号**的假 sprite：每张图都 280×173、锚点 (0,0)，尺寸/锚点按需覆盖 */
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

describe('★ 入口台詞那一拍：绘制（Q-ANIM-1 / D-MAGIC-12）', () => {
  const view = { caster: 0, option: 4, name: '均富', targets: [], criterionName: '', criterion: -1 } as never;

  it('★ 台詞那一拍画**图 8 字框**在 (320,384)，并把那两句写进框里', () => {
    const f = fakeGreetCtx();
    drawMagicScreen(f.ctx, f.sprite, {
      view, pointer: 4, witchBlink: false, beat: 1, hover: 0, frame: 0, greet: 0,
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
      view, pointer: 4, witchBlink: false, beat: 1, hover: 0, frame: 0, greet: null,
      boxLine: null,
    });
    // 图 8 是**结果长条框**，只在第二拍压上去；第一拍不该出现
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

const MAP_PATH = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
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
