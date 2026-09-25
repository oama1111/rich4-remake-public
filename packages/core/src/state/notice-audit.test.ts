/*
 * 框模板反查补齐的訊息框（2026-09-23）—— `0x440cac` 的 104 个调用点里先前一扇都没弹的那些
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 每条用例名里都带那一处调用点的 VA；格式串在 `@rich4/data` 的 `NOTICE_BOX`（逐字节对过 exe）。
 * 这里只钉 **core 交出来的键 / 参数 / 时长 / 谁会弹**。
 */
import { describe, expect, it } from 'vitest';
import { CARDS, stocksOfMap } from '@rich4/data';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { FACILITY_TYPE_MIN, GOD_BLOCKS_PURCHASE, HOUSING_TYPE_MIN } from '../rules/land.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';
import { npcNotices, reduce, type MapTopology } from './reduce.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, type GameState } from './types.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { loanCapacity } from '../places/bank.ts';

const tiny: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1] })] };

describe('★ 电脑买卖股 @source 0x0042c78c（買進）/ 0x0042d092（賣出）', () => {
  const base = (whoPlays: number): GameState =>
    makeGameState({
      year: 1998,
      month: 1,
      day: 5,
      market: newStockMarket(0),
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, cash: 50_000, moneyInBank: 1_000_000, whoPlays: i === 0 ? whoPlays : WHO_PLAYS_COMPUTER }),
      ),
    });

  /** 让 0 号股票值得买（無企業：近 6 日均价 < 近 24 日均价一半 → +2），调度步停在 `aiStep` */
  const aiAt = (aiStep: number, rngState: number, held = 0): GameState => {
    const s = base(WHO_PLAYS_COMPUTER);
    const history = s.market.history.map((h) => [...h]);
    for (let d = 120; d < 138; d++) history[0]![d] = 100;
    for (let d = 138; d < 144; d++) history[0]![d] = 10;
    const stocks = s.market.stocks.map((x, j) => (j === 0 ? { ...x, f10: x.shares } : x));
    const holdings = s.holdings.map((h, i) => (i === 0 ? h.map((x, j) => (j === 0 ? { amount: held, avgCost: held ? 1 : 0 } : x)) : h));
    const players = s.players.map((p, i) => (i === 0 ? { ...p, stockRatio: 50 } : p));
    return { ...s, phase: 'awaitingRoll', aiStep, rngState, players, holdings, market: { ...s.market, history, stocks } };
  };
  /** 扫种子直到这一步真的成交（入口闸三分之一、名次闸另算） */
  const firstTrade = (aiStep: number, held: number): GameState => {
    for (let seed = 1; seed < 500; seed++) {
      const s0 = aiAt(aiStep, seed, held);
      const s = reduce(s0, { type: 'aiNext' }, tiny);
      if (s.holdings[0]![0]!.amount !== held) return s;
    }
    throw new Error('500 个种子都没成交');
  };

  it('电脑买（调度步 0 → 1，reducer 按 0x42bf03 买）⇒「%s\\n\\n買進%s%d張」`[玩家, 股名, 张数]`，1500 ms（缺省）', () => {
    const s = firstTrade(0, 0);
    const n = s.holdings[0]![0]!.amount;
    expect(n).toBeGreaterThan(0);
    expect(s.notices).toEqual([{ key: 'stock.aiBuy', args: ['約翰喬', stocksOfMap(0)[0]!.name, n] }]);
  });

  it('电脑卖（调度步 1 → 2，reducer 按 0x42c79f 卖**全部**）⇒「賣出」同形', () => {
    const s = firstTrade(1, 100);
    expect(s.holdings[0]![0]!.amount).toBe(0);
    expect(s.notices[0]).toEqual({ key: 'stock.aiSell', args: ['約翰喬', stocksOfMap(0)[0]!.name, 100] });
  });

  it('★ 电脑不再经 buyStock / sellStock 这条 action（那是真人柜台），故那条路不弹', () => {
    const s0 = base(WHO_PLAYS_COMPUTER);
    const s = reduce(s0, { type: 'buyStock', stock: 0, shares: 100 }, tiny);
    expect(s.holdings[0]![0]!.amount).toBe(100);
    expect(s.notices).toBe(s0.notices);
  });

  it('真人在股市柜台买（`0x0042afc6`）**不弹**', () => {
    const s0 = base(WHO_PLAYS_HUMAN);
    const s = reduce(s0, { type: 'buyStock', stock: 0, shares: 100 }, tiny);
    expect(s.holdings[0]![0]!.amount).toBe(100);
    expect(s.notices).toBe(s0.notices);
  });
});

