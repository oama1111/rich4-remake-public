/*
 * 企鵝挖寶的命中表 `Panel.mkf` #81（gap-audit #19 / D-MINI-2 已解）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版 @source 0x00414aa9..0x00414b2f（`WM_LBUTTONDOWN` 0x201 / 双击 0x203 进这一支）：
 *   `cl = byte [[0x48bd38] + y*640 + x]`（`[0x48bd38]` = `read_mkf(panel, 0x51)` @0x004152af），
 *   `fcn_0041211c(值 % 9, 值 / 9)` —— **像素值就是格号**，无效格（表 0x474d7c 的 `x == 0`）什么都不做。
 *
 * 素材取自打包进 `assets/game/` 的那一份 `Panel.mkf`（走 LFS、网页版经素材闸门下发，
 * 与客户端运行时同一条 `MkfArchive.read` → `readRawBytes`），不落任何派生文件。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MkfArchive } from '@rich4/assets-pipeline';
import { SPECIAL_KIND } from '@rich4/core';
import type { GameState } from '@rich4/core';
import { readRawBytes, type LoadedArchives } from './assets.ts';
import { getPenguinHitMask, resetMinigameBackground, setPenguinHitMask } from './minigame-bg.ts';
import {
  PENGUIN_CELLS,
  PENGUIN_HIT_H,
  PENGUIN_HIT_RES,
  PENGUIN_HIT_W,
  PENGUIN_INTRO_TICKS,
  PENGUIN_TICK_MS,
  PENGUIN_WALK_RES,
  minigameScreen,
  parsePenguinHitMask,
  penguinCellValid,
  penguinCellX,
  penguinCellY,
  penguinClick,
  penguinHitCell,
  penguinHitCellGeometric,
  penguinStart,
} from './minigame-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const PANEL_MKF = fileURLToPath(new URL('../../../assets/game/Panel.mkf', import.meta.url));

let panel: MkfArchive | null = null;
/** 与 `main.ts` 同一条路：`LoadedArchives.get('Panel.mkf')` → `readRawBytes(…, 0x51)` */
function archives(): LoadedArchives {
  panel ??= new MkfArchive(new Uint8Array(readFileSync(PANEL_MKF)));
  const a = panel;
  return { get: () => a };
}
function realMask(): Uint8Array {
  const m = parsePenguinHitMask(readRawBytes(archives(), 'Panel.mkf', PENGUIN_HIT_RES));
  if (m === null) throw new Error('Panel.mkf #81 取不到');
  return m;
}

describe('★ Panel.mkf #81 = 企鵝挖寶命中表 @source 0x0041529e push 0x51 → [0x48bd38]', () => {
  it('资源号 0x51、640×480 每像素 1 字节（无头，正好 307200 字节）', () => {
    expect(PENGUIN_HIT_RES).toBe(81);
    const raw = readRawBytes(archives(), 'Panel.mkf', PENGUIN_HIT_RES);
    expect(raw?.length).toBe(PENGUIN_HIT_W * PENGUIN_HIT_H);
    expect(PENGUIN_HIT_W * PENGUIN_HIT_H).toBe(307200);
  });

  it('★ 像素值只出现 0 与 64 个有效格的格号（冰屋 40 不出现）', () => {
    const mask = realMask();
    const values = new Set(mask);
    const valid = new Set<number>();
    for (let i = 0; i < PENGUIN_CELLS; i++) if (penguinCellValid(i)) valid.add(i);
    expect([...values].sort((a, b) => a - b)).toEqual([0, ...[...valid].sort((a, b) => a - b)]);
    expect(values.has(40)).toBe(false);
  });

  it('★ 每个有效格的格心像素就是它自己的格号', () => {
    const mask = realMask();
    for (let i = 0; i < PENGUIN_CELLS; i++) {
      if (!penguinCellValid(i)) continue;
      expect(penguinHitCell(penguinCellX(i), penguinCellY(i), mask), `格 ${i}`).toBe(i);
    }
  });

  it('长度不足 → 当没有（`null`，退回几何）', () => {
    expect(parsePenguinHitMask(null)).toBeNull();
    expect(parsePenguinHitMask(new Uint8Array(100))).toBeNull();
  });
});

