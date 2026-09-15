/*
 * 每月結算 + 頒獎屏的版面、摘要与演出帧序
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编抄（VA 见 `monthly-screen.ts` 的注释），把最容易
 * 写错的几条钉住：
 *   ① **结算屏那一行**：头像/数字球在小气泡那一列，名字/现金/存款/利息
 *      四行都落在气泡局部 `(24,70)` 起、行距 70；
 *   ② **摘要来自 before → after 的 diff**：利息 = 存款增量（= `trunc(存款×0.1)`）；
 *   ③ **頒獎判据**：`(最高 − 次高) / 最高 > 0.4`，且最高分或次高分为 0 时无人获奖；
 *   ④ **状态机**：结算屏先逐行点亮，确认后才进頒獎屏，頒獎屏叠完还要再一拍才关。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  applyMonthlyInterest,
  isAlive,
  newGame,
  parseMap,
  type GameState,
  type MapTopology,
  type Player,
} from '@rich4/core';
import {
  MONTHLY_AVATAR_FRAME,
  MONTHLY_AVATAR_STRIDE,
  MONTHLY_AWARD_PATCH,
  MONTHLY_BAR_FRAME,
  MONTHLY_BAR_X,
  MONTHLY_BAR_Y,
  MONTHLY_BUBBLE_AT,
  MONTHLY_CHUNK,
  MONTHLY_CHAMPION,
  MONTHLY_DETAIL_AT,
  MONTHLY_DETAIL_LABELS,
  MONTHLY_LABELS,
  MONTHLY_NO_AWARD,
  MONTHLY_RESOURCE,
  MONTHLY_ROW_AT,
  MONTHLY_ROW_STEP,
  MONTHLY_SEAT_BASE_Y,
  MONTHLY_SEAT_FRAME,
  MONTHLY_SEAT_X,
  MONTHLY_SLOTS,
  MONTHLY_TRAGIC,
  awardScore,
  monthlyAward,
  monthlyDetailLines,
  monthlyPlaybackStart,
  monthlyPlaybackTick,
  monthlyRowLayout,
  monthlyRowText,
  monthlyScreen,
  monthlyScreenState,
  monthlySummary,
  pickAward,
  resetMonthlyScreen,
  type MonthlyPlayback,
} from './monthly-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  素材 @source `read_mkf(panel_mkf, 0x19, 0, 0)` VA 0x00439c04
// ============================================================

describe('用到的图 @source 0x00439c04 / 0x0043849e', () => {
  it('★ 全部素材都在 Panel.mkf 资源 25（83 张）', () => {
    expect(MONTHLY_RESOURCE).toBe(25);
    expect(MONTHLY_CHUNK.bg).toBe(0);
    expect(MONTHLY_CHUNK.bubble).toBe(1);
    expect(MONTHLY_CHUNK.plate).toBe(2);
  });

  it('★ 数字球 = 图 `6+帧`、金币 = 图 10 @source 0x00439d02 / 0x00439d1d', () => {
    expect(MONTHLY_CHUNK.digitFirst).toBe(6);
    expect(MONTHLY_CHUNK.coin).toBe(10);
    // 资源 25 里 6..9 正好是 3D 的 1/2/3/4，10 是金币
    expect(MONTHLY_CHUNK.digitFirst + 3).toBe(9);
  });

  it('★ 4 块窄板 = 图 11..14、4 列竖栏 = 图 15..18 @source 0x0043849e / 0x004387f9', () => {
    expect(MONTHLY_CHUNK.barFirst).toBe(11);
    expect(MONTHLY_CHUNK.columnFirst).toBe(15);
    // 窄板与竖栏**首尾相接**：11..14 之后紧接着 15..18
    expect(MONTHLY_CHUNK.barFirst + MONTHLY_SLOTS).toBe(MONTHLY_CHUNK.columnFirst);
  });

  it('★ 头像 = 图 `3×角色 + 47 + 帧`（12 角色 × 3 帧 = 47..82）@source 0x00437c9f', () => {
    expect(MONTHLY_CHUNK.avatarFirst).toBe(47);
    expect(MONTHLY_AVATAR_STRIDE).toBe(3);
    // 12 个角色、每角色 3 帧，正好用完 47..82 —— 包里共 83 张（0..82）
    expect(MONTHLY_CHUNK.avatarFirst + 12 * MONTHLY_AVATAR_STRIDE - 1).toBe(82);
  });

  it('★ 頒獎屏 4 块窄板的帧与落点 x @source 0x475948 / 0x475918', () => {
    expect(MONTHLY_BAR_FRAME).toEqual([16, 17, 15, 16]);
    // 落点 x 是拿同一个「帧」再查那张 4 列网格表 —— 值就是 16/17/15/16
    expect(MONTHLY_BAR_X).toEqual([16, 17, 15, 16]);
    expect(MONTHLY_BAR_Y).toBe(0x11);
    // 表里第 0 项就是 16，所以「帧 → x」在槽 0 上是自指的
    expect(MONTHLY_BAR_X[0]).toBe(MONTHLY_BAR_FRAME[0]);
  });
});

// ============================================================
//  版面（layout 快照）
// ============================================================

/** 最少一个玩家的状态 —— 只喂 `players`，其余字段对齐 `newGame` 的形状 */
function playerOf(index: number, character: number): Player {
  return {
    index,
    character,
    whoPlays: 2,
    xpos: 0,
    ypos: 0,
    nodeId: 1,
    lastNodeId: 1,
    direction: 0,
    trafficMethod: 0,
    ndices: 1,
    isMale: true,
    aiFlags: 3,
    cashRatio: 50,
    loanRatio: 50,
    stockRatio: 50,
    personality: 1,
    cash: 0,
    moneyInBank: 0,
    loan: 0,
    specialFinance: 0,
    loanDueDate: 0,
    points: 0,
    blocking: {
      inHotel: 0,
      disappearing: 0,
      inPrison: 0,
      inHospital: 0,
      sleeping: 0,
      sleepWalking: 0,
      stopping: 0,
      tortoiseWalking: 0,
    },
    daysRejectedByBank: 0,
    bankFreezeDays: 0,
    godInfo: 0,
    f64: 0,
    cards: [],
    tools: [],
    totalWinterSleepDays: 0,
    alliedPlayer: 0,
    alliedDays: 0,
    insuranceDays: 0,
    savedTrafficMethod: 0,
    savedNdices: 1,
    misfortune: 0,
    fortune: 0,
    luck: 0,
    hostility: [0, 0, 0, 0],
    monthlyPaid: 0,
    monthlyReceived: 0,
  };
}

