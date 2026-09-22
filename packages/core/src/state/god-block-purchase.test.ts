/*
 * 衰神/死神拦下消费 —— 框**要弹**，答了 YES 才被拦并弹「%s顯靈 拘資失敗！」（第八份试玩回报 #10）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source 五处消费点的次序都是「现金 → 確認框 → `call 0x40fa61` → 消费」：
 *   買地 `0x0041a0ab call 0x440ba8 → 0x0041a0c7 call 0x40fa61`、加蓋 `0x00419996 → 0x004199ae`、
 *   買設施 `0x0041a8ec → 0x0041a908`、設施加蓋 `0x0041a31e → 0x0041a336`；
 *   `fcn_0040fa61` 弹 `0x463514`（1500 ms）后返回 1 ⇒ 放弃。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

function setup() {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
  const state = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) })), seed: 7 });
  const landNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'land')!;
  const facNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'facility')!;
  return { state, topo, landNode, facNode };
}

function standing(state: GameState, nodeId: number, godInfo: number): GameState {
  return {
    ...state,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: state.players.map((p, i) => (i === 0 ? { ...p, nodeId, godInfo, cash: 500_000 } : p)),
  };
}

describe('★ 衰神附身踩到空地', () => {
  for (const [god, name] of [[7, '小衰神'], [8, '大衰神'], [15, '死神']] as const) {
    run(`${name}：買地框照弹；点「買下」⇒ 交互收掉、回合结束、弹「${name}顯靈 拘資失敗！」、钱没动、地没买`, () => {
      const { state, topo, landNode } = setup();
      const s0 = standing(state, landNode.id, god);
      const asked = reduce(s0, { type: 'settle' }, topo);
      expect(asked.phase).toBe('awaitingDecision');
      expect(asked.pending?.kind).toBe('buyLand');

      const after = reduce(asked, { type: 'buyLand' }, topo);
      expect(after.pending).toBeNull();
      expect(after.phase).toBe('turnEnd');
      expect(after.notices).toEqual([{ key: 'god.blockPurchase', args: [name], holdMs: 1500 }]);
      expect(after.players[0]!.cash).toBe(500_000);
      expect(after.landOwner[(landNode.ref as { index: number }).index]).toBe(0);
    });
  }

  run('没被附身 ⇒ 照常买到（护栏）', () => {
    const { state, topo, landNode } = setup();
    const asked = reduce(standing(state, landNode.id, 0), { type: 'settle' }, topo);
    const after = reduce(asked, { type: 'buyLand' }, topo);
    expect(after.landOwner[(landNode.ref as { index: number }).index]).toBe(1);
    expect(after.notices).toEqual([]);
  });

  run('土地公（12）仍是**落点就不问**（`0x0041a027 cmp [+0x3f],0xc / je` 在框之前）', () => {
    const { state, topo, landNode } = setup();
    const after = reduce(standing(state, landNode.id, 12), { type: 'settle' }, topo);
    expect(after.pending?.kind).not.toBe('buyLand');
  });

  run('設施：買設施框照弹；点了才被拦', () => {
    const { state, topo, facNode } = setup();
    const asked = reduce(standing(state, facNode.id, 7), { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buyFacility');
    const after = reduce(asked, { type: 'buyFacility' }, topo);
    expect(after.pending).toBeNull();
    expect(after.notices).toEqual([{ key: 'god.blockPurchase', args: ['小衰神'], holdMs: 1500 }]);
    expect(after.players[0]!.cash).toBe(500_000);
  });
});
