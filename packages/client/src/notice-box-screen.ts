/*
 * 付费类落点的棕色訊息框 —— issue #18
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 为什么有这一屏：走到**别人的**地产／企業要交过路费时，原版会先弹一个
 *   棕色訊息框，重制版先前一个都不弹。
 *
 * ## 出处（三处落点共用同一扇通用訊息框）
 *
 * ```asm
 * ; 住宅（别人的地產）—— 0x00419d50
 * 00419d3e  push 0x4639b3              ; RENT.payOneOwner（无同盟）
 * 00419d1a  push 0x46399a              ; RENT.payTwoOwners（地主有同盟）
 * 00419d50  push 0x5dc                 ; ★ 0x5dc = 1500 ms
 * 00419d5a  call 0x440cac              ; 通用訊息框
 * 00419d70  call 0x41d709              ; ★ 之后才按付款方的神明调整金额
 *
 * ; 企業（董事長／幫主）—— 0x0041aeaa
 * 0041ae86  push 0x463a6a              ; RENT.payBoss（行業 0xc 門派）
 * 0041ae98  push 0x463a31              ; RENT.payChairman（其余行業）
 * 0041aeaa  push 0x5dc / call 0x440cac
 * 0041aec5  call 0x41d709
 * ```
 *
 * `0x440cac` 那扇窗（VA 0x00440cac）：
 * ```asm
 * 00440d16  call 0x44f9d8              ; create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)
 * 00440d62  mov  eax, [0x48bad8]       ; ★ Data.mkf 0x205（= DIALOG_SKIN_* 那一份）
 * 00440d79  add  eax, 0x48             ; 精灵下标 → 图 5
 * 00440d84  call 0x456418(表面, 图5, 0xdc, 0x8c)   ; 框锚点 (220,140)
 * 00440dac  call 0x44fabc(0, 文字, 0xdc, 0x8c, 4)  ; flag 4 = 正中
 * 00440de7  push esi(0x5dc) / call 0x4528b9        ; 等 1500 ms
 * ```
 * ⇒ **框皮、锚点、居中对齐都与 `dialog.ts` 的通用询问框是同一套**
 *   （`DIALOG_SKIN_RESOURCE` / `DIALOG_SKIN_IMAGE` / `DIALOG_ANCHOR_SCREEN`），
 *   所以本屏直接复用 `drawDialog()`，不另画一套。
 *
 * ## 1500 ms 是**可跳过**的
 *
 * 原版那个等待函数 `fcn_004528b9`（VA 0x004528b9）自己的 `PeekMessage` 循环里
 * 认三种消息：
 * ```asm
 * 00452901  cmp  edx, 0x202 / je 0x452919   ; WM_LBUTTONUP
 * 00452909  cmp  edx, 0x205 / je 0x452919   ; WM_RBUTTONUP
 * 00452911  cmp  edx, 0x101 / jne 0x45291e  ; WM_KEYDOWN
 * 00452919  mov  ebx, 1                     ; ★ 置「跳过」标志
 * 00452938  test ebx, ebx / je 0x4528da     ; 没跳过就接着等
 * ```
 * 与本引擎 `UiScreen` 的三个出口一一对应：`up` / `contextmenu` / `key`。
 * ★ 2026-09-19：`event-box-screen.ts` 那两条「死等、不认消息」的错注释**已订正**
 *   （见 E-5 的收口），本屏与那一屏现在照同一份汇编做。
 *
 * ## 触发（纯查状态，不读也不写 `GameState`）
 *
 * `after.notices` 与 `before.notices` **不是同一个数组**（`reduce.ts` 每弹一次都新建
 * 一个数组；没弹的 action 一路 `{...state}` 带过来，引用不变）⇒ 起播。
 * 金额、名字、費名全部是 core 交出来的，本屏**一个字都不算**
 * —— 尤其**不许**从 `before → after` 的差分反推金额（神明加成会让它对不上）。
 *
 * ## ★★ 一次 action 可以弹**不止一扇**
 *
 * 原版在 `0x00419d50`（租金框）之后还会接着弹 `0x00419f16`（死神框），
 * 設施那一路同理（`0x41a56f` → `0x41a6f2`）。所以 core 交出来的是**数组**，
 * 本屏按顺序**一扇一扇放** —— 每扇各自计 1500 ms（`NoticeHint.holdMs` 可覆盖，
 * 得点格那三扇是 1000 ms），每扇都能被同一个出口跳过（跳过只结束**当前**这一扇，
 * 与原版「每扇各自一次可跳过的等待」一致）。
 */

