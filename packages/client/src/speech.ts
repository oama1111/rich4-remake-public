/*
 * 語音触发点探测器 —— 「before/after 状态 → 说哪一句」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * T-051 解出的是**台词表**（`(角色, 事件) → Speaking.mkf 资源号`，见 `@rich4/data`
 * 的 `speech.ts`）；本文件解的是**触发点**：什么局面下、由谁、说哪一个槽位。
 *
 * ── 原版怎么触发 ────────────────────────────────────────────────
 *
 * 原版有**两条**触发路径，本文件两条都接：
 *
 * ① **状态跃迁**（大多数事件）。调用点直接判一个局面，命中就
 *    `_rich4_player_say(玩家, flag, 串)` → 串里的 `#NNNN` → `Speaking.mkf`。
 *    例：`inPrison` 由 0 变非 0 → 事件 19（VA 0x0043d70d）。
 *
 * ② **金额分档函数**（0..14、18）。7 个发言人函数按**传入的金额**分档，
 *    档位阈值写死在函数里（本文件逐个照抄）。这些函数的调用点把
 *    「这一笔交易是多少」作为**参数**传进来，参数值不在状态里 —— 见下。
 *
 * ── 金额是从哪儿「还原」出来的 ──────────────────────────────────
 *
 * 本卡的接口是**纯函数** `speechEventsFor(before, after)`，拿不到调用点参数，
 * 所以只能从状态差分里把那一笔金额还原出来。三处对应关系（都在 exe 里可核）：
 *
 * | 原版传入的量 | 原版来源 | 本引擎里的对应字段 |
 * |---|---|---|
 * | 金钱收/付额 | 调用点把 `ebp`（过路费/罚款/命运金额）压栈传给 `fcn_0044f354/42d/567` | `monthlyReceived` / `monthlyPaid` 的**增量** |
 * | 住店天数 | `0x0041a7e0` 传 `[esp+0xd0]`，随后同一值写进 `+0x32`（`[+0x32] = 天数−1`） | `blocking.inHotel` 的增量 ⇒ `(值 & 0x7f) + 1` |
 * | 「點」值 | `0x0041b38c` 的 `card_table[…]`、`0x0041b98b` 的 `tool_table[…]`、`0x00452753` 的卡片 | `points` 的增量 |
 *
 * `monthlyReceived` / `monthlyPaid` 之所以能当金额用，是因为原版的
 * `pay_money`（VA 0x0041d2c6）**自己就把那一笔金额**累加到 `+0x60` / `+0x5c`
 * （`add dword [player*0x68 + 0x496bc8], ebx`），本引擎的 `transferMoney`
 * 是同一条（见 `rules/payment.ts` 的同 VA 注释）。故「同一动作内这两项的
 * 增量」=「原版传给发言人函数的那一笔」。
 *
 * ⚠️ `monthlyReceived` 会被**所有**走 `pay_money`/`give_money` 的钱动到，
 *    所以本文件只把它用作**分档依据**，不区分「租金 / 命运事件 / 中奖」——
 *    原版在那些调用点用的本来就是同一个函数，这样反而一致。
 *
 * ── 有意偏离（完整版见 `docs/deviations/T-052.md`）────────────────
 *
 * 1. 原版在**中间档**用 `rand() & 1` 在相邻两句里随机二选一
 *    （`call _libc_rand / and eax,1 / mov reg,[表 + eax*4]`）。本文件是纯函数、
 *    不许动 PRNG，故**一律取 `eax = 0` 那一支**（即两句话里靠前、语气更重的那句）。
 * 2. 原版 `_rich4_player_say` 是**逐句播完再返回**，本引擎的 `SoundPlayer`
 *    是即发即忘，故同一动作里派生的多句会**叠着响**（见 main.ts 的 playSoundFor）。
 * 3. ✅ **2026-09-19：事件 16/17/22/23/26 已接线**（T-052 的 Q-SPEECH-5 原先登记为「没解」）：
 *    - 16/17 需要**街區**（同一 `land.name`）—— 那是地图静态数据 `topo`，
 *      故 `speechEventsFor` 多了一个**可选**的 `topo` 实参（缺席时这条探测器不出声）；
 *    - 22/23 需要**神明种类**（`objects[godInfo−1].type`）—— 那在 `GameState` 里；
 *    - 26（開局宣言）**不经过任何 action**，由 `main.ts` 的 `startGame()` 显式播一次。
 * 4. ★ **卡牌台词不走状态差分**（2026-09-19 补）：那 26 张卡各自的
 *    `player_say(出牌者, flag, 卡牌台词表[角色][卡号-1])` 是**调用点参数**，
 *    不是状态跃迁，差分法看不见（此前整条缺失，见 gaps §7.89(2)）。
 *    现在由 core 的 `GameState.lastCardPlay` 提示字段交出来，
 *    本文件用 `cardPlaySpeech()` 翻成气泡。
 */

import {
  FORTUNE_FAKE_LOAN_ID,
  FORTUNE_PAY_TAIL_IDS,
  isAlive,
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_MASK,
  type GameState,
  type MapTopology,
  type NoticeHint,
  type Player,
} from '@rich4/core';
import {
  CARDS,
  CHARACTERS,
  MAGIC_HOUSE_TEXT,
  SPEECH_CHARACTER_COUNT,
  SPEECH_EVENTS_PER_CHARACTER,
  speechIndex,
} from '@rich4/data';
import { cardLineBubbleOf, speechBubbleOf, toolLineBubbleOf, type SpeechBubble } from './speech-bubble.ts';
import type { SpeechOrder } from './stage-gate.ts';

// ============================================================
//  对外形状
// ============================================================

/**
 * 一次命中：**由哪个玩家**说**哪个槽位**。
 *
 * `player` 是**玩家下标**（0..3，= `players` 数组下标），不是角色号 ——
 * 角色号在 `players[player].character`，由 `speechResourceFor()` 负责换算。
 */
export interface SayEvent {
  player: number;
  event: number;
  /**
   * ★ **表情号** —— 原版 `player_say` 的第 2 个实参 `arg2`（头像图号 = 它 + 1）。
   *
   * @source 0x0044f050 `mov edx,[esp+0x30] / inc edx`（读取点在两次 `push` 之后，
   *   故偏移是 `0x30` 而不是 `0x28` —— 这正是「`arg2` 没人读」那条旧结论的错处）；
   *   各调用点的实参见 `docs/tasks/speech-callsites.md` 的「实参」列第 2 项。
   *
   * ⚠️ **可选**：逐探测器的取值由并行的另一张卡（W-50 的 B 卡）填，
   *   本文件**不为它写死任何值**；缺席时 `speech-bubble.ts` 按 0 画。
   *   见 `docs/escalations.md` 的 E-18（缺口清单）。
   */
  expression?: number;
  /**
   * 这句台词在原版里排在**这一段演出之前**还是**之后**（W-51；逐条依据 = W-50 §2.2
   * 的裁定表）。`queueSpeech()` 按它决定「立即上台」还是「先押进 `deferredSpeech`」。
   *
   * ⚠️ **没有缺省值**：`DETECTORS` 里每个探测器都必须显式写一条 `order`
   *    （`SpeechDetector.order`），新加探测器漏写就编不过 —— 逼着逐条过表。
   */
  order: SpeechOrder;
  /**
   * **原样的一句字**（不查角色台词表）—— `player_say(玩家, 表情, 串)` 的第 3 个实参是
   * 字面串而不是 `[0x48084a + …]` 表项的那几处（目前只有魔法屋的「？？？...」，`0x46482f`）。
   * 给了它，`event` 就不再是槽位号（填 −1），`speech-bubble.ts` 直接拿它画、串首没有 `#NNNN` 就不放语音。
   */
  text?: string;
}

/**
 * 探测器的**原始产出**：只回答「谁说了哪一句」（+ 各探测器自带的其它可选字段，
 * 如 `expression`），**不含 `order`**。
 *
 * 写成 `Omit<SayEvent, 'order'>` 而不是另立一个字面量接口：`SayEvent` 以后再加
 * 可选字段（例：W-50 的 `expression`）时，探测器这边**自动**跟得上，不用改两处。
 *
 * 次序由 `SpeechDetector.order` 在 `speechEventsFor()` 里**一处一值**补上 ——
 * 不在每个 `push` 上重复写，避免同一个探测器里出现两个不一致的值。
 */
export type DetectedSay = Omit<SayEvent, 'order'>;

/** 只要「谁 / 哪一句」的调用方（资源换算、气泡排版）——`SayEvent` 与裸字面量都能传 */
export type SayKey = Pick<SayEvent, 'player' | 'event'>;

/** 一个探测器：名字 + 取证 VA + **原版次序** + 纯函数 */
export interface SpeechDetector {
  /** 诊断用名 */
  readonly name: string;
  /** 判据的取证点（exe VA） */
  readonly source: readonly number[];
  /**
   * 这句台词在原版里排在**这一段演出之前**还是**之后**。
   *
   * 取值只能来自 W-50 §2.2 的裁定表；表里没有的走表尾那条规则（查
   * `docs/tasks/speech-callsites.md` 同一次调用的行），两边都没有的 ⇒ 上报
   * `docs/escalations.md`。**没有缺省值**：新探测器必须自己写一条。
   */
  readonly order: SpeechOrder;
  /**
   * `before/after` 状态 → 谁说了哪几句。
   *
   * `topo` **可选**：只有「街區獨佔」那一条要它（街區归属 = 地图静态数据里的
   * `land.name`，见 `detectAreaMonopoly`）。其余探测器一律不用，缺席也不受影响。
   */
  readonly detect: (
    before: GameState,
    after: GameState,
    topo?: MapTopology,
  ) => DetectedSay[];
}

// ============================================================
//  小工具
// ============================================================

/** 两名玩家在同一动作里的一笔账：`after − before` */
function delta(
  before: GameState,
  after: GameState,
  player: number,
  field: 'monthlyPaid' | 'monthlyReceived' | 'points',
): number {
  const b = before.players[player];
  const a = after.players[player];
  if (b === undefined || a === undefined) return 0;
  return a[field] - b[field];
}

/** 在场人数 */
function aliveCount(state: GameState): number {
  return state.players.filter((p) => isAlive(p)).length;
}

/**
 * 「最敵對玩家」—— 敵意最高且**在场**的那一个；全为 0 时返回 −1。
 *
 * @source VA 0x0040d2d3 `_rich4_find_most_hostile_player`：
 * ```asm
 * max = 0; who = -1
 * for (i = 0; i < num_players; i++) {
 *   if (i == a) continue
 *   if (player[i].who_plays == 0) continue     ; 只算在场
 *   v = player[a].hostility[i]
 *   if (max < v) { max = v; who = i }          ; ★ 严格大于 ⇒ 并列取下标小的
 * }
 * ```
 */
export function mostHostilePlayer(state: GameState, player: number): number {
  const me = state.players[player];
  if (me === undefined) return -1;
  let best = -1;
  let max = 0;
  for (let i = 0; i < state.players.length; i++) {
    if (i === player) continue;
    const q = state.players[i];
    if (q === undefined || !isAlive(q)) continue;
    const v = me.hostility[i] ?? 0;
    if (max < v) {
      max = v;
      best = i;
    }
  }
  return best;
}

/** 某个 `blocking` 计数由 0 变非 0 的玩家（= 原版「新判」那一条路径） */
function enteredBlocking(
  before: GameState,
  after: GameState,
  field: keyof Player['blocking'],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (b.blocking[field] === 0 && a.blocking[field] !== 0) out.push(i);
  }
  return out;
}

// ============================================================
//  分档阈值 —— 逐个照抄 exe
// ============================================================

/** `imul eax, [0x4990e8], 0x2328` 里的 0x2328 @source VA 0x0044f36d / 0x0044f446 / 0x0044f580 */
export const MONEY_TIER_HIGH = 0x2328; // 9000
/**
 * 中档 = **5000 × 物價指數**。原版不是写死的常数，而是一串移位：
 * `ecx*5 → <<3 → −ecx → <<4 → +ecx → <<3` = `5×8=40, −1=39, ×16=624, +1=625, ×8=5000`。
 * @source VA 0x0044f396..0x0044f3b0（進帳）、0x0044f46c..0x0044f486（付錢）、
 *   0x0044f5a6..0x0044f5c0（罰款）
 */
export const MONEY_TIER_MID = 5000;
/**
 * 低档 = **2000 × 物價指數**，只有「進帳」用；
 * 「付錢 / 罰款」的最低档是 **> 0**（`test ebx,ebx / jle`）。
 * @source VA 0x0044f3e3..0x0044f3f9（進帳）、0x0044f4b9（付錢）、0x0044f5f3（罰款）
 */
export const MONEY_TIER_LOW = 2000;

/** 小额获得的两档 @source VA 0x0044f23f `cmp edx,0x64` / 0x0044f262 `cmp edx,0x32` */
export const SMALL_GAIN_HIGH = 100;
export const SMALL_GAIN_LOW = 50;

/** 小额损失的两档 @source VA 0x0044f2d1 `cmp edx,6` / 0x0044f2f4 `cmp edx,3` */
export const SMALL_LOSS_HIGH = 6;
export const SMALL_LOSS_LOW = 3;

