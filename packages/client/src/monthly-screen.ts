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
import { FONT_FAMILY, clerkTextStyle, drawGdiText } from './font.ts';
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
   * **那两张 4 行表底下的锦缎板**（278×98、锚点 (139,49)）—— 画在 **(440,405)**。
   *
   * ★ 2026-09-17 定案：它**确实**被 blit，而且就在頒獎屏那两张表底下：
   *
   * | 什么时候 | @source |
   * |---|---|
   * | 状态 7（悲情那张 4 行表之前）| VA **0x0043866f**（`push 0x195 / push 0x1b8 / add eax, 0x24`）|
   * | 状态 0x12（冠军那张 4 行表之前）| VA **0x00438deb**（同一套三条指令）|
   *
   * `add eax, 0x24` = `0xc + 12×2` ⇒ **图 2**；`(0x1b8, 0x195)` = (440,405) 是**锚点位置**
   * （`fcn_004563f5` 会减掉图头里的 offX/offY）⇒ 板子左上角 (301,356)、右下角 (579,454)，
   * 正好把表（x 320…560、y 370…424）圈在里面。
   *
   * ⚠️ 先前那句「结算屏原版没有 blit 它」（当行底板用是错的）**只说对了一半**：
   *   结算屏确实不用它，但它不是没用 —— 见 `MONTHLY_TABLE_PLATE`。
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
  /** ★ 字框「別灰心，再加油喔！」= 图 **3**（`0x30 = 0xc + 12×3`）@source 0x00438a31 */
  courageBox: 3,
  /** ★ 收尾「其他人還要更努力喔！」那只框 = 图 **4**（`0x3c`）@source 0x00439120 */
  farewellBox: 4,
  /** 冠军奖座那一屏的底图 = 图 **45**（`0x228`）@source 状态 0x13 那一段 */
  trophyBoard: 45,
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
 * 頒獎／悲情 FLIC 的**每角色落点表** —— `0x4759f7` 起，**每个角色 24 字节**
 * （两组 `(dx, dy, delay)` dword）。
 *
 * | 用哪组 | 谁 | @source |
 * |---|---|---|
 * | 第 1 组（+0/+4/+8）| **冠军的奖座**（状态 0x12）| `[eax*8 + 0x4759f7/0x4759fb/0x4759ff]`，VA 0x00438d40 起 |
 * | 第 2 组（+12/+16/+20）| **悲情人物的立绘**（状态 7）| `[eax*8 + 0x475a03/0x475a07/0x475a0b]`，VA 0x00438570 起 |
 *
 * 落点公式（两处同构，逐条读过）：
 * ```asm
 * x = 0x475930[在榜人数][槽] + dx        ; 竖栏那一列 + 每角色的偏移（有符号）
 * y = 0x14a + dy                         ; 0x14a = 330
 * ; 之后 `fcn_0045144f(影片, x, y, …)` —— x/y 是**左上角**，不减锚点
 * ```
 * ★ 这张表先前的注释写着「绝对值没核出来，用「列心 − 影片一半」近似」——
 *   本轮把 12×24 字节全 dump 出来了（见上表），**近似取消**。
 */
export const MONTHLY_FLIC_OFFSETS: readonly (readonly number[])[] = [
  /* 角色 0 約翰喬 */ [-50, -94, 1539, -77, -148, 3],
  /* 角色 1 沙隆巴斯 */ [-48, -97, 1027, -48, -90, 1539],
  /* 角色 2 忍太郎 */ [-38, -97, 1539, -50, -87, 1539],
  /* 角色 3 錢夫人 */ [-31, -61, 1539, -64, -109, 771],
  /* 角色 4 阿土伯 */ [-41, -87, 1027, -42, -77, 1539],
  /* 角色 5 孫小美 */ [-44, -76, 1027, -31, -60, 515],
  /* 角色 6 烏咪 */ [-36, -100, 1539, -36, -103, 1539],
  /* 角色 7 金貝貝 */ [-50, -89, 1027, -50, -87, 3],
  /* 角色 8 小丹尼 */ [-51, -90, 1027, -51, -92, 3],
  /* 角色 9 沙皮 */ [-31, -60, 1027, -51, -95, 771],
  /* 角色 10 錢多多 */ [-103, -188, 1027, -39, -87, 1539],
  /* 角色 11 大老千 */ [-40, -75, 1027, -40, -75, 1027],
];

/** 一位角色的 FLIC 偏移：`kind = 'trophy'` 取第 1 组，`'sad'` 取第 2 组 */
export function monthlyAwardFlicOffset(
  character: number,
  kind: 'sad' | 'trophy',
): { x: number; y: number; delay: number } {
  const c = Math.min(MONTHLY_FLIC_OFFSETS.length - 1, Math.max(0, Math.trunc(character)));
  const row = MONTHLY_FLIC_OFFSETS[c] ?? MONTHLY_FLIC_OFFSETS[0]!;
  const at = kind === 'trophy' ? 0 : 3;
  return { x: row[at] ?? 0, y: row[at + 1] ?? 0, delay: row[at + 2] ?? 0 };
}

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
 * **冠军的奖座**那段 FLIC —— 同一族资源，基址差 1。
 *
 * @source 状态 0x12（`loc_00438d40`）：`read_mkf(Data.mkf, 0x1a0 + 2×角色)`；
 *   悲情人物那一段是 `0x1a1 + 2×角色`（状态 7），两者正好是同族相邻两张。
 */
