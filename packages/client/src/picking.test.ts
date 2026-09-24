/*
 * 目标拾取模式（T-026）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里钉的是**指针形状规则**（原版选目标的唯一反馈）与「候选/命中」这两件
 * 纯计算。候选的**合法性**本身在 core（`preview.ts`），那边有自己的测试。
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology } from '@rich4/core';
import {
  PICK_CLASS,
  PICK_CURSOR_INVALID,
  PICK_EDGE,
  PICK_EDGE_ARROW,
  PICK_SCROLL_DIRS,
  PICK_SCROLL_MAX,
  PICK_SCROLL_MIN,
  PICK_SCROLL_STEP_CAP,
  PICK_SCROLL_STEP_MIN,
  PICK_SCROLL_TICK_MS,
  TOOL_SELECT_PARAM,
  classNeedsItsOwnList,
  hitCandidate,
  pickClasses,
  pickCursorSpec,
  pickEdgeOf,
  pickScrollCamera,
  pickScrollDirIndex,
  pickScrollNextStep,
  startPick,
} from './picking.ts';
import { CARD_CURSOR, cursorImageAt } from './soft-cursor.ts';

describe('指针形状 @source VA 0x445ec1', () => {
  it('★ 形状 = 选择参数的高 16 位（次高字节清掉）—— 所以指针就是那件道具的图标', () => {
    // 路障 `1` → 图 0（STOP 牌子）
    expect(pickCursorSpec(0x1).image).toBe(0);
    // 地雷 `0x10001` → 图 1（尖刺球）
    expect(pickCursorSpec(0x10001).image).toBe(1);
    // 定時炸彈 `0x20001` → 图 2（炸彈）
    expect(pickCursorSpec(0x20001).image).toBe(2);
    // 飛彈 `0x300c0` / 核子飛彈 `0x400c0` → 图 3 / 4
    expect(pickCursorSpec(0x300c0).image).toBe(3);
    expect(pickCursorSpec(0x400c0).image).toBe(4);
    // 各张卡 `0xe0c0XYZ` → 图 12（「卡片」光标）
    expect(pickCursorSpec(0xe0c0202).image).toBe(12);
  });

  it('★ gap-audit #5：`[0x48c58c]` / 0xa 是**帧数 / 每帧几拍**（VA 0x004465d3 `fcn_004021f8(图, 帧数, 0xa)`），不是热点', () => {
    // 道具：高字节 0 ⇒ 1 帧（不动）；每帧 10 拍照传（单帧时不起作用）
    expect(pickCursorSpec(0x1)).toEqual({ image: 0, frames: 1, ticks: 0xa });
    expect(pickCursorSpec(0x10001)).toEqual({ image: 1, frames: 1, ticks: 0xa });
    // 各张卡 `0xe0c….`：高 16 位 0x0e0c ⇒ 图 12 起 **15 帧**、每帧 10 拍 × 20 ms = **200 ms**
    //   —— 与紅卡/黑卡选股那一支（0x00444ff0 `fcn_004021f8(0xc, 0xf, 0xa)`）一模一样
    expect(pickCursorSpec(0xe0c0202)).toEqual(CARD_CURSOR);
    expect(pickCursorSpec(0xe0c0202)).toEqual({ image: 12, frames: 15, ticks: 10 });
    // 機器工人 / 傳送機 `0x209….` ⇒ 图 9 起 3 帧（准星那一组）
    expect(pickCursorSpec(0x2090006)).toEqual({ image: 9, frames: 3, ticks: 10 });
    // 真的会动：图 12 → 13 → … → 26 → 12，每 200 ms 换一张
    const card = pickCursorSpec(0xe0c0202);
    expect(cursorImageAt(card, 0)).toBe(12);
    expect(cursorImageAt(card, 199)).toBe(12);
    expect(cursorImageAt(card, 200)).toBe(13);
    expect(cursorImageAt(card, 14 * 200)).toBe(26);
    expect(cursorImageAt(card, 15 * 200)).toBe(12);
  });

  it('★ 选不中时是红叉（图 5，单帧；VA 0x00446606 `fcn_004021f8(5, 1, 0)`）', () => {
    expect(PICK_CURSOR_INVALID).toEqual({ image: 5, frames: 1, ticks: 0 });
  });

  it('★ 道具的选择参数表与 asm 对得上（路障只认格子、bit3 才是「目标必选」）', () => {
    expect(TOOL_SELECT_PARAM.get(2)).toBe(0x1); // 路障
    expect(TOOL_SELECT_PARAM.get(3)).toBe(0x10001);
    expect(TOOL_SELECT_PARAM.get(4)).toBe(0x20001);
    // 这几件的低字节都没有 bit3 → 右键能取消
    for (const v of TOOL_SELECT_PARAM.values()) expect(v & 0x8).toBe(0);
  });
});

describe('会话与候选', () => {
  const topo = {
    nodes: [
      { id: 1, x: 100, y: 100, ref: { kind: 'land', index: 1 }, adjacent: [] },
      { id: 2, x: 300, y: 100, ref: { kind: 'facility', index: 1 }, adjacent: [] },
      { id: 3, x: 300, y: 300, ref: { kind: 'special' }, adjacent: [] },
    ],
    lands: [],
    facilities: [],
    commercials: [],
  } as unknown as MapTopology;

  const stateOf = (over: Record<string, unknown> = {}): GameState =>
    ({
      players: [{ index: 0, nodeId: 1, cards: [] }],
      tools: new Array<number>(30).fill(0),
      objects: [],
      specialActors: [],
      currentPlayer: 0,
      ...over,
    }) as unknown as GameState;

  it('★ 库存里没有这件道具 → 一个候选都没有（也不会炸）', () => {
    const s = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x1);
    expect(s.candidates).toEqual([]);
  });

  it('★ 目标必选（bit3）时右键取消不了', () => {
    const a = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x1);
    expect(a.cancellable).toBe(true);
    const b = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x9);
    expect(b.cancellable).toBe(false);
  });

  it('★ 股票那一类没有棋盘落点 —— 它要自己的列表 UI', () => {
    expect(classNeedsItsOwnList('stock')).toBe(true);
    expect(classNeedsItsOwnList('land')).toBe(false);
    const s = startPick(stateOf(), topo, { kind: 'card', cardId: 24 }, 'stock', 0);
    expect(s.candidates).toEqual([]);
  });

  it('★ 命中：越近越优先，超出半径就不算', () => {
    const session = {
      source: { kind: 'tool' as const, toolId: 2 },
      targetClass: 'none' as const,
      param: 0x1,
      cancellable: true,
      candidates: [
        { wx: 100, wy: 100, target: { kind: 'node' as const, nodeId: 1 }, nodeId: 1 },
        { wx: 300, wy: 100, target: { kind: 'node' as const, nodeId: 2 }, nodeId: 2 },
      ],
    };
    const toScreen = (wx: number, wy: number) => ({ x: wx, y: wy });
    expect(hitCandidate(session, 110, 105, toScreen)).toBe(0);
    expect(hitCandidate(session, 290, 105, toScreen)).toBe(1);
    expect(hitCandidate(session, 200, 100, toScreen)).toBeNull(); // 两个都 >24
    // 越出画布的候选点不到（`toScreen` 返回 null）
    const offscreen = startPick(stateOf(), topo, { kind: 'tool', toolId: 2 }, 'none', 0x1);
    expect(hitCandidate(offscreen, 0, 0, () => null)).toBeNull();
  });
});

// ============================================================
//  ★ Q-PICK-1 贴边推镜头 @source `rich4_ui_use_tool.asm`
// ============================================================

describe('★ Q-PICK-1 贴边判定 @source `loc_0044609b`', () => {
  it('bit7 没开 ⇒ 永远不贴边（其余道具都不带这一位）', () => {
    expect(pickEdgeOf(0, 100, false)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(100, 0, false)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(439, 439, false)).toBe(PICK_EDGE.none);
  });

  it('★ 四条阈值：左 x==0 / 右 x>=440 / 上 y<=0 / 下 y==439', () => {
    expect(pickEdgeOf(0, 200, true)).toBe(PICK_EDGE.left);
    expect(pickEdgeOf(1, 200, true)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(440, 200, true)).toBe(PICK_EDGE.right);
    expect(pickEdgeOf(439, 200, true)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(200, 0, true)).toBe(PICK_EDGE.up);
    expect(pickEdgeOf(200, -5, true)).toBe(PICK_EDGE.up);
    expect(pickEdgeOf(200, 439, true)).toBe(PICK_EDGE.down);
    expect(pickEdgeOf(200, 438, true)).toBe(PICK_EDGE.none);
  });

  it('★ 坐标先量化回舞台像素 —— 否则非整数倍缩放下「下边」永远取不到', () => {
    // 舞台被缩放到窗口（`stageMetrics`），`toStage` 除回去的是**小数**。
    // 1280×720（scale 1.5、offsetY 0）下棋盘最底下两行的实际取值：
    //   clientY 717 → 舞台 478.0 → 棋盘 438.0（第 438 行）
    //   clientY 718 → 舞台 478.667 → 棋盘 438.667（盖住第 439 行）
    //   clientY 719 → 舞台 479.333 → 棋盘 439.333（-1 行，仍是第 439 行）
    // 而「下边」判的是 `y == 439`（相等）：不量化 ⇒ 整条死掉。
    expect(pickEdgeOf(220, 438.0, true)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(220, 438.667, true)).toBe(PICK_EDGE.down);
    expect(pickEdgeOf(220, 439.333, true)).toBe(PICK_EDGE.down);
    // 800×600（scale 1.25）同理：598.75/1.25−40 = 438.4、599.75/1.25−40 = 439.2
    expect(pickEdgeOf(220, 438.4, true)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(220, 439.2, true)).toBe(PICK_EDGE.down);
    // 其余三条边的小数量化同样照做（左/右/上本来就落在整数上）
    expect(pickEdgeOf(0.2, 200, true)).toBe(PICK_EDGE.left);
    expect(pickEdgeOf(439.6, 200, true)).toBe(PICK_EDGE.right);
    expect(pickEdgeOf(200, 0.4, true)).toBe(PICK_EDGE.up);
    // 量化**不会**把中间的点误判成贴边
    expect(pickEdgeOf(220.4, 220.4, true)).toBe(PICK_EDGE.none);
    expect(pickEdgeOf(1.4, 437.4, true)).toBe(PICK_EDGE.none);
  });

  it('★ 判定顺序是 左→右→上→下（横向优先，角上只取一条边）', () => {
    // 左上角：x==0 先命中 ⇒ 左
    expect(pickEdgeOf(0, 0, true)).toBe(PICK_EDGE.left);
    // 右上角：x>=440 先命中 ⇒ 右
    expect(pickEdgeOf(440, 0, true)).toBe(PICK_EDGE.right);
    // 左下角：x==0 ⇒ 左（不是下）
    expect(pickEdgeOf(0, 439, true)).toBe(PICK_EDGE.left);
  });

  it('★ 没有对角（表里 35/37/39/41 那四张图永远选不到）', () => {
    expect(PICK_EDGE_ARROW.size).toBe(4);
    for (const img of PICK_EDGE_ARROW.values()) expect([34, 36, 38, 40]).toContain(img);
  });

  it('箭头图号 = 上 34 / 左 40 / 下 38 / 右 36 @source `[0x475e0d + dir*4]`', () => {
    expect(PICK_EDGE_ARROW.get(PICK_EDGE.up)).toBe(34);
    expect(PICK_EDGE_ARROW.get(PICK_EDGE.left)).toBe(40);
    expect(PICK_EDGE_ARROW.get(PICK_EDGE.down)).toBe(38);
    expect(PICK_EDGE_ARROW.get(PICK_EDGE.right)).toBe(36);
  });

  it('只有飛彈(7) / 核子飛彈(13) 带 bit7（`pickClasses` 展开后）', () => {
    for (const [tool, param] of TOOL_SELECT_PARAM) {
      const on = (pickClasses(param) & PICK_CLASS.edgeScroll) !== 0;
      expect(on, `道具 ${tool}`).toBe(tool === 7 || tool === 13);
    }
  });
});

describe('★ Q-PICK-1 方向表与视角 @source `loc_00445f88`', () => {
  it('★ 方向表逐项 = exe 的 16.16 原始整数 @source `0x4751b0`', () => {
    expect(PICK_SCROLL_DIRS).toHaveLength(8);
    expect(PICK_SCROLL_DIRS[0]).toEqual([0, -0x10000]);
    expect(PICK_SCROLL_DIRS[1]).toEqual([-0xb505, -0xb505]);
    expect(PICK_SCROLL_DIRS[2]).toEqual([-0x10000, 0]);
    expect(PICK_SCROLL_DIRS[3]).toEqual([-0xb505, 0xb505]);
    expect(PICK_SCROLL_DIRS[4]).toEqual([0, 0x10000]);
    expect(PICK_SCROLL_DIRS[5]).toEqual([0xb505, 0xb505]);
    expect(PICK_SCROLL_DIRS[6]).toEqual([0x10000, 0]);
    expect(PICK_SCROLL_DIRS[7]).toEqual([0xb505, -0xb505]);
  });

  it('★ `idx = (方向×2 + 视角 − 2) & 7`；视角 0 时 上/左/下/右 = 0/2/4/6', () => {
    // 代进原式：上=1 → (2−2)&7 = 0（表[0] = (0,−1) = 正上）
    //           左=2 → (4−2)&7 = 2（表[2] = (−1,0) = 正左）
    //           下=3 → (6−2)&7 = 4（表[4] = (0,+1) = 正下）
    //           右=4 → (8−2)&7 = 6（表[6] = (+1,0) = 正右）
    expect(pickScrollDirIndex(PICK_EDGE.up, 0)).toBe(0);
    expect(pickScrollDirIndex(PICK_EDGE.left, 0)).toBe(2);
    expect(pickScrollDirIndex(PICK_EDGE.down, 0)).toBe(4);
    expect(pickScrollDirIndex(PICK_EDGE.right, 0)).toBe(6);
    // 四条边在视角 0 下都对应「正方向」（不是斜角）
    expect(PICK_SCROLL_DIRS[0]).toEqual([0, -0x10000]);
    expect(PICK_SCROLL_DIRS[2]).toEqual([-0x10000, 0]);
    expect(PICK_SCROLL_DIRS[4]).toEqual([0, 0x10000]);
    expect(PICK_SCROLL_DIRS[6]).toEqual([0x10000, 0]);
    // 视角每 +1，下标跟着 +1（模 8）
    for (let v = 0; v < 8; v++) {
      expect(pickScrollDirIndex(PICK_EDGE.up, v)).toBe((0 + v) & 7);
      expect(pickScrollDirIndex(PICK_EDGE.right, v)).toBe((6 + v) & 7);
    }
    // 不贴边时给 0（调用方不该用这个值）
    expect(pickScrollDirIndex(PICK_EDGE.none, 0)).toBe(0);
  });
});

describe('★ Q-PICK-1 步长斜坡与钳位', () => {
  it('★ 8 → 12 → … → 64 → 68，然后停在 68 @source `cmp edi,0x40 / lea [edi+4]`', () => {
    expect(PICK_SCROLL_STEP_MIN).toBe(8);
    expect(PICK_SCROLL_STEP_CAP).toBe(0x44);
    let step = PICK_SCROLL_STEP_MIN;
    const seen: number[] = [step];
    for (let i = 0; i < 20; i++) {
      step = pickScrollNextStep(step);
      seen.push(step);
    }
    expect(seen.slice(0, 17)).toEqual([8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 68]);
    // 封顶不再涨
    expect(Math.max(...seen)).toBe(68);
    expect(pickScrollNextStep(68)).toBe(68);
    expect(pickScrollNextStep(1000)).toBe(1000);
  });

  it('★ 视角 0 下四条边各推一个正方向（步长直接就是像素数）', () => {
    const c0 = { x: 1000, y: 1000 };
    expect(pickScrollCamera(c0, PICK_EDGE.up, 0, 16)).toEqual({ x: 1000, y: 984 });
    expect(pickScrollCamera(c0, PICK_EDGE.down, 0, 16)).toEqual({ x: 1000, y: 1016 });
    expect(pickScrollCamera(c0, PICK_EDGE.left, 0, 16)).toEqual({ x: 984, y: 1000 });
    expect(pickScrollCamera(c0, PICK_EDGE.right, 0, 16)).toEqual({ x: 1016, y: 1000 });
  });

  it('★ 每次推的距离就是 (raw × 步长) >> 16（算术右移，不是向零取整）', () => {
    // 视角 1：上 = idx1 = (−0.707107, −0.707107) —— 两个分量都动
    const c = pickScrollCamera({ x: 1000, y: 1000 }, PICK_EDGE.up, 1, 32);
    const d = (-0xb505 * 32) >> 16;
    expect(d).toBe(-23); // floor(−0.707107×32) —— 向零取整会给 −22
    expect(c.x).toBe(1000 + d);
    expect(c.y).toBe(1000 + d);
    // 斜角那一支的两个分量**相同**（表里 x/y 都是 0xb505）
    expect(c.x - 1000).toBe(c.y - 1000);
    // 视角 3：上 = idx3 = (−0.707107, **+**0.707107) —— 一减一加
    const e = pickScrollCamera({ x: 1000, y: 1000 }, PICK_EDGE.up, 3, 32);
    expect(e.x).toBe(1000 + d); // −23（负数向下取整）
    // ★ 正负两半**不对称**：负数那一半是 `floor`，正数那一半是 `trunc`
    //   （算术右移 vs 直接取商）—— 原版就是这条 `sar`，照抄。
    expect(e.y).toBe(1000 + ((0xb505 * 32) >> 16));
    expect((0xb505 * 32) >> 16).toBe(22);
    expect(e.y - 1000).not.toBe(-d);
  });

  it('★ 钳位到 [220, 2084]，两个方向**各自**钳 @source `cmp … 0xdc` / `cmp … 0x824`', () => {
    expect(PICK_SCROLL_MIN).toBe(220);
    expect(PICK_SCROLL_MAX).toBe(2084);
    expect(pickScrollCamera({ x: 220, y: 1000 }, PICK_EDGE.left, 0, 68).x).toBe(220);
    expect(pickScrollCamera({ x: 2084, y: 1000 }, PICK_EDGE.right, 0, 68).x).toBe(2084);
    expect(pickScrollCamera({ x: 1000, y: 220 }, PICK_EDGE.up, 0, 68).y).toBe(220);
    expect(pickScrollCamera({ x: 1000, y: 2084 }, PICK_EDGE.down, 0, 68).y).toBe(2084);
    // 只钳越界的那一维：视角 1 的「上」两个分量都动，y 被钳住、x 照走
    const c = pickScrollCamera({ x: 1000, y: 220 }, PICK_EDGE.up, 1, 68);
    expect(c.y).toBe(220); // 钳住
    expect(c.x).toBeLessThan(1000); // X 照动
  });

  it('不贴边 ⇒ 中心不动', () => {
    expect(pickScrollCamera({ x: 500, y: 500 }, PICK_EDGE.none, 3, 68)).toEqual({ x: 500, y: 500 });
  });

  it('★ 视角旋转会让同一条边的推进方向跟着转 @source 共用 `[0x499088]`', () => {
    // 视角 0 的「右」= idx6 = (+1,0)；视角 2 时同一条边 → idx (6+2)&7 = 0 = (0,−1)
    expect(pickScrollDirIndex(PICK_EDGE.right, 2)).toBe(0);
    const a = pickScrollCamera({ x: 1000, y: 1000 }, PICK_EDGE.right, 0, 32);
    const b = pickScrollCamera({ x: 1000, y: 1000 }, PICK_EDGE.right, 2, 32);
    expect(a).toEqual({ x: 1032, y: 1000 });
    expect(b).toEqual({ x: 1000, y: 968 });
    expect(a).not.toEqual(b);
  });

  it('tick 周期 = 50 ms @source `SetTimer(hwnd, id, 0x32, 0)`', () => {
    expect(PICK_SCROLL_TICK_MS).toBe(0x32);
    expect(PICK_SCROLL_TICK_MS).toBe(50);
  });
});
