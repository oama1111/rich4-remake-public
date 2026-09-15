/*
 * 上市公司分紅屏 —— T-031
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 底图是 `Panel.mkf` **#76**（一张 592×432 的表），贴到 **(0x18, 0x18) = (24,24)**
 * —— 640−592 = 48、480−432 = 48，两头各留 24，正好居中。
 *
 * ## 出处（全部自 `rich4.exe` 读出）
 *
 * | 是什么 | @source |
 * |---|---|
 * | 载图 `read_mkf(panel_mkf, 0x4c, 0, 0)` | VA 0x0042bab2 |
 * | 贴图 `fcn_004563f5(chunk+0xc, dst, 0x18, 0x18)` | VA 0x0042b46f（WM_PAINT）|
 * | 画字的那一大段（`fcn_0042ba97`）| VA 0x0042bac8..0x0042be43 |
 * | 收屏 `Wait_0402_Message(fcn_0042b3eb)` | VA 0x0042be43 |
 * | 入口（**唯一调用点**）| VA 0x0041d08f —— `cfg[8] & 0xff == 0xf` 之后、`樂透開獎` 之前 |
 *
 * ★ **本屏是每月 15 日的「上市公司分紅」**（`DIVIDEND_DAY`，与樂透開獎同一天，
 *   见 `core/places/company.ts`）：每家公司把**累積盈餘**按持股比例分给玩家。
 *   数据不是重算的 —— 逐字复用 core 的 `companyDividends()`（同一段 VA 0x0042bc75
 *   那一圈的翻译），本模块只摆位置、画字。
 *
 * ## 版面（chunk 局部坐标；屏幕坐标 = 局部 + `SHARES_AT`）
 *
 * ★ **一家公司一行、一位玩家一列** —— 12 家公司占 12 个**行**（行距 `0x18 = 24`，
 *   正好铺满 432 高的表），玩家占**列**（列距 `0x62 = 98`）。先前把 `0x62` 当成
 *   行距、写成「一家公司一列」是**读错了**（见 `docs/deviations/T-031.md` 的
 *   `D-T031-7`，2026-09-15 按 exe 逐条订正）。
 *
 * | 是什么 | 局部落点 | 画法 @source |
 * |---|---|---|
 * | 标题 `上市公司分紅` | (0x128, 0x19) | 28 号白字，flag 2 正中 |
 * | `人名` | (0x68, 0x52) | 12 号黑字，flag 6 右中 |
 * | `公司` | (0x12, 0x5e) | 12 号黑字，flag 5 左中 |
 * | `本月盈餘` | (0x21e, 0x58) | 16 号黑字，flag 2 正中 |
 * | 第 p 位玩家的名字 | (0xa0 + 0x62p, 0x58) | 16 号黑字，flag 2 正中 |
 * | 第 i 家公司的名字 | (0x3e, 0x74 + 0x18i) | 16 号黑字，flag 2 正中 |
 * | 第 p 位在第 i 家分到的 | (0xc6 + 0x62p, 0x74 + 0x18i) | 16 号黑字，flag 6 右中 |
 * | 第 i 家分出去的**盈餘合计** | (0x23c, 0x74 + 0x18i) | 16 号黑字，flag 6 右中 |
 * | 第 p 位的合计 | (0xc6 + 0x62p, 0x194) | 16 号黑字，flag 6 右中 |
 *
 * 三处字号与字色（`create_font(size, fg, bg, 描边, 底)`；cdecl 逆序入栈，
 * 所以汇编里的 `push` 次序是 **底, 描边, bg, fg, size**）：
 *
 * | 场合 | 字号 | 字色 | @source |
 * |---|---|---|---|
 * | 标题 | 28 | `0xf0f0f0` 白 | VA 0x0042baec `create_font(0x1c, 0xf0f0f0, 0x101010, 3, 1)` |
 * | `人名` / `公司` | 12 | `0x101010` **近黑** | VA 0x0042bb20 `create_font(0xc, 0x101010, 0, 2, 1)` |
 * | 表身（含 `本月盈餘`）| 16 | `0x101010` **近黑** | VA 0x0042bb6d `create_font(0x10, 0x101010, 0, 2, 1)` |
 *
 * ⚠️ 先前写「表身白字 / 有企业时青字 `0xf0f0`」是**错的** —— 那组颜色是从**股市屏**
 *   （另一个函数）串过来的；本屏三处 `create_font` 的实参就是上表这三个。
 *
 * ## 数值
 *
 * - 每一格画的是 `format_int()` 的结果（千分位）@source VA 0x0042bcb3 / 0x0042bd00 /
 *   0x0042be17 `call 0x452793`：先把整数转成十进制串（`call 0x457d61`，**0 也转成
 *   `"0"`** —— `0x457d10` 是 do-while，除一次写一位），再每三位插一个 `,`。
 *   ★ 所以**`0` 是要画出来的**，原版不跳过零值（本模块先前 `if (amount !== 0)` 跳过，
 *   属改良，已删）。
 * - 一家公司那一列的「盈餘合计」画的是 `company[+0x28]` **本身**
 *   @source VA 0x0042bcf7 `mov ebx, [eax + 0x28]` —— 不是各玩家分红之和
 *   （没持股时两者会差一个公司的全部盈餘）。
 * - 每一格的分红额 = `trunc(盈餘 × 该玩家持股 / 在场玩家持股总和)`
 *   @source VA 0x0042bc90..0x0042bc9f（`fild` / `fmul` / `call 0x457dbc` 向零取整）。
 *   算式本身复用 core 的 `companyDividends()`，本函数只把它摆成行/列。
 *
 * ## 这一屏**没有任何标识 / 高亮**
 *
 * ★ 这里曾经照股市屏持股页加过一处「董事长那一格蓝底」，**已删**（2026-09-15）：
 *   `fcn_0042ba97` 整段（VA 0x0042ba97..0x0042becf）的 `call` 只有
 *   `read_mkf` / `create_font` / `draw_text` / `strlen` / `itoa` / 向零取整 /
 *   `Wait` / `free` / `bankruptcy` / 两处音效，**一次填色调用都没有** ——
 *   原版这一屏就是一张纯表。见 `docs/deviations/T-031.md` 的 `D-T031-8`。
 *
 * ## 这一屏什么时候出现 / 什么时候收
 *
 * ★ **入口只有一个**：每月 **15 日**（`DIVIDEND_DAY`，与樂透開獎同一天）
 *   `advanceGameDay` 尾部那一支 @source VA 0x0041d08f `call 0x42ba97` ——
 *   日期一跨到 15 日就**无条件**演这一屏（VA 0x0041d08a `cmp eax, 0xf`），
 *   紧接着才是樂透開獎（VA 0x0041d094 `call 0x431712`）。
 *   它**不带任何「是不是真的发了红利」的判据**：0x42ba97 从进门一路到
 *   `Wait_0402_Message`（VA 0x0042be43）之间没有一个提前返回。
 *
 * ⚠️ **本屏与买股份毫无关系**：原版踩到上市企業（`buyShares`）走的是
 *   訊息框 + 填数窗（VA 0x0041d24d `fcn_00440ba8` / VA 0x0041d25b
 *   `fcn_00453544` / VA 0x0041d281 `_rich4_buy_stock(…, 0)`），那条路的题面
 *   与填数页在 `interactions.ts` 的 `case 'buyShares'`（本引擎的通用对话框）。
 *   本模块**不接管** `pending{buyShares}` —— 接管了就是每次踩到上市企業都弹
 *   一张分红表（可见的回归，见 `docs/deviations/T-031.md` 的「与卡片 `source`
 *   一栏的差异」一节）。
 *
 * 收屏两路（都在窗口过程 `fcn_0042b3eb` 里 @source VA 0x0042b3eb）：
 *
 * | 时机 | 原版 | @source |
 * |---|---|---|
 * | 任意处**抬手**（左/右都算）| `0x202` / `0x205` → 杀定时器 + `_Post_0402_Message(0)` | VA 0x0042b401 / 0x0042b412 → 0x0042b524 |
 * | 到点自动收 | `SetTimer(…, 0x3e8)` 跑 3 拍 → 自己 `PostMessage(0x202)` | VA 0x0042b49b / 0x0042b4db / 0x0042b50e |
 *
 * 这一屏**没有可点的控件**；`0x201`（按下）落到 DefWindowProc，什么都不做。
 * 于是本模块只有 `up`（抬手退屏）与 `tick` 里的自动收屏（`SHARES_AUTO_CLOSE_MS`）。
 */

