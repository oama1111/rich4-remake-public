/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 拍賣 —— 以 run_auction（VA 0x0043bde5）为准
 */

import { WatcomRng } from '../rng/watcom.ts';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from '../state/reduce.ts';
import type { MapTopology } from '../state/reduce.ts';
import { decideAction } from '../ai/policy.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_AUTOPILOT, WHO_PLAYS_HUMAN,} from '../state/types.ts';
import type { GameState } from '../state/types.ts';
import { parseMap, type Rich4Map } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { housingIndexOf } from '../rules/land.ts';
import {
  AUCTION_BUTTON_GIVE_UP,
  AUCTION_BUTTON_PASS,
  AUCTION_LEVEL_FACTOR,
  AUCTION_LIMIT_RAND_DIVISOR,
  AUCTION_RAISE_STEPS,
  AUCTION_SEAT_LABEL_OFFSET,
  AUCTION_SEAT_LIMIT_OFFSET,
  AUCTION_SEAT_PLAYER_OFFSET,
  AUCTION_SEAT_STATUS_OFFSET,
  AUCTION_SEAT_STRIDE,
  auctionActiveSeatCount,
  auctionAdvanceSeat,
  auctionAiChoice,
  auctionAiLimit,
  auctionAiLimits,
  auctionAiRaise,
  auctionBasePrice,
  auctionCanAfford,
  auctionCardHostility,
  auctionFinished,
  auctionFirstSeat,
  auctionAllBlocked,
  auctionOutcome,
  auctionSeatStatus,
  eligibleBidders,
  settleAuction,
  settleFacilityAuction,
  truncTowardZero,
  type AuctionSeatStatus,
} from './auction.ts';

const four = () =>
  [0, 1, 2, 3].map((i) => makePlayer({ index: i, cash: 100_000, moneyInBank: 0 }));

describe('★ 起拍价 = trunc(地价 × (1 + 等级×0.5)) × 物价指数', () => {
  it('等级 0 时就是地价', () => {
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 0 }), 1)).toBe(2000);
  });

  it('每级加半成地价', () => {
    expect(AUCTION_LEVEL_FACTOR).toBe(0.5);
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 1 }), 1)).toBe(3000);
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 2 }), 1)).toBe(4000);
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 5 }), 1)).toBe(7000);
  });

  it('再乘物价指数', () => {
    expect(auctionBasePrice(makeLand({ landPrice: 2000, level: 1 }), 7)).toBe(21_000);
  });

  it('★ 取整在乘物价指数**之前**', () => {
    // 地价 999、等级 1 → 999×1.5 = 1498.5 → trunc → 1498 → ×3 = 4494
    // 若先乘后取整：999×1.5×3 = 4495.5 → trunc → 4495，差 1
    expect(auctionBasePrice(makeLand({ landPrice: 999, level: 1 }), 3)).toBe(4494);
  });

  it('★ 取整是**向零截断**（`__round_toward_zero` @ 0x457dbc，RC=11）', () => {
    // 1001 × 1.5 = 1501.5 → 截断 → 1501（不是就近取偶的 1502）
    expect(auctionBasePrice(makeLand({ landPrice: 1001, level: 1 }), 1)).toBe(1501);
    // 999 × 1.5 = 1498.5 → 截断 → 1498
    expect(auctionBasePrice(makeLand({ landPrice: 999, level: 1 }), 1)).toBe(1498);
    // 负数也向零：-3.5 → -3
    expect(truncTowardZero(-3.5)).toBe(-3);
    expect(truncTowardZero(2.5)).toBe(2);
  });
});

describe('★ 流拍 → 地块变无主', () => {
  it('原主失去地产，且没人付钱', () => {
    const land = makeLand({ id: 1, owner: 2, level: 3 });
    const r = settleAuction(four(), land, { winner: -1, price: 0 }, 500);
    expect(r.passedIn).toBe(true);
    expect(r.land.owner).toBe(0);
    expect(r.pool).toBe(500);
    expect(r.players.map((p) => p.cash)).toEqual([100_000, 100_000, 100_000, 100_000]);
  });

  it('★ 这是拍賣卡的要害：即便没人接手，原主也失去它', () => {
    const land = makeLand({ owner: 3 });
    expect(settleAuction(four(), land, { winner: -1, price: 0 }).land.owner).toBe(0);
  });
});

describe('得标', () => {
  it('买家付钱、地块易主、款项进公库（arg0 == -1 那一路）', () => {
    const land = makeLand({ id: 1, owner: 2 });
    const r = settleAuction(four(), land, { winner: 0, price: 3000 }, 0, [], { payee: -1 });
    expect(r.passedIn).toBe(false);
    expect(r.land.owner).toBe(1); // winner + 1
    expect(r.players[0]!.cash).toBe(97_000);
    expect(r.pool).toBe(3000);
  });

  it('★ 与购地卡不同——那张是把钱给原主，这里进公库（仅 arg0 == -1）', () => {
    const r = settleAuction(four(), makeLand({ owner: 2 }), { winner: 0, price: 3000 }, 0, [], {
      payee: -1,
    });
    // 原主（下标 1）分文未得
    expect(r.players[1]!.cash).toBe(100_000);
    expect(r.players[1]!.moneyInBank).toBe(0);
  });

  it('买家钱不够会动存款并可能破产', () => {
    const ps = four();
    ps[0] = makePlayer({ index: 0, cash: 100, moneyInBank: 50 });
    const r = settleAuction(ps, makeLand({ owner: 2 }), { winner: 0, price: 9999 });
    expect(r.bankrupted).toBe(true);
  });
});

describe('★★ A1 落槌款去向 = arg0（发起拍卖者），不是公库', () => {
  it('★★ 拍賣卡：钱进**用卡者**的存款，“地主”一分不得（0x43c844 push arg0）', () => {
    // @source 0x43c844 `mov ecx,[esp+0xb4]`（= arg0）→ 0x43c855 `call 0x41d2c6`
    const land = makeLand({ id: 1, owner: 2 }); // 地主 = 玩家 1
    const r = settleAuction(four(), land, { winner: 0, price: 3000 }, 0, [], { payee: 2 });
    expect(r.land.owner).toBe(1); // 得标者 = 玩家 0
    expect(r.players[0]!.cash).toBe(97_000); // 买家付现金
    expect(r.players[2]!.moneyInBank).toBe(3000); // ★ arg0 收**存款**（flags = 0）
    expect(r.players[2]!.cash).toBe(100_000); // 不进现金
    expect(r.players[2]!.monthlyReceived).toBe(3000); // @source `+0x60`
    expect(r.pool).toBe(0); // ★ 公库不动
    expect(r.players[1]!.cash).toBe(100_000); // 地主分文未得
  });

  it('★ 得标者 == arg0（用卡者自己拍到）⇒ 照样先扣后入：现金 → 存款', () => {
    // 原版 pay_money 先处理付款方、再处理收款方，同一个人时净效果如上。
    const r = settleAuction(four(), makeLand({ owner: 0 }), { winner: 0, price: 4000 }, 0, [], {
      payee: 0,
    });
    expect(r.players[0]!.cash).toBe(96_000);
    expect(r.players[0]!.moneyInBank).toBe(4000);
    expect(r.pool).toBe(0);
  });

  it('★ 省略 payee（= 没有卖家）⇒ 沿用公库', () => {
    const r = settleAuction(four(), makeLand({ owner: 2 }), { winner: 0, price: 3000 });
    expect(r.pool).toBe(3000);
  });

  it('★ 設施支同理：0x443476 的第一个实参也是用卡者', () => {
    const r = settleFacilityAuction(
      four(),
      makeFacility({ id: 1, owner: 2 }),
      { winner: 3, price: 5000 },
      0,
      [],
      { payee: 1 },
    );
    expect(r.facility.owner).toBe(4);
    expect(r.players[3]!.cash).toBe(95_000);
    expect(r.players[1]!.moneyInBank).toBe(5000); // arg0 = 玩家 1 收存款
    expect(r.pool).toBe(0);
  });
});

