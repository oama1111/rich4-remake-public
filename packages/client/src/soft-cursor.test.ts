/*
 * 软件指针（gap-audit WP-1：#5 #8 #9 #10）—— 判据与出处见 `soft-cursor.ts` 文件头
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND, type GameState } from '@rich4/core';
import {
  ARROW_CURSOR,
  CARD_CURSOR,
  CURSOR_TICK_MS,
  CursorClock,
  HAND_CURSOR,
  LOTTERY_CURSOR,
  cursorImageAt,
  cursorShape,
  localTurn,
  resolveCursor,
  showCursor,
  type CursorFrame,
} from './soft-cursor.ts';
import { SCREENS } from './screens.ts';
import { lotteryScreen } from './lottery-screen.ts';
import { researchScreen } from './research-screen.ts';
import { BALLOON_CURSOR, minigameScreen } from './minigame-screen.ts';
import { auctionScreen } from './auction-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

/** 棋盘上什么都没开、也不是本机真人等掷骰 —— 按过 GO 之后的那一段 */
const IDLE: CursorFrame = {
  screen: 'game',
  pick: null,
  dicePick: false,
  stockPick: false,
  amountWindow: false,
  atm: false,
  localInput: false,
  goPhase: false,
  spectator: false,
};

const ARROW = showCursor(ARROW_CURSOR);

describe('★ 指针形状 = `fcn_004021f8(图, 帧数, 每帧几拍)` 的实参（Data.mkf #0）', () => {
  it('★ 各屏那几支与 exe 的压栈逐位对上', () => {
    // 0x004017a6 默认箭头；0x0042fb08 / 0x0043776c / 0x00453135 关窗换回也是它
    expect(ARROW_CURSOR).toEqual({ image: 0x29, frames: 1, ticks: 0 });
    // ATM 0x004370ba / 0x0043714d、通用填数窗 0x00452cb1
    expect(HAND_CURSOR).toEqual({ image: 0x1b, frames: 1, ticks: 0 });
    // 樂透投注 0x0042f90c..0x0042f912
    expect(LOTTERY_CURSOR).toEqual({ image: 0x1c, frames: 1, ticks: 0 });
    // 紅卡 0x00444fea..0x00444ff0 / 黑卡 0x004450ae..0x004450b4：push 0xa / push 0xf / push 0xc
    expect(CARD_CURSOR).toEqual({ image: 12, frames: 15, ticks: 10 });
  });

  it('★ 20 ms 一拍（`timeSetEvent(0x14, …)` 0x004021a3）；`++拍 >= 每帧几拍` 换帧，`帧 == 帧数` 回 0', () => {
    expect(CURSOR_TICK_MS).toBe(20);
    // 卡片：每帧 10 拍 = 200 ms，15 帧（图 12..26）
    expect(cursorImageAt(CARD_CURSOR, 0)).toBe(12);
    expect(cursorImageAt(CARD_CURSOR, 199)).toBe(12);
    expect(cursorImageAt(CARD_CURSOR, 200)).toBe(13);
    expect(cursorImageAt(CARD_CURSOR, 2999)).toBe(26);
    expect(cursorImageAt(CARD_CURSOR, 3000)).toBe(12);
    // 单帧（`cmp word [0x48a170], 1 / jle` 0x0040200b）不动
    expect(cursorImageAt(ARROW_CURSOR, 1e6)).toBe(0x29);
  });
});

describe('★ `CursorClock`：换形状清帧号（0x0040222b）、拍只在画着时走（0x00401fdd）', () => {
  it('★ 换一支**不同的**形状 ⇒ 从第 0 帧起；同一支每帧再要一次不清', () => {
    const c = new CursorClock();
    expect(c.step(showCursor(CARD_CURSOR), 1000)).toBe(12);
    expect(c.step(showCursor(CARD_CURSOR), 1450)).toBe(14);
    expect(c.animated).toBe(true);
    expect(c.step(showCursor(cursorShape(5)), 1500)).toBe(5); // 悬停移开：红叉
    expect(c.animated).toBe(false);
    expect(c.step(showCursor(CARD_CURSOR), 1600)).toBe(12); // 移回来：重新从 12 翻起
  });

  it('★ 藏起期间动画停住、形状不变；放出来接着走', () => {
    const c = new CursorClock();
    c.step(showCursor(CARD_CURSOR), 0);
    expect(c.step(showCursor(CARD_CURSOR), 250)).toBe(13);
    expect(c.step(null, 300)).toBeNull(); // 画着的 300 ms 记下
    expect(c.shown).toBe(false);
    expect(c.shape).toEqual(CARD_CURSOR);
    // 藏了 10 秒 —— 不算
    expect(c.step(showCursor(CARD_CURSOR), 10_300)).toBe(13);
    expect(c.step(showCursor(CARD_CURSOR), 10_400)).toBe(14);
  });

  it('★ 触屏只画 `touch` 请求（小游戏准星）；藏起时不算', () => {
    const c = new CursorClock();
    c.step(showCursor(ARROW_CURSOR), 0);
    expect(c.touch).toBe(false);
    c.step(showCursor(cursorShape(9, 3, 5), true), 10);
    expect(c.touch).toBe(true);
    c.step(null, 20);
    expect(c.touch).toBe(false);
  });
});

