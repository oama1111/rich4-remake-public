/*
 * 每月結算 + 頒獎屏 —— T-041 / U-15 / MOD-12
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一屏在 core 里**没有待决交互**：月结是 `advanceGameDay` 自己跑的
 *   （`reduce.ts` 的 `if (newMonth) settleMonthlyBank(...)`），玩家一次也插不上手。
 *   所以本模块是**回放这次月结**的演出：`event(before, after, env)` 察觉
 *   「刚刚跨了一个月」，从 before/after 的 diff 反推摘要，播完自己关。
 *   与 `magic-screen.ts`（T-037）同一套路。
 *
 * ## 原版是**一个模态过程里的两台屏** @source `fcn_00439bfa`（VA 0x00439bfa）
 *
 * ```asm
 * 00439bfa  read_mkf(panel_mkf, 0x19, 0, 0)     ; ★ 素材 = Panel.mkf #25
 *           blit(图 0, 0, 0)                     ; (0,0)
 *           blit(图 1, 0x18, 0x46)               ; 「存款」气泡 → (24,70)
 *           create_font(0x12, 0x101010, 0, 2, 0) ; 18 号白字
 *           fcn_0044ec30(图 1, 0xbe, 0x0a, 0, -0x1e, 0x101010, 0)
 *           Wait_0402_Message(fcn_00437e61, 0)   ; ★ 等一次点击 → 进頒獎屏
 *           fcn_00437e61(…)                      ; 頒獎屏窗口过程
 *           ; 收尾：把每个人的 +0x42/+0x5c/+0x60 清零
 * ```
 *
 * ## 第一屏：结算（`loc_00439cd7` 的循环，VA 0x00439cd7..0x00439e5b）
 *
 * 先把在场玩家按下标填进 `[0x48c418]`（`loc_00439caa`，`cmp byte [p+0x15],0`
 * 跳过出局者），再**逐个玩家画一行**：
 *
 * | 画什么 | 落点 | 取数 | @source |
 * |---|---|---|---|
 * | 头像 = 图 `3×角色+47+帧` | `(列x, 330 − h[帧] + y[帧])` | `player+0x13` | 0x00439cbf |
 * | `1`..`4` 那颗球 = 图 `6+帧` | `(列x, 10)` | 帧 = `[0x475960 + 玩家*24]` | 0x00439d02 |
 * | 玩家名 | 气泡局部 `(0x2d, 46+70i)` | 名字表 | 0x00439d0d |
 * | 现金 | 气泡局部 `(0x14, 46+70i)` flag 1 | `player+0x1c` | 0x00439d23 |
 * | 存款额 | 气泡局部 `(0x4c, 132+70i)` flag 1 | `player+0x20` | 0x00439d3c |
 * | 利息 / `貸款中`（红）| 气泡局部 `(0x4c, 230+70i)` flag 1 | `trunc(存款×0.1)` | 0x00439e10 |
 *
 * ⚠️ `存款：` 与 `利息：` 两个标签（串 `0x464e56` / `0x464e90`）在原版里
 *   **烤进图 1 / 图 2**，代码不重画 —— 但资源 25 那张「存款」气泡的下半
 *   是一片空白（逐张核过），所以本模块**自己把两个标签写上去**，位置与串一致。
 *   见 `docs/deviations/T-041.md` 的 D-MONTHLY-3。
 *
 * ⚠️ 行首那一列的 x 取 `MONTHLY_SEAT_X` = `{60,180,300,420}` —— 那是
 *   頒獎屏 `0x475918` 那张 **4 列网格**表；结算屏自己那张表在 exe 里
 *   读不出（该段不是普通 word 表），见 D-MONTHLY-1。两支列间距一致。
 *
 * ## 第二屏：頒獎（`fcn_00437e61` 的状态机 @source VA 0x00437e61）
 *
 * 两个入口都从 `[0x48c42a] = 0` 起：`WM_TIMER(0x113)` 与 `WM_USER+5(0x405)`。
 * `SetTimer(hwnd, 0x32, timer, 0)` = **50ms** 一拍，状态机每拍走一步：
 *
 * | 状态 | 做什么 | @source |
 * |---|---|---|
 * | 0 | 只画结算屏（全部行）| 0x0043802c 附近 |
 * | 1 | 把图 1 在 `(70,24)` 那块 **70×24** 原样盖到 `(24,70)`（裁切拷贝，非缩放）| 0x00437fff |
 * | 2 | `fcn_00437c25` 重画全部行 | 0x004380d5 |
 * | 5 | 每 **20 拍**（1 秒）点亮一行（`[0x48c425] == 0x14` → `fcn_00437c25`）| 0x0043829c |
 * | 6 | 30 拍后评獎（`fcn_00437d1a` + `fcn_00437dfe`）| 0x004382de |
 * | 7 | 铺 **4 列竖栏**（图 15..18）+ **4 块窄板**（图 11..14）+ `loc_0043849e` 的逐列头像 | 0x004383dc |
 * | 8 | 每 2 拍多叠一条详情 | 0x00438570 |
 * | 9 | 每 2 拍：獲獎者的 **FLIC 动画** + SOP 串 | 0x0043889e |
 * | 15 | 无人获奖：结算屏 + `別灰心，再加油喔！` | 0x00438a31 |
 * | 0x11..0x16 | 收尾：`本月冠軍是` / `本月悲情人物是` + 音效 + 关屏 | 0x00438a78 |
 *
 * ⚠️ 状态 6/7/8/9 **每一拍都把「结算屏 + 前面几步」整块重画再叠新的**
 *   （原版每拍从图 0 重画整个区域），故本模块也按「累积叠加」绘制。
 *
 * ### 頒獎屏那 4 块窄板的落点 @source `loc_0043849e`（VA 0x0043849e..0x00438518）
 *
 * ```asm
 * 图像 = [0x475948 + 槽*24 + 帧*2]   ; 帧 = [0x475948 + 槽*24] 的第 0 项
 * x    = [0x475918 + 槽*24 + 帧*2]   ; ★ 与上面同一张表，拿帧再查一次
 * 落点 = (x, 0x11)                    ; push 0x11 = 17
 * ```
 *
 * | 槽 | 帧 | 图像 | 尺寸 | 落点 x |
 * |---|---|---|---|---|
 * | 0 | 16 | 11 | 160×71 | 16 |
 * | 1 | 17 | 12 | 159×71 | 17 |
 * | 2 | 15 | 13 | 159×71 | 15 |
 * | 3 | 16 | 14 | 159×71 | 16 |
 *
 * ### 頒獎屏 4 列 @source `loc_0043849e` / `loc_004387f9`
 *
 * ```asm
 * 帧   = [0x475960 + 槽*24 + 槽*2]    ; ★ 拿**槽号**再查一次表 E
 * 图像 = 3×角色 + 47 + 帧
 * x    = {60,180,300,420}[槽]          ; 0x475978 的 4 项
 * y    = 330 − h[帧] + y[帧]           ; 0x14a = 330
 * ```
 * 表 E 读出 `{16,17,15,16}`；头像是 `Panel#25` 的 `3×角色+47+帧`，
 * 那三帧的 `height`/`y` 是 `(72,36)` → `y = 330 − 72 + 36 = 294`。
 *
 * ### 頒獎屏的详情（状态 8，VA 0x00438570 起）
 *
 * 每列画一组：**首富的资产 / 獲獎者的现金 / `+0x60` / `+0x5c` / `+0x42`**，
 * 五条标签在串表 `0x464e5e` / `0x464e50` / `0x464def` / `0x464dfe` / `0x464e0d`：
 * `資產：` / `現金：` / `本月意外損失：` / `本月意外之財：` / `本月倒楣天數：`。
 *
 * ### 收尾那一句与名字念白
 *
 * `本月冠軍是．．。` @source 串 `0x464e3a`；`本月悲情人物是．．。`
 * @source 串 `0x464dca`。两句后面各接一个**念白串**：`0x464c30` 起
 * 连续 24 条（`#0096約翰喬` … `#0121金貝貝`）—— `[0x48c42f] == -1`
 * 时用后半 12 条（悲情），否则用前半（冠军）。本模块只写角色名，不放语音。
 */

