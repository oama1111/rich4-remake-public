/*
 * 「休息一回合」到底有没有生效 —— 第九份試玩回報 #3
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回報（Charles，`feedback/20260922-171933360-manual-Charles.json`）：
 * 「新闻事件：下大雨行人休息一回合，好像只影响了我自己，理论上应该是所有行人
 *  （没有用机车/汽车的角色）都原地休息一回合吧？」
 *
 * 查證結論：**目標選擇一直是對的**（`news-effects.ts` 的 `stopPedestrians` 分支遍歷
 * 全體玩家、只跳過出局者與交通方式不符者；回報者自己的 dump 也顯示四人
 * `trafficMethod=0` 全部 `stopping = 128`）。缺的是**「讀」這一側** ——
 * `blocking.stopping` 沒有消費者，於是**誰都沒停**；唯一會變的行為是當前行動者的
 * GO 鈕被畫成「禁止通行」，而只有人類有 GO 鈕 ⇒ 看起來像「只有我自己停了」。
 *
 * 閘門放在 `rollDice`（不是 `startTurn`）：原版 `0x4012a7` / `fcn_0040dd1f` 都在
 * **真正走子**那一步，而 AI 的股票 / 卡片 / 道具決策排在它之前。
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology } from '@rich4/core';
import { makeGameState, makeLand, makeNode, makePlayer, reduce } from '@rich4/core';

const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
    makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
  ],
  lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 1, level: 0, landPrice: 1000 })],
};

/** 玩家 0 站在第 1 格、輪到他擲骰 */
function awaitingRoll(stopping: number, trafficMethod = 0): GameState {
  return makeGameState({
    players: [
      makePlayer({
        index: 0,
        nodeId: 1,
        trafficMethod,
        blocking: { ...makePlayer().blocking, stopping },
      }),
      makePlayer({ index: 1, nodeId: 2 }),
      makePlayer({ index: 2, nodeId: 1 }),
      makePlayer({ index: 3, nodeId: 2 }),
    ],
    currentPlayer: 0,
    phase: 'awaitingRoll',
    landOwner: [0, 1],
    landLevel: [0, 0],
    landType: [0, 0],
  });
}

describe('★ blocking.stopping 真的會讓這一個回合走不動', () => {
  it('★★ 新聞寫下的 1 ⇒ 輪到他時已被遞減成 0x80 ⇒ 這回合直接收場', () => {
    const before = awaitingRoll(1);
    const after = reduce(before, { type: 'rollDice' }, topo);
    expect(after.phase, '不進 moving，直接進 turnEnd').toBe('turnEnd');
    expect(after.stepsRemaining).toBe(0);
    expect(after.dice, '沒有擲骰').toEqual(before.dice);
  });

  it('★★ 0x80（待釋放那一檔）同樣走不動 —— `!== 0` 而不是 `=== 1`', () => {
    const before = awaitingRoll(0x80);
    const after = reduce(before, { type: 'rollDice' }, topo);
    expect(after.phase).toBe('turnEnd');
  });

  it('★ 不消耗隨機數（C-DET-4：同種子重放不能被這一條打亂）', () => {
    const before = awaitingRoll(1);
    const after = reduce(before, { type: 'rollDice' }, topo);
    expect(after.rngState, 'rngState 一個位都不動').toBe(before.rngState);
  });

  it('★ 沒有停留 ⇒ 照常擲骰走子（不能把正常回合也擋掉）', () => {
    const before = awaitingRoll(0);
    const after = reduce(before, { type: 'rollDice' }, topo);
    expect(after.phase).toBe('moving');
    expect(after.stepsRemaining).toBeGreaterThan(0);
    expect(after.rngState).not.toBe(before.rngState);
  });

  it('★ 有載具的人也一樣只看自己那一格（`stopping` 才是判據，不是交通方式）', () => {
    // 新聞 16 只寫徒步者；這一條釘的是「閘門本身不按交通方式分流」
    const before = awaitingRoll(1, 3);
    expect(reduce(before, { type: 'rollDice' }, topo).phase).toBe('turnEnd');
    expect(reduce(awaitingRoll(0, 3), { type: 'rollDice' }, topo).phase).toBe('moving');
  });

  it('★ 逐回合遞減：1 → 0x80 → 0，所以只丟**一個**回合', () => {
    // 這一條釘住閘門與 rules/blocking.ts 兩段式的配合（不是重測遞減本身）
    const one = reduce(awaitingRoll(1), { type: 'rollDice' }, topo);
    expect(one.phase).toBe('turnEnd');
    // 下一輪（遞減一次之後）已經恢復
    const recovered = reduce(awaitingRoll(0), { type: 'rollDice' }, topo);
    expect(recovered.phase).toBe('moving');
  });
});