describe('★★ #8：按过 GO 就藏、到要本机作答才放出来（`resolveCursor`）', () => {
  it('★ 棋盘上什么都不等本机 ⇒ 藏（走子、落点、影片、电脑 / 别人的回合）', () => {
    expect(resolveCursor(IDLE)).toBeNull();
  });

  it('★ 轮到本机真人、GO 鈕在场 ⇒ 箭头 0x29（0x00417e1c / 0x00418db9）', () => {
    expect(resolveCursor({ ...IDLE, goPhase: true })).toEqual(ARROW);
  });

  it('★ 作答窗：YES/NO / 选项框 / 商店 / 銀行 ⇒ 箭头；填数窗、ATM ⇒ 手指 0x1b（#9）', () => {
    expect(resolveCursor({ ...IDLE, localInput: true })).toEqual(ARROW);
    expect(resolveCursor({ ...IDLE, localInput: true, amountWindow: true })).toEqual(showCursor(HAND_CURSOR));
    expect(resolveCursor({ ...IDLE, atm: true })).toEqual(showCursor(HAND_CURSOR));
    expect(resolveCursor({ ...IDLE, dicePick: true })).toEqual(ARROW);
  });

  it('★ 选目标：那一支（道具图标 / 动画卡片 / 红叉 / 贴边箭头）盖过别的', () => {
    expect(resolveCursor({ ...IDLE, pick: CARD_CURSOR, goPhase: true })).toEqual(showCursor(CARD_CURSOR));
  });

  it('★ 接管整屏的那一屏说了算：演出类（没有 `cursor` 出口 ⇒ null）连 GO 那一拍也藏', () => {
    expect(resolveCursor({ ...IDLE, overlay: null, goPhase: true, localInput: true })).toBeNull();
    expect(resolveCursor({ ...IDLE, overlay: showCursor(LOTTERY_CURSOR) })).toEqual(showCursor(LOTTERY_CURSOR));
  });

  it('★ 不在棋盘上的屏（标题、设定、存读档、大厅、資產表）⇒ 箭头；道具 / 卡片欄 ⇒ 箭头（0x00445c76）', () => {
    for (const screen of ['title', 'setup', 'options', 'saveload', 'lobby', 'aiSettings', 'assets', 'inventory']) {
      expect(resolveCursor({ ...IDLE, screen })).toEqual(ARROW);
    }
  });

  it('★ 开局入场（角色登场）藏着：设定窗收场 0x0040698e 收起，到第一位真人 GO 才放', () => {
    expect(resolveCursor({ ...IDLE, screen: 'intro' })).toBeNull();
    expect(resolveCursor({ ...IDLE, screen: 'intro', goPhase: true })).toBeNull();
  });

  it('★ #9 股市屏：箭头；紅卡/黑卡选股 ⇒ 15 帧卡片；买卖填数窗 ⇒ 手指；弹訊息框 ⇒ 藏', () => {
    expect(resolveCursor({ ...IDLE, screen: 'stock' })).toEqual(ARROW);
    expect(resolveCursor({ ...IDLE, screen: 'stock', stockPick: true })).toEqual(showCursor(CARD_CURSOR));
    expect(resolveCursor({ ...IDLE, screen: 'stock', amountWindow: true })).toEqual(showCursor(HAND_CURSOR));
    expect(resolveCursor({ ...IDLE, screen: 'stock', stockPick: true, overlay: null })).toBeNull();
  });
});

// ============================================================
//  各屏的 `cursor` 出口（#9 #10）与联机旁观
// ============================================================

const player = (whoPlays: number): { whoPlays: number; points: number } => ({ whoPlays, points: 0 });

function envOf(opts: {
  currentPlayer?: number;
  players?: { whoPlays: number }[];
  localSeat?: number | null;
  pending?: unknown;
  now?: number;
}): UiScreenEnv {
  const state = {
    currentPlayer: opts.currentPlayer ?? 0,
    players: opts.players ?? [player(1), player(1)],
    pending: opts.pending ?? null,
    day: 1,
    month: 1,
    year: 1,
  } as unknown as GameState;
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [], facilities: [] } as never,
    map: null as never,
    now: opts.now ?? 0,
    stage: null as never,
    animation: false,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: () => undefined,
    playEffect: () => undefined,
    stopEffect: () => undefined,
    ...(opts.localSeat === undefined ? {} : { localSeat: opts.localSeat }),
  };
}

