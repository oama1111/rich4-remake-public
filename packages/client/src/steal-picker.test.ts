/*
 * 搶奪卡（13）的选牌窗 —— 几何、命中、选中值与「取消不消耗」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 纯函数那一半（格子几何 / 命中带 / 选中值）在这里钉死；
 * 每个数字都带 @source VA，见 `steal-picker.ts` 的头注释。
 * 屏幕那一半用 `down` / `up` / `contextmenu` 真跑一遍（不需要 canvas）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CardTarget, GameState } from '@rich4/core';
import type { UiScreenEnv } from './ui-screen.ts';
import {
  STEAL_CARD_ID,
  STEAL_GRID,
  STEAL_ORIGIN,
  STEAL_RESOURCE,
  STEAL_SELECT_INSET,
  drawStealPicker,
  hitStealCell,
  needsStealPick,
  openStealPicker,
  resetStealPicker,
  stealCellRect,
  stealEntries,
  stealGridOrigin,
  stealPickAt,
  stealPickAtPoint,
  stealPickerOpen,
  stealPickerScreen,
  stealSelectRect,
  type StealPick,
} from './steal-picker.ts';

// ============================================================
//  替身
// ============================================================

/** 四个玩家；1 号手里两张卡（5、9）、身上两件道具（3、11），2 号空手 */
function fakeState(): GameState {
  const tools = new Array<number>(4 * 15).fill(0);
  tools[1 * 15 + 3] = 1;
  tools[1 * 15 + 11] = 2;
  return {
    players: [
      { index: 0, cards: [13], nodeId: 1, cash: 1000, whoPlays: 1 },
      { index: 1, cards: [5, 9], nodeId: 2, cash: 1000, whoPlays: 1 },
      { index: 2, cards: [], nodeId: 3, cash: 1000, whoPlays: 2 },
      { index: 3, cards: [], nodeId: 4, cash: 1000, whoPlays: 2 },
    ],
    tools,
    currentPlayer: 0,
  } as unknown as GameState;
}

function fakeEnv(state: GameState): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [], facilities: [] } as never,
    map: null as never,
    now: 0,
    stage: null as never,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: () => undefined,
    playEffect: () => undefined,
    stopEffect: () => undefined,
  };
}

