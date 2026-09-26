/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 物件接进引擎之后：开局在场、踩到生效、任期到点离场、破产不漏
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame as newGameRaw } from '../rules/new-game.ts';
import { landAll } from '../testing/factories.ts';
import { decideAction } from '../ai/policy.ts';
import { applyBankruptcy, reduce, isGameOver } from './reduce.ts';
import { isAlive } from './types.ts';
import type { GameState } from './types.ts';
import { INITIAL_OBJECT_TYPES, OBJECT_TYPE_ROADBLOCK, objectNodeCandidates, pickObjectNodeDistant, placeObjectOfType, runtimeOccupiedNodes } from '../rules/object-landing.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { OBJECT_NAMES } from '../rules/purchase.ts';
import { objectTypeOf } from '../rules/objects.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { facilityIndexOf, housingIndexOf } from '../rules/land.ts';

/**
 * 夹具：「第一輪已经过去」—— 这里测的不是开局，要的是大家都已在盘上
 * （`newGame` 只摆第 1 位，其余轮到自己才落地，见 `rules/start-placement.ts`）。
 */
const newGame = (o: Parameters<typeof newGameRaw>[0]): ReturnType<typeof newGameRaw> =>
  landAll(newGameRaw(o), o.map.nodes);

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

function fresh(seed = 7): { state: GameState; topo: ReturnType<typeof topoOf> } {
  const map = loadMap();
  return {
    state: newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed,
    }),
    topo: topoOf(map),
  };
}
const topoOf = (map: ReturnType<typeof loadMap>) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

/** 场上（不在谁身上）的物件 */
const onMap = (s: GameState) => s.objects.filter((o) => o.nodeId !== 0 && o.attached === 0);

describe('★ 开局地图上真的有神明', () => {
  run('八个物件在场，种类正好是开局名单', () => {
    const { state } = fresh();
    const placed = onMap(state);
    expect(placed).toHaveLength(INITIAL_OBJECT_TYPES.length);
    expect(placed.map((o) => o.type).sort((a, b) => a - b)).toEqual([...INITIAL_OBJECT_TYPES]);
  });

  run('都落在可走、未禁放的格子上，且互不重叠', () => {
    const { state, topo } = fresh();
    const nodes = new Map(topo.nodes.map((n) => [n.id, n]));
    const seen = new Set<number>();
    for (const o of onMap(state)) {
      const n = nodes.get(o.nodeId);
      expect(n, `节点 ${o.nodeId} 不存在`).toBeDefined();
      expect(n!.walkable).toBe(true);
      expect(n!.noObjects).toBe(false);
      expect(seen.has(o.nodeId), `${OBJECT_NAMES[o.type]} 与别人叠在同一格`).toBe(false);
      seen.add(o.nodeId);
    }
  });

  run('换个种子，位置会不同 —— 确实是抽出来的', () => {
    const a = onMap(fresh(7).state).map((o) => o.nodeId);
    const b = onMap(fresh(99).state).map((o) => o.nodeId);
    expect(a).not.toEqual(b);
  });
});

