/*
 * 樂透開獎演出 —— 原版那台十态状态机的**脚本**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这个模块**一条规则都没有**（谁中奖、给多少钱在 `lottery.ts`）。
 *   它只把「开奖那一刻屏幕上发生什么」按原版的顺序抄下来：
 *   每一步说什么话、擦哪几块、铺哪几张子图、起哪个动画、要等多久。
 *
 * ★ 原版（`rich4_ui_letou.asm` 的 `fcn_0043010c`）是**窗口过程 + 50 ms 定时器**：
 *   一个字节 `0x48c37b` 走 1..10 十个状态，`0x004300d0` 是那张跳表（下标 = 状态 − 1，
 *   `0x0043021b dec al / cmp al,9`）。每一拍先问 `fcn_0044ee18`「上一句说完了没」
 *   （≥ 2 s，开了语音还要等语音播完）：说完了才按状态跳进**处理器**；没说完、或处理器
 *   是 `0x43024c` 的那两个状态（3 / 5），就走「每拍」那一段（数帧 + 推 ANM）。
 *
 * ## 原版的完整次序（2026-09-23 第十二份試玩回報逐条重抄；调用点全部带 VA）
 *
 * 参数记法：`擦(dx,dy,w,h)` = `fcn_0045643d(dst, 底图0, dx,dy, sx=dx,sy=dy, w,h)`（**最后两参是宽高**，
 * 不透明整块拷回，`0x455e24`）；`贴图N@(x,y)` = `fcn_00456418`（抠黑，扣锚点）；
 * `局部图N(sx,sy,w,h)→(x,y)` = `fcn_00456495`（抠黑，**不扣锚点**，`0x455fd9` 的 `or ax,ax / je` 跳黑）。
 *
 * | 拍 | 状态 | 做了什么（按 exe 的先后） | @source |
 * |---|---|---|---|
 * | 建屏 | 0 | 底图0 → 图1@(472,66) → 图3@(7,66) → 「累積獎金」(77,193) → 金额(77,228) → **只设**字框（图22@(300,47)，字心偏 −10）→ 持号表 | 0x0042f6c3–0x0042f7dc |
 * | 开场 | 1 | 说 `#0017`（「動畫過程」关掉则**直接置 2、不说**）| 0x004301b0–0x004301d4 |
 * | 报幕 | 2 | 说 `#0018 現在馬上為您開出這一期的號碼` | 0x00430236 |
 * | 摇球 | 3 | 起摇球 ANM（Panel#16 @(183,75)，flags 8）→ 擦持号表带 → 擦(472,116,45,90)（竖着的手指）→ 贴图2@(418,66)（摊手）→ 局部图3(0,274,134,130)→(7,340) → 持号表 → **音效 57** | 0x0043036c–0x00430478 |
 * | 第 20 拍 | 3 | 擦(418,171,80,80)（摊开的那只手）→ 局部图1(0,51,38,90)→(472,117)（手指重新竖起）；**从这一拍起才推 ANM** | 0x00430259–0x004302db / 0x00430351 |
 * | 开号 | 3 | ANM 放完：掷号 → 擦持号表带 → 局部图3（腿）→ **号码球两颗 @(286,405)/(358,405)** → **`Data#517` 大号绿字两位 @(300,220)/(340,220)** → 持号表 | 0x00430b07–0x00430d2c |
 * | 有人中 | 4 | 说 `#0019 本月份的得主是．．．。`（**只说话**，屏上仍是开出来的号码）| 0x00430d5d–0x00430d7b |
 * | 公布得主 | 5 | 起礼花 ANM（Panel#17 @(205,0)，flags 1）→ 擦带 → 擦(472,66,168,414) → 擦(7,66,140,414) → 图6@(0,0) → 图5@(505,66) → 图24@(320,200)（红爆炸框）→ 号码球 → 「累積獎金」(91,19) → 金额(91,56) → 得主名(320,180) → 持号表 → **音效 58** | 0x00430485–0x004306fa |
 * | 数帧 | 5 | 数满 30 拍后**才推礼花**；放完 → 擦带 → 擦(150,0,330,360) → 局部图6(0,340,162,120)→(0,340) → 局部图5(0,274,124,130)→(505,340) → 号码球 → 持号表 → 置 6、说 `#0032 恭喜您獨得所有獎金！` | 0x00430f43–0x004310e3 |
 * | 恭喜说完 | 6→8 | 擦带 → 擦(0,0,160,480) → 擦(490,0,150,480) → 图1@(472,66) → 图3@(7,66) → 号码球 → 「累積獎金」(77,193) → 金额(77,228) → 持号表 → 置 8（**不说话**，下一拍直接进 8 的处理器）| 0x004306ff–0x004308db |
 * | 没人中 | 3→7 | **先停 500 ms**（号码就那样亮着）→ 字框换成**黄色爆炸框**（图23@(320,200)，字心不偏）→ 擦带 → 擦(472,0,169,480) → 局部图3（腿）→ 号码球 → 图4@(489,116)（捂嘴）→ 图21@(52,89)（苦笑脸，不透明）→ 持号表 → 说 `#0033 SORRY！本月份沒有人得獎～`（**字在爆炸框里**）| 0x00430d85–0x00430f3b |
 * | 结转 | 7→8 | 说 `#0034 獎金將累積到下個月`（仍在黄色爆炸框里）| 0x004308e0 |
 * | 收尾 | 8→9 | 擦带 → 擦(489,116,151,364) → 局部图3（腿）→ 图1@(472,66) → 图3 的(45,23,50,40)不透明拷回(52,89)（还原左脸）→ 号码球 → 持号表 → 字框换回气泡 → 说 `#0035` | 0x004308f3–0x00430a9e |
 * | 9→10 | 10 | 说 `#0036 行動要快喔！` | 0x00430aa3 |
 * | 关屏 | — | 派彩、清号码表、关窗 | 0x00430ab5–0x00430afd |
 *
 * ★ 字框（`fcn_0044ec30` 只**记下**图与落点，`fcn_0044ecb6` 说话时才画，并先存底；
 *   `fcn_0044ee18` 说完就把存的底贴回去）⇒ 气泡 / 爆炸框**只在说话那几秒可见**，不会留在台上。
 *
 * 素材：全部来自 `Panel.mkf`，子图号已按 exe 里的加载点核对过
 *   （`0x00431712` 起：资源 0x0f=15 主屏、0x10=16 摇球机、0x11=17 得主面板、
 *     0x0d=13 小数字牌）。`Panel#15` 的 47 张子图逐张导出目视核过：
 *   0 舞台底图 640×480 / 1..6 同一个女主持人的六个姿势 / 7..21 脸部贴片
 *   （眼、嘴、整脸）/ 22 对话气泡 / 23 黄色爆炸框 / 24 红色爆炸框
 *   / 25..36 十二个角色头像徽章 / 37..46 号码球 0..9（71×70，锚点居中）。
 *   中央大号数字另在 `Data.mkf` 资源 **517**（`[0x48bad8]`，@source 0x0040808f `push 0x205`）
 *   的图 **8..17**（数字 0..9，约 35×43，锚点居中）。
 */

