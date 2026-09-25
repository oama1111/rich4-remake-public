/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 出牌接入 reduce
 *
 * ★ 卡片效果本身在 cards/ 下各自有测试，这里只验**接驳**：
 *   状态进得去、结果合得回来、失败时原样不动。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import { actingSeat } from '../net/acting-seat.ts';
import type { GameState } from './types.ts';
import { IMPLEMENTED_CARD_IDS } from '../cards/registry.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { applyBlackCard, blackCardHostilityDeltas } from '../cards/swap-and-stock.ts';
import { applyStockNews } from '../places/stock-market.ts';
import { HOUSING_TYPE_MIN } from '../rules/land.ts';
import { tenureExpiry } from '../rules/facility.ts';
import { packDate } from '../rules/calendar.ts';

/** 一块住宅地 + 站在上面的四个玩家 */
function scene(over: Partial<GameState> = {}): {
  state: GameState;
  topo: { nodes: ReturnType<typeof makeNode>[]; lands: ReturnType<typeof makeLand>[] };
} {
  const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
  const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
  const state = makeGameState({
    phase: 'awaitingRoll',
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000 }),
    ),
    landOwner: [0, 0],
    landLevel: [0, 0],
    ...over,
  });
  return { state, topo: { nodes: [node], lands: [land] } };
}

const give = (s: GameState, who: number, cardId: number): GameState => ({
  ...s,
  players: s.players.map((p, i) => (i === who ? { ...p, cards: [cardId] } : p)),
});

