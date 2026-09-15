/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 四大惡人的落点行为
 */

import { describe, expect, it } from 'vitest';
import {
  BANK_ROBBERY_RATIO_DEN,
  BANK_ROBBERY_RATIO_NUM,
  NPC,
  NPC_HOME,
  THIEF_LOOT_TYPES,
  bankRobbery,
  facilityProtectionFee,
  npcHomeOf,
  npcReturnsHome,
  pickCardToSteal,
  pickVictim,
  protectionFee,
  stealPoints,
  stealsCard,
  stealsPoints,
  thiefTakes,
} from './npc-actions.ts';
import { NPC_NAMES } from './special-actors.ts';
import { truncTowardZero } from './rounding.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { makePlayer } from '../testing/factories.ts';
import { isAlive } from '../state/types.ts';
import type { LandInfo } from '../loaders/map.ts';

describe('★ 谁是谁 —— actor 号就是原版的判据', () => {
  it('4 小偷 / 5 強盜 / 6 流氓 / 7 間諜，与名字表同序', () => {
    expect([NPC.thief, NPC.robber, NPC.thug, NPC.spy]).toEqual([4, 5, 6, 7]);
    expect(NPC_NAMES[NPC.thief - 4]).toBe('小偷');
    expect(NPC_NAMES[NPC.robber - 4]).toBe('強盜');
    expect(NPC_NAMES[NPC.thug - 4]).toBe('流氓');
    expect(NPC_NAMES[NPC.spy - 4]).toBe('間諜');
  });

  it('★ 偷點券只有小偷 @source 0x0041c1fa `cmp [0x49910c], 4`', () => {
    expect(stealsPoints(NPC.thief)).toBe(true);
    for (const a of [NPC.robber, NPC.thug, NPC.spy]) expect(stealsPoints(a)).toBe(false);
  });

  it('★ 奪卡是「actor != 4」—— 三个都会，不止強盜 @source 0x0041c201 jne', () => {
    expect(stealsCard(NPC.thief)).toBe(false);
    for (const a of [NPC.robber, NPC.thug, NPC.spy]) expect(stealsCard(a)).toBe(true);
  });
});

describe('挑受害者', () => {
  const alive = () => true;

  it('★ 主人自己不被偷 @source `位图 & ~(1 << 主人)`', () => {
    expect(pickVictim([1], 1, alive)).toBeNull();
    expect(pickVictim([1, 2], 1, alive)).toBe(2);
  });

  it('★ 只挑下标最小的一个 —— 同格三个人也只偷一个 @source 0x40d293 取最低位', () => {
    expect(pickVictim([3, 1, 2], 0, alive)).toBe(1);
  });

  it('出局的不偷', () => {
    expect(pickVictim([1, 2], 0, (i) => i !== 1)).toBe(2);
    expect(pickVictim([1], 0, () => false)).toBeNull();
  });

  it('没人就没人', () => {
    expect(pickVictim([], 0, alive)).toBeNull();
  });
});

describe('★ 小偷：偷一半點券', () => {
  it('算术右移一位 —— 奇数向下取整 @source `sar edi, 1`', () => {
    expect(stealPoints(900)).toBe(450);
    expect(stealPoints(901)).toBe(450);
    expect(stealPoints(1)).toBe(0);
    expect(stealPoints(0)).toBe(0);
  });
});

describe('奪卡：随机一张，不是第一张', () => {
  it('抽到的一定在手牌里', () => {
    const rng = new WatcomRng();
    rng.setState(999);
    const hand = [3, 7, 11, 21];
    for (let i = 0; i < 200; i++) {
      expect(hand).toContain(pickCardToSteal(hand, rng));
    }
  });

  it('★ 四张牌都抽得到 —— 不是恒取第一张', () => {
    const rng = new WatcomRng();
    rng.setState(4242);
    const hand = [3, 7, 11, 21];
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(pickCardToSteal(hand, rng)!);
    expect(seen.size).toBe(4);
  });

  it('空手就抽不到', () => {
    const rng = new WatcomRng();
    rng.setState(1);
    expect(pickCardToSteal([], rng)).toBeNull();
  });
});

describe('★ 強盜搶銀行：两成，不是一半', () => {
  it('比例是 1/5 —— 常量 [0x463b60] dump 出来是 0.2', () => {
    expect(BANK_ROBBERY_RATIO_NUM / BANK_ROBBERY_RATIO_DEN).toBe(0.2);
  });

  const players = [
    makePlayer({ index: 0, moneyInBank: 100_000 }),
    makePlayer({ index: 1, moneyInBank: 50_000 }),
    makePlayer({ index: 2, moneyInBank: 0 }),
    makePlayer({ index: 3, moneyInBank: 12_345 }),
  ];

  it('每个对手掏两成存款', () => {
    expect(bankRobbery(players, 0, isAlive)).toEqual([
      { from: 1, amount: 10_000 },
      { from: 3, amount: 2469 },
    ]);
  });

  it('★ 主人自己不被抢 @source `if (i == 主人) continue`', () => {
    const r = bankRobbery(players, 1, isAlive);
    expect(r.map((x) => x.from)).toEqual([0, 3]);
  });

  it('存款为零的不入列', () => {
    expect(bankRobbery(players, 0, isAlive).some((r) => r.from === 2)).toBe(false);
  });

  it('出局的不被抢', () => {
    const out = players.map((p, i) => (i === 1 ? { ...p, whoPlays: 0 } : p));
    expect(bankRobbery(out, 0, isAlive).map((x) => x.from)).toEqual([3]);
  });

  it('★ 取整是向零截断（0x0041c383 的 `call 0x457dbc`），不是就近', () => {
    // 正数存款：分母 5，小数部分只可能是 .0/.2/.4/.6/.8，永远撞不到 .5，
    // 故这里与 Math.round 同值 —— 断言与 truncTowardZero 逐点一致。
    for (const bank of [5, 7, 12_345, 99_999]) {
      const p = [makePlayer({ index: 0, moneyInBank: 1 }), makePlayer({ index: 1, moneyInBank: bank })];
      expect(bankRobbery(p, 0, isAlive)[0]?.amount).toBe(truncTowardZero((bank * 1) / 5));
    }
    // 1 的两成截断成 0 → 不入列
    const tiny = [makePlayer({ index: 0, moneyInBank: 1 }), makePlayer({ index: 1, moneyInBank: 1 })];
    expect(bankRobbery(tiny, 0, isAlive)).toEqual([]);
    // ★ 负数方向才分叉：-13 × 0.2 = -2.6 ⇒ 截断 -2、Math.round -3
    const neg = [makePlayer({ index: 0, moneyInBank: 1 }), makePlayer({ index: 1, moneyInBank: -13 })];
    expect(bankRobbery(neg, 0, isAlive)[0]?.amount).toBe(-2);
    expect(truncTowardZero((-13 * 1) / 5)).toBe(-2);
    expect(Math.round((-13 * 1) / 5)).toBe(-3);
  });
});

