/*
 * 联机大厅（T-076 / PRD REQ-14.4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本项目唯一没有原版对照的一屏**：原版是单机游戏，没有大厅。
 *   故风格向 `setup.ts` 靠——座位摆位、按钮尺寸直接复用它的常量，
 *   免得凭空造一套版式，也免得两屏看起来像两个游戏。
 *
 * 职责边界（与 core 的分工在这屏特别要紧）：
 *   · 座位是谁、叫什么、选了什么角色、在不在线 —— **全部来自服务器的
 *     `RoomInfo`**。大厅一个字节都不自己决定，否则「我以为我选的是忍者、
 *     服务器记的是錢夫人」这种分歧要到开局才炸。
 *   · 因此座位区是**只读**的；本屏唯一能改变局面的事是房主按下開始。
 *
 * 尚未接上的部分见 Q-NET-2：开局前改角色／换地图需要协议消息
 * （座位是服务器分配的，客户端单方面改不了），本屏先把「看得见、開得起來」
 * 做出来。
 */

import type { RoomInfo, SeatInfo } from '@rich4/core';
import { portraitResource, type ArchiveName, type Sprite } from './assets.ts';

/** 最多几个座位 —— 与开局设置一致（原版四人） */
export const MAX_SEATS = 4;

/**
 * 座位卡片：**联机大厅自己的摆位**。
 *
 * ⚠️ 先前直接借用開局設定屏的 `SEATS`／`BTN_*`。那一屏照汇编重做之后
 *   （座位不再是四个方框，而是画面底部四个走动的侧视小人），
 *   那套常量就不存在了 —— 联机大厅是本项目自己加的屏，本来就该自排各的。
 */
export const LOBBY_SEATS = { x: 40, y: 292, pitch: 148, w: 132, h: 106 } as const;
export const BTN_START = { x: 506, y: 416, w: 110, h: 34 } as const;
export const BTN_BACK = { x: 398, y: 416, w: 96, h: 34 } as const;

/** 一个座位格子的视图数据 */
export interface LobbySlot {
  seat: number;
  /** 这个位子有人占了没有（空座由电脑补位，服务器会先补上） */
  occupied: boolean;
  name: string;
  kind: 'human' | 'computer';
  /** 真人座位此刻在不在线；空座为 false */
  connected: boolean;
  character: number;
  /** 是不是本机占了这一格 */
  isMe: boolean;
}

/**
 * 把服务器给的 `RoomInfo` 摊成固定 `MAX_SEATS` 格，缺的格子留空。
 *
 * 摊成定长是为了让画面**不会随人数变来变去**：空座也画出来（画成「等待加入」），
 * 玩家一眼看得出还有几个位子、而不是猜「怎么只有两格」。
 */
export function lobbySlots(
  room: RoomInfo | null,
  me: number | null,
  seatCount = MAX_SEATS,
): LobbySlot[] {
  const bySeat = new Map<number, SeatInfo>();
  for (const s of room?.seats ?? []) bySeat.set(s.seat, s);

  const out: LobbySlot[] = [];
  for (let i = 0; i < seatCount; i++) {
    const s = bySeat.get(i);
    out.push({
      seat: i,
      occupied: s !== undefined,
      name: s?.name ?? '',
      kind: s?.kind ?? 'computer',
      // ⚠️ 缺省当**离线**而不是在线：服务器没说的话，宁可显示成断开
      //    也不要谎报「人在」，否则掉线会被瞒到开局
      connected: s !== undefined && s.kind === 'human' && s.connected !== false,
      character: s?.character ?? i,
      isMe: me !== null && i === me,
    });
  }
  return out;
}

// ── 摆位 ──────────────────────────────────────────────

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export type LobbyHit =
  /** 房主按「開始」*/
  | { kind: 'start' }
  /** 离开大厅（回標題）*/
  | { kind: 'leave' }
  /** 落在某个座位上 —— 座位只读，返回它只为让 UI 能高亮 */
  | { kind: 'seat'; index: number };

export interface LobbyHitOptions {
  /** 本机是不是房主（0 号座）—— 只有房主点得动開始 */
  isHost: boolean;
  seats?: number;
}

/**
 * 命中测试。
 *
 * ★ 非房主点「開始」**返回 null**，不是返回一个「无效的 start」：
 *   控件在只读时就不该是可点的东西，这样调用方不可能写错成「先接住再判断」，
 *   也免得 hover 高亮去骗玩家「这个能点」。
 */
export function hitLobby(x: number, y: number, opts: LobbyHitOptions): LobbyHit | null {
  const seats = opts.seats ?? MAX_SEATS;
  for (let i = 0; i < seats; i++) {
    const box = { x: LOBBY_SEATS.x + i * LOBBY_SEATS.pitch, y: LOBBY_SEATS.y, w: LOBBY_SEATS.w, h: LOBBY_SEATS.h };
    if (inRect(x, y, box)) return { kind: 'seat', index: i };
  }
  if (opts.isHost && inRect(x, y, BTN_START)) return { kind: 'start' };
  if (inRect(x, y, BTN_BACK)) return { kind: 'leave' };
  return null;
}

