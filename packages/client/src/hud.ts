/*
 * 侧栏与小地图 —— 照原版布局画
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**只读**状态，不含任何规则。
 *
 * 原版的右侧栏是一张 200×280 的整图（`Panel.mkf` 资源 0），
 * 六张一组：
 *   图 0..3 = 資金 / 地產 / 股票 / 其他 四个标签页，
 *             每页三条横栏，左端各带一个图标（錢袋 / 存錢罐 / 金幣堆 …），
 *             右边缘是四个彩色竖标签（青 / 蓝 / 红 / 金）
 *   图 4    = 200×80 的窄版
 *   图 5    = 不带竖标签的版本
 * 这与游戏截图里的右栏完全一致，故数值只需按栏位写上去即可，
 * 不必自己画框。
 */

import {
  ACTOR_DOLL,
  NPC_NAMES,
  PANEL_PAGE_COUNT,
  SPECIAL_ACTOR_BASE,
  daysInMonth,
  isAlive,
  isHoliday,
  sceneOfMonth,
  weekdayOf,
  type GameState,
  type Rich4Map,
} from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import { DeferredSpriteClose, portraitResource, type Sprite, type SpriteCache } from './assets.ts';
import type { Camera } from './render.ts';
import { FONT_FAMILY } from './font.ts';
import { currency } from './panel.ts';
import { MINIMAP_MARK_RESOURCE, drawMinimapMarks, minimapMarks } from './minimap-marks.ts';
import { drawSprite } from './hd-stage.ts';

/** 侧栏整图尺寸 @source Panel.mkf 资源 0 的图 0 */
export const PANEL_WIDTH = 200;
export const PANEL_HEIGHT = 280;

/**
 * 右下角那块 200×200。
 *
 * ★ 它**不是**我们自己加的调试小地图位，原版就有，而且是**可切换**的：
 * ```
 * RICH4.CFG  offset 5:  00 日曆   01 小地圖   02 兩者輪流
 * ```
 * （@source rich4-re/docs/rich4_cfg.txt —— 配置文件的字段说明。
 *   ⚠️ 其中「02 兩者輪流」是猜错的：02 是設定屏的「組合畫面」，三块同屏，见 `sidebarLayout`。）
 *
 * 日曆那一面的底图就在 `Panel.mkf` 资源 2：
 * - 图 0..3 四季实景，**不带**日曆框（另有他用）
 * - 图 4..7 同样四季，带太阳/月亮与 `S M T W T F S` 那条星期栏 ← 游戏里用的是这组
 * - 图 8/9  24×23 亮/暗太阳；图 10/11 20×20 亮/暗月亮（盖在底图那两个上面）
 */
export const SIDEBAR = { x: 0, y: PANEL_HEIGHT, w: 200, h: 200 } as const;

/**
 * 日曆那一面的版式 —— **全部**取自 exe。日期与節日的算法在 core 的
 * `places/calendar.ts`（那边有完整的出处），这里只放坐标。
 *
 * 原版把这块 200×200 的绘制分成两个版式（@source VA 0x00416a0a 起）：
 *
 * **日曆**（@source VA 0x00416b4c 起）
 * ```asm
 * 00416b7c  底图 = 资源2[ 月份季节表[月-1] ]        ; 图 0..3，纯实景
 * 00416b98  draw(..., 0x1b8, 0x118)                 ; (440, 280) ← 侧栏原点
 * 00416c29  draw(资源2 图8,  0x1ce, 0x12c)          ; 太阳 (462, 300)
 * 00416c4b  draw(资源2 图11, 0x1ec, 0x12d)          ; 月亮 (492, 301)
 * 00416cbf  draw(星期名[今天], 0x1c6, 0x160, 3)      ; (454, 352)
 * 00416d27  draw("%d"  日,  0x1f4, 0x178, 2)        ; (500, 376)
 * 00416d72  draw("%d"  年,  0x244, 0x120, 0)        ; (580, 288)
 * 00416dc7  draw("%d月" 月,  0x1f4, 0x148, 2)        ; (500, 328)
 * ```
 *
 * **月曆**（@source VA 0x00416a0a 起）
 * ```asm
 * 00416a38  底图 = 资源2[ 季节 + 4 ]                ; 图 4..7，带星期栏
 * 00416aa1  esi = 23 × (该月1号是星期几) + 0x1d6    ; 第一格中心 x = 470 + 23w
 * 00416aa7  edi = 0x17a                             ; 第一行 y = 378
 * 00416ad3  今天：填 (x−10, y−6, 20, 14) 红底
 * 00416b33  esi == 0x260(608) → esi = 0x1bf(447)，edi += 0xe(14)   ; 换行
 * 00416b44  esi += 0x17(23)                          ; 下一格
 * ```
 *
 * ★ 七个格心 x = 470..608（步进 23）减去侧栏原点 440 得 30..168，
 *   与底图上那条 `S M T W T F S` 的七个圆点**逐像素对得上**——
 *   两头独立地印证了同一套坐标。
 *
 * ★ 那几个 `draw(串, x, y, flag)` 的**末位 flag 是对齐方式**，语义在
 *   `0x44fabc` 里：`lea eax,[flag-1]` / `jmp [eax*4 + 0x44faa0]`，7 路跳表：
 *
 *   | flag | 水平 | 垂直 |
 *   |---|---|---|
 *   | 0 或 >7 | 左 | 上（**不调整**）|
 *   | 1 | 右 | 上 |
 *   | **2 / 3 / 4** | **中** | **中** |
 *   | 5 | 左 | 中 |
 *   | 6 | 右 | 中 |
 *   | 7 | 中 | 下 |
 *
 *   即 `x`/`y` 是**文字块的中心**（flag 0 除外，那是左上角）——不是左边缘。
 *   这条先前靠截图反推过，读跳表后得到确证。
 */
/**
 * `_rich4_draw_text` 的**对齐标志** —— 逐条实读跳表得来的，不是推断。
 *
 * @source `VA 0x0044fabc` 的末段：`lea eax,[flag-1] / cmp eax,6 / ja skip /
 *   jmp [eax*4 + 0x44faa0]`，即**按 `flag − 1` 索引**的 7 路跳表；
 *   `esi` = 文字宽 + 1、`ebx` = 文字高 + 1，`[esp+0xac]` = x、`[esp+0xb0]` = y。
 *
 *   | flag | 目标 | 做什么 |
 *   |---|---|---|
 *   | 0 | （`ja` 跳过）| 不调整 → **左上** |
 *   | 1 | `0x44FF21` | `x -= 宽` → 右上 |
 *   | **2 / 3 / 4** | `0x44FF2A` → **落入** `0x44FF35` | `x -= 宽/2` 后**接着** `y -= 高/2` → **正中** |
 *   | 5 | `0x44FF35` | 左·垂直居中 |
 *   | 6 | `0x44FF42` | 右·垂直居中 |
 *   | 7 | `0x44FF4B` | 水平居中·底对齐 |
 *
 * ★ **flag 2/3/4 两轴都居中**：三条表项指向同一个 `0x44FF2A`，而那一段是
 *   `mov eax,esi / sar eax,1 / sub [esp+0xac],eax`，紧跟着**顺序**执行
 *   `0x44FF35` 的 `mov eax,ebx / sar eax,1 / sub [esp+0xb0],eax`
 *   （`0x44FF2E` 那条 `sub` 长 7 字节，正好接上 `0x44FF35` —— 中间没有跳转）。
 *   所以 **`x`/`y` 是文字块的中心**，用 CSS 就是 `textBaseline='middle'`。
 *
 * ⚠️ 本项目一度记成「flag 2/3/4 只调 x、y 是顶边」，并据此在日曆里按
 *   `textBaseline='top'` 画 日号/月/星期 —— 那是**把中心当成了顶边**，
 *   于是这几处文字整体**偏下半个行高**（60 号的日号偏下约 30px）。
 *   2026-09-15 回 exe 逐条核对后改正。
 */
export function alignFor(flag: number): {
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
} {
  switch (flag) {
    case 1:
      return { align: 'right', baseline: 'top' };
    case 2:
    case 3:
    case 4:
      return { align: 'center', baseline: 'middle' };
    case 5:
      return { align: 'left', baseline: 'middle' };
    case 6:
      return { align: 'right', baseline: 'middle' };
    case 7:
      return { align: 'center', baseline: 'bottom' };
    default:
      // flag 0 与 >7：不调整 = 左上角
      return { align: 'left', baseline: 'top' };
  }
}

export const CAL = {
  /** 日曆：太阳、月亮（侧栏内坐标） */
  sun: { x: 0x1ce - 440, y: 0x12c - 280 },
  moon: { x: 0x1ec - 440, y: 0x12d - 280 },
  /** 日曆：年 / 月 / 星期 / 日 */
  year: { x: 0x244 - 440, y: 0x120 - 280 },
  monthText: { x: 0x1f4 - 440, y: 0x148 - 280 },
  weekday: { x: 0x1c6 - 440, y: 0x160 - 280 },
  dayText: { x: 0x1f4 - 440, y: 0x178 - 280 },
  /** 月曆：格子 */
  grid: { x0: 0x1d6 - 440, y0: 0x17a - 280, pitch: 0x17, rowH: 0xe, cols: 7 },
  /** 月曆：今天的红底 */
  today: { dx: -10, dy: -6, w: 0x14, h: 0xe },
} as const;

/** 日曆用的两张小图 —— 太阳与（暗）月亮 @source 0x00416c29 / 0x00416c4b */
const SUN_IMAGE = 8;
const MOON_IMAGE = 11;

