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
  isAlive,
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_MASK,
  type GameState,
  type MapTopology,
  type Player,
} from '@rich4/core';
import {
  CHARACTERS,
  SPEECH_CHARACTER_COUNT,
  SPEECH_EVENTS_PER_CHARACTER,
  speechIndex,
} from '@rich4/data';
import { cardLineBubbleOf, speechBubbleOf, type SpeechBubble } from './speech-bubble.ts';

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
}

/** 一个探测器：名字 + 取证 VA + 纯函数 */
export interface SpeechDetector {
  /** 诊断用名 */
  readonly name: string;
  /** 判据的取证点（exe VA） */
  readonly source: readonly number[];
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
  ) => SayEvent[];
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
export function detectPrisonEntered(before: GameState, after: GameState): SayEvent[] {
  return enteredBlocking(before, after, 'inPrison').map((player) => ({ player, event: 19 }));
}

/**
 * 住院 —— 事件 20「我不要打針！！」。
 * @source `_rich4_add_player_days_in_hospital` @ VA 0x0043ec3f，说在 VA 0x0043edbc
 *   （与监狱同构：`test dh,dh / jne 加刑路径`，只在**新判**时说）
 */
export function detectHospitalEntered(before: GameState, after: GameState): SayEvent[] {
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
export function detectDreamCard(before: GameState, after: GameState): SayEvent[] {
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
export function detectTurnStartBlocked(before: GameState, after: GameState): SayEvent[] {
  if (before.phase !== 'turnStart' || after.phase !== 'turnEnd') return [];
  const p = after.players[after.currentPlayer];
  if (p === undefined || !isAlive(p)) return [];
  const b = p.blocking;
  const out: SayEvent[] = [];
  // 原版顺序：住宿/消失（无语音）→ 坐牢 → 住院 → 冬眠
  if (b.inPrison !== 0) out.push({ player: p.index, event: 19 });
  if (b.inHospital !== 0) out.push({ player: p.index, event: 20 });
  if (b.sleeping !== 0 && (b.inHotel | b.disappearing) === 0) {
    out.push({ player: p.index, event: 21 });
  }
  return out;
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
export function detectBankrupt(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
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
export function detectVictory(before: GameState, after: GameState): SayEvent[] {
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
export function detectLevelFive(before: GameState, after: GameState): SayEvent[] {
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
export function detectMoneyGained(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
  for (let i = 0; i < after.players.length; i++) {
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
export function detectMoneyPaid(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
  const received = after.players.map((_, i) => delta(before, after, i, 'monthlyReceived'));
  const poolGrew = after.pool - before.pool;

  for (let i = 0; i < after.players.length; i++) {
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
      const tier = payTierFor(amount, after.priceIndex);
      if (tier !== null) out.push({ player: i, event: 12 + tier });
    }
  }
  return out;
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
export function detectHotelStay(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
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
export function detectPointsGained(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
  // ★★ 2026-09-19（第 94 条）：**得點券格 / 小遊戲不玩**那两笔「點入帳」不走 `0x44f230`，
  //   它们各自 `player_say(玩家, 0, 角色表事件)`（`0x41b1f8` / `0x41b28d` / `0x4154b6`），
  //   由下面的 `pointsSquarePhrase` 开口。这里必须**让开**，否则同一笔会说两句
  //   （而且 `0x44f230` 的档位表与角色台词表本来就是两套词）。
  if (after.lastEvent?.kind === 'minigameDecline') return out;
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
export function detectPointsSquarePhrase(before: GameState, after: GameState): SayEvent[] {
  const ev = after.lastEvent;
  if (ev === null || ev === undefined || ev.kind !== 'minigameDecline') return [];
  void before;
  return [{ player: after.currentPlayer, event: ev.phraseIndex ?? 0 }];
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
): SayEvent[] {
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
export function detectGodLeft(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
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
export function detectGodArrived(before: GameState, after: GameState): SayEvent[] {
  const out: SayEvent[] = [];
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
  return speechBubblesFor(state, [{ player: state.currentPlayer, event: OPENING_SPEECH_EVENT }]);
}

/**
 * 全部探测器，**有序列**（顺序 = 播出顺序）。
 *
 * 顺序照原版在同一笔交易里的调用次序：
 *   付錢的人先开口（`fcn_0044f4ed`/`fcn_0044f42d` 在 0x00419f67），
 *   收錢的人后开口（`fcn_0044f354` 在 0x00419fa1）。
 */
export const DETECTORS: readonly SpeechDetector[] = [
  { name: 'prisonEntered', source: [0x0043d70d], detect: detectPrisonEntered },
  { name: 'hospitalEntered', source: [0x0043edbc], detect: detectHospitalEntered },
  { name: 'dreamCard', source: [0x0044434b], detect: detectDreamCard },
  { name: 'turnStartBlocked', source: [0x0040ca46, 0x0040cabf, 0x0040cb41], detect: detectTurnStartBlocked },
  { name: 'bankrupt', source: [0x0040d237], detect: detectBankrupt },
  { name: 'victory', source: [0x0040d055], detect: detectVictory },
  { name: 'levelFive', source: [0x00419a0e, 0x0041ab4a], detect: detectLevelFive },
  // ★ 同一街區獨佔 ≥ 3 塊（買地 16 / 加蓋 17）—— 要 `topo` 才数得出街區
  { name: 'areaMonopoly', source: [0x0044f627, 0x0041a13e, 0x00419a31], detect: detectAreaMonopoly },
  // ★ 神明：**先**旧神离身（23）**再**新神附身（22）—— 原版 `0x40eb3f` → `0x40ec0d`
  { name: 'godLeft', source: [0x0040e32c, 0x0040e64a, 0x0041cc9b, 0x00444cc4], detect: detectGodLeft },
  { name: 'godArrived', source: [0x0040ea9b, 0x0040e64a, 0x0040ef2f, 0x0040f2ff], detect: detectGodArrived },
  { name: 'moneyPaid', source: [0x0044f42d, 0x0044f4ed, 0x0044f567], detect: detectMoneyPaid },
  { name: 'moneyGained', source: [0x0044f354], detect: detectMoneyGained },
  { name: 'hotelStay', source: [0x0041a7e0, 0x0044f2c2], detect: detectHotelStay },
  { name: 'pointsGained', source: [0x0044f230], detect: detectPointsGained },
  // ★ 得點券格 / 小遊戲不玩：走角色台词表（`0x41b211`/`0x41b29e`/`0x4154b6`）
  { name: 'pointsSquarePhrase', source: [0x0041b211, 0x0041b29e, 0x004154b6], detect: detectPointsSquarePhrase },
];

/**
 * 一次状态跃迁要说的话（可能不止一句）。
 *
 * `topo` 是可选的：只有「同一街區獨佔」（事件 16/17）需要它 —— 街區归属是
 * 地图静态数据（`land.name`），不在 `GameState` 里。缺席时那条探测器不出声，
 * 其余 24 个槽位照常。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4）。
 */
export function speechEventsFor(
  before: GameState,
  after: GameState,
  topo?: MapTopology,
): SayEvent[] {
  const out: SayEvent[] = [];
  for (const d of DETECTORS) out.push(...d.detect(before, after, topo));
  return out;
}

/**
 * `(事件, 状态) → Speaking.mkf 资源号`；**任何越界都返回 `null`（= 不播）**。
 *
 * ★ 为什么由这里兜边界：`speechIndex()`（T-051）对越界**抛 `RangeError`**，
 *   而原版根本没有边界检查（见 `docs/deviations/T-051.md` 的 Q-SPEECH-2）。
 *   表现层不该因为一份坏状态把整局游戏炸掉，故在这里先判、不合法就不播 ——
 *   这是**调用方的责任**，不是给 `speechIndex` 加夹取。
 */
export function speechResourceFor(state: GameState, ev: SayEvent): number | null {
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
export function speechResourcesFor(state: GameState, events: readonly SayEvent[]): number[] {
  const out: number[] = [];
  for (const ev of events) {
    const res = speechResourceFor(state, ev);
    if (res !== null) out.push(res);
  }
  return out;
}

/**
 * 一次跃迁要说**哪些话**（排好版的段落，供屏幕显示）。
 *
 * ★ 2026-09-16 加：此前这里只出**语音号**，玩家听得到声音但屏幕上一个字都没有 ——
 *   而原版 `_rich4_player_say`（VA 0x0044ef41）是**先画白字字幕**
 *   （`_rich4_draw_text(串, 0xc8, 0x28, 5)` = 落点 (200, 130)）**再**放语音的。
 *   台词文本现在由 `@rich4/data` 的 `SPEECH_LINES`（12×27 全量）提供，
 *   金貝貝（角色 11）那一列没有文本、只有 `Data.mkf #0x207` 的表情图。
 *
 * 纯函数：不读 DOM、不碰音频、不动 PRNG（C-DET-1/2/4）。
 */
export function speechBubblesFor(
  state: GameState,
  events: readonly SayEvent[],
): SpeechBubble[] {
  const out: SpeechBubble[] = [];
  for (const ev of events) {
    const p = state.players[ev.player];
    if (p === undefined) continue;
    const bubble = speechBubbleOf(ev, p.character, characterName(p.character));
    if (bubble !== null) out.push(bubble);
  }
  return out;
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
 * ⚠️ 原版 `player_say` 的第二个实参（`flag`，各卡传 0 或 3）**函数体里一次都没读**
 *   —— 实测 `grep 'esp + 0x28'` 在该函数 235 条指令里 0 命中，故本引擎无需建模。
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

/** 角色号的显示名；越界给一个看得出来的占位（与 `main.ts` 里那几处同一套约定）*/
export function characterName(character: number): string {
  return CHARACTERS[character]?.name ?? `角色${character}`;
}
