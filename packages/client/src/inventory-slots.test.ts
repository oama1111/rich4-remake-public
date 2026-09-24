/*
 * ★★ 第 24 份试玩回报（`20260924-181902557`）「道具栏中的道具位置也有点偏移」——
 *   道具欄 / 卡片欄（自己的浮窗、搶奪卡选牌窗、商店右下那 5×3 格）**每一格**的图标 / 数量 / 卡名，
 *   逐个对 exe 公式。
 *
 * @source `fcn_00447c6e`（道具）/ `fcn_00441b0a`（卡片）：内容画进**底图那张图**（或拷了底图的新图）的
 *   **局部坐标** —— 图标 `0x4562a5(dst, 图[槽+2], 0x1d + 80c, 0x21 + 56r)`（锚点对齐），
 *   数量 `0x44fabc(dst, "×%d", 0x4f + 80c, 0x17 + 56r, flag 1)`，卡名 `0x44fabc(dst, 名, 0x2d + 80c, 0x21 + 56r, flag 2)`；
 *   之后整张贴到：自己的浮窗 (14,130)（0x00447e97）、搶奪窗 (14,70) / (14,270)（`fcn_0044192a`）、商店 (0xe3,0x125)（0x0042e5c5）。
 *   先前本引擎把这些偏移加在**命中格**左上角（底图 +5 / 商店 +6）上 ⇒ 整体右下偏 5–6px（搶奪窗连框一起再偏 5px）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeGameState, makePlayer } from '@rich4/core';
import { CARDS } from '@rich4/data';
import { MkfArchive, parseSpriteSheet } from '../../assets-pipeline/src/mkf.ts';
import { drawInventory, INV_ORIGIN, INV_RESOURCE, type InvEntry } from './inventory.ts';
import { drawStealPicker, STEAL_ORIGIN } from './steal-picker.ts';
import { drawShopScreen, SHOP_GRID_Y, SHOP_PAGE, SHOP_SLIDE } from './shop-screen.ts';

const PANEL = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Panel.mkf';

/** 资源 11 各图的锚点：有原版素材就用真值，没有就造一组各不相同的（公式照样能钉住）*/
const anchors: { x: number; y: number }[] = existsSync(PANEL)
  ? parseSpriteSheet(new MkfArchive(new Uint8Array(readFileSync(PANEL))).read(INV_RESOURCE))!.images.map((g) => ({ x: g.x, y: g.y }))
  : Array.from({ length: 17 }, (_, i) => (i < 2 || i > 14 ? { x: 0, y: 0 } : { x: 10 + i, y: 5 + i }));

interface Rec {
  images: { img: number; x: number; y: number }[];
  texts: { t: string; x: number; y: number; align: string; baseline: string }[];
}