/**
 * 進帳（事件 6/7/8）的档位。
 *
 * @source `fcn_0044f354` @ VA 0x0044f354：
 * ```asm
 * cmp ebx, 9000*物價指數 / jl 下一档 ;  → 表 +24 = 事件 6
 * cmp ebx, 5000*物價指數 / jl 下一档 ;  → 表 +24 + rand&1*4 = 事件 6|7
 * cmp ebx, 2000*物價指數 / jl 返回   ;  → 表 +32 = 事件 8
 * ```
 * 返回**事件号**（不是档位下标）。
 */
export function gainEventFor(amount: number, priceIndex: number): number | null {
  if (amount >= MONEY_TIER_HIGH * priceIndex) return 6;
  // ★ 原版此档 `call rand / and eax,1`，取 eax=0 ⇒ 事件 6（见文件头「有意偏离」1）
  if (amount >= MONEY_TIER_MID * priceIndex) return 6;
  if (amount >= MONEY_TIER_LOW * priceIndex) return 8;
  return null;
}

/**
 * 「付錢 / 罰款」（事件 9/10/11 与 12/13/14）的档位，返回 **0..2**（= 基址 + 档位）。
 *
 * @source `fcn_0044f42d` @ VA 0x0044f42d 与 `fcn_0044f567` @ VA 0x0044f567：
 * ```asm
 * cmp ebx, 9000*物價指數 / jl 下一档 ;  → 基址+0      = 事件 9 / 12
 * cmp ebx, 5000*物價指數 / jl 下一档 ;  → 基址+0|1    = 事件 9|10 / 12|13
 * test ebx, ebx / jle 返回           ;  → 基址+2      = 事件 11 / 14
 * ```
 * ★ 与「進帳」不同：**最低档是 > 0**，没有 2000 那道线。
 */
export function payTierFor(amount: number, priceIndex: number): 0 | 1 | 2 | null {
  if (amount >= MONEY_TIER_HIGH * priceIndex) return 0;
  // ★ 原版 `rand&1` → 取 0
  if (amount >= MONEY_TIER_MID * priceIndex) return 0;
  if (amount > 0) return 2;
  return null;
}

/**
 * 小额获得（事件 0/1/2）的档位，返回 **0..2**。
 * @source `fcn_0044f230` @ VA 0x0044f230：
 * `cmp edx,0x64 / jle` → 0；`cmp edx,0x32 / jle` → 0|1（rand&1，取 0）；`test edx,edx / je 返回` → 2
 */
export function smallGainTierFor(amount: number): 0 | 1 | 2 | null {
  if (amount > SMALL_GAIN_HIGH) return 0;
  if (amount > SMALL_GAIN_LOW) return 0;
  if (amount !== 0) return 2;
  return null;
}

/**
 * 小额损失（事件 3/4/5）的档位，返回 **0..2**。
 * @source `fcn_0044f2c2` @ VA 0x0044f2c2：
 * `cmp edx,6 / jle` → 0；`cmp edx,3 / jle` → 0|1（rand&1，取 0）；`test edx,edx / je 返回` → 2
 */
export function smallLossTierFor(amount: number): 0 | 1 | 2 | null {
  if (amount > SMALL_LOSS_HIGH) return 0;
  if (amount > SMALL_LOSS_LOW) return 0;
  if (amount !== 0) return 2;
  return null;
}

// ============================================================
//  探测器
// ============================================================

/**
 * 入狱 —— 事件 19「放我出去！」。
 *
 * @source `_rich4_add_player_days_in_prison` @ VA 0x0043d593：
 * ```asm
 * dh = player.days_in_prison
 * test dh, dh / jne 加刑路径          ; ★ 已经在牢里 → 只累加，不吭声
 * …搬到监狱格…
 * mov edi, [表 + 0x480896]            ; = 事件 19
 * push edi / push 2 / push player
 * call _rich4_player_say              ; @ VA 0x0043d70d
 * ```
 */
export function detectPrisonEntered(before: GameState, after: GameState): DetectedSay[] {
  return enteredBlocking(before, after, 'inPrison').map((player) => ({ player, event: 19 }));
}

/**
 * 住院 —— 事件 20「我不要打針！！」。
 * @source `_rich4_add_player_days_in_hospital` @ VA 0x0043ec3f，说在 VA 0x0043edbc
 *   （与监狱同构：`test dh,dh / jne 加刑路径`，只在**新判**时说）
 */
export function detectHospitalEntered(before: GameState, after: GameState): DetectedSay[] {
  return enteredBlocking(before, after, 'inHospital').map((player) => ({ player, event: 20 }));
}

/**
 * 夢遊卡命中 —— 事件 21「不要吵～～」。
 *
 * @source `_rich4_use_card_mengyouka` @ VA 0x0044434b：
 * ```asm
 * mov ecx, [表 + 0x48089e]            ; = 事件 21
 * push ecx / push 1 / push 目标       ; ★ 说的人是**目标**，不是出卡的人
 * call _rich4_player_say
 * setne al / add al, 4                ; 之后才把 sleepWalking 置 4|5
 * mov byte [目标 + 0x37], al
 * ```
 * 故判据是 `sleepWalking` 由 0 变非 0（由目标本人说）。
 */
export function detectDreamCard(before: GameState, after: GameState): DetectedSay[] {
  return enteredBlocking(before, after, 'sleepWalking').map((player) => ({ player, event: 21 }));
}

/**
 * 回合開始被阻 —— 事件 19/20/21 的**第二次**机会。
 *
 * ★ 这是原版说这三句的**主要**场合（与上面三个「新判」场合各说一次）：
 *   `fcn_0040c912`（VA 0x0040c912）在每个回合开始时跑，把玩家的
 *   `days_in_prison(+0x34)` / `days_in_hospital(+0x35)` / `days_sleeping(+0x36)`
 *   依次报一遍，每一条都有 **1/2 機率**配一句语音。
 *
 * @source VA 0x0040ca10→事件 19（0x480896）、0x0040ca89→事件 20（0x48089a）、
 *   0x0040cb02→事件 21（0x48089e）；冬眠那一支还要求 `dword[+0x32] == 0`（VA 0x0040cb0e）。
 *
 * 判据：`phase` 由 `turnStart` 直接落到 `turnEnd` —— 这是本引擎里
 * 「本回合不能行动」的唯一形状（`reduce.ts` 的 `case 'startTurn'` 在
 * `turnController(result) === 'skip'` 时就这么返回），其余任何 `turnEnd`
 * 都是从 `settling` / `awaitingDecision` 来的。
 *
 * ⚠️ 住宿（`inHotel`）与消失（`disappearing`）在原版**只出文字、不出语音**，
 *   故这里不产生任何事件。
 */
export function detectTurnStartBlocked(before: GameState, after: GameState): DetectedSay[] {
  if (before.phase !== 'turnStart' || after.phase !== 'turnEnd') return [];
  const p = after.players[after.currentPlayer];
  if (p === undefined || !isAlive(p)) return [];
  // ★ 第十三份試玩回報（需求方拍板「按原版」）：三句**各有 1/2 概率**，由 core 在 `startTurn` 里
  //   用同一个随机数发生器掷好（`GameState.lastBlockedSays`，`fcn_0040c912` 的三处 `call rand / test al,1`）。
  //   先前这里「计数非 0 就说」—— 一直说，且冬眠那一支只查了住宿/消失（原版 `dword [+0x32]` 连坐牢/住院一起查）。
  //   原版顺序：住宿/消失（无语音）→ 坐牢 → 住院 → 冬眠 —— core 按这个顺序掷、按这个顺序记。
  return (after.lastBlockedSays ?? []).map((event) => ({ player: p.index, event }));
}

/**
 * 破產 —— 事件 25「不過是運氣差了點～」。
 *
 * @source 破產清账函数 @ VA 0x0040d211：
 * ```asm
 * mov ecx, [表 + 0x4808ae]            ; = 事件 25
 * push ecx / push 2 / push 破产者
 * call _rich4_player_say              ; @ VA 0x0040d237
 * ```
 *
 * ★ 同一函数的**开头**（VA 0x0040d002）先数在场人数，若只剩一个就
 *   `jmp 0x40d282` **提前返回** —— 也就是说**终局那一次破产不喊事件 25**
 *   （改由事件 24 说话）。这里按「逐个处理、最后那一个不喊」还原。
 */
export function detectBankrupt(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  let alive = aliveCount(before);
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (!isAlive(b) || isAlive(a)) continue;
    alive -= 1;
    // @source 0x0040d029 / 0x0040d039：剩 0 或 1 人 → 走终局，跳过 25
    if (alive <= 1) continue;
    out.push({ player: i, event: 25 });
  }
  return out;
}

/**
 * 勝利宣言 —— 事件 24「哈哈！勝利總是在正義的一方！」。
 *
 * @source VA 0x0040d039..0x0040d060：数出「在场人数 == 1」且那唯一一个
 *   `who_plays & 1`（人类）时，由他喊事件 24（表 +0x4808aa）。
 *   随后按 `num_human_players` 是否等于 1 定终局码 2/3。
 *
 * ⚠️ 只剩电脑时原版**不喊**（`test esi,esi / jne` 走的是「全员人类出局」那条，
 *   直接置终局码 1）—— 这里照搬。
 */
