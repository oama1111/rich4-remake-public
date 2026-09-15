/*
 * 目标拾取模式 —— T-026
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**不含任何规则**。「这一格算不算数」一律问 core 的
 *   `canUseCard` / `canUseTool`（`state/preview.ts`），client 只负责
 *   枚举候选、命中测试、画反馈。
 *
 * ## 原版的反馈是**鼠标指针变形**，不是棋盘上的标记
 *
 * `_rich4_select_instance_with_mouse(param)`（VA 0x446ae8）把窗口过程
 * `_rich4_select_instance_callback`（VA 0x445e4d）交给模态消息循环，
 * 那个窗口过程里没有任何往**棋盘**上画的东西 —— WM_PAINT 只是把离屏面贴回
 * 屏幕（VA 0x4466fa）。真正的反馈全在**指针形状**上：
 *
 * | 情形 | 指针 | @source |
 * |---|---|---|
 * | 光标底下**能选** | 换成**该道具/该卡自己的光标**（路障→STOP 牌子、地雷→尖刺球…）| VA 0x4465ba |
 * | 光标底下**不能选** | 换成**红叉**（图 5）| VA 0x4465f4 |
 * | 光标贴近棋盘四边 | 换成方向箭头（**34 / 40 / 38 / …**）并**把镜头往那个方向推** | VA 0x44609b 起 |
 *
 * 指针图集是 **`Data.mkf` 资源 0**（43 张；0/1/2 = 路障/地雷/定時炸彈、
 * 5 = 红叉、12 = 卡片、34..40 = 八个方向的滚动箭头）
 * @source VA 0x4020fa `read_mkf(data_mkf, 0, …)`。
 *
 * ★ 上一轮卡里写的「候选格描边」是**我们自己想的**，原版没有 —— 按 exe 改成指针。
 *
 * ⚠️ **没做**：贴边推镜头那一路（方向箭头 + 每 50ms 推一格/一屏）。
 *   它的方向表是 `0x4751b0`（8 个视角各一项），与棋盘旋转共用。已登记
 *   `known-deviations.md` 的 Q-PICK-1。
 */

import {
  ACTOR_MIN,
  canUseCard,
  canUseTool,
  isAlive,
  type CardTarget,
  type GameState,
  type MapTopology,
  type TargetClass,
} from '@rich4/core';

/** 这一次拾取是为了用什么 */
export type PickSource =
  | { kind: 'card'; cardId: number }
  | { kind: 'tool'; toolId: number };

/** 一个候选目标 */
export interface PickCandidate {
  /** 世界坐标落点（命中与画反馈都用它）*/
  wx: number;
  wy: number;
  /** 组装出来的卡片目标 */
  target: CardTarget;
  /** 发 `useTool` 时要带的 `nodeId`（0 = 不带）*/
  nodeId: number;
}

/** 一次拾取会话 */
export interface PickSession {
  source: PickSource;
  /** 目标类别（卡片用；道具不分，一律按「所有格子」枚举）*/
  targetClass: TargetClass;
  /** 这一次的选择参数（决定指针形状与「右键能不能取消」）*/
  param: number;
  /**
   * 能不能**右键取消** @source VA 0x4466b8：`test byte [0x48c594], 8` 为真
   * 时右键不取消 —— 那是「目标必选」的卡。
   */
  cancellable: boolean;
  /** 候选（进会话时算一次；每帧重算太贵）*/
  candidates: readonly PickCandidate[];
}

/**
 * 光标底下的目标**不能选**时的指针 —— **红叉**（图 5）
 * @source VA 0x4465f4 `fcn_004021f8(5, 1, 0)`
 */
export const PICK_CURSOR_INVALID = { image: 5, hotX: 1, hotY: 0 } as const;

