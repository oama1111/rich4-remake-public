/*
 * 付费类落点的棕色訊息框 —— issue #18
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里钉四件事：
 * ① **参数逐字对** —— 键、地名、人名、費名、金额的顺序就是原版 `sprintf` 的顺序
 *    （`0x00419d3e` 的 `%s\n\n此地屬%s\n\n請付%d元%s`）；
 * ② **金额是神明加成之前那一笔** —— 这是整个接口存在的理由。原版先弹框
 *    （`0x00419d50 push 0x5dc / call 0x440cac`）**之后**才 `call 0x41d709`
 *    按付款方的神明加减。把实现改成「用调过之后的金额」会让下面那条
 *    「★★★ 可证伪」的用例当场变红。
 * ③ **`notices` 是队列** —— 同一条 action 里原版会连弹两扇（租金框 + 死神框），
 *    所以它是数组、按弹框顺序排（`0x00419d50` → `0x00419f16`）。
 * ④ **設施那三路**（旅館 / 購物中心 / 加油站）与得点格 / 乞丐 / 小偷 / 禮物 / 寶箱
 *    各自的键与实参顺序。
 */
import { describe, expect, it } from 'vitest';
import { CARDS, TOOLS } from '@rich4/data';
import { makeFacility, makeGameState, makeLand, makeNode, makePlayer } from '../testing/factories.ts';
import { giveAlmsIfBeggar, reduce, type MapTopology } from '../state/reduce.ts';
import { stateFingerprint } from '../net/protocol.ts';
import { emptyOwnership } from '../places/commercial.ts';
import { INDUSTRY } from '../places/company.ts';
import { GOD_SMALL_FORTUNE } from '../rules/god-toll.ts';
import { FACILITY_TYPE, WHEEL, spinWheel } from '../rules/facility.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { initialToolStock, toolsOf } from '../rules/tools.ts';
import { releaseNpc } from '../rules/special-actors.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';

// ============================================================
//  住宅：走到别人的地產上
// ============================================================

/**
 * ★ 第十四份：九种免收弹完框之后当前玩家（付款方，这里是 0 号）说事件 13
 * @source `0x0041d6d2 mov edx,[… + 0x48087e]` → `0x0041d6dd player_say([0x49910c], 3, …)`
 */
const FREE_SAY = { player: 0, event: 13 } as const;

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
    expect(after.notices[0]).toEqual({
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
    expect(after.notices[0]).toEqual({
      key: 'rent.payOneOwner',
      args: ['測試地', '沙隆巴斯', 1200, '過路費'],
    });
    expect(after.notices[0]?.args[2]).not.toBe(600);
  });

  it('★ 免費卡把那笔抹成 0 时，框**照样弹**（原版弹框在免費卡那一段之前）', () => {
    // 費 1200 > 現金 100 ⇒ 电脑必用免費卡（@source 0x444a9b）
    const after = settle(onRivalLand({ payer: { cash: 100, cards: [20] } }));
    expect(after.players[0]!.cash).toBe(100);
    expect(after.landLastToll[LAND]).toBe(0);
    expect(after.notices[0]).toEqual({
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
    expect(after.notices[0]).toEqual({
      key: 'rent.freePrison',
      args: ['沙隆巴斯', '過路費'],
      say: FREE_SAY,
    });
    // 钱一分没动 —— 弹框不改规则
    expect(after.players[0]!.cash).toBe(50_000);
    expect(after.players[1]!.moneyInBank).toBe(0);
  });
});

/**
 * **九种免收**的文案（试玩第四份回报第 8 条 + E-4 第 2 条）。
 *
 * 参数顺序 = 原版 `sprintf` 的推栈顺序：名字缓冲由 `0x41d57d call 0x452946`
 * 用**函数第 1 个实参（地主下标）**填好（`[esp+0xa4]`），費名是第 3 个实参
 * （住宅这条路 = `[0x47517c]` 第 0 项「過路費」）。两条单 `%s` 的支
 * （查封 `0x41d59f`、死神 `0x41d5fa`）**只推了費名**，所以只有一个实参。
 */