/**
 * 太阳与月亮**是按钮** —— 点它们切换「日曆 / 月曆」两个版式。
 *
 * @source VA 0x0041838c 起（棋盘窗口过程里鼠标落在**棋盘之外**的那一支）：
 * ```asm
 * 0041835f  cmp byte [0x49715d], 1     ; cfg+5 = 1（純小地圖）→ 两颗钮都不认
 * 00418366  je  skip
 * 0041836c  cmp esi, 0x1b8 / jle skip  ; x ≤ 440 → 不在侧栏
 * 00418378  cmp edx, 0x118 / jle skip  ; y ≤ 280 → 不在下面那块
 * 00418384  cmp edx, 0x120 / jl  end   ; y ∈ [288, 314]
 * 00418390  cmp edx, 0x13a / jg  end
 * 0041839c  cmp esi, 0x1c0 / jl  moon  ; ★ 太阳：x ∈ [448, 474]
 * 004183a4  cmp esi, 0x1da / jg  moon
 * 004183ac  cmp byte [0x497164], 0 / je end   ; 已经是日曆 → 什么都不做（连音效都不放）
 * 004183c4  mov byte [0x497164], 0            ; ★ 切到日曆
 * 004183d8  cmp esi, 0x1de / jl  end   ; ★ 月亮：x ∈ [478, 504]
 * 004183e4  cmp esi, 0x1f8 / jg  end
 * 004183f0  cmp byte [0x497164], 0 / jne end
 * 0041840c  mov byte [0x497164], 1            ; ★ 切到月曆
 * ```
 * 两处都 `play_sound_effect(1)`（`0x482322`）再 `fcn_004169bc` 重画侧栏。
 *
 * ★ 图号是写死的：日曆面画 **图 8（亮太阳）+ 图 11（暗月亮）**，
 *   `图 9 / 图 10`（暗太阳 / 亮月亮）**全程序一次都没用到** ——
 *   所以这两个钮**没有**「当前在哪一页」的亮暗提示。
 */
export const CAL_TOGGLE_HIT = {
  /** 太阳 = 切到日曆 @source `cmp esi, 0x1c0 / cmp esi, 0x1da` */
  sun: { x0: 0x1c0 - 440, x1: 0x1da - 440 },
  /** 月亮 = 切到月曆 @source `cmp esi, 0x1de / cmp esi, 0x1f8` */
  moon: { x0: 0x1de - 440, x1: 0x1f8 - 440 },
  /** 两颗共用同一段 y @source `cmp edx, 0x120 / cmp edx, 0x13a` */
  y0: 0x120 - 280,
  y1: 0x13a - 280,
} as const;

/** 点在太阳/月亮上返回要切到哪一面；没点中返回 null。坐标是**侧栏局部**（0..200） */
export function hitCalendarToggle(x: number, y: number): 'calendar' | 'month' | null {
  if (y < CAL_TOGGLE_HIT.y0 || y > CAL_TOGGLE_HIT.y1) return null;
  if (x >= CAL_TOGGLE_HIT.sun.x0 && x <= CAL_TOGGLE_HIT.sun.x1) return 'calendar';
  if (x >= CAL_TOGGLE_HIT.moon.x0 && x <= CAL_TOGGLE_HIT.moon.x1) return 'month';
  return null;
}
/** 月曆底图 = 季节 + 4 @source 0x00416a38 `lea ebx, [eax + 4]` */
const MONTH_VIEW_BASE = 4;
/** 假日与今天的颜色 @source 0x00416acc / 0x00416b01 `push 0xff0000` */
const HOLIDAY_COLOR = '#ff0000';
const PLAIN_COLOR = '#101010';

/** 星期名 @source 串表 `0x0047511c[0..6]` */
export const WEEKDAY_NAMES: readonly string[] = [
  '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六',
];

/** 月曆里一格的位置（側欄内坐标） */
export interface MonthCell {
  day: number;
  x: number;
  y: number;
}

/**
 * 一个月在月曆上占哪些格、各在哪 —— **纯函数**，绘制与测试共用。
 *
 * @source 0x00416aa1（第一格 x = `x0 + pitch × 1 号的星期`）
 *         0x00416b33（折行判据 `0x260 = 608` → 側欄坐标 `x0 + pitch×6`）
 *
 * ★ 抽成纯函数是因为它**错过一次**：折行判据写成 `x0 + pitch×cols`（第 8 列）
 *   而不是 `× (cols−1)`（第 7 列），于是每行画 8 天、整月逐行右移一格。
 *   这种错在画面上只是「日期对不上星期」，不细看根本发现不了 ——
 *   但一条「每行恰好 7 格」的断言当场就能抓住。
 */
export function monthCells(year: number, month: number): MonthCell[] {
  const total = daysInMonth(year, month);
  const first = weekdayOf(year, month, 1);
  const { x0, y0, pitch, rowH, cols } = CAL.grid;

  const cells: MonthCell[] = [];
  let col = first;
  let row = 0;
  for (let day = 1; day <= total; day++) {
    cells.push({ day, x: x0 + pitch * col, y: y0 + rowH * row });
    col++;
    if (col >= cols) {
      col = 0;
      row++;
    }
  }
  return cells;
}

/**
 * 日曆那一面的两个版式 —— 原版 `[0x497164]`（= `RICH4.CFG` +12）：0 日曆 / 1 月曆，
 * 由太阳/月亮两颗钮切换（见 `CAL_TOGGLE_HIT`）。**与 `cfg+5`（視窗）互相独立**：
 * 視窗决定「日曆那一面在不在屏上」，这一格决定「在的时候画哪个版式」。
 */
export type CalendarPage = 'calendar' | 'month';

// ============================================================
//  視窗三态（設定屏「視 窗」三选一 / 熱鍵「切換視窗組」）
// ============================================================

/**
 * `cfg+5`（`[0x49715d]`）三态下，小地图那 200×200 的**顶边**（屏幕 y；0 = 这一态不画小地图）。
 *
 * @source 表 `0x4752aa`（3 × dword）= `[0, 0x118, 0x50]` = `[0, 280, 80]`，
 *   `fcn_00416e6d` 开头 `movzx ebp, byte [cfg+5] / mov ebp, [ebp*4 + 0x4752aa] / test ebp, ebp / je ret`；
 *   命中（`0x00418436`）、箭头（`0x004184d5`）、拖动（`0x0041895b`）都查同一张表。
 */
export const MINIMAP_TOP_BY_VIEW = [0, 0x118, 0x50] as const;

/**
 * 右栏在某一个「視窗」取值下的版式。
 *
 * @source 棋盘窗口过程 WM_PAINT 那一支（VA **0x00418bcd**）按 `cfg+5` 三路分派：
 * ```asm
 * 00418bcd  mov al, [cfg+5]
 * ;  0 日、月曆  → 00418be2  fcn_00415f69(0)  整版四页面板（200×280）
 * ;                00418bee  fcn_004169bc(0)  日曆/月曆 @ (440,280)
 * ;  1 縮小地圖  → 00418bf5  fcn_00415f69(0)  整版四页面板
 * ;                00418c01  fcn_00416e6d(0)  小地图   @ (440,280)
 * ;  2 組合畫面  → 00418c08  fcn_004166f8(0)  ★ 窄版面板（200×80）
 * ;                00418c14  fcn_00416e6d(0)  ★ 小地图 @ (440, 80)
 * ;                00418c1e  fcn_004169bc(0)  ★ 日曆/月曆 @ (440,280)
 * ```
 * 三个画函数各自再守一道闸：`fcn_00415f69` 在 `cfg+5 == 2` 时直接 ret（`0x00415f83`），
 * `fcn_004166f8` 只在 `== 2` 时画（`0x0041670d`），`fcn_004169bc` 在 `== 1` 时 ret（`0x004169c3`）。
 *
 * ★ 所以「組合畫面」= **窄版面板 + 小地图 + 日曆三块同屏**（80 + 200 + 200 = 480），
 *   不是「日曆与小地图轮流」—— `RICH4.CFG` 说明里那句「02 兩者輪流」是**猜的**，exe 里
 *   没有任何按时间换面的代码（`[cfg+5]` 的 26 处引用里只有热键 `0x0040122e` 与設定屏会写它）。
 */
export interface SidebarLayout {
  /** 上面那块：`full` = 200×280 四页面板（`Panel.mkf` 0 图 0..3）；`compact` = 200×80 窄版（图 4） */
  panel: 'full' | 'compact';
  /** 小地图 200×200 的顶边（侧栏局部 y，侧栏原点 y = 0）；`null` = 这一态没有小地图 */
  minimapTop: number | null;
  /** 日曆/月曆那 200×200（恒在 y = 280）画不画 */
  calendar: boolean;
}

/** `cfg+5` → 版式。0 / 1 / 2 之外的值（坏档）按 0 处理 —— 原版会查表越界，这里不照抄 */
export function sidebarLayout(windowView: number): SidebarLayout {
  if (windowView === 1) return { panel: 'full', minimapTop: MINIMAP_TOP_BY_VIEW[1], calendar: false };
  if (windowView === 2) return { panel: 'compact', minimapTop: MINIMAP_TOP_BY_VIEW[2], calendar: true };
  return { panel: 'full', minimapTop: null, calendar: true };
}

/**
 * 点在小地图那 200×200 里吗？在就返回**小地图局部坐标**，不在返回 null。
 * 坐标是**侧栏局部**（侧栏原点 = 屏幕 (440, 0)）。
 *
 * @source VA 0x00418415（`fcn_00417e26` 的 WM_LBUTTONDOWN）：
 * ```asm
 * 00418415  mov ch, [cfg+5] / test ch, ch / je 不是小地图     ; 日、月曆那一态没有小地图
 * 00418423  cmp esi, 0x1b8 / jle …                           ; x > 440
 * 00418436  mov ecx, [cfg+5 × 4 + 0x4752aa]                  ; 顶边
 * 0041843c  cmp edx, ecx / jle …                             ; y > 顶
 * 00418444  lea ebx, [ecx + 0xc8] / cmp edx, ebx / jge …     ; y < 顶 + 200
 * ```
 */
export function hitMinimapArea(
  windowView: number,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const top = sidebarLayout(windowView).minimapTop;
  if (top === null) return null;
  // 照 exe 的开闭：x > 440（`jle`）、顶 < y（`jle`）< 顶 + 200（`jge`）；右缘 640 是屏幕边，这里补上侧栏宽
  if (x <= 0 || x >= SIDEBAR.w || y <= top || y >= top + SIDEBAR.h) return null;
  return { x, y: y - top };
}