import {
  BANK,
  BLESSING,
  CONFINEMENT,
  FACILITY_TOLL,
  GOD_MANIFEST,
  INSURANCE,
  MAGIC_HOUSE_TEXT,
  MESSAGE_BOX,
  PASSIVE_CARD_TEXT,
  RENT,
  SHOP,
  formatOriginal,
} from '@rich4/data';
import type { GameState, NoticeHint, NoticeKey } from '@rich4/core';
import { drawDialog } from './dialog.ts';
import type { InteractionUi } from './interactions.ts';
import { LAYOUT } from './stage.ts';
import type { UiKeyEvent, UiScreen, UiScreenEnv } from './ui-screen.ts';

/**
 * 框停留时长 —— 原版 `push 0x5dc`（1500 ms）。
 * @source 0x00419d50（住宅）/ 0x0041aeaa（企業）/ 0x0041a56f（設施），三处都是 `0x5dc`
 */
export const NOTICE_HOLD_MS = 0x5dc;

/**
 * 文案键 → 原版格式串。
 *
 * ⚠️ 格式串一律取自 `@rich4/data` 的 `messages.ts`（那里面每一条都带 VA，
 *   并由 `messages.test.ts` 逐字对过 `rich4.exe`）——**不在这里另写中文**。
 *   `satisfies` 保证「core 能交出来的每一个键」这里都翻得出来（漏一个就编译不过）。
 */
