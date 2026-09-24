/*
 * WP-3「台词多样性」—— 台词阶梯里那几次 `rand()` 的确定性替身（`speech-coin.ts`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉住三件事：
 *   ① **分布**与原版一致：中间档二选一 ≈ 1/2、事件 18 ≈ 1/2、事件 17 ≈ 1/3（大量种子统计）；
 *   ② **纯读**：不动 `rngState`、只看进指纹的字段 ⇒ 旧回报重放指纹不变、各端一致；
 *   ③ **两台客户端说同一句**：单机现场（宿主按日推进注入种子）vs 回报重放 / 服务器镜像（从存档起点逐条重放），
 *      联机行动者 vs 旁观者 / 断线重连者（从服务器下发的起点快照逐条重放广播）——逐条 action 的台词全等；
 *      且整局里连续几次过路费不是「永远同一句」。
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decideAction,
  deserializeGame,
  makeGameState,
  makePlayer,
  newGame,
  parseMap,
  reduce,
  reduceWithSeed,
  replayTrail,
  serializeGame,
  stateFingerprint,
  type Action,
  type GameMode,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { NEWS_OWNER_RAND_SITE, SPEECH_RAND_MAX, SPEECH_RAND_SITE, speechCoin, speechRand } from './speech-coin.ts';
import { speechEventsFor } from './speech.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

/** 一串「看起来像真局面」的状态：rngState 走 Watcom LCG、回合 / 日期 / 现金都在变 */
function* syntheticStates(n: number): Generator<GameState> {
  const base = makeGameState({ players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i, cash: 30_000 })) });
  let r = 12345;
  for (let k = 0; k < n; k++) {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    const turnCount = Math.floor(k / 3);
    yield {
      ...base,
      rngState: r,
      turnCount,
      day: 1 + (turnCount % 28),
      month: 1 + (Math.floor(turnCount / 28) % 12),
      players: base.players.map((p, i) => ({ ...p, cash: 30_000 - ((k * 37 + i * 1000) % 20_000) })),
    };
  }
}

const ALL_SITES: readonly [string, number][] = [
  ...Object.entries(SPEECH_RAND_SITE),
  ...[...NEWS_OWNER_RAND_SITE].map(([id, va]) => [`news${id}`, va] as [string, number]),
];

