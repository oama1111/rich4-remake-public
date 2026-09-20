/*
 * 开发用的**状态注入口** —— `__rich4.debug.patch(fn)` 与三个现成配方
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么要有（W-53）：第五份回报里的三条（踩惡犬 / 天使買地 / 壞神附身）
 *   都要**玩到才出现**，靠碰运气复现成本极高。这个出口让开发者在控制台里
 *   直接把状态摆到那一刻，再去验收画面与演出。
 *
 * ★★ **它不是引擎的一条路。** `patch` 直接改 `state`、**不经过
 *   `reduceRecorded`**，所以飞行记录仪里的 action 流从这一刻起就与状态对不上
 *   （重放到头会得到一个指纹不符的报告）。故调用时：
 *     ① 往 `logRing` 记一行 `[dev] state patched`（F9 回报的 `env.log` 里看得到）；
 *     ② 把记录仪**标脏**（`FlightRecorder.taint()`）⇒ 报告带 `devPatched: true`
 *        ⇒ `tools/replay-report.ts` 见到它**拒绝验指纹**，而不是报一个假的不一致。
 *
 * ★ 配方（`placeDogAhead` / `giveAngel` / `giveSmallPovertyGod`）一律走引擎自己的
 *   规则函数（`pickNextNode` / `attachGod`），并在写回后**校验引擎自己的不变量**：
 *   - 一个节点上不会有两个未附身物件（`place_object` 也不制造这种局面）；
 *   - `godInfo === 物件下标 + 1`，且那个物件 `nodeId === 玩家脚下`、`attached === 玩家下标 + 1`；
 *   - 物件种类由槽位决定（`OBJECT_TYPE_TABLE`），故「摆一个惡犬」= 写**第 11 号槽**。
 *   校验不过就**原样退回**并记一行拒绝原因 —— 宁可不生效，也不摆出一个引擎不会接受的状态。
 *
 * ⚠️ 只在 `import.meta.env.DEV` 下挂到 `globalThis`（见 `main.ts` 末尾）。
 */

import {
  WatcomRng,
  attachGod,
  objectTypeOf,
  pickNextNode,
  slotRangeForType,
  type GameState,
  type MapObject,
  type MapTopology,
} from '@rich4/core';

/**
 * 惡犬的种类号 —— 11。
 *
 * @source `OBJECT_NAMES`（`rules/purchase.ts`，exe 表 VA 0x0047ed76）第 12 项 = '惡犬'；
 *   槽位表 `OBJECT_TYPE_TABLE`（VA 0x0047ed3c）第 11 号槽（下标 10）= 11。
 */
export const DOG_TYPE = 11;

/** `__rich4.debug.patch` 的宿主接线（与 `main.ts` 的 DEV 出口一一对应）*/
export interface DevPatchHost {
  /** 读此刻的状态 */
  getState: () => GameState;
  /** 写回（宿主自己负责 `requestRender()`）*/
  setState: (s: GameState) => void;
  /** 进 `logRing`（也进屏幕日志栏）的那一行 */
  log: (line: string) => void;
  /** 把飞行记录仪标脏 */
  taint: () => void;
}

/** 一行 `[dev] state patched` —— 报告里靠它认出「这次现场被注过状态」*/
export const DEV_PATCH_LOG_LINE = '[dev] state patched';

/**
 * 施加一次状态注入：`state = fn(state)`，记一行日志，并把记录仪标脏。
 *
 * 返回新状态。`fn` 抛错时不写回（让控制台看见原始异常）。
 */
export function applyPatch(host: DevPatchHost, fn: (s: GameState) => GameState): GameState {
  const next = fn(host.getState());
  host.setState(next);
  host.log(`${DEV_PATCH_LOG_LINE}${next === undefined ? '（fn 返回了 undefined）' : ''}`);
  // ★ 即使 fn 原样返回，调用本身也已经破坏了「报告 = 纯重放」这个前提
  host.taint();
  return next;
}

// ============================================================
//  配方用的公共小工具
// ============================================================

/** 地形（含邻接关系）—— 配方只用它算「下一格」，等价于 main.ts 的 `topo` */
export type DevTopo = MapTopology;

/** 物件表里某种类的槽位下标（种类由槽位决定，见 rules/objects.ts）*/
function slotOfType(type: number): number {
  const { from } = slotRangeForType(type);
  return from;
}

