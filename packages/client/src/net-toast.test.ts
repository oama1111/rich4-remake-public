/*
 * W-75：联机提示的**纯逻辑** —— 前后两份 `RoomInfo` 要比出哪几句话
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ DOM 那一半（`NetToasts`）不在这里测：那要引一个 DOM 实现，为一个覆盖层不值。
 *   它的排队/自收/常驻横幅在浏览器里验收，见 `docs/acceptance/w75-20260920.md`。
 */

import { describe, expect, it } from 'vitest';
import type { RoomInfo, SeatInfo } from '@rich4/core';
import { AUTOPILOT_BANNER, selfAutopilot, roomToasts } from './net-toast.ts';

function seat(over: Partial<SeatInfo> & { seat: number }): SeatInfo {
  return { name: `P${over.seat}`, character: over.seat, kind: 'human', connected: true, ...over };
}

function room(...seats: SeatInfo[]): RoomInfo {
  return { id: 'K7M2QP', seats, started: false };
}

describe('★ W-75 谁能进来、谁掉线、谁回来', () => {
  it('第一次拿到房间快照：里面的人算「加入了」（此前根本没有快照）', () => {
    const r = roomToasts(null, room(seat({ seat: 0, name: '小明' })));
    expect(r.lines).toEqual([{ seat: 0, text: '小明 加入了房間' }]);
  });

  it('新来一位 ⇒ 只说新来的那一位', () => {
    const before = room(seat({ seat: 0, name: '小明' }));
    const after = room(seat({ seat: 0, name: '小明' }), seat({ seat: 1, name: '小红' }));
    expect(roomToasts(before, after).lines).toEqual([{ seat: 1, text: '小红 加入了房間' }]);
  });

  it('空座被电脑补上 ⇒ **不算**「有人加入」（那是电脑，不是人）', () => {
    const before = room(seat({ seat: 0, name: '小明' }));
    const after = room(seat({ seat: 0, name: '小明' }), seat({ seat: 1, name: '電腦2', kind: 'computer' }));
    expect(roomToasts(before, after).lines).toEqual([]);
  });

  it('掉线 ⇒ 那一句；回来 ⇒ 另一句', () => {
    const up = room(seat({ seat: 0 }), seat({ seat: 1 }));
    const down = room(seat({ seat: 0 }), seat({ seat: 1, connected: false }));
    expect(roomToasts(up, down).lines).toEqual([{ seat: 1, text: 'P1 離線了，30 秒後由電腦代打' }]);
    expect(roomToasts(down, up).lines).toEqual([{ seat: 1, text: 'P1 回來了' }]);
  });

  it('★ E-34：秒数跟服务器的 `takeoverAfterMs` 走（`--takeover 45000` ⇒ 45 秒），不带就按 30', () => {
    const up = { ...room(seat({ seat: 0 }), seat({ seat: 1 })), takeoverAfterMs: 45_000 };
    const down = { ...room(seat({ seat: 0 }), seat({ seat: 1, connected: false })), takeoverAfterMs: 45_000 };
    expect(roomToasts(up, down).lines).toEqual([{ seat: 1, text: 'P1 離線了，45 秒後由電腦代打' }]);
  });

  it('什么都没变 ⇒ 一句都不说（不会因为「每帧比较一次」就刷屏）', () => {
    const r = room(seat({ seat: 0 }), seat({ seat: 1 }));
    expect(roomToasts(r, room(seat({ seat: 0 }), seat({ seat: 1 }))).lines).toEqual([]);
  });
});

