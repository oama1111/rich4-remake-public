/*
 * 神明附身的「發威」接进引擎之后：走一步踩到 / 請神符请上身
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 判据全部回 exe（VA 见 `rules/god-power.ts`）：金额 = 那扇窗拼出来的四位/三位数，
 * 按 D-003 用「一次四个 rand()%10」当替身 —— 所以这里能**独立算出**该付多少：
 * `rollGodAmounts(new WatcomRng(<附身那一刻的 rngState>))`。
 *
 * ⚠️ 走路本身会取随机数（岔路 `pickNextNode`），所以「附身那一刻的位置」
 *   不能拿 `before.rngState`，要拿**同一趟空场走一遍**之后的那个值。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { placeObjectOfType } from '../rules/object-landing.ts';
import { summonableObjects } from '../cards/summon.ts';
import {
  GOD_ANGEL,
  GOD_BIG_LUCK,
  GOD_BIG_MISFORTUNE,
  GOD_BIG_POVERTY,
  GOD_BIG_WEALTH,
  GOD_REAPER,
  GOD_SMALL_LUCK,
  GOD_SMALL_MISFORTUNE,
  GOD_SMALL_POVERTY,
  GOD_SMALL_WEALTH,
  rollGodAmounts,
} from '../rules/god-power.ts';
import { WatcomRng, drawRandomCard } from '../rng/watcom.ts';
import { sellAllCards, sellAllTools } from '../rules/inventory.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const topoOf = (map: ReturnType<typeof loadMap>) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
});

function fresh(seed = 7): { state: GameState; topo: ReturnType<typeof topoOf> } {
  const map = loadMap();
  return {
    state: newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed,
    }),
    topo: topoOf(map),
  };
}

/** 每个玩家都给足钱、清空手牌，免得破产/满手干扰断言 */
function rich(state: GameState, cash = 100_000): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, cash, moneyInBank: 0, cards: [] })),
  };
}

/**
 * 把玩家 0 挪到某格、摆好物件，然后走一步过去。
 *
 * ★ `rngAtAttach` = **同一趟空场走一遍**之后的随机数位置 —— 走路会在岔路取随机数
 *   （`step` 的 `pickNextNode`），拿 `before.rngState` 去算金额会差一次。
 */
function stepOnto(type: number, over: Partial<GameState> = {}) {
  const { state, topo } = fresh();
  const from = state.players[0]!.nodeId;
  const to = topo.nodes[from - 1]!.adjacent[0]!;
  const cleared = state.objects.map((o) => ({ ...o, nodeId: 0, state: 0, attached: 0 }));
  const objects = placeObjectOfType(cleared, type, to).objects;
  const start: GameState = {
    ...rich(state),
    ...over,
    objects,
    phase: 'moving',
    stepsRemaining: 1,
    stepsTotal: 1,
  };
  const walked = reduce({ ...start, objects: cleared }, { type: 'step' }, topo);
  return {
    before: start,
    rngAtAttach: walked.rngState,
    after: reduce(start, { type: 'step' }, topo),
    topo,
    node: to,
  };
}

