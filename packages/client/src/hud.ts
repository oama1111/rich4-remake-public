/*
 * 侧栏与小地图 —— 照原版布局画
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**只读**状态，不含任何规则。
 *
 * 原版的右侧栏是一张 200×280 的整图（`Panel.mkf` 资源 0），
 * 六张一组：
 *   图 0..3 = 資金 / 地產 / 股票 / 其他 四个标签页，
 *             每页三条横栏，左端各带一个图标（錢袋 / 存錢罐 / 金幣堆 …），
 *             右边缘是四个彩色竖标签（青 / 蓝 / 红 / 金）
 *   图 4    = 200×80 的窄版
 *   图 5    = 不带竖标签的版本
 * 这与游戏截图里的右栏完全一致，故数值只需按栏位写上去即可，
 * 不必自己画框。
 */

import type { GameState, Rich4Map } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import { portraitResource, type Sprite, type SpriteCache } from './assets.ts';
import type { Camera } from './render.ts';

/** 侧栏整图尺寸 @source Panel.mkf 资源 0 的图 0 */
export const PANEL_WIDTH = 200;
export const PANEL_HEIGHT = 280;

/**
 * 右下角那块 200×200。
 *
 * ★ 它**不是**我们自己加的调试小地图位，原版就有，而且是**可切换**的：
 * ```
 * RICH4.CFG  offset 5:  00 日曆   01 小地圖   02 兩者輪流
 * ```
 * （@source rich4-re/docs/rich4_cfg.txt —— 这是配置文件的字段说明，
 *   不涉及规则，属可信的一类线索。）
 *
 * 日曆那一面的底图就在 `Panel.mkf` 资源 2：
 * - 图 0..3 四季实景，**不带**日曆框（另有他用）
 * - 图 4..7 同样四季，带太阳/月亮与 `S M T W T F S` 那条星期栏 ← 游戏里用的是这组
 * - 图 8/9  24×23 亮/暗太阳；图 10/11 20×20 亮/暗月亮（盖在底图那两个上面）
 */
export const SIDEBAR = { x: 0, y: PANEL_HEIGHT, w: 200, h: 200 } as const;

/** 资源 2 里日曆底图的起始图号；`+ 季节(0..3)` */
const CALENDAR_BASE_IMAGE = 4;
/** 盖在底图那两个上面的亮太阳/亮月亮；见 `#drawCalendar` 的说明 —— 现未使用 */
export const SUN_BRIGHT_IMAGE = 8;
export const MOON_BRIGHT_IMAGE = 10;

/**
 * 日曆底图上各部件的位置 —— **照解出来的位图量的**，不是 exe 里的常量。
 *
 * 量法：资源 2 的图 4..7 四张只有背景不同，chrome 完全一致，
 * 于是「四张里像素完全相同」的那些点就是 chrome 本身。得到：
 * - 太阳 x 12..31、月亮 x 44..60，都在 y 11..29
 * - 星期栏七个圆点 y 73..86，中心 x ≈ 30.5 + i × 22.67
 */
const CAL = {
  sun: { x: 10, y: 9 },
  moon: { x: 42, y: 10 },
  dow: { x0: 30.5, pitch: 68 / 3, y: 79.5, r: 9 },
  date: { x: 100, y: 150 },
} as const;

/** 月份 → 季节 0 春 / 1 夏 / 2 秋 / 3 冬（图 4 绿原、5 海滩、6 红葉、7 雪地） */
export function seasonOfMonth(month: number): number {
  const m = ((month - 1) % 12 + 12) % 12 + 1;
  if (m >= 3 && m <= 5) return 0;
  if (m >= 6 && m <= 8) return 1;
  if (m >= 9 && m <= 11) return 2;
  return 3;
}

/**
 * 星期几 0=日..6=六 —— 蔡勒公式（比自己数天数稳）。
 *
 * ⚠️ 原版用哪一天当基准没查证；这里按真实公历算，年份就是 `state.year`。
 */
