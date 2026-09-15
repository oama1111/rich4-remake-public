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
import { VIEW_CENTER, VIEW_COUNT, VIEW_SPAN, projectCell, projectWorld } from '@rich4/data';
import type { Sprite, SpriteCache } from './assets.ts';
import {
  DECOR_RESOURCE,
  buildingImageIndex,
  buildingResource,
  chainStoreResource,
  TOOLBAR_ICON_COUNT,
  TOOLBAR_RESOURCE,
  TOOLBAR_STRIP_IMAGE,
  decorImageIndex,
  facilitySheetBase,
  facilitySlot,
  sceneryResource,
  toolbarIconImage,
  characterSprite,
  CHARACTER_POSE,
  directionalImage,
  screenDirection,
} from './assets.ts';

/**
 * 顶部工具栏的摆位。
 *
 * ★ 底条是 439×40，上面等距排 11 个图标，间距 39。
 *
 * ★ `padX` **由底条宽度推出，不是量出来的**：
 *   `11 × 39 = 429`，两侧各留 `(439 − 429) / 2 = 5`，图标块才与底条同心。
 *   先前写的是 6（照截图目测），于是整块图标比底条中心**偏右 1 像素** ——
 *   单看工具栏看不出来，与底图边框一对就显形（需求方 2026-09-14 指出）。
 *   `hitToolbar` 用的是同一个 `padX`，所以点击区随之对齐。
 */
export const TOOLBAR = { x: 0, y: 0, pitch: 39, padX: 5, padY: 3, height: 40 } as const;

/** 点在工具栏的第几个按钮上；没点中返回 null */
export function hitToolbar(sx: number, sy: number): number | null {
  if (sy < TOOLBAR.y || sy >= TOOLBAR.y + TOOLBAR.height) return null;
  const i = Math.floor((sx - TOOLBAR.x - TOOLBAR.padX) / TOOLBAR.pitch);
  return i >= 0 && i < TOOLBAR_ICON_COUNT ? i : null;
}

/** 玩家棋子的颜色——原版每人一色，此处先用可区分的四色占位 */
const PLAYER_COLORS = ['#e8524a', '#4a90e8', '#4ae87c', '#e8d24a'] as const;

/**
 * 视角模式。
 *
 * ★ 原版有两种看法，小地图上方那两个按钮就是切它们：
 * - `character` **人物视角**：等距投影、跟着棋子走，是主要的游戏画面。
 *   摄像机恒在 29×29 窗口的正中一格，投影查 `@rich4/data` 的投影表。
 * - `map` **地图视角**：把整张底图平铺出来俯瞰。底图本身就是这个朝向
 *   （2304 见方的正射图），故这一模式不查表，直接缩放平铺。
 */
export type ViewMode = 'character' | 'map';

export interface Camera {
  /** 地图视角用：视口左上角对应的地图坐标 */
  x: number;
  y: number;
  scale: number;
  /** 当前模式 */
  mode: ViewMode;
  /**
   * 视角编号 0..7，每步 45°。
   * @source 原版全局 `[0x499088]`，开局清零
   */
  view: number;
  /** 人物视角用：摄像机所在的**块**坐标（世界坐标 >> 5） */
  tileX: number;
  tileY: number;
}

export interface RenderInput {
  map: Rich4Map;
  state: GameState;
  camera: Camera;
  /** 鼠标悬停的节点号，null 表示没有 */
  hoverNode: number | null;
  /** 原版底图（map.mkf 偶数号资源解出来的 .gnd） */
  ground?: ImageBitmap | null;
  groundOffset?: { x: number; y: number };
  /** 正被按下的工具栏按钮下标 */
  pressedTool?: number | null;
  /**
   * 棋盘区的尺寸。
   *
   * ★ 必须显式给出，**不能再从画布尺寸推**：原版的棋盘区是固定的
   *   439×440（见 stage.ts 的 LAYOUT.board），而画布现在是整个窗口。
   *   照画布算，一屏里会塞进远超原版的格子数，视角与取景全错。
   */
  viewport: { w: number; h: number };
}

