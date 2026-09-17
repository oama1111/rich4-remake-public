/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 新聞／命運格接入 reducer
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { topoOf } from '../testing/factories.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

/** 把当前玩家直接放到某种特殊格上，进入 settling */
function standOn(state: GameState, map: ReturnType<typeof loadMap>, kind: number): GameState | null {
  const node = map.nodes.find((n) => n.specialKind === kind);
  if (node === undefined) return null;
  const players2 = state.players.map((p, i) =>
    i === state.currentPlayer ? { ...p, nodeId: node.id } : p,
  );
  return { ...state, players: players2, phase: 'settling' as const };
}

describe('★ 牌堆在开局就洗好', () => {
  run('两副牌各自完整且不重复', () => {
    const s = newGame({ map: loadMap(), players: players(), seed: 42 });
    expect(s.newsDeck.order).toHaveLength(36);
    expect(s.fortuneDeck.order).toHaveLength(37);
    expect(new Set(s.newsDeck.order).size).toBe(36);
    expect(new Set(s.fortuneDeck.order).size).toBe(37);
  });

  run('★ 洗牌消耗了随机数——rngState 不再等于种子', () => {
    const s = newGame({ map: loadMap(), players: players(), seed: 42 });
    expect(s.rngState).not.toBe(42);
  });

  run('同种子洗出同样的牌堆', () => {
    const a = newGame({ map: loadMap(), players: players(), seed: 9 });
    const b = newGame({ map: loadMap(), players: players(), seed: 9 });
    expect(a.newsDeck.order).toEqual(b.newsDeck.order);
    expect(a.fortuneDeck.order).toEqual(b.fortuneDeck.order);
  });

  run('不同种子洗出不同牌堆', () => {
    const a = newGame({ map: loadMap(), players: players(), seed: 1 });
    const b = newGame({ map: loadMap(), players: players(), seed: 2 });
    expect(a.newsDeck.order).not.toEqual(b.newsDeck.order);
  });
});

describe('★ 落在命運格会真的抽牌并施加', () => {
  run('游标前进且记下了事件', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (s1 === null) return; // 这张图没有命運格

    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.fortuneDeck.cursor).not.toBe(s1.fortuneDeck.cursor);
    expect(s2.lastEvent?.kind).toBe('fortune');
    expect(s2.phase).toBe('turnEnd');
  });

  run('★ 连续抽不会反复抽到同一张——游标确实在走', () => {
    const map = loadMap();
    const topo = topoOf(map);
    let s = newGame({ map, players: players(), seed: 5 });
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const on = standOn(s, map, SPECIAL_KIND.FORTUNE);
      if (on === null) return;
      s = reduce(on, { type: 'settle' }, topo);
      if (s.lastEvent !== null) seen.push(s.lastEvent.id);
      s = { ...s, phase: 'turnEnd' };
    }
    // 至少抽到过两种不同的事件
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

describe('★ 新聞 11/12/13/23 的「先算好」逐人金额带进 `lastEvent.shares`', () => {
  run('★ 抽到 11（所得稅）→ `lastEvent.shares` 是逐人算好的金额，且钱已收进公库', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null) return;
    // 牌堆拨到「下一张就是 11」，并让 0/1 号各有现金
    const s2: GameState = {
      ...s1,
      newsDeck: { order: [11, ...s1.newsDeck.order.filter((x) => x !== 11)], cursor: 0 },
      players: s1.players.map((p, i) =>
        i < 2 ? { ...p, cash: 100_000 } : { ...p, cash: 0 },
      ),
    };
    const s3 = reduce(s2, { type: 'settle' }, topo);
    expect(s3.lastEvent?.kind).toBe('news');
    expect(s3.lastEvent?.id).toBe(11);
    // ★ 表现层要按这个顺序逐行画「%s繳交%d元」——金额来自引擎，不是 UI 自己算
    expect(s3.lastEvent?.shares).toEqual([
      { player: 0, amount: 5000 },
      { player: 1, amount: 5000 },
      { player: 2, amount: 0 },
      { player: 3, amount: 0 },
    ]);
    // 第二趟（真收钱）也走完了：现金少了 5000、公库多了 10000
    expect(s3.players[0]!.cash).toBe(95_000);
    expect(s3.pool).toBe(s2.pool + 10_000);
  });

  run('★ 其余新闻（16 超速）不带 `shares`', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null) return;
    const s2: GameState = {
      ...s1,
      newsDeck: { order: [16, ...s1.newsDeck.order.filter((x) => x !== 16)], cursor: 0 },
    };
    const s3 = reduce(s2, { type: 'settle' }, topo);
    expect(s3.lastEvent?.id).toBe(16);
    expect(s3.lastEvent?.shares).toBeUndefined();
  });
});

