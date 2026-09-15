/*
 * 棋盘渲染
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**只读**游戏状态，不产生任何规则判断。
 *   它拿到的是 `GameState` 与地图拓扑，画出来就完事；
 *   所有「能不能」「该多少钱」的问题都在 core 里已经答完了。
 */

import {
  ACTOR_DOLL,
  ACTOR_PLACE,
  SPECIAL_ACTOR_BASE,
  SPECIAL_ACTOR_COUNT,
  type GameState,
  type SpecialActor,
} from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import { framesFor, tweenTickCount } from './tween.ts';
import type { MapNode, Rich4Map } from '@rich4/core';
import { VIEW_CENTER, VIEW_COUNT, VIEW_SPAN, projectCell, projectWorld } from '@rich4/data';
import type { Sprite, SpriteCache } from './assets.ts';
import {
  DECOR_RESOURCE,
  EMPTY_LAND_LOGO_RESOURCE,
  buildingImageIndex,
  buildingResource,
  chainStoreResource,
  TOOLBAR_ICON_COUNT,
  TOOLBAR_RESOURCE,
  TOOLBAR_STRIP_IMAGE,
  decorImageIndex,
  facilitySheetBase,
  facilitySlot,
  sceneryResource,
  toolbarIconImage,
  characterSetBase,
  CHARACTER_POSE,
  directionalImage,
  screenDirection,
} from './assets.ts';

/**
 * 顶部工具栏的摆位 —— **等距 40，从 x=0 起铺满 440**。
 *
 * ## 出处（这是唯一一处能定的地方）
 *
 * `fcn_00415d31`（VA 0x00415d31）既画工具栏也画底条：
 * ```asm
 * 00415d6x  blit_rect(dst, 图 0 = res1 的 439×40 底条, 0, 0)
 * 00415d81  mov eax, ebx          ; ebx = 图标号 0..10
 *           shl eax, 2  / add eax, ebx / shl eax, 3    ; eax = i*40
 *           add eax, 0x14        ; ★ 画点 x = i*40 + 20
 * 00415dc5  push 0x14            ; ★ 画点 y = 20（常态与高亮**同一个 y**）
 *           lea edx, [ebx + 1]  ; 图号 = i + 1        （i+12 是悬停高亮那一版）
 *           call fcn_00456418   ; 带锚点的绘制：落点 = 画点 − 图自带的 x/y
 * ```
 * 命中判据在 `loc_00418b0a`（WM_MOUSEMOVE）与 `loc_00418670`（WM_LBUTTONDOWN）：
 * ```asm
 * 00418b3x  mov ebx, 0x28          ; 40
 *           idiv ebx               ; ★ 按钮号 = x / 40
 * 00418b0a  cmp esi, 0x1b8         ; x >= 440 → 不在工具栏（440 起是側欄）
 *           cmp edx, 0x28          ; y >= 40  → 不在工具栏（40 以下是棋盘）
 * ```
 * 即 11 格 `[40i, 40i+40)`，**没有左边距、也不是 39 的间距**。
 *
 * ## 先前为什么错
 *
 * 之前是照底条图 439 宽反推的「`11×39 = 429`，两侧各留 5」——
 * 那是拿**底条**的宽度去凑**按钮格**，而原版的按钮格与底条图无关。
 * 后果正是需求方 2026-09-15 看到的：左边的图标偏右（i=0 我们画在 24.5，
 * 原版 20）、右边的偏左（i=10 我们 414.5，原版 420），**越靠边歪得越多**。
 * 同一张等距表也管命中，所以点击区一并归位。
 */
export const TOOLBAR = { x: 0, y: 0, pitch: 40, iconX: 20, iconY: 20, height: 40 } as const;

/** 工具栏的右缘（不含）—— 440 起是側欄 @source `cmp esi, 0x1b8` */
export const TOOLBAR_RIGHT = TOOLBAR.pitch * TOOLBAR_ICON_COUNT;

/** 第 i 个图标要画的**锚点**（原版 `fcn_00456418` 会减掉图自带的 x/y） */
export function toolbarIconAt(i: number): { x: number; y: number } {
  return { x: TOOLBAR.x + i * TOOLBAR.pitch + TOOLBAR.iconX, y: TOOLBAR.y + TOOLBAR.iconY };
}

/** 点在工具栏的第几个按钮上；没点中返回 null @source `idiv 0x28` @ 0x00418b3x */
export function hitToolbar(sx: number, sy: number): number | null {
  if (sy < TOOLBAR.y || sy >= TOOLBAR.y + TOOLBAR.height) return null;
  const i = Math.floor((sx - TOOLBAR.x) / TOOLBAR.pitch);
  return i >= 0 && i < TOOLBAR_ICON_COUNT ? i : null;
}

/**
 * 某个玩家（1 基）的**角色专属色** —— 用于地产/企业外圈那圈归属线。
 *
 * @source VA 0x0040987d 读的是 `player[owner-1].+0x04`，而该字段开局从角色表的
 *   `color` 拷入（`@rich4/data` 的 `CHARACTERS[i].color`，如約翰喬 0x946126）。
 */
function characterColor(state: GameState, owner: number): readonly [number, number, number] {
  const character = state.players[owner - 1]?.character ?? -1;
  const c = character >= 0 ? CHARACTERS[character]?.color : undefined;
  const v = c ?? 0xffffff;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** 玩家棋子的颜色——原版每人一色，此处先用可区分的四色占位 */
const PLAYER_COLORS = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;

/**
 * 视角模式。
 *
 * ★ 原版有两种看法，小地图上方那两个按钮就是切它们：
 * - `character` **人物视角**：等距投影、跟着棋子走，是主要的游戏画面。
 *   摄像机恒在 29×29 窗口的正中一格，投影查 `@rich4/data` 的投影表。
 * - `map` **地图视角**：把整张底图平铺出来俯瞰。底图本身就是这个朝向
 *   （2304 见方的正射图），故这一模式不查表，直接缩放平铺。
 */
export type ViewMode = 'character' | 'map';

export interface Camera {
  /** 地图视角用：视口左上角对应的地图坐标 */
  x: number;
  y: number;
  scale: number;
  /** 当前模式 */
  mode: ViewMode;
  /**
   * 视角编号 0..7，每步 45°。
   * @source 原版全局 `[0x499088]`，开局清零
   */
  view: number;
  /** 人物视角用：摄像机所在的**块**坐标（世界坐标 >> 5） */
  tileX: number;
  tileY: number;
}

export interface RenderInput {
  map: Rich4Map;
  state: GameState;
  camera: Camera;
  /** 鼠标悬停的节点号，null 表示没有 */
  hoverNode: number | null;
  /** 原版底图（map.mkf 偶数号资源解出来的 .gnd） */
  ground?: ImageBitmap | null;
  groundOffset?: { x: number; y: number };
  /**
   * 强制角色摆哪一组图（`CHARACTER_POSE` 的值）；不给就按 phase 推。
   *
   * ★ 掷骰那一段原版把 state 设成「掷骰」，角色一直摆**手持骰子**那一组
   *   （`fcn_0040d7c4` state 2 → `0x498ec4`），直到滚骰 + 500 ms 定格走完、
   *   状态切成「走子」为止。`state.phase` 在掷骰时会先变成 `moving`，
   *   故这里必须能盖过去。
   */
  characterPose?: number | null;
  /**
   * 棋盘区的尺寸。
   *
   * ★ 必须显式给出，**不能再从画布尺寸推**：原版的棋盘区是固定的
   *   439×440（见 stage.ts 的 LAYOUT.board），而画布现在是整个窗口。
   *   照画布算，一屏里会塞进远超原版的格子数，视角与取景全错。
   */
  viewport: { w: number; h: number };
  /**
   * 四大惡人／機器娃娃这一趟各自走过的格子（T-047）。
   *
   * ★ core 一次动作里就把整趟走完、`path` 没落进 state（见 `ActorWalk`），
   *   所以**只有宿主能把这份路径喂进来**；不给时渲染器退化成
   *   「只补 `state.lastNodeId → state.nodeId` 这最后一格」。
   *   同一趟重复提供不会重播（按「落点节点变了」判新趟）。
   */
  actorWalks?: readonly ActorWalk[];
  /**
   * 「動畫過程」开着吗（原版设定）。关掉就不播补间、直接落格心；
   * 不给按**开**处理（原版默认是开）。
   */
  animation?: boolean;
  /**
   * 一个 tick 多少毫秒（见 `tick.ts`）。不给按 20（每一帧都 tick）。
   * 替身补间只在这里用；玩家那条由 `startWalk()` 的入参给。
   */
  tickMs?: number;
  /**
   * 当前行动者（原版 `[0x49910c]`）—— 替身在行动时是 4..8。
   * 只影响绘制槽的类别（同屏幕 Y 时压在上面），不给就当没有替身在行动。
   */
  currentActor?: number | null;
}

/**
 * 世界坐标 → 屏幕坐标。
 *
 * 人物视角走原版的投影表（见 @rich4/data 的 projection.ts），
 * 返回的是相对**屏幕中心**的偏移，故要加上视口中心；
 * 越出 29×29 窗口时返回 null，与原版一样直接不画。
 *
 * 地图视角则是简单的平移缩放——底图本身就是正射的。
 */
export function worldToScreen(
  x: number,
  y: number,
  cam: Camera,
  viewport: { w: number; h: number },
): { x: number; y: number } | null {
  if (cam.mode === 'map') {
    return { x: (x - cam.x) * cam.scale, y: (y - cam.y) * cam.scale };
  }
  const p = projectWorld(cam.view, x, y, cam.tileX, cam.tileY);
  if (p === null) return null;
  return { x: viewport.w / 2 + p.x, y: viewport.h / 2 + p.y };
}

/** 兼容旧调用：地图节点的屏幕坐标（地图视角的平移缩放） */
export function nodeToScreen(node: MapNode, cam: Camera): { x: number; y: number } {
  return {
    x: (node.x - cam.x) * cam.scale,
    y: (node.y - cam.y) * cam.scale,
  };
}

/** 把屏幕坐标反算回地图坐标——拾取用 */
export function screenToMap(sx: number, sy: number, cam: Camera): { x: number; y: number } {
  return { x: sx / cam.scale + cam.x, y: sy / cam.scale + cam.y };
}

/**
 * 找出离给定**地图坐标**最近的节点。
 *
 * ⚠️ 它只认地图坐标 —— 要从鼠标位置拾取请用 `pickNodeAt`，
 *   那个两种视角都对。这个留着是给小地图之类已经在地图坐标里的调用方。
 *
 * ⚠️ 原版的拾取是像素级的（窗口过程里按精灵 alpha 命中测试），
 * 这里先用「最近且在阈值内」近似。等精灵锚点全部验证过之后可以换成
 * 真正的命中测试；先用近似是为了让棋盘尽早能点。
 */
export function pickNode(
  map: Rich4Map,
  mx: number,
  my: number,
  radius = 24,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (const n of map.nodes) {
    const dx = n.x - mx;
    const dy = n.y - my;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = n.id;
    }
  }
  return best;
}

