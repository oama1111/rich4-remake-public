/*
 * 搶奪卡（13）的「从对方手里挑一件」窗 —— T-053
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这张卡在 core 里早就完整（`cards/rob.ts` 的卡片路径与道具路径都在），
 * 缺的一直是**真人挑哪一件**这一窗 —— 先前 `target.steal` 只好由 AI 给，
 * 真人一用就 `targetRequired`（见 `docs/known-deviations.md` 的 Q-CARD-2 一带）。
 *
 * ## 出处（`rich4_ui_use_card.asm`）
 *
 * 效果函数 **`fcn_0044192a`**（VA 0x0044192a，`:533`）的**真人那一支**：
 * ```asm
 * read_mkf(panel_mkf, 0xb)              ; ★ 与自己道具/卡片欄同一张底图（资源 11）
 * fcn_00447c6e(0, sheet, 对方)          ; 画对方的**道具**欄
 * fcn_00441b0a(0, sheet, 对方)          ; 画对方的**卡片**欄
 * fcn_004563f5(dst, [sheet+0xc], 0xe, 0x46)    ; ★ 图 0（卡片框）落 (14,70)
 * if (模式 == 1) fcn_004563f5(dst, [sheet+0x18], 0xe, 0x10e) ; 图 1（道具框）落 (14,270)
 * Wait_0402_Message(fcn_004413ec, (模式 << 16) | 对方)
 * ```
 * （`[sheet+0xc]` / `[sheet+0x18]` 是 12 字节一项的精灵表里的**第 0 / 第 1 项**。）
 *
 * 窗口过程 **`fcn_004413ec`**（VA 0x004413ec，`:87`）：
 * | 消息 | 做什么 |
 * |---|---|
 * | `0x401` 初始化 | 清选择；`[0x48c53c] = lParam & 3`（**对方席位**）、`[0x48c540] = lParam >> 16`（**模式**）|
 * | `0x201` 按下 | 卡片带 `x∈[0x13,0x1a3)`、`y∈[0x4b,0xf3)`；道具带同 x、`y∈[0x113,0x1bb)`；`slot = row*5 + col` |
 * | `0x202` 抬起 | 有选择 → `Post_0402_Message(选择)` |
 * | `0x205` 右键 | `Post_0402_Message(0)` = **取消** |
 *
 * 选中值：卡片 = `player_cards[对方*15 + slot]`（**0 = 空格，当场什么都不做**）；
 * 道具 = `[0x48c548 + slot] | 0x8000`，而那张表由道具欄绘制**紧排**填成
 * （`道具号`；本引擎的 `toolEntries` 就是这个顺序）。
 * ★ **道具只有 `[0x48c540] != 0`（= 搶奪卡，模式 1）时才认** ——
 *   命運 5「生日收卡」也是同一个函数（模式 0），那一支只收卡。
 *
 * 拿到选择之后（`fcn_0044192a` 尾巴 VA 0x00441ab9）：
 * `bh & 0x80` → `take_tool`(0x445aa2) + `give_tool`(0x445a4d)；
 * 否则 → `consume_card`(0x441343) + `receive_card`(0x4412e4)。
 * ⇒ **这一窗只回答「挑哪一件」**，转移与敌意增量都在 core（C-ARC-2）。
 *
 * ⚠️ **取消 = 卡不消耗**：调用方 `_rich4_use_card_qiangduoka`
 *   （`rich4_card_qiangduoka.asm:87` 起）拿返回值 `test eax,eax / je loc_00441f1b`
 *   直接返回 —— 只有抢成了才走 `consume_card(13)`（同文件 `:100`）。
 *   本引擎照抄：取消那一下**一个 action 都不派**。
 *
 * ⚠️ 本窗是**浮窗**：原版进屋先 `fcn_00451e7e` 存下 (0,0x28)-(0x1b8,0x1e0)
 *   那块，走时贴回（与施設类别窗同一手法）⇒ `windowed: true`。
 *
 * ⚠️ 与**自己的**道具欄不同，这一窗**按下就有选中框**：按下那一支在交给
 *   `fcn_00451b9e`(VA 0x00451b9e) 之前算了一个矩形（VA 0x00441499 起，卡片带）：
 *   `x0 = col*0x50 + 0x14`、`x1 = col*0x50 + 0x62`、`y0 = row*0x38 + 0x4c`、
 *   `y1 = row*0x38 + 0x82`（道具带同样 +0x114 / +0x14a）—— 即**格内缩 1px**。
 *   本引擎画一个 1px 的框把那个矩形表示出来。
 */

