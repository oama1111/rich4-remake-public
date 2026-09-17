/*
 * 公佈欄屏（挂 / 撤 / 买 / 出价输入）—— T-033
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 這是**整屏**，不是棋盘上的对话框：原版另开一扇 640×480 的窗口盖住整场
 *   （`_rich4_ui_sale_entry` VA 0x004284be；工具列第 10 颗「SALE? 房子」与
 *   熱鍵「交易」都进这里）。规则早就在 core（`places/notice-board.ts`），
 *   本模块只摆位置、画字、算命中 —— 分工见 `ui-screen.ts`。
 *
 * ## 出处一览（全部自 `rich4.exe` 读出，截图只用来印证）
 *
 * | 是什么 | @source |
 * |---|---|
 * | 入口 `_rich4_ui_sale_entry` | VA 0x004284be |
 * | 主窗口过程 `fcn_00427c21` | VA 0x00427c21 |
 * | **底图重绘** `fcn_004249c2` | VA 0x004249c2 |
 * | **详情框** 窗口过程 `fcn_0042704e` | VA 0x0042704e |
 * | 賣股票 选物窗 `fcn_004258c1` | VA 0x004258c1 |
 * | 賣地產 选物窗 `fcn_0042608f` | VA 0x0042608f |
 * | 賣道具 选物窗 `fcn_004267a4` | VA 0x004267a4 |
 * | 賣卡片 选物窗 `fcn_00426c2e` | VA 0x00426c2e |
 * | 訊息框 `fcn_00424502` / 复原 `fcn_00424620` | VA 0x00424502 / 0x00424620 |
 * | 填数窗 `fcn_00453544` | VA 0x00453544 |
 * | 挂牌 `fcn_004246c5` / 撤件 `fcn_004247d5` / 成交 `fcn_004255da` | 同址 |
 *
 * ## 用到的图 —— `Panel.mkf` **#73**（入口 `push 0x49` VA 0x004284e2、`push 0x4a` VA 0x004284fc）
 *
 * | 图 | 尺寸 | 是什么 | @source |
 * |---|---|---|---|
 * | 0 | 596×348 | **软木板底图**（含 `公佈欄` 标题、SALE／EXIT 两颗钮、右下黄猫） | 0x004249e8 |
 * | 1 | 336×416 | 賣股票 选物窗底板（3 列清单） | 0x004259ab |
 * | 2 | 416×416 | 賣地產 选物窗底板（5 列清单 + 5 个分类页签） | 0x00424bc9 |
 * | 3 | 360×128 | 賣道具 选物窗底板（5×3 格 + 右上 EXIT） | 0x00426835 |
 * | 4 | 360×128 | 賣卡片 选物窗底板（同上） | 0x00426cc6 |
 * | 5 | 184×88 | **訊息框**（「公佈欄已滿…」） | 0x00424588 |
 * | 6 | 192×224 | **详情框**：道具／卡片（類型／市價／賣價） | 0x0042717f |
 * | 7 | 192×256 | **详情框**：股票（類型／張數／市價／賣價） | 表 `0x4754ac` |
 * | 8 | 192×288 | **详情框**：地產（類型／地點／等級／市價／賣價） | 表 `0x4754ac` |
 * | 9–12 | 72×72 | **挂牌格**：女（粉底）股票／地產／道具／卡片 | 0x00424a65 |
 * | 13–16 | 72×72 | **挂牌格**：男（蓝底）股票／地產／道具／卡片 | 0x00424a65 |
 * | 17 | 144×96 | **SALE 弹出选单**（四格：股票／地產／道具／卡片） | 0x00427f88 |
 * | 18 | 21×21 | 選物窗的 ✕（**按下**时才盖在图 1 上） | 0x00425d8e |
 * | 19 | 80×32 | 地產選物窗**当前那一页**的页签底板 | 0x00424bf1 |
 *
 * ★ 图 9–16 的取法是 `8 + player[+0x14] * 4 + kind`（VA 0x00424a4b）——
 *   `player + 0x14` 是 **`sex`（非 0 男 / 0 女）**（见 `docs/player-struct.md`），
 *   所以四种类型各有一男一女两张底：**女用 9–12、男用 13–16**。
 *
 * ★ 图 0 的标题与四颗钮的字是**烤进图里**的（归档 PNG 就有）；但图 1／2／6／7／8
 *   上面的**标签**不是 —— 那些是原版**载入后画进图里**的（入口 0x004285xx 那一串
 *   `draw_text`），归档资源里没有。所以本模块要在运行时补画它们，落点照原版
 *   往图里画时的**图内坐标**再加图的落点。
 *
 * ## 四条容易踩的
 *
 * ① **落点要减图自带的锚点**：`fcn_004562a5` / `fcn_00456418` 内部都做
 *    `x -= src->x`（VA 0x00455c64）。头像那几张就是靠它才落到正确位置的。
 *
 * ①′ **头像的坐标是「底图内」的，不是屏幕坐标**：原版拿图 0 当画布往上贴
 *    （`add eax, 0xc` VA 0x00428813），所以要再加 `BOARD_PANEL_AT`。
 *    我第一版当成屏幕坐标画，四位头像全跑到软木板左边去了 —— 见 `boardPortraitAt()`。
 * ② **按下与抬手的动作不一样**：SALE／EXIT／挂牌格都是**按下**记状态、**抬手**
 *    才成立（`0x201` 在 `fcn_00427ea1`、`0x202` 在 `loc_004281af`）；
 *    SALE 弹出选单里的四格则是**悬停**（`0x200` @ `loc_00427cfd`）决定点中哪一个。
 *
 * ②′ **SALE 选单是「按住拖」的手势**：按下那一刻选单才贴出来（VA 0x00427f12），
 *    拖动时 `0x200` 记下悬停到第几格，**抬手**才按那一格开选物窗（VA 0x004281d4）。
 *    所以在 SALE 上原地点一下是**打不开**选物窗的 —— 选单一闪就收掉（那条
 *    路径就是 `[0x48c2cb] == 0` → 只重画主屏）。
 * ③ 判定顺序 **SALE → EXIT → 挂牌格**（VA 0x00427ea1 / 0x00427fc8 / 0x00428085），
 *    颠倒会点错。
 *
 * ## 出价输入
 *
 * 原版走的是**另开的填数窗** `fcn_00453544`（`Panel.mkf` #21/#22 数字键盘），
 * 参数是**上限**（`0x4531f6 cmp eax, edx / jle` 越界夹回）。四种类型各自的上限：
 *
 * | 类型 | 进填数窗的值 | 上限 | @source |
 * |---|---|---|---|
 * | 股票 | 持有股數 | 持有股數 | 0x00425ea2（`fcn_00453544` 传 `holdings`） |
 * | 地產 | 估值 × 物價 | 估值 × 物價 × 10 | 0x004265f5（`shl 2 / add / add` = ×10） |
 * | 道具 | 市價 | 市價 × 10 | 0x00426af2 |
 * | 卡片 | 市價 | 市價 × 10 | 0x00426f0f |
 *
 * 本引擎按卡片要求复用 `dialog.ts` 的 `AmountPage`（框的美术不同，记 `D-BOARD-2`），
 * 并按 `board-screen.ts` 原 stub 的说法把**初始值钉在「市價」**上（`*ListPrice`）。
 */