/**
 * 「組合畫面」那块 200×80 窄版面板的版式 —— **全部**取自 `fcn_004166f8`（VA 0x004166f8）
 * 与开局时往图 4 上烙字的那一段（VA 0x00418043..0x004180a5）。坐标都已减去侧栏原点 440。
 *
 * ```asm
 * 00416748  blit(Panel.mkf 0 图4 = [0x48be0c]+0x3c, 0x1b8, 0)      ; 底图，不抠黑
 * 004167fb  fill(0x211, 0x21, 0x6a, 4, 黑)                           ; 名牌色条的黑边 (529,33) 106×4
 * 0041681f  fill(0x210, 0x20, 0x6a, 4, [0x496b6c + p×0x68] 角色色)         ; 色条 (528,32) 106×4
 * 00416837  blit_keyed(头像 = 角色图集 图0, 0x1e2, 0x28)              ; 锚点落在 (482,40)，与整版同一处
 * 00416898  font(0x14 = 20, 0x101010) ; draw(名字, 0x246, 0x10, 2)   ; (582,16) 正中
 * 004168ca  font(0xc = 12, 0x101010)
 * 004168de  num_to_currency(現金 [0x496b84 + p×0x68]) ; draw(…, 0x27a, 0x29, 1)   ; (634,41) 右上
 * 0041690a  num_to_currency(存款 [0x496b88 + p×0x68]) ; draw(…, 0x27a, 0x3f, 1)   ; (634,63) 右上
 * ; 开局烙在图 4 上的两个标签（`0x452946` 去掉串里的空格）：
 * 00418053  strip("現  金") ; draw(图4, …, 0x5a, 0x28, 0)            ; (90,40) 左上、12 号
 * 00418080  strip("存  款") ; draw(图4, …, 0x5a, 0x3e, 0)            ; (90,62)
 * ```
 * ★ 没有四个竖标签、没有物價指數、没有第三行 —— 这一态**不能换页**：
 *   PgUp/PgDn（`0x004014b1 cmp [cfg+5],2 / je 吃掉`）与点竖条（`0x004182fa`）都被闸掉。
 */
export const COMPACT = {
  /** `Panel.mkf` 资源 0 的图 4（200×80） */
  image: 4,
  w: 200,
  h: 80,
  barShadow: { x: 0x211 - 440, y: 0x21, w: 0x6a, h: 4 },
  bar: { x: 0x210 - 440, y: 0x20, w: 0x6a, h: 4 },
  portrait: { x: 0x1e2 - 440, y: 0x28 },
  name: { x: 0x246 - 440, y: 0x10, size: 0x14 },
  labels: [
    { text: '現金', x: 0x5a, y: 0x28 },
    { text: '存款', x: 0x5a, y: 0x3e },
  ],
  labelSize: 0xc,
  valueRight: 0x27a - 440,
  valueY: [0x29, 0x3f] as const,
  valueSize: 0xc,
} as const;

/**
 * 窄版面板那两行的文字：現金、存款 —— 与整版「資金」页前两行同一个格式函数
 * （`num_to_currency_string` VA 0x00452793，见 `panel.ts` 的 `currency`）。
 */
export function compactRows(p: { cash: number; moneyInBank: number }): readonly [string, string] {
  return [currency(p.cash), currency(p.moneyInBank)];
}

// ============================================================
//  侧栏画的是谁：玩家 / 惡人（替身回合）
// ============================================================

/**
 * 侧栏这一刻画谁 —— 两个面板（整版 `fcn_00415f69`、窄版 `fcn_004166f8`）开头**同一条判据**：
 *
 * ```asm
 * 00415fc1  mov eax, [0x49910c]            ; 当前行动者（窄版 0x00416767 同形）
 * 00415fc6  cmp eax, [0x499114] / jl 玩家   ; < 玩家数 ⇒ 玩家
 * 00415fd2  cmp eax, 8 / je 玩家            ; 8 = 機器娃娃 ⇒ 也画玩家
 * ;         —— 其余（4..7 四大惡人）走惡人那一版，见 `VILLAIN_PANEL`
 * 0041610d  cmp ebx, 8 / jne               ; 玩家那一支：
 * 00416118  movzx esi, byte [0x498e70]     ;   8 ⇒ 画替身记录 +8（主人）那位玩家
 * ```
 *
 * ★★ 第二十六份 panel #1：`[0x49910c]` = 惡人的那一段**不止补间在走的那几格**。侧栏只在整窗重画时才画，
 *   而惡人回合开头（`fcn_00418c55`，`0x00418d69 call 0x41d546` → `0x41906a(1)` → WM_PAINT）重画一次之后
 *   就不再碰侧栏，直到下一位行动者回合开头那次重画 ⇒ 走完之后的「小偷偷得…」框、受害者台词、
 *   **停留**不走的那一回合都画惡人那一版。本引擎一个惡人回合 = 一条 action，core 在那一条里交出
 *   `GameState.lastNpcTurn`（只活一条 action，见 `NpcTurnHint`）⇒ 由 `panelActorSlot` 取槽号。
 *   （先前按补间在走的那几格判 —— 走完就回到玩家、停留的惡人从不出现，已订正。）
 *   保釋那一下只摆到门口、不走（原版保釋不动 `[0x49910c]`）；小地图白框仍跟着补间走（`minimapFrameCenter`）。
 *
 * ★ 機器娃娃（槽 4）画 `[0x498e70]` = 用道具的人（`0x00446b7b [0x498e70] = [0x49910c]`，道具只能在
 *   自己回合用）⇒ 就是 `currentPlayer`。不读 `specialActors[4].owner`：core 走完那一趟就把娃娃
 *   收回 `idleActor()`（owner 清 0），补间播放时那一格已经不是主人了。
 *
 * @param npcSlot 此刻的行动者若是替身，其槽号（actor − 4，见 `panelActorSlot`）；`null` = 轮的是玩家
 */
export type PanelSubject =
  | { kind: 'player'; player: number }
  | {
      kind: 'villain';
      /** actor 号 4..7 */
      actor: number;
      /** 名字 @source 表 `0x47ed5a[actor]`（→ `0x46662c` 起：小偷 / 強盜 / 流氓 / 間諜）*/
      name: string;
      /** 替身记录 +8 主人（保釋他出来的人）—— 小头像画的是**他的** @source `0x0041603d byte [actor×16 + 0x498df0]` */
      owner: number;
    };

/**
 * 侧栏此刻的行动者是不是惡人 —— 是就给槽号（actor − 4），否则 `null`（画玩家）。
 *
 * 取的是 core 交出来的 `lastNpcTurn`（这一条 action 轮到的惡人，只活一条 action ⇒ 从轮到他那一刻
 * 起、到下一位行动者那条 action 为止 = 原版 `[0x49910c]` 停在他身上、侧栏没被重画走的那一段）。
 * 单机 / 联机同一份状态、同一条判据（各端重放同一串 action ⇒ 同一份提示）。
 */
export function panelActorSlot(state: Pick<GameState, 'lastNpcTurn'>): number | null {
  const actor = state.lastNpcTurn?.actor;
  if (actor === undefined) return null;
  const slot = actor - SPECIAL_ACTOR_BASE;
  return slot >= 0 && slot < NPC_NAMES.length ? slot : null;
}

export function panelSubject(state: GameState, npcSlot: number | null | undefined): PanelSubject {
  if (npcSlot === null || npcSlot === undefined) return { kind: 'player', player: state.currentPlayer };
  const actor = SPECIAL_ACTOR_BASE + npcSlot;
  // @source 0x00415fc6 `jl` / 0x00415fd2 `je 8`：替身号 ≥ 4 ≥ 玩家数，只剩娃娃那一格回到玩家
  if (actor === ACTOR_DOLL || actor < state.players.length) {
    return { kind: 'player', player: state.currentPlayer };
  }
  return {
    kind: 'villain',
    actor,
    name: NPC_NAMES[npcSlot] ?? '',
    owner: state.specialActors[npcSlot]?.owner ?? 0,
  };
}

/**
 * 惡人回合的面板 —— 两版都**只有**底图、名字、主人的小头像，**不画任何数值行**。
 *
 * ```asm
 * ; 整版 0x00415fdb..0x00416061
 * 00415fdb  blit([0x48be0c]+0x48, 0x1b8, 0)     ; ★ Panel.mkf 0 的图 5（(0x48−0xc)/0xc；图 0 = +0xc）
 * 00416004  font(0x16 = 22, 0x101010)
 * 00416026  draw_text(表 0x47ed5a[actor], 0x246, 0x28, flag 2)    ; (582,40) 正中
 * 0041605c  blit_keyed([0x498eb0 + 主人×0x34] + 0x18, 0x20c, 0x40) ; 主人图集图 1 → 锚点 (524,64)
 * ; 窄版 0x00416779..0x004167e4（底图图 4 已在分支之前画了，`0x00416748`）
 * 00416786  font(0x14 = 20, 0x101010)
 * 004167a6  draw_text(同一张表, 0x246, 0x14, flag 2)              ; (582,20) 正中
 * 004167dc  blit_keyed(同上小头像, 0x20c, 0x40)
 * ```
 * 图 5 = 200×280、三条横栏带图标、**没有**右缘四个竖标签；开局烙字（`0x00417eba`）只烙图 0..4，
 * 图 5 上没有行标签。整版这一支也不画竖标签与物價指數（都在玩家那一支里）。
 * 窄版的「現金 / 存款」两个标签是烙在图 4 上的，所以照样看得见，只是没有数。
 */
export const VILLAIN_PANEL = {
  /** 整版底图 = `Panel.mkf` 资源 0 的图 5 @source 0x00415fe7 `add eax, 0x48` */
  image: 5,
  name: { x: 0x246 - 440, y: 0x28, size: 0x16 },
  compactName: { x: 0x246 - 440, y: 0x14, size: 0x14 },
} as const;

