/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 物件落点效果
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { makeObjects } from '../cards/summon.ts';
import { emptyTools, initialToolStock, toolCount } from './tools.ts';
import { OBJECT_COUNT, godModifiersOf, partnerSlot, slotRangeForType } from './objects.ts';
import { OBJECT_NAMES } from './purchase.ts';
import type { ObjectWorld } from './object-landing.ts';
import {
  BOMB_FUSE,
  HOSPITAL_DAYS_BOMB,
  HOSPITAL_DAYS_HURT,
  INITIAL_OBJECT_TYPES,
  TREASURE_POINTS,
  attachGod,
  drawGiftTool,
  OBJECT_DISTANT_MAX_TRIES,
  OBJECT_DISTANT_MIN,
  objectNodeCandidates,
  pickObjectNode,
  pickObjectNodeDistant,
  placeObjectOfType,
  releaseObject,
  resolveArrival,
  tickGod,
} from './object-landing.ts';

/** 四人世界，物件表按原版布局，道具库存为初始值 */
function world(over: Partial<ObjectWorld> = {}): ObjectWorld {
  return {
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, nodeId: 10 + i })),
    objects: makeObjects(OBJECT_COUNT),
    tools: emptyTools(4),
    toolStock: initialToolStock(),
    ...over,
  };
}

/** 把某个种类的物件摆到某格，返回 (世界, handle) */
function withObject(w: ObjectWorld, type: number, nodeId: number): [ObjectWorld, number] {
  const r = placeObjectOfType(w.objects, type, nodeId);
  return [{ ...w, objects: r.objects }, r.slot + 1];
}

const arrive = (
  w: ObjectWorld,
  handle: number,
  over: Partial<Parameters<typeof resolveArrival>[0]> = {},
) =>
  resolveArrival({
    world: w,
    playerIndex: 0,
    handle,
    landId: 0,
    stepsRemaining: 0,
    othersHere: [],
    randValue: 0,
    ...over,
  });

// ============================================================

describe('槽位分区 —— 下标决定种类', () => {
  it('唯一物件各占一格：种类 n 住在槽 n-1', () => {
    for (let type = 1; type <= 14; type++) {
      expect(slotRangeForType(type)).toEqual({ from: type - 1, to: type });
    }
  });

  it('死神两格、三种陷阱各十格', () => {
    expect(slotRangeForType(15)).toEqual({ from: 14, to: 16 });
    expect(slotRangeForType(16)).toEqual({ from: 16, to: 26 });
    expect(slotRangeForType(17)).toEqual({ from: 26, to: 36 });
    expect(slotRangeForType(18)).toEqual({ from: 36, to: 46 });
  });

  it('★ 分区与物件种类表严丝合缝 —— 放进去的槽位，种类必须本来就对', () => {
    const base = makeObjects(OBJECT_COUNT);
    for (let type = 1; type <= 18; type++) {
      const r = placeObjectOfType(base, type, 7);
      expect(r.slot).toBeGreaterThanOrEqual(0);
      // 槽位原本登记的种类就是 type —— 放置不需要、也不会改写种类
      expect(base[r.slot]!.type).toBe(type);
    }
  });
});

describe('搭档配对', () => {
  it('0..11 六对互为搭档', () => {
    expect([0, 1, 2, 3, 10, 11].map(partnerSlot)).toEqual([1, 0, 3, 2, 11, 10]);
  });

  it('★ 12 及以后没有搭档 —— 禮物、寶箱、死神、陷阱走了就没了', () => {
    expect(partnerSlot(12)).toBe(-1); // 禮物
    expect(partnerSlot(13)).toBe(-1); // 寶箱
    expect(partnerSlot(14)).toBe(-1); // 死神
    expect(partnerSlot(16)).toBe(-1); // 路障
  });

  it('惡犬的搭档是土地公 —— 一凶一吉', () => {
    expect(OBJECT_NAMES[11]).toBe('惡犬');
    expect(OBJECT_NAMES[12]).toBe('土地公');
    expect(partnerSlot(10)).toBe(11);
  });
});