/** 地图整体的包围盒——用于初始化相机 */
export function mapBounds(map: Rich4Map): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of map.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 地图视角：让整张地图恰好装进视口 */
export function fitCamera(map: Rich4Map, viewW: number, viewH: number): Camera {
  const b = mapBounds(map);
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const margin = 40;
  const scale = Math.min((viewW - margin) / w, (viewH - margin) / h);
  return {
    x: b.minX - margin / 2 / scale,
    y: b.minY - margin / 2 / scale,
    scale,
    mode: 'map',
    view: 0,
    tileX: 0,
    tileY: 0,
  };
}

/** 人物视角：摄像机落在某个世界坐标所在的块上 */
export function characterCamera(x: number, y: number, view = 0): Camera {
  return { x: 0, y: 0, scale: 1, mode: 'character', view: view % VIEW_COUNT, tileX: x >> 5, tileY: y >> 5 };
}

/**
 * 绘制槽的**类别** —— 排序键的低 4 位。
 *
 * @source `fcn_0040829d`（VA 0x0040829d）构建绘制槽清单时，
 *   排序键写成 `(屏幕Y & 0xfff) << 4 | 类别`；建筑那一段不 or（= 0），
 *   玩家那一段 `cmp ebx,[0x49910c]` 决定 0xc/0xd，梦游标记 0xe/0xf。
 */
export const DRAW_CLASS = {
  /**
   * 建筑（住宅/设施/企业/景观）与地面物件：原版这一段**不 or**，低 4 位就是 0。
   * ⇒ 与玩家同屏幕 Y 时，建筑先画、人物后画（人物盖住建筑）。
   */
  building: 0x0,
  /** 玩家棋子：非当前玩家 */
  player: 0xc,
  /** 玩家棋子：当前玩家 —— 同 Y 时压在别人上面，免得看不见轮到谁 */
  currentPlayer: 0xd,
  /**
   * 四大惡人／機器娃娃的棋子：**非**当前行动者。
   *
   * @source `loc_00408928`（`fcn_0040829d` 里替身那一段的 `jne` 分支）
   * ```asm
   * 0040…  cmp eax, [_rich4_current_player]
   *        jne loc_00408928
   *        or  byte [esi + 0x48a44c], 0xd     ; 当前行动者（与玩家同一个 0xd）
   * loc_00408928:
   *        or  byte [esi + 0x48a44c], 8       ; ★ 其余替身是 0x8，**不是玩家的 0xc**
   * ```
   * ⇒ 同屏幕 Y 时替身排在玩家**下面**（0x8 < 0xc）。
   */
  npc: 0x8,
} as const;

/**
 * 原版绘制槽的排序键。
 *
 * @source VA 0x004097cf 起：
 * ```asm
 * edx = 屏幕Y ; shl edx,4 ; and edx,0xfff0   ; 屏幕 Y 的低 12 位左移 4，低 4 位留给类别
 * add edx, 槽号<<16                           ; 高 16 位记槽号，排序后 shr 16 取回
 * or  byte [..], 类别
 * qsort(0x48a44c, 槽数, 4, _compare_int16_lt) ; VA 0x004079f9：只比**低 16 位有符号 int16**
 * ```
 * ⇒ **按屏幕 Y 升序**（等距视角的画家顺序），同 Y 时按类别分先后。
 *
 * ⚠️ 不是按世界 y 排：带视角旋转与透视时，屏幕 Y 与世界 y 的序**不等价**。
 */
export function drawKey(screenY: number, klass: number): number {
  const v = (((screenY & 0xfff) << 4) | klass) & 0xffff;
  return v >= 0x8000 ? v - 0x10000 : v; // 原版按 int16 比
}

// ============================================================
//  四大惡人 / 機器娃娃的棋子与走子（T-047）
// ============================================================

/**
 * 四個 NPC（actor 4..7）的图组基号 —— **站姿 = 基号，走姿 = 基号 + 1**。
 *
 * @source `_rich4_update_player_sprite` 的 actor ≥ 4 分支（VA 0x0040bd4c）：
 * ```asm
 * 0040bd43  cmp esi, 8
 * 0040bd46  jge 0x40bf02                     ; ★ actor 8（機器娃娃）资源写死，另算
 * 0040bd4c  mov edi, esi
 * 0040bd4e  shl edi, 2
 * 0040bd51  add edi, 0x16c                   ; ★ edi = 0x16c + actor×4
 * 0040be7a  … read_mkf(data, edi)     → [0x498eb4]   ; 站姿（pose 0 / slot 0）
 * 0040be94  … read_mkf(data, edi + 1) → [0x498ebc]   ; 走姿（pose 1 / slot 0）
 * ```
 * ⇒ actor 4/5/6/7 = `Data.mkf` 资源 **380 / 384 / 388 / 392**，与
 * `NPC_NAMES` 同序（小偷 / 強盜 / 流氓 / 間諜）。目视核过解出的图：
 * 380 紫衣小偷、384 大漢、388 綠髮流氓、392 光頭間諜。
 * 每组的站姿图都是 **8 张（8 向各 1 帧）**、走姿图是 8 向 × N 帧，正好对上
 * 绘制那边 `图数 >> 3 = 每向帧数` 的算法（见 `directionalImage`）。
 *
 * ⚠️ 每组还有 `+2`（載具）与 `+3`（夢遊用的走姿）两张变体，本引擎的
 *   `SpecialActor` 里没有对应的状态字段（原版是 `+12/+13` 两个天数计数器），
 *   故不接 —— 见 `docs/deviations/T-047.md`。
 */
export const SPECIAL_ACTOR_SPRITE_BASE = 0x16c;

/**
 * 機器娃娃（actor 8）的**站姿**图 —— 资源写死，不与基号连号。
 * @source VA 0x0040bf02 起（`cmp esi, 8 / jge 0x40bf02`）：
 *   `0x0040bf37 push 0x209 → read_mkf(data) → [0x498eb4]`（8 张 = 8 向各 1 帧）
 */
export const DOLL_STAND_RESOURCE = 0x209;

