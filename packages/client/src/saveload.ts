/*
 * 存讀檔屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 版式取自原版：
 * ```asm
 * ; VA 0x00403d83
 * 00403d83  push 0x208 / push [0x48a0e4] / call 0x450441   ; Data.mkf 资源 520
 * 00403da0  push 2     / push [0x48a0e4] / call 0x450441   ; 资源 2 = 12 张角色头像
 * 00403dbd  edi = 0x28 ; ebp = 0xf                          ; ★ 屏幕位置 (40, 15)
 * 00403dfa  for (slot = 0; slot <= 5; slot++) {             ; ★ 六个槽
 * 00403e11    sprintf(buf, "SAVE%d.DAT", slot)              ; ★ 文件名
 * 00403e55    if (前 4 字节 != 0x26) 跳过                    ; 存档标识
 * 00403f4b    edi = 72*slot + 0x18                          ; ★ 行距 72，首行 y = 24
 * 00403f58    draw(资源520 图10, 0x81, edi)                  ; x = 129
 * ```
 *
 * 资源 520 有两张底图：
 * - 图 0（555×451）**LOAD**，六行，编号 0..5
 * - 图 1（555×381）**SAVE**，五行，编号 1..5
 *
 * ★ 槽 0 只出现在 LOAD 上 —— 那是**自動存檔**（RICH4.CFG offset 4 的开关），
 *   能读不能手动写。这解释了两张底图为什么差一行、高度差 70。
 *
 * ⚠️ 存哪里：原版写 `SAVE0.DAT`..`SAVE5.DAT`。本项目的存档是带版本号的
 *   JSON（见 core 的 `loaders/savegame.ts`），网页与桌面都放
 *   `localStorage`。桌面版理应写成文件，但那要走 Tauri 的文件 API，
 *   等 M4 收尾时再说 —— 记在 known-deviations 的 Q-SAVE-1。
 *
 * ⚠️ 每行右边那块宽区里写什么（原版画的是角色头像加日期/资产）只解出了
 *   头像的位置，文字位置没解。那部分的排版是**我们的**。
 */

import type { GameState } from '@rich4/core';
import { deserializeGame, serializeGame } from '@rich4/core';
import type { Sprite } from './assets.ts';
import { inRect, type Rect } from './gameui.ts';

/** Data.mkf 里这一屏的资源号 @source 0x00403d83 `push 0x208` */
export const SAVELOAD_RESOURCE = 0x208;
export const SAVELOAD_IMAGE = { load: 0, save: 1 } as const;
/**
 * 一行的构成 —— **逐条对着汇编解出来的**（VA 0x00403f4b 起）：
 *
 * ```asm
 * 00403f55  edi = 72*slot + 0x18                       ; 行 y
 * 00403f59  draw(资源520 图10, 0x81, edi)               ; ★ 左格：粉色底板，x = 129
 * 00403f78  if (slot == 0)
 * 00403f82    draw("AUTO", 0xa5, edi + 0x0f, 2)        ; ★ 只有 0 号槽写 AUTO
 * 00403f9c  year = [0x48a340] >> 16
 * 00403fb3  draw("%d" 年, 0xa5, edi + 0x24, 2)          ; 年，居中于 x = 165
 * 00403fe4  sprintf(buf, "%d/%d", 月, 日)
 * 00403ffc  draw(buf, 0xa5, edi + 0x39, 2)              ; 月/日
 * 00404016  图号 = [0x48a33c] + 2 + [0x48a330]*4        ; = 2 + globalMapId
 * 00404011  draw(资源520 那张图, 0xd1, edi)              ; ★ 中格：地圖縮圖，x = 209
 * 0040404f  esi = 0x121                                 ; ★ 头像起点 x = 289
 * 00404056  for (i = 0; i < 存档里的玩家数; i++) {
 * 00404065    dl = 玩家[i].character                     ; 玩家结构 +0x13
 * 00404088    draw(资源2 图[character], esi, edi)         ; 72×72 角色头像
 * 00404091    esi += 0x48                                ; 步进 72
 *           }
 * ```
 *
 * ★ 也就是说一行是：**粉色底板（上面写年月日）｜ 地圖縮圖 ｜ 四个参与角色的头像**。
 *   头像铺到 x = 505+72 = 577，底图右缘在 40+555 = 595，正好放得下。
 *
 * 存档头也顺带解出来了（VA 0x00403e46 起连着几次 fread）：
 * `4 字节标识 0x26 ｜ 4 字节日期(日|月<<8|年<<16) ｜ 2 字节 gameMap ｜
 *  2 字节 gameStage ｜ 4 字节玩家数 ｜ 4 × 0x68 玩家结构`。
 */
