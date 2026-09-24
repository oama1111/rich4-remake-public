/*
 * 联机旁观：跟着行动者收场（第十二份試玩回報续）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方拍板：两位真人联机时，行动的那位把整屏提示（訊息框 / 事件框 / 转盘 / 老虎机 …）点掉就走了，
 * 另一台不该还按自己的计时一段段放完 —— **跟着行动者一起关**。
 *
 * 这里钉三件事：
 *   ① 判据 `presenterMovedOn`（「派出者」的反推本身由 core `client-driven-sender.test.ts`
 *      与 server `client-driven-sender.test.ts` 对着真服务器逐条核过）；
 *   ② `fastForwardPresentations`：只收演出类那几屏、每屏落到终态；
 *   ③ `main.ts` 的接线（源码钉，同 `reconnect-net.test.ts`）：收件箱每一拍在节拍闸**之前**问一次；
 *      `BLOCKING_PRESENTATIONS` 里的每一屏都实现了 `fastForward`（漏一屏 = 那一屏旁观端照旧落后）。
 * 各屏自己的 `fastForward` 语义由各屏的 `*.test.ts` 末尾那一组钉。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type Action, type GameState } from '@rich4/core';
import { fastForwardPresentations, presenterMovedOn } from './follow-presenter.ts';
import { BLOCKING_PRESENTATIONS } from './presentation-host.ts';
import { SCREENS } from './screens.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';

const HUMAN = 1;
const COMPUTER = 2;
const AUTOPILOT = 0x04;

/** 0、1 号真人，2、3 号电脑；`currentPlayer` 可调 */
function table(currentPlayer: number, over: Partial<Record<number, number>> = {}): GameState {
  const whoPlays = [HUMAN, HUMAN, COMPUTER, COMPUTER].map((w, i) => over[i] ?? w);
  return makeGameState({
    currentPlayer,
    players: whoPlays.map((w, i) => makePlayer({ index: i, character: i, whoPlays: w })),
  });
}

const ROLL: Action = { type: 'rollDice' };
const END: Action = { type: 'endTurn' };

describe('判据 presenterMovedOn：队首是**别的真人自己**派的', () => {
  it('★ 别的真人（本机 0、队首是 1 号真人的）⇒ 跟', () => {
    expect(presenterMovedOn(table(1), END, 0)).toBe(true);
    // 未入座（纯旁观）也照样跟
    expect(presenterMovedOn(table(1), END, null)).toBe(true);
  });

  it('★ 演出讲的是本机的事也照样跟行动者（1 号付过路费给本机 0 号）—— 判据只看派出者', () => {
    expect(presenterMovedOn(table(1), ROLL, 0)).toBe(true);
  });

  it('本机自己的 ⇒ 不跟（本机的回合驱动本来就等着自己的演出）', () => {
    expect(presenterMovedOn(table(0), ROLL, 0)).toBe(false);
  });

  it('电脑座位（服务器同一瞬间替它算完整串）⇒ 不跟', () => {
    expect(presenterMovedOn(table(2), ROLL, 0)).toBe(false);
    expect(presenterMovedOn(table(3), { type: 'aiNext' }, 0)).toBe(false);
  });

  it('掉线接管 / 超时託管的真人（镜像里带託管位）⇒ 不跟', () => {
    expect(presenterMovedOn(table(1, { 1: HUMAN | AUTOPILOT }), ROLL, 0)).toBe(false);
  });

  it('`setAi`（服务器的系统 action）⇒ 不跟，哪怕此刻轮到别的真人', () => {
    expect(presenterMovedOn(table(1), { type: 'setAi', player: 1, whoPlays: HUMAN | AUTOPILOT }, 0)).toBe(false);
  });

  it('★ 拍賣：看举牌者 —— 回合主人是电脑、轮到 1 号真人举牌 ⇒ 跟；轮到电脑举牌 ⇒ 不跟', () => {
    const auction = (seat: number): GameState =>
      ({
        ...table(2),
        pending: {
          kind: 'auction',
          entityId: 1,
          basePrice: 1000,
          bidders: [2, 1, 3],
          price: 1000,
          top: -1,
          topCash: 0,
          seat,
          status: ['active', 'active', 'active'],
          limits: [0, 0, 0],
        },
      }) as unknown as GameState;
    const bid: Action = { type: 'auctionBid', bidder: 1, status: 'raise', step: 1 };
    expect(presenterMovedOn(auction(1), bid, 0)).toBe(true);
    expect(presenterMovedOn(auction(0), bid, 0)).toBe(false); // 电脑 2 号举牌
  });
});

// ============================================================
//  fastForwardPresentations
// ============================================================