import { LOTTERY, type OriginalText } from '@rich4/data';
import type { LotteryDrawResult } from './lottery.ts';

// ============================================================
//  素材
// ============================================================

/** 这一屏的全部子图都在 `Panel.mkf` 的资源 15（@source 0x00431712 的 `push 0xf`） */
export const CEREMONY_PANEL = 0x0f; // 主屏 = Panel#15
/** 摇球机动画（@source 0x0043172f 的 `push 0x10`），用 `fcn_00450ced` 起 */
export const CEREMONY_DRUM_PANEL = 0x10; // Panel#16
/** 得主面板动画（@source 0x00431749 的 `push 0x11`） */
export const CEREMONY_WINNER_PANEL = 0x11; // Panel#17
/** 小数字牌（@source 0x00431739 的 `push 0xd`）—— 各人持号表里的号码用它 */
export const CEREMONY_DIGIT_PANEL = 0x0d; // Panel#13
/**
 * 开号那一拍屏幕中央的**大号数字**：`Data.mkf` 资源 517 的图 `8 + 数字`。
 * @source 资源指针 `[0x48bad8]` 由 0x0040808f 那次 `read_mkf(Data, 0x205)` 写入；
 *   0x00430c99 `lea edx,[eax−0x1d]`（`eax` = `[0x48c37d]` = `'0'+数字 − 0xb`）⇒ 图号 = 数字 + 8。
 */
export const CEREMONY_BIG_DIGIT_RESOURCE = 0x205;
export const CEREMONY_BIG_DIGIT_BASE = 8;

/** 屏幕尺寸。原版那些矩形全是按 640×480 硬编码的 */
export const CEREMONY_W = 640;
export const CEREMONY_H = 480;

/**
 * `Panel#15` 的子图号。
 * @source 代码里的 `mov eax, [0x48c360]; add eax, 0xNN`，子图号 = (0xNN − 0xc) / 12
 *   （每项 12 字节，就是 `graph_st` 头：w,h,热点x,热点y,数据）
 */
