/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 开新局
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';
import { drawStartPlacements, newGame, UNVERIFIED_CARDS_PER_KIND } from './new-game.ts';
import { objectNodeCandidates } from './object-landing.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { directionOf, nextCandidates, pickNextNode } from '../state/reduce.ts';
import { CARDS } from '@rich4/data';
import { DEFAULT_INITIAL_FUND, GAME_INITIAL_FUNDS, startingMoney } from './setup.ts';
import { INITIAL_PRICE_INDEX } from './wealth.ts';
import { STARTING_TOOLS, toolCount, toolsOf } from './tools.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const setup = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    character: i,
    kind: (i === 0 ? 'human' : 'computer') as 'human' | 'computer',
  }));

describe('开局资金', () => {
  run('★ 按角色的 initCashRatio 分配现金/存款', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      const expected = startingMoney(p.character, DEFAULT_INITIAL_FUND);
      expect(p.cash, `角色${p.character}`).toBe(expected.cash);
      expect(p.moneyInBank, `角色${p.character}`).toBe(expected.moneyInBank);
    }
  });

  run('★ 每人现金+存款都等于初始资金', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      expect(p.cash + p.moneyInBank).toBe(DEFAULT_INITIAL_FUND);
    }
  });

  run('可以选别的资金档位', () => {
    const fund = GAME_INITIAL_FUNDS[3]!;
    const s = newGame({ map: loadMap(), players: setup(2), initialFund: fund });
    for (const p of s.players) expect(p.cash + p.moneyInBank).toBe(fund);
  });

  run('★ 不同角色的现金比例确实不同（不是都一样）', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    const ratios = new Set(s.players.map((p) => p.cash));
    expect(ratios.size).toBeGreaterThan(1);
  });
});

describe('初始状态', () => {
  run('物价指数取原版开局值 1', () => {
    expect(newGame({ map: loadMap(), players: setup(2) }).priceIndex).toBe(INITIAL_PRICE_INDEX);
  });

  run('★ 地产全部无主、等级为 0，且长度覆盖全部地块', () => {
    const map = loadMap();
    const s = newGame({ map, players: setup(4) });
    expect(s.landOwner).toHaveLength(map.lands.length + 1);
    expect(s.landOwner.every((v) => v === 0)).toBe(true);
    expect(s.landLevel.every((v) => v === 0)).toBe(true);
  });

  run('人机身份按配置设置', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    expect(s.players[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
    expect(s.players[1]!.whoPlays).toBe(WHO_PLAYS_COMPUTER);
  });

  run('牌堆按占位值填满', () => {
    const s = newGame({ map: loadMap(), players: setup(2) });
    expect(s.cardAmount).toHaveLength(30);
    // ★ 牌堆初值 = 卡片表的 initAmount（@source 0x004071a5），不再是自取的 8
    expect(s.cardAmount).toEqual(CARDS.map((c) => c.initAmount));
    expect(s.cardAmount[0]).toBe(1); // 均富卡只有一张
    expect(UNVERIFIED_CARDS_PER_KIND).toBe(8); // 旧常量仅存档用，不再进状态
  });

  run('★ 开局每人发六件道具各一个', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (let i = 0; i < 4; i++) {
      for (const toolId of STARTING_TOOLS) {
        expect(toolCount(s.tools, i, toolId), `玩家${i} 道具${toolId}`).toBe(1);
      }
      // 只发这六样，其余为 0
      expect([...toolsOf(s.tools, i).keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 8, 9]);
    }
  });

  run('★ 道具槽位是 15/人——13 号核子飛彈不会越界', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    expect(s.tools).toHaveLength(4 * 15);
    expect(toolCount(s.tools, 3, 13)).toBe(0); // 能读到而不是 undefined
  });

  run('★ 无人持牌、无债务、无阻碍', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      expect(p.cards).toEqual([]);
      expect(p.loan).toBe(0);
      expect(p.blocking.inPrison).toBe(0);
      expect(p.hostility).toEqual([0, 0, 0, 0]);
    }
  });

  run('★ 种子决定整个开局 —— 联机必须由服务器统一下发', () => {
    const a = newGame({ map: loadMap(), players: setup(2), seed: 12345 });
    const b = newGame({ map: loadMap(), players: setup(2), seed: 12345 });
    expect(a.rngState).toBe(b.rngState);
    expect(a.newsDeck.order).toEqual(b.newsDeck.order);

    const c = newGame({ map: loadMap(), players: setup(2), seed: 999 });
    expect(c.rngState).not.toBe(a.rngState);
  });

  run('★ rngState 不等于种子——开局洗两副牌已消耗随机数', () => {
    // 这条是有意钉住的：若哪天洗牌被挪走或顺序变了，它会立刻失效提醒
    expect(newGame({ map: loadMap(), players: setup(2), seed: 12345 }).rngState).not.toBe(12345);
  });
});

describe('参数校验', () => {
  run('玩家数少于 2 或多于 4 都拒绝', () => {
    const map = loadMap();
    expect(() => newGame({ map, players: setup(1) })).toThrow(/2\.\.4/);
    expect(() => newGame({ map, players: setup(5) })).toThrow(/2\.\.4/);
  });

  run('2 人局也能开', () => {
    expect(newGame({ map: loadMap(), players: setup(2) }).players).toHaveLength(2);
  });
});

