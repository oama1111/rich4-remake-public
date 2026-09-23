/*
 * 物件落点效果 —— 踩到神明/禮物/寶箱/路障/地雷/定時炸彈
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 逐条翻译原版「走到一格之后」的处理函数，入口在 VA 0x0041b440。
 *
 *   它**每走一格就跑一次**，不是每回合一次——这一点决定了很多事：
 *   定時炸彈的引信 38 是**格数**不是天数；路障能在半途拦下你；
 *   而神明、禮物、寶箱、地雷都要等你**停下来**才生效。
 *   「停没停下来」原版看的是剩余步数 `[0x48baf8]`，本引擎是
 *   `GameState.stepsRemaining`。
 *
 *   种类分派是一张 18 项跳表 @ VA 0x0041b3e5，下标 = 种类 − 1
 *   （分派器**函数体是 `0x41b42d`**，帧 `sub esp,0xa8`，真尾声 `0x41c844`）：
 * ```
 *   1..10, 12 → 0x41b807  附身（財神/福神/窮神/衰神/天使/惡魔/土地公）
 *   11        → 0x41b837  惡犬
 *   13        → 0x41b8f9  禮物
 *   14        → 0x41bb0c  寶箱
 *   15        → 0x41c164  死神 —— ★ 踩上去**什么也不发生**
 *   16        → 0x41bceb  路障
 *   17        → 0x41be5f  地雷
 *   18        → 0x41bfd2  定時炸彈
 * ```
 *
 * ★★ **槽号 → 种类是固定表 `0x47ed3c`**（装载时逐字节写进 `objects_info[i].+0`，
 *   `@source 0x407d4e..0x407d68`）：槽 1..14 → 种类 1..14（每类恰 1 槽）、
 *   槽 15..16 → 15、槽 17..26 → 16、槽 27..36 → 17、槽 37..46 → 18。
 *   ⇒ **種類由槽位决定、此后永不改变**（`place_object` 从不写 `+0`），
 *   所以「寶箱永远在槽 14」是硬不变量（原版那支 handler 直接 `push 0xe`）。
 *   通道 2 证据：`rich4-spec/tests/test_object_landing_fragments.py`（44/44）、
 *   规格 `tools.md` §6.1.2 / §6.3.0。
 *
 * ⚠️ 本模块只处理**真人/AI 玩家**（原版的 actor 0..3）走到格子上的情形。
 *   原版还有 actor 4..7（小偷/強盜/流氓/間諜）与 actor 8（機器娃娃）：
 *
 *   - **actor 8 不进本模块**：落点处理 VA 0x0041b4e7 在种类跳表**之前**
 *     就把它截住，只做「清掉这一格的物件」一件事，然后收场。
 *     那条路实现在 `special-actors.ts` 的 `runDoll`
 *     （各 handler 里的 `cmp …,8 / jge` 是**死代码**）。
 *   - **actor 4..7 落回同一张跳表**，但各分支再查一次 actor 分头处理：
 *     **小偷（4）** 单独一支（拆陷阱并把道具给主人、寶箱的 500 歸主人、
 *     地雷/路障伤不到他）；**強盜/流氓/間諜（5..7）** 走的其实是**玩家那一支**
 *     （地雷照样让他们住院、路障照样拦下他们）。
 *     ⚠️ 这两类都不在本模块：`rules/npc-walk.ts` 的 `runNpc` / `applyNpcEvents`
 *     （見 Q-NPC-1 与 §7.81）。
 */

import type { Player } from '../state/types.ts';
import type { MapObject } from '../cards/summon.ts';
import { isAlive } from '../state/types.ts';
import { godModifiersOf, partnerSlot, slotRangeForType } from './objects.ts';
import { addPoints } from './points.ts';
import {
  ATTACH_STATE_NORMAL,
  ATTACH_STATE_REAPER,
  OBJECT_TYPE_DOG,
  OBJECT_TYPE_REAPER,
} from '../cards/summon.ts';
import { giveTool } from './tools.ts';

// ============================================================
//  常量
// ============================================================

/** 物件种类（惡犬 11、死神 15 已在 cards/summon.ts 定义） */
export const OBJECT_TYPE_GIFT = 13;
export const OBJECT_TYPE_TREASURE = 14;
export const OBJECT_TYPE_ROADBLOCK = 16;
export const OBJECT_TYPE_MINE = 17;
export const OBJECT_TYPE_BOMB = 18;

/**
 * 定時炸彈的引信。
 * @source `mov byte [i*24 + 0x496d0c], 0x26`（VA 0x0041c025）
 *
 * ★ 38 **格**，不是 38 天。每到一格减一，减到 0 就炸。
 */
export const BOMB_FUSE = 0x26;

/** 寶箱给的點數 @source `add word [player + 0x30], 0x1f4`（VA 0x0041bb62） */
export const TREASURE_POINTS = 0x1f4;

/** 被狗咬／踩地雷要住院几天 @source `push 3 / call send_to_hospital`（VA 0x0041b8e6） */
export const HOSPITAL_DAYS_HURT = 3;
/** 被炸彈炸要住院几天 @source `push 5 / call send_to_hospital`（VA 0x0041b775） */
export const HOSPITAL_DAYS_BOMB = 5;

/**
 * 放置类物件回收到哪个道具编号的库存。
 * @source `release_object` VA 0x0040e17f 起：
 *   `inc byte [0x497321]` / `[0x497322]` / `[0x497323]`，
 *   而库存表基址是 `0x49731f + 道具编号`，故依次是道具 2/3/4。
 */
export const OBJECT_TO_TOOL: ReadonlyMap<number, number> = new Map([
  [OBJECT_TYPE_ROADBLOCK, 2],
  [OBJECT_TYPE_MINE, 3],
  [OBJECT_TYPE_BOMB, 4],
]);

// ============================================================
//  世界切片
// ============================================================

