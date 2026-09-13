/*
 * 完整对局推演 —— 在真实地图上跑通「掷骰→走子→买地→盖房→收租」闭环
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { reduce, nextCandidates, effectiveLand, landIndexAtPlayer } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState, Player } from './types.ts';
import { makePlayer as basePlayer } from '../testing/factories.ts';

/** 本文件的简写：第一参为下标 */
const makePlayer = (index: number, over: Partial<Player> = {}): Player =>
  basePlayer({ index, character: index, cash: 500_000, moneyInBank: 0, ...over });
import { parseMap } from '../loaders/map.ts';
import { calculateLandToll } from '../rules/toll.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const d = existsSync(MAP0) ? describe : describe.skip;


function makeState(over: Partial<GameState> = {}): GameState {
  return {
    mode: 'single', rngState: 1, globalMapId: 0,
    day: 1, month: 1, year: 1998,
    players: [makePlayer(0), makePlayer(1), makePlayer(2), makePlayer(3)],
    currentPlayer: 0, phase: 'turnStart', priceIndex: 1,
    dice: [], stepsRemaining: 0, stepsTotal: 0,
    cardAmount: new Array<number>(30).fill(0),
    landOwner: [], landLevel: [], turnCount: 0,
    ...over,
  };
}

function topology(): MapTopology {
  const map = parseMap(new Uint8Array(readFileSync(MAP0)));
  return { nodes: map.nodes, lands: map.lands };
}

/** 推进一个完整回合。decide 决定落点上要不要买/建 */
function playTurn(
  s: GameState,
  topo: MapTopology,
  decide: (st: GameState) => 'buyLand' | 'upgradeLand' | 'declineDecision',
): GameState {
  s = reduce(s, { type: 'startTurn' }, topo);
  if (s.phase === 'awaitingRoll') s = reduce(s, { type: 'rollDice' }, topo);

  let guard = 0;
  while (s.phase === 'moving' || s.phase === 'awaitingDirection') {
    if (s.phase === 'awaitingDirection') {
      const p = s.players[s.currentPlayer]!;
      const options = nextCandidates(topo, p.nodeId, p.lastNodeId);
      s = reduce(s, { type: 'chooseDirection', nodeId: options[0]! }, topo);
    } else {
      s = reduce(s, { type: 'step' }, topo);
    }
    if (++guard > 100) throw new Error('移动未收敛');
  }
  if (s.phase === 'settling') s = reduce(s, { type: 'settle' }, topo);
  if (s.phase === 'awaitingDecision') s = reduce(s, { type: decide(s) }, topo);
  return reduce(s, { type: 'endTurn' }, topo);
}

const totalCash = (s: GameState): number =>
  s.players.reduce((sum, p) => sum + p.cash, 0);

