/*
 * 事件提示框屏（新聞 / 命運 / 抽卡）—— T-041 附帶 / MOD-12
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么有这一屏：落在特殊格上时 core 已经把状态写对了 ——
 *   新聞/命運写 `state.lastEvent = { kind, id }`（`reduce.ts` 的
 *   `drawAndApplyNews` / `drawAndApplyFortune`）、卡片格往 `player.cards` 里
 *   `push(cardDrawn)`（`reduce.ts` 的 `settleSpecialSquare` 分支）——
 *   但**客户端从前一帧都不读 `lastEvent`**，也没有任何东西看手牌长没长。
 *   于是 新聞 / 命運 / 卡片 三格落地时画面上什么都不出。
 *
 * ## 三段的出处
 *
 * ### 新聞 `fcn_0044b6df`（VA 0x0044b6df，`rich4_news.asm:3451`）
 *
 * ```asm
 * 0044b6ea  push 0x42                          ; read_mkf(Panel.mkf, 0x42=66, 0, 0)
 * 0044b6fb  mov [0x48c5ac], eax                ; 面板指针存全局
 * 0044b704  push 0xfb / push 0x184             ; fcn_00451a5a(0x184, 0xfb, 0, 0)
 *                                              ;   = allocate_graph_st(388, 251)
 * 0044b75a  lea edi, [ebx + 0x1b9]             ; 插画资源 = newsId + 0x1b9
 * 0044b768  read_mkf(Data.mkf, edi, [esi+8], 0)
 * 0044b770  push 0x2c / push 0x19              ; fcn_00456280(图0, 插画, x=25, y=44)
 * 0044b77b  add edi, 0xc                       ; ★ 目标面 = 图 0
 * 0044b790  push 0 / 8 / 0x18 / <标题>         ; rich4_draw_text(图0, 标题, 24, 8, flag 0)
 * 0044b796  movzx edi, byte [ebx + 0x475eb4]   ; 标题下标表
 * 0044b7bd  call [0x475e24 + newsId*4]         ; 该事件的绘制/效果函数
 * 0044b800  fcn_004563f5(主表面, 图0, 0, 0)    ; 整窗 (0,0)-(440,480) 贴上屏
 * 0044b862  push 0x960 / call 0x4544f6         ; 等 2400ms（可跳过）
 * ```
 *
 * - 标题 = 串表 `0x475ed8` 的第 `NEWS_TITLE_INDEX[newsId]` 条
 *   （下标表 `0x475eb4`，36 字节）；六条串在 `0x4653ec` 起，见 `NEWS_TITLES`。
 * - **逐事件的说明文字**不在这个函数里：它由**该事件自己的处理函数**画，
 *   落点一律 `(0x18, 0x136) = (24, 310)`，串就是 `@rich4/data` 的
 *   `newsEvent(id).text`（例：`fcn_00448eca` 的 `push 0x136 / push 0x18 /
 *   push 0x465424`，`rich4_news.asm:89`）。
 * - `fcn_004544f6`（VA 0x004544f6，`rich4_sound_effect.asm:915`）是**可跳过**的等待：
 *   每轮 `PeekMessage` 看到 `0x202`（左键抬起）/ `0x205`（右键抬起）/
 *   `0x101`（按键）就提前返回；末尾把**剩余时间**再交给 `fcn_004528b9`
 *   （`004545a8 push edx / 004545a9 call 0x4528b9`），后者也认这三种消息。
 *
 * ### ★ `fcn_004528b9` **不是**死等 —— 它认 `0x202`/`0x205`/`0x101`
 *     （2026-09-19 按 `escalations.md` E-5 订正）
 *
 * 旧注释把 `fcn_004528b9` 写成「死等、**不认消息**」——**与汇编不符**。
 * 它自己的 `PeekMessageA` 循环（VA 0x004528b9；时间 = `timeGetTime` `[0x46246c]`、
 * 消息 = `PeekMessageA` `[0x46230c]`，两者均由 IAT 名核对）在 `0x004528e5` 起每轮：
 *
 * ```asm
 * 00452901  cmp edx, 0x202 / je 0x452919   ; WM_LBUTTONUP
 * 00452909  cmp edx, 0x205 / je 0x452919   ; WM_RBUTTONUP
 * 00452911  cmp edx, 0x101 / jne 0x45291e  ; WM_KEYDOWN
 * 00452919  mov ebx, 1                     ; ★ 置「跳过」
 * 00452934  cmp esi, ebp / jae 0x45293c    ; 等满时长也退出
 * 00452938  test ebx, ebx / je 0x4528da    ; 没被跳过就接着等
 * 0045293c  mov eax, ebx                   ; 返回值 = 是否被跳过
 * ```
 *
 * ⇒ 三种消息都能提前结束等待。函数**返回**「有没有被跳过」（`0x0045293c`），
 * 而本屏那两处调用点（`0x0044dd80` / `0x004420ab`）都是 `add esp,4` 把返回值丢掉
 * —— 跳过唯一的后果就是**不等满、直接往下走**（后面的收尾、清理照跑），
 * 所以引擎侧把「跳过」映射成「推进一段 / 关屏」。
 * 全 exe 只有 `0x00451a41 test eax,eax / je` 一处真的用返回值（那是另一支
 * 16 帧动画的循环出口，与本屏无关）。
 *
 * | 段 | 等待/播放函数 | VA | 认 `0x202/0x205/0x101`？ |
 * |---|---|---|---|
 * | 新聞 2400ms | `fcn_004544f6(0x960)` | 0x0044b867 → 0x004544f6 | ✅ |
 * | 命運第一段 1600ms | `fcn_004544f6(0x640)` | 0x0044dd49 → 0x004544f6 | ✅ |
 * | 命運第二段 800ms | `fcn_004528b9(0x320)` | 0x0044dd80 → 0x004528b9 | ✅ |
 * | 抽卡亮牌 1500ms | `fcn_004528b9(0x5dc)` | 0x004420ab → 0x004528b9 | ✅ |
 * | **抽卡第一段 FLIC** | **`fcn_0045144f`**（影片播放，不是等待）| 0x0041b32b → 0x0045144f | ❌ **闸门关着**（见下） |
 *
 * ### 抽卡 FLIC 那一段**点不掉**（`fcn_0045144f`，VA 0x0045144f）
 *
 * `fcn_0045144f` 的 `PeekMessageA` 循环外面有一道闸：
 * `0x004514d6 cmp byte [0x48c880], 0 / je 0x4514fd` —— 闸值为 0 时**整段消息检查被跳过**，
 * 跳过标志永远不置位。而 `[0x48c880]` = `flags & 2`：
 * `0x00450d95 and al, 2 / 0x00450d97 mov [0x48c880], al`，
 * 其中 `flags` 是 `fcn_0045144f` 的第 4 个参数
 * （`fcn_00450ced(img, x, y, flags)`，`0x0045146c call 0x450ced`）。
 * 抽卡这一处的实参是 **1**（`0x0041b31e 6a 01`，逐字节核过）⇒ `1 & 2 = 0`
 * ⇒ **这段影片原版就不吃点击/按键**，与 `confine-fx.ts` / `alien-news-fx.ts`
 * 那几段 `flags` bit1 = 0 的影片同一条规矩（见 `board-film.ts` 的 `boardFilmSkippable`）。
 *
 * ### 命運 `fcn_0044db81`（VA 0x0044db81，`rich4_fortune.asm:2529`）
 *
 * 与新聞同一套，只有三处不同：
 *
 * ```asm
 * 0044dc32  add eax, 0x18                     ; 外框用**图 1**（不是图 0）
 * 0044dc11  movsx eax, word [eax*2 + 0x475fb4] ; 插画资源 = word 表 0x475fb4[id]
 * 0044dc28  push 0x2c / push 0x19             ; 插画同样落 (25,44)
 * 0044dcf6  fcn_004563f5(主表面, 图1, 0, 0)   ; 整窗贴上屏
 * 0044dd44  push 0x640 / call 0x4544f6        ; 等 1600ms（可跳过）
 * 0044dd7b  push 0x320 / call 0x4528b9        ; 再等 800ms（**也可跳过**，见上）
 * ```
 *
 * - 说明文字同样由事件处理函数画，但落点是 `(0x18, 0x14a) = (24, 330)`
 *   （例：`fcn_0044be16` 的 `push 0x14a / push 0x18 / push 0x465915`，
 *   `rich4_fortune.asm:122`）—— **不是新聞那个 310**。
 * - 表 `0x475fb4` 是 **word** 表（值 `0x1dd..0x204`），引擎侧等价于
 *   `0x1dd + id`；本模块按后者取（表里那段就是连续的）。
 * - 命運用**两段**等待：`0x640`（1600，`fcn_004544f6`，可跳过）之后事件处理函数以 arg=1
 *   再跑一次（施加效果），然后 `0x320`（800，`fcn_004528b9`，**同样可跳过**）。
 *   跳过第一段 ⇒ 立刻进第二段（原版第二段是新起的一次等待，时长重新数）；
 *   跳过第二段 ⇒ 这一段演出就结束（原版接着跑 `0x0044dd8f` 的收尾）。
 *
 * ### 抽卡 `loc_0041b302`（`rich4_player_core_actions.asm:2501`）+ `fcn_00441f73`
 *
 * ```asm
 * ; —— 第一段：卡片出现动画 ——
 * 0041b306  push 0x218                                  ; read_mkf(Data.mkf, 0x218, 0, 0)
 * 0041b31c  push 0x63 / 1 / 0xb4 / 0xd0                 ; fcn_0045144f(img, 0xd0, 0xb4, 1, 0x63)
 *                                                       ;   flags=1 ⇒ [0x48c880]=0 ⇒ 点不掉
 * 0041b32b  call 0x45144f                               ;   在 (208,180) 播这段 FLIC
 * ; —— 第二段：亮牌 ——
 * 00441f91  create_font(0x10, 0xf0f0f0, 0x101010, 1, 3)
 * 00441fb1  add eax, 0x23a                              ; 卡面 = Data[卡号 + 0x23a]
 * 0044200a  fcn_00456418(表面, Data#517 图5, 0xdc, 0x81) ; 对话框皮落 (220,129)
 * 0044202b  rich4_draw_text(表面, 卡名, 0xdc, 0x81, 4)   ; flag 4 = 正中
 * 00442046  fcn_004563f5(表面, 卡面, 0x8a, 0xc8)         ; 卡面落 (138,200)
 * 00442097  rich4_play_sound_effect(0x482402)
 * 004420a6  push 0x5dc / call 0x4528b9                  ; 等 1500ms（**也可跳过**）
 * ```
 *
 * 抽卡这两段**各有各的**等待/播放函数，可跳过性**不一样**：
 *
 * - 第一段 FLIC 走 **`fcn_0045144f`（VA 0x0045144f）**，不是上面那两个 `fcn_004544f6` /
 *   `fcn_004528b9`。它虽然也有一套 `PeekMessageA` 循环（`0x004514cf`，
 *   `0x004514e3/0x004514ea/0x004514f1` 认 `0x202`/`0x205`/`0x101`），
 *   但整段检查被 `0x004514d6 cmp byte [0x48c880],0 / je 0x4514fd` 闸住，
 *   而这一处的 `flags = 1`（`0x0041b31e 6a 01`）⇒ `[0x48c880] = 1 & 2 = 0`
 *   ⇒ **这段影片点不掉/按不掉**（照原版，不是缺漏）。
 *   影片自己走完（帧数 × 每帧时长，见 `Data#0x218` 的头部）才进亮牌。
 * - 第二段亮牌 1500ms 走 `fcn_004528b9(0x5dc)`（`0x004420a6`），**可跳过**；
 *   返回值被 `0x004420b0 add esp,4` 丢掉，跳过之后直接跑 `0x004420b3` 起的收尾。
 *
 * ## 素材：插画与卡面是**无头 RGB555**，`sprite()` 取不到
 *
 * | 素材 | 资源 | 字节 | 尺寸 | @source |
 * |---|---|---|---|---|
 * | 新聞插画 | `Data.mkf` `id + 0x1b9`（441..476）| 194776 | 388×251 | 0x0044b75a |
 * | 命運插画 | `Data.mkf` `id + 0x1dd`（477..513）| 194776 | 388×251 | 0x0044dc11 |
 * | 抽卡卡面 | `Data.mkf` `卡号 + 0x23a`（571..600）| 84480 | **165×256** | 0x00441fb1 + 图头模板 `0x441204`（`w=0x00a5`/`h=0x0100`，见 `CARD_FACE_SIZE`）|
 *
 * 这三族**没有 SPR/SMP 头**（`assets-clean/manifest.json` 把它们记在 `raw` 下、
 * `signature: "bin"`），而 `env.sprite()` 走 `SpriteCache` → `parseSpriteSheet()`，
 * 后者看到签名不是 `SPR`/`SMP` 就返回 `null` ⇒ **永远取不到**。
 * 所以本模块照 `minigame-bg.ts` 的同一条路子，自己拿 `LoadedArchives`
 * 走 `assets.ts` 的 `loadRaw555Resource()`（= `readRaw555Resource` 的异步版），
 * 由一个模块级的小图槽缓存解好的位图 —— 这就是 `setEventBoxArchives()` /
 * `onEventBoxArtReady()` 两个出口的来由（`main.ts` 在 `boot()` 里各接一行）。
 *
 * ## 触发（纯查状态，不读也不写 `GameState`）
 *
 * ① `after.lastEvent` 非空、且与 `before.lastEvent` 的 `kind`/`id` 不同
 *    → 起新聞/命運那一段（`id` 直接就是事件号，但以 `after` 为准）；
 * ② 否则任一玩家的 `cards` 变长 → 起抽卡那一段（新牌取差集里多出来的那张）。
 * 正在播时**不起新的**（与 `magic-screen.ts` / `monthly-screen.ts` 同一条规矩）。
 *
 * ⚠️ 抽卡与魔法屋的「得一張卡片」会从**同一次 action** 各起一段：
 *   `screens.ts` 里本屏排在 `magicScreen` **之后**，故那一次由魔法屋屏接管
 *   （本屏那一段照跑但排不到画面，见 `docs/deviations/T-041.md`）。
 *
 * ## 对齐 / 颜色
 *
 * `rich4_draw_text` 的 flag 是**对齐方式**（跳表 `0x44faa0`，
 * 见 `hud.ts` 的注释）：`0` 左上、`1` 右上、`2/3/4` 正中、`6` 右中。
 * 本屏只用到 `0`（新聞标题/说明）与 `4`（卡名正中）。
 * `create_font(size, 填充色, 阴影色, flags, 字距)`（VA 0x0044f9d8，
 * 前两个 dword 分别存 `[0x4762e0]`/`[0x4762e4]`，前者是主字色、后者是阴影），
 * 于是三段字分别是：
 *
 * | 是哪段字 | 字号 | 填充 | 阴影 | @source |
 * |---|---|---|---|---|
 * | 新聞标题 / 新聞说明 / 命運说明 | 0x1c(28) | `#f0f0f0` | `#101010` | 0x0044b75c / 0x0044dba4 |
 * | 抽卡卡名 | 0x10(16) | `#f0f0f0` | `#101010` | 0x00441f94 |
 */

