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
  OBJECT_TYPE_BOMB,
  SPECIAL_ACTOR_BASE,
  SPECIAL_ACTOR_COUNT,
  directionOf,
  type GameState,
  type MapObject,
  type SpecialActor,
  type SweptObject,
} from '@rich4/core';
import { CHARACTERS, characterColorRgb } from '@rich4/data';
import { tweenTickCount, tweenTickExact, walkFramesFor } from './tween.ts';
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
import { BUILD_FX_BOARD_Y, BUILD_FX_H, BUILD_FX_W, BUILD_FX_X } from './build-fx.ts';
import { godAscendPoseAt } from './god-ascend-fx.ts';
import { asleepSpriteOf, paintBrightness } from './sprite-brightness.ts';
import { TOLL_FLASH_FULL_SCALE } from './toll-flash-fx.ts';
import { WHO_PLAYS_WRECKED, type MapNode, type Rich4Map } from '@rich4/core';
import {
  VIEW_CENTER,
  VIEW_COUNT,
  VIEW_SPAN,
  projectCell,
  projectWorld,
  subtileOffset,
} from '@rich4/data';
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
  characterBeggarSprite,
  characterSleepwalkSprite,
  CHARACTER_POSE,
  directionalImage,
  screenDirection,
  DeferredSpriteClose,
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
/** `exactOptionalPropertyTypes` 下不能直接写 `ring: undefined` */
function withRing(ring: readonly [number, number, number] | undefined): { ring?: readonly [number, number, number] } {
  return ring === undefined ? {} : { ring };
}

/**
 * 绘制槽 `+6`（`[槽 + 0x48a852]`）的「不换色」哨兵。
 * @source VA 0x00408f60 / 0x0040920f / 0x00409457 / 0x0040978b `mov byte [槽+0x48a852], 0xff`
 */
export const SLOT_NO_RECOLOR = 0xff;

/**
 * 一件立体物那圈「归属线」（精灵调色板 #255）该换成什么颜色。
 *
 * @source 绘制槽遍历 VA 0x00409853..0x0040987d：
 * ```asm
 * 00409853  mov cl, [esi+0x48a852]        ; 槽 +6
 * 00409859  cmp cl, 0xff / je 0x409884    ; 0xff ⇒ 调色板原样（不换色）
 * 0040985e  test cl, cl  / jne 0x409866
 * 00409862  xor eax, eax / jmp 0x40987d   ; ★ **0（无主）⇒ #255 = 0 = 黑**
 * 00409866  … player[cl-1].+0x04 → convert_color
 * 0040987d  mov [ebp+0x1fe], ax           ; 调色板第 255 项
 * ```
 * 而贴图 `0x456770` 只按**索引 0** 透明（`0x456899 and eax,0xff / je`），#255 照画 ⇒
 * **无主的企业 / 建筑那一圈是黑线**，看上去就是「没有彩边」。
 *
 * ★ 先前无主时干脆不换色，于是素材里 #255 的**占位色**（品红 / 青 / 黄）原样露出来：
 *   开局的保險公司一圈桃红，正好撞上錢夫人的角色色，看着像「已被她控股」（2026-09-19 试玩回报）。
 */
export function ringColor(state: GameState, slotOwner: number): readonly [number, number, number] | undefined {
  if (slotOwner === SLOT_NO_RECOLOR) return undefined;
  if (slotOwner === 0) return RING_UNOWNED;
  return characterColor(state, slotOwner);
}

/** 无主时那圈线的颜色 @source VA 0x00409862 `xor eax,eax` */
export const RING_UNOWNED: readonly [number, number, number] = [0, 0, 0];

function characterColor(state: GameState, owner: number): readonly [number, number, number] {
  const character = state.players[owner - 1]?.character ?? -1;
  const c = character >= 0 ? CHARACTERS[character]?.color : undefined;
  return characterColorRgb(c ?? 0xffffff);
}

/** 玩家棋子的颜色——原版每人一色，此处先用可区分的四色占位 */
const PLAYER_COLORS = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;

/**
 * **冬眠**中的棋子该不该**画成灰的**（玩家）。
 *
 * @source `_rich4_convert_sprite`（VA 0x004555c5）的**玩家**调用点
 *   `rich4.asm:1393`：
 * ```asm
 * 004087d7  imul eax, ebx, 0x68            ; ebx = 玩家下标
 *           cmp byte [eax + 0x496b9e], 0   ; ★ +0x36 = days_sleeping
 *           je  short loc_004087e6
 *           test byte [esi + 0x498ea0], 0x40 / jne …   ; 这一槽已经转过了
 *           call _rich4_convert_sprite
 *           or  byte [esi + 0x498ea0], 0x40            ; 记下「已转」
 * ```
 * ⇒ 判据是 `blocking.sleeping`（= `+0x36`）= **冬眠**，
 *   **不是** `sleepWalking`（`+0x37`）—— 夢遊走的是另一条视觉：玩家换睡衣那套图
 *   （`characterSleepwalkSprite`，@source 0x0040ba16）、替身换 `+3` 走姿图组（`specialActorImageSet`），
 *   两者头上都再贴一张「ZZZ」（`SLEEPWALK_MARK_RESOURCE`，@source 0x00408870 / 0x00408acb）。
 */
export function isAsleep(blocking: { sleeping: number }): boolean {
  return blocking.sleeping !== 0;
}

/**
 * **冬眠**中的**替身**（四大惡人）该不该画成灰的。
 *
 * @source `rich4.asm:1533`（`loc_004089c6`）：
 * ```asm
 * 004089c6  mov eax, ebx
 *           shl eax, 4                      ; 记录步长 16（ebx = 槽 0..3）
 *           cmp byte [eax + 0x498e34], 0    ; ★ 记录基址 0x498e28 + 12 = 冬眠计数
 *           je  short loc_00408a05
 *           test byte [edi + 0x498ea0], 0x40 / jne …   ; 已转过就跳过
 *           call _rich4_convert_sprite
 *           or  byte [edi + 0x498ea0], 0x40
 * ```
 * `0x498e34 − 0x498e28 = 12` ⇒ 字段就是**替身记录 `+12`**
 * （= 本引擎的 `SpecialActor.hibernating`，由冬眠卡的 actor 分支写入 ——
 * 见 `cards/hibernate.ts` 的 `hibernateActors`）。
 *
 * ⚠️ 本引擎的 `hibernating` **可省略**（=未定义即 0），故这里用 `?? 0`。
 */
export function isActorAsleep(actor: { hibernating?: number; sleepwalkDays?: number }): boolean {
  return (actor.hibernating ?? 0) !== 0;
}

/**
 * 去色 —— `fcn_004555eb` 那套 `(R+G+B+40)>>2` 的等价近似（「去饱和 + 提亮 1.24」）。
 *
 * 原版把三个通道都写成同一个灰度值（保留最高位），并且因为 `+0x28` 那一下
 * 会整体**提亮**一点点，所以除了去色还要补一点亮度。
 * ⚠️ 这是近似（canvas 的色彩空间与 RGB555 取整不完全一致），登记在 D-T047-4。
 * ★★ 2026-09-24：**不再**用 `ctx.filter`（WebKit 不认 ⇒ iPhone 上从来不灰）——
 *   改成逐像素算好一张灰版精灵（`sprite-brightness.ts` 的 `asleepSpriteOf`，与先前的 filter
 *   在 Chromium 上逐像素相同）。

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
  /**
   * 摄像机相对该块原点的**亚格**偏移（世界单位 0..31）。
   *
   * ★ 只为「拾取模式贴边推镜头」而加（`Q-PICK-1`）：原版那一段是把镜头中心
   *   当作**像素**坐标逐 tick 推 8..68 px 再 clamp 到 [220, 2084]
   *   （@source `rich4_ui_use_tool.asm:392` 的 `0x113` 定时器分支），
   *   整格粒度的相机会把 8 px 的步长变成 0 或 32 px 的跳变，观感完全不同。
   *   缺省 0 = 与加这个字段之前完全一致。
   */
  subX?: number;
  subY?: number;
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
   * `characterPose` 那一组图画**第几帧**（每向帧号）；不给就跟全局走路帧走。
   *
   * ★ 掷骰姿必须给：预动作从第 0 帧数起，滚骰 + 定格期间**定在最后一帧**（骰子已出手、
   *   两手空空）—— 见 `dice-roll.ts` 文件头 ★★ 与 `DiceRollFx.poseFrame`
   *   （@source `0x0040dee4` / `0x0040d975` / `fcn_00419572` 不重画棋盘）。
   */
  characterPoseFrame?: number | null;
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
   * 一个 tick 多少毫秒（见 `tick.ts`）。不给按 20（每一帧都 tick）。
   * 替身补间只在这里用；玩家那条由 `startWalk()` 的入参给。
   *
   * ★ **这里曾经还有一个 `animation?: boolean`（動畫過程）开关，2026-09-18 删掉了**：
   *   原版 `[0x497159]`（= RICH4.CFG offset 1）的 22 个读点**全在影片（FLIC）
   *   播放处**（`0x40EC14..0x40F31C` 那一批道具/卡片的、`0x43D67B` 入獄、
   *   `0x43ED27` 住院…），走子那两支 `0x40C05C`（`fcn_0040c05c`）与
   *   `0x40D7C4`（`fcn_0040d7c4`）**一个都没有** ——
   *   所以「動畫過程」关掉时原版棋子**照样逐格滑**，只是不播那些影片。
   *   先前用 `animation: false` 把补间整个闸掉（棋子瞬移），是错的。
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
   * 正在播的**神明升天**（第十二份试玩回报 #1）—— 纯表现，不进 state。
   *
   * ★ 原版 `god_detach`（VA 0x0040e32c）先把那尊神从主人身上摘掉重画一次，
   *   再把它**直接贴屏幕**往上转着飞（不进绘制槽）；规格见 `god-ascend-fx.ts`。
   *   `state` 是离身**之前**那一份（起点 = 那一尊附身时画在哪、画的第几张）。
   */
  godAscend?: { state: GameState; objectIndex: number; elapsed: number } | null;
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
  /**
   * 「盖在棋盘上的阻塞影片」的**当前帧**（`board-film.ts` 那一族）。
   *
   * ★ 与 `buildFx` 同一类：原版 `fcn_0045144f`（VA 0x0045144f）把整幅帧直接贴到
   *   屏幕/后台面上，不进绘制槽；只是这一族的落点与尺寸**不是常数**
   *   （住院 440×74 @(0,210)；入獄/神明 440×440 @(0,40)），所以连落点一起交。
   *   坐标已经由宿主换算成**棋盘局部**（屏幕 y − 棋盘原点 40）。
   */
  boardFilm?: { bitmap: CanvasImageSource; x: number; y: number; w: number; h: number } | null;
  /**
   * 過路費閃爍（W-69）—— 這一幀要把**哪些地塊**調到多亮。
   *
   * ★ 原版 `fcn_00451985` 是改棋盤 **id 圖**上那幾格的像素（+`LEVEL[k]`，單位是
   *   5 位色分量）；本引擎按**精靈**近似：畫那幾塊地上的建築時疊成
   *   `brightness(1 + level/32)`（`sprite-brightness.ts`，不靠 Safari 不支持的 `ctx.filter`）。差异登记在
   *   `docs/deviations/Q-TOLL-FX-1.md`。
   *
   * `level` = 0 或沒在播時整份給 `null`（= 不套）。
   */
  /**
   * ★ 第二十二份（gap-audit #6）：新聞 18 / 19 的白闪也走这里（同一支 `fcn_00451985`）；
   *   它们可能闪到**設施**（挑中設施那一支 `0x0044a8d3` / `0x0044aa9f`）⇒ 多一张 `facilities`（設施 id）。
   */
  landFlash?: { lands: ReadonlySet<number>; facilities?: ReadonlySet<number>; level: number } | null;
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
  const p = projectWorld(cam.view, x, y, cam.tileX, cam.tileY, cam.subX ?? 0, cam.subY ?? 0);
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
 * 按**像素中心**造一台相机 —— 贴边推镜头用（`Q-PICK-1`）。
 *
 * 原版的镜头中心就是一对像素坐标（`[0x48c570]` / `[0x48c574]`），
 * 每次 `0x113` 定时器按方向表 `0x4751b0` 推 8..68 px，再 clamp 到 [220, 2084]。
 * 本引擎的 `Camera` 是「块 + 亚格余量」，故这里把它拆成
 * `tile = center >> 5`、`sub = center & 31`（负数按算术语义取到上一个块）。
 *
 * @param centerX 镜头中心的世界 X（px）
 * @param centerY 同上 Y
 */
