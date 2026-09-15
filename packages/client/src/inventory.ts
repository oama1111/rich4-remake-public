/*
 * 道具欄 / 卡片欄 浮窗（工具列 #8 / #9）—— T-024
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只摆位置、画字、把「格子 → 道具号/卡片号」算出来；
 *   用不用得了、用了会怎样全在 core（`rules/tools.ts` / `tools-effects.ts`）。
 *
 * ## 出处（VA 0x447d97 道具 / 0x441baa 卡片）
 *
 * 两个浮窗**共用一张底图**：`Panel.mkf` **资源 11**（17 张，412×180），
 * **图 1 = 道具欄**（粉红格）、**图 0 = 卡片欄**（灰绿格），都画在屏幕 **(14,130)**。
 *
 * | 是什么 | @source |
 * |---|---|
 * | 底图落点 (14,130) | 道具 VA 0x447e7d / 卡片 VA 0x441bfb（`fcn_004563f5(dst, 图, 0xe, 0x82)`）|
 * | 格：5×3、原点 (19,135)、间距 (80,56)、格 80×56 | 命中 VA 0x445c8f，与底图上的分隔线两头对得上 |
 * | 道具图标 = **同一张表的图 `道具号 + 2`**（13 张）| VA 0x447cde `[sheet+0xc+(ebx+2)*12]` |
 * | 数量 `×%d` | 格式串 `0x4653e0` |
 * | 卡片格只画**卡名**（不画图标）| VA 0x441b5b `draw_text(sheet, card_table[id].name, …)` |
 * | 道具欄末格「載具徽章」| VA 0x447e08：`traffic_method == 1` → 图 **15**（機車，带禁止标志）；`== 2` → 图 **16**（汽車）|
 * | 关窗 | 右键 `WM_RBUTTONUP`；选中后抬手 `Post_0402_Message(道具号+1)` |
 *
 * ⚠️ **原版没有「按下高亮」**：按下只记状态 + 放确认音（音效 1），
 *   抬手才把选中项抛出去（VA 0x445d84）。故这里也不画高亮。
 *
 * ⚠️ **弹窗自己只负责「选」**：`_rich4_ui_use_tool_entry` 拿到返回值后直接
 *   `call tool_functions[道具号]`（VA 0x447f4b），真正的「用」在那边。
 *   所以**选目标那一段是 T-026**（目标拾取模式），本模块不管。
 */