export function monthlyTrophyFlicResource(character: number): number {
  return 0x1a0 + 2 * Math.max(0, character);
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
 * ⚠️ 这是**旧读法**：頒獎屏的 x **不是常数**，而是按 `(在榜人数, 名次)` 查表
 *   `0x475930`（见 `MONTHLY_AWARD_SEAT_X`）。这张常数表留下只因为**结算屏**
 *   的 y 表（`0x475918`）的四人行恰好也是这四个值 —— 别再用它当頒獎屏的 x。
 */
export const MONTHLY_SEAT_X = [60, 180, 300, 420] as const;

/**
 * 頒獎屏 4 列的 **x** —— 按 `(在榜人数, 名次)` 查 @source `0x475930`。
 *
 * ```asm
 * ebp = byte [0x48c420]              ; ★ 在榜人数（= who_plays != 0 的人数，
 * shl ebp, 3                         ;   在 0x00439caa 那个循环里数出来）
 * x = word [ebp + 名次*2 + 0x475930] ; ★★ 行 = 人数、列 = 名次
 * ```
 *
 * | 在榜人数 | 四列 x | @source 同形的竖栏表 `0x475960` |
 * |---|---|---|
 * | 2 | `{407, 490}` | `{16, 17}` |
 * | 3 | `{324, 407, 490}` | `{15, 16, 17}` |
 * | 4 | `{324, 407, 490, 573}`（间距 83）| `{15, 16, 17, 18}` |
 *
 * ★ 第 1 行（`{60,180,300,420}` / `{259,334,414,494}`）是**死数据** ——
 *   本游戏至少 2 人（与 D-MONTHLY-1 里「1 人槽是别的数据」是同一条）。
 */
export const MONTHLY_AWARD_SEAT_X: readonly (readonly number[])[] = [
  [],
  [60, 180, 300, 420],
  [407, 490],
  [324, 407, 490],
  [324, 407, 490, 573],
];

/** 頒獎屏 4 列**竖栏图号** —— 同形状查 `0x475960`（值就是图号，15..18）*/
export const MONTHLY_AWARD_SEAT_FRAME: readonly (readonly number[])[] = [
  [],
  [259, 334, 414, 494],
  [16, 17],
  [15, 16, 17],
  [15, 16, 17, 18],
];

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
 * VA 0x004384de/e2），也就是图 `3×角色 + 47` 那一张的字段。
 *
 * ★ **2026-09-16：改成吃真图素** —— `monthlyRowLayout` 多收一个
 *   `portrait`（`{height, anchorY}`），调用方把那张精灵传进来，
 *   y 就是原版那一步。下面这张表只剩「没给图素时」的兜底
 *   （历史上按字符 0..2 都成立的 `(72,36)` 拟的，y 恒 294）。
 *   `Panel.mkf` 资源 25 的 47..82 逐张一查就知道差别有多大：
 *   角色 3（圖 56..58）是 36×58、锚点 y=29 ⇒ **301**，不是 294。见 D-MONTHLY-10。
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
  // ★ 四人在榜时第 4 列是 18（`0x475960` 的四人行 `{15,16,17,18}`）；
  //   原版那一步读的是**角色立绘**那条记录的 `+0x0e`/`+0x12`，三者同值 (72,36)。
  18: { h: 72, y: 36 },
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

/**
 * **「動畫過程」关掉时**状态 2 那一支给的倒数拍数。
 *
 * @source `loc_0043827e`（VA 0x0043827e）：
 * ```asm
 * cmp byte [0x497159], 0        ; 动画关？
 * je  loc_0043827e
 *   ...
 * loc_0043827e:
 * mov byte [0x48c42a], 0x16     ; 状态直接跳 0x16
 * mov dword [0x48c425], 0x1e    ; 计数 = 0x1e
 * ```
 * ★ 状态 0x16（`loc_00439163`）是**倒数块**：`--[0x48c425]`，到 0 或点一下 →
 *   `KillTimer` + 关窗。它**一笔都不画** —— 收尾那只框是状态 **0x13**
 *   （`loc_00439120`）开的，而这条路**不经过 0x13**。
 *   ⇒ 动画关时的正确行为是：頒獎屏**整段不画**（含收尾框），停 0x1e 拍就关屏。
 */
export const MONTHLY_SKIP_TICKS = 0x1e;

/**
 * 状态 **0x13** 开完收尾那只框之后给的倒数拍数 @source `loc_00439120` 尾
 *   `mov dword [0x48c425], 0xa`（10 拍），之后由状态 0x16 倒数到 0 关屏。
 */
export const MONTHLY_FAREWELL_TICKS = 0xa;

/** 字号 @source 0x00439c46 `create_font(0x12, 0x101010, 0, 2, 0)` */
export const MONTHLY_FONT_SIZE = 0x12;
/** 字色：白字 / 红字（`貸款中`）@source 0x00439dd4 `push 0xff0000` */
export const MONTHLY_TEXT = { fill: '#ffffff', loan: '#ff0000', stroke: '#101010' } as const;

/** 结算屏两个标签（原版烤进图 2，本模块补写）@source 串 `0x464e56` / `0x464e90` */
export const MONTHLY_LABELS = { bank: '存款：', interest: '利息：', loan: '貸款中' } as const;

/**
 * 頒獎屏**状态 8「本月悲情人物」那张表**的标签 —— **4 行，不是 5 行**。
 *
 * @source `loc_00438570`（VA 0x00438570 起逐行 `rich4_draw_text`）：
 *
 * | # | y | 标签 VA | 串 | 值 |
 * |---|---|---|---|---|
 * | 1 | 0x172 | `0x464de4` | `獲獎原因：` | **没有值**（原版只画标签）|
 * | 2 | 0x184 | `0x464def` | `本月意外損失：` | `player[+0x5c]`（`+92`）→ `num_to_currency_string` |
 * | 3 | 0x196 | `0x464dfe` | `本月意外之財：` | `player[+0x60]`（`+96`）|
 * | 4 | 0x1a8 | `0x464e0d` | `本月倒楣天數：` | `player[+0x42]`（`+66`）→ `sprintf("%d天")` |
 *
 * ⚠️ 先前把这张表写成了 5 行（多了 `資產：`/`現金：`），而且**把損失/之財的值取反了** ——
 *    `資產：`/`現金：`/`存款：`/`總資產：` 那张是**状态 0x12 的冠军卡**（见
 *    `MONTHLY_CHAMPION_LABELS`），两张表坐标**完全一样**（x 0x140 / 0x230，y 0x172…），
 *    原版是**先后覆盖**画在同一处。见 `docs/deviations/T-041.md` 的 D-MONTHLY-6。
 */
export const MONTHLY_DETAIL_LABELS = {
  reason: '獲獎原因：',
  unexpectedLoss: '本月意外損失：',
  unexpectedGain: '本月意外之財：',
  unluckyDays: '本月倒楣天數：',
} as const;

/** 「本月倒楣天數」那格的后缀 @source 格式串 `0x464e1c` = `%d天` */
export const MONTHLY_DAYS_SUFFIX = '天';

/**
 * 頒獎屏**状态 0x12「本月冠軍」那张表**的标签 —— 与状态 8 同坐标、同 4 行的**另一张表**。
 *
 * @source `loc_00438d40`（VA 0x00438d40，含 0x00438eb0 起那 4 行）：
 *
 * | # | y | 标签 VA | 串 | 值（都是 `[0x48c430]` 那一位 = 首富/冠軍）|
 * |---|---|---|---|---|
 * | 1 | 0x172 | `0x464de4` | `獲獎原因：` | **没有值** |
 * | 2 | 0x184 | `0x464e4f` | `現金：` | `player[+0x1c]`（`+28`）|
 * | 3 | 0x196 | `0x464e56` | `存款：` | `player[+0x20]`（`+32`）|
 * | 4 | 0x1a8 | `0x464e5d` | `總資產：` | `calculate_player_wealth(seat)` @0x004239b9 |
 */
export const MONTHLY_CHAMPION_LABELS = {
  reason: '獲獎原因：',
  cash: '現金：',
  bank: '存款：',
  assets: '總資產：',
} as const;

/** 状态 8 / 状态 0x12 两张表都是 **4 行** @source `loc_00438570` / `loc_00438eb0` */
export const MONTHLY_DETAIL_ROWS = 4;

/**
 * 两张 4 行表**底下那块锦缎板** —— Panel#25 **图 2**，画在 **(440,405)**。
 *
 * @source 两处同一套指令：状态 7 的 VA **0x0043866f**、状态 0x12 的 VA **0x00438deb**
 *   ```asm
 *   push 0x195                  ; y = 405
 *   push 0x1b8                  ; x = 440
 *   mov  eax, [0x48c41c]
 *   add  eax, 0x24              ; = 0xc + 12×2 ⇒ 图 2
 *   push eax / push [0x48a08c] / call fcn_004563f5
 *   ```
 *   `fcn_004563f5` 减图头锚点 ⇒ 板子落在 (301,356)-(579,454)，正好圈住表区。
 */
export const MONTHLY_TABLE_PLATE = { chunk: 2, x: 0x1b8, y: 0x195 } as const;

/**
 * 訊息框三连 —— `fcn_0044ec30(image, x, y, textX, textY, color, ?)` 开框 +
 * `fcn_0044ecb6(文字)` 写字（VA 0x0044ec30 / 0x0044ecb6）。
 *
 * ★ `(x,y)` 是**开框点**：原版用图头里的 `offX/offY` 反推左上角
 *   （`sx = x − offX / sy = y − offY`），在本引擎里就是 sprite 的锚点 ⇒
 *   `drawAnchored(sprite, x, y)` 与它逐像素等价。
 * 文字画在**左上角 + (宽/2, 高/2) + (textX,textY)**，正中（`fcn_0044ecb6` 0x0044ed7d..0x0044eda0）。
 *
 * | 框 | 图 | 框心 | 文字偏移 | @source |
 * |---|---|---|---|---|
 * | `別灰心，再加油喔！` | 3 | (190,10) | (20,0) | 0x00438a31 |
 * | `本月冠軍是…`（存款气泡）| 1 | (190,10) | (0,−30) | 0x00438ab8 |
 * | `其他人還要更努力喔！` | 4 | (213,37) | (20,0) | 0x00439120 |
 */
export const MONTHLY_COURAGE_BOX = { chunk: 3, x: 190, y: 10, textX: 20, textY: 0 } as const;
export const MONTHLY_CHAMPION_BOX = { chunk: 1, x: 190, y: 10, textX: 0, textY: -30 } as const;
export const MONTHLY_FAREWELL_BOX = { chunk: 4, x: 213, y: 37, textX: 20, textY: 0 } as const;

/**
 * 冠军那块**奖座静帧**（图 **45**，210×420）—— 状态 0x12 的**尾巴**贴的那一张。
 *
 * @source `loc_00438ff5`（状态 0x12 的处理）在播完冠军奖座 FLIC 之后：
 * ```asm
 * 00439031  fcn_0045643d(屏, [0x48c41c]+0xc = 图 0, x=0x1b, y=0x40, sx=0x1b, sy=0x40, 0xc3, 0x1a0)
 * 0043905f  fcn_00456418(屏, [0x48c41c]+0x228 = 图 45, 6, 0x3c)      ; ★ 抠黑那份
 * ```
 * ★ 前一句是**同坐标背景还原**（dst == src）—— 本引擎每帧整屏重画，**无需**这一步；
 *   后一句是**真贴图**：图 45 = **210×420**，落在 (6, 0x3c) 正好填满
 *   (6,60)-(216,480) 那块（= 奖座影片演完之后的定格）。
 * ⚠️ `T-041.md` 那张表把这一句记在「状态 0x13」那一行、且把 dst/src 写反了 ——
 *   状态号派发（`loc_00437f51`）里 `0x13` 是**开 `其他人還要更努力喔！` 那只框**，
 *   本句属 **0x12 的尾巴**；本轮按 exe 订正。
 */
export const MONTHLY_TROPHY_PLATE = { chunk: 45, x: 0x06, y: 0x3c } as const;

/**
 * 月結屏開屏那句（`#0092各位客戶辛苦了！⏎又到了每月銀行⏎結算的日子。`）。
 *
 * ★ **本引擎刻意不画它** —— 已按「原版落点不可复现」登记，理由在 exe 里：
 * @source 消息 **0x405**（VA 0x00437f32）在动画开着时 `fcn_0044ecb6(0x464d60)`；
 *   而 `fcn_0044ecb6` 开头是 `cmp dword [0x4762bc], 0 / je 返回` ——
 *   `[0x4762bc]` 是**上一次 `fcn_0044ec30` 开过的字框指针**，全 exe（19 处开框调用）
 *   **从不清零**它，画的位置也取那次开框留下的 `[0x48c608]/[0x48c60c]/[0x48c620]`。
 *   ⇒ 冷启动直接进月结时这句是 **no-op**（与原版一致）；从别的框屏切进来时会被画进
 *   **上一个残留框**里。本引擎不模拟这条脏全局，见 `docs/known-deviations.md`
 *   的「動畫過程」表末行。
 */
// ★ 2026-09-17 逐字节 dump 订正：**真正的串是三条**（两个换行），
//   而且**不是**「月底快到了」—— 先前那份转写从 `0x464d60` 抄错了整行字。
//   @source `Rich4/rich4.exe` 偏移 0x464d60（VA）：
//     `#0092` + `各位客戶辛苦了！` ⏎ `又到了每月銀行` ⏎ `結算的日子。`
export const MONTHLY_INTRO = '各位客戶辛苦了！\n又到了每月銀行\n結算的日子。';

/**
 * 收尾最后那句 —— **★ 中间有一个换行**（先前登记漏了它）。
 * @source 串 `0x464e66`：`#0122其他人還要\n更努力喔！`
 */
export const MONTHLY_FAREWELL = '其他人還要\n更努力喔！';

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
  avatar: { x: number; y: number; chunk: number; bar: number };
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
  /**
   * 这一列的**立绘精灵的尺寸**（`{height, anchorY}`）—— 原版那一步就是从
   * 被画的那张图身上读的（`0x004384de` 的 `sub di, word [eax+0xe]` /
   * `0x004384e2` 的 `add di, word [eax+0x12]`）。只对頒獎屏有意义；
   * 不给就退回下面那张近似表。
   */
  portrait: { height: number; anchorY: number } | null = null,
): MonthlyRowLayout {
  const p = state.players[playerIndex];
  const character = p?.character ?? 0;
  const slot = Math.min(Math.max(playerIndex, 0), MONTHLY_SLOTS - 1);
  // ★ 頒獎屏那两列查的是 **`(在榜人数, 名次)`**，不是玩家下标：
  //   原版 `[0x48c420]` 是「who_plays != 0 的人数」（0x00439caa 那个循环数出来的），
  //   名次则是**在榜玩家按玩家号升序**里的位置（`[0x48c418 + k] = 玩家号`）——
  //   4 人局恰好等于玩家号，出局一个就会整体前移。
  const present = state.players.filter((q) => isAlive(q)).map((q) => q.index);
  const count = Math.max(1, Math.min(MONTHLY_SLOTS, present.length));
  const rank = Math.max(0, present.indexOf(playerIndex));
  const awardFrame = MONTHLY_AWARD_SEAT_FRAME[count]?.[rank];
  const frame = screen === 'settle' ? (MONTHLY_SEAT_FRAME[slot] ?? 0) : (awardFrame ?? 0);
  const size = MONTHLY_AVATAR_FRAME[frame] ?? { h: 0, y: 0 };
  const avatarX =
    screen === 'settle' ? MONTHLY_SEAT_AVATAR_X : (MONTHLY_AWARD_SEAT_X[count]?.[rank] ?? 0);
  const avatarY =
    screen === 'settle'
      ? (MONTHLY_SEAT_Y[slot] ?? 0)
      : MONTHLY_SEAT_BASE_Y - (portrait?.height ?? size.h) + (portrait?.anchorY ?? size.y);
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
      /** 这一列的**竖栏图号**（頒獎屏查 `0x475960`；结算屏不用）*/
      bar: screen === 'settle' ? MONTHLY_CHUNK.columnFirst + slot : (awardFrame ?? MONTHLY_CHUNK.columnFirst + slot),
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
  _topo: MapTopology,
  award: MonthlyAward,
): readonly MonthlyDetailLine[] {
  const sad = award.winner >= 0 ? state.players[award.winner] : undefined;
  const L = MONTHLY_DETAIL_LABELS;
  // 逐行对齐 `loc_00438570`：先 `獲獎原因：`（无值），再损失 / 之财 / 倒楣天数。
  return [
    { label: L.reason, value: '' },
    { label: L.unexpectedLoss, value: currency(sad?.monthlyPaid ?? 0) },
    { label: L.unexpectedGain, value: currency(sad?.monthlyReceived ?? 0) },
    { label: L.unluckyDays, value: `${sad?.totalWinterSleepDays ?? 0}${MONTHLY_DAYS_SUFFIX}` },
  ];
}

