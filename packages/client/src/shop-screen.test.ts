/*
 * 卡片商店／道具商店整屏的版面与命中（P2-8 / U-2）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4_shop.asm` 抄，把最容易写错的几条钉住：
 *   左边货架栏行距 **24（卡片）/ 48（道具）** —— 两页不一样；
 *   右下是 5×3 的 80×56，首格 (233,299)，命中基准是 (232,298) 的开区间；
 *   图自带的裁切原点必须减掉（老板娘那两张就是靠这个才落到 (372,32) / (341,11)）。
 */
import { describe, expect, it } from 'vitest';
import type { PendingInteraction } from '@rich4/core';
import {
  SHOP_BUBBLE_AT,
  SHOP_BUBBLE_MS,
  SHOP_CELL,
  SHOP_CELL_LOCAL,
  SHOP_CELL_ORIGIN,
  SHOP_CHUNK,
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
  cellItemAt,
  hitShopCell,
  hitShopExit,
  hitShopShelf,
  hitShopSwitch,
  shelfRowTextAt,
  shopCellRect,
  shopMessage,
  shopRows,
  slideDone,
  slideStart,
  slideStep,
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

describe('老板娘说的那几句话 @source 串表 0x4755c0', () => {
  it('★ 表是 11 条，按 3*page 取项', () => {
    expect(SHOP_MSG).toHaveLength(11);
    expect(SHOP_MSG[0]).toBe('有什麼我能為你服務的嗎？');
    expect(SHOP_MSG[4]).toBe('歡迎下次再來！');
    expect(SHOP_MSG[5]).toBe('歡迎光臨\n道具店！');
    expect(SHOP_MSG[10]).toBe('謝謝惠顧！');
  });

  it('★ 卡片页：进店 / 提示 / 钱不够 / 栏满 / 离开', () => {
    expect(shopMessage(SHOP_PAGE.cards, 'entry')).toBe('有什麼我能為你服務的嗎？');
    expect(shopMessage(SHOP_PAGE.cards, 'hint')).toBe('請挑選你想要\n兌換的卡片。');
    expect(shopMessage(SHOP_PAGE.cards, 'notEnough')).toBe('抱歉！\n你的點數不足！');
    expect(shopMessage(SHOP_PAGE.cards, 'full')).toBe('對不起！\n您的卡片欄已滿！');
    expect(shopMessage(SHOP_PAGE.cards, 'bye')).toBe('歡迎下次再來！');
  });

  it('★ 道具页：进店 / 提示 / 钱不够 / 栏满 / 离开（注意離開是第 10 条，跳过了「會員」那条）', () => {
    expect(shopMessage(SHOP_PAGE.tools, 'entry')).toBe('歡迎光臨\n道具店！');
    expect(shopMessage(SHOP_PAGE.tools, 'hint')).toBe('您要兌換\n什麼道具？');
    expect(shopMessage(SHOP_PAGE.tools, 'notEnough')).toBe('對不起，\n您的點券不夠！');
    expect(shopMessage(SHOP_PAGE.tools, 'full')).toBe('很抱歉！您的\n道具欄已滿！');
    expect(shopMessage(SHOP_PAGE.tools, 'bye')).toBe('謝謝惠顧！');
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

  it('★ 只带 id / name / price 三样（stock 之类不进这一层）', () => {
    expect(shopRows(SHOP_PAGE.tools, mkShop(cards, tools))[0]).toEqual({
      id: 1,
      name: '道具1',
      price: 50,
    });
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
