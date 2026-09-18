/*
 * 樂透投注屏（酒吧櫃檯）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 落在樂透格上那一屏：貓女郎拉客 → 報價 → 圈號碼。
 *
 * ## 出处
 *
 * 窗口过程 `fcn_0042f7fc` **VA 0x0042f7fc**（= `rich4_ui_letou.asm:560` 起），
 * 入口 `_rich4_ui_letou_bar_entry` **VA 0x004315cc**。全仓库只有这一个文件碰
 * `[0x48c35c]`（= `read_mkf(panel_mkf, 12, 0, 0)`，`disasm.py xref 0x48c35c` 共 15 处、
 * 全在 0x0042f3xx–0x0042ffxx），所以这一屏用到的图可以穷举。
 *
 * ★ **读偏移的坑（我第一遍就在这里翻车）**：`[0x48c35c]` 是**资源数据的开头**
 *   （SPR/SMP 那 12 字节头），而图像记录从 `+0xc` 起、每项 `0xc` 字节 ——
 *   所以 `add eax, 0xc + 12*i` 才是**图 i**。判别办法：拿尺寸去对
 *   `parseSpriteSheet(资源)` 的记录（`宽×高×2 == gsize`），一对就定案。
 *
 * | 图 | 尺寸 | 锚点 | 是什么 | 画在哪 | 贴图函数 | @source |
 * |---|---|---|---|---|---|---|
 * | 0 | 640×480 | 0,0 | 底圖（酒吧＋下半 36 格號碼盤）| (0,0) | **不透明** `fcn_004563f5` | 0x42f394 |
 * | 1 | 358×298 | 0,0 | 貓女郎 · 托腮 | **(210, −5)** | **抠黑** `fcn_00456418` | 0x42f3b3 |
 * | 2 | 414×302 | 0,0 | 貓女郎 · 招手（**買中之後**才畫）| (154, −8) | **抠黑** `fcn_00456418` | 0x42f9df |
 * | 3 / 4 | 70×42 | 0,0 | 眼睛貼片 睜 / 閉 | (273, 63) | 不透明 `fcn_004563f5` | 帧表 `0x475660` |
 * | 5 / 6 | 70×18 | 0,0 | 嘴貼片 笑 / 抿 | (273, 105) | 不透明 `fcn_004563f5` | 0x42fd1f |
 * | 7 | 58×47 | **28,25** | 紅色粉筆弧（锚点居中）| 那一格正中 | **抠黑** `fcn_00456418` | 0x42ff7e |
 * | 8 | 237×192 | 0,0 | 對話氣泡（三角朝左）| **(360, 20)** | **抠黑** `fcn_00456418` | 0x42f3f2 |
 * | 9 | 172×28 | 0,0 | 藍色底板（奖池金额的底）| (28, 27) | 不透明 `fcn_004563f5` | 0x42fdd1 |
 *
 * **哪些要抠黑**：只看原版用的是哪个贴图函数 ——
 * `fcn_004563f5` → `_draw_image_in_rect`（`rep movsd`，连 0 一起拷）＝**不透明**；
 * `fcn_00456418` → `_draw_non_zero_image_in_rect`（`or ax,ax / je` 跳过 0）＝**抠黑**。
 * 实测纯黑占比：图 0 = 8.9%（画里的黑，**不能抠**）、图 1 = 49.1%、图 2 = 55.2%、
 * 图 7 = 75.5%、图 8 = 32.0%（都是抠图底色）；图 3–6、9 是 0%（抠不抠一样）。
 *
 * 另有两块不属于资源 12：
 * - **奖池数字牌** = `Panel.mkf` **13**（`0x431612 push 0xd`）—— 金额是拿它的
 *   数字字形**逐位贴**出来的，不是 `draw_text`（见 `LOT_AMOUNT`）。
 * - **獎金跑馬燈** = `Panel.mkf` **14**（`0x43162c push 0xe`）= `LOTO\BONUS1.FLC`，
 *   5 帧 213×68（`flic-lottery.test.ts` 把几何钉住了），起于 **(8,8)**
 *   （0x42f3fe `push 5 / push 8 / push 8` → `fcn_00450ced`）。
 *
 * ⚠️ 本屏**一次 `_rich4_draw_text` 都不调**（整份 `rich4_ui_letou.asm` 里 7 处
 *   draw_text 全在 0x430xxx 的**開獎屏**那一支）。所以投注屏上没有「獎金」两个字，
 *   奖池金额也不是文字，而是 `Panel#13` 的字形。
 *
 * ★ 跑馬燈**已经接上**：`UiScreenEnv.flic()` 是 2026-09-16 那轮补的出口
 *   （`ui-screen.ts` 的 `flic(archive, resource)`），`drawLotteryScreen` 每帧
 *   照问一次、按 `bonusFrameAt(now)` 选帧画在 (8,8)。
 *
 * ## 号格（本屏的命中）
 *
 * @source VA 0x0042feae 起（`WM_LBUTTONDOWN` 那一支）：
 * ```asm
 * cmp esi, 0x1e   / jl 不认        ; x < 30
 * cmp esi, 0x25e  / jg 不认        ; x > 606
 * cmp ecx, 0x10f  / jl 不认        ; y < 271
 * cmp ecx, 0x1cf  / jg 不认        ; y > 463
 * col = (x − 0x1e) >> 6            ; /64
 * row = (y − 0x10f) / 0x30         ; /48
 * idx = row*9 + col
 * if (号码表[idx] != 0) 不认        ; 已售出
 * 粉笔落点 = (0x1e + col*64 + 32, 0x10f + row*48 + 24)
 * ```
 *
 * ⚠️ **原版的右边界多放了 30 像素**：`x = 606` 时 `col = 9`（9 列只有 0..8），
 *   `idx = row*9 + 9` 最大到 **44**，而号码表 [0x4990b8] 只有 0x24 = 36 字节 ——
 *   越界写是原版的 bug。本模块**不照抄**：越界一律返回 `null`（见 `hitNumber`）。
 *   **36 个号码本来就画在底图上**，本屏不另贴格子。
 *
 * ## 流程（整条时间轴由 0x113 定时器驱动）
 *
 * 定时器 `SetTimer(…, 0x64, …)`（0x42f8ba 附近），状态机 `[0x48c370]`：
 *
 * | 状态 | 做什么 | @source |
 * |---|---|---|
 * | 0 | 建屏（画 0/1/8 + 起 Panel#14）| 0x42f885（`WM_CREATE` 0x401）|
 * | 1 | 说 `#0011`「哈囉！一券在手…」| `0x4755f8` |
 * | 2 | 说 `#0012`「只要一千元…」| `0x4755fc` |
 * | 3 | 说 `#0013`「請圈選您的幸運號碼～」→ **可以点号** | `0x475600` |
 * | 4 | 说 `#0014`「拜拜！祝您中獎！」| `0x475604` |
 * | 5 | 关屏 | 0x42faf8 `_Post_0402_Message(0)` |
 *
 * 现金 < 1000 时 `WM_CREATE` 直接 `PostMessage(0x405, 4, 4)`（0x42f8d8）：状态置 4
 * 并说 `#0015`「太可惜了！您的現金不足～」，下一拍就是 5（`#0016`「下次再來吧！」）
 * → 关屏。屏**确实会闪一下** —— `WM_CREATE` 之后 `InvalidateRect` 已经排好了。
 *
 * ★ **一次落点只买 1 注**：买中的那一下 reducer 就把 `pending` 收了
 *   （原版 0x0042ffd1 紧接着 `PostMessage(0x406, 3, 0)` → 状态 4），本屏随之关。
 *   派发的 action 是 `{ type: 'lottery', number }`（`core/state/actions.ts:195`）。
 *
 * ## 钱的走向
 *
 * 扣 1000 / 进公库都在 core（`places/lottery.ts` 的 `buyTicket`，
 * @source 0x0043000e `sub [player+0x1c], 0x3e8` / 0x00430018 `add [0x499080], 0x3e8`），
 * 本屏只画 `state.pool`。
 */

