/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * AI 出牌：三十张卡各自的「出不出、对谁出」
 *
 * ★ 逐条译自 rich4.exe 的跳表 `0x475324`（VA 0x0041e6e6 `call [0x475324 + action×4]`）：
 *   entry 1..30 = 卡片 1..30 的 AI 判定函数，返回 1 = 出，目标写在 `[0x48be58]`
 *   （第二参数 `[0x48be5c]`，只有搶奪卡用：偷哪张）。跳表里 5/6/18/19/20/21 指向
 *   `xor eax,eax; ret`（0x41e6e3）——換屋/轉向/四张被动卡 AI 从不打；16 与 17 共用一个函数。
 *
 * ## 三条贯穿全部函数的共同机制
 *
 * 1. **视野**（`0x40a45c(-1)`）：候选目标不是全地图，而是**此刻画面上画出来的**——它扫的是
 *    440×440 的屏幕格（memset 0x5e880 = 440×440×2 字节，见 0x409de7 由精灵表填格），
 *    行序扫描（先 y 后 x）。回合开始时镜头对准当前玩家，故「画面内」≈ 以我为中心 ±220 像素。
 *    本引擎照此做 `visibleEntities`，屏幕边缘的镜头钳位未复刻，记 D-005。
 *    格值：`0x8000 | (1 << 玩家)`（低 4 位是玩家位）、`0x8000 | (物件下标+1) << 8`（物件），
 *    `2001..3999` 地块（−2000 = 地块 id）、`4001..5999` 設施、`6001..7999` 企業。
 * 2. **最恨的人**（`0x40d2d3(me)`）：`hostility[b]` 最大且 > 0 的对手，没有则 −1。
 * 3. **同區**（`strcmp(land+4, other+4) == 0`）：同名地块 = 同一條街。
 *
 * ⚠️ 这里只回答「值不值、对谁」；能不能出由 `cards/registry.ts` 说了算（C-ARC-2）。
 *   随机（天使卡挑哪組、冬眠卡 1/4、岔路选边…）在纯策略层用 `aiRoll` 的确定性替身，
 *   与 policy.ts 的 `gateRoll` 同一约定（D-004）。
 */

import type { GameState, Player } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode } from '../loaders/map.ts';
import type { MapTopology } from '../state/reduce.ts';
import type { MapObject } from '../cards/summon.ts';
import { CARDS } from '@rich4/data';
import { isAlive } from '../state/types.ts';
import { nextCandidates } from '../state/reduce.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { DISPELLABLE_TYPES, objectTypeOf } from '../rules/objects.ts';
import { ATTACH_STATE_REAPER, canAttach } from '../cards/summon.ts';
import { isLimitDown, isLimitUp, marketOpenOn } from '../places/stock-market.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';

// ============================================================
//  目标与随机
// ============================================================

/**
 * AI 的目标描述 —— 与 `CardTarget` 一一对应（玩家/地块/設施/股票/物件），
 * 另加「自己」与「无目标」两个便捷变体；由 policy.ts 的 `toCardTarget`
 * 折算成引擎目标（T-009 起全类别可出，不再有顺延过滤）。
 */
export type AiCardTarget =
  | { kind: 'none' }
  | { kind: 'self' }
  | { kind: 'player'; index: number }
  | { kind: 'land'; landId: number }
  | { kind: 'facility'; facilityId: number }
  | { kind: 'stock'; index: number }
  | { kind: 'object'; objectIndex: number };

export interface AiCardChoice {
  target: AiCardTarget;
  /** 搶奪卡：偷哪张（`[0x48be5c]`） */
  stealCard?: number;
  /** 改建卡对公園：改成哪种設施（1..4） */
  facilityType?: number;
}

/**
 * 纯策略层的 `rand() % n` 替身：由 `rngState` 与一个盐派生，同一状态同一问题答案固定，
 * 不推进随机序列（D-004）。
 */
export function aiRoll(state: GameState, salt: number, n: number): number {
  if (n <= 0) return 0;
  return (((state.rngState >>> 0) ^ (Math.imul(salt, 0x9e3779b1) >>> 0)) >>> 0) % n;
}

// ============================================================
//  视野、最恨的人、同區
// ============================================================

/** 画面半宽：440×440 屏幕格，镜头居中于当前玩家 @source 0x40a45c / 0x409de7 */
export const VIEW_HALF = 220;

/** 最恨的对手：`hostility[b]` 最大且 > 0；没有则 −1 @source 0x0040d2d3 */
export function mostHated(players: readonly Player[], meIndex: number): number {
  const me = players[meIndex];
  if (me === undefined) return -1;
  let best = -1;
  let bestValue = 0;
  for (let b = 0; b < players.length; b++) {
    const p = players[b];
    if (b === meIndex || p === undefined || !isAlive(p)) continue;
    const h = me.hostility[b] ?? 0;
    if (h > bestValue) {
      bestValue = h;
      best = b;
    }
  }
  return best;
}

export type VisibleEntity =
  | { kind: 'land'; id: number; node: MapNode }
  | { kind: 'facility'; id: number; node: MapNode }
  | { kind: 'commercial'; id: number; node: MapNode };

export interface CardAiView {
  state: GameState;
  topo: MapTopology;
  meIndex: number;
  me: Player;
  /** 有效地块（归属/等级/类型已合并状态） */
  lands: readonly LandInfo[];
  /** 有效設施 */
  facilities: readonly FacilityInfo[];
}

function nodeOf(topo: MapTopology, nodeId: number): MapNode | undefined {
  return topo.nodes[nodeId - 1];
}

