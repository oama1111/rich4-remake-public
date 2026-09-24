/*
 * 每月結算 + 頒獎 —— 照 exe 逐状态重写（第二十一份 `20260924-144653022`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回报：「这个页面应该有台词，评比本月最倒霉和最幸运还是啥来着，2 个评比，不是这样直接发利息」。
 * 先前这一屏是一套**近似**（登记在 T-041 的 D-MONTHLY-*）：结算屏不说话、要点一下才往下走、
 * 頒獎用结算**之后**（已清零）的累加器评分 ⇒ 「本月悲情人物」那一段从来不出。本轮按 exe 整段重写。
 *
 * ## 原版的结构 @source `fcn_00439bfa`（建屏）+ 窗口过程 `fcn_00437e61`（状态机）
 *
 * 建屏（`0x00439bfa`）：`0x454176(0x475b17)` 预载音效组 → 读 `Panel.mkf` #25 → 图 0 不透明 (0,0) →
 * 图 19 抠黑 (24,70)（记者小姐）→ 每位在场者（`0x00439caa`：`who_plays != 0`，按下标序）
 * 头像 `3×角色+47` 抠黑 (600, 行 y) + 把 `存款：`/存款额/`利息：`/利息额（或红字 `貸款中`）**写进**图 `11+行`
 * （名牌，此刻还不贴）→ `0x00439e8f` **开字框** `0x44ec30(图 1, 190, 10, 0, −30, 0x101010, 0)` →
 * `0x00439e99` 放 MIDI10 → `0x4018e7` 进模态循环（窗口过程 `0x437e61`）。
 *
 * 窗口过程：`0x401` 初始化 + `SetTimer(…, 0x64)`（**100 ms 一拍**）+ 投 `0x405`；
 * `0x405`：状态 = 1，「動畫過程」开着就说 `#0092`（`0x00437f42`）。
 * 每拍（`0x113`）先问字框 `0x44ee18(0)`：**上一句还挂着（< 2000 ms 或语音还在响）就只跑待机动画**，
 * 挂完了才按状态走一步 —— 所以整段是**自己往下走的**，从不等点击；
 * 点一下（`0x202`/`0x205` → `0x00439b62`）= 立刻收掉字框 + 停语音（`0x44ee18(1)`）+ 置「跳过」`[0x48c42e]`。
 *
 * | 状态 | VA | 做什么 |
 * |---|---|---|
 * | 1 | 0x00437fff | 还原 (24,70,186,410) → 图 24 不透明 (28,70) → 说 `#0093…加發１０％的儲金利息。` → 2 |
 * | 2 | 0x004380d5 | 还原右栏 (540,0,100,480) → 每行：头像 `3c+49` 抠黑 (600,y)、名牌图 `11+行` 抠黑 (360,y−36)、存款 ×1.1 → 评悲情 / 冠軍 → 动画关 0x16(30 拍) / 悲情无或 = 冠軍 0xf / 否则 5 |
 * | 5 | 0x0043829c | 计数：20 拍（或跳过）重画站队；30 拍（或跳过）还原 → 图 32 (35,67) → 说 `#0095本月悲情人物是．．。` + 音效 27 → 6 |
 * | 6 | 0x004383dc | 图 0 → 悲情那一列聚光（图 15..18）→ 图 37 (0,89) → 全员站队 → 说 `#0096+角色` 名字 + 音效 60 → 7 |
 * | 7 | 0x00438570 | 读影片 `0x1a1+2c` → 图 0 → 图 32 → 聚光 → 图 2 (440,405) → 悲情那张 4 行表 → 站队（除悲情者）→ 8 |
 * | 8 | 0x0043889e | **阻塞**播影片（可点掉）→ 还原 (35,67,173,413) → 图 38 (17,65) → 9 |
 * | 9 | 0x00438a31 | 开字框图 3 (190,10) → 说 `#0108別灰心，再加油喔！` → 0xf（计数 19）|
 * | 0xf | 0x00438a78 | 计数：20 拍（或跳过）重画站队；30 拍（或跳过）开字框图 1 → 还原 → 图 38 → 说 `#0109本月冠軍是．．。` + 音效 27 → 0x10 |
 * | 0x10 | 0x00438ba6 | 图 0 → 冠軍聚光 → 图 42 (27,64) → 全员站队 → 说 `#0110+角色` 名字 + 音效 28 → 0x11 |
 * | 0x11 | 0x00438d40 | 读影片 `0x1a0+2c` → 图 0 → 聚光 → 图 2 → 冠軍那张 4 行表 → 站队（除冠軍）→ 0x12 |
 * | 0x12 | 0x00438ff5 | **阻塞**播奖座影片 → 还原 (27,64,195,416) → 图 45 (6,60) → 0x13 |
 * | 0x13 | 0x00439120 | 开字框图 4 (213,37) → 说 `#0122其他人還要⏎更努力喔！` → 0x16（计数 10）|
 * | 0x16 | 0x00439163 | 每拍减一，到 0（或跳过）`KillTimer` + `Post 0x402` 关屏 |
 *
 * 待机（`0x00439196`，每拍都跑）：记者小姐眨眼 / 左右看（`rand()>>10` 为 0 / 1）、说话时摆嘴型
 * （`rand()>>11 < 4` 张嘴，停 `(rand&7)+1` 拍再闭）—— 随「姿势」`[0x48c42d]` 换图与落点。
 *
 * 模态循环结束（`0x00439eb0`）：`0x454bcc` 接回棋盘曲、放图、三项月度累加器清零、放音效组。
 *
 * ## 本引擎的做法
 *
 * - 结算那一刻的数（加息前存款、清零前累加器、悲情 / 冠軍）由 core 交出来：`GameState.lastMonthlySettle`
 *   （`rules/monthly.ts` 的 `monthlySettleHint`）—— 表现层事后反推不出。
 * - 状态机是纯函数（`monthlyStart` / `monthlyTimer` / `monthlyClick` / `monthlyAdvance`），
 *   画面是「原版往屏幕上画过的东西」的**绘制指令表**（`ops`，图 0 整屏那一笔会把之前的清掉），
 *   每帧重放一遍 —— 与原版「画在同一块面上、不擦」逐像素等价（字框是浮层：原版收框时会还原底下）。
 * - 语音 / 音效 / 读影片 / 关屏由屏幕本体按状态机交出的 `effects` 执行。
 * - 单机与联机同一条路：每一端都按同一条 action 的 `lastMonthlySettle` 起播，点击只影响本机的演出；
 *   联机旁观跟随行动者收场走 `fastForward`。
 */

import type { GameState } from '@rich4/core';
import type { ArchiveName, LoadedFlic, Sprite } from './assets.ts';
import { currency } from './panel.ts';
import { drawGdiText, type GdiTextStyle } from './font.ts';
import { playVoiceCode, stopVoice, voiceBusy } from './voice-sink.ts';
import type { UiKeyEvent, UiScreen, UiScreenEnv } from './ui-screen.ts';
import { drawSprite, drawSpriteRegion } from './hd-stage.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type MonthlySprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  素材与常量
// ============================================================