import type { GameState } from '@rich4/core';
import { playVoiceCode } from './voice-sink.ts';
import { LOTTERY } from '@rich4/data';
import type { ArchiveName, LoadedFlic, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import { FONT_FAMILY } from './font.ts';
// 取消音（`[0x482332] = 4`）—— 与右键/ESC 那条梯子共用同一个号
import { CANCEL_SOUND } from './panel-cancel.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type LotSprite = (
  archive: 'Panel.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 取一段 FLIC（与 `main.ts` 的 `uiFlicNow` 同一个签名）—— 跑馬燈用 */
export type LotFlic = (archive: ArchiveName, resource: number) => LoadedFlic | null;

const LOT_ARCHIVE = 'Panel.mkf';

/** 本屏的底图资源 @source 0x4315f8 `push 0xc` */
export const LOT_RESOURCE = 12;
/** 奖池金额的字形（16×18 数字牌）@source 0x431612 `push 0xd` */
export const LOT_DIGIT_RESOURCE = 13;
/** 獎金跑馬燈 @source 0x43162c `push 0xe` */
export const LOT_BONUS_RESOURCE = 14;

/** 资源 12 的图号 */
export const LOT_CHUNK = {
  bg: 0,
  kitty: 1,
  kittyHi: 2,
  eyeOpen: 3,
  eyeShut: 4,
  mouthSmile: 5,
  mouthPurse: 6,
  chalk: 7,
  bubble: 8,
  plate: 9,
} as const;

/**
 * 资源 12 里的图（锚点、尺寸、贴法）—— 落点要减锚点，所以锚点必须在这里。
 * 尺寸只用于单测与注释校对，运行时以 `Sprite` 自己的为准。
 */
export const LOT_IMAGE: Record<
  number,
  { w: number; h: number; ax: number; ay: number; key: boolean }
> = {
  0: { w: 640, h: 480, ax: 0, ay: 0, key: false },
  1: { w: 358, h: 298, ax: 0, ay: 0, key: true },
  2: { w: 414, h: 302, ax: 0, ay: 0, key: true },
  3: { w: 70, h: 42, ax: 0, ay: 0, key: false },
  4: { w: 70, h: 42, ax: 0, ay: 0, key: false },
  5: { w: 70, h: 18, ax: 0, ay: 0, key: false },
  6: { w: 70, h: 18, ax: 0, ay: 0, key: false },
  7: { w: 58, h: 47, ax: 28, ay: 25, key: true },
  8: { w: 237, h: 192, ax: 0, ay: 0, key: true },
  9: { w: 172, h: 28, ax: 0, ay: 0, key: false },
};

/**
 * 哪些图要**抠掉纯黑**（= 原版走带透明的 `fcn_00456418`）。
 *
 * | 图 | 原版用哪个 | 抠黑 | 依据 |
 * |---|---|---|---|
 * | 0 底图 | `fcn_004563f5` @0x42f3a4（`rep movsd`，不透明）| ✗ | 8.9% 的黑是**画里的黑**（酒吧暗部）|
 * | 1 貓女郎 · 托腮 | `fcn_00456418` @0x42f3c3 | **✓** | 49.1% 纯黑 = 抠图底色 |
 * | 2 貓女郎 · 招手 | `fcn_00456418` @0x42f9ef | **✓** | 55.2% |
 * | 3 / 4 眼睛 | `fcn_004563f5` @0x42fbc3 | ✗ | 0% 黑，抠不抠一样 —— 随原版 |
 * | 5 / 6 嘴 | `fcn_004563f5` @0x42fd1f | ✗ | 0% |
 * | 7 粉笔 | `fcn_00456418` @0x42ff8? | **✓** | 75.5% |
 * | 8 气泡 | `fcn_00456418`（`fcn_0044ecb6` 里，VA 0x44ed45）| **✓** | 32.0% |
 * | 9 蓝板 | `fcn_004563f5` @0x42fde0 | ✗ | 0%（整块纯蓝）|
 * | 资源 13 字形 | `fcn_00456418`（`loc_0042fdfe` 尾）| **✓** | 索引 0 是底色 |
 */
const LOT_KEYED = new Set<number>([
  LOT_CHUNK.kitty,
  LOT_CHUNK.kittyHi,
  LOT_CHUNK.chalk,
  LOT_CHUNK.bubble,
]);

/** 一拍的毫秒数 @source `SetTimer(hwnd, 0x64, …)` */
export const LOT_TICK_MS = 100;

/**
 * 眨眼帧表 @source `0x475660` = `{3, 4, 3}`，索引 `[0x48c350] >> 4`。
 *
 * ★ 原版第 4 步（`esi >= 3`，@source VA 0x42fbd4）不是「画第 4 帧」，
 *   而是**从图 1 上把那块眼睛原样拷回来**：
 *   `fcn_0045643d(图 1, dest=(273,63), src=(63,68), 70×42)` —— 源偏移
 *   `(63,68)` 正好等于 `(273−210, 63+5)`，**这就是「图 1 在 (210,−5)」的铁证**。
 *   本引擎每帧整屏重画，所以那一步什么也不用做（图 1 自己的眼睛就露出来了）。
 */
export const LOT_BLINK_FRAMES: readonly number[] = [
  LOT_CHUNK.eyeOpen,
  LOT_CHUNK.eyeShut,
  LOT_CHUNK.eyeOpen,
];

/** 眼睛贴片落点 @source 0x42fb48 的 `[esp+0x40]=0x111` / `[esp+0x44]=0x3f` */
export const LOT_EYE_AT = { x: 0x111, y: 0x3f } as const;

/**
 * 嘴贴片落点 @source 0x42fc3a 的 rect `(0x111,0x69)-(0x157,0x7b)`。
 *
 * 嘴的动画：倒数器 `[0x48c34c]` 归零时从图 1 把嘴那块拷回来（src `(63,110)`，
 * 又是 `(273−210, 105+5)`），然后 `rand() >> 11 < 4` 时贴上图 5 或 6。
 * ⚠️ 那个判据的实际概率是 `8192 / 2^31 ≈ 4×10⁻⁶` —— 原版**基本一辈子不发生**
 *   （眨眼那条 `rand() >> 10 == 0` 也一样，≈5×10⁻⁷）。照抄，不改判据。
 */
export const LOT_MOUTH_AT = { x: 0x111, y: 0x69 } as const;

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 底图落点 */
export const LOT_BG_AT = { x: 0, y: 0 } as const;

/**
 * 貓女郎：**建屏只画图 1**，位置 **(210, −5)**。
 *
 * @source
 * ```asm
 * 0042f3ac  push -5              ; y
 * 0042f3ae  push 0xd2            ; x = 210
 * 0042f3b3  mov eax,[0x48c35c]; add eax,0x18   ; 图 1
 * 0042f3c3  call fcn_00456418    ; ★ 抠黑贴图
 * ```
 * 买中之后（`loc_0042f974`，@source 0x42f9d8）才画**图 2**：
 * ```asm
 * 0042f9d8  push -8              ; y
 * 0042f9da  push 0x9a            ; x = 154
 * 0042f9df  mov eax,[0x48c35c]; add eax,0x24   ; 图 2
 * 0042f9ef  call fcn_00456418
 * ```
 * ★ 两条独立铁证说明图 1 在 (210,−5)、不是 (154,0)：
 *   ① 眼睛块还原的源偏移 `(63,68)` = `(273−210, 63+5)`；
 *   ② 嘴块还原的源偏移 `(63,110)` = `(273−210, 105+5)`。
 *   （0x42fbd4 / 0x42fc85 两处 `fcn_0045643d(图 1, src=…)`。）
 */
export const LOT_KITTY_AT = { x: 0xd2, y: -0x05 } as const;
export const LOT_KITTY_HI_AT = { x: 0x9a, y: -0x08 } as const;

/** 蓝色底板落点 @source 0x42fdd1 `fcn_004563f5(图 9, 0x1c, 0x1b)`（不透明） */
export const LOT_PLATE_AT = { x: 0x1c, y: 0x1b } as const;

/** 獎金跑馬燈落点 @source 0x42f3fe（`fcn_00450ced` 的最后三个参数：帧数、x、y）*/
export const LOT_BONUS_AT = { x: 8, y: 8 } as const;

/**
 * 对话气泡落点 @source 0x42f3e8 `fcn_0044ec30(图 8, x=0x168, y=0x14, dx=0x14, dy=0)`
 * = **(360, 20)**，字相对气泡中心再**右移 20**。
 *
 * ⚠️ 别和開獎屏混了：開獎屏那一处（0x4308ba 附近）是
 * `fcn_0044ec30(图 15+0x114, 300, 47, −10, 0, …)` —— 那是**另一个屏**。
 */
export const LOT_BUBBLE_AT = { x: 0x168, y: 0x14 } as const;
export const LOT_BUBBLE_TEXT = { dx: 0x14, dy: 0, size: 0x14 } as const;

/** 气泡寿命 @source `fcn_0044ee18(…)` 那条判据（与商店屏同一个函数）*/
export const LOT_BUBBLE_MS = 2000;

/**
 * 奖池金额：拿 `Panel#13` 的字形**逐位从右往左**贴。
 *
 * @source `loc_0042fdfe`（VA 0x42fdfe）：
 * ```asm
 * esi = 0xb8                       ; 最右那一位的中心 x
 * for (i = len-1; i >= 0; i--) {
 *   if ('0' <= c <= '9') { idx = c - '0';  step = 0x12 }
 *   else if (c == ',')   { idx = 0xa; step = 0xc; esi += 6 }
 *   else                 { idx = 0xb; step = 0x12 }      ; '$'
 *   draw(资源13[idx], (esi, 0x29))   ; 抠黑贴图，锚点自带（数字是 (8,9)）
 *   esi -= step
 * }
 * ```
 * 底板是 `(28,27)-(200,55)`（`loc_0042f974` 的 rect），字形中心 y = 0x29 = 41
 * 正好是底板的中线（27+14）。整块只在第一拍画一次（`[0x48c371]` 标志）。
 */
export const LOT_AMOUNT = {
  /** 最右那一位的中心 x @source `mov esi, 0xb8` */
  firstX: 0xb8,
  /** 中心 y @source `push 0x29` */
  y: 0x29,
  /** 一位数字占多宽 @source `mov edi, 0x12` */
  step: 0x12,
  /** 逗号 @source `mov edi, 0xc` + `add esi, 6` */
  commaStep: 0x0c,
  commaShift: 6,
  commaIndex: 0x0a,
  /** 不是数字也不是逗号的（`$`）@source `mov ecx, 0xb` */
  otherIndex: 0x0b,
} as const;

/** 金额串里一个字形的位置与图号（资源 13） */
export interface LotGlyph {
  index: number;
  x: number;
  y: number;
}

/**
 * 把 `currency()` 出来的串摊成字形。**从右往左**摆，右边的最后一位落在 `firstX`。
 * 纯函数，方便钉住「逗号少占 6 像素」这条。
 */
export function amountGlyphs(text: string): LotGlyph[] {
  const out: LotGlyph[] = [];
  let x = LOT_AMOUNT.firstX;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i] ?? '';
    let index: number;
    let step: number;
    if (ch >= '0' && ch <= '9') {
      index = ch.charCodeAt(0) - 0x30;
      step = LOT_AMOUNT.step;
    } else if (ch === ',') {
      index = LOT_AMOUNT.commaIndex;
      step = LOT_AMOUNT.commaStep;
      x += LOT_AMOUNT.commaShift;
    } else {
      index = LOT_AMOUNT.otherIndex;
      step = LOT_AMOUNT.step;
    }
    out.push({ index, x, y: LOT_AMOUNT.y });
    x -= step;
  }
  return out;
}