/** 节点是否在以 `center` 为中心的画面里 */
export function inView(center: MapNode, node: MapNode): boolean {
  return Math.abs(node.x - center.x) <= VIEW_HALF && Math.abs(node.y - center.y) <= VIEW_HALF;
}

/** 画面里的地块/設施/企業，按屏幕行序（先 y 后 x） */
export function visibleEntities(view: CardAiView): VisibleEntity[] {
  const center = nodeOf(view.topo, view.me.nodeId);
  if (center === undefined) return [];
  const out: VisibleEntity[] = [];
  for (const node of view.topo.nodes) {
    if (!inView(center, node)) continue;
    const ref = node.ref;
    if (ref.kind === 'land') out.push({ kind: 'land', id: ref.index, node });
    else if (ref.kind === 'facility') out.push({ kind: 'facility', id: ref.index, node });
    else if (ref.kind === 'commercial') out.push({ kind: 'commercial', id: ref.index, node });
  }
  return out.sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
}

/** 画面里活着的对手，按屏幕行序、同格按玩家位序，去重 @source 各函数里的 `0x80xx` 扫描 */
export function visibleRivals(view: CardAiView): number[] {
  const center = nodeOf(view.topo, view.me.nodeId);
  if (center === undefined) return [];
  const rows: { index: number; node: MapNode }[] = [];
  view.state.players.forEach((p, i) => {
    if (i === view.meIndex || !isAlive(p)) return;
    const n = nodeOf(view.topo, p.nodeId);
    if (n !== undefined && inView(center, n)) rows.push({ index: i, node: n });
  });
  return rows.sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x || a.index - b.index).map((r) => r.index);
}

/** 画面里站在地图上的物件（1 基下标），按屏幕行序 */
export function visibleObjects(view: CardAiView): { objectIndex: number; node: MapNode }[] {
  const center = nodeOf(view.topo, view.me.nodeId);
  if (center === undefined) return [];
  const out: { objectIndex: number; node: MapNode }[] = [];
  view.state.objects.forEach((o, i) => {
    if (o.nodeId === 0) return;
    const n = nodeOf(view.topo, o.nodeId);
    if (n !== undefined && inView(center, n)) out.push({ objectIndex: i + 1, node: n });
  });
  return out.sort((a, b) => a.node.y - b.node.y || a.node.x - b.node.x);
}

/** 同區 = 同名 @source strcmp(land+4, other+4) */
export function sameStreet(a: LandInfo, b: LandInfo): boolean {
  return a.name === b.name;
}

/** 某人某條街上住宅的过路费总和 @source 0x00419744 */
export function streetTollOf(lands: readonly LandInfo[], owner1: number, name: string): number {
  let total = 0;
  for (const l of lands) {
    if (l.type !== LAND_TYPE_HOUSE || l.owner !== owner1 || l.name !== name) continue;
    total += l.rentByLevel[l.level] ?? 0;
  }
  return total;
}

/** 某人的连锁店数 @source 0x0041970f */
export function chainStoreCount(lands: readonly LandInfo[], owner1: number): number {
  let n = 0;
  for (const l of lands) if (l.type !== LAND_TYPE_HOUSE && l.owner === owner1) n++;
  return n;
}

/**
 * 前瞻 n 格 @source 0x0040b221：沿邻接表走（不回头、不走封路），岔路随机挑一条并记下
 * 「有过岔路」；一个都不剩则原路返回。最多 8 格。
 */
export function lookahead(
  topo: MapTopology,
  state: GameState,
  from: number,
  prev: number,
  n: number,
  salt: number,
): { nodes: number[]; forked: boolean } {
  const nodes: number[] = [];
  let forked = false;
  let cur = from;
  let last = prev;
  for (let i = 0; i < Math.min(n, 8); i++) {
    const cands = nextCandidates(topo, cur, last);
    let next: number;
    if (cands.length === 0) next = last;
    else if (cands.length === 1) next = cands[0]!;
    else {
      next = cands[aiRoll(state, salt * 31 + i, cands.length)]!;
      forked = true;
    }
    nodes.push(next);
    last = cur;
    cur = next;
  }
  return { nodes, forked };
}

// ============================================================
//  三十张卡
// ============================================================

/** 我站的那格是什么 */
function hereOf(view: CardAiView): VisibleEntity | null {
  const node = nodeOf(view.topo, view.me.nodeId);
  if (node === undefined) return null;
  const ref = node.ref;
  if (ref.kind === 'land') return { kind: 'land', id: ref.index, node };
  if (ref.kind === 'facility') return { kind: 'facility', id: ref.index, node };
  if (ref.kind === 'commercial') return { kind: 'commercial', id: ref.index, node };
  return null;
}

function landById(view: CardAiView, id: number): LandInfo | undefined {
  return view.lands.find((l) => l.id === id);
}
function facilityById(view: CardAiView, id: number): FacilityInfo | undefined {
  return view.facilities.find((f) => f.id === id);
}

/**
 * 「这块地值得从对手手里拿」@source 0x0041e8e6(enemy, code)
 * 地块：有主、非我、有房，且（同區里有我的地 或 地主就是最恨的人且 ≥ 2 级）；
 * 設施：有主、非我、有等级。enemy = −1 时一律不值。
 */