describe('★ 踩上去：从 reduce 这一层看', () => {
  /** 把玩家 0 挪到某格、摆好物件，然后走一步过去 */
  function stepOnto(type: number, steps = 1, playerOver: Record<string, unknown> = {}) {
    const { state, topo } = fresh();
    // 找一段能走的路：node → 它的第一个邻居
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    // 清场，只留我们要测的那一个
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const objects = placeObjectOfType(cleared, type, to).objects;
    const start: GameState = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, ...playerOver } : p)),
      objects,
      phase: 'moving',
      stepsRemaining: steps,
      stepsTotal: steps,
    };
    return { before: start, after: reduce(start, { type: 'step' }, topo), topo, node: to };
  }

  run('走到小財神那格 → 附身，財運 +100', () => {
    const { after } = stepOnto(1);
    expect(after.players[0]!.godInfo).toBe(1);
    expect(after.players[0]!.fortune).toBe(100);
    expect(after.players[0]!.misfortune).toBe(-100);
    // 已附身 → 不再站在地图上
    expect(onMap(after)).toHaveLength(0);
  });

  run('★ 路障半途就把人钉住 —— 剩余步数直接归零', () => {
    const { after } = stepOnto(16, 5);
    expect(after.stepsRemaining).toBe(0);
    expect(after.phase).toBe('settling');
  });

  run('★ 神明路过不生效 —— 还有 5 步时踩上去什么也不发生', () => {
    const { after } = stepOnto(1, 5);
    expect(after.players[0]!.godInfo).toBe(0);
    expect(after.stepsRemaining).toBe(4);
  });

  /*
   * ★★ 第九份试玩回报 #5（Charles，2026-09-22）：
   *   「路障和神灵重合时经过路障没有把我阻拦下来」。
   *
   *   两份回报的 `finalState.objects` 里**节点 86 同时有**
   *   `[0] type=1（小財神, attached=0）` 与 `[16] type=16（路障, attached=0）`。
   *   原版靠地图节点里的反向索引 `node+0x26` 取种类 —— `place_object` 往里**按位或**
   *   槽号（`rich4_objects.asm:118-126`），`1 | 17 = 17` ⇒ 读到的是**路障** ⇒ 照样拦人。
   *   `objectHandleAt` 先前取**下标最小**的那件（恒取神明），而神明那一支带
   *   `if (moving) return`（@source `0x41c164`）⇒ 路过时什么都不发生。
   */
  run('★★ 神明与路障同格：路障照样半途拦人（不再被神明顶掉）', () => {
    const { state, topo } = fresh();
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    // 先摆神明（槽 0），再摆路障（槽 16）—— 路障槽号更大，正是原版 OR 压过去的方向
    const withGod = placeObjectOfType(cleared, 1, to).objects;
    const both = placeObjectOfType(withGod, OBJECT_TYPE_ROADBLOCK, to).objects;
    expect(both.filter((o) => o.nodeId === to && o.attached === 0), '两件确实同格').toHaveLength(2);

    const start: GameState = { ...state, objects: both, phase: 'moving', stepsRemaining: 5, stepsTotal: 5 };
    const after = reduce(start, { type: 'step' }, topo);
    expect(after.stepsRemaining, '还剩 5 步时踩上路障 ⇒ 当场清零').toBe(0);
    expect(after.phase).toBe('settling');
    expect(after.players[0]!.godInfo, '路过不该附身').toBe(0);
  });

  run('★ 同一根因的另一族：路障与地雷同格 ⇒ 取到的是槽号更大的地雷（原版 17|27 = 27）', () => {
    const { state, topo } = fresh();
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    // 路障 = 槽 16（handle 17）、地雷 = 槽 26（handle 27）；原版 OR 得 27 ⇒ 地雷。
    // ⚠️ 地雷那一支自己也有 `if (moving) return`（`object-landing.ts:711`，踩停才炸），
    //    所以这里要「停在这一格」而不是「路过」—— 与神明那一支同理。
    const withBlock = placeObjectOfType(cleared, OBJECT_TYPE_ROADBLOCK, to).objects;
    const both = placeObjectOfType(withBlock, 17, to).objects;
    const start: GameState = { ...state, objects: both, phase: 'moving', stepsRemaining: 1, stepsTotal: 1 };
    const after = reduce(start, { type: 'step' }, topo);
    expect(after.players[0]!.blocking.inHospital, '地雷生效 ⇒ 住院').toBeGreaterThan(0);
  });

  /*
   * ★★ 2026-09-25（本分支）：那一字节是**按位或**（`0x0040e13c or [node+0x24],(槽+1)<<16`），
   *   不是「取最大槽号」—— 两者在 `1|17` / `17|27` 这两对上恰好相同，所以先前看不出来。
   *   找一个 OR 落到**第三个槽**的组合：死神（种类 15，唯一槽段 14..15 ⇒ handle 15）
   *   与路障（种类 16，槽段 16..25 ⇒ 空着时取槽 16、handle 17）⇒ `15 | 17 = 31` ⇒ 槽 30，
   *   而 `OBJECT_TYPE_TABLE[30] = 17`（地雷）。原版随后正是拿这一字节去查
   *   `objects[字节-1].type`（0x0041b4ca..db）并按它跳表（0x41b3e5）⇒ 这一格是**地雷**。
   */
  run('★★ 逐位 OR：死神(handle 15) 与路障(handle 17) 同格 ⇒ 15|17 = 31 ⇒ 槽 30 的地雷', () => {
    const { state, topo } = fresh();
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const withReaper = placeObjectOfType(cleared, 15, to).objects;
    const both = placeObjectOfType(withReaper, OBJECT_TYPE_ROADBLOCK, to).objects;
    expect(both[14]!.nodeId, '死神落在槽 14（handle 15）').toBe(to);
    expect(both[16]!.nodeId, '路障落在槽 16（handle 17）').toBe(to);
    // 15 | 17 = 31 ⇒ 原版读到的是槽 30；三个槽的种类先钉住（槽位决定种类）
    expect([objectTypeOf(14), objectTypeOf(16), objectTypeOf(30)]).toEqual([15, 16, 17]);

    const start: GameState = { ...state, objects: both, phase: 'moving', stepsRemaining: 1, stepsTotal: 1 };
    const after = reduce(start, { type: 'step' }, topo);
    // 地雷：住院 3 天（路障那一支只会把剩余步数清零，不住院）
    expect(after.players[0]!.blocking.inHospital).toBe(3);
  });

  run('地雷 → 住院 3 天，占用表也置位', () => {
    const { after } = stepOnto(17);
    expect(after.players[0]!.blocking.inHospital).toBe(3);
    expect(after.hospitalOccupancy[0]).toBe(1);
    expect(after.stepsRemaining).toBe(0);
  });

  // ★★ 2026-09-18：原版 `send_to_hospital` 的**函数体内**含「传送到医院格 +
  //   跟班搬家」（`@source 0x43ecad`..`0x43ed14`），所以首次住院的人**不在**原地。
  //   先前 remake 只写计数 ⇒ 伤者还站在雷上。差分证据见
  //   `rich4-spec/tests/test_confinement_teleport.py`（48/48）。
  run('★ 地雷 → 首次住院：nodeId ← 醫院格（`type` 0x1f41 的那一格），而 x/y ← **醫院大樓（景观记录 1）**', () => {
    const { before, after, topo } = stepOnto(17);
    const map = loadMap();
    // ★★ 关押格 = 节点 `type` == 0x1f41（原版 `[0x48bae2]`，载入时扫出来），
    //    不是 `specialKind` 5 的醫院**落点**格 —— 0001.bin 上分别是 23 与 16。
    const gate = topo.nodes.find((n) => n.type === 0x1f41);
    expect(gate).toBeDefined();
    expect(before.players[0]!.nodeId).not.toBe(gate!.id);
    expect(after.players[0]!.nodeId).toBe(gate!.id);
    // ★★ 第 86 条：原版把**屏幕坐标**取自特殊景观记录（`@source 0x43ecef`
    //   `mov si, word [eax + 0x1c]` = 记录 1），而 `nodeId` 是棋盘上的醫院格 ——
    //   两者**不是同一个地方**（这是"住院的人躺在醫院大樓里"的由来）。
    //   景观表 1 基（0 号槽哨兵）⇒ 记录 1 = 本引擎 `landscapes[0]`。
    const hospitalLand = map.landscapes[0]!;
    expect(hospitalLand.name).toBe('醫院');
    expect([after.players[0]!.xpos, after.players[0]!.ypos]).toEqual([
      hospitalLand.x,
      hospitalLand.y,
    ]);
    expect([after.players[0]!.xpos, after.players[0]!.ypos]).not.toEqual([gate!.x, gate!.y]);
    expect(after.players[0]!.lastNodeId).toBe(0);
  });

  run('★ 跟班神明跟着搬进医院格（`call 0x40fc00`）', () => {
    const { after, topo } = stepOnto(17, 1, { godInfo: 1 });
    const gate = topo.nodes.find((n) => n.type === 0x1f41);
    expect(after.objects[0]!.nodeId).toBe(gate!.id);
  });

  // ★★ 原版把 x/y 取自**特殊景观记录**（入監 → 记录 **2** = 綠島；入院 → 记录 **1** =
  //   醫院大樓），而 `nodeId` 取的是**关押格** = `type` 为 0x1f42/0x1f41 的那一格
  //   （監獄 1 @(1752,1871)、醫院 23 @(384,1056)）；另一组是带保釋菜单的
  //   **落点**特殊格（監獄 12 @(1248,1583)、醫院 16 @(767,1631)）。
  //   @source 0x0043d63e..0x0043d652（監獄 +0x38/+0x3a）、0x0043ecea..0x0043ecfe（醫院 +0x1c/+0x1e）
  //   @source 关押格 0x0040803f/0x0040805f（載入時挑 `type` == 0x1f41/0x1f42）
  //   ★ 景观表是 **1 基**（`[0x498e78] + k*0x1c`，k 从 1 起；加载循环 `0x407f17`/`0x407f35`），
  //     所以「记录 1」= 本引擎 `landscapes[0]`、「记录 2」= `landscapes[1]`。
  run('★ 景观记录的编号与身份（綠島 = 记录 2、醫院 = 记录 1）——关押坐标偏离的依据', () => {
    const map = loadMap();
    expect(map.landscapes[0]!.name).toBe('醫院'); // 1 基的记录 1
    expect(map.landscapes[1]!.name).toBe('綠島'); // 1 基的记录 2
    const hospital = map.nodes.find((n) => n.type === 0x1f41)!;
    const prison = map.nodes.find((n) => n.type === 0x1f42)!;
    // 节点坐标与景观坐标确实不同 —— 这正是 D-CONFINE-1 记的那处偏离
    expect([hospital.x, hospital.y]).not.toEqual([
      map.landscapes[0]!.x,
      map.landscapes[0]!.y,
    ]);
    expect([prison.x, prison.y]).not.toEqual([map.landscapes[1]!.x, map.landscapes[1]!.y]);
  });

  run('★ 已经住院的人再中一次 → 加刑，**不**传送（原版加刑分支没有那几行）', () => {
    const { after, topo } = stepOnto(17, 1, { blocking: { inHospital: 2 } });
    const gate = topo.nodes.find((n) => n.type === 0x1f41);
    expect(after.players[0]!.blocking.inHospital).toBe(5);
    expect(after.players[0]!.nodeId).not.toBe(gate!.id);
  });

  run('寶箱 → 點數 +500', () => {
    const { before, after } = stepOnto(14);
    expect(after.players[0]!.points).toBe(before.players[0]!.points + 500);
  });

  run('★★ 點券是 16 位字段：65500 + 500 **回绕**成 164（原版 `add word`）', () => {
    // @source 0x0041bb62 `add word [player + 0x496b98], 0x1f4`
    //   机械普查（全 exe 38 处访问全是 16 位）见 rich4-spec/tests/test_points_field.py
    const { after } = stepOnto(14, 1, { points: 65500 });
    expect(after.players[0]!.points).toBe(66000 - 65536); // = 464
  });

  /*
   * ★★ 第十六份試玩回報（「我自己进医院或监狱没办法直接保释自己吧？看看原版逻辑」）：
   *   最后一步踩到惡犬 ⇒ 人被送进醫院、站在醫院格上 ⇒ 先前 `settle` 照跑醫院格落点，
   *   给他开了保釋屏、名单第一个就是他自己。
   *   原版走完之后先问 `0x40c912(1)`（`0x0040d889 call 0x418e7f` → `0x00418e81`），
   *   `dword [+0x32]`（住院）非 0 ⇒ 返回 0 ⇒ `0x00418ead mov dl,0x83`，**落点例程 `0x41982d` 不进**。
   *   0007 号图的醫院关押格本身就是醫院落点格（specialKind 5），不挡就会开保釋屏。
   */
  const MAP7 = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0007.bin';
  for (const who of [1, 2] as const) {
    run(`★★ 踩到惡犬被送进醫院：醫院格的落点（保釋屏）不进 —— ${who === 1 ? '真人' : '电脑'} @source 0x00418e81 / 0x00418ead`, () => {
      const map = parseMap(new Uint8Array(readFileSync(MAP7)));
      const topo = topoOf(map);
      const state = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 7 });
      const from = state.players[0]!.nodeId;
      const to = topo.nodes[from - 1]!.adjacent[0]!;
      const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
      const start: GameState = {
        ...state,
        players: state.players.map((p, i) => (i === 0 ? { ...p, whoPlays: who } : p)),
        objects: placeObjectOfType(cleared, 11, to).objects,
        phase: 'moving',
        stepsRemaining: 1,
        stepsTotal: 1,
      };
      const after = reduce(start, { type: 'step' }, topo);
      const me = after.players[0]!;
      expect(me.blocking.inHospital).not.toBe(0);
      expect(after.hospitalOccupancy[0]).toBe(1);
      expect(after.phase).toBe('settling');
      // 人确实站在醫院格上（specialKind 5）—— 不挡就会开保釋屏
      expect(topo.nodes[me.nodeId - 1]!.specialKind).toBe(5);
      const settled = reduce(after, { type: 'settle' }, topo);
      expect(settled.phase).toBe('turnEnd');
      expect(settled.pending).toBeNull();
      // 电脑那一支（`0x43e9a4` 的 `rand & 1`）也没掷、没人被放
      expect(settled.rngState).toBe(after.rngState);
      expect(settled.hospitalOccupancy).toEqual(after.hospitalOccupancy);
      expect(settled.players[0]!.blocking.inHospital).toBe(me.blocking.inHospital);
      expect(settled.players[0]!.points).toBe(me.points);
    });
  }

  // ★★ 2026-09-24（provenance 审计）：土地公登场在**送醫院之前**挑格（`0x0041b845 call 0x40e14d` 早于
  //   `0x0041b8ef call 0x43ec3f`）⇒ 被咬的人还占着那一格。按这个次序手算候选与抽签，与引擎逐位一致。
  run('★★ 惡犬：搭档挑格时被咬的人还占着那一格（先挑格、后住院）', () => {
    const { before, after, topo, node } = stepOnto(11);
    // 走这一步本身不掷随机（单邻居起步）⇒ 以「走完」的状态为抽签起点
    const walkedOnly = reduce({ ...before, objects: before.objects.map((o) => ({ ...o, nodeId: 0 })) }, { type: 'step' }, topo);
    const rng = new WatcomRng(walkedOnly.rngState);
    const playersAtBite = before.players.map((p, i) => (i === 0 ? { ...p, nodeId: node } : p));
    const objectsAfterRelease = after.objects.map((o) => (o.type === 12 ? { ...o, nodeId: 0 } : o));
    const occupied = runtimeOccupiedNodes(playersAtBite, objectsAfterRelease, before.specialActors);
    const spots = objectNodeCandidates(topo.nodes).filter((n) => !occupied.has(n));
    const xy = (id: number) => {
      const n = topo.nodes[id - 1];
      return n === undefined ? null : { x: n.x, y: n.y };
    };
    const want = pickObjectNodeDistant(spots, node, xy, () => rng.next());
    const earthGod = after.objects.find((o) => o.type === 12)!;
    expect(earthGod.nodeId).toBe(want);
    expect(after.players[0]!.blocking.inHospital).toBe(3);
  });

  run('★ 惡犬被踩掉之后，土地公会补到场上 —— 物件不会越打越少', () => {
    const { after } = stepOnto(11);
    const left = onMap(after);
    expect(left).toHaveLength(1);
    expect(left[0]!.type).toBe(12);
    expect(OBJECT_NAMES[12]).toBe('土地公');
  });
});

