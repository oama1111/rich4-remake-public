/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 上市企業落点：按行業收費、董事長好处、月中分紅、保險期
 */

import { describe, expect, it } from 'vitest';
import {
  DIVIDEND_DAY,
  FEE_NAMES,
  INDUSTRY,
  INDUSTRY_FEE_NAME_INDEX,
  AI_SHARE_RESERVE_RATIO,
  addInsuranceDays,
  aiCommercialShareCount,
  aiPickConstructionTarget,
  shareWindowLimit,
  applyDividend,
  chairmanEffect,
  companyDividends,
  companyFeeOnLanding,
  feeNameOf,
} from './company.ts';
import { WHEEL, WHEEL_TABLE, spinWheel } from '../rules/facility.ts';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { emptyOwnership } from './commercial.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { WHO_PLAYS_HUMAN, type GameState } from '../state/types.ts';
import { NPC } from '../rules/npc-actions.ts';
import { runNpc } from '../rules/npc-walk.ts';
import { releaseNpc } from '../rules/special-actors.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { LAND_TYPE_HOUSE } from '../rules/toll.ts';

describe('★ 費名表 —— 0x47528e 把行業別映到 0x47517c 的十三个串', () => {
  it('表与 dump 一字不差', () => {
    expect(INDUSTRY_FEE_NAME_INDEX).toEqual([2, 6, 0, 8, 7, 3, 2, 0, 0, 0, 0, 9, 0, 10]);
    expect(FEE_NAMES).toHaveLength(13);
  });
  it('航空→旅遊費、電子→電腦費、保險→保險費、汽車→修車費、石油→加油費、建設→工程費', () => {
    expect(feeNameOf(INDUSTRY.airline)).toBe('旅遊費');
    expect(feeNameOf(INDUSTRY.electronics)).toBe('電腦費');
    expect(feeNameOf(INDUSTRY.insurance)).toBe('保險費');
    expect(feeNameOf(INDUSTRY.auto)).toBe('修車費');
    expect(feeNameOf(INDUSTRY.oil)).toBe('加油費');
    expect(feeNameOf(INDUSTRY.construction)).toBe('工程費');
  });
});

describe('★ 别人的公司按行業收費 @source 0x0041ab6d', () => {
  const PI = 2;
  it('航空：轉盤 0 × 地價 × 物價；轉到 0 →「不用出國！」免費', () => {
    // 轉盤 0 = [1,ff,0,ff,1,ff,2,ff,3,ff,2,ff]：起点 2 停在 0
    expect(spinWheel(WHEEL.travel, 2)).toBe(0);
    expect(companyFeeOnLanding(INDUSTRY.airline, 500, PI, 0, 0, 0, 2)).toEqual({ kind: 'none' });
    // 起点 6 停在 2
    expect(companyFeeOnLanding(INDUSTRY.airline, 500, PI, 0, 0, 0, 6)).toEqual({ kind: 'fee', amount: 2 * 500 * PI, name: '旅遊費', days: 2 });
  });

  it('★ 電子：地價 × 總天數，不乘物價（0x0041ac2c 跳过了那句）', () => {
    expect(companyFeeOnLanding(INDUSTRY.electronics, 500, PI, 37, 0, 0, 0)).toEqual({ kind: 'fee', amount: 500 * 37, name: '電腦費' });
  });

  it('保險：轉盤 3 出天数，費 = 天 × 地價 × 物價，并投保', () => {
    // 轉盤 3 = [5,ff,3,ff,30,ff,20,ff,15,ff,10,ff]：起点 4 → 30
    const f = companyFeeOnLanding(INDUSTRY.insurance, 500, PI, 0, 0, 0, 4);
    expect(f).toEqual({ kind: 'insurance', amount: 30 * 500 * PI, days: 30 });
  });

  it('★ 汽車/石油：走路的人不收；機車 ×1、汽車 ×2，再乘步數与物價', () => {
    expect(companyFeeOnLanding(INDUSTRY.auto, 500, PI, 0, 0, 6, 0)).toEqual({ kind: 'none' });
    expect(companyFeeOnLanding(INDUSTRY.auto, 500, PI, 0, 1, 6, 0)).toEqual({ kind: 'fee', amount: 500 * 1 * 6 * PI, name: '修車費' });
    expect(companyFeeOnLanding(INDUSTRY.oil, 500, PI, 0, 2, 6, 0)).toEqual({ kind: 'fee', amount: 500 * 2 * 6 * PI, name: '加油費' });
  });

  it('門派：地價 × 步數 × 物價；建設：先选地', () => {
    // 表 [12] = 0 → 費名是「過路費」（門派那句提示写的是「幫主%s 請付%d元%s」）
    expect(companyFeeOnLanding(INDUSTRY.sect, 500, PI, 0, 0, 4, 0)).toEqual({ kind: 'fee', amount: 500 * 4 * PI, name: '過路費' });
    expect(companyFeeOnLanding(INDUSTRY.construction, 500, PI, 0, 0, 4, 0)).toEqual({ kind: 'construction' });
  });

  it('飯店(2)、銀行(7)、百貨(10) 不收', () => {
    for (const ind of [INDUSTRY.hotel, INDUSTRY.bank, INDUSTRY.store]) {
      expect(companyFeeOnLanding(ind, 500, PI, 9, 2, 6, 0)).toEqual({ kind: 'none' });
    }
  });
});

