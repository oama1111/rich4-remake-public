/*
 * 联机大厅（T-076 / PRD REQ-14.4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ **本项目唯一没有原版对照的一屏**：原版是单机游戏，没有大厅。
 *   故风格向 `setup.ts` 靠——座位摆位、按钮尺寸复用它的形状，
 *   免得凭空造一套版式，也免得两屏看起来像两个游戏。
 *
 * ★★ 版式（2026-09-23，第十一份試玩回報 #1 重排过一次）：
 * ```text
 *  ┌ 聯機大廳 ───────────────────────────────────────────────┐
 * │ 角色 6×2（左，各 38px）      │ 開局設定 6 行（右，房主可改）│
 * │ 地圖 4×2（左，各 36px）      │  ◀ 值 ▶   ×6               │
 * ├──────────────────────────────────────────────────────────┤
 * │ 1 號座 │ 2 號座 │ 3 號座 │ 4 號座   （格數 = 房間總人數） │
 * │                       [離開] [開始]                       │
 * └──────────────────────────────────────────────────────────┘
 * ```
 * 「考慮清楚需要展示哪些資訊」= 這四塊：**我是誰**（角色，每人一個）、
 * **在哪打**（地圖，房間級）、**怎麼打**（開局設定六項，房間級）、
 * **跟誰打**（座位卡：名字 / 真人或電腦 / 在線離線 / 幾號座）。
 * 房間級的三塊只有房主點得動、開局後全部鎖死 —— 判據在 `hitLobby` 裡就返回 `null`，
 * 不讓 UI 騙玩家「這個能點」（真正的閘仍在伺服器）。
 *
 * ★ Q-NET-2「改角色 / 换地图」的取证结论（2026-09-15 复核）：
 *   **原版**（`rich4.exe`，60 万字节，2001-12）**没有** IPX／數據機那几屏 ——
 *   全文反汇编 `rich4-re/asm/*.asm`（132 个文件）里 `ipx`/`modem`/`winsock`/
 *   `directplay`/`連線`/`網路` 命中 **0**，exe 的字符串表里也搜不到；
 *   標題窗口过程（VA 0x00402762）的命中循环**只认 5 颗钮**
 *   （`TITLE_ANCHORS`：START / LOAD / OPTION / EXIT / NEW STAGE）。
 *   所以大厅这一屏、角色格、地图格、以及「開局設定」六行，**都是本项目新增的界面**，
 *   不是复刻。只有**素材**照旧沿用原版已经解出来的那两套：
 *   · 角色头像 = `map.mkf` 资源 27..38（`portraitResource`，与开局设置同源）；
 *   · 地圖縮圖  = `Data.mkf` 资源 520 的图 2..9（存讀檔屏那一套，
 *     @source VA 0x00404016 `图号 = 2 + globalMapId`）。
 *
 * 职责边界（与 core 的分工在这屏特别要紧）：
 *   · 座位是谁、叫什么、选了什么角色、在不在线 —— **全部来自服务器的
 *     `RoomInfo`**。大厅一个字节都不自己决定，否则「我以为我选的是忍者、
 *     服务器记的是錢夫人」这种分歧要到开局才炸。
 *   · 「改角色」只改**自己**那一格、「换地图」与「開局設定」六行只有房主能点：
 *     命中测试直接把不该点的控件判成 `null`；但真正的闸在服务器（Q-NET-2 /
 *     `#setOptions`），这里只是别让 UI 骗玩家「这个能点」。
 */

import {
  LOBBY_CHARACTER_COUNT,
  LOBBY_MAP_COUNT,
  LOBBY_MIN_SEATS,
  withLobbyDefaults,
  type LobbyOptions,
  type RoomInfo,
  type SeatInfo,
} from '@rich4/core';
import {
  CONFIG_TITLES,
  MONEY_VALUES,
  PLAYER_COUNT_LABELS,
  TENURE_LABELS,
  VEHICLE_LABELS,
  VICTORY_FACTORS,
} from './setup.ts';
import { portraitResource, type ArchiveName, type Sprite } from './assets.ts';
import { FONT_FAMILY } from './font.ts';
// ★ 地圖縮圖沿用存讀檔屏那一套（同一资源、同一图号算法），不另起一套。
import { MAP_THUMB_BASE, SAVELOAD_RESOURCE } from './saveload.ts';
import { drawSprite } from './hd-stage.ts';