/** 只用 `players`（+ 首富估值要的 holdings / market）的假状态 */
function fakeState(players: readonly Player[]): GameState {
  return {
    players: [...players],
    holdings: [],
    market: { stocks: Array.from({ length: 12 }, () => ({ price: 0 })) },
  } as unknown as GameState;
}

describe('★ layout 快照：结算屏每行的摆位 @source 0x00439cd7 起', () => {
  it('★ 四列的 x 是 60/180/300/420（一步 120）@source 0x475978', () => {
    expect(MONTHLY_SEAT_X).toEqual([60, 180, 300, 420]);
    for (let i = 0; i < MONTHLY_SLOTS; i++) {
      expect(MONTHLY_SEAT_X[i]).toBe(60 + i * 120);
    }
  });

  it('★ 四列的帧是 16/17/15/16 @source 0x475960', () => {
    expect(MONTHLY_SEAT_FRAME).toEqual([16, 17, 15, 16]);
  });

  it('★ 头像的 y = 330 − h[帧] + y[帧] @source 0x00439cbf 的 `0x14a`', () => {
    expect(MONTHLY_SEAT_BASE_Y).toBe(0x14a);
    expect(MONTHLY_SEAT_BASE_Y).toBe(330);
    const state = fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);
    for (let i = 0; i < MONTHLY_SLOTS; i++) {
      const at = monthlyRowLayout(state, i);
      const f = MONTHLY_SEAT_FRAME[i]!;
      const size = MONTHLY_AVATAR_FRAME[f]!;
      expect(at.avatar.y).toBe(330 - size.h + size.y);
      // 三帧的 height/y 都是 (72,36) → 四列同高，y = 294
      expect(at.avatar.y).toBe(294);
    }
  });

  it('★ 头像图号 = 3×角色 + 47 + 帧', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 5), playerOf(2, 11)]);
    expect(monthlyRowLayout(state, 0).avatar.chunk).toBe(3 * 0 + 47 + 16);
    expect(monthlyRowLayout(state, 1).avatar.chunk).toBe(3 * 5 + 47 + 17);
    expect(monthlyRowLayout(state, 2).avatar.chunk).toBe(3 * 11 + 47 + 15);
  });

  it('★ 数字球固定在 y = 10，图号 = 6 + 帧 @source 0x00439d02 `push 0xa`', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 1)]);
    expect(monthlyRowLayout(state, 0).digit).toEqual({ x: 60, y: 10, chunk: 6 + 16 });
    expect(monthlyRowLayout(state, 1).digit).toEqual({ x: 180, y: 10, chunk: 6 + 17 });
  });

  it('★ 四列文字都在气泡局部、行距 70 @source 0x00439d0d', () => {
    expect(MONTHLY_ROW_STEP).toBe(70);
    expect(MONTHLY_BUBBLE_AT).toEqual({ x: 0x18, y: 0x46 });
    const state = fakeState([
      playerOf(0, 0),
      playerOf(1, 1),
      playerOf(2, 2),
      playerOf(3, 3),
    ]);
    for (let i = 0; i < MONTHLY_SLOTS; i++) {
      const at = monthlyRowLayout(state, i);
      const dy = i * MONTHLY_ROW_STEP;
      expect(at.name).toEqual({
        x: MONTHLY_BUBBLE_AT.x + MONTHLY_ROW_AT.name.dx,
        y: MONTHLY_BUBBLE_AT.y + MONTHLY_ROW_AT.name.dy + dy,
      });
      expect(at.cash).toEqual({
        x: MONTHLY_BUBBLE_AT.x + MONTHLY_ROW_AT.cash.dx,
        y: MONTHLY_BUBBLE_AT.y + MONTHLY_ROW_AT.cash.dy + dy,
      });
      // 金币与现金是同一个落点（原版先 blit 金币、再 flag 1 画数字）
      expect(at.coin).toEqual(at.cash);
      expect(at.bank.y - at.cash.y).toBe(MONTHLY_ROW_AT.bank.dy - MONTHLY_ROW_AT.cash.dy);
      expect(at.interestValue.y - at.bank.y).toBe(
        MONTHLY_ROW_AT.interestValue.dy - MONTHLY_ROW_AT.bank.dy,
      );
    }
  });

  it('★ 完整快照（4 人，角色 0/1/2/3）', () => {
    const state = fakeState([
      playerOf(0, 0),
      playerOf(1, 1),
      playerOf(2, 2),
      playerOf(3, 3),
    ]);
    expect(
      [0, 1, 2, 3].map((i) => monthlyRowLayout(state, i)),
    ).toMatchInlineSnapshot(`
      [
        {
          "avatar": {
            "chunk": 63,
            "x": 60,
            "y": 294,
          },
          "bank": {
            "x": 100,
            "y": 202,
          },
          "cash": {
            "x": 44,
            "y": 116,
          },
          "coin": {
            "x": 44,
            "y": 116,
          },
          "digit": {
            "chunk": 22,
            "x": 60,
            "y": 10,
          },
          "index": 0,
          "interestLabel": {
            "x": 70,
            "y": 300,
          },
          "interestValue": {
            "x": 100,
            "y": 300,
          },
          "name": {
            "x": 69,
            "y": 116,
          },
          "plate": {
            "x": 69,
            "y": 116,
          },
        },
        {
          "avatar": {
            "chunk": 67,
            "x": 180,
            "y": 294,
          },
          "bank": {
            "x": 100,
            "y": 272,
          },
          "cash": {
            "x": 44,
            "y": 186,
          },
          "coin": {
            "x": 44,
            "y": 186,
          },
          "digit": {
            "chunk": 23,
            "x": 180,
            "y": 10,
          },
          "index": 1,
          "interestLabel": {
            "x": 70,
            "y": 370,
          },
          "interestValue": {
            "x": 100,
            "y": 370,
          },
          "name": {
            "x": 69,
            "y": 186,
          },
          "plate": {
            "x": 69,
            "y": 186,
          },
        },
        {
          "avatar": {
            "chunk": 68,
            "x": 300,
            "y": 294,
          },
          "bank": {
            "x": 100,
            "y": 342,
          },
          "cash": {
            "x": 44,
            "y": 256,
          },
          "coin": {
            "x": 44,
            "y": 256,
          },
          "digit": {
            "chunk": 21,
            "x": 300,
            "y": 10,
          },
          "index": 2,
          "interestLabel": {
            "x": 70,
            "y": 440,
          },
          "interestValue": {
            "x": 100,
            "y": 440,
          },
          "name": {
            "x": 69,
            "y": 256,
          },
          "plate": {
            "x": 69,
            "y": 256,
          },
        },
        {
          "avatar": {
            "chunk": 72,
            "x": 420,
            "y": 294,
          },
          "bank": {
            "x": 100,
            "y": 412,
          },
          "cash": {
            "x": 44,
            "y": 326,
          },
          "coin": {
            "x": 44,
            "y": 326,
          },
          "digit": {
            "chunk": 22,
            "x": 420,
            "y": 10,
          },
          "index": 3,
          "interestLabel": {
            "x": 70,
            "y": 510,
          },
          "interestValue": {
            "x": 100,
            "y": 510,
          },
          "name": {
            "x": 69,
            "y": 326,
          },
          "plate": {
            "x": 69,
            "y": 326,
          },
        },
      ]
    `);
  });

  it('★ 頒獎屏状态 1 那一小块是**裁切拷贝**、不是缩放 @source 0x00437fff', () => {
    // `fcn_0045643d(dst, 图 1, x=0x46, y=0x18, x_move=0x19a, y_move=0xba, w=0x46, h=0x18)`
    expect(MONTHLY_AWARD_PATCH).toEqual({
      srcX: 0x46,
      srcY: 0x18,
      w: 0x46,
      h: 0x18,
      dstX: 0x18,
      dstY: 0x46,
    });
    // 拷贝尺寸 70×24 落在源图 290×201 之内
    expect(MONTHLY_AWARD_PATCH.srcX + MONTHLY_AWARD_PATCH.w).toBeLessThanOrEqual(290);
    expect(MONTHLY_AWARD_PATCH.srcY + MONTHLY_AWARD_PATCH.h).toBeLessThanOrEqual(201);
    // 目的地就是「存款」气泡那一点
    expect(MONTHLY_AWARD_PATCH.dstX).toBe(MONTHLY_BUBBLE_AT.x);
    expect(MONTHLY_AWARD_PATCH.dstY).toBe(MONTHLY_BUBBLE_AT.y);
  });
});