describe('★ 任期与破产', () => {
  run('神明 7 个回合后自己走人，搭档补位', () => {
    const { state, topo } = fresh();
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    let s: GameState = {
      ...state,
      objects: placeObjectOfType(cleared, 1, 1).objects,
    };
    // 直接附上去
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, godInfo: 1, fortune: 100 } : p)),
      objects: s.objects.map((o, i) =>
        i === 0 ? { ...o, nodeId: s.players[0]!.nodeId, state: 7, attached: 1 } : o,
      ),
      phase: 'turnEnd',
    };

    // ★ 神的任期也在 `0x41c84f`（`0x41cc6c`）里逐日递减，而那一 tick 作用于
    //   **新**当前玩家（原版 `0x418f95` 先 ++ 游标）⇒ 每次都从 3 号出发，
    //   让 0 号成为"即将行动的这位"。
    for (let day = 0; day < 7; day++) {
      s = reduce({ ...s, currentPlayer: 3, phase: 'turnEnd' }, { type: 'endTurn' }, topo);
    }
    expect(s.players[0]!.godInfo).toBe(0);
    expect(s.players[0]!.fortune).toBe(0);
    // 大財神（槽 1）补到场上
    expect(s.objects[1]!.nodeId).not.toBe(0);
    // ★ 且**不能落在有人或有物件的格子上** —— 原版 `0x40aa6c` 的筛选是
    //   `test dword [node+0x24], 0x80ffff00`（玩家 bits 8..11 + 物件 bits 12..23）。
    //   先前只反查物件表，搭档会与人叠格。
    const occupied = new Set<number>();
    for (const p of s.players) if (p.nodeId !== 0) occupied.add(p.nodeId);
    for (const o of s.objects) if (o.nodeId !== 0 && o.attached === 0) occupied.add(o.nodeId);
    occupied.delete(s.objects[1]!.nodeId);
    expect(occupied.has(s.objects[1]!.nodeId), '搭档压在别人/别物上').toBe(false);
  });

  run('★ 破产时身上的物件要还回去 —— 否则它永远挂在死人身上', () => {
    const { state, topo } = fresh();
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const s: GameState = {
      ...state,
      objects: cleared.map((o, i) =>
        i === 0 ? { ...o, nodeId: 5, state: 7, attached: 2 } : o,
      ),
      players: state.players.map((p, i) => (i === 1 ? { ...p, godInfo: 1, fortune: 100 } : p)),
    };
    const after = applyBankruptcy(s, 1, topo);
    expect(after.objects[0]!.attached).toBe(0);
    expect(after.objects[0]!.nodeId).toBe(0);
    // 搭档大財神补位
    expect(after.objects[1]!.nodeId).not.toBe(0);
    const occupied2 = new Set<number>();
    for (const p of after.players) if (p.nodeId !== 0) occupied2.add(p.nodeId);
    for (const o of after.objects) if (o.nodeId !== 0 && o.attached === 0) occupied2.add(o.nodeId);
    occupied2.delete(after.objects[1]!.nodeId);
    expect(occupied2.has(after.objects[1]!.nodeId), '搭档压在别人/别物上').toBe(false);
  });
});

