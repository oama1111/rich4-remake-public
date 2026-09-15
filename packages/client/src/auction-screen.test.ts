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
import { auctionAiLimit, auctionAiRaise, auctionCanAfford } from '@rich4/core';
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
  activeSeatCount,
  auctionAdvance,
  auctionButtonRect,
  auctionButtonY,
  auctionEntityImage,
  auctionFinished,
  auctionOutcome,
  auctionPass,
  auctionRaise,
  auctionRunForTest,
  auctionScreen,
  auctionSeatY,
  auctionSeats,
  awayCodeOf,
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
} from './auction-screen.ts';
import type { AuctionRun } from './auction-screen.ts';
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

  it('★ awayCodeOf 按 +0x32..+0x37 的先后取第一个非 0', () => {
    const base = mkPlayer(0, 1);
    expect(awayCodeOf(base)).toBe(0);
    expect(awayCodeOf(withBlocking(base, { inHospital: 3 }))).toBe(4);
    expect(awayCodeOf(withBlocking(base, { inHotel: 1, inPrison: 2 }))).toBe(1);
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

/** 三个买家 + 一个卖主：`pending.bidders` 里没有卖主 */
function threeBidders(): { players: Player[]; run: AuctionRun } {
  const players = [mkPlayer(0, 1), mkPlayer(1, 2), mkPlayer(2, 2), mkPlayer(3, 2)];
  const seats = auctionSeats(players, [0, 1, 2], 3, 5000, () => 0);
  return {
    players,
    run: {
      seats,
      current: seats.findIndex((s) => s.state === 'canBid'),
      price: 5000,
      basePrice: 5000,
      top: -1,
      passes: 0,
      round: 0,
      phase: 'bidding',
      winner: -1,
    },
  };
}

describe('座位表 @source 0x43c110 起', () => {
  it('★ 卖主是「賣方」、出局者不进表、现金不够底价的记「出不起」', () => {
    const players = [mkPlayer(0, 0), mkPlayer(1, 1, 100), mkPlayer(2, 2, 999999), mkPlayer(3, 2)];
    const seats = auctionSeats(players, [1, 2, 3], 3, 5000, () => 0);
    expect(seats.map((s) => [s.player, s.state])).toEqual([
      [1, 'broke'],
      [2, 'canBid'],
      [3, 'seller'],
    ]);
    // 0 号已出局（whoPlays === 0），1 号虽然列在 bidders 里但出不起
    expect(seats.some((s) => s.player === 0)).toBe(false);
  });

  it('★ 不在场的人只占位子、不出价', () => {
    const players = [
      mkPlayer(0, 1),
      withBlocking(mkPlayer(1, 2), { inPrison: 2 }),
      mkPlayer(2, 2),
    ];
    const seats = auctionSeats(players, [0, 1, 2], -1, 1000, () => 0);
    expect(seats.map((s) => s.state)).toEqual(['canBid', 'away', 'canBid']);
    expect(seats[1]!.away).toBe(3);
  });

  it('★ 只有可出价的电脑才去问心理价位（真人与卖主都不问）', () => {
    const players = [mkPlayer(0, 1), mkPlayer(1, 2), mkPlayer(2, 2)];
    const asked: number[] = [];
    const seats = auctionSeats(players, [0, 1, 2], 2, 1000, (player) => {
      asked.push(player);
      return 777;
    });
    expect(asked).toEqual([1]);
    expect(seats.find((s) => s.player === 1)!.aiLimit).toBe(777);
    expect(seats.find((s) => s.player === 0)!.aiLimit).toBe(0);
  });
});

describe('加价 @source loc_0043b3c2 起', () => {
  it('★ 加价改现价、登记最高者，然后把槌子交给下一位', () => {
    const { run } = threeBidders();
    const after = auctionRaise(run, 1000);
    expect(after.price).toBe(6000);
    expect(after.top).toBe(0);
    expect(after.current).toBe(1);
    expect(after.passes).toBe(0);
  });

  it('★ 连加三口：价格累加、最高者跟着换', () => {
    let run = threeBidders().run;
    run = auctionRaise(run, 1000); // 座位 0
    run = auctionRaise(run, 5000); // 座位 1
    expect(run.price).toBe(11000);
    expect(run.top).toBe(1);
    expect(run.current).toBe(2);
  });

  it('★ 加价会清掉「连续无人加价」的计数', () => {
    let run = threeBidders().run;
    run = auctionPass(run); // 座位 0 PASS
    expect(run.passes).toBe(1);
    run = auctionRaise(run, 100); // 座位 1 加价
    expect(run.passes).toBe(0);
  });

  it('★ 非正数的加价被忽略（原版没有 0 档）', () => {
    const { run } = threeBidders();
    expect(auctionRaise(run, 0)).toBe(run);
    expect(auctionRaise(run, -100)).toBe(run);
  });
});

describe('PASS 与流拍 @source loc_0043a426 / loc_0043b295', () => {
  it('★ PASS 把这一位踢出竞价，轮次跳到下一个还能出价的人', () => {
    const { run } = threeBidders();
    const after = auctionPass(run);
    expect(after.seats[0]!.state).toBe('passed');
    expect(after.current).toBe(1);
    expect(after.passes).toBe(1);
    expect(activeSeatCount(after)).toBe(2);
  });

  it('★ 出局 / 不在场 / 卖主都跳过，不会轮到他们', () => {
    const players = [
      withBlocking(mkPlayer(0, 2), { inHotel: 1 }),
      mkPlayer(1, 1),
      mkPlayer(2, 2),
    ];
    const seats = auctionSeats(players, [0, 1, 2], 2, 100, () => 0);
    const run: AuctionRun = {
      seats,
      current: 1,
      price: 100,
      basePrice: 100,
      top: -1,
      passes: 0,
      round: 0,
      phase: 'bidding',
      winner: -1,
    };
    const after = auctionAdvance(run);
    // 座位 0 是 away、座位 2 是卖主 → 只能绕回座位 1
    expect(after.current).toBe(1);
  });

  it('★ **三个买家全 PASS = 流拍**（卡片说的「三次无人加价」）', () => {
    let run = threeBidders().run;
    run = auctionPass(run); // 座位 0
    expect(auctionFinished(run)).toBe(false); // 还有两个能出价
    run = auctionPass(run); // 座位 1
    expect(auctionFinished(run)).toBe(false);
    run = auctionPass(run); // 座位 2 → 一个能出的都没有了
    expect(run.passes).toBe(3);
    expect(activeSeatCount(run)).toBe(0);
    expect(auctionFinished(run)).toBe(true);
    expect(auctionOutcome(run)).toEqual({ winner: -1, price: 0 });
  });

  it('★ 只剩最高出价者一个人能出价 → 成交（不是流拍）', () => {
    let run = threeBidders().run;
    run = auctionRaise(run, 1000); // 座位 0 出价 6000
    run = auctionPass(run); // 座位 1
    run = auctionPass(run); // 座位 2
    expect(activeSeatCount(run)).toBe(1);
    expect(auctionFinished(run)).toBe(true);
    expect(auctionOutcome(run)).toEqual({ winner: 0, price: 6000 });
  });

  it('★ 没人出价、但所有人都出不起 → 也是流拍', () => {
    const players = [mkPlayer(0, 2, 10), mkPlayer(1, 2, 10)];
    const seats = auctionSeats(players, [0, 1], -1, 5000, () => 0);
    const run: AuctionRun = {
      seats,
      current: 0,
      price: 5000,
      basePrice: 5000,
      top: -1,
      passes: 0,
      round: 0,
      phase: 'bidding',
      winner: -1,
    };
    expect(activeSeatCount(run)).toBe(0);
    expect(auctionFinished(run)).toBe(true);
    expect(auctionOutcome(run)).toEqual({ winner: -1, price: 0 });
  });

  it('★ 绕圈上限是安全阀 —— 超过就收摊', () => {
    const { run } = threeBidders();
    expect(auctionFinished({ ...run, round: 13 })).toBe(true);
  });
});

// ============================================================
//  core 的 AI 出口
// ============================================================

describe('core：AI 心理价位 @source fcn_00439f0d', () => {
  it('★ 恒定随机数下，取「(等级/2+1+同名数)×起拍价×物价×缺地系数×系数」与「地价×物价×3」的小者', () => {
    // rnd 恒为 0 → factor = 0.5、rand/65536 = 0
    const v = auctionAiLimit(
      {
        level: 1,
        landPrice: 3000,
        cash: 1_000_000,
        priceIndex: 1,
        basePrice: 5000,
        total: 10,
        unowned: 5,
        sameNameOwned: 0,
      },
      () => 0,
    );
    // scarcity = 6 − 4×0.5 = 4；(0+1+0)×5000×1×4×0.5 = 10000；地价那支 = 3000×3 = 9000 → 取 9000
    expect(v).toBe(9000);
  });

  it('★ 最后一步夹到现金', () => {
    const v = auctionAiLimit(
      {
        level: 5,
        landPrice: 100000,
        cash: 1234,
        priceIndex: 1,
        basePrice: 5000,
        total: 10,
        unowned: 10,
        sameNameOwned: 3,
      },
      () => 0.99,
    );
    expect(v).toBe(1234);
  });

  it('★ 没有产业时不会除零', () => {
    expect(
      auctionAiLimit(
        { level: 0, landPrice: 0, cash: 999, priceIndex: 1, basePrice: 100, total: 0, unowned: 0 },
        () => 0.5,
      ),
    ).toBe(0);
  });
});

describe('core：AI 挑档 @source loc_0043b124', () => {
  it('★ 从最大档往下挑第一档「出得起」的', () => {
    expect(auctionAiRaise(100000, 1000, 100000)).toBe(10000);
    expect(auctionAiRaise(11000, 1000, 100000)).toBe(10000);
    expect(auctionAiRaise(10999, 1000, 100000)).toBe(5000);
    expect(auctionAiRaise(6000, 1000, 100000)).toBe(5000);
    expect(auctionAiRaise(5999, 1000, 100000)).toBe(1000);
    expect(auctionAiRaise(1100, 1000, 100000)).toBe(100);
    expect(auctionAiRaise(1099, 1000, 100000)).toBe(0);
  });

  it('★ 现金比现价还少就直接 PASS', () => {
    expect(auctionAiRaise(999999, 5000, 4000)).toBe(0);
  });

  it('★ 会把档位压到「最高出价者现金 + 500」那一档', () => {
    // 心理价位很高，但最高者只有 900 → 现价 1000 + 10000 超过 900+500
    expect(auctionAiRaise(999999, 1000, 999999, 900)).toBe(500);
  });

  it('★ 真人那一口：现价 + 档位 > 现金就整个不响应 @source 0x43a478', () => {
    expect(auctionCanAfford(1000, 1000, 2000)).toBe(true);
    expect(auctionCanAfford(1000, 1001, 2000)).toBe(false);
  });
});

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
  };
  return { env, actions, renders: () => renders };
}

