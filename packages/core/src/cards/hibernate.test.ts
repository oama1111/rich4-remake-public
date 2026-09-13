/*
 * 冬眠卡验证 —— 基准为原版 exe 反汇编（VA 0x004440ea）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { applyHibernateCard, HIBERNATE_DAYS, HIBERNATE_HOSTILITY_FACTOR } from './hibernate.ts';
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
