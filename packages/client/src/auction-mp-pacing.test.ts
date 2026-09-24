/*
 * gap-audit #4「联机拍卖：别人出价没有动画和音效」—— 联机时广播来的每一口也照单机那样挥槌 + 音效 0x3f，节拍相同
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 单机：每一口都是拍賣屏自己发的（电脑那一口 `tick` 按 `nextAt` 问 core、真人那一口点钮），发的那一刻起挥槌
 *   （`AUCTION_FRAME_MS × AUCTION_HAMMER_FRAMES`，@source 0x43a365 的 100 ms 定时器）并放音效 0x3f（@source 0x43a3fc）。
 * 联机：电脑那几口由服务器一口气广播（`hub.ts` 的 `#driveComputers`），别的真人那一口在他自己那台点。
 *   收件箱经 `presentation-host.ts` 的 `screensBlocking` → `auctionBidPacing` 一口一口放，屏在 `event` 里每落一口演一口。
 *
 * 这里用同一块屏、同一个时钟把两条路各跑一遍，钉住：① 联机每一口都有挥槌 + 音效；② 时刻与单机**逐口相同**；
 * ③ 本机真人那一口的回包不演第二遍、也不被挡；④ 单机的行为一字不变（`event` 不补演、`auctionBidPacing` 恒假）。
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, MapTopology, Player, Rich4Map } from '@rich4/core';
import {
  AUCTION_BOX_MS,
  AUCTION_FRAME_MS,
  AUCTION_HAMMER_FRAMES,
  AUCTION_SOUND_BID,
  auctionBidPacing,
  auctionButtonY,
  auctionHumanPassPoint,
  auctionPresentationOnly,
  auctionRunForTest,
  auctionScreen,
  auctionTrace,
  resetAuctionScreenForTest,
} from './auction-screen.ts';
import { PresentationHost } from './presentation-host.ts';
import type { UiScreenEnv } from './ui-screen.ts';

type AuctionPending = Extract<NonNullable<GameState['pending']>, { kind: 'auction' }>;

const HUMAN = 1;
const COMPUTER = 2;

function mkPlayer(index: number, whoPlays: number, cash = 1_000_000): Player {
  return {
    index,
    character: index,
    whoPlays,
    cash,
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
  } as unknown as Player;
}

function auctionPending(bidders: number[], limits: number[]): AuctionPending {
  return {
    kind: 'auction',
    entityId: 1,
    basePrice: 5000,
    bidders,
    price: 5000,
    top: -1,
    topCash: 0,
    seat: 0,
    status: bidders.map(() => 'active' as const),
    limits,
  } as unknown as AuctionPending;
}

/**
 * 迷你「core」：只管这几口出价要改的字段（现价 / 最高者 / 状态 / 轮转）。
 * 联机两端 reduce 的是同一串 action，所以两条路用同一个函数即可。
 */
function applyBid(state: GameState, a: Action): GameState {
  const p = state.pending as AuctionPending;
  if (a.type !== 'auctionBid' || p === null || p.kind !== 'auction') return state;
  const status = [...p.status];
  let { price, top, topCash } = p;
  if (a.status === 'raise') {
    price += a.step;
    top = a.bidder;
    topCash = state.players[a.bidder]!.cash;
    for (const b of p.bidders) if (status[b] === 'passed') status[b] = 'active';
  } else {
    status[a.bidder] = a.status === 'giveUp' ? 'givenUp' : 'passed';
  }
  return { ...state, pending: { ...p, price, top, topCash, status, seat: (p.seat + 1) % p.bidders.length } };
}

