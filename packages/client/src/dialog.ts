/*
 * 待决交互的画法 —— 画在棋盘上，不是 HTML
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：这里**一条规则都没有**。它拿 `interactions.ts` 翻好的
 *   `InteractionUi`（标题、说明、几个选项），把它摆成一块对话框，
 *   再把点中的那一项原样交回去。
 *
 * ★ 位置照原版。通用询问框 VA 0x00440ba8：
 * ```asm
 * 00440bc9  rect = { 0, 0x28, 0x1b8, 0x1e0 }     ; (0, 40, 440, 480) —— 棋盘那一栏
 * 00440be7  call 0x451e7e(&rect)                 ; 在这块区域上开对话框
 * 00440c0f  call 0x456418(字体, skin+0x48, 0xdc, 0x8c)   ; 框画在 (220, 140)
 * 00440c33  call 0x44fabc(0, 文字, 0xdc, 0x8c, 4)        ; 文字同点，对齐码 4
 * ```
 * `0x1b8 = 440`、`0x1e0 = 480`、`0x28 = 40` —— 这是 640×480 定屏的**第四条**
 * 独立证据（另三条：工具栏底条 439×40、`Panel.mkf` 资源 66 的 440×480
 * 「NEWS」遮罩、設定對話框 `x0 = 0x140 − w/2`）。
 *
 * ★ 框那张图**已经认出来了**（Q-UI-2 结案）：`[0x48bad8] = read_mkf(Data.mkf, 0x205)`
 *   （VA 0x0040807b），`+0x48` 是精灵下标 ⇒ 从 `+0x0c` 起每张 12 字节算，
 *   `(0x48−0x0c)/12 = ` **图 5**（249×170、锚点 (123,101)），按 (0xdc,0x8c)
 *   当锚点贴 ⇒ (97,39)-(346,209)。常量与证据见 `gameui.ts` 的 `DIALOG_SKIN_*`。
 */

import type { InteractionUi } from './interactions.ts';
import { DICE_AT, DICE_AT_BASE } from '@rich4/assets-pipeline';
import {
  DIALOG_ANCHOR_SCREEN,
  DIALOG_SKIN_IMAGE,
  DIALOG_SKIN_RESOURCE,
  DICE_RESOURCE,
  DICE_SLOTS,
  DICE_TOGGLE_IMAGE,
  DICE_TOGGLE_LAYOUT,
  DICE_TOGGLE_X,
  DICE_TOGGLE_SIZE,
  GO_RESOURCE,
  YESNO_IMAGE,
  YESNO_RESOURCE,
  YESNO_CENTER_SCREEN,
  YESNO_SIZE,
  boardRect,
  diceImage,
  inRect,
  toBoard,
  yesNoHalves,
  type Rect,
  type SpriteFn,
} from './gameui.ts';
import { AMOUNT_KEY_RECTS, AMOUNT_WINDOW, amountSlotOfId } from './amount-keys.ts';
import { drawAmountWindow } from './amount-window.ts';
import { boardToScreen, pointInGo, type GoPos } from './go-button.ts';
import { LAYOUT } from './stage.ts';
import { FONT_FAMILY } from './font.ts';

/** 框心（棋盘区坐标）—— 由屏幕坐标换算，见 gameui.ts */
export const DIALOG_ANCHOR = toBoard(DIALOG_ANCHOR_SCREEN);

/**
 * 訊息框在屏幕上的位置 —— 由锚点倒推。
 * @source VA 0x004191df：`x0 = 0xdc − 图5.anchorX`、`y0 = 0x8c − 图5.anchorY`。
 * 图 5 是 249×170、锚点 (123,101)，于是框占 (97,39)-(346,209)。
 */
export const BOX_SCREEN: Rect = { x: 0xdc - 123, y: 0x8c - 101, w: 249, h: 170 };

/**
 * 框内可写字的那一块（相对框左上角）。
 *
 * ⚠️ 是**照解出来的位图量的**：在图 5 上横切竖切，看颜色跳变——
 *   平坦的棕色内场是 x 12..230、y 41..160（上面那圈金边与顶部的王冠饰件
 *   占掉 y 0..40）。原版把字排在哪由绘制代码决定，那段没定位。
 */