import { CARDS,
  CHARACTERS,
  fortuneEvent,
  newsEvent,
  type EventEntry } from '@rich4/data';
import type { GameState } from '@rich4/core';
import {
  loadRaw555Resource,
  type ArchiveName,
  type LoadedArchives,
  type LoadedFlic,
  type Sprite,
} from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import { portraitResource } from './assets.ts';
import { DIALOG_SKIN_IMAGE, DIALOG_SKIN_RESOURCE } from './gameui.ts';
import type { UiScreen, UiScreenEnv,
  UiKeyEvent,
} from './ui-screen.ts';
import { playVoiceCode } from './voice-sink.ts';
import { drawSprite } from './hd-stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type EventBoxSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/**
 * 取一张**无头 RGB555** 图（尺寸由调用方给定，与原版那三处
 * `allocate_graph_st + read_mkf` 一一对应）。取不到返回 `null`。
 */
export type EventBoxRaw = (
  archive: ArchiveName,
  resource: number,
  width: number,
  height: number,
) => Sprite | null;

// ============================================================
//  常量（全部带 VA）
// ============================================================

/** 外框 = `Panel.mkf` **#66** @source 0x0044b6ea / 0x0044db8c `push 0x42` */
export const EVENT_PANEL_RESOURCE = 0x42;

