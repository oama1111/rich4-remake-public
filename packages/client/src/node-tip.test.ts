/*
 * 名板浮标 —— Q-HOVER-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 判据全部来自 exe：
 *   - 触发 / 擦除：`fcn_00417e26`（VA 0x00417e26）的 0x201 / 0x200 / 0x202 三支
 *   - 框与文字：`fcn_00417559`（VA 0x00417559）
 *   - 名板图：`Data.mkf` 资源 0x205 图 0..3（189×116，锚点 (0,0)/(0,116)/(189,0)/(189,116)）
 */
import { describe, expect, it, vi } from 'vitest';
import {
  isAlive,
  makeFacility,
  makeGameState,
  makeLand,
  makeNode,
  type Rich4Map,
} from '@rich4/core';
import { TOOLS } from '@rich4/data';
import {
  drawTip,
  FACILITY_DEV_NAMES,
  FACILITY_TYPE_NAMES,
  hitTipInstance,
  LAND_LEVEL_NAMES,
  LEVEL_NAMES,
  tipCandidates,
  tipInstanceId,
  tipInstanceOf,
  tipLines,
  tipModel,
  tipNumber,
  tipPlacement,
  TIP_ANCHORS,
  TIP_ARCHIVE,
  TIP_BOARD_WIDTH,
  TIP_FONT_SIZE,
  TIP_FRAME_H,
  TIP_FRAME_W,
  TIP_ID,
  TIP_LINE,
  TIP_LINE_TIGHT,
  TIP_RESOURCE,
  TIP_SINGLE_DY,
  TIP_TEXT_DOWN,
  TIP_TEXT_DX,
  TIP_TEXT_UP,
  TIP_TOKEN_DY,
} from './node-tip.ts';

// ============================================================
//  夹具
// ============================================================

function testMap(): Rich4Map {
  return {
    nodes: [
      makeNode({ id: 1, x: 0, y: 0, name: '公園' }),
      makeNode({ id: 2, x: 100, y: 0, name: '' }), // 无名路面：原版不弹框
    ],
    lands: [
      makeLand({
        id: 1,
        x: 200,
        y: 0,
        name: '台北市',
        type: 0,
        rentByLevel: [200, 1200, 3000, 7500, 16000, 30000],
      }),
    ],
    facilities: [
      makeFacility({
        id: 1,
        x: 300,
        y: 0,
        name: '設施',
        type: 1,
        owner: 0,
        level: 1,
        rateByLevel: [1000, 750, 1750, 4000, 8000, 15000],
      }),
    ],
    commercials: [
      {
        id: 1,
        x: 400,
        y: 0,
        name: '台積電',
        stockIndex: 3,
        landPrice: 5000,
        type: 0,
        spriteIndex: 1,
        assetValue: 100, owner: 0, ranking: [0, 0, 0, 0], funds: 0, profit: 0, 
        shares: 0,
      },
    ],
    landscapes: [{ id: 1, x: 500, y: 0, name: '阿里山', spriteIndex: 1 }],
    dataSize: 0,
  };
}

/** 世界坐标 → 棋盘局部屏幕坐标：这一组夹具直接把世界坐标当屏幕坐标用 */
const flatScreen = (wx: number, wy: number): { x: number; y: number } => ({ x: wx, y: wy });

// ============================================================
//  常量（名板图与字体）
// ============================================================

