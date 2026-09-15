/*
 * 個人資產表屏（工具列 #7）—— T-022 / T-023
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只摆位置与画字，**数值全部来自 core**
 *   （`panelValues` / `assetCounts`），自己不做任何加减。
 *
 * ## 这屏是怎么构成的（照 exe）
 *
 * 窗口过程 `fcn_00423cf3`（VA 0x423cf3），绘制走 **0x401** 消息（VA 0x423d6c）：
 * ```
 * [0x48c27c] = 当前玩家        ；本屏**显示的是哪个玩家**（点页签可换）
 * fcn_00422443                  ；初始化：12 个标签 + 两排清单表头
 * fcn_00423070                  ；静态：底图 + 页签 + 头像 + 三钮
 * if [0x4753fc] == 1: fcn_004225a3([0x475400])   ；地產清單的**数据行**（T-023）
 * ```
 *
 * | 是什么 | @source |
 * |---|---|
 * | 底图 = `Panel.mkf` **资源 9** 的图 `[0x4753fc]` | 载入 VA 0x4244xx；取图 `+0xc+view*12` @0x423088 |
 * | 12 个行标签（开局画进底图） | `fcn_00422443`（VA 0x422443）|
 * | 玩家页签（图 3 当前 / 图 4 其余，88 宽 @(16+88i, 14)） | `fcn_00423070` VA 0x423237 |
 * | EXIT 钮（图 5 / 按下 图 6，锚点 (547,23)） | 常态 VA 0x4230f4；按下 VA 0x423e2b |
 * | 头像（`map.mkf` 的角色图，锚点 (60,100)） | VA 0x4230bf |
 * | 神明图标（图 `13+obj` @(60,188)）与「N天」@(60,234) | VA 0x4231a1 / 0x42321f |
 * | 三颗下钻钮（图 12 = 97×40 按下底） | 命中 VA 0x424163；按下底 VA 0x42419f |
 * | 视图 0 的八条数值 + 中列四条计数 | `loc_004232f3`（VA 0x4232f3）|
 * | 视图 0 右下 15 格道具欄 / 卡片欄 | VA 0x4236da / 0x4237b3 |
 * | 视图 1 的 5 个种类格（图 11 = 75×33 选中底） | 命中 VA 0x423ebb；绘制 VA 0x423883 |
 * | 视图 1 的数据行（5 列） | `fcn_004225a3`（VA 0x4225a3），取数 `fcn_00423b3b`（VA 0x423b3b）|
 * | 视图 1 的两颗翻页箭头（图 7 / 图 8） | 命中 VA 0x423f36；按下 VA 0x42424e / 0x4242cd |
 * | 视图 2 的 12 行股票 | `loc_004238b1`（VA 0x4238b1）|
 * | 关屏 | 右键 `WM_RBUTTONUP` VA 0x424409；EXIT 钮 VA 0x4241f2 |
 *
 * ⚠️ **原版没有「鼠标悬停高亮」**：三颗钮的高亮（图 12）与 EXIT 的按下图只在
 *   `WM_LBUTTONDOWN` 那一下画（VA 0x424163 / 0x423dd1），抬手整屏重画。
 *   故本屏也只在**按下**时画高亮。
 *
 * ⚠️ **原版也没有 ESC 关屏**：0x100 那条分支（VA 0x424374）只认 RICH4.CFG 里
 *   配的两个翻页键（给地產清單翻页用，属 T-023）。
 *
 * ## 图集布局（`Panel.mkf` 资源 9，SMP，25 张）
 *
 * | 图 | 尺寸 | 用途 |
 * |---|---|---|
 * | 0 / 1 / 2 | 640×480 | 三个视图的底图（資產總表 / 地產清單 / 股票清單）|
 * | 3 / 4 | 88×33 / 88×32 | 玩家页签：当前 / 其余 |
 * | 5 / 6 | 58×19 / 53×18 | EXIT 钮：常态 / 按下 |
 * | 7 / 8 | 30×30 | 地產清單的上下翻页箭头：常态 / 按下（T-023）|
 * | 12 | 97×40 | 三颗下钻钮的按下底 |
 * | 13..24 | — | 12 个地图物件（神明）图标，取 `13 + (godInfo − 1)` |
 */

