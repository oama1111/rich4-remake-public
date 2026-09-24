/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 第 24 份试玩回报 `20260924-181812507`（第 27 回合）「财产最多的人向后转没生效」：
 *   电脑踩魔法屋转出「財產最多的人 / 向後轉」，宮本寶藏的 `direction` 3 → 7 改了，
 *   `lastNodeId` 却没动 —— 走子只看来路（`pickNextNode` 避开 `lastNodeId`），于是下一趟照原方向走。
 *
 * @source 魔法屋效果 7：0x00432160 闸 → 0x004321c1 訊息框 1500 ms → ★ 0x004321d0 `call 0x40c78c(当前玩家)`
 *   —— 与轉向卡 0x00443025 **同一个函数**：0x0040c7b8 `add dl,4 / and dl,7` 掉头，
 *   0x0040c7c4..0x0040c859 重挑来路（候选 = 邻接非 0、未封路、≠ 旧来路；有候选才 `rand()`）。
 */

import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { pickNextNode, reduce, type MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from './types.ts';
import { WatcomRng } from '../rng/watcom.ts';

/** 环：1 ⇄ 2 ⇄ 3 ⇄ 4 ⇄ 1；3 号是魔法屋 */
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2, 4] }),
    makeNode({ id: 2, adjacent: [3, 1] }),
    makeNode({ id: 3, adjacent: [4, 2], specialKind: SPECIAL_KIND.MAGIC_HOUSE }),
    makeNode({ id: 4, adjacent: [1, 3] }),
  ],
};

/** 0 号站在 2 号格、从 1 号来（往 3 号走）；1 号（施法者）站在魔法屋 */
function table(whoPlays1: number): GameState {
  return makeGameState({
    currentPlayer: 1,
    phase: 'turnEnd',
    players: [
      makePlayer({ index: 0, character: 0, nodeId: 2, lastNodeId: 1, direction: 3, whoPlays: WHO_PLAYS_HUMAN, cash: 5000 }),
      makePlayer({ index: 1, character: 1, nodeId: 3, lastNodeId: 2, direction: 3, whoPlays: whoPlays1, cash: 100 }),
    ],
  });
}

describe('★★ 魔法屋「向後轉」= `0x40c78c`：掉头 **并重挑来路**', () => {
  it('★★ 真人点「向後轉」，名单 [0] ⇒ 朝向 +4、来路改成另一头（3 号）；下一步往 1 号走', () => {
    const s: GameState = { ...table(WHO_PLAYS_HUMAN), pending: { kind: 'magicHouse', criterion: 0, targets: [0] } };
    const r = reduce(s, { type: 'magicHouse', option: 7 }, topo);
    expect(r.players[0]!.direction).toBe(7);
    expect(r.players[0]!.lastNodeId).toBe(3);
    // 走子避开来路 ⇒ 真的掉头了
    const rng = new WatcomRng();
    rng.setState(r.rngState);
    expect(pickNextNode(topo, 2, r.players[0]!.lastNodeId, rng)).toBe(1);
    // 只有一个候选也要掷一次 rand()（0x0040c834 在 `test ebx,ebx / je` 之后）⇒ 随机流前进
    expect(r.rngState).not.toBe(s.rngState);
  });

  it('★ 闸没过（住院中）⇒ 一个字节不动', () => {
    const base = table(WHO_PLAYS_HUMAN);
    const players = base.players.map((p, i) => (i === 0 ? { ...p, blocking: { ...p.blocking, inHospital: 2 } } : p));
    const s: GameState = { ...base, players, pending: { kind: 'magicHouse', criterion: 0, targets: [0] } };
    const r = reduce(s, { type: 'magicHouse', option: 7 }, topo);
    expect(r.players[0]!.lastNodeId).toBe(1);
    expect(r.players[0]!.direction).toBe(3);
  });

  it('★★ 电脑那一支（两个转盘都 rand()）转到「向後轉」时同样重挑来路', () => {
    let hit = 0;
    for (let seed = 1; seed < 4000 && hit < 3; seed++) {
      const s: GameState = { ...table(WHO_PLAYS_COMPUTER), phase: 'settling', rngState: seed };
      const r = reduce(s, { type: 'settle' }, topo);
      const ev = r.lastEvent;
      if (ev?.kind !== 'magicHouse' || ev.id !== 7) continue;
      for (const who of ev.targets ?? []) {
        const before = s.players[who]!;
        const after = r.players[who]!;
        expect(after.direction).toBe((before.direction + 4) & 7);
        // 另一头 = 邻接里不等于旧来路的那一格
        const other = topo.nodes[before.nodeId - 1]!.adjacent.find((n) => n !== before.lastNodeId);
        expect(after.lastNodeId, `seed ${seed} 玩家 ${who}`).toBe(other);
        hit++;
      }
    }
    expect(hit).toBeGreaterThan(0);
  });
});

describe('★★ 轉向卡（6）走同一个 `0x40c78c`（0x00443025）：reducer 路径同样重挑来路', () => {
  it('★ 1 号对 0 号出轉向卡 ⇒ 朝向 +4、来路换到另一头（3 号），随机流前进；卡扣掉', () => {
    const t = table(WHO_PLAYS_HUMAN);
    const s: GameState = {
      ...t,
      phase: 'awaitingRoll',
      players: t.players.map((p, i) => (i === 1 ? { ...p, cards: [6] } : p)),
    };
    const r = reduce(s, { type: 'useCard', cardId: 6, target: { kind: 'player', index: 0 } }, topo);
    expect(r.players[0]!.direction).toBe(7);
    expect(r.players[0]!.lastNodeId).toBe(3);
    expect(r.players[1]!.cards).toEqual([]);
    expect(r.rngState).not.toBe(s.rngState);
    const rng = new WatcomRng();
    rng.setState(r.rngState);
    expect(pickNextNode(topo, 2, r.players[0]!.lastNodeId, rng)).toBe(1);
  });

  it('★ 对自己出（anyPlayer 组可对自己）：同样掉头 + 重挑来路', () => {
    const t = table(WHO_PLAYS_HUMAN);
    const s: GameState = {
      ...t,
      phase: 'awaitingRoll',
      players: t.players.map((p, i) => (i === 1 ? { ...p, cards: [6] } : p)),
    };
    const r = reduce(s, { type: 'useCard', cardId: 6, target: { kind: 'player', index: 1 } }, topo);
    expect(r.players[1]!.direction).toBe(7);
    // 1 号站在 3 号格、从 2 号来 ⇒ 另一头 = 4 号
    expect(r.players[1]!.lastNodeId).toBe(4);
  });
});
