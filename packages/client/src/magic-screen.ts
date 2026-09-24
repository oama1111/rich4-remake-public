/*
 * 魔法屋屏（女巫窗口：开场白 → 摇签 → 玩家点一格）—— T-037 / U-9 / MOD-12
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 2026-09-23 订正（第十二份试玩回报）：这一屏**是真人拿主意的那一屏**，不是回放。
 *   入口 `0x0043380a` 按 `who_plays == 1` 分流（`0x0043381b`）：真人开女巫窗口
 *   `0x4325c2`，**窗口返回值就是效果号**（`0x004338b7 mov esi, eax` → `0x431caa`）；
 *   电脑不开窗，两个转盘都 `rand()`（`0x0043390b`）。
 *   ⇒ core 在落点只转**目标转盘**、挂 `pending{magicHouse}`；本屏照原版状态机
 *   `[0x48c3a2]` 1..8 走一遍：三句开场白 → 摇签（字框收起）→ 条件名 → 「輪到你了」→
 *   **状态 7 等玩家点 1..12 格** → 抬手 + 「天靈靈地靈靈」→ 关窗时派
 *   `{type:'magicHouse', option}`。
 *   先前本屏把 core 已经掷好的效果「转两圈停在那一格」回放出来 —— 玩家点什么都不算数
 *   （回报「选所有女生存入现金，金貝貝不受影响」），而且一开屏日志就是那个效果名
 *   （回报「为什么魔法屋默认就展示就地拆除房屋」）。
 *
 * ★★ 字框（图 8 落 (320,384)）**不是整屏一直在**：`fcn_0044ecb6` 挂上一句时存下框底下那块，
 *   `fcn_0044ee18` 到期（≥ 2000 ms）就把它贴回去（0x0044eeb4）⇒ **摇签（状态 4）与
 *   等玩家点（状态 7）时屏上没有字框**。先前一直画着，280×173 的框把最下面那三格
 *   （5/6/7 号，中心 y ≈ 390）整块盖住（回报「魔法屋的文案挡住了最下面的转盘」）。
 *
 * ## 出处（窗口过程 VA 0x004325c2；入口 `magic_house` VA 0x0043380a）
 *
 * ★ 取图一律走 MKF 记录表：**图 i 的记录 = `[0x48c398] + 0xc + 12×i`**
 *   （12 字节表头 + 12 字节/项，见 `render-api.md` 链路 1之二）。
 *   故 `+0x18` = 图 **1**、`+0x24` = 图 2、`+0x30` = 图 3、`+0x3c` = 图 4、
 *   `+0x48` = 图 5、`+0x6c` = 图 8。**「0x18/12 = 图 2」那种算法漏了表头**。
 *
 * | 是什么 | 落点 | @source |
 * |---|---|---|
 * | 底图 = 图 0（640×480，**十二个图标本来就画在这张 art 里**）| (0,0) | 0x0043253b（`+0xc`，不透明 blit）|
 * | 女巫**抱水晶球** = 图 1（165×213）| **(241,140)** | 0x00432543（`push 0x8c / push 0xf1` ⇒ x=0xf1,y=0x8c）＋ 0x00432791 |
 * | 女巫**抬手** = 图 2（284×210）| **(182,142)** | 0x00432f60（`mov edx,0xb6 / mov ecx,0x8e`）|
 * | 闭眼贴片 = 图 3（60×35）| (286,188) | 0x00432951（Lock 矩形 `0x11e/0xbc/0x15a/0xdf`）|
 * | 眼睑/闭嘴贴片 = 图 4（60×18）| (286,220) | 0x004328f2（矩形 `0x11e/0xdc/0x15a/0xee`，源 `+0x3c`）|
 * | 张嘴贴片 = 图 5（60×21）| (286,217) | 0x00432b00（源 `+0x48`）|
 * | 字框 = 图 8（280×173）| (320,384) | 0x00432596（`fcn_0044ec30`）|
 * | 一圈十二个**高亮**图标 = 图 **23..34** | 表 `0x4756e8` | 0x00432cc0（见下）|
 * | 抽中的**条件**图 = 图 **11..22**（= `条件号 + 0xb`）| **(326,296)** | 0x004327aa（`lea edx,[eax+0xb]`，eax = `[0x48c3a3]` = 条件号）|
 * | 悬停的锦缎框 = 图 6/7/9/10（142×120）**按功能而异** | 记录表 x/y | 0x00432dc4（`[0x475708+16k]` = 图号）|
 *
 * ## ★★ 两张女巫**从不同时出现**
 *
 * - 图 1（抱水晶球）是**铺场**那张（`fcn_00432511` @0x00432543）与**摇签完**那张
 *   （`loc_00432719` @0x00432791）—— 状态 1..7 屏上一直是它；
 * - 图 2（抬手）**只在玩家点下去之后**贴一次（`loc_00432e8e` @0x00432f60，状态 7→8），
 *   它的落点 (182,142)+(284×210) 把图 1 的 (241,140)+(165×213) 整块盖住。
 *
 * ⇒ 先前本模块**在同一拍把两张都画**（而且图 1 的 x/y 写反成 (140,241)、图 2 画在
 *   嘴的落点 (286,217) 上），于是屏上并排出现两只女巫 —— 这是玩家报的「2 个女巫」。
 *
 * ## ★★ 一圈那十二格：**图标中心 = `0x4756e8` 那张 word 表，不是记录表**
 *
 * ```asm
 * ; 原版悬停/命中之后画那一格的高亮图标（VA 0x00432cbe 起）
 * 00432cbe  mov  cl, al                          ; al = [0x48c3a1] = 命中表给的扇区 1..12
 * 00432cc0  movsx edx, word [ecx*4 + 0x4756e4]   ; ★ x（k=1 → 0x4756e8）
 * 00432ccf  movsx eax, word [ecx*4 + 0x4756e6]   ; ★ y
 * 00432cec  push eax / push edx                  ; 锚点落 (x,y)
 * 00432cee  lea  edx, [ecx + 0x16]               ; ★ 图号 = 扇区 + 22 = 功能号 + 23
 * 00432d0e  call 0x456418                        ; 抠黑 blit
 * ```
 *
 * 十二个中线读出来是 `MAGIC_RING_AT`，配 30° 一条的中线（90°/60°/…）、半径 152..190，
 * 与实机截图里那十二个图标逐个吻合（也见 `png` 对照：图 23 = 图 0 里 (322,91) 那
 * 四张牌的**高亮版**）。
 *
 * ⚠️ 记录表 `0x475718`（每项 16 字节 `{+0 图号, +4 x, +8 y, +12 名称}`）的 x/y
 *   **不是图标位置** —— 那是**悬停弹窗框与功能名**的落点（0x00432dbd/0x00432db6/
 *   0x00432e12/0x00432e19 读的就是它，配 142×120 的锦缎框）。先前把两者当成
 *   同一个，十二个图标于是被摆到弹窗的位置上、散得满屏都是（「排版混乱」）。
 *
 * ## 命中：原版是**逐像素的命中图**，不是算角度
 *
 * 原版把 `Panel.mkf` **#19**（307200 字节 = 640×480 每像素一字节）读进 `[0x48c394]`，
 * 鼠标一动就查（VA 0x00432b50）：
 * ```asm
 * 00432b50  cmp  byte ptr [0x48c3a2], 7      ; ★ 只有状态 7（转盘停了、等玩家选）才查
 * 00432b5d  xor  ecx, ecx / mov cx, dx       ; ecx = lParam 低 16 位 = ★ x
 * 00432b62  mov  eax, edx / shr eax, 0x10 / and eax, 0xffff   ; eax = ★ y
 * 00432b73  shl  eax, 2 / add eax, edx       ; eax = 5y
 * 00432b78  shl  eax, 7                      ; eax = 640y
 * 00432b7b  add  eax, ecx                    ; ★ eax = 640y + x
 * 00432b83  mov  al, byte ptr [edx + eax]    ; edx = [0x48c394] = #19 那张掩膜
 * ```
 * 即 **`表[640y + x]`（一张 640×480、每像素一字节的图）**。表里
 * **1..12 = 十二个功能**、**13 = 中间的对话框区**、0 = 不认。
 * 逐像素滚一遍 #19 量出来的几何（这才是权威）：
 *
 * - 圆心 **(320, 238)**（第 13 块的重心实测 (320.3, 238.3)）；
 * - 十二个扇区是 **以 90°/60°/…/330° 为中线的 ±15° 楔形**（顺时针数），
 *   外侧到 **r ≈ 241**；
 * - 中间那块（13）到 **r = 136**，而楔形从 **r ≈ 116** 起 —— 两圈在手绘掩膜里
 *   是**犬牙交错**的（所以取 126 当分界，见 `MAGIC_INNER_RADIUS`）；
 * - 数据里每条楔形外缘长短不一（216..241），那是原版**手绘**的掩膜，
 *   本模块用**一个外半径**近似（见 deviations）。
 *
 * 扇区号 → 功能号：`[0x4756e4 + 扇区*4]` 取的就是该扇区的**中线**坐标
 * （扇区 1 → `0x4756e8` = (322,91) = 图 0 里「四张牌」那一格 = 第 **0** 项
 * 「變賣所有卡片」），所以**扇区号 = 功能号 + 1**，图标 = 扇区 + 22 = 功能号 + 23。
 *
 * ★ 掩膜量出来的**方位**（这一条先前写反过，是「点不动」的主因之一）：
 *   十二条楔形是**以 90°/60°/…/330° 为中线的 ±15°**（屏幕 y 向下，顺时针数），
 *   而**不是**以 0°/30°/… 为中线的。12 个中线角度与 `MAGIC_RING_AT` 逐个对上
 *   （扇区 1 在上方 90°）。本模块的 `sectorAt` 按这个方位切。
 *
 * ## 音效
 *
 * 窗口过程里**只有一个音**：状态 7 悬停到 1..12 格时 `_rich4_play_sound_effect(0, &0x4757e7)`
 * （0x00432e42；`0x4757e7` 首字节 = **0x27 = 39**，由入口 `0x00433828` 载入）。
 * 点下去那一支（`loc_00432e8e`）**不放音**。关窗影片（`Panel` #20）自带一声 **0x3b = 59**
 * （`fcn_0045144f` 的 arg5，见 `MAGIC_CLOSE_FILM`）。
 *
 * ## ★★ 2026-09-23 再审（逐拍对 `0x4325c2`）订正的几处
 *
 * - 字框一句话挂 **max(2000 ms, 语音时长)**（`fcn_0044ee18` → `0x4544b9`），不是固定 2000 ms；
 * - 开场白里点一下跳过时**停掉语音**（`fcn_0044ee18(1)` → `0x454493`）；
 * - 女巫嘴型按**定时器拍**摆（1/4 的拍子换、停 1..7 拍、停满贴合嘴），贴片一直留到图 1 重贴；
 * - 状态 8 图 1 仍在图 2 底下（图 2 抠黑贴，两边袖口露出图 1）；字框（图 8）抠黑贴；
 * - 进状态 7 补发的 `WM_MOUSEMOVE` 落在 1..12 格上也响 39；
 * - 念完「天靈靈地靈靈」之后先播**关窗影片** Panel #20（25 帧 × 71 ms、音效 59）再关窗（D-MAGIC-15 收口）。
 * ⚠️ 先前本屏还放了 0 号（「悬停」@0x00433531）与 1 号（「按下」@0x0043365c）——
 * 那两处在 `0x433088` 起的**死神窗口**（`_rich4_call_god_of_death_callback`）里，
 * 不是这扇窗的，已去掉。
 */

import { MAGIC_HOUSE_OPTIONS, stripVoiceCode } from '@rich4/data';
import { playVoiceCode, stopVoice, voiceBusy } from './voice-sink.ts';
import { beginBoardFilm, boardFilmBitmap, boardFilmDone, type BoardFilm, type BoardFilmSpec } from './board-film.ts';
import { MAGIC_TARGET_NAMES, type GameState } from '@rich4/core';
import { FONT_FAMILY, clerkTextStyle, drawGdiText } from './font.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import { ARROW_CURSOR, showCursor, type CursorWant } from './soft-cursor.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { drawSprite, drawSpriteRegion } from './hd-stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type MagicSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 本屏的全部素材都在 `Panel.mkf` #18 @source 0x0043385c `push 0x12` */
export const MAGIC_RESOURCE = 18;