/** 1032 → `$1,032`（原版 `_rich4_num_to_currency_string` 的千分位）*/
export function currency(n: number): string {
  return `$${Math.trunc(n).toLocaleString('en-US')}`;
}

// ============================================================
//  号格
// ============================================================

/**
 * 号码盘的几何。
 *
 * `baseX/baseY` 是**除算基准**，也正好是首格的左上角；`rawEndX/rawEndY` 是
 * 原版判据的上界（闭区间）—— 它比真正的最后一格多出 30 / 16 像素，是 bug。
 */
export const LOT_GRID = {
  baseX: 0x1e,
  baseY: 0x10f,
  rawEndX: 0x25e,
  rawEndY: 0x1cf,
  w: 0x40,
  h: 0x30,
  cols: 9,
  rows: 4,
} as const;

/** 号码总数 —— 9×4，与 core 的 `LOTTERY_NUMBERS` 同值 */
export const LOT_NUMBERS = LOT_GRID.cols * LOT_GRID.rows;

/** 第 `n` 格的矩形（**首格左上角**，屏幕坐标）；越界返回 `null` */
export function numberRect(n: number): { x: number; y: number; w: number; h: number } | null {
  if (!Number.isInteger(n) || n < 0 || n >= LOT_NUMBERS) return null;
  return {
    x: LOT_GRID.baseX + (n % LOT_GRID.cols) * LOT_GRID.w,
    y: LOT_GRID.baseY + Math.floor(n / LOT_GRID.cols) * LOT_GRID.h,
    w: LOT_GRID.w,
    h: LOT_GRID.h,
  };
}

