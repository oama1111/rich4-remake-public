/*
 * 回合开始时「被阻碍」的訊息框 —— 住宿／消失／坐牢／住院／冬眠
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 玩家回报（`feedback/20260922-172913488-manual-Charles.json`）：「npc住院时每回合
 * 到他行动时也要有个文本框」。取证结论：**原版不分人机** —— `fcn_0040c912`
 * （`rich4.asm:6561`）对当前玩家无条件弹；`test byte [player+0x15], 0x30`
 * （`0x0040c969`）那个闸门是「走回棋盘 0x10 / 被外力挪过 0x20」，**不是电脑位**
 * （电脑 `who_plays = 2`，`2 & 0x30 == 0`）—— 命中的那一支**不弹**。
 *
 * 这里钉四件事：
 * ① 五条阻碍各自的键与实参顺序 [`玩家名`, `剩余天数`]；
 * ② 天数口径 —— 消失用 `& 0x3f`（bit6 是「原因」位，见 `fortune-effects.ts`），
 *    其余用 `& 0x7f`；且 `0x80`（刑满待释放）照 `(0x80 & 0x7f) + 1` 显示 1 天；
 * ③ `special`（`who_plays & 0x30`）与 `notAlive` **不弹**；
 * ④ 没被阻碍的回合不弹（对照）。
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '@rich4/data';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from './reduce.ts';
import { DISAPPEARING_MASK, displayRemainingDays } from '../rules/blocking.ts';
import { WHO_PLAYS_DEAD, WHO_PLAYS_RELOCATED, WHO_PLAYS_RETURN_TO_BOARD } from './types.ts';

/** 一张两格小路 —— 本文件只关心 `startTurn` 的阻碍分支，不走子 */
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2] }),
    makeNode({ id: 2, adjacent: [1] }),
  ],
};

/** 0 号是当前玩家（角色 0 = 約翰喬），1 号是陪衬 */
function scene(over: Partial<ReturnType<typeof makePlayer>> = {}) {
  return makeGameState({
    players: [
      makePlayer({ index: 0, character: 0, ...over }),
      makePlayer({ index: 1, character: 1 }),
    ],
    currentPlayer: 0,
    phase: 'turnStart',
  });
}

/** 一套完整的 `BlockingDays`（工厂缺省全 0），按需覆盖一两项 */
function confined(over: Partial<ReturnType<typeof makePlayer>['blocking']> = {}) {
  return { ...makePlayer().blocking, ...over };
}

const start = (over: Partial<ReturnType<typeof makePlayer>> = {}) =>
  reduce(scene(over), { type: 'startTurn' }, topo);

// ============================================================
//  五条阻碍各弹一扇
// ============================================================

describe('★★ 回合开始被阻碍：`○○住院中／還剩 N 天！`（0x0040c912，五句）', () => {
  const cases = [
    { reason: '住宿', key: 'confinement.hotel', blocking: { inHotel: 3 }, days: displayRemainingDays(3) },
    {
      reason: '消失',
      key: 'confinement.disappearing',
      blocking: { disappearing: 3 },
      days: displayRemainingDays(3, DISAPPEARING_MASK),
    },
    { reason: '坐牢', key: 'confinement.prison', blocking: { inPrison: 3 }, days: displayRemainingDays(3) },
    { reason: '住院', key: 'confinement.hospital', blocking: { inHospital: 4 }, days: displayRemainingDays(4) },
    { reason: '冬眠', key: 'confinement.sleeping', blocking: { sleeping: 2 }, days: displayRemainingDays(2) },
  ] as const;

  it.each(cases)('★★★ 可证伪：$reason ⇒ 键 $key，`args` = [玩家名, 剩余天数]', ({ key, blocking, days }) => {
    const after = start({ blocking: confined(blocking) });
    // ① 规则不变：还是直接进回合结束
    expect(after.phase).toBe('turnEnd');
    // ② 框弹出来了（旧实现这里是 `[]` ⇒ 红）
    expect(after.notices).toEqual([{ key, args: ['約翰喬', days] }]);
  });

  it('★★★ 可证伪：玩家名跟着**当前玩家**走（换成 1 号就红）', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, character: 0 }), makePlayer({ index: 1, character: 1 })],
      currentPlayer: 1,
      phase: 'turnStart',
    });
    const after = reduce(
      { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, blocking: confined({ inHospital: 1 }) } : p)) },
      { type: 'startTurn' },
      topo,
    );
    expect(after.notices).toEqual([{ key: 'confinement.hospital', args: ['沙隆巴斯', displayRemainingDays(1)] }]);
    expect(after.notices[0]?.args[0]).not.toBe(CHARACTERS[0]!.name);
  });

  // ★ 审计 2026-09-25（loop F3）订正：住宿那句先写、住院那句**后写同一个缓冲区**（`0x0040c9d2` / `0x0040cafa`
  //   都 `sprintf([esp], 模板, 名, 天)`，模板里没有前文）⇒ 框里是**住院**，且只有一扇。先前按「谁先判」取了住宿。
  it('★★★ 可证伪：同时住院 + 住宿时印**住院**（后写覆盖先写，@source 0x0040c9d2 / 0x0040cafa）', () => {
    const after = start({ blocking: confined({ inHotel: 2, inHospital: 5 }) });
    expect(after.notices.map((n) => n.key)).toEqual(['confinement.hospital']);
    expect(after.notices[0]?.args[1]).toBe(displayRemainingDays(5));
  });

  it('★★★ 可证伪：冬眠只在**前四项都为空**时才印（@source 6702 排在最后）', () => {
    // 坐牢 + 冬眠并存 ⇒ 印坐牢
    const after = start({ blocking: confined({ inPrison: 2, sleeping: 9 }) });
    expect(after.notices[0]?.key).toBe('confinement.prison');
    expect(after.notices.some((n) => n.key === 'confinement.sleeping')).toBe(false);
  });

  it('★ 只弹一扇（不是每条阻碍各一扇）', () => {
    const after = start({ blocking: confined({ inHotel: 1, inPrison: 1, sleeping: 1 }) });
    expect(after.notices).toHaveLength(1);
  });

  it('★ 电脑（`whoPlays = 2`）**同样弹** —— 原版不分人机（0x0040c969 那个闸门不是电脑位）', () => {
    const after = start({ whoPlays: 2, blocking: confined({ inHospital: 2 }) });
    expect(after.notices).toEqual([{ key: 'confinement.hospital', args: ['約翰喬', displayRemainingDays(2)] }]);
  });
});