import type { GameState, MapTopology } from '@rich4/core';
import { DIVIDEND_DAY, companyDividends, isAlive } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type SharesSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  资源
// ============================================================

/** 本屏唯一的图集 @source VA 0x0042bab2 `read_mkf(panel_mkf, 0x4c, 0, 0)` */
export const SHARES_RESOURCE = 0x4c; // 76
/** 资源里只有这一张图 */
export const SHARES_IMAGE = 0;
/** 贴到 (0x18, 0x18) @source VA 0x0042b46f `push 0x18 / push 0x18` */
export const SHARES_AT = { x: 0x18, y: 0x18 } as const;
/** 图尺寸（`assets-clean/manifest.json`；与 640×480 差 48 的两倍，故居中）*/
export const SHARES_SIZE = { w: 592, h: 432 } as const;

/**
 * ★ **抠黑表** —— 这一屏只有图 0，判定：**不抠**。
 *
 * | 图 | 原版用哪个 blit | 抠黑 | 判定依据 |
 * |---|---|---|---|
 * | 0 底图 | `fcn_004563f5` @ VA 0x0042b483 | ✗ | ① 那一支**不跳过 0 像素**（跳过 0 像素的是 `fcn_00456418`）；② 归档 PNG 全图**没有一个纯黑像素**（逐像素扫过 592×432），黑不是它的背景 —— 抠了只会把图案里偏暗的像素打成洞 |
 *
 * 表本身留在这里，是为了让「逐图判定」这件事有落点、后来加图时别漏。
 */