/** 物件规则要动的那几样状态 */
export interface ObjectWorld {
  players: readonly Player[];
  objects: readonly MapObject[];
  tools: readonly number[];
  toolStock: readonly number[];
}

function copy(w: ObjectWorld): {
  players: Player[];
  objects: MapObject[];
  tools: number[];
  toolStock: number[];
} {
  return {
    players: w.players.map((p) => ({ ...p })),
    objects: w.objects.map((o) => ({ ...o })),
    tools: [...w.tools],
    toolStock: [...w.toolStock],
  };
}

// ============================================================
//  放置
// ============================================================

export interface PlaceOutcome {
  objects: MapObject[];
  /** 占用的槽位下标（0 基）；没空位为 -1 */
  slot: number;
}

/**
 * 在地图上放一个物件，**槽位按种类分区**。
 *
 * @source `place_object` VA 0x0040e033，分区见 `rules/objects.ts`
 *   的 `slotRangeForType`。循环体：
 * ```asm
 * for (i = from; i < to; i++) {
 *     if (objects[i].nodeId != 0) continue    ; ★ 只看 nodeId，不看 attached
 *     objects[i].nodeId   = nodeId
 *     objects[i].state    = arg2
 *     objects[i].attached = arg3
 *     break
 * }
 * ```
 *
 * ⚠️ 种类是**槽位决定的**，原版压根不往 `+0x00` 写种类——
 *   它在读地图时就按 `OBJECT_TYPE_TABLE` 填好了，此后永不改变。
 *   所以这里也只认槽位，不改 `type`。
 */
export function placeObjectOfType(
  objects: readonly MapObject[],
  type: number,
  nodeId: number,
  state = 0,
  attached = 0,
): PlaceOutcome {
  const { from, to } = slotRangeForType(type);
  const next = objects.map((o) => ({ ...o }));
  for (let i = from; i < to; i++) {
    const o = next[i];
    // @source cmp word [i*24 + 0x496d0a], 0 / jne 下一个
    if (o === undefined || o.nodeId !== 0) continue;
    o.nodeId = nodeId;
    o.state = state;
    o.attached = attached;
    return { objects: next, slot: i };
  }
  return { objects: next, slot: -1 };
}

// ============================================================
//  回收
// ============================================================

export interface ReleaseOutcome extends ObjectWorld {
  players: Player[];
  objects: MapObject[];
  tools: number[];
  toolStock: number[];
  /** 物件离开前所在的节点 —— 搭档要在它附近重新出现 */
  formerNode: number;
  /** 该换哪个搭档上场（槽位下标）；-1 表示没有搭档 */
  partner: number;
}

/**
 * 把玩家身上两个跟班物件（`godInfo`(+0x3f) / `f64`(+0x40)）的**所在格**同步成玩家所在格。
 *
 * @source `0x0040fc00(player)`（全文 27 条）：
 * ```asm
 * 0040fc06  ah = byte [player + 0x3f]        ; god_info（物件下标 + 1）
 * 0040fc0e  if (ah != 0):
 *             ecx = ah − 1                    ; 物件下标
 *             word [objects[ecx] + 0x02] = word [player + 0x0c]   ; ★ 所在格 ← 玩家所在格
 * 0040fc30  bl = byte [player + 0x40]        ; f64（另一个跟班槽）
 * 0040fc38  if (bl != 0): 同上
 * ```
 *
 * ★ **两支互相独立**（`+0x3f == 0` 只跳过第一支）。调用点：入监 `0x43d668`、
 *   入院（`0x43ec3f` 的对应处）——即**被关押时神明/跟班一起搬走**。
 *   通道 2 差分：`rich4-spec/tests/test_god_follow.py`（16/16）。
 *
 * @param player 已经**搬完家**的那个玩家（`nodeId` 是新的）
 */
export function syncEscortNodes(
  objects: readonly MapObject[],
  player: Player,
): MapObject[] {
  if (player.godInfo === 0 && player.f64 === 0) return [...objects];
  const next = objects.map((o) => ({ ...o }));
  for (const ref of [player.godInfo, player.f64]) {
    if (ref === 0) continue;
    const o = next[ref - 1];
    if (o !== undefined) o.nodeId = player.nodeId;
  }
  return next;
}

/**
 * 把一个物件收回。
 *
 * @source `release_object` VA 0x0040e14d，参数是**物件下标 + 1**：
 * ```asm
 * if (handle == 0) return
 * i = handle - 1 ; type = objects[i].type
 * switch (type) {
 *   case 16: [0x497321]++ ; break                 ; 路障回库存
 *   case 17: [0x497322]++ ; break                 ; 地雷回库存
 *   case 18: [0x497323]++                         ; 炸彈回库存
 *            if (attached) players[attached-1].f64 = 0
 *            break
 *   default:                                      ; 神明
 *            if (attached) {
 *                p = attached - 1
 *                players[p].god_info = 0
 *                players[p] .{+0x44,+0x46,+0x48} -= 三张修正表[type]
 *            }
 * }
 * if (objects[i].attached == 0) node[objects[i].nodeId].object = 0
 * 原节点 = objects[i].nodeId
 * objects[i].nodeId = objects[i].state = objects[i].attached = 0
 * if (i < 12) place_object(搭档 + 1, 某个节点, 0, 0)
 * ```
 *
 * ⚠️ **搭档重新登场的落点**由 `0x40aa6c` 在全地图里挑（要求那格没物件、
 *   没人、`+0x18` 为 0），挑法尚未逐条解开，故本函数只返回 `partner`
 *   与 `formerNode`，把「放在哪」留给调用方。见 known-deviations 的 Q-OBJ-2。
 */
