/*
 * 付款与破产验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  resolveBankruptcyOutcome,
  GAME_OVER_ALL_OUT,
  GAME_OVER_SINGLE_HUMAN,
  GAME_OVER_MULTI_HUMAN,
  payMoney,
  canAfford,
  markPlayerBankrupt,
  BANKRUPT_CLEAR_FROM,
} from './bankruptcy.ts';
import { makePlayer } from '../testing/factories.ts';
import { isAlive } from '../state/types.ts';
import { parseSave } from '../loaders/save.ts';
import { parseMap } from '../loaders/map.ts';

const ROOT = (process.env.RICH4_WORKSPACE ?? '');
const SAVE0 = `${ROOT}/Rich4/Save0.dat`;


describe('付款级联', () => {
  it('现金足够时只扣现金', () => {
    const r = payMoney(makePlayer(), 30_000);
    expect(r.player.cash).toBe(70_000);
    expect(r.player.moneyInBank).toBe(50_000);
    expect(r.bankrupt).toBe(false);
    expect(r.paid).toBe(30_000);
  });

  it('★ 现金不足时自动动用存款', () => {
    const r = payMoney(makePlayer(), 120_000);
    expect(r.player.cash).toBe(0);
    expect(r.player.moneyInBank).toBe(30_000); // 50000 - 20000
    expect(r.bankrupt).toBe(false);
    expect(r.paid).toBe(120_000);
  });

  it('恰好用尽现金与存款不算破产', () => {
    const r = payMoney(makePlayer(), 150_000);
    expect(r.player.cash).toBe(0);
    expect(r.player.moneyInBank).toBe(0);
    expect(r.bankrupt).toBe(false);
  });

  it('★ 现金+存款都不足 → 破产', () => {
    const r = payMoney(makePlayer(), 200_000);
    expect(r.bankrupt).toBe(true);
    expect(r.paid).toBe(150_000);      // 掏空所有
    expect(r.shortfall).toBe(50_000);  // 还欠 5 万
    expect(r.player.cash).toBe(0);
    expect(r.player.moneyInBank).toBe(0);
  });

  it('★ 贷款额度不会被自动动用来抵付', () => {
    // 原版付款级联只走 cash → bank，不碰 loan
    const p = makePlayer({ cash: 0, moneyInBank: 0, loan: 500_000 });
    expect(payMoney(p, 1).bankrupt).toBe(true);
  });

  it('金额为 0 或负数不产生变化', () => {
    const p = makePlayer();
    expect(payMoney(p, 0).player).toBe(p);
    expect(payMoney(p, -100).player).toBe(p);
  });

  it('不原地修改入参', () => {
    const p = makePlayer();
    const snapshot = JSON.stringify(p);
    payMoney(p, 200_000);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it('canAfford 与 payMoney 的破产判定一致', () => {
    const p = makePlayer(); // 15 万可用
    for (const amount of [1, 149_999, 150_000, 150_001, 999_999]) {
      expect(canAfford(p, amount)).toBe(!payMoney(p, amount).bankrupt);
    }
  });
});

describe('破产状态转换', () => {
  it('★ 清空 0x1c 之后的字段，保留之前的', () => {
    expect(BANKRUPT_CLEAR_FROM).toBe(0x1c);
    const p = makePlayer();
    const b = markPlayerBankrupt(p);

    // 被清零（对应 memset(player+0x1c, 0, 0x4c)）
    expect(b.cash).toBe(0);
    expect(b.moneyInBank).toBe(0);
    expect(b.loan).toBe(0);
    expect(b.points).toBe(0);
    expect(b.blocking.inPrison).toBe(0);
    expect(b.godInfo).toBe(0);
    expect(b.alliedPlayer).toBe(0);
    expect(b.alliedDays).toBe(0);

    // 被保留（0x00..0x1b）
    expect(b.character).toBe(p.character);
    expect(b.nodeId).toBe(p.nodeId);
    expect(b.lastNodeId).toBe(p.lastNodeId);
    expect(b.direction).toBe(p.direction);
    expect(b.ndices).toBe(p.ndices);

    // ★ 手牌与道具**不**被 memset 清除：它们不在玩家结构体内，
    //    而是独立全局数组，靠「变卖」步骤处理（仅非终局路径执行）
    expect(b.cards).toEqual(p.cards);
    expect(b.tools).toEqual(p.tools);
  });

  it('who_plays 归零即出局', () => {
    const b = markPlayerBankrupt(makePlayer());
    expect(b.whoPlays).toBe(0);
    expect(isAlive(b)).toBe(false);
  });

  it('不原地修改入参', () => {
    const p = makePlayer();
    const snapshot = JSON.stringify(p);
    markPlayerBankrupt(p);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('破产的两条路径', () => {
  it('剩余 > 1 人且还有真人 → 正常清算', () => {
    expect(resolveBankruptcyOutcome(2, 1, 1)).toEqual({ kind: 'liquidate' });
    expect(resolveBankruptcyOutcome(3, 4, 2)).toEqual({ kind: 'liquidate' });
  });

  it('★ 只剩 1 人（必是真人）→ 对局结束，清算被跳过', () => {
    expect(resolveBankruptcyOutcome(1, 1, 1)).toEqual({ kind: 'gameOver', code: GAME_OVER_SINGLE_HUMAN });
    expect(resolveBankruptcyOutcome(1, 2, 1)).toEqual({ kind: 'gameOver', code: GAME_OVER_MULTI_HUMAN });
  });

  it('全员出局 → 结束码 1', () => {
    expect(resolveBankruptcyOutcome(0, 1, 0)).toEqual({ kind: 'gameOver', code: GAME_OVER_ALL_OUT });
    expect(resolveBankruptcyOutcome(0, 4, 0)).toEqual({ kind: 'gameOver', code: GAME_OVER_ALL_OUT });
  });

  it('★ 审计订正：真人一个不剩 → 结束码 1，电脑还剩几家都一样 @source 0x0040d029 test esi, esi', () => {
    // 1 真人 + 3 电脑，真人破产：原版 0x0040cff0 弹「輸了」框直接收局（码 1）；先前这里继续清算、电脑自己打到底
    expect(resolveBankruptcyOutcome(3, 1, 0)).toEqual({ kind: 'gameOver', code: GAME_OVER_ALL_OUT });
    // 真人输给最后一家电脑：先前报成「真人胜」码 2
    expect(resolveBankruptcyOutcome(1, 1, 0)).toEqual({ kind: 'gameOver', code: GAME_OVER_ALL_OUT });
    // 2 真人都破产、2 电脑还在
    expect(resolveBankruptcyOutcome(2, 2, 0)).toEqual({ kind: 'gameOver', code: GAME_OVER_ALL_OUT });
  });

  it('结束码按人类玩家数区分 2 / 3', () => {
    expect(GAME_OVER_SINGLE_HUMAN).toBe(2);
    expect(GAME_OVER_MULTI_HUMAN).toBe(3);
    // @source cmp dword [_num_human_players], 1 / jne → 3
    expect((resolveBankruptcyOutcome(1, 1, 1) as { code: number }).code).toBe(2);
    expect((resolveBankruptcyOutcome(1, 3, 1) as { code: number }).code).toBe(3);
  });
});

describe.skipIf(!existsSync(SAVE0))('Save0.dat 的出局玩家特征验证', () => {
  it('★ 出局玩家：结构体内字段归零，但角色编号保留', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE0)));
    const dead = save.players.filter((p) => !p.isAlive);
    expect(dead.length).toBe(3);

    for (const p of dead) {
      // 0x1c 之后被 memset 清零
      expect(p.cash, `玩家${p.index} 现金`).toBe(0);
      expect(p.moneyInBank).toBe(0);
      expect(p.loan).toBe(0);
      expect(p.points).toBe(0);
      // 0x1c 之前被保留 —— 角色编号仍在
      expect(p.character, `玩家${p.index} 角色`).toBeGreaterThanOrEqual(0);
      expect(p.character).toBeLessThan(12);
    }
    console.log(`  出局玩家角色编号: ${dead.map((p) => p.character).join(', ')}（均被保留）`);
  });

  it('★ 破产的两条路径在同一存档中同时可见', () => {
    // 玩家 2、3 先破产 → 正常清算 → 地产与手牌均已清空
    // 玩家 0 最后破产、只剩玩家 1 → 终局路径 → 清算被跳过，地产与手牌留存
    const save = parseSave(new Uint8Array(readFileSync(SAVE0)));
    const map = parseMap(save.mapData);

    const holdings = save.players.map((p) => ({
      index: p.index,
      alive: p.isAlive,
      lands: map.lands.filter((l) => l.owner === p.index + 1).length,
      cards: p.cards.length,
    }));
    for (const h of holdings) {
      console.log(`  玩家${h.index} ${h.alive ? '存活' : '出局'}: 地产 ${h.lands} 块, 手牌 ${h.cards} 张`);
    }

    const dead = holdings.filter((h) => !h.alive);
    const liquidated = dead.filter((h) => h.lands === 0 && h.cards === 0);
    const skipped = dead.filter((h) => h.lands > 0 || h.cards > 0);

    // 两条路径各自留下痕迹
    expect(liquidated.length, '走正常清算路径的出局玩家').toBe(2);
    expect(skipped.length, '走终局路径、清算被跳过的出局玩家').toBe(1);
    // 终局路径只可能发生在最后一个破产者身上，故恰好 1 人
  });
});
