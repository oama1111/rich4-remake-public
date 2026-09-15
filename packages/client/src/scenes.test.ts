/*
 * 場所背景的对应关系
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这些资源号是**目视认出来的**（每张 640×480 的底图长什么样一眼能认），
 * 所以这里钉的是「哪一种待决交互配哪一张」，外加「不要撞号」。
 */
import { describe, expect, it } from 'vitest';
import { SCENE, sceneFor } from './scenes.ts';
import { SPECIAL_KIND } from '@rich4/core';

describe('場所背景', () => {
  it('★ 几处先前认错的，现在钉住正确的号（见 docs/original-ui.md）', () => {
    expect(SCENE.assets).toBe(9); // 不是股市，是個人資產表
    expect(SCENE.monthlySettle).toBe(25); // 不是百貨公司，是每月結算
    expect(SCENE.stockMarket).toBe(75); // 股市在这儿
    expect(SCENE.shareholdings).toBe(76); // 持股彙總
    expect(SCENE.noticeBoard).toBe(73); // 公佈欄
  });

  it('每一屏一个资源号，不重复', () => {
    const ids = Object.values(SCENE);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('柜台类场所各自配对', () => {
    expect(sceneFor({ kind: 'bank', wealth: 0, loanCapacity: 0, specialFinance: null })).toBe(SCENE.bank);
    expect(sceneFor({ kind: 'lottery', available: [], price: 0, owned: 0 })).toBe(
      SCENE.lotteryCounter,
    );
    expect(sceneFor({ kind: 'auction', entityId: 1, basePrice: 0, bidders: [] })).toBe(SCENE.auction);
  });

  it('★ 卡片商店／道具商店**不走这条路** —— 它要叠资源 10 的十几张图，另有整屏实现', () => {
    expect(sceneFor({ kind: 'shop', points: 0, tools: [], cards: [], owned: { cards: [], tools: [] } })).toBeNull();
  });

  it('★ 探監與探病是两张不同的底图', () => {
    const prison = sceneFor({ kind: 'bail', place: 'prison', points: 0, candidates: [] });
    const hospital = sceneFor({ kind: 'bail', place: 'hospital', points: 0, candidates: [] });
    expect(prison).toBe(SCENE.prison);
    expect(hospital).toBe(SCENE.hospital);
    expect(prison).not.toBe(hospital);
  });

  it('小游戏：认出来的两个有底图，喜從天降没有', () => {
    const mini = (game: number) =>
      sceneFor({ kind: 'minigame', game, name: '', maxScore: 999 });
    expect(mini(SPECIAL_KIND.PENGUIN_DIG)).toBe(SCENE.penguinDig);
    expect(mini(SPECIAL_KIND.BALLOON)).toBe(SCENE.balloons);
    expect(mini(SPECIAL_KIND.GIFT_FROM_SKY)).toBeNull();
  });

  it('没有交互、或本来就在棋盘上办的，不铺底图', () => {
    expect(sceneFor(null)).toBeNull();
    expect(sceneFor({ kind: 'buyLand', landId: 1, name: '', price: 0 })).toBeNull();
    expect(sceneFor({ kind: 'upgradeLand', landId: 1, name: '', cost: 0 })).toBeNull();
  });
});
