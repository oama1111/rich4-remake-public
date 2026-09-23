/*
 * 遙控骰子（道具 8）的点数选择盘 —— Q-PICK-2
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 全部照 exe：`rich4_tool_yaokongtouzi.asm`（**VA 0x004470f8** 起）+
 *   它的窗口过程 `fcn_00446774`（VA 0x00446774，在 `rich4_ui_use_tool.asm`）。
 *
 * ## 它长什么样
 *
 * 真人那一支（`cmp byte [player + 0x15], 1`）：
 * ```asm
 * 00447117  push 0x48 / call 0x450441                   ; ★ read_mkf(Panel.mkf, 72)
 * 0044716c  push 0x12c / push 0x5c / call 0x4563f5      ; ★ draw_img(panel+0xc, 92, 300)
 *                                                       ;   （call 在 0x00447183）
 * 0044719b  push 0 / push 0x446774 / call 0x4018e7      ; 模态（Wait_0402_Message）
 * 004471ac  mov [esp],0x5c / [esp+4],0x12c / [esp+8],0x15c / [esp+0xc],0x163
 *                                                       ; ★ InvalidateRect 的矩形
 *                                                       ;   (92,300)-(348,355) = 256×55
 *                                                       ;   与盘子尺寸严丝合缝
 * ```
 * 资源 72 是一张 SMP，里面 **7 张图**：
 *
 * | 图 | 尺寸 | 是什么 |
 * |---|---|---|
 * | 0 | **256×55** | 整条盘子 —— 六颗**骰面 1..6** 烘在里面 |
 * | 1..6 | 30×29 | 第 i 颗的**点亮版**（悬停时盖上去的那一张）|
 *
 * （`parseSpriteSheet(read(0x48))` 实测：`256x55 | 30x29 ×6`。）
 *
 * ## 六颗钮的几何 @source `fcn_00446774` 的 WM_MOUSEMOVE（0x200）分支
 *
 * ```asm
 * 00446800  movzx ebp, cx / shr eax,0x10   ; ebp = x（LOWORD）、eax = y（HIWORD）
 * 00446814  cmp eax, 0x13a / jl 退出
 * 0044681f  cmp eax, 0x157 / jge 退出      ; ★ **一条横向带** y ∈ [314, 343)
 * 0044683c  mov ebx, 0x68                  ; 第一颗的 x（= 104）
 * 00446843  inc esi / add ebx, 0x28 / cmp esi, 6
 * 00446850  cmp ebp, ebx / jl 下一颗
 * 00446857  lea eax,[ebx+0x1e]; cmp ebp,eax / jge 下一颗   ; 宽 30
 * ```
 * 即：`x = 104 + 40×(i−1)`、`y = 314`、`30×29`，共 **6** 颗，横向一条。
 * 与盘子烘的六颗骰面位置**严丝合缝**（盘子局部 (12+40i, 14)，盘子在 (92,300)）。
 *
 * ## 悬停与选中
 *
 * - 悬停：`[0x48c598] = i`，把**图 i** 贴到第 i 颗上
 *   （`draw_img(dst, panel+0xc+12*i, 104+40(i−1), 0x13a)`，@source `loc_004468f4`
 *   起、`loc_0044692d` 那段算 `12*i`）；离开那条带就把旧的那颗按**图 0 的对应
 *   矩形**擦回去（`draw_img_rect(dst, panel+0xc, x, 0x13a, sx=12+40i, sy=0xe, 30, 29)`，
 *   @source `loc_0044689a` 起）—— 本引擎每帧重画整条盘子，效果相同。
 * - 左键（0x201）：`[0x48c598] != 0` 就 `play_sound_effect(0x482322)` → 隐藏鼠标 →
 *   `Post_0402_Message(选中的那颗)` @source `loc_00446a2c`。**返回值就是点数**。
 * - 右键（0x205）：`play_sound_effect(0x482332)` → `Post_0402_Message(0)` = **取消**
 *   @source `loc_00446a66`。`[0x48c598] == 0` 时左键什么都不做。
 * - WM_CREATE：`[0x48c598] = 0`、`SetCursorPos(0x140, 0xdc)`（= 320,220）、显示鼠标。
 *
 * ## 点数范围 —— **1..6**，不是 1..18
 *
 * 钮只有六颗（骰面 1..6），返回的 `bl` 直接写进 `[0x475dd8]`（@source
 * `rich4_tool_yaokongtouzi.asm:145 mov byte [0x475dd8], bl`），
 * 掷骰处 `fcn_00419572(value)` 在 `value != 0` 时 `mov esi,1`（**压成一颗骰子**）
 * 并把 `value` 当**总步数**（@source VA 0x004195ae）。所以真人能指定的就是 **1..6**。
 * core 的 `REMOTE_DICE_MAX = 18`（三颗骰子的上限）是给 AI / 内部路径留的，
 * 本 UI **取不到** 7..18 —— 这不是缺钮，是原版盘子上就六个骰面。
 *
 * ## 音效
 *
 * `play_sound_effect(ptr, k)` 取 `[ptr]` 当音效号（@source VA 0x004542d8
 * `mov ecx, [eax]`）。表在 `0x48231a`、**8 字节一项**：
 * `0x482322 = 1`（点中，与标题的 TITLE_CLICK 同一个音）、`0x482332 = 4`（取消）。
 * ⚠️ 顺带订正：`main.ts` 的 `SOUND_CARD_FAILED` 原先标 `@source 0x48233a`
 * 却写 4，而 `[0x48233a] = 3`（4 是取消那个 `0x482332`）—— 已改成 3。
 */