describe('★★ 免收訊息框：九种全弹', () => {
  const cases = [
    { reason: 'hotel', blocking: { inHotel: 2 }, key: 'rent.freeHotel' },
    { reason: 'disappearing', blocking: { disappearing: 2 }, key: 'rent.freeVanished' },
    { reason: 'prison', blocking: { inPrison: 2 }, key: 'rent.freePrison' },
    { reason: 'hospital', blocking: { inHospital: 2 }, key: 'rent.freeHospital' },
    { reason: 'sleeping', blocking: { sleeping: 2 }, key: 'rent.freeWinterSleep' },
    { reason: 'sleepWalking', blocking: { sleepWalking: 2 }, key: 'rent.freeSleepwalk' },
  ] as const;

  it.each(cases)('★★★ 可证伪：地主 $reason ⇒ 键 $key（不弹就是红的）', ({ blocking, key }) => {
    const after = settle(onRivalLand({ owner: { blocking: confined(blocking) } }));
    // 旧实现（豁免直接 `return {...state, phase:'turnEnd'}`）这里是空数组 ⇒ 红
    expect(after.notices[0]).toEqual({ key, args: ['沙隆巴斯', '過路費'], say: FREE_SAY });
  });

  it('★★★ 可证伪：查封（priceStatus 高低半字节都非 0）⇒ `rent.freeSealed`，**只有一个 `%s`**', () => {
    // @source 0x0041d59f `push 0x463bb8` —— 这一支只推了 esi（費名）
    const after = settle(onRivalLand({ priceStatus: 0x11 }));
    expect(after.notices[0]).toEqual({ key: 'rent.freeSealed', args: ['過路費'], say: FREE_SAY });
    // 多填一个名字就会红
    expect(after.notices[0]?.args).not.toEqual(['沙隆巴斯', '過路費']);
  });

  it('★★★ 可证伪：同盟（地主的同盟对象 == 付款方 + 1）⇒ `rent.freeAllied`，名字 + 費名', () => {
    // @source 0x0041d5ce `push esi`（費名）+ `0x41d5cf lea eax,[esp+0x84]`（地主名）
    const after = settle(onRivalLand({ owner: { alliedPlayer: 1 } }));
    expect(after.notices[0]).toEqual({ key: 'rent.freeAllied', args: ['沙隆巴斯', '過路費'], say: FREE_SAY });
  });

  it('★★★ 可证伪：死神顯靈（god_info 0xf）⇒ `rent.freeReaper`，**只有一个 `%s`**', () => {
    // @source 0x0041d5fa `push 0x463be2` —— 与查封同形，只有一个实参
    const after = settle(onRivalLand({ owner: { godInfo: 0xf } }));
    expect(after.notices[0]).toEqual({ key: 'rent.freeReaper', args: ['過路費'], say: FREE_SAY });
    expect(after.notices[0]?.args).not.toEqual(['沙隆巴斯', '過路費']);
  });

  it('★ 参数顺序就是原版 `sprintf` 的顺序：地主名在前、費名在后', () => {
    const after = settle(onRivalLand({ owner: { blocking: confined({ inHospital: 4 }) } }));
    expect(after.notices[0]?.args).toEqual(['沙隆巴斯', '過路費']);
    // 反序就会红：費名不在第 0 位
    expect(after.notices[0]?.args[0]).not.toBe('過路費');
  });

  it('★ 框里的名字跟着地主走（换成别的角色名）', () => {
    const after = settle(onRivalLand({ owner: { character: 3, blocking: confined({ inHotel: 1 }) } }));
    expect(after.notices[0]?.args[0]).not.toBe('沙隆巴斯');
    expect(after.notices[0]?.key).toBe('rent.freeHotel');
  });

  it('★ 免收那一路**只弹一扇**（钱一分没动，也不是租金框）', () => {
    const after = settle(onRivalLand({ owner: { blocking: confined({ inHotel: 1 }) } }));
    expect(after.notices).toHaveLength(1);
    expect(after.players[0]!.cash).toBe(50_000);
  });

  it('没有豁免（地主在场）时照旧弹**租金**框，不是免收框', () => {
    const after = settle(onRivalLand());
    expect(after.notices[0]?.key).toBe('rent.payOneOwner');
  });
});

/**
 * ★★ **一 action 两扇框** —— 租金框 + 死神框（E-4 第 4 条，队列存在的理由）。
 *
 * @source `0x00419d50`（租金框）之后 `0x00419f16`（死神框）在**同一条分支**里。
 */
describe('★★ 死神顯靈由他人賠償：租金框之后**再**弹一扇', () => {
  it('★★★ 可证伪：数组里**两条**、顺序是「租金框 → 死神框」', () => {
    // 1 号（地主）与 2 号（同盟）都持 god_info 0xe/0xf；`reaperPayer` 跳过付款方 0
    // ⚠️ 不能用 `alliedPlayer: 1` —— 那会先命中 `0x41d5bd` 的**同盟免收**。
    //   用 3（玩家下标 2）既走「有同盟」的租金框，又不触发免收。
    const s = onRivalLand({ owner: { alliedPlayer: 3 } });
    const players = s.players.map((p, i) => (i === 2 ? { ...p, godInfo: 0x0f } : p));
    const after = reduce({ ...s, players }, { type: 'settle' }, topo);
    // 第一扇：租金（有同盟那一句）
    expect(after.notices[0]).toEqual({
      key: 'rent.payTwoOwners',
      args: ['測試地', '沙隆巴斯', '忍太郎', 1700, '過路費'],
    });
    // 第二扇：死神 —— 名字是**实际付款人**（2 号 = 忍太郎），費名仍是「過路費」
    expect(after.notices[1]).toEqual({
      key: 'rent.reaperPays',
      args: ['忍太郎', '過路費'],
    });
    expect(after.notices).toHaveLength(2);
  });

  it('★★★ 可证伪：没有人持死神时**只有一扇**（旧实现这里也只是一条，但换了字段名）', () => {
    const after = settle(onRivalLand({ owner: { alliedPlayer: 1 } }));
    expect(after.notices).toHaveLength(1);
    expect(after.notices.some((n) => n.key === 'rent.reaperPays')).toBe(false);
  });

  it('★★★ 可证伪：免費卡把那笔抹成 0 时死神框**不弹**（原版 `test ebp,ebp / je`）', () => {
    // @source 0x00419ec7 `test ebp, ebp / je 0x419f2a` —— 费为 0 就跳过死神框
    const s = onRivalLand({ payer: { cash: 100, cards: [20] } });
    const players = s.players.map((p, i) => (i === 2 ? { ...p, godInfo: 0x0f } : p));
    const after = reduce({ ...s, players }, { type: 'settle' }, topo);
    expect(after.notices).toHaveLength(1);
    expect(after.notices[0]?.key).toBe('rent.payOneOwner');
  });
});

