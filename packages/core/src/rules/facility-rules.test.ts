/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 設施：買／首建／加蓋、轉盤、地契年限、每日到期扫描、間諜取費
 */

import { describe, expect, it } from 'vitest';
import {
  FACILITY_MAX_LEVEL,
  FACILITY_NAMES,
  FACILITY_TYPE,
  LAND_TENURE_TABLE,
  WHEEL,
  WHEEL_TABLE,
  addPackedDate,
  aiPickFacilityType,
  canUpgradeFacility,
  facilityBuildPrice,
  facilityBuyPrice,
  facilityUpgradePrice,
  hotelStayLoss,
  spinWheel,
  tenureExpiresToday,
  tenureExpiry,
} from './facility.ts';
import { packDate } from './calendar.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { makeFacility, makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { FACILITY_TYPE_MIN } from './land.ts';
import { RELEASE_PENDING } from './blocking.ts';
import { WHO_PLAYS_HUMAN, type GameState } from '../state/types.ts';
import { NPC } from './npc-actions.ts';
import { runNpc, spyTollAt } from './npc-walk.ts';
import { releaseNpc } from './special-actors.ts';

// ============================================================
//  轉盤
// ============================================================

describe('★ 轉盤：12 格一圈，空格不算数', () => {
  it('表与 0x00475d0c 一字不差', () => {
    expect(WHEEL_TABLE[WHEEL.hotel]).toEqual([0xff, 0xff, 1, 0xff, 0xff, 4, 0xff, 3, 0xff, 0xff, 2, 0xff]);
    expect(WHEEL_TABLE[WHEEL.mall]).toEqual([1, 0xff, 6, 0xff, 5, 0xff, 4, 0xff, 3, 0xff, 2, 0xff]);
    expect(WHEEL_TABLE[WHEEL.insurance]).toEqual([5, 0xff, 3, 0xff, 30, 0xff, 20, 0xff, 15, 0xff, 10, 0xff]);
  });

  it('★ 起点落在空格就往前走到第一个数字格 @source 0x0043f9fa', () => {
    // 旅館表：0,1 → 走到 2(=1)；3,4 → 5(=4)；6 → 7(=3)；8,9 → 10(=2)；11 → 绕回 2(=1)
    expect(spinWheel(WHEEL.hotel, 0)).toBe(1);
    expect(spinWheel(WHEEL.hotel, 1)).toBe(1);
    expect(spinWheel(WHEEL.hotel, 3)).toBe(4);
    expect(spinWheel(WHEEL.hotel, 6)).toBe(3);
    expect(spinWheel(WHEEL.hotel, 9)).toBe(2);
    expect(spinWheel(WHEEL.hotel, 11)).toBe(1);
  });

  it('购物中心倍数落在 1..6，旅館天数落在 1..4', () => {
    for (let r = 0; r < 12; r++) {
      expect([1, 2, 3, 4, 5, 6]).toContain(spinWheel(WHEEL.mall, r));
      expect([1, 2, 3, 4]).toContain(spinWheel(WHEEL.hotel, r));
    }
  });

  it('分布：旅館 1 天 4/12、2 天 3/12、3 天 2/12、4 天 3/12', () => {
    const count = new Map<number, number>();
    for (let r = 0; r < 12; r++) {
      const v = spinWheel(WHEEL.hotel, r);
      count.set(v, (count.get(v) ?? 0) + 1);
    }
    expect(count.get(1)).toBe(4);
    expect(count.get(2)).toBe(3);
    expect(count.get(3)).toBe(2);
    expect(count.get(4)).toBe(3);
  });

  it('不存在的轉盤返回 0', () => {
    expect(spinWheel(9, 3)).toBe(0);
  });
});

// ============================================================
//  地契年限
// ============================================================

