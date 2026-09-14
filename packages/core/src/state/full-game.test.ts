/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * M2 验收：4 人完整跑完一局至破产结算
 *
 * ★ 这里**不做任何加速处理**。先前版本曾把物价指数预先抬高来催熟经济，
 *   那是错的：地价同样按物价指数缩放，抬高后反而没人买得起地
 *   （实测 owned=0，钱全流进公库）。真正的缺口是
 *   `updatePriceIndex` 根本没被 reduce 调用，以及**出局者的回合无人推进**
 *   ——两者都已修好，对局能自己跑到分出胜负。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { isAlive } from './types.ts';
import { gameOverCode, isGameOver, reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

interface Played {
  state: GameState;
  turns: number;
  steps: number;
  ended: boolean;
  /** 第 n 个出局者出现在第几回合 */
  deaths: number[];
}

/**
 * 四人电脑对局，一路跑到分出胜负或用光回合预算。
 *
 * ⚠️ 回合预算从 4000 提到 8000，是因为 **AI 开始会出牌了**：
 *   均富卡把现金拉平、停留/烏龜卡拖住领先者，都是**反淘汰**的机制，
 *   对局因此明显变长（种子 2024 从 2123 回合变成 6660）。
 *   这是规则本来的样子，不是卡死——长跑验证过 20000 回合内
 *   种子 2024 与 31337 都能分出胜负。
 */
function playFullGame(seed: number, maxTurns = 8000): Played {
  const map = loadMap();
  const topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
  };
  let state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed,
  });

  const deaths: number[] = [];
  let steps = 0;
  for (; steps < 2_000_000; steps++) {
    if (isGameOver(state)) break;
    const a = decideAction({ state, map });
    if (a === null) throw new Error(`无人可动：phase=${state.phase} 当前玩家=${state.currentPlayer}`);
    const next = reduce(state, a, topo);
    if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
    const dead = next.players.filter((p) => !isAlive(p)).length;
    while (deaths.length < dead) deaths.push(next.turnCount);
    state = next;
    if (state.turnCount >= maxTurns) break;
  }
  return { state, turns: state.turnCount, steps, ended: isGameOver(state), deaths };
}

