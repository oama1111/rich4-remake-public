/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 陷害卡 —— 以 VA 0x004444bf 为准
 */

import { describe, expect, it } from 'vitest';
import { makeNode, makePlayer } from '../testing/factories.ts';
import { makeObjects } from './summon.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { PASSIVE_CARDS } from './passive.ts';
import {
  FRAME_DAYS_OTHER,
  FRAME_DAYS_SELF,
  FRAME_HOSTILITY_FACTOR,
  applyFrameCard,
} from './frame.ts';

const four = (cards: number[][] = [[], [], [], []]) =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, cards: cards[i] ?? [] }));

const tgt = (index: number) => ({ kind: 'player' as const, index });

/** 1 = 普通格、2 = 监狱、3 = 医院（坐标刻意不同，便于断言「真的搬过去了」） */
const NODES = [
  makeNode({ id: 1, x: 100, y: 200 }),
  makeNode({ id: 2, x: 1935, y: 1039, specialKind: SPECIAL_KIND.PRISON }),
  makeNode({ id: 3, x: 777, y: 888, specialKind: SPECIAL_KIND.HOSPITAL }),
];
const OBJS = makeObjects(46);

describe('基本效果', () => {
  it('把目标关进监狱 5 天', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.ok).toBe(true);
    expect(r.players[2]!.blocking.inPrison).toBe(FRAME_DAYS_OTHER);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 2, days: 5, redirected: false });
  });

  it('★ 敌意 = 物价指数 × 150（与冬眠卡同系数）', () => {
    expect(FRAME_HOSTILITY_FACTOR).toBe(150);
    const r = applyFrameCard(four(), 0, tgt(2), 4);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 600 }]);
  });

  it('只有目标进监狱，其他人不受影响', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.players.map((p) => p.blocking.inPrison)).toEqual([0, 0, 5, 0]);
  });

  // ★★ 2026-09-18：`0x444678 call 0x43d593` —— 那几行「传送到监狱格 +
  //   跟班搬家」写在 `send_to_prison` **函数体内**，所以陷害卡也必须带上。
  //   差分证据：`rich4-spec/tests/test_confinement_teleport.py`（48/48）。
  it('★ 目标被**搬进**监狱格（nodeId/xpos/ypos + lastNodeId 归 0）', () => {
    const ps = four().map((p) => ({ ...p, nodeId: 1, xpos: 100, ypos: 200, lastNodeId: 9 }));
    const r = applyFrameCard(ps, 0, tgt(2), 1, undefined, undefined, undefined, NODES, OBJS);
    expect(r.players[2]!.nodeId).toBe(2);
    expect(r.players[2]!.xpos).toBe(1935);
    expect(r.players[2]!.ypos).toBe(1039);
    expect(r.players[2]!.lastNodeId).toBe(0);
    expect(r.players[0]!.nodeId).toBe(1); // 别人不动
  });

  it('★ 目标身上的跟班物件一起搬', () => {
    const ps = four().map((p, i) => ({ ...p, nodeId: 1, ...(i === 2 ? { godInfo: 3 } : {}) }));
    const r = applyFrameCard(ps, 0, tgt(2), 1, undefined, undefined, undefined, NODES, OBJS);
    expect(r.objects[2]!.nodeId).toBe(2);
  });

  it('★ 不传 nodes/objects ⇒ 只写计数（老调用点的兼容行为）', () => {
    const ps = four().map((p) => ({ ...p, nodeId: 1 }));
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.players[2]!.blocking.inPrison).toBe(5);
    expect(r.players[2]!.nodeId).toBe(1);
  });
});

