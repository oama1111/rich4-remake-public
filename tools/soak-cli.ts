/*
 * W-02：无头 soak 命令行 —— P0/P1 出口条件「4 AI × 1000 局无卡死」的取证工具
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法（与 `pnpm unpack` 同一套跑法，靠 Node 的 type stripping）：
 *
 *   pnpm soak
 *   # 等价于：
 *   node --experimental-strip-types tools/soak-cli.ts \
 *     --games 1000 --turns 300 --maps 0-7 --seed-base 1 --out .qa-tmp/soak.json
 *
 * ★ 循环体**照抄** `packages/core/src/state/soak.test.ts` 的 `soak()`：
 *   `decideAction({state, map})` → `reduce(state, action, topo)`，
 *   `next === state` 即判定卡死。这里**不另写一套**回合推进逻辑 ——
 *   两边的判据必须逐字一致，否则「测试绿」与「soak 绿」不是同一件事。
 *
 * ★ 与测试里那支的**唯一**差别（有意为之，已在 W-02 报告里写明）：
 *   本工具把 `globalMapId` 传成**真实地图号**（测试里没传、恒为 0）。
 *   理由：calendar / stock-market 两处规则读 `state.globalMapId`
 *   （`packages/core/src/places/calendar.ts:278`、`stock-market.ts:593`），
 *   逐图报告若不传真号，八张图的节日/行情行为全是地图 0 的。
 *
 * ★ 与测试同样**只测量、只报告**：本文件不修任何 bug（W-02 的验收口径）。
 *   失败种子交给 W-03 分诊。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { characterById } from '../packages/data/src/characters.ts';
import { decideAction } from '../packages/core/src/ai/policy.ts';
import { parseMap } from '../packages/core/src/loaders/map.ts';
import { newGame } from '../packages/core/src/rules/new-game.ts';
import { reduce } from '../packages/core/src/state/reduce.ts';
import { isAlive, type GameState } from '../packages/core/src/state/types.ts';
import type { Action } from '../packages/core/src/state/actions.ts';
import type { Rich4Map } from '../packages/core/src/loaders/map.ts';

/** 单局步数上限 —— 与 `soak.test.ts` 的 200_000 同一个数 */
const STEP_LIMIT = 200_000;
/** 角色总数（0..11）*/
const CHARACTER_COUNT = 12;
/** 地图张数（0..7，文件名 = globalMapId*2+1）*/
const MAP_COUNT = 8;

// ─────────────────────────────────────────────────────────────
//  命令行
// ─────────────────────────────────────────────────────────────

interface Options {
  games: number;
  turns: number;
  maps: number[];
  seedBase: number;
  out: string;
  report: string;
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const opts: Options = {
    games: 1000,
    turns: 300,
    maps: Array.from({ length: MAP_COUNT }, (_, i) => i),
    seedBase: 1,
    out: '.qa-tmp/soak.json',
    report: `docs/acceptance/soak-${today}.md`,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue; // 允许 `pnpm soak -- --games …` 这种写法
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const value = (): string => {
      if (inline !== null) return inline;
      const next = argv[++i];
      if (next === undefined) throw new Error(`${key} 缺参数`);
      return next;
    };
    switch (key) {
      case '--games': opts.games = Number(value()); break;
      case '--turns': opts.turns = Number(value()); break;
      case '--maps': opts.maps = parseMaps(value()); break;
      case '--seed-base': opts.seedBase = Number(value()); break;
      case '--out': opts.out = value(); break;
      case '--report': opts.report = value(); break;
      case '--quiet': opts.quiet = true; break;
      case '--help': case '-h':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`不认识的参数：${arg}（--help 看用法）`);
    }
  }
  if (!Number.isInteger(opts.games) || opts.games <= 0) throw new Error('--games 须为正整数');
  if (!Number.isInteger(opts.turns) || opts.turns <= 0) throw new Error('--turns 须为正整数');
  if (!Number.isInteger(opts.seedBase)) throw new Error('--seed-base 须为整数');
  if (opts.maps.length === 0) throw new Error('--maps 至少一张图');
  for (const m of opts.maps) {
    if (!Number.isInteger(m) || m < 0 || m >= MAP_COUNT) throw new Error(`地图号非法：${m}`);
  }
  return opts;
}

