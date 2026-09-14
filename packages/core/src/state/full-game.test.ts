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
 * ⚠️ 回合预算一路从 4000 提到 8000 再到 12000，两次都是**规则变全**的代价：
 *   - 4000 → 8000：AI 开始会出牌，均富卡拉平现金、停留/烏龜卡拖住领先者，
 *     全是**反淘汰**机制（种子 2024 从 2123 回合变成 6660）。
 *   - 8000 → 12000：地图上开始有**神明**了。小衰神/大衰神/死神附身期间
 *     一切消费被拦（`purchaseBlockedBy`），土地公挡买无主地——买地节奏
 *     被按住，租金起得更慢（种子 2024 变成 8649）。
 *   - 12000 → 16000：过路费的九种免收（地主被关着/同盟/死神…）、免費卡/嫁禍卡自动使用、
 *     死神顯靈由他人賠償接上后（T-082），破产更难；种子 2024 于 12083 回合分出胜负。
 *   这都是规则本来的样子，不是卡死：长跑实测种子 2024 于 8649 回合、
 *   31337 于 27702 回合分出胜负，且终局时物件表守恒（6 个神明仍在场，
 *   禮物与寶箱一次性消耗掉——与原版 `i < 12` 才有搭档一致）。
 */
function playFullGame(seed: number, maxTurns = 16000): Played {
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
    // ⚠️ 先前这里要求头两个出局者相隔 100 回合以上。AI 接上**借贷**
    //   （角色表的 f24，见 ai/personality.ts）之后经济快了一个数量级：
    //   种子 2024 从 8649 回合缩到 1450，三人分别倒在 1379/1389/1450。
    //   十回合内连倒两个不是 bug，是借钱买地、一笔大租金同时压垮两家。
    //   真正要守的是「不是同一回合团灭」，上面那条断言已经守住了。
    expect(r.deaths[1]! - r.deaths[0]!).toBeGreaterThan(0);
  });

  run('★ AI 真的会用道具 —— 百貨公司一通，道具经济就活了', () => {
    // 这条先前是反向断言（「一个都没用」），因为当时卡在两处：
    //   开局不发交通工具，而車子要去百貨公司买——那时百貨还没实现。
    // 现在百貨接上了，AI 会用點數买汽車再换乘，道具终于被用起来。
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
    let bought = 0;
    for (let i = 0; i < 200_000 && state.turnCount < 2000; i++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      if (a.type === 'useTool') used++;
      if (a.type === 'shop') bought++;
      const next = reduce(state, a, topo);
      if (next === state) break;
      state = next;
    }
    expect(bought, '两千回合里一次都没在百貨公司买过东西').toBeGreaterThan(0);
    expect(used, '买了道具却一个也没用').toBeGreaterThan(0);
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
    // 种子 7 在早先的规则集下四人长期僵持；規則补全（設施可买可蓋、四大惡人、
    // 休市/漲跌停…）之后它在约 760 回合就分出了胜负。两种结局都合法——
    // 这条测的是「引擎一直能推进、不抛错」，不是某个种子的命运。
    const r = playFullGame(7, 2000);
    expect(r.turns).toBeLessThanOrEqual(2000);
    const alive = r.state.players.filter((p) => isAlive(p)).length;
    if (r.ended) {
      expect(alive).toBeLessThanOrEqual(1);
    } else {
      expect(r.turns).toBe(2000);
      expect(alive).toBeGreaterThan(1);
    }
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
