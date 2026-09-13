/*
 * 棋盘渲染
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块**只读**游戏状态，不产生任何规则判断。
 *   它拿到的是 `GameState` 与地图拓扑，画出来就完事；
 *   所有「能不能」「该多少钱」的问题都在 core 里已经答完了。
 */

import type { GameState } from '@rich4/core';
import type { MapNode, Rich4Map } from '@rich4/core';
import type { Sprite, SpriteCache } from './assets.ts';

/** 玩家棋子的颜色——原版每人一色，此处先用可区分的四色占位 */
const PLAYER_COLORS = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;

export interface Camera {
  /** 视口左上角对应的地图坐标 */
  x: number;
  y: number;
  scale: number;
}

export interface RenderInput {
  map: Rich4Map;
  state: GameState;
  camera: Camera;
  /** 鼠标悬停的节点号，null 表示没有 */
  hoverNode: number | null;
}

/**
 * 地图节点的屏幕坐标。
 *
 * 节点自带的 x/y 就是原版的屏幕坐标（见 loaders/map.ts），
 * 故这里只做相机变换，不做任何投影。
 */
export function nodeToScreen(node: MapNode, cam: Camera): { x: number; y: number } {
  return {
    x: (node.x - cam.x) * cam.scale,
    y: (node.y - cam.y) * cam.scale,
  };
}

/** 把屏幕坐标反算回地图坐标——拾取用 */
export function screenToMap(sx: number, sy: number, cam: Camera): { x: number; y: number } {
  return { x: sx / cam.scale + cam.x, y: sy / cam.scale + cam.y };
}

/**
 * 找出离给定地图坐标最近的节点。
 *
 * ⚠️ 原版的拾取是像素级的（窗口过程里按精灵 alpha 命中测试），
 * 这里先用「最近且在阈值内」近似。等精灵锚点全部验证过之后可以换成
 * 真正的命中测试；先用近似是为了让棋盘尽早能点。
 */
export function pickNode(
  map: Rich4Map,
  mx: number,
  my: number,
  radius = 24,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (const n of map.nodes) {
    const dx = n.x - mx;
    const dy = n.y - my;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = n.id;
    }
  }
  return best;
}

/** 地图整体的包围盒——用于初始化相机 */
export function mapBounds(map: Rich4Map): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of map.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 让整张地图恰好装进视口 */
export function fitCamera(map: Rich4Map, viewW: number, viewH: number): Camera {
  const b = mapBounds(map);
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const margin = 40;
  const scale = Math.min((viewW - margin) / w, (viewH - margin) / h);
  return {
    x: b.minX - margin / 2 / scale,
    y: b.minY - margin / 2 / scale,
    scale,
  };
}

export class BoardRenderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  /** 已请求但尚未解码完成的精灵——避免同一帧内重复发起 */
  readonly #pending = new Set<string>();
  #ready = new Map<string, Sprite | null>();
  /** 有新精灵解码完成时置位，驱动下一帧重绘 */
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

  /**
   * 同步取精灵；未就绪时返回 null 并在后台解码。
   *
   * 渲染是同步的而解码是异步的（createImageBitmap），故这里用
   * 「先画能画的，解码完再标脏重画」的策略，而不是让整帧等在 await 上。
   */
  #sprite(archive: 'Data.mkf' | 'Panel.mkf' | 'map.mkf' | 'jump.mkf', res: number, idx: number): Sprite | null {
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

  draw(input: RenderInput): void {
    const { map, state, camera, hoverNode } = input;
    const ctx = this.#ctx;
    const { width, height } = ctx.canvas;

    ctx.fillStyle = '#0e1016';
    ctx.fillRect(0, 0, width, height);

    this.#drawEdges(map, camera);
    this.#drawNodes(map, state, camera, hoverNode);
    this.#drawPlayers(map, state, camera);
  }

  /** 先画连线，让棋盘的走法一眼可见 */
  #drawEdges(map: Rich4Map, cam: Camera): void {
    const ctx = this.#ctx;
    ctx.strokeStyle = 'rgba(150,200,255,0.28)';
    ctx.lineWidth = Math.max(1.5, cam.scale * 2.5);
    ctx.beginPath();
    for (const n of map.nodes) {
      const a = nodeToScreen(n, cam);
      for (const adj of n.adjacent) {
        const m = map.nodes[adj - 1];
        if (m === undefined || m.id < n.id) continue; // 每条边只画一次
        const b = nodeToScreen(m, cam);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
  }

  #drawNodes(map: Rich4Map, state: GameState, cam: Camera, hover: number | null): void {
    const ctx = this.#ctx;
    // 缩到很小时仍保证可见——原版是像素画，这里先用几何图形占位
    const r = Math.max(5, cam.scale * 9);

    for (const n of map.nodes) {
      const p = nodeToScreen(n, cam);
      const owner = ownerOfNode(n, state);

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle =
        owner >= 0 ? PLAYER_COLORS[owner] ?? '#888' : nodeBaseColor(n);
      ctx.fill();
      // 描边让相邻节点在密集处也能分开
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (n.id === hover) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  #drawPlayers(map: Rich4Map, state: GameState, cam: Camera): void {
    const ctx = this.#ctx;
    // 同格多人时错开，否则棋子会完全重叠
    const perNode = new Map<number, number>();
    for (const pl of state.players) {
      if (pl.whoPlays === 0) continue;
      const node = map.nodes[pl.nodeId - 1];
      if (node === undefined) continue;
      const seen = perNode.get(pl.nodeId) ?? 0;
      perNode.set(pl.nodeId, seen + 1);

      const p = nodeToScreen(node, cam);
      const off = seen * Math.max(4, cam.scale * 5);
      const r = Math.max(4, cam.scale * 7);

      ctx.beginPath();
      ctx.arc(p.x + off, p.y - off, r, 0, Math.PI * 2);
      ctx.fillStyle = PLAYER_COLORS[pl.index] ?? '#fff';
      ctx.fill();
      ctx.strokeStyle = pl.index === state.currentPlayer ? '#fff' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = pl.index === state.currentPlayer ? 3 : 1;
      ctx.stroke();
    }
  }
}

/** 该节点上的地产归谁——无主或非地产返回 -1 */
function ownerOfNode(node: MapNode, state: GameState): number {
  if (node.ref.kind !== 'land') return -1;
  const owner = state.landOwner[node.ref.index] ?? 0;
  return owner === 0 ? -1 : owner - 1;
}

/** 未持有时按格子类型上色，先让棋盘结构可读 */
function nodeBaseColor(node: MapNode): string {
  switch (node.ref.kind) {
    case 'land':
      return '#8b97a8';
    case 'facility':
      return '#c9a15e';
    case 'commercial':
      return '#a878c8';
    case 'landscape':
      return '#5fa87c';
    default:
      return node.specialKind !== 0 ? '#e0c65a' : '#6b7280';
  }
}