import type { Action, GameState, Listing, MapTopology } from '@rich4/core';
import {
  BOARD_SLOTS,
  ESTATE_FACILITY_BASE,
  ESTATE_LAND_BASE,
  LISTING,
  cardListPrice,
  decodeEstate,
  estateListPrice,
  allEffectiveLands,
  calculateLandToll,
  isColumnFull,
  stockListPrice,
  toolCount,
  toolListPrice,
} from '@rich4/core';
import { CARDS, CHARACTERS, TOOLS, stocksOfMap } from '@rich4/data';
import type { AmountPage, DialogHit } from './dialog.ts';
import { drawDialog, hitDialog } from './dialog.ts';
import { AMOUNT_KEY_BY_ID, amountKeyStep, amountSlotOfId } from './amount-keys.ts';
import { amountKeyOfSlotId } from './amount-window.ts';
import type { InteractionUi } from './interactions.ts';
import { FONT_FAMILY } from './font.ts';
import { LAYOUT } from './stage.ts';
import {
  inRect,
  YESNO_CENTER_SCREEN,
  YESNO_IMAGE,
  YESNO_RESOURCE,
  YESNO_SIZE,
  yesNoHalves,
} from './gameui.ts';
import { portraitResource, type Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/**
 * 挂牌栏里的一项 —— 直接用 core 的 `Listing`（`places/notice-board.ts`）。
 *
 * ★ 这一屏曾经把 `Listing` / `LISTING` / 四条市價公式**在本地重写了一份**，
 *   因为 `@rich4/core` 当时没有出口那个模块。2026-09-15 中央补上了
 *   `index.ts` 的 `export * from './places/notice-board.ts'`，本模块改成真 import，
 *   双份公式消除（见 `docs/deviations/T-033.md` 的 `D-BOARD-1`）。
 */
export type { Listing };

// ============================================================
//  资源与图号
// ============================================================

/** 本屏底图所在资源 @source VA 0x004284e2 `push 0x49` */
export const BOARD_RESOURCE = 0x49;
/** 道具图标所在资源（也是商店/道具欄那一份） @source VA 0x004284fc `push 0x4a` */
export const BOARD_TOOL_RESOURCE = 0x4a;

/** 软木板底图（含标题、SALE／EXIT、黄猫）@source VA 0x004249e8 `[0x48c298]+0xc` */
export const BOARD_PANEL_CHUNK = 0;
/** SALE 弹出的四格选单 @source VA 0x00427f88 `[0x48c298]+0xd8` */
export const BOARD_POPUP_CHUNK = 17;
/** 訊息框 @source VA 0x00424588 `[0x48c298]+0x48` */
export const BOARD_MSG_CHUNK = 5;
/** 選物窗右上那颗 ✕ @source VA 0x00425d8e `[0x48c298]+0xe4` */
export const BOARD_CLOSE_CHUNK = 18;
/** 地產選物窗的分类页签 @source VA 0x00424bf1 `[0x48c298]+0xf0` */
export const BOARD_TAB_CHUNK = 19;

/** 头像在 `map.mkf` 里的资源基址：`0x1b + 角色号` @source VA 0x0040801f `add eax, 0x1b` */
export const PORTRAIT_RESOURCE_FIRST = 0x1b;

/** 挂牌格图号：**女 9–12、男 13–16** @source VA 0x00424a46..0x00424a50 `8 + sex*4 + kind` */
export const BOARD_SLOT_CHUNK_FIRST = 8;

/**
 * 挂牌格用哪张图。
 *
 * @param isMale `player + 0x14 != 0`（`docs/player-struct.md`：非 0 男、0 女）
 * @param kind   挂牌类型 1 股票 / 2 地產 / 3 道具 / 4 卡片
 * @source VA 0x00424a46..0x00424a50：`dl = 槽類型; eax = player[+0x14] << 2; edx = dl + eax + 8`
 */
export function slotChunk(isMale: boolean, kind: number): number {
  return BOARD_SLOT_CHUNK_FIRST + (isMale ? 1 : 0) * 4 + kind;
}

/** 详情框用哪张图 @source 表 `0x4754ac` 的取法 `byte [0x4754ab + kind]` */
export const DETAIL_CHUNK: Readonly<Record<number, number>> = { 1: 7, 2: 8, 3: 6, 4: 6 };

/** 详情框三张图的尺寸（Panel.mkf #73 的 SMP 表）*/
export const DETAIL_SIZE: Readonly<Record<number, { w: number; h: number }>> = {
  6: { w: 192, h: 224 },
  7: { w: 192, h: 256 },
  8: { w: 192, h: 288 },
};

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 底图落点 @source VA 0x004249df `push 0x42`(y) / 0x004249e1 `push 0x16`(x) */
export const BOARD_PANEL_AT = { x: 0x16, y: 0x42 } as const;

/** 第 0 个玩家那一行的 y @source VA 0x004249fd `mov ebp, 0x72` */
export const BOARD_ROW_Y0 = 0x72;
/** 第 0 个挂牌格的 x @source VA 0x00424a10 `mov esi, 0x68` */
export const BOARD_SLOT_X0 = 0x68;
/** 格距（挂牌格 72×72）@source VA 0x00424a7e `add ebp, 0x48` / `add esi, 0x48` */
export const BOARD_CELL = 0x48;
/** 每个玩家几格 @source `rich4_num_players` 那一圈的单位矩阵：0x54/12 = 7 */
export const BOARD_COLS = 7;

/**
 * 玩家头像（`map.mkf` 图 `0x1b + character` 的第 0 张）的锚点落点。
 *
 * ★ **这是底图（图 0）内坐标，不是屏幕坐标** —— 原版是拿图 0 当画布往上贴的：
 * ```asm
 * 004287fb  lea eax, [edi + 0x24]    ; y（图内）
 * 004287ff  push 0x2c                ; x（图内）
 * 0042880e  mov eax, [0x48c298]
 * 00428813  add eax, 0xc             ; ★ dst = 图 0
 * 00428817  call fcn_004562a5        ; 带透明 + 减锚点
 * ```
 * 所以落到屏幕上要再加图 0 的落点 `BOARD_PANEL_AT`。用 `boardPortraitAt()` 换算。
 */
export const BOARD_PORTRAIT_AT = { x: 0x2c, y: 0x54 } as const;

/** 第 `player` 位玩家头像的**屏幕**锚点落点 */
export function boardPortraitAt(player: number): { x: number; y: number } {
  return {
    x: BOARD_PANEL_AT.x + BOARD_PORTRAIT_AT.x,
    y: BOARD_PANEL_AT.y + BOARD_PORTRAIT_AT.y + BOARD_CELL * player,
  };
}

/** SALE 钮命中区（**开**区间）@source VA 0x00427ea1 */
export const BOARD_SALE_HIT = { x0: 0x1d0, y0: 0x4a, x1: 0x218, y1: 0x72 } as const;
/** EXIT 钮命中区（**开**区间）@source VA 0x00427fc8 */
export const BOARD_EXIT_HIT = { x0: 0x218, y0: 0x4a, x1: 0x260, y1: 0x72 } as const;

/** 弹出选单落点 @source VA 0x00427f12 尾：`push 0x74`(y) `push 0x1d0`(x) */
export const BOARD_POPUP_AT = { x: 0x1d0, y: 0x74 } as const;

/**
 * 弹出选单里那四格的几何 @source VA 0x00427cfd（`0x200` 分支）：
 * 除算基准 `(0x1d9, 0x7d)`、格距 `(0x3f, 0x27)`；
 * 序号 `= 2 * ((x−0x1d9)/0x3f) + (y−0x7d)/0x27` —— **先竖后横**。
 * 命中区是**开**区间 `x∈(0x1d9,0x256) ∧ y∈(0x7d,0xca)`；高亮框是 62×38。
 */
export const BOARD_POPUP_GRID = {
  x0: 0x1d9,
  y0: 0x7d,
  x1: 0x256,
  y1: 0xca,
  cw: 0x3f,
  ch: 0x27,
  /** 高亮框尺寸（比格距各小 1px）*/
  hw: 0x3e,
  hh: 0x26,
  cols: 2,
  rows: 2,
} as const;

/**
 * 弹出选单第 `i` 格 → 挂牌类型。
 *
 * @source VA 0x004281f6：`PostMessage(hwnd, 0x40e + 悬停格号, 0, 0)`，而
 *   `0x40f → fcn_004258c1`（股票）、`0x410 → fcn_0042608f`（地產）、
 *   `0x411 → fcn_004267a4`（道具）、`0x412 → fcn_00426c2e`（卡片）
 *   —— 与 `LISTING` 的 1/2/3/4 同序，也与图 17 上那四个图标
 *   （左上走势图、左下房子、右上炸药、右下三张牌）一一对上。
 */
export const BOARD_SALE_KINDS: readonly number[] = [1, 2, 3, 4];

/**
 * 详情框底部那两排钮的 y（**相对框左上角**）@source
 * 股票 0x0042745b `mov word [0x48c2c8], 0xec`、
 * 地產 0x0042770c `…, 0x109`、道具／卡片 0x00427963 `…, 0xcb`。
 */
export const DETAIL_BTN_Y: Readonly<Record<number, number>> = { 1: 0xec, 2: 0x109, 3: 0xcb, 4: 0xcb };

/** 详情框右上那格商品图（就是挂牌格那张图）的框内落点 @source VA 0x004271ce（+6）/ 0x004271d9（+0x70）*/
export const DETAIL_ICON_AT = { dx: 0x70, dy: 6 } as const;
/** 玩家名（flag 2 正中）的框内落点 @source VA 0x0042722a（+0x28）/ 0x00427235（+0x3a）*/
export const DETAIL_NAME_AT = { dx: 0x3a, dy: 0x28 } as const;
/** 两颗钮的框内 x 区间 @source VA 0x00427a63 / 0x00427a6a（撤件）、0x00427a8f / 0x00427a96（EXIT）*/
export const DETAIL_ACTION_HIT = { x0: 0x10, x1: 0x58 } as const;
export const DETAIL_EXIT_HIT = { x0: 0x68, x1: 0xb0 } as const;
/** 钮的上下半高 @source VA 0x00427a39 `lea esi, [ecx − 0xc]` / 0x00427a42 `add ecx, 0xc` */
export const DETAIL_BTN_HALF = 0x0c;
/** 两颗钮的字（原版运行时画上去的）@source 串 0x463ef7 / 0x463efd */
export const DETAIL_ACTION_LABEL = { withdraw: '撤 件', buy: '購 買' } as const;

/**
 * 详情框里要补画的标签（原版把标签烤进图里，归档 PNG 没有）——
 * 图内落点与图号照入口 VA 0x00428556 起那一串 `draw_text` 抄。
 *
 * ★ 标签用 flag 2（正中）画在 x=0x1f，正好落在版面左侧那条留白里；
 *   值用 flag 2（居中）或 flag 6（右中）画在右边那条浅色条上。
 */
export const DETAIL_LABELS: Readonly<Record<number, readonly string[]>> = {
  6: ['類型：', '市價：', '賣價：'],
  7: ['類型：', '張數：', '市價：', '賣價：'],
  8: ['類型：', '地點：', '等級：', '市價：', '賣價：'],
};

/** 标签在框内的落点（图内坐标）@source 入口 VA 0x0042856f 起那一串 */
export const DETAIL_LABEL_AT: Readonly<Record<number, readonly { x: number; y: number }[]>> = {
  6: [
    { x: 0x1f, y: 0x5c },
    { x: 0x1f, y: 0x7a },
    { x: 0x1f, y: 0x98 },
  ],
  7: [
    { x: 0x1f, y: 0x5c },
    { x: 0x1f, y: 0x7c },
    { x: 0x1f, y: 0x9c },
    { x: 0x1f, y: 0xbc },
  ],
  8: [
    { x: 0x1f, y: 0x5c },
    { x: 0x1f, y: 0x7c },
    { x: 0x1f, y: 0x9c },
    { x: 0x1f, y: 0xbc },
    { x: 0x1f, y: 0xdc },
  ],
};

/**
 * 详情框里**值**的落点（框内坐标）。逐条照四个分支：
 * 股票 VA 0x0042728e、地產 VA 0x00427469、道具 VA 0x0042771a、卡片 VA 0x00427816。
 * `align`：`center` = flag 2（正中）、`right` = flag 6（右中）。
 */
export const DETAIL_VALUE_AT: Readonly<
  Record<number, readonly { x: number; y: number; align: 'center' | 'right' }[]>
> = {
  1: [
    { x: 0x78, y: 0x5c, align: 'center' }, // 類型
    { x: 0xb2, y: 0x7c, align: 'right' }, // 張數
    { x: 0xb2, y: 0x9c, align: 'right' }, // 市價
    { x: 0xb2, y: 0xbc, align: 'right' }, // 賣價
  ],
  2: [
    { x: 0x78, y: 0x5c, align: 'center' }, // 類型
    { x: 0x78, y: 0x7c, align: 'center' }, // 地點
    { x: 0x78, y: 0x9c, align: 'center' }, // 等級
    { x: 0xb2, y: 0xbc, align: 'right' }, // 市價
    { x: 0xb2, y: 0xdc, align: 'right' }, // 賣價
  ],
  3: [
    { x: 0x78, y: 0x5c, align: 'center' }, // 類型
    { x: 0xb2, y: 0x7a, align: 'right' }, // 市價
    { x: 0xb2, y: 0x98, align: 'right' }, // 賣價
  ],
  4: [
    { x: 0x78, y: 0x5c, align: 'center' }, // 類型
    { x: 0xb2, y: 0x7a, align: 'right' }, // 市價
    { x: 0xb2, y: 0x98, align: 'right' }, // 賣價
  ],
};

/** 訊息框落点（flag 1 → y = 0xc4）@source `fcn_00424502` VA 0x00424515 / 0x0042451a */
export const BOARD_MSG_AT = { x: 0xe3, y: 0xc4 } as const;
/** 訊息框里的字（flag 4 正中）@source VA 0x004245dc `push 0x140` / `ebx + 0x2c` */
export const BOARD_MSG_TEXT = { x: 0x140, dy: 0x2c } as const;
/** 訊息框显示多久 @source VA 0x00427ed4 `push 0x5dc` */
export const BOARD_MSG_MS = 0x5dc;

/** 板满时那一句 @source 串 0x463f03 */
export const BOARD_FULL_MSG = '公佈欄已滿\n\n請先撤件！';

// ============================================================
//  选物窗几何
// ============================================================

/**
 * 卡片／道具两个选物窗**共用同一套几何**（只有底板图不同）：
 * 底板落在 (0x8c, 0xa0)，里面是 5 列 × 3 行、格距 72×32；
 * 第一格的名字画在 (0xb0, 0xd0)，命中基准 (0x8c, 0xc0)。
 * ✕ 的命中区 `x∈(0x1ac,0x1f4) ∧ y∈(0xa0,0xc0)`。
 *
 * @source 卡片 `fcn_00426c2e` VA 0x00426cc6（底板）/ `loc_00426d05`（画）/ `loc_00426d82`（命中）；
 *   道具 `fcn_004267a4` VA 0x00426835 / `loc_0042688b` / `loc_00426974`。
 */
export const PICK_GRID = {
  at: { x: 0x8c, y: 0xa0 },
  cellX0: 0xb0,
  cellY0: 0xd0,
  cw: 0x48,
  ch: 0x20,
  cols: 5,
  rows: 3,
  hitX0: 0x8c,
  hitX1: 0x1f4,
  hitY0: 0xc0,
  hitY1: 0x120,
  exitX0: 0x1ac,
  exitX1: 0x1f4,
  exitY0: 0xa0,
  exitY1: 0xc0,
  /** 道具图标的格内 x 偏移（原版 `lea eax, [esi − 0x10]`）@source VA 0x004268b0 */
  toolIconDx: -0x10,
  /** 道具数量 `×N` 的格内 x 偏移 @source VA 0x004268e4 `lea eax, [esi + 0x1e]` */
  toolCountDx: 0x1e,
} as const;

/**
 * 股票选物窗：底板图 1 落在 (0x98, 0x20)（336×416），
 * 每支占一行 32px、第一行文字 y = 0x50；三列 x = 0xc8 / 0x14c / 0x1de
 * （名称 flag 2、持有張數 flag 6、總市價 flag 6）。
 * 行命中 y∈(0x40,0x1c0)、x∈(0x98, 0x98+336)；✕ 是图 18，命中 `x∈(0x1cf,0x1e4) ∧ y∈(0x26,0x3b)`。
 *
 * @source `fcn_004258c1` VA 0x00425953（底板）/ 0x004259e4（画）/ 0x00425b19（行命中）/ 0x00425cfa（✕）。
 */
export const PICK_STOCK = {
  chunk: 1,
  at: { x: 0x98, y: 0x20 },
  w: 336,
  rowY0: 0x50,
  rowDy: 0x20,
  hitY0: 0x40,
  hitY1: 0x1c0,
  colName: 0xc8,
  colAmount: 0x14c,
  colValue: 0x1de,
  exitX0: 0x1cf,
  exitX1: 0x1e4,
  exitY0: 0x26,
  exitY1: 0x3b,
} as const;

/**
 * 地產选物窗：底板图 2 落在 (0x70, 0x20)（416×416）；行 32px、命中 y∈(0x60,0x1c0)；
 * 分类页签是图 19（80×32）画在 `(0x70 + 80*页, 0x20)`，页签命中 `x∈(0x70,0x70+416) ∧ y∈(0x20,0x3e)`；
 * 右上 ✕ 与滚动条同一条 16px 竖带 `x∈(0x1ff,0x210)`（✕ 在 y∈(0x20,0x33)）。
 *
 * @source `fcn_0042608f` 的 `fcn_00424aea` VA 0x00424bc9（底板）/ `loc_004261cb`（行命中，0x200）/ `loc_00426387`（页签）/ `loc_0042643e`（✕/滚动条）。
 */
export const PICK_ESTATE = {
  chunk: 2,
  at: { x: 0x70, y: 0x20 },
  w: 416,
  h: 416,
  rowY0: 0x60,
  rowDy: 0x20,
  hitY1: 0x1c0,
  tabY0: 0x20,
  tabY1: 0x3e,
  tabW: 0x50,
  /**
   * 一行文字的**中心 y** = `0x70 + 0x20 × 行号`
   * @source VA 0x00424aea 的 `mov esi, 0x70` 与 `add esi, 0x20`。
   * （命中基准 0x60 是那条分隔线，行的**中心**比它晚 16px —— 别混用。）
   */
  rowTextY0: 0x70,
  barX0: 0x1ff,
  barX1: 0x210,
  closeY0: 0x20,
  closeY1: 0x33,
} as const;

/**
 * 地產清单那五列的 x 与对齐。
 *
 * @source 列头表 `0x4754b0` = `[147, 231, 319, 395, 471]`；
 *   数据行的取法见 VA 0x00424aea 的 `loc_00424c64`（地块）与 `loc_00424e06`（設施）：
 *   地點 `[0x4754b0]` flag 2、開發狀況 `[0x4754b2]` flag 2、
 *   **價格 `[0x4754b4] + 0x21`** flag 6、**收費 `[0x4754b6] + 0x1d`** flag 6、
 *   租期 `[0x4754b8]` flag 2 —— 后三列里 價格/收費 的 x 是**表头再加一个偏移**。
 */
export const PICK_ESTATE_COL = [
  { x: 0x93, align: 'center' }, // 地點   147
  { x: 0xe7, align: 'center' }, // 開發狀況 231
  { x: 0x13f + 0x21, align: 'right' }, // 價格 352
  { x: 0x18b + 0x1d, align: 'right' }, // 收費 424（`estateFeeLabel`，2026-09-16 起已画）
  { x: 0x1d7, align: 'center' }, // 租期 471（`estateTenureLabel`，2026-09-16 起已画）
] as const;

/**
 * 地產清单「收費」那一列的金额。
 *
 * ★ 2026-09-16 补（外部审查 B-6(ii)）。**用的是引擎自己的规则函数**
 *   `calculateLandToll` —— 原版那一列也是调**同一个** `_rich4_calculate_land_toll`
 *   （`rich4_ui_sale.asm:737` 等四处 `call 0x419744` 之后把结果写进
 *   `[0x4754ba]` 那一路的显示槽）。参数与原版第一处调用点一致：
 *   `push 0 / push current_player+1` ⇒ 第二条参数 = **null**（连锁店分支）。
 *
 * ⚠️ 近似：原版按 `ebx`（1/2/3）还会分「全图 / 单块房屋 / 同名区」几支，
 *   具体的取整与分支条件没有逐条核出来。这里统一按 `null`（连锁店那支）算，
 *   与「该玩家每一个连锁店 2000 × 物價指數」的规则一致。
 *   登记在 D-BOARD-3。
 */
export function estateFeeLabel(
  state: GameState,
  topo: MapTopology,
  itemId: number,
): string {
  if (itemId < 0) return '';
  // ★ 归属/等级/类型要**运行时**那一份（`topo.lands` 是静态表，owner 恒 0）
  const lands = allEffectiveLands(state, topo);
  const index = state.priceIndex;

  // ── 設施那一支（`dx >= 0xfa0`）@source VA 0x00424e6d 起 ──
  //   收費 = `word [设施 + 等级*2 + 0x24]`（= 该等级的收费表）× 物價指數；
  //   `+0x18(类型) == 0` 或 `+0x1a(等级) == 0` 时写 **0**（原版那两句 `je` 直接 xor eax,eax）
  if (itemId >= ESTATE_FACILITY_BASE) {
    const id = itemId - ESTATE_FACILITY_BASE;
    const level = state.facilityLevel[id] ?? 0;
    const type = state.facilityType[id] ?? 0;
    if (level === 0 || type === 0) return '$0';
    const fac = (topo.facilities ?? []).find((f) => f.id === id);
    const rate = fac?.rateByLevel?.[level] ?? 0;
    return `$${(rate * index).toLocaleString('en-US')}`;
  }

  // ── 地塊那一支 ──
  const id = itemId - ESTATE_LAND_BASE;
  const land = lands.find((l) => l.id === id);
  if (land === undefined) return '$0';
  // @source 0x00424cb1：`cmp byte [ebx+0x18], 0 / jne 0x424d03` —— **住宅**（类型 0）走
  //   `calculate_land_toll(该地 owner, 该地**名字**)` = **同名区**那一支（同主同名之地的收费和）；
  //   **连锁店**（类型 != 0）走函数开头算好的 `ebp` = `calculate_land_toll(当前玩家+1, null)`
  //   = 该玩家**全部连锁店**的合计（所以连锁店每一行都是同一个数 —— 原版如此）。
  const fee =
    land.type === 0
      ? calculateLandToll(lands, land.owner, index, land.name)
      : calculateLandToll(lands, state.currentPlayer + 1, index, null);
  return `$${fee.toLocaleString('en-US')}`;
}

/**
 * 地產清单「租期」那一列 —— **到期日**（不是倒计时）。
 *
 * @source `[0x4754b8]` 那一格；数据来自 `state.landTenure` / `state.facilityTenure`
 *   （= 地块 `+0x30` / 設施 `+0x34` 的到期日，打包成 `(年<<16)|(月<<8)|日`，`0` = 无期限）。
 *
 * ★ 2026-09-17 定案（先前写「N天」是没核就猜的，见 D-BOARD-3）：
 * ```asm
 * 00424d3a  mov ecx, [ebx + 0x30]        ; 地块（設施那一支读 +0x34，同构）
 *           test ecx, ecx / je → 固定串 0x463e42 = 「無限期」
 *           edx = (v >> 16) / 100        ; 年 —— 原版就是这么除的（0x64 = 100）
 *           [esp+0x90] = (v >> 8) & 0xf  ; 月
 *           eax = v & 0xff               ; 日
 *           sprintf(buf, "%02d/%d/%d", edx, 月, 日)   ; ★ 格式串 0x463e37
 * ```
 *   ⇒ 显示 **`YY/M/D`**（只有年补零到两位）：年 2002 → `2002/100 = 20` → `20/10/23`。
 */
export function estateTenureLabel(
  state: GameState,
  itemId: number,
): string {
  const isFacility = itemId >= ESTATE_FACILITY_BASE;
  const id = isFacility ? itemId - ESTATE_FACILITY_BASE : itemId - ESTATE_LAND_BASE;
  const tenure = isFacility ? (state.facilityTenure[id] ?? 0) : (state.landTenure[id] ?? 0);
  if (tenure <= 0) return '無限期';
  const y = Math.trunc((tenure >>> 16) / 100);
  const m = (tenure >>> 8) & 0xf;
  const d = tenure & 0xff;
  return `${String(y).padStart(2, '0')}/${m}/${d}`;
}

/** 五个分类页签的名字 @source 表 `0x4753d4` */
export const PICK_TABS = ['全  部', '住宅區', '商業區', '房  屋', '連鎖店'] as const;

// ============================================================
//  命中（纯函数）
// ============================================================

function inOpen(x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
}

/** 一个挂牌格在屏幕上的矩形 @source VA 0x00424a10（x）/ 0x004249fd（y）*/
export function boardSlotRect(
  player: number,
  slot: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: BOARD_SLOT_X0 + slot * BOARD_CELL,
    y: BOARD_ROW_Y0 + player * BOARD_CELL,
    w: BOARD_CELL,
    h: BOARD_CELL,
  };
}

