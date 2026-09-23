/*
 * 大地圖彈窗（工具列第 6 顆「大地圖」／熱鍵「地圖」）—— T-086
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方 2026-09-15 指正：原版的「大地圖」**不是把镜头缩成整图**，
 *   是一扇**模态弹窗**。窗口过程 `fcn_0040a801` @VA **0x0040a801**、
 *   入口 `_rich4_ui_small_map_entry` @VA **0x0040a9bd**
 *   （文件 `rich4-re/asm/rich4_ui_small_map.asm`）。
 *
 * ## 窗口过程的三条分支（其余一律 `DefWindowProc`）
 *
 * | msg | 做什么 | @source |
 * |---|---|---|
 * | `0x401` WM_USER+1 | 开窗初始化：`fcn_0040a4e1(1)` 把图 1 从原始副本刷回工作面并补画地块/设施/企业的图标，`fcn_00402460(1)` 开脏矩形记账，`InvalidateRect` | 0x0040a82b |
 * | `0xf` WM_PAINT | 见下 | 0x0040a86d |
 * | `0x205` WM_RBUTTONUP | `fcn_00402460(0)` + `Post_0402_Message(0)` ⇒ **关窗** | 0x0040a854 |
 * | 其余 | `DefWindowProc` ⇒ **左键不关、中键不关、键盘不关，只有右键抬起关** | 0x0040a9a4 |
 *
 * 入口付完窗口过程后还有一句 `fcn_00415e70(1)`（0x0040a9c9）—— 收尾时
 * 把镜头重新居中到当前玩家/标记。本引擎走的是「模态期间板面冻住、
 * 关掉后照常一帧」，不需要这一句。
 *
 * ## WM_PAINT（VA 0x0040a86d）
 *
 * ```asm
 * 0040a883  push 0x3c / push 0x14        ; ★ y=60 / x=20
 * 0040a88c  add  eax, 0x18              ; [0x48badc] + 0x18 = 图 1
 * 0040a897  call fcn_004563f5           ; 贴在 (20,60)，**不抠黑**
 * ; 每个在世玩家一枚标记：
 * 0040a8b0  cmp  word [player + 0x08], 0 ; ★ 判据是 xpos != 0
 * 0040a8d4  shl  eax, 7 / sar eax, 0x10  ; ★ ×89/512（世界 2304 → 400）
 * 0040a8da  lea  ecx, [eax + 0x14]       ; x = 世界x × 89/512 + 20
 * 0040a901  add  eax, 0x3c               ; y = 世界y × 89/512 + 60
 * 0040a90f  add  eax, 0x48               ; [0x498eb0 + p*0x34] + 0x48 = 图 5
 * 0040a91a  call fcn_00456418            ; ★ 抠黑贴图（见下）
 * 0040a938  rect = {0x14,0x3c,0x1a4,0x1cc}   ; RECT(20,60,420,460)
 * 0040a95f  BltFast(primary, 20, 60, offscreen, &rect, 0x10)
 * ```
 *
 * ★ **只有 (20,60)–(420,460) 那一块被覆盖。** 离屏面虽然整张清了
 *   （0x0040a880 的 `[vtable+0x64]` 调色填充，0x96000 = 640×480×2），
 *   但**只 Blt 那块 400×400** —— 周围（棋盘、工具栏、右侧栏）在 primary 上
 *   原样留着。实机截图 S6 也是这一条：大地圖开着时右侧栏照样显示「資金」页。
 *   所以本屏是**浮窗**（`windowed: true`），不是整屏黑底。
 *
 * ## 图号从哪来
 *
 * `[0x48badc]` = `read_mkf(map.mkf, 地图号 + 0x10)`（VA 0x00407fc0 起那段载入，
 * 见 `rich4_load_map.asm:96`），`[0x498eb0 + p*0x34]` = `read_mkf(map.mkf,
 * 角色号 + 0x1b)`（VA 0x00407f9e 起的循环，`player + 19` 就是角色号）。
 * 这两张都是**精灵表**：表项从 `+0xc` 起、每条 **12 字节**（T-085 同一条规律），
 * 故 `+0x18 = 0xc + 12×1` = **图 1**、`+0x48 = 0xc + 12×5` = **图 5**。
 *
 * | 图 | 是哪张 | 尺寸（实测 `map.mkf`）|
 * |---|---|---|
 * | 资源 `地图号+0x10` 图 1 | 大地圖底图（整张画好的地图，含地块与建筑） | 400×400 |
 * | 资源 `角色号+0x1b` 图 5 | **玩家标记**（一枚小人头，锚点中心） | 30×27 / 23×24 …（逐角色不同）|
 *
 * 图 1 走 `fcn_004563f5`＝`draw_image_in_rect`（**原样拷**，不抠黑）；
 * 图 5 走 `fcn_00456418`＝`draw_non_zero_image_in_rect`（0x0040a91a，
 * 内层循环 `lodsw / or ax,ax / je` 跳过 0 ⇒ **黑当透明**）。
 */

