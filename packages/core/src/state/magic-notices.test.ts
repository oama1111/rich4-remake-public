/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 魔法屋效果派发 `0x431caa` 的**表现提示**（2026-09-23 再审）：
 *   ① 每个中签者一扇訊息框「名字\n\n效果名」（`0x440cac(…, 0x5dc)`），有闸的几支闸不过就不弹；
 *   ② 「得一張卡片」那一扇是「名字\n\n得到XX卡！」；
 *   ③ 电脑那一支先弹「条件\n\n效果」（`0x004339bd`），真人那一支没有（女巫窗口就是它）；
 *   ④ 加蓋 / 拆除两支 view_to 那块地（`0x41d476`，→ `lastViewTarget`）；
 *   ⑤ 加蓋那一支的大锤影片**无条件**播（0x00432074 不看 0x40b110 的返回值）⇒ 没盖动也交一条提示。
 *
 * 这些都是纯表现提示（C-DET-4）：不进指纹、不进存档，规则结果一个字节都不变。
 */

import { describe, expect, it } from 'vitest';
import { CARDS, CHARACTERS, MAGIC_HOUSE_OPTIONS } from '@rich4/data';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { MAGIC_TARGET_NAMES } from '../places/magic-house.ts';
import { reduce, type MapTopology } from './reduce.ts';
import type { GameState, NoticeHint } from './types.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from './types.ts';

/** 1 号 = 地块（住宅，(640,320)）；2 号 = 普通特殊格；3 号 = 魔法屋 */
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, type: 0x7d0 + 1, adjacent: [2], ref: { kind: 'land', index: 1 } }),
    makeNode({ id: 2, adjacent: [3] }),
    makeNode({ id: 3, adjacent: [1], specialKind: SPECIAL_KIND.MAGIC_HOUSE }),
  ],
  lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 0, level: 0, x: 640, y: 320 })],
};

const nameOf = (character: number) => CHARACTERS[character]?.name ?? '';

/** 四个人：0、2 站在地块上，1（触发者）、3 站在普通格 */
function table(over: Partial<GameState> = {}, whoPlays1 = WHO_PLAYS_HUMAN): GameState {
  const seat = (index: number, nodeId: number, whoPlays = WHO_PLAYS_HUMAN) =>
    makePlayer({ index, character: index, nodeId, whoPlays, cash: 5000, moneyInBank: 0 });
  return makeGameState({
    currentPlayer: 1,
    phase: 'turnEnd',
    players: [seat(0, 1), seat(1, 2, whoPlays1), seat(2, 1), seat(3, 2, WHO_PLAYS_COMPUTER)],
    landOwner: [0, 1],
    landLevel: [0, 2],
    landType: [0, 0],
    ...over,
  });
}

/** 真人点定 `option`，名单 = `targets` */
function pick(option: number, targets: number[], over: Partial<GameState> = {}): GameState {
  const s: GameState = { ...table(over), pending: { kind: 'magicHouse', criterion: 11, targets } };
  return reduce(s, { type: 'magicHouse', option }, topo);
}

/** 收尾空等（`fcn_0045285e`）：0/4/8 → 0xc8（0x00431d53）、7 → 0x1f4（0x004321e6） */
const AFTER: Record<number, number> = { 0: 200, 4: 200, 7: 500, 8: 200 };

const effect = (who: number, option: number): NoticeHint => ({
  key: 'magic.effect',
  args: [nameOf(who), MAGIC_HOUSE_OPTIONS[option]!.name],
  beforeFilms: true,
  ...(AFTER[option] === undefined ? {} : { afterMs: AFTER[option] }),
});