export const NOTICE_TEXT = {
  'rent.payOneOwner': RENT.payOneOwner.text,
  'rent.payTwoOwners': RENT.payTwoOwners.text,
  'rent.payChairman': RENT.payChairman.text,
  'rent.payBoss': RENT.payBoss.text,
  // ★ 免收那一路（`0x41d559` 的**全部九种**）：
  //   原版在豁免分支里先 sprintf 再弹**同一扇**框（`0x41d6a4 push 0x5dc /
  //   call 0x440cac`）。⚠️ 参数个数不是一种：查封（0x41d59f）与死神（0x41d5fa）
  //   只推了費名一个实参；同盟（0x41d5ce）与其余六种是「名字 + 費名」两个。
  'rent.freeSealed': RENT.freeSealed.text,
  'rent.freeAllied': RENT.freeAllied.text,
  'rent.freeReaper': RENT.freeReaper.text,
  'rent.freeHotel': RENT.freeHotel.text,
  'rent.freeVanished': RENT.freeVanished.text,
  'rent.freePrison': RENT.freePrison.text,
  'rent.freeHospital': RENT.freeHospital.text,
  'rent.freeWinterSleep': RENT.freeWinterSleep.text,
  'rent.freeSleepwalk': RENT.freeSleepwalk.text,
  // ★ 死神顯靈由他人賠償 —— 与租金框**在同一个 action 里前后脚弹**（0x00419f16）
  'rent.reaperPays': RENT.reaperPays.text,
  // ★ 設施那三路（`0x41a3cc` 那一支）
  'facility.hotel': FACILITY_TOLL.hotel.text,
  'facility.mall': FACILITY_TOLL.mall.text,
  // 加油站借的是「董事長」那一句（@source 0x41a55d `push 0x463a31`），
  // 只是第一个 `%s` 被 core 填成常量「加油站」
  'facility.gasStation': RENT.payChairman.text,
  // ★ 得点格 / 抽卡格 / 禮物 / 寶箱 / 乞丐 / 小偷
  'points.50': MESSAGE_BOX.points50.text,
  'points.30': MESSAGE_BOX.points30.text,
  'points.10': MESSAGE_BOX.points10.text,
  'points.card': MESSAGE_BOX.got.text,
  'points.minigame': MESSAGE_BOX.pointsMinigame.text,
  'object.gift': MESSAGE_BOX.got.text,
  'object.treasure': MESSAGE_BOX.got500Points.text,
  'beggar.alms': MESSAGE_BOX.alms.text,
  'thief.loot': MESSAGE_BOX.thiefLoot.text,
  // ★ 神明落脚顯靈（`fcn_0040f381` / `fcn_0040f8be`）：三句都是 `0x440cac(…, 0x5dc)` 同一扇框
  'god.build': GOD_MANIFEST.build.text,
  'god.demolish': GOD_MANIFEST.demolish.text,
  'god.seize': GOD_MANIFEST.seize.text,
  'god.blockPurchase': GOD_MANIFEST.blockPurchase.text,
  'god.gotCard': GOD_MANIFEST.gotCard.text,
  // ★ 大福神得两张那次原版用的是**另一条**格式串（`0x0040eed7 push 0x463353`）——
  //   一扇框、两个卡名，且串里自己写着「大福神」⇒ `args` 只有两张卡名。
  'god.gotCardTwo': GOD_MANIFEST.gotCardTwo.text,
  // ★ 2026-09-23：小衰神附身丢卡（`0x0040f148 call 0x440cac`，`0x4633ab`，1500 ms）—— 串里自己写着「小衰神」
  'god.lostCard': GOD_MANIFEST.lostCard.text,
  'bank.rejected': BANK.rejected.text,
  // ★ ATM 窗 `0x408`：銀行暫停放款期内开 ATM，框盖在 ATM 上（1500 ms）
  'bank.frozen': BANK.frozen.text,
  // ★ W-67-a：董事長蒞臨商店的贈禮（`0x464378`）—— 在商店窗打开**之前**弹
  'shop.chairmanGift': SHOP.chairmanGift.text,
  // ★ 回合開始時「被阻礙」那五扇（`fcn_0040c912`）—— 对**所有人**都弹（不分真人与电脑），
  //   1500 ms；`args` = [玩家名, 剩余天数]
  'confinement.hotel': CONFINEMENT.hotel.text,
  'confinement.disappearing': CONFINEMENT.disappearing.text,
  'confinement.prison': CONFINEMENT.prison.text,
  'confinement.hospital': CONFINEMENT.hospital.text,
  'confinement.sleeping': CONFINEMENT.sleeping.text,
  // ★ 魔法屋（2026-09-23）：`sprintf("%s\n\n", 名字)` 之后 `strcat` 效果名 ⇒ 两段拼起来就是一个格式串
  'magic.effect': MAGIC_HOUSE_TEXT.nameHead.text + '%s',
  'magic.gotCard': MAGIC_HOUSE_TEXT.nameHead.text + MAGIC_HOUSE_TEXT.gotCard.text,
  'magic.spin': MAGIC_HOUSE_TEXT.spin.text,
  // ★ 第十四份：命運的神明加持（`fcn_0044b896` → `[0x48c5b8]`，调用方 1500 ms）
  'blessing.rewardDouble': BLESSING.rewardDouble.text,
  'blessing.rewardVoid': BLESSING.rewardVoid.text,
  'blessing.penaltyDouble': BLESSING.penaltyDouble.text,
  'blessing.penaltyVoid': BLESSING.penaltyVoid.text,
  'blessing.misfortuneDouble': BLESSING.misfortuneDouble.text,
  'blessing.misfortuneVoid': BLESSING.misfortuneVoid.text,
  // ★ 第十四份：过路费的神明调整（`fcn_0041d709` 跳表四支，`0x0041d7a2 push 0x5dc`）
  'god.tollHalf': RENT.halfLuckyGod.text,
  'god.tollFree': RENT.freeBigLuckyGod.text,
  'god.tollPlusHalf': RENT.plusHalfSmallPoorGod.text,
  'god.tollDouble': RENT.doubleBigPoorGod.text,
  // ★ 第十四份：保險理賠（`fcn_0044ba63`，2000 ms）
  'insurance.payout': INSURANCE.payout.text,
  // ★ 第十四份：收費那一段的被动卡（亮牌两句带 `card`，由事件提示框画；「嫁禍給%s！」是普通框）
  'card.use': PASSIVE_CARD_TEXT.use.text,
  'card.scapegoatOn': PASSIVE_CARD_TEXT.scapegoatOn.text,
  'card.scapegoatTo': PASSIVE_CARD_TEXT.scapegoatTo.text,
} as const satisfies Record<NoticeKey, string>;

/** 一条 `{ key, args }` 提示 → 屏上那一句（`%s` / `%d` 全在 `args` 里） */
export function noticeText(n: NoticeHint): string {
  return formatOriginal(NOTICE_TEXT[n.key], ...n.args);
}

/** 这一帧要画的东西 —— 交给 `dialog.ts` 的通用框（没有标题、没有按钮） */
export function noticeUi(text: string): InteractionUi {
  return { title: '', detail: text, choices: [] };
}

// ============================================================
//  演出状态机（纯函数）
// ============================================================