function fakeScreen(id: string, playing: { v: boolean }, withHook = true): UiScreen {
  return {
    id,
    active: () => playing.v,
    draw: () => undefined,
    ...(withHook
      ? {
          fastForward: () => {
            if (!playing.v) return false;
            playing.v = false;
            return true;
          },
        }
      : {}),
  };
}

const ENV = {} as UiScreenEnv;

describe('fastForwardPresentations', () => {
  it('★ 只收登记为演出类的那几屏；没在播的不报；按登记表顺序报出收掉的', () => {
    const a = { v: true };
    const b = { v: false };
    const c = { v: true };
    const interactive = { v: true };
    const screens = [
      fakeScreen('shares', a),
      fakeScreen('lottery-draw', b),
      fakeScreen('notice', c),
      fakeScreen('auction', interactive), // 待决交互类：不在表里，不许动
    ];
    const closed = fastForwardPresentations(screens, new Set(['shares', 'lottery-draw', 'notice']), ENV);
    expect(closed).toEqual(['shares', 'notice']);
    expect([a.v, b.v, c.v]).toEqual([false, false, false]);
    expect(interactive.v).toBe(true);
  });

  it('★ 不只收最上面那一屏 —— 同一条 action 起的几段（分紅屏 + 開獎屏）一次收干净', () => {
    const shares = { v: true };
    const draw = { v: true };
    const closed = fastForwardPresentations(
      [fakeScreen('shares', shares), fakeScreen('lottery-draw', draw)],
      new Set(['shares', 'lottery-draw']),
      ENV,
    );
    expect(closed).toEqual(['shares', 'lottery-draw']);
  });

  it('屏没实现 `fastForward` ⇒ 跳过、不抛', () => {
    const x = { v: true };
    expect(fastForwardPresentations([fakeScreen('wheel', x, false)], new Set(['wheel']), ENV)).toEqual([]);
    expect(x.v).toBe(true);
  });
});

// ============================================================
//  main.ts 接线（源码钉）
// ============================================================

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const slice = (from: string, to: string): string => {
  const a = main.indexOf(from);
  const b = main.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? '' : main.slice(a, b);
};
const pump = slice('function pumpNetInbox(', 'function followPresenter(');
const follow = slice('function followPresenter(', 'function startNetTick(');

/** `main.ts` 里 `BLOCKING_PRESENTATIONS` 那张表的 id */
function blockingIds(): string[] {
  // 第十六份：表本体搬到 `presentation-host.ts`（与单测共用），`main.ts` 从那里 import
  return [...BLOCKING_PRESENTATIONS];
}

describe('main.ts 接线', () => {
  it('切片都取到了', () => {
    expect(pump.length).toBeGreaterThan(100);
    expect(follow.length).toBeGreaterThan(100);
    expect(blockingIds().length).toBeGreaterThanOrEqual(8);
  });

  it('★ 收件箱每一拍问一次「队首是不是别的真人派的」，而且在节拍闸 `holdForActorWalk` **之前**', () => {
    const check = pump.indexOf('presenterMovedOn(state, head.action, net?.seat ?? null)');
    expect(check).toBeGreaterThan(0);
    expect(pump).toContain('followPresenter();');
    // 演出正占着台时节拍闸会一直挡着 —— 放在它后面就永远轮不到
    expect(check).toBeLessThan(pump.indexOf('holdForActorWalk('));
    // 过场期间先别动（那时收件箱整个押着），所以排在 intro 那道闸之后
    expect(pump.indexOf("screen === 'intro'")).toBeLessThan(check);
    // 判的是**施加之前**的镜像：必须在 `shift` / `applyNetAction` 之前
    expect(check).toBeLessThan(pump.indexOf('const item = netInbox.shift();'));
  });

  it('★ 收的就是 `BLOCKING_PRESENTATIONS` 那张表；收掉了才停文本语音', () => {
    expect(follow).toContain('fastForwardPresentations(SCREENS, BLOCKING_PRESENTATIONS, uiEnv())');
    expect(follow).toContain('if (closed.length === 0) return;');
    expect(follow).toContain("sound.stop('Speaking.mkf', voice)");
    expect(follow.indexOf('if (closed.length === 0) return;')).toBeLessThan(follow.indexOf("sound.stop('Speaking.mkf'"));
  });

  it('★★ 表里每一屏都登记在 `SCREENS`、都实现了 `fastForward`（漏一屏 = 那一屏旁观端照旧落后）', () => {
    for (const id of blockingIds()) {
      const s = SCREENS.find((x) => x.id === id);
      expect(s, `SCREENS 里没有 ${id}`).toBeDefined();
      expect(typeof s!.fastForward, `${id} 没实现 fastForward`).toBe('function');
    }
  });
});