/**
 * 图号 —— **逐张看过** `assets-clean/Panel/0018_*.png` 之后落的表。
 *
 * | 图 | 尺寸 | 是什么 | 用在哪 | @source |
 * |---|---|---|---|---|
 * | 0 | 640×480 | 整屏底图（五芒星 + **十二个图标** + 边角饰纹） | 铺场 | 0x0043253b |
 * | 1 | 165×213 | 女巫**抱水晶球**（常态，状态 1..7）| 铺场 / 摇签完 | 0x00432543 / 0x00432791 |
 * | 2 | 284×210 | 女巫**双手抬起**（点下去之后那一拍，状态 8）| 结果 | 0x00432f60 |
 * | 3 | 60×35 | **闭着的眼睛**（含鼻梁）| 摇签起一直在 | 0x004329a7 |
 * | 4 | 60×18 | **合着的嘴**（一条线）| 状态 4 的眨眼拍 | 0x004328f2 |
 * | 5 | 60×21 | **张开的嘴** | 状态 4 的眨眼拍 | 0x00432b1a |
 * | 6 / 7 | 142×120 | 悬停弹窗的锦缎框 | 悬停 | 0x00432de6 |
 * | 8 | 280×173 | 中央那只**木牌**（字框）| 挂着一句话时（到期贴回底下那块）| 0x00432596 / `fcn_0044ecb6` |
 * | 9 / 10 | 142×120 | 悬停弹窗框（另两张）| 悬停 | 0x00432de6 |
 * | **11..22** | 40..57 | **十二个「条件」的图标**（寶箱 / 土地 / 房屋 / 现钞 / 存摺 / 點券 / 走路 / 機車 / 汽車 / 神明 / ♂ / ♀）| 抽中的条件 | 0x004327aa |
 * | **23..34** | 40..64 | **十二个「功能」的图标**（= 图 0 里那十二个的**高亮版**）| 悬停/转盘指针 | 0x00432cfd |
 *
 * ★ 两个索引**都不是「功能号 + 0x16」**那种读法（那会漏掉 12 字节表头）：
 *   - 功能高亮图标：`lea edx, [ecx + 0x16]`（VA 0x00432cee），而 `ecx` = **扇区号 1..12**
 *     ⇒ 图 `扇区 + 22` = `功能号 + 23`（第 0 个功能 = 图 23 = 四张牌）；
 *   - 条件图标：`lea edx, [eax + 0xb]`（VA 0x004327aa），`eax` = `[0x48c3a3]` = **条件号 0..11**
 *     ⇒ 图 `条件号 + 11`（条件 0「財產最多的人」= 图 11 = 装满宝石的寶箱，逐个看过）。
 */
export const MAGIC_CHUNK = {
  /** 底图（整屏） */
  bg: 0,
  /**
   * 常态那张女巫（抱水晶球，165×213）—— **落点 (241,140)**
   * @source 0x00432543 `push 0x8c / push 0xf1`（x 是后压的那个）
   *   ＋ 0x00432791（摇签完再贴一次，同一个点）。
   */
  witchIntro: 1,
  /**
   * 「抬手」那张女巫（284×210）—— **落点 (182,142)**，**只在点下去之后**那一拍。
   * @source 0x00432f60（`mov edx,0xb6` = x、`mov ecx,0x8e` = y，
   *   `loc_00432e8e` = WM_LBUTTONDOWN 那一支）。
   * ★ 它把图 1 的 (241,140)+(165×213) 整块盖住 ⇒ 两张**从不同时可见**。
   */
  witchIdle: 2,
  /**
   * 女巫脸上的三张**贴片**（60×35 / 60×18 / 60×21）——
   * 「闭眼」/「合着的嘴」/「张开的嘴」。逐张看过 `Panel/0018_003..005.png`。
   *
   * ★ 先前把图 9/10（142×120 的**悬停弹窗框**）当成「女巫头部特写」是错的 ——
   *   那两张画在女巫的位置上会变成第三只锦缎框，女巫于是「消失」（B-2 症状③）。
   */
  /** 闭眼贴片（60×35）@source 状态 3：`[0x48c398]+0x30` 贴到 (286,188) */
  eyesShut: 3,
  /** 合嘴贴片（60×18）@source 状态 4：`+0x3c` 贴到 (286,220)（Lock 60×18）*/
  eyelid: 4,
  /** 张嘴贴片（60×21）@source 0x00432b0f：`+0x48` 贴到 (286,217) */
  mouth: 5,
  // 旧名保留（同图号）：先前误当作「文字长条」
  barIntro: 3,
  barHint: 4,
  barText: 5,
  /** 女巫「说话」那张嘴（= 图 5，与 `barText` 同一张）@source 0x00432894 / 0x00432b0f */
  mouthTalk: 5,
  /**
   * 悬停弹窗那四个锦缎框（142×120）。
   *
   * @source 记录表 `0x475718` 的 `+0`（每项 16 字节：`{img@0, x@4, y@8, name@12}`），
   *   十二个选项的 img 依次是 `{9,10,7,7,7,7,7,6,6,6,6,9}`（0x00432dc4），
   *   **框与功能名同点**（`magicPopupAt(option)` = 记录的 x/y）。
   */
  frame: 6,
  frameAlt: 7,
  /** 中央木牌 / 字框（280×173）—— 落 (320,384) @source 0x00432596 */
  resultBar: 8,
  /** 悬停弹窗框（另两张，同 142×120） */
  hoverFrame: 9,
  hoverFrameAlt: 10,
  /** 「条件」图标的第一张 = 图 11（条件 0「財產最多的人」） */
  targetIconFirst: 11,
  /** 「功能」高亮图标的第一张 = 图 23（功能 0「變賣所有卡片」） */
  ringFirst: 23,
} as const;

/**
 * 「扇区号 → 高亮图标」的基数 @source `lea edx, [ecx + 0x16]`（VA 0x00432cee）
 *   —— `ecx` 是**扇区号 1..12**（命中表给的值），故第 0 个功能 = 图 **23**。
 */
export const MAGIC_ICON_SLOT_BASE = 0x16;

/**
 * 「条件号 → 条件图标」的基数 @source `lea edx, [eax + 0xb]`（VA 0x004327aa）
 *   —— `eax = [0x48c3a3]` = 抽中的条件号 0..11，故条件 0 = 图 **11**。
 */
export const MAGIC_TARGET_ICON_BASE = 0x0b;

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 底图落点 @source 0x00432511 的两处 `push 0` */
export const MAGIC_BG_AT = { x: 0, y: 0 } as const;

/**
 * ★★ **一圈那十二格的图标中心** —— 表 `0x4756e8`（12 × `(word x, word y)`）。
 *
 * @source 原版画高亮图标（VA 0x00432cc0）：
 * ```asm
 * 00432cc0  movsx edx, word [ecx*4 + 0x4756e4]   ; x（ecx = 扇区 1..12 ⇒ 0x4756e8 起）
 * 00432ccf  movsx eax, word [ecx*4 + 0x4756e6]   ; y
 * 00432cec  push eax / push edx / … / call 0x456418
 * ```
 * 12 项逐个 dump：`(322,91) (414,82) (453,157) (509,242) (458,314) (415,387)`
 * `(322,394) (239,393) (188,316) (131,222) (184,161) (225,83)`。
 *
 * 三条独立校验都落在这一张表上：
 * ① 与 `Panel.mkf #19` 命中掩膜里那十二块的重心逐个吻合（误差 ≤ 6px）；
 * ② 与底图 `#18` 图 0 里那十二个图标的位置吻合（半径 152..190、中线 90°/60°/…）；
 * ③ 掩膜在每一个中线上读出来正好是 `扇区号`（`mask[y*640+x]` = 1..12）。
 *
 * ⚠️ **不是** `MAGIC_HOUSE_OPTIONS[].x/y` —— 那十二个点是**悬停弹窗/功能名**的位置
 *   （见 `magicPopupAt`）。先前把两者混为一谈，十二个图标散满全屏（「排版混乱」）。
 */
export const MAGIC_RING_AT: readonly { x: number; y: number }[] = [
  { x: 322, y: 91 },
  { x: 414, y: 82 },
  { x: 453, y: 157 },
  { x: 509, y: 242 },
  { x: 458, y: 314 },
  { x: 415, y: 387 },
  { x: 322, y: 394 },
  { x: 239, y: 393 },
  { x: 188, y: 316 },
  { x: 131, y: 222 },
  { x: 184, y: 161 },
  { x: 225, y: 83 },
];

/** 第 `option` 个功能的**图标中心** @source 表 `0x4756e8`（见 `MAGIC_RING_AT`）*/
export function magicRingAt(option: number): { x: number; y: number } {
  return MAGIC_RING_AT[option] ?? { x: 0, y: 0 };
}

/**
 * **铺场/常态那张女巫**（图 1，165×213）的落点 = **(241,140)**。
 *
 * @source 0x00432543 与 0x00432791 两处都是同一对常量：
 * ```asm
 * 00432543  push 0x8c          ; 先压的那个 = 第 4 个实参 = **y**
 * 00432548  push 0xf1          ; 后压的 = 第 3 个实参 = **x**
 * 00432552  add  eax, 0x18     ; 源 = 图 1
 * 0043255d  call 0x456418      ; ∵ fcn_00456418(dst, src, x=[0x10], y=[0x14])
 * ```
 * ⚠️ 先前记成 `{x:0x8c, y:0xf1}` = (140,241) —— **x/y 写反了**（那正是女巫在屏上
 *   偏到左下、与另一只并排的原因之一）。
 */
export const MAGIC_WITCH_BALL_AT = { x: 0xf1, y: 0x8c } as const;
/** 旧名（同值）：铺场那张女巫 */
export const MAGIC_WITCH_INTRO_AT = MAGIC_WITCH_BALL_AT;

/**
 * **点下去之后**那张女巫（图 2，284×210）的落点 = **(182,142)**。
 *
 * @source `loc_00432e8e`（WM_LBUTTONDOWN 那一支）内的 0x00432f3e：
 * ```asm
 * 00432f3e  mov  edx, 0xb6 / [esp+0x40] = edx   ; x
 * 00432f47  mov  ecx, 0x8e / [esp+0x44] = ecx   ; y
 * 00432f60  push ecx / push edx                 ; y, x
 * 00432f67  add  eax, 0x24                      ; 源 = 图 2
 * 00432f72  call 0x456418
 * ```
 * 它的 (182,142)+(284×210) **整块盖住**图 1 的 (241,140)+(165×213) ⇒ 两张不同时可见。
 */
export const MAGIC_WITCH_HAND_AT = { x: 0xb6, y: 0x8e } as const;
/** 旧名（同值）：第二拍那张女巫 */
export const MAGIC_WITCH_BEAT2_AT = MAGIC_WITCH_HAND_AT;

/**
 * ★★ **悬停弹窗（锦缎框 + 功能名）的落点** —— 记录表 `0x475718 + 16i` 的 `+4/+8`。
 *
 * @source 0x00432db3 那一段（1 基下标 k = 功能号 + 1）：
 * ```asm
 * 00432db3  shl  eax, 4                  ; eax = 16k
 * 00432db6  edi = [eax + 0x475710]       ; ★ y = 记录 (k−1) 的 +8
 * 00432dbd  ebp = [eax + 0x47570c]       ; ★ x = 记录 (k−1) 的 +4
 * 00432dc4  edx = [eax + 0x475708]       ; ★ 图号 = 记录的 +0（9/10/7/6，142×120 的框）
 * 00432de6  call 0x456418                ; 框贴到 (x,y)
 * 00432e12  edx = [eax + 0x475710] / ecx = [eax + 0x47570c]
 * 00432e20  esi = [eax + 0x475714]       ; 名称
 * 00432e29  call 0x44fabc                ; ★ 功能名写在**同一点**
 * ```
 * ⇒ 就是 `MAGIC_HOUSE_OPTIONS[option]` 的 x/y（`packages/data/src/magic-house.ts`
 *   已按第 101 条整表订正）。
 *
 * ★★ 2026-09-16 订正（外部审查 B-2 症状①）：先前 `MAGIC_FRAME_AT` 是个常数
 *   (0x8c,0xf1) —— 那是**女巫**的位置，不是字框的位置，于是结果字画在五芒星中心
 *   而框在 (140,241) 附近，**字整个落在框外约 107 px**。框与字必须**同点**。
 */