/** 舞台坐标：第 `slot` 格的**中心** */
function centreOf(kind: 'cards' | 'tools', slot: number): { x: number; y: number } {
  const r = stealCellRect(kind, slot);
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

// ============================================================
//  几何
// ============================================================

describe('★ 选牌窗的版式 @source fcn_0044192a / fcn_004413ec', () => {
  it('★ 底图 = `Panel.mkf` 11（与自己道具/卡片欄同一张）', () => {
    expect(STEAL_RESOURCE).toBe(0xb);
  });

  it('★★ 两张框的落点：卡片 (14,70)、道具 (14,270)', () => {
    expect(STEAL_ORIGIN.cards).toEqual({ x: 0x0e, y: 0x46 });
    expect(STEAL_ORIGIN.tools).toEqual({ x: 0x0e, y: 0x10e });
  });

  it('★★ 格原点 = 框落点 + (5,5)（与自己道具欄同一相对偏移）', () => {
    // 自己那扇窗：框 (14,130) → 格 (19,135)（`inventory.ts` 的 INV_CELL）
    expect(stealGridOrigin('cards')).toEqual({ x: 0x13, y: 0x4b });
    expect(stealGridOrigin('tools')).toEqual({ x: 0x13, y: 0x113 });
    // 与命中带的下界一致（0x4b / 0x113）
    expect(stealCellRect('cards', 0)).toEqual({ x: 0x13, y: 0x4b, w: 0x50, h: 0x38 });
    expect(stealCellRect('tools', 0)).toEqual({ x: 0x13, y: 0x113, w: 0x50, h: 0x38 });
  });

  it('★ 5 列 3 行：第 14 格在右下角', () => {
    expect(STEAL_GRID).toEqual({ cols: 5, rows: 3, cellW: 0x50, cellH: 0x38 });
    expect(stealCellRect('cards', 4)).toEqual({ x: 0x13 + 4 * 0x50, y: 0x4b, w: 0x50, h: 0x38 });
    expect(stealCellRect('cards', 14)).toEqual({
      x: 0x13 + 4 * 0x50,
      y: 0x4b + 2 * 0x38,
      w: 0x50,
      h: 0x38,
    });
    // 底边正好落在命中带的上界 0x4b + 3*0x38 = 0xf3
    expect(0x4b + 3 * 0x38).toBe(0xf3);
    expect(0x113 + 3 * 0x38).toBe(0x1bb);
  });

  it('★★ 选中框 = 格内缩 1px（VA 0x00441499 起的矩形）', () => {
    const c = stealCellRect('cards', 6);
    const s = stealSelectRect('cards', 6);
    expect(STEAL_SELECT_INSET).toBe(1);
    expect(s).toEqual({ x: c.x + 1, y: c.y + 1, w: c.w - 2, h: c.h - 2 });
  });
});

// ============================================================
//  命中带
// ============================================================

describe('★ 命中带 @source fcn_004413ec 的 0x201 分支', () => {
  it('★★ 两条带的边界是半开区间（0x13 ≤ x < 0x1a3；0x4b ≤ y < 0xf3 / 0x113 ≤ y < 0x1bb）', () => {
    expect(hitStealCell(0x12, 0x80, 'steal')).toBeNull();
    expect(hitStealCell(0x13, 0x80, 'steal')).toEqual({ kind: 'cards', slot: 0 });
    expect(hitStealCell(0x1a2, 0x80, 'steal')).toEqual({ kind: 'cards', slot: 4 });
    expect(hitStealCell(0x1a3, 0x80, 'steal')).toBeNull();
    expect(hitStealCell(0x13, 0x4a, 'steal')).toBeNull();
    expect(hitStealCell(0x13, 0x4b, 'steal')).toEqual({ kind: 'cards', slot: 0 });
    expect(hitStealCell(0x13, 0xf2, 'steal')).toEqual({ kind: 'cards', slot: 10 });
    expect(hitStealCell(0x13, 0xf3, 'steal')).toBeNull();
    // 中间那条缝（卡片带与道具带之间）不属于任何一栏
    expect(hitStealCell(0x13, 0x100, 'steal')).toBeNull();
    expect(hitStealCell(0x13, 0x113, 'steal')).toEqual({ kind: 'tools', slot: 0 });
    expect(hitStealCell(0x13, 0x1ba, 'steal')).toEqual({ kind: 'tools', slot: 10 });
    expect(hitStealCell(0x13, 0x1bb, 'steal')).toBeNull();
  });

  it('★★ 道具带**只有搶奪卡（模式 1）**才认 —— 命運 5（模式 0）只收卡', () => {
    const at = { x: 0x20, y: 0x120 };
    expect(hitStealCell(at.x, at.y, 'steal')).toEqual({ kind: 'tools', slot: 0 });
    expect(hitStealCell(at.x, at.y, 'gift')).toBeNull();
    // 卡片带两模式都认
    expect(hitStealCell(0x20, 0x80, 'gift')).toEqual({ kind: 'cards', slot: 0 });
  });

  it('★ 每一带的 x 都按 0x50 分列、共 5 列', () => {
    for (let col = 0; col < 5; col++) {
      const x = 0x13 + col * 0x50 + 1;
      expect(hitStealCell(x, 0x4b, 'steal')).toEqual({ kind: 'cards', slot: col });
    }
  });
});

// ============================================================
//  选中值
// ============================================================

describe('★ 挑中了什么', () => {
  it('★ 卡片欄按手牌取、道具欄按紧排的道具号取', () => {
    const st = fakeState();
    expect(stealEntries(st, 1, 'cards')).toEqual([
      { slot: 0, id: 5, count: 1 },
      { slot: 1, id: 9, count: 1 },
    ]);
    expect(stealEntries(st, 1, 'tools')).toEqual([
      { slot: 0, id: 3, count: 1 },
      { slot: 1, id: 11, count: 2 },
    ]);
    expect(stealPickAt(st, 1, 'cards', 1)).toEqual({ kind: 'card', id: 9 });
    expect(stealPickAt(st, 1, 'tools', 1)).toEqual({ kind: 'tool', id: 11 });
    // 空格子 → null
    expect(stealPickAt(st, 1, 'cards', 5)).toBeNull();
    expect(stealPickAt(st, 1, 'tools', 5)).toBeNull();
  });

  it('★ 点在哪一欄哪一格 → 哪一件', () => {
    const st = fakeState();
    const c0 = centreOf('cards', 0);
    const t1 = centreOf('tools', 1);
    expect(stealPickAtPoint(st, 1, 'steal', c0.x, c0.y)).toEqual({ kind: 'card', id: 5 });
    expect(stealPickAtPoint(st, 1, 'steal', t1.x, t1.y)).toEqual({ kind: 'tool', id: 11 });
    // 命运 5 那一支看不到道具欄
    expect(stealPickAtPoint(st, 1, 'gift', t1.x, t1.y)).toBeNull();
    // 有格但格子是空的 → null
    const empty = centreOf('cards', 5);
    expect(stealPickAtPoint(st, 1, 'steal', empty.x, empty.y)).toBeNull();
  });
});

// ============================================================
//  该不该开这一窗
// ============================================================

describe('★ 哪张卡打谁才开窗', () => {
  const st = fakeState();
  const asPlayer = (index: number): CardTarget => ({ kind: 'player', index });

  it('★ 只有搶奪卡（13）打**玩家**才开', () => {
    expect(STEAL_CARD_ID).toBe(13);
    expect(needsStealPick(st, 13, asPlayer(1))).toBe(true);
    // 别的卡不开（12 = ？那一类照旧）
    expect(needsStealPick(st, 12, asPlayer(1))).toBe(false);
    // 目标不是玩家不开
    expect(needsStealPick(st, 13, { kind: 'entity', entityId: 1 })).toBe(false);
    expect(needsStealPick(st, 13, { kind: 'none' })).toBe(false);
  });

  it('★ 对方两手空空时不开（原版是空框，点了也没用；core 也会 `nothingToRob`）', () => {
    // 2 号没牌没道具
    expect(needsStealPick(st, 13, asPlayer(2))).toBe(false);
    // 只有卡 → 开
    const onlyCard = { ...st, tools: new Array<number>(4 * 15).fill(0) };
    expect(needsStealPick(onlyCard, 13, asPlayer(1))).toBe(true);
    // 只有道具 → 也开
    const onlyTool = {
      ...st,
      players: st.players.map((p, i) => (i === 1 ? { ...p, cards: [] } : p)),
    };
    expect(needsStealPick(onlyTool, 13, asPlayer(1))).toBe(true);
  });
});

// ============================================================
//  屏幕（真跑一遍 down / up / contextmenu）
// ============================================================

describe('★ 选牌窗那一屏', () => {
  it('★★ 按下选中、抬起交出 —— 按下之后拖到窗外再松手仍然算选中（抬手不重新命中）', () => {
    resetStealPicker();
    const st = fakeState();
    const env = fakeEnv(st);
    const got: (StealPick | null)[] = [];
    openStealPicker(1, 'steal', (p) => got.push(p));
    expect(stealPickerOpen()).toBe(true);
    expect(stealPickerScreen.active(env)).toBe(true);

    const c1 = centreOf('cards', 1); // 9 号卡
    stealPickerScreen.down!(c1.x, c1.y, env);
    // 拖到老远（棋盘那头）再松手
    stealPickerScreen.up!(10, 400, env);
    expect(got).toEqual([{ kind: 'card', id: 9 }]);
    expect(stealPickerOpen()).toBe(false);
    expect(stealPickerScreen.active(env)).toBe(false);
  });

  it('★★ 右键 = 取消：回调收到 `null`（调用方据此**不派 action** ⇒ 卡不消耗）', () => {
    resetStealPicker();
    const env = fakeEnv(fakeState());
    const got: (StealPick | null)[] = [];
    openStealPicker(1, 'steal', (p) => got.push(p));
    stealPickerScreen.contextmenu!(100, 100, env);
    expect(got).toEqual([null]);
    expect(stealPickerOpen()).toBe(false);
  });

  it('★ 按下空格子 / 只按不松手 → 什么都不交，窗还开着', () => {
    resetStealPicker();
    const env = fakeEnv(fakeState());
    const got: (StealPick | null)[] = [];
    openStealPicker(1, 'steal', (p) => got.push(p));
    const empty = centreOf('cards', 5);
    stealPickerScreen.down!(empty.x, empty.y, env);
    stealPickerScreen.up!(empty.x, empty.y, env);
    expect(got).toEqual([]);
    expect(stealPickerOpen()).toBe(true);
    resetStealPicker();
  });

  it('★ 搶奪卡能挑道具、命運 5（gift）挑不到道具', () => {
    const st = fakeState();
    const env = fakeEnv(st);
    const t0 = centreOf('tools', 0); // 3 号道具

    resetStealPicker();
    const a: (StealPick | null)[] = [];
    openStealPicker(1, 'steal', (p) => a.push(p));
    stealPickerScreen.down!(t0.x, t0.y, env);
    stealPickerScreen.up!(t0.x, t0.y, env);
    expect(a).toEqual([{ kind: 'tool', id: 3 }]);

    resetStealPicker();
    const b: (StealPick | null)[] = [];
    openStealPicker(1, 'gift', (p) => b.push(p));
    stealPickerScreen.down!(t0.x, t0.y, env);
    stealPickerScreen.up!(t0.x, t0.y, env);
    expect(b).toEqual([]); // 道具带在 gift 模式下不认
    expect(stealPickerOpen()).toBe(true);
    resetStealPicker();
  });

  it('★ 是**浮窗**（`windowed`）—— 底下照常画棋盘', () => {
    expect(stealPickerScreen.windowed).toBe(true);
    expect(stealPickerScreen.id).toBe('steal-picker');
  });

  it('★★ 宿主那一段真的接上了（源码结构断言，免得改拾取流程时静默掉线）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // 拾到人之后先问 `needsStealPick`，开窗，回调里才派 `useCard`
    expect(src).toContain("if (t.kind === 'player' && needsStealPick(state, source.cardId, t))");
    expect(src).toContain("openStealPicker(t.index, 'steal', (pick) => {");
    expect(src).toContain("if (pick === null) return; // 取消：什么都不派（照抄 exe）");
    expect(src).toContain('steal: pick');
    // 登记表里有这一屏
    const reg = readFileSync(new URL('./screens.ts', import.meta.url), 'utf8');
    expect(reg).toContain('stealPickerScreen,');
  });

  it('★ `draw` 不炸（单测不碰 canvas，给个记数的替身）', () => {
    const st = fakeState();
    const drawn: { x: number; y: number }[] = [];
    const ctx = {
      drawImage: (_b: unknown, x: number, y: number) => drawn.push({ x, y }),
      strokeRect: () => undefined,
      strokeText: () => undefined,
      fillText: () => undefined,
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
      set lineWidth(_v: number) {},
      set strokeStyle(_v: string) {},
      set fillStyle(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    // 底图取不到（`sprite` 恒 null）时也不该抛
    drawStealPicker(ctx, () => null, st, { target: 1, mode: 'steal' }, { select: null });
    drawStealPicker(
      ctx,
      () => null,
      st,
      { target: 1, mode: 'steal' },
      { select: { kind: 'cards', slot: 1 } },
    );
    expect(drawn).toEqual([]);
  });
});