export interface NoticePlayback {
  /** 已经填好的整句（`\n\n` 原样留着，`dialog.ts` 自己折行） */
  text: string;
  /** 起播时刻 */
  at: number;
  /** 这一扇停留多久（ms）—— 原版每扇框各自 `push` 一个时长 */
  holdMs: number;
}

export function noticePlaybackStart(text: string, now: number, holdMs: number = NOTICE_HOLD_MS): NoticePlayback {
  return { text, at: now, holdMs };
}

/** 走一帧；该关屏了返回 `null` */
export function noticePlaybackTick(p: NoticePlayback, now: number): NoticePlayback | null {
  return now - p.at >= p.holdMs ? null : p;
}

// ============================================================
//  屏幕本体
// ============================================================

/** 排着队、还没轮到的那几扇 */
interface QueuedNotice {
  key: NoticeKey;
  text: string;
  holdMs: number;
  /** 原版排在同一条 action 的影片**之前**（见 core 的 `NoticeHint.beforeFilms`）*/
  beforeFilms: boolean;
  /** 框收掉之后还要**空等**多久（见 core 的 `NoticeHint.afterMs`）*/
  afterMs: number;
  /** 原版排在同一拍的**角色台词之后**（见 `noticeAfterSpeech`）*/
  afterSpeech: boolean;
  /** ★ 第十四份：这一扇是亮牌（`NoticeHint.card`）—— 交给事件提示框播 */
  card?: number;
}

/**
 * 这一扇在原版里是不是排在**角色台词之后**才弹。
 *
 * ★ 第十三份試玩回報 #2（150236）：「NPC在医院里还剩多少天的弹窗被台词框遮住了」。
 *   回合開始被阻那五扇（`fcn_0040c912`）的次序是**先说、后弹框**：
 * ```asm
 * 0040ca20  call 0x456f2d / test al,1 / je      ; 坐牢：1/2 機率说事件 19
 * 0040ca51  call 0x44ef41                       ; player_say —— 阻塞：语音放完再等 1000 ms（`fcn_004544f6(0x3e8)`）
 * 0040ca81  call 0x457110                       ; 才 sprintf「還剩 N 天」
 * 0040caca  call 0x44ef41                       ; 住院那句（事件 20）同形
 * 0040cb4c  call 0x44ef41                       ; 冬眠那句（事件 21）同形
 * 0040cb98  call 0x440cac(文字, 0x5dc)          ; ★ 所有台词都说完之后才弹这一扇框（1500 ms）
 * ```
 *   ⇒ 台词气泡（`player_say` 画在 (170..,130) 一带）与这扇框（锚点 (220,140)）在原版里**从不同时在屏上**。
 *   本引擎的台词是队列、框是整屏，一条 action 同时交出来 ⇒ 这几扇框等台词队列说完再起播。
 *   其余的框（過路費 → 付款台词、神明顯靈 → 台词…）原版都是**框在前**，不走这条。
 */
export function noticeAfterSpeech(key: NoticeKey): boolean {
  // ★ 第十四份：保險理賠那一扇在六个调用点上**都排在台词之后**（`fcn_0044ba63` 里没有台词，
  //   它前面那一句是付款 / 入獄 / 住院 / 住店的台词）：
  //   命運罰款 `0x0044cef9 call 0x44f42d` → `0x0044cf11 call 0x44ba63`；
  //   坐牢 `0x0043d71c player_say` → `0x0043d749`；住院 `0x0043edcb` → `0x0043edf8`；
  //   住旅館 `0x0041a7e0 call 0x44f2c2` → `0x0041a82d`。
  // ★ 2026-09-23：小衰神丢卡那一扇排在「別鬧了！」（事件 22，`0x0040f0ac call 0x44ef41`）之后 ——
  //   原版次序：台词 → 影片 0x222 → 开场白 `0x40e2a2` → 丢卡 `0x441e77` → 框 `0x0040f148`。
  return key.startsWith('confinement.') || key === 'insurance.payout' || key === 'god.lostCard';
}

/**
 * ★ 第十四份：队头那一扇正在**等台词说完**（`noticeAfterSpeech` 且台词闸关着）。
 *   这时本屏只是「排着」，不该算台上在演 —— 否则押在演出之后的台词（`afterStage`）
 *   与这扇框互相等（`main.ts` 的 `blockingPresentation` 用它）。
 */