export function magicPopupAt(option: number): { x: number; y: number } {
  const o = MAGIC_HOUSE_OPTIONS[option];
  return o === undefined ? { x: MAGIC_CENTER.x, y: MAGIC_CENTER.y } : { x: o.x, y: o.y };
}

/** 悬停弹窗的锦缎框落点 —— 与功能名同点（见 `magicPopupAt`）*/
export function magicFrameAt(option: number): { x: number; y: number } {
  return magicPopupAt(option);
}

/**
 * 指针/结果那一拍要贴的**锦缎框图号** —— **按功能而异**。
 *
 * @source 0x00432dc4：`edx = [16 * (功能号 + 1) + 0x475708]` 被直接当 MKF 记录下标用
 *   ⇒ 十二个功能的图号 = `MAGIC_HOUSE_OPTIONS[].img`（9/10/7/6）。
 *   ★ 第 101 条订正：先前一律画 `MAGIC_CHUNK.frame`（图 6），
 *   于是功能 0..6 的框都贴错了（其中 0/1 该贴 9/10、2..6 该贴 7）。
 */
export function magicFrameChunk(option: number): number {
  return MAGIC_HOUSE_OPTIONS[option]?.img ?? MAGIC_CHUNK.frame;
}

/**
 * 女巫「原本那张嘴」在图 1 里的矩形 —— 摆嘴型那一支 `rand()` 为奇数时拿它贴回
 * (0x11e,0xd9)（= 图 1 落 (0xf1,0x8c) 时这块本来的位置）。
 *
 * @source 0x00432ab5..0x00432acb：`push 0x15 / push 0x3c / push 0x4d / push 0x2d / y / x /
 *   [0x48c398]+0x18（图 1）/ 表面 → call fcn_0045643d`（矩形拷贝，不透明）。
 *
 * ★★ 2026-09-23 订正：先前本屏把这一段写成「每**帧**以 1/8 的概率叠一张图 5」——
 *   ① 原版是**定时器那一拍**（100 ms）才摆一次、摆了要停 `rand()&7`（1..7）拍；
 *   ② 两种嘴型（图 5 张嘴 / 图 1 原嘴）各半，停满那一拍贴**图 4（合嘴）**，
 *      之后一直留着，直到图 1 整张重贴（状态 5）；
 *   ③ 字框收起后嘴型照样停满才合上（`[0x48c3a0]` 非 0 也会进这一段）。
 *   见 `magicMouthTick`。
 */
export const MAGIC_MOUTH_REST_SRC = { x: 0x2d, y: 0x4d, w: 0x3c, h: 0x15 } as const;

/** 摆嘴型的门槛：`rand() >> 11` **小于 4** 才换（= 1/4 的拍子）@source 0x00432a8c `cmp eax, 4 / jge` */
export const MAGIC_MOUTH_GATE = 4;

/**
 * **闭眼**贴片（图 3，60×35）的落点 = **(286,188)**。
 *
 * @source 0x00432951（状态 3→4）：Lock 一个 60×35 的矩形
 *   `{0x11e, 0xbc, 0x15a, 0xdf}` 后把 `[0x48c398]+0x30`（= **图 3**）不透明贴上去。
 *   ★ 第 97 条曾记作「源 = 图 7」并把落点当 x/y 反了 —— `+0x30` 按 `+0xc + 12i` 是
 *   **图 3**，与 60×35 的尺寸、以及 `Panel/0018_003.png`（闭着的眼睛）三方吻合。
 */
export const MAGIC_EYES_AT = { x: 0x11e, y: 0xbc } as const;

/**
 * **合着的嘴**贴片（图 4，60×18）的落点 = **(286,220)**。
 *
 * @source 0x004328b2（状态 4 的眨眼拍）：Lock 矩形 `{0x11e, 0xdc, 0x15a, 0xee}`、
 *   源 = `[0x48c398]+0x3c`（= **图 4**），0x00432902 不透明 blit。
 *   ⚠️ 先前 `MAGIC_RESULT_AT` 把这一笔记成「280×173 的长条结果框落 (286,220)」，
 *   于是第二拍在女巫身上压了一张**原版根本没有的**大框（60×18 的矩形被当成图 8）。
 */
export const MAGIC_EYELID_AT = { x: 0x11e, y: 0xdc } as const;

/**
 * **张开的嘴**贴片（图 5，60×21）的落点 = **(286,217)**。
 * @source 0x00432b00（`push [esp+0x44]` = 0xd9 → y、`push [esp+0x44]` = 0x11e → x，
 *   源 `[0x48c398]+0x48` = 图 5）。
 */
export const MAGIC_MOUTH_AT = { x: 0x11e, y: 0xd9 } as const;

/**
 * **抽中的条件图标**的落点 @source `loc_00432719` 尾：`push 0x128 / push 0x146`
 *   ⇒ (0x146, 0x128) = **(326,296)**；图号 = `[0x48c3a3] + 0xb` = **条件号 + 11**。
 *   ⚠️ 图号取的是**条件号**（`[0x48c3a3]`，0x004327aa），不是效果号 —— 先前按
 *   `option + 11` 画，于是图 11..22 里显示的是「另一个条件」的图标。
 */
export const MAGIC_RESULT_ICON_AT = { x: 0x146, y: 0x128 } as const;

/** 第 `criterion` 个条件的图标号 @source `lea edx, [eax + 0xb]`（VA 0x004327aa）*/
export function magicTargetIconChunk(criterion: number): number {
  return MAGIC_TARGET_ICON_BASE + criterion;
}

// ============================================================
//  命中几何（从 Panel.mkf #19 的掩膜量出来，见文件头）
// ============================================================

/**
 * 十二个扇区的圆心。
 *
 * @source 由 #19 的楔形分界线两两相交求得：相邻两条边的交点集中在
 *   (321..322, 237..240)，取 **(320, 238)**。
 *   ★ 表里那十二个中线坐标是按 **(320, 240)** 摆的（相邻两项的中点恰是 (320,240)），
 *   与掩膜的圆心差 2px —— 原版自己也差这 2px，本模块两边各按各的来。
 */
export const MAGIC_CENTER = { x: 320, y: 238 } as const;

/**
 * 一个扇区中线两侧各占多少度 @source #19：十二条楔形的边界落在
 *   `90±15 / 60±15 / …`（即以 90° 起、每 30° 一条的中线）。
 */
export const MAGIC_SECTOR_HALF_DEG = 15;

/**
 * **第一条中线的方位**（度，屏幕坐标：0° = 正右、逆时针为正）@source 量自 #19：
 *   扇区 1 的楔形跨 61.2°..118.4°（中线 90°，正上方），扇区 2 是 30.3°..89.7°（60°）……
 *   ⇒ 十二条中线 = `90° − 30°×(扇区−1)`，即**顺时针**排。
 *   与 `MAGIC_RING_AT` 那十二个中线的方位逐个吻合（误差 ≤ 5°）。
 *
 * ⚠️ 先前写成 `(angle + 15)/30 + 1`（扇区 1 在 **0°**）—— 整整错了 90°，
 *   于是「指着一个格子、反应在另一个格子上」（掩膜一致率只有 31%）。
 */
export const MAGIC_SECTOR1_DEG = 90;

/**
 * 扇区的**外半径** —— 命中区最远到这里 @source 量自 #19（最长的一条到 r = 241）。
 *
 * ⚠️ #19 是**手绘掩膜**，十二条楔形外缘长短不一（216..241，那是原版按五芒星
 *   外框描出来的），这里用一个外半径近似，见 deviations。
 */
export const MAGIC_OUTER_RADIUS = 241;

/**
 * 中间那块（命中值 13）的半径 @source 量自 #19：那块的实际半径到 136，
 *   而楔形最近只到 r ≈ 116 —— 两者在手绘掩膜里是**犬牙交错**的。
 *   取两档之间最优的 **126**（对 156007 个掩膜像素的逐点一致率最高：78.7%；
 *   118 是 78.5%、136 是 77.9%）。剩下的分歧全在**手绘边界**上（±1 格），
 *   而十二个中线（玩家真正点的地方）在三档下都 100% 命中自己的格。
 */
export const MAGIC_INNER_RADIUS = 126;

/** 中间那块的命中值 @source #19 里 1..12 是功能、13 是对话框区 */
export const MAGIC_HIT_CENTER = 13;

/** 第 `option` 个功能的高亮图标号 @source `lea edx, [扇区 + 0x16]`（VA 0x00432cee）*/
export function magicIconChunk(option: number): number {
  return MAGIC_CHUNK.ringFirst + option;
}

/**
 * 第 `option` 个功能的图标画在哪 —— **表 `0x4756e8`**（见 `MAGIC_RING_AT`）。
 *
 * @source 0x00432cc0 / 0x00432ccf（`movsx …, word [ecx*4 + 0x4756e4/6]`，ecx = 扇区）。
 *   ⚠️ 不是记录表的 x/y（那是悬停弹窗的位置，见 `magicPopupAt`）。
 */
export function magicIconAt(option: number): { x: number; y: number } {
  return magicRingAt(option);
}

/**
 * 十二个功能图标相对圆心的角度（**屏幕坐标系**：y 向下，atan2 用 −dy）。
 *
 * @source 表 `0x4756e8` 的十二个中线：`90° − 30°×(功能号)`，与掩膜一致。
 */