import type { GameState } from '@rich4/core';
import { isAlive } from '@rich4/core';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { drawSprite } from './hd-stage.ts';

/** 面板落点 **(20, 60)** @source VA 0x0040a883 `push 0x3c` / 0x0040a885 `push 0x14` */
export const BIG_MAP_AT = { x: 0x14, y: 0x3c } as const;

/** 面板边长 400（图 1 自身的尺寸；也就是脏矩形 0x1a4−0x14 = 0x1cc−0x3c） */
export const BIG_MAP_SIZE = 400;

/** 地图资源段起点：`map.mkf` 资源 `地图号 + 0x10` @source VA 0x00407fc0 起（`add eax, 0x10`）*/
export const BIG_MAP_RESOURCE_BASE = 0x10;

/** 大地圖底图 = 图 **1** @source VA 0x0040a88c `add eax, 0x18`（0xc + 12×1）*/
export const BIG_MAP_BG_IMAGE = 1;

/** 角色头像资源段起点：`map.mkf` 资源 `角色号 + 0x1b` @source VA 0x00407f9e 起（`add eax, 0x1b`）*/
export const PORTRAIT_RESOURCE_BASE = 0x1b;

/** 玩家标记 = 图 **5** @source VA 0x0040a90f `add eax, 0x48`（0xc + 12×5）*/
export const BIG_MAP_MARKER_IMAGE = 5;

/**
 * 世界坐标 → 大地圖坐标的定点乘法：`世界 × 89 ÷ 512`（= `<<7` 后 `>>16`）。
 *
 * @source VA 0x0040a8c5..0x0040a8d7（x）与 0x0040a8ea..0x0040a8fe（y）：
 * ```asm
 * shl eax,2 / sub eax,ecx   ; ×3
 * shl eax,2 / sub eax,ecx   ; ×11
 * shl eax,3 / add eax,ecx   ; ×89
 * shl eax,7                 ; ×128
 * sar eax,0x10              ; (x×89×128) >> 16 == x×89/512
 * ```
 * ⚠️ 侧栏那块 200×200 是同一段但 `shl eax,6`（VA 0x00416fb9，见 `hud.ts` 的
 *   `minimapAt`）—— **这里必须是 7**，因为它是 400×400。别改成 `size/worldW`
 *   的浮点：2304×89÷512 = 400.5 取整 400，原版就是这么写的。
 */
export const BIG_MAP_SCALE_NUM = 89;
export const BIG_MAP_SCALE_SHIFT = 9;

/** 世界坐标 → 大地圖局部坐标（照原版的整数运算） */
export function bigMapAt(world: number): number {
  return (world * BIG_MAP_SCALE_NUM) >> BIG_MAP_SCALE_SHIFT;
}

/** 一枚标记（纯数据，便于单测）*/
export interface BigMapMarker {
  /** 玩家下标 */
  player: number;
  /** 角色号 —— 标记图的资源号 = `角色号 + PORTRAIT_RESOURCE_BASE` */
  character: number;
  /** **舞台**落点（锚点由绘制那一步减掉）*/
  x: number;
  y: number;
}

/**
 * 这一帧要画的标记 —— 一个在世玩家一枚。
 *
 * @source VA 0x0040a8a1 的循环：`p < [0x499114]`（玩家数），
 *   `word [player + 0x08] != 0` 才画。
 *
 * ★★ **2026-09-18（第 86 条）：位置改用 `xpos/ypos`，与原文逐字同源。**
 *   原版这一屏读的就是 `player + 0x08/+0x0a`（`0x40a8b0`/`0x40a8d4`），
 *   而那两个字节**只在关押时**才不等于所在格坐标：入監/入院会把屏幕坐标写成
 *   特殊景观记录（監獄 → 记录 2「綠島」、醫院 → 记录 1；`@source 0x43d643`）。
 *   先前 core 的 `x/y` 恒等于节点坐标，本屏取节点坐标才是等价的；现在 core
 *   已照原版写景观坐标（`rules/confinement.ts`），故这里也必须读 `xpos/ypos` ——
 *   否则大地图上被关押者的标记会画在監獄格上，而原版画在綠島上。
 *
 * ⚠️ 判据仍是 `isAlive()`（`whoPlays & 3 != 0`）：原版判 `player + 0x08 != 0`，
 *   二者在"八张地图没有任何节点的世界坐标是 0"（实测 min x = 179、min y = 192）
 *   以及"破产清空坐标"两条上都等价 —— 见 `docs/deviations/T-086.md`。
 */