/**
 * (524,64) 那颗**小头像** = 角色图集（`map.mkf` 角色 + 0x1b）的**图 1**（约 30..41 × 30..35，`+0x18`）。
 * 两处用它：惡人回合画主人的（见 `VILLAIN_PANEL`），玩家回合结盟期间画盟友的：
 *
 * ```asm
 * ; 整版 0x00416256..0x00416285（窄版 0x0041685a..0x0041688b 逐字同形）
 * 00416256  mov dl, byte [p×0x68 + 0x496ba9]   ; +0x41 allied_player（对方下标 + 1 = core `alliedPlayer`）
 * 0041625c  test dl, dl / je 跳过
 * 0041626b  dec eax / imul eax, 0x34 / mov eax, [eax + 0x498eb0] / add eax, 0x18
 * 00416280  blit_keyed(…, 0x20c, 0x40)         ; 锚点 (524,64)
 * ```
 * 画在大头像与名牌色条**之后**、名字**之前**（名字压在它上面）。
 */
export const MINI_PORTRAIT = { image: 1, x: 0x20c - 440, y: 0x40 } as const;

/** 结盟期间要画谁的小头像（`alliedPlayer` = 玩家号 + 1，0 = 没有）；没有返回 null */
export function allyPortraitPlayer(p: { alliedPlayer: number } | undefined): number | null {
  if (p === undefined || p.alliedPlayer === 0) return null;
  return p.alliedPlayer - 1;
}


// ============================================================
//  四页（資金 / 地產 / 股票 / 其他）
// ============================================================

/**
 * 四个 tag 的位置与文字。
 *
 * **位置**来自 exe —— @source VA 0x00416123：
 * ```asm
 * mov edx, [esp + ebx*4 + 0x94]      ; 该 tag 的 y（局部数组）
 * add edx, 0x14(20)
 * push 3 / push edx / push 0x273     ; x = 627、flag 3（正中）
 * mov edi, [ebx*4 + 0x475274]        ; 串表：資金/地產/股票/其他
 * ```
 * y 表在 `0x415d0d`（`[15, 88, 158, 230]`）再各 **+20** → 中心 35 / 108 / 178 / 250。
 * ★ 与从 `Panel.mkf` 资源 0 图 0 上**实测**的四条彩色竖条中心
 *   （34.5 / 105.5 / 177.5 / 247.5）逐条吻合，故 exe 的 y 就是竖条中心，保留。
 *
 * **画法**由需求方 2026-09-15 指定，与我们的 exe **不同**：
 * **竖排、白字、字号小一号**（exe 是横排、深色 `0x101010`/`0x404040`、字号 18）。
 * 需求方的实机截图上是白字竖排 —— 与我们 exe 属不同 build，
 * 位置/颜色/排法按需求方定的来，exe 的那套值记在这里备查。
 */
export const PANEL_TAGS = [
  { label: '資金', y: 35 },
  { label: '地產', y: 108 },
  { label: '股票', y: 178 },
  { label: '其他', y: 250 },
] as const;
/** tag 文字的 x（侧栏局部）@source `push 0x273` → 627 − 440 */
export const PANEL_TAG_X = 0x273 - 440;
/**
 * tag 字号 —— **需求方指定「小一点」**（exe 是 0x12 = 18，横排）。
 * 竖排两字时块高 2×14 = 28，正好放进 58 高的竖条；字宽 14 也不超出约 28 的条宽。
 */
const PANEL_TAG_SIZE = 14;
/** 竖排的字距（= 字号，让两字刚好相接） */
const PANEL_TAG_LINE = PANEL_TAG_SIZE;
/**
 * tag 文字色 —— **按 exe**。2026-09-15 需求方改口：先前照实机截图用的是白色，
 * 现在按 exe 改回**深色**。
 *
 * @source VA 0x004161a5 / 0x004161f1：
 * ```asm
 * 004161e7  mov al, byte [esi + 0x48be24]   ; 该玩家当前页
 * 004161ed  cmp ebx, eax                    ; ebx = tag 序号
 * 004161ef  jne 0x4161a5
 * 004161f1  mov eax, 0x101010               ; ★ 当前页 = 近黑
 * 004161f6  jmp 0x4161aa
 * 004161a5  mov eax, 0x404040               ; ★ 其余 = 深灰
 * ```
 */
const PANEL_TAG_COLOR_CURRENT = '#101010';
const PANEL_TAG_COLOR_OTHER = '#404040';

/**
 * 四条彩色竖条的**命中条**（侧栏局部坐标）。
 *
 * @source VA 0x004182fa —— 棋盘区之外的鼠标按下会落到这一支：
 * ```asm
 * cmp esi, 0x268          ; x < 616 → 不是标签
 * jl  skip
 * cmp edx, 0x118          ; y ≥ 280 → 不是标签
 * jge skip
 * mov ebx, 0x46           ; 70
 * mov eax, edx ; idiv ebx ; ★ 页号 = y / 70
 * cmp eax, 该玩家当前页   ; ★ 已经是这页 → 什么都不做（连音效都不放）
 * je  skip
 * play_sound_effect(0x482322) ; 确认音
 * mov byte [player + 0x48be24], bl   ; 换页
 * call fcn_00415f69                  ; 重画面板
 * ```
 * 即：**最右 24px（局部 x∈[176,200)）、整条 280 高、每 70 一格**。
 * 四格的页号与四条竖条的中心（35 / 108 / 178 / 250）一一对得上。
 *
 * ★ 原版这一支前面有 `cfg+5 == 2` 的闸门 —— 組合畫面画的是 200×80 窄版面板（`fcn_004166f8`），
 *   没有竖条，那一段 y 是小地图。本函数只管几何，闸门在调用方（`main.ts` 按 `sidebarLayout(…).panel`）。
 */
export const PANEL_TAG_HIT = { x: 176, h: 70, count: 4 } as const;

/** 点在第几条彩色竖条上；没点中返回 null（坐标是**侧栏局部**） */
export function hitPanelTag(x: number, y: number): number | null {
  if (x < PANEL_TAG_HIT.x || x >= PANEL_WIDTH) return null;
  if (y < 0 || y >= PANEL_TAG_HIT.h * PANEL_TAG_HIT.count) return null;
  return Math.floor(y / PANEL_TAG_HIT.h);
}

/**
 * 四页各自的三行标签。
 *
 * @source VA 0x00417eba 起 —— 原版在开局时把 12 个标签**用代码画进那四张页面图**
 *   （`rich4_draw_text(页面图, 串, 10, y, 0)`），所以 `Panel.mkf` 资源 0 的图里
 *   只有图标、没有文字。串表在 VA `0x463920` 起：
 *   `現  金 / 存  款 / 總資產 / 土  地 / 連鎖店 / 設  施 / 總市值 / 成  本 / 經營權 / 點  卷 / 貸  款 / 保險期`
 *   （串里带双空格是为了对齐，照抄），画的位置 x = 10、y = 80 / 145 / 208、字号 12、flag 0。
 */
export const PANEL_ROWS: readonly (readonly [string, string, string])[] = [
  ['現  金', '存  款', '總資產'],
  ['土  地', '連鎖店', '設  施'],
  ['總市值', '成  本', '經營權'],
  ['點  卷', '貸  款', '保險期'],
];
/** 行标签的 x / y（侧栏局部）@source VA 0x00417eba 的 `push 0xa` 与 `push 0x50/0x91/0xd0` */
export const PANEL_ROW_LABEL_X = 0xa;
export const PANEL_ROW_LABEL_Y = [0x50, 0x91, 0xd0] as const;
/** 行标签字号 @source `push 0xc` */
const PANEL_LABEL_SIZE = 0xc;
/**
 * 每页三行数值的**顶端** y 与右对齐 x。
 * @source `fcn_00415f69` 的四个页处理函数：一律 `push 1 / push y / push 0x258(600)`，
 *   flag 1 = 右上 —— 即 `y` 是文字块的**顶边**，x 是右缘。
 *
 * ★ 底图上那三条浅蓝横栏的 y 范围约 `96..128 / 160..192 / 224..256`
 *   （中心 112 / 176 / 240，间距 64）；22 号字落在顶边 102 时视觉中心正好
 *   ≈ 112 —— **两套数一致**，别只信一套。
 */
export const PANEL_VALUE_RIGHT = 0x258 - 440;
export const PANEL_VALUE_Y = [0x66, 0xa6, 0xe6] as const;
/** 数值字号 @source `push 0x16` */
const PANEL_VALUE_SIZE = 0x16;

export interface HudInput {
  state: GameState;
  map: Rich4Map;
  camera: Camera;
  /** 小地图底图（`map.mkf` 资源 `地图号+0x10` 图 0，200×200）；null 时只画节点 */
  minimapBg: ImageBitmap | null;
  /**
   * 設定屏「視 窗」三选一 = `RICH4.CFG` +5（`[0x49715d]`）：0 日、月曆 / 1 縮小地圖 / 2 組合畫面。
   * 版式见 `sidebarLayout`。
   */
  windowView: number;
  /** 日曆那一面画哪个版式（`[0x497164]`）；这一态没有日曆时不看 */
  calendarPage: CalendarPage;
  /**
   * 小地图上的**标记点**（世界坐标）—— 点小地图留下的十字位置。
   * null 表示没有。
   * @source 原版 `[0x48be18]`（非 0 表示有标记）+ `[0x48be1c]`/`[0x48be20]`（坐标）
   */
  minimapMarker: { x: number; y: number } | null;
  /**
   * 此刻**正在走的替身**（娃娃 / 四大惡人）的世界坐标 —— 这时小地图白框框它，不框玩家
   * （见 `minimapFrameCenter`）。`null` = 轮的是玩家。缺省按 `null`。
   */
  npcFrame?: { x: number; y: number } | null;
  /**
   * 此刻行动者（`[0x49910c]`）若是替身，其**槽**（actor − 4；0..3 四大惡人、4 機器娃娃）—— 侧栏据此换成
   * 惡人那一版（见 `panelSubject`；`main.ts` 传 `panelActorSlot(state)`）。`null` / 缺省 = 轮的是玩家。
   */
  npcSlot?: number | null;
  /** 正被按下的箭头（1 = 左，2 = 右）；没按返回 null */
  pressedMinimapArrow: MinimapArrowId | null;
  /** 鼠标悬停的箭头；没悬停返回 null */
  hotMinimapArrow: MinimapArrowId | null;
  /**
   * 今天若逢節日，那张专属插画（`Data.mkf` 的 200×200 裸位图）——
   * 整张盖掉季节底图。非節日或无图时给 null。
   * @source VA 0x00416baf 起
   */
  holidayArt: ImageBitmap | null;
  /**
   * 側欄现在显示第几页（0 資金 / 1 地產 / 2 股票 / 3 其他）。
   * **每个玩家一份**（原版 `0x48be24 + 玩家号`），由 PgUp/PgDn 切换。
   */
  panelPage: number;
  /** 该页三行的文字（已按该页的格式排好），与 `PANEL_ROWS[page]` 一一对应 */
  panelRows: readonly string[];
}