/**
 * 状态 0x12「本月冠軍」那张表 —— **和状态 8 同坐标的另一张 4 行表**。
 *
 * @source `loc_00438d40` 尾部那 4 行（VA 0x00438eb0 起）：标签 `0x464de4`（无值）/
 *   `0x464e4f` + `player[+0x1c]` / `0x464e56` + `player[+0x20]` / `0x464e5d` +
 *   `calculate_player_wealth`。主角是 `[0x48c430]`（= `award.richest`，首富/冠軍），
 *   **不是**悲情那一位（`[0x48c42f]`）。
 */
export function monthlyChampionLines(
  state: GameState,
  topo: MapTopology,
  award: MonthlyAward,
): readonly MonthlyDetailLine[] {
  const champ = state.players[award.richest];
  const L = MONTHLY_CHAMPION_LABELS;
  const assets =
    champ === undefined
      ? 0
      : calculatePlayerWealth(
          champ,
          allEffectiveLands(state, topo),
          allEffectiveFacilities(state, topo),
          valuationsOf(state, award.richest),
        );
  return [
    { label: L.reason, value: '' },
    { label: L.cash, value: currency(champ?.cash ?? 0) },
    { label: L.bank, value: currency(champ?.moneyInBank ?? 0) },
    { label: L.assets, value: currency(assets) },
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
  /**
   * 「本月悲情人物」那一拍（原版状态 5..9 那条幻灯片链）—— 说 `別灰心，再加油喔！`。
   *
   * ★ 只在**有悲情人物**时才走：原版状态 2 的判据是
   *   `[0x48c430] != [0x48c42f] && [0x48c42f] != 0xff`（首富 ≠ 悲情 且悲情存在），
   *   否则直接跳收尾（见 `monthlyPlaybackTick` 的 `console` 参数）。
   */
  encourage: boolean;
  /** 颁完奖、等最后一次确认（原版 `[0x48c42a] = 0x11/0x16` 那几步）*/
  closing: boolean;
  /**
   * ★ **「動畫過程」关掉**那条捷径还剩几拍（0 = 不走这条路）。
   *
   * 原版状态 2 在动画关时直接 `[0x48c42a] = 0x16` + `[0x48c425] = 0x1e`
   * （`loc_0043827e`），而状态 0x16 的块（`loc_00439163`）**只倒数、不画** ——
   * 收尾那只 `其他人還要更努力喔！` 是状态 **0x13** 开的，这条路不经过它。
   * 所以：頒獎屏整段不画、停 `MONTHLY_SKIP_TICKS` 拍、然后关屏。
   */
  skipTicks: number;
  /**
   * ★ **收尾之后那一拍**（原版状态 **0x13** + **0x16**）：画最后那只框
   *   `其他人還要更努力喔！`，再倒数 `MONTHLY_FAREWELL_TICKS` 拍关屏。
   *
   * @source `loc_00439120`（0x13）：`fcn_0044ec30(图 4, x=0xd5, y=0x25, 0x14, 0, 0x101010)`
   *   + `fcn_0044ecb6(#0122其他人還要⏎更努力喔！)` → `[0x48c42a] = 0x16`、`[0x48c425] = 0xa`；
   *   然后 `loc_00439163`（0x16）每拍 `dec [0x48c425]`，**减到 0 或点一下**（`[0x48c42e]`）
   *   就 `KillTimer` + `Post_0402_Message` 关屏。
   * ★ 2026-09-17 起**单独成一拍**（先前并在 `closing` 里画，少一拍/少一次点击 —— 见 T-041）。
   */
  farewell: boolean;
  /** 0x16 那个倒数（`[0x48c425]`）；进 `farewell` 时置 `MONTHLY_FAREWELL_TICKS` */
  farewellTicks: number;
  /**
   * ★ 结算屏待机眨眼的拍数（0..`MONTHLY_BLINK_TICKS-1`）。
   *
   * = 原版 `[0x48c42c] & 0x30` 的高半字节（每拍 `+0x10`，到 `0x30` 那一拍
   * 画 `MONTHLY_BLINK_PATCH` 并把状态清 0）。见上面那个常量的长注释。
   */
  blinkTicks: number;
}

/**
 * ★ **记者小姐眨眼那一笔**（`loc_004391ee` 的第 3 帧）—— 原版 `fcn_0045643d` 的
 * 一次**真位移**裁切拷贝：
 *
 * ```asm
 * ; @source 0x004391ee 起（`ebx == 1` 那一支；`ebx = ([0x48c42c] & 0x30) >> 4`）
 * 0043924c  push 0x28 / 0x50 / 0x32 / 0x34        ; 6 个立即数（cdecl 逆序）
 * 00439264  mov eax, [0x48c41c] / add eax,0xf0    ; ⇒ 图 19（186×410 的记者小姐立绘）
 * 00439276  call 0x45643d                          ; ⇒ (dst, 图素, x,y, srcX,srcY, w,h, 1, 0)
 * 00439280  mov byte [0x48c42c], 0                  ; ★ 画完把状态清回 0
 * ```
 *
 * `exblit` 的参数序实测为 `(dst, src, x, y, srcX, srcY, w, h, flags, 0)`
 * （`0x455e24`：`[ebp+0xc]=src`、`[ebp+0x10]=图素`、`[ebp+0x14/0x18]=x/y`、
 * `[ebp+0x1c/0x20]=srcX/srcY`、`[ebp+0x24/0x28]=w/h`），故这一笔是
 * **把图 19 的 (52,50) 起 80×40 原样拷到 (76,120)** —— 落点 (76,120)+80×40
 * 正好是**记者小姐的眼睛那一块**。
 *
 * ★ **什么时候画**：`[0x48c42c] & 0x30` 每画一拍 `+0x10`（`0x4392d4`），
 *   所以是「同一状态下第 4 拍才画」，随后状态清 0。而进入这条支的条件
 *   （`0x439196`）是「`[0x48c42c] & 0xf == 0` 且 `rand15() >> 10` 为 0 或 1」
 *   —— 也就是**结算屏等玩家点击时的待机眨眼**（每 4 拍一次，且有 2/3 概率
 *   每拍重新掷要不要眨眼）。本模块按「每 4 拍一次」的确定性等价实现
 *   （视觉等价；原版那一掷不推进引擎 PRNG 之外的任何状态）。
 *
 * ⚠️ 先前这条被登记为「仍未接线」（`docs/gaps/README.md` §7.3 第 13 项、
 *   `monthly-screen.test.ts` 的 1720 行注释）—— 本轮落码。
 */
export const MONTHLY_BLINK_PATCH = {
  /** 源落点（图 19 局部坐标）*/
  srcX: 0x34,
  srcY: 0x32,
  /** 拷贝尺寸 */
  w: 0x50,
  h: 0x28,
  /** 目的地落点 */
  dstX: 0x4c,
  dstY: 0x78,
} as const;

/**
 * 待机眨眼的拍数 = 4（`[0x48c42c] & 0x30 >> 4` 走 0→1→2→3）。
 * @source 0x004392d4 `add byte [0x48c42c], 0x10`
 */
export const MONTHLY_BLINK_TICKS = 4;

/** 从第 0 行开始（原版 `[0x48c42a] = 0` 那一状态）*/
export function monthlyPlaybackStart(): MonthlyPlayback {
  return {
    phase: 'settle',
    revealed: 0,
    bars: 0,
    seats: 0,
    details: 0,
    encourage: false,
    closing: false,
    skipTicks: 0,
    farewell: false,
    farewellTicks: 0,
    blinkTicks: 0,
  };
}

/**
 * 頒獎屏的**入口** —— 原版状态 2 那两支的判据（`loc_00438254`..`0x0043828f`）：
 *
 * ```asm
 * call fcn_00437d1a / mov [0x48c42f], al   ; 悲情分最高者
 * call fcn_00437dfe / mov [0x48c430], al   ; 首富（= 冠军）
 * cmp byte [0x497159], 0
 * je  loc_0043827e                         ; ★ 动画关 → 状态 0x16 + 计数 0x1e
 * mov ch, [0x48c42f]
 * cmp al, ch / je loc_0043826c             ; 冠军 == 悲情 → 0xf
 * cmp ch, 0xff / jne loc_00438275          ; 悲情不存在 → 0xf
 * loc_00438275: 状态 5                      ; 否则走悲情那条幻灯片链
 * ```
 *
 * 本模块只把**动画关**那一支落成 `skipTicks`（頒獎屏整段不画、停 0x1e 拍关屏）；
 * 动画开那一支仍是既有的「4 板 → 4 列 → 4 行详情 → 悲情一拍 → 收尾」近似
 * （原版是 5..9 + 0xf..0x16 逐状态链，登记在 T-041 的 D-MONTHLY-13）。
 *
 * @param animate `env.animation !== false`
 */
export function monthlyAwardStart(
  animate: boolean,
): Pick<MonthlyPlayback, 'closing' | 'skipTicks'> {
  // 动画关时同时把 `closing` 置真：原版状态 0x16 也是「倒数到 0 **或点一下**」才关屏，
  // 抬手/按键提前关掉是对的。
  return animate
    ? { closing: false, skipTicks: 0 }
    : { closing: true, skipTicks: MONTHLY_SKIP_TICKS };
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
export function monthlyPlaybackTick(
  p: MonthlyPlayback,
  rows: number,
  /** 这一次有没有「悲情人物」要安慰（`monthlyConsolationWho(award) !== null`）*/
  console: boolean = true,
): MonthlyPlayback | null {
  // ★ 动画关那条捷径（原版状态 2 → 0x16）：只倒数，**一笔都不画**。
  if (p.skipTicks > 0) {
    const left = p.skipTicks - 1;
    return left > 0 ? { ...p, skipTicks: left } : null;
  }
  if (p.phase === 'settle') {
    if (p.revealed < Math.max(0, rows - 1)) {
      return { ...p, revealed: p.revealed + 1, blinkTicks: 0 };
    }
    // ★ 全亮之后是**待机拍**：原版正是在这里跑那条眨眼循环
    //   （`0x439196` 的闸门 = `[0x48c42c] & 0xf == 0`），画完那一笔把状态清 0。
    return { ...p, blinkTicks: (p.blinkTicks + 1) % MONTHLY_BLINK_TICKS };
  }
  if (!p.closing) {
    if (p.bars < MONTHLY_SLOTS) return { ...p, bars: p.bars + 1 };
    if (p.seats < MONTHLY_SLOTS) return { ...p, seats: p.seats + 1 };
    if (p.details < MONTHLY_DETAIL_ROWS) return { ...p, details: p.details + 1 };
    // ★ 详情叠完先走**悲情那一拍**（原版状态 9：`別灰心，再加油喔！`），然后才收尾
    //   （状态 0xf→0x10 的「本月冠軍是…」）。
    if (console && !p.encourage) return { ...p, encourage: true };
    return { ...p, closing: true };
  }
  // ★ 收尾之后还有**单独的一拍**（状态 0x13 开框 + 0x16 倒数 0xa）才关屏
  if (!p.farewell) {
    return { ...p, farewell: true, farewellTicks: MONTHLY_FAREWELL_TICKS };
  }
  const left = p.farewellTicks - 1;
  return left > 0 ? { ...p, farewellTicks: left } : null;
}

/**
 * 收尾那一拍说的是**谁** —— 原版状态 0x11 读的是 `[0x48c430]`
 * （= `fcn_00437dfe` 的 `calculate_player_wealth` 最大者），也就是**本月冠軍**。
 *
 * @source 0x00438d04：`al = [0x48c430]` → `[al + 0x48c418]`（座位→玩家）→
 *   `player[+0x13]`（角色）→ 查角色名表 `0x4759b8 + 角色*4` → `fcn_0044ecb6`。
 */
export function monthlyChampionOf(award: MonthlyAward): number {
  return award.richest;
}

/**
 * 要不要安慰谁 —— 原版状态 5..9 那条链说的是 `[0x48c42f]`
 * （= `fcn_00437d1a` 的「支出−收入+冬眠+衰運」最高者，也就是**本月悲情人物**）。
 *
 * @source 状态 5 尾（VA 0x004383a6 一带）`push 0x464dca` =
 *   `#0095本月悲情人物是．．。`；状态 9（VA 0x00438a31）再补一句
 *   `#0108別灰心，再加油喔！`。
 *
 * ⚠️ **不是**收尾那一位 —— 先前把 `award.winner`（悲情分最高者）当成「本月冠軍」
 *   写在收尾那一行，是把两个函数弄反了：`fcn_00437d1a` 是悲情分、`fcn_00437dfe`
 *   才是首富/冠軍（`calculate_player_wealth`），见 `docs/deviations/T-041.md` 的
 *   D-MONTHLY-13。
 */
export function monthlyConsolationWho(award: MonthlyAward): number | null {
  return award.winner >= 0 ? award.winner : null;
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
 * | **2 表底锦缎板** | `fcn_004563f5`（不透明）| ✗ | **0x0043866f** / **0x00438deb** |
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
  // ★ 四只訊息框：原版全走 `fcn_00456418`（带透明）—— 见各常量的 @source
  MONTHLY_CHUNK.bubble,
  MONTHLY_CHUNK.courageBox,
  MONTHLY_CHUNK.farewellBox,
  MONTHLY_CHUNK.trophyBoard,
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
 * 訊息框：`fcn_0044ec30` 开框（`drawAnchored` 与它逐像素等价，见常量注释）
 * + `fcn_0044ecb6` 把文字画在**框心 + (textX,textY)**、多行上下摊开。
 */
function drawMonthlyBox(
  ctx: CanvasRenderingContext2D,
  sprite: MonthlySprite,
  box: { chunk: number; x: number; y: number; textX: number; textY: number },
  text: string,
): void {
  const img = monthlySprite(sprite, box.chunk);
  drawAnchored(ctx, img, box.x, box.y);
  // ★ 2026-09-23 订正（框模板反查）：字心照 `fcn_0044ecb6` —— `x0 + (宽 >> 1) + dx`、`y0 + (高 >> 1) + dy`，
  //   `x0 / y0` = 开框点减图头锚点（`0x0044ec61..0x0044ec7b`；这三张锚点都是 (0,0) ⇒ 就是开框点）。
  //   先前把 (x,y) 当成框心，字落在框的左上角；字效也照 `create_font(0x14, 0x101010, 0, 2, 1)`
  //   （`0x0044ed65`）改成 20 号深色粗体（先前是 18 号白字黑边）。
  //   图还没到货时按素材表尺寸兜底（Panel#25 图 1 = 290×201、图 3 = 239×193、图 4 = 195×142，锚点均 0）。
  const fallback: Readonly<Record<number, { w: number; h: number }>> = { 1: { w: 290, h: 201 }, 3: { w: 239, h: 193 }, 4: { w: 195, h: 142 } };
  const w = img?.width ?? fallback[box.chunk]?.w ?? 0;
  const h = img?.height ?? fallback[box.chunk]?.h ?? 0;
  const x0 = box.x - (img?.anchorX ?? 0);
  const y0 = box.y - (img?.anchorY ?? 0);
  const cx = x0 + (w >> 1) + box.textX;
  const cy = y0 + (h >> 1) + box.textY;
  const lines = text.split('\n').filter((l) => l !== '');
  const style = clerkTextStyle();
  const lineH = style.size + 6;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    drawGdiText(ctx, line, cx, cy + (i - (lines.length - 1) / 2) * lineH, style);
  });
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
  if (award === null) return false;
  // ★ 动画关那条捷径（原版状态 2 → 0x16）整段頒獎屏都不走 ⇒ 两段 FLIC 都不演。
  if (p.skipTicks > 0) return false;
  /**
   * 两段 FLIC 用**同一条**绘制路径，差别只有「演谁 + 哪张资源」：
   * - 頒獎屏（状态 7、`0x1a1+2×角色`）：**悲情人物**立绘 —— 台上四个人铺好之后；
   * - 收尾（状态 0x12、`0x1a0+2×角色`）：**冠军的奖座** —— `closing` 那一拍起。
   */
  const trophy = p.closing;
  const who = trophy ? award.richest : award.winner;
  if (who < 0) return false;
  if (!trophy && (p.phase !== 'award' || p.seats < MONTHLY_SLOTS)) return false;
  if (trophy && !p.closing) return false;
  const win = state.players[who];
  if (win === undefined) return false;
  const film = flic('Data.mkf', trophy
    ? monthlyTrophyFlicResource(win.character)
    : monthlyAwardFlicResource(win.character));
  if (film === null || film.frames.length === 0) return false;
  const ms = film.frameMs > 0 ? film.frameMs : 71;
  const i = Math.min(film.frames.length - 1, Math.max(0, Math.floor(now / ms)));
  const bmp = film.frames[i];
  if (bmp === undefined) return false;
  // ★ 落点照表算（不再是「列心 − 影片一半」的近似）：
  //   x = 0x475930[在榜人数][槽] + dx[角色]、y = 0x14a + dy[角色]，
  //   而且 x/y 是**左上角**（`fcn_0045144f` 不减锚点）——
  //   见 `MONTHLY_FLIC_OFFSETS` 的注释与 `docs/deviations/T-041.md` 的 D-MONTHLY-6。
  const at = monthlyRowLayout(state, who, 'award');
  const off = monthlyAwardFlicOffset(win.character, trophy ? 'trophy' : 'sad');
  const x = Math.round(at.avatar.x + off.x);
  const y = Math.round(MONTHLY_AWARD_FLIC_DX + off.y);
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

  // ── ② 待机眨眼（`loc_004391ee` 的第 3 帧）──
  // 只在**结算屏等点击**时画：那一支的闸门是 `[0x48c42c] & 0xf == 0`。
  if (p.phase === 'settle' && p.blinkTicks === MONTHLY_BLINK_TICKS - 1) {
    const blink = monthlySprite(sprite, MONTHLY_CHUNK.panel, false);
    if (blink !== null) {
      ctx.drawImage(
        blink.bitmap,
        MONTHLY_BLINK_PATCH.srcX - blink.anchorX,
        MONTHLY_BLINK_PATCH.srcY - blink.anchorY,
        MONTHLY_BLINK_PATCH.w,
        MONTHLY_BLINK_PATCH.h,
        MONTHLY_BLINK_PATCH.dstX,
        MONTHLY_BLINK_PATCH.dstY,
        MONTHLY_BLINK_PATCH.w,
        MONTHLY_BLINK_PATCH.h,
      );
    }
  }

  // ── ③ 頒獎屏 ──
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

  // 4 列竖栏（图 15..18，不透明）—— ★ 图号也查表（`0x475960`，两人局是 16/17）
  for (let s = 0; s < p.seats; s++) {
    const row = view.rows[s];
    if (row === undefined) continue;
    const at = monthlyRowLayout(state, row.index, 'award');
    drawAnchored(ctx, monthlySprite(sprite, at.avatar.bar, false), at.avatar.x, MONTHLY_BAR_Y);
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
    // ★ 先把那张立绘拿出来：原版的 y 就是从**它自己**的 height/锚点算的
    const character = state.players[row.index]?.character ?? 0;
    const face = monthlySprite(
      sprite,
      MONTHLY_AVATAR_STRIDE * character + MONTHLY_CHUNK.avatarFirst,
    );
    const at = monthlyRowLayout(state, row.index, 'award', face);
    drawAnchored(ctx, face, at.avatar.x, at.avatar.y);
  }

  // ── ③ 详情（`loc_00438570`）── **悲情那张 4 行表**（状态 8）
  //    ★ 收尾那一拍（`closing`）时原版走状态 **0x12**：先把这一带底图恢复，再在
  //      **完全相同的坐标**画**冠军那张 4 行表**（`loc_00438d40`）—— 是**整表换掉**，
  //      不是叠加。本模块因此在 `closing` 时整表切成 `monthlyChampionLines`。
  //    ⚠️ 动画关那条捷径（`p.skipTicks > 0`）**连这张表都不画** —— 原版状态 2
  //      直接跳 0x16，而 0x16 只倒数（`loc_00439163`），一張表都不经过。
  if (p.skipTicks === 0) {
    // 表底那块锦缎板（图 2，锚点 (440,405)）—— 状态 7 / 0x12 都在画表**之前**贴它
    if (p.closing || p.farewell || p.details > 0) {
      drawAnchored(
        ctx,
        monthlySprite(sprite, MONTHLY_TABLE_PLATE.chunk),
        MONTHLY_TABLE_PLATE.x,
        MONTHLY_TABLE_PLATE.y,
      );
    }
    drawMonthlyAwardTables(ctx, state, topo, award, p);
  }

  // ── 「本月悲情人物」那一拍（原版状态 5..9 那条链的收束）──
  //    @source 状态 5 尾 VA 0x004383a6 `push 0x464dca` = `#0095本月悲情人物是．．。`；
  //      状态 9 VA 0x00438a31 = `#0108別灰心，再加油喔！`（那只盒子见 D-MONTHLY-7）。
  //    ⚠️ 本模块把这条链压成**一拍两行字**（原版是 4 张幻灯片 + 两只气泡），登记在
  //      T-041 的 D-MONTHLY-13。
  if (p.encourage && p.skipTicks === 0) {
    const sad = monthlyConsolationWho(award);
    const who = sad === null ? '' : (CHARACTERS[state.players[sad]?.character ?? 0]?.name ?? '');
    const y0 = MONTHLY_DETAIL_AT.y0 + 6 * MONTHLY_DETAIL_AT.step;
    // 状态 5/6：`#0095本月悲情人物是．．。` + 角色名（原版是两次 `fcn_0044ecb6`）
    monthlyText(ctx, `${MONTHLY_TRAGIC}${who}`, MONTHLY_DETAIL_AT.x, y0, MONTHLY_TEXT.fill);
    // 状态 9：**字框**（图 3）里那句 `別灰心，再加油喔！` @source 0x00438a31
    drawMonthlyBox(ctx, sprite, MONTHLY_COURAGE_BOX, MONTHLY_NO_AWARD);
  }

  // ── 收尾那一句「本月冠軍是」── **冠军 = 首富**（`[0x48c430]`），不是悲情那一位。
  //    @source 状态 0xf→0x10 VA 0x00438b9c `push 0x464e39` = `#0109本月冠軍是．．。`；
  //      状态 0x11 VA 0x00438d24 再把**冠军的角色名**（表 `0x4759b8 + 角色*4`）画进同一只气泡。
  if (p.closing && p.skipTicks === 0) {
    const champ = state.players[monthlyChampionOf(award)];
    const who = champ === undefined ? '' : (CHARACTERS[champ.character]?.name ?? '');
    // 状态 0xf→0x10 开**存款气泡**（图 1，框心 (190,10)、文字偏移 (0,−30)）写 `#0109`，
    // 状态 0x11 再把冠军的角色名（表 `0x4759b8`）画进同一只气泡 @source 0x00438ab8 / 0x00438d04
    drawMonthlyBox(ctx, sprite, MONTHLY_CHAMPION_BOX, `${MONTHLY_CHAMPION}${who}`);
  }

  // ── 状态 **0x13**（`loc_00439120`）：最后那只框「其他人還要更努力喔！」
  //    @source `fcn_0044ec30(图 4, 213, 37, 20, 0, 0x101010)` + 串 `0x464e66`
  //    ★ 2026-09-17：它**单独成一拍**（`p.farewell`）—— 原版状态 0x12 走完才进 0x13
  //      开这只框、再由 0x16 倒数 0xa 拍（点一下可提前关屏）。
  //      **动画关时原版不经过 0x13**，那只框根本不出现 —— 所以这里仍要 `skipTicks === 0`。
  if (p.farewell && p.skipTicks === 0) {
    // 奖座定格（状态 0x12 尾巴）—— 在最后那只框**之前**贴（原版就是这个次序）
    drawAnchored(
      ctx,
      monthlySprite(sprite, MONTHLY_TROPHY_PLATE.chunk),
      MONTHLY_TROPHY_PLATE.x,
      MONTHLY_TROPHY_PLATE.y,
    );
    drawMonthlyBox(ctx, sprite, MONTHLY_FAREWELL_BOX, MONTHLY_FAREWELL);
  }
}

/**
 * 頒獎屏那两张**同坐标的 4 行表**（状态 8 悲情 / 状态 0x12 冠军）—— 单独一支，
 * 方便 `drawMonthlyScreen` 在「动画关」那条捷径里整块跳过。
 */
function drawMonthlyAwardTables(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  topo: MapTopology,
  award: MonthlyAward,
  p: MonthlyPlayback,
): void {
  // ★ `farewell` 那一拍（状态 0x13/0x16）画面上仍是**冠军那张表**（原版不擦屏）
  const championTable = p.closing || p.farewell;
  const lines = championTable
    ? monthlyChampionLines(state, topo, award)
    : monthlyDetailLines(state, topo, award);
  const shown = championTable ? MONTHLY_DETAIL_ROWS : Math.min(p.details, lines.length);
  for (let i = 0; i < shown; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const y = MONTHLY_DETAIL_AT.y0 + i * MONTHLY_DETAIL_AT.step;
    monthlyText(ctx, line.label, MONTHLY_DETAIL_AT.x, y, MONTHLY_TEXT.fill);
    // 第 1 行 `獲獎原因：` 在原版里**只画标签**（两张表都是），没有值可写。
    if (line.value !== '') {
      monthlyText(ctx, line.value, MONTHLY_DETAIL_AT.valueX, y, MONTHLY_TEXT.fill, 'right');
    }
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

  /**
   * 联机旁观：行动者那台已经收场（见 `ui-screen.ts` 的 `fastForward`）⇒ 直接关屏
   * （= 点两下「结算屏 → 頒獎屏 → 关」的终态）。`midi10` 不用停：没有整屏接管时
   * `main.ts` 的 `boardBgmDue()` 自己接回棋盘曲。
   */
  fastForward(env: UiScreenEnv): boolean {
    if (playback === null) return false;
    playback = null;
    view = null;
    award = null;
    snapshot = null;
    env.log('每月結算：跟著行動者收場');
    env.requestRender();
    return true;
  },

  tick(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    const rows = view?.rows.length ?? 0;
    // ★ 有没有「悲情人物」要安慰 —— 原版状态 2 的判据（见 `monthlyConsolationWho`）。
    //   ⚠️ 「動畫過程」关掉时原版直接跳状态 `0x16`（VA 0x00438254 那两支），
    //   也就是**整条 5..9 幻灯片链（悲情人物那一段）都不走** ⇒ 这里同样传 false。
    const console =
      env.animation !== false && award !== null && monthlyConsolationWho(award) !== null;
    const next = monthlyPlaybackTick(p, rows, console);
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
    // ★ 进屏配乐 @source `rich4.asm:19212` `push 9 / call fcn_004549cf`
    //   ⇒ id 9 → `MIDI10.MID` → 磁盘名 `midi10.mid`（见 `SCREEN_BGM.monthly`
    //   与 `bgmAssetFileFor`；表 `0x47e793`）。先前这条一直登记为「未接」。
    env.music?.('midi10.mid');
    env.log(`每月結算：${v.rows.length} 人`);
    env.requestRender();
  },
};

/** 一次「确认」：结算屏 → 頒獎屏；頒獎屏（已 `closing`）→ 关屏 */
function advance(env: UiScreenEnv): void {
  const p = playback;
  if (p === null) return;
  if (p.phase === 'settle') {
    // ★ 原版状态 2 就在这一步判「動畫過程」开不开：关 → 状态 0x16（只倒数、不画）
    playback = {
      ...p,
      phase: 'award',
      revealed: 0,
      bars: 0,
      seats: 0,
      details: 0,
      encourage: false,
      ...monthlyAwardStart(env.animation !== false),
    };
    env.requestRender();
    return;
  }
  // ★ 状态 0x16 的「点一下就关」：倒数没走完也能点掉（`[0x48c42e]` 那一位）
  if (p.farewell) {
    playback = null;
    view = null;
    award = null;
    snapshot = null;
    env.log('每月結算：关闭');
    env.requestRender();
    return;
  }
  // 收尾那一拍点一下 → 进**最后那一拍**（原版：状态 0x12 走完 → 0x13 开框），不直接关屏
  if (p.closing) {
    playback = { ...p, farewell: true, farewellTicks: MONTHLY_FAREWELL_TICKS };
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