describe('★ 乞丐：破产者的棋子留在地图上', () => {
  /** 把玩家 1 弄成出局者，钉在玩家 0 下一步会走到的那格 */
  function setup() {
    const { state, topo } = fresh();
    const from = state.players[0]!.nodeId;
    const to = topo.nodes[from - 1]!.adjacent[0]!;
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const start: GameState = {
      ...state,
      objects: cleared,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, whoPlays: 0, nodeId: to } : i === 0 ? { ...p, cash: 500_000 } : p,
      ),
      phase: 'moving',
      stepsRemaining: 1,
      stepsTotal: 1,
    };
    return { start, topo, to };
  }

  run('★ 踩到乞丐 → 掏物价指数 × 1000，钱进公库', () => {
    const { start, topo } = setup();
    const after = reduce(start, { type: 'step' }, topo);
    const amount = start.priceIndex * 1000;
    expect(after.players[0]!.cash).toBe(500_000 - amount);
    expect(after.pool).toBe(start.pool + amount);
  });

  run('★ 收了钱乞丐就换个地方待着 —— 不然会被同一个人反复薅', () => {
    const { start, topo, to } = setup();
    const after = reduce(start, { type: 'step' }, topo);
    expect(after.players[1]!.nodeId).not.toBe(to);
    expect(after.players[1]!.nodeId).not.toBe(0);
  });

  run('路过不算 —— 还有步数时不施捨', () => {
    const { start, topo } = setup();
    const after = reduce({ ...start, stepsRemaining: 4, stepsTotal: 4 }, { type: 'step' }, topo);
    expect(after.players[0]!.cash).toBe(500_000);
  });

  run('同格的人还活着就不施捨', () => {
    const { start, topo } = setup();
    const living: GameState = {
      ...start,
      players: start.players.map((p, i) => (i === 1 ? { ...p, whoPlays: 2 } : p)),
    };
    expect(reduce(living, { type: 'step' }, topo).players[0]!.cash).toBe(500_000);
  });
});

