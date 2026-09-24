/*
 * 开局摆人 —— **轮到谁、谁才上盘**（降落伞落地）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-24：「开局时第一个玩家行动时理论上地图只有他，其他玩家在第一回合要轮到了
 * 才有个降落伞特效出现在地图上」。
 *
 * ## 原版怎么做（全部 `@source` 见各函数）
 *
 * 1. **开局谁都没上盘**：玩家记录整条抄自角色表（`0x004072e4 memcpy(player, 0x47e80c + 角色 ×
 *    0x68, 0x68)`，表里 `+0x08..+0x10` 与 `+0x15` 全 0），只另写 `+0x64 = 1 / 2`
 *    （`0x004072f9`，人 / 电脑）。⇒ `xpos == ypos == 0`、`node_id == 0`、`who_plays == 0`
 *    （见 `types.ts` 的 `landingWhoPlays` / `isUnplaced`）。
 * 2. **镜头第一次对准他时摆上去**：棋盘重画 `fcn_0040829d(x, y)` 收到当前玩家的坐标
 *    `(0, 0)` 就当场摆人（`0x004082bc cmp [0x49910c], 4 / jge`、`0x004082c9 test eax, eax`、
 *    `0x004082d1 test edx, edx`）—— 两次 `rand()`（起始格 `0x004082d9`、来路 `0x00408328`），
 *    写 `node_id / last_node_id / direction`、登记节点占用位（`0x004083a0 or [node + 0x24],
 *    0x100 << 玩家`），记 `[0x475114] = 玩家 + 1`，镜头对准那一格。**坐标还是 0**。
 * 3. **回合决策驱动 `0x418c55` 的第一件事就是落地**：`[0x475114] != 0` 且当前是玩家
 *    （`0x00418c6b cmp eax, [0x499114]`）⇒ 播 `Data.mkf` 资源 `0x22f + 角色`
 *    （`0x00418c89 add eax, 0x22f` / `0x00418c96 read_mkf` / `0x00418ca9 call 0x45144f`，
 *    参数 `(0, 0x28, 1, -1)` = 整块棋盘、只播一遍、点不掉、无音效）→ 坐标 = 那一格
 *    （`0x00418cde` / `0x00418cfa`）→ `who_plays = +0x64`（`0x00418d07`）→ 重载棋子
 *    （`0x00418d0e call 0x40b93b`）→ 清标记 → 重画（`0x00418d22 call 0x41d476(0,0,1)`）。
 *    这之后才是掷骰 / 电脑决策。**没有台词**。
 *
 * ⇒ 第 1 位在开局第一次重画时落地（抽签紧跟在开局摆物件之后 —— 与先前一样）；
 *   第 2..N 位的两次抽签落在**前面各位行动之后**、自己回合开头（`0x41c84f` 之后、
 *   掷骰 / AI 决策之前）。
 *
 * ## 本引擎
 *
 * 一条 action 是原子批：「摆人 → 落地」之间原版只隔一段影片，没有别的读写
 * ⇒ core 在回合交接时**一次做完**（`landUnplacedPlayer`），影片由表现层按
 * 「before 没上盘、after 上了盘」补播（`client/landing-fx.ts`）。
 */

import type { MapNode } from '../loaders/map.ts';
import type { GameState, Player } from '../state/types.ts';
import { isUnplaced } from '../state/types.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { directionOf } from './direction.ts';
import { objectNodeCandidates, pickObjectNode, runtimeOccupiedNodes } from './object-landing.ts';
import { placeOnNodeId } from './position.ts';

/** 一名玩家开局落在哪一格、「从哪一格来」、面朝哪边 */
export interface StartPlacement {
  nodeId: number;
  /** `last_node_id`（+0x0e）—— 起始格的一个**随机邻格**，第一步不会走回它 */
  lastNodeId: number;
  /** `direction`（+0x10）= 从 `lastNodeId` 指向 `nodeId` 的八向朝向 */
  direction: number;
}