describe('参与资格', () => {
  it('★★ A2：排除的是 **arg0（发起拍卖者）**，不是地主', () => {
    // 旧断言（本文件 119-121 行）写的是「排除现任地主」—— 与 exe 相反：
    //   @source 0x43c109 `mov ebp, [esp+0xac]`（arg0）+ 0x43c22a `cmp ebx,ebp / jne`
    //   ⇒ 座位表里**只有** arg0 拿状态 7，地主照坐、照举牌。
    // 地主 = 玩家 2（1 基 3）；arg0 = 玩家 1
    const land = makeLand({ owner: 3 });
    expect(eligibleBidders(four(), land, 1)).toEqual([0, 2, 3]);
  });

  it('★★ 地主可以举牌把自己的地买回来（他自己也在名单里）', () => {
    const land = makeLand({ owner: 2 }); // 玩家 1 是地主
    expect(eligibleBidders(four(), land, 0)).toEqual([1, 2, 3]);
    expect(eligibleBidders(four(), land, 0)).toContain(1);
  });

  it('★ arg0 == -1（新聞 7 / 破产清算：没有卖方席位）⇒ 谁都不排除', () => {
    expect(eligibleBidders(four(), makeLand({ owner: 3 }), -1)).toEqual([0, 1, 2, 3]);
  });

  it('★ 无主地自拍也排除 arg0（用卡者不能举自己的牌）', () => {
    expect(eligibleBidders(four(), makeLand({ owner: 0 }), 0)).toEqual([1, 2, 3]);
  });

  it('排除出局者', () => {
    const ps = four();
    ps[1] = makePlayer({ index: 1, whoPlays: 0 });
    expect(eligibleBidders(ps, makeLand({ owner: 0 }), -1)).toEqual([0, 2, 3]);
  });

  it('★ 不按现金过滤——是否举得起牌由出价方自己判断', () => {
    const ps = four();
    ps[2] = makePlayer({ index: 2, cash: 0, moneyInBank: 0 });
    expect(eligibleBidders(ps, makeLand({ owner: 0 }), -1)).toContain(2);
  });
});

describe('★ 設施起拍价与结算（run_auction 設施分支 0x0043bf3a 起）', () => {
  it('底价公式与地块同式（地价读 +0x22）', () => {
    expect(auctionBasePrice(makeFacility({ landPrice: 4000, level: 2 }), 3)).toBe(4000 * 2 * 3);
  });

  it('流拍 → 設施变无主', () => {
    const r = settleFacilityAuction(four(), makeFacility({ id: 1, owner: 2, level: 1 }), { winner: -1, price: 0 });
    expect(r.passedIn).toBe(true);
    expect(r.facility.owner).toBe(0);
  });

  it('得标：买家付款进公库、設施归得标者', () => {
    const r = settleFacilityAuction(four(), makeFacility({ id: 1, owner: 2, level: 1 }), { winner: 3, price: 5000 }, 0);
    expect(r.facility.owner).toBe(4);
    expect(r.players[3]!.cash).toBe(95_000);
    expect(r.pool).toBe(5000);
  });
});

/**
 * ★★ A6 —— 拍卖成交**要写到到期日**。
 *
 * @source 0x43c77b / 0x43c799 / 0x43c7a8（地產 +0x30；設施 0x43c7d3 起同构写 +0x34）：
 * ```asm
 * 0043c77b  cmp  ebx, [esp+0x8c] / je 0x43c83b  ; 得标者 == 原地主 ⇒ 不写
 * 0043c799  cmp  dword [0x499110], 0 / je       ; 土地權限 = 無限期 ⇒ 不写
 * 0043c7a8  cmp  byte [land+0x19], 0 / jne      ; **原为有主** ⇒ 不写
 * 0043c7c9  mov  [edx + 0x30], eax              ; 写 date_add(今天, 年限表[權限])
 * ```
 * 复刻原先只在「買地 / 買設施」两处写（`reduce.ts` 的 `tenureExpiry`），
 * 拍卖这条路**一个字都不写** ⇒ 拍来的无主地永不到期。
 */
describe('★★ A6 成交要写到期日（原为无主 ∧ 土地權限 ≠ 無限期）', () => {
  const TODAY = 0x0100; // 原版测试台用的「今天」
  const ONE_YEAR = 0x1_0000; // 年限表 0x4751f0[2]
  const SIX_MONTHS = 0x600; // 年限表[3]

  it('★ 原为无主 + 权限非無限期 ⇒ tenure = 今天的日期 + 年限表项', () => {
    const r = settleAuction(four(), makeLand({ owner: 0 }), { winner: 1, price: 1000 }, 0, [], {
      expiry: TODAY + SIX_MONTHS,
    });
    expect(r.tenure).toBe(0x0700); // 0x100 + 0x600（月不回卷）
  });

  it('★ 原为无主 + 一年档 ⇒ 32 位加法（0x10100）', () => {
    const r = settleAuction(four(), makeLand({ owner: 0 }), { winner: 0, price: 1 }, 0, [], {
      expiry: TODAY + ONE_YEAR,
    });
    expect(r.tenure).toBe(0x1_0100);
  });

  it('★ 原为**有主**（拍卖别人的地）⇒ 不写，旧主的到期日保留', () => {
    const r = settleAuction(four(), makeLand({ owner: 2 }), { winner: 0, price: 1000 }, 0, [], {
      expiry: 0x0700,
    });
    expect(r.tenure).toBe(0); // @source 0x43c7a8
  });

  it('★ 权限 = 無限期（expiry 0）⇒ 不写', () => {
    const r = settleAuction(four(), makeLand({ owner: 0 }), { winner: 0, price: 1000 }, 0, [], {
      expiry: 0,
    });
    expect(r.tenure).toBe(0); // @source 0x43c799 `cmp [0x499110], 0`
  });

  it('★ 得标者 == 原地主 ⇒ 归属与到期日**都不写**（0x43c77b 那条跳过）', () => {
    // owner 1（1 基）= 玩家 0；winner 0 ⇒ winner+1 == owner
    const r = settleAuction(four(), makeLand({ owner: 1 }), { winner: 0, price: 1000 }, 0, [], {
      expiry: 0x0700,
    });
    expect(r.land.owner).toBe(1);
    expect(r.tenure).toBe(0);
  });

  it('★ 流拍 ⇒ 不写（窗口返回 -1 时整个结算段被跳过）', () => {
    const r = settleAuction(four(), makeLand({ owner: 0 }), { winner: -1, price: 0 }, 0, [], {
      expiry: 0x0700,
    });
    expect(r.passedIn).toBe(true);
    expect(r.tenure).toBe(0);
  });

  it('★ 設施支写在 +0x34（同一个 tenure 字段）', () => {
    const r = settleFacilityAuction(
      four(),
      makeFacility({ id: 1, owner: 0 }),
      { winner: 1, price: 1000 },
      0,
      [],
      { expiry: 0x0700 },
    );
    expect(r.tenure).toBe(0x0700);
    // 有主 ⇒ 不写
    const owned = settleFacilityAuction(
      four(),
      makeFacility({ id: 1, owner: 3 }),
      { winner: 1, price: 1000 },
      0,
      [],
      { expiry: 0x0700 },
    );
    expect(owned.tenure).toBe(0);
  });
});

/**
 * ★★ A8 —— 三处注释与字节相反，本轮按 exe 订正。注释本身没法断言，
 * 于是把它引用的**布局与按钮码**做成常量，在这里钉住（改坏常量即变红）：
 *
 * | 旧注释 | 真值（@source） |
 * |---|---|
 * | 「心理价位记在座位 `+8`」 | **`+4`**（`0x48c438`）；`+8` 是台词串 0（`0x48c43c`） |
 * | 「放棄写 4」 | 放棄是按钮码 **6**（`0x43b11a`），且**不写状态**，清的是座位 `+0`（`0x43a462`） |
 * | 「PASS 是永久的 / 没有一处写回 0」 | 每次**成功加价**都把四格状态清 0（`0x43a6bb`），开拍前显示循环也清（`0x43c4e8`） |
 */
describe('★★ A8 座位表布局与按钮码（注释订正的可证伪部分）', () => {
  it('★ 心理价位在座位 **+4**，不是 +8（0x48c438 − 0x48c434）', () => {
    expect(AUCTION_SEAT_STRIDE).toBe(0x14);
    expect(AUCTION_SEAT_PLAYER_OFFSET).toBe(0x00);
    expect(AUCTION_SEAT_STATUS_OFFSET).toBe(0x48c436 - 0x48c434); // +2
    expect(AUCTION_SEAT_LIMIT_OFFSET).toBe(0x48c438 - 0x48c434); // ★ +4
    expect(AUCTION_SEAT_LIMIT_OFFSET).toBe(4);
    // 旧注释说的 +8 是**第一张台词串**（0x48c43c）—— 差 4 格
    expect(AUCTION_SEAT_LABEL_OFFSET).toBe(0x48c43c - 0x48c434);
    expect(AUCTION_SEAT_LABEL_OFFSET).not.toBe(AUCTION_SEAT_LIMIT_OFFSET);
  });

  it('★ 按钮码：PASS = 0（0x43a41d）、放棄 = 6（0x43b11a）', () => {
    expect(AUCTION_BUTTON_PASS).toBe(0);
    expect(AUCTION_BUTTON_GIVE_UP).toBe(6);
  });
});