/**
 * 点在右下角那块 200×200 上吗？
 *
 * ★ **原版点这块只是「点」，不会换面。** 换面只有两条路：
 *   RICH4.CFG offset 5 的设定，或 `HOTKEY.switchOption`/`switchWindowGroup`
 *   那对热键（VA 0x00401219 起，`[0x49715d] = ([0x49715d] + 1) % 3`）。
 *   先前「点一下换一面」是我们自己加的（`C-FID-1` 禁止的改良），已去掉。
 */
export function hitSidebar(x: number, y: number): boolean {
  return x >= SIDEBAR.x && x < SIDEBAR.x + SIDEBAR.w
    && y >= SIDEBAR.y && y < SIDEBAR.y + SIDEBAR.h;
}

// ============================================================
//  小地圖（側欄右下角那 200×200）
// ============================================================

/**
 * 世界坐标 → 小地图局部坐标（0..200）。
 *
 * @source VA 0x00416fb9（侧栏小地图）与 0x0040a8a1（独立小地图窗口），
 *   两处是同一段被编译出来的定点乘法：
 * ```asm
 * mov cx, word [player + 8]      ; 世界 x
 * mov eax, ecx
 * shl eax, 2 / sub eax, ecx      ; ×3
 * shl eax, 2 / sub eax, ecx      ; ×11
 * shl eax, 3 / add eax, ecx      ; ×89
 * shl eax, 6                     ; ×64
 * sar eax, 0x10                  ; (x×89×64) >> 16 == (x×89) >> 10 == x × 89/1024
 * lea esi, [eax + 0x1b8]         ; + 440 ← 侧栏原点
 * ```
 * 独立窗口那处 `shl eax, 7`（`>> 9`），正好是这里的**两倍** ——
 * 因为它是 400×400、这里是 200×200。
 *
 * ★ 2304 × 89 ÷ 1024 = 200.25 → 取整 200。世界宽 2304、这块 200 见方，
 *   这套整数运算就是原版「把整张图塞进 200×200」的写法。**别改成
 *   `size / worldW` 的浮点**：差 0.1%，逐像素对不齐。
 */
export const MINIMAP_NUM = 89;
export const MINIMAP_SHIFT = 10;

/** 世界坐标 → 小地图局部坐标（照原版的整数运算） */
export function minimapAt(world: number): number {
  return (world * MINIMAP_NUM) >> MINIMAP_SHIFT;
}

/**
 * 小地图**局部坐标 → 世界坐标** —— 点小地图时用。
 *
 * @source VA 0x00418591（按下）与 0x0041899b（拖动），同一段定点乘法：
 * ```asm
 * mov eax, ebx                   ; ebx = 局部 x
 * shl eax, 2 / sub eax, ebx      ; ×3
 * shl eax, 0xd                   ; ×8192
 * mov ebx, eax
 * shl eax, 5 / sub eax, ebx      ; ×31
 * sar eax, 0x10                  ; (x×3×8192×31) >> 16 == x × 93/8
 * ```
 * ★ 它与 `minimapAt` **不是精确互逆**（93/8 = 11.625 对 1024/89 = 11.5056，
 *   差 1%）。原版就是这样，照抄 —— 自己「修正」成互逆反而与原版不符。
 */
export const MINIMAP_INV_NUM = 93;
export const MINIMAP_INV_DEN = 8;

/** 小地图局部坐标 → 世界坐标（照原版的整数运算） */
export function minimapToWorld(local: number): number {
  return Math.trunc((local * MINIMAP_INV_NUM) / MINIMAP_INV_DEN);
}

/**
 * 点小地图时，镜头中心被夹在这个区间。
 *
 * @source VA 0x004185d8 起：算出世界坐标后逐轴夹紧 ——
 * ```asm
 * cmp ebx, 0xdc(220)   / jge … / mov [0x48be1c], 0xdc
 * cmp ebx, 0x824(2084)/ jle … / mov [0x48be1c], 0x824
 * ```
 * `220 … 2084` 正是 `[220, 2304 − 220]`：棋盘区宽 440，镜头中心离边 220
 * 时视口刚好贴住世界边界（VA 0x00417f98 `set_draw_area(0, 40, 440, 480)`）。
 */
export const MINIMAP_CENTER_MIN = 0xdc; // 220
export const MINIMAP_CENTER_MAX = 0x824; // 2084

export function clampCameraCenter(world: number): number {
  return Math.min(MINIMAP_CENTER_MAX, Math.max(MINIMAP_CENTER_MIN, world));
}

/**
 * 小地图左上角那两颗**左右箭头**（转视角）。
 *
 * @source VA 0x00418415（命中，`fcn_00417e26` 的 WM_LBUTTONDOWN 分支）：
 * ```asm
 * sub ebx, 0x1b8          ; ebx = 局部 x
 * sub esi, ecx            ; esi = 局部 y（ecx = 该态侧栏顶边，见 0x4752aa）
 * cmp ebx, 3    / jl  → 落回「主体」
 * cmp ebx, 0x35 / jg  → 落回「主体」      ; 3 <= x <= 53
 * cmp esi, 3    / jl  → 落回「主体」
 * cmp esi, 0x1c / jg  → 落回「主体」      ; 3 <= y <= 28
 * lea edx, [ebx - 3]
 * mov ebx, 0x19(25) ; idiv ebx ; inc eax  ; ★ 编号 = (x-3)/25 + 1
 * ```
 * 画的时候是 `443 + 25×(编号-1)`（VA 0x00416e89 与 0x00416e9c 分别
 * `+0xfc`(图20) 与 `+0x108`(图21)），与局部 3、28 逐像素吻合。
 */
export const MINIMAP_ARROW = { x: 3, y: 3, w: 25, h: 26 } as const;

/** 箭头编号 → 侧栏局部矩形（1 = 左，2 = 右） */
export function minimapArrowRect(id: MinimapArrowId): { x: number; y: number; w: number; h: number } {
  return {
    x: MINIMAP_ARROW.x + (id - 1) * MINIMAP_ARROW.w,
    y: MINIMAP_ARROW.y,
    w: MINIMAP_ARROW.w,
    h: MINIMAP_ARROW.h,
  };
}

export type MinimapArrowId = 1 | 2;

/**
 * 局部坐标落在哪颗箭头上；不在箭头上返回 null。
 *
 * ★ 原版的判据是 `x ∈ [3, 53]`，比两颗按钮合起来（3..52）**宽 1 像素**，
 *   那一像素会算出编号 3 —— 而编号只在 WM_LBUTTONUP 的
 *   `cmp bl,1 / cmp bl,2`（VA 0x004186f3）处被读，所以编号 3 是死区。
 *   这里照原样返回 null。
 */
export function hitMinimapArrow(localX: number, localY: number): MinimapArrowId | null {
  const { x, y, w, h } = MINIMAP_ARROW;
  if (localX < x || localX > x + 2 * w) return null;
  if (localY < y || localY > y + h - 1) return null;
  const id = Math.floor((localX - x) / w) + 1;
  return id === 1 || id === 2 ? id : null;
}

/** 局部坐标落在小地图**本体**上（不是箭头条，也不是框外） */
export function hitMinimapBody(localX: number, localY: number): boolean {
  if (localX < 0 || localX >= SIDEBAR.w) return false;
  if (localY < 0 || localY >= SIDEBAR.h) return false;
  return hitMinimapArrow(localX, localY) === null;
}

/**
 * 小地图上那两颗箭头的图 —— `Data.mkf` 资源 517。
 * @source VA 0x00407fdc `[0x48bad8] = read_mkf(Data.mkf, 0x205, 0, 0)`
 */
export const MINIMAP_ARROW_RESOURCE = 0x205;
/**
 * 图的编号。常态在 VA 0x00416e89/0x00416e9c 由偏移 `+0xfc`/`+0x108` 得出：
 * `(偏移 − 0x0c) / 12`（精灵表每张 12 字节头，从 `+0x0c` 起）→ **20 / 21**。
 * 高亮态在 VA 0x00418415 处是 `[0x48bad8] + 0x0c + 12 × (编号 + 0x11)` → **18 / 19**。
 */
export const MINIMAP_ARROW_IMAGE = {
  normal: { 1: 20, 2: 21 },
  hot: { 1: 18, 2: 19 },
} as const;

/**
 * 取景框与标记框的边长 —— **30×30 像素**。
 * @source VA 0x00417041（取景）与 0x004170c7（标记），两处都
 *   `push 0x1e(30) / push 0x1e(30)`，并各自 `−0xf(15)` 居中。
 *
 * ★ 它框的是**当前玩家那个圆点**，不是「视口能看到的世界范围」——
 *   先前我们画成 29 格宽的窗口，那是自己想的（原版没有这个东西）。
 */
export const MINIMAP_BOX = 30;

export class Hud {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  readonly #ready = new Map<string, Sprite | null>();
  readonly #pending = new Set<string>();
  /**
   * 淘汰下来、等着帧边界释放的精灵（Q-PERF-1 的另一半）。
   *
   * ⚠️ 缓存的淘汰**只把它自己那张表里的条目移走**，真正占内存的 `ImageBitmap`
   *   仍被本类这份 `#ready` 握着 —— 不接这条监听，侧栏那 ≤ 30 张图就永远放不掉。
   *   与 `BoardRenderer` 同一条推理：淘汰回调跑在**两帧之间**的解码微任务里，
   *   这时 `draw()` 不可能正在跑；真正 `close()` 推迟到下一帧 `draw()` 的**开头**，
   *   于是绝不会把正在画的那一帧弄成空白。
   */
  readonly #evicted = new DeferredSpriteClose();
  #dirty = false;
  /** 解码落地时叫一声 —— 理由同 `BoardRenderer.#onReady` */
  #onReady: (() => void) | null = null;

