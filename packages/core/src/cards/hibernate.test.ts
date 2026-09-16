/*
 * 冬眠卡验证 —— 基准为原版 exe 反汇编（VA 0x004440ea）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyHibernateCard,
  hibernateActors,
  HIBERNATE_ACTOR_SLOTS,
  HIBERNATE_DAYS,
  HIBERNATE_HOSTILITY_FACTOR,
} from './hibernate.ts';
import { ACTOR_PLACE, initialSpecialActors, releaseNpc } from '../rules/special-actors.ts';
import { makePlayer } from '../testing/factories.ts';
import { WHO_PLAYS_DEAD, WHO_PLAYS_COMPUTER } from '../state/types.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));

describe('冬眠卡', () => {
  it('冬眠 5 天', () => {
    expect(HIBERNATE_DAYS).toBe(5);
    const r = applyHibernateCard(four(), 0, 1);
    expect(r.players[1]!.blocking.sleeping).toBe(5);
  });

  it('★ 不影响出牌者自己', () => {
    const r = applyHibernateCard(four(), 2, 1);
    expect(r.players[2]!.blocking.sleeping).toBe(0);
    expect(r.affected).toEqual([0, 1, 3]);
  });

  it('对其他所有在场玩家生效', () => {
    const r = applyHibernateCard(four(), 0, 1);
    expect(r.affected).toEqual([1, 2, 3]);
  });

  it('出局玩家不受影响', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, whoPlays: WHO_PLAYS_DEAD });
    const r = applyHibernateCard(ps, 0, 1);
    expect(r.affected).toEqual([2, 3]);
  });

  it('电脑玩家照常生效', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, whoPlays: WHO_PLAYS_COMPUTER });
    expect(applyHibernateCard(ps, 0, 1).affected).toContain(1);
  });

  it('★ xpos 为 0 的玩家被跳过', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, xpos: 0 });
    expect(applyHibernateCard(ps, 0, 1).affected).toEqual([2, 3]);
  });

  it.each(['inHotel', 'disappearing', 'inPrison', 'inHospital'] as const)(
    '★ 已处于 %s 状态的玩家被跳过', (field) => {
    const ps = four();
    const p = makePlayer({ index: 1 });
    p.blocking[field] = 2;
    ps[1] = p;
    expect(applyHibernateCard(ps, 0, 1).affected).toEqual([2, 3]);
  },
  );

  it('★ 已在冬眠中的玩家**不**被跳过（该判定只覆盖 0x32 起的 4 字节）', () => {
    // @source cmp dword [player+0x32], 0 —— 只含住宿/消失/坐牢/住院，不含 sleeping(0x36)
    const ps = four();
    const p = makePlayer({ index: 1 });
    p.blocking.sleeping = 3;
    ps[1] = p;
    const r = applyHibernateCard(ps, 0, 1);
    expect(r.affected).toContain(1);
    expect(r.players[1]!.blocking.sleeping).toBe(5); // 被刷新为 5
  });

  it('★ 梦游状态被清零', () => {
    const ps = four();
    const p = makePlayer({ index: 1 });
    p.blocking.sleepWalking = 4;
    ps[1] = p;
    expect(applyHibernateCard(ps, 0, 1).players[1]!.blocking.sleepWalking).toBe(0);
  });

  it('★ 冬眠天数累计 += 5（印证 +0x42 确为 total_winter_sleep_days）', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, totalWinterSleepDays: 10 });
    expect(applyHibernateCard(ps, 0, 1).players[1]!.totalWinterSleepDays).toBe(15);
  });
});

describe('敌意结算', () => {
  it('增量 = 物价指数 × 150', () => {
    expect(HIBERNATE_HOSTILITY_FACTOR).toBe(150);
    const r = applyHibernateCard(four(), 0, 4);
    expect(r.hostilityDeltas.every((h) => h.delta === 600)).toBe(true);
  });

  it('敌意指向出牌者', () => {
    const r = applyHibernateCard(four(), 3, 1);
    expect(r.hostilityDeltas.every((h) => h.to === 3)).toBe(true);
    expect(r.hostilityDeltas.map((h) => h.from)).toEqual([0, 1, 2]);
  });

  it('被跳过的玩家不产生敌意', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, xpos: 0 });
    expect(applyHibernateCard(ps, 0, 1).hostilityDeltas.map((h) => h.from)).toEqual([2, 3]);
  });
});

describe('不原地修改入参', () => {
  it('原玩家数组不变', () => {
    const ps = four();
    const snapshot = JSON.stringify(ps);
    applyHibernateCard(ps, 0, 1);
    expect(JSON.stringify(ps)).toBe(snapshot);
  });
});

// ============================================================
//  ★ 替身那一支（D-T047-2 的第二半）@source `rich4_card_dongmianka.asm:36-92`
// ============================================================

describe('★ 冬眠卡对**替身**（四大惡人）：+12 置 5、+13 清 0', () => {
  /** 四个惡人全在盘上 */
  const onBoard = () =>
    initialSpecialActors().map((a, i) => (i < 4 ? { ...releaseNpc(i + 1, i, 0) } : a));

  it('★ 循环上界是 8 ⇒ 只覆盖四大惡人 0..3，**不含機器娃娃**', () => {
    // @source `00444138 inc ebx / cmp ebx, 8 / jge 结束`
    expect(HIBERNATE_ACTOR_SLOTS).toEqual([0, 1, 2, 3]);
    // 就算娃娃在盘上也不会被冬眠
    const actors = onBoard();
    actors[4] = { ...releaseNpc(1, 0, 0) };
    const r = hibernateActors(actors);
    expect(r.affected).toEqual([0, 1, 2, 3]);
    expect(r.actors[4]!.hibernating).toBeUndefined();
    expect(r.actors[4]!.place).toBe(ACTOR_PLACE.board);
  });

  it('★ 在盘上的四个：hibernating = 5，且**先清夢遊**（+13 = 0）', () => {
    // @source 004441a9 那一段：`mov [eax+0x498df5], ch(=0)` 在前、
    //   `mov [eax+0x498df4], dh(=5)` 在后 —— 与夢遊卡互为反面
    const actors = onBoard().map((a, i) => (i === 1 ? { ...a, sleepwalkDays: 5 } : a));
    const r = hibernateActors(actors);
    expect(r.affected).toEqual([0, 1, 2, 3]);
    for (const slot of [0, 1, 2, 3]) {
      expect(r.actors[slot]!.hibernating, `槽 ${slot}`).toBe(HIBERNATE_DAYS);
      expect(r.actors[slot]!.sleepwalkDays, `槽 ${slot}`).toBe(0);
    }
  });

  it('★ 不在盘上的跳过（監獄/醫院/未出场）@source `cmp [eax+0x498df2],0 / jne`', () => {
    // 初始状态：小偷/強盜在監獄、流氓/間諜在醫院、娃娃未出场
    const r = hibernateActors(initialSpecialActors());
    expect(r.affected).toEqual([]);
    for (const a of r.actors) expect(a.hibernating).toBeUndefined();
  });

  it('部分在盘：只动在盘的那几个', () => {
    const actors = initialSpecialActors();
    actors[1] = { ...releaseNpc(3, 1, 0) }; // 強盜上路
    actors[3] = { ...releaseNpc(4, 3, 0) }; // 間諜上路
    const r = hibernateActors(actors);
    expect(r.affected).toEqual([1, 3]);
    expect(r.actors[0]!.hibernating).toBeUndefined();
    expect(r.actors[1]!.hibernating).toBe(HIBERNATE_DAYS);
    expect(r.actors[2]!.hibernating).toBeUndefined();
    expect(r.actors[3]!.hibernating).toBe(HIBERNATE_DAYS);
  });

  it('place 是 board 但 nodeId 为 0 的（异常记录）不当在盘上', () => {
    const actors = initialSpecialActors();
    actors[0] = { ...releaseNpc(1, 0, 0), nodeId: 0 };
    expect(hibernateActors(actors).affected).toEqual([]);
  });

  it('不改其它字段（朝向/步数/主任都原样）', () => {
    const actors = onBoard();
    const r = hibernateActors(actors);
    for (const slot of [0, 1, 2, 3]) {
      expect(r.actors[slot]!.direction).toBe(actors[slot]!.direction);
      expect(r.actors[slot]!.owner).toBe(actors[slot]!.owner);
      expect(r.actors[slot]!.nodeId).toBe(actors[slot]!.nodeId);
    }
  });
});