describe('★ 免罪卡(21)：免疫，无人入狱', () => {
  it('目标持免罪卡则不入狱', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.ok).toBe(true);
    expect(r.outcome).toEqual({ kind: 'absolved', absolvedBy: 2 });
    expect(r.players.every((p) => p.blocking.inPrison === 0)).toBe(true);
  });

  it('★ 敌意照记——免疫与否都记', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 2);
    expect(r.hostilityDeltas).toEqual([{ from: 2, to: 0, delta: 300 }]);
  });

  it('★ 免罪卡优先于嫁祸卡（原版先查 0x15 再查 0x13）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 3);
    expect(r.outcome!.kind).toBe('absolved');
    expect(r.players[3]!.blocking.inPrison).toBe(0);
    // 免罪卡命中即止 ⇒ 嫁祸卡**不**被消耗（原版 `jmp` 跳过 0x13 那段）
    expect(r.players[2]!.cards).toContain(PASSIVE_CARDS.SCAPEGOAT);
  });

  // ★ 命中即**消耗**：原版处理函数内部各自 `remove_card`
  //   免罪 `0x444c11 push 0x15 / call 0x441343`（= remove_card(target,21)）
  //   嫁祸 `0x4449ef push 0x13 / call 0x441343`（= remove_card(target,19)）
  //   此前 remake 只读不扣 ⇒ 同一张免罪卡可以反复挡下每一次攻击（阻断级）。
  it('★★ 免罪卡命中后被消耗（原版 0x444c11）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.players[2]!.cards).not.toContain(PASSIVE_CARDS.ABSOLUTION);
    expect(ps[2]!.cards).toContain(PASSIVE_CARDS.ABSOLUTION); // 原数组不被改
  });

  it('★★ 嫁祸卡命中后被消耗（原版 0x4449ef）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 3);
    expect(r.players[2]!.cards).not.toContain(PASSIVE_CARDS.SCAPEGOAT);
  });

  // ★★ 2026-09-19 订正（§7.140）：旧断言写反了。原版 `0x4449e7 cmp ebx,-1` /
  //   `0x4449ea je 0x444a53` 在扣卡点 `0x4449ef call 0x441343` **之前**
  //   ⇒ 放弃转嫁时嫁祸卡**留在手里**。通道 2 差分直证：
  //   `rich4-spec/tests/test_passive_cards.py`（130/130，UC_HOOK_CODE 确认 0x4449ec 未执行）。
  it('★★ 放弃转嫁（-1）时嫁祸卡**不被消耗**（扣卡点在 cmp 之后）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => -1);
    expect(r.players[2]!.cards).toContain(PASSIVE_CARDS.SCAPEGOAT);
  });
});

// ★ 復仇卡(18) 在**陷害卡**一侧的接入（原版 `0x00444652`–`0x00444678`）：
//   `cmp ebx,edi / jne` （最终目标 == 原始目标）→ `has_card(原始目标,18)` →
//   `call 0x444691`（消耗 18）→ `push 5 / push [0x49910c] / call 0x43d593`
//   ⇒ **把施卡者也关 5 天**（硬编码 5）。
//   此前 remake 在陷害卡侧完全没有这一支。
describe('★ 復仇卡(18)：陷害卡侧的反弹', () => {
  it('目标持復仇卡且未被嫁祸改写 → 施卡者也被关 5 天，且復仇卡被消耗', () => {
    const ps = four([[], [], [PASSIVE_CARDS.REVENGE], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.ok).toBe(true);
    expect(r.outcome!.kind).toBe('imprisoned');
    expect(r.outcome).toMatchObject({ victim: 2, revenged: true });
    expect(r.players[2]!.blocking.inPrison).toBe(5); // 目标照进
    expect(r.players[0]!.blocking.inPrison).toBe(5); // ★ 施卡者也进（硬编码 5）
    expect(r.players[0]!.index).toBe(0);
    expect(r.prisonOccupancy[0]).toBe(1); // 占用表两边都置位
    expect(r.prisonOccupancy[2]).toBe(1);
    expect(r.players[2]!.cards).not.toContain(PASSIVE_CARDS.REVENGE); // 已消耗
  });

  it('★ 被嫁祸改写后**不**查復仇卡（cmp ebx,edi / jne）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT, PASSIVE_CARDS.REVENGE], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 3);
    expect(r.outcome).toMatchObject({ victim: 3, redirected: true });
    expect((r.outcome as { revenged?: boolean }).revenged).toBeUndefined();
    expect(r.players[0]!.blocking.inPrison).toBe(0); // 施卡者没事
    expect(r.players[2]!.cards).toContain(PASSIVE_CARDS.REVENGE); // 復仇卡还在
  });

  it('目标没有復仇卡则无反弹', () => {
    const ps = four([[], [], [], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect((r.outcome as { revenged?: boolean }).revenged).toBeUndefined();
    expect(r.players[0]!.blocking.inPrison).toBe(0);
  });
});

describe('★ 嫁祸卡(19)：把牢饭转给别人', () => {
  it('目标持嫁祸卡则由新目标入狱', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 3);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 3, days: 5, redirected: true });
    expect(r.players[2]!.blocking.inPrison).toBe(0);
    expect(r.players[3]!.blocking.inPrison).toBe(5);
  });

  it('放弃转嫁（返回 -1）则原目标照进', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => -1);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 2, days: 5, redirected: false });
  });

  it('★ 转嫁回出牌者时刑期变 4 天（比较发生在改写之后）', () => {
    const ps = four([[], [], [PASSIVE_CARDS.SCAPEGOAT], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1, () => 0);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 0, days: FRAME_DAYS_SELF, redirected: true });
    expect(r.players[0]!.blocking.inPrison).toBe(4);
  });
});

