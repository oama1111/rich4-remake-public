/*
 * 樂透
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：
 *   落点入口   VA 0x004315cc
 *   号码表     [0x004990b8]，36 项
 *   破产释放   VA 0x0040d1aa
 *   开奖前统计 VA 0x00430b07
 */

import type { Player } from '../state/types.ts';

/**
 * 号码总数。
 * @source 三处独立的循环上界都是 `cmp eax, 0x24 / jge`（36）：
 *   买号 VA 0x004316b1、破产释放 0x0040d1a3、开奖统计 0x00430b08。
 */
export const LOTTERY_NUMBERS = 0x24;

/**
 * 票价。
 * @source AI 分支 `cmp dword [player + 0x1c], 0x3e8`（VA 0x0043169e）
 *   与随后的 `sub dword [player + 0x1c], 0x3e8`（0x004316f6）。
 *
 * ⚠️ **不乘物价指数**——这两条都是与立即数直接比较/相减，
 * 中间没有 `imul [0x4990e8]`。与买地、过路费都不同，照搬。
 */
export const LOTTERY_TICKET_PRICE = 0x3e8;

/**
 * 电脑玩家出手的门槛：**现金严格大于**票价。
 *
 * @source AI 分支 VA 0x0043169e：
 * ```asm
 * cmp dword [eax + 0x496b84], 0x3e8   ; eax = 当前玩家 * 0x68
 * jle 0x43170a                         ; ★ 现金 <= 1000 就一注不买
 * ```
 * 是 `jle` 不是 `jl` —— 电脑要**多于** 1000 才肯出手，买完至少还剩 1。
 *
 * ★ 与真人那条**不同**：真人只要 `>= 1000` 就开得了投注屏
 *   （VA 0x0042f8ba `cmp dword [eax + 0x496b84], 0x3e8 / jge`），
 *   所以真人可以买到现金正好归零，电脑不行。
 */
export const LOTTERY_AI_MIN_CASH = LOTTERY_TICKET_PRICE + 1;

/**
 * 「有人买太多了」的门槛。
 *
 * @source 开奖前 VA 0x00430b2a 起对四名玩家的持号数逐个
 *   `cmp byte [esp+0x80+i], 0xa / ja 0x430b52`。
 *
 * ★ **原先标的「购买上限」是误读**（此处原有一条 ⚠️ 说 0x430b52 分支未解）。
 *   它根本不限制购买，而是决定**开奖方式**：
 *   - 四人持号都 ≤ 10 → 在全部 36 个号里随机开（很可能无人中奖）
 *   - 任何一人 > 10   → **只在已售出的号码里开**，必定有人中奖
 *   见 `drawLottery`。
 */
export const LOTTERY_RIG_THRESHOLD = 10;

/**
 * 号码表：下标 = 号码（0..35），值 = **持有者下标 + 1**，0 表示未售出。
 *
 * @source 破产释放（VA 0x0040d1aa）逐项比对 `player + 1` 并清零，
 *   证实存的就是「玩家下标 + 1」这一编码——与地块 owner 同制。
 */
export type LotteryTable = number[];

export function emptyLottery(): LotteryTable {
  return new Array<number>(LOTTERY_NUMBERS).fill(0);
}

/** 尚未售出的号码 */
export function availableNumbers(t: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOTTERY_NUMBERS; i++) {
    if ((t[i] ?? 0) === 0) out.push(i);
  }
  return out;
}

/** 某人持有的号码 */
export function numbersOf(t: readonly number[], player: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOTTERY_NUMBERS; i++) {
    if (t[i] === player + 1) out.push(i);
  }
  return out;
}

export type BuyFailure = 'taken' | 'outOfRange' | 'notEnoughCash';

export interface BuyResult {
  ok: boolean;
  reason: BuyFailure | null;
  player: Player;
  lottery: LotteryTable;
  /** 票钱进公库的金额（成功时即票价） */
  toPool: number;
}

