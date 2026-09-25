/*
 * 公佈欄整屏的版面、命中与三路操作（T-033）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4.exe` 抄（`rich4_ui_sale.asm` + `tools/disasm.py`），
 * 把最容易写错的几条钉住：
 *   ① 底图 `Panel.mkf` #73 图 0 落在 **(22,66)**，不是 (0,0)；
 *   ② 挂牌格 72×72，首格 **(104,114)**、每人一行、每行 7 格；
 *   ③ 挂牌格的图号 = `8 + sex*4 + kind`（**女 9–12、男 13–16**）；
 *   ④ 弹出选单那四格是「先竖后横」（`序号 = 2*列 + 行`）；
 *   ⑤ 详情框三张图 640×480 居中，两颗钮的框内 x 是 0x10–0x58 / 0x68–0xb0。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  BOARD_SLOTS,
  CARD_LIST_MULTIPLIER,
  ESTATE_FACILITY_BASE,
  ESTATE_LAND_BASE,
  LISTING,
  decodeEstate,
  estateListPrice,
  makeFacility,
  makeGameState,
  makeLand,
  makePlayer,
  stockListPrice,
} from '@rich4/core';
import type { Action, GameState, MapTopology } from '@rich4/core';
import {
  BOARD_CELL,
  BOARD_CLOSE_CHUNK,
  BOARD_COLS,
  BOARD_EXIT_HIT,
  BOARD_FULL_MSG,
  BOARD_MSG_CHUNK,
  BOARD_MSG_MS,
  BOARD_PANEL_AT,
  BOARD_PANEL_CHUNK,
  BOARD_POPUP_AT,
  BOARD_POPUP_CHUNK,
  BOARD_POPUP_GRID,
  BOARD_PORTRAIT_AT,
  BOARD_RESOURCE,
  BOARD_ROW_Y0,
  BOARD_SALE_HIT,
  BOARD_SALE_KINDS,
  BOARD_SLOT_CHUNK_FIRST,
  BOARD_SLOT_X0,
  BOARD_TOOL_RESOURCE,
  DETAIL_BTN_Y,
  DETAIL_CHUNK,
  DETAIL_SIZE,
  LIST_PRICE_MAX_FACTOR,
  PICK_ESTATE,
  PICK_ESTATE_COL,
  PICK_GRID,
  PICK_STOCK,
  boardDetailRect,
  PORTRAIT_RESOURCE_FIRST,
  boardKeyed,
  boardPickItems,
  boardPortraitAt,
  boardPriceUi,
  boardScreen,
  boardScreenState,
  boardSlotRect,
  boardView,
  buyAction,
  detailText,
  hitBoardDetailButton,
  hitBoardExit,
  hitBoardSale,
  hitBoardSlot,
  clampPickTop,
  estateFeeLabel,
  estateTabMatches,
  estateTenureLabel,
  confirmChose,
  hitYesNo,
  hitPickEstateBar,
  PICK_ESTATE_VISIBLE_ROWS,
  pickTopAfterBar,
  hitPickEstateRow,
  hitPickEstateTab,
  hitPickGrid,
  hitPickGridExit,
  hitPickStockExit,
  hitPickStockRow,
  hitSalePopup,
  listAction,
  listInputLabel,
  listInputMax,
  marketPriceOf,
  pickGridCellAt,
  resetBoardScreen,
  slotChunk,
  withdrawAction,
} from './board-screen.ts';
import { layoutDialog } from './dialog.ts';
import { LAYOUT } from './stage.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  假的 env —— 单测不碰 canvas
// ============================================================

/** `layoutDialog` 只用到 `font` 与 `measureText`，够用了 */
function fakeStage(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (t: string) => ({ width: t.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

interface Harness {
  env: UiScreenEnv;
  /** 屏上点出来的 action（开 / 关窗那两步另记在 `edges`）*/
  actions: Action[];
  /** 开窗清理 / 关窗收回（`noticeBoard` 的 `open` / `close`）*/
  edges: Action[];
  logs: string[];
  renders: number;
}

function harness(state: GameState, topo: MapTopology = { nodes: [] }): Harness {
  const actions: Action[] = [];
  const edges: Action[] = [];
  const logs: string[] = [];
  const h: Harness = {
    actions,
    edges,
    logs,
    renders: 0,
    env: {
      screen: 'game',
      state,
      topo,
      map: {} as UiScreenEnv['map'],
      now: 1000,
      stage: fakeStage(),
      sprite: () => null,
      dispatch: (a) =>
        (a.type === 'noticeBoard' && (a.op === 'open' || a.op === 'close') ? edges : actions).push(a),
      requestRender: () => {
        h.renders += 1;
      },
      log: (m) => logs.push(m),
      flic: () => null,
      playEffect: () => undefined,
      stopEffect: () => undefined,
    },
  };
  return h;
}

/**
 * 一次完整的「按下 + 抬手」（抬手在同一处）。
 *
 * ★ 成立在**抬手**（原版 `0x202`），所以 `down` 之后必须再 `up`。
 */
function click(env: UiScreenEnv, x: number, y: number): void {
  boardScreen.down?.(x, y, env);
  boardScreen.up?.(x, y, env);
}

/**
 * 「按下 → 拖到 (mx,my) → 抬手」—— **SALE 弹单唯一的点法**。
 *
 * @source VA 0x00427f12（`0x201` 在按下那一刻把选单贴上去）+
 *   0x00427cfd（`0x200` 在拖动时记下悬停到第几格 `[0x48c2cb]`）+
 *   0x004281d4（`0x202` 才按那一格开选物窗）。
 *   也就是说：**在 SALE 上原地点一下是打不开选物窗的** —— 选单会一闪就收掉。
 */
function drag(env: UiScreenEnv, x: number, y: number, mx: number, my: number): void {
  boardScreen.down?.(x, y, env);
  boardScreen.move?.(mx, my, env);
  boardScreen.up?.(mx, my, env);
}

/** 开屏（熱鍵「交易」= 13）*/
function openBoard(env: UiScreenEnv): void {
  resetBoardScreen();
  expect(boardScreen.hotkey?.(13, env)).toBe(true);
}

/** 四位玩家的挂牌栏，`list(玩家, 槽, 类型)` 造一项 */
function stateWithBoard(
  entries: readonly { seller: number; slot: number; kind: number; id: number; price: number; amount: number }[],
  over: Partial<GameState> = {},
): GameState {
  const board = [0, 1, 2, 3].map(() => new Array(7).fill(null));
  for (const e of entries) {
    const col = board[e.seller];
    if (col === undefined) continue;
    col[e.slot] = { kind: e.kind, id: e.id, price: e.price, amount: e.amount };
  }
  return makeGameState({ noticeBoard: board, ...over });
}

// ============================================================
//  图与常量
// ============================================================

describe('用到的图 @source rich4_ui_sale.asm', () => {
  it('★ 底图是 Panel.mkf 资源 73（#73），道具图标在资源 74', () => {
    expect(BOARD_RESOURCE).toBe(0x49);
    expect(BOARD_TOOL_RESOURCE).toBe(0x4a);
    expect(BOARD_PANEL_CHUNK).toBe(0);
    expect(BOARD_POPUP_CHUNK).toBe(17);
    expect(BOARD_MSG_CHUNK).toBe(5);
    expect(BOARD_CLOSE_CHUNK).toBe(18);
  });

  it('★ 挂牌格图号 = 8 + sex*4 + kind —— 女 9–12、男 13–16', () => {
    expect(BOARD_SLOT_CHUNK_FIRST).toBe(8);
    expect([1, 2, 3, 4].map((k) => slotChunk(false, k))).toEqual([9, 10, 11, 12]);
    expect([1, 2, 3, 4].map((k) => slotChunk(true, k))).toEqual([13, 14, 15, 16]);
  });

  it('★ 详情框：股票用图 7、地產用图 8、道具／卡片共用图 6（表 0x4754ac = 7,8,6,6）', () => {
    expect(DETAIL_CHUNK).toEqual({ 1: 7, 2: 8, 3: 6, 4: 6 });
    expect(DETAIL_SIZE[6]).toEqual({ w: 192, h: 224 });
    expect(DETAIL_SIZE[7]).toEqual({ w: 192, h: 256 });
    expect(DETAIL_SIZE[8]).toEqual({ w: 192, h: 288 });
  });

  it('★ 弹出选单第 i 格 → 挂牌类型 1/2/3/4（走势图/房子/炸药/牌）', () => {
    expect(BOARD_SALE_KINDS).toEqual([1, 2, 3, 4]);
  });
});

describe('抠黑表 @source 逐图核过的两个 blit', () => {
  it('★ 底图 0 **不抠** —— 它内部那 0.2% 纯黑是 SALE／EXIT 钮框里的图案', () => {
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 0)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 1)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 2)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 5)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 6)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 7)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 8)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 17)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 18)).toBe(false);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 19)).toBe(false);
  });

  it('★ 挂牌格 9–16 一张都不抠（原版走不透明的 `fcn_004563f5`）', () => {
    for (let i = 9; i <= 16; i++) expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, i)).toBe(false);
  });

  it('★ 只有图 3 / 4 两张选物窗底板抠（原版走 `fcn_00456418`）', () => {
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 3)).toBe(true);
    expect(boardKeyed('Panel.mkf', BOARD_RESOURCE, 4)).toBe(true);
  });

  it('★ 头像（`map.mkf` 27..38）与道具图标（`Panel.mkf` #74）抠', () => {
    for (let c = 0; c < 12; c++) {
      expect(boardKeyed('map.mkf', PORTRAIT_RESOURCE_FIRST + c, 0)).toBe(true);
    }
    expect(boardKeyed('Panel.mkf', BOARD_TOOL_RESOURCE, 0)).toBe(true);
    expect(boardKeyed('Panel.mkf', BOARD_TOOL_RESOURCE, 12)).toBe(true);
    // 别把 `map.mkf` 的别的资源也当成头像
    expect(boardKeyed('map.mkf', PORTRAIT_RESOURCE_FIRST - 1, 0)).toBe(false);
    // 别的档案一律不抠
    expect(boardKeyed('Data.mkf', 517, 5)).toBe(false);
  });

  it('★ 挂牌栏格数用 core 的 BOARD_SLOTS，与版面常量一致', () => {
    expect(BOARD_SLOTS).toBe(7);
    expect(BOARD_COLS).toBe(BOARD_SLOTS);
  });
});