/**
 * 摆一个人 —— 起始格 + 「来路」+ 朝向，**两次 `rand()`**。
 *
 * @source `fcn_0040829d` 里「当前玩家还没上盘」那一段：
 * ```asm
 * 004082d9  call 0x40aa0f                      ; ① rand() 抽起始格
 * 004082fb  mov  word [player + 0x0c], bx      ;    node_id
 * 00408302  for (slot = 0; slot < 4; slot++)   ; 起始格四个邻接槽（节点 +0x18 起 4 个 uint16）
 * 0040831b    if (adj[slot] != 0) cand[n++] = adj[slot]   ; ★ 只看非 0，不看封路位
 * 00408328  call 0x456f2d / cdq / idiv edi     ; ② rand() % n
 * 00408340  mov  word [player + 0x0e], dx      ;    last_node_id = cand[rand() % n]
 * 0040835e  call 0x407a8c(last, node)          ;    = 0x454fb4(node.x − last.x, node.y − last.y)
 * 0040836f  mov  byte [player + 0x10], al      ;    direction
 * ```
 * `0x40aa0f`：
 * ```asm
 * 0040aa1d  for (i = 1; i <= 节点数; i++)
 * 0040aa37    if (node.flags & 0x80ffff00) continue    ; 静态禁放 / 有人站 / 有物件
 * 0040aa40    if (四个邻接全为 0) continue              ; 孤立格不要
 * 0040aa4c    候选[n++] = i
 * 0040aa53  return 候选[rand() % n]
 * ```
 * 与物件登场挑格同一条筛选（`objectNodeCandidates` / `pickObjectNode`）；运行时那两段占用位
 * 本引擎不镜像，由调用方传 `occupied`（`runtimeOccupiedNodes`：已上盘的人、地上的物件、盘上的惡人）。
 *
 * 即人物**背对一个随机邻格站着**，而那一格又是 `last_node_id` ⇒ 第一步
 * （`pickNextNode` 排除上一格）一定走别的方向 —— 站姿朝向与接下来要走的方向一致
 * （第十四份试玩回报 #2）。
 *
 * @returns 一格都放不下时 `null`（原版会 `idiv 0` —— 不可达：地图上可放的格远多于 4 人 + 物件）
 */
export function drawStartPlacement(
  nodes: readonly MapNode[],
  occupied: ReadonlySet<number>,
  rng: WatcomRng,
): StartPlacement | null {
  const free = objectNodeCandidates(nodes).filter((n) => !occupied.has(n));
  if (free.length === 0) return null;
  const nodeId = pickObjectNode(free, rng.next());
  return startFacing(nodes, nodeId, rng);
}

/** `drawStartPlacement` 的第 ② 步：给定起始格，抽「来路」并求朝向 */
function startFacing(nodes: readonly MapNode[], nodeId: number, rng: WatcomRng): StartPlacement {
  const node = nodes[nodeId - 1];
  const cand = node === undefined ? [] : node.adjacentSlots.filter((n) => n !== 0);
  // 候选为空时原版会 `idiv 0`（筛起始格时已排除孤立格，走不到这里）—— 不抽、原地
  if (node === undefined || cand.length === 0) return { nodeId, lastNodeId: nodeId, direction: 0 };
  const lastNodeId = cand[rng.next() % cand.length]!;
  const last = nodes[lastNodeId - 1];
  const direction = last === undefined ? 0 : directionOf(node.x - last.x, node.y - last.y);
  return { nodeId, lastNodeId, direction };
}

/**
 * 把一个人摆上 `placement` 那一格并**落地**：节点三元组 + 坐标 + `who_plays = +0x64`。
 *
 * @source 摆人 `0x004082fb` / `0x00408340` / `0x0040836f`；落地 `0x00418cde`（xpos）/
 *   `0x00418cfa`（ypos）/ `0x00418d07`（`who_plays ← +0x64`）
 */
export function landAt(player: Player, nodes: readonly MapNode[], placement: StartPlacement): Player {
  const placed: Player = {
    ...player,
    nodeId: placement.nodeId,
    lastNodeId: placement.lastNodeId,
    direction: placement.direction,
    whoPlays: player.landingWhoPlays ?? 0,
  };
  // ★ 位置是三元组：`nodeId` / `xpos` / `ypos` 一起写（`rules/position.ts`）
  return placeOnNodeId(placed, nodes, placement.nodeId);
}

/**
 * 轮到一个**还没上盘**的人 ⇒ 摆上去并落地（原版 `0x40829d` 摆人 + `0x418c55` 开头那一段）。
 * 已上盘 / 出局 ⇒ 原样返回（引用不变）。
 *
 * ★ 调用时机：回合交接给他、`0x41c84f`（`beginActorTurn`）**之后**（那一段见 `who_plays == 0`
 *   就提前返回 —— 没上盘的人不走一天），掷骰 / 电脑决策之前。
 */
export function landUnplacedPlayer(state: GameState, nodes: readonly MapNode[], index: number): GameState {
  const me = state.players[index];
  if (me === undefined || !isUnplaced(me)) return state;
  const rng = new WatcomRng();
  rng.setState(state.rngState);
  const occupied = runtimeOccupiedNodes(state.players, state.objects, state.specialActors);
  const placement = drawStartPlacement(nodes, occupied, rng);
  if (placement === null) return state;
  return {
    ...state,
    rngState: rng.getState(),
    players: state.players.map((p, i) => (i === index ? landAt(p, nodes, placement) : p)),
  };
}