describe('★★ 逐像素命中：按 #81 的值，不是菱形几何 @source 0x00414b06 `mov cl, byte [ecx + ebx]`', () => {
  it('格内采样点（原测试那 15 个点，#81 的原始像素值）', () => {
    const mask = realMask();
    const samples: readonly (readonly [number, number, number])[] = [
      [80, 153, 3],
      [104, 161, 3],
      [128, 129, 4],
      [152, 161, 13],
      [320, 81, 16],
      [320, 100, 16],
      [80, 249, 19],
      [32, 225, 10],
      [100, 320, 36],
      [320, 321, 56],
      [320, 340, 56],
      [560, 297, 77],
      [608, 225, 70],
      [224, 369, 54],
      [416, 369, 74],
    ];
    for (const [x, y, cell] of samples) expect(penguinHitCell(x, y, mask), `(${x},${y})`).toBe(cell);
  });

  /**
   * 几何近似与 #81 **不一致**的边缘点（#81 共 3439 个像素与菱形判定不同）：
   * #81 的菱形是 94×48 的「半像素偏」形状（格 3 占 x∈[33,126]、y∈[129,176]，格心 (80,153)
   * ⇒ 上沿含 −24、下沿只到 +23；左右尖各格不一），菱形公式 `|dx|·24+|dy|·48 ≤ 1152` 两头都对不上。
   */
  const EDGES: readonly (readonly [number, number, number | null, number | null])[] = [
    // [x, y, #81 的真值, 几何近似给的]
    [415, 57, 26, null], //  格 26 (416,81) 的上尖那一行：#81 有，菱形没有
    [223, 57, 6, null], //   格 6 (224,81) 上沿
    [319, 57, 16, null], //  格 16 (320,81) 上沿
    [127, 153, 12, 3], //    格 3 / 格 12 的交界：#81 归下一行的 12，几何归 3
    [127, 249, 28, 19], //   同理（格 28 / 格 19）
    [319, 105, 24, 15], //   格 15 / 格 24 交界
    [271, 225, 39, 30], //   冰屋左上那格 39 / 30 交界
    [321, 201, null, 41], // 冰屋上尖右侧：#81 是 0（冰屋留白），几何判给 41
    [464, 369, null, 74], // 底边右端：#81 是 0，几何判给 74
    [178, 370, null, 54], // 底边外一行：#81 是 0，几何判给 54
  ];

  it('★ 与几何近似不同的边缘点，按 #81 判', () => {
    const mask = realMask();
    for (const [x, y, truth, geo] of EDGES) {
      expect(penguinHitCell(x, y, mask), `#81 (${x},${y})`).toBe(truth);
      // 钉住「这些点确实是几何近似判错的」—— 否则这组测试没意义
      expect(penguinHitCellGeometric(x, y), `几何 (${x},${y})`).toBe(geo);
      expect(truth).not.toBe(geo);
    }
  });

  it('★ 整张图：#81 的每个像素都等于 `penguinHitCell(x, y, mask) ?? 0`', () => {
    const mask = realMask();
    let geoDiff = 0;
    for (let y = 0; y < PENGUIN_HIT_H; y++) {
      for (let x = 0; x < PENGUIN_HIT_W; x++) {
        const v = mask[y * PENGUIN_HIT_W + x] ?? 0;
        const hit = penguinHitCell(x, y, mask) ?? 0;
        if (hit !== v) expect(hit, `(${x},${y})`).toBe(v);
        if ((penguinHitCellGeometric(x, y) ?? 0) !== v) geoDiff++;
      }
    }
    // D-MINI-2 旧近似的误差面积（记录用：若素材或近似变了，这个数会变）
    expect(geoDiff).toBe(3439);
  });

  it('冰屋 / 棋盘外 / 越界都打不中；小数坐标取所在像素', () => {
    const mask = realMask();
    expect(penguinHitCell(320, 225, mask)).toBeNull(); // 冰屋正中：#81 是 0
    expect(penguinHitCell(10, 10, mask)).toBeNull();
    expect(penguinHitCell(600, 460, mask)).toBeNull();
    expect(penguinHitCell(-1, 200, mask)).toBeNull();
    expect(penguinHitCell(640, 200, mask)).toBeNull();
    expect(penguinHitCell(200, 480, mask)).toBeNull();
    // 画布缩放下舞台坐标带小数：(415.9, 57.7) 就是像素 (415, 57)
    expect(penguinHitCell(415.9, 57.7, mask)).toBe(26);
    // 左边一像素 (414.9 → 414, 57) 在 #81 里已经不是 26 了（上尖只有一两个像素宽）
    expect(penguinHitCell(414.9, 57.2, mask)).toBe(mask[57 * PENGUIN_HIT_W + 414] || null);
  });

  it('`penguinClick` 用命中表选目标格；#81 为 0 的地方（几何会判中）点了不动', () => {
    const mask = realMask();
    const st = { ...penguinStart(1), phase: 'play' as const };
    const hit = penguinClick(st, 415, 57, mask);
    expect(hit.target).toBe(26);
    expect(hit.to).not.toBeNull();
    // 几何会判给 41 的冰屋上尖：按 #81 不动
    expect(penguinClick(st, 321, 201, mask)).toBe(st);
    // 退回路径（没素材）仍按几何
    expect(penguinClick(st, 321, 201, null).target).toBe(41);
  });
});