export const SHARES_KEYED: ReadonlySet<number> = new Set<number>();

/** 资源 76 的图 —— 抠不抠黑由 `SHARES_KEYED` 说了算，别在各处手写 */
function sharesSprite(sprite: SharesSprite, index: number): Sprite | null {
  return sprite('Panel.mkf', SHARES_RESOURCE, index, SHARES_KEYED.has(index));
}

// ============================================================
//  版面常量（chunk 局部坐标）
// ============================================================

/** 标题 @source VA 0x0042baf4 `push 2 / 0x19 / 0x128` */
export const SHARES_TITLE = { x: 0x128, y: 0x19, size: 0x1c } as const;
/** 标题串 @source 0x464168 */
export const SHARES_TITLE_TEXT = '上市公司分紅';
/** 标题的白字 @source VA 0x0042baec `create_font(0x1c, 0xf0f0f0, 0x101010, 3, 1)` */
export const SHARES_TITLE_COLOR = '#f0f0f0';

/**
 * 表身与两个角落表头的字色 —— **近黑** `0x101010`。
 *
 * @source VA 0x0042bb20（12 号）/ VA 0x0042bb6d（16 号）：
 * ```asm
 * 0042bb13  push 1          ; 底
 * 0042bb15  push 2          ; 描边
 * 0042bb17  push 0          ; bg
 * 0042bb19  push 0x101010   ; ★ fg
 * 0042bb1e  push 0xc        ; size
 * 0042bb20  call create_font
 * ```
 */
export const SHARES_INK_COLOR = '#101010';

/**
 * 两个角落表头 —— `人名` 右中、`公司` 左中（一上一下占住表身左上角那一格）。
 *
 * @source VA 0x0042bb28 `push 6 / push 0x52 / push 0x68`（flag / y / x）
 *          VA 0x0042bb44 `push 5 / push 0x5e / push 0x12`
 */
export const SHARES_HEAD_PERSON = { x: 0x68, y: 0x52 } as const;
export const SHARES_HEAD_COMPANY = { x: 0x12, y: 0x5e } as const;
/** 表头串 @source 0x464175 / 0x46417a */
export const SHARES_HEAD_PERSON_TEXT = '人名';
export const SHARES_HEAD_COMPANY_TEXT = '公司';

/** 最后一列表头 `本月盈餘`（16 号，flag 2 正中）@source VA 0x0042bbb3 `push 2 / 0x58 / 0x21e` */
export const SHARES_HEAD_SUM = { x: 0x21e, y: 0x58 } as const;
/** 串 @source 0x464103 */
export const SHARES_HEAD_SUM_TEXT = '本月盈餘';

/**
 * 表身：**一家公司一行**。
 *
 * - 公司数 12 —— `cmp ebx, 0xc` @source VA 0x0042bd58
 * - 第一行的 y = 0x74 @source VA 0x0042bbfa `mov [esp+0xa8], 0x74`
 * - ★ **行距 = 0x18 = 24**（纵向）@source VA 0x0042bd2d `lea edi, [esi + 0x18]` /
 *   VA 0x0042bd30 `mov [esp+0xa8], edi` —— 每画完一行就 +24。
 *   先前把横向列距 `0x62` 当成行距（于是 12 家公司斜着排），是这次订正的主因。
 */
export const SHARES_ROWS = {
  count: 12,
  y0: 0x74, // 116
  pitch: 0x18, // 24
} as const;

/**
 * 表身：**一位玩家一列**（横向）。
 *
 * - 玩家名（flag 2 正中）的第一列 x = 0xa0 @source VA 0x0042bb77 `mov edi, 0xa0`
 * - 玩家数额（分红 / 合计，flag 6 右中）的第一列 x = 0xc6 @source VA 0x0042bc70 `mov edi, 0xc6`
 * - 列距 = 0x62 @source VA 0x0042bbad / 0x0042bcea / 0x0042be3d `add edi, 0x62`
 * - 玩家名那一行的 y = 0x58 @source VA 0x0042bb92 `push 0x58`
 * - 玩家合计那一行的 y = 0x194 @source VA 0x0042be21 `push 0x194`
 */
export const SHARES_COLS = {
  nameX0: 0xa0, // 160
  valueX0: 0xc6, // 198
  pitch: 0x62, // 98
  nameY: 0x58, // 88
  totalY: 0x194, // 404
} as const;

/** 表身最左那一列（公司名）@source VA 0x0042bda1 `push 0x3e` */
export const SHARES_COMPANY_X = 0x3e; // 62
/** 表身最右那一列（盈餘合计）@source VA 0x0042bd12 `push 0x23c` */
export const SHARES_SUM_X = 0x23c; // 572

/**
 * 最下面那一行左侧的 `紅  利` 标签（flag 2 正中）@source VA 0x0042bbd2 `push 2 / 0x194 / 0x3e`，
 * 串 @source 0x46417f。它与合计带 [392,416] 的正中 404 对齐。
 */