/** 新聞外框 = 图 0 @source 0x0044b77b `add edi, 0xc` */
export const EVENT_NEWS_FRAME = 0;
/** 命運外框 = 图 1 @source 0x0044dc32 `add eax, 0x18`（0x18 = 0xc + 12）*/
export const EVENT_FORTUNE_FRAME = 1;

/** 插画是 388×251 的无头 RGB555 @source 0x0044b704 `fcn_00451a5a(0x184,0xfb,0,0)` */
export const EVENT_ART_SIZE = { w: 0x184, h: 0xfb } as const;
/** 插画落点 (25,44) @source 0x0044b770 / 0x0044dc28 `push 0x2c / push 0x19` */
export const EVENT_ART_AT = { x: 0x19, y: 0x2c } as const;

/** 新聞插画资源基址 @source 0x0044b75a `lea edi, [ebx + 0x1b9]` */
export const NEWS_ART_BASE = 0x1b9;
/**
 * 命運插画资源基址 @source 0x0044dc11 `movsx eax, word [eax*2 + 0x475fb4]`
 *
 * ⚠️ 表 `0x475fb4` **不是**严格的 `0x1dd + id`：`tools/disasm.py dump 0x475fb4 40 2`
 *   读出来前 37 项是
 *   `477..496, 497,497,497, 498,498, 499,500,501,501,501, 502..508`
 *   —— id 20/21/22 与 23/24 与 27/28/29 **共用同一张图**，且 id ≥ 0x21 走的是
 *   另一支（`cmp ebp, 0x21 / jge 0x44dc4d`，用 `[0x4991b8]` 当行偏移再查一次表）。
 *   本模块按任务书给的等价式 `0x1dd + id` 取（id 0..19 与表完全一致），
 *   见 `docs/deviations/T-041.md` 的 D-EVENT-6。
 */
export const FORTUNE_ART_BASE = 0x1dd;

/** 新聞标题落点 (24,8) @source 0x0044b790 `push 0 / 8 / 0x18` */
export const NEWS_TITLE_AT = { x: 0x18, y: 8 } as const;
/** 新聞说明落点 (24,310) @source 例 `fcn_00448eca` 的 0x00448ed5 `push 0x136 / push 0x18` */
export const NEWS_TEXT_AT = { x: 0x18, y: 0x136 } as const;

/**
 * 新聞百分比类那四条（11/12/13/23）的**逐人明细行**：左上角与行距。
 *
 * @source `rich4_news.asm` 那四支函数（`:1293` / `:1407` / `:2043` 等）都是
 *   `mov edi, 0x15a` 起、每画一行 `add edi, 0x20`；行文字用
 *   `_rich4_draw_text(框表面, 串, x=0x18, y=edi, flag=0)` ⇒ 左上角对齐。
 *   格式串 `0x465592` = **`%s繳交%d元`**（`%s` = 角色名，`%d` = 金额，
 *   `%d` 是十进制原样、**不带千分位**）。
 */
export const NEWS_SHARE_AT = { x: 0x18, y: 0x15a } as const;
/** 逐人明细的行距 @source 同上 `add edi, 0x20` */
export const NEWS_SHARE_PITCH = 0x20;

/** 一行明细的文本 @source 格式串 `0x465592` = `%s繳交%d元` */
export function newsShareLine(name: string, amount: number): string {
  return `${name}繳交${amount}元`;
}

/**
 * 明细行左侧的**角色头像**：`(x, 行 y + dy)`。
 *
 * @source 四支函数里紧跟着 `draw_text` 的那一句：
 *   `fcn_004562a5(框表面, [0x498eb0 + 玩家×0x34] + 0x30, x=0x186, y=edi+0xc)`。
 *   `[0x498eb0 + p*0x34]` 是 **`map.mkf` 资源 `角色 + 0x1b`**（`rich4_load_map.asm:495-506`
 *   开局按角色 `read_mkf` 一次，见 `assets.ts` 的 `portraitResource`）；
 *   `+0x30` = `0xc + 12×3` ⇒ **图 3**（图 N 的记录在 `+0xc+12N`，与 T-041 那条换算同源）。
 *   `fcn_004562a5` → `draw_non_zero_image_in_rect` ⇒ **抠黑**（与 `fcn_004563f5`
 *   那个不透明版本相对，见 `rich4_drawing_utils2.asm:186` / `:338`）。
 */
export const NEWS_SHARE_PORTRAIT_X = 0x186;
/** 头像相对本行文字顶端的 y 偏移 @source 同上 `lea eax,[edi+0xc]` */
export const NEWS_SHARE_PORTRAIT_DY = 0xc;
/** 头像取角色头像表的第几张 @source `+0x30` = `0xc + 12×3` ⇒ 图 3 */
export const NEWS_SHARE_PORTRAIT_IMAGE = 3;
/** 命運说明落点 (24,330) @source 例 `fcn_0044be16` 的 0x0044c132 `push 0x14a / push 0x18` */
export const FORTUNE_TEXT_AT = { x: 0x18, y: 0x14a } as const;

/** 新聞等待 0x960 = 2400ms（可跳过，`fcn_004544f6`）@source 0x0044b862 */
export const NEWS_HOLD_MS = 0x960;
/** 命運第一段等待 0x640 = 1600ms（可跳过，`fcn_004544f6`）@source 0x0044dd44 */
export const FORTUNE_HOLD_MS = 0x640;
/** 命運第二段等待 0x320 = 800ms（**同样可跳过**，`fcn_004528b9`）@source 0x0044dd7b */
export const FORTUNE_SECOND_HOLD_MS = 0x320;

/** 抽卡 FLIC = `Data.mkf` **#0x218** @source 0x0041b306 `push 0x218` */
export const CARD_FLIC_RESOURCE = 0x218;
/** FLIC 落点 (208,180) @source 0x0041b31c `push 0xd0 / push 0xb4`（call 0x0041b32b）*/
export const CARD_FLIC_AT = { x: 0xd0, y: 0xb4 } as const;