export function worthTaking(view: CardAiView, enemy: number, ent: VisibleEntity): boolean {
  if (enemy === -1) return false;
  const me1 = view.meIndex + 1;
  if (ent.kind === 'land') {
    const l = landById(view, ent.id);
    if (l === undefined || l.owner === 0 || l.owner === me1 || l.level === 0) return false;
    if (view.lands.some((o) => sameStreet(o, l) && o.owner === me1)) return true;
    return l.owner === enemy + 1 && l.level >= 2;
  }
  if (ent.kind === 'facility') {
    const f = facilityById(view, ent.id);
    return f !== undefined && f.owner !== 0 && f.owner !== me1 && f.level !== 0;
  }
  return false;
}

type Handler = (view: CardAiView, hated: number) => AiCardChoice | null;

const NONE: AiCardChoice = { target: { kind: 'none' } };
const SELF: AiCardChoice = { target: { kind: 'self' } };
const player = (index: number): AiCardChoice => ({ target: { kind: 'player', index } });
const land = (landId: number): AiCardChoice => ({ target: { kind: 'land', landId } });
const facility = (facilityId: number): AiCardChoice => ({ target: { kind: 'facility', facilityId } });

/** 均富卡 @source 0x0041e6fe：平均現金 > 我的 10 倍，且我的現金 < 3000 × 物價 */
const junfu: Handler = (view) => {
  const alive = view.state.players.filter((p) => isAlive(p));
  if (alive.length === 0) return null;
  const avg = Math.trunc(alive.reduce((t, p) => t + p.cash, 0) / alive.length);
  const my = view.me.cash;
  return avg > my * 10 && 3000 * view.state.priceIndex > my ? NONE : null;
};

/** 均貧卡 @source 0x0041e779：最恨的人現金 > 30000×物價 且 > 我 2 倍；否则谁 > 50000×物價 且 > 我 3 倍 */
const junpin: Handler = (view, hated) => {
  const pi = view.state.priceIndex;
  const rivals = visibleRivals(view);
  const my = view.me.cash;
  if (hated !== -1 && rivals.includes(hated)) {
    const h = view.state.players[hated]!;
    if (h.cash > 30000 * pi && h.cash > my * 2) return player(hated);
  }
  for (let i = 0; i < view.state.players.length; i++) {
    if (!rivals.includes(i)) continue;
    const p = view.state.players[i]!;
    if (p.cash > 50000 * pi && p.cash > my * 3) return player(i);
  }
  return null;
};

/** 購地卡 @source 0x0041e9e2：脚下值得拿，且 (地價 + 房價×等级)×物價 < 現金 */
const goudi: Handler = (view, hated) => {
  const here = hereOf(view);
  if (here === null || !worthTaking(view, hated, here)) return null;
  const pi = view.state.priceIndex;
  if (here.kind === 'land') {
    const l = landById(view, here.id)!;
    return (l.landPrice + l.housePrice * l.level) * pi < view.me.cash ? NONE : null;
  }
  if (here.kind === 'facility') {
    const f = facilityById(view, here.id)!;
    return (f.landPrice + f.housePrice * f.level) * pi < view.me.cash ? NONE : null;
  }
  return null;
};

/** 換地卡 @source 0x0041eae2：我脚下 ≤ 1 级且同區没别的我的地；换画面里更贵、更高、值得拿的一块 */
const huandi: Handler = (view, hated) => {
  const here = hereOf(view);
  if (here === null) return null;
  const me1 = view.meIndex + 1;
  if (here.kind === 'land') {
    const mine = landById(view, here.id);
    if (mine === undefined || mine.owner !== me1 || mine.level > 1) return null;
    if (view.lands.some((o) => o.id !== mine.id && sameStreet(o, mine) && o.owner === me1)) return null;
    for (const ent of visibleEntities(view)) {
      if (ent.kind !== 'land') continue;
      const c = landById(view, ent.id);
      if (c === undefined || sameStreet(c, mine)) continue;
      if (c.landPrice > mine.landPrice && c.level > mine.level && worthTaking(view, hated, ent)) return land(c.id);
    }
    return null;
  }
  if (here.kind === 'facility') {
    const mine = facilityById(view, here.id);
    if (mine === undefined || mine.owner !== me1 || mine.level > 1) return null;
    for (const ent of visibleEntities(view)) {
      if (ent.kind !== 'facility') continue;
      const c = facilityById(view, ent.id);
      if (c === undefined) continue;
      if (c.landPrice > mine.landPrice && c.level > mine.level && worthTaking(view, hated, ent)) return facility(c.id);
    }
  }
  return null;
};

/**
 * 改建卡 @source 0x0041ed3e
 * 地块（须是我的）：连锁店 → 同區另有我的地就改；住宅 → 须 1 级，乖寶寶直接改，
 * 否则同區其余都得是对手的（有我的或无主的就不改）。
 * 設施：我的公園 1 级 → 改成随机 1..4；对手的非公園 ≥ 3 级（最恨的人 ≥ 2 级）→ 改。
 */
const gaijian: Handler = (view, hated) => {
  const here = hereOf(view);
  if (here === null) return null;
  const me1 = view.meIndex + 1;
  if (here.kind === 'land') {
    const l = landById(view, here.id);
    if (l === undefined || l.owner !== me1) return null;
    const others = view.lands.filter((o) => o.id !== l.id && sameStreet(o, l));
    if (l.type !== LAND_TYPE_HOUSE) return others.some((o) => o.owner === me1) ? NONE : null;
    if (l.level !== 1) return null;
    if (view.me.personality === 0) return NONE;
    return others.every((o) => o.owner !== 0 && o.owner !== me1) ? NONE : null;
  }
  if (here.kind === 'facility') {
    const f = facilityById(view, here.id);
    if (f === undefined) return null;
    if (f.owner === me1) {
      if (f.type !== FACILITY_TYPE.park || f.level !== 1) return null;
      return { target: { kind: 'none' }, facilityType: aiRoll(view.state, 7, 4) + 1 };
    }
    if (f.owner === 0 || f.type === FACILITY_TYPE.park) return null;
    if (f.level >= 3 || (f.owner === hated + 1 && f.level >= 2)) return NONE;
  }
  return null;
};

