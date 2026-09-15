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
import {
  SHEET_BTN_LABELS,
  SHEET_COUNT_Y,
  SHEET_EXIT_HIT,
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
  hitSheetBtn,
  hitSheetExit,
  hitSheetTab,
  sheetBtnRect,
  sheetCell,
  sheetCounts,
  sheetValues,
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
