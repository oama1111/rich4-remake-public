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

import {
  daysInMonth,
  isHoliday,
  sceneOfMonth,
  weekdayOf,
  type GameState,
  type Rich4Map,
} from '@rich4/core';
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

/**
 * 日曆那一面的版式 —— **全部**取自 exe。日期与節日的算法在 core 的
 * `places/calendar.ts`（那边有完整的出处），这里只放坐标。
 *
 * 原版把这块 200×200 的绘制分成两个版式（@source VA 0x00416a0a 起）：
 *
 * **日曆**（@source VA 0x00416b4c 起）
 * ```asm
 * 00416b7c  底图 = 资源2[ 月份季节表[月-1] ]        ; 图 0..3，纯实景
 * 00416b98  draw(..., 0x1b8, 0x118)                 ; (440, 280) ← 侧栏原点
 * 00416c29  draw(资源2 图8,  0x1ce, 0x12c)          ; 太阳 (462, 300)
 * 00416c4b  draw(资源2 图11, 0x1ec, 0x12d)          ; 月亮 (492, 301)
 * 00416cbf  draw(星期名[今天], 0x1c6, 0x160, 3)      ; (454, 352)
 * 00416d27  draw("%d"  日,  0x1f4, 0x178, 2)        ; (500, 376)
 * 00416d72  draw("%d"  年,  0x244, 0x120, 0)        ; (580, 288)
 * 00416dc7  draw("%d月" 月,  0x1f4, 0x148, 2)        ; (500, 328)
 * ```
 *
 * **月曆**（@source VA 0x00416a0a 起）
 * ```asm
 * 00416a38  底图 = 资源2[ 季节 + 4 ]                ; 图 4..7，带星期栏
 * 00416aa1  esi = 23 × (该月1号是星期几) + 0x1d6    ; 第一格中心 x = 470 + 23w
 * 00416aa7  edi = 0x17a                             ; 第一行 y = 378
 * 00416ad3  今天：填 (x−10, y−6, 20, 14) 红底
 * 00416b33  esi == 0x260(608) → esi = 0x1bf(447)，edi += 0xe(14)   ; 换行
 * 00416b44  esi += 0x17(23)                          ; 下一格
 * ```
 *
 * ★ 七个格心 x = 470..608（步进 23）减去侧栏原点 440 得 30..168，
 *   与底图上那条 `S M T W T F S` 的七个圆点**逐像素对得上**——
 *   两头独立地印证了同一套坐标。
 */
const CAL = {
  /** 日曆：太阳、月亮（侧栏内坐标） */
  sun: { x: 0x1ce - 440, y: 0x12c - 280 },
  moon: { x: 0x1ec - 440, y: 0x12d - 280 },
  /** 日曆：年 / 月 / 星期 / 日 */
  year: { x: 0x244 - 440, y: 0x120 - 280 },
  monthText: { x: 0x1f4 - 440, y: 0x148 - 280 },
  weekday: { x: 0x1c6 - 440, y: 0x160 - 280 },
  dayText: { x: 0x1f4 - 440, y: 0x178 - 280 },
  /** 月曆：格子 */
  grid: { x0: 0x1d6 - 440, y0: 0x17a - 280, pitch: 0x17, rowH: 0xe, cols: 7 },
  /** 月曆：今天的红底 */
  today: { dx: -10, dy: -6, w: 0x14, h: 0xe },
} as const;

/** 日曆用的两张小图 —— 太阳与（暗）月亮 @source 0x00416c29 / 0x00416c4b */
const SUN_IMAGE = 8;
const MOON_IMAGE = 11;
/** 月曆底图 = 季节 + 4 @source 0x00416a38 `lea ebx, [eax + 4]` */
const MONTH_VIEW_BASE = 4;
/** 假日与今天的颜色 @source 0x00416acc / 0x00416b01 `push 0xff0000` */
const HOLIDAY_COLOR = '#ff0000';
const PLAIN_COLOR = '#101010';

/** 星期名 @source 串表 `0x0047511c[0..6]` */
export const WEEKDAY_NAMES: readonly string[] = [
  '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六',
];

/**
 * 右下角显示哪一面。
 * @source RICH4.CFG offset 5：00 日曆 / 01 小地圖 / 02 兩者輪流。
 *   「日曆」这一面自己又分**日曆**与**月曆**两个版式（见 `CAL`）。
 */
