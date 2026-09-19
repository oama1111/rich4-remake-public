/*
 * 付费类落点的棕色訊息框 —— issue #18
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里钉两件事：
 * ① **参数逐字对** —— 键、地名、人名、費名、金额的顺序就是原版 `sprintf` 的顺序
 *    （`0x00419d3e` 的 `%s\n\n此地屬%s\n\n請付%d元%s`）；
 * ② **金额是神明加成之前那一笔** —— 这是整个接口存在的理由。原版先弹框
 *    （`0x00419d50 push 0x5dc / call 0x440cac`）**之后**才 `call 0x41d709`
 *    按付款方的神明加减。把实现改成「用调过之后的金额」会让下面那条
 *    「★★★ 可证伪」的用例当场变红。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { emptyOwnership } from '../places/commercial.ts';
import { INDUSTRY } from '../places/company.ts';
import { GOD_SMALL_FORTUNE } from '../rules/god-toll.ts';

// ============================================================
//  住宅：走到别人的地產上
// ============================================================

const LAND = 1;
/** 同盟者名下的同名地塊（level 1 → 租金表[1] = 500） */
const ALLY_LAND = 2;

const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2] }),
    makeNode({ id: 2, adjacent: [1], type: 0x7d0 + LAND, ref: { kind: 'land', index: LAND } }),
  ],
  lands: [
    // 地名一样 ⇒ `calculate_land_toll` 会把同盟者那一块一并算进来
    makeLand({ id: LAND, name: '測試地', landPrice: 1000, rentByLevel: [200, 500, 1200, 2800, 6000, 10000] }),
    makeLand({ id: ALLY_LAND, name: '測試地', landPrice: 1000, rentByLevel: [200, 500, 1200, 2800, 6000, 10000] }),
  ],
};

/**
 * 0 号走到 1 号（level 2）的地產上；2 号是 1 号的同盟。
 *
 * 租金 = 1200（地主 level 2）+ 同盟同名地 level 1 的 500 = **1700**。
 */
function onRivalLand(over: {
  payer?: Parameters<typeof makePlayer>[0];
  owner?: Parameters<typeof makePlayer>[0];
  ally?: Parameters<typeof makePlayer>[0];
  priceStatus?: number;
} = {}): ReturnType<typeof makeGameState> {
  const s = makeGameState({
    players: [
      makePlayer({ index: 0, character: 0, nodeId: 2, cash: 50_000, moneyInBank: 0, ...(over.payer ?? {}) }),
      makePlayer({ index: 1, character: 1, nodeId: 1, cash: 1000, moneyInBank: 0, ...(over.owner ?? {}) }),
      makePlayer({ index: 2, character: 2, nodeId: 1, cash: 1000, moneyInBank: 0, ...(over.ally ?? {}) }),
    ],
    phase: 'settling',
    priceIndex: 1,
  });
  const landOwner = [...s.landOwner];
  const landLevel = [...s.landLevel];
  landOwner[LAND] = 2; // 1 号（玩家下标 1 → owner 2）
  landLevel[LAND] = 2;
  landOwner[ALLY_LAND] = 3; // 2 号（玩家下标 2 → owner 3）
  landLevel[ALLY_LAND] = 1;
  const landPriceStatus = [...s.landPriceStatus];
  landPriceStatus[LAND] = over.priceStatus ?? 0;
  return { ...s, landOwner, landLevel, landPriceStatus };
}

const settle = (s: ReturnType<typeof onRivalLand>) => reduce(s, { type: 'settle' }, topo);

/** 一套完整的 `BlockingDays`（工厂缺省全 0），按需覆盖一两项 —— 免收判据只看这几项 */
function confined(over: Partial<ReturnType<typeof makePlayer>['blocking']> = {}) {
  return { ...makePlayer().blocking, ...over };
}

