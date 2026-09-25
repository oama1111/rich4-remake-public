/*
 * 請神符（卡 23）的目标 —— 「请**最近**的那尊神」 Q-PICK-2
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 去 exe 核过的结论：**原版没有列表 UI，也没有棋盘拾取窗口**。
 *
 * `rich4_card_qingshenfu.asm` / VA 0x00444e1a 的真身只有两行：
 * ```asm
 * cmp byte [player + 0x15], 1     ; 是不是真人
 * jne short loc_00444e35
 * call fcn_00444d1a               ; ★ 真人：自动挑「最近的物件」
 * ...
 * loc_00444e35:
 * push 0 / call 0x41e6f2          ; 电脑：参数表取值
 * ```
 * 而 `fcn_00444d1a`（VA 0x00444d1a）从头到尾**不碰任何窗口** —— 它只是
 * 把地图上的物件扫一遍、比距离、返回**最近那一个的 handle**（0 = 一个都没有）：
 *
 * ```asm
 * 00444d2b  push -1 / call 0x40a45c     ; 把当前**视野**里的实例摊平进 0x48b8c4（见下）
 * 00444d43  mov ax, word [ebx*2 + 0x48b8c4]
 * 00444d4b  test ah, 0x80 / je 下一个    ; 高位 = 「这是个物件实例」
 * 00444d5d  and ah, 0x7f / sar eax,8     ; handle = (实例字 >> 8) & 0x7f
 * 00444d70  call 0x40ea62 / cmp eax,1    ; ★ 物件种类可附身？（`canAttach`）
 * 00444d8e  cmp byte [objects + 0x5], 0 / jne 下一个   ; 已附身于人的不要
 * 00444db1  movsx edx, word [node]       ; 物件所在节点的 x
 * 00444db4  movsx ecx, word [node + 2]   ; y
 * 00444dc1  mov di, word [player + 8]    ; 当前玩家的 x
 * 00444dca  mov ax, word [player + 0xa]  ; y
 * 00444dda  imul edx,edx / imul eax,eax / add   ; d² = dx² + dy²
 * 00444dea  call 0x4582bc                ; sqrt
 * 00444dfe  jbe 下一个                   ; ★ best <= d 就跳过 → 严格更小才换
 * 00444e08  mov ebp, esi                 ; best = 这一件的 handle
 * ```
 *
 * 所以本引擎照抄：**不问玩家**，直接算「离当前玩家最近的可附身物件」，
 * 拿到 handle 就发 `useCard{cardId:23, target:{kind:'object'}}`。
 * 一个都没有（`ebp` 停在 0）时卡不消耗 —— 原版那张卡的返回值就是 0。
 *
 * ★★ 2026-09-25（C23-1 结案）：第 20 行那一句是**视野筛子**，不是「全地图」——
 *   见下面 `BoardView`：原版扫的是屏幕空间那张 440×440 的 id 图，画不进画面的
 *   物件**根本不在候选集里**。先前这里少这一道，隔半张地图的尊神也能请过来。
 *
 * ⚠️ 等距时原版取的是**行序在先**的那一格 —— 也就是那张屏幕图里的行序
 *   （先屏幕 y、再屏幕 x）。视图不旋转时屏幕序 = 世界序（只差一个平移），
 *   本引擎按 `(y, x, handle)` 排序与它逐条相同；视图**旋转**过
 *   （`camera.view ≠ 0`）时两者可能不同 —— 这一条仍登记在
 *   `docs/deviations/Q-PICK-2.md`。
 */

import { canAttach, type CardTarget, type GameState, type MapTopology } from '@rich4/core';

/** 請神符的卡号 @source 卡片表第 23 项 → `rich4_card_qingshenfu.asm` */
export const SUMMON_CARD_ID = 23;

/**
 * ★★ 2026-09-25（本分支，C23-1 结案）：**「视野内」这一道筛子**。
 *
 * 原版那一遍扫的不是物件表，而是 `0x40a45c(-1)` 摊出来的**屏幕空间 id 图**：
 * ```asm
 * 0040a469  esi = 0 / edi = 0x1b8                    ; 整个棋盘视口 440×440
 * 0040a494  call 0x409de7                            ; 按**当前镜头**重建那张图
 * 00409dea  push 0x5e880 / push 0 / push [0x474938]  ; memset(0x474938, 0, 440*440*2)
 * 00409e99  cmp ebx, 0x1b8 / jge 跳过                 ; 实例屏幕 x 不在 [0,440) ⇒ 不画进图
 * 00409ea5  cmp edx, 0x1b8 / jge 跳过                 ; 屏幕 y − 0x28（顶部工具栏）同理
 * 00409ede  or word [图 + (440*y + x)*2], 实例字      ; ★ 每个实例**只写一粒**（不是 sprite 覆盖的每个像素）
 * 0040a4bb  mov word [ebx*2 + 0x48b8c4], cx / inc ebx ; 把非 0 的图元摊平成一张清单
 * ```
 * 而物件的「屏幕坐标」就是它**所在节点的屏幕坐标**（`0x408ea0` 起：
 * `屏幕x = [esp+0x34] + (节点x − 镜头x)`、`屏幕y = [esp+0x20] + (节点y − 镜头y)`；
 * 写进 `+0x48a854/+0x48a856`）⇒ 判据是**一个点的内外**，不是 sprite 的外接矩形。
 *
 * ⇒ 「视野内」= 该物件所在节点投影到**棋盘区**后落在 `[0, 宽) × [0, 高)` 里。
 *   本引擎的棋盘区就是原版那 440×440（`LAYOUT.board`，宽 439 见 `render.ts` 的
 *   半像素订正），`worldToScreen` 的输出正是以棋盘区中心为原点的那套局部像素。
 *
 * ⚠️ 用**当前镜头**（含玩家拖过 / 拾取时贴边推过的位移），这正是原版的语义：
 *   镜头本身是**客户端**的表现态（原版存在 `[0x48c570]/[0x48c574]`，拾取时
 *   贴边每 50 ms 推 8→68 像素、clamp 到 [220,2084]），不在局面里、也不上传 ——
 *   所以这一道筛子只能由**出牌那一端的客户端**算（原版也只有一个镜头）。
 */
