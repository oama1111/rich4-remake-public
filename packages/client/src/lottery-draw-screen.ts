/*
 * 樂透開獎动画屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **不是待决交互** —— 開獎在 core 里即时结算（`reduce.ts` 的 `advanceGameDay`
 *   → `drawLottery`），本屏是**演出**：察觉開獎发生 → 按脚本播一段状态机 → 播完自己关。
 *
 * ## 出处
 *
 * 窗口过程 `fcn_0043010c` **VA 0x0043010c**（= `rich4_ui_letou.asm:1304` 起），
 * 建屏 `fcn_0042f6c3`（**VA 0x0042f6c3** —— 同一个函数在投注屏与開獎屏各用一次，
 * 靠 `[0x48c360]` 这个**资源指针**区分：投注屏载入 Panel#12、開獎屏载入 Panel#15）。
 * 定时器 `SetTimer(…, 0x32, …)` = **50 ms**（VA 0x0043016f）。
 * 状态机 `[0x48c37b]` 走 0..10，跳表在 **`0x004300d0`**：
 *
 * ```
 * [0] 0x430236  置 2 + 说「現在馬上為您開出這一期的號碼．．。」
 * [1] 0x43036c  状态 3：起摇球机 + 铺台座 + 说台词（详见下）
 * [2] 0x43024c  状态 3 的尾巴：数 20 帧后开号
 * [3] 0x430485  状态 4：中奖
 * [4] 0x43024c  （状态 5 走 0x430f43 的等待）
 * [5] 0x4306ff  状态 6：说「恭喜您獨得所有獎金！」
 * [6] 0x4308e0  状态 7→8：说「獎金將累積到下個月．．．。」
 * [7] 0x4308f3  状态 8：把台面还原、说（中奖那条不说话）
 * [8] 0x430aa3  状态 9：说「希望下次得獎者就是您！」
 * [9] 0x430ab5  状态 10：说「行動要快喔！」→ 派彩 + 关屏
 * ```
 *
 * ★ **演出脚本早就在 core 里了**（`core/places/lottery-ceremony.ts`，纯数据＋纯函数）——
 *   本模块只按它播。但脚本里有几处与 exe 对不上（见下面的「订正表」），
 *   那些**以 exe 为准**在本文件里覆盖，并登记在 `docs/deviations/T-036.md`。
 *
 * ## 素材
 *
 * | 是什么 | 资源 | @source |
 * |---|---|---|
 * | 舞台／主持人／脸部件／爆炸框／号码球 | `Panel.mkf` **15**（47 张）| 0x00431712 `push 0xf` |
 * | 摇球机 ANM（`LOTOBALL.FLC` 42 帧 275×270）| `Panel.mkf` **16** | 0x0043172f `push 0x10` |
 * | 得主礼花 ANM（`256_S/A01.FLC` 37 帧 280×480）| `Panel.mkf` **17** | 0x00431749 `push 0x11` |
 * | 各人持号表里的小数字牌（12 张）| `Panel.mkf` **13** | 0x00431739 `push 0xd` |
 * | 各人持号表里的人像条（4 张 189×116）| `Data.mkf` **517** | 0x0040808f `push 0x205` |
 *
 * ## 各人持号表（`fcn_0042f417`，VA 0x0042f417）
 *
 * 四块铭牌 2×2，表 `0x0042f30c`（8 个 dword = 四对 x,y，**每条记录 16 字节**）。
 * 每块上画三样，逐个照 exe：
 *
 * 1. **人像条** = `Data#517` 图 `玩家号`（189×116）→ 落 **(铭牌.x+0x14, 铭牌.y+0x1e)**
 *    @source 0x42f4b0 起的 `+0x14` / `+0x1e`
 * 2. **角色徽章** = `Panel#15` 图 **(25 + 角色号)** → 落 **(铭牌.x+0x14, 铭牌.y+0x1e)**
 *    @source 0x42f4c5 `lea edx, [eax + 0x19]`（图号 = 角色 + 25），锚点自带居中
 * 3. **持号数字** = `Panel#13` 图 `数字`（0..9），起点 **(铭牌.x+0x36, 铭牌.y+0x1e)**、
 *    号码间距 **0x28**、`"%02d"` 的个位在 **+0x10** @source 0x42f55b 起
 *
 * ⚠️ **表里的坐标是「舞台坐标 − 0x14/−0x1e」**（原版把两个偏置加回去才落图），
 *   所以 `TALLY_PLATES` 那四个数直接拿去用就是**人像条**的落点。
 *
 * ★ 每块铭牌在铺图之前先被 `fcn_004552e7(…, 0x128, 0x3c, −16)` **压暗**
 *   （@0x0042f482，296×60、分量减半）—— 那才是屏上看见的「四个蓝框」，
 *   不是任何一张子图。见 `TALLY_FRAME`。
 *
 * ★ 铭牌上的号码用**开奖前**那一份号码表（`DrawCue.sold`）：原版到**最后一步
 *   状态 10** 才 `memset(0x4990b8, 0, 0x24)`（@0x00430ab5 一带，紧接派彩），
 *   演出全程都看得见号码。core 在开奖那一次 action 里就把表清掉了
 *   （`places/lottery.ts` → `emptyLottery()`），所以本模块自己留一份。
 *
 * ## 与 core 脚本的**订正表**（都以 exe 为准，逐条写了 VA）
 *
 * | # | 脚本原来 | exe 实际 | @source |
 * |---|---|---|---|
 * | 1 | 状态 3 只擦「台北座那一条带」+ 奖金格 + 假腿 | 还要**先擦右主持人从脚到右臂那一整片** (472,66)-(608,340)、再擦**左主持人的板** (7,66)-(250,340) | 0x430418 / 0x4303d0 |
 * | 2 | 状态 4 没有台面擦除 | **擦右臂 (472,116)-(518,246)** 与**左板 (7,116)-(141,246)**、抹掉多出来的 (455,246) | 0x4305c2 / 0x4305a0 |
 * | 3 | 状态 5 只数帧 | 数满 30 帧**且**ANM 放完后，**先擦 (0,150)-(418,270)** 与 (150,270)-(300,360)、再把举板姿势与两个号码球重画** | 0x430fc8 / 0x430fe6 |
 * | 4 | 状态 8 只擦右主持人 (489,116)+151×364 | 还要**擦右臂 (472,116)+45×90**；擦左脸用的是 **(52,89)+46×40**（x1/y1 是**开区间**）| 0x43098c |
 * | 5 | 无 | **每个状态都会先把「各人持号表」整条带擦掉再重画**（`fcn_0042f417` 在 0x43025b / 0x4304f4 / 0x4309c9 / 0x430a3a 各调一次）| 0x0042f417 |
 *
 * ## 有意偏离（完整版见 `docs/deviations/T-036.md`）
 *
 * 1. **脸的槽（眨眼）改成按帧号推**，不消耗游戏随机流（C-DET-1）；原版 `rand()>>9`。
 *    概率与帧表**逐个照抄**（1/64、1/64、2/64、2/64，表在 `0x475660`）。
 * 2. **ANM 的帧间隔不是 FLIC 头里那个 71 ms** —— 原版另有一个「起始延时」
 *    `[0x48c870] = 0x370`（880 ms，@source 0x00450e9c / 0x00450eb1），
 *    于是摇球 42 帧 ≈ 37 秒、礼花 37 帧 ≈ 33 秒 —— 这正是「第 6 步要等，
 *    摇球才播得完」的由来。表格按这个数走。
 * 3. 语音（`#NNNN` → `Speaking.mkf`）**没接**：`UiScreenEnv` 只有 `Effect.mkf`
 *    的出口。台词本身照常上屏。
 * 4. **铭牌底框的压暗**（`fcn_004552e7` 那张换色表）改写成 **canvas 半透明黑**
 *    （`TALLY_FRAME.alpha = 16/32`，与原版「5 位分量减半」同值）——
 *    本引擎每帧整屏重画，做不到就地改像素。见 `TALLY_FRAME` 与 T-036。
 * 5. **号码表的清理时机不动 core**：原版在状态 10 清，本模块在**客户端**留一份
 *    开奖前的表（`DrawCue.sold`）来显示。core 仍然在开奖那一下清空 —— 这是
 *    「表现层不改规则」（C-ARC-2）的代价，屏上效果与原版一致。
 */

import {
  BALL_ONES_AT,
  BALL_TENS_AT,
  CEREMONY_BASE,
  CEREMONY_PANEL,
  CEREMONY_TICK_MS,
  CEREMONY_VOICE_MS,
  ENTRY,
  TALLY_PLATES,
  TALLY_TEXT,
  lotteryCeremony,
  type CeremonyBlit,
  type CeremonyStep,
} from '@rich4/core';
import { CHARACTERS, LOTTERY } from '@rich4/data';
import { isAlive } from '@rich4/core';
import type { GameState } from '@rich4/core';
import { FONT_FAMILY, font } from './font.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { playVoiceCode } from './voice-sink.ts';
import { SCREEN_H, SCREEN_W } from './stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type DrawSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 这一屏的全部舞台图素都在 `Panel.mkf` 资源 15 @source 0x00431712 `push 0xf` */
export const DRAW_RESOURCE = CEREMONY_PANEL;
/** 摇球机 ANM @source 0x0043172f `push 0x10` */
export const DRAW_DRUM_RESOURCE = 0x10;
/** 得主礼花 ANM @source 0x00431749 `push 0x11` */
export const DRAW_FLOWER_RESOURCE = 0x11;
/** 持号表的小数字牌 @source 0x00431739 `push 0xd` */
export const DRAW_DIGIT_RESOURCE = 0x0d;
// ★★ W-68-a 删掉了 `DRAW_PORTRAIT_RESOURCE = 0x205`（连同 `drawTally` 里那一步）：
//   `Data.mkf #0x205` 的图 0..3 **不是人像条**，是四块带尖角的**对话框底板**
//   （189×116，锚点分别在四个角）—— 它们属于 `player_say` 那一段（W-50 的气泡图
//   就是同一张资源的图 6），不是持号表。原版 `fcn_0042f417` 每个人只画三样：
//   ① 压暗的 296×60 底框（`fcn_004552e7(…, 0x128, 0x3c, −16)`）、
//   ② `Panel#15` 图 `25 + 角色号` 的徽章（`0x0042f4b1 mov al,[player+0x13] /
//      lea edx,[eax+0x19]`）、③ 号码数字 —— **没有第四样**。
//   先前那一步就是第六份回报里「一进去四个空白对话框」的来源。

