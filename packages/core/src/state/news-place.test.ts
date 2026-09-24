/*
 * 新聞「随机挑一处建筑」那一族（5 / 15 / 19 / 20 / 21）—— 挑中的那一处交给表现层
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第十二份試玩回報（Charles，`wt12/20260923-015102989-manual-Charles.json`）：
 * 「龙卷风摧毁房屋没有看到具体哪个房子受影响，也没看到特效动画」。
 *
 * 重放那份回报（第 96 条 `settle`，P1 抽到新聞 21）：core 挑中的是 **合肥**（地块 61，
 * level 0、无主）⇒ `mutate_land` 什么都没改。原版此时照样：訊息框写「龍捲風侵襲**合肥**」、
 * 镜头移到合肥、播 0x217 龍捲風。本引擎先前三样都没有 —— 因为挑中的那一处
 * **根本没交出来**（只在「真的改了」时才有 `landMutations`）。
 *
 * 这里钉 core 那一半（`place` + `lastViewTarget`）；表现层那一半见
 * `client/src/news-place-fx.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { applyNewsEffect } from '../events/news-effects.ts';
import { makePlayer, topoOf } from '../testing/factories.ts';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const ctx = (over = {}) => ({
  players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 })),
  affected: [0],
  priceIndex: 1,
  pool: 0,
  ...over,
});
const land = (id: number, level: number, owner = 0, type = 0) =>
  ({ id, name: `L${id}`, level, type, owner, landPrice: 100, x: id * 10, y: id * 20 }) as never;
const fac = (id: number, level: number, owner = 0, type = 1) =>
  ({ id, name: `F${id}`, level, type, owner, landPrice: 100, x: id * 30, y: id * 40 }) as never;

describe('★ applyNewsEffect：挑中的那一处（`place`）@source 新聞 21 fcn_0044ac99 pass 0', () => {
  it('★★ 回报现场的形状：21 挑到**空地**（level 0、无主）⇒ 什么都不改，但 `place` 照样带出来', () => {
    // 原版：`0x0044acbd rand() % (地块+設施)` → strcpy 名字 → sprintf → pass 1 view_to + 影片，
    //   `mutate_land(实体, 0)` 对 level 0 的地块不改任何字段（changed = false）
    const r = applyNewsEffect(21, ctx({ lands: [land(1, 0), land(2, 3, 2)], facilities: [], rng: { below: () => 0 } }));
    expect(r.landMutations).toBeUndefined();
    expect(r.amount).toBe(0);
    expect(r.place).toEqual({ entity: 0x7d0 + 1, owner: 0 });
  });

  it('★ 21 挑到有主的房子：`owner` 是**改之前**的主人（原版 pass 0 就存进 [0x48c5a0]）', () => {
    const r = applyNewsEffect(21, ctx({ lands: [land(1, 0), land(2, 3, 2)], facilities: [], rng: { below: () => 1 } }));
    expect(r.landMutations).toEqual([{ id: 2, level: 2, type: 0, owner: 2 }]);
    expect(r.place).toEqual({ entity: 0x7d0 + 2, owner: 2 });
  });

  it('★ 21 挑到設施：实体编码 = 0xfa0 + 設施 id（与原版 `0x0044ad1a mov eax,0xfa1` 一致）', () => {
    const r = applyNewsEffect(21, ctx({ lands: [land(1, 0)], facilities: [fac(1, 2, 3)], rng: { below: () => 1 } }));
    expect(r.place).toEqual({ entity: 0xfa0 + 1, owner: 3 });
  });

  it('★ 5 / 15 / 19 同一支（`razeMode`）：候选集各自过滤，`place` 指向候选里的那一处', () => {
    // 15：只地块、只有等级的 ⇒ 候选 = [地块 2]
    const r15 = applyNewsEffect(15, ctx({ lands: [land(1, 0), land(2, 1, 1)], facilities: [fac(1, 2)], rng: { below: () => 0 } }));
    expect(r15.place).toEqual({ entity: 0x7d0 + 2, owner: 1 });
    // 5：有等级的地块 + 設施 ⇒ 候选 = [地块 2, 設施 1]，below=1 → 設施 1；清归属之后 owner 仍报**改之前**的
    const r5 = applyNewsEffect(5, ctx({ lands: [land(1, 0), land(2, 1, 1)], facilities: [fac(1, 2, 4)], rng: { below: () => 1 } }));
    expect(r5.facilityMutations).toEqual([{ id: 1, level: 0, type: 0, owner: 0 }]);
    expect(r5.place).toEqual({ entity: 0xfa0 + 1, owner: 4 });
    // 19：全部、清归属
    const r19 = applyNewsEffect(19, ctx({ lands: [land(1, 0, 2)], facilities: [], rng: { below: () => 0 } }));
    expect(r19.place).toEqual({ entity: 0x7d0 + 1, owner: 2 });
  });

  it('★ 20 超級颱風：爆心那一处也带出来（`0x0044ac19` 取它的坐标 → view_to）', () => {
    const r = applyNewsEffect(20, ctx({ lands: [land(1, 0), land(2, 0)], facilities: [], rng: { below: () => 1 } }));
    expect(r.place).toEqual({ entity: 0x7d0 + 2, owner: 0 });
  });

  it('★ 候选集为空（原版 idiv 除零）⇒ 不带 `place`', () => {
    const r = applyNewsEffect(15, ctx({ lands: [land(1, 0)], facilities: [], rng: { below: () => 0 } }));
    expect(r.place).toBeUndefined();
  });

  it('★ 随机只消耗**一次**（`place` 是纯表现，不许多吃 RNG）', () => {
    const calls: number[] = [];
    applyNewsEffect(21, ctx({ lands: [land(1, 0), land(2, 3, 2)], facilities: [fac(1, 1)], rng: { below: (n: number) => (calls.push(n), 0) } }));
    expect(calls).toEqual([3]);
  });
});

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

describe('★ reduce：新聞 21 落地 ⇒ `lastEvent.place` + 镜头移过去（`view_to(x, y, 2)` @ 0x0044aded）', () => {
  const setup = (mutate: (s: GameState) => GameState) => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = topoOf(map);
    const s0 = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 5 });
    const node = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.NEWS)!;
    const s1: GameState = mutate({
      ...s0,
      players: s0.players.map((p, i) => (i === s0.currentPlayer ? { ...p, nodeId: node.id } : p)),
      phase: 'settling',
      newsDeck: { order: [21, ...s0.newsDeck.order.filter((x) => x !== 21)], cursor: 0 },
    });
    return { map, topo, s1, s2: reduce(s1, { type: 'settle' }, topo) };
  };

  run('★★ 全图都是空地（回报现场的形状）⇒ 状态一格不改，但 `place` 与镜头照样给', () => {
    const { map, s1, s2 } = setup((s) => s);
    expect(s2.lastEvent?.kind).toBe('news');
    expect(s2.lastEvent?.id).toBe(21);
    const place = s2.lastEvent?.place;
    expect(place).toBeDefined();
    expect(place!.owner).toBe(0);
    // 镜头 = 那一处的地图坐标（`0x40af12` 取的就是地块/設施表的 +0/+2）
    const e = place!.entity;
    const at = e >= 0xfa0 ? map.facilities.find((f) => f.id === e - 0xfa0)! : map.lands.find((l) => l.id === e - 0x7d0)!;
    expect(s2.lastViewTarget).toEqual({ x: at.x, y: at.y });
    // 新局全是空地：level 0 的地块 `mutate_land` 不改；設施開局就有等级的话会降一级 —— 只断言地块没被动
    if (e < 0xfa0) expect(s2.landLevel).toEqual(s1.landLevel);
  });

  run('★ 挑中的是有主的房子 ⇒ `place.owner` 是改之前的主人（房主台词要用）', () => {
    // 把全图地块都给 2 号玩家、盖到 3 级 —— 不管挑中哪一块都是「有主、有房」
    const { s1, s2 } = setup((s) => ({
      ...s,
      landOwner: s.landOwner.map((_, i) => (i === 0 ? 0 : 3)),
      landLevel: s.landLevel.map((_, i) => (i === 0 ? 0 : 3)),
      facilityOwner: s.facilityOwner.map((_, i) => (i === 0 ? 0 : 3)),
      facilityLevel: s.facilityLevel.map((_, i) => (i === 0 ? 0 : 3)),
    }));
    const place = s2.lastEvent?.place;
    expect(place?.owner).toBe(3);
    const e = place!.entity;
    if (e < 0xfa0) {
      expect(s2.landLevel[e - 0x7d0]).toBe(2);
      expect(s1.landLevel[e - 0x7d0]).toBe(3);
    } else {
      expect(s2.facilityLevel[e - 0xfa0]).toBe(2);
    }
  });
});

describe('★★ 第二十一份：新聞 4「外星人攻打地球」⇒ 镜头移到**爆心**（`view_to(x, y, 2)` @ 0x0044921d）', () => {
  // 回报 `20260924-143640603`（第 28 回合 `settle`）：0 号踩上新聞格（节点 69，(791,1512)），
  //   爆心挑中的是远在 (1933,537) 的那块房子 ⇒ 他不在半径 0x64 的窗里、不住院（规则对）；
  //   可镜头没动，整幅盖在棋盘上的飛碟影片看着像射中了他本人。
  run('★★ 唯一盖了房子的地块远离新聞格 ⇒ `lastViewTarget` = 那块地；踩新聞格的人不住院', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = topoOf(map);
    const s0 = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })), seed: 5 });
    const news = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.NEWS)!;
    const far = map.lands.find((l) => Math.abs(l.x - news.x) > 300 && Math.abs(l.y - news.y) > 300)!;
    const s1: GameState = {
      ...s0,
      players: s0.players.map((p) => ({ ...p, nodeId: news.id })),
      landOwner: s0.landOwner.map((o, i) => (i === far.id ? 3 : o)),
      landLevel: s0.landLevel.map((_, i) => (i === far.id ? 1 : 0)),
      facilityLevel: s0.facilityLevel.map(() => 0),
      phase: 'settling',
      newsDeck: { order: [4, ...s0.newsDeck.order.filter((x) => x !== 4)], cursor: 0 },
    };
    const s2 = reduce(s1, { type: 'settle' }, topo);
    expect(s2.lastEvent).toMatchObject({ kind: 'news', id: 4 });
    expect(s2.lastViewTarget).toEqual({ x: far.x, y: far.y });
    expect(s2.lastViewTarget).not.toEqual({ x: news.x, y: news.y });
    // 爆心那块被重击清掉；踩新聞格的人（全站在新聞格上）一个都没住院
    expect(s2.landLevel[far.id]).toBe(0);
    for (const p of s2.players) expect(p.blocking.inHospital).toBe(0);
  });
});