/**
 * 機器娃娃（actor 8）的**走姿**图。
 * @source VA 0x0040bf55 `push 0x20a → read_mkf(data) → [0x498ebc]`
 *   （40 张 = 8 向 × 5 帧）
 */
export const DOLL_WALK_RESOURCE = 0x20a;

/**
 * 替身（actor 4..8）某个姿态用 `Data.mkf` 里的哪一组图。
 *
 * @param walking 原版 `[0x498ea2]`：0 = 站、1 = 走（`fcn_0040dd1f` 起步时置 1，
 *   停留（`+14 != 0`）那一支置 0）
 * @returns 资源号；**不是替身**（玩家 0..3、越界）返回 null
 */
export function specialActorImageSet(actor: number, walking: boolean): number | null {
  // @source VA 0x0040bd51：edi = actor×4 + 0x16c
  if (actor >= SPECIAL_ACTOR_BASE && actor < ACTOR_DOLL) {
    return SPECIAL_ACTOR_SPRITE_BASE + actor * 4 + (walking ? 1 : 0);
  }
  // @source VA 0x0040bf02：actor ≥ 8 那一支资源写死
  if (actor === ACTOR_DOLL) return walking ? DOLL_WALK_RESOURCE : DOLL_STAND_RESOURCE;
  return null;
}

/**
 * 一个替身**这一趟**走过的格子 —— `runNpc` / `runDoll` 的 `path` 原样（含起点）。
 *
 * ★ 为什么由宿主喂进来：core 在一次动作里就把整趟走完（`reduce.ts` 的 `npcRound`
 *   与 `bail` 两处），`NpcWalk.path` 只回给调用方、**没落进 state**，所以渲染器
 *   事后无法还原中间格（岔路是 `rand()` 选的，见 `pickNextNode`）。
 *   原版是逐格 tick 播的，要 1:1 就得把这份路径交给渲染器。
 */
export interface ActorWalk {
  /** 替身下标 = actor − 4（0..4；0..3 = 四大惡人，4 = 機器娃娃） */
  slot: number;
  /** 依次经过的节点号，含起点；`path[i] → path[i+1]` 是第 i 格 */
  path: readonly number[];
}

/** 替身补间里的一格（世界坐标端点 + 时长） */
export interface ActorWalkStep {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 这一格要播几个 tick @source VA 0x0040c5e6 */
  ticks: number;
  /** 整趟里、这一格开始前已经过去的 tick 数（帧号要跨格连算） */
  tickAt: number;
  /** 这一格从整趟开始算起多少毫秒 */
  at: number;
  /** 这一格播多少毫秒 = `ticks × tickMs` */
  ms: number;
}

/**
 * 把一串节点摊成「一格一条」的补间。
 *
 * ★ **替身一律走 `dist × 0.125` 那一支** —— 与玩家不同，他们没有交通方式，
 *   原版在这里根本不查速度表：
 * @source VA 0x0040c5dd..0x0040c659（`fcn_0040c05c` 的 actor ≥ 4 分支，
 *   入口是 `0040c06f cmp ecx,4 / jge 0x40c489`）：
 * ```asm
 * 0040c5dd  call fsqrt
 * 0040c5e2  fst  dword [esp+0xc]       ; dist = sqrt(dx² + dy²)（屏幕距离）
 * 0040c5e6  fmul dword [0x4631dc]      ; ★ dist × 0.125f —— **无条件**，没有 fdivr 那一支
 * 0040c5ec  fstp dword [esp+0x1c]      ; N_f
 * 0040c650  fld N_f / call 0x457dbc    ; 向零截断 → [0x4749dc]
 * ```
 *   即 `tweenTickCount(dx, dy, 0, /*special*\/ true)` —— 与玩家「乘骑/被抬走」同一条。
 *
 * @param nodes 地图节点表（下标 = 节点号 − 1）
 * @param toScreen 世界坐标 → 屏幕坐标（tick 数按**屏幕**距离算，与 exe 同）
 */
export function actorWalkSteps(
  path: readonly number[],
  nodes: readonly MapNode[],
  toScreen: (x: number, y: number) => { x: number; y: number } | null,
  tickMs: number,
): ActorWalkStep[] {
  const steps: ActorWalkStep[] = [];
  let at = 0;
  let tickAt = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = nodes[(path[i] ?? 0) - 1];
    const b = nodes[(path[i + 1] ?? 0) - 1];
    if (a === undefined || b === undefined) break;
    const sa = toScreen(a.x, a.y);
    const sb = toScreen(b.x, b.y);
    const ticks =
      sa === null || sb === null ? 1 : tweenTickCount(sb.x - sa.x, sb.y - sa.y, 0, true);
    const ms = ticks * tickMs;
    steps.push({ from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y }, ticks, tickAt, at, ms });
    at += ms;
    tickAt += ticks;
  }
  return steps;
}

/** 一整趟补间要播多久（毫秒）—— 空串返回 0 */
export function actorWalkTotalMs(steps: readonly ActorWalkStep[]): number {
  const last = steps[steps.length - 1];
  return last === undefined ? 0 : last.at + last.ms;
}

/**
 * 一个替身这一帧**该怎么画** —— 纯数据，`draw()` 拿它去做 IO。
 *
 * 位置给的是**格心**（世界坐标）：在播补间时由 `BoardRenderer` 换成插值点，
 * 所以这里不管补间。
 */
export interface ActorToken {
  /** 替身下标 = actor − 4（0..4） */
  slot: number;
  /** actor 号（4..8） */
  actor: number;
  nodeId: number;
  /** 所在节点的世界坐标 */
  x: number;
  y: number;
  /** `Data.mkf` 图组资源号（站姿或走姿） */
  resource: number;
  /** 屏幕朝向 0..7 —— 已含视角旋转 */
  screenDir: number;
  /** 走路帧号 @source `[0x498ea3 + actor×0x34]`；站姿恒 0 */
  frame: number;
  /** 这一帧用走姿图组吗 */
  walking: boolean;
  /** 绘制槽类别：当前行动者 0xd，其余 0x8 */
  klass: number;
}

export interface ActorTokenOptions {
  /** 视角 0..7 @source 全局 `[0x499088]` */
  view: number;
  /** 这个槽这一帧在不在播补间（决定站/走姿） */
  walking?: (slot: number) => boolean;
  /** 这个槽的走路帧号 */
  frame?: (slot: number) => number;
  /** 当前行动者（原版 `[0x49910c]`，替身时是 4..8）；没有替身在行动就传 null */
  currentActor?: number | null;
}

/** 「不在棋盘上」的落点哨兵 —— 节点号从 1 起，故 0 不会与任何节点相撞 */
export const ACTOR_OFF_BOARD = 0;

/**
 * 「这一帧该给哪些替身起补间」—— **纯函数**（`state.specialActors` → 该起哪些补间）。
 *
 * 判据是**落点节点变了**：只有换了落点才可能刚走过一趟。
 * - `seen` 记上一次画出来的落点（`0` = 当时不在棋盘上）；
 * - 宿主喂了 `supplied` 就用那个整趟路径（**1:1**）；
 * - 没喂时只有 `lastNodeId → nodeId` 这最后一格能从 state 推出来 ——
 *   **中间格 core 没留下**（`NpcWalk.path` 不落 state，岔路又是 `rand()` 选的）。
 *
 * ★ 「被保釋出来」那一步也能测到：在監獄时 `seen = 0`，一上路落点就变成节点号。
 * ★ 首帧（`seen` 里根本没有这个槽 = 進遊戲／讀檔）只记账不播，免得一读档全体滑一段；
 *   但宿主**明确喂了路径**时照播 —— 那一定是一趟真的刚发生的走子。
 */