describe('★ 拍賣卡敌意 = double 压栈的原版 bug（0x00443286 起）', () => {
  it('常规地价：double 尾数低 32 位为 0 → 敌意恒为 0', () => {
    // 1000 × 1 × (0+2)/5 = 400.0 → 0x4079000000000000，低 32 位 = 0
    expect(auctionCardHostility(1000, 0, 1)).toBe(0);
    // 2000 × 3 × (4+2)/5 = 7200.0 → 低 32 位仍为 0
    expect(auctionCardHostility(2000, 4, 3)).toBe(0);
  });

  it('特大数值：低 32 位是尾数垃圾（可为负），照原样复刻', () => {
    // 10485765 × 1 × (0+2)/5 = 4194306.0 = 2^22 + 2
    //   尾数 2^-21 落在低 32 位最高位 → 0x80000000 → int32 最小值
    expect(auctionCardHostility(10485765, 0, 1)).toBe(-2147483648);
  });

  it('★★ 公式按 x87 的**逐步 double 舍入**算（PC = 0x027F ⇒ 53 位）', () => {
    // 原版实测（rich4-spec/tests/test_land_auction_cards.py，真跑 0x40df69）：
    //   (地价 3、物价 1、等级 0) ⇒ 3 × (2/5)：
    //     · 逐步 double（本实现）  = 1.2000000000000002 → 低 32 位 = **858993460**
    //     · 「精确乘积 ÷ 5」      = 1.2                → 低 32 位 = 858993459
    //   原版给的是 **858993460** ⇒ 必须逐步舍入（x87 默认精度控制字是 double）。
    expect(auctionCardHostility(3, 0, 1)).toBe(858_993_460);
    // 另一组原版实测值：(地价 1001、物价 1、等级 2) ⇒ +1717986919
    expect(auctionCardHostility(1001, 2, 1)).toBe(1_717_986_919);
  });
});

// ============================================================
//  ★ AI 出价：心理价位 fcn_00439f0d @ 0x00439f0d + 挑档 loc_0043b124 @ 0x0043b124
// ============================================================

describe('★ AI 心理价位 auctionAiLimit（fcn_00439f0d）', () => {
  /** 序列恒为 0 或 0.5 的假随机源（0 → rand() = 0；0.5 → rand() = 16384） */
  const fixed = (v: number) => () => v;

  it('★ 除数常量取 exe：0x465014 = f32 32767.0（不是 32766）', () => {
    // 逐字节 dump：0x465014 的 dword = 0x46fffe00 = 32767.0f
    expect(AUCTION_LIMIT_RAND_DIVISOR).toBe(32767);
  });

  it('★ 抽到最小随机数时，上限 = 起拍价 × 持地系数 × 缺地系数 × 0.5', () => {
    // 底价 1000、物价 1、总 10 块里 5 块无主 → 缺地系数 6 − 4×0.5 = 4
    // (等级 2 >> 1) + 1 + 同名 1 = 3 → 3 × 1000 × 1 = 3000
    // v1 = 3000 × 4 × 0.5 = 6000；v2 = 8000 × 3 = 24000 → 取小 = 6000
    expect(
      auctionAiLimit(
        {
          level: 2,
          landPrice: 8000,
          cash: 100_000,
          priceIndex: 1,
          basePrice: 1000,
          total: 10,
          unowned: 5,
          sameNameOwned: 1,
        },
        fixed(0),
      ),
    ).toBe(6000);
  });

  it('★ 两式取小：地价那一式更小时用 v2 = 地价 × 物价 × [3,4)', () => {
    // v1 = ((0>>1)+1+0) × 1000 × 1 × 缺地 6 × 0.5 = 3000
    // v2 = 500 × 1 × 3 = 1500 → 1500
    expect(
      auctionAiLimit(
        { level: 0, landPrice: 500, cash: 100_000, priceIndex: 1, basePrice: 1000, total: 10, unowned: 0 },
        fixed(0),
      ),
    ).toBe(1500);
  });

  it('★ 上限**夹到现金**（原版最后一条 `cmp eax, esi / jge`）', () => {
    const inputs = {
      level: 2,
      landPrice: 8000,
      priceIndex: 1,
      basePrice: 1000,
      total: 10,
      unowned: 5,
      sameNameOwned: 1,
    };
    expect(auctionAiLimit({ ...inputs, cash: 100_000 }, fixed(0))).toBe(6000);
    expect(auctionAiLimit({ ...inputs, cash: 6000 }, fixed(0))).toBe(6000); // 等于上限不夹
    expect(auctionAiLimit({ ...inputs, cash: 5999 }, fixed(0))).toBe(5999); // 少一块就夹到现金
    expect(auctionAiLimit({ ...inputs, cash: 0 }, fixed(0))).toBe(0); // 没钱 → 心理价位 0
  });

  it('★ 越缺地越敢出价（缺地系数 6 − 4×无主率）', () => {
    const base = { level: 0, landPrice: 100_000, cash: 100_000, priceIndex: 1, basePrice: 1000 };
    // 全无主：6 − 4×1 = 2 → v1 = 1×1000×2×0.5 = 1000
    expect(auctionAiLimit({ ...base, total: 10, unowned: 10 }, fixed(0))).toBe(1000);
    // 全有主：6 − 0 = 6 → v1 = 1×1000×6×0.5 = 3000
    expect(auctionAiLimit({ ...base, total: 10, unowned: 0 }, fixed(0))).toBe(3000);
  });

  it('★ 空地那一支照抄原版「乘两次物价指数」', () => {
    // 底价 3000 已经是 auctionBasePrice(地价 1000, 等级 0) × 物价 3；
    // v1 = 1×3000×6×0.5 = 9000，再 ×3 = 27000（第二次物价）
    // v2 = 10,000,000 × 3 × 3 = 90,000,000 → 取小 = 27000
    expect(
      auctionAiLimit(
        {
          level: 0,
          landPrice: 10_000_000,
          cash: 100_000,
          priceIndex: 3,
          basePrice: 3000,
          total: 10,
          unowned: 0,
        },
        fixed(0),
      ),
    ).toBe(27_000);
  });
});

describe('★ AI 挑档 auctionAiRaise（loc_0043b124 / loc_0043b183）', () => {
  const fixed = (v: number) => () => v;

  it('★ 五档金额照表 0x475ba2 的 1..5 项', () => {
    expect(AUCTION_RAISE_STEPS).toEqual([100, 500, 1000, 5000, 10000]);
  });

  it('★ 从上往下挑最大的一口：心理价位够 +10000 就 +10000', () => {
    expect(auctionAiRaise(20_000, 1000, 100_000)).toBe(10_000);
  });

  it('★ 挑不到整档就降一档（现价 + 5000 > 心理价位 → 试 1000）', () => {
    // 1000 + 10000 = 11000 > 4500；+5000 = 6000 > 4500；+1000 = 2000 ≤ 4500
    expect(auctionAiRaise(4500, 1000, 100_000)).toBe(1000);
  });

  it('★ 连最小一档都超过心理价位 → PASS（返回 0）', () => {
    // 1000 + 100 = 1100 > 1050
    expect(auctionAiRaise(1050, 1000, 100_000)).toBe(0);
  });

  it('★ 现金 < 现价 → PASS（0x43b10c 的 `jle`，早于挑档）', () => {
    expect(auctionAiRaise(1_000_000, 1000, 999)).toBe(0);
    // 现金恰好等于现价不算出不起，照挑档
    expect(auctionAiRaise(1_000_000, 1000, 1000)).toBe(10_000);
  });

  it('★ 档位金额是「不超过心理价位」的意思：超不过 100 就不加价', () => {
    // 心理价位 1050：现价 1000 已经贴着它，任何一档都超 → PASS
    expect(auctionAiRaise(1050, 1000, 1_000_000)).toBe(0);
    // 其余情况加的**档位金额**不超过心理价位与现价之差
    for (const limit of [1200, 5200, 12_000]) {
      const step = auctionAiRaise(limit, 1000, 1_000_000);
      expect(step).toBeLessThanOrEqual(limit - 1000);
    }
  });

  it('★ 出价**不超过现金**：心理价位被夹到现金后，挑档自然守住', () => {
    const cash = 3300;
    const limit = auctionAiLimit(
      { level: 0, landPrice: 100_000, cash, priceIndex: 1, basePrice: 3000, total: 10, unowned: 0 },
      fixed(0),
    ); // min(3000×6×0.5 = 9000, 100000×3, cash 3300) = 3300
    expect(limit).toBe(3300);
    const step = auctionAiRaise(limit, 3000, cash);
    expect(step).toBe(100); // 3000 + 500 > 3300 → 落到最小一档
    expect(3000 + step).toBeLessThanOrEqual(cash);
  });

  it('★ 超出最高出价者「现金 + 500」时把档位压回去（loc_0043b183）', () => {
    // 心理这一口 1000+10000；最高者现金 2000 → 线 2500 < 11000 → 压档
    // room = 线 − 现价 = 1500 ∈ (1000,5000] → 改成 5000
    // （原版只改档、不保证这一口 ≤ 2500）
    expect(auctionAiRaise(20_000, 1000, 100_000, 2000)).toBe(5000);
    // room = 1900 − 1000 = 900 ∈ (500,1000] → 1000
    expect(auctionAiRaise(20_000, 1000, 100_000, 1400)).toBe(1000);
    // ★★ A3 订正（旧断言写 5000，见本文件原 328-329 行）：room 恰好 1000
    //    走的是 `cmp 0x3e8 / jle` 那一对 ⇒ **+1000**
    expect(auctionAiRaise(20_000, 1000, 100_000, 1500)).toBe(1000);
    // room = 1600 − 1000 = 600 ∈ (500,1000] → 1000（比原档小，才换）
    expect(auctionAiRaise(20_000, 1000, 100_000, 1100)).toBe(1000);
    // room = 850 − 1000 < 100 → 给 100
    expect(auctionAiRaise(20_000, 1000, 100_000, 500)).toBe(100);
    // 不超线就原样保留
    expect(auctionAiRaise(20_000, 1000, 100_000, 50_000)).toBe(10_000);
    // 还没有最高出价者（top == -1）→ 不压
    expect(auctionAiRaise(20_000, 1000, 100_000, null)).toBe(10_000);
  });

  it('★★ A3 压价档三处边界：下界严格 `>`（room 100/500/1000 落**低**一档）', () => {
    // @source 0x43b1cd..0x43b217：四对 `cmp/jle` + `cmp/jg`
    //   room <= 100 → +100 ; <= 500 → +500 ; <= 1000 → +1000 ; <= 5000 → +5000
    //   room > 5000 → 档位原样保留
    // 旧实现写成 `>= 1000 → 5000 / >= 500 → 1000 / >= 100 → 500`，
    // 三个边界各多出一档（room = 1000 给 5000、500 给 1000、100 给 500）。
    expect(auctionAiRaise(20_000, 1000, 100_000, 1000)).toBe(500); // room = 500
    expect(auctionAiRaise(20_000, 1000, 100_000, 1001)).toBe(1000); // room = 501
    expect(auctionAiRaise(20_000, 1000, 100_000, 600)).toBe(100); // room = 100
    expect(auctionAiRaise(20_000, 1000, 100_000, 601)).toBe(500); // room = 101
    expect(auctionAiRaise(20_000, 1000, 100_000, 1500)).toBe(1000); // room = 1000
    expect(auctionAiRaise(20_000, 1000, 100_000, 1501)).toBe(5000); // room = 1001
    expect(auctionAiRaise(20_000, 1000, 100_000, 5500)).toBe(5000); // room = 5000
    expect(auctionAiRaise(20_000, 1000, 100_000, 5501)).toBe(10_000); // room = 5001 ⇒ 保原档
    expect(auctionAiRaise(20_000, 1000, 100_000, 499)).toBe(100); // room < 100（负数也一样）
  });

  it('PASS 时不会因为压价那一段又冒出一口价', () => {
    expect(auctionAiRaise(1050, 1000, 100_000, 2000)).toBe(0);
  });
});