export function pixelCamera(centerX: number, centerY: number, view = 0): Camera {
  const cx = Math.trunc(centerX);
  const cy = Math.trunc(centerY);
  return {
    x: 0,
    y: 0,
    scale: 1,
    view: view % VIEW_COUNT,
    tileX: cx >> 5,
    tileY: cy >> 5,
    subX: cx & 0x1f,
    subY: cy & 0x1f,
  };
}

/** 把相机的「块 + 亚格」还原成**像素中心**（`pixelCamera` 的逆）*/
export function cameraCenter(cam: Camera): { x: number; y: number } {
  return { x: cam.tileX * 32 + (cam.subX ?? 0), y: cam.tileY * 32 + (cam.subY ?? 0) };
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
  /**
   * ★ 夢遊标记（「ZZZ」）：**非**当前行动者 0xe、当前行动者 0xf ——
   *   同屏幕 Y 时压在棋子（0xc / 0xd）之上。
   * @source `0x004088a3 cmp ebx, [0x49910c] / jne` → `or byte [..], 0xf` / `or byte [..], 0xe`
   *   （替身那一段同形：`0x00408b02` / `0x00408b0a` / `0x00408b13`）
   */
  sleepwalkMark: 0xe,
  currentSleepwalkMark: 0xf,
} as const;

/**
 * 夢遊标记（「ZZZ」，6 张 = 6 帧，**不分方向**）的图组 = 物件图集表下标 **19**
 * ⇒ `Data.mkf` 资源 `0x18c + 19 − 1 = 0x19e`（414；目视核过：黄色「zzz」六帧）。
 *
 * @source `fcn_0040829d` 玩家那一段（替身那一段 `0x00408b26` 同形）：
 * ```asm
 * 00408870  cmp  byte [player + 0x496b9f], 0     ; ★ +0x37 夢遊天數；0 ⇒ 不加这一槽
 * 004088c7  mov  eax, [0x496978]                 ; ★ 0x496978 = 0x49692c + 19×4（物件图集表）
 * 004088e8  mov  al, [player×0x34 + 0x498ea4]    ; 图号 = 这个人自己的「ZZZ 帧」（见 `SLEEPWALK_MARK_FRAMES`）
 * 004088f5  坐标 = 棋子同一个屏幕点（[esp+0x30] / [esp+0x3c]）
 * ```
 */
export const SLEEPWALK_MARK_RESOURCE = objectSpriteResource(19) ?? 0x19e;

/**
 * 「ZZZ」帧数：**走子时一 tick 进一帧**，数到 6 回零（不走就停在那一帧）。
 * @source `fcn_0040c05c` 玩家那支 `0x0040c455..0x0040c47e`（`+0x37` 非 0 才进：
 *   `inc byte [+0x498ea4] / cmp bh, 6 / jne / mov byte [+0x498ea4], 0`）；
 *   替身那支 `0x0040c71f..0x0040c744`（看替身记录 `+13`）同形。
 */
export const SLEEPWALK_MARK_FRAMES = 6;

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
 * ★ 每组还有 `+2`（載具）与 `+3`（夢遊用的走姿）两张变体。两张都**已接**：
 *   `+2` 读脚下节点的 bit31（见 `specialActorImageSet` 的 `vehicle`），
 *   `+3` 读替身记录 `+13`（= `SpecialActor.sleepwalkDays`，2026-09-16
 *   梦游卡的替身写入来源接上之后才可能为真）。
 *   两张**只换走姿**，站姿不变 @source 0x0040bd5c（`+3`）/ 0x0040bdd6（`+2`）。
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
 * @param sleepwalking 原版替身记录 `+13`（`days_sleep_walking`）非 0 ——
 *   **夢遊走姿换成「资源 + 3」**（另一套 17 帧走路循环）。
 *   @source `_rich4_update_player_sprite` VA 0x0040bd5c 与 0x0040bdcb：
 *   ```asm
 *   0040bd58  cmp byte [eax + 0x498df5], 0   ; +13 = days_sleep_walking
 *   0040bd5f  je  short 常规那一支
 *   0040bd61  add edi, 3                     ; ★ 走姿 = edi + 3（另一套循环）
 *   ```
 *   注意判据是**走姿那一支**：站姿（`[0x498eb4]`）仍走 `edi`。
 * @source `_rich4_update_player_sprite` VA 0x0040bdd6-0x0040be45（載具）
 * @returns 资源号；**不是替身**（玩家 0..3、越界）返回 null
 *
 * ★ 2026-09-16 接线（外部审查 D-T047-2/-3）：载具那一支原先是**有意不做**
 *   （读不清）。现按 `+2` 的写入口对齐：那一支把 `edi + 2` 读进走姿槽
 *   （`[0x498ec0]`，`add edi, 2` @source 0x0040be3f），而站姿槽
 *   （`[0x498eb4]`，`push edi` @0x0040bdd6 之后那一支）仍走常规。
 *   `+3`（夢遊走姿）同一天也接上了：写入来源在 `cards/sleepwalk.ts` 的
 *   `applySleepwalkCardToActor()`（`registry.ts` 卡 16 的 actor 分支），
 *   字段是 `SpecialActor.sleepwalkDays`。
 *
 * ⚠️ `+2` 与 `+3` 同时成立时原版的**先后**：`+13` 那一支（0x0040bd5c）
 *   在节点 bit31 那一支（0x0040bdd6）**之前**，两处都是 `add edi, N` 后
 *   直接落走姿槽、**不做二次判断**，故 **`+3` 优先**（夢遊中不会骑载具 ——
 *   替身本来就没有载具字段，`+2` 只是画张骑车图）。这里照此序实现。
 */