/** 最多几个座位 —— 与开局设置一致（原版四人） */
export const MAX_SEATS = 4;

/**
 * 座位卡片：**联机大厅自己的摆位**。
 *
 * ⚠️ 先前直接借用開局設定屏的 `SEATS`／`BTN_*`。那一屏照汇编重做之后
 *   （座位不再是四个方框，而是画面底部四个走动的侧视小人），
 *   那套常量就不存在了 —— 联机大厅是本项目自己加的屏，本来就该自排各的。
 */
export const LOBBY_SEATS = { x: 36, y: 312, pitch: 152, w: 140, h: 76 } as const;
export const BTN_START = { x: 506, y: 398, w: 110, h: 34 } as const;
export const BTN_BACK = { x: 398, y: 398, w: 96, h: 34 } as const;

/**
 * ★★ 第十一份試玩回報 #1（需求方 2026-09-23）：大厅的**「開局設定」六行**。
 *
 * 需求方：「房间人数是指总人数，比如设置总人数4，然后只有2个真人玩家，
 * 点击开局后就自动补2个NPC玩家凑齐4个人数开局；大厅你重构一下即可，
 * 考虑清楚需要展示哪些信息」。
 *
 * ⇒ 这一栏放的就是**单机开局设定屏那六项**（`setup.ts` 的 `CONFIG_TITLES` 同一批串，
 *   值表也是同一批 `menuItems`），语义一一对应 —— 玩家在单机能设的，联机也能设。
 *   角色/地图不在这一栏（它们另有自己的挑选格，而且角色是**每人一个**、不是房间级设置）。
 *
 * `steps` = 该项有几个档（服务器用 core 的 `lobbyOptionsError` 同一份判据）。
 */
export const LOBBY_OPTION_ROWS: readonly {
  field: 'seatCount' | 'fundIndex' | 'vehicle' | 'landTenure' | 'timeIndex' | 'victoryIndex';
  title: string;
  steps: number;
}[] = [
  { field: 'seatCount', title: CONFIG_TITLES[0]!, steps: 3 },
  { field: 'fundIndex', title: CONFIG_TITLES[1]!, steps: 6 },
  { field: 'vehicle', title: CONFIG_TITLES[2]!, steps: 3 },
  { field: 'landTenure', title: CONFIG_TITLES[3]!, steps: 6 },
  { field: 'timeIndex', title: CONFIG_TITLES[4]!, steps: 6 },
  { field: 'victoryIndex', title: CONFIG_TITLES[5]!, steps: 6 },
];

/** 「開局設定」那一栏的摆位（右半屏）*/
export const OPTION_COL = { x: 328, y: 100, w: 276, rowH: 30, labelW: 108, arrowW: 22, valueW: 96 } as const;

/** 该项当前的**档位下标**（`seatCount` 减 2 —— 原版「二人/三人/四人」也是这么编的）*/
export function optionIndexOf(o: LobbyOptions, field: (typeof LOBBY_OPTION_ROWS)[number]['field']): number {
  return field === 'seatCount' ? o.seatCount - LOBBY_MIN_SEATS : o[field];
}

/** 档位下标 → 该项的取值 */
export function optionValueOf(field: (typeof LOBBY_OPTION_ROWS)[number]['field'], index: number): number {
  return field === 'seatCount' ? index + LOBBY_MIN_SEATS : index;
}

/**
 * 这一项的显示文案 —— 与单机开局设定屏**同一批表**（`setup.ts` 的 `menuItems`）。
 * ⚠️ 勝利條件的文案依赖**總資金的档位**（原版是「資金 × 倍率」），所以要把整份选项传进来。
 */
export function optionLabelOf(o: LobbyOptions, field: (typeof LOBBY_OPTION_ROWS)[number]['field']): string {
  const idx = optionIndexOf(o, field);
  switch (field) {
    case 'seatCount':
      return PLAYER_COUNT_LABELS[idx] ?? '四人';
    case 'fundIndex':
      return String(MONEY_VALUES[idx] ?? MONEY_VALUES[0]);
    case 'vehicle':
      return VEHICLE_LABELS[idx] ?? '步行';
    case 'landTenure':
    case 'timeIndex':
      // 原版「土地權限」与「遊戲時間」共用同一批串（`0x46cbb8` / `0x46cbd0`）
      return TENURE_LABELS[idx] ?? '無限期';
    default: {
      const f = VICTORY_FACTORS[idx] ?? 0;
      return f === 0 ? '無限' : String((MONEY_VALUES[o.fundIndex] ?? MONEY_VALUES[0]!) * f);
    }
  }
}