describe('版面 @source VA 0x004249c2 / 0x004284be', () => {
  it('★ 底图（596×348）落在 (22,66) —— 不是 (0,0)，四周是黑的', () => {
    expect(BOARD_PANEL_AT).toEqual({ x: 22, y: 66 });
  });

  it('★ 首格 (104,114)、格 72×72、每行 7 格；末格 (536,330)', () => {
    expect(BOARD_SLOT_X0).toBe(104);
    expect(BOARD_ROW_Y0).toBe(114);
    expect(BOARD_CELL).toBe(72);
    expect(BOARD_COLS).toBe(7);
    expect(boardSlotRect(0, 0)).toEqual({ x: 104, y: 114, w: 72, h: 72 });
    expect(boardSlotRect(0, 6)).toEqual({ x: 536, y: 114, w: 72, h: 72 });
    expect(boardSlotRect(3, 6)).toEqual({ x: 536, y: 330, w: 72, h: 72 });
  });

  it('★ 头像锚点：(66, 150 + 72×玩家号) —— 图内 (44,84) 加底图落点 (22,66)', () => {
    expect(BOARD_PORTRAIT_AT).toEqual({ x: 44, y: 84 });
    expect(boardPortraitAt(0)).toEqual({ x: 66, y: 150 });
    expect(boardPortraitAt(3)).toEqual({ x: 66, y: 366 });
    // 头像行与挂牌格行对齐：第 0 格在 y=114，头像 85×71、锚点 y=34 → 上边 116
    expect(boardPortraitAt(0).y - 34).toBe(BOARD_ROW_Y0 + 2);
  });

  it('★ SALE / EXIT 两颗钮都在 y∈(74,114)：SALE x∈(464,536)、EXIT x∈(536,608)', () => {
    expect(BOARD_SALE_HIT).toEqual({ x0: 464, y0: 74, x1: 536, y1: 114 });
    expect(BOARD_EXIT_HIT).toEqual({ x0: 536, y0: 74, x1: 608, y1: 114 });
  });

  it('★ 弹出选单落在 (464,116)，四格「先竖后横」：格距 63×39、高亮框 62×38', () => {
    expect(BOARD_POPUP_AT).toEqual({ x: 464, y: 116 });
    expect(BOARD_POPUP_GRID).toMatchObject({ x0: 473, y0: 125, cw: 63, ch: 39, hw: 62, hh: 38 });
  });

  it('★ 详情框三张图都居中：股票 (224,112)、地產 (224,96)、道具/卡片 (224,128)', () => {
    expect(boardDetailRect(1)).toEqual({ x: 224, y: 112, w: 192, h: 256 });
    expect(boardDetailRect(2)).toEqual({ x: 224, y: 96, w: 192, h: 288 });
    expect(boardDetailRect(3)).toEqual({ x: 224, y: 128, w: 192, h: 224 });
    expect(boardDetailRect(4)).toEqual({ x: 224, y: 128, w: 192, h: 224 });
  });

  it('★ 详情框两颗钮的 y 各类型不同：股票 0xec、地產 0x109、道具/卡片 0xcb', () => {
    expect(DETAIL_BTN_Y).toEqual({ 1: 0xec, 2: 0x109, 3: 0xcb, 4: 0xcb });
  });

  it('★ 訊息框落在 (227,196)（flag 1 那一支），活 1500ms', () => {
    expect(BOARD_MSG_MS).toBe(1500);
    expect(BOARD_FULL_MSG).toBe('公佈欄已滿\n\n請先撤件！');
  });
});

// ============================================================
//  命中
// ============================================================

describe('挂牌格的命中 @source VA 0x00428085', () => {
  it('★ 28 格每格的第一颗像素与中心都命中自己', () => {
    // ⚠️ 画的格子是 72×72、首格左上角 (104,114)；命中的**除算基准**也是 (104,114)
    //   但那两个界是**开**区间，所以第 0 格真正能吃到的第一颗像素是 (105,115)
    //   —— 原版如此（与商店屏那 1px 错位是同一类），照抄不改。
    for (let p = 0; p < 4; p++) {
      for (let s = 0; s < BOARD_COLS; s++) {
        const r = boardSlotRect(p, s);
        expect(hitBoardSlot(r.x + 1, r.y + 1, 4)).toEqual({ player: p, slot: s });
        expect(hitBoardSlot(r.x + 36, r.y + 36, 4)).toEqual({ player: p, slot: s });
      }
    }
  });

  it('★ 边界都是开区间：基准那一列／那一行不算，x=608 不算，最后一个像素算', () => {
    expect(hitBoardSlot(104, 115, 4)).toBeNull();
    expect(hitBoardSlot(105, 114, 4)).toBeNull();
    expect(hitBoardSlot(104, 200, 4)).toBeNull();
    expect(hitBoardSlot(105, 200, 4)).toEqual({ player: 1, slot: 0 });
    expect(hitBoardSlot(200, 114, 4)).toBeNull();
    expect(hitBoardSlot(200, 115, 4)).toEqual({ player: 0, slot: 1 });
    expect(hitBoardSlot(607, 115, 4)).toEqual({ player: 0, slot: 6 });
    expect(hitBoardSlot(608, 115, 4)).toBeNull();
  });

  it('★ 行数跟着玩家数走：3 人局的第 4 行不算', () => {
    expect(hitBoardSlot(200, 340, 3)).toBeNull();
    expect(hitBoardSlot(200, 340, 4)).toEqual({ player: 3, slot: 1 });
  });
});

describe('SALE / EXIT 的命中 @source VA 0x00427ea1 / 0x00427fc8', () => {
  it('★ 两颗钮：四角之内算、边界那一像素不算、框外不算', () => {
    expect(hitBoardSale(465, 75)).toBe(true);
    expect(hitBoardSale(535, 113)).toBe(true);
    expect(hitBoardSale(464, 75)).toBe(false);
    expect(hitBoardSale(536, 75)).toBe(false);
    expect(hitBoardSale(500, 114)).toBe(false);
    expect(hitBoardExit(537, 75)).toBe(true);
    expect(hitBoardExit(607, 113)).toBe(true);
    expect(hitBoardExit(536, 75)).toBe(false);
    expect(hitBoardExit(608, 75)).toBe(false);
  });

  it('★ 两颗钮的框不重叠（SALE 到 0x218 为止、EXIT 从 0x218 起）', () => {
    expect(hitBoardSale(535, 90)).toBe(true);
    expect(hitBoardExit(535, 90)).toBe(false);
    expect(hitBoardSale(537, 90)).toBe(false);
    expect(hitBoardExit(537, 90)).toBe(true);
  });
});

describe('弹出选单的命中 @source VA 0x00427cfd', () => {
  it('★ 四格：序号 = 2*列 + 行（先竖后横）→ 左上 0、左下 1、右上 2、右下 3', () => {
    expect(hitSalePopup(480, 130)).toBe(0);
    expect(hitSalePopup(480, 170)).toBe(1);
    expect(hitSalePopup(545, 130)).toBe(2);
    expect(hitSalePopup(545, 170)).toBe(3);
  });

  it('★ 边界是开区间：x=473 / y=125 / x=598 / y=202 都不算', () => {
    expect(hitSalePopup(473, 130)).toBeNull();
    expect(hitSalePopup(480, 125)).toBeNull();
    expect(hitSalePopup(598, 130)).toBeNull();
    expect(hitSalePopup(480, 202)).toBeNull();
  });
});