// ── 绘制 ──────────────────────────────────────────────

/** 取精灵的回调，与其它屏一致 */
export type SpriteFn = (archive: ArchiveName, resource: number, index: number) => Sprite | null;

const FONT = '"PingFang TC","Microsoft JhengHei",sans-serif';

/**
 * 画一帧大厅。
 *
 * @param hot 当前高亮的命中项（由 hover 维护），用于按下态高亮
 */
export function drawLobby(
  ctx: CanvasRenderingContext2D,
  slots: readonly LobbySlot[],
  me: number | null,
  isHost: boolean,
  started: boolean,
  hot: LobbyHit | null,
  sprite: SpriteFn,
  measure: (text: string) => number,
): void {
  ctx.save();

  // 底色
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(0, 0, 640, 480);

  ctx.fillStyle = '#f0e6d2';
  ctx.font = `20px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText('聯機大廳', 40, 40);

  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#a8b6c8';
  const hint = isHost
    ? '你是房主（1 號座）：人齊了按「開始」；空位由電腦補上'
    : '等房主開始；空位由電腦補上';
  ctx.fillText(hint, 40, 66);

  // 座位
  for (const slot of slots) {
    const x = LOBBY_SEATS.x + slot.seat * LOBBY_SEATS.pitch;
    const y = LOBBY_SEATS.y;
    const hovered = hot?.kind === 'seat' && hot.index === slot.seat;

    ctx.fillStyle = slot.isMe ? '#2e4258' : hovered ? '#28394b' : '#222d3a';
    ctx.fillRect(x, y, LOBBY_SEATS.w, LOBBY_SEATS.h);
    ctx.strokeStyle = slot.isMe ? '#7fd0ff' : '#3c4c60';
    ctx.lineWidth = slot.isMe ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, LOBBY_SEATS.w - 1, LOBBY_SEATS.h - 1);

    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#8fa2b8';
    ctx.fillText(`${slot.seat + 1} 號座${slot.isMe ? '（你）' : ''}`, x + 10, y + 8);

    if (!slot.occupied) {
      ctx.fillStyle = '#6b7c90';
      ctx.font = `14px ${FONT}`;
      ctx.fillText('等待加入…', x + 10, y + 40);
      continue;
    }

    // 头像（map.mkf 的 27..38，与开局设置同一套）；抓不到就只画文字，不挡信息
    const portrait = sprite('map.mkf', portraitResource(slot.character), 0);
    if (portrait !== null) {
      ctx.drawImage(portrait.bitmap, x + LOBBY_SEATS.w - 56, y + 22, 48, 48);
    }

    ctx.fillStyle = '#f0e6d2';
    ctx.font = `15px ${FONT}`;
    ctx.fillText(clip(slot.name, LOBBY_SEATS.w - 24 - (portrait === null ? 0 : 52), measure), x + 10, y + 34);

    ctx.font = `12px ${FONT}`;
    if (slot.kind === 'computer') {
      ctx.fillStyle = '#c8b273';
      ctx.fillText('電腦', x + 10, y + 60);
    } else {
      ctx.fillStyle = slot.connected ? '#7fd08a' : '#e0736b';
      ctx.fillText(slot.connected ? '在線' : '離線（電腦代打）', x + 10, y + 60);
    }

    ctx.fillStyle = '#8fa2b8';
    ctx.fillText(`角色 ${slot.character + 1}`, x + 10, y + 80);
  }

  // 開始（只有房主可点）
  const startHot = isHost && hot?.kind === 'start';
  drawButton(ctx, BTN_START, started ? '已開始' : '開始', FONT, !isHost || started, startHot);

  // 离开
  drawButton(ctx, BTN_BACK, '離開', FONT, false, hot?.kind === 'leave');

  ctx.restore();
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  label: string,
  font: string,
  disabled: boolean,
  hot: boolean,
): void {
  ctx.fillStyle = disabled ? '#2a3441' : hot ? '#4a6b8a' : '#33465c';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = disabled ? '#3a4655' : '#7fd0ff';
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

  ctx.font = `15px ${font}`;
  ctx.fillStyle = disabled ? '#5b6a7c' : '#f0e6d2';
  ctx.textBaseline = 'top';
  const tw = ctx.measureText(label).width;
  ctx.fillText(label, r.x + (r.w - tw) / 2, r.y + (r.h - 15) / 2);
}

/** 名字太长就截断加省略号，免得压到隔壁座位 / 压到头像上 */
function clip(name: string, maxWidth: number, measure: (t: string) => number): string {
  if (measure(name) <= maxWidth) return name;
  let out = name;
  while (out.length > 1 && measure(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** 本机是不是房主（0 号座） */
export function isHostSeat(me: number | null): boolean {
  return me === 0;
}
