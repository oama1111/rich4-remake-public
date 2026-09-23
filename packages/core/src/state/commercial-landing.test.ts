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

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const have = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

/** 把当前玩家放到第一个上市企业的格子上，并结算落点。`cash` 可换掉 0 号的現金 */
function landOnCommercial(opts: { cash?: number } = {}): {
  state: GameState;
  topo: ReturnType<typeof topoOf>;
} {
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
    // ★ newGame 默认从 1998-01-01（元旦，休市）开始；柜台那两条要开市日
    day: 5,
    players: state.players.map((p, i) =>
      i === 0 ? { ...p, nodeId: node.id, ...(opts.cash === undefined ? {} : { cash: opts.cash }) } : p,
    ),
  };
  return { state: reduce(state, { type: 'settle' }, topo), topo };
}

function topoOf(map: ReturnType<typeof loadMap>) {
  return { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
}

describe('★ 上市企业落点的进门两道闸 @source fcn_0041d1a9 (VA 0x0041d857 起)', () => {
  have('★ 梦游中（player+0x37 != 0）连框都不开', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const node = map.nodes.find((n) => n.ref.kind === 'commercial' && n.specialKind === 0)!;
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 1,
    });
    state = {
      ...state,
      phase: 'settling',
      day: 5,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, nodeId: node.id, blocking: { ...p.blocking, sleepWalking: 1 } }
          : p,
      ),
    };
    expect(reduce(state, { type: 'settle' }, topo).pending).toBeNull();
  });

  have('★ 已出局（who_plays == 0）连框都不开', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const node = map.nodes.find((n) => n.ref.kind === 'commercial' && n.specialKind === 0)!;
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 1,
    });
    state = {
      ...state,
      phase: 'settling',
      day: 5,
      players: state.players.map((p, i) => (i === 0 ? { ...p, nodeId: node.id, whoPlays: 0 } : p)),
    };
    expect(reduce(state, { type: 'settle' }, topo).pending).toBeNull();
  });
});

