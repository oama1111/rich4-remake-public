/*
 * 魔法屋屏（外圈 12 功能悬停高亮 + 中央文字 + 音）—— T-037 / U-9 / MOD-12
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一屏在 core 里**没有待决交互**：`runMagicHouse()`（VA 0x0043390b）两个转盘
 *   都是自己 `rand()` 转的，玩家一次也插不上手（`reduce.ts` 的 `settle` 分支）。
 *   所以本模块是**回放这次结果**的演出：`event(before, after, env)` 察觉
 *   「刚刚落了一次魔法屋」，反推出转盘落点，播完自己关。
 *
 * ⚠️ **但原版那一屏是可点的**（`WM_LBUTTONDOWN` → `loc_00432e8e`，VA 0x00432e8e）：
 *   状态 < 3 时点一下 = 跳过开场白；状态 7（转盘停了）时点 1..12 格 = 选定
 *   那个功能（`[0x48c3a1]` 就是回传的格号），点中央 13 = 再报一次抽中的条件名；
 *   那一下还会把女巫换成「抬手」那张、写上 `#0041天靈靈地靈靈～`。本引擎的落点
 *   由 core 决定（见 D-MAGIC-1），所以这一屏把那三拍折成：
 *   **跳过开场白 / 高亮并报出选中项 / 推进到「抬手」那一拍** —— 见 `down()`。
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
 * 三支各有出处（VA 0x00432e40 结果 39 / 0x00433531 悬停 0 / 0x0043365c 按下 1），
 * 本屏按 `MAGIC_SOUND_RESULT` / `MAGIC_SOUND_HOVER` / `MAGIC_SOUND_PRESS` 放。
 * ⚠️ 先前这一段的「表 `0x4757e7` 里是 dword 16、本模块一个音都不放」两条都不成立
 * （首字节是 **0x27 = 39**），已在 `MAGIC_SOUND_RESULT` 的注释里订正。
 */

import { MAGIC_HOUSE_OPTIONS, stripVoiceCode } from '@rich4/data';
import { playVoiceCode } from './voice-sink.ts';
import {
  LAND_TYPE_HOUSE,
  MAGIC_TARGET_NAMES,
  SPECIAL_KIND,
  allEffectiveFacilities,
  allEffectiveLands,
  type GameState,
  type MapTopology,
  type Player,
} from '@rich4/core';
import { FONT_FAMILY } from './font.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

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
 * | 8 | 280×173 | 中央那只**木牌**（字框）| 开屏起一直在 | 0x00432596 |
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
 * 女巫「张嘴」的每拍概率。
 *
 * @source 0x00432a85：先 `rand() >> 11`（⇒ **1/4** 的门槛），过了再 `rand() & 1`
 *   ⇒ 真正贴图 5 的概率是 **1/8**（先前只按 `rand()&1` 写成 1/2）。
 */
export const MAGIC_WITCH_BLINK_P = 1 / 8;

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
//  回放脚本（纯函数）
// ============================================================

/** 转盘最高速 @source 原版挂 100ms 定时器、隔一次动一下 = 约 200ms 一位 */
export const MAGIC_SPIN_MS = 200;
/** 越转越慢：每一位比上一位多停这么多 */
export const MAGIC_SPIN_SLOW = 45;
/** 转到结果后停多久再关屏 —— 原版点中之后 1.5 秒就走（`push 0x5dc`，VA 0x004339b3） */
export const MAGIC_HOLD_MS = 1500;

/**
 * 入口台詞那三句 —— **文字框**先由 `fcn_0044ec30` 设好，再由 `fcn_0044ecb6` 逐句画。
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
 *   `0x4756a4`（`#0041天靈靈地靈靈～`）是后面几拍用的，本模块只做入口这三句。
 */
export const MAGIC_GREET_LINES: readonly string[] = [
  '#0037進來魔法屋，就得\n完全照我的指示！',
  '#0038我選出符合條件的人。',
  '#0039你來決定他們的命運～',
];

/**
 * 一句台詞停多久。
 *
 * @source `fcn_0044ee18`（VA 0x0044ee18）：`call timeGetTime` 减去
 *   `[0x4762c4]`（`fcn_0044ecb6` 记下的「挂上那一刻」）之后
 *   `cmp eax, 0x7d0 / jb` —— 到 **2000 ms** 就算到期。同一个数也在
 *   `lottery-ceremony.ts` 的 `CEREMONY_VOICE_MS` 上（那边是同一支
 *   `fcn_0044ee18` 的另一处调用）。
 *
 * ⚠️ 原版还有一条「音效开着就等语音播完」（`cmp byte [0x49715b], 0` 之后
 *   `call 0x4544b9`）—— 语音时长要到 `Speaking.mkf` 里查，本屏拿不到那个出口，
 *   故按**底数 2000 ms**走（登记在 `T-037.md` 的 D-MAGIC-12）。
 */
export const MAGIC_GREET_MS = 0x7d0;

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
 * cmp byte [0x48c3a5], 0     ; [0x48c3a5] = **!動畫過程**
 * je  short loc_004329e3     ; 关掉 → 走下面那句
 * mov byte [0x48c3a1], 1     ; ★ 关掉：只摇 1 拍（= 立刻开）
 * jmp …
 * loc_004329e3:
 * mov byte [0x48c3a1], 0xa   ; ★ 开着：**10 拍**（1 秒）
 * ```
 * 之后每个 `0x113` 把 `[0x48c3a1]` 递减（`loc_004326e5`），减到 0 才
 * `loc_00432719` 抽条件 ⇒ 一共 `MAGIC_ROLL_TICKS × MAGIC_TIMER_MS` 毫秒。
 */
export const MAGIC_ROLL_TICKS = 0xa;
/** 动画关掉时只摇 **1** 拍 @source 同上 `mov byte [0x48c3a1], 1` */
export const MAGIC_ROLL_TICKS_FAST = 1;

/**
 * 抽中的**条件名**在字框里停多久 —— 恰好一拍。
 *
 * @source 状态 5 是 `loc_00432719` 抽完写进去的那一句
 *   （`fcn_0044ecb6([0x4756b8 + 条件下标*4])`），下一个 `0x113` 就推进状态 6；
 *   状态 6 一到就把字框换成 `#0040`（`loc_004329ef`）。
 */
export const MAGIC_CRITERION_MS = MAGIC_TIMER_MS;

/**
 * 「輪到你了」那一句 —— 状态 6 写进字框。
 * @source `loc_004329ef`：`cmp byte [0x48c3a5], 0 / jne loc_00432944` ⇒ **动画关掉不写**；
 *   开着则 `push [0x4756a0]` → `fcn_0044ecb6`（串 `#0040嘿～輪到你了！`）。
 */
export const MAGIC_TURN_LINE = '#0040嘿～輪到你了！';

/**
 * 「天靈靈地靈靈～」那一句 —— 状态 8（挑完功能、播完那段 FLIC 之后）。
 * @source `loc_00432fea` 一带：`mov byte [0x48c3a2], 8` → `push [0x4756a4]` → `fcn_0044ecb6`
 *   （同一句也用在另一条「施法」支线 `[0x48c3ad] = 5` 上）。
 */
export const MAGIC_SPELL_LINE = '#0041天靈靈地靈靈～';

/**
 * 字框里的字号 —— `fcn_0044ec30` 的第 4 参 `push 0x14` = **20**（`fcn_0044ecb6`
 * 里 `create_font(0x14, …)` 用的也是它）。
 */
export const MAGIC_MSG_FONT_SIZE = 0x14;
/** 字框里的行距 —— 与 `drawLoanBubble` 同口径（字号 + 6）*/
export const MAGIC_MSG_LINE_H = MAGIC_MSG_FONT_SIZE + 6;

/** 入口台詞的字框参数（见 `MAGIC_GREET_LINES` 的注释）*/
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

export interface MagicSpin {
  /** 已经转过的位数 */
  step: number;
  /** 上一位换掉的时刻 */
  at: number;
  /** 这一位要停多久 */
  wait: number;
  /** 正指着的功能 */
  option: number;
}

export function magicSpinStart(option: number, now: number): MagicSpin {
  return { step: 0, at: now, wait: MAGIC_SPIN_MS, option };
}