import type { CardTarget, GameState } from '@rich4/core';
import { ARROW_CURSOR, showCursor, type CursorWant } from './soft-cursor.ts';
import type { UiScreen, UiScreenEnv } from './ui-screen.ts';
import {
  cardEntries,
  drawInventory,
  toolEntries,
  type InvEntry,
  type InvOrigin,
  type InvSprite,
} from './inventory.ts';

/** 底图 @source `fcn_0044192a` 的 `read_mkf(panel_mkf, 0xb, 0, 0)` */
export const STEAL_ARCHIVE = 'Panel.mkf' as const;
export const STEAL_RESOURCE = 0xb;
/** 底图里的两张框：**图 0 = 卡片欄**、**图 1 = 道具欄**（`[sheet+0xc]` / `[sheet+0x18]`）*/
export const STEAL_FRAME = { cards: 0, tools: 1 } as const;
/** 两张框的落点 @source `push 0xe / push 0x46` 与 `push 0xe / push 0x10e` */
export const STEAL_ORIGIN = {
  cards: { x: 0x0e, y: 0x46 },
  tools: { x: 0x0e, y: 0x10e },
} as const;

const CARD_BAND = { y0: 0x4b, y1: 0xf3 } as const;
const TOOL_BAND = { y0: 0x113, y1: 0x1bb } as const;
/** 两带共用的横带 @source `cmp ebx, 0x13 / cmp ebx, 0x1a3` */
export const STEAL_BAND_X = { x0: 0x13, x1: 0x1a3 } as const;
/** 格：5 列 × 3 行、每格 0x50 × 0x38 @source 同一支的 `idiv 0x50 / idiv 0x38` */
export const STEAL_GRID = { cols: 5, rows: 3, cellW: 0x50, cellH: 0x38 } as const;
/** 选中框相对格子**内缩**多少 @source `x0 = col*0x50 + 0x14`（格左边界 0x13 ⇒ +1）*/
export const STEAL_SELECT_INSET = 1;
/** 选中框颜色。原版交给 `fcn_00451b9e` 画，那支是直接改像素的例程（颜色逐像素写死在那里）*/
export const STEAL_SELECT_COLOR = '#ffffff';

/** 模式 = `fcn_0044192a` 的第 3 个实参，也就是 `Wait` 里 `<< 16` 那一位 */
export type StealMode = 'steal' | 'gift';

/** 挑中的那一件 */
export type StealPick = { kind: 'card' | 'tool'; id: number };

/** 这一窗在问哪一位（席位）*/
export interface StealPickerState {
  target: number;
  mode: StealMode;
}

// ============================================================
//  純函数
// ============================================================

/**
 * 第 `kind` 欄的格子原点 = **框落点 + (5,5)**。
 *
 * ★ 那个 (5,5) 与自己道具欄同一相对偏移：自己的框在 (14,130)、格原点 (19,135)
 *   （`inventory.ts` 的 `INV_ORIGIN` / `INV_CELL`）。
 */
export function stealGridOrigin(kind: 'cards' | 'tools'): InvOrigin {
  const o = kind === 'cards' ? STEAL_ORIGIN.cards : STEAL_ORIGIN.tools;
  return { x: o.x + 5, y: o.y + 5 };
}

/** 第 `slot` 格的矩形（屏幕坐标）*/
export function stealCellRect(
  kind: 'cards' | 'tools',
  slot: number,
): { x: number; y: number; w: number; h: number } {
  const g = stealGridOrigin(kind);
  const col = slot % STEAL_GRID.cols;
  const row = Math.floor(slot / STEAL_GRID.cols);
  return {
    x: g.x + col * STEAL_GRID.cellW,
    y: g.y + row * STEAL_GRID.cellH,
    w: STEAL_GRID.cellW,
    h: STEAL_GRID.cellH,
  };
}

/** 选中框矩形 = 格内缩 1px（见头注释的 VA）*/
export function stealSelectRect(
  kind: 'cards' | 'tools',
  slot: number,
): { x: number; y: number; w: number; h: number } {
  const c = stealCellRect(kind, slot);
  return {
    x: c.x + STEAL_SELECT_INSET,
    y: c.y + STEAL_SELECT_INSET,
    w: c.w - STEAL_SELECT_INSET * 2,
    h: c.h - STEAL_SELECT_INSET * 2,
  };
}