// ============================================================
//  摘要：从 before → after 的 diff 取
// ============================================================

/** 造一份 「月结前 → 月结后」 的最小对 */
function settlePair(players: readonly Partial<Player>[]): {
  before: GameState;
  after: GameState;
} {
  const before = fakeState(
    players.map((p, i) => ({ ...playerOf(i, i), moneyInBank: 0, ...p })),
  );
  const after = fakeState(
    players.map((p, i) => {
      const b = before.players[i]!;
      return { ...b, moneyInBank: applyMonthlyInterest(b.moneyInBank, b.loan) };
    }),
  );
  return { before, after };
}

describe('★ 月结摘要 = before → after 的 diff', () => {
  it('★ 利息 = 存款增量 = `trunc(存款 × 0.1)`（有贷款则 0）', () => {
    const { before, after } = settlePair([
      { character: 0, moneyInBank: 100000 },
      { character: 1, moneyInBank: 5000 },
      { character: 2, moneyInBank: 100000, loan: 1 },
      { character: 3, moneyInBank: 0 },
    ]);
    const v = monthlySummary(before, after);
    expect(v.rows.map((r) => r.interest)).toEqual([10000, 500, 0, 0]);
    // 规则侧同一个函数算出来的差值，必须与摘要一致
    expect(v.rows[0]!.interest).toBe(
      applyMonthlyInterest(100000, 0) - 100000,
    );
  });

  it('★ 不在场的玩家（`whoPlays === 0`）不出现在摘要里 @source 0x00439c93', () => {
    const { before, after } = settlePair([
      { character: 0 },
      { character: 1, whoPlays: 0 },
      { character: 2 },
      { character: 3, whoPlays: 0 },
    ]);
    expect(monthlySummary(before, after).rows.map((r) => r.index)).toEqual([0, 2]);
  });

  it('★ 收入 / 支出两个本月累计照样带上（頒獎屏要用）', () => {
    const { before, after } = settlePair([
      { character: 0, monthlyPaid: 26000, monthlyReceived: 394432 },
    ]);
    const row = monthlySummary(before, after).rows[0]!;
    expect(row.monthlyPaid).toBe(26000);
    expect(row.monthlyReceived).toBe(394432);
  });

  it('★ 角色名取自 CHARACTERS', () => {
    const { before, after } = settlePair([{ character: 3 }]);
    expect(monthlySummary(before, after).rows[0]!.name).toBe('錢夫人');
  });

  it('★ 文字快照：有贷款画红字 `貸款中`', () => {
    const { before, after } = settlePair([
      { character: 0, cash: 12345, moneyInBank: 100000 },
      { character: 1, cash: -500, moneyInBank: 0, loan: 7000 },
    ]);
    const rows = monthlySummary(before, after).rows;
    expect(rows.map(monthlyRowText)).toMatchInlineSnapshot(`
      [
        {
          "bank": "$110,000",
          "bankLabel": "存款：",
          "cash": "$12,345",
          "interest": "$10,000",
          "interestLabel": "利息：",
          "loan": false,
          "name": "約翰喬",
        },
        {
          "bank": "$0",
          "bankLabel": "存款：",
          "cash": "$-500",
          "interest": "貸款中",
          "interestLabel": "利息：",
          "loan": true,
          "name": "沙隆巴斯",
        },
      ]
    `);
    expect(MONTHLY_LABELS.loan).toBe('貸款中');
  });
});