import type { GameState } from '@rich4/core';
import { CARDS, TOOLS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type InvSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

/** 浮窗底图 @source VA 0x447d97 / 0x441baa 的 `read_mkf(panel_mkf, 0xb, 0, 0)` */
export const INV_RESOURCE = 11;
/** 底图落点（屏幕）@source VA 0x447e7d 的 `push 0x82 / push 0xe` */
export const INV_ORIGIN = { x: 0x0e, y: 0x82 } as const;
/** 两张底图：0 = 卡片欄（灰绿）、1 = 道具欄（粉红）*/
export const INV_BASE = { cards: 0, tools: 1 } as const;

/**
 * 格子几何（屏幕坐标）@source 命中 VA 0x445c8f：
 * `x∈[19,419)`、`y∈[135,303)`；`col=(x−19)/80`、`row=(y−135)/56`。
 */
export const INV_CELL = {
  x0: 0x13,
  y0: 0x87,
  w: 0x50,
  h: 0x38,
  cols: 5,
  rows: 3,
} as const;

/** 格数 = 5×3 = 15（也是手牌上限）*/
export const INV_SLOTS = INV_CELL.cols * INV_CELL.rows;

/** 底图**局部**里各元素的偏移 @source VA 0x447cde（道具）/ 0x441b5b（卡片）*/
export const INV_LOCAL = {
  /** 道具图标：锚点落在 (29+80c, 33+56r)，图号 = 道具号 + 2 */
  iconDx: 0x2d - 0x10,
  iconDy: 0x21,
  iconFirst: 2,
  /** 数量 `×N`：右上行首（flag 1）在 (79+80c, 23+56r) */
  countDx: 0x2d + 0x22,
  countDy: 0x21 - 0xa,
  /** 卡名：居中（flag 2）在 (45+80c, 33+56r) */
  cardDx: 0x2d,
  cardDy: 0x21,
  /** 载具徽章落到末格（4,2）左上角 */
  vehicleX: 0x145,
  vehicleY: 0x75,
} as const;

/** 载具徽章：`traffic_method` → 图号 @source VA 0x447e08 */
export const INV_VEHICLE_IMAGE: ReadonlyMap<number, number> = new Map([
  [1, 15], // 機車（带禁止标志）
  [2, 16], // 汽車
]);

/** 文字：20 号白字 + 深色描边 @source VA 0x447c7c `create_font(…, 0x14)` 与 0x4653e0 */
export const INV_FONT_SIZE = 0x14;
const INV_FONT = '"PingFang TC", "Microsoft JhengHei", sans-serif';

/** 第 `slot` 格的矩形（屏幕坐标）*/
export function invCellRect(slot: number): { x: number; y: number; w: number; h: number } {
  const col = slot % INV_CELL.cols;
  const row = Math.floor(slot / INV_CELL.cols);
  return {
    x: INV_CELL.x0 + col * INV_CELL.w,
    y: INV_CELL.y0 + row * INV_CELL.h,
    w: INV_CELL.w,
    h: INV_CELL.h,
  };
}

/** 点在第几格上；没点中返回 null（坐标是**屏幕/舞台**坐标）*/
export function hitInventory(x: number, y: number): number | null {
  if (x < INV_CELL.x0 || x >= INV_CELL.x0 + INV_CELL.cols * INV_CELL.w) return null;
  if (y < INV_CELL.y0 || y >= INV_CELL.y0 + INV_CELL.rows * INV_CELL.h) return null;
  const col = Math.floor((x - INV_CELL.x0) / INV_CELL.w);
  const row = Math.floor((y - INV_CELL.y0) / INV_CELL.h);
  return row * INV_CELL.cols + col;
}

/** 浮窗里的一格：`slot` + 装的**道具号/卡片号**（+ 道具的数量）*/
export interface InvEntry {
  slot: number;
  id: number;
  count: number;
}

/**
 * 道具欄的格子内容。
 *
 * @source VA 0x447cde：**紧排** —— 数量为 0 的道具跳过且不占格，
 *   同时把 `道具号 + 1` 记进 `[0x48c548 + 槽]`（命中时就查这张表）。
 */
export function toolEntries(state: GameState, playerIndex: number): InvEntry[] {
  const out: InvEntry[] = [];
  for (let id = 1; id <= TOOLS.length && out.length < INV_SLOTS; id++) {
    const count = state.tools[playerIndex * 15 + (id - 1)] ?? 0;
    if (count <= 0) continue;
    out.push({ slot: out.length, id, count });
  }
  return out;
}

/**
 * 卡片欄的格子内容。
 *
 * @source VA 0x441b5b（绘制）与 VA 0x4417a0（命中）：两边**都**按
 *   `player_cards[玩家 × 15 + 下标]` 取 —— 槽号**就是**数组下标。
 *   本引擎的手牌是密集数组（`push`/`splice` 维护），所以与紧排绘制自洽。
 */
export function cardEntries(state: GameState, playerIndex: number): InvEntry[] {
  const hand = state.players[playerIndex]?.cards ?? [];
  const out: InvEntry[] = [];
  for (let i = 0; i < INV_SLOTS; i++) {
    const id = hand[i];
    if (id === undefined || id <= 0) continue;
    out.push({ slot: i, id, count: 1 });
  }
  return out;
}

/**
 * 需要**再选一个目标/数字**才能用的道具 —— 那一小段属 T-026（目标拾取模式）。
 *
 * 判据来自 core 的既有实现：`PLACEMENT_TOOLS`（路障/地雷/定時炸彈，要 `nodeId`）、
 * 飛彈/核子飛彈/機器工人/傳送機/工程車（要目标格）、遙控骰子（要 `value`）。
 * 剩下能用「只用道具号」直接发出去的只有 機車 / 汽車 / 時光機。
 */
export const TOOLS_NEEDING_TARGET: readonly number[] = [2, 3, 4, 7, 9, 11, 12, 13];
/** 遙控骰子：要一个 1..18 的点数 */
export const REMOTE_DICE_TOOL = 8;

/** 这件道具是不是**不用再问**就能直接发 `useTool` */
export function toolIsDirect(id: number): boolean {
  return !TOOLS_NEEDING_TARGET.includes(id) && id !== REMOTE_DICE_TOOL;
}

/** 20 号白字 + 深色描边 @source `create_font(0x14, 0xffffff, 0x101010, 3, 0)` */
function invText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  baseline: CanvasTextBaseline,
): void {
  ctx.font = `${INV_FONT_SIZE}px ${INV_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#101010';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

/**
 * 画浮窗。
 *
 * @param entries 格子内容（见 `toolEntries` / `cardEntries`）
 * @param vehicleImage 载具徽章的图号（只有道具欄会有；`null` = 不画）
 */
export function drawInventory(
  ctx: CanvasRenderingContext2D,
  sprite: InvSprite,
  kind: 'tools' | 'cards',
  entries: readonly InvEntry[],
  vehicleImage: number | null,
): void {
  const ox = INV_ORIGIN.x;
  const oy = INV_ORIGIN.y;

  // 底图（图 1 道具 / 图 0 卡片），锚点是 (0,0)，所以直接落在 (14,130)
  const base = sprite(
    'Panel.mkf',
    INV_RESOURCE,
    kind === 'tools' ? INV_BASE.tools : INV_BASE.cards,
    false,
  );
  if (base !== null) ctx.drawImage(base.bitmap, ox, oy);

  for (const { slot, id, count } of entries) {
    const { x, y } = invCellRect(slot);

    if (kind === 'tools') {
      const icon = sprite('Panel.mkf', INV_RESOURCE, INV_LOCAL.iconFirst + id, true);
      if (icon !== null) {
        ctx.drawImage(
          icon.bitmap,
          x + INV_LOCAL.iconDx - icon.anchorX,
          y + INV_LOCAL.iconDy - icon.anchorY,
        );
      }
      // flag 1 = 右上：x 是右边界、y 是上边界
      invText(ctx, `×${count}`, x + INV_LOCAL.countDx, y + INV_LOCAL.countDy, 'right', 'top');
    } else {
      // 卡片格只画卡名，居中
      invText(ctx, CARD_LABELS.get(id) ?? '', x + INV_LOCAL.cardDx, y + INV_LOCAL.cardDy, 'center', 'middle');
    }
  }

  // 道具欄末格那张「载具徽章」——**盖在格子上**（原版是不透明贴图，VA 0x447e08）
  if (kind === 'tools' && vehicleImage !== null) {
    const badge = sprite('Panel.mkf', INV_RESOURCE, vehicleImage, false);
    if (badge !== null) {
      ctx.drawImage(badge.bitmap, ox + INV_LOCAL.vehicleX, oy + INV_LOCAL.vehicleY);
    }
  }
}

/** 卡名表（`@rich4/data` 的 `CARDS` 是 1 基，做成按卡片号直接取）*/
const CARD_LABELS: ReadonlyMap<number, string> = new Map(CARDS.map((c) => [c.id, c.name]));