/**
 * 点在第几号玩家的第几格上；没点中返回 `null`。
 *
 * @source VA 0x00428085：`x∈(0x68,0x260)`、`y∈(0x72, 0x72 + 0x48 × 玩家数)`，
 *   且 `玩家 = (y−0x72)/0x48`、`格 = (x−0x68)/0x48` —— 都是**开**区间。
 */
export function hitBoardSlot(
  x: number,
  y: number,
  playerCount: number,
): { player: number; slot: number } | null {
  if (x <= BOARD_SLOT_X0 || x >= 0x260) return null;
  if (y <= BOARD_ROW_Y0) return null;
  if (y >= BOARD_ROW_Y0 + BOARD_CELL * playerCount) return null;
  const player = Math.floor((y - BOARD_ROW_Y0) / BOARD_CELL);
  const slot = Math.floor((x - BOARD_SLOT_X0) / BOARD_CELL);
  if (player < 0 || slot < 0 || slot >= BOARD_COLS) return null;
  return { player, slot };
}

/** 点在上架的 `SALE` 钮上 @source VA 0x00427ea1 */
export function hitBoardSale(x: number, y: number): boolean {
  return inOpen(x, y, BOARD_SALE_HIT);
}

/** 点在离开的 `EXIT` 钮上 @source VA 0x00427fc8 */
export function hitBoardExit(x: number, y: number): boolean {
  return inOpen(x, y, BOARD_EXIT_HIT);
}

/** 弹出选单第 `i` 格的矩形（屏幕坐标）@source VA 0x00427df4 起 */
export function salePopupRect(i: number): { x: number; y: number; w: number; h: number } {
  const g = BOARD_POPUP_GRID;
  return {
    x: g.x0 + g.cw * Math.floor(i / g.rows),
    y: g.y0 + g.ch * (i % g.rows),
    w: g.hw,
    h: g.hh,
  };
}

/** 点在弹出选单的第几格上；没点中返回 `null` @source VA 0x00427cfd */
export function hitSalePopup(x: number, y: number): number | null {
  const g = BOARD_POPUP_GRID;
  if (x <= g.x0 || x >= g.x1) return null;
  if (y <= g.y0 || y >= g.y1) return null;
  const col = Math.floor((x - g.x0) / g.cw);
  const row = Math.floor((y - g.y0) / g.ch);
  if (col < 0 || col >= g.cols || row < 0 || row >= g.rows) return null;
  return col * g.rows + row;
}

/** 详情框在屏幕上占哪儿（三张图都是 640×480 居中）@source VA 0x0042710f 起 */
export function boardDetailRect(kind: number): { x: number; y: number; w: number; h: number } {
  const size = DETAIL_SIZE[DETAIL_CHUNK[kind] ?? 6] ?? { w: 192, h: 224 };
  return {
    x: Math.trunc((640 - size.w) / 2),
    y: Math.trunc((480 - size.h) / 2),
    w: size.w,
    h: size.h,
  };
}

/**
 * 详情框底下那颗钮。
 *
 * @source VA 0x00427a18：先看 y 是否落在 `boxY + btnY ± 0xc`，
 *   再看 x：`(boxX+0x10, boxX+0x58)` 是撤件／購買、`(boxX+0x68, boxX+0xb0)` 是 EXIT。
 */
export function hitBoardDetailButton(kind: number, x: number, y: number): 'action' | 'exit' | null {
  const r = boardDetailRect(kind);
  const btnY = r.y + (DETAIL_BTN_Y[kind] ?? 0xcb);
  if (y <= btnY - DETAIL_BTN_HALF || y >= btnY + DETAIL_BTN_HALF) return null;
  if (x > r.x + DETAIL_ACTION_HIT.x0 && x < r.x + DETAIL_ACTION_HIT.x1) return 'action';
  if (x > r.x + DETAIL_EXIT_HIT.x0 && x < r.x + DETAIL_EXIT_HIT.x1) return 'exit';
  return null;
}

/** 卡片／道具选物窗第 `i` 格的名字落点 @source `loc_00426d05`（卡片）/ `loc_0042688b`（道具）*/
export function pickGridCellAt(i: number): { x: number; y: number } {
  const g = PICK_GRID;
  return {
    x: g.cellX0 + g.cw * (i % g.cols),
    y: g.cellY0 + g.ch * Math.floor(i / g.cols),
  };
}

/**
 * 点在卡片／道具选物窗的第几格上。
 * @source VA 0x00426d82 / 0x00426974：`格 = ((y−0xc0)/0x20) × 5 + (x−0x8c)/0x48`
 */
export function hitPickGrid(x: number, y: number, count: number): number | null {
  const g = PICK_GRID;
  if (x <= g.hitX0 || x >= g.hitX1) return null;
  if (y <= g.hitY0 || y >= g.hitY1) return null;
  const col = Math.floor((x - g.hitX0) / g.cw);
  const row = Math.floor((y - g.hitY0) / g.ch);
  const i = row * g.cols + col;
  if (i < 0 || i >= count) return null;
  return i;
}

/** 点在卡片／道具选物窗的 ✕ 上 @source VA 0x00426e87 / 0x00426a63 */
export function hitPickGridExit(x: number, y: number): boolean {
  const g = PICK_GRID;
  return inOpen(x, y, { x0: g.exitX0, y0: g.exitY0, x1: g.exitX1, y1: g.exitY1 });
}

/** 点在股票选物窗的第几行上 @source VA 0x00425b19 */
export function hitPickStockRow(x: number, y: number, count: number): number | null {
  const p = PICK_STOCK;
  if (x <= p.at.x || x >= p.at.x + p.w) return null;
  if (y <= p.hitY0 || y >= p.hitY1) return null;
  const row = Math.floor((y - p.hitY0) / p.rowDy);
  if (row < 0 || row >= count) return null;
  return row;
}

/** 点在股票选物窗的 ✕ 上 @source VA 0x00425cfa */
export function hitPickStockExit(x: number, y: number): boolean {
  const p = PICK_STOCK;
  return inOpen(x, y, { x0: p.exitX0, y0: p.exitY0, x1: p.exitX1, y1: p.exitY1 });
}

/** 点在地產选物窗的第几行上 @source VA 0x004261cb */
export function hitPickEstateRow(x: number, y: number, count: number): number | null {
  const p = PICK_ESTATE;
  if (x <= p.at.x || x >= p.at.x + p.w) return null;
  if (y <= p.rowY0 || y >= p.hitY1) return null;
  const row = Math.floor((y - p.rowY0) / p.rowDy);
  if (row < 0 || row >= count) return null;
  return row;
}

/** 点在地產选物窗右上那条 ✕／滚动条竖带上：返回 'close' / 'up' / 'down' / null @source VA 0x0042643e */
export function hitPickEstateBar(x: number, y: number): 'close' | 'up' | 'down' | null {
  const p = PICK_ESTATE;
  if (x <= p.barX0 || x >= p.barX1) return null;
  if (y > p.closeY0 && y < p.closeY1) return 'close';
  if (y > 0x40 && y < 0x60) return 'up';
  if (y > 0x60 && y < 0x80) return 'down';
  return null;
}

/**
 * 点在 YES/NO 那块 96×48 的哪一半（`x < w/2` → YES，否则 NO）。
 *
 * @source `_rich4_ui_yesno`（VA 0x00453a32）的 `loc_00453745 :101-126`：
 *   命中**按图尺寸分半**，没有按钮矩形 —— 那张图本身就是控件。
 * @returns 'yes' / 'no'；点在图外返回 null
 */
export function hitYesNo(x: number, y: number): 'yes' | 'no' | null {
  const h = yesNoHalves();
  if (inRect(x, y, h.yes)) return 'yes';
  if (inRect(x, y, h.no)) return 'no';
  return null;
}

/** 确认框那一拍的判定：YES 才成交（原版返回 1 才调 `fcn_004255da`）*/
export function confirmChose(hit: 'yes' | 'no' | null): boolean {
  return hit === 'yes';
}

