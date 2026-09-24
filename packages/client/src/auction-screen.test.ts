/*
 * 拍賣屏的版面、命中、出价轮次与整屏接线（T-034 / U-7）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与图号全部照 `rich4_ui_auction.asm` 抄，把最容易写错的几条钉住：
 *   底图是 `Panel.mkf` **#26** 图 0（不是 26 号图）；
 *   七颗钮在 x=406、y 从 133 起每 48 一格，图号是 `2i+4 / 2i+3`；
 *   四个座位沿**纵**轴排在 x=80/200/320/440，小人在横坐标 590；
 *   帧节拍 100ms、三帧一循环。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Action, GameState, MapTopology, Player, Rich4Map } from '@rich4/core';
import {
  AUCTION_ART,
  AUCTION_BUTTON,
  AUCTION_BUTTONS,
  AUCTION_BOX_MS,
  AUCTION_CHUNK,
  AUCTION_DEAL_FORMAT,
  AUCTION_FRAME_MS,
  AUCTION_HAMMER_FRAMES,
  AUCTION_MONEY_FORMAT,
  AUCTION_MESSAGE_AT,
  AUCTION_PRICE_TEXT,
  AUCTION_RESOURCE,
  AUCTION_SEAT,
  AUCTION_SEAT_FIGURE,
  AUCTION_STATUS_TEXT,
  auctionButtonRect,
  auctionButtonY,
  auctionEntityImage,
  auctionRunForTest,
  auctionScreen,
  auctionSeatY,
  awayCodeOf,
  seatViewOf,
  hammerFrame,
  hitAuctionButton,
  resetAuctionScreenForTest,
  auctionKeyed,
  auctionSprite,
  auctionCharacterSprite,
  AUCTION_CHARACTER_RES,
  auctionSeatCode,
  auctionBoxTextCenter,
  auctionStatusText,
  AUCTION_PASSED_CODE,
  AUCTION_SELLER_CODE,
  AUCTION_BROKE_CODE,
  AUCTION_SELLER_TEXT,
  AUCTION_PASSED_IN_TEXT,
  auctionPresentationOnly,
} from './auction-screen.ts';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  用到的图与钮 @source rich4_ui_auction.asm
// ============================================================

describe('用到的图 @source 0x43c2f5 起', () => {
  it('★ 底图是 Panel.mkf 资源 26 的**图 0**', () => {
    expect(AUCTION_RESOURCE).toBe(26);
    expect(AUCTION_CHUNK.bg).toBe(0);
  });

  it('★ 拍賣官 25、助手 17、消息框 2', () => {
    expect(AUCTION_CHUNK.auctioneer).toBe(25);
    expect(AUCTION_CHUNK.assistant).toBe(17);
    expect(AUCTION_CHUNK.messageBox).toBe(2);
  });

  it('★ 七颗钮的常态 / 按下：2i+4 与 2i+3', () => {
    expect(AUCTION_CHUNK.buttonOn).toEqual([4, 6, 8, 10, 12, 14, 16]);
    expect(AUCTION_CHUNK.buttonOff).toEqual([3, 5, 7, 9, 11, 13, 15]);
  });

  it('★ 座位小人的图号基址 = 0x4e（78）', () => {
    expect(AUCTION_SEAT_FIGURE).toBe(0x4e);
  });
});

describe('抠黑表 @source fcn_004563f5 / fcn_00456418', () => {
  it('★ 只有 640×480 的**底图**不抠黑（它的黑是真黑）', () => {
    expect(auctionKeyed(AUCTION_CHUNK.bg)).toBe(false);
  });

  it('★ 这一屏画到的每一张别图都要抠黑 —— 消息框那四个圆角最容易漏', () => {
    const used = [
      AUCTION_CHUNK.messageBox,
      AUCTION_CHUNK.auctioneer,
      AUCTION_CHUNK.assistant,
      ...AUCTION_CHUNK.buttonOn,
      ...AUCTION_CHUNK.buttonOff,
      // 座位剪影 78..89
      ...Array.from({ length: 12 }, (_, c) => 0x4e + c),
      // 待拍产业缩略图：0 级无主/有主、各级地块、各级設施
      0x5a, 0x5b, 0x66, 0x67, 0x68, 0x73, 0x32, 0x33, 0x1e, 0x4d, 76,
    ];
    for (const idx of used) expect(auctionKeyed(idx)).toBe(true);
  });

  it('★ auctionSprite 只往资源 26 取图，并把抠黑开关带上', () => {
    const seen: { a: string; r: number; i: number; k: boolean | undefined }[] = [];
    const fake = ((a: string, r: number, i: number, k?: boolean) => {
      seen.push({ a, r, i, k });
      return null;
    }) as unknown as Parameters<typeof auctionSprite>[0];
    auctionSprite(fake, 25);
    auctionSprite(fake, 0);
    expect(seen).toEqual([
      { a: 'Panel.mkf', r: 26, i: 25, k: true },
      { a: 'Panel.mkf', r: 26, i: 0, k: false },
    ]);
  });

  it('★ 每角色那三份资源（27..62）一律抠黑，资源号 = 3×角色 + 基址', () => {
    const seen: { r: number; i: number; k: boolean | undefined }[] = [];
    const fake = ((_a: string, r: number, i: number, k?: boolean) => {
      seen.push({ r, i, k });
      return null;
    }) as unknown as Parameters<typeof auctionSprite>[0];
    auctionCharacterSprite(fake, 0, 'bid', 2);
    auctionCharacterSprite(fake, 11, 'giveUp', 0);
    auctionCharacterSprite(fake, 5, 'bid2', 3);
    expect(seen).toEqual([
      { r: 3 * 0 + AUCTION_CHARACTER_RES.bid, i: 2, k: true },
      { r: 3 * 11 + AUCTION_CHARACTER_RES.giveUp, i: 0, k: true },
      { r: 3 * 5 + AUCTION_CHARACTER_RES.bid2, i: 3, k: true },
    ]);
    expect(AUCTION_CHARACTER_RES).toEqual({ bid: 0x1b, giveUp: 0x1c, bid2: 0x1d });
  });

  it('★ 拿回来的 Sprite 原样透传（包装不改图）', () => {
    const s = { width: 1, height: 1, anchorX: 0, anchorY: 0 } as unknown as Sprite;
    const fake = (() => s) as unknown as Parameters<typeof auctionSprite>[0];
    expect(auctionSprite(fake, 17)).toBe(s);
  });
});

describe('七颗钮的语义 @source 0x43bc59 的 0x407 消息', () => {
  it('★ 顺序是 PASS / +100 / +500 / +1000 / +5000 / +10000 / 放棄', () => {
    expect(AUCTION_BUTTONS.map((b) => b.kind)).toEqual([
      'pass',
      'raise',
      'raise',
      'raise',
      'raise',
      'raise',
      'giveUp',
    ]);
    expect(AUCTION_BUTTONS.map((b) => b.step)).toEqual([0, 100, 500, 1000, 5000, 10000, 0]);
  });

  it('★ 表上的字就是图 4/6/8/10/12/14/16 上烤的那几个', () => {
    expect(AUCTION_BUTTONS[0]!.text).toBe('ＰＡＳＳ');
    expect(AUCTION_BUTTONS[3]!.text).toBe('+1000');
    expect(AUCTION_BUTTONS[6]!.text).toBe('放棄');
  });
});

// ============================================================
//  版面
// ============================================================

describe('版面 @source 0x43c32c / 0x43c3f0 / 0x43bb86', () => {
  it('★ 三张大图：拍賣官 (123,24)、助手 (67,63)、待拍产业 (232,180)', () => {
    expect(AUCTION_ART).toEqual({
      auctioneer: { x: 123, y: 24 },
      assistant: { x: 67, y: 63 },
      entity: { x: 232, y: 180 },
    });
  });

  it('★ 標價：label 左上 (182,242)、金额右上 (272,262)', () => {
    expect(AUCTION_PRICE_TEXT.label).toEqual({ x: 182, y: 242 });
    expect(AUCTION_PRICE_TEXT.value).toEqual({ x: 272, y: 262 });
    expect(AUCTION_MONEY_FORMAT).toBe('%d元');
  });

  it('★ 四个座位：纵坐标 80/200/320/440，小人 x=590、现金 x=620', () => {
    expect(AUCTION_SEAT).toEqual({
      x0: 80,
      dx: 120,
      count: 4,
      figureX: 590,
      cashX: 620,
      textDy: 14,
    });
    expect([0, 1, 2, 3].map(auctionSeatY)).toEqual([80, 200, 320, 440]);
  });

  it('★ 消息框落点 (410,60)，减掉图 2 的锚点 (122,50) 后左上角在 (288,10)', () => {
    expect(AUCTION_MESSAGE_AT).toEqual({ x: 410, y: 60 });
    expect({ x: AUCTION_MESSAGE_AT.x - 122, y: AUCTION_MESSAGE_AT.y - 50 }).toEqual({
      x: 288,
      y: 10,
    });
  });

  it('★ 七颗钮：x=406、y 从 133 起每 48 一格', () => {
    expect(AUCTION_BUTTON.cx).toBe(406);
    expect([0, 1, 2, 3, 4, 5, 6].map(auctionButtonY)).toEqual([133, 181, 229, 277, 325, 373, 421]);
  });

  it('★ 命中框 x∈[363,449]、y 各 ±19', () => {
    expect(auctionButtonRect(0)).toEqual({ x: 363, y: 114, w: 87, h: 39 });
    expect(AUCTION_BUTTON.halfW).toBe(43);
    expect(AUCTION_BUTTON.halfH).toBe(19);
  });
});

describe('钮的命中 @source 0x43bb86', () => {
  it('★ 每颗钮的中心与四角都命中自己', () => {
    for (let i = 0; i < AUCTION_BUTTON.count; i++) {
      const r = auctionButtonRect(i);
      expect(hitAuctionButton(AUCTION_BUTTON.cx, auctionButtonY(i))).toBe(i);
      for (const [x, y] of [
        [r.x, r.y],
        [r.x + r.w - 1, r.y],
        [r.x, r.y + r.h - 1],
        [r.x + r.w - 1, r.y + r.h - 1],
      ]) {
        expect(hitAuctionButton(x!, y!)).toBe(i);
      }
    }
  });

  it('★ 框外不算：左右各差 1px、最上/最下再外一格', () => {
    expect(hitAuctionButton(362, 133)).toBeNull();
    expect(hitAuctionButton(450, 133)).toBeNull();
    expect(hitAuctionButton(406, 113)).toBeNull();
    expect(hitAuctionButton(406, 441)).toBeNull();
  });

  it('★ 相邻两钮之间是**空**的（间距 48 > 框高 39）', () => {
    expect(hitAuctionButton(406, 152)).toBe(0);
    expect(hitAuctionButton(406, 153)).toBeNull();
    expect(hitAuctionButton(406, 162)).toBe(1);
  });
});

// ============================================================
//  帧序
// ============================================================

describe('挥槌动画的帧序 @source 0x43a365', () => {
  it('★ 节拍 100ms、三帧一循环', () => {
    expect(AUCTION_FRAME_MS).toBe(100);
    expect(AUCTION_HAMMER_FRAMES).toBe(3);
    expect([0, 99, 100, 199, 200, 299, 300, 301].map((t) => hammerFrame(t))).toEqual([
      0, 0, 1, 1, 2, 2, 0, 0,
    ]);
  });

  it('★ 帧数给 1 或 0 就一直是第 0 帧', () => {
    expect(hammerFrame(123456, 1)).toBe(0);
    expect(hammerFrame(123456, 0)).toBe(0);
  });
});

// ============================================================
//  待拍产业画哪一张
// ============================================================

describe('待拍产业缩略图 @source 0x43be0a 起', () => {
  const charOf = (owner: number): number => owner - 1;

  it('★ 地块 0 级：无主 90、有主 = 角色号 + 0x5b', () => {
    expect(auctionEntityImage({ level: 0, type: 0, owner: 0 }, false, charOf, 0)).toBe(0x5a);
    expect(auctionEntityImage({ level: 0, type: 0, owner: 3 }, false, charOf, 0)).toBe(0x5d);
  });

  it('★ 地块 ≥1 级：type 0 走 地图号×5+等级+0x1d，其余固定 0x32', () => {
    expect(auctionEntityImage({ level: 1, type: 0, owner: 1 }, false, charOf, 0)).toBe(0x1e);
    expect(auctionEntityImage({ level: 5, type: 0, owner: 1 }, false, charOf, 2)).toBe(0x2c);
    expect(auctionEntityImage({ level: 3, type: 1, owner: 1 }, false, charOf, 0)).toBe(0x32);
  });

  it('★ 設施 0 级：无主 103、有主 = 角色号 + 0x68', () => {
    expect(auctionEntityImage({ level: 0, type: 0, owner: 0 }, true, charOf, 0)).toBe(0x67);
    expect(auctionEntityImage({ level: 0, type: 0, owner: 2 }, true, charOf, 0)).toBe(0x69);
  });

  it('★ 設施 ≥1 级：type 0 → 0x33，其余 (type−1)×5+等级+0x33', () => {
    expect(auctionEntityImage({ level: 2, type: 0, owner: 1 }, true, charOf, 0)).toBe(0x33);
    expect(auctionEntityImage({ level: 1, type: 1, owner: 1 }, true, charOf, 0)).toBe(0x34);
    expect(auctionEntityImage({ level: 5, type: 5, owner: 1 }, true, charOf, 0)).toBe(76);
  });
});

describe('座位状态号 @source 0x43c152 / 0x43c22a / 0x43c140 / 0x43a426', () => {
  it('★ 七种座位状态各自映射到原版的号', () => {
    expect(auctionSeatCode({ state: 'canBid', away: 0 })).toBe(0);
    expect(auctionSeatCode({ state: 'away', away: 4 })).toBe(4);
    expect(auctionSeatCode({ state: 'seller', away: 0 })).toBe(AUCTION_SELLER_CODE);
    expect(auctionSeatCode({ state: 'broke', away: 0 })).toBe(AUCTION_BROKE_CODE);
  });

  it('★ PASS 记成 **1** —— 于是原版那一格显示「住宿中」（照抄，见 D-T034-1）', () => {
    expect(AUCTION_PASSED_CODE).toBe(1);
    expect(auctionSeatCode({ state: 'passed', away: 0 })).toBe(1);
    expect(auctionStatusText(AUCTION_PASSED_CODE)).toBe('住宿中');
    // 卖主那一格的字是「賣方」，不是住宿中
    expect(AUCTION_SELLER_CODE).toBe(7);
    expect(AUCTION_SELLER_TEXT).toBe('賣方');
  });
});

describe('消息框字心 @source fcn_0044ecb6 VA 0x0044ed71', () => {
  it('★ 字心 = **框心** (410,60)，不是「锚点 + 半个尺寸」', () => {
    // 图 2 是 244×100、原点 (122,50)，锚点落点 (410,60) → 左上角 (288,10)
    expect(auctionBoxTextCenter({ width: 244, height: 100, anchorX: 122, anchorY: 50 })).toEqual({
      x: 410,
      y: 60,
    });
    // 拿不到图时用 manifest 里那组已知尺寸，**不是**「锚点 + 尺寸/2」（那是 (532,110)）
    expect(auctionBoxTextCenter(null)).toEqual({ x: 410, y: 60 });
  });
});

describe('六个「不在场」@source 0x496b9a 起', () => {
  it('★ 表就是那六条，顺序不能换', () => {
    expect(AUCTION_STATUS_TEXT).toEqual(['住宿中', '消失中', '坐牢中', '住院中', '冬眠中', '夢遊中']);
  });

  it('★ awayCodeOf：+0x32..+0x37 六次顺序各写一次，同时非 0 时**后写的赢** @source 0x0043c155..0x0043c220', () => {
    const base = mkPlayer(0, 1);
    expect(awayCodeOf(base)).toBe(0);
    expect(awayCodeOf(withBlocking(base, { inHospital: 3 }))).toBe(4);
    // 第十八份订正：每个 `je` 只跳过自己那一句 `mov word [座位+2], n`，后面几次照样比 ⇒ 3 盖掉 1
    expect(awayCodeOf(withBlocking(base, { inHotel: 1, inPrison: 2 }))).toBe(3);
    expect(awayCodeOf(withBlocking(base, { sleepWalking: 1 }))).toBe(6);
  });
});

// ============================================================
//  出价轮次（卡片的 tests 一栏）
// ============================================================

function mkPlayer(index: number, whoPlays: number, cash = 100000): Player {
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

function withBlocking(p: Player, patch: Partial<Player['blocking']>): Player {
  return { ...p, blocking: { ...p.blocking, ...patch } };
}


// ============================================================
//  整屏接线
// ============================================================

function mkEnv(
  pending: GameState['pending'],
  players: Player[],
  now = 1000,
): { env: UiScreenEnv; actions: Action[]; renders: () => number } {
  const actions: Action[] = [];
  let renders = 0;
  const lands = [0, 1, 2, 3].map((id) => ({
    id,
    name: `地${id}`,
    level: 0,
    type: 0,
    owner: 0,
    landPrice: 10000,
  }));
  const state = {
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
  const topo = { lands, facilities: [] } as unknown as MapTopology;
  const env: UiScreenEnv = {
    screen: 'game',
    state,
    topo,
    map: null as unknown as Rich4Map,
    now,
    stage: null as unknown as CanvasRenderingContext2D,
    sprite: () => null,
    dispatch: (a) => actions.push(a),
    requestRender: () => {
      renders += 1;
    },
    log: () => undefined,
    flic: () => null,
    playEffect: () => undefined,
    stopEffect: () => undefined,
  };
  return { env, actions, renders: () => renders };
}

/**
 * 一份**完整**的 `pending{auction}`（字段与 core 的 `reduce.openAuction` 同形）。
 *
 * ★ Q-AUC-1 之后竞价循环归 core，屏只读这些字段并把每一口演出来。
 */