export function actorWalkTriggers(
  actors: readonly SpecialActor[],
  seen: ReadonlyMap<number, number>,
  supplied?: readonly ActorWalk[],
): { walks: ActorWalk[]; seen: Map<number, number> } {
  const bySlot = new Map<number, readonly number[]>();
  for (const w of supplied ?? []) bySlot.set(w.slot, w.path);
  const walks: ActorWalk[] = [];
  const next = new Map<number, number>();
  for (let slot = 0; slot < SPECIAL_ACTOR_COUNT; slot++) {
    const a = actors[slot];
    const path = bySlot.get(slot);
    // ★ 「在不在盘上」**不能**先于 `supplied` 判 —— 有两趟走完的人已经不在盘上了：
    //   ① 機器娃娃 `runDoll` 走完就 `idleActor()`（state 里 `nodeId=0 / place=offBoard`）；
    //   ② 惡人半路踩回監獄／醫院（`place = 監獄/醫院`）。
    //   先判在盘上会把宿主喂来的整趟路径整条跳过（D-T047-6，实测起 0 条补间）。
    if (a === undefined || a.place !== ACTOR_PLACE.board || a.nodeId <= 0) {
      // 落点记账用**路径末格**，这样同一份 `supplied` 不会每帧重播。
      const endsAt = path === undefined ? ACTOR_OFF_BOARD : (path[path.length - 1] ?? ACTOR_OFF_BOARD);
      next.set(slot, endsAt);
      if (path !== undefined && path.length >= 2 && seen.get(slot) !== endsAt) {
        walks.push({ slot, path });
      }
      continue;
    }
    const endsAt = path === undefined ? a.nodeId : (path[path.length - 1] ?? a.nodeId);
    const last = seen.get(slot);
    next.set(slot, endsAt);
    if (last === endsAt) continue; // 没换落点 = 还是同一趟
    if (last === undefined && path === undefined) continue; // 首帧：不播
    if (path !== undefined) {
      walks.push({ slot, path });
    } else if (a.lastNodeId > 0 && a.lastNodeId !== a.nodeId) {
      walks.push({ slot, path: [a.lastNodeId, a.nodeId] });
    }
  }
  return { walks, seen: next };
}

/**
 * `state` → 「棋盘上该画哪些替身、各画哪张图」的映射。**纯函数**，单测直接钉。
 *
 * @source `fcn_0040829d` 的替身那一段（VA 0x00408b82 起）：
 * ```asm
 * 00408…  cmp byte [edi + 0x498e32], 0    ; +10 place
 *         jne 跳过                         ; ★ 只有在場（place == 0）才画
 * 0040…   mov ax, word [edi + 0x498e28]   ; +0 x
 *         mov dx, word [edi + 0x498e2a]   ; +2 y
 * 0040…   mov dl, byte [edi + 0x498e31]   ; +9 direction
 *         （屏幕朝向 = (direction + 8 − 视角) & 7）
 * 0040…   mov eax, [slot 的图 + 4] / sar eax, 3   ; 每向帧数 = 图数 >> 3
 *         mul byte [esp + 0x54]             ; × 屏幕朝向
 *         add al, byte [ebp + 0x498ea3]     ; + 走路帧号
 * ```
 */
export function actorTokens(
  state: GameState,
  nodes: readonly MapNode[],
  opts: ActorTokenOptions,
): ActorToken[] {
  const walkingOf = opts.walking ?? ((): boolean => false);
  const frameOf = opts.frame ?? ((): number => 0);
  const current = opts.currentActor ?? null;
  const out: ActorToken[] = [];
  for (let slot = 0; slot < SPECIAL_ACTOR_COUNT; slot++) {
    const a = state.specialActors[slot];
    // @source VA 0x00408b82：`cmp byte [rec + 10], 0 / jne 跳过`
    if (a === undefined || a.place !== ACTOR_PLACE.board) continue;
    const node = nodes[a.nodeId - 1];
    if (node === undefined) continue;
    const actor = SPECIAL_ACTOR_BASE + slot;
    const walking = walkingOf(slot);
    const resource = specialActorImageSet(actor, walking);
    if (resource === null) continue;
    out.push({
      slot,
      actor,
      nodeId: a.nodeId,
      x: node.x,
      y: node.y,
      resource,
      screenDir: screenDirection(a.direction, opts.view),
      frame: walking ? frameOf(slot) : 0,
      walking,
      klass: current === actor ? DRAW_CLASS.currentPlayer : DRAW_CLASS.npc,
    });
  }
  return out;
}

/** 一条待画的绘制槽：先按 `key` 排序，再依次 `paint` */
interface DrawSlot {
  key: number;
  paint: () => void;
}

