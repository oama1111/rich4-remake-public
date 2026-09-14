/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 过路费的免收、免費卡/嫁禍卡自动使用、死神顯靈由他人賠償
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { aiScapegoat, aiUsesFreeCard, reaperPayer, tollExemption, tollPassiveTail } from './toll-flow.ts';
import { housingIndexOf } from './land.ts';

const LAND = 1;
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2] }),
    makeNode({ id: 2, adjacent: [1], type: 0x7d0 + LAND, ref: { kind: 'land', index: LAND } }),
  ],
  lands: [makeLand({ id: LAND, landPrice: 1000, housePrice: 200, rentByLevel: [200, 500, 1200, 2800, 6000, 10000] })],
};

/** 0 号站在 1 号地主的 2 级地上，结算前的状态 */
function onRivalLand(over: { payer?: Partial<ReturnType<typeof makePlayer>>; owner?: Partial<ReturnType<typeof makePlayer>>; third?: Partial<ReturnType<typeof makePlayer>> } = {}) {
  const s = makeGameState({
    players: [
      makePlayer({ index: 0, nodeId: 2, cash: 50_000, moneyInBank: 0, ...(over.payer ?? {}) }),
      makePlayer({ index: 1, nodeId: 1, cash: 1000, moneyInBank: 0, ...(over.owner ?? {}) }),
      makePlayer({ index: 2, nodeId: 1, cash: 1000, moneyInBank: 0, ...(over.third ?? {}) }),
    ],
    phase: 'settling',
  });
  const landOwner = [...s.landOwner];
  const landLevel = [...s.landLevel];
  landOwner[LAND] = 2;
  landLevel[LAND] = 2;
  return { ...s, landOwner, landLevel };
}
const settle = (s: ReturnType<typeof onRivalLand>) => reduce(s, { type: 'settle' }, topo);

describe('★ 0x41d559 九种免收', () => {
  it('查封（涨价位两个半字节都非 0）、同盟、死神、被关着/睡着 → 免收；否则 null', () => {
    const base = makePlayer({ index: 1 });
    expect(tollExemption(base, 0, 0)).toBeNull();
    expect(tollExemption(base, 0, 0x51)).toBe('sealed');
    expect(tollExemption(base, 0, 0x30)).toBeNull(); // 只有涨价
    expect(tollExemption({ ...base, alliedPlayer: 1 }, 0, 0)).toBe('ally');
    expect(tollExemption({ ...base, alliedPlayer: 3 }, 0, 0)).toBeNull();
    expect(tollExemption({ ...base, godInfo: 0xf }, 0, 0)).toBe('reaper');
    expect(tollExemption({ ...base, godInfo: 0x10 }, 0, 0)).toBeNull(); // 第二个死神槽不算（原版如此）
    const b = base.blocking;
    expect(tollExemption({ ...base, blocking: { ...b, inHotel: 2 } }, 0, 0)).toBe('hotel');
    expect(tollExemption({ ...base, blocking: { ...b, inPrison: 2 } }, 0, 0)).toBe('prison');
    expect(tollExemption({ ...base, blocking: { ...b, sleepWalking: 1 } }, 0, 0)).toBe('sleepWalking');
  });

  it('接到住宅落点：地主坐牢中一分不收', () => {
    const s = onRivalLand({ owner: { blocking: { inHotel: 0, disappearing: 0, inPrison: 3, inHospital: 0, sleeping: 0, sleepWalking: 0, stopping: 0, tortoiseWalking: 0 } } });
    const after = settle(s);
    expect(after.players[0]!.cash).toBe(50_000);
    expect(after.players[1]!.cash).toBe(1000);
    expect(after.phase).toBe('turnEnd');
  });

  it('接到住宅落点：与地主同盟一分不收；照常时付 1200', () => {
    const allied = settle(onRivalLand({ owner: { alliedPlayer: 1 } }));
    expect(allied.players[0]!.cash).toBe(50_000);
    const normal = settle(onRivalLand());
    expect(normal.players[0]!.cash).toBe(50_000 - 1200);
    expect(normal.landLastToll[LAND]).toBe(1200);
  });
});