describe('★ 电脑贷款 @source 0x0043694b', () => {
  const atCounter = (whoPlays: number): GameState => {
    const wealth = 1_000_000;
    return makeGameState({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 200_000, moneyInBank: 100_000, loan: 0, whoPlays: i === 0 ? whoPlays : WHO_PLAYS_COMPUTER }),
      ),
      pending: { kind: 'bank', wealth, loanCapacity: loanCapacity(wealth, 0), specialFinance: null },
      phase: 'turnEnd',
    });
  };

  it('电脑借 ⇒「%s\\n\\n向銀行貸款\\n\\n%d元」`[玩家, 贷款字段 +0x24]`', () => {
    const r = reduce(atCounter(WHO_PLAYS_COMPUTER), { type: 'bank', op: 'borrow', amount: 100_000 }, tiny);
    expect(r.players[0]!.loan).toBe(100_000);
    expect(r.notices).toEqual([{ key: 'bank.aiBorrow', args: ['約翰喬', 100_000] }]);
  });

  it('真人借（貸款屏的填数窗）不弹', () => {
    const s = atCounter(WHO_PLAYS_HUMAN);
    const r = reduce(s, { type: 'bank', op: 'borrow', amount: 100_000 }, tiny);
    expect(r.notices).toBe(s.notices);
  });
});

describe('★ 惡人那六句 @source 0x0041c255 / 0x0041c2ea / 0x0041c415 / 0x0041c56e / 0x0041c692 / 0x0041c778', () => {
  const s = makeGameState({ players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i })) });

  it('偷點券 / 奪卡是 1000 ms（`push 0x3e8`），搶銀行 2000 ms（`push 0x7d0`），其余 1500', () => {
    expect(
      npcNotices(
        s,
        [
          { kind: 'points', victim: 1, amount: 250 },
          { kind: 'card', victim: 2, card: 3 },
          { kind: 'robBank', from: 1, amount: 100 },
          { kind: 'robBank', from: 2, amount: 200 },
          { kind: 'robBankDone', total: 300 },
          { kind: 'protection', landlord: 3, amount: 4000 },
          { kind: 'toll', landlord: 3, amount: 700 },
          { kind: 'surplus', landlord: 3, amount: -500, company: 1 },
        ],
        0,
      ),
    ).toEqual([
      { key: 'npc.stealPoints', args: ['沙隆巴斯', 250], holdMs: 1000 },
      { key: 'npc.stealCard', args: ['忍太郎', CARDS[2]!.name], holdMs: 1000 },
      // 搶銀行：循环走完才弹一扇，`%d` = 各笔之和、`%s` = 主人
      { key: 'npc.robBank', args: [300, '約翰喬'], holdMs: 2000 },
      { key: 'npc.protection', args: ['錢夫人', 4000] },
      { key: 'npc.spyToll', args: [700] },
      { key: 'npc.spySurplus', args: [-500] },
    ]);
  });
});