describe('★ 命運 5 生日收卡：真人寿星**分帧**问每一位（T-055）', () => {
  /** 寿星（0 号）是真人、1/2 号电脑各有牌、3 号出局；牌堆拨到「下一张就是 5」 */
  function birthdayScene() {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({
      map,
      players: [
        { character: 0, kind: 'human' },
        { character: 1, kind: 'computer' },
        { character: 2, kind: 'computer' },
        { character: 3, kind: 'computer' },
      ],
      seed: 11,
    });
    const withCards: GameState = {
      ...base,
      currentPlayer: 0,
      players: base.players.map((p, i) =>
        i === 1 ? { ...p, cards: [3, 7] } : i === 2 ? { ...p, cards: [9] } : i === 3 ? { ...p, whoPlays: 0, cards: [11] } : p,
      ),
      fortuneDeck: { order: [5, ...base.fortuneDeck.order.filter((x) => x !== 5)], cursor: 0 },
    };
    const on = standOn(withCards, map, SPECIAL_KIND.FORTUNE);
    return { map, topo, s: on };
  }

  run('★ 抽到 5 → `pending.birthdayCard`，座位 = 合格的人（升序）；此时**一张牌都没动**', () => {
    const { topo, s } = birthdayScene();
    if (s === null) return;
    const s2 = reduce(s, { type: 'settle' }, topo);
    expect(s2.lastEvent).toEqual({ kind: 'fortune', id: 5 });
    expect(s2.pending?.kind).toBe('birthdayCard');
    expect(s2.phase).toBe('awaitingDecision');
    const p = s2.pending;
    if (p?.kind === 'birthdayCard') expect(p.seats).toEqual([1, 2]); // 3 号出局、自己跳过
    // 真人还没挑，牌一张都不许动
    expect(s2.players[1]!.cards).toEqual([3, 7]);
    expect(s2.players[2]!.cards).toEqual([9]);
    expect(s2.players[0]!.cards).toEqual([]);
  });

  run('★ 答一位走一位：挑中的牌进寿星手里，全答完 pending 清空', () => {
    const { topo, s } = birthdayScene();
    if (s === null) return;
    let st = reduce(s, { type: 'settle' }, topo);
    // 1 号：挑 7
    st = reduce(st, { type: 'birthdayCard', seat: 1, cardId: 7 }, topo);
    expect(st.players[1]!.cards).toEqual([3]);
    expect(st.players[0]!.cards).toEqual([7]);
    const p = st.pending;
    if (p?.kind === 'birthdayCard') expect(p.seats).toEqual([2]);
    // 2 号：挑 9
    st = reduce(st, { type: 'birthdayCard', seat: 2, cardId: 9 }, topo);
    expect(st.players[2]!.cards).toEqual([]);
    expect(st.players[0]!.cards).toEqual([7, 9]);
    expect(st.pending).toBeNull();
    expect(st.phase).toBe('turnEnd');
  });

  run('★★ `cardId = 0` = 原版右键取消：这位不交牌，但座位照样前进（`edi+1`）', () => {
    const { topo, s } = birthdayScene();
    if (s === null) return;
    let st = reduce(s, { type: 'settle' }, topo);
    st = reduce(st, { type: 'birthdayCard', seat: 1, cardId: 0 }, topo);
    expect(st.players[1]!.cards).toEqual([3, 7]); // 没动
    expect(st.players[0]!.cards).toEqual([]);
    const p = st.pending;
    if (p?.kind === 'birthdayCard') expect(p.seats).toEqual([2]);
  });

  run('★ 乱序 / 陈旧答复一律不理（只认队首）', () => {
    const { topo, s } = birthdayScene();
    if (s === null) return;
    const st = reduce(s, { type: 'settle' }, topo);
    // 先答 2 号（队首是 1 号）→ 原样返回
    expect(reduce(st, { type: 'birthdayCard', seat: 2, cardId: 9 }, topo)).toBe(st);
    // 没有这个 pending 时也不动
    expect(reduce({ ...st, pending: null }, { type: 'birthdayCard', seat: 1, cardId: 7 }, topo)).not.toBeNull();
  });

  run('★ 电脑当寿星不分帧：当场抽完，`pending` 仍是 null', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({ map, players: players(), seed: 11 }); // 四个电脑
    const withCards: GameState = {
      ...base,
      currentPlayer: 0,
      players: base.players.map((p, i) => (i === 1 ? { ...p, cards: [3] } : p)),
      fortuneDeck: { order: [5, ...base.fortuneDeck.order.filter((x) => x !== 5)], cursor: 0 },
    };
    const on = standOn(withCards, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const st = reduce(on, { type: 'settle' }, topo);
    expect(st.lastEvent).toEqual({ kind: 'fortune', id: 5 });
    expect(st.pending).toBeNull();
    expect(st.players[0]!.cards).toEqual([3]);
  });

  run('★ `declineDecision` 是最后一道保险：任何 birthday 待决都能放弃掉', () => {
    const { topo, s } = birthdayScene();
    if (s === null) return;
    const st = reduce(s, { type: 'settle' }, topo);
    const after = reduce(st, { type: 'declineDecision' }, topo);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('turnEnd');
  });
});