describe('① 分布 —— 与原版 `rand()&1` / `rand()%3` 同分布', () => {
  it('值域 = Watcom `rand()` 的 0..0x7fff', () => {
    for (const s of syntheticStates(2000)) {
      const v = speechRand(s, s.turnCount % 4, SPEECH_RAND_SITE.pay);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SPEECH_RAND_MAX);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('★ 每个站点的二选一 ≈ 1/2（8000 个局面 × 4 个说话人）', () => {
    for (const [name, site] of ALL_SITES) {
      let ones = 0;
      let n = 0;
      for (const s of syntheticStates(8000)) {
        for (let p = 0; p < 4; p++) {
          ones += speechCoin(s, p, site);
          n++;
        }
      }
      const f = ones / n;
      expect(f, name).toBeGreaterThan(0.48);
      expect(f, name).toBeLessThan(0.52);
    }
  });

  it('★ 事件 17 的 `rand()%3 == 0` ≈ 1/3（@source 0x0044f67b `idiv 3` / 0x0044f68c `test edx,edx / jne`）', () => {
    let hit = 0;
    let n = 0;
    for (const s of syntheticStates(20_000)) {
      if (speechRand(s, s.currentPlayer, SPEECH_RAND_SITE.areaMonopoly) % 3 === 0) hit++;
      n++;
    }
    expect(hit / n).toBeGreaterThan(0.32);
    expect(hit / n).toBeLessThan(0.347);
  });

  it('★ 不同站点彼此独立（同一局面上 18 的闸与 9|10 的中间档不是同一枚硬币）', () => {
    let agree = 0;
    let n = 0;
    for (const s of syntheticStates(8000)) {
      if ((speechRand(s, 0, SPEECH_RAND_SITE.hostile) & 1) === speechCoin(s, 0, SPEECH_RAND_SITE.pay)) agree++;
      n++;
    }
    expect(agree / n).toBeGreaterThan(0.47);
    expect(agree / n).toBeLessThan(0.53);
  });
});

describe('② 纯读、只看进指纹的字段', () => {
  it('★ 不改 state（`rngState` 原样）、同输入同输出', () => {
    const s = makeGameState({ rngState: 0xdeadbeef, turnCount: 17 });
    const frozen = JSON.stringify(s);
    const a = speechRand(s, 1, SPEECH_RAND_SITE.gain);
    const b = speechRand(s, 1, SPEECH_RAND_SITE.gain);
    expect(a).toBe(b);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('★ 瞬态提示 / 非指纹字段不影响硬币（旁观端缺了哪条纯表现字段也说同一句）', () => {
    const s = makeGameState({ rngState: 99, turnCount: 3 });
    const v = speechRand(s, 0, SPEECH_RAND_SITE.pay);
    const noisy: GameState = {
      ...s,
      lastEvent: { kind: 'news', id: 21 },
      lastViewTarget: { x: 3, y: 4 },
      phase: 'settling',
      pending: null,
    };
    expect(speechRand(noisy, 0, SPEECH_RAND_SITE.pay)).toBe(v);
  });

  it('★ 指纹里的量一变就重掷（`rngState` / `turnCount` / 说话人现金 / 说话人 / 站点）', () => {
    const s = makeGameState({ rngState: 99, turnCount: 3 });
    const v = (x: GameState, p = 0, site: number = SPEECH_RAND_SITE.pay) => speechRand(x, p, site);
    const base = v(s);
    // 单个 15 位值撞上的概率 ≈ 3×10⁻⁵；五个变体都撞上几乎不可能 —— 这里要求全都不同
    const variants = [
      v({ ...s, rngState: 100 }),
      v({ ...s, turnCount: 4 }),
      v({ ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash - 1 } : p)) }),
      v(s, 1),
      v(s, 0, SPEECH_RAND_SITE.fine),
    ];
    for (const x of variants) expect(x).not.toBe(base);
  });

  it('★★ 硬币读到的每一个共享量都在 `stateFingerprint` 里 ⇒ 指纹一致的两端（服务器镜像 / 旁观者）必掷同一面', () => {
    const s = makeGameState({ rngState: 99, turnCount: 3 });
    const fp = stateFingerprint(s);
    const touched: GameState[] = [
      { ...s, rngState: s.rngState + 1 },
      { ...s, turnCount: s.turnCount + 1 },
      { ...s, day: s.day + 1 },
      { ...s, month: s.month + 1 },
      { ...s, year: s.year + 1 },
      { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash + 1 } : p)) },
    ];
    for (const t of touched) expect(stateFingerprint(t)).not.toBe(fp);
  });
});

// ============================================================
//  ③ 整局：两台客户端说同一句；连续过路费不是永远同一句
// ============================================================

type Map0 = ReturnType<typeof parseMap>;
const topoOf = (map: Map0): MapTopology => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

/** 一条 action 派生出来的台词，压成可比较的串（`玩家:事件`） */
function lineKeys(before: GameState, after: GameState, topo: MapTopology): string[] {
  return speechEventsFor(before, after, topo).map((e) => `${e.player}:${e.event}`);
}

interface Played {
  base: GameState;
  trail: { action: Action; seed: number }[];
  lines: string[][];
  finalFp: string;
}

/**
 * 「行动者」那一台：四个电脑自己打，逐条施加并当场算台词（= `main.ts` 的 `notifyApplied` → `playSoundFor`）。
 * 单机：日推进那一刻由宿主注入种子（`reduceWithSeed`，= `rng-host.ts` 的生产路径）；联机：策略不重播种。
 */
function play(map: Map0, mode: GameMode, seed: number, maxTurns: number): Played {
  const topo = topoOf(map);
  const base = newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: (i * 3 + seed) % 12, kind: 'computer' as const })), seed, mode });
  let state = base;
  let host = seed * 7919 + 1;
  const trail: Played['trail'] = [];
  const lines: string[][] = [];
  for (let step = 0; step < 60_000 && state.turnCount < maxTurns; step++) {
    const action = decideAction({ state, map });
    if (action === null) break;
    host = (Math.imul(host, 1664525) + 1013904223) >>> 0; // 宿主的「GetTickCount」
    const next = reduceWithSeed(state, action, topo, host & 0x7fffffff);
    if (next === state) break;
    trail.push({ action, seed: host & 0x7fffffff });
    lines.push(lineKeys(state, next, topo));
    state = next;
  }
  return { base, trail, lines, finalFp: stateFingerprint(state) };
}