describe('★ 董事長的好处 @source 0x0041a9e8', () => {
  it('保險公司董事長免費投保（轉盤 3）；建設公司董事長免費加蓋；其余无事', () => {
    expect(chairmanEffect(INDUSTRY.insurance, 4)).toEqual({ kind: 'insurance', days: 30 });
    expect(chairmanEffect(INDUSTRY.construction, 0)).toEqual({ kind: 'construction' });
    expect(chairmanEffect(INDUSTRY.airline, 0)).toEqual({ kind: 'none' });
    expect(chairmanEffect(INDUSTRY.bank, 0)).toEqual({ kind: 'none' });
  });
  it('投保天数累加并 & 0x7f', () => {
    expect(addInsuranceDays(10, 30)).toBe(40);
    expect(addInsuranceDays(120, 30)).toBe((150) & 0x7f);
  });
  // ★ 2026-09-16：删掉这里对 `company.ts` 的 `insurancePayout(天数, 损失)` 的断言。
  //   那个函数是**死代码**（全 core 只有本测试引用它），真正在跑的是
  //   `insurancePayoutTo`（`state/reduce.ts`，赔付口径与调用点见
  //   `places/insurance.test.ts` 与 `insurancePayoutTo` 的头注释）。
  //   删掉之后这条口径仍被 `insurance.test.ts` 钉着，不是丢覆盖。
});

describe('★ 建設：电脑挑当前等级租金最高的住宅 @source 0x40b455', () => {
  const lands = [
    makeLand({ id: 1, type: LAND_TYPE_HOUSE, rentByLevel: [10, 100, 200, 300, 400, 500] }),
    makeLand({ id: 2, type: LAND_TYPE_HOUSE, rentByLevel: [20, 900, 950, 960, 970, 980] }),
    makeLand({ id: 3, type: LAND_TYPE_HOUSE, rentByLevel: [30, 5000, 5000, 5000, 5000, 5000] }),
  ];
  it('只看自己的、住宅、没盖满的；按当前等级租金比', () => {
    // 1 号 lv1（租 100）、2 号 lv1（租 900）都归 0 号；3 号归别人
    const pick = aiPickConstructionTarget(0, lands, [0, 1, 1, 2], [0, 1, 1, 1], [0, 0, 0, 0], [], [], [], []);
    expect(pick).toBe(0x7d0 + 2);
  });
  it('盖满五级的不选；一处都没有返回 0', () => {
    expect(aiPickConstructionTarget(0, lands, [0, 1, 0, 0], [0, 5, 0, 0], [0, 0, 0, 0], [], [], [], [])).toBe(0);
  });
  it('★ 等级 0 的地按 rentByLevel[0] 比；租金为 0 的永远选不上（严格大于）', () => {
    const zero = [makeLand({ id: 1, type: LAND_TYPE_HOUSE, rentByLevel: [0, 100, 200, 300, 400, 500] })];
    expect(aiPickConstructionTarget(0, zero, [0, 1], [0, 0], [0, 0], [], [], [], [])).toBe(0);
    expect(aiPickConstructionTarget(0, lands, [0, 1], [0, 0], [0, 0], [], [], [], [])).toBe(0x7d0 + 1);
  });
});