import {
  assetCounts,
  allEffectiveFacilities,
  allEffectiveLands,
  calculateLandToll,
  isAlive,
  panelValues,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { CARDS, CHARACTERS, stocksOfMap } from '@rich4/data';
import { portraitResource, type ArchiveName, type Sprite } from './assets.ts';
import { currency } from './panel.ts';
import { inRect } from './gameui.ts';

/** 同步取图（与 `main.ts` 的 `spriteNow` 同一个签名） */
export type SheetSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 底图 = `Panel.mkf` 资源 9 @source `read_mkf(panel_mkf, 9, 0, 0)` VA 0x4244xx */
export const SHEET_RESOURCE = 9;
/** 三个视图（資產總表 / 地產清單 / 股票清單）；底图就是图号 `[0x4753fc]` @source VA 0x423088 */
export const SHEET_VIEW_COUNT = 3;

/** 字体族 —— 与原版中文点阵字最近似的系统字 */
const FONT = '"PingFang TC", "Microsoft JhengHei", sans-serif';

// ============================================================
//  玩家页签（顶栏那一排名字）
// ============================================================

/**
 * 页签几何 @source `fcn_00423070` VA 0x423237：
 * 图 3 = 当前玩家、图 4 = 其余；落点 `(16 + 88i, 14)`，宽 88；
 * 名字用 20 号字画在 `(16 + 88i + 44, 30)`、flag 2（正中）。
 */
export const SHEET_TAB = {
  x0: 0x10,
  pitch: 0x58,
  y: 0x0e,
  w: 0x58,
  /** 图号：当前 / 其余 */
  sel: 3,
  normal: 4,
  nameDx: 0x2c,
  nameY: 0x1e,
  size: 0x14,
} as const;

/** 页签命中框高度 @source VA 0x424049 `cmp edi, 0xe` / `cmp edi, 0x2f` */
export const SHEET_TAB_HIT = { y: 0x0e, h: 0x2f - 0x0e + 1 } as const;

/** 在场玩家的下标（按页签顺序）@source VA 0x42256f：`[0x48c278]` 那张表 */
export function activePlayers(state: GameState): number[] {
  return state.players.filter((p) => isAlive(p)).map((p) => p.index);
}

/** 点在第几个页签上（**位次**，不是玩家号）；没点中返回 null @source VA 0x424049 */
export function hitSheetTab(x: number, y: number, tabCount: number): number | null {
  if (y < SHEET_TAB_HIT.y || y >= SHEET_TAB_HIT.y + SHEET_TAB_HIT.h) return null;
  for (let i = 0; i < tabCount; i++) {
    const x0 = SHEET_TAB.x0 + i * SHEET_TAB.pitch;
    if (x >= x0 && x < x0 + SHEET_TAB.w) return i;
  }
  return null;
}

// ============================================================
//  EXIT 钮（右上角）
// ============================================================

/** EXIT：锚点落点 (547,23)；图 5 常态 / 图 6 按下 @source VA 0x4230f4 / 0x423e2b */
export const SHEET_EXIT = { x: 0x223, y: 0x17, normal: 5, pressed: 6 } as const;
/** EXIT 命中框 @source VA 0x423dd1 `x∈[0x1ec,0x25a] y∈[9,0x26]` */
export const SHEET_EXIT_HIT = { x: 0x1ec, y: 9, w: 0x25a - 0x1ec + 1, h: 0x26 - 9 + 1 } as const;

export function hitSheetExit(x: number, y: number): boolean {
  return inRect(x, y, SHEET_EXIT_HIT);
}

// ============================================================
//  头像 / 神明
// ============================================================

/** 头像：`map.mkf` 的角色图，锚点落在 (60,100) @source VA 0x4230bf */
export const SHEET_PORTRAIT_AT = { x: 0x3c, y: 0x64 } as const;
/**
 * 神明图标：图 `13 + (godInfo − 1)`，锚点落在 (60,188) @source VA 0x4231a1。
 * 表 `0x475464` 是**步长 4** 的 dword 表：`[0, 13, 14, 15, 16]`。
 * `godInfo == 0` 时这一块（连着下面那行天数）**整个不画** @source VA 0x4231a6。
 */
export const SHEET_GOD_AT = { x: 0x3c, y: 0xbc } as const;
export const SHEET_GOD_FIRST = 13;
/** 神明剩餘天数：`(60,234)`、16 号字、flag 2 @source VA 0x42321f */
export const SHEET_GOD_DAYS = { x: 0x3c, y: 0xea, size: 0x10 } as const;

// ============================================================
//  12 个行标签（视图 0 的字段名，开局画进底图）
// ============================================================

/**
 * 标签位置 —— `fcn_00422443` 的三段循环（每段 4 条、步进 48）：
 * @source VA 0x422463 / 0x422497 / 0x4224cb
 * 左列 x=142 从 y=88、右列 x=430 从 y=88、第三列 x=142 从 y=296。
 */
export const SHEET_LABEL_AT = [
  { x: 0x8e, y: 0x58 }, { x: 0x8e, y: 0x88 }, { x: 0x8e, y: 0xb8 }, { x: 0x8e, y: 0xe8 },
  { x: 0x1ae, y: 0x58 }, { x: 0x1ae, y: 0x88 }, { x: 0x1ae, y: 0xb8 }, { x: 0x1ae, y: 0xe8 },
  { x: 0x8e, y: 0x128 }, { x: 0x8e, y: 0x158 }, { x: 0x8e, y: 0x188 }, { x: 0x8e, y: 0x1b8 },
] as const;

/** 标签字 —— 串表 `0x475418`（12 项），逐项 dump 自 rich4.exe */
export const SHEET_LABELS = [
  '現  金', '存  款', '貸  款', '總資產',
  '股  票', '點  卷', '保險期', '企  業',
  '土  地', '連鎖店', '房  屋', '設  施',
] as const;

/** 标签字号 @source VA 0x422451 `create_font(…, 0x14)` */
export const SHEET_LABEL_SIZE = 0x14;

// ============================================================
//  视图 0 的数值
// ============================================================

/**
 * 八条数值：**右对齐**（flag 6 = 右+中）、28 号字。
 * 左列 x=330、右列 x=602，四行 y = 88 / 136 / 184 / 232 @source VA 0x4232f3 起。
 *
 * 顺序与 `SHEET_LABELS[0..7]` 一一对应：
 * 左列 現金 / 存款 / 貸款 / 總資產，右列 股票 / 點卷 / 保險期 / 企業。
 */
export const SHEET_VALUE_X = { left: 0x14a, right: 0x25a } as const;
export const SHEET_VALUE_Y = [0x58, 0x88, 0xb8, 0xe8] as const;
export const SHEET_VALUE_SIZE = 0x1c;

/** 中列四条计数：右对齐 x=250，y = 296 / 344 / 392 / 440 @source VA 0x4235ef 起 */
export const SHEET_COUNT_X = 0xfa;
export const SHEET_COUNT_Y = [0x128, 0x158, 0x188, 0x1b8] as const;

/**
 * 视图 0 的八条数值文字 —— **全部来自 core**。
 *
 * @source 逐条（VA 0x4232f3 起）：
 * 現金 `player+0x1c`、存款 `+0x20`、貸款 `+0x24`、總資產 `calculate_player_wealth`、
 * 股票 `Σ 持股×股价`、點卷 `+0x30`（itoa）、保險期 `+0x3e`（`"%d天"`）、企業 `"×%d"`。
 */
export function sheetValues(
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
): readonly string[] {
  const v = panelValues(state, topo, playerIndex);
  return [
    currency(v.funds[0]), // 現金
    currency(v.funds[1]), // 存款
    currency(v.misc[1]), // 貸款
    currency(v.funds[2]), // 總資產
    currency(v.stocks[0]), // 股票（總市值）
    String(v.misc[0]), // 點卷
    `${v.misc[2]}天`, // 保險期
    `×${v.stocks[2]}`, // 企業（經營權数）
  ];
}

/** 中列四条计数文字：土地 / 連鎖店 / 房屋 / 設施，都带 `×` @source 格式串 `0x463e2b` */
export function sheetCounts(
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
): readonly string[] {
  return assetCounts(state, topo, playerIndex).map((n) => `×${n}`);
}

// ============================================================
//  视图 1 / 2 的表头与数据行（T-023）
// ============================================================

/**
 * 视图 1（地產清單）的 5 列表头：**y=112**，x 取自 int16 表 `0x475454`
 * = `[168, 264, 356, 448, 540]` @source VA 0x4224f7。
 *
 * ⚠️ 这两排**不是**视图 0 的字段值 —— 它们是两张清单的**列名**，
 *   原版开局把它们分别画进图 1、图 2 的底图。
 */
export const SHEET_LIST0_X = [168, 264, 356, 448, 540] as const;
export const SHEET_LIST0_Y = 0x70;
export const SHEET_LIST0_HEADER = ['地  點', '開發狀況', '價  格', '收  費', '租  期'] as const;

/** 视图 2（股票清單）的 3 列表头：**y=68**，x 取自 `0x47545e` = `[204, 332, 476]` @source VA 0x422525 */
export const SHEET_LIST1_X = [204, 332, 476] as const;
export const SHEET_LIST1_Y = 0x44;
export const SHEET_LIST1_HEADER = ['股票名稱', '持有張數', '總 市 價'] as const;

/**
 * 视图 1 顶上那 **5 个种类格**（每格 75×33）—— 点它换「列哪一类」。
 *
 * @source 命中 VA 0x423ebb（`x∈[120+75i, 195+75i]`、`y∈[64,97]`）；
 *   文字与高亮底 VA 0x423883（文字 `(120+75i+37, 80)`、flag 2；
 *   选中那颗在 `(120+75i, 64)` 盖 **图 11**（75×33））。
 *
 * 那 5 个字串在 `0x4753d4`，顺序与两个跳表（`0x42258f` 的绘制、
 * `0x423b27` 的取数）一致。
 */
export const SHEET_KINDS = ['全  部', '住宅區', '商業區', '房  屋', '連鎖店'] as const;
export const SHEET_KIND_CELL = { x0: 120, y: 64, w: 75, h: 33, textDx: 0x25, textY: 0x50, plate: 11 } as const;

/** 点在第几个种类格上；没点中返回 null */
export function hitSheetKind(x: number, y: number): number | null {
  if (y < SHEET_KIND_CELL.y || y >= SHEET_KIND_CELL.y + SHEET_KIND_CELL.h) return null;
  for (let i = 0; i < SHEET_KINDS.length; i++) {
    const x0 = SHEET_KIND_CELL.x0 + i * SHEET_KIND_CELL.w;
    if (x >= x0 && x < x0 + SHEET_KIND_CELL.w) return i;
  }
  return null;
}

/**
 * 视图 1 右边那两颗翻页箭头（30×30）。
 *
 * @source 命中 VA 0x423f36；按下时盖 **图 7**（上）/ **图 8**（下）
 *   @source VA 0x42424e / 0x4242cd；抬手走 `fcn_004225a3(kind, 2 | 1)`
 *   —— **上箭头 = 上一页（参数 2）、下箭头 = 下一页（参数 1）**。
 */
export const SHEET_ARROW = {
  x: 0x251,
  w: 30,
  h: 30,
  upY: 0x171,
  downY: 0x1a1,
  upImg: 7,
  downImg: 8,
} as const;

export function hitSheetArrow(x: number, y: number): 'up' | 'down' | null {
  if (x < SHEET_ARROW.x || x >= SHEET_ARROW.x + SHEET_ARROW.w) return null;
  if (y >= SHEET_ARROW.upY && y < SHEET_ARROW.upY + SHEET_ARROW.h) return 'up';
  if (y >= SHEET_ARROW.downY && y < SHEET_ARROW.downY + SHEET_ARROW.h) return 'down';
  return null;
}

/**
 * 数据行的几何 @source VA 0x4225a3：
 * 首行 **y=144**、步进 **32**；每页最多 **10** 行（`[0x475408]`）。
 */
export const SHEET_ROW_Y0 = 0x90;
export const SHEET_ROW_DY = 0x20;
export const SHEET_PAGE_SIZE = 10;

/**
 * 五列的 x 与对齐 —— 前两列居中（flag 2）、后三列里 價格/收費 右对齐（flag 6）、
 * 租期又居中（flag 2）@source 地块 VA 0x4226df / 設施 VA 0x422883。
 *
 * 注意 價格/收費 的 x 是**表头 x 再加一个偏移**（`+0x26` / `+0x2a`），
 * 不是表头那一列本身 —— 别照抄 `SHEET_LIST0_X`。
 */
export const SHEET_ROW_COL = [
  { x: 168, align: 'center' }, // 地點
  { x: 264, align: 'center' }, // 開發狀況
  { x: 356 + 0x26, align: 'right' }, // 價格
  { x: 448 + 0x2a, align: 'right' }, // 收費
  { x: 540, align: 'center' }, // 租期
] as const;

/** 住宅地块的「開發狀況」等级名 —— 串表 `0x475138`（7 项）*/
export const SHEET_LEVEL_NAMES = [
  '空  地', '平  房', '店  舖', '商  場', '商業大樓', '摩天大樓', '公  園',
] as const;
/** 設施的种类名 —— 串表 `0x475150` 的前 5 项（后面 6 项是等级/「過路費」，本屏不用）*/
export const SHEET_FACILITY_NAMES = ['公  園', '旅  館', '購物中心', '加油站', '研究所'] as const;
/** 地块 `type != 0` 时「開發狀況」固定写这个 @source 串 `0x463d6c` */
export const SHEET_CHAIN_STORE = '連鎖店';

/** 一行 */
export interface AssetRow {
  place: string;
  status: string;
  price: string;
  toll: string;
  tenure: string;
}

/**
 * 租期文字 —— `state.landTenure` / `facilityTenure` 是**打包日期**（年<<16|月<<8|日），
 * 0 表示無限期。
 *
 * @source VA 0x422843：`sprintf("%02d/%d/%d", (v>>16)%100, (v>>8)&0xf, v&0xff)`，
 *   `v == 0` 时改画固定串 `"無限期"`（`0x463e1f`）。
 */
export function tenureText(packed: number): string {
  if (packed === 0) return '無限期';
  const yy = String((packed >>> 16) % 100).padStart(2, '0');
  return `${yy}/${(packed >>> 8) & 0xf}/${packed & 0xff}`;
}

/**
 * 视图 1 的行 —— 五种「种类」各取哪些条目。
 *
 * @source 取数跳表 `0x423b27`（VA 0x423b3b），条目编码：地块 = `下标 + 0x7d0`、
 *   設施 = `下标 + 0xfa0`（绘制端 VA 0x4226df / 0x422883 按同一编码解码）：
 *
 * | 种类 | 内容 |
 * |---|---|
 * | 0 全部 | 我名下的**地块**，然后我名下的**設施** |
 * | 1 住宅區 | 我名下的地块（全部，不分等级）|
 * | 2 商業區 | 我名下的設施 |
 * | 3 房屋 | 我名下 `type == 0 && level != 0` 的地块 |
 * | 4 連鎖店 | 我名下 `type != 0 && level != 0` 的地块 |
 */
export function assetRows(
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
  kind: number,
): AssetRow[] {
  const me = playerIndex + 1;
  const lands = allEffectiveLands(state, topo);
  const facilities = allEffectiveFacilities(state, topo);
  const mine = lands.filter((l) => l.owner === me);
  const myFac = facilities.filter((f) => f.owner === me);
  const priceIndex = state.priceIndex;

  // ★ 連鎖店那一列显示的**不是**该地块主人的过路费，而是**入口处**按当前
  //   显示玩家算的那一个（VA 0x4225e6：`calculate_land_toll(玩家+1, NULL)`，
  //   結果整个函数共用一份）。原版如此，照抄。
  const viewerChainToll = calculateLandToll(lands, me, priceIndex, null);

  const landRows = (list: typeof lands): AssetRow[] =>
    list.map((land) => ({
      place: land.name,
      status:
        land.type === 0
          ? (SHEET_LEVEL_NAMES[land.level] ?? SHEET_LEVEL_NAMES[0])
          : SHEET_CHAIN_STORE,
      // @source 0x42279b 起：(房价 × 等级 + 地价) × 物价指数
      price: currency((land.housePrice * land.level + land.landPrice) * priceIndex),
      toll: currency(
        land.type === 0
          ? calculateLandToll(lands, land.owner, priceIndex, land.name)
          : viewerChainToll,
      ),
      tenure: tenureText(state.landTenure[land.id] ?? land.flast),
    }));

  const facilityRows = (list: typeof facilities): AssetRow[] =>
    list.map((fac) => ({
      place: fac.name,
      status:
        fac.level === 0 ? (SHEET_LEVEL_NAMES[0] ?? '') : (SHEET_FACILITY_NAMES[fac.type] ?? ''),
      // @source 0x422923 起：(费率[0] × 等级 + 地价) × 物价指数
      price: currency(((fac.rateByLevel[0] ?? 0) * fac.level + fac.landPrice) * priceIndex),
      // @source 0x422939：种类与等级都非 0 才算过路费（费率表按等级索引）
      toll: currency(
        fac.type !== 0 && fac.level !== 0 ? (fac.rateByLevel[fac.level] ?? 0) * priceIndex : 0,
      ),
      tenure: tenureText(state.facilityTenure[fac.id] ?? 0),
    }));

  switch (kind) {
    case 1:
      return landRows(mine);
    case 2:
      return facilityRows(myFac);
    case 3:
      return landRows(mine.filter((l) => l.type === 0 && l.level !== 0));
    case 4:
      return landRows(mine.filter((l) => l.type !== 0 && l.level !== 0));
    default:
      return [...landRows(mine), ...facilityRows(myFac)];
  }
}

/**
 * 视图 2（股票清單）的行 —— **12 支股票全列**，不管有没有持仓。
 *
 * @source VA 0x4238b1：名字取 `stocks_on_map[i]`、持仓取 `player_stocks[玩家][i]`、
 *   市价 = `trunc(持仓 × 股价)`；三列的 x = `204` / `332+52` / `476+60`，
 *   首行 **y=100**、步进 **32**。
 * ★ 持仓那一列走的也是 `num_to_currency_string` —— 所以带 `$`，原版如此。
 */
export function stockRows(state: GameState, playerIndex: number): AssetRow[] {
  return stocksOfMap(state.globalMapId).map((s, i) => {
    const h = state.holdings[playerIndex]?.[i];
    const amount = h?.amount ?? 0;
    const price = state.market.stocks[i]?.price ?? 0;
    return {
      place: s.name,
      status: currency(amount),
      price: currency(Math.trunc(amount * price)),
      toll: '',
      tenure: '',
    };
  });
}

/** 股票行的三列 x @source VA 0x4238cc 起 */
export const SHEET_STOCK_COL = [
  { x: 204, align: 'center' },
  { x: 332 + 0x34, align: 'right' },
  { x: 476 + 0x3c, align: 'right' },
] as const;
export const SHEET_STOCK_Y0 = 0x64;

/**
 * 翻一页之后的**行起点**（原版 `[0x475404]`）。
 *
 * @source VA 0x422613（下一页）：`if (起点 + 0xb > 总数) 什么都不做；
 *   否则 起点 += 0xa`；VA 0x422630（上一页）：`if (起点 == 0) 什么都不做；
 *   否则 起点 -= 0xa`。
 * ★ 「+0xb > 总数」这条让步进是 10 却要 11 个才允许翻 —— 即**最后一页
 *   哪怕只剩 1 条也要能翻过去**。照抄，别"修正"成 10。
 */
export function estatePageAfter(total: number, pageStart: number, dir: number): number {
  if (dir > 0) return pageStart + 0xb > total ? pageStart : pageStart + SHEET_PAGE_SIZE;
  return pageStart === 0 ? 0 : Math.max(0, pageStart - SHEET_PAGE_SIZE);
}

// ============================================================
//  三颗下钻钮
// ============================================================

/** 命中框 x∈[12,109]、每颗 40 高、步进 64、首颗 y=282 @source VA 0x424163 */
export const SHEET_BTN = { x: 0x0c, w: 0x6d - 0x0c, h: 0x28, y0: 0x11a, pitch: 0x40 } as const;
/** 钮上的文字：(60, 302/366/430)、20 号、flag 2 @source VA 0x4231c3 */
export const SHEET_BTN_TEXT = { x: 0x3c, y0: 0x12e, size: 0x14 } as const;
/** 钮名 —— 串表 `0x47540c` 的 [0][1][2] */
export const SHEET_BTN_LABELS = ['資產清單', '地產清單', '股票清單'] as const;
/** 按下时的底图 = 图 12（97×40，正好盖住整颗钮）@source VA 0x42419f */
export const SHEET_BTN_PLATE = 12;

/** 钮矩形（舞台坐标） */
export function sheetBtnRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: SHEET_BTN.x, y: SHEET_BTN.y0 + i * SHEET_BTN.pitch, w: SHEET_BTN.w, h: SHEET_BTN.h };
}

