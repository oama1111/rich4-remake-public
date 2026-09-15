/*
 * 個人資產表屏的版式（T-022）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 exe（VA 0x423cf3 / 0x422443 / 0x4232f3），这里把容易写错、且
 * **先前真写错过**的几条钉住：
 *   - 那两排「数值」其实是两张清单的**列名**（y=112 五列 / y=68 三列），
 *     视图 0 的八条字段值在 x=330 / x=602 的 28 号右对齐字上；
 *   - 三颗钮的文字 y 起点是 **302**（= 282+20），不是 303；
 *   - 页签 88 宽、步进 88，名字画在 `x+44`。
 */
import { describe, expect, it } from 'vitest';
import type { GameState, MapTopology, Player } from '@rich4/core';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '@rich4/core';
import { stocksOfMap } from '@rich4/data';
import {
  SHEET_BTN_LABELS,
  SHEET_COUNT_Y,
  SHEET_EXIT_HIT,
  SHEET_KINDS,
  SHEET_KIND_CELL,
  SHEET_LABEL_AT,
  SHEET_LABELS,
  SHEET_LIST0_HEADER,
  SHEET_LIST0_X,
  SHEET_LIST0_Y,
  SHEET_LIST1_HEADER,
  SHEET_LIST1_X,
  SHEET_LIST1_Y,
  SHEET_TAB,
  SHEET_VALUE_X,
  SHEET_VALUE_Y,
  SHEET_VIEW_COUNT,
  activePlayers,
  assetRows,
  estatePageAfter,
  hitSheetArrow,
  hitSheetBtn,
  hitSheetExit,
  hitSheetKind,
  hitSheetTab,
  sheetBtnRect,
  sheetCell,
  sheetCounts,
  sheetValues,
  stockRows,
  tenureText,
} from './asset-sheet.ts';