/** 拍賣卡 @source 0x0041ef26：脚下是对手 ≥ 3 级，或最恨的人 ≥ 2 级 */
const paimai: Handler = (view, hated) => {
  const here = hereOf(view);
  if (here === null) return null;
  const me1 = view.meIndex + 1;
  const e = here.kind === 'land' ? landById(view, here.id) : here.kind === 'facility' ? facilityById(view, here.id) : undefined;
  if (e === undefined || e.owner === 0 || e.owner === me1) return null;
  if (e.level >= 3) return NONE;
  return e.owner === hated + 1 && e.level >= 2 ? NONE : null;
};

/** 天使卡 @source 0x0041f037：画面里我有 ≥ 3 间未满级住宅的街，随机挑一條，目标是它第一块 */
const tianshi: Handler = (view) => {
  const me1 = view.meIndex + 1;
  const groups: { name: string; first: number; count: number }[] = [];
  for (const ent of visibleEntities(view)) {
    if (ent.kind !== 'land') continue;
    const l = landById(view, ent.id);
    if (l === undefined || l.owner !== me1 || l.type !== LAND_TYPE_HOUSE || l.level >= 5) continue;
    const g = groups.find((x) => x.name === l.name);
    if (g !== undefined) g.count++;
    else groups.push({ name: l.name, first: l.id, count: 1 });
  }
  const ok = groups.filter((g) => g.count >= 3);
  if (ok.length === 0) return null;
  return land(ok[aiRoll(view.state, 9, ok.length)]!.first);
};

/**
 * 惡魔卡 @source 0x0041f1b3：按街统计画面里各家住宅的间数与等级和；
 * 有最恨的人：他那條街 ≥ 2 间、等级和 ≥ 7、我 ≤ 1 → 砸；没有：我为 0、对手合计 ≥ 3 间、等级和 ≥ 9。
 */
const emo: Handler = (view, hated) => {
  const n = view.state.players.length;
  const groups: { name: string; first: number; levels: number[]; counts: number[] }[] = [];
  for (const ent of visibleEntities(view)) {
    if (ent.kind !== 'land') continue;
    const l = landById(view, ent.id);
    if (l === undefined || l.type !== LAND_TYPE_HOUSE || l.owner === 0) continue;
    let g = groups.find((x) => x.name === l.name);
    if (g === undefined) {
      g = { name: l.name, first: l.id, levels: new Array<number>(n).fill(0), counts: new Array<number>(n).fill(0) };
      groups.push(g);
    }
    g.levels[l.owner - 1]! += l.level;
    g.counts[l.owner - 1]! += 1;
  }
  for (const g of groups) {
    const myLevels = g.levels[view.meIndex] ?? 0;
    if (hated !== -1) {
      if ((g.counts[hated] ?? 0) >= 2 && (g.levels[hated] ?? 0) >= 7 && myLevels <= 1) return land(g.first);
      continue;
    }
    if (myLevels !== 0) continue;
    let count = 0;
    let levels = 0;
    for (let i = 0; i < n; i++) {
      if (i === view.meIndex || !isAlive(view.state.players[i]!)) continue;
      count += g.counts[i] ?? 0;
      levels += g.levels[i] ?? 0;
    }
    if (count >= 3 && levels >= 9) return land(g.first);
  }
  return null;
};

/**
 * 怪獸卡 @source 0x0041f400：画面里各对手最高级（同级取更贵）的 ≥ 3 级地块/設施；
 * 最恨的人先看設施再看地块；否则全体对手里挑最高（地块要 ≥ 4 级），設施优先。
 */
const guaishou: Handler = (view, hated) => {
  const n = view.state.players.length;
  const me1 = view.meIndex + 1;
  type Best = { level: number; price: number; id: number } | null;
  const bestLand: Best[] = new Array<Best>(n).fill(null);
  const bestFac: Best[] = new Array<Best>(n).fill(null);
  for (const ent of visibleEntities(view)) {
    if (ent.kind === 'land') {
      const l = landById(view, ent.id);
      if (l === undefined || l.owner === 0 || l.owner === me1 || l.level < 3) continue;
      const b = bestLand[l.owner - 1] ?? null;
      if (b === null || l.level > b.level || (l.level === b.level && l.landPrice > b.price)) {
        bestLand[l.owner - 1] = { level: l.level, price: l.landPrice, id: l.id };
      }
    } else if (ent.kind === 'facility') {
      const f = facilityById(view, ent.id);
      if (f === undefined || f.owner === 0 || f.owner === me1 || f.level < 3) continue;
      const b = bestFac[f.owner - 1] ?? null;
      if (b === null || f.level > b.level || (f.level === b.level && f.landPrice > b.price)) {
        bestFac[f.owner - 1] = { level: f.level, price: f.landPrice, id: f.id };
      }
    }
  }
  if (hated !== -1) {
    const bf = bestFac[hated] ?? null;
    if (bf !== null && bf.level >= 3) return facility(bf.id);
    const bl = bestLand[hated] ?? null;
    if (bl !== null && bl.level >= 3) return land(bl.id);
  }
  let pickL: Best = null;
  let pickF: Best = null;
  for (let i = 0; i < n && i < 4; i++) {
    if (i === view.meIndex || !isAlive(view.state.players[i]!)) continue;
    const bl = bestLand[i] ?? null;
    if (bl !== null && bl.level >= 4 && (pickL === null || bl.level > pickL.level || (bl.level === pickL.level && bl.price > pickL.price))) pickL = bl;
    const bf = bestFac[i] ?? null;
    if (bf !== null && bf.level >= 3 && (pickF === null || bf.level > pickF.level || (bf.level === pickF.level && bf.price > pickF.price))) pickF = bf;
  }
  if (pickF !== null) return facility(pickF.id);
  if (pickL !== null) return land(pickL.id);
  return null;
};