export function magicIconAngle(option: number): number {
  const at = magicIconAt(option);
  const deg = (Math.atan2(-(at.y - MAGIC_CENTER.y), at.x - MAGIC_CENTER.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// ============================================================
//  角度 → 扇区（纯函数，单测钉住）
// ============================================================

/**
 * 舞台坐标落在哪个扇区。
 *
 * @returns 1..12 = 第 `n−1` 个功能；`MAGIC_HIT_CENTER`(=13) = 中间那块；
 *   `0` = 都不认。
 *
 * 判据照 #19 的掩膜：先看半径（> `MAGIC_OUTER_RADIUS` 或 < `MAGIC_INNER_RADIUS` 分开），
 * 再按**以 90° 为第一条中线、每 30° 一条（顺时针）**落到十二个楔形里。
 */
export function sectorAt(x: number, y: number): number {
  const dx = x - MAGIC_CENTER.x;
  const dy = MAGIC_CENTER.y - y; // 屏幕 y 向下
  const r = Math.hypot(dx, dy);
  if (r > MAGIC_OUTER_RADIUS) return 0;
  if (r < MAGIC_INNER_RADIUS) return MAGIC_HIT_CENTER;
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  // 扇区 1 的中线在 90°，往后每 30° 一格（顺时针 ⇒ 角度递减）
  const rel = ((MAGIC_SECTOR1_DEG - angle + MAGIC_SECTOR_HALF_DEG) % 360 + 360) % 360;
  return Math.floor(rel / 30) + 1;
}

/** 这个点认不认（原版：命中值为 0 就什么都不做）@source 0x00432b8b */
export function hitsMagicSector(x: number, y: number): boolean {
  return sectorAt(x, y) !== 0;
}

/** 扇区 → 功能号（`扇区号 = 功能号 + 1`）；不是功能扇区返回 `null` */
export function optionOfSector(sector: number): number | null {
  if (sector < 1 || sector > 12) return null;
  return sector - 1;
}

/**
 * 第 `option` 个功能的**高亮图标**在 `(x,y)` 上认不认（`move`/`down` 共用一条判据）。
 *
 * ★ 原版命中是**逐像素查 `Panel.mkf #19`**（VA 0x00432b50 的 `[x + 640y]`），
 *   本引擎拿不到那张 640×480 的一字节掩膜，故用 `sectorAt` 的楔形近似 ——
 *   见 `MAGIC_INNER_RADIUS` 上记的一致率与 deviations。
 */
export function hitMagicOption(x: number, y: number): number | null {
  return optionOfSector(sectorAt(x, y));
}

// ============================================================
//  一圈的图标（没有帧序）
// ============================================================

/**
 * ★★ **没有「两帧序」这回事** —— 这一节整块作废（2026-09 再核）。
 *
 * 原版悬停只贴**一张**图：`lea edx, [扇区 + 0x16]`（0x00432cee）→ 图 23..34。
 * 先前那个 `MAGIC_ICON_STRIDE = 2` / `magicIconFrame` / `magicIconFrameCount`
 * 是**发明出来的**：把同一条 `+0x16` 又画一次 `+1` 当「悬停变体」，
 * 于是第 0 个功能（图 22）被当成「两张图」、其余按 22+k 摆 ——
 * 既错位一格（第 0 个功能该是 23），又把 12 张图摊成两帧循环。
 * 现在只剩 `magicIconChunk(option) = 23 + option`，见 `MAGIC_ICON_SLOT_BASE`。
 */

// ============================================================
//  窗口状态机（纯函数）—— 照 `[0x48c3a2]` 1..8 一拍一拍走
// ============================================================

/**
 * 入口台詞那三句 —— **文字框**先由 `fcn_0044ec30` 设好，再由 `fcn_0044ecb6` 逐句挂上。
 *
 * @source 字框（VA **0x00432596** 那一句 `call 0x44ec30`，整段 0x00432575–0x0043259e）：
 * ```asm
 * push 0x202020 / 0xe0e0e0 / 0 / 0 / 0x180 / 0x140
 * mov eax, [0x48c398] / add eax, 0x6c    ; (0x6c−0xc)/12 = 图 **8**
 * call 0x44ec30
 * ```
 * ⇒ 框 = **图 8（280×173，就是 `MAGIC_CHUNK.resultBar`）落 (320,384)**、文字在盒心 +(0,0)、
 *   字色 `0xe0e0e0`、描边 `0x202020`（第 7 参非 0 ⇒ 描边 **3** px）。
 *
 * @source 串（`fcn_0044ecb6` 的参数，串表指针逐个 dump）：
 *   `0x475694` / `0x475698` / `0x47569c`；`0x4756a0`（`#0040嘿～輪到你了！`）与
 *   `0x4756a4`（`#0041天靈靈地靈靈～`）是后面几拍用的。
 */
export const MAGIC_GREET_LINES: readonly string[] = [
  '#0037進來魔法屋，就得\n完全照我的指示！',
  '#0038我選出符合條件的人。',
  '#0039你來決定他們的命運～',
];

/**
 * 字框里一句话**至少**挂多久。
 *
 * @source `fcn_0044ee18`（VA 0x0044ee18）：`call timeGetTime` 减去
 *   `[0x4762c4]`（`fcn_0044ecb6` 记下的「挂上那一刻」，0x0044ee0e）之后
 *   `cmp eax, 0x7d0 / jb` —— 到 **2000 ms** 才算到期；到期那一下把框底下存的那块
 *   **贴回去**（0x0044eeb4 `call 0x4563f5`）= 字框收起。
 *
 * ★★ 2026-09-23 订正：这只是**下限**。满 2000 ms 之后还有一道「音效开着就等语音播完」：
 * ```asm
 * 0044ee63  cmp  byte [0x49715b], 0 / je 0x44ee76   ; 音效档（RICH4.CFG+3）关着 → 到期
 * 0044ee6c  call 0x4544b9                           ; 语音缓冲还在 PLAYING → 返回 1
 * 0044ee71  mov  [0x4762c4], eax / … / jne 0x44ef34 ; ⇒ 还挂着（下一拍再问）
 * ```
 *   ⇒ 一句话挂 **max(2000 ms, 语音时长)**。先前一律按 2000 ms 收，长句（如 `#0037`）
 *   语音还没念完字框就换下一句、下一句的语音把它截断。现在按 `voice-sink.ts` 的
 *   `voiceBusy()` 每拍问一次（见 `magicLineExpired`）。
 */
export const MAGIC_GREET_MS = 0x7d0;
/** 同一个数，按它真正的含义起的名：字框一句话的寿命 */
export const MAGIC_LINE_MS = MAGIC_GREET_MS;

/**
 * 魔法屋那条定时器：**100 ms** 一拍。
 *
 * @source `loc_00432647`（`0x401` 铺场尾）：`SetTimer(hwnd, [0x46cad8], 0x64, 0)`；
 *   状态机 `loc_004326e5`（`0x113` 分支）每次只认这个定时器的 `wParam`。
 */
export const MAGIC_TIMER_MS = 0x64;

/**
 * 条件抽签要**摇几拍**再开奖。
 *
 * @source `loc_00432951`（状态 3 → 4）：
 * ```asm
 * cmp byte [0x48c3a5], 0     ; [0x48c3a5] = **!動畫過程**（跳过开场白也会置 1）
 * je  short loc_004329e3
 * mov byte [0x48c3a1], 1     ; ★ 关掉：只摇 1 拍
 * loc_004329e3:
 * mov byte [0x48c3a1], 0xa   ; ★ 开着：**10 拍**（1 秒）
 * ```
 * 之后每个 `0x113` 把 `[0x48c3a1]` 递减（`loc_004326e5`），减到 0 才
 * `loc_00432719` 亮出条件（条件号本身由 core 在落点那一刻抽好，见 `pending.criterion`）。
 */
export const MAGIC_ROLL_TICKS = 0xa;
/** 动画关掉（或跳过了开场白）时只摇 **1** 拍 @source 同上 `mov byte [0x48c3a1], 1` */
export const MAGIC_ROLL_TICKS_FAST = 1;

/**
 * 「輪到你了」那一句 —— 状态 5 → 6 写进字框。
 * @source `loc_004329ef`：`cmp byte [0x48c3a5], 0 / jne loc_00432944` ⇒ **动画关掉不写**；
 *   开着则 `push [0x4756a0]` → `fcn_0044ecb6`（串 `#0040嘿～輪到你了！`）。
 */
export const MAGIC_TURN_LINE = '#0040嘿～輪到你了！';

/**
 * 「天靈靈地靈靈～」那一句 —— 点下去那一拍（状态 7 → 8）。
 * @source `loc_00432e8e` 尾：`0x00432fdc mov byte [0x48c3a2], 8` → `push [0x4756a4]` →
 *   `0x00432fea call 0x44ecb6`。
 */
export const MAGIC_SPELL_LINE = '#0041天靈靈地靈靈～';

/**
 * 十二个**条件名**（带语音号）—— 状态 5 写进字框的那一句。
 *
 * @source 串表 `0x4756b8`（12 个指针，逐个 dump）：`0x4646cc '#0046財產最多的人'` …
 *   `0x464786 '#0057所有女生'`；`loc_00432719` 尾 `mov edx,[eax*4 + 0x4756b8] / call 0x44ecb6`
 *   —— 原样挂上，**`#NNNN` 前缀照样触发女巫语音**。先前本屏用的是 core 那份去掉前缀的
 *   `MAGIC_TARGET_NAMES`，条件名那一句于是一声不响。
 */
export const MAGIC_CRITERION_LINES: readonly string[] = MAGIC_TARGET_NAMES.map(
  (name, i) => `#${String(46 + i).padStart(4, '0')}${name}`,
);

/** 第 `criterion` 个条件那一句（越界给空串）*/
export function magicCriterionLine(criterion: number): string {
  return MAGIC_CRITERION_LINES[criterion] ?? '';
}

/**
 * 字框里的字号 —— `fcn_0044ecb6` 里 `0x0044ed71 push 0x14 / call 0x44f9d8` = **20**。
 */
export const MAGIC_MSG_FONT_SIZE = 0x14;
/** 字框里的行距 —— 与 `drawLoanBubble` 同口径（字号 + 6）*/
export const MAGIC_MSG_LINE_H = MAGIC_MSG_FONT_SIZE + 6;

/** 字框参数（见 `MAGIC_GREET_LINES` 的注释）*/
export const MAGIC_MSG_BOX = {
  chunk: 8,
  x: 0x140,
  y: 0x180,
  dx: 0,
  dy: 0,
  fill: '#e0e0e0',
  outline: '#202020',
  outlineWidth: 3,
} as const;

/** 转盘数（十二个功能）*/
export const MAGIC_SECTOR_COUNT = 12;

/**
 * 女巫脸上贴过的**贴片**（按贴上去的先后）—— 原版贴在离屏面上、一直留着，
 * 直到图 1 整张重贴（`loc_00432719` @0x00432791，状态 4 → 5）才一起抹掉。
 *
 * | 贴片 | 图 / 矩形 | 落点 | @source |
 * |---|---|---|---|
 * | `eyes` | 图 3（60×35，闭眼）| (0x11e,0xbc) | `loc_00432951`（状态 3 → 4）|
 * | `mouthOpen` | 图 5（60×21，张嘴）| (0x11e,0xd9) | 0x00432b00 起（`rand()` 偶数那一支）|
 * | `mouthRest` | **图 1 自己**的 (0x2d,0x4d) 起 60×21（= 图 1 原本那张嘴）| (0x11e,0xd9) | 0x00432acb `fcn_0045643d`（`rand()` 奇数那一支）|
 * | `mouthShut` | 图 4（60×18，合嘴）| (0x11e,0xdc) | 0x004328f2（嘴型停满、`[0x48c3a0]` 减到 0 那一拍）|
 *
 * 全部走不透明那一支（`fcn_004563f5` / `fcn_0045643d`）。
 */
export type MagicFacePatch = 'eyes' | 'mouthOpen' | 'mouthRest' | 'mouthShut';

/**
 * 女巫窗口此刻的状态 —— 字段与原版全局一一对应：
 *
 * | 字段 | 原版 | 含义 |
 * |---|---|---|
 * | `state` | `[0x48c3a2]` | 1/2/3 开场白 · 4 摇签 · 5 条件名 · 6 輪到你了 · 7 等玩家点 · 8 点完 |
 * | `line` / `lineAt` | `[0x4762c0]` / `[0x4762c4]` | 字框里挂着的那一句与挂上的时刻；`null` = 框已收起 |
 * | `quick` | `[0x48c3a5]` | `!動畫過程`；跳过开场白时也置 1（0x00432e71）|
 * | `rollLeft` | `[0x48c3a1]` | 状态 4 的摇签倒数 |
 * | `tickAt` | 定时器 | 上一次 `0x113` 的时刻（100 ms 一拍）|
 * | `criterion` | `[0x48c3a3]` | 目标转盘（core 已抽好，状态 5 才亮出来）|
 * | `chosen` | `[0x48c3a1] − 1` | 点定的效果号；没点之前 −1 |
 * | `mouthHold` | `[0x48c3a0]` | 当前嘴型还要停几拍（0 = 没在摆嘴型）|
 * | `face` | 离屏面 | 图 1 上叠着的贴片（见 `MagicFacePatch`）|
 * | `closing` | `KillTimer` | 状态 8 那一句到期、进了关窗那一段（`loc_00432a4c`）：定时器已停，只剩影片 |
 */
export interface MagicWindow {
  state: number;
  line: string | null;
  lineAt: number;
  quick: boolean;
  rollLeft: number;
  tickAt: number;
  criterion: number;
  chosen: number;
  mouthHold: number;
  face: readonly MagicFacePatch[];
  closing: boolean;
}

/**
 * 定时器那一拍要问外面的两件事 —— 都不在窗口状态里：
 *
 * - `voiceBusy`：语音还在响吗（`fcn_0044ee18` → `0x4544b9`，见 `magicLineExpired`）；
 * - `rand`：原版 `_libc_rand`（0..0x7fff）。只用于女巫**摆嘴型**那几拍（`loc_00432a85`）——
 *   纯表现；原版这几次 `rand()` 会推进全局随机流，本引擎做不到逐位对齐（D-MAGIC-13 同一条）。
 */
export interface MagicTickIo {
  voiceBusy?: boolean;
  rand?: () => number;
}

/** 缺省的 `rand()`：0..0x7fff（与 Watcom `rand` 同值域）*/
function defaultRand(): number {
  return Math.floor(Math.random() * 0x8000);
}

/**
 * 开窗：`0x401`（铺场 + 起定时器）紧接着 `0x405`（第一句）。
 *
 * @source `loc_00432647`：`[0x48c3a0..0x48c3a4]` 全部清 0、`[0x48c3a5] = cfg+1 ^ 1`（= `!動畫過程`）、
 *   铺场（`fcn_00432511`：图 0 + 图 1）、`PostMessage(0x405)`；`loc_004326b9`：
 *   `cmp byte [0x48c3a5], 0 / jne loc_00432e82` —— 动画关掉**直接进状态 3**（三句一句不说），
 *   否则状态 1 + `#0037`。
 */
export function magicWindowOpen(criterion: number, now: number, animation = true): MagicWindow {
  const quick = !animation;
  return {
    state: quick ? 3 : 1,
    line: quick ? null : (MAGIC_GREET_LINES[0] ?? null),
    lineAt: now,
    quick,
    rollLeft: 0,
    tickAt: now,
    criterion,
    chosen: -1,
    mouthHold: 0,
    face: [],
    closing: false,
  };
}

/**
 * 字框那一句在 `t` 时到期没有 —— `fcn_0044ee18`：
 * **满 2000 ms**（`cmp eax, 0x7d0 / jb`）**且**语音已经念完（`0x0044ee6c call 0x4544b9`，
 * 音效档关掉时不问 —— 那道闸在 `voiceBusy` 的注册方里）。
 */
export function magicLineExpired(w: MagicWindow, t: number, voiceBusy = false): boolean {
  return w.line !== null && t - w.lineAt >= MAGIC_LINE_MS && !voiceBusy;
}

/** 贴一张脸上的贴片：新贴的嘴型把**整块盖住**的旧嘴型去掉（闭眼那张留着，它只被盖住下面几行）*/
function pushFace(face: readonly MagicFacePatch[], p: MagicFacePatch): MagicFacePatch[] {
  if (p === 'eyes') return [...face.filter((f) => f !== 'eyes'), p];
  // 张嘴 / 原嘴 = (0x11e,0xd9) 起 60×21，盖住图 4 那块 (0x11e,0xdc) 起 60×18 与自己
  const covered = p === 'mouthShut' ? ['mouthShut'] : ['mouthOpen', 'mouthRest', 'mouthShut'];
  return [...face.filter((f) => !covered.includes(f)), p];
}

/**
 * 女巫**摆嘴型**的那一段（每拍都跑，状态 8 除外）。
 *
 * @source `loc_00432871` → `loc_00432894` → `loc_00432a85`：
 * ```asm
 * 00432871  cmp  [0x48c3a2], 8 / je 返回             ; 点完那一拍起不再动嘴
 *           call fcn_0044ef3b / test eax,eax / jne   ; 字框还挂着（= 在说话）…
 *           cmp  [0x48c3a0], 0 / je 返回              ; …或上一个嘴型还没停满
 * 00432894  mov  ah, [0x48c3a0] / test ah,ah / je loc_00432a85
 *           dec  [0x48c3a0] / jne 返回                ; 嘴型停满那一拍：
 *           贴图 4（合嘴）到 (0x11e,0xdc)              ; 0x004328f2
 * 00432a85  rand() >> 11 / cmp eax, 4 / jge 返回     ; ★ 1/4 的拍子才换嘴型
 *           rand() & 1 ? 图 1 的 (0x2d,0x4d) 60×21     ; 0x00432acb：原本那张嘴
 *                      : 图 5（张嘴）                  ; 0x00432b00
 *           → (0x11e,0xd9)
 *           [0x48c3a0] = rand() & 7 || 1              ; 0x00432b36：停 1..7 拍
 * ```
 */
function magicMouthTick(w: MagicWindow, rand: () => number): MagicWindow {
  if (w.state === 8 || w.closing) return w;
  const talking = w.line !== null;
  if (!talking && w.mouthHold === 0) return w;
  if (w.mouthHold !== 0) {
    const hold = w.mouthHold - 1;
    return hold === 0 ? { ...w, mouthHold: 0, face: pushFace(w.face, 'mouthShut') } : { ...w, mouthHold: hold };
  }
  if (rand() >> 11 >= MAGIC_MOUTH_GATE) return w;
  const patch: MagicFacePatch = (rand() & 1) !== 0 ? 'mouthRest' : 'mouthOpen';
  const hold = rand() & 7;
  return { ...w, face: pushFace(w.face, patch), mouthHold: hold === 0 ? 1 : hold };
}

/**
 * 定时器走**一拍**（一个 `0x113`）。
 *
 * @source `loc_004326e5`：
 * ```asm
 * cmp [0x48c3a2], 4 / jne loc_00432828
 * dec [0x48c3a1] / jne loc_00432828          ; 状态 4：摇签倒数
 * loc_00432719: …亮出条件（图 1 整张重贴）… [0x48c3a2] = 5 / fcn_0044ecb6(条件名)
 * loc_00432828: call fcn_0044ee18            ; ★ 字框还挂着（没到期）→ 返回 0 → 跳过下面的推进
 *               jmp [state−1 → 0x4325a2]     ; 到期（框收起）或本来就没框 → 按状态推进：
 *   1 → 2 + `#0038`      2 → 3 + `#0039`      3 → 4（闭眼、摇签 10/1 拍）
 *   4 → —               5 → 6 + `#0040`（动画关掉不写）
 *   6 → 7（`fcn_00402460(1)` 放开鼠标，补发一个 `WM_MOUSEMOVE`）
 *   7 → —               8 → `loc_00432a4c`：KillTimer → Panel #20 影片 → `Post_0402([0x48c3a1] − 1)`
 * loc_00432871: 摆嘴型（见 `magicMouthTick`）
 * ```
 * ★ 状态 8 到期后返回 `closing: true` 的窗口 —— 定时器停了，之后只剩关窗影片（屏幕本体那边播）。
 */
export function magicWindowTimer(w: MagicWindow, t: number, io: MagicTickIo = {}): MagicWindow {
  if (w.closing) return w; // KillTimer 之后不再有 0x113
  const rand = io.rand ?? defaultRand;
  let next: MagicWindow = { ...w, tickAt: t };
  if (next.state === 4) {
    next.rollLeft -= 1;
    if (next.rollLeft <= 0) {
      // loc_00432719 → 状态 5：图 1 整张重贴（贴片全没了）、条件名挂上字框
      //   （刚挂上 ⇒ 下面那次 ee18 必定「没到期」⇒ 直接落到摆嘴型那一段）
      next = { ...next, state: 5, rollLeft: 0, line: magicCriterionLine(next.criterion), lineAt: t, face: [] };
      return magicMouthTick(next, rand);
    }
  }
  // fcn_0044ee18：还挂着就等；到期就收起（贴回框底下那块）
  if (next.line !== null) {
    if (!magicLineExpired(next, t, io.voiceBusy === true)) return magicMouthTick(next, rand);
    next = { ...next, line: null };
  }
  switch (next.state) {
    case 1:
      next = { ...next, state: 2, line: MAGIC_GREET_LINES[1] ?? null, lineAt: t };
      break;
    case 2:
      next = { ...next, state: 3, line: MAGIC_GREET_LINES[2] ?? null, lineAt: t };
      break;
    case 3:
      next = {
        ...next,
        state: 4,
        rollLeft: next.quick ? MAGIC_ROLL_TICKS_FAST : MAGIC_ROLL_TICKS,
        face: pushFace(next.face, 'eyes'),
      };
      break;
    case 5:
      next = next.quick ? { ...next, state: 6 } : { ...next, state: 6, line: MAGIC_TURN_LINE, lineAt: t };
      break;
    case 6:
      next = { ...next, state: 7 };
      break;
    case 8:
      // loc_00432a4c：KillTimer + 影片（阻塞）+ Post_0402 —— 之后 `jmp 0x43286e` 落到 `cmp state,8 / je 返回`
      return { ...next, closing: true };
    default:
      break;
  }
  return magicMouthTick(next, rand);
}

/**
 * 把 `now` 之前该走的定时器拍子都走完。
 *
 * ⚠️ `io.voiceBusy` 是「此刻」的答案：补拍时每一拍都按它算（补拍只在标签页被挂起回来时才有）。
 */
export function magicWindowAdvance(w: MagicWindow, now: number, io: MagicTickIo = {}): MagicWindow {
  let cur = w;
  // 一次最多补 600 拍（1 分钟）—— 标签页被挂起回来时不至于空转
  for (let i = 0; i < 600 && !cur.closing && now - cur.tickAt >= MAGIC_TIMER_MS; i++) {
    cur = magicWindowTimer(cur, cur.tickAt + MAGIC_TIMER_MS, io);
  }
  return cur;
}

/**
 * 开场白那几拍（状态 < 3）点一下 / 右键 = **跳过**。
 *
 * @source `loc_00432e71`（左键 `0x201/0x203` 的 `cmp cl, 3 / jb` 与右键 `0x205` 的 `loc_00432e64` 共用）：
 *   `mov byte [0x48c3a5], 1`（★ 之后按「动画关掉」走：摇签只 1 拍、不说「輪到你了」）
 *   → `fcn_0044ee18(1)`（**停掉语音**（0x0044ee30 `call 0x454493`）并立刻收起字框）→ `[0x48c3a2] = 3`。
 *   停语音那一下由屏幕本体做（`stopVoice`），这里只管状态。
 */
export function magicWindowSkip(w: MagicWindow): MagicWindow {
  if (w.state >= 3) return w;
  return { ...w, state: 3, quick: true, line: null };
}

/**
 * 状态 7 点中 1..12 格：**选定这个效果**。
 *
 * @source `loc_00432e8e`：还原悬停弹窗那块（0x00432f1a）→ 贴图 2（抬手，0x00432f72）
 *   → 贴条件图标（0x00432fab）→ `fcn_00402460(0)`（收起鼠标）→ `[0x48c3a2] = 8`
 *   → `fcn_0044ecb6([0x4756a4])`（`#0041天靈靈地靈靈～`）。
 */
export function magicWindowPick(w: MagicWindow, option: number, now: number): MagicWindow {
  if (w.state !== 7 || option < 0 || option >= MAGIC_SECTOR_COUNT) return w;
  return { ...w, state: 8, chosen: option, line: MAGIC_SPELL_LINE, lineAt: now };
}

/**
 * 状态 7 点中央那块（13）：**再报一次条件名**，回状态 6（到期后又回到 7）。
 * @source `loc_00432ff7`：`[0x48c3a2] = 6` / `fcn_0044ecb6([0x4756b8 + 条件*4])`。
 */
export function magicWindowAskCriterion(w: MagicWindow, now: number): MagicWindow {
  if (w.state !== 7) return w;
  return { ...w, state: 6, line: magicCriterionLine(w.criterion), lineAt: now };
}

/**
 * **别处答掉了**这一趟（託管替他掷 / 联机时是别家那一端在点）—— 直接进点完那一拍。
 *
 * ⚠️ 原版没有这种情形（窗口是模态的，只有这块屏上的人能点）；这是联机 / 託管的收口：
 *   屏上照样演「抬手 + 天靈靈地靈靈」，到期播关窗影片再关窗、**不再派答复**。
 *   `option = −1`：不知道点了哪一格（例如「抽取命運三張」之后 `lastEvent` 已是命運），不高亮。
 */
export function magicWindowResolve(w: MagicWindow, option: number, now: number): MagicWindow {
  if (w.state === 8) return w;
  return { ...w, state: 8, chosen: option, line: MAGIC_SPELL_LINE, lineAt: now };
}

// ============================================================
//  关窗影片（`loc_00432a4c`）—— D-MAGIC-15 收口
// ============================================================

/**
 * **关窗前那段影片** = `Panel.mkf` **#20**（25 帧 × 71 ms、640×480，源文件 `C:\256_S\256FLC.FLC`）。
 *
 * @source 入口 `0x0043386d push 0x14 / call read_mkf` → `[0x48c390]`；
 *   状态 8 到期那一支 `loc_00432a4c`：
 * ```asm
 * 00432a4c  KillTimer(hwnd, [0x48c39c])
 * 00432a5a  push 0x3b / push 0 / push 0 / push 0 / push [0x48c390]
 * 00432a6b  call fcn_0045144f          ; (影片, x=0, y=0, flags=0, 音效=0x3b)
 * 00432a74  mov al, [0x48c3a1] / dec eax / push eax
 * 00432a7a  call Post_0402_Message     ; ★ 影片播完才关窗、交出效果号
 * ```
 * - 帧数 / 每帧毫秒取资源头（`+0x06 = 0x19`、`+0x10 = 0x47`）；
 * - `flags = 0` ⇒ bit1 没置 ⇒ **点击/按键打断不了**（`fcn_0045144f` 的 `[0x48c880]`，0x004514d6）；
 * - 音效 `0x3b` = 59，第一帧那一刻响（0x004514ad `call 0x45434f`）；
 * - 落 (0,0)、整屏；索引 0 的像素露出下面那一屏（= 状态 8 那一屏）。
 * - **不看**「動畫過程」：这一支里没有 `[0x48c3a5]` 的判断。
 */
export const MAGIC_CLOSE_FILM: BoardFilmSpec = {
  id: 'magic-close',
  archive: 'Panel.mkf',
  resource: 0x14,
  frames: 0x19,
  width: 640,
  height: 480,
  frameMs: 0x47,
  x: 0,
  y: 0,
  sound: 0x3b,
  flags: 0,
};

// ============================================================
//  core 交出来的那一趟 → 画面要的几个名字
// ============================================================

/**
 * `state.lastEvent`（`kind === 'magicHouse'`）→ `MagicView`。
 *
 * @param ev `id` = 效果号（真人点的 / 电脑掷的）、`criterion` = 目标转盘、`targets` = 名单
 * @returns `criterion` 缺失 / 越界时返回 `null`
 */
export function magicViewOfSpin(
  ev: { id: number; criterion?: number; targets?: readonly number[] },
  caster: number,
): MagicView | null {
  const option = ev.id;
  const criterion = ev.criterion;
  if (criterion === undefined || criterion < 0 || criterion >= MAGIC_TARGET_NAMES.length) {
    return null;
  }
  return {
    caster,
    option,
    name: MAGIC_HOUSE_OPTIONS[option]?.name ?? '',
    targets: [...(ev.targets ?? [])],
    criterion,
    criterionName: MAGIC_TARGET_NAMES[criterion] ?? '',
  };
}

/** 这一趟的名字们 */
export interface MagicView {
  /** 触发者（`state.currentPlayer`）*/
  caster: number;
  /** 效果号 0..11；还没点 / 不知道 = −1 */
  option: number;
  /** 功能名（`MAGIC_HOUSE_OPTIONS[option].name`）*/
  name: string;
  /** 被点到的人（玩家下标）*/
  targets: number[];
  /** 目标转盘 0..11 */
  criterion: number;
  /** 目标条件的名字（`MAGIC_TARGET_NAMES[criterion]`，不带语音号）*/
  criterionName: string;
}

// ============================================================
//  绘制
// ============================================================

/** 这一帧要画成什么样 */
export interface MagicDraw {
  /** 窗口状态 `[0x48c3a2]`（1..8）*/
  state: number;
  /** 抽中的条件号（状态 ≥ 5 才画它的图标）*/
  criterion: number;
  /** 点定的效果号（状态 8；−1 = 不知道）*/
  chosen: number;
  /**
   * 图 1 上叠着的贴片（闭眼 / 三种嘴型，按贴上去的先后）—— 见 `MagicFacePatch`。
   * 缺省 = 没有贴片（图 1 原样）。
   */
  face?: readonly MagicFacePatch[];
  /** 鼠标正指着的扇区（原版 `[0x48c3a1]`，只在状态 7 更新），0 = 不在任何扇区上 */
  hover: number;
  /**
   * 字框里这一句 —— `null` = **框已收起**（不画框）。
   *
   * ★ 字框不是整屏一直在：`fcn_0044ee18` 到期就把框底下那块贴回去（0x0044eeb4）。
   *   摇签（状态 4）与等玩家点（状态 7）时它都是 `null` —— 最下面那三格才露得出来。
   */
  boxLine: string | null;
}

/**
 * 悬停那个高亮圈的颜色 —— **只画在「高亮图那一张也拿不到」的兜底上**。
 *
 * ★ 原版不描圈：它把该格换成图 23..34 的**高亮版**（`0x00432d0e`，抠黑 blit）。
 *   只有原图取不到（离线 / HD 缺图）时本模块才描一圈，免得「指到谁」完全看不出来。
 */
export const MAGIC_HOVER = { color: '#ffe080', width: 2, radius: 34 } as const;

/** 弹窗里功能名的字号 @source 0x00432df0 `push 0xe / call 0x44f9d8` */
export const MAGIC_FONT_SIZE = 0x0e;
/** 字色 / 描边 @source 0x00432de9 `push 0xe0e0e0` / `push 0x202020` */
export const MAGIC_TEXT = { fill: '#e0e0e0', stroke: '#202020' } as const;

const MAGIC_FONT = FONT_FAMILY;

/**
 * 弹窗里功能名画在哪 —— 与弹窗框**同点**（记录表的 x/y，`magicPopupAt`）。
 * @source 0x00432e12..0x00432e29（`draw_text(名称, x, y, 2)`，x/y = `[0x47570c/0x475710 + 16k]`）
 */
export function magicTextAt(option: number): { x: number; y: number } {
  return option >= 0 && option < MAGIC_SECTOR_COUNT ? magicPopupAt(option) : MAGIC_CENTER;
}

/**
 * **条件图标**的图号基数 @source `loc_00432719` 尾：`lea edx, [eax + 0xb]`
 *   ⇒ 抽中的第 `criterion` 个条件的图 = 图 `criterion + 11`（11..22）。
 */
export const MAGIC_RESULT_ICON_BASE = 0x0b;

/**
 * 这扇窗唯一的音：状态 7 悬停到 1..12 格。
 *
 * @source 0x00432e40 `push 0 / push 0x4757e7 / call _rich4_play_sound_effect`；
 *   `0x4757e7` 首字节 = **0x27 = 39**（入口 `0x00433828 push 0x4757e7 / call 0x454176` 载入）。
 */
export const MAGIC_SOUND_HOVER = 0x27;

/** 锚点落点绘制 @source `fcn_00456418`（`to_left = x − src->x`）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  drawSprite(ctx, s, x - s.anchorX, y - s.anchorY);
}

/**
 * 哪几张图要**抠掉纯黑**。
 *
 * ★ 原版有两支贴图函数，**逐图挑**，判定只能照调用点抄：
 *
 * | 函数 | 行为 | @source |
 * |---|---|---|
 * | `fcn_004563f5` | **不透明**拷贝 | 0x004563f5 |
 * | `fcn_00456418` | **抠黑**：源像素为 0 就跳过 | 0x00456418 |
 *
 * | 图 | 原版走哪支 | 抠黑 | 出处 |
 * |---|---|---|---|
 * | 0 底图 | `fcn_004563f5` | ✗ | 0x0043253b |
 * | 1 女巫（水晶球） | `fcn_00456418` | ✓ | 0x0043255d / 0x00432791 |
 * | **2 女巫（抬手）** | **`fcn_00456418`** | **✓** | 0x00432f72 |
 * | 3/4/5 脸上的贴片 | `fcn_004563f5`（不透明） | ✗ | 0x004329a7 / 0x00432902 / 0x00432b1a |
 * | 6/7/9/10 锦缎框 | `fcn_00456418` | ✓ | 0x00432de6 |
 * | 8 中央木牌（字框） | `fcn_00456418`（`fcn_0044ecb6` 里 0x0044ed45）| **✓** | ★ 2026-09-23 订正：先前「2% 黑、看不出差别」就沿用不抠 —— 调用点就是抠黑那一支，照抄 |
 * | **11..22 条件图标** | `fcn_00456418` | ✓ | 0x004327c9 |
 * | **23..34 功能高亮图标** | `fcn_00456418` | ✓ | 0x00432d0e |
 */
export const MAGIC_KEYED = new Set<number>([
  MAGIC_CHUNK.witchIntro,
  MAGIC_CHUNK.witchIdle,
  MAGIC_CHUNK.frame,
  MAGIC_CHUNK.frameAlt,
  MAGIC_CHUNK.hoverFrame,
  MAGIC_CHUNK.hoverFrameAlt,
  // @source `fcn_0044ecb6` 0x0044ed3e..0x0044ed45：`push [0x4762bc]`（= 图 8）/ `call 0x456418`
  MAGIC_CHUNK.resultBar,
  ...Array.from({ length: 12 }, (_, i) => MAGIC_CHUNK.targetIconFirst + i),
  ...Array.from({ length: 12 }, (_, i) => MAGIC_CHUNK.ringFirst + i),
]);

/** 一张图要不要抠黑由 `MAGIC_KEYED` 说了算，别在各处手写 */
function magicSprite(sprite: MagicSprite, chunk: number): Sprite | null {
  return sprite('Panel.mkf', MAGIC_RESOURCE, chunk, MAGIC_KEYED.has(chunk));
}

/**
 * 台詞串去掉 `#NNNN` 语音前缀后的**可见文字**（`\n` 保留，画的时候拆行）。
 * ★ 纯函数：绘制链**只剥不播**，语音在换词那一拍请求一次（`requestVoiceLine`）。
 */
export function magicGreetText(line: string): string {
  return stripVoiceCode(line);
}

/**
 * 同一句台詞**再请求一次**的最小间隔（毫秒）—— 兜 `Speaking.mkf`（57 MB 懒加载）
 * 进屏那一瞬间还没到货、第一次请求被丢掉的情形。与 `audio.ts` 的
 * `VOICE_RETRIGGER_GAP_MS` 同值。
 */
export const MAGIC_VOICE_RETRY_MS = 500;
/** 同一句最多请求几次（换词一次 + 兜底一次）*/
export const MAGIC_VOICE_MAX_ASKS = 2;

/** 上一次**真正送进语音出口**的那一句，与那一刻（`null` = 还没送过）*/
let voiceLine: string | null = null;
let voiceAt = 0;
let voiceAsks = 0;

/**
 * 把「字框里这一拍的话」送进语音出口（`playVoiceCode` 顺手播 `#NNNN`）。
 * 调用点只在状态推进上（`event` / `tick` / `down`）—— **绘制链一处都不许调**。
 */
function requestVoiceLine(line: string | null, now: number): boolean {
  if (line === null || line === '') return false;
  if (line === voiceLine) {
    if (voiceAsks >= MAGIC_VOICE_MAX_ASKS) return false;
    if (now - voiceAt < MAGIC_VOICE_RETRY_MS) return false;
    voiceAsks += 1;
  } else {
    voiceLine = line;
    voiceAsks = 1;
  }
  voiceAt = now;
  playVoiceCode(line);
  return true;
}

/**
 * 字框里的字（`fcn_0044ecb6`）—— 画在**盒心 +(dx,dy)**、每行正中、行距 `MAGIC_MSG_LINE_H`。
 */
export function magicBoxText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  fill: string,
  outline: string,
  outlineWidth: number,
  lineH = MAGIC_MSG_LINE_H,
): void {
  const lines = magicGreetText(text).split('\n').filter((l) => l !== '');
  if (lines.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // ★ 2026-09-23：魔法屋开框带第二色（`0x00432575 push 0x202020 / push 0xe0e0e0`）⇒ `fcn_0044ecb6` 走
  //   `push 1 / push 3` —— **粗体 + 右下 1 px 阴影**（不是描 3 px 边；见 `font.ts` 的 `clerkTextStyle`）。
  //   `outlineWidth` 0 = 调用方要不带第二色的那一种（字效 2）。
  const style = clerkTextStyle(fill, outlineWidth > 0 ? outline : null);
  lines.forEach((line, i) => {
    const y = cy + (i - (lines.length - 1) / 2) * lineH;
    drawGdiText(ctx, line, cx, y, style);
  });
  ctx.restore();
}

function magicText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.font = `${size}px ${MAGIC_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = MAGIC_TEXT.stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = MAGIC_TEXT.fill;
  ctx.fillText(text, x, y);
}

/**
 * 画字框 + 里面这一句（`fcn_0044ec30` 设框、`fcn_0044ecb6` 挂字）。
 *
 * @param line `null` = **框已收起**，什么都不画（`fcn_0044ee18` 到期把底下那块贴回去了）
 */
export function drawMagicMessageBox(
  ctx: CanvasRenderingContext2D,
  sprite: MagicSprite,
  line: string | null,
): void {
  if (line === null) return;
  const box = magicSprite(sprite, MAGIC_MSG_BOX.chunk);
  drawAnchored(ctx, box, MAGIC_MSG_BOX.x, MAGIC_MSG_BOX.y);
  const cx = MAGIC_MSG_BOX.x - (box?.anchorX ?? 0) + (box?.width ?? 280) / 2 + MAGIC_MSG_BOX.dx;
  const cy = MAGIC_MSG_BOX.y - (box?.anchorY ?? 0) + (box?.height ?? 173) / 2 + MAGIC_MSG_BOX.dy;
  magicBoxText(ctx, line, cx, cy, MAGIC_MSG_BOX.fill, MAGIC_MSG_BOX.outline, MAGIC_MSG_BOX.outlineWidth);
}

/** 一圈里的高亮图标（兜底描圈）*/
function drawRingIcon(ctx: CanvasRenderingContext2D, sprite: MagicSprite, option: number): void {
  const at = magicIconAt(option);
  const s = magicSprite(sprite, magicIconChunk(option));
  drawAnchored(ctx, s, at.x, at.y);
  if (s === null) {
    ctx.save();
    ctx.lineWidth = MAGIC_HOVER.width;
    ctx.strokeStyle = MAGIC_HOVER.color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, MAGIC_HOVER.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 图 1 上的一张贴片（不透明，见 `MagicFacePatch`）*/
function drawFacePatch(ctx: CanvasRenderingContext2D, sprite: MagicSprite, p: MagicFacePatch): void {
  switch (p) {
    case 'eyes':
      drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.eyesShut), MAGIC_EYES_AT.x, MAGIC_EYES_AT.y);
      return;
    case 'mouthShut':
      drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.eyelid), MAGIC_EYELID_AT.x, MAGIC_EYELID_AT.y);
      return;
    case 'mouthOpen':
      drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.mouth), MAGIC_MOUTH_AT.x, MAGIC_MOUTH_AT.y);
      return;
    case 'mouthRest': {
      // `fcn_0045643d` 是矩形拷贝、**不抠黑** ⇒ 取不抠黑的那一份图 1
      const s = sprite('Panel.mkf', MAGIC_RESOURCE, MAGIC_CHUNK.witchIntro, false);
      if (s === null) return;
      const r = MAGIC_MOUTH_REST_SRC;
      drawSpriteRegion(ctx, s, r.x, r.y, r.w, r.h, MAGIC_MOUTH_AT.x, MAGIC_MOUTH_AT.y, r.w, r.h);
      return;
    }
  }
}

/**
 * 画整屏 —— 按原版离屏面上**贴图的先后**叠（原版不重画整屏，只在各拍往上贴）：
 *
 * | 顺序 | 贴什么 | 什么时候贴的 | @source |
 * |---|---|---|---|
 * | 1 | 底图（图 0）| 铺场 | `fcn_00432511` |
 * | 2 | 图 1（抱水晶球）落 (241,140) | 铺场；状态 4 → 5 整张重贴 | 0x00432543 / 0x00432791 |
 * | 3 | 脸上的贴片（闭眼 / 嘴型，按先后）| 状态 3 → 4 闭眼；每拍摆嘴型 | `loc_00432951` / `loc_00432871` |
 * | 4 | 条件图标（图 `条件+11` 落 (326,296)）| 状态 4 → 5 | `loc_00432719` |
 * | 5 | 悬停 / 选中那一格的高亮图标 | 状态 7 悬停 | 0x00432d0e |
 * | 6 | 状态 7：锦缎框 + 功能名（存了底、离开就贴回）| 状态 7 悬停 | 0x00432de6 / 0x00432e29 |
 * | 7 | 状态 8：**图 2（抬手）**抠黑盖上 + 条件图标再贴一次 | 点下去 | 0x00432f72 / 0x00432fab |
 * | 8 | 字框（存了底、到期贴回）| 挂一句话 | `fcn_0044ecb6` |
 *
 * ★★ 2026-09-23 订正：状态 8 **图 1 仍在底下** —— 点下去那一支（`loc_00432e8e`）只把悬停弹窗
 *   贴回去，没有还原图 1 那块，图 2 又是**抠黑**贴的（`fcn_00456418`）⇒ 图 2 的透明处
 *   露出图 1（两边袖口那几块，约 4170 像素）。先前状态 8 不画图 1，那几块变成了底图。
 */
export function drawMagicScreen(
  ctx: CanvasRenderingContext2D,
  sprite: MagicSprite,
  d: MagicDraw,
): void {
  drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.bg), MAGIC_BG_AT.x, MAGIC_BG_AT.y);
  const showCriterion = d.state >= 5 && d.criterion >= 0 && d.criterion < MAGIC_TARGET_NAMES.length;
  const criterionIcon = (): void => {
    drawAnchored(ctx, magicSprite(sprite, magicTargetIconChunk(d.criterion)), MAGIC_RESULT_ICON_AT.x, MAGIC_RESULT_ICON_AT.y);
  };

  drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.witchIntro), MAGIC_WITCH_BALL_AT.x, MAGIC_WITCH_BALL_AT.y);
  for (const p of d.face ?? []) drawFacePatch(ctx, sprite, p);
  // 状态 8 那一次（0x00432fab，在图 2 之后）同图同点整张盖住这一次 ⇒ 状态 8 只画后一次
  if (showCriterion && d.state !== 8) criterionIcon();

  if (d.state === 8) {
    // 选中那一格的高亮是状态 7 悬停时贴的，点下去不还原 ⇒ 仍在，压在抬手女巫底下
    if (d.chosen >= 0 && d.chosen < MAGIC_SECTOR_COUNT) drawRingIcon(ctx, sprite, d.chosen);
    drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.witchIdle), MAGIC_WITCH_HAND_AT.x, MAGIC_WITCH_HAND_AT.y);
    if (showCriterion) criterionIcon();
  }

  // ── 状态 7：悬停那一格 —— 高亮图标 → 锦缎框 → 功能名（0x00432d0e → 0x00432de6 → 0x00432e29）──
  const hovered = d.state === 7 ? optionOfSector(d.hover) : null;
  if (hovered !== null) {
    drawRingIcon(ctx, sprite, hovered);
    const at = magicFrameAt(hovered);
    drawAnchored(ctx, magicSprite(sprite, magicFrameChunk(hovered)), at.x, at.y);
    const name = MAGIC_HOUSE_OPTIONS[hovered]?.name ?? '';
    if (name !== '') magicText(ctx, name, at.x, at.y, MAGIC_FONT_SIZE);
  }

  drawMagicMessageBox(ctx, sprite, d.boxLine);
}

// ============================================================
//  屏幕本体
// ============================================================

/** 窗口；`null` = 没开 */
let win: MagicWindow | null = null;
/** 本机能不能替触发者点（单机热座 = 能；联机 = 只有他自己那一端能）*/
let interactive = false;
/** 这一趟已经被答掉了（本机点的已派出 / 别处答掉）—— 关窗时不再派 */
let resolved = false;
/** 触发者（`state.currentPlayer`）*/
let caster = -1;
/** 鼠标现在指着的扇区（原版 `[0x48c3a1]`，只在状态 7 更新），0 = 不在任何扇区上 */
let hover = 0;
/** 最近一次鼠标位置（状态 6 → 7 补发 `WM_MOUSEMOVE` 用，@source 0x00432a0f `GetCursorPos`）*/
let lastMouse: { x: number; y: number } | null = null;
/** 关窗影片（`loc_00432a4c`）正在播的那一段；`null` = 还没起播 */
let film: BoardFilm | null = null;

/** 摆嘴型用的 `rand()`（单测换成确定序列）；`null` = `Math.random` */
let mouthRand: (() => number) | null = null;

/** 单测用：把摆嘴型那几次 `rand()` 换成确定序列（`null` 还原）*/
export function setMagicMouthRand(fn: (() => number) | null): void {
  mouthRand = fn;
}

/**
 * 调试 / 单测用：把整屏关掉（模块级状态跨用例会残留）。
 */
export function resetMagicScreen(): void {
  win = null;
  interactive = false;
  resolved = false;
  caster = -1;
  hover = 0;
  lastMouse = null;
  film = null;
  voiceLine = null;
  voiceAt = 0;
  voiceAsks = 0;
}

/** 定时器那一拍要问外面的东西（语音在不在响 / 摆嘴型的 `rand`）*/
function tickIo(): MagicTickIo {
  return mouthRand === null ? { voiceBusy: voiceBusy() } : { voiceBusy: voiceBusy(), rand: mouthRand };
}

/**
 * 窗口关掉（关窗影片播完 = `Post_0402`）：本机点定、还没被别处答掉 ⇒ 这时才把效果号交给 core
 * （原版 `0x004338b7 mov esi, eax` 之后才 `call 0x431caa`）。
 */
function closeWindow(env: UiScreenEnv): void {
  const w = win;
  const p = env.state.pending;
  if (w !== null && interactive && !resolved && w.chosen >= 0 && p !== null && p.kind === 'magicHouse') {
    env.dispatch({ type: 'magicHouse', option: w.chosen });
  }
  resetMagicScreen();
  env.log('魔法屋：結束');
  env.requestRender();
}

/**
 * 关窗那一段：影片起播 / 播完。
 *
 * ★ 原版 `read_mkf(Panel, 0x14)` 是**进窗口时**就读好的（0x0043386d），`fcn_0045144f` 当场就播；
 *   本引擎的 FLIC 是异步解的，故开窗那一刻就先问一次（`event`），到这里通常早解好了。
 *   真到这一拍还没解好（或根本没有素材）就**不播、直接关窗** —— 少一段影片，不卡回合。
 */
function tickClosing(env: UiScreenEnv): void {
  if (film === null) {
    const flic = env.flic(MAGIC_CLOSE_FILM.archive, MAGIC_CLOSE_FILM.resource);
    if (flic === null) {
      env.log('魔法屋：關窗影片還沒解好，略過');
      closeWindow(env);
      return;
    }
    film = beginBoardFilm(
      { ...MAGIC_CLOSE_FILM, frames: flic.frames.length, frameMs: flic.frameMs },
      env.now,
    );
    // @source 0x004514ad：第一帧那一刻 `call 0x45434f` 放 `fcn_00454304(0x3b)` 载好的那一声
    env.playEffect(MAGIC_CLOSE_FILM.sound);
    env.log(`魔法屋：關窗影片（${film.spec.frames} 帧 × ${film.spec.frameMs} ms）`);
    env.requestRender();
    return;
  }
  if (boardFilmDone(film, env.now)) {
    closeWindow(env);
    return;
  }
  env.requestRender();
}

/** 别处答掉了：演「点完」那一拍（见 `magicWindowResolve`）*/
function resolveFrom(after: GameState, before: GameState | null, now: number): void {
  if (win === null) return;
  resolved = true;
  const ev = after.lastEvent;
  // `before === null`（tick 兜底）时分不清 lastEvent 是不是这一趟的 ⇒ 不认
  const fresh = before !== null && ev !== null && ev.kind === 'magicHouse' && ev !== before.lastEvent;
  const option = win.chosen >= 0 ? win.chosen : fresh ? ev.id : -1;
  win = magicWindowResolve(win, option, now);
}

/**
 * 窗口停在状态 7（等真人点一格）—— 此刻它是**待决交互**而不是演出。
 * `main.ts` 的 `blockingPresentation` 据此放行联机收件箱（别家那一端的答复 / 託管那一条）。
 */
export function magicAwaitingPick(): boolean {
  return win !== null && win.state === 7;
}

/**
 * 女巫窗口此刻要哪一支**软件指针**（`soft-cursor.ts`；`null` = 藏起）。
 *
 * @source 原版的指针是软件画的：`fcn_00402250` 在 `[0x48a178] == 1` 时 `GetCursorPos` 后把指针图
 *   （`[0x48a0f4]` 第 `[0x48a172]` 张）锁主表面画上去，`fcn_0040235d` 擦掉；`fcn_00402460(1/0)`
 *   置 / 清 `[0x48a178]` 并当场画 / 擦（0x00402467 / 0x0040248f）。
 *   按 GO 那一刻 `0x0040126f push 0 / call 0x402460` 就把指针收了，走子、落点一路都不画；
 *   女巫窗口里只有状态 6 → 7（`loc_00432a0f` 0x00432a16 `push 1`）放出来、点下去（0x00432fd4 `call 0x402460`，实参 0）又收起。
 *   ⇒ 开场白 / 摇签 / 念咒 / 关窗影片这些拍子上**没有指针**，只有等玩家点那一拍有（默认箭头 0x29）。
 * ★ 联机旁观（不是自己的魔法屋，`interactive` 为假）：藏着 —— 他不能点。
 */
export function magicCursor(): CursorWant {
  return win !== null && win.state === 7 && interactive ? showCursor(ARROW_CURSOR) : null;
}

/**
 * 状态 7 里真人拿什么手势出去（`tools/soak-browser.js` 的真人路径用）：点「向後轉」那一格。
 * 不在等点的那一拍 / 本机不能点 ⇒ `null`。
 */
export function magicHumanPickPoint(): { x: number; y: number } | null {
  if (win === null || win.state !== 7 || !interactive) return null;
  return magicRingAt(7);
}

/** 换了一格悬停：记下、响一声 39（只有 1..12 格才响）@source 0x00432b91..0x00432e42 */
function hoverTo(next: number, env: UiScreenEnv): boolean {
  if (next === hover) return false;
  hover = next;
  // @source 0x00432e40：只有 1..12 格才走到放音那一句（0 / 13 在 0x00432ca3 就跳走了）
  if (optionOfSector(next) !== null) env.playEffect(MAGIC_SOUND_HOVER);
  return true;
}

export const magicScreen: UiScreen = {
  id: 'magic',

  /** 软件指针：只有等玩家点那一拍放出来（见 `magicCursor`）*/
  cursor: magicCursor,

  /** 窗口开着就接管整屏 */
  active: () => win !== null,

  draw(env: UiScreenEnv): void {
    const w = win;
    if (w === null) return;
    drawMagicScreen(env.stage, env.sprite, {
      state: w.state,
      criterion: w.criterion,
      chosen: w.chosen,
      face: w.face,
      hover,
      boxLine: w.line,
    });
    // 关窗影片整幅盖在状态 8 那一屏上（索引 0 = 透明 ⇒ 露出底下那一屏）
    if (film !== null) {
      const bmp = boardFilmBitmap(film, env.now, env.flic(film.spec.archive, film.spec.resource));
      const f = env.flic(film.spec.archive, film.spec.resource);
      // FLIC 帧按影片的**逻辑**尺寸画：超分帧位图更大，塞回同一个框（`hd-stage.ts`）
      if (bmp !== null && f !== null) drawSprite(env.stage, { bitmap: bmp, width: f.width, height: f.height }, film.spec.x, film.spec.y);
    }
  },

  /**
   * 鼠标移动 —— 原版 `WM_MOUSEMOVE (0x200)`（VA 0x00432b50）**只在状态 7 查**命中表：
   * 换了一格就贴该格的高亮图、开弹窗写功能名、响一声 39。
   */
  move(x: number, y: number, env: UiScreenEnv): void {
    lastMouse = { x, y };
    if (win === null || win.state !== 7) return;
    if (hoverTo(sectorAt(x, y), env)) env.requestRender();
  },

  /**
   * 鼠标按下 —— 原版 `WM_LBUTTONDOWN (0x201)`（VA 0x00432e8e）：
   *
   * | 状态 | 原版做什么 |
   * |---|---|
   * | `< 3`（开场白）| 跳过（`magicWindowSkip`；`fcn_0044ee18(1)` 顺手**停掉语音**）|
   * | `!= 7` | 什么都不做 |
   * | `== 7` 且点在 1..12 | 选定（`magicWindowPick`）|
   * | `== 7` 且点在 13（中央）| 再报一次条件名（`magicWindowAskCriterion`）|
   */
  down(x: number, y: number, env: UiScreenEnv): void {
    lastMouse = { x, y };
    const w = win;
    if (w === null) return;
    if (w.state < 3) {
      skipGreeting(env);
      return;
    }
    if (w.state !== 7) return;
    // 原版按的是**上一次 WM_MOUSEMOVE 记下的格号**；触屏没有悬停，这里按点下去那一点重查一遍
    const sector = sectorAt(x, y);
    hover = sector;
    if (sector === MAGIC_HIT_CENTER) {
      win = magicWindowAskCriterion(w, env.now);
      requestVoiceLine(win.line, env.now);
      env.log(`魔法屋：條件 ${MAGIC_TARGET_NAMES[w.criterion] ?? ''}`);
      env.requestRender();
      return;
    }
    const option = optionOfSector(sector);
    if (option === null) return; // 命中 0：什么都不做 @source 0x00432ea7
    if (!interactive) return; // 联机：不是自己的魔法屋，只能看
    win = magicWindowPick(w, option, env.now);
    requestVoiceLine(win.line, env.now);
    env.log(`魔法屋：選定 ${sector}（${MAGIC_HOUSE_OPTIONS[option]?.name ?? ''}）`);
    env.requestRender();
  },

  /**
   * 联机旁观：行动者那台已经收场（见 `ui-screen.ts` 的 `fastForward`）⇒ 直接关窗。
   *
   * 什么时候会走到：施法者**关窗那一刻**才派 `{type:'magicHouse', option}`（`closeWindow`），
   * 所以队首是他那一条（或更后面的）= 他的窗口已经关了；本台还停在开场白 / 摇签（晚进屏），
   * 或还在演「天靈靈地靈靈」那一拍（`resolveFrom` 之后的 hold）。
   *
   * ⚠️ 两种情形**不动**（返回 false）：
   *   - 状态 7（等点选）：那一拍是待决交互，不是演出（`magicAwaitingPick`，`main.ts` 也不拿它挡收件箱）；
   *   - 本机的窗口、效果号还没交出去（`interactive && !resolved`）：关掉就把这位真人的点选吞了。
   *
   * ★ 直接 `resetMagicScreen`，**不走** `closeWindow`（那里会派 action）。随后施加施法者那条答复时
   *   `event()` 见 `win === null` 且 pending 已撤 ⇒ 不会重新开窗。
   */
  fastForward(env: UiScreenEnv): boolean {
    const w = win;
    if (w === null || w.state === 7) return false;
    if (interactive && !resolved) return false;
    resetMagicScreen();
    env.log('魔法屋：跟著行動者收場');
    env.requestRender();
    return true;
  },

  /** 右键 —— 原版 `WM_RBUTTONUP (0x205)` → `loc_00432e64`：只在开场白那几拍（状态 < 3）跳过 */
  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    if (win === null || win.state >= 3) return;
    skipGreeting(env);
  },

  /** 与 `contextmenu` 同一道闸：只有开场白那几拍（状态 < 3）右键才有反应 */
  contextmenuLive(): boolean {
    return win !== null && win.state < 3;
  },

  tick(env: UiScreenEnv): void {
    const w = win;
    if (w === null) return;
    // 兜底：pending 已经不在了（重连 / 同步把它冲掉了）却没收到那一拍 ⇒ 当作别处答掉
    if (!resolved && env.state.pending?.kind !== 'magicHouse') resolveFrom(env.state, null, env.now);
    const cur = win ?? w;
    if (cur.closing) {
      tickClosing(env);
      return;
    }
    const next = magicWindowAdvance(cur, env.now, tickIo());
    win = next;
    if (next.closing) {
      env.log('魔法屋：念完咒語');
      tickClosing(env);
      return;
    }
    // 换了词立刻请求；同一句按去抖 + 上限两次补问（兜 `Speaking.mkf` 懒加载）
    requestVoiceLine(next.line, env.now);
    if (next.state !== cur.state) {
      if (next.state === 2 || next.state === 3) {
        if (next.line !== null) env.log(`魔法屋：台詞 ${next.state}/${MAGIC_GREET_LINES.length}`);
      } else if (next.state === 4) {
        env.log('魔法屋：搖籤');
      } else if (next.state === 5) {
        env.log(`魔法屋：條件 ${MAGIC_TARGET_NAMES[next.criterion] ?? ''}`);
      } else if (next.state === 6) {
        if (next.line !== null) env.log('魔法屋：輪到你了');
      } else if (next.state === 7) {
        // @source 0x00432a0f：进状态 7 时补发一个 `WM_MOUSEMOVE`（当前鼠标位置）——
        //   它与普通的鼠标移动走同一支（0x00432b50）：格号变了就贴高亮、开弹窗、**响 39**。
        hoverTo(lastMouse === null ? 0 : sectorAt(lastMouse.x, lastMouse.y), env);
        env.log('魔法屋：等玩家點選');
      }
    }
    // ★ 等玩家点的那一拍（状态 7）画面不会自己变 —— 不续帧；其余各拍都在计时，要续帧
    if (next.state !== 7 || next !== cur) env.requestRender();
  },

  /**
   * 两件事：① `pending{magicHouse}` **刚挂出** ⇒ 开窗；② 开着窗时 pending 没了 ⇒ 这一趟答掉了。
   *
   * ★ 电脑踩魔法屋 core 当场就结算完、不挂 pending（`0x0043381b` 的分流），这里也就不开窗
   *   （第十一份回报 #10「NPC 触发魔法屋时不应该由玩家来选择」）。电脑那一支原版弹的
   *   「条件\n\n效果」訊息框（`0x004339b3`）走 `notices`，见 core 的 `magic.spin`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    const bp = before.pending;
    const ap = after.pending;
    if (win === null) {
      if (ap === null || ap.kind !== 'magicHouse' || ap === bp) return;
      const who = after.players[after.currentPlayer];
      if (who === undefined || who.whoPlays !== 1) return;
      caster = after.currentPlayer;
      interactive = env.localSeat === null || env.localSeat === undefined || env.localSeat === caster;
      resolved = false;
      hover = 0;
      film = null;
      win = magicWindowOpen(ap.criterion, env.now, env.animation !== false);
      requestVoiceLine(win.line, env.now);
      // ★ 關窗那段影片 `Panel #20` 原版在进窗口时就 `read_mkf` 好了（0x0043386d）—— 这里先起解
      env.flic(MAGIC_CLOSE_FILM.archive, MAGIC_CLOSE_FILM.resource);
      // ★ 進魔法屋的配乐 @source 0x0043389e `push 7 / call fcn_004549cf`（`magic_house.asm:2269`，真人那一支才放）
      //   ⇒ id 7 → `MIDI08.MID` → 磁盘名 `midi08.mid`（见 `SCREEN_BGM.magicHouse`）
      env.music?.('midi08.mid');
      env.log('魔法屋：開屏');
      env.requestRender();
      return;
    }
    if (bp !== null && bp.kind === 'magicHouse' && (ap === null || ap.kind !== 'magicHouse')) {
      if (!resolved) resolveFrom(after, before, env.now);
      env.requestRender();
    }
  },
};