/** 本屏素材 = `Panel.mkf` **#25** @source 0x00439c04 `push 0x19` */
export const MONTHLY_RESOURCE = 25;

/**
 * 用到的图（`[0x48c41c] + 0xc + 12×图号`，见各状态的 `add eax, …`）。
 *
 * | 图 | 是什么 | 用在 |
 * |---|---|---|
 * | 0 | 整屏底图 | 建屏 / 状态 6/7/0x10/0x11 / 站队重画 `0x437c25` / 各处「还原」|
 * | 1 / 3 / 4 | 字框 | 建屏 `0x00439e8f` + 0xf / 状态 9 / 状态 0x13 |
 * | 2 | 表底锦缎板 | 状态 7 `0x00438689` / 0x11 |
 * | 11..14 | 结算名牌（字写在图上）| 状态 2 |
 * | 15..18 | 聚光（竖栏）| 状态 6/7/0x10/0x11（查 `0x475960`）|
 * | 19 / 24 / 32 / 37 / 38 / 42 / 45 | 记者小姐的各个姿势 | 建屏 / 1 / 5·7 / 6 / 8·0xf / 0x10 / 0x12 |
 * | 20..23 / 25..30 / 33..36 / 39..40 / 43..44 | 眨眼 / 左右看 / 嘴型 | 待机 `0x00439196` |
 * | 47..82 | 12 角色 × 3 帧头像（`3c+47` 站立、`3c+49` 结算后）| 建屏 / 状态 2 / 站队 |
 */
export const MONTHLY_CHUNK = {
  bg: 0,
  bubble: 1,
  plate: 2,
  courageBox: 3,
  farewellBox: 4,
  barFirst: 11,
  panel: 19,
  pose1: 24,
  pose2: 32,
  pose3: 37,
  pose4: 38,
  pose5: 42,
  trophyBoard: 45,
  avatarFirst: 47,
} as const;

/** 头像 = `3×角色 + 47 + 帧` @source 0x00439d14 `lea edi, [eax+0x2f]`（建屏 / 站队）/ 0x00438184 `lea edx, [eax+0x31]`（状态 2）*/
export const MONTHLY_AVATAR_STRIDE = 3;
export function monthlyAvatarChunk(character: number, frame: 0 | 2): number {
  return MONTHLY_AVATAR_STRIDE * Math.max(0, Math.trunc(character)) + MONTHLY_CHUNK.avatarFirst + frame;
}

/** 定时器 @source 0x00437eee `push 0 / push 0x64 / push [0x46cad8] / push hwnd / call SetTimer` —— **100 ms** */
export const MONTHLY_TICK_MS = 0x64;
/** 字框至少挂多久 @source `fcn_0044ee18` 0x0044ee4e `cmp eax, 0x7d0` */
export const MONTHLY_LINE_MS = 0x7d0;

/**
 * 按在场人数查的四张表（`基址 + 8×人数 + 2×名次`，两字节有符号）—— 人数 2..4（原版 1 人那一行是别的数据）。
 *
 * | 表 | VA | 用处 |
 * |---|---|---|
 * | `MONTHLY_ROW_Y` | 0x475918 | 结算屏每行的 y（头像 (600,y)、名牌 (360,y−36)）|
 * | `MONTHLY_LINEUP_X` | 0x475930 | 站队的 x（脚底落在 y = 330）、影片落点的基准 |
 * | `MONTHLY_SPOT_X` | 0x475948 | 聚光的 x（y = 0，不透明）|
 * | `MONTHLY_SPOT_CHUNK` | 0x475960 | 聚光的图号（15..18）|
 */
export const MONTHLY_ROW_Y: readonly (readonly number[])[] = [[], [], [120, 360], [100, 240, 380], [60, 180, 300, 420]];
export const MONTHLY_LINEUP_X: readonly (readonly number[])[] = [[], [], [407, 490], [324, 407, 490], [324, 407, 490, 573]];
export const MONTHLY_SPOT_X: readonly (readonly number[])[] = [[], [], [334, 414], [259, 334, 414], [259, 334, 414, 494]];
export const MONTHLY_SPOT_CHUNK: readonly (readonly number[])[] = [[], [], [16, 17], [15, 16, 17], [15, 16, 17, 18]];

function tableRow(t: readonly (readonly number[])[], n: number): readonly number[] {
  return t[Math.min(4, Math.max(2, n))] ?? [];
}

/** 结算屏头像的 x @source 0x00439cfe `push 0x258` */
export const MONTHLY_ROW_AVATAR_X = 0x258;
/** 结算名牌落点 @source 0x004381c0 `push 0x168`（x）/ 0x004381bc `sub eax, 0x24`（y = 行 y − 36）*/
export const MONTHLY_PLATE_AT = { x: 0x168, dy: -0x24 } as const;
/** 站队：脚底落在 y = 330 @source 0x004384d9 `mov edi, 0x14a / sub di, [图+0xe] / add di, [图+0x12]` */
export const MONTHLY_LINEUP_FOOT_Y = 0x14a;

/**
 * 名牌里的四段字（写进图 `11+行` 的**局部**坐标）@source 0x00439d3d / 0x00439d7e / 0x00439db5 / 0x00439df4；
 * 字效 `create_font(0x12, 0x101010, 0, 2, 0)`（0x00439c7b）—— 18 号深色粗体、字距 −1；`貸款中` 用 0xff0000（0x00439dc6）。
 */
export const MONTHLY_PLATE_TEXT = {
  bankLabel: { x: 4, y: 6, align: 'left' },
  bank: { x: 0x9a, y: 6, align: 'right' },
  interestLabel: { x: 4, y: 0x2e, align: 'left' },
  interest: { x: 0x9a, y: 0x2e, align: 'right' },
} as const;
export const MONTHLY_PLATE_STYLE: GdiTextStyle = { size: 0x12, color: '#101010', color2: '#000000', flags: 2, spacing: 0 };
export const MONTHLY_PLATE_LOAN_STYLE: GdiTextStyle = { ...MONTHLY_PLATE_STYLE, color: '#ff0000' };
export const MONTHLY_LABELS = { bank: '存款：', interest: '利息：', loan: '貸款中' } as const;

/**
 * 两张 4 行表（状态 7 悲情 / 状态 0x11 冠軍）：标签 (320,y) 左对齐、值 (560,y) 右对齐，y = 370/388/406/424；
 * 字效 `create_font(0x10, 0x101010, 0, 2, 1)`（0x00438691）—— 16 号深色粗体。
 */