/** 第 `n` 格的正中 —— 原版画粉笔弧的落点 @source 0x0042ff60 起 */
export function numberCenter(n: number): { x: number; y: number } | null {
  const r = numberRect(n);
  if (r === null) return null;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * 舞台坐标 → 号码；点在格子外、或落在原版 bug 多放进来的那两条边上 → `null`。
 *
 * ★ 与原版**有意不同**的一处：原版 x 到 606、y 到 463 都算，算出来的 `col`
 *   会等于 9、`row` 会等于 4（36 格的表被读到 44）。这里夹到 9 列 / 4 行。
 *
 * @source VA 0x0042feae 起
 */
export function hitNumber(x: number, y: number): number | null {
  const g = LOT_GRID;
  if (x < g.baseX || x > g.rawEndX) return null;
  if (y < g.baseY || y > g.rawEndY) return null;
  const col = Math.floor((x - g.baseX) / g.w);
  const row = Math.floor((y - g.baseY) / g.h);
  if (col >= g.cols || row >= g.rows) return null;
  return row * g.cols + col;
}

// ============================================================
//  这一屏要画成什么样
// ============================================================

/** 这一屏此刻在演哪一段 —— 就是 `[0x48c370]` 的语义 */
export type LotPhase = 'hello' | 'price' | 'pick' | 'bye' | 'noCash' | 'closing';

/**
 * 状态机的数值编码 —— 与 `[0x48c370]` 一一对应，方便与反汇编对读。
 * @source 0x42f905 `mov byte [0x48c370], 3` / 0x42f930 起 / 0x42f94f
 */
export const LOT_PHASE_CODE: Record<LotPhase, number> = {
  hello: 1,
  price: 2,
  pick: 3,
  bye: 4,
  noCash: 4,
  closing: 5,
};

/** 这一段说什么 —— 串表 `0x4755f8`（6 项）@source 见文件头 */
export function lotMessageOf(phase: LotPhase): string | null {
  switch (phase) {
    case 'hello':
      return LOTTERY.counterHello.text;
    case 'price':
      return LOTTERY.counterPrice.text;
    case 'pick':
      return LOTTERY.counterPick.text;
    case 'bye':
      return LOTTERY.counterBye.text;
    case 'noCash':
      return LOTTERY.counterNoCash.text;
    case 'closing':
      return LOTTERY.counterComeAgain.text;
    default:
      return null;
  }
}

/** 这一屏要画成什么样 —— 纯数据，`draw()` 只负责摆上去 */
export interface LotView {
  phase: LotPhase;
  /** 气泡里那句话（含开头的 `#NNNN` 语音号）；`null` = 不画气泡 */
  message: string | null;
  /** 奖池金额（`state.pool`）*/
  pool: number;
  /** 票价（`pending.price`）*/
  price: number;
  /** 还没卖出去的号码 */
  available: readonly number[];
  /** 自己已经持有的号码数 */
  owned: number;
  /** 正被圈中的号（画粉笔弧）；`null` = 没有 */
  picked: number | null;
  /** 这一帧的眼睛贴片；`null` = 本帧不重画 */
  eye: number | null;
  /** 这一帧的嘴贴片；`null` = 不画 */
  mouth: number | null;
  /** 跑馬燈走到第几帧 */
  bonusFrame: number;
}

/** 待决交互里那一份 —— 不是樂透就给 `null` */
export function lotteryPending(state: GameState): Extract<GameState['pending'], { kind: 'lottery' }> | null {
  const p = state.pending;
  return p !== null && p.kind === 'lottery' ? p : null;
}

/**
 * 状态 → 视图。`picked / eye / mouth / bonusFrame / phase` 是**本屏自己的演出状态**
 * （原版存在 `[0x48c34c]` / `[0x48c350]` / `[0x48c370]` 里），由调用方传进来 ——
 * 这样这个函数是纯的，单测不用碰 canvas。
 */
export function lotView(
  state: GameState,
  phase: LotPhase,
  picked: number | null,
  eye: number | null,
  mouth: number | null,
  bonusFrame: number,
): LotView | null {
  const p = lotteryPending(state);
  if (p === null) return null;
  return {
    phase,
    message: lotMessageOf(phase),
    pool: state.pool,
    price: p.price,
    available: [...p.available],
    owned: p.owned,
    picked,
    eye,
    mouth,
    bonusFrame,
  };
}

// ============================================================
//  眨眼 / 嘴 / 跑馬燈的节拍
// ============================================================

/**
 * 这一屏的两个小动作 —— 原版用同一个 0x113 定时器推两个倒数器：
 * 眨眼 `[0x48c350]`、嘴 `[0x48c34c]`。
 *
 * @source `loc_0042fa9e`（眨眼）与 `loc_0042fc24`（嘴）
 */
export interface LotAnim {
  /** 眨眼倒数 `[0x48c350]` */
  ctl: number;
  /** 嘴的倒数 `[0x48c34c]` */
  mouthHold: number;
  at: number;
}

export function animStart(now = 0): LotAnim {
  return { ctl: 0, mouthHold: 0, at: now };
}

/** 这一帧的两个贴片（`null` = 不画）*/
export interface LotAnimFrame {
  eye: number | null;
  mouth: number | null;
}

function blinkOf(a: LotAnim, rnd: () => number): number | null {
  // @source `loc_0042fb2a`：`rand() >> 10 == 0`（≈5×10⁻⁷）才把 bit0 立起来
  if ((a.ctl & 0x0f) === 0 && Math.floor(rnd() * 0x400000) === 0) a.ctl |= 1;
  if ((a.ctl & 0x0f) !== 1) return null;
  const frame = (a.ctl & 0xf0) >> 4;
  if (frame >= LOT_BLINK_FRAMES.length) {
    // 原版这一步是「从图 1 把眼睛拷回来」—— 本引擎整屏重画，等于什么都不做
    a.ctl = 0;
    return null;
  }
  a.ctl = (a.ctl + 0x10) & 0x3f;
  return LOT_BLINK_FRAMES[frame] ?? null;
}

function mouthOf(a: LotAnim, rnd: () => number): number | null {
  if (a.mouthHold > 0) {
    a.mouthHold -= 1;
    if (a.mouthHold !== 0) return null;
  }
  // @source 0x42fcf6 起：`rand() >> 11 < 4`（≈4×10⁻⁶）才换一次嘴
  if (Math.floor(rnd() * 0x80000000) >> 11 >= 4) return null;
  const patch = (Math.floor(rnd() * 2) & 1) === 0 ? LOT_CHUNK.mouthSmile : LOT_CHUNK.mouthPurse;
  a.mouthHold = Math.floor(rnd() * 8) & 7;
  if (a.mouthHold === 0) a.mouthHold = 1;
  return patch;
}

/**
 * 推进一拍（100 ms）。返回这一帧要画的两个贴片；都不动时两个都是 `null`。
 *
 * @param rnd 取 `[0,1)` 的随机数（原版是 `_libc_rand()`，注入进来只为单测能钉死）
 */
export function animStep(a: LotAnim, now: number, rnd: () => number): LotAnimFrame {
  if (now - a.at < LOT_TICK_MS) return { eye: null, mouth: null };
  a.at = now;
  return { eye: blinkOf(a, rnd), mouth: mouthOf(a, rnd) };
}

/**
 * 跑馬燈帧数与时距。
 *
 * ⚠️ **这一段没在反汇编里解出来**：動畫對象是全局的，推进发生在每帧重绘里
 *   （`fcn_00450f04`），而 `flic.ts` 解出的 `frameMs` 是 **71**（`flic-lottery.test.ts`
 *   量的）。这里按「每 71 ms 一帧、循环」推 —— 属**假设**，记在 deviations。
 */
export const LOT_BONUS_FRAMES = 5;
export const LOT_BONUS_MS = 71;

/** 跑馬燈在 `now` 这一刻是第几帧（索引 0 = 不动的那一帧）*/
export function bonusFrameAt(now: number): number {
  if (!Number.isFinite(now) || now <= 0) return 0;
  return Math.floor(now / LOT_BONUS_MS) % LOT_BONUS_FRAMES;
}

// ============================================================
//  拆字（把 `#NNNN` 语音号吃掉）
// ============================================================

/**
 * 原版 `_rich4_draw_text`（VA 0x0044fabc）开头那一段：
 * 串首是 `#` 就解析出 4 位数字当语音号、跳过 5 个字节再画。
 * 这里只取出**正文** —— 语音由 `playEffect` 管，本屏不碰。
 */
export function stripVoice(text: string): string {
  // ★ 收敛到唯一入口：**顺手把 `#NNNN` 播出来**（以前只剥不播，见 `voice-sink.ts`）
  return playVoiceCode(text);
}

// ============================================================
//  绘制
// ============================================================

const LOT_FONT = FONT_FAMILY;

/** 资源 12 取图 —— 抠不抠黑由 `LOT_KEYED` 说了算，别在各处手写 */
function lotSprite(sprite: LotSprite, index: number): Sprite | null {
  return sprite(LOT_ARCHIVE, LOT_RESOURCE, index, LOT_KEYED.has(index));
}

/** 资源 13 的字形（金额）—— 一律抠黑 @source `loc_0042fdfe` 尾的 `fcn_00456418` */
function digitSprite(sprite: LotSprite, index: number): Sprite | null {
  return sprite(LOT_ARCHIVE, LOT_DIGIT_RESOURCE, index, true);
}

/** 锚点落点绘制（图的 anchorX/anchorY 对到 (x,y)）*/
function drawAnchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * 獎金跑馬燈（`Panel#14` = `LOTO\BONUS1.FLC`，5 帧 213×68，起于 **(8,8)**）。
 *
 * @source 建屏那一段的尾巴：0x42f3fe `push 5 / push 8 / push 8 / push [0x48c364]
 *   / call fcn_00450ced`（帧数、x、y）。帧的推进在每帧重绘里（`fcn_00450f04`），
 *   本模块按 `bonusFrameAt(now)` 选帧 —— 与摇球/礼花同一套（`anmFrameAt`）。
 *
 * ⚠️ `flic()` **异步**：第一次问一定 `null`，解好后 `main.ts` 会自己重画一帧 ——
 *   所以这里每帧照问，**不缓存 `null`**。
 */
export function drawBonusMarquee(
  ctx: CanvasRenderingContext2D,
  flic: LotFlic,
  now: number,
): boolean {
  const film = flic(LOT_ARCHIVE, LOT_BONUS_RESOURCE);
  if (film === null || film.frames.length === 0) return false;
  const frame = film.frames[bonusFrameAt(now) % film.frames.length];
  if (frame === undefined) return false;
  // 原版 `fcn_00450ced(sprite, x, y, flags)` 的 x/y 是**左上角**（帧缓冲从 (x,y) 起铺）
  ctx.drawImage(frame, LOT_BONUS_AT.x, LOT_BONUS_AT.y);
  return true;
}

/**
 * 画整屏。
 *
 * 顺序照原版：起跑馬燈（`fcn_0042f32c` 那一下，@0x42f3fe）→ 建屏（底图 → 貓女郎
 * → 气泡）+ 窗口过程那半（蓝板 → 金额字形 → 眨眼/嘴贴片）+ 買中时（粉笔弧 → 換图 2）。
 *
 * ★ **跑馬燈（`Panel#14`）画在这里**：原版建屏 `fcn_00432f32c` 那一段最后就是
 *   `fcn_00450ced(5 帧, 8, 8)`（@source 0x42f3fe `push 5 / push 8 / push 8`）。
 *   `UiScreenEnv.flic()`（`ui-screen.ts`）就是给它用的出口；第一次问多半返回
 *   `null`（异步解码），照常每帧再问一次即可，**别缓存 `null`**。
 */
export function drawLotteryScreen(
  ctx: CanvasRenderingContext2D,
  sprite: LotSprite,
  flic: LotFlic,
  v: LotView,
  now = 0,
): void {
  // ── 獎金跑馬燈（`Panel#14`，起点 (8,8)）—— 最底层，蓝板/字形压在它中间那块上面 ──
  drawBonusMarquee(ctx, flic, now);

  // ── 底图（36 个号格烤在里面）── 不抠黑
  drawAnchored(ctx, lotSprite(sprite, LOT_CHUNK.bg), LOT_BG_AT.x, LOT_BG_AT.y);

  // ── 貓女郎：建屏只画图 1；买中之后换成图 2 ──（两张都抠黑）
  if (v.phase === 'bye') {
    drawAnchored(ctx, lotSprite(sprite, LOT_CHUNK.kittyHi), LOT_KITTY_HI_AT.x, LOT_KITTY_HI_AT.y);
  } else {
    drawAnchored(ctx, lotSprite(sprite, LOT_CHUNK.kitty), LOT_KITTY_AT.x, LOT_KITTY_AT.y);
  }

  // 眨眼贴片 / 嘴贴片（原版每拍重画一次）
  if (v.eye !== null) drawAnchored(ctx, lotSprite(sprite, v.eye), LOT_EYE_AT.x, LOT_EYE_AT.y);
  if (v.mouth !== null) drawAnchored(ctx, lotSprite(sprite, v.mouth), LOT_MOUTH_AT.x, LOT_MOUTH_AT.y);

  // ── 蓝色底板 + 奖池金额（字形逐个贴，从右往左）──
  drawAnchored(ctx, lotSprite(sprite, LOT_CHUNK.plate), LOT_PLATE_AT.x, LOT_PLATE_AT.y);
  for (const g of amountGlyphs(currency(v.pool))) {
    drawAnchored(ctx, digitSprite(sprite, g.index), g.x, g.y);
  }

  // ── 圈中的号：红色粉笔弧（锚点居中，画在那一格正中）──
  if (v.picked !== null) {
    const c = numberCenter(v.picked);
    if (c !== null) drawAnchored(ctx, lotSprite(sprite, LOT_CHUNK.chalk), c.x, c.y);
  }

  // ── 对话气泡（最后画，压在人身上）──
  if (v.message === null) return;
  const b = lotSprite(sprite, LOT_CHUNK.bubble);
  drawAnchored(ctx, b, LOT_BUBBLE_AT.x, LOT_BUBBLE_AT.y);
  const cx = LOT_BUBBLE_AT.x + (b?.width ?? 237) / 2 + LOT_BUBBLE_TEXT.dx;
  const cy = LOT_BUBBLE_AT.y + Math.trunc((b?.height ?? 192) / 2) + LOT_BUBBLE_TEXT.dy;
  const lines = stripVoice(v.message).split('\n').filter((l) => l !== '');
  const lh = LOT_BUBBLE_TEXT.size + 6;
  ctx.font = `${LOT_BUBBLE_TEXT.size}px ${LOT_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101010';
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * lh);
  });
}

// ============================================================
//  整屏（契约见 `ui-screen.ts`）
// ============================================================

/** 一段气泡说多久之后进下一段 —— 原版是「气泡倒到 0」的那一拍 */
export const LOT_PHASE_MS = LOT_BUBBLE_MS;

interface LotUi {
  phase: LotPhase;
  /** 本段是什么时候开始的 */
  at: number;
  picked: number | null;
  anim: LotAnim;
  /** 这一帧画哪两个贴片（`animStep` 的结果存下来，`draw` 不推进）*/
  eye: number | null;
  mouth: number | null;
  /** 现金不足那一条路：说完 `#0016` 就自己关 */
  dismissed: boolean;
  /**
   * 买中那一刻**定格**的画面。
   *
   * ★ 原版收到 `0x406` 之后（`loc_0042f974`）会画上图 2、「拜拜」气泡并把状态置 5，
   *   直到**下一拍 100 ms 定时器**才 `_Post_0402_Message(0)` 关屏。
   *   而我们的 reducer 在同一次 dispatch 里就把 `pending` 收了 —— 所以要把
   *   「拜拜」这一拍的画面自己留一份，否则那一拍根本画不出来。
   */
  byeView: LotView | null;
  /** 上一次看到的那份 `pending`（换对象就重开一屏）*/
  lastPending: GameState['pending'];
}

const ui: LotUi = {
  phase: 'hello',
  at: 0,
  picked: null,
  anim: animStart(),
  eye: null,
  mouth: null,
  dismissed: false,
  byeView: null,
  lastPending: null,
};

/**
 * 开一屏。
 *
 * ★ `animate`（= `UiScreenEnv.animation`，即 `RICH4.CFG+1` bit0）关掉时**直接从
 *   「可点号」那一段开始** —— 跳过 `hello` / `price` 两句招呼。
 *   @source `loc_0042f8f6`（VA 0x0042f8f6，`0x401` 铺场那一支的尾巴）：
 *   ```asm
 *   0042f8e0  cmp dword [eax + 0x496b84], 0x3e8   ; 现金 < 1000
 *   0042f8f1  jge short loc_0042f8f6
 *   0042f8e5  push 4 / push 4 / push 0x405 / PostMessage   ; → 一闪即关（本屏的 noCash）
 *   0042f8f6  cmp byte [0x497159], 0              ; ← 「動畫過程」
 *   0042f8fd  je short loc_0042f905
 *   0042f8ff  push 0 / push 1 / jmp 0x42f8e7      ; 开：PostMessage(0x405, 1) → 走 hello
 *   0042f905  mov byte [0x48c370], 3              ; 关：状态直接置 3 = pick
 *   ```
 *   状态 3 就是 `pick`（见 `LOT_PHASE_CODE`，与 `[0x48c370]` 一一对应）。
 */
function resetUi(now: number, animate: boolean): void {
  ui.phase = animate ? 'hello' : 'pick';
  ui.at = now;
  ui.picked = null;
  ui.anim = animStart(now);
  ui.eye = null;
  ui.mouth = null;
  ui.dismissed = false;
  ui.byeView = null;
}

/**
 * 换了一屏就从头演 —— `pending` 是个新对象就说明新开了一屏。
 *
 * ⚠️ **`pending` 变成 `null` 时绝不能 reset**：买中的那一下 reducer 就把 `pending`
 *   收了，而原版还要把「拜拜」那一拍画完（见 `byeView`）。reset 会把相位打回
 *   `hello`、那一拍就再也画不出来 —— 这条是**目视**才抓到的，单测原先没盖住。
 */
function syncPending(pending: GameState['pending'], now: number, animate: boolean): void {
  if (pending === ui.lastPending) return;
  if (pending === null) {
    ui.lastPending = null;
    return;
  }
  ui.lastPending = pending;
  resetUi(now, animate);
}

/**
 * 现在该画成什么样 —— `draw` 用（`active` 不碰它）。
 * `pending` 已经被收走、但「拜拜」那一拍还没画完时，用买中那一刻定格的画面。
 */
function currentView(env: UiScreenEnv): LotView | null {
  const live = lotView(env.state, ui.phase, ui.picked, ui.eye, ui.mouth, bonusFrameAt(env.now));
  if (live !== null) return live;
  return ui.phase === 'bye' ? ui.byeView : null;
}

export const lotteryScreen: UiScreen = {
  id: 'lottery',

  active(env: UiScreenEnv): boolean {
    if (ui.dismissed) return false;
    // ★ 买中之后 reducer 立刻收了 `pending`，但原版还会把「拜拜」那一拍画完（100 ms）
    if (ui.phase === 'bye') return true;
    return lotteryPending(env.state) !== null;
  },

  draw(env: UiScreenEnv): void {
    const v = currentView(env);
    if (v === null) return;
    drawLotteryScreen(env.stage, env.sprite, env.flic, v, env.now);
  },

  event(_before: GameState, after: GameState, env: UiScreenEnv): void {
    syncPending(after.pending, env.now, env.animation !== false);
    // ★ 樂透投注開屏的配乐 @source `ui_letou.asm:2938` `push 6 / call fcn_004549cf`
    //   ⇒ id 6 → `MIDI07.MID` → `midi07.mid`（见 `SCREEN_BGM.lottery`；
    //     開獎屏那一处是 `:3063` 的 `push 8` → MIDI09，归開獎屏）
    if (after.pending?.kind === 'lottery') env.music?.('midi07.mid');
  },

  tick(env: UiScreenEnv): void {
    const p = lotteryPending(env.state);
    if (p === null) {
      // 买中之后：`pending` 已经收了，把「拜拜」这一拍走完（一拍 = 100 ms）再关屏
      if (ui.phase === 'bye' && env.now - ui.at >= LOT_TICK_MS) {
        ui.dismissed = true;
        // ⚠️ **不要**在这里把 `byeView` 清掉。
        //   `main.ts` 的帧序是「先 `tick` 再画」，而画的那张 `overlay` 是
        //   `tick` **之前**取的 —— 这一拍清掉 `byeView`，`currentView()` 就返回
        //   null、`draw()` 什么都不画，于是**整整一帧全黑**（只剩背景填充）。
        //   留着它，这一帧照旧画出「拜拜」那一拍；下一次开屏的 `resetUi()`
        //   会自己清掉（`dismissed === true` 时 `active()` 已经为假，不会多演）。
        //   @source 原版收到 `0x406` 后要等**下一拍 100 ms 定时器**才
        //     `_Post_0402_Message(0)` 关屏 —— 那一拍画的就是这一份定格画面。
      }
      return;
    }
    syncPending(env.state.pending, env.now, env.animation !== false);

    const me = env.state.players[env.state.currentPlayer];
    // 现金不足 → 一闪即关（原版 `WM_CREATE` 里就 PostMessage(0x405, 4, 4)）
    if (me !== undefined && me.cash < p.price && ui.phase !== 'noCash' && ui.phase !== 'closing') {
      ui.phase = 'noCash';
      ui.at = env.now;
      env.requestRender();
      return;
    }

    const frame = animStep(ui.anim, env.now, Math.random);
    ui.eye = frame.eye;
    ui.mouth = frame.mouth;
    // 跑馬燈是逐帧的 —— 有它就得一直续帧
    env.requestRender();

    if (env.now - ui.at < LOT_PHASE_MS) return;
    ui.at = env.now;

    switch (ui.phase) {
      case 'hello':
        ui.phase = 'price';
        break;
      case 'price':
        ui.phase = 'pick';
        break;
      case 'noCash':
        ui.phase = 'closing';
        break;
      case 'closing':
        // 说完 `#0016` 就关屏（原版 0x42faf8：收掉定时器 + `_Post_0402_Message(0)`）
        ui.dismissed = true;
        break;
      default:
        break;
    }
  },

  /**
   * 按下（原版 `WM_LBUTTONDOWN` = 0x201；host 的契约也是「按下记账」）。
   *
   * @source VA 0x0042fe8c：
   * ```asm
   * dl = [0x48c370]
   * cmp dl, 3
   * ja  loc_0042f924          ; 状态 > 3（拜拜/关屏）→ 什么都不做
   * jae loc_0042feae          ; 状态 == 3      → 直接判号格
   * ; 状态 < 3（还在说 #0011/#0012）：
   * push 1; call fcn_0044ee18 ; 把当前气泡收掉
   * mov byte [0x48c370], 3
   * loc_0042feae:             ; ★ 直落下来判号格 —— 同一下就能买
   * ```
   * ★ 所以「先把开场白跳过」和「判号格」是**同一下**里连着做的，不能 `return`。
   */
  down(x: number, y: number, env: UiScreenEnv): void {
    if (ui.phase === 'hello' || ui.phase === 'price') {
      ui.phase = 'pick';
      ui.at = env.now;
      env.requestRender();
      // ★ 不 return —— 原版置成 3 之后紧接着就判号格（0x42fe8c 直落 0x42feae）
    } else if (ui.phase !== 'pick') {
      // 拜拜 / 现金不足 / 关屏：状态 > 3，点不动 @source `cmp dl,3 / ja`
      return;
    }

    const p = lotteryPending(env.state);
    if (p === null) return;
    const n = hitNumber(x, y);
    if (n === null) return;
    // 已售出的号码点不动 @source `cmp byte [ebx+0x4990b8], 0 / jne 不认`
    if (!p.available.includes(n)) return;

    ui.picked = n;
    ui.phase = 'bye';
    // 「拜拜」那一拍从**买中这一刻**起算（100 ms）
    ui.at = env.now;
    env.requestRender();
    // ★ 一次落点只买 1 注：reducer 收到这个 action 就把 `pending` 收了 ——
    //   先把「拜拜」那一拍的画面定格下来（原版是 0x406 里画完、下一拍才关屏）
    ui.byeView = lotView(env.state, 'bye', n, ui.eye, ui.mouth, bonusFrameAt(env.now));
    env.dispatch({ type: 'lottery', number: n });
  },

  up(): void {
    // 原版买号在 `WM_LBUTTONDOWN`（0x201）那一下；`WM_LBUTTONUP`（0x202）这一屏
    // **没有分支**（`fcn_0042f7fc` 的 eax 比较里根本没有 0x202）—— 抬手什么都不做。
  },

  /**
   * 右键 = 走人（不买）。@source `fcn_0042f7fc` 的 0x205（`loc_0043003d`）：
   * `play_sound_effect(0, 0x482332)`（音效 4）+ `PostMessage(hwnd, 0x406, 5, 0)` ——
   * 收到 `0x406` 的 `loc_0042f974` 画上图 2、「拜拜」气泡、状态置 5，
   * 下一拍 100 ms 定时器才 `_Post_0402_Message(0)` 关屏（返回 0 = 没买）。
   *
   * ★ 与 ESC 同源：原版钩子把取消键补成 `WM_RBUTTONUP`（@source VA 0x004011c3）。
   * ⚠️ 本屏原来只有 ESC 一条出口（需求方第 3 条报的正是这一类）。
   */
  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    // 已经在拜拜/收屏/现金不足那几拍：按不动（原版 `cmp dl,3 / ja` 同一条闸）
    if (ui.dismissed || ui.phase === 'bye' || ui.phase === 'closing' || ui.phase === 'noCash') {
      return;
    }
    if (lotteryPending(env.state) === null) return;
    env.playEffect(CANCEL_SOUND);
    ui.picked = null;
    ui.phase = 'bye';
    ui.at = env.now;
    // 先把「拜拜」那一拍定格（dispatch 之后 `pending` 就被 reducer 收了）
    ui.byeView = lotView(env.state, 'bye', null, ui.eye, ui.mouth, bonusFrameAt(env.now));
    env.requestRender();
    env.dispatch({ type: 'declineDecision' });
  },
};

// ============================================================
//  给单测的出口（模块级状态在测试之间要能清干净）
// ============================================================

export function resetLotteryScreenState(): void {
  ui.phase = 'hello';
  ui.at = 0;
  ui.picked = null;
  ui.anim = animStart();
  ui.eye = null;
  ui.mouth = null;
  ui.dismissed = false;
  ui.byeView = null;
  ui.lastPending = null;
}

/** 当前相位 / 当前圈中的号 —— 单测用 */
export function lotteryPhase(): LotPhase {
  return ui.phase;
}

export function lotteryPicked(): number | null {
  return ui.picked;
}