describe('★ 月中分紅 @source 0x0042bd61', () => {
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
  it('按玩家持股占比分，分母是玩家持股总和', () => {
    const d = companyDividends(10_000, [100, 300, 0, 0], players);
    expect(d.rows).toEqual([
      { player: 0, amount: 2500 },
      { player: 1, amount: 7500 },
    ]);
    expect(d.cleared).toBe(true);
  });
  it('★ 没人持股：不分、也不清零（盈餘留着累积）', () => {
    expect(companyDividends(10_000, [0, 0, 0, 0], players)).toEqual({ rows: [], cleared: false });
  });
  it('★ 恰好 .5 时向零截断（0x0042bc9a 的 `call 0x457dbc`）', () => {
    const two = [0, 1, 2, 3].map((i) => makePlayer({ index: i }));
    // 两份各半，盈餘 1 ⇒ 0.5：截断 0、Math.round 1（0 不进 rows）
    expect(companyDividends(1, [1, 1, 0, 0], two).rows).toEqual([]);
    // 盈餘 3 ⇒ 1.5：截断 1、Math.round 2
    expect(companyDividends(3, [1, 1, 0, 0], two).rows).toEqual([
      { player: 0, amount: 1 },
      { player: 1, amount: 1 },
    ]);
    // 盈餘 5 ⇒ 2.5：截断 2
    expect(companyDividends(5, [1, 1, 0, 0], two).rows[0]?.amount).toBe(2);
  });
  it('出局的不算', () => {
    const dead = players.map((p, i) => (i === 1 ? { ...p, whoPlays: 0 } : p));
    const d = companyDividends(10_000, [100, 300, 0, 0], dead);
    expect(d.rows).toEqual([{ player: 0, amount: 10_000 }]);
  });
  it('★ 负盈餘 → 负紅利，進存款；压穿存款并进现金，再穿就破產', () => {
    const p = makePlayer({ index: 0, cash: 1000, moneyInBank: 500 });
    expect(applyDividend(p, -300)).toMatchObject({ player: { cash: 1000, moneyInBank: 200 }, bankrupt: false });
    expect(applyDividend(p, -800)).toMatchObject({ player: { cash: 700, moneyInBank: 0 }, bankrupt: false });
    expect(applyDividend(p, -2000)).toMatchObject({ player: { cash: 0, moneyInBank: 0 }, bankrupt: true });
  });
  it('分紅日与開獎同一天', () => {
    expect(DIVIDEND_DAY).toBe(15);
  });
});

// ============================================================
//  接到 reducer：一个上市企業格
// ============================================================

const CID = 1;
const companyNode = makeNode({ id: 2, adjacent: [1, 3], type: 6001, ref: { kind: 'commercial', index: CID } });
function topoWith(industry: number): MapTopology {
  return {
    nodes: [makeNode({ id: 1, adjacent: [2] }), companyNode, makeNode({ id: 3, adjacent: [2] })],
    // ★ rentByLevel[0] 是等级 0 的租金 —— 0x40b455 按「当前等级租金」比，且严格大于 0 才入选
    lands: [makeLand({ id: 1, type: LAND_TYPE_HOUSE, landPrice: 1000, rentByLevel: [50, 100, 200, 300, 400, 500] })],
    commercials: [
      { id: CID, x: 0, y: 0, name: '測試公司', stockIndex: 0, landPrice: 500, type: industry, spriteIndex: 0, assetValue: 1_000_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 1000 },
    ],
  };
}

function landing(chairman: number | null, over: Partial<GameState> = {}): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: i === 0 ? 2 : 1, cash: 100_000, moneyInBank: 0, trafficMethod: 2 })),
    phase: 'settling',
    priceIndex: 1,
    stepsTotal: 6,
    totalDays: 40,
    // ★ 企業要**还有股可卖**才会问「是否認購」——原版 `cmp dword [ebx+0x30], 0 / je 结束`
    //   （VA 0x0041d1a9 进门第 3 条），main 的 makeGameState 默认这张表是空的。
    commercialShares: [0, 1000],
    ...over,
  });
  const commercialOwners = [...s.commercialOwners];
  while (commercialOwners.length <= CID) commercialOwners.push(emptyOwnership());
  commercialOwners[CID] = { ...emptyOwnership(), owner: chairman === null ? 0 : chairman + 1 };
  return { ...s, commercialOwners };
}