/** 人像条与徽章相对铭牌的落点 @source 0x0042f4b0 的 `+0x14` / `+0x1e` */
export const TALLY_ART_AT = { dx: 0x14, dy: 0x1e } as const;

/**
 * 铭牌那块**压暗的底框**（296×60）—— 「四个蓝框」就是它，不是资源里的图。
 *
 * @source `fcn_0042f417` 每画一个人之前先调
 *   `fcn_004552e7(surface, 铭牌.x, 铭牌.y, 0x128, 0x3c, -16)`（@0x0042f482–0x0042f49e）：
 *   `fcn_004552e7` 是**换色表**操作（@0x004552e7 起），最后一个参数是
 *   `[0x485d68] + (−16 << 5)` —— 一张 256 色 × 2 字节 = 512 字节的表，
 *   `−16` ⟹ 5 位分量**减半**（同一族操作见 `board-screen.ts` 的 `PRESS_ALPHA`、
 *   `options-pages.ts` 的 `HOTKEY_PRESS.edgeAlpha`）。
 *
 * ⚠️ 本引擎每帧整屏重画，所以这里是**按同样的观感重画一遍**（canvas 半透明黑），
 *   不是原版那种就地改像素。登记在 `docs/deviations/T-036.md`。
 */
export const TALLY_FRAME = { w: 0x128, h: 0x3c, alpha: 16 / 32 } as const;

/** 铭牌底框的落点 —— 就是铭牌本身（`fcn_004552e7` 收的是表里那对 x,y）*/
export function tallyFrameAt(player: number): { x: number; y: number } | null {
  const at = TALLY_PLATES[player];
  return at === undefined ? null : { x: at[0], y: at[1] };
}

/**
 * 每个动画状态都把「持号表」那一整条带擦掉再重画（core 脚本的
 * `CLEAR_PLATES_BAND` 就是这一片，两处同值）。
 * @source `fcn_0042f417` 的调用点 0x43025b / 0x4304f4 / 0x4309c9 / 0x430a3a
 *   与 `fcn_0042f417` 里 `fcn_0042f6ab` 的那一片拷贝（源 = 底图 0，
 *   目标 = (0x10, 0x154)，`x1/y1 = 0x270/0x1d6` 即 608×130）
 */
export const TALLY_BAND = { x: 0x10, y: 0x154, w: 0x260, h: 0x82 } as const;

// ============================================================
//  台面擦除（VA 逐条抄）
// ============================================================

/**
 * `fcn_0045643d(dest, sprite, dx, dy, sx, sy, x1, y1)` 的参数。
 *
 * ★ `x1/y1` 是**开区间端点**（宽度 = `x1 − dx`）—— 这一条是被两处对上之后定的：
 *   左主持人那一块是 `0x8d − 7 = 134`，恰好 = 图 3 的宽度 134；
 *   右主持人那一整片是 `0x250 − 0x1d8 = 120`、`0x260 − 0x10 = 592` =
 *   608（持号表那一条带的宽度）。本模块的 `EraseRect` **照抄 exe 的端点值**。
 */
export interface EraseRect {
  /** 从哪张子图拷（`Panel#15` 的图号）*/
  from: number;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** **开区间右端点**（不含）*/
  x1: number;
  y1: number;
}

/** 底图 0 —— 所有「擦回干净台面」的源都是它 @source 0x004303a5 等处的 `[0x48c360]+0xc` */
const S = ENTRY.stage;

/**
 * 状态 3（摇球）的台面清理 —— ★ **右主持人的站姿要整片擦掉**，再重画摊手那一张。
 *
 * @source 0x004303d0 / 0x00430418 / 0x00430448；`x1/y1` 是**开区间**端点，
 *   尺寸 = `x1 − dx`、`y1 − dy`（与 `resolveErase` 同一口径）：
 * ```asm
 * 004303d0 push 0x182/0x260/0x154/0x10/0x154/0x10 / 图0 / dst
 *          → fcn_0045643d(dst, 图0, 16,340, 16,340, 608,386)   ; 持号表那一条带（core 已给）
 * 00430418 push 0x42/0x1a2 / 0x24 / dst
 *          → fcn_00456418(dst, 图8, 472, 66)                   ; ★ 右主持人（图 2）整片擦回台面
 * 00430448 ... fcn_00456495(dst, 图2, 0,340, 7,116, 134,130)    ; 左主持人的腿（core 已给）
 * ```
 *
 * ★★ **先前这三条全抄错了**：宽度被当成闭区间端点、`y1` 又多算了 100 点。
 *   右主持人那张 `Panel#2` **206 宽**，只擦 48 点是擦不掉的 —— 于是摊手那张
 *   （图 2，落点 472）叠在站姿那张上，屏上就是**两个主持人**（试玩长跑第 23 条）。
 */
const S3_RIGHT: EraseRect = { from: S, dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42, x1: 0x1d8 + 0x1a2, y1: 0x42 + 0x8c };
const S3_RIGHT_ARM: EraseRect = { from: S, dx: 0x1d8, dy: 0x74, sx: 0x1d8, sy: 0x74, x1: 0x1d8 + 0x1a2, y1: 0x74 + 0x8c };

/**
 * 状态 4（得主）与状态 7（空号）的台面清理 —— 两条支路**完全一样**。
 *
 * @source 0x00430519 / 0x00430543（状态 4）、0x00430e2f / 0x00430e5f（状态 7）：
 * ```asm
 * 00430519 push 0xa8/0x19e/0x42/0x1d8/0x42/0x1d8 / 图0 / dst
 *          → fcn_0045643d(dst, 图0, 472,66, 472,66, 414,168)   ; ★ 大笑那张（图 5）的地
 * 00430543 push 0x8c/0x19e/0x42/7/0x42/7 / 图0 / dst
 *          → fcn_0045643d(dst, 图0, 7,66, 7,66, 414,140)       ; 左主持人的板 + 号码球那一片
 * 0043055f push 0/0 / +0x54 / dst  → 图6 @ (0,0)               ; 左：举板过顶跳（core 已给）
 * 0043057e push 0x42/0x1f9 / +0x48 / dst → 图5 @ (505,66)      ; 右：大笑（core 已给）
 * 004305a2 push 0xc8/0x140 / +0x12c / dst → 图24 @ (320,200)   ; 中央红爆炸框（core 已给）
 * ```
 * ⚠️ 图号按 `[0x48c360] + 0xNN`、每项 12 字节算：`+0x54` = 图 **6**、`+0x48` = 图 **5**、
 *   `+0x12c` = 图 **24**。先前把擦除矩形写成 49/135 宽（还把 y1 顶到 0x1fb）——
 *   图 5 是 **124 宽**、图 2 是 **206 宽**，擦不掉就叠出第二个主持人。
 */
const S4_FACE_RIGHT: EraseRect = { from: S, dx: 0x1d8, dy: 0x42, sx: 0x1d8, sy: 0x42, x1: 0x1d8 + 0xa8, y1: 0x42 + 0x19e };
const S4_FACE_LEFT: EraseRect = { from: S, dx: 7, dy: 0x42, sx: 7, sy: 0x42, x1: 7 + 0x8c, y1: 0x42 + 0x19e };

/**
 * 状态 5（数 30 帧）@source 0x00430fe1 / 0x0043100e / 0x0043103e：
 * ```asm
 * 00430fe1 push 0xa2/0x78/0x154/0/0x154/0 / 图0 / dst
 *          → fcn_0045643d(dst, 图0, 0,340, 0,340, 594,460)     ; 号码球那条带连台座一起擦回去
 * 0043100e push 0/0x154 / +0x54 / dst → 图6 @ (0,340)          ; 举板过顶跳（下半截）
 * 0043103e push 0/0x154 / +0x48 / dst → 图5 @ (505,340)        ; 大笑（下半截）
 * ```
 */
const S5_TOP: EraseRect = { from: S, dx: 0, dy: 0x154, sx: 0, sy: 0x154, x1: 0x78, y1: 0x154 + 0xa2 };

/**
 * 每个演出步骤在 core 脚本之外**还要补的**擦除 —— 下标 = `lotteryCeremony()` 的步号。
 *
 * ⚠️ **只补 core 脚本没给的那些**。`lotteryCeremony()` 的 `patches` 已经带着
 *   持号表那一条带（`CLEAR_PLATES_BAND`，每个状态都调）、状态 3 里左主持人的腿、
 *   状态 4/6/8 各自那几块（含状态 8 的右臂 151×364 与左脸 50×40）——
 *   这里再写一份就会重复（先前正是如此，而且值与 exe 对不上）。
 *
 * ⚠️ 这张表的下标是**步号**；`lotteryCeremony()` 的状态序列是
 *   `[1, 2, 3, 3, 4, 5, 6, 8, 9, 10]`（中奖）或 `[1, 2, 3, 3, 7, 8, 9, 10]`（空号）。
 */
export const CEREMONY_ERASE: readonly (readonly EraseRect[])[] = [
  [], // 步 0 = 状态 1 开场白
  [], // 步 1 = 状态 2 报幕
  // 步 2 = 状态 3 摇球 @source 0x00430418（右主持人整片）+ core 已给的持号表带与左腿
  [S3_RIGHT, S3_RIGHT_ARM],
  [], // 步 3 = 状态 3 尾段：开号（core 已给持号表带，台面已经干净）
  // 步 4 = 状态 4 得主 @source 0x00430519 / 0x00430543
  [S4_FACE_RIGHT, S4_FACE_LEFT],
  // 步 5 = 状态 5 数帧 @source 0x00430fe1
  [S5_TOP],
  // 步 6 = 状态 6 恭喜（core 已给）
  [],
  // 步 7 = 状态 7 空号 @source 0x00430e2f / 0x00430e5f（与状态 4 同一组）
  //        或 状态 8 收尾 @source 0x00430961（core 已给）
  [S4_FACE_RIGHT, S4_FACE_LEFT],
  [],
  // 步 8 = 状态 9 希望下次
  [],
  // 步 9 = 状态 10 行动要快
  [],
];