/** 卡面资源基址 @source 0x00441fb1 `add eax, 0x23a` */
export const CARD_FACE_BASE = 0x23a;
/**
 * 卡面尺寸 —— **165 × 256**（不是 176×240）。
 *
 * ⚠️ **2026-09-20 订正（W-61）**：先前那个 `176×240` 是**按文件大小猜的**
 *   （`Data/0571.bin` = 84480 B；176×240×2 与 165×256×2 都是 84480，所以字节数对得上、
 *   **行宽错了**）⇒ 解码出来每行错位、整张卡是乱码。
 *   真值来自 exe 的**图头模板**：
 *
 * ```asm
 * ; fcn_00441f73（得卡演出，4 个调用点共用：卡片格 0x0041b302、福神 0x00441baa 等）
 * 00441f7e  mov esi, 0x441204        ; 图头模板
 * 00441f83  movsd ×3                 ; 12 字节拷到栈上
 * ;                    模板 0x441204 的字节 = a5 00 00 01 00 00 00 00 …
 * ;                    ⇒ u16 宽 = 0x00a5 = 165、u16 高 = 0x0100 = 256、锚点 (0,0)
 * 00441fc6  ; read_mkf(Data.mkf, 卡号 + 0x23a) 的返回值填进模板的数据指针
 * 00442046  push 0xc8 / push 0x8a    ; 落点 (138,200) 不变
 * ```
 *   ⇒ 165 × 256 × 2 = **84480** ✓（与资源字节数对账）。
 *   首席已用 165×256 渲染 `extracted/Data/0571.bin`，是一张完整的卡。
 */
export const CARD_FACE_SIZE = { w: 0xa5, h: 0x100 } as const;
/** 卡面落点 (138,200) @source 0x00442046 `push 0xc8 / push 0x8a` */
export const CARD_FACE_AT = { x: 0x8a, y: 0xc8 } as const;
/** 对话框皮落点 (220,129) @source 0x0044200a `push 0xdc / push 0x81` */
export const CARD_SKIN_AT = { x: 0xdc, y: 0x81 } as const;
/** 卡名落点 (220,129)、flag 4 = 正中 @source 0x0044202b `push 4 / 0x81 / 0xdc` */
export const CARD_NAME_AT = { x: 0xdc, y: 0x81 } as const;
/** 抽卡等待 0x5dc = 1500ms（**同样可跳过**，`fcn_004528b9`）@source 0x004420a6 */
export const CARD_HOLD_MS = 0x5dc;
/** FLIC 取不到时的兜底时长 —— 原版是阻塞播放，本引擎不能卡住帧（见 deviations）*/
export const CARD_FLIC_FALLBACK_MS = 1200;

/** 事件文字字号 @source `create_font(0x1c, …)` 0x0044b737 / 0x0044dbdd */
export const EVENT_FONT_SIZE = 0x1c;
/** 卡名字号 @source `create_font(0x10, …)` 0x00441f91 */
export const CARD_FONT_SIZE = 0x10;
/** 事件文字颜色 @source 同上：填充 0xf0f0f0、阴影 0x101010 */
export const EVENT_TEXT = { fill: '#f0f0f0', stroke: '#101010' } as const;
/**
 * 多行文字的行距 —— **近似**。
 *
 * 原版走 GDI `DrawTextA`（VA 0x0044fabc 尾），行高由字体度量决定；
 * 本项目拿不到 GDI 的 `TEXTMETRIC`，取 `字号 + 6`（28 → 34）。
 * 见 `docs/deviations/T-041.md` 的 D-EVENT-3。
 */
export const EVENT_TEXT_LINE_H = EVENT_FONT_SIZE + 6;

/**
 * 新聞标题表（六条）@source 串表 `0x475ed8` 的六项
 *   （`rich4_news.asm:4116`，指向 `0x4653ec` / `0x4653f7` / `0x465400` /
 *   `0x465409` / `0x465412` / `0x46541b`，BIG5 逐条解出）
 */
export const NEWS_TITLES: readonly string[] = [
  '無責任新聞',
  '政府公告',
  '社會新聞',
  '路況報導',
  '氣象報導',
  '財經新聞',
];

/**
 * `新闻号 → 标题下标` @source byte 表 **VA 0x475eb4**（36 字节 = 9 个 dword）
 *
 * 原始 9 个 dword 原样列在这里，再逐字节摊平 —— 这样「表长 36、
 * 每项一个下标」两件事都能在单测里核对，不必相信手抄。
 */
const NEWS_TITLE_DWORDS: readonly number[] = [
  0x00000000, 0x01010000, 0x01010101, 0x02020101, 0x04040303, 0x05050404, 0x05050505,
  0x05050505, 0x05050505,
];

export const NEWS_TITLE_INDEX: readonly number[] = NEWS_TITLE_DWORDS.flatMap((dw) => [
  dw & 0xff,
  (dw >>> 8) & 0xff,
  (dw >>> 16) & 0xff,
  (dw >>> 24) & 0xff,
]);

/** 这条新聞的标题；表里没有（越界）时返回空串 */
export function newsTitle(newsId: number): string {
  const at = NEWS_TITLE_INDEX[newsId];
  if (at === undefined) return '';
  return NEWS_TITLES[at] ?? '';
}

// ============================================================
//  说明文字（纯函数）
// ============================================================

/**
 * 事件说明文字里 `%d` / `%s` 的代入。
 *
 * ⚠️ **这是近似**：原版是**逐事件**在事件处理函数里 `sprintf` 的 ——
 *   例：新聞 id 1 的 `mov ecx, 3` + `sprintf(buf, 串 0x46543a, 3)`（VA 0x00448f4x），
 *   命運用 x87 把 `factor × 物价指数` 算出来再 `sprintf`。
 *   而 `GameState.lastEvent` 只有一个 `{ kind, id }`，**代入值不在状态里**，
 *   所以本模块只能拿现成的东西补：
 *
 *   - `%d` → `entry.literal`，否则 `entry.factor × 物价指数`；两个都没有时留 `？`
 *     （★ 2026-09-17：新聞 1/3 的 `literal` 已按汇编补成 **3** —— 那两条的
 *     事件处理函数里是 `mov ecx, 3` + `sprintf`，先前表里是 `null`，
 *     于是屏上显示「延長刑期？天」）；
 *   - `%s` → 这一次 diff 里现金/存款动过的那个玩家名（见 `eventSubject`）。
 *
 *   见 `docs/deviations/T-041.md` 的 D-EVENT-2。
 */
export function eventBoxDescription(
  entry: EventEntry | undefined,
  priceIndex: number,
  subject: string,
): string {
  if (entry === undefined) return '';
  const amount =
    entry.literal !== null
      ? entry.literal
      : entry.factor === null
        ? null
        : entry.factor * priceIndex;
  // ★ 收敛到唯一入口：顺手把 `#NNNN` 播出来（`stripEventCode` 只管剥、不播，
  //   而它是 `@rich4/data` 的 —— data 不该依赖 client，故播放在这里做）
  return playVoiceCode(entry.text)
    .replace(/%d/g, amount === null ? '？' : `${amount}`)
    .replace(/%s/g, subject === '' ? '？' : subject);
}

/**
 * `%s` 代入的人名 —— 这一次 diff 里**现金或存款动得最多**的那个人。
 *
 * 原版 `%s` 是事件自己挑的对象（新聞里可能是「第一大地主」这种别人），
 * 而状态里没有这个字段，只能从「谁的钱动了」反推；一个人都没动时退回
 * 当前玩家（命運的受影响者就是抽牌人）。见 D-EVENT-2。
 */
