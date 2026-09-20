/*
 * 卡片商店／道具商店（百貨公司）—— P2-8 / U-2
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ **這一屏花的是點數，不是錢**；買／賣的規則全在 core（`places/shop.ts`），
 *   本模块只摆位置、画字、算命中 —— 与 `asset-sheet.ts` / `inventory.ts` 同一套分工。
 *
 * ## 出处（窗口过程 VA 0x0042d37f；入口 `_rich4_ui_shop_entry` VA 0x0042e9xx）
 *
 * 全仓库只有 `rich4_shop.asm` 引用 `[0x48c308]`（= `read_mkf(panel_mkf, 10, 0, 0)`），
 * 所以这一屏用到的图**可以穷举**：
 *
 * | 是什么 | @source |
 * |---|---|
 * | 底图 = 资源 10 图 0（卡片店）/ 图 16（道具店），落点 (0,0) | 0x42d2f2 前 |
 * | 左侧货架栏 = 图 1 / 图 17（222×462），落点 `(滑入 x, 10)` | 0x42d75e |
 * | 老板娘 = 图 2 / 图 18，锚点落 **(320,240)** | 0x42d2f2 / 0x42d32c |
 * | 对话气泡 = 图 15（270×219），落点 (120,10) | 0x42d299 尾 |
 * | 三角切页钮 = 图 13/29（常态）、图 14/30（按下），(542,13) | 0x42d64f / 0x42de4c |
 * | EXIT = 图 35（常态）/ 图 36（按下），(556,246) | 0x42d75e / 0x42de4c |
 * | 點數底板 = 图 37（90×40），(230,246)；数字 flag 1 画在 (310,257) | 0x42d499 |
 * | 货名／价格 —— 原版**烤进货架栏那张图**里，之后不重画 | 0x42eb61 起 / 0x42ec23 起 |
 * | 自己的 5×3 格 = **资源 11** 图 0（卡片，青绿）/ 图 1（道具，砖红） | 见「格子」一节 |
 * | 格里的道具图标 = 资源 11 图 `槽 + 2`（与 T-024 道具欄同一套） | ~0x447cde |
 *
 * ⚠️ **图自带的 x/y 是裁切原点，落点要减掉它**：`draw_image_in_rect`（VA 0x455b3a）
 *   里就是 `to_left = x - src->x`。老板娘那两张图的原点分别是 (−52,208) 与 (−21,229)，
 *   所以传 (320,240) 进去，实际落在 **(372,32)** 与 **(341,11)**。
 *   （反汇编里老板娘眨眼那几个脏矩形是按「没减原点」的数写的，与真实落点差 6px ——
 *   是原版自己的小错，拿资源 10 的图 18/21 叠一下就能看出来；落点以本模块为准。）
 *
 * ⚠️ **图 3 / 19 / 20 / 28 / 31–34 这一屏根本不画**（废图）。
 *
 * ⚠️ **什么时候触发与棋盘上不一样**：买／卖在 `WM_LBUTTONDOWN`（VA 0x42de09），
 *   切页／退出在 `WM_LBUTTONUP`（VA 0x42e62b）。本模块只管命中与判定顺序。
 */