describe('神明的三项修正', () => {
  it('財神系加財運、福神系加福運，各自不串', () => {
    expect(godModifiersOf(1)).toEqual({ misfortune: -100, fortune: 100, luck: 0 });
    expect(godModifiersOf(3)).toEqual({ misfortune: -100, fortune: 0, luck: 100 });
  });

  it('★ 死神是最狠的一个：衰運 +1000，両運各 −200', () => {
    expect(godModifiersOf(15)).toEqual({ misfortune: 1000, fortune: -200, luck: -200 });
  });

  it('附身加上、离身减掉，来回一趟必须归零', () => {
    const w = world();
    const a = attachGod(w, 0, 2); // handle 2 = 槽 1 = 大財神
    expect(a.ok).toBe(true);
    expect(a.players[0]!.fortune).toBe(150);
    expect(a.players[0]!.misfortune).toBe(-200);
    expect(a.players[0]!.godInfo).toBe(2);

    const r = releaseObject(a, 2);
    expect(r.players[0]!.fortune).toBe(0);
    expect(r.players[0]!.misfortune).toBe(0);
    expect(r.players[0]!.godInfo).toBe(0);
  });

  it('★ 换神时旧的先送走，修正不会叠加', () => {
    const w = world();
    const a = attachGod(w, 0, 2); // 大財神 +150 財運
    const b = attachGod(a, 0, 6); // handle 6 = 槽 5 = 大窮神 −100 財運
    expect(b.players[0]!.fortune).toBe(-100);
    expect(b.displaced).toBe(2);
    // 大財神被挤走，它的搭档（槽 0 小財神）该登场
    expect(b.respawn).toEqual({ partner: 0, nearNode: 10 });
    expect(b.objects[1]!.attached).toBe(0);
  });
});

describe('任期', () => {
  it('神明附身 7 天、死神 13 天', () => {
    const w = world();
    expect(attachGod(w, 0, 1).objects[0]!.state).toBe(7);
    // handle 15 = 槽 14 = 死神
    expect(attachGod(w, 0, 15).objects[14]!.state).toBe(13);
  });

  it('★ 每回合减一，减到 0 神明自己走人、搭档登场', () => {
    let w: ObjectWorld = attachGod(world(), 0, 1);
    for (let day = 1; day <= 6; day++) {
      const t = tickGod(w, 0);
      expect(t.expired).toBe(false);
      expect(t.objects[0]!.state).toBe(7 - day);
      w = t;
    }
    const last = tickGod(w, 0);
    expect(last.expired).toBe(true);
    expect(last.players[0]!.godInfo).toBe(0);
    expect(last.players[0]!.fortune).toBe(0);
    expect(last.respawn).toEqual({ partner: 1, nearNode: 10 });
  });

  it('身上没神明时什么都不做', () => {
    expect(tickGod(world(), 0).expired).toBe(false);
  });
});

