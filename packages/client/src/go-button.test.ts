/*
 * GO 鈕的位置与拖动（Q-UI-6）—— 判据全部对着 exe 里的那几行
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 取证见 `go-button.ts` 的模块头。这里只钉三件事：
 *   ① 初值 180/120（屏幕坐标）与画布坐标的换算；
 *   ② 夹取 `[0, 640−w] × [0, 480−h]`（屏幕坐标）—— 图 72×67 ⇒ [0,568]×[0,413]；
 *   ③ 拖动序列「按下 → 移 → 抬起」：位置 = 按下时的鼠标 + 位移，
 *      抬手只结束拖动、位置不动，且**没按下时移动不改位置**。
 */
import { describe, expect, it } from 'vitest';
import {
  boardToScreen,
  clampBoard,
  clampScreen,
  createGoButton,
  dragDelta,
  GO_BOUNDS,
  GO_CANVAS_ORIGIN,
  GO_DEFAULT,
  GO_SIZE,
  pointInGo,
  samePos,
} from './go-button.ts';
import { hitAdvance, hitDiceToggle, diceToggleRect } from './dialog.ts';
import { DICE_TOGGLE_LAYOUT, DICE_TOGGLE_X } from './gameui.ts';

/** 屏幕坐标 → 棋盘画布坐标（= 减画布原点） */
const board = (x: number, y: number) => ({ x: x - GO_CANVAS_ORIGIN.x, y: y - GO_CANVAS_ORIGIN.y });

