/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 落在上市企业上：买股份
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { commercialUnitPrice } from '../places/stock.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const have = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

/** 把当前玩家放到第一个上市企业的格子上，并结算落点 */
function landOnCommercial(): { state: GameState; topo: ReturnType<typeof topoOf> } {
  const map = loadMap();
  const topo = topoOf(map);
  // ★ 必须挑 specialKind 为 0 的那种：中國信託那格同时是「銀行」、
  //   大宇百貨那格同时是「百貨公司」，特殊格的处理优先（与原版的
  //   17 路跳表同序），落上去给出的是那两种交互而不是买股。
  const node = map.nodes.find((n) => n.ref.kind === 'commercial' && n.specialKind === 0);
  if (node === undefined) throw new Error('地图 0 上没有纯粹的上市企业格');

  let state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 1,
  });
  state = {
    ...state,
    phase: 'settling',
    players: state.players.map((p, i) => (i === 0 ? { ...p, nodeId: node.id } : p)),
  };
  return { state: reduce(state, { type: 'settle' }, topo), topo };
}

function topoOf(map: ReturnType<typeof loadMap>) {
  return { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
}

describe('★ 上市企业落点', () => {
  have('★ 落上去会留下一个「买多少股」的待决交互', () => {
    const { state } = landOnCommercial();
    expect(state.pending?.kind).toBe('buyShares');
    if (state.pending === null || state.pending.kind !== 'buyShares') return;
    expect(state.pending.name.length).toBeGreaterThan(0);
    expect(state.pending.unitPrice).toBeGreaterThan(0);
    expect(state.pending.available).toBeGreaterThan(0);
  });

  have('★ 单价 = 企业资产额 ÷ 10000，与股价无关', () => {
    const map = loadMap();
    const { state } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const pending = state.pending;
    const c = map.commercials.find((x) => x.id === pending.commercialId)!;
    expect(pending.unitPrice).toBe(commercialUnitPrice(c.assetValue));
  });

  have('★ 买入从现金扣、企业余量减少、持仓增加', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const { unitPrice, available, stock, commercialId } = state.pending;
    const cashBefore = state.players[0]!.cash;
    const bankBefore = state.players[0]!.moneyInBank;
    const floatBefore = state.market.stocks[stock]!.shares;

    const after = reduce(state, { type: 'buyShares', shares: 10 }, topo);
    expect(after.players[0]!.cash).toBe(cashBefore - 10 * unitPrice);
    // ★ 从现金扣，不动存款
    expect(after.players[0]!.moneyInBank).toBe(bankBefore);
    expect(after.holdings[0]![stock]!.amount).toBe(10);
    expect(after.commercialShares[commercialId]).toBe(available - 10);
    // ★ 企业买入**不动股市流通量**（那是柜台买入才有的）
    expect(after.market.stocks[stock]!.shares).toBe(floatBefore);
    expect(after.pending).toBeNull();
  });

  have('买超过企业余量会被拒', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    expect(reduce(state, { type: 'buyShares', shares: state.pending.available + 1 }, topo)).toBe(
      state,
    );
  });

  have('现金不够会被拒', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const broke = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, cash: 1 } : p)),
    };
    expect(reduce(broke, { type: 'buyShares', shares: 10 }, topo)).toBe(broke);
  });

  have('非正股数与没有待决交互时都被拒', () => {
    const { state, topo } = landOnCommercial();
    expect(reduce(state, { type: 'buyShares', shares: 0 }, topo)).toBe(state);
    const noPending = { ...state, pending: null };
    expect(reduce(noPending, { type: 'buyShares', shares: 5 }, topo)).toBe(noPending);
  });
});