describe('名板图 @source VA 0x0040808f / 0x00417722', () => {
  it('★ 图是 Data.mkf 资源 0x205 的第 0..3 张', () => {
    expect(TIP_ARCHIVE).toBe('Data.mkf');
    expect(TIP_RESOURCE).toBe(0x205);
    expect(TIP_RESOURCE).toBe(517);
    expect(TIP_FRAME_W).toBe(189);
    expect(TIP_FRAME_H).toBe(116);
    expect(TIP_FONT_SIZE).toBe(0x10);
  });

  it('★ 四张只差尾巴冲哪个角 —— 锚点就是资源头里那四个', () => {
    expect(TIP_ANCHORS).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 116 },
      { x: 189, y: 0 },
      { x: 189, y: 116 },
    ]);
  });

  it('★ 文字离光标 189/2+9、行距 0x1b / 0x12', () => {
    expect(TIP_TEXT_DX).toBe(103);
    expect(TIP_TEXT_DOWN).toBe(0x2a);
    expect(TIP_TEXT_UP).toBe(-0x60);
    expect(TIP_LINE).toBe(0x1b);
    expect(TIP_LINE_TIGHT).toBe(0x12);
    expect(TIP_SINGLE_DY).toBe(0x1b);
    expect(TIP_TOKEN_DY).toBe(0x19);
    expect(TIP_BOARD_WIDTH).toBe(0x1b8);
  });

  it('★ 文字表逐字照抄', () => {
    expect(LAND_LEVEL_NAMES[0]).toBe('空  地');
    expect(LAND_LEVEL_NAMES[5]).toBe('摩天大樓');
    expect(FACILITY_TYPE_NAMES[0]).toBe('公  園');
    expect(FACILITY_TYPE_NAMES[4]).toBe('研究所');
    expect(LEVEL_NAMES[0]).toBe('０級');
    expect(LEVEL_NAMES[5]).toBe('五級');
  });

  it('★ 金额是千分位整数、**没有** $ 前缀（0x452793 只加逗号）', () => {
    expect(tipNumber(2000)).toBe('2,000');
    expect(tipNumber(1234567)).toBe('1,234,567');
  });
});

// ============================================================
//  实例编号分区
// ============================================================

describe('实例编号 → 类别 @source fcn_00417559 的区间', () => {
  it('★ 五段各自的基址与端点', () => {
    expect(tipInstanceOf(1)).toEqual({ kind: 'node', id: 1 });
    expect(tipInstanceOf(0x7cf)).toEqual({ kind: 'node', id: 0x7cf });
    expect(tipInstanceOf(0x7d1)).toEqual({ kind: 'land', id: 1 });
    expect(tipInstanceOf(0xfa0 + 1)).toEqual({ kind: 'facility', id: 1 });
    expect(tipInstanceOf(0x1770 + 1)).toEqual({ kind: 'commercial', id: 1 });
    expect(tipInstanceOf(0x1f40 + 1)).toEqual({ kind: 'landscape', id: 1 });
    expect(tipInstanceOf(0x270f)).toEqual({ kind: 'landscape', id: 0x270f - 0x1f40 });
  });

  it('★ 棋子与神明（bit15）', () => {
    expect(tipInstanceOf(TIP_ID.token | 1)).toEqual({ kind: 'player', index: 0 });
    expect(tipInstanceOf(TIP_ID.token | 8)).toEqual({ kind: 'player', index: 3 });
    expect(tipInstanceOf(TIP_ID.token | 16)).toEqual({ kind: 'player', index: 4 });
    expect(tipInstanceOf(TIP_ID.token | (3 << 8))).toEqual({ kind: 'object', index: 3 });
  });

  it('★ 不要的编号：0、负数、≥0x2710、bit15 全零', () => {
    expect(tipInstanceOf(0)).toBeNull();
    // ≤0 的编号原版会去读越界内存（实例表里不会有），这里保守当「没有」
    expect(tipInstanceOf(-5)).toBeNull();
    expect(tipInstanceOf(0x2710)).toBeNull();
    expect(tipInstanceOf(TIP_ID.token)).toBeNull();
  });

  it('★ 端点是原版的怪例：0x7d0 掉进「棋子」那一段（尾零 4 → 4 号人物）', () => {
    // `cmp ebp, 0x7d0 / jle` + `cmp ebp, 0xfa0 / jle` …一路落到 0x417b7e
    expect(tipInstanceOf(0x7d0)).toEqual({ kind: 'player', index: 4 });
    expect(tipInstanceOf(0xfa0)).toEqual({ kind: 'player', index: 5 });
  });

  it('编号能原样编回去', () => {
    for (const id of [1, 0x7cf, 0x7d1, 0xfa1, 0x1771, 0x1f41]) {
      const inst = tipInstanceOf(id);
      expect(inst).not.toBeNull();
      expect(tipInstanceId(inst!)).toBe(id);
    }
    expect(tipInstanceId({ kind: 'player', index: 2 })).toBe(TIP_ID.token | 4);
    expect(tipInstanceId({ kind: 'object', index: 7 })).toBe(TIP_ID.token | (7 << 8));
  });
});