/** 点在地產选物窗的分类页签上；返回页号 0..4 @source VA 0x00426387 */
export function hitPickEstateTab(x: number, y: number): number | null {
  const p = PICK_ESTATE;
  if (x <= p.at.x || x >= p.at.x + p.w) return null;
  if (y <= p.tabY0 || y >= p.tabY1) return null;
  const tab = Math.floor((x - p.at.x) / p.tabW);
  return tab >= 0 && tab < PICK_TABS.length ? tab : null;
}

// ============================================================
//  取数（纯函数）
// ============================================================

/**
 * 挂牌价**上限** = 市價 × 10 —— 这是**填数窗的参数**，不是规则，
 * 所以留在本模块（core 的 `*ListPrice` 只管市價本身）。
 *
 * @source VA 0x00426b0f / 0x00426f52 / 0x0042660c 的 `shl 2 / add / add`（= ×10）。
 */
export const LIST_PRICE_MAX_FACTOR = 10;

/** 挂牌栏几格 —— 用 core 的 `BOARD_SLOTS`，这里只做一次自检（见测试）*/
export { BOARD_SLOTS };

/** 住宅地块的「開發狀況」等级名 @source 串表 `0x475138`（7 项）*/
export const LAND_LEVEL_NAMES = [
  '空  地',
  '平  房',
  '店  舖',
  '商  場',
  '商業大樓',
  '摩天大樓',
  '公  園',
] as const;
/** 設施的种类名 @source 串表 `0x475150` 的前 5 项 */
export const FACILITY_TYPE_NAMES = ['公  園', '旅  館', '購物中心', '加油站', '研究所'] as const;
/** 設施的等級名 @source 串表 `0x475164`（6 项）*/
export const FACILITY_LEVEL_NAMES = ['０級', '一級', '二級', '三級', '四級', '五級'] as const;
/** 详情框里几个固定字 @source 串 0x463ee5 / 0x463eee / 0x463e30 */
export const LAND_TYPE_LABEL = '住宅用地';
export const FACILITY_PLAIN_LABEL = '商業用地';
export const CHAIN_STORE_LABEL = '連鎖店';

/** 挂牌类型名（详情框「類型」那一行对卡片/道具用的就是物品名，地產用下面两个）*/
export function cardName(id: number): string {
  return CARDS.find((c) => c.id === id)?.name ?? `卡片${id}`;
}

export function toolName(id: number): string {
  return TOOLS.find((t) => t.id === id)?.name ?? `道具${id}`;
}

/** 股票名 —— core 的状态不带名字，在 `@rich4/data` 的表里（与 main.ts 的 `stockNames()` 同源）*/
export function stockName(state: GameState, index: number): string {
  return stocksOfMap(state.globalMapId)[index]?.name ?? `股票${index}`;
}

/** 挂牌栏里的一项 —— 版面需要的全部信息（`boardView` 的产物）*/
export interface BoardListingRow {
  slot: number;
  seller: number;
  kind: number;
  /** 挂牌里存的编号 */
  id: number;
  price: number;
  amount: number;
}

export interface BoardPlayerView {
  index: number;
  /** 角色名（原版画在头像右边/详情框里）*/
  name: string;
  character: number;
  /** 挂牌格用哪张图（男 13–16 / 女 9–12）*/
  isMale: boolean;
  /** 定长 7，空槽是 `null` */
  slots: readonly (BoardListingRow | null)[];
  /** 挂牌栏满了吗（原版看最后一格）@source VA 0x00427ee6 */
  full: boolean;
}

export interface BoardView {
  /** 当前玩家（自己的列可挂可撤）*/
  me: number;
  players: readonly BoardPlayerView[];
}

/** 把 `state.noticeBoard` 摆成版面要的样子 —— 不做任何规则判断 */
export function boardView(state: GameState): BoardView {
  const players: BoardPlayerView[] = state.players.map((p, i) => {
    const col = state.noticeBoard[i] ?? [];
    const slots: (BoardListingRow | null)[] = [];
    for (let s = 0; s < Math.max(BOARD_COLS, col.length); s++) {
      const it = col[s] ?? null;
      slots.push(it === null ? null : { slot: s, seller: i, kind: it.kind, id: it.id, price: it.price, amount: it.amount });
    }
    return {
      index: i,
      name: CHARACTERS[p.character]?.name ?? `玩家${i + 1}`,
      character: p.character,
      isMale: p.isMale,
      slots,
      full: (col[BOARD_COLS - 1] ?? null) !== null,
    };
  });
  return { me: state.currentPlayer, players };
}

/** 某个挂牌项的市價（详情框「市價」那一行）*/
export function marketPriceOf(
  state: GameState,
  topo: MapTopology,
  kind: number,
  id: number,
  amount: number,
): number {
  const priceIndex = state.priceIndex;
  if (kind === LISTING.stock) {
    return stockListPrice(amount, state.market.stocks[id]?.price ?? 0);
  }
  if (kind === LISTING.tool) {
    return toolListPrice(id, priceIndex);
  }
  if (kind === LISTING.card) {
    return cardListPrice(id, priceIndex);
  }
  if (kind === LISTING.estate) {
    const e = decodeEstate(id);
    if (e.kind === 'land') {
      const l = topo.lands?.find((x) => x.id === e.index);
      if (l === undefined) return 0;
      const level = state.landLevel[e.index] ?? l.level;
      return estateListPrice(l.landPrice, level, l.housePrice ?? 0, priceIndex);
    }
    const f = topo.facilities?.find((x) => x.id === e.index);
    if (f === undefined) return 0;
    const level = state.facilityLevel[e.index] ?? f.level;
    return estateListPrice(f.landPrice, level, f.housePrice, priceIndex);
  }
  return 0;
}

/** 详情框里要写的那几行字 */
export interface BoardDetailText {
  title: string;
  values: readonly string[];
}

/**
 * 详情框的字 —— 逐条照四个分支的 `draw_text` 调用。
 *
 * ⚠️ 地產／設施那两支有两处原版自己的怪处，这里**照抄不改**：
 *   ① 設施「類型」：`level == 0` 时写死「商業用地」，否则才按 `type` 查名
 *      （VA 0x00427550 的 `cmp byte [ebx+0x1a], 0`）；
 *   ② 設施「等級」：查的是 `[0x475164 + level*4]`（０級…五級）。
 */
export function detailText(
  state: GameState,
  topo: MapTopology,
  item: Listing,
): BoardDetailText {
  const priceIndex = state.priceIndex;
  const listing = `$${item.price.toLocaleString('en-US')}元`;
  const market = `$${marketPriceOf(state, topo, item.kind, item.id, item.amount).toLocaleString('en-US')}元`;

  if (item.kind === LISTING.stock) {
    return {
      title: stockName(state, item.id),
      values: [stockName(state, item.id), `${item.amount}張`, market, listing],
    };
  }
  if (item.kind === LISTING.tool) {
    return { title: toolName(item.id), values: [toolName(item.id), market, listing] };
  }
  if (item.kind === LISTING.card) {
    return { title: cardName(item.id), values: [cardName(item.id), market, listing] };
  }
  if (item.kind === LISTING.estate) {
    const e = decodeEstate(item.id);
    if (e.kind === 'land') {
      const l = topo.lands?.find((x) => x.id === e.index);
      const level = state.landLevel[e.index] ?? l?.level ?? 0;
      const chain = (state.landType[e.index] ?? l?.type ?? 0) !== 0;
      const dev = chain ? CHAIN_STORE_LABEL : (LAND_LEVEL_NAMES[level] ?? '');
      return {
        title: l?.name ?? `土地${e.index}`,
        values: [LAND_TYPE_LABEL, l?.name ?? '', dev, market, listing],
      };
    }
    const f = topo.facilities?.find((x) => x.id === e.index);
    const level = state.facilityLevel[e.index] ?? f?.level ?? 0;
    const type = state.facilityType[e.index] ?? f?.type ?? 0;
    const typeName = level === 0 ? FACILITY_PLAIN_LABEL : (FACILITY_TYPE_NAMES[type] ?? '');
    return {
      title: f?.name ?? `設施${e.index}`,
      values: [typeName, f?.name ?? '', FACILITY_LEVEL_NAMES[level] ?? '', market, listing],
    };
  }
  void priceIndex;
  return { title: '', values: [] };
}

// ============================================================
//  选物窗的候选清单
// ============================================================

/** 选物窗里的一格 */
export interface BoardPickItem {
  /** 挂牌 action 里的 `id` */
  id: number;
  /** 主字（卡名／道具名／股票名／地名）*/
  name: string;
  /** 副字（道具的持有数／股票的張數／地產的開發狀況），右对齐那一列 */
  extra: string;
  /** 股票用：可挂的股數（= 持有股數）；其余为 0 */
  amount: number;
  /** 地產选物窗的分类页号（0 = 全部，1 住宅區，2 商業區，3 房屋，4 連鎖店）*/
  tab: number;
}

/** 一件道具的「開發狀況」那一列的字 @source VA 0x00426c 附近的名字表 */
/**
 * 地產清单五个页签的**筛选** —— 逐条照 `fcn_00423b3b`（VA 0x00423b3b）译。
 *
 * @source `fcn_00423b3b(玩家, 分类)` 的跳表 `0x423b27`（5 支）：
 *
 * | 分类 | 页签名（表 `0x4753d4`）| 收什么 | 判据 |
 * |---|---|---|---|
 * | 0 | 全  部 | **地块 + 設施** | 只看 owner == 玩家 + 1 |
 * | 1 | 住宅區 | **只地块** | 同上，**不再筛等级/类型**（0x423bd1）|
 * | 2 | 商業區 | **只設施** | 同上（0x423c0a）|
 * | 3 | 房  屋 | 只地块 | owner 且 `+0x1a`(等级) **!= 0** 且 `+0x18`(类型) **== 0**（0x423c48）|
 * | 4 | 連鎖店 | 只地块 | owner 且 `+0x1a` **!= 0** 且 `+0x18` **!= 0**（0x423c90）|
 *
 * ★ 先前本模块给每件东西只记**一个** `tab`（连锁 → 4、等级 0 → 1、其余 → 3），
 *   于是页签 1 少了「已建的住宅与连锁店」、页签 4 把**等级 0 的连锁店空地**也列了进来
 *   —— 两头都与原版不符（原版的五个分类是**筛选**，同一件东西会出现在多个页签里）。
 *   ⇒ 改成按 id + 状态逐件判。见 D-BOARD-3。
 */
export function estateTabMatches(
  state: GameState,
  itemId: number,
  tab: number,
): boolean {
  const isFacility = itemId >= ESTATE_FACILITY_BASE;
  switch (tab) {
    case 0:
      return true;
    case 1:
      return !isFacility;
    case 2:
      return isFacility;
    case 3:
    case 4: {
      if (isFacility) return false;
      const id = itemId - ESTATE_LAND_BASE;
      const level = state.landLevel[id] ?? 0;
      if (level === 0) return false;
      const chain = (state.landType[id] ?? 0) !== 0;
      return tab === 3 ? !chain : chain;
    }
    default:
      return false;
  }
}

/**
 * 当前玩家**能挂上去**的东西，按选物窗的显示顺序排。
 *
 * @source 四条路各自的原版遍历：
 *   股票 0x004259e4（`player_stocks[p][i] != 0` 才画，逐支）／
 *   道具 0x0042688b（`player_tool_amount[i] != 0`，编号 1..12）／
 *   卡片 0x00426d05（手牌槽 0..14 非空的）／
 *   地產 0x00423b3b 的分类（先地块后設施）。
 */
export function boardPickItems(
  state: GameState,
  topo: MapTopology,
  kind: number,
): readonly BoardPickItem[] {
  const me = state.currentPlayer;
  const out: BoardPickItem[] = [];
  if (kind === LISTING.stock) {
    const held = state.holdings[me] ?? [];
    for (let i = 0; i < held.length; i++) {
      const amount = held[i]?.amount ?? 0;
      if (amount <= 0) continue;
      out.push({
        id: i,
        name: stockName(state, i),
        extra: `${amount}張`,
        amount,
        tab: 0,
      });
    }
    return out;
  }
  if (kind === LISTING.tool) {
    for (const t of TOOLS) {
      const n = toolCount(state.tools, me, t.id);
      if (n <= 0) continue;
      out.push({ id: t.id, name: t.name, extra: `×${n}`, amount: 0, tab: 0 });
    }
    return out;
  }
  if (kind === LISTING.card) {
    const cards = state.players[me]?.cards ?? [];
    for (const id of cards) {
      out.push({ id, name: cardName(id), extra: '', amount: 0, tab: 0 });
    }
    return out;
  }
  if (kind === LISTING.estate) {
    const mine = me + 1;
    for (const l of topo.lands ?? []) {
      const owner = state.landOwner[l.id] ?? l.owner;
      if (owner !== mine) continue;
      const level = state.landLevel[l.id] ?? l.level;
      const chain = (state.landType[l.id] ?? l.type) !== 0;
      out.push({
        id: ESTATE_LAND_BASE + l.id,
        name: l.name,
        extra: chain ? CHAIN_STORE_LABEL : (LAND_LEVEL_NAMES[level] ?? ''),
        amount: 0,
        // ⚠️ 这一栏对地產**不再参与筛选**（原版的五个分类是筛选，一件东西能出现在多个
        //   页签里）—— 筛选走 `estateTabMatches`。留着只为与别的清单同形。
        tab: 1,
      });
    }
    for (const f of topo.facilities ?? []) {
      const owner = state.facilityOwner[f.id] ?? f.owner;
      if (owner !== mine) continue;
      const level = state.facilityLevel[f.id] ?? f.level;
      const type = state.facilityType[f.id] ?? f.type;
      out.push({
        id: ESTATE_FACILITY_BASE + f.id,
        name: f.name,
        // 清單里這一列是**种类名**，`level == 0` 时写死「商業用地」
        // @source VA 0x00424e06 的 `cmp byte [ebx+0x1a], 0 / je`
        extra: level === 0 ? FACILITY_PLAIN_LABEL : (FACILITY_TYPE_NAMES[type] ?? ''),
        amount: 0,
        tab: 2,
      });
    }
    return out;
  }
  return out;
}

