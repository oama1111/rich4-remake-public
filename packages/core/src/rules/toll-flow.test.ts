/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 过路费的免收、免費卡/嫁禍卡自动使用、死神顯靈由他人賠償
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '@rich4/data';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { WHO_PLAYS_COMPUTER } from '../state/types.ts';
import { decidePending } from '../ai/policy.ts';
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

  // ★★ 审计（ai-move）：候选空（没最恨的人、其余人都被关着）时原版 mode 1 **照样掷门槛**
  //   （`0x004448fc call rand` 在 `0x00444973 cmp ebx,-1` 之前）⇒ 随机流走一格，结果仍是不用
  it('★★ 没有可嫁禍的人：仍掷一次门槛 rand，返回 −1', () => {
    const ps = [0, 1, 2].map((i) =>
      makePlayer({ index: i, cash: 100, blocking: { ...makePlayer().blocking, inHospital: i === 0 ? 0 : 3 } }),
    );
    let draws = 0;
    const rand = (): number => {
      draws++;
      return 0;
    };
    expect(aiScapegoat(ps, 0, 9000, 1, rand)).toBe(-1);
    expect(draws).toBe(1);
  });

  it('接到住宅落点：手里有免費卡且費 > 現金 → 免付、扣卡、lastToll 记 0', () => {
    // 付款方是**电脑**（真人那一支是问一句，见下面「D-008 收口」那一组）
    const s = onRivalLand({ payer: { cash: 100, moneyInBank: 0, cards: [20, 3], whoPlays: WHO_PLAYS_COMPUTER } });
    const after = settle(s);
    expect(after.players[0]!.cash).toBe(100);
    expect(after.players[0]!.cards).toEqual([3]);
    expect(after.landLastToll[LAND]).toBe(0);
    expect(after.players[0]!.whoPlays).not.toBe(0); // 没破产
  });

  it('接到住宅落点：手里有嫁禍卡、費 > 現金、恨 2 号 → 2 号付，卡扣掉', () => {
    const s = onRivalLand({ payer: { cash: 100, cards: [19], hostility: [0, 0, 9, 0], whoPlays: WHO_PLAYS_COMPUTER }, third: { cash: 9000 } });
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

// ============================================================
//  ★★ 第十四份（D-008 收口）：真人那两问是待决交互 + 答复 action
// ============================================================

describe('★★ 真人：免費卡问一句（`fcn_00444a60` 真人支 `0x00444ad8`..`0x00444afe`）', () => {
  const human = () => onRivalLand({ payer: { cash: 100, moneyInBank: 0, cards: [20, 3] } });

  it('★ 落点那一拍停在 `freeCard`（问句 `%s` = 付款方名字）；钱一分没动', () => {
    const after = settle(human());
    expect(after.phase).toBe('awaitingDecision');
    expect(after.pending?.kind).toBe('freeCard');
    const p = after.pending as Extract<NonNullable<typeof after.pending>, { kind: 'freeCard' }>;
    expect(p.name).toBe(CHARACTERS[after.players[0]!.character]!.name);
    expect(after.players[0]!.cards).toEqual([20, 3]);
    expect(after.notices.map((n) => n.key)).toEqual(['rent.payOneOwner']);
  });

  it('★★ 答 YES ⇒ 用卡、一分不付；亮牌那一扇排在收費框后面；出牌者说、地主回一句', () => {
    const asked = settle(human());
    const after = reduce(asked, { type: 'answerFreeCard', use: true }, topo);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('turnEnd');
    expect(after.players[0]!.cards).toEqual([3]);
    expect(after.players[0]!.cash).toBe(100);
    // 这一条 action 自己弹的只有亮牌那一扇（收費框在问之前那一条已经弹过）
    expect(after.notices.map((n) => n.key)).toEqual(['card.use']);
    expect(after.notices[0]).toMatchObject({ card: 20, args: ['免費卡'] });
    expect(after.lastCardPlay).toEqual({ player: 0, cardId: 20, popup: false, answeredBy: 1 });
  });

  it('★ 答 NO / 右键（`declineDecision`）⇒ 卡留着、照付（付不起就破产）', () => {
    for (const a of [{ type: 'answerFreeCard', use: false } as const, { type: 'declineDecision' } as const]) {
      const after = reduce(settle(human()), a, topo);
      expect(after.pending).toBeNull();
      expect(after.notices.map((n) => n.key)).not.toContain('card.use');
      // 現金 100 付 1200 ⇒ 破產出局（卡随破產清掉）
      expect(after.players[0]!.whoPlays).toBe(0);
    }
    // 付得起的那种：卡留着、照付
    const rich = onRivalLand({ payer: { cash: 100, moneyInBank: 0, cards: [20, 3] } });
    const richer = { ...rich, landLevel: rich.landLevel.map((v, i) => (i === LAND ? 4 : v)) };
    const asked = settle({ ...richer, players: richer.players.map((q, i) => (i === 0 ? { ...q, cash: 30_000 } : q)) });
    expect(asked.pending?.kind).toBe('freeCard'); // 費 ≥ 2000 ⇒ 照样问
    const paid = reduce(asked, { type: 'answerFreeCard', use: false }, topo);
    expect(paid.players[0]!.cards).toEqual([20, 3]);
    expect(paid.players[0]!.cash).toBe(30_000 - paid.landLastToll[LAND]!);
  });

  it('★ 託管（`use: null`）⇒ 按电脑那一支判（費 > 現金 ⇒ 用）', () => {
    const after = reduce(settle(human()), { type: 'answerFreeCard', use: null }, topo);
    expect(after.players[0]!.cards).toEqual([3]);
  });

  it('★ 门槛不够（費 1200 < 2000 且付得起）⇒ 根本不问', () => {
    const after = settle(onRivalLand({ payer: { cards: [20] } }));
    expect(after.pending).toBeNull();
    expect(after.players[0]!.cards).toEqual([20]);
  });
});

describe('★★ 真人：嫁禍卡（`fcn_0044476a` 真人支 `0x004447a1`..`0x004448ab`）', () => {
  const human = () => onRivalLand({ payer: { cash: 100, cards: [19] }, third: { cash: 9000 } });

  it('★★ 先亮牌「嫁禍卡生效！」再问；候选 = 在场、不是自己（按下标序）', () => {
    const after = settle(human());
    expect(after.pending?.kind).toBe('scapegoat');
    const p = after.pending as Extract<NonNullable<typeof after.pending>, { kind: 'scapegoat' }>;
    expect(p.candidates).toEqual([1, 2]);
    expect(after.notices.map((n) => n.key)).toEqual(['rent.payOneOwner', 'card.scapegoatOn']);
    expect(after.notices[1]).toMatchObject({ card: 19 });
    expect(after.players[0]!.cards).toEqual([19]);
  });

  it('★★ 选 2 号 ⇒ 扣卡、2 号付；出牌者说、替死鬼回一句；真人这一支**没有**「嫁禍給%s！」那一扇', () => {
    const asked = settle(human());
    const after = reduce(asked, { type: 'answerScapegoat', target: 2 }, topo);
    expect(after.players[0]!.cards).toEqual([]);
    expect(after.players[0]!.cash).toBe(100);
    expect(after.players[2]!.cash).toBe(9000 - 1200);
    expect(after.lastCardPlay).toEqual({ player: 0, cardId: 19, popup: false, answeredBy: 2 });
    // 这一条 action 什么框都不弹（亮牌在问之前那一条）—— `notices` 原样带过去（引用不变 = 不重弹）
    expect(after.notices).toBe(asked.notices);
  });

  it('★ −1（NO / 右键）⇒ 卡留着、自己付；不在候选里的人 ⇒ 拒收', () => {
    const asked = settle(human());
    const after = reduce(asked, { type: 'answerScapegoat', target: -1 }, topo);
    expect(after.pending).toBeNull();
    expect(after.lastCardPlay).toBeNull();
    expect(after.players[0]!.whoPlays).toBe(0); // 現金 100 自己付 1200 ⇒ 破產
    expect(reduce(asked, { type: 'answerScapegoat', target: 0 }, topo)).toBe(asked);
  });
});

describe('★★ 託管（服务器 AI 接管 / 超时）答这两问：`decidePending` 交 `null`，reducer 按电脑那一支判', () => {
  it('免費卡 / 嫁禍卡都给 `null`', () => {
    const asked = settle(onRivalLand({ payer: { cash: 100, moneyInBank: 0, cards: [20] } }));
    expect(decidePending(asked)).toEqual({ type: 'answerFreeCard', use: null });
    const asked2 = settle(onRivalLand({ payer: { cash: 100, cards: [19], hostility: [0, 0, 9, 0] }, third: { cash: 9000 } }));
    expect(decidePending(asked2)).toEqual({ type: 'answerScapegoat', target: null });
    // 电脑规则：恨 2 号 ⇒ 2 号付；託管那一支不再亮一遍牌，只弹「嫁禍給%s！」
    const after = reduce(asked2, { type: 'answerScapegoat', target: null }, topo);
    expect(after.players[2]!.cash).toBe(9000 - 1200);
    expect(after.notices.map((n) => n.key)).toEqual(['card.scapegoatTo']);
  });
});
