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
  directionOf,
  type GameState,
  type SpecialActor,
} from '@rich4/core';
import { CHARACTERS, characterColorRgb } from '@rich4/data';
import { framesFor, tweenTickCount } from './tween.ts';
import {
  attachedFrameIndex,
  attachedImageIndex,
  attachedOffset,
  attachedOwnerVisible,
  flightPosAt,
  objectFacing,
  objectImageIndex,
  objectSpriteResource,
  type ObjectFlight,
} from './throw-fx.ts';
// ★ 機器工人建屋影片的落点/尺寸是 exe 里的**常数**（Q-TOOL-6）——
//   屏幕 (0, 0x28) = 棋盘局部 (0, 0)，整块 440×440。见 `build-fx.ts`。
import { BUILD_FX_H, BUILD_FX_W, BUILD_FX_X, BUILD_FX_Y } from './build-fx.ts';
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
 *
 * ★ 字节序 **`0xRRGGBB`**（R 在高字节）已由 exe 数清（原 Q6）：
 *   原值经 `_rich4_convert_color`（VA 0x004551f0）取 byte2/1/0 当红/绿/蓝，
 *   再写进精灵表调色板 #255。解码统一走 `@rich4/data` 的 `characterColorRgb`，
 *   不要在这里再写一份移位（hud.ts 那条角色色长条走的是同一个口）。
 */
function characterColor(state: GameState, owner: number): readonly [number, number, number] {
  const character = state.players[owner - 1]?.character ?? -1;
  const c = character >= 0 ? CHARACTERS[character]?.color : undefined;
  return characterColorRgb(c ?? 0xffffff);
}

/** 玩家棋子的颜色——原版每人一色，此处先用可区分的四色占位 */
const PLAYER_COLORS = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;

/**
 * 夢遊/冬眠中的棋子该不该**画成灰的**。
 *
 * @source `_rich4_convert_sprite`（VA 0x004555c5）的调用点：
 *   玩家 `+0x36`（`days_sleeping`）非 0 → VA 0x004087d7；
 *   替身 `record + 0x12` 非 0 → VA 0x004089f6。
 *   本引擎的对应字段：玩家 = `blocking.sleeping`；替身那一位**没有可信来源**
 *   （见 deviations D-T047-2），故这里只收玩家那一条。
 */
export function isAsleep(blocking: { sleeping: number }): boolean {
  return blocking.sleeping !== 0;
}

/**
 * 去色用的 canvas `filter` —— `fcn_004555eb` 那套 `(R+G+B+40)>>2` 的等价近似。
 *
 * 原版把三个通道都写成同一个灰度值（保留最高位），并且因为 `+0x28` 那一下
 * 会整体**提亮**一点点，所以除了 `saturate(0)` 还要补一点 `brightness`。
 * ⚠️ 这是近似（canvas 的色彩空间与 RGB555 取整不完全一致），登记在 D-T047-4。
 */
export const ASLEEP_FILTER = 'saturate(0) brightness(1.24)';

/**
 * 视角模式。
 *
 * ★ 只有**一种**看法：等距投影、跟着棋子走（摄像机恒在 29×29 窗口的正中一格，
 *   投影查 `@rich4/data` 的投影表）。想左右看就旋转视角（`view` 0..7，每步 45°）。
 *
 * ⚠️ 原先这里还有第二种 `map` **地图视角**（把 2304 见方的正射底图平铺俯瞰）——
 *   那是**本引擎自己发明的**：原版没有缩放/平移视角，`HOTKEY.map` 打开的是
 *   一扇 400×400 的模态弹窗（窗口过程 `fcn_0040a801`，见 T-086）。
 *   随 `setViewMode` 一并删除（D-086-5）。
 */

export interface Camera {
  /**
   * 平移量（**恒为 0**）—— 原先「地图视角」用它做整图取景的平移，
   * 那个视角是本引擎自己发明的，已随 `setViewMode` 删掉（D-086-5）。
   * 字段保留只是因为投影与若干绘制函数都按这个形状取值。
   */
  x: number;
  y: number;
  scale: number;
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
  /**
   * 正在播的**投掷动效**（放置類道具：路障/地雷/定時炸彈）—— 纯表现，不进 state。
   *
   * ★ 原版 `_rich4_animate_object`（VA 0x0040e669）把物件从角色身上丢到目标格，
   *   是一段**阻塞**动画：期间棋盘不重绘，故那件物件**只**以飞行的样子出现
   *   （此刻还不在目标格上）；播完才落地、才放音。这里用同一条规矩：
   *   `objectIndex` 指的那一件在本条动效播完前**不进静态绘制槽**，
   *   改由动效层画（见 `draw()` 末尾）。规格与出处见 `throw-fx.ts`。
   */
  objectFlight?: ObjectFlight | null;
  /**
   * 正在播的**機器工人建屋影片**（Q-TOOL-6）—— 这一帧该贴的那张图，`null` = 没在播
   * （或影片还没解好）。
   *
   * ★ 它跟上面那套投掷动效**不是一回事**：原版把整段 440×440 的 FLIC
   *   **原地**盖在棋盘左上角（屏幕 `(0, 0x28)` = 棋盘局部 `(0, 0)`，
   *   VA 0x00447359/0x0044735a），位置是常数、画面自己会动，
   *   所以这里只要一张图 + 两个常数，不需要 `from/to`。
   *   @source `rich4_use_tool_jiqigongren` VA 0x00447295 /
   *   `fcn_0040b0cd` VA 0x0040b0cd，规格见 `build-fx.ts`。
   */
  buildFx?: CanvasImageSource | null;
}

/**
 * 世界坐标 → 屏幕坐标。
 *
 * 走原版的投影表（见 @rich4/data 的 projection.ts），返回的是相对**屏幕中心**
 * 的偏移，故要加上视口中心；越出 29×29 窗口时返回 null，与原版一样直接不画。
 */