/**
 * 每个演出步骤在 core 脚本之外**还要补的**贴图。
 *
 * ⚠️ 状态 8 那一条（擦完右臂重画点手指的姿势）**core 脚本已经给了**
 *   （`lotteryCeremony()` 的 `blits: [{ entry: 图1, at: POSE_RIGHT }]`），
 *   所以这里为空 —— 先前重复贴了两遍。
 */
export const CEREMONY_BLIT: readonly (readonly CeremonyBlit[])[] = [
  [], // 步 0 = 状态 1
  [], // 步 1 = 状态 2
  // 步 2 = 状态 3 摇球：擦完台面要**把两个主持人重画回去**
  //   （原版擦的是他们身上的板与腿，不是他们本人）
  //   @source 0x00430418 图 8 @ (472,66) 之后 —— 0x004301b0 那一支里
  //     图 3 @ (7,0x42)（`push 0x42 / 7 / +0x24`）与 图 2 @ (0x1d8,0x42)
  //     （`push 0x42 / 0x1d8 / +0x24`）紧接着擦除各贴一次。
  [{ entry: ENTRY.board, at: [7, 0x42] }, { entry: ENTRY.presenting, at: [0x1d8, 0x42] }],
  [], // 步 3 = 状态 3 开号（core 已给球，其余为空）
  [], // 步 4 = 状态 4（core 已给全）
  // 步 5 = 状态 5：擦掉台面后，举板要重画 @source 0x0043100e（两个号码球见 `CEREMONY_BALLS`）
  [{ entry: ENTRY.jumpBoard, at: [0, 0] }],
  [], // 步 6 = 状态 6
  [], // 步 7 = 状态 7 空号 / 状态 8 收尾（core 已给）
  [], // 步 8 = 状态 9
  [], // 步 9 = 状态 10
];

/**
 * 哪几步在擦完台面之后要**再贴一次号码球**。
 *
 * ★ **下标 = 步号 = core 脚本数组的下标**（`begin()` 拿到什么就播什么，
 *   不插建屏那一步）。核对命令：`lotteryCeremony({number:6,…}).map(s => s.state)`
 *   → `[1, 2, 3, 3, 4, 5, 6, 8, 9, 10]`，于是：
 *
 * | 步 | 状态 | 是什么 | 号码球 |
 * |---|---|---|---|
 * | 2 | 3 | 摇球（起摇球机，数 20 帧 + 等 ANM 放完）| ✗ 还没开号 |
 * | **3** | **3** | **开号**（脚本第二段，0x430b7a 那一片）| **✓** |
 * | 4 | 4 | 得主（脚本自己带球）| ✓ |
 * | 5 | 5 | 数帧 | ✓ |
 * | 6 | 6 | 恭喜 | ✓ |
 * | 7 | 8 | 收尾（中奖那一路）| 脚本没给球 → ✗ |
 * | 7 | 7 | 空号（没人中奖那一路）| ✓ |
 *
 * @source 开号那一下（0x430b7a 一片，同一个状态 3 的第二段，@0x430c17 的
 *   `图号 = 数字 + 0x25`）、状态 4（0x4305aa / 0x4305e2 两颗，@0x48c37d 与
 *   `+0x48c37e` 两个数字字节）、状态 5（0x431049 / 0x43108d）、状态 6
 *   （0x4306ff 那一片）、状态 7（0x430d85 那一片）各贴一次。
 *
 * ⚠️ **步 3 是开号、不是步 4**：core 脚本里状态 3 **连着出现两次**
 *   （`lottery-ceremony.ts` 的 `steps[2]` 是摇球、`steps[3]` 是开号，
 *   见那张 `[1,2,3,3,4,…]`）。原来把开号写在步 4，等于「擦完台面到得主
 *   那一步才补球」—— 于是**只摘 37/38/46 三张**时，含 0/1/9 的号码那颗球
 *   会晚一步才出现。现在两处都钉在 exe 的真值上：`CEREMONY_BALLS[3]`
 *   （开号）+ `[4]`（得主，脚本自己那份被 `localizeStep` 摘掉了，补回来）。
 */
export const CEREMONY_BALLS: readonly boolean[] = [
  false, // 步 0 = 状态 1 开场白
  false, // 步 1 = 状态 2 报幕
  false, // 步 2 = 状态 3 摇球（此时还没开号）
  true, // 步 3 = 状态 3 第二段 ★ 开号，号码球第一次上屏
  true, // 步 4 = 状态 4 得主（脚本给了球，但被 localizeStep 摘掉，这里补回来）
  true, // 步 5 = 状态 5 数帧
  true, // 步 6 = 状态 6 恭喜
  true, // 步 7 = 状态 7 空号 / 状态 8 收尾
  false, // 步 8 = 状态 9 希望下次
  false, // 步 9 = 状态 10 行动要快
];

// ============================================================
//  纯函数：把「源矩形 + 落点」解成真正要拷的那一块
// ============================================================

/** 要拷贝的矩形（舞台坐标），`w/h` 是**像素数** */
export interface CopyRect {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

/**
 * `fcn_0045643d` 那一次拷贝的实际范围。
 *
 * 原版是**逐字节线性拷**（`_draw_image_in_rect_ex`），三处都会越界：
 * 源矩形的 `x1/y1` 是**闭区间端点**（所以宽度 = `x1 − dx + 1`），
 * 且**不夹到子图边界** —— 越界读的是像素区后面的内存。
 * 这里按「源与舞台取交」夹住，越界部分不画（不照抄越界读，与原版的越界写同一处理）。
 */
export function resolveErase(r: EraseRect, spriteW: number, spriteH: number): CopyRect | null {
  // `r.dx/dy` 既是目标落点、也是源矩形的起点（原版那两处传的是同一对值）
  let x0 = r.dx;
  let y0 = r.dy;
  let x1 = r.x1;
  let y1 = r.y1;
  // 夹到源子图
  if (x1 > spriteW) x1 = spriteW;
  if (y1 > spriteH) y1 = spriteH;
  // 夹到舞台（640×480）
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > 640) x1 = 640;
  if (y1 > 480) y1 = 480;
  if (x1 <= x0 || y1 <= y0) return null;
  return { dx: x0, dy: y0, sx: x0, sy: y0, w: x1 - x0, h: y1 - y0 };
}

// ============================================================
//  察觉「刚开了奖」
// ============================================================

/** 一次開獎的演出内容 —— `event` 里从 `before → after` 推出来 */
export interface DrawCue {
  /** 中奖号 0..35 */
  number: number;
  /**
   * ★ `number` 是不是**猜不回来**的。
   *
   * 没人中奖那一支：号码表**不被清空、公库不动**（`drawLottery` 的
   * `unchanged({ number, rigged })`，@source 0x00430afb 的 `je 0x430afb`），
   * 而 `GameState` 里没有「中奖号」这个字段（不许改 `types.ts`）——
   * 于是那一支的号码只能**当 0 号播**，本屏把它标出来。
   * 见 `docs/deviations/T-036.md`。
   */
  numberUnknown: boolean;
  /** 得主下标；没人中奖为 `null` */
  winner: number | null;
  /** 奖金 = **开奖前**的公库（`give_money(得主, 公库, 1)`）*/
  prize: number;
  /** 号码表（用 `before` 那一份来反推各人持号）*/
  sold: readonly number[];
  /** 中奖号原本是谁的（`sold` 里只可能有一个），`null` = 没人买 */
  owner: number | null;
}

/**
 * 刚刚是不是「開獎那一下」。
 *
 * @source 原版在日期推进里判 `(日期 & 0xff) == 15`（VA 0x0041d080），
 *   随后 `call 0x431712` 开屏；一张票都没卖出去时那个循环直接返回
 *   （VA 0x00431720），屏根本不建。本引擎的对应点是 `advanceGameDay`
 *   里的 `if (date.day === LOTTERY_DRAW_DAY)`（`reduce.ts`）。
 *
 * @param before 开奖前的状态
 * @param after  开奖后的状态
 */
export function lotteryDrawCue(before: GameState, after: GameState): DrawCue | null {
  if (after.day !== 15 || after.totalDays === before.totalDays) return null;
  // 一张票都没卖出 → 原版压根不开屏（号码表原样，公库原样）
  if (before.lottery.every((v) => v === 0)) return null;
  // 有人中奖 ⇒ 号码表被清空、公库清零；没人中奖 ⇒ 两者原样
  const cleared = after.lottery.every((v) => v === 0) && after.pool !== before.pool;
  const number = cleared ? pickClearedNumber(before, after) : null;
  if (number === null && !cleared) {
    // 没人中奖：号码猜不回来（见 `DrawCue.numberUnknown`），当 0 号播
    return { number: 0, numberUnknown: true, winner: null, prize: before.pool, sold: [...before.lottery], owner: null };
  }
  if (number === null) return null;
  const owner = (before.lottery[number] ?? 0) - 1;
  return {
    number,
    numberUnknown: false,
    winner: owner >= 0 ? owner : null,
    prize: before.pool,
    sold: [...before.lottery],
    owner: owner >= 0 ? owner : null,
  };
}

/**
 * 号码表被清空时把中奖号反推回来。
 *
 * 原版是 `rand()` 直接掷出来的（`0x00430b52` / `0x00430b66`），掷完就写进
 * `[0x48c37d]` —— 状态机之外**没有任何地方留下它**。本引擎的 `drawLottery`
 * 同样只在返回值里给出，`GameState` 里没这个字段（不许改 `types.ts`）。
 * 于是只能从差分反推：**清空前唯一那个属于得主（现金刚好多了「开奖前公库」）的号**。
 */
function pickClearedNumber(before: GameState, after: GameState): number | null {
  let winner = -1;
  for (let i = 0; i < after.players.length; i++) {
    const gained = (after.players[i]?.cash ?? 0) - (before.players[i]?.cash ?? 0);
    if (before.pool > 0 && gained === before.pool) winner = i;
  }
  const owned = (who: number): number[] => {
    const out: number[] = [];
    for (let n = 0; n < before.lottery.length; n++) if ((before.lottery[n] ?? 0) === who + 1) out.push(n);
    return out;
  };
  if (winner >= 0) return owned(winner)[0] ?? null;
  if (winner < 0 && before.pool <= 0) return null;
  // 现金那条对不上（得主同时又被扣了别的钱）：退到「号码表里只剩一个人的号」
  const owners = new Set(before.lottery.filter((v) => v !== 0));
  if (owners.size !== 1) return null;
  return owned([...owners][0]! - 1)[0] ?? null;
}