describe('详情框那两颗钮的命中 @source VA 0x00427a18', () => {
  it('★ 股票（框在 (224,112)、btnY=0xec）：撤件 x∈(240,312)、EXIT x∈(328,400)', () => {
    const y = 112 + 0xec;
    expect(hitBoardDetailButton(1, 250, y)).toBe('action');
    expect(hitBoardDetailButton(1, 390, y)).toBe('exit');
    expect(hitBoardDetailButton(1, 316, y)).toBeNull(); // 两颗钮之间那道缝
    expect(hitBoardDetailButton(1, 250, y - 12)).toBeNull(); // 上下各半高 0xc
    expect(hitBoardDetailButton(1, 250, y + 12)).toBeNull();
  });

  it('★ 地產那一屏的钮更靠下（框在 (224,96)、btnY=0x109）', () => {
    const y = 96 + 0x109;
    expect(hitBoardDetailButton(2, 250, y)).toBe('action');
    expect(hitBoardDetailButton(2, 250, 112 + 0xec)).toBeNull();
  });
});

describe('选物窗的命中', () => {
  it('★ 卡片／道具：5 列 × 3 行，格距 72×32，首格名字在 (176,208)', () => {
    expect(pickGridCellAt(0)).toEqual({ x: 176, y: 208 });
    expect(pickGridCellAt(4)).toEqual({ x: 464, y: 208 });
    expect(pickGridCellAt(5)).toEqual({ x: 176, y: 240 });
    expect(pickGridCellAt(14)).toEqual({ x: 464, y: 272 });
  });

  it('★ 卡片／道具的行命中：`((y−0xc0)/0x20)*5 + (x−0x8c)/0x48`', () => {
    expect(hitPickGrid(177, 209, 15)).toBe(0);
    expect(hitPickGrid(465, 273, 15)).toBe(14);
    expect(hitPickGrid(465, 273, 14)).toBeNull(); // 只有 14 件时最后一格没有
    expect(hitPickGrid(140, 193, 15)).toBeNull(); // 基准那一列不算
    expect(hitPickGrid(177, 192, 15)).toBeNull();
  });

  it('★ 卡片／道具的 ✕：`x∈(0x1ac,0x1f4) ∧ y∈(0xa0,0xc0)`', () => {
    expect(hitPickGridExit(429, 161)).toBe(true);
    expect(hitPickGridExit(428, 161)).toBe(false);
    expect(hitPickGridExit(500, 161)).toBe(false);
    expect(hitPickGridExit(429, 160)).toBe(false);
  });

  it('★ 股票：行 32px、第一行文字 y=0x50，命中 y∈(0x40,0x1c0)', () => {
    expect(hitPickStockRow(200, 80, 3)).toBe(0);
    expect(hitPickStockRow(200, 112, 3)).toBe(1);
    expect(hitPickStockRow(200, 80, 0)).toBeNull();
    expect(hitPickStockRow(152, 80, 3)).toBeNull(); // 基准那一列不算
    expect(hitPickStockRow(200, 64, 3)).toBeNull();
  });

  it('★ 股票的 ✕ 是图 18（21×21），框 `x∈(0x1cf,0x1e4) ∧ y∈(0x26,0x3b)`', () => {
    expect(hitPickStockExit(464, 40)).toBe(true);
    expect(hitPickStockExit(463, 40)).toBe(false);
    expect(hitPickStockExit(484, 40)).toBe(false);
  });

  it('★ 地產：行从 y=0x60 起、页签在 y∈(0x20,0x3e)、✕ 在右边那条 16px 竖带上', () => {
    expect(hitPickEstateRow(200, 100, 3)).toBe(0);
    expect(hitPickEstateRow(200, 132, 3)).toBe(1);
    expect(hitPickEstateRow(112, 100, 3)).toBeNull();
    expect(hitPickEstateTab(152, 48)).toBe(0);
    expect(hitPickEstateTab(232, 48)).toBe(1);
    expect(hitPickEstateTab(472, 48)).toBe(4);
    expect(hitPickEstateTab(520, 48)).toBeNull();
    expect(hitPickEstateBar(515, 40)).toBe('close'); // ✕ y∈(32,51)
    expect(hitPickEstateBar(515, 80)).toBe('up'); // ▲ y∈(64,96)
    expect(hitPickEstateBar(515, 100)).toBe('down'); // ▼ y∈(96,128)
    expect(hitPickEstateBar(510, 40)).toBeNull();
    // ★★ 2026-09-16（外部审查 B-6(ii)）：这两个返回值以前被调用点丢掉，
    //   滚动条画了不响。现在有真正的滚动语义 —— 见下面那两条用例。
  });

  it('★★ 地產清单「收費 / 租期」两列有值（B-6(ii) 补完）', () => {
    const state = stateWithBoard([]);
    // 收費：走引擎自己的 `calculateLandToll`（连锁店那支）—— 与规则同一份。
    // 空手（一块地都没有）→ 0；有 n 个连锁店 → `2000 × n × 物價指數`。
    const emptyLands = [] as never;
    expect(estateFeeLabel(state, { lands: emptyLands } as never, ESTATE_LAND_BASE + 1)).toBe('$0');
    const chain = (id: number) => ({
      id, name: `L${id}`, type: 1, level: 0, owner: state.currentPlayer + 1,
      landPrice: 0, housePrice: 0, rentByLevel: [], priceStatus: 0,
    });
    const fee = estateFeeLabel(state, { lands: [chain(1), chain(2)] } as never, ESTATE_LAND_BASE + 1);
    expect(fee).toBe(`$${(2000 * 2 * state.priceIndex).toLocaleString('en-US')}`);
    // 租期：`0` = 「無限期」；否则是**绝对到期日** `YY/M/D`（格式串 `0x463e37`，年 = (v>>16)/100）
    //   打包 = `(年<<16)|(月<<8)|日`（`rules/calendar.ts` 的 `packDate` 同一套）
    const packed = (y: number, m: number, d: number): number => ((y << 16) | (m << 8) | d) >>> 0;
    expect(
      estateTenureLabel({ ...state, landTenure: [0, packed(2002, 10, 23)] } as never, ESTATE_LAND_BASE + 1),
    ).toBe('20/10/23');
    expect(estateTenureLabel({ ...state, landTenure: [0, 0] } as never, ESTATE_LAND_BASE + 1)).toBe('無限期');
    expect(
      estateTenureLabel({ ...state, facilityTenure: [packed(2003, 1, 5)] } as never, ESTATE_FACILITY_BASE + 0),
    ).toBe('20/1/5');
    // ★ 年月日三个字段各取自己的位：年只补零到两位、月/日**不补零**（`%02d/%d/%d`）
    expect(
      estateTenureLabel({ ...state, landTenure: [0, packed(1999, 12, 31)] } as never, ESTATE_LAND_BASE + 1),
    ).toBe('19/12/31');
  });

  it('★★ 五个页签的筛选逐条照 `fcn_00423b3b`（这是**筛选**，不是「一件东西一个页签」）', () => {
    // 四块地：等级 0 的住宅空地 / 等级 2 的住宅 / 等级 3 的连锁店 / 等级 0 的连锁店空地
    const state = {
      ...stateWithBoard([]),
      landLevel: [0, 0, 2, 3, 0],
      landType: [0, 0, 0, 1, 1],
      facilityLevel: [0, 4],
    } as never;
    const L = (id: number): number => ESTATE_LAND_BASE + id;
    const F = (id: number): number => ESTATE_FACILITY_BASE + id;
    // 页签 0「全部」：地块与設施都收
    for (const id of [L(1), L(2), L(3), L(4), F(1)]) {
      expect(estateTabMatches(state, id, 0), `全部 ${id}`).toBe(true);
    }
    // 页签 1「住宅區」：**只地块、不再筛等级/类型**（原版 0x423bd1 就只看 owner）
    //   ⇒ 等级 0 的、已建的、连锁店的地块**全在**这一页
    for (const id of [L(1), L(2), L(3), L(4)]) expect(estateTabMatches(state, id, 1)).toBe(true);
    expect(estateTabMatches(state, F(1), 1)).toBe(false);
    // 页签 2「商業區」：只設施
    expect(estateTabMatches(state, F(1), 2)).toBe(true);
    for (const id of [L(1), L(2), L(3), L(4)]) expect(estateTabMatches(state, id, 2)).toBe(false);
    // 页签 3「房屋」：等级 != 0 且类型 == 0
    expect(estateTabMatches(state, L(2), 3)).toBe(true);
    expect(estateTabMatches(state, L(1), 3)).toBe(false); // 等级 0
    expect(estateTabMatches(state, L(3), 3)).toBe(false); // 连锁店
    expect(estateTabMatches(state, F(1), 3)).toBe(false); // 只收地块
    // 页签 4「連鎖店」：等级 != 0 且类型 != 0 —— ★ **等级 0 的连锁店空地不算**
    expect(estateTabMatches(state, L(3), 4)).toBe(true);
    expect(estateTabMatches(state, L(4), 4)).toBe(false);
    expect(estateTabMatches(state, L(2), 4)).toBe(false);
    expect(estateTabMatches(state, F(1), 4)).toBe(false);
    // 越界页签一律不认
    expect(estateTabMatches(state, L(2), 5)).toBe(false);
    expect(estateTabMatches(state, L(2), -1)).toBe(false);
  });

  it('★★ 收費那一列**逐行**算（住宅 = 同名区 / 连锁店 = 玩家合计 / 設施 = 自己那张表）', () => {
    const me = 1; // currentPlayer 0 → owner = 1
    const land = (
      id: number,
      over: Partial<{ name: string; type: number; level: number; owner: number; rent: number[] }> = {},
    ) => ({
      id,
      name: over.name ?? `L${id}`,
      type: over.type ?? 0,
      level: over.level ?? 2,
      owner: over.owner ?? 0,
      landPrice: 1000,
      housePrice: 200,
      rentByLevel: over.rent ?? [0, 100, 250, 400, 600, 900],
      priceStatus: 0,
    });
    // ① 住宅：同主同名两块的**收费之和**（不是全图、也不是单块）
    const housing = {
      ...stateWithBoard([]),
      currentPlayer: 0,
      priceIndex: 2,
      landOwner: [0, me, me, 9] as number[], // 3 号是**别人的**同名地
      landLevel: [0, 2, 2, 2] as number[],
      landType: [0, 0, 0, 0] as number[],
    } as never;
    const topo1 = {
      lands: [land(1, { name: '甲', rent: [0, 100, 250] }), land(2, { name: '甲', rent: [0, 100, 250] }), land(3, { name: '甲', owner: 9 })],
      facilities: [],
    } as never;
    // (250 + 250) × 2 —— 3 号不是我的，不计
    expect(estateFeeLabel(housing, topo1, ESTATE_LAND_BASE + 1)).toBe(
      `$${((250 + 250) * 2).toLocaleString('en-US')}`,
    );
    // ② 连锁店：**该玩家全部连锁店**的合计（每一行同一个数，原版如此）
    const chainState = {
      ...stateWithBoard([]),
      currentPlayer: 0,
      priceIndex: 3,
      landOwner: [0, me, me] as number[],
      landLevel: [0, 1, 4] as number[],
      landType: [0, 5, 5] as number[], // 非 0 = 连锁店（等级不必相同）
    } as never;
    const topo2 = {
      lands: [land(1, { type: 5, level: 1 }), land(2, { type: 5, level: 4 })],
      facilities: [],
    } as never;
    const chainFee = `$${(2000 * 2 * 3).toLocaleString('en-US')}`;
    expect(estateFeeLabel(chainState, topo2, ESTATE_LAND_BASE + 1)).toBe(chainFee);
    expect(estateFeeLabel(chainState, topo2, ESTATE_LAND_BASE + 2)).toBe(chainFee);
    // ③ ★ 归属看**运行时**（静态表 owner 恒 0）：把静态 owner 清成 0，费用不该变
    const topoStatic = {
      lands: [land(1, { type: 5, owner: 0 }), land(2, { type: 5, owner: 0 })],
      facilities: [],
    } as never;
    expect(estateFeeLabel(chainState, topoStatic, ESTATE_LAND_BASE + 1)).toBe(chainFee);
    // ④ 設施：`rateByLevel[等级] × 物價指數`；类型 0 或等级 0 → `$0`
    const facState = {
      ...stateWithBoard([]),
      currentPlayer: 0,
      priceIndex: 5,
      facilityLevel: [0, 3, 0, 2] as number[],
      facilityType: [0, 4, 4, 0] as number[],
    } as never;
    const topo3 = {
      lands: [],
      facilities: [
        { id: 1, rateByLevel: [0, 10, 20, 30] },
        { id: 2, rateByLevel: [0, 10, 20, 30] },
        { id: 3, rateByLevel: [0, 10, 20, 30] },
      ],
    } as never;
    expect(estateFeeLabel(facState, topo3, ESTATE_FACILITY_BASE + 1)).toBe(`$${(30 * 5).toLocaleString('en-US')}`);
    expect(estateFeeLabel(facState, topo3, ESTATE_FACILITY_BASE + 2)).toBe('$0'); // 等级 0
    expect(estateFeeLabel(facState, topo3, ESTATE_FACILITY_BASE + 3)).toBe('$0'); // 类型 0
  });

  it('★★ 地產清单的滚动：按一屏夹取、上下各滚一屏', () => {
    // ★ 2026-09-17：一屏 = **11 行**，是 exe 写死的常量，不是几何推算
    expect(PICK_ESTATE_VISIBLE_ROWS).toBe(0xb);
    const rows = PICK_ESTATE_VISIBLE_ROWS;
    // 件数比一屏少 → 怎么滚都停在 0
    expect(clampPickTop(0, rows - 1)).toBe(0);
    expect(clampPickTop(5, 1)).toBe(0);
    expect(pickTopAfterBar(0, 3, 'down')).toBe(0);
    // 刚好一屏 → 也不能滚
    expect(clampPickTop(3, rows)).toBe(0);
    // 两屏的件数 → 最多滚到 rows
    expect(clampPickTop(999, rows * 2)).toBe(rows * 2 - rows);
    // 下滚一屏、上滚一屏，并在两端夹住
    expect(pickTopAfterBar(0, rows * 3, 'down')).toBe(rows);
    expect(pickTopAfterBar(rows, rows * 3, 'up')).toBe(0);
    expect(pickTopAfterBar(0, rows * 3, 'up')).toBe(0);
    // 非法输入不许算出 NaN
    expect(clampPickTop(Number.NaN, 99)).toBe(0);
    expect(clampPickTop(-7, 99)).toBe(0);
  });

  it('★★ 「一屏 11 行」是 exe 常量，不是几何推算 —— 逐字节对照 0xb 的四处', () => {
    // @source VA 0x00424b56 / 0x00424b82 `add eax, 0xb`（上/下滚一页 = 11 行）
    //          VA 0x00424b75 `lea eax, [ebx - 0xb]`（上滚）
    //          VA 0x00424ba0 `mov dword [0x4754be], 0xb`（满一屏时画几行）
    //          VA 0x00424c64 `cmp edi, [0x4754be]`（行循环就按这个数走）
    //   ★ 2026-09-17 订正：本模块原先按几何算成 10（(h − rowY0)/rowDy），
    //     把表头那段也当成一行了。11 行才对：首行中心 0x70、末行 0x1b0、窗底 0x1c0。
    const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
    if (existsSync(EXE)) {
      const buf = readFileSync(EXE);
      const fo = (va: number) => 1024 + (va - 0x401000); // 代码段 VA → 文件偏移
      const at = (va: number, n: number) => [...buf.subarray(fo(va), fo(va) + n)];
      expect(at(0x424b56, 3)).toEqual([0x83, 0xc0, 0x0b]);
      expect(at(0x424b75, 3)).toEqual([0x8d, 0x43, 0xf5]);
      expect(at(0x424b82, 3)).toEqual([0x83, 0xc0, 0x0b]);
      expect(at(0x424ba0, 10)).toEqual([
        0xc7, 0x05, 0xbe, 0x54, 0x47, 0x00, 0x0b, 0x00, 0x00, 0x00,
      ]);
      expect(at(0x424c64, 6)).toEqual([0x3b, 0x3d, 0xbe, 0x54, 0x47, 0x00]);
    }
    expect(PICK_ESTATE_VISIBLE_ROWS).toBe(0x0b);
  });

  it('★ 地產的列 x：表头 147/231/319/395/471，價格/收費 再各加 0x21/0x1d', () => {
    expect(PICK_ESTATE_COL.map((c) => c.x)).toEqual([147, 231, 352, 424, 471]);
    expect(PICK_ESTATE_COL.map((c) => c.align)).toEqual([
      'center',
      'center',
      'right',
      'right',
      'center',
    ]);
    expect(PICK_STOCK.at).toEqual({ x: 152, y: 32 });
    expect(PICK_GRID.at).toEqual({ x: 140, y: 160 });
  });

  it('★ 地產行的中心 y = 0x70 + 0x20×行号（命中基准 0x60 是那條分隔线）', () => {
    expect(PICK_ESTATE.rowTextY0).toBe(112);
    expect(PICK_ESTATE.rowY0).toBe(96);
    expect(PICK_ESTATE.rowTextY0 - PICK_ESTATE.rowY0).toBe(16);
  });
});