describe('★ 确定性没被破坏', () => {
  run('同种子跑 3000 步，两次指纹逐步相同', () => {
    const runOnce = (): string[] => {
      const { state, topo } = fresh(2024);
      let s = state;
      const out: string[] = [];
      for (let i = 0; i < 3000 && !isGameOver(s); i++) {
        const a = decideAction({ state: s, map: loadMap() });
        if (a === null) break;
        s = reduce(s, a, topo);
        if (i % 100 === 0) out.push(stateFingerprint(s));
      }
      return out;
    };
    const a = runOnce();
    expect(a.length).toBeGreaterThan(10);
    expect(runOnce()).toEqual(a);
  });

  run('★ 物件表进了指纹 —— 神明位置不同必须校验和不同', () => {
    const { state } = fresh();
    const moved: GameState = {
      ...state,
      objects: state.objects.map((o, i) => (i === 0 ? { ...o, nodeId: o.nodeId + 1 } : o)),
    };
    expect(stateFingerprint(moved)).not.toBe(stateFingerprint(state));
  });

  run('物件全程守恒：既不凭空多出，也不凭空消失', () => {
    const map = loadMap();
    const topo = topoOf(map);
    let s = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 31337,
    });
    for (let i = 0; i < 60_000 && !isGameOver(s); i++) {
      const a = decideAction({ state: s, map });
      if (a === null) break;
      s = reduce(s, a, topo);
      // 不变量：任何 attached 非 0 的物件，都得被它的主人真正引用着
      for (let k = 0; k < s.objects.length; k++) {
        const o = s.objects[k]!;
        if (o.attached === 0) continue;
        const host = s.players[o.attached - 1]!;
        expect(
          host.godInfo === k + 1 || host.f64 === k + 1,
          `物件 ${k}（${OBJECT_NAMES[o.type]}）挂在玩家 ${o.attached - 1} 身上，但那人并不认它`,
        ).toBe(true);
        expect(isAlive(host)).toBe(true);
      }
    }
    // ★ 六对神明始终在循环（原版 `i < 12` 才有搭档）；禮物与寶箱被拿走后**每逢跨月**重新摆出来
    //   （审计 2026-09-24：`0x0041d0a5..0x0041d0f6`，见 `rules/monthly-objects.ts`）。
    //   只数唯一物件（種類 1..14）—— 路障/地雷/定時炸彈是道具放出来的，另算。
    const alive = s.objects.filter((o) => o.type <= 14 && (o.nodeId !== 0 || o.attached !== 0));
    expect(alive.length).toBeGreaterThan(0);
    expect(alive.length).toBeLessThanOrEqual(INITIAL_OBJECT_TYPES.length);
  }, 120_000);
});