function withNow(env: UiScreenEnv, now: number): UiScreenEnv {
  return { ...env, now };
}

describe('整屏接线（UiScreen 契约）', () => {
  it('★ 只有 auction 待决交互才接管', () => {
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const a = mkEnv({ kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] }, players);
    expect(auctionScreen.active(a.env)).toBe(true);
    const b = mkEnv({ kind: 'bank', wealth: 0, loanCapacity: 0, specialFinance: null }, players);
    expect(auctionScreen.active(b.env)).toBe(false);
  });

  it('★ 首帧建桌：座位排好、现价 = 起拍价', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2), mkPlayer(2, 2)];
    const { env } = mkEnv({ kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1, 2] }, players);
    auctionScreen.tick!(env);
    const run = auctionRunForTest();
    expect(run).not.toBeNull();
    expect(run!.price).toBe(5000);
    expect(run!.seats).toHaveLength(3);
    expect(run!.current).toBe(0);
  });

  it('★ 真人点第 4 颗钮（+1000）→ 现价涨、dispatch 还没发生', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env, actions } = mkEnv(
      { kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] },
      players,
    );
    auctionScreen.tick!(env);
    const y = auctionButtonY(3);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(auctionRunForTest()!.price).toBe(6000);
    expect(actions).toEqual([]);
  });

  it('★ 真人点 PASS → 这一位出局；只剩电脑时电脑会自己走', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv({ kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] }, players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(0);
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(auctionRunForTest()!.seats[0]!.state).toBe('passed');
  });

  it('★ 出不起的那一档点了没反应 @source 0x43a478', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 5500), mkPlayer(1, 2)];
    const { env } = mkEnv({ kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] }, players);
    auctionScreen.tick!(env);
    const y = auctionButtonY(3); // +1000 > 500
    auctionScreen.down!(406, y, env);
    auctionScreen.up!(406, y, env);
    expect(auctionRunForTest()!.price).toBe(5000);
  });

  it('★ 全电脑自己跑：最后一定 dispatch 一次 auction，且不会再 dispatch', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 2), mkPlayer(1, 2), mkPlayer(2, 2)];
    const base = mkEnv(
      { kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1, 2] },
      players,
    );
    let env = base.env;
    auctionScreen.tick!(env);
    for (let t = 1000; t < 120000; t += 200) {
      env = withNow(base.env, t);
      auctionScreen.tick!(env);
    }
    expect(base.actions).toHaveLength(1);
    const a = base.actions[0]!;
    expect(a.type).toBe('auction');
    if (a.type === 'auction') {
      expect(a.price).toBeGreaterThanOrEqual(5000);
      expect([-1, 0, 1, 2]).toContain(a.winner);
    }
  });

  it('★ 全员出不起 → 直接流拍（winner = -1, price = 0）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 10), mkPlayer(1, 2, 10)];
    const base = mkEnv(
      { kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] },
      players,
    );
    auctionScreen.tick!(base.env);
    for (let t = 1000; t < 20000; t += 200) auctionScreen.tick!(withNow(base.env, t));
    expect(base.actions).toEqual([{ type: 'auction', winner: -1, price: 0 }]);
  });

  it('★ 结算演出里点一下 = 立刻收摊（原版 `fcn_0044ee18(1)`）', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1, 10), mkPlayer(1, 2, 10)];
    const base = mkEnv(
      { kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] },
      players,
    );
    auctionScreen.tick!(base.env); // 第一帧建桌
    auctionScreen.tick!(base.env); // 第二帧才发现「一个能出价的都没有」
    expect(base.actions).toHaveLength(0);
    auctionScreen.down!(0, 0, base.env);
    expect(base.actions).toEqual([{ type: 'auction', winner: -1, price: 0 }]);
  });

  it('★ 消息框的字：开场是「公開拍賣土地一處。」，请出价那句带底价', () => {
    resetAuctionScreenForTest();
    const players = [mkPlayer(0, 1), mkPlayer(1, 2)];
    const { env } = mkEnv({ kind: 'auction', entityId: 1, basePrice: 5000, bidders: [0, 1] }, players);
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

  it('★ 演出用的两个常量对得上原版', () => {
    expect(AUCTION_BOX_MS).toBe(2000);
    expect(AUCTION_DEAL_FORMAT).toBe('%d元成交');
  });
});
