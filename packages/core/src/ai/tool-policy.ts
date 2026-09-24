/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * AI 用道具：十三件道具各自的「用不用、对谁用」
 *
 * ★ 逐条译自 rich4.exe 的跳表 `0x475324` 道具侧：entry 31..43 = 道具 1..13，
 *   判定从個性闸门 `0x420e9a` 里 `call [eax*4 + 0x47539c]` 进入（0x47539c =
 *   0x475324 + 30×4，同一张表），返回 1 = 用，参数写在 `[0x48be64]`
 *   （效果侧经 `0x420eee` 读出）。
 *
 *   主线（VA 0x00447f82 起）：`test byte [player+0x16], 2`（aiFlags bit1）→
 *   扫 13 格道具栏收集持有的道具编号、**跳过槽下标 9（時光機）** →
 *   种类 > 4 时 `rand() % 种类数` 当起点，**环形最多试 4 件** →
 *   每件先过闸门再过跳表函数，第一件肯用的经效果表 `[0x475dd5 + id×4]` 执行。
 *   与卡片的「>8 张环形取 8」同构。
 *
 * ## 三个共享缓冲区（前瞻/反瞻/视野）
 *
 * - `b8b4` 路径节点表：`0x40b221(player, n)` 前瞻（从 nodeId 走、prev=lastNodeId），
 *   `0x40b343(player, n)` **反瞻**（从 lastNodeId 走、prev=nodeId）——同一算法方向相反，
 *   都写 b8b4，n 封顶 8，返回值 = 是否遇到过岔路（forked）。
 * - `b8c4` 可见表：`0x409ef9()` 扫出画面内**节点 id**；`0x40a45c(-1)` 扫出画面内
 *   实体（地块 2000+/設施 4000+/企業 6000+）与玩家标记 0x80xx；
 *   `0x40a0b1(x, y, r)` 以地图点为中心的实体表 + 只画**当前玩家**的 0x80xx。
 *   本引擎一律用「以我为中心 ±220px 的方形视野」（card-policy.ts 的 VIEW_HALF），
 *   镜头钳位差异记 D-005；爆风半径用节点坐标方窗，与效果侧一致（Q-TOOL-1）。
 *
 * ## 参数语义（`[0x48be64]`）
 *
 *   路障/地雷/定時炸彈/傳送機 = 节点 id；遙控骰子 = 步数 1..6；
 *   機器工人 = 我地产所在格值（2000+地块 / 4000+設施）；飛彈 = 目标玩家格值 0x80xx；
 *   核子 = 实体格值。傳送機的效果（0x447428）把参数当节点 id 枚举可走邻居定朝向
 *   —— **AI 的傳送機 = 把自己搬到选中格**。
 *
 * ⚠️ 这里只回答「用不用、对谁」；能不能用由 reduce 的 `useToolAction` 说了算（C-ARC-2）。
 *   随机（>4 的起点、地雷/定時炸彈挑候选、機車/汽車的 1/4、工程車的 %15）在纯策略层
 *   用 `aiRoll` 的确定性替身，与卡片同一约定（D-004）。
 */

import type { MapNode } from '../loaders/map.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import type { MapObject } from '../cards/summon.ts';
import { SPECIAL_KIND, MAX_LAND_LEVEL } from '../loaders/map.ts';
import { isAlive } from '../state/types.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';
import { FACILITY_TYPE, FACILITY_MAX_LEVEL } from '../rules/facility.ts';
import { MISSILE_RADIUS } from '../rules/tool-effects.ts';
// ★ 需求方 2026-09-22：放置类道具不许和「唯一物件」同格 —— AI 必须与引擎同一条判据
import { runtimeOccupiedNodes } from '../rules/object-landing.ts';
import { anyPlayerConfined } from '../rules/confinement.ts';
import {
  aiRoll,
  inView,
  lookahead,
  mostHated,
  streetTollOf,
  visibleEntities,
  type CardAiView,
} from './card-policy.ts';

/** 道具 AI 的视野与牌共用同一个 */
export type ToolAiView = CardAiView;

/**
 * AI 用道具的选择 —— 与 `useTool` action 的参数编码对应：
 * - `plain`：无参（機器娃娃/機車/汽車/工程車）
 * - `place`：放到这格（路障/地雷/定時炸彈）→ `nodeId`
 * - `missile`：打这个目标玩家所在格（飛彈）→ `nodeId`
 * - `dice`：指定点数（遙控骰子，1..6）→ `value`
 * - `build`：这格地产免费加盖（機器工人）→ `nodeId`
 * - `teleportSelf`：把自己搬到这格（傳送機）→ `nodeId=玩家+1, value=节点`
 */
export type AiToolChoice =
  | { kind: 'plain' }
  | { kind: 'place'; nodeId: number }
  | { kind: 'missile'; nodeId: number }
  | { kind: 'dice'; steps: number }
  | { kind: 'build'; nodeId: number }
  | { kind: 'teleportSelf'; nodeId: number };

