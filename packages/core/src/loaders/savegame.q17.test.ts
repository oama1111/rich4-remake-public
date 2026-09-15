/*
 * ★ Q17 结案测试 —— `Save0.dat` 的物价指数 5 到底从哪来
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 疑问：存档记 `price_index = 5`，可拿终局状态套公式却得 11。
 * 旧假设是「终局存档，资产在最后一次日推进之后才暴涨」。
 *
 * 本测试用**真实存档字节**（不是构造数）把它钉死：
 *
 * 1. 存档现值：指数 5 / 开局资金 300000 / 已过天数 295 / 在世者只剩 p1；
 *    以「在世者」为样本套公式确实得 **11**（旧记载无误）。
 * 2. 存档自带的**逐玩家快照**（`_rich4_store_current_state` @ rich4_player_save_state.asm，
 *    每人 0x2718 字节，紧跟主地图块）里 `+9836` = 物价指数、`+9840` = 已过天数，
 *    两份快照都是 **指数 5 / 天数 294**，且快照里的玩家表显示
 *    **在世者是 p0 与 p1 两人**（p2/p3 早出局）。
 * 3. 拿那两个人算：人均 ≈ 1,749,756 ÷ 300,000 = 5.83 → **5**，与存档逐位吻合。
 *
 * ⇒ **推翻**「资产暴涨」：变的是**分母**（2 → 1）。p0 破产那一路在只剩 1 名
 *   在世者时走终局分支（`rich4_player_bankrupt.asm` VA 0x0040d039 `cmp eax,1 / jne 0x40d089`），
 *   **不清算、不再采样**，指数停在 5。详见 `docs/known-deviations.md` F-002。
 *
 * ⚠️ 快照里没有股票市价（那份在日推进时被行情刷新），故第 3 步的股票估值沿用
 *   存档现值。5 这一档的区间是 sum ∈ [3.0M, 3.6M)，而实测 sum = 3,499,512，
 *   离两端都有 10 万以上的余量，股票那点差翻不动结论。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { OFFSET, PLAYER_SNAPSHOT_SIZE, parseSave } from './save.ts';
import { parseMap } from './map.ts';
import { calculatePlayerWealth, updatePriceIndex } from '../rules/wealth.ts';
import type { StockValuation } from '../rules/wealth.ts';
import { DEFAULT_INITIAL_FUND } from '../rules/setup.ts';
import type { Player } from '../state/types.ts';
import { WHO_PLAYS_DEAD, WHO_PLAYS_HUMAN } from '../state/types.ts';
import { makePlayer } from '../testing/factories.ts';

const SAVE0 = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/Save0.dat';

/** 已过天数 `[0x4990e4]` 在存档里的偏移 —— 紧接 game_initial_fund / price_index 之后 */
const OFF_ELAPSED_DAYS = 0x2692;
/** 快照内：物价指数 / 已过天数 @source rich4_player_save_state.asm `+0x48f1ec` / `+0x48f1f0` */
const SNAP_PRICE_INDEX = 9836;
const SNAP_ELAPSED_DAYS = 9840;
/** 快照内玩家表起点（快照头 8 字节：marker + cfg 指针）@source `memcpy(snap+8, players, 0x1a0)` */
const SNAP_PLAYERS = 8;
/** 股票持仓：每人 96 字节、每支 8 字节，取前 4 字节 */
const HOLD_STRIDE = 96;
const HOLD_AMOUNT_STRIDE = 8;
/** 行情：每支 36 字节（`eax = 9i; *4`），市价是 `f20` */
const STOCK_STRIDE = 36;
const STOCK_PRICE_OFF = 20;

const d = existsSync(SAVE0) ? describe : describe.skip;

