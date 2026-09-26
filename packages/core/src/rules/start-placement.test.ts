/*
 * 开局惰性摆人（降落伞落地）—— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-24：「开局时第一个玩家行动时理论上地图只有他，其他玩家在第一回合要轮到了
 * 才有个降落伞特效出现在地图上」。依据见 `start-placement.ts` 的文件头。
 *
 * 钉的几件事：
 *   ① **原版存档实证**：SAVE1.DAT 是开局那一刻存的档 —— 第 1 位已上盘，其余三位
 *      `who_plays = 0`、坐标 / 节点 / 来路 / 朝向全 0、`+0x64 = 2`；`newGame` 造出同一个形状；
 *   ② **随机序列**：每人两次 `rand()`，落在**自己第一个回合开头**（前面各位行动之后）——
 *      整局由 AI 跑，逐次对一份**独立重写**的摆人算法（候选筛选 / 占用 / 来路 / 朝向都在本文件里重写）；
 *   ③ 没上盘的人：照样轮到（`0x00418ffe`）、不算出局、託管改的是落地后那一份、破产清掉 +0x64；
 *   ④ 存档往返（本引擎 JSON / 原版格式 +0x64）。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap, type Rich4Map } from '../loaders/map.ts';
import { parseSave } from '../loaders/save.ts';
import { deserializeGame, importOriginalSave, serializeGame } from '../loaders/savegame.ts';
import { writeOriginalSaveFile } from '../loaders/save-writer.ts';
import { decideAction } from '../ai/policy.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { isGameOver, nextAlivePlayer, reduce } from '../state/reduce.ts';
import {
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_COMPUTER,
  WHO_PLAYS_HUMAN,
  isAlive,
  isInGame,
  isUnplaced,
  type GameState,
} from '../state/types.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { directionOf } from './direction.ts';
import { markPlayerBankrupt } from './bankruptcy.ts';
import { newGame } from './new-game.ts';
import { landAll, topoOf } from '../testing/factories.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const MAP = `${ROOT}/extracted/map/0001.bin`;
const SAVE1 = `${ROOT}/Rich4/SAVE1.DAT`;
const run = existsSync(MAP) ? it : it.skip;
const runSave = existsSync(SAVE1) ? it : it.skip;
const loadMap = (): Rich4Map => parseMap(new Uint8Array(readFileSync(MAP)));

const computers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ character: (i * 5) % 12, kind: 'computer' as const }));

/**
 * **独立重写**的摆人（不调 `start-placement.ts` / `object-landing.ts` 的任何函数）：
 * 候选 = 可放物件、有邻格、此刻没人站 / 没物件 / 没惡人的格；`rand() % n` 挑一格；
 * 再在四个邻接槽里（非 0、按槽序）`rand() % m` 挑来路；朝向 = 来路 → 起始格。
 *
 * @source 0x0040aa0f（候选 + 第一次 rand）/ 0x00408302..0x00408340（来路 + 第二次 rand）/
 *   0x0040835e（朝向）；占用位语义见 `object-landing.ts` 的 `runtimeOccupiedNodes` 文档
 */
function referencePlacement(map: Rich4Map, s: GameState, rngState: number) {
  const occupied = new Set<number>();
  for (const p of s.players) {
    if (p.nodeId === 0) continue;
    const b = p.blocking;
    if (b.inPrison !== 0 || b.inHospital !== 0 || b.inHotel !== 0 || b.disappearing !== 0) continue;
    occupied.add(p.nodeId);
  }
  for (const o of s.objects) if (o.nodeId !== 0 && o.attached === 0) occupied.add(o.nodeId);
  for (const a of s.specialActors.slice(0, 4)) if (a.place === 0 && a.nodeId !== 0) occupied.add(a.nodeId);
  const cand = map.nodes.filter((n) => !n.noObjects && n.adjacentSlots.some((x) => x !== 0) && !occupied.has(n.id));
  const rng = new WatcomRng();
  rng.setState(rngState);
  // ★ 回合开头 `0x41c84f` 的第一句 `0x0041c868 call 0x42915a`：股本 > 1000 的股票各抽一次（在摆人之前）
  for (const st of s.market.stocks) if (st.shares > 1000) rng.next();
  const node = cand[rng.next() % cand.length]!;
  const adj = node.adjacentSlots.filter((x) => x !== 0);
  const last = map.nodes[adj[rng.next() % adj.length]! - 1]!;
  return {
    nodeId: node.id,
    lastNodeId: last.id,
    direction: directionOf(node.x - last.x, node.y - last.y),
    xpos: node.x,
    ypos: node.y,
    rngState: rng.getState(),
  };
}