// ============================================================
//  取数
// ============================================================

describe('boardView @source VA 0x00424a1d', () => {
  it('★ 每位玩家定长 7 格，空槽是 null', () => {
    const state = stateWithBoard([{ seller: 2, slot: 3, kind: 4, id: 7, price: 3500, amount: 0 }]);
    const view = boardView(state);
    expect(view.me).toBe(0);
    expect(view.players).toHaveLength(4);
    expect(view.players[2]?.slots).toHaveLength(7);
    expect(view.players[2]?.slots[0]).toBeNull();
    expect(view.players[2]?.slots[3]).toEqual({
      slot: 3,
      seller: 2,
      kind: 4,
      id: 7,
      price: 3500,
      amount: 0,
    });
  });

  it('★ 「滿了」看最后一格（0x00427ee6）', () => {
    const six = stateWithBoard(
      [0, 1, 2, 3, 4, 5].map((s) => ({ seller: 0, slot: s, kind: 3, id: 2, price: 3000, amount: 0 })),
    );
    expect(boardView(six).players[0]?.full).toBe(false);
    const seven = stateWithBoard(
      [0, 1, 2, 3, 4, 5, 6].map((s) => ({ seller: 0, slot: s, kind: 3, id: 2, price: 3000, amount: 0 })),
    );
    expect(boardView(seven).players[0]?.full).toBe(true);
  });

  it('★ 名字与「男/女」都从角色表来（决定挂牌格用哪张图）', () => {
    const state = makeGameState({
      players: [makePlayer({ index: 0, character: 0, isMale: false })],
    });
    const row = boardView(state).players[0];
    expect(row?.isMale).toBe(false);
    expect(row?.name).not.toBe('');
  });
});