describe('★★ 仅本机：别人的回合不换、不放（`localTurn`）', () => {
  it('★ 单机 / 热座：当前是真人就放；电脑（whoPlays 2）/ 託管（bit2）不放', () => {
    expect(localTurn(envOf({}))).toBe(true);
    expect(localTurn(envOf({ localSeat: null }))).toBe(true);
    expect(localTurn(envOf({ players: [player(2), player(1)] }))).toBe(false);
    expect(localTurn(envOf({ players: [player(5), player(1)] }))).toBe(false);
  });

  it('★ 联机：只有轮到本机座位的那一端放；旁观端（坐 1 号、当前 0 号）不放', () => {
    expect(localTurn(envOf({ localSeat: 0 }))).toBe(true);
    expect(localTurn(envOf({ localSeat: 1 }))).toBe(false);
  });

  it('★ #9 樂透投注：本机真人 ⇒ 铅笔 0x1c；联机旁观 / 电脑的回合 ⇒ 藏', () => {
    expect(lotteryScreen.cursor!(envOf({}))).toEqual(showCursor(LOTTERY_CURSOR));
    expect(lotteryScreen.cursor!(envOf({ localSeat: 0 }))).toEqual(showCursor(LOTTERY_CURSOR));
    expect(lotteryScreen.cursor!(envOf({ localSeat: 1 }))).toBeNull();
    expect(lotteryScreen.cursor!(envOf({ players: [player(2), player(1)] }))).toBeNull();
  });

  it('★ 研究所面板：本机真人 ⇒ 箭头（0x0044035e）；旁观 ⇒ 藏', () => {
    expect(researchScreen.cursor!(envOf({ localSeat: 0 }))).toEqual(ARROW);
    expect(researchScreen.cursor!(envOf({ localSeat: 1 }))).toBeNull();
  });

  it('★ #10 財神接金幣：整局藏（这一屏从不 `fcn_00402460(1)`）—— 本机在玩、旁观都一样', () => {
    for (const localSeat of [null, 0, 1]) {
      const pending = { kind: 'minigame', game: SPECIAL_KIND.GIFT_FROM_SKY };
      // 跑过入场、进到接金幣那一段（每拍都问一次）
      for (let now = 0; now <= 3000; now += 100) {
        const env = envOf({ localSeat, pending, now });
        minigameScreen.tick!(env);
        expect(minigameScreen.cursor!(env)).toBeNull();
        expect(resolveCursor({ ...IDLE, overlay: minigameScreen.cursor!(env) })).toBeNull();
      }
      minigameScreen.tick!(envOf({ localSeat, pending: null, now: 4000 })); // 收局
    }
  });
});

describe('★ 哪几屏放指针、哪几屏不放（与 exe 的 `fcn_00402460(1)` 调用点对账）', () => {
  it('★ 演出类（地址段里没有 `call 0x402460`）没有 `cursor` 出口 ⇒ 一直藏着', () => {
    const presentation = ['shares', 'lottery-draw', 'monthly', 'eventBox', 'wheel', 'god-slot', 'notice', 'eventTail'];
    for (const id of presentation) {
      const s = SCREENS.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect(s!.cursor, id).toBeUndefined();
    }
  });

  it('★ 作答类都有 `cursor` 出口', () => {
    const input = [
      'magic',
      'facility-picker',
      'steal-picker',
      'scapegoat-picker',
      'notice-board',
      'auction',
      'lottery',
      'research',
      'minigame',
      'help',
      'big-map',
    ];
    for (const id of input) {
      const s = SCREENS.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect(typeof s!.cursor, id).toBe('function');
    }
    // 每一屏都归了类（新加的屏要在这里表态）
    expect(SCREENS.map((s) => s.id).sort()).toEqual(
      [...input, 'shares', 'lottery-draw', 'monthly', 'eventBox', 'wheel', 'god-slot', 'notice', 'eventTail'].sort(),
    );
  });
});

// ============================================================
//  D-CURSOR-ONLINE-1：联机里别人的回合放出箭头（需求方 2026-09-24 拍板的有意偏离）
// ============================================================