/**
 * ★★ A4 —— 只剩一个可出价座位时的**强制最小加价**。
 *
 * @source 0x43b219（在压价段 0x43b183 之后）：
 * ```asm
 * 0043b219  cmp  byte [0x48c4b1], 1 / jne 0x43b22b   ; 开场可出价座位数 != 1 ⇒ 不压
 * 0043b222  test ebx, ebx           / je  0x43b22b   ; PASS（0）不压
 * 0043b226  mov  ebx, 1                              ; 其余压成最小档（+100）
 * ```
 * `[0x48c4b1]` 由窗口初始化时写一次（`0x43a36c` 抄 `0x113` 的实参
 * = `0x43c5d0` 显示循环数出的「状态 0 的座位数」），全场不再变。
 */
describe('★★ A4 只剩一个可出价座位时强制最小加价（0x43b219）', () => {
  it('★ 座位数 == 1 ⇒ 无论挑到哪一档都压成 +100', () => {
    expect(auctionAiRaise(20_000, 1000, 100_000, null, 2)).toBe(10_000);
    expect(auctionAiRaise(20_000, 1000, 100_000, null, 1)).toBe(100);
    expect(auctionAiRaise(20_000, 1000, 100_000, null, 0)).toBe(10_000); // 0 = 不知道 ⇒ 不压
  });

  it('★ 压在**压价段之后**（0x43b219 紧跟 0x43b183）', () => {
    // room = 1500 → 压价段先给 5000；再被 0x43b219 压成 100
    expect(auctionAiRaise(20_000, 1000, 100_000, 2000, 1)).toBe(100);
    expect(auctionAiRaise(20_000, 1000, 100_000, 2000, 2)).toBe(5000);
  });

  it('★ PASS（0）不被压；出不起（cash < price）也仍是 0', () => {
    expect(auctionAiRaise(1050, 1000, 100_000, null, 1)).toBe(0);
    expect(auctionAiRaise(20_000, 1000, 999, null, 1)).toBe(0);
  });

  it('★ auctionAiChoice 透传 activeSeats', () => {
    expect(
      auctionAiChoice({ limit: 20_000, price: 1000, cash: 100_000, topCash: null, activeSeats: 1 }),
    ).toEqual({ step: 100, kind: 'raise' });
    expect(
      auctionAiChoice({ limit: 20_000, price: 1000, cash: 100_000, topCash: null, activeSeats: 2 }),
    ).toEqual({ step: 10_000, kind: 'raise' });
  });

  it('★ auctionActiveSeatCount = 开场的「状态 0 座位数」（含卖家与出不起的排除）', () => {
    const ps = four();
    ps[3] = { ...ps[3]!, whoPlays: 0 }; // 出局
    ps[1] = { ...ps[1]!, cash: 1000 }; // 现金 == 底价 ⇒ 出不起（严格 `>`）
    const bidders = [0, 1, 2]; // 3 号已被 eligibleBidders 排除
    expect(auctionActiveSeatCount(ps, bidders, 1000)).toBe(2); // 0、2 可出价
    // 卖家（arg0 = 0）那一格在显示循环里被删 ⇒ 不算
    expect(auctionActiveSeatCount(ps, [0, 1, 2, 3], 1000, 0)).toBe(1);
    // 底价降到 999 ⇒ 现金 1000 > 999 ⇒ 玩家 1 也能出价
    expect(auctionActiveSeatCount(ps, bidders, 999)).toBe(3);
  });
});

describe('★ 真人那一手「出不起就不响应」（loc_0043a478）', () => {
  it('现价 + 档位 > 现金 才拒收，恰好等于可以', () => {
    expect(auctionCanAfford(1000, 100, 1100)).toBe(true);
    expect(auctionCanAfford(1000, 100, 1099)).toBe(false);
  });
});

// ============================================================
//  ★ Q-AUC-1：竞价循环归 core —— 座位表、终局判据、与 reduce/policy 合起来跑
// ============================================================

const LAND = 1;
const topo: MapTopology = {
  nodes: [
    makeNode({
      id: 1,
      adjacent: [1],
      type: 0x7d0 + LAND,
      ref: { kind: 'land', index: LAND },
    }),
  ],
  lands: [makeLand({ id: LAND, name: '測試地', landPrice: 3000, housePrice: 500, owner: 1 })],
};
const asMap = { ...topo, facilities: [], commercials: [], landscapes: [], dataSize: 0 } as unknown as Rich4Map;

/** 四个电脑玩家，0 号手上有一张拍賣卡（8）、站在 1 号的地上 */
function auctionGame(cash: number | ((i: number) => number) = 60_000): GameState {
  const players = [0, 1, 2, 3].map((i) =>
    makePlayer({
      index: i,
      character: i,
      nodeId: 1,
      cash: typeof cash === 'function' ? cash(i) : cash,
      moneyInBank: 0,
      whoPlays: WHO_PLAYS_COMPUTER,
      cards: i === 0 ? [8] : [],
    }),
  );
  return makeGameState({
    players,
    currentPlayer: 0,
    phase: 'turnStart',
    landOwner: [0, 2],
    landLevel: [0, 0],
  });
}

/** 跑到 pending 不再是 auction 为止；返回 { state, actions } */
function runAuction(s: GameState): { state: GameState; actions: string[] } {
  const actions: string[] = [];
  for (let i = 0; i < 40 && s.pending?.kind === 'auction'; i++) {
    const a = decideAction({ state: s, map: asMap });
    if (a === null) break;
    actions.push(`${a.type}:${JSON.stringify(a)}`);
    const next = reduce(s, a, topo);
    expect(next, `第 ${i} 口没有推进状态`).not.toBe(s);
    s = next;
  }
  return { state: s, actions };
}

