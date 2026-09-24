/*
 * 台词气泡 × 各种「框」的**先后与互斥** —— 第十五份：「台词和棕色对话框又重叠了，应该是一前一后显示的」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ## 原版为什么从不重叠
 *
 * `_rich4_player_say`（VA 0x0044ef41）是**阻塞**的：画字幕 / 表情 → 放语音 →
 * `0x0044f1a6 push 0x3e8 / call fcn_004544f6`（等语音放完再等 1000 ms）→ 恢复底图才返回。
 * 訊息框 `0x440cac`、亮牌 `0x441f73`、事件框 `0x44b6df`、轉盤 `0x44090e`、神明老虎机 `0x440706`、
 * 神明台词窗 `0x40e2a2`、影片 `0x45144f` 也全都是阻塞调用 ⇒ 屏上**任何时刻至多一样**，
 * 先后 = 它们在 exe 里的**调用顺序**。
 *
 * 本引擎一条 action 把后果一次写完，台词（`speech.ts` 的探测器 + 卡牌 / 道具台词）与各种框
 * （`notice-box-screen.ts` 等整屏）是**事后**分头补演的 ⇒ 两边之间的先后若不写明，就会同时上屏。
 * 先前是一处一处补（`noticeAfterSpeech`、`deferredSpeech`、道具台词 `beforeStage`…），
 * 漏一处就重叠一处（第十五份：电脑用定時炸彈时「使用定時炸彈」框与道具台词同时出现）。
 *
 * ## 本文件：一把尺子 + 两道闸（纯函数，main.ts 与单测共用）
 *
 * **尺子**：一条 action 的后果在原版里的先后分六档（数小者先），框与台词**交替**：
 *
 * | 档 | 名 | 是什么 | 例（exe 调用序）|
 * |---|---|---|---|
 * | 10 | `lead` 框 | **引出**这一条后果的框 | 电脑用道具「使用%s」`0x00448070` → 道具函数；亮牌 `0x441f73` → 卡片函数；事件框 `0x44b6df` → 命運 / 新聞效果 |
 * | 20 | `beforeStage` 台词 | 后果的**第一件事** | 道具台词（13 件都是函数里第一个 `player_say`）、出牌台词（26 张卡都在 `animate_object` 之前）、回合开始被挡、壞神附身、剛滿 5 級 |
 * | 30 | `stage` 框（与影片同档） | 后果本身 | 過路費框 `0x00419d5a`、轉盤 `0x0041a458`、神明台词窗 / 老虎机、得点框、被挡天数框 `0x0040cb98` |
 * | 40 | `afterStage` 台词 | 后果之后的反应 | 付款 `0x0041a71e`、免收 `0x0041d6dd`、入獄 `0x0043d71c` … |
 * | 50 | `tail` 框 | 反应之后**才**弹的框 | 保險理賠 `0x44ba63`（在入獄 / 付款台词之后）、落点尾块的神明顯靈 `0x0041b086 call 0x40f381`、福神加蓋 `0x00419a48 call 0x40f8be`（在街區台词 `0x00419a31` 之后）|
 * | 60 | `afterTailBox` 台词 | 尾框之后的那一句 | 土地公 `0x0040f8ab`、福神 `0x0040fa1e` / `0x0040fa5c` |
 *
 * **两道闸**（一条 action 的全部框与台词都按这把尺子排；跨 action 的残留也受同样约束）：
 *  - `boxMayStart`：框起播 ⇔ 台上**没有**气泡、且没有排在它前面（档更小）的台词还押着；
 *  - `lineMayEnter`：台词上台 ⇔ 屏上**没有**框、没有排在它前面的框还押着、
 *    （`afterStage` 起）影片 / 走子 / 投掷也都演完了。
 *  ⇒ 气泡与框**互斥**（各自起播前都看对方），而且谁先谁后由档次决定，不再靠逐处补丁。
 *
 * 影片那一侧不变（W-51）：影片起播前等 `beforeStage` 那几句说完（**含**押着没上台的，
 * 见 `speechAheadOfFilms`），`afterStage` 起的台词等影片演完。
 *
 * ★ 死锁自查：每一道「等」都只等**档更小**的东西（框等更小档的台词、台词等更小档的框），
 *   正在屏上的气泡 / 框按时间自己收；影片只等 20 档的台词、20 档的台词只等 10 档的框
 *   与正在屏上的框 —— 没有环。`presentation-order.test.ts` 用长局逐拍模拟验证
 *   「从不重叠、从不卡死、先后与 exe 一致」。
 */