/** 点在第几颗下钻钮上；没点中返回 null */
export function hitSheetBtn(x: number, y: number): number | null {
  for (let i = 0; i < SHEET_VIEW_COUNT; i++) {
    if (inRect(x, y, sheetBtnRect(i))) return i;
  }
  return null;
}

// ============================================================
//  视图 0 右下那两块 15 格栏位
// ============================================================

/**
 * 道具欄（上，粉红底）/ 卡片欄（下，灰绿底）—— 各 5 列 × 3 行。
 *
 * @source VA 0x4236da（道具）/ 0x4237b3（卡片）：
 * ```
 * x = 300 ; 每格 dx = 72
 * 遍历 13 件道具 / 15 张手牌：数量为 0 的**跳过且不占格**（紧排）
 *   x += 72 ; 若 x > 588 → x = 300, y += 32
 * ```
 * ★ 道具格的图 = `Panel.mkf` 资源 **0x4a**（=74，13 张 24×20）的**第 i 张**，
 *   锚点落在 `(x − 16, y)`；格里的 `×N` 右对齐在 `x + 30`，16 号白字。
 * ★ 卡片格只画**卡名**（居中在 `(x, y)`），不画图标。
 */
export const SHEET_GRID = { x0: 300, dx: 72, dy: 32, wrapAt: 588, cols: 5 } as const;
export const SHEET_TOOL_GRID_Y0 = 281;
export const SHEET_CARD_GRID_Y0 = 385;
/** 道具图集 @source VA 0x4236da 的 `[0x48c274]`（= `read_mkf(panel_mkf, 0x4a, 0, 0)`） */
export const SHEET_TOOL_RESOURCE = 0x4a;
/** 格内文字：16 号白字 @source VA 0x423215 `create_font(0, 3, 0x101010, 0xffffff, 0x10)` */
export const SHEET_GRID_TEXT_SIZE = 0x10;