describe('★ 座位表（loc_0043c110 / loc_00439f72 的建表段）', () => {
  it('出局者与出不起底价者都不是 active', () => {
    const ps = four();
    ps[3] = { ...ps[3]!, whoPlays: 0 };
    ps[1] = { ...ps[1]!, cash: 999 }; // 底价 1000
    expect(auctionSeatStatus(ps, [0, 1, 2, 3], 1000)).toEqual([
      'active',
      'givenUp', // 出不起（现金 < 底价）
      'active',
      'givenUp', // 已出局
    ]);
  });

  it('★ 恰好等于底价也出不起（原版 `cmp / jg`）', () => {
    const ps = four();
    ps[1] = { ...ps[1]!, cash: 1000 };
    expect(auctionSeatStatus(ps, [0, 1], 1000)[1]).toBe('givenUp');
    // 少一块钱的底价 → 现金 1000 > 999，可出价
    expect(auctionSeatStatus(ps, [0, 1], 999)[1]).toBe('active');
  });

  it('排座位时跳过非 active 的（loc_0043b3c2 的取模绕圈）', () => {
    const status: AuctionSeatStatus[] = ['passed', 'active', 'givenUp', 'active'];
    expect(auctionAdvanceSeat([0, 1, 2, 3], status, 1)).toBe(3);
    expect(auctionAdvanceSeat([0, 1, 2, 3], status, 3)).toBe(1);
    // 一个可出价的都没有 → 原样返回（此时已判流标）
    expect(auctionAdvanceSeat([0, 1], ['passed', 'passed'], 0)).toBe(0);
  });

  it('★★ 开场席位从 slot 0 起找第一个 active 的（loc_0043a365 的清零 + 绕圈）', () => {
    const status: AuctionSeatStatus[] = ['passed', 'active', 'active', 'active'];
    expect(auctionFirstSeat([0, 1, 2, 3], status)).toBe(1);
    // 从 slot 0 起 —— 不是「从 currentPlayer 起」（旧行为，见 A-3 订正）
    expect(auctionFirstSeat([0, 1, 2, 3], ['active', 'active', 'active', 'active'])).toBe(0);
  });

  it('★★ 一个可出价的都没有时返回 -1，**绝不能返回 0**（A-3 的卡死根因）', () => {
    // 病根：卖家在座位编码里是「非 0 状态」，一个 active 都没有时旧实现返回 0,
    //   那正好可能是卖家那一格 ⇒ 客户端把出价权交给卖家、屏上等真人点，整局卡死。
    expect(auctionFirstSeat([0, 1, 2, 3], ['givenUp', 'givenUp', 'givenUp', 'givenUp'])).toBe(-1);
    expect(auctionFirstSeat([], [])).toBe(-1);
    // 卖家被跳过：slot 0 是卖家（givenUp），第一个可出价的是 slot 1
    const sellerFirst: AuctionSeatStatus[] = ['givenUp', 'active', 'active', 'active'];
    expect(auctionFirstSeat([0, 1, 2, 3], sellerFirst)).toBe(1);
  });

  it('★ 无主地自拍（bidders 含卖家自己）时，出价权必须给**别人**', () => {
    // 审查 A-3 场景⑤：真人站在无主地上打拍賣卡 ⇒ bidders=[0,1,2,3]（无主地不排除任何人），
    //   status[0] = 'active'（卖家手里确实有钱、也不是「出不起底价」）。
    //   原版此时 slot 0 就是出卡人自己（原版建表不看「谁是卖家」以外的资格）。
    //   ★ 这里钉住的是**引擎不再把出价权丢给卖家**这条不变量：
    //     一旦卖家被标成非 active（自己的地 / 出不起），首个席位必须跳过它。
    expect(auctionFirstSeat([0, 1, 2, 3], ['givenUp', 'active', 'active', 'active'])).toBe(1);
    // 卖家在中间（bidders 不含它时下标会错位）—— 用 bidders 与玩家号**不同**的数组钉住
    //   「用 bidders[i] 取 status，而不是用 i 取 status」：
    //   bidders=[2,0,3]，status 按**玩家下标**索引 ⇒ slot0=玩家2(active) → 返回 0
    expect(auctionFirstSeat([2, 0, 3], ['givenUp', 'active', 'active', 'active'])).toBe(0);
    // 玩家2 出不起、玩家0 与玩家3 可出价 ⇒ slot0 被跳过，返回 slot1
    expect(auctionFirstSeat([2, 0, 3], ['active', 'active', 'givenUp', 'active'])).toBe(1);
  });
});

describe('★ 终局判据（loc_0043b295）', () => {
  const base = { bidders: [0, 1, 2], top: -1 };

  it('全都还能出价 → 没完', () => {
    expect(auctionFinished({ ...base, status: ['active', 'active', 'active'] })).toBe(false);
  });

  it('一个能出价的都没有 → 完（流标）', () => {
    expect(auctionFinished({ ...base, status: ['passed', 'passed', 'givenUp'] })).toBe(true);
  });

  it('★ 只剩最高出价者一个人能出价 → 完（成交）', () => {
    expect(auctionFinished({ bidders: [0, 1, 2], top: 0, status: ['active', 'passed', 'passed'] })).toBe(true);
  });

  it('★ 只剩一个能出价、但还没人出过价 → 没完（那一位还要先举一次牌）', () => {
    expect(auctionFinished({ bidders: [0, 1], top: -1, status: ['active', 'passed'] })).toBe(false);
  });

  it('流拍时 outcome 是 winner = -1', () => {
    expect(auctionOutcome({ bidders: [0], status: ['passed'], top: -1, price: 0, basePrice: 100 })).toEqual({
      winner: -1,
      price: 0,
    });
  });

  it('成交时 outcome 是最高出价者与现价', () => {
    expect(
      auctionOutcome({ bidders: [0, 1], status: ['passed', 'active'], top: 1, price: 8000, basePrice: 1000 }),
    ).toEqual({ winner: 1, price: 8000 });
  });

  // ══════════════════════════════════════════════════════════════════
  //  ★★ N3：原版 `0x43b2c9 cmp esi,edi / jne 0x43b2e6` **先于**成交判据
  //  ⇒「全场座位都被挡住」时走 `0x43b2cd` 的「無人出價，宣佈流標」，
  //    **哪怕 top 已经有值**（有人出过价）也照样流拍、地主被清 0。
  //  ★ 可达性：引擎自己的竞价循环走不到（`active === 1 && top >= 0` 时当场成交，
  //    复查在每一次出价后都跑）⇒ 这组用例是**契约钉子**，防的是「外部塞进来的
  //    pending（读档还原的中途状态）」以及日后有人把这条判据删掉。
  // ══════════════════════════════════════════════════════════════════
  it('★★ 全场座位都被挡住 + 有人出过价 ⇒ **流拍**（不是判给最后出价的人）', () => {
    const status = ['active', 'passed', 'passed', 'passed'] as const;
    expect(auctionAllBlocked({ bidders: [1, 2, 3], status: [...status] })).toBe(true);
    expect(
      auctionOutcome({
        bidders: [1, 2, 3],
        status: [...status],
        top: 2,
        price: 4000,
        basePrice: 3000,
      }),
    ).toEqual({ winner: -1, price: 0 });
  });

  it('★ 只要还有一个 active 就不算「全被挡住」', () => {
    expect(
      auctionAllBlocked({ bidders: [1, 2, 3], status: ['active', 'passed', 'active', 'passed'] }),
    ).toBe(false);
    expect(
      auctionOutcome({
        bidders: [1, 2, 3],
        status: ['active', 'passed', 'active', 'passed'],
        top: 1,
        price: 4000,
        basePrice: 3000,
      }),
    ).toEqual({ winner: 1, price: 4000 });
  });

  it('★ 一个座位都没有 ⇒ 也算「全被挡住」（流拍）', () => {
    expect(auctionAllBlocked({ bidders: [], status: [] })).toBe(true);
  });
});

describe('★ AI 一口：心理价位 / 现金 / 压价三条一起看（auctionAiChoice）', () => {
  it('心理价位够 → 加价', () => {
    expect(auctionAiChoice({ limit: 20_000, price: 1000, cash: 100_000, topCash: null })).toEqual({
      step: 10_000,
      kind: 'raise',
    });
  });

  it('★★ A5 出不起现价 → **放棄**（按钮 6），不是 PASS', () => {
    // @source 0x43b112 `cmp ecx, [edx+0x496b84] / jle 0x43b124` + 0x43b11a `mov ebx, 6`
    // 旧断言（本文件原 509-514 行）写 kind: 'pass'，与字节相反。
    expect(auctionAiChoice({ limit: 20_000, price: 5000, cash: 1000, topCash: null })).toEqual({
      step: 0,
      kind: 'giveUp',
    });
  });

  it('★ A5 现金恰好等于现价 ⇒ 不出不起，照挑档', () => {
    // 判据是 `现价 > 现金`（jg 那一支），等于不算
    expect(auctionAiChoice({ limit: 1000, price: 1000, cash: 1000, topCash: null })).toEqual({
      step: 0,
      kind: 'pass', // 出得起、但任何一档都超过心理价位 ⇒ 按钮 0
    });
  });

  it('★ A5 出得起却不想加 → 仍是 PASS（按钮 0），与「放棄」两条出口分开', () => {
    expect(auctionAiChoice({ limit: 1050, price: 1000, cash: 100_000, topCash: null })).toEqual({
      step: 0,
      kind: 'pass',
    });
  });

  it('★ 心理价位为 0（真人的座位 / 没算过）→ PASS', () => {
    expect(auctionAiChoice({ limit: 0, price: 1000, cash: 100_000, topCash: null })).toEqual({
      step: 0,
      kind: 'pass',
    });
  });

  it('★ 压在穷对手现金 + 500 之下（loc_0043b183）', () => {
    // 最高者现金 2000 → 线 2500；room = 1500 → 5000 档
    expect(auctionAiChoice({ limit: 20_000, price: 1000, cash: 100_000, topCash: 2000 })).toEqual({
      step: 5000,
      kind: 'raise',
    });
  });
});