export function detectVictory(before: GameState, after: GameState): DetectedSay[] {
  if (aliveCount(after) !== 1 || aliveCount(before) <= 1) return [];
  const winner = after.players.find((p) => isAlive(p));
  if (winner === undefined) return [];
  if ((winner.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_HUMAN) return [];
  return [{ player: winner.index, event: 24 }];
}

/**
 * 加蓋到頂（等級 = 5）—— 事件 15「我真佩服自己」。
 *
 * @source VA 0x00419a0e（加蓋流程）：
 * ```asm
 * inc byte [地块 + 0x1a]              ; ★ +0x1a = level（csrc/land.h）
 * …記「本月支出」、播音效…
 * cmp byte [地块 + 0x1a], 5
 * jne 跳过                            ; ★ **正好等于 5** 才说
 * mov edi, [表 + 0x480886]            ; = 事件 15
 * push edi / push 0 / push current_player
 * call _rich4_player_say
 * ```
 * 同一个槽位在 **0x0041ab4a**（建設公司免费加蓋那一路，先 `mov al,[+0x1a] / cmp al,4`）
 * 也出现。最多 5 级、`< 5` 才能续建（`fcn_0040b110`），故这一支只在
 * 「4 → 5」那一次命中。
 *
 * ★ 勘误：`@rich4/data` 的 `speech.ts` 把这一处注成「`player+0x1a == 5`」，
 *   但那条 `esi` 指的是**地块记录**（`+0x04` 是地名、`+0x1a` 是等级），
 *   不是玩家结构 —— 见 `docs/deviations/T-052.md` 的 Q-SPEECH-7。
 */
export function detectLevelFive(before: GameState, after: GameState): DetectedSay[] {
  // ★ 魔法屋「就地加蓋」到 5 级：`0x431caa` 那一支是 `0x40b110` → 大锤 → bit7 时 `0x40b0cd`
  //   → `player_say(中签者, 0, "？？？...")`（`magicPonder`），**不说**事件 15。
  if (magicHouseThisAction(before, after) !== null) return [];
  const reached =
    reachedLevelFive(before.landLevel, after.landLevel) ||
    reachedLevelFive(before.facilityLevel, after.facilityLevel);
  if (!reached) return [];
  const p = after.players[after.currentPlayer];
  if (p === undefined || !isAlive(p)) return [];
  return [{ player: p.index, event: 15 }];
}

/** 有没有哪一块刚好在这一步变成 5 级 */
function reachedLevelFive(before: readonly number[], after: readonly number[]): boolean {
  for (let i = 0; i < after.length; i++) {
    if (after[i] === 5 && before[i] !== 5) return true;
  }
  return false;
}

/**
 * 進帳 —— 事件 6/7/8（「這是我應得的！」/「我是全球首富」/「蠅頭小利～」）。
 *
 * @source 调用点 VA 0x00419fa1 / 0x00419ff0 / 0x0041a735（過路費給地主，
 *   金额 = `ebp`）、0x0040ed85（命运/新闻进账）；分档与阈值在
 *   `fcn_0044f354`（本文件 `gainEventFor`）。
 */
export function detectMoneyGained(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  // ★★ 第九份試玩回報 #6：命運 0「強制拆除房屋」的**赔款**由 `detectDemolishedHouse` 独家说。
  //   原版那一笔是 `add_money(cur, level×house_price, 1)`（`0x0044bf2f`），
  //   `monthlyReceived` 会跟着涨 ⇒ 通用「進帳」档位会开口说 6/7/8（「這是我應得的！」），
  //   而原版此刻说的是「我慘了」—— 必须让开（与 `detectSmallWealthLine` 让开同一条规矩）。
  if (demolishedHouseThisAction(before, after)) return out;
  // ★★ W-55 行 7：財神那一笔**不走**「進帳」档位这条通用路 ——
  //   小財神有它自己的出口（`0x0040ecde`，事件 8，另有 >700 与终局两道闸），
  //   大財神虽然也是调 `fcn_0044f354`，但**多一道 `≥ 5000×物價` 的闸**
  //   （`0x0040ed74`）—— 通用路按 2000×物價 就会开口，会把「原版不说」说成事件 8。
  //   ⇒ 这里让开，由 `detectSmallWealthLine` / `detectBigWealthLine` 独家负责
  //   （与 `detectPointsGained` 让开 `minigameDecline` 同一条规矩）。
  const wealthHost = wealthGodHostThisAction(before, after);
  // ★★ 第十四份試玩回報 #1 的同类排查：保險理賠那一笔原版不说（见 `insurancePayeesThisAction`）
  const insurancePayees = insurancePayeesThisAction(before, after);
  for (let i = 0; i < after.players.length; i++) {
    if (i === wealthHost) continue;
    if (insurancePayees.has(i)) continue;
    const amount = delta(before, after, i, 'monthlyReceived');
    if (amount <= 0) continue;
    const event = gainEventFor(amount, after.priceIndex);
    if (event === null) continue;
    out.push({ player: i, event });
  }
  return out;
}

/**
 * 付錢 / 罰款 —— 事件 9/10/11（給玩家）与 12/13/14（進公庫），外加 18。
 *
 * @source 兩条不同的函数：
 *   - `fcn_0044f42d` @ VA 0x0044f42d（付給另一個玩家，调用点 0x00419f67 /
 *     0x00419fe0 / 0x0041a71e / 0x0041b006）→ 事件 9/10/11；
 *   - `fcn_0044f567` @ VA 0x0044f567（罰款、醫藥費，進公庫）→ 事件 12/13/14。
 *   兩者阈值相同（9000 / 5000 />0 × 物價指數），差別只在**收款方**。
 *
 * @source 事件 18 的闸门 `fcn_0044f4ed` @ VA 0x0044f4ed：
 * ```asm
 * if (find_most_hostile_player(payer) != payee) return 0
 * if (金额 < 5000 × 物價指數)                return 0
 * if (!(rand() & 1))                         return 0
 * 说事件 18（表 +0x480892）；return 1
 * ```
 * 返回 1 时调用点**不再**调 `fcn_0044f42d` —— 即 18 **顶替** 9/10/11。
 * （原版那 1/2 機率此处确定性取「说」；见文件头「有意偏离」1。）
 *
 * 收款方的还原：同一动作里 `monthlyReceived` 涨了的那个玩家 = 收錢的人；
 * 没有人涨而公库涨了 = 進公库（罰款）。两者都不是（企业/流拍）则不吭声。
 */
export function detectMoneyPaid(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  const received = after.players.map((_, i) => delta(before, after, i, 'monthlyReceived'));
  const poolGrew = after.pool - before.pool;
  // ★★ W-55 行 7：財神發威那一笔**不走**这条路 —— 原版小財神是
  //   `fcn_0041d2c6(對手, 附身者, 金額, 1)`（`0x0040ec99`）**直接**调付款助手，
  //   那个循环里没有任何 `player_say` ⇒ 附身者自己不吭声（他的那句是事件 8，
  //   见 `detectSmallWealthLine`）。通用路会让附身者按 `monthlyPaid`/`pool` 差分
  //   开口，把「原版不说」说出来 ⇒ 这里让开。
  // ★★ W-55 行 7 的收尾（2026-09-19）：財神收錢那一拍，**付款的对手也不说话**。
  //   原版两支里能开口的只有附身者自己一句（小財神 `0x0040ecde` 事件 8 /
  //   大財神 `0x0040ed85` 走 `fcn_0044f354`），**整个收取循环里没有 `player_say`**
  //   （小財神收钱在 `0x0040ec99 call 0x41d2c6`、大財神在 `0x0040ed52 call 0x41d3f4`，
  //   两处前后都没有 `call 0x44f42d` / `0x44f567`）。
  //   先前只让开了**附身者**（他会按 `monthlyPaid` 被误判），付款方仍按
  //   `monthlyPaid` 差分说了一句泛用的「付錢」—— 原版不说 ⇒ 整条探测器让开。
  const wealthHost = wealthGodHostThisAction(before, after);
  if (wealthHost >= 0) return out;
  // 命運罰款共用尾巴那一句只给**抽到的人**、且他付完还在场（`0x0044ced1`）
  const fortunePayer = fortunePayTailThisAction(before, after) ? before.currentPlayer : -1;

  for (let i = 0; i < after.players.length; i++) {
    if (i === wealthHost) continue;
    if (i === fortunePayer && !isAlivePlayer(after, i)) continue;
    const amount = delta(before, after, i, 'monthlyPaid');
    if (amount <= 0) continue;

    let payee = -1;
    for (let j = 0; j < received.length; j++) {
      if (j !== i && (received[j] ?? 0) > 0) {
        payee = j;
        break;
      }
    }

    if (payee >= 0) {
      // @source 0x0044f4ed：最敵對玩家拿走 ≥ 5000×物價指數 → 事件 18
      if (
        payee === mostHostilePlayer(before, i) &&
        amount >= MONEY_TIER_MID * after.priceIndex
      ) {
        out.push({ player: i, event: 18 });
        continue;
      }
      const tier = payTierFor(amount, after.priceIndex);
      if (tier !== null) out.push({ player: i, event: 9 + tier });
    } else if (poolGrew > 0) {
      // ★★ 第十四份試玩回報 #1（Charles，2026-09-23）：「为什么交保险这个倒霉的事情触发的是
      //   高兴的玩家台词」—— 命運 30「付保險金」进公库，先前这里一律说 12/13/14，
      //   而那一档是**逃过一劫**的庆幸话（約翰喬「上帝保佑～」、宮本寶藏「哈哈哈，很羨慕吧！」）。
      //   `fcn_0044f567`（12/13/14）全 exe 只有 3 个调用点，**全是「这笔钱没付」**：
      //     · `0x0044ce7e` / `0x0044d028`：命運罰金被神明加持挡掉（`0x44b896` 返回 1，
      //       框「%s保佑\n\n免付罰金！」`0x4658c1`）—— 走这一支就**不**调 `pay_money`；
      //     · `0x0041d7c1`：大財神附身把费用减到 0（`0x0041d7b4 test ebx,ebx / jne`）。
      //   真付了钱的命運罰款走共用尾巴 `0x0044cec2 pay_money(cur,-1,金额,0)` →
      //   `0x0044ced1 [cur+0x15] != 0`、`0x0044cede [0x46caf8] == 0` →
      //   **`0x0044cef9 call 0x44f42d`** = 付錢那一档 9/10/11（「老本都快沒了～」…）。
      //   除此之外进公库的钱（乞丐 `0x41b686`、大窮神 `0x40f076`、新聞的稅 / 罰款、
      //   无卖家的拍卖…）原版都**不**经过 `0x44f42d` / `0x44f567` ⇒ 不说。
      if (i === fortunePayer) {
        const tier = payTierFor(amount, after.priceIndex);
        if (tier !== null) out.push({ player: i, event: 9 + tier });
      }
    } else if (companyFundsGrew(before, after)) {
      // ★★ 第八份试玩回报 #1（2026-09-22）：付給**企業**（董事長收費 / 保險費）也要说 9/10/11。
      //   先前这里「企业则不吭声」是读漏了：企業收費那一段的尾巴
      //   `0x0041b000 cmp edi,[0x49910c] / jne` → `0x0041b004 push ebp（金額）/ push eax（付款人）/
      //   0x0041b006 call 0x44f42d` —— 与付給玩家同一支阶梯函数，且它**不看收款方是谁**（只有
      //   付款人与金额两个实参）。少了这一句，訊息框 1500 ms 一到就换人，「字还没看清就下一个」。
      //   （付款人被死神顶替时 `edi != 当前玩家` ⇒ 不说 —— 那种情形付款人的 `monthlyPaid` 本来就不涨。）
      const tier = payTierFor(amount, after.priceIndex);
      if (tier !== null) out.push({ player: i, event: 9 + tier });
    }
  }
  return out;
}

/** **这一条 action** 刚抽出来的命運事件号；不是这一条抽的返回 null（判据同 `demolishedHouseThisAction`）*/
function fortuneIdThisAction(
  before: Pick<GameState, 'lastEvent'>,
  after: Pick<GameState, 'lastEvent'>,
): number | null {
  const ev = after.lastEvent ?? null;
  if (ev === null || ev.kind !== 'fortune' || before.lastEvent === ev) return null;
  return ev.id;
}

/** 命運罰款共用尾巴那一族（`FORTUNE_PAY_TAIL_IDS`，逐条 `@source` 在 core）是不是这一条抽的 */
function fortunePayTailThisAction(
  before: Pick<GameState, 'lastEvent'>,
  after: Pick<GameState, 'lastEvent'>,
): boolean {
  const id = fortuneIdThisAction(before, after);
  return id !== null && FORTUNE_PAY_TAIL_IDS.has(id);
}

function isAlivePlayer(state: GameState, i: number): boolean {
  const p = state.players[i];
  return p !== undefined && isAlive(p);
}

/**
 * 这一条 action 里**拿到保險理賠**的人（下标集合）。
 *
 * `fcn_0044ba63`（保險理賠）只有一个 `sprintf` + 訊息框（`0x4658fa`「保險期間\n\n得到理賠金\n\n%d元」，
 * 2000 ms）+ `pay_money(保險公司, 玩家, 損失, 1)`（`0x0044bad8`），**没有** `player_say`；
 * 它的 6 个调用点（`callers 0x44ba63`）前后也都不调「進帳」档位函数 `0x44f354` ⇒ 原版**不说**。
 * 而 `pay_money` 照样把这笔记进 `+0x60`（本月意外之財）⇒ 通用「進帳」路会把它当成進帳，
 * 说出「這是我應得的！」/「蠅頭小利～」—— 坐牢、住院、罰款之后冒一句高兴话。必须让开。
 *
 * 认人：保險期（`insuranceDays`）在动作前非 0，且这一条是会理赔的那几种：
 *   - 命運罰款尾巴（`0x0044cf11`）与冒貸（`0x0044c218`）→ 抽到的人；
 *   - 住旅館（`0x0041a82d` / `0x0040d425`）、坐牢（`0x0043d749`）、住院（`0x0043edf8`）→ 刚进去的人。
 */
function insurancePayeesThisAction(before: GameState, after: GameState): Set<number> {
  const out = new Set<number>();
  const insured = (i: number): boolean => (before.players[i]?.insuranceDays ?? 0) !== 0;
  const id = fortuneIdThisAction(before, after);
  if (id !== null && (FORTUNE_PAY_TAIL_IDS.has(id) || id === FORTUNE_FAKE_LOAN_ID) && insured(before.currentPlayer)) {
    out.add(before.currentPlayer);
  }
  for (const field of ['inPrison', 'inHospital', 'inHotel'] as const) {
    for (const i of enteredBlocking(before, after, field)) if (insured(i)) out.add(i);
  }
  return out;
}

/** 这一条 action 里有哪家企業的資金涨了（= 钱付给了企業）*/
function companyFundsGrew(before: GameState, after: GameState): boolean {
  const a = after.companyFunds ?? [];
  const b = before.companyFunds ?? [];
  for (let k = 0; k < a.length; k++) if ((a[k] ?? 0) > (b[k] ?? 0)) return true;
  return false;
}

/**
 * 旅館住宿的小额损失 —— 事件 3/4/5。
 *
 * @source 設施落点结算 VA 0x0041a7d7..0x0041a7e0：
 * ```asm
 * cmp edi, [0x49910c] / jne 跳过      ; 付款的就是当前玩家才说
 * push [esp+0xd0]                     ; ★ 金额 = **住店天数**
 * push current_player
 * call fcn_0044f2c2                   ; 阈值 6 / 3（VA 0x0044f2d1 / 0x0044f2f4）
 * …随后 [player+0x32] = 天数 − 1（为 0 时挂 0x80）
 * ```
 * 天数由 `(+0x32 & 0x7f) + 1` 反推（`displayDays`）——0x80 表示「住 1 天」。
 *
 * ⚠️ `fcn_0044f2c2` 另有三个调用点传的是**钱**而不是天数
 *   （監獄 0x0043d5f9 / 醫院 0x0043eca5 / 0x0040d3f8）；那几笔在
 *   before/after 里与其它扣款无法区分，故未接（见偏离登记）。
 */
export function detectHotelStay(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  for (const i of enteredBlocking(before, after, 'inHotel')) {
    const raw = after.players[i]?.blocking.inHotel ?? 0;
    const days = (raw & 0x7f) + 1;
    const tier = smallLossTierFor(days);
    if (tier === null) continue;
    out.push({ player: i, event: 3 + tier });
  }
  return out;
}

/**
 * 「點」入帳 —— 事件 0/1/2（「別忌妒我！」/「鴻運當頭！」/「運氣不差！」）。
 *
 * @source `fcn_0044f230` @ VA 0x0044f230（阈值 100 / 50 @ 0x0044f23f / 0x0044f262）。
 *   调用点传进来的都是**表里的「點」值**而不是现金：
 *   - `0x0041b38c`：`al = byte [ebx*8 + (card_table − 3)]` （卡片）
 *   - `0x0041b98b`：`al = byte [ebx*8 + (tool_table − 3)]` （道具）
 *   - `0x00452753`：`_rich4_receive_card` 之后取同一個卡片字段
 *   本引擎里对应的量就是 `points` 的增量（商店回购、魔法屋、點數格……）。
 */
export function detectPointsGained(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  // ★ 魔法屋「變賣所有卡片 / 道具」：`0x431caa` 那两支直接 `add word [player+0x30], ax`
  //   （0x00431d3d），不经过 `fcn_0044f230` ⇒ 原版这一笔**不说话**。
  if (magicHouseThisAction(before, after) !== null) return out;
  // ★★ 2026-09-19（第 94 条）：**得點券格 / 小遊戲不玩**那两笔「點入帳」不走 `0x44f230`，
  //   它们各自 `player_say(玩家, 0, 角色表事件)`（`0x41b1f8` / `0x41b28d` / `0x4154b6`），
  //   由下面的 `pointsSquarePhrase` 开口。这里必须**让开**，否则同一笔会说两句
  //   （而且 `0x44f230` 的档位表与角色台词表本来就是两套词）。
  if (pointsSquareEventThisAction(before, after) !== null) return out;
  for (let i = 0; i < after.players.length; i++) {
    const amount = delta(before, after, i, 'points');
    if (amount <= 0) continue;
    const tier = smallGainTierFor(amount);
    if (tier === null) continue;
    out.push({ player: i, event: tier });
  }
  return out;
}

/**
 * 「得點券」格 / 小遊戲「不玩」那两笔的台词 —— 用**角色台词表**而不是 `0x44f230` 的档位表。
 *
 * @source `0x0041b211` / `0x0041b29e`（得點券格）、`0x004154b6`（小遊戲不玩）三处都是
 *   `player_say(玩家, 0, [角色*0x6c + 事件*4 + 0x48084a])`。
 *   core 把选中的**事件下标**交在 `lastEvent.phraseIndex` 里：
 *     得 50 點 = `rand() & 1`（事件 0/1）、得 30 點 = **固定事件 2**、得 10 點 = 不说。
 */
export function detectPointsSquarePhrase(before: GameState, after: GameState): DetectedSay[] {
  const ev = pointsSquareEventThisAction(before, after);
  if (ev === null) return [];
  return [{ player: after.currentPlayer, event: ev.phraseIndex ?? 0 }];
}

/**
 * **这一条 action** 写下的「得點券格 / 小遊戲不玩」事件；不是这一条写的返回 null。
 *
 * ★★ 判据必须是 `before.lastEvent !== after.lastEvent`（**引用不同**，规矩同 `lastCardPlay`）：
 *   `lastEvent` **不是**瞬态字段 —— core 写下之后它一直留到下一个事件（得 10 點那一支
 *   还故意不写，见 `reduce.ts` 的 `phraseIndex === undefined`）。先前这里只看 `after`
 *   （`void before`）⇒ 踩过一次得點券格之后，**之后每一条 action（每走一格）都重说一遍**，
 *   直到别的事件把 `lastEvent` 顶掉（试玩回报：「台词一直在重复播放」）；
 *   同一个毛病还让 `detectPointsGained` 在那段时间里**一直闭嘴**。
 */
function pointsSquareEventThisAction(
  before: Pick<GameState, 'lastEvent'>,
  after: Pick<GameState, 'lastEvent'>,
): NonNullable<GameState['lastEvent']> | null {
  const ev = after.lastEvent ?? null;
  if (ev === null || ev.kind !== 'minigameDecline') return null;
  if (before.lastEvent === ev) return null;
  return ev;
}

/**
 * ★★ 第九份試玩回報 #6（Charles，2026-09-22）：
 *   「强制拆除房屋一栋，完全没看到到底拆了哪里的房子，如果是真的拆了，
 *     那房屋主人应该也会触发一个倒霉的台词」。
 *
 * 查證：core 那邊**根本沒拆**（事件 0/1 是 `factor: null`，直接 `unimplemented`），
 * 已由 `fortune-effects.ts` 补上（含镜头）。這一條补的是**台词**。
 *
 * @source `0x0044bf9f call 0x44ef41`：`player_say(current_player, 2, 台词[rand()&1])`
 *   —— 槽 3/4 =「我慘了」/「唉呦喂呀」，`packages/data/src/speech.ts:137,139`
 *   （`sites` 里就含 `0x0044bf8e`；调用点清单 `docs/tasks/speech-callsites.md:98` 第 91 条）。
 *   房主 = **抽到命運的人自己**，不是别家。
 *   原版排在 `sleep 300`（`0x0044bf5e`）与镜头复位（`0x0044bf51`）**之后** ⇒ `afterStage`。
 *
 * ⚠️ 原版那一次 `rand()&1` 本引擎**没照抄**（台词二选一不走 core）⇒ 固定取槽 3。
 *   与 `speech.ts` 文件头「有意偏离」同一条口径，另见 PR 描述。
 */
export function detectDemolishedHouse(before: GameState, after: GameState): DetectedSay[] {
  const ev = demolishedHouseThisAction(before, after);
  if (ev === null) return [];
  return [{ player: after.currentPlayer, event: 3, expression: 2 }];
}

/**
 * ★★ 第十二份試玩回報（「龙卷风摧毁房屋没有看到具体哪个房子受影响」）：
 *   新聞「随机挑一处建筑」那一族里，挑中那一处**有主**时，房主说一句倒霉台词。
 *
 * @source 四个函数的尾巴同一个形状（以新聞 21 `fcn_0044ac99` 为例）：
 * ```asm
 * 0044ae4a  mov  eax, [0x48c5a0]          ; pass 0 存下的 owner（1 基，改之前）
 * 0044ae4f  test eax, eax / je 0x44ab21   ; ★ 无主 ⇒ 不说
 * 0044ae57  dec  eax / imul eax, 0x68     ; 房主的玩家记录
 * 0044ae5d  mov  dl, [eax + 0x496b7b]     ; 角色号
 * 0044ae74  call 0x456f2d / and eax, 1    ; rand() & 1
 * 0044ae7c  mov  edx, [ebx + eax*4 + 0x480856]   ; 角色台词表 +0xc ⇒ **事件 3 / 4**
 * 0044ae84  push edx / jmp 0x44ab10       ; → push 2 / push owner−1 / call 0x44ef41
 * ```
 *   新聞 5（`0x0044948e`..`0x004494cd`）、15（`0x0044a58f`..`0x0044a5c3`）、
 *   19（`0x0044aad7`..`0x0044ab19`）同一张表 `0x480856`、同一个 `push 2`。
 *   新聞 20「超級颱風」**没有**这一段（`0x0044ac87` sleep 500 之后直接返回）。
 *
 * ⚠️ 与命運 0（`detectDemolishedHouse`）同一条「有意偏离」：那一次 `rand()&1` 本引擎
 *   **不照抄**（台词二选一不走 core，不动 RNG 流）⇒ 固定取事件 3。
 */
export function detectNewsPlaceOwner(before: GameState, after: GameState): DetectedSay[] {
  const ev = after.lastEvent ?? null;
  if (ev === null || ev.kind !== 'news' || before.lastEvent === ev) return [];
  if (!NEWS_PLACE_OWNER_LINE.has(ev.id)) return [];
  const owner = ev.place?.owner ?? 0;
  const who = after.players[owner - 1];
  // ★ `player_say` 开头那三道闸（消失 / 梦游 / 冬眠的人不出声）
  if (owner === 0 || who === undefined || !speechGatesOpen(who)) return [];
  return [{ player: owner - 1, event: 3, expression: 2 }];
}

/** 尾巴有「房主说一句」的那几条新聞 @source 见 `detectNewsPlaceOwner` */
export const NEWS_PLACE_OWNER_LINE: ReadonlySet<number> = new Set([5, 15, 19, 21]);

/**
 * 这一条 action 写下的「命運 0 強制拆除房屋」事件；不是这一条写的返回 null。
 *
 * ★ 判据是 `before.lastEvent !== after.lastEvent`（**引用不同**）—— 与
 *   `pointsSquareEventThisAction` / `lastCardPlay` 同一条规矩：`lastEvent` 不是瞬态字段，
 *   只看 `after` 会让这一句在之后每一条 action 上重说一遍。
 */
function demolishedHouseThisAction(
  before: Pick<GameState, 'lastEvent'>,
  after: Pick<GameState, 'lastEvent'>,
): NonNullable<GameState['lastEvent']> | null {
  const ev = after.lastEvent ?? null;
  if (ev === null || ev.kind !== 'fortune' || ev.id !== 0) return null;
  if (before.lastEvent === ev) return null;
  return ev;
}

/**
 * 同一街區獨佔 ≥ 3 塊 —— 事件 16「我是個大地主」/ 17「我要稱霸一方了」。
 *
 * ── 原版判据（逐个照抄）─────────────────────────────────────────
 *
 * `fcn_0044f627`（VA 0x0044f627）的入参是 **(第 1 参) 那一块地的名字串**、
 * **(第 2 参) 一个旗标**；函数体：
 *
 * ```asm
 * 0044f636  ebx = [0x498e84] (+0x34 = 地块表项 1)   ; 住宅地表，步长 0x34
 * loop:                                             ; esi = 1 .. [0x498e98](num_lands)
 * 0044f64c  call 0x458370                           ; ★ strcmp(land_i + 4, 第 1 参)
 * 0044f656  jne 下一个                              ;   名字不同 → 不算
 * 0044f658  al = byte [ebx + 0x19]                  ; ★ land.owner（1 基，map-format.md §4.2）
 * 0044f65b  edx = [0x49910c] + 1                    ;   当前玩家 + 1
 * 0044f662  cmp eax, edx / jne 下一个
 * 0044f666  edi++                                   ; 计数
 * 0044f66a  cmp edi, 3 / jl 返回                     ; ★ ≥ 3 才开口
 * 0044f677  test 第 2 参,第 2 参 / je 说事件 16
 * 0044f67b  call rand / idiv 3                      ; ★ 1/3 機率
 * 0044f68e  test edx,edx / jne 返回
 * 0044f6ab  …说 [0x48088e] = 事件 17
 * 0044f6d5  …说 [0x48088a] = 事件 16
 * ```
 *
 * 两个调用点（`callers 0x44f627`，各只有一处，且即时数写死）：
 *
 * | 调用点 | 第 2 参 | 那一步写的是哪个字段 | 出声 |
 * |---|---|---|---|
 * | `0x00419a31` | `push 1`（`0x00419a2b`） | `inc byte [land+0x1a]`（**等級**，`0x004199d1`）| 17（1/3）|
 * | `0x0041a13e` | `push 0`（`0x0041a138`） | `mov byte [land+0x19], 玩家+1`（**歸屬**，`0x0041a0de`）| 16 |
 *
 * 即：**買下一块无主地** → 16；**在自己的地上加蓋**（且没到 5 級）→ 17
 * （到 5 級那一支在 `0x004199eb cmp byte [esi+0x1a],5 / jne 0x419a2b` 处
 * 改说事件 15，故 17 只在 `等級 ≠ 5` 时说）。
 * `0x44f627` 的 `rand()%3` 与其余中间档一样**确定性取「说」**（Q-SPEECH-3）。
 *
 * ── 街區号从哪来 ─────────────────────────────────────────────
 *
 * 原版数的就是**同名**（`strcmp(land+4, …)`），而 `land.name`
 * （`+0x04`，Big5；map-format.md §4.2 / `LandInfo.name`）正是 `GameState`
 * **没有**、`topo.lands` 才有的那一位。实测 8 张图的地块名确实是成区的
 * （地图 0：`台北市` = 地块 1..4、`桃園市` = 5..8 …），故「街區号」=
 * 地块名的等价类 —— 不需要另加一个 id。
 *
 * @source VA 0x0044f627（判据）、0x00419a2b / 0x00419a31（17）、
 *   0x0041a138 / 0x0041a13e（16）、0x00458370（strcmp）
 */
export function detectAreaMonopoly(
  before: GameState,
  after: GameState,
  topo?: MapTopology,
): DetectedSay[] {
  // 只有「落点问出来的買地 / 加蓋」这两个交互会走到 `fcn_0044f627`
  // （卡片、拍賣、新聞那几条改归属的路都不经过它 —— 故这里必须先卡住 pending）
  const pend = before.pending;
  if (pend === null || (pend.kind !== 'buyLand' && pend.kind !== 'upgradeLand')) return [];
  const lands = topo?.lands;
  if (lands === undefined || lands.length === 0) return [];

  const player = after.currentPlayer;
  const landId = pend.landId;
  const tpl = lands.find((l) => l.id === landId);
  if (tpl === undefined) return [];
  const name = tpl.name;
  if (name === '') return [];

  if (pend.kind === 'buyLand') {
    // 归属真的易主了才算出声（`mov byte [esi+0x19], al` @ 0x0041a0de）
    if ((before.landOwner[landId] ?? 0) === player + 1) return [];
    if ((after.landOwner[landId] ?? 0) !== player + 1) return [];
  } else {
    // 加蓋一级（`inc byte [esi+0x1a]` @ 0x004199d1）；恰好到 5 級 ⇒ 那一步说 15
    if ((after.landLevel[landId] ?? 0) !== (before.landLevel[landId] ?? 0) + 1) return [];
    if ((after.landLevel[landId] ?? 0) === 5) return [];
  }

  let owned = 0;
  for (const l of lands) {
    if (l.name !== name) continue;
    if ((after.landOwner[l.id] ?? 0) === player + 1) owned += 1;
  }
  if (owned < 3) return [];
  return [{ player, event: pend.kind === 'buyLand' ? 16 : 17 }];
}

// ============================================================
//  神明 —— 22 / 23
// ============================================================

/**
 * 会让玩家喊「別鬧了！」（22）与「一場惡夢～」（23）的神明**種類**。
 *
 * ★ 是 `objects_info[槽].type`（1..18），**不是** `godInfo` 那个槽位号。
 *   五条 `player_say` 的取串点（byte 级 `find a2084800` 命中 5 处）分别落在
 *   種類 5/6/7/8/15 的實作，而 22 的串表位移 `0x4808a2` = `0x48084a + 22×4`：
 *
 * | 種類 | 名稱 | `god_activate` 跳表（`0x40ea9b`，索引 = 種類−1）| 说 22 的取串 VA |
 * |---|---|---|---|
 * | 5 | 小窮神 | `[4] = 0x40ef1b` | 0x0040ef2f |
 * | 6 | 大窮神 | `[5] = 0x40efe4` | 0x0040eff8 |
 * | 7 | 小衰神 | `[6] = 0x40f083` | 0x0040f097 |
 * | 8 | 大衰神 | `[7] = 0x40f155` | 0x0040f169 |
 * | 15 | 死神 | `[14] = 0x40f2eb` | 0x0040f2ff |
 *
 * 23 的串表位移 `0x4808a6` = `0x48084a + 23×4`，取串点在 **`0x40e64a`**，
 * 而那一支的门槛就是 `0040e618..0x40e62f` 的 `cmp ebp,5/6/7/8/0xf`
 * （`ebp` = `objects_info[槽].type`）—— 与上表同一集合。
 *
 * @source `0x0040ea9b`（跳表，15×4 字节）、`0x0040e618`–`0x0040e64a`、
 *   上面 5 个取串 VA（`tools/disasm.py find a2084800`）
 */
export const HOSTILE_GOD_TYPES: readonly number[] = [5, 6, 7, 8, 15];

/** `objects[handle − 1].type`；handle 为 0 或越界时返回 `null` */
function godTypeOf(state: GameState, handle: number): number | null {
  if (!Number.isInteger(handle) || handle <= 0) return null;
  const obj = state.objects[handle - 1];
  return obj === undefined ? null : obj.type;
}

/**
 * 神明**离身** —— 事件 23「一場惡夢～」。
 *
 * @source `0x40e32c`（带演出动画的送神；`callers 0x40e32c` 共 3 处）：
 *
 * ```asm
 * 0040e34f  ebp = objects_info[god_info−1].type          ; ★ 种类，不是槽位
 * 0040e356  cmp dword [player + 0x32], 0                 ; ★ +0x32..0x35 一次读四个
 * 0040e35d  je 0x40e36e                                  ;   全 0 才走动画/台词
 * 0040e361  call 0x40e14d                                ;   有一个非 0 → 只拆、不吭声
 * …（动画）…
 * 0040e604  call 0x40e14d                                ; 真正拆下来
 * 0040e618  cmp ebp,5 / 6 / 7 / 8 / 0xf                  ; ★ 只有这五种
 * 0040e64a  ecx = [表 + 108×角色 + 0x4808a6]             ; = 事件 23
 * 0040e659  call 0x44ef41(player, 2, 串)
 * ```
 *
 * 三个调用点：`0x40eb3f`（`god_activate` 里「已有神明 → 先送走旧的」，
 * 即**换神**）、`0x41cc9b`（`0x41c84f` 的回合边界任期递减到 0 = **任期届满**）、
 * `0x444cc4`（**送神符**，卡 22）。三条都说这同一句。
 *
 * ★ **破产不算**：`0x40cd87` 走的是 `0x40ce40`/`0x40ce62` 的裸 `0x40e14d`
 *   （`0x40e32c` 的调用点里没有它）—— 所以破产者死后的 `godInfo → 0`
 *   **不说话**。故这里要求 `after` 里那个人还活着（`isAlive`）。
 *
 * ★ `[player+0x32]` 是**一个 dword 比较**，覆盖
 *   `inHotel(+0x32) / disappearing(+0x33) / inPrison(+0x34) / inHospital(+0x35)` ——
 *   这四个里任何一个非 0 都不出声；再加 `player_say` 自己的两道闸
 *   （`+0x37 sleepWalking` / `+0x36 sleeping`，VA 0x44ef86 / 0x44ef93）。
 */
export function detectGodLeft(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (b.godInfo === 0 || b.godInfo === a.godInfo) continue;
    const type = godTypeOf(before, b.godInfo);
    if (type === null || !HOSTILE_GOD_TYPES.includes(type)) continue;
    if (!isAlive(a)) continue;
    const bl = a.blocking;
    if (
      bl.inHotel !== 0 ||
      bl.disappearing !== 0 ||
      bl.inPrison !== 0 ||
      bl.inHospital !== 0 ||
      bl.sleepWalking !== 0 ||
      bl.sleeping !== 0
    ) {
      continue;
    }
    out.push({ player: i, event: 23 });
  }
  return out;
}