/**
 * 这一点落在哪一欄的第几格（`null` = 两条带都没中）。
 *
 * @source `fcn_004413ec` 的 `0x201` 分支：卡片带 `y∈[0x4b,0xf3)`；
 *   道具带 `y∈[0x113,0x1bb)`，**并且只在 `mode === 'steal'` 时才认**
 *   （那一支开头就是 `cmp dword [0x48c540], 0 / je 什么都不做`）。
 */
export function hitStealCell(
  x: number,
  y: number,
  mode: StealMode,
): { kind: 'cards' | 'tools'; slot: number } | null {
  if (x < STEAL_BAND_X.x0 || x >= STEAL_BAND_X.x1) return null;
  const inBand = (band: { y0: number; y1: number }): boolean => y >= band.y0 && y < band.y1;
  const which =
    inBand(CARD_BAND) ? 'cards' : mode === 'steal' && inBand(TOOL_BAND) ? 'tools' : null;
  if (which === null) return null;
  const band = which === 'cards' ? CARD_BAND : TOOL_BAND;
  const col = Math.floor((x - STEAL_BAND_X.x0) / STEAL_GRID.cellW);
  const row = Math.floor((y - band.y0) / STEAL_GRID.cellH);
  if (col < 0 || col >= STEAL_GRID.cols) return null;
  if (row < 0 || row >= STEAL_GRID.rows) return null;
  return { kind: which, slot: row * STEAL_GRID.cols + col };
}

/** 某一欄的格子内容（对方的道具/卡片 —— 复用自己那道浮窗的算法）*/
export function stealEntries(
  state: GameState,
  target: number,
  kind: 'cards' | 'tools',
): InvEntry[] {
  return kind === 'cards' ? cardEntries(state, target) : toolEntries(state, target);
}

/** 某一格上装的是什么（空格 → `null`）*/
export function stealPickAt(
  state: GameState,
  target: number,
  kind: 'cards' | 'tools',
  slot: number,
): StealPick | null {
  const hit = stealEntries(state, target, kind).find((e) => e.slot === slot);
  if (hit === undefined) return null;
  return { kind: kind === 'cards' ? 'card' : 'tool', id: hit.id };
}

/** 这一点挑中了什么（把「命中带」与「格子上有东西」两件事合起来）*/
export function stealPickAtPoint(
  state: GameState,
  target: number,
  mode: StealMode,
  x: number,
  y: number,
): StealPick | null {
  const cell = hitStealCell(x, y, mode);
  if (cell === null) return null;
  return stealPickAt(state, target, cell.kind, cell.slot);
}

/**
 * 这张卡打这个目标，要不要先开这一窗。
 *
 * 判据（纯查状态）：① 是搶奪卡 13；② 目标是**玩家**（原版这一窗只服务
 * `player_cards`，其它目标类别由别的分支处理）；③ 对方身上**确实有东西可拿**
 * （卡片或道具 —— 两样都空时原版那一窗是空框，点了也没用；core 的
 * `applyRobCardCard`/`applyRobCard` 也会以 `nothingToRob` 失败）。
 */
export function needsStealPick(state: GameState, cardId: number, target: CardTarget): boolean {
  if (cardId !== STEAL_CARD_ID) return false;
  if (target.kind !== 'player') return false;
  const idx = target.index;
  if (idx < 0 || idx >= state.players.length) return false;
  if (stealEntries(state, idx, 'cards').length > 0) return true;
  return stealEntries(state, idx, 'tools').length > 0;
}

/** 搶奪卡 @source 卡片表里的 13（`cards/registry.ts` 的 `case 13`）*/
export const STEAL_CARD_ID = 13;

// ============================================================
//  绘制（纯 IO）
// ============================================================

export type StealSprite = InvSprite;

export interface StealDraw {
  /** 这一刻按下选中的那一格 */
  select: { kind: 'cards' | 'tools'; slot: number } | null;
}