/**
 * 光标底下的目标**能选**时的指针 —— 形状由**选择参数**算出来。
 *
 * @source VA 0x445ec1（`0x401` 初始化那支）：
 * ```asm
 * mov edx, ecx ; shr edx, 0x10      ; edx = 选择参数的高 16 位
 * mov eax, edx ; xor ah, dh         ; ★ ah ^= dh（两个字节本来就相等）→ 把次高字节清掉
 * and eax, 0xffff
 * mov [0x48c588], eax               ; → 形状 = 高 16 位的**低字节**
 * xor bl, dl ; xor eax,eax ; mov ax,bx ; sar eax,8 ; inc eax
 * mov [0x48c58c], eax               ; → 热点 x = 高 16 位的**高字节 + 1**
 *                                   ;   （热点 y 固定 0xa，见 VA 0x4465ba 的 `push 0xa`）
 * ```
 * 于是「指针变成**那件道具自己的图标**」这件事是自动的：
 *
 * | 选择参数 | 形状 | 长什么样 |
 * |---|---|---|
 * | `1`（路障）| **0** | STOP 牌子 |
 * | `0x10001`（地雷）| **1** | 尖刺球 |
 * | `0x20001`（定時炸彈）| **2** | 炸彈 |
 * | `0x300c0`（飛彈）/ `0x400c0`（核子飛彈）| **3 / 4** | — |
 * | `0xe0c0XYZ`（各张卡）| **12** | 「卡片」光标 |
 */
export function pickCursorSpec(selectionParam: number): {
  image: number;
  hotX: number;
  hotY: number;
} {
  const hi = (selectionParam >>> 16) & 0xffff;
  return { image: hi & 0xff, hotX: ((hi >>> 8) & 0xff) + 1, hotY: 0xa };
}

/**
 * 每件道具的选择参数 @source 各 `rich4_tool_*.asm` 里 `push …; call 0x446ae8`。
 *
 * ★ 它同时决定「光标底下什么东西算数」（低 16 位的类别位：bit0 格子 /
 *   bit1 地块 / bit2 設施 / bit3 **目标必选**（右键不许取消）/ bit4 玩家 /
 *   bit5 特殊棋子）与「可选时指针长什么样」（高 16 位）—— 一物两用。
 *
 * ⚠️ 工程車（12）在原版里**不调**这个拾取函数（没有 `push …; call 0x446ae8`），
 *   它的目标从哪来还没跟；本引擎暂按「和機器工人一样选一格」处理并登记。
 */
export const TOOL_SELECT_PARAM: ReadonlyMap<number, number> = new Map([
  [2, 0x1], // 路障 —— 只认格子
  [3, 0x10001], // 地雷
  [4, 0x20001], // 定時炸彈
  [7, 0x300c0], // 飛彈
  [13, 0x400c0], // 核子飛彈
  [9, 0x2090006], // 機器工人
  [11, 0x2090001], // 傳送機
]);

/** 指针图集 @source VA 0x4020fa 的 `read_mkf(data_mkf, 0, 0, 0)` */
export const CURSOR_ARCHIVE = 'Data.mkf' as const;
export const CURSOR_RESOURCE = 0;

/**
 * 这类目标在这个引擎里**还没有能点的落点** —— 需要各自的列表 UI。
 *
 * 紅卡/黑卡（股票）与請神符（物件）在原版走的就不是这个拾取窗口
 * （`selection: 'ai'`，见 `cards/target.ts` 的 `targetClassOfCard`），
 * 故本模式不认它们。
 */
export function classNeedsItsOwnList(cls: TargetClass): boolean {
  return cls === 'stock';
}

/**
 * 枚举候选 —— **纯函数**，进会话时算一次。
 *
 * 每一条都拿 core 的预演过一遍（`canUseCard` / `canUseTool`），
 * 所以「什么算数」这件事仍然只有 core 一份实现。
 */
