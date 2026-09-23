/*
 * 託管（who_plays = 1|4）在原版「`cmp byte [+0x15], 1` 整字节比较」的地方走**电脑**那一支 —— 2026-09-23
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版判「真人」有三种写法，本引擎各照各的抄：
 *   · `cmp byte [+0x15], 1`（整字节）—— 小游戏 0x00415457 一带、保釋 0x0043d331 / 0x0043e9d1、
 *     建設公司 0x0041aa3c / 0x0041acd1、研究所 0x0044102f、魔法屋 0x0043381b、樂透、ATM …
 *     ⇒ 託管（5）**不是** 1 ⇒ 电脑支；
 *   · `test byte [+0x15], 1`（bit0）—— 时光机存档 0x004480a0、终局码 / 胜利宣言 0x0040d039 …
 *     ⇒ 託管（5）bit0 = 1 ⇒ 真人支；
 *   · `test byte [+0x15], 6` —— 「是不是电脑」（`isAiControlled`）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from './reduce.ts';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, type GameState } from './types.ts';
import { victoryEndCode } from '../rules/victory.ts';
import { snapshotOnTurnStart } from '../rules/time-machine.ts';

const AUTOPILOT = WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT;

const EXE = `${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;
const at = (va: number, n: number): number[] => {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
};

describe('★ 整字节 `cmp byte [+0x15], 1` 的几处 —— 託管走电脑支', () => {
  runExe('exe：保釋 / 研究所 / 建設公司 都是 `80 b8 7d 6b 49 00 01`（cmp byte [eax+0x496b7d], 1）', () => {
    const cmp = [0x80, 0xb8, 0x7d, 0x6b, 0x49, 0x00, 0x01];
    for (const va of [0x0043d331, 0x0043e9d1, 0x0044102f]) expect({ va, b: at(va, 7) }).toEqual({ va, b: cmp });
    // 时光机那一处是 `test`（f6），不是 `cmp`（80）
    expect(at(0x004480a0, 7)).toEqual([0xf6, 0x80, 0x7d, 0x6b, 0x49, 0x00, 0x01]);
  });

  const prisonTopo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1], specialKind: 4 })] };
  const prison = (whoPlays: number): GameState => {
    const prisonOccupancy = new Array<number>(8).fill(0);
    prisonOccupancy[1] = 1;
    return makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, character: i, nodeId: 1, points: 5000, whoPlays: i === 0 ? whoPlays : WHO_PLAYS_COMPUTER, blocking: { ...makePlayer().blocking, inPrison: i === 1 ? 3 : 0 } }),
      ),
      phase: 'settling',
      prisonOccupancy,
    });
  };

  it('保釋：真人（1）挂保釋窗；託管（5）不挂窗、当场按电脑那一支掷', () => {
    expect(reduce(prison(WHO_PLAYS_HUMAN), { type: 'settle' }, prisonTopo).pending).toMatchObject({ kind: 'bail' });
    const auto = reduce(prison(AUTOPILOT), { type: 'settle' }, prisonTopo);
    expect(auto.pending).toBeNull();
    expect(auto.phase).toBe('turnEnd');
  });

  it('小游戏：託管（5）直接走「不玩」出口，不挂 minigame', () => {
    const topo: MapTopology = { nodes: [makeNode({ id: 1, adjacent: [1], specialKind: 6 })] };
    const s = (who: number) =>
      makeGameState({ players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, whoPlays: i === 0 ? who : WHO_PLAYS_COMPUTER })), phase: 'settling' });
    expect(reduce(s(WHO_PLAYS_HUMAN), { type: 'settle' }, topo).pending).toMatchObject({ kind: 'minigame' });
    expect(reduce(s(AUTOPILOT), { type: 'settle' }, topo).pending?.kind).not.toBe('minigame');
  });
});

describe('★ bit0 `test byte [+0x15], 1` 的几处 —— 託管仍算真人', () => {
  it('终局码：託管的赢家按真人算（2 / 3），电脑赢家是 1', () => {
    expect(victoryEndCode(1, AUTOPILOT)).toBe(2);
    expect(victoryEndCode(2, AUTOPILOT)).toBe(3);
    expect(victoryEndCode(1, WHO_PLAYS_COMPUTER)).toBe(1);
  });

  it('时光机：託管的真人回合开始照样存快照；电脑不存', () => {
    const s = (who: number) => makeGameState({ players: [0, 1].map((i) => makePlayer({ index: i, whoPlays: i === 0 ? who : WHO_PLAYS_COMPUTER })) });
    expect(snapshotOnTurnStart(s(AUTOPILOT)).snapshots[0]).not.toBeNull();
    expect(snapshotOnTurnStart(s(WHO_PLAYS_COMPUTER)).snapshots[0] ?? null).toBeNull();
  });
});