describe('★ 土地權限：六档年限', () => {
  it('表与 0x004751f0 一致：無限期 / 2年 / 1年 / 6個月 / 3個月 / 1個月', () => {
    expect(LAND_TENURE_TABLE).toEqual([0, 0x20000, 0x10000, 0x600, 0x300, 0x100]);
  });

  it('打包日期相加，月份溢出进位到年 @source 0x004521cb', () => {
    const jan = packDate({ year: 2000, month: 1, day: 5 });
    expect(addPackedDate(jan, 0x600)).toBe(packDate({ year: 2000, month: 7, day: 5 }));
    // 10 月 + 3 個月 = 13 月 → 次年 1 月
    const oct = packDate({ year: 2000, month: 10, day: 5 });
    expect(addPackedDate(oct, 0x300)).toBe(packDate({ year: 2001, month: 1, day: 5 }));
    // 整年不动月
    expect(addPackedDate(oct, 0x20000)).toBe(packDate({ year: 2002, month: 10, day: 5 }));
  });

  it('無限期写 0；其余写今天 + 年限', () => {
    const today = packDate({ year: 2000, month: 3, day: 1 });
    expect(tenureExpiry(today, 0)).toBe(0);
    expect(tenureExpiry(today, 5)).toBe(packDate({ year: 2000, month: 4, day: 1 }));
  });

  it('★ 到期判定是「等于今天」，不是「早于今天」 @source cmp / jne', () => {
    const d = packDate({ year: 2000, month: 4, day: 1 });
    expect(tenureExpiresToday(d, d)).toBe(true);
    expect(tenureExpiresToday(d, d + 1)).toBe(false);
    expect(tenureExpiresToday(0, d)).toBe(false);
  });
});

// ============================================================
//  價與上限
// ============================================================

describe('買、首建、加蓋的价', () => {
  it('買與首建按地價、加蓋按房價，都乘物價', () => {
    expect(facilityBuyPrice(3000, 2)).toBe(6000);
    expect(facilityBuildPrice(3000, 2)).toBe(6000);
    expect(facilityUpgradePrice(1500, 3)).toBe(4500);
  });

  it('★ 公園/加油站只有一级，其余五级', () => {
    expect(canUpgradeFacility(FACILITY_TYPE.park, 1)).toBe(false);
    expect(canUpgradeFacility(FACILITY_TYPE.gasStation, 1)).toBe(false);
    expect(canUpgradeFacility(FACILITY_TYPE.hotel, 4)).toBe(true);
    expect(canUpgradeFacility(FACILITY_TYPE.hotel, 5)).toBe(false);
    expect(FACILITY_MAX_LEVEL).toEqual([1, 5, 5, 1, 5]);
  });

  it('★ 电脑首建 rand()%4+1 —— 永远不蓋公園', () => {
    const rng = new WatcomRng();
    rng.setState(3);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(aiPickFacilityType(rng.next()));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('旅館住宿的損失记账 = 2000 × 天 × 物價', () => {
    expect(hotelStayLoss(3, 2)).toBe(12000);
  });

  it('五个名字与 0x00463847 起的串一致', () => {
    expect(FACILITY_NAMES).toEqual(['公  園', '旅  館', '購物中心', '加油站', '研究所']);
  });
});

// ============================================================
//  接到 reducer：一个設施格的小图
// ============================================================

const FAC_ID = 1;
const facNode = makeNode({
  id: 2,
  adjacent: [1, 3],
  type: FACILITY_TYPE_MIN + FAC_ID,
  ref: { kind: 'facility', index: FAC_ID },
});
const topo: MapTopology = {
  nodes: [makeNode({ id: 1, adjacent: [2] }), facNode, makeNode({ id: 3, adjacent: [2] })],
  lands: [],
  facilities: [
    makeFacility({
      id: FAC_ID,
      landPrice: 3000,
      housePrice: 1500,
      rateByLevel: [1500, 1000, 2000, 4000, 8000, 16000],
    }),
  ],
};

function standing(over: Partial<GameState> = {}, who = WHO_PLAYS_HUMAN): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) =>
      makePlayer({ index: i, nodeId: i === 0 ? 2 : 1, cash: 100_000, moneyInBank: 0, whoPlays: who }),
    ),
    phase: 'settling',
    priceIndex: 1,
    ...over,
  });
  return s;
}