/**
 * 神明**附身** —— 事件 22「別鬧了！」。
 *
 * @source `god_activate`（VA 0x0040ead7）的共用尾声：
 * ```asm
 * 0040eb55  player.god_info = 槽位 + 1                   ; ★ 先写进玩家结构
 * 0040ebcc  add word [player + 0x44/0x46/0x48], 表[type]
 * 0040ec0d  jmp dword [（type−1）×4 + 0x40ea9b]          ; ★ 跳进該種類的實作
 * ```
 * 而 5/6/7/8/15 这五支的**开头第一件事**就是把事件 22 说出来
 * （五处取串 VA 见 `HOSTILE_GOD_TYPES`；第一个实参是
 * `mov eax,[esp+0x9c]` —— 两次 `push` 之后它正是 `player`，再 `or ah,0x80`
 * 置「不重设视窗卷动」位，见 `player_say` 的 `0x44ef63 test byte [esp+0x25],0x80`）。
 *
 * 附身的三条路都经过 `god_activate`（`callers 0x40ead7` 共 3 处）：
 * 踩到神明图（`0x41b82d`）、請神符（`0x444f18`）、魔法屋召喚死神
 * （`spawn_object` 内 `0x40e0d4`）—— 三条都说。
 *
 * 判据：`godInfo` **换成了另一个非 0 的值**（换神也算，`0x40eb35` 那一支
 * 先送旧神、再附新神）。`player_say` 的三道闸照抄（`disappearing` /
 * `sleepWalking` / `sleeping`）。
 */