export function worldToScreen(
  x: number,
  y: number,
  cam: Camera,
  viewport: { w: number; h: number },
): { x: number; y: number } | null {
  // ★ 2026-09-16：原来这里还有一支「地图视角」（`cam.mode === 'map'` 的平移缩放）。
  //   那是**本引擎自己发明的** —— 原版没有缩放/平移视角（`HOTKEY.map` 开的是
  //   一扇 400×400 的模态弹窗，见 T-086）。`setViewMode` 删掉后它已不可达，
  //   连同 `fitCamera` 一并删掉（D-086-5 结案）。
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


/** 人物视角：摄像机落在某个世界坐标所在的块上 */
export function characterCamera(x: number, y: number, view = 0): Camera {
  return { x: 0, y: 0, scale: 1, view: view % VIEW_COUNT, tileX: x >> 5, tileY: y >> 5 };
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
 * @param vehicle 原版那一支判的是**脚下节点**：`test byte [node + 0x27], 0x80`
 *   —— 即 `node.flags & 0x80000000`，本引擎解析成 `MapNode.noObjects`
 *   （见 `loaders/map.ts:504`）。置位时**走姿**换成「资源 + 2」（同一个 NPC
 *   骑在载具上的样子）；站姿不变。
 *   @source `_rich4_update_player_sprite` VA 0x0040bdd6-0x0040be45
 * @returns 资源号；**不是替身**（玩家 0..3、越界）返回 null
 *
 * ★ 2026-09-16 接线（外部审查 D-T047-2/-3）：载具那一支原先是**有意不做**
 *   （读不清）。现按 `+2` 的写入口对齐：那一支把 `edi + 2` 读进走姿槽
 *   （`[0x498ec0]`，`add edi, 2` @source 0x0040be3f），而站姿槽
 *   （`[0x498eb4]`，`push edi` @0x0040bdd6 之后那一支）仍走常规。
 *   `+3`（夢遊走姿）要看替身记录 `+13`，本引擎的 `SpecialActor` 有
 *   `sleepwalkDays` 字段但没有可信的写入来源（两张卡的目标索引空间还没核清），
 *   故仍不接 —— 见 deviations。
 */
export function specialActorImageSet(
  actor: number,
  walking: boolean,
  vehicle = false,
): number | null {
  // @source VA 0x0040bd51：edi = actor×4 + 0x16c
  if (actor >= SPECIAL_ACTOR_BASE && actor < ACTOR_DOLL) {
    if (walking && vehicle) return SPECIAL_ACTOR_SPRITE_BASE + actor * 4 + 2;
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
  /**
   * 这一格的起点／落点节点号。
   *
   * ★ 给「不在盘上也要画出来」那一路用（见 `ActorTokenOptions.walkingOffBoard`）：
   *   機器娃娃走完就 `idleActor()`，state 里已经没有节点了，只能从补间这一格现取。
   */
  fromNode: number;
  toNode: number;
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
    steps.push({
      from: { x: a.x, y: a.y },
      to: { x: b.x, y: b.y },
      fromNode: a.id,
      toNode: b.id,
      ticks,
      tickAt,
      at,
      ms,
    });
    at += ms;
    tickAt += ticks;
  }
  return steps;
}

/**
 * 补间里这一格的世界朝向 —— **面朝去路**（`from → to`），与 exe 同一套。
 *
 * @source `fcn_0040c05c` 的 actor ≥ 4 分支（入口 `0040c06f cmp ecx,4 / jge 0x40c489`），
 *   每 tick 都会重算一次朝向、写进替身记录的 `+9`（VA 0x0040c6f6..0x0040c719）：
 *
 * ```asm
 * ; 这一格刚把它走完时，+4 已经指向**落点**、+6 指向**来路**（0x40c549/0x40c557 换过）
 * 0040c6ff  mov ax, word [ebx + 0x498e2c]   ; ★ 先压：+4 = 落点
 * 0040c706  push eax
 * 0040c709  mov ax, word [ebx + 0x498e2e]   ; ★ 后压：+6 = 来路
 * 0040c710  push eax
 * 0040c711  call 0x407a8c                   ; = dir(后压 → 先压) = dir(来路 → 落点)
 * 0040c719  mov byte [ebx + 0x498e31], al   ; +9 = direction
 * ```
 *
 * ⚠️ 两个参数的**先后不能只看 `push` 的字面顺序**：本工程的调用约定是
 *   **cdecl（从右往左压栈）**，所以**最后压的那个才是第一个参数**。
 *   拿 `_memcpy` 验过：`push n / push src / push dst / call memcpy`
 *   （例：`rich4_sound_effect.asm:146`）—— 与 `memcpy(dst, src, n)` 逐位对上。
 *   于是 `fcn_00407a8c(来路, 落点)` = `dir(来路 → 落点)` = **面朝去路**，
 *   与玩家那一支（`directionOf(目标 − 当前)`）同向，不是倒着走。
 *   （`fcn_00407a8c` 本体：`dx = node[第二参数].x − node[第一参数].x`，
 *   再 `push dy / push dx / call 0x454fb4`。）
 *
 *   本函数直接复用 core 的 `directionOf`（1:1 的定点 atan2 + 八分圆重映射）。
 */
export function actorWalkDirection(step: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}): number {
  return directionOf(step.to.x - step.from.x, step.to.y - step.from.y);
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
  /**
   * ★ **不在盘上但正在播补间**的槽 —— 走这一帧该把它画在哪个节点、朝哪。
   *
   * 原版里这五个替身在**走的过程中** `place` 一直是 0（在盘上），只有走完
   * 那一下才被收场（`fcn_00418ebd`：`[0x49910c] == 8` → 切回主人）。本引擎的
   * core 是「一次动作把整趟走完」，于是 `runDoll` 回来的记录**起步时就已经是**
   * `idleActor()`（nodeId 0 / place offBoard），`actorTokens` 按 `place != 0`
   * 一跳过，那一趟就**只剩补间在动、棋盘上什么都没有** —— 需求方看到的
   * 「用了機器娃娃没有动画」正是这里。
   *
   * 所以宿主（`#actorSlots`）把补间**当前那一格**的落点与朝向喂进来，
   * 这一帧照常画走姿。走完补间没了，回调返回 null，娃娃就消失（= 原版收场）。
   *
   * @returns `{ nodeId, direction }`；不在播就返回 null
   */
  walkingOffBoard?: (slot: number) => { nodeId: number; direction: number } | null;
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
 *
 * ⚠️ `place != 0` 跳过那一条**只对「站在原地」的成立**：原版替身走着的时候
 *   `place` 一直是 0，而本引擎 core 把整趟一次走完、回来就已经 `idleActor()`，
 *   所以走完还没播完的那一趟要由 `walkingOffBoard` 补上（默认没有 = 旧行为）。
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
    const onBoard = a !== undefined && a.place === ACTOR_PLACE.board && a.nodeId > 0;
    // ★ 不在盘上也可能刚走完一整趟却还没播完（機器娃娃 / 半路回老家的惡人）——
    //   那一路由宿主从补间现算（见 `walkingOffBoard`），没有就照旧跳过。
    const ghost = onBoard ? null : (opts.walkingOffBoard?.(slot) ?? null);
    if (ghost === null && !onBoard) continue;
    const nodeId = onBoard ? a.nodeId : ghost!.nodeId;
    const direction = onBoard ? a.direction : ghost!.direction;
    const node = nodes[nodeId - 1];
    if (node === undefined) continue;
    const actor = SPECIAL_ACTOR_BASE + slot;
    // 娃娃走完就收场，但补间在播的那几帧**是走姿**（原版 `[0x498ea2] == 1`）
    const walking = onBoard ? walkingOf(slot) : true;
    // ★ 载具那一支读的是**脚下节点**的 bit31（= `noObjects`）
    //   @source VA 0x0040bdd6 `test byte [node + 0x27], 0x80`
    const resource = specialActorImageSet(actor, walking, node.noObjects === true);
    if (resource === null) continue;
    out.push({
      slot,
      actor,
      nodeId,
      x: node.x,
      y: node.y,
      resource,
      screenDir: screenDirection(direction, opts.view),
      frame: walking ? frameOf(slot) : 0,
      walking,
      klass: current === actor ? DRAW_CLASS.currentPlayer : DRAW_CLASS.npc,
    });
  }
  return out;
}

