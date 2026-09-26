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
import { WHO_PLAYS_COMPUTER, type GameState } from './types.ts';
import { decideAction } from '../ai/policy.ts';

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

/**
 * ★ 第十九份试玩回报「小衰神显灵投资失败的弹窗没显示」—— 电脑附身衰神时那扇框也要弹。
 *
 * 根因：`ai/policy.ts` 的 `decideAtLanding` 以前先「预演 `purchase`，被衰神拦就直接放弃」，
 * 电脑于是永远不碰 `0x40fa61`，框自然弹不出来（回报里 P1 带小衰神三次踩空地，三次都静默放弃）。
 * @source 原版电脑两支都是**先照常决定、再过衰神闸**：
 *   買地 `0x0041a089 call 0x41d7d4`（想买 ⇒ edi=1）→ `0x0041a0b8 test edi,edi` → `0x0041a0c7 call 0x40fa61`；
 *   加蓋 `0x00419976 test byte [player+0x15],6 / jne 0x4199a7`（电脑不问）→ `0x004199ae call 0x40fa61`。
 */
describe('★ 电脑附身衰神/死神：照常出手、由闸弹框', () => {
  function computerStanding(state: GameState, nodeId: number, godInfo: number): GameState {
    const s = standing(state, nodeId, godInfo);
    return { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, whoPlays: WHO_PLAYS_COMPUTER } : p)) };
  }

  for (const [god, name] of [[7, '小衰神'], [8, '大衰神'], [15, '死神']] as const) {
    run(`${name}：电脑踩到空地 ⇒ 仍然决定「買」⇒ 弹「${name}顯靈 投資失敗！」、钱地不动、不卡死`, () => {
      const { state, topo, landNode } = setup();
      const map = parseMap(new Uint8Array(readFileSync(MAP)));
      const asked = reduce(computerStanding(state, landNode.id, god), { type: 'settle' }, topo);
      expect(asked.pending?.kind).toBe('buyLand');

      const act = decideAction({ state: asked, map });
      expect(act).toEqual({ type: 'buyLand' });
      const after = reduce(asked, act!, topo);
      expect(after.notices).toEqual([{ key: 'god.blockPurchase', args: [name], holdMs: 1500 }]);
      expect(after.pending).toBeNull();
      expect(after.phase).toBe('turnEnd');
      expect(after.players[0]!.cash).toBe(500_000);
      expect(after.landOwner[(landNode.ref as { index: number }).index]).toBe(0);
    });
  }

  run('小衰神：电脑踩到自己的地 ⇒ 加蓋照走（电脑不问）⇒ 同一扇框', () => {
    const { state, topo, landNode } = setup();
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const idx = (landNode.ref as { index: number }).index;
    const s0 = computerStanding(state, landNode.id, 7);
    const landOwner = [...s0.landOwner];
    landOwner[idx] = 1;
    const asked = reduce({ ...s0, landOwner }, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('upgradeLand');

    const act = decideAction({ state: asked, map });
    expect(act).toEqual({ type: 'upgradeLand' });
    const after = reduce(asked, act!, topo);
    expect(after.notices).toEqual([{ key: 'god.blockPurchase', args: ['小衰神'], holdMs: 1500 }]);
    expect(after.landLevel[idx]).toBe(0);
  });

  run('护栏：没被附身的电脑照常买到、不弹框', () => {
    const { state, topo, landNode } = setup();
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const asked = reduce(computerStanding(state, landNode.id, 0), { type: 'settle' }, topo);
    const after = reduce(asked, decideAction({ state: asked, map })!, topo);
    expect(after.landOwner[(landNode.ref as { index: number }).index]).toBe(1);
    expect(after.notices).toEqual([]);
  });
});