describe('★ 陷害自己只关 4 天', () => {
  it('直接把自己作为目标', () => {
    const r = applyFrameCard(four(), 1, tgt(1), 1);
    expect(r.outcome).toEqual({ kind: 'imprisoned', victim: 1, days: 4, redirected: false });
  });

  it('4 天确实少于 5 天', () => {
    expect(FRAME_DAYS_SELF).toBeLessThan(FRAME_DAYS_OTHER);
  });
});

describe('目标校验', () => {
  it('地块目标 → wrongTargetKind', () => {
    const r = applyFrameCard(four(), 0, { kind: 'entity', entityId: 1 }, 1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('wrongTargetKind');
  });

  it('越界 → playerOutOfRange', () => {
    expect(applyFrameCard(four(), 0, tgt(9), 1).error).toBe('playerOutOfRange');
  });

  it('失败时状态不变', () => {
    const ps = four();
    const r = applyFrameCard(ps, 0, tgt(9), 1);
    expect(r.players).toEqual(ps);
    expect(r.hostilityDeltas).toEqual([]);
  });
});

describe('★ 接上 confinement：占用表与加刑', () => {
  it('入狱后占用表被置位', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.prisonOccupancy[2]).toBe(1);
  });

  it('免疫时占用表不动', () => {
    const ps = four([[], [], [PASSIVE_CARDS.ABSOLUTION], []]);
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.prisonOccupancy.every((v) => v === 0)).toBe(true);
  });

  it('★ 对已在狱中的人再陷害 → 加刑而非覆盖', () => {
    const ps = four();
    ps[2] = makePlayer({
      index: 2,
      blocking: { ...ps[2]!.blocking, inPrison: 3 },
    });
    const r = applyFrameCard(ps, 0, tgt(2), 1);
    expect(r.outcome).toMatchObject({ kind: 'imprisoned', victim: 2, days: 8 });
    expect(r.players[2]!.blocking.inPrison).toBe(8);
  });
});

// ============================================================
//  ★★ 2026 本轮：入狱要**占床位**（此前调用方连占用表都没传，结果丢了）
//  原版真码：rich4-spec/tests/test_confinement_release.py（15/15）
// ============================================================

describe('★ 嫁禍入狱要写占用表', () => {
  it('默认（空表）→ 目标那一格变 1，其余 0', () => {
    const r = applyFrameCard(four(), 0, tgt(2), 1);
    expect(r.prisonOccupancy.slice(0, 4)).toEqual([0, 0, 1, 0]);
  });

  it('★ 传进来的表被继承（不是从全 0 重来）', () => {
    const r = applyFrameCard(
      four(), 0, tgt(2), 1, () => -1,
      [1, 0, 0, 0, 0, 0, 0, 0],
    );
    expect(r.prisonOccupancy.slice(0, 4)).toEqual([1, 0, 1, 0]);
  });

  it('★ 首次入狱要清**医院**那一格（原版 `0x41a7c5 call 0x40d761` 的两道闸）', () => {
    // 2 号正在住院：医院表占 2 号格、inHospital 非 0
    const players = four();
    players[2] = makePlayer({
      index: 2,
      blocking: { ...makePlayer().blocking, inHospital: 4 },
    });
    const r = applyFrameCard(
      players, 0, tgt(2), 1, () => -1,
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
    );
    expect(r.prisonOccupancy[2]).toBe(1);        // 进监狱表
    expect(r.hospitalOccupancy[2]).toBe(0);      // ★ 医院那格被清
    expect(r.players[2]?.blocking.inHospital).toBe(0);
    expect(r.players[2]?.blocking.inPrison).toBe(FRAME_DAYS_OTHER);
  });

  it('已经被关的人（加刑）→ 不重复占格、也不清别的', () => {
    const players = four();
    players[2] = makePlayer({
      index: 2,
      blocking: { ...makePlayer().blocking, inPrison: 2 },
    });
    const r = applyFrameCard(
      players, 0, tgt(2), 1, () => -1,
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
    );
    expect(r.prisonOccupancy[2]).toBe(1);
    // `confine` 的既有语义：已在狱 + days（2+5=7），不是覆盖成 5。
    // ⚠️ 「卡牌这条路是加刑还是覆盖」本身**尚未差分**（原版 `0x41a7c5` 之后
    //    还有分支没读完）—— 这里只钉住当前实现，别把它当成已验证的事实。
    expect(r.players[2]?.blocking.inPrison).toBe(2 + FRAME_DAYS_OTHER);
  });
});
