/*
 * 回合开始判定测试 —— 覆盖 fcn_0040c912 的每条分支
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateTurnStart, turnController, type TurnController } from './turn-start.ts';
import { makeGameState, makePlayer } from '../testing/factories.ts';
import { reduce } from '../state/reduce.ts';
import {
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_DEAD,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_RELOCATED,
  displayDays,
  type Player,
} from '../state/types.ts';


describe('evaluateTurnStart —— 与 fcn_0040c912 逐分支对照', () => {
  it('已出局玩家返回 0，不可行动', () => {
    const r = evaluateTurnStart(makePlayer({ whoPlays: WHO_PLAYS_DEAD }));
    expect(r.raw).toBe(0);
    expect(r.canAct).toBe(false);
    expect(r.blockedBy).toBe('notAlive');
  });

  it('无阻碍的人类玩家返回 who_plays，可行动', () => {
    const r = evaluateTurnStart(makePlayer({ whoPlays: WHO_PLAYS_HUMAN }));
    expect(r.raw).toBe(WHO_PLAYS_HUMAN);
    expect(r.canAct).toBe(true);
    expect(turnController(r)).toBe('human');
  });

  it('电脑玩家交给 AI', () => {
    const r = evaluateTurnStart(makePlayer({ whoPlays: WHO_PLAYS_COMPUTER }));
    expect(r.raw).toBe(WHO_PLAYS_COMPUTER);
    expect(turnController(r)).toBe('ai');
  });

  it('被托管的人类（who_plays = 5）同样交给 AI', () => {
    // 5 = 1|4，对应原版跳表把 5 归入 AI 分支
    const r = evaluateTurnStart(
      makePlayer({ whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }),
    );
    expect(r.raw).toBe(5);
    expect(r.canAct).toBe(true);
    expect(turnController(r)).toBe('ai');
  });

  it.each([
    ['inHotel', 'inHotel'],
    ['disappearing', 'disappearing'],
    ['inPrison', 'inPrison'],
    ['inHospital', 'inHospital'],
    ['sleeping', 'sleeping'],
  ] as const)('%s 非零时跳过回合', (field, reason) => {
    const p = makePlayer();
    p.blocking[field] = 3;
    const r = evaluateTurnStart(p);
    expect(r.raw).toBe(0);
    expect(r.canAct).toBe(false);
    expect(r.blockedBy).toBe(reason);
    expect(turnController(r)).toBe('skip');
  });

  it('梦游：返回 -1，不可控但会自动走子', () => {
    const p = makePlayer();
    p.blocking.sleepWalking = 2;
    const r = evaluateTurnStart(p);
    expect(r.raw).toBe(-1);
    expect(r.canAct).toBe(false);
    expect(r.sleepWalk).toBe(true);
    expect(r.blockedBy).toBeNull();
  });

  it('梦游不算阻碍状态：与坐牢等同时存在时，阻碍优先', () => {
    const p = makePlayer();
    p.blocking.sleepWalking = 2;
    p.blocking.inPrison = 1;
    const r = evaluateTurnStart(p);
    expect(r.raw).toBe(0); // 阻碍优先，不走梦游分支
    expect(r.sleepWalk).toBe(false);
    expect(r.blockedBy).toBe('inPrison');
  });

  it('who_plays 的 0x30 位命中时跳过常规流程', () => {
    const p = makePlayer({ whoPlays: WHO_PLAYS_HUMAN | 0x10 });
    p.blocking.inPrison = 1;
    const r = evaluateTurnStart(p);
    expect(r.canAct).toBe(false);
    expect(r.blockedBy).toBe('special');
  });

  it('quiet 模式：0x30 位命中即返回 0，不看阻碍状态', () => {
    const p = makePlayer({ whoPlays: WHO_PLAYS_HUMAN | 0x20 });
    const r = evaluateTurnStart(p, true);
    expect(r.raw).toBe(0);
    expect(r.blockedBy).toBe('special');
  });

  it('quiet 模式下无阻碍则照常返回 who_plays', () => {
    const r = evaluateTurnStart(makePlayer({ whoPlays: WHO_PLAYS_COMPUTER }), true);
    expect(r.raw).toBe(WHO_PLAYS_COMPUTER);
    expect(r.canAct).toBe(true);
  });

  it('quiet 模式下梦游不触发自动走子（只做判定）', () => {
    const p = makePlayer();
    p.blocking.sleepWalking = 5;
    const r = evaluateTurnStart(p, true);
    expect(r.canAct).toBe(true); // 梦游不阻碍
    expect(r.sleepWalk).toBe(false); // 但 quiet 不走自动分支
  });

  it('阻碍判定顺序与原版显示状态文字的顺序一致', () => {
    const p = makePlayer();
    p.blocking.inHotel = 1;
    p.blocking.inPrison = 1;
    p.blocking.sleeping = 1;
    // 住宿 → 消失 → 坐牢 → 住院 → 冬眠
    expect(evaluateTurnStart(p).blockedBy).toBe('inHotel');
  });
});

describe('displayDays —— 高位是标志位', () => {
  it('低 7 位加 1 才是显示的剩余天数', () => {
    // @source rich4.asm:6598-6601  and al,0x7f / inc eax
    expect(displayDays(0)).toBe(1);
    expect(displayDays(4)).toBe(5);
    expect(displayDays(0x80)).toBe(1); // 高位是标志，不计入天数
    expect(displayDays(0x83)).toBe(4);
  });

  it('消失天数用 0x3f 掩码（2 个标志位）', () => {
    // @source rich4.asm:6611  and al,0x3f
    expect(displayDays(0xc5, 0x3f)).toBe(6);
  });
});

// ============================================================
//  回合总调度的整值跳表（`fcn_00418c55`）—— 可达值逐一对照
// ============================================================

const EXE = `${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;
const exeBytes = (va: number, n: number): number[] => {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
};

/**
 * 原版那张表，按返回值**整值**查（`cmp eax, 5 / ja` 是无符号比较 ⇒ −1 也 > 5）。
 *   'endTurn' = `[0] call 0x418e7f`；'human' = `[1]`；'ai' = `[2]`/`[5]`；
 *   'return' = `ja` 与 `[3]`/`[4]`（调度什么都不做；−1 时 `auto_move` 已在 `0x40c912` 里起步）。
 */