/** 一块屏的宿主：时钟、状态、音效流水 —— `dispatch` 在单机里当场 reduce 并派 `event`（同 `main.ts` 的 `notifyApplied`）*/
function host(
  players: Player[],
  pending: AuctionPending,
  localSeat: number | null,
  reduceBid: (state: GameState, a: Action) => GameState = applyBid,
) {
  let now = 0;
  let state = {
    pending,
    players,
    priceIndex: 1,
    landOwner: [0, 0, 0, 0],
    landLevel: [0, 0, 0, 0],
    landType: [0, 0, 0, 0],
    landPriceStatus: [0, 0, 0, 0],
    facilityOwner: [],
    facilityLevel: [],
    facilityType: [],
    facilityPriceStatus: [],
  } as unknown as GameState;
  const lands = [0, 1, 2, 3].map((id) => ({ id, name: `地${id}`, level: 0, type: 0, owner: 0, landPrice: 10000 }));
  const topo = { lands, facilities: [] } as unknown as MapTopology;
  const sounds: number[] = [];
  const dispatched: Action[] = [];
  const env = (): UiScreenEnv => ({
    screen: 'game',
    state,
    topo,
    map: null as unknown as Rich4Map,
    now,
    stage: null as unknown as CanvasRenderingContext2D,
    sprite: () => null,
    dispatch: (a) => {
      dispatched.push(a);
      // 联机：dispatch 只是发意图，等广播回来才落地（由测试自己送）
      if (localSeat === null) apply(a);
    },
    requestRender: () => undefined,
    log: () => undefined,
    flic: () => null,
    playEffect: (id: number) => {
      if (id === AUCTION_SOUND_BID) sounds.push(now);
    },
    stopEffect: () => undefined,
    localSeat,
  });
  const apply = (a: Action): void => {
    const before = state;
    state = reduceBid(state, a);
    auctionScreen.event!(before, state, env());
  };
  return {
    env,
    apply,
    sounds,
    dispatched,
    setNow: (t: number) => {
      now = t;
    },
    get now() {
      return now;
    },
  };
}

const FRAME = 20;
const BID_MS = AUCTION_FRAME_MS * AUCTION_HAMMER_FRAMES;

