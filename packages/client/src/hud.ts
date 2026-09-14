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
}

/** HUD 上可点的按钮 */
export type HudButton = 'toggleView' | 'rotateLeft' | 'rotateRight';

/**
 * 小地图上方的那排按钮。
 *
 * ★ 原版在小地图正上方也有一排小按钮（见游戏截图右下角），
 *   位置照搬，但**图标还没从资源里认出来**，故先用文字/箭头占位。
 */
const BUTTON_SIZE = 22;
const BUTTON_GAP = 4;
const BUTTON_ROW_Y = PANEL_HEIGHT + 8;
const BUTTONS: readonly { id: HudButton; label: string; title: string }[] = [
  { id: 'toggleView', label: '⇄', title: '切换 人物/地图 视角' },
  { id: 'rotateLeft', label: '↺', title: '左转视角' },
  { id: 'rotateRight', label: '↻', title: '右转视角' },
];

/** 按钮在 HUD 画布里的矩形 */
function buttonRect(i: number): { x: number; y: number; w: number; h: number } {
  return {
    x: 2 + i * (BUTTON_SIZE + BUTTON_GAP),
    y: BUTTON_ROW_Y,
    w: BUTTON_SIZE,
    h: BUTTON_SIZE,
  };
}

/** 点在 HUD 的哪个按钮上；没点中返回 null */
export function hitHudButton(x: number, y: number): HudButton | null {
  for (let i = 0; i < BUTTONS.length; i++) {
    const r = buttonRect(i);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return BUTTONS[i]!.id;
  }
  return null;
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

export class Hud {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  readonly #ready = new Map<string, Sprite | null>();
  readonly #pending = new Set<string>();
  #dirty = false;

  constructor(ctx: CanvasRenderingContext2D, sprites: SpriteCache) {
    this.#ctx = ctx;
    this.#sprites = sprites;
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
      });
    }
    return null;
  }

  draw(input: HudInput): void {
    const ctx = this.#ctx;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    this.#drawPanel(input);
    this.#drawButtons(input);
    this.#drawMinimap(input, BUTTON_ROW_Y + BUTTON_SIZE + 6);
  }

  /** 小地图上方那排视角按钮 */
  #drawButtons(input: HudInput): void {
    const ctx = this.#ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < BUTTONS.length; i++) {
      const b = BUTTONS[i]!;
      const r = buttonRect(i);
      const on = b.id === 'toggleView' && input.camera.mode === 'character';
      ctx.fillStyle = on ? '#3a4a66' : '#22262f';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#4a5265';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = '#dfe4ee';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
    // 当前视角编号，方便核对 8 个朝向
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8d95a5';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(
      `${input.camera.mode === 'character' ? '人物' : '地图'}视角 · 方位 ${input.camera.view}`,
      BUTTONS.length * (BUTTON_SIZE + BUTTON_GAP) + 6,
      BUTTON_ROW_Y + BUTTON_SIZE / 2 + 1,
    );
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
    const size = PANEL_WIDTH;
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