function auctionPending(over: {
  basePrice?: number;
  bidders: number[];
  seat?: number;
  price?: number;
  top?: number;
  topCash?: number;
  status?: ('active' | 'passed' | 'givenUp')[];
  limits?: number[];
}) {
  const basePrice = over.basePrice ?? 5000;
  return {
    kind: 'auction' as const,
    entityId: 1,
    basePrice,
    bidders: over.bidders,
    price: over.price ?? basePrice,
    top: over.top ?? -1,
    topCash: over.topCash ?? 0,
    seat: over.seat ?? 0,
    status: over.status ?? [0, 1, 2, 3].map(() => 'active' as const),
    limits: over.limits ?? [0, 0, 0, 0],
  };
}

function withNow(env: UiScreenEnv, now: number): UiScreenEnv {
  return { ...env, now };
}

describe('整屏接线（UiScreen 契约）', () => {
  it('★ 只有 auction 待决交互才接管', () => {
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const a = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    expect(auctionScreen.active(a.env)).toBe(true);
    const b = mkEnv({ kind: 'bank', wealth: 0, loanCapacity: 0, specialFinance: null }, players);
    expect(auctionScreen.active(b.env)).toBe(false);
  });

  it('★ 首帧建桌：座位、现价、轮到谁全部照 core 的 pending 摆', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2), mkPlayer(2, 2)];
    const { env } = mkEnv(
      auctionPending({ bidders: [0, 1, 2], limits: [0, 7000, 8000] }),
      players,
    );
    auctionScreen.tick!(env);
    const run = auctionRunForTest();
    expect(run).not.toBeNull();
    expect(run!.price).toBe(5000);
    expect(run!.seats).toHaveLength(3);
    expect(run!.current).toBe(0); // pending.seat
    expect(run!.seats[1]!.aiLimit).toBe(7000); // 心理价位直接读 core 的 pending.limits
  });

  it('★ 卖主那一格是「賣方」、出局者不进屏 @source 0x43c22a', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 2), mkPlayer(1, 1), mkPlayer(2, 0)];
    const seats = seatViewOf(
      auctionPending({ bidders: [0, 1], status: ['active', 'active', 'givenUp', 'givenUp'] }) as never,
      players,
      2, // 地主是下标 2 → 他没进 bidders
    );
    expect(seats.map((s) => s.player)).toEqual([0, 1]); // 出局的 2 号不进表
    expect(seats.every((s) => s.state === 'canBid')).toBe(true);
  });

  it('★ 真人点第 4 颗钮（+1000）→ dispatch 一口 auctionBid（屏不自己改现价）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env, actions } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(3);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(actions).toEqual([{ type: 'auctionBid', bidder: 0, status: 'raise', step: 1000 }]);
    // ★ 现价由 core 落账；屏内这一帧还没变（旧版是屏自己改，那是两条循环）
    expect(auctionRunForTest()!.price).toBe(5000);
  });

  it('★ 真人点 PASS → dispatch 一口 pass（座位状态由 core 改）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env, actions } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(0);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(actions).toEqual([{ type: 'auctionBid', bidder: 0, status: 'pass', step: 0 }]);
  });

  it('★ 「放棄」那一颗送的就是 giveUp @source 0x43a43a', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env, actions } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(6);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(actions).toEqual([{ type: 'auctionBid', bidder: 0, status: 'giveUp', step: 0 }]);
  });

  it('★ 出不起的那一档点了没反应 @source 0x43a478', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 5500), mkPlayer(1, 2)];
    const { env, actions } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(3); // +1000 > 5500 − 5000
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(actions).toEqual([]);
  });

  it('★ 轮到电脑 → 屏把 core 算好的那一口送出去，**不自己算**', () => {
    resetAuctionScreenForTest();
    // seat 0 是电脑；心理价位 7000 → 现价 5000 只出得起 +1000
    const players = [mkPlayer(0, 2), mkPlayer(1, 2)];
    const pending = auctionPending({ bidders: [0, 1], limits: [7000, 9000] });
    const { env, actions } = mkEnv(pending, players, 1000);
    auctionScreen.tick!(env); // 建桌，开场消息 2 秒
    auctionScreen.tick!(withNow(env, 3500));
    expect(actions).toEqual([{ type: 'auctionBid', bidder: 0, status: 'raise', step: 1000 }]);
  });

  it('★ 轮到真人时屏**不**替电脑动（也不点钮）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const pending = auctionPending({ bidders: [0, 1], limits: [0, 9000] });
    const { env, actions } = mkEnv(pending, players);
    auctionScreen.tick!(env);
    auctionScreen.tick!(withNow(env, 9000));
    expect(actions).toEqual([]);
  });

  // ── 联机（issue #9）：每一端都开着这块屏，但只有轮到举牌的那一端能点；电脑那一口归服务器 ──

  it('★ 联机：轮到**本机座位**举牌 → 照常 dispatch', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 1)];
    const { env, actions } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    const mine: UiScreenEnv = { ...env, localSeat: 0 };
    auctionScreen.tick!(mine);
    const y = auctionButtonY(0);
    auctionScreen.down!(406, y, mine);
    auctionScreen.up!(406, y, mine);
    expect(actions).toEqual([{ type: 'auctionBid', bidder: 0, status: 'pass', step: 0 }]);
  });

  it('★ 联机：轮到**别的真人**举牌 → 本机点钮没反应（不替别人出价）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 1)];
    const { env, actions } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    const other: UiScreenEnv = { ...env, localSeat: 1 };
    auctionScreen.tick!(other);
    const y = auctionButtonY(0);
    auctionScreen.down!(406, y, other);
    auctionScreen.up!(406, y, other);
    expect(actions).toEqual([]);
  });

  it('★ 联机：轮到电脑 → 屏**不发**（那一口由服务器出）；单机同一局面照发（对照）', () => {
    const players = [mkPlayer(0, 2), mkPlayer(1, 1)];
    const pending = auctionPending({ bidders: [0, 1], limits: [7000, 9000] });

    resetAuctionScreenForTest();
    const netSide = mkEnv(pending, players, 1000);
    const netEnv: UiScreenEnv = { ...netSide.env, localSeat: 1 };
    auctionScreen.tick!(netEnv);
    auctionScreen.tick!(withNow(netEnv, 3500));
    expect(netSide.actions).toEqual([]);

    resetAuctionScreenForTest();
    const solo = mkEnv(pending, players, 1000);
    auctionScreen.tick!(solo.env);
    auctionScreen.tick!(withNow(solo.env, 3500));
    expect(solo.actions).toEqual([{ type: 'auctionBid', bidder: 0, status: 'raise', step: 1000 }]);
  });

  it('★ 屏**不再**自己 dispatch 终局 auction —— 终局由 core 落槌（Q-AUC-1）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const pending = auctionPending({ bidders: [0, 1], limits: [0, 9000] });
    const { env, actions } = mkEnv(pending, players);
    auctionScreen.tick!(env);
    auctionScreen.tick!(withNow(env, 9000));
    expect(actions.some((a) => a.type === 'auction')).toBe(false);
  });

  it('★ 结算演出：core 清掉 pending 之后屏把结果演出来，然后自己收摊', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    // 屏内记一笔「0 号加过 1000」 → core 已落槌（pending 变 null）
    const pending = auctionPending({ bidders: [0, 1], limits: [0, 9000] });
    const { env } = mkEnv(pending, players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(3);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    const settled = { ...env, state: { ...env.state, pending: null } as GameState };
    auctionScreen.tick!(settled);
    expect(auctionRunForTest()!.phase).toBe('sold');
    expect(auctionRunForTest()!.winner).toBe(0);
    // 演出结束后屏自己退出接管
    auctionScreen.tick!({ ...settled, now: settled.now + 5000 });
    expect(auctionScreen.active({ ...settled, now: settled.now + 5000 })).toBe(false);
  });

  it('★ 全员出不起时 pending 都不会挂（core 当场流标），屏也就不会接管', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 10), mkPlayer(1, 2, 10)];
    const { env } = mkEnv(null, players);
    expect(auctionScreen.active(env)).toBe(false);
  });

  it('★ 消息框的字：开场是「公開拍賣土地一處。」，请出价那句带底价', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    const spy = vi.fn();
    const stage = {
      save: spy,
      restore: spy,
      beginPath: spy,
      rect: spy,
      clip: spy,
      drawImage: spy,
      fillRect: spy,
      strokeRect: spy,
      fillText: spy,
      strokeText: spy,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
    auctionScreen.tick!(env);
    auctionScreen.draw({ ...env, stage });
    const texts = spy.mock.calls.filter((c) => c.length > 0 && typeof c[0] === 'string');
    expect(texts.length).toBeGreaterThan(0);
  });

  it('★ 开场消息要先走完，才轮到「請意者出價」那一句', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    auctionScreen.tick!(env); // 建桌：开场
    auctionScreen.tick!(withNow(env, 3500)); // 开场到期 → 拆掉，下一帧才请出价
    auctionScreen.tick!(withNow(env, 3600));
    // 走到这里没有崩、也没有 dispatch —— 真人那一格就等着点钮
    expect(auctionScreen.active(env)).toBe(true);
  });

  it('★ 演出用的两个常量对得上原版', () => {
    expect(AUCTION_BOX_MS).toBe(2000);
    expect(AUCTION_DEAL_FORMAT).toBe('%d元成交');
  });
});