export function releaseObject(w: ObjectWorld, handle: number): ReleaseOutcome {
  const out = copy(w);
  const none: ReleaseOutcome = { ...out, formerNode: 0, partner: -1 };
  // @source test edx, edx / je 结束
  if (handle === 0) return none;

  const i = handle - 1;
  const obj = out.objects[i];
  if (obj === undefined) return none;

  const toolId = OBJECT_TO_TOOL.get(obj.type);
  if (toolId !== undefined) {
    // @source inc byte [0x49732x] —— 放置类回库存
    out.toolStock[toolId] = (out.toolStock[toolId] ?? 0) + 1;
    // @source case 18 专有：把携带者手上的引用也清掉
    if (obj.type === OBJECT_TYPE_BOMB && obj.attached !== 0) {
      const carrier = out.players[obj.attached - 1];
      if (carrier !== undefined) carrier.f64 = 0;
    }
  } else if (obj.attached !== 0) {
    // @source default 分支：神明离身，三项修正全数退回
    const host = out.players[obj.attached - 1];
    if (host !== undefined) {
      host.godInfo = 0;
      const m = godModifiersOf(obj.type);
      host.misfortune -= m.misfortune;
      host.fortune -= m.fortune;
      host.luck -= m.luck;
    }
  }

  const formerNode = obj.nodeId;
  obj.nodeId = 0;
  obj.state = 0;
  obj.attached = 0;

  // @source cmp edx, 0xc / jge 结束
  return { ...out, formerNode, partner: partnerSlot(i) };
}

// ============================================================
//  附身
// ============================================================

export interface AttachOutcome extends ObjectWorld {
  players: Player[];
  objects: MapObject[];
  tools: number[];
  toolStock: number[];
  ok: boolean;
  /** 若原本身上有神明，这里是它的 handle（已在本函数内送走） */
  displaced: number;
  /** 被挤走的那位若有搭档，搭档该在哪重新登场 */
  respawn: { partner: number; nearNode: number } | null;
}

/**
 * 让一个神明附到玩家身上，并加上三项修正。
 *
 * @source `attach_object` VA 0x0040ead7。`cards/summon.ts` 的
 *   `attachObject` 已经翻译了字段部分；本函数是它的**完整版**——
 *   多做两件原来漏掉的事：
 *   1. 身上已有神明时**先送走**（`call 0x40e32c`，VA 0x0040eb3e）
 *   2. 附身后加上三项修正（VA 0x0040ebcc 起）
 *
 * ⚠️ 之所以另起一个函数而不是改 `attachObject`：那个是**請神符**的
 *   路径，卡片自己会处理旧神明与动画；这个是**踩上去**的路径。
 *   两边共用字段写入，副作用范围不同。
 */
export function attachGod(w: ObjectWorld, playerIndex: number, handle: number): AttachOutcome {
  const base = copy(w);
  const fail: AttachOutcome = { ...base, ok: false, displaced: 0, respawn: null };
  if (handle === 0) return fail;

  const i = handle - 1;
  const obj = w.objects[i];
  const who = w.players[playerIndex];
  if (obj === undefined || who === undefined) return fail;

  // @source if (player.god_info != 0) call 0x40e32c —— 旧的先送走
  const displaced = who.godInfo;
  const dispelled = displaced !== 0 ? releaseObject(w, displaced) : null;
  const cleared: ObjectWorld = dispelled ?? w;
  const respawn =
    dispelled !== null && dispelled.partner >= 0
      ? { partner: dispelled.partner, nearNode: dispelled.formerNode }
      : null;

  const out = copy(cleared);
  const target = out.objects[i];
  const host = out.players[playerIndex];
  if (target === undefined || host === undefined) return fail;

  host.godInfo = handle;
  target.nodeId = host.nodeId;
  target.attached = playerIndex + 1;
  // @source cmp esi, 0xf / 死神 13、其余 7
  target.state = target.type === OBJECT_TYPE_REAPER ? ATTACH_STATE_REAPER : ATTACH_STATE_NORMAL;

  // @source add word [player + 0x44 / 0x46 / 0x48], 三张表[type]
  const m = godModifiersOf(target.type);
  host.misfortune += m.misfortune;
  host.fortune += m.fortune;
  host.luck += m.luck;

  return { ...out, ok: true, displaced, respawn };
}

// ============================================================
//  禮物
// ============================================================

/**
 * 禮物抽一个道具 —— 按**全局库存**加权。
 *
 * @source VA 0x00445ada：
 * ```asm
 * for (i = 0; i < 8; i++)
 *     把 i 重复 stock[i] 次塞进袋子            ; ★ 库存越多越容易抽到
 * if (袋子空) return 0
 * 道具 = 袋子[rand() % 袋子长度] + 1
 * give_tool(player, 道具)
 * ```
 *
 * ★ 只抽 1..8 号——正是**有库存限制**的那 8 个。9..13 号不限量，
 *   也永远抽不到；想要只能去百貨公司买。
 *
 * @param randValue `rand()` 的返回值
 * @returns 抽到的道具编号；袋子空时为 0
 */
export function drawGiftTool(toolStock: readonly number[], randValue: number): number {
  const bag: number[] = [];
  // @source cmp eax, 8 / jge 结束 —— 只看 1..8 号
  for (let toolId = 1; toolId <= 8; toolId++) {
    const n = toolStock[toolId] ?? 0;
    for (let k = 0; k < n; k++) bag.push(toolId);
  }
  if (bag.length === 0) return 0;
  return bag[randValue % bag.length] ?? 0;
}

/**
 * 禮物袋是不是空的（道具 1..8 的库存总数 == 0）。
 *
 * ★★ 2026-09-19 新增（§7.142，通道 2 `test_watson_shop.py` 180/180）：
 *   原版 `0x00445ada` 是 **`test ebx,ebx / je 返回0` 之后才 `call rand`** ——
 *   袋子空时**一次 rand 都不掷**。调用方若写成 `drawGiftTool(stock, rng.next())`，
 *   `rng.next()` 作为**实参**会**先求值** ⇒ 空袋也推进随机流，之后所有随机事件错开一步。
 *   故需要「在掷之前判空」的调用方用本函数。
 */