/** 棋盘上要画的一件**地图物件**（神明 / 路障 / 地雷 / 定時炸彈…）*/
export interface ObjectToken {
  /** 在 `state.objects` 里的下标（飞行中要按它把这一件藏掉） */
  index: number;
  /** 物件种类（16 路障 / 17 地雷 / 18 定時炸彈…） */
  type: number;
  /** 所在节点 */
  nodeId: number;
  /** 节点世界坐标（物件记录里存的是节点号，原版也拿它查 `map_node_ptr`） */
  x: number;
  y: number;
  /** `Data.mkf` 图集资源号（= 0x18c + 种类 − 1） */
  resource: number;
  /** 图号 = `8 − 视角 + 朝向`（每资源 8 张 = 8 向各 1 帧） */
  image: number;
}

/**
 * `state.objects` → 这一帧要画的物件清单（**纯函数**，画布无关，可单测）。
 *
 * 筛子与图号全在 `#objectSlots` 的注释里引了 asm（VA 0x00408f78 起那一段）；
 * 这里只把「哪些该画、画哪张图」从渲染里剥出来，好让 `render.test.ts` 钉住它 ——
 * 需求方这一轮的问题正是「放置后看不到」，而漏画就发生在这一层。
 *
 * @param hidden 正在播投掷动效的那一件（下标）—— 原版动画期间棋盘不重绘，
 *   所以飞着的那件**不能**同时出现在格子上（见 `RenderInput.objectFlight`）
 */
export function objectTokens(
  state: GameState,
  nodes: readonly MapNode[],
  view: number,
  hidden: number | null = null,
): ObjectToken[] {
  const out: ObjectToken[] = [];
  for (let i = 0; i < state.objects.length; i++) {
    if (hidden === i) continue;
    const o = state.objects[i];
    if (o === undefined) continue;
    // @source `cmp word [objects_info + i*24 + 2], 0`（VA 0x00408f82）—— 0 = 不在图上
    if (o.nodeId <= 0) continue;
    // @source `test dh, dh / je`（VA 0x00408f9f）—— 附身的那一支画在主人身上（本轮未做）
    if (o.attached !== 0) continue;
    const node = nodes[o.nodeId - 1];
    if (node === undefined) continue;
    const resource = objectSpriteResource(o.type);
    if (resource === null) continue;
    out.push({
      index: i,
      type: o.type,
      nodeId: o.nodeId,
      x: node.x,
      y: node.y,
      resource,
      image: objectImageIndex(objectFacing(node, nodes, directionOf), view),
    });
  }
  return out;
}

/** 一枚**附身于主人**的地圖物件（神明 / 被请上身的东西）这一帧的规格 */
export interface AttachedObjectToken {
  /** 在 `state.objects` 里的下标 */
  index: number;
  /** 物件种类 */
  type: number;
  /** 主人玩家下标（`objects[i].attached − 1`） */
  owner: number;
  /**
   * 主人**此刻**所在的节点号 —— 落点一律取这里，**不取** `objects[i].nodeId`。
   *
   * @source VA 0x00408fc6/0x00408fe5：位置读的是 `ownerBase + 0x496b70/0x496b72`
   *   （主人的实时像素坐标），物件记录里只有种类与 attached 被用到。
   *   ⇒ 主人一走，附身的那件就跟着走。
   */
  ownerNodeId: number;
  /** `Data.mkf` 图集资源号（= 0x18c + 种类 − 1） */
  resource: number;
  /**
   * 贴上去的**帧号** = `(8 − 视角 + 主人朝向 + 4) & 7`
   * —— 与偏移表同源、但**加 4**（神明背对主人）。见 `throw-fx.attachedFrameIndex`。
   */
  frame: number;
  /** 相对主人的**屏幕**像素偏移 @source 表 0x474951 / 0x474991 */
  offsetX: number;
  offsetY: number;
}

/**
 * `state.objects` 里**附身于人**的那些 → 这一帧画在主人身上的清单
 * （**纯函数**，画布无关，可单测）。
 *
 * ★ 原版这一支在 `fcn_0040829d` 的物件段里，`test dh,dh / **je**` 的**反面**
 *   （VA 0x00408f9f，`dh = objects_info[i].attached`）—— 落在主人身上：
 *
 * ```asm
 * 00408f95  ebp = i*24
 * 00408f9f  dh = byte [objects_info[i] + 5]        ; attached
 * 00408fa5  test dh, dh / je 0x408cd9              ; ★ == 0 才走「放地上」那一支
 * 00408fad  eax = attached − 1                     ; 主人下标
 * 00408fb6  ownerBase = eax * 0x68
 * 00408fbd  cmp dword [ownerBase + 0x496b9a], 0    ; 主人在住店/消失/坐牢/住院 → 整个不画
 *           jne 跳过
 * 00408fc6  eax = word [ownerBase + 0x496b70]      ; ★ 用主人的 xpos/ypos（+0x8/+0xa）
 * 00408fee  ecx = word [ownerBase + 0x496b72]
 * 00408fd3/00408fee  >> 5 → 格 → − 镜头 → +14 → 越出 0..0x1c 就跳过
 * 00409026  call fcn_00407a2c                       ; 格内像素偏移 → 屏幕坐标
 * 00409072  dl = byte [ownerBase + 0x496b78]       ; ★ 用**主人的朝向**（+0x10）
 * 00409078  eax = 8 / sub eax, [0x499088] / add eax, edx / and eax, 7
 *                                                   ; 图号 = 8 − 视角 + 主人朝向
 * 00409090  dl = 图号 + 4 / and dl, 7 → [槽 + 0x48a853]   ; ★ 真正贴的帧 = 图号 + 4
 * 00408c69/00408c74 屏幕 Y/X += dword [图号*8 + 0x474951 / +0x474955]
 * 00408f52  eax = [type*4 + 0x49692c]              ; 图集与「放地上」同一张表
 * ```
 *
 * 「放在地上」那一路仍在 `objectTokens` 里，两条互斥（同一个 `attached` 判据的
 * 两面），所以两件不会同时画出来。
 *
 * @param hidden 正在飞的那一件（下标）—— 請神符飞行期间神明已经从地图上摘掉
 *   （@source VA 0x00444ea8），别在主人身上再画一遍。
 */
export function attachedObjectTokens(
  state: GameState,
  view: number,
  hidden: number | null = null,
): AttachedObjectToken[] {
  const out: AttachedObjectToken[] = [];
  for (let i = 0; i < state.objects.length; i++) {
    if (hidden === i) continue;
    const o = state.objects[i];
    if (o === undefined) continue;
    // @source VA 0x00408fa5 `test dh,dh / je` —— attached == 0 归「放地上」那一路
    if (o.attached === 0) continue;
    const owner = state.players[o.attached - 1];
    if (owner === undefined) continue;
    // @source VA 0x00408fbd..0x00408fc4
    if (!attachedOwnerVisible(owner.blocking)) continue;
    const resource = objectSpriteResource(o.type);
    if (resource === null) continue;
    const image = attachedImageIndex(owner.direction, view);
    const { dx, dy } = attachedOffset(o.type, owner.godInfo, image);
    out.push({
      index: i,
      type: o.type,
      owner: owner.index,
      ownerNodeId: owner.nodeId,
      resource,
      frame: attachedFrameIndex(image),
      offsetX: dx,
      offsetY: dy,
    });
  }
  return out;
}

