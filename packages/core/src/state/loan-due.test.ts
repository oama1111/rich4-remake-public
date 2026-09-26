/*
 * 貸款还款日 —— 定日（`0x433b7e`）、回合开始的到期检查（`0x436a5a`）、电脑的貸款屏（`0x4367ab`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 常量全部取自 rich4.exe（见 `places/bank.ts` 各函数的 @source 块）：
 * - 期限 `0x00433b91 push 0x5a`（90 天），顺延判据 `0x4523d5`（星期日 / 節日表）；
 * - 到期检查 `0x00436a7c cmp eax, 3 / jg` + `0x00436a8f cmp ebx, 3 / ja`，跳表 `0x436a4a`
 *   = [`0x436a9b` 强制执行, `0x436adf` 還剩１天, `0x436af5` 還剩２天, `0x436b01` 提醒窗]；
 * - 提醒窗只给 `0x00436969 cmp byte [+0x15], 1`（恰好真人）；
 * - 电脑提前还：`0x004367ce cmp eax, 6`、`0x004367fc fmul [0x464b24]`（1.1）、`0x0043681b add edx,edx / jl`；
 * - 电脑放款：`0x0043689a idiv 10`、`0x004368bb cmp edx, 0x7530`、`0x004368e1 test bh,bh`。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, type GameState, type Player } from './types.ts';
import {
  AI_BORROW_CASH_LIMIT,
  AI_BORROW_RAND_MOD,
  AI_REPAY_COVER_RATIO,
  AI_REPAY_DUE_DAYS,
  LOAN_DUE_CHECK_DAYS,
  LOAN_TERM_DAYS,
  aiBorrowGate,
  aiRepaysLoan,
  loanDueStep,
  withLoanDueDate,
} from '../places/bank.ts';
import { addDaysPacked, packedDayDiff, packedFromDayNumber, dayNumberSince1998 } from '../places/calendar.ts';
import { packDate } from '../rules/calendar.ts';
import { decideAction } from '../ai/policy.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { WatcomRng } from '../rng/watcom.ts';
import type { Rich4Map } from '../loaders/map.ts';

const packed = (year: number, month: number, day: number): number => packDate({ year, month, day });
const TODAY = { year: 1998, month: 1, day: 5 };

describe('日期原语 @source 0x45201f / 0x45218f / 0x4521aa', () => {
  it('天号 ↔ 打包日期互逆（含闰年 2 月）', () => {
    for (const [y, m, d] of [
      [1998, 1, 1],
      [1998, 12, 31],
      [2000, 2, 29],
      [2000, 3, 1],
      [2003, 7, 15],
    ] as const) {
      expect(packedFromDayNumber(dayNumberSince1998(y, m, d))).toBe(packed(y, m, d));
    }
  });

  it('+90 天跨月跨年', () => {
    expect(addDaysPacked(packed(1998, 11, 15), LOAN_TERM_DAYS)).toBe(packed(1999, 2, 13));
  });

  it('差 = b − a；打包值 0（没借过）按原版给天号 −1 ⇒ 必为负', () => {
    expect(packedDayDiff(packed(1998, 1, 5), packed(1998, 1, 8))).toBe(3);
    expect(packedDayDiff(packed(1998, 1, 5), 0)).toBe(-1 - 4);
  });
});

describe('定还款日 fcn_00433b7e', () => {
  it('期限是 0x5a = 90 天', () => {
    expect(LOAN_TERM_DAYS).toBe(90);
  });

  it('今天 + 90 天落在非假日 ⇒ 就是那一天', () => {
    // 1998-01-06 + 90 = 1998-04-06（星期一，不在台湾图的節日表里）
    const p = withLoanDueDate(makePlayer({ loan: 1000 }), { year: 1998, month: 1, day: 6 }, 0);
    expect(p.loanDueDate).toBe(packed(1998, 4, 6));
  });

  it('★ 落在星期日 / 節日 ⇒ 逐日顺延（0x4523d5 → 0x452117 循环）', () => {
    // 1998-01-05 + 90 = 04-05（星期日，也是清明）→ 04-06
    expect(withLoanDueDate(makePlayer(), TODAY, 0).loanDueDate).toBe(packed(1998, 4, 6));
    // 1998-01-04 + 90 = 04-04（兒童節）→ 04-05（星期日）→ 04-06
    expect(withLoanDueDate(makePlayer(), { year: 1998, month: 1, day: 4 }, 0).loanDueDate).toBe(packed(1998, 4, 6));
  });

  it('★ 已有还款日就不重算（0x00433b88 cmp [+0x2c],0 / jne）', () => {
    const p = makePlayer({ loanDueDate: packed(1998, 2, 2) });
    expect(withLoanDueDate(p, TODAY, 0)).toBe(p);
  });
});

// ── 柜台 ──
const bankTopo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1], specialKind: SPECIAL_KIND.BANK })] };

function atCounter(over: Partial<Player> = {}): GameState {
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, cash: 50_000, moneyInBank: 50_000, ...(i === 0 ? over : {}) }),
    ),
    pending: { kind: 'bank', wealth: 100_000, loanCapacity: 100_000, specialFinance: null },
    phase: 'turnEnd',
  });
}

describe('真人申請貸款 @source 0x00435266 → 0x0043526d call 0x433b7e', () => {
  it('借到手就定还款日 = 今天 + 90（顺延）', () => {
    const r = reduce(atCounter(), { type: 'bank', op: 'borrow', amount: 10_000 }, bankTopo);
    expect(r.players[0]!.loan).toBe(10_000);
    expect(r.players[0]!.loanDueDate).toBe(packed(1998, 4, 6));
  });

  it('再借一笔：还款日**不变**（沿用第一笔的）', () => {
    const s = atCounter({ loan: 5000, loanDueDate: packed(1998, 2, 20) });
    const r = reduce(s, { type: 'bank', op: 'borrow', amount: 10_000 }, bankTopo);
    expect(r.players[0]!.loan).toBe(15_000);
    expect(r.players[0]!.loanDueDate).toBe(packed(1998, 2, 20));
  });

  it('还清 ⇒ 还款日清零（0x004353d6）', () => {
    const s = atCounter({ loan: 5000, loanDueDate: packed(1998, 2, 20) });
    expect(reduce(s, { type: 'bank', op: 'repay', amount: 5000 }, bankTopo).players[0]!.loanDueDate).toBe(0);
  });
});

// ── 回合开始的到期检查 ──
/** 玩家 0 刚走完、`endTurn` 轮到玩家 1（不绕回 0 ⇒ 不推日期）*/
function beforeTurnOf1(p1: Partial<Player>): GameState {
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, whoPlays: WHO_PLAYS_COMPUTER, ...(i === 1 ? p1 : {}) }),
    ),
    currentPlayer: 0,
    phase: 'turnEnd',
  });
}
const plainTopo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1] })] };
const due = (days: number): number => addDaysPacked(packDate(TODAY), days);

