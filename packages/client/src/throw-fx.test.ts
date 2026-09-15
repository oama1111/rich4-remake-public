/*
 * 放置類道具的投掷动效与物件图 —— 数值全部照 exe 钉死
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 出处见 `throw-fx.ts` 的文件头：`_rich4_animate_object`（VA 0x0040e669）
 * 与 `_rich4_place_object`（VA 0x0040e033）/ `_rich4_load_map`（VA 0x004080b2）。
 * 这里连数值一起钉住 —— 改了帧数公式、每帧 24 ms、图集基号，表现就与原版不一样。
 *
 * ★ Q-TOOL-5 追加：另外 23 个 `animate_object` 调用点（卡片 / 請神符）与
 *   **附身于人**的物件那两张偏移表，同样逐条钉在这里。
 */
import { describe, expect, it } from 'vitest';
import { directionOf, type CardTarget } from '@rich4/core';
import { screenDirection } from './assets.ts';
import {
  ATTACHED_OFFSETS,
  ATTACHED_OFFSETS_WITH_GOD,
  CARD_FLIGHT_IMAGE,
  CARD_FLIGHT_NO_OBJECT,
  CARD_FLIGHT_SITES,
  CARD_FLIGHT_TYPE,
  OBJECT_SPRITE_BASE,
  THROW_FRAME_MS,
  THROW_SETTLE_MS,
  attachedFrameIndex,
  attachedImageIndex,
  attachedOffset,
  attachedOwnerVisible,
  cardFlightPlan,
  cardFlightSite,
  cardFlightTargetKind,
  flightAllowed,
  flightDone,
  flightPosAt,
  flightRunning,
  makeObjectFlight,
  objectFacing,
  objectImageIndex,
  objectSpriteResource,
  throwFrameAt,
  throwFrameCount,
  throwTotalMs,
  type CardFlightAnchors,
} from './throw-fx.ts';

describe('throwFrameCount —— 照 exe 的帧数公式', () => {
  it('★ 就是 trunc(√(dx²+dy²) × 0.125 + 1)', () => {
    // @source VA 0x0040e73c..0x0040e754，常量 0x46324c = 0.125f
    expect(throwFrameCount(0, 0)).toBe(1);
    expect(throwFrameCount(8, 0)).toBe(2); // 1 + 1
    expect(throwFrameCount(36, 0)).toBe(5); // 4.5 + 1 = 5.5 → 5
    expect(throwFrameCount(40, 0)).toBe(6); // 5 + 1
    expect(throwFrameCount(50, 0)).toBe(7); // 6.25 + 1 = 7.25 → 7
    expect(throwFrameCount(80, 0)).toBe(11); // 10 + 1
  });

  it('合成距离按欧氏算（√(dx²+dy²)）', () => {
    expect(throwFrameCount(30, 40)).toBe(throwFrameCount(50, 0));
    expect(throwFrameCount(30, 40)).toBe(7);
  });

  it('截断是**向零**（@source fcn_00457dbc），不是四舍五入', () => {
    // 49 × 0.125 + 1 = 7.125 → 7（round 会给 7，但 56 → 8.0 边界要显式挡住）
    expect(throwFrameCount(49, 0)).toBe(7);
    expect(throwFrameCount(56, 0)).toBe(8);
    // 47.9 × 0.125 + 1 = 6.9875 → 6
    expect(throwFrameCount(47.9, 0)).toBe(6);
  });
});

describe('throwFrameAt —— 线性等分（不是弧线）', () => {
  const from = { x: 10, y: 20 };
  const to = { x: 90, y: 60 };

  it('★ 第 N 帧**正好落在终点**（原版 curX = 起点 + N × step）', () => {
    const last = throwFrameAt(from, to, 8, 8);
    expect(last.x).toBeCloseTo(90, 9);
    expect(last.y).toBeCloseTo(60, 9);
  });

  it('★ 第一帧就已经离起点一步（原版先加一次 step 才进循环）', () => {
    const first = throwFrameAt(from, to, 8, 1);
    expect(first.x).toBeCloseTo(10 + 80 / 8, 9);
    expect(first.y).toBeCloseTo(20 + 40 / 8, 9);
  });

  it('中间帧按 k/N 等分', () => {
    expect(throwFrameAt(from, to, 4, 3)).toEqual({ x: 70, y: 50 });
  });

  it('k 越界就夹在 1..N（不会画到线段外）', () => {
    expect(throwFrameAt(from, to, 4, 0)).toEqual(throwFrameAt(from, to, 4, 1));
    expect(throwFrameAt(from, to, 4, 9)).toEqual(throwFrameAt(from, to, 4, 4));
  });
});