// ============================================================
//  流氓
// ============================================================

function land(id: number, name: string, price: number): LandInfo {
  return {
    id,
    x: 0,
    y: 0,
    name,
    priceStatus: 0,
    type: 0,
    owner: 0,
    level: 0,
    facing: 0,
    landPrice: price,
    housePrice: 0,
    rentByLevel: [0, 0, 0, 0, 0, 0],
    flast: 0,
  };
}

describe('★ 流氓：保護費按「整片地区」算', () => {
  //  台北市 三格（1/2/3），高雄市 两格（4/5）
  const lands = [
    land(1, '台北市', 1000),
    land(2, '台北市', 2000),
    land(3, '台北市', 3000),
    land(4, '高雄市', 500),
    land(5, '高雄市', 700),
  ];

  it('★ 同名且同主的地價全加起来 —— 不是落点那一格 @source strcmp(名字)', () => {
    // 1、2 归 2 号玩家，3 归别人
    const ownerOf = (id: number) => (id === 1 || id === 2 ? 2 : id === 3 ? 3 : 0);
    expect(protectionFee(lands, ownerOf, lands[0]!, 1)).toBe(1000 + 2000);
  });

  it('★ 同主但不同名的不算 —— 跨地区不并', () => {
    const ownerOf = (id: number) => (id === 1 || id === 4 ? 2 : 0);
    expect(protectionFee(lands, ownerOf, lands[0]!, 1)).toBe(1000);
  });

  it('乘物價指數', () => {
    const ownerOf = (id: number) => (id === 1 || id === 2 ? 2 : 0);
    expect(protectionFee(lands, ownerOf, lands[0]!, 3)).toBe((1000 + 2000) * 3);
  });

  it('无主地勒索不到', () => {
    expect(protectionFee(lands, () => 0, lands[0]!, 1)).toBe(0);
  });

  it('設施只按那一处算，不聚合 @source 0x0041c64e `設施.+0x22 × 物價指數`', () => {
    expect(facilityProtectionFee(4000, 2)).toBe(8000);
  });
});

// ============================================================
//  回老家
// ============================================================

describe('★ 再踩到監獄／醫院就回去', () => {
  it('小偷/強盜出身監獄，流氓/間諜出身醫院', () => {
    expect(npcHomeOf(NPC.thief)).toBe(NPC_HOME.prison);
    expect(npcHomeOf(NPC.robber)).toBe(NPC_HOME.prison);
    expect(npcHomeOf(NPC.thug)).toBe(NPC_HOME.hospital);
    expect(npcHomeOf(NPC.spy)).toBe(NPC_HOME.hospital);
  });

  it('★ 监狱出身的只被監獄格（4）收，不被醫院格（5）收', () => {
    expect(npcReturnsHome(NPC_HOME.prison, true, 4)).toBe(true);
    expect(npcReturnsHome(NPC_HOME.prison, true, 5)).toBe(false);
  });

  it('★ 医院出身的只被醫院格（5）收', () => {
    expect(npcReturnsHome(NPC_HOME.hospital, true, 5)).toBe(true);
    expect(npcReturnsHome(NPC_HOME.hospital, true, 4)).toBe(false);
  });

  it('★ 没「离开过」标记就不收 —— 出獄站的就是那一格，不能当场被收回去', () => {
    expect(npcReturnsHome(NPC_HOME.prison, false, 4)).toBe(false);
    expect(npcReturnsHome(NPC_HOME.hospital, false, 5)).toBe(false);
  });

  it('别的格子一概不收', () => {
    for (const kind of [0, 1, 2, 3, 6, 14]) {
      expect(npcReturnsHome(NPC_HOME.prison, true, kind), `kind ${kind}`).toBe(false);
    }
  });
});

describe('★ 小偷的战利品：五种，一件不多一件不少', () => {
  it('禮物13 / 寶箱14 / 路障16 / 地雷17 / 定時炸彈18', () => {
    expect([...THIEF_LOOT_TYPES].sort((a, b) => a - b)).toEqual([13, 14, 16, 17, 18]);
  });

  it('捡礼物寶箱、拆路障地雷炸彈', () => {
    for (const t of [13, 14, 16, 17, 18]) expect(thiefTakes(t), `种类 ${t}`).toBe(true);
  });

  it('★ 神明（1..12）与死神（15）不在其列 —— 小偷偷不走神', () => {
    for (const t of [1, 5, 11, 12, 15]) expect(thiefTakes(t), `种类 ${t}`).toBe(false);
  });
});