describe('踩上去：神明', () => {
  it('停下来才附身', () => {
    const [w, h] = withObject(world(), 1, 10);
    expect(arrive(w, h).players[0]!.godInfo).toBe(h);
  });

  it('★ 路过不附身 —— 还有步数就当没看见', () => {
    const [w, h] = withObject(world(), 1, 10);
    const r = arrive(w, h, { stepsRemaining: 3 });
    expect(r.players[0]!.godInfo).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('★ 死神踩上去什么也不发生 —— 它是自己追上来的', () => {
    const [w, h] = withObject(world(), 15, 10);
    const r = arrive(w, h);
    expect(r.players[0]!.godInfo).toBe(0);
    expect(r.events).toEqual([]);
    // 死神仍在原地
    expect(r.objects[14]!.nodeId).toBe(10);
  });
});

describe('踩上去：惡犬', () => {
  it('徒步被咬 —— 住院 3 天并停步', () => {
    const [w, h] = withObject(world(), 11, 10);
    const r = arrive(w, h);
    expect(r.hospitalDays).toBe(HOSPITAL_DAYS_HURT);
    expect(r.stopMovement).toBe(true);
    expect(r.events).toContainEqual({ kind: 'dogBite', blockedByVehicle: false });
  });

  it('★ 有车就咬不到 —— 不住院、不停步、车也不掉', () => {
    const base = world();
    const drivers = base.players.map((p, i) => (i === 0 ? { ...p, trafficMethod: 2 } : p));
    const [w, h] = withObject({ ...base, players: drivers }, 11, 10);
    const r = arrive(w, h);
    expect(r.hospitalDays).toBe(0);
    expect(r.stopMovement).toBe(false);
    expect(r.vehicleWrecked).toBe(false);
    expect(r.players[0]!.trafficMethod).toBe(2);
    expect(r.events).toContainEqual({ kind: 'dogBite', blockedByVehicle: true });
  });

  it('★ 咬完之后土地公登场 —— 惡犬与土地公是一对', () => {
    const [w, h] = withObject(world(), 11, 10);
    expect(arrive(w, h).respawn).toEqual({ partner: 11, nearNode: 10 });
  });
});

describe('踩上去：禮物与寶箱', () => {
  it('禮物给一个道具，并按库存加权抽', () => {
    const [w, h] = withObject(world(), 13, 10);
    const r = arrive(w, h);
    const ev = r.events.find((e) => e.kind === 'gift');
    expect(ev).toBeDefined();
    expect(r.randConsumed).toBe(true);
    const toolId = (ev as { toolId: number }).toolId;
    expect(toolCount(r.tools, 0, toolId)).toBe(1);
  });

  it('★ 只抽 1..8 号 —— 后五个道具不限量，反而永远抽不到', () => {
    const stock = initialToolStock();
    for (let r = 0; r < 200; r++) {
      const id = drawGiftTool(stock, r);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(8);
    }
  });

  it('★ 库存越多越容易抽到；库存全空则什么都不给', () => {
    // 只剩 3 号地雷有货 → 必抽到 3
    const only3 = initialToolStock().map((_, i) => (i === 3 ? 5 : 0));
    for (let r = 0; r < 20; r++) expect(drawGiftTool(only3, r)).toBe(3);
    expect(drawGiftTool(new Array<number>(14).fill(0), 7)).toBe(0);
  });

  it('★ 抽不到东西时不消耗随机数、也不把禮物收走', () => {
    const empty = new Array<number>(14).fill(0);
    const [w, h] = withObject(world({ toolStock: empty }), 13, 10);
    const r = arrive(w, h);
    expect(r.randConsumed).toBe(false);
    expect(r.objects[12]!.nodeId).toBe(10);
  });

  it('寶箱给 500 點', () => {
    const [w, h] = withObject(world(), 14, 10);
    const r = arrive(w, h);
    expect(r.players[0]!.points).toBe(TREASURE_POINTS);
    expect(TREASURE_POINTS).toBe(500);
  });

  it('★ 禮物与寶箱没有搭档 —— 拿走就不再出现', () => {
    const [w, h] = withObject(world(), 14, 10);
    expect(arrive(w, h).respawn).toBeNull();
  });
});

describe('踩上去：路障', () => {
  it('★ 路障是唯一半途也拦你的物件', () => {
    const [w, h] = withObject(world(), 16, 10);
    const r = arrive(w, h, { stepsRemaining: 5 });
    expect(r.stopMovement).toBe(true);
    expect(r.events).toContainEqual({ kind: 'roadblock' });
  });

  it('拦下之后回收成道具库存', () => {
    const [w, h] = withObject(world(), 16, 10);
    const before = w.toolStock[2] ?? 0;
    expect(arrive(w, h).toolStock[2]).toBe(before + 1);
  });
});

describe('踩上去：地雷', () => {
  it('停下来才炸；炸了住院 3 天并毁车', () => {
    const base = world();
    const drivers = base.players.map((p, i) => (i === 0 ? { ...p, trafficMethod: 2, ndices: 3 } : p));
    const [w, h] = withObject({ ...base, players: drivers }, 17, 10);

    expect(arrive(w, h, { stepsRemaining: 2 }).events).toEqual([]);

    const r = arrive(w, h);
    expect(r.hospitalDays).toBe(HOSPITAL_DAYS_HURT);
    expect(r.vehicleWrecked).toBe(true);
    expect(r.players[0]!.trafficMethod).toBe(0);
    expect(r.players[0]!.ndices).toBe(1);
    // ★ 车回的是**全局库存**，不是玩家道具栏
    expect(r.toolStock[6]).toBe((w.toolStock[6] ?? 0) + 1);
    expect(toolCount(r.tools, 0, 6)).toBe(0);
  });

  it('★ 已在医院/监狱里的人，车是毁不掉的（原版先查 +0x32 那个 dword）', () => {
    const base = world();
    const hurt = base.players.map((p, i) =>
      i === 0 ? { ...p, trafficMethod: 2, blocking: { ...p.blocking, inHospital: 2 } } : p,
    );
    const [w, h] = withObject({ ...base, players: hurt }, 17, 10);
    const r = arrive(w, h);
    expect(r.vehicleWrecked).toBe(false);
    expect(r.players[0]!.trafficMethod).toBe(2);
  });
});

describe('定時炸彈', () => {
  const bombWorld = (): [ObjectWorld, number] => withObject(world(), 18, 10);

  it('捡起来，引信 38 格', () => {
    const [w, h] = bombWorld();
    const r = arrive(w, h);
    expect(r.players[0]!.f64).toBe(h);
    expect(r.objects[h - 1]!.state).toBe(BOMB_FUSE);
    expect(BOMB_FUSE).toBe(38);
  });

  it('手上已经有一个就不再捡', () => {
    const [w0, h0] = bombWorld();
    const carrying = arrive(w0, h0);
    const [w1, h1] = withObject(carrying, 18, 10);
    // 第二次到同一格：引信先走一格，然后**不捡**第二颗
    const r = arrive(w1, h1);
    expect(r.players[0]!.f64).toBe(h0);
    expect(r.objects[h1 - 1]!.nodeId).toBe(10);
  });

  it('★ 每到一格减一 —— 是格数，不是天数', () => {
    let w: ObjectWorld = arrive(...bombWorld());
    const h = w.players[0]!.f64;
    for (let step = 1; step <= 3; step++) {
      w = arrive(w, 0);
      expect(w.objects[h - 1]!.state).toBe(BOMB_FUSE - step);
    }
  });

  it('★ 同格有别人就传过去 —— 挑下标最小的那个', () => {
    let w: ObjectWorld = arrive(...bombWorld());
    const h = w.players[0]!.f64;
    const r = resolveArrival({
      world: w,
      playerIndex: 0,
      handle: 0,
      landId: 0,
      stepsRemaining: 0,
      othersHere: [3, 2],
      randValue: 0,
    });
    expect(r.players[0]!.f64).toBe(0);
    expect(r.players[2]!.f64).toBe(h);
    expect(r.objects[h - 1]!.attached).toBe(3);
    expect(r.events).toContainEqual({ kind: 'bombPassed', to: 2 });
    w = r;
  });

  it('对方手上已有炸彈就不传', () => {
    const w0 = arrive(...bombWorld());
    const h = w0.players[0]!.f64;
    const busy = w0.players.map((p, i) => (i === 1 ? { ...p, f64: 99 } : p));
    const r = resolveArrival({
      world: { ...w0, players: busy },
      playerIndex: 0,
      handle: 0,
      landId: 0,
      stepsRemaining: 0,
      othersHere: [1],
      randValue: 0,
    });
    expect(r.players[0]!.f64).toBe(h);
  });

  it('★ 引信走完就炸：住院 5 天、停步、拆房、炸彈回库存', () => {
    let w: ObjectWorld = arrive(...bombWorld());
    const h = w.players[0]!.f64;
    const stockBefore = w.toolStock[4] ?? 0;
    // 走到只剩一格
    for (let i = 1; i < BOMB_FUSE; i++) w = arrive(w, 0);
    expect(w.objects[h - 1]!.state).toBe(1);

    const boom = arrive(w, 0, { landId: 42 });
    expect(boom.hospitalDays).toBe(HOSPITAL_DAYS_BOMB);
    expect(boom.stopMovement).toBe(true);
    expect(boom.demolishLand).toBe(42);
    expect(boom.players[0]!.f64).toBe(0);
    expect(boom.objects[h - 1]!.attached).toBe(0);
    expect(boom.toolStock[4]).toBe(stockBefore + 1);
    expect(boom.events).toContainEqual({ kind: 'bombExploded', landId: 42 });
  });

  it('★ 炸了就不再结算脚下的物件 —— 原版直接跳到收尾', () => {
    let w: ObjectWorld = arrive(...bombWorld());
    for (let i = 1; i < BOMB_FUSE; i++) w = arrive(w, 0);
    const [w2, h2] = withObject(w, 14, 10); // 脚下摆个寶箱
    const boom = arrive(w2, h2);
    expect(boom.events.some((e) => e.kind === 'bombExploded')).toBe(true);
    expect(boom.players[0]!.points).toBe(0); // 寶箱没拿到
    expect(boom.objects[h2 - 1]!.nodeId).toBe(10);
  });
});

describe('开局投放', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    walkable: i % 3 !== 0,
    noObjects: i === 4,
  }));

  it('只挑可走且未禁放的格子', () => {
    const c = objectNodeCandidates(nodes);
    expect(c).not.toContain(1); // 不可走
    expect(c).not.toContain(5); // 禁放
    expect(c).toContain(2);
  });

  it('按随机数取模挑一格；没有候选返回 0', () => {
    expect(pickObjectNode([7, 8, 9], 4)).toBe(8);
    expect(pickObjectNode([], 3)).toBe(0);
  });

  it('★ 开局只放「小的那一半」，大神要等搭档被请走才登场', () => {
    expect(INITIAL_OBJECT_TYPES).toEqual([1, 3, 5, 7, 9, 11, 13, 14]);
    const placed = INITIAL_OBJECT_TYPES.map((t) => OBJECT_NAMES[t]);
    expect(placed).toEqual(['小財神', '小福神', '小窮神', '小衰神', '天使', '惡犬', '禮物', '寶箱']);
    // 大財神/大福神/大窮神/大衰神/惡魔/土地公 一个都不在开局名单里
    for (const big of [2, 4, 6, 8, 10, 12]) {
      expect(INITIAL_OBJECT_TYPES).not.toContain(big);
    }
  });
});