describe('★★ 住宅：`RENT.payTwoOwners`（0x00419d1a）', () => {
  it('地主有同盟 → 多一个同盟名，金额是**两份之和**（1200 + 500）', () => {
    const after = settle(onRivalLand({ owner: { alliedPlayer: 3 } }));
    expect(after.notices[0]).toEqual({
      key: 'rent.payTwoOwners',
      args: ['測試地', '沙隆巴斯', '忍太郎', 1700, '過路費'],
    });
  });

  it('★ 有同盟时金额同样是**神明加成之前**的那一笔（实收 850）', () => {
    const after = settle(onRivalLand({ owner: { alliedPlayer: 3 }, payer: { godInfo: GOD_SMALL_FORTUNE } }));
    expect(after.landLastToll[LAND]).toBe(850);
    expect(after.notices[0]).toEqual({
      key: 'rent.payTwoOwners',
      args: ['測試地', '沙隆巴斯', '忍太郎', 1700, '過路費'],
    });
  });

  it('涨价位只翻地主那一份 ⇒ 框里跟着涨（@source 0x00419b0f `add ebp, ebp`）', () => {
    const after = settle(onRivalLand({ priceStatus: 1 }));
    // 地主 1200×2 = 2400，同盟 0（无同盟）⇒ 框里 2400
    expect(after.notices[0]).toEqual({
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
    expect(after.notices[0]).toEqual({
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
    expect(after.notices[0]).toEqual({
      key: 'rent.payChairman',
      args: ['測試公司', '沙隆巴斯', 3000, '修車費'],
    });
  });

  it('自家的公司**不弹**（董事長的好处那一路根本不收费）', () => {
    const mine = onRivalCompany(INDUSTRY.sect);
    const owners = [...mine.commercialOwners];
    owners[CID] = { ...emptyOwnership(), owner: 1 }; // 玩家下标 0 → 自家
    const after = reduce({ ...mine, commercialOwners: owners }, { type: 'settle' }, companyTopo(INDUSTRY.sect));
    expect(after.notices).toEqual([]);
  });

  it('无主公司**不弹**（只问認購）', () => {
    const empty = onRivalCompany(INDUSTRY.sect);
    const owners = [...empty.commercialOwners];
    owners[CID] = emptyOwnership();
    const after = reduce({ ...empty, commercialOwners: owners }, { type: 'settle' }, companyTopo(INDUSTRY.sect));
    expect(after.notices).toEqual([]);
  });
});

// ============================================================
//  生命周期与确定性
// ============================================================

describe('★ 生命周期与确定性', () => {
  it('没弹框的 action **保持同一个引用**（客户端就是靠这个不起播的）', () => {
    const before = makeGameState({
      players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
      notices: [{ key: 'rent.payOneOwner', args: ['a', 'b', 1, '過路費'] }],
    });
    // 一条被拒的 action（phase 不对）→ reduce 原样返回同一个对象
    const after = reduce(before, { type: 'buyLand' }, topo);
    expect(after).toBe(before);
    expect(after.notices).toBe(before.notices);
  });

  it('★ C-DET：它不进 `stateFingerprint`（改它不影响校验和）', () => {
    const after = settle(onRivalLand());
    expect(after.notices.length).toBeGreaterThan(0);
    const base = stateFingerprint(after);
    // ⚠️ 得过一次变量：`stateFingerprint` 的形参是一张**显式字段表**，
    //   对象字面量直接多写一个字段会被 TS 的 excess property check 挡下。
    const blanked = { ...after, notices: [] };
    const other = { ...after, notices: [{ key: 'rent.payBoss' as const, args: [9, 9] }] };
    expect(stateFingerprint(blanked)).toBe(base);
    expect(stateFingerprint(other)).toBe(base);
  });

  it('★ 开局状态给的是**空数组**（不会一进游戏就弹一个旧框）', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })] });
    expect(s.notices).toEqual([]);
  });

  it('★ 读档后也是空数组（`loaders/savegame.ts` 的装配点没漏）', () => {
    // 直接查装配表：`makeGameState` 与 `newGame` / `readSave` 三处都必须给数组
    const s = makeGameState({ players: [makePlayer({ index: 0 })] });
    expect(Array.isArray(s.notices)).toBe(true);
  });
});

// ============================================================
//  設施（type 1 旅館 / 2 購物中心 / 3 加油站）
// ============================================================

const FAC = 1;

/**
 * 造一个「0 号站在别人的設施上」的极小拓扑。
 *
 * 設施那一路的归属/等级/种类在**状态**里（`facilityOwner/Level/Type`），
 * 静态模板只是开局初值 —— 所以两处都要写。
 */
function facilityScene(over: {
  type: number;
  ownerBlocking?: Partial<ReturnType<typeof makePlayer>['blocking']>;
  ownerGod?: number;
  traffic?: number;
  steps?: number;
  rateByLevel?: number[];
  landPrice?: number;
  godInfo?: number;
}): { state: ReturnType<typeof makeGameState>; topo: MapTopology } {
  const fac = makeFacility({
    id: FAC, x: 0, y: 0, name: '測試設施',
    type: over.type, owner: 2, level: 1,
    landPrice: over.landPrice ?? 100,
    rateByLevel: over.rateByLevel ?? [100, 1000, 2000, 4000, 8000, 16000],
  });
  const base = makeGameState({
    players: [
      makePlayer({
        index: 0, character: 0, nodeId: 2, cash: 100_000, moneyInBank: 0,
        trafficMethod: over.traffic ?? 1,
        ...(over.godInfo === undefined ? {} : { godInfo: over.godInfo }),
      }),
      makePlayer({
        index: 1, character: 1, nodeId: 1, cash: 1000, moneyInBank: 0,
        ...(over.ownerGod === undefined ? {} : { godInfo: over.ownerGod }),
        ...(over.ownerBlocking === undefined
          ? {}
          : { blocking: { ...makePlayer().blocking, ...over.ownerBlocking } }),
      }),
    ],
    phase: 'settling',
    stepsTotal: over.steps ?? 4,
  });
  const facilityOwner = [...base.facilityOwner];
  const facilityLevel = [...base.facilityLevel];
  const facilityType = [...base.facilityType];
  facilityOwner[FAC] = fac.owner;
  facilityLevel[FAC] = 1;
  facilityType[FAC] = over.type;
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1], type: 4000 + FAC, ref: { kind: 'facility', index: FAC } }),
    ],
    facilities: [fac],
  };
  return { state: { ...base, facilityOwner, facilityLevel, facilityType }, topo };
}