describe('★ 走到設施上：買 / 首建 / 加蓋 / 收費', () => {
  it('无主 → 弹「買下」，价 = 地價 × 物價；答应了就归我、扣现金', () => {
    const s = standing();
    const asked = reduce(s, { type: 'settle' }, topo);
    expect(asked.pending).toMatchObject({ kind: 'buyFacility', facilityId: FAC_ID, price: 3000 });
    const bought = reduce(asked, { type: 'buyFacility' }, topo);
    expect(bought.facilityOwner[FAC_ID]).toBe(1);
    expect(bought.players[0]?.cash).toBe(97_000);
    expect(bought.pending).toBeNull();
  });

  it('★ 土地權限非無限期时，買下就写到期日', () => {
    const s = standing({ landTenureIndex: 5, year: 2000, month: 3, day: 1 });
    const asked = reduce(s, { type: 'settle' }, topo);
    const bought = reduce(asked, { type: 'buyFacility' }, topo);
    expect(bought.facilityTenure[FAC_ID]).toBe(packDate({ year: 2000, month: 4, day: 1 }));
  });

  it('买不起就什么也不弹', () => {
    const s = standing({ players: [makePlayer({ index: 0, nodeId: 2, cash: 100 })] });
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.pending).toBeNull();
    expect(r.phase).toBe('turnEnd');
  });

  it('自己的空地 → 真人弹「选建筑」五选一；选了就 1 级、扣地價', () => {
    const owner = [...standing().facilityOwner];
    owner[FAC_ID] = 1;
    const s = standing({ facilityOwner: owner });
    const asked = reduce(s, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buildFacility');
    if (asked.pending?.kind !== 'buildFacility') return;
    expect(asked.pending.choices).toEqual([0, 1, 2, 3, 4]);
    const built = reduce(asked, { type: 'buildFacility', facilityType: FACILITY_TYPE.hotel }, topo);
    expect(built.facilityType[FAC_ID]).toBe(FACILITY_TYPE.hotel);
    expect(built.facilityLevel[FAC_ID]).toBe(1);
    expect(built.players[0]?.cash).toBe(97_000);
  });

  it('★ 电脑的空地不弹窗：当场 rand()%4+1 定种类', () => {
    const owner = [...standing().facilityOwner];
    owner[FAC_ID] = 1;
    const s = standing({ facilityOwner: owner }, 2);
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.pending).toBeNull();
    expect(r.facilityLevel[FAC_ID]).toBe(1);
    expect([1, 2, 3, 4]).toContain(r.facilityType[FAC_ID]);
    expect(r.rngState).not.toBe(s.rngState);
  });

  it('自己的已建設施 → 弹「加蓋」，价 = 房價 × 物價', () => {
    const base = standing();
    const owner = [...base.facilityOwner];
    const level = [...base.facilityLevel];
    const type = [...base.facilityType];
    owner[FAC_ID] = 1;
    level[FAC_ID] = 2;
    type[FAC_ID] = FACILITY_TYPE.mall;
    const s = standing({ facilityOwner: owner, facilityLevel: level, facilityType: type });
    const asked = reduce(s, { type: 'settle' }, topo);
    expect(asked.pending).toMatchObject({ kind: 'upgradeFacility', cost: 1500, level: 2 });
    const up = reduce(asked, { type: 'upgradeFacility' }, topo);
    expect(up.facilityLevel[FAC_ID]).toBe(3);
  });

  it('★ 加油站只有一级 —— 蓋满了不再弹', () => {
    const base = standing();
    const owner = [...base.facilityOwner];
    const level = [...base.facilityLevel];
    const type = [...base.facilityType];
    owner[FAC_ID] = 1;
    level[FAC_ID] = 1;
    type[FAC_ID] = FACILITY_TYPE.gasStation;
    const s = standing({ facilityOwner: owner, facilityLevel: level, facilityType: type });
    expect(reduce(s, { type: 'settle' }, topo).pending).toBeNull();
  });

  function othersFacility(type: number, level = 1): GameState {
    const base = standing();
    const owner = [...base.facilityOwner];
    const lv = [...base.facilityLevel];
    const ty = [...base.facilityType];
    owner[FAC_ID] = 2;
    lv[FAC_ID] = level;
    ty[FAC_ID] = type;
    return standing({ facilityOwner: owner, facilityLevel: lv, facilityType: ty });
  }

  it('别人的空地／公園／研究所不收费', () => {
    for (const s of [othersFacility(FACILITY_TYPE.hotel, 0), othersFacility(FACILITY_TYPE.park), othersFacility(FACILITY_TYPE.lab)]) {
      const r = reduce(s, { type: 'settle' }, topo);
      expect(r.players[0]?.cash).toBe(100_000);
    }
  });

  it('★ 購物中心：单价 × 轉盤倍数，倍数落在 1..6，钱进地主账、记下这一笔', () => {
    const s = othersFacility(FACILITY_TYPE.mall, 1);
    const r = reduce(s, { type: 'settle' }, topo);
    const paid = 100_000 - (r.players[0]?.cash ?? 0);
    // 单价 = rateByLevel[1] × 物價 = 1000
    expect(paid % 1000).toBe(0);
    expect([1, 2, 3, 4, 5, 6]).toContain(paid / 1000);
    // @source 0x0041a74f `pay_money(…, 0)` —— bit0 未置，地主这笔**進存款**
    expect(r.players[1]?.moneyInBank).toBe(paid);
    expect(r.players[1]?.cash).toBe(100_000);
    expect(r.facilityLastToll[FAC_ID]).toBe(paid);
  });

  it('★ 旅館：轉盤的数既是倍数也是住几天；住店记倒楣天数与損失', () => {
    const s = othersFacility(FACILITY_TYPE.hotel, 1);
    const r = reduce(s, { type: 'settle' }, topo);
    const paid = 100_000 - (r.players[0]?.cash ?? 0);
    const days = paid / 1000;
    expect([1, 2, 3, 4]).toContain(days);
    const b = r.players[0]!.blocking;
    // days − 1，为 0 时挂 0x80
    expect(b.inHotel).toBe(days === 1 ? RELEASE_PENDING : days - 1);
    expect(r.players[0]!.totalWinterSleepDays).toBe(days);
    // 本月支出 = 住宿費（pay_money 已累计）+ 那笔 2000×天×物價 的損失记账
    expect(r.players[0]!.monthlyPaid).toBe(paid + hotelStayLoss(days, 1));
  });

  it('轉盤消耗随机数，同一状态重放结果一致（C-DET-4）', () => {
    const s = othersFacility(FACILITY_TYPE.mall, 1);
    const a = reduce(s, { type: 'settle' }, topo);
    const b = reduce(s, { type: 'settle' }, topo);
    expect(a.rngState).not.toBe(s.rngState);
    expect(a.players[0]?.cash).toBe(b.players[0]?.cash);
  });
});