export const ENTRY = {
  /** 640×480 的舞台：蓝幕布 + 玻璃摇奖球 + 台座 + 标题「大富翁樂透開獎」 */
  stage: 0,
  /** 女主持人的六个姿势 */
  pointing: 1, // 竖手指（152 宽）
  presenting: 2, // 摊手（206 宽 —— 比竖手指那张**左边多 54 点**的手臂）
  board: 3, // 举空白板
  oops: 4, // 捂嘴、带汗滴
  laugh: 5, // 双手举脸旁大笑
  jumpBoard: 6, // 举板过顶、单脚跳
  /** 对话气泡（187×140，锚点 (0,0)）*/
  bubble: 22,
  /** 无人中奖的黄色放射爆炸框（233×192，锚点 (120,98)）—— 空号那两句的**字框** */
  burstSorry: 23,
  /** 中奖的红色爆炸框（295×262，锚点 (147,130)）*/
  burstWin: 24,
  /** 角色头像徽章：`badge + 角色号` → 25..36（各人持号表用）*/
  badge: 25,
  /**
   * 整张苦笑脸（50×40，锚点 (0,0)）—— 开出空号时**不透明**盖在左主持人脸上。
   * @source 0x00430ef5–0x00430f0b `[0x48c360]+0x108`（子图 21）@ (0x34,0x59)
   */
  faceWry: 21,
  /** 号码球：`ball + 数字` → 37..46 */
  ball: 37,
} as const;

/** 左／右两个主持人各自的站立位置（`fcn_0042f6c3` 建屏时铺的，@source 0x0042f6fa / 0x0042f719）*/
export const POSE_LEFT = [7, 66] as const;
export const POSE_RIGHT = [472, 66] as const;
/**
 * 摊手那张（图 2）的落点 —— 比 `POSE_RIGHT` **左移 54 点**，身子正好压在竖手指那张上。
 * @source 0x00430402 `push 0x42 / push 0x1a2`（= (418,66)）
 */
export const POSE_PRESENTING = [0x1a2, 0x42] as const;

/**
 * 两种字框（`fcn_0044ec30(图, x, y, 字心dx, 字心dy, 字色, 描边)`）。
 *
 * 字框只在**说话那几秒**画出来：`fcn_0044ecb6` 先存底、贴框、在框心写字；
 * `fcn_0044ee18` 说完就把底贴回去。字心 = 框左上 + (宽/2, 高/2) + (dx, dy)
 * （@source 0x0044ed7b–0x0044eda6：`sar 1` 取半，加 `[0x48c618]/[0x48c62c]`）。
 *
 * @source 气泡：建屏 0x0042f7b7–0x0042f7d4 与收尾 0x00430a6c–0x00430a89
 *   `push 0 / 0x101010 / 0 / −0xa / 0x2f / 0x12c / 图22` ⇒ **(300,47)**，字心左移 10。
 * @source 黄色爆炸框：空号 0x00430d99–0x00430db9
 *   `push 0 / 0x101010 / 0 / 0 / 0xc8 / 0x140 / 图23` ⇒ **(320,200)**（锚点 (120,98)），字心不偏。
 */
export const CEREMONY_FRAMES = {
  bubble: { entry: ENTRY.bubble, at: [0x12c, 0x2f], text: [-0x0a, 0] },
  burst: { entry: ENTRY.burstSorry, at: [0x140, 0xc8], text: [0, 0] },
} as const;
export type CeremonyFrameId = keyof typeof CEREMONY_FRAMES;

/** 旧名：气泡落点（= `CEREMONY_FRAMES.bubble.at`）*/
export const BUBBLE_AT = CEREMONY_FRAMES.bubble.at;
/** 中央爆炸框的锚点 —— 屏幕正中 */
export const BURST_AT = [320, 200] as const;

/**
 * 屏幕上的文字位置（`rich4_draw_text(字号, 串, x, y, 对齐)`；`对齐 2` = 以 (x,y) 为**中心**）。
 * @source 0x0042f6c3（累積獎金/金额）、0x00430485（得主名、上移的那一份）
 */