/**
 * 地產选物窗当前页签下显示哪几行，以及**每一行对应候选清单里的第几件**。
 *
 * ★ 页签的筛选与显示顺序都是原版 `fcn_00423b3b` 定的（入口把结果缓存进
 *   `[0x48c2b4]` 与 `0x48be6e` 那张 u16 表）；这里按 `tab` 字段自己筛，
 *   顺序沿用 `boardPickItems` 的（先地块后設施）。见 `D-BOARD-3`。
 */
function pickEstateView(env: UiScreenEnv): {
  items: readonly BoardPickItem[];
  full: readonly number[];
  /** 这份清单总共多少件（未滚动前）—— 滚动条的夹取要用 */
  total: number;
} {
  const all = boardPickItems(env.state, env.topo, LISTING.estate);
  const items: BoardPickItem[] = [];
  const full: number[] = [];
  all.forEach((it, i) => {
    if (!estateTabMatches(env.state, it.id, ui.pickTab)) return;
    items.push(it);
    full.push(i);
  });
  // ★ 滚动：原版那扇窗一次只显示一屏（`PICK_ESTATE_VISIBLE_ROWS` 行），
  //   滚动条按件数滚（`fcn_00424aea(list, 2/1)` 的 2/1 = 上/下一页）。
  const top = clampPickTop(ui.pickTop, items.length);
  return { items: items.slice(top, top + PICK_ESTATE_VISIBLE_ROWS), full, total: items.length };
}

/**
 * 地產选物窗一屏显示几行 —— **原版是写死的 `0xb` = 11 行**。
 *
 * @source VA 0x00424ba0 `mov dword [0x4754be], 0xb`（`loc_00424ba0`）；
 *   同一函数里 `loc_00424b51` 的 `add eax, 0xb` / `loc_00424b67` 的
 *   `lea eax, [ebx - 0xb]` 就是**上/下滚一页 = 11 行**，
 *   行循环 `loc_00424c64` 的 `cmp edi, [0x4754be] / jge` 也按这个数走
 *   （行不满一屏时 `[0x4754be] = 总件数 − 顶部行号`）。
 *
 * ⚠️ 先前这里按几何算（`(h − rowY0) / rowDy` = 10）—— 那是把表头那段也
 *   当成一行了。原版第一行中心 y = 0x70、最后一行 0x70 + 10×0x20 = 0x1b0，
 *   窗底 0x1c0，**11 行正好压满**。
 *   2026-09-17 按 exe 常量改回 11（滚动步长同源，一改两处都对齐）。
 */
export const PICK_ESTATE_VISIBLE_ROWS = 0xb;

/** 把滚动位置夹进 `[0, max(0, 件数 − 一屏行数)]` */
export function clampPickTop(top: number, total: number): number {
  const max = Math.max(0, total - PICK_ESTATE_VISIBLE_ROWS);
  if (!Number.isFinite(top)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(top)));
}

/**
 * 滚动条点一下：上/下滚一屏（原版 `fcn_00424aea(…, 2/1)`）。
 * @returns 新的滚动位置
 */
export function pickTopAfterBar(top: number, total: number, dir: 'up' | 'down'): number {
  const step = PICK_ESTATE_VISIBLE_ROWS;
  return clampPickTop(dir === 'up' ? top - step : top + step, total);
}

// ============================================================
//  action 构造（纯函数）—— 三路操作的唯一出口
// ============================================================

/** 撤件 @source `fcn_004247d5(player, slot)` VA 0x00427b0f */
export function withdrawAction(seller: number, slot: number): Action {
  void seller; // 原版只传了当前玩家；槽位在 action 里就够 reducer 定位
  return { type: 'noticeBoard', op: 'withdraw', slot };
}

/** 买下别人的一件 @source VA 0x00427b19 里的 `call fcn_004255da(賣家, 槽)` */
export function buyAction(seller: number, slot: number): Action {
  return { type: 'noticeBoard', op: 'buy', seller, slot };
}

/**
 * 挂牌。
 *
 * @param kind  1 股票 / 2 地產 / 3 道具 / 4 卡片
 * @param id    挂牌编号（地產是 `base + 下标`）
 * @param input 填数窗里玩家输的那个数：股票是**股數**，其余是**標價**
 * @source `fcn_004246c5(player, kind, id, price, amount)`：
 *   股票 `0x0042605e` 传 `(1, 股票下标, round(股數×現價), 股數)`；
 *   地產／道具／卡片传 `(kind, id, 输入值, 0)`（0x0042663a / 0x00426b5c / 0x00426f84）。
 */
export function listAction(kind: number, id: number, input: number, marketPrice: number): Action {
  if (kind === LISTING.stock) {
    return {
      type: 'noticeBoard',
      op: 'list',
      kind,
      id,
      price: stockListPrice(input, marketPrice),
      amount: input,
    };
  }
  return { type: 'noticeBoard', op: 'list', kind, id, price: input };
}

/** 该类型填数窗的上限 @source 上表（股票 = 持有股數，其余 = 市價 × 10）*/
export function listInputMax(kind: number, amount: number, marketPrice: number): number {
  return kind === LISTING.stock ? amount : marketPrice * LIST_PRICE_MAX_FACTOR;
}

/** 填数窗里那一栏的名字 @source 串 0x463ebb（價格）/ 0x463ea0（張數）*/
export function listInputLabel(kind: number): string {
  return kind === LISTING.stock ? '賣出張數' : '賣出價格';
}

// ============================================================
//  本屏的开关与子状态 —— `active` 只读它，别的地方别碰
// ============================================================

/** 子页面：主屏 → 类型选单 → 选物 → 填数；或主屏 → 详情框 */
export type BoardMode = 'board' | 'type' | 'pick' | 'detail' | 'price';

interface BoardUiState {
  open: boolean;
  /** 打开时是哪位玩家 —— 换人就自动收屏（原版这屏是「这个回合」内的模态窗）*/
  forPlayer: number;
  mode: BoardMode;
  /** `type`：悬停在弹出选单的第几格 */
  typeHot: number | null;
  /** `pick`：正在选哪一类 */
  pickKind: number;
  /** `pick`：地產页签 */
  pickTab: number;
  /**
   * `pick`：地產清单**滚到第几件**（滚动条）。
   *
   * ★ 2026-09-16 补（外部审查 B-6(ii)）：`hitPickEstateBar` 早就返回
   *   `'up' | 'down'` 了，但调用点只判 `'close'` —— 返回被丢掉，滚动条**画了不响**。
   *   原版确实滚：`rich4_ui_sale.asm:2785-2826`（`loc_0042643e` →
   *   `[0x48c2ba] = 1/2/3`）与 `:2841-2875`（`loc_00426515` 抬手 →
   *   `fcn_00424aea([0x48c2bb], 2/1)`），窗本体复用 `fcn_00424aea`
   *   （= 個人資產表那张 5 列清单，`loc_0042643e` 那一支）。
   */
  pickTop: number;
  /**
   * `pick`：**悬停**高亮的是第几件（候选清单里的下标）。
   *
   * ★ 四扇选物窗里**只有股票与地產**有悬停高亮（原版 `0x200`，VA 0x00425b19 /
   *   0x004261cb）；卡片／道具那两扇要等 `0x201`（VA 0x00426d82 / 0x00426974），
   *   而网页上拿不到那一拍（见「交互」一节），所以那两扇窗没有高亮 ——
   *   行为上等同于点下去立刻生效。
   */
  pickHot: number | null;
  /**
   * 按下态 —— **原版 `[0x48c2ca]` 那个「按在哪」的字节**（VA 0x00427f12 起）。
   *
   * `down` 记账并画压下高亮，`up` 只认它、不看抬手的坐标。
   */
  press: BoardPress | null;
  /** `detail`：看的是谁的第几格 */
  detail: { seller: number; slot: number } | null;
  /**
   * `detail`：买卖别人的挂牌前那一次 **YES/NO 确认**。
   *
   * ★ 2026-09-16 补（外部审查 B-6(iii)）：原版 `loc_00427b19` 先
   *   `call _rich4_ui_yesno`（VA 0x453a32）**居中 (320,240)**，只有返回 1（YES）
   *   才 `fcn_004255da(seller, slot)` 成交。本模块先前**直接成交** ——
   *   等于把一次确认吞了。
   *   `hover` 记鼠标压在 YES 还是 NO 上（原版 0x200 换图，VA 0x00453745 那条）。
   */
  confirm: { seller: number; slot: number; hover: 'yes' | 'no' | null } | null;
  /** `price`：哪一件、可挂多少、市價 */
  amount: { kind: number; id: number; amount: number; market: number } | null;
  amountPage: AmountPage | null;
  /** 訊息框（「公佈欄已滿…」）*/
  message: string | null;
  messageUntil: number;
}

function freshState(): BoardUiState {
  return {
    open: false,
    forPlayer: -1,
    mode: 'board',
    typeHot: null,
    pickKind: 0,
    pickTab: 0,
    pickTop: 0,
    pickHot: null,
    press: null,
    detail: null,
    confirm: null,
    amount: null,
    amountPage: null,
    message: null,
    messageUntil: 0,
  };
}

let ui: BoardUiState = freshState();

/** 测试用：把本屏的子状态清干净 */
export function resetBoardScreen(): void {
  ui = freshState();
}

/** 测试用：现在开着吗 / 在哪一页 */
export function boardScreenState(): Readonly<BoardUiState> {
  return ui;
}

// ============================================================
//  画
// ============================================================

/**
 * 压下高亮的浓度。
 *
 * 原版是 `fcn_004552e7(…, −0xc)`：把颜色换成**那张 32 级淡出表**（`0x485d68`）
 * 往回 12 张的那一档 —— 一张 256 色 × 2 字节 = 512 字节，所以 `−0xc` 是
 * 12 级 / 32 = **压暗 37.5%**（商店屏的 `−16` 正是「减半」，与此互证）。
 *
 * @source VA 0x00427e0d / 0x00427f9e / 0x004280ee（挂牌格与 SALE／EXIT）、
 *   0x00427ac4（详情框两颗钮）、0x00426e72 / 0x00426a4e（卡片／道具选物窗的格子）。
 */
export const PRESS_ALPHA = 12 / 32;

/** 原版字号 @source VA 0x0042850e `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)` */
const FONT_SIZE = 0x10;
/** 详情框那两颗钮的字色（白字深红底）@source VA 0x0042796c `create_font(0x10, 0xffffff, 0x800000, 3, 1)` */
const BUTTON_FILL = '#ffffff';
const BUTTON_STROKE = '#800000';

/** `draw_text` 的 flag：0 左上、2 正中、6 右中 @source 跳表 `0x44faa0` */
type TextFlag = 0 | 2 | 6;

function origText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  flag: TextFlag,
  fill = '#f0f0f0',
  stroke = '#101010',
): void {
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  if (flag === 0) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  } else if (flag === 2) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  } else {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
  }
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

/** 画一块压下高亮（原版那一圈压暗的近似）*/
function shade(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = `rgba(0,0,0,${PRESS_ALPHA})`;
  ctx.fillRect(x, y, w, h);
}

/** 锚点落点绘制 —— 与 `fcn_004562a5` / `fcn_00456418` 的 `x -= src->x` 同义 */
function blit(
  ctx: CanvasRenderingContext2D,
  s: Sprite | null,
  x: number,
  y: number,
): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 要**抠掉纯黑**的图 —— 本屏唯一一处抠黑判定。
 *
 * ★ 原版逐图在两个 blit 之间选：`fcn_004563f5`（**不透明**）与
 *   `fcn_00456418` / `fcn_004562a5`（**带透明**，即抠黑）。逐张核过：
 *
 * | 图 | 原版走哪个 | 抠黑 | @source |
 * |---|---|---|---|
 * | 73 图 0 底图 | `fcn_004563f5` | **✗** | VA 0x004249f3 |
 * | 73 图 1 / 2 选物窗底板 | `fcn_004563f5` | ✗ | VA 0x004259b6 / 0x00424bd4 |
 * | 73 图 **3 / 4** 选物窗底板 | `fcn_00456418` | **✓** | VA 0x00426840 / 0x00426cd1 |
 * | 73 图 5 訊息框 | `fcn_004563f5` | ✗ | VA 0x00424593 |
 * | 73 图 6 / 7 / 8 详情框 | `fcn_004563f5` | ✗ | VA 0x0042717f |
 * | 73 图 9–16 挂牌格 | `fcn_004563f5` | ✗ | VA 0x00424a70 |
 * | 73 图 17 SALE 弹单 | `fcn_004563f5` | ✗ | VA 0x00427f94 |
 * | 73 图 18 ✕ | `fcn_004563f5` | ✗ | VA 0x00425d9b |
 * | 73 图 19 页签 | `fcn_004563f5` | ✗ | VA 0x00424bf7 |
 * | `map.mkf` 图 `0x1b+角色` 头像 | `fcn_004562a5` | **✓** | VA 0x00428817 |
 * | 74 图 `道具号−1` 道具图标 | `fcn_00456418` | **✓** | VA 0x004268d8 |
 *
 * ⚠️ **绝不能整屏统一抠**：`Panel.mkf` 是 SMP（黑不透明），而黑既可能是背景
 *   也可能是图案 —— 底图 0 的 440 颗纯黑像素里就有 SALE／EXIT 两颗钮内部的
 *   深色底（图 0 内部纯黑只占 0.2%，全在钮框里），一抠就是一个洞。
 *   这也正是 `shop-screen.ts` 的 `SHOP_KEYED` 那条教训。
 */