export const MONTHLY_TABLE_AT = { x: 0x140, valueX: 0x230, y0: 0x172, step: 0x12 } as const;
export const MONTHLY_TABLE_STYLE: GdiTextStyle = { size: 0x10, color: '#101010', color2: '#000000', flags: 2, spacing: 1 };
/** 表底锦缎板（图 2）的锚点落点 @source 0x0043866f `push 0x195 / push 0x1b8` */
export const MONTHLY_TABLE_PLATE = { chunk: 2, x: 0x1b8, y: 0x195 } as const;
export const MONTHLY_SAD_LABELS = ['獲獎原因：', '本月意外損失：', '本月意外之財：', '本月倒楣天數：'] as const;
export const MONTHLY_CHAMP_LABELS = ['獲獎原因：', '現金：', '存款：', '總資產：'] as const;

/** 字框（`0x44ec30` 的 图, x, y, 字心 dx, dy）*/
export interface MonthlyBox {
  chunk: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}
/** 建屏 0x00439e8f / 状态 0xf 0x00438ab8 */
export const MONTHLY_BOX_BUBBLE: MonthlyBox = { chunk: 1, x: 0xbe, y: 0x0a, dx: 0, dy: -0x1e };
/** 状态 9 0x00438a4c */
export const MONTHLY_BOX_COURAGE: MonthlyBox = { chunk: 3, x: 0xbe, y: 0x0a, dx: 0x14, dy: 0 };
/** 状态 0x13 0x0043913b */
export const MONTHLY_BOX_FAREWELL: MonthlyBox = { chunk: 4, x: 0xd5, y: 0x25, dx: 0x14, dy: 0 };
/** 字框里的字 —— `fcn_0044ecb6` 的 `create_font(0x14, 0x101010, 0, 2, 1)`（0x0044ed65）*/
export const MONTHLY_BOX_STYLE: GdiTextStyle = { size: 0x14, color: '#101010', color2: '#000000', flags: 2, spacing: 1 };

/** 各句（带 `#NNNN` 语音号，照 exe 逐字节）*/
export const MONTHLY_LINES = {
  /** @source 0x464d60（0x405 那一拍 `0x00437f42`，动画开着才说）*/
  intro: '#0092各位客戶辛苦了！\n又到了每月銀行\n結算的日子。',
  /** @source 0x464d92（状态 1 `0x004380c5`，动画关也说）*/
  interest: '#0093大富翁銀行將\n根據您的存款，\n加發１０％的儲金利息。',
  /** @source 0x464dca（状态 5 `0x004383af`）*/
  sad: '#0095本月悲情人物是．．。',
  /** @source 0x464e21（状态 9 `0x00438a54`）*/
  courage: '#0108別灰心，再加油喔！',
  /** @source 0x464e39（状态 0xf `0x00438b9c`）*/
  champion: '#0109本月冠軍是．．。',
  /** @source 0x464e66（状态 0x13 `0x00439140`）*/
  farewell: '#0122其他人還要\n更努力喔！',
} as const;

/**
 * 名字那一句 —— 按**角色号**查表（不是座位）：悲情 `[0x475988 + 4c]`（状态 6 `0x00438554`）、
 * 冠軍 `[0x4759b8 + 4c]`（状态 0x10）；串在 0x464c30 起（语音 96..107 / 110..121）。
 */
const EXE_NAMES = ['約翰喬', '沙隆巴斯', '忍太郎', '錢夫人', '阿土伯', '莎拉公主', '宮本寶藏', '糖糖', '烏咪', '孫小美', '小丹尼', '金貝貝'] as const;
export function monthlyNameLine(character: number, kind: 'sad' | 'champion'): string {
  const c = Math.min(11, Math.max(0, Math.trunc(character)));
  const code = (kind === 'sad' ? 96 : 110) + c;
  return `#${String(code).padStart(4, '0')}${EXE_NAMES[c]}`;
}

/**
 * 音效（预载组 `0x475b17` 起，8 字节一项、首字节是 Effect.mkf 号）：
 * 27 = `0x475b17`（状态 5 / 0xf 引出）、60 = `0x475b27`（状态 6 悲情名字）、28 = `0x475b1f`（状态 0x10 冠軍名字）。
 */
export const MONTHLY_SOUND_INTRO = 27;
export const MONTHLY_SOUND_SAD_NAME = 60;
export const MONTHLY_SOUND_CHAMP_NAME = 28;

/**
 * 两段角色影片的每角色参数（24 字节一角色）：`[奖座 dx, dy, flags, 悲情 dx, dy, flags]`。
 * @source 奖座 `0x4759f7/fb/ff`（状态 0x12）、悲情 `0x475a03/07/0b`（状态 8 `0x004388c4..0x00438940`）。
 * 落点（**左上角**，不减锚点）= `(站队 x[名次] + dx, 330 + dy)`；flags 的 bit1 = 可点掉、第二字节 = 播几遍
 * （`0x00450dbe`：`[0x48c844] = (flags>>8)&0xff`，`0x004511b1` 每播完一遍减一，0 ⇒ 只播一遍）。
 */
export const MONTHLY_FLIC_OFFSETS: readonly (readonly number[])[] = [
  [-50, -94, 0x603, -77, -148, 0x003],
  [-48, -97, 0x403, -48, -90, 0x603],
  [-38, -97, 0x603, -50, -87, 0x603],
  [-31, -61, 0x603, -64, -109, 0x303],
  [-41, -87, 0x403, -42, -77, 0x603],
  [-44, -76, 0x403, -31, -60, 0x203],
  [-36, -100, 0x603, -36, -103, 0x603],
  [-50, -89, 0x403, -50, -87, 0x003],
  [-51, -90, 0x403, -51, -92, 0x003],
  [-31, -60, 0x403, -51, -95, 0x303],
  [-103, -188, 0x403, -39, -87, 0x603],
  [-40, -75, 0x403, -40, -75, 0x403],
];

/** 影片资源：悲情 `Data.mkf 0x1a1+2c`（0x004385a4）、奖座 `0x1a0+2c`（状态 0x11）*/
export function monthlyFlicResource(character: number, kind: 'sad' | 'trophy'): number {
  return (kind === 'sad' ? 0x1a1 : 0x1a0) + 2 * Math.max(0, Math.trunc(character));
}

export function monthlyFlicSpec(character: number, kind: 'sad' | 'trophy'): { dx: number; dy: number; flags: number; plays: number; skippable: boolean } {
  const c = Math.min(11, Math.max(0, Math.trunc(character)));
  const row = MONTHLY_FLIC_OFFSETS[c]!;
  const at = kind === 'trophy' ? 0 : 3;
  const flags = row[at + 2]!;
  return { dx: row[at]!, dy: row[at + 1]!, flags, plays: Math.max(1, (flags >> 8) & 0xff), skippable: (flags & 2) !== 0 };
}

// ============================================================
//  待机动画（`0x00439196`）
// ============================================================

/**
 * 姿势 `[0x48c42d]` → 眨眼（跳表 `0x437e35`，姿势 0..4）/ 嘴型（跳表 `0x437e49`，姿势 0..5）。
 * 眨眼三帧取 `0x4759e8 + 3×姿势`（21,20,21 / 28,27,28 / 34,33,34 / – / 39,40,39），第 4 拍还原；
 * 嘴型：张嘴图 / 闭嘴图 @ 落点。全部**不透明**（`0x4563f5`）。
 */