describe('★ 出牌入口', () => {
  it('★ 均富卡（1）把现金拉平 —— 效果真的落到状态上了', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 1);
    s = {
      ...s,
      players: s.players.map((p, i) => ({ ...p, cash: [100_000, 0, 0, 0][i]! })),
    };
    const after = reduce(s, { type: 'useCard', cardId: 1 }, topo);
    const cash = after.players.map((p) => p.cash);
    expect(new Set(cash).size, `现金应当被拉平，实际 ${cash.join('/')}`).toBe(1);
    // 卡被消耗
    expect(after.players[0]!.cards).toHaveLength(0);
  });

  it('★★ 出的那张**回牌堆**（`remove_card` 0x004413a2 `inc [卡号+0x499197]`）；搶奪卡满手弃掉的也回', () => {
    const { state, topo } = scene();
    const pool = new Array<number>(30).fill(0);
    let s: GameState = { ...give(state, 0, 1), cardAmount: pool };
    s = { ...s, players: s.players.map((p, i) => ({ ...p, cash: [100_000, 0, 0, 0][i]! })) };
    const after = reduce(s, { type: 'useCard', cardId: 1 }, topo);
    expect(after.players[0]!.cards).toEqual([]);
    expect(after.cardAmount[0]).toBe(1);
    // 搶奪卡（13）：自己满 15 张（14 张改建卡 7 + 搶奪卡本身）抢到 1 张均富卡 ——
    //   出的搶奪卡 +1；对方交出的均富卡 +1 −1 相抵；满手弃掉的最便宜那张（改建卡 15 點）+1。
    //   ⚠️ 搶奪卡本身要等抢完才扣（`0x00443f08 call 0x44192a` 在 `0x00443f40 call 0x441343` 之前）
    //   ⇒ 收牌那一刻手上正好 15 张 ⇒ 弃牌，最后剩 14 张。
    const robber: GameState = {
      ...s,
      cardAmount: new Array<number>(30).fill(0),
      players: s.players.map((p, i) =>
        i === 0 ? { ...p, cards: [13, ...new Array<number>(14).fill(7)] } : i === 1 ? { ...p, cards: [1] } : p,
      ),
    };
    const robbed = reduce(robber, { type: 'useCard', cardId: 13, target: { kind: 'player', index: 1, steal: { kind: 'card', id: 1 } } }, topo);
    expect(robbed.players[0]!.cards).toHaveLength(14);
    expect(robbed.players[0]!.cards).toContain(1);
    expect(robbed.cardAmount[12]).toBe(1);
    expect(robbed.cardAmount[6]).toBe(1);
    expect(robbed.cardAmount[0]).toBe(0);
  });

  it('★ 手上没有这张卡就什么都不发生', () => {
    const { state, topo } = scene();
    expect(reduce(state, { type: 'useCard', cardId: 1 }, topo)).toBe(state);
  });

  it('★ 被动卡不能主动打 —— 原版函数体就是 xor eax,eax; ret', () => {
    const { state, topo } = scene();
    // 21 免罪卡是被动卡
    const s = give(state, 0, 21);
    expect(reduce(s, { type: 'useCard', cardId: 21 }, topo)).toBe(s);
  });

  it('★ 搶奪卡（13）抢到手牌 —— 挑哪一张由 `target.steal` 传入（T-053 的选牌窗喂它）', () => {
    const { state, topo } = scene();
    let s = give(state, 1, 5); // 目标手里有一张 5 号卡
    s = give(s, 0, 13);
    const after = reduce(s, {
      type: 'useCard',
      cardId: 13,
      target: { kind: 'player', index: 1, steal: { kind: 'card', id: 5 } },
    }, topo);
    expect(after).not.toBe(s);
    // 卡从目标手里转到我手里，出牌的 13 被消耗
    expect(after.players[1]!.cards).not.toContain(5);
    expect(after.players[0]!.cards).toContain(5);
    expect(after.players[0]!.cards).not.toContain(13);
  });

  it('★ 搶奪卡（13）走道具路径 —— `steal.kind === \'tool\'`', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 13);
    // 目标（1 号）身上有 3 号道具：`tools[玩家 * 15 + 道具号]`
    s = { ...s, tools: s.tools.map((_, i) => (i === 1 * 15 + 3 ? 1 : 0)) };
    const after = reduce(s, {
      type: 'useCard',
      cardId: 13,
      target: { kind: 'player', index: 1, steal: { kind: 'tool', id: 3 } },
    }, topo);
    expect(after.tools[1 * 15 + 3]).toBe(0);
    expect(after.tools[0 * 15 + 3]).toBe(1);
    expect(after.players[0]!.cards).not.toContain(13);
  });

  it('★ 搶奪卡缺 `steal` 时原样不动（真人还没挑的那一拍）—— 卡不消耗', () => {
    const { state, topo } = scene();
    let s = give(state, 1, 5);
    s = give(s, 0, 13);
    const after = reduce(s, {
      type: 'useCard',
      cardId: 13,
      target: { kind: 'player', index: 1 },
    }, topo);
    expect(after).toBe(s);
    expect(after.players[0]!.cards).toContain(13);
  });

  it('★ 出局者不能出牌', () => {
    const { state, topo } = scene();
    const s = {
      ...give(state, 0, 1),
      players: give(state, 0, 1).players.map((p, i) =>
        i === 0 ? { ...p, whoPlays: 0 } : p,
      ),
    };
    expect(reduce(s, { type: 'useCard', cardId: 1 }, topo)).toBe(s);
  });

  it('★ 購地卡（3）改的是 landOwner，不是地图静态表', () => {
    // 購地卡是从**别人手里**买下自己所站的地，故先让玩家 1 持有
    const { state, topo } = scene({ landOwner: [0, 2] });
    const s = give(state, 0, 3);
    const after = reduce(s, { type: 'useCard', cardId: 3 }, topo);
    expect(after.landOwner[1]).toBe(1); // 玩家 0 → 编码 1
    // 地图静态表没被改动
    expect(topo.lands[0]!.owner).toBe(0);
  });

  it('★★ 購地卡（3）：土地權限非無限期 ⇒ 买下的地**从今天重算到期日**（0x0044246c `mov [land+0x30], eax`）', () => {
    const { state, topo } = scene({ landOwner: [0, 2], landTenure: [0, 12345], landTenureIndex: 2 });
    const s = give(state, 0, 3);
    const after = reduce(s, { type: 'useCard', cardId: 3 }, topo);
    expect(after.landOwner[1]).toBe(1);
    expect(after.landTenure[1]).toBe(tenureExpiry(packDate(s), 2));
    expect(after.landTenure[1]).not.toBe(12345);
    // 無限期（0）⇒ 不写（`0x00442453 je`）
    const { state: st0 } = scene({ landOwner: [0, 2], landTenure: [0, 777], landTenureIndex: 0 });
    const after0 = reduce(give(st0, 0, 3), { type: 'useCard', cardId: 3 }, topo);
    expect(after0.landTenure[1]).toBe(777);
  });

  it('★★ 拍賣卡（8）流拍 ⇒ 该地变无主、**到期日清零**（0x0044335b / 0x0044335f）', () => {
    const { state, topo } = scene({ landOwner: [0, 2], landTenure: [0, 12345], landTenureIndex: 2 });
    const s = give(state, 0, 8);
    const opened = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    expect(opened.pending?.kind).toBe('auction');
    const settled = reduce(opened, { type: 'auction', winner: -1, price: 0 }, topo);
    expect(settled.landOwner[1]).toBe(0);
    expect(settled.landTenure[1]).toBe(0);
  });

  it('★★ 夢遊卡（16）打电脑持嫁禍卡的人：敌意先记 ⇒ 电脑支挑「最恨的人」= 出牌者 ⇒ 嫁回出牌者 4 天、19 扣掉、不掷随机', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 16);
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 1 ? { ...p, whoPlays: 2, cards: [19] } : p)),
    };
    const after = reduce(s, { type: 'useCard', cardId: 16, target: { kind: 'player', index: 1 } }, topo);
    expect(after.players[1]!.cards).toEqual([]);
    expect(after.players[1]!.blocking.sleepWalking).toBe(0);
    expect(after.players[0]!.blocking.sleepWalking).toBe(4);
    expect(after.rngState).toBe(s.rngState);
    // 电脑支：亮牌「%s\n\n嫁禍卡生效！」→「嫁禍給%s！」（0x00444982 / 0x004449df）
    expect(after.notices.map((n) => n.key)).toEqual(['card.scapegoatOn', 'card.scapegoatTo']);
  });

  it('★ 陷害卡打持免罪卡 / 復仇卡的人：亮牌「免罪卡生效！」/「復仇卡生效！」（0x00444be8 / 0x004446c7）', () => {
    const { state, topo } = scene();
    const s = { ...give(state, 0, 17), phase: 'awaitingRoll' as const };
    const withCard = (c: number): typeof s => ({ ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, cards: [c] } : p)) });
    const a = reduce(withCard(21), { type: 'useCard', cardId: 17, target: { kind: 'player', index: 1 } }, topo);
    expect(a.notices.some((n) => n.key === 'card.absolved' && n.card === 21)).toBe(true);
    const r = reduce(withCard(18), { type: 'useCard', cardId: 17, target: { kind: 'player', index: 1 } }, topo);
    expect(r.notices.some((n) => n.key === 'card.revenge' && n.card === 18)).toBe(true);
  });

  it('★★ 真人持嫁禍卡：挂起问他（0x004447ae 真人支，候选含出牌者）；答「嫁给出牌者」⇒ 出牌者 4 天、19 扣；答不 ⇒ 他自己 5 天、19 留着', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 16);
    s = { ...s, phase: 'awaitingRoll', players: s.players.map((p, i) => (i === 1 ? { ...p, whoPlays: 1, cards: [19] } : p)) };
    const asked = reduce(s, { type: 'useCard', cardId: 16, target: { kind: 'player', index: 1 } }, topo);
    expect(asked.phase).toBe('awaitingDecision');
    expect(asked.pending?.kind).toBe('scapegoat');
    if (asked.pending?.kind !== 'scapegoat') return;
    expect(asked.pending.candidates).toEqual([0, 2, 3]);
    // 挂起时一点不落：卡没扣、没敌意、没人夢遊
    expect(asked.players[0]!.cards).toEqual([16]);
    expect(asked.players[1]!.hostility).toEqual(s.players[1]!.hostility);
    // 联机：这一问归持卡人（1 号）答
    expect(actingSeat(asked)).toBe(1);
    const yes = reduce(asked, { type: 'answerScapegoat', target: 0 }, topo);
    expect(yes.pending).toBeNull();
    expect(yes.phase).toBe('awaitingRoll');
    expect(yes.players[0]!.cards).toEqual([]);
    expect(yes.players[1]!.cards).toEqual([]);
    expect(yes.players[0]!.blocking.sleepWalking).toBe(4);
    expect(yes.players[1]!.blocking.sleepWalking).toBe(0);
    const no = reduce(asked, { type: 'answerScapegoat', target: -1 }, topo);
    expect(no.players[1]!.cards).toEqual([19]);
    expect(no.players[1]!.blocking.sleepWalking).toBe(5);
  });

  it('★★ 查稅卡打真人持免費卡：先问免費卡（0x00444af4）；不用 ⇒ 再问嫁禍卡；都不用 ⇒ 照收', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 26);
    s = {
      ...s,
      phase: 'awaitingRoll',
      players: s.players.map((p, i) => (i === 1 ? { ...p, whoPlays: 1, cash: 100_000, cards: [20, 19] } : p)),
    };
    const q1 = reduce(s, { type: 'useCard', cardId: 26, target: { kind: 'player', index: 1 } }, topo);
    expect(q1.pending?.kind).toBe('freeCard');
    const used = reduce(q1, { type: 'answerFreeCard', use: true }, topo);
    expect(used.players[1]!.cash).toBe(100_000);
    expect(used.players[1]!.cards).toEqual([19]);
    const q2 = reduce(q1, { type: 'answerFreeCard', use: false }, topo);
    expect(q2.pending?.kind).toBe('scapegoat');
    const paid = reduce(q2, { type: 'answerScapegoat', target: -1 }, topo);
    expect(paid.pending).toBeNull();
    expect(paid.players[1]!.cash).toBe(80_000);
    expect(paid.players[1]!.cards).toEqual([20, 19]);
  });

  it('★★ 陷害卡（17）：首次入狱 5 天掷一次倒霉台词的 rand（0x0043d5f9 → 0x44f2c2）、有保險就理赔（0x0043d749）', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 17);
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, insuranceDays: 10, cash: 0 } : p)) };
    const after = reduce(s, { type: 'useCard', cardId: 17, target: { kind: 'player', index: 1 } }, topo);
    expect(after.players[1]!.blocking.inPrison).toBe(5);
    expect(after.rngState).not.toBe(s.rngState);
    // 2000 × 5 天 × 物價（scene 的 priceIndex）
    expect(after.players[1]!.cash).toBe(2000 * 5 * s.priceIndex);
  });

  it('★ 停留卡（14）给目标挂上停留天数', () => {
    const { state, topo } = scene();
    const s = give(state, 0, 14);
    const after = reduce(s, { type: 'useCard', cardId: 14, target: { kind: 'player', index: 2 } }, topo);
    expect(after.players[2]!.blocking.stopping).toBeGreaterThan(0);
  });

  it('★ 表里每一张已实现的卡都能走到这个入口而不抛错', () => {
    // ⚠️ 别拿「张数」当断言（先前写的是「19 张」，早就不对了）——
    //   真正的口径是「表里每一张」：18..21 四张被动卡**本来就不该在这张表里**。
    expect(IMPLEMENTED_CARD_IDS).toHaveLength(26);
    for (const id of IMPLEMENTED_CARD_IDS) {
      const { state, topo } = scene();
      const s = give(state, 0, id);
      // 目标给一个合法的：多数卡要么不需要，要么接受玩家 1 或地块 1
      for (const target of [
        { kind: 'none' } as const,
        { kind: 'player', index: 1 } as const,
        { kind: 'entity', entityId: 1 } as const,
      ]) {
        expect(() => reduce(s, { type: 'useCard', cardId: id, target }, topo)).not.toThrow();
      }
    }
  });

  it('★★ 18..21 是**被动卡**、不该出现在 `IMPLEMENTED_CARD_IDS` 里（设计而非缺口）', () => {
    // @source 原版这四张的 `card_functions` 都指向空桩 `xor eax,eax; ret`（VA 0x004420d5）
    // ⇒ 它们走「有害卡命中时先查目标手里有没有防御卡」这条**反应**路径
    for (const id of [18, 19, 20, 21]) {
      expect(IMPLEMENTED_CARD_IDS, `卡 ${id} 不该可主动使用`).not.toContain(id);
    }
    // 四张的被动效果确实各有实现（不是没人管）
    const src = readFileSync(new URL('../cards/passive.ts', import.meta.url), 'utf8');
    expect(src).toContain('0x004420d5');
  });

  it('★ 未实现的卡安静地什么都不做，不抛错也不扣卡', () => {
    const { state, topo } = scene();
    // 30 张卡已全部接线，改用未登记的卡号验证同一条「安静失败」路径
    expect(IMPLEMENTED_CARD_IDS).not.toContain(99);
    const s = give(state, 0, 99);
    expect(reduce(s, { type: 'useCard', cardId: 99 }, topo)).toBe(s);
  });
});