import type { NoticeKey } from '@rich4/core';
import type { SpeechOrder } from './stage-gate.ts';

/** 框的档次（见文件头的尺子）*/
export type BoxTier = 'lead' | 'stage' | 'tail';

/** 六档的数值 —— 数小者先 */
export const PRESENTATION_RANK = {
  lead: 10,
  beforeStage: 20,
  stage: 30,
  afterStage: 40,
  tail: 50,
  afterTailBox: 60,
} as const;

export function boxRank(tier: BoxTier): number {
  return PRESENTATION_RANK[tier];
}

export function lineRank(order: SpeechOrder): number {
  return PRESENTATION_RANK[order];
}

/**
 * ★★ 每一种訊息框（`0x440cac`）的档次 —— **没有缺省值**：core 新加一个 `NoticeKey`
 *   不在这里写一档就编不过（`satisfies Record<NoticeKey, BoxTier>`），逼着去 exe 里查它与台词的先后。
 *
 * 绝大多数是 `stage`（「框 → 台词」：框在后果里、反应台词在框之后）。例外逐条：
 */
export const NOTICE_TIER = {
  'rent.payOneOwner': 'stage',
  'rent.payTwoOwners': 'stage',
  'rent.payChairman': 'stage',
  'rent.payBoss': 'stage',
  'rent.freeSealed': 'stage',
  'rent.freeAllied': 'stage',
  'rent.freeReaper': 'stage',
  'rent.freeHotel': 'stage',
  'rent.freeVanished': 'stage',
  'rent.freePrison': 'stage',
  'rent.freeHospital': 'stage',
  'rent.freeWinterSleep': 'stage',
  'rent.freeSleepwalk': 'stage',
  // `0x00419f20` 死神框 → `0x00419f59`/`0x00419f67` 付款台词：框在前
  'rent.reaperPays': 'stage',
  'facility.hotel': 'stage',
  'facility.mall': 'stage',
  'facility.gasStation': 'stage',
  'points.50': 'stage',
  'points.30': 'stage',
  'points.10': 'stage',
  'points.card': 'stage',
  'points.minigame': 'stage',
  'object.gift': 'stage',
  'object.treasure': 'stage',
  'beggar.alms': 'stage',
  'thief.loot': 'stage',
  // ★ 顯靈加蓋 / 拆 / 強佔：落点例程**收尾之后**才走尾块 `0x0041b077` → `0x0041b086 call 0x40f381`
  //   （過路費 `0x00419f67` 付款台词、免收 `0x0041d6dd` 那一句都在它之前）；
  //   福神加蓋 `0x00419a48 call 0x40f8be` 在街區台词 `0x00419a31 call 0x44f627` 之后 ⇒ `tail`。
  'god.build': 'tail',
  'god.demolish': 'tail',
  'god.seize': 'tail',
  // 買地時被神明挡下（`0x004199ae call 0x40fa61`，在 Yes/No 之后、付款之前）—— 同一 action 里没有台词
  'god.blockPurchase': 'stage',
  // 福神得卡：影片 → 神明台词窗 → 框 `0x0040ee2f` → 台词 `0x0040ee46`
  'god.gotCard': 'stage',
  'god.gotCardTwo': 'stage',
  // 小衰神：台词 `0x0040f0ac`（`beforeStage`）→ 影片 → 神明台词窗 → 框 `0x0040f148`
  'god.lostCard': 'stage',
  'bank.rejected': 'stage',
  'bank.frozen': 'stage',
  // 董事長贈禮：框 `0x0042ea14` → 台词 `0x0042ea23`
  'shop.chairmanGift': 'stage',
  // 回合開始被挡：台词 `0x0040ca51`/`0x0040caca`/`0x0040cb4c`（`beforeStage`）→ 框 `0x0040cb98`
  'confinement.hotel': 'stage',
  'confinement.disappearing': 'stage',
  'confinement.prison': 'stage',
  'confinement.hospital': 'stage',
  'confinement.sleeping': 'stage',
  // ★ 魔法屋：每一段都是「框 `0x440cac` → 影片 → 台词 `0x004320a2`」，框是这一段的第一件事
  'magic.effect': 'lead',
  'magic.gotCard': 'lead',
  'magic.spin': 'lead',
  // 命運的神明加持：框 `0x0044d83f` → 台词 `0x0044d873`；框 `0x0044ce69` → 台词 `0x0044ce7e`
  'blessing.rewardDouble': 'stage',
  'blessing.rewardVoid': 'stage',
  'blessing.penaltyDouble': 'stage',
  'blessing.penaltyVoid': 'stage',
  'blessing.misfortuneDouble': 'stage',
  'blessing.misfortuneVoid': 'stage',
  // 過路費的神明调整 `0x41d709`（在 `0x00419d70` / `0x0041a58a`，付款台词之前）
  'god.tollHalf': 'stage',
  'god.tollFree': 'stage',
  'god.tollPlusHalf': 'stage',
  'god.tollDouble': 'stage',
  // ★ 保險理賠 `0x44ba63` 的六个调用点都在台词之后：入獄 `0x0043d71c` → `0x0043d749`、
  //   住院 `0x0043edcb` → `0x0043edf8`、住店 `0x0041a7e0` → `0x0041a82d`、命運付款 `0x0044cef9` → `0x0044cf11`、
  //   消失 `0x0040d3f8` → `0x0040d425`
  'insurance.payout': 'tail',
  // 收費那一段的被动卡：嫁禍 `0x44476a` 亮牌 `0x00444999` → 框 `0x004449df` → 出牌台词 `0x00444a1d` → 回应 `0x00444a4b`；
  //   免費卡 `0x00444b25` 亮牌 → `0x00444b5e` → `0x00444b98`（出牌台词此时是 `afterStage`，见 `cardLineOrder`）
  'card.use': 'stage',
  'card.scapegoatOn': 'stage',
  'card.scapegoatTo': 'stage',
  'npc.stealPoints': 'stage',
  'npc.stealCard': 'stage',
  'npc.robBank': 'stage',
  'npc.protection': 'stage',
  'npc.spyToll': 'stage',
  'npc.spySurplus': 'stage',
  'company.noTravel': 'stage',
  'company.pickBuildSite': 'stage',
  'research.done': 'stage',
  'shares.becameBoss': 'stage',
  'shares.becameChairman': 'stage',
  'stock.aiBuy': 'stage',
  'stock.aiSell': 'stage',
  'stock.limitUpNoBuy': 'stage',
  'stock.limitDownNoSell': 'stage',
  'bank.loanFrozen': 'stage',
  'bank.aiBorrow': 'stage',
  'bank.aiRepay': 'stage',
  'bank.loanDueForced': 'stage',
  'bank.loanDueOneDay': 'stage',
  'bank.loanDueTwoDays': 'stage',
  'bank.reserveShortfall': 'stage',
  'bank.chairmanChanged': 'stage',
  'bank.forcedSpecialRepay': 'stage',
  'bail.prison': 'stage',
  'bail.hospital': 'stage',
  'land.cashShort': 'stage',
  'card.cashShort': 'stage',
  // 出牌台词在前（`beforeStage`）：搶奪 `0x00443e9c` 之后才是结果；股票卡 / 查稅卡同理（台词 → 飞行 → 框）
  'card.robbed': 'stage',
  'card.useOnStock': 'stage',
  'card.taxed': 'stage',
  // ★★ 第十五份（本次回报）：电脑用道具 —— `0x00448070 call 0x440cac("使用%s", 0x5dc)` **之后**
  //   才 `0x0044807e call [道具号*4 + 0x475dd5]`，而道具函数的第一件事是道具台词
  //   （定時炸彈 `0x00446d8b`、機器工人 `0x004472ba` …）⇒ 框 → 台词 → 投掷 / 影片
  'tool.aiUse': 'lead',
} as const satisfies Record<NoticeKey, BoxTier>;