describe('★ 落在新聞格会抽牌', () => {
  run('游标前进且记下事件', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null) return;

    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.newsDeck.cursor).not.toBe(s1.newsDeck.cursor);
    expect(s2.lastEvent?.kind).toBe('news');
  });
});

describe('★ 新聞 7「公開拍賣公有土地一處」会当场开一场拍卖', () => {
  run('★ 抽到 7 → pending 是一場 auction，且**卖家为 −1**（原版传 −1 = 没有卖家席位）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null) return;
    // 把牌堆拨到「下一张就是 7」
    const s2: GameState = { ...s1, newsDeck: { order: [7, ...s1.newsDeck.order.filter((x) => x !== 7)], cursor: 0 } };
    // 至少得有一块无主地，否则原版就是除零崩（本引擎什么都不做）
    const unowned = topo.lands?.find((l) => (s2.landOwner[l.id] ?? l.owner) === 0);
    if (unowned === undefined) return;
    const s3 = reduce(s2, { type: 'settle' }, topo);
    expect(s3.lastEvent).toEqual({ kind: 'news', id: 7 });
    expect(s3.pending?.kind).toBe('auction');
    const pend = s3.pending;
    if (pend?.kind === 'auction') {
      expect(pend.seller).toBe(-1);
      expect(pend.basePrice).toBeGreaterThan(0);
      expect(pend.bidders.length).toBeGreaterThan(0);
      // 待拍的必须是**无主**的那一处（地块或設施）
      const facility = pend.facility === true;
      const owner = facility
        ? (topo.facilities?.find((f) => f.id === pend.entityId)?.owner ?? -1)
        : (topo.lands?.find((l) => l.id === pend.entityId)?.owner ?? -1);
      expect(owner).toBe(0);
    }
    expect(s3.phase).toBe('awaitingDecision');
  });
});

describe('★ 公园格仍然什么都不发生（原版行为）', () => {
  run('状态除 phase 外不变', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.PARK);
    if (s1 === null) return;
    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.players).toEqual(s1.players);
    expect(s2.pool).toBe(s1.pool);
    expect(s2.lastEvent).toBeNull();
  });
});

// ============================================================
//  ★ 神明加持接进命运事件（2026-09-16）
//    施加阶段先问 `fcn_0044b896`，档位随事件不同（奖励/罚金/劫难）
// ============================================================