  constructor(ctx: CanvasRenderingContext2D, sprites: SpriteCache) {
    this.#ctx = ctx;
    this.#sprites = sprites;
    // ★ 与 `render.ts` 一样**在构造里自己挂**（缓存是 `main.ts` 造的，本类拿得到同一份）。
    //   两个持有者各挂一条：`addEvictListener` 是**列表**，后挂的不会挤掉先挂的
    //   （同一张精灵被两边都持有时会各排一次队，`ImageBitmap.close()` 幂等，无副作用）。
    sprites.addEvictListener((sprite) => {
      this.#evicted.retire(this.#ready, sprite);
    });
  }

  /**
   * 帧边界：把淘汰下来排着队的精灵真正关掉。
   *
   * `draw()` 开头自动调一次；单独暴露出来是为了让测试能只验这一步（不必造画布）。
   */
  drainEvicted(): number {
    return this.#evicted.drain();
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

  /** 同步取精灵；未就绪时后台解码并返回 null */
  #sprite(
    archive: 'Panel.mkf' | 'map.mkf' | 'Data.mkf',
    res: number,
    idx: number,
    colorKeyBlack = false,
  ): Sprite | null {
    const key = `${archive}:${res}:${idx}:${colorKeyBlack ? 'k' : ''}`;
    const hit = this.#ready.get(key);
    if (hit !== undefined) return hit;
    if (!this.#pending.has(key)) {
      this.#pending.add(key);
      void this.#sprites.get(archive, res, idx, colorKeyBlack).then((s) => {
        this.#ready.set(key, s);
        this.#pending.delete(key);
        this.#dirty = true;
        this.#onReady?.();
      });
    }
    return null;
  }

  draw(input: HudInput): void {
    // ★ 帧边界（Q-PERF-1）：上一帧已经整个画完，现在才轮到 close。
    //   必须在**用**任何精灵之前 —— 本帧就不会去用一张刚关掉的位图。
    this.drainEvicted();
    const ctx = this.#ctx;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    // 顺序照 WM_PAINT 那一支（VA 0x00418bcd，见 `sidebarLayout`）：面板 → 小地图 → 日曆
    const layout = sidebarLayout(input.windowView);
    if (layout.panel === 'full') this.#drawPanel(input);
    else this.#drawCompactPanel(input);
    if (layout.minimapTop !== null) this.#drawMinimap(input, layout.minimapTop);
    if (layout.calendar) {
      if (input.calendarPage === 'month') this.#drawMonth(input);
      else this.#drawCalendar(input);
    }
  }

  /**
   * 「組合畫面」那块 200×80 窄版面板 —— 照 `fcn_004166f8`（VA 0x004166f8），版式见 `COMPACT`。
   *
   * ★ 与整版（`#drawPanel`）画的是**同一个人**、同一张头像、同一处锚点 (482,40)；
   *   只剩名字、名牌色条、現金、存款四样。
   */
  #drawCompactPanel(input: HudInput): void {
    const ctx = this.#ctx;
    const subject = panelSubject(input.state, input.npcSlot);

    // 底图在分支**之前**画（惡人那一支也是图 4）@source 0x00416748
    const bg = this.#sprite('Panel.mkf', 0, COMPACT.image);
    if (bg !== null) drawSprite(ctx, bg, 0, 0, COMPACT.w, COMPACT.h);
    else {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(0, 0, COMPACT.w, COMPACT.h);
    }

    if (subject.kind === 'villain') {
      // ★ 惡人回合：名字 + 主人的小头像，没有色条、没有数 @source 0x00416779..0x004167e4
      //   两个标签是开局烙进图 4 的（0x00418053 / 0x00418080），照样看得见
      this.#drawCompactLabels();
      ctx.fillStyle = '#101010';
      ctx.font = `${VILLAIN_PANEL.compactName.size}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(subject.name, VILLAIN_PANEL.compactName.x, VILLAIN_PANEL.compactName.y);
      this.#drawMiniPortrait(input.state, subject.owner);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      return;
    }
    const me = input.state.players[subject.player];
    if (me === undefined) return;

    // 名牌色条：先 1px 错开的黑底，再角色色 @source 0x004167fb / 0x0041681f
    const cc = CHARACTERS[me.character]?.color ?? 0xffffff;
    const { barShadow: sh, bar } = COMPACT;
    ctx.fillStyle = '#000000';
    ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
    ctx.fillStyle = `rgb(${(cc >> 16) & 0xff},${(cc >> 8) & 0xff},${cc & 0xff})`;
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);

    // 头像（抠黑、按锚点）@source 0x00416852
    const face = this.#sprite('map.mkf', portraitResource(me.character), 0, true);
    if (face !== null) {
      drawSprite(ctx, face, COMPACT.portrait.x - face.anchorX, COMPACT.portrait.y - face.anchorY);
    }
    // 结盟期间盟友的小头像 @source 0x0041685a..0x0041688b
    const ally = allyPortraitPlayer(me);
    if (ally !== null) this.#drawMiniPortrait(input.state, ally);

    // 名字：20 号、flag 2（正中）@source 0x00416898 / 0x004168b5
    ctx.fillStyle = '#101010';
    ctx.font = `${COMPACT.name.size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(CHARACTERS[me.character]?.name ?? `角色${me.character}`, COMPACT.name.x, COMPACT.name.y);

    this.#drawCompactLabels();

    // 現金 / 存款：12 号、flag 1（右上）@source 0x004168de / 0x0041690a
    const [cash, bank] = compactRows(me);
    ctx.font = `${COMPACT.valueSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText(cash, COMPACT.valueRight, COMPACT.valueY[0]);
    ctx.fillText(bank, COMPACT.valueRight, COMPACT.valueY[1]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 窄版两个标签（原版开局烙进图 4 的，这里每帧照同样坐标画）@source 0x00418053 / 0x00418080。
   * 画完 `textBaseline` 留在 `top`（后面的数值行接着用）。
   */
  #drawCompactLabels(): void {
    const ctx = this.#ctx;
    ctx.fillStyle = '#101010';
    ctx.font = `${COMPACT.labelSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const l of COMPACT.labels) ctx.fillText(l.text, l.x, l.y);
  }

  /** (524,64) 的小头像 = 那位玩家角色图集的图 1（抠黑、按锚点）—— 见 `MINI_PORTRAIT` */
  #drawMiniPortrait(state: GameState, player: number): void {
    const p = state.players[player];
    if (p === undefined) return;
    const img = this.#sprite('map.mkf', portraitResource(p.character), MINI_PORTRAIT.image, true);
    if (img !== null) drawSprite(this.#ctx, img, MINI_PORTRAIT.x - img.anchorX, MINI_PORTRAIT.y - img.anchorY);
  }

  /**
   * 日曆面 —— 大图 + 年月日星期。版式全部照 exe，见 `CAL`。
   *
   * ★ **節日那天整张换掉底图**：原版取 `Data.mkf` 里按
   *   `HOLIDAY_ART_BASE[地图号] + 節日序号` 算出的那张 200×200 插画盖上去
   *   （@source VA 0x00416baf 起，载入在 0x00416bf3、绘制在 0x00416c12）。
   *   非節日才画季节底图 —— 两者**互斥**，不是叠加。
   */
  #drawCalendar(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year, globalMapId } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    if (input.holidayArt !== null) {
      ctx.drawImage(input.holidayArt, ox, oy, w, h);
    } else {
      const bg = this.#sprite('Panel.mkf', 2, sceneOfMonth(month));
      if (bg !== null) drawSprite(ctx, bg, ox, oy, w, h);
      else {
        ctx.fillStyle = '#7f9fbf';
        ctx.fillRect(ox, oy, w, h);
      }
    }

    // 太阳与月亮 —— 图 0..3 没有烤这两个，所以这里必须画
    const sun = this.#sprite('Panel.mkf', 2, SUN_IMAGE, true);
    if (sun !== null) drawSprite(ctx, sun, ox + CAL.sun.x, oy + CAL.sun.y);
    const moon = this.#sprite('Panel.mkf', 2, MOON_IMAGE, true);
    if (moon !== null) drawSprite(ctx, moon, ox + CAL.moon.x, oy + CAL.moon.y);

    const holiday = isHoliday(globalMapId, year, month, day);
    /**
     * 按**对齐标志**画一条 —— 标志语义见 `alignFor`（flag 2/3 = 正中，故 y 是中心）。
     * `dy` 供竖排那几处逐字下移用。
     */
    const text = (
      s: string,
      at: { x: number; y: number },
      flag: number,
      font: string,
      fill: string,
      dy = 0,
    ): void => {
      const { align, baseline } = alignFor(flag);
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(s, ox + at.x, oy + at.y + dy);
      ctx.fillStyle = fill;
      ctx.fillText(s, ox + at.x, oy + at.y + dy);
    };
    // ★ 字号与对齐**全部**取自 exe（VA 0x00416cee..0x00416dd3）：
    //   `set_font` 紧挨在 `sprintf` 之前，作用于**紧接着的那一次** draw。
    //
    //   | 文字 | 字号 | flag | 对齐（查 0x44faa0 的跳表） |
    //   |---|---|---|---|
    //   | 日号 | `0x3c` = **60** | 2 | 正中 |
    //   | 年   | `0x18` = **24** | 0 | **左上**（flag 0 不调整，就是左上角）|
    //   | 月   | `0x1c` = **28** | 2 | 正中 |
    //   | 星期 | `0x10` = **16** | 3 | 正中 |
    //
    //   ⚠️ 先前这几个字号写的是 15 / 34，是从画面上目测的；年份还一度被改成居中
    //   （也是我的推断）。都以这段汇编为准。
    const small = `16px ${FONT_FAMILY}`;
    const dayFont = `60px ${FONT_FAMILY}`;

    // 年与月 —— 与月曆共用同一段（见 `#drawYearMonth`）
    this.#drawYearMonth(input);
    // ★ 星期名是**竖排**（一个字一行）。
    //
    //   这一条是**需求方的实机截图**定的（2026-09-15）：截图上「星期五」三个字上下叠着，
    //   与侧栏那四个 tag 是同一种排法。串表本身没有换行（`0x47511c` 指针表里
    //   「星期五」就是 6 字节 + NUL），所以竖排是**绘制侧**的事 ——
    //   与 tag 一样：`create_font` 的第 5 个参数（`[0x4762dc]`）为 1 时走竖排，
    //   走横排的那几处（货架、资产表标签）那一项都是 0。
    //
    //   ★ 竖排之后这一块只有 **16px 宽**，居中于局部 x=14 → 6..22，**正好在侧栏里**。
    //     （先前按横排算会得到 −10、以为要溢出到棋盘上 —— 那是读错排法导致的。）
    const wd = WEEKDAY_NAMES[weekdayOf(year, month, day)] ?? '';
    const wdFill = holiday ? HOLIDAY_COLOR : PLAIN_COLOR;
    const chars = [...wd];
    // 竖排：flag 3 = 正中，`CAL.weekday` 是**整块的中心**（不是首字的顶边）——
    // 与侧栏四个 tag 同一种摆法（tag 那边也是「整块以竖条中心为准」）。
    chars.forEach((ch, k) => {
      text(
        ch,
        { x: CAL.weekday.x, y: CAL.weekday.y },
        3,
        small,
        wdFill,
        (k - (chars.length - 1) / 2) * PANEL_TAG_LINE,
      );
    });
    // 日号 = flag 2（正中）
    text(String(day), CAL.dayText, 2, dayFont, holiday ? HOLIDAY_COLOR : PLAIN_COLOR);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 月曆面 —— 整月的格子。
   *
   * 底图 4..7 上那条 `S M T W T F S` 就是这个版式的表头，格子正好排在它下面。
   */
  #drawMonth(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year, globalMapId } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    const bg = this.#sprite('Panel.mkf', 2, MONTH_VIEW_BASE + sceneOfMonth(month));
    if (bg !== null) drawSprite(ctx, bg, ox, oy, w, h);
    else {
      ctx.fillStyle = '#7f9fbf';
      ctx.fillRect(ox, oy, w, h);
    }

    ctx.font = `12px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of monthCells(year, month)) {
      const { x, y } = cell;
      if (cell.day === day) {
        // @source 0x00416ad3：今天填一块红底
        ctx.fillStyle = HOLIDAY_COLOR;
        ctx.fillRect(ox + x + CAL.today.dx, oy + y + CAL.today.dy, CAL.today.w, CAL.today.h);
      }
      ctx.fillStyle = isHoliday(globalMapId, year, month, cell.day) ? HOLIDAY_COLOR : PLAIN_COLOR;
      if (cell.day === day) ctx.fillStyle = '#ffffff'; // 红底上要看得见
      ctx.fillText(String(cell.day), ox + x, oy + y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // ★ **月曆也要画年与月** —— 两个版式在 exe 里是**共用一条尾巴**的：
    //   日曆那支画完星期名与日号、月曆那支画完格子，**都跳/落到 0x00416d3b**，
    //   那一支才是画「年 + 月」的地方（`create_font(0x18)` → itoa(年) →
    //   `draw_text(x=0x244, y=0x120, flag 0)`；再 `create_font(0x1c)` →
    //   `sprintf("%d月")` → `draw_text(x=0x1f4, y=0x148, flag 2)`）。
    //   ⚠️ 先前只在日曆那面画了年月，月曆那面只有格子 —— 与需求方的原版截图对不上。
    this.#drawYearMonth(input);
  }

  /**
   * 年与月 —— **日曆与月曆两个版式共用** @source VA 0x00416d3b（年）/ 0x00416d86（月）。
   *
   * 年：24 号、（局部）左上 (140,8)、flag 0；月：28 号、水平居中 (60,48)、flag 2。
   */
  #drawYearMonth(input: HudInput): void {
    const ctx = this.#ctx;
    const { month, year } = input.state;
    const { x: ox, y: oy } = SIDEBAR;
    const line = (s: string, at: { x: number; y: number }, flag: number, size: number): void => {
      const { align, baseline } = alignFor(flag);
      ctx.font = `${size}px ${FONT_FAMILY}`;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(s, ox + at.x, oy + at.y);
      ctx.fillStyle = PLAIN_COLOR;
      ctx.fillText(s, ox + at.x, oy + at.y);
    };
    // 年 = flag 0（不调整 = 左上角）；月 = flag 2（**正中**，故 y 是中心）
    line(String(year), CAL.year, 0, 24);
    line(`${month}月`, CAL.monthText, 2, 28);
  }

  #drawPanel(input: HudInput): void {
    const ctx = this.#ctx;
    const subject = panelSubject(input.state, input.npcSlot);
    if (subject.kind === 'villain') {
      this.#drawVillainPanel(input.state, subject);
      return;
    }
    const me = input.state.players[subject.player];
    if (me === undefined) return;

    // 背景：**该玩家当前那一页**（Panel.mkf 资源 0 的图 0..3）@source VA 0x00416123
    const page = input.panelPage % PANEL_PAGE_COUNT;
    const bg = this.#sprite('Panel.mkf', 0, page);
    if (bg !== null) {
      drawSprite(ctx, bg, 0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    } else {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    }

    // 四个 tag（右缘竖条）—— **竖排、小一号**（排法仍按需求方的实机截图，
    // 颜色 2026-09-15 按 exe 改回深色：当前页 `0x101010`、其余 `0x404040`）
    ctx.font = `${PANEL_TAG_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    PANEL_TAGS.forEach((tag, i) => {
      ctx.fillStyle = i === input.panelPage ? PANEL_TAG_COLOR_CURRENT : PANEL_TAG_COLOR_OTHER;
      const chars = [...tag.label];
      // 整块以竖条中心为准，逐字向下排
      const y0 = tag.y - ((chars.length - 1) * PANEL_TAG_LINE) / 2;
      chars.forEach((ch, k) => ctx.fillText(ch, PANEL_TAG_X, y0 + k * PANEL_TAG_LINE));
    });

    // 名字下面那条**角色色长条**（截图上那条红带）——
    // @source VA 0x004161f8 起两次 `fcn_004561be`（= 填充矩形）：
    //   黑 86×12 @(523,57)，再角色色 86×12 @(522,56) ⇒ 角色色块 + 1px 黑边
    // ★ 先色条、后头像（0x00416234 才贴头像）—— 头像右缘 (525) 压在色条左端 (522) 上
    const cc = CHARACTERS[me.character]?.color ?? 0xffffff;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0x20b - 440, 0x39 - 1, 0x56, 0xc + 2);
    ctx.fillStyle = `rgb(${(cc >> 16) & 0xff},${(cc >> 8) & 0xff},${cc & 0xff})`;
    ctx.fillRect(0x20a - 440, 0x38, 0x56, 0xc);

    // 头像
    // ★ 头像也是 SMP，黑是抠图底色；不抠就会顶着一块黑框
    const face = this.#sprite('map.mkf', portraitResource(me.character), 0, true);
    if (face !== null) {
      // @source VA 0x0041624e `fcn_00456418(surface, 头像图, 0x1e2(482), 0x28(40))`
      //   —— 那两数是**锚点**落点，故按锚点画（侧栏局部 = 屏幕 − 440）
      drawSprite(ctx, face, 0x1e2 - 440 - face.anchorX, 0x28 - face.anchorY);
    }
    // 结盟期间盟友的小头像（在名字之前画）@source 0x00416256..0x00416285
    const ally = allyPortraitPlayer(me);
    if (ally !== null) this.#drawMiniPortrait(input.state, ally);

    // 姓名 ── @source VA 0x00416288 `draw_text(0, 名字, 0x234(564), 0x28(40), 2)`（flag 2 = 正中）
    ctx.fillStyle = '#101010';
    ctx.font = `${PANEL_VALUE_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = CHARACTERS[me.character]?.name ?? `角色${me.character}`;
    ctx.fillText(name, 0x234 - 440, 0x28);
    if (me.whoPlays === 0) {
      ctx.fillStyle = '#a02a20';
      ctx.font = `12px ${FONT_FAMILY}`;
      ctx.fillText('（出局）', 0x234 - 440, 0x28 + 18);
    }

    // 三行标签（**原版是开局画进页面图的**，这里每帧照同样的坐标画）@source VA 0x00417eba
    const labels = PANEL_ROWS[page] ?? PANEL_ROWS[0]!;
    ctx.fillStyle = '#101010';
    ctx.font = `${PANEL_LABEL_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < PANEL_ROW_LABEL_Y.length; i++) {
      ctx.fillText(labels[i]!, PANEL_ROW_LABEL_X, PANEL_ROW_LABEL_Y[i]!);
    }

    // 三行数值 —— 每页算的量不同，见 core 的 `panelValues`；文字由调用方
    // （client/panel.ts 的 `panelRows`）按各页的格式排好再传进来
    // @source VA 0x004162d4 / 0x00416355 / 0x0041646c / 0x004165e1
    ctx.font = `${PANEL_VALUE_SIZE}px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#101010';
    for (let i = 0; i < PANEL_VALUE_Y.length; i++) {
      ctx.fillText(input.panelRows[i] ?? '', PANEL_VALUE_RIGHT, PANEL_VALUE_Y[i]!);
    }

    // 物价指数 ── @source VA 0x004161b8 `sprintf(格式 0x4638f5, 指数)` 后
    //   `draw_text(0, 串, 0x1c2(450), 0x104(260), 0)`；串本身就是「物價指數  %d」
    //   （5 个汉字 + 两个空格 + %d），故不必自己拼
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `${PANEL_LABEL_SIZE}px ${FONT_FAMILY}`;
    ctx.fillStyle = '#101010';
    ctx.fillText(`物價指數  ${input.state.priceIndex}`, 0x1c2 - 440, 0x104);
  }

  /**
   * 整版的惡人那一版：图 5 + 名字 + 主人的小头像，其余一概不画 @source 0x00415fdb..0x00416061
   * （版式见 `VILLAIN_PANEL`）。
   */
  #drawVillainPanel(state: GameState, subject: Extract<PanelSubject, { kind: 'villain' }>): void {
    const ctx = this.#ctx;
    const bg = this.#sprite('Panel.mkf', 0, VILLAIN_PANEL.image);
    if (bg !== null) drawSprite(ctx, bg, 0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    else {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    }
    // 22 号、0x101010、flag 2（正中）@source 0x00416004 / 0x00416026
    ctx.fillStyle = '#101010';
    ctx.font = `${VILLAIN_PANEL.name.size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(subject.name, VILLAIN_PANEL.name.x, VILLAIN_PANEL.name.y);
    this.#drawMiniPortrait(state, subject.owner);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 小地图（侧栏右下角那 200×200）—— 全部照 `fcn_00416e6d`（VA 0x00416e6d）。
   *
   * 层次**按原版的绘制顺序**：
   * ```asm
   * 00416e78  底图 = [0x48badc] 图0（map.mkf 资源 地图号+0x10 的 200×200 成品图）
   *           （工作面：`fcn_0040a4e1(0)` 已把**归属色块**烙在上面，见 minimap-marks.ts）
   * 00416e89  左箭头 = [0x48bad8]+0xfc（Data.mkf 517 图20）  画在 (443, 顶+3)
   * 00416e9c  右箭头 = [0x48bad8]+0x108（图21）              画在 (468, 顶+3)
   * 00416fb9  各玩家的小头像（map.mkf 角色+0x1b 图 6，按 (世界×89)>>10 定位）
   * 00417041  当前玩家：30×30 白框，中心在它的圆点上
   * 004170c7  标记点：30×30 红框（与当前玩家重合时不画）
   * ```
   * 底图是**预先算好的成品图**，不是拿 `.gnd` 现缩 —— 比例与取景都不同。
   */
  #drawMinimap(input: HudInput, top: number): void {
    const ctx = this.#ctx;
    const { state, map, minimapBg, minimapMarker } = input;
    const size = SIDEBAR.w;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, size, size);
    ctx.clip();

    ctx.fillStyle = '#0a1730';
    ctx.fillRect(0, top, size, size);
    if (minimapBg !== null) ctx.drawImage(minimapBg, 0, top, minimapBg.width, minimapBg.height);

    // ★★ 第十三份試玩回報（「应该是用专属色块标注地图上已经被玩家购买的土地和建筑」）：
    //   底图上烙**归属色块** —— 有主的地 / 設施 / 企業各一块地主色的方或菱
    //   （原版 `fcn_0040a4e1(0)` 烙进工作面 `[0x48badc]`，本函数 0x00416ed7 贴的就是它；
    //   细节见 `minimap-marks.ts`）。
    //   先前这里给**每个节点**画一个 3×3 小方块（有主的地染地主色）—— 那是自己加的，
    //   原版这一屏没有逐格画点，路网本来就画在底图里。只在底图还没到时留着当占位。
    if (minimapBg !== null) {
      drawMinimapMarks(
        ctx,
        (image) => this.#sprite('Data.mkf', MINIMAP_MARK_RESOURCE, image, true),
        minimapMarks(state, map, 'small'),
        0,
        top,
      );
    } else {
      ctx.fillStyle = 'rgba(240,240,240,0.75)';
      for (const n of map.nodes) ctx.fillRect(minimapAt(n.x) - 1, top + minimapAt(n.y) - 1, 3, 3);
    }

    // 两颗箭头 —— 画在圆点之前（原版就是这个顺序），状态色见 #arrowImage
    for (const id of [1, 2] as const) {
      const r = minimapArrowRect(id);
      const hot = input.hotMinimapArrow === id || input.pressedMinimapArrow === id;
      const img = this.#sprite(
        'Data.mkf',
        MINIMAP_ARROW_RESOURCE,
        hot ? MINIMAP_ARROW_IMAGE.hot[id] : MINIMAP_ARROW_IMAGE.normal[id],
        true,
      );
      // ★ `fcn_00456418` 把图按**锚点**摆（VA 0x00455c64 `sub [ebp+0x18], anchorX`），
      //   所以「画在 (443, 顶+3)」指的是锚点落在那儿。
      if (img !== null) drawSprite(ctx, img, r.x - img.anchorX, top + r.y - img.anchorY);
    }

    // 棋子标记，并记下**当前玩家**那一枚的位置
    // ★★ 第十三份試玩回報顺修：原版画的是**角色小头像**，不是自己画的圆：
    //   ```asm
    //   00416fc8  cmp  word [player + 0x08], 0 / je 跳过   ; ★ 判据 = xpos != 0
    //   00416fd4  x = word [player + 0x08] × 89 >> 10 + 0x1b8
    //   00416ff8  y = word [player + 0x0a] × 89 >> 10 + 顶
    //   00417021  imul eax, ebx, 0x34
    //   00417024  mov  eax, [eax + 0x498eb0]       ; = map.mkf 资源 角色 + 0x1b（portraitResource）
    //   0041702a  add  eax, 0x54                   ; ★ 0xc + 12×6 ⇒ **图 6**（10×9 的小头像）
    //   00417034  call 0x456418                    ; 按锚点、抠黑贴
    //   ```
    //   先前把 `+0x54` 读成「专属色」、画成一个彩色圆点（试玩 4 那次）。小头像本身就是
    //   角色的主色，远看像一个色点 —— 那次回报说的「带颜色的圆点」就是它。
    //   位置取 `xpos/ypos`（与 `big-map-screen.ts` 的 `bigMapMarkers` 同源：关押时在綠島/醫院）。
    for (const p of state.players) {
      if (!isAlive(p) || p.xpos === 0) continue;
      const dx = minimapAt(p.xpos);
      const dy = top + minimapAt(p.ypos);
      const head = this.#sprite('map.mkf', portraitResource(p.character), MINIMAP_HEAD_IMAGE, true);
      if (head !== null) drawSprite(ctx, head, dx - head.anchorX, dy - head.anchorY);
    }

    // 取景框：**当前行动者**（玩家，或正在走的替身）上画 30×30 白框 @source VA 0x00417041
    // 标记框：标记点上画 30×30 红框，与取景框重合时不画 @source VA 0x004170c7
    const frame = minimapFrameCenter(state, input.npcFrame ?? null);
    const meDot = frame === null ? null : { x: frame.x, y: top + frame.y };
    const box = (cx: number, cy: number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - MINIMAP_BOX / 2, cy - MINIMAP_BOX / 2, MINIMAP_BOX, MINIMAP_BOX);
    };
    if (minimapMarker !== null) {
      const mx = minimapAt(minimapMarker.x);
      const my = top + minimapAt(minimapMarker.y);
      if (meDot === null || mx !== meDot.x || my !== meDot.y) box(mx, my, MINIMAP_MARKER_COLOR);
    }
    if (meDot !== null) box(meDot.x, meDot.y, MINIMAP_VIEW_COLOR);

    ctx.restore();
  }
}

