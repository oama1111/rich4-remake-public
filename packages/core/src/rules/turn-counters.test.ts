/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 回合边界的后半段计数：冬眠／梦游／停留／龜行／銀行拒貸／同盟 @source 0x0041caf4..0x0041cc48
 */
import { describe, expect, it } from 'vitest';
import { RELEASE_PENDING, tickTurnCounters } from './blocking.ts';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import { reduce } from '../state/reduce.ts';
import { toolCount } from './tools.ts';
import { TRAFFIC_CAR, TRAFFIC_MOTORCYCLE, TRAFFIC_WALK } from './tool-effects.ts';

const topo = { nodes: [] };

describe('★ tickTurnCounters（纯函数）', () => {
  it('六项各减一天，减到 0 挂 0x80，下一天清零并报告释放', () => {
    const p = makePlayer({
      blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 2, sleepWalking: 1, stopping: 3, tortoiseWalking: 1 },
      daysRejectedByBank: 1,
      alliedPlayer: 2,
      alliedDays: 2,
    });
    const t1 = tickTurnCounters(p);
    expect(t1.player.blocking).toMatchObject({ sleeping: 1, sleepWalking: RELEASE_PENDING, stopping: 2, tortoiseWalking: RELEASE_PENDING });
    expect(t1.player.daysRejectedByBank).toBe(RELEASE_PENDING);
    expect(t1.player.alliedDays).toBe(1);
    expect(t1).toMatchObject({ wakeFromSleepwalk: false, allianceExpired: false, alliedTick: true });
    const t2 = tickTurnCounters(t1.player);
    expect(t2.player.blocking).toMatchObject({ sleeping: RELEASE_PENDING, sleepWalking: 0, stopping: 1, tortoiseWalking: 0 });
    expect(t2.player.daysRejectedByBank).toBe(0);
    expect(t2.player.alliedDays).toBe(RELEASE_PENDING);
    expect(t2.wakeFromSleepwalk).toBe(true);
    const t3 = tickTurnCounters(t2.player);
    expect(t3.allianceExpired).toBe(true);
    expect(t3.alliedTick).toBe(false);
  });

  it('★ 住宿/消失/监狱/医院期间，冬眠与梦游不走天（0x0041caf7），其余照走', () => {
    const p = makePlayer({
      blocking: { inHotel: 0, disappearing: 0, inPrison: 3, inHospital: 0, sleeping: 2, sleepWalking: 2, stopping: 2, tortoiseWalking: 0 },
    });
    const t = tickTurnCounters(p);
    expect(t.player.blocking).toMatchObject({ sleeping: 2, sleepWalking: 2, stopping: 1 });
  });
});

describe('★ 接到 endTurn', () => {
  function game(over: Parameters<typeof makePlayer>[0]) {
    // ★★ 第 84 条订正：`endTurn` 里那一天是给**新**当前玩家走的
    //   （原版 `0x418f95` 先 ++ 游标、`0x419039` 才递减）⇒ 让 0 号当"下一位"：
    //   当前玩家设成 1 号，`nextAlivePlayer` 绕回 0 号。
    return makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, ...(i === 0 ? over : {}) })),
      phase: 'turnEnd',
      currentPlayer: 1,
    });
  }

  it('梦游到期醒来：道具栏里还有那辆就拿回来（道具 −1），骰子数恢复', () => {
    const s = game({
      blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: RELEASE_PENDING, stopping: 0, tortoiseWalking: 0 },
      trafficMethod: TRAFFIC_WALK,
      ndices: 1,
      savedTrafficMethod: TRAFFIC_MOTORCYCLE,
      savedNdices: 2,
    });
    const tools = [...s.tools];
    tools[0 * 15 + 5] = 1; // 一辆機車
    const after = reduce({ ...s, tools }, { type: 'endTurn' }, topo);
    expect(after.players[0]).toMatchObject({ trafficMethod: TRAFFIC_MOTORCYCLE, ndices: 2, savedTrafficMethod: 0 });
    expect(after.players[0]!.blocking.sleepWalking).toBe(0);
    expect(toolCount(after.tools, 0, 5)).toBe(0);
  });

  it('梦游到期但车已不在道具栏：步行、骰子 1（0x0041ca60）', () => {
    const s = game({
      blocking: { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: RELEASE_PENDING, stopping: 0, tortoiseWalking: 0 },
      savedTrafficMethod: TRAFFIC_CAR,
      savedNdices: 3,
    });
    const after = reduce(s, { type: 'endTurn' }, topo);
    expect(after.players[0]).toMatchObject({ trafficMethod: TRAFFIC_WALK, ndices: 1 });
  });

  it('★ 同盟每日双方敌意各 −20×物價；到期双方解除（0x40cc1a）', () => {
    const s0 = game({ alliedPlayer: 2, alliedDays: 1, hostility: [0, 100, 0, 0] });
    const s = { ...s0, priceIndex: 2, players: s0.players.map((p, i) => (i === 1 ? { ...p, alliedPlayer: 1, alliedDays: 1, hostility: [100, 0, 0, 0] } : p)) };
    const day1 = reduce(s, { type: 'endTurn' }, topo);
    expect(day1.players[0]!.hostility[1]).toBe(60);
    expect(day1.players[1]!.hostility[0]).toBe(60);
    expect(day1.players[0]!.alliedDays).toBe(RELEASE_PENDING);
    // 下一次轮到 0 号的回合边界：解除
    // ★ 第 84 条订正：`endTurn` 递减的是**下一位**，所以这里把当前玩家设成 1 号，
    //   绕回之后 0 号才是"即将行动的这位"（原版 `0x418f95` → `0x419039`）
    const back = { ...day1, currentPlayer: 1, phase: 'turnEnd' as const };
    const day2 = reduce(back, { type: 'endTurn' }, topo);
    expect(day2.players[0]).toMatchObject({ alliedPlayer: 0, alliedDays: 0 });
    expect(day2.players[1]).toMatchObject({ alliedPlayer: 0, alliedDays: 0 });
  });
});