describe('★★ 住宅：`RENT.payOneOwner`（0x00419d3e）', () => {
  it('无同盟 → 键 / 地名 / 地主名 / 金额 / 費名 逐字对', () => {
    const after = settle(onRivalLand());
    // 地主 level 2 的 1200；名 = CHARACTERS[1] = 沙隆巴斯；費名 = [0x47517c] 第 0 项
    expect(after.lastNotice).toEqual({
      key: 'rent.payOneOwner',
      args: ['測試地', '沙隆巴斯', 1200, '過路費'],
    });
  });

  it('★★★ 可证伪：金额是**神明加成之前**那一笔（改成 `total` 当即变红）', () => {
    // 小財神（god 1）把过路费砍一半：1200 → 600（@source 0x41d741 `sar ebx,1`）
    const after = settle(onRivalLand({ payer: { godInfo: GOD_SMALL_FORTUNE } }));
    // 真收到的是调过之后的 600 —— 先钉住这一点，确保这个局面确实触发了神明
    expect(after.players[1]!.moneyInBank).toBe(600);
    expect(after.landLastToll[LAND]).toBe(600);
    // ★ 而框里写的是**原价** 1200。若实现改成 `preview.total`，这里会是 600 ⇒ 红
    expect(after.lastNotice).toEqual({
      key: 'rent.payOneOwner',
      args: ['測試地', '沙隆巴斯', 1200, '過路費'],
    });
    expect(after.lastNotice?.args[2]).not.toBe(600);
  });

  it('★ 免費卡把那笔抹成 0 时，框**照样弹**（原版弹框在免費卡那一段之前）', () => {
    // 費 1200 > 現金 100 ⇒ 电脑必用免費卡（@source 0x444a9b）
    const after = settle(onRivalLand({ payer: { cash: 100, cards: [20] } }));
    expect(after.players[0]!.cash).toBe(100);
    expect(after.landLastToll[LAND]).toBe(0);
    expect(after.lastNotice).toEqual({
      key: 'rent.payOneOwner',
      args: ['測試地', '沙隆巴斯', 1200, '過路費'],
    });
  });

  it('★★ 九种免收那一路**也弹**（地主坐牢中一分不收，但先弹「%s坐牢中／免收%s！」）', () => {
    // ★ 订正（2026-09-19）：原断言是 `toBeNull()` —— 那是**复述实现**，不是真值断言。
    //   原版 `0x41d559` 每条免收支都先 `call 0x457110`（sprintf）一句，再跳到
    //   `0x41d6a4 push 0x5dc / call 0x440cac` 弹**同一扇**棕色訊息框：
    //   @source 0x0041d645 `push 0x463c1b`（`%s坐牢中\n\n免收%s！`）
    //   @source 0x0041d6a4 `push 0x5dc` + `0x41d6ae call 0x440cac`
    //   ⇒ 「免收」与「弹框」是同一支里的两件事，不是互斥的。
    const after = settle(onRivalLand({ owner: { blocking: confined({ inPrison: 3 }) } }));
    expect(after.lastNotice).toEqual({
      key: 'rent.freePrison',
      args: ['沙隆巴斯', '過路費'],
    });
    // 钱一分没动 —— 弹框不改规则
    expect(after.players[0]!.cash).toBe(50_000);
    expect(after.players[1]!.moneyInBank).toBe(0);
  });
});

/**
 * 九种免收里「被关着／不在棋盘」那四种的文案（试玩第四份回报第 8 条）。
 *
 * 参数顺序 = 原版 `sprintf(fmt, 地主名, 費名)`：地主名由 `0x41d57d call 0x452946`
 * 填进缓冲（实参是 `[esp+0xa4]` = 函数第 1 个实参 = 地主下标），費名是第 3 个实参
 * （住宅这条路 = `[0x47517c]` 第 0 项「過路費」）。
 */