export class BoardRenderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  /** 已请求但尚未解码完成的精灵——避免同一帧内重复发起 */
  readonly #pending = new Set<string>();
  #ready = new Map<string, Sprite | null>();
  /** 有新精灵解码完成时置位，驱动下一帧重绘 */
  #dirty = false;
  /**
   * 行走动画的帧号 —— **一次 tick 进一帧**，走满一轮（每向帧数）回零。
   *
   * @source `fcn_0040c05c` 尾部 VA 0x0040c751：
   * ```asm
   * inc byte [0x498ea3 + 玩家号*0x34]      ; ★ 每 tick 一帧，不是每格一帧
   * frames = (player.sprites[1][slot] → [+4]) >> 3
   * if ([0x498ea3] == frames) [0x498ea3] = 0
   * ```
   * ⚠️ 原版每个玩家各有一份（`[0x498ea3 + player*0x34]`），本引擎先共用一个
   *   计数器：同一时刻只有一个人在走，看不出差别。
   */
  #walkFrame = 0;
  /**
   * 正在播的走子补间 —— 世界坐标的起终点 + 起始时刻 + 这一格几个 tick。
   * ★ 纯表现：不进 state，丢了只是少一段平滑（C-DET-4）。
   */
  #walk: {
    player: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
    /** 这一格要播几个 tick（@source `fcn_0040c05c` 的 `N`） */
    ticks: number;
    /** 一个 tick 多少毫秒（见 `tick.ts`） */
    tickMs: number;
    start: number;
    /** 已经推过几次「走路帧」——渲染一帧可能跨多个 tick */
    ticked: number;
  } | null = null;
  /**
   * 正在播的替身走子补间 —— **一个替身一条、一条串多格**（T-047）。
   *
   * ★ 与玩家那条分开：原版的走路帧计数器每个替身各一份
   *   （`[0x498ea3 + actor×0x34]`），而且一趟是逐格 tick 串播的
   *   （`fcn_0040c05c` 的 actor ≥ 4 分支，VA 0x0040c489）。
   *   ★ 纯表现，不进 state（C-DET-4）；丢了只是少一段平滑。
   */
  readonly #actorWalks = new Map<
    number,
    { steps: ActorWalkStep[]; start: number; tickMs: number; ticked: number }
  >();
  /**
   * 替身的走路帧号（原始 tick 数，用的时候对「每向帧数」取模）。
   * @source `fcn_0040c05c` 尾部 VA 0x0040c751：
   * ```asm
   * inc byte [0x498ea3 + actor×0x34]        ; ★ 每 tick 一帧
   * sprite = 走姿图[slot] ; frames = [sprite + 4] >> 3
   * if ([0x498ea3] == frames) [0x498ea3] = 0
   * ```
   * 取模与 exe 等价（`directionalImage` 里 `frame % 每向帧数`），故这里只累加。
   */
  readonly #actorFrame = new Map<number, number>();
  /**
   * 上一次画出来的替身节点号 —— 用来察觉 `nodeId` 跳变。
   * 宿主没喂 `actorWalks` 时，只有这个变化能告诉我们「他刚走过」。
   */
  readonly #actorSeen = new Map<number, number>();
  /**
   * 解码落地时叫一声。
   *
   * ⚠️ 光有 `#dirty` 不够：解码几乎总是在本帧的 rAF 回调**之后**才 resolve，
   *   那时已经没人再去看这个标志了 —— 画面就永远停在「图还没到」的那一帧。
   *   （工具栏底条整条不显示，正是这么来的。）
   */
  #onReady: (() => void) | null = null;

  constructor(ctx: CanvasRenderingContext2D, sprites: SpriteCache) {
    this.#ctx = ctx;
    this.#sprites = sprites;
  }

  /** 由宿主注入「再画一帧」 */
  set onSpriteReady(fn: () => void) {
    this.#onReady = fn;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  clearDirty(): void {
    this.#dirty = false;
  }

  /** 画出节点连线与落点菱形 —— **调试用**，原版没有 */
  debugNodes = false;

  /** 推进一帧行走动画 —— **一次 tick 调一次**（不是一格一次） */
  advanceWalk(steps = 1): void {
    this.#walkFrame = (this.#walkFrame + steps) & 0xff;
  }

  /**
   * 开始播一步的补间（世界坐标起终点）。
   *
   * @source `fcn_0040c05c`：tick 数 = `trunc(屏幕距离 / 走子速度)`，
   *   线性等分、**一个 tick 一帧**（细节与出处见 `tween.ts`）。
   *   ★ 「動畫過程」关掉时原版根本不播 —— 这里用 `enabled` 表达同一件事。
   *
   * tick 数按**屏幕**距离算，故要传当前的镜头与视口（都来自调用方）。
   *
   * @param traffic 交通方式（0 走路 / 1 機車 / 2 汽車 / 3 船）→ 速度 [8,12,16,8] 像素/tick
   * @param special 原版 `slot != 0 || (player.flags & 0x30)` 那一支
   * @param tickMs  一个 tick 多少毫秒（见 `tick.ts`）
   */
  startWalk(
    player: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    enabled: boolean,
    camera: Camera,
    vp: { w: number; h: number },
    traffic = 0,
    special = false,
    tickMs = 20,
    now = performance.now(),
  ): void {
    if (!enabled) {
      this.#walk = null;
      return;
    }
    const a = worldToScreen(from.x, from.y, camera, vp);
    const b = worldToScreen(to.x, to.y, camera, vp);
    const ticks =
      a === null || b === null ? 1 : tweenTickCount(b.x - a.x, b.y - a.y, traffic, special);
    this.#walk = { player, from, to, ticks, tickMs, start: now, ticked: 0 };
    this.#dirty = true;
  }

  /** 这一步的补间播完了吗（没有补间也算播完） */
  walkDone(now = performance.now()): boolean {
    const w = this.#walk;
    const player = w === null || now - w.start >= w.ticks * w.tickMs;
    // ★ 替身那条也算进来（T-047）：他们那一趟同样要逐帧重绘，否则画面冻住
    return player && this.actorWalkDone(now);
  }

  /** 丢掉没播完的补间（读档、换屏时用） */
  cancelWalk(): void {
    this.#walk = null;
  }

  /** 上一条补间要播多久（毫秒）—— 宿主拿它当走一步的节拍 */
  lastWalkMs(): number {
    const w = this.#walk;
    return w === null ? 0 : w.ticks * w.tickMs;
  }

  // ── 替身（四大惡人 / 機器娃娃）的走子补间 ──────────────────────────

  /**
   * 替身这一趟补间**还剩**多久（毫秒）—— 宿主拿它当「等替身走完」的节拍。
   *
   * ⚠️ 与玩家那条不同：替身的整趟是在**一次** `dispatch` 里跑完的，
   *   而补间要等下一次 `draw()` 才起得来，所以 `lastWalkMs()` 帮不上忙 ——
   *   宿主得在 dispatch **之后**再问这个（见 `docs/deviations/T-047.md`）。
   */
  actorWalkRemainingMs(now = performance.now()): number {
    let best = 0;
    for (const w of this.#actorWalks.values()) {
      const left = actorWalkTotalMs(w.steps) - (now - w.start);
      if (left > best) best = left;
    }
    return best;
  }

  /** 替身补间还在播吗（一条都没有也算播完） */
  actorWalkDone(now = performance.now()): boolean {
    let running = false;
    for (const [slot, w] of [...this.#actorWalks]) {
      if (now - w.start >= actorWalkTotalMs(w.steps)) this.#actorWalks.delete(slot);
      else running = true;
    }
    return !running;
  }

  /** 丢掉没播完的替身补间（读档、换屏时用） */
  cancelActorWalk(): void {
    this.#actorWalks.clear();
    this.#actorSeen.clear();
    this.#actorFrame.clear();
  }

  /**
   * 起一条替身补间 —— `path` 依次经过的节点号（含起点）。
   *
   * tick 数按**屏幕**距离算，且一律走 `dist × 0.125` 那一支
   * （见 `actorWalkSteps` 的出处）。
   */
  #beginActorWalk(
    slot: number,
    nodes: readonly MapNode[],
    path: readonly number[],
    enabled: boolean,
    camera: Camera,
    vp: { w: number; h: number },
    tickMs: number,
    now: number,
  ): void {
    this.#actorWalks.delete(slot);
    if (!enabled || path.length < 2) return;
    const steps = actorWalkSteps(path, nodes, (x, y) => worldToScreen(x, y, camera, vp), tickMs);
    if (steps.length === 0) return;
    this.#actorWalks.set(slot, { steps, start: now, tickMs, ticked: 0 });
    // @source VA 0x0040deed：起步（`fcn_0040dd1f` 尾）把走路帧清零
    this.#actorFrame.set(slot, 0);
    this.#dirty = true;
  }

  /**
   * 每帧同步一次「替身在哪儿 → 补间」。
   *
   * 判据全在纯函数 `actorWalkTriggers` 里（有单测），这里只负责起补间与换图。
   */
  #syncActorWalks(
    state: GameState,
    nodes: readonly MapNode[],
    camera: Camera,
    vp: { w: number; h: number },
    supplied: readonly ActorWalk[] | undefined,
    enabled: boolean,
    tickMs: number,
    now: number,
  ): void {
    const r = actorWalkTriggers(state.specialActors, this.#actorSeen, supplied);
    this.#actorSeen.clear();
    for (const [slot, nodeId] of r.seen) this.#actorSeen.set(slot, nodeId);
    // 不在棋盘上的槽：把没播完的补间收掉（他可能在半路被送回監獄／醫院）
    for (const [slot] of [...this.#actorWalks]) {
      if (r.seen.get(slot) === ACTOR_OFF_BOARD) this.#actorWalks.delete(slot);
    }
    for (const w of r.walks) {
      this.#beginActorWalk(w.slot, nodes, w.path, enabled, camera, vp, tickMs, now);
    }
  }

  /**
   * 替身补间这一帧画在**屏幕**的哪里；没有补间返回 null（调用方按格心画）。
   *
   * ★ 一格 = `N` 个 tick、一 tick 一帧，**走完整趟**共用同一份帧号
   *   （exe 的 `[0x498ea3]` 只在起步时清零）—— 故按「整趟已经过去的 tick 数」
   *   补齐，跨格连算。
   */
  #actorWalkScreen(
    slot: number,
    cam: Camera,
    vp: { w: number; h: number },
    now: number,
  ): { x: number; y: number } | null {
    const w = this.#actorWalks.get(slot);
    if (w === undefined) return null;
    const elapsed = now - w.start;
    if (elapsed >= actorWalkTotalMs(w.steps)) {
      this.#actorWalks.delete(slot);
      return null;
    }
    let step = w.steps[w.steps.length - 1]!;
    for (const s of w.steps) {
      if (elapsed < s.at + s.ms) {
        step = s;
        break;
      }
    }
    const a = worldToScreen(step.from.x, step.from.y, cam, vp);
    const b = worldToScreen(step.to.x, step.to.y, cam, vp);
    if (a === null || b === null) return null;

    const k = Math.min(step.ticks, Math.floor((elapsed - step.at) / w.tickMs) + 1);
    const absolute = step.tickAt + k;
    if (absolute > w.ticked) {
      this.#actorFrame.set(slot, (this.#actorFrame.get(slot) ?? 0) + (absolute - w.ticked));
      w.ticked = absolute;
    }
    return framesFor(a, b, step.ticks)[k - 1] ?? null;
  }

  /**
   * 走子补间这一帧该画在**屏幕**的哪里；没有补间返回 null（调用方按格心画）。
   *
   * ★ 插值走 `framesFor`（纯函数，`tween.ts` 里有单测）——**屏幕坐标**上插值，
   *   与 exe 一致（它就是把两个屏幕端点等分）。
   *
   * ★ 顺带把走路帧按**已经过去的 tick 数**补齐 —— 与 exe 一样，
   *   补间前进一 tick、走路帧就进一帧（`fcn_0040c05c` 同一处）。
   */
  #walkScreen(
    playerIndex: number,
    cam: Camera,
    vp: { w: number; h: number },
    now: number,
  ): { x: number; y: number } | null {
    const w = this.#walk;
    if (w === null || w.player !== playerIndex) return null;
    const a = worldToScreen(w.from.x, w.from.y, cam, vp);
    const b = worldToScreen(w.to.x, w.to.y, cam, vp);
    if (a === null || b === null) return null;

    const k = Math.min(w.ticks, Math.floor((now - w.start) / w.tickMs) + 1);
    if (k > w.ticked) {
      this.#walkFrame = (this.#walkFrame + (k - w.ticked)) & 0xff;
      w.ticked = k;
    }
    const frames = framesFor(a, b, w.ticks);
    return frames[k - 1] ?? null;
  }

  /** 某个资源里有几张图（同步，只解表头） */
  #imageCount(archive: 'Data.mkf' | 'Panel.mkf' | 'map.mkf' | 'jump.mkf', res: number): number {
    return this.#sprites.imageCount(archive, res);
  }

  /**
   * 同步取精灵；未就绪时返回 null 并在后台解码。
   *
   * 渲染是同步的而解码是异步的（createImageBitmap），故这里用
   * 「先画能画的，解码完再标脏重画」的策略，而不是让整帧等在 await 上。
   */
  #sprite(
    archive: 'Data.mkf' | 'Panel.mkf' | 'map.mkf' | 'jump.mkf',
    res: number,
    idx: number,
    colorKeyBlack = false,
    ring?: readonly [number, number, number],
  ): Sprite | null {
    const key = `${archive}:${res}:${idx}:${colorKeyBlack ? 'k' : ''}:${ring === undefined ? '' : ring.join(',')}`;
    const hit = this.#ready.get(key);
    if (hit !== undefined) return hit;
    if (!this.#pending.has(key)) {
      this.#pending.add(key);
      void this.#sprites.get(archive, res, idx, colorKeyBlack, ring).then((s) => {
        this.#ready.set(key, s);
        this.#pending.delete(key);
        this.#dirty = true;
        this.#onReady?.();
      });
    }
    return null;
  }

  /** 只画**棋盘区**。工具栏与側欄由舞台负责摆位（见 stage.ts）。 */
  draw(input: RenderInput): void {
    const { map, state, camera, hoverNode } = input;
    const ctx = this.#ctx;
    const width = input.viewport.w;
    const height = input.viewport.h;
    // 棋盘画进一块 1:1 的离屏画布，缩放交给舞台统一做
    const dpr = 1;

    ctx.fillStyle = '#0e1016';
    ctx.fillRect(0, 0, width, height);

    const ground = input.ground ?? null;
    if (ground !== null) {
      if (camera.mode === 'character') {
        this.#drawGroundProjected(ground, camera, { w: width, h: height }, dpr);
      } else {
        const off = input.groundOffset ?? { x: 0, y: 0 };
        ctx.drawImage(
          ground,
          (off.x - camera.x) * camera.scale,
          (off.y - camera.y) * camera.scale,
          ground.width * camera.scale,
          ground.height * camera.scale,
        );
        // 地图视角把底图压暗，让棋盘的连线与格子读得出来
        ctx.fillStyle = 'rgba(10,12,20,0.35)';
        ctx.fillRect(0, 0, width, height);
      }
    }

    const vp = { w: width, h: height };
    // ⚠️ 原版棋盘上**没有**连线，也没有标落点的菱形 —— 格子长什么样全靠
    //   底图与建筑图素本身。先前那两层是解地图时的调试辅助，留着就不是复刻了。
    //   仍然保留代码，`?debug=nodes` 时才画，排错时还用得上。
    if (this.debugNodes) this.#drawEdges(map, camera, vp);

    // ★★ 原版的三段式（`fcn_0040829d`，Q-DRAW-1）：
    //   ① 地砖（上面 #drawGroundProjected，直接贴底面，不排队）
    //   ② 节点装饰（`node.decorIndex` 非 0 的，直接贴 —— 恒在地砖之上、立体物之下）
    //   ③ **一条统一的绘制槽清单**：建筑、玩家棋子、梦游标记……全塞进同一条，
    //      按屏幕 Y 排完序再依次贴。
    //
    //   ⚠️ 别退回「先建筑后人物」两层：那样人物永远压在所有建筑上，
    //      高大建筑就再也挡不住从它背后走过的棋子了（需求方 2026-09-15 指出的症状）。
    this.#drawDecor(map, camera, vp);

    // ★ 替身（四大惡人／機器娃娃）的走子补间要先同步：它决定这一帧他们是「站」
    //   还是「走」、画在哪个插值点上。首帧只记账不播（见 `#syncActorWalks`）。
    const nowMs = performance.now();
    this.#syncActorWalks(
      state,
      map.nodes,
      camera,
      vp,
      input.actorWalks,
      input.animation ?? true,
      input.tickMs ?? 20,
      nowMs,
    );

    const slots: DrawSlot[] = [
      ...this.#buildingSlots(map, state, camera, vp),
      ...this.#playerSlots(map, state, camera, vp, input.characterPose ?? null),
      ...this.#actorSlots(map, state, camera, vp, input.currentActor ?? null, nowMs),
    ];
    // 原版用 qsort 比低 16 位 int16；这里用稳定排序，键相同时保持压入顺序（不影响观感）
    slots.sort((a, b) => a.key - b.key);
    for (const s of slots) s.paint();

    // 调试层画在清单之上（它只是排错用的参考图形，不该被建筑挡住）
    if (this.debugNodes) this.#drawNodes(map, state, camera, hoverNode, vp);
  }

  /**
   * 顶部工具栏 —— 画到**舞台**上，不是棋盘上。
   *
   * ⚠️ 必须显式收一个 ctx：渲染器自己那块 ctx 是**棋盘的离屏画布**
   *   （439×440，位于工具栏下方）。往那上面画工具栏，等于画进了棋盘里，
   *   而且还会被下一帧的棋盘绘制覆盖掉 —— 表现就是工具栏整条不见。
   */
  drawToolbarTo(ctx: CanvasRenderingContext2D, x: number, y: number, hot: number | null): void {
    const strip = this.#sprite('Panel.mkf', TOOLBAR_RESOURCE, TOOLBAR_STRIP_IMAGE);
    if (strip !== null) ctx.drawImage(strip.bitmap, x, y);
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      // ★ 图标是 SMP，黑色是抠图底色，不抠的话每个图标都顶着一块黑底
      const icon = this.#sprite(
        'Panel.mkf', TOOLBAR_RESOURCE, toolbarIconImage(i, hot === i), true,
      );
      if (icon === null) continue;
      // 原版是 `fcn_00456418`（带锚点）—— 落点 = 画点 − 图自带的 x/y
      const at = toolbarIconAt(i);
      ctx.drawImage(
        icon.bitmap,
        Math.round(x + at.x - icon.anchorX),
        Math.round(y + at.y - icon.anchorY),
      );
    }
  }

  /** 先画连线，让棋盘的走法一眼可见 */
  #drawEdges(map: Rich4Map, cam: Camera, vp: { w: number; h: number }): void {
    const ctx = this.#ctx;
    ctx.strokeStyle = 'rgba(150,200,255,0.28)';
    ctx.lineWidth = cam.mode === 'map' ? Math.max(1.5, cam.scale * 2.5) : 2;
    ctx.beginPath();
    for (const n of map.nodes) {
      const a = worldToScreen(n.x, n.y, cam, vp);
      if (a === null) continue;
      for (const adj of n.adjacent) {
        const m = map.nodes[adj - 1];
        if (m === undefined || m.id < n.id) continue; // 每条边只画一次
        const b = worldToScreen(m.x, m.y, cam, vp);
        if (b === null) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
  }


  /**
   * 人物视角下的底图 —— 逐块投影成四边形铺出来。
   *
   * @source 原版地面绘制 VA 0x00408480 起：每块取**投影表里相邻的四个表项**
   *   当四角（左上 = (行,列)、右上 = (行,列+1)、右下 = (行+1,列+1)、
   *   左下 = (行+1,列)），再把该块的 32×32 像素贴进这个四边形。
   *   相邻块共用角点，故铺出来无缝。
   *   块的取用同样经排布表：`layout[世界块Y*72 + 世界块X]`
   *   （`mov di, word [layoutTable + index*2]` / `shl esi, 0xa` 即 ×1024），
   *   这与 assets-pipeline 解出的格式完全吻合。
   *
   * ⚠️ **用仿射近似代替透视**：canvas 2D 没有透视变换，这里按三个角
   *   （左上/右上/左下）做仿射。实测第四角与原版表值最大差 **2 像素**
   *   （八个视角、全部 28×28 格里的最差值），肉眼不可辨。
   */
  #drawGroundProjected(
    ground: ImageBitmap,
    cam: Camera,
    vp: { w: number; h: number },
    dpr: number,
  ): void {
    const ctx = this.#ctx;
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    const tilesAcross = ground.width >> 5;
    const tilesDown = ground.height >> 5;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // 表是 29×29，取相邻角点故只能铺 28×28 格
    for (let row = 0; row < VIEW_SPAN - 1; row++) {
      for (let col = 0; col < VIEW_SPAN - 1; col++) {
        const tx = cam.tileX + col - VIEW_CENTER;
        const ty = cam.tileY + row - VIEW_CENTER;
        if (tx < 0 || ty < 0 || tx >= tilesAcross || ty >= tilesDown) continue;

        const tl = projectCell(cam.view, row, col);
        const tr = projectCell(cam.view, row, col + 1);
        const bl = projectCell(cam.view, row + 1, col);
        if (tl === null || tr === null || bl === null) continue;

        // 单位正方形 → 四边形的仿射；略微放大 2% 以盖住相邻块之间的接缝
        // ⚠️ setTransform 会**顶掉** ctx 上的 dpr 缩放，故这里自己乘回去
        ctx.setTransform(
          (tr.x - tl.x) * dpr,
          (tr.y - tl.y) * dpr,
          (bl.x - tl.x) * dpr,
          (bl.y - tl.y) * dpr,
          (cx + tl.x) * dpr,
          (cy + tl.y) * dpr,
        );
        ctx.drawImage(ground, tx * 32, ty * 32, 32, 32, -0.01, -0.01, 1.02, 1.02);
      }
    }
    ctx.restore();
  }

  /**
   * 特殊格的装饰图（PARK / NEWS / 命運 / BANK …）。
   *
   * 画在连线之上、节点之下：原版这些图就是铺在地上的，棋子踩在上面。
   */
  #drawDecor(map: Rich4Map, cam: Camera, vp: { w: number; h: number }): void {
    const ctx = this.#ctx;
    const k = cam.mode === 'map' ? cam.scale : 1;
    for (const n of map.nodes) {
      const idx = decorImageIndex(n.decorIndex);
      if (idx === null) continue;
      // ★ 装饰图是 SMP，靠抠掉纯黑来融进地面（见 assets-pipeline 的 DecodeOptions）
      const sp = this.#sprite('map.mkf', DECOR_RESOURCE, idx, true);
      if (sp === null) continue;
      const p = worldToScreen(n.x, n.y, cam, vp);
      if (p === null) continue;
      ctx.drawImage(
        sp.bitmap,
        p.x - sp.anchorX * k,
        p.y - sp.anchorY * k,
        sp.width * k,
        sp.height * k,
      );
    }
  }

  /**
   * 已开发地块上的建筑 —— 收成绘制槽交给调用方统一排序（见 `draw()` 的 ★★）。
   *
   * 资源号与图号的由来见 assets.ts 的 `buildingResource` / `buildingImageIndex`
   * ——都是从原版加载与绘制代码直接读出来的。
   *
   * ⚠️ 排序键是**屏幕 Y**（`drawKey`），不是世界 y。以前按世界 y 排，
   *   视角一转就对不上原版的画家顺序了。
   */
  #buildingSlots(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
  ): DrawSlot[] {
    const ctx = this.#ctx;
    /** 一件立体物：资源、图号、落点、可选的归属换色 */
    const items: {
      x: number;
      y: number;
      res: number;
      img: number;
      ring?: readonly [number, number, number];
    }[] = [];

    // ── 地块建筑 ──
    for (const n of map.nodes) {
      if (n.ref.kind !== 'land') continue;
      const landId = n.ref.index;
      const level = state.landLevel[landId] ?? 0;
      const owner = state.landOwner[landId] ?? 0;
      const land = map.lands.find((l) => l.id === landId);
      if (land === undefined) continue;

      // ★ 等级 0（还没盖房）但有主 → 画该**角色专属**的空地 logo，不画建筑。
      // @source VA 0x0040920f 的「等级 0」分支：无主不画；有主则用
      //   `[0x48aea8]`（= map.mkf 资源 25，见 rich4_load_map.asm:477）当图集、
      //   图号 = `player[owner-1].+0x13`（即 character）。
      if (level < 1) {
        if (owner === 0) continue; // 无主空地什么都不画
        const character = state.players[owner - 1]?.character ?? 0;
        items.push({
          x: land.x,
          y: land.y,
          res: EMPTY_LAND_LOGO_RESOURCE,
          img: character,
        });
        continue;
      }
      // @source cmp byte [land+0x18], 0 / jne → 连锁店走另一张图集
      const res =
        land.type !== 0
          ? chainStoreResource(state.globalMapId)
          : buildingResource(state.globalMapId, level);
      if (res === null) continue;
      // ★ 用**地块记录自己的 x/y**，不是所在节点的 —— 两者差一格。
      //   @source 地块绘制 VA 0x004090fc：`movsx eax, word [ebp]` / `movsx edx, word [ebp+2]`，
      //   而 `ebp` 指的是**地块记录**（+0x1b 取朝向、+0x1a 取等级，都在同一条记录上）。
      //   实测地图 1：node 39 (1463,239) 与 land 1 (1463,192) 是同一块地，
      //   y 差 47（约一格半），设施/企业/景观那三处本来就用的自己的坐标，只有地块这里不一致。
      // ★ 外圈那圈线按**所有者的角色专属色**换色（见 assets.ts 的 RING_PALETTE_INDEX）：
      //   @source VA 0x0040987d —— 绘制槽有归属时把 `player[owner-1].+0x04`（角色色）
      //   写进精灵的调色板 #255。无主则原样（占位色），但等级≥1 必有主。
      items.push({
        x: land.x,
        y: land.y,
        res,
        img: buildingImageIndex(land.facing, cam.view),
        ...(owner === 0 ? {} : { ring: characterColor(state, owner) }),
      });
    }

    // ── 设施（機場/港口…）──
    const gameStage = state.globalMapId >> 2;
    const gameMap = state.globalMapId & 3;
    const base = facilitySheetBase(gameStage, gameMap);
    for (const f of map.facilities) {
      items.push({
        x: f.x,
        y: f.y,
        res: base + facilitySlot(f.type, f.level),
        img: buildingImageIndex(f.facing, cam.view),
        ...(f.owner === 0 ? {} : { ring: characterColor(state, f.owner) }),
      });
    }

    // ── 上市企业与特殊景观：共用「索引 + 38」那套 ──
    for (const c of map.commercials) {
      const res = sceneryResource(c.spriteIndex);
      if (res !== null) {
        const co = state.commercialOwners[c.id - 1]?.owner ?? 0;
        items.push({ x: c.x, y: c.y, res, img: 0, ...(co === 0 ? {} : { ring: characterColor(state, co) }) });
      }
    }
    for (const l of map.landscapes) {
      const res = sceneryResource(l.spriteIndex);
      if (res !== null) items.push({ x: l.x, y: l.y, res, img: 0 });
    }

    const k = cam.mode === 'map' ? cam.scale : 1;
    const slots: DrawSlot[] = [];
    for (const it of items) {
      const p = worldToScreen(it.x, it.y, cam, vp);
      // 越出 29×29 窗口的格子原版直接跳过不画，这里保持一致
      if (p === null) continue;
      slots.push({
        key: drawKey(p.y, DRAW_CLASS.building),
        paint: () => {
          const sp = this.#sprite('map.mkf', it.res, it.img, true, it.ring);
          if (sp === null) return;
          ctx.drawImage(
            sp.bitmap,
            p.x - sp.anchorX * k,
            p.y - sp.anchorY * k,
            sp.width * k,
            sp.height * k,
          );
        },
      });
    }
    return slots;
  }

  /**
   * 格子标记。
   *
   * ★ 画成**菱形**而不是圆：底图本身就是等距视角，格线是菱形的
   *   （原版截图里草地上那圈白色虚线就是），圆形叠上去会明显出戏。
   *   长宽比 2:1 是等距投影的标准比例。
   *
   * ⚠️ 这仍是**占位图形**，不是原版美术：原版每格的底色由绘制槽的
   *   `[0x48a852]`（归属）与 `[0x48a853]`（朝向）决定，具体画法还没解。
   *   有主时按玩家色填充，无主时按格子类型给个中性色。
   */
  #drawNodes(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    hover: number | null,
    vp: { w: number; h: number },
  ): void {
    const ctx = this.#ctx;
    // 等距菱形：半宽 2 × 半高
    const hw = cam.mode === 'map' ? Math.max(7, cam.scale * 13) : 15;
    const hh = hw / 2;

    const diamond = (x: number, y: number): void => {
      ctx.beginPath();
      ctx.moveTo(x, y - hh);
      ctx.lineTo(x + hw, y);
      ctx.lineTo(x, y + hh);
      ctx.lineTo(x - hw, y);
      ctx.closePath();
    };

    for (const n of map.nodes) {
      const p = worldToScreen(n.x, n.y, cam, vp);
      if (p === null) continue;
      const owner = ownerOfNode(n, state);

      diamond(p.x, p.y);
      ctx.fillStyle = owner >= 0 ? (PLAYER_COLORS[owner] ?? '#888') : nodeBaseColor(n);
      ctx.globalAlpha = owner >= 0 ? 0.85 : 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 描边让相邻格子在密集处也能分开
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (n.id === hover) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  /**
   * 玩家棋子 —— 同样收成绘制槽，与建筑混在一条清单里排（见 `draw()` 的 ★★）。
   *
   * @source 类别 0xc/0xd（`fcn_0040829d` 的 `cmp ebx,[0x49910c]`）：当前玩家同 Y 时压在上面。
   */
  #playerSlots(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
    poseOverride: number | null,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const slots: DrawSlot[] = [];
    /** 原版绘制槽的排序键（`0x48a44c`） */
    const nowMs = performance.now();
    // 同格多人时错开，否则棋子会完全重叠
    const perNode = new Map<number, number>();
    for (const pl of state.players) {
      if (pl.whoPlays === 0) continue;
      const node = map.nodes[pl.nodeId - 1];
      if (node === undefined) continue;
      const seen = perNode.get(pl.nodeId) ?? 0;
      perNode.set(pl.nodeId, seen + 1);

      // ★ 走子补间（T-046）：棋子按插值位置画，而不是直接落在格心
      const p =
        this.#walkScreen(pl.index, cam, vp, nowMs) ?? worldToScreen(node.x, node.y, cam, vp);
      if (p === null) continue;
      const k = cam.mode === 'map' ? cam.scale : 1;
      const off = seen * Math.max(4, k * 5);

      // ★ 原版棋子：锚点在底边中心，故按锚点对齐到格心（C-AST-6）
      //
      // ★ 朝向跟着走位走，不是永远面朝镜头：
      //   屏幕朝向 = (玩家朝向 + 8 − 视角) & 7（@source VA 0x0040882d），
      //   图号 = 屏幕朝向 × (图数 / 8) + 帧（@source VA 0x0040883f）。
      const moving = state.phase === 'moving' && pl.index === state.currentPlayer;
      // ★ 图组按**交通方式**取（走路/機車/汽車/船），组内三张 = 站/走/手持骰子
      //   @source VA 0x0040bbd8：edi = 0x80 + 角色×21 + 3×traffic_method
      //   ★ 掷骰段由调用方盖成「手持骰子」那一组（`characterPose`）——
      //     原版整段（预动作 + 滚骰 + 500 ms 定格）都停在那一组上。
      const override = poseOverride !== null && pl.index === state.currentPlayer ? poseOverride : null;
      const pose = override ?? (moving ? CHARACTER_POSE.walk : CHARACTER_POSE.stand);
      const res = characterSetBase(pl.character, pl.trafficMethod) + pose;
      const count = this.#imageCount('Data.mkf', res);
      const dir = screenDirection(pl.direction, cam.view);
      const token =
        count > 0
          ? this.#sprite('Data.mkf', res, directionalImage(count, dir, this.#walkFrame))
          : null;
      if (token !== null) {
        const w = token.width * k;
        const h = token.height * k;
        slots.push({
          // 当前玩家同屏幕 Y 时压在其他棋子与建筑之上（原版 0xd vs 0xc/0x0）
          key: drawKey(p.y, pl.index === state.currentPlayer ? DRAW_CLASS.currentPlayer : DRAW_CLASS.player),
          paint: () => {
            const x = p.x + off - token.anchorX * k;
            const y = p.y - off - token.anchorY * k;
            if (pl.index === state.currentPlayer) {
              // 当前玩家脚下画一圈光晕，免得在密集处认不出轮到谁
              ctx.beginPath();
              ctx.ellipse(p.x + off, p.y - off, w * 0.42, h * 0.14, 0, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255,236,120,0.55)';
              ctx.fill();
            }
            ctx.drawImage(token.bitmap, x, y, w, h);
          },
        });
        continue;
      }

      // 精灵还没解完时退回色块，别让棋子凭空消失
      const r = Math.max(4, k * 7);
      slots.push({
        key: drawKey(p.y, pl.index === state.currentPlayer ? DRAW_CLASS.currentPlayer : DRAW_CLASS.player),
        paint: () => {
          ctx.beginPath();
          ctx.arc(p.x + off, p.y - off, r, 0, Math.PI * 2);
          ctx.fillStyle = PLAYER_COLORS[pl.index] ?? '#fff';
          ctx.fill();
          ctx.strokeStyle = pl.index === state.currentPlayer ? '#fff' : 'rgba(0,0,0,0.5)';
          ctx.lineWidth = pl.index === state.currentPlayer ? 3 : 1;
          ctx.stroke();
        },
      });
    }
    return slots;
  }

  /**
   * 四大惡人／機器娃娃的棋子（T-047）—— 与建筑、玩家混在同一条绘制槽清单里排。
   *
   * 画法与玩家同构：**锚点对齐到落点**（`fcn_00456770` 会减掉图自带的 x/y，
   * @source VA 0x0045679b），朝向走同一套「世界朝向 + 8 − 视角」，
   * 图号走同一套「屏幕朝向 × 每向帧数 + 走路帧」。
   *
   * 差别只有三处，全部照 exe：
   * - 图组是替身专用的（`specialActorImageSet`）；
   * - 有补间时画在**插值点**上（exe 用的是记录里那两个插值坐标 `+0`/`+2`）；
   * - 绘制槽类别是 0x8 / 0xd（同 Y 时排在玩家下面，见 `DRAW_CLASS.npc`）。
   *
   * ⚠️ exe 在槽里存的是**替身记录自己的 x/y**（走动时是插值值），本引擎的
   *   `SpecialActor` 没有这两个字段（C-ARC-2：插值坐标不进 state），
   *   故按「格心 + 补间插值」现算。
   */
  #actorSlots(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
    currentActor: number | null,
    now: number,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const slots: DrawSlot[] = [];
    // ★ 先把补间解出来（它会推进走路帧、顺手清掉播完的），再按它决定站/走姿 ——
    //   顺序颠倒的话，刚好播完那一刻会多画一帧走姿。
    const live = new Map<number, { x: number; y: number }>();
    for (let slot = 0; slot < SPECIAL_ACTOR_COUNT; slot++) {
      const p = this.#actorWalkScreen(slot, cam, vp, now);
      if (p !== null) live.set(slot, p);
    }
    const tokens = actorTokens(state, map.nodes, {
      view: cam.view,
      walking: (slot) => live.has(slot),
      frame: (slot) => this.#actorFrame.get(slot) ?? 0,
      currentActor,
    });

    const k = cam.mode === 'map' ? cam.scale : 1;
    for (const t of tokens) {
      const p = live.get(t.slot) ?? worldToScreen(t.x, t.y, cam, vp);
      if (p === null) continue;
      const count = this.#imageCount('Data.mkf', t.resource);
      const sp =
        count > 0
          ? this.#sprite('Data.mkf', t.resource, directionalImage(count, t.screenDir, t.frame))
          : null;
      // 图还没解出来就这一帧不画 —— 原版槽里指针为空时同样跳过。
      // ⚠️ 不退回色块：替身是「憑空多出来的东西」，画错比不画更糟。
      if (sp === null) continue;
      slots.push({
        key: drawKey(p.y, t.klass),
        paint: () => {
          ctx.drawImage(
            sp.bitmap,
            p.x - sp.anchorX * k,
            p.y - sp.anchorY * k,
            sp.width * k,
            sp.height * k,
          );
        },
      });
    }
    return slots;
  }
}

