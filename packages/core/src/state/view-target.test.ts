/*
 * W-54 —— `view_to`（VA 0x0041d476）的**移动**那一支
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版语义（首席取证，见 `docs/tasks/W-50-playtest5-stage-order.md` §5.1）：
 * ```
 * view_to(x, y, flags):
 *   flags & 1  ⇒ 只按上一次的中心重画（0x40829d(-1, 0)），**不动镜头**
 *                 —— 表里实参是 0,0,1 的那 38 处全部属于这一类 ⇒ 忽略
 *   否则：
 *     (x, y) == 当前行动者坐标 ⇒ 清标记 [0x48be18] = 0
 *     不等                     ⇒ [0x48be18] = 1、[0x48be1c]/[0x48be20] = (x, y)
 *     然后 fcn_00415e70 居中（**有标记用标记**）
 * ```
 *
 * 本引擎把它做成瞬态提示 `GameState.lastViewTarget`（不进指纹、不进存档），
 * 客户端写进**与小地图点选用同一个** `minimapMarker`。
 *
 * 这一份测试钉三件事：
 *   1. **接哪几路** —— 地块卡 / 設施卡 / 玩家卡 / 機器工人 / 飛彈（爆心）；
 *   2. **不接哪几路** —— 不需要目标的卡（均富卡…）保持 `null`，不猜；
 *   3. **只活一条 action** —— 下一条改动了状态的 action 一律清成 `null`，
 *      而**没生效**的 action（手里没那张卡）连对象都不换。
 */

import { describe, expect, it } from 'vitest';
import {
  makeFacility,
  makeGameState,
  makeLand,
  makeNode,
  makePlayer,
} from '../testing/factories.ts';
import { reduce, useToolAction } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { FACILITY_TYPE_MIN, HOUSING_TYPE_MIN } from '../rules/land.ts';

/** 機器工人 / 飛彈 */
const TOOL_MISSILE = 7;
const TOOL_ROBOT_WORKER = 9;

/** 拆除卡 / 停留卡 / 均富卡 / 陷害卡 */
const CARD_DEMOLISH = 12;
const CARD_STAY = 14;
const CARD_SHARE = 1;
const CARD_FRAME = 17;

/** 两格离得很远的棋盘：1 = 住宅（320,320）、2 = 設施（960,640） */
function scene(over: Partial<GameState> = {}): {
  state: GameState;
  topo: MapTopology;
} {
  const nodes = [
    makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, x: 320, y: 320, adjacent: [2] }),
    makeNode({ id: 2, type: FACILITY_TYPE_MIN + 1, x: 960, y: 640, adjacent: [1] }),
  ];
  const lands = [makeLand({ id: 1, x: 320, y: 320, landPrice: 1000, housePrice: 200 })];
  const facilities = [
    makeFacility({ id: 1, x: 960, y: 640, landPrice: 5000, housePrice: 1000 }),
  ];
  const state = makeGameState({
    phase: 'awaitingRoll',
    // ★ 每个人的**像素**坐标都不同（原版 `view_to` 读 `player+0x08/+0x0a`，
    //   不是格心坐标）—— 这样「用的是人自己的坐标」才验得出来
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        character: i,
        nodeId: i === 1 ? 2 : 1,
        xpos: 620 + i * 7,
        ypos: 780 + i * 7,
        cash: 500_000,
      }),
    ),
    // 地块 id 1（下标 1）= 玩家 1 的，2 级；設施 id 1（下标 1）同理
    landOwner: [0, 2, 0],
    landLevel: [0, 2, 0],
    facilityOwner: [0, 2, 0],
    facilityLevel: [0, 2, 0],
    ...over,
  });
  return { state, topo: { nodes, lands, facilities } };
}

/** 给某位玩家一张卡 */
const give = (s: GameState, who: number, cardId: number): GameState => ({
  ...s,
  players: s.players.map((p, i) => (i === who ? { ...p, cards: [cardId] } : p)),
});

/** 给某位玩家一件道具 */
const giveTool = (s: GameState, toolId: number): GameState => {
  const tools = [...s.tools];
  tools[toolId] = 1;
  return { ...s, tools };
};