/** 转盘结束前总共转多少位：把最后一圈走满，保证「从哪起转都看得见落点」 */
export function magicSpinSteps(): number {
  return MAGIC_SECTOR_COUNT * 2;
}

/**
 * 转盘往前走。走满 `magicSpinSteps()` 位就停在 `target` 上。
 *
 * 帧序：第 `n` 位指到 `(n + 1) % 12`，最后一位指到 `target` ——
 * 即「先自己转两圈、再停在结果上」。
 */
export function magicSpinTick(s: MagicSpin, target: number, now: number): MagicSpin {
  const total = magicSpinSteps();
  if (s.step >= total) return { ...s, option: target };
  const dt = now - s.at;
  if (dt < s.wait) return s;
  const step = s.step + 1;
  // ★ 位数**直接由 `target` 往前数**：第 `step` 位指到 `target + step − total`。
  //   先前写成 `target + total − over`（over 从 0 起）在 `target === over` 时
  //   会算成同一个数 —— 转盘会卡在落点上不转。
  const option =
    step >= total
      ? target
      : (((target + step - total) % MAGIC_SECTOR_COUNT) + MAGIC_SECTOR_COUNT) %
        MAGIC_SECTOR_COUNT;
  return {
    step,
    at: now,
    wait: s.wait + MAGIC_SPIN_SLOW,
    option,
  };
}

export function magicSpinDone(s: MagicSpin): boolean {
  return s.step >= magicSpinSteps() && s.option >= 0;
}

/**
 * 一次回放的五个阶段 —— 照原版 `[0x48c3a2]` 的状态号切出来：
 *
 * | 本模块 | 原版状态 | 停多久 | 字框里是什么 |
 * |---|---|---|---|
 * | `greet` | 1/2/3 | 每句 `MAGIC_GREET_MS` | 入口三句（`#0037`/`#0038`/`#0039`）|
 * | `roll` | 4 | `MAGIC_ROLL_TICKS × MAGIC_TIMER_MS` | 仍是最后那句入口台詞 |
 * | `criterion` | 5 | `MAGIC_CRITERION_MS` | **抽中的条件名**（`MAGIC_TARGET_NAMES[criterion]`）|
 * | `spin` | 6/7 | 转盘节拍 | `#0040嘿～輪到你了！`（`MAGIC_TURN_LINE`）|
 * | `hold` | 8 | `MAGIC_HOLD_MS` | `#0041天靈靈地靈靈～`（`MAGIC_SPELL_LINE`）|
 */
export type MagicPhase = 'greet' | 'roll' | 'criterion' | 'spin' | 'hold';

export interface MagicPlayback {
  phase: MagicPhase;
  spin: MagicSpin;
  /** 转盘最后停下的功能（回放的目标）*/
  target: number;
  /** 停在结果上的时刻 */
  holdAt: number;
  /** `phase === 'greet'` 时正说第几句（`MAGIC_GREET_LINES` 的下标）*/
  greet: number;
  /** 这一句挂上的时刻 */
  greetAt: number;
  /** 抽签那一拍开始的时刻（`phase === 'roll' | 'criterion'` 用）*/
  rollAt: number;
  /** 这一局摇几拍（动画开 10 / 关 1，见 `MAGIC_ROLL_TICKS`）*/
  rollTicks: number;
  /** 抽中的条件名 —— 状态 5 写进字框的那一句（`view.criterionName`）*/
  criterionName: string;
}

/**
 * 起播。
 *
 * @param greet 要不要先走**入口台詞**那三句 —— `env.animation !== false`。
 *   @source `loc_004326b9`（VA 0x004326b9）：`cmp byte [0x48c3a5], 0 / jne loc_00432e82`
 *   —— 设定关掉时（`[0x48c3a5] = !anim`）**直接跳过消息框**，也就是不播这三句
 *   （见 `Q-ANIM-1.md` 的魔法屋那一行与 `T-037.md` 的 D-MAGIC-12）。
 */
export function magicPlaybackStart(
  target: number,
  now: number,
  greet = true,
  criterionName = '',
  rollTicks = MAGIC_ROLL_TICKS,
): MagicPlayback {
  return {
    // ★ 动画关掉（`greet = false`）时原版**只跳过消息框那三句**，
    //   抽签那一拍照走 —— 只是 `[0x48c3a1]` 被置成 1（一拍就开奖）。
    phase: greet ? 'greet' : 'roll',
    // 台詞／抽签期间这个 `spin` 只是个占位；转盘真正起转时会按**那一刻**重起一个
    //   （`magicPlaybackTick`），免得前面那几拍算进转盘节拍。
    spin: magicSpinStart(target, now),
    target,
    holdAt: 0,
    greet: 0,
    greetAt: now,
    rollAt: now,
    rollTicks: greet ? rollTicks : Math.min(rollTicks, MAGIC_ROLL_TICKS_FAST),
    criterionName,
  };
}

/**
 * 这一拍字框里该写哪一句 —— 纯函数（画的时候直接用）。
 *
 * | 阶段 | 写什么 | @source |
 * |---|---|---|
 * | `greet` | 入口三句的第 `greet` 句 | `loc_004326b9` 起那三处 `fcn_0044ecb6` |
 * | `roll` | 仍是最后那句（`#0039你來決定他們的命運～`）—— 原版摇签那 10 拍不换字 | `loc_00432951` |
 * | `criterion` | **抽中的条件名**（`[0x4756b8 + 下标*4]`）| `loc_00432719` 尾 |
 * | `spin` | `#0040嘿～輪到你了！` | `loc_004329ef` |
 * | `hold` | `#0041天靈靈地靈靈～` | `loc_00432fea` |
 */
export function magicBoxLineFor(p: MagicPlayback): string {
  switch (p.phase) {
    case 'greet':
      return MAGIC_GREET_LINES[p.greet] ?? '';
    case 'roll':
      return MAGIC_GREET_LINES[MAGIC_GREET_LINES.length - 1] ?? '';
    case 'criterion':
      return p.criterionName;
    case 'spin':
      return MAGIC_TURN_LINE;
    case 'hold':
      return MAGIC_SPELL_LINE;
  }
}

/** 推进一步；台詞走完进 `spin`，转盘走完进 `hold`，`hold` 满 `MAGIC_HOLD_MS` 返回 `null` */
export function magicPlaybackTick(p: MagicPlayback, now: number): MagicPlayback | null {
  if (p.phase === 'greet') {
    if (now - p.greetAt < MAGIC_GREET_MS) return p;
    const next = p.greet + 1;
    if (next < MAGIC_GREET_LINES.length) return { ...p, greet: next, greetAt: now };
    // 三句说完进**抽签那一拍**（原版状态 3 → 4：铺五芒星 + 摇 `[0x48c3a1]` 拍）
    return { ...p, phase: 'roll', rollAt: now };
  }
  if (p.phase === 'roll') {
    if (now - p.rollAt < p.rollTicks * MAGIC_TIMER_MS) return p;
    // 摇完 → 状态 5：把**抽中的条件名**写进字框
    return { ...p, phase: 'criterion', rollAt: now };
  }
  if (p.phase === 'criterion') {
    if (now - p.rollAt < MAGIC_CRITERION_MS) return p;
    // 状态 6/7：字框换成「嘿～輪到你了！」并起转盘
    return { ...p, phase: 'spin', spin: magicSpinStart(p.target, now) };
  }
  if (p.phase === 'spin') {
    const spin = magicSpinTick(p.spin, p.target, now);
    if (spin.step >= magicSpinSteps()) return { ...p, phase: 'hold', spin, holdAt: now };
    return spin === p.spin ? p : { ...p, spin };
  }
  if (now - p.holdAt >= MAGIC_HOLD_MS) return null;
  return p;
}

// ============================================================
//  从状态 diff 反推这次魔法屋
// ============================================================

