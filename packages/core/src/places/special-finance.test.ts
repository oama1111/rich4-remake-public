/*
 * 特別融資：董事長才有的那条额度
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_DEAD } from '../state/types.ts';
import type { CommercialInfo } from '../loaders/map.ts';
import {
  COMMERCIAL_TYPE_BANK,
  bankChairman,
  bankCommercial,
  bankReserveCall,
  borrowSpecial,
  payFromBank,
  repaySpecial,
  specialFinanceAvailable,
  specialFinanceLimit,
} from './special-finance.ts';

const comm = (over: Partial<CommercialInfo>): CommercialInfo => ({
  id: 1, x: 0, y: 0, name: '測試', stockIndex: 0, landPrice: 0, type: 0,
  spriteIndex: 0, assetValue: 0, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 0, ...over,
});

/** 一家銀行（行業別 7）加一家百貨（10） */
const commercials = [
  comm({ id: 1, name: '大宇百貨', type: 10, stockIndex: 2 }),
  comm({ id: 2, name: '中國信託', type: COMMERCIAL_TYPE_BANK, stockIndex: 0 }),
];

function scene(chairman: number | null, over: Partial<Parameters<typeof makePlayer>[0]>[] = []) {
  const s = makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, cash: 50_000, moneyInBank: 100_000, ...(over[i] ?? {}) }),
    ),
  });
  const owners = [...s.commercialOwners];
  owners[2] = { owner: chairman === null ? 0 : chairman + 1, ranking: [0, 0, 0, 0] };
  return { ...s, commercialOwners: owners };
}

describe('誰是董事長', () => {
  it('★ 行業別 7 的那家企業就是銀行（@source cmp byte [esi+0x1a], 7）', () => {
    expect(bankCommercial(commercials)?.name).toBe('中國信託');
    expect(bankCommercial([comm({ type: 10 })])).toBeNull();
    expect(bankCommercial(undefined)).toBeNull();
  });

  it('董事長就是那家企業的擁有者；無主時沒有董事長', () => {
    expect(bankChairman(scene(2), commercials)).toBe(2);
    expect(bankChairman(scene(null), commercials)).toBeNull();
  });
});

describe('額度', () => {
  it('★ 額度 = 除自己以外所有人的存款之和（@source 0x00434593）', () => {
    const s = scene(0);
    expect(specialFinanceLimit(s.players, 0)).toBe(300_000);
    // 别人取了钱，额度跟着缩
    const poorer = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, moneyInBank: 0 } : p)) };
    expect(specialFinanceLimit(poorer.players, 0)).toBe(200_000);
  });

  it('★ 这一支**不查在场与否** —— 破产者的存款也算进额度，原版如此', () => {
    const s = scene(0, [{}, { whoPlays: WHO_PLAYS_DEAD, moneyInBank: 100_000 }]);
    expect(specialFinanceLimit(s.players, 0)).toBe(300_000);
  });

  it('还能借多少 = 额度 − 已融資', () => {
    const s = scene(0, [{ specialFinance: 120_000 }]);
    expect(specialFinanceAvailable(s.players, 0)).toBe(180_000);
  });
});

describe('借與還', () => {
  it('★ 借：进存款也进 specialFinance，**不动 loan**', () => {
    const s = scene(0);
    const r = borrowSpecial(s.players, 0, 50_000)!;
    expect(r.player.moneyInBank).toBe(150_000);
    expect(r.player.specialFinance).toBe(50_000);
    expect(r.player.loan).toBe(0); // ★ 与一般貸款是两笔账
  });

  it('借超过额度会被截到上限；借 0 视为取消', () => {
    const s = scene(0);
    expect(borrowSpecial(s.players, 0, 999_999)!.player.specialFinance).toBe(300_000);
    expect(borrowSpecial(s.players, 0, 0)).toBeNull();
  });

  it('★ 還：先扣存款，不够动现金', () => {
    const s = scene(0, [{ specialFinance: 120_000, moneyInBank: 100_000, cash: 50_000 }]);
    const r = repaySpecial(s.players, 0, 120_000)!;
    expect(r.error).toBeNull();
    expect(r.player.moneyInBank).toBe(0);
    expect(r.player.cash).toBe(30_000); // 50_000 − 20_000
    expect(r.player.specialFinance).toBe(0);
  });

  it('★ 現金 + 存款都不够 → 「您的現金不足」，什么也不改', () => {
    const s = scene(0, [{ specialFinance: 500_000, moneyInBank: 100_000, cash: 50_000 }]);
    const r = repaySpecial(s.players, 0, 500_000)!;
    expect(r.error).toBe('cashShort');
    expect(r.player.moneyInBank).toBe(100_000);
  });

  it('還超过已融資的部分会被截掉', () => {
    const s = scene(0, [{ specialFinance: 10_000 }]);
    expect(repaySpecial(s.players, 0, 999_999)!.player.specialFinance).toBe(0);
  });
});

describe('銀行資金準備不足', () => {
  it('存款總額還撐得住就不触发', () => {
    const s = scene(0, [{ specialFinance: 200_000 }]);
    // 其他三人共 300_000 存款 ≥ 200_000
    expect(bankReserveCall(s, commercials, 3)).toBeNull();
  });

  it('★ 跌破了就要董事長墊付差額', () => {
    const s = scene(0, [{ specialFinance: 400_000 }]);
    const call = bankReserveCall(s, commercials, 3)!;
    expect(call.chairman).toBe(0);
    expect(call.shortfall).toBe(100_000); // 400_000 − 300_000
  });

  it('★ 这一支**查在场与否** —— 与算额度那支口径不同，照抄', () => {
    const s = scene(0, [
      { specialFinance: 300_000 },
      { whoPlays: WHO_PLAYS_DEAD, moneyInBank: 100_000 },
    ]);
    // 出局者的 100_000 不算 → 只剩 200_000，差 100_000
    expect(bankReserveCall(s, commercials, 3)!.shortfall).toBe(100_000);
  });

  it('董事長自己的回合不触发（原版如此）', () => {
    const s = scene(0, [{ specialFinance: 400_000 }]);
    expect(bankReserveCall(s, commercials, 0)).toBeNull();
  });

  it('没融資、或没董事長，都不触发', () => {
    expect(bankReserveCall(scene(0), commercials, 3)).toBeNull();
    expect(bankReserveCall(scene(null, [{ specialFinance: 400_000 }]), commercials, 3)).toBeNull();
  });
});

describe('墊付的扣款顺序', () => {
  it('★ 存款 → 现金 → 破產（@source VA 0x00433bd8）', () => {
    const p = makePlayer({ moneyInBank: 100_000, cash: 50_000 });
    expect(payFromBank(p, 60_000)).toEqual({
      player: { ...p, moneyInBank: 40_000, cash: 50_000 },
      bankrupt: false,
    });
    const b = payFromBank(p, 130_000);
    expect(b.player.moneyInBank).toBe(0);
    expect(b.player.cash).toBe(20_000);
    expect(b.bankrupt).toBe(false);
    const dead = payFromBank(p, 200_000);
    expect(dead.player.cash).toBe(0);
    expect(dead.bankrupt).toBe(true);
  });
});
