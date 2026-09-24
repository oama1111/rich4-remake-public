/*
 * 卡片商店／道具商店整屏的版面与命中（P2-8 / U-2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4_shop.asm` 抄，把最容易写错的几条钉住：
 *   左边货架栏行距 **24（卡片）/ 48（道具）** —— 两页不一样；
 *   右下是 5×3 的 80×56，首格 (233,299)，命中基准是 (232,298) 的开区间；
 *   图自带的裁切原点必须减掉（老板娘那两张就是靠这个才落到 (372,32) / (341,11)）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PendingInteraction } from '@rich4/core';
import {
  SHOP_BUBBLE_AT,
  SHOP_BUBBLE_MS,
  SHOP_CELL,
  SHOP_CELL_LOCAL,
  SHOP_CELL_ORIGIN,
  SHOP_CHUNK,
  SHOP_CELL_PRESS,
  SHOP_EXIT_AT,
  SHOP_EXIT_HIT,
  SHOP_FIXED_CHUNK,
  SHOP_GRID_CHUNK,
  SHOP_GRID_RESOURCE,
  SHOP_GRID_Y,
  SHOP_ICON_FIRST,
  SHOP_KEEPER_AT,
  SHOP_MSG,
  SHOP_PAGE,
  SHOP_PANEL_Y,
  SHOP_POINTS,
  SHOP_RESOURCE,
  SHOP_SHELF,
  SHOP_SLIDE,
  SHOP_SLOTS,
  SHOP_SWITCH_AT,
  SHOP_SWITCH_HIT,
  SHOP_SOLD_TEXT,
  SHOP_TEXT,
  blinkStart,
  blinkStep,
  cellItemAt,
  drawShopScreen,
  keeperPaintAfter,
  keeperPaintStart,
  hitShopCell,
  hitShopExit,
  hitShopShelf,
  hitShopSwitch,
  shelfRowTextAt,
  shopCellRect,
  shopEntryOf,
  shopMessage,
  shopRows,
  slideDone,
  slideEnd,
  slideStart,
  slideStep,
  shopBubbleAfterClick,
  shopBubbleExpired,
} from './shop-screen.ts';

describe('用到的图 @source rich4_shop.asm', () => {
  it('★ 底图是 Panel.mkf 资源 10；格子底与道具图标在资源 11', () => {
    expect(SHOP_RESOURCE).toBe(10);
    expect(SHOP_GRID_RESOURCE).toBe(11);
    expect(SHOP_GRID_CHUNK).toEqual({ cards: 0, tools: 1 });
    // 道具图标的图号 = 槽 + 2
    expect(SHOP_ICON_FIRST).toBe(2);
  });

  it('★ 两页的三张主图：底图 0/16、货架栏 1/17、老板娘 2/18', () => {
    expect(SHOP_CHUNK.bg).toEqual([0, 16]);
    expect(SHOP_CHUNK.panel).toEqual([1, 17]);
    expect(SHOP_CHUNK.keeper).toEqual([2, 18]);
  });

  it('★ 三角钮常态 13/29、按下 14/30；EXIT 常态 35、按下 36；點數底板 37；气泡 15', () => {
    expect(SHOP_CHUNK.switchOn).toEqual([13, 29]);
    expect(SHOP_CHUNK.switchOff).toEqual([14, 30]);
    expect(SHOP_FIXED_CHUNK).toEqual({ bubble: 15, exitOn: 35, exitOff: 36, pointsPlate: 37 });
  });

  it('★ 原版这一屏图 3/19/20/28/31–34 一张都不画 —— 上表里没有它们', () => {
    const used = new Set<number>([
      ...SHOP_CHUNK.bg,
      ...SHOP_CHUNK.panel,
      ...SHOP_CHUNK.keeper,
      ...SHOP_CHUNK.switchOn,
      ...SHOP_CHUNK.switchOff,
      ...Object.values(SHOP_FIXED_CHUNK),
    ]);
    for (const unused of [3, 19, 20, 28, 31, 32, 33]) expect(used.has(unused)).toBe(false);
  });
});

describe('版面 @source VA 0x0042d2xx / 0x42d75e / 0x42d499', () => {
  it('★ 货架栏落在 (滑入 x, 10)，格子底图落在 (滑入 x, 293)', () => {
    expect(SHOP_PANEL_Y).toBe(10);
    expect(SHOP_GRID_Y).toBe(293);
  });

  it('★ 老板娘传 (320,240) —— 靠图自己的原点才落到 (372,32) / (341,11)', () => {
    expect(SHOP_KEEPER_AT).toEqual({ x: 320, y: 240 });
    // 资源 10 图 2 / 图 18 的裁切原点（自 Panel.mkf 的 SMP 表 dump）
    const witch = { x: -52, y: 208 };
    const girl = { x: -21, y: 229 };
    expect({ x: SHOP_KEEPER_AT.x - witch.x, y: SHOP_KEEPER_AT.y - witch.y }).toEqual({ x: 372, y: 32 });
    expect({ x: SHOP_KEEPER_AT.x - girl.x, y: SHOP_KEEPER_AT.y - girl.y }).toEqual({ x: 341, y: 11 });
  });

  it('★ 气泡落在 (120,10)、活 2 秒；字比气泡中心左移 20', () => {
    expect(SHOP_BUBBLE_AT).toEqual({ x: 120, y: 10 });
    expect(SHOP_BUBBLE_MS).toBe(2000);
  });

  it('★ 點數：底板 (230,246)，数字 flag 1 落在 (310,257)', () => {
    expect(SHOP_POINTS).toEqual({ plateX: 230, plateY: 246, textX: 310, textY: 257 });
  });

  it('★ 两个钮的落点与命中框：三角 (542,13)、EXIT (556,246)', () => {
    expect(SHOP_SWITCH_AT).toEqual({ x: 542, y: 13 });
    expect(SHOP_SWITCH_HIT).toEqual({ x0: 542, y0: 13, x1: 627, y1: 98 });
    expect(SHOP_EXIT_AT).toEqual({ x: 556, y: 246 });
    expect(SHOP_EXIT_HIT).toEqual({ x0: 556, y0: 246, x1: 636, y1: 286 });
  });

  it('★ 货架两页的行距不一样：卡片 24×15 行、道具 48×8 行', () => {
    expect(SHOP_SHELF.cards).toMatchObject({ y0: 81, rowH: 24, rows: 15 });
    expect(SHOP_SHELF.tools).toMatchObject({ y0: 80, rowH: 48, rows: 8 });
  });

  it('★ 货架栏的画字位置：名居中、价格右上', () => {
    expect(SHOP_SHELF.cards).toMatchObject({ nameX: 90, priceX: 194 });
    expect(shelfRowTextAt(SHOP_PAGE.cards, 0)).toEqual({ nameX: 90, nameY: 83, priceX: 194, priceY: 75 });
    expect(shelfRowTextAt(SHOP_PAGE.cards, 14)).toEqual({
      nameX: 90,
      nameY: 83 + 24 * 14,
      priceX: 194,
      priceY: 75 + 24 * 14,
    });
    expect(shelfRowTextAt(SHOP_PAGE.tools, 0)).toEqual({ nameX: 90, nameY: 92, priceX: 194, priceY: 84 });
    expect(shelfRowTextAt(SHOP_PAGE.tools, 7)).toEqual({
      nameX: 90,
      nameY: 92 + 48 * 7,
      priceX: 194,
      priceY: 84 + 48 * 7,
    });
  });
});

describe('右下 5×3 格 @source VA 0x42dfe6', () => {
  it('★ 15 格、格 80×56；首格 (233,299)，末格 (553,411)', () => {
    expect(SHOP_SLOTS).toBe(15);
    expect(SHOP_CELL).toEqual({
      baseX: 232,
      baseY: 298,
      endX: 632,
      endY: 466,
      w: 80,
      h: 56,
      cols: 5,
      rows: 3,
    });
    expect(shopCellRect(0)).toEqual({ x: 233, y: 299, w: 80, h: 56 });
    expect(shopCellRect(4)).toEqual({ x: 553, y: 299, w: 80, h: 56 });
    expect(shopCellRect(5)).toEqual({ x: 233, y: 355, w: 80, h: 56 });
    expect(shopCellRect(14)).toEqual({ x: 553, y: 411, w: 80, h: 56 });
  });

  it('★ 格子底图局部坐标下首格在 (6,6) —— 412 = 5×80+12、180 = 3×56+12', () => {
    expect(SHOP_CELL_ORIGIN).toEqual({ x: 6, y: 6 });
    expect(SHOP_CELL_ORIGIN.x * 2 + SHOP_CELL.cols * SHOP_CELL.w).toBe(412);
    expect(SHOP_CELL_ORIGIN.y * 2 + SHOP_CELL.rows * SHOP_CELL.h).toBe(180);
  });

  it('★ 格内偏移：道具图标 (29,33)、数量右上 (79,23)、卡名正中 (45,33)', () => {
    expect(SHOP_CELL_LOCAL).toEqual({
      iconDx: 29,
      iconDy: 33,
      countDx: 79,
      countDy: 23,
      cardDx: 45,
      cardDy: 33,
    });
  });

  it('★ 命中：每格左上角与中心都命中自己', () => {
    for (let slot = 0; slot < SHOP_SLOTS; slot++) {
      const r = shopCellRect(slot);
      expect(hitShopCell(r.x, r.y)).toBe(slot);
      expect(hitShopCell(r.x + r.w / 2, r.y + r.h / 2)).toBe(slot);
    }
  });

  it('★ 命中边界是开区间：最后一个像素算，再往外就不算', () => {
    expect(hitShopCell(631, 465)).toBe(14);
    expect(hitShopCell(632, 465)).toBeNull(); // 右界 0x278
    expect(hitShopCell(631, 466)).toBeNull(); // 下界 0x1d2
    expect(hitShopCell(232, 300)).toBeNull(); // 基准那一列不算
    expect(hitShopCell(300, 298)).toBeNull();
  });
});

describe('两个钮与货架的命中', () => {
  it('★ 三角钮：四角都算，框外不算（判定顺序里它排第一）', () => {
    for (const [x, y] of [
      [542, 13],
      [627, 13],
      [542, 98],
      [627, 98],
    ]) {
      expect(hitShopSwitch(x!, y!)).toBe(true);
    }
    expect(hitShopSwitch(541, 50)).toBe(false);
    expect(hitShopSwitch(628, 50)).toBe(false);
    // ★ 切页钮的框与 EXIT 的框在 x 上有重叠区（628..636），所以顺序不能颠倒
    expect(hitShopSwitch(630, 50)).toBe(false);
  });

  it('★ EXIT：四角都算，框外不算', () => {
    expect(hitShopExit(556, 246)).toBe(true);
    expect(hitShopExit(636, 286)).toBe(true);
    expect(hitShopExit(555, 250)).toBe(false);
    expect(hitShopExit(556, 287)).toBe(false);
  });

  it('★ 卡片货架：15 行、行距 24，从 y=81 起；第 16 行（越界那一像素）不认', () => {
    expect(hitShopShelf(SHOP_PAGE.cards, 14, 81)).toBe(0);
    expect(hitShopShelf(SHOP_PAGE.cards, 215, 104)).toBe(0);
    expect(hitShopShelf(SHOP_PAGE.cards, 14, 105)).toBe(1);
    expect(hitShopShelf(SHOP_PAGE.cards, 14, 417)).toBe(14);
    expect(hitShopShelf(SHOP_PAGE.cards, 14, 440)).toBe(14);
    // ★ 原版这一像素会读越界（货架数组只有 15 字节）——这里故意不认
    expect(hitShopShelf(SHOP_PAGE.cards, 14, 441)).toBeNull();
    expect(hitShopShelf(SHOP_PAGE.cards, 13, 200)).toBeNull();
    expect(hitShopShelf(SHOP_PAGE.cards, 216, 200)).toBeNull();
    expect(hitShopShelf(SHOP_PAGE.cards, 100, 80)).toBeNull();
  });

  it('★ 道具货架：8 行、行距 48，从 y=80 起', () => {
    expect(hitShopShelf(SHOP_PAGE.tools, 12, 80)).toBe(0);
    expect(hitShopShelf(SHOP_PAGE.tools, 213, 127)).toBe(0);
    expect(hitShopShelf(SHOP_PAGE.tools, 12, 128)).toBe(1);
    expect(hitShopShelf(SHOP_PAGE.tools, 12, 416)).toBe(7);
    expect(hitShopShelf(SHOP_PAGE.tools, 12, 463)).toBe(7);
    expect(hitShopShelf(SHOP_PAGE.tools, 12, 464)).toBeNull();
  });

  it('★ 两页各管各的：卡片页的 x 范围量不到道具页的行', () => {
    expect(hitShopShelf(SHOP_PAGE.tools, 14, 100)).toBe(0); // 14 也在道具页的 12..213 里
    expect(hitShopShelf(SHOP_PAGE.cards, 12, 100)).toBeNull(); // 但 12 不在卡片页的 14..215 里
  });
});

describe('滑入 @source VA 0x42d5fe', () => {
  it('★ 起点：货架栏 −222、格子 640；速度 40 / 80', () => {
    expect(SHOP_SLIDE).toMatchObject({ panelFrom: -222, panelTo: 5, gridFrom: 640, gridTo: 227 });
    expect(slideStart()).toEqual({ panelX: -222, gridX: 640, dx: 40, dy: 80 });
  });

  it('★ 每帧 dx−3、dy−7（缓出），8 帧到位 —— 货架栏从左边进来、格子从右边进来', () => {
    let s = slideStart();
    let frames = 0;
    const seen: number[] = [];
    while (!slideDone(s) && frames < 40) {
      s = slideStep(s);
      seen.push(s.panelX);
      frames++;
    }
    expect(frames).toBe(8);
    expect(s.panelX).toBe(5);
    expect(s.gridX).toBe(227);
    expect(seen[0]).toBe(-222 + 40); // 第一帧 +40
    expect(seen[6]).toBe(-5); // 第 7 帧还差一点
    expect(seen[7]).toBe(5); // 第 8 帧被夹到 5，同时格子也到了 227
  });

  it('★ 到位后再走就是原地不动 —— 速度递减转负会把格子推回去，原版靠停帧躲开', () => {
    let s = slideStart();
    for (let i = 0; i < 20; i++) s = slideStep(s);
    expect(slideDone(s)).toBe(true);
    expect(s).toMatchObject({ panelX: 5, gridX: 227 });
  });
});

describe('老板娘说的那几句话 @source 串表 0x4755c0（W-67-c 逐字订正）', () => {
  /**
   * ★★ 2026-09-20 订正（W-67-c）：先前这里断言的是**剥掉 `#NNNN` 之后**的串，
   *   而且第 0 句的换行也抄错了（少了「有什麼我能」后面的换行）。
   *   真值 = 原版指针表 `0x4755c0` 起每页 6 项，串头**带语音号**。
   *   `#NNNN` 由 `main.ts` 的 `shopSay()` → `playVoiceCode()` 播掉并剥掉。
   */
  const TABLE: readonly string[] = [
    '#0000有什麼我能\n為你服務的嗎？',
    '#0001請挑選你想要\n兌換的卡片。',
    '#0002抱歉！\n你的點數不足！',
    '#0003對不起！\n您的卡片欄已滿！',
    '#0004歡迎下次再來！',
    '#0005歡迎光臨\n道具店！',
    '#0006您要兌換\n什麼道具？',
    '#0007對不起，\n您的點券不夠！',
    '#0008很抱歉！您的\n道具欄已滿！',
    '#0009這個道具會員\n才能兌換！',
    '#0010謝謝惠顧！',
  ];

  it.each(TABLE.map((text, i) => [i, text] as const))('★ 第 %i 条逐字相等', (i, text) => {
    expect(SHOP_MSG[i]).toBe(text);
    // 每一条都带语音号（剥掉之后才是气泡里显示的正文）
    expect(SHOP_MSG[i]!.startsWith('#')).toBe(true);
  });

  it('★ 表是 11 条整，没有多余的项', () => {
    expect(SHOP_MSG).toHaveLength(11);
  });

  it('★ 卡片页：进店 / 提示 / 钱不够 / 栏满 / 离开', () => {
    expect(shopMessage(SHOP_PAGE.cards, 'entry')).toBe(TABLE[0]);
    expect(shopMessage(SHOP_PAGE.cards, 'hint')).toBe(TABLE[1]);
    expect(shopMessage(SHOP_PAGE.cards, 'notEnough')).toBe(TABLE[2]);
    expect(shopMessage(SHOP_PAGE.cards, 'full')).toBe(TABLE[3]);
    expect(shopMessage(SHOP_PAGE.cards, 'bye')).toBe(TABLE[4]);
  });

  it('★ 道具页：进店 / 提示 / 钱不够 / 栏满 / 离开（注意離開是第 10 条，跳过了「會員」那条）', () => {
    expect(shopMessage(SHOP_PAGE.tools, 'entry')).toBe(TABLE[5]);
    expect(shopMessage(SHOP_PAGE.tools, 'hint')).toBe(TABLE[6]);
    expect(shopMessage(SHOP_PAGE.tools, 'notEnough')).toBe(TABLE[7]);
    expect(shopMessage(SHOP_PAGE.tools, 'full')).toBe(TABLE[8]);
    expect(shopMessage(SHOP_PAGE.tools, 'bye')).toBe(TABLE[10]); // 第 9 条「會員」不在任何场合用
  });

  it('★ 第 9 条（會員）**不在任何场合的映射里**（原版那一页没有它的出口）', () => {
    for (const page of [SHOP_PAGE.cards, SHOP_PAGE.tools]) {
      for (const kind of ['entry', 'hint', 'notEnough', 'full', 'bye'] as const) {
        expect(shopMessage(page, kind), `${page}/${kind}`).not.toBe(TABLE[9]);
      }
    }
  });
});