describe('★ 踩到上市企業', () => {
  it('别人的電子公司：付 地價 × 總天數 到公司盈餘，然后照旧问認購', () => {
    const s = landing(1);
    const r = reduce(s, { type: 'settle' }, topoWith(INDUSTRY.electronics));
    expect(r.players[0]?.cash).toBe(100_000 - 500 * 40);
    expect(r.companyFunds[CID]).toBe(500 * 40);
    // 董事長口袋不动
    expect(r.players[1]?.cash).toBe(100_000);
    expect(r.pending?.kind).toBe('buyShares');
  });

  it('★ 别人的汽車公司：汽車 ×2 × 步數 × 地價 × 物價', () => {
    const r = reduce(landing(1), { type: 'settle' }, topoWith(INDUSTRY.auto));
    expect(r.companyFunds[CID]).toBe(500 * 2 * 6 * 1);
  });

  it('别人的保險公司：付費并拿到保險期', () => {
    const r = reduce(landing(1), { type: 'settle' }, topoWith(INDUSTRY.insurance));
    const days = r.players[0]!.insuranceDays;
    expect([5, 3, 30, 20, 15, 10]).toContain(days);
    expect(r.companyFunds[CID]).toBe(days * 500);
  });

  it('无主 / 自家的銀行：不收費，只问認購', () => {
    const none = reduce(landing(null), { type: 'settle' }, topoWith(INDUSTRY.bank));
    expect(none.players[0]?.cash).toBe(100_000);
    expect(none.pending?.kind).toBe('buyShares');
    const mine = reduce(landing(0), { type: 'settle' }, topoWith(INDUSTRY.bank));
    expect(mine.players[0]?.cash).toBe(100_000);
  });

  it('★ 保險公司董事長：免費投保', () => {
    const r = reduce(landing(0), { type: 'settle' }, topoWith(INDUSTRY.insurance));
    expect(r.players[0]!.insuranceDays).toBeGreaterThan(0);
    expect(r.players[0]?.cash).toBe(100_000);
  });

  // ★ 第十五份：自家公司蓋**两次**（第一次没到 5 级）—— `0x0041aae8 call 0x40b110` → `0x0041aaf7 test al,0x80 / jne`
  //   → `0x0041aafb call 0x40b110`；先前这里写「加一级」是只读了第一次调用。
  it('★ 建設公司董事長（电脑）：免費给自己租金最高的地蓋两级（第一次没到 5 级就再蓋一次）', () => {
    const s0 = landing(0, { players: [0, 1].map((i) => makePlayer({ index: i, nodeId: i === 0 ? 2 : 1, cash: 100_000, whoPlays: 2 })) });
    const landOwner = [...s0.landOwner];
    landOwner[1] = 1;
    const s = { ...s0, landOwner };
    const r = reduce(s, { type: 'settle' }, topoWith(INDUSTRY.construction));
    expect(r.landLevel[1]).toBe(2);
    expect(r.players[0]?.cash).toBe(100_000);
  });

  it('★ 别人的建設公司（电脑）：加一级后付那块地 地價 × 物價 的工程費', () => {
    const s0 = landing(1, { players: [0, 1].map((i) => makePlayer({ index: i, nodeId: i === 0 ? 2 : 1, cash: 100_000, whoPlays: 2 })) });
    const landOwner = [...s0.landOwner];
    landOwner[1] = 1;
    const r = reduce({ ...s0, landOwner }, { type: 'settle' }, topoWith(INDUSTRY.construction));
    expect(r.landLevel[1]).toBe(1);
    expect(r.players[0]?.cash).toBe(100_000 - 1000);
    expect(r.companyFunds[CID]).toBe(1000);
  });

  it('★ 别人的建設公司（真人）：弹选地；选了就加级、付費、再问認購', () => {
    const s0 = landing(1);
    const landOwner = [...s0.landOwner];
    landOwner[1] = 1;
    const asked = reduce({ ...s0, landOwner }, { type: 'settle' }, topoWith(INDUSTRY.construction));
    expect(asked.pending).toMatchObject({ kind: 'chooseBuildTarget', charge: true, choices: [0x7d0 + 1] });
    const done = reduce(asked, { type: 'buildTarget', entityId: 0x7d0 + 1 }, topoWith(INDUSTRY.construction));
    expect(done.landLevel[1]).toBe(1);
    expect(done.players[0]?.cash).toBe(99_000);
    expect(done.pending?.kind).toBe('buyShares');
  });

  it('★ 真人没有可加蓋的地：不弹选地，直接問認購', () => {
    const r = reduce(landing(1), { type: 'settle' }, topoWith(INDUSTRY.construction));
    expect(r.pending?.kind).toBe('buyShares');
  });
});

