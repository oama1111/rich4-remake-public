/*
 * 四大惡人的走子循环
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 把 `rules/npc-actions.ts` 里那些**纯规则**接到棋盘上：一步一步走，
 *   每落一格查一次该做什么，直到步数走完、或他自己被送回監獄/醫院。
 *
 * ★ **为什么整段同步跑完**：原版把 `[0x49910c]` 切成 4..7，
 *   走完再切回玩家（機器娃娃那条同理，见 `runDoll`）。
 *   这期间没有任何玩家输入，所以对 core 来说它就是**一个动作**，
 *   不需要拆成待决交互。动画分帧是表现层的事（C-ARC-2）。
 *
 * ⚠️ **落点行为里没做的两条**（間諜取過路費/取盈餘）缺的是**状态不是规则**，
 *   见 `npc-actions.ts` 的说明与 known-deviations 的 Q-NPC-1。
 */

import type { GameState, Player } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode } from '../loaders/map.ts';
import type { WatcomRng } from '../rng/watcom.ts';
import { isAlive } from '../state/types.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { PAY_FLAG_CREDIT_TO_CASH, transferMoney } from './payment.ts';
import {
  OBJECT_TYPE_GIFT,
  OBJECT_TYPE_TREASURE,
  TREASURE_POINTS,
  drawGiftTool,
} from './object-landing.ts';
import { giveTool } from './tools.ts';
import {
  ACTOR_PLACE,
  SPECIAL_ACTOR_BASE,
  idleActor,
  type SpecialActor,
} from './special-actors.ts';
import {
  NPC,
  bankRobbery,
  npcHomeOf,
  npcReturnsHome,
  pickCardToSteal,
  facilityProtectionFee,
  pickVictim,
  protectionFee,
  stealPoints,
  stealsCard,
  stealsPoints,
  thiefTakes,
} from './npc-actions.ts';

/**
 * 走子需要的地图静态数据。
 *
 * ★ 故意**不用** `MapTopology` —— 那个类型定义在 `state/reduce.ts` 里，
 *   而 reduce 要 import 本模块，直接引会绕成环。这里只列真正用得上的三样。
 */
export interface NpcMap {
  nodes: readonly MapNode[];
  lands?: readonly LandInfo[];
  facilities?: readonly FacilityInfo[];
}

/** 走一趟之后要落回状态的东西 */
export interface NpcWalk {
  actor: SpecialActor;
  /** 走过的节点，含起点 */
  path: number[];
  /** 这趟产生的每一笔动作，按发生顺序 —— 供 UI 播报与测试断言 */
  events: NpcEvent[];
}

export type NpcEvent =
  /**
   * 小偷拿走一件东西。`tool` 是进主人道具栏的编号（0 = 不进道具栏）：
   * - 禮物(13) → `drawGiftTool` 抽一件（1..8，按库存加权）
   * - 寶箱(14) → 0，改为给主人 **500 點券**
   * - 路障(16)/地雷(17)/定時炸彈(18) → **原样回收**成道具 2/3/4
   */
  | { kind: 'loot'; node: number; object: number; objectType: number; tool: number }
  | { kind: 'points'; victim: number; amount: number }
  | { kind: 'card'; victim: number; card: number }
  | { kind: 'robBank'; from: number; amount: number }
  | { kind: 'protection'; landlord: number; amount: number }
  | { kind: 'home'; place: 'prison' | 'hospital'; node: number };

/**
 * 走一趟。
 *
 * `advance` 由调用方给（`reduce.ts` 的 `pickNextNode`），与機器娃娃同理 ——
 * 本模块因此不依赖地图拓扑的具体形状。
 *
 * ★ **只算这趟走出去的每一格**，起点那一格不结算（他就是从那儿起步的）。
 */