interface BlinkSpec {
  at: { x: number; y: number };
  frames: readonly [number, number, number];
  /** 第 4 拍：从这张图的 (sx,sy) 拷 w×h 回来（`0x45643d`）；`{chunk}` 只贴一张 */
  end: { chunk: number; sx: number; sy: number; w: number; h: number } | { chunk: number };
}
export const MONTHLY_BLINK: Readonly<Record<number, BlinkSpec>> = {
  0: { at: { x: 0x4c, y: 0x78 }, frames: [21, 20, 21], end: { chunk: 19, sx: 0x34, sy: 0x32, w: 0x50, h: 0x28 } },
  1: { at: { x: 0x67, y: 0x78 }, frames: [28, 27, 28], end: { chunk: 25 } },
  2: { at: { x: 0x57, y: 0x76 }, frames: [34, 33, 34], end: { chunk: 32, sx: 0x34, sy: 0x33, w: 0x4c, h: 0x2b } },
  4: { at: { x: 0x53, y: 0x7b }, frames: [39, 40, 39], end: { chunk: 38, sx: 0x42, sy: 0x3a, w: 0x46, h: 0x21 } },
};
/** 姿势 1 的「左右看」：`rand()&1` 选图 25 / 26 贴 (103,120) @source 0x004393fd */
export const MONTHLY_GLANCE = { at: { x: 0x67, y: 0x78 }, first: 25 } as const;
interface MouthSpec {
  at: { x: number; y: number };
  open: number;
  closed: number;
  /** 姿势 0 张嘴时 `rand()&1` 为 0 就改成从图 19 拷回（`0x00439833`）*/
  restore?: { chunk: number; sx: number; sy: number; w: number; h: number };
}
export const MONTHLY_MOUTH: Readonly<Record<number, MouthSpec>> = {
  0: { at: { x: 0x4c, y: 0xa0 }, open: 22, closed: 23, restore: { chunk: 19, sx: 0x34, sy: 0x5a, w: 0x50, h: 0x14 } },
  1: { at: { x: 0x67, y: 0x9b }, open: 30, closed: 29 },
  2: { at: { x: 0x57, y: 0xa1 }, open: 35, closed: 36 },
  5: { at: { x: 0x5a, y: 0x86 }, open: 44, closed: 43 },
};

// ============================================================
//  状态机（纯函数）
// ============================================================

/** 往屏上画过的一笔（原版画在同一块面上、不擦 ⇒ 每帧照序重放）*/
export type MonthlyOp =
  /** 按锚点贴一张（`0x4563f5` 不透明 / `0x456418` 抠黑）*/
  | { k: 'img'; chunk: number; x: number; y: number; keyed: boolean }
  /** 从某张图的 (sx,sy) 拷 w×h 到 (x,y)（`0x45643d`；`chunk 0` 且同坐标 = 还原底图）*/
  | { k: 'copy'; chunk: number; sx: number; sy: number; w: number; h: number; x: number; y: number }
  /** 站队的一个人：头像 `3c+47` 抠黑、x = 站队表、脚底 y = 330 */
  | { k: 'figure'; character: number; x: number }
  /** 结算名牌（图 `11+行`，里面的字）*/
  | { k: 'plate'; row: number; x: number; y: number; bank: string; interest: string; loan: boolean }
  /** 4 行表的一行 */
  | { k: 'text'; text: string; x: number; y: number; align: 'left' | 'right' }
  /** 播完的影片停在最后一帧（原版逐帧直接贴屏，不还原）*/
  | { k: 'film'; resource: number; x: number; y: number };

/** 演出交给屏幕本体去做的副作用 */
export type MonthlyEffect =
  | { k: 'voice'; line: string }
  | { k: 'stopVoice' }
  | { k: 'sfx'; id: number }
  | { k: 'loadFilm'; resource: number }
  | { k: 'close' };

export interface MonthlyRowView {
  player: number;
  character: number;
  bankBefore: number;
  interest: number;
  loan: number;
  unexpectedLoss: number;
  unexpectedGain: number;
  unluckyDays: number;
  cash: number;
  bank: number;
  wealth: number;
}

/** 这一次月结要演的内容（从 `lastMonthlySettle` + 角色号来）*/
export interface MonthlyView {
  rows: readonly MonthlyRowView[];
  /** 悲情人物在 `rows` 里的名次；−1 = 无 */
  unlucky: number;
  /** 冠軍在 `rows` 里的名次 */
  champion: number;
}

export interface MonthlyFilm {
  kind: 'sad' | 'trophy';
  resource: number;
  x: number;
  y: number;
  plays: number;
  skippable: boolean;
  /** 起播时刻；`null` = 还没起（等影片解好）*/
  startedAt: number | null;
  /** 该起播的时刻（等解码的超时从这里算）*/
  dueAt: number;
}

export interface MonthlyRun {
  view: MonthlyView;
  animation: boolean;
  /** 状态 `[0x48c42a]` */
  st: number;
  /** 计数 `[0x48c425]` */
  counter: number;
  /** 跳过 `[0x48c42e]` */
  skip: boolean;
  /** 姿势 `[0x48c42d]` */
  mode: number;
  /** 待机眨眼的状态字节 `[0x48c42c]` */
  blink: number;
  /** 嘴型的停留拍数 `[0x48c42b]` */
  mouthHold: number;
  /** 最近一次开的字框（`0x44ec30` 那几个全局）*/
  box: MonthlyBox;
  /** 字框里正挂着的那句（去掉 `#NNNN`）与挂上的时刻；`null` = 没挂（`[0x4762c4] == 0`）*/
  line: { text: string; at: number } | null;
  ops: MonthlyOp[];
  /** 待机那一层（眨眼 / 嘴型）—— 也是直接画在面上的，接在 `ops` 之后 */
  film: MonthlyFilm | null;
  /** 下一拍的时刻 */
  tickAt: number;
  closed: boolean;
}

export interface MonthlyIo {
  /** 最近起播的那句语音还在响吗（`0x4544b9`）*/
  voiceBusy?: boolean;
  /** C `rand()`（0..32767）*/
  rand?: () => number;
  /** 影片的总长（帧数 × 每帧毫秒，**一遍**）；还没解好返回 `null` */
  filmMs?: (resource: number) => number | null;
}

/** 影片等解码最多等多久（超时就不播，演出照走 —— 少一段影片，不卡回合）*/
export const MONTHLY_FILM_WAIT_MS = 4000;

/** 从 core 的提示拼出演出内容 */
export function monthlyViewOf(state: GameState): MonthlyView | null {
  const hint = state.lastMonthlySettle ?? null;
  if (hint === null || hint.rows.length === 0) return null;
  const rows = hint.rows.map((r) => ({ ...r, character: state.players[r.player]?.character ?? 0 }));
  const at = (p: number) => rows.findIndex((r) => r.player === p);
  return { rows, unlucky: hint.unlucky < 0 ? -1 : at(hint.unlucky), champion: Math.max(0, at(hint.champion)) };
}