describe('★ T-008：設施目标经 reduce 端到端落回 GameState', () => {
  // 一处 3 级旅館（玩家 2 持有）+ 站在別处的出牌者
  function facScene(facOver: Parameters<typeof makeFacility>[0] = {}, stateOver: Partial<GameState> = {}) {
    const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
    const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
    const fac = makeFacility({ id: 1, type: 1, level: 3, owner: 2, ...facOver });
    const state = makeGameState({
    phase: 'awaitingRoll',
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000 }),
      ),
      facilityType: [0, fac.type],
      facilityLevel: [0, fac.level],
      facilityOwner: [0, fac.owner],
      ...stateOver,
    });
    return { state, topo: { nodes: [node], lands: [land], facilities: [fac] } };
  }

  it('惡魔卡（10）：facilityLevel/facilityType 真的落回 GameState，敌意也落上', () => {
    const { state, topo } = facScene();
    const s = give(state, 0, 10);
    const after = reduce(s, { type: 'useCard', cardId: 10, target: { kind: 'facility', facilityId: 1 } }, topo);
    expect(after.facilityLevel[1]).toBe(0);
    expect(after.facilityType[1]).toBe(0);
    expect(after.facilityOwner[1]).toBe(2); // 归属保留
    // 敌意 = 3 × 30 × 物价指数1，记在玩家 1 → 玩家 0
    expect(after.players[1]!.hostility[0]).toBeGreaterThan(0);
    expect(after.players[0]!.cards).toHaveLength(0);
  });

  it('天使卡（9）：0 级空地首建，buildType 落进 facilityType', () => {
    const { state, topo } = facScene({ type: 0, level: 0, owner: 0 });
    const s = give(state, 0, 9);
    const after = reduce(s, { type: 'useCard', cardId: 9, target: { kind: 'facility', facilityId: 1, buildType: 4 } }, topo);
    expect(after.facilityType[1]).toBe(4);
    expect(after.facilityLevel[1]).toBe(1);
  });

  it('漲價卡（27）：設施 priceStatus 经 reduce 持久化（不再是地图静态值）', () => {
    const { state, topo } = facScene();
    const s = give(state, 0, 27);
    const after = reduce(s, { type: 'useCard', cardId: 27, target: { kind: 'facility', facilityId: 1 } }, topo);
    expect(after.facilityPriceStatus[1]).toBe(0x50);
  });

  it('漲價卡（27）对地块：landPriceStatus 经 reduce 持久化', () => {
    const { state, topo } = facScene();
    const s = give(state, 0, 27);
    const after = reduce(s, { type: 'useCard', cardId: 27, target: { kind: 'entity', entityId: 1 } }, topo);
    expect(after.landPriceStatus[1]).toBe(0x50);
  });

  it('★ 查封卡（28）封到研究所：facilityResearchDays 被清零', () => {
    const { state, topo } = facScene({ type: 4, level: 2 }, {
      facilityResearchDays: [0, 7],
    });
    const s = give(state, 0, 28);
    const after = reduce(s, { type: 'useCard', cardId: 28, target: { kind: 'facility', facilityId: 1 } }, topo);
    expect(after.facilityPriceStatus[1]).toBe(0x51);
    expect(after.facilityResearchDays[1]).toBe(0);
  });
});