/**
 * 买一个号码。
 *
 * @source AI 分支（VA 0x0043169e 起）：
 * ```asm
 * cmp dword [player + 0x1c], 0x3e8    ; ★ 与**现金**比较
 * …收集未售出的号码到 buf，共 ebx 个
 * test ebx, ebx / je 结束              ; 全卖光了就算了
 * call rand / idiv ebx                 ; 随机挑一个
 * …
 * sub dword [player + 0x1c], 0x3e8     ; ★ 直接扣现金
 * add dword [0x499080],   0x3e8        ; ★ 票钱进公库
 * ```
 * 人类分支（VA 0x0043000e / 0x00430018）两条指令完全相同。
 *
 * ★ 与买地一样是**就地扣现金**，不走 pay_money，故没有存款级联、
 *   不会触发破产（对比 rules/purchase.ts 与 rules/payment.ts）。
 *
 * ★ **票钱进公库**（0x499080 即 `GameState.pool`）——这一条先前漏了。
 *   它很要紧：樂透的奖金就是开奖那一刻的整个公库，故买票既是投注
 *   也是在给奖池添柴。
 *
 * ⚠️ 号码由调用方给出。AI 走的是「在未售出的号码里随机挑一个」，
 *   那属于策略而非规则，放在 ai/ 而不是这里。
 *
 * ⚠️ 原版**不限制**每人的持号数——先前此处的 `tooMany` 是对
 *   0x430b2a 那个 10 的误读，已移除（见 `LOTTERY_RIG_THRESHOLD`）。
 */
export function buyTicket(player: Player, lottery: readonly number[], n: number): BuyResult {
  const fail = (reason: BuyFailure): BuyResult => ({
    ok: false,
    reason,
    player,
    lottery: [...lottery],
    toPool: 0,
  });

  if (!Number.isInteger(n) || n < 0 || n >= LOTTERY_NUMBERS) return fail('outOfRange');
  if ((lottery[n] ?? 0) !== 0) return fail('taken');
  // @source cmp dword [player+0x1c], 0x3e8 —— 只看现金
  if (player.cash < LOTTERY_TICKET_PRICE) return fail('notEnoughCash');

  const next = [...lottery];
  next[n] = player.index + 1;
  return {
    ok: true,
    reason: null,
    // @source sub dword [player + 0x1c], 0x3e8
    player: { ...player, cash: player.cash - LOTTERY_TICKET_PRICE },
    lottery: next,
    // @source add dword [0x499080], 0x3e8
    toPool: LOTTERY_TICKET_PRICE,
  };
}

/**
 * 电脑玩家买一注——号码由**引擎**随机抽，电脑自己没得挑。
 *
 * @source AI 分支 VA 0x0043169e 起（`rich4_ui_letou_bar_entry` 的电脑那支）：
 * ```asm
 * cmp dword [eax + 0x496b84], 0x3e8
 * jle 0x43170a                         ; 现金 <= 1000 → 一注不买
 * ; 收集未售出的号码到 buf，共 ebx 个
 * test ebx, ebx / je 0x43170a          ; 全卖光了 → 也不买
 * al = current_player + 1
 * call rand / idiv ebx                 ; ★ 在**未售出的号码**里等概率挑一个
 * mov byte [buf[edx] + 0x4990b8], al
 * sub dword [eax + 0x496b84], 0x3e8    ; 扣现金
 * add dword [0x499080], 0x3e8          ; 票钱进公库
 * ```
 * ★ **原版电脑是在未售出的号码里随机挑的**——`rand()` 的除数就是
 *   当时未售出的个数，不是 36。故这里必须由 reducer 侧的随机源出这一抽：
 *   消耗随机数的时机是「确认要买之后」，抽不了签（钱不够／卖光了）
 *   就**一次也不消耗**。
 *
 * ★ 一次落点只买一注，买完就结束（与真人一致，见 `reduce.ts` 的
 *   `landOnLottery`）。
 *
 * @returns 没出手时返回 null（钱不够或号码售罄）
 */
export function aiBuyTicket(
  player: Player,
  lottery: readonly number[],
  rng: { next: () => number },
): BuyResult | null {
  // @source cmp dword [eax + 0x496b84], 0x3e8 / jle
  if (player.cash < LOTTERY_AI_MIN_CASH) return null;
  // @source 0x004316b0 起的循环：把未售出的号码收进 buf
  const avail = availableNumbers(lottery);
  // @source test ebx, ebx / je 0x43170a
  if (avail.length === 0) return null;
  // @source call rand / idiv ebx / mov bl, [esp + edx + 0x40]
  const n = avail[rng.next() % avail.length];
  if (n === undefined) return null;
  return buyTicket(player, lottery, n);
}

/**
 * 玩家破产时释放其名下全部号码。
 *
 * @source VA 0x0040d1a8：
 * ```asm
 * al = byte [i + 0x4990b8]
 * edx = player + 1
 * cmp eax, edx / jne 下一个
 * xor al, dl                    ; 相等 → 结果 0
 * byte [i + 0x4990b8] = al
 * ```
 * `xor al, dl` 在两者相等时恰好得 0——原版用异或代替赋零。
 */
export function releaseTickets(lottery: readonly number[], player: number): LotteryTable {
  return [...lottery].map((v) => (v === player + 1 ? 0 : v));
}