// ============================================================
//  每日到期扫描
// ============================================================

describe('★ 每日推进：地契到期归无主，房子留着', () => {
  function endOfDay(over: Partial<GameState>): GameState {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1 }), makePlayer({ index: 1, nodeId: 1 })],
      phase: 'turnEnd',
      year: 2000,
      month: 3,
      day: 31,
      ...over,
    });
    return reduce(s, { type: 'endTurn' }, topo);
  }

  it('到期日 == 明天 → 推进一天后 owner 清零、到期日清零、等级不动', () => {
    const base = makeGameState({});
    const landOwner = [...base.landOwner];
    const landLevel = [...base.landLevel];
    const landTenure = [...base.landTenure];
    landOwner[3] = 2;
    landLevel[3] = 4;
    landTenure[3] = packDate({ year: 2000, month: 4, day: 1 });
    const r = endOfDay({ landOwner, landLevel, landTenure });
    expect(r.day).toBe(1);
    expect(r.landOwner[3]).toBe(0);
    expect(r.landTenure[3]).toBe(0);
    expect(r.landLevel[3]).toBe(4);
  });

  it('設施同理', () => {
    const base = makeGameState({});
    const facilityOwner = [...base.facilityOwner];
    const facilityTenure = [...base.facilityTenure];
    facilityOwner[2] = 1;
    facilityTenure[2] = packDate({ year: 2000, month: 4, day: 1 });
    const r = endOfDay({ facilityOwner, facilityTenure });
    expect(r.facilityOwner[2]).toBe(0);
    expect(r.facilityTenure[2]).toBe(0);
  });

  it('没到那天不动；無限期永远不动', () => {
    const base = makeGameState({});
    const landOwner = [...base.landOwner];
    const landTenure = [...base.landTenure];
    landOwner[3] = 2;
    landTenure[3] = packDate({ year: 2000, month: 4, day: 2 });
    landOwner[4] = 1;
    landTenure[4] = 0;
    const r = endOfDay({ landOwner, landTenure });
    expect(r.landOwner[3]).toBe(2);
    expect(r.landOwner[4]).toBe(1);
  });
});