// ============================================================
//  落点
// ============================================================

describe('名板落点 @source VA 0x004175dd..0x0041771e', () => {
  it('★ 四个象限各用哪一张图、框落在光标哪一侧', () => {
    // 左上角：框往右下，尾巴左上 = 图 0
    expect(tipPlacement(10, 10)).toMatchObject({
      image: 0,
      anchor: { x: 0, y: 0 },
      box: { x: 10, y: 10, w: 189, h: 116 },
      textX: 113,
      textBaseY: 10 + 0x2a,
    });
    // 左下角（y ≥ 116）：框往上，尾巴左下 = 图 1
    expect(tipPlacement(10, 200)).toMatchObject({
      image: 1,
      box: { x: 10, y: 200 - 116 },
      textX: 113,
      textBaseY: 200 - 0x60,
    });
    // 右上角（x > 251）：框往左，尾巴右上 = 图 2
    expect(tipPlacement(300, 10)).toMatchObject({
      image: 2,
      box: { x: 300 - 189, y: 10 },
      textX: 300 - 103,
      textBaseY: 10 + 0x2a,
    });
    // 右下角：图 3
    expect(tipPlacement(300, 200)).toMatchObject({
      image: 3,
      box: { x: 300 - 189, y: 200 - 116 },
      textX: 300 - 103,
      textBaseY: 200 - 0x60,
    });
  });

  it('★ 分界线：y = 116 与 x = 251 都算「有地方放」', () => {
    expect(tipPlacement(0, 115).image).toBe(0);
    expect(tipPlacement(0, 116).image).toBe(1);
    expect(tipPlacement(251, 0).image).toBe(0);
    expect(tipPlacement(252, 0).image).toBe(2);
  });

  it('★ 框的左上角 = 光标 − 锚点（画图与存底图用的是同一个矩形）', () => {
    for (const [x, y] of [
      [10, 10],
      [10, 200],
      [300, 10],
      [300, 200],
    ] as const) {
      const p = tipPlacement(x, y);
      expect(p.box.x).toBe(x - p.anchor.x);
      expect(p.box.y).toBe(y - p.anchor.y);
    }
  });

  it('★ 文本块以名板内框中心排（单行 / 三行 / 四行都居中的那两条基准）', () => {
    // 内框（189×116 那张图的蓝底）是 (29,33)-(174,104)，中心 y ≈ 68.5
    const down = tipPlacement(20, 20);
    expect(down.textBaseY).toBe(20 + 42);
    expect(down.textBaseY + TIP_SINGLE_DY).toBe(20 + 69); // 单行正好落在中心
    expect(down.textBaseY + TIP_LINE * 2 - TIP_LINE).toBe(20 + 69); // 三行块中心也在那儿
  });
});

// ============================================================
//  文本
// ============================================================