export const CEREMONY_TEXT = {
  /** 「累積獎金」标签，建屏时在左下 */
  poolLabel: { at: [77, 193], align: 2, size: 0x14 },
  /** 公库金额（红色），紧跟标签 */
  poolAmount: { at: [77, 228], align: 2, size: 0x14, color: 0xff0000 },
  /** 得主公布时，这两个挪到左上（0x00430485 重画的那一份）*/
  poolLabelTop: { at: [91, 19], align: 2, size: 0x14 },
  poolAmountTop: { at: [91, 56], align: 2, size: 0x14, color: 0xff0000 },
  /** 得主名字：28 px 红字，居中 */
  winnerName: { at: [320, 180], align: 2, size: 0x1c, color: 0xff0000 },
} as const;

export type CeremonyTextId = keyof typeof CEREMONY_TEXT;

/**
 * 中奖号那两颗球的锚点 —— 十位在左、个位在右（落在台座的显示窗里）。
 * @source 0x00430c19–0x00430c80：`push 0x195 / push 0x11e`（=286,405）与 `push 0x195 / push 0x166`（=358,405）
 */
export const BALL_TENS_AT = [286, 405] as const;
export const BALL_ONES_AT = [358, 405] as const;
/**
 * 中央大号数字（`Data#517` 图 8..17）—— 十位在左、个位在右，压在玻璃球正中。
 * @source 0x00430c88 `push 0xdc / push 0x12c`（=300,220）与 0x00430cc2 `push 0xdc / push 0x154`（=340,220）
 */
export const BIG_DIGIT_TENS_AT = [0x12c, 0xdc] as const;
export const BIG_DIGIT_ONES_AT = [0x154, 0xdc] as const;

/**
 * 各人持号表：四块铭牌 2×2 排在屏幕下半，每块 296×60。
 * @source 表 `0x0042f30c`（8 个 dword 就是四对 x,y）+ `fcn_004552e7` 的 0x128/0x3c
 */
export const TALLY_PLATES = [
  [16, 340],
  [16, 410],
  [328, 340],
  [328, 410],
] as const;
/** 铭牌里号码的起点偏移与行距（相对铭牌左上角）@source 0x0042f55b */
export const TALLY_TEXT = { dx: 0x36, dy: 0x1e, pitch: 0x28, wrapAfter: 0x0a } as const;

/** 这一屏的两个音效（`Effect.mkf` 资源号 = 音效表项首 dword）*/
export const CEREMONY_SOUND = {
  /** 摇球那一拍 @source 0x00430471 `push 0 / push 0x47567b / call 0x4542ce`；`[0x47567b]` = 57 */
  drum: 57,
  /** 公布得主那一拍 @source 0x004306f3 `push 0 / push 0x475683` → 0x00430478；`[0x475683]` = 58 */
  winner: 58,
} as const;

// ============================================================
//  节奏
// ============================================================

/** 定时器周期 —— `SetTimer(hwnd, 0x113, 0x32)`，50 ms */
export const CEREMONY_TICK_MS = 0x32;
/**
 * 状态 3 数到第 20 拍才换手势、才开始推摇球 ANM @source 0x00430267 `cmp dh, 0x14 / jb`。
 * ★ 摇球机在这 20 拍里**停在第一帧**（`0x0043024c` 起的每拍段落在 `jb` 时整段跳过 `call 0x450f04`）。
 */
export const CEREMONY_ROLL_TICKS = 0x14;
/**
 * 状态 5 数满 30 拍才开始推礼花 ANM @source 0x00430f5e `cmp dl, 0x1e / jbe`。
 * ★ 礼花在这 30 拍里同样**停在第一帧**。
 */
export const CEREMONY_HOLD_TICKS = 0x1e;
/** 气泡最长 2 s —— `[0x4762c4]` 的 `timeGetTime` 差 ≥ 0x7d0；
 *  开了音效（`cfg+3`）则改成等语音播完（`fcn_004544b9`）*/
export const CEREMONY_VOICE_MS = 0x7d0;
/** 开出空号时的戏剧性停顿 —— `fcn_0045285e(0x1f4)` @source 0x00430d85（号码亮着停 0.5 秒）*/
export const CEREMONY_SORRY_PAUSE_MS = 0x1f4;

// ============================================================
//  脚本
// ============================================================

/**
 * 铺一张子图（整张或其中一块）。
 *
 * - 整张：`at` 扣锚点；`opaque` 为真 = `fcn_004563f5`（不透明），否则 `fcn_00456418`（抠黑）。
 * - 一块（`src` 给出）：`fcn_00456495(dst, 图, x, y, sx, sy, w, h)` —— `at` 就是落点左上角，
 *   **不扣锚点**；抠黑。`opaque` 同时为真 = `fcn_0045643d`（不透明整块拷）。
 */
