/*
 * 時光機：把这一回合退回去重来
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { TOOL_TIME_MACHINE, restoreSnapshot, snapshotOnTurnStart } from './time-machine.ts';
import { UNIMPLEMENTED_TOOLS } from './tool-effects.ts';
import { emptyTools, giveTool, initialToolStock, toolCount } from './tools.ts';

const ring: MapTopology = {
  nodes: [1, 2, 3, 4].map((id) =>
    makeNode({
      id,
      adjacent: [id === 1 ? 4 : id - 1, id === 4 ? 1 : id + 1],
      adjacentSlots: [id === 1 ? 4 : id - 1, id === 4 ? 1 : id + 1, 0, 0],
    }),
  ),
};

function withTool(): ReturnType<typeof makeGameState> {
  const s = makeGameState({
    players: [0, 1, 2, 3].map((i) => makePlayer({ index: i })),
    landOwner: [],
    landLevel: [],
    phase: 'turnStart',
  });
  const stock = initialToolStock();
  const given = giveTool(emptyTools(4), stock, 0, TOOL_TIME_MACHINE);
  return { ...s, tools: given.tools, toolStock: given.stock };
}

describe('時光機', () => {
  it('不在「未实现」名单里了', () => {
    expect(UNIMPLEMENTED_TOOLS).not.toContain(TOOL_TIME_MACHINE);
    expect(UNIMPLEMENTED_TOOLS).toEqual([]);
  });

  it('★ 只给真人存快照 —— 电脑玩家用不了（@source 0x004480a0 test …,1）', () => {
    const human = withTool();
    expect(snapshotOnTurnStart(human).snapshots[0]).not.toBeNull();

    const ai = {
      ...human,
      players: human.players.map((p, i) => (i === 0 ? { ...p, whoPlays: WHO_PLAYS_COMPUTER } : p)),
    };
    expect(snapshotOnTurnStart(ai).snapshots[0]).toBeNull();
  });

  // ★★ 2026-09-24（provenance 审计）订正：快照**不在回合开头**拍，在**起步掷骰**那一刻（`0x0040dd53 call 0x44808a`）；
  //   另外被挡的回合（`0x0040c97c`）与傳送機搬自己（`0x004477c3`）也拍。先前这几条用例按「startTurn 拍」写。
  it('startTurn 不拍；起步掷骰那一刻拍（0x0040dd53）', () => {
    const s = reduce(withTool(), { type: 'startTurn' }, ring);
    expect(s.phase).toBe('awaitingRoll');
    expect(s.snapshots[0]).toBeNull();
    const rolled = reduce(s, { type: 'rollDice' }, ring);
    expect(rolled.snapshots[0]).toBeTypeOf('string');
    expect(JSON.parse(rolled.snapshots[0]!).phase).toBe('awaitingRoll');
  });

  it('★ 被挡的回合也拍（0x0040c97c）', () => {
    const base = withTool();
    const jailed = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, blocking: { ...p.blocking, inPrison: 2 } } : p)),
    };
    const s = reduce(jailed, { type: 'startTurn' }, ring);
    expect(s.phase).toBe('turnEnd');
    expect(s.snapshots[0]).toBeTypeOf('string');
  });

  it('★ 用掉之后回到上一次起步掷骰那一刻，而且道具被扣掉', () => {
    let s = reduce(withTool(), { type: 'startTurn' }, ring);
    const before = s.players[0]!.cash;
    s = reduce(s, { type: 'rollDice' }, ring);
    // 造点既成事实：花掉一笔钱、走到别的格子
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash - 50_000, nodeId: 3 } : p)),
      day: s.day + 5,
    };
    expect(toolCount(s.tools, 0, TOOL_TIME_MACHINE)).toBe(1);

    const back = reduce({ ...s, phase: 'awaitingRoll' }, { type: 'useTool', toolId: TOOL_TIME_MACHINE }, ring);
    expect(back.players[0]!.cash).toBe(before);
    expect(back.players[0]!.nodeId).toBe(1);
    expect(back.phase).toBe('awaitingRoll');
    expect(back.day).toBe(withTool().day);
    // ★ 道具要扣 —— 否则可以无限后悔
    expect(toolCount(back.tools, 0, TOOL_TIME_MACHINE)).toBe(0);
  });

  it('★ 没快照时不生效、也不消耗道具（@source test eax,eax / je）', () => {
    const s = { ...withTool(), phase: 'awaitingRoll' as const };
    expect(s.snapshots[0]).toBeNull();
    const after = reduce(s, { type: 'useTool', toolId: TOOL_TIME_MACHINE }, ring);
    expect(after).toBe(s); // 原样返回
    expect(toolCount(after.tools, 0, TOOL_TIME_MACHINE)).toBe(1);
  });

  it('★ PRNG 不回滚 —— 退回去重掷骰子，点数会不一样', () => {
    const s = reduce(withTool(), { type: 'startTurn' }, ring);
    const first = reduce(s, { type: 'rollDice' }, ring);
    // 掷过之后 rng 已经推进
    expect(first.rngState).not.toBe(s.rngState);
    const back = reduce({ ...first, phase: 'awaitingRoll' }, { type: 'useTool', toolId: TOOL_TIME_MACHINE }, ring);
    expect(back.rngState).toBe(first.rngState); // ★ 没有回滚
    // 快照是在起步掷骰**之前**那一刻拍的 ⇒ 退回去是「正要掷骰」
    expect(back.phase).toBe('awaitingRoll');
    const second = reduce(back, { type: 'rollDice' }, ring);
    expect(second.dice).not.toEqual(first.dice);
  });

  it('★ 快照本身不回滚 —— 否则「用掉一个時光機」这件事也会被撤销', () => {
    let s = reduce(reduce(withTool(), { type: 'startTurn' }, ring), { type: 'rollDice' }, ring);
    s = { ...s, phase: 'awaitingRoll', players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 1 } : p)) };
    const back = reduce(s, { type: 'useTool', toolId: TOOL_TIME_MACHINE }, ring);
    expect(back).not.toBe(s);
    // 再用一次：道具已经没了，用不动
    const again = reduce(back, { type: 'useTool', toolId: TOOL_TIME_MACHINE }, ring);
    expect(again).toBe(back);
  });

  it('快照是深拷贝 —— 存完之后改状态不会串到快照里', () => {
    const s = snapshotOnTurnStart({
      ...withTool(),
      players: [0, 1, 2, 3].map((i) => makePlayer({ index: i })),
    });
    const mutated = {
      ...s,
      players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 7 } : p)),
    };
    const back = restoreSnapshot(mutated);
    expect(back?.players[0]!.cash).not.toBe(7);
  });

  it('玩家是真人才拍 —— WHO_PLAYS_HUMAN 的定义没被改掉', () => {
    expect(WHO_PLAYS_HUMAN).toBe(1);
  });
});