/** 第 k 个非空格的落点 */
export function sheetCell(k: number, y0: number): { x: number; y: number } {
  const row = Math.floor(k / SHEET_GRID.cols);
  return { x: SHEET_GRID.x0 + (k % SHEET_GRID.cols) * SHEET_GRID.dx, y: y0 + row * SHEET_GRID.dy };
}

// ============================================================
//  绘制
// ============================================================

/** 这一帧的界面态：**当前选中的东西** + **按下态** */
export interface SheetUi {
  /** 按下的下钻钮下标；`null` 表示没按 */
  btn: number | null;
  /** EXIT 是否按下 */
  exit: boolean;
  /** 视图 1 的种类 0..4 @source 原版 `[0x475400]` */
  kind: number;
  /** 视图 1 的行起点（每页 10 行）@source 原版 `[0x475404]` */
  pageStart: number;
  /** 按下的翻页箭头；`null` 表示没按 */
  arrow: 'up' | 'down' | null;
}

/** 锚点落点绘制 —— `(x, y)` 是图的 `anchorX/anchorY` 所在处 @source `fcn_00456418` */
function drawAnchored(
  ctx: CanvasRenderingContext2D,
  sprite: SheetSprite,
  archive: ArchiveName,
  resource: number,
  index: number,
  x: number,
  y: number,
  colorKeyBlack: boolean,
): void {
  const s = sprite(archive, resource, index, colorKeyBlack);
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/** 16 号白字带深色描边 @source VA 0x423215 `create_font(0, 3, 0x101010, 0xffffff, 0x10)` */
function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
): void {
  ctx.font = `${SHEET_GRID_TEXT_SIZE}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#101010';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

/** 黑字、指定字号与对齐 @source 各处的 `create_font(…, 0x101010, …)` */
function blackText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  align: CanvasTextAlign,
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#101010';
  ctx.fillText(text, x, y);
}

/**
 * 画整屏。
 *
 * @param selectedPlayer 当前**显示的是哪个玩家**（原版 `[0x48c27c]`，点页签可换）
 * @param view 当前视图 0..2（原版 `[0x4753fc]`）——底图就是该图号
 */
export function drawAssetSheet(
  ctx: CanvasRenderingContext2D,
  sprite: SheetSprite,
  state: GameState,
  topo: MapTopology,
  selectedPlayer: number,
  view: number,
  press: SheetUi = { btn: null, exit: false, kind: 0, pageStart: 0, arrow: null },
): void {
  // ── 底图（图号 = 视图号）@source VA 0x423088 ──
  const bg = sprite('Panel.mkf', SHEET_RESOURCE, view, false);
  if (bg !== null) ctx.drawImage(bg.bitmap, 0, 0);
  else {
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  const me = state.players[selectedPlayer];

  // ── EXIT 钮 @source VA 0x4230f4 / 按下 0x423e2b ──
  drawAnchored(
    ctx, sprite, 'Panel.mkf', SHEET_RESOURCE,
    press.exit ? SHEET_EXIT.pressed : SHEET_EXIT.normal,
    SHEET_EXIT.x, SHEET_EXIT.y, true,
  );

  // ── 头像 @source VA 0x4230bf ──
  if (me !== undefined) {
    drawAnchored(
      ctx, sprite, 'map.mkf', portraitResource(me.character), 0,
      SHEET_PORTRAIT_AT.x, SHEET_PORTRAIT_AT.y, true,
    );
  }

  // ── 神明图标 + 剩餘天数（godInfo == 0 时整块不画）@source VA 0x4231a1 ──
  if (me !== undefined && me.godInfo !== 0) {
    drawAnchored(
      ctx, sprite, 'Panel.mkf', SHEET_RESOURCE,
      SHEET_GOD_FIRST + me.godInfo - 1,
      SHEET_GOD_AT.x, SHEET_GOD_AT.y, true,
    );
    blackText(ctx, `${me.insuranceDays}天`, SHEET_GOD_DAYS.x, SHEET_GOD_DAYS.y, SHEET_GOD_DAYS.size, 'center');
  }

  // ── 12 个行标签 @source VA 0x422443 ──
  // ★ 原版把它们画进**图 0**（`[0x48c270] + 0xc`）—— 而底图取的是图 `[0x4753fc]`，
  //   所以只有视图 0 看得到这 12 个字段名；视图 1/2 的底图上没有它们。
  if (view === 0) {
    for (let i = 0; i < SHEET_LABELS.length; i++) {
      const at = SHEET_LABEL_AT[i]!;
      blackText(ctx, SHEET_LABELS[i]!, at.x, at.y, SHEET_LABEL_SIZE, 'center');
    }
  }

  // ── 两张清单的列名（同样是 `fcn_00422443` 的一部分，按视图二选一）──
  if (view === 1) drawHeader(ctx, SHEET_LIST0_X, SHEET_LIST0_Y, SHEET_LIST0_HEADER);
  else if (view === 2) drawHeader(ctx, SHEET_LIST1_X, SHEET_LIST1_Y, SHEET_LIST1_HEADER);

  // ── 三颗下钻钮 @source VA 0x4231c3 / 按下底 0x42419f ──
  for (let i = 0; i < SHEET_VIEW_COUNT; i++) {
    const r = sheetBtnRect(i);
    if (press.btn === i) {
      const plate = sprite('Panel.mkf', SHEET_RESOURCE, SHEET_BTN_PLATE, false);
      if (plate !== null) ctx.drawImage(plate.bitmap, r.x, r.y);
    }
    // 当前视图那颗白字、其余暗灰 @source VA 0x4231e3 的 0xffffff / 0xc0c0c0
    ctx.font = `${SHEET_BTN_TEXT.size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = i === view ? '#ffffff' : '#c0c0c0';
    ctx.fillText(SHEET_BTN_LABELS[i]!, SHEET_BTN_TEXT.x, SHEET_BTN_TEXT.y0 + i * SHEET_BTN.pitch);
  }

  // ── 玩家页签 @source VA 0x423237 ──
  const actives = activePlayers(state);
  for (let i = 0; i < actives.length; i++) {
    const who = actives[i]!;
    const x = SHEET_TAB.x0 + i * SHEET_TAB.pitch;
    const tab = sprite(
      'Panel.mkf', SHEET_RESOURCE,
      who === selectedPlayer ? SHEET_TAB.sel : SHEET_TAB.normal,
      false,
    );
    if (tab !== null) ctx.drawImage(tab.bitmap, x - tab.anchorX, SHEET_TAB.y - tab.anchorY);
    const p = state.players[who];
    blackText(
      ctx,
      CHARACTERS[p?.character ?? 0]?.name ?? `玩家${who + 1}`,
      x + SHEET_TAB.nameDx,
      SHEET_TAB.nameY,
      SHEET_TAB.size,
      'center',
    );
  }

  // ── 视图专属的数值 @source VA 0x4232d4 的跳表 ──
  if (view === 0) drawSummary(ctx, sprite, state, topo, selectedPlayer);
  else if (view === 1) drawEstateList(ctx, sprite, state, topo, selectedPlayer, press);
  else drawStockList(ctx, state, selectedPlayer);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  y: number,
  labels: readonly string[],
): void {
  for (let i = 0; i < labels.length; i++) {
    const x = xs[i];
    if (x !== undefined) blackText(ctx, labels[i]!, x, y, SHEET_LABEL_SIZE, 'center');
  }
}