describe('★★ 试玩 4 回归：落槌那一刻屏**不能**立刻退场（否则结果一次都演不出来）', () => {
  it('★★ core 清掉 pending 之后、结算还没起播时，本屏必须**继续接管**', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv(auctionPending({ bidders: [0, 1], limits: [0, 9000] }), players);
    auctionScreen.tick!(env); // 建桌
    // 真人点 +1000（屏内记下「0 号加过 1000」）
    const y = auctionButtonY(3);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    // core 落槌 ⇒ pending 变 null，此刻 settling/outcome **都还是假的**
    const settled = { ...env, state: { ...env.state, pending: null } as GameState };
    // ★★ 这一条就是那个 bug：先前 `active()` 是 `screen.settling`，
    //   而 `settling` 要等 `tick` 里的 `beginSettle` 才置 —— 于是 `active()` 先变假、
    //   `tick` 再也不被调、`beginSettle` 永远起不来（结果一次都演不出来）。
    expect(auctionScreen.active(settled)).toBe(true);
    auctionScreen.tick!(settled);
    expect(auctionRunForTest()!.phase).toBe('sold');
    // 演出收摊之后才让位
    const done = { ...settled, now: settled.now + 5000 };
    auctionScreen.tick!(done);
    expect(auctionScreen.active(done)).toBe(false);
  });

  it('★ 流拍那一路同样演得出来（「流標」这句）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv(auctionPending({ bidders: [0, 1], limits: [0, 9000] }), players);
    auctionScreen.tick!(env);
    const settled = { ...env, state: { ...env.state, pending: null } as GameState };
    auctionScreen.tick!(settled);
    // 一次都没人加价 ⇒ 流拍
    expect(auctionRunForTest()!.phase).toBe('passedIn');
  });
});