/**
 * **core 交出来的那一趟** → `MagicView` —— 条件号与名单是**抽出来的**，
 * 不该由表现层从 diff 反推（那是 D-MAGIC-1 的近似）。
 *
 * @param ev `state.lastEvent`（`kind === 'magicHouse'`）：
 *   `id` = 效果转盘落点、`criterion` = 目标转盘落点、`targets` = 筛出的名单
 *   （@source `runMagicHouse` 里的 `spinMagicHouse`：`criterion` 来自
 *   `rand()%12` + `fcn_00431842` 复检，VA 0x0043390b 一带）。
 * @returns `criterion` 缺失（旧存档/回放）时返回 `null`，调用方退回反推那条路
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

/** 这次回放要显示什么 */
export interface MagicView {
  /** 触发者（`state.currentPlayer`）*/
  caster: number;
  /** 效果转盘落点 0..11 */
  option: number;
  /** 功能名（`MAGIC_HOUSE_OPTIONS[option].name`）*/
  name: string;
  /** 被点到的人（玩家下标），可能不止一个 */
  targets: number[];
  /** 目标转盘落点 0..11 */
  criterion: number;
  /** 目标条件的名字（`MAGIC_TARGET_NAMES[criterion]`）*/
  criterionName: string;
}

/** 判断某个玩家这一刻是不是站在魔法屋上 @source `node.type == SPECIAL_KIND.MAGIC_HOUSE` */
export function onMagicHouse(state: GameState, topo: MapTopology): boolean {
  const p = state.players[state.currentPlayer];
  if (p === undefined) return false;
  const node = topo.nodes[p.nodeId - 1];
  return node !== undefined && node.specialKind === SPECIAL_KIND.MAGIC_HOUSE;
}

/**
 * 本引擎里可能出现的落点。
 *
 * @source VA 0x0043396d：效果转盘 `mov ecx, 0xb`（取模 **11**）＋
 *   `cmp edx, 6 / lea esi, [edx+1]`（抽到 6 改成 7）—— 所以**随机**能转到的
 *   只有 `{0,1,2,3,4,5,7,8,9,10}` 十个；第 11 条（拍賣當格土地）在零售版里
 *   **永远转不到**。
 *
 * ★ 但「得一張卡片」(6) **确实会出现**：名单里有当前玩家时
 *   `mov esi, 6`（VA 0x0043395a）直接定死，不再抽 —— 所以反推时要把它算进来。
 */
export const MAGIC_REACHABLE_OPTIONS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 随机转盘真正能抽到的十个（不含「得一張卡片」）@source `mov ecx, 0xb` */
export const MAGIC_SPIN_OPTIONS: readonly number[] = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10];

/**
 * 把玩家身上**确定**会被某个效果改掉的字段摘出来比 —— 效果之外的东西
 * （位置、朝向、神明…）一律不看，那些是 `settle` 之前就动过的。
 *
 * ⚠️ 这是**近似**：原版存的是转盘落点，本引擎存的是「转完之后的状态」，
 *   只能反推。见 `docs/deviations/T-037.md`。
 */
function effectSig(p: Player): string {
  return [
    p.cash,
    p.moneyInBank,
    p.points,
    p.direction,
    p.trafficMethod,
    p.ndices,
    p.godInfo,
    p.blocking.stopping,
    p.blocking.inPrison,
    p.blocking.inHospital,
    p.blocking.inHotel,
    p.blocking.disappearing,
    p.cards.join(','),
  ].join('|');
}

/** 这次 diff 里，除 `who` 外**谁都没动**？（魔法屋只动名单里的人）*/
function untouchedExcept(before: GameState, after: GameState, who: readonly number[]): boolean {
  const set = new Set(who);
  for (let i = 0; i < before.players.length; i++) {
    if (set.has(i)) continue;
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (effectSig(b) !== effectSig(a)) return false;
  }
  return true;
}

/** `誰` 在手牌 / 現金 / 存款 / 點券 上有没有变 */
function fieldsChanged(b: Player, a: Player): Set<'cards' | 'cash' | 'bank' | 'points'> {
  const out = new Set<'cards' | 'cash' | 'bank' | 'points'>();
  if (b.cards.join(',') !== a.cards.join(',')) out.add('cards');
  if (b.cash !== a.cash) out.add('cash');
  if (b.moneyInBank !== a.moneyInBank) out.add('bank');
  if (b.points !== a.points) out.add('points');
  return out;
}

/** 效果只动**名单里的人**，而且名单里的人各自的变化要对得上 */
function matchesEffect(
  option: number,
  targets: readonly number[],
  before: GameState,
  after: GameState,
): boolean {
  if (!untouchedExcept(before, after, targets)) return false;
  for (const who of targets) {
    const b = before.players[who];
    const a = after.players[who];
    if (b === undefined || a === undefined) return false;
    if (effectSig(b) === effectSig(a)) return false; // 被点到的人必须真的变了
    const ch = fieldsChanged(b, a);
    if (option !== 0 && option !== 4 && option !== 8 && ch.has('points')) return false;
    if (option !== 4 && ch.has('bank')) return false;
    if (option !== 0 && option !== 4 && option !== 8 && ch.has('cash')) return false;
    // 「得一張卡片」是**唯一**会往手里加牌的 @source `p.cards = [...p.cards, id]`
    if (option !== 6 && a.cards.length > b.cards.length) return false;
    // 「變賣所有卡片」把牌**清空**、點券按標價全额入账
    if (option === 0) {
      if (a.cards.length !== 0) return false;
      if (b.cards.length > 0 && a.points <= b.points) return false;
      if (b.cards.length === 0 && a.points !== b.points) return false;
    }
    if (option === 8 && a.points < b.points) return false;
    if (option === 4 && (a.moneyInBank < b.moneyInBank || a.cash !== 0)) return false;
  }
  return true;
}

/**
 * 这一组（option, targets）能不能解释这次 diff；能解释的话，
 * 它的「动作强度」有多大 —— 强度 0 表示**什么都没动**（例如手里没牌时的
 * 「變賣所有卡片」，那一条谁都能匹配上，不能当证据）。
 */
function matchStrength(
  option: number,
  targets: readonly number[],
  before: GameState,
  after: GameState,
): number {
  if (!matchesEffect(option, targets, before, after)) return 0;
  let strength = 0;
  for (const who of targets) {
    const b = before.players[who];
    const a = after.players[who];
    if (b === undefined || a === undefined) continue;
    if (b.cards.join(',') !== a.cards.join(',')) strength += 8;
    if (b.cash !== a.cash) strength += 4;
    if (b.moneyInBank !== a.moneyInBank) strength += 4;
    if (b.points !== a.points) strength += 4;
    if (b.direction !== a.direction) strength += 2;
    if (b.trafficMethod !== a.trafficMethod) strength += 2;
    if (b.blocking.stopping !== a.blocking.stopping) strength += 2;
    if (b.blocking.inPrison !== a.blocking.inPrison) strength += 2;
    if (b.blocking.inHospital !== a.blocking.inHospital) strength += 2;
    if (b.godInfo !== a.godInfo) strength += 2;
  }
  return strength;
}

/**
 * 反推这次魔法屋：先确认「落点就在魔法屋上」，再把
 * `before → after` 与 `magicTargets` / 十个效果一一对上。
 *
 * ⚠️ **取证据最强的那一组**，不是第一个对上的：
 *   「變賣所有卡片」在手里没牌时**什么都不改**，`matchesEffect` 会让它
 *   匹配任何 diff。所以强度为 0 的组合只能当兜底。
 *
 * @returns 解不出来（不是魔法屋）返回 `null`；是魔法屋但 diff 对不上任何
 *   组合时返回 `option: -1` 的一份空结果（照样起播）。见 deviations。
 */
export function magicView(before: GameState, after: GameState, topo: MapTopology): MagicView | null {
  if (!onMagicHouse(before, topo)) return null;
  const caster = before.currentPlayer;
  const players = before.players.length;

  let best: MagicView | null = null;
  let bestStrength = 0;

  for (let criterion = 0; criterion < MAGIC_TARGET_NAMES.length; criterion++) {
    const targets = magicTargetsFor(criterion, before, topo);
    if (targets.length === 0) continue;
    const kept = targets.filter((t) => t >= 0 && t < players);
    for (const option of MAGIC_REACHABLE_OPTIONS) {
      const strength = matchStrength(option, targets, before, after);
      if (strength <= bestStrength) continue;
      bestStrength = strength;
      best = {
        caster,
        option,
        name: MAGIC_HOUSE_OPTIONS[option]?.name ?? '',
        criterion,
        criterionName: MAGIC_TARGET_NAMES[criterion] ?? '',
        targets: kept,
      };
      if (strength >= 8) return best; // 已经抓到「手牌变了 / 实体变了」这一档
    }
  }
  if (best !== null) return best;

  // 兜底：diff 解释不通（例如随机抽卡那几步）——仍然起播，只不知道落点
  return {
    caster,
    option: -1,
    name: '',
    criterion: -1,
    criterionName: '',
    targets: [],
  };
}