describe('★ 自己的地升级、只差现金 ⇒「您的現金不足！」@source 0x00419a5d', () => {
  const ownLandTopo: MapTopology = {
    nodes: [
      makeNode({ id: 1, type: 0x7d0 + 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
      makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
    ],
    lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 1, level: 0, landPrice: 1000, housePrice: 1000 })],
  };
  const landing = (cash: number, whoPlays: number): GameState =>
    makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, character: i, nodeId: i === 0 ? 1 : 2, cash, whoPlays })),
      phase: 'settling',
      landOwner: [0, 1],
      landLevel: [0, 1],
      landType: [0, 0],
    });

  for (const who of [WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER]) {
    it(`whoPlays ${who}：cash 0 ⇒ 弹框、不问升级`, () => {
      const r = reduce(landing(0, who), { type: 'settle' }, ownLandTopo);
      expect(r.pending).toBeNull();
      expect(r.notices).toEqual([{ key: 'land.cashShort', args: [] }]);
    });
  }

  it('够钱就照常问升级，不弹', () => {
    const s = landing(1_000_000, WHO_PLAYS_HUMAN);
    const r = reduce(s, { type: 'settle' }, ownLandTopo);
    expect(r.pending).toMatchObject({ kind: 'upgradeLand' });
    expect(r.notices).toBe(s.notices);
  });
});