export function giftToolBagEmpty(toolStock: readonly number[]): boolean {
  for (let toolId = 1; toolId <= 8; toolId++) {
    if ((toolStock[toolId] ?? 0) > 0) return false;
  }
  return true;
}

// ============================================================
//  落点结算
// ============================================================

export type ArrivalEvent =
  | { kind: 'godAttached'; handle: number; type: number }
  | { kind: 'dogBite'; blockedByVehicle: boolean }
  | { kind: 'gift'; toolId: number }
  | { kind: 'treasure'; points: number }
  | { kind: 'roadblock' }
  | { kind: 'mine' }
  | { kind: 'bombPicked'; handle: number }
  | { kind: 'bombTick'; remaining: number }
  | { kind: 'bombPassed'; to: number }
  | { kind: 'bombExploded'; landId: number };

export interface ArrivalInput {
  world: ObjectWorld;
  playerIndex: number;
  /** 落点上的物件 handle（下标 + 1）；0 表示这格没有物件 */
  handle: number;
  /** 这格所在的地块 id；0 表示不是地产。炸彈爆炸要把它夷平 */
  landId: number;
  /** 走完这一步**还剩几步**；0 表示停下了 */
  stepsRemaining: number;
  /** 同格的其他玩家下标，升序 */
  othersHere: readonly number[];
  /** `rand()` 的返回值，供禮物抽道具用 */
  randValue: number;
}

export interface ArrivalOutcome extends ObjectWorld {
  players: Player[];
  objects: MapObject[];
  tools: number[];
  toolStock: number[];
  /** 该把剩余步数清零吗（路障、惡犬、炸彈爆炸） */
  stopMovement: boolean;
  /** 要住院几天；0 表示不用 */
  hospitalDays: number;
  /** 要拆掉的地块 id；0 表示不拆 */
  demolishLand: number;
  /** 座驾被毁了吗 */
  vehicleWrecked: boolean;
  /** 搭档要重新登场的槽位，与它原先所在的节点（见 releaseObject） */
  respawn: { partner: number; nearNode: number } | null;
  /**
   * `randValue` 真的被用掉了吗。
   *
   * ★ 只有**禮物且袋子非空**时原版才会调 `rand()`
   *   （`if (袋子空) 直接返回`，VA 0x00445b10）。调用方必须照此推进
   *   随机数状态：每走一格都白抽一个数，整条随机序列就全错位了，
   *   重放与联机会当场对不上（C-DET-4）。
   */
  randConsumed: boolean;
  events: ArrivalEvent[];
}

/**
 * 毁掉座驾。
 *
 * @source VA 0x0040cd07：
 * ```asm
 * if (player.who_plays == 0) { if (…) 乞丐消失; return }
 * if (dword [player + 0x32] != 0) return          ; ★ 已在住宿/消失/坐牢/住院 → 免疫
 * if (player.traffic_method != 0) {
 *     switch (traffic & 3) { 1: [0x497324]++ ; 2: [0x497325]++ }   ; 车回库存
 *     player.traffic_method = 0
 *     player.ndices = 1                            ; ★ 退回徒步，一颗骰子
 * }
 * player.who_plays |= 0x40
 * ```
 *
 * ⚠️ 车是回**全局库存**，不是回玩家的道具栏——与換乘（`useVehicleTool`
 *   把旧车退成道具）方向不同。撞毁就是撞毁，捡不回来。
 */
function wreckVehicle(p: Player, toolStock: number[]): boolean {
  // @source cmp dword [player + 0x32], 0 / jne 直接返回
  const b = p.blocking;
  if (b.inHotel !== 0 || b.disappearing !== 0 || b.inPrison !== 0 || b.inHospital !== 0) {
    return false;
  }
  // @source test cl, cl / je 跳过
  if (p.trafficMethod === 0) return false;

  // @source and al, 3 / 1 → [0x497324]、2 → [0x497325]，即道具 5 機車、6 汽車
  const kind = p.trafficMethod & 3;
  if (kind === 1) toolStock[5] = (toolStock[5] ?? 0) + 1;
  else if (kind === 2) toolStock[6] = (toolStock[6] ?? 0) + 1;

  p.trafficMethod = 0;
  // @source mov byte [player + 0x12], 1
  p.ndices = 1;
  return true;
}

/**
 * 走到一格之后的物件结算。
 *
 * 原版顺序（VA 0x0041b697 → 0x0041b7ef）：**先给身上的炸彈走一格，
 * 再看脚下有什么**。炸了就直接收尾，不再理脚下的物件。
 */
export function resolveArrival(input: ArrivalInput): ArrivalOutcome {
  const out = copy(input.world);
  const events: ArrivalEvent[] = [];
  const result: ArrivalOutcome = {
    ...out,
    stopMovement: false,
    hospitalDays: 0,
    demolishLand: 0,
    vehicleWrecked: false,
    respawn: null,
    randConsumed: false,
    events,
  };

  const me = result.players[input.playerIndex];
  if (me === undefined || !isAlive(me)) return result;

  // ── 第一步：身上的定時炸彈走一格 ──
  const exploded = tickCarriedBomb(result, input, events);
  // @source 爆炸分支 jmp 0x41c844 —— 直接收尾，脚下的物件这一格不结算
  if (exploded) return result;

  // ── 第二步：脚下的物件 ──
  applyObjectAt(result, input, events);
  return result;
}