describe('★ W-75 超时与託管', () => {
  it('第一次超时 ⇒「這一回合由電腦代打」', () => {
    const before = room(seat({ seat: 0 }));
    const after = room(seat({ seat: 0, autopilot: 'idle' }));
    const r = roomToasts(before, after);
    expect(r.lines).toEqual([{ seat: 0, text: 'P0 超時，這一回合由電腦代打' }]);
    expect(r.strikes.get(0)).toBe(1);
  });

  it('★ 自动归还**不算**清零；再超时一次 ⇒「連續超時，已交給電腦託管」', () => {
    const idle = room(seat({ seat: 0, autopilot: 'idle' }));
    const back = room(seat({ seat: 0 })); // 第一次超时之后，回合结束自动还给他
    const first = roomToasts(room(seat({ seat: 0 })), idle);
    expect(first.strikes.get(0)).toBe(1);

    const restored = roomToasts(idle, back, first.strikes);
    expect(restored.lines).toEqual([]); // 「收回」本身不弹
    // ★ 服务器那边的 `strikes` 这时候**还是 1**（只有他自己交了 intent 才清零）
    expect(restored.strikes.get(0)).toBe(1);

    // 第二次超时：这一次**不会**自动还（服务器保持 'idle'）
    const second = roomToasts(back, idle, restored.strikes);
    expect(second.lines).toEqual([{ seat: 0, text: 'P0 連續超時，已交給電腦託管（點一下畫面即可收回）' }]);
    expect(second.strikes.get(0)).toBe(2);
  });

  it('★ 他自己派了一条 action（`noteIntent`）⇒ 计数清零，下一次又只算第一次', () => {
    const idle = room(seat({ seat: 0, autopilot: 'idle' }));
    const back = room(seat({ seat: 0 }));
    const r1 = roomToasts(room(seat({ seat: 0 })), idle);
    const r2 = roomToasts(idle, back, r1.strikes);
    // 客户端在「看见这个座位派了一条 action」时清零（`NetToasts.noteIntent`）
    const cleared = new Map(r2.strikes);
    cleared.set(0, 0);
    const again = roomToasts(back, idle, cleared);
    expect(again.lines).toEqual([{ seat: 0, text: 'P0 超時，這一回合由電腦代打' }]);
    expect(again.strikes.get(0)).toBe(1);
  });

  it('掉线代打走的是 `offline`，不算「超时」', () => {
    const before = room(seat({ seat: 0 }));
    const after = room(seat({ seat: 0, connected: false, autopilot: 'offline' }));
    const r = roomToasts(before, after);
    expect(r.lines).toEqual([{ seat: 0, text: 'P0 離線了，30 秒後由電腦代打' }]);
    expect(r.strikes.get(0)).toBeUndefined();
  });

  it('★ 常驻横幅只给被託管的**本人**', () => {
    const info = room(seat({ seat: 0 }), seat({ seat: 1, autopilot: 'idle' }));
    expect(selfAutopilot(info, 1)).toBe(true);
    expect(selfAutopilot(info, 0)).toBe(false);
    expect(selfAutopilot(info, null)).toBe(false);
    expect(selfAutopilot(null, 0)).toBe(false);
    // 掉线代打**不是**这条横幅管的事（那是「他离线了」，不是「你被託管」）
    expect(selfAutopilot(room(seat({ seat: 0, autopilot: 'offline' })), 0)).toBe(false);
    expect(AUTOPILOT_BANNER).toContain('點一下畫面收回');
  });
});

describe('★ W-75 多种变化一起来', () => {
  it('一次快照里可以有「有人加入 + 有人掉线 + 有人超时」三条，顺序稳定', () => {
    const before = room(seat({ seat: 0, name: 'A' }), seat({ seat: 1, name: 'B' }));
    const after = room(
      seat({ seat: 0, name: 'A', autopilot: 'idle' }),
      seat({ seat: 1, name: 'B', connected: false }),
      seat({ seat: 2, name: 'C' }),
    );
    expect(roomToasts(before, after).lines).toEqual([
      { seat: 0, text: 'A 超時，這一回合由電腦代打' },
      { seat: 1, text: 'B 離線了，30 秒後由電腦代打' },
      { seat: 2, text: 'C 加入了房間' },
    ]);
  });

  it('计数是**按座位**分开的', () => {
    const a0 = room(seat({ seat: 0 }), seat({ seat: 1 }));
    const a1 = room(seat({ seat: 0, autopilot: 'idle' }), seat({ seat: 1 }));
    const s1 = roomToasts(a0, a1).strikes;
    const a2 = room(seat({ seat: 0, autopilot: 'idle' }), seat({ seat: 1, autopilot: 'idle' }));
    const s2 = roomToasts(a1, a2, s1).strikes;
    expect(s2.get(0)).toBe(1);
    expect(s2.get(1)).toBe(1);
  });

  it('不修改传进来的那份计数（纯函数）', () => {
    const prev = new Map([[0, 1]]);
    roomToasts(room(seat({ seat: 0 })), room(seat({ seat: 0, autopilot: 'idle' })), prev);
    expect(prev.get(0)).toBe(1);
  });
});
