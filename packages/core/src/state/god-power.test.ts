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
import { CARDS } from '@rich4/data';
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

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const topoOf = (map: ReturnType<typeof loadMap>) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
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

  /**
   * ★★ 得卡那一扇訊息框的**形状**：小福神每张一扇（`0x0040ee13 push 0x4632fd`，
   *   `%s附身\n\n得到%s！`），**大福神两张只弹一扇**（`0x0040eed7 push 0x463353`，
   *   `大福神附身\n\n得到%s及%s！` —— 串里自己写着神明名，故 `args` 只有两张卡名）。
   *
   * 反证：旧实现（每张都 push `god.gotCard`、args 带神明名）在这一组里是**两扇**，
   *   下面第一条的 `toHaveLength(1)` / `key` / `args` 都会红。
   */
  run('★★ 大福神两张 ⇒ **只有一扇** `god.gotCardTwo`，args = [两张卡名]、不含神明名', () => {
    const { after } = stepOnto(GOD_BIG_LUCK);
    const cards = after.players[0]!.cards;
    expect(cards).toHaveLength(2);
    expect(after.notices).toHaveLength(1);
    const n = after.notices![0]!;
    expect(n.key).toBe('god.gotCardTwo');
    expect(n.holdMs).toBe(1500);
    // 顺序 = 两张卡各自的名字（先抽到的在前，同原版 `[ebx]` → `[esi]` 的 sprintf 顺序）
    expect(n.args).toEqual([CARDS[cards[0]! - 1]!.name, CARDS[cards[1]! - 1]!.name]);
    expect(n.args).not.toContain('大福神');
    // 这张框的 key 与 `gotCard` 不同 ⇒ 旧的「带神明名」形状不适用；`cardId` 也不带
    expect(n.cardId).toBeUndefined();
  });

  run('★ 小福神一张 ⇒ 仍然**一扇** `god.gotCard`、args = [神明名, 卡名]（没误伤）', () => {
    const { after } = stepOnto(GOD_SMALL_LUCK);
    const cards = after.players[0]!.cards;
    expect(cards).toHaveLength(1);
    expect(after.notices).toEqual([
      { key: 'god.gotCard', args: ['小福神', CARDS[cards[0]! - 1]!.name], holdMs: 1500, cardId: cards[0]! },
    ]);
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

  /**
   * ★ 2026-09-23（神明对话框反查）：丢了卡就弹訊息框「小衰神附身\n\n遺失%s！」（1500 ms）。
   * @source `0x0040f114 call 0x441e77` → `0x0040f11c test eax,eax / je`（没丢不弹）→
   *   `0x0040f124 mov esi,[eax*8 + 0x47fdea]`（卡名）→ `0x0040f12c push 0x4633ab` →
   *   `0x0040f13e push 0x5dc` → `0x0040f148 call 0x440cac`
   */
  run('★ 小衰神丢卡 ⇒ 訊息框 god.lostCard（args = 丢掉那张的卡名，1500 ms）', () => {
    const start = fresh().state;
    const { after } = stepOnto(GOD_SMALL_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [1, 2, 3] } : p)),
    });
    const left = after.players[0]!.cards;
    const lost = [1, 2, 3].find((id) => !left.includes(id))!;
    expect(after.notices).toEqual([{ key: 'god.lostCard', args: [CARDS[lost - 1]!.name], holdMs: 1500 }]);
  });

  run('★ 小衰神附身时手里没卡 ⇒ 什么都不丢、也不弹框（`0x0040f11e je 0x40ece6`）', () => {
    const start = fresh().state;
    const { before, after } = stepOnto(GOD_SMALL_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [] } : p)),
    });
    expect(after.players[0]!.cards).toEqual([]);
    expect(after.notices ?? []).not.toContainEqual(expect.objectContaining({ key: 'god.lostCard' }));
    expect(sum(after.cardAmount)).toBe(sum(before.cardAmount));
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

  /**
   * ★★ G40（W-55 行 8）：原版那一支是
   * `for (i = 0; i < n/2; i++) consume_card(player_cards[i])`（`0x00441efd` 读当前手牌第 i 格、
   * `0x00441f0b call 0x441343`），而 `consume_card` 移除的是**首个匹配的卡号**，
   * **不是第 i 格**。卡号唯一时两者同值，**卡号重复时不同**。
   */
  run('★★ G40：手牌有**重复卡号**时，丢一半 = 按卡号移除首个匹配（不是 splice(i)）', () => {
    const start = fresh().state;
    const hand = [1, 1, 1, 2, 1, 1]; // n = 6 → 丢 3 张
    const { before, after } = stepOnto(GOD_BIG_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [...hand] } : p)),
    });
    expect(before.players[0]!.cards).toEqual(hand);

    // 原版语义（照抄 `0x00441ece`）：每一步读**当前**手牌的第 i 格当卡号，
    // 再移除该卡号的**首个**匹配。
    const byId = [...hand];
    for (let i = 0; i < Math.trunc(hand.length / 2); i++) {
      const id = byId[i]!;
      byId.splice(byId.indexOf(id), 1);
    }
    // 旧实现（`splice(i, 1)`）的结果 —— 用来证明这条用例**有鉴别力**
    const byIndex = [...hand];
    for (let i = 0; i < Math.trunc(hand.length / 2); i++) byIndex.splice(i, 1);

    expect(byId).not.toEqual(byIndex); // ★ 前提：这一组手牌确实能区分两种实现
    expect(byId.join(',')).toBe('2,1,1');
    expect(byIndex.join(',')).toBe('1,2,1');
    expect(after.players[0]!.cards).toEqual(byId);
    expect(after.players[0]!.cards).not.toEqual(byIndex);
    // 丢的 3 张都是 1 号卡 ⇒ 全部回牌堆
    expect(sum(after.cardAmount)).toBe(sum(before.cardAmount) + 3);
    expect(after.cardAmount[0]).toBe((before.cardAmount[0] ?? 0) + 3);
  });

  run('★★ G40：小衰神丢一张也按**卡号**移除首个匹配，不是按随机下标', () => {
    const start = fresh().state;
    // 5 张、只有在手牌里重复出现的卡号 —— 只要下标不是「首个匹配」就与旧实现不同
    // （张数随种子调：开局摆人每人多抽一次「来路」（`0x00408328`）之后，6 张在这个种子上
    //   恰好抽到下标 0、失去鉴别力；下面那条「前提」断言原样保留，专门盯这件事）
    const hand = [5, 1, 5, 5, 5];
    const { after, rngAtAttach } = stepOnto(GOD_SMALL_MISFORTUNE, {
      players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [...hand] } : p)),
    });
    // @source 0x00441e8e `call rand` / 0x00441e98 `idiv esi` ⇒ 下标 = rand() % 张数
    const at = new WatcomRng(rngAtAttach).next() % hand.length;
    const id = hand[at]!;
    const byId = [...hand];
    byId.splice(byId.indexOf(id), 1);
    const byIndex = [...hand];
    byIndex.splice(at, 1);
    // ★ 前提：这一组手牌 + 这个种子必须是**有鉴别力**的（随机下标不是首个匹配）
    expect(at, '随机下标不该落在首个匹配上').toBeGreaterThan(hand.indexOf(id));
    expect(byId.join(',')).not.toBe(byIndex.join(','));
    expect(after.players[0]!.cards).toEqual(byId);
    expect(after.players[0]!.cards).not.toEqual(byIndex);
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

  run('★ 請死神上身 → 道具與卡片全部没收，**點券一分不给**（G42）@source 0x0040f36e / 0x0040f377', () => {
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
    // ★★ G42 订正（2026-09-19）：先前这里断言「所得進點券」，那是**复述旧实现**。
    //   exe：`0x0040f36e call 0x445b3f / add esp,4 / push ebp / 0x0040f377 call 0x441f21 /
    //   0x0040f37c jmp 0x40f250` —— 两个返回值（折得的點券）**都被丢弃**，
    //   中间没有魔法屋那条 `add word [player+0x30], ax`（0x00431d3d / 0x00431f62）。
    expect(expectSold.points + expectCards.points).toBeGreaterThan(0); // 反证：确实有东西可折
    expect(after.players[0]!.points).toBe(10);
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

/**
 * W-55 行 7 —— 神明發威掷出来的**金额**要交给表现层（財神那两支的台词闸门）。
 *
 * ★ 可证伪：把 `lastGodPower` 的写入删掉、或把 `amount` 换成从
 *   `monthlyReceived` 差分反推的数（小財神是「每个对手各付一笔」⇒ 差分是总和），
 *   下面的用例都会红。
 */
describe('★ W-55 行 7：`GameState.lastGodPower` = 那一次掷出来的金额', () => {
  run('★★ 小財神（種類 1）⇒ amount = **三位数**那一个（不是差分总和、不是四位数）', () => {
    const { after, rngAtAttach } = stepOnto(GOD_SMALL_WEALTH);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).three;
    const hint = after.lastGodPower;
    expect(hint).toBeTruthy();
    expect(hint!.player).toBe(0);
    expect(hint!.type).toBe(GOD_SMALL_WEALTH);
    expect(hint!.amount).toBe(amount);
    // ★ 反证：不是「四个对手各付一笔」的总和（除非 0 元那种退化情形）
    const total = after.players.find((p) => p.index === 0)!.monthlyReceived;
    if (amount > 0) expect(total).not.toBe(hint!.amount);
    expect(hint!.amount).toBeLessThan(1000); // 三位数
  });

  run('★★ 大財神（種類 2）⇒ amount = **四位数**那一个', () => {
    const { after, rngAtAttach } = stepOnto(GOD_BIG_WEALTH);
    const amount = rollGodAmounts(new WatcomRng(rngAtAttach)).four;
    const hint = after.lastGodPower;
    expect(hint).toBeTruthy();
    expect(hint!.player).toBe(0);
    expect(hint!.type).toBe(GOD_BIG_WEALTH);
    expect(hint!.amount).toBe(amount);
    // 大財神是纯進帳 ⇒ 差分**就是**那一个（与上面小財神相反，两条互相反证）
    expect(after.players[0]!.monthlyReceived).toBe(amount);
  });

  run('★ 不掷金额的神明（天使 / 福神 / 死神）⇒ 不写这个提示', () => {
    for (const [type, name] of [
      [GOD_ANGEL, '天使'],
      [GOD_BIG_LUCK, '大福神'],
      [GOD_REAPER, '死神'],
    ] as const) {
      const start = fresh().state;
      const { after } = stepOnto(type, {
        players: rich(start).players.map((p, i) => (i === 0 ? { ...p, cards: [1, 2] } : p)),
      });
      expect(after.lastGodPower ?? null, name).toBeNull();
    }
  });

  run('★ 只活一条 action：下一条没新写它的 action 会被 `reduce` 出口清成 null', () => {
    const { after, topo } = stepOnto(GOD_BIG_WEALTH);
    expect(after.lastGodPower).toBeTruthy();
    // `reseed` 是「一定会改状态」的最小 action（换 `rngState` ⇒ 新对象 ⇒ 清瞬态）
    const next = reduce(after, { type: 'reseed', seed: (after.rngState ^ 0x1234) >>> 0 }, topo);
    expect(next).not.toBe(after);
    expect(next.lastGodPower ?? null).toBeNull();
    // ★ 恒等性：`raw === state`（没生效的 action）一律原样返回，连瞬态都不清
    const same = reduce(after, { type: 'endTurn' }, topo);
    if (same === after) expect(same.lastGodPower).toBe(after.lastGodPower);
  });
});