describe('★★ 免收訊息框：`%s住宿中／消失中／坐牢中／住院中` + `免收%s！`', () => {
  const cases = [
    { reason: 'hotel', blocking: { inHotel: 2 }, key: 'rent.freeHotel' },
    { reason: 'disappearing', blocking: { disappearing: 2 }, key: 'rent.freeVanished' },
    { reason: 'prison', blocking: { inPrison: 2 }, key: 'rent.freePrison' },
    { reason: 'hospital', blocking: { inHospital: 2 }, key: 'rent.freeHospital' },
  ] as const;

  it.each(cases)('★★★ 可证伪：地主 $reason ⇒ 键 $key（不弹就是红的）', ({ blocking, key }) => {
    const after = settle(onRivalLand({ owner: { blocking: confined(blocking) } }));
    // 旧实现（豁免直接 `return {...state, phase:'turnEnd'}`）这里是 `null` ⇒ 红
    expect(after.lastNotice).toEqual({ key, args: ['沙隆巴斯', '過路費'] });
  });

  it('★ 参数顺序就是原版 `sprintf` 的顺序：地主名在前、費名在后', () => {
    const after = settle(onRivalLand({ owner: { blocking: confined({ inHospital: 4 }) } }));
    expect(after.lastNotice?.args).toEqual(['沙隆巴斯', '過路費']);
    // 反序就会红：費名不在第 0 位
    expect(after.lastNotice?.args[0]).not.toBe('過路費');
  });

  it('★ 框里的名字跟着地主走（换成别的角色名）', () => {
    const after = settle(onRivalLand({ owner: { character: 3, blocking: confined({ inHotel: 1 }) } }));
    expect(after.lastNotice?.args[0]).not.toBe('沙隆巴斯');
    expect(after.lastNotice?.key).toBe('rent.freeHotel');
  });

  it('没有豁免（地主在场）时照旧弹**租金**框，不是免收框', () => {
    const after = settle(onRivalLand());
    expect(after.lastNotice?.key).toBe('rent.payOneOwner');
  });
});

describe('★★ 住宅：`RENT.payTwoOwners`（0x00419d1a）', () => {
  it('地主有同盟 → 多一个同盟名，金额是**两份之和**（1200 + 500）', () => {
    const after = settle(onRivalLand({ owner: { alliedPlayer: 3 } }));
    expect(after.lastNotice).toEqual({
      key: 'rent.payTwoOwners',
      args: ['測試地', '沙隆巴斯', '忍太郎', 1700, '過路費'],
    });
  });

  it('★ 有同盟时金额同样是**神明加成之前**的那一笔（实收 850）', () => {
    const after = settle(onRivalLand({ owner: { alliedPlayer: 3 }, payer: { godInfo: GOD_SMALL_FORTUNE } }));
    expect(after.landLastToll[LAND]).toBe(850);
    expect(after.lastNotice).toEqual({
      key: 'rent.payTwoOwners',
      args: ['測試地', '沙隆巴斯', '忍太郎', 1700, '過路費'],
    });
  });

  it('涨价位只翻地主那一份 ⇒ 框里跟着涨（@source 0x00419b0f `add ebp, ebp`）', () => {
    const after = settle(onRivalLand({ priceStatus: 1 }));
    // 地主 1200×2 = 2400，同盟 0（无同盟）⇒ 框里 2400
    expect(after.lastNotice).toEqual({
      key: 'rent.payOneOwner',
      args: ['測試地', '沙隆巴斯', 2400, '過路費'],
    });
  });
});

// ============================================================
//  企業：走到别人的上市企業上（董事長 / 幫主）
// ============================================================

const CID = 1;

const companyTopo = (industry: number): MapTopology => ({
  nodes: [
    makeNode({ id: 1, adjacent: [2] }),
    makeNode({ id: 2, adjacent: [1, 3], type: 6001, ref: { kind: 'commercial', index: CID } }),
    makeNode({ id: 3, adjacent: [2] }),
  ],
  commercials: [{
    id: CID, x: 0, y: 0, name: '測試公司', stockIndex: 0, landPrice: 500, type: industry,
    spriteIndex: 0, assetValue: 1_000_000, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, shares: 1000,
  }],
});