describe('还款日检查 fcn_00436a5a（0x0041c86d，回合开始）', () => {
  it('判档：0..3 天各一支，>3 与负数（逾期）什么都不做', () => {
    expect(LOAN_DUE_CHECK_DAYS).toBe(3);
    const p = (d: number) => makePlayer({ loan: 1, loanDueDate: due(d) });
    expect(loanDueStep(p(0), TODAY)).toBe('forced');
    expect(loanDueStep(p(1), TODAY)).toBe('oneDay');
    expect(loanDueStep(p(2), TODAY)).toBe('twoDays');
    expect(loanDueStep(p(3), TODAY)).toBe('reminder');
    expect(loanDueStep(p(4), TODAY)).toBeNull();
    expect(loanDueStep(p(-1), TODAY)).toBeNull();
    expect(loanDueStep(makePlayer({ loanDueDate: 0 }), TODAY)).toBeNull();
  });

  it('★ 到期当天：先弹「貸款到期日 強制執行！」，扣存款再扣现金，贷款与还款日清零', () => {
    const r = reduce(beforeTurnOf1({ loan: 30_000, loanDueDate: due(0), cash: 25_000, moneyInBank: 10_000 }), { type: 'endTurn' }, plainTopo);
    expect(r.currentPlayer).toBe(1);
    expect(r.phase).toBe('turnStart');
    const p = r.players[1]!;
    expect(p.moneyInBank).toBe(0);
    expect(p.cash).toBe(5000);
    expect(p.loan).toBe(0);
    expect(p.loanDueDate).toBe(0);
    expect(r.notices).toEqual([{ key: 'bank.loanDueForced', args: [] }]);
  });

  it('★ 到期当天付不起 ⇒ 破產（0x433c11 call 0x40cd87），之后的回合计数不走', () => {
    const r = reduce(
      beforeTurnOf1({ loan: 30_000, loanDueDate: due(0), cash: 1000, moneyInBank: 2000, blocking: { ...makePlayer().blocking, inHotel: 3 } }),
      { type: 'endTurn' },
      plainTopo,
    );
    const p = r.players[1]!;
    expect(p.whoPlays).toBe(0);
    expect(p.cash).toBe(0);
    expect(p.loan).toBe(0);
    expect(r.notices[0]).toEqual({ key: 'bank.loanDueForced', args: [] });
  });

  it('距 1 / 2 天：只弹框，钱不动', () => {
    for (const [d, key] of [[1, 'bank.loanDueOneDay'], [2, 'bank.loanDueTwoDays']] as const) {
      const r = reduce(beforeTurnOf1({ loan: 30_000, loanDueDate: due(d), cash: 100, moneyInBank: 100 }), { type: 'endTurn' }, plainTopo);
      expect(r.notices).toEqual([{ key, args: [] }]);
      expect(r.players[1]!.loan).toBe(30_000);
      expect(r.players[1]!.cash).toBe(100);
      expect(r.pending).toBeNull();
    }
  });

  it('距 3 天、电脑：什么都不做（0x43695e 只给恰好真人开窗）', () => {
    const r = reduce(beforeTurnOf1({ loan: 30_000, loanDueDate: due(3) }), { type: 'endTurn' }, plainTopo);
    expect(r.pending).toBeNull();
    expect(r.notices).toEqual([]);
  });

  it('逾期（负数）/ 还早（4 天）：什么都不做', () => {
    for (const d of [-1, 4]) {
      const r = reduce(beforeTurnOf1({ loan: 30_000, loanDueDate: due(d), cash: 100 }), { type: 'endTurn' }, plainTopo);
      expect(r.notices).toEqual([]);
      expect(r.players[1]!.loan).toBe(30_000);
    }
  });

  it('★ 只看日期不看贷款：电脑提前还清后还款日还留着 ⇒ 到期照样「強制執行」（扣 0）并清零', () => {
    const r = reduce(beforeTurnOf1({ loan: 0, loanDueDate: due(0), cash: 700, moneyInBank: 300 }), { type: 'endTurn' }, plainTopo);
    expect(r.notices).toEqual([{ key: 'bank.loanDueForced', args: [] }]);
    expect(r.players[1]!.cash).toBe(700);
    expect(r.players[1]!.moneyInBank).toBe(300);
    expect(r.players[1]!.loanDueDate).toBe(0);
  });
});