/**
 * 引信走一格。
 *
 * @source VA 0x0041b697：
 * ```asm
 * ch = player.f64 ; if (ch == 0) 跳过
 * if (--objects[ch-1].state == 0) {
 *     release_object(ch)
 *     if (node.land != 0) demolish(node.land)         ; ★ 把这格的房子夷平
 *     wreck_vehicle(player)
 *     [0x48baf8] = 0 ; send_to_hospital(player, 5)
 * } else if (同格还有别人) {
 *     其他 = lowest_set_bit(同格玩家位图 & ~(1 << 我))
 *     if (其他存活 && 其他.f64 == 0) {
 *         其他.f64 = 我.f64 ; objects[炸彈].attached = 其他 + 1 ; 我.f64 = 0
 *     }
 * }
 * ```
 *
 * ★ **炸彈会传给同格的人**——而且挑的是下标最小的那个
 *   （`0x40d293` 返回最低位，不是随机）。这条是原版最吓人的机制：
 *   你以为躲开了，结果队友把它又塞回来。
 *
 * @returns 炸了没有
 */
function tickCarriedBomb(
  out: ArrivalOutcome,
  input: ArrivalInput,
  events: ArrivalEvent[],
): boolean {
  const me = out.players[input.playerIndex];
  // @source test ch, ch / je 跳过
  if (me === undefined || me.f64 === 0) return false;
  const handle = me.f64;
  const bomb = out.objects[handle - 1];
  if (bomb === undefined) return false;

  // @source dec dl / mov [.. + 0x496d0c], dl
  bomb.state -= 1;
  // @source jne 传递分支
  if (bomb.state !== 0) {
    events.push({ kind: 'bombTick', remaining: bomb.state });
    passBomb(out, input, handle, events);
    return false;
  }

  // ── 爆炸 ──
  const after = releaseObject(out, handle);
  out.players = after.players;
  out.objects = after.objects;
  out.tools = after.tools;
  out.toolStock = after.toolStock;
  out.respawn =
    after.partner >= 0 ? { partner: after.partner, nearNode: after.formerNode } : null;

  // @source di = node.word[+0x20] ; if (di) call 0x40ab4a(di, 0)
  out.demolishLand = input.landId;
  const victim = out.players[input.playerIndex];
  if (victim !== undefined) {
    out.vehicleWrecked = wreckVehicle(victim, out.toolStock);
  }
  // @source [0x48baf8] = 0 ; push 5 / call send_to_hospital
  out.stopMovement = true;
  out.hospitalDays = HOSPITAL_DAYS_BOMB;
  events.push({ kind: 'bombExploded', landId: input.landId });
  return true;
}

/** 把炸彈塞给同格的下一个人 @source VA 0x0041b78b */
function passBomb(
  out: ArrivalOutcome,
  input: ArrivalInput,
  handle: number,
  events: ArrivalEvent[],
): void {
  // @source test edi, edi / je 跳过 —— 同格没别人就不传
  // @source call 0x40d293：返回位图里**最低**的那一位，故取下标最小者
  const to = input.othersHere.filter((i) => i !== input.playerIndex).sort((a, b) => a - b)[0];
  if (to === undefined) return;

  const other = out.players[to];
  const mine = out.players[input.playerIndex];
  const bomb = out.objects[handle - 1];
  if (other === undefined || mine === undefined || bomb === undefined) return;
  // @source cmp byte [other + 0x15], 0 / je 跳过
  if (!isAlive(other)) return;
  // @source test ch, ch / jne 跳过 —— 对方手上已有一个就不传
  if (other.f64 !== 0) return;

  other.f64 = mine.f64;
  bomb.attached = to + 1;
  mine.f64 = 0;
  events.push({ kind: 'bombPassed', to });
}