describe('文本拼法 @source fcn_00417559 的各分支', () => {
  it('★ 节点 = 一行名字（dy 0x1b）', () => {
    const map = testMap();
    const state = makeGameState();
    expect(tipLines(map, state, { kind: 'node', id: 1 })).toEqual([
      { text: '公園', dy: TIP_SINGLE_DY },
    ]);
    // 名字空的节点：原版在 VA 0x004175b9 直接返回
    expect(tipLines(map, state, { kind: 'node', id: 2 })).toEqual([]);
  });

  it('★ 景觀 = 一行名字（它就是需求方说的「景物」）', () => {
    const map = testMap();
    const state = makeGameState();
    expect(tipLines(map, state, { kind: 'landscape', id: 1 })).toEqual([
      { text: '阿里山', dy: TIP_SINGLE_DY },
    ]);
  });

  it('★ 景觀名字为空时**照弹框**（原版这一段没有名字检查）', () => {
    const map = testMap();
    map.landscapes[0]!.name = '';
    const state = makeGameState();
    expect(tipLines(map, state, { kind: 'landscape', id: 1 })).toEqual([
      { text: '', dy: TIP_SINGLE_DY },
    ]);
  });

  it('★ 企业 = 董事長 / 企業名 / 餘股，行距 0x1b', () => {
    const map = testMap();
    const state = makeGameState({
      commercialOwners: [{ owner: 1, ranking: [] }],
      commercialShares: [1234],
    });
    expect(tipLines(map, state, { kind: 'commercial', id: 1 })).toEqual([
      { text: '約翰喬', dy: 0 },
      { text: '台積電', dy: TIP_LINE },
      { text: '餘股:1234', dy: TIP_LINE * 2 },
    ]);
  });

  it('★ 企业无主时第一行留白，名字仍在 +0x1b', () => {
    const map = testMap();
    const state = makeGameState({ commercialOwners: [{ owner: 0, ranking: [] }] });
    expect(tipLines(map, state, { kind: 'commercial', id: 1 })).toEqual([
      { text: '台積電', dy: TIP_LINE },
      { text: '餘股:0', dy: TIP_LINE * 2 },
    ]);
  });

  it('★ 无主地块 = 等级名 / 等级 / 该等级的过路费', () => {
    const map = testMap();
    const state = makeGameState({ landOwner: [0, 0], landLevel: [0, 2] });
    expect(tipLines(map, state, { kind: 'land', id: 1 })).toEqual([
      { text: '店  舖', dy: TIP_LINE_TIGHT },
      { text: '二級', dy: TIP_LINE_TIGHT * 2 },
      { text: '3,000', dy: TIP_LINE_TIGHT * 3 },
    ]);
  });

  it('★ 等级 0 的无主地块第一行是「空  地」', () => {
    const map = testMap();
    const state = makeGameState({ landOwner: [0, 0], landLevel: [0, 0] });
    expect(tipLines(map, state, { kind: 'land', id: 1 })[0]).toEqual({
      text: '空  地',
      dy: TIP_LINE_TIGHT,
    });
  });

  it('★ 有主地块 = 业主 / 等级名 / 等级 / 同名过路费之和', () => {
    const map = testMap();
    // 两块同名（台北市）、同业主、都非连锁 → 各自的 rentByLevel[自己那一级] 相加
    map.lands.push(
      makeLand({
        id: 2,
        x: 900,
        y: 0,
        name: '台北市',
        type: 0,
        rentByLevel: [200, 1200, 3000, 7500, 16000, 30000],
      }),
    );
    const state = makeGameState({
      landOwner: [0, 1, 1],
      landLevel: [0, 1, 2],
    });
    expect(tipLines(map, state, { kind: 'land', id: 1 })).toEqual([
      { text: '約翰喬', dy: 0 },
      { text: '平  房', dy: TIP_LINE_TIGHT },
      { text: '一級', dy: TIP_LINE_TIGHT * 2 },
      { text: '4,200', dy: TIP_LINE_TIGHT * 3 }, // 1200 + 3000
    ]);
  });

  it('★ 连鎖店地块 = 2000×物價指數 后面接 ×連鎖店數', () => {
    const map = testMap();
    // 这一块自己是連鎖店（type != 0）才算这条分支
    map.lands[0]!.type = 1;
    map.lands.push(makeLand({ id: 2, x: 900, y: 0, name: '台北市', type: 1 }));
    const state = makeGameState({ priceIndex: 3, landOwner: [0, 1, 1], landLevel: [0, 1, 0] });
    expect(tipLines(map, state, { kind: 'land', id: 1 })).toEqual([
      { text: '約翰喬', dy: 0 },
      { text: '連鎖店', dy: TIP_LINE_TIGHT },
      { text: '一級', dy: TIP_LINE_TIGHT * 2 },
      { text: '6,000×2', dy: TIP_LINE_TIGHT * 3 },
    ]);
  });

  it('★ 設施：旅館 = 類別 / 等級 / ×(費率×指數)；加油站 = ×1000；空地只一行', () => {
    const map = testMap();
    // ★ 設施的种类/等级/归属读的是 **state**（原版读的是运行时那条記錄，
    //   地图模板只是兜底）—— 故这里像 `board-screen.test.ts` 一样显式给 state。
    //   `newGame` 也是这么填的（`facilityFieldFromMap`，new-game.ts:397-399）。
    const state = makeGameState({
      priceIndex: 2,
      facilityType: [0, 1], // 下标 = 設施 id（1 基）
      facilityLevel: [0, 1],
    });
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '旅  館', dy: TIP_LINE_TIGHT },
      { text: '一級', dy: TIP_LINE_TIGHT * 2 },
      { text: '×1,500', dy: TIP_LINE_TIGHT * 3 }, // rateByLevel[1]=750 ×2
    ]);

    state.facilityType[1] = 3;
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '加油站', dy: TIP_LINE },
      { text: '×1,000', dy: TIP_LINE * 2 },
    ]);

    state.facilityLevel[1] = 0;
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '空  地', dy: TIP_LINE },
    ]);
  });

  it('★ 設施：模板兜底 —— state 那一格没有时读地图记录（与 board-screen 同口径）', () => {
    const map = testMap();
    // state 的設施表是空的（缺项）→ 回退到地图模板的 type/level
    const state = makeGameState({ priceIndex: 2, facilityType: [], facilityLevel: [], facilityOwner: [] });
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '旅  館', dy: TIP_LINE_TIGHT },
      { text: '一級', dy: TIP_LINE_TIGHT * 2 },
      { text: '×1,500', dy: TIP_LINE_TIGHT * 3 },
    ]);
  });

  // ============================================================
  //  研究所第三行（Q-HOVER-1 残留项 ① / Q-TOOL-6）
  // ============================================================

  it('★ 研究所：三行 = 類別 / 等級 / 開發中的東西 @source VA 0x00417a86', () => {
    const map = testMap();
    const state = makeGameState({
      facilityType: [0, 4],
      facilityLevel: [0, 3],
      facilityResearchProject: [0, 3], // 3 → 表 0x47ff1a 第 3 项「傳送機」
      facilityResearchDays: [0, 5], // 还有 5 天 → 画第三行
    });
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '研究所', dy: TIP_LINE_TIGHT },
      { text: '三級', dy: TIP_LINE_TIGHT * 2 },
      { text: '傳送機', dy: TIP_LINE_TIGHT * 3 },
    ]);
  });

  it('★ 研究所：`+0x1e` 为 0（没在研發）→ 只两行，第三行不画 @source VA 0x00417ac2', () => {
    const map = testMap();
    const state = makeGameState({
      facilityType: [0, 4],
      facilityLevel: [0, 5],
      facilityResearchProject: [0, 5], // 就算项目还留着 5
      facilityResearchDays: [0, 0], // ★ 但天数是 0
    });
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '研究所', dy: TIP_LINE_TIGHT },
      { text: '五級', dy: TIP_LINE_TIGHT * 2 },
    ]);
  });

  it('★ 研究所：六项名字表逐项对（0..5 → 遙控骰子…核子飛彈）', () => {
    const map = testMap();
    const state = makeGameState({
      facilityType: [0, 4],
      facilityLevel: [0, 5],
      facilityResearchDays: [0, 1],
      facilityResearchProject: [0, 0],
    });
    for (const [project, name] of FACILITY_DEV_NAMES.entries()) {
      state.facilityResearchProject[1] = project;
      const lines = tipLines(map, state, { kind: 'facility', id: 1 });
      expect(lines[2]).toEqual({ text: name, dy: TIP_LINE_TIGHT * 3 });
    }
    expect(FACILITY_DEV_NAMES).toEqual([
      '遙控骰子', '機器工人', '時光機', '傳送機', '工程車', '核子飛彈',
    ]);
  });

  it('★ 研究所：项目下标越界（原版没有边界检查）→ 本引擎给空串，不读表外', () => {
    const map = testMap();
    const state = makeGameState({
      facilityType: [0, 4],
      facilityLevel: [0, 5],
      facilityResearchDays: [0, 1],
      facilityResearchProject: [0, 6], // 表只有 0..5
    });
    const lines = tipLines(map, state, { kind: 'facility', id: 1 });
    expect(lines[2]).toEqual({ text: '', dy: TIP_LINE_TIGHT * 3 });
  });

  it('★ 研究所：有主时业主名占第一行，三行整体下移', () => {
    const map = testMap();
    const state = makeGameState({
      facilityType: [0, 4],
      facilityLevel: [0, 2],
      facilityOwner: [0, 1],
      facilityResearchProject: [0, 2], // 2 → 「時光機」
      facilityResearchDays: [0, 4],
    });
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '約翰喬', dy: 0 },
      { text: '研究所', dy: TIP_LINE_TIGHT },
      { text: '二級', dy: TIP_LINE_TIGHT * 2 },
      { text: '時光機', dy: TIP_LINE_TIGHT * 3 },
    ]);
  });

  it('★ 研究所：state 缺项时用地图模板里的 +0x1d/+0x1e 兜底', () => {
    const map = testMap();
    map.facilities[0]!.type = 4;
    map.facilities[0]!.level = 1;
    map.facilities[0]!.researchProject = 1; // 1 → 「機器工人」
    map.facilities[0]!.researchDays = 2;
    const state = makeGameState({
      facilityType: [],
      facilityLevel: [],
      facilityResearchProject: [],
      facilityResearchDays: [],
    });
    expect(tipLines(map, state, { kind: 'facility', id: 1 })).toEqual([
      { text: '研究所', dy: TIP_LINE_TIGHT },
      { text: '一級', dy: TIP_LINE_TIGHT * 2 },
      { text: '機器工人', dy: TIP_LINE_TIGHT * 3 },
    ]);
  });

  it('★ 名字表就是 `_tool_table + 56` —— 恒等于道具 8..13 的名字', () => {
    // @source VA 0x00417ad8 `mov ebx, dword [eax*8 + 0x47ff1a]`；
    //   `_tool_table` = 0x47fee2、每项 8 字节 ⇒ 0x47fee2 + 8×7 = 0x47ff1a
    //   ⇒ 下标 i 是**道具 i + 8**（@source VA 0x0041ce18 `add eax, 8`）。
    expect(FACILITY_DEV_NAMES).toEqual([
      '遙控骰子', '機器工人', '時光機', '傳送機', '工程車', '核子飛彈',
    ]);
    const ids = [8, 9, 10, 11, 12, 13];
    expect(FACILITY_DEV_NAMES).toEqual(ids.map((id) => TOOLS.find((t) => t.id === id)?.name));
  });

  it('★ 玩家棋子 = 角色名（4..7 号是那四个人物）', () => {
    const map = testMap();
    const state = makeGameState();
    expect(tipLines(map, state, { kind: 'player', index: 0 })).toEqual([
      { text: '約翰喬', dy: TIP_TOKEN_DY },
    ]);
    expect(tipLines(map, state, { kind: 'player', index: 4 })).toEqual([
      { text: '小偷', dy: TIP_TOKEN_DY },
    ]);
  });
});