/** 名牌上的两个数 @source 0x00439d6a（加息前 `+0x20`）/ 0x00439e10（`trunc(存款 × 0.1)`，有贷款写 `貸款中`）*/
export function monthlyPlateText(r: MonthlyRowView): { bank: string; interest: string; loan: boolean } {
  const loan = r.loan !== 0;
  return { bank: currency(r.bankBefore), interest: loan ? MONTHLY_LABELS.loan : currency(Math.trunc(r.bankBefore * 0.1)), loan };
}

/** 建屏（`0x00439bfa` 到进模态循环为止）+ `0x405` 那一拍 */
export function monthlyStart(view: MonthlyView, animation: boolean, now: number): { run: MonthlyRun; effects: MonthlyEffect[] } {
  const n = view.rows.length;
  const ys = tableRow(MONTHLY_ROW_Y, n);
  const ops: MonthlyOp[] = [
    { k: 'img', chunk: MONTHLY_CHUNK.bg, x: 0, y: 0, keyed: false },
    { k: 'img', chunk: MONTHLY_CHUNK.panel, x: 0x18, y: 0x46, keyed: true },
    ...view.rows.map((r, i): MonthlyOp => ({
      k: 'img',
      chunk: monthlyAvatarChunk(r.character, 0),
      x: MONTHLY_ROW_AVATAR_X,
      y: ys[i] ?? 0,
      keyed: true,
    })),
  ];
  const run: MonthlyRun = {
    view,
    animation,
    st: 1,
    counter: 0,
    skip: false,
    mode: 0,
    blink: 0,
    mouthHold: 0,
    box: MONTHLY_BOX_BUBBLE,
    line: null,
    ops,
    film: null,
    tickAt: now,
    closed: false,
  };
  const effects: MonthlyEffect[] = [];
  // 0x405：`cmp byte [0x497159], 0 / je` —— 动画关就不说开场白
  if (animation) say(run, MONTHLY_LINES.intro, now, effects);
  return { run, effects };
}

function say(run: MonthlyRun, line: string, now: number, effects: MonthlyEffect[]): void {
  effects.push({ k: 'voice', line });
  run.line = { text: line.replace(/^#\d{4}/, ''), at: now };
}

/** 图 0 整屏那一笔：之前画的都被盖掉了 */
function fullBg(run: MonthlyRun): void {
  run.ops = [{ k: 'img', chunk: MONTHLY_CHUNK.bg, x: 0, y: 0, keyed: false }];
}

function restore(run: MonthlyRun, x: number, y: number, w: number, h: number): void {
  run.ops.push({ k: 'copy', chunk: MONTHLY_CHUNK.bg, sx: x, sy: y, w, h, x, y });
}

/** 站队 `0x43849e` 那一圈（`except` = 跳过的名次）*/
function lineup(run: MonthlyRun, except = -1): void {
  const xs = tableRow(MONTHLY_LINEUP_X, run.view.rows.length);
  run.view.rows.forEach((r, i) => {
    if (i !== except) run.ops.push({ k: 'figure', character: r.character, x: xs[i] ?? 0 });
  });
}

/** 站队重画 `fcn_00437c25`：图 0 + 图 19 + 全员 */
function redrawLineup(run: MonthlyRun): void {
  fullBg(run);
  run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.panel, x: 0x18, y: 0x46, keyed: true });
  lineup(run);
}

function spotlight(run: MonthlyRun, idx: number): void {
  const n = run.view.rows.length;
  run.ops.push({ k: 'img', chunk: tableRow(MONTHLY_SPOT_CHUNK, n)[idx] ?? 15, x: tableRow(MONTHLY_SPOT_X, n)[idx] ?? 0, y: 0, keyed: false });
}

function table(run: MonthlyRun, labels: readonly string[], values: readonly string[]): void {
  run.ops.push({ k: 'img', chunk: MONTHLY_TABLE_PLATE.chunk, x: MONTHLY_TABLE_PLATE.x, y: MONTHLY_TABLE_PLATE.y, keyed: false });
  labels.forEach((label, i) => {
    const y = MONTHLY_TABLE_AT.y0 + i * MONTHLY_TABLE_AT.step;
    run.ops.push({ k: 'text', text: label, x: MONTHLY_TABLE_AT.x, y, align: 'left' });
    const v = values[i] ?? '';
    if (v !== '') run.ops.push({ k: 'text', text: v, x: MONTHLY_TABLE_AT.valueX, y, align: 'right' });
  });
}

function startFilm(run: MonthlyRun, kind: 'sad' | 'trophy', idx: number, now: number): void {
  const r = run.view.rows[idx];
  if (r === undefined) return;
  const spec = monthlyFlicSpec(r.character, kind);
  const x = (tableRow(MONTHLY_LINEUP_X, run.view.rows.length)[idx] ?? 0) + spec.dx;
  run.film = {
    kind,
    resource: monthlyFlicResource(r.character, kind),
    x,
    y: MONTHLY_LINEUP_FOOT_Y + spec.dy,
    plays: spec.plays,
    skippable: spec.skippable,
    startedAt: null,
    dueAt: now,
  };
}

/** 影片播完（或点掉 / 等不到素材）之后那一段 —— 状态 8 / 0x12 的尾巴 */
function finishFilm(run: MonthlyRun, shown: boolean): void {
  const f = run.film;
  if (f === null) return;
  run.film = null;
  if (shown) run.ops.push({ k: 'film', resource: f.resource, x: f.x, y: f.y });
  if (f.kind === 'sad') {
    // 0x00438965..0x00438a01
    run.st = 9;
    run.mode = 4;
    restore(run, 0x23, 0x43, 0xad, 0x19d);
    run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose4, x: 0x11, y: 0x41, keyed: true });
  } else {
    // 状态 0x12 尾巴
    run.st = 0x13;
    run.mode = 6;
    restore(run, 0x1b, 0x40, 0xc3, 0x1a0);
    run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.trophyBoard, x: 6, y: 0x3c, keyed: true });
  }
}

/** 字框还挂着吗（`fcn_0044ee18(0)` 返回 0 那种）；挂完了就收掉 */
function lineHeld(run: MonthlyRun, t: number, io: MonthlyIo): boolean {
  if (run.line === null) return false;
  if (t - run.line.at < MONTHLY_LINE_MS || io.voiceBusy === true) return true;
  run.line = null;
  return false;
}

/** 一拍（`WM_TIMER`）—— 返回这一拍的副作用；`run` 就地改（调用方传进来的是自己的拷贝）*/
export function monthlyTimer(run: MonthlyRun, t: number, io: MonthlyIo = {}): MonthlyEffect[] {
  const effects: MonthlyEffect[] = [];
  if (run.closed || run.st === 0 || run.film !== null) return effects;
  if (!lineHeld(run, t, io)) step(run, t, effects);
  if (!run.closed) idle(run, io.rand ?? cRand);
  return effects;
}