/** 用一張請神符把地图上某个种类的神明请上身（死神走的就是这条）*/
function attachViaCard(type: number, over: Partial<GameState> = {}) {
  const { state, topo } = fresh();
  const base: GameState = { ...rich(state), ...over, phase: 'awaitingRoll' };
  let objAt = base.objects.findIndex((o) => o.type === type);
  if (objAt < 0) {
    // 开局名单里没有的神明（死神）自己摆一个上地图
    const placed = placeObjectOfType(base.objects, type, base.players[0]!.nodeId);
    const objects0 = placed.objects;
    objAt = objects0.findIndex((o) => o.type === type && o.nodeId !== 0 && o.attached === 0);
    base.objects = objects0;
  }
  expect(objAt, `应该能摆出 ${type} 号神明`).toBeGreaterThanOrEqual(0);
  const handle = objAt + 1;
  const objects = base.objects.map((o, i) =>
    i === objAt ? { ...o, nodeId: base.players[0]!.nodeId } : o,
  );
  const before: GameState = {
    ...base,
    objects,
    players: base.players.map((p, i) => (i === 0 ? { ...p, cards: [...p.cards, 23] } : p)),
  };
  const after = reduce(
    before,
    { type: 'useCard', cardId: 23, target: { kind: 'object', objectIndex: handle } },
    topo,
  );
  return { before, rngAtAttach: before.rngState, after, handle };
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('★ 踩到神明格 —— 附身那一刻的發威', () => {
  run('★ 小財神：每個對手付給附身者（現金），四位數金額 @source 0x0040ec99', () => {
    const { after, rngAtAttach } = stepOnto(GOD_SMALL_WEALTH);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).three;
    expect(amount).toBeLessThanOrEqual(999);
    expect(after.players[0]!.godInfo).toBe(1);
    for (const i of [1, 2, 3]) expect(after.players[i]!.cash, `玩家 ${i}`).toBe(100_000 - amount);
    expect(after.players[0]!.cash).toBe(100_000 + amount * 3);
  });

  run('★ 大財神：附身者進帳（現金），三位數 @source 0x0040ed4c', () => {
    const { after, rngAtAttach } = stepOnto(GOD_BIG_WEALTH);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).four;
    expect(amount).toBeLessThanOrEqual(9999);
    expect(after.players[0]!.godInfo).toBe(2);
    expect(after.players[0]!.cash).toBe(100_000 + amount);
    for (const i of [1, 2, 3]) expect(after.players[i]!.cash).toBe(100_000);
  });

  run('★ 小窮神：附身者付給每個對手，進對方**存款** @source 0x0040efd9', () => {
    const { after, rngAtAttach } = stepOnto(GOD_SMALL_POVERTY);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).three;
    expect(after.players[0]!.cash).toBe(100_000 - amount * 3);
    expect(after.players[0]!.moneyInBank).toBe(0);
    for (const i of [1, 2, 3]) {
      expect(after.players[i]!.cash, `玩家 ${i} 現金不动`).toBe(100_000);
      expect(after.players[i]!.moneyInBank, `玩家 ${i} 進存款`).toBe(amount);
    }
  });

  run('★ 大窮神：附身者付給銀行（公庫）@source 0x0040f076', () => {
    const { before, after, rngAtAttach } = stepOnto(GOD_BIG_POVERTY);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).four;
    expect(after.players[0]!.cash).toBe(100_000 - amount);
    expect(after.pool).toBe(before.pool + amount);
    for (const i of [1, 2, 3]) expect(after.players[i]!.cash).toBe(100_000);
  });

  run('★ 小福神：得一張随机卡，牌堆同時減一 @source 0x0040ede7', () => {
    const { before, after, rngAtAttach } = stepOnto(GOD_SMALL_LUCK);
    const id = drawRandomCard(new WatcomRng(rngAtAttach), before.cardAmount);
    expect(id).toBeGreaterThan(0);
    expect(after.players[0]!.cards).toEqual([id]);
    expect(after.cardAmount[id - 1]).toBe((before.cardAmount[id - 1] ?? 0) - 1);
    // ★ 福神那条路**不掷金額**（原版那扇窗根本没开），但**抽卡本身**取一次 rand()
    const probe = new WatcomRng(rngAtAttach);
    probe.next();
    expect(after.rngState).toBe(probe.getState());
  });

  run('★ 大福神：得两张（各自抽、各自扣牌堆）@source 0x0040eea8', () => {
    const { before, after, rngAtAttach } = stepOnto(GOD_BIG_LUCK);
    expect(after.players[0]!.cards).toHaveLength(2);
    const rng = new WatcomRng(rngAtAttach);
    const deck = [...before.cardAmount];
    const ids: number[] = [];
    for (let k = 0; k < 2; k++) {
      const id = drawRandomCard(rng, deck);
      ids.push(id);
      deck[id - 1] = (deck[id - 1] ?? 0) - 1;
    }
    expect(after.players[0]!.cards).toEqual(ids);
    expect(after.cardAmount).toEqual(deck);
  });

  run('★ 小衰神：丢一张（回牌堆）@source 0x0040f10c', () => {
    const start = fresh().state;
    const { before, after } = stepOnto(GOD_SMALL_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [1, 2, 3] } : p)),
    });
    expect(before.players[0]!.cards).toEqual([1, 2, 3]);
    expect(after.players[0]!.cards).toHaveLength(2);
    // 丢的那张回牌堆：总数 +1
    expect(sum(after.cardAmount)).toBe(sum(before.cardAmount) + 1);
  });

  run('★ 大衰神：丢一半（原版那个循环丢的是第 0、2、4… 张）@source 0x0040f1de', () => {
    const start = fresh().state;
    const { before, after } = stepOnto(GOD_BIG_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [1, 2, 3, 4, 5] } : p)),
    });
    expect(before.players[0]!.cards).toEqual([1, 2, 3, 4, 5]);
    // n = 5 → 丢 floor(5/2) = 2 张，落点是原下标 0 与 2 ⇒ 剩 [2,4,5]
    expect(after.players[0]!.cards).toEqual([2, 4, 5]);
    expect(sum(after.cardAmount)).toBe(sum(before.cardAmount) + 2);
  });

  run('大衰神：只有 1 张时不丢（`cmp eax,1 / jle`）', () => {
    const start = fresh().state;
    const { after } = stepOnto(GOD_BIG_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [9] } : p)),
    });
    expect(after.players[0]!.cards).toEqual([9]);
  });

  run('★ 天使：只演出 —— 状态不动、随机数也不动 @source 0x0040f205', () => {
    const { before, after, rngAtAttach } = stepOnto(GOD_ANGEL);
    expect(after.players[0]!.godInfo).toBe(9);
    expect(after.players[0]!.cash).toBe(before.players[0]!.cash);
    expect(after.players[0]!.moneyInBank).toBe(before.players[0]!.moneyInBank);
    expect(after.pool).toBe(before.pool);
    expect(after.cardAmount).toEqual(before.cardAmount);
    // 金額型才会取那四个数字；天使一个都不取
    expect(after.rngState).toBe(rngAtAttach);
  });
});