export function bigMapMarkers(state: GameState): BigMapMarker[] {
  // ⚠️ 第 86 条起**不再需要地图**：位置直接读 `xpos/ypos`（原文也只读玩家记录）。
  const out: BigMapMarker[] = [];
  for (const p of state.players) {
    if (!isAlive(p)) continue;
    if (p.xpos === 0 && p.ypos === 0) continue;
    out.push({
      player: p.index,
      character: p.character,
      // ★ `@source 0x0040a8d4 shl eax,7 / sar eax,0x10` —— 直接缩放 player+0x08/+0x0a
      x: BIG_MAP_AT.x + bigMapAt(p.xpos),
      y: BIG_MAP_AT.y + bigMapAt(p.ypos),
    });
  }
  return out;
}

/** 底图的资源号（`map.mkf`）*/
export function bigMapResource(globalMapId: number): number {
  return globalMapId + BIG_MAP_RESOURCE_BASE;
}

/** 某个角色的标记图资源号（`map.mkf`）*/
export function bigMapMarkerResource(character: number): number {
  return character + PORTRAIT_RESOURCE_BASE;
}

/**
 * 模态期间**仍然认**的热键 —— 原版一个都不认。
 *
 * 窗口过程只认 `0x401` / `0xf` / `0x205` 三条，键盘消息一律落到
 * `DefWindowProc`（VA 0x0040a9a4）：**键盘关不掉这扇窗，也推不开别的屏**。
 * 「地圖」再按一次同样什么都不做（它不是开关）。
 */
export const BIG_MAP_ALLOWED_HOTKEYS: readonly number[] = [];

/**
 * 大地圖彈窗的开关。
 *
 * ★ 用模块级开关而不是 `state` 里的字段：原版这扇窗是**窗口过程**的局部状态，
 *   与游戏状态无关（`_Wait_0402_Message` 阻塞在消息循环里）。
 */
let open = false;

export function bigMapOpen(): boolean {
  return open;
}

/** 开窗。（原版入口 VA 0x0040a9bd；工具列那颗在跳表 0x417d39 第 5 项）*/
export function openBigMap(env: UiScreenEnv): void {
  if (open) return;
  open = true;
  env.requestRender();
}

/**
 * 关窗。@source VA 0x0040a854（WM_RBUTTONUP 0x205）：`Post_0402_Message(0)`
 */
export function closeBigMap(env: UiScreenEnv): void {
  if (!open) return;
  open = false;
  env.requestRender();
}

/** 单测用：把开关复位 */
export function resetBigMap(): void {
  open = false;
}

/** 按锚点贴一张图（原版 `draw_image_in_rect` 也减 `graph_info` 的 x/y）*/
function drawAt(
  ctx: CanvasRenderingContext2D,
  s: { bitmap: ImageBitmap; width: number; height: number; anchorX: number; anchorY: number } | null,
  x: number,
  y: number,
): void {
  if (s === null) return;
  drawSprite(ctx, s, x - s.anchorX, y - s.anchorY);
}

export const bigMapScreen: UiScreen = {
  id: 'big-map',

  /**
   * ★ 浮窗：原版只把 (20,60)–(420,460) 那块盖上去，周围的棋盘/工具栏/侧栏
   *   照旧露着（见文件头）。`main.ts` 见到 `windowed` 会先照常画一整帧棋盘。
   */
  windowed: true,

  active(): boolean {
    return open;
  },

  draw(env) {
    // ── 底图：`map.mkf` 资源 `地图号+0x10` 图 1，400×400 贴 (20,60) @0x0040a88c ──
    drawAt(
      env.stage,
      env.sprite('map.mkf', bigMapResource(env.state.globalMapId), BIG_MAP_BG_IMAGE, false),
      BIG_MAP_AT.x,
      BIG_MAP_AT.y,
    );
    // ── 每个在世玩家一枚标记（抠黑）@0x0040a8a1..0x0040a91a ──
    for (const m of bigMapMarkers(env.state)) {
      drawAt(
        env.stage,
        env.sprite('map.mkf', bigMapMarkerResource(m.character), BIG_MAP_MARKER_IMAGE, true),
        m.x,
        m.y,
      );
    }
  },

  // 左键按下/抬起**什么都不做** —— 原版 0x201/0x202 走 DefWindowProc（@0x0040a9a4）。
  down() {
    /* 原版没有反应 */
  },
  up() {
    /* 原版没有反应 */
  },

  /**
   * 右键 = 关窗。原版是 `WM_RBUTTONUP`（0x205 @VA 0x0040a854），
   * 浏览器里就是 `contextmenu` 那一拍（与股市/資產表/道具欄同一套映射）。
   */
  contextmenu(_x, _y, env) {
    closeBigMap(env);
  },

  hotkey(fn) {
    if (!open) return false;
    // 模态：键盘在这扇窗里什么都做不了（原版 WM_KEYDOWN → DefWindowProc）
    return !BIG_MAP_ALLOWED_HOTKEYS.includes(fn);
  },
};