describe('個人資產表屏的版式 @source VA 0x423cf3', () => {
  it('★ 三颗下钻钮各 97×40、步进 64，互不重叠且都在屏内', () => {
    expect(SHEET_VIEW_COUNT).toBe(3);
    expect([...SHEET_BTN_LABELS]).toEqual(['資產清單', '地產清單', '股票清單']);
    for (let i = 0; i < SHEET_VIEW_COUNT; i++) {
      const r = sheetBtnRect(i);
      expect(r).toEqual({ x: 12, y: 282 + i * 64, w: 97, h: 40 });
      expect(r.y + r.h).toBeLessThanOrEqual(480);
      expect(hitSheetBtn(r.x + r.w / 2, r.y + r.h / 2)).toBe(i);
      if (i + 1 < SHEET_VIEW_COUNT) expect(r.y + r.h).toBeLessThanOrEqual(sheetBtnRect(i + 1).y);
    }
    expect(hitSheetBtn(2, 300)).toBeNull();
    expect(hitSheetBtn(120, 300)).toBeNull();
  });

  it('★ 12 个标签：左列 4 条 / 右列 4 条 / 第三列 4 条，全在屏内', () => {
    expect(SHEET_LABELS).toHaveLength(12);
    expect(SHEET_LABEL_AT).toHaveLength(12);
    expect([...SHEET_LABELS.slice(0, 4)]).toEqual(['現  金', '存  款', '貸  款', '總資產']);
    expect([...SHEET_LABELS.slice(4, 8)]).toEqual(['股  票', '點  卷', '保險期', '企  業']);
    expect([...SHEET_LABELS.slice(8)]).toEqual(['土  地', '連鎖店', '房  屋', '設  施']);
    for (const at of SHEET_LABEL_AT) {
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(640);
      expect(at.y).toBeGreaterThan(0);
      expect(at.y).toBeLessThan(480);
    }
    expect(SHEET_LABEL_AT.filter((a) => a.x === 0x8e)).toHaveLength(8);
    expect(SHEET_LABEL_AT.filter((a) => a.x === 0x1ae)).toHaveLength(4);
  });

  it('★ 八条字段值：左列右对齐 x=330、右列 x=602，四行 y=88/136/184/232、28 号字', () => {
    expect(SHEET_VALUE_X).toEqual({ left: 330, right: 602 });
    expect([...SHEET_VALUE_Y]).toEqual([88, 136, 184, 232]);
    expect([...SHEET_COUNT_Y]).toEqual([296, 344, 392, 440]);
  });

  it('★ 两排「表头」是**清单的列名**，不是字段值', () => {
    // 地產清單：5 列、y=112、x 取自 0x475454 = [168,264,356,448,540]
    expect([...SHEET_LIST0_X]).toEqual([168, 264, 356, 448, 540]);
    expect(SHEET_LIST0_Y).toBe(112);
    expect([...SHEET_LIST0_HEADER]).toEqual(['地  點', '開發狀況', '價  格', '收  費', '租  期']);
    // 股票清單：3 列、y=68、x 取自 0x47545e = [204,332,476]
    expect([...SHEET_LIST1_X]).toEqual([204, 332, 476]);
    expect(SHEET_LIST1_Y).toBe(68);
    expect([...SHEET_LIST1_HEADER]).toEqual(['股票名稱', '持有張數', '總 市 價']);
  });

  it('★ EXIT 命中框 x∈[492,602]、y∈[9,38]（原版是按下/抬起两段）', () => {
    expect(SHEET_EXIT_HIT).toEqual({ x: 492, y: 9, w: 111, h: 30 });
    expect(hitSheetExit(547, 23)).toBe(true);
    expect(hitSheetExit(491, 23)).toBe(false);
    expect(hitSheetExit(547, 39)).toBe(false);
  });

  it('★ 顶栏页签：88 宽、步进 88、命中高 34；名字画在 x+44', () => {
    expect(SHEET_TAB.x0).toBe(16);
    expect(SHEET_TAB.pitch).toBe(88);
    expect(SHEET_TAB.w).toBe(88);
    expect(SHEET_TAB.nameDx).toBe(44);
    expect(hitSheetTab(20, 30, 4)).toBe(0);
    expect(hitSheetTab(103, 30, 4)).toBe(0); // 最后一列像素仍属本格
    expect(hitSheetTab(104, 30, 4)).toBe(1); // 页签**紧排**，中间没有缝
    expect(hitSheetTab(9, 30, 4)).toBeNull(); // 16 之前不属于任何页签
    expect(hitSheetTab(20, 50, 4)).toBeNull(); // 出了命中高度
    // 只有 2 个在场玩家时，第 3 格不认
    expect(hitSheetTab(200, 30, 2)).toBeNull();
  });

  it('★ 15 格栏位：每行 5 格、步进 72/32（原版 x>588 换行）', () => {
    expect(sheetCell(0, 281)).toEqual({ x: 300, y: 281 });
    expect(sheetCell(4, 281)).toEqual({ x: 588, y: 281 });
    expect(sheetCell(5, 281)).toEqual({ x: 300, y: 313 });
    expect(sheetCell(14, 385)).toEqual({ x: 588, y: 449 });
  });
});

describe('按现场算出来的字（数据全部来自 core）', () => {
  const topo = { nodes: [], lands: [], facilities: [], commercials: [] } as unknown as MapTopology;

  /** 只填这一屏用得到的字段 */
  function player(over: Partial<Player> & { index: number }): Player {
    return {
      character: over.index,
      whoPlays: WHO_PLAYS_HUMAN,
      cash: 0,
      moneyInBank: 0,
      loan: 0,
      points: 0,
      insuranceDays: 0,
      cards: [],
      ...over,
    } as Player;
  }

  const stateOf = (players: Player[], extra: Partial<GameState> = {}): GameState =>
    ({
      players,
      holdings: players.map(() => []),
      market: { stocks: [] },
      commercialOwners: [],
      ...extra,
    }) as unknown as GameState;

  it('★ 八条字段值：金額带 $ 前缀、保險期带「天」、企業带「×」', () => {
    const state = stateOf([
      player({ index: 0, cash: 100000, moneyInBank: 100000, loan: 0, points: 3, insuranceDays: 5 }),
    ]);
    const v = sheetValues(state, topo, 0);
    expect(v[0]).toBe('$100,000'); // 現金
    expect(v[1]).toBe('$100,000'); // 存款
    expect(v[2]).toBe('$0'); // 貸款
    expect(v[3]).toBe('$200,000'); // 總資產 = 现金 + 存款 − 贷款
    expect(v[5]).toBe('3'); // 點卷：**纯数字**，没有 × 号（原版走 itoa）
    expect(v[6]).toBe('5天'); // 保險期
    expect(v[7]).toBe('×0'); // 企業
  });

  it('★ 中列四条计数带 × 号', () => {
    const state = stateOf([player({ index: 0 })]);
    expect(sheetCounts(state, topo, 0)).toEqual(['×0', '×0', '×0', '×0']);
  });
});