export function specialActorImageSet(
  actor: number,
  walking: boolean,
  vehicle = false,
  sleepwalking = false,
): number | null {
  // @source VA 0x0040bd51：edi = actor×4 + 0x16c
  if (actor >= SPECIAL_ACTOR_BASE && actor < ACTOR_DOLL) {
    // ★ 顺序照原版：+13（夢遊）先于 bit31（載具），两者都只换走姿
    if (walking && sleepwalking) return SPECIAL_ACTOR_SPRITE_BASE + actor * 4 + 3;
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
  /**
   * 这一趟**起步时定下的步数**（原版 `[0x48baf8]` 的初值；E-22）——
   * 走子时那串剩余步数从它往下数。缺省 = `path.length − 1`。
   */
  steps?: number;
  /**
   * 这一趟沿途**扫掉的物件**（機器娃娃）；`undefined`/空 = 没有（四大惡人恒没有）。
   *
   * ★ 试玩3 #11：`index` 是**这一趟之前**那份 `state.objects` 的下标 ——
   *   core 交出来的时候那几件已经没有节点号了（`dollSweepNode` 把 `nodeId` 清 0），
   *   所以本模块要**自己留一份走之前的物件表**（`#sweptObjects`），按这些下标
   *   去把它画回原地，直到补间走到它被扫掉的那一格（`step`）。
   */
  cleared?: readonly SweptObject[];
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
  /** ★ 未截断的拍数 `N_f`（替身无条件走 `dist × 0.125`，见 `tweenTickExact`）*/
  exactTicks: number;
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
 * 0040c4ac  movsx eax, word [ebx]        ; ★ 起点 = **节点记录**的 +0x00（世界 x）
 * 0040c4b3  movsx eax, word [ebx + 2]    ; ★ 起点 = 节点记录的 +0x02（世界 y）
 * 0040c5a8  movsx eax, word [ebx]        ; 终点同理（ebx 换成了落点那一条记录）
 * 0040c5b9  edx = 终点x − 起点x ; edi = 终点y − 起点y
 * 0040c5dd  call fsqrt
 * 0040c5e2  fst  dword [esp+0xc]         ; dist = sqrt(dx² + dy²)（★ 世界坐标，不是屏幕）
 * 0040c5e6  fmul dword [0x4631dc]        ; ★ dist × 0.125f —— **无条件**，没有 fdivr 那一支
 * 0040c5ec  fstp dword [esp+0x1c]        ; N_f
 * 0040c650  fld N_f / call 0x457dbc      ; 向零截断 → [0x4749dc]
 * ```
 *   即 `tweenTickCount(dx, dy, 0, /*special*\/ true)` —— 与玩家「乘骑/被抬走」同一条。
 *
 * ★★ **tick 数按世界坐标算，不是屏幕坐标**（2026-09-18 订正）：这一支从头到尾
 *   没碰过投影（`0x407a2c`）。玩家那一支（`0x40c1d4..0x40c23e`）也一样：
 *   `[esp+0x18]/[esp+0x14]` 直接取节点记录的 `+0x00`/`+0x02`。
 *   ⇒ **镜头/视角/缩放都不影响一格要播几 tick**。先前这里按 `worldToScreen` 的
 *   距离算，于是同一条边换个视角 tick 数就变；节点不在 29×29 窗口里时投影更会
 *   返回 null、被当成 1 tick（「走回棋盘」那种长边直接瞬移）。
 *
 * @param nodes 地图节点表（下标 = 节点号 − 1）
 * @param tickMs 一个 tick 多少毫秒（见 `tick.ts`）
 */
export function actorWalkSteps(
  path: readonly number[],
  nodes: readonly MapNode[],
  tickMs: number,
): ActorWalkStep[] {
  const steps: ActorWalkStep[] = [];
  let at = 0;
  let tickAt = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = nodes[(path[i] ?? 0) - 1];
    const b = nodes[(path[i + 1] ?? 0) - 1];
    if (a === undefined || b === undefined) break;
    const ticks = tweenTickCount(b.x - a.x, b.y - a.y, 0, true);
    const exactTicks = tweenTickExact(b.x - a.x, b.y - a.y, 0, true);
    const ms = ticks * tickMs;
    steps.push({
      from: { x: a.x, y: a.y },
      to: { x: b.x, y: b.y },
      fromNode: a.id,
      toNode: b.id,
      ticks,
      exactTicks,
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
 * 替身这一趟此刻**还没走完的格数** —— 走子时那串大数字对替身的那一支（E-22）。
 *
 * @source 棋盘绘制例程 `0x00409951 cmp eax,4 / jge` —— 替身（actor ≥ 4）**跳过**关押/被挪那两道闸，
 *   直接画 `[0x48baf8]`；该值起步时 = 掷出的步数（`0x0040de64` / `0x0040de3d` / `0x0040debe`），
 *   **走完一格的那一拍**才减 1（`0x0040d960 dec`）。
 *   ⇒ 值 = `rolled − 已走完的格数`；补间播完（含半路被收回去、路径提前断）返回 0 = 不画。
 *
 * @param rolled 起步时定下的步数（core 的 `NpcWalkHint.steps`）
 */
export function actorStepsLeft(
  steps: readonly ActorWalkStep[],
  rolled: number,
  elapsedMs: number,
): number {
  if (elapsedMs < 0 || elapsedMs >= actorWalkTotalMs(steps)) return 0;
  let done = 0;
  for (const s of steps) if (elapsedMs >= s.at + s.ms) done++;
  return Math.max(0, rolled - done);
}

/** 一个世界坐标点（节点坐标与物件的浮点位置共用同一套单位） */
export interface KnockPoint {
  x: number;
  y: number;
}

/**
 * `+0x06`（物件记录的「存在/动画计时」）的起手值。
 * @source VA 0x0040fb9b `mov byte [obj*24 + 0x496d0e], 0xff`
 */
export const OBJECT_KNOCK_TIMER0 = 0xff;

/**
 * 物件被打飞时写进记录的那份状态 —— 物件记录 `+0x06..+0x14`（**全 float32**）。
 *
 * @source `fcn_0040fafd(objIdx, fromNode, toNode)` VA 0x0040fafd（规格
 *   `rich4-spec/docs/systems/tools.md` §6.1.0，通道 2 用例
 *   `rich4-spec/tests/test_object_float_move.py` 13/13）：
 * ```asm
 * 0040fb3e  dx = from.x − to.x / fild / fmul qword [0x46352c] = 0.5
 * 0040fb55  fstp [obj*24 + 0x496d18]            ; ★ +0x10 = Δx × 0.5
 * 0040fb6c  fstp [obj*24 + 0x496d1c]            ; ★ +0x14 = Δy × 0.5
 * 0040fb80  fstp [obj*24 + 0x496d10]            ; ★ +0x08 = from.x + 速度x（起手已推进半格）
 * 0040fb94  fstp [obj*24 + 0x496d14]            ; ★ +0x0c = from.y + 速度y
 * 0040fb9b  byte [obj*24 + 0x496d0e] = 0xff     ; ★ +0x06
 * 0040fba3  dl = byte [obj*24 + 0x496d09]       ; +0x01 = 朝向
 * 0040fbaa  byte [obj*24 + 0x496d0f] = dl       ; ★ +0x07 ← +0x01（朝向副本）
 * ```
 * ★ 落点一律 `fstp dword` = **IEEE-754 单精度**，故这里每一步都过 `Math.fround`。
 */
export interface ObjectKnock {
  /** `+0x08` 世界 x */
  x: number;
  /** `+0x0c` 世界 y */
  y: number;
  /** `+0x10` x 速度 = (from.x − to.x) × 0.5 */
  vx: number;
  /** `+0x14` y 速度 = (from.y − to.y) × 0.5 */
  vy: number;
  /** `+0x06` 计时（起手 `0xFF`，**每画一拍 −1**，见 `objectKnockAt`） */
  timer: number;
  /** `+0x07` = `+0x01` 的**原样副本**（飞的时候按它取图；`and 7` 留到用的时候做） */
  facing: number;
}

/**
 * `fcn_0040fafd` 的起手：速度 = (from − to) × 0.5、位置 = from + 速度（**都已推进半格**）。
 *
 * @param from   打得那一格（娃娃脚下）—— 传的节点号是 `path[step]`
 * @param to     娃娃**来的上一格** —— 传的节点号是 `path[step − 1]`；原版这两个参数
 *               来自 `special_players_state + 68/70`（= 用道具那一刻玩家的
 *               `nodeId` / `lastNodeId`，@source `rich4_tool_jiqiwawa.asm:37-39`），
 *               在娃娃那一支里逐格就是「当前格 / 上一格」
 * @param facing 物件记录 `+0x01` 的朝向 —— 原样抄进 `+0x07`
 */
export function objectKnockStart(from: KnockPoint, to: KnockPoint, facing = 0): ObjectKnock {
  // fmul qword [0x46352c] → 常数就是 double 0.5，再 fstp dword（单精度落点）
  const vx = Math.fround((from.x - to.x) * 0.5);
  const vy = Math.fround((from.y - to.y) * 0.5);
  return {
    x: Math.fround(from.x + vx),
    y: Math.fround(from.y + vy),
    vx,
    vy,
    timer: OBJECT_KNOCK_TIMER0,
    facing,
  };
}

/**
 * 走一拍 —— `+0x08 += +0x10` / `+0x0c += +0x14`（`fld`/`fadd`/`fstp dword`，单精度落点）。
 * @source `rich4.asm` 0x00408d47 那一段（`:1805-1810`）
 */
export function objectKnockTick(k: ObjectKnock): ObjectKnock {
  return { ...k, x: Math.fround(k.x + k.vx), y: Math.fround(k.y + k.vy) };
}

/**
 * 第 `tick` 拍（0 = 起手那一拍）物件画在**世界坐标**的哪里。
 *
 * @source 逐 tick 的消耗 `rich4.asm:1746-1810`（`fcn_0040829d` 的物件循环）：
 * ```asm
 * 00408cd9  cmp byte [obj + 6], 0 / je 0x408e0e   ; 计时到 0 ⇒ 走静态那支（本物件 node 已清 0 ⇒ 不画）
 * 00408cf4  fx = trunc(+0x08) ; fy = trunc(+0x0c) ; fld/fistp（__round_toward_zero）
 * 00408d0e  esi = (fx >> 5) − camTileX + 0xe      ; 列：0..0x1c = 29 格窗口
 * 00408d1a  edi = (fy >> 5) − camTileY + 0xe      ; 行：同上
 * 00408d23  if (esi < 0 || esi > 0x1c || edi < 0 || edi > 0x1c) {
 * 00408d32      byte [obj + 6] = 0 ; jmp 下一件    ; ★ 越出窗口 ⇒ 停，而且**这一拍不画**
 *           }
 * 00408d47  dec byte [obj + 6]                    ; ★ 先减
 *           … 算屏幕落点（下面才 += 速度）
 * 00408db1  fld [+0x10] / fadd [+0x08] / fstp [+0x08]
 * 00408dc5  fld [+0x14] / fadd [+0x0c] / fstp [+0x0c]
 * ```
 * ⇒ 一拍 = **先判窗口 → 再 `dec +0x06` → 画当时的坐标 → 最后才推进位置**。
 *   计时耗尽（`+0x06` 减到 0 之后的下一拍）物件落回静态那支，而娃娃扫掉的物件
 *   `nodeId` 已经被清 0 ⇒ **不再画**。
 *
 * @param tick      已经过去几拍（0 = 起手/娃娃刚走到那一格）
 * @param inWindow  这个**截断后的整数**坐标在不在 29×29 窗口里（绘制侧传 `worldToScreen` 那一问）
 * @returns 这一拍的记录；`null` = 这一拍**不画**（越界 / 计时耗尽 / tick 越界）
 */
export function objectKnockAt(
  from: KnockPoint,
  to: KnockPoint,
  facing: number,
  tick: number,
  inWindow: (x: number, y: number) => boolean = () => true,
): ObjectKnock | null {
  if (!Number.isFinite(tick) || tick < 0) return null;
  // +0x06 从 0xFF 起逐拍 −1：可画的是第 0..0xFE 拍（第 0xFF 拍时计时已归 0）
  if (tick >= OBJECT_KNOCK_TIMER0) return null;
  let s = objectKnockStart(from, to, facing);
  for (let t = 0; ; t++) {
    if (s.timer === 0) return null;
    // ★ 先判窗口，用的是**截断后**的整数坐标（`__round_toward_zero` + `sar 5`）
    if (!inWindow(Math.trunc(s.x), Math.trunc(s.y))) return null;
    s = { ...s, timer: s.timer - 1 };
    if (t === tick) return s;
    s = objectKnockTick(s);
  }
}

/** 娃娃扫掉的一件物件 —— 「该在哪一刻打飞」+ 打飞用的方向（纯数据） */
export interface SweptObjectDraw {
  /** 走**之前**那一件的记录（`nodeId` 已按 `path[step]` 补回，见下） */
  o: MapObject;
  /** 娃娃走到那一格（= 打飞开始）的时刻，毫秒，自这趟起步算 */
  hideAt: number;
  /**
   * 打飞的方向与朝向 —— `from` = 被打飞的那一格、`to` = 娃娃来的上一格。
   * `null` = 没有方向可用（`step ≤ 0`，即物件在**出发格**上；`runDoll` 的循环
   * 第一步就 `path.push`，故它交出来的 `step` 恒 ≥ 1，这一支只是防御）。
   */
  knock: { from: KnockPoint; to: KnockPoint; facing: number } | null;
}

/**
 * 機器娃娃这一趟**扫掉的物件** —— 每一件「该在哪一刻被打飞」，外加画它要的记录。
 *
 * ★ 出处与判据（试玩3 #11）：原版是**逐格 tick** 走的，落点处理
 *   `0x0041b4e7` 那一支在娃娃**走到那一格**时才把物件打飞并释放
 *   （`@source 0x0041b4e7` 那一段，见 `core/rules/special-actors.ts` 的
 *   `dollSweepNode`）。所以「打飞时刻」= 补间走到 `path[step]` 那一格**走完**的时刻，
 *   也就是 `steps[step - 1].at + steps[step - 1].ms`。
 *
 *   ⚠️ 本引擎 core 一次把九格走完，交出来的 `state.objects` 里那几件已经
 *   `nodeId = 0`（`dollSweepNode` 清掉的），画不出来了。它们的**位置**只能从
 *   补间的路径里取回来 —— 娃娃在 `path[step]` 清掉它，那一件的节点号就是
 *   `path[step]`（`dollSweepNode` 找的正是 `o.nodeId === cur`）。
 *   这不是猜：`cleared[].step` 由 `runDoll` 按同一次循环写下。
 *
 * ★ **打飞**（本轮补，`docs/deviations/Q-TOOL-1.md` 表格第 3 行原登记「没做」）：
 *   同一对节点就是 `fcn_0040fafd` 的两个参数 —— `from = path[step]`（娃娃脚下）、
 *   `to = path[step − 1]`（来路）。原版在 `0x0041b519` 依次
 *   `call fcn_0040fafd`（0x0041b519）+ `call remove_object`（0x0041b529）（@source `rich4_player_core_actions.asm:2663-2681`），
 *   速度写成 `(from − to) × 0.5` ⇒ **顺着娃娃前进的方向被轰出去**（像扫帚推着走）。
 *
 * @param steps     `actorWalkSteps(path, …)` 的产物
 * @param objects   这一趟**之后**的 `state.objects`（下标与走之前一一对应 ——
 *                  `dollSweepNode` 只改内容不挪位置）
 * @param path      `runDoll` 交出来的整趟路径（含起点）
 * @param cleared   `runDoll` 交出来的「下标 + 在哪一格」
 * @param nodes     地图节点表（下标 = 节点号 − 1）—— 取打飞的起终点坐标与物件朝向
 */
export function sweptObjectHideTimes(
  steps: readonly ActorWalkStep[],
  objects: readonly MapObject[],
  path: readonly number[],
  cleared: readonly SweptObject[],
  nodes: readonly MapNode[],
): SweptObjectDraw[] {
  const out: SweptObjectDraw[] = [];
  for (const c of cleared) {
    const o = objects[c.index];
    if (o === undefined) continue;
    // 被扫掉那一件的节点号 = 娃娃清它的那一格（`runDoll` 的 `path[c.step]`）
    const nodeId = path[c.step] ?? 0;
    if (nodeId <= 0) continue;
    // 「走到那一格」= 那一步走完；`step === 0`（出发格）没有步，故立刻算走完
    const prev = c.step <= 0 ? null : steps[c.step - 1];
    const hideAt = prev === null || prev === undefined ? 0 : prev.at + prev.ms;
    // ★ 打飞方向：from = 这一格、to = 来路那一格。朝向照抄物件自己的
    //   `+0x01`（原版 `+0x07 ← +0x01`；本引擎不存朝向，按同一条规则现推）。
    const fromNode = nodes[nodeId - 1];
    const toId = c.step > 0 ? (path[c.step - 1] ?? 0) : 0;
    const toNode = toId > 0 ? nodes[toId - 1] : undefined;
    const knock =
      fromNode === undefined || toNode === undefined
        ? null
        : {
            from: { x: fromNode.x, y: fromNode.y },
            to: { x: toNode.x, y: toNode.y },
            facing: objectFacing(fromNode, nodes, directionOf),
          };
    out.push({ o: { ...o, nodeId }, hideAt, knock });
  }
  return out;
}

/**
 * 娃娃那趟的一件物件在**这一刻**画在哪 —— 纯函数（`#objectSlots` 与
 * `#drawSweptFlights` 共用，判据全在上面两个函数里）。
 *
 * - `{ kind: 'ground' }`：娃娃还没走到那一格 ⇒ 照旧画在 `s.o.nodeId` 那一格上；
 * - `{ kind: 'fly', … }`：**已经打飞** ⇒ 按飞行位置画（世界坐标，已截断成整数，
 *   与原版 `__round_toward_zero` 同）；
 * - `null`：这一拍不画（越出 29×29 窗口 / 计时耗尽 / 没有方向）。
 */
export type SweptObjectFrame =
  | { kind: 'ground' }
  | { kind: 'fly'; x: number; y: number; facing: number }
  | null;

export function sweptObjectFrameAt(
  s: SweptObjectDraw,
  elapsedMs: number,
  tickMs: number,
  inWindow: (x: number, y: number) => boolean,
): SweptObjectFrame {
  if (elapsedMs < s.hideAt) return { kind: 'ground' };
  if (s.knock === null) return null;
  const ms = tickMs > 0 ? tickMs : 1;
  const tick = Math.floor((elapsedMs - s.hideAt) / ms);
  const k = objectKnockAt(s.knock.from, s.knock.to, s.knock.facing, tick, inWindow);
  return k === null ? null : { kind: 'fly', x: Math.trunc(k.x), y: Math.trunc(k.y), facing: k.facing };
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
  /**
   * ★ **冬眠中**（替身记录 `+12`）—— 绘制时要套 `ASLEEP_FILTER` 去色。
   *
   * @source `rich4.asm:1533` `cmp byte [eax + 0x498e34], 0` → `_rich4_convert_sprite`。
   * 与「夢遊走姿」（`+13`）是**两个不同的字段**：冬眠画成灰、夢遊换走姿图组。
   */
  frozen: boolean;
  /**
   * ★ **夢遊中**（替身记录 `+13`）—— 棋子上方再贴一张「ZZZ」（`SLEEPWALK_MARK_RESOURCE`）。
   * @source `0x00408acb cmp byte [rec + 0x498e35], 0` → `0x00408b26 mov eax, [0x496978]`
   */
  sleepwalking: boolean;
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
  const bySlot = new Map<number, ActorWalk>();
  for (const w of supplied ?? []) bySlot.set(w.slot, w);
  const walks: ActorWalk[] = [];
  const next = new Map<number, number>();
  for (let slot = 0; slot < SPECIAL_ACTOR_COUNT; slot++) {
    const a = actors[slot];
    const suppliedWalk = bySlot.get(slot);
    const path = suppliedWalk?.path;
    // ★ 「在不在盘上」**不能**先于 `supplied` 判 —— 有两趟走完的人已经不在盘上了：
    //   ① 機器娃娃 `runDoll` 走完就 `idleActor()`（state 里 `nodeId=0 / place=offBoard`）；
    //   ② 惡人半路踩回監獄／醫院（`place = 監獄/醫院`）。
    //   先判在盘上会把宿主喂来的整趟路径整条跳过（D-T047-6，实测起 0 条补间）。
    if (a === undefined || a.place !== ACTOR_PLACE.board || a.nodeId <= 0) {
      // 落点记账用**路径末格**，这样同一份 `supplied` 不会每帧重播。
      const endsAt = path === undefined ? ACTOR_OFF_BOARD : (path[path.length - 1] ?? ACTOR_OFF_BOARD);
      next.set(slot, endsAt);
      if (suppliedWalk !== undefined && path !== undefined && path.length >= 2 && seen.get(slot) !== endsAt) {
        // ★ `cleared` 要原样带过去（機器娃娃扫掉的那几件靠它逐格消失）
        walks.push(suppliedWalk);
      }
      continue;
    }
    const endsAt = path === undefined ? a.nodeId : (path[path.length - 1] ?? a.nodeId);
    const last = seen.get(slot);
    next.set(slot, endsAt);
    if (last === endsAt) continue; // 没换落点 = 还是同一趟
    if (last === undefined && path === undefined) continue; // 首帧：不播
    if (suppliedWalk !== undefined) {
      walks.push(suppliedWalk);
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
    // ★ 夢遊走姿（+3）读替身记录 `+13` —— 只有**在盘上**的才有记录可读
    const asleep = onBoard && (a?.sleepwalkDays ?? 0) !== 0;
    const resource = specialActorImageSet(actor, walking, node.noObjects === true, asleep);
    // ★ 冬眠变灰（`record + 12`）—— 与「夢遊走姿」是两个不同的字段，别合并
    const frozen = onBoard && isActorAsleep(a ?? {});
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
      /** ★ 冬眠中 —— 绘制时套 `ASLEEP_FILTER`（原版 `_rich4_convert_sprite`）*/
      frozen,
      sleepwalking: asleep,
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
/**
 * 棋子的**世界坐标** —— 原版画棋子时直接读 `player+0x08/+0x0a`（= `xpos/ypos`）。
 *
 * ★★ **不能用 `nodeId` 现推**（2026-09-18 第 86 条）：那两个字节**只在关押期间**
 *   才不等于所在格坐标 —— 入監/入院把屏幕坐标写成特殊景观记录
 *   （監獄 → 记录 2「綠島」、醫院 → 记录 1「醫院大樓」，
 *   `@source 0x43d643`/`0x43ecef`）。用节点坐标会让坐牢的人站在監獄格上，
 *   而原版让他站在綠島上。
 *
 * 返回 `null` = 这一位不画（`nodeId == 0`；原版那条判据是 `xpos != 0`，
 * 两者在"没有任何节点的世界坐标是 0"这条上等价 —— 见 `docs/deviations/T-086.md`）。
 */
export function playerAnchorWorld(p: {
  nodeId: number;
  xpos: number;
  ypos: number;
}): { x: number; y: number } | null {
  if (p.nodeId <= 0) return null;
  if (p.xpos === 0 && p.ypos === 0) return null;
  return { x: p.xpos, y: p.ypos };
}

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
  /**
   * ★ 定時炸彈背在身上时，炸彈上方那个**倒数**（第八份试玩回报 #2）—— 其余物件为 null。
   *
   * @source 塞槽时 `0x00408ca7 cmp byte [obj+0x496d08],0x12 / 0x00408cb1 or byte [slot+1],0x40`
   *   给槽打标；画槽时 `0x004098c7 test al,0x40` → `0x004098f3 mov al,[obj+0x496d0c]`（= `state`，
   *   还剩几步）→ `sprintf(buf, "%d")`（`0x4631d3`）→ `0x00409929 call 0x44fabc(0, buf, slot.x, slot.y − 0x3c, 2)`
   *   ⇒ 数字**中心**在物件锚点上方 60 px（对齐 2 = 水平/垂直都居中）。
   */
  fuse: number | null;
}

/** 倒数数字相对物件锚点的位置 @source `0x00409916 sub eax,0x3c` */
export const BOMB_FUSE_DY = -0x3c;

/**
 * 住宿 / 消失 / 坐牢 / 住院中的棋子画不画 —— 原版只在「位置被外力挪过」（`whoPlays & 0x20`）时才画。
 * @source `0x00408691 cmp dword [player+0x32],0 / je` → `0x0040869a test byte [player+0x15],0x20 / je 跳过`
 */
export function confinedPlayerDrawn(p: {
  whoPlays: number;
  blocking: { inHotel: number; disappearing: number; inPrison: number; inHospital: number };
}): boolean {
  const b = p.blocking;
  const confined = b.inHotel !== 0 || b.disappearing !== 0 || b.inPrison !== 0 || b.inHospital !== 0;
  return !confined || (p.whoPlays & 0x20) !== 0;
}

/**
 * 炸彈上方那个白色小数字 —— 16 px 白字 + #101010 描边（棋盘上的小字都是这一套），中心对齐。
 * @source `0x00409929 call 0x44fabc(0, "%d", x, y − 60, 2)`（对齐 2 = 中/中）
 */
export function drawBombFuse(ctx: CanvasRenderingContext2D, fuse: number, cx: number, cy: number, k = 1): void {
  ctx.save();
  ctx.font = `bold ${16 * k}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 * k;
  ctx.strokeStyle = '#101010';
  ctx.fillStyle = '#ffffff';
  const text = String(fuse);
  ctx.strokeText(text, cx, cy);
  ctx.fillText(text, cx, cy);
  ctx.restore();
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
    // ★ 表项的内存顺序是 `(X, Y)`（@source 0x00408c69 的 `+0` 加进屏幕 X）——
    //   `attachedOffset` 的字段名与之一一对应，不再绕 `dx/dy` 两层。
    const { x: offsetX, y: offsetY } = attachedOffset(o.type, owner.godInfo, image);
    out.push({
      index: i,
      type: o.type,
      owner: owner.index,
      ownerNodeId: owner.nodeId,
      resource,
      frame: attachedFrameIndex(image),
      offsetX,
      offsetY,
      fuse: o.type === OBJECT_TYPE_BOMB ? o.state : null,
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
   * 绘制槽 `+6` 的原值：1..4 = 按 `player[n-1]` 的角色色换掉调色板 #255；
   * **0 = 无主 ⇒ 换成黑**；`SLOT_NO_RECOLOR`（0xff）= 不换色。见 `ringColor`。
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
    return { resource: EMPTY_LAND_LOGO_RESOURCE, image: input.character, paletteOwner: SLOT_NO_RECOLOR };
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
  /**
   * 住宅地块那一支带上**自己那块地的 id**（设施/企业/景观没有）。
   *
   * ★ W-69：过路费那段演出要按 id 把「算进这笔钱的地块」一起调亮，
   *   而调亮发生在**绘制**这一层（`RenderInput.landFlash`）—— 所以清单里
   *   必须能认出每一件是哪个地块。其它三张表与过路费无关，故可缺省。
   */
  landId?: number;
  /** 设施那一支带上**自己的設施 id**（新聞 18 / 19 的白闪按它认，见 `RenderInput.landFlash`） */
  facilityId?: number;
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
      landId,
      // ★ 外圈那圈线按**所有者的角色专属色**换色（见 assets.ts 的 RING_PALETTE_INDEX）：
      //   @source VA 0x00409853 —— 槽 +6 非 0xff 时把 `player[owner-1].+0x04`（角色色）
      //   写进精灵的调色板 #255。
      ...withRing(ringColor(state, art.paletteOwner)),
    });
  }

  // ── 设施（機場/港口…）──
  const gameStage = state.globalMapId >> 2;
  const gameMap = state.globalMapId & 3;
  const base = facilitySheetBase(gameStage, gameMap);
  for (const f of map.facilities) {
    // ★★ 2026-09-18 修「大型空地一开局就被画成青色边框的公園」：**读运行时状态**，
    //   而且**等级 0 先分流**，与 exe 同序：
    // ```asm
    // 004093f3  cmp byte [ebp + 0x1a], 0      ; ★ facility.level（+0x1a）== 0 ？
    // 004093f7  je  0x409457                  ;   → 空地那一支，**根本不去查 type 跳转表**
    // ```
    //   ⚠️ 地图文件里 facility 的 `+0x18`(type) / `+0x19`(owner) / `+0x1a`(level)
    //   **恒为 0**（`map-format.md` §4.6 的实测表）：它们是运行期字段，
    //   真值住在 `GameState.facilityType/Level/Owner`（下标 = 設施 id）。
    //   先前这里读模板的 `f.type/f.level` ⇒ `facilitySlot(0, 0)` = **槽 0 = 公園**，
    //   于是每一块还没盖的商業用地都被画成了公園 —— 正是用户看到的那一幕。
    const level = state.facilityLevel[f.id] ?? f.level;
    const owner = state.facilityOwner[f.id] ?? f.owner;
    const type = state.facilityType[f.id] ?? f.type;
    if (level < 1) {
      // ▸ 空地（等级 0）
      if (owner === 0) continue;
      // @source VA 0x0040945e `cmp byte [ebp+0x19], 0 / je 0x409486`（无主 → 不画）
      // @source VA 0x00409486 `xor edi,edi / mov [slot+0x48a84c], edi` —— 资源 0 ⇒ 整条跳过
      // @source VA 0x00409464 `mov eax,[0x48aea8]` = map.mkf #25（空地 logo）
      // @source VA 0x00409478 `al = player[owner-1].+0x13` —— ★ 图号 = **角色号**，不吃视角
      // @source VA 0x00409457 `[slot+6] = 0xff` —— 这一支**不换归属色**
      items.push({
        x: f.x,
        y: f.y,
        res: EMPTY_LAND_LOGO_RESOURCE,
        img: state.players[owner - 1]?.character ?? 0,
        facilityId: f.id,
      });
      continue;
    }
    // ▸ 盖过（等级 ≥ 1）才查 `type` 的 5 路跳转表（@source VA 0x00409412 `jmp [eax*4+0x408289]`）
    items.push({
      x: f.x,
      y: f.y,
      res: base + facilitySlot(type, level),
      // @source VA 0x004093c3：与建筑同一算式，朝向在 facility +0x1b
      img: buildingImageIndex(f.facing, view),
      facilityId: f.id,
      // @source VA 0x004093f9 `mov al,[ebp+0x19] / mov [槽+0x48a852],al` —— 原值照抄，0 也照抄
      ...withRing(ringColor(state, owner)),
    });
  }

  // ── 上市企业与特殊景观：共用「索引 + 38」那套 ──
  for (const c of map.commercials) {
    const res = sceneryResource(c.spriteIndex);
    if (res === null) continue;
    // ★ 下标 = 企業 **id**（1 基，0 号空着）—— 与 core 全体一致（`reduce.ts` / `stock-policy.ts` …）。
    //   先前写成 `c.id - 1`：2 号企業显示的是 1 号董事長的颜色、1 号永远没有彩边。
    const co = state.commercialOwners[c.id]?.owner ?? 0;
    items.push({
      x: c.x,
      y: c.y,
      res,
      // @source VA 0x0040964d：朝向在 commercial +0x1b（实测八张地图都在 0..7）
      img: buildingImageIndex(c.facing ?? 0, view),
      // @source VA 0x00409643 `mov al,[ebp+0x18] / mov [槽+0x48a852],al` —— 无主 = 0 ⇒ 黑线
      ...withRing(ringColor(state, co)),
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
   * 夢遊标记（「ZZZ」）的帧号 —— **每人一份**（原版 `[0x498ea4 + 编号×0x34]`），
   * 键同 `#held`：玩家 `p0..p3`、替身 `a0..a4`。只在**这个人夢遊着走子**时一 tick 进一帧
   * （见 `SLEEPWALK_MARK_FRAMES`），不走就停在那一帧。纯表现，不进 state。
   */
  readonly #sleepwalkMarkFrame = new Map<string, number>();
  /** 这一帧谁在夢遊（`draw` 开头从 state 抄一份，补间推帧那里要用）：键同上 */
  #sleepwalkingNow: ReadonlySet<string> = new Set();
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
    /** ★ 未截断的拍数 `N_f`（原版每拍位移除的是它；见 `tweenTickExact`）*/
    exactTicks: number;
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
  /** 押着没起步的替身槽（见 `holdActorWalk`）*/
  readonly #heldActorSlots = new Set<number>();

  readonly #actorWalks = new Map<
    number,
    {
      steps: ActorWalkStep[];
      /** 起步时定下的步数 —— 见 `actorStepsLeft`（E-22）*/
      rolled: number;
      start: number;
      tickMs: number;
      ticked: number;
      /**
       * 这一趟沿途**扫掉的物件**（機器娃娃）+ 各自该在第几毫秒消失。
       *
       * ★ 试玩3 #11：`o` 是**走之前**那一件的记录（节点号还在，见
       *   `sweptObjectHideTimes`），所以补间还没走到它那一格时照常画它
       *   （`#objectSlots`）；走到之后改画**打飞**那一段
       *   （`#drawSweptFlights`，`sweptObjectFrameAt` 判）。
       */
      swept: SweptObjectDraw[];
    }
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
   * **正在飞的物件**（機器娃娃打飞的那几件）—— 与替身补间**分开存**。
   *
   * ★ 为什么不能挂在 `#actorWalks` 上：原版那颗 `+0x06` 计时是**物件自己的**，
   *   娃娃那一趟走完（补间被 `#actorWalkScreen` 删掉）之后物件照样继续飞
   *   （`0x408cd9` 那一支每帧照跑）。挂在替身补间上会有一个可见缺口：
   *   被扫在**最后一格**上的那一件，`hideAt` 正好等于整趟的总时长，
   *   那一拍补间刚被删 ⇒ 它一辈子也画不出「飞出去」。
   *
   * ⚠️ 纯表现、不进 state（C-DET-4）；飞行结束（越出 29×29 / 计时耗尽）即从表里掉。
   */
  #sweptFlights: { s: SweptObjectDraw; start: number; tickMs: number }[] = [];
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
   * @source `fcn_0040c05c`：tick 数 = `trunc(世界距离 / 走子速度)`，
   *   线性等分、**一个 tick 一帧**（细节与出处见 `tween.ts`）。
   *
   * ★★ tick 数按**世界坐标**（节点记录 `+0x00`/`+0x02`）算，**与镜头/视角/缩放无关**
   *   —— 原版这一支从头到尾不碰投影（`@source 0x40c1d4..0x40c23e`：起点取节点记录，
   *   终点取落点记录，相减求模长）。先前这里用 `worldToScreen` 的距离，于是
   *   视角一转 tick 数就变、镜头外的落点还会退化成 1 tick。
   *   屏幕坐标只在**画**的时候用（见 `#walkScreen`）。
   *
   * ⚠️ 「動畫過程」（`[0x497159]`）**不闸**走子补间 —— 原版的 22 个读点全在影片
   *   （FLIC）播放处，`0x40c05c` / `0x40d7c4` 一个都没有。`enabled` 只留给
   *   「静音/无动画」这类调试用途，正常开局恒为真。见 `docs/known-deviations.md`。
   *
   * @param traffic 交通方式（0 走路 / 1 機車 / 2 汽車 / 3 船）→ 速度 [8,12,16,8]（**世界单位**每 tick）
   * @param special 原版 `slot != 0 || (player.flags & 0x30)` 那一支
   * @param tickMs  一个 tick 多少毫秒（见 `tick.ts`）
   */
  startWalk(
    player: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    traffic = 0,
    special = false,
    tickMs = 20,
    now = performance.now(),
  ): void {
    const ticks = tweenTickCount(to.x - from.x, to.y - from.y, traffic, special);
    // ★★ 每拍位移除的是**未截断**的 N_f（原版 `0x0040c2ae`），只有末拍吸附落点
    const exactTicks = tweenTickExact(to.x - from.x, to.y - from.y, traffic, special);
    this.#walk = { player, from, to, ticks, exactTicks, tickMs, start: now, ticked: 0 };
    // ★ W-66-b 的量测口径：这一段的**理论结束时刻**（`start + ticks × tickMs`）。
    //   下一段起步时拿它相减就是「格与格之间的缝」——原版同一个 tick 里收尾并起步，
    //   缝是 0。只给 DEV 量测读，正常路径不用它（见 `lastWalkEndAt`）。
    this.#lastWalkEndAt = now + ticks * tickMs;
    this.#dirty = true;
  }

  /**
   * ★ W-66-b：上一段走子补间的**理论结束时刻**（`performance.now()` 口径）；
   *   还没播过任何一段时返回 `null`。
   *
   * 用途只有一个：`main.ts` 在 DEV 下量「上一格收尾 → 下一格起步」的缝
   * （`__rich4.walkGaps()`）。**不要**拿它推进动画 —— 表现层的时间轴一律
   * 由 `walkDone` / `actorCenterWorld` 自己算。
   */
  lastWalkEndAt(): number | null {
    return this.#lastWalkEndAt;
  }

  /** @see lastWalkEndAt */
  #lastWalkEndAt: number | null = null;

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

  /**
   * 玩家这一步补间**还剩**多久（毫秒）；没有补间 / 已播完 = 0。
   *
   * ★ 宿主排「下一步」要用这个而不是 `lastWalkMs()`：后者在补间播完之后**仍然**返回
   *   整段时长（`#walk` 不清），于是走完之后的 結算 / 收尾 / 下一位开局每一步都白等一整格的时间。
   */
  walkRemainingMs(now = performance.now()): number {
    const w = this.#walk;
    return w === null ? 0 : Math.max(0, w.ticks * w.tickMs - (now - w.start));
  }

  /**
   * 这一位此刻是不是**正被补间挪动** —— 「走回棋盘」那一趟要靠它摆「走」姿。
   *
   * ★★ 为什么不能只看 `state.phase === 'moving'`：「走回棋盘」那一回合 core 让它
   *   整回合不掷骰（`phase` 是 `turnEnd`），可原版这一趟**照样摆走姿**：
   * ```asm
   * ; @source 0x40dd1f（起步函数）的 +0x15 & 0x30 支
   * 0040dd37  test byte [edx + 0x496b7d], 0x30 / je 0x40dd53
   * 0040dd40  mov  dword [0x48baf8], 1        ; 只走一格
   * 0040dd4a  mov  byte [eax + 0x498ea2], 1   ; ★ 形态 = 1
   * ; 画棋子时用它选图组：@source 0x00408787 取 [0x498ea2]、
   * ;   0x004087af 读 [state*8 + 0x498eb4]；
   * ;   _rich4_update_player_sprite（0x40bbd8）按 edi(站)/edi+1(走)/edi+2(骰)
   * ;   装入 0x40bc4a / 0x40bc67 / 0x40bc84 ⇒ state 1 = **走**
   * ```
   *   ⇒ 只看 `phase` 的话，棋子会用**站姿**滑完 11/13 拍。
   */
  isWalking(player: number, now = performance.now()): boolean {
    const w = this.#walk;
    return w !== null && w.player === player && now - w.start < w.ticks * w.tickMs;
  }

  // ── 替身（四大惡人 / 機器娃娃）的走子补间 ──────────────────────────

  /**
   * 替身这一趟补间**还剩**多久（毫秒）—— 宿主拿它当「等替身走完」的节拍。
   *
   * ⚠️ 与玩家那条不同：替身的整趟是在**一次** `dispatch` 里跑完的，
   *   而补间要等下一次 `draw()` 才起得来，所以 `lastWalkMs()` 帮不上忙 ——
   *   宿主得在 dispatch **之后**再问这个（见 `docs/deviations/T-047.md`）。
   */
  /**
   * ★ 第十四份：**押着**这一格的下一趟替身补间（機器娃娃要等用道具那句台词说完才上路）。
   *   押着期间那一趟照常「登记」（沿途要被扫掉的物件照旧画在原地），但起点定在 +∞：
   *   替身不画、物件不飞；`releaseActorWalks(now)` 那一刻才从头走。
   *
   * @source 機器娃娃 `0x00446b2e call 0x44ef41`（台词，同步）在娃娃上路（`fcn_0040dd1f`）之前。
   */
  holdActorWalk(slot: number): void {
    this.#heldActorSlots.add(slot);
  }

  /** 放开 `holdActorWalk` 押着的那几趟：起点改成 `now`（沿途物件的打飞计时一起挪）。返回放开了几趟 */
  releaseActorWalks(now = performance.now()): number {
    let n = 0;
    for (const slot of this.#heldActorSlots) {
      const w = this.#actorWalks.get(slot);
      if (w === undefined || Number.isFinite(w.start)) continue;
      w.start = now;
      for (const f of this.#sweptFlights) if (w.swept.includes(f.s)) f.start = now;
      n++;
    }
    this.#heldActorSlots.clear();
    this.#dirty = true;
    return n;
  }

  /** 这一格的补间是不是还押着没起步（见 `holdActorWalk`）*/
  actorWalkHeld(slot: number): boolean {
    const w = this.#actorWalks.get(slot);
    return this.#heldActorSlots.has(slot) || (w !== undefined && !Number.isFinite(w.start));
  }

  actorWalkRemainingMs(now = performance.now()): number {
    let best = 0;
    for (const w of this.#actorWalks.values()) {
      const left = actorWalkTotalMs(w.steps) - (now - w.start);
      if (left > best) best = left;
    }
    return best;
  }

  /**
   * 玩家**自己**那条补间播完了吗 —— 与 `walkDone()` 的差别是**不含替身**。
   * 走子时那串剩余步数要分清「谁在走」（E-22）：替身走的时候不能给玩家的值补 1。
   */
  playerWalkDone(now = performance.now()): boolean {
    const w = this.#walk;
    return w === null || now - w.start >= w.ticks * w.tickMs;
  }

  /**
   * 此刻在走的那个替身**还剩几格**；没有替身在走 = 0（见 `actorStepsLeft`）。
   * 一条 action 只走一个替身（`npcRoundStep`），同时有多条时取槽位最小的那条。
   */
  actorStepsLeft(now = performance.now()): number {
    for (const slot of [...this.#actorWalks.keys()].sort((a, b) => a - b)) {
      const w = this.#actorWalks.get(slot)!;
      const left = actorStepsLeft(w.steps, w.rolled, now - w.start);
      if (left > 0) return left;
    }
    return 0;
  }

  /** 替身补间还在播吗（一条都没有也算播完） */
  actorWalkDone(now = performance.now()): boolean {
    let running = false;
    for (const [slot, w] of [...this.#actorWalks]) {
      if (now - w.start >= actorWalkTotalMs(w.steps)) this.#forgetActorWalk(slot);
      else running = true;
    }
    return !running;
  }

  /** 丢掉没播完的替身补间（读档、换屏时用） */
  cancelActorWalk(): void {
    this.#actorWalks.clear();
    this.#actorSeen.clear();
    this.#actorFrame.clear();
    this.#sweptFlights.length = 0;
  }

  /** 一条替身补间播完/被丢掉 */
  #forgetActorWalk(slot: number): void {
    this.#actorWalks.delete(slot);
  }

  /**
   * 还有**打飞的物件**在飞吗 —— 宿主拿它续帧。
   *
   * ★ 为什么需要：这一族动画与替身补间**不同寿**（物件那颗 `+0x06` 计时自己跑，
   *   娃娃走完它照样飞，见 `#sweptFlights`）。而本引擎是**按需重绘**的，走完
   *   那一拍之后若没有别的演出，就没人再要帧了 —— 最后那几拍会冻在屏上。
   *   只影响「要不要再画一帧」，**不**进 `stageBusy`（原版物件飞行不挡回合）。
   */
  sweptFlightActive(): boolean {
    return this.#sweptFlights.length > 0;
  }

  /**
   * 起一条替身补间 —— `path` 依次经过的节点号（含起点）。
   *
   * tick 数按**世界坐标**距离算（镜头无关），且一律走 `dist × 0.125` 那一支
   * （见 `actorWalkSteps` 的出处）。
   */
  #beginActorWalk(
    slot: number,
    nodes: readonly MapNode[],
    path: readonly number[],
    tickMs: number,
    now: number,
    objects: readonly MapObject[] = [],
    cleared: readonly SweptObject[] = [],
    rolled?: number,
  ): void {
    this.#forgetActorWalk(slot);
    if (path.length < 2) return;
    const steps = actorWalkSteps(path, nodes, tickMs);
    if (steps.length === 0) return;
    const swept = sweptObjectHideTimes(steps, objects, path, cleared, nodes);
    // ★ 第十四份：押着的那一格起点定在 +∞（`releaseActorWalks` 再改成放开那一刻）
    const start = this.#heldActorSlots.has(slot) ? Number.POSITIVE_INFINITY : now;
    this.#actorWalks.set(slot, {
      steps,
      rolled: rolled ?? steps.length,
      start,
      tickMs,
      ticked: 0,
      swept,
    });
    // ★ 打飞那几件的**飞行**另起一份（`#sweptFlights`）—— 它们的时长由物件自己的
    //   `+0x06` 决定，与娃娃这一趟的补间无关（见那一处字段说明）。
    for (const s of swept) this.#sweptFlights.push({ s, start, tickMs });
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
    supplied: readonly ActorWalk[] | undefined,
    tickMs: number,
    now: number,
  ): void {
    const r = actorWalkTriggers(state.specialActors, this.#actorSeen, supplied);
    this.#actorSeen.clear();
    for (const [slot, nodeId] of r.seen) this.#actorSeen.set(slot, nodeId);
    // 不在棋盘上的槽：把没播完的补间收掉（他可能在半路被送回監獄／醫院）
    for (const [slot] of [...this.#actorWalks]) {
      if (r.seen.get(slot) === ACTOR_OFF_BOARD) this.#forgetActorWalk(slot);
    }
    for (const w of r.walks) {
      this.#beginActorWalk(w.slot, nodes, w.path, tickMs, now, state.objects, w.cleared, w.steps);
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
    // ★ 第十四份：押着还没起步（`holdActorWalk`）⇒ 这一帧不画替身
    if (elapsed < 0) return null;
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
    // ★ 插值走**世界坐标**，投影到屏幕 —— 与 exe 同一条：
    //   原版每 tick 把世界位置加一个 `dx/N_f`，**画的时候**才投影
    //   （`0x40c38a`/`0x40c3a4` 写 `+0x496b70/+0x496b72`）。投影带透视畸变，
    //   所以「世界线性」≠「屏幕线性」，不能在屏幕上等分。
    const k = Math.min(step.ticks, Math.floor((elapsed - step.at) / w.tickMs) + 1);
    const absolute = step.tickAt + k;
    if (absolute > w.ticked) {
      this.#actorFrame.set(slot, (this.#actorFrame.get(slot) ?? 0) + (absolute - w.ticked));
      this.#advanceSleepwalkMark(`a${slot}`, absolute - w.ticked);
      w.ticked = absolute;
    }
    const p = walkFramesFor(step.from, step.to, step.ticks, step.exactTicks)[k - 1];
    if (p === undefined) return null;
    const s = worldToScreen(p.x, p.y, cam, vp);
    if (s === null) return null;
    // @source 逐格前进时写 `+9 direction`（`_rich4_calculate_direction`，VA 0x00454fb4）
    return { x: s.x, y: s.y, nodeId: step.toNode, direction: actorWalkDirection(step) };
  }

  /**
   * 此刻**正在走的替身**（娃娃 / 四大惡人）的插值世界坐标；没有替身在走 = `null`。
   *
   * 原版那一趟 `[0x49910c]` = 替身号（4..8），坐标在替身记录 `+0x00/+0x02`
   * （`fcn_0040dd1f` 那一族逐 tick 写）。镜头（`actorCenterWorld`）与侧栏小地图的
   * 白框（`hud.ts` 的 `minimapFrameCenter`，VA 0x00416f3d 那一支）都认它。
   *
   * `slot` = actor − 4（0..3 四大惡人、4 機器娃娃）—— 侧栏面板据此换成惡人那一版
   * （`hud.ts` 的 `panelSubject`，VA 0x00415fc1 / 0x00416767 判 `[0x49910c]`）。
   */
  npcWalkWorld(now: number): { x: number; y: number; slot: number } | null {
    for (const slot of [...this.#actorWalks.keys()].sort((a, b) => a - b)) {
      const w = this.#actorWalks.get(slot);
      if (w === undefined) continue;
      const elapsed = now - w.start;
      if (elapsed >= actorWalkTotalMs(w.steps)) {
        this.#actorWalks.delete(slot);
        continue;
      }
      let step = w.steps[w.steps.length - 1]!;
      for (const st of w.steps) {
        if (elapsed < st.at + st.ms) {
          step = st;
          break;
        }
      }
      const kk = Math.min(step.ticks, Math.floor((elapsed - step.at) / w.tickMs) + 1);
      const pt = walkFramesFor(step.from, step.to, step.ticks, step.exactTicks)[kk - 1];
      if (pt !== undefined) return { x: pt.x, y: pt.y, slot };
    }
    return null;
  }

  /**
   * ★★ 镜头该跟着**谁**（屏幕坐标）—— 给「视角跟踪」用。
   *
   * 从上一版起，镜头只在换人行动时交还给当前玩家；但需求方指出两件原版就有的行为
   * （第四份回报第 2 条）：
   *   ① 棋子**一步步走**的时候镜头要跟着他走；
   *   ② **機器娃娃/四大惡人**那一趟也要跟着走，走完再回到当前玩家身上。
   *
   * 这两条的证据是原版那两支共用同一个「画在哪」的世界坐标：
   *   · 玩家：`player + 0x08/+0x0a`（走路例程每 tick 累加，`0x40c38a`/`0x40c3a4`）；
   *   · 替身：`0x498e28 + slot*0x10` 的 `+0x00/+0x02`（`fcn_0040dd1f` 那一族），
   *     镜头居中用的是**同一个** `fcn_00415e70`（它只问「有没有标记、没有就用
   *     `[0x49910c]` 那个当前行动者」—— 而娃娃/惡人在盘上时 `[0x49910c]` 就被切成
   *     4..7，见 `rules/npc-walk.ts` 的说明）。
   * ⇒ 优先替身补间（它在走就以它为中心），否则走子补间的插值点，再否则 null
   *   （调用方按当前玩家的格心）。
   */
  actorCenterWorld(now: number): { x: number; y: number } | null {
    // ① 替身（娃娃 / 四大惡人）—— 槽位小的优先（原版游标 4..7 依次走）
    const npc = this.npcWalkWorld(now);
    if (npc !== null) return npc;
    // ② 玩家走子补间（`#walkScreen` 内部自己管那一段的推进）
    const w = this.#walk;
    if (w !== null) {
      const elapsed = now - w.start;
      if (elapsed < w.ticks * w.tickMs) {
        const kk = Math.min(w.ticks, Math.floor(elapsed / w.tickMs) + 1);
        const pt = walkFramesFor(w.from, w.to, w.ticks, w.exactTicks)[kk - 1];
        if (pt !== undefined) return { x: pt.x, y: pt.y };
      }
    }
    return null;
  }

  /**
   * 走子补间这一帧该画在**屏幕**的哪里；没有补间返回 null（调用方按格心画）。
   *
   * ★ 插值在**世界坐标**上做、画的时候才投影（`@source 0x40c38a` / `0x40c3a4`：
   *   原版每 tick 加的是世界位移，投影发生在绘制那一步）。投影有透视畸变，
   *   在屏幕坐标上等分与原版的曲线**不重合** —— 这是 2026-09-18 订正的第二处。
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

    const k = Math.min(w.ticks, Math.floor((now - w.start) / w.tickMs) + 1);
    if (k > w.ticked) {
      this.#walkFrame = (this.#walkFrame + (k - w.ticked)) & 0xff;
      this.#advanceSleepwalkMark(`p${playerIndex}`, k - w.ticked);
      w.ticked = k;
    }
    const frames = walkFramesFor(w.from, w.to, w.ticks, w.exactTicks);
    const p = frames[k - 1];
    if (p === undefined) return null;
    return worldToScreen(p.x, p.y, cam, vp);
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
    this.#sleepwalkingNow = sleepwalkingKeys(state);
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
    this.#syncActorWalks(state, map.nodes, input.actorWalks, input.tickMs ?? 20, nowMs);
    // 升天中的那一尊不进静态绘制槽（见 `RenderInput.godAscend`）
    const ascendHidden = input.godAscend?.objectIndex ?? null;

    const slots: DrawSlot[] = [
      ...this.#buildingSlots(map, state, camera, vp, input.landFlash ?? null),
      // ★ 棋盘上的**物件**（神明、路障、地雷、定時炸彈…）—— 原版与建筑同属
      //   类别 0 那一段（`fcn_0040829d` 的对象分支不 or 类别位，VA 0x00408efd），
      //   故一起排序、一起贴。先前**整个漏了**（需求方：「放置后看不到」）。
      ...this.#objectSlots(map, state, camera, vp, input.objectFlight ?? null, nowMs, ascendHidden),
      // ★ **附身于人**的物件（神明 / 被请上身的东西）—— 原版同一个循环的另一支
      //   （`test dh,dh / je` 的反面，VA 0x00408fa5），画在**主人身上**：
      //   位置 = 主人的屏幕坐标（走子补间时用插值点）+ 8 向偏移表，
      //   帧号 = 8 − 视角 + **主人**朝向 + 4。同样与建筑同一档排序。
      ...this.#attachedObjectSlots(map, state, camera, vp, input.objectFlight ?? null, ascendHidden),
      ...this.#playerSlots(map, state, camera, vp, input.characterPose ?? null, input.characterPoseFrame ?? null),
      ...this.#actorSlots(map, state, camera, vp, input.currentActor ?? null, nowMs),
    ];
    // 原版用 qsort 比低 16 位 int16；这里用稳定排序，键相同时保持压入顺序（不影响观感）
    slots.sort((a, b) => a.key - b.key);
    for (const s of slots) s.paint();

    // ★ 投掷动效画在清单**之上**：原版 `animate_object` 是直接贴屏幕的阻塞动画，
    //   根本不进绘制槽（所以飞着的物件能盖过比它高的建筑）。@source VA 0x0040e669
    const flight = input.objectFlight ?? null;
    if (flight !== null) this.#drawObjectFlight(flight, camera, nowMs);

    // ★ 神明升天同样直接贴屏幕（`god_detach` 的 `0x0040e57c call 0x456770`），画在清单之上
    this.#godAscendEnded = false;
    const ascend = input.godAscend ?? null;
    if (ascend !== null) this.#drawGodAscend(map, ascend, camera, vp, nowMs);

    // ★ 機器娃娃**打飞**的那些物件同样画在清单**之上**（`0x408cd9` 那一支也是
    //   拿着 `+0x08/+0x0c` 直接贴屏幕的），见 `#drawSweptFlights`。
    this.#drawSweptFlights(camera, vp, nowMs);

    // ★ 建屋影片（機器工人）画在**最后**：原版 `fcn_0045144f` 把 FLIC 直接贴到
    //   后台面/屏幕上（`[0x48c882]` bit0），根本不进绘制槽，位置是常数
    //   —— 屏幕 `(0, 0x28)` = 棋盘局部 `(0, 0)`，尺寸就是整块 440×440 棋盘。
    //   @source VA 0x00447350..0x0044735c / 0x0040b0f4..0x0040b0fd
    const buildFrame = input.buildFx ?? null;
    if (buildFrame !== null) {
      // ★ 棋盘**局部**坐标：原版的 (0, 0x28) 是屏幕坐标，减掉棋盘原点 40 才是这里
      //   （见 `BUILD_FX_BOARD_Y` 的说明 —— 先前直接用 0x28 会整体下移 40 px）。
      this.#ctx.drawImage(buildFrame, BUILD_FX_X, BUILD_FX_BOARD_Y, BUILD_FX_W, BUILD_FX_H);
    }

    // ★ 「盖在棋盘上的阻塞影片」那一族（住院/入獄/神明）同样画在最后：
    //   原版也是直接贴屏幕。落点/尺寸由宿主按规格给（已是棋盘局部坐标）。
    const boardFrame = input.boardFilm ?? null;
    if (boardFrame !== null) {
      this.#ctx.drawImage(
        boardFrame.bitmap,
        boardFrame.x,
        boardFrame.y,
        boardFrame.w,
        boardFrame.h,
      );
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
    const tilesAcross = ground.width >> 5;
    const tilesDown = ground.height >> 5;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // ★ 镜头的亚格余量：整层地面的角点一律**加**上镜头余量过矩阵的那一对偏移。
    //   @source `fcn_0040829d`：`004083cc call fcn_00407a2c(camX, camY, …)` 得 (oX, oY)，
    //   `004083e1 add [esp+0x34],0xdc / add [esp+0x20],0x104` 并进棋盘区中心，
    //   之后每块四角都是 `表值 + 这一对`（VA 0x00408479..0x004084fe）。
    //   ⚠️ 先前这里用 `ctx.translate(-o)`：一来**符号反了**，二来下面每块的
    //   `setTransform` 会把它整个顶掉 ⇒ 地面其实从不跟余量走，镜头逐像素动时
    //   地面按整格跳、棋子与建筑却在滑 —— 两层错位最多一格。
    const camOff = subtileOffset(cam.view, (cam.subX ?? 0) & 0x1f, (cam.subY ?? 0) & 0x1f);
    const cx = vp.w / 2 + camOff.x;
    const cy = vp.h / 2 + camOff.y;
    // 表是 29×29，取相邻角点故只能铺 28×28 格
    // ⚠️ 余量存在时要多铺一圈：可见范围会跨界（`subX/subY != 0` 时最多偏一格）
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
    now: number,
    ascendHidden: number | null = null,
  ): DrawSlot[] {
    const slots: DrawSlot[] = [];
    const tokens = objectTokens(state, map.nodes, cam.view, flight?.objectIndex ?? null).filter(
      (t) => t.index !== ascendHidden,
    );
    /**
     * ★ 试玩3 #11：**还没被娃娃走到的那几件** —— 它们已经不在 `state.objects`
     * 的图上（`dollSweepNode` 清掉了 `nodeId`），所以 `objectTokens` 不画它们。
     * 这里按**补间还没到那一刻**把它们补回原地；娃娃走到哪一格就打飞哪一件。
     *
     * 出处：原版是逐格 tick 走的，分派器 `0x0041b4e7` 那一支在娃娃**到达那一格**时
     * 才把物件打飞并释放（`@source 0x0041b4e7`）。「哪一件对应哪一格」由 core
     * 的 `runDoll` 给出（`cleared[].step`），时刻由 `sweptObjectHideTimes` 算。
     *
     * ★ **打飞那一段不在这里**（`elapsed >= hideAt` 之后）：原版那几拍是把物件
     *   按 `+0x08/+0x0c` 直接贴屏幕的（`0x408cd9` 那一支），本引擎照
     *   `#drawObjectFlight` / `buildFx` 的成法画在**清单最后**（`#drawSweptFlights`）。
     */
    for (const w of this.#actorWalks.values()) {
      const elapsed = now - w.start;
      for (const s of w.swept) {
        if (elapsed >= s.hideAt) continue; // 已经走到那一格 = 开始打飞（画在清单最后）
        const node = map.nodes[s.o.nodeId - 1];
        if (node === undefined) continue;
        const resource = objectSpriteResource(s.o.type);
        if (resource === null) continue;
        const p = worldToScreen(node.x, node.y, cam, vp);
        if (p === null) continue;
        const image = objectImageIndex(objectFacing(node, map.nodes, directionOf), cam.view);
        const slot = this.#objectSlot(resource, image, p);
        if (slot !== null) slots.push(slot);
      }
    }
    for (const t of tokens) {
      const p = worldToScreen(t.x, t.y, cam, vp);
      if (p === null) continue; // 越出 29×29 窗口，原版同样跳过
      const slot = this.#objectSlot(t.resource, t.image, p);
      if (slot !== null) slots.push(slot);
    }
    return slots;
  }

  /**
   * 一件棋盘物件的绘制槽 —— 两条来源（`state.objects` 里还在图上的、
   * 以及娃娃还没走到的）画的是同一个东西，故共用这一处。
   *
   * @source 绘制槽 `+8` 写 `0xff`（VA 0x00408f60，不换色）、
   *   类别位同建筑（VA 0x00408efd 不 or 类别位）→ `DRAW_CLASS.building`
   */
  #objectSlot(resource: number, image: number, p: { x: number; y: number }): DrawSlot | null {
    const ctx = this.#ctx;
    const k = 1;
    return {
      key: drawKey(p.y, DRAW_CLASS.building),
      paint: () => {
        // 物件图是 SPR（索引 0 透明），不需要抠黑
        const sp = this.#sprite('Data.mkf', resource, image);
        if (sp === null) return;
        ctx.drawImage(
          sp.bitmap,
          p.x - sp.anchorX * k,
          p.y - sp.anchorY * k,
          sp.width * k,
          sp.height * k,
        );
      },
    };
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
    ascendHidden: number | null = null,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const k = 1;
    const nowMs = performance.now();
    const slots: DrawSlot[] = [];
    for (const t of attachedObjectTokens(state, cam.view, flight?.objectIndex ?? null)) {
      // ★ 升天中的那一尊：`0x0040e3ba` 把它的 `+2` 清 0 再重画 ⇒ 主人身上不画它
      if (t.index === ascendHidden) continue;
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
          // ★ 定時炸彈的倒数：贴完炸彈紧接着写数字（原版在同一个槽的画法里，`0x004098c7` 起）
          if (t.fuse !== null) drawBombFuse(ctx, t.fuse, x, y + BOMB_FUSE_DY * k, k);
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
  /**
   * 神明升天这一帧 —— 起点取离身**之前**那一份 state 里这尊神附身时画在哪、画第几张
   * （原版 `0x0040e3b0 call 0x40b066` 从绘制槽里取 `+8/+0xa/+7`），逐帧上升、转图。
   * 演完（帧数到顶或整张图高过棋盘顶边）记下 `#godAscendEnded`，宿主据此收摊。
   */
  #drawGodAscend(
    map: Rich4Map,
    a: { state: GameState; objectIndex: number; elapsed: number },
    cam: Camera,
    vp: { w: number; h: number },
    now: number,
  ): void {
    const t = attachedObjectTokens(a.state, cam.view).find((x) => x.index === a.objectIndex);
    if (t === undefined) {
      this.#godAscendEnded = true;
      return;
    }
    const owner = a.state.players[t.owner];
    const node = owner === undefined ? undefined : map.nodes[owner.nodeId - 1];
    if (owner === undefined || node === undefined) {
      this.#godAscendEnded = true;
      return;
    }
    const p = this.#walkScreen(owner.index, cam, vp, now) ?? worldToScreen(node.x, node.y, cam, vp);
    if (p === null) {
      this.#godAscendEnded = true;
      return;
    }
    const k = 1;
    const x = p.x + t.offsetX * k;
    const y = p.y + t.offsetY * k;
    const pose = godAscendPoseAt(a.elapsed, y, t.frame, (img) => {
      const sp = this.#sprite('Data.mkf', t.resource, img);
      return sp === null ? null : { anchorY: sp.anchorY * k, height: sp.height * k };
    });
    if (pose === null) {
      this.#godAscendEnded = true;
      return;
    }
    const sp = this.#sprite('Data.mkf', t.resource, pose.image);
    if (sp === null) return;
    this.#ctx.drawImage(
      sp.bitmap,
      x - sp.anchorX * k,
      y + pose.dy * k - sp.anchorY * k,
      sp.width * k,
      sp.height * k,
    );
  }

  /** 上一帧画的升天已经演完了（帧数到顶 / 高过棋盘顶边 / 起点找不到）*/
  godAscendEnded(): boolean {
    return this.#godAscendEnded;
  }

  #godAscendEnded = false;

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
   * **機器娃娃打飞的物件**这一帧画在哪 —— 动画本体在纯函数里，这里只管贴图。
   *
   * 判据（`docs/deviations/Q-TOOL-1.md` 本轮补的表格第 3 行）：
   * - 起手 `fcn_0040fafd`：速度 = (本格 − 上一格) × 0.5、位置 = 本格 + 速度、
   *   `+0x06 = 0xFF`、`+0x07 ← +0x01`（= `objectKnockStart`）；
   * - 逐 tick：判 29×29 窗口 → `dec +0x06` → 按当时的 `+0x08/+0x0c` 贴图 →
   *   最后才 `+= 速度`（= `objectKnockAt` / `sweptObjectFrameAt`，出处 `rich4.asm:1746-1810`）；
   * - 越出窗口 ⇒ `+0x06 = 0`（飞行结束），而这一件的 `nodeId` 已被清 0 ⇒ 不再画。
   *
   * ⚠️ 原版这一支的落点其实也走 `[0x48a44c]` 那份绘制槽（`loc_00408f15`），
   *   但**位置是 `+0x08/+0x0c` 那对浮点**、与格心无关；本引擎按需求方口径照
   *   `#drawObjectFlight` 的成法画在**清单最后**（不进槽、不受建筑遮挡）。
   *   原本那套「擦上一帧矩形」的脏矩形处理同样用不上（每帧整幅重绘）。
   */
  #drawSweptFlights(cam: Camera, vp: { w: number; h: number }, now: number): void {
    if (this.#sweptFlights.length === 0) return;
    const ctx = this.#ctx;
    const k = 1;
    const live: { s: SweptObjectDraw; start: number; tickMs: number }[] = [];
    for (const f of this.#sweptFlights) {
      const elapsed = now - f.start;
      // 飞行最长 = 计时 0xFF 拍（`+0x06` 从 0xFF 逐拍减到 0）—— 过了就收掉
      if (elapsed > f.s.hideAt + OBJECT_KNOCK_TIMER0 * f.tickMs) continue;
      // ★ 窗口那一问就是绘制时那一问（`worldToScreen` 返回 null = 越出 29×29）
      const frame = sweptObjectFrameAt(f.s, elapsed, f.tickMs, (x, y) =>
        worldToScreen(x, y, cam, vp) !== null,
      );
      // null = 越出窗口 / 计时耗尽 ⇒ 这一件的飞行结束（原版把 `+0x06` 清 0，不再画）
      if (frame === null) continue;
      live.push(f);
      if (frame.kind !== 'fly') continue; // 还没到那一格：地面那一段由 `#objectSlots` 画
      const res = objectSpriteResource(f.s.o.type);
      if (res === null) continue;
      // 位置已经是**截断后的整数世界坐标**（与原版 `__round_toward_zero` 同）
      const p = worldToScreen(frame.x, frame.y, cam, vp);
      if (p === null) continue;
      // ★ 图号按 `+0x07`（朝向副本）算 —— 与放地上时同一张图
      //   （@source VA 0x00408ee2 `8 − 视角 + 朝向`，这里用飞行分支的 `+0x07`）
      const sp = this.#sprite('Data.mkf', res, objectImageIndex(frame.facing, cam.view));
      if (sp === null) continue;
      ctx.drawImage(
        sp.bitmap,
        Math.trunc(p.x) - sp.anchorX * k,
        Math.trunc(p.y) - sp.anchorY * k,
        sp.width * k,
        sp.height * k,
      );
    }
    this.#sweptFlights = live;
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
    flash: { lands: ReadonlySet<number>; facilities?: ReadonlySet<number>; level: number } | null = null,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const k = 1;
    const slots: DrawSlot[] = [];
    for (const it of buildingArtItems(map, state, cam.view)) {
      const p = worldToScreen(it.x, it.y, cam, vp);
      // 越出 29×29 窗口的格子原版直接跳过不画，这里保持一致
      if (p === null) continue;
      // ★ W-69：算进这笔过路费的地块这一帧要调亮（原版是 id 图上逐像素加）。
      //   level 为 0 时 `landFlash` 整份是 null，所以这里不必再判。
      const lit =
        flash !== null &&
        ((it.landId !== undefined && flash.lands.has(it.landId)) ||
          (it.facilityId !== undefined && flash.facilities?.has(it.facilityId) === true));
      slots.push({
        key: drawKey(p.y, DRAW_CLASS.building),
        paint: () => {
          const sp = this.#sprite('map.mkf', it.res, it.img, true, it.ring);
          if (sp === null) return;
          const dx = p.x - sp.anchorX * k;
          const dy = p.y - sp.anchorY * k;
          ctx.drawImage(sp.bitmap, dx, dy, sp.width * k, sp.height * k);
          // ★ 不用 `ctx.filter`：WebKit（iPhone / iPad / Mac Safari）不支持，赋值被静默忽略
          //   ⇒ 需求方在 iPhone 上看不到闪（2026-09-24）。改成叠一层，见 `sprite-brightness.ts`。
          if (lit) {
            paintBrightness(
              ctx,
              sp.bitmap,
              dx,
              dy,
              sp.width * k,
              sp.height * k,
              flash.level / TOLL_FLASH_FULL_SCALE,
              sp.width,
              sp.height,
            );
          }
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
    poseFrame: number | null,
  ): DrawSlot[] {
    const ctx = this.#ctx;
    const slots: DrawSlot[] = [];
    /** 原版绘制槽的排序键（`0x48a44c`） */
    const nowMs = performance.now();
    // 同格多人时错开，否则棋子会完全重叠
    // ★ 同格多人时按**世界坐标**分组（不是 `nodeId`）：关押中的棋子世界坐标是
    //   綠島/醫院大樓，与站在監獄格上的另一位**不是同一处**，错开量不能混用。
    const perNode = new Map<string, number>();
    for (const pl of state.players) {
      // ★ 出局的人**照画** —— 他成了乞丐（`rules/beggar.ts`：谁停在同一格谁掏施捨），原版棋子绘制
      //   `0x00408683 cmp word [player+0x08], 0 / je 跳过` 只看 `xpos`，**不看** `who_plays`；破产的 memset
      //   从 +0x1c 起，坐标 / 所在格都还在。图组换成乞丐那一张（见下面 `beggar`）。
      if (pl.xpos === 0 && pl.whoPlays === 0) continue;
      // ★★ 第八份试玩回报 #3 / #8：住宿 / 消失（出國、被外星人綁架）/ 坐牢 / 住院中的棋子**不画**。
      //   @source 棋子绘制 `0x00408691 cmp dword [player+0x32],0 / je 画` —— 四个计数字节合成一个 dword 比；
      //   非 0 时只有 `0x0040869a test byte [player+0x15],0x20 / jne` 才画（位置被外力挪过那一支）。
      //   先前一律画：被綁架的人还站在地图上、住院的人站在醫院大樓上。
      if (!confinedPlayerDrawn(pl)) continue;
      const world = playerAnchorWorld(pl);
      if (world === null) continue;
      const key = `${world.x},${world.y}`;
      const seen = perNode.get(key) ?? 0;
      perNode.set(key, seen + 1);

      // ★ 走子补间（T-046）：棋子按插值位置画，而不是直接落在格心
      const p =
        this.#walkScreen(pl.index, cam, vp, nowMs) ?? worldToScreen(world.x, world.y, cam, vp);
      if (p === null) continue;
      const k = 1;
      const off = seen * Math.max(4, k * 5);

      // ★ 原版棋子：锚点在底边中心，故按锚点对齐到格心（C-AST-6）
      //
      // ★ 朝向跟着走位走，不是永远面朝镜头：
      //   屏幕朝向 = (玩家朝向 + 8 − 视角) & 7（@source VA 0x0040882d），
      //   图号 = 屏幕朝向 × (图数 / 8) + 帧（@source VA 0x0040883f）。
      // ★ 「走回棋盘」那一回合 `phase` 是 `turnEnd`（core 整回合不掷骰），
      //   但原版这一趟同样摆「走」姿（`@source 0x40dd4a mov byte [0x498ea2], 1`
      //   + 画棋子按 `[0x498ea2]` 选图组）⇒ 判据见 `isWalking`。
      const moving =
        (state.phase === 'moving' && pl.index === state.currentPlayer) ||
        this.isWalking(pl.index, nowMs);
      // ★ 图组按**交通方式**取（走路/機車/汽車/船），组内三张 = 站/走/手持骰子
      //   @source VA 0x0040bbd8：edi = 0x80 + 角色×21 + 3×traffic_method
      //   ★ 掷骰段由调用方盖成「手持骰子」那一组（`characterPose`）——
      //     原版整段（预动作 + 滚骰 + 500 ms 定格）都停在那一组上。
      const override = poseOverride !== null && pl.index === state.currentPlayer ? poseOverride : null;
      const pose = override ?? (moving ? CHARACTER_POSE.walk : CHARACTER_POSE.stand);
      // ★ 乞丐造型：出局者，或刚被惡犬咬 / 地雷炸 / 炸彈炸（`WHO_PLAYS_WRECKED`，影片窗口里由
      //   `deferred-board.ts` 挂上）—— 原版 `0x40b93b` 见 `who_plays == 0 || & 0x40` 就只装 +18 那 8 张
      //   （@source 0x0040b972 / 0x0040b976 / 0x0040b9b7），没有走姿与骰子姿。
      const beggar = pl.whoPlays === 0 || (pl.whoPlays & WHO_PLAYS_WRECKED) !== 0;
      // ★ 夢遊：换睡衣那套（`characterSleepwalkSprite`，@source 0x0040ba16）—— 排在乞丐之后、交通方式之前
      const sleepwalking = pl.blocking.sleepWalking !== 0;
      const res = beggar
        ? characterBeggarSprite(pl.character)
        : sleepwalking
          ? characterSleepwalkSprite(pl.character, pose)
          : characterSetBase(pl.character, pl.trafficMethod) + pose;
      const count = this.#imageCount('Data.mkf', res);
      const dir = screenDirection(pl.direction, cam.view);
      /**
       * ★ **冬眠**中的棋子**画成灰的**（外部审查 D-T047-4）。夢遊不变灰 —— 换睡衣 + ZZZ（见上面 `res` 与下面的标记槽）。
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
       * 本引擎做等价去色（去饱和 + 一次提亮对齐 `+0x28 >> 2` 那一下）：逐像素算好一张灰版精灵、
       * 按位图缓存（`asleepSpriteOf`）。★ 不用 `ctx.filter` —— WebKit 不认。
       * ⚠️ **近似**：原版在 RGB555 上取整平均，canvas 走自己的色彩空间 ——
       * 登记在 deviations D-T047-4。
       */
      const asleep = isAsleep(pl.blocking);
      // ★ 盖了姿态（掷骰）且给了帧号 ⇒ 按那一帧画，不跟全局走路帧（第十四份试玩回报 #3）。
      //   帧号钳在 `每向帧数 − 1` 以内：原版帧号 `[+0x498ea3]` 在掷骰姿里只到 N−1（数到 N 就去掷）。
      const perDir = Math.max(1, count >> 3);
      const fixedFrame =
        override !== null && poseFrame !== null ? Math.min(perDir - 1, Math.max(0, poseFrame)) : null;
      const frameNow = fixedFrame ?? this.#walkFrame;
      const frameNext = fixedFrame ?? this.#walkFrame + 1;
      // ★ 图号一 tick 换一张（`#walkFrame`）——新图号没解好时**退回本槽上一张**，
      //   不许整帧不画（否则走子/掷骰预动作时人物一闪一灭，见 `#spriteHeld`）。
      const token =
        count > 0
          ? this.#spriteHeld(
              `p${pl.index}`,
              'Data.mkf',
              res,
              directionalImage(count, dir, frameNow),
              directionalImage(count, dir, frameNext),
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
            // ★ 第七份试玩回报 #2：这里原先给当前玩家脚下垫了一圈黄色光晕 —— **原版没有**
            //   （棋子绘制 `fcn_0040829d` 只贴精灵；「轮到谁」原版靠的是绘制次序 0xd 压在别人之上 + 側欄头像）。
            //   是早期为了好认自己加的，已删。
            const img = asleep
              ? (asleepSpriteOf(token.bitmap, token.width, token.height) ?? token.bitmap)
              : token.bitmap;
            ctx.drawImage(img, x, y, w, h);
          },
        });
        // ★ 夢遊中：棋子上再贴一张「ZZZ」（与棋子同一个屏幕点、类别 0xe / 0xf）@source 0x00408870
        if (sleepwalking) {
          const mark = this.#sleepwalkMarkSlot(`p${pl.index}`, p.x + off, p.y - off, p.y, pl.index === state.currentPlayer);
          if (mark !== null) slots.push(mark);
        }
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
          // ★ 冬眠中画成灰 —— 与玩家那一条同一张灰版（`asleepSpriteOf`，不靠 WebKit 不认的 `ctx.filter`）
          //   @source VA 0x004089c6 的 `_rich4_convert_sprite`
          const img = t.frozen ? (asleepSpriteOf(sp.bitmap, sp.width, sp.height) ?? sp.bitmap) : sp.bitmap;
          ctx.drawImage(
            img,
            p.x - sp.anchorX * k,
            p.y - sp.anchorY * k,
            sp.width * k,
            sp.height * k,
          );
        },
      });
      // ★ 夢遊中的替身同样贴「ZZZ」@source 0x00408acb / 0x00408b26
      if (t.sleepwalking) {
        const mark = this.#sleepwalkMarkSlot(`a${t.slot}`, p.x, p.y, p.y, t.klass === DRAW_CLASS.currentPlayer);
        if (mark !== null) slots.push(mark);
      }
    }
    return slots;
  }

  /** 夢遊着走子：这个人的「ZZZ」帧跟着 tick 走（数到 6 回零）@source 0x0040c455 / 0x0040c71f */
  #advanceSleepwalkMark(key: string, ticks: number): void {
    if (ticks <= 0 || !this.#sleepwalkingNow.has(key)) return;
    this.#sleepwalkMarkFrame.set(key, nextSleepwalkMarkFrame(this.#sleepwalkMarkFrame.get(key) ?? 0, ticks));
  }

  /**
   * 「ZZZ」那一槽：贴在棋子**同一个屏幕点**上（图自带锚点），类别 0xe / 0xf。
   * 图还没解好就不画（这一槽原版也是常驻指针，晚到一帧只是少画一帧标记）。
   */
  #sleepwalkMarkSlot(key: string, x: number, y: number, sortY: number, current: boolean): DrawSlot | null {
    const count = this.#imageCount('Data.mkf', SLEEPWALK_MARK_RESOURCE);
    if (count <= 0) return null;
    const frame = (this.#sleepwalkMarkFrame.get(key) ?? 0) % count;
    const sp = this.#spriteHeld(`z${key}`, 'Data.mkf', SLEEPWALK_MARK_RESOURCE, frame, (frame + 1) % count);
    if (sp === null) return null;
    const ctx = this.#ctx;
    return {
      key: drawKey(sortY, current ? DRAW_CLASS.currentSleepwalkMark : DRAW_CLASS.sleepwalkMark),
      paint: () => {
        ctx.drawImage(sp.bitmap, x - sp.anchorX, y - sp.anchorY, sp.width, sp.height);
      },
    };
  }
}

/**
 * 这一帧**谁在夢遊** —— 键同 `#held`：玩家 `p0..p3`（`+0x37`）、替身 `a0..a4`（记录 `+13`）。
 * 纯函数，单测直接钉。
 */
export function sleepwalkingKeys(state: GameState): ReadonlySet<string> {
  const out = new Set<string>();
  state.players.forEach((p, i) => {
    if (p.blocking.sleepWalking !== 0) out.add(`p${i}`);
  });
  state.specialActors.forEach((a, i) => {
    if ((a?.sleepwalkDays ?? 0) !== 0) out.add(`a${i}`);
  });
  return out;
}

/** 「ZZZ」帧走 `ticks` 拍之后是第几帧（`inc / cmp 6 / 归零`）@source 0x0040c465..0x0040c47e */
export function nextSleepwalkMarkFrame(frame: number, ticks: number): number {
  return (frame + ticks) % SLEEPWALK_MARK_FRAMES;
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