/** 只填这一屏用得到的字段 */
function mkShop(
  cards: { id: number; name: string; price: number }[],
  tools: { id: number; name: string; price: number; stock: number | null }[],
): PendingInteraction {
  return {
    kind: 'shop',
    points: 1000,
    cards,
    tools,
    owned: { cards: [], tools: [] },
  } as unknown as PendingInteraction;
}

describe('货架行', () => {
  const cards = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `卡${i + 1}`, price: 100 }));
  const tools = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `道具${i + 1}`, price: 50, stock: 3 }));

  it('★ 卡片页最多 15 行、道具页最多 8 行 —— 多的丢掉（原版货架本来就抽不出这么多）', () => {
    const c = shopRows(SHOP_PAGE.cards, mkShop(cards, tools));
    const t = shopRows(SHOP_PAGE.tools, mkShop(cards, tools));
    expect(c).toHaveLength(15);
    expect(t).toHaveLength(8);
    expect(c[14]!.id).toBe(15);
    expect(t[7]!.id).toBe(8);
  });

  it('★ 空货架给空数组；不是商店的待决交互也给空数组', () => {
    expect(shopRows(SHOP_PAGE.cards, mkShop([], []))).toEqual([]);
    expect(shopRows(SHOP_PAGE.cards, { kind: 'bank' } as unknown as PendingInteraction)).toEqual([]);
  });

  it('★ 只带 id / name / price / sold 四样（stock 之类不进这一层）', () => {
    expect(shopRows(SHOP_PAGE.tools, mkShop(cards, tools))[0]).toEqual({
      id: 1,
      name: '道具1',
      price: 50,
      sold: false,
    });
  });

  it('★★ 第十七份：买过的行留在原位、`sold` 为真（core 记的 ∪ 本机刚点、回包未到的）', () => {
    const c = cards.slice(0, 6).map((x, i) => (i === 2 ? { ...x, sold: true as const } : x));
    const rows = shopRows(SHOP_PAGE.cards, mkShop(c, tools));
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((r) => r.sold)).toEqual([false, false, true, false, false, false]);
    // 本机刚点第 5 行（联机回包还没到）也算
    const local = shopRows(SHOP_PAGE.cards, mkShop(c, tools), new Set([4]));
    expect(local.map((r) => r.sold)).toEqual([false, false, true, false, true, false]);
  });
});