import {
  allEffectiveFacilities,
  allEffectiveLands,
  calculatePlayerWealth,
  isAlive,
  type GameState,
  type MapTopology,
  type Player,
} from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';
import { currency } from './panel.ts';
import { FONT_FAMILY } from './font.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type MonthlySprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 本屏素材 = `Panel.mkf` **#25** @source 0x00439c04 `push 0x19` */
export const MONTHLY_RESOURCE = 25;

/**
 * 图号 —— 逐张看过 `assets-clean/Panel/0025_*.png`（83 张）之后落的表。
 *
 * | 图 | 尺寸 | 是什么 | @source |
 * |---|---|---|---|
 * | 0 | 640×480 | 整屏底图（`大富翁4` 底纹 + 四角铃铛）| 0x00439c1f |
 * | 1 | 290×201 | 「存款」气泡（尾巴朝左下，下半是空白）| 0x00439c3a |
 * | 2 | 278×98 | 结算屏每行的小底板（锚点 (139,49)）| 0x00439d8f |
 * | 3 | 239×193 | 圆气泡（本屏未用）| — |
 * | 4 | 195×142 | 长条锦缎板（本屏未用）| — |
 * | 5 | 353×450 | 「MONEY」大板（本屏未用）| — |
 * | 19 | 186×410 | 记者小姐抱文件（本屏未用）| — |
 * | 6..9 | 43×75..63×83 | 3D 数字 **1 2 3 4** | 0x00439d02 |
 * | 10 | 26×16 | 金币（`$`）| 0x00439d1d |
 * | 11..14 | 160×71 / 159×71 | 頒獎屏的 4 块窄板 | 0x0043849e |
 * | 15..18 | 142×348 | 頒獎屏 4 列的竖栏底 | 0x004387f9 |
 * | 19..46 | — | 记者小姐立绘 / 头像（本屏不用）| — |
 * | 47..82 | 66×72..32×58 | **12 个角色的 3 帧头像** | 0x0043849e 尾 |
 */
export const MONTHLY_CHUNK = {
  bg: 0,
  /** 「存款」气泡 —— 状态 1 也拿它缩放着铺頒獎屏的区域 @source 0x0043800f */
  bubble: 1,
  /** 结算屏每行的小底板 @source 0x00439d8f */
  plate: 2,
  /** 3D 数字 `1`..`4` 的基址（图 `6+帧`）@source 0x00439d02 */
  digitFirst: 6,
  /** 金币 @source 0x00439d1d */
  coin: 10,
  /** 頒獎屏 4 块窄板的基址（图 `11..14`）@source 0x0043849e */
  barFirst: 11,
  /** 頒獎屏 4 列竖栏的基址（图 `15..18`）@source 0x004387f9 */
  columnFirst: 15,
  /** 12 个角色头像的基址（图 `3×角色 + 47 + 帧`）@source 0x00437c9f */
  avatarFirst: 47,
} as const;

/**
 * 头像**每角色 3 帧** @source `lea edx, [eax + 0x2f]`（VA 0x00437c9f）
 *   —— `eax = 角色×3`，`0x2f = 47`，故图号 = `3×角色 + 47 + 帧`。
 */
export const MONTHLY_AVATAR_STRIDE = 3;

/** 頒獎屏 / 结算屏的槽数（4 位玩家）@source 0x0043849e 的 `x ∈ [0,3]` */
export const MONTHLY_SLOTS = 4;

/**
 * 頒獎屏**窄板**的帧 @source VA 0x00475948
 *   （`movsx eax, word [槽×8 + 帧×2 + 0x475948]`，即 24 字节一槽的**第 0 项**）
 */
export const MONTHLY_BAR_FRAME = [16, 17, 15, 16] as const;

/**
 * 頒獎屏**窄板的落点 x** @source VA 0x00475918
 *   —— `loc_0043849e` 拿 `MONTHLY_BAR_FRAME[槽]` 当**下标**再查一次这张表。
 *
 * 这张表的第 0..3 项正好就是 `{16,17,15,16}`，所以「帧」与「x」逐槽同值；
 * 但**不能**把帧直接当 x 用（表一旦变长就会错位），故本模块分开写。
 */