/** `0-7` / `0,3,5` / `2` 都认 */
function parseMaps(spec: string): number[] {
  const out = new Set<number>();
  for (const piece of spec.split(',')) {
    const part = piece.trim();
    if (part === '') continue;
    const dash = part.indexOf('-');
    if (dash === -1) {
      out.add(Number(part));
    } else {
      const from = Number(part.slice(0, dash));
      const to = Number(part.slice(dash + 1));
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`--maps 区间非法：${part}`);
      const step = from <= to ? 1 : -1;
      for (let m = from; step > 0 ? m <= to : m >= to; m += step) out.add(m);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const HELP = `用法：node --experimental-strip-types tools/soak-cli.ts [选项]

  --games <n>       局数（默认 1000）
  --turns <n>       每局回合上限（默认 300）
  --maps <spec>     地图号，支持 0-7 / 0,3,5（默认 0-7）
  --seed-base <n>   起始种子，第 g 局种子 = seed-base + g（默认 1）
  --out <path>      原始结果 JSON（默认 .qa-tmp/soak.json）
  --report <path>   汇总报告 Markdown（默认 docs/acceptance/soak-<日期>.md）
  --quiet           不打印逐局进度
`;

// ─────────────────────────────────────────────────────────────
//  单局
// ─────────────────────────────────────────────────────────────

/** 每名玩家的四维行为计数：买地 / 出卡 / 贷款 / 股票买卖 */
type FourDim = [number, number, number, number];

interface GameRecord {
  game: number;
  seed: number;
  mapId: number;
  characters: number[];
  /** 结束原因：maxTurns / gameOver / stuck / noAction / stepLimit / exception */
  endReason: string;
  /** 实际走到的回合数（state.turnCount）*/
  turns: number;
  steps: number;
  /** 赢家下标；未分胜负为 null */
  winner: number | null;
  victoryCode: number | null;
  phase: string;
  /** 卡死时的现场（endReason==='stuck'）*/
  stuck: { phase: string; action: string } | null;
  /** 异常（endReason==='exception'）*/
  error: { message: string; stack: string } | null;
  /** 不变量违规（每条一句，最多留 5 条）*/
  invariants: string[];
  /** 四名玩家各自的四维计数（下标 = 座位）*/
  counts: FourDim[];
  /** 结束时各座位身家（现金+存款+股票成本−贷款）——只作报告参考 */
  netWorth: number[];
}

interface GameOutcome {
  record: GameRecord;
  /** 该局是否「干净」：正常收束且无不变量违规 */
  clean: boolean;
}

const mapCache = new Map<number, Rich4Map>();

function workspaceRoot(): string {
  return process.env.RICH4_WORKSPACE ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function mapPathFor(mapId: number): string {
  const name = String(mapId * 2 + 1).padStart(4, '0');
  return `${workspaceRoot()}/extracted/map/${name}.bin`;
}

function loadMap(mapId: number): Rich4Map {
  const cached = mapCache.get(mapId);
  if (cached !== undefined) return cached;
  const path = mapPathFor(mapId);
  if (!existsSync(path)) {
    throw new Error(
      `找不到地图文件 ${path}\n` +
        `真值素材的路径一律从 RICH4_WORKSPACE 起算（默认 = 本仓库的上一级目录）；\n` +
        `请确认 ../extracted/map/ 存在，或设置 RICH4_WORKSPACE。`,
    );
  }
  const map = parseMap(new Uint8Array(readFileSync(path)));
  mapCache.set(mapId, map);
  return map;
}

/** 角色组合按种子轮换：第 g 局的四席 = (g, g+1, g+2, g+3) mod 12 ⇒ 12 局一循环、12 个角色各上场 4 次 */
function charactersFor(game: number): number[] {
  return [0, 1, 2, 3].map((k) => (game + k) % CHARACTER_COUNT);
}

/** 该 action 属于四维里的哪几维（返回要 +1 的下标；没有就不加）*/
function dimsOf(action: Action): number[] {
  switch (action.type) {
    case 'buyLand': return [0];
    case 'useCard': return [1];
    case 'bank': return action.op === 'borrow' ? [2] : [];
    case 'buyStock':
    case 'sellStock':
    case 'buyShares': return [3];
    default: return [];
  }
}

function runGame(opts: Options, game: number): GameOutcome {
  const seed = opts.seedBase + game;
  const mapId = opts.maps[game % opts.maps.length]!;
  const characters = charactersFor(game);
  const map = loadMap(mapId);
  // ★ topo 四项缺一不可 —— soak.test.ts 顶部记过：只传 nodes/lands 时
  //   規則里缺 facilities/commercials 会**静默不结算**（设施/企业两条路整场考不到）。
  const topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
    landscapes: map.landscapes,
  };

  const counts: FourDim[] = [0, 0, 0, 0].map(() => [0, 0, 0, 0]);
  const invariants: string[] = [];
  const noteInvariant = (msg: string): void => {
    if (invariants.length < 5 && !invariants.includes(msg)) invariants.push(msg);
  };

  let state: GameState;
  try {
    state = newGame({
      map,
      players: characters.map((character) => ({ character, kind: 'computer' as const })),
      seed,
      globalMapId: mapId,
    });
  } catch (err) {
    return {
      clean: false,
      record: {
        game, seed, mapId, characters,
        endReason: 'exception', turns: 0, steps: 0, winner: null, victoryCode: null,
        phase: 'newGame', stuck: null,
        error: { message: String((err as Error)?.message ?? err), stack: String((err as Error)?.stack ?? '') },
        invariants, counts, netWorth: [],
      },
    };
  }

  const playerCount = state.players.length;
  let lastTurnCount = state.turnCount;
  let steps = 0;
  let endReason = 'stepLimit';
  let stuck: GameRecord['stuck'] = null;
  let error: GameRecord['error'] = null;

  try {
    for (; steps < STEP_LIMIT; steps++) {
      const actor = state.currentPlayer;
      const action = decideAction({ state, map });
      if (action === null) {
        endReason = state.phase === 'gameOver' ? 'gameOver' : 'noAction';
        break;
      }
      const next = reduce(state, action, topo);
      if (next === state) {
        // ★ 与 soak.test.ts 同一个判据：同一个 action 派下去状态原样返回 = 卡死
        endReason = 'stuck';
        stuck = { phase: state.phase, action: action.type };
        break;
      }
      // ── 廉价不变量（每步都查）────────────────────────────
      if (next.players.length !== playerCount) {
        noteInvariant(`players.length ${playerCount} → ${next.players.length}`);
      }
      if (next.turnCount < lastTurnCount) {
        noteInvariant(`turnCount 回退：${lastTurnCount} → ${next.turnCount}`);
      }
      for (const p of next.players) {
        if (!Number.isInteger(p.cash)) noteInvariant(`玩家 ${p.index} cash 非整数：${p.cash}`);
        if (!Number.isInteger(p.moneyInBank)) noteInvariant(`玩家 ${p.index} 存款非整数：${p.moneyInBank}`);
        if (!Number.isInteger(p.loan)) noteInvariant(`玩家 ${p.index} 贷款非整数：${p.loan}`);
        if (!Number.isFinite(p.cash + p.moneyInBank + p.loan)) {
          noteInvariant(`玩家 ${p.index} 金额出现 NaN/Infinity`);
        }
      }
      // ── 四维行为计数 ─────────────────────────────────────
      if (actor >= 0 && actor < counts.length) {
        for (const dim of dimsOf(action)) counts[actor]![dim]++;
      }
      state = next;
      lastTurnCount = state.turnCount;
      if (state.phase === 'gameOver') {
        endReason = 'gameOver';
        break;
      }
      if (state.turnCount >= opts.turns) {
        endReason = 'maxTurns';
        break;
      }
    }
    if (steps >= STEP_LIMIT) endReason = 'stepLimit';
  } catch (err) {
    endReason = 'exception';
    error = {
      message: String((err as Error)?.message ?? err),
      stack: String((err as Error)?.stack ?? ''),
    };
  }

  const winner =
    state.victory !== null
      ? state.victory.winner
      : state.phase === 'gameOver'
        ? state.players.find((p) => isAlive(p))?.index ?? null
        : null;

  const record: GameRecord = {
    game,
    seed,
    mapId,
    characters,
    endReason,
    turns: state.turnCount,
    steps,
    winner,
    victoryCode: state.victory?.code ?? null,
    phase: state.phase,
    stuck,
    error,
    invariants,
    counts,
    netWorth: state.players.map((p) => p.cash + p.moneyInBank - p.loan),
  };

  return {
    record,
    clean: invariants.length === 0 && (endReason === 'maxTurns' || endReason === 'gameOver'),
  };
}

// ─────────────────────────────────────────────────────────────
//  汇总
// ─────────────────────────────────────────────────────────────

interface Summary {
  generatedAt: string;
  node: string;
  workspace: string;
  options: { games: number; turns: number; maps: number[]; seedBase: number };
  totals: {
    games: number;
    clean: number;
    stuck: number;
    exception: number;
    stepLimit: number;
    noAction: number;
    maxTurns: number;
    gameOver: number;
    invariantViolations: number;
    /** 完赛率 = (maxTurns + gameOver) / games */
    completionRate: number;
  };
  byMap: {
    mapId: number;
    games: number;
    clean: number;
    completed: number;
    stuck: number;
    exception: number;
    stepLimit: number;
    avgTurns: number;
    completionRate: number;
  }[];
  byCharacter: {
    character: number;
    name: string;
    games: number;
    buyLand: number;
    useCard: number;
    borrow: number;
    stockTrade: number;
  }[];
  totalsByDimension: { buyLand: number; useCard: number; borrow: number; stockTrade: number };
  failingSeeds: { seed: number; mapId: number; endReason: string; detail: string }[];
  cleanSeeds: number[];
  records: GameRecord[];
}

function average(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function summarize(records: readonly GameOutcome[], opts: Options): Summary {
  const all = records.map((r) => r.record);
  const byReason = (reason: string): number => all.filter((r) => r.endReason === reason).length;
  const completed = all.filter((r) => r.endReason === 'maxTurns' || r.endReason === 'gameOver');

  const byMap = opts.maps.map((mapId) => {
    const rows = all.filter((r) => r.mapId === mapId);
    const done = rows.filter((r) => r.endReason === 'maxTurns' || r.endReason === 'gameOver');
    return {
      mapId,
      games: rows.length,
      clean: records.filter((o) => o.record.mapId === mapId && o.clean).length,
      completed: done.length,
      stuck: rows.filter((r) => r.endReason === 'stuck').length,
      exception: rows.filter((r) => r.endReason === 'exception').length,
      stepLimit: rows.filter((r) => r.endReason === 'stepLimit').length,
      avgTurns: round2(average(rows.map((r) => r.turns))),
      completionRate: rows.length === 0 ? 0 : round2(done.length / rows.length),
    };
  });

  const byCharacter = Array.from({ length: CHARACTER_COUNT }, (_, character) => {
    const dims: FourDim = [0, 0, 0, 0];
    let games = 0;
    for (const r of all) {
      const seat = r.characters.indexOf(character);
      if (seat === -1) continue;
      games++;
      const c = r.counts[seat]!;
      dims[0] += c[0];
      dims[1] += c[1];
      dims[2] += c[2];
      dims[3] += c[3];
    }
    const name = characterById(character)?.name ?? `#${character}`;
    return {
      character,
      name,
      games,
      buyLand: round2(games === 0 ? 0 : dims[0] / games),
      useCard: round2(games === 0 ? 0 : dims[1] / games),
      borrow: round2(games === 0 ? 0 : dims[2] / games),
      stockTrade: round2(games === 0 ? 0 : dims[3] / games),
    };
  });

  const dimTotals = { buyLand: 0, useCard: 0, borrow: 0, stockTrade: 0 };
  for (const r of all) {
    for (const c of r.counts) {
      dimTotals.buyLand += c[0];
      dimTotals.useCard += c[1];
      dimTotals.borrow += c[2];
      dimTotals.stockTrade += c[3];
    }
  }

  const failingSeeds = records
    .filter((o) => !o.clean)
    .map((o) => ({
      seed: o.record.seed,
      mapId: o.record.mapId,
      endReason: o.record.endReason,
      detail:
        o.record.stuck !== null
          ? `卡死于 ${o.record.stuck.phase} / ${o.record.stuck.action}`
          : o.record.error !== null
            ? o.record.error.message
            : o.record.invariants.length > 0
              ? o.record.invariants.join('；')
              : o.record.endReason,
    }));

  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    workspace: workspaceRoot(),
    options: { games: opts.games, turns: opts.turns, maps: opts.maps, seedBase: opts.seedBase },
    totals: {
      games: all.length,
      clean: records.filter((o) => o.clean).length,
      stuck: byReason('stuck'),
      exception: byReason('exception'),
      stepLimit: byReason('stepLimit'),
      noAction: byReason('noAction'),
      maxTurns: byReason('maxTurns'),
      gameOver: byReason('gameOver'),
      invariantViolations: all.filter((r) => r.invariants.length > 0).length,
      completionRate: all.length === 0 ? 0 : round2(completed.length / all.length),
    },
    byMap,
    byCharacter,
    totalsByDimension: dimTotals,
    failingSeeds,
    cleanSeeds: records.filter((o) => o.clean).map((o) => o.record.seed),
    records: all,
  };
}

function mapsSpec(maps: readonly number[]): string {
  const contiguous = maps.every((m, i) => i === 0 || m === maps[i - 1]! + 1);
  return contiguous ? `${maps[0]}-${maps[maps.length - 1]}` : maps.join(',');
}

function markdown(summary: Summary, command: string, outPath: string): string {
  const t = summary.totals;
  const lines: string[] = [];
  lines.push(`# 无头 soak 报告（W-02）— ${summary.generatedAt.slice(0, 10)}`);
  lines.push('');
  lines.push('> 工具：`tools/soak-cli.ts`（循环体照抄 `packages/core/src/state/soak.test.ts` 的 `soak()`：');
  lines.push('> `decideAction` → `reduce`，`next === state` 即判卡死）。**本任务只报告，不修 bug。**');
  lines.push('');
  lines.push('## 运行参数');
  lines.push('');
  lines.push('```bash');
  lines.push(command);
  lines.push('```');
  lines.push('');
  lines.push(`- Node：\`${summary.node}\``);
  lines.push(`- RICH4_WORKSPACE：\`${summary.workspace}\``);
  lines.push(`- 局数 ${summary.options.games} · 回合上限 ${summary.options.turns} · 地图 [${summary.options.maps.join(', ')}] · 起始种子 ${summary.options.seedBase}`);
  lines.push('- 角色组合按种子轮换：第 g 局 = `(g, g+1, g+2, g+3) mod 12` ⇒ 12 局一循环、12 个角色各上场 4 次。');
  lines.push('- 与测试那支的唯一差别：本工具把 `globalMapId` 传成真实地图号（测试里恒 0）——');
  lines.push('  `places/calendar.ts` / `places/stock-market.ts` 会读它，逐图报告必须用真号。');
  lines.push('');
  lines.push('## 总表');
  lines.push('');
  lines.push('| 指标 | 数量 |');
  lines.push('|---|---|');
  lines.push(`| 总局数 | ${t.games} |`);
  lines.push(`| **干净局**（正常收束且无不变量违规） | **${t.clean}** |`);
  lines.push(`| 卡死 | ${t.stuck} |`);
  lines.push(`| 异常 | ${t.exception} |`);
  lines.push(`| 撞 200,000 步上限 | ${t.stepLimit} |`);
  lines.push(`| decideAction 返回 null 且未终局 | ${t.noAction} |`);
  lines.push(`| 走满回合上限 | ${t.maxTurns} |`);
  lines.push(`| 提前终局（胜负判定/破产） | ${t.gameOver} |`);
  lines.push(`| 有不变量违规的局 | ${t.invariantViolations} |`);
  lines.push(`| **完赛率**（走满上限 + 提前终局）/ 总局数 | **${(t.completionRate * 100).toFixed(2)}%** |`);
  lines.push('');
  lines.push('## 逐图');
  lines.push('');
  lines.push('| 地图 | 局数 | 干净 | 完赛 | 完赛率 | 卡死 | 异常 | 超步数 | 平均回合 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const m of summary.byMap) {
    lines.push(
      `| ${m.mapId} | ${m.games} | ${m.clean} | ${m.completed} | ${(m.completionRate * 100).toFixed(2)}% | ${m.stuck} | ${m.exception} | ${m.stepLimit} | ${m.avgTurns} |`,
    );
  }
  lines.push('');
  lines.push('## 12 角色 × 四维行为（每局均值）');
  lines.push('');
  lines.push('| 角色 | 上场局数 | 买地 | 出卡 | 贷款 | 股票买卖 |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of summary.byCharacter) {
    lines.push(`| ${c.character} ${c.name} | ${c.games} | ${c.buyLand} | ${c.useCard} | ${c.borrow} | ${c.stockTrade} |`);
  }
  lines.push('');
  lines.push(
    `四维总计：买地 ${summary.totalsByDimension.buyLand} · 出卡 ${summary.totalsByDimension.useCard} · ` +
      `贷款 ${summary.totalsByDimension.borrow} · 股票买卖 ${summary.totalsByDimension.stockTrade}`,
  );
  lines.push('');
  lines.push('四维口径（都按**行动者** `state.currentPlayer` 记账）：买地 = `buyLand`；出卡 = `useCard`；');
  lines.push('贷款 = `bank{op:\'borrow\'}`（特別融資 `financeBorrow` 不算，那是另一笔账）；');
  lines.push('股票买卖 = `buyStock` + `sellStock` + `buyShares`（落点买企业股份那条也算股市交易）。');
  lines.push('');
  lines.push('## 全部失败种子');
  lines.push('');
  if (summary.failingSeeds.length === 0) {
    lines.push('无 —— 全部干净。');
  } else {
    lines.push('| 种子 | 地图 | 结束原因 | 现场 |');
    lines.push('|---|---|---|---|');
    for (const f of summary.failingSeeds) {
      lines.push(`| ${f.seed} | ${f.mapId} | ${f.endReason} | ${f.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
  }
  lines.push('');
  lines.push('## 复现');
  lines.push('');
  lines.push('```bash');
  lines.push(`python3 - <<'PY'`);
  lines.push(`import json; d = json.load(open("${outPath}")); print(d["totals"])`);
  lines.push('PY');
  lines.push('```');
  lines.push('');
  lines.push(`报告里的数字全部由 \`${outPath}\` 现算，两者必须一致。`);
  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
//  主流程
// ─────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const outcomes: GameOutcome[] = [];
  for (let g = 0; g < opts.games; g++) {
    const outcome = runGame(opts, g);
    outcomes.push(outcome);
    if (!opts.quiet && (g % 25 === 0 || g === opts.games - 1)) {
      const done = outcomes.filter((o) => o.clean).length;
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(
        `\r第 ${g + 1}/${opts.games} 局 · 干净 ${done} · 失败 ${g + 1 - done} · ${elapsed}s   `,
      );
    }
  }
  if (!opts.quiet) process.stdout.write('\n');

  const summary = summarize(outcomes, opts);
  const outPath = resolve(opts.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  if (opts.report !== '') {
    const reportPath = resolve(opts.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    const command =
      `pnpm soak   # node --experimental-strip-types tools/soak-cli.ts ` +
      `--games ${opts.games} --turns ${opts.turns} --maps ${mapsSpec(opts.maps)} ` +
      `--seed-base ${opts.seedBase} --out ${opts.out}`;
    writeFileSync(reportPath, markdown(summary, command, opts.out), 'utf8');
    console.log(`报告：${reportPath}`);
  }
  console.log(`原始结果：${outPath}`);
  console.log(
    `总 ${summary.totals.games} 局 · 干净 ${summary.totals.clean} · 卡死 ${summary.totals.stuck} · ` +
      `异常 ${summary.totals.exception} · 超步数 ${summary.totals.stepLimit} · 完赛率 ${(summary.totals.completionRate * 100).toFixed(2)}%`,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`用时 ${seconds}s`);
  process.exitCode = summary.failingSeeds.length === 0 ? 0 : 1;
}

main();