describe('★ gap-audit #4：联机拍卖的逐口挥槌 + 音效 0x3f，节拍与单机相同', () => {
  // 三家电脑、心理价位都很高 ⇒ 竞价里一直轮着加（6 口足够看节拍）
  const players = () => [mkPlayer(0, COMPUTER), mkPlayer(1, COMPUTER), mkPlayer(2, COMPUTER), mkPlayer(3, HUMAN)];
  const pending = () => auctionPending([0, 1, 2], [900_000, 900_000, 900_000, 0]);
  const WINDOW = AUCTION_BOX_MS + 6 * BID_MS - FRAME;

  it('单机（对照）：屏自己按 nextAt 出电脑那一口，每口一声 0x3f，间隔 = 一段挥槌', () => {
    resetAuctionScreenForTest();
    const h = host(players(), pending(), null);
    for (let t = 0; t <= WINDOW; t += FRAME) {
      h.setNow(t);
      auctionScreen.tick!(h.env());
      // 单机永不挡收件箱 / 回合驱动
      expect(auctionBidPacing(h.env())).toBe(false);
    }
    expect(h.dispatched).toHaveLength(6);
    // ★ 单机行为不变：`event` 不补演 —— 一口一声，不多不少
    expect(h.sounds).toHaveLength(6);
    expect(h.sounds[0]).toBe(AUCTION_BOX_MS);
    for (let i = 1; i < h.sounds.length; i++) expect(h.sounds[i]! - h.sounds[i - 1]!).toBe(BID_MS);
  });

  it('联机旁观端：服务器同一瞬间广播的 6 口，经 `auctionBidPacing` 一口一口放 —— 时刻与单机逐口相同', () => {
    // 先跑单机拿到那一串 action 与各口的时刻
    resetAuctionScreenForTest();
    const solo = host(players(), pending(), null);
    for (let t = 0; t <= WINDOW; t += FRAME) {
      solo.setNow(t);
      auctionScreen.tick!(solo.env());
    }
    const bids = [...solo.dispatched];
    const soloTimes = [...solo.sounds];

    // 联机：本机是 3 号（真人，不在竞价里）；6 口在 t=0 一次到齐
    resetAuctionScreenForTest();
    const net = host(players(), pending(), 3);
    const inbox = [...bids];
    const applied: number[] = [];
    for (let t = 0; t <= WINDOW; t += FRAME) {
      net.setNow(t);
      auctionScreen.tick!(net.env());
      // 收件箱：闸开着才放一口（`main.ts` 的 `pumpNetInbox` → `holdForActorWalk` → `screensBlocking`）
      if (inbox.length > 0 && !auctionBidPacing(net.env())) {
        net.apply(inbox.shift()!);
        applied.push(t);
      }
    }
    expect(net.dispatched).toEqual([]); // 联机时屏从不替电脑发
    expect(inbox).toEqual([]);
    expect(net.sounds).toEqual(soloTimes);
    expect(applied).toEqual(soloTimes);
  });

  it('联机：收件箱的闸经 `PresentationHost.screensBlocking`（与 `main.ts` 同一份判据）—— 挥槌期间挡、到点自己放', () => {
    resetAuctionScreenForTest();
    const net = host(players(), pending(), 3);
    const presentation = new PresentationHost({
      screens: [auctionScreen],
      env: () => net.env(),
      filmsBusy: () => false,
      godLine: () => ({ showing: false, pending: false }),
      speech: () => ({ onStage: 0, held: [] }),
      cueDone: () => true,
      deferredScreens: () => 0,
      magicAwaitingPick: () => false,
      bailClosing: () => false,
    });
    // 屏还没开起来（pending 刚挂出、tick 还没轮到）⇒ 挡（下一帧就开）
    expect(presentation.screensBlocking()).toBe(true);
    auctionScreen.tick!(net.env());
    // 开场那句（2 秒）⇒ 挡
    net.setNow(AUCTION_BOX_MS - FRAME);
    expect(presentation.screensBlocking()).toBe(true);
    net.setNow(AUCTION_BOX_MS);
    expect(presentation.screensBlocking()).toBe(false);
    net.apply({ type: 'auctionBid', bidder: 0, status: 'raise', step: 1000 });
    expect(net.sounds).toEqual([AUCTION_BOX_MS]);
    expect(presentation.screensBlocking()).toBe(true);
    net.setNow(AUCTION_BOX_MS + BID_MS);
    expect(presentation.screensBlocking()).toBe(false);
  });

  it('联机：别的真人那一口也演（挥槌 + 0x3f），而且下一位真人照单机再听一次「請意者出價」', () => {
    resetAuctionScreenForTest();
    // 0、1 号是真人（1 号是本机）
    const net = host([mkPlayer(0, HUMAN), mkPlayer(1, HUMAN), mkPlayer(2, COMPUTER)], auctionPending([0, 1, 2], [0, 0, 900_000]), 1);
    auctionScreen.tick!(net.env());
    net.setNow(AUCTION_BOX_MS);
    auctionScreen.tick!(net.env()); // 开场那句收掉
    net.setNow(AUCTION_BOX_MS + FRAME);
    auctionScreen.tick!(net.env()); // 轮到 0 号（别的真人）：「請意者出價」
    net.apply({ type: 'auctionBid', bidder: 0, status: 'raise', step: 500 });
    expect(net.sounds).toEqual([AUCTION_BOX_MS + FRAME]);
    expect(auctionBidPacing(net.env())).toBe(true);
    // 挥槌收尾之后轮到本机：屏上摆出钮 + 「請意者出價」，点得动
    net.setNow(AUCTION_BOX_MS + FRAME + BID_MS);
    auctionScreen.tick!(net.env());
    const y = auctionButtonY(1);
    auctionScreen.down!(406, y, net.env());
    auctionScreen.up!(406, y, net.env());
    expect(net.dispatched).toEqual([{ type: 'auctionBid', bidder: 1, status: 'raise', step: 100 }]);
  });

  it('联机：本机真人那一口 —— 点钮当场演一次；回包落地不演第二遍、也不挡回包', () => {
    resetAuctionScreenForTest();
    const net = host([mkPlayer(0, HUMAN), mkPlayer(1, COMPUTER)], auctionPending([0, 1], [0, 900_000]), 0);
    auctionScreen.tick!(net.env());
    net.setNow(AUCTION_BOX_MS + FRAME);
    auctionScreen.tick!(net.env());
    const y = auctionButtonY(2);
    auctionScreen.down!(406, y, net.env());
    auctionScreen.up!(406, y, net.env());
    expect(net.sounds).toEqual([AUCTION_BOX_MS + FRAME]); // 点钮那一刻
    // 回包还没到：挥槌在演，但本机这一口的回包不挡（`localBid`）
    expect(auctionBidPacing(net.env())).toBe(false);
    net.setNow(AUCTION_BOX_MS + FRAME * 3);
    net.apply(net.dispatched[0]!);
    expect(net.sounds).toEqual([AUCTION_BOX_MS + FRAME]); // 不演第二遍
    // 回包之后下一口（电脑）照常等这一口挥槌收尾
    expect(auctionBidPacing(net.env())).toBe(true);
    net.setNow(AUCTION_BOX_MS + FRAME + BID_MS);
    expect(auctionBidPacing(net.env())).toBe(false);
    net.apply({ type: 'auctionBid', bidder: 1, status: 'raise', step: 1000 });
    expect(net.sounds).toEqual([AUCTION_BOX_MS + FRAME, AUCTION_BOX_MS + FRAME + BID_MS]);
  });

  it('单机：真人点钮 → 当场演一次；`dispatch` 同步落地时 `event` 不补第二遍', () => {
    resetAuctionScreenForTest();
    const solo = host([mkPlayer(0, HUMAN), mkPlayer(1, COMPUTER)], auctionPending([0, 1], [0, 900_000]), null);
    auctionScreen.tick!(solo.env());
    solo.setNow(AUCTION_BOX_MS + FRAME);
    auctionScreen.tick!(solo.env());
    const y = auctionButtonY(2);
    auctionScreen.down!(406, y, solo.env());
    auctionScreen.up!(406, y, solo.env());
    expect(solo.dispatched).toHaveLength(1);
    expect(solo.sounds).toEqual([AUCTION_BOX_MS + FRAME]);
  });
});