d('完整对局推演', () => {
  it('买地：现金减少、归属转移', () => {
    const topo = topology();
    let s = makeState({ phase: 'settling' });
    // 把玩家放到一块住宅地上
    const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
    s.players[0] = makePlayer(0, { nodeId: landNode.id });

    const idx = landIndexAtPlayer(s, topo)!;
    const land = effectiveLand(s, topo, idx)!;
    const before = s.players[0]!.cash;

    s = reduce(s, { type: 'settle' }, topo);
    expect(s.phase).toBe('awaitingDecision');
    s = reduce(s, { type: 'buyLand' }, topo);

    expect(s.landOwner[idx]).toBe(1); // 玩家0 → owner 1
    expect(s.players[0]!.cash).toBe(before - land.landPrice); // level 0，买价 = 地价
    expect(s.phase).toBe('turnEnd');
  });

  it('盖房：等级 +1，现金减少房价', () => {
    const topo = topology();
    let s = makeState({ phase: 'settling' });
    const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
    s.players[0] = makePlayer(0, { nodeId: landNode.id });
    const idx = landIndexAtPlayer(s, topo)!;
    s.landOwner = [];
    s.landOwner[idx] = 1; // 已归玩家0
    s.landLevel = [];
    s.landLevel[idx] = 0;

    const land = effectiveLand(s, topo, idx)!;
    const before = s.players[0]!.cash;

    s = reduce(s, { type: 'settle' }, topo);
    expect(s.phase).toBe('awaitingDecision');
    s = reduce(s, { type: 'upgradeLand' }, topo);

    expect(s.landLevel[idx]).toBe(1);
    expect(s.players[0]!.cash).toBe(before - land.housePrice);
  });

  it('★ 踩到他人地产：付过路费，金额与公式一致', () => {
    const topo = topology();
    let s = makeState({ phase: 'settling', priceIndex: 3 });
    const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
    s.players[0] = makePlayer(0, { nodeId: landNode.id });
    const idx = landIndexAtPlayer(s, topo)!;
    s.landOwner = [];
    s.landOwner[idx] = 2; // 归玩家1
    s.landLevel = [];
    s.landLevel[idx] = 3;

    const land = effectiveLand(s, topo, idx)!;
    const allLands = topo.lands!.map((l) => ({
      ...l,
      owner: s.landOwner[l.id] ?? l.owner,
      level: s.landLevel[l.id] ?? l.level,
    }));
    const expected = calculateLandToll(allLands, 2, 3, land.name);
    expect(expected).toBeGreaterThan(0);

    const cash0 = s.players[0]!.cash;
    const cash1 = s.players[1]!.cash;
    const bank1 = s.players[1]!.moneyInBank;
    s = reduce(s, { type: 'settle' }, topo);

    // ★ 付款方从**现金**出
    expect(s.players[0]!.cash).toBe(cash0 - expected);
    // ★ 地主收进**银行存款**，不是现金（pay_money flags = 0）
    expect(s.players[1]!.cash).toBe(cash1);
    expect(s.players[1]!.moneyInBank).toBe(bank1 + expected);
    expect(s.phase).toBe('turnEnd');
  });

  it('★ 过路费是零和的：总**净值**守恒（现金不守恒——收款进存款）', () => {
    const topo = topology();
    let s = makeState({ phase: 'settling' });
    const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
    s.players[0] = makePlayer(0, { nodeId: landNode.id });
    const idx = landIndexAtPlayer(s, topo)!;
    s.landOwner = [];
    s.landOwner[idx] = 3; // 归玩家2
    s.landLevel = [];
    s.landLevel[idx] = 5;

    const netWorth = (g: typeof s) =>
      g.players.reduce((t, p) => t + p.cash + p.moneyInBank, 0);

    const beforeCash = totalCash(s);
    const beforeNet = netWorth(s);
    s = reduce(s, { type: 'settle' }, topo);

    // ★ 净值守恒
    expect(netWorth(s)).toBe(beforeNet);
    // ★ 但现金**减少**了：付款方从现金出，地主收进存款
    expect(totalCash(s)).toBeLessThan(beforeCash);
  });

  it('★ 地主有同盟时，租金按两份合计收取并分账', () => {
    const topo = topology();
    const setup = (allied: boolean) => {
      const s = makeState({ phase: 'settling' });
      const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
      s.players[0] = makePlayer(0, { nodeId: landNode.id });
      // 玩家1 与玩家2 结盟（allied_player 存的是下标 + 1）
      s.players[1] = makePlayer(1, { alliedPlayer: allied ? 3 : 0, moneyInBank: 0 });
      s.players[2] = makePlayer(2, { alliedPlayer: allied ? 2 : 0, moneyInBank: 0 });
      const idx = landIndexAtPlayer(s, topo)!;
      s.landOwner = [];
      s.landLevel = [];
      // 同名地块群里，一块归地主、一块归其同盟
      for (const l of topo.lands!) {
        if (l.name === topo.lands!.find((x) => x.id === idx)!.name) {
          s.landOwner[l.id] = l.id === idx ? 2 : 3;
          s.landLevel[l.id] = 3;
        }
      }
      return reduce(s, { type: 'settle' }, topo);
    };

    const solo = setup(false);
    const allied = setup(true);

    const paidSolo = 500_000 - solo.players[0]!.cash;
    const paidAllied = 500_000 - allied.players[0]!.cash;

    // ★ 结盟后付款方要付得更多（盟友的同名地块并入收租）
    expect(paidAllied).toBeGreaterThan(paidSolo);
    // ★ 两人分账，各自都收到钱
    expect(allied.players[1]!.moneyInBank).toBeGreaterThan(0);
    expect(allied.players[2]!.moneyInBank).toBeGreaterThan(0);
    // ★ 分账之和等于付款方付出的总额
    expect(allied.players[1]!.moneyInBank + allied.players[2]!.moneyInBank)
      .toBe(paidAllied);
  });

  it('买地后再踩上去不再付费（变成自己的）', () => {
    const topo = topology();
    let s = makeState({ phase: 'settling' });
    const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
    s.players[0] = makePlayer(0, { nodeId: landNode.id });

    s = reduce(s, { type: 'settle' }, topo);
    s = reduce(s, { type: 'buyLand' }, topo);
    const afterBuy = s.players[0]!.cash;

    // 再次落在同一格
    s = { ...s, phase: 'settling' };
    s = reduce(s, { type: 'settle' }, topo);
    // 自有地 → 进入盖房决策而非付费
    expect(s.phase).toBe('awaitingDecision');
    s = reduce(s, { type: 'declineDecision' }, topo);
    expect(s.players[0]!.cash).toBe(afterBuy); // 放弃则不花钱
  });

  it('放弃买地则归属不变', () => {
    const topo = topology();
    let s = makeState({ phase: 'settling' });
    const landNode = topo.nodes.find((n) => n.ref.kind === 'land')!;
    s.players[0] = makePlayer(0, { nodeId: landNode.id });
    const idx = landIndexAtPlayer(s, topo)!;
    const before = s.players[0]!.cash;

    s = reduce(s, { type: 'settle' }, topo);
    s = reduce(s, { type: 'declineDecision' }, topo);
    expect(s.landOwner[idx]).toBeUndefined();
    expect(s.players[0]!.cash).toBe(before);
  });

  it('★ 200 回合激进买地对局：不崩溃，地产被真实买走', () => {
    const topo = topology();
    let s = makeState();
    s = reduce(s, { type: 'reseed', seed: 0xc0ffee }, topo);

    for (let i = 0; i < 200; i++) {
      s = playTurn(s, topo, (st) => {
        // 有地就买，自有地就升级
        const idx = landIndexAtPlayer(st, topo);
        if (idx === null) return 'declineDecision';
        const land = effectiveLand(st, topo, idx);
        if (land === null) return 'declineDecision';
        return land.owner === 0 ? 'buyLand' : 'upgradeLand';
      });
    }

    const owned = s.landOwner.filter((o) => o !== undefined && o > 0).length;
    const upgraded = s.landLevel.filter((l) => l !== undefined && l > 0).length;
    expect(owned).toBeGreaterThan(5);
    expect(upgraded).toBeGreaterThan(0);
    expect(s.turnCount).toBe(200);

    // 所有玩家现金仍是有限整数
    for (const p of s.players) {
      expect(Number.isInteger(p.cash)).toBe(true);
      expect(Number.isFinite(p.cash)).toBe(true);
    }
  });

  it('★ 全对局仍满足确定性：同种子同决策重放结果相同', () => {
    const topo = topology();
    const run = (): GameState => {
      let s = makeState();
      s = reduce(s, { type: 'reseed', seed: 0x1357 }, topo);
      for (let i = 0; i < 100; i++) {
        s = playTurn(s, topo, (st) => {
          const idx = landIndexAtPlayer(st, topo);
          if (idx === null) return 'declineDecision';
          const land = effectiveLand(st, topo, idx);
          return land !== null && land.owner === 0 ? 'buyLand' : 'declineDecision';
        });
      }
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
