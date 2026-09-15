/*
 * 工具栏摆位
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it, vi } from 'vitest';
import {
  actorTokens,
  actorWalkSteps,
  BoardRenderer,
  DeferredSpriteClose,
  actorWalkTotalMs,
  actorWalkTriggers,
  DOLL_STAND_RESOURCE,
  DOLL_WALK_RESOURCE,
  DRAW_CLASS,
  drawKey,
  fitCamera,
  hitToolbar,
  SPECIAL_ACTOR_SPRITE_BASE,
  specialActorImageSet,
  TOOLBAR,
  TOOLBAR_RIGHT,
  toolbarIconAt,
} from './render.ts';
import { SpriteCache, TOOLBAR_ICON_COUNT, TOOLBAR_STRIP_IMAGE, type Sprite } from './assets.ts';
import { tweenTickCount } from './tween.ts';
import { LAYOUT } from './stage.ts';
import {
  ACTOR_PLACE,
  makeGameState,
  makeNode,
  type GameState,
  type MapNode,
  type Rich4Map,
  type SpecialActor,
} from '@rich4/core';

/*
 * 工具栏的格 —— `x / 40`，11 格铺满 440。@source fcn_00415d31 与 loc_00418b0a
 *
 * 这里钉死的是**间距 40**。先前是 39（拿 439 宽的底条图反推「两侧各留 5」），
 * 后果是左边图标偏右、右边图标偏左 —— 越靠边歪得越多（需求方 2026-09-15 报）。
 */
describe('★ 工具栏：等距 40、从 x=0 起、11 格正好 440', () => {
  it('★ 间距是 40，不是 39；也没有左边距', () => {
    expect(TOOLBAR.pitch).toBe(40);
    expect(TOOLBAR.x).toBe(0);
    expect(TOOLBAR_RIGHT).toBe(440);
    expect(TOOLBAR_RIGHT).toBe(TOOLBAR.pitch * TOOLBAR_ICON_COUNT);
  });

  it('★ 图标锚点在每格正中：(i*40 + 20, 20)', () => {
    expect(TOOLBAR.iconX).toBe(20);
    expect(TOOLBAR.iconY).toBe(20);
    expect(toolbarIconAt(0)).toEqual({ x: 20, y: 20 });
    // 第 11 个：10*40+20 = 420，正好是 [400,440) 的中点
    expect(toolbarIconAt(10)).toEqual({ x: 420, y: 20 });
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      const at = toolbarIconAt(i);
      expect(at.x).toBe(i * TOOLBAR.pitch + TOOLBAR.pitch / 2);
    }
  });

  it('★ 每格的左右端点都归自己（40 的整数倍是这一格的开头）', () => {
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      expect(hitToolbar(i * 40, 20)).toBe(i);
      expect(hitToolbar(i * 40 + 39, 20)).toBe(i);
    }
    // 边界：399 还是第 9 格、400 是第 10 格
    expect(hitToolbar(399, 20)).toBe(9);
    expect(hitToolbar(400, 20)).toBe(10);
  });

  it('★ 440 起是側欄，不算工具栏（原版 `cmp x, 0x1b8`）', () => {
    expect(hitToolbar(440, 20)).toBeNull();
    expect(hitToolbar(LAYOUT.toolbar.w + 5, 10)).toBeNull();
  });

  it('工具栏之外：下面那一行、以及负坐标 → null', () => {
    expect(hitToolbar(20, TOOLBAR.height)).toBeNull();
    expect(hitToolbar(20, -1)).toBeNull();
    expect(hitToolbar(TOOLBAR.x - 1, 10)).toBeNull();
  });

  it('底条自身的图号是 0', () => {
    expect(TOOLBAR_STRIP_IMAGE).toBe(0);
  });
});