/** 脚下的物件 @source 跳表 VA 0x0041b3e5 */
function applyObjectAt(out: ArrivalOutcome, input: ArrivalInput, events: ArrivalEvent[]): void {
  if (input.handle === 0) return;
  const obj = out.objects[input.handle - 1];
  if (obj === undefined) return;

  const type = obj.type;
  const moving = input.stepsRemaining > 0;

  switch (type) {
    // ── 路障：唯一一个**半途也拦你**的物件 ──
    case OBJECT_TYPE_ROADBLOCK: {
      // @source 0x41bceb 分支里没有 [0x48baf8] 检查
      collect(out, input.handle);
      // @source xor ecx, ecx / mov [0x48baf8], ecx
      out.stopMovement = true;
      events.push({ kind: 'roadblock' });
      return;
    }

    // ── 惡犬：有车就咬不到 ──
    case OBJECT_TYPE_DOG: {
      // @source mov edi, [0x48baf8] / test / jne 0x41c164
      if (moving) return;
      collect(out, input.handle);
      const me = out.players[input.playerIndex];
      if (me === undefined) return;
      // @source cmp byte [player + 0x11], 0 / je 受伤路径
      if (me.trafficMethod !== 0) {
        events.push({ kind: 'dogBite', blockedByVehicle: true });
        return;
      }
      out.vehicleWrecked = wreckVehicle(me, out.toolStock) || out.vehicleWrecked;
      out.stopMovement = true;
      out.hospitalDays = HOSPITAL_DAYS_HURT;
      events.push({ kind: 'dogBite', blockedByVehicle: false });
      return;
    }

    // ── 禮物：随机一个道具 ──
    case OBJECT_TYPE_GIFT: {
      // @source cmp [0x48baf8], 0 / jne 0x41b995
      if (moving) return;
      // @source call 0x445ada 先抽，抽不到（库存全空）就当没踩过
      const toolId = drawGiftTool(out.toolStock, input.randValue);
      if (toolId === 0) return;
      out.randConsumed = true;
      const given = giveTool(out.tools, out.toolStock, input.playerIndex, toolId);
      out.tools = given.tools;
      out.toolStock = given.stock;
      collect(out, input.handle);
      events.push({ kind: 'gift', toolId });
      return;
    }

    // ── 寶箱：五百點 ──
    case OBJECT_TYPE_TREASURE: {
      if (moving) return;
      // ⚠️ 原版这里写死 `push 0xe`（`remove_object(14)`），**不是**用帧里的槽号。
      //   那是安全的：槽号→種類是固定表 `0x47ed3c`（`@source 0x407d4e..0x407d68`），
      //   種類 14 只可能出现在槽 14。本引擎按槽位存種類，`input.handle` 必等于 14，
      //   故两者等价 —— 通道 2 证据见 `rich4-spec/tests/test_object_landing_fragments.py`
      //   里「帧里给 9 也照样移除 14」那一例。
      collect(out, input.handle);
      const me = out.players[input.playerIndex];
      if (me === undefined) return;
      // @source 0x0041bb62 `add word [player + 0x30], 0x1f4` —— ★ 16 位回绕
      me.points = addPoints(me.points, TREASURE_POINTS);
      events.push({ kind: 'treasure', points: TREASURE_POINTS });
      return;
    }

    // ── 地雷：住院三天，车也没了 ──
    case OBJECT_TYPE_MINE: {
      // @source cmp [0x48baf8], 0 / jne 0x41bf16
      if (moving) return;
      collect(out, input.handle);
      const me = out.players[input.playerIndex];
      if (me === undefined) return;
      // @source call 0x40cd07 —— 地雷**无条件**炸车，与惡犬不同
      out.vehicleWrecked = wreckVehicle(me, out.toolStock) || out.vehicleWrecked;
      out.stopMovement = true;
      out.hospitalDays = HOSPITAL_DAYS_HURT;
      events.push({ kind: 'mine' });
      return;
    }

    // ── 定時炸彈：捡起来，引信开始走 ──
    case OBJECT_TYPE_BOMB: {
      const me = out.players[input.playerIndex];
      if (me === undefined) return;
      // @source cmp byte [player + 0x40], 0 / jne 0x41c072 —— 手上有了就不再捡
      if (me.f64 !== 0) return;
      if (moving) return;
      me.f64 = input.handle;
      obj.attached = input.playerIndex + 1;
      // @source mov byte [.. + 0x496d0c], 0x26
      obj.state = BOMB_FUSE;
      // ⚠️ 原版**不清** objects[i].nodeId，只把地图格上的那一字节
      //   （node +0x26）抹掉。本引擎没有那一字节，「这格上有什么物件」
      //   是按 `nodeId 相同且 attached == 0` 反查的，`attached` 一置
      //   它自然就从地图上消失了，故这里也照样不动 nodeId。
      events.push({ kind: 'bombPicked', handle: input.handle });
      return;
    }

    // ── 死神：踩上去什么也不发生 ──
    case OBJECT_TYPE_REAPER:
      // @source 跳表 [14] → 0x41c164，与「没有物件」走同一个出口。
      //   死神是自己追上来的，不是被踩到的。
      return;

    // ── 其余全是神明：附身 ──
    default: {
      // @source cmp [0x48baf8], 0 / jne 0x41c164
      if (moving) return;
      const r = attachGod(out, input.playerIndex, input.handle);
      if (!r.ok) return;
      out.players = r.players;
      out.objects = r.objects;
      // ★ 身上原有的神明被挤走了，它的搭档要登场 —— 漏掉这一步，
      //   每换一次神就永久少一对，长局跑到后面地图会空掉。
      if (r.respawn !== null) out.respawn = r.respawn;
      events.push({ kind: 'godAttached', handle: input.handle, type });
      return;
    }
  }
}

/** 收走脚下这个物件（含库存回收与搭档登场） */
function collect(out: ArrivalOutcome, handle: number): void {
  const r = releaseObject(out, handle);
  out.players = r.players;
  out.objects = r.objects;
  out.tools = r.tools;
  out.toolStock = r.toolStock;
  if (r.partner >= 0) out.respawn = { partner: r.partner, nearNode: r.formerNode };
}

// ============================================================
//  神明的任期
// ============================================================

export interface GodTickOutcome extends ObjectWorld {
  players: Player[];
  objects: MapObject[];
  tools: number[];
  toolStock: number[];
  /** 这一回合任期到了吗 */
  expired: boolean;
  /** 任期到了之后，搭档该在哪登场 */
  respawn: { partner: number; nearNode: number } | null;
}

/**
 * 神明的任期走一天。
 *
 * @source VA 0x0041cc6c，就在 `tick_blocking`（0x0041c8d5）的同一个
 *   回合边界函数里，紧随其后：
 * ```asm
 * if (player.god_info != 0) {
 *     i = god_info - 1
 *     if (--objects[i].state == 0) dispel_god(player)     ; 0x40e32c → release_object
 * }
 * ```
 *
 * ★ 附身时写的 7（死神 13）是**天数**，一回合减一，减到 0 神明自己走人。
 *   这和定時炸彈的引信 38 是两码事：那个按**格**减，在
 *   `tickCarriedBomb` 里（VA 0x0041b697）。两个计数器共用
 *   `objects[i].state` 这一个字节，靠玩家身上的两个槽
 *   （`godInfo +0x3f` 与 `f64 +0x40`）分开。
 *
 * ⚠️ 不接这条，神明就**永不离场**：地图上的神明被踩一个少一个，
 *   而搭档只在有人离场时才登场——跑上两万回合地图会一个物件都不剩。
 */
export function tickGod(w: ObjectWorld, playerIndex: number): GodTickOutcome {
  const out = copy(w);
  const idle: GodTickOutcome = { ...out, expired: false, respawn: null };

  const p = out.players[playerIndex];
  // @source cmp byte [player + 0x3f], 0 / je 跳过
  if (p === undefined || p.godInfo === 0) return idle;
  const god = out.objects[p.godInfo - 1];
  if (god === undefined) return idle;

  // @source dec dh / mov [.. + 0x496d0c], dh / jne 跳过
  god.state -= 1;
  if (god.state !== 0) return idle;

  const r = releaseObject(out, p.godInfo);
  return {
    players: r.players,
    objects: r.objects,
    tools: r.tools,
    toolStock: r.toolStock,
    expired: true,
    respawn: r.partner >= 0 ? { partner: r.partner, nearNode: r.formerNode } : null,
  };
}