export type SidebarView = 'calendar' | 'month' | 'map';

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
  #sprite(
    archive: 'Panel.mkf' | 'map.mkf',
    res: number,
    idx: number,
    colorKeyBlack = false,
  ): Sprite | null {
    const key = `${archive}:${res}:${idx}:${colorKeyBlack ? 'k' : ''}`;
    const hit = this.#ready.get(key);
    if (hit !== undefined) return hit;
    if (!this.#pending.has(key)) {
      this.#pending.add(key);
      void this.#sprites.get(archive, res, idx, colorKeyBlack).then((s) => {
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
    else if (input.sidebarView === 'month') this.#drawMonth(input);
    else this.#drawMinimap(input, SIDEBAR.y);
  }

  /**
   * 日曆面 —— 大图 + 年月日星期。版式全部照 exe，见 `CAL`。
   *
   * ⚠️ 節日那天原版会**换一张专属插画**（`0x00416bb2` 按節日编号从
   *   `Data.mkf` 另取一张画进那块 200×200），本引擎还没做：資源号的算法
   *   要顺着 `[0x00475208]` 那张表，没跟到。记作 Q-CAL-1。
   */
  #drawCalendar(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year, globalMapId } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    const bg = this.#sprite('Panel.mkf', 2, sceneOfMonth(month));
    if (bg !== null) ctx.drawImage(bg.bitmap, ox, oy, w, h);
    else {
      ctx.fillStyle = '#7f9fbf';
      ctx.fillRect(ox, oy, w, h);
    }

    // 太阳与月亮 —— 图 0..3 没有烤这两个，所以这里必须画
    const sun = this.#sprite('Panel.mkf', 2, SUN_IMAGE, true);
    if (sun !== null) ctx.drawImage(sun.bitmap, ox + CAL.sun.x, oy + CAL.sun.y);
    const moon = this.#sprite('Panel.mkf', 2, MOON_IMAGE, true);
    if (moon !== null) ctx.drawImage(moon.bitmap, ox + CAL.moon.x, oy + CAL.moon.y);

    const holiday = isHoliday(globalMapId, year, month, day);
    const text = (
      s: string,
      at: { x: number; y: number },
      align: CanvasTextAlign,
      font: string,
      fill: string,
    ): void => {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(s, ox + at.x, oy + at.y);
      ctx.fillStyle = fill;
      ctx.fillText(s, ox + at.x, oy + at.y);
    };
    const body = '15px "PingFang TC", "Microsoft JhengHei", sans-serif';
    text(String(year), CAL.year, 'left', body, PLAIN_COLOR);
    text(`${month}月`, CAL.monthText, 'center', body, PLAIN_COLOR);
    text(
      WEEKDAY_NAMES[weekdayOf(year, month, day)] ?? '',
      CAL.weekday,
      'left',
      body,
      holiday ? HOLIDAY_COLOR : PLAIN_COLOR,
    );
    text(
      String(day),
      CAL.dayText,
      'center',
      'bold 34px "PingFang TC", "Microsoft JhengHei", sans-serif',
      holiday ? HOLIDAY_COLOR : PLAIN_COLOR,
    );
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 月曆面 —— 整月的格子。
   *
   * 底图 4..7 上那条 `S M T W T F S` 就是这个版式的表头，格子正好排在它下面。
   */
  #drawMonth(input: HudInput): void {
    const ctx = this.#ctx;
    const { day, month, year, globalMapId } = input.state;
    const { x: ox, y: oy, w, h } = SIDEBAR;

    const bg = this.#sprite('Panel.mkf', 2, MONTH_VIEW_BASE + sceneOfMonth(month));
    if (bg !== null) ctx.drawImage(bg.bitmap, ox, oy, w, h);
    else {
      ctx.fillStyle = '#7f9fbf';
      ctx.fillRect(ox, oy, w, h);
    }

    const first = weekdayOf(year, month, 1);
    const total = daysInMonth(year, month);
    // @source 0x00416aa1：第一格中心 x = 第一格列 + 23 × 该月1号的星期
    let x = CAL.grid.x0 + CAL.grid.pitch * first;
    let y = CAL.grid.y0;

    ctx.font = '12px "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 1; d <= total; d++) {
      if (d === day) {
        // @source 0x00416ad3：今天填一块红底
        ctx.fillStyle = HOLIDAY_COLOR;
        ctx.fillRect(ox + x + CAL.today.dx, oy + y + CAL.today.dy, CAL.today.w, CAL.today.h);
      }
      ctx.fillStyle = isHoliday(globalMapId, year, month, d) ? HOLIDAY_COLOR : PLAIN_COLOR;
      if (d === day) ctx.fillStyle = '#ffffff'; // 红底上要看得见
      ctx.fillText(String(d), ox + x, oy + y);

      // @source 0x00416b33：走到最后一列就折行
      if (x === CAL.grid.x0 + CAL.grid.pitch * CAL.grid.cols) {
        x = CAL.grid.x0 - CAL.grid.pitch;
        y += CAL.grid.rowH;
      }
      x += CAL.grid.pitch;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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
    // ★ 头像也是 SMP，黑是抠图底色；不抠就会顶着一块黑框
    const face = this.#sprite('map.mkf', portraitResource(me.character), 0, true);
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
