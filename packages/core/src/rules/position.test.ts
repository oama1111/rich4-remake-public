/*
 * 玩家「位置三元组」：`nodeId` / `xpos` / `ypos` 必须同步
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 两条**真值来源**，互相独立：
 *   ① **两份真实存档**（Save0 / SAVE1）：每个站在格子上的玩家，`xpos/ypos`
 *      精确等于该节点的 `x/y`；`nodeId == 0` 的则是 `0/0`。
 *   ② **原版判据**：冬眠卡（`@source 0x0044415d`）与大地图（`@source 0x0040a8b0`）
 *      都用 `xpos != 0` 当「在不在盘上」的哨兵。
 *
 * ⚠️ 先前 `newGame` 把 `xpos/ypos` 写成 0，而引擎的移动只改 `nodeId`
 *   ⇒ **新局里冬眠卡一个人也冻不住**（`applyHibernateCard` 实测 `affected = []`）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { parseSave } from '../loaders/save.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from '../state/reduce.ts';
import type { GameState } from '../state/types.ts';
import { topoOf } from '../testing/factories.ts';
import { applyHibernateCard } from '../cards/hibernate.ts';
import { isOnBoard, placeOnNodeId } from './position.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP = `${ROOT}/extracted/map/0001.bin`;
const SAVES = [`${ROOT}/Rich4/Save0.dat`, `${ROOT}/Rich4/SAVE1.DAT`];
const haveMap = existsSync(MAP);
const run = haveMap ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const players = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

describe('★ 真实存档：xpos/ypos 就是所在节点的坐标（8/8）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && haveMap ? it : it.skip;
    t(`${path.split('/').pop()}`, () => {
      const save = parseSave(new Uint8Array(readFileSync(path)));
      const map = parseMap(save.mapData);
      let onBoard = 0;
      for (const p of save.players) {
        if (p.nodeId === 0) {
          // 不在盘上 ⇒ 三元组一起清零（原版哨兵 `xpos != 0` 依赖这一点）
          expect([p.xpos, p.ypos], `玩家 ${p.index} 不在盘上`).toEqual([0, 0]);
          continue;
        }
        const node = map.nodes[p.nodeId - 1]!;
        expect([p.xpos, p.ypos], `玩家 ${p.index} 站在节点 ${p.nodeId}`).toEqual([node.x, node.y]);
        onBoard++;
      }
      expect(onBoard).toBeGreaterThan(0);
    });
  }
});

describe('★ placeOnNodeId 的三元组语义', () => {
  const p = { ...newGame({ map: loadMap(), players: players(), seed: 1 }).players[0]! };
  const map = loadMap();

  run('节点号 0 / 负数 / 越界 ⇒ 三项一起清 0', () => {
    for (const bad of [0, -1, map.nodes.length + 1]) {
      const q = placeOnNodeId(p, map.nodes, bad);
      expect([q.nodeId, q.xpos, q.ypos], `nodeId=${bad}`).toEqual([0, 0, 0]);
      expect(isOnBoard(q)).toBe(false);
    }
  });

  run('合法节点 ⇒ nodeId 与坐标同时写', () => {
    const node = map.nodes[4]!;
    const q = placeOnNodeId(p, map.nodes, node.id);
    expect([q.nodeId, q.xpos, q.ypos]).toEqual([node.id, node.x, node.y]);
    expect(isOnBoard(q)).toBe(true);
  });

  run('★ 所有 5 张可解析地图里没有 x==0 或 y==0 的节点', () => {
    // 这保证「`xpos == 0`」与「不在盘上」等价（原版哨兵才成立）
    for (const f of ['0001.bin', '0003.bin', '0005.bin', '0007.bin', '0009.bin']) {
      const m = parseMap(new Uint8Array(readFileSync(`${ROOT}/extracted/map/${f}`)));
      for (const n of m.nodes) {
        expect(n.x, `${f} 节点 ${n.id} 的 x`).toBeGreaterThan(0);
        expect(n.y, `${f} 节点 ${n.id} 的 y`).toBeGreaterThan(0);
      }
    }
  });
});

describe('★★ 新局的三元组：冬眠卡因此才生效（第 38 条）', () => {
  run('开局每个玩家 xpos/ypos == 起始节点坐标', () => {
    const map = loadMap();
    const s = newGame({ map, players: players(), seed: 42 });
    for (const p of s.players) {
      const node = map.nodes[p.nodeId - 1]!;
      expect([p.xpos, p.ypos], `玩家 ${p.index} nodeId=${p.nodeId}`).toEqual([node.x, node.y]);
      expect(p.xpos).toBeGreaterThan(0);
    }
  });

  run('★ 新局用冬眠卡 ⇒ 其他在场玩家真的被冻住（先前 affected 恒为空）', () => {
    const map = loadMap();
    const s = newGame({ map, players: players(), seed: 42 });
    const r = applyHibernateCard(s.players, 0, s.priceIndex);
    expect(r.affected).toEqual([1, 2, 3]);
    expect(r.players.map((p) => p.blocking.sleeping)).toEqual([0, 5, 5, 5]);
  });
});

describe('★ 走一步之后三元组同步（walk）', () => {
  run('rollDice + step 若干次后，每个玩家的 xpos/ypos 仍等于所在节点坐标', () => {
    const map = loadMap();
    const topo = topoOf(map);
    let s: GameState = { ...newGame({ map, players: players(), seed: 7 }), phase: 'awaitingRoll' };
    s = reduce(s, { type: 'rollDice' }, topo);
    for (let i = 0; i < 3; i++) {
      if (s.phase !== 'moving') break;
      s = reduce(s, { type: 'step' }, topo);
    }
    for (const p of s.players) {
      if (p.nodeId === 0) {
        expect([p.xpos, p.ypos]).toEqual([0, 0]);
        continue;
      }
      const node = map.nodes[p.nodeId - 1]!;
      expect([p.xpos, p.ypos], `玩家 ${p.index} nodeId=${p.nodeId}`).toEqual([node.x, node.y]);
    }
  });
});
