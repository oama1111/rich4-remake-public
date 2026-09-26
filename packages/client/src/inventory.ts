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
 * | 道具图标 = **同一张表的图 `槽 + 2`**（13 张）| VA 0x447cde `[sheet+0xc+(ebx+2)*12]` |
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

import {
  canUseCard,
  targetClassOfCard,
  type GameState,
  type MapTopology,
  type StandingInstanceKind,
  type TargetClass,
} from '@rich4/core';
import { CARD_IMPLS, CARDS, TOOLS } from '@rich4/data';
import type { ArchiveName, Sprite } from './assets.ts';
import { classNeedsItsOwnList } from './picking.ts';
import { stockPickModeOfCard, type StockPickMode } from './stock-screen.ts';
import { rebuildPickerNeeded } from './facility-picker.ts';
import { FONT_FAMILY } from './font.ts';
import { drawSprite } from './hd-stage.ts';

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

/**
 * 底图**局部**里各元素的偏移 —— 相对**底图左上角**（= `origin`），**不是**相对命中格。
 *
 * @source 道具 `fcn_00447c6e`：`dst == 0` 时 `dst = sheet + 0x18`（**底图那张图自己**，0x00447ca2..0x00447cad），
 *   图标 `0x4562a5(dst, 图, esi − 0x10, [esp+0x28])` 画进**底图的像素缓冲**，
 *   `esi` 从 0x2d 起每格 +0x50（0x00447cc5 / 0x00447d71），`[esp+0x28]` 从 0x21 起每行 +0x38（0x00447cca / 0x00447d85）；
 *   数量 `0x44fabc(dst, "×%d", esi + 0x22, [esp+0x28] − 0xa, flag 1)`（0x00447d46..0x00447d5e）。
 *   卡片 `fcn_00441b0a` 同形：`dst == 0` → `sheet + 0xc`（图 0），卡名 `0x44fabc(dst, 名, ebx, edi, flag 2)`，
 *   `ebx` 从 0x2d 起 +0x50、`edi` 从 0x21 起 +0x38（0x00441b49 / 0x00441b4e / 0x00441b95 / 0x00441ba5）。
 *   画好之后整张底图才贴到屏幕 (14,130)（0x00447e97..0x00447ea9 `0x4563f5(…, 0xe, 0x82)`，底图锚点 (0,0)）。
 * ★★ 第 24 份试玩回报「道具栏中的道具位置也有点偏移」：先前这里把偏移加在**命中格**的左上角
 *   （`INV_CELL` = 底图 +5,+5）上 ⇒ 图标、数量、卡名整体**右下偏 5px**。
 */
export const INV_LOCAL = {
  /**
   * 道具图标：锚点落在底图局部 (0x1d + 80c, 0x21 + 56r)。
   *
   * ★ 图号 = **槽 + 2**，而槽 = 道具号 − 1（原版 `player_tool_amount` 是 0 基的
   *   13 格，`ebx` 就是槽号）—— 所以图号 = **道具号 + 1**。
   *   ⚠️ 本引擎 `state.tools` 的下标是 `玩家×15 + 道具号`（1 基、0 号空置，
   *   见 `loaders/savegame.ts` 把原版 `owned[id-1]` 写进 `tools[… + id]`），
   *   与这里的**槽**差 1，别混。
   */
  iconDx: 0x2d - 0x10,
  iconDy: 0x21,
  iconFirst: 1,
  /** 数量 `×N`：右上行首（flag 1）在底图局部 (0x4f + 80c, 0x17 + 56r) */
  countDx: 0x2d + 0x22,
  countDy: 0x21 - 0xa,
  /** 卡名：居中（flag 2）在底图局部 (0x2d + 80c, 0x21 + 56r) */
  cardDx: 0x2d,
  cardDy: 0x21,
  /** 每格步长（`add esi, 0x50` / `add [esp+0x28], 0x38`）*/
  stepX: 0x50,
  stepY: 0x38,
  /** 载具徽章落到末格（4,2）左上角 */
  vehicleX: 0x145,
  vehicleY: 0x75,
} as const;

/** 第 `slot` 格内容的**参照点**（= 底图左上角 + 列 / 行步长，屏幕坐标）—— `INV_LOCAL` 的偏移加在它上面 */
export function invContentOrigin(slot: number, origin: InvOrigin = INV_ORIGIN): { x: number; y: number } {
  return {
    x: origin.x + (slot % INV_CELL.cols) * INV_LOCAL.stepX,
    y: origin.y + Math.floor(slot / INV_CELL.cols) * INV_LOCAL.stepY,
  };
}

/** 载具徽章：`traffic_method` → 图号 @source VA 0x447e08 */
export const INV_VEHICLE_IMAGE: ReadonlyMap<number, number> = new Map([
  [1, 15], // 機車（带禁止标志）
  [2, 16], // 汽車
]);

