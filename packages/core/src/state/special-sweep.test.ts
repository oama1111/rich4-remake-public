/*
 * 全特殊格落点扫描 —— 每一种 `SPECIAL_KIND` 落到上面都不许「静默无事发生」。
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 为什么要有这一条：`reduce` 的落点分支对特殊格是「17 路跳表 → 要么进交互、
 * 要么即时结算走人」。漏掉某一格时的表现是**什么都不发生**（phase 原地不动、
 * 也没有 pending）—— 那种 bug 不会报错、单测也不红，只有玩到那一格才发现。
 * 这里把 17 种一次性扫完，断言不变量：
 *
 *   1. 不抛（任何 kind 都不得让 reduce 崩）；
 *   2. **要么给出一件待决交互，要么把 phase 推走**（绝不停在 settling）；
 *   3. 给出的交互不许是 `unimplemented`（当前 17 种全部已实现，
 *      `PLACE_NAMES` 是空表 —— 真出现说明有规则退场了）。
 *
 * 注释里的 `@source` 与各格的具体规则见 `rules/interaction.ts`。
 */
import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { initialCardAmounts } from '../rules/new-game.ts';
import { initialToolStock } from '../rules/tools.ts';
import { TRAFFIC_WALK } from '../rules/tool-effects.ts';
import { reduce } from './reduce.ts';

const KINDS = Object.entries(SPECIAL_KIND) as readonly (readonly [string, number])[];

function landed(kind: number) {
  const node = makeNode({
    id: 1,
    adjacent: [1],
    flags: kind,
    specialKind: kind,
    ref: { kind: 'special' },
  });
  const topo = { nodes: [node] };
  const s = makeGameState({
    phase: 'settling',
    // 樂透/百貨/魔法屋要抽牌堆与库存，空表会「抽不出东西」而看起来像没实现
    cardAmount: initialCardAmounts(),
    toolStock: initialToolStock(),
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, trafficMethod: TRAFFIC_WALK, points: 0 }),
    ),
  });
  return { after: reduce(s, { type: 'settle' }, topo), node };
}

describe('★ 全特殊格落点扫描（静默无事发生 = bug）', () => {
  for (const [name, kind] of KINDS) {
    it(`${name}（${kind}）：不抛，且给交互或把 phase 推走`, () => {
      const { after } = landed(kind);
      const pushed = after.phase !== 'settling';
      const interactive = after.pending !== null;
      expect(
        interactive || pushed,
        `${name} 落点既没有交互、也没有推走 phase —— 这就是「静默无事发生」`,
      ).toBe(true);
      if (after.pending !== null) {
        expect(after.pending.kind, `${name} 不该落到 unimplemented`).not.toBe('unimplemented');
      }
    });
  }

  it('★ 17 种特殊格全部在扫描范围内（枚举加了新格别忘了这里）', () => {
    // NONE 之外的每一种都必须在 KINDS 里
    expect(KINDS.length).toBeGreaterThanOrEqual(17);
  });
});