export interface CeremonyBlit {
  entry: number;
  at: readonly [number, number];
  /**
   * `true` = 不透明。脸部贴片必须用这个 —— 它是**盖**在她脸上的一块，抠黑会露出原来的眼。
   */
  opaque?: boolean;
  /** 只取这张图的 `[sx, sy, w, h]` 那一块 */
  src?: readonly [number, number, number, number];
}

/** 从某张子图上拷一块矩形回来 —— 原版的「擦除」手法（`fcn_0045643d`，不透明）*/
export interface CeremonyPatch {
  /** 从哪张子图拷（通常是 `ENTRY.stage`，那块是没画人的干净底）*/
  from: number;
  /** 目标左上角 */
  at: readonly [number, number];
  /** 源矩形左上角 + **宽高** @source 参数是 (dest, sprite, dx,dy, sx,sy, w,h) */
  from4: readonly [number, number, number, number];
}

/** 起一个多帧子图动画 —— 原版 `fcn_00450ced(sprite, x, y, flags)`，每拍 `fcn_00450f04()` 推一帧 */
export interface CeremonyAnim {
  panel: number;
  entry: number;
  /** **左上角**（帧缓冲从 (x,y) 起铺，不扣锚点）*/
  at: readonly [number, number];
  flags: number;
  /** 起播后先停在第一帧这么多拍，才开始逐拍推进（见 `CEREMONY_ROLL_TICKS` / `CEREMONY_HOLD_TICKS`）*/
  delayTicks: number;
}

export interface CeremonyHold {
  /** 至少等这么多帧（50 ms/帧）*/
  ticks?: number;
  /** 还要等**正在播**的动画放完 */
  anim?: boolean;
  /** 还要等这句话说完（2 s，或语音播完）*/
  voice?: boolean;
  /** 硬停顿这么多毫秒（原版的 `fcn_0045285e`）*/
  pauseMs?: number;
}

export interface CeremonyStep {
  /**
   * 原版 `0x48c37b` 在这一步里的值。**不是给 UI 用的状态**，是让你能对着 exe 逐帧核。
   */
  state: number;
  /** 这一步说的话（`null` = 不说）*/
  line: OriginalText | null;
  /** 说话之前把字框换成哪一种（`fcn_0044ec30`）；省略 = 沿用上一次 */
  frame?: CeremonyFrameId;
  /** ① 先擦（从子图原样拷回）*/
  patches: readonly CeremonyPatch[];
  /** ② 再按顺序铺图 */
  blits: readonly CeremonyBlit[];
  /** ③ 贴两颗号码球（`ballBlits`）*/
  balls?: boolean;
  /** ④ 贴中央大号数字（`bigDigitBlits`，`Data#517`）*/
  digits?: boolean;
  /** ⑤ 写字 */
  texts: readonly CeremonyTextId[];
  /** ⑥ 重画各人持号表（`fcn_0042f417`）*/
  tally?: boolean;
  /** 这一步起的 ANM（先于擦/铺，原版 `fcn_00450ced` 在处理器开头）*/
  anim: CeremonyAnim | null;
  /** 这一步放的音效（`Effect.mkf` 资源号）*/
  sound?: number;
  hold: CeremonyHold;
}

/**
 * 屏上显示的号码 —— **槽号 + 1**（1..36），与投注屏、持号表同一口径。
 * @source 0x00430b77 `lea ebx,[edx+1]` / 0x00430b17–0x00430b23 `buf[n] = i + 1`（两条分支都是 1 基）
 */
export function displayNumber(slot: number): number {
  return slot + 1;
}

/** `"%02d"` 拆出来的两位（十位、个位）@source 0x00430b7a `sprintf(buf, "%02d", ebx)` */
export function numberDigits(slot: number): readonly [number, number] {
  const n = displayNumber(slot);
  return [Math.floor(n / 10) % 10, n % 10];
}

/**
 * 中奖号两颗球的贴片（十位在左、个位在右）。
 * @source 0x00430b8d–0x00430b9e `[0x48c37d] = buf[0] − 0xb`（`'0' − 0xb` = 0x25 = 37 = `ENTRY.ball`）
 *
 * @param slot 槽号 0..35（`LotteryDrawResult.number`）；球上是 `slot + 1`
 */
export function ballBlits(slot: number): readonly CeremonyBlit[] {
  const [tens, ones] = numberDigits(slot);
  return [
    { entry: ENTRY.ball + tens, at: BALL_TENS_AT },
    { entry: ENTRY.ball + ones, at: BALL_ONES_AT },
  ];
}