export function dayOfWeek(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h =
    (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  return (h + 6) % 7; // 蔡勒的 0 是星期六
}

/** 右下角显示哪一面 */
export type SidebarView = 'calendar' | 'map';

/**
 * 三条数值栏在 200×280 图内的纵向位置。
 *
 * ⚠️ 这几个 y 是**照着解出来的位图量的**，不是从 exe 里读到的常量。
 * 原版把文字画在哪由绘制代码决定，那段还没定位，故此处按图上横栏的
 * 位置对齐——视觉上对得上，但不保证与原版逐像素相同。
 */
const ROW_Y = [112, 172, 232] as const;
/**
 * 数值右对齐到的 x。
 * 侧栏最右约 27 像素是那四个彩色竖标签，数值不能压上去。
 */
const VALUE_RIGHT = 166;
/** 头像画在顶栏 */
const PORTRAIT = { x: 8, y: 6, size: 64 } as const;

export interface HudInput {
  state: GameState;
  map: Rich4Map;
  camera: Camera;
  /** 视口尺寸，用来在小地图上画取景框 */
  viewport: { w: number; h: number };
  /** 原版底图，用作小地图；为 null 时小地图只画节点 */
  ground: ImageBitmap | null;
  /** 右下角那 200×200 现在显示哪一面 */
  sidebarView: SidebarView;
}

/**
 * 点在右下角那块 200×200 上吗？
 *
 * 原版这块是「日曆／小地圖」轮换位（见 `SIDEBAR`），点一下换一面。
 * ⚠️ 原版是不是用点击来换、还是只认设定与热键，尚未查证。
 */
export function hitSidebar(x: number, y: number): boolean {
  return x >= SIDEBAR.x && x < SIDEBAR.x + SIDEBAR.w
    && y >= SIDEBAR.y && y < SIDEBAR.y + SIDEBAR.h;
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

export class Hud {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  readonly #ready = new Map<string, Sprite | null>();
  readonly #pending = new Set<string>();
  #dirty = false;
  /** 解码落地时叫一声 —— 理由同 `BoardRenderer.#onReady` */
  #onReady: (() => void) | null = null;

  constructor(ctx: CanvasRenderingContext2D, sprites: SpriteCache) {
    this.#ctx = ctx;
    this.#sprites = sprites;
  }

  /** 由宿主注入「再画一帧」 */
  set onSpriteReady(fn: () => void) {
    this.#onReady = fn;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  clearDirty(): void {
    this.#dirty = false;
  }

  /** 同步取精灵；未就绪时后台解码并返回 null */
  #sprite(archive: 'Panel.mkf' | 'map.mkf', res: number, idx: number): Sprite | null {
    const key = `${archive}:${res}:${idx}`;
    const hit = this.#ready.get(key);
    if (hit !== undefined) return hit;
    if (!this.#pending.has(key)) {
      this.#pending.add(key);
      void this.#sprites.get(archive, res, idx).then((s) => {
        this.#ready.set(key, s);
        this.#pending.delete(key);
        this.#dirty = true;
        this.#onReady?.();
      });
    }
    return null;
  }

  draw(input: HudInput): void {
    const ctx = this.#ctx;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    this.#drawPanel(input);
    if (input.sidebarView === 'calendar') this.#drawCalendar(input);
    else this.#drawMinimap(input, SIDEBAR.y);
  }

  /**
   * 日曆面：四季底图 + 当日星期的标记 + 年月日。
   *
   * ⚠️ 底图是原版的；**星期标记与日期文字的画法是我们补的** —— 原版怎么
   *   标示「今天」还没从 exe 里认出来（那条星期栏上的红点是烤进图里的，
   *   四张底图都红在同一个位置，所以它不是动态标记）。记作 Q-UI-1。
   */
  #drawCalendar(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    const bg = this.#sprite('Panel.mkf', 2, CALENDAR_BASE_IMAGE + seasonOfMonth(month));
    if (bg !== null) ctx.drawImage(bg.bitmap, ox, oy, w, h);
    else {
      ctx.fillStyle = '#7f9fbf';
      ctx.fillRect(ox, oy, w, h);
    }

    // ⚠️ 图 8..11 的亮太阳/亮月亮**故意不画**：底图 4..7 上那两个已经是亮的，
    //   再盖一层只会错位。这两组多半是昼夜切换用的，而本引擎还没有夜晚——
    //   等把原版那段绘制代码认出来再说（Q-UI-1）。

    // 今天是星期几
    const dow = dayOfWeek(year, month, day);
    ctx.save();
    ctx.strokeStyle = '#ffe14a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox + CAL.dow.x0 + dow * CAL.dow.pitch, oy + CAL.dow.y, CAL.dow.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 年月日
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 22px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.fillStyle = '#fff';
    const text = `${year} 年 ${month} 月 ${day} 日`;
    ctx.strokeText(text, ox + CAL.date.x, oy + CAL.date.y);
    ctx.fillText(text, ox + CAL.date.x, oy + CAL.date.y);
    ctx.textAlign = 'left';
  }

  #drawPanel(input: HudInput): void {
    const ctx = this.#ctx;
    const me = input.state.players[input.state.currentPlayer];
    if (me === undefined) return;

    // 背景：原版的「資金」页
    const bg = this.#sprite('Panel.mkf', 0, 0);
    if (bg !== null) {
      ctx.drawImage(bg.bitmap, 0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    } else {
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    }

    // 头像
    const face = this.#sprite('map.mkf', portraitResource(me.character), 0);
    if (face !== null) {
      ctx.drawImage(face.bitmap, PORTRAIT.x, PORTRAIT.y, PORTRAIT.size, PORTRAIT.size);
    }

    // 姓名
    ctx.fillStyle = '#2a1d0e';
    ctx.font = 'bold 18px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const name = CHARACTERS[me.character]?.name ?? `角色${me.character}`;
    ctx.fillText(name, PORTRAIT.x + PORTRAIT.size + 8, 42);
    if (me.whoPlays === 0) {
      ctx.fillStyle = '#a02a20';
      ctx.font = '12px "PingFang TC", sans-serif';
      ctx.fillText('（出局）', PORTRAIT.x + PORTRAIT.size + 8, 60);
    }

    // 三条数值：現金 / 存款 / 總資產
    const wealth =
      me.cash +
      me.moneyInBank +
      input.state.landOwner.reduce((sum, owner, id) => {
        if (owner !== me.index + 1) return sum;
        const land = input.map.lands.find((l) => l.id === id);
        if (land === undefined) return sum;
        const level = input.state.landLevel[id] ?? 0;
        return sum + (land.landPrice + land.housePrice * level) * input.state.priceIndex;
      }, 0);

    ctx.font = 'bold 15px "PingFang TC", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1d2b1d';
    const values = [me.cash, me.moneyInBank, wealth];
    for (let i = 0; i < ROW_Y.length; i++) {
      ctx.fillText(money(values[i]!), VALUE_RIGHT, ROW_Y[i]!);
    }

    // 物价指数
    ctx.textAlign = 'left';
    ctx.font = '12px "PingFang TC", sans-serif';
    ctx.fillStyle = '#43351f';
    ctx.fillText(`物價指數 ${input.state.priceIndex}`, 10, 268);
  }

  /**
   * 小地图。
   *
   * 原版把整张底图缩到右下角，并在上面点出各格与取景框——
   * 截图里那一小块就是这个。这里照做：底图缩放 + 节点点 + 取景框 + 棋子。
   */
  #drawMinimap(input: HudInput, top: number): void {
    const ctx = this.#ctx;
    const { state, map, camera, viewport, ground } = input;
    const size = SIDEBAR.w;
    // 底图是正方形（2304 见方），故小地图也取正方形
    const worldW = ground?.width ?? 2304;
    const worldH = ground?.height ?? 2304;
    const k = size / Math.max(worldW, worldH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, size, size);
    ctx.clip();

    ctx.fillStyle = '#0a1730';
    ctx.fillRect(0, top, size, size);
    if (ground !== null) ctx.drawImage(ground, 0, top, worldW * k, worldH * k);

    // 各格
    for (const n of map.nodes) {
      const owner = n.ref.kind === 'land' ? (state.landOwner[n.ref.index] ?? 0) : 0;
      ctx.fillStyle =
        owner === 0 ? 'rgba(240,240,240,0.75)' : (MINIMAP_OWNER[owner - 1] ?? '#fff');
      ctx.fillRect(n.x * k - 1, top + n.y * k - 1, 3, 3);
    }

    // 棋子
    for (const p of state.players) {
      if (p.whoPlays === 0) continue;
      const n = map.nodes[p.nodeId - 1];
      if (n === undefined) continue;
      ctx.fillStyle = MINIMAP_OWNER[p.index] ?? '#fff';
      ctx.beginPath();
      ctx.arc(n.x * k, top + n.y * k, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 取景框
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    if (camera.mode === 'character') {
      // 人物视角：框住 29×29 的那个可见窗口
      const span = 29 * 32 * k;
      ctx.strokeRect(
        (camera.tileX - 14) * 32 * k,
        top + (camera.tileY - 14) * 32 * k,
        span,
        span,
      );
    } else {
      ctx.strokeRect(
        camera.x * k,
        top + camera.y * k,
        (viewport.w / camera.scale) * k,
        (viewport.h / camera.scale) * k,
      );
    }
    ctx.restore();
  }
}

/** 小地图上各玩家的颜色 —— 原版四人四色 */
const MINIMAP_OWNER = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;
