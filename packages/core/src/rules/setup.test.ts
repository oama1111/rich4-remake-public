/*
 * 开局设置验证 —— 直接以原版存档为基准
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  startingMoney,
  DEFAULT_INITIAL_FUND,
  NO_WIN_CONDITIONS,
  hasWinConditions,
  GAME_TIME_DAYS,
  VICTORY_FACTORS,
  GAME_INITIAL_FUNDS,
  winConditionsOf,
} from './setup.ts';
import { CHARACTERS, characterByKey } from '@rich4/data';
import { parseSave } from '../loaders/save.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const SAVE1 = `${ROOT}/Rich4/SAVE1.DAT`;

describe('初始资金', () => {
  it('默认 300000（两个原版存档实证）', () => {
    expect(DEFAULT_INITIAL_FUND).toBe(300_000);
  });

  it('现金 + 存款 = 初始资金（对全部 12 个角色成立）', () => {
    for (const ch of CHARACTERS) {
      const m = startingMoney(ch.id, DEFAULT_INITIAL_FUND);
      expect(m.cash + m.moneyInBank, ch.name).toBe(DEFAULT_INITIAL_FUND);
    }
  });

  it('★ 与 SAVE1.DAT 中三名未行动玩家的拆分精确一致', () => {
    // 这三条是 init_cash_ratio 语义的直接证据
    expect(startingMoney(characterByKey('sunxiaomei').id, 300_000))
      .toEqual({ cash: 150_000, moneyInBank: 150_000 }); // ratio 50
    expect(startingMoney(characterByKey('atubo').id, 300_000))
      .toEqual({ cash: 120_000, moneyInBank: 180_000 }); // ratio 40
    expect(startingMoney(characterByKey('jinbeibei').id, 300_000))
      .toEqual({ cash: 240_000, moneyInBank: 60_000 });  // ratio 80
  });

  it('小丹尼 ratio=55 → 165000/135000', () => {
    // SAVE1 中他显示 150000/150000，因其为当前玩家、已存入 15000（见 F-001）
    expect(startingMoney(characterByKey('xiaodanni').id, 300_000))
      .toEqual({ cash: 165_000, moneyInBank: 135_000 });
  });

  it('不同初始资金按比例缩放', () => {
    const m = startingMoney(characterByKey('atubo').id, 1_000_000);
    expect(m).toEqual({ cash: 400_000, moneyInBank: 600_000 });
  });

  it('整数运算，向零取整', () => {
    // 忍太郎 ratio=70；777 × 70 / 100 = 543.9 → 543
    const m = startingMoney(characterByKey('rentailang').id, 777);
    expect(m.cash).toBe(543);
    expect(m.moneyInBank).toBe(777 - 543);
  });

  it('未知角色编号抛错', () => {
    expect(() => startingMoney(99, 300_000)).toThrow();
  });
});

describe('胜负条件', () => {
  it('默认无限制', () => {
    expect(hasWinConditions(NO_WIN_CONDITIONS)).toBe(false);
  });

  it('任一项非 0 即视为有条件', () => {
    expect(hasWinConditions({ targetDays: 100, targetWealth: 0 })).toBe(true);
    expect(hasWinConditions({ targetDays: 0, targetWealth: 5_000_000 })).toBe(true);
  });
});

describe('两条下拉的值表（exe 取证）', () => {
  it('★ 遊戲時間表 @0x46cbe8 = 0/730/365/182/91/30 天', () => {
    expect([...GAME_TIME_DAYS]).toEqual([0, 730, 365, 182, 91, 30]);
  });

  it('★ 勝利條件倍率表 @0x46cc00 = 0/100/50/10/5/3', () => {
    expect([...VICTORY_FACTORS]).toEqual([0, 100, 50, 10, 5, 3]);
  });

  it('★ 开局换算 = 开局资金 × 倍率（VA 0x0040737d..0x004073a3）', () => {
    // 第 1 档资金 20 万 × 100 倍 = 2000 万；730 天
    expect(winConditionsOf(1, 1, 1)).toEqual({ targetDays: 730, targetWealth: 20_000_000 });
    // 默认档（0 号资金 30 万、两条下拉第 0 档）→ 两条都無限
    expect(winConditionsOf(0, 0, 0)).toEqual(NO_WIN_CONDITIONS);
    // 最低档 1 万 × 3 倍 = 3 万
    expect(winConditionsOf(5, 5, 5)).toEqual({ targetDays: 30, targetWealth: 30_000 });
  });

  it('★ 六档资金逐一乘 3 倍（最低那档最容易看出「不是按 30 万算」）', () => {
    const got = GAME_INITIAL_FUNDS.map((f, i) => winConditionsOf(i, 0, 5).targetWealth);
    expect(got).toEqual([900_000, 600_000, 300_000, 150_000, 90_000, 30_000]);
  });
});

describe.skipIf(!existsSync(SAVE1))('SAVE1.DAT 交叉验证', () => {
  it('每名玩家的现金+存款均等于初始资金', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE1)));
    for (const p of save.players) {
      // 该存档中四人（含三名 who_plays=0 者）都还持有完整开局资金
      expect(p.cash + p.moneyInBank, `玩家${p.index}`).toBe(DEFAULT_INITIAL_FUND);
    }
  });

  it('三名未行动玩家的拆分与其角色 ratio 吻合', () => {
    const save = parseSave(new Uint8Array(readFileSync(SAVE1)));
    let matched = 0;
    for (const p of save.players) {
      const expectM = startingMoney(p.character, DEFAULT_INITIAL_FUND);
      if (p.cash === expectM.cash && p.moneyInBank === expectM.moneyInBank) matched++;
    }
    // 四人中至少三人精确吻合（当前玩家已行动过）
    expect(matched).toBeGreaterThanOrEqual(3);
  });
});