export const MONTHLY_BAR_X = [16, 17, 15, 16] as const;

/** 頒獎屏窄板的 y @source 0x0043849e `push 0x11` */
export const MONTHLY_BAR_Y = 0x11;

/**
 * 頒獎屏 / 结算屏 4 列的 **x** @source VA 0x00475978
 *   `loc_0043849e` 的 `movsx edi, di` 之后 `push edi`；表里是 60/180/300/420。
 */
export const MONTHLY_SEAT_X = [60, 180, 300, 420] as const;

/**
 * 頒獎屏 4 列的**帧** @source VA 0x00475960
 *   （`movsx edx, word [帧×8 + 槽×2 + 0x475960]`）
 *
 * 结算屏走的是同一条计算（`loc_00439cbf` 的 `[edi + offset + 0x475960]`），
 * 只是它拿**玩家下标**当槽号 —— 4 人局里两者同值，故本模块共用这一张表。
 */
export const MONTHLY_SEAT_FRAME = [16, 17, 15, 16] as const;

/**
 * 頒獎屏 4 列头像的 y 基准 @source 0x004384b7 `mov edi, 0x14a`（= **330**）
 *
 * 原版随后 `sub di, word [头像 + 0x0e]` / `add di, word [头像 + 0x12]` ——
 * `+0x0e` 是 `graph_st->height`、`+0x12` 是 `graph_st->y`，读的正是
 * **头像那一张**（`loc_0043849e` 里 `lea eax, [edx + ecx]`、`ecx = 帧×36`）。
 *
 * 三帧都是 `(h, y) = (72, 36)` → 落点 `y = 330 − 72 + 36 = 294`。
 */
export const MONTHLY_SEAT_BASE_Y = 0x14a;

/**
 * 那三帧头像各自的 `{组内偏移, height, y}`。
 *
 * 帧号是 `[0x475960]` 查出来的**组内下标**，图号 = `3×角色 + 47 + 帧`；
 * 三个帧的 `graph_st` 字段（VA 0x004384b7 的 `+0x0e` = height / `+0x12` = y）逐帧核过：
 *
 * | 帧 | 图 | 尺寸 | 锚点 | height | y |
 * |---|---|---|---|---|---|
 * | 15 | `3c+49` | 65×72 | (33,36) | 72 | 36 |
 * | 16 | `3c+48` | 66×72 | (33,36) | 72 | 36 |
 * | 17 | `3c+47` | 66×72 | (33,36) | 72 | 36 |
 */
export const MONTHLY_AVATAR_FRAME: Readonly<
  Record<number, { h: number; y: number }>
> = {
  15: { h: 72, y: 36 },
  16: { h: 72, y: 36 },
  17: { h: 72, y: 36 },
};

/**
 * 頒獎屏**状态 1** 贴的那一小块 —— 它**不是缩放**，是带裁切的整块拷贝。
 *
 * @source `loc_00437fff` 的 `fcn_0045643d`（VA 0x0045643d，走 `draw_image_in_rect_ex`）：
 * ```asm
 * push 0x19a / push 0xba / push 0x46 / push 0x18 / push 0x46 / push 0x18 / …
 * ```
 * 参数序是 `(dst, src, x, y, x_move, y_move, init_copy_width, init_copy_height, …)`，
 * 故 `x = 0x46`、`y = 0x18`、**拷贝尺寸 = 0x46 × 0x18 = 70 × 24**。
 * 也就是「把图 1 落在 (70,24) 处那块 70×24 的内容原样盖到 (24,70)」。
 *
 * ⚠️ 先前（以及旧注释）把 `0x18/0x46` 读成目的地矩形、`0x19a/0xba` 读成尺寸，
 *   那是**读反了** —— `x_move`/`y_move` 才是后两个数。见 deviations D-MONTHLY-4。
 */
export const MONTHLY_AWARD_PATCH = {
  /** 源落点（图 1 局部坐标）*/
  srcX: 0x46,
  srcY: 0x18,
  /** 拷贝尺寸 */
  w: 0x46,
  h: 0x18,
  /** 目的地落点（= 「存款」气泡那一点）*/
  dstX: 0x18,
  dstY: 0x46,
} as const;

/** 「存款」气泡落点 @source 0x00439c3a `push 0x46 / push 0x18` */
export const MONTHLY_BUBBLE_AT = { x: 0x18, y: 0x46 } as const;

/** 结算屏每行的 y 间距 @source 0x00439d0d 起：`46 + 70×i` */
export const MONTHLY_ROW_STEP = 70;

/** 结算屏每行各元素的**气泡局部**落点 @source 0x00439d0d / 0x00439d23 / 0x00439d3c / 0x00439e10 */
export const MONTHLY_ROW_AT = {
  /** 玩家名（flag 0 = 左上）—— 原版把它画在小底板上 */
  name: { dx: 0x2d, dy: 0x2e },
  /** 现金（flag 1 = 右上；左边的金币图同落点）*/
  cash: { dx: 0x14, dy: 0x2e },
  /** 存款额（flag 1）*/
  bank: { dx: 0x4c, dy: 0x84 },
  /** `利息：` 标签与利息额 / `貸款中`（flag 1）*/
  interest: { dx: 0x2e, dy: 0xe6 },
  interestValue: { dx: 0x4c, dy: 0xe6 },
} as const;

/**
 * 逐行「点亮」的节拍 @source 0x0043829c
 *   `SetTimer(hwnd, 0x32, timer, 0)` = 50ms 一拍；`[0x48c425] == 0x14`（20 拍 = 1 秒）亮下一行。
 */
export const MONTHLY_TICK_MS = 50;
export const MONTHLY_REVEAL_TICKS = 0x14;
/** 结算屏全亮后再等 `[0x48c425] == 0x1e`（30 拍）才评獎 @source 0x004382c8 */
export const MONTHLY_SETTLE_TICKS = 0x1e;

/** 字号 @source 0x00439c46 `create_font(0x12, 0x101010, 0, 2, 0)` */
export const MONTHLY_FONT_SIZE = 0x12;
/** 字色：白字 / 红字（`貸款中`）@source 0x00439dd4 `push 0xff0000` */
export const MONTHLY_TEXT = { fill: '#ffffff', loan: '#ff0000', stroke: '#101010' } as const;