/**
 * 视图 1：5 个种类格 + 数据行 + 两颗翻页箭头。
 *
 * @source 种类格 VA 0x423883；行 VA 0x4225a3；箭头 VA 0x42424e / 0x4242cd。
 */
function drawEstateList(
  ctx: CanvasRenderingContext2D,
  sprite: SheetSprite,
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
  press: SheetUi,
): void {
  // 5 个种类格：选中的那颗先盖 75×33 的图 11
  for (let i = 0; i < SHEET_KINDS.length; i++) {
    const x = SHEET_KIND_CELL.x0 + i * SHEET_KIND_CELL.w;
    if (i === press.kind) {
      const plate = sprite('Panel.mkf', SHEET_RESOURCE, SHEET_KIND_CELL.plate, false);
      if (plate !== null) ctx.drawImage(plate.bitmap, x, SHEET_KIND_CELL.y);
    }
    blackText(
      ctx,
      SHEET_KINDS[i]!,
      x + SHEET_KIND_CELL.textDx,
      SHEET_KIND_CELL.textY,
      SHEET_LABEL_SIZE,
      'center',
    );
  }

  // 数据行：每页 10 行、首行 y=144、步进 32
  const rows = assetRows(state, topo, playerIndex, press.kind);
  const shown = rows.slice(press.pageStart, press.pageStart + SHEET_PAGE_SIZE);
  for (let k = 0; k < shown.length; k++) {
    const row = shown[k]!;
    const y = SHEET_ROW_Y0 + k * SHEET_ROW_DY;
    const cells = [row.place, row.status, row.price, row.toll, row.tenure];
    for (let c = 0; c < SHEET_ROW_COL.length; c++) {
      const col = SHEET_ROW_COL[c]!;
      blackText(ctx, cells[c] ?? '', col.x, y, SHEET_LABEL_SIZE, col.align);
    }
  }

  // 两颗箭头：按下时盖图 7 / 图 8（常态那两颗烘在图 1 的底图里）
  for (const [which, y0, img] of [
    ['up', SHEET_ARROW.upY, SHEET_ARROW.upImg],
    ['down', SHEET_ARROW.downY, SHEET_ARROW.downImg],
  ] as const) {
    if (press.arrow !== which) continue;
    const arrow = sprite('Panel.mkf', SHEET_RESOURCE, img, false);
    if (arrow !== null) ctx.drawImage(arrow.bitmap, SHEET_ARROW.x, y0);
  }
}