describe('市價与详情框的字 @source VA 0x004273xx / 0x00426af2 / 0x004265f5', () => {
  it('★ 道具：標價 × 100 × 物價指數 —— 路障 30 → 3,000（S13 截图那一笔）', () => {
    expect(CARD_LIST_MULTIPLIER).toBe(100);
    const state = stateWithBoard([], { priceIndex: 1 });
    // 路障 = 道具 2，標價 30
    expect(marketPriceOf(state, { nodes: [] }, LISTING.tool, 2, 0)).toBe(3000);
  });

  it('★ 股票：round(股數 × 現價)', () => {
    const state = stateWithBoard([], {});
    const price = state.market.stocks[0]?.price ?? 0;
    expect(marketPriceOf(state, { nodes: [] }, LISTING.stock, 0, 7)).toBe(
      Math.round(7 * price),
    );
  });

  it('★ 地產那一行的市價就是 core 的 `estateListPrice`（本模块不再自己算）', () => {
    const topo: MapTopology = {
      nodes: [],
      lands: [makeLand({ id: 0, name: '台北', landPrice: 1000, housePrice: 200 })],
    };
    const state = makeGameState({ priceIndex: 2, landLevel: [3] });
    const id = ESTATE_LAND_BASE + 0;
    expect(marketPriceOf(state, topo, LISTING.estate, id, 0)).toBe(
      estateListPrice(1000, 3, 200, 2),
    );
    expect(decodeEstate(id)).toEqual({ kind: 'land', index: 0 });
    expect(decodeEstate(ESTATE_FACILITY_BASE + 5)).toEqual({ kind: 'facility', index: 5 });
  });

  it('★ 地產：(地價 + 等級 × 房價) × 物價指數', () => {
    const topo: MapTopology = { nodes: [], lands: [makeLand({ id: 0, name: '台北', landPrice: 1000, housePrice: 200 })] };
    const state = makeGameState({ priceIndex: 2, landLevel: [3] });
    expect(marketPriceOf(state, topo, LISTING.estate, ESTATE_LAND_BASE + 0, 0)).toBe(
      (1000 + 3 * 200) * 2,
    );
  });

  it('★ 設施：(地價 + 等級 × 房價) × 物價指數', () => {
    const topo: MapTopology = {
      nodes: [],
      facilities: [makeFacility({ id: 0, name: '旅館', landPrice: 5000, housePrice: 1000 })],
    };
    const state = makeGameState({ priceIndex: 1, facilityLevel: [2], facilityType: [1] });
    expect(marketPriceOf(state, topo, LISTING.estate, ESTATE_FACILITY_BASE + 0, 0)).toBe(7000);
  });

  it('★ 详情框那几行：股票是 類型/張數/市價/賣價', () => {
    const state = stateWithBoard([{ seller: 1, slot: 0, kind: 1, id: 0, price: 9999, amount: 5 }]);
    const item = state.noticeBoard[1]?.[0];
    expect(item).toBeTruthy();
    const text = detailText(state, { nodes: [] }, item!);
    expect(text.values).toHaveLength(4);
    expect(text.values[1]).toBe('5張');
    expect(text.values[3]).toBe('$9,999元');
  });

  it('★ 详情框那几行：地產是 類型/地點/等級/市價/賣價', () => {
    const topo: MapTopology = { nodes: [], lands: [makeLand({ id: 0, name: '台北', landPrice: 1000, housePrice: 200 })] };
    const state = stateWithBoard(
      [{ seller: 1, slot: 0, kind: 2, id: ESTATE_LAND_BASE + 0, price: 8000, amount: 0 }],
      { landLevel: [2], landType: [0], priceIndex: 1 },
    );
    const text = detailText(state, topo, state.noticeBoard[1]![0]!);
    expect(text.values).toEqual(['住宅用地', '台北', '店  舖', '$1,400元', '$8,000元']);
  });
});

// ============================================================
//  三路操作
// ============================================================

describe('三路操作的 action 形状 @source core 的 actions.ts', () => {
  it('★ 撤件：`{op:withdraw, slot}`', () => {
    expect(withdrawAction(0, 3)).toEqual({ type: 'noticeBoard', op: 'withdraw', slot: 3 });
  });

  it('★ 買：`{op:buy, seller, slot}`', () => {
    expect(buyAction(2, 5)).toEqual({ type: 'noticeBoard', op: 'buy', seller: 2, slot: 5 });
  });

  it('★ 挂股票：賣價 = round(股數 × 現價)，amount = 股數', () => {
    expect(listAction(LISTING.stock, 3, 7, 180)).toEqual({
      type: 'noticeBoard',
      op: 'list',
      kind: 1,
      id: 3,
      price: 1260,
      amount: 7,
    });
  });

  it('★ 挂其余三类：賣價 = 玩家填的那个数，不带 amount', () => {
    for (const kind of [LISTING.estate, LISTING.tool, LISTING.card]) {
      const a = listAction(kind, 5, 8200, 3000) as { price: number; amount?: number };
      expect(a).toEqual({ type: 'noticeBoard', op: 'list', kind, id: 5, price: 8200 });
      expect(a.amount).toBeUndefined();
    }
  });

  it('★ 填数窗的上限：股票 = 持有股數，其余 = 市價 × 10', () => {
    expect(LIST_PRICE_MAX_FACTOR).toBe(10);
    expect(listInputMax(LISTING.stock, 7, 180)).toBe(7);
    expect(listInputMax(LISTING.tool, 0, 3000)).toBe(30000);
    expect(listInputLabel(LISTING.stock)).toBe('賣出張數');
    expect(listInputLabel(LISTING.card)).toBe('賣出價格');
  });

  // ★ 2026-09-16 订正（Q-NUM-1）：这条原来写「round 不是 trunc」并期望 77 —— **反了**。
  //   原版挂牌市价走 `0x00457dbc`（= `__round_toward_zero`，CW=0x1f7f，RC=向零），
  //   所以 25.5×3 = 76.5 → **76**。core 的 `truncTowardZero` 才是对的（见 Q-NUM-1.md）。
  it('★ 股票市價就是 core 那条式子的同形（trunc，向零截断）', () => {
    expect(stockListPrice(3, 25.5)).toBe(76);
    expect(stockListPrice(3, -25.5)).toBe(-76); // 向零，不是 floor
  });
});