describe('★ 第十六份：買地 / 買設施 / 設施首建 / 設施加蓋 只差现金也弹「您的現金不足！」@source 0x0041a159 / 0x00419a52 → 0x440cac(0x46398b, 0x5dc)', () => {
  const CASH_SHORT = [{ key: 'land.cashShort', args: [] }];
  const LAND = 1;
  const landTopo: MapTopology = {
    nodes: [
      makeNode({ id: 1, type: 0x7d0 + LAND, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
      makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
    ],
    lands: [makeLand({ id: LAND, name: '測試路', type: 0, owner: 0, level: 0, landPrice: 1000, housePrice: 1000 })],
  };
  const FAC = 1;
  const facTopo: MapTopology = {
    nodes: [
      makeNode({ id: 1, type: FACILITY_TYPE_MIN + FAC, ref: { kind: 'facility', index: FAC }, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1] }),
    ],
    lands: [],
    facilities: [makeFacility({ id: FAC, landPrice: 3000, housePrice: 1500 })],
  };
  const standing = (cash: number, whoPlays: number, over: Partial<GameState> = {}, player: Record<string, unknown> = {}): GameState => {
    const s = makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, character: i, nodeId: i === 0 ? 1 : 2, cash, moneyInBank: 0, whoPlays, ...(i === 0 ? player : {}) }),
      ),
      phase: 'settling',
      priceIndex: 1,
    });
    return { ...s, ...over };
  };
  const fac = (owner: number, level: number, type: number): Partial<GameState> => {
    const base = makeGameState();
    const facilityOwner = [...base.facilityOwner];
    const facilityLevel = [...base.facilityLevel];
    const facilityType = [...base.facilityType];
    facilityOwner[FAC] = owner;
    facilityLevel[FAC] = level;
    facilityType[FAC] = type;
    return { facilityOwner, facilityLevel, facilityType };
  };

  for (const who of [WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER]) {
    it(`whoPlays ${who}：買地（0x0041a059 jg 0x41a159）`, () => {
      const r = reduce(standing(999, who, { landOwner: [0, 0], landLevel: [0, 0], landType: [0, 0] }), { type: 'settle' }, landTopo);
      expect(r.pending).toBeNull();
      expect(r.phase).toBe('turnEnd');
      expect(r.notices).toEqual(CASH_SHORT);
    });
    it(`whoPlays ${who}：買設施（0x0041a89d jg 0x41a159）`, () => {
      const r = reduce(standing(2999, who, fac(0, 0, 0)), { type: 'settle' }, facTopo);
      expect(r.pending).toBeNull();
      expect(r.notices).toEqual(CASH_SHORT);
    });
    it(`whoPlays ${who}：設施首建（0x0041a216 jg 0x419a52）—— 选种类框之前、电脑也不掷 rand`, () => {
      const s = standing(2999, who, fac(1, 0, 0));
      const r = reduce(s, { type: 'settle' }, facTopo);
      expect(r.pending).toBeNull();
      expect(r.facilityLevel[FAC]).toBe(0);
      expect(r.rngState).toBe(s.rngState);
      expect(r.notices).toEqual(CASH_SHORT);
    });
    it(`whoPlays ${who}：設施加蓋（0x0041a2e6 jg 0x41a159）`, () => {
      const r = reduce(standing(1499, who, fac(1, 1, FACILITY_TYPE.mall)), { type: 'settle' }, facTopo);
      expect(r.pending).toBeNull();
      expect(r.facilityLevel[FAC]).toBe(1);
      expect(r.notices).toEqual(CASH_SHORT);
    });
  }

  it('钱刚好够 ⇒ 照常问，不弹', () => {
    const land = standing(1000, WHO_PLAYS_HUMAN, { landOwner: [0, 0], landLevel: [0, 0], landType: [0, 0] });
    expect(reduce(land, { type: 'settle' }, landTopo).pending).toMatchObject({ kind: 'buyLand' });
    expect(reduce(standing(3000, WHO_PLAYS_HUMAN, fac(0, 0, 0)), { type: 'settle' }, facTopo).pending).toMatchObject({ kind: 'buyFacility' });
    expect(reduce(standing(3000, WHO_PLAYS_HUMAN, fac(1, 0, 0)), { type: 'settle' }, facTopo).pending).toMatchObject({ kind: 'buildFacility' });
    expect(reduce(standing(1500, WHO_PLAYS_HUMAN, fac(1, 1, FACILITY_TYPE.mall)), { type: 'settle' }, facTopo).pending).toMatchObject({ kind: 'upgradeFacility' });
  });

  it('前面的闸没过就不弹：夢遊 / 土地公（買地 0x0041a01a / 0x0041a027）、夢遊 / 土地公（買設施 0x0041a86b / 0x0041a878）、設施已满级（0x0041a2c8）', () => {
    const noLand = { landOwner: [0, 0], landLevel: [0, 0], landType: [0, 0] };
    // （土地公那一支落进尾块后照样「強佔」—— 只看有没有現金不足那一扇）
    for (const player of [{ blocking: { ...makePlayer().blocking, sleepWalking: 3 } }, { godInfo: GOD_BLOCKS_PURCHASE }]) {
      const l = standing(0, WHO_PLAYS_HUMAN, noLand, player);
      expect(reduce(l, { type: 'settle' }, landTopo).notices).not.toContainEqual(CASH_SHORT[0]);
    }
    // 買設施：夢遊 `0x0041a86b` / 土地公 `0x0041a878`（E-43 裁定）
    for (const player of [{ blocking: { ...makePlayer().blocking, sleepWalking: 3 } }, { godInfo: GOD_BLOCKS_PURCHASE }]) {
      const f = standing(0, WHO_PLAYS_HUMAN, fac(0, 0, 0), player);
      const rf = reduce(f, { type: 'settle' }, facTopo);
      expect(rf.notices).not.toContainEqual(CASH_SHORT[0]);
      expect(rf.pending).toBeNull();
    }
    // 加油站只有一级：满级那道闸先挡 ⇒ 不弹
    const full = standing(0, WHO_PLAYS_HUMAN, fac(1, 1, FACILITY_TYPE.gasStation));
    expect(reduce(full, { type: 'settle' }, facTopo).notices).toBe(full.notices);
  });

  it('★ 框之后照常进尾块：自己的研究所加蓋不起 ⇒ 先框、再问研發（0x00419a62 jmp 0x41b074 → 0x0041b109）', () => {
    const r = reduce(standing(1499, WHO_PLAYS_HUMAN, fac(1, 1, FACILITY_TYPE.lab)), { type: 'settle' }, facTopo);
    expect(r.notices).toEqual(CASH_SHORT);
    expect(r.pending).toMatchObject({ kind: 'research', facilityId: FAC, choices: [1] });
  });
});