describe('① 原版存档实证：SAVE1.DAT 就是「开局那一刻」', () => {
  runSave('SAVE1.DAT：第 1 位在盘上；其余三位 who_plays 0、三元组 / 来路 / 朝向全 0、+0x64 = 2（电脑）', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE1)));
    const [p0, ...rest] = save.players;
    expect(p0!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(p0!.f100).toBe(WHO_PLAYS_HUMAN);
    expect(p0!.xpos).toBeGreaterThan(0);
    expect(p0!.nodeId).toBeGreaterThan(0);
    expect(p0!.lastNodeId).toBeGreaterThan(0);
    for (const p of rest) {
      expect([p.whoPlays, p.xpos, p.ypos, p.nodeId, p.lastNodeId, p.direction], `玩家 ${p.index}`).toEqual([0, 0, 0, 0, 0, 0]);
      expect(p.f100, `玩家 ${p.index} 的 +0x64`).toBe(WHO_PLAYS_COMPUTER);
      // 钱早就分好了（开局分钱在摆人之前）
      expect(p.cash + p.moneyInBank).toBeGreaterThan(0);
    }
  });

  run('newGame（1 真人 + 3 电脑）造出同一个形状', () => {
    const map = loadMap();
    const s = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: (i === 0 ? 'human' : 'computer') as 'human' | 'computer' })),
      seed: 99,
    });
    const shape = (p: GameState['players'][number]) => [
      p.whoPlays,
      p.xpos === 0,
      p.nodeId === 0,
      p.lastNodeId === 0,
      p.landingWhoPlays,
    ];
    expect(s.players.map(shape)).toEqual([
      [WHO_PLAYS_HUMAN, false, false, false, WHO_PLAYS_HUMAN],
      [0, true, true, true, WHO_PLAYS_COMPUTER],
      [0, true, true, true, WHO_PLAYS_COMPUTER],
      [0, true, true, true, WHO_PLAYS_COMPUTER],
    ]);
    expect(s.players.map((p) => isUnplaced(p))).toEqual([false, true, true, true]);
  });

  runSave('读 SAVE1.DAT 进来：还没上盘的三位照原样没上盘，轮到谁谁落地（两次 rand，对独立重写）', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE1)));
    const { state: imported, map } = importOriginalSave(save, loadMap());
    const topo = topoOf(map);
    expect(imported.players.map((p) => isUnplaced(p))).toEqual([false, true, true, true]);
    // 真人那一位交给电脑跑（只为推进回合；託管改的是 who_plays，落地规则不受影响）
    let s = reduce(imported, { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_COMPUTER }, topo);
    const landed: number[] = [];
    for (let step = 0; step < 20_000 && landed.length < 3; step++) {
      const a = decideAction({ state: s, map });
      if (a === null) throw new Error(`无人可动：${s.phase}`);
      const next = reduce(s, a, topo);
      const who = next.players.findIndex((p, i) => isUnplaced(s.players[i]!) && !isUnplaced(p));
      if (who >= 0) {
        const want = referencePlacement(map, s, s.rngState);
        const p = next.players[who]!;
        expect({ nodeId: p.nodeId, lastNodeId: p.lastNodeId, direction: p.direction, xpos: p.xpos, ypos: p.ypos, rngState: next.rngState }).toEqual(want);
        expect(p.whoPlays, '落地 ⇒ who_plays ← +0x64').toBe(WHO_PLAYS_COMPUTER);
        landed.push(who);
      }
      s = next;
    }
    expect(landed).toEqual([1, 2, 3]);
  });
});

describe('② 随机序列：每人的两次抽签落在自己第一个回合开头（整局 AI 跑，对独立重写）', () => {
  run('4 电脑 × 6 个种子：落地次序 = 轮转次序，位置 / 来路 / 朝向 / rngState 逐项相等；此前没人碰过他', () => {
    const map = loadMap();
    const topo = topoOf(map);
    for (const seed of [1, 2, 3, 42, 1234, 0x7fff]) {
      const s0 = newGame({ map, players: computers(4), seed });
      // 开局：只有第 1 位在盘上
      expect(s0.players.map((p) => isUnplaced(p)), `种子 ${seed}`).toEqual([false, true, true, true]);
      let s = s0;
      const landed: number[] = [];
      let p1Rolled = false;
      for (let step = 0; step < 50_000 && landed.length < 3; step++) {
        const a = decideAction({ state: s, map });
        if (a === null) throw new Error(`种子 ${seed}：无人可动 ${s.phase}`);
        if (a.type === 'rollDice' && s.currentPlayer === 0) p1Rolled = true;
        const next = reduce(s, a, topo);
        expect(next, `种子 ${seed}：卡死于 ${s.phase}/${a.type}`).not.toBe(s);
        for (let i = 1; i < 4; i++) {
          const was = s.players[i]!;
          const now = next.players[i]!;
          if (!isUnplaced(was)) continue;
          if (isUnplaced(now)) {
            // 没上盘期间谁都没碰过他（钱 / 牌 / 位置 / 身份原封不动）
            expect(now, `种子 ${seed} 第 ${step} 步：P${i + 1} 还没上盘就被改了`).toEqual(was);
            continue;
          }
          // ★ 刚落地：必须正是轮到他的那一拍（回合交接），而且是他的第一个回合
          expect(next.currentPlayer, `种子 ${seed}：P${i + 1} 落地时不是他的回合`).toBe(i);
          expect(s.currentPlayer).not.toBe(i);
          expect(next.phase).toBe('turnStart');
          const want = referencePlacement(map, s, s.rngState);
          expect(
            { nodeId: now.nodeId, lastNodeId: now.lastNodeId, direction: now.direction, xpos: now.xpos, ypos: now.ypos, rngState: next.rngState },
            `种子 ${seed}：P${i + 1} 的落点`,
          ).toEqual(want);
          expect(now.whoPlays).toBe(WHO_PLAYS_COMPUTER);
          landed.push(i);
        }
        s = next;
      }
      expect(landed, `种子 ${seed}`).toEqual([1, 2, 3]);
      // ★ 第 2 位的两次抽签在第 1 位掷骰之后（原版：前面各位行动完才轮到他）
      expect(p1Rolled, `种子 ${seed}`).toBe(true);
      // 第一輪结束时四人都在盘上、互不同格
      const nodes = s.players.map((p) => p.nodeId);
      expect(nodes.every((n) => n > 0)).toBe(true);
    }
  });
});