describe('開局自帶載具', () => {
  /**
   * ★ 原版是个**全局设置**（`[0x0046cb44]`），开局屏上选一次，对所有玩家一律生效：
   * ```asm
   * ; VA 0x00407219
   * dl = byte [0x46cb44]
   * [player + 0x11] = dl                  ; traffic_method
   * if (dl != 0) byte[0x497323 + dl]--    ; 扣那件交通工具的全局库存
   * dl = byte[0x46cb44] + 1
   * [player + 0x12] = dl                  ; ★ ndices = traffic + 1
   * ```
   * 这也解释了 jump.mkf 为什么每个角色有走路／機車／汽車三套侧视动画。
   */
  run('默认走路：一颗骰子', () => {
    const s = newGame({ map: loadMap(), players: setup(4) });
    for (const p of s.players) {
      expect(p.trafficMethod).toBe(0);
      expect(p.ndices).toBe(1);
    }
  });

  run('★ 選機車 → 全员两颗骰子', () => {
    const s = newGame({ map: loadMap(), players: setup(4), startingVehicle: 1 });
    for (const p of s.players) {
      expect(p.trafficMethod).toBe(1);
      expect(p.ndices).toBe(2);
    }
  });

  run('★ 選汽車 → 全员三颗骰子，且库存被扣', () => {
    const base = newGame({ map: loadMap(), players: setup(4) });
    const s = newGame({ map: loadMap(), players: setup(4), startingVehicle: 2 });
    for (const p of s.players) {
      expect(p.trafficMethod).toBe(2);
      expect(p.ndices).toBe(3);
    }
    // 汽車是道具 6，四个人各领一件
    expect(s.toolStock[6]).toBe((base.toolStock[6] ?? 0) - 4);
  });
});

// ============================================================
//  ★ 开局摆人：来路 + 朝向（第十四份试玩回报 #2「开局时人物的站立方向
//    应该和他接下来要行动的方向一致」）
// ============================================================

describe('★ 开局摆人 —— `last_node_id` = 随机邻格、`direction` = 来路 → 起始格', () => {
  run('每人**两次** `rand()`：先抽起始格（`0x40aa0f`），再抽来路（`0x00408328`）', () => {
    const map = loadMap();
    for (const seed of [1, 7, 1326428325, 0xdeadbeef]) {
      const rng = new WatcomRng(seed >>> 0);
      const got = drawStartPlacements(map.nodes, 4, rng);
      // 独立复算：同一个种子手工抽 8 次
      const ref = new WatcomRng(seed >>> 0);
      const taken: number[] = [];
      for (let i = 0; i < 4; i++) {
        const free = objectNodeCandidates(map.nodes).filter((n) => !taken.includes(n));
        const nodeId = free[ref.next() % free.length]!;
        taken.push(nodeId);
        // @source 0x00408302..0x00408326：四个邻接槽里**非 0** 的按槽序排（不看封路位）
        const adj = map.nodes[nodeId - 1]!.adjacentSlots.filter((n) => n !== 0);
        const lastNodeId = adj[ref.next() % adj.length]!;
        const a = map.nodes[lastNodeId - 1]!;
        const b = map.nodes[nodeId - 1]!;
        expect(got[i], `种子 ${seed} 玩家 ${i}`).toEqual({
          nodeId,
          lastNodeId,
          // @source 0x0040835e `call 0x407a8c(last, node)` = 0x454fb4(node − last)
          direction: directionOf(b.x - a.x, b.y - a.y),
        });
      }
      // ★ 可证偽：两边消耗的随机数一样多（少抽一次后面全部错位）
      expect(rng.getState()).toBe(ref.getState());
    }
  });

  run('newGame 把它写进玩家：来路是起始格的邻格，朝向背对来路', () => {
    const map = loadMap();
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame({ map, players: setup(4), seed });
      for (const p of s.players) {
        const node = map.nodes[p.nodeId - 1]!;
        expect(node.adjacentSlots, `种子 ${seed} P${p.index}`).toContain(p.lastNodeId);
        expect(p.lastNodeId).not.toBe(p.nodeId);
        const last = map.nodes[p.lastNodeId - 1]!;
        expect(p.direction).toBe(directionOf(node.x - last.x, node.y - last.y));
      }
    }
  });

  run('★ 第一步不会走回来路 —— 站姿朝向就是接下来要走的方向（两邻格的直路上逐格相等）', () => {
    const map = loadMap();
    const topo = {
      nodes: map.nodes,
      lands: map.lands,
      facilities: map.facilities,
      commercials: map.commercials,
      landscapes: map.landscapes,
    };
    let straight = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame({ map, players: setup(4), seed });
      for (const p of s.players) {
        const next = pickNextNode(topo, p.nodeId, p.lastNodeId, new WatcomRng(seed));
        const cands = nextCandidates(topo, p.nodeId, p.lastNodeId);
        if (cands.length > 0) expect(next, `种子 ${seed} P${p.index}`).not.toBe(p.lastNodeId);
        // 直路（恰两个邻格、且三点共线）上：朝向 = 第一步的位移方向
        const node = map.nodes[p.nodeId - 1]!;
        const last = map.nodes[p.lastNodeId - 1]!;
        const to = map.nodes[next! - 1]!;
        const adj = node.adjacentSlots.filter((n) => n !== 0);
        const colinear = (node.x - last.x) * (to.y - node.y) === (node.y - last.y) * (to.x - node.x);
        if (adj.length === 2 && colinear) {
          straight++;
          expect(p.direction).toBe(directionOf(to.x - node.x, to.y - node.y));
        }
      }
    }
    // 有鉴别力：这 160 次开局里确有直路上的起点
    expect(straight).toBeGreaterThan(0);
  });
});