describe('★ W-54 `view_to` 的移动那一支', () => {
  it('拆除卡打**远处的地块** ⇒ 镜头目标是那块地的坐标', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_DEMOLISH);
    const after = reduce(
      s,
      { type: 'useCard', cardId: CARD_DEMOLISH, target: { kind: 'entity', entityId: 1 } },
      topo,
    );
    // 卡真的生效了（否则下面这条断言就是空的）
    expect(after.landLevel[1]).toBe(1);
    expect(after.lastViewTarget).toEqual({ x: 320, y: 320 });
  });

  it('拆除卡打**远处的設施** ⇒ 镜头目标是那个設施的坐标', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_DEMOLISH);
    const after = reduce(
      s,
      { type: 'useCard', cardId: CARD_DEMOLISH, target: { kind: 'facility', facilityId: 1 } },
      topo,
    );
    expect(after.facilityLevel[1]).toBe(1);
    expect(after.lastViewTarget).toEqual({ x: 960, y: 640 });
  });

  it('停留卡指定**远处的玩家** ⇒ 镜头目标是那个人自己的坐标', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_STAY);
    const after = reduce(
      s,
      { type: 'useCard', cardId: CARD_STAY, target: { kind: 'player', index: 1 } },
      topo,
    );
    // 玩家 1 站在节点 2 上，但 `lastViewTarget` 用的是他自己的**像素**坐标
    //   （原版读 `player+0x08/+0x0a`）—— 关押期间那是景观坐标，正是要看见的地方。
    expect(after.lastViewTarget).toEqual({ x: 627, y: 787 });
  });

  it('不需要目标的卡（均富卡）⇒ **不设**镜头目标（不猜）', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_SHARE);
    const after = reduce(s, { type: 'useCard', cardId: CARD_SHARE }, topo);
    expect(after.lastViewTarget).toBeNull();
  });

  it('機器工人 ⇒ 镜头目标是**被盖的那一格**（`0x0044733c call 0x41d476`）', () => {
    const { state, topo } = scene();
    const s = giveTool(state, TOOL_ROBOT_WORKER);
    const after = useToolAction(s, topo, TOOL_ROBOT_WORKER, 1, 0);
    expect(after.landLevel[1]).toBe(3); // 2 → 3
    expect(after.lastViewTarget).toEqual({ x: 320, y: 320 });
  });

  it('飛彈 ⇒ 镜头目标是**爆心**（`0x00447b77 call 0x41d476`）', () => {
    const { state, topo } = scene();
    const s = giveTool(state, TOOL_MISSILE);
    const after = useToolAction(s, topo, TOOL_MISSILE, 2, 0);
    // 爆心那一格被削了一级
    expect(after.facilityLevel[1]).toBe(1);
    expect(after.lastViewTarget).toEqual({ x: 960, y: 640 });
  });

  it('道具没生效（手上没有这一件）⇒ 原样返回，连对象都不换', () => {
    const { state, topo } = scene();
    expect(useToolAction(state, topo, TOOL_MISSILE, 2, 0)).toBe(state);
    expect(state.lastViewTarget).toBeNull();
  });

  it('没生效的卡（手里没这张卡）⇒ 原样返回，连对象都不换', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_SHARE);
    expect(reduce(s, { type: 'useCard', cardId: CARD_DEMOLISH }, topo)).toBe(s);
  });

  it('★★ **只活一条 action**：下一条改动了状态的 action 把它清成 null', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_DEMOLISH);
    const after = reduce(
      s,
      { type: 'useCard', cardId: CARD_DEMOLISH, target: { kind: 'entity', entityId: 1 } },
      topo,
    );
    expect(after.lastViewTarget).not.toBeNull();

    // `rotateView` 改状态、但**没有**设镜头目标（原版的 `refresh_screen` 就是这一类的收尾）
    const later = reduce(after, { type: 'rotateView', delta: 1 }, topo);
    expect(later.viewRotation).not.toBe(after.viewRotation);
    expect(later.lastViewTarget).toBeNull();
  });

  it('★★ 同一张卡连打两次（坐标相同）⇒ 仍然是**新的一次**（引用换新，表现层不会漏看）', () => {
    const { state, topo } = scene();
    const first = reduce(
      give(state, 0, CARD_DEMOLISH),
      { type: 'useCard', cardId: CARD_DEMOLISH, target: { kind: 'entity', entityId: 1 } },
      topo,
    );
    // 第二张：等级回到 2 再打，坐标与上一次完全相同
    const second = reduce(
      give({ ...first, landLevel: [0, 2, 0], landType: [0, 0, 0] }, 0, CARD_DEMOLISH),
      { type: 'useCard', cardId: CARD_DEMOLISH, target: { kind: 'entity', entityId: 1 } },
      topo,
    );
    expect(second.lastViewTarget).toEqual({ x: 320, y: 320 });
    // 值相同、**对象不同** —— 客户端的「看引用」判据靠这一点
    expect(second.lastViewTarget).not.toBe(first.lastViewTarget);
  });

  it('★ C-DET：不进 `stateFingerprint`（与 `lastNpcWalks` 同一类纯表现）', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_DEMOLISH);
    const after = reduce(
      s,
      { type: 'useCard', cardId: CARD_DEMOLISH, target: { kind: 'entity', entityId: 1 } },
      topo,
    );
    const base = stateFingerprint(after);
    // ⚠️ 先落成 `GameState` 变量再传 —— `stateFingerprint` 的形参是显式字段表，
    //   直接传对象字面量会撞「多余属性」检查（那正是「不进指纹」的证明）。
    const cleared: GameState = { ...after, lastViewTarget: null };
    const other: GameState = { ...after, lastViewTarget: { x: 1, y: 2 } };
    expect(stateFingerprint(cleared)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });

  it('陷害卡（对玩家）也接上了 —— 与 `view-to-callsites.md` 的「对玩家的卡」一族同源', () => {
    const { state, topo } = scene();
    const s = give(state, 0, CARD_FRAME);
    const after = reduce(
      s,
      { type: 'useCard', cardId: CARD_FRAME, target: { kind: 'player', index: 1 } },
      topo,
    );
    expect(after.lastViewTarget).toEqual({ x: 627, y: 787 });
  });
});
