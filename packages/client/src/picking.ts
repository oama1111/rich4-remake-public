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
 * ## 候选的**落点**必须跟实例走（Q-TOOL-4）
 *
 * 原版判「光标底下是什么」用的是**像素级实例表**
 * （`_rich4_get_instance_from_position` VA 0x40a9d7：`word [0x474938][440*y + x]`），
 * 命中的是**画在那儿的那个实例**：光标在建筑/白格上 → 地块编码（2000+下标）、
 * 在設施上 → 設施编码、只有在路面上才是节点号。
 * 而地块/設施是按**各自的记录坐标**画的，与节点坐标实测差 41..66 屏幕像素
 * （Q-LAYOUT-4）。先前这里一律把候选挂在节点上，于是「機器工人点自己的白格」
 * 永远吃红叉 —— 见 `instanceAnchor`。
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
  /**
   * 世界坐标落点（命中与画反馈都用它）。
   *
   * ★ **不是**节点坐标：地块/設施画在各自的记录坐标上（见 `instanceAnchor`），
   *   把它当节点会偏 41..66 屏幕像素，用户点不到。
   */
  wx: number;
  wy: number;
  /** 组装出来的卡片目标 */
  target: CardTarget;
  /** 发 `useTool` 时要带的 `nodeId`（0 = 不带）—— 引擎的 target 契约一直是**节点号** */
  nodeId: number;
}