export function detectGodArrived(before: GameState, after: GameState): DetectedSay[] {
  const out: DetectedSay[] = [];
  for (let i = 0; i < after.players.length; i++) {
    const b = before.players[i];
    const a = after.players[i];
    if (b === undefined || a === undefined) continue;
    if (a.godInfo === 0 || a.godInfo === b.godInfo) continue;
    const type = godTypeOf(after, a.godInfo);
    if (type === null || !HOSTILE_GOD_TYPES.includes(type)) continue;
    const bl = a.blocking;
    if (bl.disappearing !== 0 || bl.sleepWalking !== 0 || bl.sleeping !== 0) continue;
    out.push({ player: i, event: 22 });
  }
  return out;
}

// ============================================================
//  神明落脚顯靈的台词 —— 土地公 / 福神（W-55 行 6）
// ============================================================

/**
 * 神明**种类**（`objects[godInfo−1].type`）—— 財神那两支（W-55 行 7）。
 *
 * @source `0x0040ea9b`（`god_activate` 的 15 项跳表，索引 = 種類 − 1）：
 *   种类 1 = 小財神（`fcn_0040ec14`）、2 = 大財神（`fcn_0040f0xx` 前一项）。
 *   ⚠️ 不在本文件里 import `@rich4/core` 的 `GOD_SMALL_WEALTH` —— 那个模块
 *   （`rules/god-power.ts`）**没有**从 core 的 barrel 导出，而 `GOD_SMALL_LUCK`
 *   那四个名字在 `rules/god-toll.ts` 里**重名**，整包 `export *` 会撞名。
 *   与 `HOSTILE_GOD_TYPES` 一样，本文件按值直写并附 VA。
 */
export const SMALL_WEALTH_GOD_TYPE = 1;
export const BIG_WEALTH_GOD_TYPE = 2;

/** 小財神说那句额外台词的金额下限 —— 原版是 `esi > 0x2bc`（**严格大于 700**）@source VA 0x0040eca4 */
export const SMALL_WEALTH_LINE_MIN = 0x2bc;

/**
 * `player_say` 开头的三道闸（`0x44ef63`–`0x44ef9a`，全部 `jne → ret`）：
 * `+0x33 days_disappearing` / `+0x37 days_sleep_walking` / `+0x36 days_sleeping`。
 *
 * @source 见 `cardPlaySpeech()` 的文件头引用（同一段汇编）。
 *   （**不在**里面的：監獄 `+0x34` / 醫院 `+0x35` / 住宿 `+0x32`。）
 */
function speechGatesOpen(p: Player): boolean {
  const b = p.blocking;
  return b.disappearing === 0 && b.sleepWalking === 0 && b.sleeping === 0;
}

/** `after.notices` 里比 `before` 多出来的那种訊息框有几条 */
function newNoticeCount(
  before: { notices: readonly NoticeHint[] },
  after: { notices: readonly NoticeHint[] },
  key: string,
): number {
  const count = (ns: readonly NoticeHint[]): number => ns.filter((n) => n.key === key).length;
  return count(after.notices) - count(before.notices);
}

/**
 * 土地公顯靈 —— 事件 **0**「…」（角色台词表 `[角色][0]`）。
 *
 * @source `fcn_0040f381` 的土地公那一支（`0x0040f68b`，`god_info == 12`）尾段：
 * ```asm
 * 0040f86e  push 0x5dc / push 0x4634f2 / call 0x440cac   ; 訊息框「土地公顯靈」（= god.seize）
 * 0040f880  edi = [0x49910c]                             ; ★ 当前行动者
 * 0040f889  mov al, byte [eax + 0x496b7b]                ; +0x13 = 角色号
 * 0040f8a0  mov ebp, [eax + ebx*8 + 0x48084a]            ; ★ 角色台词表[角色][事件 0]
 * 0040f8a8  push 0                                         ; arg2（表情号）= 0
 * 0040f8ab  call 0x44ef41                                  ; player_say
 * ```
 * ⇒ **固定事件 0**，与福神那支的 `rand()&1` 不同（见 `docs/escalations.md` E-18 的订正）。
 *
 * 判据 = `notices` 里**新出现** `god.seize`（原版那一句紧跟訊息框之后；
 * 与 `devil-fx.ts` 的 `god.demolish` 同一条做法）。**不看等级/归属差分** ——
 * 土地公只看「不是我的 ⇒ 归我」，与等级无关。
 */
export function detectLandGodLine(before: GameState, after: GameState): DetectedSay[] {
  if (newNoticeCount(before, after, 'god.seize') <= 0) return [];
  const p = after.players[after.currentPlayer];
  if (p === undefined || !isAlive(p)) return [];
  if (!speechGatesOpen(p)) return [];
  return [{ player: p.index, event: 0 }];
}

/**
 * 福神顯靈（**没到 5 级**那一支）—— 事件 **0 或 1**，由 core 交出来的 `rand()&1` 选。
 *
 * @source `fcn_0040f8be` 的 `0x0040fa30`–`0x0040fa5c`：
 * `call 0x456f2d`（rand）→ `and eax,1` → `mov esi,[角色台词表 + eax*4]` → `player_say`。
 * core 已经把那次 `rand()` 消费掉、结果放在 `GameState.lastGodLine`（见该字段注释）。
 *
 * ★ **判据是引用相等**（与 `cardPlaySpeech` 同一条）：`luckyGodBonus` 每次新建一个对象，
 *   上一条 action 留下的那个引用不变 ⇒ 不出声。
 *
 * ⚠️ **到 5 级那一支不在这里**：`0x0040fa13` 取的是 `0x480886` = **事件 15**
 *   （`push 0` 也是它的 arg2），那一条已由 `detectLevelFive`（`0x00419a0e` /
 *   `0x0041ab4a`）在同一个 action 里说出 —— 两处都接会重复说一句。
 */
export function detectLuckyGodLine(before: GameState, after: GameState): DetectedSay[] {
  const hint = after.lastGodLine ?? null;
  if (hint === null || before.lastGodLine === hint) return [];
  const p = after.players[hint.player];
  if (p === undefined || !isAlive(p)) return [];
  if (!speechGatesOpen(p)) return [];
  return [{ player: hint.player, event: hint.event }];
}

/**
 * 董事長蒞臨商店的贈禮（W-67-a）—— 事件走**「好消息」档位阶梯** `fcn_0044f230`。
 *
 * @source `_rich4_ui_shop_entry` `0x0042ea23`：`call 0x44f230(玩家, 那件的點數价)`。
 *   ★ 入参是**點數价**（`toolPrice` / `cardPrice`），不是现金价 —— 商店里买东西
 *     花的就是點數。
 *
 * 判据 = `after.lastShopGift` 与 `before` **引用不同**（core 只在真的送成时才写，
 * 规矩同 `lastCardPlay`）。事件号用同一支阶梯 `smallGainTierFor`（阈值 100 / 50）。
 */