describe('★★ 第十七份：买过的那一行画灰字 @source 0x0042e23f / 0x0042e4c3 `push 0xa0a0a0`', () => {
  it('常态白 0xffffff（0x0042ead9）、买过灰 0xa0a0a0；描边 0x101010 宽 3 不变', () => {
    expect(SHOP_TEXT).toBe('#ffffff');
    expect(SHOP_SOLD_TEXT).toBe('#a0a0a0');
    const fills: { t: string; fill: string; stroke: string; lw: number }[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      fillRect: () => undefined,
      drawImage: () => undefined,
      strokeText: () => undefined,
      fillText(this: { fillStyle: string; strokeStyle: string; lineWidth: number }, t: string) {
        fills.push({ t, fill: String(this.fillStyle), stroke: String(this.strokeStyle), lw: this.lineWidth });
      },
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      textAlign: 'left',
      textBaseline: 'top',
    } as unknown as CanvasRenderingContext2D;
    const shelf = [
      { id: 1, name: '換屋卡', price: 20, sold: false },
      { id: 2, name: '拍賣卡', price: 20, sold: true },
    ];
    drawShopScreen(ctx, () => null, {
      page: SHOP_PAGE.cards,
      panelX: SHOP_SLIDE.panelTo,
      gridX: SHOP_SLIDE.gridTo,
      points: 90,
      shelf,
      cells: [],
      bubble: null,
      pressed: null,
    });
    const of = (t: string) => fills.filter((f) => f.t === t);
    expect(of('換屋卡').map((f) => f.fill)).toEqual(['#ffffff']);
    expect(of('拍賣卡').map((f) => f.fill)).toEqual(['#a0a0a0']);
    expect(of('$20').map((f) => f.fill)).toEqual(['#ffffff', '#a0a0a0']);
    for (const f of [...of('拍賣卡'), ...of('換屋卡')]) {
      expect(f.stroke).toBe('#101010');
      expect(f.lw).toBe(3);
    }
  });
});