const INNER = { dx: 12, dy: 41, w: 219, h: 120 } as const;

/**
 * 正文行距 —— **22 = 字号 16 + 6（近似，D-DIALOG-1）**。
 *
 * 原版的多行排版**全交给 GDI**：`rich4_draw_text`（VA 0x0044fabc）把整串（含 `\n`）
 * 一次交给 `DrawTextA`（IAT `[0x4622e4]`）——先 `0x0044fba9 push 0x400`（DT_CALCRECT）量框，
 * 再 `0x0044fe70 push 1`（DT_CENTER，flag 4/7）或 `0x0044fe8c push 0`（DT_LEFT）真画；
 * 函数里**没有**自己拆 `\n`、也没有逐行加的常量，flags 里也没有 DT_EXTERNALLEADING。
 * ⇒ 行距 = 所选字体（細明體，`CreateFontA(cHeight = −16)`，见 `font.ts`）的 `tmHeight`，
 *   那是**字体文件**的度量，exe 里读不到。故按本项目多行字的既定近似「字号 + 6」
 *   （同 `event-box-screen.ts` 的 D-EVENT-3），登记为偏离。
 */
const LINE_H = 22;
/** 同一个行距给其他 `draw_text(…, flag 4)` 的屏共用（`god-slot.ts` 的气泡）*/
export const DIALOG_LINE_H = LINE_H;
const TITLE_H = 24;
const BTN_H = 24;
const BTN_GAP = 5;
const BTN_MIN_W = 56;

const TITLE_SIZE = 16;
/**
 * 框里正文 16 号、`#f0f0f0` 填充 + `#101010` 描边。
 * @source 两扇框同一句 `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)`：
 *   询问框 0x00440baf..0x00440bbf、訊息框 0x00440d06..0x00440d16
 *   （flag 3 = 带描边，与 `ai-settings.ts` 的 `set_font(…, 3, 1)` 同一口径）
 */
const BODY_SIZE = 0x10;
const BODY_FILL = '#f0f0f0';
const BODY_OUTLINE = '#101010';
const FONT_TITLE = `bold ${TITLE_SIZE}px ${FONT_FAMILY}`;
const FONT_BODY = `${BODY_SIZE}px ${FONT_FAMILY}`;
/** 自排按钮列的字（⚠️ 我们的做法，原版那几屏各有专屏）—— 保持原先的 14 号 */
const FONT_BUTTON = `14px ${FONT_FAMILY}`;

/**
 * 框里每一行字的**竖直中线**（棋盘区坐标）—— 整块字的墨迹框竖直居中在 `anchorY`。
 *
 * @source `rich4_draw_text`（VA 0x0044fabc）flag 2/3/4 那一支：
 * ```asm
 * 0044feef  call 0x44f70c              ; 扫离屏面非 0 像素 → 墨迹框 [x0,y0,x1,y1]
 * 0044ff00  mov ebx, [y1] / sub ebx, [y0] / inc ebx   ; 高 = y1 − y0 + 1
 * 0044ff2a  x −= 宽 >> 1
 * 0044ff35  y −= 高 >> 1               ; ★ 竖直也居中（flag 2/3/4 落到同一段）
 * ```
 * 墨迹只看有字的行：首尾的空行（`\n\n` 拆出来的）不占墨迹高度，中间的照样占行距。
 * 每行的墨迹按「行中线 ± 字号/2」近似（本引擎画字用 `textBaseline = 'middle'`）。
 */