// ============================================================
//  开奖
// ============================================================

/**
 * 开奖日 —— 每月 15 号。
 *
 * @source 日期推进 VA 0x0041d080：
 * ```asm
 * mov eax, [0x497160]      ; 打包日期
 * and eax, 0xff            ; ★ 低字节即「日」
 * cmp eax, 0xf             ; 15
 * jne 跳过
 * call 0x42ba97            ; （股市周报之类）
 * call 0x431712            ; ★ 樂透开奖
 * ```
 */
export const LOTTERY_DRAW_DAY = 15;

export interface LotteryDrawResult {
  /** 中奖号码 0..35；无人购票时为 null（原版此时根本不开奖） */
  number: number | null;
  /** 中奖者下标；无人中奖为 null */
  winner: number | null;
  /** 派给中奖者的金额 —— 开奖那一刻的**整个公库** */
  prize: number;
  /** 开奖后的号码表 */
  lottery: LotteryTable;
  /** 开奖后的公库 */
  pool: number;
  /** 本次是否走了「必定有人中奖」的分支 */
  rigged: boolean;
}

/**
 * 开奖并派彩。
 *
 * @source 抽号 VA 0x00430b07 起：
 * ```asm
 * ; 先扫一遍号码表，统计各人持号数，并把已售号码收进 buf
 * for i in 0..35: c = lottery[i]
 *                 if (c) { count[c]++;  buf[n++] = i + 1 }
 * ; 四个人的持号数逐个与 10 比较
 * cmp byte [count+1], 0xa / ja 有人超量
 * …（共四条）…
 * 都没超量:  ebx = rand() % 36 + 1          ; ★ 在全部 36 号里开
 * 有人超量:  ebx = buf[rand() % n]          ; ★ 只在已售号码里开
 * ```
 * @source 定中奖者 VA 0x00430d75：`al = [ebx + 0x4990b7]` 即 `lottery[号-1]`
 * @source 派彩 VA 0x00430ac4：
 * ```asm
 * ebx = 中奖者编码；test ebx,ebx / je 跳过
 * give_money(ebx - 1, [0x499080], 1)     ; ★ 整个公库给中奖者
 * [0x499080] = 0                          ; 公库清零
 * memset(0x4990b8, 0, 0x24)               ; 号码表全清
 * ```
 *
 * ★ 两处「无人中奖就什么都不做」很关键：
 *   1. 一张票都没卖出去时（VA 0x00431720 的循环）根本不开奖
 *   2. 开出的号没人买时，**公库不清零、号码表不清空**——
 *      奖金滚存到下一期，已买的号继续有效。
 *
 * ⚠️ 随机数由调用方推进（C-DET-1）：两条分支消耗的 `rand()` 次数都恰好是 1，
 *   但取模的除数不同，故不能在函数外预先取好。
 */
export function drawLottery(
  lottery: readonly number[],
  pool: number,
  rng: { next: () => number },
): LotteryDrawResult {
  const unchanged = (over: Partial<LotteryDrawResult> = {}): LotteryDrawResult => ({
    number: null,
    winner: null,
    prize: 0,
    lottery: [...lottery],
    pool,
    rigged: false,
    ...over,
  });

  // @source 0x00431720 的循环：一张都没卖出就直接返回
  const sold: number[] = [];
  const perPlayer = new Map<number, number>();
  for (let i = 0; i < LOTTERY_NUMBERS; i++) {
    const c = lottery[i] ?? 0;
    if (c === 0) continue;
    sold.push(i);
    perPlayer.set(c, (perPlayer.get(c) ?? 0) + 1);
  }
  if (sold.length === 0) return unchanged();

  // @source 四条 `cmp byte [...], 0xa / ja`
  const rigged = [...perPlayer.values()].some((n) => n > LOTTERY_RIG_THRESHOLD);

  const number = rigged
    ? // @source idiv ebx / mov bl, [esp+edx+0x40] —— 从已售号码里挑
      sold[rng.next() % sold.length]!
    : // @source mov ebx, 0x24 / idiv / lea ebx,[edx+1] —— 全 36 号随机
      rng.next() % LOTTERY_NUMBERS;

  const owner = lottery[number] ?? 0;
  // @source test ebx,ebx / je 0x430afb —— 没人中，公库与号码表原样留着
  if (owner === 0) return unchanged({ number, rigged });

  return {
    number,
    winner: owner - 1,
    // @source give_money(owner-1, [0x499080], 1)
    prize: pool,
    // @source memset(0x4990b8, 0, 0x24)
    lottery: emptyLottery(),
    // @source mov dword [0x499080], 0
    pool: 0,
    rigged,
  };
}