describe('★ 卡片函数里的那几扇 @source 0x004425fb / 0x00441ab1 / 0x00444fdb / 0x00445154 / 0x004453ef', () => {
  const scene = (whoPlays: number, over: Partial<GameState> = {}): { state: GameState; topo: MapTopology } => {
    const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
    const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
    const state = makeGameState({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000, whoPlays: i === 0 ? whoPlays : WHO_PLAYS_COMPUTER }),
      ),
      landOwner: [0, 0],
      landLevel: [0, 0],
      ...over,
    });
    return { state, topo: { nodes: [node], lands: [land] } };
  };
  const give = (s: GameState, who: number, cards: number[]): GameState => ({
    ...s,
    players: s.players.map((p, i) => (i === who ? { ...p, cards } : p)),
  });

  it('購地卡（3）只差现金 ⇒「您的現金不足！」、卡**不扣**、别的都不动', () => {
    const { state, topo } = scene(WHO_PLAYS_HUMAN, { landOwner: [0, 2] });
    const s = give({ ...state, players: state.players.map((p, i) => (i === 0 ? { ...p, cash: 10 } : p)) }, 0, [3]);
    const after = reduce(s, { type: 'useCard', cardId: 3 }, topo);
    expect(after.notices).toEqual([{ key: 'card.cashShort', args: [] }]);
    expect(after.players).toBe(s.players);
    expect(after.landOwner).toBe(s.landOwner);
    expect(after.players[0]!.cards).toEqual([3]);
  });

  it('搶奪卡（13）**电脑**抢到卡 ⇒「搶得%s的\\n\\n%s」`[受害者, 卡名]`；真人不弹', () => {
    for (const who of [WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN]) {
      const { state, topo } = scene(who);
      const s = give(give(state, 1, [5]), 0, [13]);
      const after = reduce(
        s,
        { type: 'useCard', cardId: 13, target: { kind: 'player', index: 1, steal: { kind: 'card', id: 5 } } },
        topo,
      );
      expect(after.players[0]!.cards).toContain(5);
      const robbed = (after.notices ?? []).filter((n) => n.key === 'card.robbed');
      expect(robbed).toEqual(who === WHO_PLAYS_COMPUTER ? [{ key: 'card.robbed', args: ['沙隆巴斯', CARDS[4]!.name] }] : []);
    }
  });

  it('查稅卡（26）收到税 ⇒「抽取%s\\n\\n%d元稅金！」`[被查的人, 税额]`（真人电脑都弹）', () => {
    const { state, topo } = scene(WHO_PLAYS_HUMAN);
    const s = give(state, 0, [26]);
    const after = reduce(s, { type: 'useCard', cardId: 26, target: { kind: 'player', index: 2 } }, topo);
    // 税 = trunc(100000 × 0.2)
    expect(after.notices).toContainEqual({ key: 'card.taxed', args: ['忍太郎', 20_000] });
  });
});

describe('★ 电脑用道具「使用%s」@source 0x00448070 —— 排在道具自己的影片之前', () => {
  it('电脑用路障（2）⇒ 队头就是 `tool.aiUse`，带 beforeFilms；真人不弹', async () => {
    const { TOOLS } = await import('@rich4/data');
    const topo: MapTopology = {
      nodes: [makeNode({ id: 1, adjacent: [2] }), makeNode({ id: 2, adjacent: [1, 3] }), makeNode({ id: 3, adjacent: [2] })],
    };
    for (const who of [WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN]) {
      const s0 = makeGameState({
        players: [0, 1].map((i) => makePlayer({ index: i, character: i, nodeId: 1, whoPlays: i === 0 ? who : WHO_PLAYS_COMPUTER })),
        phase: 'awaitingRoll',
      });
      const tools = [...s0.tools];
      tools[0 * 15 + 2] = 1;
      const s = { ...s0, tools };
      const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
      expect(after.tools[2]).toBe(0);
      const head = after.notices?.[0];
      if (who === WHO_PLAYS_COMPUTER) {
        expect(head).toEqual({ key: 'tool.aiUse', args: [TOOLS[1]!.name], beforeFilms: true });
      } else {
        expect((after.notices ?? []).some((n) => n.key === 'tool.aiUse')).toBe(false);
      }
    }
  });
});