/** 结算屏两个标签（原版烤进图 2，本模块补写）@source 串 `0x464e56` / `0x464e90` */
export const MONTHLY_LABELS = { bank: '存款：', interest: '利息：', loan: '貸款中' } as const;

/** 頒獎屏状态 8 那五条详情标签 @source 串 `0x464e5e` / `0x464e50` / `0x464def` / `0x464dfe` / `0x464e0d` */
export const MONTHLY_DETAIL_LABELS = {
  assets: '資產：',
  cash: '現金：',
  unexpectedLoss: '本月意外損失：',
  unexpectedGain: '本月意外之財：',
  unluckyDays: '本月倒楣天數：',
} as const;

/** 无人获奖那句 @source 串 `0x464e26` */
export const MONTHLY_NO_AWARD = '別灰心，再加油喔！';
/** 收尾两句 @source 串 `0x464e3a` / `0x464dca` */
export const MONTHLY_CHAMPION = '本月冠軍是';
export const MONTHLY_TRAGIC = '本月悲情人物是';

/**
 * 頒獎屏状态 8 那 5 条详情的屏幕 y @source 0x00438570 起逐个 `push 0x172`…
 *   （0x172=370、0x184=388、0x196=406、0x1a8=424、0x1ba=442，行距 0x12 = 18）
 */
export const MONTHLY_DETAIL_AT = { x: 0x140, valueX: 0x230, y0: 0x172, step: 0x12 } as const;

// ============================================================
//  月结摘要（纯函数：before → after 的 diff）
// ============================================================

/** 一名玩家这一屏上的一行 */
export interface MonthlyRow {
  /** 玩家下标 0..3（= `players` 下标）*/
  index: number;
  /** 角色号 0..11 */
  character: number;
  /** 角色名（`CHARACTERS[character].name`）*/
  name: string;
  /** 结算**后**的现金 @source `player + 0x1c` */
  cash: number;
  /** 结算**后**的存款 @source `player + 0x20` */
  bank: number;
  /** 这一笔月息的增量（`after.bank − before.bank`）@source `[0x464e88]` = 1.1 */
  interest: number;
  /** 结算后的贷款 @source `player + 0x24`；非 0 时那一行画红字 `貸款中` */
  loan: number;
  /** 本月支出 @source `player + 0x5c`（原版结算完清零，故只有 diff 拿得到）*/
  monthlyPaid: number;
  /** 本月收入 @source `player + 0x60` */
  monthlyReceived: number;
}

/** 这一次月结的摘要 */
export interface MonthlyView {
  /** 在场玩家，**按 `players` 序**（原版 `loc_00439caa` 就是按这个序填 `[0x48c418]`）*/
  readonly rows: readonly MonthlyRow[];
}

/**
 * 这一次月结的摘要 —— **纯函数**，只读 `before` / `after`。
 *
 * 在场判定照原版 `cmp byte [player + 0x15], 0 / je 跳过`（VA 0x00439c93）。
 * 利息取**存款增量**：`settleMonthlyBank`（`rules/monthly.ts`）已经在
 * `advanceGameDay` 里落地，`after.bank − before.bank` 就是这一笔
 * （原版同一屏上写的是 `trunc(存款 × 0.1)`，`@source 0x00439e10` 的 `[0x464ea0]`）。
 *
 * ⚠️ 「本月收入 / 本月支出」在原版**这一屏上不显示**（那一屏只有现金 /
 *   存款 / 利息），它们只出现在頒獎屏的详情里。本摘要照样带上，
 *   供頒獎屏与单测用。
 */
export function monthlySummary(before: GameState, after: GameState): MonthlyView {
  const rows: MonthlyRow[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const a = after.players[i];
    if (a === undefined || !isAlive(a)) continue;
    const b = before.players[i];
    rows.push({
      index: i,
      character: a.character,
      name: CHARACTERS[a.character]?.name ?? `玩家${i + 1}`,
      cash: a.cash,
      bank: a.moneyInBank,
      interest: a.moneyInBank - (b?.moneyInBank ?? a.moneyInBank),
      loan: a.loan,
      monthlyPaid: a.monthlyPaid,
      monthlyReceived: a.monthlyReceived,
    });
  }
  return { rows };
}

// ============================================================
//  頒獎（纯函数）
// ============================================================

/** 頒獎屏 4 块窄板里各画什么（照 `loc_0043849e` 的槽序）*/
export type MonthlyBarKind = 'assets' | 'cash' | 'unexpectedLoss' | 'unexpectedGain';

export const MONTHLY_BARS: readonly MonthlyBarKind[] = [
  'assets',
  'cash',
  'unexpectedLoss',
  'unexpectedGain',
];

/** 頒獎屏要显示什么 */
export interface MonthlyAward {
  /** 获奖者在 `state.players` 里的下标；`-1` = 无人获奖（原版 `[0x48c42f] = 0xff`）*/
  winner: number;
  /** 获奖者的 role 分 */
  score: number;
  /** 亚军分（判「领先 0.4 倍以上」用）*/
  second: number;
  /** 本月首富（`calculatePlayerWealth` 最大者）在 `state.players` 里的下标 */
  richest: number;
  /** 4 块窄板里各画什么 */
  bars: readonly MonthlyBarKind[];
}

/**
 * 月度 role 分 @source `fcn_00437d1a` VA 0x00437d1a
 *
 * ```asm
 * score = (player+0x5c − player+0x60)              ; 本月支出 − 本月收入
 *       + totalWinterSleepDays × 物价指数 × 0x9c4  ; 2500
 *       + misfortune × 10
 * ```
 *
 * ★ 与 `core/rules/monthly.ts` 的 `monthlyScore` **同一条**；那边收
 *   `MonthlyAccumulators`（`windfall` = `monthlyPaid`、
 *   `unexpectedLoss` = `monthlyReceived`、`f42` = `totalWinterSleepDays`、
 *   `f68` = `misfortune`），这里直接取 `Player` 字段。
 */
export function awardScore(p: Player, priceIndex: number): number {
  return (
    p.monthlyPaid -
    p.monthlyReceived +
    p.totalWinterSleepDays * priceIndex * 2500 +
    p.misfortune * 10
  );
}