export const SHARES_TOTAL_LABEL = { x: 0x3e, y: 0x194 } as const;
/** 串 @source 0x46417f（原版就是「紅」+ 两个空格 +「利」）*/
export const SHARES_TOTAL_LABEL_TEXT = '紅  利';

/**
 * ★★ **所有 `draw_text` 的坐标都是「底图本地坐标」，不是屏幕绝对坐标。**
 *
 * 底图 592×432 贴在 **(24,24)**（`SHARES_AT`），而 exe 里那串 `push flag / y / x`
 * 的 y、x 全部与底图自己的网格**逐条对齐**（这是量出来的，不是推的）：
 *
 * | exe 常量 | 值 | 底图本地网格 |
 * |---|---|---|
 * | 标题 y `0x19` | 25 | 顶部蓝带 0..66 |
 * | 玩家名 / `本月盈餘` y `0x58` | 88 | 表头带 **[72,104]** 中心 88 |
 * | 公司行 y0 `0x74` + `0x18`×i | 116+24i | 数据行 i = **[104+24i, 128+24i]** 中心 116+24i |
 * | `紅  利` / 合计行 y `0x194` | 404 | 合计带 [392,416] 中心 404 |
 * | 公司名列 x `0x3e` | 62 | 第 1 栏（本地 12..108）中心 60 |
 * | 玩家名 x0 `0xa0` | 160 | 第 2 栏中心 159 |
 * | 玩家数额 x0 `0xc6` | 198 | 第 2 栏右缘 208 内 10px |
 * | `本月盈餘` x `0x21e` | 542 | 末栏（本地 502..585）中心 543 |
 *
 * ⇒ 画字时必须加上 `SHARES_AT`。先前按屏幕绝对坐标画，整屏文字偏了 (−24,−24)：
 * 标题跑到蓝带上沿之外、`人名`/`公司` 压在表身边框上、数据行整体高了一行。
 */
export const SHARES_TEXT_ORIGIN = SHARES_AT;

/** 字号 @source VA 0x0042bae5（28）/ 0x0042bb1e（12）/ 0x0042bb6b（16）*/
export const SHARES_FONT = { title: 0x1c, head: 0xc, body: 0x10 } as const;

/** 音效表 `0x475590` 里本屏那一组的下标 @source VA 0x0042baa1 `push 0x4755a8` */
export const SHARES_SOUND = { open: 0, page: 1, choice: 2 } as const;

/**
 * 到点自动收屏的时限（毫秒）—— 原版跑 **3 拍 × 1000 ms**。
 *
 * @source VA 0x0042b49b（WM_CREATE 里那一支）：
 * ```asm
 * 0042b49b  push 0            ; lpTimerFunc = NULL
 * 0042b49d  push 0x3e8        ; uElapse = 1000 ms
 * 0042b4a2  mov  esi, [0x46cad8]
 * 0042b4a8  push esi          ; nIDEvent
 * 0042b4a9  push ebx          ; hWnd（这一屏自己的窗口）
 * 0042b4aa  call SetTimer
 * 0042b4b6  mov  [0x48c2f2], edi   ; ★ 计数器清零
 * ```
 * 每次 WM_TIMER（VA 0x0042b4db，先过 `cmp byte [0x46cb01], 0 / je`）把
 * `[0x48c2f2]` 加一，`cmp ecx, 3` 到 3 就自己投一条 `0x202`：
 * ```asm
 * 0042b4f8  mov  ecx, [0x48c2f2]
 * 0042b4ff  mov  [0x48c2f2], ecx
 * 0042b505  cmp  ecx, 3
 * 0042b508  jne  0x42b3ca
 * 0042b50e  push 0; push 0; push 0x202; push ebx; call PostMessage
 * ```
 * ⚠️ 那个 `[0x46cb01]` 是 **WM_ACTIVATEAPP** 的「本程序在前台」标志
 * （写它的地方 VA 0x00401a93 / 0x00401aab，读的是 WM_ACTIVATEAPP 的 wParam）
 * —— 窗口不在前台就不计时。网页版没有这个概念，这里**不计这一条**。
 */
export const SHARES_AUTO_CLOSE_MS = 3 * 1000;

// ============================================================
//  取数（纯函数）
// ============================================================

/**
 * 金额在**屏幕上**的写法 —— 截断到整数（`__round_toward_zero`）+ 千分位。
 *
 * @source VA 0x0042bc9a / VA 0x0042be17 `call 0x457dbc` —— 那个函数把 FPU
 *   控制字的高字节改成 `0x1f`（RC = 11b = **向零取整**）再 `frndint`
 *   （VA 0x00457dc5 `mov byte [esp + 1], 0x1f` / VA 0x00457dcd `frndint`），
 *   是**截断**，不是四舍五入。
 *
 * ⚠️ core 的 `companyDividends()` 用的是 `Math.round()`，而它给出的已经是
 *   **整数** —— 所以这里再 `Math.trunc` 一次**并不能**把 core 那一次四舍五入
 *   还原成原版的截断：浮点乘积的小数 ≥ .5 时屏上会比原版多 1。差在 core、
 *   不在本屏（本屏只摆位置、画字）。见 `docs/deviations/T-031.md` 的 `D-T031-1`。
 */