describe('★ M2 验收：完整一局', () => {
  run('★ 能一路跑到有人破产出局', () => {
    const r = playFullGame(2024);
    expect(r.deaths.length, `跑了 ${r.turns} 回合仍无人出局`).toBeGreaterThan(0);
  });

  run('★ 能跑到对局结束并给出终局码', () => {
    const r = playFullGame(2024);
    expect(r.ended, `跑了 ${r.turns} 回合仍未分出胜负`).toBe(true);
    expect(gameOverCode(r.state)).toBeGreaterThan(0);
    expect(r.state.players.filter((p) => isAlive(p)).length).toBe(1);
  });

  run('★ 出局是渐次发生的，不是一次团灭', () => {
    const r = playFullGame(2024);
    expect(r.deaths.length).toBe(3);
    // 三个人在不同回合出局——若同一回合全死，多半是结算逻辑串了
    expect(new Set(r.deaths).size).toBe(3);
    // 间隔要拉得开：均富卡这类反淘汰机制会把差距一次次抹平
    expect(r.deaths[1]! - r.deaths[0]!).toBeGreaterThan(100);
  });

  run('⚠️ AI 暂时用不上道具 —— 卡在两处缺口上，不是 AI 的问题', () => {
    // 这条**故意断言「用不上」**，把两处缺口钉住，等任一处补上就会失败提醒：
    //   1. 开局只发 機器娃娃/路障/地雷/定時炸彈（1..4），**没有交通工具**；
    //      車子要去百貨/道具店买，而那两处还没实现 → AI 的换车逻辑永远不触发
    //   2. 放置类道具放下去之后**没有任何东西会踩到它**——物件落点效果
    //      尚未实现（见 known-deviations 的 Q-OBJ-1），放了等于没放，
    //      所以 AI 也不该去放
    const map = loadMap();
    const topo = {
      nodes: map.nodes,
      lands: map.lands,
      facilities: map.facilities,
      commercials: map.commercials,
    };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 2024,
    });
    let used = 0;
    for (let i = 0; i < 200_000 && state.turnCount < 2000; i++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      if (a.type === 'useTool') used++;
      const next = reduce(state, a, topo);
      if (next === state) break;
      state = next;
    }
    expect(used, '道具能用了？那就把这条测试连同上面的注释一起更新').toBe(0);
  });

  run('★ AI 真的会出牌 —— 卡片系统不再是死代码', () => {
    const map = loadMap();
    const topo = {
      nodes: map.nodes,
      lands: map.lands,
      facilities: map.facilities,
      commercials: map.commercials,
    };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 2024,
    });
    let played = 0;
    for (let i = 0; i < 200_000 && state.turnCount < 2000; i++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      if (a.type === 'useCard') played++;
      const next = reduce(state, a, topo);
      if (next === state) break;
      state = next;
    }
    expect(played, '两千回合里一张牌都没出过').toBeGreaterThan(0);
  });

  run('★ 换个种子至少也能把人打出局', () => {
    // ⚠️ 不是每个种子都能在 4000 回合内分出胜负，这**不是卡死**：
    //   接入日期推进后银行月息（无贷款则每月 ×1.1）开始生效，
    //   而当前 AI 只会买地、从不动用存款，于是人人躺在存款上滚雪球，
    //   谁也打不死谁。那是 AI 的问题（M3），不是规则的问题。
    //   这里只要求局面确实在推进：有人出局。
    let withDeaths = 0;
    for (const seed of [1, 42, 31337]) {
      if (playFullGame(seed, 4000).deaths.length > 0) withDeaths++;
    }
    expect(withDeaths).toBeGreaterThan(0);
  });

  run('★ 出局者的钱被清空、赢家仍有资产', () => {
    const r = playFullGame(2024);
    const alive = r.state.players.filter((p) => isAlive(p));
    for (const p of r.state.players) {
      if (isAlive(p)) continue;
      expect(p.cash).toBe(0);
      expect(p.moneyInBank).toBe(0);
    }
    expect(alive[0]!.cash + alive[0]!.moneyInBank).toBeGreaterThan(0);
  });

  run('★ 出局者不再持有地块 —— 但压哨那一位除外', () => {
    // ★ 原版的破产清算（变卖手牌/道具、释放地产）只在**非终局**路径上执行；
    //   最后一个破产的人直接进终局，地产原样留在他名下。
    //   见 rules/bankruptcy.ts 的 resolveBankruptcyOutcome 与
    //   state/reduce.ts 的 applyBankruptcy。
    const r = playFullGame(2024);
    const stillOwning = r.state.players.filter(
      (p) => !isAlive(p) && r.state.landOwner.includes(p.index + 1),
    );
    expect(stillOwning.length).toBeLessThanOrEqual(1);
  });

  run('★ 整局可完整复现', () => {
    const a = playFullGame(2024);
    const b = playFullGame(2024);
    expect(a.turns).toBe(b.turns);
    expect(a.steps).toBe(b.steps);
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(a.state.landOwner).toEqual(b.state.landOwner);
    expect(a.state.players.map((p) => [p.cash, p.moneyInBank, p.whoPlays])).toEqual(
      b.state.players.map((p) => [p.cash, p.moneyInBank, p.whoPlays]),
    );
  });

  run('未分胜负的种子也不会卡死或抛错', () => {
    // 种子 7 下四人长期僵持——这本身合法，只要引擎一直能推进
    const r = playFullGame(7, 2000);
    expect(r.turns).toBe(2000);
    expect(r.state.players.filter((p) => isAlive(p)).length).toBeGreaterThan(1);
  });

  run('★ 日期随回合推进，月结与开奖都真的跑到了', () => {
    const r = playFullGame(2024);
    // 一回合一天，两千多回合必然跨了好几年
    expect(r.state.year).toBeGreaterThan(1998);
    // 股市也在跟着走 —— 价格离开了初始值
    const moved = r.state.market.stocks.filter((s) => s.price !== s.basePrice).length;
    expect(moved).toBeGreaterThan(0);
  });
});