describe('在场玩家（页签只列这些）@source VA 0x42256f', () => {
  it('出局的玩家不占页签', () => {
    const mk = (index: number, whoPlays: number) =>
      ({ index, character: index, whoPlays }) as unknown as Player;
    const state = { players: [mk(0, WHO_PLAYS_HUMAN), mk(1, 0), mk(2, WHO_PLAYS_COMPUTER)] } as unknown as GameState;
    expect(activePlayers(state)).toEqual([0, 2]);
  });
});

describe('视图 1 的种类格与翻页箭头（T-023）@source VA 0x423ebb / 0x423f36', () => {
  it('★ 5 个种类格各 75×33、落在 y=64；标签次序照串表 0x4753d4', () => {
    expect([...SHEET_KINDS]).toEqual(['全  部', '住宅區', '商業區', '房  屋', '連鎖店']);
    expect(SHEET_KIND_CELL.w).toBe(75);
    expect(SHEET_KIND_CELL.h).toBe(33);
    for (let i = 0; i < SHEET_KINDS.length; i++) {
      const x = SHEET_KIND_CELL.x0 + i * SHEET_KIND_CELL.w;
      expect(hitSheetKind(x, 80)).toBe(i); // 左边界
      expect(hitSheetKind(x + 74, 80)).toBe(i); // 右边界
    }
    expect(hitSheetKind(119, 80)).toBeNull();
    expect(hitSheetKind(495, 80)).toBeNull(); // 5×75 = 375，120+375 = 495 之外
    expect(hitSheetKind(200, 63)).toBeNull(); // 上边界之外
    expect(hitSheetKind(200, 97)).toBeNull(); // 下边界之外
  });

  it('★ 两颗箭头各 30×30：上在 y=369、下在 y=417，x∈[593,623]', () => {
    expect(hitSheetArrow(600, 380)).toBe('up');
    expect(hitSheetArrow(600, 430)).toBe('down');
    expect(hitSheetArrow(600, 400)).toBeNull(); // 两颗之间
    expect(hitSheetArrow(592, 380)).toBeNull();
    expect(hitSheetArrow(623, 380)).toBeNull();
  });

  it('★ 翻页：每页 10 行；「起点+11 > 总数」才是到底（不是 +10）', () => {
    // 恰好 10 条：翻不动
    expect(estatePageAfter(10, 0, 1)).toBe(0);
    // 11 条：可以翻到第 2 页
    expect(estatePageAfter(11, 0, 1)).toBe(10);
    // 20 条：翻到第 2 页；第 2 页再翻 -> 起点+11 = 21 > 20，停
    expect(estatePageAfter(20, 0, 1)).toBe(10);
    expect(estatePageAfter(20, 10, 1)).toBe(10);
    // 21 条：第 2 页还能翻到第 3 页
    expect(estatePageAfter(21, 10, 1)).toBe(20);
    // 上一页：0 就不动
    expect(estatePageAfter(50, 0, -1)).toBe(0);
    expect(estatePageAfter(50, 20, -1)).toBe(10);
  });

  it('★ 租期：0 = 無限期；否则 `%02d/%d/%d` = (v>>16)%100 / (v>>8)&0xf / v&0xff', () => {
    expect(tenureText(0)).toBe('無限期');
    // 1998 年 1 月 5 日 = 1998<<16 | 1<<8 | 5
    expect(tenureText((1998 << 16) | (1 << 8) | 5)).toBe('98/1/5');
    // 2005 年 12 月 31 日 → 年取后两位并补零
    expect(tenureText((2005 << 16) | (12 << 8) | 31)).toBe('05/12/31');
  });
});