function step(run: MonthlyRun, t: number, effects: MonthlyEffect[]): void {
  const v = run.view;
  const n = v.rows.length;
  switch (run.st) {
    case 1: {
      // 0x00437fff
      run.st = 2;
      run.mode = 1;
      restore(run, 0x18, 0x46, 0xba, 0x19a);
      run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose1, x: 0x1c, y: 0x46, keyed: false });
      say(run, MONTHLY_LINES.interest, t, effects);
      return;
    }
    case 2: {
      // 0x004380d5
      run.counter = 0;
      restore(run, 0x21c, 0, 0x64, 0x1e0);
      const ys = tableRow(MONTHLY_ROW_Y, n);
      v.rows.forEach((r, i) => {
        const y = ys[i] ?? 0;
        run.ops.push({ k: 'img', chunk: monthlyAvatarChunk(r.character, 2), x: MONTHLY_ROW_AVATAR_X, y, keyed: true });
        run.ops.push({ k: 'plate', row: i, x: MONTHLY_PLATE_AT.x, y: y + MONTHLY_PLATE_AT.dy, ...monthlyPlateText(r) });
      });
      // 0x00438254：动画关 → 0x16（30 拍）；悲情无 / 悲情 = 冠軍 → 0xf；否则 5
      if (!run.animation) {
        run.st = 0x16;
        run.counter = 0x1e;
      } else if (v.unlucky < 0 || v.unlucky === v.champion) {
        run.st = 0xf;
      } else {
        run.st = 5;
      }
      run.skip = false;
      return;
    }
    case 5: {
      // 0x0043829c
      run.counter++;
      if (run.counter === 0x14 || run.skip) {
        run.mode = 0;
        redrawLineup(run);
      }
      if (run.counter !== 0x1e && !run.skip) return;
      run.skip = false;
      if (v.unlucky < 0) {
        run.st = 0xf;
        return;
      }
      restore(run, 0x18, 0x46, 0xba, 0x19a);
      run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose2, x: 0x23, y: 0x43, keyed: true });
      run.st = 6;
      run.mode = 2;
      say(run, MONTHLY_LINES.sad, t, effects);
      effects.push({ k: 'sfx', id: MONTHLY_SOUND_INTRO });
      return;
    }
    case 6: {
      // 0x004383dc
      run.st = 7;
      run.mode = 3;
      fullBg(run);
      spotlight(run, v.unlucky);
      run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose3, x: 0, y: 0x59, keyed: true });
      lineup(run);
      say(run, monthlyNameLine(v.rows[v.unlucky]?.character ?? 0, 'sad'), t, effects);
      effects.push({ k: 'sfx', id: MONTHLY_SOUND_SAD_NAME });
      return;
    }
    case 7: {
      // 0x00438570
      run.st = 8;
      run.mode = 2;
      const r = v.rows[v.unlucky];
      if (r !== undefined) effects.push({ k: 'loadFilm', resource: monthlyFlicResource(r.character, 'sad') });
      fullBg(run);
      run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose2, x: 0x23, y: 0x43, keyed: true });
      spotlight(run, v.unlucky);
      table(run, MONTHLY_SAD_LABELS, [
        '',
        currency(r?.unexpectedLoss ?? 0),
        currency(r?.unexpectedGain ?? 0),
        `${r?.unluckyDays ?? 0}天`,
      ]);
      lineup(run, v.unlucky);
      return;
    }
    case 8:
      // 0x0043889e：阻塞播影片（起播 / 播完在 `monthlyAdvance` 里）
      startFilm(run, 'sad', v.unlucky, t);
      if (run.film === null) finishFilm(run, false);
      return;
    case 9:
      // 0x00438a31
      run.box = MONTHLY_BOX_COURAGE;
      say(run, MONTHLY_LINES.courage, t, effects);
      run.st = 0xf;
      run.counter = 0x13;
      return;
    case 0xf: {
      // 0x00438a78
      run.counter++;
      if (run.counter === 0x14 || run.skip) {
        run.mode = 0;
        redrawLineup(run);
      }
      if (run.counter !== 0x1e && !run.skip) return;
      run.skip = false;
      run.box = MONTHLY_BOX_BUBBLE;
      restore(run, 0x18, 0x46, 0xba, 0x19a);
      run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose4, x: 0x11, y: 0x41, keyed: true });
      run.st = 0x10;
      run.mode = 4;
      say(run, MONTHLY_LINES.champion, t, effects);
      effects.push({ k: 'sfx', id: MONTHLY_SOUND_INTRO });
      return;
    }
    case 0x10: {
      // 0x00438ba6
      run.st = 0x11;
      run.mode = 5;
      fullBg(run);
      spotlight(run, v.champion);
      run.ops.push({ k: 'img', chunk: MONTHLY_CHUNK.pose5, x: 0x1b, y: 0x40, keyed: true });
      lineup(run);
      say(run, monthlyNameLine(v.rows[v.champion]?.character ?? 0, 'champion'), t, effects);
      effects.push({ k: 'sfx', id: MONTHLY_SOUND_CHAMP_NAME });
      return;
    }
    case 0x11: {
      // 0x00438d40（姿势不变、记者小姐这一步不重画）
      run.st = 0x12;
      const r = v.rows[v.champion];
      if (r !== undefined) effects.push({ k: 'loadFilm', resource: monthlyFlicResource(r.character, 'trophy') });
      fullBg(run);
      spotlight(run, v.champion);
      table(run, MONTHLY_CHAMP_LABELS, ['', currency(r?.cash ?? 0), currency(r?.bank ?? 0), currency(r?.wealth ?? 0)]);
      lineup(run, v.champion);
      return;
    }
    case 0x12:
      // 0x00438ff5
      startFilm(run, 'trophy', v.champion, t);
      if (run.film === null) finishFilm(run, false);
      return;
    case 0x13:
      // 0x00439120
      run.box = MONTHLY_BOX_FAREWELL;
      say(run, MONTHLY_LINES.farewell, t, effects);
      run.st = 0x16;
      run.counter = 0xa;
      return;
    case 0x16:
      // 0x00439163
      run.counter--;
      if (run.counter <= 0 || run.skip) {
        run.closed = true;
        effects.push({ k: 'close' });
      }
      return;
    default:
      return;
  }
}

/** C `rand()` 的替身（纯表现：眨眼 / 嘴型；不碰 core 的随机流）*/
function cRand(): number {
  return Math.floor(Math.random() * 0x8000);
}

