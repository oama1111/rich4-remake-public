/*
 * 上市公司分紅屏（T-031）—— 每月 15 日的演出
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 几何照 exe：底图 `Panel.mkf` #76 贴 (0x18,0x18)、标题 (0x128,0x19)、
 * `人名` (0x68,0x52)、`公司` (0x12,0x5e)、`本月盈餘` (0x21e,0x58)、
 * ★ **一家公司一行**（行距 0x18）、**一位玩家一列**（列距 0x62）：
 * 公司名 x=0x3e、各玩家分红 x=0xc6+0x62p、盈餘合计 x=0x23c、
 * 玩家名 (0xa0+0x62p, 0x58)、玩家合计 (0xc6+0x62p, 0x194)。
 *
 * 这里把「容易写错、错了又难看出来的」几条钉住：
 * 行/列落点与步长、底图不抠黑、董事长是哪一位、
 * 分红按**在场玩家持股总和**摊、金额截断、买股上限的三道闸，
 * 以及**起播/收屏**那一条（VA 0x0041d08f 起播、VA 0x0042b3eb 的 0x202/0x205
 * 抬手退屏 + SetTimer×3 到点自动退）。
 */
import { describe, expect, it } from 'vitest';
import { DIVIDEND_DAY, makeGameState, type GameState, type MapTopology } from '@rich4/core';
import type { UiScreenEnv } from './ui-screen.ts';
import {
  SHARES_AT,
  SHARES_AUTO_CLOSE_MS,
  SHARES_COLS,
  SHARES_COMPANY_X,
  SHARES_FONT,
  SHARES_HEAD_COMPANY,
  SHARES_HEAD_PERSON,
  SHARES_HEAD_COMPANY_TEXT,
  SHARES_HEAD_PERSON_TEXT,
  SHARES_HEAD_SUM,
  SHARES_HEAD_SUM_TEXT,
  SHARES_IMAGE,
  SHARES_INK_COLOR,
  SHARES_KEYED,
  SHARES_RESOURCE,
  SHARES_ROWS,
  SHARES_SIZE,
  SHARES_SUM_X,
  SHARES_TOTAL_LABEL,
  SHARES_TOTAL_LABEL_TEXT,
  SHARES_TITLE,
  SHARES_TITLE_COLOR,
  SHARES_TITLE_TEXT,
  characterName,
  companyRowY,
  dividendDayCrossed,
  dividendText,
  drawSharesScreen,
  maxShares,
  playerNameX,
  playerValueX,
  resetSharesScreen,
  sharesScreen,
  sharesScreenState,
  sharesView,
} from './shares-screen.ts';

const TOPO = {
  nodes: [],
  commercials: [
    { id: 1, name: '某某企業' },
    { id: 2, name: '另一家企業' },
  ],
} as unknown as MapTopology;

/** 两支有企业的股票：下标 0 → 企业 1、下标 4 → 企业 2（其余一律清零） */
function marketWithTwo(): GameState {
  const s = makeGameState();
  // ⚠️ `makeGameState()` 出厂就带几家有企业的股票，所以**其余必须显式清 0**，
  //   否则行数不是 2 —— 这条一开始漏了，测试与实现差了两行。
  const stocks = s.market.stocks.map((x, i) => ({
    ...x,
    commercialIndex: i === 0 ? 1 : i === 4 ? 2 : 0,
  }));
  // ★ 不再摆 `commercialOwners`：这一屏**不画董事长标识**（原版没有，见 D-T031-8），
  //   视图也不读 `commercialOwners` / `currentPlayer`。
  return {
    ...s,
    market: { ...s.market, stocks },
  };
}

/** 给某位玩家在某支股票上记一笔持仓 */
function hold(s: GameState, player: number, stock: number, amount: number): GameState {
  const holdings = s.holdings.map((row, p) =>
    p === player ? row.map((h, i) => (i === stock ? { ...h, amount } : h)) : row,
  );
  return { ...s, holdings };
}