export function detectShopGift(before: GameState, after: GameState): DetectedSay[] {
  const hint = after.lastShopGift ?? null;
  if (hint === null || before.lastShopGift === hint) return [];
  const p = after.players[after.currentPlayer];
  if (p === undefined || !isAlive(p)) return [];
  if (!speechGatesOpen(p)) return [];
  const tier = smallGainTierFor(hint.points);
  if (tier === null) return [];
  return [{ player: p.index, event: tier }];
}

/**
 * 福神附身得卡之后那句「好消息」（第八份试玩回报 #5）。
 *
 * @source `0x0040ee39 mov al,[ebx+0x47fdef]`（那张卡的**點數价**）→ `0x0040ee46 call 0x44f230(玩家, 點數价)`。
 * 档位阈值 100 / 50 与 `detectShopGift` 同一支阶梯。
 *
 * ★★ 2026-09-22 订正（大福神那一条）：先前这里写「大福神两张 ⇒ 两句」并逐条按**各自**的点数价取档，
 *   **与 exe 不符**。原版大福神（`fcn_0040ee50`）把两张卡的 `+0x47fdef` **相加**
 *   （`0x0040eefb`-`0x0040ef0c`），`0x44f230` **只叫一次** ⇒ **一句**、档位按**和**取
 *   （`0040ef16 jmp 0x40ee46 → call 0x44f230`）。
 *   ⇒ 现在两种 notice 都认：`god.gotCard`（一卡，用它的点数价）与
 *     `god.gotCardTwo`（大福神两卡，**用两张卡点数价的和**，且只产出一句）。
 *
 * 判据 = 这一条 action 新写的 `notices`（`cardId` / 两个卡名由 core 交下来）。
 */
export function detectGodCard(before: GameState, after: GameState): DetectedSay[] {
  if (after.notices === before.notices) return [];
  const p = after.players[after.currentPlayer];
  if (p === undefined || !isAlive(p) || !speechGatesOpen(p)) return [];
  const out: DetectedSay[] = [];
  const priceOf = (id: number): number => CARDS.find((c) => c.id === id)?.price ?? 0;
  for (const n of after.notices) {
    // 一卡（小福神 / 大福神只拿到一张）：用它自己那张的点数价
    if (n.key === 'god.gotCard') {
      if (n.cardId === undefined) continue;
      const tier = smallGainTierFor(priceOf(n.cardId));
      if (tier !== null) out.push({ player: p.index, event: tier });
      continue;
    }
    // ★★ 大福神两张：`0x463353` 那一扇的 `args` 是**两张卡名**（不含神明名），
    //   原版按两张的點數价**和**取一次档、只叫一次 `0x44f230` ⇒ 这里也只产出一句。
    if (n.key === 'god.gotCardTwo') {
      const ids = n.args.map((name) => CARDS.find((c) => c.name === name)?.id).filter((v): v is number => v !== undefined);
      if (ids.length === 0) continue;
      const tier = smallGainTierFor(ids.reduce((sum, id) => sum + priceOf(id), 0));
      if (tier !== null) out.push({ player: p.index, event: tier });
    }
  }
  return out;
}

// ============================================================
//  財神的额外台词 —— 小財神 / 大財神（W-55 行 7 / G33 / G34）
// ============================================================

/** 这一条 action 里神明發威的金额提示（`GameState.lastGodPower`，引用相等 = 本 action）*/
function godPowerHintThisAction(
  before: Pick<GameState, 'lastGodPower'>,
  after: Pick<GameState, 'lastGodPower'>,
): { player: number; type: number; amount: number } | null {
  const hint = after.lastGodPower ?? null;
  if (hint === null || before.lastGodPower === hint) return null;
  return hint;
}

/**
 * 这一条 action 里**財神**發威的那位附身者下标；不是財神就 −1。
 *
 * 用途：让通用的「進帳 / 付錢」两条探测器**让开**財神那一笔（见 `detectMoneyGained`
 * 的注释）。**只让財神（種類 1/2）**—— 窮神那两支的通用台词过说与否不属本卡范围。
 */
function wealthGodHostThisAction(
  before: Pick<GameState, 'lastGodPower'>,
  after: Pick<GameState, 'lastGodPower'>,
): number {
  const hint = godPowerHintThisAction(before, after);
  if (hint === null) return -1;
  if (hint.type !== SMALL_WEALTH_GOD_TYPE && hint.type !== BIG_WEALTH_GOD_TYPE) return -1;
  return hint.player;
}

/**
 * 小財神（種類 1）顯靈的**额外台词** —— 事件 **8**（`0x48086a` = `0x48084a + 8×4`）。
 *
 * @source `fcn_0040ec14` 的尾段（金額三位數）：
 * ```asm
 * 0040eca4  cmp esi, 0x2bc / 0040ecaa jle 0x40ece6   ; ★ **严格大于 700** 才说
 * 0040ecac  cmp byte [0x46caf8], 0 / 0040ecb3 jne …   ; ★ 终局码非 0（收款途中有人破产）就不说
 * 0040ecc1  mov bl, byte [player + 0x496b7b]          ; 角色号
 * 0040ecd3  mov esi, [ebx + eax*8 + 0x48086a]         ; 角色台词表[角色][事件 8]
 * 0040ecdb  push 3 / 0040ecdd push ecx / 0040ecde call 0x44ef41
 * ```
 * 金额取 core 交出来的 `lastGodPower.amount`（不是从钱的差分反推 ——
 * 小財神是**每个对手各付一笔**，差分里拿到的是总和）。
 */
export function detectSmallWealthLine(before: GameState, after: GameState): DetectedSay[] {
  const hint = godPowerHintThisAction(before, after);
  if (hint === null || hint.type !== SMALL_WEALTH_GOD_TYPE) return [];
  // @source 0x0040ecaa `jle` —— 恰好 700 **不说**
  if (!(hint.amount > SMALL_WEALTH_LINE_MIN)) return [];
  // @source 0x0040ecac `cmp byte [0x46caf8],0 / jne 0x40ece6`：终局码非 0（对局已结束）就不说
  if (after.phase === 'gameOver') return [];
  const p = after.players[hint.player];
  if (p === undefined || !isAlive(p)) return [];
  if (!speechGatesOpen(p)) return [];
  return [{ player: hint.player, event: 8 }];
}

/**
 * 大財神（種類 2）顯靈的**额外台词** —— 走的是「進帳」档位函数，事件 6/7/8。
 *
 * @source `0x0040f0xx` 的大財神那一支（金額四位數）：
 * ```asm
 * 0040ed5a  ebx = [0x4990e8]                     ; 物價指數
 * 0040ed60..0040ed71  eax = ebx×5×8 − ebx … = **5000 × 物價指數**
 * 0040ed74  cmp esi, eax / 0040ed76 jl 0x40ece6 ; ★ 够 5000×物價 才说
 * 0040ed7c  push esi / 0040ed84 push 玩家 / 0040ed85 call 0x44f354   ; = gainEventFor 那条档位表
 * ```
 * ⚠️ 因为闸门就是 `≥ 5000 × 物價`，而 `gainEventFor` 在 5000 档以上恒返回 **6** ——
 *   这里仍然照原版**走一遍分档函数**（不是为了「差不多」，是为了阈值方向写在一处）。
 */
export function detectBigWealthLine(before: GameState, after: GameState): DetectedSay[] {
  const hint = godPowerHintThisAction(before, after);
  if (hint === null || hint.type !== BIG_WEALTH_GOD_TYPE) return [];
  if (hint.amount < MONEY_TIER_MID * after.priceIndex) return [];
  const event = gainEventFor(hint.amount, after.priceIndex);
  if (event === null) return [];
  const p = after.players[hint.player];
  if (p === undefined || !isAlive(p)) return [];
  if (!speechGatesOpen(p)) return [];
  return [{ player: hint.player, event }];
}

// ============================================================
//  開局宣言 —— 26（不走状态差分）
// ============================================================

/**
 * 開局宣言的槽位号 —— 事件 26「我要再接再勵，永往直前！」。
 *
 * @source VA `0x00407946`（**全 exe 唯一一处**：`tools/disasm.py find b2084800`
 *   只命中 1 处 = `0x00407949`，即该指令的 disp32）：
 * ```asm
 * 00407929  edi = [0x49910c]                      ; ★ 说的人是**当前玩家**
 * 00407934  dl  = byte [玩家 + 0x13]              ;   角色号
 * 00407946  ebp = [表 + 108×角色 + 0x4808b2]      ; = 事件 26
 * 00407950  eax = edi ; or ah, 0x80               ;   玩家 | 0x8000
 * 00407956  call 0x44ef41                         ;   player_say
 * ```
 * 它住在 `fcn_00407842`（`rich4_new_game.asm`）里，**紧跟一个模态消息框**
 * （`0x00407919 call 0x4018e7` / `Wait_0402_Message`）之后；`callers 0x407842`
 * 只有两处 —— `0x40cff0`（`0x40cd87` 破产流程里「唯一真人出局」那一支）
 * 与 `0x41da2d`（`0x41d89e` 的续局分支，它先把 `[0x49910c]` 归零再调）。
 * 两条都是**开局/重开**，都不经过任何 action ⇒ `playSoundFor` 永远看不到它。
 *
 * ⇒ 本引擎由 `main.ts` 的 `startGame()` 显式播一次（`openingSpeech`）。
 */
export const OPENING_SPEECH_EVENT = 26;

/**
 * 開局宣言那一段（当前玩家说事件 26）。
 *
 * 纯函数：只把 `(当前玩家, 事件 26)` 翻成 `SpeechBubble`，不碰队列/音频/DOM。
 * 每个角色说什么由 `@rich4/data` 的 `SPEECH_LINES[角色][26]` 给出
 * （語音号 = `1050 + 27×角色 + 26`）。
 */
export function openingSpeech(state: GameState): SpeechBubble[] {
  return speechBubblesFor(state, [
    // ★ 開局宣言是**全局第一件事**（`0x00407946` 紧跟模态消息框之后），
    //   且 `main.ts` 是直接 `speechQueue.push` 的、不经 `queueSpeech` ⇒ 填 `beforeStage`。
    //   ★ 表情号 3 @source `0x0040794e push 3`（见 `EXPRESSION_BY_EVENT` 的事件 26）。
    {
      player: state.currentPlayer,
      event: OPENING_SPEECH_EVENT,
      order: 'beforeStage',
      expression: expressionOf(OPENING_SPEECH_EVENT) ?? 0,
    },
  ]);
}

/**
 * 全部探测器，**有序列**（顺序 = 播出顺序）。
 *
 * 顺序照原版在同一笔交易里的调用次序：
 *   付錢的人先开口（`fcn_0044f4ed`/`fcn_0044f42d` 在 0x00419f67），
 *   收錢的人后开口（`fcn_0044f354` 在 0x00419fa1）。
 *
 * ★★ W-51：每一条都**必须**带 `order`（`beforeStage` / `afterStage`）—— 判据是
 *   W-50 §2.2 的次序裁定表（首席已读过 exe）。表里**明写**的五条：
 *
 *   | 探测器 | 表里的行 | order |
 *   |---|---|---|
 *   | `prisonEntered` | 送監獄 `0x0043d71c` | `afterStage`（影片 → 镜头 → 台词）|
 *   | `hospitalEntered` | 送醫院 `0x0043edcb` | `afterStage`（影片 → 镜头 → 台词）|
 *   | `turnStartBlocked` | 回合开始三句 `0x0040ca51/…` | `beforeStage`（本回合第一件事）|
 *   | `godArrived` | 壞神附身 `0x0040ef44`… | `beforeStage`（台词 → 影片 → 神明窗…）|
 *   | `moneyPaid` | 設施收費 `0x0041a71e` | `afterStage`（轉盤 → 訊息框 → 收費 → 台词）|
 *
 *   表里没明写的走表尾那条规则（查 `docs/tasks/speech-callsites.md` 里同一次
 *   `player_say` 调用的行：「之前」列有影片/訊息框而「之后」列没有 ⇒ `afterStage`，
 *   反之 ⇒ `beforeStage`）。其中**两边都没有**（或同一个探测器的两个调用点互相矛盾）
 *   的十条**已按 C 级上报** `docs/escalations.md` 的 **E-19**（附了每一条的调用点
 *   与它那两列），在首席裁定之前**暂定 `afterStage`**（照 §2.2 对 `afterNotice` 的
 *   先例：「做不到就先按 `afterStage` 做并在 PR 里注明」）—— 这十条都用
 *   `// ⚠ C 级：E-19` 标出，改判只改这一处。
 *   （`landGodLine` / `luckyGodLine` / `smallWealthLine` / `bigWealthLine` 是
 *     W-55 行 6/7 在同一个工作区里并行加的，各带自己的依据注释。）
 */
/**
 * **这一条 action** 写下的魔法屋那一趟（`lastEvent` 刚变成 `kind: 'magicHouse'`）；不是返回 null。
 * 判据按引用（`lastEvent` 不是瞬态字段，见 `pointsSquareEventThisAction`）。
 */
function magicHouseThisAction(
  before: Pick<GameState, 'lastEvent'>,
  after: Pick<GameState, 'lastEvent'>,
): NonNullable<GameState['lastEvent']> | null {
  const ev = after.lastEvent ?? null;
  if (ev === null || ev === (before.lastEvent ?? null) || ev.kind !== 'magicHouse') return null;
  return ev;
}