describe('★ 上市企业落点', () => {
  have('★ 落上去会留下一个「买多少股」的待决交互', () => {
    const { state } = landOnCommercial();
    expect(state.pending?.kind).toBe('buyShares');
    if (state.pending === null || state.pending.kind !== 'buyShares') return;
    expect(state.pending.name.length).toBeGreaterThan(0);
    expect(state.pending.unitPrice).toBeGreaterThan(0);
    expect(state.pending.available).toBeGreaterThan(0);
  });

  have('★ 通用填数窗的上限 = min(1000, 現金 ÷ 每股售價, 企業餘量) @source VA 0x0041d1a9', () => {
    const { state } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const p = state.pending;
    // 臺灣人壽：資產 400000 → 單價 40；開局現金 150000 → 3750 股；餘量 5000 股
    // ⇒ 原版那三道夹回里**最紧的是 1000**（`cmp eax, 0x3e8 / mov esi, 0x3e8`）
    expect(p.unitPrice).toBe(40);
    expect(p.cash).toBe(150_000);
    expect(p.max).toBe(1000);
    // 上限绝不超过企業余量
    expect(p.max).toBeLessThanOrEqual(p.available);
  });

  have('★ 上限随現金收紧 —— 买得起多少由 core 算，界面不再自己算', () => {
    // 現金 1000 → 1000 ÷ 40 = 25 股，比 1000 那道上限更紧
    const { state } = landOnCommercial({ cash: 1000 });
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    expect(state.pending.max).toBe(25);
  });

  have('★ 一股都买不起（現金 0）：原版連問都不問 @source VA 0x0041d21f', () => {
    // `test esi, esi / je near loc_0041d2bb` —— 上限算出来是 0 就直接收尾，
    // 連訊息框都不开（真人/电脑共用这一道）。先前引擎照样挂 pending，
    // 玩家只能点「取消」才走得掉。
    const { state } = landOnCommercial({ cash: 0 });
    expect(state.pending).toBeNull();
    expect(state.phase).toBe('turnEnd');
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

  have('★ 2026-09-23：買下之后**易主**（`0x4294d5` 返回 1）⇒ 弹「恭喜您獲得經營權！」/ 門派「恭喜您成為幫主！」@source 0x0041d2aa', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') throw new Error('没拿到待决交互');
    const cid = state.market.stocks[state.pending.stock]!.commercialIndex;
    const before = state.commercialOwners[cid]?.owner ?? 0;
    const after = reduce(state, { type: 'buyShares', shares: 10 }, topo);
    const owner = after.commercialOwners[cid]?.owner ?? 0;
    const type = topo.commercials?.find((c) => c.id === cid)?.type;
    const want = owner === before ? [] : [{ key: type === 0xc ? 'shares.becameBoss' : 'shares.becameChairman', args: [] }];
    expect(owner, '这一条要真的易主才有鉴别力').not.toBe(before);
    expect((after.notices ?? []).filter((n) => n.key.startsWith('shares.'))).toEqual(want);
    // 再买一次：已经是老板 ⇒ 不再弹
    const input = { ...after, pending: state.pending };
    const again = reduce(input, { type: 'buyShares', shares: 1 }, topo);
    expect(again.notices).toBe(input.notices); // 没有新弹的框（引用没变 = 客户端不起播）
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

/**
 * 一格一格地走 —— 与客户端的机械驱动同一条路（`phase === 'moving'` 时
 * 每拍派一个 `{type:'step'}`），只是把定时器拆掉了。
 *
 * `steps` = 骰子点数；`from`/`prev` 决定走哪条路（原版岔路不问玩家，
 * 按 `pickNextNode` 筛完随机挑，只有一候选时是**强制**的）。
 */
function walk(from: number, prev: number, steps: number) {
  const map = loadMap();
  const topo = topoOf(map);
  const base = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 1,
  });
  let state: GameState = {
    ...base,
    phase: 'moving',
    stepsRemaining: steps,
    // ★ 地图上摆着的物件/神明会在这条路上插手；这条用例只问**落点**交互
    objects: [],
    players: base.players.map((p, i) =>
      i === 0 ? { ...p, nodeId: from, lastNodeId: prev } : p,
    ),
  };
  const trace: { node: number; left: number; pending: string | null }[] = [];
  for (let i = 0; i < steps; i++) {
    state = reduce(state, { type: 'step' }, topo);
    trace.push({
      node: state.players[0]!.nodeId,
      left: state.stepsRemaining,
      pending: state.pending === null ? null : state.pending.kind,
    });
  }
  return { state, topo, trace, map };
}

describe('★ 路过上市企業格 ≠ 停在上面', () => {
  // 地图 0 上唯一一家「纯粹的」上市企業（臺灣人壽）占**两格**：51、52。
  // 21 公園 → 51 → 52 → 20 樂透 → 53 台中市 是**强制**路径：
  // 21 的邻居只有 50（来路）与 51，之后每一格的来路都只剩一个前进方向。
  const CORRIDOR: readonly number[] = [21, 51, 52, 20, 53];

  have('★ 路过（不停在上面）不会弹「買幾股」', () => {
    const { state, topo, trace, map } = walk(CORRIDOR[0]!, 50, 4);
    // 这条路径真的踩过那两格企業
    expect(trace.map((t) => t.node)).toEqual([51, 52, 20, 53]);
    for (const n of [51, 52]) {
      expect(map.nodes[n - 1]!.ref.kind).toBe('commercial');
    }
    // 「路过」= 踩上去的时候骰子步数还没走完
    expect(trace[0]!.left).toBeGreaterThan(0);
    expect(trace[1]!.left).toBeGreaterThan(0);
    // ★ 走过去的每一格都不该留下任何待决交互 —— 尤其是 buyShares
    expect(trace.map((t) => t.pending)).toEqual([null, null, null, null]);
    // 走完再结算：落点（53 台中市）给的是地，不是「買幾股」
    const done = reduce(state, { type: 'settle' }, topo);
    expect(done.pending?.kind).not.toBe('buyShares');
  });

  have('★ 停在那两格上才产生「買幾股」', () => {
    // 同一条走廊，只走一格 → 停在 51；走两格 → 停在 52
    for (const steps of [1, 2]) {
      const { state, topo, trace } = walk(CORRIDOR[0]!, 50, steps);
      expect(trace[steps - 1]!.left).toBe(0);
      const done = reduce(state, { type: 'settle' }, topo);
      expect(done.pending?.kind).toBe('buyShares');
    }
  });
});

describe('★ 买入后企业归属重排', () => {
  have('★ 买了就成了这家公司的老板', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const { commercialId } = state.pending;
    expect(state.commercialOwners[commercialId]?.owner).toBe(0); // 开局无主

    const after = reduce(state, { type: 'buyShares', shares: 10 }, topo);
    // 玩家 0 → 编码 1
    expect(after.commercialOwners[commercialId]?.owner).toBe(1);
    expect(after.commercialOwners[commercialId]?.ranking[0]).toBe(1);
  });

  have('★ 柜台买入同样会重排 —— 不只是企业落点', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const { stock, commercialId } = state.pending;
    // 给足存款走柜台
    const rich: GameState = {
      ...state,
      pending: null,
      players: state.players.map((p, i) => (i === 0 ? { ...p, moneyInBank: 9_999_999 } : p)),
    };
    const after = reduce(rich, { type: 'buyStock', stock, shares: 50 }, topo);
    expect(after.commercialOwners[commercialId]?.owner).toBe(1);
  });

  have('★★ 卖出**也要**重排企业名次 @source `_rich4_sell_stock` 尾部 call 0x4294d5', () => {
    // VA 0x00428e23 起的 `_rich4_sell_stock`，尾部：
    //   00428ead  mov ebx,[esp+0x18] / push ebx
    //             mov esi,[esp+0x18] / push esi
    //   00428eb7  call _rich4_update_commercial_owner     ; ★ 与买入同源
    //   （`rich4_stocks.asm:214-219`）
    // ⚠️ 本文件先前那一条写的是「卖出不重排，照搬原版」—— **读反了**，2026-09-16 订正。
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const { stock, commercialId } = state.pending;
    const bought = reduce(state, { type: 'buyShares', shares: 10 }, topo);
    expect(bought.commercialOwners[commercialId]?.owner).toBe(1);

    const sold = reduce(bought, { type: 'sellStock', stock, shares: 10 }, topo);
    expect(sold.holdings[0]![stock]!.amount).toBe(0);
    // ★ 持股归零 ⇒ 归属**当场**让出（老板位清空）
    expect(sold.commercialOwners[commercialId]?.owner).toBe(0);
    expect(sold.commercialOwners[commercialId]?.ranking[0]).toBe(0);
  });

  have('★ 卖出**一部分**、仍是第一大股东 ⇒ 归属不变', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const { stock, commercialId } = state.pending;
    const bought = reduce(state, { type: 'buyShares', shares: 20 }, topo);
    const sold = reduce(bought, { type: 'sellStock', stock, shares: 5 }, topo);
    expect(sold.holdings[0]![stock]!.amount).toBe(15);
    expect(sold.commercialOwners[commercialId]?.owner).toBe(1);
  });

  have('★ 卖到不再是第一 ⇒ 老板换人', () => {
    const { state, topo } = landOnCommercial();
    if (state.pending === null || state.pending.kind !== 'buyShares') {
      throw new Error('没拿到待决交互');
    }
    const { stock, commercialId } = state.pending;
    // 0 号买 20（从企业认购，走现金）
    const a = reduce(state, { type: 'buyShares', shares: 20 }, topo);
    expect(a.commercialOwners[commercialId]?.owner).toBe(1);
    // 1 号在柜台上买 30 股（要走存款）
    const richB: GameState = {
      ...a,
      pending: null,
      currentPlayer: 1,
      players: a.players.map((p, i) => (i === 1 ? { ...p, moneyInBank: 9_999_999 } : p)),
    };
    const b = reduce(richB, { type: 'buyStock', stock, shares: 30 }, topo);
    expect(b.commercialOwners[commercialId]?.owner).toBe(2);
    // 1 号卖掉 25 股 ⇒ 只剩 5 < 0 号的 20 ⇒ 老板换回 0 号
    const c = reduce({ ...b, currentPlayer: 1 }, { type: 'sellStock', stock, shares: 25 }, topo);
    expect(c.commercialOwners[commercialId]?.owner).toBe(1);
    expect(c.holdings[1]![stock]!.amount).toBe(5);
    expect(c.holdings[0]![stock]!.amount).toBe(20);
  });
});