/**
 * 评獎 @source `fcn_00437d1a` 尾（VA 0x00437dc9）
 *
 * 取最高分者；`(最高 − 次高) / 最高 > 0.4` 才颁奖。
 * **最高分为 0 或次高分为 0 → 无人获奖**（`test ecx,ecx / je` 与
 * `test ebx,ebx / je`）—— 故只有一个人在场时同样不颁奖。
 *
 * ⚠️ 次高分的定义是原版那一步：**把等于最高分的项全部清零，再取剩余最大**
 *   （`loc_00437d9d` 的 `cmp ecx, [esp+edx] / jne / xor esi,esi`）。
 *   所以两人同分时 `second === max === 0`（清零后没有剩余）→ **不颁奖**；
 *   三人 `100/100/10` 时清零两个 100 → `second = 10` → 颁奖给先出现的那个。
 *
 * @returns 获奖者在 `scores` 里的下标；无人获奖返回 `-1`
 */
export function pickAward(scores: readonly number[]): number {
  let max = 0;
  let maxAt = 0;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i]!;
    if (max < v) {
      max = v;
      maxAt = i;
    }
  }
  let second = 0;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i] === max ? 0 : scores[i]!;
    if (second < v) second = v;
  }
  if (max === 0 || second === 0) return -1;
  // 原版是 x87 浮点 `(max − second) / max > 0.4`；这里用等价整数比较
  //   ⟺ 3·max > 5·second（与 core 的 pickAwardWinner 同一条注释）
  return 3 * max > 5 * second ? maxAt : -1;
}

/**
 * 本月首富 @source `fcn_00437dfe` VA 0x00437dfe
 *   —— 逐人 `calculatePlayerWealth`（`_rich4_calculate_player_wealth` @ 0x004239b9），
 *   取最大者；平手取先出现的（原版 `cmp esi,eax / jge` 跳过替换）。
 */
export function pickRichest(
  state: GameState,
  topo: MapTopology,
  present: readonly number[],
): number {
  const lands = allEffectiveLands(state, topo);
  const facilities = allEffectiveFacilities(state, topo);
  let best = 0;
  let at = present[0] ?? 0;
  for (const i of present) {
    const p = state.players[i];
    if (p === undefined) continue;
    const w = calculatePlayerWealth(p, lands, facilities, valuationsOf(state, i));
    if (best < w) {
      best = w;
      at = i;
    }
  }
  return at;
}

/** 持仓估值（`market.stocks[i].price` 配持股数）@source `_rich4_calculate_player_wealth` */
function valuationsOf(state: GameState, playerIndex: number): { amount: number; price: number }[] {
  const held = state.holdings[playerIndex];
  if (held === undefined) return [];
  return held.map((h, i) => ({ amount: h.amount, price: state.market.stocks[i]?.price ?? 0 }));
}

/**
 * 算这一次頒獎屏要显示的东西 —— **纯函数**。
 *
 * 无人获奖时 `winner = -1`（原版 `[0x48c42f] = 0xff`），走
 * `別灰心，再加油喔！` 那一支（状态 15 与收尾那一段）。
 */
export function monthlyAward(before: GameState, after: GameState, topo: MapTopology): MonthlyAward {
  const present = after.players.filter((p) => isAlive(p)).map((p) => p.index);
  const scores = present.map((i) => {
    const p = after.players[i];
    return p === undefined ? 0 : awardScore(p, after.priceIndex);
  });
  const at = present.length === 0 ? -1 : pickAward(scores);
  const sorted = [...scores].sort((a, b) => b - a);
  return {
    winner: at < 0 ? -1 : (present[at] ?? -1),
    score: at >= 0 ? (scores[at] ?? 0) : 0,
    second: sorted[1] ?? 0,
    richest: present.length === 0 ? 0 : pickRichest(after, topo, present),
    bars: MONTHLY_BARS,
  };
}

// ============================================================
//  版面（纯函数：state → 行）
// ============================================================

/** 一行在舞台上的落点（气泡**局部**已换算成屏幕坐标）*/
export interface MonthlyRowLayout {
  /** 玩家下标 */
  index: number;
  /** 头像左上角 + 图号 */
  avatar: { x: number; y: number; chunk: number };
  /** `1`..`4` 那颗球左上角 + 图号 */
  digit: { x: number; y: number; chunk: number };
  name: { x: number; y: number };
  coin: { x: number; y: number };
  cash: { x: number; y: number };
  bank: { x: number; y: number };
  interestLabel: { x: number; y: number };
  interestValue: { x: number; y: number };
  /** 那一行小底板（图 2）的左上角 */
  plate: { x: number; y: number };
}

/**
 * 一行的摆位 —— **纯函数**，单测钉的就是它。
 *
 * `playerIndex` 同时是**行号**与 `players` 下标（原版 `[0x48c418]` 就是按序填的）。
 *
 * 头像的 y 走原版那一步 `330 − h[帧] + y[帧]`（`帧 = MONTHLY_SEAT_FRAME[行]`），
 * 数字球固定在 y = 10（`@source 0x00439d02` 的 `push 0xa`）。
 */
export function monthlyRowLayout(state: GameState, playerIndex: number): MonthlyRowLayout {
  const p = state.players[playerIndex];
  const character = p?.character ?? 0;
  const slot = Math.min(Math.max(playerIndex, 0), MONTHLY_SLOTS - 1);
  const frame = MONTHLY_SEAT_FRAME[slot] ?? 0;
  const size = MONTHLY_AVATAR_FRAME[frame] ?? { h: 0, y: 0 };
  const x = MONTHLY_SEAT_X[slot] ?? 0;
  const dy = playerIndex * MONTHLY_ROW_STEP;
  const at = (o: { dx: number; dy: number }): { x: number; y: number } => ({
    x: MONTHLY_BUBBLE_AT.x + o.dx,
    y: MONTHLY_BUBBLE_AT.y + o.dy + dy,
  });
  const cash = at(MONTHLY_ROW_AT.cash);
  return {
    index: playerIndex,
    avatar: {
      x,
      y: MONTHLY_SEAT_BASE_Y - size.h + size.y,
      chunk: MONTHLY_AVATAR_STRIDE * character + MONTHLY_CHUNK.avatarFirst + frame,
    },    digit: { x, y: 10, chunk: MONTHLY_CHUNK.digitFirst + frame },
    name: at(MONTHLY_ROW_AT.name),
    coin: { ...cash },
    cash,
    bank: at(MONTHLY_ROW_AT.bank),
    interestLabel: at(MONTHLY_ROW_AT.interest),
    interestValue: at(MONTHLY_ROW_AT.interestValue),
    plate: at(MONTHLY_ROW_AT.name),
  };
}