describe('上市公司分紅屏几何 @source VA 0x0042bab2 / 0x0042b46f / 0x0042bac8 起', () => {
  it('★ 底图是资源 76 的图 0，贴 (0x18,0x18)，尺寸 592×432', () => {
    expect(SHARES_RESOURCE).toBe(0x4c);
    expect(SHARES_RESOURCE).toBe(76);
    expect(SHARES_IMAGE).toBe(0);
    expect(SHARES_AT).toEqual({ x: 24, y: 24 });
    expect(SHARES_SIZE).toEqual({ w: 592, h: 432 });
    // 640−592 = 480−432 = 48 ⇒ 两头各留 24，正好居中
    expect(640 - SHARES_SIZE.w).toBe(48);
    expect(480 - SHARES_SIZE.h).toBe(48);
  });

  it('★ 抠黑表：这一屏只有图 0，判定是**不抠**', () => {
    expect([...SHARES_KEYED]).toEqual([]);
    expect(SHARES_KEYED.has(SHARES_IMAGE)).toBe(false);
  });

  it('★ 标题与三个表头照 `draw_text` 的 push dump（push 次序 = flag, y, x, str）', () => {
    expect(SHARES_TITLE).toEqual({ x: 0x128, y: 0x19, size: 0x1c });
    expect(SHARES_TITLE_TEXT).toBe('上市公司分紅');
    // 人名：VA 0x0042bb28 `push 6 / push 0x52 / push 0x68` → flag 6、y=0x52、x=0x68
    expect(SHARES_HEAD_PERSON).toEqual({ x: 0x68, y: 0x52 });
    // 公司：VA 0x0042bb44 `push 5 / push 0x5e / push 0x12` → flag 5、y=0x5e、x=0x12
    expect(SHARES_HEAD_COMPANY).toEqual({ x: 0x12, y: 0x5e });
    // 本月盈餘：VA 0x0042bbb3 `push 2 / push 0x58 / push 0x21e` → flag 2、y=0x58、x=0x21e
    expect(SHARES_HEAD_SUM).toEqual({ x: 0x21e, y: 0x58 });
    expect(SHARES_HEAD_PERSON_TEXT).toBe('人名');
    expect(SHARES_HEAD_COMPANY_TEXT).toBe('公司');
    expect(SHARES_HEAD_SUM_TEXT).toBe('本月盈餘');
    expect(SHARES_FONT).toEqual({ title: 0x1c, head: 0xc, body: 0x10 });
    // 标题白字；12 号与 16 号都是近黑 @source VA 0x0042baec / 0x0042bb20 / 0x0042bb6d
    expect(SHARES_TITLE_COLOR).toBe('#f0f0f0');
    expect(SHARES_INK_COLOR).toBe('#101010');
  });

  it('★ 纵向：**一家公司一行** —— y0 = 0x74、行距 0x18（不是 0x62）', () => {
    expect(SHARES_ROWS).toEqual({ count: 12, y0: 0x74, pitch: 0x18 });
    expect(companyRowY(0)).toBe(116);
    expect(companyRowY(1)).toBe(116 + 24);
    expect(companyRowY(11)).toBe(116 + 24 * 11);
    // 12 行正好落在 432 高的表里（最后一行 380 < 432）
    expect(companyRowY(SHARES_ROWS.count - 1)).toBeLessThan(SHARES_SIZE.h);
  });

  it('★ 横向：**一位玩家一列** —— 名字 0xa0、数额 0xc6、列距 0x62', () => {
    expect(SHARES_COLS).toEqual({
      nameX0: 0xa0,
      valueX0: 0xc6,
      pitch: 0x62,
      nameY: 0x58,
      totalY: 0x194,
    });
    expect(playerNameX(0)).toBe(160);
    expect(playerNameX(3)).toBe(160 + 98 * 3);
    expect(playerValueX(0)).toBe(198);
    expect(playerValueX(3)).toBe(198 + 98 * 3);
    // 名字那一列（正中）与数额那一列（右中）都落在同一栏里
    expect(playerValueX(0) - playerNameX(0)).toBe(0x26);
    expect(playerValueX(1)).toBeLessThan(playerNameX(2));
    // 玩家名那一行在第一家公司那一行**之上**；合计行在 12 行**之下**
    expect(SHARES_COLS.nameY).toBeLessThan(companyRowY(0));
    expect(SHARES_COLS.totalY).toBeGreaterThan(companyRowY(SHARES_ROWS.count - 1));
  });

  it('★ 表身最左（公司名 0x3e）与最右（盈餘合计 0x23c）两列', () => {
    expect(SHARES_COMPANY_X).toBe(0x3e);
    expect(SHARES_SUM_X).toBe(0x23c);
    // 满员四列：最后一列的数额右边缘 198 + 98×3 = 492，还在 572 左边
    expect(playerValueX(3)).toBeLessThan(SHARES_SUM_X);
    // 公司名（0x3e）与第一位玩家的数额不会重叠
    expect(SHARES_COMPANY_X).toBeLessThan(playerValueX(0));
  });
});