/** 各判定函数的 VA——同时充当 aiRoll 的盐（D-004） */
const SALT = {
  doll: 0x420efa,
  luzhang: 0x42107f,
  dilei: 0x4213c5,
  dingzha: 0x421574,
  jiche: 0x421644,
  qiche: 0x421675,
  feidan: 0x421717,
  yaokong: 0x421827,
  gongren: 0x421ba6,
  chuansong: 0x421cb6,
  gongcheng: 0x421e20,
  /** 13 核子飛彈：每次重摇候选的 `call 0x456f2d` 调用点 @source 0x0042216f */
  hedan: 0x42216f,
} as const;

/** 主线里那次 `rand() % 种类数` 的调用点 @source 0x00447ff5 */
export const TOOL_RING_SALT = 0x447ff5;

const PLAIN: AiToolChoice = { kind: 'plain' };
const place = (nodeId: number): AiToolChoice => ({ kind: 'place', nodeId });

// ============================================================
//  小件：查节点、查物件、查玩家、反瞻、可见节点
// ============================================================

function nodeAt(view: ToolAiView, nodeId: number): MapNode | undefined {
  return view.topo.nodes[nodeId - 1];
}

function landById(view: ToolAiView, id: number): LandInfo | undefined {
  return view.lands.find((l) => l.id === id);
}

function facilityById(view: ToolAiView, id: number): FacilityInfo | undefined {
  return view.facilities.find((f) => f.id === id);
}

/** 站在这格上的物件（原版的 node+0x24 bits 16-21 每格至多一件） */
function objectOnNode(view: ToolAiView, nodeId: number): MapObject | undefined {
  return view.state.objects.find((o) => o.nodeId === nodeId);
}

/** 这格上有没有（活着的）玩家 @source node+0x24 bits 12-15 */
function anyoneOnNode(view: ToolAiView, nodeId: number): boolean {
  return view.state.players.some((p) => isAlive(p) && p.nodeId === nodeId);
}

/**
 * 反瞻 n 格 @source 0x0040b343：与前瞻（0x40b221）同一算法，
 * 起点/来路对调——从 lastNodeId 出发、避开 nodeId。
 */
function backtrack(view: ToolAiView, n: number, salt: number): { nodes: number[]; forked: boolean } {
  return lookahead(view.topo, view.state, view.me.lastNodeId, view.me.nodeId, n, salt);
}

/**
 * 画面里的**空**节点 id，按屏幕行序（先 y 后 x）@source 0x409ef9 的行序扫描。
 *
 * ★★ 「空」：0x409ef9 逐节点先 `0x00409f7c test dword [node+0x24], 0xffff00 / jne 跳过` ——
 *   有人站着 / 有惡人 / 已经有物件的格子**根本不进清单**（`placementBlockedAt` 同一道掩码）。
 *   先前漏了这一层 ⇒ 地雷 / 定時炸彈会挑到已经有地雷的格（需求方 2026-09-24「Npc把地雷重叠放置了」）。
 *   四个调用点（路障阶段二 0x4212b5 / 地雷 0x4213e8 / 定時炸彈 0x421597 / 傳送機 0x421cc1）都吃这一条。
 */
function visibleNodeIds(view: ToolAiView): number[] {
  const center = nodeAt(view, view.me.nodeId);
  if (center === undefined) return [];
  const occupied = runtimeOccupiedNodes(view.state.players, view.state.objects, view.state.specialActors);
  return view.topo.nodes
    .filter((n) => inView(center, n) && !occupied.has(n.id))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((n) => n.id);
}

/**
 * 同區我的地数 @source 各函数里的同名扫描循环：
 * `mov esi, 1 / cmp esi, [num_lands] / jg 结束` —— **从下标 1 起**（0 号地永远数不到），
 * 末次还会多读一格越界内存（无害垃圾）。越界那一下无法也不该复刻；跳过 0 号照抄。
 */
function myStreetCount(view: ToolAiView, land: LandInfo): number {
  const me1 = view.meIndex + 1;
  let n = 0;
  for (const l of view.lands) {
    if (l.id === 0) continue;
    if (l.name === land.name && l.owner === me1) n++;
  }
  return n;
}

/**
 * 「这格什么都没有」@source `test dword [node+0x24], 0x3fff00 / jne 跳过`
 * （bits 12-15 玩家、16-21 物件）。本引擎的运行时占用不进 `node.flags`（那是静态地图数据），
 * 改从 state 查；bits 8-11 语义未解，静态部分照查。
 */
function nodeClear(view: ToolAiView, node: MapNode): boolean {
  if ((node.flags & 0xf00) !== 0) return false;
  if (anyoneOnNode(view, node.id)) return false;
  // bits 12-15 同时也是**惡人**站的格（`runtimeOccupiedNodes` 的第三段）—— 引擎也拒这种格
  if (runtimeOccupiedNodes([], [], view.state.specialActors).has(node.id)) return false;
  return objectOnNode(view, node.id) === undefined;
}

// ============================================================
//  十三件道具
// ============================================================

type Handler = (view: ToolAiView) => AiToolChoice | null;

/**
 * 1 機器娃娃 @source 0x00420efa
 * 前瞻 4 格有岔路 → 不用。路径格上的物件：坏神(5/6/7/8)/惡犬(11) → 用；
 * 地雷(17) 在我自己的地上 → 用；路障(16) 在别人的地上且该地主同區过路费
 * > 3000×物價 → 用（設施按 0x989680 = 一千万处理，即别人的設施必用）。
 */