describe('★★ 整屏：down 用 `minigame-bg.ts` 交接的命中表；单机 / 联机玩家本人生效、旁观不动', () => {
  afterEach(() => resetMinigameBackground());

  type Sink = { walk: number; dispatched: unknown[] };
  const mkEnv = (now: number, localSeat: number | undefined, sink: Sink, pending = true): UiScreenEnv => {
    const state = {
      pending: pending ? { kind: 'minigame', game: SPECIAL_KIND.PENGUIN_DIG } : null,
      currentPlayer: 0,
      players: [{ whoPlays: 1, points: 0 }, { whoPlays: 1, points: 0 }],
      day: 1,
      month: 1,
      year: 1,
    } as unknown as GameState;
    return {
      screen: 'game',
      state,
      topo: { nodes: [], lands: [], facilities: [] } as never,
      map: null as never,
      now,
      stage: { drawImage: () => undefined } as unknown as CanvasRenderingContext2D,
      animation: false,
      sprite: (_archive: string, res: number) => {
        if (res === PENGUIN_WALK_RES) sink.walk++;
        return null;
      },
      flic: () => null,
      dispatch: (a) => sink.dispatched.push(a),
      requestRender: () => undefined,
      log: () => undefined,
      playEffect: () => undefined,
      stopEffect: () => undefined,
      ...(localSeat === undefined ? {} : { localSeat }),
    };
  };

  /** 开一局、过入场，停在「可以点」的那一拍；返回当前时间 */
  const openPlay = (seat: number | undefined, sink: Sink): number => {
    minigameScreen.tick!(mkEnv(0, seat, sink, false)); // 清掉上一局
    let now = 1000;
    minigameScreen.tick!(mkEnv(now, seat, sink));
    for (let i = 0; i <= PENGUIN_INTRO_TICKS; i++) minigameScreen.tick!(mkEnv((now += PENGUIN_TICK_MS), seat, sink));
    return now;
  };
  /** 点一下再画一帧：企鵝有没有开走（画走行图 = 接了目标格） */
  const clickWalks = (x: number, y: number, seat: number | undefined): boolean => {
    const sink: Sink = { walk: 0, dispatched: [] };
    const now = openPlay(seat, sink);
    minigameScreen.down!(x, y, mkEnv(now, seat, sink));
    sink.walk = 0;
    minigameScreen.draw(mkEnv(now, seat, sink));
    return sink.walk > 0;
  };

  for (const [name, seat] of [
    ['单机', undefined],
    ['联机·玩家本人', 0],
  ] as const) {
    it(`${name}：#81 判中而几何判空的点能走；#81 判空而几何判中的点不走`, () => {
      setPenguinHitMask(realMask());
      expect(getPenguinHitMask()).not.toBeNull();
      expect(clickWalks(415, 57, seat)).toBe(true); // #81 = 26
      expect(clickWalks(321, 201, seat)).toBe(false); // #81 = 0（几何会给 41）
      expect(clickWalks(penguinCellX(3), penguinCellY(3), seat)).toBe(true);
    });
  }

  it('联机·旁观：点了不算（与有没有命中表无关），也不送分', () => {
    setPenguinHitMask(realMask());
    const sink: Sink = { walk: 0, dispatched: [] };
    const now = openPlay(1, sink);
    minigameScreen.down!(penguinCellX(3), penguinCellY(3), mkEnv(now, 1, sink));
    sink.walk = 0;
    minigameScreen.draw(mkEnv(now, 1, sink));
    expect(sink.walk).toBe(0);
    expect(sink.dispatched).toEqual([]);
  });

  it('`resetMinigameBackground` 一并清掉命中表', () => {
    setPenguinHitMask(new Uint8Array(PENGUIN_HIT_W * PENGUIN_HIT_H));
    resetMinigameBackground();
    expect(getPenguinHitMask()).toBeNull();
  });
});
