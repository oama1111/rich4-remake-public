/*
 * 乌龟卡验证 —— 基准为原版 exe 反汇编（VA 0x004458df）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  applyTortoiseCard, applyTortoiseCardToActor,
  TORTOISE_DAYS_SELF, TORTOISE_DAYS_OTHER, TORTOISE_SELECTION_PARAM,
} from './tortoise.ts';
import { useCard } from './registry.ts';
import { releaseNpc } from '../rules/special-actors.ts';
import type { UseCardContext } from './registry.ts';
import { newStockMarket } from '../places/stock-market.ts';
import { makePlayer } from '../testing/factories.ts';
import { cardImpl } from '@rich4/data';

const four = () => [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));

describe('乌龟卡', () => {
  it('选择参数与清单一致', () => {
    expect(cardImpl(30)!.selectionParam).toBe(TORTOISE_SELECTION_PARAM);
  });

  it('★ 对别人用 = 3 天', () => {
    expect(TORTOISE_DAYS_OTHER).toBe(3);
    const r = applyTortoiseCard(four(), 0, { kind: 'player', index: 2 });
    expect(r.days).toBe(3);
    expect(r.players[2]!.blocking.tortoiseWalking).toBe(3);
  });

  it('★ 对自己用 = 2 天（比对别人少一天）', () => {
    // @source cmp esi, [current] / jne → 3；否则 → 2
    expect(TORTOISE_DAYS_SELF).toBe(2);
    const r = applyTortoiseCard(four(), 1, { kind: 'player', index: 1 });
    expect(r.days).toBe(2);
    expect(r.players[1]!.blocking.tortoiseWalking).toBe(2);
  });

  it('只影响目标', () => {
    const r = applyTortoiseCard(four(), 0, { kind: 'player', index: 3 });
    expect(r.players.filter((p) => p.blocking.tortoiseWalking !== 0).length).toBe(1);
  });

  it('目标缺失/种类错误/越界时失败', () => {
    expect(applyTortoiseCard(four(), 0, { kind: 'none' }).error).toBe('targetRequired');
    expect(applyTortoiseCard(four(), 0, { kind: 'entity', entityId: 2001 }).error).toBe('wrongTargetKind');
    expect(applyTortoiseCard(four(), 0, { kind: 'player', index: 7 }).error).toBe('playerOutOfRange');
  });

  it('失败时不改动任何玩家', () => {
    const r = applyTortoiseCard(four(), 0, { kind: 'none' });
    expect(r.players.every((p) => p.blocking.tortoiseWalking === 0)).toBe(true);
    expect(r.days).toBe(0);
  });

  it('不原地修改入参', () => {
    const ps = four();
    const snap = JSON.stringify(ps);
    applyTortoiseCard(ps, 0, { kind: 'player', index: 2 });
    expect(JSON.stringify(ps)).toBe(snap);
  });
});

/**
 * ★★ 第 90 条：通道 2 差分 `rich4-spec/tests/test_tortoise_card.py`（19/19）
 * 钉住的三条，这里各补一个：
 */
describe('★★ 烏龜卡：差分测试钉住的三条', () => {
  it('是**覆盖**不是累加（原版 `mov byte`，不是 `add byte`）', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, blocking: { ...ps[2]!.blocking, tortoiseWalking: 9 } });
    const r = applyTortoiseCard(ps, 0, { kind: 'player', index: 2 });
    expect(r.players[2]!.blocking.tortoiseWalking).toBe(TORTOISE_DAYS_OTHER);
    const mine = four();
    mine[1] = makePlayer({ index: 1, blocking: { ...mine[1]!.blocking, tortoiseWalking: 9 } });
    expect(applyTortoiseCard(mine, 1, { kind: 'player', index: 1 }).players[1]!.blocking.tortoiseWalking)
      .toBe(TORTOISE_DAYS_SELF);
  });

  it('★ 没选到目标（掩码 0）⇒ **卡不扣**：原版在 `remove_card` 之前就跳走', () => {
    // @source `0x44590b test edi,edi / je 0x4440e3` 在 `0x445920 push 0x1e …
    //   call 0x441343`（扣卡）**之前** ⇒ 空选择 = 卡还在手上。
    const ctx = {
      players: [makePlayer({ index: 0, cards: [30] }), makePlayer({ index: 1 })],
      lands: [], nodes: [], currentPlayer: 0, priceIndex: 1,
      tools: new Array<number>(60).fill(0), toolStock: new Array<number>(14).fill(0),
      objects: [], market: newStockMarket(0), marketOpen: true, facilities: [], actors: [],
    } as unknown as UseCardContext;
    const r = useCard(ctx, 30, { kind: 'none' });
    expect(r.ok).toBe(false);
    expect(r.players[0]!.cards).toEqual([30]); // ★ 还在手上
  });

  it('替身：写 `single_step = 3`（与"打别人"同为 3）', () => {
    const a = releaseNpc(1, 0, 0);
    expect(applyTortoiseCardToActor(a).singleStep).toBe(TORTOISE_DAYS_OTHER);
  });
});