// ============================================================
//  頒獎判据 @source fcn_00437d1a
// ============================================================

describe('★ 頒獎判据 @source 0x00437d1a / 0x00437dfe', () => {
  it('★ 分公式 = (支出 − 收入) + 冬眠天数×物价×2500 + 衰運×10', () => {
    const p: Player = {
      ...playerOf(0, 0),
      monthlyPaid: 26000,
      monthlyReceived: 1000,
      totalWinterSleepDays: 2,
      misfortune: 5,
    };
    expect(awardScore(p, 1)).toBe(26000 - 1000 + 2 * 1 * 2500 + 5 * 10);
    expect(awardScore(p, 3)).toBe(26000 - 1000 + 2 * 3 * 2500 + 50);
  });

  it('★ 领先 0.4 倍：`3×最高 > 5×次高` 才颁奖', () => {
    // 100 / 60：差值 40 → 40/100 = 0.4 → **不**颁奖（原版是 `jbe`）
    expect(pickAward([100, 60, 0, 0])).toBe(-1);
    // 100 / 59：0.41 → 颁奖
    expect(pickAward([100, 59, 0, 0])).toBe(0);
    // 最大者在第 2 位
    expect(pickAward([59, 100, 0, 0])).toBe(1);
  });

  it('★ 最高分为 0 或次高分为 0 → 无人获奖（只有一个人在场也一样）', () => {
    expect(pickAward([])).toBe(-1);
    expect(pickAward([0])).toBe(-1);
    expect(pickAward([1000])).toBe(-1); // 次高分 = 0
    expect(pickAward([0, 0, 0, 0])).toBe(-1);
    // 负分：最高仍是 0 → 不颁
    expect(pickAward([-5, -3])).toBe(-1);
  });

  it('★ 与「先取最高、把它清零后再取最高」的朴素实现逐例交叉验证', () => {
    /** core `pickAwardWinner` 用的那套朴素算法 */
    const naive = (scores: readonly number[]): number => {
      let max = 0;
      let at = 0;
      for (let i = 0; i < scores.length; i++) {
        if (max < scores[i]!) {
          max = scores[i]!;
          at = i;
        }
      }
      let second = 0;
      for (let i = 0; i < scores.length; i++) {
        const v = scores[i] === max ? 0 : scores[i]!;
        if (second < v) second = v;
      }
      if (max === 0 || second === 0) return -1;
      return 3 * max > 5 * second ? at : -1;
    };
    const vals = [-3, 0, 1, 4, 7];
    for (const a of vals) {
      for (const b of vals) {
        for (const c of vals) {
          for (const d of vals) {
            const s = [a, b, c, d];
            expect(pickAward(s)).toBe(naive(s));
          }
        }
      }
    }
  });

  it('★ 平手：两人同分时最高分者只有一个「最高」，次高 = 同分值 → 不颁', () => {
    // 100/100：朴素算法会把两个 100 都清零 → second = 0 → 不颁
    expect(pickAward([100, 100])).toBe(-1);
    // 100/100/10：清零两个 100 后 second = 10 → 90/100 = 0.9 > 0.4 → 颁给先出现的
    expect(pickAward([100, 100, 10])).toBe(0);
  });

  it('★ 无人获奖时 `winner = -1`，收尾那句换成「本月悲情人物是」', () => {
    const { before, after } = settlePair([{ character: 0 }, { character: 1 }]);
    const award = monthlyAward(before, after, {
      nodes: [],
      lands: [],
      facilities: [],
    } satisfies MapTopology);
    expect(award.winner).toBe(-1);
    expect(MONTHLY_TRAGIC).toBe('本月悲情人物是');
    expect(MONTHLY_CHAMPION).toBe('本月冠軍是');
    expect(MONTHLY_NO_AWARD).toBe('別灰心，再加油喔！');
  });

  it('★ 详情五条的标签与取数 @source 串 0x464e5e / 0x464e50 / 0x464def / 0x464dfe / 0x464e0d', () => {
    const { before, after } = settlePair([
      { character: 0, cash: 1000, monthlyPaid: 11, monthlyReceived: 22, totalWinterSleepDays: 3 },
      { character: 1, cash: 999999, monthlyPaid: 0, monthlyReceived: 0 },
    ]);
    const topo = { nodes: [], lands: [], facilities: [] } satisfies MapTopology;
    const award = monthlyAward(before, after, topo);
    const lines = monthlyDetailLines(after, topo, award);
    expect(lines.map((l) => l.label)).toEqual([
      MONTHLY_DETAIL_LABELS.assets,
      MONTHLY_DETAIL_LABELS.cash,
      MONTHLY_DETAIL_LABELS.unexpectedLoss,
      MONTHLY_DETAIL_LABELS.unexpectedGain,
      MONTHLY_DETAIL_LABELS.unluckyDays,
    ]);
    // 1 号现金最多 → 首富是他；0 号支出 11 > 收入 22 是负分，
    // 但 1 号是 0 分 → 次高为 0 → 无人获奖，故后四条都按 0 画
    expect(award.winner).toBe(-1);
    expect(lines[0]!.value).toBe('$999,999');
    expect(lines[1]!.value).toBe('$0');
    expect(lines[4]!.value).toBe('0天');
  });

  it('★ 五条详情的行距与落点 @source 0x00438570 的 `push 0x172` 起', () => {
    expect(MONTHLY_DETAIL_AT.y0).toBe(0x172);
    expect(MONTHLY_DETAIL_AT.step).toBe(0x12);
    expect(MONTHLY_DETAIL_AT.x).toBe(0x140);
    expect(MONTHLY_DETAIL_AT.valueX).toBe(0x230);
  });
});