/** 待机那一段 `0x00439196`（眨眼 / 左右看 / 嘴型）—— 直接往面上画 */
function idle(run: MonthlyRun, rand: () => number): void {
  // ── 眨眼 / 左右看 ──
  if ((run.blink & 0xf) === 0) {
    const r = rand() >> 10;
    if (r === 0) run.blink |= 1;
    else if (r === 1) run.blink |= 2;
  }
  const kind = run.blink & 0xf;
  if (kind !== 0 && run.mode <= 4) {
    const spec = MONTHLY_BLINK[run.mode];
    if (kind === 1 && spec !== undefined) {
      const frame = (run.blink & 0x30) >> 4;
      if (frame === 3) {
        const e = spec.end;
        if ('sx' in e) run.ops.push({ k: 'copy', chunk: e.chunk, sx: e.sx, sy: e.sy, w: e.w, h: e.h, x: spec.at.x, y: spec.at.y });
        else run.ops.push({ k: 'img', chunk: e.chunk, x: spec.at.x, y: spec.at.y, keyed: false });
        run.blink = 0;
      } else {
        run.ops.push({ k: 'img', chunk: spec.frames[frame]!, x: spec.at.x, y: spec.at.y, keyed: false });
        run.blink += 0x10;
      }
    } else if (kind === 2 && run.mode === 1) {
      const b = rand() & 1;
      if (run.blink >> 6 !== b) {
        run.ops.push({ k: 'img', chunk: MONTHLY_GLANCE.first + b, x: MONTHLY_GLANCE.at.x, y: MONTHLY_GLANCE.at.y, keyed: false });
        run.blink |= b << 6;
      }
      run.blink &= 0x40;
    } else {
      // 这一姿势不认这一种 ⇒ 清掉（`0x00439302` / `0x004395b5` …）
      run.blink = 0;
    }
  }
  // ── 嘴型（字框挂着或还在停留）──
  if (run.line === null && run.mouthHold === 0) return;
  const m = MONTHLY_MOUTH[run.mode];
  if (m === undefined) return;
  if (run.mouthHold > 0) {
    run.mouthHold--;
    if (run.mouthHold === 0) run.ops.push({ k: 'img', chunk: m.closed, x: m.at.x, y: m.at.y, keyed: false });
    return;
  }
  if (rand() >> 11 >= 4) return;
  if (m.restore !== undefined && (rand() & 1) === 0) {
    const r = m.restore;
    run.ops.push({ k: 'copy', chunk: r.chunk, sx: r.sx, sy: r.sy, w: r.w, h: r.h, x: m.at.x, y: m.at.y });
  } else {
    run.ops.push({ k: 'img', chunk: m.open, x: m.at.x, y: m.at.y, keyed: false });
  }
  run.mouthHold = (rand() & 7) + 1;
}

/** 点一下（`0x202` / `0x205` → `0x00439b62`）；影片放着时点的是影片（可点掉就收场）*/
export function monthlyClick(run: MonthlyRun, now: number, io: MonthlyIo = {}): MonthlyEffect[] {
  if (run.closed) return [];
  if (run.film !== null) {
    if (run.film.skippable && run.film.startedAt !== null) {
      finishFilm(run, (io.filmMs?.(run.film.resource) ?? null) !== null);
      run.tickAt = now;
    }
    return [];
  }
  if (run.st === 0) return [];
  const effects: MonthlyEffect[] = [];
  if (run.line !== null) {
    run.line = null;
    effects.push({ k: 'stopVoice' });
  }
  run.skip = true;
  return effects;
}

/** 把 `now` 之前该走的拍子都走完（影片期间不走拍子 —— 原版阻塞在 `0x45144f` 里）*/
export function monthlyAdvance(run: MonthlyRun, now: number, io: MonthlyIo = {}): MonthlyEffect[] {
  const out: MonthlyEffect[] = [];
  for (let i = 0; i < 600 && !run.closed; i++) {
    const f = run.film;
    if (f !== null) {
      const once = io.filmMs?.(f.resource) ?? null;
      if (f.startedAt === null) {
        if (once !== null) f.startedAt = Math.max(f.dueAt, run.tickAt);
        else if (now - f.dueAt >= MONTHLY_FILM_WAIT_MS) {
          finishFilm(run, false);
          run.tickAt = now;
          continue;
        } else break;
      }
      const end = f.startedAt + (once ?? 0) * f.plays;
      if (now < end) break;
      finishFilm(run, true);
      run.tickAt = end;
      continue;
    }
    if (now - run.tickAt < MONTHLY_TICK_MS) break;
    run.tickAt += MONTHLY_TICK_MS;
    out.push(...monthlyTimer(run, run.tickAt, io));
  }
  return out;
}

// ============================================================
//  绘制
// ============================================================

function sprite(get: MonthlySprite, chunk: number, keyed: boolean): Sprite | null {
  return get('Panel.mkf', MONTHLY_RESOURCE, chunk, keyed);
}

function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  drawSprite(ctx, s, x - s.anchorX, y - s.anchorY);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: 'left' | 'right', style: GdiTextStyle): void {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  drawGdiText(ctx, text, x, y, style);
}

function drawOp(ctx: CanvasRenderingContext2D, get: MonthlySprite, flic: (resource: number) => LoadedFlic | null, op: MonthlyOp): void {
  switch (op.k) {
    case 'img':
      drawAnchored(ctx, sprite(get, op.chunk, op.keyed), op.x, op.y);
      return;
    case 'copy': {
      const s = sprite(get, op.chunk, false);
      if (s === null) return;
      // 同坐标还原底图（图 0 锚点 0,0）；眨眼 / 嘴型那几笔是从姿势图的局部坐标拷
      drawSpriteRegion(ctx, s, op.sx, op.sy, op.w, op.h, op.x, op.y, op.w, op.h);
      return;
    }
    case 'figure': {
      // y 实参 = 330 − 高 + 锚点 y（0x004384d9..0x004384e2）⇒ 按锚点贴之后左上角 = 330 − 高（脚底落在 330）
      const s = sprite(get, monthlyAvatarChunk(op.character, 0), true);
      if (s !== null) drawSprite(ctx, s, op.x - s.anchorX, MONTHLY_LINEUP_FOOT_Y - s.height);
      return;
    }
    case 'plate': {
      const s = sprite(get, MONTHLY_CHUNK.barFirst + op.row, true);
      drawAnchored(ctx, s, op.x, op.y);
      const x0 = op.x - (s?.anchorX ?? 0);
      const y0 = op.y - (s?.anchorY ?? 0);
      const T = MONTHLY_PLATE_TEXT;
      drawText(ctx, MONTHLY_LABELS.bank, x0 + T.bankLabel.x, y0 + T.bankLabel.y, 'left', MONTHLY_PLATE_STYLE);
      drawText(ctx, op.bank, x0 + T.bank.x, y0 + T.bank.y, 'right', MONTHLY_PLATE_STYLE);
      drawText(ctx, MONTHLY_LABELS.interest, x0 + T.interestLabel.x, y0 + T.interestLabel.y, 'left', MONTHLY_PLATE_STYLE);
      drawText(ctx, op.interest, x0 + T.interest.x, y0 + T.interest.y, 'right', op.loan ? MONTHLY_PLATE_LOAN_STYLE : MONTHLY_PLATE_STYLE);
      return;
    }
    case 'text':
      drawText(ctx, op.text, op.x, op.y, op.align, MONTHLY_TABLE_STYLE);
      return;
    case 'film': {
      const f = flic(op.resource);
      const last = f?.frames[f.frames.length - 1];
      if (last !== undefined) ctx.drawImage(last, op.x, op.y);
      return;
    }
  }
}