describe('★ 請神符走同一条發威（两条附身路径共用 @source 0x0040ebfa）', () => {
  run('請大財神上身 → 一样進帳', () => {
    const { after, rngAtAttach, handle } = attachViaCard(GOD_BIG_WEALTH);
    expect(after.players[0]!.godInfo).toBe(handle);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).four;
    expect(after.players[0]!.cash).toBe(100_000 + amount);
  });

  run('★ 請死神上身 → 賣光道具與卡片，所得進**點券** @source 0x0040f2eb', () => {
    const start = fresh().state;
    const base = rich(start);
    const tools = [...base.tools];
    tools[0 * 15 + 1] = 2; // 玩家 0 的两件 1 号道具
    const { after, before } = attachViaCard(GOD_REAPER, {
      tools,
      players: base.players.map((p, i) => (i === 0 ? { ...p, cards: [1, 2], points: 10 } : p)),
    });
    // ⚠️ 請神符**还在手上**（原版「生效才扣卡」：發威跑在扣卡之前）→ 一并被卖掉
    expect(before.players[0]!.cards).toEqual([1, 2, 23]);
    expect(after.players[0]!.cards).toEqual([]);
    expect(after.tools[0 * 15 + 1]).toBe(0);
    // ★ 請神符**先扣卡再發威**（@source 0x00444e47 的 `push 0x17 / call consume_card`
    //   就在 `_rich4_attach_god` 之前）⇒ 卖掉的只有 [1,2]
    const expectSold = sellAllTools(
      { ...before.players[0]!, cards: [1, 2] },
      before.tools,
      before.toolStock,
    );
    const expectCards = sellAllCards(expectSold.player, before.cardAmount);
    expect(after.players[0]!.points).toBe(10 + expectSold.points + expectCards.points);
    // 都回商店库存
    expect(after.toolStock[1]).toBe((before.toolStock[1] ?? 0) + 2);
    expect(after.cardAmount[0]).toBe((before.cardAmount[0] ?? 0) + 1);
    expect(after.cardAmount[1]).toBe((before.cardAmount[1] ?? 0) + 1);
  });

  run('死神摆上地图后可请（`summonableObjects` 认得它）', () => {
    const { state } = fresh();
    const node = state.players[0]!.nodeId;
    const placed = placeObjectOfType(state.objects, GOD_REAPER, node).objects;
    const reaper = placed.findIndex((o) => o.type === GOD_REAPER && o.nodeId !== 0);
    expect(reaper).toBeGreaterThanOrEqual(0);
    expect(summonableObjects(placed)).toContain(reaper + 1);
  });
});

describe('★ 附身那一刻的随机数消耗与原版同形', () => {
  run('金額型取满四个 rand()%10（不是三次、也不是五次）', () => {
    const { after, rngAtAttach } = stepOnto(GOD_SMALL_WEALTH);
    const probe = new WatcomRng(rngAtAttach);
    for (let i = 0; i < 4; i++) probe.below(10);
    expect(after.rngState).toBe(probe.getState());
  });

  run('抽卡 / 丢一张各取一次 rand()（那是抽卡与选牌用的，不是金額）', () => {
    for (const [type, draws] of [[GOD_SMALL_LUCK, 1], [GOD_SMALL_MISFORTUNE, 1]] as const) {
      const start = fresh().state;
      const { after, rngAtAttach } = stepOnto(type, {
        players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [1, 2, 3] } : p)),
      });
      const probe = new WatcomRng(rngAtAttach);
      for (let i = 0; i < draws; i++) probe.next();
      expect(after.rngState, `種類 ${type}`).toBe(probe.getState());
    }
  });

  run('丢一半不取随机数（那条路全是确定的，一个 rand() 都没有）', () => {
    // 大衰神：`for (i < n/2) consume(cards[i])` 全是确定的
    const half = stepOnto(GOD_BIG_MISFORTUNE);
    expect(half.after.rngState).toBe(half.rngAtAttach);
  });
});