const doll: Handler = (view) => {
  const { state, me } = view;
  const pi = state.priceIndex;
  const me1 = view.meIndex + 1;
  const ahead = lookahead(view.topo, state, me.nodeId, me.lastNodeId, 4, SALT.doll);
  if (ahead.forked) return null;
  for (const nid of ahead.nodes) {
    const obj = objectOnNode(view, nid);
    if (obj === undefined) continue;
    const node = nodeAt(view, nid);
    if (node === undefined) continue;
    let owner = 0;
    let toll = 0;
    if (node.ref.kind === 'land') {
      const l = landById(view, node.ref.index);
      owner = l?.owner ?? 0;
      // @source call 0x419744 —— 该地主在这条街上的住宅过路费总和
      toll = l !== undefined && owner !== 0 ? streetTollOf(view.lands, owner, l.name, pi) : 0;
    } else if (node.ref.kind === 'facility') {
      owner = facilityById(view, node.ref.index)?.owner ?? 0;
      toll = 0x989680; // @source mov edx, 0x989680（0x420f4d）
    }
    const t = obj.type;
    if (t === 5 || t === 6 || t === 7 || t === 8 || t === 11) return PLAIN;
    if (t === 17 && owner === me1) return PLAIN;
    if (t === 16 && owner !== 0 && owner !== me1 && toll > 3000 * pi) return PLAIN;
  }
  return null;
};

/**
 * 2 路障 @source 0x0042107f —— 两阶段。
 *
 * 阶段一（前瞻 4 格无岔路才扫）：第一格「空且值得」的就放——
 *   (a) 无主住宅地：我同區地数 ≥ 2 或该地等级 ≠ 0，且 現金+存款 > 10000、
 *       財運 ≥ 0、非龜行、地價×物價 < 現金；
 *   (b) 无主設施：同样的钱闸，設施地價(+0x22)×物價 < 現金；
 *   (c) 百貨公司格（specialKind 15）且點券 > 200。
 * 阶段二（反瞻 6 格 ∩ 画面，**按画面行序**枚举可见格再查是否在路径里）：
 *   我的住宅地、同區过路费 > 6000×物價，取过路费最大的一格（并列取行序靠前者）。
 */
const luzhang: Handler = (view) => {
  const { state, me } = view;
  const pi = state.priceIndex;
  const me1 = view.meIndex + 1;

  const ahead = lookahead(view.topo, state, me.nodeId, me.lastNodeId, 4, SALT.luzhang);
  // @source 0x42109d：forked 直接跳阶段二
  if (!ahead.forked) {
    const rich = me.cash + me.moneyInBank > 10000 && me.fortune >= 0 && me.blocking.tortoiseWalking === 0;
    for (const nid of ahead.nodes) {
      const node = nodeAt(view, nid);
      if (node === undefined || !nodeClear(view, node)) continue;
      if (node.ref.kind === 'land') {
        const l = landById(view, node.ref.index);
        if (l === undefined || l.owner !== 0) continue;
        // @source 0x4210bd：同區 ≥ 2 跳过等级检查；否则等级 ≠ 0 才值得
        if (myStreetCount(view, l) < 2 && l.level === 0) continue;
        if (!rich || l.landPrice * pi >= me.cash) continue;
        return place(nid);
      } else if (node.ref.kind === 'facility') {
        const f = facilityById(view, node.ref.index);
        if (f === undefined || f.owner !== 0) continue;
        if (!rich || f.landPrice * pi >= me.cash) continue;
        return place(nid);
      } else if (node.specialKind === SPECIAL_KIND.DEPARTMENT_STORE && me.points > 200) {
        // @source 0x42126f：specialKind == 0xf 且點券(+0x30) > 0xc8 —— 不查钱
        return place(nid);
      }
    }
  }

  const behind = backtrack(view, 6, SALT.luzhang + 1);
  let best = 0;
  let bestNode = 0;
  for (const nid of visibleNodeIds(view)) {
    if (!behind.nodes.includes(nid)) continue;
    const node = nodeAt(view, nid);
    if (node === undefined || node.ref.kind !== 'land') continue;
    const l = landById(view, node.ref.index);
    if (l === undefined || l.owner !== me1) continue;
    const toll = streetTollOf(view.lands, me1, l.name, pi);
    // @source 0x42138f / 0x421393：两个「不大于就跳过」——阈值 6000×物價、严格大于才换位
    if (toll <= 6000 * pi || toll <= best) continue;
    best = toll;
    bestNode = nid;
  }
  if (bestNode === 0) return null;
  return place(bestNode);
};

/**
 * 3 地雷 @source 0x004213c5 / 4 定時炸彈 @source 0x00421574 —— 同一骨架：
 * 反瞻 6 格 ∩ 画面（按画面行序）；**监狱格有人坐牢 / 医院格有人住院 → 立即选定**
 * （不等扫完）；其余格进候选，最后 `rand() % 候选数` 随机挑。
 * 地雷只收**别人的**地/設施；定時炸彈什么格都收。
 */