/**
 * 视图 2：12 支股票各一行（**全列，不管有没有持仓**）。
 * @source VA 0x4238b1
 */
function drawStockList(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  playerIndex: number,
): void {
  const rows = stockRows(state, playerIndex);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const y = SHEET_STOCK_Y0 + i * SHEET_ROW_DY;
    const cells = [row.place, row.status, row.price];
    for (let c = 0; c < SHEET_STOCK_COL.length; c++) {
      const col = SHEET_STOCK_COL[c]!;
      blackText(ctx, cells[c] ?? '', col.x, y, SHEET_GOD_DAYS.size, col.align);
    }
  }
}

/** 视图 0：八条数值 + 中列四条计数 + 右下两块 15 格栏位 @source VA 0x4232f3 */
function drawSummary(
  ctx: CanvasRenderingContext2D,
  sprite: SheetSprite,
  state: GameState,
  topo: MapTopology,
  playerIndex: number,
): void {
  // 八条：前四条左列、后四条右列，都右对齐（flag 6）
  const values = sheetValues(state, topo, playerIndex);
  for (let i = 0; i < values.length; i++) {
    const x = i < 4 ? SHEET_VALUE_X.left : SHEET_VALUE_X.right;
    blackText(ctx, values[i]!, x, SHEET_VALUE_Y[i % 4]!, SHEET_VALUE_SIZE, 'right');
  }

  // 中列四条计数
  const counts = sheetCounts(state, topo, playerIndex);
  for (let i = 0; i < counts.length; i++) {
    blackText(ctx, counts[i]!, SHEET_COUNT_X, SHEET_COUNT_Y[i]!, SHEET_VALUE_SIZE, 'right');
  }

  const p = state.players[playerIndex];
  if (p === undefined) return;

  // 道具欄：数量为 0 的跳过且不占格 @source VA 0x4236da
  let k = 0;
  for (let t = 0; t < 13; t++) {
    const n = state.tools[playerIndex * 15 + t] ?? 0;
    if (n <= 0) continue;
    const { x, y } = sheetCell(k, SHEET_TOOL_GRID_Y0);
    const icon = sprite('Panel.mkf', SHEET_TOOL_RESOURCE, t, true);
    if (icon !== null) {
      ctx.drawImage(icon.bitmap, x - 0x10 - icon.anchorX, y - icon.anchorY);
    }
    outlinedText(ctx, `×${n}`, x + 0x1e, y, 'right');
    k++;
  }

  // 卡片欄：只画卡名 @source VA 0x4237b3
  let c = 0;
  for (let i = 0; i < 15; i++) {
    const id = p.cards[i] ?? 0;
    if (id <= 0) continue;
    const { x, y } = sheetCell(c, SHEET_CARD_GRID_Y0);
    outlinedText(ctx, CARDS[id - 1]?.name ?? '', x, y, 'center');
    c++;
  }
}