export function pickCandidates(
  state: GameState,
  topo: MapTopology,
  source: PickSource,
  cls: TargetClass,
): PickCandidate[] {
  const nodes = topo.nodes;
  const out: PickCandidate[] = [];

  const ok = (target: CardTarget, nodeId: number): boolean =>
    source.kind === 'card'
      ? canUseCard(state, topo, source.cardId, target)
      : canUseTool(state, topo, source.toolId, nodeId);

  const at = (nodeId: number): { x: number; y: number } | undefined => {
    const n = nodes[nodeId - 1];
    return n === undefined ? undefined : { x: n.x, y: n.y };
  };

  // ── 道具：所有格子都算候选，哪一格算数由 core 说了算 ──
  if (source.kind === 'tool') {
    for (const n of nodes) {
      const target: CardTarget = { kind: 'node', nodeId: n.id };
      if (ok(target, n.id)) out.push({ wx: n.x, wy: n.y, target, nodeId: n.id });
    }
    return out;
  }

  switch (cls) {
    case 'land':
    case 'landOrFacility': {
      for (const n of nodes) {
        // 住宅/連鎖店 → entity；設施 → facility（只有 landOrFacility 收）
        if (n.ref.kind === 'land') {
          const target: CardTarget = { kind: 'entity', entityId: n.ref.index };
          if (ok(target, n.id)) out.push({ wx: n.x, wy: n.y, target, nodeId: n.id });
        } else if (n.ref.kind === 'facility' && cls === 'landOrFacility') {
          const target: CardTarget = { kind: 'facility', facilityId: n.ref.index };
          if (ok(target, n.id)) out.push({ wx: n.x, wy: n.y, target, nodeId: n.id });
        }
      }
      return out;
    }

    case 'anyPlayer':
    case 'player':
    case 'playerOrActor': {
      for (const p of state.players) {
        if (!isAlive(p)) continue;
        const pos = at(p.nodeId);
        const target: CardTarget = { kind: 'player', index: p.index };
        if (pos !== undefined && ok(target, p.nodeId)) {
          out.push({ wx: pos.x, wy: pos.y, target, nodeId: p.nodeId });
        }
      }
      if (cls === 'playerOrActor') {
        // ★ 下标 ↔ 编号：四大惡人 4..7、機器娃娃 8（`state.specialActors[编号 − 4]`）
        for (let i = 0; i < state.specialActors.length; i++) {
          const a = state.specialActors[i];
          if (a === undefined || a.nodeId === 0) continue; // 0 = 不在场
          const pos = at(a.nodeId);
          const target: CardTarget = { kind: 'actor', actor: i + ACTOR_MIN };
          if (pos !== undefined && ok(target, a.nodeId)) {
            out.push({ wx: pos.x, wy: pos.y, target, nodeId: a.nodeId });
          }
        }
      }
      return out;
    }

    case 'object': {
      // 物件下标 1 基（@source 原版 handle = 下标 + 1）
      for (let i = 0; i < state.objects.length; i++) {
        const o = state.objects[i];
        if (o === undefined || o.nodeId === 0) continue;
        const pos = at(o.nodeId);
        const target: CardTarget = { kind: 'object', objectIndex: i + 1 };
        if (pos !== undefined && ok(target, o.nodeId)) {
          out.push({ wx: pos.x, wy: pos.y, target, nodeId: o.nodeId });
        }
      }
      return out;
    }

    // stock 与 none 在这里没有落点（见 `classNeedsItsOwnList`）
    default:
      return out;
  }
}

/** 开一次拾取会话（候选在这里算一次就固定）*/
export function startPick(
  state: GameState,
  topo: MapTopology,
  source: PickSource,
  targetClass: TargetClass,
  param: number,
): PickSession {
  return {
    source,
    targetClass,
    // bit3 = 「目标必选」→ 右键不取消 @source VA 0x4466b8 的 `test byte [0x48c594], 8`
    cancellable: (param & 0x8) === 0,
    param,
    candidates: pickCandidates(state, topo, source, targetClass),
  };
}

/** 这一刻该用哪个指针（`hovering` = 光标底下有没有候选）*/
export function pickCursorFor(
  session: PickSession,
  hovering: boolean,
): { image: number; hotX: number; hotY: number } {
  return hovering ? pickCursorSpec(session.param) : PICK_CURSOR_INVALID;
}

/**
 * 光标底下是第几个候选；没有就返回 null。
 *
 * @param toScreen 世界坐标 → 屏幕坐标（`render.ts` 的 `worldToScreen`，
 *   **两种视角都认**；本模块不碰相机）
 */
export function hitCandidate(
  session: PickSession,
  sx: number,
  sy: number,
  toScreen: (wx: number, wy: number) => { x: number; y: number } | null,
  radius = 24,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (let i = 0; i < session.candidates.length; i++) {
    const c = session.candidates[i]!;
    const p = toScreen(c.wx, c.wy);
    if (p === null) continue; // 人物视角下越出画布的格子根本没画
    const dx = p.x - sx;
    const dy = p.y - sy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
