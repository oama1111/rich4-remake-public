/*
 * 拍賣屏（T-034 / U-7 / Q-AUC-1）—— PASS / +100 / +500 / +1000 / +5000 / +10000 / 放棄
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `pending.kind === 'auction'`（拍賣卡 T-007、破產清算、新聞事件、魔法屋都走这一屏）
 * 时接管整屏。**规则与竞价循环都在 core**：起拍价 `auctionBasePrice`、结算
 * `settleAuction`、心理价位 `auctionAiLimits`、挑档 `auctionAiRaise`、
 * 出价循环 `state/reduce.ts` 的 `auctionBid`（一口一个 action）。
 *
 * ★ **Q-AUC-1 定案（2026-09-15）：这一屏不再自己跑竞价。**
 *   原版那条循环是窗口过程里 100ms 定时器驱动的「轮到谁 → 真人点钮 / 电脑
 *   算一口 → 复查还剩几个能出价的」；先前把它整条放在本屏，导致**无头跑
 *   core 时拍賣永远答不掉**（服务端权威、纯 AI 局都卡死）。现在循环归 core：
 *
 *   | 谁 | 这一口怎么来 |
 *   |---|---|
 *   | 电脑 | `decideAction`/`auctionNextBid`（core）算好 → 本屏 dispatch `auctionBid` |
 *   | 真人 | 本屏收点钮 → dispatch `auctionBid` |
 *
 *   终局也由 core 判（`auctionFinished` / `auctionOutcome`）；本屏只把每一口
 *   **演出来**（挥槌动画、价格、座位状态、消息框）。
 *
 * ## 出处（窗口过程 `fcn_0043a2dd` VA 0x0043a2dd；入口 `_rich4_ui_auction_entry`
 * VA 0x0043bde5；两份都在 `rich4-re/asm/rich4_ui_auction.asm`）
 *
 * | 是什么 | @source |
 * |---|---|
 * | 底图 = `Panel.mkf` **#26** 图 0（640×480），落点 (0,0) | 0x43c30b |
 * | 拍賣官 = 图 25（154×352），落点 (123,24)，带透明 | 0x43c32c |
 * | 助手小姐 = 图 17（109×388），落点 (67,63)，带透明 | 0x43c34a |
 * | 待拍产业缩略图 = 图 `auctionEntityImage(...)`，落点 (232,180) | 0x43c376 |
 * | 「標價：」flag 0 (182,242) | 0x43c39f |
 * | 「%d元」flag 1 (272,262) | 0x43c3cc |
 * | 四个座位：座位坐标 x = 80 + 120×i（原版拿它当**纵**坐标）| 0x43c3f0 / 0x43c5c7 |
 * | 座位小人 = 图 `78 + 角色号`（黄色剪影），落点 (590, 座位 x) | 0x43c4f5 |
 * | 座位状态字 flag 2 在 (590, 座位 x + 14) | 0x43c46d |
 * | 座位现金 flag 6 在 (620, 座位 x + 14) | 0x43c43c |
 * | 卖主换自己的那张 = 资源 `3×角色+27` 图 0，同一个落点 | 0x43c4cb |
 * | 七颗钮：常态 图 `2i+4`、按下 图 `2i+3`，落点 (406, 133 + 48i) | 0x43b010 / 0x43bb86 |
 * | 七颗钮的命中框 `x∈[363,449]`、`y∈[中心−19, 中心+19]` | 0x43bb86 |
 * | 消息框 = 图 2（244×100，锚点 (122,50)）落点 (410,60)，字 20 号 #101010 居中 | 0x43c680 / 0x44ed71 |
 * | 消息 2 秒后自动消失 | 0x44ee4f `cmp eax, 0x7d0` |
 * | 定时器 100ms | 0x43a365 `push 0x64` 的 `SetTimer` |
 * | 每一次 `0x407` 都放音效 63 | 0x43a3fc `play_sound_effect(0x475bc2)` |
 * | 成交那一下放音效 29 | 0x43b412 `play_sound_effect(0x475bba)` |
 *
 * ⚠️ **图自带的 x/y 是裁切原点，落点要减掉它**（`to_left = x - src->x`，
 *   `fcn_00456418` VA 0x00456418）：拍賣官/助手/小人/钮全都是**带透明**的贴图；
 *   底图与消息框那种整块不透明的才走 `fcn_004563f5`。
 *
 * ⚠️ 消息串表里带 `#0131` 这类前缀 —— 原版显示前会
 *   `cmp byte [eax], '#' / add eax, 5` 跳掉（见 `places/magic-house.ts` 注），
 *   这里直接存**跳掉之后**的字。
 *
 * ★ 原版把 PASS 记成状态 **1**（于是显示成「住宿中」）—— 见
 *   `docs/deviations/T-034.md` 的 `D-T034-1`，本屏照抄。
 */