describe('按下的「凹进去」效果 @source VA 0x42e0e4 / 0x451b9e', () => {
  it('★ 内容右下各移 1px，上边与左边各压暗 1px（−16 那张表 = 分量减半）', () => {
    expect(SHOP_CELL_PRESS).toEqual({ shift: 1, edge: 1, edgeAlpha: 0.5 });
  });

  it('★ 效果范围就是被点中那一格的矩形，不是整块格子底图', () => {
    const r = shopCellRect(0);
    expect(r.w).toBe(SHOP_CELL.w);
    expect(r.h).toBe(SHOP_CELL.h);
  });
});

describe('格子 → 该卖哪一件 @source VA 0x42dfe6', () => {
  const cells = [
    { slot: 0, id: 7, count: 1 },
    { slot: 3, id: 9, count: 1 },
  ];

  it('★ 卡片页：按**槽号**找（槽 3 有卡、槽 1 空）', () => {
    expect(cellItemAt(SHOP_PAGE.cards, cells, 0)?.id).toBe(7);
    expect(cellItemAt(SHOP_PAGE.cards, cells, 3)?.id).toBe(9);
    expect(cellItemAt(SHOP_PAGE.cards, cells, 1)).toBeNull();
  });

  it('★ 道具页：按**数组下标**取（那是紧排过的一张槽 → 道具号表）', () => {
    expect(cellItemAt(SHOP_PAGE.tools, cells, 0)?.id).toBe(7);
    expect(cellItemAt(SHOP_PAGE.tools, cells, 2)).toBeNull();
  });

  it('★ 越界的槽一律不认', () => {
    expect(cellItemAt(SHOP_PAGE.cards, cells, -1)).toBeNull();
    expect(cellItemAt(SHOP_PAGE.cards, cells, SHOP_SLOTS)).toBeNull();
  });
});