export function noticeTier(key: NoticeKey): BoxTier {
  return NOTICE_TIER[key];
}

/**
 * 除訊息框之外、会与台词同一拍出现的「框」（整屏 / 浮窗 / 神明台词窗）及其档次。
 *
 * - `eventBox`：新聞 / 命運事件框 `0x44b6df`、亮牌 `0x441f73`、抽卡卡面 —— 都在效果函数**之前**；
 * - `wheel`：轉盤 `0x44090e`（設施 `0x0041a458` → 框 `0x0041a579` → 付款台词 `0x0041a71e`）；
 * - `godSay` / `godSlot`：壞神附身 台词 `0x0040ef44` → 影片 `0x0040ef78` → `0x40e2a2` `0x0040ef8e` → `0x440706`；
 *   小財神 `0x40e2a2` → `0x440706` → 台词 `0x0040ecde`；
 *   ★ 第十八份：`godSay` 与附身影片**同屏** —— 片尾不重画（`flags` = 1，`0x00451552` 不走 `0x409b18`），
 *   `0x40e2a2` 把白字写在影片最后一帧上 ⇒ 次序仍是「片 → 字」，但最后一帧钉到字收场（`god-line.ts`）；
 * - `shares` / `lotteryDraw` / `monthly`：推日期里的整屏（`0x41d08f` / `0x41d094` / 月结），先于新一天的一切；
 * - `magic`：魔法屋女巫窗，先于它逐段的框 / 影片 / 台词（`0x431caa`）。
 */