function mineLike(view: ToolAiView, salt: number, enemyOnly: boolean): AiToolChoice | null {
  const me1 = view.meIndex + 1;
  const behind = backtrack(view, 6, salt);
  const candidates: number[] = [];
  for (const nid of visibleNodeIds(view)) {
    if (!behind.nodes.includes(nid)) continue;
    const node = nodeAt(view, nid);
    if (node === undefined) continue;
    // @source 0x421446 / 0x421469：与监狱/医院节点全局（0x48bae0/0x48bae2）比对，
    //   占用全局非 0 → 直选并立即返回。
    //   ★★ 是 `cmp dword [0x496b30], 0` —— **一次比 4 个字节 = 只含槽 0..3 玩家**，
    //   不是落点那种逐槽扫 8 个。仅物件槽（4..7）被占用时**不**直选
    //   （与 §四之二 第 3 条的「新闻用 4 字节」同一条宽度区分，第三处）。
    if (node.specialKind === SPECIAL_KIND.PRISON && anyPlayerConfined(view.state.prisonOccupancy)) {
      return place(nid);
    }
    if (node.specialKind === SPECIAL_KIND.HOSPITAL && anyPlayerConfined(view.state.hospitalOccupancy)) {
      return place(nid);
    }
    if (!enemyOnly) {
      candidates.push(nid);
      continue;
    }
    if (node.ref.kind === 'land') {
      const o = landById(view, node.ref.index)?.owner ?? 0;
      if (o !== 0 && o !== me1) candidates.push(nid);
    } else if (node.ref.kind === 'facility') {
      const o = facilityById(view, node.ref.index)?.owner ?? 0;
      if (o !== 0 && o !== me1) candidates.push(nid);
    }
  }
  if (candidates.length === 0) return null;
  // @source 0x42153e：两件道具共用的收尾——call rand / idiv 候选数
  const picked = candidates[aiRoll(view.state, 0x42153e, candidates.length)]!;
  return place(picked);
}

const dilei: Handler = (view) => mineLike(view, SALT.dilei, true);
const dingzha: Handler = (view) => mineLike(view, SALT.dingzha, false);

/** 5 機車 @source 0x00421644：徒步（traffic & 3 == 0）且 rand()%4 == 0 → 用 */
const jiche: Handler = (view) =>
  (view.me.trafficMethod & 3) === 0 && aiRoll(view.state, SALT.jiche, 4) === 0 ? PLAIN : null;

/** 6 汽車 @source 0x00421675：(traffic & 3) < 2 且 rand()%4 == 0 → 用 */
const qiche: Handler = (view) =>
  (view.me.trafficMethod & 3) < 2 && aiRoll(view.state, SALT.qiche, 4) === 0 ? PLAIN : null;

/**
 * 7 飛彈 @source 0x00421717
 * 目标 = 最恨的人（0x40d2d3），没有则 `select_one_active_player`（0x40d31c，随机活跃对手）；
 * 目标须在画面里（a45c 的 0x80xx 扫描）；再以目标脚下为中心 100px 扫爆风（a0b1）：
 * **我在爆风内、或我的地/設施在爆风内 → 放弃**，否则打。参数 = 目标的 0x80xx 格值，
 * 本引擎译成「目标玩家所在节点」。
 */
const feidan: Handler = (view) => {
  const { state, me } = view;
  const me1 = view.meIndex + 1;
  let target = mostHated(state.players, view.meIndex);
  if (target === -1) {
    const rivals: number[] = [];
    state.players.forEach((p, i) => {
      if (i !== view.meIndex && isAlive(p)) {
        // @source 0x40d341：`cmp dword [player + 0x32], 0 / jne 跳过` ——
        //   住店/消失/坐牢/住院这 4 个字节任一非 0 的人**不参与**随机对手
        //   （注意：`0x40d2d3` 最恨的人**没有**这道闸，两者不对称，照抄）。
        const b = p.blocking;
        if ((b.inHotel | b.disappearing | b.inPrison | b.inHospital) !== 0) return;
        rivals.push(i);
      }
    });
    if (rivals.length === 0) return null;
    target = rivals[aiRoll(state, SALT.feidan + 1, rivals.length)]!;
  }
  const tp = state.players[target];
  if (tp === undefined || !isAlive(tp)) return null;
  const myNode = nodeAt(view, me.nodeId);
  const tNode = nodeAt(view, tp.nodeId);
  if (myNode === undefined || tNode === undefined || !inView(myNode, tNode)) return null;
  // 爆风扫描：a0b1 只画**当前玩家**的 0x80xx，故任何玩家标记都是我（Q-TOOL-1 的方窗）
  for (const n of view.topo.nodes) {
    if (Math.abs(n.x - tNode.x) > MISSILE_RADIUS || Math.abs(n.y - tNode.y) > MISSILE_RADIUS) continue;
    if (n.id === me.nodeId) return null;
    if (n.ref.kind === 'land' && landById(view, n.ref.index)?.owner === me1) return null;
    if (n.ref.kind === 'facility' && facilityById(view, n.ref.index)?.owner === me1) return null;
  }
  return { kind: 'missile', nodeId: tp.nodeId };
};