// ============================================================
//  演出状态机
// ============================================================

describe('★ 演出状态机', () => {
  it('★ 结算屏：先逐行点亮，全亮后停在「等确认」', () => {
    let p = monthlyPlaybackStart();
    expect(p).toEqual({
      phase: 'settle',
      revealed: 0,
      bars: 0,
      seats: 0,
      details: 0,
      closing: false,
    });
    // 4 行 → 3 拍点亮完
    p = monthlyPlaybackTick(p, 4)!;
    expect(p.revealed).toBe(1);
    p = monthlyPlaybackTick(p, 4)!;
    expect(p.revealed).toBe(2);
    p = monthlyPlaybackTick(p, 4)!;
    expect(p.revealed).toBe(3);
    // 全亮后再 tick 也不动（原版 `[0x48c42a]` 不变）
    expect(monthlyPlaybackTick(p, 4)).toEqual(p);
    expect(monthlyPlaybackTick(p, 4)!.phase).toBe('settle');
  });

  it('★ 只有 1 个人在场时第 0 拍就已经全亮', () => {
    const p = monthlyPlaybackStart();
    expect(monthlyPlaybackTick(p, 1)!.revealed).toBe(0);
  });

  it('★ 頒獎屏：铺 4 板 → 画 4 列 → 叠 5 条 → 再一拍才关', () => {
    let p: MonthlyPlayback = { ...monthlyPlaybackStart(), phase: 'award' };
    const seen: string[] = [];
    let guard = 0;
    while (guard++ < 40) {
      const next = monthlyPlaybackTick(p, 4);
      if (next === null) {
        seen.push('null');
        break;
      }
      p = next;
      seen.push(`${p.bars}/${p.seats}/${p.details}${p.closing ? '/closing' : ''}`);
    }
    expect(seen).toEqual([
      '1/0/0',
      '2/0/0',
      '3/0/0',
      '4/0/0',
      '4/1/0',
      '4/2/0',
      '4/3/0',
      '4/4/0',
      '4/4/1',
      '4/4/2',
      '4/4/3',
      '4/4/4',
      '4/4/5',
      '4/4/5/closing',
      'null',
    ]);
  });
});