// ============================================================
//  「動畫過程」管着开场那一步（Q-ANIM-1）
// ============================================================

describe('★ 进店/换页那一支 @source loc_0042d577', () => {
  it('playOpening = true：从滑入起点开始 + 那一页的开场白', () => {
    const e = shopEntryOf(SHOP_PAGE.cards, true);
    expect(e.slide).toEqual(slideStart());
    expect(e.entry).toBe(shopMessage(SHOP_PAGE.cards, 'entry'));
    expect(shopEntryOf(SHOP_PAGE.tools, true).entry).toBe(shopMessage(SHOP_PAGE.tools, 'entry'));
  });

  it('★ playOpening = false（「動畫過程」关掉 / 这一页已开过场）：直接到位、不弹气泡', () => {
    // 原版这时走 `loc_0042d5ba` → `PostMessage(0x40e)`，而 0x40e 的处理器
    //   `loc_0042d499` 只画點數那一块，**没有任何气泡**。
    const e = shopEntryOf(SHOP_PAGE.cards, false);
    expect(e.entry).toBeNull();
    expect(slideDone(e.slide)).toBe(true);
    expect(e.slide).toEqual(slideEnd());
    // 已经到位 → 再走也不动（`slideStep` 到位后停机）
    expect(slideStep(e.slide)).toEqual(e.slide);
  });

  it('main.ts 用 options.animation 初始化那两页的标志（原版 = `[0x48c349] = !cfg[1]`）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('shown: [!options.animation, !options.animation]');
    expect(src).not.toContain('shown: [false, false]');
    // 分支也收进了纯函数
    expect(src).toContain('shopEntryOf(page, !ui.shown[page])');
  });
});