/**
 * 8 遙控骰子 @source 0x00421827
 * 闸：godInfo ∈ {7,8,15}（衰神/死神附身）、龜行中、現金+存款 < 10000、財運 < 0 → 不用；
 * 前瞻 6 格必须无岔路。逐格（步数 i+1）：格上有玩家、或有坏物件
 * （类型 5,6,7,8,10,11,16,17,18）→ 跳过。
 *   - 无主住宅地：同區我的地 ≥ 2 且 現金 > 地價×2.5 → **立即定**；
 *   - 我的住宅（type 0、等级 < 5）：同區 ≥ 2、現金 > 房價×2.5、等级 > 目前最佳 → 记下不立即定；
 *   - 无主設施：現金 > 地價(+0x22)×2.5 → 立即定；
 *   - 我的設施（非公園非加油站、等级 < 5）：現金 > 房價(+0x24)×2.5 → 立即定。
 * 扫完没立即定的，用等级最高那条记录。
 * ×2.5 是浮点比较（常数表 0x463d48 = double 2.5）；C-DET-3 禁浮点，
 * 用整数等价 `2×現金 > 5×價`（严格大于，两侧同构）。
 */
const DICE_BAD_OBJECTS: readonly number[] = [5, 6, 7, 8, 10, 11, 16, 17, 18];

const yaokong: Handler = (view) => {
  const { state, me } = view;
  const me1 = view.meIndex + 1;
  // @source 0x42183f：godInfo(+0x3f) 是物件下标+1，7/8 = 衰神、15 = 死神
  if (me.godInfo === 7 || me.godInfo === 8 || me.godInfo === 15) return null;
  if (me.blocking.tortoiseWalking !== 0) return null;
  if (me.cash + me.moneyInBank < 10000) return null;
  if (me.fortune < 0) return null;
  const ahead = lookahead(view.topo, state, me.nodeId, me.lastNodeId, 6, SALT.yaokong);
  if (ahead.forked) return null;

  let bestLevel = 0;
  let bestSteps = 0;
  for (let i = 0; i < ahead.nodes.length; i++) {
    const nid = ahead.nodes[i]!;
    const node = nodeAt(view, nid);
    if (node === undefined) continue;
    if (anyoneOnNode(view, nid)) continue;
    const obj = objectOnNode(view, nid);
    if (obj !== undefined && DICE_BAD_OBJECTS.includes(obj.type)) continue;
    if (node.ref.kind === 'land') {
      const l = landById(view, node.ref.index);
      if (l === undefined) continue;
      if (l.owner === 0) {
        if (myStreetCount(view, l) >= 2 && 2 * me.cash > 5 * l.landPrice) {
          return { kind: 'dice', steps: i + 1 };
        }
      } else if (l.owner === me1 && l.type === LAND_TYPE_HOUSE && l.level < MAX_LAND_LEVEL) {
        if (myStreetCount(view, l) >= 2 && 2 * me.cash > 5 * l.housePrice && l.level > bestLevel) {
          bestLevel = l.level;
          bestSteps = i + 1;
        }
      }
    } else if (node.ref.kind === 'facility') {
      const f = facilityById(view, node.ref.index);
      if (f === undefined) continue;
      if (f.owner === 0) {
        if (2 * me.cash > 5 * f.landPrice) return { kind: 'dice', steps: i + 1 };
      } else if (
        f.owner === me1 &&
        f.type !== FACILITY_TYPE.park &&
        f.type !== FACILITY_TYPE.gasStation &&
        f.level < MAX_LAND_LEVEL
      ) {
        if (2 * me.cash > 5 * f.housePrice) return { kind: 'dice', steps: i + 1 };
      }
    }
  }
  // @source 0x421b88：没立即定但有记录 → 用记录（flag 置 1，参数已在 [0x48be64]）
  return bestSteps !== 0 ? { kind: 'dice', steps: bestSteps } : null;
};

/**
 * 9 機器工人 @source 0x00421ba6
 * 画面内**我的**地产里可升级的：住宅（type==0、level<5）取值 rentByLevel[level]，
 * 設施（level < FACILITY_MAX_LEVEL[type]，表 @source 0x474940）取值 rateByLevel[level]，
 * 取**当前租金最高者**（严格大于才换 → 并列取画面行序最先）。
 * ⚠️ 設施下标 0 读到的就是 housePrice（+0x24 别名，见 loaders/map.ts）——照搬寻址。
 */
const gongren: Handler = (view) => {
  const me1 = view.meIndex + 1;
  let best = 0;
  let bestNode = 0;
  for (const ent of visibleEntities(view)) {
    if (ent.kind === 'land') {
      const l = landById(view, ent.id);
      if (l === undefined || l.owner !== me1 || l.type !== LAND_TYPE_HOUSE) continue;
      const value = l.rentByLevel[l.level] ?? 0;
      // @source 0x421c26 / 0x421c2e：先比值（jge 跳过）、再查等级（jae 跳过）
      if (best >= value || l.level >= MAX_LAND_LEVEL) continue;
      best = value;
      bestNode = ent.node.id;
    } else if (ent.kind === 'facility') {
      const f = facilityById(view, ent.id);
      if (f === undefined || f.owner !== me1) continue;
      // @source 0x421c77：level < byte [type + 0x474940]
      if (f.level >= (FACILITY_MAX_LEVEL[f.type] ?? 0)) continue;
      const value = f.rateByLevel[f.level] ?? 0;
      if (best >= value) continue;
      best = value;
      bestNode = ent.node.id;
    }
  }
  return bestNode !== 0 ? { kind: 'build', nodeId: bestNode } : null;
};