// ============================================================
//  ★ Q-LAND-1：地块/设施/企业/景观 —— 这一帧该贴哪张图（纯函数）
//
//  原版这四段（`fcn_0040829d` 的 `loc_004090e2` / `loc_004092f4` / `loc_0040953f`
//  / `loc_00409689`，即 住宅 → 设施 → 企业 → 景观）只做同一件事：
//  **往绘制槽清单里塞一件立体物**，槽 12 字节 = 精灵 / 标签词 / 归属色 / 图号 /
//  屏幕 Y / 屏幕 X。这里把这层「状态 → 资源号 + 图号」剥成纯函数，画布那边只负责摆位。
// ============================================================

/** 一块住宅地块这一帧该画什么（`null` = **一个像素都不画**）*/
export interface LandArt {
  /** `map.mkf` 资源号（建筑图集 / 连锁店图集 / 空地 logo 图集）*/
  resource: number;
  /** 图号：建筑 = 朝向 + 视角；空地 logo = 角色号 */
  image: number;
  /**
   * 非 0 时按 `player[paletteOwner-1]` 的角色色换掉调色板 #255（1 基玩家号）；
   * 0 = 不换色。
   */
  paletteOwner: number;
}

/**
 * 住宅地块 → 该贴哪张图。**三条判据全部取证自 exe**（`ebp` = 地块记录，步长 0x34）：
 *
 * ```asm
 * 004091af  al = byte [land + 0x1b]        ; 朝向
 *           al += byte [0x499088]          ; ★ 加上当前视角
 *           dl = 8 - al ; dl &= 7          ; 图号（0..7）
 * 004091df  cmp byte [land + 0x1a], 0      ; ★ 等级 0？
 *           je   0x40920f                  ;   → 空地那一支
 * 004091ee  cmp byte [land + 0x18], 0      ; ★ 连锁店（land.type != 0）？
 *           jne  0x409208                  ;   → 另一张图集
 * 004091e5  al = byte [land + 0x19]        ; 归属 → 槽 +6（调色板 #255）
 * 0040920f  ── 等级 0 那一支 ──
 * 00409216  cmp byte [land + 0x19], 0      ; ★ 无主？
 * 0040921a  je   0x40923e                  ;   → 槽 +0（资源）= 0
 * 0040921c  eax = dword [0x48aea8]         ; ★ 有主：空地 logo 图集（map.mkf #25）
 * 00409230  al = byte [player[owner-1] + 0x13]  ; ★ 图号 = 角色号（与视角无关）
 * 0040923e  dword [slot + 0x48a84c] = 0    ; 资源 0
 * 00409848  test ebp, ebp / je 0x409931    ; ★ 资源 0 的槽**整条跳过**
 * ```
 *
 * ★ 结论（需求方 2026-09-16 报的「开局所有大地块都被占了」正是这一条的反面）：
 *   **未持有的空地（等级 0 + 无主）在原版里什么都不画**，露出地砖。
 *   有主但没盖房才画该角色专属的空地 logo（那一支早就实现了）。
 *
 * ⚠️ 等级 ≥ 1 且无主时，原版把调色板 #255 写成 0（黑）；本引擎按「不换色」处理。
 *   该组合（有等级、无主）在原版规则里到不了，登记在 `docs/known-deviations.md`。
 */
export function landArt(input: {
  /** `state.landLevel[i]`（原版运行时写在 `land + 0x1a`）*/
  level: number;
  /** `state.landOwner[i]`，**1 基**；0 = 无主 */
  owner: number;
  /** 该玩家的 `character`（空地 logo 的图号）；只有「等级 0 + 有主」用得上 */
  character: number;
  /** `land.type != 0`（连锁店）*/
  chain: boolean;
  /** `land.facing`（记录 +0x1b，0..7）*/
  facing: number;
  globalMapId: number;
  /** 当前视角旋转（`[0x499088]`，0..7）*/
  view: number;
}): LandArt | null {
  if (input.level < 1) {
    // @source VA 0x00409216 `cmp byte [land+0x19],0` → VA 0x0040923e 资源 = 0
    // @source VA 0x00409848 `test ebp,ebp / je` → 资源 0 的槽整条跳过
    if (input.owner === 0) return null;
    // @source VA 0x0040920f：这一支槽 +6 = 0xff（不换色）；图号 = 角色号
    return { resource: EMPTY_LAND_LOGO_RESOURCE, image: input.character, paletteOwner: 0 };
  }
  // @source VA 0x004091ee（连锁店）与 0x004091e5（按等级）
  const resource = input.chain
    ? chainStoreResource(input.globalMapId)
    : buildingResource(input.globalMapId, input.level);
  if (resource === null) return null; // 等级 > 5：原版图集表只有 5 级
  // @source VA 0x004091af：图号 = (8 − (朝向 + 视角)) & 7
  return {
    resource,
    image: buildingImageIndex(input.facing, input.view),
    paletteOwner: input.owner,
  };
}

/** 棋盘上要画的一件**立体物**（建筑 / 设施 / 企业 / 景观）*/
export interface BuildingArtItem {
  /** 落点世界坐标 —— 用地块/设施/企业/景观**记录自己的** x/y，不是所在节点的 */
  x: number;
  y: number;
  /** `map.mkf` 资源号 */
  res: number;
  /** 图号 */
  img: number;
  /** 非空时把精灵调色板 #255 换成这个角色色 */
  ring?: readonly [number, number, number];
}

/**
 * 这一帧棋盘上所有的立体物（**纯函数**，画布无关，可单测）。
 *
 * 四张表各一段，与原版逐段对应：
 *
 * | 段 | 原版 | 落点 | 图集 | 图号 |
 * |---|---|---|---|---|
 * | 住宅地块 | `loc_004090e2` | **地块记录**的 x/y（VA 0x004090fc）| `landArt` | 见 `landArt` |
 * | 设施 | `loc_004092f4` | 设施记录的 x/y | `facilitySheetBase + facilitySlot(type, level)` | `(8 − (朝向 + 视角)) & 7`（VA 0x004093c3）|
 * | 上市企业 | `loc_0040953f` | 企业记录的 x/y | `spriteIndex + 38` | `(8 − (朝向 + 视角)) & 7`，朝向在 **+0x1b**（VA 0x0040964d）|
 * | 特殊景观 | `loc_00409689` | 景观记录的 x/y | `spriteIndex + 38` | `(8 − (朝向 + 视角)) & 7`，朝向在 **+0x18**（VA 0x00409793）|
 *
 * ★ **四类的图号都吃视角**（需求方 2026-09-16 问的「旋转视角景物跟不跟着变」）：
 *   这四张图集实测**每张都恰好 8 个朝向**（`map.mkf` 资源 39..86 建筑、
 *   87..103 设施、172..293 企业/景观，逐资源数出来的），所以视角一转就换图。
 *   **只有装饰（`decorIndex` → 资源 24）不吃视角** —— 那一段是单张图直接贴，
 *   见 `#drawDecor` 上方与 `loc_0040855f`。
 *
 * ⚠️ 越出 29×29 窗口的格子由调用方跳过（原版 `cmp esi,0x1c` / `cmp edi,0x1c`）。
 */