/**
 * 世界坐标 → 屏幕坐标。
 *
 * 人物视角走原版的投影表（见 @rich4/data 的 projection.ts），
 * 返回的是相对**屏幕中心**的偏移，故要加上视口中心；
 * 越出 29×29 窗口时返回 null，与原版一样直接不画。
 *
 * 地图视角则是简单的平移缩放——底图本身就是正射的。
 */
export function worldToScreen(
  x: number,
  y: number,
  cam: Camera,
  viewport: { w: number; h: number },
): { x: number; y: number } | null {
  if (cam.mode === 'map') {
    return { x: (x - cam.x) * cam.scale, y: (y - cam.y) * cam.scale };
  }
  const p = projectWorld(cam.view, x, y, cam.tileX, cam.tileY);
  if (p === null) return null;
  return { x: viewport.w / 2 + p.x, y: viewport.h / 2 + p.y };
}

/** 兼容旧调用：地图节点的屏幕坐标（地图视角的平移缩放） */
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
 * 找出离给定**地图坐标**最近的节点。
 *
 * ⚠️ 它只认地图坐标 —— 要从鼠标位置拾取请用 `pickNodeAt`，
 *   那个两种视角都对。这个留着是给小地图之类已经在地图坐标里的调用方。
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

/** 地图视角：让整张地图恰好装进视口 */
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
    mode: 'map',
    view: 0,
    tileX: 0,
    tileY: 0,
  };
}

/** 人物视角：摄像机落在某个世界坐标所在的块上 */
export function characterCamera(x: number, y: number, view = 0): Camera {
  return { x: 0, y: 0, scale: 1, mode: 'character', view: view % VIEW_COUNT, tileX: x >> 5, tileY: y >> 5 };
}