describe('★ T-010：actor 目标经 reduce 端到端落回 specialActors', () => {
  it('停留卡(14) 对在场惡人：specialActors[slot].halted 真的落回 GameState', () => {
    const { state, topo } = scene();
    const s = {
      ...give(state, 0, 14),
      specialActors: state.specialActors.map((a, i) =>
        i === 0 ? { ...a, place: 0 as const, nodeId: 1 } : a,
      ),
    };
    const after = reduce(s, { type: 'useCard', cardId: 14, target: { kind: 'actor', actor: 4 } }, topo);
    expect(after.specialActors[0]!.halted).toBe(1);
    expect(after.players[0]!.cards).toHaveLength(0);
  });

  it('对在監獄的惡人出停留卡：actor 状态不动，但**手牌里的卡照样消失**', () => {
    // ★ 订正（2026-09-17）：原版 `remove_card`（`0x00443fca`）在取位号之后、
    //   写 halted 之前，收尾返回非 0 ⇒ 成功 + 已扣。先前这条断言的是
    //   `reduce(...) === s`（整份状态原样），那是「消耗点在函数末尾」时的旧行为。
    const { state, topo } = scene();
    const s = give(state, 0, 14); // 初始 actor 4 在監獄
    const after = reduce(s, { type: 'useCard', cardId: 14, target: { kind: 'actor', actor: 4 } }, topo);
    expect(after.specialActors).toEqual(s.specialActors); // 替身确实没被动
    expect(after.players[0]!.cards).toEqual([]); // ★ 但卡被扣掉了
  });
});

