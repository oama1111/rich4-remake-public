/*
 * 台词气泡 × 框 的先后与互斥 —— 单测（第十五份：「台词和棕色对话框又重叠了」全面排查）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 三件事：
 *  ① **exe 先后表**：同一条 action 里会一起出现的每一对（台词来源 × 框），原版谁先谁后（带 VA）。
 *     `presentation-order.ts` 的档次（+ 夹在两段演出之间的 `cue`）必须排出同样的先后 —— 一处例外都没有。
 *  ② **表要全**：长局（4 电脑 × 8 张图）里实际撞见的每一对都必须在表里 ——
 *     以后新加探测器 / 新的訊息框，只要会与另一边同拍出现，这里就红，逼着去 exe 里查先后。
 *  ③ **运行时不变量**：把长局里每一条 action 的框与台词交给同一套闸（`boxMayStart` / `lineMayEnter`，
 *     与 `main.ts` 用的是同一份纯函数）逐拍模拟 —— 气泡与框**从不同屏**、**从不卡死**、先后照表。
 */

import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decideAction,
  newGame,
  parseMap,
  reduce,
  type GameState,
  type MapTopology,
  type NoticeKey,
} from '@rich4/core';
import {
  NOTICE_TIER,
  PRESENTATION_RANK,
  SCREEN_BOX_TIER,
  boxMayStart,
  boxRank,
  insertByRank,
  lineMayEnter,
  lineRank,
  speechAheadOfFilms,
  countedHeld,
  type BoxTier,
  type ScreenBox,
  type SpeechCue,
} from './presentation-order.ts';
import { DETECTORS, cardPlaySpeechLines, toolUseSpeechLines, TOOL_LINE_ORDER } from './speech.ts';
import type { SpeechOrder } from './stage-gate.ts';
import { wheelCue } from './wheel-screen.ts';
import { godSlotCue } from './god-slot.ts';
import { godLineTrigger } from './god-line.ts';
import { cardGained } from './event-box-screen.ts';
import { dividendDayCrossed } from './shares-screen.ts';
import { lotteryDrawCue } from './lottery-draw-screen.ts';
import { freshMagicBeats } from './magic-fx.ts';

// ============================================================
//  ① exe 先后表
// ============================================================

/** 台词来源：探测器名；同一探测器的另一档写成 `名@档`；卡牌 / 道具台词另起名 */
type LineSource = string;
/** 框：訊息框的 `NoticeKey`，或 `SCREEN_BOX_TIER` 里那几种（事件框细分成四种来源）*/
type BoxId = NoticeKey | Exclude<ScreenBox, 'eventBox'> | 'eventBox:news' | 'eventBox:fortune' | 'eventBox:cardUse' | 'eventBox:cardDraw';

interface OrderRow {
  line: LineSource;
  boxes: readonly BoxId[];
  /** 原版里：台词先（`lineFirst`）还是框先（`boxFirst`）*/
  exe: 'lineFirst' | 'boxFirst';
  /** 取证（`python3 tools/disasm.py va …` / `callers 0x44ef41`）*/
  va: string;
}

const RENT_PAY: readonly BoxId[] = ['rent.payOneOwner', 'rent.payTwoOwners', 'rent.payChairman', 'rent.payBoss'];
const RENT_FREE: readonly BoxId[] = [
  'rent.freeSealed',
  'rent.freeAllied',
  'rent.freeReaper',
  'rent.freeHotel',
  'rent.freeVanished',
  'rent.freePrison',
  'rent.freeHospital',
  'rent.freeWinterSleep',
  'rent.freeSleepwalk',
];
const GOD_TOLL: readonly BoxId[] = ['god.tollHalf', 'god.tollFree', 'god.tollPlusHalf', 'god.tollDouble'];
const MANIFEST: readonly BoxId[] = ['god.build', 'god.demolish', 'god.seize'];
const BLESSING: readonly BoxId[] = [
  'blessing.rewardDouble',
  'blessing.rewardVoid',
  'blessing.penaltyDouble',
  'blessing.penaltyVoid',
  'blessing.misfortuneDouble',
  'blessing.misfortuneVoid',
];
const CONFINE: readonly BoxId[] = [
  'confinement.hotel',
  'confinement.disappearing',
  'confinement.prison',
  'confinement.hospital',
  'confinement.sleeping',
];
const EVENT: readonly BoxId[] = ['eventBox:news', 'eventBox:fortune'];
const MAGIC: readonly BoxId[] = ['magic.spin', 'magic.effect', 'magic.gotCard'];
/** 事件效果 / 落点引出的「后果台词」—— 都在事件框之后（框 `0x0044dd49` / `0x0044b867` 等完才 `call [效果表]`）*/
const CONSEQUENCE_LINES = [
  'prisonEntered',
  'hospitalEntered',
  'disappearSay',
  'fortuneLine',
  'moneyPaid',
  'moneyGained',
  'pointsGained',
  'noticeSay',
  'demolishedHouse',
  'newsPlaceOwner',
  'godLeft',
  'dreamCard',
  'smallWealthLine',
  'godCard',
] as const;