/**
 * 中央大号数字的贴片（`Data.mkf#517`，**图号是那一张资源里的**）。
 * @source 0x00430c88–0x00430cf4（抠黑 `fcn_00456418`，扣锚点）
 */
export function bigDigitBlits(slot: number): readonly CeremonyBlit[] {
  const [tens, ones] = numberDigits(slot);
  return [
    { entry: CEREMONY_BIG_DIGIT_BASE + tens, at: BIG_DIGIT_TENS_AT },
    { entry: CEREMONY_BIG_DIGIT_BASE + ones, at: BIG_DIGIT_ONES_AT },
  ];
}

/** 建屏那一下（`fcn_0042f6c3`）—— 原版在 0x401 里直接画，不属于任何状态 */
export const CEREMONY_BASE: CeremonyStep = {
  state: 0,
  line: null,
  // ★ 这里只**设**字框（0x0042f7d4 `call 0x44ec30`），不画 —— 气泡要到说第一句才出现
  frame: 'bubble',
  patches: [],
  blits: [
    { entry: ENTRY.stage, at: [0, 0], opaque: true },
    { entry: ENTRY.pointing, at: POSE_RIGHT },
    { entry: ENTRY.board, at: POSE_LEFT },
  ],
  texts: ['poolLabel', 'poolAmount'],
  tally: true,
  anim: null,
  hold: {},
};

/** 各人持号表那一条带（608×130，从底图上原样拷回来）@source 每个处理器开头那次 `擦(16,340,608,130)` */
const CLEAR_PLATES_BAND: CeremonyPatch = {
  from: ENTRY.stage,
  at: [16, 340],
  from4: [16, 340, 608, 130],
};

/** 从底图同位拷回 `(x, y, w, h)` 这一块 */
function wipe(x: number, y: number, w: number, h: number): CeremonyPatch {
  return { from: ENTRY.stage, at: [x, y], from4: [x, y, w, h] };
}

/** 左主持人（图 3）的腿 —— 持号表那条带擦掉了她的下半身，拿她自己的图补回来 */
const LEFT_LEGS: CeremonyBlit = { entry: ENTRY.board, at: [7, 340], src: [0, 274, 134, 130] };

/**
 * 排出一次开奖的完整演出（逐步对照见文件头那张表）。
 *
 * 纯函数：同样的 `draw` 得到同样的脚本；`number === null` 表示这次根本没开屏
 * （一张票都没卖出去，`0x00431720` 那个循环直接返回）。
 */
