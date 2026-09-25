/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 敌意 —— 以 VA 0x0040df69 的分支结构为准
 */

import { describe, expect, it } from 'vitest';
import { makePlayer } from '../testing/factories.ts';
import { applyHostilityDeltas, breakAlliance, updateHostility } from './hostility.ts';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i }));

describe('updateHostility', () => {
  it('累加到 hostility[对方下标]', () => {
    const r = updateHostility(four(), 0, 2, 150);
    expect(r.players[0]!.hostility).toEqual([0, 0, 150, 0]);
    // 只影响施加方自己的那一行
    expect(r.players[2]!.hostility).toEqual([0, 0, 0, 0]);
  });

  it('★ 对自己无效（原版 cmp edx,ebx / je end）', () => {
    const r = updateHostility(four(), 1, 1, 500);
    expect(r.players[1]!.hostility).toEqual([0, 0, 0, 0]);
  });

  it('下限为 0，无上限', () => {
    let ps = updateHostility(four(), 0, 1, 100).players;
    ps = updateHostility(ps, 0, 1, -300).players;
    expect(ps[0]!.hostility[1]).toBe(0);
    ps = updateHostility(ps, 0, 1, 999999).players;
    expect(ps[0]!.hostility[1]).toBe(999999);
  });

  it('★ 已为 0 时负增量提前返回，结果同样是 0', () => {
    const r = updateHostility(four(), 0, 1, -50);
    expect(r.players[0]!.hostility[1]).toBe(0);
    expect(r.allianceBroken).toBe(false);
  });

  // ★ 通道 2 实测补（2026-09-18，`rich4-spec/tests/test_hostility_update.py`）：
  //   原版对 b **没有上界检查** —— `b = 4` 会写到 `+0x5c`（= `monthlyPaid`），
  //   而且是在旧值上**累加**（实测 `0x11111111 → 0x11111114`，不是覆盖）。
  //   本实现加护栏 ⇒ **有意偏离**（实际调用点只遍历 0..3，构造上不可达）。
  it('⚠️ 有意偏离：b ≥ 4 时加护栏（原版会越界累加进 monthlyPaid）', () => {
    const ps = four();
    const before = ps[0]!.monthlyPaid;
    const r = updateHostility(ps, 0, 4, 5);
    expect(r.players[0]!.hostility).toEqual([0, 0, 0, 0]);
    expect(r.players[0]!.monthlyPaid).toBe(before);
    expect(r.allianceBroken).toBe(false);
  });
});

describe('★ 敌意上升会解除同盟', () => {
  it('对盟友产生正敌意 → 双向解盟', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });

    const r = updateHostility(ps, 0, 1, 200);
    expect(r.allianceBroken).toBe(true);
    expect(r.players[0]!.alliedPlayer).toBe(0);
    expect(r.players[0]!.alliedDays).toBe(0);
    expect(r.players[1]!.alliedPlayer).toBe(0);
    expect(r.players[1]!.alliedDays).toBe(0);
    // 敌意本身照样记上
    expect(r.players[0]!.hostility[1]).toBe(200);
  });

  it('对**非盟友**产生敌意不影响同盟', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });

    const r = updateHostility(ps, 0, 3, 200);
    expect(r.allianceBroken).toBe(false);
    expect(r.players[0]!.alliedPlayer).toBe(2);
  });

  it('★ 负增量不解盟（原版 jle end 在同盟检查之前）', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7, hostility: [0, 500, 0, 0] });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });

    const r = updateHostility(ps, 0, 1, -100);
    expect(r.allianceBroken).toBe(false);
    expect(r.players[0]!.alliedPlayer).toBe(2);
    expect(r.players[0]!.hostility[1]).toBe(400);
  });

  it('增量为 0 也不解盟（jle 含 0）', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 1, alliedDays: 7 });
    expect(updateHostility(ps, 0, 1, 0).allianceBroken).toBe(false);
  });
});

describe('breakAlliance —— 原版真码回归（rich4-spec/tests/test_alliance.py 15/15）', () => {
  it('双向清四格（自己与盟友的 alliedPlayer/alliedDays）', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 3, alliedDays: 7 });
    ps[2] = makePlayer({ index: 2, alliedPlayer: 1, alliedDays: 9 });
    const out = breakAlliance(ps, 0);
    expect([out[0]?.alliedPlayer, out[0]?.alliedDays]).toEqual([0, 0]);
    expect([out[2]?.alliedPlayer, out[2]?.alliedDays]).toEqual([0, 0]);
  });

  it('★ 不检查对方是否「指回自己」：p0→p1 而 p1→p2，p1 照样被清', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 2, alliedDays: 7 });
    ps[1] = makePlayer({ index: 1, alliedPlayer: 3, alliedDays: 5 });
    ps[2] = makePlayer({ index: 2, alliedPlayer: 0, alliedDays: 4 });
    const out = breakAlliance(ps, 0);
    expect([out[1]?.alliedPlayer, out[1]?.alliedDays]).toEqual([0, 0]);
    expect([out[2]?.alliedPlayer, out[2]?.alliedDays]).toEqual([0, 4]);   // 不追链
  });

  it('自指（alliedPlayer == 自己+1）无害', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, alliedPlayer: 1, alliedDays: 7 });
    const out = breakAlliance(ps, 0);
    expect([out[0]?.alliedPlayer, out[0]?.alliedDays]).toEqual([0, 0]);
    expect(out[1]).toEqual(ps[1]);
  });

  it('⚠️ 有意偏离：原版在 alliedPlayer==0 时会**越界清两格**（0x496B3D/0x496B41），本实现不复制', () => {
    // 原版实测：这两格从 0xAA/0xBB 被清成 0（rich4-spec/tests/test_alliance.py §5）
    const ps = four();
    expect(breakAlliance(ps, 0)).toEqual(ps);      // 提前返回，别的字段一个不动
  });
});

describe('applyHostilityDeltas', () => {
  it('按顺序依次施加', () => {
    const ps = applyHostilityDeltas(four(), [
      { from: 1, to: 0, delta: 100 },
      { from: 2, to: 0, delta: 200 },
      { from: 1, to: 0, delta: 50 },
    ]);
    expect(ps[1]!.hostility[0]).toBe(150);
    expect(ps[2]!.hostility[0]).toBe(200);
  });
});

describe('★ update_hostility 的 32 位回绕（0x0040dfa1 add edi, ecx）', () => {
  it('两笔 1717986918 叠加越过 2^31 ⇒ 回绕成负 ⇒ 清 0', () => {
    let ps = [0, 1].map((i) => makePlayer({ index: i }));
    ps = updateHostility(ps, 0, 1, 1717986918).players;
    expect(ps[0]!.hostility[1]).toBe(1717986918);
    ps = updateHostility(ps, 0, 1, 1717986918).players;
    expect(ps[0]!.hostility[1]).toBe(0);
  });
});