// ============================================================
//  投放地点
// ============================================================

/**
 * 能放物件的格子。
 *
 * @source `pick_object_node` VA 0x0040aa6c 的筛选循环：
 * ```asm
 * for (n = 1; n <= 节点数; n++) {
 *     if (node.dword[+0x24] & 0x80ffff00) continue      ; 有人/有物件/静态禁放
 *     if (node.dword[+0x18] != 0) 收录                  ; ★ +0x18/+0x1c 是四个
 *     else if (node.dword[+0x1c] == 0) continue         ;   相邻节点号（各 2 字节）
 *     收录
 * }
 * ```
 *
 * ★ 那两个 dword 判断合起来就是「**四个相邻节点里至少一个非 0**」，
 *   也就是 `MapNode.walkable` —— 与 `rich4_node_utils.asm:28-31` 同源。
 *   不能放在走不到的格子上，否则永远没人踩得到。
 *
 * ⚠️ 掩码 `0x80ffff00` 的三段含义（原版 `test dword [node + 0x24], 0x80ffff00`）：
 *   · bit 31      —— **静态**：这一格不许放东西（`MapNode.noObjects`，就是本函数的
 *                    `n.noObjects`）。地图形数据里就带着，本引擎照抄；
 *   · bits 8..11  —— **运行时**：玩家 i 站在这格（`0x100 << i`，原版在
 *                    0x004083a0 落地时置位、0x0040c1e9/0x0040c202 换格时先清后置、
 *                    破产清算 0x0040ce0e 也会置）；
 *   · bits 12..23 —— **运行时**：这格上已有物件。
 *   后两段本引擎**不在节点上镜像**（改用「反查物件表 / 玩家的 `nodeId`」现算），
 *   所以本函数只筛掉了静态那一位 —— **调用方必须自己再过一遍**
 *   「这格是不是已经有物件/有人站」，否则会叠格。
 *   原版之所以处处都查这一条，就是因为它是唯一一道闸门。
 */
export function objectNodeCandidates(
  nodes: readonly { id: number; walkable: boolean; noObjects: boolean }[],
): number[] {
  const out: number[] = [];
  for (const n of nodes) {
    // @source test dword [+0x24], 0x80ffff00 的静态那一位
    if (n.noObjects) continue;
    if (!n.walkable) continue;
    out.push(n.id);
  }
  return out;
}

/**
 * 「运行时被占的格子」—— 把节点 `+0x24` 的运行位**现算**出来。
 *
 * @source `pick_object_node` VA 0x0040aa6c 的筛选循环：
 * ```asm
 * 0040aa37  test dword [eax + 0x24], 0x80ffff00
 * 0040aa3e  jne  跳过
 * ```
 * 掩码三段：**bit 31 = 静态**（地图形数据里就带着，本引擎有 `MapNode.noObjects`）、
 * **bits 8..11 = 玩家 i 站在这格**、**bits 12..23 = 这格上已经有物件**。
 *
 * ⚠️ 本引擎不在节点上镜像这份运行时状态，故按「谁的 `nodeId` 是它」现算 ——
 * **玩家与物件两者都要算**：只看物件会漏掉「有人站着的格子」，
 * 而原版的候选筛选把两者一起跳过。落到有人站的格子上，棋子就与玩家叠在一格
 * （原版不可能出现）。
 *
 * ⚠️ `attached !== 0` 的物件（附在人身上的神明）`nodeId` 虽非 0，
 * 但**不在**地图上，故不算占用。
 *
 * ★★ 第十五份（协调方裁定「照原版的占用位」）：**被关着 / 住店 / 消失的人不占位**。
 *   那几支进去时都把**自己那一位清掉、新格不置**，要等释放才重新登记：
 * ```asm
 * ; send_to_prison 0x0043d593（送醫院 0x0043ec3f 同构）
 * 0043d59b  edi = ~(0x100 << idx)
 * 0043d61d  and dword [node(旧) + 0x24], edi     ; 清旧格；传送到关押格**不置**（places.md §2.1 第 1 条）
 * ; 消失 0x0040d375
 * 0040d444  and dword [node + 0x24], ~(0x100 << idx)
 * ; 住店 0x0040d5a5（唯一调用点 0x0041a85e）
 * 0040d5d2  and dword [node + 0x24], ~(0x100 << idx) ; 两支都清，都不置
 * ; 释放：0x0040d6be（住店 / 監獄 / 醫院共用）0x0040d737 `or [node+0x24], 0x100<<idx`；
 * ;       消失 0x0040d4e5 的 0x0040d526 同上
 * ```
 *   本引擎的「刑满」那一拍（0x80 → 0）就是释放函数那一拍，故判据 = 四个计数里任一非 0。
 *   ⇒ 有人关在監獄里时，关押格照样能冒出神明（第十五份回报那只天使就在監獄关押格上）。
 *
 * ★★ 同一道掩码的 bits 12..15 是**惡人**（actor 4..7）站的格：走路例程替身分支
 *   `0x1000 << (actor − 4)`（`game-loop.md`「走路例程已整段差分」）。在棋盘上走的那几个也要算；
 *   关着的（監獄 / 醫院，`0x43d760..` 同样清位不置）与没出场的不算。
 */