describe('★ 真人的还款提醒窗（距 3 天，0x43695e → 0x436034）', () => {
  const human = (): GameState =>
    beforeTurnOf1({
      whoPlays: WHO_PLAYS_HUMAN,
      loan: 30_000,
      loanDueDate: due(3),
      blocking: { ...makePlayer().blocking, inHotel: 3 },
    });

  it('挂 pending（相位 turnStart），窗开着时这一天的其余计数还没走', () => {
    const r = reduce(human(), { type: 'endTurn' }, plainTopo);
    expect(r.currentPlayer).toBe(1);
    expect(r.phase).toBe('turnStart');
    expect(r.pending).toEqual({ kind: 'loanReminder' });
    expect(r.players[1]!.blocking.inHotel).toBe(3);
    expect(r.notices).toEqual([]);
  });

  it('窗没关不能开始回合；关窗（declineDecision）后 0x41c84f 接着走完：住宿 3 → 2', () => {
    const r = reduce(human(), { type: 'endTurn' }, plainTopo);
    expect(reduce(r, { type: 'startTurn' }, plainTopo)).toBe(r);
    const closed = reduce(r, { type: 'declineDecision' }, plainTopo);
    expect(closed.pending).toBeNull();
    expect(closed.phase).toBe('turnStart');
    expect(closed.players[1]!.blocking.inHotel).toBe(2);
    // 钱一分不动（窗里没有任何选择）
    expect(closed.players[1]!.loan).toBe(30_000);
  });

  it('托管的真人（1|4）不开窗：`cmp byte [+0x15], 1` 是整字节比较', () => {
    const s = human();
    const taken = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, whoPlays: WHO_PLAYS_HUMAN | 4 } : p)) };
    const r = reduce(taken, { type: 'endTurn' }, plainTopo);
    expect(r.pending).toBeNull();
    expect(r.players[1]!.blocking.inHotel).toBe(2);
  });

  it('开着窗被托管 ⇒ 策略替他关窗（declineDecision），而不是提一个被退回的 startTurn', () => {
    const r = reduce(human(), { type: 'endTurn' }, plainTopo);
    const taken = { ...r, players: r.players.map((p, i) => (i === 1 ? { ...p, whoPlays: WHO_PLAYS_HUMAN | 4 } : p)) };
    const map = { nodes: [] } as unknown as Rich4Map;
    expect(decideAction({ state: taken, map })).toEqual({ type: 'declineDecision' });
    // 没被托管的真人归屏管
    expect(decideAction({ state: r, map })).toBeNull();
  });
});