export type ScreenBox = 'eventBox' | 'wheel' | 'godSay' | 'godSlot' | 'shares' | 'lotteryDraw' | 'monthly' | 'magic';

export const SCREEN_BOX_TIER = {
  eventBox: 'lead',
  wheel: 'stage',
  godSay: 'stage',
  godSlot: 'stage',
  shares: 'lead',
  lotteryDraw: 'lead',
  monthly: 'lead',
  magic: 'lead',
} as const satisfies Record<ScreenBox, BoxTier>;

// ============================================================
//  夹在两段演出之间的台词（`cue`）
// ============================================================

/**
 * ★★ 第十五份（需求方拍板「照原版」，把先前明写的四处偏离改对）：有几句台词在 exe 里
 *   **夹在两段演出中间** —— 前一段演完才说、说完才轮到后一段：
 *
 * | `cue` | 前一段 | 台词 | 后一段 |
 * |---|---|---|---|
 * | `godAscend` | 旧神升天（`0x40e32c` 的动画）| 「一場惡夢～」`0x0040e659` | 新神影片 / `0x40e2a2`（换神：`0x0040eb3f` 在 `god_activate` 最前）|
 * | `buildHammer` | 建設公司的大锤 `0x0041ab10` | 事件 15 `0x0041ab5b` | 0x20b `0x0041ab63` |
 * | `manifestBox` | 福神顯靈框 `0x0040f9c9` | 事件 15 `0x0040fa1e` | 0x20b `0x0040fa26` |
 * | `godAttach` | 請神符 神明飞过来 `0x00444efa`；换神时旧神升天（`0x0040eb3f` 在 `god_activate` 最前）| 壞神附身那一句 `0x0040ef44` 等 | 附身影片 |
 *
 * 做法：台词照常带它的 `order`（都是 `beforeStage` —— 后一段要等它），另带一个 `cue`；
 * `cue` 那一段还没演完时，这一句**不算数**：不上台，也不挡任何框 / 影片（`heldRanks` 里不算它），
 * 所以前一段照常起播；演完之后它变回普通的 `beforeStage`，后一段就得等它说完。
 */