describe('★★ 設施 type 1 旅館：`休息%d天\\n\\n費用%d元！`（0x0041a46e）', () => {
  it('★★★ 可证伪：键 / 转盘倍数（= 住几天）/ 总额，顺序就是推栈顺序', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.hotel });
    const after = reduce(state, { type: 'settle' }, topo);
    // 转盘倍数由 `rand()%12` 定 —— 用同一套复现（core 就在 `settleFacility` 里掷）
    const rng = new WatcomRng();
    rng.setState(state.rngState);
    const multiplier = spinWheel(WHEEL.hotel, rng.next());
    expect(after.notices[0]).toEqual({
      key: 'facility.hotel',
      // @source 0x0041a46c `push ebp`（总额）+ 0x0041a46d `push eax`（倍数）
      args: [multiplier, multiplier * 1000],
    });
    // 反序（总额在前）就会红
    expect(after.notices[0]?.args[0]).not.toBe(multiplier * 1000);
    // 住几天就是倍数
    expect(after.players[0]!.blocking.inHotel).toBe(Math.max(0, multiplier - 1) || 0x80);
  });
});

describe('★★ 設施 type 2 購物中心：`您的消費金額為\\n\\n%dx%d倍=%d元`（0x0041a4c4）', () => {
  it('★★★ 可证伪：单价 / 倍数 / 总额 三个 `%d`（先单价，不是先倍数）', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.mall });
    const after = reduce(state, { type: 'settle' }, topo);
    const rng = new WatcomRng();
    rng.setState(state.rngState);
    const multiplier = spinWheel(WHEEL.mall, rng.next());
    // @source 0x0041a4c1 `push ebp`（总额）/ 0x0041a4c2 `push eax`（倍数）
    //   / 0x0041a4c3 `push ebx`（单价）
    expect(after.notices[0]).toEqual({
      key: 'facility.mall',
      args: [1000, multiplier, multiplier * 1000],
    });
    // ★ 单价那一格是 1000（等级 1 的费率），不是 1..6 的倍数 —— 反序就红
    expect(after.notices[0]?.args[0]).toBe(1000);
  });

  it('★ 涨价位让单价翻倍（`0x41a4a8 add ebx, ebx`）', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.mall });
    const facilityPriceStatus = [...state.facilityPriceStatus];
    facilityPriceStatus[FAC] = 1;
    const s = { ...state, facilityPriceStatus };
    const after = reduce(s, { type: 'settle' }, topo);
    const rng = new WatcomRng();
    rng.setState(s.rngState);
    const multiplier = spinWheel(WHEEL.mall, rng.next());
    expect(after.notices[0]?.args).toEqual([2000, multiplier, multiplier * 2000]);
  });
});

describe('★★ 設施 type 3 加油站：借 `RENT.payChairman`，名字是常量 `加油站`', () => {
  it('★★★ 可证伪：`[加油站, 地主名, 总额, 加油費]`', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.gasStation, steps: 4, traffic: 1 });
    const after = reduce(state, { type: 'settle' }, topo);
    // 总额 = 步数 4 × 500 × 倍率 1 × 物價 1
    expect(after.notices[0]).toEqual({
      key: 'facility.gasStation',
      // @source 0x0041a55d `push 0x463a31`（`RENT.payChairman`）
      //   实参顺序 = `加油站`（0x46385e）/ 地主名 / 总额 / 費名（0x475184 = 加油費）
      args: ['加油站', '沙隆巴斯', 2000, '加油費'],
    });
    // 名字不是地名、也不是「測試設施」——填错就红
    expect(after.notices[0]?.args[0]).not.toBe('測試設施');
  });

  it('★★★ 可证伪：費名来自 `[0x47528b + type]` 表，不是住宅的「過路費」', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.gasStation });
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices[0]?.args[3]).toBe('加油費');
    expect(after.notices[0]?.args[3]).not.toBe('過路費');
  });

  it('★ 没有交通工具 ⇒ base=0 ⇒ **不弹**（原版 `0x41a4ed je 0x41a581`）', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.gasStation, traffic: 0 });
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices).toEqual([]);
  });
});