export function eventSubject(before: GameState, after: GameState, fallback: number): string {
  let best = -1;
  let bestDelta = 0;
  for (let i = 0; i < after.players.length; i++) {
    const a = after.players[i];
    const b = before.players[i];
    if (a === undefined) continue;
    const delta =
      Math.abs(a.cash - (b?.cash ?? a.cash)) +
      Math.abs(a.moneyInBank - (b?.moneyInBank ?? a.moneyInBank));
    if (delta > bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  const at = best >= 0 ? best : fallback;
  return CHARACTERS[after.players[at]?.character ?? -1]?.name ?? '';
}

// ============================================================
//  抽卡：从手牌差集取「多出来的那张」
// ============================================================

/** 这一次 diff 里新得的牌（1 基卡号）与是谁得的 */
export interface CardGain {
  player: number;
  card: number;
}

/**
 * 手上多出来的牌 —— 顺序即 `players` 序，第一个变长的玩家里第一张多出来的。
 *
 * `reduce.ts` 是 `p.cards.push(out.cardDrawn)`（VA 对应 `loc_0041b302` 那条路），
 * 故差集里多出来的那张就是刚抽到的；用多重集差而不是 `slice(before.length)`
 * 是为了对「先被拿掉一张、再加一张」这种 diff 也稳。
 *
 * ⚠️ 这个判据对**所有**得卡来源都成立 —— 包括福神显灵送的那张（`receiveCards`）。
 *   原版那一支**没有卡面**（`rich4_gods.asm:693-754`，见 `event()` 的注释），
 *   故 `event()` 在调本函数**之前**先让开带 `god.gotCard` 的那条 action
 *   （大福神得两张那条是 `god.gotCardTwo`，同一个闸口一并让开）。
 */
export function cardGained(before: GameState, after: GameState): CardGain | null {
  for (let i = 0; i < after.players.length; i++) {
    const a = after.players[i];
    const b = before.players[i];
    if (a === undefined || b === undefined) continue;
    if (a.cards.length <= b.cards.length) continue;
    const have = new Map<number, number>();
    for (const c of b.cards) have.set(c, (have.get(c) ?? 0) + 1);
    for (const c of a.cards) {
      const n = have.get(c) ?? 0;
      if (n > 0) have.set(c, n - 1);
      else return { player: i, card: c };
    }
  }
  return null;
}

// ============================================================
//  绘制计划（纯函数：view → 有序的贴图/文字清单）
// ============================================================

export type EventBoxKind = 'news' | 'fortune' | 'card';

/** 这一次要演哪一段 */
export interface EventBoxView {
  kind: EventBoxKind;
  /** 事件号（新聞 0..35 / 命運 0..36）或卡号（1..30）*/
  id: number;
  /** 新聞标题（`NEWS_TITLES` 之一）；命運/抽卡为空 */
  title: string;
  /** 说明文字（已代入 `%d`/`%s`）；抽卡为空 */
  description: string;
  /** 卡名；新聞/命運为空 */
  cardName: string;
  /**
   * ★ 新聞百分比类那四条（11 所得稅 / 12 地價稅 / 13 證交稅 / 23 儲金紅利）的
   *   **逐人明细**（不是让本屏自己算 —— 规则在 core，见
   *   `events/news-effects.ts` 的 `NewsEffectResult.shares`）。
   *
   * 原版是「先算好、逐行画出来，**第二趟**才真收」（`rich4_news.asm:1320` 起），
   * 故这一段在结算**之后**播，但演的是「先算好」那一趟的数字。
   * 金额 ≤ 0 的那几位原版不画（`test eax,eax / je`），这里同样跳过。
   */
  shares?: readonly {
    readonly name: string;
    readonly amount: number;
    /** 角色号 —— 明细行左侧头像用（`portraitResource(character)` 图 3）*/
    readonly character: number;
  }[];
}

/** 计划里的一条**贴图** */
export interface EventBoxBlit {
  kind: 'blit';
  archive: ArchiveName;
  resource: number;
  /** 带表头资源的图号；无头 RGB555 恒 0（用 `size` 区分）*/
  index: number;
  /** 无头 RGB555 的尺寸；带表头资源为 `null` */
  size: { readonly w: number; readonly h: number } | null;
  /** 要不要抠掉纯黑（原版走 `fcn_00456418` 那支）*/
  keyed: boolean;
  at: { readonly x: number; readonly y: number };
}

/** 计划里的一条**文字** */
export interface EventBoxText {
  kind: 'text';
  text: string;
  at: { readonly x: number; readonly y: number };
  size: number;
  /** `rich4_draw_text` 的 flag 0 / 4 落到 CSS 的这两个字段 */
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  fill: string;
  stroke: string;
}

export type EventBoxItem = EventBoxBlit | EventBoxText;

/** 这一帧/这一段要画的东西 */
export interface EventBoxPlan {
  kind: EventBoxKind;
  id: number;
  /** 按**原版的绘制顺序**排好的清单 */
  items: readonly EventBoxItem[];
  /** 抽卡第一段那段 FLIC；其余两种为 `null` */
  flic: { readonly archive: ArchiveName; readonly resource: number; readonly at: { readonly x: number; readonly y: number } } | null;
  /** 第一段停多久（ms）*/
  holdMs: number;
  /** 命運第二段停多久（ms）；其余为 0 */
  hold2Ms: number;
}

/** 一張带表头的图（走 `sprite()`）*/
function blitSprite(
  archive: ArchiveName,
  resource: number,
  index: number,
  keyed: boolean,
  at: { readonly x: number; readonly y: number },
): EventBoxBlit {
  return { kind: 'blit', archive, resource, index, size: null, keyed, at };
}

/** 一張无头 RGB555（走 `raw()`，锚点恒 0、**不透明**）*/
function blitRaw(
  archive: ArchiveName,
  resource: number,
  size: { readonly w: number; readonly h: number },
  at: { readonly x: number; readonly y: number },
): EventBoxBlit {
  return { kind: 'blit', archive, resource, index: 0, size, keyed: false, at };
}

/** 一条 `draw_text`；flag 0 = 左上、flag 4 = 正中（跳表 0x44faa0）*/
function textItem(
  text: string,
  at: { readonly x: number; readonly y: number },
  size: number,
  centered: boolean,
): EventBoxText {
  return {
    kind: 'text',
    text,
    at,
    size,
    align: centered ? 'center' : 'left',
    baseline: centered ? 'middle' : 'top',
    fill: EVENT_TEXT.fill,
    stroke: EVENT_TEXT.stroke,
  };
}

/** `view → plan` —— **纯函数**，单测钉的就是它 */
export function eventBoxPlan(v: EventBoxView): EventBoxPlan {
  if (v.kind === 'card') {
    return {
      kind: 'card',
      id: v.id,
      items: [
        // 对话框皮（Data#517 图 5，249×170、锚点 (123,101)）→ 落点在 (97,28)
        blitSprite('Data.mkf', DIALOG_SKIN_RESOURCE, DIALOG_SKIN_IMAGE, true, CARD_SKIN_AT),
        // 卡名：flag 4 = 正中
        textItem(v.cardName, CARD_NAME_AT, CARD_FONT_SIZE, true),
        // 卡面：165×256 无头 RGB555（尺寸见 CARD_FACE_SIZE），**不透明**贴 (138,200)
        blitRaw('Data.mkf', CARD_FACE_BASE + v.id, CARD_FACE_SIZE, CARD_FACE_AT),
      ],
      flic: { archive: 'Data.mkf', resource: CARD_FLIC_RESOURCE, at: CARD_FLIC_AT },
      holdMs: CARD_HOLD_MS,
      hold2Ms: 0,
    };
  }

  const fortune = v.kind === 'fortune';
  const items: EventBoxItem[] = [
    // 外框（440×480）**不透明**贴 (0,0) @source 0x0044b84c / 0x0044dd3c
    blitSprite(
      'Panel.mkf',
      EVENT_PANEL_RESOURCE,
      fortune ? EVENT_FORTUNE_FRAME : EVENT_NEWS_FRAME,
      false,
      { x: 0, y: 0 },
    ),
    // 插画（388×251，无头 RGB555）**不透明**贴 (25,44)
    blitRaw(
      'Data.mkf',
      (fortune ? FORTUNE_ART_BASE : NEWS_ART_BASE) + v.id,
      EVENT_ART_SIZE,
      EVENT_ART_AT,
    ),
  ];
  if (!fortune) items.push(textItem(v.title, NEWS_TITLE_AT, EVENT_FONT_SIZE, false));
  if (v.description !== '') {
    items.push(
      textItem(v.description, fortune ? FORTUNE_TEXT_AT : NEWS_TEXT_AT, EVENT_FONT_SIZE, false),
    );
  }
  // 新聞百分比类那四条：逐人明细行（`%s繳交%d元`，行距 0x20，从 y=0x15a 起）
  if (!fortune && v.shares !== undefined) {
    let line = 0;
    for (const s of v.shares) {
      if (s.amount <= 0) continue; // 原版 `test eax,eax / je` 不画 0 那一行
      const y = NEWS_SHARE_AT.y + line * NEWS_SHARE_PITCH;
      items.push(textItem(newsShareLine(s.name, s.amount), { x: NEWS_SHARE_AT.x, y }, EVENT_FONT_SIZE, false));
      // 头像紧随其后（原版就是 draw_text 之后立刻 fcn_004562a5），落点 (0x186, y+0xc)
      items.push(
        blitSprite(
          'map.mkf',
          portraitResource(s.character),
          NEWS_SHARE_PORTRAIT_IMAGE,
          true,
          { x: NEWS_SHARE_PORTRAIT_X, y: y + NEWS_SHARE_PORTRAIT_DY },
        ),
      );
      line += 1;
    }
  }
  return {
    kind: v.kind,
    id: v.id,
    items,
    flic: null,
    holdMs: fortune ? FORTUNE_HOLD_MS : NEWS_HOLD_MS,
    hold2Ms: fortune ? FORTUNE_SECOND_HOLD_MS : 0,
  };
}

/**
 * 新聞那一段的 view。
 *
 * @param shares 百分比类那四条的逐人明细（引擎给的，见 `EventBoxView.shares`）；
 *   其余事件不传。
 */
export function newsView(
  newsId: number,
  priceIndex: number,
  subject: string,
  shares?: readonly { name: string; amount: number; character: number }[],
): EventBoxView {
  return {
    kind: 'news',
    id: newsId,
    title: newsTitle(newsId),
    description: eventBoxDescription(newsEvent(newsId), priceIndex, subject),
    cardName: '',
    ...(shares === undefined ? {} : { shares }),
  };
}

/** 命運那一段的 view */
export function fortuneView(fortuneId: number, priceIndex: number, subject: string): EventBoxView {
  return {
    kind: 'fortune',
    id: fortuneId,
    title: '',
    description: eventBoxDescription(fortuneEvent(fortuneId), priceIndex, subject),
    cardName: '',
  };
}

/** 抽卡那一段的 view */
export function cardView(cardId: number): EventBoxView {
  const def = CARDS.find((c) => c.id === cardId);
  return {
    kind: 'card',
    id: cardId,
    title: '',
    description: '',
    cardName: def?.name ?? '',
  };
}

// ============================================================
//  无头 RGB555 的小图槽（`main.ts` 在 boot() 里接两个出口）
// ============================================================

/** 已解好的无头图，键 = `档案:资源`。`null` = 问过了、档案里确实没有 */
const rawArt = new Map<string, Sprite | null>();
/** 正在解的那些 —— 同一张不重复起解码 */
const rawPending = new Set<string>();
/** 档案句柄；`main.ts` 载完档案后交进来（照 `minigame-bg.ts` 的路子）*/
let archives: LoadedArchives | null = null;
/** 图异步到达时催一帧重画 */
let artArrived: (() => void) | null = null;

/**
 * `main.ts` 载完档案后调这里 —— 本屏要用它走无头 RGB555 出口。
 *
 * ★ 为什么不在 `UiScreenEnv` 上加一个 `raw()`：那要动 `ui-screen.ts` 的契约，
 *   `main.ts` 与好几份假 env 都得跟着改；`minigame-bg.ts` 已经立了
 *   「模块级小图槽 + 宿主喂一次」这条路，本屏照抄。
 */
export function setEventBoxArchives(a: LoadedArchives | null): void {
  archives = a;
}

/** 无头图异步到达时催一帧重画（由 `main.ts` 接 `requestRender`）*/
export function onEventBoxArtReady(cb: () => void): void {
  artArrived = cb;
}

/** 单测用：清掉图槽与档案句柄 */
export function resetEventBoxArt(): void {
  rawArt.clear();
  rawPending.clear();
  archives = null;
  artArrived = null;
}

/**
 * 同步取一张无头 RGB555；没解出来先返回 `null` 并在后台解，解完催一帧。
 *
 * ⚠️ 解出来是 `null`（档案里没有这一张）时**照样缓存** —— 否则每帧都会重起
 *   一次解码。这与 `env.flic()` 的「别缓存 null」不同：flic 的 `null`
 *   表示「还没解好」，而本函数的 `null` 表示「问过档案了，没有」。
 */
function rawSprite(
  archive: ArchiveName,
  resource: number,
  width: number,
  height: number,
): Sprite | null {
  // 尺寸也进键：同一资源用错尺寸问一次会解出 null，别让那次 null 污染正确尺寸
  const key = `${archive}:${resource}:${width}x${height}`;
  const hit = rawArt.get(key);
  if (hit !== undefined) return hit;
  const a = archives;
  if (a !== null && !rawPending.has(key)) {
    rawPending.add(key);
    void loadRaw555Resource(a, archive, resource, width, height)
      .catch(() => null)
      .then((bitmap) => {
        rawPending.delete(key);
        rawArt.set(key, bitmap === null ? null : { bitmap, width, height, anchorX: 0, anchorY: 0 });
        artArrived?.();
      });
  }
  return null;
}

// ============================================================
//  演出状态机（纯函数）
// ============================================================

/** 抽卡先播 FLIC 那一段（`'flic'`），其余两种直接进 `'show'` */
export type EventBoxPhase = 'flic' | 'show';

export interface EventBoxPlayback {
  plan: EventBoxPlan;
  /** 起播时刻 */
  at: number;
  phase: EventBoxPhase;
  /** `'show'` 阶段的计时原点 */
  showAt: number;
  /** 命運第二段开始的时刻；0 = 还没进第二段 */
  secondAt: number;
}

export function eventBoxPlaybackStart(plan: EventBoxPlan, now: number): EventBoxPlayback {
  const card = plan.kind === 'card' && plan.flic !== null;
  return { plan, at: now, phase: card ? 'flic' : 'show', showAt: card ? 0 : now, secondAt: 0 };
}

/**
 * 走一帧。
 *
 * @param filmMs FLIC 解好之后的总时长（`frames × frameMs`）；还没解好传 `null`
 * @returns 该关屏了返回 `null`
 */
export function eventBoxPlaybackTick(
  p: EventBoxPlayback,
  now: number,
  filmMs: number | null,
): EventBoxPlayback | null {
  if (p.phase === 'flic') {
    const done =
      filmMs !== null && filmMs > 0
        ? now - p.at >= filmMs
        : now - p.at >= CARD_FLIC_FALLBACK_MS;
    return done ? { ...p, phase: 'show', showAt: now } : p;
  }
  if (p.plan.kind === 'fortune' && p.secondAt === 0) {
    if (now - p.showAt >= p.plan.holdMs) return { ...p, secondAt: now };
    return p;
  }
  const from = p.plan.kind === 'fortune' ? p.secondAt : p.showAt;
  const wait = p.plan.kind === 'fortune' ? p.plan.hold2Ms : p.plan.holdMs;
  return now - from >= wait ? null : p;
}

/**
 * 点一下（原版是 `WM_LBUTTONUP` 0x202 / 右键 0x205 / 按键 0x101 三种消息）。
 *
 * ★ 本屏各段的等待/播放函数**不一样**，可跳过性也不一样（详见文件头）：
 *   - 新聞 2400ms（0x0044b867）与命運第一段 1600ms（0x0044dd49）走
 *     `fcn_004544f6`（0x004544f6）—— 认这三种消息；
 *   - 命運第二段 800ms（0x0044dd80）与抽卡亮牌 1500ms（0x004420ab）走
 *     `fcn_004528b9`（0x004528b9）—— **同样认**这三种消息（E-5 订正）；
 *   - ★ 抽卡第一段 FLIC（0x0041b32b）走 `fcn_0045144f`（0x0045144f），
 *     但那一处 `flags = 1`（`0x0041b31e`）⇒ `[0x48c880] = 0` ⇒
 *     `0x004514d6` 的闸把它自己的消息检查整段跳过 ⇒ **点不掉/按不掉**。
 *
 *   原版「跳过」的语义是**不等满、直接往下走**（返回值在调用点被丢掉，
 *   后面的收尾照跑）：
 *   - 新聞 / 抽卡亮牌 / 命運第二段：跳过一次就演出结束 ⇒ 关屏；
 *   - 命運第一段：跳过后原版接着跑效果那趟、再新起一次 800ms 等待 ⇒ 进第二段。
 *
 *   本引擎的 `UiScreen` 只给 `down`/`up`（没有通用按键），故 `up` 只接 `up`。
 *
 * @returns 关屏返回 `null`；抽卡 FLIC 段不吃跳过，原样返回 `p`
 */
export function eventBoxPlaybackSkip(p: EventBoxPlayback, now: number): EventBoxPlayback | null {
  // 抽卡第一段 FLIC：原版那一段的跳过闸是关的（flags=1 ⇒ [0x48c880]=0）⇒ 不吃跳过
  if (p.phase === 'flic') return p;
  // 命運第一段：跳过后进第二段（原版第二段是**新起**的等待，时长重数）
  if (p.plan.kind === 'fortune' && p.secondAt === 0) return { ...p, secondAt: now };
  // 新聞 2400 / 命運第二段 800 / 抽卡亮牌 1500：跳过即演出结束
  return null;
}

// ============================================================
//  绘制
// ============================================================

/** 锚点落点绘制 @source `fcn_00456418` / `fcn_004563f5`（`to_left = x − src->x`）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  drawSprite(ctx, s, x - s.anchorX, y - s.anchorY);
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  sprite: EventBoxSprite,
  raw: EventBoxRaw,
  it: EventBoxItem,
): void {
  if (it.kind === 'blit') {
    if (it.size === null) {
      drawAnchored(ctx, sprite(it.archive, it.resource, it.index, it.keyed), it.at.x, it.at.y);
    } else {
      drawAnchored(ctx, raw(it.archive, it.resource, it.size.w, it.size.h), it.at.x, it.at.y);
    }
    return;
  }
  // `\n` 分段：原版交给 GDI 的 DrawTextA，行高见 `EVENT_TEXT_LINE_H`
  const lines = it.text.split('\n');
  ctx.font = `${it.size}px ${FONT_FAMILY}`;
  ctx.textAlign = it.align;
  ctx.textBaseline = it.baseline;
  ctx.lineWidth = 3;
  ctx.strokeStyle = it.stroke;
  ctx.fillStyle = it.fill;
  for (let i = 0; i < lines.length; i++) {
    const y = it.at.y + i * EVENT_TEXT_LINE_H;
    ctx.strokeText(lines[i]!, it.at.x, y);
    ctx.fillText(lines[i]!, it.at.x, y);
  }
}

/**
 * 画这一段。
 *
 * `'flic'` 阶段只画那张影片（抽卡第一段）；`'show'` 阶段按 `plan.items` 的顺序画。
 * 资源取不到（`null`）就**安静跳过**，与其它屏同一条规矩。
 */
export function drawEventBoxScreen(
  ctx: CanvasRenderingContext2D,
  sprite: EventBoxSprite,
  raw: EventBoxRaw,
  plan: EventBoxPlan,
  opts: { phase: EventBoxPhase; elapsed: number; flic: LoadedFlic | null },
): void {
  if (opts.phase === 'flic') {
    const at = plan.flic?.at;
    const film = opts.flic;
    if (at === undefined || film === null || film.frames.length === 0) return;
    const frame = Math.min(
      film.frames.length - 1,
      Math.max(0, Math.floor(opts.elapsed / Math.max(1, film.frameMs))),
    );
    const bitmap = film.frames[frame];
    if (bitmap === undefined) return;
    ctx.drawImage(bitmap, at.x, at.y);
    return;
  }
  for (const it of plan.items) drawItem(ctx, sprite, raw, it);
}

// ============================================================
//  屏幕本体
// ============================================================

/** 现在正在播的那一段；`null` = 没在播 */
let playback: EventBoxPlayback | null = null;

/** 调试 / 单测用：把整屏关掉 */
export function resetEventBoxScreen(): void {
  playback = null;
}

/**
 * 「跳过」这一拍 —— 原版 0x202 / 0x205 / 0x101 三条消息共用同一条出口。
 *
 * @source 两个**等待**函数各自都收这三种消息：`fcn_004544f6`（0x454520-0x454554）、
 *   `fcn_004528b9`（0x4528fd-0x452919）。收不到就等满 2400（新聞）/
 *   1600+800（命運）/ 1500（抽卡亮牌）。
 *   ⚠️ 抽卡第一段是 `fcn_0045144f`（0x0041b32b），那一处 `[0x48c880]=0`
 *   ⇒ 它那三种消息检查整段被跳过，本屏也照原版不接（`eventBoxPlaybackSkip` 直接返回 `p`）。
 */
function skipPlayback(env: UiScreenEnv): void {
  const p = playback;
  if (p === null) return;
  const next = eventBoxPlaybackSkip(p, env.now);
  if (next === null) {
    playback = null;
    env.log('事件提示框：跳过');
  } else {
    playback = next;
  }
  env.requestRender();
}

export const eventBoxScreen: UiScreen = {
  id: 'eventBox',

  /**
   * ★ **浮窗**：原版这三段都只把一块 (0,0)-(440,480) 的窗贴到**已经画好棋盘**的
   *   离屏表面上（新聞/命運是 `fcn_004563f5(主表面, 图66, 0, 0)`；抽卡是直接往
   *   主表面上贴对话框皮 + 卡面）。所以右边缘那 200px 露出的是原来的画面，
   *   不是黑底。`main.ts` 见到 `windowed` 会先照常画一整帧棋盘（同 `wheel-screen.ts`）。
   */
  windowed: true,

  active: () => playback !== null,

  draw(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    const elapsed = env.now - (p.phase === 'flic' ? p.at : p.showAt);
    const at = p.plan.flic;
    drawEventBoxScreen(env.stage, env.sprite, rawSprite, p.plan, {
      phase: p.phase,
      elapsed,
      flic: at === null ? null : env.flic(at.archive, at.resource),
    });
  },

  tick(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    // ⚠️ `env.flic()` 是异步的：第一次问一定 null，解好后 main.ts 自己重画一帧。
    //   所以这里不缓存 null，每次都问（与 `lottery-draw-screen.ts` 同一条路子）。
    const film = p.plan.flic === null ? null : env.flic(p.plan.flic.archive, p.plan.flic.resource);
    const filmMs = film === null ? null : film.frames.length * film.frameMs;
    const next = eventBoxPlaybackTick(p, env.now, filmMs);
    if (next === null) {
      playback = null;
      env.log(`事件提示框：${p.plan.kind} 演出结束`);
      env.requestRender();
      return;
    }
    playback = next;
    // ★ **必须自己续帧**：`main.ts` 只把 `tick` 发给**此刻接管整屏**的那一屏，
    //   而本屏的换段/关屏都是「时间到」才有的事 —— 不续帧就永远到不了那个
    //   deadline（屏就一直挂在台上）。演出最长 2.4 秒，续帧的代价可接受。
    env.requestRender();
  },

  /**
   * 原版那些**等待**（`fcn_004544f6` / `fcn_004528b9`）都认 `WM_LBUTTONUP`（0x202）/
   *   `WM_RBUTTONUP`（0x205）/ `WM_KEYDOWN`（0x101）。
   *
   * ★ 2026-09-16：`0x202` 与 `0x205` **两条都接上了** —— 右键那一拍走
   *   `contextmenu`（浏览器里的 `WM_RBUTTONUP`，见 `ui-screen.ts:117`），
   *   两条都落到同一个 `skipPlayback`。
   *   ✅ 2026-09-16：`WM_KEYDOWN`（0x101）也接上了 —— 走新加的 `UiScreen.key`
   *   出口（契约原本只有映射过的 `HOTKEY.*`，收不到「任意键」）。
   *   ✅ 2026-09-19：跳过对**全部等待段**生效（`fcn_004528b9` 也认这三种消息，
   *   见 `escalations.md` E-5 与 `eventBoxPlaybackSkip`）。
   *   ⚠️ 抽卡第一段那段 FLIC 是 `fcn_0045144f`，原版那一段的跳过闸是关的 ⇒ 不接。
   *   **按下**（0x201）原版不认，本屏也不实现 `down`。
   */
  up(_x: number, _y: number, env: UiScreenEnv): void {
    skipPlayback(env);
  },

  /** `WM_RBUTTONUP`（0x205）—— 与抬手同一条出口 @source `fcn_004544f6` 的 `PeekMessage` */
  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    skipPlayback(env);
  },

  /**
   * `WM_KEYDOWN`（0x101）—— 第三种跳过消息 @source `fcn_004544f6` 的 `PeekMessage`。
   *
   * 原版那一段是 `cmp ecx,0x202 / je 跳过` `cmp ecx,0x205 / je 跳过`
   * `cmp ecx,0x101 / jne 继续等` —— **只看消息号、不看是哪个键**，
   * 所以这里也一律消费。
   */
  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    skipPlayback(env);
    return true;
  },

  /**
   * 察觉「刚刚落了一次新聞/命運/卡片格」。
   *
   * 判据两条（都纯查状态）：
   *   ① `after.lastEvent` 与 `before.lastEvent` 的 `kind`/`id` 不同 → 新聞/命運；
   *   ② 否则看有没有玩家的手牌变长 → 抽卡。
   *
   * `lastEvent` 优先：命運 id 5「今天是你生日 向每人收取一張卡片」同样会让手牌变长，
   * 那一次该由命運框来演，不是抽卡框。
   *
   * ★★ 例外（第九份试玩回报第 1 条）：**福神得卡不许出卡面**。
   *   原版 `fcn_0040ed8f`（`rich4_gods.asm:693-754`）那一段的顺序是
   *     附身影片 `Data 0x21e`（`:695`）→ 开场白 `0x4632cc`（`call 0x40e2a2`）
   *     → `_rich4_player_receive_random_card`（`:732`）→ 訊息框「%s附身 得到%s！」
   *     `0x4632fd` 1500ms（`:738-746`）→ 台词 `call 0x44f230`（`:754`）。
   *   **中间没有卡面**：卡面演出 `fcn_00441f73` / `Data.mkf 0x218` 属于**卡片格**
   *   （`loc_0041b302`）那一支；`_rich4_receive_card` 是纯状态、零图形。
   *   而 `cardGained()` 的判据「任一玩家 `cards` 变长」对**所有**得卡来源都成立 ⇒
   *   福神得卡会在 t=0 与附身影片**同时**起这一屏的卡面（本屏 `windowed`，在
   *   `SCREENS` 里又排在 `noticeBoxScreen` 之前，还会盖住那扇訊息框）。
   *   ⇒ 见到本 action 新写的 `god.gotCard`（core 在 `reduce.ts` 的
   *   `case 'receiveCards'` 里 push 的那条；大福神那次是同一支里的 `god.gotCardTwo`）
   *   就让开，交给訊息框与台词。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return; // 上一段还没播完
    if (before === after) return;

    const ev = after.lastEvent;
    const prev = before.lastEvent;
    // ⚠️ 这条通道是**共用**的，必须用**白名单**只认「新聞 / 命運」两种演出：
    //   · `magicHouse` —— 魔法屋屏的事（见 `magic-screen.ts` 的 `magicViewOfSpin`）；
    //   · ★★ `minigameDecline` —— **得點券格 / 小遊戲不玩**那一条，`id` **恒为 0**，
    //     先前只排除了 `magicHouse` ⇒ 它掉进下面的 `fortuneView(0)`，
    //     于是玩家踩到得點券格时会看到一张「**強制拆除房屋一棟**」的命運卡
    //     （第十一份回报 #5「我名下没有房子的时候也会触发强制拆除房屋一栋吗？」与
    //       #19「强制拆除房屋到底是怎么触发的，怎么NPC触发了还在「感谢阿拉」」的根因
    //       —— 那两句「感謝阿拉！」其实是得 50 點的**好消息台词**，本身没错）。
    //   ⇒ 改成白名单，永远不会再有第三种 kind 被误当成命運。
    if (
      ev !== null &&
      (ev.kind === 'news' || ev.kind === 'fortune') &&
      (prev === null || prev.kind !== ev.kind || prev.id !== ev.id)
    ) {
      const who = after.players[after.currentPlayer];
      const subject = eventSubject(before, after, after.currentPlayer);
      // ★ 新聞百分比类那四条：把引擎「先算好」的逐人金额配上角色名交给计划
      const shares = ev.shares?.map((s) => {
        const character = after.players[s.player]?.character ?? -1;
        return {
          name: CHARACTERS[character]?.name ?? '',
          amount: s.amount,
          character,
        };
      });
      const view =
        ev.kind === 'news'
          ? newsView(ev.id, after.priceIndex, subject, shares)
          : fortuneView(ev.id, after.priceIndex, subject);
      playback = eventBoxPlaybackStart(eventBoxPlan(view), env.now);
      env.log(`事件提示框：${ev.kind === 'news' ? '新聞' : '命運'} #${ev.id}${who === undefined ? '' : `（P${who.index + 1}）`}`);
      env.requestRender();
      return;
    }

    // ★★ 福神得卡（`god.gotCard` / 大福神两张那条 `god.gotCardTwo`）只有訊息框，没有卡面
    //   （依据见上面 `event` 的注释）。
    //   判据 = 这条 action **新写**了 notices 且其中带这两个键之一；
    //   不拿卡袋/手牌反推，免得把卡片格那一路也误伤。
    if (
      after.notices !== before.notices &&
      after.notices?.some((n) => n.key === 'god.gotCard' || n.key === 'god.gotCardTwo')
    )
      return;

    const gain = cardGained(before, after);
    if (gain === null) return;
    playback = eventBoxPlaybackStart(eventBoxPlan(cardView(gain.card)), env.now);
    env.log(`事件提示框：抽到卡片 #${gain.card}`);
    env.requestRender();
  },
};

/** 给单测的只读视图 */
export function eventBoxScreenState(): { playing: boolean; playback: EventBoxPlayback | null } {
  return { playing: playback !== null, playback };
}