// ============================================================
//  ★★ E-21：道别气泡被点掉之后店永远不关（真人路径长跑抓到的真卡死）
// ============================================================

describe('★★ 气泡与关门 @source loc_0042de09（fcn_0044ee18(1)）/ loc_0042e686', () => {
  it('不在关门：点一下 ⇒ 气泡直接收掉', () => {
    expect(shopBubbleAfterClick({ until: 9999, text: 'hint' }, false)).toBeNull();
    expect(shopBubbleAfterClick(null, false)).toBeNull();
  });

  it('★★ 关门中：点一下 ⇒ 道别那一句**立刻到期**（不是清成 null）', () => {
    const b = shopBubbleAfterClick({ until: 9999, text: 'bye' }, true);
    expect(b).toEqual({ until: 0, text: 'bye' });
    // 下一帧 `shopTick` 就认它到期 ⇒ 走同一条关门路
    expect(shopBubbleExpired(b, true, 1)).toBe(true);
  });

  it('★★ 兜底：`closing` 而气泡已空 ⇒ 也算到期（先前的卡死形态）', () => {
    expect(shopBubbleExpired(null, true, 123)).toBe(true);
    expect(shopBubbleExpired(null, false, 123)).toBe(false);
  });

  it('气泡没到点 ⇒ 不收', () => {
    expect(shopBubbleExpired({ until: 500 }, false, 499)).toBe(false);
    expect(shopBubbleExpired({ until: 500 }, true, 499)).toBe(false);
    expect(shopBubbleExpired({ until: 500 }, true, 500)).toBe(true);
  });
});


/*
 * ★★ W-67-b：老板娘那一整套动画机 —— **带空闲态**（原版每 32 拍只有 2 拍有动作）。
 *
 * 先前这里是「每 100 ms 无条件换一张脸」⇒ 一直在抽动；原版平均 3 秒多才动一下。
 * 判据与状态字分段见 `shop-screen.ts` 的 `ShopBlink` 注释（@source `loc_0042d87e`
 * 的 5 项跳表 `0x42d36b`）。
 */