import type { ArchiveName, Sprite } from './assets.ts';
import { drawSprite } from './hd-stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type DiceSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 盘子所在的资源 —— `Panel.mkf` **#72** @source VA 0x004471a5 `push 0x48` */
export const DICE_PANEL_RESOURCE = 0x48;
export const DICE_PANEL_ARCHIVE: ArchiveName = 'Panel.mkf';

/** 盘子落点 @source VA 0x0044716c 的 `push 0x12c / push 0x5c` */
export const DICE_PANEL_ORIGIN = { x: 0x5c, y: 0x12c } as const;

/** 骰面个数 —— 盘子上的六颗 @source 循环 `cmp esi, 6` */
export const DICE_FACE_COUNT = 6;
/** 点数下限 / 上限（= 骰面 1 / 6）*/
export const DICE_FACE_MIN = 1;
export const DICE_FACE_MAX = 6;

/** 一条横向带 @source `0x13a` / `0x157`（开区间：上边界含、下边界不含）*/
export const DICE_BAND_Y0 = 0x13a;
export const DICE_BAND_Y1 = 0x157;
/** 第一颗的 x 与步长 @source `mov ebx, 0x68` / `add ebx, 0x28` */
export const DICE_BUTTON_X0 = 0x68;
export const DICE_BUTTON_STEP = 0x28;
/** 每颗的大小 @source `lea eax,[ebx+0x1e]`（宽）与 30×29 的图 */
export const DICE_BUTTON_W = 0x1e;
export const DICE_BUTTON_H = 0x1d;

/** 点中/取消的音效号 @source `0x482322 = 1` / `0x482332 = 4` */
export const DICE_SOUND_PICK = 1;
export const DICE_SOUND_CANCEL = 4;

/** 第 `face` 颗（1..6）的屏幕矩形 */
export function diceButtonRect(face: number): { x: number; y: number; w: number; h: number } {
  return {
    x: DICE_BUTTON_X0 + (face - 1) * DICE_BUTTON_STEP,
    y: DICE_BAND_Y0,
    w: DICE_BUTTON_W,
    h: DICE_BUTTON_H,
  };
}

/**
 * 光标底下是第几颗骰面；不在任何一颗上返回 `0`。
 *
 * @source `fcn_00446774` 的 0x200 分支：先判 `y ∈ [0x13a, 0x157)`，
 *   再逐颗判 `x ∈ [x_i, x_i + 0x1e)`（`jl` 跳过、`jge` 跳过 → 左闭右开）。
 *   **六个钮都没中不是「取消」** —— 原版只是把旧高亮擦掉（`[0x48c598] = 0`）。
 */
export function hitDiceFace(sx: number, sy: number): number {
  if (sy < DICE_BAND_Y0 || sy >= DICE_BAND_Y1) return 0;
  for (let i = 0; i < DICE_FACE_COUNT; i++) {
    const x = DICE_BUTTON_X0 + i * DICE_BUTTON_STEP;
    if (sx >= x && sx < x + DICE_BUTTON_W) return i + 1;
  }
  return 0;
}