export const EXE_ORDER_TABLE: readonly OrderRow[] = [
  // ── 电脑用道具（本次回报）──
  {
    line: 'toolLine',
    boxes: ['tool.aiUse'],
    exe: 'boxFirst',
    va: '`0x00448070 call 0x440cac("使用%s", 0x5dc)` → `0x0044807e call [0x475dd5+4*道具]` → 道具函数第一件事 `player_say`（定時炸彈 `0x00446d8b`、機器工人 `0x004472ba` …）',
  },
  {
    line: 'hospitalEntered',
    boxes: ['tool.aiUse'],
    exe: 'boxFirst',
    va: '「使用%s」`0x00448070` 在道具函数之前；飛彈 / 核彈的住院在道具函数里（`0x004470df` / `0x00447bf5 call 0x43ec3f` → 台词 `0x0043edcb`）',
  },
  {
    line: 'toolLine',
    boxes: ['insurance.payout'],
    exe: 'lineFirst',
    va: '道具台词是道具函数第一件事（飛彈 `0x00446fe3`），理賠在住院之后（`0x0043edf8`）',
  },
  // ── 用卡 ──
  {
    line: 'cardLine',
    boxes: ['eventBox:cardUse'],
    exe: 'boxFirst',
    va: '亮牌 `0x00441def call 0x441f73`（电脑）/ `0x00441cbc`（真人）→ `0x00441e00 call [卡片表]` → 函数里第一个 `player_say`',
  },
  {
    line: 'cardLine',
    boxes: ['card.robbed', 'card.useOnStock', 'card.taxed', 'godSay', 'godSlot', 'god.gotCard', 'god.gotCardTwo'],
    exe: 'lineFirst',
    va: '出牌台词在卡片函数最前：股票卡 `0x00444f5b` → 框 `0x00444fdb`、`0x00445079` → `0x00445154`；查稅 `0x0044526b` → `0x004453ef`；搶奪 `0x00443e9c` → 取物；請神符 `0x00444e8a` → 飞 `0x00444efa` → 附身（福神得卡框 `0x0040ee2f` 在附身里）',
  },
  {
    line: 'cardLine@afterStage',
    boxes: [...RENT_PAY, 'card.use', 'card.scapegoatOn', 'card.scapegoatTo', 'wheel', 'facility.hotel', 'facility.mall', 'facility.gasStation'],
    exe: 'boxFirst',
    va: '收費那一段的被动卡：過路費框 `0x00419d5a` → 免費卡亮牌 `0x00444b25` → `0x00444b5e`；嫁禍 亮牌 `0x00444999` → 框 `0x004449df` → `0x00444a1d`；設施 框 `0x0041a579` → 免費卡 `0x0041a62e call 0x444a60` / 嫁禍 `0x0041a683 call 0x44476a`',
  },
  {
    line: 'cardAnswer',
    boxes: [...RENT_PAY, 'card.use', 'card.scapegoatOn', 'card.scapegoatTo', 'wheel', 'facility.hotel', 'facility.mall', 'facility.gasStation'],
    exe: 'boxFirst',
    va: '回应台词紧跟出牌台词：`0x00444b98` / `0x00444a4b`',
  },
  ...(['dreamCard', 'prisonEntered', 'godLeft', 'smallWealthLine', 'bigWealthLine', 'godCard', 'moneyPaid'] as const).map(
    (line): OrderRow => ({
      line,
      boxes: ['eventBox:cardUse'],
      exe: 'boxFirst',
      va: '亮牌在卡片函数之前（`0x00441def` → `0x00441e00`），效果台词在卡片函数里（夢遊 `0x00444356`、入獄 `0x0044464a` …）',
    }),
  ),
  {
    line: 'moneyPaid',
    boxes: ['card.taxed'],
    exe: 'boxFirst',
    va: '查稅卡：框 `0x004453ef` → 台词 `0x00445419`',
  },
  // ── 过路费 / 設施 / 企業 ──
  {
    line: 'moneyPaid',
    boxes: [...RENT_PAY, ...GOD_TOLL, 'rent.reaperPays', 'facility.hotel', 'facility.mall', 'facility.gasStation', 'wheel', 'card.scapegoatOn', 'card.scapegoatTo'],
    exe: 'boxFirst',
    va: '住宅 框 `0x00419d5a` → 神明调整 `0x00419d70` → 死神框 `0x00419f20` → 付款台词 `0x00419f67`；設施 轉盤 `0x0041a458` → 框 `0x0041a579` → `0x0041a71e`；企業 框 `0x0041aeb4` → `0x0041b006`；嫁禍（設施 `0x0041a683 call 0x44476a` → 框 `0x004449df` / `0x00444a1d`）在付款台词之前',
  },
  {
    line: 'moneyGained',
    boxes: [...RENT_PAY, ...GOD_TOLL, 'facility.hotel', 'facility.mall', 'facility.gasStation', 'wheel', 'card.scapegoatOn', 'card.scapegoatTo'],
    exe: 'boxFirst',
    va: '地主進帳 `0x00419fa1` / `0x0041a735`，都在收費框之后（也在嫁禍那两扇 `0x004449df` / `0x00444a1d` 之后）',
  },
  {
    line: 'hotelStay',
    boxes: ['facility.hotel', ...GOD_TOLL, 'wheel'],
    exe: 'boxFirst',
    va: '轉盤 `0x0041a458` → 框 `0x0041a579` → 住店台词 `0x0041a7e0`',
  },
  {
    line: 'noticeSay',
    boxes: [...RENT_FREE, ...RENT_PAY, ...GOD_TOLL, ...BLESSING, 'facility.hotel', 'facility.mall', 'facility.gasStation', 'wheel'],
    exe: 'boxFirst',
    va: '免收 框 `0x0041d6ae` → `0x0041d6dd`；大財神 框 `0x0041d7ac` → `0x0041d7c1`；命運加持 `0x0044ce69` → `0x0044ce7e`、`0x0044d83f` → `0x0044d873`；加油站 框 `0x0041a579` → `0x0041a58a call 0x41d709`（与旅館 / 購物中心同一段）',
  },
  {
    line: 'disappearSay',
    boxes: ['rent.payChairman', ...GOD_TOLL, 'wheel', ...BLESSING, ...EVENT],
    exe: 'boxFirst',
    va: '航空：轉盤 `0x0041ac3f` → 框 `0x0041aeb4` → `0x0041b05a call 0x40d375` → 台词 `0x0040d3f8`',
  },
  {
    line: 'disappearSay',
    boxes: ['card.scapegoatOn', 'card.scapegoatTo'],
    exe: 'boxFirst',
    va: '命運 6 / 7 被嫁禍：`0x0044c6c5` / `0x0044c7d7 call 0x441210` → `0x0044124e call 0x44476a`（嫁禍框 `0x004449df` / `0x00444a1d`）→ 共用尾巴 `0x0044c6e0 call 0x40d375` → 台词 `0x0040d3f8`',
  },
  // 反应台词之后才弹的框（`tail` 档）
  ...(['moneyPaid', 'moneyGained', 'hotelStay', 'noticeSay', 'prisonEntered', 'hospitalEntered', 'disappearSay'] as const).map(
    (line): OrderRow => ({
      line,
      boxes: ['insurance.payout'],
      exe: 'lineFirst',
      va: '理賠 `0x44ba63` 六个调用点都在台词后：`0x0043d71c`→`0x0043d749`、`0x0043edcb`→`0x0043edf8`、`0x0041a7e0`→`0x0041a82d`、`0x0044cef9`→`0x0044cf11`、`0x0040d3f8`→`0x0040d425`',
    }),
  ),
  ...(['moneyPaid', 'moneyGained', 'noticeSay', 'areaMonopoly'] as const).map(
    (line): OrderRow => ({
      line,
      boxes: MANIFEST,
      exe: 'lineFirst',
      va: '落点例程收尾 `jmp 0x41b077` → `0x0041b086 call 0x40f381`（顯靈）；福神 `0x00419a31` 街區台词 → `0x00419a48 call 0x40f8be`',
    }),
  ),
  {
    line: 'landGodLine',
    boxes: [...MANIFEST, ...RENT_FREE, ...RENT_PAY, ...GOD_TOLL, 'facility.mall', 'facility.hotel', 'wheel'],
    exe: 'boxFirst',
    va: '土地公：框 `0x0040f878` → 台词 `0x0040f8ab`（落点尾块，在收費框之后）',
  },
  {
    line: 'luckyGodLine',
    boxes: ['god.build'],
    exe: 'boxFirst',
    va: '福神：框 `0x0040f9c9` → 台词 `0x0040fa5c`',
  },
  {
    line: 'levelFive~manifestBox',
    boxes: ['god.build'],
    exe: 'boxFirst',
    va: '福神盖到 5 级：框 `0x0040f9c9` → 台词 `0x0040fa1e` → 0x20b `0x0040fa26`（`cue: manifestBox`）',
  },
  // ── 得点 / 商店 / 寶箱 ──
  {
    line: 'pointsGained',
    boxes: ['points.10', 'object.treasure', 'object.gift'],
    exe: 'boxFirst',
    va: '得点格 框 `0x0041b972` → `0x0041b98b`；寶箱 框 `0x0041bc9c` → `0x0041bcde`',
  },
  {
    line: 'pointsSquarePhrase',
    boxes: ['points.30', 'points.50', 'points.minigame', 'points.card', 'eventBox:cardDraw'],
    exe: 'boxFirst',
    va: '小遊戲不玩：框 `0x0041548e` → `0x004154cf`',
  },
  { line: 'shopGift', boxes: ['shop.chairmanGift'], exe: 'boxFirst', va: '框 `0x0042ea14` → `0x0042ea23`' },
  // ── 回合开始被挡 ──
  {
    line: 'turnStartBlocked',
    boxes: CONFINE,
    exe: 'lineFirst',
    va: '`fcn_0040c912`：台词 `0x0040ca51`/`0x0040caca`/`0x0040cb4c` → 框 `0x0040cb98`',
  },
  // ── 神明 ──
  {
    line: 'godArrived',
    boxes: ['godSay', 'godSlot', 'god.lostCard'],
    exe: 'lineFirst',
    va: '壞神：台词 `0x0040ef44` → 影片 `0x0040ef78` → `0x40e2a2` `0x0040ef8e` → `0x440706` `0x0040ef98`；小衰神 `0x0040f0ac` → … → 框 `0x0040f148`',
  },
  {
    line: 'moneyPaid',
    boxes: ['godSay', 'godSlot'],
    exe: 'boxFirst',
    va: '壞神付款在老虎机之后（`0x0040ef98` → `0x0040efd9`）',
  },
  {
    line: 'smallWealthLine',
    boxes: ['godSay', 'godSlot'],
    exe: 'boxFirst',
    va: '小財神 `0x0040ec56` → `0x0040ec60` → 台词 `0x0040ecde`',
  },
  {
    line: 'bigWealthLine',
    boxes: ['godSay', 'godSlot'],
    exe: 'boxFirst',
    va: '大財神 `0x0040ed33` → `0x0040ed3d` → 台词 `0x0040ed85`',
  },
  {
    line: 'godCard',
    boxes: ['godSay', 'god.gotCard', 'god.gotCardTwo'],
    exe: 'boxFirst',
    va: '福神得卡 `0x0040edd1` → 框 `0x0040ee2f` → 台词 `0x0040ee46`',
  },
  {
    line: 'godLeft',
    boxes: ['godSay', 'godSlot', 'god.gotCard', 'god.gotCardTwo', 'god.lostCard'],
    exe: 'lineFirst',
    va: '换神：`god_activate` 先 `0x40eb3f call 0x40e32c`（升天 → 台词 `0x0040e659`）再播新神影片 / `0x40e2a2`',
  },
  {
    // ★ 第 24 份的改动让长局里出现了「推日期那一整屏」与「神明任期到了」同一拍（g20 图 4 第 56 回合）
    line: 'godLeft',
    boxes: ['shares', 'lotteryDraw'],
    exe: 'boxFirst',
    va: '回合交接 `0x0041902e call 0x41cf67`（推日期：股息 `0x0041d08f call 0x42ba97`、樂透開獎 `0x0041d094 call 0x431712`）在 `0x00419039 call 0x41c84f`（逐人计数，神明任期 `0x0041cc9b call 0x40e32c` → 升天 → 「一場惡夢～」`0x0040e659`）之前',
  },
  {
    line: 'godArrived',
    boxes: ['eventBox:cardUse'],
    exe: 'boxFirst',
    va: '請神符：亮牌 `0x00441def` → 卡片函数（出牌台词 `0x00444e8a` → 飞 `0x00444efa`）→ 附身台词',
  },
  // ── 命運 5 生日收卡：事件框（pass 0 `0x0044c3e2`）→ 逐人收（电脑支每张一扇「搶得」框 `0x00441ab1`）→ 台词 `0x0044c5c5` ──
  {
    line: 'birthdayLine',
    boxes: [...EVENT, 'card.robbed'],
    exe: 'boxFirst',
    va: '`fcn_0044c3b7`：入参 0 那一趟画事件框字（`0x0044c3e2`），施加那一趟循环里 `0x0044c46e call 0x441e77` / `0x0044c47e call 0x4412e4`（「搶得%s的」框 `0x00441ab1`）都在 `0x0044c57b` 之前 → `0x0044c5c5 player_say`',
  },
  // ── 事件框之后的一切后果台词 ──
  ...CONSEQUENCE_LINES.map(
    (line): OrderRow => ({
      line,
      // 命運的神明加持框（`fcn_0044b896` → `0x440cac`）在施加之前 ⇒ 施加引出的台词都在它之后
      //   （`0x0044ce9a` → 付款 `0x0044cef9`；`0x0044d88c` → 送監獄 `0x0044d8c2`）。
      //   「一場惡夢～」是 `beforeStage`（换神那一支），不在命運施加的尾巴上 ⇒ 不配加持框。
      boxes: line === 'godLeft' ? [...EVENT, ...MAGIC] : [...EVENT, ...MAGIC, ...BLESSING],
      exe: 'boxFirst',
      va: '命運 `0x0044dd49 call 0x4544f6`（框等完）→ `0x0044dd5d call [施加]`；新聞 `0x0044b867` → `0x0044b875`；魔法屋每段框 `0x440cac` 在前；命運加持框 `0x0044d88c` → `0x0044d8c2` 送監獄（醫院同形）',
    }),
  ),
  ...(['magicPonder', 'magicAuctionPonder'] as const).map(
    (line): OrderRow => ({
      line,
      boxes: MAGIC,
      exe: 'boxFirst',
      va: '魔法屋：框 `0x440cac` → 影片 → 台词 `0x004320a2`',
    }),
  ),
];