/**
 * 下一个落点 —— 与引擎走一步**同一套** `pickNextNode`（含岔路随机）。
 *
 * ★ 用当前 `rngState` 的**副本**掷，不动真实随机流：这里只是「算给你看」，
 *   真走那一步时引擎自己会再算一次（同一个状态 ⇒ 同一格）。
 */
export function nextNodeOf(state: GameState, topo: DevTopo): number | null {
  const p = state.players[state.currentPlayer];
  if (p === undefined) return null;
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  return pickNextNode(topo, p.nodeId, p.lastNodeId, rng);
}

/** 把 `nodeId` 上**未附身**的其它物件请下地图（一个节点只站得下一个）*/
function clearNode(objects: MapObject[], nodeId: number, keepSlot: number): MapObject[] {
  return objects.map((o, i) => {
    if (i === keepSlot || o.nodeId !== nodeId || o.attached !== 0) return o;
    return { ...o, nodeId: 0, state: 0, attached: 0 };
  });
}

// ============================================================
//  配方 ①：把一只惡犬摆在当前玩家**即将踩到**的那一格
// ============================================================

export interface DogOutcome {
  state: GameState;
  /** 擺到了哪一格；失败为 0 */
  nodeId: number;
  /** 惡犬的物件下标 + 1；失败为 0 */
  handle: number;
  /** 没摆成的原因（中文，直接进日志栏）*/
  refused: string | null;
}

/**
 * 配方 ①：`objects` 里 type 11（惡犬）摆到当前玩家的下一个落点。
 *
 * 写到的字段：
 * - `objects[10]`（惡犬槽，**下标 10**）的 `type` / `nodeId` / `state` / `attached`；
 *   若那一格原本站着别人的物件，那些物件的 `nodeId` / `state` / `attached` 被清零
 *   （= `release_object` 的收尾，`place_object` 也不会把两个物件摆同一格）。
 *
 * ⚠️ 狗只在**停下**（`stepsRemaining === 0`）时才咬人（`rules/object-landing.ts`
 *   的 `applyObjectTo['dog']`：`if (moving) return`），且**有车咬不到**
 *   （`trafficMethod !== 0` 只报 `blockedByVehicle`）。要咬人得让玩家停在那格。
 */
export function placeDogAhead(state: GameState, topo: DevTopo): DogOutcome {
  const me = state.players[state.currentPlayer];
  const next = nextNodeOf(state, topo);
  if (me === undefined || next === null) {
    return { state, nodeId: 0, handle: 0, refused: '当前玩家或下一格取不到' };
  }

  const slot = slotOfType(DOG_TYPE); // = 10
  const before = state.objects[slot];
  if (before === undefined) {
    return { state, nodeId: 0, handle: 0, refused: `物件表没有第 ${slot} 号槽` };
  }
  if (before.type !== DOG_TYPE) {
    // 种类由槽位决定（VA 0x0047ed3c）—— 对不上说明状态表本身已经坏了，不许硬写
    return {
      state,
      nodeId: 0,
      handle: 0,
      refused: `第 ${slot} 号槽的种类是 ${before.type}（表里应是 ${DOG_TYPE}）—— 物件表已自相矛盾`,
    };
  }

  let objects = clearNode(state.objects, next, slot);
  objects = objects.map((o, i) =>
    i === slot ? { ...o, type: DOG_TYPE, nodeId: next, state: 0, attached: 0 } : o,
  );
  state = { ...state, objects };
  if (state.objects[slot]?.nodeId !== next) {
    return { state, nodeId: 0, handle: 0, refused: '写入后惡犬不在目标格上' };
  }
  return { state, nodeId: next, handle: slot + 1, refused: null };
}

// ============================================================
//  配方 ②③：给当前玩家一个附身神明（天使 / 小窮神）
// ============================================================

export interface AttachOutcome {
  state: GameState;
  /** 附身物的 handle（下标 + 1）；失败为 0 */
  handle: number;
  /** 附身后的 `godInfo`；失败为 0 */
  godInfo: number;
  /** 被请走的旧神明（它的 handle）；没有为 0 */
  displaced: number;
  /** 没附成的原因（中文，直接进日志栏） */
  refused: string | null;
}