export function buildingArtItems(
  map: Rich4Map,
  state: GameState,
  view: number,
): BuildingArtItem[] {
  const items: BuildingArtItem[] = [];

  // ── 住宅地块 ──
  for (const n of map.nodes) {
    if (n.ref.kind !== 'land') continue;
    const landId = n.ref.index;
    const land = map.lands.find((l) => l.id === landId);
    if (land === undefined) continue;
    const owner = state.landOwner[landId] ?? 0;
    const art = landArt({
      level: state.landLevel[landId] ?? 0,
      owner,
      character: state.players[owner - 1]?.character ?? 0,
      chain: land.type !== 0,
      facing: land.facing,
      globalMapId: state.globalMapId,
      view,
    });
    // ★ 未持有（且没盖房）→ null → 这一格什么都不画，露出地砖
    if (art === null) continue;
    // ★ 用**地块记录自己的 x/y**，不是所在节点的 —— 两者差一格。
    //   @source 地块绘制 VA 0x004090fc：`movsx eax, word [ebp]` / `movsx edx, word [ebp+2]`，
    //   而 `ebp` 指的是**地块记录**（+0x1b 取朝向、+0x1a 取等级，都在同一条记录上）。
    //   实测地图 1：node 39 (1463,239) 与 land 1 (1463,192) 是同一块地，
    //   y 差 47（约一格半），设施/企业/景观那三处本来就用的自己的坐标，只有地块这里不一致。
    items.push({
      x: land.x,
      y: land.y,
      res: art.resource,
      img: art.image,
      // ★ 外圈那圈线按**所有者的角色专属色**换色（见 assets.ts 的 RING_PALETTE_INDEX）：
      //   @source VA 0x00409853 —— 槽 +6 非 0xff 时把 `player[owner-1].+0x04`（角色色）
      //   写进精灵的调色板 #255。
      ...(art.paletteOwner === 0 ? {} : { ring: characterColor(state, art.paletteOwner) }),
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
      // @source VA 0x004093c3：与建筑同一算式，朝向在 facility +0x1b
      img: buildingImageIndex(f.facing, view),
      ...(f.owner === 0 ? {} : { ring: characterColor(state, f.owner) }),
    });
  }

  // ── 上市企业与特殊景观：共用「索引 + 38」那套 ──
  for (const c of map.commercials) {
    const res = sceneryResource(c.spriteIndex);
    if (res === null) continue;
    const co = state.commercialOwners[c.id - 1]?.owner ?? 0;
    items.push({
      x: c.x,
      y: c.y,
      res,
      // @source VA 0x0040964d：朝向在 commercial +0x1b（实测八张地图都在 0..7）
      img: buildingImageIndex(c.facing ?? 0, view),
      ...(co === 0 ? {} : { ring: characterColor(state, co) }),
    });
  }
  for (const l of map.landscapes) {
    const res = sceneryResource(l.spriteIndex);
    if (res === null) continue;
    items.push({
      x: l.x,
      y: l.y,
      res,
      // @source VA 0x00409793：朝向在 landscape +0x18（实测八张地图都在 0..7）
      img: buildingImageIndex(l.facing ?? 0, view),
    });
  }

  return items;
}

/** 一条待画的绘制槽：先按 `key` 排序，再依次 `paint` */
interface DrawSlot {
  key: number;
  paint: () => void;
}

/**
 * 缓存淘汰下来的精灵的**延迟释放**队列（Q-PERF-1）。
 *
 * ## 为什么不能就地 `close()`
 *
 * `SpriteCache` 的 LRU 只把条目移出它自己那张表 —— 真正握着 `ImageBitmap`
 * 的是渲染器的 `#ready`（绘制时直接用 `sprite.bitmap`）。所以淘汰时必须有人
 * 把渲染器那份引用也丢掉，否则内存一点不降（这正是 Q-PERF-1 的症状）。
 *
 * 但**也不能在收到淘汰回调的那一刻就 close**：那个位图可能正被本帧画着，
 * `drawImage` 拿到已关闭的位图会画成空白。淘汰回调发生在**解码完成后的微任务**里
 * （`#sprites.get(...).then(...)`），也就是两帧之间 —— 于是安全的分界点很清楚：
 *
 *   · **淘汰发生时**：只从 `#ready` 摘掉引用并排进本队列 —— 下一帧起不再画它；
 *   · **下一帧的绘制开始时**（`BoardRenderer.draw` 的**第一件事**）：才真正 `close()`。
 *     此刻上一帧的 rAF 回调早已整个跑完（画布上的 `drawImage` 是同步落地的），
 *     队列里每一张都确定「不会再被任何一帧用到」。
 *
 * 反过来说：**只要 close 发生在 draw 之内或之前**（而不是之后），就一定安全；
 * 放在 draw 末尾同样安全，选开头只是因为那时语义最直白 ——「上一帧画完了」。
 */
export class DeferredSpriteClose {
  readonly #queue: Sprite[] = [];