import type { PendingInteraction } from '@rich4/core';
import { CARDS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';
import type { InvEntry } from './inventory.ts';
import { FONT_FAMILY } from './font.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type ShopSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 本屏的底图资源 @source `read_mkf(panel_mkf, 10, 0, 0)` */
export const SHOP_RESOURCE = 10;
/** 格子底 + 道具图标所在的资源（与 T-024 道具欄共用） */
export const SHOP_GRID_RESOURCE = 11;

/** 两页：0 = 卡片店，1 = 道具店 */
export const SHOP_PAGE = { cards: 0, tools: 1 } as const;
export type ShopPage = 0 | 1;

/** 页 → 图号。原版凡是写作 `16*page + k` 的都收在这里 @source 0x42d510、0x42d747 等 */
export const SHOP_CHUNK = {
  bg: [0, 16],
  panel: [1, 17],
  keeper: [2, 18],
  /** 三角切页钮：常态 / 按下 */
  switchOn: [13, 29],
  switchOff: [14, 30],
} as const;

/** 与页无关的图号 */
export const SHOP_FIXED_CHUNK = {
  bubble: 15,
  exitOn: 35,
  exitOff: 36,
  pointsPlate: 37,
} as const;

/** 格子底的图号 */
export const SHOP_GRID_CHUNK = { cards: 0, tools: 1 } as const;
/** 道具图标的图号 = **槽 + 2**（槽 = 道具号 − 1）@source ~0x447cde 的 `[槽 + 2]` */
export const SHOP_ICON_FIRST = 2;

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 左侧货架栏的 y @source 0x42d75e `push 0xa` */
export const SHOP_PANEL_Y = 0x0a;
/** 右下 5×3 格底图的 y @source 0x42d75e `push 0x125` */
export const SHOP_GRID_Y = 0x125;
/** 老板娘：两页都传 (320,240)，靠图自己的原点落到真正的落点 @source 0x42d2f2 / 0x42d32c */
export const SHOP_KEEPER_AT = { x: 0x140, y: 0xf0 } as const;
/** 对话气泡落点 @source 0x42d2cc `fcn_0044ec30(图 15, 0x78, 0xa, …)` */
export const SHOP_BUBBLE_AT = { x: 0x78, y: 0x0a } as const;
/** 气泡寿命 @source `fcn_0044ee18` VA 0x44ee43 `cmp eax, 0x7d0` */
export const SHOP_BUBBLE_MS = 2000;
/**
 * 气泡里字的位置：`x0 + w/2 + arg4`、`y0 + h/2 + arg5`（flag 4 = 正中）。
 * 那两个 arg 由 `fcn_0044ec30` 存进 `[0x48c618]` / `[0x48c62c]` —— 传进来的是 −20 和 0。
 * @source `fcn_0044ecb6` VA 0x44ed71 起
 */
export const SHOP_BUBBLE_TEXT = { dx: -20, dy: 0, size: 0x14 } as const;

/** 點數：底板落点 + 数字的 flag 1 落点 @source 0x42d499 */
export const SHOP_POINTS = {
  plateX: 0xe6,
  plateY: 0xf6,
  textX: 0x136,
  textY: 0x101,
} as const;

/** 三角切页钮：命中框 @source 0x42de4c `x∈[0x21e,0x273] y∈[0xd,0x62]`；落点 @source 0x42d64f */
export const SHOP_SWITCH_HIT = { x0: 0x21e, y0: 0x0d, x1: 0x273, y1: 0x62 } as const;
export const SHOP_SWITCH_AT = { x: 0x21e, y: 0x0d } as const;
/** EXIT：命中框 @source 0x42df31 `x∈[0x22c,0x27c] y∈[0xf6,0x11e]`；落点 @source 0x42d75e */
export const SHOP_EXIT_HIT = { x0: 0x22c, y0: 0xf6, x1: 0x27c, y1: 0x11e } as const;
export const SHOP_EXIT_AT = { x: 0x22c, y: 0xf6 } as const;

/**
 * 货架两页的行几何。
 *
 * `x0/x1/y0/rowH/rows` 取自命中（卡片 @source 0x42e148、道具 @source 0x42e39c）；
 * `name*`/`price*` 是**货架栏局部**的画字落点（卡片 @source 0x42eb61 起、道具 0x42ec23 起）。
 *
 * ★ 卡片页行距 24、道具页行距 48 —— 两页不一样，别合并。
 */
export const SHOP_SHELF = {
  cards: {
    x0: 0x0e,
    x1: 0xd7,
    y0: 0x51,
    rowH: 0x18,
    rows: 15,
    nameX: 0x5a,
    nameDy: 0x53,
    priceX: 0xc2,
    priceDy: 0x4b,
  },
  tools: {
    x0: 0x0c,
    x1: 0xd5,
    y0: 0x50,
    rowH: 0x30,
    rows: 8,
    nameX: 0x5a,
    nameDy: 0x5c,
    priceX: 0xc2,
    priceDy: 0x54,
  },
} as const;

/**
 * 自己那 5×3 格。@source 命中 0x42dfe6：
 * `x∈(0xe8, 0x278)`、`y∈(0x12a, 0x1d2)` 都是**开**区间，
 * `col = (x−0xe8)/80`、`row = (y−0x12a)/56` —— 所以首格从 233 / 299 起。
 *
 * ★ 与 `inventory.ts` 的 `INV_CELL`（19/135）差 1px。格子底图是同一张，
 *   5×80+12 = 412 说明两边各留 6px，本屏按原版这一组数。
 */
export const SHOP_CELL = {
  /** 除算基准（原版 0xe8 / 0x12a），首格从基准 +1 起 */
  baseX: 0xe8,
  baseY: 0x12a,
  /** 命中的右／下界（原版 0x278 / 0x1d2），开区间 */
  endX: 0x278,
  endY: 0x1d2,
  w: 0x50,
  h: 0x38,
  cols: 5,
  rows: 3,
} as const;

/** 格数 = 5×3 = 15（也是手牌上限） */
export const SHOP_SLOTS = SHOP_CELL.cols * SHOP_CELL.rows;

/** 格里各元素的**格内**偏移 @source `fcn_00441b0a`（卡片）/ `fcn_00447c6e`（道具） */
export const SHOP_CELL_LOCAL = {
  /** 道具图标：`fcn_00447c6e` 传 `esi − 0x10 = 0x1d`、y = `0x21` */
  iconDx: 0x1d,
  iconDy: 0x21,
  /** 数量 `×N`：flag 1（右上）在 `esi + 0x22 = 0x4f`、`0x21 − 0xa` */
  countDx: 0x4f,
  countDy: 0x17,
  /** 卡名：flag 2（正中）在 `0x2d` / `0x21` */
  cardDx: 0x2d,
  cardDy: 0x21,
} as const;

/** 画字字号 @source 0x42ea2b `create_font(0x14, 0xffffff, 0x101010, 3, 0)` */
export const SHOP_FONT_SIZE = 0x14;

/** 第 `slot` 格的矩形（**屏幕**坐标，格子底图已滑到位时）*/
export function shopCellRect(slot: number): { x: number; y: number; w: number; h: number } {
  const col = slot % SHOP_CELL.cols;
  const row = Math.floor(slot / SHOP_CELL.cols);
  return {
    x: SHOP_CELL.baseX + 1 + col * SHOP_CELL.w,
    y: SHOP_CELL.baseY + 1 + row * SHOP_CELL.h,
    w: SHOP_CELL.w,
    h: SHOP_CELL.h,
  };
}

// ============================================================
//  滑入（货架栏从左边、格子从右边）
// ============================================================

/**
 * @source `loc_0042d5fe` VA 0x42d5fe：
 * ```asm
 * 0042d5ba  mov [0x48c318], 1
 * 0042d5c1  mov [0x48c333], 5           ; 货架栏到位 x
 * 0042d5cb  mov [0x48c337], 0xe3        ; 格子到位 x
 * 0042d5a5  mov [0x48c333], 0xffffff22  ; 首次从 −222 起
 * 0042d5a9  mov [0x48c337], 0x280       ; 与 640 起
 * 0042d5d8  mov [0x48c33b], 0x28        ; dx = 40
 * 0042d5e2  mov [0x48c33f], 0x50        ; dy = 80
 * 0042d5fe  dx −= 3 / dy −= 7           ; 缓出
 * ```
 * 每帧走一格（原版是 50ms 的定时器、隔一次动一下），约 9 帧到位。
 */
export const SHOP_SLIDE = {
  panelFrom: -0xde,
  panelTo: 5,
  gridFrom: 0x280,
  gridTo: 0xe3,
  dx0: 0x28,
  dy0: 0x50,
  ddx: 3,
  ddy: 7,
} as const;

export interface ShopSlide {
  /** 货架栏的 x */
  panelX: number;
  /** 格子的 x */
  gridX: number;
  dx: number;
  dy: number;
}

/**
 * 滑入每帧之间的间隔。
 *
 * 原版挂的是 **50ms** 的定时器（`SetTimer(hwnd, 0x32, callbackSize, 0)`），
 * 但 `loc_0042d87e` 里 `[0x48c348] ^= 1; je` 让它**隔一次才动一下** ——
 * 所以实际是 100ms 一帧，8 帧共约 0.8 秒。
 */
export const SHOP_SLIDE_MS = 100;

export function slideStart(): ShopSlide {
  return {
    panelX: SHOP_SLIDE.panelFrom,
    gridX: SHOP_SLIDE.gridFrom,
    dx: SHOP_SLIDE.dx0,
    dy: SHOP_SLIDE.dy0,
  };
}

/**
 * 走一帧。
 *
 * ★ **到位后必须停**：原版的速度是**无条件递减**的（`sub [0x48c33b], 3`），
 *   所以再多走几帧 `dy` 会转负，把格子从 227 推回去（钳位只挡住 `< 0xe3` 那一侧）。
 *   原版不会走到那一步 —— 到位的同一次调用里 `[0x48c318]` 就变成 2，定时器不再发 0x40c
 *   （VA 0x42d75e 尾）。这里把「不再走」写进函数本身。
 */
export function slideStep(s: ShopSlide): ShopSlide {
  if (slideDone(s)) return s;
  return {
    panelX: Math.min(SHOP_SLIDE.panelTo, s.panelX + s.dx),
    gridX: Math.max(SHOP_SLIDE.gridTo, s.gridX - s.dy),
    dx: s.dx - SHOP_SLIDE.ddx,
    dy: s.dy - SHOP_SLIDE.ddy,
  };
}

/** 两样都到位了 —— 这时候原版才画那两个钮 @source 0x42d64f */
export function slideDone(s: ShopSlide): boolean {
  return s.panelX === SHOP_SLIDE.panelTo && s.gridX === SHOP_SLIDE.gridTo;
}

/** 「已经到位」那份滑入状态（`dx/dy` 归零，免得再走）—— 见 `shopEntryOf` */
export function slideEnd(): ShopSlide {
  return { panelX: SHOP_SLIDE.panelTo, gridX: SHOP_SLIDE.gridTo, dx: 0, dy: 0 };
}

/** 进店 / 换页那一刻要摆成什么样 */
export interface ShopEntry {
  /** 这一页从哪儿开始摆 */
  slide: ShopSlide;
  /** 要说的开场白；`null` = **不播开场**（直接到位、也不弹那句）*/
  entry: string | null;
}

/**
 * 换页那一刻的分支 —— 原版 `loc_0042d577` 那一句
 * `cmp byte [eax + 0x48c349], 0 / jne loc_0042d5ba`：
 *
 * - **标志 == 0**（这一页的开场还没播过）：`[0x48c333] = -222`、`[0x48c337] = 640`
 *   （= 我们的 `slideStart()`），再 `fcn_0044ecb6([0x4755c0 + 页×24])` 弹开场白；
 * - **标志 != 0**：`PostMessage(0x40e)` —— 直接到位，而 `0x40e` 的处理器
 *   `loc_0042d499` 只是画**點數**那一块（`[0x48c308] + 0x1c8` 底板 + `%d`），
 *   **不弹任何气泡**。
 *
 * ★ 两个标志 `[0x48c349]` / `[0x48c34a]` 在铺场时是 `!animation`
 *   （@source `loc_0042d423`，见 `Q-ANIM-1.md`）—— 所以「動畫過程」关掉时
 *   进店**不播滑入、也不弹开场白**，这就是本函数 `playOpening === false` 那一支。
 */
export function shopEntryOf(page: ShopPage, playOpening: boolean): ShopEntry {
  return playOpening
    ? { slide: slideStart(), entry: shopMessage(page, 'entry') }
    : { slide: slideEnd(), entry: null };
}

/**
 * 格子底图**局部**坐标下第 0 格的左上角。
 * 底图 412×180 = 5×80 + 2×6 = 3×56 + 2×6，所以边缘就是 6。
 */
export const SHOP_CELL_ORIGIN = {
  x: SHOP_CELL.baseX + 1 - SHOP_SLIDE.gridTo,
  y: SHOP_CELL.baseY + 1 - SHOP_GRID_Y,
} as const;

// ============================================================
//  老板娘脸上的两个小动作
// ============================================================

/**
 * @source `loc_0042d87e` 的跳表（VA 0x42d36b 起 5 项）。
 *
 * 进店时低 4 位被置成 `页 + 3`（`loc_0042d5d8`），所以真正跑得到的只有 case 3 / 4：
 * `rand()` 抽一张脸 —— 卡片页在 1..3 里抽（图 4..6）、道具页 `rand()&1`（图 23/24）；
 * **与上次抽到的一样就跳过**（`cmp esi, ebp / je`）。
 *
 * ★ 那几张走的是 `fcn_004563f5`（**不带透明**的整块贴图，见 `loc_0042d977`），
 *   所以换一张就等于把上一张盖掉 —— 这才是它看起来会闪的原因。
 *
 * 第二处（图 9–11 / 25–27）由 `[0x48c314]` 那个倒数器驱动（`loc_0042dc4c`）：
 * 倒到 0 先画基准帧（图 9 / 图 25），随后有 `rand()>>11 < 4`（约 1/4）的机会换成
 * 图 10/11 或 26/27，并把倒数重置成 `rand() & 7`（抽到 0 就取 1）。
 */
export interface ShopBlink {
  /** 上一帧画的脸是哪一张 @source `[0x48c32f]` 的 bit 8–11 */
  face: number;
  /** 第二处的倒数 @source `[0x48c314]` */
  hold: number;
  /** 上一次推进的时刻 —— 原版靠「隔一次 50ms 定时器」，所以约 100ms 一动 */
  at: number;
}

export const SHOP_BLINK_MS = 100;

/**
 * 脸与第二处的落点。
 * 卡片页：`loc_0042d911` 的 `push 0x195 / push 0x3c`、`loc_0042dcc0` 的 `push 0x195 / push 0x5b`；
 * 道具页：`loc_0042d9c6` 的 `push 0x1a1 / push 0x32`、`loc_0042dd6e` 的 `push 0x1a1 / push 0x59`。
 */
export const SHOP_BLINK_AT = [
  { face: { x: 0x195, y: 0x3c }, mouth: { x: 0x195, y: 0x5b } },
  { face: { x: 0x1a1, y: 0x32 }, mouth: { x: 0x1a1, y: 0x59 } },
] as const;

export function blinkStart(): ShopBlink {
  return { face: 0, hold: 0, at: 0 };
}

/**
 * 推进一次这个动画机；返回这一帧要画哪两张图（`null` = 这一帧什么都不画）。
 *
 * @param rnd 取 `[0, 1)` 的随机数 —— 原版用的是 `_libc_rand`，注入进来是为了单测能钉住序列
 */
export function blinkStep(
  b: ShopBlink,
  page: ShopPage,
  now: number,
  rnd: () => number,
): { face: number; mouth: number } | null {
  if (now - b.at < SHOP_BLINK_MS) return null;
  b.at = now;
  const cardPage = page === SHOP_PAGE.cards;

  const pick = cardPage ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
  const face = cardPage ? pick + 3 : pick + 22;

  let mouth = 0;
  if (b.hold > 0) {
    b.hold -= 1;
    if (b.hold === 0) mouth = cardPage ? 9 : 25;
  } else if (rnd() < 1 / 4) {
    mouth = cardPage ? (rnd() < 0.5 ? 11 : 10) : rnd() < 0.5 ? 27 : 26;
    b.hold = Math.floor(rnd() * 8) || 1;
  }

  if (face === b.face && mouth === 0) return null;
  b.face = face;
  return { face, mouth };
}

// ============================================================
//  命中
// ============================================================

function inBox(
  x: number,
  y: number,
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/** 点在三角切页钮上 @source 0x42de4c */
export function hitShopSwitch(x: number, y: number): boolean {
  return inBox(x, y, SHOP_SWITCH_HIT);
}

/** 点在 EXIT 上 @source 0x42df31 */
export function hitShopExit(x: number, y: number): boolean {
  return inBox(x, y, SHOP_EXIT_HIT);
}

/** 点在自己那 15 格的哪一格上；没点中返回 null @source 0x42dfe6 */
export function hitShopCell(x: number, y: number): number | null {
  const c = SHOP_CELL;
  if (x <= c.baseX || x >= c.endX) return null;
  if (y <= c.baseY || y >= c.endY) return null;
  const col = Math.floor((x - c.baseX) / c.w);
  const row = Math.floor((y - c.baseY) / c.h);
  return row * c.cols + col;
}

/**
 * 点在货架第几行上；没点中返回 null @source 0x42e148（卡片）/ 0x42e39c（道具）。
 *
 * ⚠️ 原版的下界是**闭**区间，`y = 下界 + 行数 × 行距` 那一像素会读到货架数组**越界一格**
 *   （`ref_0048c31c` 只有 15 字节，越界那格其实是定时器句柄的低字节，非 0）。
 *   这里直接返回 null —— 这是本模块唯一一处**故意与原版不同**，因为照抄会买一张乱码卡。
 */
export function hitShopShelf(page: ShopPage, x: number, y: number): number | null {
  const s = page === SHOP_PAGE.cards ? SHOP_SHELF.cards : SHOP_SHELF.tools;
  if (x < s.x0 || x > s.x1 || y < s.y0) return null;
  const row = Math.floor((y - s.y0) / s.rowH);
  return row < s.rows ? row : null;
}

// ============================================================
//  老板娘要说的那句话
// ============================================================

/**
 * 串表 `0x4755c0`（**连续 12 项**，按 `3*page + 下标` 取）—— 逐条 dump 自 `rich4.exe`。
 *
 * | 下标 | 何时 |
 * |---|---|
 * | 0 / 5 | 进店（第 0x405 条消息，只在本次进店第一次看这一页时）|
 * | 1 / 6 | 滑入到位（第 0x40d 条消息）|
 * | 2 / 7 | 點數不够 |
 * | 3 / 8 | 卡片欄／道具欄满 |
 * | 4 / 10 | 离开（第 0x202 抬手）|
 * | 9 | 本屏未用（「會員才能兌換」）|
 */
export const SHOP_MSG = [
  '有什麼我能為你服務的嗎？',
  '請挑選你想要\n兌換的卡片。',
  '抱歉！\n你的點數不足！',
  '對不起！\n您的卡片欄已滿！',
  '歡迎下次再來！',
  '歡迎光臨\n道具店！',
  '您要兌換\n什麼道具？',
  '對不起，\n您的點券不夠！',
  '很抱歉！您的\n道具欄已滿！',
  '這個道具會員\n才能兌換！',
  '謝謝惠顧！',
] as const;

export type ShopMsgKind = 'entry' | 'hint' | 'notEnough' | 'full' | 'bye';

/** 页 + 场合 → `SHOP_MSG` 的下标 */
const MSG_AT: Record<ShopPage, Record<ShopMsgKind, number>> = {
  0: { entry: 0, hint: 1, notEnough: 2, full: 3, bye: 4 },
  1: { entry: 5, hint: 6, notEnough: 7, full: 8, bye: 10 },
};

/** 该说哪句 */
export function shopMessage(page: ShopPage, kind: ShopMsgKind): string {
  return SHOP_MSG[MSG_AT[page][kind]] ?? '';
}

// ============================================================
//  货架上的行
// ============================================================

/** 货架上的一行 */
export interface ShopShelfRow {
  id: number;
  name: string;
  price: number;
}

/**
 * 把待决交互里的货架摆成行。
 *
 * ★ **开店时算一次就够**：买过的行**不从清单里去掉** —— 原版是把货名烤进货架栏那张图的，
 *   之后不重画，所以买过的行仍然显示，只是再点没反应。
 *   调用方因此要在 `pending` 首次出现时**快照**一份，之后一直用这份快照。
 */
export function shopRows(page: ShopPage, pending: PendingInteraction): readonly ShopShelfRow[] {
  if (pending.kind !== 'shop') return [];
  const src = page === SHOP_PAGE.cards ? pending.cards : pending.tools;
  const rows = page === SHOP_PAGE.cards ? SHOP_SHELF.cards.rows : SHOP_SHELF.tools.rows;
  return src.slice(0, rows).map((it) => ({ id: it.id, name: it.name, price: it.price }));
}

/** 一行在货架栏**局部**坐标下的画字位置 */
export function shelfRowTextAt(
  page: ShopPage,
  row: number,
): { nameX: number; nameY: number; priceX: number; priceY: number } {
  const s = page === SHOP_PAGE.cards ? SHOP_SHELF.cards : SHOP_SHELF.tools;
  return {
    nameX: s.nameX,
    nameY: s.nameDy + row * s.rowH,
    priceX: s.priceX,
    priceY: s.priceDy + row * s.rowH,
  };
}

// ============================================================
//  自己格子里装了什么
// ============================================================

/** 格子里的内容 —— 与 T-024 道具欄同一份形状 */
export type ShopCellEntry = InvEntry;

/**
 * 格子 → 该卖哪一件。**两页的取法不一样**：
 *
 * @source 0x42dfe6 卡片页读 `player_cards[槽]`（槽号就是下标，卖的就是那一张）；
 *   道具页读的是绘制时记下的 `[0x48c548 + 槽]` —— 那是**紧排**过的一张「槽 → 道具号」表
 *   （`fcn_00447c6e` 填的，空槽不占位），所以按数组下标取。
 */
export function cellItemAt(
  page: ShopPage,
  cells: readonly ShopCellEntry[],
  slot: number,
): ShopCellEntry | null {
  if (slot < 0 || slot >= SHOP_SLOTS) return null;
  if (page === SHOP_PAGE.cards) return cells.find((c) => c.slot === slot) ?? null;
  return cells[slot] ?? null;
}

// ============================================================
//  绘制
// ============================================================

/** 这一帧要画成什么样 */
export interface ShopDraw {
  page: ShopPage;
  /** 滑入位置（到位后 = `SHOP_SLIDE.panelTo` / `gridTo`）*/
  panelX: number;
  gridX: number;
  points: number;
  /** 开店时的货架快照 */
  shelf: readonly ShopShelfRow[];
  /** 自己格子的内容（按槽序）*/
  cells: readonly ShopCellEntry[];
  /** 气泡里要写的字；`null` = 不画气泡 */
  bubble: string | null;
  /** 正被按住的那个钮（画按下图）*/
  pressed: 'switch' | 'exit' | null;
  /** 这一帧老板娘要换的脸与第二处（见 `blinkStep`）；`undefined` / `null` = 本帧不重画 */
  blink?: { face: number; mouth: number } | null;
  /** 正被按住的**自己那一格**（见 `SHOP_CELL_PRESS`）；`null` = 没有 */
  pressedCell?: number | null;
}

/**
 * 按下自己那一格时的「凹进去」效果。
 *
 * @source `rich4_shop.asm` VA 0x42e0e4（卖卡／卖道具共用的尾巴）：
 * ```asm
 * lea eax, [esp + 0x40]     ; 被点中那一格的矩形 (233+80c, 299+56r, 311+80c, 353+56r)
 * push eax
 * call fcn_00451b9e         ; ★ 单步，不是动画
 * ```
 * `fcn_00451b9e`（VA 0x451b9e）那一步做的是：**逐行 `memcpy(row[i], row[i+1]+1px, w*2-2)`**
 * —— 内容整体**右下各移 1 像素**；随后两次 `fcn_004552e7(…, -16)` 把**上边一条**与
 * **左边一条**压暗（`0x485d68 + (-16)*32` 那张表 = 每个 5 位分量减半）。
 * 抬起时 `fcn_00451d4e`（VA 0x451d4e）反向复原，并重贴一次格子底图。
 *
 * ⚠️ 原版那一步是**后台缓冲上的破坏性像素操作**，且最后一行／最后一列**保持原样**
 *   （`memcpy` 只覆盖 w-1 个像素、循环只到 h-2）。本引擎是每帧重画，所以这里按
 *   「整体右下移 1px + 压暗上/左两条边」重画一遍 —— 观感一致，但那一行一列的
 *   「旧内容」细节无法逐像素等同（1px，肉眼不可辨）。
 */
export const SHOP_CELL_PRESS = {
  /** 内容往右下各移这么多像素 */
  shift: 1,
  /** 上边／左边压暗的宽度与浓度（−16 在 5 位分量上就是减半）*/
  edge: 1,
  edgeAlpha: 0.5,
} as const;

const SHOP_FONT = FONT_FAMILY;

/** 20 号白字 + 3px 深色描边 —— 与 T-024 道具欄同一套 @source 0x42ea2b */
function shopText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): void {
  ctx.font = `${SHOP_FONT_SIZE}px ${SHOP_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#101010';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

/**
 * 锚点落点绘制 —— (x,y) 是图的 `anchorX/anchorY` 所在处。
 * @source `fcn_00456418` VA 0x456418 → `draw_non_zero_image_in_rect`（`to_left = x - src->x`）
 */
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 哪几张图要**抠掉纯黑**（= 原版走带透明的 `fcn_00456418`，而不是不透明的 `fcn_004563f5`）。
 *
 * | 图 | 原版用哪个 | 抠黑 |
 * |---|---|---|
 * | 0 / 16 底图、1 / 17 货架栏 | `fcn_004563f5`（不透明）| ✗ |
 * | 2 / 18 老板娘 | `fcn_00456418` @0x42d2f2 / 0x42d32c | ✓ |
 * | 4–8、9–11、12、21–27 变脸帧 | `fcn_004563f5` @0x42d977（**整块贴图**，靠这个盖掉上一帧）| ✗ |
 * | 13 / 29、14 / 30 三角钮 | `fcn_00456418` @0x42d64f | ✓ |
 * | 35 / 36 EXIT | `fcn_00456418` @0x42d75e | ✓ |
 * | 37 點數底板 | `fcn_00456418` @0x42d499 | ✓ |
 * | 15 气泡 | `fcn_00456418`（`fcn_0044ecb6` 里）| ✓ |
 * | 资源 11 图 0 / 1 格底 | 先 `fcn_00456280` 拷进 surface 再带透明贴 | ✗（整块，无黑像素）|
 * | 资源 11 图 2+ 道具图标 | `fcn_004562a5` = 带透明 | ✓ |
 *
 * ⚠️ 抠黑只对**黑是背景**的那几张成立。货架栏（图 1）里也有 2% 的纯黑，那是图案的一部分，
 *   一抠就是一个洞 —— 所以这张绝不能抠。
 */
const SHOP_KEYED = new Set<number>([
  SHOP_CHUNK.keeper[0],
  SHOP_CHUNK.keeper[1],
  SHOP_CHUNK.switchOn[0],
  SHOP_CHUNK.switchOn[1],
  SHOP_CHUNK.switchOff[0],
  SHOP_CHUNK.switchOff[1],
  SHOP_FIXED_CHUNK.bubble,
  SHOP_FIXED_CHUNK.exitOn,
  SHOP_FIXED_CHUNK.exitOff,
  SHOP_FIXED_CHUNK.pointsPlate,
]);

/** 资源 10 的图 —— 抠不抠黑由 `SHOP_KEYED` 说了算，别在各处手写 */
function shopSprite(sprite: ShopSprite, index: number): Sprite | null {
  return sprite('Panel.mkf', SHOP_RESOURCE, index, SHOP_KEYED.has(index));
}

/**
 * 画整屏。
 *
 * 顺序照原版：`fcn_0042d299`（底图 → 老板娘）+ `loc_0042d75e`（货架栏 → 格子 → 两个钮）
 * + `loc_0042d499`（點數）+ 气泡（原版最后画，压在老板娘身上）。
 *
 * ★ 原版**滑入没到位就不画那两个钮**（`loc_0042d64f` 的 `jne loc_0042d75e`），这里照做。
 */
export function drawShopScreen(
  ctx: CanvasRenderingContext2D,
  sprite: ShopSprite,
  d: ShopDraw,
): void {
  const page = d.page;
  const cardPage = page === SHOP_PAGE.cards;

  // ── 底图 + 老板娘 ──
  drawAnchored(ctx, shopSprite(sprite, SHOP_CHUNK.bg[page]), 0, 0);
  drawAnchored(
    ctx,
    shopSprite(sprite, SHOP_CHUNK.keeper[page]),
    SHOP_KEEPER_AT.x,
    SHOP_KEEPER_AT.y,
  );

  // 老板娘脸上的小动作 —— 紧跟着她画（原版也是这一段），不透明整块盖上去
  if (d.blink !== undefined && d.blink !== null) {
    const at = SHOP_BLINK_AT[page];
    drawAnchored(ctx, shopSprite(sprite, d.blink.face), at.face.x, at.face.y);
    if (d.blink.mouth !== 0) {
      drawAnchored(
        ctx,
        shopSprite(sprite, d.blink.mouth),
        at.mouth.x,
        at.mouth.y,
      );
    }
  }

  // ── 货架栏 + 栏上的货名与价格 ──
  drawAnchored(
    ctx,
    shopSprite(sprite, SHOP_CHUNK.panel[page]),
    d.panelX,
    SHOP_PANEL_Y,
  );
  for (let row = 0; row < d.shelf.length; row++) {
    const it = d.shelf[row];
    if (it === undefined) continue;
    const at = shelfRowTextAt(page, row);
    shopText(ctx, it.name, d.panelX + at.nameX, SHOP_PANEL_Y + at.nameY, 'center', 'middle');
    shopText(ctx, `$${it.price}`, d.panelX + at.priceX, SHOP_PANEL_Y + at.priceY, 'right', 'top');
  }

  // ── 右下 5×3 格 ──
  const gridBase = sprite(
    'Panel.mkf',
    SHOP_GRID_RESOURCE,
    SHOP_GRID_CHUNK[cardPage ? 'cards' : 'tools'],
    false,
  );
  drawAnchored(ctx, gridBase, d.gridX, SHOP_GRID_Y);

  /** 一格左上角的屏幕坐标（格子底图已滑到位时的**相对**位置，另加 gridX）*/
  const cellAt = (slot: number): { x: number; y: number } => ({
    x: d.gridX + SHOP_CELL_ORIGIN.x + (slot % SHOP_CELL.cols) * SHOP_CELL.w,
    y: SHOP_GRID_Y + SHOP_CELL_ORIGIN.y + Math.floor(slot / SHOP_CELL.cols) * SHOP_CELL.h,
  });

  /** 画一格的内容（卡片只画名、道具画图标 + 数量）*/
  const paintCell = (e: ShopCellEntry, x: number, y: number): void => {
    if (cardPage) {
      shopText(
        ctx,
        SHOP_LABELS.get(e.id) ?? '',
        x + SHOP_CELL_LOCAL.cardDx,
        y + SHOP_CELL_LOCAL.cardDy,
        'center',
        'middle',
      );
      return;
    }
    // 道具图标 = 资源 11 图「槽 + 2」，锚点由原图给出
    drawAnchored(
      ctx,
      sprite('Panel.mkf', SHOP_GRID_RESOURCE, SHOP_ICON_FIRST + (e.id - 1), true),
      x + SHOP_CELL_LOCAL.iconDx,
      y + SHOP_CELL_LOCAL.iconDy,
    );
    shopText(ctx, `×${e.count}`, x + SHOP_CELL_LOCAL.countDx, y + SHOP_CELL_LOCAL.countDy, 'right', 'top');
  };

  for (const e of d.cells) {
    const { x, y } = cellAt(e.slot);
    paintCell(e, x, y);
  }

  // ★ 按下自己那一格：整格内容右下各移 1px，再把上边与左边压暗（见 `SHOP_CELL_PRESS`）
  //
  // ⚠️ 效果是作用在**那一格的矩形**上的，与「里面还剩什么」无关 —— 卖出去之后格子已经空了，
  //   原版照样把那一格压一下（它压的就是屏幕上那 78×54 个像素）。
  const pressed = d.pressedCell ?? null;
  if (pressed !== null && pressed >= 0 && pressed < SHOP_SLOTS) {
    const { x, y } = cellAt(pressed);
    const { shift, edge, edgeAlpha } = SHOP_CELL_PRESS;
    ctx.save();
    // ★ 裁到这一格：移出去的那 1px 不能糊到隔壁格上（原版也从不写矩形之外）
    ctx.beginPath();
    ctx.rect(x, y, SHOP_CELL.w, SHOP_CELL.h);
    ctx.clip();
    // 连底图那一块一起挪 —— 原版挪的是已经画好的像素
    if (gridBase !== null) {
      ctx.drawImage(
        gridBase.bitmap,
        SHOP_CELL_ORIGIN.x + (pressed % SHOP_CELL.cols) * SHOP_CELL.w,
        SHOP_CELL_ORIGIN.y + Math.floor(pressed / SHOP_CELL.cols) * SHOP_CELL.h,
        SHOP_CELL.w,
        SHOP_CELL.h,
        x + shift,
        y + shift,
        SHOP_CELL.w,
        SHOP_CELL.h,
      );
    }
    const still = d.cells.find((e) => e.slot === pressed);
    if (still !== undefined) paintCell(still, x + shift, y + shift);
    // 空出来的上边一条与左边一条压暗（−16 那张换算表 = 每个 5 位分量减半）
    ctx.globalAlpha = edgeAlpha;
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, SHOP_CELL.w, edge);
    ctx.fillRect(x, y, edge, SHOP_CELL.h);
    ctx.restore();
  }

  // ── 滑入到位后才有的两个钮 ──
  if (d.panelX === SHOP_SLIDE.panelTo && d.gridX === SHOP_SLIDE.gridTo) {
    const sw = d.pressed === 'switch' ? SHOP_CHUNK.switchOff[page] : SHOP_CHUNK.switchOn[page];
    drawAnchored(ctx, shopSprite(sprite, sw), SHOP_SWITCH_AT.x, SHOP_SWITCH_AT.y);
    drawAnchored(
      ctx,
      shopSprite(sprite, d.pressed === 'exit' ? SHOP_FIXED_CHUNK.exitOff : SHOP_FIXED_CHUNK.exitOn),
      SHOP_EXIT_AT.x,
      SHOP_EXIT_AT.y,
    );
  }

  // ── 點數 ──
  drawAnchored(
    ctx,
    shopSprite(sprite, SHOP_FIXED_CHUNK.pointsPlate),
    SHOP_POINTS.plateX,
    SHOP_POINTS.plateY,
  );
  shopText(ctx, String(d.points), SHOP_POINTS.textX, SHOP_POINTS.textY, 'right', 'top');

  // ── 气泡（最后画，压在老板娘身上）──
  if (d.bubble === null) return;
  const b = shopSprite(sprite, SHOP_FIXED_CHUNK.bubble);
  drawAnchored(ctx, b, SHOP_BUBBLE_AT.x, SHOP_BUBBLE_AT.y);
  const cx = SHOP_BUBBLE_AT.x + (b?.width ?? 270) / 2 + SHOP_BUBBLE_TEXT.dx;
  const cy = SHOP_BUBBLE_AT.y + Math.trunc((b?.height ?? 219) / 2) + SHOP_BUBBLE_TEXT.dy;
  const lines = d.bubble.split('\n').filter((l) => l !== '');
  const lh = SHOP_BUBBLE_TEXT.size + 6;
  ctx.font = `${SHOP_BUBBLE_TEXT.size}px ${SHOP_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101010';
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * lh);
  });
}