/** 表里这一对（没写就是 undefined）*/
function rowFor(line: LineSource, box: BoxId): OrderRow | undefined {
  return EXE_ORDER_TABLE.find((r) => r.line === line && r.boxes.includes(box));
}

/** 台词来源 → 档（`order`）*/
function lineOrderOf(line: LineSource): SpeechOrder {
  const tilde = line.indexOf('~');
  if (tilde >= 0) return lineOrderOf(line.slice(0, tilde));
  const at = line.indexOf('@');
  if (at >= 0) return line.slice(at + 1) as SpeechOrder;
  if (line === 'cardLine') return 'beforeStage';
  if (line === 'cardAnswer') return 'afterStage';
  if (line === 'toolLine') return TOOL_LINE_ORDER;
  const d = DETECTORS.find((x) => x.name === line);
  if (d === undefined) throw new Error(`没有这个台词来源：${line}`);
  return d.order;
}

/** 台词来源名里带的 `cue`（`名~cue`；探测器自带的 `SpeechDetector.cue` 不写进名字）*/
function cueOf(line: LineSource): SpeechCue | undefined {
  const tilde = line.indexOf('~');
  if (tilde >= 0) return line.slice(tilde + 1) as SpeechCue;
  return DETECTORS.find((x) => x.name === line)?.cue;
}