  /**
   * 淘汰回调的落点：把这个精灵从持有者的表里摘掉并排队等帧边界。
   *
   * ★ 返回 0（**不排队**）也是一种正常结果：本渲染器「从没画过它」，
   *   说明它是**别的持有者**（`hud.ts` 也有一张 `#ready`）在用。那种精灵
   *   一律不动 —— 见 Q-PERF-1 的「还剩什么没解」。
   *
   * @returns 摘掉了几条缓存键（= 这个渲染器持有它的证据）
   */
  retire(ready: Map<string, Sprite | null>, sprite: Sprite): number {
    let removed = 0;
    for (const [key, held] of ready) {
      if (held === sprite) {
        ready.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.#queue.push(sprite);
    return removed;
  }

  /** 帧边界：真正关掉位图。返回释放了几张 */
  drain(): number {
    const n = this.#queue.length;
    for (const sprite of this.#queue) sprite.bitmap.close();
    this.#queue.length = 0;
    return n;
  }

  /** 已摘掉引用、等着帧边界释放的张数（诊断用） */
  get pending(): number {
    return this.#queue.length;
  }
}

export class BoardRenderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  /** 已请求但尚未解码完成的精灵——避免同一帧内重复发起 */
  readonly #pending = new Set<string>();
  #ready = new Map<string, Sprite | null>();
  /**
   * 淘汰下来、等着帧边界释放的精灵（Q-PERF-1）。
   *
   * ⚠️ `SpriteCache` 构造在 `main.ts`（本卡不改它），故监听是渲染器**在构造时
   *   自己挂上去的**（`addEvictListener`），不靠外面接线。
   */
  readonly #evicted = new DeferredSpriteClose();
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
    // ★ Q-PERF-1：缓存淘汰 → 摘掉本渲染器这份引用并排队，帧边界再 close。
    //   挂在这里而不是构造缓存的地方，是因为构造缓存的 `main.ts` 不是本卡的范围，
    //   而渲染器本来就拿得到同一份缓存。
    sprites.addEvictListener((sprite) => {
      // ★ 淘汰掉的这张可能正被某个棋子槽当「上一张」顶着（`#spriteHeld`）——
      //   它马上要被 `close()`，绝不能留在手里，否则下一帧会拿一张**已关闭**的
      //   位图去 `drawImage`（画成空白）。摘掉之后那一槽退回「没有上一张」，
      //   与新解出来的图之间最多空一帧 —— 与淘汰前的老行为一致。
      for (const [slotKey, held] of this.#held) {
        if (held === sprite) this.#held.delete(slotKey);
      }
      this.#evicted.retire(this.#ready, sprite);
    });
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

  /**
   * 调试用：画出节点连线与**节点落点框**。原版两样都没有。
   *
   * ⚠️ 落点框**只描边、不填色** —— 先前它给每格填过一块自造底色，
   *   那正是需求方 2026-09-16 报的「开局所有大地块都被青色占了」。见 `#drawNodes`。
   */
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
  ): { x: number; y: number; nodeId: number; direction: number } | null {
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
    const p = framesFor(a, b, step.ticks)[k - 1];
    if (p === undefined) return null;
    // @source 逐格前进时写 `+9 direction`（`_rich4_calculate_direction`，VA 0x00454fb4）
    return { x: p.x, y: p.y, nodeId: step.toNode, direction: actorWalkDirection(step) };
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
   * ★ 某个棋子槽**上一张真的画出去的图** —— 图号换新、新图还没解好时拿它顶着。
   *
   * 见 `#spriteHeld`。键是调用方给的槽名（玩家 `p0..p3`、替身 `a0..a4`）。
   */
  readonly #held = new Map<string, Sprite>();

  /**
   * ★ 棋子这一帧要画的那张图 —— **解码没到货时退回本槽上一张**，绝不空一帧。
   *
   * 为什么必须这样（需求方 2026-09-16 报的「人物行动时仍然是闪烁的」）：
   * 原版这里是**常驻指针** —— `read_mkf` 把整组图**同步**读进内存，绘制槽每次
   * 从 `[0x498eb4 + pose*8 + slot*4]` 读到的东西都非空，所以走子过程中一个 tick
   * 都不会漏画（`fcn_0040829d` 那句「槽里指针为空就跳过」只对「这个槽压根没有
   * 图组」成立）。本引擎的精灵是 `createImageBitmap` **异步**解出来的：
   * 图号一 tick 换一张，`#sprite` 在新图号上**第一次**必然返回 null ——
   * 照原样跳过就是「有的帧不画」，观感上人物一闪一灭。
   *
   * 处置：能画当前帧就画当前帧；画不了就退回**本槽上一张画出来的图**
   * （同一个人的上一个走姿帧，通常只差一帧、下一帧就追上来了）。
   * ★ 这不是「改良」：原版那一条**永远画得出来**，退回上一张只是把
   *   「异步解码晚到一帧」这件事从画面上抹掉，比空一帧接近原版。
   *
   * @param slotKey 棋子槽的名字（同一时刻只有一个槽用它的上一张图）
   * @param res,idx `Data.mkf` 资源号与图号（`directionalImage` 算好的那个）
   * @param nextIdx 下一帧的图号（`directionalImage(count, dir, frame + 1)`）——
   *   顺手先解掉，好让走姿不必停在上一帧上；没有下一帧就给 `null`
   */
  #spriteHeld(
    slotKey: string,
    archive: 'Data.mkf' | 'Panel.mkf' | 'map.mkf' | 'jump.mkf',
    res: number,
    idx: number,
    nextIdx: number | null,
  ): Sprite | null {
    const sp = this.#sprite(archive, res, idx);
    // ★ 顺手把**下一帧**丢进解码队列 —— **不管当前这张有没有到货**：
    //   一 tick 一帧，而 tick 之间隔着好几个 rAF（20..120 ms），提前一帧请求
    //   就追得上；追不上才退回上一张。冷启动（这个槽一张图都还没有，例如
    //   機器娃娃凭空上路）因此也只有**第一帧**画不出来。
    if (nextIdx !== null && nextIdx !== idx) this.#sprite(archive, res, nextIdx);
    if (sp !== null) {
      this.#held.set(slotKey, sp);
      return sp;
    }
    return this.#held.get(slotKey) ?? null;
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
    // ★ 帧边界（Q-PERF-1）：上一帧已经整个画完，淘汰下来排着队的精灵现在才轮到 close。
    //   必须在**用**任何精灵之前做 —— 这样本帧就不会去用一张刚关掉的位图。
    this.#evicted.drain();

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
      // ★ 只有人物视角这一支 —— 「地图视角」那支（平移缩放的整图取景）是
      //   本引擎自己发明的，随 `setViewMode` 一起删掉（D-086-5）。
      this.#drawGroundProjected(ground, camera, { w: width, h: height }, dpr);
    }

    const vp = { w: width, h: height };
    // ⚠️ 原版棋盘上**没有**连线，也没有标落点的框 —— 格子长什么样全靠
    //   底图与建筑图素本身。先前那两层是解地图时的调试辅助，留着就不是复刻了。
    //   仍然保留代码，`?debug=nodes` 时才画，排错时还用得上。
    //   ★ 而且它们**只描边不填色**：未持有的空地原版一个像素都不画（见 `#drawNodes`）。
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
      // ★ 棋盘上的**物件**（神明、路障、地雷、定時炸彈…）—— 原版与建筑同属
      //   类别 0 那一段（`fcn_0040829d` 的对象分支不 or 类别位，VA 0x00408efd），
      //   故一起排序、一起贴。先前**整个漏了**（需求方：「放置后看不到」）。
      ...this.#objectSlots(map, state, camera, vp, input.objectFlight ?? null),
      // ★ **附身于人**的物件（神明 / 被请上身的东西）—— 原版同一个循环的另一支
      //   （`test dh,dh / je` 的反面，VA 0x00408fa5），画在**主人身上**：
      //   位置 = 主人的屏幕坐标（走子补间时用插值点）+ 8 向偏移表，
      //   帧号 = 8 − 视角 + **主人**朝向 + 4。同样与建筑同一档排序。
      ...this.#attachedObjectSlots(map, state, camera, vp, input.objectFlight ?? null),
      ...this.#playerSlots(map, state, camera, vp, input.characterPose ?? null),
      ...this.#actorSlots(map, state, camera, vp, input.currentActor ?? null, nowMs),
    ];
    // 原版用 qsort 比低 16 位 int16；这里用稳定排序，键相同时保持压入顺序（不影响观感）
    slots.sort((a, b) => a.key - b.key);
    for (const s of slots) s.paint();

    // ★ 投掷动效画在清单**之上**：原版 `animate_object` 是直接贴屏幕的阻塞动画，
    //   根本不进绘制槽（所以飞着的物件能盖过比它高的建筑）。@source VA 0x0040e669
    const flight = input.objectFlight ?? null;
    if (flight !== null) this.#drawObjectFlight(flight, camera, nowMs);

    // ★ 建屋影片（機器工人）画在**最后**：原版 `fcn_0045144f` 把 FLIC 直接贴到
    //   后台面/屏幕上（`[0x48c882]` bit0），根本不进绘制槽，位置是常数
    //   —— 屏幕 `(0, 0x28)` = 棋盘局部 `(0, 0)`，尺寸就是整块 440×440 棋盘。
    //   @source VA 0x00447350..0x0044735c / 0x0040b0f4..0x0040b0fd
    const buildFrame = input.buildFx ?? null;
    if (buildFrame !== null) {
      this.#ctx.drawImage(buildFrame, BUILD_FX_X, BUILD_FX_Y, BUILD_FX_W, BUILD_FX_H);
    }