/** 画整扇窗（只在本屏接管时调）*/
export function drawStealPicker(
  ctx: CanvasRenderingContext2D,
  sprite: StealSprite,
  state: GameState,
  st: StealPickerState,
  d: StealDraw,
): void {
  // ★ 框与内容是同一函数画的：`drawInventory` 的底图就是这两张框
  //   （`INV_BASE` = 图 0 卡片 / 图 1 道具 = `STEAL_FRAME`），内容叠在框上。
  const draw = (kind: 'cards' | 'tools'): void => {
    drawInventory(ctx, sprite, kind, stealEntries(state, st.target, kind), null, stealGridOrigin(kind));
  };
  draw('cards');
  if (st.mode === 'steal') draw('tools');
  if (d.select !== null) {
    const r = stealSelectRect(d.select.kind, d.select.slot);
    ctx.strokeStyle = STEAL_SELECT_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
}

// ============================================================
//  UiScreen（浮窗）
// ============================================================

/** 选完 / 取消各调一次：`null` = 取消（右键）*/
export type StealAnswer = (pick: StealPick | null) => void;

let answer: StealAnswer | null = null;
let info: StealPickerState | null = null;
/** 按下时记下的那一格（画选中框用）*/
let select: { kind: 'cards' | 'tools'; slot: number } | null = null;
/** 按下时读出来的**选中值** @source `[0x48c538]` —— 抬手只看它，不重新命中 */
let picked: StealPick | null = null;

/** 调试 / 单测用：关掉这一屏 */
export function resetStealPicker(): void {
  answer = null;
  info = null;
  select = null;
  picked = null;
}

/** 现在开着吗（单测用）*/
export function stealPickerOpen(): boolean {
  return answer !== null;
}

/** 开窗；选完（或右键取消）调一次 `answer` */
export function openStealPicker(
  target: number,
  mode: StealMode,
  cb: StealAnswer,
): void {
  answer = cb;
  info = { target, mode };
  select = null;
  picked = null;
}

function close(): void {
  answer = null;
  info = null;
  select = null;
  picked = null;
}

export const stealPickerScreen: UiScreen = {
  id: 'steal-picker',

  /**
   * 软件指针：浮窗放出箭头 @source 0x00441461 / 0x00441752 `fcn_00402460(1)`；
   * 只由本机真人的拾取流程打开（`openStealPicker`）。
   */
  cursor: (): CursorWant => showCursor(ARROW_CURSOR),

  /** ★ 浮窗（原版 `fcn_00451e7e` 存下中间那块再贴回）*/
  windowed: true,

  active: () => info !== null,

  /**
   * ★ **待决交互那一支**（T-055）：`pending.kind === 'birthdayCard'` 时
   *   自己开窗问 `seats[0]` 那一位（模式 `gift` ⇒ 只有卡片欄，与 exe 的
   *   `push 0` 一致），答完派 `{type:'birthdayCard', seat, cardId}`；
   *   右键取消 = `cardId: 0`（原版选牌窗返回 0，**调用方照样推进**）。
   *
   * ⚠️ 每一帧都会被调（所有登记的屏都收 `tick`），所以只在**没开着**时才开。
   */
  tick(env: UiScreenEnv): void {
    const p = env.state.pending;
    if (p === null || p.kind !== 'birthdayCard') return;
    if (answer !== null) return;
    const seat = p.seats[0];
    if (seat === undefined) return;
    openStealPicker(seat, 'gift', (pick) => {
      env.dispatch({ type: 'birthdayCard', seat, cardId: pick?.id ?? 0 });
    });
    env.requestRender();
  },

  draw(env: UiScreenEnv): void {
    if (info === null) return;
    drawStealPicker(
      env.stage,
      env.sprite as unknown as StealSprite,
      env.state,
      info,
      { select },
    );
  },

  down(x: number, y: number, env: UiScreenEnv): void {
    if (info === null) return;
    const cell = hitStealCell(x, y, info.mode);
    if (cell === null) return;
    const pick = stealPickAt(env.state, info.target, cell.kind, cell.slot);
    // ★ 原版按下这一支只**记**：命中框 + 把选中值写进 `[0x48c538]`
    //   （空格子 `player_cards == 0` 直接返回，选择保持原样）
    if (pick === null) return;
    select = cell;
    picked = pick;
    env.requestRender();
  },

  up(_x: number, _y: number, env: UiScreenEnv): void {
    if (info === null) return;
    // ★ 抬手**不重新命中**：`fcn_004413ec` 的 `0x202` 那一支直接看 `[0x48c538]`
    //   （所以「按在卡上 → 拖出去 → 松手」仍然算选中了那张卡）。
    //   没选中（= 0）时什么都不做，窗继续开着。
    if (picked === null) return;
    const cb = answer;
    const value = picked;
    close();
    cb?.(value);
    env.requestRender();
  },

  contextmenu(_x: number, _y: number, env: UiScreenEnv): void {
    if (info === null) return;
    // ★ 右键 = `Post_0402_Message(0)` = 取消 ⇒ 卡**不消耗**（调用方 `test eax,eax`）
    const cb = answer;
    close();
    cb?.(null);
    env.requestRender();
  },
};