// ============================================================
//  纯函数：各人持号表
// ============================================================

/**
 * 把某个玩家持有的号码拼成 `"%02d"` 串。
 * @source 0x0042f4e8 起的 `sprintf(buf, "%02d", n + 1)` + `strcat`
 */
export function tallyString(lottery: readonly number[], player: number): string {
  let out = '';
  for (let n = 0; n < lottery.length; n++) {
    if ((lottery[n] ?? 0) === player + 1) out += String(n + 1).padStart(2, '0');
  }
  return out;
}

/** 一行最多放几个字符 @source 0x42f543 的 `cmp eax, 0xc / jg` */
export const TALLY_LINE_CHARS = 0x0c;
/** 折行后第二行相对第一行的 y 偏置 @source 0x42f68e 的 `add [esp+0x6c], 0x1e` */
export const TALLY_LINE_DY = 0x1e;
/** 数字牌之间的间距 @source 0x42f696 的 `add esi, 0x28` */
export const TALLY_PITCH = TALLY_TEXT.pitch;
/** 一个号码的两位数字相距 @source 0x42f64f 的 `lea eax, [esi + 0x10]` */
export const TALLY_DIGIT_DX = 0x10;

/** 一个数字牌要落的位置 */
export interface DigitAt {
  /** 是号码的哪一位（0 = 十位、1 = 个位）*/
  digit: number;
  x: number;
  y: number;
}

/**
 * 把 `"%02d"` 串摊成一张张数字牌。
 *
 * @source 0x0042f55b（一行内）与 0x0042f5e9（折行）：
 * 起点 `铭牌 + (0x36, 0x1e)`，每两位数字步进 `0x28`、第二位移 `0x10`；
 * 超过 `0xc` 个字符才折行，折行后 y 再加 `0x1e`。
 *
 * ★ `player` 与 `plate` 是**两个号**：前者决定读谁持有的号码，后者决定落在第几块
 *   铭牌上（原版出局的人不占铭牌，见 `drawTally`）。默认两者相同。
 */
export function tallyDigits(lottery: readonly number[], player: number, plate = player): DigitAt[] {
  const text = tallyString(lottery, player);
  const at = TALLY_PLATES[plate];
  if (at === undefined) return [];
  const out: DigitAt[] = [];
  const n = Math.min(text.length, TALLY_LINE_CHARS * 2);
  for (let i = 0; i < n; i += 2) {
    const row = i >= TALLY_LINE_CHARS ? 1 : 0;
    const col = i - row * TALLY_LINE_CHARS;
    const x = at[0] + TALLY_TEXT.dx + (col / 2) * TALLY_PITCH;
    const y = at[1] + TALLY_TEXT.dy + row * TALLY_LINE_DY;
    out.push({ digit: Number(text[i] ?? '0'), x, y });
    if (i + 1 < n) out.push({ digit: Number(text[i + 1] ?? '0'), x: x + TALLY_DIGIT_DX, y });
  }
  return out;
}

/** 某人的角色徽章（`Panel#15` 的图号）@source 0x42f4c5 `lea edx, [eax + 0x19]` */
export function badgeEntry(character: number): number {
  return ENTRY.badge + character;
}

/** 徽章 / 人像条落点 —— 就是铭牌坐标本身（表里存的是「舞台坐标 − 0x14/−0x1e」）*/
export function tallyArtAt(player: number): readonly [number, number] | null {
  return TALLY_PLATES[player] ?? null;
}

// ============================================================
//  ANM 的节拍
// ============================================================

/**
 * 原版给每个 FLIC 定的**起始延时**（毫秒/帧）。
 *
 * ⚠️ **不是** FLIC 头里的 `speed`（那些头里写的是 71 ms）：
 * 原版把它读进 `[0x48c870]` 之后**从来不读**，真正用的是 `[0x48c864]` ——
 * 没给 `flags` 时取 `0x370`（880），给了则取 `0x500`（1280）。
 * @source 0x00450e9c（`mov dword [0x48c864], 0x370`）与 0x00450eb1（`0x500`）
 *
 * 于是摇球 42 帧 ≈ 37 秒、礼花 37 帧 ≈ 33 秒 —— 这正是「状态 6 要等到
 * 第 30 帧**且** ANM 播完」这条判据会卡住那么久的原因（`0x00430f43`）。
 */
export const ANM_FRAME_MS = 0x370;

/** `tick` 这一刻该播第几帧；放完返回 `nFrames − 1` */
export function anmFrameAt(now: number, start: number, nFrames: number, loop = false): number {
  if (nFrames <= 0) return 0;
  const elapsed = now - start;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  const n = Math.floor(elapsed / ANM_FRAME_MS);
  return loop ? n % nFrames : Math.min(n, nFrames - 1);
}

/** 这一段放完了没有 @source `fcn_00450f04` 返回 0 = 完 */
export function anmDone(now: number, start: number, nFrames: number): boolean {
  return now - start >= nFrames * ANM_FRAME_MS;
}

// ============================================================
//  纯函数：脸（眨眼 / 嘴）
// ============================================================

/**
 * 两个主持人的脸是**贴片拼的**：`0x48c350` 一个 dword 当调色盘，
 * 低 4 位 = 当前在动的那一个槽，其余每个 4 位段 = 该槽的帧号。
 *
 * | 槽 | 贴片矩形 (x0,y0)-(x1,y1) | 帧表（图号）| 抽中的概率 |
 * |---|---|---|---|
 * | 1 | 右眼 (512,**102**)-(562,**118**) | 8,7,8,10 | 1/64 @source 0x00431117 |
 * | 2 | 左眼 (52,**89**)-(102,**115**) | 16,17,16,15 | 1/64 @source 0x00431138 |
 * | 3 | 右眼变体 | 9,10 | 2/64 @source 0x00431141 |
 * | 4 | 左眼变体 | 14,15 | 2/64 @source 0x0043114a |
 *
 * 帧表本体在 `0x00475660`（dump 出来 = `3 4 3 | 8 7 8 10 | 16 17 16 15 | 31 | 0 0 0 0 0 0 0 | ff ff ff ff`）：
 * 槽 2 的表在 **+3**、槽 3 在 **+7**、槽 4 在 **+10**、槽 5 在 **+12**。
 *
 * ★ 原来的表把**前两项对调**了：槽 1（低 4 位 = 1）读的是表 +3 = `8,7,8,10`，
 *   槽 2（低 4 位 = 2）读的是表 +7 = `16,17,16,15` —— 本模块按这个来。
 *
 * ⚠️ 2026-09-18 订正：上表先前的 y 写成 `510..535` / `524..548`（那是把
 *   `0x66`/`0x59` 当十进制 %d 之类读出来的错值）。exe 逐字：
 * ```asm
 * 00431166  mov  dword ptr [esp + 0x64], 0x200   ; x0 = 512
 * 0043116e  mov  dword ptr [esp + 0x68], 0x66    ; y0 = 102
 * 00431176  mov  dword ptr [esp + 0x6c], 0x232   ; x1 = 562
 * 0043117e  mov  dword ptr [esp + 0x70], 0x76    ; y1 = 118
 * 00431231  mov  dword ptr [esp + 0x64], 0x34    ; 左眼 x0 = 52
 * 00431239  mov  dword ptr [esp + 0x68], 0x59    ; y0 = 89
 * 00431241  mov  dword ptr [esp + 0x6c], 0x66    ; x1 = 102
 * 00431249  mov  dword ptr [esp + 0x70], 0x73    ; y1 = 115
 * ```
 *   ★ 真正用到的只有**左上角**：`0043119c mov ecx,[esp+0x68] / push ecx`（=y0）
 *   与 `004311a1 mov edi,[esp+0x68]`（push 之后 = 旧 `[esp+0x64]` = x0）`/ push edi`
 *   → `call 0x4563f5(dst, src, x0, y0)`；**尺寸由 sprite 记录自带**。
 *   所以「四角是闭区间端点、宽度 = x1−x0+1」这句**不适用于这两个调用点**。
 */
export const FACE_SLOT_RECT = {
  right: [0x200, 0x66, 0x232, 0x76],
  left: [0x34, 0x59, 0x66, 0x73],
} as const;

/** 槽 1..5 的帧表 @source `0x00475660`+0 = `31,0`、+3 = 槽 2、+7 = 槽 3、+10 = 槽 4 */
export const FACE_SLOT_FRAMES: readonly (readonly number[])[] = [
  [], // 0 = 空档（表 +0 那两字节是 `0x1f`/`0`，不是帧表）
  [8, 7, 8, 10], // 槽 1 → 表 +3
  [16, 17, 16, 15], // 槽 2 → 表 +7
  [9, 10], // 槽 3 → 表 +10
  [14, 15], // 槽 4 → 表 +12
];

/** 每个槽的帧数与「该槽结束」的条件位（主 nibble 的下一位）@source 0x00431157 `/ 00431222` */
const FACE_SLOT_BIT = [0, 1, 2, 4, 8] as const;

/** 槽 1..4 各自的贴片矩形（取低 4 位的槽号）*/
function slotRect(slot: number): readonly [number, number, number, number] {
  return slot === 1 || slot === 3 ? FACE_SLOT_RECT.right : FACE_SLOT_RECT.left;
}

/** 右主持人的嘴 @source 0x00431447 的 `0x200/0x77/0x232/0x8d`；静止图 11、动图 12/13 */
export const FACE_MOUTH_RECT = [0x200, 0x77, 0x232, 0x8d] as const;
export const FACE_MOUTH_REST = 11;

export interface FaceCtl {
  /** `[0x48c350]` */
  ctl: number;
  /** `[0x48c34c]`（嘴的倒数）*/
  mouth: number;
  /** 上一帧的槽（查表用，等价于 `ctl & 0xf`）*/
  slot: number;
  /** 上一次推进的脸帧号（避免一帧内推进两次）*/
  tick: number;
}

export function faceCtlStart(): FaceCtl {
  return { ctl: 0, slot: 0, mouth: 0, tick: -1 };
}

/** 贴片：图号 + 落点（锚点 (0,0)，所以落点就是矩形左上角）*/
export interface FaceBlit {
  entry: number;
  at: readonly [number, number];
}

