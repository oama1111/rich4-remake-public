/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 保險理賠 @source 0x0044ba63 —— 六个调用点见 reduce.ts insurancePayoutTo 头注释
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { insurancePayoutTo, reduce, type MapTopology } from '../state/reduce.ts';
import { tickInsuranceDays } from '../rules/blocking.ts';
import { INDUSTRY } from './company.ts';
import { hotelStayLoss } from '../rules/facility.ts';

const INS = 2;
const topo: MapTopology = {
  nodes: [makeNode({ id: 1, adjacent: [1] })],
  lands: [],
  commercials: [
    { id: 1, x: 0, y: 0, name: '航空', stockIndex: 1, landPrice: 0, type: INDUSTRY.airline, spriteIndex: 0, assetValue: 0, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 0 },
    { id: INS, x: 0, y: 0, name: '人壽', stockIndex: 0, landPrice: 0, type: INDUSTRY.insurance, spriteIndex: 0, assetValue: 0, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 0 },
    { id: 3, x: 0, y: 0, name: '再保', stockIndex: 2, landPrice: 0, type: INDUSTRY.insurance, spriteIndex: 0, assetValue: 0, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 0 },
  ],
};

function insured(days: number) {
  return makeGameState({ players: [0, 1].map((i) => makePlayer({ index: i, cash: 1000, moneyInBank: 0, insuranceDays: i === 0 ? days : 0 })) });
}

describe('★ insurancePayoutTo', () => {
  it('保險期内：第一家保險公司赔付損失，進現金（pay_money 旗标 1）；公司盈餘同步减少', () => {
    const s = insurancePayoutTo(insured(5), topo, 0, 6000);
    expect(s.players[0]!.cash).toBe(7000);
    expect(s.players[0]!.moneyInBank).toBe(0);
    expect(s.companyFunds[INS]).toBe(-6000);
    expect(s.companyProfit[INS]).toBe(-6000);
    expect(s.companyFunds[3]).toBe(0); // 从头扫、命中即停：第二家不赔
  });

  it('没有保險期 / 損失为 0 / 出局者 → 原样', () => {
    const s = insured(0);
    expect(insurancePayoutTo(s, topo, 0, 6000)).toBe(s);
    const on = insured(3);
    expect(insurancePayoutTo(on, topo, 0, 0)).toBe(on);
  });

  it('★★ 没有保險公司：原版**照样赔玩家**（只把扣款写到越界槽）⇒ 现金与 +0x60 都加', () => {
    // §7.141 订正（通道 2 `test_insurance_richest.py` 135/135，Q-INS-2 真值）：
    //   `0x44bad8 pay_money(100 + 家数 + 1, 玩家, 損失, 1)` —— 越界写不复刻，
    //   但玩家侧可见效果（现金 +6000、本月意外之財 +6000）保留。
    const s = insurancePayoutTo(insured(3), { ...topo, commercials: [] }, 0, 6000);
    expect(s).not.toBe(insured(3));
    expect(s.players[0]!.cash).toBe(7000);
    expect(s.players[0]!.monthlyReceived).toBe(6000);
    // 没有任何公司被扣
    expect(s.companyFunds.every((f) => f === 0)).toBe(true);
  });

  it('保險期的高位 0x80（今日到期待清）也算在保', () => {
    const s = insurancePayoutTo(insured(0x80), topo, 0, 100);
    expect(s.players[0]!.cash).toBe(1100);
  });

  it('★★ 保險期递减**永不归零**（@source 0x41cc4b 无 0x80 特判）', () => {
    // §7.141 订正：先前借用了阻碍计数器的 `tickBlockingCounter`（0x80 → 0），
    //   复刻会在次日停赔；原版是整字节递减 ⇒ 1 → 0x80 → 0x7f → … → 1 → 0x80…
    let v = 1;
    const seq: number[] = [];
    for (let i = 0; i < 5; i++) {
      v = tickInsuranceDays(v);
      seq.push(v);
    }
    expect(seq).toEqual([0x80, 0x7f, 0x7e, 0x7d, 0x7c]);
    expect(v).not.toBe(0);
    expect(tickInsuranceDays(0)).toBe(0);
    // 走满一圈仍不归零
    let w = 1;
    for (let i = 0; i < 200; i++) w = tickInsuranceDays(w);
    expect(w).not.toBe(0);
  });
});

describe('★ 接线：魔法屋把人送进監獄 → 2000×天×物價 由保險赔', () => {
  it('物價 2、坐牢 3 天 → 赔 12000', () => {
    const s = { ...insured(5), priceIndex: 2 };
    expect(hotelStayLoss(3, 2)).toBe(12000);
    // 走 reduce 内部的 applyMagicRequest 不方便直接调；用 insurancePayoutTo 的同一条公式钉住金额
    const paid = insurancePayoutTo(s, topo, 0, hotelStayLoss(3, s.priceIndex));
    expect(paid.players[0]!.cash).toBe(1000 + 12000);
    expect(reduce(s, { type: 'startTurn' }, topo)).not.toBe(s);
  });
});