export function noticeWaitingForSpeech(): boolean {
  return playback === null && tail === null && pending[0]?.afterSpeech === true && speechGate?.() === true;
}

/** 正在弹的那一扇是不是「排在影片之前」的那一种 */
let playingBeforeFilms = false;
/** 正在弹的那一扇收掉之后要空等多久 */
let playingAfterMs = 0;
/** 正在弹的那一扇的文案键（`noticeKeyShowing` 用）*/
let playingKey: NoticeKey | null = null;

/**
 * 框已收掉、还在**空等**的那一段（原版 `fcn_0045285e(ms)` 忙等，点不掉）；`null` = 没在等。
 * 期间本屏仍算接管（回合驱动押着），但什么都不画。
 */
let tail: { until: number; beforeFilms: boolean } | null = null;

/** 现在正在弹的那一个；`null` = 没在弹 */
let playback: NoticePlayback | null = null;

/** 正在弹的那一扇之后还排着的（FIFO） */
let pending: QueuedNotice[] = [];

/**
 * ★ W-69：起播前的一道闸 —— 「台上还有演出没演完就先别弹框」。
 *
 * 目前只有一位客户：**過路費那段「把算进这笔钱的每一块地一起闪一遍」**。
 * 原版次序是死的（`0x00419c83` 那一段在 `0x00419d5a call 0x440cac` 之前），
 * 而本引擎的 core 一条 action 就把框和提示一起交出来了 ⇒ 宿主把
 * 「闪还在播」这件事从这道闸递进来，由本屏**押着**（见 `startNext`）。
 *
 * 不给（`null`）时永远放行 —— 单测与其它屏不必知道这件事。
 */
let startGate: (() => boolean) | null = null;

export function setNoticeStartGate(f: (() => boolean) | null): void {
  startGate = f;
}

/** 「台词队列还在说」—— 只对 `noticeAfterSpeech` 的那几扇生效（不给 = 永远放行） */
let speechGate: (() => boolean) | null = null;

export function setNoticeSpeechGate(f: (() => boolean) | null): void {
  speechGate = f;
}

function gated(): boolean {
  return startGate?.() === true;
}

/**
 * ★ 第十四份：**连「排在影片之前」的那几扇也要等**的闸 —— 事件提示框（新聞 / 命運）还在演。
 *   原版命運的施加阶段（神明加持框、理賠框…）在事件框收掉之后才走（pass 0 画框、pass 1 施加）。
 *   先前框在事件框底下就起了计时，事件框一收它早已过期（一闪就没）。
 */
let overlayGate: (() => boolean) | null = null;

export function setNoticeOverlayGate(f: (() => boolean) | null): void {
  overlayGate = f;
}

/**
 * ★ 第十四份：亮牌那一扇的出口 —— `start(卡号, 文字)` 起播、`active()` 问它收了没有。
 *   不给（单测）时亮牌那一扇**按普通框**计时（1500 ms，与原版 `fcn_00441f73` 同长）。
 */
let cardPopup: { start: (cardId: number, text: string) => void; active: () => boolean } | null = null;
/** 正在等事件提示框播完的那一张亮牌 */
let playingCard = false;

export function setNoticeCardPopup(start: ((cardId: number, text: string) => void) | null, active?: () => boolean): void {
  cardPopup = start === null || active === undefined ? null : { start, active };
}

/** 调试 / 单测用：把整屏关掉（连队列一起清空） */
export function resetNoticeBoxScreen(): void {
  playback = null;
  playingCard = false;
  pending = [];
  playingBeforeFilms = false;
  playingAfterMs = 0;
  playingKey = null;
  tail = null;
}

/**
 * 这个文案键的框此刻还在不在（正在弹，或排在队里还没轮到）。
 *
 * ★ 第十三份試玩回報 #1：顯靈加蓋那一格要等「顯靈框」收掉才画成新等级（见 `manifest-hold.ts`）。
 */
export function noticeKeyShowing(key: NoticeKey): boolean {
  if (playback !== null && playingKey === key) return true;
  return pending.some((n) => n.key === key);
}

/**
 * 此刻有没有「原版排在影片之前」的框还没弹完（正在弹，或排在队头等着弹）。
 *
 * ★ 宿主的建屋影片 / 棋盘影片起播前问它：是 ⇒ 先别起播（魔法屋 `0x431caa` 每一支都是
 *   先 `0x440cac` 阻塞 1500 ms、再 `fcn_0045144f`）。
 */