describe('fitCamera —— 地图视角要「整张铺满」（S6）', () => {
  /** 造一个 w×h 的节点包围盒 */
  const fakeMap = (w: number, h: number): Rich4Map =>
    ({
      nodes: [
        { id: 1, x: 0, y: 0, name: '', adjacent: [], adjacentSlots: [0, 0, 0, 0], type: 0, ref: { kind: 'unknown', raw: 0 }, decorIndex: 0, flags: 0, specialKind: 0, noObjects: 0, walkable: true },
        { id: 2, x: w, y: h, name: '', adjacent: [], adjacentSlots: [0, 0, 0, 0], type: 0, ref: { kind: 'unknown', raw: 0 }, decorIndex: 0, flags: 0, specialKind: 0, noObjects: 0, walkable: true },
      ],
      lands: [],
      facilities: [],
      commercials: [],
      landscapes: [],
      dataSize: 0,
    }) as unknown as Rich4Map;

  it('★ 整张地图落在给定的视口内（含留边）', () => {
    const m = fakeMap(2304, 2304);
    const cam = fitCamera(m, LAYOUT.board.w, LAYOUT.board.h);
    expect(cam.mode).toBe('map');
    // 地图右下角在视口里的位置
    const brX = (2304 - cam.x) * cam.scale;
    const brY = (2304 - cam.y) * cam.scale;
    expect(brX).toBeLessThanOrEqual(LAYOUT.board.w);
    expect(brY).toBeLessThanOrEqual(LAYOUT.board.h);
    expect(brX).toBeGreaterThan(0);
    expect(brY).toBeGreaterThan(0);
  });

  it('★ 至少占满一个方向 —— 不是缩成一小块', () => {
    const m = fakeMap(2304, 2304);
    const cam = fitCamera(m, LAYOUT.board.w, LAYOUT.board.h);
    const w = 2304 * cam.scale;
    const h = 2304 * cam.scale;
    // 正方形地图放进近似正方形的棋盘区：应当两边都接近占满
    expect(Math.max(w / LAYOUT.board.w, h / LAYOUT.board.h)).toBeGreaterThan(0.85);
  });

  it('★ 按棋盘区取景 ≠ 按整个窗口取景（这正是先前那个 bug）', () => {
    const m = fakeMap(2304, 2304);
    const board = fitCamera(m, LAYOUT.board.w, LAYOUT.board.h);
    const window_ = fitCamera(m, 1280, 960);
    // 窗口大得多，缩放就一定更大；拿窗口尺寸去算，地图会被放大后裁掉大半
    expect(window_.scale).toBeGreaterThan(board.scale);
  });
});