export function lotteryCeremony(draw: LotteryDrawResult): readonly CeremonyStep[] {
  if (draw.number === null) return [];

  const won = draw.winner !== null;
  const none = { patches: [], blits: [], texts: [], anim: null } as const;

  const steps: CeremonyStep[] = [
    // ── 状态 1：主持人开场（0x004301b9）──
    { state: 1, line: LOTTERY.drawIntro, ...none, hold: { voice: true } },
    // ── 状态 1→2：报幕（0x00430236）──
    { state: 2, line: LOTTERY.drawRolling, ...none, hold: { voice: true } },
    // ── 状态 2→3：起摇球机 + 右主持人换成摊手（0x0043036c）──
    {
      state: 3,
      line: null,
      anim: {
        panel: CEREMONY_DRUM_PANEL,
        entry: 0,
        at: [0xb7, 0x4b],
        flags: 8,
        delayTicks: CEREMONY_ROLL_TICKS,
      },
      patches: [CLEAR_PLATES_BAND, wipe(0x1d8, 0x74, 0x2d, 0x5a)],
      blits: [{ entry: ENTRY.presenting, at: POSE_PRESENTING }, LEFT_LEGS],
      texts: [],
      tally: true,
      sound: CEREMONY_SOUND.drum,
      hold: { ticks: CEREMONY_ROLL_TICKS },
    },
    // ── 状态 3 第 20 拍：手指重新竖起来，摇球机开始转（0x00430276–0x004302db）──
    {
      state: 3,
      line: null,
      anim: null,
      patches: [wipe(0x1a2, 0xab, 0x50, 0x50)],
      blits: [{ entry: ENTRY.pointing, at: [0x1d8, 0x75], src: [0, 0x33, 0x26, 0x5a] }],
      texts: [],
      hold: { anim: true },
    },
    // ── 状态 3 尾：开号 —— 号码球 + 中央大号数字（0x00430b7a–0x00430d2c）──
    {
      // 有人中：同一拍置 4 并说「本月份的得主是．．．。」（0x00430d5d）；
      // 没人中：先停 500 ms（0x00430d85），状态仍是 3
      state: won ? 4 : 3,
      line: won ? LOTTERY.drawWinnerIs : null,
      anim: null,
      patches: [CLEAR_PLATES_BAND],
      blits: [LEFT_LEGS],
      balls: true,
      digits: true,
      texts: [],
      tally: true,
      hold: won ? { voice: true } : { pauseMs: CEREMONY_SORRY_PAUSE_MS },
    },
  ];

  if (won) {
    steps.push(
      // ── 状态 4→5：公布得主（0x00430485）——「得主是……」**说完**才揭晓 ──
      {
        state: 5,
        line: null,
        anim: {
          panel: CEREMONY_WINNER_PANEL,
          entry: 0,
          at: [0xcd, 0],
          flags: 1,
          delayTicks: CEREMONY_HOLD_TICKS,
        },
        patches: [CLEAR_PLATES_BAND, wipe(0x1d8, 0x42, 0xa8, 0x19e), wipe(7, 0x42, 0x8c, 0x19e)],
        blits: [
          { entry: ENTRY.jumpBoard, at: [0, 0] }, // 左：举板过顶跳
          { entry: ENTRY.laugh, at: [0x1f9, 0x42] }, // 右：大笑
          { entry: ENTRY.burstWin, at: BURST_AT }, // 中央红爆炸框
        ],
        balls: true,
        texts: ['poolLabelTop', 'poolAmountTop', 'winnerName'],
        tally: true,
        sound: CEREMONY_SOUND.winner,
        hold: { ticks: CEREMONY_HOLD_TICKS, anim: true },
      },
      // ── 状态 5→6：礼花放完，台面收拾一半，说「恭喜」（0x00430f74–0x004310e3）──
      {
        state: 6,
        line: LOTTERY.drawWinAll,
        anim: null,
        patches: [CLEAR_PLATES_BAND, wipe(0x96, 0, 0x14a, 0x168)],
        blits: [
          { entry: ENTRY.jumpBoard, at: [0, 0x154], src: [0, 0x154, 0xa2, 0x78] },
          { entry: ENTRY.laugh, at: [0x1f9, 0x154], src: [0, 0x112, 0x7c, 0x82] },
        ],
        balls: true,
        texts: [],
        tally: true,
        hold: { voice: true },
      },
      // ── 状态 6→8：两位主持人回到开场姿势（0x004306ff）；不说话，下一拍就进 8 ──
      {
        state: 8,
        line: null,
        anim: null,
        patches: [CLEAR_PLATES_BAND, wipe(0, 0, 0xa0, 0x1e0), wipe(0x1ea, 0, 0x96, 0x1e0)],
        blits: [
          { entry: ENTRY.pointing, at: POSE_RIGHT },
          { entry: ENTRY.board, at: POSE_LEFT },
        ],
        balls: true,
        texts: ['poolLabel', 'poolAmount'],
        tally: true,
        hold: {},
      },
    );
  } else {
    steps.push(
      // ── 状态 3→7：开出空号（0x00430d92）—— 字框换成黄色爆炸框，「SORRY」写在框里 ──
      {
        state: 7,
        line: LOTTERY.drawNoWinner,
        frame: 'burst',
        anim: null,
        patches: [CLEAR_PLATES_BAND, wipe(0x1d8, 0, 0xa9, 0x1e0)],
        blits: [
          LEFT_LEGS,
          { entry: ENTRY.oops, at: [0x1e9, 0x74] }, // 右：捂嘴带汗
          // ★ 左主持人**整张脸**换成苦笑那张（不透明贴片，50×40）
          { entry: ENTRY.faceWry, at: [0x34, 0x59], opaque: true },
        ],
        balls: true,
        texts: [],
        tally: true,
        hold: { voice: true },
      },
      // ── 状态 7→8：「獎金將累積到下個月」—— 仍在爆炸框里（0x004308e0）──
      { state: 8, line: LOTTERY.drawCarryOver, ...none, hold: { voice: true } },
    );
  }

  // ── 状态 8→9：收尾（0x004308f3）—— 右主持人与左脸还原，字框换回气泡 ──
  steps.push(
    {
      state: 9,
      line: LOTTERY.drawHopeNext,
      frame: 'bubble',
      anim: null,
      patches: [CLEAR_PLATES_BAND, wipe(0x1e9, 0x74, 0x97, 0x16c)],
      blits: [
        LEFT_LEGS,
        { entry: ENTRY.pointing, at: POSE_RIGHT },
        // 左脸还原：从她自己的图里把中性脸那一块**不透明**拷回来（0x004309d4）
        { entry: ENTRY.board, at: [0x34, 0x59], src: [0x2d, 0x17, 0x32, 0x28], opaque: true },
      ],
      balls: true,
      texts: [],
      tally: true,
      hold: { voice: true },
    },
    // ── 状态 9→10：最后一句，然后派彩关屏（0x00430aa3 / 0x00430ab5）──
    { state: 10, line: LOTTERY.drawHurryUp, ...none, hold: { voice: true } },
  );

  return steps;
}