function recorder(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { images: [], texts: [] };
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    drawImage: (b: { res: number; img: number }, x: number, y: number) => {
      if (b.res === INV_RESOURCE) rec.images.push({ img: b.img, x, y });
    },
    strokeText: () => undefined,
    fillText(this: { textAlign: string; textBaseline: string }, t: string, x: number, y: number) {
      rec.texts.push({ t, x, y, align: this.textAlign, baseline: this.textBaseline });
    },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

const sprite = ((_a: string, res: number, img: number) =>
  res === INV_RESOURCE
    ? { bitmap: { res, img }, width: 40, height: 40, anchorX: anchors[img]!.x, anchorY: anchors[img]!.y }
    : null) as never;

/** 13 件道具各 1..13 个，紧排进 13 格 */
const TOOL_ENTRIES: InvEntry[] = Array.from({ length: 13 }, (_, i) => ({ slot: i, id: i + 1, count: i + 1 }));
/** 15 张手牌 */
const CARD_ENTRIES: InvEntry[] = Array.from({ length: 15 }, (_, i) => ({ slot: i, id: (i % 30) + 1, count: 1 }));

/** exe：道具格（底图落在 `o`）*/
function expectTools(rec: Rec, o: { x: number; y: number }, entries: readonly InvEntry[]): void {
  const icons = rec.images.filter((r) => r.img >= 2 && r.img <= 14);
  expect(icons).toHaveLength(entries.length);
  for (const e of entries) {
    const c = e.slot % 5;
    const r = Math.floor(e.slot / 5);
    const img = e.id + 1; // 槽 + 2
    const a = anchors[img]!;
    expect(icons.find((x) => x.img === img), `道具 ${e.id}`).toEqual({
      img,
      x: o.x + 0x1d + 0x50 * c - a.x,
      y: o.y + 0x21 + 0x38 * r - a.y,
    });
    const t = rec.texts.find((x) => x.t === `×${e.count}`)!;
    expect({ x: t.x, y: t.y, align: t.align, baseline: t.baseline }, `数量 ${e.id}`).toEqual({
      x: o.x + 0x4f + 0x50 * c,
      y: o.y + 0x17 + 0x38 * r,
      align: 'right',
      baseline: 'top',
    });
  }
}

/** exe：卡片格（只画卡名，正中）*/
function expectCards(rec: Rec, o: { x: number; y: number }, entries: readonly InvEntry[]): void {
  for (const e of entries) {
    const c = e.slot % 5;
    const r = Math.floor(e.slot / 5);
    const name = CARDS[e.id - 1]!.name;
    const t = rec.texts.find((x) => x.t === name)!;
    expect({ x: t.x, y: t.y, align: t.align, baseline: t.baseline }, `卡 ${name}`).toEqual({
      x: o.x + 0x2d + 0x50 * c,
      y: o.y + 0x21 + 0x38 * r,
      align: 'center',
      baseline: 'middle',
    });
  }
}

describe('★★ 道具欄 / 卡片欄每一格对 exe 公式（`fcn_00447c6e` / `fcn_00441b0a`）', () => {
  it('★ 自己的道具欄（14,130）：13 格图标 + 数量', () => {
    const { ctx, rec } = recorder();
    drawInventory(ctx, sprite, 'tools', TOOL_ENTRIES, null);
    expect(rec.images[0]).toEqual({ img: 1, x: INV_ORIGIN.x - anchors[1]!.x, y: INV_ORIGIN.y - anchors[1]!.y });
    expectTools(rec, INV_ORIGIN, TOOL_ENTRIES);
  });

  it('★ 自己的卡片欄（14,130）：15 格卡名', () => {
    const { ctx, rec } = recorder();
    drawInventory(ctx, sprite, 'cards', CARD_ENTRIES, null);
    expect(rec.images[0]).toEqual({ img: 0, x: INV_ORIGIN.x, y: INV_ORIGIN.y });
    expectCards(rec, INV_ORIGIN, CARD_ENTRIES);
  });

  it('★ 載具徽章：底图局部 (0x145, 0x75)（0x00447df9 / 0x00447e1c，徽章锚点 (0,0)）', () => {
    const { ctx, rec } = recorder();
    drawInventory(ctx, sprite, 'tools', [], 15);
    expect(rec.images.find((r) => r.img === 15)).toEqual({ img: 15, x: INV_ORIGIN.x + 0x145, y: INV_ORIGIN.y + 0x75 });
  });

  it('★★ 搶奪卡选牌窗：框落在 (14,70) / (14,270)（`fcn_0044192a`），内容在框的局部坐标', () => {
    const tools = new Array<number>(4 * 15).fill(0);
    for (let id = 1; id <= 13; id++) tools[1 * 15 + id] = id;
    const state = makeGameState({
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, character: i, cards: i === 1 ? CARD_ENTRIES.map((e) => e.id) : [] }),
      ),
      tools,
    });
    const { ctx, rec } = recorder();
    drawStealPicker(ctx, sprite, state, { target: 1, mode: 'steal' }, { select: null });
    expect(rec.images.find((r) => r.img === 0)).toEqual({ img: 0, x: 0x0e, y: 0x46 });
    expect(rec.images.find((r) => r.img === 1)).toEqual({ img: 1, x: 0x0e, y: 0x10e });
    expectCards(rec, STEAL_ORIGIN.cards, CARD_ENTRIES);
    expectTools(rec, STEAL_ORIGIN.tools, TOOL_ENTRIES);
  });

  it('★★ 商店右下 5×3 格：格子底图到位 (0xe3, 0x125)（0x0042e5c5），道具页 / 卡片页', () => {
    const base = {
      panelX: SHOP_SLIDE.panelTo,
      gridX: SHOP_SLIDE.gridTo,
      points: 0,
      shelf: [],
      bubble: null,
      pressed: null,
    } as const;
    const o = { x: 0xe3, y: 0x125 };
    expect(SHOP_SLIDE.gridTo).toBe(o.x);
    expect(SHOP_GRID_Y).toBe(o.y);
    {
      const { ctx, rec } = recorder();
      drawShopScreen(ctx, sprite, { ...base, page: SHOP_PAGE.tools, cells: TOOL_ENTRIES });
      expectTools(rec, o, TOOL_ENTRIES);
    }
    {
      const { ctx, rec } = recorder();
      drawShopScreen(ctx, sprite, { ...base, page: SHOP_PAGE.cards, cells: CARD_ENTRIES });
      expectCards(rec, o, CARD_ENTRIES);
    }
    // 滑入途中：跟着 gridX 走
    {
      const { ctx, rec } = recorder();
      drawShopScreen(ctx, sprite, { ...base, gridX: o.x + 100, page: SHOP_PAGE.tools, cells: TOOL_ENTRIES });
      expectTools(rec, { x: o.x + 100, y: o.y }, TOOL_ENTRIES);
    }
  });
});