/**
 * 小地图白框的中心（**小地图局部坐标**）—— 框的是 `[0x49910c]` 那个**当前行动者**。
 *
 * @source `fcn_00416e6d` 的循环（`ebx` = 0..8，`0x00416faf inc ebx / cmp ebx, 9`）：
 * ```asm
 * ; ebx < 玩家数：玩家
 * 00416fc8  cmp  word [ebx*0x68 + 0x496b70], 0 / je 0x416f9f   ; xpos == 0 ⇒ 不算
 * 00416fd2  esi = xpos × 89 >> 10 + 0x1b8 / edi = ypos × 89 >> 10 + 顶
 * ; ebx ≥ 玩家数：替身（表 `0x498de8 + ebx×16` = `0x498e28 + (ebx−4)×16`）
 * 00416f42  cmp  byte [edx + 0x498df2], 0 / jne 0x416f9f     ; +10 place ≠ 0（監獄/醫院/未出场）⇒ 不算
 * 00416f4b  cmp  ebx, [0x49910c] / jne 0x416f9f               ; 只算**当前行动者**那一个
 * 00416f55  esi = word [+0] × 89 >> 10 + 0x1b8 / edi = word [+2] × 89 >> 10 + 顶
 * ; 两支共用：
 * 00416f9f  cmp  ebx, [0x49910c] / jne / mov [esp+0x10], esi / mov [esp+0x14], edi
 * 00417045  test ecx, ecx / je …  0041704d test ebx, ebx / je …   ; 都非 0 才画框
 * ```
 * 替身那一趟 `[0x49910c]` = 4..8（`rules/special-actors.ts` 的文件头），坐标是逐 tick
 * 走的插值点 —— 本引擎由 `render.ts` 的 `npcWalkWorld()` 交来（在走 = 在盘上）。
 *
 * @param npc 正在走的替身的世界坐标；`null` = 这一刻轮的是玩家
 */
export function minimapFrameCenter(
  state: GameState,
  npc: { x: number; y: number } | null,
): { x: number; y: number } | null {
  if (npc !== null) return { x: minimapAt(npc.x), y: minimapAt(npc.y) };
  const me = state.players[state.currentPlayer];
  if (me === undefined || !isAlive(me) || me.xpos === 0) return null;
  return { x: minimapAt(me.xpos), y: minimapAt(me.ypos) };
}

/** 小地图上的棋子标记 = 角色图集（`map.mkf` 角色 + 0x1b）**图 6** @source 0x0041702a `add eax, 0x54` */
export const MINIMAP_HEAD_IMAGE = 6;

/**
 * 取景框是**白的**、标记框是**红的**。
 * @source VA 0x00417041 `push 0xffffff` / VA 0x004170c7 `push 0xff0000`
 */
const MINIMAP_VIEW_COLOR = '#ffffff';
const MINIMAP_MARKER_COLOR = '#ff0000';