/** 一次拾取会话 */
export interface PickSession {
  source: PickSource;
  /** 目标类别（卡片用；道具不分，一律按「所有格子」枚举）*/
  targetClass: TargetClass;
  /** 这一次的选择参数（决定指针形状、类别位与「右键能不能取消」）*/
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

/**
 * 选择参数的**类别位** —— 决定「光标底下什么算数」。
 *
 * @source VA 0x4461ff 起（窗口过程的悬停判定）逐条 `test byte [0x48c594], X`：
 * ```asm
 * 00446235  test byte [0x48c594], 1     ; bit0：**格子**（路面；实例值 < 2000）
 * 0044624e  test byte [0x48c594], 2     ; bit1：**地块**（2000..4000；路边的白格/建筑）
 * 0044627d  test byte [0x48c594], 4     ; bit2：**設施**（4000..6000）
 * 004462b3  test byte [0x48c594], 0x10  ; bit4：玩家棋子（0x80xx）
 * 004462e7  test byte [0x48c594], 0x20  ; bit5：特殊棋子（四大惡人/娃娃）
 * ```
 * 同一个字节里的另两位不是类别：bit3（`8`）= **目标必选**（右键不许取消，
 * VA 0x4466b8），bit7（`0x80`）= **光标贴边推镜头**（VA 0x44609b）。
 */
export const PICK_CLASS = {
  /** 路面：棋子走的那一格格子 */
  node: 0x1,
  /** 地块：路边的**白格**（建筑就画在那儿，见 render.ts 的 Q-LAYOUT-4） */
  land: 0x2,
  /** 設施（機場/港口…，画在 `facility.x/y`） */
  facility: 0x4,
  /** 目标必选（不是类别） */
  required: 0x8,
  player: 0x10,
  /**
   * bit5 = `0x8000 | (下标 << 8)` 那一族编码。
   *
   * ⚠️ 先前只记作「特殊棋子」，但拆除卡（`0xe0c0626`，低字节 `0x26`）的
   * **地图物件**（路障 16 / 地雷 17 / 定時炸彈 18）走的也是这一位 ——
   * 见 core 的 `TargetClass` 的 `landFacilityOrObject` 与拾取跳表组 6
   * @source VA 0x00446528（`test bh, 0x80` + 种类 0x10/0x11/0x12）。
   */
  actor: 0x20,
  /** ★ 「什么都收」：见 `pickClasses` */
  all: 0x40,
  edgeScroll: 0x80,
} as const;

/**
 * 把选择参数的低 16 位规范化成**真正的类别位**。
 *
 * @source VA 0x445ec1（`0x401` 那条初始化）：
 * ```asm
 * test byte [0x48c594], 0x40
 * je   跳过
 * and  dword [0x48c594], 0x80        ; ★ 只留 bit7，其余（含 bit3）全清
 * or   byte [0x48c594], 0x37         ; 于是类别 = 格子|地块|設施|玩家|棋子
 * ```
 * 飛彈/核子飛彈的选择参数就是这种（`0x300c0` / `0x400c0` 的低 16 位 = `0xc0`）：
 * 「什么都收、右键可取消、光标贴边推镜头」。
 */
export function pickClasses(selectionParam: number): number {
  const lo = selectionParam & 0xffff;
  if ((lo & PICK_CLASS.all) !== 0) {
    const every =
      PICK_CLASS.node | PICK_CLASS.land | PICK_CLASS.facility | PICK_CLASS.player | PICK_CLASS.actor;
    return (lo & PICK_CLASS.edgeScroll) | every;
  }
  return lo;
}

/**
 * 这一次拾取在**这一个节点**上要打的那个**实例**，它的绘制落点。
 *
 * ★ 为什么不能一律用节点坐标：原版是按**光标底下的像素**查一张实例表
 *   （`_rich4_get_instance_from_position` @ VA 0x40a9d7：
 *   `instance = word [0x474938][440 * y + x]`），光标落在**建筑/白格**上拿到的是
 *   **地块编码**（2000 + 下标）、落在設施上拿到設施编码、只有在路面上才是节点号。
 *   而地块/設施是画在**它们自己的 x/y** 上的（@source 绘制 VA 0x004090fc：
 *   `movsx eax, word [ebp]` / `[ebp+2]`，`ebp` 是地块记录）——
 *   与本节点实测差 **41..66 屏幕像素**（见 render.ts `#buildingSlots` 的说明
 *   与 known-deviations 的 Q-LAYOUT-4）。
 *
 * ⚠️ 这就是「機器工人点不动自己的地」那一类问题的根：先前候选一律挂在节点
 *   （**路面**）上，而地块在第 24 像素命中半径之外 —— 用户点白格/房子永远吃红叉。
 */
export function instanceAnchor(
  topo: MapTopology,
  node: MapTopology['nodes'][number],
  classes: number,
): { x: number; y: number } {
  // ★ 取成 const 局部量：`node.ref` 是可变属性，判别联合的收窄**进不了闭包**
  const ref = node.ref;
  if ((classes & PICK_CLASS.land) !== 0 && ref.kind === 'land') {
    const l = topo.lands?.find((x) => x.id === ref.index);
    if (l !== undefined) return { x: l.x, y: l.y };
  }
  if ((classes & PICK_CLASS.facility) !== 0 && ref.kind === 'facility') {
    const f = topo.facilities?.find((x) => x.id === ref.index);
    if (f !== undefined) return { x: f.x, y: f.y };
  }
  return { x: node.x, y: node.y };
}

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
 *
 * ★ 候选的**落点**按原版的实例表分开：
 *   - 路面（格子）→ 节点自己的 x/y；
 *   - 地块（白格/建筑）→ **地块记录的 x/y**；
 *   - 設施 → **設施记录的 x/y**。
 *   原版是「光标落在哪个像素、就查那一像素的实例」（`0x40a9d7`），
 *   而这三样东西画在**三个不同的地方**（见 `instanceAnchor`）。
 *
 * @param param 选择参数（`TOOL_SELECT_PARAM` / 卡片的 `selectionParam`）——
 *   它的**类别位**决定这一个节点上哪一类实例算数（见 `PICK_CLASS`）。
 */
export function pickCandidates(
  state: GameState,
  topo: MapTopology,
  source: PickSource,
  cls: TargetClass,
  param = 0,
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
  //
  // ★ 落点由参数的**类别位**分流（原版就是这么分的）：
  //   機器工人（`0x2090006`，低 16 位 `0x6` = 地块|設施、**不含格子**）
  //   → 候选挂在**白格/建筑**上，路面不算数；
  //   路障/地雷/定時炸彈/傳送機（`0x1` = 只认格子）→ 候选挂在路面上；
  //   飛彈/核子（`0xc0` → `pickClasses` 展开成 0x37）→ 两处都算。
  if (source.kind === 'tool') {
    const classes = pickClasses(param);
    for (const n of nodes) {
      const target: CardTarget = { kind: 'node', nodeId: n.id };
      if (!ok(target, n.id)) continue;
      if ((classes & PICK_CLASS.node) !== 0) {
        out.push({ wx: n.x, wy: n.y, target, nodeId: n.id });
      }
      const anchor = instanceAnchor(topo, n, classes);
      if (anchor.x !== n.x || anchor.y !== n.y) {
        out.push({ wx: anchor.x, wy: anchor.y, target, nodeId: n.id });
      }
    }
    return out;
  }

  switch (cls) {
    case 'land':
    case 'landOrFacility':
    case 'facility':
    case 'landFacilityOrObject': {
      // 类别位决定枚举哪几类实例（原版按参数的类别位分流）：
      //   land         → 只地块（0xe0c0202：脚下是地块的换地/换屋）
      //   facility     → 只設施（0xe0c0204：脚下是設施的换地/换屋）
      //   landOrFacility / landFacilityOrObject → 两样都收
      const wantLand = cls !== 'facility';
      const wantFacility = cls !== 'land';
      for (const n of nodes) {
        // 住宅/連鎖店 → entity；設施 → facility
        if (wantLand && n.ref.kind === 'land') {
          const target: CardTarget = { kind: 'entity', entityId: n.ref.index };
          const p = instanceAnchor(topo, n, PICK_CLASS.land);
          if (ok(target, n.id)) out.push({ wx: p.x, wy: p.y, target, nodeId: n.id });
        } else if (wantFacility && n.ref.kind === 'facility') {
          const target: CardTarget = { kind: 'facility', facilityId: n.ref.index };
          const p = instanceAnchor(topo, n, PICK_CLASS.facility);
          if (ok(target, n.id)) out.push({ wx: p.x, wy: p.y, target, nodeId: n.id });
        }
      }
      // 拆除卡（0xe0c0626）的第三类：地图物件（路障/地雷/定時炸彈），
      // 落点就是它所在那一格 —— 见 core 的 landFacilityOrObject
      if (cls === 'landFacilityOrObject') {
        for (let i = 0; i < state.objects.length; i++) {
          const o = state.objects[i];
          if (o === undefined || o.nodeId === 0) continue;
          const pos = at(o.nodeId);
          const target: CardTarget = { kind: 'object', objectIndex: i + 1 };
          if (pos !== undefined && ok(target, o.nodeId)) {
            out.push({ wx: pos.x, wy: pos.y, target, nodeId: o.nodeId });
          }
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
    // bit3 = 「目标必选」→ 右键不取消 @source VA 0x4466b8 的 `test byte [0x48c594], 8`。
    // ★ 读的是**规范化之后**的字节（`0x401` 那条初始化会先按 bit6 展开类别，
    //   顺手把 bit3 清掉 —— 飛彈/核子一律可取消）。
    cancellable: (pickClasses(param) & PICK_CLASS.required) === 0,
    param,
    candidates: pickCandidates(state, topo, source, targetClass, param),
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

// ============================================================
//  ★ 贴边推镜头（Q-PICK-1）@source `rich4_ui_use_tool.asm`
// ============================================================

/**
 * 「贴边」推镜头的四个方向 —— 与 `[0x48c568]` 的取值一一对应。
 *
 * @source `loc_0044609b`（`_rich4_select_instance_callback` 的 `0x200` 分支）：
 * ```asm
 * 0044609b  ebx = LOWORD(lParam)            ; 鼠标 x（棋盘 client）
 *           ebp = HIWORD(lParam) - 0x28     ; ★ 棋盘窗口的 y 偏移 0x28 = 40
 *           test byte [0x48c594], 0x80 / je loc_004461ff   ; 没开就跳过（bit7）
 * 004460ac  test ebx, ebx      / jne → [0x48c568] = 2   ; x == 0        → 左
 * 004460cd  cmp  ebx, 0x1b8    / jl  → [0x48c568] = 4   ; x >= 440      → 右
 * 004460e1  test ebp, ebp      / jg  → [0x48c568] = 1   ; y − 40 <= 0   → 上
 * 004460f4  cmp  ebp, 0x1b7    / je  → [0x48c568] = 3   ; y − 40 == 439 → 下
 *           否则 → KillTimer、[0x48c568] = 0、步长复位 8
 * 0044618d  SetTimer(hwnd, [_callbackSize], 0x32, 0)    ; ★ 周期 50 ms = 0x32
 * ```
 * ★ 判定顺序 **左 → 右 → 上 → 下**（横向优先）、互斥；**没有对角** ——
 *   落在角上只取一条边。阈值是 440×440 的棋盘（`0x1b8`）。
 */
export const PICK_EDGE = {
  none: 0,
  up: 1,
  left: 2,
  down: 3,
  right: 4,
} as const;

export type PickEdge = (typeof PICK_EDGE)[keyof typeof PICK_EDGE];

/** 棋盘窗口在屏幕里的 y 偏移 @source 上面那条 `sub ebp, 0x28` */
export const PICK_BOARD_OFFSET_Y = 0x28;
/** 棋盘的宽/高（方形）@source `cmp ebx, 0x1b8` / `cmp ebp, 0x1b7` */
export const PICK_BOARD_SIZE = 0x1b8;

/**
 * 鼠标落在棋盘的哪条边上；不在边上（或没开贴边）返回 `PICK_EDGE.none`。
 *
 * @param x 相对棋盘左上角的 x（px）
 * @param y 相对棋盘左上角的 y（px）—— 调用方负责减掉 `PICK_BOARD_OFFSET_Y`
 * @param enabled 选择参数的 bit7（`PICK_CLASS.edgeScroll`）开没开
 *
 * ★ 四条判据的**先后**照原版：横向先判（左 → 右），再纵向（上 → 下）。
 */
export function pickEdgeOf(x: number, y: number, enabled: boolean): PickEdge {
  if (!enabled) return PICK_EDGE.none;
  if (x === 0) return PICK_EDGE.left;
  if (x >= PICK_BOARD_SIZE) return PICK_EDGE.right;
  if (y <= 0) return PICK_EDGE.up;
  if (y === PICK_BOARD_SIZE - 1) return PICK_EDGE.down;
  return PICK_EDGE.none;
}

/**
 * 光标换成的八方向箭头图号（`Data.mkf` **资源 0** 那张 43 张的指针图集）。
 *
 * @source `loc_0044614b`（`rich4_ui_use_tool.asm:522-533`）：
 *   `idx = [0x475e0d + dir*4]` → **上 = 34、左 = 40、下 = 38、右 = 36**。
 *   （34..41 是八个方向，其中 35/37/39/41 是四个对角 —— 因为判定互斥，
 *    它们**永远不会出现**。）
 *   `[0x475e0d]` 那张表按 `[0x48c568]` 索引，故键就是上面的 `PICK_EDGE`。
 */
export const PICK_EDGE_ARROW: ReadonlyMap<number, number> = new Map([
  [PICK_EDGE.up, 34],
  [PICK_EDGE.left, 40],
  [PICK_EDGE.down, 38],
  [PICK_EDGE.right, 36],
]);

/**
 * 推镜头的**方向表** `0x4751b0`（8 项 × 2 个 16.16 定点数），**原始整数**。
 *
 * @source 逐项 dump 自 exe（DGROUP `0x463000` → 文件 398848）：
 * ```
 * [0] 0x00000000 0xFFFF0000   ; ( 0, −1)
 * [1] 0xFFFF4AFB 0xFFFF4AFB   ; (−0.707107, −0.707107)   ← 0xB505 = 46341
 * [2] 0xFFFF0000 0x00000000   ; (−1,  0)
 * [3] 0xFFFF4AFB 0x00004AFB   ; (−0.707107, +0.707107)
 * [4] 0x00000000 0x00010000   ; ( 0, +1)
 * [5] 0x00004AFB 0x00004AFB   ; (+0.707107, +0.707107)
 * [6] 0x00010000 0x00000000   ; (+1,  0)
 * [7] 0x00004AFB 0xFFFF4AFB   ; (+0.707107, −0.707107)
 * ```
 * ⚠️ 存**原始整数**而不是浮点：原版是 `(raw × step) >> 16` 的**整数**运算，
 *   负数是算术右移（= 向下取整，不是向零取整）。写成 `0.707 × step` 再取整
 *   会在负方向上差 1 —— 而 `>` / `<` 有 4 项都是负的。
 */
export const PICK_SCROLL_DIRS: readonly (readonly [number, number])[] = [
  [0, -0x10000],
  [-0xb505, -0xb505],
  [-0x10000, 0],
  [-0xb505, 0xb505],
  [0, 0x10000],
  [0xb505, 0xb505],
  [0x10000, 0],
  [0xb505, -0xb505],
] as const;

/**
 * 由「贴边方向 + 当前视角」查方向表的下标。
 *
 * @source `loc_00445f88`（`0x113` 定时器分支，`rich4_ui_use_tool.asm:392`）：
 * ```asm
 * eax = ([0x48c568] * 2 + [0x499088] − 2) & 7     ; [0x499088] = 视角
 * ```
 * ⇒ `idx = (dir * 2 + view − 2) & 7`：视角 0 时 上/左/下/右 = 1 / 2 / 3 / 4。
 */
export function pickScrollDirIndex(edge: PickEdge, view: number): number {
  if (edge === PICK_EDGE.none) return 0;
  return (edge * 2 + (view % 8) - 2) & 7;
}

/** 步长的起步值 @source `[0x48c56c]` 的初值 8 */
export const PICK_SCROLL_STEP_MIN = 8;
/** 步长的上限 @source `cmp edi, 0x40 / jg` —— 每次 +4，到 64 之后再加就是 68 */
export const PICK_SCROLL_STEP_CAP = 0x44;
/** 每次 tick 的增量 @source `lea ebp, [edi + 4]` */
export const PICK_SCROLL_STEP_INC = 4;

/**
 * 推镜头的一步走多远（px）。
 *
 * @source `loc_00445f88`：
 * ```asm
 * mov edi, [0x48c56c]                 ; 步长
 * cmp edi, 0x40
 * jg  跳过
 * lea ebp, [edi + 4]                  ; ★ 每次 +4
 * mov [0x48c56c], ebp
 * 跳过:
 * … 用 edi（**本次**的值）乘方向表那一项 >> 16
 * ```
 * ⇒ 序列 8 → 12 → 16 → … → 64 → 68 → 68 …（第一次用 8，之后每次 +4，
 *   到 0x40+4 = 68 封顶）；离开边缘时 `[0x48c56c]` 复位成 8。
 *
 * @param prev 上一 tick 用的步长（首次传 `PICK_SCROLL_STEP_MIN`）
 */
export function pickScrollNextStep(prev: number): number {
  if (prev > PICK_SCROLL_STEP_CAP - PICK_SCROLL_STEP_INC) return prev;
  return prev + PICK_SCROLL_STEP_INC;
}

/** 镜头中心的钳位范围 @source `cmp esi, 0xdc` / `cmp esi, 0x824` */
export const PICK_SCROLL_MIN = 0xdc; // 220
export const PICK_SCROLL_MAX = 0x824; // 2084

/**
 * 推一格之后的镜头中心。
 *
 * @source `loc_00445f88`：
 * ```asm
 * [0x48c570] += ([0x4751b0][eax].x * 步长) >> 16
 * [0x48c574] += ([0x4751b0][eax].y * 步长) >> 16
 * cmp esi, 0xdc  / jge 下一支 ; 小于就置 0xdc
 * cmp esi, 0x824 / jle 下一支 ; 大于就置 0x824
 * ```
 * 两个方向**各自**钳（不是按距离钳）。
 */
export function pickScrollCamera(
  center: { x: number; y: number },
  edge: PickEdge,
  view: number,
  step: number,
): { x: number; y: number } {
  if (edge === PICK_EDGE.none) return { ...center };
  const d = PICK_SCROLL_DIRS[pickScrollDirIndex(edge, view)] ?? [0, 0];
  // ★ 逐位照抄：`(raw × step) >> 16`，JS 的 `>>` 就是算术右移（与 x86 `sar` 一致）
  const x = center.x + ((d[0]! * step) >> 16);
  const y = center.y + ((d[1]! * step) >> 16);
  return {
    x: Math.min(PICK_SCROLL_MAX, Math.max(PICK_SCROLL_MIN, x)),
    y: Math.min(PICK_SCROLL_MAX, Math.max(PICK_SCROLL_MIN, y)),
  };
}

/** 推镜头的定时器周期（毫秒）@source `SetTimer(hwnd, id, 0x32, 0)` = 50 */
export const PICK_SCROLL_TICK_MS = 0x32;