export function dividendText(amount: number): string {
  return Math.trunc(amount).toLocaleString('en-US');
}

/**
 * 买股份能买几股的**上限** —— 三道闸合起来算一次。
 *
 * ★ 原版在买股份那条路上没有单独算过这个数：它先弹訊息框问要不要認購
 *   （VA 0x0041d233 → `fcn_00440ba8`），再开填数窗 `fcn_00453544(player, 数额)`
 *   （内部 `cmp eax, edx / jle` 越界夹回）。core 的 `buySharesFromCommercial`
 *   有三道闸：`shares ≤ available`、`shares × unitPrice ≤ cash`、`shares > 0`。
 *   这里把它们合起来算一次。
 *
 * ⚠️ **本屏（分紅屏）不用它** —— 分红屏没有填数页，买股份的题面与填数窗都在
 *   `interactions.ts` 的 `case 'buyShares'`。留着是为了给那三道闸一份可执行、
 *   被单测钉着的判据（T-031 收尾时按任务书保留「上限」那一条用例）；**规则仍在 core**。
 *
 * @source 闸门 VA 0x00428d65（`sub [commercial+0x30], shares`）、
 *   VA 0x00428d77（`sub [player+0x28], cost`）；单价见 `places/stock.ts`。
 */
export function maxShares(available: number, unitPrice: number, cash: number): number {
  const byCash = unitPrice > 0 ? Math.floor(cash / unitPrice) : 0;
  return Math.max(0, Math.min(Math.trunc(available), byCash));
}

/** 一家企业在屏上的一行 */
export interface SharesCompanyRow {
  /** 企业 id（1 基）*/
  id: number;
  /** 对应的股票下标 */
  stock: number;
  /** 企业名 */
  name: string;
  /**
   * 这一家的**盈餘**（`companyFunds[企业 id]`）—— 原版直接画 `company[+0x28]`
   * 本身（@source VA 0x0042bcf7），**不是**各玩家分红之和。
   */
  total: number;
}

/** 一个玩家在屏上的一列 */
export interface SharesPlayerColumn {
  /** 玩家下标 */
  player: number;
  /** 他在**屏幕上**占第几列（阵亡的人不占列，与 `draw_text` 那一圈一致）*/
  column: number;
  name: string;
  /** 每一行分到多少（与 `companies` 一一对应）*/
  amounts: number[];
  /** 他这一列的合计（画在表的最下面那一行）*/
  total: number;
}

/** 这一屏要画的东西 —— ★ 原版这一屏没有任何标识 / 高亮，见文件头那一节 */
export interface SharesView {
  companies: readonly SharesCompanyRow[];
  players: readonly SharesPlayerColumn[];
}

/** 某位玩家的角色名（`state` 里只有 `character` 号）@source 串表 `0x481a4e` 那一份 */
export function characterName(state: GameState, index: number): string {
  const ch = state.players[index]?.character ?? 0;
  return CHARACTERS[ch]?.name ?? `玩家${index + 1}`;
}

/**
 * 把局面摊成一屏。
 *
 * 逐条照原版（VA 0x0042bd61 那一圈）：
 * ```asm
 * for (i = 0; i < 12; i++) {
 *   commercialId = stocks[i].commercialIndex          ; 0 → 这支股票没有公司，跳过（这一行不占）
 *   company      = commercials[commercialId]
 *   draw(company.name, x=0x3e, y=rowY, flag 2)
 *   total = 0
 *   for (p = 0; p < numPlayers; p++) {
 *     if (!alive(p)) continue
 *     total += playerStocks[p][i]                     ; ★ 分母 = 在场玩家的持股总和
 *   }
 *   for (p = 0; p < numPlayers; p++) {                ; 各玩家 = 累积盈餘 × 持股 / 总和
 *     if (!alive(p)) continue
 *     amount = trunc(company[+0x28] × playerStocks[p][i] / total)
 *     draw(amount, x=0xc6+0x62p, y=rowY, flag 6); rowTotal[p] += amount
 *   }
 *   draw(trunc(company[+0x28]), x=0x23c, y=rowY, flag 6)   ; 这一家的盈餘合计
 *   rowY += 0x18
 *   if (total != 0) company[+0x28] = 0                ; 分完清零
 * }
 * for (p = 0; p < numPlayers; p++) {                  ; 各玩家的合计画在最下面一行
 *   if (!alive(p)) continue
 *   draw(rowTotal[p], x=0xc6+0x62p, y=0x194, flag 6)
 * }
 * ```
 * 分红算式本身**复用 core** 的 `companyDividends()`（同一段的翻译），
 * 本函数只负责把它摆成行/列。
 *
 * @param playerNames 各玩家的名字（core 的状态不带名字，见 `stock-screen.ts`）
 */