/** 该节点上的地产归谁——无主或非地产返回 -1 */
function ownerOfNode(node: MapNode, state: GameState): number {
  if (node.ref.kind !== 'land') return -1;
  const owner = state.landOwner[node.ref.index] ?? 0;
  return owner === 0 ? -1 : owner - 1;
}

/** 未持有时按格子类型上色，先让棋盘结构可读 */
function nodeBaseColor(node: MapNode): string {
  switch (node.ref.kind) {
    case 'land':
      return '#8b97a8';
    case 'facility':
      return '#c9a15e';
    case 'commercial':
      return '#a878c8';
    case 'landscape':
      return '#5fa87c';
    default:
      return node.specialKind !== 0 ? '#e0c65a' : '#6b7280';
  }
}

/**
 * 屏幕坐标 → 节点号，**两种视角都管用**。
 *
 * ★ 这里不去解投影的逆，而是把每个节点**正向投一遍**再比屏幕距离。
 *   理由有三：
 *   - 用的就是绘制时那张表（`projectWorld`），所以「看得见的就点得到」，
 *     不会出现画在这、点在那的错位；
 *   - 投影在 29×29 窗口外直接返回 null，逆变换要另外处理这个边界，
 *     正向投则天然跳过；
 *   - 103 个节点，一次遍历的开销可以忽略。
 *
 * ⚠️ 先前的拾取走 `screenToMap` + `pickNode`，而 `screenToMap` **只实现了
 *   地图视角**的平移缩放。在人物视角下它算出来的地图坐标是错的，
 *   于是悬停高亮和岔路点击全都指向别的格子。
 */
export function pickNodeAt(
  map: Rich4Map,
  sx: number,
  sy: number,
  cam: Camera,
  viewport: { w: number; h: number },
  radius = 24,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (const n of map.nodes) {
    const p = worldToScreen(n.x, n.y, cam, viewport);
    // 人物视角下越出窗口的节点根本没画，自然也点不到
    if (p === null) continue;
    const dx = p.x - sx;
    const dy = p.y - sy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = n.id;
    }
  }
  return best;
}