// ============================================================
//  ★ Q-OBJ-2：远距重抽 @source `_rich4_find_random_unoccupied_distant_node`
//    VA 0x0040aadf 起（`rich4_node_utils.asm:100-127`）
// ============================================================

describe('★ 远距重抽（Q-OBJ-2）', () => {
  /** 4 个节点排成一条线，间距 400 —— 只有 1 号与 4 号相距 1200 */
  const xy = new Map([
    [1, { x: 0, y: 0 }],
    [2, { x: 400, y: 0 }],
    [3, { x: 800, y: 0 }],
    [4, { x: 1200, y: 0 }],
  ]);
  const at = (id: number): { x: number; y: number } | null => xy.get(id) ?? null;

  it('阈值 = 0x12c（300）@source `cmp eax, 0x12c`', () => {
    expect(OBJECT_DISTANT_MIN).toBe(300);
  });

  it('★ 参照点 0 ⇒ **一次都不重抽**（`cmp dword [esp+0x118], 0 / je`）', () => {
    const draws: number[] = [1, 2, 3, 4, 5];
    let i = 0;
    const node = pickObjectNodeDistant([1, 2, 3, 4], 0, at, () => draws[i++]!);
    // 第一个 draw(1) % 4 = 1 → 候选[1] = 2；只抽了一次
    expect(node).toBe(2);
    expect(i).toBe(1);
  });

  it('★ 抽到的点**离参照点够远**（任一轴 ≥ 300）就收下', () => {
    // 参照 = 1（x=0）。draw 2 % 4 = 2 → 候选[2] = 3（x=800）⇒ |dx| = 800 ≥ 300 → 收
    let i = 0;
    const draws = [2];
    expect(pickObjectNodeDistant([1, 2, 3, 4], 1, at, () => draws[i++]!)).toBe(3);
    expect(i).toBe(1);
  });

  it('★ **两轴都近**就重抽（不是「都远才收」—— 文档先前写反了）', () => {
    // 参照 = 1。draw 1 % 4 = 1 → 候选[1] = 2（x=400，|dx|=400 ≥ 300）→ 收！所以
    // 要造一个真近的：把参照换成 2，抽到 1（x=0 ⇒ |dx|=400）也够远…
    // ⇒ 直接用间距 100 的一对，才看得出重抽。
    const near = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 100, y: 0 }], // 两轴都 < 300
      [3, { x: 500, y: 0 }], // |dx| ≥ 300
    ]);
    const at2 = (id: number): { x: number; y: number } | null => near.get(id) ?? null;
    // draw 1 % 3 = 1 → 候选[1] = 2（太近，重抽）；draw 0 % 3 = 0 → 候选[0] = 1（也近！重抽）
    // draw 2 % 3 = 2 → 候选[2] = 3（够远，收）
    const draws = [1, 0, 2];
    let i = 0;
    expect(pickObjectNodeDistant([1, 2, 3], 1, at2, () => draws[i++]!)).toBe(3);
    expect(i).toBe(3); // ★ 真的重抽了两次
  });

  it('★ 换轴的判据是 OR：x 够远就收（不必两轴都远）', () => {
    const cross = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 0, y: 500 }], // |dx| = 0 但 |dy| = 500 ≥ 300
    ]);
    const at2 = (id: number): { x: number; y: number } | null => cross.get(id) ?? null;
    const draws = [1];
    let i = 0;
    expect(pickObjectNodeDistant([1, 2], 1, at2, () => draws[i++]!)).toBe(2);
    expect(i).toBe(1);
  });

  it('★ 一个够远的都没有时**不会挂死**（试满 `OBJECT_DISTANT_MAX_TRIES` 收最后一次）', () => {
    const tiny = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 10, y: 10 }],
    ]);
    const at2 = (id: number): { x: number; y: number } | null => tiny.get(id) ?? null;
    let n = 0;
    const node = pickObjectNodeDistant([1, 2], 1, at2, () => {
      n++;
      return 1; // 永远抽到候选[1] = 2（太近）
    });
    expect(node).toBe(2);
    // ★ 原版这里会**死转**；本引擎按上界收手（已登记为偏离）
    expect(n).toBe(OBJECT_DISTANT_MAX_TRIES);
  });

  it('候选空 ⇒ 0（与原版 `idiv` 之前没有候选的情形同义）', () => {
    expect(pickObjectNodeDistant([], 3, at, () => 0)).toBe(0);
  });

  it('参照节点的坐标取不到时按「收下」处理（原版不会有这种节点）', () => {
    const draws = [0];
    let i = 0;
    expect(pickObjectNodeDistant([1, 2], 99, at, () => draws[i++]!)).toBe(1);
    expect(i).toBe(1);
  });

  it('★ 无参照那一半仍然照旧（`pickObjectNode` 直接取模）', () => {
    expect(pickObjectNode([4, 5, 6], 7)).toBe(5);
    expect(pickObjectNode([], 7)).toBe(0);
  });
});