describe('★ 心理价位表（建表循环 0x43c5d0 只在开拍时算一次）', () => {
  const ENTITY = {
    basePrice: 3000,
    priceIndex: 1,
    landPrice: 3000,
    level: 0,
    total: 10,
    unowned: 4,
    sameNameOwned: () => 0,
  };
  /** 按开拍时的口径造状态：出得起底价且在名单里才 'active' */
  const st = (...ps: ReturnType<typeof makePlayer>[]): AuctionSeatStatus[] =>
    ps.map((p) => (p.whoPlays === 0 || p.cash <= ENTITY.basePrice ? 'givenUp' : 'active'));
  /** 计数的随机源：返回固定序列并记录消费次数 */
  const counter = (vals: number[] = [0.5]) => {
    let n = 0;
    const f = (): number => {
      const v = vals[n % vals.length] ?? 0;
      n += 1;
      return v;
    };
    return { f, count: () => n };
  };

  it('★ 只给「电脑」算：真人/出局那两格留 0，且**一次随机数都不掷**', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: 0 }), // 出局
      makePlayer({ index: 1, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
      makePlayer({ index: 2, cash: 100_000 }), // 真人（makePlayer 默认）
      makePlayer({ index: 3, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
    ];
    const r = counter();
    const limits = auctionAiLimits(ENTITY, players, [0, 1, 2, 3], st(...players), -1, r.f);
    expect(limits[0]).toBe(0); // 出局（原版连座位都没有）
    expect(limits[1]).toBeGreaterThan(0);
    // ★★ 订正：原版 `test byte [player+0x15], 6 / je 跳过` —— 真人**不算也不掷**。
    //    先前这里断言「真人那一格也算了值」，那是把实现当成了真值。
    expect(limits[2], '真人座位留 0').toBe(0);
    expect(limits[3]).toBeGreaterThan(0);
    // @source 0x439f0d 内部 `call rand` **两次**（入口 0x439f1c + 地块支
    //   0x43a015 / 設施支 0x43a0fb 二选一）⇒ 两个电脑座位 = 4 次
    expect(r.count(), '★ 两个电脑座位 × 每家 2 次 = 4 次').toBe(4);
  });

  it('★ 托管的人类座位（whoPlays bit2）照样算 —— `test ...,6` 的 bit2', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }),
      makePlayer({ index: 1, cash: 100_000, whoPlays: WHO_PLAYS_HUMAN }),
    ];
    const r = counter();
    const limits = auctionAiLimits(ENTITY, players, [0, 1], st(...players), -1, r.f);
    expect(limits[0]).toBeGreaterThan(0);
    expect(limits[1]).toBe(0);
    expect(r.count(), '一个电脑座位 × 2 次').toBe(2);
  });

  it('★ 出不起底价（状态 8）/ 卖家（状态 7）都不掷', () => {
    const players = [
      makePlayer({ index: 0, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
      makePlayer({ index: 1, cash: 100, whoPlays: WHO_PLAYS_COMPUTER }), // 出不起
      makePlayer({ index: 2, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }), // 卖家
    ];
    const r = counter();
    const limits = auctionAiLimits(ENTITY, players, [0, 1, 2], st(...players), 2, r.f);
    expect(limits[0]).toBeGreaterThan(0);
    expect(limits[1], '出不起底价 → 价位停在 0').toBe(0);
    expect(limits[2], '卖家状态 7 → 不算').toBe(0);
    expect(r.count(), '★ 只有 1 家可出价 ⇒ 掷 2 次').toBe(2);
  });

  it('★ 消费次数与座位顺序无关地确定：两家电脑 → 恰好 2 次', () => {
    const players = [0, 1].map((i) =>
      makePlayer({ index: i, cash: 100_000, whoPlays: WHO_PLAYS_COMPUTER }),
    );
    const r = counter([0.25, 0.75]);
    const limits = auctionAiLimits(ENTITY, players, [0, 1], st(...players), -1, r.f);
    expect(r.count(), '两家 × 2 次').toBe(4);
    // 同一条随机流算两遍必然一致（联机两端对得上）
    const r2 = counter([0.25, 0.75]);
    expect(auctionAiLimits(ENTITY, players, [0, 1], st(...players), -1, r2.f)).toEqual(limits);
  });
});

/**
 * ★★ 开拍要**消费全局随机流**（原版 `0x439f0d` 内部 `call rand` 两次）。
 *
 * 旧实现（已撤销的 D-T034-5）用 `rngState ^ 实体号` 派生一条**独立**序列，
 * 于是 `rngState` 一动不动 —— 每开一场拍卖，之后所有随机事件就与原版错位一次。
 */
describe('★★ 开拍消费全局随机流（订正 D-T034-5）', () => {
  it('★ 3 个电脑座位 × 每家 2 次 ⇒ rngState 恰好前进 6 步', () => {
    let s = auctionGame();
    const before = s.rngState;
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    // ★★ 第 160 条（A2）：排除的是 **arg0 = 用卡者（0 号）**，不是地主（1 号）
    expect(s.pending.bidders).toEqual([1, 2, 3]);

    const expectRng = new WatcomRng();
    expectRng.setState(before);
    for (let i = 0; i < 6; i++) expectRng.next();
    expect(s.rngState, '★ 开拍必须推进全局随机流').toBe(expectRng.getState());
    expect(s.rngState).not.toBe(before);
  });

  it('★★ 心理价位与流位置都出自那条全局流（同序复算逐项相等）', () => {
    let s = auctionGame();
    const before = s.rngState;
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');

    // 独立复算：从**同一个** rngState 起，按 bidders 升序喂给同一个算法
    const rng = new WatcomRng();
    rng.setState(before);
    const rand01 = (): number => rng.next() / 32768;
    const entity = {
      basePrice: s.pending.basePrice,
      priceIndex: s.priceIndex,
      landPrice: 3000, // makeLand 的地价（见本文件 topo）
      level: 0,
      total: 1, // topo.lands 只有一块
      unowned: 0, // 那块地归卖家（玩家 1）
      sameNameOwned: () => 0,
    };
    const status = auctionSeatStatus(s.players, s.pending.bidders, s.pending.basePrice);
    const manual = auctionAiLimits(
      entity,
      s.players,
      s.pending.bidders,
      status,
      s.pending.seller ?? -1,
      rand01,
    );

    expect(s.pending.limits).toEqual(manual);
    expect(rng.getState(), '复算消耗的步数必须与引擎一致').toBe(s.rngState);
  });

  it('★ 真人座位不消费随机数：全真人时开拍不推进 rngState', () => {
    let s = auctionGame();
    // ★ 四个人全改成真人 —— 出价者是 0/2/3，**0 号（出卡人）也在名单里**，
    //   只改 1/2/3 的话还会剩一个电脑座位在掷随机数。
    const players = s.players.map((p) => ({ ...p, whoPlays: WHO_PLAYS_HUMAN }));
    s = { ...s, players };
    const before = s.rngState;
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.limits.every((v) => v === 0), '真人座位心理价位留 0').toBe(true);
    expect(s.rngState, '★ 一个电脑座位都没有 ⇒ 一次都不掷').toBe(before);
  });
});