/**
 * ★ Q-NET-2 角色挑選格 —— **本项目新增的版式**（原版无此屏，见文件头取证）。
 *
 * 12 个头像排成 6×2（与 `setup.ts` 的角色格同样是 6 列），
 * 格子缩到 40×40 是为了塞进大厅上半屏：原版那套 72×72 的 6×2 要 440×155，
 * 会在 640×480 里把座位板挤下去（座位板才是这屏的主信息）。
 * 头像是**同一批素材**（`portraitResource`），只是画小一点。
 */
export const CHAR_PICK = { x: 36, y: 100, cols: 6, cell: 38, pitch: 42 } as const;

/**
 * ★ Q-NET-2 地圖挑選格 —— 同样是**本项目新增的版式**。
 *
 * 8 张缩略图排成 4×2，格子 52×52（原版存讀檔屏是 72×72，这里同样为省地方缩小）。
 * 图号算法照抄存讀檔屏：`Data.mkf` 资源 520 的 `2 + (globalMapId & 7)`。
 */
export const MAP_PICK = { x: 36, y: 206, cols: 4, cell: 36, pitch: 40 } as const;

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
  | { kind: 'seat'; index: number }
  /**
   * 点了某个角色格（Q-NET-2）。**只是请求**：调用方把它交给
   * `NetClient.setCharacter`，改不改得成由服务器校验后广播说了算。
   */
  | { kind: 'character'; character: number }
  /**
   * 点了某张地图缩略图（Q-NET-2）。同样只是请求，且只对房主可见 ——
   * 非房主这一整块命中测试都返回 `null`。
   */
  | { kind: 'map'; globalMapId: number }
  /**
   * ★★ 第十一份試玩回報 #1：点了「開局設定」里某一项的 ◀ / ▶。
   *   `field` = 改哪一项、`delta` = ±1 档。调用方把它折成新取值交给 `NetClient.setOptions`。
   */
  | {
      kind: 'option';
      field: (typeof LOBBY_OPTION_ROWS)[number]['field'];
      delta: -1 | 1;
    };

export interface LobbyHitOptions {
  /** 本机是不是房主（0 号座）—— 只有房主点得动開始、也才点得动地圖 */
  isHost: boolean;
  seats?: number;
  /** 本机座位号；`null`（还没进房）时角色格不可点 */
  me?: number | null;
  /** 房间是否已开局 —— 开局后角色/地图都锁死，两块选择器只读 */
  started?: boolean;
}

/** 角色格命中：返回 0..11；不在格子里返回 −1（本项目新增的版式，无原版对照） */
export function characterPickAt(x: number, y: number): number {
  for (let i = 0; i < LOBBY_CHARACTER_COUNT; i++) {
    if (inRect(x, y, pickRect(CHAR_PICK, i))) return i;
  }
  return -1;
}

/** 地图格命中：返回 0..7；不在格子里返回 −1（本项目新增的版式，无原版对照） */
export function mapPickAt(x: number, y: number): number {
  for (let i = 0; i < LOBBY_MAP_COUNT; i++) {
    if (inRect(x, y, pickRect(MAP_PICK, i))) return i;
  }
  return -1;
}

/** 第 i 格在网格里的矩形 */
function pickRect(
  grid: { x: number; y: number; cols: number; cell: number; pitch: number },
  i: number,
): { x: number; y: number; w: number; h: number } {
  const col = i % grid.cols;
  const row = Math.floor(i / grid.cols);
  return { x: grid.x + col * grid.pitch, y: grid.y + row * grid.pitch, w: grid.cell, h: grid.cell };
}

/** 「開局設定」第 i 行的三段矩形（标签 / ◀ / ▶）*/
function optionRowRect(i: number): {
  y: number;
  arrowLeft: { x: number; y: number };
  arrowRight: { x: number; y: number };
} {
  const y = OPTION_COL.y + i * OPTION_COL.rowH;
  const leftX = OPTION_COL.x + OPTION_COL.labelW;
  return {
    y,
    arrowLeft: { x: leftX, y },
    arrowRight: { x: leftX + OPTION_COL.arrowW + OPTION_COL.valueW, y },
  };
}