/** 结算屏那一行要写的文字 */
export interface MonthlyRowText {
  name: string;
  cash: string;
  bankLabel: string;
  bank: string;
  interestLabel: string;
  /** `貸款中` 或利息 */
  interest: string;
  /** 这一行是不是红字（有贷款）*/
  loan: boolean;
}

/**
 * 结算屏一行的**文字** —— 纯函数，快照钉住。
 *
 * 数字一律走 `num_to_currency_string`（带千分位的 `$` 前缀，VA 0x00452793），
 * 与 `panel.ts` 的 `currency()` 同一套。
 */
export function monthlyRowText(row: MonthlyRow): MonthlyRowText {
  return {
    name: row.name,
    cash: currency(row.cash),
    bankLabel: MONTHLY_LABELS.bank,
    bank: currency(row.bank),
    interestLabel: MONTHLY_LABELS.interest,
    interest: row.loan !== 0 ? MONTHLY_LABELS.loan : currency(row.interest),
    loan: row.loan !== 0,
  };
}

/** 頒獎屏详情的一行 */
export interface MonthlyDetailLine {
  label: string;
  value: string;
}

/**
 * 頒獎屏状态 8 的 5 条详情 —— 纯函数。
 *
 * | 行 | 标签 | 取数 | @source |
 * |---|---|---|---|
 * | 資產 | `資產：` | **首富**的 `calculatePlayerWealth` | 0x00438644 |
 * | 現金 | `現金：` | 獲獎者的 `player+0x1c` | 0x004386ab |
 * | 意外損失 | `本月意外損失：` | 獲獎者 `player+0x60` | 0x0043858f |
 * | 意外之財 | `本月意外之財：` | 獲獎者 `player+0x5c` | 0x0043861c |
 * | 倒楣天數 | `本月倒楣天數：` | 獲獎者 `player+0x42`，`sprintf("%d天")` | 0x0043868c |
 *
 * 无人获奖（`winner < 0`）时后四条没有对象，按 `$0` / `0天` 画。
 */
export function monthlyDetailLines(
  state: GameState,
  topo: MapTopology,
  award: MonthlyAward,
): readonly MonthlyDetailLine[] {
  const win = award.winner >= 0 ? state.players[award.winner] : undefined;
  const richP = state.players[award.richest];
  const assets =
    richP === undefined
      ? 0
      : calculatePlayerWealth(
          richP,
          allEffectiveLands(state, topo),
          allEffectiveFacilities(state, topo),
          valuationsOf(state, award.richest),
        );
  const L = MONTHLY_DETAIL_LABELS;
  return [
    { label: L.assets, value: currency(assets) },
    { label: L.cash, value: currency(win?.cash ?? 0) },
    { label: L.unexpectedLoss, value: currency(win?.monthlyReceived ?? 0) },
    { label: L.unexpectedGain, value: currency(win?.monthlyPaid ?? 0) },
    { label: L.unluckyDays, value: `${win?.totalWinterSleepDays ?? 0}天` },
  ];
}

// ============================================================
//  演出状态机
// ============================================================

/** 结算屏 / 頒獎屏 */
export type MonthlyPhase = 'settle' | 'award';

/** 这一刻屏幕上该出现什么 */
export interface MonthlyPlayback {
  phase: MonthlyPhase;
  /** 结算屏已经「点亮」到第几行（`players` 下标，含）*/
  revealed: number;
  /** 頒獎屏已经铺到第几块窄板（0 = 还没铺）*/
  bars: number;
  /** 頒獎屏已经画到第几列头像 */
  seats: number;
  /** 頒獎屏已经叠到第几条详情 */
  details: number;
  /** 颁完奖、等最后一次确认（原版 `[0x48c42a] = 0x11/0x16` 那几步）*/
  closing: boolean;
}

/** 从第 0 行开始（原版 `[0x48c42a] = 0` 那一状态）*/
export function monthlyPlaybackStart(): MonthlyPlayback {
  return { phase: 'settle', revealed: 0, bars: 0, seats: 0, details: 0, closing: false };
}

/**
 * 走一拍（原版 50ms 一拍）。
 *
 * ① **结算屏**每拍点亮一行（`loc_0043829c` 的 `0x14` 那一支）；
 * ② 全亮之后**停在等确认**（`[0x48c42a]` 不动），由 `down()`/`up()` 推进；
 * ③ **頒獎屏**：先铺 4 块窄板，再逐列画头像，再逐条叠详情；
 * ④ 全部叠完 → `closing`；再一拍返回 `null`（该关屏了）。
 *
 * @param rows 在场玩家数（决定结算屏点亮几行）
 * @returns 关屏返回 `null`
 */
export function monthlyPlaybackTick(p: MonthlyPlayback, rows: number): MonthlyPlayback | null {
  if (p.phase === 'settle') {
    if (p.revealed < Math.max(0, rows - 1)) return { ...p, revealed: p.revealed + 1 };
    return p;
  }
  if (!p.closing) {
    if (p.bars < MONTHLY_SLOTS) return { ...p, bars: p.bars + 1 };
    if (p.seats < MONTHLY_SLOTS) return { ...p, seats: p.seats + 1 };
    if (p.details < 5) return { ...p, details: p.details + 1 };
    return { ...p, closing: true };
  }
  return null;
}

// ============================================================
//  绘制
// ============================================================

const MONTHLY_FONT = FONT_FAMILY;