    // 调试层画在清单之上（它只是排错用的参考图形，不该被建筑挡住）——
    // 只有描边，不填色（原版没有「每格一块底色」这种东西，见 `#drawNodes`）
    if (this.debugNodes) this.#drawNodes(map, camera, hoverNode, vp);
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
    ctx.lineWidth = 2;
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
    const k = 1;
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
   * 棋盘上的**地图物件** —— 神明、路障、地雷、定時炸彈…（`state.objects`）。
   *
   * ## 出处
   *
   * @source `fcn_0040829d` 的物件那一段（VA 0x00408f78 起，逐个扫 46 个物件）：
   * ```asm
   * 00408f82  cmp word [objects_info[i] + 2], 0   ; nodeId == 0 → 不在地图上
   * 00408f8c  cmp byte [objects_info[i] + 6], 0   ; 也不在飞行中 → 跳过
   * 00408f95  mov dh, byte [objects_info[i] + 5]  ; attached（附身于谁）
   * 00408f9f  test dh, dh / je 不附身那一支
   *           … 附身的画在**主人身上**（下面 ⚠️）
   * loc_00408e0e（不附身）:
   *           esi/edi = 所在节点的**屏幕格**（越出 0x1c 窗口就整条跳过）
   * 00408ee2  mov al, 8 / sub al, [0x499088] / add al, [objects_info[i] + 1] / and al, 7
   *           ; ★ 图号 = 8 − 视角 + 朝向
   * 00408f4b  mov al, byte [objects_info[i]]         ; 种类
   * 00408f52  mov eax, [type*4 + 0x49692c]           ; ★ 图集（= Data.mkf 的 0x18c + 种类 − 1）
   * 00408efd  edx = 屏幕Y << 4 / and 0xfff0 / + 槽号<<16
   *           ; ★ **不 or 类别** ⇒ 与建筑同一档（`DRAW_CLASS.building`）
   * 00408f60  mov byte [槽 + 0x48a852], 0xff          ; 不换归属色
   * ```
   * 即：与建筑混在**同一条按屏幕 Y 排的清单**里，锚点是图自带的 `(x, y)`
   * （`graph_st` 的锚点 —— 物件是「站在格心上」的，实测 40×33 那几张锚点是
   * `(20, 22)`，不是正中，故别自己按 width/2 算）。
   *
   * ## ⚠️ 已知缺口（登记 `docs/deviations/Q-TOOL-1.md`）
   *
   * **附身于人**的物件（`attached != 0`，即被请到身上的神明）原版画在主人身上，
   * 这里**不画** —— 本引擎的棋盘此前一件物件都没画，先补上「放在地上」这一大类
   * （需求方这轮要的三件道具全在其中），跟着主人跑那一路留待下一轮。
   *
   * ## 为什么用节点坐标而不是地块坐标
   *
   * 物件记录里存的是**节点号**（`+0x02`），原版也是拿它查 `map_node_ptr` 的
   * `(x, y)`；地块记录那套（`land.x/y`）是建筑专用的，物件不适用。
   */
  #objectSlots(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
    flight: ObjectFlight | null,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const k = 1;
    const slots: DrawSlot[] = [];
    const tokens = objectTokens(state, map.nodes, cam.view, flight?.objectIndex ?? null);
    for (const t of tokens) {
      const p = worldToScreen(t.x, t.y, cam, vp);
      if (p === null) continue; // 越出 29×29 窗口，原版同样跳过
      slots.push({
        key: drawKey(p.y, DRAW_CLASS.building),
        paint: () => {
          // 物件图是 SPR（索引 0 透明），不需要抠黑
          const sp = this.#sprite('Data.mkf', t.resource, t.image);
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
   * **附身于人**的物件 —— 画在主人身上（神明跟着棋子跑）。
   *
   * 「画哪一张、落在主人哪个偏移」整层在纯函数 `attachedObjectTokens` 里
   * （判据逐条带 @source VA），这里只管摆位：
   *
   * - 落点 = **主人的屏幕坐标**（原版读 `player + 0x8/+0xa`，走子补间中途是插值
   *   位置 —— 所以这里用 `#walkScreen`，与棋子本体同一处），
   * - 再加 8 向偏移表（半径 22/10，神明站在主人身侧），
   * - 越出 29×29 窗口就整条跳过（原版 `cmp esi, 0x1c` 那一对比较）。
   *
   * ⚠️ 原版用的是**主人的实时像素位置**，我们这边主人脚下的「同格错开」
   *   （`#playerSlots` 的 `seen * 5`）是渲染层自己加的，没有对应的 exe 行为，
   *   故这里**不加** —— 偏移完全来自 exe 的偏移表。
   */
  #attachedObjectSlots(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
    flight: ObjectFlight | null,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const k = 1;
    const nowMs = performance.now();
    const slots: DrawSlot[] = [];
    for (const t of attachedObjectTokens(state, cam.view, flight?.objectIndex ?? null)) {
      const owner = state.players[t.owner];
      if (owner === undefined) continue;
      const node = map.nodes[owner.nodeId - 1];
      if (node === undefined) continue;
      const p =
        this.#walkScreen(owner.index, cam, vp, nowMs) ?? worldToScreen(node.x, node.y, cam, vp);
      if (p === null) continue;
      const x = p.x + t.offsetX * k;
      const y = p.y + t.offsetY * k;
      slots.push({
        // @source VA 0x00408c82/0x00408cb8：与建筑同一档（不 or 类别位）
        key: drawKey(y, DRAW_CLASS.building),
        paint: () => {
          const sp = this.#sprite('Data.mkf', t.resource, t.frame);
          if (sp === null) return;
          ctx.drawImage(
            sp.bitmap,
            x - sp.anchorX * k,
            y - sp.anchorY * k,
            sp.width * k,
            sp.height * k,
          );
        },
      });
    }
    return slots;
  }

  /**
   * 投掷动效这一帧 —— 把飞着的那件物件贴在插值位置上。
   *
   * @source `_rich4_animate_object`（VA 0x0040e669）：两端点**开播前**换算成
   *   屏幕坐标，之后每帧在屏幕空间线性累加、贴在同一处（规格见 `throw-fx.ts`）。
   *   它**不进绘制槽**，直接贴屏幕 ⇒ 恒压在所有立体物之上，这里照样画在清单之后。
   *
   * ⚠️ 原版这一支还有个「擦掉上一帧那块矩形再贴新的」的脏矩形处理
   *   （`fcn_00456469` / `_rich4_rect_union`）—— 那是因为它直接往主表面画。
   *   本引擎每帧整幅重绘，用不上。
   */
  #drawObjectFlight(flight: ObjectFlight, cam: Camera, now: number): void {
    const at = flightPosAt(flight, now);
    if (at === null) return;
    const res = objectSpriteResource(flight.type);
    if (res === null) return;
    // ★ 图号：给了 `image` 就直接用（卡片那一支恒第 0 帧，@source VA 0x0040e6b9
    //   `xor ebp, ebp` —— 图集 415 只有 1 张图，按角度算会取到不存在的图号），
    //   否则按 `8 − 视角 + 朝向` 现算（放地上的物件那套，@source VA 0x0040e6a1）。
    const img = flight.image ?? objectImageIndex(flight.facing, cam.view);
    const sp = this.#sprite('Data.mkf', res, img);
    if (sp === null) return;
    const k = 1;
    // 原版每帧先向零截断再贴（`__round_toward_zero`，VA 0x0040e808 那一段）
    const x = Math.trunc(at.x);
    const y = Math.trunc(at.y);
    this.#ctx.drawImage(
      sp.bitmap,
      x - sp.anchorX * k,
      y - sp.anchorY * k,
      sp.width * k,
      sp.height * k,
    );
  }

  /**
   * 已开发地块上的建筑 —— 收成绘制槽交给调用方统一排序（见 `draw()` 的 ★★）。
   *
   * 「该贴哪张图」整层在纯函数 `buildingArtItems` 里（四张表的判据都带 @source VA），
   * 这里只管**摆位**：世界坐标 → 屏幕坐标（原版 29×29 窗口外的格子跳过）。
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
    const k = 1;
    const slots: DrawSlot[] = [];
    for (const it of buildingArtItems(map, state, cam.view)) {
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
   * 调试层：每个节点的**落点框**（`?debug=nodes`）—— 只描边，**不填任何颜色**。
   *
   * ★ 原版棋盘上**没有**任何「每格一块底色」的东西：`fcn_0040829d` 里逐节点扫的
   *   只有装饰那一段（`loc_0040855f`，且 `node.decorIndex == 0` 就跳过，VA 0x0040862e
   *   读它、VA 0x00408657 跳过后一格），其余全来自地块/设施/企业/景观四张表的立体物。
   *   所以**未持有的空地就是露出地砖，一个像素都不多画**
   *   （@source VA 0x0040923e：资源 = 0 → @source VA 0x00409848：`test ebp,ebp / je`
   *   把这一槽整条跳过）。需求方 2026-09-16 报的「开局所有大地块都被青色占了」
   *   就是这里先前那枚**自造色块**造成的（有主按玩家色、无主按 `nodeBaseColor`
   *   给的中性色 —— 那套颜色表是重制版自己编的，原版没有）。
   *
   * C-FID-1/4 禁改良 ⇒ 这里只留白色描边 + 悬停高亮：排错时看得见落点，
   * 又不会冒充原版美术。真要「看得出地块归谁」，画的是**建筑自带的归属圈线**
   * （`buildingArtItems` 的 `ring`），不是这里的框。
   */
  #drawNodes(
    map: Rich4Map,
    cam: Camera,
    hover: number | null,
    vp: { w: number; h: number },
  ): void {
    const ctx = this.#ctx;
    // 等距菱形：半宽 2 × 半高
    const hw = 15;
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
      diamond(p.x, p.y);
      if (n.id === hover) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
      } else {
        // 极淡的中性描边：只用来「看见格心在哪」，不冒充任何原版美术
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();
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
      const k = 1;
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
      /**
       * ★ 夢遊/冬眠中的棋子**画成灰的**（外部审查 D-T047-4）。
       *
       * @source `_rich4_convert_sprite`（VA 0x004555c5 → `fcn_004555eb`）：
       * ```asm
       * lodsw                        ; RGB555
       * and eax,0x1f / and ebx,0x1f / and edx,0x1f   ; R G B 各 5 位
       * add eax,ebx / add eax,edx
       * add eax,0x28 / shr eax,2                     ; ★ (R+G+B+40)>>2
       * … 把这一个值写回 R/G/B 三个通道（保留最高位）
       * ```
       * 即**逐像素去色**。触发条件：**玩家** `+0x36`（`days_sleeping`）非 0
       * （@source VA 0x004087d7）/ 替身 `record + 0x12` 非 0（@source 0x004089f6）。
       *
       * 本引擎用 canvas 的 `filter` 做等价去色（`saturate(0)` + 一次提亮对齐
       * `+0x28 >> 2` 那一下），省掉逐像素重写位图。
       * ⚠️ **近似**：原版在 RGB555 上取整平均，canvas 走自己的色彩空间 ——
       * 登记在 deviations D-T047-4。
       */
      const asleep = isAsleep(pl.blocking);
      // ★ 图号一 tick 换一张（`#walkFrame`）——新图号没解好时**退回本槽上一张**，
      //   不许整帧不画（否则走子/掷骰预动作时人物一闪一灭，见 `#spriteHeld`）。
      const token =
        count > 0
          ? this.#spriteHeld(
              `p${pl.index}`,
              'Data.mkf',
              res,
              directionalImage(count, dir, this.#walkFrame),
              directionalImage(count, dir, this.#walkFrame + 1),
            )
          : (this.#held.get(`p${pl.index}`) ?? null);
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
            if (asleep) ctx.filter = ASLEEP_FILTER;
            ctx.drawImage(token.bitmap, x, y, w, h);
            if (asleep) ctx.filter = 'none';
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
   *
   * ★ **走完就收场的**（機器娃娃 / 半路回老家的惡人）由 `walkingOffBoard` 补：
   *   原版走的过程中 `place` 一直是 0，本引擎 core 一次把整趟走完、回来就已经
   *   `idleActor()`，只按 `state` 判就整趟都画不出人来（需求方报的
   *   「用了機器娃娃没有动画」）。位置/朝向都从补间**当前那一格**现算。
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
    const live = new Map<number, { x: number; y: number; nodeId: number; direction: number }>();
    for (let slot = 0; slot < SPECIAL_ACTOR_COUNT; slot++) {
      const p = this.#actorWalkScreen(slot, cam, vp, now);
      if (p !== null) live.set(slot, p);
    }
    const tokens = actorTokens(state, map.nodes, {
      view: cam.view,
      walking: (slot) => live.has(slot),
      frame: (slot) => this.#actorFrame.get(slot) ?? 0,
      currentActor,
      // ★ 不在盘上但这一帧还在走的那一趟：拿补间当前格的落点与朝向画走姿。
      walkingOffBoard: (slot) => {
        const p = live.get(slot);
        return p === undefined ? null : { nodeId: p.nodeId, direction: p.direction };
      },
    });

    const k = 1;
    for (const t of tokens) {
      const p = live.get(t.slot) ?? worldToScreen(t.x, t.y, cam, vp);
      if (p === null) continue;
      const count = this.#imageCount('Data.mkf', t.resource);
      // ★ 走姿一 tick 换一张图 —— 新图号没解好时**退回本槽上一张**（通常是上一帧
      //   走姿，或上场前的站姿），绝不整帧不画：原版那个槽里的指针常驻非空
      //   （`read_mkf` 同步读整组图），跳过只对「这个槽压根没有图组」成立。
      //   照原样跳过 = 人物一闪一灭（需求方 2026-09-16 报的），见 `#spriteHeld`。
      const sp =
        count > 0
          ? this.#spriteHeld(
              `a${t.slot}`,
              'Data.mkf',
              t.resource,
              directionalImage(count, t.screenDir, t.frame),
              directionalImage(count, t.screenDir, t.frame + 1),
            )
          : (this.#held.get(`a${t.slot}`) ?? null);
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
