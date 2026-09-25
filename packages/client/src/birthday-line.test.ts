/*
 * 命運 5「今天是你生日 向每人收取一張卡片」—— 收完之后寿星那一句（事件 0 | 1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `fcn_0044c3b7`：循环收完（`edi` = 问过几个合格的人）→ `0x0044c57b test edi,edi / je 返回` →
 *   `0x0044c5ad call rand / and eax,1` → `0x0044c5c5 player_say(当前玩家, 0, 表[0x48084a + eax*4])`。
 *
 * 钉住：
 *   ① 真人寿星：选牌窗逐个问，**最后一位答完**那一条才说（取消也算问过）；中途不说；
 *   ② 电脑寿星：抽到那一条当场收完就说，排在每一扇「搶得」框（`card.robbed`，`stage` 档）之后；
 *   ③ 一个合格的人都没有 ⇒ 不说；
 *   ④ 硬币（站点 0x0044c5ad）两面都会出现；
 *   ⑤ 单机现场 vs 回报重放、联机行动者 vs 旁观者 —— 同一条 action 上同一句。
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SPECIAL_KIND,
  deserializeGame,
  landAll,
  newGame,
  parseMap,
  reduce,
  replayTrail,
  serializeGame,
  stateFingerprint,
  topoOf,
  type Action,
  type GameMode,
  type GameState,
} from '@rich4/core';
import { boxRank, lineRank, noticeTier } from './presentation-order.ts';
import { SPEECH_RAND_SITE, speechCoin, speechRand } from './speech-roll.ts';
import { DETECTORS, detectBirthdayLine, speechEventsFor } from './speech.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

/** 寿星 0 号（真人 / 电脑）、1/2 号有牌、3 号出局；牌堆拨到「下一张就是 5」，人站在命運格上待结算 */
function scene(opts: { mode?: GameMode; drawer?: 'human' | 'computer'; seed?: number; noCards?: boolean } = {}) {
  const map = loadMap();
  const topo = topoOf(map);
  const base = landAll(
    newGame({
      map,
      players: [
        { character: 0, kind: opts.drawer === 'computer' ? 'computer' : 'human' },
        { character: 1, kind: 'computer' },
        { character: 2, kind: 'computer' },
        { character: 3, kind: 'computer' },
      ],
      seed: opts.seed ?? 11,
      mode: opts.mode ?? 'single',
    }),
    map.nodes,
  );
  const node = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.FORTUNE);
  if (node === undefined) throw new Error('地图 0 没有命運格');
  const cards = (c: number[]) => (opts.noCards === true ? [] : c);
  const s: GameState = {
    ...base,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    players: base.players.map((p, i) =>
      i === 0
        ? { ...p, nodeId: node.id, ...(opts.drawer === 'computer' ? { whoPlays: 2 } : {}) }
        : i === 1
          ? { ...p, cards: cards([3, 7]) }
          : i === 2
            ? { ...p, cards: cards([9]) }
            : { ...p, whoPlays: 0, cards: [11] },
    ),
    fortuneDeck: { order: [5, ...base.fortuneDeck.order.filter((x) => x !== 5)], cursor: 0 },
  };
  return { map, topo, s };
}

const keys = (b: GameState, a: GameState, topo: ReturnType<typeof topoOf>) =>
  speechEventsFor(b, a, topo)
    .filter((e) => e.event === 0 || e.event === 1)
    .map((e) => ({ player: e.player, event: e.event, order: e.order }));

