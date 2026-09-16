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
 *           blit(图 0, 0, 0)                     ; (0,0) 整屏底图（不透明）
 *           blit(图 19, 0x18, 0x46) [★抠黑]       ; 「记者小姐」立绘 → (24,70)
 *           create_font(0x12, 0x101010, 0, 2, 0) ; 18 号白字
 *           fcn_0044ec30(图 1, 0xbe, 0x0a, 0, -0x1e, 0x101010, 0) ; 气泡 → (190,10)
 *           fcn_0044ecb6(串 0x464d92)             ; 往气泡里写「…加發１０％…」
 *           Wait_0402_Message(fcn_00437e61, 0)   ; ★ 等一次点击 → 进頒獎屏
 *           fcn_00437e61(…)                      ; 頒獎屏窗口过程
 *           ; 收尾：把每个人的 +0x42/+0x5c/+0x60 清零
 * ```
 *
 * ⚠️ 那两个 `blit` 的参数序是 `(dst_surface, image, x, y)`，而 cdecl **从右往左**
 *   压栈 ⇒ 汇编里**先压 y、后压 x**（`0x00439c5d push 0x46` = y=70，
 *   `0x00439c5f push 0x18` = x=24）。另：`[0x48c41c] + 0xc + 12×图号` 才是「图 图号」
 *   （见 `MONTHLY_CHUNK` 的注释），故 `add eax, 0xf0` = 图 **19**。
 *
 * ## 第一屏：结算（`loc_00439cd7` 的循环，VA 0x00439cd7..0x00439e5b）
 *
 * 先把在场玩家按下标填进 `[0x48c418]`（`loc_00439caa`，`cmp byte [p+0x15],0`
 * 跳过出局者），再**逐个玩家画一行**：
 *
 * | 画什么 | 落点 | 取数 | @source |
 * |---|---|---|---|
 * | 头像 = 图 `3×角色 + 47`（★**不加帧**，抠黑）| `x = 0x258 = 600`、`y = [0x475918 + 8×人数 + 2×行]` | `player+0x13` | 0x00439cd7..0x00439d35 |
 * | `存款：`（flag 0）| 图 `11+行` 局部 `(4,6)` | 串 `0x464e56` | 0x00439d3d |
 * | 存款额（flag 1）| 图 `11+行` 局部 `(0x9a,6)` | `player+0x20` | 0x00439d7e |
 * | `利息：`（flag 0）| 图 `11+行` 局部 `(4,0x2e)` | 串 `0x464e90` | 0x00439db5 |
 * | 利息额 / `貸款中`（红，flag 1）| 图 `11+行` 局部 `(0x9a,0x2e)` | `trunc(存款×0.1)` | 0x00439df4 / 0x00439e10 |
 *
 * ★ 这一屏**没有**别的 blit：图 2（长条锦缎板）、图 6..9（3D 数字）、图 10（金币）
 *   都**不在** `loc_00439cd7` 里（`[0x48c41c]` 的 65 处引用逐条搜过），
 *   图 `11..14` 也只是 `draw_text` 的**目标面**、从未被贴到屏幕上。
 *   本轮按这个事实把多画的三样去掉了（D-MONTHLY-9/11），四段文字则照原版那四个
 *   局部偏移排布；因为原版那四张名牌没有落点，块原点取 `MONTHLY_ROW_BLOCK_X`
 *   与行头像同一个 y（= `MONTHLY_SEAT_Y[行]`），保证**不裁字、不压立绘**
 *   —— 见 `docs/deviations/T-041.md`（D-MONTHLY-1/9/11 已按此订正）。
 *
 * ⚠️ 行头像的 x 是常数 **600**、y 才是那张表 —— 两者**不能对调**
 *   （先前的实现在这里读反了，见 D-MONTHLY-1）。
 *
 * ⚠️ `存款：` 与 `利息：` 两个标签（串 `0x464e56` / `0x464e90`）本模块**自己写**
 *   （原版是把它们当参数交给 `draw_text`）—— 见
 *   `docs/deviations/T-041.md` 的 D-MONTHLY-3。
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
import type { ArchiveName, LoadedFlic, Sprite } from './assets.ts';
import { currency } from './panel.ts';
import { FONT_FAMILY } from './font.ts';
import type { UiKeyEvent, UiScreen, UiScreenEnv } from './ui-screen.ts';

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
 * ★ **图号 = `(偏移 − 0xc) / 12`** —— `read_mkf`（VA 0x0044504…→0x00450441）返回的是
 *   SMP **文件本体**，图素表的第 0 项在文件偏移 `0xc`（12 字节头：
 *   `"SMP\0"` + 张数 + 起始偏移；每项 12 字节 = `w,h,x,y,大小`），
 *   加载尾部 `0x00450069` 的修正过程把每项的 `+8`（大小）就地改成像素数据的
 *   **绝对地址**（`entry[i]+8 = base + startOffset + Σ_{j<i} size_j`）。
 *   所以原版代码里的 `[0x48c41c] + 0xc + 12×图号` 才是「图 图号」；
 *   `0x00439c3a` 的 `add eax, 0xf0` ⇒ `(0xf0−0xc)/12 = **19**`。
 *   （旁证：`3×角色 + 47 + 帧` 那一族取 `0xc + 12×(3c+47+帧)`，帧 ∈ 0..2 时正好用完 47..82。）
 *
 * | 图 | 尺寸 | 是什么 | @source |
 * |---|---|---|---|
 * | 0 | 640×480 | 整屏底图（`大富翁4` 底纹 + 四角铃铛）| 0x00439c1f |
 * | 1 | 290×201 | 「存款」气泡 —— 原版在收尾用 `fcn_0044ec30` 落在 **(190,10)** 并往里写字，本模块**未接**（见 D-MONTHLY-12）；状态 1 的补丁曾误用它，见 D-MONTHLY-8 | 0x00439e8b |
 * | 2 | 278×98 | 长条锦缎板（结算屏原版**没有** blit 它，见 T-041 的 D-MONTHLY-9）| — |
 * | 3 | 239×193 | 圆气泡（本屏未用）| — |
 * | 4 | 195×142 | 长条锦缎板（本屏未用）| — |
 * | 5 | 353×450 | 「MONEY」大板（本屏未用）| — |
 * | 6..9 | 43×75..63×83 | 3D 数字 **1 2 3 4**（原版结算屏**没有** blit 它们）| — |
 * | 10 | 26×16 | 金币（`$`）（原版结算屏**没有** blit 它）| — |
 * | 11..14 | 160×71 / 159×71 | 结算屏每行的**双条名牌**（原版只把它当 `draw_text` 的目标面，**没有** blit，见 D-MONTHLY-9）| 0x00439d48 |
 * | 15..18 | 142×348 | 頒獎屏那根竖栏（图号是 `[0x475960+8×人数+2×槽]`）| 0x00438452 |
 * | 19 | 186×410 | **结算屏左侧面板（「记者小姐」立绘）**，原版**抠黑**落在 **(24,70)** | 0x00439c3a |
 * | 20..46 | — | 记者小姐立绘 / 脸部分件（本屏不用）| — |
 * | 47..82 | 66×72..32×58 | **12 个角色 × 3 帧头像**（`3×角色 + 47`，本屏只用第 0 帧）| 0x00437c9f |
 */
export const MONTHLY_CHUNK = {
  bg: 0,
  /** 「存款」气泡 —— 原版只在收尾那一步（`fcn_0044ec30`）用它 @source 0x00439e8b */
  bubble: 1,
  /**
   * 长条锦缎板。
   *
   * ⚠️ **结算屏原版没有 blit 它** —— `loc_00439cd7` 里除了图 0 / 图 19 /
   *   行头像（图 `3×角色+47`）与四条 `draw_text` 之外没有任何 blit；
   *   本模块先前拿它当行底板用，**本轮已删**（那正是盖掉立绘的那一块）。
   *   见 `docs/deviations/T-041.md` 的 D-MONTHLY-9。
   */
  plate: 2,
  /**
   * 3D 数字 `1`..`4` 的基址。
   *
   * ⚠️ **结算屏原版没有 blit 它们**；本模块先前拿 `6 + 竖栏帧` 去取，
   *   落到图 21/22/23（= 记者小姐的**脸部分件**）⇒ 屏幕顶部 4 个「脸」。
   *   本轮已删，见 D-MONTHLY-11。
   */
  digitFirst: 6,
  /** 金币 ⚠️ 结算屏原版也没有 blit 它；本轮已删，见 D-MONTHLY-11 */
  coin: 10,
  /** 行名牌的基址（图 `11..14`）@source 0x00439d48 */
  barFirst: 11,
  /** 頒獎屏竖栏的基址（图 `15..18`）@source 0x00438452 */
  columnFirst: 15,
  /** ★ 结算屏左侧面板 = 图 **19**（`0xf0 = 0xc + 12×19`）@source 0x00439c3a */
  panel: 19,
  /** 12 个角色头像的基址（图 `3×角色 + 47`）@source 0x00437c9f */
  avatarFirst: 47,
} as const;

/**
 * 头像**每角色 3 帧** @source `lea edx, [eax + 0x2f]`（VA 0x00437c9f）
 *   —— `eax = 角色×3`，`0x2f = 47`。
 *
 * ⚠️ 结算屏与頒獎屏都**不加帧号**：图号 = `3×角色 + 47`（第 0 帧）。
 *   先前多写的 `+ 帧`（帧 = 頒獎屏那张 `[0x475960]` 竖栏表里的 15/16/17）
 *   会算到 62..98，**超出本资源 0..82** ⇒ `sprite()` 返回 null ⇒ 那个人
 *   的头像整块不画（见 T-041 的 D-MONTHLY-10）。
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
 * 頒獎屏那段**角色三維小人 FLIC** 的落点调整表 @source `[0x475a03 + 12×角色]`。
 *
 * 原版那两处的落点是拼出来的（`loc_0043849e` 的 FLIC 那一段）：
 * ```asm
 * ; 横坐标：0x14a + dword[0x475a03 + 12×角色]   ← 表里是 **u32**，读出来是负数
 * mov edx, 0x14a
 * mov ebp, dword [eax*8 + 0x475a07]     ; eax = 角色号×3
 * lea eax, [edx + ebp]
 * ; 纵坐标：movsx word[0x475930 + 8×人数 + 2×槽] + dword[0x475a03 + 12×角色]
 * ```
 *
 * ★ 这两条读出来是**负数**（dump：`0xFFFFFFB3` = −77、`0xFFFFFFD0` = −48…），
 *   且原版把 `fcn_0045144f` 的 x 参数按**左上角**用（不像精灵那样减锚点），
 *   所以真实落点必须再减掉影片宽高的一半左右才落在列中央。
 *   ⇒ 本模块**不逐像素复刻这张表**，改用「列心 − 影片一半」定位
 *   （见 `MONTHLY_AWARD_FLIC_AT`），并把这一点登记为近似。
 */
export const MONTHLY_AWARD_FLIC_DX = 0x14a;

/**
 * 頒獎 FLIC 的落点：**列的中心**，绘制时再按影片尺寸减一半。
 *
 * ★ 原版那张 `0x475a03` 表的绝对值没有逐个核出来（见上面的注释）；
 *   这里取「与头像同一列、压在窄板中段」，是**近似**，登记在 D-MONTHLY-6。
 */
export const MONTHLY_AWARD_FLIC_AT = { x: 0, y: 0x96 } as const;

/**
 * 頒獎 FLIC 的资源号 —— 获奖/悲情主角那个**角色**的三维小人动画。
 *
 * @source `rich4.asm:17360-17364`（`loc_0043849e` 前一段）：
 * ```asm
 * mov al, byte [eax + (_rich4_all_players_state + 19)]  ; 玩家 +0x13 = 角色号
 * add eax, eax                                          ; ★ ×2
 * add eax, 0x1a1                                        ; ★ + 0x1a1
 * push eax / read_mkf(_rich4_data_mkf)
 * ```
 * 即 `Data.mkf` 资源 **`0x1a1 + 2×角色`**。
 * @source `rich4.asm:17948-17952` 的**悲情人物**那一支同样是
 * `add eax, eax / add eax, 0x1a0` ⇒ `0x1a0 + 2×角色`（那是**奖座**那张，
 * 本模块暂不画，见 D-MONTHLY-6）。
 */
export function monthlyAwardFlicResource(character: number): number {
  return 0x1a1 + 2 * Math.max(0, character);
}

/**
 * 月結／頒獎那两屏的**音效**号（外部审查 D-MONTHLY-5，2026-09-16 接线）。
 *
 * | 时机 | 号 | 出处 |
 * |---|---|---|
 * | 頒獎屏每一步 | **27**（`0x1b`） | `play_sound_effect(&0x475b17)` @source `rich4.asm:17214` 那一片；`0x475b17` 首字节 = `0x1b`（`rich4.asm:41210-41230`）|
 * | 進「詳情」那一段 | **60**（`0x3c`） | `play_sound_effect(&0x475b27)` @source `rich4.asm:17346`；首字节 = `0x3c` |
 * | 收尾／離屏 | **28**（`0x1c`） | `play_sound_effect(&0x475b1f)` @source `rich4.asm:17935`；首字节 = `0x1c` |
 *
 * ⚠️ 旧条目把这三个号写成「0」并说「`SOUND_IDS` 里没有」，**两条都不成立**：
 *   号是 27/60/28，而 `SOUND_IDS` 只是约十条**已具名**的映射，不是 `Effect.mkf` 全集
 *   （`assets-clean/manifest.json` 的 Effect 资源是 0..114）。
 */
export const MONTHLY_SOUND_STEP = 27;
export const MONTHLY_SOUND_DETAIL = 60;
export const MONTHLY_SOUND_CLOSE = 28;

/**
 * 頒獎屏那 4 列的 **x** @source `[0x475930 + 8×人数 + 2×槽]`
 *   （`fcn_00437c25` 的 `movsx eax, word [esi + eax*2 + 0x475930]`，
 *   4 人局 = `{60,180,300,420}`）。
 *
 * ⚠️ 这是**頒獎屏**那张表，与结算屏的 `MONTHLY_SEAT_Y`（`0x475918`）是**两张
 *   相邻的表**、数值恰好相同：頒獎屏拿它当头像的 **x**，结算屏拿它当头像的 **y**
 *   （x 恒 600）。本模块两处各按各的来。
 */
export const MONTHLY_SEAT_X = [60, 180, 300, 420] as const;

/**
 * 结算屏行头像的 **y** @source `loc_00439cd7` 的
 *   `movsx esi, word [edi + esi*2 + 0x475918]`（`edi` = 8×在场人数、`esi` = 行号）
 *
 * ```asm
 * 00439cf5  movsx esi, word [edi + esi*2 + 0x475918]   ; 4 人局 = 0x475938
 * 00439cfd  push esi                                  ; y
 * 00439cfe  push 0x258                                ; x = 600
 * 00439d35  call 0x456418                             ; 抠黑贴头像
 * ```
 *
 * | 人数 | 表行 | 值（= **y**）|
 * |---|---|---|
 * | 2 | `0x475928` | `{120,360}` |
 * | 3 | `0x475930` | `{100,240,380}` |
 * | 4 | `0x475938` | `{60,180,300,420}` |
 */
export const MONTHLY_SEAT_Y = [60, 180, 300, 420] as const;

/** 结算屏行头像的 x —— **常数** @source 0x00439cfe `push 0x258` */
export const MONTHLY_SEAT_AVATAR_X = 0x258;

/**
 * 頒獎屏 4 列的**帧** @source VA 0x00475960
 *   （`movsx edx, word [8×人数 + 2×槽 + 0x475960]`）
 *
 * ⚠️ **这只是頒獎屏那张竖栏（图 15..18）的表**：`loc_0043849e` 用它查出的
 *   `15/16/17/18` 是**竖栏的图号**（`0xc + 12×值`），**不是**头像的帧。
 *   先前把它当「结算屏头像的帧」加到图号上（`3×角色 + 47 + 帧`）会算到 62..98
 *   ⇒ 超出资源 0..82 ⇒ 那个人整块不画。见 T-041 的 D-MONTHLY-10。
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
 * 头像的 `{height, 锚点 y}` —— **近似表**，只用于那一步 `y = 330 − h + y`。
 *
 * 原版是**从被画的那张头像自己身上读**的（`+0x0e` = height / `+0x12` = 锚点 y，
 * VA 0x004384b7），也就是图 `3×角色 + 47` 那一张的字段。本模块拿不到图素表，
 * 只按字符 0..2 三帧都成立的 `(72, 36)` 兜着 —— 于是 y 恒为 294；
 * 对 h/锚点不同的角色（如莎拉公主 42×58、锚点 y=28 → 300）会差几个像素。
 * 见 T-041 的 D-MONTHLY-10。
 *
 * 键是**旧读法**留下的「帧号」（`[0x475960]` 查出的竖栏图号 15/16/17），
 * 与头像图号无关；保留只是为了那一步高度查表。
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
 *
 * ⚠️⚠️ **这一组值本身也已被 D-MONTHLY-8 订正**：参数序真正的名字是
 *   `(dst, 图素, x, y, srcX, srcY, w, h)`，6 个立即数逐个对回去是
 *   `h=0x19a(410)`、`w=0xba(186)`、`srcY=0x46`、`srcX=0x18`、`y=0x46`、`x=0x18`，
 *   而 `add eax, 0xc` 是**图 0**（整屏底图）不是图 1 —— 原版这一步是
 *   「用底图把 (24,70)+186×410 还原，再把图 24 落在 (28,70)」。
 *   本轮只登记、没改（见 T-041 的 D-MONTHLY-8）。
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

/**
 * 结算屏那一行四段文字的**块原点 x** —— **近似**（原版没有这个东西）。
 *
 * 原版把这四段写进图 `11+行`（160×71 的双条名牌）里，而那四张图
 * **从未被 blit 上屏**（`[0x48c41c]` 的 65 处引用逐条搜过，见 D-MONTHLY-9）
 * ⇒ 「这块文字画在屏幕的哪一点」在原版里**没有答案**。
 *
 * 本模块取 `0xe0(224)`：立绘 (24,70)-(210,480) 右侧留 14px，既不裁字
 * （每段最远到 `x + 0x9a + 右对齐的字宽`）、也不压立绘，更不碰
 * `x = 600` 那列头像。块原点的 **y** = 那一行的 `MONTHLY_SEAT_Y[行]`。
 *
 * 见 `docs/deviations/T-041.md` 的 D-MONTHLY-9。
 */
export const MONTHLY_ROW_BLOCK_X = 0xe0;

/**
 * 块内四段文字的偏移 @source `loc_00439cd7` 的四条 `draw_text`：
 *   `(4,6)` / `(0x9a,6)` / `(4,0x2e)` / `(0x9a,0x2e)`
 *   （0x00439d3d / 0x00439d7e / 0x00439db5 / 0x00439df4）
 *
 * 0x9a = 154 那两处是 `flag 1`（右上 ⇒ 右对齐），所以 x 是**右边缘**。
 */
export const MONTHLY_ROW_AT = {
  /** `存款：`（flag 0 = 左上）*/
  bankLabel: { dx: 4, dy: 6 },
  /** 存款额（flag 1 = 右上）*/
  bank: { dx: 0x9a, dy: 6 },
  /** `利息：`（flag 0）*/
  interestLabel: { dx: 4, dy: 0x2e },
  /** 利息额 / `貸款中`（flag 1）*/
  interestValue: { dx: 0x9a, dy: 0x2e },
} as const;

/**
 * 结算屏**左侧面板**（图 19「记者小姐」）的落点 @source 0x00439c3a
 *
 * ```asm
 * 00439c5d  push 0x46        ; y = 70
 * 00439c5f  push 0x18        ; x = 24
 * 00439c61  mov eax, [0x48c41c]
 * 00439c66  add eax, 0xf0    ; (0xf0−0xc)/12 = 图 19
 * 00439c73  call 0x456418    ; ★ 抠黑那份（不是 0x4563f5）
 * ```
 *
 * `loc_0043849e`/`loc_00437fff` 里同一条 `x=0x18/y=0x46` 也是这个意思（状态 1 的
 * 脏矩形 `(0x18,0x46,0x105,0x1e0)` = `(24,70)-(261,480)` 正好把它圈住）。
 */
export const MONTHLY_PANEL_AT = { x: 0x18, y: 0x46 } as const;

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

/** 这一行的落点要按**哪台屏**算 —— 两台屏的 x 来源不同（见 `monthlyRowLayout`）*/
export type MonthlyRowScreen = 'settle' | 'award';

/** 一行在舞台上的落点 */
export interface MonthlyRowLayout {
  /** 玩家下标 */
  index: number;
  /** 按哪台屏算的 */
  screen: MonthlyRowScreen;
  /** 头像左上角 + 图号（两台屏的落点不同，见 `monthlyRowLayout`）*/
  avatar: { x: number; y: number; chunk: number };
  /** 结算屏那一行四段文字的**块原点**（頒獎屏不画块，字段仍给同一套）*/
  block: { x: number; y: number };
  /** `存款：`（flag 0 = 左上）*/
  bankLabel: { x: number; y: number };
  /** 存款额（flag 1 = 右上，x 是右边缘）*/
  bank: { x: number; y: number };
  /** `利息：`（flag 0）*/
  interestLabel: { x: number; y: number };
  /** 利息额 / `貸款中`（flag 1，x 是右边缘）*/
  interestValue: { x: number; y: number };
}

/**
 * 一行的摆位 —— **纯函数**，单测钉的就是它。
 *
 * `playerIndex` 同时是**行号**与 `players` 下标（原版 `[0x48c418]` 就是按序填的）。
 *
 * ★ **两台屏的头像落点不是一套**：
 *
 * | 屏 | x | y | @source |
 * |---|---|---|---|
 * | 结算 `settle` | **600**（常数）| `MONTHLY_SEAT_Y[行]` = `{60,180,300,420}` | `loc_00439cd7`：`push y / push 0x258` |
 * | 頒獎 `award` | `MONTHLY_SEAT_X[槽]` = `{60,180,300,420}` | `330 − h + 锚点y`（本模块按 `(72,36)` 近似 ⇒ 294）| `loc_0043849e`：`push 0x14a−h+y / push [0x475930]` |
 *
 * 两者的查表值恰好同值、用法不同（一个当 y、一个当 x），**不能互相顶替**。
 *
 * 行文字（`存款：`/存款额/`利息：`/利息额）只在**结算屏**上画，落点 =
 * `MONTHLY_ROW_BLOCK_X` + 行头像的 y 当块原点，再加原版那四个局部偏移。
 */
export function monthlyRowLayout(
  state: GameState,
  playerIndex: number,
  screen: MonthlyRowScreen = 'settle',
): MonthlyRowLayout {
  const p = state.players[playerIndex];
  const character = p?.character ?? 0;
  const slot = Math.min(Math.max(playerIndex, 0), MONTHLY_SLOTS - 1);
  const frame = MONTHLY_SEAT_FRAME[slot] ?? 0;
  const size = MONTHLY_AVATAR_FRAME[frame] ?? { h: 0, y: 0 };
  const avatarX = screen === 'settle' ? MONTHLY_SEAT_AVATAR_X : (MONTHLY_SEAT_X[slot] ?? 0);
  const avatarY =
    screen === 'settle'
      ? (MONTHLY_SEAT_Y[slot] ?? 0)
      : MONTHLY_SEAT_BASE_Y - size.h + size.y;
  const block = { x: MONTHLY_ROW_BLOCK_X, y: avatarY };
  const at = (o: { dx: number; dy: number }): { x: number; y: number } => ({
    x: block.x + o.dx,
    y: block.y + o.dy,
  });
  return {
    index: playerIndex,
    screen,
    avatar: {
      x: avatarX,
      y: avatarY,
      chunk: MONTHLY_AVATAR_STRIDE * character + MONTHLY_CHUNK.avatarFirst,
    },
    block,
    bankLabel: at(MONTHLY_ROW_AT.bankLabel),
    bank: at(MONTHLY_ROW_AT.bank),
    interestLabel: at(MONTHLY_ROW_AT.interestLabel),
    interestValue: at(MONTHLY_ROW_AT.interestValue),
  };
}

/**
 * 结算屏那一行要写的文字。
 *
 * ⚠️ 上屏的只有 `bankLabel` / `bank` / `interestLabel` / `interest` 四条
 *   （原版 `loc_00439cd7` 就这四条 `draw_text`）；`name` / `cash` 是摘要里
 *   本来就有的字段、**不再上屏**（玩家由 `x=600` 那列头像标识、现金只在頒獎屏
 *   的详情里出现），保留它们只为摘要快照好读。见 D-MONTHLY-3/9。
 */
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
 * 一张图要不要**抠掉纯黑** —— 看原版这一处画它时走的是哪一支：
 * 带透明的 `fcn_00456418`（VA 0x00456418 → 0x00455c52 的
 * `lodsw / or ax,ax / je`，RGB555 的 0 跳过），
 * 还是不透明的 `fcn_004563f5`（VA 0x004563f5 → 0x00455b3a 的 `rep movsd`，
 * 把黑底原样盖上去 ⇒ 屏幕上就是一块**纯黑矩形**）。
 *
 * | 图 | 原版用哪个 | 抠黑 | @source |
 * |---|---|---|---|
 * | 0 整屏底图 | `fcn_004563f5`（不透明）| ✗ | 0x00439c55 |
 * | **19 左侧面板** | `fcn_00456418` | **✓** | **0x00439c73** |
 * | **47..82 头像** | `fcn_00456418` | **✓** | **0x00439d35 / 0x0043850d** |
 * | 6..9 数字、10 金币 | `fcn_00456418` | ✓ | 0x00439d02 / 0x00439d1d（本模块的用法）|
 * | 11..14 / 15..18 | `fcn_004563f5` | ✗ | 0x00438476 |
 *
 * ★ 先前的实现只把 6..10 放进来，**头像（47..82）漏了** —— 于是每个人的棋子
 *   都被原样盖上一层黑底（頒獎屏那 4 列同理）。
 */
export function monthlyKeyedBlack(chunk: number): boolean {
  return (
    MONTHLY_KEYED.has(chunk) ||
    (chunk >= MONTHLY_CHUNK.avatarFirst &&
      chunk < MONTHLY_CHUNK.avatarFirst + 12 * MONTHLY_AVATAR_STRIDE)
  );
}

const MONTHLY_KEYED = new Set<number>([
  MONTHLY_CHUNK.digitFirst + 0,
  MONTHLY_CHUNK.digitFirst + 1,
  MONTHLY_CHUNK.digitFirst + 2,
  MONTHLY_CHUNK.digitFirst + 3,
  MONTHLY_CHUNK.coin,
  MONTHLY_CHUNK.panel,
]);

/** 一张图要不要抠黑由 `monthlyKeyedBlack` 说了算，别在各处手写 */
function monthlySprite(sprite: MonthlySprite, chunk: number, keyed?: boolean): Sprite | null {
  return sprite('Panel.mkf', MONTHLY_RESOURCE, chunk, keyed ?? monthlyKeyedBlack(chunk));
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

/**
 * 结算屏一行的四段文字 —— **就是原版那四条 `draw_text`**，一条不多。
 *
 * ```asm
 * 00439d3d  draw_text(图(11+行), "存款：", x=4,    y=6,    flag 0)
 * 00439d7e  draw_text(图(11+行), 存款额,   x=0x9a, y=6,    flag 1)
 * 00439db5  draw_text(图(11+行), "利息：", x=4,    y=0x2e, flag 0)
 * 00439df4  draw_text(图(11+行), 利息额,   x=0x9a, y=0x2e, flag 1)  ; 或红色的 `貸款中`
 * ```
 *
 * ⚠️ 原版这一屏**没有**「玩家名」文字，也没有现金那一行（玩家由 `x = 600`
 *   那一列头像标识、现金只在頒獎屏的详情里出现）—— 那两行是本模块先前多画的，
 *   本轮按 asm 去掉，见 `docs/deviations/T-041.md` 的 D-MONTHLY-3/9。
 */
function drawRowText(
  ctx: CanvasRenderingContext2D,
  at: MonthlyRowLayout,
  t: MonthlyRowText,
): void {
  monthlyText(ctx, t.bankLabel, at.bankLabel.x, at.bankLabel.y, MONTHLY_TEXT.fill);
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
/**
 * 頒獎屏那段**角色三維小人 FLIC** —— 单独一步，压在上面那台屏之上。
 *
 * @source `loc_0043849e` 的 FLIC 那一段（`rich4.asm:17630-17650`）：
 *   `read_mkf(_rich4_data_mkf, 0x1a1 + 2×角色)` 之后 `fcn_0045144f(影片, x, y, flags, delay)`。
 *   资源与「演谁」这两件是本轮核实的；落点表 `0x475a03` 的绝对值还没核出来，
 *   故用「列心 − 影片一半」近似（见 `MONTHLY_AWARD_FLIC_AT`）。
 *
 * @param flic 取影片的出口（`UiScreenEnv.flic`）—— 本屏的绘制函数只收 `sprite`，
 *   所以这一段由 `draw()` 单独调，画在整台頒獎屏之后。
 * @returns 真画了没有（给测试用）
 */
export function drawMonthlyAwardFlic(
  ctx: CanvasRenderingContext2D,
  flic: (archive: ArchiveName, resource: number) => LoadedFlic | null,
  state: GameState,
  view: MonthlyView,
  award: MonthlyAward | null,
  p: MonthlyPlayback,
  now: number,
): boolean {
  if (award === null || award.winner < 0) return false;
  // 只在「台上四个人都铺好了」之后才演它（原版那是状态 8/9）
  if (p.phase !== 'award' || p.seats < MONTHLY_SLOTS) return false;
  const win = state.players[award.winner];
  if (win === undefined) return false;
  const film = flic('Data.mkf', monthlyAwardFlicResource(win.character));
  if (film === null || film.frames.length === 0) return false;
  const ms = film.frameMs > 0 ? film.frameMs : 71;
  const i = Math.min(film.frames.length - 1, Math.max(0, Math.floor(now / ms)));
  const bmp = film.frames[i];
  if (bmp === undefined) return false;
  // 列心：与头像同一列（`monthlyRowLayout(..., 'award').avatar.x`）
  const at = monthlyRowLayout(state, award.winner, 'award');
  const x = Math.round(at.avatar.x + MONTHLY_AWARD_FLIC_AT.x - film.width / 2);
  const y = Math.round(MONTHLY_AWARD_FLIC_AT.y - film.height / 2);
  ctx.drawImage(bmp, x, y);
  return true;
}

export function drawMonthlyScreen(
  ctx: CanvasRenderingContext2D,
  sprite: MonthlySprite,
  state: GameState,
  topo: MapTopology,
  view: MonthlyView,
  award: MonthlyAward | null,
  p: MonthlyPlayback,
): void {
  // ── ① 底图 + 左侧面板（图 19「记者小姐」，抠黑）──
  // @source 0x00439c55（图 0，不透明）/ 0x00439c73（图 19，抠黑）
  // ⚠️ 这一格先前画的是图 1（气泡）而且**不抠黑** ⇒ 图 1 的透明底
  //    （290×201 里 16952 个 0 像素）原样盖成纯黑 ⇒ 屏幕中部一块黑板。
  drawAnchored(ctx, monthlySprite(sprite, MONTHLY_CHUNK.bg, false), 0, 0);
  drawAnchored(
    ctx,
    monthlySprite(sprite, MONTHLY_CHUNK.panel),
    MONTHLY_PANEL_AT.x,
    MONTHLY_PANEL_AT.y,
  );

  // ── ① 逐行（頒獎屏期间全部显示）──
  // 结算屏按 `[0x48c418]` 的填充序点亮（本引擎里 = `players` 下标序），
  // 故「第 n 行（`revealed = n`）」对应前 `n+1` 个在场玩家。
  //
  // ★ 只画两样（照 `loc_00439cd7`）：**行头像**（图 `3×角色+47`，抠黑，
  //   x=600 / y=表）与**四段文字**。图 2（行底板）、图 6..9（3D 数字）、
  //   图 10（金币）原版这一屏一个都没 blit，本模块先前多画了它们 ——
  //   那正是「立绘只剩裙子」「顶部 4 个脸」两个缺陷的来源，本轮删掉。
  const shownCount = p.phase === 'settle' ? p.revealed + 1 : view.rows.length;
  for (let i = 0; i < Math.min(shownCount, view.rows.length); i++) {
    const row = view.rows[i];
    if (row === undefined) continue;
    const at = monthlyRowLayout(state, row.index, 'settle');
    drawAnchored(ctx, monthlySprite(sprite, at.avatar.chunk), at.avatar.x, at.avatar.y);
    drawRowText(ctx, at, monthlyRowText(row));
  }

  // ── ② 頒獎屏 ──
  if (p.phase !== 'award' || award === null) return;

  // 状态 1：先把图 1 在 (70,24) 那块 70×24 原样盖到 (24,70)（见 MONTHLY_AWARD_PATCH）
  //
  // ⚠️ 已证实这一格是**误读**：原版 `loc_00437fff`（VA 0x00438056）干的是
  //   `fcn_0045643d(surface, 图 0, x=24, y=70, srcX=24, srcY=70, w=186, h=410)`
  //   —— 用**整屏底图**把 (24,70)-(210,480) 这块**还原**（擦掉结算屏那只面板），
  //   随后 `fcn_004563f5(surface, 图 24, x=28, y=70)`（**不抠黑**）盖上
  //   「记者小姐笑着」那张 233×410 的卡。先前把源图读成图 1、把参数读成
  //   70×24，见 T-041 的 D-MONTHLY-8；本轮只登记、不改（不属于本次报的缺陷）。
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
    const at = monthlyRowLayout(state, row.index, 'award');
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
    const at = monthlyRowLayout(state, row.index, 'award');
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

/** 这一段演出的起点时刻 —— 頒獎 FLIC 的帧序按它算 */
let playbackStartedAt = 0;

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
    // ★ 頒獎那段角色 FLIC 单独一步（本屏的 `drawMonthlyScreen` 只收 `sprite`，
    //   而 FLIC 要 `env.flic`）—— 见 D-MONTHLY-6
    drawMonthlyAwardFlic(env.stage, env.flic, s, v, award, p, env.now - playbackStartedAt);
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
   *
   * ✅ 2026-09-16：`0x101` 也接上了（新加的 `UiScreen.key` 出口）。
   *   ⚠️ 订正：`loc_00439b85` 其实是 **`WM_PAINT` 那段**（`BeginPaint`/`EndPaint`），
   *   不是「按键专用分支」—— 文档先前把它当成按键分支记了。真正的按键处理
   *   与同族的 `fcn_004544f6` 一样是**只看消息号**（`0x101` 就跳过）。
   */
  up(_x: number, _y: number, env: UiScreenEnv): void {
    advance(env);
  },

  /** `WM_KEYDOWN`（0x101）—— 与抬手同一个出口 */
  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    advance(env);
    return true;
  },

  tick(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    const rows = view?.rows.length ?? 0;
    const next = monthlyPlaybackTick(p, rows);
    // ★ 音效（D-MONTHLY-5）：頒獎屏每铺一块窄板/一列/一条详情各响一声，
    //   收尾那一下再响一声。号与出处见 `MONTHLY_SOUND_*`。
    if (next !== null) {
      if (next.bars > p.bars || next.seats > p.seats) env.playEffect(MONTHLY_SOUND_STEP);
      if (next.details > p.details) env.playEffect(MONTHLY_SOUND_DETAIL);
      if (next.closing && !p.closing) env.playEffect(MONTHLY_SOUND_CLOSE);
    }
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
    // 頒獎那段 FLIC 的帧序按「演出开始到现在」算（见 `drawMonthlyAwardFlic`）
    playbackStartedAt = env.now;
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