export function boardKeyed(archive: string, resource: number, index: number): boolean {
  if (archive === 'Panel.mkf') {
    if (resource === BOARD_TOOL_RESOURCE) return true; // 74：道具图标
    if (resource === BOARD_RESOURCE) return index === 3 || index === 4; // 73：两张选物窗底板
  }
  // 头像：`map.mkf` 27..38（`0x1b + 角色号`）
  if (archive === 'map.mkf' && resource >= PORTRAIT_RESOURCE_FIRST) return true;
  return false;
}

/** 按上面那张表取图 —— 别在各处手写 `colorKeyBlack` */
function boardSprite(env: UiScreenEnv, archive: string, resource: number, index: number): Sprite | null {
  return env.sprite(archive, resource, index, boardKeyed(archive, resource, index));
}

/** 图号 → 本屏底图（`Panel.mkf` #73）*/
function art(env: UiScreenEnv, index: number): Sprite | null {
  return boardSprite(env, 'Panel.mkf', BOARD_RESOURCE, index);
}

/** 底图 + 四位玩家的头像 + 已挂的格子 @source `fcn_004249c2` */
function drawBoard(ctx: CanvasRenderingContext2D, env: UiScreenEnv, view: BoardView): void {
  blit(ctx, art(env, BOARD_PANEL_CHUNK), BOARD_PANEL_AT.x, BOARD_PANEL_AT.y);

  const n = view.players.length;
  for (let p = 0; p < n; p++) {
    const row = view.players[p];
    if (row === undefined) continue;
    // 头像：`map.mkf` 图 `0x1b + character` 的第 0 张，走带透明的 blit。
    // ★ 原版把头像贴在**底图**上（图内坐标），所以这里要加图 0 的落点。
    const portrait = boardPortraitAt(p);
    blit(
      ctx,
      boardSprite(env, 'map.mkf', portraitResource(row.character), 0),
      portrait.x,
      portrait.y,
    );
    for (let s = 0; s < BOARD_COLS; s++) {
      const item = row.slots[s] ?? null;
      if (item === null) continue;
      const r = boardSlotRect(p, s);
      blit(ctx, art(env, slotChunk(row.isMale, item.kind)), r.x, r.y);
    }
  }

  // ── 按下高亮：挂牌格 / SALE / EXIT ──
  // @source VA 0x00427e0d（格）0x00427f9e（SALE）0x004280ee（EXIT）
  const press = ui.press;
  if (press !== null && press.area === 'slot') {
    const r = boardSlotRect(press.player, press.slot);
    shade(ctx, r.x, r.y, r.w, r.h);
  } else if (press !== null && press.area === 'sale') {
    shade(
      ctx,
      BOARD_SALE_HIT.x0,
      BOARD_SALE_HIT.y0,
      BOARD_SALE_HIT.x1 - BOARD_SALE_HIT.x0,
      BOARD_SALE_HIT.y1 - BOARD_SALE_HIT.y0,
    );
  } else if (press !== null && press.area === 'exit') {
    shade(
      ctx,
      BOARD_EXIT_HIT.x0,
      BOARD_EXIT_HIT.y0,
      BOARD_EXIT_HIT.x1 - BOARD_EXIT_HIT.x0,
      BOARD_EXIT_HIT.y1 - BOARD_EXIT_HIT.y0,
    );
  }
}

/** SALE 弹出的四格选单 @source VA 0x00427f12 / 0x00427cfd */
function drawSalePopup(ctx: CanvasRenderingContext2D, env: UiScreenEnv): void {
  blit(ctx, art(env, BOARD_POPUP_CHUNK), BOARD_POPUP_AT.x, BOARD_POPUP_AT.y);
  if (ui.typeHot === null) return;
  const r = salePopupRect(ui.typeHot);
  shade(ctx, r.x, r.y, r.w, r.h);
}

/** 訊息框 @source `fcn_00424502` */
function drawMessage(ctx: CanvasRenderingContext2D, env: UiScreenEnv): void {
  if (ui.message === null) return;
  blit(ctx, art(env, BOARD_MSG_CHUNK), BOARD_MSG_AT.x, BOARD_MSG_AT.y);
  const lines = ui.message.split('\n');
  lines.forEach((line, i) => {
    if (line === '') return;
    origText(
      ctx,
      line,
      BOARD_MSG_TEXT.x,
      BOARD_MSG_AT.y + BOARD_MSG_TEXT.dy + i * (FONT_SIZE + 6),
      2,
    );
  });
}

/** 详情框 @source `fcn_0042704e` 的 WM_CREATE */
function drawDetail(
  ctx: CanvasRenderingContext2D,
  env: UiScreenEnv,
  view: BoardView,
  state: GameState,
  topo: MapTopology,
): void {
  const sel = ui.detail;
  if (sel === null) return;
  const row = view.players[sel.seller];
  const item = row?.slots[sel.slot] ?? null;
  if (row === undefined || item === null) return;
  const listing = state.noticeBoard[sel.seller]?.[sel.slot] ?? null;
  if (listing === null) return;

  const kind = item.kind;
  const r = boardDetailRect(kind);
  const detailChunk = DETAIL_CHUNK[kind] ?? 6;
  blit(ctx, art(env, detailChunk), r.x, r.y);
  // 右上那格商品图（就是挂牌格那张）
  blit(
    ctx,
    art(env, slotChunk(row.isMale, kind)),
    r.x + DETAIL_ICON_AT.dx,
    r.y + DETAIL_ICON_AT.dy,
  );
  // 玩家名
  origText(ctx, row.name, r.x + DETAIL_NAME_AT.dx, r.y + DETAIL_NAME_AT.dy, 2);

  // 标签（原版烤进图里，这里补画）
  const labels = DETAIL_LABELS[detailChunk] ?? [];
  const labelAt = DETAIL_LABEL_AT[detailChunk] ?? [];
  labels.forEach((text, i) => {
    const at = labelAt[i];
    if (at === undefined) return;
    origText(ctx, text, r.x + at.x, r.y + at.y, 2);
  });

  // 值
  const detail = detailText(state, topo, listing);
  const valueAt = DETAIL_VALUE_AT[kind] ?? [];
  detail.values.forEach((text, i) => {
    const at = valueAt[i];
    if (at === undefined || text === '') return;
    origText(ctx, text, r.x + at.x, r.y + at.y, at.align === 'right' ? 6 : 2);
  });

  // 两颗钮的字（原版运行时画上去）
  const btnY = r.y + (DETAIL_BTN_Y[kind] ?? 0xcb);
  const mine = sel.seller === state.currentPlayer;
  origText(
    ctx,
    mine ? DETAIL_ACTION_LABEL.withdraw : DETAIL_ACTION_LABEL.buy,
    r.x + 0x34,
    btnY,
    2,
    BUTTON_FILL,
    BUTTON_STROKE,
  );
  const exitLabel = 'EXIT';
  origText(ctx, exitLabel, r.x + 0x8c, btnY, 2, BUTTON_FILL, BUTTON_STROKE);

  // ── 按下那颗钮：压暗（原版 `0x201` 里 `fcn_00451b9e`，@source VA 0x00427ac4）──
  // ★ 详情框的窗口过程**不认 `0x200`**（只有 0xf/0x201/0x202/0x203/0x205/0x401），
  //   所以那两颗钮**没有悬停高亮**，只有按住的这一拍。
  const press = ui.press;
  if (press !== null && (press.area === 'detailAction' || press.area === 'detailExit')) {
    const band = press.area === 'detailAction' ? DETAIL_ACTION_HIT : DETAIL_EXIT_HIT;
    shade(ctx, r.x + band.x0, btnY - DETAIL_BTN_HALF, band.x1 - band.x0, DETAIL_BTN_HALF * 2);
  }
}

/**
 * 買别人挂牌前的 **YES/NO** 控件。
 *
 * @source `_rich4_ui_yesno`（VA 0x00453a32）—— 買地那一路 `fcn_00440ba8`
 *   （`rich4.asm:21587-21589`）与公佈欄那一路 `loc_00427b19` 用的是**同一个**控件，
 *   都居中在 **(0xdc, 0x140) = (220, 320)**。图 `Data.mkf` #0x1b8 的
 *   图 0 = 两边都暗、图 1 = YES 那半亮、图 2 = NO 那半亮。
 *   命中按图尺寸分半（`x < w/2` → YES），没有按钮矩形 —— 那张图就是控件
 *   （`loc_00453745 :101-126`）。
 */
function drawYesNo(
  ctx: CanvasRenderingContext2D,
  env: UiScreenEnv,
  hover: 'yes' | 'no' | null,
): void {
  const img = hover === 'yes' ? YESNO_IMAGE.yes : hover === 'no' ? YESNO_IMAGE.no : YESNO_IMAGE.none;
  const s = env.sprite('Data.mkf', YESNO_RESOURCE, img, false);
  const x0 = YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2;
  const y0 = YESNO_CENTER_SCREEN.y - YESNO_SIZE.h / 2;
  if (s !== null) ctx.drawImage(s.bitmap, x0, y0);
  // 图还没解好时至少给出可点的一半，别让玩家对着空屏
  else {
    const h = yesNoHalves();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(h.yes.x, h.yes.y, YESNO_SIZE.w, YESNO_SIZE.h);
  }
}