/** 悬停第 `face` 颗时要盖上去的**图号**（就是脸本身）@source `loc_00446935` 的 `12*sel` */
export function diceLitFrame(face: number): number {
  return face;
}

/** 这次要发的 `useTool` —— 值与 `core/state/actions.ts` 的 `useTool.value` 一致 */
export type UseToolAction = { type: 'useTool'; toolId: number; value: number };

/** `core` 的 `rollDice`，形状逐字一致（点数走 `GameState.forcedDice`，不带 `forced`）*/
export type RollDiceAction = { type: 'rollDice' };

/** 遙控骰子的道具号 @source 道具表第 8 项 */
export const REMOTE_DICE_TOOL_ID = 8;

/**
 * 选中第 `face` 颗 → action；`0`（没点中 / 取消）→ `null`（**什么都不发**，
 * 原版此时 `test ebx,ebx / je` 不消耗道具）。
 */
export function remoteDiceAction(face: number): UseToolAction | null {
  if (!Number.isInteger(face) || face < DICE_FACE_MIN || face > DICE_FACE_MAX) return null;
  return { type: 'useTool', toolId: REMOTE_DICE_TOOL_ID, value: face };
}

/**
 * 选中第 `face` 颗之后要发的**整串**：先记点数（`useTool`），再**当场兑现这一掷**
 * （`rollDice`，消费 `forcedDice`）；`0` / 越界 → `null`。
 *
 * ★★ 2026-09-20 试玩回报「遥控骰子无法正常使用，我选择了1点应该是直接跳过正常
 *   扔骰子阶段然后让角色走1点」：先前只发 `useTool`，于是点数进了 `forcedDice`
 *   而**回合不前进一步**（`phase` 还停在 `awaitingRoll`）—— 玩家必须再按一次
 *   「前進」才会走，看起来就是「选了没反应」。
 *
 * @source `rich4_tool_yaokongtouzi.asm` VA 0x0044725c（`loc_0044725c`）：
 *   真人选完点数（`ebx != 0`）那一下原版**自己**把这一回合推起来，不需要再按前進：
 *   ```asm
 *   0044725c  test ebx, ebx / je loc_0044727b   ; 0 = 取消
 *   00447260  call fcn_0040dd1f                  ; ★ 推进本回合的状态机
 *   00447275  mov byte [0x475dd8], bl            ; ★ 写强制点数
 *   ```
 *   `fcn_0040dd1f` 对正常真人写 `[当前玩家 +0x498ea2] = 2`
 *   （@source VA 0x0040dd87 `mov byte [eax + 0x498ea2], 2`），而该状态在
 *   `fcn_0040d7c4` 的跳表 `0x40d7b4` 里指向 **VA 0x0040d975** ——
 *   数满预动作后 `call 0x447285`（读出并清零 `[0x475dd8]`，@source VA 0x00447285）
 *   再 `call 0x419572`；点数非 0 时那里 `mov esi, 1` 并把点数当**总步数**
 *   （@source VA 0x004195ae）。所以「选完就走 N 步」是原版行为。
 */
export function remoteDiceActions(
  face: number,
): readonly (UseToolAction | RollDiceAction)[] | null {
  const use = remoteDiceAction(face);
  return use === null ? null : [use, { type: 'rollDice' }];
}

/**
 * 画盘子（640×480 舞台坐标）。
 *
 * `hover` = 当前悬停的骰面（1..6；`null` = 没有）。原版只重画「旧的那颗 + 新的那颗」，
 * 本引擎每帧整条重画 —— 结果一样，且不必记旧高亮。
 */
export function drawDiceChoose(
  ctx: CanvasRenderingContext2D,
  sprite: DiceSprite,
  hover: number | null,
): void {
  const panel = sprite(DICE_PANEL_ARCHIVE, DICE_PANEL_RESOURCE, 0, false);
  if (panel !== null) drawSprite(ctx, panel, DICE_PANEL_ORIGIN.x, DICE_PANEL_ORIGIN.y);
  if (hover === null || hover < DICE_FACE_MIN || hover > DICE_FACE_MAX) return;
  const lit = sprite(DICE_PANEL_ARCHIVE, DICE_PANEL_RESOURCE, diceLitFrame(hover), false);
  if (lit === null) return;
  const r = diceButtonRect(hover);
  drawSprite(ctx, lit, r.x, r.y);
}