d('★ Q17：Save0.dat 的物价指数 5 = 最后一次采样时在世者有两人的结果', () => {
  const data = new Uint8Array(readFileSync(SAVE0));
  const save = parseSave(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const stockOf = (p: number): StockValuation[] => {
    const out: StockValuation[] = [];
    for (let s = 0; s < 12; s++) {
      const amount = view.getInt32(OFFSET.playerStocks + p * HOLD_STRIDE + s * HOLD_AMOUNT_STRIDE, true);
      const price = view.getFloat32(OFFSET.stocks + s * STOCK_STRIDE + STOCK_PRICE_OFF, true);
      out.push({ amount, price });
    }
    return out;
  };

  it('存档现值：指数 5 / 开局资金 30 万 / 已过天数 295，在世者只剩一人', () => {
    expect(save.priceIndex).toBe(5);
    expect(view.getInt32(0x268a, true)).toBe(DEFAULT_INITIAL_FUND);
    expect(view.getInt32(OFF_ELAPSED_DAYS, true)).toBe(295);
    const alive = save.players.filter((p) => p.isAlive).map((p) => p.index);
    expect(alive).toEqual([1]);
  });

  it('拿终局状态套公式得 11（旧记载无误 —— 所以它确实"对不上"）', () => {
    const map = parseMap(save.mapData);
    const players: Player[] = save.players.map((p) =>
      makePlayer({
        index: p.index,
        whoPlays: p.isAlive ? WHO_PLAYS_HUMAN : WHO_PLAYS_DEAD,
        cash: p.cash,
        moneyInBank: p.moneyInBank,
        loan: p.loan,
      }),
    );
    const next = updatePriceIndex(
      players,
      (p) => calculatePlayerWealth(p, map.lands, map.facilities, stockOf(p.index)),
      DEFAULT_INITIAL_FUND,
      0,
    );
    expect(next).toBe(11);
  });

  it('★ 快照证明：最后一次采样（天数 294）时在世者是 p0 + p1 两人', () => {
    const start = OFFSET.mapData + save.mapData.length;
    const stride = PLAYER_SNAPSHOT_SIZE + save.mapData.length;

    const aliveOf: number[][] = [];
    for (const i of [0, 1]) {
      const S = start + i * stride;
      expect(view.getInt32(S + SNAP_PRICE_INDEX, true), `snap${i} 物价指数`).toBe(5);
      expect(view.getInt32(S + SNAP_ELAPSED_DAYS, true), `snap${i} 已过天数`).toBe(294);
      const who: number[] = [];
      for (let j = 0; j < 4; j++) who.push(data[S + SNAP_PLAYERS + j * 0x68 + 0x15]!);
      aliveOf.push(who);
    }
    // 两份快照都看到「p0/p1 在世、p2/p3 出局」
    for (const who of aliveOf) expect(who).toEqual([1, 1, 0, 0]);
  });

  it('★ 那两个在世者的人均身家 → 指数正好 5', () => {
    const map = parseMap(save.mapData);
    const start = OFFSET.mapData + save.mapData.length;
    const stride = PLAYER_SNAPSHOT_SIZE + save.mapData.length;
    // 取后一份快照（p1 那一回合，p0 刚付过 36000 过路费）
    const S = start + stride;
    const pf = (j: number, off: number): number =>
      view.getInt32(S + SNAP_PLAYERS + j * 0x68 + off, true);

    const atSample: Player[] = [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        whoPlays: data[S + SNAP_PLAYERS + i * 0x68 + 0x15] === 1 ? WHO_PLAYS_HUMAN : WHO_PLAYS_DEAD,
        cash: pf(i, 0x1c),
        moneyInBank: pf(i, 0x20),
        loan: pf(i, 0x24),
      }),
    );
    // 快照里 p0 的现金/存款/贷款（破产 memset 之前的值）
    expect(pf(0, 0x20)).toBe(938_407);
    expect(pf(0, 0x24)).toBe(953_824);
    expect(pf(1, 0x20)).toBe(3_006_949);

    const avgWealth =
      [0, 1].reduce(
        (a, i) => a + calculatePlayerWealth(atSample[i]!, map.lands, map.facilities, stockOf(i)),
        0,
      ) / 2;
    expect(Math.trunc(avgWealth / DEFAULT_INITIAL_FUND)).toBe(5);

    const next = updatePriceIndex(
      atSample,
      (p) => calculatePlayerWealth(p, map.lands, map.facilities, stockOf(p.index)),
      DEFAULT_INITIAL_FUND,
      5,
    );
    expect(next).toBe(5); // 只增不减：采样结果仍是 5，所以存档停在 5
  });

  it('存档自带的地图块里，p0 的地产**没有被释放**（破产终局分支的铁证）', () => {
    const map = parseMap(save.mapData);
    const ownerHist = new Map<number, number>();
    for (const l of map.lands) ownerHist.set(l.owner, (ownerHist.get(l.owner) ?? 0) + 1);
    // p0 = owner 1 还挂着地；早先破产的 p2/p3（owner 3/4）一块都没有
    expect(ownerHist.get(1) ?? 0).toBeGreaterThan(0);
    expect(ownerHist.get(3) ?? 0).toBe(0);
    expect(ownerHist.get(4) ?? 0).toBe(0);
  });
});