describe('候选清单 @source VA 0x004259e4 / 0x0042688b / 0x00426d05', () => {
  it('★ 道具：只列数量非 0 的，按编号序', () => {
    const state = makeGameState();
    state.tools[1 * 15 + 2] = 3; // 玩家 1 的第 2 号道具（路障）
    state.tools[1 * 15 + 5] = 1;
    state.currentPlayer = 1;
    const items = boardPickItems(state, { nodes: [] }, LISTING.tool);
    expect(items.map((i) => i.id)).toEqual([2, 5]);
    expect(items[0]?.name).toBe('路障');
    expect(items[0]?.extra).toBe('×3');
  });

  it('★ 卡片：按手牌顺序列，重复的也各占一格', () => {
    const state = makeGameState({
      players: [makePlayer({ index: 0, cards: [3, 3, 7] })],
      currentPlayer: 0,
    });
    const items = boardPickItems(state, { nodes: [] }, LISTING.card);
    expect(items.map((i) => i.id)).toEqual([3, 3, 7]);
  });

  it('★ 股票：只列持股 > 0 的', () => {
    const state = makeGameState({
      holdings: [
        [{ amount: 0, avgCost: 0 }, { amount: 4, avgCost: 10 }, { amount: 0, avgCost: 0 }],
      ],
    });
    const items = boardPickItems(state, { nodes: [] }, LISTING.stock);
    expect(items.map((i) => i.id)).toEqual([1]);
    expect(items[0]?.amount).toBe(4);
  });

  it('★ 地產：先地块后設施，只列自己的；编号带 2000/4000 基址', () => {
    const topo: MapTopology = {
      nodes: [],
      lands: [makeLand({ id: 0, name: '甲', owner: 1 }), makeLand({ id: 1, name: '乙', owner: 2 })],
      facilities: [makeFacility({ id: 0, name: '丙', owner: 1 })],
    };
    const state = makeGameState({ landOwner: [1, 2], facilityOwner: [1], currentPlayer: 0 });
    const items = boardPickItems(state, topo, LISTING.estate);
    expect(items.map((i) => i.id)).toEqual([ESTATE_LAND_BASE + 0, ESTATE_FACILITY_BASE + 0]);
  });
});

// ============================================================
//  整屏流程（假的 env）
// ============================================================

describe('開屏 / 關屏 @source VA 0x00417dee（工具列第 10 颗）/ rich4.asm 11636（熱鍵「交易」）', () => {
  it('★ 熱鍵「交易」(13) 開屏，再按一次關屏；開著時 `active` 為真', () => {
    const h = harness(makeGameState());
    resetBoardScreen();
    expect(boardScreen.active(h.env)).toBe(false);
    expect(boardScreen.hotkey?.(13, h.env)).toBe(true);
    expect(boardScreen.active(h.env)).toBe(true);
    expect(boardScreen.hotkey?.(13, h.env)).toBe(true);
    expect(boardScreen.active(h.env)).toBe(false);
  });

  it('★ 工具列第 10 颗（下标 9）也開同一屏，别的钮不认领', () => {
    const h = harness(makeGameState());
    resetBoardScreen();
    expect(boardScreen.toolbar?.(8, h.env)).toBe(false);
    expect(boardScreen.toolbar?.(9, h.env)).toBe(true);
    expect(boardScreen.active(h.env)).toBe(true);
  });

  it('★★ 开窗先清理（0x004284c5 call 0x42483e）、关窗收回特別融資（0x0042885c push 0 / call 0x436b0a）—— 只在会生效时才交 action', () => {
    // 0 号挂着手上已没有的卡 5；1 号欠特別融資（没有銀行董事長 ⇒ 关窗时收回）
    const base = stateWithBoard([{ seller: 0, slot: 0, kind: 4, id: 5, price: 100, amount: 0 }]);
    const s = { ...base, players: base.players.map((p, i) => (i === 1 ? { ...p, moneyInBank: 5000, specialFinance: 1000 } : p)) };
    const h = harness(s);
    resetBoardScreen();
    expect(boardScreen.toolbar?.(9, h.env)).toBe(true);
    expect(h.edges).toEqual([{ type: 'noticeBoard', op: 'open' }]);
    expect(boardScreen.toolbar?.(9, h.env)).toBe(true); // 再按一次 = 关
    expect(h.edges).toEqual([{ type: 'noticeBoard', op: 'open' }, { type: 'noticeBoard', op: 'close' }]);
    // 什么都不欠、没有失效挂牌 ⇒ 开关都不交（空操作在联机里会被当成非法）
    const idle = harness(makeGameState());
    resetBoardScreen();
    boardScreen.toolbar?.(9, idle.env);
    boardScreen.toolbar?.(9, idle.env);
    expect(idle.edges).toEqual([]);
    // 联机旁观端（本机不是回合主人）不交
    const watch = harness(s);
    resetBoardScreen();
    boardScreen.toolbar?.(9, { ...watch.env, localSeat: 2 });
    expect(watch.edges).toEqual([]);
  });

  it('★ 不在 game 屏時不開（也不认领熱鍵）', () => {
    const h = harness(makeGameState());
    resetBoardScreen();
    const env = { ...h.env, screen: 'title' };
    expect(boardScreen.hotkey?.(13, env)).toBe(false);
    expect(boardScreen.active(env)).toBe(false);
  });

  it('★ 换人就自动收屏（原版这扇窗只活在当前玩家那一个回合里）', () => {
    const state = makeGameState();
    const h = harness(state);
    openBoard(h.env);
    expect(boardScreen.active(h.env)).toBe(true);
    h.env = { ...h.env, state: { ...state, currentPlayer: 1 } };
    boardScreen.tick?.(h.env);
    expect(boardScreen.active(h.env)).toBe(false);
  });
});

describe('主屏：SALE → 类型选单 @source VA 0x00427ea1 / 0x004281af', () => {
  it('★ 在 SALE 上**按下**选单就贴出来了（抬手前 `mode` 已是 type）', () => {
    const h = harness(makeGameState());
    openBoard(h.env);
    boardScreen.down?.(500, 90, h.env);
    expect(boardScreenState().mode).toBe('type');
    boardScreen.up?.(500, 90, h.env);
    // 抬手时没拖到任何一格 → 选单收掉（原版 `[0x48c2cb] == 0` 那一支）
    expect(boardScreenState().mode).toBe('board');
  });

  it('★ 按住 SALE 拖到某一格再抬手才进选物窗（左上 = 股票）', () => {
    const state = makeGameState({ holdings: [[{ amount: 3, avgCost: 10 }]] });
    const h = harness(state);
    openBoard(h.env);

    drag(h.env, 500, 90, 480, 130); // SALE 按下 → 拖到选单左上 → 抬手
    expect(boardScreenState().mode).toBe('pick');
    expect(boardScreenState().pickKind).toBe(LISTING.stock);
  });

  it('★ 选单四格 → 四类：左上股票 / 左下地產 / 右上道具 / 右下卡片', () => {
    const state = makeGameState({
      holdings: [[{ amount: 1, avgCost: 10 }]],
      players: [makePlayer({ index: 0, cards: [7] })],
    });
    state.tools[0 * 15 + 2] = 1;
    for (const [x, y, kind] of [
      [480, 130, LISTING.stock],
      [480, 170, LISTING.estate],
      [545, 130, LISTING.tool],
      [545, 170, LISTING.card],
    ] as const) {
      const h = harness(state);
      openBoard(h.env);
      drag(h.env, 500, 90, x, y);
      expect(boardScreenState().mode).toBe('pick');
      expect(boardScreenState().pickKind).toBe(kind);
    }
  });

  it('★ 板满时点 SALE 只弹訊息框，不开选单 @source VA 0x00427eb1', () => {
    const state = stateWithBoard(
      [0, 1, 2, 3, 4, 5, 6].map((s) => ({ seller: 0, slot: s, kind: 3, id: 2, price: 3000, amount: 0 })),
    );
    const h = harness(state);
    openBoard(h.env);
    click(h.env, 500, 90);
    expect(boardScreenState().mode).toBe('board');
    expect(boardScreenState().message).toBe(BOARD_FULL_MSG);
    // 1.5 秒后自己收掉
    const later = { ...h.env, now: h.env.now + BOARD_MSG_MS };
    boardScreen.tick?.(later);
    expect(boardScreenState().message).toBeNull();
  });

  it('★ EXIT 是**抬手**才退屏（按下只记状态）', () => {
    const h = harness(makeGameState());
    openBoard(h.env);
    boardScreen.down?.(560, 90, h.env);
    expect(boardScreenState().press).toEqual({ area: 'exit' });
    expect(boardScreen.active(h.env)).toBe(true); // 还开着
    boardScreen.up?.(560, 90, h.env);
    expect(boardScreen.active(h.env)).toBe(false);
  });
});