/** 选物窗（四类各一套）@source 四个 `fcn_0042xxxx` 的 WM_CREATE */
function drawPick(
  ctx: CanvasRenderingContext2D,
  env: UiScreenEnv,
  state: GameState,
  topo: MapTopology,
): void {
  if (ui.mode !== 'pick') return;
  const items = boardPickItems(state, topo, ui.pickKind);

  if (ui.pickKind === 1) {
    blit(ctx, art(env, PICK_STOCK.chunk), PICK_STOCK.at.x, PICK_STOCK.at.y);
    // 表头（原版画进图里，这里补画）
    origText(ctx, '股票名稱', PICK_STOCK.at.x + 0x30, PICK_STOCK.at.y + 0x10, 2);
    origText(ctx, '持有張數', PICK_STOCK.at.x + 0x90, PICK_STOCK.at.y + 0x10, 2);
    origText(ctx, '總 市 價', PICK_STOCK.at.x + 0xfa, PICK_STOCK.at.y + 0x10, 2);
    items.forEach((it, i) => {
      const y = PICK_STOCK.rowY0 + PICK_STOCK.rowDy * i;
      origText(ctx, it.name, PICK_STOCK.colName, y, 2);
      origText(ctx, `$${it.amount.toLocaleString('en-US')}`, PICK_STOCK.colAmount, y, 6);
      const value = stockListPrice(it.amount, state.market.stocks[it.id]?.price ?? 0);
      origText(ctx, `$${value.toLocaleString('en-US')}`, PICK_STOCK.colValue, y, 6);
    });
    // ✕ 常态在图 1 里已经烤好了；图 18 是**按下**时才盖上去的那一张
    // @source VA 0x00425d8e（`0x201` 那一支）。按下那一拍拿不到，故不画。
  } else if (ui.pickKind === 2) {
    blit(ctx, art(env, PICK_ESTATE.chunk), PICK_ESTATE.at.x, PICK_ESTATE.at.y);
    // 五个页签的名字（原版画进图 2 里，这里补画）
    // ★ 图 19 那张底板**只盖在当前那一页**上（VA 0x00424bc9：`0x70 + 80 × [0x48c2bb]`），
    //   不是五张都盖 —— 图 2 的页签条本身就烤在底板里。
    for (let t = 0; t < PICK_TABS.length; t++) {
      const tabX = PICK_ESTATE.at.x + PICK_ESTATE.tabW * t;
      if (t === ui.pickTab) blit(ctx, art(env, BOARD_TAB_CHUNK), tabX, PICK_ESTATE.at.y);
      origText(ctx, PICK_TABS[t] ?? '', PICK_ESTATE.at.x + 0x28 + PICK_ESTATE.tabW * t, PICK_ESTATE.at.y + 0x10, 2);
    }
    // 五个列头（原版画进图 2 里，这里补画）：x 就是表 `0x4754b0`，全部 flag 2
    const heads = ['地  點', '開發狀況', '價  格', '收  費', '租  期'];
    heads.forEach((h, i) => {
      const col = PICK_ESTATE_COL[i];
      if (col === undefined) return;
      origText(ctx, h, col.x, PICK_ESTATE.at.y + 0x30, 2);
    });
    const shown = pickEstateView(env).items;
    shown.forEach((it, i) => {
      const y = PICK_ESTATE.rowTextY0 + PICK_ESTATE.rowDy * i;
      const nameCol = PICK_ESTATE_COL[0];
      const devCol = PICK_ESTATE_COL[1];
      const priceCol = PICK_ESTATE_COL[2];
      origText(ctx, it.name, nameCol.x, y, 2);
      origText(ctx, it.extra, devCol.x, y, 2);
      // 價格 = `(地價 + 等級 × 房價) × 物價指數` —— 与详情框那一行同式
      if (priceCol !== undefined) {
        const price = marketPriceOf(env.state, env.topo, LISTING.estate, it.id, 0);
        origText(ctx, `$${price.toLocaleString('en-US')}`, priceCol.x, y, 6);
      }
      // ★ 2026-09-16 补上「收費」与「租期」两列（原先是留空，见 D-BOARD-3）
      const feeCol = PICK_ESTATE_COL[3];
      if (feeCol !== undefined) {
        origText(ctx, estateFeeLabel(env.state, env.topo, it.id), feeCol.x, y, 6);
      }
      const tenureCol = PICK_ESTATE_COL[4];
      if (tenureCol !== undefined) {
        origText(ctx, estateTenureLabel(env.state, it.id), tenureCol.x, y, 2);
      }
    });
  } else {
    const chunk = ui.pickKind === 3 ? 3 : 4;
    blit(ctx, art(env, chunk), PICK_GRID.at.x, PICK_GRID.at.y);
    items.forEach((it, i) => {
      const at = pickGridCellAt(i);
      if (ui.pickKind === 3) {
        // 道具图标 = Panel.mkf #74 的图 `编号 − 1`，锚点落点 (格 x − 0x10, 格 y)
        blit(
          ctx,
          boardSprite(env, 'Panel.mkf', BOARD_TOOL_RESOURCE, it.id - 1),
          at.x + PICK_GRID.toolIconDx,
          at.y,
        );
        origText(ctx, it.extra, at.x + PICK_GRID.toolCountDx, at.y, 6);
      } else {
        origText(ctx, it.name, at.x, at.y, 2);
      }
    });
  }

  // ── 高亮 ──
  // 股票／地產两扇窗是**悬停**高亮（原版 `0x200`）；
  // 卡片／道具那两扇原版要等**按下**（`0x201` → `fcn_00451b9e`，@source VA 0x00426e72），
  // 所以那两扇看的是 `ui.press`。
  const pressedCell =
    ui.press !== null && ui.press.area === 'pickItem' ? ui.press.index : null;
  if (ui.pickKind !== LISTING.stock && ui.pickKind !== LISTING.estate && pressedCell !== null) {
    const at = pickGridCellAt(pressedCell);
    shade(
      ctx,
      at.x - PICK_GRID.cw / 2,
      at.y - PICK_GRID.ch / 2,
      PICK_GRID.cw,
      PICK_GRID.ch,
    );
  }
  if (ui.pickHot !== null) {
    const it = items[ui.pickHot];
    if (it !== undefined) {
      if (ui.pickKind === LISTING.stock) {
        const y = PICK_STOCK.rowY0 + PICK_STOCK.rowDy * ui.pickHot;
        shade(ctx, PICK_STOCK.at.x, y - 0x10, PICK_STOCK.w, PICK_STOCK.rowDy);
      } else if (ui.pickKind === LISTING.estate) {
        const v = pickEstateView(env);
        const row = v.full.indexOf(ui.pickHot);
        if (row < 0) return;
        const y = PICK_ESTATE.rowTextY0 + PICK_ESTATE.rowDy * row;
        shade(ctx, PICK_ESTATE.at.x, y - 0x10, PICK_ESTATE.w, PICK_ESTATE.rowDy);
      } else {
        const at = pickGridCellAt(ui.pickHot);
        shade(ctx, at.x - PICK_GRID.cw / 2, at.y - PICK_GRID.ch / 2, PICK_GRID.cw, PICK_GRID.ch);
      }
    }
  }
}

/**
 * 填数页要用的「对话」形状 —— 与 main.ts 的 `stockAmountUi()` 同一手法。
 *
 * 导出是给单测核对**初值与上限**用的（原版的填数窗 `fcn_00453544` 只吃一个
 * 「上限」参数，初值是 0；本引擎沿用自己的 `AmountPage`，初值按 stub 的说法
 * 钉在「市價」上，股票那一类就是持有股數）。
 */
export function boardPriceUi(
  kind: number,
  id: number,
  amount: number,
  market: number,
): InteractionUi {
  const label = listInputLabel(kind);
  const max = listInputMax(kind, amount, market);
  const fill = (n: number): Action => listAction(kind, id, n, market);
  return {
    title: '公佈欄',
    detail: `${label}（市價：$${market.toLocaleString('en-US')}元）`,
    choices: [{ label, amount: { label, max, step: 1, fill }, action: fill(max) }],
  };
}

function priceUi(): InteractionUi | null {
  const a = ui.amount;
  if (a === null) return null;
  return boardPriceUi(a.kind, a.id, a.amount, a.market);
}

/** 填数页 —— 原版是另开一窗（`fcn_00453544`）；这里照股市那段整体平移画到舞台上 */
function drawPrice(ctx: CanvasRenderingContext2D, env: UiScreenEnv, hot: DialogHit | null): void {
  const dialog = priceUi();
  if (dialog === null || ui.amountPage === null) return;
  ctx.save();
  ctx.translate(LAYOUT.board.x, LAYOUT.board.y);
  drawDialog(ctx, env.sprite, dialog, ui.amountPage, hot);
  ctx.restore();
}// ============================================================
//  交互 —— `down` 记账、`up` 成立（原版 `0x201` / `0x202`）
// ============================================================
//
// ★ `main.ts` 的接线与契约、与原版一致：`canvas mousedown → down`、
//   `window mouseup → up`、`canvas click` 只吞掉不派（`click` 排在 `mouseup` 之后）。
//   所以这里就是原版那两步：
//     `down` = `WM_LBUTTONDOWN`(0x201) —— **只记账 + 画压下高亮**；
//     `up`   = `WM_LBUTTONUP`(0x202)   —— 才真正成立。
//   （早先 `main.ts` 把 `down` 挂在 `click` 上，`up` 会比 `down` 先到，
//     那时只能把成立挪进 `down`；中央 2026-09-15 已按正解修掉 `main.ts`。）

/** 按下时记下的「按在哪」—— 原版就是 `[0x48c2ca]` 那个字节 */
type BoardPress =
  | { area: 'sale' }
  | { area: 'exit' }
  | { area: 'slot'; player: number; slot: number }
  | { area: 'popup' }
  | { area: 'detailAction' }
  | { area: 'detailExit' }
  | { area: 'pickItem'; index: number }
  | { area: 'pickExit' };

/** 棋盘坐标 → 填数页坐标（`drawDialog` 排的是棋盘区坐标）*/
function toDialogSpace(x: number, y: number): { x: number; y: number } {
  return { x: x - LAYOUT.board.x, y: y - LAYOUT.board.y };
}

function hitPricePage(env: UiScreenEnv, x: number, y: number): DialogHit | 'inside' | null {
  const dialog = priceUi();
  if (dialog === null || ui.amountPage === null) return null;
  const p = toDialogSpace(x, y);
  return hitDialog(env.stage, dialog, ui.amountPage, p.x, p.y);
}

/**
 * 填数页上的点击 —— 与 main.ts 的 `onDialogHit` 同一套动作。
 *
 * 填数窗（`fcn_00453544`）的钮在**按下**就生效（与銀行/股市那两屏的
 * `hitDialog` 同一条路），所以这一步放在 `down` 里。
 */
function onPriceHit(env: UiScreenEnv, hit: DialogHit): void {
  const page = ui.amountPage;
  const dialog = priceUi();
  if (page === null || dialog === null) return;
  const amount = dialog.choices[page.choice]?.amount;
  if (amount === undefined) return;
  switch (hit.kind) {
    // ★ 原版键盘窗上按了第几号钮（B-6(i)）—— 与键盘那一路**同一个出口**
    case 'amountSlot': {
      const key = amountKeyOfSlotId(hit.id, amountSlotOfId, (n) => AMOUNT_KEY_BY_ID.get(n) ?? null);
      if (key === null) break;
      const step = amountKeyStep(page.value, amount.max, key);
      if (step.submit) {
        const n = page.value;
        env.dispatch(amount.fill(n));
        env.log(`▶ 公佈欄：${amount.label} ${n}`);
        closePrice();
        return;
      }
      ui.amountPage = { choice: page.choice, value: step.value };
      env.requestRender();
      return;
    }
    case 'amountStep':
      ui.amountPage = {
        ...page,
        value: Math.max(0, Math.min(amount.max, page.value + hit.delta)),
      };
      break;
    case 'amountMax':
      ui.amountPage = { ...page, value: amount.max };
      break;
    case 'amountCancel':
      closePrice();
      return;
    case 'amountOk': {
      const n = page.value;
      env.dispatch(amount.fill(n));
      env.log(`▶ 公佈欄：${amount.label} ${n}`);
      closePrice();
      return;
    }
    default:
      break;
  }
  env.requestRender();
}

/** 填数页收掉 → 回主屏（原版成交后也是把两扇窗一起关掉）*/
function closePrice(): void {
  ui.amountPage = null;
  ui.amount = null;
  ui.mode = 'board';
  ui.press = null;
  ui.detail = null;
  ui.typeHot = null;
  ui.pickHot = null;
}

/** 打开一类东西的选物窗 @source `PostMessage(hwnd, 0x40f + 格号)` VA 0x004281f6 */
function openPick(env: UiScreenEnv, i: number): void {
  const kind = BOARD_SALE_KINDS[i];
  if (kind === undefined) return;
  ui.pickKind = kind;
  ui.pickTab = 0;
  ui.pickHot = null;
  ui.press = null;
  ui.mode = 'pick';
  env.requestRender();
}

/** 选物窗里点了第 `i` 件 → 开填数窗 @source 例如 VA 0x00426b5c / 0x00426f84 */
function openPrice(env: UiScreenEnv, i: number): void {
  if (i < 0) return;
  const items = boardPickItems(env.state, env.topo, ui.pickKind);
  const it = items[i];
  if (it === undefined) return;
  const market = marketPriceOf(env.state, env.topo, ui.pickKind, it.id, it.amount);
  ui.amount = { kind: ui.pickKind, id: it.id, amount: it.amount, market };
  // ★ 出价默认值 = 市價（原 stub 的说法）；股数那一类就是持有股數
  ui.amountPage = { choice: 0, value: ui.pickKind === LISTING.stock ? it.amount : market };
  ui.press = null;
  ui.pickHot = null;
  ui.mode = 'price';
  env.requestRender();
}

function closeAll(env: UiScreenEnv): void {
  resetBoardScreen();
  env.requestRender();
}

function openDetail(env: UiScreenEnv, seller: number, slot: number): void {
  ui.detail = { seller, slot };
  ui.mode = 'detail';
  ui.press = null;
  ui.typeHot = null;
  ui.pickHot = null;
  env.requestRender();
}

/** 详情框里按了那颗钮 @source VA 0x00427ad9 */
function onDetailAction(env: UiScreenEnv): void {
  const sel = ui.detail;
  if (sel === null) return;
  const item = env.state.noticeBoard[sel.seller]?.[sel.slot] ?? null;
  if (item === null) {
    closeDetail(env);
    return;
  }
  if (sel.seller === env.state.currentPlayer) {
    env.dispatch(withdrawAction(sel.seller, sel.slot));
    env.log('▶ 公佈欄：撤件');
    closeDetail(env);
    return;
  }
  // ★ 别人挂的 → 原版先弹 YES/NO（`loc_00427b19` → `call _rich4_ui_yesno`），
  //   只有 YES 才成交。2026-09-16 补（外部审查 B-6(iii)）：先前直接 dispatch，
  //   等于把这一次确认吞了。判据仍由 core 把关（`buyAction` → `canBuyListing`）。
  ui.confirm = { seller: sel.seller, slot: sel.slot, hover: null };
  env.requestRender();
}

function closeDetail(env: UiScreenEnv): void {
  ui.detail = null;
  ui.press = null;
  ui.mode = 'board';
  env.requestRender();
}

/** 详情框现在看的是哪一类（槽空了就当 0，落到道具/卡片那一张图）*/
function detailKindOf(env: UiScreenEnv): number {
  const sel = ui.detail;
  if (sel === null) return 0;
  return env.state.noticeBoard[sel.seller]?.[sel.slot]?.kind ?? 0;
}