export function sharesView(
  state: GameState,
  topo: MapTopology,
  playerNames: readonly string[] = [],
): SharesView {
  const stocks = state.market.stocks;
  const companies: SharesCompanyRow[] = [];

  // 在场的玩家各占一列（阵亡的不占 —— `cmp byte [player+0x15], 0 / je`）
  const rows: SharesPlayerColumn[] = [];
  for (let p = 0; p < state.players.length; p++) {
    const pl = state.players[p];
    if (pl === undefined || !isAlive(pl)) continue;
    rows.push({
      player: p,
      column: rows.length,
      name: playerNames[p] ?? characterName(state, p),
      amounts: [],
      total: 0,
    });
  }

  for (let stock = 0; stock < SHARES_ROWS.count; stock++) {
    const s = stocks[stock];
    const commercialId = s?.commercialIndex ?? 0;
    if (s === undefined || commercialId === 0) continue;
    const info = topo.commercials?.find((c) => c.id === commercialId);

    // 持股按**玩家下标**取（`player_stocks[p][stock]`），空位补 0
    const holdings = state.players.map((_, p) => state.holdings[p]?.[stock]?.amount ?? 0);
    const funds = state.companyFunds[commercialId] ?? 0;
    const { rows: shares } = companyDividends(funds, holdings, state.players);
    const byPlayer = new Map(shares.map((r) => [r.player, r.amount]));

    for (const row of rows) {
      const amount = byPlayer.get(row.player) ?? 0;
      row.amounts.push(amount);
      row.total += amount;
    }

    companies.push({
      id: commercialId,
      stock,
      name: info?.name ?? '',
      // ★ 原版画的是 `company[+0x28]` 本身，不是各玩家分红之和
      total: funds,
    });
  }

  return { companies, players: rows };
}

/** 第 `row` 家公司在屏上的 y @source VA 0x0042bd2d `lea edi, [esi + 0x18]` */
export function companyRowY(row: number): number {
  return SHARES_ROWS.y0 + SHARES_ROWS.pitch * row;
}

/** 第 `column` 位玩家的名字 x @source VA 0x0042bb77 `mov edi, 0xa0` */
export function playerNameX(column: number): number {
  return SHARES_COLS.nameX0 + SHARES_COLS.pitch * column;
}

/** 第 `column` 位玩家的数额（每一格分红 / 最下面那一行的合计）x @source VA 0x0042bc70 `mov edi, 0xc6` */
export function playerValueX(column: number): number {
  return SHARES_COLS.valueX0 + SHARES_COLS.pitch * column;
}

// ============================================================
//  画
// ============================================================