function originalDispatch(raw: number): 'endTurn' | 'human' | 'ai' | 'return' {
  const u = raw >>> 0;
  if (u > 5) return 'return';
  return (['endTurn', 'human', 'ai', 'return', 'return', 'ai'] as const)[u]!;
}

/** 本引擎的四种归属对到原版哪一支（'skip' 走 `turnEnd` = `[0]`；'auto' = 夢遊的 −1）*/
const OURS_TO_ORIGINAL: Record<TurnController, ReturnType<typeof originalDispatch>> = {
  skip: 'endTurn',
  human: 'human',
  ai: 'ai',
  auto: 'return',
};

describe('★ 回合总调度 —— 本引擎写得出的每个 whoPlays，归属都与原版整值跳表一致', () => {
  runExe('exe：`cmp eax, 5 / ja 0x418e7a / jmp [eax*4 + 0x418c3d]`，表 = 0x418d88 / d99 / dc6 / e7a / e7a / dc6', () => {
    expect(exeBytes(0x00418d78, 16)).toEqual([
      0x83, 0xf8, 0x05, // cmp eax, 5
      0x0f, 0x87, 0xf9, 0x00, 0x00, 0x00, // ja 0x418e7a（无符号）
      0xff, 0x24, 0x85, 0x3d, 0x8c, 0x41, 0x00, // jmp [eax*4 + 0x418c3d]
    ]);
    const table = exeBytes(0x00418c3d, 24);
    const entries = [0, 1, 2, 3, 4, 5].map((i) => table[i * 4]! | (table[i * 4 + 1]! << 8) | (table[i * 4 + 2]! << 16) | (table[i * 4 + 3]! << 24));
    expect(entries).toEqual([0x418d88, 0x418d99, 0x418dc6, 0x418e7a, 0x418e7a, 0x418dc6]);
  });

  /**
   * 本引擎能写出的 whoPlays（逐个写者核过）：
   *   · 1 / 2 —— `rules/new-game.ts`（真人 / 电脑）；
   *   · 5 = 1|4 —— 託管：`setAi`（白名单只收 1 / 2 / 5）、服务器掉线接管与超时託管（`server/src/hub.ts`）、
   *     認輸投降（`client/main.ts`，只对本机真人座）、託管设定页（仍经 `setAi` 白名单）；
   *   · 0 —— 破產（`rules/bankruptcy.ts`）/ 终局把输家清零（`rules/victory.ts`）；
   *   · | 0x10 —— 刑满 / 出院 / 退房（`reduce.ts` 日推进）⇒ `startTurn` 在调度**之前**就走「走回棋盘」支；
   *   · | 0x20 —— 被挪到旅館（同时 `inHotel > 0`）⇒ 被阻碍 ⇒ 返回 0；离场时 `endTurn` 清掉；
   *   · 读档原样搬进（原版存档里也只有上面这些）。
   *   惡人（四个 NPC）不在 `players` 里，不经这张表。
   */
  const cases: Array<[string, Partial<Player>]> = [
    ['真人 1', { whoPlays: WHO_PLAYS_HUMAN }],
    ['电脑 2', { whoPlays: WHO_PLAYS_COMPUTER }],
    ['託管 5（单机 / 联机掉线 / 超时 / 投降）', { whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }],
    ['出局 0', { whoPlays: WHO_PLAYS_DEAD }],
    ...[WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT].flatMap((w): Array<[string, Partial<Player>]> => [
      [`${w} 坐牢`, { whoPlays: w, blocking: { ...makePlayer().blocking, inPrison: 2 } }],
      [`${w} 冬眠`, { whoPlays: w, blocking: { ...makePlayer().blocking, sleeping: 2 } }],
      [`${w} 夢遊`, { whoPlays: w, blocking: { ...makePlayer().blocking, sleepWalking: 2 } }],
      [`${w}|0x20 住旅館`, { whoPlays: w | WHO_PLAYS_RELOCATED, blocking: { ...makePlayer().blocking, inHotel: 2 } }],
    ]),
  ];

  it.each(cases)('%s', (_name, over) => {
    const r = evaluateTurnStart(makePlayer(over));
    expect(OURS_TO_ORIGINAL[turnController(r)]).toBe(originalDispatch(r.raw));
  });

  it('`setAi` 只收 1 / 2 / 5 —— 3、4、6、7（原版表里「什么都不做」的那几个）写不进来', () => {
    const s = makeGameState({ players: [0, 1].map((i) => makePlayer({ index: i })) });
    for (const w of [3, 4, 6, 7, 0x11]) expect(reduce(s, { type: 'setAi', player: 0, whoPlays: w }, { nodes: [] })).toBe(s);
    for (const w of [WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT]) {
      expect(reduce(s, { type: 'setAi', player: 0, whoPlays: w }, { nodes: [] }).players[0]!.whoPlays).toBe(w);
    }
  });

  it('★ 夢遊（−1）不是「跳过」：原版 `auto_move` 已起步 ⇒ `auto`；真人 / 电脑 / 託管一视同仁', () => {
    for (const w of [WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT]) {
      const r = evaluateTurnStart(makePlayer({ whoPlays: w, blocking: { ...makePlayer().blocking, sleepWalking: 1 } }));
      expect(turnController(r)).toBe('auto');
    }
  });
});