/**
 * 拆除卡 @source 0x0041f6a9：先按怪獸卡的判法找；找不到再扫画面：
 * 对手的连锁店且他连锁店 ≥ 4 间（乖寶寶不干）；我有座驾时别人的加油站；
 * 对手地上的路障（物件 16）、我地上的地雷（物件 17）。
 */
const chaichu: Handler = (view, hated) => {
  const viaMonster = guaishou(view, hated);
  if (viaMonster !== null) return viaMonster;
  const me1 = view.meIndex + 1;
  for (const ent of visibleEntities(view)) {
    if (ent.kind === 'land') {
      const l = landById(view, ent.id);
      if (l === undefined || view.me.personality === 0) continue;
      if (l.owner === 0 || l.owner === me1 || l.type === LAND_TYPE_HOUSE) continue;
      if (chainStoreCount(view.lands, l.owner) >= 4) return land(l.id);
    } else if (ent.kind === 'facility') {
      const f = facilityById(view, ent.id);
      if (f === undefined || (view.me.trafficMethod & 3) === 0) continue;
      if (f.type === FACILITY_TYPE.gasStation && f.level === 1 && f.owner !== me1) return facility(f.id);
    }
  }
  for (const o of visibleObjects(view)) {
    const obj = view.state.objects[o.objectIndex - 1];
    if (obj === undefined) continue;
    const ref = o.node.ref;
    const owner =
      ref.kind === 'land' ? (landById(view, ref.index)?.owner ?? 0) : ref.kind === 'facility' ? (facilityById(view, ref.index)?.owner ?? 0) : -1;
    if (owner < 0) continue;
    if (obj.type === 16 && owner !== 0 && owner !== me1) return { target: { kind: 'object', objectIndex: o.objectIndex } };
    if (obj.type === 17 && owner === me1) return { target: { kind: 'object', objectIndex: o.objectIndex } };
  }
  return null;
};

/** 搶奪卡 @source 0x0041f901：最恨的人手里 f7 ≥ 1 最贵的一张；否则全体对手里 f7 == 2 最贵的 */
const qiangduo: Handler = (view, hated) => {
  const rivals = visibleRivals(view);
  const def = (id: number): { f7: number; price: number } => {
    const c = CARDS.find((x) => x.id === id);
    return { f7: c?.f7 ?? 0, price: c?.price ?? 0 };
  };
  if (hated !== -1 && rivals.includes(hated)) {
    let pick = 0;
    let best = 0;
    for (const id of view.state.players[hated]!.cards) {
      const d = def(id);
      if (d.f7 >= 1 && d.price > best) {
        best = d.price;
        pick = id;
      }
    }
    if (pick !== 0) return { target: { kind: 'player', index: hated }, stealCard: pick };
  }
  let best = 0;
  let out: AiCardChoice | null = null;
  for (let i = 0; i < view.state.players.length; i++) {
    if (!rivals.includes(i)) continue;
    for (const id of view.state.players[i]!.cards) {
      const d = def(id);
      if (d.f7 === 2 && d.price > best) {
        best = d.price;
        out = { target: { kind: 'player', index: i }, stealCard: id };
      }
    }
  }
  return out;
};

/**
 * 停留卡 @source 0x0041facc
 * 对自己：不在龜行中；脚下是我的未满级住宅、房價×物價 < 現金、現金+存款 > 10000、財運 ≥ 0，
 *   且（同區另有我的地 或 ≥ 2 级）；設施同理（非公園/加油站，只看現金 > 10000）。
 * 对别人：他站在我的 ≥ 2 级非公園設施上，或我当董事長的企業上。
 */
const tingliu: Handler = (view) => {
  const me = view.me;
  const me1 = view.meIndex + 1;
  const pi = view.state.priceIndex;
  const here = hereOf(view);
  if (me.blocking.tortoiseWalking === 0 && here !== null) {
    if (here.kind === 'land') {
      const l = landById(view, here.id);
      if (
        l !== undefined && l.owner === me1 && l.type === LAND_TYPE_HOUSE && l.level < 5 &&
        l.housePrice * pi < me.cash && me.cash + me.moneyInBank > 10000 && me.fortune >= 0
      ) {
        if (view.lands.some((o) => o.id !== l.id && sameStreet(o, l) && o.owner === me1)) return SELF;
        if (l.level >= 2) return SELF;
      }
    } else if (here.kind === 'facility') {
      const f = facilityById(view, here.id);
      if (
        f !== undefined && f.owner === me1 && f.housePrice * pi < me.cash && me.cash > 10000 &&
        f.type !== FACILITY_TYPE.park && f.type !== FACILITY_TYPE.gasStation && f.level < 5 && me.fortune >= 0
      ) return SELF;
    }
  }
  for (let i = 0; i < view.state.players.length; i++) {
    const p = view.state.players[i]!;
    if (i === view.meIndex || !isAlive(p)) continue;
    const node = nodeOf(view.topo, p.nodeId);
    if (node === undefined) continue;
    if (node.ref.kind === 'facility') {
      const f = facilityById(view, node.ref.index);
      if (f !== undefined && f.owner === me1 && f.type !== FACILITY_TYPE.park && f.level >= 2) return player(i);
    } else if (node.ref.kind === 'commercial') {
      if ((view.state.commercialOwners[node.ref.index]?.owner ?? 0) === me1) return player(i);
    }
  }
  return null;
};