/** `cue` 等的是哪一种框（其余几种 `cue` 等的是影片 / 升天 / 飞行，不是框）*/
const CUE_BOXES: Partial<Record<SpeechCue, readonly BoxId[]>> = { manifestBox: ['god.build'] };

/** 按本引擎的档次 + `cue`，这一对谁先 */
function oursOrder(line: LineSource, box: BoxId): 'lineFirst' | 'boxFirst' {
  const cue = cueOf(line);
  if (cue !== undefined && CUE_BOXES[cue]?.includes(box) === true) return 'boxFirst';
  return lineRank(lineOrderOf(line)) < boxRank(boxTierOf(box)) ? 'lineFirst' : 'boxFirst';
}

function boxTierOf(box: BoxId): BoxTier {
  if (box.startsWith('eventBox:')) return SCREEN_BOX_TIER.eventBox;
  if (box in SCREEN_BOX_TIER) return SCREEN_BOX_TIER[box as ScreenBox];
  return NOTICE_TIER[box as NoticeKey];
}

describe('① exe 先后表 × 档次', () => {
  it('六档交替：框 10 < 台词 20 < 框 30 < 台词 40 < 框 50 < 台词 60', () => {
    expect(Object.values(PRESENTATION_RANK)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it.each(EXE_ORDER_TABLE.flatMap((r) => r.boxes.map((b) => [r.line, b, r] as const)))(
    '%s × %s',
    (line, box, row) => {
      expect(oursOrder(line, box), row.va).toBe(row.exe);
    },
  );

  it('★ 本次回报那一对：电脑用定時炸彈 ⇒ 「使用定時炸彈」框先、道具台词后、投掷最后', () => {
    expect(NOTICE_TIER['tool.aiUse']).toBe('lead');
    expect(TOOL_LINE_ORDER).toBe('beforeStage');
    // 框在屏上：台词不上台
    expect(lineMayEnter('beforeStage', { showing: true, pendingRanks: [], filmsBusy: false })).toBe(false);
    // 框收了：台词上台（投掷再等它 —— 押着的 `beforeStage` 也算在影片前面）
    expect(lineMayEnter('beforeStage', { showing: false, pendingRanks: [], filmsBusy: true })).toBe(true);
    expect(speechAheadOfFilms({ onStage: 0, heldRanks: [lineRank('beforeStage')] })).toBe(1);
    expect(speechAheadOfFilms({ onStage: 0, heldRanks: [lineRank('afterStage')] })).toBe(0);
  });
});

describe('两道闸', () => {
  it('boxMayStart：台上有气泡一律不起；押着的台词只挡档更大的框', () => {
    for (const t of ['lead', 'stage', 'tail'] as const) {
      expect(boxMayStart(t, { onStage: 1, heldRanks: [] })).toBe(false);
      expect(boxMayStart(t, { onStage: 0, heldRanks: [] })).toBe(true);
    }
    const first = lineRank('beforeStage');
    const after = lineRank('afterStage');
    expect(boxMayStart('lead', { onStage: 0, heldRanks: [first] })).toBe(true);
    expect(boxMayStart('stage', { onStage: 0, heldRanks: [first] })).toBe(false);
    expect(boxMayStart('stage', { onStage: 0, heldRanks: [after] })).toBe(true);
    expect(boxMayStart('tail', { onStage: 0, heldRanks: [after] })).toBe(false);
  });

  it('lineMayEnter：屏上有框一律不上；只等档更小的框；afterStage 起还等影片', () => {
    const idle = { showing: false, pendingRanks: [] as number[], filmsBusy: false };
    for (const o of ['beforeStage', 'afterStage', 'afterTailBox'] as const) {
      expect(lineMayEnter(o, { ...idle, showing: true })).toBe(false);
      expect(lineMayEnter(o, idle)).toBe(true);
    }
    expect(lineMayEnter('beforeStage', { ...idle, pendingRanks: [boxRank('stage')] })).toBe(true);
    expect(lineMayEnter('beforeStage', { ...idle, pendingRanks: [boxRank('lead')] })).toBe(false);
    expect(lineMayEnter('afterStage', { ...idle, pendingRanks: [boxRank('stage')] })).toBe(false);
    expect(lineMayEnter('afterStage', { ...idle, pendingRanks: [boxRank('tail')] })).toBe(true);
    expect(lineMayEnter('afterTailBox', { ...idle, pendingRanks: [boxRank('tail')] })).toBe(false);
    expect(lineMayEnter('beforeStage', { ...idle, filmsBusy: true })).toBe(true);
    expect(lineMayEnter('afterStage', { ...idle, filmsBusy: true })).toBe(false);
  });

  it('insertByRank：按档稳定插入', () => {
    const r = (rank: number, id: string) => ({ rank, id });
    const out = insertByRank([r(20, 'a'), r(40, 'b')], [r(40, 'c'), r(20, 'd'), r(60, 'e')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
});

// ============================================================
//  ②③ 长局：表要全 + 逐拍模拟
// ============================================================

const WS = process.env.RICH4_WORKSPACE ?? '';
const mapPath = (globalMapId: number) => `${WS}/extracted/map/${String(globalMapId * 2 + 1).padStart(4, '0')}.bin`;
const runSoak = existsSync(mapPath(0)) ? it : it.skip;

interface SimBox {
  id: BoxId;
  tier: BoxTier;
  ms: number;
}
interface SimLine {
  source: LineSource;
  order: SpeechOrder;
  rank: number;
  cue?: SpeechCue;
}

/** 这一条 action 交出来的框（与各整屏 `event()` 的认法同一套）*/
function boxesOf(before: GameState, after: GameState, topo: MapTopology): SimBox[] {
  const out: SimBox[] = [];
  const screen = (id: BoxId, tier: BoxTier, ms: number) => out.push({ id, tier, ms });
  if (after.totalMonths > before.totalMonths) screen('monthly', SCREEN_BOX_TIER.monthly, 4000);
  if (dividendDayCrossed(before, after)) screen('shares', SCREEN_BOX_TIER.shares, 3000);
  if (lotteryDrawCue(before, after) !== null) screen('lotteryDraw', SCREEN_BOX_TIER.lotteryDraw, 4000);
  const ev = after.lastEvent;
  const noticesNew = after.notices !== before.notices;
  if (ev !== null && ev !== before.lastEvent && (ev.kind === 'news' || ev.kind === 'fortune')) {
    screen(`eventBox:${ev.kind}`, SCREEN_BOX_TIER.eventBox, 2400);
  } else if (noticesNew && after.notices.some((n) => n.key === 'god.gotCard' || n.key === 'god.gotCardTwo')) {
    // 福神得卡没有卡面
  } else if (after.lastCardPlay !== null && after.lastCardPlay !== before.lastCardPlay) {
    if (after.lastCardPlay.popup !== false) screen('eventBox:cardUse', SCREEN_BOX_TIER.eventBox, 1500);
  } else if (before.pending?.kind !== 'shop' && after.pending?.kind !== 'shop' && !(ev !== before.lastEvent && ev?.kind === 'magicHouse')) {
    if (cardGained(before, after) !== null) screen('eventBox:cardDraw', SCREEN_BOX_TIER.eventBox, 2000);
  }
  if (wheelCue(before, after, topo) !== null) screen('wheel', SCREEN_BOX_TIER.wheel, 3000);
  if (godLineTrigger(before, after) !== null) screen('godSay', SCREEN_BOX_TIER.godSay, 2400);
  if (godSlotCue(before, after) !== null) screen('godSlot', SCREEN_BOX_TIER.godSlot, 3000);
  if (noticesNew) for (const n of after.notices) screen(n.key, NOTICE_TIER[n.key], n.holdMs ?? 1500);
  return out;
}

/** 这一条 action 派生的台词（与 `main.ts` 的 `playSoundFor` 同一套来源与次序）*/
function linesOf(before: GameState, after: GameState, topo: MapTopology): SimLine[] {
  const out: SimLine[] = [];
  const add = (source: LineSource, order: SpeechOrder, cue?: SpeechCue) =>
    out.push({ source, order, rank: lineRank(order), ...(cue === undefined ? {} : { cue }) });
  for (const l of cardPlaySpeechLines(before, after)) {
    const isAnswer = l.bubble.player !== after.lastCardPlay?.player;
    add(isAnswer ? 'cardAnswer' : l.order === 'beforeStage' ? 'cardLine' : `cardLine@${l.order}`, l.order);
  }
  for (const l of toolUseSpeechLines(before, after)) add('toolLine', l.order);
  for (const d of DETECTORS) {
    for (const ev of d.detect(before, after, topo)) {
      const order = ev.order ?? d.order;
      const cue = ev.cue ?? d.cue;
      const name = order === d.order ? d.name : `${d.name}@${order}`;
      add(ev.cue !== undefined && ev.cue !== d.cue ? `${name}~${ev.cue}` : name, order, cue);
    }
  }
  return out;
}

interface SimResult {
  /** 每一项的起播时刻（台词：上台；框：起播）*/
  started: Map<string, number>;
  overlapAt: number | null;
  stuck: boolean;
}

/**
 * 逐拍模拟 `main.ts` 的那两道闸（同一份纯函数）：框排成一队（按档稳定排，= 訊息框的 `enqueue`），
 * 台词押进 `heldSpeech`（按档稳定排），`notifyApplied` 的次序 = 先押台词、再让框起播、再放台词。
 * 影片不在模型里（W-51 那一侧另有 `stage-gate.test.ts`），`filmsBusy` 恒 false；
 * `cue` 只模型「等框」那一种（`manifestBox`：本条的顯靈框收了才算数），等影片的那几种当作已演完。
 */
function simulate(boxes: readonly SimBox[], lines: readonly SimLine[]): SimResult {
  const LINE_MS = 1000;
  const DT = 20;
  const queue = insertByRank(
    [],
    boxes.map((b, i) => ({ ...b, key: `box:${b.id}#${i}`, rank: boxRank(b.tier) })),
  );
  let held = insertByRank(
    [],
    lines.map((l, i) => ({ ...l, key: `line:${l.source}#${i}` })),
  );
  const stage: { key: string; until: number }[] = [];
  // 用盒子装：闭包里赋值，TS 的流分析看不见（直接写 `let` 会被收窄成 `null`）
  const box: { showing: { key: string; until: number } | null } = { showing: null };
  const started = new Map<string, number>();
  let overlapAt: number | null = null;
  let t = 0;
  const cueDone = (cue: SpeechCue): boolean => {
    const boxes = CUE_BOXES[cue];
    if (boxes === undefined) return true;
    const up = (key: string) => boxes.some((b) => key.startsWith(`box:${b}#`));
    return !queue.some((q) => up(q.key)) && !(box.showing !== null && up(box.showing.key));
  };
  const tryBox = () => {
    const head = queue[0];
    if (box.showing !== null || head === undefined) return;
    const heldRanks = countedHeld(held, cueDone).map((h) => h.rank);
    if (!boxMayStart(head.tier, { onStage: stage.length, heldRanks })) return;
    queue.shift();
    box.showing = { key: head.key, until: t + head.ms };
    started.set(head.key, t);
  };
  const release = () => {
    const snap = { showing: box.showing !== null, pendingRanks: queue.map((q) => q.rank), filmsBusy: false };
    // 与 `main.ts` 的 `releaseHeldSpeech` 同一条：`cue` 没到的跳过，其余按档过闸，过不了就停
    const keep: typeof held = [];
    let blocked = false;
    for (const l of held) {
      if (blocked || (l.cue !== undefined && !cueDone(l.cue))) keep.push(l);
      else if (lineMayEnter(l.order, snap)) stage.push({ key: l.key, until: 0 });
      else {
        blocked = true;
        keep.push(l);
      }
    }
    held = keep;
  };
  // notifyApplied：先押台词（上面已押）→ 各框 event()（闸开就当场起）→ 放台词
  tryBox();
  release();
  for (; t < 600_000; t += DT) {
    // 到点收
    if (box.showing !== null && t >= box.showing.until) box.showing = null;
    if (stage.length > 0 && stage[0]!.until !== 0 && t >= stage[0]!.until) stage.shift();
    // 各框 tick
    tryBox();
    // speechTick：放行 → 队头起算
    release();
    const head = stage[0];
    if (head !== undefined && head.until === 0) {
      head.until = t + LINE_MS;
      started.set(head.key, t);
    }
    if (stage.length > 0 && box.showing !== null && overlapAt === null) overlapAt = t;
    if (box.showing === null && stage.length === 0 && held.length === 0 && queue.length === 0) {
      return { started, overlapAt, stuck: false };
    }
  }
  return { started, overlapAt, stuck: true };
}

describe('②③ 长局：先后表要全、逐拍模拟不重叠不卡死', () => {
  runSoak(
    '8 张图 × 4 电脑 × 长局：每一对都在表里；气泡与框从不同屏；从不卡死；先后照表',
    () => {
      const missing = new Map<string, string>();
      const failures: string[] = [];
      let actions = 0;
      let pairs = 0;
      for (let g = 0; g < 24; g++) {
        const globalMapId = g % 8;
        const map = parseMap(new Uint8Array(readFileSync(mapPath(globalMapId))));
        const topo: MapTopology = {
          nodes: map.nodes,
          lands: map.lands,
          facilities: map.facilities,
          commercials: map.commercials,
          landscapes: map.landscapes,
        };
        let s: GameState = newGame({
          map,
          globalMapId,
          players: [0, 1, 2, 3].map((i) => ({ character: (i + g * 3) % 12, kind: 'computer' as const })),
          seed: 4242 + g,
        });
        const check = (before: GameState, after: GameState, where: string) => {
          const boxes = boxesOf(before, after, topo);
          const lines = linesOf(before, after, topo);
          if (boxes.length === 0 || lines.length === 0) return;
          actions++;
          for (const l of lines) {
            for (const b of boxes) {
              pairs++;
              if (rowFor(l.source, b.id) === undefined) missing.set(`${l.source} × ${b.id}`, where);
            }
          }
          const r = simulate(boxes, lines);
          if (r.stuck) failures.push(`卡死 ${where}`);
          if (r.overlapAt !== null) failures.push(`同屏 @${r.overlapAt}ms ${where}`);
          // 先后照表（明写的偏离除外）
          boxes.forEach((b, bi) => {
            lines.forEach((l, li) => {
              const row = rowFor(l.source, b.id);
              if (row === undefined) return;
              const tb = r.started.get(`box:${b.id}#${bi}`);
              const tl = r.started.get(`line:${l.source}#${li}`);
              if (tb === undefined || tl === undefined) return;
              const ours = tl < tb ? 'lineFirst' : 'boxFirst';
              if (ours !== row.exe) failures.push(`先后 ${l.source} × ${b.id}：模拟 ${ours}、原版 ${row.exe}（${where}）`);
            });
          });
        };
        for (let step = 0; step < 80_000 && s.turnCount < 200; step++) {
          const a = decideAction({ state: s, map });
          if (a === null) break;
          const n = reduce(s, a, topo);
          if (n === s) break;
          const where = `g${g} 图${globalMapId} 第${n.turnCount}回合 ${a.type}`;
          // 魔法屋：女巫窗（`lead`）之后逐段演，每段各走一遍表现出口（`main.ts` 的 `tickMagicSequence`）
          const beats = freshMagicBeats(s, n);
          if (beats !== null) for (const beat of beats) check(beat.before, beat.after, `${where} 魔法屋段`);
          else check(s, n, where);
          s = n;
        }
      }
      expect([...missing.entries()].map(([k, w]) => `${k}（首见 ${w}）`), '表里缺的（去 exe 查先后再补一行）').toEqual([]);
      expect(failures.slice(0, 20)).toEqual([]);
      // 长局确实撞到了足够多的同拍（防止判据写坏后空转变绿）
      expect(actions).toBeGreaterThan(2000);
      expect(pairs).toBeGreaterThan(2000);
    },
    600_000,
  );
});

describe('★ 夹在两段演出之间的台词（`cue`）', () => {
  it('`cue` 没到的那几句不算数：不挡框、不挡影片；到了就按档照常算', () => {
    const held = [
      { rank: lineRank('beforeStage'), cue: 'manifestBox' as const },
      { rank: lineRank('afterStage') },
    ];
    expect(countedHeld(held, () => false).map((h) => h.rank)).toEqual([lineRank('afterStage')]);
    expect(countedHeld(held, () => true)).toHaveLength(2);
    // 顯靈框（`tail`）在 `cue` 没到时照常起播；到了之后影片要等这一句
    const early = { onStage: 0, heldRanks: countedHeld(held, () => false).map((h) => h.rank) };
    expect(boxMayStart('tail', early)).toBe(false); // 仍被那句 afterStage 挡（它在尾框之前）
    expect(boxMayStart('tail', { onStage: 0, heldRanks: [] })).toBe(true);
    expect(speechAheadOfFilms({ onStage: 0, heldRanks: countedHeld(held, () => true).map((h) => h.rank) })).toBe(1);
  });

  it('四句「夹在中间」的台词都带着各自的 `cue`（先前明写的四处偏离）', () => {
    expect(DETECTORS.find((d) => d.name === 'godLeft')).toMatchObject({ order: 'beforeStage', cue: 'godAscend' });
    expect(DETECTORS.find((d) => d.name === 'godArrived')).toMatchObject({ order: 'beforeStage', cue: 'godAttach' });
    // 事件 15 的两支 `cue` 由 `detectLevelFive` 逐条给（`buildHammer` / `manifestBox`，见 speech.test.ts）
    expect(DETECTORS.find((d) => d.name === 'levelFive')?.source).toEqual([0x00419a0e, 0x0041ab4a, 0x0040fa13]);
  });
});

describe('★ 分紅 / 開獎 / 月结 / 魔法屋女巫窗也走同一道起播闸（`main.ts`）', () => {
  const MAIN = new URL('./main.ts', import.meta.url);
  const runMain = existsSync(MAIN) ? it : it.skip;
  runMain('整屏的 event() 经 `deliverScreenEvent` 派发；押着时算台上在演、算 `lead` 档的排队框；每帧 flush', () => {
    const src = readFileSync(MAIN, 'utf8');
    expect(src).toContain('for (const s of SCREENS) deliverScreenEvent(s, before, state, env);');
    // 第十六份：判据在 `presentation-host.ts`（与单测共用），`main.ts` 把押着的条数交进去
    const host = readFileSync(new URL('./presentation-host.ts', import.meta.url), 'utf8');
    expect(host).toContain('if (this.deps.deferredScreens() > 0) return true;');
    expect(host).toContain('if (this.deps.deferredScreens() > 0) pendingRanks.push(boxRank(SCREEN_BOX_TIER.monthly));');
    expect(src).toContain('deferredScreens: () => deferredScreenEvents.length,');
    expect(src).toContain('flushDeferredScreenEvents();');
    for (const id of ['monthly', 'shares', 'lottery-draw', 'magic']) {
      expect(SCREEN_BOX_TIER[({ 'lottery-draw': 'lotteryDraw' } as Record<string, ScreenBox>)[id] ?? (id as ScreenBox)]).toBe('lead');
      expect(src).toContain(`case '${id}':`);
    }
  });
});