/** 卡名表（`@rich4/data` 的 `CARDS` 是 1 基，做成按卡片号直接取） */
const SHOP_LABELS: ReadonlyMap<number, string> = new Map(CARDS.map((c) => [c.id, c.name]));

// ============================================================
//  气泡与关门（纯判据）—— E-21：道别气泡被点掉之后店永远不关
// ============================================================

/**
 * 气泡还在（或正在关门）时点了一下，气泡该变成什么。
 *
 * @source `loc_0042de09`：`cmp [0x48c318],3 / je 正常命中`，否则 `push 1 / call fcn_0044ee18`
 *   —— **提前收掉限时訊息框**，别的都不做。框一收，挂在它后面的流程照常推进
 *   （关门那一路：状态 2→3→4，`loc_0042e686`）。
 *
 * ⇒ 关门中：把道别那一句**改成立刻到期**（`until = 0`），由 `shopTick` 走同一条关门路；
 *   不在关门：直接收掉（`null`），没有后续。
 */
export function shopBubbleAfterClick<T extends { until: number }>(bubble: T | null, closing: boolean): T | null {
  if (!closing || bubble === null) return null;
  return { ...bubble, until: 0 };
}

/**
 * `shopTick` 这一帧该不该走「气泡收场」那一支。
 *
 * ★ `closing && bubble === null` 也算到期 —— 兜底：任何一条路把道别气泡弄没了，门照样要关
 *   （先前的卡死形态正是这个）。
 */
export function shopBubbleExpired(bubble: { until: number } | null, closing: boolean, now: number): boolean {
  if (bubble === null) return closing;
  return now >= bubble.until;
}