// ============================================================
//  event / tick 生命周期（真地图）
// ============================================================

const MAP_PATH = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const runMap = existsSync(MAP_PATH) ? it : it.skip;

/** 最小 `UiScreenEnv` —— 只填本屏读得到的几项 */
function fakeEnv(state: GameState, topo: MapTopology, logs: string[]): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo,
    map: { nodes: [], lands: [] } as never,
    now: 0,
    stage: null as never,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: (m: string) => logs.push(m),
    playEffect: () => undefined,
  };
}

describe('★ event 判据：`totalMonths` 增了才起播', () => {
  runMap('★ 跨月 → 起播；没跨月 → 一次都不起播', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP_PATH)));
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    resetMonthlyScreen();
    const logs: string[] = [];
    const env = fakeEnv(base, topo, logs);

    // 没跨月：不起播
    monthlyScreen.event!(base, { ...base, totalDays: base.totalDays + 1 }, env);
    expect(monthlyScreenState().playing).toBe(false);

    // 跨月：起播（`totalMonths + 1`，存款也按 1.1 结算过）
    const before: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, moneyInBank: 100000 })),
    };
    const after: GameState = {
      ...before,
      totalMonths: before.totalMonths + 1,
      players: before.players.map((p) => ({
        ...p,
        moneyInBank: applyMonthlyInterest(p.moneyInBank, p.loan),
      })),
    };
    monthlyScreen.event!(before, after, env);
    expect(monthlyScreenState().playing).toBe(true);
    expect(monthlyScreen.active(env)).toBe(true);
    expect(monthlyScreenState().view?.rows).toHaveLength(
      after.players.filter((p) => isAlive(p)).length,
    );
    expect(monthlyScreenState().view?.rows.every((r) => r.interest === 10000)).toBe(true);

    // tick 到结算屏全亮
    for (let i = 0; i < 10; i++) monthlyScreen.tick!(env);
    expect(monthlyScreenState().playback?.phase).toBe('settle');
    expect(monthlyScreenState().playback?.revealed).toBe(
      (monthlyScreenState().view?.rows.length ?? 1) - 1,
    );

    // ★ 确认在**抬手**（`WM_LBUTTONUP` 0x202）：
    //   原版的分支表里**没有 `0x201`（按下）那一条**，故本屏根本不实现 `down`
    expect(monthlyScreen.down).toBeUndefined();
    expect(monthlyScreenState().playback?.phase).toBe('settle');
    monthlyScreen.up!(0, 0, env);
    expect(monthlyScreenState().playback?.phase).toBe('award');

    // 頒獎屏叠完之后还得再一拍才关屏（原版「等最后一次确认」那几步）
    const total = MONTHLY_SLOTS * 2 + 5 + 2; // 4 板 + 4 列 + 5 条详情 + closing + 收尾
    for (let i = 0; i < total - 1; i++) monthlyScreen.tick!(env);
    expect(monthlyScreenState().playback?.closing).toBe(true);
    expect(monthlyScreenState().playing).toBe(true);
    // 收尾也是抬手才关
    monthlyScreen.up!(0, 0, env);
    expect(monthlyScreenState().playing).toBe(false);
    expect(monthlyScreen.active(env)).toBe(false);
    resetMonthlyScreen();
  });

  it('★ 在场 0 人时不起播', () => {
    const dead = fakeState([{ ...playerOf(0, 0), whoPlays: 0 }]);
    resetMonthlyScreen();
    const env = fakeEnv(dead, { nodes: [], lands: [], facilities: [] }, []);
    monthlyScreen.event!(dead, { ...dead, totalMonths: 1 }, env);
    expect(monthlyScreenState().playing).toBe(false);
    resetMonthlyScreen();
  });
});
