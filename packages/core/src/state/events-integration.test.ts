/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 新聞／命運格接入 reducer
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { CARDS } from '@rich4/data';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { isAlive } from './types.ts';
import { topoOf } from '../testing/factories.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { PASSIVE_CARDS } from '../cards/passive.ts';
import { DISAPPEAR_REASON_ABDUCTED, FORTUNE_PAY_TAIL_IDS } from '../events/fortune-effects.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
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

  // ══════════════════════════════════════════════════════════════════
  //  ★★ 第 160 条续：新聞 35「%s獲利調高一倍」的**可行性判据**也要读运行时资金
  //  @source 判据 `dword[com + 0x28] > 10000`（`0x44b5f5` 的 `check_news`）。
  //  `+0x28` 与 `+0x18` 一样是**运行时**字段：`new-game.ts` 把 `companyFunds`
  //  全部初始化成 0、地图模板里也是 0 ⇒ 先前读模板值让这条判据**恒 false**，
  //  新闻 35 从来抽不到（效果侧却早就在读 `ctx.companyFunds`）。
  // ══════════════════════════════════════════════════════════════════
  run('★★ 企業資金 > 10000 ⇒ 新聞 35 抽得到；= 0 ⇒ 抽不到', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const on = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (on === null) return;
    const CO = 1; // 第一家企業（companyFunds 按企業 id 索引，1 基）
    const withDeck = (s: GameState): GameState => ({
      ...s,
      newsDeck: { order: [35, ...s.newsDeck.order.filter((x) => x !== 35)], cursor: 0 },
    });
    // ① 资金 > 10000 ⇒ 判据成立，抽到的就是 35
    const rich: GameState = {
      ...withDeck(on),
      companyFunds: on.companyFunds.map((f, i) => (i === CO ? 20_000 : f)),
    };
    const drawn = reduce(rich, { type: 'settle' }, topo);
    expect(drawn.lastEvent?.id, '资金够时 35 必须被抽到').toBe(35);

    // ② 全部为 0 ⇒ 判据不成立，牌堆跳过 35（抽到别的）
    const poor: GameState = withDeck({ ...on, companyFunds: on.companyFunds.map(() => 0) });
    const skipped = reduce(poor, { type: 'settle' }, topo);
    expect(skipped.lastEvent?.id, '资金不足时 35 不能被抽到').not.toBe(35);
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

// ============================================================
//  ★★ 新聞 29「%s違法超貸 經營者%s坐牢５天」
//  @source `fcn_0044b25b`：phase 0 在**企業表**裡隨機抽一家有主企業（一次 rand()），
//    phase 1 過免罪(21)→嫁禍(19) 之後 `send_to_prison(受害者, 5)`。
//  這一組測的是 **reducer 的接線**（`drawAndApplyNews`）：
//    · `isNewsFeasible(29)` 讀的 `+0x18` 必須是**運行時**歸屬（`state.commercialOwners`）
//      —— 地圖模板裡恆為 0，讀錯它這條新聞**一次都抽不到**；
//    · 關的必須是**抽中的經營者**，不是抽牌者；
//    · 隨機流恰好多走一格；
//    · 保險理賠要落在**實際受害者**身上。
// ============================================================

describe('★★ 新聞 29「違法超貸」：目標由效果層隨機抽，不是抽牌者', () => {
  run('★ 抽到 29 → 关的是那家企業的經營者、抽牌者毫发无伤、恰好掷一次随机数', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null) return; // 这张图没有新聞格
    if (s1.commercialOwners.length <= 1) return; // 这张图没有企業
    // 把 1 号企業判给 2 号玩家 —— `+0x18` 是**运行时**字段，住在 `commercialOwners`
    const s2: GameState = {
      ...s1,
      commercialOwners: s1.commercialOwners.map((o, i) => (i === 1 ? { ...o, owner: 3 } : o)),
      newsDeck: { order: [29, ...s1.newsDeck.order.filter((x) => x !== 29)], cursor: 0 },
      // 2 号玩家（= 抽中的經營者）在保險期内
      players: s1.players.map((p, i) => (i === 2 ? { ...p, insuranceDays: 30 } : p)),
      // 保險公司理赔要有钱可付，否则可能只赔一部分
      companyFunds: s1.companyFunds.map(() => 10_000_000),
    };
    // 「只走一步」应该到的随机状态
    const probe = new WatcomRng(s2.rngState);
    probe.next();

    const s3 = reduce(s2, { type: 'settle' }, topo);
    expect(s3.lastEvent?.kind).toBe('news');
    // ★ 这条真的抽得到 —— 判据读的是运行时归属（模板 owner 恒 0）
    expect(s3.lastEvent?.id).toBe(29);
    // ★ 关的是 1 号企業的經營者 = 2 号玩家，5 天
    expect(s3.players[2]!.blocking.inPrison).toBe(5);
    expect(s3.prisonOccupancy[2]).toBe(1);
    // ★ 抽牌者（当前玩家）**一根汗毛都没动** —— 关抽牌者是「关错人」
    expect(s3.players[s2.currentPlayer]!.blocking.inPrison).toBe(0);
    expect(s3.prisonOccupancy[s2.currentPlayer]).toBe(0);
    // ★ 恰好消耗一次 rand()（抽企業那一步）
    expect(s3.rngState).toBe(probe.getState());
    // ★ 保險理賠（原版 `0x43edf8 call 0x44ba63` 在 `send_to_prison` 函數體內）：
    //   2000 × 天 × 物價，落在**實際受害者**身上
    expect(s3.players[2]!.cash - s2.players[2]!.cash).toBe(
      2000 * 5 * s2.priceIndex,
    );
    // 抽牌者也没拿到理赔
    expect(s3.players[s2.currentPlayer]!.cash).toBe(s2.players[s2.currentPlayer]!.cash);
  });

  run('★ 没有运行时归属的企業 ⇒ 29 不可行、牌堆跳过它（模板 owner 恒 0 的旧行为）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 5 });
    const s1 = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (s1 === null || s1.commercialOwners.length <= 1) return;
    // 全部归零 = 地图模板的样子 ⇒ `isNewsFeasible(29)` 必为 false
    const s2: GameState = {
      ...s1,
      commercialOwners: s1.commercialOwners.map((o) => ({ ...o, owner: 0 })),
      newsDeck: { order: [29, ...s1.newsDeck.order.filter((x) => x !== 29)], cursor: 0 },
      companyFunds: s1.companyFunds.map(() => 0),
    };
    const s3 = reduce(s2, { type: 'settle' }, topo);
    expect(s3.lastEvent?.id).not.toBe(29); // 跳过不可行的 29，改抽下一张
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

  run('★ 2026-09-23：**电脑**寿星当场收完，每收一张弹一扇「搶得%s的\\n\\n%s」（`fcn_0044192a` 电脑支 0x00441ab1）', () => {
    const { topo, s } = birthdayScene();
    if (s === null) return;
    const ai: GameState = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, whoPlays: 2 } : p)) };
    const s2 = reduce(ai, { type: 'settle' }, topo);
    expect(s2.pending?.kind).not.toBe('birthdayCard');
    const got = s2.players[0]!.cards;
    const robbed = s2.notices.filter((n) => n.key === 'card.robbed');
    expect(robbed).toHaveLength(got.length);
    expect(got.length).toBeGreaterThan(0);
    const names = ['沙隆巴斯', '忍太郎'];
    robbed.forEach((n, k) => {
      expect(n.args[0]).toBe(names[k]);
      expect(n.args[1]).toBe(CARDS[got[k]! - 1]!.name);
    });
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

  // ★★ 第十四份試玩回報 #1 顺带查出：命運罰款那一族**共用**尾巴 `0x0044cec2`，
  //   `0x0044cf11 call 0x44ba63`（保險理賠）不只 14 一条（见 `FORTUNE_PAY_TAIL_IDS` 的逐条入口）。
  run('★★ 保險期内抽到「付保險金 / 亂丟垃圾 / 請客 / 遺失錢包 / 被倒會」⇒ 付完**照样理赔**（@source 0x0044cf11）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const me = on.currentPlayer;
    // factor × 物價指數 1（`event-table.ts`）
    const cases: [number, number][] = [[17, 6000], [18, 600], [19, 1500], [23, 1000], [24, 2000], [26, 8000], [30, 5000]];
    expect(cases.every(([id]) => FORTUNE_PAY_TAIL_IDS.has(id))).toBe(true);
    for (const [id, amount] of cases) {
      const insured: GameState = {
        ...on,
        players: on.players.map((p, i) => (i === me ? { ...p, fortune: 0, insuranceDays: 30 } : p)),
      };
      const cash = insured.players[me]!.cash;
      const s2 = reduce(forceDraw(insured, id), { type: 'settle' }, topo);
      expect(s2.lastEvent).toEqual({ kind: 'fortune', id });
      // 罚金照付进公库，保險公司再赔回同一笔（進現金，`pay_money` 旗标 1）
      expect(s2.pool).toBe(insured.pool + amount);
      expect(s2.players[me]!.monthlyPaid).toBe(insured.players[me]!.monthlyPaid + amount);
      expect(s2.players[me]!.monthlyReceived).toBe(insured.players[me]!.monthlyReceived + amount);
      expect(s2.players[me]!.cash).toBe(cash);

      // 没保險 ⇒ 只付不赔
      const bare: GameState = {
        ...on,
        players: on.players.map((p, i) => (i === me ? { ...p, fortune: 0, insuranceDays: 0 } : p)),
      };
      const s3 = reduce(forceDraw(bare, id), { type: 'settle' }, topo);
      expect(s3.players[me]!.cash).toBe(bare.players[me]!.cash - amount);
      expect(s3.players[me]!.monthlyReceived).toBe(bare.players[me]!.monthlyReceived);
    }
  });

  // ════════════════════════════════════════════════════════════════
  //  ★★ 第十四份（需求方拍板照原版）：神明加持那一扇框 + 框之后那一句 + 理賠框 + 進帳台词提示
  // ════════════════════════════════════════════════════════════════
  const standFortune = (fortune: number, luck = 0, extra: Partial<GameState['players'][number]> = {}) => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return null;
    const me = on.currentPlayer;
    const s1: GameState = {
      ...on,
      players: on.players.map((p, i) => (i === me ? { ...p, fortune, luck, godInfo: 0, ...extra } : p)),
    };
    return { s1, me, topo };
  };

  run('★★ 罰款被神明免付 ⇒ 「%s保佑／免付罰金！」框（@source 0x0044b9c9）+ 之后 0x44f567 那一句（原额）', () => {
    const c = standFortune(101);
    if (c === null) return;
    const s2 = reduce(forceDraw(c.s1, 30), { type: 'settle' }, c.topo);
    expect(s2.notices).toEqual([
      { key: 'blessing.penaltyVoid', args: ['間諜'], beforeFilms: true, say: { player: c.me, reliefAmount: 5000 } },
    ]);
    expect(s2.pool).toBe(c.s1.pool);
  });

  run('★★ 罰款加倍 + 保險期 ⇒ 「罰金加倍」框在前、理賠框（2000 ms，×2 那一笔）在后；不带 say', () => {
    const c = standFortune(-1, 0, { insuranceDays: 30 });
    if (c === null) return;
    const s2 = reduce(forceDraw(c.s1, 30), { type: 'settle' }, c.topo);
    expect(s2.notices).toEqual([
      { key: 'blessing.penaltyDouble', args: ['間諜'], beforeFilms: true },
      { key: 'insurance.payout', args: [10000], holdMs: 2000 },
    ]);
  });

  run('★ 事件 3（支票跳票）財運 < 0 ⇒ 调用方只认 1（`0x0044c28d cmp eax,1`）⇒ **不弹**', () => {
    const c = standFortune(-1);
    if (c === null) return;
    const s2 = reduce(forceDraw(c.s1, 3), { type: 'settle' }, c.topo);
    if (s2.lastEvent?.id !== 3) return; // 这张图上 3 不可抽就跳过
    expect(s2.notices.filter((n) => n.key.startsWith('blessing.'))).toEqual([]);
  });

  run('★★ 坐牢被福運挡掉 ⇒ 「逃過此劫」框 + 之后事件 0（@source 0x0044d873）', () => {
    for (const id of [33, 34, 35, 36]) {
      const c = standFortune(0, 101);
      if (c === null) return;
      const s2 = reduce(forceDraw(c.s1, id), { type: 'settle' }, c.topo);
      expect(s2.lastEvent?.id).toBe(id);
      expect(s2.notices).toEqual([
        { key: 'blessing.misfortuneVoid', args: ['間諜'], beforeFilms: true, say: { player: c.me, event: 0 } },
      ]);
      expect(s2.players[c.me]!.blocking.inPrison).toBe(0);
    }
  });

  run('★★ 命運「進帳」那一族 ⇒ `lastGainSays`（0x0044d334）；獎金作廢 ⇒ 没有、只弹框', () => {
    const ok = standFortune(0);
    if (ok === null) return;
    const s2 = reduce(forceDraw(ok.s1, 25), { type: 'settle' }, ok.topo);
    expect(s2.lastGainSays).toEqual([{ player: ok.me, amount: 10000 }]);
    const voided = standFortune(-1);
    if (voided === null) return;
    const s3 = reduce(forceDraw(voided.s1, 25), { type: 'settle' }, voided.topo);
    expect(s3.lastGainSays ?? null).toBeNull();
    expect(s3.notices.map((n) => n.key)).toEqual(['blessing.rewardVoid']);
    // 只活一条 action
    const s4 = reduce(s2, { type: 'endTurn' }, ok.topo);
    expect(s4.lastGainSays ?? null).toBeNull();
  });

  run('★★ 命運 10 / 11 施加后那一句：10 用同一个发生器掷 `rand()&1`（@source 0x0044cb28）→ 事件 3|4；11 固定事件 3', () => {
    // 10 / 11 按座驾重映射（機車 → 10、汽車 → 11，`fortune.ts`）
    const moto = standFortune(0, 0, { trafficMethod: 1 });
    const car = standFortune(0, 0, { trafficMethod: 2 });
    if (moto === null || car === null) return;
    const s11 = reduce(forceDraw(car.s1, 11), { type: 'settle' }, car.topo);
    const s10 = reduce(forceDraw(moto.s1, 10), { type: 'settle' }, moto.topo);
    expect(s11.lastEvent).toEqual({ kind: 'fortune', id: 11, phraseIndex: 3 });
    expect(s10.lastEvent?.id).toBe(10);
    // 10 比 11 **多掷一次**（其余消耗两者相同：都是福運 0，不掷加持）
    const rng = new WatcomRng();
    rng.setState(s11.rngState);
    const v = rng.next();
    expect(s10.rngState).toBe(rng.getState());
    expect(s10.lastEvent?.phraseIndex).toBe(3 + (v & 1));
  });

  run('★ 被福運挡掉（逃過此劫）⇒ 不带那一句', () => {
    const c = standFortune(0, 101, { trafficMethod: 2 });
    if (c === null) return;
    const s2 = reduce(forceDraw(c.s1, 11), { type: 'settle' }, c.topo);
    expect(s2.lastEvent).toEqual({ kind: 'fortune', id: 11 });
  });

  run('★★ 命運 6 出國 3 天 ⇒ `0x0040d3f8` 那一句（事件 5）+ 保險期内理赔（`0x0040d425`）', () => {
    const c = standFortune(0, 0, { insuranceDays: 30 });
    if (c === null) return;
    const s2 = reduce(forceDraw(c.s1, 6), { type: 'settle' }, c.topo);
    expect(s2.lastEvent?.id).toBe(6);
    const victim = s2.lastDisappearSay?.player ?? -1;
    expect(s2.lastDisappearSay).toEqual({ player: victim, event: 5 });
    expect(s2.players[victim]!.blocking.disappearing & 0x3f).toBe(3);
    expect(s2.notices.at(-1)).toEqual({ key: 'insurance.payout', args: [6000], holdMs: 2000 });
  });

  run('★ 倒霉加倍（6 天）⇒ 中间档 `rand()&1`：事件 3|4，用同一个发生器掷', () => {
    const c = standFortune(0, -1);
    if (c === null) return;
    const s2 = reduce(forceDraw(c.s1, 6), { type: 'settle' }, c.topo);
    expect(s2.lastEvent?.id).toBe(6);
    expect([3, 4]).toContain(s2.lastDisappearSay?.event);
  });

  run('★ 16（汽車超速罰款）接上了加持：財運 > 100 ⇒ 免付', () => {
    const c = standFortune(101, 0, { trafficMethod: 2 });
    if (c === null) return;
    const cash = c.s1.players[c.me]!.cash;
    const s2 = reduce(forceDraw(c.s1, 16), { type: 'settle' }, c.topo);
    if (s2.lastEvent?.id !== 16) return;
    expect(s2.players[c.me]!.cash).toBe(cash);
    expect(s2.notices[0]?.key).toBe('blessing.penaltyVoid');
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

  // ══════════════════════════════════════════════════════════════════
  //  ★★ 第 160 条：命運 `pay` 支的**破产结算**（README §7.142(5) E3）
  //
  //  @source `0x44cec2 call 0x41d2c6`（pay_money 现金→存款→**破产**）
  //    紧接 `0x44ced1 mov al,[player+0x15] / test al,al / je 尾声`。
  //  ⇒ 掏不出全额：`0x40cd87` 当场出局，回到事件后**整段尾部被跳过**
  //    （第二句台词 + `0x44cf11 call 0x44ba63` 的意外理赔）。
  //  ⚠️ 两口袋都空时 pay_money **仍然**把实付额记进本月支出并送进公库 ——
  //    `0x40cd87` 是 `call`（会返回），返回后落在 `0x41d37e add [+0x5c],ebx`
  //    与 `0x41d387 add [0x499080],ebx`，故公库拿得到那笔残缺的实付。
  // ══════════════════════════════════════════════════════════════════
  run('★★ 现金+存款都不够 ⇒ 出局、公库只拿到实付的那一点', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const me = on.currentPlayer;
    // 两个口袋加起来 100，罚金 3000（物价指数 1）
    const s1: GameState = {
      ...on,
      players: on.players.map((p, i) =>
        i === me ? { ...p, cash: 60, moneyInBank: 40, fortune: 0, insuranceDays: 30 } : p,
      ),
    };
    const pool0 = s1.pool;
    const s2 = reduce(forceDraw(s1, 14), { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(14);
    // ★ 出局（原版在 pay_money **内部**就把 who_plays 清了）
    expect(isAlive(s2.players[me]!)).toBe(false);
    expect(s2.players[me]!.whoPlays).toBe(0);
    expect(s2.players[me]!.cash).toBe(0);
    expect(s2.players[me]!.moneyInBank).toBe(0);
    // ★ 只赔了实付的那 100（不是 0、不是 3000）
    expect(s2.pool).toBe(pool0 + 100);
  });

  run('★★ 边界：两个口袋恰好 = 罚金 ⇒ **不**出局、公库拿满额', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return;
    const me = on.currentPlayer;
    const s1: GameState = {
      ...on,
      players: on.players.map((p, i) =>
        i === me ? { ...p, cash: 0, moneyInBank: 3000, fortune: 0 } : p,
      ),
    };
    const pool0 = s1.pool;
    const s2 = reduce(forceDraw(s1, 14), { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(14);
    // 原版 `jge 0x41d37e`：恰好付清 ⇒ 不破产
    expect(isAlive(s2.players[me]!)).toBe(true);
    expect(s2.players[me]!.moneyInBank).toBe(0);
    expect(s2.pool).toBe(pool0 + 3000);
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

/**
 * ★★ 「神明加持」的随机数消耗**只在 50 < 值 ≤ 100 这一档**（第 37 条）。
 *
 * @source `0x44b8c1`：`cmp si,0x64 / jle 查50`（>100 直接定档、不掷）
 *   → `cmp si,0x32 / jle 查负`（≤50 也不掷）→ 只有中间那一档 `call 0x456f2d`。
 *
 * 事件 2（冒貸，`blessing: 'penalty'`）本身不掷随机数，故它是干净的探针：
 * 加持值落在不掷的档位时，整场结算的 `rngState` 必须**一个字节都不动**。
 * 先前 `reduce.ts` 无条件 `rng.next()`，这两条会红。
 */
describe('★★ 命運「神明加持」的 rand 只在 50<值≤100 掷（第 37 条）', () => {
  /** 把命運牌堆拨到「下一张就是 2（冒貸）」，并把当前玩家的 fortune 设成给定值 */
  function setup(fortune: number): { state: GameState; topo: ReturnType<typeof topoOf> } | null {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({ map, players: players(), seed: 5 });
    const on = standOn(base, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return null;
    const state: GameState = {
      ...on,
      fortuneDeck: { order: [2, ...on.fortuneDeck.order.filter((x) => x !== 2)], cursor: 0 },
      players: on.players.map((p, i) => (i === on.currentPlayer ? { ...p, fortune } : p)),
    };
    return { state, topo };
  }

  run('值 ∈ {>100, 101, 50, 0, 负} ⇒ 不掷：整场结算 rngState 原样', () => {
    for (const v of [200, 101, 50, 0, -1]) {
      const env = setup(v);
      if (env === null) return; // 这张图没有命運格
      const after = reduce(env.state, { type: 'settle' }, env.topo);
      expect(after.lastEvent?.kind).toBe('fortune');
      expect(after.lastEvent?.id).toBe(2); // 确实抽到了探针事件
      expect(after.rngState, `fortune=${v} 时不应消耗随机数`).toBe(env.state.rngState);
    }
  });

  run('值 = 75（与 100）⇒ 恰好前进一次（手工推一步作真值）', () => {
    for (const v of [75, 100]) {
      const env = setup(v);
      if (env === null) return;
      const rng = new WatcomRng();
      rng.setState(env.state.rngState);
      rng.next(); // 唯一的那一次
      const after = reduce(env.state, { type: 'settle' }, env.topo);
      expect(after.lastEvent?.id).toBe(2);
      expect(after.rngState, `fortune=${v} 应恰好前进一步`).toBe(rng.getState());
    }
  });
});

// ============================================================
//  ★★ 命運的「免罪卡(21) → 嫁禍卡(19)」二级判定接进 reducer
//  @source `fcn_00441210`：命運 4 个调用点 `0x44c6c5` / `0x44c7d7`
//    （出國·綁架）、`0x44cd41`（就醫）、`0x44d8a9`（酒醉坐牢）。
//
//  這一組測的是**接線**（不只是效果函數）：
//    · 持 21 ⇒ 不關人、21 從**狀態**裡消失、`rngState` 一格不動；
//    · 持 19 ⇒ 關的是**別人**（`0x44476a` mode 0 的挑人規則）、19 被扣、
//      隨機流**恰好**多走一格、**保險理賠落在替死鬼身上**；
//    · 真人持 19 ⇒ 一律放棄轉嫁（D-003/D-008）：19 留著、本人坐牢、不擲隨機。
// ============================================================

describe('★★ 命運的免罪(21)/嫁禍(19) 二級判定接進 reducer @source 0x441210', () => {
  /** 把命運牌堆撥到「下一張就是 id」，並可改寫幾位玩家 */
  function forceFortune(
    id: number,
    over: (p: GameState) => GameState,
  ): { state: GameState; topo: ReturnType<typeof topoOf> } | null {
    const map = loadMap();
    const topo = topoOf(map);
    const base = newGame({ map, players: players(), seed: 5 });
    const on = standOn(base, map, SPECIAL_KIND.FORTUNE);
    if (on === null) return null;
    const withDeck: GameState = {
      ...on,
      fortuneDeck: { order: [id, ...on.fortuneDeck.order.filter((x) => x !== id)], cursor: 0 },
    };
    return { state: over(withDeck), topo };
  }

  const setPlayer = (s: GameState, i: number, patch: Partial<GameState['players'][number]>) => ({
    ...s,
    players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)),
  });

  run('★ 命運 33（酒醉坐牢）：持免罪卡(21) ⇒ 不坐牢、21 從狀態裡消失、隨機流不動', () => {
    const env = forceFortune(33, (s) =>
      setPlayer(s, s.currentPlayer, { cards: [PASSIVE_CARDS.ABSOLUTION] }),
    );
    if (env === null) return;
    const me = env.state.currentPlayer;
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.lastEvent?.id).toBe(33);
    expect(after.players[me]!.blocking.inPrison).toBe(0);
    expect(after.prisonOccupancy[me]).toBe(0);
    // ★ 卡真的被消耗（`0x441226 push esi / call 0x444bb2`）
    expect(after.players[me]!.cards).toEqual([]);
    // ★ 免罪支不擲隨機
    expect(after.rngState).toBe(env.state.rngState);
  });

  run('★ 命運 33：持嫁禍卡(19)、電腦 ⇒ 關的是**別人**、19 被扣、恰好前進一格隨機數', () => {
    const env = forceFortune(33, (s) =>
      setPlayer(s, s.currentPlayer, { cards: [PASSIVE_CARDS.SCAPEGOAT] }),
    );
    if (env === null) return;
    const me = env.state.currentPlayer;
    // 沒有最恨的人 ⇒ 走 `0x4448c0 call 0x40d31c` 隨機挑一個 ⇒ **恰好一步**
    const probe = new WatcomRng();
    probe.setState(env.state.rngState);
    probe.next();
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.lastEvent?.id).toBe(33);
    expect(after.rngState).toBe(probe.getState());
    // 本人在外面、卡沒了
    expect(after.players[me]!.blocking.inPrison).toBe(0);
    expect(after.prisonOccupancy[me]).toBe(0);
    expect(after.players[me]!.cards).toEqual([]);
    // 恰好有一位別人被關 3 天（酒醉大鬧的 literal）
    const victims = after.players
      .map((p, i) => ({ i, d: p.blocking.inPrison }))
      .filter((x) => x.d !== 0);
    expect(victims).toHaveLength(1);
    expect(victims[0]!.i).not.toBe(me);
    expect(victims[0]!.d).toBe(3);
    expect(after.prisonOccupancy[victims[0]!.i]).toBe(1);
  });

  run('★★ 命運 33：替死鬼在保險期內 ⇒ 理賠給**替死鬼**（關誰賠誰）', () => {
    const env = forceFortune(33, (s) => {
      const me = s.currentPlayer;
      const withCard = setPlayer(s, me, { cards: [PASSIVE_CARDS.SCAPEGOAT] });
      // 4 位全部在保險期內、公司有錢賠 —— 這樣「賠給誰」才可區分
      return {
        ...withCard,
        players: withCard.players.map((p) => ({ ...p, insuranceDays: 30 })),
        companyFunds: withCard.companyFunds.map(() => 10_000_000),
      };
    });
    if (env === null) return;
    const me = env.state.currentPlayer;
    const before = env.state.players.map((p) => p.cash);
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    const victim = after.players.findIndex((p, i) => i !== me && p.blocking.inPrison !== 0);
    expect(victim).toBeGreaterThanOrEqual(0);
    // 2000 × 3 天 × 物價 —— 記在**受害者**頭上
    expect(after.players[victim]!.cash - before[victim]!).toBe(2000 * 3 * env.state.priceIndex);
    // 抽牌者一分沒多拿（他不是受害者）
    expect(after.players[me]!.cash).toBe(before[me]);
  });

  run('★★ 命運 33：**真人**持 19 ⇒ 放棄轉嫁：19 留著、本人坐牢 3 天、隨機流不動', () => {
    const env = forceFortune(33, (s) => {
      const me = s.currentPlayer;
      return setPlayer(s, me, { whoPlays: 1, cards: [PASSIVE_CARDS.SCAPEGOAT] });
    });
    if (env === null) return;
    const me = env.state.currentPlayer;
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.lastEvent?.id).toBe(33);
    expect(after.players[me]!.blocking.inPrison).toBe(3);
    expect(after.prisonOccupancy[me]).toBe(1);
    expect(after.players[me]!.cards).toEqual([PASSIVE_CARDS.SCAPEGOAT]);
    expect(after.rngState).toBe(env.state.rngState);
  });

  run('★ 命運 12（就醫）：持 21 ⇒ 不住院、21 被扣、醫院那張表也不動', () => {
    const env = forceFortune(12, (s) =>
      setPlayer(s, s.currentPlayer, { cards: [PASSIVE_CARDS.ABSOLUTION] }),
    );
    if (env === null) return;
    const me = env.state.currentPlayer;
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.lastEvent?.id).toBe(12);
    expect(after.players[me]!.blocking.inHospital).toBe(0);
    expect(after.hospitalOccupancy[me]).toBe(0);
    expect(after.players[me]!.cards).toEqual([]);
    expect(after.rngState).toBe(env.state.rngState);
  });

  run('★ 命運 7（被外星人綁架）：持 21 ⇒ 不消失、21 被扣、隨機流不動', () => {
    const env = forceFortune(7, (s) =>
      setPlayer(s, s.currentPlayer, { cards: [PASSIVE_CARDS.ABSOLUTION] }),
    );
    if (env === null) return;
    const me = env.state.currentPlayer;
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.lastEvent?.id).toBe(7);
    expect(after.players[me]!.blocking.disappearing).toBe(0);
    expect(after.players[me]!.cards).toEqual([]);
    expect(after.rngState).toBe(env.state.rngState);
  });

  run('★ 命運 7：持 19（電腦）⇒ 消失的是**別人**、19 被扣、恰好前進一格', () => {
    const env = forceFortune(7, (s) =>
      setPlayer(s, s.currentPlayer, { cards: [PASSIVE_CARDS.SCAPEGOAT] }),
    );
    if (env === null) return;
    const me = env.state.currentPlayer;
    const probe = new WatcomRng();
    probe.setState(env.state.rngState);
    probe.next();
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.lastEvent?.id).toBe(7);
    expect(after.rngState).toBe(probe.getState());
    expect(after.players[me]!.blocking.disappearing).toBe(0);
    expect(after.players[me]!.cards).toEqual([]);
    const gone = after.players
      .map((p, i) => ({ i, d: p.blocking.disappearing }))
      .filter((x) => x.d !== 0);
    expect(gone).toHaveLength(1);
    expect(gone[0]!.i).not.toBe(me);
    // 原因位 = 1（被綁架）；低 6 位 = 天數 3
    expect(gone[0]!.d & 0x3f).toBe(3);
    expect(gone[0]!.d >> 6).toBe(DISAPPEAR_REASON_ABDUCTED);
  });

  run('★ 一張卡都不持 ⇒ 现状不变、隨機流一格不動（回归：不能誤觸發）', () => {
    const env = forceFortune(33, (s) => s);
    if (env === null) return;
    const me = env.state.currentPlayer;
    const after = reduce(env.state, { type: 'settle' }, env.topo);
    expect(after.players[me]!.blocking.inPrison).toBe(3);
    expect(after.prisonOccupancy[me]).toBe(1);
    expect(after.rngState).toBe(env.state.rngState);
  });
});

describe('★★ 第十四份：新聞 8/9/10 受奖人的進帳台词提示（@source 0x00449a80 call 0x44f354）', () => {
  run('新聞 8「表揚第一大地主」⇒ `lastGainSays` = [受奖人, 10000×物價]', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s0 = newGame({ map, players: players(), seed: 7 });
    const on = standOn(s0, map, SPECIAL_KIND.NEWS);
    if (on === null) return;
    // 让 1 号名下有一块地 ⇒ 他就是第一大地主
    const landId = (map.lands ?? [])[0]!.id;
    const landOwner = [...on.landOwner];
    landOwner[landId] = 2;
    const forced: GameState = {
      ...on,
      landOwner,
      newsDeck: { ...on.newsDeck, order: [8, ...on.newsDeck.order.filter((x) => x !== 8)], cursor: 0 },
    };
    const s2 = reduce(forced, { type: 'settle' }, topo);
    expect(s2.lastEvent?.id).toBe(8);
    expect(s2.lastGainSays).toEqual([{ player: 1, amount: 10000 * s2.priceIndex }]);
    expect(s2.players[1]!.monthlyReceived - forced.players[1]!.monthlyReceived).toBe(10000 * s2.priceIndex);
  });
});
