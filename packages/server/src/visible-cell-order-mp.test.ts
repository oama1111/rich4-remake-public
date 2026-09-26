/*
 * 联机镜像：AI 可见节点表的**次序**照原版屏幕行序（§7.139(6) 第 2 条「并列次序」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版 0x409ef9 把画面内节点按视角档位 `[0x499088]`（透视表 0x46ccf0 + 块内矩阵 0x474910）
 * 投到一张 440×440 的 word 格表，`0x40a050` **行优先**扫出（先屏幕 Y 后屏幕 X）；
 * 四个调用点（路障阶段二 `0x4212b5` / 地雷 `0x4213e8` / 定時炸彈 `0x421597` / 傳送機 `0x421cc1`）
 * 都按这张表的次序枚举，且并列取**先到者**（`cmp best, this / jge 跳过`）。
 * 本仓先前按世界 (y,x) 排 ⇒ 两个同等级候选会选到不同格。
 *
 * 这条改动**改状态**（AI 选到别的格），故按 `wt28/AUDIT.md` 的口径补一条联机镜像：
 * 服务器（`Room.decideForCurrent` → core `decideAction`）给出的那一手 = 单机同一局面给出的那一手，
 * 广播回来在本地重放后逐字段指纹一致。
 *
 * 次序本身的原版真值（实跑 0x409ef9）钉在 core 的 `tool-policy.test.ts`；
 * 这里预期值用它**看不到**的一条独立路径重算：直接调 `@rich4/data` 的 `projectWorld`
 * 逐节点投影再按 (屏幕Y, 屏幕X) 排 —— 抄自 0x409ef9 的算法，但不复用 core 的实现，
 * 免得实现错了这条测试跟着一起错。
 *
 * ★★ 合并 `ds/oi-qtool1`（Q-TOOL-1）之后，`visibleNodeIds` 的**成员**由那张 440×440 id 图的
 * **屏幕方窗**说了算（±220、两轴半开、恒用视角 0），**次序**仍按当时的视角档位 —— 两半分工。
 * 本文件按同样的分工各自独立重算：成员走 `inWindowAtView0`（`projectWorld` + 半开区间），
 * 次序走 `screenOrder`。先前这里用「世界 ±220 方框」圈候选，投影是斜的 ⇒ 圈出来的集合
 * 与 AI 实际看到的不再是一套（两条用例的预期格因此从 node39 挪到 node42 / node43）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  LAND_TYPE_HOUSE,
  TOOL_SLOTS_PER_PLAYER,
  TOOL_TELEPORTER,
  WHO_PLAYS_COMPUTER,
  decideAction,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type MapNode,
  type SeatInfo,
} from '@rich4/core';
import { projectWorld } from '@rich4/data';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials });

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

/** 画面半宽（同 `card-policy.ts` 的 `VIEW_HALF`）@source 0x40a469 `mov edi,0x1b8` ÷ 2 = 0xdc */
const VIEW_HALF = 220;

/**
 * 「这个**节点**在不在这幅画面里」—— 独立抄一遍 Q-TOOL-1 的窗口：
 * 把镜头放在 `cam` 上投影，`−220 ≤ 偏移 < 220`（两轴、**半开区间**；`0x40a472..0x40a4c5`）。
 *
 * ★ 成员口径与次序是两件事：成员按这条（恒用视角 0，见 `rules/board-window.ts`），
 *   次序按下面那条（随 `[0x499088]` 的档位）。两条合起来才是 `visibleNodeIds` 的语义 ——
 *   先前这里用「世界 ±220 方框」圈候选，等距投影下那是**斜的**，圈出来的集合与 AI 实际看到的不是一套。
 */
function inWindowAtView0(cam: { x: number; y: number }, n: { x: number; y: number }): boolean {
  const p = projectWorld(0, n.x, n.y, cam.x >> 5, cam.y >> 5, cam.x, cam.y);
  return p !== null && p.x >= -VIEW_HALF && p.x < VIEW_HALF && p.y >= -VIEW_HALF && p.y < VIEW_HALF;
}

/**
 * 独立的「原版可见节点表次序」：逐节点投影后按行优先（先屏幕 Y 后屏幕 X）排。
 * 同像素后写覆盖（`0x40a046 mov word [buf+…], di`，节点表靠后的赢）。
 */