describe('★ 每日：保險期倒数；15 日分紅', () => {
  const topo = topoWith(INDUSTRY.bank);

  // ★★ 2026-09-19 订正（§7.141，通道 2 `test_insurance_richest.py` 135/135）：
  //   旧标题「再下一次清零」是**错的**。保险期那一支（`0x41cc4b..0x41cc66`）**没有**
  //   阻碍计数器的 `test 0x80 → 清零+释放` 分支，是整字节递减 ⇒ `0x80 → 0x7f`，
  //   于是 `1 → 0x80 → 0x7f → … → 1 → 0x80…` **永不归零**
  //   （闸门 `+0x3e != 0` 实际等于「买过一次保險就永久理赔」）。
  it('保險期每回合 −1；到 0 挂 0x80，之后 0x80→0x7f（**永不归零**）', () => {
    let s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 1, insuranceDays: 2 })], phase: 'turnStart' });
    s = reduce(s, { type: 'startTurn' }, topo);
    expect(s.players[0]!.insuranceDays).toBe(1);
    s = reduce({ ...s, phase: 'turnStart' }, { type: 'startTurn' }, topo);
    expect(s.players[0]!.insuranceDays).toBe(RELEASE_PENDING);
    s = reduce({ ...s, phase: 'turnStart' }, { type: 'startTurn' }, topo);
    expect(s.players[0]!.insuranceDays).toBe(RELEASE_PENDING - 1); // 0x7f，**不是 0**
  });

  it('★ 推进到 15 日：盈餘按持股分进存款并清零', () => {
    const base = makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, moneyInBank: 0 })),
      phase: 'turnEnd',
      year: 1998, month: 3, day: 14,
    });
    const holdings = base.holdings.map((row, p) => row.map((h, j) => (j === 0 ? { ...h, amount: p === 0 ? 100 : 300 } : h)));
    const companyFunds = [...base.companyFunds];
    companyFunds[CID] = 10_000;
    // 一輪才过一天：让最后一名玩家收回合
    const s = { ...base, holdings, companyFunds, currentPlayer: 1 };
    const r = reduce(s, { type: 'endTurn' }, topo);
    expect(r.day).toBe(15);
    expect(r.players[0]?.moneyInBank).toBe(2500);
    expect(r.players[1]?.moneyInBank).toBe(7500);
    expect(r.companyFunds[CID]).toBe(0);
  });

  it('14 日不分', () => {
    const base = makeGameState({ players: [makePlayer({ index: 0, nodeId: 1 })], phase: 'turnEnd', year: 1998, month: 3, day: 12 });
    const companyFunds = [...base.companyFunds];
    companyFunds[CID] = 10_000;
    const r = reduce({ ...base, companyFunds }, { type: 'endTurn' }, topo);
    expect(r.companyFunds[CID]).toBe(10_000);
  });
});