describe('挂东西：选物 → 填数 → dispatch(list) @source VA 0x00453544', () => {
  it('★ 卡片：点 SALE → 右下那格 → 点第一张牌 → 填数页带「市價」初值', () => {
    const state = makeGameState({
      players: [makePlayer({ index: 0, cards: [7] })],
      priceIndex: 1,
    });
    const h = harness(state);
    openBoard(h.env);

    drag(h.env, 500, 90, 545, 170); // SALE 按下 → 选单右下那格 = 卡片 → 抬手
    expect(boardScreenState().pickKind).toBe(LISTING.card);

    click(h.env, 177, 209); // 第一格（卡片／道具窗按下即记账、抬手成立）
    expect(boardScreenState().mode).toBe('price');
    // 卡片 7 = 改建卡、標價 15 → 市價 = 15 × 100 × 物價指數(1) = 1,500
    expect(boardScreenState().amount).toMatchObject({ kind: LISTING.card, id: 7, market: 1500 });
    expect(boardScreenState().amountPage?.value).toBe(1500);
  });

  it('触屏：只有出价填数页（金额条 + 数字键盘）开着时 amountEntry 为真 ⇒ 长按不算右键', () => {
    const state = makeGameState({ players: [makePlayer({ index: 0, cards: [7] })] });
    resetBoardScreen();
    const h = harness(state);
    expect(boardScreen.amountEntry?.(h.env)).toBe(false);
    openBoard(h.env);
    expect(boardScreen.amountEntry?.(h.env)).toBe(false); // 主屏
    drag(h.env, 500, 90, 545, 170);
    expect(boardScreen.amountEntry?.(h.env)).toBe(false); // 选物窗
    click(h.env, 177, 209);
    expect(boardScreenState().mode).toBe('price');
    expect(boardScreen.amountEntry?.(h.env)).toBe(true);
    boardScreen.contextmenu?.(0, 0, h.env); // 右键 / 「取消」钮 退回
    expect(boardScreen.amountEntry?.(h.env)).toBe(false);
  });

  it('★ 填数页按「確定」→ noticeBoard op:list，卖价就是填的那个数', () => {
    const state = makeGameState({ players: [makePlayer({ index: 0, cards: [7] })] });
    const h = harness(state);
    openBoard(h.env);
    drag(h.env, 500, 90, 545, 170);
    click(h.env, 177, 209);

    // 把值改成 8200（S13 截图里那一笔），再按真的「確定」那颗钮
    const a = boardScreenState().amount!;
    boardScreenState().amountPage!.value = 8200;
    const dialog = boardPriceUi(a.kind, a.id, a.amount, a.market);
    const layout = layoutDialog(h.env.stage, dialog, boardScreenState().amountPage);
    // ★ 2026-09-16：填数页换成原版数字键盘窗后，「確定」是**序号 3** 那颗
    //   （Enter，跳表 `0x452bca` 第 2 项 @source loc_00453116）
    const ok = layout.buttons.find((b) => b.hit.kind === 'amountSlot' && b.hit.id === 3);
    expect(ok).toBeTruthy();
    click(
      h.env,
      (ok?.rect.x ?? 0) + LAYOUT.board.x + 2,
      (ok?.rect.y ?? 0) + LAYOUT.board.y + 2,
    );

    expect(h.actions).toEqual([
      { type: 'noticeBoard', op: 'list', kind: LISTING.card, id: a.id, price: 8200 },
    ]);
    expect(boardScreenState().mode).toBe('board');
  });

  it('★★ 金额栏按住拖动改值（通用填数窗 `fcn_00453544` 的 `loc_00453394`；舞台坐标，与画出来的栏同一处）', () => {
    const state = makeGameState({ players: [makePlayer({ index: 0, cards: [7] })] });
    const h = harness(state);
    const sounds: number[] = [];
    h.env.playEffect = (id: number) => void sounds.push(id);
    openBoard(h.env);
    drag(h.env, 500, 90, 545, 170);
    click(h.env, 177, 209);
    expect(boardScreenState().mode).toBe('price');
    const max = boardScreenState().amount!.market * LIST_PRICE_MAX_FACTOR;
    // 栏在舞台上：窗 AMOUNT_WINDOW (0x100,0x90) + 栏 (9,41,110,14)
    const y = 0x90 + 41 + 7;
    const left = 0x100 + 9;
    const right = 0x100 + 117;
    // 没按着：鼠标划过栏不改值（第七份试玩回报 #4）
    boardScreen.move?.(right, y, h.env);
    expect(boardScreenState().amountPage?.value).toBe(1500);
    // 按在栏上 → 拖到最右 = 上限；拖到最左 = 0
    boardScreen.down?.(left + 50, y, h.env);
    expect(boardScreenState().amountPage?.value).toBe(1500); // 按下那一拍不改值
    boardScreen.move?.(right, y, h.env);
    expect(boardScreenState().amountPage?.value).toBe(max);
    boardScreen.move?.(left, y, h.env);
    expect(boardScreenState().amountPage?.value).toBe(0);
    expect(sounds).toEqual([9, 9]);
    // 拖出栏外：值不动
    boardScreen.move?.(right, y + 40, h.env);
    expect(boardScreenState().amountPage?.value).toBe(0);
    // 抬手 = 松开；之后再划过栏不改值
    boardScreen.up?.(left, y, h.env);
    boardScreen.move?.(right, y, h.env);
    expect(boardScreenState().amountPage?.value).toBe(0);
    expect(boardScreenState().mode).toBe('price');
    // 按在钮上（不是栏）再划到栏上：不改值
    boardScreen.down?.(0x100 + 60, 0x90 + 170, h.env);
    boardScreen.move?.(right, y, h.env);
    expect(boardScreenState().amountPage?.value).not.toBe(max);
  });

  it('★ 填数页的初值是「市價」，上限是市價 × 10', () => {
    const state = makeGameState({ players: [makePlayer({ index: 0, cards: [7] })] });
    const h = harness(state);
    openBoard(h.env);
    drag(h.env, 500, 90, 545, 170);
    click(h.env, 177, 209);
    const a = boardScreenState().amount!;
    expect(boardScreenState().amountPage?.value).toBe(a.market);
    const ui = boardPriceUi(a.kind, a.id, a.amount, a.market);
    expect(ui.choices[0]?.amount?.max).toBe(a.market * LIST_PRICE_MAX_FACTOR);
  });

  it('★ 股票那一类填的是**股數**：賣價 = round(股數 × 現價)、amount = 股數', () => {
    const state = makeGameState({ holdings: [[{ amount: 9, avgCost: 10 }]] });
    const market = state.market.stocks[0]?.price ?? 0;
    expect(listInputMax(LISTING.stock, 9, market)).toBe(9);
    expect(listAction(LISTING.stock, 0, 9, market)).toEqual({
      type: 'noticeBoard',
      op: 'list',
      kind: 1,
      id: 0,
      price: Math.round(9 * market),
      amount: 9,
    });
  });
});