/** 锚点落点绘制 @source `fcn_00456418` / `fcn_004563f5`（`to_left = x − src->x`）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 哪几张图要**抠掉纯黑** —— 就是原版走带透明的 `fcn_00456418`。
 *
 * | 图 | 原版用哪个 | 抠黑 | @source |
 * |---|---|---|---|
 * | 0 底图 / 1 气泡 / 2 行底板 | `fcn_004563f5`（不透明）| ✗ | 0x00439c1f / 0x00439c3a / 0x00439d8f |
 * | 6..9 数字、10 金币 | `fcn_00456418` | ✓ | 0x00439d02 / 0x00439d1d |
 * | 11..14 窄板 / 15..18 竖栏 | `fcn_004563f5` | ✗ | 0x0043849e / 0x004387f9 |
 * | 47..82 头像 | `fcn_00456418` | ✓ | 0x0043849e 尾 |
 */
const MONTHLY_KEYED = new Set<number>([
  MONTHLY_CHUNK.digitFirst + 0,
  MONTHLY_CHUNK.digitFirst + 1,
  MONTHLY_CHUNK.digitFirst + 2,
  MONTHLY_CHUNK.digitFirst + 3,
  MONTHLY_CHUNK.coin,
]);

/** 一张图要不要抠黑由 `MONTHLY_KEYED` 说了算，别在各处手写 */
function monthlySprite(sprite: MonthlySprite, chunk: number, keyed?: boolean): Sprite | null {
  return sprite('Panel.mkf', MONTHLY_RESOURCE, chunk, keyed ?? MONTHLY_KEYED.has(chunk));
}