export function noticeHoldsFilms(): boolean {
  if (playback !== null) return playingBeforeFilms;
  if (tail !== null) return tail.beforeFilms;
  return pending[0]?.beforeFilms === true;
}

/**
 * 从队头起下一扇。
 *
 * ★ 起播时刻**在这里才记**（不记入队时刻）：原版是一扇放完再等下一扇，
 *   两扇共用一个 1500 ms 计时就会让第二扇一出现就已经超时。
 */
function startNext(env: UiScreenEnv): void {
  if (playback !== null || tail !== null) return;
  if (overlayGate?.() === true) return;
  // ★ W-69：闸没开就先不取队头 —— 队列原样留着，`active()` 靠它保持「还占着屏」
  //   好让 `tick` 继续叫我们（见 `active` 与 `tick`）。
  //   ★ 例外：「排在影片之前」的那几扇（魔法屋）不看这道闸 —— 反过来是影片等它们
  //     （`noticeHoldsFilms`），两边都等就是死锁。
  if (pending[0]?.beforeFilms !== true && gated()) return;
  // ★ 第十三份試玩回報 #2：回合開始被阻那几扇等台词说完（`noticeAfterSpeech`）
  if (pending[0]?.afterSpeech === true && speechGate?.() === true) return;
  const item = pending.shift();
  if (item === undefined) {
    pending = [];
    return;
  }
  playingBeforeFilms = item.beforeFilms;
  playingAfterMs = item.afterMs;
  playingKey = item.key;
  playback = noticePlaybackStart(item.text, env.now, item.holdMs);
  env.log(`付费訊息框：${item.key}`);
  // ★ 第十四份：亮牌那一扇交给事件提示框（它排在本屏之前，接管画面与点击）；本屏只等它收
  if (item.card !== undefined && cardPopup !== null) {
    playingCard = true;
    cardPopup.start(item.card, item.text);
  }
}

/**
 * 跳过这一拍（左键抬起 / 右键抬起 / 任意键按下 —— 见头注释的三种消息）。
 *
 * 原版那个等待函数一见这三种消息就立刻返回（不做任何「先播完再说」的事），
 * 而**每扇框各自有一次**这样的等待 —— 所以这里只结束**当前**这一扇，
 * 后面排队的照旧接着弹。
 */
function skip(env: UiScreenEnv): void {
  if (playback === null) return;
  playback = null;
  env.log('付费訊息框：跳过');
  finishBox(env);
  env.requestRender();
}

/** 一扇框收掉：要空等的先空等（`fcn_0045285e` 点不掉），否则直接接下一扇 */
function finishBox(env: UiScreenEnv): void {
  if (playingAfterMs > 0) {
    tail = { until: env.now + playingAfterMs, beforeFilms: playingBeforeFilms };
    return;
  }
  startNext(env);
}