// ============================================================
//  間諜取走上一次過路費
// ============================================================

describe('★ 間諜：取走這塊地上一次收的過路費', () => {
  const landNode = makeNode({ id: 3, adjacent: [2, 4], type: 2001, ref: { kind: 'land', index: 1 } });
  const spyTopo = {
    nodes: [makeNode({ id: 1, adjacent: [2] }), makeNode({ id: 2, adjacent: [1, 3] }), landNode, makeNode({ id: 4, adjacent: [3] })],
    lands: [],
  };

  function withToll(lastToll: number, landlord = 2): GameState {
    const base = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 20, moneyInBank: 0 }), makePlayer({ index: 1, nodeId: 20, cash: 50_000 })],
    });
    const landOwner = [...base.landOwner];
    const landLastToll = [...base.landLastToll];
    landOwner[1] = landlord;
    landLastToll[1] = lastToll;
    return { ...base, landOwner, landLastToll };
  }

  it('地块上一次收了 8000 → 間諜取 8000 给主人，進存款', () => {
    const s = withToll(8000);
    expect(spyTollAt(s, landNode)).toEqual({ landlord: 1, amount: 8000 });
    const rng = new WatcomRng();
    rng.setState(1);
    const w = runNpc(NPC.spy, releaseNpc(1, 0, 3), s, spyTopo, (f) => f + 1, rng);
    expect(w.events).toContainEqual({ kind: 'toll', landlord: 1, amount: 8000 });
  });

  it('从没收过租的地取不到；主人自己的地不取', () => {
    expect(spyTollAt(withToll(0), landNode)?.amount).toBe(0);
    const rng = new WatcomRng();
    rng.setState(1);
    const mine = withToll(8000, 1);
    const w = runNpc(NPC.spy, releaseNpc(1, 0, 3), mine, spyTopo, (f) => f + 1, rng);
    expect(w.events.filter((e) => e.kind === 'toll')).toEqual([]);
  });

  it('★ 只有間諜取 —— 小偷/強盜/流氓路过不取', () => {
    const s = withToll(8000);
    for (const actor of [NPC.thief, NPC.robber, NPC.thug]) {
      const rng = new WatcomRng();
      rng.setState(1);
      const w = runNpc(actor, releaseNpc(1, 0, 3), s, spyTopo, (f) => f + 1, rng);
      expect(w.events.filter((e) => e.kind === 'toll'), `actor ${actor}`).toEqual([]);
    }
  });
});