import type { PendingInteraction, Player } from '@rich4/core';
import {
  auctionCanAfford,
  auctionNextBid,
  effectiveFacility,
  effectiveLand,
  isAiControlled,
} from '@rich4/core';
import type { Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type AuctionSprite = (
  archive: 'Panel.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 本屏的资源号 @source 0x43c0f5 `read_mkf(panel_mkf, 0x1a, 0, 0)` */
export const AUCTION_RESOURCE = 0x1a;

/**
 * 用到的图号。
 *
 * ★ 「图 n」= 表内第 n 条（`base + 0xc + n×12`）—— `0xc` 是资源头，别忘。
 */
export const AUCTION_CHUNK = {
  /** 640×480 底图（拍賣台、槌子都烤在里面）@source 0x43c30b */
  bg: 0,
  /** 右侧举槌的拍賣官 154×352 @source 0x43c32c */
  auctioneer: 25,
  /** 左侧的助手小姐 109×388 @source 0x43c34a */
  assistant: 17,
  /** 消息框底板 244×100 @source 0x43c680 */
  messageBox: 2,
  /** 七颗钮的**常态**图；下标就是钮序 @source 0x43b010 `2i+4` */
  buttonOn: [4, 6, 8, 10, 12, 14, 16],
  /** 七颗钮的**按下**图 @source 0x43bb86 `2i+3` */
  buttonOff: [3, 5, 7, 9, 11, 13, 15],
} as const;

/**
 * 每个角色占 **3 个连续资源**（`3×角色 + 0x1b / 0x1c / 0x1d`），
 * 入口对每个座位各读一次 @source 0x43c246 / 0x43c284 / 0x43c2bb。
 *
 * | 基址 | 用途 | @source |
 * |---|---|---|
 * | `+0x1b` | 出价/举牌动画 | 0x43a6d5、0x43b3c2 |
 * | `+0x1c` | 「放棄」那一张 | 0x43a43a |
 * | `+0x1d` | 第二段动画 | 0x43ab5a |
 */
export const AUCTION_CHARACTER_RES = { bid: 0x1b, giveUp: 0x1c, bid2: 0x1d } as const;

/** 座位小人（黄色剪影）的图号基址 = `0x4e + 角色号` @source 0x43c4f5 */
export const AUCTION_SEAT_FIGURE = 0x4e;

// ============================================================
//  版面（屏幕坐标 640×480）
// ============================================================

/** 三张大图的落点 @source 0x43c32c / 0x43c34a / 0x43c376 */
export const AUCTION_ART = {
  auctioneer: { x: 0x7b, y: 0x18 },
  assistant: { x: 0x43, y: 0x3f },
  entity: { x: 0xe8, y: 0xb4 },
} as const;

/** 「標價：」与金额：前者 flag 0（左上）、后者 flag 1（右上）@source 0x43c39f / 0x43c3cc */
export const AUCTION_PRICE_TEXT = {
  label: { x: 0xb6, y: 0xf2 },
  value: { x: 0x110, y: 0x106 },
  labelText: '標價：',
} as const;

/** 金额格式串 `%d元` @source 0x465050 */
export const AUCTION_MONEY_FORMAT = '%d元';

/** 消息框（图 2）的**锚点落点** @source 0x43c680 `fcn_0044ec30(图 2, 0x19a, 0x3c, 0,0, …)` */
export const AUCTION_MESSAGE_AT = { x: 0x19a, y: 0x3c } as const;

/** 四个座位 @source 0x43c3f0 `mov [esp+0x8c], 0x50` / 0x43c5c7 `add [esp+0x8c], 0x78` */
export const AUCTION_SEAT = {
  x0: 0x50,
  dx: 0x78,
  count: 4,
  /** 小人 / 状态字的 x @source `push 0x24e` */
  figureX: 0x24e,
  /** 现金的 x @source `push 0x26c` */
  cashX: 0x26c,
  /** 状态字 / 现金在小人基线下面这么多 @source `add eax, 0xe` */
  textDy: 0xe,
} as const;

/** 第 `i` 个座位的纵坐标 */
export function auctionSeatY(i: number): number {
  return AUCTION_SEAT.x0 + i * AUCTION_SEAT.dx;
}

/**
 * 七颗钮。
 *
 * y 表 `0x475b84` = `[0x85, 0xb5, 0xe5, 0x115, 0x145, 0x175, 0x1a5]`
 * （133..421，步长 48）；命中框 `x∈[0x16b,0x1c1]`、y 各 ±0x13。
 * @source 0x43bb86
 */
export const AUCTION_BUTTON = {
  cx: 0x196,
  y0: 0x85,
  dy: 0x30,
  count: 7,
  /** `0x196 − 0x16b = 0x1c1 − 0x196 = 0x2b` */
  halfW: 0x2b,
  halfH: 0x13,
} as const;

export function auctionButtonY(i: number): number {
  return AUCTION_BUTTON.y0 + i * AUCTION_BUTTON.dy;
}

/** 第 `i` 颗钮的命中框（屏幕坐标，闭区间）*/
export function auctionButtonRect(i: number): { x: number; y: number; w: number; h: number } {
  return {
    x: AUCTION_BUTTON.cx - AUCTION_BUTTON.halfW,
    y: auctionButtonY(i) - AUCTION_BUTTON.halfH,
    w: AUCTION_BUTTON.halfW * 2 + 1,
    h: AUCTION_BUTTON.halfH * 2 + 1,
  };
}

/** 点在七颗钮里的哪一颗上；没点中返回 null @source 0x43bb86 */
export function hitAuctionButton(x: number, y: number): number | null {
  for (let i = 0; i < AUCTION_BUTTON.count; i++) {
    const cy = auctionButtonY(i);
    if (x < AUCTION_BUTTON.cx - AUCTION_BUTTON.halfW) continue;
    if (x > AUCTION_BUTTON.cx + AUCTION_BUTTON.halfW) continue;
    if (y < cy - AUCTION_BUTTON.halfH) continue;
    if (y > cy + AUCTION_BUTTON.halfH) continue;
    return i;
  }
  return null;
}

/**
 * 七颗钮各自是干什么的 —— 与原版的 `0x407` 消息一一对应。
 *
 * @source 0x43bc59：抬起时 `PostMessage(0x407, 钮序)`；`0x407` 的处理里
 *   `ebx == 0` → PASS（`loc_0043a426`）、`ebx == 6` → 放棄（`loc_0043a43a`）、
 *   `ebx ∈ 1..5` → 按 `0x475ba2` 的档位加价（`loc_0043a478`）。
 *
 * ★ PASS 与 放棄 在原版里**结果一样**（都把这一位踢出竞价），
 *   只是 放棄 多放一段动画。
 *
 * ## ★ 七颗钮是「**按下记账、抬手成立**」—— 别接反
 *
 * | 消息 | 原版 | 做什么 |
 * |---|---|---|
 * | `WM_LBUTTONDOWN` 0x201 | `loc_0043bb25` | **只**记 `[0x48c4af] = 钮序+1` 并把那一颗画成按下图；**不成交** |
 * | `WM_LBUTTONUP` 0x202 | `loc_0043bc59` | 钮序复原、重画常态图，然后 `PostMessage(hwnd, 0x407, 钮序, 0)` ← **这一下才真的加价/PASS** |
 *
 * 所以本模块 `down()` 只写 `pressed`，`up()` 才 `applyBid()`。
 * 宿主（`main.ts`）的分派必须是 `canvas mousedown → down()`、`window mouseup → up()`；
 * 早先接成 `click → down()` + `mouseup → up()` 时 `up` 会**先于** `down` 到，
 * 于是七颗钮一下都点不动（已由中央修正）。
 *
 * 实测（2026-09-15，headless Chrome + 真 dev server）：`mousedown` 之后现价仍是
 * 3000（消息框还写着「底價3000元」）；再 `mouseup` 才变成 4000。
 */
export const AUCTION_BUTTONS = [
  { kind: 'pass', step: 0, text: 'ＰＡＳＳ' },
  { kind: 'raise', step: 100, text: '+100' },
  { kind: 'raise', step: 500, text: '+500' },
  { kind: 'raise', step: 1000, text: '+1000' },
  { kind: 'raise', step: 5000, text: '+5000' },
  { kind: 'raise', step: 10000, text: '+10000' },
  { kind: 'giveUp', step: 0, text: '放棄' },
] as const;

export type AuctionButtonKind = 'pass' | 'raise' | 'giveUp';

/** 挥锤动画的**帧数** —— 三帧一循环 */
export const AUCTION_HAMMER_FRAMES = 3;

/**
 * 动画节拍。
 *
 * @source 0x43a365：入口 `SetTimer(hwnd, callbackSize, 0x64, 0)` —— **100ms 一帧**。
 * 设定屏的「動畫過程」关掉时原版不进这一段；本引擎的 `UiScreenEnv` 没带设定值，
 * 屏上按**开**处理（见 deviations 的 D-T034-2）。
 */
export const AUCTION_FRAME_MS = 0x64;

/** 第 `elapsed` 毫秒该画第几帧 @source 0x43a6d5 `[0x48c4a4] >> 8` 那个帧计数 */
export function hammerFrame(elapsed: number, frames = AUCTION_HAMMER_FRAMES): number {
  if (frames <= 1) return 0;
  const n = Math.floor(elapsed / AUCTION_FRAME_MS);
  return ((n % frames) + frames) % frames;
}

/** 消息框停留 2000ms @source 0x44ee4f `cmp eax, 0x7d0` */
export const AUCTION_BOX_MS = 2000;

/** 每一下 `0x407` 的音效 @source 0x43a3fc（`0x475bc2` 首字节 = 0x3f）*/
export const AUCTION_SOUND_BID = 0x3f;
/** 成交那一下的音效 @source 0x43b412（`0x475bba` 首字节 = 0x1d）*/
export const AUCTION_SOUND_DEAL = 0x1d;

// ============================================================
//  串（全部 dump 自 `rich4.exe` 的串表，已跳掉 `#013x` 消息号前缀）
// ============================================================

/** 六个「不在场」状态 —— 下标 0..5 对应状态 1..6 @source 0x464ea8 起的 7 条 */
export const AUCTION_STATUS_TEXT = [
  '住宿中',
  '消失中',
  '坐牢中',
  '住院中',
  '冬眠中',
  '夢遊中',
] as const;

/** 賣方的状态字（状态 7）@source 0x464ed2 */
export const AUCTION_SELLER_TEXT = '賣方';

/** 开场那一句 @source 0x465038 */
export const AUCTION_INTRO_TEXT = '公開拍賣土地一處。';

/** 请出价 @source 0x46507d */
export const AUCTION_ASK_FORMAT = '底價%d元\n請意者出價。';

/** 没人出价 @source 0x465063 */
export const AUCTION_PASSED_IN_TEXT = '無人出價，宣佈流標。';

/** 成交价 @source 0x465098 */
export const AUCTION_DEAL_FORMAT = '%d元成交';

/** 得标播报（按角色号取）@source 0x464ed7..0x464ff7 的 12 条 */
export const AUCTION_WINNER_TEXT = [
  '恭喜約翰喬購得此地！',
  '恭喜沙隆巴斯購得此地！',
  '恭喜忍太郎購得此地！',
  '恭喜錢夫人購得此地！',
  '恭喜阿土伯購得此地！',
  '恭喜莎拉公主購得此地！',
  '恭喜宮本寶藏購得此地！',
  '恭喜糖糖購得此地！',
  '恭喜烏咪購得此地！',
  '恭喜孫小美購得此地！',
  '恭喜小丹尼購得此地！',
  '恭喜金貝貝購得此地！',
] as const;

// ============================================================
//  待拍产业画哪一张（原版 `[0x48c494]` 的算法）
// ============================================================

/**
 * 状态字画哪一句。
 * @source 0x43c624：状态 1..6 → `_player_state_strings[状态−1]`；7 → 賣方。
 */
export function auctionStatusText(away: number): string {
  return AUCTION_STATUS_TEXT[away - 1] ?? AUCTION_STATUS_TEXT[0];
}

/**
 * 座位在**原版状态字表**里的编号（座位表 `+2` 那个 word）。
 *
 * | 号 | 含义 | 谁写的 |
 * |---|---|---|
 * | 0 | 可出价 | 入口默认 @0x43bf2e |
 * | 1..6 | 住宿中/消失中/坐牢中/住院中/冬眠中/夢遊中 | 入口按 `+0x32..+0x37` 逐条 @0x43c152 起 |
 * | 7 | 賣方 | 入口 `cmp ebx, 卖主` @0x43c22a |
 * | 8 | 出不起底价 | 入口 `cmp 现金, 底价 / jg` @0x43c140 |
 *
 * ★ **PASS 也记 1**（@0x43a426 `mov word [座位+2], 1`），所以按原版，
 *   PASS 掉的那一格**显示「住宿中」**（状态 1 → `_player_state_strings[0]`）。
 *   那是原版复用状态位的做法，本屏照抄，见 `docs/deviations/T-034.md` 的 D-T034-1。
 */
export const AUCTION_PASSED_CODE = 1;

/** 卖主的状态号 @source 0x43c22a */
export const AUCTION_SELLER_CODE = 7;

/** 出不起底价的状态号 @source 0x43c140 */
export const AUCTION_BROKE_CODE = 8;

/** 座位 → 原版状态号 */
export function auctionSeatCode(seat: {
  state: AuctionSeatState;
  away: number;
}): number {
  switch (seat.state) {
    case 'seller':
      return AUCTION_SELLER_CODE;
    case 'passed':
      // ★ 原版把 PASS 也记成 1 —— 于是显示「住宿中」，本屏照抄
      return AUCTION_PASSED_CODE;
    case 'away':
      return seat.away;
    case 'broke':
      return AUCTION_BROKE_CODE;
    default:
      return 0;
  }
}

/** 六个「不在场」里的第几号；都不是返回 0 @source 0x496b9a..0x496b9f 的六次 `cmp` */
export function awayCodeOf(p: Player): number {
  if (p.blocking.inHotel !== 0) return 1;
  if (p.blocking.disappearing !== 0) return 2;
  if (p.blocking.inPrison !== 0) return 3;
  if (p.blocking.inHospital !== 0) return 4;
  if (p.blocking.sleeping !== 0) return 5;
  if (p.blocking.sleepWalking !== 0) return 6;
  return 0;
}

/**
 * 待拍的地块/設施该画 `Panel.mkf#26` 的哪一张。
 *
 * @source 入口 VA 0x0043be0a 起那两段（地块）/ 0x0043bf3a 起（設施）。
 *
 * | 情形 | 图号 |
 * |---|---|
 * | 地块 0 级、无主 | `0x5a` = 90（「售」牌插在草地上）|
 * | 地块 0 级、有主 | `角色号 + 0x5b` = 91..102 |
 * | 地块 ≥1 级、`type == 0` | `地图号×5 + 等级 + 0x1d` |
 * | 地块 ≥1 级、`type != 0` | `0x32` = 50 |
 * | 設施 0 级、无主 | `0x67` = 103 |
 * | 設施 0 级、有主 | `角色号 + 0x68` = 104..115 |
 * | 設施 ≥1 级、`type == 0` | `0x33` = 51 |
 * | 設施 ≥1 级、`type > 0` | `(type−1)×5 + 等级 + 0x33` |
 *
 * `mapStyle` 就是 `[0x4991b8]` = **地图号**（`new_game.asm:3361`
 * `mov al, byte [0x48a439] / dec eax`）—— 本引擎的 `GameState` 里没有这一项，
 * 调用方传 0，见 deviations 的 D-T034-3。
 */
export function auctionEntityImage(
  entity: { level: number; type: number; owner: number },
  facility: boolean,
  characterOfOwner: (owner: number) => number,
  mapStyle: number,
): number {
  if (!facility) {
    if (entity.level === 0) {
      return entity.owner === 0 ? 0x5a : characterOfOwner(entity.owner) + 0x5b;
    }
    if (entity.type !== 0) return 0x32;
    return mapStyle * 5 + entity.level + 0x1d;
  }
  if (entity.level === 0) {
    return entity.owner === 0 ? 0x67 : characterOfOwner(entity.owner) + 0x68;
  }
  if (entity.type === 0) return 0x33;
  return (entity.type - 1) * 5 + entity.level + 0x33;
}

// ============================================================
//  显示视图（**只读** core 的 pending；循环本身在 core）
// ============================================================

export type AuctionSeatState = 'canBid' | 'away' | 'seller' | 'broke' | 'passed';

export interface AuctionSeat {
  /** 玩家下标（0 基）*/
  player: number;
  character: number;
  cash: number;
  state: AuctionSeatState;
  /** `state === 'away'` 时是六种不在场里的哪一号 */
  away: number;
  /** core 存在 `pending.limits` 里的「心理价位」；真人座位不读 @source 0x43c60f */
  aiLimit: number;
}

export interface AuctionRun {
  seats: AuctionSeat[];
  /** 轮到哪个座位（下标）—— 与 core 的 `pending.seat` 同义 */
  current: number;
  /** 现价（原版 `[0x48c488]`，core 的 `pending.price`）*/
  price: number;
  basePrice: number;
  /** 目前最高出价者的座位下标；-1 = 还没人出价 @source `[0x48c4a8]` */
  top: number;
  phase: 'bidding' | 'sold' | 'passedIn';
  /** 得标者**玩家下标**；-1 = 流拍 */
  winner: number;
}

/**
 * 按 core 的 `pending{auction}` 建一份**只读**座位视图。
 *
 * @source 入口 `loc_0043c110` 起那段的状态分类：
 * 卖主 = 7、不在场 = 1..6、出不起底价 = 8、可出价 = 0。
 * 竞价进行中的 `'passed'` / `'givenUp'` 都是原版的非 0 档（PASS 记 1、
 * 放棄 记 4），这里按**有没有人出过价**细分，只为把图/字演对：
 * - 还没人出过价就 givenUp 的 = **出不起底价**（画 status 8 那张）；
 * - 其余 = PASS 掉的那一格（显示成「住宿中」，见 D-T034-1）。
 */
export function seatViewOf(
  pending: Extract<PendingInteraction, { kind: 'auction' }>,
  players: readonly Player[],
  seller: number,
): AuctionSeat[] {
  const top = pending.top;
  const status = pending.status;
  const counted = pending.bidders.filter((i) => (status[i] ?? 'active') !== 'active').length > 0;
  const seats: AuctionSeat[] = [];
  for (const i of pending.bidders) {
    const p = players[i];
    if (p === undefined) continue;
    const away = awayCodeOf(p);
    const st = status[i] ?? 'active';
    let state: AuctionSeatState;
    if (i === seller) state = 'seller';
    else if (st !== 'active') {
      state = counted || top >= 0 ? 'passed' : 'broke';
      if (p.cash <= pending.basePrice) state = 'broke';
    } else if (away !== 0) state = 'away';
    else if (p.cash <= pending.basePrice) state = 'broke';
    else state = 'canBid';
    seats.push({
      player: i,
      character: p.character,
      cash: p.cash,
      state,
      away,
      aiLimit: pending.limits[i] ?? 0,
    });
  }
  return seats;
}

// ============================================================
//  绘制
// ============================================================

/** flag → 对齐方式 @source 跳表 0x44faa0（handoff §5）*/
function textAnchor(flag: number): { align: CanvasTextAlign; baseline: CanvasTextBaseline } {
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
      return { align: 'left', baseline: 'top' };
  }
}

const AUCTION_FONT = FONT_FAMILY;
/** 屏幕上的字 18 号、白字 + 3px 深色描边 @source 0x43c30b `create_font(0x12, 0xffffff, 0x101010, 3, 0)` */
const AUCTION_FONT_SIZE = 0x12;
/** 消息框里的字 20 号、纯 #101010、**无描边** @source 0x44ed71 */
const AUCTION_BOX_FONT_SIZE = 0x14;

function auctionText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  flag: number,
): void {
  const a = textAnchor(flag);
  ctx.font = `${AUCTION_FONT_SIZE}px ${AUCTION_FONT}`;
  ctx.textAlign = a.align;
  ctx.textBaseline = a.baseline;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#101010';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

/** 锚点落点绘制 —— (x,y) 是图的 `anchorX/anchorY` 所在处 @source `fcn_00456418` */
function drawAnchored(
  ctx: CanvasRenderingContext2D,
  s: Sprite | null,
  x: number,
  y: number,
): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

export interface AuctionSeatView {
  player: number;
  character: number;
  state: AuctionSeatState;
  away: number;
  cash: number;
}

/** 这一帧要画成什么样 */
export interface AuctionDraw {
  seats: readonly AuctionSeatView[];
  /** 轮到哪个座位 */
  current: number;
  /** 最高出价者的座位下标；-1 = 无 */
  top: number;
  price: number;
  /** 待拍产业缩略图（见 `auctionEntityImage`）*/
  entityImage: number;
  /** 正被按住的钮；null = 没有 */
  pressed: number | null;
  /** 真人这一格现在能不能点 —— 原版判据是相位 == 3 @source 0x43bb25 */
  humanTurn: boolean;
  /** 正在挥槌的座位与已播时长（毫秒）；`null` = 这一帧不播 */
  animating: { seat: number; elapsed: number } | null;
  /** 消息框里的字；`null` = 不画 */
  message: string | null;
}

/**
 * 哪几张图要**抠黑**（原版走带透明的 `fcn_00456418`；不抠的那张走整块贴图
 * `fcn_004563f5`）。
 *
 * ★ 判据不是猜的 —— 把 `assets-clean/Panel/0026_*.png` 逐张数一遍
 *   「**近黑**像素占比」（`r,g,b < 10`，`assets-clean` 的 SMP 是原样落盘的，
 *   没有预先抠过色）：
 *
 * | 图 | 是什么 | 近黑占比 | 分布 | 原版 | 抠？ |
 * |---|---|---|---|---|---|
 * | **0** | 640×480 整屏底图 | **0.9%** | **散在画面里（阴影/黑西装）** | `fcn_004563f5` @0x43c30b | **✗** |
 * | 2 | 消息框底板 | 1.2% | 四个圆角 | `fcn_00456418` @0x44ecfa | ✓ |
 * | 3..16 | 七颗钮（常态/按下） | 21~23% | 四周 | `fcn_00456418` @0x43b010 | ✓ |
 * | 17 | 助手小姐 | 55.8% | 四周 | `fcn_00456418` @0x43c34a | ✓ |
 * | 25 | 拍賣官 | 64.9% | 四周 | `fcn_00456418` @0x43c32c | ✓ |
 * | 78..89 | 座位剪影（`0x4e+角色号`） | 79~82% | 四周 | `fcn_00456418` @0x43c4f5 | ✓ |
 * | 90..115 | 待拍产业缩略图 | 41~45% | 四周 | `fcn_00456418` @0x43c376 | ✓ |
 *
 * 也就是说：**这一屏只有那张 640×480 的底图不能抠**（它的黑是真黑），
 * 其余每一张的黑都是背景。做成函数而不是散在各处的字面量，免得漏一个
 * ——消息框那 1.2% 的四个圆角就是这么漏掉的（会看到四个黑角）。
 */
export function auctionKeyed(index: number): boolean {
  return index !== AUCTION_CHUNK.bg;
}

/** 资源 26 的图 —— 抠不抠黑只有 `auctionKeyed()` 一个出口，别在各处手写 */
export function auctionSprite(sprite: AuctionSprite, index: number): Sprite | null {
  return sprite('Panel.mkf', AUCTION_RESOURCE, index, auctionKeyed(index));
}

/**
 * 每个角色那三份资源（`3×角色 + 0x1b/0x1c/0x1d` = 27..62）的图。
 *
 * 逐张数过：近黑占比 **24%~50%**，全在四周 → 一律**带透明**
 * （原版 `fcn_00456418` @0x43b3c2 / `fcn_0045663e` @0x43a6d5）。
 */
export function auctionCharacterSprite(
  sprite: AuctionSprite,
  character: number,
  role: keyof typeof AUCTION_CHARACTER_RES,
  image: number,
): Sprite | null {
  return sprite('Panel.mkf', 3 * character + AUCTION_CHARACTER_RES[role], image, true);
}

/**
 * 消息框里那几行字的中心。
 *
 * @source `fcn_0044ecb6` VA 0x0044ed71 起：
 * ```asm
 * [0x48c608] = x − src->x      ; ★ 先减掉图自己的原点，才是**左上角**
 * [0x48c60c] = y − src->y
 * draw_text(…, x = [0x48c608] + src->w/2 + dx, y = [0x48c60c] + src->h/2 + dy, flag 4)
 * ```
 * 拍卖那一处传进来的 `dx = dy = 0`（@0x43c680 的 `push 0 / push 0`），
 * 所以字心就是**框的中心** (410,60)。
 *
 * ⚠️ 别写成 `锚点 + w/2` —— 那是 (532,110)，字会跑到框的右下角去（踩过）。
 */
export const AUCTION_MESSAGE_BOX = {
  width: 244,
  height: 100,
  anchorX: 122,
  anchorY: 50,
} as const;

export function auctionBoxTextCenter(
  box: { width: number; height: number; anchorX: number; anchorY: number } | null,
): { x: number; y: number } {
  const b = box ?? AUCTION_MESSAGE_BOX;
  return {
    x: AUCTION_MESSAGE_AT.x - b.anchorX + b.width / 2,
    y: AUCTION_MESSAGE_AT.y - b.anchorY + Math.trunc(b.height / 2),
  };
}

/**
 * 画整屏。
 *
 * 顺序照入口那一段（0x43c2f5 起）：底图 → 拍賣官 → 助手 → 待拍产业 →
 * 標價 → 金额 → 四个座位 →（真人回合才画）七颗钮 → 消息框。
 */
export function drawAuctionScreen(
  ctx: CanvasRenderingContext2D,
  sprite: AuctionSprite,
  d: AuctionDraw,
): void {
  const bg = auctionSprite(sprite, AUCTION_CHUNK.bg);
  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);
  drawAnchored(
    ctx,
    auctionSprite(sprite, AUCTION_CHUNK.auctioneer),
    AUCTION_ART.auctioneer.x,
    AUCTION_ART.auctioneer.y,
  );
  drawAnchored(
    ctx,
    auctionSprite(sprite, AUCTION_CHUNK.assistant),
    AUCTION_ART.assistant.x,
    AUCTION_ART.assistant.y,
  );
  drawAnchored(
    ctx,
    auctionSprite(sprite, d.entityImage),
    AUCTION_ART.entity.x,
    AUCTION_ART.entity.y,
  );

  auctionText(
    ctx,
    AUCTION_PRICE_TEXT.labelText,
    AUCTION_PRICE_TEXT.label.x,
    AUCTION_PRICE_TEXT.label.y,
    0,
  );
  auctionText(
    ctx,
    AUCTION_MONEY_FORMAT.replace('%d', String(d.price)),
    AUCTION_PRICE_TEXT.value.x,
    AUCTION_PRICE_TEXT.value.y,
    1,
  );

  for (let i = 0; i < d.seats.length && i < AUCTION_SEAT.count; i++) {
    const seat = d.seats[i]!;
    const y = auctionSeatY(i);
    const code = auctionSeatCode(seat);
    const swinging = d.animating !== null && d.animating.seat === i ? d.animating : null;
    // 原版按**状态号**分三路（@source `loc_0043c4f5` / `loc_0043c43c` / `loc_0043c46d`）：
    //   0 可出价 → **黄色剪影**（`Panel#26` 图 `0x4e + 角色号`，VA 0x43c528）
    //              ＋ **这个角色自己的小人**（资源 `3×角色 + 0x1b`，VA 0x43c5b1）＋ 现金
    //   8 出不起 → 这个角色的小人（资源 `3×角色 + 0x1c`，VA 0x43c49f）＋ 现金，**没有剪影**
    //   1..7 不在场 / 賣方 → 只画状态字（`0x475b34` 那张表），**没有小人**
    //
    // ★ 剪影是**镂空的黑底黄线**（`0026_078` 起 78..89，近黑 79~82% 全在四周），
    //   它先画、角色后画且**抠黑**，于是黄线留在角色四周 —— 那就是玩家看到的「黄框」。
    //   先前只画剪影（且把角色错画在状态 7 上），所以框里是空的。见 `docs/deviations/T-034.md`。
    const figureVisible = code === 0;
    const broke = code === AUCTION_BROKE_CODE;

    if (figureVisible) {
      drawAnchored(
        ctx,
        auctionSprite(sprite, AUCTION_SEAT_FIGURE + seat.character),
        AUCTION_SEAT.figureX,
        y,
      );
    }
    if (figureVisible || broke) {
      // 轮到谁 / 正在挥槌 → 用挥槌那一串帧；其余用第 0 帧
      const frame = swinging === null ? 0 : hammerFrame(swinging.elapsed);
      drawAnchored(
        ctx,
        auctionCharacterSprite(sprite, seat.character, broke ? 'giveUp' : 'bid', frame),
        AUCTION_SEAT.figureX,
        y,
      );
    }

    // 状态字（1..7）flag 2 在 (590, y+14) @0x43c46d / 现金（0、8）flag 6 在 (620, y+14) @0x43c43c
    if (code === 0 || code === AUCTION_BROKE_CODE) {
      auctionText(
        ctx,
        AUCTION_MONEY_FORMAT.replace('%d', String(seat.cash)),
        AUCTION_SEAT.cashX,
        y + AUCTION_SEAT.textDy,
        6,
      );
    } else {
      const text = code === 7 ? AUCTION_SELLER_TEXT : auctionStatusText(code);
      auctionText(ctx, text, AUCTION_SEAT.figureX, y + AUCTION_SEAT.textDy, 2);
    }
  }

  // 七颗钮：只有**真人**那一支才画 @source 0x43b010
  if (d.humanTurn) {
    for (let i = 0; i < AUCTION_BUTTON.count; i++) {
      const img = d.pressed === i ? AUCTION_CHUNK.buttonOff[i]! : AUCTION_CHUNK.buttonOn[i]!;
      drawAnchored(
        ctx,
        auctionSprite(sprite, img),
        AUCTION_BUTTON.cx,
        auctionButtonY(i),
      );
    }
  }

  if (d.message === null) return;
  const box = auctionSprite(sprite, AUCTION_CHUNK.messageBox);
  drawAnchored(ctx, box, AUCTION_MESSAGE_AT.x, AUCTION_MESSAGE_AT.y);
  const center = auctionBoxTextCenter(box);
  const cx = center.x;
  const cy = center.y;
  ctx.font = `${AUCTION_BOX_FONT_SIZE}px ${AUCTION_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101010';
  const lines = d.message.split('\n').filter((l) => l !== '');
  const lh = AUCTION_BOX_FONT_SIZE + 6;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, cy + (i - (lines.length - 1) / 2) * lh);
  });
}

// ============================================================
//  整屏（UiScreen）—— 只收真人的那一口，电脑那一口问 core
// ============================================================

interface ScreenState {
  key: string;
  run: AuctionRun;
  /** 正被按住的钮 */
  pressed: number | null;
  /** 挥槌动画：座位 + 起点 + 终点 */
  anim: { seat: number; startedAt: number; until: number } | null;
  message: string | null;
  messageUntil: number;
  /** 下一次问 core 要「电脑那一口」的时刻 */
  nextAt: number;
  /** 「請意者出價」这一句已经出过了（真人那一格）*/
  asked: boolean;
  /** 待拍产业缩略图（`pending` 清掉之后结算演出还要用）*/
  entityImage: number;
  /** 结算演出：`pending` 已经没了，只剩消息框 */
  settling: boolean;
  /** 结算演出消息的收摊时刻（0 = 不排）*/
  settleUntil: number;
  /** 结算演出演的是谁（从屏内已知的最高者推出来，见 `finalOutcomeOf`）*/
  outcome: { winner: number; price: number } | null;
  /** 最后一口加价者的**玩家下标**（`top` 是座位下标，收盘时用它换算）*/
  topBidder: number;
  /** 最后一次加价后的现价（`pending` 清掉之后就没地方读了）*/
  lastPrice: number;
}

let screen: ScreenState | null = null;

function runKey(p: PendingInteraction): string {
  if (p.kind !== 'auction') return '';
  return `${p.entityId}:${p.facility === true ? 'f' : 'l'}:${p.basePrice}`;
}

/** 待拍实体现在是谁的（0 = 无主）*/
function entityOwnerOf(env: UiScreenEnv, pending: PendingInteraction): number {
  if (pending.kind !== 'auction') return 0;
  if (pending.facility === true) {
    return effectiveFacility(env.state, env.topo, pending.entityId)?.owner ?? 0;
  }
  return effectiveLand(env.state, env.topo, pending.entityId)?.owner ?? 0;
}

/** 从 core 查待拍实体的等级/种类/归属，再按原版算法挑缩略图 */
function entityImageOf(env: UiScreenEnv, pending: PendingInteraction): number {
  if (pending.kind !== 'auction') return 0x5a;
  const charOf = (owner: number): number => env.state.players[owner - 1]?.character ?? 0;
  if (pending.facility === true) {
    const fac = effectiveFacility(env.state, env.topo, pending.entityId);
    if (fac === null) return 0x67;
    return auctionEntityImage(fac, true, charOf, 0);
  }
  const land = effectiveLand(env.state, env.topo, pending.entityId);
  if (land === null) return 0x5a;
  return auctionEntityImage(land, false, charOf, 0);
}

/** 从 core 的 `pending` 建屏内视图（现价/最高者/轮到谁都照读，不自己算） */
function viewOf(env: UiScreenEnv, pending: PendingInteraction): AuctionRun {
  if (pending.kind !== 'auction') throw new Error('auction-screen: pending 不是 auction');
  const p = pending;
  const owner = entityOwnerOf(env, pending);
  const seller = owner > 0 ? owner - 1 : -1;
  const seats = seatViewOf(p, env.state.players, seller);
  return {
    seats,
    current: p.seat,
    price: p.price,
    top: p.top,
    basePrice: p.basePrice,
    phase: 'bidding',
    winner: -1,
  };
}

function startView(env: UiScreenEnv, pending: PendingInteraction): ScreenState {
  const run = viewOf(env, pending);
  return {
    key: runKey(pending),
    run,
    entityImage: entityImageOf(env, pending),
    pressed: null,
    anim: null,
    message: AUCTION_INTRO_TEXT,
    messageUntil: env.now + AUCTION_BOX_MS,
    nextAt: env.now + AUCTION_BOX_MS,
    asked: false,
    settling: false,
    settleUntil: 0,
    outcome: null,
    topBidder: -1,
    lastPrice: run.price,
  };
}

/** 把 core 的 `pending` 变化同步进视图（现价 / 最高者 / 座位状态 / 轮到谁）*/
function syncView(env: UiScreenEnv, pending: PendingInteraction): void {
  if (screen === null) return;
  screen.run = viewOf(env, pending);
}

/**
 * 结算演出要演谁。
 *
 * ⚠️ `pending` 一被 core 清掉，屏就读不到 `top` 了 —— 所以屏内**自己记**下
 * 「最后一次加价是谁、加到多少」。终局本来只有两种（`loc_0043b295`）：
 * 只剩最高者能出价 → 成交；一个能出的都没有 → 流标。这里按同一条口径推：
 * 有人加过价就是成交（价 = 最后那口），没人加过就是流拍。
 */
function finalOutcomeOf(st: ScreenState): { winner: number; price: number } {
  if (st.topBidder < 0) return { winner: -1, price: 0 };
  return { winner: st.topBidder, price: st.lastPrice };
}

/** 走到结算演出：core 已经把 `pending` 清掉了，这里只负责把结果演出来 */
function beginSettle(env: UiScreenEnv, st: ScreenState, out: { winner: number; price: number }): void {
  st.settling = true;
  st.outcome = out;
  st.anim = null;
  st.pressed = null;
  st.run = { ...st.run, phase: out.winner < 0 ? 'passedIn' : 'sold', winner: out.winner, price: out.winner < 0 ? st.run.price : out.price };
  if (out.winner < 0) {
    st.message = AUCTION_PASSED_IN_TEXT;
  } else {
    st.message = AUCTION_DEAL_FORMAT.replace('%d', String(out.price));
  }
  st.messageUntil = env.now + AUCTION_BOX_MS;
  st.settleUntil = env.now + AUCTION_BOX_MS;
  env.playEffect(AUCTION_SOUND_DEAL);
  env.requestRender();
}

/** 轮到的那一位是不是电脑（是就要问 core 要这一口）*/
function seatPlayer(env: UiScreenEnv, run: AuctionRun): Player | null {
  const seat = run.seats[run.current];
  if (seat === undefined) return null;
  return env.state.players[seat.player] ?? null;
}

function humanTurn(env: UiScreenEnv, st: ScreenState): boolean {
  if (st.settling || st.outcome !== null || st.run.phase !== 'bidding') return false;
  const p = seatPlayer(env, st.run);
  return p !== null && !isAiControlled(p);
}

/**
 * 把这一口送给 core。
 *
 * ★ 只有**真人**那一手从这里进（电脑那一手由 `auctionNextBid` 算好、同样
 *   以 `auctionBid` 送进来）—— 屏内不再自己改现价/座位状态。
 */
function applyHumanBid(
  env: UiScreenEnv,
  st: ScreenState,
  action: { kind: 'raise'; step: number } | { kind: 'pass' | 'giveUp' },
): void {
  const seat = st.run.seats[st.run.current];
  if (seat === undefined) return;
  const status = action.kind === 'raise' ? 'raise' : action.kind;
  env.dispatch({
    type: 'auctionBid',
    bidder: seat.player,
    status,
    step: action.kind === 'raise' ? action.step : 0,
  });
  if (action.kind === 'raise') {
    st.topBidder = seat.player;
    st.lastPrice = st.run.price + action.step;
  }
  st.anim = {
    seat: st.run.current,
    startedAt: env.now,
    until: env.now + AUCTION_FRAME_MS * AUCTION_HAMMER_FRAMES,
  };
  st.asked = false;
  st.message = null;
  st.messageUntil = 0;
  st.nextAt = st.anim.until;
  env.requestRender();
}

export const auctionScreen: UiScreen = {
  id: 'auction',

  active(env: UiScreenEnv): boolean {
    if (env.state.pending?.kind === 'auction') return true;
    // 结算演出期间 `pending` 已经被 core 清掉，屏还要把结果演完
    return screen !== null && screen.settling;
  },

  tick(env: UiScreenEnv): void {
    const pending = env.state.pending;
    if (pending === null || pending.kind !== 'auction') {
      // core 已经落槌 —— 先起一段结算演出，演完收摊
      const st = screen;
      if (st === null) return;
      if (!st.settling) {
        beginSettle(env, st, finalOutcomeOf(st));
        return;
      }
      if (st.messageUntil !== 0 && env.now >= st.messageUntil) {
        st.message = null;
        st.messageUntil = 0;
        env.requestRender();
      }
      if (env.now >= st.settleUntil) {
        screen = null;
        env.requestRender();
      }
      return;
    }
    if (screen === null || screen.key !== runKey(pending)) {
      screen = startView(env, pending);
      env.requestRender();
      return;
    }
    const st = screen;
    // 开场那句先走完
    if (st.messageUntil !== 0 && env.now >= st.messageUntil) {
      st.messageUntil = 0;
      st.message = null;
      env.requestRender();
    }
    if (st.anim !== null && env.now < st.anim.until) env.requestRender();
    if (st.settling || st.outcome !== null) return;

    syncView(env, pending);

    // 只剩一个人能出价 / 一个都出不起 → core 会在下一口之后自己判终局。
    //   这里不预判：屏只负责「该谁 → 把这一口送出去」。
    const p = seatPlayer(env, st.run);
    if (p === null) return;
    if (!isAiControlled(p)) {
      // 真人：等点钮（原版相位 3）。摆一句「請意者出價」就够，不必续帧。
      if (!st.asked && st.message === null) {
        st.asked = true;
        st.message = AUCTION_ASK_FORMAT.replace('%d', String(st.run.price));
        st.messageUntil = env.now + AUCTION_BOX_MS;
        env.requestRender();
      }
      return;
    }
    if (env.now < st.nextAt) return;

    // ★ 电脑那一口**问 core**（与 `decidePending` 同一个函数，不是第二套算法）
    const bid = auctionNextBid(env.state, pending);
    if (bid === null || bid.type !== 'auctionBid') return;
    env.playEffect(AUCTION_SOUND_BID);
    const seat = st.run.current;
    if (bid.status === 'raise') {
      st.topBidder = bid.bidder;
      st.lastPrice = st.run.price + bid.step;
    }
    env.dispatch(bid);
    st.anim = {
      seat,
      startedAt: env.now,
      until: env.now + AUCTION_FRAME_MS * AUCTION_HAMMER_FRAMES,
    };
    st.message = null;
    st.messageUntil = 0;
    st.nextAt = st.anim.until;
    env.requestRender();
  },

  draw(env: UiScreenEnv): void {
    const pending = env.state.pending;
    const st = screen;
    if (st === null) return;
    const frozen =
      pending !== null && pending.kind === 'auction'
        ? (pending as Extract<PendingInteraction, { kind: 'auction' }>)
        : null;
    drawAuctionScreen(env.stage, (a, r, i, k) => env.sprite(a, r, i, k), {
      seats: st.run.seats.map((s) => ({
        player: s.player,
        character: s.character,
        state: s.state,
        away: s.away,
        cash: s.cash,
      })),
      current: st.run.current,
      top: st.run.top,
      price: st.run.price,
      entityImage: frozen !== null ? entityImageOf(env, frozen) : st.entityImage,
      pressed: st.pressed,
      humanTurn: humanTurn(env, st),
      animating:
        st.anim !== null && env.now < st.anim.until
          ? { seat: st.anim.seat, elapsed: env.now - st.anim.startedAt }
          : null,
      message: st.message,
    });
  },

  down(x: number, y: number, env: UiScreenEnv): void {
    const st = screen;
    if (st === null) return;
    // 结算演出中点任意处 = 跳过（原版按下时 `fcn_0044ee18(1)` 直接收摊）@source 0x43bb25
    if (st.settling || st.outcome !== null) {
      st.message = null;
      st.messageUntil = 0;
      st.settleUntil = env.now;
      env.requestRender();
      return;
    }
    if (!humanTurn(env, st)) return;
    const hit = hitAuctionButton(x, y);
    if (hit === null) return;
    st.pressed = hit;
    env.requestRender();
  },

  up(x: number, y: number, env: UiScreenEnv): void {
    const st = screen;
    if (st === null) return;
    const pressed = st.pressed;
    st.pressed = null;
    if (pressed === null || st.settling || st.outcome !== null) return;
    if (!humanTurn(env, st)) return;
    if (hitAuctionButton(x, y) !== pressed) {
      env.requestRender();
      return;
    }
    const btn = AUCTION_BUTTONS[pressed]!;
    const p = seatPlayer(env, st.run);
    if (p === null) return;
    if (btn.kind === 'raise') {
      // ★ 出不起就整个不响应（连音都不放）@source 0x43a478 `cmp eax, cash / jg`
      if (!auctionCanAfford(st.run.price, btn.step, p.cash)) return;
      env.playEffect(AUCTION_SOUND_BID);
      applyHumanBid(env, st, { kind: 'raise', step: btn.step });
      return;
    }
    env.playEffect(AUCTION_SOUND_BID);
    applyHumanBid(env, st, { kind: btn.kind });
  },
};

/** 只给单测用：把屏内的运行时清掉 */
export function resetAuctionScreenForTest(): void {
  screen = null;
}

/** 只给单测用：读回屏内的运行时 */
export function auctionRunForTest(): AuctionRun | null {
  return screen?.run ?? null;
}