export function dialogRowMiddles(
  rows: readonly { h: number; size: number; blank: boolean }[],
  anchorY: number,
): number[] {
  const mids: number[] = [];
  let top = 0;
  for (const r of rows) {
    mids.push(top + r.h / 2);
    top += r.h;
  }
  let first = -1;
  let last = -1;
  rows.forEach((r, i) => {
    if (r.blank) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return mids;
  const inkTop = mids[first]! - rows[first]!.size / 2;
  const inkBottom = mids[last]! + rows[last]!.size / 2;
  const shift = Math.round(anchorY - (inkTop + inkBottom) / 2);
  return mids.map((m) => m + shift);
}


// ============================================================
//  GO 鈕、骰子数切换、骰子
// ============================================================

/**
 * 「GO」鈕 —— 轮到人、还没掷骰时画在棋盘上。
 *
 * ★ 这是**原版的按钮**，不是我们加的：`Panel.mkf` 资源 7 图 0/1（72×67 的
 *   黄底 GO 牌子），默认位置 (180,120)，原版还允许拖着它走。下方那三对
 *   15×15 的小骰子是**骰子数切换**（1/2/3 颗，对应走路/機車/汽車）。
 *   全部常量与出处见 `gameui.ts`，**位置与拖动**见 `go-button.ts`。
 *
 * @param pos GO 鈕左上角（**棋盘画布**坐标，`GoButton.position()`）——
 *   原版那个全局是屏幕坐标，拖动会把位置改掉，所以不能再写死默认值。
 */
export function hitAdvance(x: number, y: number, pos: GoPos): boolean {
  return pointInGo(x, y, pos);
}

/**
 * 骰子数切换钮的第 i 个（棋盘画布坐标；跟着 GO 鈕一起走）。
 *
 * ★ W-65：纵向**按交通方式分三支**（见 `DICE_TOGGLE_LAYOUT` 的表）——
 *   `traffic = player.trafficMethod & 3`。横向固定：亮图 `+7`、暗图 `+8`。
 */
export function diceToggleRect(i: number, pos: GoPos, traffic: number): Rect {
  const layout = DICE_TOGGLE_LAYOUT[traffic & 3] ?? DICE_TOGGLE_LAYOUT[0]!;
  return boardRect({
    x: boardToScreen(pos).x + DICE_TOGGLE_X.lit,
    y: boardToScreen(pos).y + layout.dy + i * layout.pitch,
    ...DICE_TOGGLE_SIZE,
  });
}

/**
 * 点在第几颗骰子的切换钮上（返回颗数 1..maxDice）；没点中返回 null。
 *
 * ⚠️ 原版的命中判据与绘制**同一张分支表**（@source `0x00418228` 起）：
 *   機車 `y ∈ [19i + 0x10, 19i + 0x20]`、汽車 `y ∈ [16i + 9, 16i + 0x19]` ——
 *   两端都含，后面的 i 覆盖前面的。「覆盖」这一步由**倒序**查表实现，
 *   与逐像素 id 图里后写的覆盖先写的一致（W-65）。
 */
export function hitDiceToggle(
  x: number,
  y: number,
  maxDice: number,
  pos: GoPos,
  traffic: number,
): number | null {
  for (let i = maxDice - 1; i >= 0; i--) {
    if (inRect(x, y, diceToggleRect(i, pos, traffic))) return i + 1;
  }
  return null;
}

/**
 * 画 GO 鈕与骰子数切换。
 *
 * ★ GO 鈕的图号 = **组 + 帧**（`[0x48bdd4] + ebx`，@source VA 0x004172b9）：
 * - 组：`[player+0x38]`（停留）非 0 → **2 禁止通行**；`[player+0x39]`（烏龜）非 0
 *   → **4 烏龜**；否则 **0 普通**。两项都为非 0 时烏龜优先（原版后写的覆盖前面的）。
 * - 帧：`[0x48bdd4]`，由 **500 ms 的窗口定时器**翻转
 *   （`SetTimer(hwnd, 0x1f4=500, …)` @source VA 0x0041801e；翻转在 WM_TIMER
 *   处理里 VA 0x00418b7e `xor byte [0x48bdd4], 1`）。
 *   ⇒ **不点它也在闪**，一暗一亮。
 *
 * ⚠️ 原版**没有**鼠标悬停效果（棋盘窗口过程的 WM_MOUSEMOVE 只处理侧栏/工具栏），
 *   先前我们用悬停换图，那是自己加的，已去掉。
 *
 * @param goImage 上面算好的图号（`GO_IMAGE` 的某个值 + 闪烁帧）
 * @param maxDice 这个玩家最多能掷几颗（走路 1、機車 2、汽車 3）
 * @param ndices  当前选了几颗
 * @param pos     GO 鈕左上角（**棋盘画布**坐标，`GoButton.position()`）
 * @param traffic 交通方式（`player.trafficMethod & 3`）—— 决定三颗怎么排（W-65）
 * @param blocked 停留中（`player.blocking.stopping !== 0`）⇒ **三颗全画暗图**
 *   @source 亮/暗判据 `i <= ndices − 1` **且** `player+0x38`（停留）== 0 ⇒ 亮
 */
export function drawAdvance(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFn,
  goImage: number,
  maxDice: number,
  ndices: number,
  pos: GoPos,
  traffic = 0,
  blocked = false,
): void {
  // `pos` 已经是棋盘画布坐标（原版那个全局是屏幕坐标，换算在 `GoButton` 里做过了）
  const at = pos;
  const go = sprite('Panel.mkf', GO_RESOURCE, goImage, true);
  if (go !== null) ctx.drawImage(go.bitmap, at.x, at.y);

  for (let i = 0; i < maxDice; i++) {
    const pair = DICE_TOGGLE_IMAGE[i];
    if (pair === undefined) continue;
    // 亮的那张表示「这一颗算数」（停留中一颗都不算数）
    const lit = !blocked && i < ndices;
    const img = sprite('Panel.mkf', GO_RESOURCE, lit ? pair[1] : pair[0], true);
    if (img === null) continue;
    const r = diceToggleRect(i, pos, traffic);
    ctx.drawImage(img.bitmap, r.x, r.y);
  }
}

/**
 * 画已掷出的骰子 —— 原版是 `Panel.mkf` 资源 3，三颗各六面，
 * 图号 = `颗号 × 6 + 点数 − 1`（@source VA 0x0041965e）。
 *
 * **摆在哪逐条照原版**（@source VA 0x0041964f 的绘制循环）：
 * ```asm
 * edi = [eax*8 + 0x475224] + 0x88      ; eax = 屏幕朝向
 * ebp = [eax*8 + 0x475228] + 0x30
 * fcn_0045663e(面, 那张图, edi + 0x55, ebp + 0x91)
 *   ; 内部再做 x -= 图自己的锚点x ; y -= 图自己的锚点y
 * ```
 * 三颗图的锚点各不相同（见 `known-deviations.md` Q-TURN-1 §4），所以
 * **不是**同一个点往下叠 —— 这正是「三颗骰子并排躺在地上」的由来：
 * 第 1 颗 x = 1、第 2 颗 96、第 3 颗 153（宽 35 / 30 / 34）。
 *
 * @param screenDir 玩家朝向换算到屏幕后的方位（`(dir + 8 − view) & 7`）
 */
export function drawDice(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFn,
  dice: readonly number[],
  screenDir: number,
): void {
  const off = DICE_AT[((screenDir % 8) + 8) % 8] ?? [0, 0];
  const at = toBoard({ x: DICE_AT_BASE.x + off[0], y: DICE_AT_BASE.y + off[1] });
  for (let i = 0; i < dice.length && i < DICE_SLOTS; i++) {
    const img = sprite('Panel.mkf', DICE_RESOURCE, diceImage(i, dice[i] ?? 1), true);
    if (img === null) continue;
    // ★ 锚点在精灵里（`Sprite.anchorX/Y` = 资源自己的 x/y），按它反推左上角
    ctx.drawImage(img.bitmap, at.x - img.anchorX, at.y - img.anchorY);
  }
}

/**
 * 滚骰的 FLIC 该画在棋盘局部哪里。
 *
 * @source VA 0x004195d6：`edi = 0x88 + DX[屏幕朝向]`、`ebp = 0x30 + DY[屏幕朝向]`，
 *   FLIC 就画在 `(edi, ebp)`，尺寸 189×285。
 *   `DICE_AT_BASE` 是「点数图的落点」，本函数的原点是**影片左上角** ——
 *   两者差 `(0x55, 0x91)`。
 */
export function diceFlicOrigin(screenDir: number): { x: number; y: number } {
  const off = DICE_AT[((screenDir % 8) + 8) % 8] ?? [0, 0];
  return toBoard({
    x: DICE_AT_BASE.x - 0x55 + off[0],
    y: DICE_AT_BASE.y - 0x91 + off[1],
  });
}

/**
 * 画滚骰影片的一帧。
 *
 * ★ 原版把 FLIC 与点数图**都画进后台面、再整块贴回**（flags bit0 = 保存背景），
 *   而影片里的索引 0 是抠空的 —— 所以骰子是在棋盘上滚，不是盖一块方框。
 */
export function drawDiceFlic(
  ctx: CanvasRenderingContext2D,
  frame: ImageBitmap,
  screenDir: number,
): void {
  const at = diceFlicOrigin(screenDir);
  ctx.drawImage(frame, at.x, at.y);
}

/** 一次点击可能落在哪 */
export type DialogHit =
  | { kind: 'choice'; index: number }
  | { kind: 'amountStep'; delta: number }
  | { kind: 'amountMax' }
  | { kind: 'amountOk' }
  | { kind: 'amountCancel' }
  /**
   * 原版数字键盘窗上**按了第几号钮**（`0..15`）。
   *
   * ★ 2026-09-16 加（B-5(i)/B-6(i)）：把命中交给 `AMOUNT_SLOT_BY_ID`
   *   那套语义（数字/退格/C/M/Enter/金额栏光标），而不是自己排五颗钮。
   */
  | { kind: 'amountSlot'; id: number };

/** 正在填数的那一页；`null` 表示还在选项页 */
export interface AmountPage {
  choice: number;
  value: number;
}



interface Layout {
  /** 訊息框整块（棋盘区坐标） */
  box: Rect;
  /** 框内可写字的那一块 */
  inner: Rect;
  title: string;
  lines: string[];
  /** 按钮是不是原版的 YES/NO 控件 */
  yesNo: boolean;
  /**
   * 这一次的按钮是不是**原版那扇数字键盘窗**的命中区（`Panel#21`）。
   *
   * ★ 2026-09-16 加（B-5(i)/B-6(i)）：`layoutDialog` 把 `AMOUNT_KEY_RECTS`
   *   翻成一批没有标签的按钮；调用方据此**改为绘制原版窗**（`amount-window.ts`）
   *   而不是画自造的五钮条。
   */
  amountWindow?: boolean;
  buttons: { label: string; rect: Rect; hit: DialogHit }[];
}

/**
 * 原版键盘窗上那一号钮 → 本引擎的 `DialogHit`。
 *
 * ★ 语义与键盘那一路**同一套**（`amount-keys.ts` 的 `AMOUNT_SLOT_BY_ID`）：
 *   原版也是让键盘合成一条 `WM_LBUTTONUP` 再进同一段分派，所以这里让
 *   「鼠标点某一号钮」也走 `amountSlot`，由调用方按同一张表处理。
 *   只有「金额栏那两颗光标」是鼠标独有的（原版是拖动），单独给 `amountStep`。
 */
function amountHitForSlot(slot: ReturnType<typeof amountSlotOfId>, step: number, id: number): DialogHit {
  switch (slot?.kind) {
    // 数字 / 退格 / C / M / Enter —— 全部交给同一张语义表
    case 'digit':
    case 'backspace':
    case 'clear':
    case 'max':
    case 'ok':
      return { kind: 'amountSlot', id };
    // 金额栏的光标：鼠标独有的那两颗（原版是拖动），退化成按档微调
    case 'cursorLeft':
      return { kind: 'amountStep', delta: -step };
    case 'cursorRight':
      return { kind: 'amountStep', delta: step };
    default:
      return { kind: 'amountCancel' };
  }
}

/** 按框宽折行；原版自己那几段 `\n\n` 先照分 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line !== '') {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * 这一次的框是不是原版的 YES/NO 控件。
 *
 * ★ **两处共用**：`layoutDialog` 照它画/命中，「原版会替玩家把指针挪进框」
 *   （试玩3 #2，`cursor-warp.ts`）也照它判时机 —— 两边各判一套迟早对不上。
 */
export function usesYesNo(ui: InteractionUi, page: AmountPage | null): boolean {
  return page === null && ui.choices.length === 2;
}

/**
 * 算出这一帧对话框的版式。
 *
 * 绘制与命中判定**共用**它 —— 两边各算一遍迟早对不上，而且错法特别难看出来
 * （按钮看得见却点不中）。
 *
 * ★ 两个选项时用原版的 YES/NO 控件（`Data.mkf` 资源 440，96×48，居中在
 *   屏幕 (220,320)）。三个以上时原版走的是各自的专屏（銀行柜台、百貨公司、
 *   股市…），那些还没做，故先在框下面排一列普通按钮 —— 这一部分是**我们的**。
 */
export function layoutDialog(
  ctx: CanvasRenderingContext2D,
  ui: InteractionUi,
  page: AmountPage | null,
): Layout {
  ctx.font = FONT_BODY;
  const box = boardRect(BOX_SCREEN);
  const inner: Rect = {
    x: box.x + INNER.dx,
    y: box.y + INNER.dy,
    w: INNER.w,
    h: INNER.h,
  };

  const choice = page === null ? null : ui.choices[page.choice];
  const amount = choice?.amount;
  const detail =
    page !== null && amount !== undefined
      ? `${amount.label}\n${page.value.toLocaleString('en-US')}\n（上限 ${amount.max.toLocaleString('en-US')}）`
      : ui.detail;
  const lines = wrap(ctx, detail, inner.w);

  const labels: { label: string; hit: DialogHit }[] =
    page !== null && amount !== undefined
      ? [
          { label: `− ${amount.step}`, hit: { kind: 'amountStep', delta: -amount.step } },
          { label: `+ ${amount.step}`, hit: { kind: 'amountStep', delta: amount.step } },
          { label: '最大', hit: { kind: 'amountMax' } },
          { label: '確定', hit: { kind: 'amountOk' } },
          { label: '取消', hit: { kind: 'amountCancel' } },
        ]
      : ui.choices.map((c, i) => ({ label: c.label, hit: { kind: 'choice' as const, index: i } }));

  // ——— 两个选项 → 原版的 YES/NO ———
  const useYesNo = usesYesNo(ui, page);
  if (useYesNo) {
    const halves = yesNoHalves();
    return {
      box,
      inner,
      title: ui.title,
      lines,
      yesNo: true,
      buttons: [
        { label: 'YES', rect: boardRect(halves.yes), hit: { kind: 'choice', index: 0 } },
        { label: 'NO', rect: boardRect(halves.no), hit: { kind: 'choice', index: 1 } },
      ],
    };
  }

  // ——— 填数页：走**原版那扇数字键盘窗**（`fcn_00453544` / `Panel#21`）———
  //
  // ★ 2026-09-16 补（外部审查 B-5(i)/B-6(i)）：先前这里排的是自造的五钮条
  //   （`− step / + step / 最大 / 確定 / 取消`），并且本文件自己都注着
  //   「我们的做法，不是原版」。原版那扇窗的几何与编号语义已经全部解出
  //   （见 `amount-keys.ts` 的 `AMOUNT_WINDOW` / `AMOUNT_KEY_RECTS` /
  //   `AMOUNT_SLOT_BY_ID`），这里只负责**把命中交给它**。
  //
  //   取消仍然只走 ESC / 右键 —— 原版那扇窗自己**不认**取消键
  //   （见 `amount-keys.ts` 头部：ESC 是全局钩子补成 `0x205` 关的窗）。
  //   所以 `labels` 里保留一颗「取消」以便鼠标也能退，其余交给键盘窗。
  if (page !== null && amount !== undefined) {
    const slots: { label: string; rect: Rect; hit: DialogHit }[] = [];
    for (let id = 0; id < AMOUNT_KEY_RECTS.length; id++) {
      const r = AMOUNT_KEY_RECTS[id];
      if (r === undefined) continue;
      const slot = amountSlotOfId(id);
      if (slot === null) continue;
      // ⚠️ 0/1 是金额栏的左右光标：原版那两颗的矩形**互相重叠**、靠逐像素
      //   id 图分左右，本引擎没有那张图，给不出可靠的命中区
      //   ⇒ **不接**（宁可少两颗钮，也不要按错方向）。键盘那一路照旧可用
      //   （`H` 键 = 金额栏），见 `amount-keys.ts` 的注。
      if (slot.kind === 'cursorLeft' || slot.kind === 'cursorRight') continue;
      slots.push({
        label: '',
        rect: boardRect({ x: AMOUNT_WINDOW.x + r.x, y: AMOUNT_WINDOW.y + r.y, w: r.w, h: r.h }),
        hit: amountHitForSlot(slot, amount.step, id),
      });
    }
    // 取消那颗由我们自己加（原版没有：它靠 ESC / 右键）
    slots.push({
      label: '取消',
      rect: boardRect({
        x: AMOUNT_WINDOW.x,
        y: AMOUNT_WINDOW.y + AMOUNT_WINDOW.h + 4,
        w: AMOUNT_WINDOW.w,
        h: 20,
      }),
      hit: { kind: 'amountCancel' },
    });
    return { box, inner, title: ui.title, lines, yesNo: false, buttons: slots, amountWindow: true };
  }

  // ——— 其余：框下面排一列按钮（⚠️ 我们的做法，不是原版）———
  ctx.font = FONT_BUTTON;
  const widths = labels.map((l) => Math.max(BTN_MIN_W, Math.ceil(ctx.measureText(l.label).width) + 18));
  const rowW = box.w;
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (let i = 0; i < labels.length; i++) {
    const w = widths[i]!;
    if (row.length > 0 && used + BTN_GAP + w > rowW) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(i);
    used += (row.length > 1 ? BTN_GAP : 0) + w;
  }
  if (row.length > 0) rows.push(row);

  const buttons: Layout['buttons'] = [];
  let by = box.y + box.h + 4;
  for (const r of rows) {
    const total = r.reduce((sum, i) => sum + widths[i]!, 0) + (r.length - 1) * BTN_GAP;
    let bx = box.x + Math.round((rowW - total) / 2);
    for (const i of r) {
      buttons.push({
        label: labels[i]!.label,
        rect: { x: bx, y: by, w: widths[i]!, h: BTN_H },
        hit: labels[i]!.hit,
      });
      bx += widths[i]! + BTN_GAP;
    }
    by += BTN_H + BTN_GAP;
  }
  // 排不下就整体上移，别掉出棋盘
  const overflow = by - LAYOUT.board.h + 4;
  if (overflow > 0) for (const b of buttons) b.rect.y -= overflow;

  return { box, inner, title: ui.title, lines, yesNo: false, buttons };
}

/** 棋盘区坐标 → 点中了什么 */
export function hitDialog(
  ctx: CanvasRenderingContext2D,
  ui: InteractionUi,
  page: AmountPage | null,
  x: number,
  y: number,
): DialogHit | 'inside' | null {
  const l = layoutDialog(ctx, ui, page);
  for (const b of l.buttons) if (inRect(x, y, b.rect)) return b.hit;
  // ★ 落在框上但没中按钮：也要**吃掉**这一次点击，否则会穿透到棋盘上
  //   去选格子 —— 那正是「点了个按钮结果棋子动了」这类怪事的来源。
  return inRect(x, y, l.box) ? 'inside' : null;
}

/** 画在**棋盘区**的画布上（坐标即棋盘区坐标） */
export function drawDialog(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteFn,
  ui: InteractionUi,
  page: AmountPage | null,
  hot: DialogHit | null,
): void {
  const l = layoutDialog(ctx, ui, page);
  ctx.save();

  // ★ 填数页：直接画**原版那扇数字键盘窗**（`Panel#21` 图 0 整块 + 金额数字），
  //   不再画自造的金框五钮条（B-5(i)/B-6(i)）。
  //   命中已经由 `layoutDialog` 按 `AMOUNT_KEY_RECTS` 铺好了。
  if (l.amountWindow === true && page !== null) {
    // 上限喂给比例条（`值 / 上限 × 33`）；拿不到就当 0 ⇒ 整条都暗
    if (drawAmountWindow(ctx, sprite, page.value, ui.choices[page.choice]?.amount?.max ?? 0)) {
      ctx.restore();
      return;
    }
    // 面板图还没解好 → 落到下面那条兜底（画金框 + 取消），别画半扇窗
  }

  // ——— 框：原版的 Data.mkf 资源 517 图 5 ———
  const skin = sprite('Data.mkf', DIALOG_SKIN_RESOURCE, DIALOG_SKIN_IMAGE, true);
  if (skin !== null) {
    ctx.drawImage(skin.bitmap, l.box.x, l.box.y);
  } else {
    ctx.fillStyle = '#6b4a21';
    ctx.fillRect(l.box.x, l.box.y, l.box.w, l.box.h);
  }

  // ——— 文字 ———
  // ★ 第十三份試玩回報（「获得点券的文本提示框的文字应该上下居中，现在太偏上了」）：
  //   原版两扇框（询问 0x00440c3f / 訊息 0x00440dac）都是 `draw_text(…, 0xdc, 0x8c, flag 4)`
  //   —— flag 4 = **整块字的墨迹框以 (x,y) 为中心**（`0x44ff2a`：x −= 宽/2、y −= 高/2，
  //   宽高由 `0x44f70c` 扫离屏面上非 0 像素得来），而 (0xdc,0x8c) 正是框皮的锚点。
  //   先前从框内顶边往下排（`inner.y + 4`），单行的「得點券１０點」就贴在上沿。
  const mids = dialogRowMiddles(
    [
      ...(l.title !== '' ? [{ h: TITLE_H, size: TITLE_SIZE, blank: false }] : []),
      ...l.lines.map((t) => ({ h: LINE_H, size: BODY_SIZE, blank: t === '' })),
    ],
    DIALOG_ANCHOR.y,
  );
  const cx = DIALOG_ANCHOR.x;
  let row = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 先描边（`#101010`）再填字
  const line = (text: string, font: string, fill: string): void => {
    const y = mids[row++] ?? DIALOG_ANCHOR.y;
    ctx.font = font;
    ctx.lineWidth = 3;
    ctx.strokeStyle = BODY_OUTLINE;
    ctx.strokeText(text, cx, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, cx, y);
  };
  if (l.title !== '') line(l.title, FONT_TITLE, '#ffe8a5');
  for (const t of l.lines) line(t, FONT_BODY, BODY_FILL);

  // ——— 按钮 ———
  if (l.yesNo) {
    // 原版控件：整块一张图，哪半亮由图号决定
    const which =
      hot?.kind === 'choice' && hot.index === 0
        ? YESNO_IMAGE.yes
        : hot?.kind === 'choice' && hot.index === 1
          ? YESNO_IMAGE.no
          : YESNO_IMAGE.none;
    const img = sprite('Data.mkf', YESNO_RESOURCE, which, true);
    const at = boardRect({
      x: YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2,
      y: YESNO_CENTER_SCREEN.y - YESNO_SIZE.h / 2,
      ...YESNO_SIZE,
    });
    if (img !== null) ctx.drawImage(img.bitmap, at.x, at.y);
  } else {
    for (const b of l.buttons) {
      const on = hot !== null && JSON.stringify(hot) === JSON.stringify(b.hit);
      ctx.fillStyle = on ? '#e8d24a' : '#c6a56b';
      ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      ctx.strokeStyle = '#4a3110';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.rect.x + 0.5, b.rect.y + 0.5, b.rect.w - 1, b.rect.h - 1);
      ctx.fillStyle = '#2a1d0e';
      ctx.font = FONT_BUTTON;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2 + 1);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