describe('撤件 / 購買 @source VA 0x00427ad9 / 0x00427b19 / 0x00427b3b', () => {
  it('★ 挂牌格也是**抬手**才开详情框（按下只记 `press`，原版 VA 0x00428085 → 0x00428296）', () => {
    const state = stateWithBoard([{ seller: 0, slot: 2, kind: 3, id: 2, price: 3000, amount: 0 }]);
    const h = harness(state);
    openBoard(h.env);
    boardScreen.down?.(104 + 72 * 2 + 36, 114 + 36, h.env);
    expect(boardScreenState().press).toEqual({ area: 'slot', player: 0, slot: 2 });
    expect(boardScreenState().mode).toBe('board');
    boardScreen.up?.(104 + 72 * 2 + 36, 114 + 36, h.env);
    expect(boardScreenState().mode).toBe('detail');
  });

  it('★ 按下**空格子**什么都不记（原版 `cmp byte [槽], 0 / je`）', () => {
    const h = harness(makeGameState());
    openBoard(h.env);
    boardScreen.down?.(140, 150, h.env); // 空槽
    expect(boardScreenState().press).toBeNull();
    boardScreen.up?.(140, 150, h.env);
    expect(boardScreenState().mode).toBe('board');
  });

  it('★ 自己的挂牌：点格子 → 详情框 → 撤件 → noticeBoard op:withdraw', () => {
    const state = stateWithBoard([{ seller: 0, slot: 2, kind: 3, id: 2, price: 3000, amount: 0 }]);
    const h = harness(state);
    openBoard(h.env);

    click(h.env, 104 + 72 * 2 + 36, 114 + 36); // 自己第 2 格
    expect(boardScreenState().mode).toBe('detail');

    // 股票那一支的 btnY 按 kind 走；这里是道具 → btnY = 0xcb，框在 (224,128)
    const y = 128 + 0xcb;
    click(h.env, 224 + 0x30, y);
    expect(h.actions).toEqual([{ type: 'noticeBoard', op: 'withdraw', slot: 2 }]);
    expect(boardScreenState().mode).toBe('board');
  });

  it('★★ 别人的挂牌：那颗钮先弹 YES/NO，**YES 才下单**（B-6(iii)）', () => {
    const state = stateWithBoard([{ seller: 2, slot: 1, kind: 3, id: 2, price: 3000, amount: 0 }]);
    const h = harness(state);
    openBoard(h.env);
    click(h.env, 104 + 72 + 36, 114 + 72 * 2 + 36);
    expect(boardScreenState().mode).toBe('detail');
    expect(boardScreenState().detail).toEqual({ seller: 2, slot: 1 });
    // ① 点「購買」→ **只弹确认框，还不下单**
    //    @source `loc_00427b19` → `call _rich4_ui_yesno`（居中 (220,320)）
    click(h.env, 224 + 0x30, 128 + 0xcb);
    expect(h.actions).toEqual([]);
    expect(boardScreenState().confirm).toEqual({ seller: 2, slot: 1, hover: null });
    // ② 压在 YES 那半块上（左半：x < 220）→ 高亮
    boardScreen.move?.(200, 320, h.env);
    expect(boardScreenState().confirm?.hover).toBe('yes');
    // ③ 抬手在 YES 上 → 这才真的下单
    boardScreen.up?.(200, 320, h.env);
    expect(h.actions).toEqual([{ type: 'noticeBoard', op: 'buy', seller: 2, slot: 1 }]);
    expect(boardScreenState().confirm).toBeNull();
  });

  it('★★ 确认框点 NO / 点在框外 → **不下单**，退回详情框', () => {
    const state = stateWithBoard([{ seller: 2, slot: 1, kind: 3, id: 2, price: 3000, amount: 0 }]);
    const h = harness(state);
    openBoard(h.env);
    click(h.env, 104 + 72 + 36, 114 + 72 * 2 + 36);
    click(h.env, 224 + 0x30, 128 + 0xcb);
    expect(boardScreenState().confirm).not.toBeNull();
    // 右半 = NO（x > 220）
    boardScreen.move?.(240, 320, h.env);
    expect(boardScreenState().confirm?.hover).toBe('no');
    boardScreen.up?.(240, 320, h.env);
    expect(h.actions).toEqual([]);
    expect(boardScreenState().confirm).toBeNull();
    // 框外抬手也算取消
    click(h.env, 224 + 0x30, 128 + 0xcb);
    boardScreen.up?.(10, 10, h.env);
    expect(h.actions).toEqual([]);
    expect(boardScreenState().confirm).toBeNull();
    // ★ 几何：YES/NO 各占一半，居中在 (220,320)
    expect(hitYesNo(200, 320)).toBe('yes');
    expect(hitYesNo(240, 320)).toBe('no');
    expect(hitYesNo(220, 320)).toBe('no'); // x 不小于 w/2 → NO（原版 `x < w/2 → YES`）
    expect(hitYesNo(10, 10)).toBeNull();
    expect(confirmChose('yes')).toBe(true);
    expect(confirmChose('no')).toBe(false);
    expect(confirmChose(null)).toBe(false);
  });

  it('★ 详情框那两颗钮也是**抬手**才成立（按下只压暗）', () => {
    const state = stateWithBoard([{ seller: 0, slot: 0, kind: 3, id: 2, price: 3000, amount: 0 }]);
    const h = harness(state);
    openBoard(h.env);
    click(h.env, 140, 150);
    expect(boardScreenState().mode).toBe('detail');
    const y = 128 + 0xcb;
    boardScreen.down?.(276, y, h.env);
    expect(boardScreenState().press).toEqual({ area: 'detailAction' });
    expect(h.actions).toEqual([]); // 还没撤
    boardScreen.up?.(276, y, h.env);
    expect(h.actions).toEqual([{ type: 'noticeBoard', op: 'withdraw', slot: 0 }]);
  });

  it('★ 详情框的 EXIT 只退卡，不发 action', () => {
    const state = stateWithBoard([{ seller: 0, slot: 0, kind: 3, id: 2, price: 3000, amount: 0 }]);
    const h = harness(state);
    openBoard(h.env);
    click(h.env, 140, 150);
    expect(boardScreenState().mode).toBe('detail');
    click(h.env, 224 + 0x8c, 128 + 0xcb);
    expect(h.actions).toEqual([]);
    expect(boardScreenState().mode).toBe('board');
    expect(boardScreen.active(h.env)).toBe(true); // 屏还开着
  });
});

describe('★ pt26 #3：公佈欄出价填数页 —— 按下放按键音 7、抬手才动作（只认按下那一颗）@source 0x00452d95 / loc_00452fce', () => {
  function priceHarness() {
    const state = makeGameState({ players: [makePlayer({ index: 0, cards: [7] })] });
    resetBoardScreen();
    const h = harness(state);
    const sounds: number[] = [];
    h.env.playEffect = (id: number) => void sounds.push(id);
    openBoard(h.env);
    drag(h.env, 500, 90, 545, 170);
    click(h.env, 177, 209);
    expect(boardScreenState().mode).toBe('price');
    sounds.length = 0;
    const a = boardScreenState().amount!;
    const layout = layoutDialog(h.env.stage, boardPriceUi(a.kind, a.id, a.amount, a.market), boardScreenState().amountPage);
    const at = (id: number) => {
      const b = layout.buttons.find((x) => x.hit.kind === 'amountSlot' && x.hit.id === id)!;
      return { x: b.rect.x + LAYOUT.board.x + 2, y: b.rect.y + LAYOUT.board.y + 2 };
    };
    return { h, sounds, at, a };
  }

  it('数字钮：按下只放 7、值不变；抬手才接上那一位', () => {
    const { h, sounds, at } = priceHarness();
    const before = boardScreenState().amountPage!.value;
    const c = at(4); // C = 清零
    boardScreen.down?.(c.x, c.y, h.env);
    expect(sounds).toEqual([7]);
    expect(boardScreenState().amountPage!.value).toBe(before);
    boardScreen.up?.(c.x, c.y, h.env);
    expect(sounds).toEqual([7]); // 抬手不再放
    expect(boardScreenState().amountPage!.value).toBe(0);
    const five = at(0xb); // '5'
    boardScreen.down?.(five.x, five.y, h.env);
    boardScreen.up?.(five.x, five.y, h.env);
    expect(boardScreenState().amountPage!.value).toBe(5);
    expect(sounds).toEqual([7, 7]);
  });

  it('★ 抬手照**按下那一颗**办（抬手时指针已挪到别处也一样）', () => {
    const { h, at, a } = priceHarness();
    boardScreenState().amountPage!.value = 4200;
    const ok = at(3);
    boardScreen.down?.(ok.x, ok.y, h.env);
    expect(h.actions).toEqual([]); // 按下不成交
    boardScreen.up?.(5, 5, h.env); // 抬在屏外
    expect(h.actions).toEqual([{ type: 'noticeBoard', op: 'list', kind: LISTING.card, id: a.id, price: 4200 }]);
    expect(boardScreenState().mode).toBe('board');
  });

  it('★ 拖窗：按在窗底空白（id 1）拖着走；按钮跟着新落点；关了再开回 (0x100,0x90)', async () => {
    const { amountWindowPos } = await import('./amount-keys.ts');
    const { h, sounds } = priceHarness();
    expect(amountWindowPos()).toEqual({ x: 0x100, y: 0x90 });
    boardScreen.down?.(0x100 + 120, 0x90 + 186, h.env); // 窗底右下角空白
    expect(sounds).toEqual([]); // 拖窗不响
    boardScreen.move?.(0x100 + 120 - 150, 0x90 + 186 - 60, h.env);
    expect(amountWindowPos()).toEqual({ x: 0x100 - 150, y: 0x90 - 60 });
    boardScreen.up?.(0, 0, h.env);
    boardScreen.move?.(600, 400, h.env); // 松了手：不再跟
    expect(amountWindowPos()).toEqual({ x: 0x100 - 150, y: 0x90 - 60 });
    // 在新落点上点「C」
    const a = boardScreenState().amount!;
    const layout = layoutDialog(h.env.stage, boardPriceUi(a.kind, a.id, a.amount, a.market), boardScreenState().amountPage);
    const c = layout.buttons.find((b) => b.hit.kind === 'amountSlot' && b.hit.id === 4)!;
    boardScreen.down?.(c.rect.x + LAYOUT.board.x + 2, c.rect.y + LAYOUT.board.y + 2, h.env);
    boardScreen.up?.(c.rect.x + LAYOUT.board.x + 2, c.rect.y + LAYOUT.board.y + 2, h.env);
    expect(boardScreenState().amountPage!.value).toBe(0);
    expect(c.rect.x + LAYOUT.board.x).toBe(0x100 - 150 + 8);
    // 右键退回、再开：回初值
    boardScreen.contextmenu?.(0, 0, h.env);
    priceHarness();
    expect(amountWindowPos()).toEqual({ x: 0x100, y: 0x90 });
  });

  it('按在窗里的空白 / 金额栏上：不放音，抬手也不办事', () => {
    const { h, sounds } = priceHarness();
    const v = boardScreenState().amountPage!.value;
    boardScreen.down?.(0x100 + 50, 0x90 + 41 + 7, h.env); // 金额栏（原版 0x10：不放音）
    boardScreen.up?.(0x100 + 50, 0x90 + 41 + 7, h.env);
    expect(sounds).toEqual([]);
    expect(boardScreenState().amountPage!.value).toBe(v);
    expect(h.actions).toEqual([]);
  });
});