/**
 * 11 傳送機 @source 0x00421cb6
 * 画面里 **owner==0 且等级 ≥ 3** 的住宅（type==0）或設施（type≠0，公園除外），
 * 房價×物價 < 現金，取等级最高者（并列取行序最先）；找到候选后还要
 * 現金+存款 > 10000 且財運 ≥ 0。效果侧（0x447428）把参数当节点 id——**搬自己过去**。
 */
const chuansong: Handler = (view) => {
  const { state, me } = view;
  const pi = state.priceIndex;
  let best = 0;
  let bestNode = 0;
  for (const nid of visibleNodeIds(view)) {
    const node = nodeAt(view, nid);
    if (node === undefined) continue;
    if (node.ref.kind === 'land') {
      const l = landById(view, node.ref.index);
      if (l === undefined || l.owner !== 0 || l.type !== LAND_TYPE_HOUSE || l.level < 3) continue;
      if (best >= l.level || l.housePrice * pi >= me.cash) continue;
      best = l.level;
      bestNode = nid;
    } else if (node.ref.kind === 'facility') {
      const f = facilityById(view, node.ref.index);
      if (f === undefined || f.owner !== 0 || f.type === FACILITY_TYPE.park || f.level < 3) continue;
      if (f.housePrice * pi >= me.cash || best >= f.level) continue;
      best = f.level;
      bestNode = nid;
    }
  }
  if (bestNode === 0) return null;
  // @source 0x421dee：钱闸在**找到候选之后**才过
  if (me.cash + me.moneyInBank <= 10000 || me.fortune < 0) return null;
  return { kind: 'teleportSelf', nodeId: bestNode };
};

/**
 * 12 工程車 @source 0x00421e20
 * (traffic & 3) == 3（已开着工程車，0x1f & 3 == 3）→ 不用；
 * 否则 `rand() % 15 > 個性` → 不用（乖寶寶 1/15、普通人 2/15、大老奸 3/15）。
 */
const gongcheng: Handler = (view) => {
  if ((view.me.trafficMethod & 3) === 3) return null;
  return aiRoll(view.state, SALT.gongcheng, 15) <= view.me.personality ? PLAIN : null;
};

/** 核子飛彈爆风窗的半宽（格）@source 0x0040a236 `add ebx,0xe` / 0x0040a251 `cmp ebx,0x1c` */
const NUKE_WINDOW_HALF = 0xe;
/** 原版格距口径的 32px/格 @source 0x0040a22d `sar ebx,5`（与 `test_nuke_card_ai.py` 同） */
const NUKE_TILE_SHIFT = 5;
/** 原版最多重摇候选的次数 @source 0x00422160 `cmp ecx,0xa` */
const NUKE_MAX_TRIES = 10;