/**
 * 推进一帧脸。
 *
 * @param rnd 取 `[0,1)` 的随机数（原版是 `_libc_rand()`，注入进来只为单测能钉死）
 *
 * ★ **原版是 `rand()>>9` 抽的**（`0x00431117` 一带）：落 0 / 1 / 2-3 / 4-5 时
 *   分别启动槽 1/2/3/4，其余 58/64 不动 —— 平均 0.9 秒才跳一次。这里改成
 *   **按帧号推**（用同一个 `hash32`，与 `core` 的 `facePartsAt` 同源），
 *   不是改良：动画不该消耗游戏随机流（C-DET-1）。每个槽的**触发概率**照抄。
 *
 * ★ 嘴：`rand() >> 11 < 4`（= 1/512）才换一张，换完 `rand() & 0xf` 决定停几帧；
 *   因为触发率极低，屏上基本看不到它动。照抄。
 */
export function faceStep(f: FaceCtl, tick: number, rnd: () => number): readonly FaceBlit[] {
  const out: FaceBlit[] = [];
  const slot = f.ctl & 0x0f;

  if (slot >= 1 && slot <= 4) {
    const frames = FACE_SLOT_FRAMES[slot]!;
    const idx = (f.ctl & 0xf0) >> 4;
    if (idx < frames.length) {
      // 本帧的贴片
      const r = slotRect(slot);
      out.push({ entry: frames[idx]!, at: [r[0], r[1]] });
      let ctl = f.ctl + 0x10;
      const idx2 = (ctl & 0xf0) >> 4;
      if (idx2 >= frames.length) {
        // 该槽放完了 —— 立 bit（= 表里的 `31`）并等下一轮触发
        ctl |= FACE_SLOT_BIT[slot]! << 4;
        ctl &= 0xf0;
      }
      f.ctl = ctl;
      f.slot = ctl & 0x0f;
    }
  } else if (slot === 0) {
    // `rand() >> 9` 落在 0/1/2-3/4-5 才起一个槽，其余不动
    const roll = Math.floor(rnd() * 64);
    const next = roll === 0 ? 1 : roll === 1 ? 2 : roll < 4 ? 3 : roll < 6 ? 4 : 0;
    if (next !== 0) f.ctl = (f.ctl & 0xf0) | next;
  }

  // 嘴
  if (f.mouth !== 0) {
    f.mouth -= 1;
    if (f.mouth === 0) {
      const r = FACE_MOUTH_RECT;
      out.push({ entry: rnd() < 0.5 ? 12 : 13, at: [r[0], r[1]] });
    }
  } else {
    const roll = Math.floor(rnd() * 2048);
    if (roll < 4) {
      const r = FACE_MOUTH_RECT;
      out.push({ entry: rnd() < 0.5 ? 12 : 13, at: [r[0], r[1]] });
      f.mouth = Math.floor(rnd() * 16) || 1;
    }
  }

  return out;
}

// ============================================================
//  台词与气泡
// ============================================================

/** 气泡落点与字的中心 @source 建屏 0x0042f6f5（`0x12c/0x2f/−0xa/0`）*/
export const DRAW_BUBBLE_AT = [0x12c, -0x0a] as const;
export const DRAW_BUBBLE_TEXT = { dx: -0x0a, dy: 0, size: 0x14 } as const;

/** 气泡里的字（`#NNNN` 语音前缀被吃掉）@source `_rich4_draw_text` VA 0x0044fabc 开头 */
export function bubbleLines(text: string | null): string[] {
  if (text === null) return [];
  // ★ 收敛到唯一入口：顺手播 `#NNNN`
  const body = playVoiceCode(text);
  return body.split('\n').filter((l) => l !== '');
}

/** 台词串首的语音号；没有返回 `null` */
export function voiceOf(text: string): number | null {
  if (!text.startsWith('#')) return null;
  const n = Number(text.slice(1, 5));
  return Number.isFinite(n) ? n : null;
}

/**
 * 得主名字 —— 28 px 红字，居中的 (320, 180)。
 * @source 0x004305e8 起：`图号 = 角色`、表 `0x00475630`、坐标 `0x140/0xb4`、flag 2
 */
export function winnerName(character: number): string {
  return CHARACTERS[character]?.name ?? '';
}

/** 「累積獎金」标签 */
export const POOL_LABEL = LOTTERY.poolLabel.text;

// ============================================================
//  播放
// ============================================================

/** 一个正在播的 ANM */
interface Playing {
  resource: number;
  at: readonly [number, number];
  start: number;
  frames: number;
}

interface Active {
  cue: DrawCue;
  steps: readonly CeremonyStep[];
  step: number;
  /** 当前这一步是什么时候进来的 */
  at: number;
  /** 当前这一步的气泡是什么时候说的 */
  said: number;
  face: FaceCtl;
  /** 最新的脸贴片快照 —— `tick` 推进，`draw` 只读 */
  faceBlits: readonly FaceBlit[];
  drum: Playing | null;
  flower: Playing | null;
  /**
   * ★★ W-68-b：**持久的离屏表面**（640×480）。
   *
   * 原版整屏就是这么一块：建屏时画一次（底图 + 两位主持人 + 「累積獎金」+ 金额 +
   * 持号表），之后每个状态只在上面**擦一块、补一块**，前面画的都还在。
   * 先前本引擎每帧从底图重画、却只画当前这一步 ⇒ 建屏那一步画的主持人与奖金
   * 到下一步就没了（截图里状态 2 台上没有主持人、状态 3 左边那块板是空的）。
   */
  surface: CeremonySurface | null;
  /**
   * 已经**烤进表面**的最后一步。
   *
   * ★ 初值 **−2** = 「什么都还没烤」—— 第 **−1** 步是**建屏**那一步
   *   （底图 + 主持人 + 奖金 + 持号表），所以要烤的下一个下标是 `applied + 1 = −1`。
   */
  applied: number;
  /**
   * 开场就定下的一份「谁在场 / 各人角色号」快照。
   *
   * ★ 持号表每一步都要照它重画（表面持久，晚一步的 `env.state` 可能已经变了），
   *   出局的人不占铭牌 —— 存档里也拿得到，所以这里存快照而不是每次读 `env`。
   */
  characters: readonly number[];
  alive: readonly boolean[];
  /** 同一步连着几帧没烤成（图没到货）—— 用来给 `CEREMONY_BAKE_RETRIES` 计数 */
  bakeTries: number;
}

/**
 * 同一步最多等几帧「图到货」（`TICK`/帧率都是 50–60，30 帧 ≈ 半秒）。
 * 超过就照烤 —— 见 `applyStep` 的 `force`。
 */
export const CEREMONY_BAKE_RETRIES = 30;

/** 离屏表面 —— 能拿到 `CanvasRenderingContext2D` 就行 */
export interface CeremonySurface {
  readonly canvas: CanvasImageSource;
  readonly ctx: CanvasRenderingContext2D;
}

/**
 * 造一块表面 —— 优先 `OffscreenCanvas`，退回 `<canvas>`；两者都没有返回 `null`
 * （Node 下的单测就是这种情形，走 `setCeremonySurfaceFactory` 注入假表面）。
 */
function defaultSurface(): CeremonySurface | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(SCREEN_W, SCREEN_H);
    const ctx = c.getContext('2d');
    if (ctx !== null) return { canvas: c as unknown as CanvasImageSource, ctx: ctx as unknown as CanvasRenderingContext2D };
    return null;
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = SCREEN_W;
    c.height = SCREEN_H;
    const ctx = c.getContext('2d');
    if (ctx !== null) return { canvas: c, ctx };
  }
  return null;
}

let surfaceFactory: () => CeremonySurface | null = defaultSurface;

/** ★ 给单测注入假表面（生产代码不调）—— 与 `main.ts` 的 `__devHits` 同一类口子 */
export function setCeremonySurfaceFactory(f: (() => CeremonySurface | null) | null): void {
  surfaceFactory = f ?? defaultSurface;
}

let active: Active | null = null;

/** 本屏现在在不在播 */
export function lotteryDrawActive(): boolean {
  return active !== null;
}

/** 当前演到第几步 / 是哪一步（单测用）*/
export function lotteryDrawStep(): number {
  return active?.step ?? -1;
}

export function lotteryDrawPhase(): number {
  return active?.steps[active.step]?.state ?? -1;
}

export function resetLotteryDrawScreenState(): void {
  active = null;
}

/**
 * 号码球那 10 张子图的图号区间 —— `ENTRY.ball` = 37 → **37..46**
 * （球号 = `37 + 数字`，@source 0x00430c17 的 `图号 = 数字 + 0x25`）。
 */
export const BLIT_BALL_RANGE = { from: ENTRY.ball, to: ENTRY.ball + 9 } as const;

/**
 * 号码球那 10 张子图（37..46）—— 从 core 脚本的 `blits` 里**全部**摘掉。
 *
 * ★ 范围必须是 **37..46 整整十张**，不能只摘 `37/38/46`：
 *   那三张正好是 **0 / 1 / 9 三颗球**。原来只摘它们，于是开出含 0/1/9 的号码时
 *   那颗球在「开号」这一步**既被 core 脚本贴着、又被 `CEREMONY_BALLS` 挡着**，
 *   结果晚一步才出现（号码里没有 0/1/9 时看不出问题 —— 探针核过）。
 *   摘全十张之后，屏上的球只有 `drawBalls` 一个出口，与 `CEREMONY_BALLS` 逐位对齐。
 */
const BLIT_BALL_ENTRIES: ReadonlySet<number> = new Set(
  Array.from({ length: BLIT_BALL_RANGE.to - BLIT_BALL_RANGE.from + 1 }, (_, d) => BLIT_BALL_RANGE.from + d),
);

/** 单测用：某个图号是不是号码球（37..46）*/
export function isBallEntry(entry: number): boolean {
  return BLIT_BALL_ENTRIES.has(entry);
}

/**
 * 把 core 脚本的一步整成「本屏要播的那一步」。
 *
 * ★ 号码球那几次贴图**从 core 的 `blits` 里摘掉**：`CEREMONY_BALLS` 才是
 *   按 exe 核过的「哪几步要重贴」，两边都留着就会重画（虽无害，但顺序读不清）。
 */