/*
 * ★★ 需求方 2026-09-24「炸弹定时炸弹…爆炸时是否会摧毁周围建筑物」—— 定時炸彈只动**脚下那一格**，
 *   走 `0x40ab4a(node.type, 0)`（`0x0041b70c..0x0041b71f`）：
 *   住宅：0 级不动；否则 −1，連鎖店（`+0x18 ≠ 0`）直接夷平成 0 级住宅（种类也落回）；
 *   設施：0 级不动；否则 −1，减到 0 ⇒ 种类清 0 并放人（`0x40ac20..0x40ac33`）。
 *   邻格一律不动。
 */
describe('★★ 定時炸彈爆在脚下：只动这一格（0x40ab4a mode 0）', () => {
  /**
   * 0 号背着一颗还剩 1 步的炸彈，照「踩上去」那一组的走法走一步（当前格 → 第一个邻居），
   * 那一格的 `node.type` 换成要测的实体（住宅 0x7d0+id / 設施 0xfa0+id）。
   */
  function explodeOnto(entityType: number) {
    const { state, topo: topo0 } = fresh();
    const from = state.players[0]!.nodeId;
    const to = topo0.nodes[from - 1]!.adjacent[0]!;
    const nodes = topo0.nodes.map((n) => (n.id === to ? { ...n, type: entityType } : n));
    const topo = { ...topo0, nodes };
    const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
    const placed = placeObjectOfType(cleared, 18, from, 1, 1);
    expect(placed.slot).toBeGreaterThanOrEqual(0);
    const start: GameState = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, f64: placed.slot + 1 } : p)),
      objects: placed.objects,
      phase: 'moving',
      stepsRemaining: 3,
      stepsTotal: 3,
    };
    return { start, topo, to };
  }

  run('★★ 炸在設施上：等级 −1（先前什么都不发生）', () => {
    const fid = loadMap().facilities[0]!.id;
    const { start, topo, to } = explodeOnto(0xfa0 + fid);
    expect(facilityIndexOf(topo.nodes[to - 1]!.type)).toBe(fid);
    const facilityLevel = [...start.facilityLevel];
    facilityLevel[fid] = 2;
    const after = reduce({ ...start, facilityLevel }, { type: 'step' }, topo);
    // 炸了：炸彈没了、人送醫院 5 天（`push 5 / call send_to_hospital`，人被搬到醫院格）
    expect(after.players[0]!.f64).toBe(0);
    expect(after.players[0]!.blocking.inHospital).toBe(5);
    expect(after.facilityLevel[fid]).toBe(1);
  });

  run('★★ 炸在連鎖店上：夷平成 0 级**住宅**（种类也要落回），邻格不动', () => {
    const idx = loadMap().lands[3]!.id;
    const { start, topo, to } = explodeOnto(0x7d0 + idx);
    expect(housingIndexOf(topo.nodes[to - 1]!.type)).toBe(idx);
    const landLevel = start.landLevel.map(() => 2);
    const landType = [...start.landType];
    landType[idx] = 1;
    landLevel[idx] = 3;
    const after = reduce({ ...start, landLevel, landType }, { type: 'step' }, topo);
    expect(after.players[0]!.blocking.inHospital).toBe(5);
    expect(after.landLevel[idx]).toBe(0);
    expect(after.landType[idx]).toBe(0);
    // 其它地块一块都没动（不炸周围）
    const changed = after.landLevel.map((v, i) => (v !== landLevel[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed).toEqual([idx]);
  });
});