export type SpeechCue = 'godAscend' | 'buildHammer' | 'manifestBox' | 'godAttach';

/** 押着的台词里，哪几句此刻**算数**（`cue` 为空或那一段已演完）*/
export function countedHeld<T extends { cue?: SpeechCue }>(held: readonly T[], cueDone: (cue: SpeechCue) => boolean): T[] {
  return held.filter((h) => h.cue === undefined || cueDone(h.cue));
}

// ============================================================
//  两道闸
// ============================================================

/** 台词那一侧此刻的样子 */
export interface SpeechSnapshot {
  /** 台上（含排队、已进 `SpeechQueue`）的句数 —— 有一句就有气泡在屏上 */
  onStage: number;
  /** 还押着、没进 `SpeechQueue` 的那几句各自的档（`lineRank`）*/
  heldRanks: readonly number[];
}

/**
 * 一扇框（訊息框 / 事件框 / 轉盤 / 老虎机 / 神明台词窗）此刻能不能起播。
 *
 * ① 台上有气泡 ⇒ 不起（互斥：原版 `player_say` 没返回，调用它的流程到不了下一扇框）；
 * ② 有档更小的台词还押着 ⇒ 不起（原版那一句排在这扇框之前）。
 */
export function boxMayStart(tier: BoxTier, s: SpeechSnapshot): boolean {
  if (s.onStage > 0) return false;
  const r = boxRank(tier);
  return s.heldRanks.every((h) => h > r);
}

/** 框那一侧此刻的样子 */
export interface BoxSnapshot {
  /** 屏上正有一扇框（含框收掉后那段点不掉的空等）*/
  showing: boolean;
  /** 已经排定、还没起播的那几扇框各自的档（`boxRank`）*/
  pendingRanks: readonly number[];
  /** 影片 / 建屋片 / 投掷 / 走子 / 掷骰 / 過路費閃爍 / 升天 还在演（W-51 那几位，不含框）*/
  filmsBusy: boolean;
}

/**
 * 一句押着的台词此刻能不能上台（进 `SpeechQueue`）。
 *
 * ① 屏上有框 ⇒ 不上（互斥）；
 * ② 有档更小的框还没弹 ⇒ 不上（那扇框排在这一句之前）；
 * ③ `afterStage` 起的句子还要等影片那一类演完（W-51；`beforeStage` 反过来是影片等它）。
 */
export function lineMayEnter(order: SpeechOrder, b: BoxSnapshot): boolean {
  if (b.showing) return false;
  const r = lineRank(order);
  if (b.pendingRanks.some((p) => p < r)) return false;
  return order === 'beforeStage' || !b.filmsBusy;
}

/**
 * 影片 / 建屋片 / 投掷 / 娃娃上路起播前还要等几句（`filmWaitsForSpeech` 的入参）。
 *
 * = 台上的 + 押着的 `beforeStage`（原版这些都在第一句 `player_say` 返回之后才走到）。
 * ⚠️ 不算押着的 `afterStage` 起那几句 —— 它们本来就排在影片之后（算了就互等）。
 */
export function speechAheadOfFilms(s: SpeechSnapshot): number {
  return s.onStage + s.heldRanks.filter((r) => r < PRESENTATION_RANK.stage).length;
}

/**
 * 按档把新来的几句插进押着的队列（**稳定**：同档保持来时的先后 = 探测器 / 出牌台词的先后）。
 * 返回新数组，不改入参。
 */
export function insertByRank<T extends { rank: number }>(held: readonly T[], incoming: readonly T[]): T[] {
  const out = [...held];
  for (const item of incoming) {
    let i = out.length;
    while (i > 0 && out[i - 1]!.rank > item.rank) i--;
    out.splice(i, 0, item);
  }
  return out;
}