/**
 * 13 核子飛彈 @source 0x00421e62（862 B，`0x421e62..0x4221bf`）
 *
 * ## Q-TOOL-3 已结案 —— 原版 AI **会**放核彈
 *
 * `0x40a0b1(x, y, -1)` 的半径 −1 **不是全图**：该函数每次都以 (x,y) 为中心
 * 重建 440×440 实体图（`memset 0x5e880`，`@source 0x0040a108`），重建时只写进
 * 「格距 ±0xe = ±14 格」的**有主**地块/設施（`@source 0x0040a22d..0x0040a265`），
 * 以及**当前玩家一个**标记 `0x8000 | 1<<cur`（`@source 0x0040a1bb`；被关押/
 * 住店/消失时不写，`@source 0x0040a117`）。半径 −1 只决定回收时扫这张图的
 * 多大范围（`@source 0x0040a3e9 cmp edx,-1 / 0x0040a3f4 mov ebp,0x1b8` = 全图）
 * ——即「把刚建好的那一窗全要了」，不是全地图的地产。
 * ⇒ 中止判据 `test bh,0x80`（`@source 0x00421fe2`）的真语义是
 * **「我的棋子落在候选 ±14 格（448px）内」**，对随机挑中的候选完全可能为假
 * ⇒ 原版会发核彈。差分实证：`rich4-spec/tests/test_nuke_card_ai.py` 的 [Q] 组
 * （113 例全绿），以及该文件头部的 Q-TOOL-3 裁决。
 *
 * ## 算法（逐条照机器码）
 * ```
 * for (i = 1; i <= [0x498e98]; i++)             ; 地块，0 号永不入选 @source 0x421e87
 *     if (owner != 0 && owner != [0x49910c]+1 && level != 0) cand[count++] = 0x7d0 + i
 * for (i = 1; i <= [0x498e8c]; i++)             ; 設施，0 号永不入选 @source 0x421ef3
 *     同三道闸                                    cand[count++] = 0xfa0 + i
 * if (count == 0) return 0                       ; 一次 rand 都不摇 @source 0x421f51
 * for (try = 0; try < 10 && !found; try++) {     ; @source 0x422160 cmp ecx,0xa
 *     id = cand[rand() % count]                  ; @source 0x42216f
 *     (x, y) = 记录 +0/+2（int16）                ; @source 0x421f82/0x421f86
 *     n = blast(0x40a0b1)(x, y, -1)              ; ★ 半径恒 −1 @source 0x421f92
 *     abort = 0; my = ot = myLv = otLv = 0
 *     for (k = 0; k < n; k++) {
 *         w = word[0x48b8c4 + k*2]
 *         if (w & 0x8000) { abort = 1; break }   ; 玩家标记 ⇒ 放弃**本候选** @source 0x421fe2
 *         if (0x4216ab(cur, w) == 1) { myLv += level(w); my++ } else { otLv += level(w); ot++ }
 *     }
 *     if (!abort && my/ot < 1/(存活数+2) && myLv/otLv < 1/(存活数+2)) {
 *         [0x48be64] = id; found = 1             ; @source 0x42213a
 *     }
 * }
 * return found
 * ```
 *
 * ## 照抄原版编译产物的两条怪癖
 * 1. `fcomp` + `jae`（`@source 0x00422125` / `0x00422138`）把 **NaN 当「小于」**：
 *    对方等级和恰为 0 时 `myLv/otLv = 0/0` 照样「过关」（同 Python 测试 [E8]/[E9]）。
 *    ★ 真实路径上**不可达**：候选自己必在窗内且 level ≠ 0 ⇒ `ot ≥ 1`、`otLv ≥ 1`，
 *    两个比值都有限。故这里按 C-DET-3 用整数交叉相乘（见下），结论与浮点比较逐点相同。
 * 2. `0x4216ab` 的「不是我的」出口返回**调用方的 edx**（`@source 0x00421714`），
 *    而 edx 在每次调用后被 `@source 0x0042201f mov edx,eax` 覆写成
 *    `(前一 id − 0xfa0) × 8`，恒 ≠ 1 ⇒ 本上下文里 `cmp [esp+0x42c],1` 就是
 *    「owner == cur+1」。
 *
 * ## 与效果侧的区分（Q-TOOL-3 的根因）
 * 效果侧的 `damage_area`（`rules/tool-effects.ts` 的 `NUKE_RADIUS = -1`）**没错**：
 * 它把半径直接交给**纯收集器** `0x40a45c(-1)`（`@source 0x0040ac95`），那里
 * 先 `call 0x409de7` 按当前画面填图、−1 即整张屏 ⇒ 那一发确实是全图。
 * 错的只是「拿效果侧半径去解释 AI 侧的扫描窗」。
 *
 * ⚠️ 本函数**没有钱闸**：`0x421e62` 全程不读現金/存款/財運（「我出不起」由
 *   效果侧与回合流程管）。候选只看 归属/等级 三项。
 *
 * ⚠️ D-004：原版**每次 try 摇一次** `rand()`（最多 10 次）。本引擎 `aiRoll`
 *   不推进序列，故逐次用 `SALT.hedan + try` 区分；否则 10 次会取到同一个候选、
 *   重试循环成了死码（「中止后换下一个候选」这条可观测行为就没了）。
 *
 * ⚠️ 返回值：原版把**实体格值**（`0x7d0+地块` / `0xfa0+設施`）写进 `[0x48be64]`。
 *   引擎的 `useTool` 只用节点号（核彈 heavy 支全图，节点号仅用于校验），
 *   故这里折算成候选所在节点；找不到节点的候选跳过（原版不需要节点号）。
 */