describe('节拍 —— 每帧 24 ms，收尾再停 100 ms', () => {
  it('@source VA 0x0040e987 `cmp eax, 0x18` / VA 0x00446c12 `push 0x64`', () => {
    expect(THROW_FRAME_MS).toBe(24);
    expect(THROW_SETTLE_MS).toBe(100);
    expect(throwTotalMs(6)).toBe(6 * 24 + 100);
    expect(throwTotalMs(0)).toBe(24 + 100); // 兜底：至少一帧
  });
});

describe('objectSpriteResource —— 物件种类 → Data.mkf 资源号', () => {
  it('★ 基号 0x18c = 396（@source VA 0x004080b6 `lea eax,[ebx+0x18c]`）', () => {
    expect(OBJECT_SPRITE_BASE).toBe(0x18c);
    expect(objectSpriteResource(1)).toBe(396);
  });

  it('★ 三件道具：路障(16)=411、地雷(17)=412、定時炸彈(18)=413', () => {
    expect(objectSpriteResource(16)).toBe(411);
    expect(objectSpriteResource(17)).toBe(412);
    expect(objectSpriteResource(18)).toBe(413);
  });

  it('表尾是种类 20 → 415（`cmp ebx, 0x14`）；越界返回 null', () => {
    expect(objectSpriteResource(20)).toBe(415);
    expect(objectSpriteResource(0)).toBeNull();
    expect(objectSpriteResource(21)).toBeNull();
    expect(objectSpriteResource(-1)).toBeNull();
    expect(objectSpriteResource(1.5)).toBeNull();
  });
});

describe('objectImageIndex —— 图号 = 8 − 视角 + 朝向', () => {
  it('★ 与玩家的 screenDirection 是同一个公式（不另写一份）', () => {
    for (let view = 0; view < 8; view++) {
      for (let facing = 0; facing < 8; facing++) {
        expect(objectImageIndex(facing, view)).toBe(screenDirection(facing, view));
      }
    }
  });

  it('@source VA 0x00408ee2..0x00408ef2：视角 0 时图号 = 朝向', () => {
    expect(objectImageIndex(0, 0)).toBe(0);
    expect(objectImageIndex(4, 0)).toBe(4);
    // 视角 1 时整体回绕一格
    expect(objectImageIndex(0, 1)).toBe(7);
    expect(objectImageIndex(7, 1)).toBe(6);
  });
});

describe('objectFacing —— 物件面朝来路（第一个非 0 邻接槽）', () => {
  // 造一张小地图：1 在 (0,0)、2 在 (100,0)、3 在 (0,100)
  const nodes = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const at = (slots: [number, number, number, number], x: number, y: number): number =>
    objectFacing({ x, y, adjacentSlots: slots }, nodes, directionOf);

  it('第一个非 0 槽决定朝向（后面的槽忽略）', () => {
    // 本格在 (100,0)，来路是 (0,0)：本格 − 邻格 = (+100, 0) → 朝右
    expect(at([1, 0, 0, 0], 100, 0)).toBe(directionOf(100, 0));
    // 同样两格，但槽顺序反过来（先 3 后 1）→ 朝向变成 (100,0) − (0,100) = (+100,−100)
    expect(at([3, 1, 0, 0], 100, 0)).toBe(directionOf(100, -100));
  });

  it('★ 是「从邻格指向本格」的方向，不是反过来', () => {
    const forward = at([1, 0, 0, 0], 100, 0);
    const backward = at([2, 0, 0, 0], 0, 0);
    expect(forward).toBe(directionOf(100, 0));
    expect(backward).toBe(directionOf(-100, 0));
    expect(forward).not.toBe(backward);
  });

  it('四个槽全 0（孤立格）退回 0，不抛', () => {
    expect(at([0, 0, 0, 0], 0, 0)).toBe(0);
  });
});