export const MAP_THUMB_BASE = 2;
export const EMPTY_CELL_IMAGE = 10;
/** 角色头像所在的资源 @source 0x00403da0 `push 2` */
export const PORTRAIT_RESOURCE = 2;

/** 屏幕位置 @source 0x00403dbd `mov edi, 0x28` / `mov ebp, 0xf` */
export const SAVELOAD_AT = { x: 0x28, y: 0xf } as const;
/** 两张底图的尺寸 */
export const SAVELOAD_SIZE = {
  load: { w: 555, h: 451 },
  save: { w: 555, h: 381 },
} as const;

/**
 * 行几何。
 *
 * @source 0x00403f4b `edi = 72*slot + 0x18`、0x00403f59 `push 0x81`
 *   —— 行距 72、首行 y = 24、左格 x = 129（都是屏幕坐标）。
 *
 * ★ 与底图**对得上**：在图 1 上按行求平均亮度，亮横线落在 y = 8、80、152、
 *   224、296（图内坐标），步进正好 72；加上底图的位置 15 就是 23/95/…，
 *   与 exe 的 24 只差一像素。竖线落在 x = 164、244、538，而左格 129..201
 *   （图内 89..161）正好顶到第一条竖线 —— 两头独立地对上了同一套格子。
 *
 * 右格与右侧信息区的 x 是**照底图的竖线量的**：右格 206..278（图内 166..238），
 * 信息区从 284（图内 244）起。
 */
export const ROW = { x: 0x81, y0: 0x18, pitch: 72, size: 72 } as const;
/** 底板上那三行字的居中 x @source 0x00403f82 / 0x00403fb3 / 0x00403ffc `push 0xa5` */
export const ROW_TEXT_X = 0xa5;
/** 三行字相对行顶的 y @source `edi + 0x0f / 0x24 / 0x39` */
export const ROW_TEXT_DY = { auto: 0x0f, year: 0x24, date: 0x39 } as const;
/** 地圖縮圖的 x @source 0x00404011 `push 0xd1` */
export const ROW_THUMB_X = 0xd1;
/** 头像起点与步进 @source 0x00404051 `mov esi, 0x121` / 0x00404091 `add esi, 0x48` */
export const ROW_FACE_X0 = 0x121;
export const ROW_FACE_PITCH = 0x48;

/** LOAD 有 6 个槽（含自動存檔的 0 号），SAVE 只有 5 个 */
export const LOAD_SLOTS = 6;
export const SAVE_SLOTS = 5;
/** 自動存檔占 0 号槽 */
export const AUTOSAVE_SLOT = 0;

/** localStorage 的键 —— 照原版的文件名来，一眼能对上 */
export function slotKey(slot: number): string {
  return `RICH4-REMAKE:SAVE${slot}.DAT`;
}

export interface SlotInfo {
  slot: number;
  /** 空槽为 null */
  state: GameState | null;
  /** 读不出来时的说明（格式不对、版本太新…） */
  error: string | null;
}

/**
 * 读一个槽。
 *
 * 坏档**不抛错**：存讀檔屏要能把「这个槽坏了」显示出来，而不是整屏崩掉。
 */
export function readSlot(slot: number): SlotInfo {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(slotKey(slot));
  } catch {
    // 隐私模式之类会直接抛 —— 当作没有存档
    return { slot, state: null, error: '無法讀取存檔區' };
  }
  if (raw === null) return { slot, state: null, error: null };
  try {
    return { slot, state: deserializeGame(raw), error: null };
  } catch (e) {
    return { slot, state: null, error: e instanceof Error ? e.message : '存檔損毀' };
  }
}

/** 写一个槽；写不进去（配额满、隐私模式）返回错误说明 */
export function writeSlot(slot: number, state: GameState): string | null {
  try {
    window.localStorage.setItem(slotKey(slot), serializeGame(state));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '無法寫入存檔區';
  }
}

/** 读出全部槽的概览 */
export function readSlots(count: number): SlotInfo[] {
  return Array.from({ length: count }, (_, i) => readSlot(i));
}

// ============================================================
//  版式
// ============================================================

export type SaveLoadMode = 'save' | 'load';

/** 这一屏的外框（舞台坐标） */
export function panelRect(mode: SaveLoadMode): Rect {
  const size = SAVELOAD_SIZE[mode];
  return { x: SAVELOAD_AT.x, y: SAVELOAD_AT.y, w: size.w, h: size.h };
}