describe('★ 貸款屏进门时正暫停放款 ⇒ 右移 100 的那一扇 @source 0x004351f8（`push 0x800005dc`）', () => {
  const atAtm = (whoPlays: number, freeze: number): GameState =>
    makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 5000, moneyInBank: 3000, whoPlays: i === 0 ? whoPlays : WHO_PLAYS_COMPUTER, bankFreezeDays: i === 0 ? freeze : 0 }),
      ),
      pending: { kind: 'atm', landing: true },
      phase: 'turnEnd',
    });

  it('真人：ATM 办完一笔 → 貸款屏开窗那一拍弹「銀行暫停放款\\n\\n還剩%d天！」`[(+0x3c & 0x7f) + 1]`、shiftRight', () => {
    const r = reduce(atAtm(WHO_PLAYS_HUMAN, 2), { type: 'bank', op: 'deposit', amount: 1000 }, tiny);
    expect(r.pending).toMatchObject({ kind: 'bank' });
    expect(r.notices).toEqual([{ key: 'bank.loanFrozen', args: [3], shiftRight: true }]);
  });

  it('没暫停放款就不弹', () => {
    const s = atAtm(WHO_PLAYS_HUMAN, 0);
    const r = reduce(s, { type: 'bank', op: 'deposit', amount: 1000 }, tiny);
    expect(r.pending).toMatchObject({ kind: 'bank' });
    expect(r.notices).toBe(s.notices);
  });
});

describe('★ 航空公司转盘 0「不用出國！」@source 0x0041abf0 / 認購易主 @source 0x0041d2aa', () => {
  const CID = 1;
  const companyTopo = (industry: number): MapTopology => ({
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1, 3], type: 6001, ref: { kind: 'commercial', index: CID } }),
      makeNode({ id: 3, adjacent: [2] }),
    ],
    lands: [],
    commercials: [{
      id: CID, x: 0, y: 0, name: '測試公司', stockIndex: 0, landPrice: 500, type: industry,
      spriteIndex: 0, assetValue: 1_000_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 1000,
    }],
  });
  const landing = (rngState: number, chairman: number | null): GameState => {
    const base = makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, character: i, nodeId: i === 0 ? 2 : 1, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER })),
      phase: 'settling',
      priceIndex: 1,
      rngState,
      commercialShares: [0, 1000],
    });
    const commercialOwners = [...base.commercialOwners];
    while (commercialOwners.length <= CID) commercialOwners.push({ owner: 0, ranking: [0, 0, 0, 0] });
    commercialOwners[CID] = { owner: chairman === null ? 0 : chairman + 1, ranking: [chairman === null ? 0 : chairman + 1, 0, 0, 0] };
    return { ...base, commercialOwners };
  };

  it('别人的航空公司：转到 0 ⇒ 只弹「不用出國！」（不收費）；转到非 0 ⇒ 收費框、不弹它', async () => {
    const { INDUSTRY } = await import('../places/company.ts');
    const topo = companyTopo(INDUSTRY.airline);
    let zero = 0;
    let nonZero = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const r = reduce(landing(seed, 1), { type: 'settle' }, topo);
      const keys = (r.notices ?? []).map((n) => n.key);
      if (keys.includes('company.noTravel')) {
        zero++;
        expect(keys.includes('rent.payChairman')).toBe(false);
        expect(r.players[0]!.cash).toBe(100_000);
      } else if (keys.includes('rent.payChairman')) {
        nonZero++;
      }
    }
    expect(zero).toBeGreaterThan(0);
    expect(nonZero).toBeGreaterThan(0);
  });
});