describe('makeObjectFlight / flightPosAt —— 一条投掷的时间线', () => {
  const f = makeObjectFlight({
    objectIndex: 16,
    type: 16,
    facing: 2,
    from: { x: 0, y: 0 },
    to: { x: 50, y: 0 },
    start: 1000,
  });

  it('帧数在开播时按屏幕距离定死一次（7 帧 = 150px 内）', () => {
    expect(f.frames).toBe(7);
    expect(f.objectIndex).toBe(16);
    expect(f.type).toBe(16);
  });

  it('k = floor(已过毫秒 / 24) + 1，第一帧在 start 那一刻', () => {
    expect(flightPosAt(f, 1000)).toEqual(throwFrameAt(f.from, f.to, 7, 1));
    expect(flightPosAt(f, 1023)).toEqual(throwFrameAt(f.from, f.to, 7, 1));
    expect(flightPosAt(f, 1024)).toEqual(throwFrameAt(f.from, f.to, 7, 2));
  });

  it('★ 画到最后一帧时正好在目标格上（此后不再动）', () => {
    const last = flightPosAt(f, 1000 + 6 * 24);
    expect(last?.x).toBeCloseTo(50, 9);
    // 再往后（收尾停顿那 100 ms）也停在终点
    expect(flightPosAt(f, 1000 + 6 * 24 + 99)?.x).toBeCloseTo(50, 9);
  });

  it('还没到 start（时钟回拨）返回 null，不画', () => {
    expect(flightPosAt(f, 999)).toBeNull();
  });

  it('播完的判据含那 100 ms 收尾停顿', () => {
    const end = 1000 + throwTotalMs(7);
    expect(flightRunning(f, end - 1)).toBe(true);
    expect(flightDone(f, end - 1)).toBe(false);
    expect(flightDone(f, end)).toBe(true);
    expect(flightRunning(f, end)).toBe(false);
  });

  it('★ 收尾停顿可逐条覆盖 —— 請神符是 0（@source VA 0x00444ebe `push 0`）', () => {
    const g = makeObjectFlight({
      objectIndex: 3,
      type: 5,
      facing: 0,
      from: { x: 0, y: 0 },
      to: { x: 50, y: 0 },
      start: 1000,
      settleMs: 0,
    });
    expect(g.settleMs).toBe(0);
    expect(flightDone(g, 1000 + 7 * 24)).toBe(true);
    // 缺省仍是 100：
    expect(f.settleMs).toBeUndefined();
    expect(flightDone(f, 1000 + 7 * 24)).toBe(false);
  });

  it('★ 卡片那一支给了 `image` 就照它画（图集 415 只有 1 张，按角度算会取空）', () => {
    const c = makeObjectFlight({
      objectIndex: CARD_FLIGHT_NO_OBJECT,
      type: CARD_FLIGHT_TYPE,
      facing: 5,
      image: CARD_FLIGHT_IMAGE,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      start: 0,
    });
    expect(c.image).toBe(0);
    expect(c.type).toBe(20);
    expect(objectSpriteResource(c.type)).toBe(415);
    expect(c.objectIndex).toBe(-1);
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  ★ Q-TOOL-5 ①：卡片 / 請神符的飞行 —— 另外 23 个 `animate_object` 调用点
 *
 *  全 exe 26 个调用点：3 个放置類道具（上面那套）+ 23 个卡片/請神符。
 *  逐个取证（`python3 tools/disasm.py callers 0x40e669`）后必须**一个不少**
 *  地登记在 `CARD_FLIGHT_SITES` 里，否则就是漏接。
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('★ Q-TOOL-5 ①：23 个调用点逐条登记（表不许缺项）', () => {
  /** `callers 0x40e669` 的 26 个点减去 3 个放置類道具（0x446c4e/0x446d2f/0x446e10） */
  const CARD_CALL_SITES = [
    0x004422d6, 0x004427b3, 0x00442a01, 0x00442c81, 0x00442e9c, 0x0044301c,
    0x0044360f, 0x0044369f, 0x0044383b, 0x00443905, 0x00443a6a, 0x00443bf1,
    0x00443cbd, 0x00443d8f, 0x00443ef7, 0x00444050, 0x004442aa, 0x00444591,
    0x00444efa, 0x004452c6, 0x00445576, 0x004457e0, 0x004459af,
  ];
  const TOOL_CALL_SITES = [0x00446c4e, 0x00446d2f, 0x00446e10];

  it('★ 23 个 VA 一个不少、一个不多（怪獸/漲價那两行共用同一个点，故表里 25 行）', () => {
    const vas = CARD_FLIGHT_SITES.map((s) => s.va);
    expect([...new Set(vas)].sort((a, b) => a - b)).toEqual(CARD_CALL_SITES);
    expect(CARD_FLIGHT_SITES).toHaveLength(25);
  });

  it('三个放置類道具的调用点**不**在表里（它们走 place_object 的 handle）', () => {
    for (const va of TOOL_CALL_SITES) {
      expect(CARD_FLIGHT_SITES.some((s) => s.va === va)).toBe(false);
    }
  });

  it('★ 只有两处没有 who_plays 闸门：天使卡打地块(0x44360f) 与請神符(0x444efa)', () => {
    const noGate = CARD_FLIGHT_SITES.filter((s) => !s.humanSkips).map((s) => s.va);
    expect([...new Set(noGate)].sort((a, b) => a - b)).toEqual([0x0044360f, 0x00444efa]);
  });

  it('★ 只有請神符是反向飞行、且收尾停顿是 0', () => {
    expect(CARD_FLIGHT_SITES.filter((s) => s.reversed).map((s) => s.va)).toEqual([0x00444efa]);
    expect(CARD_FLIGHT_SITES.filter((s) => s.settleMs === 0).map((s) => s.va)).toEqual([0x00444efa]);
    // 其余一律 arg6 = 0x64 = 100 ms
    for (const s of CARD_FLIGHT_SITES) {
      if (s.va !== 0x00444efa) expect(s.settleMs).toBe(100);
    }
  });

  it('★ 三行不支持（core 不收那种目标），其余 22 行可用', () => {
    const bad = CARD_FLIGHT_SITES.filter((s) => !s.supported).map((s) => [s.cardId, s.target]);
    expect(bad).toEqual([
      [4, 'facility'], // 換地卡：本引擎只换住宅/连锁店
      [5, 'facility'], // 換屋卡：同上
      [12, 'object'], // 拆除卡：本引擎这张卡不收地圖物件目标
    ]);
    expect(CARD_FLIGHT_SITES.filter((s) => s.supported)).toHaveLength(22);
  });

  it('每张卡的每一行目标种类都不重复（同卡同种类只会命中一行）', () => {
    const seen = new Set<string>();
    for (const s of CARD_FLIGHT_SITES) {
      const k = `${s.cardId}:${s.target}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});

describe('★ Q-TOOL-5 ①：闸门与目标种类 —— 该起 / 不该起', () => {
  const HUMAN = 1; // @source rich4-re/asm/rich4_player_info.h「1: human」
  const CPU = 2;
  const AUTOPILOT_HUMAN = 0x05; // 人类 + 被托管 ⇒ **不等于 1** ⇒ 照播

  /** 目标位置各给一个可辨认的坐标，好断言「飞向谁」 */
  const anchor: CardFlightAnchors = {
    player: (i) => ({ x: 100 + i, y: 200 + i }),
    land: (id) => ({ x: 1000 + id, y: 2000 + id }),
    facility: (id) => ({ x: 3000 + id, y: 4000 + id }),
    object: (idx) => ({ x: 5000 + idx, y: 6000 + idx, type: 5, facing: 3 }),
  };
  const ACTOR = { x: 10, y: 20 };
  const ask = (cardId: number, target: CardTarget, whoPlays: number) =>
    cardFlightPlan({ cardId, whoPlays, target, actor: ACTOR, anchor });

  const PLAYER_CARDS = [2, 6, 13, 14, 16, 17, 26, 29, 30];
  const LAND_CARDS = [4, 5, 9, 10, 11, 12, 27];
  const FACILITY_CARDS = [9, 10, 11, 12, 27];

  it('@source 闸门：`who_plays == 1` 才不播（比的是整字节，托管人类照播）', () => {
    expect(flightAllowed(HUMAN)).toBe(false);
    expect(flightAllowed(CPU)).toBe(true);
    expect(flightAllowed(AUTOPILOT_HUMAN)).toBe(true);
    expect(flightAllowed(0)).toBe(true);
  });

  it('★ 玩家目标那 9 张卡：电脑出牌要飞，飞到**目标玩家**身上', () => {
    expect(PLAYER_CARDS).toHaveLength(9);
    for (const cardId of PLAYER_CARDS) {
      const p = ask(cardId, { kind: 'player', index: 2 }, CPU);
      expect(p, `卡 ${cardId}`).not.toBeNull();
      expect(p!.sprite).toEqual({ kind: 'card' });
      expect(p!.from).toEqual(ACTOR);
      expect(p!.to).toEqual({ x: 102, y: 202 });
      expect(p!.settleMs).toBe(100);
      expect(p!.hideObjectIndex).toBeNull();
      // 纯人类出牌 → 原版整段跳过
      expect(ask(cardId, { kind: 'player', index: 2 }, HUMAN), `卡 ${cardId}`).toBeNull();
    }
  });

  it('★ 地块目标：电脑出牌要飞，飞到**那块地自己的坐标**（不是节点）', () => {
    for (const cardId of LAND_CARDS) {
      const p = ask(cardId, { kind: 'entity', entityId: 7 }, CPU);
      expect(p, `卡 ${cardId}`).not.toBeNull();
      expect(p!.to).toEqual({ x: 1007, y: 2007 });
    }
  });

  it('★ 天使卡打地块是**唯一**人类出牌也播的卡片点（原版的不对称，照抄）', () => {
    expect(ask(9, { kind: 'entity', entityId: 7 }, HUMAN)).not.toBeNull();
    // 同一张卡打設施就回到闸门里
    expect(ask(9, { kind: 'facility', facilityId: 3 }, HUMAN)).toBeNull();
    // 其余地块卡人类一律不播
    for (const cardId of LAND_CARDS.filter((c) => c !== 9)) {
      expect(ask(cardId, { kind: 'entity', entityId: 7 }, HUMAN), `卡 ${cardId}`).toBeNull();
    }
  });

  it('★ 設施目标：电脑出牌要飞，飞到**设施自己的坐标**', () => {
    for (const cardId of FACILITY_CARDS) {
      const p = ask(cardId, { kind: 'facility', facilityId: 3 }, CPU);
      expect(p, `卡 ${cardId}`).not.toBeNull();
      expect(p!.to).toEqual({ x: 3003, y: 4003 });
      expect(ask(cardId, { kind: 'facility', facilityId: 3 }, HUMAN), `卡 ${cardId}`).toBeNull();
    }
  });

  it('★ 請神符：飞的是**神明自己**那套图，方向反向（神明 → 出牌者），停顿 0', () => {
    const p = ask(23, { kind: 'object', objectIndex: 6 }, HUMAN);
    expect(p).not.toBeNull();
    // 没有 who_plays 闸门：人类也播
    expect(ask(23, { kind: 'object', objectIndex: 6 }, CPU)).not.toBeNull();
    expect(p!.sprite).toEqual({ kind: 'object', objectIndex: 6, type: 5, facing: 3 });
    // ★ 反向：起点是神明那格，终点是出牌者
    expect(p!.from).toEqual({ x: 5006, y: 6006 });
    expect(p!.to).toEqual(ACTOR);
    expect(p!.settleMs).toBe(0);
    // @source VA 0x00444ea8：飞行期间先把神明从地图上摘掉
    expect(p!.hideObjectIndex).toBe(5);
  });

  it('★ 不支持的三支：就算是电脑出牌也不起飞行动效（core 走不到那里）', () => {
    expect(ask(4, { kind: 'facility', facilityId: 1 }, CPU)).toBeNull();
    expect(ask(5, { kind: 'facility', facilityId: 1 }, CPU)).toBeNull();
    // 拆除卡打地圖物件：原版有（VA 0x00443d8f），本引擎这张卡不收 object 目标
    expect(ask(12, { kind: 'object', objectIndex: 6 }, CPU)).toBeNull();
    // 但同一个点对应的其它种类照常
    expect(ask(12, { kind: 'entity', entityId: 1 }, CPU)).not.toBeNull();
  });

  it('没有飞行动效的目标种类：actor / stock / node / none 一律不起', () => {
    // ★ actor：原版这几张卡把 actor 号当**玩家下标**去算坐标（`imul edx,edx,0x68`
    //   + `player + 0x8`），4..8 越出玩家数组 ⇒ 读到物件表，坐标无意义，不复制。
    expect(ask(6, { kind: 'actor', actor: 4 }, CPU)).toBeNull();
    expect(ask(14, { kind: 'actor', actor: 8 }, CPU)).toBeNull();
    expect(ask(30, { kind: 'actor', actor: 4 }, CPU)).toBeNull();
    expect(ask(24, { kind: 'stock', index: 0 }, CPU)).toBeNull();
    expect(ask(2, { kind: 'node', nodeId: 5 }, CPU)).toBeNull();
    expect(ask(2, { kind: 'none' }, CPU)).toBeNull();
  });

  it('不需要目标的卡（均富/購地/改建/拍賣/冬眠/紅黑卡…）根本没有调用点', () => {
    for (const cardId of [1, 3, 7, 8, 15, 18, 19, 20, 21, 22, 24, 25, 28]) {
      expect(ask(cardId, { kind: 'none' }, CPU), `卡 ${cardId}`).toBeNull();
      expect(ask(cardId, { kind: 'player', index: 1 }, CPU), `卡 ${cardId}`).toBeNull();
    }
  });

  it('目标位置查不到（不在图上）就整条不起', () => {
    const none: CardFlightAnchors = {
      player: () => null,
      land: () => null,
      facility: () => null,
      object: () => null,
    };
    expect(cardFlightPlan({
      cardId: 2, whoPlays: CPU, target: { kind: 'player', index: 1 }, actor: ACTOR, anchor: none,
    })).toBeNull();
    expect(cardFlightPlan({
      cardId: 4, whoPlays: CPU, target: { kind: 'entity', entityId: 1 }, actor: ACTOR, anchor: none,
    })).toBeNull();
    expect(cardFlightPlan({
      cardId: 9, whoPlays: CPU, target: { kind: 'facility', facilityId: 1 }, actor: ACTOR, anchor: none,
    })).toBeNull();
    expect(cardFlightPlan({
      cardId: 23, whoPlays: CPU, target: { kind: 'object', objectIndex: 1 }, actor: ACTOR, anchor: none,
    })).toBeNull();
  });

  it('两端点重合时**本函数照样给规格** —— 退化判据在 exe 里、由调用方挡（VA 0x0040e6f2）', () => {
    const p = cardFlightPlan({
      cardId: 2,
      whoPlays: CPU,
      target: { kind: 'player', index: 0 },
      actor: { x: 100, y: 200 }, // 与 anchor.player(0) 完全相同
      anchor,
    });
    expect(p).not.toBeNull();
    expect(p!.from).toEqual(p!.to);
  });

  it('cardFlightTargetKind / cardFlightSite —— 查表口径', () => {
    expect(cardFlightTargetKind({ kind: 'player', index: 0 })).toBe('player');
    expect(cardFlightTargetKind({ kind: 'entity', entityId: 0 })).toBe('entity');
    expect(cardFlightTargetKind({ kind: 'facility', facilityId: 0 })).toBe('facility');
    expect(cardFlightTargetKind({ kind: 'object', objectIndex: 0 })).toBe('object');
    expect(cardFlightTargetKind({ kind: 'actor', actor: 4 })).toBeNull();
    expect(cardFlightTargetKind({ kind: 'none' })).toBeNull();
    expect(cardFlightSite(2, { kind: 'player', index: 0 })?.va).toBe(0x004422d6);
    expect(cardFlightSite(2, { kind: 'entity', entityId: 0 })).toBeNull();
    expect(cardFlightSite(99, { kind: 'player', index: 0 })).toBeNull();
  });
});

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  ★ Q-TOOL-5 ②：附身于人的物件 —— 两张偏移表 + 图号 + 主人可见性
 * ══════════════════════════════════════════════════════════════════════════
 */
describe('★ Q-TOOL-5 ②：附身物件的偏移表 / 图号（VA 0x00409065 起那一段）', () => {
  it('★ 普通那张表就是 0x474951 的 8 项（dy/dx 逐项相同）', () => {
    expect(ATTACHED_OFFSETS).toEqual([
      { dy: -10, dx: -22 },
      { dy: -22, dx: -10 },
      { dy: -22, dx: 10 },
      { dy: -10, dx: 22 },
      { dy: 10, dx: 22 },
      { dy: 22, dx: 10 },
      { dy: 22, dx: -10 },
      { dy: 10, dx: -22 },
    ]);
  });

  it('★ 有神时那张（0x474991）是 18/44 的一圈 —— 比普通的 10/22 **更外圈**', () => {
    expect(ATTACHED_OFFSETS_WITH_GOD).toEqual([
      { dy: -18, dx: -44 },
      { dy: -44, dx: -18 },
      { dy: -44, dx: 18 },
      { dy: -18, dx: 44 },
      { dy: 18, dx: 44 },
      { dy: 44, dx: 18 },
      { dy: 44, dx: -18 },
      { dy: 18, dx: -44 },
    ]);
    // 逐项半径都更大（不是简单 ×2：10→18、22→44）
    ATTACHED_OFFSETS.forEach((o, i) => {
      const g = ATTACHED_OFFSETS_WITH_GOD[i]!;
      expect(Math.abs(g.dy)).toBeGreaterThan(Math.abs(o.dy));
      expect(Math.abs(g.dx)).toBeGreaterThan(Math.abs(o.dx));
    });
  });

  it('图号 = 8 − 视角 + **主人**朝向（与玩家的 screenDirection 同一个公式）', () => {
    for (let view = 0; view < 8; view++) {
      for (let dir = 0; dir < 8; dir++) {
        expect(attachedImageIndex(dir, view)).toBe(screenDirection(dir, view));
      }
    }
    expect(attachedImageIndex(0, 0)).toBe(0);
    expect(attachedImageIndex(0, 1)).toBe(7);
  });

  it('★ 真正贴的帧 = 图号 + 4（槽 +7；放地上的物件写的是图号本身）', () => {
    expect(attachedFrameIndex(0)).toBe(4);
    expect(attachedFrameIndex(4)).toBe(0);
    expect(attachedFrameIndex(7)).toBe(3);
  });

  it('★ 定時炸彈(18) + 主人身上已有神 → 大圈；差一个条件就回小圈', () => {
    expect(attachedOffset(18, 1, 0)).toEqual({ dy: -18, dx: -44 });
    expect(attachedOffset(18, 0, 0)).toEqual({ dy: -10, dx: -22 }); // 主人没神
    expect(attachedOffset(5, 1, 0)).toEqual({ dy: -10, dx: -22 }); // 不是炸弹
    expect(attachedOffset(18, 1, 5)).toEqual(ATTACHED_OFFSETS_WITH_GOD[5]);
    expect(attachedOffset(16, 0, 3)).toEqual(ATTACHED_OFFSETS[3]);
  });

  it('★ 主人住店/消失/坐牢/住院 → 整个不画；**冬眠不算**（只比 +0x32 那一个 dword）', () => {
    const clean = { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0 };
    expect(attachedOwnerVisible(clean)).toBe(true);
    expect(attachedOwnerVisible({ ...clean, inHotel: 1 })).toBe(false);
    expect(attachedOwnerVisible({ ...clean, disappearing: 2 })).toBe(false);
    expect(attachedOwnerVisible({ ...clean, inPrison: 3 })).toBe(false);
    expect(attachedOwnerVisible({ ...clean, inHospital: 4 })).toBe(false);
  });
});