/**
 * 把某个槽位上的神明请到当前玩家身上。
 *
 * ★ 走 `rules/object-landing.ts` 的 `attachGod`（= `attach_object` VA 0x0040ead7
 *   的完整版），因此**引擎自己的三件事都做全了**：物件跟到玩家脚下、
 *   `attached = 玩家下标 + 1`、`state = 7`（死神 13）、三项修正（衰運/財運/福運）。
 *
 * ★ `godInfo` 就是**这个 handle**（= 物件下标 + 1），不是种类号：
 *   天使是种类 9、槽 8 ⇒ `godInfo = 9`；小窮神是种类 5、槽 4 ⇒ `godInfo = 5`。
 *
 * ⚠️ 被挤走的旧神明：同槽位的**搭档**重新登场的落点（`0x40aa6c`）本引擎未接
 *   （见 known-deviations 的 Q-OBJ-2）⇒ 这里把它清下地图（不凭空放一个）。
 *   失败时**状态原样退回**（`state` 就是入参那个对象），不会留下一半的写入。
 */
export function attachGodToCurrentPlayer(state: GameState, slot: number): AttachOutcome {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return { state, handle: 0, godInfo: 0, displaced: 0, refused: '没有当前玩家' };

  const obj = state.objects[slot];
  const type = objectTypeOf(slot);
  if (obj === undefined) {
    return { state, handle: 0, godInfo: 0, displaced: 0, refused: `物件表没有第 ${slot} 号槽` };
  }
  if (obj.type !== type) {
    return {
      state,
      handle: 0,
      godInfo: 0,
      displaced: 0,
      refused: `第 ${slot} 号槽的种类是 ${obj.type}（表里应是 ${type}）—— 物件表已自相矛盾`,
    };
  }

  const handle = slot + 1;
  const r = attachGod(state, state.currentPlayer, handle);
  if (!r.ok) {
    return { state, handle: 0, godInfo: 0, displaced: 0, refused: `attachGod(${handle}) 拒绝` };
  }

  // ★ 校验引擎自己的不变量：`godInfo` 必须指着**跟在自己脚下**的那个物件
  const attached = r.objects[slot];
  const host = r.players[state.currentPlayer];
  if (attached === undefined || host === undefined || host.godInfo !== handle) {
    return { state, handle: 0, godInfo: 0, displaced: 0, refused: 'attachGod 之后 handle 对不上' };
  }
  if (attached.nodeId !== host.nodeId || attached.attached !== state.currentPlayer + 1) {
    return { state, handle: 0, godInfo: 0, displaced: 0, refused: 'attachGod 之后物件没跟到玩家脚下' };
  }

  let next: GameState = {
    ...state,
    players: r.players,
    objects: r.objects,
    tools: r.tools,
    toolStock: r.toolStock,
  };

  const displaced = r.displaced;
  if (displaced !== 0) {
    // 被挤走的那位清下地图（见上面 Q-OBJ-2 的说明）；它若原本**没在地图上**就不用动
    next = {
      ...next,
      objects: next.objects.map((o, i) =>
        i === displaced - 1 ? { ...o, nodeId: 0, state: 0, attached: 0 } : o,
      ),
    };
  }

  const after = next.players[state.currentPlayer];
  if (after === undefined || after.godInfo !== handle) {
    return { state, handle: 0, godInfo: 0, displaced: 0, refused: '写回后 godInfo 不是这个 handle' };
  }
  return { state: next, handle, godInfo: handle, displaced, refused: null };
}

/** 配方 ②：天使（种类 9、槽 8）⇒ `godInfo = 9` */
export function giveAngel(state: GameState): AttachOutcome {
  return attachGodToCurrentPlayer(state, slotOfType(9));
}

/** 配方 ③：小窮神（种类 5、槽 4）⇒ `godInfo = 5` —— 附身（壞神）那一路 */
export function giveSmallPovertyGod(state: GameState): AttachOutcome {
  return attachGodToCurrentPlayer(state, slotOfType(5));
}

/** 给测试与配方日志用：把 `attachGodToCurrentPlayer` 的结果写成一行 */
export function attachLogLine(godName: string, out: AttachOutcome): string {
  if (out.refused !== null) return `[dev] ${godName} 附身被拒：${out.refused}`;
  return (
    `[dev] ${godName} 附身：godInfo=${out.godInfo}（handle=${out.handle}）` +
    `，舊神明=${
      out.displaced === 0 ? '无' : `handle ${out.displaced} 已请下地图（搭档落点未接，Q-OBJ-2）`
    }`
  );
}

/** 给测试与配方日志用：把 `placeDogAhead` 的结果写成一行 */
export function dogLogLine(out: DogOutcome): string {
  if (out.refused !== null) return `[dev] 惡犬沒擺成：${out.refused}`;
  return `[dev] 惡犬（type 11，槽下标 10）已擺到第 ${out.nodeId} 格（handle=${out.handle}，attached=0）`;
}