describe('★ 0x40fbb8 死神顯靈由他人賠償', () => {
  it('第一个别的在场玩家 god_info 为 14/15 → 他付', () => {
    const ps = [0, 1, 2].map((i) => makePlayer({ index: i }));
    expect(reaperPayer(ps, 0)).toBe(-1);
    expect(reaperPayer(ps.map((p, i) => (i === 2 ? { ...p, godInfo: 0xe } : p)), 0)).toBe(2);
    expect(reaperPayer(ps.map((p, i) => (i === 0 ? { ...p, godInfo: 0xf } : p)), 0)).toBe(-1); // 自己不算
  });

  it('接到住宅落点：2 号带着死神，替 0 号付', () => {
    const after = settle(onRivalLand({ third: { godInfo: 0xf, cash: 5000 } }));
    expect(after.players[0]!.cash).toBe(50_000);
    expect(after.players[2]!.cash).toBe(5000 - 1200);
    expect(after.players[1]!.moneyInBank).toBe(1200);
  });
});

describe('★ 免費卡 / 嫁禍卡 自动使用', () => {
  it('電腦用免費卡的門檻：費 > 現金 或 費 > (rand%3000+3000)×物價', () => {
    const p = makePlayer({ index: 0, cash: 10_000 });
    expect(aiUsesFreeCard(20_000, p, 1, 0)).toBe(true); // 費 > 現金
    expect(aiUsesFreeCard(3001, p, 1, 0)).toBe(true); // 3001 > 3000
    expect(aiUsesFreeCard(2999, p, 1, 0)).toBe(false);
    expect(aiUsesFreeCard(5999, p, 1, 2999)).toBe(false); // 門檻 5999
  });

  it('嫁禍给最恨的人；没有就随机挑没被关着的；門檻 (rand%4000+4000)×物價', () => {
    const ps = [0, 1, 2].map((i) => makePlayer({ index: i, cash: 100_000 }));
    const hate = ps.map((p, i) => (i === 0 ? { ...p, hostility: [0, 0, 50, 0] } : p));
    expect(aiScapegoat(hate, 0, 4001, 1, () => 0)).toBe(2);
    expect(aiScapegoat(hate, 0, 3999, 1, () => 0)).toBe(-1);
    // 没有最恨的人：随机；1 号被关着 → 只剩 2 号
    const jailed = ps.map((p, i) => (i === 1 ? { ...p, blocking: { ...p.blocking, inPrison: 2 } } : p));
    expect(aiScapegoat(jailed, 0, 9000, 1, () => 5)).toBe(2);
  });

  it('接到住宅落点：手里有免費卡且費 > 現金 → 免付、扣卡、lastToll 记 0', () => {
    const s = onRivalLand({ payer: { cash: 100, moneyInBank: 0, cards: [20, 3] } });
    const after = settle(s);
    expect(after.players[0]!.cash).toBe(100);
    expect(after.players[0]!.cards).toEqual([3]);
    expect(after.landLastToll[LAND]).toBe(0);
    expect(after.players[0]!.whoPlays).not.toBe(0); // 没破产
  });

  it('接到住宅落点：手里有嫁禍卡、費 > 現金、恨 2 号 → 2 号付，卡扣掉', () => {
    const s = onRivalLand({ payer: { cash: 100, cards: [19], hostility: [0, 0, 9, 0] }, third: { cash: 9000 } });
    const after = settle(s);
    expect(after.players[0]!.cash).toBe(100);
    expect(after.players[0]!.cards).toEqual([]);
    expect(after.players[2]!.cash).toBe(9000 - 1200);
  });

  it('tollPassiveTail：免費卡先抹成 0，嫁禍就不再触发（原版门槛判两次的自然结果）', () => {
    const ps = [makePlayer({ index: 0, cash: 100, cards: [20, 19] }), makePlayer({ index: 1 })];
    const t = tollPassiveTail(ps, 0, 5000, 1, true, () => 0);
    expect(t).toEqual({ free: true, scapegoat: -1 });
  });
});

describe('sanity', () => {
  it('地块节点映射', () => {
    expect(housingIndexOf(0x7d0 + LAND)).toBe(LAND);
  });
});