/** 按下这一拍 @source `WM_LBUTTONDOWN` VA 0x00427ea1（主屏）/ 0x00427a18（详情框）等 */
function onDown(env: UiScreenEnv, x: number, y: number): void {
  if (ui.mode === 'price') {
    const hit = hitPricePage(env, x, y);
    if (hit !== null && hit !== 'inside') onPriceHit(env, hit);
    else env.requestRender();
    return;
  }

  if (ui.confirm !== null) {
    // ★ YES/NO 确认是**模态**的：它开着的时候不认详情框那两颗钮
    //   @source `_rich4_ui_yesno`（VA 0x00453a32）命中按图尺寸分半
    //   （`loc_00453745 :101-126`：`x < w/2` → YES，否则 NO）。
    ui.confirm.hover = hitYesNo(x, y);
    env.requestRender();
    return;
  }

  if (ui.mode === 'detail') {
    // @source VA 0x00427a18：只看坐标，记下是第 1 颗还是第 2 颗，然后压暗那一颗
    const btn = hitBoardDetailButton(detailKindOf(env), x, y);
    if (btn !== null) {
      ui.press = { area: btn === 'action' ? 'detailAction' : 'detailExit' };
      env.requestRender();
    }
    return;
  }

  if (ui.mode === 'pick') {
    const items = boardPickItems(env.state, env.topo, ui.pickKind);
    if (ui.pickKind === LISTING.stock) {
      // 股票窗的 `0x201` 只认 ✕（行是 `0x200` 悬停选的）@source VA 0x00425cfa
      if (hitPickStockExit(x, y)) {
        ui.press = { area: 'pickExit' };
        env.requestRender();
      }
      return;
    }
    if (ui.pickKind === LISTING.estate) {
      // @source VA 0x00426387（页签）/ 0x0042643e（✕ 与滚动条）
      // ★ 2026-09-16 补（B-6(ii)）：这一个返回值以前只判 `'close'`，
      //   `'up' / 'down'` 被丢掉 —— 滚动条画了不响。现在真的滚。
      const bar = hitPickEstateBar(x, y);
      if (bar === 'close') {
        ui.press = { area: 'pickExit' };
        env.requestRender();
        return;
      }
      if (bar === 'up' || bar === 'down') {
        // 先问一次当前清单长度（`pickEstateView` 会顺便夹一次 `ui.pickTop`）
        const total = pickEstateView(env).total;
        ui.pickTop = pickTopAfterBar(ui.pickTop, total, bar);
        ui.pickHot = null;
        env.requestRender();
        return;
      }
      const tab = hitPickEstateTab(x, y);
      if (tab !== null) {
        ui.pickTab = tab;
        ui.pickHot = null;
        env.requestRender();
        return;
      }
      const v = pickEstateView(env);
      const row = hitPickEstateRow(x, y, v.items.length);
      if (row !== null) {
        ui.pickHot = v.full[row] ?? null;
        env.requestRender();
      }
      return;
    }
    // 卡片／道具：`0x201` 认 ✕ 与格子 @source VA 0x00426e87 / 0x00426a63 / 0x00426d82
    if (hitPickGridExit(x, y)) {
      ui.press = { area: 'pickExit' };
      env.requestRender();
      return;
    }
    const cell = hitPickGrid(x, y, items.length);
    if (cell !== null) {
      ui.press = { area: 'pickItem', index: cell };
      ui.pickHot = cell;
      env.requestRender();
    }
    return;
  }

  if (ui.mode === 'type') {
    // ★ 原版这里其实不看模式：`0x201` 的 SALE → EXIT → 挂牌格三路判定照样跑，
    //   于是按在选单盖住的那几格上会走到挂牌格那一支（`0x00427ea1`）。
    //   本模块让**选单优先吃掉点击**，否则底下的挂牌格一占位选单就点不动。
    //   见 `docs/deviations/T-033.md` 的 D-BOARD-7。
    const idx = hitSalePopup(x, y);
    if (idx !== null) {
      ui.typeHot = idx;
      ui.press = { area: 'popup' };
      env.requestRender();
      return;
    }
    // 点选单以外：把选单收起来再按底下那一层
    ui.mode = 'board';
    ui.typeHot = null;
  }

  if (ui.mode !== 'board') return;

  // 主屏判定顺序照原版：SALE → EXIT → 挂牌格，颠倒会点错
  if (hitBoardSale(x, y)) {
    const col = env.state.noticeBoard[env.state.currentPlayer] ?? [];
    if (isColumnFull(col)) {
      // 「公佈欄已滿\n\n請先撤件！」@source VA 0x00427eb1，睡 1.5 秒后自己收掉
      ui.message = BOARD_FULL_MSG;
      ui.messageUntil = env.now + BOARD_MSG_MS;
      env.requestRender();
      return;
    }
    // ★ 原版在**按下**这一刻就把选单贴上去了（VA 0x00427f12）
    ui.press = { area: 'sale' };
    ui.mode = 'type';
    ui.typeHot = null;
    env.requestRender();
    return;
  }
  if (hitBoardExit(x, y)) {
    ui.press = { area: 'exit' };
    env.requestRender();
    return;
  }
  const at = hitBoardSlot(x, y, env.state.players.length);
  // ★ 原版只认**非空**的格子：`cmp byte [槽], 0 / je → 什么都不做`（VA 0x004280c7）
  const item = at === null ? null : (env.state.noticeBoard[at.player]?.[at.slot] ?? null);
  if (at !== null && item !== null) {
    ui.press = { area: 'slot', player: at.player, slot: at.slot };
    env.requestRender();
  }
}

/** 抬手这一拍 —— 只认按下时记下的那一个 @source `WM_LBUTTONUP` VA 0x004281af */
function onUp(env: UiScreenEnv, at: { x: number; y: number } | null = null): void {
  const p = ui.press;
  ui.press = null;

  if (ui.mode === 'price') return; // 填数页在按下那一把就处理完了

  // ★ YES/NO 确认：抬手那一拍才判定（原版 `_rich4_ui_yesno` 的 `:205-257`
  //   就是「抬手返回 1/0」），YES 才真的下单
  if (ui.confirm !== null) {
    const c = ui.confirm;
    // 原版 `_rich4_ui_yesno` 用**抬手**的坐标分半（`:205-257`）；事件没给就按 NO 处理
    const hit = at === null ? null : hitYesNo(at.x, at.y);
    ui.confirm = null;
    if (confirmChose(hit)) {
      env.dispatch(buyAction(c.seller, c.slot));
      env.log('▶ 公佈欄：購買（已確認）');
      closeDetail(env);
    } else {
      env.log('▶ 公佈欄：取消購買');
      env.requestRender();
    }
    return;
  }

  if (ui.mode === 'detail') {
    // @source loc_00427ad9：`[0x48c2c1] == 1` → 撤件／購買、`== 2` → 退卡
    if (p?.area === 'detailAction') onDetailAction(env);
    else if (p?.area === 'detailExit') closeDetail(env);
    else env.requestRender();
    return;
  }

  if (ui.mode === 'pick') {
    if (p?.area === 'pickExit') {
      closeAll(env);
      return;
    }
    if (p?.area === 'pickItem') {
      openPrice(env, p.index);
      return;
    }
    // 股票／地產：抬手认**悬停**那一行（原版 `[0x48c2b8]` / `[0x48c2ba]`）
    if (ui.pickHot !== null) openPrice(env, ui.pickHot);
    else env.requestRender();
    return;
  }

  if (ui.mode === 'type') {
    // @source loc_004281d4：先重画主屏（把选单擦掉），悬停到格子才开选物窗
    const i = ui.typeHot;
    ui.mode = 'board';
    ui.typeHot = null;
    if (i !== null) openPick(env, i);
    else env.requestRender();
    return;
  }

  if (ui.mode === 'board') {
    if (p?.area === 'slot') {
      openDetail(env, p.player, p.slot);
      return;
    }
    if (p?.area === 'exit') {
      closeAll(env);
      return;
    }
    env.requestRender();
  }
}

// ============================================================
//  UiScreen
// ============================================================

/**
 * 「取消」这一拍：从最上面那一层开始收 —— **ESC 与右键共用**。
 *
 * 原版这两键本来就同源（钩子把取消键补成 `WM_RBUTTONUP (0x205)`，
 * @source VA 0x004011c3），所以本屏也只留这一把梯子：
 * 填数页 → 详情框 → 选物窗/选单 → 主屏。逐层 VA 见 `boardScreen.contextmenu`。
 */
function cancelBoardLayer(env: UiScreenEnv): void {
  if (ui.mode === 'price') closePrice();
  else if (ui.mode === 'detail') closeDetail(env);
  else if (ui.mode !== 'board') {
    ui.mode = 'board';
    ui.typeHot = null;
    ui.pickHot = null;
    ui.press = null;
  } else closeAll(env);
  env.requestRender();
}

export const boardScreen: UiScreen = {
  id: 'notice-board',

  active(env: UiScreenEnv): boolean {
    return ui.open && env.screen === 'game' && env.state.currentPlayer === ui.forPlayer;
  },

  hotkey(fn: number, env: UiScreenEnv): boolean {
    if (fn === 13 /* HOTKEY.trade @source rich4.asm 11636 `call 0x4284be` */) {
      if (ui.open) {
        closeAll(env);
        return true;
      }
      if (env.screen !== 'game') return false;
      const me = env.state.players[env.state.currentPlayer];
      if (me === undefined) return false;
      ui.open = true;
      ui.forPlayer = env.state.currentPlayer;
      ui.mode = 'board';
      env.requestRender();
      return true;
    }
    if (!boardScreen.active(env)) return false;
    if (fn === 5 /* HOTKEY.cancel */) {
      cancelBoardLayer(env);
      return true;
    }
    return false;
  },

  /**
   * 右键 = 关掉最上面那一层 —— 与上面的 `Escape` 走**同一个** `cancelBoardLayer`。
   *
   * @source 原版的 `0x205` 分支（各层各一支，作用与 ESC 完全一样，因为钩子把
   *   取消键补成了 `WM_RBUTTONUP`，@source VA 0x004011c3）：
   * | 当前那一层 | 窗口过程收 0x205 的那一支 |
   * |---|---|
   * | 填数页 | `loc_00425fca` / `loc_00426673` / `loc_00426b89` / `loc_00426fa4`（关填数窗，返回 0）|
   * | 选物窗 | 同上（那一层就是选物窗）|
   * | 详情框 | `loc_00427b7d`（`fcn_0042704e`：关框 + `Post_0402_Message(0)`）|
   * | 主屏 | `loc_00428378`（`fcn_00427c21`：`Post_0402_Message(0)` 走人）|
   */
  contextmenu(_x, _y, env: UiScreenEnv): void {
    if (!boardScreen.active(env)) return;
    cancelBoardLayer(env);
  },

  toolbar(index: number, env: UiScreenEnv): boolean {
    // 工具列第 10 颗「SALE? 房子」就是这一屏 @source VA 0x00417dee `call 0x4284be`
    if (index !== 9) return false;
    if (env.screen !== 'game') return false;
    if (ui.open) closeAll(env);
    else {
      ui.open = true;
      ui.forPlayer = env.state.currentPlayer;
      ui.mode = 'board';
      env.requestRender();
    }
    return true;
  },

  tick(env: UiScreenEnv): void {
    if (ui.message !== null && env.now >= ui.messageUntil) {
      ui.message = null;
      env.requestRender();
    }
    // 换人就收屏（原版这扇窗只在当前玩家的回合里开着）
    if (ui.open && env.state.currentPlayer !== ui.forPlayer) {
      resetBoardScreen();
      if (env.screen === 'game') env.requestRender();
    }
  },

  /**
   * 只做**悬停**，而且只做原版真有的那两处：
   *   弹出选单那四格（VA 0x00427cfd）、
   *   股票／地產选物窗的行与地產的页签（VA 0x00425b19 / 0x004261cb）。
   * 挂牌格、SALE／EXIT、详情框那两颗钮原版**都没有悬停**，这里也不加。
   */
  move(x: number, y: number, env: UiScreenEnv): void {
    // ★ YES/NO 确认是模态的：它开着时鼠标只用来高亮哪一半
    //   @source `_rich4_ui_yesno` 的 `0x200`（`:145-155` 换图）
    if (ui.confirm !== null) {
      const hover = hitYesNo(x, y);
      if (hover !== ui.confirm.hover) {
        ui.confirm = { ...ui.confirm, hover };
        env.requestRender();
      }
      return;
    }
    if (ui.mode === 'type') {
      const hot = hitSalePopup(x, y);
      if (hot !== ui.typeHot) {
        ui.typeHot = hot;
        env.requestRender();
      }
      return;
    }
    if (ui.mode !== 'pick') return;
    if (ui.pickKind === LISTING.stock) {
      const items = boardPickItems(env.state, env.topo, LISTING.stock);
      const hot = hitPickStockRow(x, y, items.length);
      if (hot !== ui.pickHot) {
        ui.pickHot = hot;
        env.requestRender();
      }
      return;
    }
    if (ui.pickKind !== LISTING.estate) return;
    const tab = hitPickEstateTab(x, y);
    if (tab !== null && tab !== ui.pickTab) {
      ui.pickTab = tab;
      ui.pickHot = null;
      env.requestRender();
      return;
    }
    const v = pickEstateView(env);
    const row = hitPickEstateRow(x, y, v.items.length);
    const hot = row === null ? null : (v.full[row] ?? null);
    if (hot !== ui.pickHot) {
      ui.pickHot = hot;
      env.requestRender();
    }
  },

  /** 按下：只记账 + 画压下高亮（原版 `0x201`）*/
  down(x: number, y: number, env: UiScreenEnv): void {
    onDown(env, x, y);
  },

  /** 抬手：才成立（原版 `0x202`）；坐标不参与判定，只认按下记下的那一个 */
  up(x: number, y: number, env: UiScreenEnv): void {
    // 抬手坐标以**事件给的**为准（`move` 记的那一份只在没收到坐标时兜底）
    onUp(env, { x, y });
  },

  draw(env: UiScreenEnv): void {
    const ctx = env.stage;
    ctx.imageSmoothingEnabled = false;
    const view = boardView(env.state);
    drawBoard(ctx, env, view);
    if (ui.mode === 'type') drawSalePopup(ctx, env);
    if (ui.mode === 'pick') drawPick(ctx, env, env.state, env.topo);
    if (ui.mode === 'detail') drawDetail(ctx, env, view, env.state, env.topo);
    if (ui.mode === 'price') drawPrice(ctx, env, null);
    // ★ 買别人挂牌前的 YES/NO 确认（模态，压在最上面）@source `_rich4_ui_yesno`
    if (ui.confirm !== null) drawYesNo(ctx, env, ui.confirm.hover);
    drawMessage(ctx, env);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },
};