export function runNpc(
  actor: number,
  start: SpecialActor,
  state: GameState,
  map: NpcMap,
  advance: (from: number, prev: number) => number,
  rng: WatcomRng,
): NpcWalk {
  const nodes = map.nodes;
  const owner = start.owner;
  const home = npcHomeOf(actor);
  const events: NpcEvent[] = [];
  const path: number[] = [start.nodeId];

  let cur = start.nodeId;
  let prev = start.lastNodeId;
  // ★ 保釋时人就站在監獄/醫院那一格上，所以「已离开过」当场就置上了
  //   （@source 0x0043d84e）。于是**下一次踩到就回去**。
  const left = true;

  // 这趟里被拿走的物件下标 / 被偷的玩家，交给调用方落状态
  const takenObjects = new Set<number>();
  const pointsTaken = new Map<number, number>();
  const cardsTaken: { victim: number; card: number }[] = [];

  for (let step = 0; step < start.stepsRemaining; step++) {
    const next = advance(cur, prev);
    if (next <= 0 || next === cur) break;
    prev = cur;
    cur = next;
    path.push(cur);

    const node = nodes[cur - 1];
    const kind = node?.specialKind ?? 0;

    // ── ① 踩到自己老家 → 回去蹲着／躺着，这趟就此结束 ──
    // @source 0x0041c7a6 / 0x0041c7f6，两段同构
    if (npcReturnsHome(home, left, kind)) {
      events.push({
        kind: 'home',
        place: home === 1 ? 'prison' : 'hospital',
        node: cur,
      });
      return {
        actor: {
          ...idleActor(),
          owner,
          place: home === 1 ? ACTOR_PLACE.prison : ACTOR_PLACE.hospital,
        },
        path,
        events,
      };
    }

    // ── ② 小偷：捡东西／拆陷阱 ──
    // @source 五个分支都以 `cmp [0x49910c], 4` 开头，共用一句提示
    if (actor === NPC.thief) {
      const at = state.objects.findIndex(
        (o, i) => o.nodeId === cur && !takenObjects.has(i) && thiefTakes(o.type),
      );
      if (at !== -1) {
        takenObjects.add(at);
        const type = state.objects[at]!.type;
        events.push({
          kind: 'loot',
          node: cur,
          object: at,
          objectType: type,
          tool: lootTool(type, state.toolStock, rng),
        });
      }
    }

    // ── ③ 同格有人 → 偷點券 / 奪卡 ──
    // @source 0x0041c1a2
    const occupants = state.players
      .map((p, i) => (p.nodeId === cur ? i : -1))
      .filter((i) => i >= 0);
    const victim = pickVictim(occupants, owner, (i) => {
      const p = state.players[i];
      return p !== undefined && isAlive(p);
    });
    if (victim !== null) {
      if (stealsPoints(actor)) {
        const have = (state.players[victim]?.points ?? 0) - (pointsTaken.get(victim) ?? 0);
        const amount = stealPoints(have);
        // @source `test edi, edi / je 结束` —— 偷不到就什么也不发生
        if (amount > 0) {
          pointsTaken.set(victim, (pointsTaken.get(victim) ?? 0) + amount);
          events.push({ kind: 'points', victim, amount });
        }
      } else if (stealsCard(actor)) {
        const hand = (state.players[victim]?.cards ?? []).filter(
          (c) => !cardsTaken.some((t) => t.victim === victim && t.card === c),
        );
        const card = pickCardToSteal(hand, rng);
        if (card !== null) {
          cardsTaken.push({ victim, card });
          events.push({ kind: 'card', victim, card });
        }
      }
    }

    // ── ④ 強盜踩銀行 → 抢所有对手的存款 ──
    // @source 0x0041c330 `cmp [0x49910c], 5` + `cmp 格子, 0xe`
    if (actor === NPC.robber && kind === SPECIAL_KIND.BANK) {
      for (const r of bankRobbery(state.players, owner, isAlive)) {
        events.push({ kind: 'robBank', from: r.from, amount: r.amount });
      }
    }

    // ── ⑤ 流氓踩到别人的地產／設施 → 勒索保護費 ──
    // @source 地產 0x0041c4df、設施 0x0041c64e
    if (actor === NPC.thug && node !== undefined) {
      const fee = thugFeeAt(state, map, node);
      if (fee !== null && fee.landlord !== owner && fee.amount > 0) {
        events.push({ kind: 'protection', landlord: fee.landlord, amount: fee.amount });
      }
    }

    // ⚠️ 間諜的取過路費／取盈餘没做 —— 缺的是累加器不是规则，见 Q-NPC-1。
  }

  // 走完收场
  return { actor: { ...idleActor(), owner }, path, events };
}

/**
 * 流氓在这一格能勒索多少、勒索谁；勒索不到返回 `null`。
 *
 * ★ 地產与設施**算法不同**：地產把地主在**整片同名地区**的地價全加起来，
 *   設施只按那一处算。见 `npc-actions.ts` 的 `protectionFee`。
 */
export function thugFeeAt(
  state: GameState,
  map: NpcMap,
  node: MapNode,
): { landlord: number; amount: number } | null {
  const ref = node.ref;
  if (ref.kind === 'land') {
    const lands = map.lands;
    if (lands === undefined) return null;
    const here = lands.find((l) => l.id === ref.index);
    if (here === undefined) return null;
    // 归属取**实时**的 landOwner（1 基，0 = 无主），不是地图模板里的
    const ownerOf = (id: number): number => state.landOwner[id] ?? 0;
    const landlord = ownerOf(here.id);
    if (landlord === 0) return null;
    const amount = protectionFee(lands, ownerOf, here, state.priceIndex);
    return { landlord: landlord - 1, amount };
  }
  if (ref.kind === 'facility') {
    const f = map.facilities?.find((x) => x.id === ref.index);
    if (f === undefined || f.owner === 0) return null;
    return { landlord: f.owner - 1, amount: facilityProtectionFee(f.landPrice, state.priceIndex) };
  }
  return null;
}

/** 这个 actor 号是不是四大惡人之一（不含機器娃娃） */
export function isNpcActor(actor: number): boolean {
  return actor >= SPECIAL_ACTOR_BASE && actor <= NPC.spy;
}

/**
 * 把一趟走子的结果落进状态。
 *
 * ★ **进项一律记到主人头上**（`pay_money(受害者, 主人, …)`，见 `npc-actions.ts`）。
 *   钱走 `transferMoney`，所以**付款方可能因此破產** —— 由调用方收口
 *   （与过路费同一条路，见 `reduce.ts`）。
 */