function monthlyText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  align: CanvasTextAlign = 'left',
): void {
  ctx.font = `${MONTHLY_FONT_SIZE}px ${MONTHLY_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = MONTHLY_TEXT.stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** 一行的全部文字（名字 / 现金 / 存款 / 利息）*/
function drawRowText(
  ctx: CanvasRenderingContext2D,
  at: MonthlyRowLayout,
  t: MonthlyRowText,
): void {
  monthlyText(ctx, t.name, at.name.x, at.name.y, MONTHLY_TEXT.fill);
  monthlyText(ctx, t.cash, at.cash.x, at.cash.y, MONTHLY_TEXT.fill, 'right');
  monthlyText(ctx, t.bankLabel, at.bank.x - 0x1e, at.bank.y, MONTHLY_TEXT.fill);
  monthlyText(ctx, t.bank, at.bank.x, at.bank.y, MONTHLY_TEXT.fill, 'right');
  monthlyText(ctx, t.interestLabel, at.interestLabel.x, at.interestLabel.y, MONTHLY_TEXT.fill);
  monthlyText(
    ctx,
    t.interest,
    at.interestValue.x,
    at.interestValue.y,
    t.loan ? MONTHLY_TEXT.loan : MONTHLY_TEXT.fill,
    'right',
  );
}

/**
 * 画整屏。
 *
 * 顺序照原版：
 * ① `fcn_00439c1f`（底图 → 气泡）+ `loc_00439cd7`（逐行）；
 * ② `loc_0043849e`（4 列竖栏 → 4 块窄板 → 逐列头像）；
 * ③ `loc_00438570`（详情 5 条）+ 收尾那一句。
 *
 * ★ 状态 6/7/8/9 每一拍都把前面画过的**整块重画一遍再叠新的**，故这里
 *   一次画完「累积到 `p` 这一刻」的全部内容。
 */
export function drawMonthlyScreen(
  ctx: CanvasRenderingContext2D,
  sprite: MonthlySprite,
  state: GameState,
  topo: MapTopology,
  view: MonthlyView,
  award: MonthlyAward | null,
  p: MonthlyPlayback,
): void {
  // ── ① 底图 + 气泡 ──
  drawAnchored(ctx, monthlySprite(sprite, MONTHLY_CHUNK.bg, false), 0, 0);
  drawAnchored(
    ctx,
    monthlySprite(sprite, MONTHLY_CHUNK.bubble, false),
    MONTHLY_BUBBLE_AT.x,
    MONTHLY_BUBBLE_AT.y,
  );

  // ── ① 逐行（頒獎屏期间全部显示）──
  // 结算屏按 `[0x48c418]` 的填充序点亮（本引擎里 = `players` 下标序），
  // 故「第 n 行（`revealed = n`）」对应前 `n+1` 个在场玩家。
  const shownCount = p.phase === 'settle' ? p.revealed + 1 : view.rows.length;
  for (let i = 0; i < Math.min(shownCount, view.rows.length); i++) {
    const row = view.rows[i];
    if (row === undefined) continue;
    const at = monthlyRowLayout(state, row.index);
    drawAnchored(ctx, monthlySprite(sprite, MONTHLY_CHUNK.plate, false), at.plate.x, at.plate.y);
    drawAnchored(ctx, monthlySprite(sprite, at.avatar.chunk), at.avatar.x, at.avatar.y);
    drawAnchored(ctx, monthlySprite(sprite, at.digit.chunk), at.digit.x, at.digit.y);
    drawAnchored(ctx, monthlySprite(sprite, MONTHLY_CHUNK.coin), at.coin.x, at.coin.y);
    drawRowText(ctx, at, monthlyRowText(row));
  }

  // ── ② 頒獎屏 ──
  if (p.phase !== 'award' || award === null) return;

  // 状态 1：先把图 1 在 (70,24) 那块 70×24 原样盖到 (24,70)（见 MONTHLY_AWARD_PATCH）
  const patch = monthlySprite(sprite, MONTHLY_CHUNK.bubble, false);
  if (patch !== null) {
    ctx.drawImage(
      patch.bitmap,
      MONTHLY_AWARD_PATCH.srcX - patch.anchorX,
      MONTHLY_AWARD_PATCH.srcY - patch.anchorY,
      MONTHLY_AWARD_PATCH.w,
      MONTHLY_AWARD_PATCH.h,
      MONTHLY_AWARD_PATCH.dstX,
      MONTHLY_AWARD_PATCH.dstY,
      MONTHLY_AWARD_PATCH.w,
      MONTHLY_AWARD_PATCH.h,
    );
  }

  // 4 列竖栏（图 15..18，不透明）
  for (let s = 0; s < p.seats; s++) {
    const row = view.rows[s];
    if (row === undefined) continue;
    const at = monthlyRowLayout(state, row.index);
    drawAnchored(
      ctx,
      monthlySprite(sprite, MONTHLY_CHUNK.columnFirst + s, false),
      at.avatar.x,
      MONTHLY_BAR_Y,
    );
  }

  // 4 块窄板（图 11..14；落点 x 就是表里那个 15/16/17）
  for (let b = 0; b < p.bars; b++) {
    drawAnchored(
      ctx,
      monthlySprite(sprite, MONTHLY_CHUNK.barFirst + b, false),
      MONTHLY_BAR_X[b] ?? 0,
      MONTHLY_BAR_Y,
    );
  }

  // 逐列头像（`loc_0043849e` 的人头那一段，带透明）
  for (let s = 0; s < p.seats; s++) {
    const row = view.rows[s];
    if (row === undefined) continue;
    const at = monthlyRowLayout(state, row.index);
    drawAnchored(ctx, monthlySprite(sprite, at.avatar.chunk), at.avatar.x, at.avatar.y);
  }

  // ── ③ 详情（`loc_00438570`）──
  const lines = monthlyDetailLines(state, topo, award);
  for (let i = 0; i < Math.min(p.details, lines.length); i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const y = MONTHLY_DETAIL_AT.y0 + i * MONTHLY_DETAIL_AT.step;
    monthlyText(ctx, line.label, MONTHLY_DETAIL_AT.x, y, MONTHLY_TEXT.fill);
    monthlyText(ctx, line.value, MONTHLY_DETAIL_AT.valueX, y, MONTHLY_TEXT.fill, 'right');
  }

  // 收尾那一句「本月冠軍是」/「本月悲情人物是」
  if (p.closing) {
    const win = award.winner >= 0 ? state.players[award.winner] : undefined;
    const label = win === undefined ? MONTHLY_TRAGIC : MONTHLY_CHAMPION;
    const who = win === undefined ? '' : (CHARACTERS[win.character]?.name ?? '');
    monthlyText(
      ctx,
      `${label}${who}`,
      MONTHLY_DETAIL_AT.x,
      MONTHLY_DETAIL_AT.y0 + 6 * MONTHLY_DETAIL_AT.step,
      MONTHLY_TEXT.fill,
    );
  }
}

// ============================================================
//  屏幕本体
// ============================================================

/** 现在正在播的那一段；`null` = 没在播 */
let playback: MonthlyPlayback | null = null;
/** 这一次回放的摘要 */
let view: MonthlyView | null = null;
/** 这一次回放的頒獎结果 */
let award: MonthlyAward | null = null;
/** 演出的快照（结算**后**的状态）*/
let snapshot: GameState | null = null;

/** 调试 / 单测用：把整屏关掉 */
export function resetMonthlyScreen(): void {
  playback = null;
  view = null;
  award = null;
  snapshot = null;
}

export const monthlyScreen: UiScreen = {
  id: 'monthly',

  /** 演出期间接管整屏；播完自己关 */
  active: () => playback !== null,

  draw(env: UiScreenEnv): void {
    const v = view;
    const s = snapshot;
    const p = playback;
    if (v === null || s === null || p === null) return;
    drawMonthlyScreen(env.stage, env.sprite, s, env.topo, v, award, p);
  },

  /**
   * 结算屏「确认后继续」——**在抬手**。
   *
   * @source 頒獎屏窗口过程 `fcn_00437e61`（VA 0x00437e61）的分支表：
   *   `0x202`（`WM_LBUTTONUP`）与 `0x205`（`WM_RBUTTONUP`）都落到
   *   `loc_00439b62`、`0x101`（`WM_KEYDOWN`）落到 `loc_00439b85`
   *   —— **没有 `0x201`（`WM_LBUTTONDOWN`）那一条**；
   *   `Wait_0402_Message` 等的就是 0x402 那条「抬手」消息。
   *   故本屏按下时**什么都不做**。
   */
  up(_x: number, _y: number, env: UiScreenEnv): void {
    advance(env);
  },

  tick(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    const rows = view?.rows.length ?? 0;
    const next = monthlyPlaybackTick(p, rows);
    if (next === null) {
      playback = null;
      view = null;
      award = null;
      snapshot = null;
      env.log('每月結算：演出结束');
      env.requestRender();
      return;
    }
    if (next !== p) {
      playback = next;
      env.requestRender();
    }
  },

  /**
   * 察觉「刚刚跨了一个月」。
   *
   * ★ 判据是 `before → after` 的 `totalMonths` 增了 —— 那正是
   *   `advanceGameDay` 里 `totalMonths + (newMonth ? 1 : 0)` 写下的
   *   （`@source 0x0041d0f9 add [0x499084], edi`），也正是月结那一步的守卫
   *   （`@source 0x0041d09e call 0x439bfa`）。
   *
   * 起播时原版会 `fcn_004549cf(9)` 放一段音（VA 0x00439ecc）；本引擎的
   * `SOUND_IDS` 里没有这一条，按「宁可不响也不乱响」**一个音都不放**，
   * 见 `docs/deviations/T-041.md`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return; // 上一段还没播完
    if (before === after) return;
    if (after.totalMonths <= before.totalMonths) return;
    const v = monthlySummary(before, after);
    if (v.rows.length === 0) return;
    view = v;
    snapshot = after;
    award = monthlyAward(before, after, env.topo);
    playback = monthlyPlaybackStart();
    env.log(`每月結算：${v.rows.length} 人`);
    env.requestRender();
  },
};

/** 一次「确认」：结算屏 → 頒獎屏；頒獎屏（已 `closing`）→ 关屏 */
function advance(env: UiScreenEnv): void {
  const p = playback;
  if (p === null) return;
  if (p.phase === 'settle') {
    playback = { ...p, phase: 'award', revealed: 0, bars: 0, seats: 0, details: 0 };
    env.requestRender();
    return;
  }
  if (p.closing) {
    playback = null;
    view = null;
    award = null;
    snapshot = null;
    env.log('每月結算：关闭');
    env.requestRender();
  }
}

/** 给单测的只读视图（`active()` 之外的状态）*/
export function monthlyScreenState(): {
  playing: boolean;
  view: MonthlyView | null;
  award: MonthlyAward | null;
  playback: MonthlyPlayback | null;
} {
  return { playing: playback !== null, view, award, playback };
}