/** 0 号站在企業格上，企業主 = 1 号（玩家下标 1）*/
function onRivalCompany(industry: number, payer: Parameters<typeof makePlayer>[0] = {}) {
  const base = makeGameState({
    players: [
      makePlayer({ index: 0, character: 0, nodeId: 2, cash: 50_000, moneyInBank: 0, ...payer }),
      makePlayer({ index: 1, character: 1, nodeId: 1, cash: 1000, moneyInBank: 0 }),
    ],
    phase: 'settling',
    priceIndex: 1,
    stepsTotal: 6,
    commercialShares: [0, 1000],
  });
  const commercialOwners = [...base.commercialOwners];
  while (commercialOwners.length <= CID) commercialOwners.push(emptyOwnership());
  commercialOwners[CID] = { ...emptyOwnership(), owner: 2 }; // 玩家下标 1 → owner 2
  return { ...base, commercialOwners };
}

describe('★★ 企業：`RENT.payBoss`（0x0041ae86）/ `RENT.payChairman`（0x0041ae98）', () => {
  it('門派（行業 0xc）→ 幫主那一句；費 = 地價 × 步數 × 物價（500×6×1）', () => {
    const after = reduce(onRivalCompany(INDUSTRY.sect), { type: 'settle' }, companyTopo(INDUSTRY.sect));
    expect(after.lastNotice).toEqual({
      key: 'rent.payBoss',
      args: ['測試公司', '沙隆巴斯', 3000, '過路費'],
    });
  });

  it('汽車（行業 5，走路 1 倍）→ 董事長那一句；費名查 `[行業 + 0x47528e]` = 修車費', () => {
    const after = reduce(
      onRivalCompany(INDUSTRY.auto, { trafficMethod: 1 }),
      { type: 'settle' },
      companyTopo(INDUSTRY.auto),
    );
    expect(after.lastNotice).toEqual({
      key: 'rent.payChairman',
      args: ['測試公司', '沙隆巴斯', 3000, '修車費'],
    });
  });

  it('自家的公司**不弹**（董事長的好处那一路根本不收费）', () => {
    const mine = onRivalCompany(INDUSTRY.sect);
    const owners = [...mine.commercialOwners];
    owners[CID] = { ...emptyOwnership(), owner: 1 }; // 玩家下标 0 → 自家
    const after = reduce({ ...mine, commercialOwners: owners }, { type: 'settle' }, companyTopo(INDUSTRY.sect));
    expect(after.lastNotice).toBeNull();
  });

  it('无主公司**不弹**（只问認購）', () => {
    const empty = onRivalCompany(INDUSTRY.sect);
    const owners = [...empty.commercialOwners];
    owners[CID] = emptyOwnership();
    const after = reduce({ ...empty, commercialOwners: owners }, { type: 'settle' }, companyTopo(INDUSTRY.sect));
    expect(after.lastNotice).toBeNull();
  });
});

// ============================================================
//  生命周期与确定性
// ============================================================

describe('★ 生命周期与确定性', () => {
  it('没弹框的 action **保持同一个引用**（客户端就是靠这个不起播的）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      lastNotice: { key: 'rent.payOneOwner', args: ['a', 'b', 1, '過路費'] },
    });
    // 一条被拒的 action（phase 不对）→ reduce 原样返回同一个对象
    const after = reduce(before, { type: 'buyLand' }, topo);
    expect(after).toBe(before);
    expect(after.lastNotice).toBe(before.lastNotice);
  });

  it('★ C-DET：它不进 `stateFingerprint`（改它不影响校验和）', () => {
    const after = settle(onRivalLand());
    expect(after.lastNotice).not.toBeNull();
    const base = stateFingerprint(after);
    // ⚠️ 得过一次变量：`stateFingerprint` 的形参是一张**显式字段表**，
    //   对象字面量直接多写一个字段会被 TS 的 excess property check 挡下。
    const blanked = { ...after, lastNotice: null };
    const other = { ...after, lastNotice: { key: 'rent.payBoss' as const, args: [9, 9] } };
    expect(stateFingerprint(blanked)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });

  it('★ 开局状态给的是 `null`（不会一进游戏就弹一个旧框）', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })] });
    expect(s.lastNotice).toBeNull();
  });
});