describe('★ 間諜取走盈餘 —— 负数就反向', () => {
  const topo = topoWith(INDUSTRY.bank);
  const line = (f: number): number => f + 1;
  function withSurplus(amount: number): GameState {
    const s = landing(1, {
      players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 20, cash: 50_000, moneyInBank: 0 })),
    });
    const companyFunds = [...s.companyFunds];
    companyFunds[CID] = amount;
    return { ...s, companyFunds };
  }
  it('盈餘 8000 → 間諜取 8000 给主人（進存款），公司盈餘不清', () => {
    const s = withSurplus(8000);
    const rng = new WatcomRng();
    rng.setState(1);
    const w = runNpc(NPC.spy, releaseNpc(1, 0, 2), s, topo, line, rng);
    expect(w.events).toContainEqual({ kind: 'surplus', landlord: 1, amount: 8000, company: CID });
  });
  it('★ 盈餘 −3000 → 主人替企業主掏 3000', () => {
    const s = withSurplus(-3000);
    const rng = new WatcomRng();
    rng.setState(1);
    const w = runNpc(NPC.spy, releaseNpc(1, 0, 2), s, topo, line, rng);
    expect(w.events).toContainEqual({ kind: 'surplus', landlord: 1, amount: -3000, company: CID });
  });
  it('自家公司不取；其他三个不取', () => {
    const s = withSurplus(8000);
    for (const actor of [NPC.thief, NPC.robber, NPC.thug]) {
      const rng = new WatcomRng();
      rng.setState(1);
      expect(runNpc(actor, releaseNpc(1, 0, 2), s, topo, line, rng).events.filter((e) => e.kind === 'surplus')).toEqual([]);
    }
  });
});

describe('轉盤表', () => {
  it('轉盤 0 就是航空那张：[1,ff,0,ff,1,ff,2,ff,3,ff,2,ff]', () => {
    expect(WHEEL_TABLE[WHEEL.travel]).toEqual([1, 0xff, 0, 0xff, 1, 0xff, 2, 0xff, 3, 0xff, 2, 0xff]);
  });
  it('WHO_PLAYS_HUMAN 常量仍是 1（上面的电脑分支用 2）', () => {
    expect(WHO_PLAYS_HUMAN).toBe(1);
  });
});

describe('★ 电脑认购上市企業股份 `0x41d839(單價, 上限)`（pt27-stock「忍太郎一下买了 3000 股」）', () => {
  it('★★ 回报现场：單價 28、現金 188000、餘量 3000、開局 300000 ⇒ 上限 1000（不是 3000）', () => {
    // 上限 = shareWindowLimit：`0x0041d20a cmp eax,0x3e8` 在 `0x0041d22a` 真人/电脑分叉之前
    const limit = shareWindowLimit(28, 188_000, 3000);
    expect(limit).toBe(1000);
    // 188000 − trunc(300000×0.30)×1 = 98000 > 28×1000 ⇒ 上限（`0x0041d885 mov ecx, edi`）
    expect(aiCommercialShareCount(28, limit, 188_000, 300_000, 1)).toBe(1000);
  });
  it('安全垫 = trunc(開局 × 0.30) × 物價，现金只够垫子 ⇒ 0（`0x0041d874 jle`）', () => {
    expect(AI_SHARE_RESERVE_RATIO).toBe(0.3);
    expect(aiCommercialShareCount(28, 1000, 90_000, 300_000, 1)).toBe(0);
    expect(aiCommercialShareCount(28, 1000, 90_028, 300_000, 1)).toBe(1);
    // 物價 2 ⇒ 垫子 180000
    expect(aiCommercialShareCount(28, 1000, 188_000, 300_000, 2)).toBe(Math.trunc(8000 / 28));
  });
  it('d ≤ 單價 × 上限 ⇒ d ÷ 單價（向零）；d 恰等于 單價×上限 也走除法（`jle`）', () => {
    expect(aiCommercialShareCount(70, 1000, 100_000, 150_000, 1)).toBe(785); // 差分 B14
    expect(aiCommercialShareCount(50, 100, 50_000, 150_000, 1)).toBe(100); // d = 5000 = 50×100
    expect(aiCommercialShareCount(7, 1000, 45_001, 150_000, 1)).toBe(0); // 差分 B16
  });
  it('存款不参与；没有 [A] 支的 7000 封顶（差分 B7 / B11）', () => {
    expect(aiCommercialShareCount(1, 1000, 45_000, 150_000, 1)).toBe(0);
    expect(aiCommercialShareCount(1, 1000, 7_001, 300_000, 1)).toBe(0);
  });
  it('上限 0 / 單價 0 ⇒ 0（原版连 0x41d839 都走不到）', () => {
    expect(aiCommercialShareCount(28, 0, 188_000, 300_000, 1)).toBe(0);
    expect(aiCommercialShareCount(0, 1000, 188_000, 300_000, 1)).toBe(0);
  });
});