/**
 * ★★ pt23（联机拍卖活体 e2e，`tools/net-e2e-auction.mjs` 实测到的两处）—— 单机 / 联机同一块屏，两种模式各钉一遍：
 *
 * ① 真人能在上一口挥槌的第一帧（联机实测 22–34 ms）、甚至开场那句还挂着时就点钮 ⇒ 上一口的挥槌被截成一帧。
 *   原版只在相位 3 收钮（`0x0043bb2f`），挥槌帧计数非 0 一律不收（`0x0043bb3c`）；开场那句挂着时点一下只收掉那一句
 *   （`0x0043bb27 fcn_0044ee18(1)`）。
 * ② 落槌那一口的挥槌一帧都没画（core 一清 `pending` 下一拍就 `beginSettle` 把 `anim` 清了）。
 *   原版挥槌三帧走完才进相位 5（`0x0043ab40`），相位 5 才判终局弹「成交 / 流標」（`0x0043b262` → `0x0043b295`）。
 */
describe('★★ pt23：真人要等上一口挥槌 / 开场那句走完才点得动；落槌那一口的挥槌演完才宣布', () => {
  const click = (env: UiScreenEnv, btn: number): void => {
    const y = auctionButtonY(btn);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
  };
  /** 落槌：这一口之后 core 清掉 `pending`（成交）*/
  const hammerDown = (state: GameState, a: Action): GameState => {
    const next = applyBid(state, a);
    return { ...next, pending: null };
  };

  for (const mode of ['单机', '联机'] as const) {
    const local = mode === '单机' ? null : 1;

    it(`${mode}：电脑那一口挥槌期间真人点钮不算（钮也不摆）；挥槌收尾后才点得动`, () => {
      resetAuctionScreenForTest();
      auctionTrace(true);
      const h = host([mkPlayer(0, COMPUTER), mkPlayer(1, HUMAN)], auctionPending([0, 1], [900_000, 0]), local);
      auctionScreen.tick!(h.env());
      h.setNow(AUCTION_BOX_MS);
      if (local === null) auctionScreen.tick!(h.env()); // 单机：屏自己出电脑那一口
      else h.apply({ type: 'auctionBid', bidder: 0, status: 'raise', step: 1000 }); // 联机：服务器广播来的
      const bidAt = AUCTION_BOX_MS;
      expect(h.sounds).toEqual([bidAt]);
      // 已轮到真人（core 转了座），但挥槌还在演 ⇒ 不是相位 3
      h.setNow(bidAt + FRAME);
      auctionScreen.tick!(h.env());
      expect(auctionHumanPassPoint(h.env())).toBeNull();
      click(h.env(), 1);
      const before = h.dispatched.length;
      expect(h.dispatched.filter((a) => a.type === 'auctionBid' && a.bidder === 1)).toEqual([]);
      expect(h.sounds).toEqual([bidAt]); // 没被截：没有第二声、电脑那一口的挥槌照演
      // 挥槌收尾 ⇒ 相位 3
      h.setNow(bidAt + BID_MS);
      auctionScreen.tick!(h.env());
      expect(auctionHumanPassPoint(h.env())).not.toBeNull();
      click(h.env(), 1);
      expect(h.dispatched.length).toBe(before + 1);
      expect(h.dispatched[h.dispatched.length - 1]).toEqual({ type: 'auctionBid', bidder: 1, status: 'raise', step: 100 });
      expect(h.sounds).toEqual([bidAt, bidAt + BID_MS]);
      // 取证钩子：电脑那一口的来源（单机屏自己出 / 联机广播补演）与本机那一口
      const tr = auctionTrace();
      expect(tr.anims.map((x) => x.source)).toEqual([local === null ? 'solo' : 'broadcast', 'local']);
      expect(tr.opens).toEqual([0]);
    });

    it(`${mode}：开场那句挂着时点一下只收掉那一句、不算出价；下一下才出价`, () => {
      resetAuctionScreenForTest();
      const h = host([mkPlayer(0, COMPUTER), mkPlayer(1, HUMAN)], auctionPending([1, 0], [900_000, 0]), local);
      auctionScreen.tick!(h.env());
      h.setNow(FRAME);
      expect(auctionHumanPassPoint(h.env())).toBeNull();
      click(h.env(), 1);
      expect(h.dispatched).toEqual([]);
      expect(h.sounds).toEqual([]);
      // 开场那句收掉了 ⇒ 下一拍就是相位 3（不再等满 2 秒）
      h.setNow(FRAME * 2);
      auctionScreen.tick!(h.env());
      click(h.env(), 1);
      expect(h.dispatched).toEqual([{ type: 'auctionBid', bidder: 1, status: 'raise', step: 100 }]);
      expect(h.sounds).toEqual([FRAME * 2]);
    });
  }

  it('单机：落槌那一口（真人点的）挥槌演完才宣布成交；其间屏仍接管、算纯演出', () => {
    resetAuctionScreenForTest();
    auctionTrace(true);
    const h = host([mkPlayer(0, HUMAN), mkPlayer(1, COMPUTER)], auctionPending([0, 1], [0, 900_000]), null, hammerDown);
    auctionScreen.tick!(h.env());
    h.setNow(AUCTION_BOX_MS);
    auctionScreen.tick!(h.env());
    click(h.env(), 1);
    expect(h.env().state.pending).toBeNull(); // core 当场落槌
    for (let t = AUCTION_BOX_MS + FRAME; t < AUCTION_BOX_MS + BID_MS; t += FRAME) {
      h.setNow(t);
      auctionScreen.tick!(h.env());
      expect(auctionRunForTest()!.phase).toBe('bidding');
      expect(auctionScreen.active(h.env())).toBe(true);
      expect(auctionPresentationOnly(h.env())).toBe(true);
    }
    h.setNow(AUCTION_BOX_MS + BID_MS);
    auctionScreen.tick!(h.env());
    expect(auctionRunForTest()!.phase).toBe('sold');
    expect(auctionRunForTest()!.winner).toBe(0);
  });

  it('联机旁观端：广播来的落槌那一口同样先挥完槌再宣布（收件箱其间照挡）', () => {
    resetAuctionScreenForTest();
    // 第二口（1 号 PASS）落槌
    let k = 0;
    const secondFalls = (state: GameState, a: Action): GameState => (++k >= 2 ? hammerDown(state, a) : applyBid(state, a));
    const h = host([mkPlayer(0, COMPUTER), mkPlayer(1, COMPUTER), mkPlayer(2, HUMAN)], auctionPending([0, 1], [900_000, 900_000]), 2, secondFalls);
    auctionScreen.tick!(h.env());
    h.setNow(AUCTION_BOX_MS);
    h.apply({ type: 'auctionBid', bidder: 0, status: 'raise', step: 1000 });
    const last = AUCTION_BOX_MS + BID_MS;
    h.setNow(last);
    expect(auctionBidPacing(h.env())).toBe(false);
    h.apply({ type: 'auctionBid', bidder: 1, status: 'pass', step: 0 });
    expect(h.sounds).toEqual([AUCTION_BOX_MS, last]);
    for (let t = last + FRAME; t < last + BID_MS; t += FRAME) {
      h.setNow(t);
      auctionScreen.tick!(h.env());
      expect(auctionRunForTest()!.phase).toBe('bidding');
      expect(auctionPresentationOnly(h.env())).toBe(true);
    }
    h.setNow(last + BID_MS);
    auctionScreen.tick!(h.env());
    expect(auctionRunForTest()!.phase).toBe('sold');
    expect(auctionRunForTest()!.winner).toBe(0);
  });
});