// ============================================================
//  天数口径
// ============================================================

describe('★★ 天数口径：`(v & mask) + 1`', () => {
  it('★★★ 可证伪：消失用 `& 0x3f` —— bit6 是「原因」位（0x43 ⇒ 4 天，不是 68）', () => {
    // @source fortune-effects.ts:509 `(days & 0x3f) | (reason << 6)` ⇒ bit6 不是天数
    const after = start({ blocking: confined({ disappearing: 0x43 }) });
    expect(after.notices[0]).toEqual({
      key: 'confinement.disappearing',
      args: ['約翰喬', displayRemainingDays(0x43, DISAPPEARING_MASK)],
    });
    expect(after.notices[0]?.args[1]).toBe(4);
    // 用 `& 0x7f` 就会印 68 ⇒ 红
    expect(after.notices[0]?.args[1]).not.toBe(displayRemainingDays(0x43, 0x7f));
  });

  it('★★★ 可证伪：其余四项用 `& 0x7f` —— `0x80`（刑满待释放）显示 1 天', () => {
    // @source blocking.ts：`0x80` = 刑满待释放，仍停在"被阻碍"那一回合；
    //   状态栏与这扇框都读 `(0x80 & 0x7f) + 1 = 1`
    const after = start({ blocking: confined({ inPrison: 0x80 }) });
    expect(after.notices[0]).toEqual({ key: 'confinement.prison', args: ['約翰喬', 1] });
  });

  it('★ 天数按字段各算各的（住院 7 ⇒ 8）', () => {
    const after = start({ blocking: confined({ inHospital: 7 }) });
    expect(after.notices[0]?.args[1]).toBe(8);
  });
});

// ============================================================
//  不该弹的三支
// ============================================================

describe('★★ 不该弹：`special` / `notAlive` / 走回棋盘', () => {
  it('★★★ 可证伪：`whoPlays` 带 `0x20`（被外力挪过）⇒ **不发** notice', () => {
    // @source 0x0040c969 `test byte [player+0x15], 0x30` —— 命中就整回合跳过、不弹状态文字
    const after = start({ whoPlays: 2 | WHO_PLAYS_RELOCATED, blocking: confined({ inHospital: 3 }) });
    expect(after.phase).toBe('turnEnd');
    expect(after.notices).toEqual([]);
  });

  it('★★★ 可证伪：`whoPlays` 带 `0x10`（走回棋盘）⇒ **不发** notice（更早那条早退分支）', () => {
    // @source reduce.ts 的 `WHO_PLAYS_RETURN_TO_BOARD` 分支在 `evaluateTurnStart` **之前** return
    const after = start({ whoPlays: 1 | WHO_PLAYS_RETURN_TO_BOARD, blocking: confined({ inPrison: 3 }) });
    expect(after.phase).toBe('turnEnd');
    expect(after.notices).toEqual([]);
  });

  it('★★★ 可证伪：出局（`whoPlays = 0` ⇒ `blockedBy = notAlive`）⇒ **不发** notice', () => {
    const after = start({ whoPlays: WHO_PLAYS_DEAD, blocking: confined({ inHospital: 3 }) });
    expect(after.notices).toEqual([]);
  });
});

// ============================================================
//  对照：没被阻碍
// ============================================================

describe('★ 对照：没被阻碍的回合不发框', () => {
  it('★★★ 可证伪：一切正常 ⇒ `awaitingRoll` 且 `notices` 为空', () => {
    const after = start();
    expect(after.phase).toBe('awaitingRoll');
    expect(after.notices).toEqual([]);
  });

  it('★ 只被夢遊（`sleepWalking`，不是这五条）也不发框', () => {
    const after = start({ blocking: confined({ sleepWalking: 3 }) });
    expect(after.notices).toEqual([]);
  });
});