export interface BoardView {
  /** 世界坐标 → 棋盘区局部像素（棋盘区中心 = 视口中心）；出画 = `null` */
  project: (x: number, y: number) => { x: number; y: number } | null;
  /** 棋盘区尺寸（`LAYOUT.board.w/h`） */
  width: number;
  height: number;
}

/** 这一点投到棋盘区里了吗 @source `0x409e99`/`0x409ea5` 的两道 `jl` / `jge` */
export function visibleInBoard(view: BoardView, x: number, y: number): boolean {
  const p = view.project(x, y);
  return p !== null && p.x >= 0 && p.x < view.width && p.y >= 0 && p.y < view.height;
}

/** 一个可以请的物件：handle（下标 + 1）与它离玩家的平方距离 */
export interface ObjectCandidate {
  /** 物件 handle = 下标 + 1（原版 `objects_info` 的 1 基 handle） */
  handle: number;
  /** 平方距离（原版开方后比大小，单调，等价） */
  d2: number;
  /** 物件所在节点的世界坐标 —— 只用于复现原版的**行序** */
  x: number;
  y: number;
}

/**
 * 地图上**此刻能被请**的物件（原版 `0x48b8c4` 那一遍扫描的筛子）。
 *
 * 四条与 exe 一一对应：
 *   - 屏幕上真的画着它（`0x40a45c(-1)` 那张 440×440 的图里有它）→ `view`
 *   - `fcn_0040ea62(handle) == 1` → `canAttach(type)`（`(type<=12 && type!=11) || type==15`）
 *   - `objects[handle-1].f5 == 0` → `attached === 0`（没被别人请走）
 *   - 距离要用节点坐标 → `nodeId !== 0`（不在图上就没法算）
 *
 * `canAttach` 与 `summonableObjects` 都是 core 的既有实现（同一个 `0x40ea62`），
 * 这里直接用，免得规则出现第二份。
 *
 * @param view 棋盘区（当前镜头下的可见范围）。**只有出牌那端的客户端拿得到**；
 *   不传 = 不筛视野（老调用点 / 单测用）。
 */
export function pickableObjects(
  state: GameState,
  topo: MapTopology,
  view?: BoardView,
): ObjectCandidate[] {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return [];
  const here = topo.nodes[me.nodeId - 1];
  if (here === undefined) return [];

  const out: ObjectCandidate[] = [];
  for (let i = 0; i < state.objects.length; i++) {
    const o = state.objects[i];
    if (o === undefined || o.nodeId === 0 || o.attached !== 0) continue;
    if (!canAttach(o.type)) continue;
    const node = topo.nodes[o.nodeId - 1];
    if (node === undefined) continue;
    // @source 0x444d2b push -1 / call 0x40a45c → 只有画进那张 440×440 图的实例才在清单里
    if (view !== undefined && !visibleInBoard(view, node.x, node.y)) continue;
    const dx = node.x - here.x;
    const dy = node.y - here.y;
    out.push({ handle: i + 1, d2: dx * dx + dy * dy, x: node.x, y: node.y });
  }
  return out;
}

/**
 * 請神符会请到哪一尊 —— **纯函数**，返回物件 handle；`0` = 一个都请不到。
 *
 * @source VA 0x00444d1a（见文件头）。距离用**平方**比（原版开方后比，
 * 两者单调等价，而且省掉浮点）。
 *
 * @param view 当前镜头下的棋盘区（见 `BoardView`）。原版真的会**看不见就请不到**
 *   ——`0x444d1a` 扫的是屏幕空间那张图，不在图上 ⇒ 候选集里根本没有它
 *   （这一条 2026-09-25 才接上：先前是「全地图最近的」，隔半张地图也能请到）。
 */
export function nearestSummonableObject(
  state: GameState,
  topo: MapTopology,
  view?: BoardView,
): number {
  const cands = pickableObjects(state, topo, view);
  // ★ 原版按地图格行序扫，等距取先遇到的 —— 这里按 (y, x, handle) 复现行序
  cands.sort((a, b) => a.y - b.y || a.x - b.x || a.handle - b.handle);
  let best = 0;
  let bestD2 = Infinity;
  for (const c of cands) {
    // @source `jbe` → 只有**严格更近**才换
    if (c.d2 < bestD2) {
      bestD2 = c.d2;
      best = c.handle;
    }
  }
  return best;
}

/** 选中之后要发的 action —— 形状与 `core/state/actions.ts` 的 `useCard` 一致 */
export type UseCardAction = { type: 'useCard'; cardId: number; target: CardTarget };

/**
 * handle → action；`0`（没得请）返回 `null` ⇒ **不发 action、卡不消耗**。
 * 原版此时 `0x444e3f` 的 `test esi,esi / je` 直接跳过扣卡。
 */
export function summonCardAction(objectIndex: number): UseCardAction | null {
  if (!Number.isInteger(objectIndex) || objectIndex <= 0) return null;
  return { type: 'useCard', cardId: SUMMON_CARD_ID, target: { kind: 'object', objectIndex } };
}