describe('★★ 卡牌台词提示（`lastCardPlay`）', () => {
  it('★ 用出卡后写入「出牌者 + 卡号」（出牌者 = 当前玩家）', () => {
    const { state, topo } = scene({ currentPlayer: 2 });
    const after = reduce(give(state, 2, 1), { type: 'useCard', cardId: 1 }, topo);
    expect(after.lastCardPlay).toEqual({ player: 2, cardId: 1 });
  });

  it('★ 失败（手上没这张卡）时提示**原样不动**', () => {
    const { state, topo } = scene();
    const before = { ...state, lastCardPlay: { player: 1, cardId: 15 } };
    const after = reduce(before, { type: 'useCard', cardId: 1 }, topo);
    expect(after).toBe(before);
    expect(after.lastCardPlay).toEqual({ player: 1, cardId: 15 });
  });

  it('★ 只保留最近一次（连续用两张卡，提示是后一张）', () => {
    const { state, topo } = scene();
    // ⚠️ `give()` 是**整手替换**（`cards: [cardId]`），连续调两次只会剩后一张
    const two: GameState = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, cards: [1, 15] } : p)),
    };
    const a = reduce(two, { type: 'useCard', cardId: 1 }, topo);
    expect(a.lastCardPlay).toEqual({ player: 0, cardId: 1 });
    // 15 冬眠卡也是**无目标**的（对除自己外全部在局玩家生效），不会因缺目标失败
    const b = reduce(a, { type: 'useCard', cardId: 15 }, topo);
    expect(b.lastCardPlay).toEqual({ player: 0, cardId: 15 });
  });

  it('★ C-DET：它不进 `stateFingerprint`（与 `lastNpcWalks` 同一类纯表现）', () => {
    const { state, topo } = scene();
    const after = reduce(give(state, 0, 1), { type: 'useCard', cardId: 1 }, topo);
    const base = stateFingerprint(after);
    const other = { ...after, lastCardPlay: { player: 3, cardId: 30 } };
    const none = { ...after, lastCardPlay: null };
    expect(stateFingerprint(other)).toBe(base);
    expect(stateFingerprint(none)).toBe(base);
  });
});

