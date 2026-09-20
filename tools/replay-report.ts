/*
 * 重放一份问题回报（F9 / 自动落的 `rich4-report-*.json`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   node --experimental-strip-types tools/replay-report.ts <report.json> [--until N] [--shot out.png] [--trace]
 *
 * 做三件事：
 *   1) 从回报里的起点快照逐条重放轨迹，核对终点指纹是否与回报里记的**逐字节相等**
 *      —— 相等 = 现场已完整复现，可以放心在这条轨迹上二分 / 加断言写回归；
 *      不等 = 有一条状态改写绕过了记录漏斗（先修那个，再谈别的）。
 *   2) `--trace`：逐条打印 action 与 phase / 当前玩家 / 待决交互的变化。
 *   3) `--shot`：把回报里内嵌的截图另存成 PNG，直接看「当时屏上是什么」。
 *
 * ★ `devPatched: true` 的回报**直接拒绝验指纹**（W-53）：那是开发用注入口
 *   `__rich4.debug.patch` 改过状态之后落的报告，`base` + `trail` 本来就不再是
 *   这个状态的来源，重放必然对不上 —— 报「指纹不一致」会把人引向错误的方向。
 *   这类报告仍然照常打印错误、截图，只是**不做**那个核对。
 *
 * 写回归时：`--until N` 停在第 N 条之前，把那一刻的状态当 fixture。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MkfArchive } from '../packages/assets-pipeline/src/mkf.ts';
import { parseMap } from '../packages/core/src/loaders/map.ts';
import { deserializeGame } from '../packages/core/src/loaders/savegame.ts';
import { stateFingerprint } from '../packages/core/src/net/protocol.ts';
import { replayTrail } from '../packages/core/src/rng/host-reseed.ts';
import type { Action } from '../packages/core/src/state/actions.ts';

interface Report {
  version: number;
  createdAt: string;
  note: string;
  reason: string;
  /** 状态被 `__rich4.debug.patch` 改过（W-53）；老报告里没有这一项 */
  devPatched?: boolean;
  env: Record<string, unknown>;
  base: string;
  baseTurn: number;
  trail: { t: number; action: Action; seed: number }[];
  finalState: string;
  finalFingerprint: string;
  errors: { t: number; kind: string; message: string; stack: string | null }[];
  screenshot: string | null;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (file === undefined) {
  console.error('用法：replay-report.ts <report.json> [--until N] [--shot out.png] [--trace]');
  process.exit(2);
}
const opt = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};

const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
if (report.version !== 1) {
  console.error(`不认识的回报版本：${report.version}`);
  process.exit(2);
}

const base = deserializeGame(report.base);
const mapFile = fileURLToPath(new URL('../assets/game/map.mkf', import.meta.url));
const map = parseMap(new MkfArchive(new Uint8Array(readFileSync(mapFile))).read(base.globalMapId * 2 + 1));
// ★ 与 client/main.ts、server/room.ts 的 topo 逐项一致
const topo = {
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
};

const until = opt('until');
const trail = until === null ? report.trail : report.trail.slice(0, Number(until));
const trace = args.includes('--trace');

/** 状态被注入口改过 ⇒ 指纹核对根本不成立，见文件头 */
const devPatched = report.devPatched === true;

console.log(`回报：${report.createdAt}  原因=${report.reason}  备注=${report.note || '（无）'}`);
console.log(`环境：${String(report.env.desktop) === 'true' ? '桌面版' : '浏览器'}  screen=${String(report.env.screen)}  ${String(report.env.userAgent).slice(0, 80)}`);
if (devPatched) console.log('★ 开发注入口：这份报告的状态被 `__rich4.debug.patch` 改过（`[dev] state patched`）');
console.log(`起点：第 ${report.baseTurn} 回合；轨迹 ${report.trail.length} 条${until === null ? '' : `（只放前 ${trail.length} 条）`}；错误 ${report.errors.length} 条`);
for (const e of report.errors) console.log(`  ✗ [${e.kind}] ${e.message}${e.stack === null ? '' : `\n      ${e.stack.split('\n').slice(0, 4).join('\n      ')}`}`);

let rejected = 0;
const end = replayTrail(base, trail, topo, (i, before, after) => {
  if (after === before) rejected++;
  if (!trace) return;
  const tag = after === before ? ' ✗被拒' : '';
  console.log(
    `#${String(i).padStart(4)} ${JSON.stringify(trail[i]!.action)}${tag}  →  turn ${after.turnCount} ${after.phase} P${after.currentPlayer} pending=${after.pending?.kind ?? '-'}`,
  );
});

const shot = opt('shot');
if (shot !== null && report.screenshot !== null) {
  writeFileSync(shot, Buffer.from(report.screenshot.replace(/^data:image\/png;base64,/, ''), 'base64'));
  console.log(`截图已存：${shot}`);
}

console.log(`终点：第 ${end.turnCount} 回合 ${end.phase} P${end.currentPlayer} pending=${end.pending?.kind ?? '-'}；被拒 ${rejected} 条`);
if (until !== null) process.exit(0);
// ★ 被注入口改过的现场：**拒绝**验指纹（见文件头）—— 不是「不一致」，是「不能比」
if (devPatched) {
  console.log('❌ 这份报告来自被改过的状态（`devPatched: true`）：`__rich4.debug.patch` 直接改了 `state`，');
  console.log('   `base` + `trail` 不再是它的来源 ⇒ 无法核对指纹。要看现场请用报告里的截图/日志，');
  console.log('   或在 `__rich4.debug.patch` **之前**重开一局再走一遍。');
  process.exit(3);
}
const got = stateFingerprint(end);
if (got === report.finalFingerprint) {
  console.log(`✅ 重放指纹与回报一致（${got}）—— 现场已完整复现`);
} else {
  console.log(`❌ 指纹不一致：重放 ${got} ≠ 回报 ${report.finalFingerprint} —— 有状态改写绕过了记录漏斗`);
  process.exit(1);
}
