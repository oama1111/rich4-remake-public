/*
 * 開局設定 —— 選人數、選角色、選地圖
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 用的是**原版的美术**：12 个角色头像取自 `Data.mkf` 资源 2
 *   （12 张 72×72，下标即角色编号），名字与开局资金比例取自角色表。
 *
 * ⚠️ **摆位是本项目自己排的，不是原版的**。原版这一屏由
 *   `_rich4_ui_options_entry`（VA 0x00411b53，`rich4_ui_options.asm` 4695 行）
 *   画出来，里面混着键位设置、日期、说明书等一大堆东西，控件坐标尚未逐条解开。
 *   在解开之前，这里**如实按自己的排法画**，而不是照着截图去猜一个像的——
 *   猜出来的「像」比明说「不是」更难纠正。
 *   已解出的部分：背景三块面板在 `Data.mkf` 资源 3（见 0003_000）。
 */

import type { Sprite } from './assets.ts';
import { CHARACTERS } from '@rich4/data';

/** 角色头像所在的资源 @source `Data.mkf` 资源 2，12 张 72×72 */
export const PORTRAIT_RESOURCE = 2;

/** 原版有 8 张地图：`gameStage * 4 + gameMap` */
export const MAP_COUNT = 8;
/** 原版最多四人 */
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

export interface SetupState {
  playerCount: number;
  /** 每个座位的角色编号 */
  characters: number[];
  /** 每个座位是不是真人 */
  human: boolean[];
  mapId: number;
  /** 正在给第几号座位挑角色 */
  editing: number;
}

export function defaultSetup(): SetupState {
  return {
    playerCount: 4,
    characters: [0, 1, 2, 3],
    human: [true, false, false, false],
    mapId: 0,
    editing: 0,
  };
}

// ── 摆位 ──────────────────────────────────────────────

const PORTRAIT = 72;
/** 12 个角色排成 6×2 */
export const GRID = { x: 40, y: 96, cols: 6, gapX: 84, gapY: 88 } as const;
/** 四个座位：P4 右缘 40+3*148+132 = 616，刚好在 640 内 */
export const SEATS = { x: 40, y: 292, pitch: 148, w: 132, h: 106 } as const;
/** 地图选择：8 个格子右缘 40+7*44+36 = 384 */
export const MAPS = { x: 40, y: 418, pitch: 44, w: 36, h: 30 } as const;
/** 人数加减 */
export const BTN_COUNT_MINUS = { x: 470, y: 40, w: 28, h: 28 } as const;
export const BTN_COUNT_PLUS = { x: 540, y: 40, w: 28, h: 28 } as const;
/**
 * 返回与开始。
 *
 * ⚠️ 这两个先前摆在 (470,376) / (470,424)，**正压在 P4 的座位上**
 *   （座位行 y 292..398、右缘 616）—— P4 的「真人/電腦」开关被盖住点不到。
 *   现在与地图格同一行、排在它右边，三者互不相犯。
 */
export const BTN_BACK = { x: 398, y: 416, w: 96, h: 34 } as const;
export const BTN_START = { x: 506, y: 416, w: 110, h: 34 } as const;

export type SetupHit =
  | { kind: 'character'; index: number }
  | { kind: 'seat'; index: number }
  | { kind: 'seatKind'; index: number }
  | { kind: 'map'; index: number }
  | { kind: 'countMinus' }
  | { kind: 'countPlus' }
  | { kind: 'start' }
  | { kind: 'back' };

const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export function hitSetup(x: number, y: number, s: SetupState): SetupHit | null {
  for (let i = 0; i < CHARACTERS.length; i++) {
    const c = i % GRID.cols;
    const r = Math.floor(i / GRID.cols);
    const box = { x: GRID.x + c * GRID.gapX, y: GRID.y + r * GRID.gapY, w: PORTRAIT, h: PORTRAIT };
    if (inRect(x, y, box)) return { kind: 'character', index: i };
  }
  for (let i = 0; i < s.playerCount; i++) {
    const box = { x: SEATS.x + i * SEATS.pitch, y: SEATS.y, w: SEATS.w, h: SEATS.h };
    if (inRect(x, y, box)) {
      // 下三分之一是「人/电脑」开关，其余是「正在编辑这个座位」
      return y > SEATS.y + SEATS.h - 30 ? { kind: 'seatKind', index: i } : { kind: 'seat', index: i };
    }
  }
  for (let i = 0; i < MAP_COUNT; i++) {
    const box = { x: MAPS.x + i * MAPS.pitch, y: MAPS.y, w: MAPS.w, h: MAPS.h };
    if (inRect(x, y, box)) return { kind: 'map', index: i };
  }
  if (inRect(x, y, BTN_COUNT_MINUS)) return { kind: 'countMinus' };
  if (inRect(x, y, BTN_COUNT_PLUS)) return { kind: 'countPlus' };
  if (inRect(x, y, BTN_START)) return { kind: 'start' };
  if (inRect(x, y, BTN_BACK)) return { kind: 'back' };
  return null;
}