// ============================================================
//  命中
// ============================================================

describe('命中测试', () => {
  it('★ 有名字的节点才是候选；景觀照收', () => {
    const cands = tipCandidates(testMap(), makeGameState());
    const kinds = cands.map((c) => c.instance.kind);
    expect(cands.some((c) => c.instance.kind === 'node' && c.instance.id === 1)).toBe(true);
    expect(cands.some((c) => c.instance.kind === 'node' && c.instance.id === 2)).toBe(false);
    expect(kinds).toContain('land');
    expect(kinds).toContain('facility');
    expect(kinds).toContain('commercial');
    expect(kinds).toContain('landscape');
  });

  it('★ 半径内取最近的；同点上棋子盖过路面节点', () => {
    const cands = tipCandidates(testMap(), makeGameState());
    // (0,0) 上既有 1 号节点又有站着的人 —— 原版最后戳的是棋子，所以是棋子赢
    expect(hitTipInstance(cands, 3, 2, flatScreen)).toEqual({ kind: 'player', index: 0 });
    expect(hitTipInstance(cands, 402, 1, flatScreen)).toEqual({ kind: 'commercial', id: 1 });
    expect(hitTipInstance(cands, 1000, 1000, flatScreen)).toBeNull();
  });

  it('★ 节点周围没有棋子时命中的是节点', () => {
    const state = makeGameState();
    for (const p of state.players) p.nodeId = 0;
    const cands = tipCandidates(testMap(), state);
    expect(hitTipInstance(cands, 3, 2, flatScreen)).toEqual({ kind: 'node', id: 1 });
  });

  it('★ 出局的玩家不算候选', () => {
    const state = makeGameState();
    state.players[0]!.whoPlays = 0;
    expect(isAlive(state.players[0]!)).toBe(false);
    const cands = tipCandidates(testMap(), state);
    expect(cands.some((c) => c.instance.kind === 'player' && c.instance.index === 0)).toBe(false);
  });
});