/**
 * 命中测试。
 *
 * ★ 只读的控件**返回 null**，不是返回一个「无效的点击」：
 *   非房主点「開始」、未开局之外的角色格、非房主的地图格，全都在这里挡掉，
 *   调用方不可能写错成「先接住再判断」，hover 高亮也不会去骗玩家「这个能点」。
 *   ⚠️ 这只是**别骗玩家**；真正的权限闸在服务器（Q-NET-2 的
 *   `setCharacter`/`setMap` 校验），客户端全被绕过也改不动房间。
 */
export function hitLobby(x: number, y: number, opts: LobbyHitOptions): LobbyHit | null {
  const seats = opts.seats ?? MAX_SEATS;
  const started = opts.started ?? false;
  const me = opts.me ?? null;

  // 角色格：改的是「自己的」角色，所以先得有自己的座位；开局后锁死
  if (me !== null && !started) {
    const c = characterPickAt(x, y);
    if (c >= 0) return { kind: 'character', character: c };
  }
  // 地图格：房间级设置，只有房主能改；开局后锁死
  if (opts.isHost && !started) {
    const m = mapPickAt(x, y);
    if (m >= 0) return { kind: 'map', globalMapId: m };
  }
  // ★★ 第十一份試玩回報 #1：「開局設定」六行的 ◀ / ▶ —— 同样是**房间级**、只有房主能改、开局后锁死
  if (opts.isHost && !started) {
    for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
      const row = optionRowRect(i);
      if (inRect(x, y, { ...row.arrowLeft, w: OPTION_COL.arrowW, h: OPTION_COL.rowH })) {
        return { kind: 'option', field: LOBBY_OPTION_ROWS[i]!.field, delta: -1 };
      }
      if (inRect(x, y, { ...row.arrowRight, w: OPTION_COL.arrowW, h: OPTION_COL.rowH })) {
        return { kind: 'option', field: LOBBY_OPTION_ROWS[i]!.field, delta: 1 };
      }
    }
  }
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

const FONT = FONT_FAMILY;