// ── 电脑的貸款屏 ──
describe('电脑提前还贷判据 @source 0x004367ab..0x00436825', () => {
  it('常量', () => {
    expect(AI_REPAY_DUE_DAYS).toBe(6);
    expect(AI_REPAY_COVER_RATIO).toBe(1.1);
    expect(AI_BORROW_RAND_MOD).toBe(10);
    expect(AI_BORROW_CASH_LIMIT).toBe(30_000);
  });

  it('2×貸款 < 存款 ⇒ 不看日期直接还', () => {
    expect(aiRepaysLoan(makePlayer({ loan: 1000, moneyInBank: 2001, cash: 0, loanDueDate: due(80) }), TODAY)).toBe(true);
    expect(aiRepaysLoan(makePlayer({ loan: 1000, moneyInBank: 2000, cash: 0, loanDueDate: due(80) }), TODAY)).toBe(false);
  });

  it('距还款日 ≤ 6 天 且 現金+存款 ≥ 貸款×1.1 ⇒ 还；7 天就不看', () => {
    const p = (d: number, cash: number) => makePlayer({ loan: 1000, moneyInBank: 1000, cash, loanDueDate: due(d) });
    expect(aiRepaysLoan(p(6, 100), TODAY)).toBe(true); // 1100 ≥ 1100
    expect(aiRepaysLoan(p(6, 99), TODAY)).toBe(false);
    expect(aiRepaysLoan(p(7, 100_000), TODAY)).toBe(false);
    // 逾期（负数）也算 ≤ 6（有符号 `jg`）
    expect(aiRepaysLoan(p(-3, 100), TODAY)).toBe(true);
  });

  it('放款闸：rand%10==0 或 現金+存款 < 30000；暫停放款 / 比例 0 不借', () => {
    const rich = makePlayer({ cash: 20_000, moneyInBank: 10_000, loanRatio: 50 });
    expect(aiBorrowGate(10, rich)).toBe(true);
    expect(aiBorrowGate(11, rich)).toBe(false);
    expect(aiBorrowGate(11, { ...rich, cash: 19_999 })).toBe(true);
    expect(aiBorrowGate(10, { ...rich, bankFreezeDays: 2 })).toBe(false);
    expect(aiBorrowGate(10, { ...rich, loanRatio: 0 })).toBe(false);
  });
});