function screenOrder(nodes: readonly MapNode[], cam: { x: number; y: number }, view: number): number[] {
  const camTileX = cam.x >> 5;
  const camTileY = cam.y >> 5;
  const rows = new Map<number, number>();
  for (const n of nodes) {
    const p = projectWorld(view, n.x, n.y, camTileX, camTileY, cam.x, cam.y);
    if (p === null) continue;
    rows.set((p.y + 0x8000) * 0x10000 + (p.x + 0x8000), n.id);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
}

describe('★★ 联机：AI 道具候选按原版屏幕行序（0x409ef9 / 0x40a050）', () => {
  run('★★ 傳送機的并列候选取屏幕行序最先者：服务器 = 单机同一手、重放逐字段一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 23, mode: 'multiplayer' });
    const me = 1;

    // ~ 找一处「我站得住、画面里有两块同级无主住宅、且两种次序给出的先到者不同」的盘面 ~
    const landAt = (n: MapNode) => (n.ref.kind === 'land' ? n.ref.index : -1);
    const houses = map.nodes.filter((n) => landAt(n) >= 0 && landAt(n) !== 0 && n.adjacent.length > 0);
    let sight: { at: MapNode; a: MapNode; b: MapNode; screenFirst: MapNode; xyFirst: MapNode } | null = null;
    for (const at of map.nodes) {
      if (landAt(at) === 0 || at.adjacent.length === 0) continue;
      const near = houses.filter(
        (n) => n.id !== at.id && inWindowAtView0(at, n) && landAt(n) !== landAt(at),
      );
      if (near.length < 2) continue;
      const byScreen = screenOrder(near, at, 0);
      const byXy = [...near].sort((p, q) => p.y - q.y || p.x - q.x).map((n) => n.id);
      // 两种次序都要有**确定的第一名**，且必须是不同那一块（否则这盘面证明不了这条改动）
      const screenFirst = byScreen[0]!;
      const xyFirst = byXy[0]!;
      if (screenFirst === xyFirst) continue;
      sight = {
        at,
        a: near.find((n) => n.id === screenFirst)!,
        b: near.find((n) => n.id === xyFirst)!,
        screenFirst: near.find((n) => n.id === screenFirst)!,
        xyFirst: near.find((n) => n.id === xyFirst)!,
      };
      break;
    }
    expect(sight, '地图里找得到这样的两块候选（换了图就会在这里红）').not.toBeNull();
    const { at, a, b, screenFirst, xyFirst } = sight!;

    // ~ 局面：两块候选都摆成「无主 · 住宅 · 3 级」（其余地块 / 設施全部不达标），我在 `at` ~
    const cand = [landAt(a), landAt(b)];
    const landOwner = s0.landOwner.map(() => 0);
    const landLevel = s0.landLevel.map(() => 0);
    const landType = s0.landType.map(() => LAND_TYPE_HOUSE);
    for (const id of cand) landLevel[id] = 3;
    // 只留一台傳送機：开局的道具库存里还有别的（定時炸彈等），不清掉的话环形第一件就是它
    const tools = new Array<number>(s0.tools.length).fill(0);
    tools[me * TOOL_SLOTS_PER_PLAYER + TOOL_TELEPORTER] = 1;
    const state: GameState = {
      ...s0,
      currentPlayer: me,
      phase: 'awaitingRoll',
      aiStep: 2,
      aiBranch: 0, // 0 = 道具段（1 = 出牌段）
      pending: null,
      viewRotation: 0,
      landOwner,
      landLevel,
      landType,
      facilityOwner: s0.facilityOwner.map(() => 2), // 設施全部有主 ⇒ 傳送機不看它们
      tools,
      players: s0.players.map((p, i) =>
        i === me
          ? { ...p, whoPlays: WHO_PLAYS_COMPUTER, nodeId: at.id, lastNodeId: at.id, xpos: at.x, ypos: at.y, cash: 500_000, moneyInBank: 0, fortune: 0, personality: 1, aiFlags: 3 }
          : { ...p, nodeId: at.id, lastNodeId: at.id, xpos: at.x, ypos: at.y },
      ),
    };

    const room = new Room({
      id: 'VISORDER',
      map,
      globalMapId: 0,
      seed: 23,
      seats: seats(),
      options: LOBBY_DEFAULT_OPTIONS,
      base: { state, snapshot: '' },
    });
    room.start();

    // 服务器替这一座拿主意（同一局面单机也算一遍，必须同一手）
    const act = room.decideForCurrent();
    expect(act, `视角 0 下两块同级候选：屏幕行序先到的是 node${screenFirst.id}（(y,x) 序先到的是 node${xyFirst.id}）`).toEqual({
      type: 'useTool',
      toolId: TOOL_TELEPORTER,
      nodeId: me + 1,
      value: screenFirst.id,
    });
    expect(decideAction({ state, map })).toEqual(act);

    // 重放：本地施加服务器广播的那一条，指纹必须一致（且真的动了）
    const r = room.submit(me, act!);
    expect(r.ok).toBe(true);
    const after = reduce(state, act!, topo);
    expect(after).not.toBe(state);
    expect(stateFingerprint(after)).toBe(room.fingerprint);
    expect(room.state.players[me]!.nodeId).toBe(screenFirst.id);
    // ★ 判别性护栏：这一手**不是** (y,x) 序会给出的那一格 —— 否则这条用例在旧实现下也会绿
    expect(room.state.players[me]!.nodeId).not.toBe(xyFirst.id);
  });

  run('★★ 视角档位是 AI 的输入：转视角按定序器广播、两端镜像一致，之后 AI 改取另一格', () => {
    // 这条改动的输入是 `state.viewRotation`（原版 `[0x499088]`）—— 它不是每个客户端各自的镜头，
    // 而是**共享状态**（客户端的 `<`/`>` 也走 `dispatch` → 定序器 → 全端重放）。
    // 这里钉住：转了视角之后服务器镜像与本地重放同步，AI 的取舍随之换到另一格 ——
    // 即「服务器与客户端必须拿到同一个 `viewRotation`」这条前提在这条改动下仍然成立。
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 23, mode: 'multiplayer' });
    const me = 1;
    const landAt = (n: MapNode) => (n.ref.kind === 'land' ? n.ref.index : -1);
    const houses = map.nodes.filter((n) => landAt(n) > 0 && n.adjacent.length > 0);

    let sight: { at: MapNode; a: MapNode; b: MapNode; delta: number } | null = null;
    for (const at of map.nodes) {
      if (landAt(at) === 0 || at.adjacent.length === 0) continue;
      const near = houses.filter(
        (n) => n.id !== at.id && inWindowAtView0(at, n) && landAt(n) !== landAt(at),
      );
      if (near.length < 2) continue;
      const first = (v: number) => screenOrder(near, at, v)[0]!;
      const zero = first(0);
      const delta = [1, 2, 3, 4, 5, 6, 7].find((d) => first(d) !== zero);
      if (delta === undefined) continue;
      sight = {
        at,
        a: near.find((n) => n.id === zero)!,
        b: near.find((n) => n.id === first(delta))!,
        delta,
      };
      break;
    }
    expect(sight, '地图里找得到「转一下视角就换先到者」的两块候选（换了图就会在这里红）').not.toBeNull();
    const { at, a, b, delta } = sight!;

    const cand = [landAt(a), landAt(b)];
    // 只留一台傳送機：开局的道具库存里还有别的（定時炸彈等），不清掉的话环形第一件就是它
    const tools = new Array<number>(s0.tools.length).fill(0);
    tools[me * TOOL_SLOTS_PER_PLAYER + TOOL_TELEPORTER] = 1;
    const state: GameState = {
      ...s0,
      currentPlayer: me,
      phase: 'awaitingRoll',
      aiStep: 2,
      aiBranch: 0,
      pending: null,
      viewRotation: 0,
      landOwner: s0.landOwner.map(() => 0),
      landLevel: s0.landLevel.map((_, i) => (cand.includes(i) ? 3 : 0)),
      landType: s0.landType.map(() => LAND_TYPE_HOUSE),
      facilityOwner: s0.facilityOwner.map(() => 2),
      tools,
      players: s0.players.map((p, i) =>
        i === me
          ? { ...p, whoPlays: WHO_PLAYS_COMPUTER, nodeId: at.id, lastNodeId: at.id, cash: 500_000, moneyInBank: 0, fortune: 0, personality: 1, aiFlags: 3 }
          : { ...p, nodeId: at.id, lastNodeId: at.id },
      ),
    };
    const room = new Room({
      id: 'VISORDER2',
      map,
      globalMapId: 0,
      seed: 23,
      seats: seats(),
      options: LOBBY_DEFAULT_OPTIONS,
      base: { state, snapshot: '' },
    });
    room.start();

    expect(room.decideForCurrent()).toEqual({ type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: me + 1, value: a.id });

    // 转视角：定序器收下 → 服务器镜像与本地重放都前进到同一档位
    const rot: Action = { type: 'rotateView', delta };
    const r = room.submit(me, rot);
    expect(r.ok).toBe(true);
    const local = reduce(state, rot, topo);
    expect(room.state.viewRotation).toBe(local.viewRotation);
    expect(local.viewRotation).not.toBe(0);

    // 换档之后 AI 取的是**另一格**（同一局面、同一份候选，只有次序变）
    expect(room.decideForCurrent()).toEqual({ type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: me + 1, value: b.id });
    expect(decideAction({ state: local, map })).toEqual({ type: 'useTool', toolId: TOOL_TELEPORTER, nodeId: me + 1, value: b.id });
    expect(b.id).not.toBe(a.id);
  });
});