/**
 * 画一帧大厅。
 *
 * @param hot 当前高亮的命中项（由 hover 维护），用于按下态高亮
 * @param mapId 房间当前地图（`RoomInfo.globalMapId`）；缺省 0 = 舊快照
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
  mapId = 0,
  /** ★ 第十一份試玩回報 #1：房間的開局選項（顯示當前值；缺省用缺省值）*/
  options: LobbyOptions = withLobbyDefaults(undefined),
): void {
  ctx.save();

  // 底色
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(0, 0, 640, 480);

  ctx.fillStyle = '#f0e6d2';
  ctx.font = `20px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText('聯機大廳', 36, 26);

  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#a8b6c8';
  // ★ 第十三份回報 #1 起：人數是**總人數**（不足補電腦），提示里把它说清楚
  const hint = isHost
    ? `你是房主（1 號座）：設定好按「開始」；不足 ${options.seatCount} 人的位子由電腦補上`
    : `等房主開始；空位由電腦補上（本局共 ${options.seatCount} 人）`;
  ctx.fillText(hint, 36, 50);

  // ★ Q-NET-2：两块大厅设置（本项目新增的界面，见文件头取证）
  drawCharacterPicker(ctx, slots, me, started, hot, sprite);
  drawMapPicker(ctx, mapId, isHost, started, hot, sprite);

  // ★★ 第十一份試玩回報 #1：「開局設定」六行（单机开局设定屏那六项，同一批串与表）
  drawOptionColumn(ctx, options, isHost, started, hot);

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
    ctx.fillText(`${slot.seat + 1} 號座${slot.isMe ? '（你）' : ''}`, x + 10, y + 6);

    if (!slot.occupied) {
      ctx.fillStyle = '#6b7c90';
      ctx.font = `14px ${FONT}`;
      ctx.fillText('等待加入…', x + 10, y + 32);
      continue;
    }

    // 头像（map.mkf 的 27..38，与开局设置同一套）；抓不到就只画文字，不挡信息
    const portrait = sprite('map.mkf', portraitResource(slot.character), 0);
    if (portrait !== null) {
      drawSprite(ctx, portrait, x + LOBBY_SEATS.w - 48, y + 20, 40, 40);
    }

    ctx.fillStyle = '#f0e6d2';
    ctx.font = `15px ${FONT}`;
    ctx.fillText(clip(slot.name, LOBBY_SEATS.w - 24 - (portrait === null ? 0 : 44), measure), x + 10, y + 26);

    ctx.font = `12px ${FONT}`;
    if (slot.kind === 'computer') {
      ctx.fillStyle = '#c8b273';
      ctx.fillText('電腦', x + 10, y + 50);
    } else {
      ctx.fillStyle = slot.connected ? '#7fd08a' : '#e0736b';
      ctx.fillText(slot.connected ? '在線' : '離線（電腦代打）', x + 10, y + 50);
    }
  }

  // 開始（只有房主可点）
  const startHot = isHost && hot?.kind === 'start';
  drawButton(ctx, BTN_START, started ? '已開始' : '開始', FONT, !isHost || started, startHot);

  // 离开
  drawButton(ctx, BTN_BACK, '離開', FONT, false, hot?.kind === 'leave');

  ctx.restore();
}

/**
 * ★★ 「開局設定」六行（第十一份試玩回報 #1）。
 *
 * 版式（本项目新增，原版无联机大厅）：右半屏一栏，每行
 * `標題(左对齐) | ◀ | 值(居中) | ▶`，行高 `OPTION_COL.rowH`。
 * 六项的标题与值表**与单机开局设定屏完全共用**（`setup.ts` 的 `CONFIG_TITLES` 与那几张表），
 * 所以玩家在单机能设的，联机也一模一样。
 *
 * 只读时（非房主 / 已开局）**不画箭头**，值用灰字 —— 与 `hitLobby` 的判据一致：
 * 不骗玩家「这个能点」。
 */
function drawOptionColumn(
  ctx: CanvasRenderingContext2D,
  options: LobbyOptions,
  isHost: boolean,
  started: boolean,
  hot: LobbyHit | null,
): void {
  const editable = isHost && !started;
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = '#a8b6c8';
  ctx.fillText('開局設定', OPTION_COL.x, OPTION_COL.y - 22);
  if (editable) {
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = '#6b7c90';
    ctx.fillText('（只有房主能改，開局後鎖定）', OPTION_COL.x + 66, OPTION_COL.y - 20);
  }

  for (let i = 0; i < LOBBY_OPTION_ROWS.length; i++) {
    const row = LOBBY_OPTION_ROWS[i]!;
    const r = optionRowRect(i);
    const value = optionLabelOf(options, row.field);
    const idx = optionIndexOf(options, row.field);
    const atMin = idx <= 0;
    const atMax = idx >= row.steps - 1;

    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = '#c9d4e2';
    ctx.fillText(row.title, OPTION_COL.x, r.y + 7);

    // ◀ / ▶ —— 只读时不画；到端点的那一侧压暗
    if (editable) {
      const hotLeft = hot?.kind === 'option' && hot.field === row.field && hot.delta === -1;
      const hotRight = hot?.kind === 'option' && hot.field === row.field && hot.delta === 1;
      drawArrow(ctx, r.arrowLeft.x, r.y, -1, atMin ? '#3c4c60' : hotLeft ? '#7fd0ff' : '#a8b6c8');
      drawArrow(
        ctx,
        r.arrowRight.x,
        r.y,
        1,
        atMax ? '#3c4c60' : hotRight ? '#7fd0ff' : '#a8b6c8',
      );
    }

    // 值 —— 居中在 ◀ 与 ▶ 之间
    const cx = r.arrowLeft.x + OPTION_COL.arrowW + OPTION_COL.valueW / 2;
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = editable ? '#f0e6d2' : '#8fa2b8';
    ctx.textAlign = 'center';
    ctx.fillText(value, cx, r.y + 6);
    ctx.textAlign = 'left';
  }
}

/** 一个「◀ / ▶」小箭头（`dir` = −1 左、+1 右），画在以 (x,y) 为左上角的格子里 */
/**
 * 一个「◀ / ▶」小箭头（`dir` = −1 画 ◀、+1 画 ▶），画在以 (x,y) 为左上角的格子里。
 *
 * ⚠️ **尖端要朝着 `dir`**：`moveTo` 的两个尾点在 `cx - dir*5`、`lineTo` 的尖点在
 *   `cx + dir*4`。第一版把这两个写反了，于是「◀」画出来是「>」——
 *   箭头一反过来，玩家按的就不是他看到的那个方向。
 *   （实测抓到的，不是想出来的：`/tmp/lobby-1.png` 那一版六行全是反的。）
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: -1 | 1,
  color: string,
): void {
  const cx = x + 11;
  const cy = y + OPTION_COL.rowH / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - dir * 5, cy - 6);
  ctx.lineTo(cx + dir * 4, cy);
  ctx.lineTo(cx - dir * 5, cy + 6);
  ctx.stroke();
}

/**
 * 角色挑選格（Q-NET-2，本项目新增的界面，无原版对照）。
 *
 * · 我当前那个角色 = 高亮框；别人占着的 = 压暗 + 灰字（跟 `setup.ts`
 *   的 `TAKEN_MULTIPLY` 一个意思，只是没有那张调色表就用 alpha 代替）；
 * · 未开局 + 有自己的座位时整块才活；否则退回只读的展示。
 *
 * ⚠️ 压暗只是**提示**：撞车与否最终由服务器判（`characterTaken`），
 *   这里点下去照样发请求，被拒会走 `onError` 打一行日志。
 */
function drawCharacterPicker(
  ctx: CanvasRenderingContext2D,
  slots: readonly LobbySlot[],
  me: number | null,
  started: boolean,
  hot: LobbyHit | null,
  sprite: SpriteFn,
): void {
  const mine = me === null ? null : (slots.find((s) => s.seat === me)?.character ?? null);
  const taken = new Set(slots.filter((s) => s.occupied && !s.isMe).map((s) => s.character));
  const live = me !== null && !started;

  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = live ? '#a8b6c8' : '#6b7c90';
  ctx.fillText(`角色${live ? '（點一下換成自己的）' : started ? '（已開局）' : ''}`, CHAR_PICK.x, CHAR_PICK.y - 20);

  for (let i = 0; i < LOBBY_CHARACTER_COUNT; i++) {
    const r = pickRect(CHAR_PICK, i);
    const isMine = mine === i;
    const isTaken = taken.has(i);
    const hovered = live && hot?.kind === 'character' && hot.character === i;
    ctx.fillStyle = isMine ? '#2e4258' : hovered ? '#3a5a7a' : '#222d3a';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = isMine ? '#7fd0ff' : isTaken ? '#4a3a3a' : '#3c4c60';
    ctx.lineWidth = isMine ? 2 : 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    // 头像：与开局设置同一批素材，只是画小一号
    const portrait = sprite('map.mkf', portraitResource(i), 0);
    if (portrait === null) {
      ctx.fillStyle = '#6b7c90';
      ctx.font = `12px ${FONT}`;
      ctx.fillText(String(i + 1), r.x + 12, r.y + 12);
      continue;
    }
    if (isTaken) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      drawSprite(ctx, portrait, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else {
      drawSprite(ctx, portrait, r.x, r.y, r.w, r.h);
    }
  }
}

/**
 * 地圖挑選格（Q-NET-2，本项目新增的界面，无原版对照）。
 *
 * ⚠️ 缩略图**不另起一套**：图号 = `Data.mkf` 资源 520 的 `2 + (id & 7)`，
 *   与存讀檔屏同一行代码（那边 @source VA 0x00404016）。
 *   拿不到图就画编号，绝不空着 —— 否则玩家不知道这格是干什么的。
 */
function drawMapPicker(
  ctx: CanvasRenderingContext2D,
  mapId: number,
  isHost: boolean,
  started: boolean,
  hot: LobbyHit | null,
  sprite: SpriteFn,
): void {
  const live = isHost && !started;
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = live ? '#a8b6c8' : '#6b7c90';
  ctx.fillText(`地圖${live ? '（房主選）' : started ? '（已開局）' : '（房主才能改）'}`, MAP_PICK.x, MAP_PICK.y - 20);

  for (let i = 0; i < LOBBY_MAP_COUNT; i++) {
    const r = pickRect(MAP_PICK, i);
    const isMine = (mapId & 7) === i;
    const hovered = live && hot?.kind === 'map' && hot.globalMapId === i;
    ctx.fillStyle = isMine ? '#2e4258' : hovered ? '#3a5a7a' : '#222d3a';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = isMine ? '#7fd0ff' : '#3c4c60';
    ctx.lineWidth = isMine ? 2 : 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    const thumb = sprite('Data.mkf', SAVELOAD_RESOURCE, MAP_THUMB_BASE + (i & 7));
    if (thumb !== null) {
      drawSprite(ctx, thumb, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = '#6b7c90';
      ctx.font = `12px ${FONT}`;
      ctx.fillText(`圖 ${i + 1}`, r.x + 10, r.y + 18);
    }
  }
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