describe('★★ W-67-b 老板娘的眨眼 / 换脸状态机', () => {
  /** 一直返回同一个值的 `rnd` */
  const fixed = (v: number): (() => number) => () => v;

  /** 推进 `n` 拍（每拍 +100 ms），返回这 `n` 拍里贴过的脸 */
  const run = (
    b: ReturnType<typeof blinkStart>,
    page: 0 | 1,
    n: number,
    rnd: () => number,
  ): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = blinkStep(b, page, (i + 1) * 100, rnd);
      if (d !== null && d.face !== 0) out.push(d.face);
    }
    return out;
  };

  it('★ 进店 / 换页 ⇒ 模式 = 页 + 3（卡片页 3、道具页 4）', () => {
    expect(blinkStart(0).mode).toBe(3);
    expect(blinkStart(1).mode).toBe(4);
    expect(blinkStart(0)).toEqual({ mode: 3, frame: 0, face: 0, hold: 0, at: 0 });
  });

  it('★★ 换脸：抽到与当前脸号相同 ⇒ 这一拍**不动**、模式不变（下一拍再抽）', () => {
    const b = blinkStart(0);
    b.face = 2;
    // 第一次抽到 2（= 当前脸号）⇒ 什么都不贴、模式仍是 3
    expect(blinkStep(b, 0, 100, fixed(1 / 3))).toBeNull();
    expect(b.mode).toBe(3);
    expect(b.face).toBe(2);
    // 第二拍抽到 3 ⇒ 贴 3 + 3 = 6、脸号 = 3、回空闲
    expect(blinkStep(b, 0, 200, fixed(2 / 3))).toEqual({ face: 6, mouth: 0 });
    expect(b.mode).toBe(0);
    expect(b.face).toBe(3);
  });

  it('★★ 空闲：32 拍里只有 r == 0 / r == 1 那两拍有动作', () => {
    const b = blinkStart(0);
    b.mode = 0;
    b.face = 1;
    // r == 7（随便一个「其余 30/32」）⇒ 整整 10 拍什么都不做
    const idle = run(b, 0, 10, fixed(7 / 32));
    expect(idle).toEqual([]);
    expect(b.mode).toBe(0);
    // r == 0 且脸号 ≠ 0 ⇒ 进眨眼（模式 1）
    blinkStep(b, 0, 2000, fixed(0));
    expect(b.mode).toBe(1);
  });

  it('★★ 空闲 r == 0 但脸号 == 0 ⇒ **不**眨眼（原版那个 `脸号 ≠ 0` 的条件）', () => {
    const b = blinkStart(0);
    b.mode = 0;
    b.face = 0;
    blinkStep(b, 0, 100, fixed(0));
    expect(b.mode).toBe(0);
  });

  it('★★ 空闲 r == 1 ⇒ 换脸（模式 = 页 + 3，且脸号与帧计数都清 0）', () => {
    const b = blinkStart(0);
    b.mode = 0;
    b.face = 3;
    b.frame = 2;
    blinkStep(b, 0, 100, fixed(1 / 32));
    expect(b.mode).toBe(3);
    expect(b.face).toBe(0);
    expect(b.frame).toBe(0);
  });

  it('★★ 卡片页眨眼：四帧 `[7, 8, 7, 5]`，第五拍回空闲并记脸号 2', () => {
    const b = blinkStart(0);
    b.mode = 1;
    const faces = run(b, 0, 5, fixed(0.5));
    expect(faces).toEqual([7, 8, 7, 5]);
    expect(b.mode).toBe(0);
    expect(b.face).toBe(2); // S = 0x200
    // ★ `mov dword [0x48c32f], 0x200`（0x0042d902）是**整字写死** ⇒ 帧计数（bit 4–7）也归 0。
    //   （先前这里断言 4 —— 那是实现漏了清零，照抄了 bug；见下一条「第二次眨眼」）
    expect(b.frame).toBe(0);
  });

  it('★★ 第二次眨眼照样贴满四帧（先前帧计数没归 0 ⇒ 第二次一帧都不贴）', () => {
    const b = blinkStart(0);
    b.mode = 1;
    expect(run(b, 0, 5, fixed(0.5))).toEqual([7, 8, 7, 5]);
    b.mode = 1; // 空闲里 r == 0 且脸号 ≠ 0 ⇒ `S |= 页 + 1`
    const again: number[] = [];
    for (let i = 0; i < 5; i++) {
      const d = blinkStep(b, 0, 1000 + (i + 1) * 100, fixed(0.5));
      if (d !== null && d.face !== 0) again.push(d.face);
    }
    expect(again).toEqual([7, 8, 7, 5]);
  });

  it('★★ 道具页眨眼：四帧 `[21, 22, 21, 23]`，第五拍回空闲并记脸号 1', () => {
    const b = blinkStart(1);
    b.mode = 2;
    const faces = run(b, 1, 5, fixed(0.5));
    expect(faces).toEqual([21, 22, 21, 23]);
    expect(b.mode).toBe(0);
    expect(b.face).toBe(1); // S = 0x100
  });

  /*
   * 占比按原版的状态机直接算得出来（每拍 r = rand15() >> 10 ∈ 0..31 均匀）：
   * 空闲里 r ∈ {0, 1} 的概率 2/32 ⇒ 平均 16 拍出一次动作；r == 0 ⇒ 眨眼（贴 4 拍 + 1 拍收场），
   * r == 1 ⇒ 换脸（脸号清 0，下一拍的 pick ∈ 1..3 必 ≠ 0 ⇒ 贴 1 拍）。
   * ⇒ 一轮平均 16 + ½·5 + ½·1 = 19 拍，其中贴图 ½·4 + ½·1 = 2.5 拍 ⇒ **≈ 13.2%**。
   * ★ 第十七份订正：先前上界写 12%，是照着「帧计数不归 0 ⇒ 第二次起眨眼一帧都不贴」的实现量出来的；
   *   `S = 0x200`（0x0042d902）整字写死之后眨眼每次都贴满四帧，占比回到上面这个数。
   */
  it('★★ 10,000 拍里「有动作的拍数」≈ 2.5 / 19 ≈ 13.2%（旧实现 ≈ 100%）', () => {
    const b = blinkStart(0);
    b.mode = 0;
    b.face = 1;
    let acted = 0;
    // 用一个固定的低差异序列代替真随机（`rnd` 注入的意义就在这里）
    let i = 0;
    const rnd = () => {
      i = (i * 1103515245 + 12345) & 0x7fffffff;
      return (i % 32768) / 32768;
    };
    for (let t = 0; t < 10000; t++) {
      const d = blinkStep(b, 0, (t + 1) * 100, rnd);
      if (d !== null && d.face !== 0) acted += 1;
    }
    const ratio = acted / 10000;
    expect(ratio, `有动作的拍数占比 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThan(0.11);
    expect(ratio).toBeLessThan(0.155);
  });

  it('★ 100 ms 不到不推进（原版「隔一次 50 ms 定时器」）', () => {
    const b = blinkStart(0);
    b.mode = 3;
    expect(blinkStep(b, 0, 50, fixed(0.5))).toBeNull();
    expect(blinkStep(b, 0, 99, fixed(0.5))).toBeNull();
    expect(blinkStep(b, 0, 100, fixed(0.5))).not.toBeNull();
  });
});

/*
 * ★★ 第十七份試玩回報（20260924-021515602）「卡片商店老板一直在闪烁」。
 *
 * 原版的脸 / 嘴是**不透明整块贴进后台缓冲**的（`fcn_004563f5`），贴上去就一直留着；
 * 本引擎每帧重画，先前只在动画机推进的那一帧画一下 ⇒ 每张图只在屏上待一帧。
 */
describe('★★ 第十七份：老板娘脸上贴过的图一直留着（不再只闪一帧）', () => {
  const fixed = (v: number): (() => number) => () => v;

  it('贴过的脸在之后「什么都不贴」的拍里仍然在（keeperPaintAfter(prev, null) = prev）', () => {
    let k = keeperPaintStart();
    expect(k).toEqual({ face: 0, mouth: 0, mouthOnTop: false });
    const b = blinkStart(0);
    // 第一拍：进店换脸（模式 3）⇒ 贴 pick + 3
    k = keeperPaintAfter(k, blinkStep(b, 0, 100, fixed(0.5)));
    expect(k.face).toBe(5);
    // 之后 50 拍都是空闲（r = 7）⇒ blinkStep 返回 null，但脸一直是 5
    for (let i = 2; i <= 50; i++) {
      const d = blinkStep(b, 0, i * 100, fixed(7 / 32));
      expect(d).toBeNull();
      k = keeperPaintAfter(k, d);
      expect(k.face).toBe(5);
    }
  });

  it('眨眼四帧之后留着的是最后一帧（卡片页 5 = 脸号 2 + 3；道具页 23 = 脸号 1 + 0x16）', () => {
    for (const [page, last] of [[0, 5], [1, 23]] as const) {
      const b = blinkStart(page);
      b.mode = page === 0 ? 1 : 2;
      let k = keeperPaintStart();
      for (let i = 1; i <= 8; i++) k = keeperPaintAfter(k, blinkStep(b, page, i * 100, fixed(0.5)));
      expect(k.face).toBe(last);
      expect(b.mode).toBe(0);
    }
  });

  it('★ 不说话（没有气泡）时嘴不动 @source 0x0042dc36 `call 0x44ef3b / jne` + `cmp [0x48c314], 0 / je`', () => {
    const b = blinkStart(0);
    b.mode = 0;
    b.face = 1;
    // rnd 恒 0 ⇒ 若没有这道闸，每拍都会 1/4 命中动嘴
    for (let i = 1; i <= 100; i++) {
      const d = blinkStep(b, 0, i * 100, fixed(0.99), false);
      expect(d === null || d.mouth === 0).toBe(true);
    }
    expect(b.hold).toBe(0);
  });

  it('★ 说话时：倒数 0 ⇒ 1/4 机会贴 10/11（道具页 26/27）、倒数 = rand & 7（0 取 1）；倒到 0 贴基准 9 / 25', () => {
    for (const [page, base, first] of [[0, 9, 10], [1, 25, 26]] as const) {
      const b = blinkStart(page);
      b.mode = 0;
      b.face = 1;
      // rnd = 0 ⇒ `rand15() >> 11` = 0 < 4 命中、`rand & 1` = 0、`rand & 7` = 0 ⇒ 取 1；空闲那拍 r = 0 会进眨眼，无妨
      const d = blinkStep(b, page, 100, fixed(0), true);
      expect(d?.mouth).toBe(first);
      expect(b.hold).toBe(1);
      // 下一拍倒数 1 → 0 ⇒ 贴基准嘴（说不说话都走这一支）
      const e = blinkStep(b, page, 200, fixed(0.99), false);
      expect(e?.mouth).toBe(base);
      expect(b.hold).toBe(0);
    }
  });

  it('★ 同一拍脸先贴、嘴后贴 ⇒ 嘴压在上面；只贴脸的那一拍 ⇒ 脸压在上面（两块上下重叠两行）', () => {
    let k = keeperPaintAfter(keeperPaintStart(), { face: 5, mouth: 10 });
    expect(k).toEqual({ face: 5, mouth: 10, mouthOnTop: true });
    k = keeperPaintAfter(k, { face: 7, mouth: 0 });
    expect(k).toEqual({ face: 7, mouth: 10, mouthOnTop: false });
    k = keeperPaintAfter(k, { face: 0, mouth: 9 });
    expect(k).toEqual({ face: 7, mouth: 9, mouthOnTop: true });
  });

  it('★ drawShopScreen 每帧都画留着的那两块（落点 = 表 SHOP_BLINK_AT，按贴的先后）', () => {
    const draws: number[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      drawImage: (b: { idx: number }) => draws.push(b.idx),
      strokeText: () => undefined,
      fillText: () => undefined,
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
    } as unknown as CanvasRenderingContext2D;
    const sprite = ((_a: string, res: number, idx: number) =>
      res === 10 ? { bitmap: { idx }, width: 10, height: 10, anchorX: 0, anchorY: 0 } : null) as never;
    const base = {
      page: SHOP_PAGE.cards,
      panelX: SHOP_SLIDE.panelTo,
      gridX: SHOP_SLIDE.gridTo,
      points: 0,
      shelf: [],
      cells: [],
      bubble: null,
      pressed: null,
    } as const;
    drawShopScreen(ctx, sprite, { ...base, keeper: { face: 5, mouth: 9, mouthOnTop: true } });
    // 底图 0 → 老板娘 2 → 脸 5 → 嘴 9 → 货架栏 1 …
    expect(draws.slice(0, 5)).toEqual([0, 2, 5, 9, 1]);
    draws.length = 0;
    drawShopScreen(ctx, sprite, { ...base, keeper: { face: 5, mouth: 9, mouthOnTop: false } });
    expect(draws.slice(0, 5)).toEqual([0, 2, 9, 5, 1]);
    draws.length = 0;
    drawShopScreen(ctx, sprite, { ...base, keeper: keeperPaintStart() });
    expect(draws.slice(0, 3)).toEqual([0, 2, 1]);
  });
});