/** 第 i 行（从屏幕上数）对应的槽号：LOAD 从 0 起，SAVE 从 1 起 */
export function slotOfRow(mode: SaveLoadMode, row: number): number {
  return mode === 'load' ? row : row + 1;
}

export function rowCount(mode: SaveLoadMode): number {
  return mode === 'load' ? LOAD_SLOTS : SAVE_SLOTS;
}

/** 一行的可点区域（舞台坐标）—— 从头像左边一直延伸到底图右缘 */
export function rowRect(mode: SaveLoadMode, row: number): Rect {
  const p = panelRect(mode);
  return {
    x: ROW.x,
    y: ROW.y0 + row * ROW.pitch,
    w: p.x + p.w - ROW.x - 8,
    h: ROW.size,
  };
}

/** 点在第几行上；没点中返回 null */
export function hitSaveLoad(mode: SaveLoadMode, x: number, y: number): number | null {
  for (let row = 0; row < rowCount(mode); row++) {
    if (inRect(x, y, rowRect(mode, row))) return row;
  }
  return null;
}

/** 点在这一屏之外（用来「点空白处退出」） */
export function outsideSaveLoad(mode: SaveLoadMode, x: number, y: number): boolean {
  return !inRect(x, y, panelRect(mode));
}

// ============================================================
//  绘制
// ============================================================

export type SpriteFn = (
  archive: 'Data.mkf' | 'Panel.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

export function drawSaveLoad(
  ctx: CanvasRenderingContext2D,
  mode: SaveLoadMode,
  slots: readonly SlotInfo[],
  hot: number | null,
  sprite: SpriteFn,
): void {
  const p = panelRect(mode);
  ctx.save();

  const bg = sprite('Data.mkf', SAVELOAD_RESOURCE, SAVELOAD_IMAGE[mode], true);
  if (bg !== null) ctx.drawImage(bg.bitmap, p.x, p.y);
  else {
    ctx.fillStyle = '#6b8c7b';
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }

  ctx.textBaseline = 'middle';
  for (let row = 0; row < rowCount(mode); row++) {
    const slot = slotOfRow(mode, row);
    const r = rowRect(mode, row);
    const info = slots.find((s) => s.slot === slot);

    if (row === hot) {
      ctx.fillStyle = 'rgba(255,236,120,0.30)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // ★ 一行三段，全照原版：粉底板（写年月日）｜ 地圖縮圖 ｜ 参与角色的头像
    const st = info?.state ?? null;
    const plate = sprite('Data.mkf', SAVELOAD_RESOURCE, EMPTY_CELL_IMAGE, true);
    if (plate !== null) ctx.drawImage(plate.bitmap, r.x, r.y, ROW.size, ROW.size);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#10231a';
    if (slot === AUTOSAVE_SLOT) {
      // @source 0x00403f82：只有 0 号槽写这四个字母
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillText('AUTO', r.x + ROW_TEXT_X - ROW.x, r.y + ROW_TEXT_DY.auto);
    }
    if (st !== null) {
      ctx.font = 'bold 15px "PingFang TC", "Microsoft JhengHei", sans-serif';
      ctx.fillText(String(st.year), r.x + ROW_TEXT_X - ROW.x, r.y + ROW_TEXT_DY.year);
      ctx.font = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
      ctx.fillText(`${st.month}/${st.day}`, r.x + ROW_TEXT_X - ROW.x, r.y + ROW_TEXT_DY.date);

      const thumb = sprite(
        'Data.mkf', SAVELOAD_RESOURCE, MAP_THUMB_BASE + (st.globalMapId & 7), true,
      );
      if (thumb !== null) ctx.drawImage(thumb.bitmap, ROW_THUMB_X, r.y, ROW.size, ROW.size);

      // ★ 参与这一局的**每个**角色都画出来，不是只画轮到的那个
      //   @source 0x00404056 的循环，上界是存档头里的玩家数
      for (let i = 0; i < st.players.length; i++) {
        const face = sprite('Data.mkf', PORTRAIT_RESOURCE, st.players[i]?.character ?? 0, true);
        if (face === null) continue;
        ctx.drawImage(face.bitmap, ROW_FACE_X0 + i * ROW_FACE_PITCH, r.y, ROW.size, ROW.size);
      }
    } else if (info !== undefined && info.error !== null) {
      ctx.textAlign = 'left';
      ctx.font = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = '#a02a20';
      ctx.fillText(`存檔損毀：${info.error}`, ROW_THUMB_X, r.y + ROW.size / 2);
    }
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}