export function runtimeOccupiedNodes(
  players: readonly {
    nodeId: number;
    blocking?: { inPrison: number; inHospital: number; inHotel: number; disappearing: number };
  }[],
  objects: readonly { nodeId: number; attached: number }[],
  actors: readonly { nodeId: number; place: number }[] = [],
): Set<number> {
  const out = new Set<number>();
  for (const p of players) {
    if (p.nodeId === 0) continue;
    const b = p.blocking;
    // @source 0x0043d61d / 0x0040d444 / 0x0040d5d2：关押 / 消失 / 住店期间自己那一位是清掉的
    if (b !== undefined && (b.inPrison !== 0 || b.inHospital !== 0 || b.inHotel !== 0 || b.disappearing !== 0)) {
      continue;
    }
    out.add(p.nodeId);
  }
  for (const o of objects) if (o.nodeId !== 0 && o.attached === 0) out.add(o.nodeId);
  // 惡人 4..7（表的前四项）：在棋盘上（place 0）才占位；機器娃娃（第 5 项）只在用道具那一趟里走
  for (const a of actors.slice(0, 4)) if (a.place === 0 && a.nodeId !== 0) out.add(a.nodeId);
  return out;
}

/**
 * 从候选里挑一格（**不带参照点**）。
 *
 * @source `_rich4_find_random_unoccupied_node` VA 0x0040aa53：
 *   `call rand / idiv ebx / mov al, byte [esp + edx]` ⇒ `buf[rand() % n]`。
 *   开局摆物件走的就是**参照点 = 0** 的那一支（`rich4_load_map.asm:281` 的
 *   `push 0 / push 0 / push 0`），此时远距那一层重抽不会触发。
 */
export function pickObjectNode(candidates: readonly number[], randValue: number): number {
  if (candidates.length === 0) return 0;
  return candidates[randValue % candidates.length] ?? 0;
}

/** 远距重抽的阈值 @source `cmp eax, 0x12c`（= 300）*/
export const OBJECT_DISTANT_MIN = 0x12c;

/**
 * 远距重抽最多试几次。
 *
 * ⚠️ **本引擎自己定的上界**：原版那个循环（`jl 0x40aadf`）在「一个够远的
 *   候选都没有」时会**死转**（小地图上真有可能）。我们不许挂死，试满就
 *   收下最后一次抽到的那格 —— 那个局面下原版本来也走不下去，故不可观测。
 *   登记在 `docs/deviations/Q-OBJ-2.md`。
 */
export const OBJECT_DISTANT_MAX_TRIES = 64;

/**
 * 从候选里挑一格，**要求离参照点够远**。
 *
 * @source `_rich4_find_random_unoccupied_distant_node` VA 0x0040aadf 起：
 * ```asm
 * loc_0040aadf:
 *           call _libc_rand / idiv ebx              ; rand() % n
 *           movzx esi, byte [esp + edx]             ; 抽中的节点号
 *           …（取它的 x/y 到 edx/edi）…
 *           cmp dword [esp + 0x118], 0 / je loc_0040ab3d   ; 参照点 0 → 直接收
 *           sub edx, [esp + 0x100] / push edx / call _abs  ; |dx|
 *           cmp eax, 0x12c / jge loc_0040ab3d       ; ★ |dx| >= 300 → 收
 *           mov eax, edi / sub eax, ebp / push eax / call _abs   ; |dy|
 *           cmp eax, 0x12c / jl  loc_0040aadf       ; ★ |dy| < 300 → **重抽**
 * loc_0040ab3d:
 *           mov eax, esi / ret
 * ```
 * ⇒ 判据是「**任一轴 ≥ 300 就收**」，只有**两轴都 < 300** 才重抽
 *   （先前文档写成「都相距 ≥ 300」，方向反了 —— 2026-09-16 订正）。
 *
 * 谁用它：`rich4_objects.asm:244`（搭档在**旧落点**重新登场）、
 *   `rich4_player_core_actions.asm:4853`（禮物/寶箱被挤走后换个地方）——
 *   都是「刚被拿走的那个东西不该在原地复活」。
 *
 * @param reference 参照节点号；0 = 不重抽（与原版同一条早退）
 * @param nodeXy 节点号 → 世界坐标；取不到的节点跳过
 * @param draw 取一个 15 位随机数（调用方持 RNG，保持确定性）
 */
export function pickObjectNodeDistant(
  candidates: readonly number[],
  reference: number,
  nodeXy: (nodeId: number) => { x: number; y: number } | null,
  draw: () => number,
): number {
  if (candidates.length === 0) return 0;
  const ref = reference === 0 ? null : nodeXy(reference);
  let last = 0;
  for (let i = 0; i < OBJECT_DISTANT_MAX_TRIES; i++) {
    const node = candidates[draw() % candidates.length] ?? 0;
    last = node;
    // @source `cmp dword [esp + 0x118], 0 / je` —— 没参照点就一次都不重抽
    if (ref === null) return node;
    const at = nodeXy(node);
    if (at === null) return node; // 取不到坐标：按「收下」处理（原版不会有这种节点）
    if (Math.abs(at.x - ref.x) >= OBJECT_DISTANT_MIN) return node;
    if (Math.abs(at.y - ref.y) >= OBJECT_DISTANT_MIN) return node;
  }
  return last;
}

/**
 * 开局摆在地图上的物件**种类**。
 *
 * @source VA 0x00407d6a：
 * ```asm
 * for (type = 1; type <= 11; type += 2) place_object(type, pick_node(0), 0, 0)
 * place_object(0xd, pick_node(0), 0, 0)      ; 禮物
 * place_object(0xe, pick_node(0), 0, 0)      ; 寶箱
 * ```
 *
 * ★ 只放**小**的那一半：小財神、小福神、小窮神、小衰神、天使、惡犬。
 *   大財神/大福神/大窮神/大衰神/惡魔/土地公要等搭档被请走才登场
 *   （见 `rules/objects.ts` 的 `partnerSlot`）——这就是为什么开局
 *   见不到大神。
 */
export const INITIAL_OBJECT_TYPES: readonly number[] = [1, 3, 5, 7, 9, 11, 13, 14];