describe('★ 魔法屋訊息框：每个中签者一扇（`0x431caa` 每一支开头的 `0x440cac(…, 0x5dc)`）', () => {
  it('★★ 存入所有現金，名单 [0, 2] ⇒ 两扇、按名单顺序；真人那一支**没有**「条件\\n\\n效果」那一扇', () => {
    const r = pick(4, [0, 2]);
    expect(r.notices).toEqual([effect(0, 4), effect(2, 4)]);
    expect(r.notices.some((n) => n.key === 'magic.spin')).toBe(false);
    // 规则结果不受影响
    expect(r.players[0]!.cash).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(5000);
  });

  it('★ 无闸的几支一律弹：0 / 1 / 2 / 3 / 4 / 8 / 10；0 / 4 / 8 收尾空等 200 ms、7 空等 500 ms', () => {
    expect(effect(0, 0).afterMs).toBe(0xc8);
    expect(effect(0, 7).afterMs).toBe(0x1f4);
    expect(effect(0, 3).afterMs).toBeUndefined();
    for (const option of [0, 3, 4, 8]) {
      expect(pick(option, [3]).notices, `效果 ${option}`).toEqual([effect(3, option)]);
    }
    // 1（抽命運三張）/ 2（坐牢）/ 10（住院）后面还有子流程，那几扇排在魔法屋这一扇**后面**
    for (const option of [2, 10]) {
      expect(pick(option, [3]).notices[0], `效果 ${option}`).toEqual(effect(3, option));
    }
  });

  it('★★ 5 就地加蓋 / 9 就地拆除：闸 = `[player+0x32]` + 格型别 ∈ (0x7d0, 0x1770) —— 站在普通格上的人**不弹**', () => {
    expect(pick(5, [0, 3]).notices).toEqual([effect(0, 5)]);
    expect(pick(9, [0, 3]).notices).toEqual([effect(0, 9)]);
    // 住店中（+0x32）同样整支跳过
    const hotel = table();
    const players = hotel.players.map((p, i) => (i === 0 ? { ...p, blocking: { ...p.blocking, inHotel: 2 } } : p));
    expect(pick(5, [0], { players }).notices).toEqual([]);
  });

  it('★ 7 向後轉：只有 `[player+0x32]` 那一道（不看格型别）', () => {
    expect(pick(7, [3]).notices).toEqual([effect(3, 7)]);
    const t = table();
    const players = t.players.map((p, i) => (i === 3 ? { ...p, blocking: { ...p.blocking, inPrison: 3 } } : p));
    expect(pick(7, [3], { players }).notices).toEqual([]);
  });

  it('★ 6 得一張卡片：「名字\\n\\n得到XX卡！」（`0x00432122 push 0x464839`）；牌堆抽空不弹', () => {
    // 牌堆里只剩一种卡（3 张 = 第 5 号卡）⇒ 抽到的必是它
    const cardAmount = new Array<number>(30).fill(0);
    cardAmount[4] = 3;
    const r = pick(6, [3], { cardAmount });
    const got = r.players[3]!.cards.at(-1)!;
    expect(got).toBe(5);
    expect(r.notices).toEqual([
      { key: 'magic.gotCard', args: [nameOf(3), CARDS[got - 1]!.name], beforeFilms: true },
    ]);
    // 牌堆空：没发出卡 ⇒ 不弹（原版会读表外那一格当卡名，见 D-MAGIC-16）
    expect(pick(6, [3]).notices).toEqual([]);
  });
});

describe('★ 加蓋 / 拆除：view_to 那块地 + 大锤无条件', () => {
  it('★★ 就地加蓋：镜头对到地块 (640,320)；盖了一级、交一条 magicHouse 提示', () => {
    const r = pick(5, [0]);
    expect(r.lastViewTarget).toEqual({ x: 640, y: 320 });
    expect(r.landLevel[1]).toBe(3);
    expect(r.lastBuildUpgrades).toEqual([{ entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'magicHouse' }]);
  });

  it('★★ 已经 5 级（盖不动）：等级不变，但**照样**交一条提示（原版照播大锤）', () => {
    const r = pick(5, [0], { landLevel: [0, 5] });
    expect(r.landLevel[1]).toBe(5);
    expect(r.lastBuildUpgrades).toEqual([{ entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'magicHouse' }]);
    expect(r.notices).toEqual([effect(0, 5)]);
  });

  it('★ 就地拆除：镜头对到地块；拆一层', () => {
    const r = pick(9, [0]);
    expect(r.lastViewTarget).toEqual({ x: 640, y: 320 });
    expect(r.landLevel[1]).toBe(1);
  });
});

describe('★★ 电脑那一支：先弹「条件\\n\\n效果」（`0x00433981..0x004339bd`）再逐人', () => {
  it('★ 第一扇是 magic.spin，args = [条件名（无 `#00NN`）, 效果名]；其后才是逐人那几扇', () => {
    const s: GameState = {
      ...table({}, WHO_PLAYS_COMPUTER),
      phase: 'settling',
      players: table({}, WHO_PLAYS_COMPUTER).players.map((p, i) => (i === 1 ? { ...p, nodeId: 3 } : p)),
    };
    const r = reduce(s, { type: 'settle' }, topo);
    const ev = r.lastEvent;
    expect(ev?.kind).toBe('magicHouse');
    if (ev === null || ev.kind !== 'magicHouse') throw new Error('unreachable');
    expect(r.notices[0]).toEqual({
      key: 'magic.spin',
      args: [MAGIC_TARGET_NAMES[ev.criterion!], MAGIC_HOUSE_OPTIONS[ev.id]!.name],
      beforeFilms: true,
    });
    expect(MAGIC_TARGET_NAMES[ev.criterion!]!.startsWith('#')).toBe(false);
  });
});