/** 冬眠卡 @source 0x0041fe4e：rand() % 4 == 0 */
const dongmian: Handler = (view) => (aiRoll(view.state, 15, 4) === 0 ? NONE : null);

/** 夢遊卡 / 陷害卡 @source 0x0041fe6f：画面里没在冬眠、手里没復仇卡的对手；最恨的人优先，否则随机 */
const mengyouXianhai = (cardId: number): Handler => (view, hated) => {
  const cands = visibleRivals(view).filter((i) => {
    const p = view.state.players[i]!;
    return p.blocking.sleeping === 0 && !p.cards.includes(18);
  });
  if (cands.length === 0) return null;
  if (cands.includes(hated)) return player(hated);
  return player(cands[aiRoll(view.state, cardId, cands.length)]!);
};

/** 送神符 @source 0x0041ff77：身上的神是坏神；或另一个跟班（f64）不是死神态 */
const songshen: Handler = (view) => {
  const me = view.me;
  if (me.godInfo !== 0) return DISPELLABLE_TYPES.includes(objectTypeOf(me.godInfo - 1)) ? NONE : null;
  if (me.f64 !== 0) {
    const o: MapObject | undefined = view.state.objects[me.f64 - 1];
    return o !== undefined && o.state < ATTACH_STATE_REAPER ? NONE : null;
  }
  return null;
};

/** 請神符可请的物件下标 @source 0x0041fff8 的 1/2/3/4/12 —— 下标 = 种类（唯一物件） */
export const SUMMON_WANTED_OBJECTS: readonly number[] = [1, 2, 3, 4, 12];

/** 請神符 @source 0x0041fff8 + 0x00444d1a：身上没有那几位时，请画面里离我最近、没主的好神 */
const qingshen: Handler = (view) => {
  if (SUMMON_WANTED_OBJECTS.includes(view.me.godInfo)) return null;
  const center = nodeOf(view.topo, view.me.nodeId);
  if (center === undefined) return null;
  let best = -1;
  let bestDist = 10000;
  for (const o of visibleObjects(view)) {
    const obj = view.state.objects[o.objectIndex - 1];
    if (obj === undefined || !canAttach(obj.type) || obj.attached !== 0) continue;
    const dx = o.node.x - center.x;
    const dy = o.node.y - center.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      best = o.objectIndex;
    }
  }
  return SUMMON_WANTED_OBJECTS.includes(best) ? { target: { kind: 'object', objectIndex: best } } : null;
};

/** 持仓市值：round(股数 × 成本) @source fild/fmul/round */
function holdingValue(view: CardAiView, who: number, j: number): number {
  const h = view.state.holdings[who]?.[j];
  if (h === undefined) return 0;
  return Math.round(h.amount * h.avgCost);
}
function marketOpenToday(view: CardAiView): boolean {
  const s = view.state;
  return marketOpenOn(s.globalMapId, s.year, s.month, s.day);
}

/** 紅卡 @source 0x00420055：开市日，我持仓市值最大、没在停牌、没漲停的一支 */
const hong: Handler = (view) => {
  if (!marketOpenToday(view)) return null;
  let pick = -1;
  let best = 0;
  view.state.market.stocks.forEach((st, j) => {
    const v = holdingValue(view, view.meIndex, j);
    if (v <= best) return;
    if (st.f6 !== 0 || isLimitUp(st.openPrice, st.price)) return;
    best = v;
    pick = j;
  });
  return pick === -1 ? null : { target: { kind: 'stock', index: pick } };
};

/**
 * 黑卡 @source 0x004200ea：开市日。企業最多的对手持仓市值最大、有企業、没停牌、我没持有、没跌停的一支；
 * 最恨的人同样挑一支（不看有没有企業）；最恨的人那支优先。
 */
const hei: Handler = (view, hated) => {
  if (!marketOpenToday(view)) return null;
  const n = view.state.players.length;
  const counts = new Array<number>(4).fill(0);
  view.state.commercialOwners.forEach((o) => {
    if (o.owner !== 0) counts[o.owner - 1]! += 1;
  });
  let tycoon = -1;
  let most = 0;
  for (let i = 0; i < 4 && i < n; i++) {
    if (i === view.meIndex) continue;
    if ((counts[i] ?? 0) > most) {
      most = counts[i]!;
      tycoon = i;
    }
  }
  const pickFrom = (who: number, needCompany: boolean): number => {
    let pick = -1;
    let best = 0;
    view.state.market.stocks.forEach((st, j) => {
      const v = holdingValue(view, who, j);
      if (v <= best) return;
      if (needCompany && st.commercialIndex === 0) return;
      if (st.f6 !== 0) return;
      if ((view.state.holdings[view.meIndex]?.[j]?.amount ?? 0) !== 0) return;
      if (isLimitDown(st.openPrice, st.price)) return;
      best = v;
      pick = j;
    });
    return pick;
  };
  const c1 = tycoon === -1 ? -1 : pickFrom(tycoon, true);
  const c2 = hated === -1 ? -1 : pickFrom(hated, false);
  if (c1 === -1 && c2 === -1) return null;
  return { target: { kind: 'stock', index: c2 !== -1 ? c2 : c1 } };
};