describe('★ 绘制槽的排序键（Q-DRAW-1）—— 遮挡关系全靠它', () => {
  it('主序是**屏幕 Y**：屏幕 Y 小的先画（先画 = 会被后画的盖住）', () => {
    // 屏幕 Y 小 = 靠后（远），必须先画；这正是等距视角的画家顺序
    expect(drawKey(100, DRAW_CLASS.building)).toBeLessThan(drawKey(101, DRAW_CLASS.building));
    expect(drawKey(-50, DRAW_CLASS.building)).toBeLessThan(drawKey(0, DRAW_CLASS.building));
  });

  it('★ 同屏幕 Y 时：建筑先画、人物后画 —— 这就是「建筑挡得住人物」的机制', () => {
    const y = 200;
    // 建筑类别 0x0 < 玩家 0xc/0xd ⇒ 建筑排在前面 ⇒ 后画的人物盖住建筑
    expect(drawKey(y, DRAW_CLASS.building)).toBeLessThan(drawKey(y, DRAW_CLASS.player));
    expect(drawKey(y, DRAW_CLASS.player)).toBeLessThan(drawKey(y, DRAW_CLASS.currentPlayer));
  });

  it('类别只做同 Y 的 tie-break，不会盖过屏幕 Y 的主序', () => {
    // 屏幕 Y 差 1，键差 16；类别最大 0xf < 16，故跨 Y 时类别翻不过来
    expect(drawKey(200, DRAW_CLASS.building)).toBeLessThan(drawKey(201, DRAW_CLASS.currentPlayer));
    // 反例检查：若把类别当主序，这一条会失败
    expect(drawKey(200, 0xf) - drawKey(200, 0x0)).toBe(0xf);
  });

  it('★ 关键症状：站在高大建筑**背后**的棋子必须排在建筑前面', () => {
    // 建筑底座在屏幕 Y=300；棋子站在它背后（屏幕 Y 更小 = 更远）
    const building = drawKey(300, DRAW_CLASS.building);
    const behind = drawKey(260, DRAW_CLASS.currentPlayer);
    const inFront = drawKey(340, DRAW_CLASS.currentPlayer);
    expect(behind).toBeLessThan(building); // 远处的人先画 ⇒ 被建筑盖住 ✓
    expect(building).toBeLessThan(inFront); // 近处的人后画 ⇒ 盖住建筑 ✓
  });

  it('负数屏幕 Y 按 12 位截断后仍排在正数之前（原版就是这么算的）', () => {
    expect(drawKey(-1, DRAW_CLASS.building)).toBeLessThan(drawKey(0, DRAW_CLASS.building));
    expect(drawKey(-1, DRAW_CLASS.building)).toBeLessThan(0);
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  T-047：四大惡人 / 機器娃娃的棋子渲染与走子
 *
 *  「state → 渲染输入」的映射全在模块顶层的纯函数里（`specialActorImageSet` /
 *  `actorTokens` / `actorWalkSteps`），这里逐条钉住，绘制那边只做 IO。
 * ══════════════════════════════════════════════════════════════════════════
 */

/** 造一张只有 n 个节点的直线地图，节点间隔 40 世界单位 */
function lineNodes(n: number): MapNode[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode({ id: i + 1, x: i * 40, y: 0, adjacent: [i, i + 2].filter((v) => v >= 1 && v <= n) }),
  );
}

describe('★ T-047 替身的图组资源号 —— 全部照 exe，不许猜', () => {
  it('四個 NPC = 0x16c + actor×4（站姿），走姿 = +1 @source VA 0x0040bd51', () => {
    expect(SPECIAL_ACTOR_SPRITE_BASE).toBe(0x16c);
    // actor 4/5/6/7 → 380/384/388/392，与 NPC_NAMES 同序
    expect(specialActorImageSet(4, false)).toBe(380);
    expect(specialActorImageSet(5, false)).toBe(384);
    expect(specialActorImageSet(6, false)).toBe(388);
    expect(specialActorImageSet(7, false)).toBe(392);
    for (const actor of [4, 5, 6, 7]) {
      const stand = specialActorImageSet(actor, false)!;
      expect(specialActorImageSet(actor, true)).toBe(stand + 1);
      expect(stand).toBe(0x16c + actor * 4);
    }
  });

  it('★ 機器娃娃（actor 8）的两张是写死的 0x209 / 0x20a，**不与基号连号**', () => {
    expect(DOLL_STAND_RESOURCE).toBe(0x209); // 521，8 张 = 8 向各 1 帧
    expect(DOLL_WALK_RESOURCE).toBe(0x20a); // 522，40 张 = 8 向 × 5 帧
    expect(specialActorImageSet(8, false)).toBe(0x209);
    expect(specialActorImageSet(8, true)).toBe(0x20a);
    // 反例检查：若照 NPC 那套公式算，actor 8 会得到 0x18c（396），与原版不符
    expect(specialActorImageSet(8, false)).not.toBe(0x16c + 8 * 4);
  });

  it('玩家（0..3）与越界都不认 —— 那条路走 `characterSetBase`', () => {
    for (const actor of [0, 1, 2, 3, 9, -1]) {
      expect(specialActorImageSet(actor, false)).toBeNull();
      expect(specialActorImageSet(actor, true)).toBeNull();
    }
  });

  it('★ 绘制槽类别：替身非当前是 0x8（排在玩家 0xc 下面），当前是 0xd', () => {
    expect(DRAW_CLASS.npc).toBe(0x8);
    const y = 200;
    expect(drawKey(y, DRAW_CLASS.npc)).toBeLessThan(drawKey(y, DRAW_CLASS.player));
    expect(drawKey(y, DRAW_CLASS.player)).toBeLessThan(drawKey(y, DRAW_CLASS.currentPlayer));
  });
});

describe('★ T-047 state → 替身棋子（`actorTokens`）', () => {
  /** 把某个替身放到棋盘上 */
  const withActor = (
    slot: number,
    over: Partial<GameState['specialActors'][number]>,
  ): GameState => {
    const s = makeGameState();
    const specialActors = [...s.specialActors];
    specialActors[slot] = {
      nodeId: 2,
      lastNodeId: 1,
      direction: 0,
      owner: 0,
      stepsRemaining: 3,
      halted: 0,
      singleStep: 0,
      place: ACTOR_PLACE.board,
      ...over,
    };
    return { ...s, specialActors };
  };

  it('只有 `place === board` 的才画 —— 監獄／醫院／未出场一律跳过 @source VA 0x00408b82', () => {
    // 开局就是「两監獄两醫院 + 娃娃未出场」
    expect(actorTokens(makeGameState(), lineNodes(4), { view: 0 })).toEqual([]);
    for (const place of [ACTOR_PLACE.prison, ACTOR_PLACE.hospital, ACTOR_PLACE.offBoard]) {
      expect(actorTokens(withActor(0, { place }), lineNodes(4), { view: 0 })).toEqual([]);
    }
    expect(actorTokens(withActor(0, {}), lineNodes(4), { view: 0 })).toHaveLength(1);
  });

  it('站姿/走姿的资源号跟着这一帧在不在播补间走，帧号站姿恒 0', () => {
    const s = withActor(0, { direction: 0 });
    const nodes = lineNodes(4);
    const stand = actorTokens(s, nodes, { view: 0 })[0]!;
    expect(stand.resource).toBe(380);
    expect(stand.walking).toBe(false);
    expect(stand.frame).toBe(0);

    const walk = actorTokens(s, nodes, { view: 0, walking: () => true, frame: () => 7 })[0]!;
    expect(walk.resource).toBe(381);
    expect(walk.walking).toBe(true);
    expect(walk.frame).toBe(7);
    // 站姿时即便给了帧号也不该用（`[0x498ea3]` 只在走的时候读）
    expect(actorTokens(s, nodes, { view: 0, frame: () => 7 })[0]!.frame).toBe(0);
  });

  it('★ 屏幕朝向 = (direction + 8 − 视角) & 7 —— 与玩家同一套 @source VA 0x0040882d', () => {
    const nodes = lineNodes(4);
    for (let dir = 0; dir < 8; dir++) {
      for (let view = 0; view < 8; view++) {
        const t = actorTokens(withActor(0, { direction: dir }), nodes, { view })[0]!;
        expect(t.screenDir).toBe((dir + 8 - view) & 7);
      }
    }
  });

  it('★ 五个槽 → actor 4..8，各自的图组不同（機器娃娃走 0x209/0x20a）', () => {
    const s = makeGameState();
    const specialActors = s.specialActors.map((_, i) => ({
      nodeId: i + 1,
      lastNodeId: 0,
      direction: 0,
      owner: 0,
      stepsRemaining: 0,
      halted: 0,
      singleStep: 0,
      place: ACTOR_PLACE.board,
    }));
    const tokens = actorTokens({ ...s, specialActors }, lineNodes(5), { view: 0 });
    expect(tokens.map((t) => t.actor)).toEqual([4, 5, 6, 7, 8]);
    expect(tokens.map((t) => t.resource)).toEqual([380, 384, 388, 392, 521]);
  });

  it('格心坐标与节点号来自 state —— exe 读的是替身记录自己的 x/y', () => {
    const nodes: MapNode[] = [
      makeNode({ id: 1, x: 100, y: 200 }),
      makeNode({ id: 2, x: 340, y: 560 }),
    ];
    const t = actorTokens(withActor(2, { nodeId: 2 }), nodes, { view: 0 })[0]!;
    expect(t.nodeId).toBe(2);
    expect(t.x).toBe(340);
    expect(t.y).toBe(560);
  });

  it('节点号 0（不在場）取不到节点 → 不画', () => {
    expect(actorTokens(withActor(0, { nodeId: 0 }), lineNodes(4), { view: 0 })).toEqual([]);
    // nodeId 越界同理
    expect(actorTokens(withActor(0, { nodeId: 99 }), lineNodes(4), { view: 0 })).toEqual([]);
  });

  it('当前行动者（`[0x49910c]`）那一个用 0xd，其余 0x8', () => {
    const s = makeGameState();
    const specialActors = s.specialActors.map((_, i) => ({
      nodeId: i + 1,
      lastNodeId: 0,
      direction: 0,
      owner: 0,
      stepsRemaining: 0,
      halted: 0,
      singleStep: 0,
      place: ACTOR_PLACE.board,
    }));
    const tokens = actorTokens({ ...s, specialActors }, lineNodes(5), { view: 0, currentActor: 6 });
    expect(tokens.map((t) => t.klass)).toEqual([
      DRAW_CLASS.npc,
      DRAW_CLASS.npc,
      DRAW_CLASS.currentPlayer,
      DRAW_CLASS.npc,
      DRAW_CLASS.npc,
    ]);
    // 不传 currentActor（core 目前不暴露「当前替身」）→ 一律 0x8
    expect(actorTokens({ ...s, specialActors }, lineNodes(5), { view: 0 }).map((t) => t.klass)).toEqual(
      [0x8, 0x8, 0x8, 0x8, 0x8],
    );
  });
});

describe('★ T-047 替身走子补间：tick 数一律走 dist × 0.125（没有交通方式那一支）', () => {
  /** 单位缩放的投影 —— 世界坐标即屏幕坐标，好算 */
  const toScreen = (x: number, y: number): { x: number; y: number } => ({ x, y });

  it('★ tick 数 = trunc(屏幕距离 × 0.125)，且 `special` 恒为真 @source VA 0x0040c5e6', () => {
    const nodes = lineNodes(3); // 节点间隔 40
    const steps = actorWalkSteps([1, 2, 3], nodes, toScreen, 40);
    expect(steps).toHaveLength(2);
    for (const s of steps) {
      // 与玩家「乘骑」那一支同一公式；**不是** dist/速度
      expect(s.ticks).toBe(tweenTickCount(40, 0, 0, true));
      expect(s.ticks).toBe(Math.trunc(40 * 0.125));
      expect(s.ticks).toBe(5);
      expect(s.ms).toBe(5 * 40);
    }
  });

  it('★ tick 是按**屏幕**距离算的，不是世界距离 —— 镜头缩放会改 tick 数', () => {
    const nodes = lineNodes(3);
    const zoom = (x: number, y: number): { x: number; y: number } => ({ x: x * 4, y: y * 4 });
    const plain = actorWalkSteps([1, 2], nodes, toScreen, 20);
    const scaled = actorWalkSteps([1, 2], nodes, zoom, 20);
    expect(plain[0]!.ticks).toBe(5); // 40 × 0.125
    expect(scaled[0]!.ticks).toBe(20); // 160 × 0.125
  });

  it('★ 一串格子首尾相接：`at` 累加、帧号跨格连算（`tickAt` 不归零）', () => {
    const nodes = lineNodes(4);
    const steps = actorWalkSteps([1, 2, 3, 4], nodes, toScreen, 20);
    expect(steps.map((s) => s.ticks)).toEqual([5, 5, 5]);
    expect(steps.map((s) => s.at)).toEqual([0, 100, 200]);
    expect(steps.map((s) => s.tickAt)).toEqual([0, 5, 10]);
    expect(actorWalkTotalMs(steps)).toBe(300);
    // 每一格的端点就是那一格的节点
    expect(steps[0]!.from).toEqual({ x: 0, y: 0 });
    expect(steps[2]!.to).toEqual({ x: 120, y: 0 });
  });

  it('空串 / 单节点 / 断链 → 没有补间（不播，直接落格心）', () => {
    const nodes = lineNodes(3);
    expect(actorWalkSteps([], nodes, toScreen, 20)).toEqual([]);
    expect(actorWalkSteps([2], nodes, toScreen, 20)).toEqual([]);
    expect(actorWalkTotalMs([])).toBe(0);
    // 中间缺一环：不硬凑，直接截断（宁可少播，也不要画出不存在的格子）
    expect(actorWalkSteps([1, 2, 99, 3], nodes, toScreen, 20)).toHaveLength(1);
  });

  it('镜头外（投影返回 null）也照样给 1 tick —— 与原版 `N == 0 → 1` 同一条', () => {
    const nodes = lineNodes(3);
    const steps = actorWalkSteps([1, 2], nodes, () => null, 20);
    expect(steps[0]!.ticks).toBe(1);
  });
});

describe('★ T-047 何时起补间（`actorWalkTriggers`）——「被保釋出来」那一步必须能播', () => {
  const board = (nodeId: number, lastNodeId: number, direction = 0): SpecialActor => ({
    nodeId,
    lastNodeId,
    direction,
    owner: 0,
    stepsRemaining: 0,
    halted: 0,
    singleStep: 0,
    place: ACTOR_PLACE.board,
  });
  const off = (place: SpecialActor['place']): SpecialActor => ({
    nodeId: 0,
    lastNodeId: 0,
    direction: 0,
    owner: 0,
    stepsRemaining: 0,
    halted: 0,
    singleStep: 0,
    place,
  });

  it('★ 監獄里的人上路：`seen = 0`（不在場）→ 落点变节点号，退化成补最后一格', () => {
    const actors = [board(7, 3), off(ACTOR_PLACE.prison), off(ACTOR_PLACE.hospital), off(ACTOR_PLACE.prison), off(ACTOR_PLACE.offBoard)];
    const r = actorWalkTriggers(actors, new Map([[0, 0]]));
    // `lastNodeId` 是 exe 留在 state 里唯一的「来路」→ 只能补这一格
    expect(r.walks).toEqual([{ slot: 0, path: [3, 7] }]);
    expect(r.seen.get(0)).toBe(7);
    expect(r.seen.get(4)).toBe(0);
  });

  it('★ 宿主喂了整趟路径 → 原样照播（这是 1:1 那条路）', () => {
    const actors = [board(9, 8), off(1), off(1), off(1), off(3)];
    const r = actorWalkTriggers(actors, new Map([[0, 0]]), [{ slot: 0, path: [2, 3, 5, 9] }]);
    expect(r.walks).toEqual([{ slot: 0, path: [2, 3, 5, 9] }]);
  });

  it('★ 首帧（進遊戲／讀檔）只记账不播 —— 一读档不该满盘替身乱滑', () => {
    const actors = [board(7, 3), off(1), off(1), off(1), off(3)];
    const r = actorWalkTriggers(actors, new Map());
    expect(r.walks).toEqual([]);
    expect(r.seen.get(0)).toBe(7);
    // 但首帧若宿主明确给了路径（真的刚走完一趟）→ 照播
    const withPath = actorWalkTriggers(actors, new Map(), [{ slot: 0, path: [5, 6, 7] }]);
    expect(withPath.walks).toEqual([{ slot: 0, path: [5, 6, 7] }]);
  });

  it('落点没变 = 还是同一趟，不重播（每帧都调也不会重启补间）', () => {
    const actors = [board(7, 3), off(1), off(1), off(1), off(3)];
    const first = actorWalkTriggers(actors, new Map([[0, 0]]));
    const again = actorWalkTriggers(actors, first.seen);
    expect(again.walks).toEqual([]);
  });

  it('龜行只走一格 / 原地没动 / lastNodeId 为 0（刚出场）→ 没有补间可播', () => {
    // 走了一格：lastNodeId 1 → nodeId 2，仍然是「补最后一格」
    expect(actorWalkTriggers([board(2, 1)], new Map([[0, 1]])).walks).toEqual([
      { slot: 0, path: [1, 2] },
    ]);
    // 原地（停留卡：这一步不走）→ 落点没变
    expect(actorWalkTriggers([board(5, 4)], new Map([[0, 5]])).walks).toEqual([]);
    // 刚出场、还没走：lastNodeId == 0
    expect(actorWalkTriggers([board(5, 0)], new Map([[0, 0]])).walks).toEqual([]);
    // lastNodeId 与 nodeId 相同（不可能，但别画出 0 长度的补间）
    expect(actorWalkTriggers([board(5, 5)], new Map([[0, 0]])).walks).toEqual([]);
  });

  it('回監獄／醫院 = 落点归 0，下一次再上路照样算换了落点', () => {
    const inside = actorWalkTriggers([off(ACTOR_PLACE.prison)], new Map([[0, 11]]));
    expect(inside.seen.get(0)).toBe(0);
    expect(inside.walks).toEqual([]);
    const out = actorWalkTriggers([board(20, 19)], inside.seen);
    expect(out.walks).toEqual([{ slot: 0, path: [19, 20] }]);
  });

  it('★ D-T047-6：走完就收场的人（不在盘上）也要能播那一趟', () => {
    // ① 機器娃娃：`runDoll` 走完 → `idleActor()`（nodeId 0 / place offBoard），
    //    但 core 刚把整趟路径喂过来 —— 必须起补间，否则娃娃九格是瞬移。
    const doll = actorWalkTriggers([off(ACTOR_PLACE.offBoard)], new Map([[0, 0]]), [
      { slot: 0, path: [1, 2, 3, 4] },
    ]);
    expect(doll.walks).toEqual([{ slot: 0, path: [1, 2, 3, 4] }]);
    // 落点记的是**路径末格**，同一份再画一次不重播
    expect(actorWalkTriggers([off(ACTOR_PLACE.offBoard)], doll.seen, [{ slot: 0, path: [1, 2, 3, 4] }]).walks).toEqual([]);
    // ② 惡人半路踩回老家：place 是監獄，同样要播完那一趟
    const jailed = actorWalkTriggers([off(ACTOR_PLACE.prison)], new Map([[0, 0]]), [
      { slot: 0, path: [9, 10, 11, 12] },
    ]);
    expect(jailed.walks).toEqual([{ slot: 0, path: [9, 10, 11, 12] }]);
    expect(jailed.seen.get(0)).toBe(12);
  });
});

// ============================================================
//  ★ Q-PERF-1：淘汰下来的位图在**帧边界**才 close
// ============================================================

describe('★ DeferredSpriteClose —— 摘引用与 close 分成两步', () => {
  /** 一个假精灵：位图只记「被 close 过没有」 */
  const fakeSprite = (): { sprite: Sprite; closed: () => boolean } => {
    let closed = false;
    const sprite = {
      bitmap: {
        close: () => {
          closed = true;
        },
      },
      width: 2,
      height: 2,
      anchorX: 1,
      anchorY: 1,
    } as unknown as Sprite;
    return { sprite, closed: () => closed };
  };

  it('★ retire 只摘引用、**不** close —— 还在画的那一帧不能被关掉', () => {
    const { sprite, closed } = fakeSprite();
    const ready = new Map<string, Sprite | null>([['Data.mkf:1:0:k:', sprite]]);
    const q = new DeferredSpriteClose();

    expect(q.retire(ready, sprite)).toBe(1);
    expect(ready.has('Data.mkf:1:0:k:')).toBe(false);
    expect(closed()).toBe(false); // ★ 关键：这一帧还没画完
    expect(q.pending).toBe(1);
  });

  it('★ drain 才是真正的释放，且只关一次', () => {
    const { sprite, closed } = fakeSprite();
    const ready = new Map<string, Sprite | null>([['k', sprite]]);
    const q = new DeferredSpriteClose();
    q.retire(ready, sprite);

    expect(q.drain()).toBe(1);
    expect(closed()).toBe(true);
    expect(q.pending).toBe(0);
    // 幂等：没有排队的了
    expect(q.drain()).toBe(0);
  });

  it('同一个精灵挂在多个缓存键下（换色/抠黑各一份）→ 全部摘掉', () => {
    const { sprite } = fakeSprite();
    const ready = new Map<string, Sprite | null>([
      ['Data.mkf:1:0:k:', sprite],
      ['Data.mkf:1:0::', null],
      ['Data.mkf:1:0::1,2,3', sprite],
    ]);
    const q = new DeferredSpriteClose();
    expect(q.retire(ready, sprite)).toBe(2);
    expect(ready.size).toBe(1);
    expect(q.drain()).toBe(1);
  });

  it('★ 不是本渲染器持有的（hud.ts 那份）→ 不摘、不排队、不 close', () => {
    const { sprite, closed } = fakeSprite();
    const ready = new Map<string, Sprite | null>();
    const q = new DeferredSpriteClose();

    expect(q.retire(ready, sprite)).toBe(0);
    expect(q.pending).toBe(0);
    expect(q.drain()).toBe(0);
    expect(closed()).toBe(false); // 别人还在用，谁也别动它
  });

  it('★ 渲染器构造时就挂上缓存的淘汰监听（不靠 main.ts 接线）', () => {
    const cache = new SpriteCache(
      { get: () => ({ read: () => new Uint8Array(0) }) } as never,
      {},
    );
    const spy = vi.spyOn(cache, 'addEvictListener').mockImplementation(() => {
      /* 只验接线，不真的收 */
    });

    // ctx 用不上（只构造、不画）
    new BoardRenderer({} as CanvasRenderingContext2D, cache);

    // ★ 挂监听这件事发生在构造里 —— 因为 SpriteCache 是在 main.ts 里造就的，
    //   而 main.ts 不是本卡能改的文件（Q-PERF-1）。
    expect(spy).toHaveBeenCalledTimes(1);
    expect(typeof spy.mock.calls[0]![0]).toBe('function');
    spy.mockRestore();
  });
});