/** 电脑玩家 0 从邻格走一步落銀行格 */
function aiLands(over: Partial<Player>, rngState = 1): { state: GameState; topo: MapTopology } {
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3], specialKind: SPECIAL_KIND.BANK }),
      makeNode({ id: 3, adjacent: [2] }),
    ],
    lands: [],
  };
  const state = makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        character: i,
        nodeId: i === 0 ? 2 : 1,
        whoPlays: WHO_PLAYS_COMPUTER,
        // day 5 ⇒ 目标现金比 ×1.5；比例 60 ⇒ 0.9 ⇒ 与 90/10 的分法差不到 0.25 就不重分
        cashRatio: 60,
        ...(i === 0 ? over : {}),
      }),
    ),
    currentPlayer: 0,
    phase: 'settling',
    rngState,
  });
  return { state, topo };
}

/** 找一个让第一次 `rand()` 满足 `pred` 的种子 */
function seedWhere(pred: (r: number) => boolean): number {
  for (let seed = 1; seed < 10_000; seed++) {
    const rng = new WatcomRng();
    rng.setState(seed);
    if (pred(rng.next())) return seed;
  }
  throw new Error('no seed');
}

describe('★ 电脑落銀行：当场走 0x4367ab 那一支（不挂柜台）', () => {
  it('有贷款、2×贷款 < 存款 ⇒ 全额还清（先扣存款），框「償還銀行貸款」，**还款日留着**，不掷 rand', () => {
    // ★ 先过 ATM 入口的 cashRatio 重分（`0x0041b396`）—— 比例 10 × 1.5 = 0.15，5000 / 34000 ≈ 0.147 ⇒ 不重分
    const { state, topo } = aiLands({ cashRatio: 10, cash: 5000, moneyInBank: 29_000, loan: 10_000, loanDueDate: due(60) });
    const r = reduce(state, { type: 'settle' }, topo);
    const p = r.players[0]!;
    expect(r.pending).toBeNull();
    expect(p.loan).toBe(0);
    expect(p.moneyInBank).toBe(19_000);
    expect(p.cash).toBe(5000);
    expect(p.loanDueDate).toBe(due(60));
    expect(r.notices).toContainEqual({ key: 'bank.aiRepay', args: ['約翰喬', 10_000] });
    expect(r.rngState).toBe(state.rngState);
  });

  it('有贷款但不满足 ⇒ 什么都不做，也不掷 rand（有贷款那一支不碰随机数）', () => {
    const { state, topo } = aiLands({ cash: 9000, moneyInBank: 1000, loan: 10_000, loanDueDate: due(60), loanRatio: 100 });
    const r = reduce(state, { type: 'settle' }, topo);
    expect(r.players[0]!.loan).toBe(10_000);
    expect(r.rngState).toBe(state.rngState);
    expect(r.notices.filter((n) => n.key.startsWith('bank.'))).toEqual([]);
  });

  it('没贷款、rand%10 == 0 ⇒ 借 比例×身家/100 进存款、定还款日，框「向銀行貸款」', () => {
    const seed = seedWhere((x) => x % 10 === 0);
    const { state, topo } = aiLands({ cash: 90_000, moneyInBank: 10_000, loanRatio: 60 }, seed);
    const r = reduce(state, { type: 'settle' }, topo);
    const p = r.players[0]!;
    expect(p.loan).toBe(60_000);
    expect(p.moneyInBank).toBe(70_000);
    expect(p.loanDueDate).toBe(packed(1998, 4, 6));
    expect(r.notices).toContainEqual({ key: 'bank.aiBorrow', args: ['約翰喬', 60_000] });
    expect(r.rngState).not.toBe(state.rngState);
  });

  it('没贷款、rand 不中且 現金+存款 ≥ 30000 ⇒ 不借（但那一次 rand 照掷）', () => {
    const seed = seedWhere((x) => x % 10 !== 0);
    const { state, topo } = aiLands({ cash: 90_000, moneyInBank: 10_000, loanRatio: 60 }, seed);
    const r = reduce(state, { type: 'settle' }, topo);
    expect(r.players[0]!.loan).toBe(0);
    expect(r.rngState).not.toBe(state.rngState);
  });

  it('没贷款但还留着旧还款日（之前提前还过）⇒ 新贷款沿用旧日期（0x433b7e 不重算）', () => {
    const seed = seedWhere((x) => x % 10 === 0);
    const { state, topo } = aiLands({ cash: 9000, moneyInBank: 1000, loanRatio: 100, loanDueDate: due(20) }, seed);
    const r = reduce(state, { type: 'settle' }, topo);
    expect(r.players[0]!.loan).toBe(10_000);
    expect(r.players[0]!.loanDueDate).toBe(due(20));
  });
});