describe('GO 鈕的初值与坐标空间', () => {
  it('★ 初值 180/120 是**屏幕**坐标 —— @source 数据 `[0x475284]`/`[0x475288]`', () => {
    // dump 0x475284 → 180, 120
    expect(GO_DEFAULT).toEqual({ x: 180, y: 120 });
    expect(GO_SIZE).toEqual({ w: 72, h: 67 });
    expect(GO_BOUNDS).toEqual({ w: 0x280, h: 0x1e0 }); // 640 / 480
    // 本引擎棋盘画布的原点在屏幕 (0,40)（顶部工具栏 40 高）
    expect(GO_CANVAS_ORIGIN).toEqual({ x: 0, y: 40 });
  });

  it('★ 画布坐标 = 屏幕坐标 − (0,40)，来回一致', () => {
    expect(boardToScreen(board(180, 120))).toEqual({ x: 180, y: 120 });
    expect(board(180, 120)).toEqual({ x: 180, y: 80 });
    expect(samePos({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(samePos({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
  });

  it('★ 命中跟着位置走，画的与点的是同一块', () => {
    const pos = board(180, 120); // 画布 (180, 80)
    expect(pointInGo(pos.x, pos.y, pos)).toBe(true); // 左上角含
    expect(pointInGo(pos.x + GO_SIZE.w - 1, pos.y + GO_SIZE.h - 1, pos)).toBe(true); // 右下角含
    expect(pointInGo(pos.x + GO_SIZE.w, pos.y, pos)).toBe(false); // 右边一格不含
    expect(pointInGo(pos.x, pos.y + GO_SIZE.h, pos)).toBe(false);
    expect(hitAdvance(pos.x, pos.y, pos)).toBe(true);
    expect(hitAdvance(pos.x - 1, pos.y, pos)).toBe(false);
    // ★ 拖动之后命中跟着走（不再是固定位置）
    const moved = board(300, 200);
    expect(hitAdvance(pos.x, pos.y, moved)).toBe(false);
    expect(hitAdvance(moved.x, moved.y, moved)).toBe(true);
  });

  it('骰子数切换钮跟着 GO 走 —— @source VA 0x00417309 `x+7 / y+0x1a`（步行支）', () => {
    const pos = board(180, 120);
    // GO 在屏幕 (180,120)（画布 180,80）；切换钮在屏幕 (187,146) → 画布 (187,106)
    expect(diceToggleRect(0, pos, 0)).toEqual({ x: 187, y: 106, w: 15, h: 15 });
    // ★ 步行支只有 1 颗 ⇒ `maxDice` 传 1（`maxDiceOf()` 由交通方式推出，也是 1）
    expect(hitDiceToggle(187, 106, 1, pos, 0)).toBe(1);
    expect(hitDiceToggle(187, 106, 1, board(400, 300), 0)).toBeNull(); // 位置变了就点不着
  });
});

describe('夹取范围（屏幕坐标 [0,640−w]×[0,480−h]）', () => {
  it('★ 上下界 —— @source VA 0x00418ab4 / 0x00418ac0 / 0x00418ad8 / 0x00418ae9', () => {
    // 图 72×67 ⇒ x ∈ [0, 568]、y ∈ [0, 413]；上界是 `jge`，相等也保留
    expect(clampScreen(-5, -5)).toEqual({ x: 0, y: 0 });
    expect(clampScreen(568, 413)).toEqual({ x: 568, y: 413 });
    expect(clampScreen(569, 414)).toEqual({ x: 568, y: 413 });
    expect(clampScreen(1e6, 1e6)).toEqual({ x: 640 - 72, y: 480 - 67 });
    expect(clampScreen(300, 200)).toEqual({ x: 300, y: 200 }); // 界内原样
  });

  it('★ 搬到棋盘画布坐标之后下界是 −40（顶边可以超过画布，与原版一致）', () => {
    // 屏幕 y ∈ [0, 413] ⇒ 画布 y ∈ [−40, 373]
    expect(clampBoard(180, 80)).toEqual({ x: 180, y: 80 });
    // 夹的是屏幕坐标：画布 −100 ⇒ 屏幕 −60 ⇒ 夹回屏幕 0 ⇒ 画布 −40
    expect(clampBoard(180, -100)).toEqual({ x: 180, y: -GO_CANVAS_ORIGIN.y });
    expect(clampBoard(180, 1e6)).toEqual({ x: 180, y: 480 - GO_SIZE.h - GO_CANVAS_ORIGIN.y });
    // 画布 0 ⇒ 屏幕 40，在界内 ⇒ 不夹（所以画布上界确实只有 −40）
    expect(clampBoard(1e6, 0)).toEqual({ x: 640 - GO_SIZE.w, y: 0 });
    expect(clampBoard(0, -GO_CANVAS_ORIGIN.y)).toEqual({ x: 0, y: -GO_CANVAS_ORIGIN.y });
    expect(clampBoard(0, -1e6)).toEqual({ x: 0, y: -GO_CANVAS_ORIGIN.y });
  });

  it('位移就是两点之差 —— @source VA 0x00418a86 `ebx = esi − edi`', () => {
    expect(dragDelta({ x: 100, y: 100 }, { x: 130, y: 90 })).toEqual({ x: 30, y: -10 });
  });
});

describe('拖动序列：按下 → 移 → 抬起', () => {
  it('★ 按下在钮上：进入拖动、位置这一拍不动（原版按下的动作在别处）', () => {
    const go = createGoButton();
    expect(go.dragging()).toBe(false);
    const p = go.position();
    expect(go.press(p.x, p.y, { x: 180, y: 120 })).toBe(true);
    expect(go.dragging()).toBe(true);
    expect(go.position()).toEqual(p);
  });

  it('★ 按下不在钮上：不进入拖动，后面的移动也不改位置', () => {
    const go = createGoButton();
    expect(go.press(500, 300, { x: 500, y: 340 })).toBe(false);
    expect(go.dragging()).toBe(false);
    go.move({ x: 10, y: 10 });
    expect(go.position()).toEqual(board(180, 120));
  });

  it('★ 移一拍就走一拍的位移，并且夹在 640×480 里', () => {
    const go = createGoButton();
    go.press(180, 80, { x: 180, y: 120 });
    go.move({ x: 230, y: 160 }); // 位移 (+50,+40)
    expect(go.position()).toEqual(board(230, 160));
    go.move({ x: 250, y: 170 }); // 再位移 (+20,+10)
    expect(go.position()).toEqual(board(250, 170));
    // 顶到左上：屏幕 (0,0) ⇒ 画布 (0,−40)
    go.move({ x: -1e4, y: -1e4 });
    expect(go.position()).toEqual({ x: 0, y: -GO_CANVAS_ORIGIN.y });
    // 顶到右下：屏幕 (568,413) ⇒ 画布 (568,373)
    go.move({ x: 1e4, y: 1e4 });
    expect(go.position()).toEqual({ x: 640 - GO_SIZE.w, y: 480 - GO_SIZE.h - GO_CANVAS_ORIGIN.y });
  });

  it('★ 抬手只结束拖动，位置留在拖到的地方（原版 `[0x48be2a] = 0`）', () => {
    const go = createGoButton();
    go.press(180, 80, { x: 180, y: 120 });
    go.move({ x: 260, y: 200 });
    const at = go.position();
    go.release();
    expect(go.dragging()).toBe(false);
    expect(go.position()).toEqual(at);
    // 抬起之后再动鼠标不改位置
    go.move({ x: 400, y: 300 });
    expect(go.position()).toEqual(at);
    // 再按还按得到（新位置）
    expect(go.press(at.x, at.y, { x: 260, y: 200 })).toBe(true);
  });

  it('★ 复位回初值并清掉拖动 —— 原版窗口创建时读的就是静态初值', () => {
    const go = createGoButton();
    go.press(180, 80, { x: 180, y: 120 });
    go.move({ x: 400, y: 300 });
    go.reset();
    expect(go.dragging()).toBe(false);
    expect(go.position()).toEqual(board(180, 120));
  });
});

/*
 * ★★ W-65：骰子数切换钮的纵向排布**按交通方式分三支**。
 *
 * 原版 @source `0x004172fb jmp [eax*4 + 0x417181]`（`eax = traffic & 3`，
 * 表 = `[0x417302, 0x417353, 0x417401, 0x417302]`）：
 *   0 步行（1 颗）`dy = 0x1a`；1 機車（2 颗）`dy = 0x10, pitch = 19`；
 *   2 汽車（3 颗）`dy = 9, pitch = 16`；3 与 0 同一支。
 * 先前只有一套 `{dy: 0x1a, pitch: 19}` —— 開汽車时第三颗底边 79 > GO 高 67（冲出 GO）。
 */
describe('★★ W-65 骰子数切换钮按交通方式排布', () => {
  const pos = board(180, 120); // GO 画布左上 (180,80)
  const goY = 80;

  it('★ 三种交通方式的每一颗 y（相对 GO 左上角）逐项等于原版表', () => {
    const want: readonly (readonly [number, number[]])[] = [
      [0, [0x1a]], // 步行：26
      [1, [0x10, 0x10 + 19]], // 機車：16 / 35
      [2, [9, 9 + 16, 9 + 32]], // 汽車：9 / 25 / 41
      [3, [0x1a]], // 3 与 0 同一支
    ];
    for (const [traffic, ys] of want) {
      ys.forEach((dy, i) => {
        expect(diceToggleRect(i, pos, traffic).y - goY, `traffic=${traffic} 第 ${i} 颗`).toBe(dy);
      });
    }
  });

  it('★ 步距也逐支对：步行 0 颗、機車 2 颗、汽車 3 颗', () => {
    expect(DICE_TOGGLE_LAYOUT[0]).toEqual({ dy: 0x1a, pitch: 0 });
    expect(DICE_TOGGLE_LAYOUT[1]).toEqual({ dy: 0x10, pitch: 19 });
    expect(DICE_TOGGLE_LAYOUT[2]).toEqual({ dy: 9, pitch: 16 });
    expect(DICE_TOGGLE_LAYOUT[3]).toEqual(DICE_TOGGLE_LAYOUT[0]);
    // 反证：把它们混成一套（旧实现）时，汽車第三颗会落到 26 + 2×19 = 64
    expect(DICE_TOGGLE_LAYOUT[2]!.dy + 2 * DICE_TOGGLE_LAYOUT[2]!.pitch).not.toBe(64);
  });

  it('★★ 開汽車时第三颗不冲出 GO 鈕（底边 9 + 2×16 + 15 = 56 ≤ 67）', () => {
    const r = diceToggleRect(2, pos, 2);
    expect(r.y - goY).toBe(41);
    expect(r.y - goY + r.h).toBeLessThanOrEqual(GO_SIZE.h); // 56 ≤ 67
    // 反证：旧实现（dy 26 / pitch 19）第三颗底边 79 —— 冲出 GO
    expect(0x1a + 2 * 19 + 15).toBeGreaterThan(GO_SIZE.h);
  });

  it('★ 命中与绘制同一支：三种交通方式各自的每颗中心都命中自己那一号', () => {
    for (const traffic of [0, 1, 2, 3]) {
      const max = [1, 2, 3, 1][traffic]!;
      for (let i = 0; i < max; i++) {
        const r = diceToggleRect(i, pos, traffic);
        expect(hitDiceToggle(r.x + r.w / 2, r.y + r.h / 2, max, pos, traffic)).toBe(i + 1);
      }
    }
  });

  it('★ 横向：亮图 +7、暗图 +8（三支相同）', () => {
    expect(DICE_TOGGLE_X).toEqual({ lit: 7, dim: 8 });
    expect(diceToggleRect(0, pos, 0).x - 180).toBe(7);
  });
});