/** 查稅卡 @source 0x004202d2：最恨的人現金 > 30000×物價；否则谁 > 50000×物價 */
const chashui: Handler = (view, hated) => {
  const pi = view.state.priceIndex;
  const rivals = visibleRivals(view);
  if (hated !== -1 && rivals.includes(hated) && view.state.players[hated]!.cash > 30000 * pi) return player(hated);
  for (let i = 0; i < view.state.players.length; i++) {
    if (rivals.includes(i) && view.state.players[i]!.cash > 50000 * pi) return player(i);
  }
  return null;
};

/**
 * 漲價卡 @source 0x0042040e：画面里逐街看：最恨的人不在这條街、我的等级和 ≥ 7、
 * 对手等级和 ≤ 3、我占的间数 ≥ 一半 → 涨；地块没中就挑我的 ≥ 3 级非公園/研究所設施（取最后一个）。
 */
const zhangjia: Handler = (view, hated) => {
  const me1 = view.meIndex + 1;
  let prevName: string | null = null;
  let facPick = -1;
  for (const ent of visibleEntities(view)) {
    if (ent.kind === 'land') {
      const l = landById(view, ent.id);
      if (l === undefined) continue;
      if (prevName !== null && prevName === l.name) continue;
      prevName = l.name;
      let total = 0;
      let myLevels = 0;
      let myCount = 0;
      let rivalLevels = 0;
      let hatedOwns = false;
      for (const o of view.lands) {
        if (!sameStreet(o, l)) continue;
        total++;
        if (o.owner === me1) {
          myLevels += o.level;
          myCount++;
        } else if (o.owner !== 0) rivalLevels += o.level;
        if (hated !== -1 && o.owner === hated + 1) {
          hatedOwns = true;
          break;
        }
      }
      // @source fild/fdivp 后与 0x463d38 (= 0.5) 比较 —— 等价写成 2×間数 ≥ 总数，避开除法
      if (!hatedOwns && myLevels >= 7 && rivalLevels <= 3 && myCount * 2 >= total) return land(l.id);
    } else if (ent.kind === 'facility') {
      const f = facilityById(view, ent.id);
      if (f === undefined || f.owner !== me1) continue;
      if (f.type === FACILITY_TYPE.park || f.type === FACILITY_TYPE.lab || f.level < 3) continue;
      facPick = f.id;
    }
  }
  return facPick === -1 ? null : facility(facPick);
};

/**
 * 查封卡 @source 0x0042062b：前方 6 格：某條街（我没有地）对手等级和 ≥ 7 → 封那块；
 * 最恨的人的 ≥ 3 级非公園設施 → 封。
 */
const chafeng: Handler = (view, hated) => {
  const me1 = view.meIndex + 1;
  const ahead = lookahead(view.topo, view.state, view.me.nodeId, view.me.lastNodeId, 6, 28).nodes;
  let prevName: string | null = null;
  for (const nid of ahead) {
    const node = nodeOf(view.topo, nid);
    if (node === undefined) continue;
    if (node.ref.kind === 'land') {
      const l = landById(view, node.ref.index);
      if (l === undefined) continue;
      if (prevName !== null && prevName === l.name) continue;
      prevName = l.name;
      let rivalLevels = 0;
      let mine = false;
      for (const o of view.lands) {
        if (!sameStreet(o, l)) continue;
        if (o.owner === me1) {
          mine = true;
          break;
        }
        if (o.owner !== 0) rivalLevels += o.level;
      }
      if (!mine && rivalLevels >= 7) return land(l.id);
    } else if (node.ref.kind === 'facility' && hated !== -1) {
      const f = facilityById(view, node.ref.index);
      if (f !== undefined && f.owner === hated + 1 && f.type !== FACILITY_TYPE.park && f.level >= 3) return facility(f.id);
    }
  }
  return null;
};

/** 同盟卡 @source 0x004207cc：画面里不是最恨的人、没和我结盟的对手中，地產最多的那位 */
const tongmeng: Handler = (view, hated) => {
  const me1 = view.meIndex + 1;
  const cands = visibleRivals(view).filter((i) => i !== hated && view.state.players[i]!.alliedPlayer !== me1);
  if (cands.length === 0) return null;
  let best = -1;
  let most = 0;
  for (let i = 0; i < view.state.players.length; i++) {
    const p = view.state.players[i]!;
    if (i === view.meIndex || !isAlive(p)) continue;
    let n = 0;
    for (const l of view.lands) if (l.owner === i + 1) n++;
    for (const f of view.facilities) if (f.owner === i + 1) n++;
    if (n > most) {
      most = n;
      best = i;
    }
  }
  return cands.includes(best) ? player(best) : null;
};

/**
 * 烏龜卡 @source 0x00420970
 * 对自己：前方 3 格无岔路；格子是无主地/我的未满级住宅（設施：无主/我的非公園加油站未满级）
 *   就累加价钱、计数；碰到对手同區过路费总和 > 1000×物價 的地、对手有等级的非公園/研究所設施、
 *   别人当董事長的企業就作罢。累计 × 1.5 < 現金、计数 ≥ 2、現金+存款 > 10000、財運 ≥ 0 → 对自己。
 * 对别人：画面里的对手，前方 3 格无岔路且都有主、没一格是他自己的；我的地/設施/企業累计过路费
 *   ≥ 10000×物價 且 ≥ 2 格 → 对他。
 */