describe('视图 1 的行内容（T-023）—— 五种种类 @source VA 0x423b3b', () => {
  const land = (over: Record<string, unknown>) => ({
    id: 1, x: 0, y: 0, name: 'A區', priceStatus: 0, type: 0, owner: 1, level: 0,
    facing: 0, landPrice: 1000, housePrice: 100, rentByLevel: [0, 500, 0, 0, 0, 0],
    flast: 0, ...over,
  });
  const fac = (over: Record<string, unknown>) => ({
    id: 1, x: 0, y: 0, name: '公園', type: 1, owner: 1, level: 2, facing: 0,
    priceStatus: 0, landPrice: 500, housePrice: 100, rateByLevel: [10, 20, 30, 40, 50, 60],
    ...over,
  });
  const topo = {
    nodes: [],
    lands: [
      land({ id: 1, name: 'A區', owner: 1, type: 0, level: 0 }), // 空地
      land({ id: 2, name: 'A區', owner: 1, type: 0, level: 1 }), // 房屋
      land({ id: 3, name: 'B區', owner: 1, type: 5, level: 1 }), // 連鎖店
      land({ id: 4, name: 'C區', owner: 2, type: 0, level: 1 }), // 别人的
    ],
    facilities: [fac({ id: 1, owner: 1, type: 1, level: 2 })],
    commercials: [],
  } as unknown as MapTopology;
  const state = {
    players: [{ index: 0 }],
    holdings: [[]],
    market: { stocks: [] },
    commercialOwners: [],
    priceIndex: 1,
    landOwner: [], landLevel: [], landType: [], landPriceStatus: [],
    facilityOwner: [], facilityLevel: [], facilityType: [], facilityPriceStatus: [],
    landTenure: [0, 0, (1998 << 16) | (6 << 8) | 1, 0, 0],
    facilityTenure: [0, 0],
  } as unknown as GameState;

  it('★ 种类 0「全部」= 我的地块（4−1=3 块）再我的設施（1 个）', () => {
    const rows = assetRows(state, topo, 0, 0);
    expect(rows.map((r) => r.place)).toEqual(['A區', 'A區', 'B區', '公園']);
  });

  it('★ 种类 1/2/3/4 各自筛对', () => {
    const names = (k: number) => assetRows(state, topo, 0, k).map((r) => `${r.place}:${r.status}`);
    expect(names(1)).toEqual(['A區:空  地', 'A區:平  房', 'B區:連鎖店']); // 住宅區
    expect(names(2)).toEqual(['公園:旅  館']); // 商業區
    expect(names(3)).toEqual(['A區:平  房']); // 房屋 = type 0 且 level≠0
    expect(names(4)).toEqual(['B區:連鎖店']); // 連鎖店 = type≠0 且 level≠0
  });

  it('★ 五列：價格 = (房价×等级 + 地价)×物價指數；住宅的收費按**同名区**累加', () => {
    const rows = assetRows(state, topo, 0, 1);
    const [vacant, house, chain] = rows;
    // A區 等级 0：(100×0 + 1000) = 1000；A區 等级 1：100×1+1000 = 1100
    expect(vacant!.price).toBe('$1,000');
    expect(house!.price).toBe('$1,100');
    // 住宅过路费 = 同名『A區』两块地的 rentByLevel[等级] 之和 = 0 + 500
    expect(vacant!.toll).toBe('$500');
    expect(house!.toll).toBe('$500');
    // 连锁店那行显示的是**入口算的那一个**（当前玩家名下连鎖店 × 2000）
    expect(chain!.toll).toBe('$2,000');
  });

  it('★ 租期列读 landTenure（打包日期），設施那行读 facilityTenure', () => {
    const rows = assetRows(state, topo, 0, 0);
    expect(rows[1]!.tenure).toBe('98/6/1'); // 地块 2
    expect(rows[3]!.tenure).toBe('無限期'); // 設施 1
  });

  it('★ 設施行：價格 = (費率[0]×等级 + 地价)；收費 = 費率[等级]', () => {
    const row = assetRows(state, topo, 0, 2)[0]!;
    expect(row.price).toBe('$520'); // 10×2 + 500
    expect(row.toll).toBe('$30'); // 費率[2]
  });
});

describe('视图 2 的 12 行股票（T-023）@source VA 0x4238b1', () => {
  it('★ 12 支全列；持仓那列**也带 $**（原版走的是货币串）', () => {
    const mine = stocksOfMap(0);
    const holdings = mine.map((_, i) => ({ amount: i === 3 ? 10 : 0, avgCost: 4 }));
    const state = {
      globalMapId: 0,
      holdings: [holdings],
      market: { stocks: mine.map((_, i) => ({ price: i === 3 ? 7 : 0 })) },
    } as unknown as GameState;
    const rows = stockRows(state, 0);
    expect(rows).toHaveLength(12);
    expect(rows[3]!.place).toBe(mine[3]!.name);
    expect(rows[3]!.status).toBe('$10'); // 持有張數（带 $，原版如此）
    expect(rows[3]!.price).toBe('$70'); // 10 × 7
    expect(rows[0]!.status).toBe('$0');
  });
});