function localizeStep(s: CeremonyStep): CeremonyStep {
  return { ...s, blits: s.blits.filter((b) => !BLIT_BALL_ENTRIES.has(b.entry)) };
}

/**
 * 「動畫過程」关掉时要丢掉哪几步。
 *
 * @source `loc_004301b0`（VA 0x004301b0，開獎屏 `0x401` 铺场那一支的尾）：
 * ```asm
 * 004301b0  cmp byte [0x497159], 0      ; ★ RICH4.CFG+1 = 「動畫過程」
 * 004301b7  je  short loc_004301d4
 * 004301b9  mov byte [0x48c37b], 1      ; 开：状态 1（主持人开场那句）
 * 004301c0  mov edx, [0x475610]         ;     `#0017嗨！又到了每月十五號樂透開獎時間～`
 * 004301c7  call 0x44ecb6
 * 004301d4  mov byte [0x48c37b], 2      ; 关：**直接落在状态 2**（报幕）
 * ```
 * 所以关掉时**只少状态 1 那一步**，后面 2..10 一模一样
 * （它没有任何 blit/patch，只有一句台詞 —— 见 `lottery-ceremony.ts` 的 `steps[0]`）。
 */
export function ceremonyStepsFor(
  steps: readonly CeremonyStep[],
  animate: boolean,
): readonly CeremonyStep[] {
  return animate ? steps : steps.filter((s) => s.state !== 1);
}

/** 起播 */
function begin(cue: DrawCue, env: UiScreenEnv): void {
  const all = lotteryCeremony({
    number: cue.number,
    winner: cue.winner,
    prize: cue.prize,
    lottery: [],
    pool: cue.winner === null ? cue.prize : 0,
    rigged: false,
  }).map(localizeStep);
  const steps = ceremonyStepsFor(all, env.animation !== false);
  if (steps.length === 0) return;
  active = {
    cue,
    steps,
    step: 0,
    at: env.now,
    said: env.now,
    face: faceCtlStart(),
    faceBlits: [],
    drum: null,
    flower: null,
    surface: surfaceFactory(),
    applied: -2,
    characters: env.state.players.map((p) => p.character),
    alive: env.state.players.map((p) => isAlive(p)),
    bakeTries: 0,
  };
  // 建屏那一下不在任何状态里（`fcn_0042f6c3` 是 WM_CREATE 直接画的）
  startAnim(steps[0] ?? null, env);
}

/** 这一步要起的 ANM（摇球 / 礼花）—— 帧数靠 `env.flic` 现问，问不到就不画 */
function startAnim(step: CeremonyStep | null, env: UiScreenEnv): void {
  if (active === null || step === null || step.anim === null) return;
  const a = step.anim;
  const film = env.flic('Panel.mkf', a.panel);
  const playing: Playing = {
    resource: a.panel,
    at: [a.at[0], a.at[1]],
    start: env.now,
    frames: film?.frames.length ?? 0,
  };
  if (a.panel === DRAW_FLOWER_RESOURCE) active.flower = playing;
  else active.drum = playing;
}

/** 推进一帧脸 @source 每 50 ms 那一拍调一次（`0x00431431` 那一支）*/
function tickFace(a: Active, env: UiScreenEnv): void {
  const tick = Math.floor(env.now / CEREMONY_TICK_MS);
  if (tick === a.face.tick) return;
  a.face.tick = tick;
  a.faceBlits = faceStep(a.face, tick, Math.random);
}

/**
 * ★★ 单步**最多**停多久 —— 过了就无条件往前走（死锁保护）。
 *
 * 为什么必须有：`holdDone` 里「等 ANM 放完」那条判据依赖 `env.flic()` 解出帧数。
 * `main.ts` 的 `uiFlicNow` 会把**解不出来**的结果缓存成 `null`，于是
 * `p.frames` 永远是 0、`anmDone` 永远为假 —— 屏就永远关不掉，
 * 而演出闸（`BLOCKING_PRESENTATIONS`）会把整局钉死在这里（试玩长跑第 23 条）。
 *
 * 原版不会遇到这种情况：`read_mkf` 是**同步**的，解不出来它自己就崩了。
 *
 * 取值 **90 000 ms**：最长的一步是状态 3 的摇球（42 帧 × 880 ms ≈ 37 秒，
 * 再加 20 拍 = 1 秒）。90 秒是它的两倍多，正常演出永远碰不到这条闸；
 * 它只在「影片根本解不出来」时兜底。
 */
export const CEREMONY_STEP_MAX_MS = 90_000;

/**
 * 这一刻该不该往下一步走 @source 0x004301e8 的「气泡收掉才走下一步」，
 * 加上 `0x0043024c` / `0x00430f43` 那两处「数够帧」与「等 ANM 放完」。
 */
function holdDone(a: Active, env: UiScreenEnv): boolean {
  const step = a.steps[a.step];
  if (step === undefined) return true;
  // ★★ 死锁保护：影片解不出来时那条「等 ANM 放完」会永远为假（见 `CEREMONY_STEP_MAX_MS`）
  if (env.now - a.at >= CEREMONY_STEP_MAX_MS) return true;
  const h = step.hold;
  if (h.pauseMs !== undefined && env.now - a.said < h.pauseMs) return false;
  if (h.ticks !== undefined && (env.now - a.at) / CEREMONY_TICK_MS < h.ticks) return false;
  if (h.anim === true && step.anim !== null) {
    const panel = step.anim.panel;
    const p = panel === DRAW_FLOWER_RESOURCE ? a.flower : a.drum;
    if (p !== null) {
      // ⚠️ `env.flic()` 是**异步**的：起播那一刻多半还是 null，帧数要等它解好再补。
      //    不补的话「等 ANM 放完」这条判据永远卡着 —— 屏就再也关不掉了。
      if (p.frames === 0) p.frames = env.flic('Panel.mkf', panel)?.frames.length ?? 0;
      if (p.frames > 0 && !anmDone(env.now, p.start, p.frames)) return false;
    } else {
      // 起播时还没解出来、现在解好了 —— 从现在开始算它的播放
      const film = env.flic('Panel.mkf', panel);
      if (film !== null) {
        const started: Playing = { resource: panel, at: step.anim.at, start: env.now, frames: film.frames.length };
        if (panel === DRAW_FLOWER_RESOURCE) a.flower = started;
        else a.drum = started;
        return false;
      }
    }
  }
  if (h.voice === true && step.line !== null && env.now - a.said < CEREMONY_VOICE_MS) return false;
  return true;
}

/** 推进一步 */
function advance(a: Active, env: UiScreenEnv): void {
  a.step += 1;
  a.at = env.now;
  a.said = env.now;
  const step = a.steps[a.step];
  if (step === undefined) {
    env.log('樂透開獎：演出结束');
    active = null;
    return;
  }
  if (step.line !== null) env.log(`樂透開獎：${bubbleLines(step.line.text).join('')}`);
  startAnim(step, env);
}

// ============================================================
//  绘制（只做 IO）
// ============================================================