// ============================================================
//  目标筛选（与 core 的 `magicTargets` 同一套判据，这里要「先算再比」）
// ============================================================

function landCounts(state: GameState, topo: MapTopology): { land: number[]; house: number[] } {
  const land = new Array<number>(state.players.length).fill(0);
  const house = new Array<number>(state.players.length).fill(0);
  for (const l of allEffectiveLands(state, topo)) {
    if (l.owner === 0) continue;
    const i = l.owner - 1;
    if (i < 0 || i >= land.length) continue;
    land[i] = (land[i] ?? 0) + 1;
    if (l.level !== 0) house[i] = (house[i] ?? 0) + 1;
  }
  for (const f of allEffectiveFacilities(state, topo)) {
    if (f.owner === 0) continue;
    const i = f.owner - 1;
    if (i < 0 || i >= land.length) continue;
    land[i] = (land[i] ?? 0) + 1;
    if (f.level !== 0) house[i] = (house[i] ?? 0) + 1;
  }
  return { land, house };
}

/** @source `places/magic-house.ts` 的 `magicTargets`（另见 doc 表）*/
function magicTargetsFor(criterion: number, state: GameState, topo: MapTopology): number[] {
  const ps = state.players;
  const alive = (p: Player): boolean => p.whoPlays !== 0;
  const counts = criterion === 1 || criterion === 2 ? landCounts(state, topo) : null;

  const maxBy = (metric: (p: Player) => number, skipZero: boolean): number[] => {
    let best = 0;
    let out: number[] = [];
    for (const p of ps) {
      if (!alive(p)) continue;
      const v = metric(p);
      if (skipZero && v === 0) continue;
      if (out.length === 0 || v > best) {
        best = v;
        out = [p.index];
      } else if (v === best) {
        out.push(p.index);
      }
    }
    return out;
  };
  const allWhere = (pred: (p: Player) => boolean): number[] =>
    ps.filter((p) => alive(p) && pred(p)).map((p) => p.index);

  let pick: number[];
  switch (criterion) {
    case 0:
      pick = maxBy((p) => wealthOf(state, topo, p.index), false);
      break;
    case 1:
      pick = maxBy((p) => counts?.land[p.index] ?? 0, true);
      break;
    case 2:
      pick = maxBy((p) => counts?.house[p.index] ?? 0, true);
      break;
    case 3:
      pick = maxBy((p) => p.cash, true);
      break;
    case 4:
      pick = maxBy((p) => p.moneyInBank, true);
      break;
    case 5:
      pick = maxBy((p) => p.points, true);
      break;
    case 6:
      pick = allWhere((p) => (p.trafficMethod & 3) === 0);
      break;
    case 7:
      pick = allWhere((p) => (p.trafficMethod & 3) === 1);
      break;
    case 8:
      pick = allWhere((p) => (p.trafficMethod & 3) === 2);
      break;
    case 9:
      pick = allWhere((p) => p.godInfo !== 0);
      break;
    case 10:
      pick = allWhere((p) => p.isMale);
      break;
    case 11:
      pick = allWhere((p) => !p.isMale);
      break;
    default:
      pick = [];
      break;
  }
  return pick.slice(0, 4);
}

/**
 * 身家的**近似**（criterion 0 用）。
 *
 * 地产那部分是照 `rules/wealth.ts` 的 `calculatePlayerWealth` 抄的
 * （住宅 `landPrice + level×housePrice`、連鎖店 `landPrice + housePrice`、
 * 設施 `level×housePrice + landPrice`）。
 *
 * ⚠️ 少了**股票**那一项：core 的 `runMagicHouse` 会调 `valuationsOf(...)`
 *   拿当天行情算持股，UI 这层拿不到行情，故只有在「財產最多的人」这一条上
 *   可能与 core 分歧。见 `docs/deviations/T-037.md`。
 */
function wealthOf(state: GameState, topo: MapTopology, playerIndex: number): number {
  const p = state.players[playerIndex];
  if (p === undefined) return 0;
  const ownerId = playerIndex + 1;
  let total = p.cash + p.moneyInBank - p.loan;

  for (const l of allEffectiveLands(state, topo)) {
    if (l.owner !== ownerId) continue;
    total += l.landPrice;
    // @source loc_00423a2d：連鎖店固定加一份房价、不乘等级
    if (l.type !== LAND_TYPE_HOUSE) total += l.housePrice;
    else if (l.level !== 0) total += l.level * l.housePrice;
  }
  // @source loc_00423a96
  for (const f of allEffectiveFacilities(state, topo)) {
    if (f.owner !== ownerId) continue;
    total += f.level * f.housePrice + f.landPrice;
  }
  return total;
}

// ============================================================
//  绘制
// ============================================================