describe('★★ D-CURSOR-ONLINE-1：联机旁观端放出默认箭头 0x29；单机 / 热座与联机本机回合照原版', () => {
  /** 联机旁观端的一帧：坐 1 号、当前 0 号（`main.ts` 的 `!localSeatActive()`）*/
  const SPECTATOR: CursorFrame = { ...IDLE, spectator: true };
  const spectatorEnv = (): UiScreenEnv => envOf({ localSeat: 1, currentPlayer: 0 });
  const PRESENTATION = ['shares', 'lottery-draw', 'monthly', 'eventBox', 'wheel', 'god-slot', 'notice', 'eventTail'];

  it('★ 单机不变：电脑的回合（走子 / 落点 / 演出）照原版藏着', () => {
    // 电脑回合：没有 GO、没有作答窗，`spectator` 恒 false（单机 `net === null`）
    expect(resolveCursor(IDLE)).toBeNull();
    for (const id of PRESENTATION) {
      const s = SCREENS.find((x) => x.id === id)!;
      expect(resolveCursor({ ...IDLE, overlay: s.cursor?.(envOf({ players: [player(2), player(1)] })) ?? null }), id).toBeNull();
    }
    // 电脑的樂透 / 研究所 / 小游戏：一样藏着
    const ai = envOf({ players: [player(2), player(1)] });
    expect(resolveCursor({ ...IDLE, overlay: lotteryScreen.cursor!(ai) })).toBeNull();
    expect(resolveCursor({ ...IDLE, overlay: researchScreen.cursor!(ai) })).toBeNull();
  });

  it('★ 联机本机自己的回合：按过 GO（走子 / 落点 / 演出）照原版藏着；GO 鈕在场 ⇒ 箭头', () => {
    expect(resolveCursor({ ...IDLE, spectator: false })).toBeNull();
    expect(resolveCursor({ ...IDLE, spectator: false, overlay: null })).toBeNull();
    expect(resolveCursor({ ...IDLE, spectator: false, goPhase: true })).toEqual(ARROW);
    // 本机座位被託管的那一回合仍算本机的回合（`localSeatActive()` 为真）⇒ 照原版藏
    expect(resolveCursor({ ...IDLE, spectator: false, overlay: lotteryScreen.cursor!(envOf({ localSeat: 0, players: [player(5), player(1)] })) })).toBeNull();
  });

  it('★ 旁观别人（真人或电脑座位）走子 / 落点：箭头', () => {
    expect(resolveCursor(SPECTATOR)).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, screen: 'stock' })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, screen: 'stock', overlay: null })).toEqual(ARROW);
  });

  it('★ 旁观演出屏（新聞 / 命運 / 寶箱、神明老虎机、分紅、月結、開獎、轉盤、訊息框）：箭头', () => {
    for (const id of PRESENTATION) {
      const s = SCREENS.find((x) => x.id === id)!;
      // 演出屏没有 `cursor` 出口 ⇒ main.ts 交 `overlay: null`
      expect(resolveCursor({ ...SPECTATOR, overlay: s.cursor?.(spectatorEnv()) ?? null }), id).toEqual(ARROW);
    }
  });

  it('★ 旁观别人的樂透投注 / 研究所 / 拍賣：箭头（不换铅笔）', () => {
    expect(resolveCursor({ ...SPECTATOR, overlay: lotteryScreen.cursor!(spectatorEnv()) })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, overlay: researchScreen.cursor!(spectatorEnv()) })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, overlay: auctionScreen.cursor!(spectatorEnv()) })).toEqual(ARROW);
  });

  it('★ 旁观别人的商店 / 銀行 / 監獄醫院 / ATM：箭头（这几扇窗只给本机真人算 `localInput`）', () => {
    expect(resolveCursor({ ...SPECTATOR, localInput: false })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, localInput: true })).toEqual(ARROW);
  });

  it('★ 旁观小游戏：普通箭头，不给准星 / 靶圈（触屏照样不画 —— 请求里没有 `touch`）', () => {
    expect(resolveCursor({ ...SPECTATOR, overlay: null })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, overlay: showCursor(BALLOON_CURSOR, true) })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, overlay: showCursor(BALLOON_CURSOR, true) })!.touch).toBeUndefined();
    // 財神接金幣：玩家那台整局藏着（#10），旁观端照这条偏离给箭头
    const pending = { kind: 'minigame', game: SPECIAL_KIND.GIFT_FROM_SKY };
    const env = envOf({ localSeat: 1, pending, now: 0 });
    minigameScreen.tick!(env);
    expect(resolveCursor({ ...SPECTATOR, overlay: minigameScreen.cursor!(env) })).toEqual(ARROW);
    minigameScreen.tick!(envOf({ localSeat: 1, pending: null, now: 4000 })); // 收局
  });

  it('★ 别人的回合里本机真在作答（轮到本机举牌的拍賣出价、填数窗）：照它那一支', () => {
    expect(resolveCursor({ ...SPECTATOR, overlay: showCursor(ARROW_CURSOR) })).toEqual(ARROW);
    expect(resolveCursor({ ...SPECTATOR, amountWindow: true, localInput: true })).toEqual(showCursor(HAND_CURSOR));
  });

  it('★ 开局入场不算谁的回合：照原版藏着', () => {
    expect(resolveCursor({ ...SPECTATOR, screen: 'intro' })).toBeNull();
  });
});