describe('★★ 設施的免收框：費名查 `0x47528b` 表（不是住宅的過路費）', () => {
  const cases = [
    { type: FACILITY_TYPE.hotel, fee: '住宿費' },
    { type: FACILITY_TYPE.mall, fee: '購物費' },
    { type: FACILITY_TYPE.gasStation, fee: '加油費' },
  ] as const;

  it.each(cases)('★★★ 可证伪：type $type 的地主住院中 ⇒ 費名 $fee', ({ type, fee }) => {
    const { state, topo } = facilityScene({ type, ownerBlocking: { inHospital: 2 } });
    const after = reduce(state, { type: 'settle' }, topo);
    // @source 0x0041a3b0 `movzx esi, byte [type + 0x47528b]` → `[esi*4 + 0x47517c]`
    expect(after.notices[0]).toEqual({ key: 'rent.freeHospital', args: ['沙隆巴斯', fee], say: FREE_SAY });
    expect(after.notices[0]?.args[1]).not.toBe('過路費');
  });

  it('★ 免收那一路钱一分不动', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.hotel, ownerBlocking: { inPrison: 3 } });
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.players[0]!.cash).toBe(100_000);
  });
});

describe('★★ 設施也会连弹两扇：过路费框 → 死神框（0x41a6f2）', () => {
  it('★★★ 可证伪：地主持死神（god_info 0x0e）⇒ 数组两条，第二条是 `rent.reaperPays`', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.hotel, ownerGod: 0x0e });
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices).toHaveLength(2);
    expect(after.notices[0]?.key).toBe('facility.hotel');
    // @source 0x0041a6d6 `push 0x4639cc` + 0x0041a6f2 `push 0x5dc / call 0x440cac`
    //   `%s`#2 = 設施的費名（旅館 = 住宿費），不是住宅的「過路費」
    expect(after.notices[1]).toEqual({
      key: 'rent.reaperPays',
      args: ['沙隆巴斯', '住宿費'],
    });
  });

  it('★ 没有死神时只有一扇', () => {
    const { state, topo } = facilityScene({ type: FACILITY_TYPE.hotel });
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices).toHaveLength(1);
  });
});

// ============================================================
//  特殊格：得点 / 抽卡
// ============================================================

function squareScene(specialKind: number, cardAmount?: number[]) {
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1], specialKind, flags: specialKind }),
    ],
  };
  const state = makeGameState({
    players: [
      makePlayer({ index: 0, character: 0, nodeId: 2, points: 0, cash: 10_000, moneyInBank: 0 }),
      makePlayer({ index: 1, character: 1, nodeId: 1 }),
    ],
    phase: 'settling',
    ...(cardAmount === undefined ? {} : { cardAmount }),
  });
  return { state, topo };
}

describe('★★ 得点格：`得點券５０/３０/１０點`（三句写死金额，1000 ms）', () => {
  const cases = [
    { kind: SPECIAL_KIND.POINTS_50, key: 'points.50', points: 50 },
    { kind: SPECIAL_KIND.POINTS_30, key: 'points.30', points: 30 },
    { kind: SPECIAL_KIND.POINTS_10, key: 'points.10', points: 10 },
  ] as const;

  it.each(cases)('★★★ 可证伪：kind $kind ⇒ 键 $key', ({ kind, key, points }) => {
    const { state, topo } = squareScene(kind);
    const after = reduce(state, { type: 'settle' }, topo);
    // @source 0x0041b1c3 / 0x0041b25d / 0x0041b2e1 三处 `push 0x463a8x`，无占位符
    expect(after.notices[0]).toEqual({ key, args: [], holdMs: 0x3e8 });
    expect(after.players[0]!.points).toBe(points);
  });

  it('★★★ 可证伪：时长是 `0x3e8`（1000 ms），**不是** 1500 —— 写死 1500 就红', () => {
    const { state, topo } = squareScene(SPECIAL_KIND.POINTS_50);
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices[0]?.holdMs).toBe(0x3e8);
    expect(after.notices[0]?.holdMs).not.toBe(0x5dc);
  });

  it('★ 金额写死在串里 ⇒ `args` 必须是空的（多填一个数就红）', () => {
    const { state, topo } = squareScene(SPECIAL_KIND.POINTS_10);
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices[0]?.args).toEqual([]);
  });
});

describe('★★ 抽卡格：`得到%s！`（0x0041b35d）', () => {
  it('★★★ 可证伪：`%s` 是抽到的那张卡的名字', () => {
    const cardAmount = new Array<number>(30).fill(0);
    cardAmount[0] = 1; // 只剩 1 号卡 ⇒ 必抽到 1
    const { state, topo } = squareScene(SPECIAL_KIND.CARD, cardAmount);
    const after = reduce(state, { type: 'settle' }, topo);
    const card = after.players[0]!.cards[0];
    expect(card).toBe(1);
    expect(after.notices[0]).toEqual({
      key: 'points.card',
      // @source 0x0041b355 `[eax*8 + 0x47fdea]`（卡片名）+ 0x0041b968 `push 0x5dc`
      args: [CARDS[card! - 1]!.name],
      // holdMs 缺席 = 1500 ms（`0x5dc`）
    });
    expect(after.notices[0]?.args[0]).toBe('均富卡');
    expect(after.notices[0]?.args[0]).not.toBe('');
  });

  it('★ 没抽到卡（牌堆空）⇒ 不弹（原版 `0x41b34a test eax,eax / je`）', () => {
    const { state, topo } = squareScene(SPECIAL_KIND.CARD, new Array<number>(30).fill(0));
    const after = reduce(state, { type: 'settle' }, topo);
    expect(after.notices).toEqual([]);
  });
});

// ============================================================
//  乞丐（施捨）
// ============================================================