export interface NpcSettlement {
  state: GameState;
  /** 这趟里被榨破产的玩家下标，按发生顺序；调用方要逐个走破产流程 */
  bankrupted: number[];
}

export function applyNpcEvents(
  state: GameState,
  owner: number,
  events: readonly NpcEvent[],
): NpcSettlement {
  let players = [...state.players];
  let objects = state.objects;
  let pool = state.pool;
  let tools = state.tools;
  let toolStock = state.toolStock;
  const bankrupted: number[] = [];

  const give = (i: number, mut: (p: Player) => Player): void => {
    const p = players[i];
    if (p !== undefined) players[i] = mut(p);
  };

  for (const e of events) {
    switch (e.kind) {
      case 'loot': {
        objects = objects.map((o, i) =>
          i === e.object ? { ...o, nodeId: 0, state: 0, attached: 0 } : o,
        );
        if (e.objectType === OBJECT_TYPE_TREASURE) {
          // @source 0x0041bcb6 `add word [主人 + 0x30], 0x1f4`
          give(owner, (p) => ({ ...p, points: p.points + TREASURE_POINTS }));
          break;
        }
        // 禮物抽一件、陷阱原样回收 —— 两者都进**主人**的道具栏
        const toolId = e.tool;
        if (toolId > 0) {
          const r = giveTool(tools, toolStock, owner, toolId);
          tools = r.tools;
          toolStock = r.stock;
        }
        break;
      }
      case 'points': {
        give(e.victim, (p) => ({ ...p, points: p.points - e.amount }));
        give(owner, (p) => ({ ...p, points: p.points + e.amount }));
        break;
      }
      case 'card': {
        give(e.victim, (p) => {
          const at = p.cards.indexOf(e.card);
          if (at === -1) return p;
          const cards = [...p.cards];
          cards.splice(at, 1);
          return { ...p, cards };
        });
        give(owner, (p) => ({ ...p, cards: [...p.cards, e.card] }));
        break;
      }
      case 'robBank': {
        // @source `push 5` —— bit0 置位 = **進現金**
        const r = transferMoney(players, [], pool, e.from, owner, e.amount, ROB_BANK_FLAGS);
        players = [...r.players];
        pool = r.pool;
        if (r.bankrupted) bankrupted.push(e.from);
        break;
      }
      case 'protection': {
        // @source `push 0` —— bit0 未置 = **進存款**
        const r = transferMoney(players, [], pool, e.landlord, owner, e.amount, 0);
        players = [...r.players];
        pool = r.pool;
        if (r.bankrupted) bankrupted.push(e.landlord);
        break;
      }
      case 'home':
        // 占用表由调用方改 —— 它要同时动 prisonOccupancy / hospitalOccupancy
        break;
    }
  }

  return { state: { ...state, players, objects, pool, tools, toolStock }, bankrupted };
}

/**
 * 小偷拿到的这件东西折成哪个道具编号（0 = 不折）。
 *
 * ★ **拆下来的陷阱原样回收**，与 `PLACEMENT_TOOLS`（道具 → 物件种类）互逆：
 * ```asm
 * 0041be1a  push 2            ; 路障  → 道具 2
 * 0041be30  call give_tool(主人, 2)
 * 0041bfcb  push 3 / jmp 0x41be1c   ; ★ 地雷直接跳进上面那段，只换了编号
 * 0041c126  push ebx          ; 定時炸彈 → 道具 4（同一形状）
 * ```
 * 那句 `jmp 0x41be1c` 是最好的证据：三条分支共用同一段发货代码。
 *
 * - **禮物(13)** 走 `drawGiftTool`（@source 0x00445ada：按**全局库存加权**
 *   从道具 1..8 里抽一件，抽不到就当没踩过），与玩家踩禮物同一条规则。
 * - **寶箱(14)** 不给道具，改为主人 +500 點券（@source 0x0041bcb6）。
 */
function lootTool(objectType: number, toolStock: readonly number[], rng: WatcomRng): number {
  // @source 0x00445ada —— 与玩家踩禮物走同一条抽签
  if (objectType === OBJECT_TYPE_GIFT) return drawGiftTool(toolStock, rng.next());
  return TRAP_TO_TOOL[objectType] ?? 0;
}

const TRAP_TO_TOOL: Readonly<Record<number, number>> = { 16: 2, 17: 3, 18: 4 };

/**
 * 搶銀行那笔钱**進現金**，保護費那笔**進存款**。
 *
 * ★ 差别就在 `pay_money` 的第四个参数：搶銀行是 `push 5`（VA 0x0041c38f），
 *   保護費与間諜那两条是 `push 0`（0x0041c576 / 0x0041c780）。
 *   `bit0` 就是 `PAY_FLAG_CREDIT_TO_CASH`（见 rules/payment.ts）。
 *   这不是笔误——原版两处本来就走不同的入账口。
 */
const ROB_BANK_FLAGS = PAY_FLAG_CREDIT_TO_CASH | 0x04;