describe('★ Q-AUC-1 端到端：电脑打出拍賣卡 → 竞价一直跑到落槌', () => {
  it('★ 不再走 declineDecision —— 竞价真的发生了', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    expect(s.pending?.kind).toBe('auction');
    // 开拍时字段齐全（现价 = 起拍价、还没人出价、轮到某一家）
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.price).toBe(3000);
    expect(s.pending.top).toBe(-1);
    // ★★ 第 160 条（A2）：排除的是 **arg0 = 用卡者（0 号）**，不是地主（1 号）
    expect(s.pending.bidders).toEqual([1, 2, 3]);
    expect(s.pending.seller).toBe(0);
    // ★★ A-3（外部审查）：开场席位必须是**第一个可出价的人**，不能是发起者。
    //   判断的敌人是「第一格不可出价却返回 0」：把 1 号（bidders 的第一格）
    //   弄成出不起底价（status[1] = 'givenUp'），开场席位必须落到别人头上。
    //   旧实现「绕一圈找不到就返回 0」在这里给出第一格 ⇒ 客户端把出价权交给一个
    //   不能出价的人、屏上等真人点，整局卡死（外部审查 A-3 的真根因）。
    {
      const poor = auctionGame((i) => (i === 1 ? 1 : 60_000));
      const after = reduce(poor, { type: 'useCard', cardId: 8 }, topo);
      if (after.pending?.kind !== 'auction' || !('seat' in after.pending)) {
        throw new Error('no auction');
      }
      expect(after.pending.status[1]).toBe('givenUp'); // 1 号出不起底价
      const first = after.pending.bidders[after.pending.seat];
      expect(first, '第一格出不起底价时开场席位不能是他').not.toBe(1);
      expect(after.pending.status[first!]).toBe('active');
    }
    expect(s.pending.bidders[s.pending.seat]).toBe(1); // 正常局面下 1 号可出价
    expect(s.pending.status[s.pending.bidders[s.pending.seat]!]).toBe('active');

    const { state, actions } = runAuction(s);
    expect(state.pending).toBeNull();
    expect(state.phase).toBe('turnEnd');
    // 至少有人举过牌（原缺口下这里一口都没有）
    expect(actions.some((a) => a.includes('"status":"raise"'))).toBe(true);
  });

  it('★★ A-3 回归：地主自己打出拍賣卡时，开场席位必须跳过地主', () => {
    // 场景：0 号**是地主**（landOwner 指向自己），手上还有拍賣卡 —— 他卖自己的地。
    //   `eligibleBidders` 会排除地主 ⇒ bidders 里没有 0；此时开场席位必须落在
    //   某个**别人**头上。先前的实现会返回 0（= bidders 的第一格），而那一格
    //   可能是被标成非 active 的座位 ⇒ 客户端把出价权交给一个不能出价的人、
    //   屏上摆着「請意者出價」等真人点，整局卡死（外部审查 A-3）。
    const players = [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        character: i,
        nodeId: 1,
        cash: 60_000,
        moneyInBank: 0,
        whoPlays: WHO_PLAYS_COMPUTER,
        cards: i === 0 ? [8] : [],
      }),
    );
    const owned: MapTopology = {
      ...topo,
      lands: [makeLand({ id: LAND, name: '測試地', landPrice: 3000, housePrice: 500, owner: 1 })],
    };
    const s0 = makeGameState({
      players,
      currentPlayer: 0,
      phase: 'turnStart',
      landOwner: [0, 1], // ★ 1 号编码 = 0 号玩家 ⇒ 0 号卖自己的地
      landLevel: [0, 0],
    });
    const s = reduce(s0, { type: 'useCard', cardId: 8 }, owned);
    expect(s.pending?.kind).toBe('auction');
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('no auction');
    expect(s.pending.bidders).toEqual([1, 2, 3]); // 地主 0 号被排除
    const seatPlayer = s.pending.bidders[s.pending.seat];
    expect(seatPlayer, '开场席位不能落空').toBeDefined();
    expect(seatPlayer, '开场席位必须是可出价的人').not.toBe(0);
    expect(s.pending.status[seatPlayer!]).toBe('active');
    // 竞价能自己跑完，不需要「卖家先点一次 PASS」
    const { state } = runAuction(s);
    expect(state.pending).toBeNull();
  });

  it('★★ A-3 回归：**无主地**自拍时出价权不能落回卖家（原版卖家状态 7 会被绕开）', () => {
    // 外部审查实测的那一幕：真人站在**无主地**上打拍賣卡。
    //   `eligibleBidders` 排除 **arg0 = 出卡人**（原版 `0x43c22a cmp ebx,ebp`），
    //   与「谁是现主」无关 —— 无主地时也一样排除他。
    //   旧实现按「现任地主」排除 ⇒ 无主地谁都匹配不上 ⇒ bidders = [0,1,2,3]，
    //   发起者 0 号自己也在名单里且状态是 'active'，开场席位落回他 ⇒
    //   屏上等真人自己点、三台电脑一口不出。原版给那一格写状态 7，绕圈永远跳过他。
    const players = [0, 1, 2, 3].map((i) =>
      makePlayer({
        index: i,
        character: i,
        nodeId: 1,
        cash: 60_000,
        moneyInBank: 0,
        whoPlays: WHO_PLAYS_COMPUTER,
        cards: i === 0 ? [8] : [],
      }),
    );
    const unowned: MapTopology = {
      ...topo,
      lands: [makeLand({ id: LAND, name: '無主地', landPrice: 3000, housePrice: 500, owner: 0 })],
    };
    const s = reduce(
      makeGameState({
        players,
        currentPlayer: 0,
        phase: 'turnStart',
        landOwner: [0, 0],
        landLevel: [0, 0],
      }),
      { type: 'useCard', cardId: 8 },
      unowned,
    );
    expect(s.pending?.kind).toBe('auction');
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('no auction');
    expect(s.pending.bidders).toEqual([1, 2, 3]); // ★ 只排除出卡人（0 号）
    expect(s.pending.seller).toBe(0); // 发起者 = 出卡人（arg0）
    const first = s.pending.bidders[s.pending.seat];
    expect(first, '无主地自拍时开场席位不能是卖家自己').not.toBe(0);
    expect(s.pending.status[first!]).toBe('active');
    // 而且整条竞价能自己跑完（没有「卖家先点一次 PASS」这一步）
    const { state, actions } = runAuction(s);
    expect(state.pending).toBeNull();
    expect(actions.length).toBeGreaterThan(0);
  });

  it('★ 成交：得标者付款、地块易主、★ 款项归**发起拍卖者**（A1）', () => {
    // ★★ 第 160 条（A1）：原版 `0x43c855 pay_money(得标者, arg0, 现价, 0)`
    //   ⇒ 拍賣卡的落槌款进**用卡者**（arg0 = 0 号）的**存款**，**不进公库**。
    //   场景：2 号（bidders 里唯一出得起的）举一次牌 → 成交、地归他、
    //   原主 1 号一分未得、0 号（用卡者）收到全款。
    let s = auctionGame((i) => (i === 2 ? 60_000 : 2999));
    const before = s.players.map((p) => ({ cash: p.cash, bank: p.moneyInBank }));
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const pool0 = s.pool;
    const { state, actions } = runAuction(s);
    expect(actions).toHaveLength(1);
    const bid = JSON.parse(actions[0]!.slice(actions[0]!.indexOf('{'))) as { step: number };
    const price = 3000 + bid.step; // 起拍价 3000 + 唯一那一口
    expect(state.landOwner[LAND]).toBe(3); // 2 号得标（owner 编码 = 下标 + 1）
    expect(state.players[2]!.cash).toBe(before[2]!.cash - price);
    // ★ 收款方是发起者 0 号，而且进的是**存款**（原版 `push 0` = flags 0）
    expect(state.players[0]!.moneyInBank).toBe(before[0]!.bank + price);
    expect(state.players[0]!.cash).toBe(before[0]!.cash);
    expect(state.pool).toBe(pool0); // ★ 公库一分不进
    expect(state.players[1]!.cash).toBe(2999); // 原主分文未得
  });

  it('★ 出价永远不超过心理价位与现金', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    for (let i = 0; i < 40; i++) {
      const pending = s.pending;
      if (pending === null || pending.kind !== 'auction' || !('seat' in pending)) break;
      const bidder = pending.bidders[pending.seat]!;
      const who = s.players[bidder]!;
      const a = decideAction({ state: s, map: asMap });
      if (a === null || a.type !== 'auctionBid') break;
      if (a.status === 'raise') {
        expect(a.step).toBeGreaterThan(0);
        expect(pending.price + a.step).toBeLessThanOrEqual(pending.limits[bidder]!);
        expect(pending.price + a.step).toBeLessThanOrEqual(who.cash);
      }
      const next = reduce(s, a, topo);
      // 现价单调不减
      if (next.pending?.kind === 'auction' && 'price' in next.pending) {
        expect(next.pending.price).toBeGreaterThanOrEqual(pending.price);
      }
      s = next;
    }
    expect(s.pending).toBeNull();
  });

  it('★ 出不起的座位不会再出价；★ 地主能举牌把自己的地买回来（A2）', () => {
    // ★★ 第 160 条（A2）：排除的是 arg0 = 用卡者 0 号 ⇒ bidders = [1,2,3]，
    //   其中 1 号**正是地主**。2、3 号连底价（3000）都出不起 ⇒ 全场只有 1 号那一口，
    //   而且那一口是「买回自己的地」（原版允许，旧实现把他排除了）。
    let s = auctionGame((i) => (i === 1 ? 60_000 : 2999));
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    expect(s.pending.bidders).toEqual([1, 2, 3]);
    expect(s.pending.status[2]).toBe('givenUp');
    expect(s.pending.status[3]).toBe('givenUp');
    const { state, actions } = runAuction(s);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('"status":"raise"');
    expect(actions[0]).toContain('"bidder":1');
    // 得标者 == 原地主 ⇒ 归属照旧（`0x43c77b` 那一闸）
    expect(state.landOwner[LAND]).toBe(2);
    // 2、3 号从头到尾没出过价 —— 只有 1 号那一口
    expect(actions.filter((a) => a.includes('"bidder":2'))).toHaveLength(0);
    expect(actions.filter((a) => a.includes('"bidder":3'))).toHaveLength(0);
  });

  it('★★ 加价会把「已 PASS」的座位重新激活（N2，@source 0x43a6b0..0x43a6c7）', () => {
    // 原版每成功加价一口就把**四个座位的状态全写 0**（`0x43a6ae` 的循环 4 次），
    // 于是刚 PASS 过的人下一口又能举牌；「出不起（按钮 6 = 放棄）」那种座位是
    // 把座位玩家号 +0 清掉（`0x43a462`）⇒ 摘掉、不复活。
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('no auction');
    const seatA = s.pending.bidders[s.pending.seat]!;
    s = reduce(s, { type: 'auctionBid', bidder: seatA, status: 'pass', step: 0 }, topo);
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('ended early');
    expect(s.pending.status[seatA]).toBe('passed');
    const seatB = s.pending.bidders[s.pending.seat]!;
    s = reduce(s, { type: 'auctionBid', bidder: seatB, status: 'raise', step: 100 }, topo);
    if (s.pending?.kind !== 'auction' || !('seat' in s.pending)) throw new Error('ended early');
    expect(s.pending.status[seatA], '★ 加价后 PASS 的那位又活了').toBe('active');
  });

  it('★★ 拍「原为无主」的地成交时要写到期日（A6，@source 0x43c799/0x43c7a8）', () => {
    // 原版 `0x43c799 cmp dword [0x499110],0`（土地權限）→ `0x43c7a8 cmp byte [edx+0x19],0`
    // （**原为有主就不写**）→ `0x43c7bb call 0x4521cb`（date_add）→ `0x43c7c9 mov [edx+0x30],eax`。
    const unowned: MapTopology = {
      ...topo,
      lands: [makeLand({ id: LAND, name: '無主地', landPrice: 3000, housePrice: 500, owner: 0 })],
    };
    let s = auctionGame((i) => (i === 2 ? 60_000 : 2999));
    // `landTenureIndex` = 土地權限 `[0x499110]`：0 = 無限期 ⇒ 原版**不写**到期日
    //   （`0x43c799 cmp dword [0x499110],0 / je`），故这里给一档有时限的（2 = 0x10000）。
    s = { ...s, landOwner: [0, 0], landTenureIndex: 2 };
    s = reduce(s, { type: 'useCard', cardId: 8 }, unowned);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const { state } = runAuction(s);
    expect(state.landOwner[LAND]).toBe(3); // 2 号得标
    expect(state.landTenure[LAND] ?? 0, '★ 成交必须写过期日').toBeGreaterThan(0);
  });

  it('★ 拍「原为有主」的地成交时**不**写到期日（A6 的第二道闸）', () => {
    // 上面那条的重拍：地已归 1 号 ⇒ `0x43c7a8 cmp byte [edx+0x19],0 / jne` 跳过写入
    //   （★ 权限档必须同样给非 0，否则只验到第一道闸）
    let s = auctionGame((i) => (i === 2 ? 60_000 : 2999));
    s = { ...s, landTenureIndex: 2 };
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const { state } = runAuction(s);
    expect(state.landOwner[LAND]).toBe(3);
    expect(state.landTenure[LAND] ?? 0).toBe(0);
  });

  it('★ 加价的那一口出不起 → reducer 拒收（状态原样）', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const seat = s.pending.seat;
    const bidder = s.pending.bidders[seat]!;
    // 现金压到刚好等于现价：加 100 都超（原版 `cmp / jg`），但 PASS 仍允许
    s = { ...s, players: s.players.map((p, i) => (i === bidder ? { ...p, cash: 3000 } : p)) };
    expect(reduce(s, { type: 'auctionBid', bidder, status: 'raise', step: 5000 }, topo)).toBe(s);
    expect(reduce(s, { type: 'auctionBid', bidder, status: 'raise', step: 100 }, topo)).toBe(s);
    // PASS 仍然可以（出不起也允许退出竞价）
    expect(reduce(s, { type: 'auctionBid', bidder, status: 'pass', step: 0 }, topo)).not.toBe(s);
  });

  it('★ 不是轮到你 → reducer 拒收', () => {
    let s = auctionGame();
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    if (s.pending?.kind !== 'auction') throw new Error('no auction');
    const seat = s.pending.seat;
    const notMyTurn = s.pending.bidders.find((b, i) => i !== seat)!;
    expect(reduce(s, { type: 'auctionBid', bidder: notMyTurn, status: 'pass', step: 0 }, topo)).toBe(s);
  });

  it('★ 流拍：全场都出不起底价 → 原主照样失去地产（拍賣卡的要害）', () => {
    // 底价 = 地价 3000 × 物价 1 = 3000；现金 2999 → `cmp / jg` 判出不起
    let s = auctionGame(2999);
    s = reduce(s, { type: 'useCard', cardId: 8 }, topo);
    // 所有座位一开拍就 givenUp → **当场**流标（pending 都不挂）
    expect(s.pending).toBeNull();
    expect(s.phase).toBe('turnEnd');
    expect(s.landOwner[LAND]).toBe(0); // 变无主
    expect(s.players.map((p) => p.cash)).toEqual([2999, 2999, 2999, 2999]); // 一分钱没动
  });
});