describe('③ 没上盘的人：轮转 / 终局 / 託管 / 破产', () => {
  run('轮转收下没上盘的人（`0x00418ffe`：who_plays 0 且 xpos 0）；出局者照旧跳过', () => {
    const map = loadMap();
    const s = newGame({ map, players: computers(4), seed: 5 });
    expect(nextAlivePlayer(s, 0)).toBe(1);
    // 1 号破产（xpos 非 0、+0x64 清 0）⇒ 跳过
    const landed = landAll(s, map.nodes);
    const dead = { ...landed, players: landed.players.map((p, i) => (i === 1 ? markPlayerBankrupt(p) : p)) };
    expect(nextAlivePlayer(dead, 0)).toBe(2);
    expect(isUnplaced(dead.players[1]!)).toBe(false);
    expect(dead.players[1]!.landingWhoPlays).toBe(0);
  });

  run('开局不算终局（只有 1 人在场，但 3 人还没上盘）', () => {
    const map = loadMap();
    const s = newGame({ map, players: computers(4), seed: 5 });
    expect(s.players.filter((p) => isAlive(p))).toHaveLength(1);
    expect(s.players.filter((p) => isInGame(p))).toHaveLength(4);
    expect(isGameOver(s)).toBe(false);
  });

  run('託管 / 掉线代打一个还没上盘的座位 ⇒ 改落地之后那一份；落地时生效', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const s = newGame({
      map,
      players: [0, 1].map((i) => ({ character: i, kind: 'human' as const })),
      seed: 8,
    });
    const want = WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT;
    const t = reduce(s, { type: 'setAi', player: 1, whoPlays: want }, topo);
    expect(t).not.toBe(s);
    expect(t.players[1]!.whoPlays).toBe(0);
    expect(t.players[1]!.landingWhoPlays).toBe(want);
    expect(isUnplaced(t.players[1]!)).toBe(true);
    // 同值再设 ⇒ 原样返回（「拒绝」的恒等性）
    expect(reduce(t, { type: 'setAi', player: 1, whoPlays: want }, topo)).toBe(t);
    // 1 号那一回合开头落地，拿到的就是託管身份
    const landed = landAll(t, map.nodes);
    expect(landed.players[1]!.whoPlays).toBe(want);
  });
});

describe('④ 存档往返', () => {
  run('本引擎 JSON：第一輪里存的档读回来逐字段相等，之后接着跑指纹一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    let s = newGame({ map, players: computers(3), seed: 77 });
    // 走到第 1 位回合中途（其余两位还没上盘）
    for (let i = 0; i < 6; i++) s = reduce(s, decideAction({ state: s, map })!, topo);
    expect(s.players.filter((p) => isUnplaced(p)).length).toBe(2);
    const back = deserializeGame(serializeGame(s));
    expect(back).toEqual(s);
    let a = s;
    let b = back;
    for (let i = 0; i < 400; i++) {
      const act = decideAction({ state: a, map })!;
      a = reduce(a, act, topo);
      b = reduce(b, act, topo);
    }
    expect(a.players.filter((p) => isUnplaced(p))).toHaveLength(0);
    expect(stateFingerprint(b)).toBe(stateFingerprint(a));
  });

  runSave('原版格式：+0x64 写的是落地后那一份（没上盘的人全靠它）', () => {
    const bytes = new Uint8Array(readFileSync(SAVE1));
    const { state, map } = importOriginalSave(parseSave(bytes), loadMap());
    const topo = topoOf(map);
    // 2 号座改成託管（落地后生效的那一份）
    const bent = reduce(state, { type: 'setAi', player: 2, whoPlays: WHO_PLAYS_HUMAN }, topo);
    const again = parseSave(writeOriginalSaveFile({ state: bent, map, carry: bytes }));
    expect(again.players.map((p) => p.f100)).toEqual([WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, WHO_PLAYS_COMPUTER]);
    expect(again.players.slice(1).map((p) => [p.whoPlays, p.xpos, p.ypos, p.nodeId])).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    // 原样读回再写：与原档逐字节相等的那一段（玩家块）不受影响
    const same = writeOriginalSaveFile({ state, map, carry: bytes });
    expect(parseSave(same).players.map((p) => p.f100)).toEqual(parseSave(bytes).players.map((p) => p.f100));
  });
});