describe('★ 神明加持真的接上了 @source VA 0x0044b896', () => {
  /** 把下一张牌钉成指定事件（拿掉重号后插到队首）*/
  const forceDraw = (s: GameState, id: number): GameState => ({
    ...s,
    fortuneDeck: {
      ...s.fortuneDeck,
      order: [id, ...s.fortuneDeck.order.filter((x) => x !== id)],
      cursor: 0,
    },
  });
  /** 当前玩家站着（traffic 0）⇒ 14/15/16 那一组固定落到 14（行人罰款 3000）*/
  const withFortune = (s: GameState, fortune: number): GameState => ({
    ...s,
    players: s.players.map((p, i) => (i === s.currentPlayer ? { ...p, fortune } : p)),
  });

  run('★★ 財運 > 100 ⇒ 罰金「免付」：一分不扣、公库也收不到', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const cash = on.players[on.currentPlayer]!.cash;
    const s1 = withFortune(forceDraw(on, 14), 101);
    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(14);
    expect(s2.players[s2.currentPlayer]!.cash).toBe(cash);
    expect(s2.pool).toBe(s1.pool);
  });

  run('★★ 財運 < 0 ⇒ 罰金「加倍」（`(0,1)` 那一支的低值 = 2）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const cash = on.players[on.currentPlayer]!.cash;
    const s1 = withFortune(forceDraw(on, 14), -1);
    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(14);
    // 3000 × 物价指数 1 × 2
    expect(s2.players[s2.currentPlayer]!.cash).toBe(cash - 6000);
  });

  run('★★ 財運 = 0 ⇒ 照常付一次（不受影响）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const cash = on.players[on.currentPlayer]!.cash;
    const s2 = reduce(forceDraw(on, 14), { type: 'settle' }, topo);
    expect(s2.players[s2.currentPlayer]!.cash).toBe(cash - 3000);
  });

  run('★★ 事件 8：卖掉 10% 持仓（钱进公库）+ 收回特別融資', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const me = on.currentPlayer;
    // 给一点持仓（事件 8 的可行性要求「持有任何股票」）与一笔特別融資。
    // ⚠️ 只给**第 5 支**：第 0 支是銀行那家企业的股票，卖了会经过
    //   `reownCommercial` 把卖方推成銀行董事長，而董事長**不在收回范围内**
    //   （`sweepSpecialFinance` 跳过 chairman）—— 那是另一条规则，另行覆盖。
    const STOCK = 5;
    const s1: GameState = {
      ...on,
      holdings: on.holdings.map((row, i) =>
        i === me ? row.map((h, j) => (j === STOCK ? { amount: 100, avgCost: 50 } : h)) : row,
      ),
      players: on.players.map((p, i) =>
        i === me ? { ...p, specialFinance: 4000, fortune: 0 } : p,
      ),
    };
    const pool0 = s1.pool;
    const s2 = reduce(forceDraw(s1, 8), { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(8);
    // 100 股卖 10% = 10 股 → 剩 90
    expect(s2.holdings[me]![STOCK]!.amount).toBe(90);
    // 收入进公库，不进玩家人口袋
    expect(s2.pool).toBeGreaterThan(pool0);
    // ★ 尾巴的 `fcn_00436b0a(0)`：特別融資被收回
    expect(s2.players[me]!.specialFinance).toBe(0);
  });

  run('★ 財運 > 100 ⇒ 事件 8 整个被挡掉：股票一股不卖', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const me = on.currentPlayer;
    const STOCK = 5;
    const s1: GameState = {
      ...on,
      holdings: on.holdings.map((row, i) =>
        i === me ? row.map((h, j) => (j === STOCK ? { amount: 100, avgCost: 50 } : h)) : row,
      ),
      players: on.players.map((p, i) =>
        i === me ? { ...p, specialFinance: 4000, fortune: 101 } : p,
      ),
    };
    const s2 = reduce(forceDraw(s1, 8), { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(8);
    expect(s2.holdings[me]![STOCK]!.amount).toBe(100);
    expect(s2.players[me]!.specialFinance).toBe(4000);
  });
});