/** 抠黑画（`fcn_00456418`：索引 0 透明）*/
function drawKeyed(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/** 不透明画（`fcn_004563f5`）*/
function drawOpaque(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

function blit(ctx: CanvasRenderingContext2D, s: Sprite | null, b: CeremonyBlit): void {
  if (b.opaque === true) drawOpaque(ctx, s, b.at[0], b.at[1]);
  else drawKeyed(ctx, s, b.at[0], b.at[1]);
}

/**
 * 「擦除」= 从干净子图上**原样拷一块矩形回来**（`fcn_0045643d`）。
 *
 * ★ 不是填背景色 —— 底图上那块本来就画着台座、幕布、地板。
 */
function erase(ctx: CanvasRenderingContext2D, sprite: DrawSprite, r: EraseRect): void {
  const src = sprite('Panel.mkf', DRAW_RESOURCE, r.from, false);
  if (src === null) return;
  const c = resolveErase(r, src.width, src.height);
  if (c === null) return;
  // ★★ W-68-c：这里原来还有一对**纯空转**的像素回读（先 `getImage`+`Data` 读出来、
  //   再 `putImage`+`Data` 原样写回去），每帧、每个擦除块都强制一次
  //   GPU→CPU 同步回读 —— Chromium 下看不出来，桌面包的 WKWebView 下就是卡顿主因。
  //   现在擦除只在**进入某一步时**做一次（见 `applyStep`），而且只贴这一块。
  ctx.drawImage(src.bitmap, c.sx, c.sy, c.w, c.h, c.dx, c.dy, c.w, c.h);
}

/** 画这一帧的 ANM（原版是 `fcn_00456b3e` 贴 RGB555 帧，这里是逐帧位图）*/
function drawAnim(ctx: CanvasRenderingContext2D, env: UiScreenEnv, p: Playing | null): void {
  if (p === null) return;
  const film = env.flic('Panel.mkf', p.resource);
  if (film === null || film.frames.length === 0) return;
  const i = anmFrameAt(env.now, p.start, film.frames.length, false);
  const frame = film.frames[i];
  if (frame === undefined) return;
  // ★ 原版这里**不能用锚点**：`fcn_00450ced(sprite, x, y, flags)` 的 x/y 是
  //   **左上角**（帧缓冲从 (x,y) 起铺），@source 0x00450d2a 起
  ctx.drawImage(frame, p.at[0], p.at[1]);
}

/**
 * 各人持号表（`fcn_0042f417`）。
 *
 * 每个人的顺序照 exe：**① 压暗那块 296×60 的底框 → ② 人像条 → ③ 徽章 → ④ 号码牌**。
 *
 * @param lottery 要显示的那一份号码表 —— ★ 用 **`cue.sold`（开奖前那一份）**，
 *   不是 `state.lottery`：原版是在**最后一步（状态 10）**才 `memset` 号码表的
 *   （@source 0x00430ab5 一带 `memset(0x4990b8, 0, 0x24)`，就在派彩之后），
 *   整场演出里铭牌上一直看得见各人的号码。见 `DrawCue.sold`。
 */
export function drawTally(
  ctx: CanvasRenderingContext2D,
  sprite: DrawSprite,
  lottery: readonly number[],
  characters: readonly number[],
  alive: readonly boolean[],
): void {
  // ★★ W-68-a：铭牌号与玩家号**分开数** —— 原版出局的人（`player+0x15 == 0`）
  //   整个跳过、**不占铭牌**（`0x0042f46b cmp byte [player+0x15],0 / je 0x42f6a2`：
  //   只 `inc [esp+0x70]` 玩家号，不 `inc [esp+0x74]` 铭牌号）。
  let plate = 0;
  for (let p = 0; p < characters.length && plate < TALLY_PLATES.length; p++) {
    if (alive[p] === false) continue;
    const art = tallyArtAt(plate);
    if (art === null) { plate += 1; continue; }
    // ① 压暗的底框（「四个蓝框」）@source 0x0042f482 的 `fcn_004552e7(…, 0x128, 0x3c, −16)`
    const frame = tallyFrameAt(plate);
    if (frame !== null) {
      ctx.fillStyle = `rgba(0,0,0,${TALLY_FRAME.alpha})`;
      ctx.fillRect(frame.x, frame.y, TALLY_FRAME.w, TALLY_FRAME.h);
    }
    // ② 角色徽章（Panel#15 图 = `ENTRY.badge + **角色号**`）
    //   ★ 先前写的是 `ENTRY.badge + p`（**玩家下标**）—— 错。
    //   @source `0x0042f4b1 mov al,[player+0x13] / lea edx,[eax+0x19]`（0x19 = 25 = badge）
    drawKeyed(
      ctx,
      sprite('Panel.mkf', DRAW_RESOURCE, ENTRY.badge + (characters[p] ?? 0), true),
      art[0] + TALLY_ART_AT.dx,
      art[1] + TALLY_ART_AT.dy,
    );
    // ③ 持号数字（内容按**玩家号**读，落点按**铭牌号**）
    for (const d of tallyDigits(lottery, p, plate)) {
      drawKeyed(ctx, sprite('Panel.mkf', DRAW_DIGIT_RESOURCE, d.digit, true), d.x, d.y);
    }
    plate += 1;
  }
}

/** flag 2（正中）的文字 @source 跳表 `0x44faa0` 第 2 项（VA 0x0044ff2a）*/
function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  outline: string | null,
): void {
  ctx.font = font(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (outline !== null) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** 千分位金额 —— 原版 `_rich4_num_to_currency_string`（VA 0x00452793）*/
export function currency(n: number): string {
  return `$${Math.trunc(n).toLocaleString('en-US')}`;
}

/** 这一刻屏上是什么样 —— 纯数据，`draw` 只负责摆上去 */
export interface DrawView {
  step: number;
  state: number;
  cue: DrawCue;
  /** 这一刻的脸贴片 */
  face: readonly FaceBlit[];
  /** 气泡里那几句话；空数组 = 不画气泡 */
  lines: readonly string[];
  /** 中奖号两颗球的图号（十位、个位）*/
  balls: readonly [number, number];
  /**
   * 得主名（`null` = 不公布）。
   *
   * ★ 原版在**状态 4** 把它画在 (320,180)，之后**再也不擦** —— 所以从公布那一步
   *   往后（5/6/8/9/10）它一直留在屏上，`view` 也照这个来。
   */
  winner: string | null;
  /** 持号表用哪一份号码表 */
  lottery: readonly number[];
  players: number;
}

/** 现在该画成什么样 —— `draw` 用（**不改任何状态**）*/
function viewOf(a: Active, env: UiScreenEnv): DrawView {
  const step = a.steps[a.step]!;
  const line = step.line;
  const showBubble = line !== null && env.now - a.said <= CEREMONY_VOICE_MS;
  const tens = Math.floor(a.cue.number / 10) % 10;
  const ones = a.cue.number % 10;
  // 公布得主那一步之后，那个名字一直留在屏上（原版不擦它）
  const announced = a.steps.slice(0, a.step + 1).some((x) => x.texts.includes('winnerName'));
  return {
    step: a.step,
    state: step.state,
    cue: a.cue,
    face: a.faceBlits,
    lines: showBubble && line !== null ? bubbleLines(line.text) : [],
    balls: [ENTRY.ball + tens, ENTRY.ball + ones],
    winner: announced && a.cue.winner !== null
      ? winnerName(env.state.players[a.cue.winner]?.character ?? 0)
      : null,
    // ★ 用**开奖前**那份号码表（`cue.sold`）：原版直到最后一步才清它
    //   （@source 0x00430ab5 一带的 `memset(0x4990b8, 0, 0x24)`，就在派彩之后），
    //   整场演出里铭牌上一直看得见各人的号码。
    //   `state.lottery` 在「有人中奖」那一路**开奖那一刻就被 core 清空了**
    //   （`places/lottery.ts` 返回 `emptyLottery()`，`reduce.ts` 同一次 action 里写回），
    //   拿它去画就是四块空铭牌 —— 这正是「中奖反而看不到号码」的根因。
    lottery: a.cue.sold,
    players: env.state.players.length,
  };
}

/**
 * 画整屏。
 *
 * 顺序照原版：**底图 → 擦台面（本模块补的 + 脚本自带的）→ 摇球 ANM →
 * 铺图 → 号码球 → 脸贴片 → 持号表 → 文字 → 气泡**。
 *
 * ★ 擦除必须**全部**在人之前：那两片擦的正是他们身上的板与腿
 *   （@source 0x4303d0 `(472,66)-(607,346)` / 0x430418 `(7,116)-(141,246)`），
 *   擦完紧接着把他们重画回去 —— 所以不能「逐张精灵自带顺序」。
 *   ★ 持号表那一条带（608×130，压在人腿上）也必须在人之前擦。
 */
export function drawCeremony(ctx: CanvasRenderingContext2D, env: UiScreenEnv, v: DrawView): void {
  const a = active;
  if (a === null) return;
  const surface = a.surface;
  if (surface === null) return; // 拿不到离屏表面（无 DOM）⇒ 整屏不画，别的照常

  // ★★ W-68-b：先把**还没烤的每一步**依次烤进表面（`while` —— 一帧可能跨好几步）。
  //   原版就是一块持久表面：建屏画一次，之后每个状态只在上面擦一块、补一块。
  //   有图没解好就整步不烤、下一帧再来；同一张图连等 `CEREMONY_BAKE_RETRIES` 帧还没到
  //   就照烤（缺哪张少哪张），否则一张永远解不出来的图会把整场戏钉成空白。
  while (a.applied < v.step) {
    const next = a.applied + 1;
    if (!applyStep(a, next, env, a.bakeTries >= CEREMONY_BAKE_RETRIES)) {
      a.bakeTries += 1;
      break;
    }
    a.bakeTries = 0;
    a.applied = next;
  }

  // ① 持久表面（底图 + 主持人 + 奖金 + 走过的每一步）
  ctx.drawImage(surface.canvas, 0, 0);

  // ② 摇球 / 礼花 ANM 的**当前帧**（原版是逐帧贴进表面之外的活画面）
  drawAnim(ctx, env, a.drum);
  drawAnim(ctx, env, a.flower);

  // ③ 脸贴片（原版在状态 4..8 之间有闸，见 `0x004310eb`：那几步脸是冻住的）
  if (!(v.state >= 4 && v.state <= 8)) {
    for (const f of v.face) {
      blit(ctx, env.sprite('Panel.mkf', DRAW_RESOURCE, f.entry, false), { entry: f.entry, at: f.at, opaque: true });
    }
  }

  // ④ 气泡（最后画，压在人身上）
  if (v.lines.length > 0) drawBubble(ctx, env.sprite as unknown as DrawSprite, v.lines);
}

/** 这一步要擦的每一块（`CEREMONY_ERASE[step] + step.patches`，次序照原版）*/
function stepErases(step: CeremonyStep, stepIndex: number): EraseRect[] {
  return [...(stepIndex < 0 ? [] : (CEREMONY_ERASE[stepIndex] ?? [])), ...step.patches.map(coreErase)];
}

/** 这一步要铺的每一张（`step.blits + CEREMONY_BLIT[step]`）*/
function stepBlits(step: CeremonyStep, stepIndex: number): readonly CeremonyBlit[] {
  return [...step.blits, ...(stepIndex < 0 ? [] : (CEREMONY_BLIT[stepIndex] ?? []))];
}

/** 擦除块与持号表那一条带（`TALLY_BAND`，608×130）有没有相交 */
function hitsTallyBand(r: EraseRect): boolean {
  return r.dx < TALLY_BAND.x + TALLY_BAND.w && r.dx + (r.x1 - r.dx + 1) > TALLY_BAND.x
    && r.dy < TALLY_BAND.y + TALLY_BAND.h && r.dy + (r.y1 - r.dy + 1) > TALLY_BAND.y;
}

/**
 * 这一步要不要**重新**画持号表。
 *
 * 建屏那一步（`CEREMONY_BASE.tally === true`）当然要画；除此之外，凡是把铭牌那一条带
 * 擦回干净底图的步骤（core 脚本里第 3 / 5 / 7 步都带 `CLEAR_PLATES_BAND`）也必须在擦完
 * 之后补画一遍 —— 否则铭牌会被擦空（首席看到的「四块空白」之二）。
 * 带没被动过的步骤不必重画：表面是持久的，前面画的还在。
 */
function stepDrawsTally(step: CeremonyStep, stepIndex: number): boolean {
  if (step.tally === true) return true;
  return stepErases(step, stepIndex).some(hitsTallyBand);
}

/** 这一步要用到的**每一张** sprite 都解好了吗（有一张没好就整步不烤）*/
function stepSpritesReady(a: Active, stepIndex: number, env: UiScreenEnv): boolean {
  const ready = (resource: number, index: number, keyed: boolean): boolean =>
    (env.sprite as (...xs: unknown[]) => Sprite | null)('Panel.mkf', resource, index, keyed) !== null;
  const step = stepIndex < 0 ? CEREMONY_BASE : a.steps[stepIndex];
  if (step === undefined) return false;
  for (const r of stepErases(step, stepIndex)) if (!ready(DRAW_RESOURCE, r.from, false)) return false;
  for (const b of stepBlits(step, stepIndex)) if (!ready(DRAW_RESOURCE, b.entry, b.opaque !== true)) return false;
  if (stepIndex >= 0 && (CEREMONY_BALLS[stepIndex] ?? false)) {
    const tens = Math.floor(a.cue.number / 10) % 10;
    const ones = a.cue.number % 10;
    if (!ready(DRAW_RESOURCE, ENTRY.ball + tens, true)) return false;
    if (!ready(DRAW_RESOURCE, ENTRY.ball + ones, true)) return false;
  }
  // 持号表这一步要重画的话，它用到的徽章与数字牌也得先解好
  if (stepDrawsTally(step, stepIndex)) {
    for (let p = 0; p < a.characters.length; p++) {
      if (a.alive[p] === false) continue;
      // ★ 徽章也要查！漏了它会让**建屏那一步**在徽章到货之前就烤完，
      //   而表面是持久的 ⇒ 徽章永远补不回来（2026-09-20 浏览器实测：
      //   进屏时 `Panel#15` 图 25 还没解出来，四块铭牌上只有号码、没有头像）。
      if (!ready(DRAW_RESOURCE, ENTRY.badge + (a.characters[p] ?? 0), true)) return false;
      for (const d of tallyDigits(a.cue.sold, p)) if (!ready(DRAW_DIGIT_RESOURCE, d.digit, true)) return false;
    }
  }
  return true;
}

/**
 * 把**某一步**烤进持久表面（W-68-b）。
 *
 * 次序照原版与 `drawCeremony` 的老顺序：
 * `CEREMONY_ERASE[step] + step.patches`（擦）→ `step.blits + CEREMONY_BLIT[step]`（铺）
 * → `CEREMONY_BALLS[step]` 为真则两颗球 → `step.tally` 为真则持号表 → `step.texts`。
 *
 * 第 **−1** 步 = 建屏：底图 + `CEREMONY_BASE`（两位主持人、气泡底、`poolLabel`/`poolAmount`、
 * `tally: true`）—— `@rich4/core` 的 `CEREMONY_BASE` 导出了它，客户端此前**从没用过**，
 * 这正是「开场主持人不见、牌子上没有奖金」的直接原因。
 *
 * @param force 图还没解好也照烤（见 `CEREMONY_BAKE_RETRIES`）—— 只在**等得太久**时才由
 *   `drawCeremony` 传 true：某一张图要是永远解不出来（索引越界之类），
 *   「不许烤一半」就会变成「整场戏一片空白」，那更糟。
 *
 * @returns 真的烤进去了才 `true`；有图没解好、或拿不到表面 ⇒ `false`（下一帧再试，**不烤一半**）
 */
export function applyStep(a: Active, stepIndex: number, env: UiScreenEnv, force = false): boolean {
  const surface = a.surface;
  if (surface === null) return false;
  const step = stepIndex < 0 ? CEREMONY_BASE : a.steps[stepIndex];
  if (step === undefined) return false;
  if (!force && !stepSpritesReady(a, stepIndex, env)) return false;
  const ctx = surface.ctx;

  for (const p of stepErases(step, stepIndex)) {
    erase(ctx, env.sprite as unknown as DrawSprite, p);
  }
  for (const b of stepBlits(step, stepIndex)) {
    blit(ctx, env.sprite('Panel.mkf', DRAW_RESOURCE, b.entry, b.opaque !== true), b);
  }
  if (stepIndex >= 0 && (CEREMONY_BALLS[stepIndex] ?? false)) {
    drawBallsFor(ctx, env.sprite as unknown as DrawSprite, a.cue.number);
  }
  if (stepDrawsTally(step, stepIndex)) {
    drawTally(ctx, env.sprite as unknown as DrawSprite, a.cue.sold, a.characters, a.alive);
  }
  applyStepTexts(ctx, step.texts, a, env);
  return true;
}

/** 号码球（`applyStep` 用；`drawBalls` 那一版读 `DrawView`，这里直接给号码）*/
function drawBallsFor(ctx: CanvasRenderingContext2D, sprite: DrawSprite, number: number): void {
  const tens = Math.floor(number / 10) % 10;
  const ones = number % 10;
  blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, ENTRY.ball + tens, true), { entry: ENTRY.ball + tens, at: BALL_TENS_AT, opaque: true });
  blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, ENTRY.ball + ones, true), { entry: ENTRY.ball + ones, at: BALL_ONES_AT, opaque: true });
}