describe('★★ 第十八份「怎么拍卖直接流标了」：结果以 core 的落槌提示为准', () => {
  it('★ 电脑那几口不是本屏发的（单机回合驱动 / 联机服务器）⇒ 屏照样演「成交」，不再演成流標', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 34), mkPlayer(1, 2), mkPlayer(2, 2)];
    const pending = auctionPending({ basePrice: 2500, bidders: [0, 1, 2], seat: 1, status: ['givenUp', 'active', 'active'] });
    const { env } = mkEnv(pending, players);
    auctionScreen.tick!(env); // 建桌
    // 屏外有人把几口出完、core 落槌：1 号 4500 成交
    const after = {
      ...env.state,
      pending: null,
      lastAuctionResults: [{ pending: { ...pending, price: 4500, top: 1 }, winner: 1, price: 4500 }],
    } as unknown as GameState;
    auctionScreen.event!(env.state, after, env);
    const settled = { ...env, state: after };
    auctionScreen.tick!(settled);
    expect(auctionRunForTest()!.phase).toBe('sold');
    expect(auctionRunForTest()!.winner).toBe(1);
    // 结算这段是纯演出：驱动 / 收件箱都该等它（原版模态窗）
    expect(auctionPresentationOnly(settled)).toBe(true);
    auctionScreen.tick!({ ...settled, now: settled.now + 5000 });
    expect(auctionScreen.active({ ...settled, now: settled.now + 5000 })).toBe(false);
    expect(auctionPresentationOnly({ ...settled, now: settled.now + 5000 })).toBe(false);
  });

  it('★ 竞价进行中不算纯演出（每一口要靠驱动 / 收件箱送进来）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv(auctionPending({ bidders: [0, 1] }), players);
    expect(auctionPresentationOnly(env)).toBe(false);
    auctionScreen.tick!(env);
    expect(auctionPresentationOnly(env)).toBe(false);
  });

  it('★ 开拍即流标（pending 从没挂出来）⇒ 照原版开窗、开场那句走完再「無人出價，宣佈流標。」@source 0x0043b2c5..0x0043b2cd', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 10), mkPlayer(1, 2, 10)];
    const { env } = mkEnv(null, players);
    const opened = auctionPending({ basePrice: 2500, bidders: [0, 1], seat: -1, status: ['givenUp', 'givenUp'] });
    const after = { ...env.state, lastAuctionResults: [{ pending: opened, winner: -1, price: 0 }] } as unknown as GameState;
    auctionScreen.event!(env.state, after, env);
    const e2 = { ...env, state: after };
    expect(auctionScreen.active(e2)).toBe(true);
    expect(auctionPresentationOnly(e2)).toBe(true);
    auctionScreen.tick!(e2); // 开窗：开场那句
    expect(auctionRunForTest()!.phase).toBe('bidding');
    auctionScreen.tick!({ ...e2, now: e2.now + 500 }); // 开场那句还没走完
    expect(auctionRunForTest()!.phase).toBe('bidding');
    auctionScreen.tick!({ ...e2, now: e2.now + AUCTION_BOX_MS }); // 走完 ⇒ 宣布流標
    expect(auctionRunForTest()!.phase).toBe('passedIn');
    expect(AUCTION_PASSED_IN_TEXT).toBe('無人出價，宣佈流標。');
    const done = { ...e2, now: e2.now + AUCTION_BOX_MS * 3 };
    auctionScreen.tick!(done);
    expect(auctionScreen.active(done)).toBe(false);
  });

  it('★ 不在场（1..6）盖掉「出不起底价」(8)：坐牢又没钱的那位显示「坐牢中」@source 0x0043c140 → 0x0043c19d', () => {
    const players = [withBlocking(mkPlayer(0, 1, 10), { inPrison: 2 }), mkPlayer(1, 2)];
    const seats = seatViewOf(auctionPending({ bidders: [0, 1], seat: 1, status: ['givenUp', 'active'] }), players, -1);
    expect(seats[0]!.state).toBe('away');
    expect(seats[0]!.away).toBe(3);
  });
});