const wugui: Handler = (view) => {
  const me = view.me;
  const me1 = view.meIndex + 1;
  const pi = view.state.priceIndex;

  const self = lookahead(view.topo, view.state, me.nodeId, me.lastNodeId, 3, 30);
  let selfOk = !self.forked;
  if (selfOk) {
    let total = 0;
    let count = 0;
    for (const nid of self.nodes) {
      const node = nodeOf(view.topo, nid);
      if (node === undefined) continue;
      if (node.ref.kind === 'land') {
        const l = landById(view, node.ref.index);
        if (l === undefined) continue;
        if (l.owner === 0 || (l.owner === me1 && l.type === LAND_TYPE_HOUSE && l.level < 5)) {
          total += l.owner === 0 ? l.landPrice : l.housePrice;
          count++;
        }
        if (l.owner !== 0 && l.owner !== me1 && streetTollOf(view.lands, l.owner, l.name) > 1000 * pi) {
          selfOk = false;
          break;
        }
      } else if (node.ref.kind === 'facility') {
        const f = facilityById(view, node.ref.index);
        if (f === undefined) continue;
        if (f.owner === 0 || (f.owner === me1 && f.type !== FACILITY_TYPE.park && f.type !== FACILITY_TYPE.gasStation && f.level < 5)) {
          total += f.owner === 0 ? f.landPrice : f.housePrice;
          count++;
        }
        if (f.owner !== 0 && f.owner !== me1 && f.type !== FACILITY_TYPE.park && f.type !== FACILITY_TYPE.lab && f.level !== 0) {
          selfOk = false;
          break;
        }
      } else if (node.ref.kind === 'commercial') {
        const chairman = view.state.commercialOwners[node.ref.index]?.owner ?? 0;
        if (chairman !== 0 && chairman !== me1) {
          selfOk = false;
          break;
        }
      }
    }
    if (selfOk && total * 1.5 < me.cash && count >= 2 && me.cash + me.moneyInBank > 10000 && me.fortune >= 0) return SELF;
  }

  for (const i of visibleRivals(view)) {
    const p = view.state.players[i]!;
    const ahead = lookahead(view.topo, view.state, p.nodeId, p.lastNodeId, 3, 300 + i);
    if (ahead.forked) continue;
    let total = 0;
    let count = 0;
    let valid = true;
    for (const nid of ahead.nodes) {
      const node = nodeOf(view.topo, nid);
      if (node === undefined) continue;
      if (node.ref.kind === 'land') {
        const l = landById(view, node.ref.index);
        if (l === undefined) continue;
        if (l.owner === me1) {
          total += streetTollOf(view.lands, me1, l.name);
          count++;
        }
        if (l.owner === 0 || l.owner === i + 1) {
          valid = false;
          break;
        }
      } else if (node.ref.kind === 'facility') {
        const f = facilityById(view, node.ref.index);
        if (f === undefined) continue;
        if (f.owner === me1 && f.type !== FACILITY_TYPE.park && f.type !== FACILITY_TYPE.lab && f.level !== 0) {
          total += f.rateByLevel[f.level] ?? 0;
          count++;
        }
        if (f.owner === 0 || f.owner === i + 1) {
          valid = false;
          break;
        }
      } else if (node.ref.kind === 'commercial') {
        const cid = node.ref.index;
        const chairman = view.state.commercialOwners[cid]?.owner ?? 0;
        if (chairman === me1) {
          total += view.topo.commercials?.find((c) => c.id === cid)?.landPrice ?? 0;
          count++;
        }
        if (chairman === 0 || chairman === i + 1) {
          valid = false;
          break;
        }
      }
    }
    if (valid && total >= 10000 * pi && count >= 2) return player(i);
  }
  return null;
};

/** 跳表 0x475324 的 1..30 项；缺席 = `xor eax,eax; ret` */
const HANDLERS: Readonly<Record<number, Handler>> = {
  1: junfu,
  2: junpin,
  3: goudi,
  4: huandi,
  7: gaijian,
  8: paimai,
  9: tianshi,
  10: emo,
  11: guaishou,
  12: chaichu,
  13: qiangduo,
  14: tingliu,
  15: dongmian,
  16: mengyouXianhai(16),
  17: mengyouXianhai(17),
  22: songshen,
  23: qingshen,
  24: hong,
  25: hei,
  26: chashui,
  27: zhangjia,
  28: chafeng,
  29: tongmeng,
  30: wugui,
};

/** AI 从不主动打的卡（跳表指向 `xor eax,eax; ret`） */
export const AI_NEVER_PLAYS: readonly number[] = [5, 6, 18, 19, 20, 21];

/**
 * 这张卡此刻出不出、对谁出。`null` = 不出。
 *
 * 这是跳表那一跳本身；個性闸门（f7 − 個性）在 policy.ts 的 `decideCard` 里先过。
 */
export function aiCardChoice(cardId: number, view: CardAiView): AiCardChoice | null {
  const h = HANDLERS[cardId];
  if (h === undefined) return null;
  return h(view, mostHated(view.state.players, view.meIndex));
}

/**
 * 原版一回合看哪几张 @source 0x00441d31..0x00441d96：手牌 > 8 张时从 `rand() % 张数`
 * 起环形取 8 张，否则从头取；按这个顺序试，**第一张过闸又肯出的**就打，一回合最多一张。
 */
export function cardsToConsider(hand: readonly number[], roll: number): number[] {
  const count = hand.length;
  if (count === 0) return [];
  const start = count > 8 ? roll % count : 0;
  const out: number[] = [];
  for (let k = 0; k < Math.min(8, count); k++) out.push(hand[(start + k) % count]!);
  return out;
}