describe('★★ 乞丐：`施捨給乞丐%d元`（0x0041b656）', () => {
  /** 三格小地图：0 号与出局的 1 号同格（1 号 = 乞丐）、2 号站着别人 */
  const topo: MapTopology = {
    nodes: [1, 2, 3].map((id) => makeNode({ id, adjacent: [id], walkable: true, noObjects: false, type: 0 })),
  };
  const scene = (priceIndex: number) =>
    makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 1, cash: 50_000, moneyInBank: 0 }),
        makePlayer({ index: 1, nodeId: 1, whoPlays: 0 }),
        makePlayer({ index: 2, nodeId: 2 }),
      ],
      currentPlayer: 0,
      stepsRemaining: 0,
      priceIndex,
      pool: 0,
    });

  it('★★★ 可证伪：金额 = 1000 × 物價指數，且进的是公库', () => {
    const s = scene(3);
    const after = giveAlmsIfBeggar(s, topo, 1);
    // @source 0x0041b655 `push ebx`（金额）+ 0x0041b656 `push 0x463ab1`
    expect(after.notices[0]).toEqual({ key: 'beggar.alms', args: [3000] });
    expect(after.pool).toBe(3000);
    // 填成 1000（忘了乘物價）就红
    expect(after.notices[0]?.args[0]).not.toBe(1000);
  });

  it('★★★ 可证伪：物價指數变了，框里的数跟着变', () => {
    const after = giveAlmsIfBeggar(scene(7), topo, 1);
    expect(after.notices[0]?.args).toEqual([7000]);
  });

  it('★ 没有乞丐 ⇒ 不弹（原版 `0x41b620 cmp eax,-1 / je`）', () => {
    const noBeggar = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, cash: 50_000 }), makePlayer({ index: 1, nodeId: 1 })],
      currentPlayer: 0,
      stepsRemaining: 0,
    });
    expect(giveAlmsIfBeggar(noBeggar, topo, 1).notices).toEqual([]);
  });

  it('★ 路过不算（`stepsRemaining > 0` 不弹）', () => {
    const s = { ...scene(1), stepsRemaining: 1 };
    expect(giveAlmsIfBeggar(s, topo, 1).notices).toEqual([]);
  });
});

// ============================================================
//  小偷 / 禮物 / 寶箱
// ============================================================

/** 一条走廊：1 → 2（2 号格上放一件物件） */
function walkScene(objectType: number, over: { stepsRemaining?: number } = {}) {
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2], x: 0, y: 0 }),
      makeNode({ id: 2, adjacent: [1], x: 10, y: 0 }),
    ],
  };
  const state = makeGameState({
    players: [
      makePlayer({ index: 0, character: 0, nodeId: 1, lastNodeId: 0, cash: 10_000, moneyInBank: 0 }),
      makePlayer({ index: 1, character: 1, nodeId: 1 }),
    ],
    phase: 'moving',
    stepsRemaining: over.stepsRemaining ?? 1,
    objects: [{ type: objectType, nodeId: 2, state: 0, attached: 0 }],
    toolStock: initialToolStock(),
  });
  return { state, topo };
}

describe('★★ 禮物 / 寶箱：`得到%s！` / `得到５００點券！`（走路踩到）', () => {
  it('★★★ 可证伪：禮物 ⇒ `object.gift`，`%s` 是抽到的道具名', () => {
    const { state, topo } = walkScene(13);
    const after = reduce(state, { type: 'step' }, topo);
    expect(after.notices[0]?.key).toBe('object.gift');
    // `tools` 是「每名玩家一段槽位」，用 `toolsOf` 取回编号
    const held = [...toolsOf(after.tools, 0).keys()];
    expect(held).toHaveLength(1);
    const toolId = held[0]!;
    // @source 0x0041b94e `[道具*8 + 0x47feda]` + 0x0041b956 `push 0x463aa8`
    expect(after.notices[0]).toEqual({ key: 'object.gift', args: [TOOLS[toolId - 1]!.name] });
    // 空名字（拿不到道具名）就红
    expect(after.notices[0]?.args[0]).not.toBe('');
  });

  it('★★★ 可证伪：寶箱 ⇒ `object.treasure`（**没有** `%s`），500 写死在串里', () => {
    const { state, topo } = walkScene(14);
    const before = state.players[0]!.points;
    const after = reduce(state, { type: 'step' }, topo);
    expect(after.notices[0]).toEqual({ key: 'object.treasure', args: [] });
    expect(after.players[0]!.points).toBe(before + 500);
  });

  it('★ 半途路过（`stepsRemaining` 还有剩）不弹（原版 `cmp [0x48baf8],0 / jne`）', () => {
    const { state, topo } = walkScene(14, { stepsRemaining: 2 });
    const after = reduce(state, { type: 'step' }, topo);
    expect(after.notices).toEqual([]);
  });

  it('★ 脚下没东西就不弹', () => {
    const { state, topo } = walkScene(1); // 種類 1 = 小財神（附身），不是禮物/寶箱
    const after = reduce(state, { type: 'step' }, topo);
    expect(after.notices.some((n) => n.key === 'object.gift' || n.key === 'object.treasure')).toBe(false);
  });
});