/** 开场白里点一下 / 右键：跳过（`loc_00432e71`：置 `[0x48c3a5]`、`fcn_0044ee18(1)` 停语音收框、进状态 3）*/
function skipGreeting(env: UiScreenEnv): void {
  if (win === null) return;
  win = magicWindowSkip(win);
  stopVoice();
  env.log('魔法屋：跳過開場台詞');
  env.requestRender();
}

/**
 * 给单测 / 自动化用的只读视图。
 */
export function magicScreenState(): {
  playing: boolean;
  state: number;
  line: string | null;
  criterion: number;
  chosen: number;
  hover: number;
  interactive: boolean;
  resolved: boolean;
  caster: number;
  face: readonly MagicFacePatch[];
  mouthHold: number;
  closing: boolean;
  /** 关窗影片播到第几帧（0 基）；没在播 = −1 */
  filmFrame: number;
} {
  return {
    playing: win !== null,
    state: win?.state ?? 0,
    line: win?.line ?? null,
    criterion: win?.criterion ?? -1,
    chosen: win?.chosen ?? -1,
    hover,
    interactive,
    resolved,
    caster,
    face: win?.face ?? [],
    mouthHold: win?.mouthHold ?? 0,
    closing: win?.closing ?? false,
    filmFrame: film === null ? -1 : Math.min(film.spec.frames - 1, Math.floor((performance.now() - film.startedAt) / film.spec.frameMs)),
  };
}