describe('★ 貸款屏开着时被托管 ⇒ 按电脑那一支替他办（需求方拍板：托管 = 电脑代打）', () => {
  const openScreen = (whoPlays: number, rngState: number, over: Partial<Player> = {}): GameState =>
    makeGameState({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, whoPlays: i === 0 ? whoPlays : WHO_PLAYS_COMPUTER, cash: 9000, moneyInBank: 1000, loanRatio: 100, ...(i === 0 ? over : {}) }),
      ),
      pending: { kind: 'bank', wealth: 10_000, loanCapacity: 10_000, specialFinance: null },
      phase: 'turnEnd',
      rngState,
    });
  const map = { nodes: [] } as unknown as Rich4Map;

  it('策略给 `{bank, auto}`；reducer 走 0x4367ab：rand()%10==0 ⇒ 借 100% 身家、定还款日、关屏', () => {
    const seed = seedWhere((x) => x % 10 === 0);
    const s = openScreen(WHO_PLAYS_HUMAN | 4, seed);
    const a = decideAction({ state: s, map });
    expect(a).toEqual({ type: 'bank', op: 'auto', amount: 0 });
    const r = reduce(s, a!, bankTopo);
    expect(r.pending).toBeNull();
    expect(r.phase).toBe('turnEnd');
    expect(r.players[0]!.loan).toBe(10_000);
    expect(r.players[0]!.moneyInBank).toBe(11_000);
    expect(r.players[0]!.loanDueDate).toBe(packed(1998, 4, 6));
    expect(r.notices).toContainEqual({ key: 'bank.aiBorrow', args: ['約翰喬', 10_000] });
  });

  it('有贷款且满足提前还 ⇒ 还清（还款日留着）', () => {
    const s = openScreen(WHO_PLAYS_HUMAN | 4, 1, { cash: 0, moneyInBank: 30_000, loan: 10_000, loanDueDate: due(40) });
    const r = reduce(s, { type: 'bank', op: 'auto', amount: 0 }, bankTopo);
    expect(r.players[0]!.loan).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(20_000);
    expect(r.players[0]!.loanDueDate).toBe(due(40));
    expect(r.pending).toBeNull();
  });

  it('恰好真人（who_plays == 1）不认 auto —— 原样返回', () => {
    const s = openScreen(WHO_PLAYS_HUMAN, 1);
    expect(reduce(s, { type: 'bank', op: 'auto', amount: 0 }, bankTopo)).toBe(s);
  });
});