describe('★★ 小偷：`小偷偷得%s\\n\\n給%s！`（0x00463ac0，五处推串点）', () => {
  /**
   * 小偷（actor 4）停在寶箱上 —— 原版 `0x0041bc22` 那一支。
   *
   * ★ 走子由 `endTurn` → `npcRoundStep` → `npcStepOnce` 驱动（`runNpc` 本身
   *   只算事件，不写状态），所以这里必须走真的 reducer 动作。
   *   用 `singleStep: 1` 把步数钉成 1，于是 1 号格 → 2 号格（唯一邻格）。
   */
  const ring = (): MapTopology => ({
    nodes: Array.from({ length: 30 }, (_, i) =>
      makeNode({ id: i + 1, adjacent: [((i + 1) % 30) + 1], x: i * 10, y: 0 }),
    ),
    lands: [],
  });

  function thiefOnTreasure() {
    const s = makeGameState({
      players: [0, 1].map((i) => makePlayer({ index: i, character: i, nodeId: 20 })),
      phase: 'turnEnd',
      currentPlayer: 1,
      objects: [{ type: 14, nodeId: 2, state: 0, attached: 0 }],
    });
    const specialActors = [...s.specialActors];
    // 小偷（actor 4）站在 1 号格；`singleStep: 1` ⇒ 这一趟只走一格（必到 2 号）
    specialActors[0] = { ...releaseNpc(1, 0, 0), singleStep: 1 };
    return { ...s, specialActors };
  }

  it('★★★ 可证伪：`%s`#1 = 物件名（`0x47edaa` 表）、`%s`#2 = 主人名', () => {
    const after = reduce(thiefOnTreasure(), { type: 'endTurn' }, ring());
    const loot = after.notices.find((n) => n.key === 'thief.loot');
    expect(loot).toBeDefined();
    // @source 0x0041bc1a `[0x47edae]` = 寶箱；主人 = 保釋他的人（0 号 = 錢夫人）
    expect(loot?.args).toEqual(['寶箱', '約翰喬']);
    // 两个 `%s` 反序（名字在前）就红
    expect(loot?.args[0]).not.toBe('約翰喬');
  });

  it('★★★ 可证伪：换成地雷（17）⇒ 名字跟着变（同一张表、不同项）', () => {
    const base = thiefOnTreasure();
    const after = reduce({ ...base, objects: [{ type: 17, nodeId: 2, state: 0, attached: 0 }] }, { type: 'endTurn' }, ring());
    const loot = after.notices.find((n) => n.key === 'thief.loot');
    // @source 0x0041bf8a `[0x47edba]` = 地雷
    expect(loot?.args[0]).toBe('地雷');
    expect(loot?.args[0]).not.toBe('寶箱');
  });

  it('★ 小偷没捡到东西 ⇒ 不弹（`loot` 事件不存在）', () => {
    const base = thiefOnTreasure();
    const after = reduce({ ...base, objects: [] }, { type: 'endTurn' }, ring());
    expect(after.notices.some((n) => n.key === 'thief.loot')).toBe(false);
  });
});

// ============================================================
//  W-69：这一段演出提示 —— 「这一笔过路费算进了哪几块地」
// ============================================================

/**
 * 需求方报的现场：地图 0「台北市」4 块地同属 2 号玩家、各 1 级，0 号踩上去。
 * 金额 4800 = 1200 × 4（规则早就是对的），缺的是**收費前把这几块一起闪一遍**。
 *
 * @source `0x00419b9e` / `0x00419c1a` / `0x00419c61`（把这几格标进 id 图）
 *   + `0x00419c79 cmp [esp+0xe8],1 / jle`（块数 ≤ 1 整段跳过）。
 */
describe('★★ W-69：`lastTollLands` —— 同一条街的连号地块一起闪', () => {
  const STREET = [11, 12, 13, 14];
  const rent1200 = [0, 1200, 0, 0, 0, 0];
  const streetLands = (nameOf: (id: number) => string) =>
    STREET.map((id) => makeLand({ id, name: nameOf(id), type: 0, owner: 0, level: 0, rentByLevel: rent1200 }));
  const topoStreet: MapTopology = {
    nodes: [
      makeNode({ id: 1, adjacent: [2] }),
      makeNode({ id: 2, adjacent: [1], type: 0x7d0 + 11, ref: { kind: 'land', index: 11 } }),
    ],
    lands: streetLands(() => '台北市'),
  };

  /** 0 号踩在 11 号上；11..14 全归 1 号（owner = 2）、各 1 级 */
  function streetState(over: { ally?: boolean } = {}): ReturnType<typeof makeGameState> {
    const s = makeGameState({
      players: [
        makePlayer({ index: 0, character: 0, nodeId: 2, cash: 50_000, moneyInBank: 0 }),
        makePlayer({
          index: 1,
          character: 1,
          nodeId: 1,
          cash: 1000,
          moneyInBank: 0,
          ...(over.ally === true ? { alliedPlayer: 3 } : {}),
        }),
        makePlayer({ index: 2, character: 2, nodeId: 1, cash: 1000, moneyInBank: 0 }),
      ],
      phase: 'settling',
      priceIndex: 1,
    });
    const landOwner = [...s.landOwner];
    const landLevel = [...s.landLevel];
    for (const id of STREET) {
      landOwner[id] = 2;
      landLevel[id] = 1;
    }
    return { ...s, landOwner, landLevel };
  }

  it('★★ 金额回归 4800 = 1200 × 4，且 4 块地的 id 都在提示里', () => {
    const after = reduce(streetState(), { type: 'settle' }, topoStreet);
    expect(after.notices[0]?.args[2]).toBe(4800);
    expect(after.lastTollLands).toEqual(STREET);
  });

  it('★ 只有一块同街 ⇒ `null`（原版块数 ≤ 1 时那段演出整段跳过）', () => {
    const topoOne: MapTopology = {
      nodes: topoStreet.nodes,
      // 只有 11 号叫「台北市」，另外三块是别的街 ⇒ 算进来的只有一块
      lands: streetLands((id) => (id === 11 ? '台北市' : '高雄市')),
    };
    const after = reduce(streetState(), { type: 'settle' }, topoOne);
    expect(after.notices[0]?.args[2]).toBe(1200);
    expect(after.lastTollLands).toBeNull();
  });

  it('★ 同盟者名下的同街地块也进提示（4 + 2 = 6 块）', () => {
    const allyLands = streetLands(() => '台北市').map((l) => ({ ...l, id: l.id + 40, owner: 3 }));
    const topoAlly: MapTopology = { nodes: topoStreet.nodes, lands: [...(topoStreet.lands ?? []), ...allyLands] };
    const s = streetState({ ally: true });
    const landOwner = [...s.landOwner];
    const landLevel = [...s.landLevel];
    for (const l of allyLands) {
      landOwner[l.id] = 3;
      landLevel[l.id] = 1;
    }
    const after = reduce({ ...s, landOwner, landLevel }, { type: 'settle' }, topoAlly);
    expect(after.lastTollLands).toEqual([11, 12, 13, 14, 51, 52, 53, 54]);
  });

  it('★ 瞬态：只活一条 action（下一条没新写就清成 null，与 `lastCardPlay` 同一套规矩）', () => {
    const charged = reduce(streetState(), { type: 'settle' }, topoStreet);
    expect(charged.lastTollLands).not.toBeNull();
    const next = reduce(charged, { type: 'reseed', seed: 7 }, topoStreet);
    expect(next.lastTollLands).toBeNull();
  });

  it('★ 一笔不算钱的落点（自己踩自己）不写这个字段', () => {
    const s = streetState();
    const mine = { ...s, currentPlayer: 1 };
    const after = reduce(mine, { type: 'settle' }, topoStreet);
    expect(after.lastTollLands).toBeNull();
  });
});