/** 魔法屋那三支收尾说的「？？？...」 */
const MAGIC_PONDER_TEXT = MAGIC_HOUSE_TEXT.ponder.text;

/**
 * 魔法屋「就地加蓋 / 就地拆除」两支收尾：中签者说「？？？...」（表情 0）。
 *
 * @source `0x00432094 push 0x46482f / push 0 / push [0x49910c]（= 中签者）/ 0x004320a2 call player_say` ——
 *   加蓋那一支在大锤（+bit7 时 0x20b）之后（0x0043208f 之后落到 0x00432094）、
 *   拆除那一支在 0x211 影片之后（0x0043237f `jmp 0x4320a2`）。两支前面都有同一道闸
 *   （`[player+0x32]` + 格型别），闸没过就整支跳过、不说话 —— core 过闸时才交 `magic.effect` 那一扇框，
 *   这里拿那一扇认人。
 * ★ 拍賣那一支（`0x0043242b`）同样收尾说这一句，但在**拍賣窗口关掉之后** —— 见 `detectMagicAuctionPonder`。
 */
export function detectMagicPonder(before: GameState, after: GameState): DetectedSay[] {
  const ev = magicHouseThisAction(before, after);
  if (ev === null || (ev.id !== 5 && ev.id !== 9)) return [];
  if (after.notices === before.notices) return [];
  const out: DetectedSay[] = [];
  for (const who of ev.targets ?? []) {
    const p = after.players[who];
    if (p === undefined || !speechGatesOpen(p)) continue;
    const name = characterName(p.character);
    const passed = after.notices.some((n) => n.key === 'magic.effect' && n.args[0] === name);
    if (!passed) continue;
    out.push({ player: who, event: -1, expression: 0, text: MAGIC_PONDER_TEXT });
  }
  return out;
}

/**
 * 魔法屋「拍賣當格土地」那一支：拍賣窗口（`0x43bde5`，模态）关掉之后，卖方（= 中签者）说「？？？...」。
 *
 * @source 0x004324d5 `call 0x43bde5` → `push 1 / call 0x41906a` → `push 0x46482f / push 0 / push 中签者`
 *   → `jmp 0x4320a2 call player_say`。
 * 判据：这一条 action 把 `pending{auction}` 收掉了，而 `lastEvent` 还是魔法屋「拍賣當格土地」那一趟
 *   （拍賣本身不写 `lastEvent`）。
 */
export function detectMagicAuctionPonder(before: GameState, after: GameState): DetectedSay[] {
  const bp = before.pending;
  if (bp === null || bp.kind !== 'auction') return [];
  if (after.pending !== null && after.pending.kind === 'auction') return [];
  const ev = after.lastEvent;
  if (ev === null || ev.kind !== 'magicHouse' || ev.id !== 11) return [];
  const seller = bp.seller;
  if (seller === undefined) return [];
  const p = after.players[seller];
  if (p === undefined || !speechGatesOpen(p)) return [];
  return [{ player: seller, event: -1, expression: 0, text: MAGIC_PONDER_TEXT }];
}

export const DETECTORS: readonly SpeechDetector[] = [
  // §2.2 表：送監獄 —— 影片 `0x0043d6aa` → 镜头 → 台词
  { name: 'prisonEntered', source: [0x0043d70d], order: 'afterStage', detect: detectPrisonEntered },
  // §2.2 表：送醫院 —— 影片 `0x0043ed59` → 镜头 `0x0043eda0` → 台词
  { name: 'hospitalEntered', source: [0x0043edbc], order: 'afterStage', detect: detectHospitalEntered },
  // ⚠ C 级：E-19（调用点 `0x00444356` 前后两列都空）
  { name: 'dreamCard', source: [0x0044434b], order: 'afterStage', detect: detectDreamCard },
  // §2.2 表：回合开始那三句 —— 本回合第一件事；`0x0040cb4c` 之后才是訊息框
  { name: 'turnStartBlocked', source: [0x0040ca46, 0x0040cabf, 0x0040cb41], order: 'beforeStage', detect: detectTurnStartBlocked },
  // ⚠ C 级：E-19（调用点 `0x0040d249` 前后两列都空）
  { name: 'bankrupt', source: [0x0040d237], order: 'afterStage', detect: detectBankrupt },
  // ⚠ C 级：E-19（调用点 `0x0040d060` 前后两列都空）
  { name: 'victory', source: [0x0040d055], order: 'afterStage', detect: detectVictory },
  // ★★ 剛滿 5 級 —— **台词在前、0x20b 烟花在后**（E-19 那条「两个调用点不一致」
  //   已回 exe 核清：两个调用点是**同一种形状**）：
  //   · 地块支 `0x00419a19 call 0x44ef41` → `0x00419a21 call 0x40b0cd`（= 0x20b 烟花）；
  //   · 設施支 `0x0041ab5b call 0x44ef41` → `0x0041ab63 call 0x40b0cd`。
  //   两支都读 `0x480886` = **事件 15**，且都在「升到 5 級」那一支上
  //   （`0x004199eb cmp byte [esi+0x1a],5 / jne 0x419a2b` 的另一边）。
  //   ⇒ `beforeStage`（先说出来、再放烟花）。E-19 表里「前者前有 Yes/No 框」那个框
  //   是**玩家早就答过**的加蓋确认（`0x00419996 call 0x440ba8`），不是本条 action 的演出。
  { name: 'levelFive', source: [0x00419a0e, 0x0041ab4a], order: 'beforeStage', detect: detectLevelFive },
  // ★ 同一街區獨佔 ≥ 3 塊（買地 16 / 加蓋 17）—— 要 `topo` 才数得出街區
  // ⚠ C 级：E-19（台词在叶子函数 `0x44f627` 里，调用点 `0x0044f6df` 前后两列都空）
  { name: 'areaMonopoly', source: [0x0044f627, 0x0041a13e, 0x00419a31], order: 'afterStage', detect: detectAreaMonopoly },
  // ★ 神明：**先**旧神离身（23）**再**新神附身（22）—— 原版 `0x40eb3f` → `0x40ec0d`
  // ⚠ C 级：E-19（调用点 `0x0040e659` 前后两列都空）
  { name: 'godLeft', source: [0x0040e32c, 0x0040e64a, 0x0041cc9b, 0x00444cc4], order: 'afterStage', detect: detectGodLeft },
  // §2.2 表：壞神附身（小窮/大窮/小衰/大衰/死神）—— 台词 → 影片 → 神明台词窗 →（轉盤）→ 付款
  { name: 'godArrived', source: [0x0040ea9b, 0x0040e64a, 0x0040ef2f, 0x0040f2ff], order: 'beforeStage', detect: detectGodArrived },
  // ★ W-55 行 6：神明**落脚顯靈**的台词（天使/惡魔/福神在落点尾块那一族）。
  // §2.2 表：土地公顯靈 `0x0040f8ab` —— 镜头 → 訊息框 → 台词 ⇒ `afterStage`。
  { name: 'landGodLine', source: [0x0040f86e, 0x0040f8ab], order: 'afterStage', detect: detectLandGodLine },
  // §2.2 表：福神顯靈 `0x0040fa1e`（到 5 级）/ `0x0040fa5c`（没到，`rand()&1` 二选一）
  //   —— 訊息框 → 音效 → 镜头 → 台词 ⇒ 裁定是 `afterNotice`，而 `SpeechOrder`
  //   只有两档（`beforeStage` / `afterStage`）⇒ 按 §2.2 的兜底「先按 `afterStage`
  //   做并在 PR 里注明」。到 5 级那一支的事件 15 另由 `detectLevelFive` 说（不在这里）。
  { name: 'luckyGodLine', source: [0x0040f8be, 0x0040fa49, 0x0040fa5c], order: 'afterStage', detect: detectLuckyGodLine },
  // ★ W-67-a：董事長蒞臨商店的贈禮 —— 訊息框（`0x464378`，1500 ms）→ 台词（`0x44f230`）
  //   ⇒ `afterStage`（框在前、台词在后）。
  { name: 'shopGift', source: [0x0042e9f8, 0x0042ea23], order: 'afterStage', detect: detectShopGift },
  // ★ 第八份试玩回报 #5：福神附身得卡 —— 神明台词 → 卡面 → 訊息框（`0x4632fd`）→ 台词（`0x44f230`）⇒ `afterStage`
  { name: 'godCard', source: [0x0040edef, 0x0040ee46], order: 'afterStage', detect: detectGodCard },
  // §2.2 表：設施收費 `0x0041a71e` —— 轉盤 → 訊息框 → 收費 → 台词（其余几个调用点同一条阶梯函数）
  { name: 'moneyPaid', source: [0x0044f42d, 0x0044f4ed, 0x0044f567], order: 'afterStage', detect: detectMoneyPaid },
  // ⚠ C 级：E-19（调用点 `0x0044f420` 前后两列都空）
  { name: 'moneyGained', source: [0x0044f354], order: 'afterStage', detect: detectMoneyGained },
  // ★ W-55 行 7（G33）：小財神 `0x0040ecde` —— 神明台词窗 → 轉盤窗 → 收款 → **台词**
  //   ⇒ `afterStage`（§2.2 表）。排在收款那两条之后。
  { name: 'smallWealthLine', source: [0x0040eca4, 0x0040ecde], order: 'afterStage', detect: detectSmallWealthLine },
  // ★ W-55 行 7（G34）：大財神 `0x0040ed85`（走「進帳」档位函数）—— 收款 → 台词。
  //   §2.2 表里没有这一条，按 W-55 表尾给的 `afterStage`；依据 = 它就在收款（`0x41d3f4`）
  //   之后（`0x0040ed52` 收款 / `0x0040ed85` 台词）。
  { name: 'bigWealthLine', source: [0x0040ed74, 0x0040ed85], order: 'afterStage', detect: detectBigWealthLine },
  // ⚠ C 级：E-19（`0x0041a7e0` 所在函数里没有 `player_say`；台词在阶梯函数 `0x44f2c2` 的 `0x0044f347`，两列都空）
  { name: 'hotelStay', source: [0x0041a7e0, 0x0044f2c2], order: 'afterStage', detect: detectHotelStay },
  // ⚠ C 级：E-19（调用点 `0x0044f2b5` 前后两列都空）
  { name: 'pointsGained', source: [0x0044f230], order: 'afterStage', detect: detectPointsGained },
  // ★ 得點券格 / 小遊戲不玩：走角色台词表（`0x41b211`/`0x41b29e`/`0x4154b6`）
  // ⚠ C 级：E-19（两个调用点不一致：`0x0041b211` 两列都空、`0x004154cf` 前有訊息框）
  { name: 'pointsSquarePhrase', source: [0x0041b211, 0x0041b29e, 0x004154b6], order: 'afterStage', detect: detectPointsSquarePhrase },
  // ★★ 第九份试玩回报 #6：命運 0「強制拆除房屋一棟」—— 房主（= 抽到的人自己）的倒霉台词。
  //   §2.2 表：镜头（`0x0044bee8`）→ 赔款（`0x0044bf36`）→ 镜头复位（`0x0044bf51`）
  //   → sleep 300 → 台词（`0x0044bf9f`）⇒ `afterStage`。
  { name: 'demolishedHouse', source: [0x0044bf9f], order: 'afterStage', detect: detectDemolishedHouse },
  // ★★ 第十二份試玩回報：新聞 5 / 15 / 19 / 21「随机挑一处建筑」—— 那一处的**房主**说一句。
  //   调用点都在 `view_to` → `mutate_land` →（影片 → sleep）**之后**、函数的最后一步 ⇒ `afterStage`。
  { name: 'newsPlaceOwner', source: [0x004494cd, 0x0044a5c3, 0x0044ab19, 0x0044ae84], order: 'afterStage', detect: detectNewsPlaceOwner },
  // ★ 魔法屋（2026-09-23）：加蓋 / 拆除两支收尾「？？？...」—— 框 → 影片 →（0x20b）→ 台词 ⇒ `afterStage`
  { name: 'magicPonder', source: [0x00432094, 0x004320a2], order: 'afterStage', detect: detectMagicPonder },
  // ★ 魔法屋拍賣那一支：拍賣窗口关掉之后才说
  { name: 'magicAuctionPonder', source: [0x004324d5, 0x004320a2], order: 'afterStage', detect: detectMagicAuctionPonder },
];