/** `draw_text` 的对齐码 @source 跳表 `0x44faa0`：2 正中、5 左中、6 右中 */
type TextFlag = 2 | 5 | 6;

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  flag: TextFlag,
  fill: string = SHARES_INK_COLOR,
): void {
  if (s === '') return;
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = flag === 2 ? 'center' : flag === 6 ? 'right' : 'left';
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/**
 * 画整屏。
 *
 * 顺序照原版：底图 → 标题 + 两个角落表头 → 各玩家名 + `本月盈餘` →
 * 一家公司一行（名字 / 各玩家分红 / 盈餘合计）→ 最下面一行各玩家合计。
 *
 * ⚠️ 这一屏**没有填数页、没有可点的控件、也没有任何高亮** —— 原版的分紅屏
 *   就是一张纯表（整段没有一次填色调用，见文件头与 `D-T031-8`）。
 *   买股份的訊息框 + 填数窗走 `interactions.ts` 的通用对话框，不在这里画。
 *
 * @param view `sharesView()` 的产物（分红演出用的是起播那一刻定格的 `before`）
 */
export function drawSharesScreen(
  ctx: CanvasRenderingContext2D,
  sprite: SharesSprite,
  view: SharesView,
): void {
  ctx.imageSmoothingEnabled = false;

  // ── 底图：592×432 贴到 (24,24)（**不抠黑**，见 SHARES_KEYED）──
  const bg = sharesSprite(sprite, SHARES_IMAGE);
  if (bg !== null) ctx.drawImage(bg.bitmap, SHARES_AT.x, SHARES_AT.y);

  // ── ★ 以下所有坐标都是**底图本地坐标**，要加上底图落点（见 `SHARES_TEXT_ORIGIN`）──
  const ox = SHARES_TEXT_ORIGIN.x;
  const oy = SHARES_TEXT_ORIGIN.y;

  // ── 标题与三个表头（原版写进 chunk 的那一层）──
  text(
    ctx,
    SHARES_TITLE_TEXT,
    ox + SHARES_TITLE.x,
    oy + SHARES_TITLE.y,
    SHARES_TITLE.size,
    2,
    SHARES_TITLE_COLOR,
  );
  text(
    ctx,
    SHARES_HEAD_PERSON_TEXT,
    ox + SHARES_HEAD_PERSON.x,
    oy + SHARES_HEAD_PERSON.y,
    SHARES_FONT.head,
    6,
  );
  text(
    ctx,
    SHARES_HEAD_COMPANY_TEXT,
    ox + SHARES_HEAD_COMPANY.x,
    oy + SHARES_HEAD_COMPANY.y,
    SHARES_FONT.head,
    5,
  );

  // ── 各玩家的名字（flag 2 正中）与最后一列的 `本月盈餘` ──
  for (const row of view.players) {
    text(ctx, row.name, ox + playerNameX(row.column), oy + SHARES_COLS.nameY, SHARES_FONT.body, 2);
  }
  text(
    ctx,
    SHARES_HEAD_SUM_TEXT,
    ox + SHARES_HEAD_SUM.x,
    oy + SHARES_HEAD_SUM.y,
    SHARES_FONT.body,
    2,
  );

  // ── 一家公司一行：名字 / 各玩家分到的 / 这一家的盈餘合计 ──
  for (let r = 0; r < view.companies.length && r < SHARES_ROWS.count; r++) {
    const company = view.companies[r];
    if (company === undefined) continue;
    const y = oy + companyRowY(r);
    text(ctx, company.name, ox + SHARES_COMPANY_X, y, SHARES_FONT.body, 2);
    for (const row of view.players) {
      // ★ 0 也要画（原版的 itoa 把 0 转成 "0"，见文件头「数值」）
      text(
        ctx,
        dividendText(row.amounts[r] ?? 0),
        ox + playerValueX(row.column),
        y,
        SHARES_FONT.body,
        6,
      );
    }
    text(ctx, dividendText(company.total), ox + SHARES_SUM_X, y, SHARES_FONT.body, 6);
  }

  // ── 最下面那一行：左边 `紅  利` 标签 + 各玩家的合计 ──
  text(
    ctx,
    SHARES_TOTAL_LABEL_TEXT,
    ox + SHARES_TOTAL_LABEL.x,
    oy + SHARES_TOTAL_LABEL.y,
    SHARES_FONT.body,
    2,
  );
  for (const row of view.players) {
    text(
      ctx,
      dividendText(row.total),
      ox + playerValueX(row.column),
      oy + SHARES_COLS.totalY,
      SHARES_FONT.body,
      6,
    );
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ============================================================
//  UiScreen
// ============================================================

/**
 * 本屏的子状态 —— `active` 只读它，别的地方别碰。
 *
 * - `presenting`：在不在演（`event` 起、`up`/到点收）
 * - `shownAt`：**真正上屏**那一刻的 `env.now`；`-1` = 还没轮到本屏上屏
 * - `view`：起播那一刻定格的画面（见 `event` 的注释）
 */
let presenting = false;
let shownAt = -1;
let view: SharesView | null = null;

/**
 * 这一次 `before → after` 是不是「日期跨到每月 15 日」的那一下。
 *
 * @source VA 0x0041d080..0x0041d094（`advanceGameDay` 尾部那一支）：
 * ```asm
 * 0041d080  mov eax, [0x497160]   ; 今天（低字节 = 「日」）
 * 0041d085  and eax, 0xff
 * 0041d08a  cmp eax, 0xf          ; ★ 15 日
 * 0041d08d  jne 0x41d099
 * 0041d08f  call 0x42ba97         ; ★ 本屏（上市公司分紅）
 * 0041d094  call 0x431712         ; 樂透開獎
 * ```
 *
 * ★ **原版只有这一个判据**：15 日**无条件**叫 `0x42ba97`，而这个函数从进门
 *   （VA 0x0042ba97）一路到 `Wait_0402_Message`（VA 0x0042be43）之间**没有
 *   一个提前返回**（整段只有 VA 0x0042becf 那一个 `ret`）。所以这里也**不加**
 *   「是不是真的发了红利」的闸 —— 那会比原版多出一个判据（`C-FID-1/4`
 *   不许改良）：12 家盈餘全是 0、没人持股时，原版照样把这张表贴出来。
 *
 * 另一个守卫是必要的：`event` 会被**任何** action 叫到，同一个 15 日里别的
 * action 不该重播。`after.totalDays > before.totalDays` 就是「日期真的推进了
 * 一天」（`advanceGameDay` 里 `inc dword [0x4990e4]` @source VA 0x0041cfab；
 * 一輪一天见 VA 0x00418f93..0x0041902e）。
 */
export function dividendDayCrossed(before: GameState, after: GameState): boolean {
  if (after.totalDays <= before.totalDays) return false;
  return after.day === DIVIDEND_DAY;
}

/**
 * 收屏 —— 抬手（`0x202`/`0x205`）与到点自动收都走这里。
 *
 * @source VA 0x0042b524（`0x202` 与 `0x205` 共用的那一支）：
 * ```asm
 * 0042b524  mov  ebp, [0x48c2ee]        ; WM_CREATE 里 SetTimer 拿到的 id
 * 0042b52a  push ebp; push ebx; call KillTimer
 * 0042b533  push 0; call 0x401966       ; _Post_0402_Message(0) → 结束这次 Wait
 * ```
 */
function dismiss(env: UiScreenEnv): void {
  if (!presenting) return;
  presenting = false;
  shownAt = -1;
  view = null;
  env.log('上市公司分紅：收屏');
  env.requestRender();
}

/** 测试用：把本屏的状态清干净 */
export function resetSharesScreen(): void {
  presenting = false;
  shownAt = -1;
  view = null;
}

/** 测试用：这一刻本屏的子状态（在不在演、几时上屏、画面是什么）*/
export function sharesScreenState(): Readonly<{
  presenting: boolean;
  shownAt: number;
  view: SharesView | null;
}> {
  return { presenting, shownAt, view };
}

export const sharesScreen: UiScreen = {
  id: 'shares',

  /** 演出期间接管整屏 —— 起播/收屏只由本模块的 `presenting` 说了算 */
  active(env: UiScreenEnv): boolean {
    return env.screen === 'game' && presenting;
  },

  draw(env: UiScreenEnv): void {
    const v = view;
    if (v === null) return;
    // ★ 自动收屏的计时从**真正上屏**这一帧起算 —— 原版那只 `SetTimer` 就是
    //   在 WM_CREATE（窗口刚建出来）里设的（VA 0x0042b49b）。同一拍若还有
    //   别的演出排在前面，本屏要等它演完才轮到（登记序见 `screens.ts`）。
    if (shownAt < 0) shownAt = env.now;
    drawSharesScreen(env.stage, env.sprite, v);
  },

  /**
   * 察觉「日期刚跨到 15 日」—— 起播。
   *
   * ★ 画面定格在 `before`：原版这一屏摆的就是**盈餘还没清零**的那一版数 ——
   *   每画完一行（公司）就 `company[+0x28] = 0`（VA 0x0042bd37 `test ebp, ebp / je`
   *   → VA 0x0042bd42 `mov dword [eax + 0x28], 0`），那发生在 `Wait_0402_Message`
   *   （VA 0x0042be43）**之前**；而真正的进账更晚 —— 等这一屏收掉了才
   *   `player[+0x496b88] += 本行列的合计`（VA 0x0042be90 `add edi, esi` /
   *   0x0042be92 `mov [eax + 0x496b88], edi`，在 Wait 之后）。
   *   本引擎把「进账 + 清零」都放在 `advanceGameDay` 里做完了，`after` 的
   *   `companyFunds` 全是 0 —— 用 `after` 摊整屏都会是 0，所以必须用 `before`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (presenting) return; // 上一屏还没收
    if (before === after) return;
    if (!dividendDayCrossed(before, after)) return;
    view = sharesView(before, env.topo);
    presenting = true;
    shownAt = -1;
    env.log(`上市公司分紅：${view.companies.length} 家企業`);
    env.requestRender();
  },

  /**
   * 到点自动收屏。
   *
   * @source 见 `SHARES_AUTO_CLOSE_MS`（`SetTimer(…, 0x3e8)` 跑 3 拍 = 3 秒）。
   *   原版那一支还带「本程序在前台」的闸（`[0x46cb01]`），网页版没有这个概念。
   */
  tick(env: UiScreenEnv): void {
    if (!presenting) return;
    // 不在对局里（設定/資產表那些浮窗盖着）就不推进，也不空转
    if (env.screen !== 'game') return;
    if (shownAt < 0) {
      // 还没轮到本屏上屏 —— 续帧等前面那一屏演完
      env.requestRender();
      return;
    }
    if (env.now - shownAt >= SHARES_AUTO_CLOSE_MS) {
      dismiss(env);
      return;
    }
    // 自动收屏靠逐帧的时钟推进（不续帧就没人再调 `tick`）
    env.requestRender();
  },

  /**
   * 抬手收屏 —— 这一屏**没有可点的控件**，落在哪儿都退。
   *
   * @source VA 0x0042b3fa..0x0042b412（窗口过程 `fcn_0042b3eb` 的消息分派）：
   * ```asm
   * 0042b3fa  cmp eax, 0x202 ; jbe 0x42b524   ; WM_LBUTTONUP → 退屏
   * 0042b407  cmp eax, 0x205 ; jbe 0x42b524   ; WM_RBUTTONUP → 退屏
   * ```
   * 两条都落到 `dismiss` 引的那一支。
   *
   * ⚠️ **没有 `0x201`（按下）那一条** —— 它落到 VA 0x0042b580 的 DefWindowProc，
   *   什么都不做，所以本屏**不实现 `down`**。`0x100`（WM_KEYDOWN）同样落到
   *   DefWindowProc：原版键盘也关不掉这一屏（本屏因此**不实现 `hotkey`**，
   *   见 `docs/deviations/T-031.md` 的 `D-T031-5`）。
   */
  up(_x: number, _y: number, env: UiScreenEnv): void {
    dismiss(env);
  },
};