/** 文字：20 号白字 + 深色描边 @source VA 0x447c7c `create_font(…, 0x14)` 与 0x4653e0 */
export const INV_FONT_SIZE = 0x14;
const INV_FONT = FONT_FAMILY;

/**
 * 浮窗**底图**的落点。
 *
 * ★ 同一张底图（`Panel.mkf` 11）在原版里画在三处，落点各不相同：
 *   自己的道具/卡片欄在 (14,130)（本文件），搶奪卡的选牌窗在 (14,70)（卡片）与
 *   (14,270)（道具）—— 见 `steal-picker.ts`。格子相对**底图**的偏移三处一致
 *   （都是 +5,+5），所以几何函数都接受一个 `origin`。
 */
export interface InvOrigin {
  x: number;
  y: number;
}

/** 第 `slot` 格的矩形（屏幕坐标）；`origin` 省略 = 自己的浮窗 */
export function invCellRect(
  slot: number,
  origin: InvOrigin = INV_ORIGIN,
): { x: number; y: number; w: number; h: number } {
  const col = slot % INV_CELL.cols;
  const row = Math.floor(slot / INV_CELL.cols);
  return {
    x: origin.x + (INV_CELL.x0 - INV_ORIGIN.x) + col * INV_CELL.w,
    y: origin.y + (INV_CELL.y0 - INV_ORIGIN.y) + row * INV_CELL.h,
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
    // ★ 下标 = 玩家×15 + **道具号**（core 的约定，0 号空置）
    const count = state.tools[playerIndex * 15 + id] ?? 0;
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
 * 飛彈/核子飛彈/機器工人/傳送機（要目标格）、遙控骰子（要 `value`）。
 * 剩下能用「只用道具号」直接发出去的是 機器娃娃 / 機車 / 汽車 / 時光機 / **工程車**。
 *
 * ★ **工程車（12）不在本表**（2026-09-25 订正）—— 先前误把它列进来，于是
 *   `applyInventoryPick` 走 `TOOL_SELECT_PARAM.get(12) === undefined` 的兜底分支：
 *   点一下只写一条日志，**一个 action 都不发**，这件道具对真人等于不存在。
 *   原版真人那一支**没有**拾取这一步 —— 弹窗的返回值就是道具号，直接进道具函数表：
 * ```asm
 * 00447f4b  test esi, esi                        ; esi = 道具欄弹窗（fcn_00445c14）的返回值 = 道具号
 * 00447f4d  je       0x447f5a                    ; 没选中 ⇒ 跳过
 * 00447f4f  mov  eax, esi
 * 00447f51  call dword ptr [eax*4 + 0x475dd5]    ; ★ 直接 call 道具函数表[道具号]
 * ```
 *   表项 12 → `0x4479d2` = `_rich4_use_tool_gongchengche`（`rich4-re/asm/rich4_tool_gongchengche.asm`）；
 *   该函数整支只有 3 个 call（`0x40b93b` 换精灵 / `0x41d476` / `0x44ef41` 报台词），
 *   **没有** `call 0x446ae8`（拾取器）；`disasm.py callers 0x446ae8` 的 32 个调用点
 *   无一落在 `0x4479d2..0x447ace`（表项 12..13 之间）之内。
 *   ⇒ 工程車与 機車/汽車 同形，是**无参**的 `useTool{toolId:12}`：core 的 `VEHICLE_TOOLS`
 *   早已支持（不需要 `nodeId`），电脑那一支也回 `plain`（`ai/tool-policy.ts` 的 `gongcheng`，
 *   `@source 0x00421e20`）—— 缺的只是真人这一侧的闸门。
 */
export const TOOLS_NEEDING_TARGET: readonly number[] = [2, 3, 4, 7, 9, 11, 13];
/** 遙控骰子：要一个 1..18 的点数 */
export const REMOTE_DICE_TOOL = 8;

/**
 * 卡片欄选了一张卡之后该走哪条路。
 *
 * @source `_rich4_ui_use_card_entry` VA 0x441c22 起：弹窗拿到卡号 → 报台词
 *   （`sprintf("使用%s", 卡名)`）→ `call card_functions[卡号]`；**返回 0
 *   （没用成）就播失败音并把弹窗再开回来**（`jmp loc_00441c22`）。
 *
 * 本引擎按同一件事分三路：先问 core 预演「现在出不出得了」——
 *   - `use`     不需要目标、现在就能出 → 直接发 `useCard{target: none}`
 *   - `pick`    要选目标 → 进 T-026 拾取模式（`cls`/`param` 取自卡片表）
 *   - `cannot`  现在出不了（被动卡、时机不对…）→ 失败音 + 弹窗开回来
 *
 * ★ Q-PICK-2 补的两路（原版这两类**不进**棋盘拾取窗口）：
 *   - `stockPick` 紅卡(24)/黑卡(25) → 复用**股市屏**的选股模式（参数 1/2）
 *   - `objectAuto` 請神符(23) → 原版是 `0x444d1a` 的**自动请最近的神**，没有 UI
 *
 * ★ `facilityPick`（第三路，2026-09-16 补）：改建卡(7) 站在**等级 ≥ 1 的設施**上时，
 *   原版是卡片函数自己开「請選擇設施類別」窗（VA 0x004431c8，参数 1），
 *   **不走棋盘拾取**；右键取消 = 这张卡不消耗（返回 0）。
 *
 * ★ 原版**不灰显**被动卡 —— `fcn_00441b0a` 只画卡名、一个字体一个颜色。
 */
export type CardPickRoute =
  | { kind: 'use' }
  | { kind: 'pick'; cls: TargetClass; param: number }
  | { kind: 'stockPick'; mode: StockPickMode }
  | { kind: 'objectAuto' }
  | { kind: 'facilityPick' }
  | { kind: 'cannot'; needsOwnList: boolean };

/** 改建卡 @source `_rich4_card_functions[6]` = `_rich4_use_card_gaijianka` */
export const REBUILD_CARD_ID = 7;

/** 这件道具是不是**不用再问**就能直接发 `useTool` */
export function toolIsDirect(id: number): boolean {
  return !TOOLS_NEEDING_TARGET.includes(id) && id !== REMOTE_DICE_TOOL;
}

/**
 * 出牌者脚下那一格的实例类别 —— core 的 `targetClassOfCard` 用它定
 * 换地/换屋的目标类别（脚下是地块 → 地块；脚下是設施 → 設施）。
 *
 * ★ 这里只是把地图拓扑读出来，规则仍只有 core 一份（C-ARC-2）。
 */
function standingKindOf(state: GameState, topo: MapTopology): StandingInstanceKind {
  const me = state.players[state.currentPlayer];
  if (me === undefined) return null;
  const node = topo.nodes[me.nodeId - 1];
  if (node === undefined) return null;
  if (node.ref.kind === 'land') return 'land';
  if (node.ref.kind === 'facility') return 'facility';
  return null;
}

/**
 * 卡片欄选了一张卡之后走哪条路 —— **纯函数**，把决策表钉在这里以便单测
 * （`main.ts` 只负责照着发 action / 开拾取会话）。
 */
export function routeCardPick(
  state: GameState,
  topo: MapTopology,
  cardId: number,
): CardPickRoute {
  if (canUseCard(state, topo, cardId, { kind: 'none' })) return { kind: 'use' };
  // ★ 改建卡站在等级 ≥ 1 的設施上：先过选類別窗（原版在卡片函数里开，参数 1）。
  //   放在 `cls` 之前 —— 这张卡的 `selection` 是 `'none'`，否则会被判成「用不成」。
  if (cardId === REBUILD_CARD_ID && rebuildPickerNeeded(state, topo)) {
    return { kind: 'facilityPick' };
  }
  const impl = CARD_IMPLS[cardId - 1];
  const cls = impl === undefined ? 'none' : targetClassOfCard(impl, standingKindOf(state, topo));
  if (cls === 'none') return { kind: 'cannot', needsOwnList: false };
  // ★ 紅卡/黑卡：原版走股市屏的**选股模式**（`_rich4_ui_stock_entry` 参数 1/2）
  if (cls === 'stock') {
    const mode = stockPickModeOfCard(cardId);
    return mode === null ? { kind: 'cannot', needsOwnList: true } : { kind: 'stockPick', mode };
  }
  // ★ 請神符：原版**没有列表也没有拾取窗口**，直接请最近的那尊（VA 0x00444d1a）
  if (cls === 'object') return { kind: 'objectAuto' };
  if (classNeedsItsOwnList(cls)) return { kind: 'cannot', needsOwnList: true };
  return { kind: 'pick', cls, param: impl?.selectionParam ?? 0 };
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
  origin: InvOrigin = INV_ORIGIN,
): void {
  const ox = origin.x;
  const oy = origin.y;

  // 底图（图 1 道具 / 图 0 卡片），锚点是 (0,0)，所以直接落在 origin 上
  const base = sprite(
    'Panel.mkf',
    INV_RESOURCE,
    kind === 'tools' ? INV_BASE.tools : INV_BASE.cards,
    false,
  );
  if (base !== null) drawSprite(ctx, base, ox, oy);

  for (const { slot, id, count } of entries) {
    // ★ 相对**底图**（不是命中格），见 `INV_LOCAL`
    const { x, y } = invContentOrigin(slot, origin);

    if (kind === 'tools') {
      const icon = sprite('Panel.mkf', INV_RESOURCE, INV_LOCAL.iconFirst + id, true);
      if (icon !== null) {
        drawSprite(
          ctx,
          icon,
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
      drawSprite(ctx, badge, ox + INV_LOCAL.vehicleX, oy + INV_LOCAL.vehicleY);
    }
  }
}

/** 卡名表（`@rich4/data` 的 `CARDS` 是 1 基，做成按卡片号直接取）*/
const CARD_LABELS: ReadonlyMap<number, string> = new Map(CARDS.map((c) => [c.id, c.name]));