/** 这一帧要画成什么样 */
export interface MagicDraw {
  view: MagicView;
  /** 这一刻正指着哪个功能（转盘过程中会变）*/
  pointer: number;
  /**
   * 女巫这一帧要不要叠一张「说话」的嘴（原版 `rand()&1`，@source 0x00432ad3）。
   *
   * ★ 2026-09-16 订正：原版这一支叠的是**嘴**（图 5，60×21，落 (0x11e,0xdc)），
   *   不是「把整只女巫换成头部特写」。先前换成图 9/10（142×120 的悬停弹窗框）
   *   ⇒ 女巫被红框盖掉，屏上剩两只空框（B-2 症状③）。
   */
  witchBlink: boolean;
  /**
   * 现在演到第几拍（1 / 2）—— 照原版的状态号切：
   *
   * | beat | 原版状态 | 屏上是什么 |
   * |---|---|---|
   * | 1 | 1..7 | **图 1**（抱水晶球，落 (241,140)）+ 闭眼贴片 + 嘴 + 抽中的**条件图标** |
   * | 2 | 8（点下去之后）| **图 2**（抬手，落 (182,142)，把图 1 整块盖住）+ 条件图标 |
   *
   * @source 0x00432543 / 0x00432791（图 1）· 0x00432f60（图 2）。**两张不同时画**。
   */
  beat: 1 | 2;
  /**
   * 女巫**闭眼**（图 3）要不要画 —— 原版 `loc_00432951` 是**状态 3→4 那一下**
   * 贴的，之后一直在（状态 4 再叠眼睑/嘴）。
   *
   * ⇒ `greet`（入口三句）时为 false；`roll` / `criterion` / `spin` / `hold` 为 true。
   * @source 0x00432951（见 `MAGIC_EYES_AT` 的长注释）
   */
  eyesShut: boolean;
  /** 鼠标正指着的扇区（原版 `[0x48c3a1]`），0 = 不在任何扇区上 */
  hover: number;
  /**
   * 一圈里**这一帧要高亮**的那一格（功能号 0..11）—— `-1` = 不高亮。
   *
   * ★ 原版只贴**悬停的那一格**（`0x00432cbe` 起那一支，状态 7）；其余十一格
   *   本来就画在底图 `#18` 图 0 里，不需要重画。
   *   本模块把**转盘指针**也算进来（那是本引擎给「回放」补的可视化，见 deviations）。
   */
  ring: number;
  /**
   * 入口台詞那一拍：`null` = 不在这一拍；数字 = 正说第几句（`MAGIC_GREET_LINES`）。
   *
   * ★ 台詞期间**只画底图 + 女巫 + 那只字框**（原版这时五芒星还没铺）——
   *   所以 `drawMagicScreen` 见到它就先画「铺场那一拍」再画字框、然后 return。
   */
  greet: number | null;
  /**
   * 这一刻字框里该写什么 —— `null` = 不画字框。
   *
   * ★ 字框（图 8 落 (320,384)）是**开屏那一次**由 `fcn_0044ec30` 设好、整屏期间一直在的，
   *   里面的话随状态换：入口三句 → 抽中的条件名 → `#0040嘿～輪到你了！` →
   *   `#0041天靈靈地靈靈～`。本字段就是「这一拍写哪一句」（`MAGIC_GREET_LINES` 的原文，
   *   带 `#NNNN` 前缀，画的时候由 `magicGreetText` 去掉）。
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

/** 字框里那行字的字号 @source 0x00432dfc `push 0xe` */
export const MAGIC_FONT_SIZE = 0x0e;
/** 字色 / 描边 @source 0x00432df7 `push 0xe0e0e0` / `push 0x202020` */
export const MAGIC_TEXT = { fill: '#e0e0e0', stroke: '#202020' } as const;

const MAGIC_FONT = FONT_FAMILY;

/**
 * 弹窗里那两行字画在哪。
 *
 * @source 原版把功能名写在**弹窗框那一点**：`draw_text(字, x, y, flag 2)`
 *   （VA 0x00432e06 起），而 x/y 取 `[0x47570c/0x475710 + 16×功能号]`，
 *   与弹窗框（图 6/7/9/10 里的某一张）**同点** ⇒ 就是 `magicPopupAt(option)`。
 *
 * ★★ 2026-09-16 订正（外部审查 B-2 症状①）：先前固定用五芒星中心 (320,238)，
 *   而框在 (140,241) 附近 —— 字整个落在框外。**字必须跟着落点的功能走。**
 *   ★ 2026-09 再订正：落点也不是**图标**位置（`magicIconAt`）—— 图标在
 *   `MAGIC_RING_AT` 那十二个中线上（图 0 里就画着），框与字在记录表的 x/y。
 */
export function magicTextAt(option: number): { x: number; y: number } {
  return option >= 0 && option < MAGIC_SECTOR_COUNT ? magicPopupAt(option) : MAGIC_CENTER;
}

/** 两行字之间的行距 */
export const MAGIC_TEXT_LINE_H = 22;

/**
 * **条件图标**的图号基数 @source `loc_00432719` 尾：`lea edx, [eax + 0xb]`
 *   ⇒ 抽中的第 `criterion` 个条件的图 = 图 `criterion + 11`（11..22）。
 *   ⚠️ 是**条件号**（`[0x48c3a3]` = 目标转盘），不是效果号 —— 见
 *   `magicTargetIconChunk` 与 `MAGIC_RESULT_ICON_AT`。
 */
export const MAGIC_RESULT_ICON_BASE = 0x0b;

/**
 * 魔法屋放的三条音效。
 *
 * | 常量 | 号 | 出处 |
 * |---|---|---|
 * | `MAGIC_SOUND_RESULT` | **39 (0x27)** | `_rich4_play_sound_effect(0x27, &0x4757e7)` @source 0x00432e42；`rich4.asm:40970` 的 `ref_004757e7: db 0x27` 是结构首字节 = 音效号 |
 * | `MAGIC_SOUND_HOVER` | 0 | `_rich4_play_sound_effect(0, &0x48231a)` @source 0x00433531（`rich4.asm:50864` `db 0x00`）|
 * | `MAGIC_SOUND_PRESS` | 1 | `_rich4_play_sound_effect(1, &0x482322)` @source 0x0043365c（`rich4.asm:50871` `db 0x01`）|
 *
 * ★ 同一模块还有第 4 号（`&0x482332` @source 0x0043376b，取消那一路）；
 *   本引擎这一屏是**回放**、没有取消动作，故不放。
 *   ⚠️ `T-037.md` 的 D-MAGIC-5 先前写「16」并说「`SOUND_IDS` 里没有这一条」——
 *   两条都不成立：号是 **39**，而 `SOUND_IDS` 只是约十条**已具名**的映射，
 *   不是 `Effect.mkf` 的全集（`assets-clean/manifest.json` 的 Effect 资源是 0..114）。
 */
export const MAGIC_SOUND_RESULT = 0x27;
export const MAGIC_SOUND_HOVER = 0;
export const MAGIC_SOUND_PRESS = 1;

/** 锚点落点绘制 @source `fcn_00456418`（`to_left = x − src->x`）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 哪几张图要**抠掉纯黑**。
 *
 * ★ 原版有两支贴图函数，**逐图挑**，判定只能照调用点抄，不能靠「看黑多不多」：
 *
 * | 函数 | 行为 | @source |
 * |---|---|---|
 * | `fcn_004563f5` | **不透明**拷贝（`rep movsd`，无判断）→ 0x455b3a | 0x004563f5 |
 * | `fcn_00456418` | **抠黑**：源像素 `or ax,ax / je` 为 0 就跳过 → 0x455c52 | 0x00456418 |
 * | `fcn_0045643d` | 带一个矩形参数的拷贝 | 0x0045643d |
 *
 * | 图 | 原版走哪支 | 抠黑 | 出处 |
 * |---|---|---|---|
 * | 0 底图 | `fcn_004563f5` | ✗ | 0x0043253b |
 * | 1 女巫（水晶球） | `fcn_00456418` | ✓ | 0x0043255d / 0x00432791 |
 * | **2 女巫（抬手）** | **`fcn_00456418`** | **✓** | 0x00432f72 |
 * | 3/4/5 脸上的贴片 | `fcn_004563f5`（不透明） | ✗ | 0x004329a7 / 0x00432902 / 0x00432b1a |
 * | 6/7/9/10 锦缎框 | `fcn_00456418` | ✓ | 0x00432de6 |
 * | 8 中央木牌（字框） | `fcn_004563f5` | ✗ | 0x0043253b（`fcn_0044ec30` 里那支）|
 * | **11..22 条件图标** | `fcn_00456418` | ✓ | 0x004327c9 |
 * | **23..34 功能高亮图标** | `fcn_00456418` | ✓ | 0x00432d0e |
 *
 * ⚠️ **图 2 必须抠黑**：它是 284×210、43% 纯黑背景的精灵。
 *   不抠就是一块**盖住右下半个五芒星的黑矩形**（浏览器里已复现）。
 *   本模块第一版那张表漏了 2/9/10 与十二个图标 —— 那是按「哪些像框」猜的，
 *   不是照调用点抄的，现按上表订正。
 *
 * ⚠️ **11..22（条件图标）也必须抠黑** —— 原版那两处（0x004327c9 / 0x00432fab）
 *   走的都是 `fcn_00456418`。先前完全没把它们算进来（那时这一批图被当成
 *   「每个功能两张」里的第一张）。
 *
 * ⚠️ 图 8（中央木牌）走的是**不透明**那支：它只有 2% 黑、且黑都在边角，
 *   抠不抠都看不出差别 —— 这里跟原版一样**不抠**。
 */
export const MAGIC_KEYED = new Set<number>([
  MAGIC_CHUNK.witchIntro,
  MAGIC_CHUNK.witchIdle,
  MAGIC_CHUNK.frame,
  MAGIC_CHUNK.frameAlt,
  // ★ 图 9/10 是**悬停弹窗框**（142×120），不是女巫的头 —— 名字见 `MAGIC_CHUNK`
  MAGIC_CHUNK.hoverFrame,
  MAGIC_CHUNK.hoverFrameAlt,
  // ★ 图 3/4/5 **不进**抠黑表：原版三处贴片（眼睛/合嘴/张嘴）都走
  //   `fcn_004563f5`（**不透明**）：0x004329a7、0x00432902、0x00432b1a。
  //   先前把它们当「文字长条」抠黑，会把脸上的贴片抠出黑洞。
  // 条件图标：图 11..22（`magicTargetIconChunk` 就是这个区间）
  ...Array.from({ length: 12 }, (_, i) => MAGIC_CHUNK.targetIconFirst + i),
  // 功能高亮图标：图 23..34（`magicIconChunk` 就是这个区间）
  ...Array.from({ length: 12 }, (_, i) => MAGIC_CHUNK.ringFirst + i),
]);

/** 一张图要不要抠黑由 `MAGIC_KEYED` 说了算，别在各处手写 */
function magicSprite(sprite: MagicSprite, chunk: number): Sprite | null {
  return sprite('Panel.mkf', MAGIC_RESOURCE, chunk, MAGIC_KEYED.has(chunk));
}

/**
 * 第 `option` 个功能的**高亮**图标 @source 0x00432d0e（`fcn_00456418`，抠黑）。
 * 图 23..34 一张不多一张不少 —— 原版悬停只贴这一张，没有「第二张」。
 */
function magicIconSprite(sprite: MagicSprite, option: number): Sprite | null {
  return magicSprite(sprite, magicIconChunk(option));
}

/** 抽中的第 `criterion` 个条件的图标 @source 0x004327c9（同样是抠黑那支）*/
function magicTargetIconSprite(sprite: MagicSprite, criterion: number): Sprite | null {
  return magicSprite(sprite, magicTargetIconChunk(criterion));
}

/**
 * 台詞串去掉 `#NNNN` 语音前缀后的**可见文字**（`\n` 保留，画的时候拆行）。
 *
 * ★★ 2026-09 **纯函数化**：先前这里顺手 `playVoiceCode(line)`（= 既播又剥），
 *   而 `magicBoxText` 每帧都调它、`drawMagicMessageBox` 又先把结果算一遍
 *   ⇒ 一句台词在 2 秒里被请求 **126 次**（实测），且一次绘制请求 **两遍**。
 *   现在绘制链**只剥不播**；语音改在**换词那一拍**请求一次
 *   （`requestVoiceLine`，见 `magicScreen.event` / `magicScreen.tick`）。
 */
export function magicGreetText(line: string): string {
  return stripVoiceCode(line);
}

/**
 * 同一句台詞**再请求一次**的最小间隔（毫秒）。
 *
 * ★ 只用来兜一件事：`Speaking.mkf` 是 **57 MB 的懒加载档案**（`main.ts` 的
 *   `ensureSpeakingArchive()` 由语音出口第一次被调用时才去 fetch），
 *   所以**进屏那一瞬间**请求的 `#0037` 很可能被 `SoundPlayer` 悄悄丢掉
 *   （档案还没到货）—— 用户报的「第一次进魔法屋没有女巫语音」。
 *   这里按这个间隔**补问一次**（同一句最多问两次：换词那一次 + 一次兜底），
 *   档案到货的那一次就能响。
 *
 * ⚠️ 与 `audio.ts` 的 `VOICE_RETRIGGER_GAP_MS` **同值**（那边是 sink 侧的第二道
 *   闸门：同一句还在响就不重起）。这里不 import 那个模块 —— 整屏不该被拖进
 *   `SoundPlayer` / `MkfaArchive` 的依赖里。
 */
export const MAGIC_VOICE_RETRY_MS = 500;

/** 上一次**真正送进语音出口**的那一句，与那一刻（`null` = 还没送过）*/
let voiceLine: string | null = null;
let voiceAt = 0;
/**
 * 这一句已经问过几次。**最多 `MAGIC_VOICE_MAX_ASKS` 次**：
 * 换词那一次 + 一次兜底（懒加载的 `Speaking.mkf` 可能还没到货）。
 * 不能无限补问 —— 那等于把「每帧请求」换个样子搬回来。
 */
let voiceAsks = 0;

/** 同一句最多请求几次（换词一次 + 兜底一次）*/
export const MAGIC_VOICE_MAX_ASKS = 2;

/**
 * 把「字框里这一拍的话」送进语音出口（`playVoiceCode` 顺手播 `#NNNN`）。
 *
 * 调用点**只有三处**，全在状态推进上：`event`（起播）、`tick`（换词 / 补问）、
 * `down`（跳过开场白）。**绘制链一处都不许调** —— 见 `MAGIC_VOICE_RETRY_MS`。
 *
 * @param now 现在的时刻（`env.now`）—— 同一句按 `MAGIC_VOICE_RETRY_MS` 去抖、
 *   且最多 `MAGIC_VOICE_MAX_ASKS` 次
 * @returns 这一次是否真的发起了请求
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
 * 入口台詞那只字框（`fcn_0044ecb6`）—— 字画在**盒心 +(dx,dy)**、每行正中、
 * 行距 `MAGIC_MSG_LINE_H`，字色/描边由调用方给（本屏是 `#e0e0e0` / `#202020`）。
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
  ctx.font = `${MAGIC_MSG_FONT_SIZE}px ${MAGIC_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = outline;
  ctx.fillStyle = fill;
  lines.forEach((line, i) => {
    const y = cy + (i - (lines.length - 1) / 2) * lineH;
    if (outlineWidth > 0) ctx.strokeText(line, cx, y);
    ctx.fillText(line, cx, y);
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
 * 画整屏。
 *
 * 顺序照原版（`fcn_00432511` 铺场 → `loc_00432719` 抽中条件 → `loc_00432f60` 点下去）：
 * **底图(0) → 悬停弹窗框 → 弹窗里的字 → 女巫（按 beat 二选一）→ 脸上的贴片 →
 * 条件图标 → 一圈里高亮的那一格 → 中央字框**。
 *
 * ★★ 2026-09 按真值重订（玩家报的「2 个女巫 / 排版混乱」）：
 *   ① **两张女巫不同时画**：beat 1 只画图 1（(241,140)），beat 2 只画图 2（(182,142)）。
 *      先前**同一拍画两张**，而且图 1 的 x/y 写反成 (140,241) ⇒ 屏上并排两只女巫。
 *   ② **一圈的图标只在 `d.ring` 那一格画**（图 23..34，落 `MAGIC_RING_AT`）。
 *      其余十一格本来就画在底图里；先前把十二张全画在**弹窗位置**上（散满全屏）。
 *   ③ **条件图标取 `criterion + 11`**（0x004327aa 读的是 `[0x48c3a3]` = 条件号），
 *      落 (326,296)；先前按 `option + 11` 画。
 *   ④ **删掉「第二拍压一张 280×173 结果条」那一笔** —— 那是把 60×18 的合嘴贴片
 *      （图 4，落 (286,220)）误读成图 8，原版没有这张框。
 *   ⑤ beat 2（= 状态 8）**不叠闭眼/嘴的贴片**：图 2 把 (182,142)+(284×210) 整块盖住，
 *      闭眼贴片（画在 (286,188)）在它底下 —— 原版那一拍只贴图 2 + 条件图标。
 *
 * @source `fcn_00432511`（铺场）· `loc_00432719`（女巫 + 条件图标）· `loc_00432951`（闭眼）·
 *   `loc_00432894`（合嘴）· `loc_00432b00`（张嘴）· `loc_00432e8e`/`0x00432f60`（抬手那张）·
 *   `0x00432cbe..0x00432e29`（悬停：高亮图标 + 弹窗框 + 名字）
 */
/**
 * 画那只**一直在**的字框 + 里面这一拍的话（`fcn_0044ec30` 设框、`fcn_0044ecb6` 写字）。
 *
 * @param line `null` = 不画（理论上不会：开屏那一次就把框设好了）
 */
export function drawMagicMessageBox(
  ctx: CanvasRenderingContext2D,
  sprite: MagicSprite,
  line: string | null,
): void {
  if (line === null) return;
  drawAnchored(ctx, magicSprite(sprite, MAGIC_MSG_BOX.chunk), MAGIC_MSG_BOX.x, MAGIC_MSG_BOX.y);
  const box = magicSprite(sprite, MAGIC_MSG_BOX.chunk);
  const cx = MAGIC_MSG_BOX.x - (box?.anchorX ?? 0) + (box?.width ?? 280) / 2 + MAGIC_MSG_BOX.dx;
  const cy = MAGIC_MSG_BOX.y - (box?.anchorY ?? 0) + (box?.height ?? 173) / 2 + MAGIC_MSG_BOX.dy;
  magicBoxText(
    ctx,
    line, // ★ 只剥不播（`magicBoxText` 里那一次 `magicGreetText` 就是唯一的剥）
    cx,
    cy,
    MAGIC_MSG_BOX.fill,
    MAGIC_MSG_BOX.outline,
    MAGIC_MSG_BOX.outlineWidth,
  );
}

export function drawMagicScreen(
  ctx: CanvasRenderingContext2D,
  sprite: MagicSprite,
  d: MagicDraw,
): void {
  drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.bg), MAGIC_BG_AT.x, MAGIC_BG_AT.y);

  // ── 入口台詞那三拍：底图 + **图 1**（抱水晶球）+ 字框（五芒星还没铺）──
  //    @source `loc_00432647`（铺场 `fcn_00432511`）→ `loc_004326b9`（第一句）
  if (d.greet !== null) {
    drawAnchored(
      ctx,
      magicSprite(sprite, MAGIC_CHUNK.witchIntro),
      MAGIC_WITCH_BALL_AT.x,
      MAGIC_WITCH_BALL_AT.y,
    );
    drawMagicMessageBox(ctx, sprite, d.boxLine);
    return;
  }

  const pointerOption = d.pointer >= 0 && d.pointer < MAGIC_SECTOR_COUNT ? d.pointer : -1;
  // 结果落点（回放解不出时退回转盘指针那一格）
  const option = d.view.option >= 0 ? d.view.option : pointerOption;
  // 鼠标指着的那一格（原版 `[0x48c3a1]`）—— 弹窗、字、高亮图都跟着它
  const hoveredOption = optionOfSector(d.hover);

  // ── 弹窗框 + 功能名（**同点**：记录表的 x/y）→ 女巫压在上面 ──
  const popup = hoveredOption ?? option;
  if (popup >= 0) {
    const at = magicFrameAt(popup);
    drawAnchored(ctx, magicSprite(sprite, magicFrameChunk(popup)), at.x, at.y);
    const who = d.view.targets.map((i) => `P${i + 1}`).join(' ');
    const line =
      hoveredOption !== null
        ? (MAGIC_HOUSE_OPTIONS[hoveredOption]?.name ?? '')
        : `${d.view.name}${who === '' ? '' : ` → ${who}`}`;
    if (line !== '') magicText(ctx, line, at.x, at.y, MAGIC_FONT_SIZE + 3);
    if (hoveredOption === null && d.view.criterionName !== '') {
      magicText(ctx, d.view.criterionName, at.x, at.y + MAGIC_TEXT_LINE_H, MAGIC_FONT_SIZE);
    }
  }

  // ── 女巫：beat 1 = 图 1 在 (241,140)；beat 2 = 图 2 在 (182,142)（它把图 1 盖住）──
  if (d.beat === 2) {
    drawAnchored(
      ctx,
      magicSprite(sprite, MAGIC_CHUNK.witchIdle),
      MAGIC_WITCH_HAND_AT.x,
      MAGIC_WITCH_HAND_AT.y,
    );
  } else {
    drawAnchored(
      ctx,
      magicSprite(sprite, MAGIC_CHUNK.witchIntro),
      MAGIC_WITCH_BALL_AT.x,
      MAGIC_WITCH_BALL_AT.y,
    );
    // ★ **闭眼**贴片（图 3，60×35）—— 原版**状态 3→4 那一下**贴的，之后一直在。
    //   入口三句那几拍还没有（`greet` 那一路上面就 return 了），beat 2 被图 2 盖住。
    if (d.eyesShut) {
      drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.eyesShut), MAGIC_EYES_AT.x, MAGIC_EYES_AT.y);
    }
    // 「说话」那一拍叠一张嘴（图 5，60×21）—— 不是换整只女巫
    if (d.witchBlink) {
      drawAnchored(ctx, magicSprite(sprite, MAGIC_CHUNK.mouthTalk), MAGIC_MOUTH_AT.x, MAGIC_MOUTH_AT.y);
    }
  }

  // ── 抽中的**条件**图标：图 `criterion + 11` 落 (326,296) ──
  if (d.view.criterion >= 0 && d.view.criterion < MAGIC_TARGET_NAMES.length) {
    drawAnchored(
      ctx,
      magicTargetIconSprite(sprite, d.view.criterion),
      MAGIC_RESULT_ICON_AT.x,
      MAGIC_RESULT_ICON_AT.y,
    );
  }

  // ── 一圈里**高亮**的那一格（原版只贴这一张；其余十一格在底图里）──
  if (d.ring >= 0 && d.ring < MAGIC_SECTOR_COUNT) {
    const at = magicIconAt(d.ring);
    const s = magicIconSprite(sprite, d.ring);
    drawAnchored(ctx, s, at.x, at.y);
    // ★ 兜底：高亮图取不到（离线 / HD 缺图）才描一圈，否则「指到谁」看不出
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

  // ★ 字框整屏一直在（原版 `fcn_0044ec30` 开屏设好之后没关过）
  drawMagicMessageBox(ctx, sprite, d.boxLine);
}