// ============================================================
//  整帧
// ============================================================

describe('一整帧模型', () => {
  const toScreen = (wx: number, wy: number): { x: number; y: number } | null =>
    wx > 900 ? null : { x: wx, y: wy };

  it('★ 点企业：框 + 三行文字', () => {
    const map = testMap();
    // 把企业挪到 y=200，好让 y ≥ 116 那条「框往上」的分支也被走到
    map.commercials[0]!.y = 200;
    const state = makeGameState({
      commercialOwners: [{ owner: 2, ranking: [] }],
      commercialShares: [77],
    });
    const m = tipModel(map, state, 402, 210, toScreen);
    expect(m).not.toBeNull();
    // x=402 > 251 且 y=210 ≥ 116 → 框往左上、尾巴右下 = 图 3
    expect(m!.image).toBe(3);
    expect(m!.box).toEqual({ x: 402 - 189, y: 210 - 116, w: 189, h: 116 });
    expect(m!.lines.map((l) => l.text)).toEqual(['沙隆巴斯', '台積電', '餘股:77']);
  });

  it('★ 光标在棋盘左下角时用图 1（框往上、尾巴左下）', () => {
    const map = testMap();
    map.commercials[0]!.x = 100;
    map.commercials[0]!.y = 200;
    const state = makeGameState({ commercialOwners: [{ owner: 0, ranking: [] }] });
    const m = tipModel(map, state, 102, 205, toScreen);
    expect(m!.image).toBe(1);
    expect(m!.box).toEqual({ x: 102, y: 205 - 116, w: 189, h: 116 });
  });

  it('★ 点没东西的地方：null，而且一个音都不放（原版 loc_00417c5f）', () => {
    expect(tipModel(testMap(), makeGameState(), 800, 800, toScreen)).toBeNull();
  });
});

// ============================================================
//  画（只做 IO）
// ============================================================

describe('drawTip', () => {
  it('★ 先贴图、再逐行描边填字（flag 2 = 正中）', () => {
    const calls: string[] = [];
    const ctx = {
      drawImage: vi.fn(() => calls.push('image')),
      strokeText: vi.fn(() => calls.push('stroke')),
      fillText: vi.fn(() => calls.push('fill')),
      fillRect: vi.fn(),
      set font(v: string) {
        calls.push(`font:${v}`);
      },
      textAlign: 'left',
      textBaseline: 'top',
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const model = {
      ...tipPlacement(400, 300),
      lines: [
        { text: '約翰喬', dy: 0 },
        { text: '台積電', dy: TIP_LINE },
      ],
    };
    drawTip(ctx, { bitmap: {} as CanvasImageSource, width: 189, height: 116 }, model);
    expect(calls[0]).toBe('image');
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 400 - 189, 300 - 116);
    expect(ctx.strokeText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.textAlign).toBe('center');
    expect(ctx.textBaseline).toBe('middle');
  });
});