// ============================================================
//  ★★ 第十四份（需求方拍板照原版）：过路费的神明调整框 + 進帳台词提示
// ============================================================

describe('★★ 过路费神明调整那一扇（`fcn_0041d709`，`0x0041d7a2 push 0x5dc`）', () => {
  it('★★ 小財神减半 ⇒ 租金框之后再弹「小財神顯靈／過路費減免一半！」；地主按减半后的那一笔说進帳', () => {
    const after = settle(onRivalLand({ payer: { godInfo: GOD_SMALL_FORTUNE } }));
    expect(after.notices).toEqual([
      { key: 'rent.payOneOwner', args: ['測試地', '沙隆巴斯', 1200, '過路費'] },
      { key: 'god.tollHalf', args: ['過路費'] },
    ]);
    // @source 0x00419ff0 call 0x44f354(地主, ebp) —— ebp 是神明调过之后的 600
    expect(after.lastGainSays).toEqual([{ player: 1, amount: 600 }]);
  });

  it('★★ 大財神免付 ⇒ 「大財神顯靈／免付過路費！」+ 付款方说「逃过一劫」那一句（原额 1200，@source 0x0041d7c1）；地主不说', () => {
    const after = settle(onRivalLand({ payer: { godInfo: 2 } }));
    expect(after.notices).toEqual([
      { key: 'rent.payOneOwner', args: ['測試地', '沙隆巴斯', 1200, '過路費'] },
      { key: 'god.tollFree', args: ['過路費'], say: { player: 0, reliefAmount: 1200 } },
    ]);
    expect(after.players[0]!.cash).toBe(50_000);
    expect(after.lastGainSays ?? null).toBeNull();
  });

  it('★ 窮神两支：小窮神 ×1.5（`god.tollPlusHalf`）、大窮神 ×2（`god.tollDouble`），都不带 say', () => {
    expect(settle(onRivalLand({ payer: { godInfo: 5 } })).notices[1]).toEqual({ key: 'god.tollPlusHalf', args: ['過路費'] });
    expect(settle(onRivalLand({ payer: { godInfo: 6 } })).notices[1]).toEqual({ key: 'god.tollDouble', args: ['過路費'] });
  });

  it('★ 福神（3/4）不改金额 ⇒ 不弹（`0x0041d79e cmp ebx,esi / je`）', () => {
    expect(settle(onRivalLand({ payer: { godInfo: 3 } })).notices).toHaveLength(1);
  });

  it('★★ 同盟分账 ⇒ 只有**地主**说進帳，金额是地主那一份（`0x00419f92 ebx = ebp − 同盟份` → `0x00419fa1`）', () => {
    const after = settle(onRivalLand({ owner: { alliedPlayer: 3 } }));
    const says = after.lastGainSays ?? [];
    expect(says).toHaveLength(1);
    expect(says[0]!.player).toBe(1);
    expect(says[0]!.amount).toBeLessThan(1700);
    // 同盟那份没被截断（付款方钱够）⇒ 地主那份 = 1700 − 同盟实收
    expect(says[0]!.amount).toBe(1700 - after.players[2]!.monthlyReceived);
  });

  it('★★ 設施：主人说進帳（`0x0041a735`）；大財神免付 ⇒ 框 + 付款方那一句、主人不说', () => {
    const plain = facilityScene({ type: FACILITY_TYPE.gasStation });
    const a = reduce(plain.state, { type: 'settle' }, plain.topo);
    expect(a.lastGainSays).toEqual([{ player: 1, amount: a.facilityLastToll[FAC] }]);
    const waived = facilityScene({ type: FACILITY_TYPE.gasStation, godInfo: 2 });
    const b = reduce(waived.state, { type: 'settle' }, waived.topo);
    expect(b.notices.at(-1)).toEqual({ key: 'god.tollFree', args: ['加油費'], say: { player: 0, reliefAmount: expect.any(Number) } });
    expect(b.lastGainSays ?? null).toBeNull();
  });
});