describe('★ Q-AUC-1 soak：4 个电脑跑满 300 回合，拍卖不得卡死', () => {
  const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
  const runSoak = existsSync(MAP) ? it : it.skip;

  runSoak('★ 300 回合不卡死', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const mapTopo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 4242,
    });
    let steps = 0;
    for (; steps < 200_000; steps++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      const next = reduce(state, a, mapTopo);
      if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
      state = next;
      if (state.turnCount >= 300) break;
    }
    expect(state.turnCount).toBeGreaterThanOrEqual(300);
    expect(state.pending?.kind).not.toBe('auction');
  });

  /**
   * ★ 真正的拍賣护栏。
   *
   * ⚠️ **自然对局里抽不到拍賣卡**：牌是随机的，AI 又只在「脚下是对手的
   *   ≥3 级地产」时才肯出（`card-policy.ts` 的 `paimai`，@source 0x0041ef26）。
   *   实测 300 回合 / 种子 4242 里 `cardId === 8` 一次都没出现 ——
   *   所以上一条 soak 其实**盖不到拍賣**。这里改成：在真对局上、走到对手地产
   *   那一步塞一张拍賣卡并强制打出，把竞价循环放进完整状态机里连续压 60 次。
   */
  runSoak('★ 连续多场拍賣：不卡死、每一口形状正确、每场都落槌', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const mapTopo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 91,
    });

    let auctions = 0;
    let bids = 0;
    let settled = 0;
    let guard = 0;
    for (let steps = 0; steps < 200_000 && auctions < 20 && guard < 300; steps++) {
      const me = state.currentPlayer;
      // 正处在「用卡」那一步、且脚下就是**对手的地产** → 塞一张拍賣卡并当场打出。
      // ⚠️ 只在真的用得上时才塞：脚下不是对手地产的话 `useCard` 失败、牌还在手上，
      //    下回合又会被塞一张（先前就是这么把牌堆塞爆、拍卖一场没开成的）。
      if (state.phase === 'awaitingRoll' && state.aiStep === 2) {
        const p = state.players[me]!;
        const node = map.nodes[p.nodeId - 1];
        const li = node === undefined ? null : housingIndexOf(node.type);
        const land = li === null ? undefined : map.lands.find((l) => l.id === li);
        const owner = land === undefined ? 0 : (state.landOwner[land.id] ?? land.owner);
        if (land !== undefined && owner !== 0 && owner !== me + 1) {
          guard++;
          state = {
            ...state,
            players: state.players.map((x, i) => (i === me ? { ...x, cards: [...x.cards, 8] } : x)),
            phase: 'turnStart',
          };
          state = reduce(state, { type: 'startTurn' }, mapTopo);
          state = reduce(state, { type: 'useCard', cardId: 8 }, mapTopo);
          if (state.pending?.kind !== 'auction') continue;
          auctions++;
          // 一场拍賣：一直答到落槌
          for (let k = 0; k < 40 && state.pending?.kind === 'auction'; k++) {
            const pending = state.pending;
            if (!('seat' in pending)) break;
            const seat = pending.seat;
            const bidder = pending.bidders[seat]!;
            const a = decideAction({ state, map });
            if (a === null) throw new Error('轮到电脑却拿不出出价');
            if (a.type !== 'auctionBid') throw new Error(`拍賣里给了 ${a.type}`);
            bids++;
            expect(a.bidder).toBe(bidder); // 只许轮到的这一家出
            if (a.status === 'raise') {
              expect(a.step).toBeGreaterThan(0);
              // 出价不超过心理价位，也不超过现金
              expect(pending.price + a.step).toBeLessThanOrEqual(pending.limits[bidder]!);
              expect(pending.price + a.step).toBeLessThanOrEqual(state.players[bidder]!.cash);
            }
            const next = reduce(state, a, mapTopo);
            if (next === state) throw new Error(`拍賣第 ${k} 口没推进`);
            state = next;
          }
          expect(state.pending?.kind).not.toBe('auction'); // 必须落槌，不许挂着
          settled++;
        }
      }
      const a = decideAction({ state, map });
      if (a === null) break;
      const next = reduce(state, a, mapTopo);
      if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
      state = next;
    }
    expect(auctions).toBeGreaterThanOrEqual(5);
    expect(settled).toBe(auctions);
    expect(bids).toBeGreaterThan(0);
  });
});