export const noticeBoxScreen: UiScreen = {
  id: 'notice',

  /**
   * ★ **浮窗**：原版 `fcn_00451e7e(&rect{0,0x28,0x1b8,0x1e0})` 只在棋盘那一栏上
   *   开对话框（见 `dialog.ts` 头注释），所以四周的棋盘 / 侧栏照旧露着。
   */
  windowed: true,

  // ★ W-69：**还没起播的那几扇**也算「本屏在接管」—— 不然 `main.ts` 只会把 `tick`
  //   发给接管整屏的那一屏，排队的那几扇没人来叫 `startNext`（屏自己不会醒）。
  //   ⚠️ 判据是 `pending.length > 0` 而**不是**「闸还关着」：闸开的那一拍若 `active()`
  //   已经变假，就再也没人来起播了（浏览器实测：閃完 880 ms 后框**永远不出来**）。
  active: () => playback !== null || pending.length > 0 || tail !== null,

  draw(env: UiScreenEnv): void {
    const p = playback;
    if (p === null) return;
    // ★ `drawDialog` 排的是**棋盘区**坐标（`boardRect` 会减掉 `LAYOUT.board`），
    //   而 `UiScreenEnv.stage` 是整块 640×480 —— 不平移就会画到屏幕 y = −1 上去。
    //   股市屏那扇填数窗就是同一处理（`main.ts` 的 `save/translate/drawDialog`）。
    env.stage.save();
    env.stage.translate(LAYOUT.board.x, LAYOUT.board.y);
    drawDialog(env.stage, env.sprite, noticeUi(p.text), null, null);
    env.stage.restore();
  },

  tick(env: UiScreenEnv): void {
    // 框收掉之后的空等（`fcn_0045285e`）：到点才接下一扇
    if (tail !== null) {
      if (env.now >= tail.until) {
        tail = null;
        startNext(env);
      }
      env.requestRender();
      return;
    }
    const p = playback;
    // ★ 第十四份：亮牌那一扇 —— 事件提示框收了才算这一扇完（点掉 / 到点都在那边）
    if (p !== null && playingCard) {
      if (cardPopup?.active() === true) {
        env.requestRender();
        return;
      }
      playingCard = false;
      playback = null;
      finishBox(env);
      env.requestRender();
      return;
    }
    if (p === null) {
      // ★ W-69：押着等闸的那几扇 —— 闸一开就在这一拍起播，并自己续帧
      if (pending.length > 0) {
        startNext(env);
        if (playback === null) env.requestRender();
      }
      return;
    }
    const next = noticePlaybackTick(p, env.now);
    if (next === null) {
      playback = null;
      env.log('付费訊息框：結束');
      // ★ 后面还有排队的就接着弹（原版那几扇框是一扇接一扇）
      finishBox(env);
    }
    // ★ **必须自己续帧**：`main.ts` 只把 `tick` 发给**此刻接管整屏**的那一屏，
    //   而关屏是「时间到」才有的事 —— 不续帧就永远到不了那个 deadline
    //   （与 `event-box-screen.ts` 同一条路子）。换扇也一样要续。
    env.requestRender();
  },

  /** 原版那三处「可跳过的等待」认 `WM_LBUTTONUP`（0x202）、`WM_RBUTTONUP`（0x205）、`WM_KEYDOWN`（0x101） */
  up(_x: number, _y: number, env: UiScreenEnv): void {
    skip(env);
  },

  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    skip(env);
  },

  /** 只看消息号、不看是哪个键 @source 0x00452911 `cmp edx,0x101 / jne 继续等` */
  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    skip(env);
    return true;
  },

  /**
   * 联机旁观：行动者那台已经收场（见 `ui-screen.ts` 的 `fastForward`）⇒ 这一扇**连同排队的几扇**
   * 一起收（它们都属于已施加的 action —— 他那边一扇接一扇早弹完了）。原版每扇都点得掉（`skip`）。
   */
  fastForward(env: UiScreenEnv): boolean {
    if (playback === null && pending.length === 0 && tail === null) return false;
    const n = pending.length + (playback === null ? 0 : 1);
    playback = null;
    pending.length = 0;
    tail = null;
    env.log(`付费訊息框：跟著行動者收場（${n} 扇）`);
    env.requestRender();
    return true;
  },

  /**
   * 察觉「刚刚落了要弹框的 action」。
   *
   * 判据是**引用**：`reduce.ts` 每弹一次都新建一个 `notices` 数组，没弹的
   * action 只是把原来的引用带过来 ⇒ `after.notices !== before.notices`
   * 就等于「这一条 action 弹了框」。这与 `lastCardPlay` 的判据同一套。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    const list = after.notices;
    if (list === before.notices || list.length === 0) return;
    // ★ **不丢**：正在播就把新的排到队尾（原版是一次 action 里连弹几扇，见头注释）
    for (const n of list) {
      pending.push({
        key: n.key,
        text: noticeText(n),
        holdMs: n.holdMs ?? NOTICE_HOLD_MS,
        beforeFilms: n.beforeFilms === true,
        afterMs: n.afterMs ?? 0,
        afterSpeech: noticeAfterSpeech(n.key),
        ...(n.card === undefined ? {} : { card: n.card }),
      });
    }
    // ★ 第十三份試玩回報 #2：排在台词之后的那几扇**不在这一拍起播** —— 同一条 action 的台词
    //   要等各整屏的 `event()` 派完才入队（`main.ts` 的 `notifyApplied` → `queueSpeech`），
    //   此刻台词队列还是空的；交给下一帧的 `tick` 再看台词闸。
    if (playback === null && tail === null && pending[0]?.afterSpeech !== true) startNext(env);
    env.requestRender();
  },
};

/** 给单测的只读视图 */
export function noticeBoxScreenState(): {
  playing: boolean;
  playback: NoticePlayback | null;
  /** 排队等着弹的扇数（不含正在播的那一扇） */
  queued: number;
} {
  return { playing: playback !== null, playback, queued: pending.length };
}