describe('③ 两台客户端说同一句', () => {
  run('★★ 单机现场 vs 回报重放（`replayTrail`，= `tools/replay-report.ts` / 服务器镜像）：逐条 action 台词全等', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = topoOf(map);
    for (const seed of [3, 11]) {
      const live = play(map, 'single', seed, 60);
      expect(live.trail.length).toBeGreaterThan(200);
      // 回报里存的是序列化后的起点（`flight-recorder.ts`）
      const base = deserializeGame(serializeGame(live.base));
      const replayed: string[][] = [];
      const end = replayTrail(base, live.trail, topo, (_i, b, a) => replayed.push(lineKeys(b, a, topo)));
      expect(stateFingerprint(end)).toBe(live.finalFp);
      expect(replayed).toEqual(live.lines);
    }
  });

  run('★★ 联机：行动者 vs 旁观者（从起点快照重放广播）vs 断线重连（中途从头重放）—— 逐条台词全等', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = topoOf(map);
    const live = play(map, 'multiplayer', 5, 60);
    // 旁观者：服务器下发的起点（`hub.ts` 的 snapshot / 种子开局）→ 按广播逐条 `reduce`
    const snapshot = serializeGame(live.base);
    let viewer = deserializeGame(snapshot);
    const viewerLines: string[][] = [];
    for (const { action } of live.trail) {
      const next = reduce(viewer, action, topo);
      viewerLines.push(lineKeys(viewer, next, topo));
      viewer = next;
    }
    expect(stateFingerprint(viewer)).toBe(live.finalFp);
    expect(viewerLines).toEqual(live.lines);
    // 重连：拿同一份快照 + 已广播的前半段快进，再接着收后半段 —— 后半段台词与行动者一致
    const half = Math.floor(live.trail.length / 2);
    let rejoin = deserializeGame(snapshot);
    for (const { action } of live.trail.slice(0, half)) rejoin = reduce(rejoin, action, topo);
    const rejoinLines: string[][] = [];
    for (const { action } of live.trail.slice(half)) {
      const next = reduce(rejoin, action, topo);
      rejoinLines.push(lineKeys(rejoin, next, topo));
      rejoin = next;
    }
    expect(rejoinLines).toEqual(live.lines.slice(half));
  });

  run('★ 整局里中间档两句都说到、比例 ≈ 1:1，连续几次不会一直同一句（先前恒取前一句）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    // 只数「第二句只可能由硬币掷出来」的两对：進帳 6|7（`0x0044f3d1`）、付錢 9|10（`0x0044f4a7`）。
    //   0|1、3|4、12|13 还各有 core 交下来的固定事件号（點券格 / 命運 / 免收九种 13 …），混在一起数不准。
    const pairOf = (ev: number): number | null => (ev === 6 || ev === 9 ? ev : ev === 7 || ev === 10 ? ev - 1 : null);
    let firsts = 0;
    let seconds = 0;
    let pays: number[] = [];
    let longest = 0;
    for (const seed of [1, 2, 3, 4]) {
      for (const mode of ['single', 'multiplayer'] as const) {
        const g = play(map, mode, seed, 400);
        pays = [];
        for (const step of g.lines) {
          for (const k of step) {
            const ev = Number(k.split(':')[1]);
            if (pairOf(ev) === null) continue;
            if (ev === pairOf(ev)) firsts++;
            else seconds++;
            if (ev === 9 || ev === 10 || ev === 11 || ev === 18) pays.push(ev);
          }
        }
        // 连续付钱台词里「同一句」最长连了几次
        let run1 = 0;
        for (let i = 0; i < pays.length; i++) {
          run1 = i > 0 && pays[i] === pays[i - 1] ? run1 + 1 : 1;
          if (pays[i] !== 11) longest = Math.max(longest, run1);
        }
      }
    }
    expect(seconds).toBeGreaterThan(0);
    // 第一句还包括 ≥ 9000 那一档（不掷、恒前一句），故第二句占比应落在 (0, 1/2] 里、且是可观的一截
    //   （实测 4 种子 × 2 模式 × 400 回合：6/9 = 99、7/10 = 39；同一句最长连 8 次含 ≥9000 档）
    expect(firsts + seconds).toBeGreaterThan(60);
    expect(seconds / (firsts + seconds)).toBeGreaterThan(0.2);
    expect(seconds / (firsts + seconds)).toBeLessThan(0.55);
    expect(longest).toBeLessThan(12);
  });
});