/** 这一步要画的文字（建屏那一步用 `CEREMONY_BASE` 的）*/
function applyStepTexts(
  ctx: CanvasRenderingContext2D,
  ids: readonly string[],
  a: Active,
  env: UiScreenEnv,
): void {
  const v: DrawView = viewForBake(a, env);
  for (const id of ids) drawText(ctx, id, v);
}

/** 烤表面时用的 `DrawView` —— 只取文字那几项要用的字段（号码/奖金/得主名）*/
function viewForBake(a: Active, env: UiScreenEnv): DrawView {
  const announced = a.steps.slice(0, a.step + 1).some((x) => x.texts.includes('winnerName'));
  return {
    step: a.step,
    state: a.steps[a.step]?.state ?? 0,
    cue: a.cue,
    face: a.faceBlits,
    lines: [],
    balls: [ENTRY.ball, ENTRY.ball],
    winner: announced && a.cue.winner !== null ? winnerNameFor(a, env) : null,
    lottery: a.cue.sold,
    players: a.steps.length,
  };
}

/** 得主名 —— 与 `viewOf` 同一处口径（`players[winner].character`）*/
function winnerNameFor(a: Active, env: UiScreenEnv): string {
  const idx = a.cue.winner ?? 0;
  return winnerName(env.state.players[idx]?.character ?? 0);
}
/**
 * 中奖号那两颗球。
 *
 * ★ **它们不滚** —— 开号那一刻直接用 `Panel#15` 的 37..46 贴出来
 *   （@source 0x430c17 的 `图号 = (号码的十进制数字) + 0x25`），
 *   先前记的「摇球 N 帧后停在中奖号」是错的。
 */
export function drawBalls(ctx: CanvasRenderingContext2D, sprite: DrawSprite, v: DrawView): void {
  if (!(CEREMONY_BALLS[v.step] ?? false)) return;
  const tens: CeremonyBlit = { entry: v.balls[0], at: BALL_TENS_AT, opaque: true };
  const ones: CeremonyBlit = { entry: v.balls[1], at: BALL_ONES_AT, opaque: true };
  blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, v.balls[0], true), tens);
  blit(ctx, sprite('Panel.mkf', DRAW_RESOURCE, v.balls[1], true), ones);
}

/** core 脚本里的 `CeremonyPatch` → 本模块的 `EraseRect` */
function coreErase(p: {
  from: number;
  at: readonly [number, number];
  from4: readonly [number, number, number, number];
}): EraseRect {
  const [sx, sy, w, h] = p.from4;
  return { from: p.from, dx: p.at[0], dy: p.at[1], sx, sy, x1: sx + w - 1, y1: sy + h - 1 };
}

function drawText(ctx: CanvasRenderingContext2D, id: string, v: DrawView): void {
  switch (id) {
    case 'poolLabel':
      centerText(ctx, POOL_LABEL, 77, 193, 0x14, '#4f35b1', null);
      break;
    case 'poolAmount':
      centerText(ctx, currency(v.cue.prize), 77, 228, 0x14, '#ff0000', null);
      break;
    case 'poolLabelTop':
      centerText(ctx, POOL_LABEL, 91, 19, 0x14, '#4f35b1', null);
      break;
    case 'poolAmountTop':
      centerText(ctx, currency(v.cue.prize), 91, 56, 0x14, '#ff0000', null);
      break;
    case 'winnerName':
      if (v.winner !== null) centerText(ctx, v.winner, 320, 180, 0x1c, '#ff0000', '#400000');
      break;
    default:
      break;
  }
}

function drawBubble(ctx: CanvasRenderingContext2D, sprite: DrawSprite, lines: readonly string[]): void {
  const b = sprite('Panel.mkf', DRAW_RESOURCE, ENTRY.bubble, true);
  drawKeyed(ctx, b, DRAW_BUBBLE_AT[0], DRAW_BUBBLE_AT[1]);
  const cx = DRAW_BUBBLE_AT[0] + (b?.width ?? 187) / 2 + DRAW_BUBBLE_TEXT.dx;
  const cy = DRAW_BUBBLE_AT[1] + Math.trunc((b?.height ?? 140) / 2) + DRAW_BUBBLE_TEXT.dy;
  ctx.font = `${DRAW_BUBBLE_TEXT.size}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101010';
  const lh = DRAW_BUBBLE_TEXT.size + 6;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * lh);
  });
}

// ============================================================
//  整屏（契约见 `ui-screen.ts`）
// ============================================================

export const lotteryDrawScreen: UiScreen = {
  id: 'lottery-draw',

  active(): boolean {
    return active !== null;
  },

  draw(env: UiScreenEnv): void {
    const a = active;
    if (a === null) return;
    drawCeremony(env.stage, env, viewOf(a, env));
  },

  /**
   * 察觉「刚刚开了奖」。
   *
   * ★ 開獎在 core 里是**日期推进的副作用**（`advanceGameDay` 的
   *   `if (date.day === LOTTERY_DRAW_DAY)`），`GameState` 里没有「中奖号」
   *   这种字段（也不许加），所以只能从 `before → after` 反推 —— 与 T-037
   *   魔法屋屏同一个路子。判据与出处见 `lotteryDrawCue`。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (active !== null) return; // 上一段还没播完
    if (before === after) return;
    const cue = lotteryDrawCue(before, after);
    if (cue === null) return;
    env.log(
      `樂透開獎：第 ${cue.number + 1} 號` + (cue.winner === null ? '（無人得獎）' : `，得主 ${cue.winner}`),
    );
    begin(cue, env);
    // ★ 樂透開獎屏的配乐 @source `ui_letou.asm:3063` `push 8 / call fcn_004549cf`
    //   ⇒ id 8 → `MIDI09.MID` → 磁盘名 `midi09.mid`（见 `SCREEN_BGM.lotteryDraw`）
    env.music?.('midi09.mid');
    env.requestRender();
  },

  tick(env: UiScreenEnv): void {
    const a = active;
    if (a === null) return;
    tickFace(a, env);
    if (holdDone(a, env)) advance(a, env);
    // 脸与 ANM 是逐帧的 —— 在播就一直续帧
    env.requestRender();
  },
};

/** 给单测的只读视图 */
export function lotteryDrawView(env: UiScreenEnv): DrawView | null {
  return active === null ? null : viewOf(active, env);
}