/** 把一次点击应用到设定上 */
export function applySetupHit(s: SetupState, hit: SetupHit): SetupState {
  const next: SetupState = {
    ...s,
    characters: [...s.characters],
    human: [...s.human],
  };
  switch (hit.kind) {
    case 'character': {
      // ⚠️ 一个角色只能有一个人用 —— 已被别人占着就先跟他换
      const taken = next.characters.indexOf(hit.index);
      if (taken >= 0 && taken !== next.editing) {
        next.characters[taken] = next.characters[next.editing] ?? 0;
      }
      next.characters[next.editing] = hit.index;
      break;
    }
    case 'seat':
      next.editing = hit.index;
      break;
    case 'seatKind':
      next.human[hit.index] = !(next.human[hit.index] ?? false);
      break;
    case 'map':
      next.mapId = hit.index;
      break;
    case 'countMinus':
      next.playerCount = Math.max(MIN_PLAYERS, next.playerCount - 1);
      if (next.editing >= next.playerCount) next.editing = next.playerCount - 1;
      break;
    case 'countPlus':
      next.playerCount = Math.min(MAX_PLAYERS, next.playerCount + 1);
      break;
    default:
      break;
  }
  return next;
}

// ── 绘制 ──────────────────────────────────────────────

type Need = (archive: 'Data.mkf' | 'Panel.mkf', resource: number, index: number) => Sprite | null;

function panel(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

export function drawSetup(
  ctx: CanvasRenderingContext2D,
  s: SetupState,
  hot: SetupHit | null,
  need: Need,
): void {
  ctx.fillStyle = '#123049';
  ctx.fillRect(0, 0, 640, 480);

  ctx.textBaseline = 'top';
  ctx.font = 'bold 20px "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillStyle = '#e8d24a';
  ctx.fillText('開局設定', 40, 34);

  ctx.font = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillStyle = '#cfe0f0';
  ctx.fillText(`玩家人數 ${s.playerCount}`, 340, 44);

  // 人数加减
  for (const [r, label] of [
    [BTN_COUNT_MINUS, '−'],
    [BTN_COUNT_PLUS, '＋'],
  ] as const) {
    panel(ctx, r, '#1d4569', '#6fa8d8');
    ctx.fillStyle = '#e6f0fa';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(label, r.x + 7, r.y + 4);
  }

  // 12 个角色头像
  for (let i = 0; i < CHARACTERS.length; i++) {
    const c = i % GRID.cols;
    const r = Math.floor(i / GRID.cols);
    const x = GRID.x + c * GRID.gapX;
    const y = GRID.y + r * GRID.gapY;
    const used = s.characters.slice(0, s.playerCount).includes(i);
    const isHot = hot?.kind === 'character' && hot.index === i;

    const p = need('Data.mkf', PORTRAIT_RESOURCE, i);
    if (p !== null) {
      ctx.globalAlpha = used ? 1 : 0.55;
      ctx.drawImage(p.bitmap, x, y);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#1d4569';
      ctx.fillRect(x, y, PORTRAIT, PORTRAIT);
    }
    if (used || isHot) {
      ctx.strokeStyle = used ? '#e8d24a' : '#9fd0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, PORTRAIT + 2, PORTRAIT + 2);
    }
    ctx.fillStyle = '#cfe0f0';
    ctx.font = '12px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.fillText(CHARACTERS[i]?.name ?? '', x, y + PORTRAIT + 2);
  }

  // 四个座位
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const x = SEATS.x + i * SEATS.pitch;
    const active = i < s.playerCount;
    const editing = active && i === s.editing;
    panel(
      ctx,
      { x, y: SEATS.y, w: SEATS.w, h: SEATS.h },
      active ? '#17395a' : '#101f2e',
      editing ? '#e8d24a' : '#4a7ba8',
    );
    if (!active) continue;

    const ch = s.characters[i] ?? 0;
    const p = need('Data.mkf', PORTRAIT_RESOURCE, ch);
    if (p !== null) ctx.drawImage(p.bitmap, x + 6, SEATS.y + 6, 48, 48);
    ctx.fillStyle = '#e6f0fa';
    ctx.font = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.fillText(`P${i + 1}`, x + 62, SEATS.y + 8);
    ctx.fillText(CHARACTERS[ch]?.name ?? '', x + 62, SEATS.y + 28);

    const kind = (s.human[i] ?? false) ? '真人' : '電腦';
    panel(ctx, { x: x + 6, y: SEATS.y + SEATS.h - 28, w: SEATS.w - 12, h: 22 }, '#1d4569', '#6fa8d8');
    ctx.fillStyle = '#e6f0fa';
    ctx.font = '13px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.fillText(kind, x + 12, SEATS.y + SEATS.h - 25);
  }

  // 地图
  ctx.fillStyle = '#cfe0f0';
  ctx.font = '14px "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText('地圖', 40, MAPS.y - 20);
  for (let i = 0; i < MAP_COUNT; i++) {
    const x = MAPS.x + i * MAPS.pitch;
    const on = i === s.mapId;
    panel(ctx, { x, y: MAPS.y, w: MAPS.w, h: MAPS.h }, on ? '#2b6da8' : '#17395a', on ? '#e8d24a' : '#4a7ba8');
    ctx.fillStyle = '#e6f0fa';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(String(i), x + 15, MAPS.y + 8);
  }

  // 返回 / 开始
  panel(ctx, BTN_BACK, '#17395a', '#6fa8d8');
  panel(ctx, BTN_START, '#2b6da8', '#e8d24a');
  ctx.fillStyle = '#e6f0fa';
  ctx.font = 'bold 16px "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText('返回', BTN_BACK.x + 28, BTN_BACK.y + 8);
  ctx.fillText('開始遊戲', BTN_START.x + 20, BTN_START.y + 8);
}