// ============================================================
//  屏幕本体
// ============================================================

/** 现在正在播的那一段；`null` = 没在播 */
let playback: MagicPlayback | null = null;
/** 这一次回放的落点（解不出时 = -1）*/
let view: MagicView | null = null;
/** 鼠标现在指着的扇区（原版 `[0x48c3a1]`）*/
let hover = 0;

/**
 * 调试 / 单测用：把整屏关掉（`playback` 是模块级的，跨用例会残留）。
 * 与 `resetStealPicker` / `resetEventBoxArt` 同一手法。
 */
export function resetMagicScreen(): void {
  playback = null;
  view = null;
  hover = 0;
  voiceLine = null;
  voiceAt = 0;
  voiceAsks = 0;
}

export const magicScreen: UiScreen = {
  id: 'magic',

  /** 演出期间接管整屏；播完自己关 @source 原版是 `[0x48c3a2] == 8` 就退出 */
  active: () => playback !== null,

  draw(env: UiScreenEnv): void {
    const v = view;
    if (v === null) return;
    const pointer = playback?.spin.option ?? v.option;
    const witchBlink = Math.random() < MAGIC_WITCH_BLINK_P;
    // ★ 转盘还在转 = 第一拍；进了 hold = 第二拍（图 2 抬手那张 ＋ 条件图标）
    const beat: 1 | 2 = playback !== null && playback.phase === 'hold' ? 2 : 1;
    const phase = playback?.phase ?? null;
    const greet = playback !== null && phase === 'greet' ? playback.greet : null;
    // ★ 字框整屏一直在（`fcn_0044ec30` 开屏设好），里面的话按状态换：
    //   greet 三句 → 抽中的条件名 → `#0040` → `#0041`（见 `MagicPhase` 那张表）
    const boxLine = playback === null ? null : magicBoxLineFor(playback);
    // ★ 一圈里高亮哪一格：鼠标指着的那一格优先（原版状态 7 的行为），
    //   没有鼠标（回放）时跟着**转盘指针**走 —— 那是本引擎给回放补的可视化，
    //   原版状态 6/7 不画转盘，见 deviations T-037 的 D-MAGIC-*。
    const hoveredOption = optionOfSector(hover);
    const ring =
      hoveredOption ?? (playback !== null && phase === 'spin' && pointer >= 0 ? pointer : -1);
    drawMagicScreen(env.stage, env.sprite, {
      view: v,
      pointer,
      witchBlink,
      beat,
      // 闭眼：过了入口三句才有（`greet` 段原版还在入口，状态 3 才贴）
      eyesShut: playback !== null && playback.phase !== 'greet',
      hover,
      ring,
      greet,
      boxLine,
    });
  },

  /**
   * 鼠标移动 —— 原版 `WM_MOUSEMOVE (0x200)` 那一支（VA 0x00432b50 → 0x00432cbe）：
   * 查命中表拿到扇区、贴该格的**高亮图**、在记录表的 x/y 上开弹窗写功能名、响一声。
   *
   * ★ 契约（`ui-screen.ts` 第 23 行）说「要重画就自己 `env.requestRender()`」——
   *   先前这里**没叫**，而 `main.ts` 的 mousemove 对整屏 overlay 是
   *   `overlay.move?.(…)` 之后**直接 return**（不重画）⇒ 悬停高亮要么不出现、
   *   要么等下一次 tick 才被顺带刷出来（「点不动/没反应」的一部分）。
   */
  move(x: number, y: number, env: UiScreenEnv): void {
    const next = sectorAt(x, y);
    if (next === hover) return;
    // 指到功能上响一声 @source `_rich4_play_sound_effect(0, &0x48231a)` 0x00433531
    if (optionOfSector(next) !== null) env.playEffect(MAGIC_SOUND_HOVER);
    hover = next;
    env.requestRender();
  },

  /**
   * 鼠标按下 —— 原版 `WM_LBUTTONDOWN (0x201)`（VA 0x00432e8e）：
   *
   * | 状态 | 原版做什么 |
   * |---|---|
   * | `< 3`（入口三句还在说）| `[0x48c3a2] = 3` + `fcn_0044ee18(1)` —— **跳过那几句**（0x00432e71）|
   * | `!= 7`（正在摇签/转）| 什么都不做（0x00432e9c `jne 0x4326ad`）|
   * | `== 7` 且点在 1..12 | 贴**图 2（抬手）**+ 条件图标，写 `#0041天靈靈地靈靈～`，进状态 8（0x00432f60 起）|
   * | `== 7` 且点在 13（中央）| 把**抽中的条件名**再写进字框（0x00432ff7）|
   *
   * ⚠️ **先前整个 `down()` 在演出期间一句 `return`** —— 这一屏活着的每一刻都在演出，
   *   于是**每一次点击都被吞掉**（玩家报的「一圈…无法点击」）。现在照上表分流。
   */
  down(x: number, y: number, env: UiScreenEnv): void {
    const sector = sectorAt(x, y);
    const option = optionOfSector(sector);

    // ── 入口三句还在说：点一下就跳过（原版状态 < 3 那一支）──
    if (playback !== null && playback.phase === 'greet') {
      playback = { ...playback, phase: 'roll', rollAt: env.now };
      // 跳過之後字框里那句仍是入口最后一句 —— 与换词同一处理
      requestVoiceLine(magicBoxLineFor(playback), env.now);
      env.log('魔法屋：跳過開場台詞');
      env.requestRender();
      return;
    }

    // ── 点在中央那块（13）：把抽中的条件名再写一次 ──
    if (sector === MAGIC_HIT_CENTER) {
      hover = sector;
      env.log(`魔法屋：條件 ${view?.criterionName ?? ''}`);
      env.requestRender();
      return;
    }

    if (option === null) return; // 命中 0：什么都不做 @source 0x00432ea7

    // 按下这一拍也响一声 @source `_rich4_play_sound_effect(1, &0x482322)` 0x0043365c
    env.playEffect(MAGIC_SOUND_PRESS);
    hover = sector;
    env.log(`魔法屋：選定 ${sector}（${MAGIC_HOUSE_OPTIONS[option]?.name ?? ''}）`);
    // ★ 状态 7 → 8：抬手那张女巫 + 条件图标 + `#0041`
    //   （@source 0x00432fdc `mov byte [0x48c3a2], 8`）。回放期间就是「把剩下的转盘跳过」。
    if (playback !== null && playback.phase !== 'hold') {
      playback = {
        ...playback,
        phase: 'hold',
        holdAt: env.now,
        spin: { ...playback.spin, option: playback.target, step: magicSpinSteps() },
      };
    }
    env.requestRender();
  },

  tick(env: UiScreenEnv): void {
    if (playback === null) return;
    const wasSpinning = playback.phase === 'spin';
    const next = magicPlaybackTick(playback, env.now);
    if (next === null) {
      playback = null;
      view = null;
      hover = 0;
      voiceLine = null; // 屏关了 —— 下次进屏同一句要能重新请求
      voiceAsks = 0;
      env.log('魔法屋：回放结束');
      env.requestRender();
      return;
    }
    // ★★ 语音就在**这里**请求（状态推进处，整屏唯一的一处）：换词立刻请求；
    //    同一句按 `MAGIC_VOICE_RETRY_MS` 最多补问一次 —— 兜 `Speaking.mkf` 的懒加载。
    //    ⚠️ 绘制链**一处都不许**调 `playVoiceCode`（先前挂在那里，每帧一次）。
    requestVoiceLine(magicBoxLineFor(next), env.now);
    // ★ 转盘停下来的那一下：放**结果音**。
    //   @source `_rich4_play_sound_effect(0x27, &0x4757e7)`（VA 0x00432e42）——
    //   `[0x4757e7]` 的首字节 = 0x27 = **39**（`rich4.asm:40970`）。
    //   ⚠️ 先前 T-037 的 D-MAGIC-5 写「16」是错的，见该文件的订正。
    if (wasSpinning && next.phase === 'hold') {
      env.playEffect(MAGIC_SOUND_RESULT);
      env.requestRender();
      playback = next;
      return;
    }
    const prevOption = playback.spin.option;
    const prevPhase = playback.phase;
    const prevGreet = playback.greet;
    playback = next;
    // ★ 台詞那一拍：**每帧都要续帧**（它是按 `MAGIC_GREET_MS` 计时的，
    //   不续帧就没人再叫 `tick`，三句永远说不完）。
    if (next.phase === 'greet') {
      if (next.greet !== prevGreet) env.log(`魔法屋：台詞 ${next.greet + 1}/${MAGIC_GREET_LINES.length}`);
      env.requestRender();
      return;
    }
    // ★ 换了一位、或刚进 `hold`：画面变了要重画。
    //   转盘「还在等下一位」的那几帧没有变化，不续帧；`hold` 期间要续帧，
    //   否则 `tick` 不再被调用，屏就永远关不掉了。
    if (next.spin.option !== prevOption || next.phase !== prevPhase) {
      env.requestRender();
    } else if (next.phase === 'hold') {
      env.requestRender();
    }
  },

  /**
   * 察觉「刚刚落了一次魔法屋」。
   *
   * ★ 触发判据分两步（都纯查状态）：① `before` 里触发者正站在魔法屋上；
   *   ② `before → after` 的玩家字段能被某一组（目标条件 × 效果）解释。
   *   第 ② 步解不出也照样起播 —— 只显示转盘、不显示落点文字，
   *   免得漏掉一次演出。这条近似记在 `docs/deviations/T-037.md`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return; // 上一段还没播完
    if (before === after) return;
    // ★ 优先用 **core 交出来的那一趟**（`lastEvent.kind === 'magicHouse'`）：
    //   条件号/名单是抽出来的，反推只是替补（旧存档 / 少字段的回放）。
    const ev = after.lastEvent;
    const direct =
      ev !== null && ev.kind === 'magicHouse' ? magicViewOfSpin(ev, after.currentPlayer) : null;
    const v = direct ?? magicView(before, after, env.topo);
    if (v === null) return;
    view = v;
    const target = v.option >= 0 ? v.option : 0;
    // ★ 入口台詞归「動畫過程」管：@source `loc_004326b9`（VA 0x004326b9）
    //   `cmp byte [0x48c3a5], 0 / jne loc_00432e82` —— 关掉时**直接跳过消息框**
    //   （`[0x48c3a5] = !anim`，见 `Q-ANIM-1.md` 与 `T-037.md` 的 D-MAGIC-12）。
    playback = magicPlaybackStart(target, env.now, env.animation !== false, v.criterionName);
    // ★ 進屏那一刻就把第一句送出去：`playVoiceCode` 会经 `main.ts` 的语音出口
    //   顺手 `ensureSpeakingArchive()`（= 预载 57MB 的 `Speaking.mkf`）。
    //   档案到货前的请求会按 `MAGIC_VOICE_RETRY_MS` 由 `tick` 补问，见 `requestVoiceLine`。
    requestVoiceLine(magicBoxLineFor(playback), env.now);
    // ★ 進魔法屋的配乐 @source `magic_house.asm:2269` / `:2512` `push 7 / call fcn_004549cf`
    //   ⇒ id 7 → `MIDI08.MID` → 磁盘名 `midi08.mid`（见 `SCREEN_BGM.magicHouse`）
    env.music?.('midi08.mid');
    env.log(`魔法屋：${v.name === '' ? '（落点未解出）' : v.name}`);
    env.requestRender();
  },
};

/**
 * 给单测 / 自动化用的只读视图（`active()` 之外的状态）。
 *
 * ★ 2026-09 加 `phase` / `pointer` / `ring`：浏览器里验收「每一项都能点」时，
 *   要点完看得到状态推进（`pointer` / `phase` 变了、`hover` 落在那一格）。
 */
export function magicScreenState(): {
  playing: boolean;
  view: MagicView | null;
  hover: number;
  phase: MagicPhase | null;
  pointer: number;
  ring: number;
} {
  const hoveredOption = optionOfSector(hover);
  const pointer = playback?.spin.option ?? view?.option ?? -1;
  const ring =
    hoveredOption ??
    (playback !== null && playback.phase === 'spin' && pointer >= 0 ? pointer : -1);
  return { playing: playback !== null, view, hover, phase: playback?.phase ?? null, pointer, ring };
}