/**
 * ★★ **每一句台词配哪张脸** —— `player_say` 第 2 个实参 `arg2`（= 表情号）。
 *
 * W-50 §1.1 的第 ⑤ 步：头像图号 = `arg2 + 1`（`map.mkf #(0x1b + 角色号)`，
 * 落 (170,130)）。`speech-bubble.ts` 只负责画，**取值在这里**。
 *
 * ## 判据 = **事件号**，不是调用点
 *
 * 原版每一句台词都是 `player_say(玩家, 立即数, 角色台词表[角色][事件])`
 * （表基址 `0x48084a`、步长 4 = 一个事件一项；`0x48084a + 4n` = 事件 n）。
 * 所以**同一个事件号到处都用同一个表情号**，与「谁调用的」无关 ——
 * 这也是「`moneyGained` / `moneyPaid` 的档位函数自己说、调用点不唯一」
 * 那条疑虑的答案：拿**事件号**去查表就唯一了。
 *
 * ## 逐条 `@source`（全部自己回 exe 读过，命令 = `python3 tools/disasm.py va <地址> <条数>`）
 *
 * | 事件 | 表情 | 说这一句的原版位置（`push <表情>` 就在 `call 0x44ef41` 之前） |
 * |---|---|---|
 * | 0, 1, 2 | **0** | 小额进帐 `fcn_0044f230`：`0x0044f2b2 push 0`。★ 得點券格 / 小遊戲不玩那三处也是 `push 0`：`0x0041b208`（`0x0041b211`）、`0x0041b295`（`0x0041b29e`）、`0x004154c6`（`0x004154cf`）；土地公 / 福神那两句共用角色台词表事件 0/1：`0x0040f8a8 push 0`、`0x0040fa1b push 0`、`0x0040fa59 push 0`（`0x0040fa5c jmp 0x40ecde`）|
 * | 3, 4, 5 | **2** | 小额损失 `fcn_0044f2c2`：`0x0044f344 push 2`（住宿/監獄/醫院那几笔都走它）|
 * | 6, 7, 8 | **3** | 進帳档位 `fcn_0044f354`：`0x0044f41d push 3`。★ 小財神那支也走事件 8：`0x0040ecdb push 3` |
 * | 9, 10, 11 | **2** | 付錢档位 `fcn_0044f42d`：`0x0044f4dd push 2` |
 * | 12, 13, 14 | **3** | 罰款档位 `fcn_0044f567`：`0x0044f617 push 3` |
 * | 15 | **0** | 剛滿 5 級 `0x00419a16 push 0`（福神到 5 级那一支共用，`0x0040fa1b push 0`）|
 * | 16, 17 | **0** | 同一街區獨佔 `fcn_0044f627`：事件 17 那支 `0x0044f6b3 push 0`；事件 16 那支 `0x0044f6dd push ecx`，而 `ecx = [esp+0x18]` = 「加蓋」旗標 = **0**（`0x0044f673`）|
 * | 18 | **1** | 最敵對玩家拿走 ≥5000×物價 `fcn_0044f4ed`：`0x0044f551 push 1` |
 * | 19 | **2** | 入獄 `0x0043d715 push 2`；回合開始被阻 `0x0040ca4e push 2` |
 * | 20 | **2** | 住院 `0x0043edc4 push 2`；回合開始被阻 `0x0040cac7 push 2` |
 * | 21 | **1** | 夢遊卡 `0x00444353 push 1`；回合開始被阻 `0x0040cb49 push 1` |
 * | 22 | **2** | 壞神附身（小窮/大窮/小衰/大衰/死神）—— 五处的 `push 2`：`0x0040ef37` / `0x0040f000` / `0x0040f09f` / `0x0040f171` / `0x0040f307`（取串都在 `0x4808a2` = 事件 22）|
 * | 23 | **2** | 神明離身 `0x0040e652 push 2` |
 * | 24 | **3** | 終局 `0x0040d05d push 3` |
 * | 25 | **2** | 破產 `0x0040d23f push 2` |
 * | 26 | **3** | 開局宣言 `0x0040794e push 3`（`or ah,0x80` 置「不重设视窗卷动」位；见 `openingSpeech`）|
 *
 * ★ **没进这张表的就是没取证**：`expressionOf()` 对未知事件返回 `null`，
 *   `speechEventsFor` 于是**不写** `expression` 字段（`speechBubbleOf` 回落到 0）。
 *   不要在这里补「看着差不多」的值 —— 规则 4。
 */
export const EXPRESSION_BY_EVENT: Readonly<Record<number, number>> = {
  0: 0,
  1: 0,
  2: 0,
  3: 2,
  4: 2,
  5: 2,
  6: 3,
  7: 3,
  8: 3,
  9: 2,
  10: 2,
  11: 2,
  12: 3,
  13: 3,
  14: 3,
  15: 0,
  16: 0,
  17: 0,
  18: 1,
  19: 2,
  20: 2,
  21: 1,
  22: 2,
  23: 2,
  24: 3,
  25: 2,
  26: 3,
};

/** 某个事件号的表情号；**没取证的事件返回 `null`**（调用方据此不写该字段） */
export function expressionOf(event: number): number | null {
  return EXPRESSION_BY_EVENT[event] ?? null;
}

/**
 * 一次状态跃迁要说的话（可能不止一句）。
 *
 * `topo` 是可选的：只有「同一街區獨佔」（事件 16/17）需要它 —— 街區归属是
 * 地图静态数据（`land.name`），不在 `GameState` 里。缺席时那条探测器不出声，
 * 其余 24 个槽位照常。
 *
 * ★ W-51：每条命中的 `order` 由**它自己的探测器**给出（`SpeechDetector.order`），
 *   这里一处一值地补上 —— 调用方（`main.ts` 的 `queueSpeech`）据此决定
 *   「立即上台」还是「先押进 `deferredSpeech`」。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4）。
 */
export function speechEventsFor(
  before: GameState,
  after: GameState,
  topo?: MapTopology,
): SayEvent[] {
  const out: SayEvent[] = [];
  for (const d of DETECTORS) {
    for (const ev of d.detect(before, after, topo)) {
      // ★ W-50 §1.2 第 1 条：表情号按**事件号**查表（判据见 `EXPRESSION_BY_EVENT`）。
      //   没取证的事件**不写这个字段**（`speechBubbleOf` 回落到 0），不猜。
      const expression = expressionOf(ev.event);
      out.push(expression === null ? { ...ev, order: d.order } : { ...ev, order: d.order, expression });
    }
  }
  return out;
}

/**
 * `(事件, 状态) → Speaking.mkf 资源号`；**任何越界都返回 `null`（= 不播）**。
 *
 * ★ 为什么由这里兜边界：`speechIndex()`（T-051）对越界**抛 `RangeError`**，
 *   而原版根本没有边界检查（见 `docs/deviations/T-051.md` 的 Q-SPEECH-2）。
 *   表现层不该因为一份坏状态把整局游戏炸掉，故在这里先判、不合法就不播 ——
 *   这是**调用方的责任**，不是给 `speechIndex` 加夹取。
 *
 * ⚠️ 入参收 `SayKey`（只要 `player` / `event`）：资源换算**不关心次序**，
 *   裸的 `{ player, event }` 字面量（测试与其它调用方）照样能传。
 */
export function speechResourceFor(state: GameState, ev: SayKey): number | null {
  const p = state.players[ev.player];
  if (p === undefined) return null;
  const character = p.character;
  if (!Number.isInteger(character) || character < 0 || character >= SPEECH_CHARACTER_COUNT) {
    return null;
  }
  if (!Number.isInteger(ev.event) || ev.event < 0 || ev.event >= SPEECH_EVENTS_PER_CHARACTER) {
    return null;
  }
  return speechIndex(character, ev.event);
}

/** 一次跃迁要播的资源号（顺序不变，越界的直接丢掉） */
export function speechResourcesFor(state: GameState, events: readonly SayKey[]): number[] {
  const out: number[] = [];
  for (const ev of events) {
    const res = speechResourceFor(state, ev);
    if (res !== null) out.push(res);
  }
  return out;
}

/**
 * 一段要上台的台词 + 它在原版里的**次序**（W-51）。
 *
 * `main.ts` 的 `queueSpeech()` 按 `order` 分流：`beforeStage` 立即入队、
 * `afterStage` 在 `stageBusy()` 为真时先押着。
 */
export interface SpeechLine {
  readonly bubble: SpeechBubble;
  readonly order: SpeechOrder;
}

/**
 * 一次跃迁要说**哪些话**（排好版的段落 + 次序，供屏幕显示）。
 *
 * ★ 2026-09-16 加：此前这里只出**语音号**，玩家听得到声音但屏幕上一个字都没有 ——
 *   而原版 `_rich4_player_say`（VA 0x0044ef41）是**先画白字字幕**
 *   （`_rich4_draw_text(串, 0xc8, 0x28, 5)` = 落点 (200, 130)）**再**放语音的。
 *   台词文本现在由 `@rich4/data` 的 `SPEECH_LINES`（12×27 全量）提供，
 *   金貝貝（角色 11）那一列没有文本、只有 `Data.mkf #0x207` 的表情图。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4）。
 */
export function speechLinesFor(state: GameState, events: readonly SayEvent[]): SpeechLine[] {
  const out: SpeechLine[] = [];
  for (const ev of events) {
    const p = state.players[ev.player];
    if (p === undefined) continue;
    const bubble = speechBubbleOf(ev, p.character, characterName(p.character));
    if (bubble !== null) out.push({ bubble, order: ev.order });
  }
  return out;
}

/** `speechLinesFor` 的「只要段落」版（沿用旧接口；兼容既有调用方与测试）*/
export function speechBubblesFor(
  state: GameState,
  events: readonly SayEvent[],
): SpeechBubble[] {
  return speechLinesFor(state, events).map((line) => line.bubble);
}

/**
 * **卡牌使用者台词** —— `GameState.lastCardPlay` 变化时，出牌者说的那一句。
 *
 * 原版这句在**卡片函数体内**（`@source 0x44210e` 等 26 处，见
 * `@rich4/data` 的 `card-lines.ts`），由 `player_say`（VA `0x44ef41`）播放。
 *
 * ★★ 三道「不说话」的闸照抄原版 `player_say` 的开头
 *   （`0x44ef63`–`0x44ef9a`，全部 `jne → ret`）：
 *
 * ```asm
 * 0044ef79  cmp  byte ptr [eax + 0x496b9b], 0   ; +0x33 days_disappearing
 * 0044ef80  jne  0x44f228                       ;   ⇒ 直接返回
 * 0044ef86  cmp  byte ptr [eax + 0x496b9f], 0   ; +0x37 days_sleep_walking
 * 0044ef8d  jne  0x44f228
 * 0044ef93  cmp  byte ptr [eax + 0x496b9e], 0   ; +0x36 days_sleeping
 * 0044ef9a  jne  0x44f228
 * ```
 *   （**不在**里面的：監獄 `+0x34` / 醫院 `+0x35` / 住宿 `+0x32`。）
 *
 * ★ **表情号（`expression`）由 `cardLineBubbleOf` 逐卡查表填**
 *   （`CARD_LINE_EXPRESSION`，2026-09-19 逐卡核完；第二实参在 exe 里确实被读：
 *   `0x0044f050`，在两次 `push` 之后偏移是 `[esp+0x30]` —— 旧注写成
 *   「函数体里一次都没读」是 grep 错了偏移）。事件台词那一半见 `EXPRESSION_BY_EVENT`。
 *
 * 纯函数（C-DET-1/2/4）：不读 DOM、不碰音频、不动 PRNG。
 */
export function cardPlaySpeech(before: GameState, after: GameState): SpeechBubble[] {
  const play = after.lastCardPlay;
  if (play === null) return [];
  // 同一次用卡只出一次（提示字段是「最近一次」的覆写语义）
  if (before.lastCardPlay === play) return [];
  const p = after.players[play.player];
  if (p === undefined) return [];
  const b = p.blocking;
  if (b.disappearing !== 0 || b.sleepWalking !== 0 || b.sleeping !== 0) return [];
  const bubble = cardLineBubbleOf(play.player, p.character, characterName(p.character), play.cardId);
  return bubble === null ? [] : [bubble];
}

/**
 * ★★ **道具台词**（第十一份試玩回報 #3）—— 用道具那一下角色说的那句话。
 *
 * 与 `cardPlaySpeech` 同一个形状：它**不是探测器**（`useTool` 不带可 diff 的状态跃迁），
 * 走的是 `GameState.lastToolUsed` 这条瞬态提示通道。
 *
 * @source 原版 13 件道具在用的那一下都 `player_say(角色, 0, _tool_strings[角色][道具号−1])`
 *   —— 路障 `0x00446bcc`（`[eax+0x480d5e]`）/ 地雷 `0x00446caa`（+8）/ 定時炸彈 `0x00446d8b`（+12），
 *   三处都在各自函式的**开头**、`cmp byte [eax+0x496b7d],1 / jne` **之前**
 *   ⇒ **不分人机，电脑也说**（玩家回报「NPC放置炸弹…好像也有台词」就是这个）。
 *   表 `0x480d5a`（12×26，行距 0x68），前 13 列 = 道具 1..13；见 `@rich4/data` 的 `TOOL_LINES`。
 *
 * 纯函数（C-DET-1/2/4）：不读 DOM、不碰音频、不动 PRNG。
 */
export function toolUseSpeech(before: GameState, after: GameState): SpeechBubble[] {
  const use = after.lastToolUsed;
  if (use === null) return [];
  // 同一次用道具只出一次（提示字段是「最近一次」的覆写语义，规矩同 `cardPlaySpeech`）
  if (before.lastToolUsed === use) return [];
  const p = after.players[use.player];
  if (p === undefined) return [];
  const b = p.blocking;
  // 消失中 / 梦游 / 冬眠的人不出声（与 `cardPlaySpeech` 同一条）
  if (b.disappearing !== 0 || b.sleepWalking !== 0 || b.sleeping !== 0) return [];
  const bubble = toolLineBubbleOf(use.player, p.character, characterName(p.character), use.toolId);
  return bubble === null ? [] : [bubble];
}

/** 角色号的显示名；越界给一个看得出来的占位（与 `main.ts` 里那几处同一套约定）*/
export function characterName(character: number): string {
  return CHARACTERS[character]?.name ?? `角色${character}`;
}