/** 字框（`0x44ecb6`）：框按锚点贴、字在 `左上 + 宽/2 + dx, 高/2 + dy` 正中，多行上下摊开 */
function drawBox(ctx: CanvasRenderingContext2D, get: MonthlySprite, box: MonthlyBox, text: string): void {
  const img = sprite(get, box.chunk, true);
  drawAnchored(ctx, img, box.x, box.y);
  // 图还没到货时按素材尺寸兜底（图 1 = 290×201、图 3 = 239×193、图 4 = 195×142，锚点均 0）
  const fallback: Readonly<Record<number, { w: number; h: number }>> = { 1: { w: 290, h: 201 }, 3: { w: 239, h: 193 }, 4: { w: 195, h: 142 } };
  const w = img?.width ?? fallback[box.chunk]?.w ?? 0;
  const h = img?.height ?? fallback[box.chunk]?.h ?? 0;
  const cx = box.x - (img?.anchorX ?? 0) + (w >> 1) + box.dx;
  const cy = box.y - (img?.anchorY ?? 0) + (h >> 1) + box.dy;
  const lines = text.split('\n').filter((l) => l !== '');
  const lineH = MONTHLY_BOX_STYLE.size + 6;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => drawGdiText(ctx, line, cx, cy + (i - (lines.length - 1) / 2) * lineH, MONTHLY_BOX_STYLE));
}

/**
 * 画整屏：照序重放 `ops` → 正挂着的字框 → 正在放的影片那一帧。
 *
 * @param flic 取影片（`Data.mkf`）；还没解好返回 `null`
 */
export function drawMonthlyScreen(
  ctx: CanvasRenderingContext2D,
  get: MonthlySprite,
  flic: (resource: number) => LoadedFlic | null,
  run: MonthlyRun,
  now: number,
): void {
  for (const op of run.ops) drawOp(ctx, get, flic, op);
  if (run.line !== null) drawBox(ctx, get, run.box, run.line.text);
  const f = run.film;
  if (f !== null && f.startedAt !== null) {
    const film = flic(f.resource);
    if (film !== null && film.frames.length > 0) {
      const ms = film.frameMs > 0 ? film.frameMs : 71;
      const k = Math.max(0, Math.floor((now - f.startedAt) / ms));
      const frame = Math.min(film.frames.length * f.plays - 1, k) % film.frames.length;
      const bmp = film.frames[frame];
      if (bmp !== undefined) ctx.drawImage(bmp, f.x, f.y);
    }
  }
}

// ============================================================
//  屏幕本体
// ============================================================

let run: MonthlyRun | null = null;
/** 调试 / 单测注入的 `rand()`（`null` = `Math.random`）*/
let randHook: (() => number) | null = null;

export function setMonthlyRand(fn: (() => number) | null): void {
  randHook = fn;
}

/** 调试 / 单测用：把整屏关掉 */
export function resetMonthlyScreen(): void {
  run = null;
}

function flicOf(env: UiScreenEnv): (resource: number) => LoadedFlic | null {
  return (resource) => env.flic('Data.mkf', resource);
}

function ioOf(env: UiScreenEnv): MonthlyIo {
  const flic = flicOf(env);
  return {
    voiceBusy: voiceBusy(),
    ...(randHook === null ? {} : { rand: randHook }),
    filmMs: (resource) => {
      const f = flic(resource);
      if (f === null || f.frames.length === 0) return null;
      return f.frames.length * (f.frameMs > 0 ? f.frameMs : 71);
    },
  };
}

function apply(effects: readonly MonthlyEffect[], env: UiScreenEnv): void {
  for (const e of effects) {
    switch (e.k) {
      case 'voice':
        playVoiceCode(e.line);
        break;
      case 'stopVoice':
        stopVoice();
        break;
      case 'sfx':
        env.playEffect(e.id);
        break;
      case 'loadFilm':
        // 原版在这一步 `read_mkf` 读好影片（0x004385b1 / 状态 0x11）；本引擎异步解，先问一声
        void env.flic('Data.mkf', e.resource);
        break;
      case 'close':
        run = null;
        env.log('每月結算：演出结束');
        break;
    }
  }
}

export const monthlyScreen: UiScreen = {
  id: 'monthly',

  active: () => run !== null,

  draw(env: UiScreenEnv): void {
    if (run === null) return;
    drawMonthlyScreen(env.stage, env.sprite, flicOf(env), run, env.now);
  },

  /** 点一下（原版只认 `0x202` / `0x205`）*/
  up(_x: number, _y: number, env: UiScreenEnv): void {
    if (run === null) return;
    apply(monthlyClick(run, env.now, ioOf(env)), env);
    env.requestRender();
  },

  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    if (run === null) return;
    apply(monthlyClick(run, env.now, ioOf(env)), env);
    env.requestRender();
  },

  /**
   * 按键：窗口过程本身不收按键（`0x437e61` 的分派里没有 `0x100/0x101`）；
   * 只有影片放着时 `0x45144f` 自己的循环认 `0x101`（flags bit1）把影片收掉。吃掉按键，免得漏到棋盘上。
   */
  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    if (run === null) return false;
    if (run.film !== null) {
      apply(monthlyClick(run, env.now, ioOf(env)), env);
      env.requestRender();
    }
    return true;
  },

  /** 联机旁观：行动者那台已经收场 ⇒ 直接关屏（`midi10` 不用停：没有整屏接管时棋盘曲自己接回）*/
  fastForward(env: UiScreenEnv): boolean {
    if (run === null) return false;
    if (run.line !== null) stopVoice();
    run = null;
    env.log('每月結算：跟著行動者收場');
    env.requestRender();
    return true;
  },

  tick(env: UiScreenEnv): void {
    if (run === null) return;
    apply(monthlyAdvance(run, env.now, ioOf(env)), env);
    env.requestRender();
  },

  /**
   * 察觉「刚刚跨了一个月」—— core 在月结那一刻写了 `lastMonthlySettle`（只活这一条 action）。
   * @source `0x0041d09e call 0x439bfa`（推日期里、`cmp edi,1` 跨月那一支）
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (run !== null) return; // 上一段还没播完
    if (before === after) return;
    if (after.totalMonths <= before.totalMonths) return;
    if ((after.lastMonthlySettle ?? null) === null || after.lastMonthlySettle === before.lastMonthlySettle) return;
    const view = monthlyViewOf(after);
    if (view === null) return;
    const s = monthlyStart(view, env.animation !== false, env.now);
    run = s.run;
    // ★ 进屏配乐 @source 0x00439e97 `push 9 / call fcn_004549cf` ⇒ MIDI10
    env.music?.('midi10.mid');
    env.log(`每月結算：${view.rows.length} 人`);
    apply(s.effects, env);
    env.requestRender();
  },
};

/** 给单测的只读视图 */
export function monthlyScreenState(): { playing: boolean; run: MonthlyRun | null } {
  return { playing: run !== null, run };
}