describe('★ 命運 5 生日收卡之后寿星那一句（`0x0044c5c5`）', () => {
  it('登记在 DETECTORS 里、次序 `afterStage`、站点 = 0x0044c5ad', () => {
    const d = DETECTORS.find((x) => x.name === 'birthdayLine');
    expect(d?.order).toBe('afterStage');
    expect(d?.source).toContain(0x0044c5ad);
    expect(SPEECH_RAND_SITE.birthday).toBe(0x0044c5ad);
  });

  run('★★ ① 真人寿星：抽到那一条不说、答了第一位不说，**最后一位答完**才说 0|1', () => {
    const { topo, s } = scene();
    const s1 = reduce(s, { type: 'settle' }, topo);
    expect(s1.pending?.kind).toBe('birthdayCard');
    expect(detectBirthdayLine(s, s1)).toEqual([]);
    const s2 = reduce(s1, { type: 'birthdayCard', seat: 1, cardId: 7 }, topo);
    expect(s2.pending?.kind).toBe('birthdayCard');
    expect(detectBirthdayLine(s1, s2)).toEqual([]);
    const s3 = reduce(s2, { type: 'birthdayCard', seat: 2, cardId: 9 }, topo);
    expect(s3.pending).toBeNull();
    // ★ FU-1：那一次 `rand()`（`0x0044c5ad`）由 core 在最后一位答完时掷
    expect(speechRand(s2, s3, 0, SPEECH_RAND_SITE.birthday)).not.toBeNull();
    const coin = speechCoin(s2, s3, 0, SPEECH_RAND_SITE.birthday);
    expect(detectBirthdayLine(s2, s3)).toEqual([{ player: 0, event: coin, expression: 0 }]);
    expect(keys(s2, s3, topo)).toEqual([{ player: 0, event: coin, order: 'afterStage' }]);
  });

  run('★ 真人两位都取消（右键，`cardId = 0`）⇒ 照样说（`0x0044c573 mov edi, ebp` 不看 `0x44192a` 的返回值）', () => {
    const { topo, s } = scene();
    let st = reduce(s, { type: 'settle' }, topo);
    st = reduce(st, { type: 'birthdayCard', seat: 1, cardId: 0 }, topo);
    const before = st;
    st = reduce(st, { type: 'birthdayCard', seat: 2, cardId: 0 }, topo);
    expect(st.players[0]!.cards).toEqual([]);
    expect(detectBirthdayLine(before, st)).toHaveLength(1);
  });

  // ★★ 2026-09-24（provenance 审计）订正：电脑寿星那一支**没有**「搶得」框（`0x0044c46d call 0x441e77` →
  //   `0x0044c47e call 0x4412e4` → `jmp 0x44c573`），先前那扇是借了搶奪卡 `0x00441ab1` 的出处。
  run('★★ ② 电脑寿星：抽到那一条当场收完就说（不弹「搶得」框）', () => {
    const { topo, s } = scene({ drawer: 'computer' });
    const s1 = reduce(s, { type: 'settle' }, topo);
    expect(s1.pending?.kind).not.toBe('birthdayCard');
    expect(s1.notices.filter((n) => n.key === 'card.robbed')).toHaveLength(0);
    expect(speechRand(s, s1, 0, SPEECH_RAND_SITE.birthday)).not.toBeNull();
    const coin = speechCoin(s, s1, 0, SPEECH_RAND_SITE.birthday);
    expect(detectBirthdayLine(s, s1)).toEqual([{ player: 0, event: coin, expression: 0 }]);
    // 框（`stage` 档）先、台词（`afterStage`）后 —— 同一把尺子（`presentation-order.ts`）
    expect(lineRank('afterStage')).toBeGreaterThan(boxRank(noticeTier('card.robbed')));
    // 下一条 action 不再重说（`lastEvent` 不是瞬态字段，判据看引用）
    const s2 = reduce(s1, { type: 'endTurn' }, topo);
    if (s2 !== s1) expect(detectBirthdayLine(s1, s2)).toEqual([]);
  });

  run('★ ③ 一个合格的人都没有（别人都没牌）⇒ 不说（`0x0044c57d je 0x44c5cd`）—— 真人 / 电脑两支', () => {
    for (const drawer of ['human', 'computer'] as const) {
      const { topo, s } = scene({ drawer, noCards: true });
      const s1 = reduce(s, { type: 'settle' }, topo);
      expect(s1.lastEvent).toEqual({ kind: 'fortune', id: 5 });
      expect(s1.pending?.kind).not.toBe('birthdayCard');
      expect(detectBirthdayLine(s, s1)).toEqual([]);
    }
  });

  run('★ ④ 硬币两面都出现（换种子 ⇒ 换局面）', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const { topo, s } = scene({ drawer: 'computer', seed });
      const s1 = reduce(s, { type: 'settle' }, topo);
      for (const e of detectBirthdayLine(s, s1)) seen.add(e.event);
    }
    expect([...seen].sort()).toEqual([0, 1]);
  });
});

describe('★★ ⑤ 两台客户端说同一句', () => {
  /** 行动者那一台：settle + 真人逐个答（电脑寿星就只有 settle） */
  function actorRun(mode: GameMode, drawer: 'human' | 'computer') {
    const { topo, s } = scene({ mode, drawer });
    const actions: Action[] =
      drawer === 'human'
        ? [{ type: 'settle' }, { type: 'birthdayCard', seat: 1, cardId: 3 }, { type: 'birthdayCard', seat: 2, cardId: 9 }]
        : [{ type: 'settle' }];
    let st = s;
    const lines: ReturnType<typeof keys>[] = [];
    for (const a of actions) {
      const next = reduce(st, a, topo);
      expect(next).not.toBe(st);
      lines.push(keys(st, next, topo));
      st = next;
    }
    return { topo, base: s, actions, lines, fp: stateFingerprint(st) };
  }

  for (const drawer of ['human', 'computer'] as const) {
    run(`联机（${drawer === 'human' ? '真人' : '电脑'}寿星）：行动者 vs 旁观者（服务器下发的快照 + 广播逐条重放）`, () => {
      const live = actorRun('multiplayer', drawer);
      let viewer = deserializeGame(serializeGame(live.base));
      const got: ReturnType<typeof keys>[] = [];
      for (const a of live.actions) {
        const next = reduce(viewer, a, live.topo);
        got.push(keys(viewer, next, live.topo));
        viewer = next;
      }
      expect(stateFingerprint(viewer)).toBe(live.fp);
      expect(got).toEqual(live.lines);
      // 那一句恰好一次、在最后一条
      expect(live.lines.flat()).toHaveLength(1);
      expect(live.lines[live.lines.length - 1]).toHaveLength(1);
    });

    run(`单机（${drawer === 'human' ? '真人' : '电脑'}寿星）：现场 vs 回报重放（\`replayTrail\`）`, () => {
      const live = actorRun('single', drawer);
      const got: ReturnType<typeof keys>[] = [];
      const end = replayTrail(
        deserializeGame(serializeGame(live.base)),
        live.actions.map((action) => ({ action, seed: 1234 })),
        live.topo,
        (_i, b, a) => got.push(keys(b, a, live.topo)),
      );
      expect(stateFingerprint(end)).toBe(live.fp);
      expect(got).toEqual(live.lines);
      expect(live.lines.flat()).toHaveLength(1);
    });
  }
});