export class BoardRenderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #sprites: SpriteCache;
  /** 已请求但尚未解码完成的精灵——避免同一帧内重复发起 */
  readonly #pending = new Set<string>();
  #ready = new Map<string, Sprite | null>();
  /** 有新精灵解码完成时置位，驱动下一帧重绘 */
  #dirty = false;
  /**
   * 行走动画的帧号 —— 由宿主按动画节拍推进。
   *
   * ⚠️ 原版每个玩家各有一份（`[0x498ea3 + player*0x34]`），换算成帧率的那段
   *   没解出来。本引擎先共用一个计数器：同一时刻只有一个人在走，看不出差别。
   */
  #walkFrame = 0;
  /**
   * 解码落地时叫一声。
   *
   * ⚠️ 光有 `#dirty` 不够：解码几乎总是在本帧的 rAF 回调**之后**才 resolve，
   *   那时已经没人再去看这个标志了 —— 画面就永远停在「图还没到」的那一帧。
   *   （工具栏底条整条不显示，正是这么来的。）
   */
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

  /** 画出节点连线与落点菱形 —— **调试用**，原版没有 */
  debugNodes = false;

  /** 推进一格行走动画 */
  advanceWalk(): void {
    this.#walkFrame = (this.#walkFrame + 1) & 0xff;
  }

  /** 某个资源里有几张图（同步，只解表头） */
  #imageCount(archive: 'Data.mkf' | 'Panel.mkf' | 'map.mkf' | 'jump.mkf', res: number): number {
    return this.#sprites.imageCount(archive, res);
  }

  /**
   * 同步取精灵；未就绪时返回 null 并在后台解码。
   *
   * 渲染是同步的而解码是异步的（createImageBitmap），故这里用
   * 「先画能画的，解码完再标脏重画」的策略，而不是让整帧等在 await 上。
   */
  #sprite(
    archive: 'Data.mkf' | 'Panel.mkf' | 'map.mkf' | 'jump.mkf',
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

  /** 只画**棋盘区**。工具栏与側欄由舞台负责摆位（见 stage.ts）。 */
  draw(input: RenderInput): void {
    const { map, state, camera, hoverNode } = input;
    const ctx = this.#ctx;
    const width = input.viewport.w;
    const height = input.viewport.h;
    // 棋盘画进一块 1:1 的离屏画布，缩放交给舞台统一做
    const dpr = 1;

    ctx.fillStyle = '#0e1016';
    ctx.fillRect(0, 0, width, height);

    const ground = input.ground ?? null;
    if (ground !== null) {
      if (camera.mode === 'character') {
        this.#drawGroundProjected(ground, camera, { w: width, h: height }, dpr);
      } else {
        const off = input.groundOffset ?? { x: 0, y: 0 };
        ctx.drawImage(
          ground,
          (off.x - camera.x) * camera.scale,
          (off.y - camera.y) * camera.scale,
          ground.width * camera.scale,
          ground.height * camera.scale,
        );
        // 地图视角把底图压暗，让棋盘的连线与格子读得出来
        ctx.fillStyle = 'rgba(10,12,20,0.35)';
        ctx.fillRect(0, 0, width, height);
      }
    }

    const vp = { w: width, h: height };
    // ⚠️ 原版棋盘上**没有**连线，也没有标落点的菱形 —— 格子长什么样全靠
    //   底图与建筑图素本身。先前那两层是解地图时的调试辅助，留着就不是复刻了。
    //   仍然保留代码，`?debug=nodes` 时才画，排错时还用得上。
    if (this.debugNodes) this.#drawEdges(map, camera, vp);
    this.#drawDecor(map, camera, vp);
    this.#drawBuildings(map, state, camera, vp);
    if (this.debugNodes) this.#drawNodes(map, state, camera, hoverNode, vp);
    this.#drawPlayers(map, state, camera, vp);
  }

  /**
   * 顶部工具栏 —— 画到**舞台**上，不是棋盘上。
   *
   * ⚠️ 必须显式收一个 ctx：渲染器自己那块 ctx 是**棋盘的离屏画布**
   *   （439×440，位于工具栏下方）。往那上面画工具栏，等于画进了棋盘里，
   *   而且还会被下一帧的棋盘绘制覆盖掉 —— 表现就是工具栏整条不见。
   */
  drawToolbarTo(ctx: CanvasRenderingContext2D, x: number, y: number, pressed: number | null): void {
    const strip = this.#sprite('Panel.mkf', TOOLBAR_RESOURCE, TOOLBAR_STRIP_IMAGE);
    if (strip !== null) ctx.drawImage(strip.bitmap, x, y);
    for (let i = 0; i < TOOLBAR_ICON_COUNT; i++) {
      // ★ 图标是 SMP，黑色是抠图底色，不抠的话每个图标都顶着一块黑底
      const icon = this.#sprite(
        'Panel.mkf', TOOLBAR_RESOURCE, toolbarIconImage(i, pressed === i), true,
      );
      if (icon === null) continue;
      const cx = x + TOOLBAR.padX + i * TOOLBAR.pitch + TOOLBAR.pitch / 2;
      const cy = y + TOOLBAR.padY + (TOOLBAR.height - TOOLBAR.padY * 2) / 2;
      ctx.drawImage(icon.bitmap, Math.round(cx - icon.width / 2), Math.round(cy - icon.height / 2));
    }
  }

  /** 先画连线，让棋盘的走法一眼可见 */
  #drawEdges(map: Rich4Map, cam: Camera, vp: { w: number; h: number }): void {
    const ctx = this.#ctx;
    ctx.strokeStyle = 'rgba(150,200,255,0.28)';
    ctx.lineWidth = cam.mode === 'map' ? Math.max(1.5, cam.scale * 2.5) : 2;
    ctx.beginPath();
    for (const n of map.nodes) {
      const a = worldToScreen(n.x, n.y, cam, vp);
      if (a === null) continue;
      for (const adj of n.adjacent) {
        const m = map.nodes[adj - 1];
        if (m === undefined || m.id < n.id) continue; // 每条边只画一次
        const b = worldToScreen(m.x, m.y, cam, vp);
        if (b === null) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
  }


  /**
   * 人物视角下的底图 —— 逐块投影成四边形铺出来。
   *
   * @source 原版地面绘制 VA 0x00408480 起：每块取**投影表里相邻的四个表项**
   *   当四角（左上 = (行,列)、右上 = (行,列+1)、右下 = (行+1,列+1)、
   *   左下 = (行+1,列)），再把该块的 32×32 像素贴进这个四边形。
   *   相邻块共用角点，故铺出来无缝。
   *   块的取用同样经排布表：`layout[世界块Y*72 + 世界块X]`
   *   （`mov di, word [layoutTable + index*2]` / `shl esi, 0xa` 即 ×1024），
   *   这与 assets-pipeline 解出的格式完全吻合。
   *
   * ⚠️ **用仿射近似代替透视**：canvas 2D 没有透视变换，这里按三个角
   *   （左上/右上/左下）做仿射。实测第四角与原版表值最大差 **2 像素**
   *   （八个视角、全部 28×28 格里的最差值），肉眼不可辨。
   */
  #drawGroundProjected(
    ground: ImageBitmap,
    cam: Camera,
    vp: { w: number; h: number },
    dpr: number,
  ): void {
    const ctx = this.#ctx;
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    const tilesAcross = ground.width >> 5;
    const tilesDown = ground.height >> 5;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // 表是 29×29，取相邻角点故只能铺 28×28 格
    for (let row = 0; row < VIEW_SPAN - 1; row++) {
      for (let col = 0; col < VIEW_SPAN - 1; col++) {
        const tx = cam.tileX + col - VIEW_CENTER;
        const ty = cam.tileY + row - VIEW_CENTER;
        if (tx < 0 || ty < 0 || tx >= tilesAcross || ty >= tilesDown) continue;

        const tl = projectCell(cam.view, row, col);
        const tr = projectCell(cam.view, row, col + 1);
        const bl = projectCell(cam.view, row + 1, col);
        if (tl === null || tr === null || bl === null) continue;

        // 单位正方形 → 四边形的仿射；略微放大 2% 以盖住相邻块之间的接缝
        // ⚠️ setTransform 会**顶掉** ctx 上的 dpr 缩放，故这里自己乘回去
        ctx.setTransform(
          (tr.x - tl.x) * dpr,
          (tr.y - tl.y) * dpr,
          (bl.x - tl.x) * dpr,
          (bl.y - tl.y) * dpr,
          (cx + tl.x) * dpr,
          (cy + tl.y) * dpr,
        );
        ctx.drawImage(ground, tx * 32, ty * 32, 32, 32, -0.01, -0.01, 1.02, 1.02);
      }
    }
    ctx.restore();
  }

  /**
   * 特殊格的装饰图（PARK / NEWS / 命運 / BANK …）。
   *
   * 画在连线之上、节点之下：原版这些图就是铺在地上的，棋子踩在上面。
   */
  #drawDecor(map: Rich4Map, cam: Camera, vp: { w: number; h: number }): void {
    const ctx = this.#ctx;
    const k = cam.mode === 'map' ? cam.scale : 1;
    for (const n of map.nodes) {
      const idx = decorImageIndex(n.decorIndex);
      if (idx === null) continue;
      // ★ 装饰图是 SMP，靠抠掉纯黑来融进地面（见 assets-pipeline 的 DecodeOptions）
      const sp = this.#sprite('map.mkf', DECOR_RESOURCE, idx, true);
      if (sp === null) continue;
      const p = worldToScreen(n.x, n.y, cam, vp);
      if (p === null) continue;
      ctx.drawImage(
        sp.bitmap,
        p.x - sp.anchorX * k,
        p.y - sp.anchorY * k,
        sp.width * k,
        sp.height * k,
      );
    }
  }

  /**
   * 已开发地块上的建筑。
   *
   * 资源号与图号的由来见 assets.ts 的 `buildingResource` / `buildingImageIndex`
   * ——都是从原版加载与绘制代码直接读出来的。
   *
   * ⚠️ 按 y 排序后再画：等距视角下靠后的建筑要先画，否则近处的房子
   *   会被远处的盖住。
   */
  #drawBuildings(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
  ): void {
    const ctx = this.#ctx;
    /** 一件立体物：资源、图号、落点 */
    const items: { y: number; x: number; res: number; img: number }[] = [];

    // ── 地块建筑 ──
    for (const n of map.nodes) {
      if (n.ref.kind !== 'land') continue;
      const landId = n.ref.index;
      const level = state.landLevel[landId] ?? 0;
      // @source cmp byte [land+0x1a], 0 / je —— 等级 0 不画建筑
      if (level < 1) continue;
      const land = map.lands.find((l) => l.id === landId);
      if (land === undefined) continue;
      // @source cmp byte [land+0x18], 0 / jne → 连锁店走另一张图集
      const res =
        land.type !== 0
          ? chainStoreResource(state.globalMapId)
          : buildingResource(state.globalMapId, level);
      if (res === null) continue;
      // ★ 用**地块记录自己的 x/y**，不是所在节点的 —— 两者差一格。
      //   @source 地块绘制 VA 0x004090fc：`movsx eax, word [ebp]` / `movsx edx, word [ebp+2]`，
      //   而 `ebp` 指的是**地块记录**（+0x1b 取朝向、+0x1a 取等级，都在同一条记录上）。
      //   实测地图 1：node 39 (1463,239) 与 land 1 (1463,192) 是同一块地，
      //   y 差 47（约一格半），设施/企业/景观那三处本来就用的自己的坐标，只有地块这里不一致。
      items.push({ x: land.x, y: land.y, res, img: buildingImageIndex(land.facing, cam.view) });
    }

    // ── 设施（機場/港口…）──
    const gameStage = state.globalMapId >> 2;
    const gameMap = state.globalMapId & 3;
    const base = facilitySheetBase(gameStage, gameMap);
    for (const f of map.facilities) {
      items.push({
        x: f.x,
        y: f.y,
        res: base + facilitySlot(f.type, f.level),
        img: buildingImageIndex(f.facing, cam.view),
      });
    }

    // ── 上市企业与特殊景观：共用「索引 + 38」那套 ──
    for (const c of map.commercials) {
      const res = sceneryResource(c.spriteIndex);
      if (res !== null) items.push({ x: c.x, y: c.y, res, img: 0 });
    }
    for (const l of map.landscapes) {
      const res = sceneryResource(l.spriteIndex);
      if (res !== null) items.push({ x: l.x, y: l.y, res, img: 0 });
    }

    // ★ 等距视角下靠后的先画，否则近处的会被远处的盖住
    items.sort((a, b) => a.y - b.y);

    const k = cam.mode === 'map' ? cam.scale : 1;
    for (const it of items) {
      const sp = this.#sprite('map.mkf', it.res, it.img, true);
      if (sp === null) continue;
      const p = worldToScreen(it.x, it.y, cam, vp);
      if (p === null) continue;
      ctx.drawImage(
        sp.bitmap,
        p.x - sp.anchorX * k,
        p.y - sp.anchorY * k,
        sp.width * k,
        sp.height * k,
      );
    }
  }

  /**
   * 格子标记。
   *
   * ★ 画成**菱形**而不是圆：底图本身就是等距视角，格线是菱形的
   *   （原版截图里草地上那圈白色虚线就是），圆形叠上去会明显出戏。
   *   长宽比 2:1 是等距投影的标准比例。
   *
   * ⚠️ 这仍是**占位图形**，不是原版美术：原版每格的底色由绘制槽的
   *   `[0x48a852]`（归属）与 `[0x48a853]`（朝向）决定，具体画法还没解。
   *   有主时按玩家色填充，无主时按格子类型给个中性色。
   */
  #drawNodes(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    hover: number | null,
    vp: { w: number; h: number },
  ): void {
    const ctx = this.#ctx;
    // 等距菱形：半宽 2 × 半高
    const hw = cam.mode === 'map' ? Math.max(7, cam.scale * 13) : 15;
    const hh = hw / 2;

    const diamond = (x: number, y: number): void => {
      ctx.beginPath();
      ctx.moveTo(x, y - hh);
      ctx.lineTo(x + hw, y);
      ctx.lineTo(x, y + hh);
      ctx.lineTo(x - hw, y);
      ctx.closePath();
    };

    for (const n of map.nodes) {
      const p = worldToScreen(n.x, n.y, cam, vp);
      if (p === null) continue;
      const owner = ownerOfNode(n, state);

      diamond(p.x, p.y);
      ctx.fillStyle = owner >= 0 ? (PLAYER_COLORS[owner] ?? '#888') : nodeBaseColor(n);
      ctx.globalAlpha = owner >= 0 ? 0.85 : 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 描边让相邻格子在密集处也能分开
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (n.id === hover) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  #drawPlayers(
    map: Rich4Map,
    state: GameState,
    cam: Camera,
    vp: { w: number; h: number },
  ): void {
    const ctx = this.#ctx;
    // 同格多人时错开，否则棋子会完全重叠
    const perNode = new Map<number, number>();
    for (const pl of state.players) {
      if (pl.whoPlays === 0) continue;
      const node = map.nodes[pl.nodeId - 1];
      if (node === undefined) continue;
      const seen = perNode.get(pl.nodeId) ?? 0;
      perNode.set(pl.nodeId, seen + 1);

      const p = worldToScreen(node.x, node.y, cam, vp);
      if (p === null) continue;
      const k = cam.mode === 'map' ? cam.scale : 1;
      const off = seen * Math.max(4, k * 5);

      // ★ 原版棋子：锚点在底边中心，故按锚点对齐到格心（C-AST-6）
      //
      // ★ 朝向跟着走位走，不是永远面朝镜头：
      //   屏幕朝向 = (玩家朝向 + 8 − 视角) & 7（@source VA 0x0040882d），
      //   图号 = 屏幕朝向 × (图数 / 8) + 帧（@source VA 0x0040883f）。
      const moving = state.phase === 'moving' && pl.index === state.currentPlayer;
      const pose = moving ? CHARACTER_POSE.walk : CHARACTER_POSE.stand;
      const res = characterSprite(pl.character, pose);
      const count = this.#imageCount('Data.mkf', res);
      const dir = screenDirection(pl.direction, cam.view);
      const token =
        count > 0
          ? this.#sprite('Data.mkf', res, directionalImage(count, dir, this.#walkFrame))
          : null;
      if (token !== null) {
        const w = token.width * k;
        const h = token.height * k;
        const x = p.x + off - token.anchorX * k;
        const y = p.y - off - token.anchorY * k;
        if (pl.index === state.currentPlayer) {
          // 当前玩家脚下画一圈光晕，免得在密集处认不出轮到谁
          ctx.beginPath();
          ctx.ellipse(p.x + off, p.y - off, w * 0.42, h * 0.14, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,236,120,0.55)';
          ctx.fill();
        }
        ctx.drawImage(token.bitmap, x, y, w, h);
        continue;
      }

      // 精灵还没解完时退回色块，别让棋子凭空消失
      const r = Math.max(4, k * 7);
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

/**
 * 屏幕坐标 → 节点号，**两种视角都管用**。
 *
 * ★ 这里不去解投影的逆，而是把每个节点**正向投一遍**再比屏幕距离。
 *   理由有三：
 *   - 用的就是绘制时那张表（`projectWorld`），所以「看得见的就点得到」，
 *     不会出现画在这、点在那的错位；
 *   - 投影在 29×29 窗口外直接返回 null，逆变换要另外处理这个边界，
 *     正向投则天然跳过；
 *   - 103 个节点，一次遍历的开销可以忽略。
 *
 * ⚠️ 先前的拾取走 `screenToMap` + `pickNode`，而 `screenToMap` **只实现了
 *   地图视角**的平移缩放。在人物视角下它算出来的地图坐标是错的，
 *   于是悬停高亮和岔路点击全都指向别的格子。
 */
export function pickNodeAt(
  map: Rich4Map,
  sx: number,
  sy: number,
  cam: Camera,
  viewport: { w: number; h: number },
  radius = 24,
): number | null {
  let best: number | null = null;
  let bestDist = radius * radius;
  for (const n of map.nodes) {
    const p = worldToScreen(n.x, n.y, cam, viewport);
    // 人物视角下越出窗口的节点根本没画，自然也点不到
    if (p === null) continue;
    const dx = p.x - sx;
    const dy = p.y - sy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = n.id;
    }
  }
  return best;
}