describe('★★ 黑卡（25）接入 reduce：持股循环真的落敌意', () => {
  /** 一支股票（下标 1）+ 玩家 1 持股 */
  function stockScene(): { state: GameState; topo: { nodes: ReturnType<typeof makeNode>[]; lands: ReturnType<typeof makeLand>[] } } {
    const node = makeNode({ id: 1, type: HOUSING_TYPE_MIN + 1, adjacent: [1] });
    const land = makeLand({ id: 1, landPrice: 1000, housePrice: 200 });
    const state = makeGameState({
    phase: 'awaitingRoll',
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, nodeId: 1, cash: 100_000 })),
      landOwner: [0, 0],
      landLevel: [0, 0],
      market: {
        ...makeGameState().market,
        stocks: makeGameState().market.stocks.map((st, i) =>
          i === 1 ? { ...st, price: 100, newsFlag: 0, f6: 0 } : st,
        ),
      },
      holdings: [0, 1, 2, 3].map((i) =>
        makeGameState().holdings[i]!.map((h, j) => (i === 1 && j === 1 ? { ...h, amount: 10 } : h)),
      ),
    });
    return { state, topo: { nodes: [node], lands: [land] } };
  }

  it('★★ 黑卡把「double 低 32 位」写进受害者对出牌者的关系值（**确实非 0**）', () => {
    const { state, topo } = stockScene();
    const oldPrice = state.market.stocks[1]!.price;
    const after = reduce(give(state, 0, 25), {
      type: 'useCard',
      cardId: 25,
      target: { kind: 'stock', index: 1 },
    }, topo);
    // 期望值由同一条 helper 给出（它的数值本身由 `swap-and-stock.test.ts` 的 6 条用例
    // + 原版差分测试 `rich4-spec/tests/test_stock_alliance_cards.py` 40/40 钉住）
    // ⚠️ 不能用 `after.market.stocks[1].price` —— 这一条 action 之后 AI 回合会继续推进，
    //   当日行情又动了一次。要用**卡片那一刻**的价：写完 newsFlag 紧接着 applyStockNews。
    const flagged = applyBlackCard(state.market.stocks, 1).stocks;
    const newsApplied = applyStockNews({ ...state.market, stocks: flagged }, 2);
    const want = blackCardHostilityDeltas(
      [0, 10, 0, 0], 0, oldPrice, newsApplied.stocks[1]!.price,
    );
    expect(after.players[1]!.hostility[0]).toBe(want[0]!.delta);
    // ★ 关键 1：这一笔在原版里**不是 0**（价差非整数档 ⇒ 低 32 位是巨大的整数）
    expect(want[0]!.delta).toBe(858_993_459);
    // ★★ 关键 2：**只落一次**。`useCard` 尾部已经落过一次，`playCard` 先前又落了一次
    //   ⇒ 全引擎的卡片敌意被加了两倍（本条用例就是那次回归的钉子）。
    expect(after.players[1]!.hostility[0]).toBe(858_993_459);
  });
});

describe('★★ 烏龜卡生效：不掷骰、只走 1 格（0x0040dd7e → 0x0040dd40）', () => {
  it('汽車 3 颗骰子的人中了烏龜 ⇒ rollDice 只给 1 步、不动随机流、不吃遙控骰子', () => {
    const { state, topo } = scene();
    let s = give(state, 0, 30);
    s = { ...s, phase: 'awaitingRoll', players: s.players.map((p, i) => (i === 1 ? { ...p, ndices: 3, trafficMethod: 2 } : p)) };
    s = reduce(s, { type: 'useCard', cardId: 30, target: { kind: 'player', index: 1 } }, topo);
    expect(s.players[1]!.blocking.tortoiseWalking).toBe(3);
    const t: GameState = { ...s, currentPlayer: 1, phase: 'awaitingRoll', forcedDice: 5 };
    const rolled = reduce(t, { type: 'rollDice' }, topo);
    expect(rolled.phase).toBe('moving');
    expect(rolled.stepsRemaining).toBe(1);
    expect(rolled.rngState).toBe(t.rngState);
    expect(rolled.forcedDice).toBe(5);
  });
});