describe('★ 电脑保釋「保釋%s」@source 0x0043d550（監獄）', () => {
  it('电脑落監獄、掷中保釋 ⇒ 弹框 `[被保的人]`；没掷中不弹', () => {
    const topo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1], specialKind: 4 })] };
    let bailed = 0;
    let skipped = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const prisonOccupancy = new Array<number>(8).fill(0);
      prisonOccupancy[1] = 1;
      const s = makeGameState({
        players: [0, 1].map((i) =>
          makePlayer({ index: i, character: i, nodeId: 1, points: 5000, personality: 0, whoPlays: WHO_PLAYS_COMPUTER, blocking: { ...makePlayer().blocking, inPrison: i === 1 ? 3 : 0 } }),
        ),
        phase: 'settling',
        rngState: seed,
        prisonOccupancy,
      });
      const r = reduce(s, { type: 'settle' }, topo);
      if (r.prisonOccupancy[1] === 0) {
        bailed++;
        expect(r.notices).toContainEqual({ key: 'bail.prison', args: ['沙隆巴斯'] });
      } else {
        skipped++;
        expect((r.notices ?? []).some((n) => n.key === 'bail.prison')).toBe(false);
      }
    }
    expect(bailed).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });
});

describe('★ 特別融資收回的两扇 @source 0x00436ccb / 0x00436cfd', () => {
  it('电脑回合跨进第 2 步：非董事長却欠着的人 ⇒「銀行經營權易主！」+「%s\\n\\n強制償還%d元\\n\\n銀行特別融資！」', () => {
    const s = makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000, moneyInBank: 100_000, whoPlays: WHO_PLAYS_COMPUTER, specialFinance: i === 1 ? 5000 : 0 }),
      ),
      phase: 'awaitingRoll',
      aiStep: 1,
    });
    const r = reduce(s, { type: 'aiNext' }, tiny);
    expect(r.players[1]!.specialFinance).toBe(0);
    expect(r.notices.slice(0, 2)).toEqual([
      { key: 'bank.chairmanChanged', args: [] },
      { key: 'bank.forcedSpecialRepay', args: ['沙隆巴斯', 5000] },
    ]);
  });
});

describe('★ 銀行準備金不足、董事長垫付 @source 0x00436c1f（`push 0x9c4` = 2500 ms）', () => {
  it('ATM 提款把别人的存款提到低于董事長的特別融資 ⇒ 弹「銀行資金準備\\n\\n不足%d元\\n\\n由經營者%s墊付！」`[缺口, 董事長]`', () => {
    const CID = 1;
    const topo: MapTopology = {
      nodes: [makeNode({ id: 1, adjacent: [1] })],
      commercials: [{
        id: CID, x: 0, y: 0, name: '測試銀行', stockIndex: 0, landPrice: 500, type: 7,
        spriteIndex: 0, assetValue: 1_000_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 1000,
      }],
    };
    const base = makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 10_000, moneyInBank: i === 0 ? 30_000 : 500_000, whoPlays: WHO_PLAYS_HUMAN, specialFinance: i === 1 ? 50_000 : 0 }),
      ),
      pending: { kind: 'atm' },
      phase: 'turnEnd',
    });
    const commercialOwners = [...base.commercialOwners];
    while (commercialOwners.length <= CID) commercialOwners.push({ owner: 0, ranking: [0, 0, 0, 0] });
    commercialOwners[CID] = { owner: 2, ranking: [2, 0, 0, 0] };
    const s = { ...base, commercialOwners };
    const r = reduce(s, { type: 'bank', op: 'withdraw', amount: 10_000 }, topo);
    // 除董事長外的存款 = 20000 < 50000 ⇒ 缺 30000
    expect(r.notices).toContainEqual({ key: 'bank.reserveShortfall', args: [30_000, '沙隆巴斯'], holdMs: 2500 });
  });
});
