/*
 * 回合开始判定测试 —— 覆盖 fcn_0040c912 的每条分支
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { evaluateTurnStart, turnController } from './turn-start.ts';
import type { Player } from '../state/types.ts';
import {
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_DEAD,
  WHO_PLAYS_AUTOPILOT,
  displayDays,
} from '../state/types.ts';

function makePlayer(over: Partial<Player> = {}): Player {
  return {
    index: 0,
    character: 0,
    whoPlays: WHO_PLAYS_HUMAN,
    nodeId: 1,
    lastNodeId: 0,
    direction: 0,
    ndices: 1,
    cash: 100000,
    moneyInBank: 0,
    loan: 0,
    points: 0,
    blocking: {
      inHotel: 0,
      disappearing: 0,
      inPrison: 0,
      inHospital: 0,
      sleeping: 0,
      sleepWalking: 0,
    },
    godInfo: 0,
    cards: [],
    tools: new Array<number>(13).fill(0),
    alliedPlayer: 0,
    alliedDays: 0,
    ...over,
  };
}

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