const hedan: Handler = (view) => {
  const { state, me } = view;
  const me1 = view.meIndex + 1;

  // ── 候选收集：地块在前、設施在后，各自按表下标升序 @source 0x421e87 / 0x421ef3 ──
  const lands = [...view.lands].sort((a, b) => a.id - b.id);
  const facilities = [...view.facilities].sort((a, b) => a.id - b.id);
  const cands: { value: number; x: number; y: number }[] = [];
  for (const l of lands) {
    if (l.id === 0 || l.owner === 0 || l.owner === me1 || l.level === 0) continue;
    cands.push({ value: 0x7d0 + l.id, x: l.x, y: l.y });
  }
  for (const f of facilities) {
    if (f.id === 0 || f.owner === 0 || f.owner === me1 || f.level === 0) continue;
    cands.push({ value: 0xfa0 + f.id, x: f.x, y: f.y });
  }
  if (cands.length === 0) return null; // @source 0x421f51

  // 实体格值 → 节点号（引擎落 action 用；原版只写格值）
  const nodeByValue = new Map<number, number>();
  for (const n of view.topo.nodes) {
    const v =
      n.ref.kind === 'land'
        ? 0x7d0 + n.ref.index
        : n.ref.kind === 'facility'
          ? 0xfa0 + n.ref.index
          : 0;
    if (v !== 0 && !nodeByValue.has(v)) nodeByValue.set(v, n.id);
  }

  // ── 爆风窗 = 以候选为中心、格距 ≤ 14 格（原版 0x40a0b1 的建图口径）──
  //    原版比较的是 `(要素像素 >> 5) − (候选像素 >> 5) + 0xe ∈ [0,0x1c]`，
  //    即两侧格号的差 ≤ 14；这里同口径（`>> 5` = `sar 5`）。
  const tileOf = (v: number): number => v >> NUKE_TILE_SHIFT;
  const myNode = nodeAt(view, me.nodeId);
  // @source 0x40a117：住店/消失/坐牢/住院（+0x32 起的 4 字节）任一非 0 ⇒ 不画我的标记
  const b = me.blocking;
  const myMarkerDrawn = (b.inHotel | b.disappearing | b.inPrison | b.inHospital) === 0;
  // 阈值 1/(存活数+2)：0x40d2b4 数 whoPlays != 0 的人，0x4220e9 起 +2 再 fld1/fdivrp。
  // 判据 `mine/other < 1/(存活数+2)` 用**整数交叉相乘**（C-DET-3；同 yaokong 的
  // `2×現金 > 5×價`、zhangjia 的 `2×間数 ≥ 总数` 约定）：两侧同乘 `other×(存活数+2) > 0`
  // 等价。原版那两条 `fcomp/jae`（`0x00422125`/`0x00422138`）的 NaN 怪癖在此**不可达**：
  // 候选自己必在窗内且 level ≠ 0 ⇒ other ≥ 1、otherLv ≥ 1，两个比值都是有限数。
  const alivePlus2 = state.players.filter((p) => isAlive(p)).length + 2;

  for (let attempt = 0; attempt < NUKE_MAX_TRIES; attempt++) {
    const pick = cands[aiRoll(state, SALT.hedan + attempt, cands.length)]!; // @source 0x42216f
    const cx = tileOf(pick.x);
    const cy = tileOf(pick.y);
    const inWindow = (x: number, y: number): boolean =>
      Math.abs(tileOf(x) - cx) <= NUKE_WINDOW_HALF && Math.abs(tileOf(y) - cy) <= NUKE_WINDOW_HALF;

    // 中止：我的棋子也进了这一窗 ⇒ 放弃**本候选**（换下一个，中止标志每候选重置）
    // @source 0x421fd4 test bh,0x80 / 0x421fe7 mov [esp+0x414],1
    if (myMarkerDrawn && myNode !== undefined && inWindow(myNode.x, myNode.y)) continue;

    let mine = 0;
    let other = 0;
    let mineLv = 0;
    let otherLv = 0;
    for (const l of lands) {
      if (l.owner === 0 || !inWindow(l.x, l.y)) continue;
      if (l.owner === me1) {
        mine++;
        mineLv += l.level;
      } else {
        other++;
        otherLv += l.level;
      }
    }
    for (const f of facilities) {
      if (f.owner === 0 || !inWindow(f.x, f.y)) continue;
      if (f.owner === me1) {
        mine++;
        mineLv += f.level;
      } else {
        other++;
        otherLv += f.level;
      }
    }

    // 两个比值都 < 1/(存活数+2) 才发（整数交叉相乘，见上）
    if (mine * alivePlus2 < other && mineLv * alivePlus2 < otherLv) {
      const nodeId = nodeByValue.get(pick.value) ?? 0;
      // 引擎需要节点号落地；原版只需要格值，故缺节点时顺延下一个候选
      if (nodeId === 0) continue;
      return { kind: 'missile', nodeId };
    }
  }
  return null;
};

/** 跳表 31..43 项（= 道具 1..13）；缺席的那一件见 AI_NEVER_USES */
const HANDLERS: Readonly<Record<number, Handler>> = {
  1: doll,
  2: luzhang,
  3: dilei,
  4: dingzha,
  5: jiche,
  6: qiche,
  7: feidan,
  8: yaokong,
  9: gongren,
  11: chuansong,
  12: gongcheng,
  13: hedan,
};

/**
 * AI 从不用的道具：只剩 **10 時光機** —— 跳表项 = `xor eax, eax; ret`（0x420edf），
 * 道具栏扫描还跳过槽 9，双保险。
 *
 * ★ 13 核子飛彈**曾经**在列，理由是「`a0b1(x, y, -1)` 的半径 −1 = 全图 ⇒
 *   『我在爆风内』恒真 ⇒ 原版 AI 从不放核彈」。**Q-TOOL-3 已用机器码推翻**
 *   （差分见 `rich4-spec/tests/test_nuke_card_ai.py`，113 例；裁决见文件头）：
 *   半径 −1 只决定 `0x40a0b1` 回收时扫**它刚重建的那张图**的多大范围，而那张图
 *   里只有候选周围 ±14 格的有主地块/設施 + 当前玩家一个标记 ⇒ 中止判据可假
 *   ⇒ 原版会发核彈。13 已接线（见 `hedan`）。
 */
export const AI_NEVER_USES: readonly number[] = [10];

/**
 * 这件道具此刻用不用、对谁用。`null` = 不用。
 *
 * 这是跳表那一跳本身；個性闸门（f7 − 個性）在 policy.ts 的 `decideTool` 里先过，
 * 「最多环形试 4 件」由 `toolsToConsider` 给序。
 */
export function aiToolChoice(toolId: number, view: ToolAiView): AiToolChoice | null {
  const h = HANDLERS[toolId];
  if (h === undefined) return null;
  return h(view);
}

/**
 * 原版一回合试哪几件 @source 0x00447fec..0x00448022：持有种类 > 4 时从
 * `rand() % 种类数` 起**环形最多试 4 件**，否则从头按槽序；第一个过闸又肯用的就执行，
 * 一回合最多一件。
 */
export function toolsToConsider(owned: readonly number[], roll: number): number[] {
  const count = owned.length;
  if (count === 0) return [];
  const start = count > 4 ? roll % count : 0;
  const out: number[] = [];
  for (let k = 0; k < Math.min(4, count); k++) out.push(owned[(start + k) % count]!);
  return out;
}