// ============================================================
//  脸部动画（眨眼 / 张嘴）
// ============================================================

/**
 * 两个主持人的脸是**一块块贴片拼出来的**：原版拿 `0x48c350` 一个 dword 当调色盘，
 * 低 4 位 = 当前在动的那一个槽，其余每个 4 位段 = 该槽的帧号。
 *
 * | 槽 | 贴片矩形 | 帧表（Panel#15 子图号）|
 * |---|---|---|
 * | 1 | 右眼 (512,102)-(562,118) | 8,7,8,10 |
 * | 2 | 左眼 (52,89)-(102,115)   | 16,17,16,15 |
 * | 3 | 右眼（变体）            | 9,10 |
 * | 4 | 左眼（变体）            | 14,15 |
 *
 * 另有右主持人的嘴：(512,119)-(562,141)，静止是 11、动起来在 12/13 之间跳
 * （`0x48c34c` 管停留几帧）。左主持人的嘴（子图 18..20）在同屏没找到调用点。
 *
 * @source 0x004310ff 的跳表 `0x004300f8`（5 项）与 `0x00431431` 之后的嘴
 */
export const FACE_SLOTS = [
  { rect: [512, 102, 562, 118], frames: [8, 7, 8, 10] },
  { rect: [52, 89, 102, 115], frames: [16, 17, 16, 15] },
  { rect: [512, 102, 562, 118], frames: [9, 10] },
  { rect: [52, 89, 102, 115], frames: [14, 15] },
] as const;

/** 右主持人的嘴 */
export const FACE_MOUTH = { rect: [512, 119, 562, 141], rest: 11, moving: [12, 13] } as const;

/** 贴片不透明重画 → 空档（槽做完了就回「没人动」）*/
const FACE_IDLE_TICKS = 6;

/** 32 位 hash —— 把一个帧号摊成一个看起来随机的数 */
function hash32(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/**
 * 第 `tick` 帧该往脸上贴什么。
 *
 * ★ **原版是 `libc_rand()` 抽的**（`rand()>>9` 落 0 / 1 / 2-3 / 4-5 时分别启动
 *   槽 1/2/3/4，其余 58/64 不动 —— 平均 0.9 秒才跳一次）。这里改成**按帧号推**，
 *   不是改良：动画不该消耗游戏随机流（C-DET-1），而且原版每天
 *   `srand(GetTickCount())`，那串数本来就不可复现，抄也抄不出「一样的眨眼时刻」。
 *   每个槽按原版的**触发概率**抽：1/64、1/64、2/64、2/64。
 *
 * ★ 动画只在**状态 1/2/3/9/10** 跑：得主公布那几步（4..8）她的脸是冻住的
 *   （`0x004310eb` 的 `cmp bh,4 / jb` + `cmp bh,8 / jbe` 那道闸）。
 *
 * @param tick 从建屏起的帧号（50 ms/帧）
 */
export function facePartsAt(tick: number): readonly CeremonyBlit[] {
  const out: CeremonyBlit[] = [];
  const h = hash32(tick);

  // 每 64 帧抽一次「哪个槽起跳」，命中后连播它的帧表
  const phase = tick % 64;
  const roll = h % 64;
  const slot: 0 | 1 | 2 | 3 | null = roll === 0 ? 0 : roll === 1 ? 1 : roll < 4 ? 2 : roll < 6 ? 3 : null;
  if (slot !== null) {
    const def = FACE_SLOTS[slot];
    const frame = def.frames[Math.floor(phase / FACE_IDLE_TICKS) % def.frames.length]!;
    out.push({ entry: frame, at: [def.rect[0], def.rect[1]], opaque: true });
  }

  // 嘴：一直在一张一合（原版靠 `rand()&0xf` 决定张多久）
  const speaking = hash32(tick ^ 0x5bf03635) % 14 < 4;
  out.push({
    entry: speaking ? FACE_MOUTH.moving[hash32(tick) % 2]! : FACE_MOUTH.rest,
    at: [FACE_MOUTH.rect[0], FACE_MOUTH.rect[1]],
    opaque: true,
  });

  return out;
}