describe('画出来 @source VA 0x0042bac8 起那一串 draw_text', () => {
  /** 记账用的假画布：只收 `fillText` */
  function recordingStage(): { ctx: CanvasRenderingContext2D; at: { s: string; x: number; y: number }[] } {
    const at: { s: string; x: number; y: number }[] = [];
    const ctx = {
      drawImage: () => {},
      fillRect: () => {},
      fillText: (s: string, x: number, y: number) => at.push({ s, x, y }),
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillStyle: '',
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
    return { ctx, at };
  }

  it('★ 表头落在 title 那几个常量上，公司名与玩家数额各在一条竖线上', () => {
    const { ctx, at } = recordingStage();
    const view = sharesView(marketWithTwo(), TOPO, ['甲', '乙', '丙', '丁']);
    drawSharesScreen(ctx, () => null, view);

    // ★ 画字用的是**底图本地坐标 + 底图落点**（见 `SHARES_TEXT_ORIGIN`）
    const find = (s: string) => at.find((t) => t.s === s);
    const at0 = (x: number, y: number) => ({ x: SHARES_AT.x + x, y: SHARES_AT.y + y });
    expect(find(SHARES_HEAD_PERSON_TEXT)).toMatchObject(at0(SHARES_HEAD_PERSON.x, SHARES_HEAD_PERSON.y));
    expect(find(SHARES_HEAD_COMPANY_TEXT)).toMatchObject(at0(SHARES_HEAD_COMPANY.x, SHARES_HEAD_COMPANY.y));
    expect(find(SHARES_HEAD_SUM_TEXT)).toMatchObject(at0(SHARES_HEAD_SUM.x, SHARES_HEAD_SUM.y));
    expect(find(SHARES_TITLE_TEXT)).toMatchObject(at0(SHARES_TITLE.x, SHARES_TITLE.y));
    expect(find(SHARES_TOTAL_LABEL_TEXT)).toMatchObject(
      at0(SHARES_TOTAL_LABEL.x, SHARES_TOTAL_LABEL.y),
    );
    // 四位玩家名在同一行 y=0x58，x = 0xa0 + 0x62p
    for (let p = 0; p < 4; p++) {
      expect(find(['甲', '乙', '丙', '丁'][p]!)).toMatchObject(at0(playerNameX(p), SHARES_COLS.nameY));
    }
    // 一家公司一行：名字在最左、盈餘合计在最右，各玩家数额在 0xc6 + 0x62p
    expect(at.find((t) => t.s === '某某企業')).toMatchObject({
      x: SHARES_AT.x + SHARES_COMPANY_X,
      y: SHARES_AT.y + companyRowY(0),
    });
    expect(at.find((t) => t.s === '另一家企業')).toMatchObject({
      x: SHARES_AT.x + SHARES_COMPANY_X,
      y: SHARES_AT.y + companyRowY(1),
    });
    expect(at.filter((t) => t.y === SHARES_AT.y + companyRowY(0) && t.x === SHARES_AT.x + SHARES_SUM_X)).toHaveLength(1);
    for (let p = 0; p < 4; p++) {
      expect(
        at.some((t) => t.y === SHARES_AT.y + companyRowY(0) && t.x === SHARES_AT.x + playerValueX(p)),
      ).toBe(true);
    }
    // 玩家合计在最下面那一行
    expect(
      at.some((t) => t.y === SHARES_AT.y + SHARES_COLS.totalY && t.x === SHARES_AT.x + playerValueX(0)),
    ).toBe(true);
  });

  it('★ `0` 也要画出来（原版的 itoa 把 0 转成 "0"，不跳过零值）', () => {
    const { ctx, at } = recordingStage();
    const view = sharesView(marketWithTwo(), TOPO, ['甲', '乙', '丙', '丁']); // 盈餘全 0
    drawSharesScreen(ctx, () => null, view);
    // 第一家那一行：4 位玩家的数额 + 盈餘合计，5 个 "0"
    expect(at.filter((t) => t.y === SHARES_AT.y + companyRowY(0) && t.s === '0')).toHaveLength(5);
    // 最下面那一行：4 位玩家的合计，4 个 "0"
    expect(at.filter((t) => t.y === SHARES_AT.y + SHARES_COLS.totalY && t.s === '0')).toHaveLength(4);
  });

  it('★ 整屏**一次填色都没有** —— 原版这屏没有董事长蓝底（`D-T031-8`）', () => {
    const rects: unknown[][] = [];
    const ctx = {
      drawImage: () => {},
      fillRect: (...a: unknown[]) => rects.push(a),
      fillText: () => {},
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillStyle: '',
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
    // 让「当前玩家」正好是某一家企业的董事长（旧版会在这里画蓝底）
    const s: GameState = {
      ...marketWithTwo(),
      currentPlayer: 2,
      commercialOwners: [
        { owner: 0, ranking: [0, 0, 0, 0] },
        { owner: 3, ranking: [3, 0, 0, 0] },
        { owner: 0, ranking: [0, 0, 0, 0] },
      ],
    };
    drawSharesScreen(ctx, () => null, sharesView(s, TOPO, ['甲', '乙', '丙', '丁']));
    expect(rects).toEqual([]);
  });
});

describe('分红金额 @source VA 0x0042bc9a / 0x0042be17', () => {
  it('★ 截断（__round_toward_zero），不是四舍五入', () => {
    expect(dividendText(2.9)).toBe('2');
    expect(dividendText(-2.9)).toBe('-2');
    expect(dividendText(0)).toBe('0');
    // 千分位
    expect(dividendText(1234567)).toBe('1,234,567');
  });
});

describe('买股上限 @source 闸门 VA 0x00428d65 / 0x00428d77', () => {
  it('★ 现货与现金两道闸取小', () => {
    expect(maxShares(10000, 50, 140_000)).toBe(2800); // 现金只够 2800
    expect(maxShares(100, 50, 140_000)).toBe(100); // 现货只够 100
    expect(maxShares(10000, 50, 49)).toBe(0);
    expect(maxShares(0, 50, 140_000)).toBe(0);
    expect(maxShares(100, 0, 140_000)).toBe(0); // 单价 0 不能白送
    expect(maxShares(-5, 50, 140_000)).toBe(0);
  });

  it('★ 恰好买光：现金 = 股数 × 单价这一条边界也认', () => {
    expect(maxShares(100, 50, 5_000)).toBe(100);
    expect(maxShares(101, 50, 5_000)).toBe(100);
  });
});

describe('摊成一屏 @source VA 0x0042bd61 那一圈', () => {
  it('★ 有企业的股票才占一行；董事长照状态取', () => {
    const s = marketWithTwo();
    const view = sharesView(s, TOPO, ['甲', '乙', '丙', '丁']);
    expect(view.companies).toHaveLength(2);
    expect(view.companies[0]).toMatchObject({ id: 1, stock: 0, name: '某某企業' });
    expect(view.companies[1]).toMatchObject({ id: 2, stock: 4, name: '另一家企業' });
    // ★ 原版这一屏**没有「自留股數」那一列**（`fcn_0042ba97` 整段没有 `push 0x47`），
    //   所以视图里也不带这个字段 —— 见 docs/deviations/T-031.md 的 D-T031-7。
    expect(view.companies[0]).not.toHaveProperty('retained');
    // ★ 也**没有董事长那一格**（整段没有一次填色调用）—— 见 D-T031-8。
    expect(view.companies[0]).not.toHaveProperty('boss');
    expect(view).not.toHaveProperty('ownedColumn');
    // 四位玩家各占一列
    expect(view.players.map((r) => r.player)).toEqual([0, 1, 2, 3]);
    expect(view.players.map((r) => r.column)).toEqual([0, 1, 2, 3]);
  });

  it('★ 分红按**在场玩家持股总和**摊，每股各方与合计都对得上', () => {
    // 企业 1 的累积盈餘 100000；玩家 0 持 6000、玩家 2 持 4000（合计 10000）
    let s = marketWithTwo();
    s = hold(s, 0, 0, 6000);
    s = hold(s, 2, 0, 4000);
    s = { ...s, companyFunds: [0, 100_000, 0] };
    const view = sharesView(s, TOPO, ['甲', '乙', '丙', '丁']);

    const p0 = view.players.find((r) => r.player === 0)!;
    const p1 = view.players.find((r) => r.player === 1)!;
    const p2 = view.players.find((r) => r.player === 2)!;
    // 100000 × 6000/10000 = 60000；100000 × 4000/10000 = 40000
    expect(p0.amounts[0]).toBe(60_000);
    expect(p2.amounts[0]).toBe(40_000);
    // 没持股的人不分、也不拖合计
    expect(p1.amounts[0]).toBe(0);
    expect(view.companies[0]!.total).toBe(100_000);
    expect(p0.total).toBe(60_000);
    expect(p2.total).toBe(40_000);
    expect(p1.total).toBe(0);
  });

  it('★ 那一行的「盈餘合计」画的是 `company[+0x28]` 本身，不是各玩家分红之和', () => {
    // 有盈餘但**没人持股**：原版照样把盈餘画在最后一列（VA 0x0042bcf7），
    // 而各玩家的分红是 0、合计也是 0 —— 两者必须分开。
    let s = marketWithTwo();
    s = { ...s, companyFunds: [0, 77_000, 0] };
    const view = sharesView(s, TOPO);
    expect(view.companies[0]!.total).toBe(77_000);
    expect(view.players.every((r) => r.total === 0)).toBe(true);
  });

  it('★ 没人持股、也没盈餘的那一家：合计 0（但**照样占一行**）', () => {
    const s = marketWithTwo();
    const view = sharesView(s, TOPO);
    expect(view.companies).toHaveLength(2);
    expect(view.companies[0]!.total).toBe(0);
    expect(view.players.every((r) => r.total === 0)).toBe(true);
  });

  it('★ 视图不读 `currentPlayer` / `commercialOwners`（这一屏没有董事长标识）', () => {
    let s = marketWithTwo();
    s = {
      ...s,
      commercialOwners: [
        { owner: 0, ranking: [0, 0, 0, 0] },
        { owner: 3, ranking: [3, 0, 0, 0] },
        { owner: 0, ranking: [0, 0, 0, 0] },
      ],
      currentPlayer: 2,
    };
    const a = sharesView(s, TOPO);
    const b = sharesView({ ...s, currentPlayer: 1 }, TOPO);
    const c = sharesView({ ...s, commercialOwners: [] }, TOPO);
    // 换董事长 / 换当前玩家 / 干脆没有归属表 —— 摊出来的东西一模一样
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
    expect(a).not.toHaveProperty('ownedColumn');
    // 没地图企业表时也不炸（名字退成空串，行照旧）
    const noTopo = sharesView(s, { nodes: [] } as unknown as MapTopology);
    expect(noTopo.companies).toHaveLength(a.companies.length);
    expect(noTopo.companies[0]!.name).toBe('');
  });

  it('★ 玩家名缺省时退回角色名', () => {
    const s = marketWithTwo();
    expect(characterName(s, 0)).toBe('約翰喬');
    expect(sharesView(s, TOPO).players[0]!.name).toBe('約翰喬');
    expect(sharesView(s, TOPO, ['甲']).players[0]!.name).toBe('甲');
  });
});

describe('整屏的开关 —— 每月 15 日的分紅演出 @source VA 0x0041d08f / 0x0042b3eb', () => {
  /** 够本屏用的一个假画布 —— `drawSharesScreen` 只贴图与画字 */
  function fakeStage(): CanvasRenderingContext2D {
    return {
      drawImage: () => {},
      fillRect: () => {},
      fillText: () => {},
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillStyle: '',
      imageSmoothingEnabled: false,
    } as unknown as CanvasRenderingContext2D;
  }

  function envWith(state: GameState, screen = 'game', now = 0): UiScreenEnv {
    return {
      screen,
      state,
      topo: TOPO,
      now,
      stage: fakeStage(),
      // 本屏只有图 0（不抠黑），测试里不真的取图
      sprite: () => null,
      dispatch: () => {},
      requestRender: () => {},
      log: () => {},
      playEffect: () => {},
    } as unknown as UiScreenEnv;
  }

  /** 造一次「14 日 → 15 日」的日期推进（原版只有一个判据：日 == 0xf） */
  function toDividendDay(): { before: GameState; after: GameState } {
    const before: GameState = { ...marketWithTwo(), day: 14, totalDays: 100 };
    return { before, after: { ...before, day: DIVIDEND_DAY, totalDays: 101 } };
  }

  it('★ 只在「日期跨到 15 日」那一下起播；主屏不是 game 就不接管', () => {
    resetSharesScreen();
    const { before, after } = toDividendDay();
    // 起播前：谁都不接管
    expect(sharesScreen.active(envWith(after))).toBe(false);
    expect(dividendDayCrossed(before, after)).toBe(true);
    sharesScreen.event!(before, after, envWith(after));
    expect(sharesScreenState().presenting).toBe(true);
    expect(sharesScreen.active(envWith(after))).toBe(true);
    expect(sharesScreen.active(envWith(after, 'stock'))).toBe(false);
  });

  it('★ 回归：`pending{buyShares}` **不再**接管整屏（那条路走 interactions.ts 的通用框）', () => {
    resetSharesScreen();
    const s = marketWithTwo();
    const pending = {
      kind: 'buyShares' as const,
      commercialId: 1,
      name: '某某企業',
      stock: 0,
      unitPrice: 50,
      available: 10_000,
      // 通用填数窗的上限由 core 算（`shareWindowLimit`，@source VA 0x0041d1a9）
      max: 1000,
      cash: 140_000,
    };
    expect(sharesScreen.active(envWith({ ...s, pending }))).toBe(false);
    // 别的待决交互同样不归本屏
    expect(
      sharesScreen.active(envWith({ ...s, pending: { kind: 'buyLand', landId: 0, name: 'x', price: 1 } })),
    ).toBe(false);
    // 就算之后起了分红演出，也**不是**因为那条待决交互
    expect(sharesScreenState().presenting).toBe(false);
  });

  it('★ 画面定格在 `before`：盈餘还没清零，分红额与合计都在', () => {
    resetSharesScreen();
    let before = marketWithTwo();
    before = hold(before, 0, 0, 6000);
    before = hold(before, 2, 0, 4000);
    before = { ...before, companyFunds: [0, 100_000, 0], day: 14, totalDays: 100 };
    // `advanceGameDay` 收工后的 `after`：盈餘已清零（正是本屏要回放的那一段）
    const after: GameState = {
      ...before,
      day: DIVIDEND_DAY,
      totalDays: 101,
      companyFunds: [0, 0, 0],
    };
    sharesScreen.event!(before, after, envWith(after));
    const v = sharesScreenState().view!;
    expect(v.companies[0]!.total).toBe(100_000);
    expect(v.players.find((r) => r.player === 0)!.amounts[0]).toBe(60_000);
    // 用 `after` 摊就会全成 0 —— 这一条正是 `event` 取 `before` 的原因
    expect(sharesView(after, TOPO).companies[0]!.total).toBe(0);
  });

  it('★ 别的日子、同一天里的别的 action 都不起播', () => {
    resetSharesScreen();
    const { before, after } = toDividendDay();
    // 日期没推进（同一个 15 日里的别的 action）
    sharesScreen.event!(after, { ...after }, envWith(after));
    expect(sharesScreenState().presenting).toBe(false);
    // 15 → 16
    sharesScreen.event!(after, { ...after, day: 16, totalDays: 102 }, envWith(after));
    expect(sharesScreenState().presenting).toBe(false);
    // 12 → 13
    sharesScreen.event!(
      { ...before, day: 12, totalDays: 98 },
      { ...before, day: 13, totalDays: 99 },
      envWith(after),
    );
    expect(sharesScreenState().presenting).toBe(false);
    expect(dividendDayCrossed(before, { ...before, day: 13, totalDays: 99 })).toBe(false);
    expect(dividendDayCrossed(after, { ...after, day: 16, totalDays: 102 })).toBe(false);
  });

  it('★ 收屏：抬手（0x202/0x205）直接退 —— 这一屏没有可点的控件', () => {
    resetSharesScreen();
    const { before, after } = toDividendDay();
    sharesScreen.event!(before, after, envWith(after));
    expect(sharesScreenState().presenting).toBe(true);
    sharesScreen.up!(0, 0, envWith(after));
    expect(sharesScreenState().presenting).toBe(false);
    expect(sharesScreenState().view).toBeNull();
    expect(sharesScreen.active(envWith(after))).toBe(false);
    // 已经收了再抬手也不炸
    sharesScreen.up!(0, 0, envWith(after));
    expect(sharesScreenState().presenting).toBe(false);
  });

  it('★ 到点自动收屏：计时从**真正上屏**那一帧起算，3 拍 × 1000 ms', () => {
    resetSharesScreen();
    expect(SHARES_AUTO_CLOSE_MS).toBe(3_000);
    const { before, after } = toDividendDay();
    sharesScreen.event!(before, after, envWith(after));
    expect(sharesScreenState().shownAt).toBe(-1); // 还没上屏，不计时

    // 上屏那一帧：`draw` 记下起点（此后再 tick 也还没到点）
    sharesScreen.draw!(envWith(after, 'game', 1_000));
    expect(sharesScreenState().shownAt).toBe(1_000);
    sharesScreen.tick!(envWith(after, 'game', 1_000 + SHARES_AUTO_CLOSE_MS - 1));
    expect(sharesScreenState().presenting).toBe(true);

    // 到点：自己收
    sharesScreen.tick!(envWith(after, 'game', 1_000 + SHARES_AUTO_CLOSE_MS));
    expect(sharesScreenState().presenting).toBe(false);
    expect(sharesScreenState().view).toBeNull();
  });

  it('★ 不在对局里（别的浮窗盖着）时，计时既不推进也不空转', () => {
    resetSharesScreen();
    const { before, after } = toDividendDay();
    sharesScreen.event!(before, after, envWith(after));
    sharesScreen.draw!(envWith(after, 'game', 1_000));
    sharesScreen.tick!(envWith(after, 'options', 1_000 + SHARES_AUTO_CLOSE_MS * 10));
    expect(sharesScreenState().presenting).toBe(true); // 没被收掉
    expect(sharesScreenState().shownAt).toBe(1_000);
    // 回到对局里，再过 3 秒才收
    sharesScreen.tick!(envWith(after, 'game', 1_000 + SHARES_AUTO_CLOSE_MS));
    expect(sharesScreenState().presenting).toBe(false);
  });
});
