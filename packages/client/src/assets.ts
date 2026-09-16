/*
 * 运行时素材加载
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 复用 `@rich4/assets-pipeline` 的解码器。
 *   那几个模块（mkf / mkf-decompress / sprite）只操作 Uint8Array，
 *   不碰 node:fs，故浏览器里可以直接用——解包逻辑只有一份，
 *   不存在「Node 一套、浏览器一套」的漂移风险。
 */

import { MkfArchive, parseSpriteSheet, decodeFlic, type SpriteSheet } from '@rich4/assets-pipeline';
import { decodeImage, decodeGround, decodeRaw555, isGround, paletteRgb } from '@rich4/assets-pipeline';
import { HOLIDAY_ART_SIZE, holidayArtResource } from '@rich4/core';
import { hdRelativePath, taskIdOf } from '@rich4/assets-pipeline';

/** 原版的资源档案 */
export const ARCHIVES = ['Data.mkf', 'Panel.mkf', 'map.mkf', 'jump.mkf', 'help.mkf'] as const;
export type ArchiveName = (typeof ARCHIVES)[number];

export interface LoadedArchives {
  get(name: ArchiveName): MkfArchive;
}

/**
 * 拉取并打开全部档案。
 *
 * @param base 素材目录的 URL 前缀；开发时由 vite 的 fs.allow 暴露
 */
export async function loadArchives(base: string): Promise<LoadedArchives> {
  const entries = await Promise.all(
    ARCHIVES.map(async (name) => {
      const res = await fetch(`${base}/${name}`);
      if (!res.ok) throw new Error(`无法读取 ${name}：HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      return [name, new MkfArchive(buf)] as const;
    }),
  );
  const map = new Map<string, MkfArchive>(entries);
  return {
    get(name) {
      const a = map.get(name);
      if (a === undefined) throw new Error(`档案未加载：${name}`);
      return a;
    },
  };
}

/**
 * **可换色槽** —— 建筑精灵用它画外圈那圈归属线。
 *
 * @source VA 0x0040987d：绘制槽遍历时，若有归属就
 * ```asm
 * cl  = slot.owner                     ; [esi + 0x48a852]
 * eax = (cl - 1) * 0x68                ; 玩家结构
 * edx = [player + 0x04]                ; ★ 角色专属色（开局从角色表拷入）
 * ax  = convert_color(edx)
 * [ebp + 0x1fe] = ax                   ; ★ 0x1fe = 255 × 2 → 调色板第 255 项
 * ```
 * 实测：各建筑精灵的 #255 是一个**占位色**（0x3FF 青 / 0x7FE0 黄 / 0x7C1F 品红），
 * 每张用 154..312 个像素 —— 就是那圈线。故渲染时把 #255 换成所有者的角色色。
 */
export const RING_PALETTE_INDEX = 255;

/** 一段解好的 FLIC 影片（逐帧位图） */
export interface LoadedFlic {
  frames: ImageBitmap[];
  width: number;
  height: number;
  /** 每帧停留多少毫秒 —— FLIC 头部自带（滚骰是 14） */
  frameMs: number;
  /** 释放这一段的位图；释放后再取会重新解 */
  close: () => void;
}

/** 一张解码好、可直接 drawImage 的图 */
export interface Sprite {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** 绘制锚点 —— 原版精灵以此对齐，超分后需同步缩放（C-AST-6） */
  anchorX: number;
  anchorY: number;
}

// ============================================================
//  HD 素材（REQ-11.1 / T-065）
// ============================================================

/** 一张图的 HD 记录 —— 锚点已由管线按**实际输出尺寸**缩放好（C-AST-6）*/
export interface HdEntry {
  anchorX: number;
  anchorY: number;
}

/**
 * HD 产物的来源。
 *
 * 抽成接口是为了**可测**：Node 里既没有 `fetch` 也没有真素材，
 * 而回退逻辑恰恰是本卡最容易写错的地方（按图回退，不是整包）。
 */
export interface HdSource {
  /** 这张图的 HD 记录；没有（未超分/未回填）返回 null */
  entry(archive: ArchiveName, resource: number, image: number): HdEntry | null;
  /** 拉 HD 产物的 PNG 字节；拉不到返回 null */
  fetchBytes(archive: ArchiveName, resource: number, image: number): Promise<Uint8Array | null>;
}

/** `Data.mkf` → `Data` —— 清单里的档案名不带扩展名 */
export function archiveKey(archive: ArchiveName): string {
  return archive.replace(/\.mkf$/, '');
}

/** 清单里一条结果至少要有的字段 */
interface HdResultLike {
  outAnchorX: number;
  outAnchorY: number;
}

export interface HdManifestLike {
  tasks: { archive: string; resource: number; image: number }[];
  results: Record<string, HdResultLike | undefined>;
}

/**
 * 由清单造一个 `HdSource`。
 *
 * ★ 只有**既有任务、又有结果**的图才算有 HD —— 光在 `tasks` 里只说明它
 *   被规划过（`plan` 一跑就全在里面了），产物根本没生成。
 *
 * @param base HD 产物目录的 URL 前缀（如 `/assets/hd`）
 */
export function hdSourceFromManifest(base: string, manifest: HdManifestLike): HdSource {
  const entries = new Map<string, HdEntry>();
  for (const t of manifest.tasks) {
    const id = taskIdOf({ archive: t.archive, resource: t.resource, image: t.image });
    const r = manifest.results[id];
    if (r !== undefined) entries.set(id, { anchorX: r.outAnchorX, anchorY: r.outAnchorY });
  }

  const keyOf = (archive: ArchiveName, resource: number, image: number): string =>
    taskIdOf({ archive: archiveKey(archive), resource, image });

  return {
    entry: (archive, resource, image) => entries.get(keyOf(archive, resource, image)) ?? null,
    fetchBytes: async (archive, resource, image) => {
      const url = `${base}/${hdRelativePath(archiveKey(archive), resource, image)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        // 网络/协议层失败一律当作「没有 HD」，回退原图——画质降级好过整屏不显示
        return null;
      }
    },
  };
}

/**
 * 读 `assets/hd-manifest.json` 造 `HdSource`；读不到返回 null（整包走原图）。
 *
 * 清单路径与 hd 目录**同级**、名字是 `<目录名>-manifest.json`
 * （`cli-upscale.ts` 的 `manifestPath` 定的；清单入库、产物不入库）。
 */
export async function loadHdSource(base: string): Promise<HdSource | null> {
  try {
    const res = await fetch(`${base}-manifest.json`);
    if (!res.ok) return null;
    return hdSourceFromManifest(base, (await res.json()) as HdManifestLike);
  } catch {
    return null;
  }
}

/** 位图工厂 —— 测试注入假实现（Node 里没有 `createImageBitmap`）*/
export type BitmapFactory = (source: ImageData | Blob) => Promise<ImageBitmap>;

const defaultBitmapFactory: BitmapFactory = (source) => createImageBitmap(source);

export interface SpriteCacheOptions {
  /** HD 来源；不给就整包走原图 */
  hd?: HdSource;
  /**
   * 精灵缓存上限（张）。超过就按 LRU 淘汰最久未用的。
   *
   * 4× 素材单张就是原图的 16 倍大，一张 640×480 的底图超分后是 2560×1920
   * → 约 20MB，几千张就能吃掉 C-PERF-2 的 1.5GB 预算。
   */
  maxSprites?: number;
  /** 原始字节缓存上限（个资源）。解压不便宜，但也不该无限留着 */
  maxBytes?: number;
  /**
   * 淘汰回调 —— 精灵被移出缓存时调用。
   *
   * ⚠️ **必须**由持有引用的消费方接上：本缓存的淘汰只把条目移出自己这张表，
   *   释放不了内存。`render.ts` 自己还有一份 `#ready`（绘制时直接用
   *   `sprite.bitmap`），淘汰时得由它把引用一并丢掉，`ImageBitmap.close()`
   *   才不会把**正在画的那一帧**弄成空白。见 Q-PERF-1。
   *
   * ⚠️ 本缓存**不止一个持有者**（`render.ts` 与 `hud.ts` 各有一张 `#ready`），
   *   故除这个构造参数外还提供 `addEvictListener`：后来者再挂一条，不会把
   *   先挂的挤掉。多条监听全部按注册顺序调用。
   */
  onEvict?: (sprite: Sprite) => void;
  createBitmap?: BitmapFactory;
}

/** 默认上限：够覆盖一张地图的全部静态图素，又远低于内存预算 */
export const DEFAULT_MAX_SPRITES = 4096;
export const DEFAULT_MAX_BYTES = 256;

/**
 * 精灵缓存。
 *
 * 一张地图上重复出现的图素（地块、建筑、装饰）成百上千，
 * 每次重绘都重新解码会直接拖垮帧率，故按 `档案:资源:图号` 缓存。
 *
 * ★ HD 优先、**按图**回退：某一张缺 HD 就这一张用原图，不影响别的图
 *   （PRD §4.5）。整包回退是错的——那会因为缺一张就把整包降级。
 */
export class SpriteCache {
  readonly #archives: LoadedArchives;
  readonly #hd: HdSource | null;
  readonly #maxSprites: number;
  readonly #maxBytes: number;
  /**
   * 淘汰监听 —— **列表而不是单个回调**：同一份缓存被 `render.ts` 与 `hud.ts`
   * 各持有一张 `#ready`，两边都得在淘汰时把自己的引用摘掉（Q-PERF-1）。
   */
  readonly #evictListeners: ((sprite: Sprite) => void)[] = [];
  readonly #createBitmap: BitmapFactory;
  readonly #sheets = new Map<string, SpriteSheet | null>();
  /** FLIC 影片缓存 —— 单独一张表，不参与 `#sprites` 的按图 LRU（见 `getFlic`） */
  readonly #flics = new Map<string, LoadedFlic | null>();
  readonly #sprites = new Map<string, Sprite | null>();
  readonly #bytes = new Map<string, Uint8Array | null>();

  constructor(archives: LoadedArchives, options: SpriteCacheOptions = {}) {
    this.#archives = archives;
    this.#hd = options.hd ?? null;
    this.#maxSprites = options.maxSprites ?? DEFAULT_MAX_SPRITES;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (options.onEvict !== undefined) this.#evictListeners.push(options.onEvict);
    this.#createBitmap = options.createBitmap ?? defaultBitmapFactory;
  }

  /**
   * 再挂一条淘汰监听。
   *
   * ★ 为什么不是「设一个 onEvict 属性」：`render.ts` 拿到的是**别人构造好的**
   *   那份缓存（构造点在 `main.ts`），而缓存有两个持有者 —— 属性式赋值会让
   *   后挂的把先挂的悄悄挤掉，症状是「有一边的内存再也放不掉」。列表没有这个问题。
   */
  addEvictListener(fn: (sprite: Sprite) => void): void {
    this.#evictListeners.push(fn);
  }

  /** 资源解出的原始字节，按需缓存——解压不便宜 */
  #bytesOf(archive: ArchiveName, resource: number): Uint8Array | null {
    const key = `${archive}:${resource}`;
    const hit = this.#bytes.get(key);
    if (hit !== undefined) {
      // LRU：命中即移到队尾（Map 保持插入序，队首是最久未用的）
      this.#bytes.delete(key);
      this.#bytes.set(key, hit);
      return hit;
    }
    let data: Uint8Array | null = null;
    try {
      data = this.#archives.get(archive).read(resource);
    } catch {
      // 资源号越界或该槽为空——原版档案里空槽很常见，不是错误
      data = null;
    }
    this.#bytes.set(key, data);
    while (this.#bytes.size > this.#maxBytes) {
      const oldest = this.#bytes.keys().next();
      if (oldest.done === true) break;
      this.#bytes.delete(oldest.value);
    }
    return data;
  }

  #sheetOf(archive: ArchiveName, resource: number): SpriteSheet | null {
    const key = `${archive}:${resource}`;
    const hit = this.#sheets.get(key);
    if (hit !== undefined) return hit;
    const data = this.#bytesOf(archive, resource);
    const sheet = data === null ? null : parseSpriteSheet(data);
    this.#sheets.set(key, sheet);
    return sheet;
  }

  /**
   * 取一段 **FLIC 影片**（`Panel.mkf` 4/5/6 = 滚骰）的逐帧位图。
   *
   * ★ 原版的滚骰不是贴图序列，是 FLIC；解码器在 `@rich4/assets-pipeline` 的
   *   `flic.ts`（算法出处见那里的文件头）。
   *
   * ⚠️ 一次 36 帧 × 189×285 就是约 7.7 MB 显存，故**按资源缓存**并在调用方
   *   不再需要时 `closeDiceFlic()` 释放；不放进 `#sprites` 的 LRU 里 ——
   *   那里的淘汰粒度是一张图，挡不住这种整段影片。
   */
  async getFlic(archive: ArchiveName, resource: number): Promise<LoadedFlic | null> {
    const key = `${archive}:${resource}:flic`;
    const hit = this.#flics.get(key);
    if (hit !== undefined) return hit;
    const data = this.#bytesOf(archive, resource);
    const decoded = data === null ? null : decodeFlic(data);
    if (decoded === null) {
      this.#flics.set(key, null);
      return null;
    }
    const frames: ImageBitmap[] = [];
    for (const rgba of decoded.frames) {
      frames.push(await this.#createBitmap(new ImageData(rgba, decoded.info.width, decoded.info.height)));
    }
    const out: LoadedFlic = {
      frames,
      width: decoded.info.width,
      height: decoded.info.height,
      frameMs: decoded.info.frameMs,
      close: () => {
        for (const b of frames) b.close();
        this.#flics.delete(key);
      },
    };
    this.#flics.set(key, out);
    return out;
  }

  /**
   * 这个资源里有几张图 —— 取不到返回 0。
   *
   * ★ 八向精灵要靠它算图号（`图号 = 朝向 × 图数/8 + 帧`，见 assets.ts 的
   *   `directionalImage`），所以这个数必须能**同步**问出来。它只需要解表头，
   *   不解像素，很便宜。
   */
  imageCount(archive: ArchiveName, resource: number): number {
    return this.#sheetOf(archive, resource)?.images.length ?? 0;
  }

  /**
   * 取一张精灵；资源或图号不存在时返回 null 而不是抛错。
   *
   * `colorKeyBlack` 用于叠在地图上的 SMP 图（特殊格装饰等）——
   * 见 assets-pipeline 的 `DecodeOptions`。
   *
   * 取图顺序：**HD 优先，缺则回退原图**（按图回退，见 PRD §4.5）。
   */
  async get(
    archive: ArchiveName,
    resource: number,
    index: number,
    colorKeyBlack = false,
    ring?: readonly [number, number, number],
  ): Promise<Sprite | null> {
    const key = `${archive}:${resource}:${index}:${colorKeyBlack ? 'k' : ''}:${ring === undefined ? '' : ring.join(',')}`;
    const hit = this.#sprites.get(key);
    if (hit !== undefined) {
      // LRU：命中即移到队尾
      this.#sprites.delete(key);
      this.#sprites.set(key, hit);
      return hit;
    }

    const sprite =
      (await this.#hdSprite(archive, resource, index)) ??
      (await this.#originalSprite(archive, resource, index, colorKeyBlack, ring));
    this.#insert(key, sprite);
    return sprite;
  }

  /**
   * HD 那张。没有记录、拉不到、解不开——一律返回 null 让调用方回退原图。
   *
   * ★ **不补 `colorKeyBlack`**：透明性在管线里已经烘进 alpha 了
   *   （`slice` 把 alpha 单独交出、`merge` 再盖回来），而 AI 放大后
   *   「纯黑」早已不是精确的 0，按 RGB==0 再抠一次只会抠不动或抠错。
   */
  async #hdSprite(archive: ArchiveName, resource: number, index: number): Promise<Sprite | null> {
    const hd = this.#hd;
    if (hd === null) return null;
    const entry = hd.entry(archive, resource, index);
    if (entry === null) return null;

    const bytes = await hd.fetchBytes(archive, resource, index);
    if (bytes === null) return null;

    try {
      // ★ 交给**浏览器原生解码**（`createImageBitmap` 直接吃 Blob），不自己解 PNG：
      //   一是不必把 `decodePng` 拖进前端（它依赖 `node:zlib`，见 Q-BUILD-1），
      //   二是 4× 的图很大，原生解码比 JS 快得多。
      const bitmap = await this.#createBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
      if (bitmap.width === 0 || bitmap.height === 0) return null;
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        // 锚点由清单给出——管线已按**实际输出尺寸**算好（C-AST-6），
        // 这里不再自己乘 scale：工具常把结果对齐到 4 的倍数，自己算会偏。
        anchorX: entry.anchorX,
        anchorY: entry.anchorY,
      };
    } catch {
      // HD 产物损坏不该让这张图消失——回退原图即可
      return null;
    }
  }

  /** 原版档案里的那张 */
  async #originalSprite(
    archive: ArchiveName,
    resource: number,
    index: number,
    colorKeyBlack: boolean,
    ring?: readonly [number, number, number],
  ): Promise<Sprite | null> {
    const sheet = this.#sheetOf(archive, resource);
    const data = this.#bytesOf(archive, resource);
    if (sheet === null || data === null || index >= sheet.images.length) return null;

    const img = decodeImage(sheet, data, index, { colorKeyBlack });
    if (ring !== undefined) recolorRing(img, sheet.palette, ring);
    if (img.width === 0 || img.height === 0) return null;

    return {
      bitmap: await this.#createBitmap(toImageData(img.width, img.height, img.rgba)),
      width: img.width,
      height: img.height,
      anchorX: img.anchorX,
      anchorY: img.anchorY,
    };
  }

  /** 存一条并按 LRU 修剪 */
  #insert(key: string, sprite: Sprite | null): void {
    this.#sprites.set(key, sprite);
    while (this.#sprites.size > this.#maxSprites) {
      const oldest = this.#sprites.keys().next();
      if (oldest.done === true) break;
      const evicted = this.#sprites.get(oldest.value);
      this.#sprites.delete(oldest.value);
      // null 条目（「这个资源没有这张图」）没什么可释放的，不必回调
      if (evicted !== null && evicted !== undefined) {
        for (const fn of this.#evictListeners) fn(evicted);
      }
    }
  }

  /** 已缓存的精灵数——用于诊断 */
  get size(): number {
    return this.#sprites.size;
  }

  /** 已缓存的原始字节条目数——用于诊断 */
  get byteSize(): number {
    return this.#bytes.size;
  }
}

/**
 * 把精灵里「可换色槽」（调色板 #255）的像素换成指定颜色。
 *
 * ★ 是按**颜色**匹配而不是按索引 —— 解码出来的是 RGBA，索引已经丢了；
 *   而 #255 的占位色在各资源里不同，故先从调色板取出它再逐像素比。
 */
function recolorRing(
  img: { rgba: Uint8ClampedArray },
  palette: Uint8Array | null,
  to: readonly [number, number, number],
): void {
  if (palette === null) return;
  const [r, g, b] = paletteRgb(palette, RING_PALETTE_INDEX);
  const [R, G, B] = to;
  if (r === R && g === G && b === B) return;
  for (let i = 0; i < img.rgba.length; i += 4) {
    if (img.rgba[i] === r && img.rgba[i + 1] === g && img.rgba[i + 2] === b && img.rgba[i + 3] !== 0) {
      img.rgba[i] = R;
      img.rgba[i + 1] = G;
      img.rgba[i + 2] = B;
    }
  }
}

/** 先按尺寸建 ImageData 再 set —— 直接把解码数组传进构造函数会因
 *  ArrayBufferLike 与 ImageDataArray 的类型差异被拒。 */
function toImageData(width: number, height: number, rgba: Uint8ClampedArray): ImageData {
  const out = new ImageData(width, height);
  out.data.set(rgba);
  return out;
}

/**
 * 读取一张地图的结构数据。
 * @source map.mkf 资源号 `globalMapId * 2 + 1`（见 loaders/map.ts）
 */
export function readMapData(archives: LoadedArchives, globalMapId: number): Uint8Array {
  return archives.get('map.mkf').read(globalMapId * 2 + 1);
}

/**
 * 读取并解码一张地图的**底图**。
 *
 * @source map.mkf 资源号 `globalMapId * 2` —— 与结构数据成对
 *   （偶数底图、奇数结构），见 assets-pipeline 的 ground.ts。
 *
 * ⚠️ 底图与节点坐标**尚未对齐**（Q-GND-1）：节点 x/y 与底图像素不是
 *   同一个原点，八张图各自拟合出的偏移毫无规律。故本函数只负责解出
 *   图像，**不做任何位置换算**——对齐关系解出来之前，由调用方决定
 *   怎么摆，并且要让用户看得出这一层还没对齐。
 */
export async function loadGround(
  archives: LoadedArchives,
  globalMapId: number,
): Promise<ImageBitmap | null> {
  let data: Uint8Array;
  try {
    data = archives.get('map.mkf').read(globalMapId * 2);
  } catch {
    return null;
  }
  if (!isGround(data)) return null;

  const g = decodeGround(data);
  const rgba = new ImageData(g.width, g.height);
  rgba.data.set(g.rgba);
  return createImageBitmap(rgba);
}

// ============================================================
//  節日插画（側欄日曆那塊 200×200）
// ============================================================

/**
 * 解出一张節日插画。
 *
 * @source VA 0x00416baf 起：`節日那天整张盖掉季节底图` ——
 *   ```asm
 *   00416bf3  call 0x450441            ; read_mkf(Data.mkf, 资源号, 旧像素区, 0)
 *   00416c12  call 0x4563f5            ; 画在 (440, 280)
 *   ```
 *   资源号 = `HOLIDAY_ART_BASE[地图号] + 節日序号`（见 core 的 `holidayArtResource`）。
 *
 * ★ **这批资源没有 SPR/SMP 头**，整块就是 200×200 的 RGB555（恰好 80000 字节）。
 *   原版是**先备好一个 200×200 的 `graph_st`**（VA 0x00451a5a
 *   `allocate_graph_st(0xc8, 0xc8, 0, 0)` → `[0x48bdcc]`）再把资源读进它的像素区，
 *   所以尺寸来自调用方、不来自数据 —— 不能用 `parseSpriteSheet`（那要求有签名）。
 */
export function readHolidayArt(
  archives: LoadedArchives,
  globalMapId: number,
  holidayIndex: number,
): ImageData | null {
  const res = holidayArtResource(globalMapId, holidayIndex);
  if (res === null) return null;
  let data: Uint8Array;
  try {
    data = archives.get('Data.mkf').read(res);
  } catch {
    return null;
  }
  const n = HOLIDAY_ART_SIZE;
  if (data.length !== n * n * 2) return null;
  const img = decodeRaw555(n, n, data);
  return toImageData(img.width, img.height, img.rgba);
}

/** 同上，直接给出 ImageBitmap */
export async function loadHolidayArt(
  archives: LoadedArchives,
  globalMapId: number,
  holidayIndex: number,
): Promise<ImageBitmap | null> {
  const img = readHolidayArt(archives, globalMapId, holidayIndex);
  return img === null ? null : createImageBitmap(img);
}

// ============================================================
//  无头 RGB555 资源（尺寸由调用方给定）
// ============================================================

/**
 * 读一张**没有 SPR/SMP 头**的整块 RGB555 资源 —— 尺寸由**调用方**给定。
 *
 * @source 原版的做法：先 `allocate_graph_st(w, h, 0, 0)` 备好一块 `graph_st`，
 *   再 `read_mkf(档案, 资源号, 0, 0)` 把原始像素**原样读进它的像素区**，
 *   最后照常 blit。所以资源本身不带尺寸，尺寸只有调用点知道。
 *   · 節日插画（`Data.mkf`，200×200）：VA 0x00451a5a `allocate_graph_st(0xc8, 0xc8, 0, 0)`
 *   · 財神接金幣底图（`Panel.mkf` #92，640×480）：
 *     ```asm
 *     0041566b  push 0x5c                       ; ★ 资源号 = 92
 *     0041566d  mov  edx, dword [0x48a05c]      ; [0x48a05c] = Panel.mkf
 *     00415674  call 0x450441                   ; read_mkf(Panel.mkf, 92, 0, 0)
 *     0041567c  mov  dword [0x48bd38], eax      ; → 全局底图指针
 *     ```
 *     （`0x004155fc` 那支函数就是 `_rich4_ui_game_xicongtianjiang`。）
 *     640×480 是调用点定的：`Panel/0092.bin` 恰好 614400 字节 = 640×480×2。
 *     ⚠️ 它**不是**一条 `sprite()` 能取的资源 —— `manifest.json` 里没有它（D-MINI-1），
 *     故走这个出口，别去改 extract 管线。
 *
 * @param archive  档案名（如 `'Panel.mkf'`）
 * @param resource 资源号（如 92）
 * @param width    宽 —— **调用方给定，不来自数据**
 * @param height   高
 * @returns 解码好的图；资源不存在、或字节数不等于 `width*height*2` 时返回 `null`
 */
export function readRaw555Resource(
  archives: LoadedArchives,
  archive: ArchiveName,
  resource: number,
  width: number,
  height: number,
): ImageData | null {
  let data: Uint8Array;
  try {
    data = archives.get(archive).read(resource);
  } catch {
    return null;
  }
  // 尺寸对不上就宁可空着：这说明 w/h 猜错了（原版把尺寸写在调用点，没有第二处能核对）
  if (data.length !== width * height * 2) return null;
  const img = decodeRaw555(width, height, data);
  return toImageData(img.width, img.height, img.rgba);
}

/** 同上，直接给出 ImageBitmap */
/**
 * 取一个**原始字节**资源（不做任何解码）—— 给「每个像素就是一个 id」那类图用。
 *
 * ★ 2026-09-16 加（B-5/B-6）：通用金额窗那张**逐像素 id 图**是
 *   `Panel.mkf` #0x16 = 128×192 = 24576 字节，每像素一个钮号。
 *   它既不是 SPR 也不是 SMP（manifest 记 `signature: 'bin'`），
 *   `sprite()` 取不到；这张图就是命中判定的**真值**（重叠处靠它分）。
 *
 * @returns 资源原始字节；取不到（越界 / 空槽 / 长度不足）返回 `null`
 */
export function readRawBytes(
  archives: LoadedArchives,
  archive: ArchiveName,
  resource: number,
  minBytes = 0,
): Uint8Array | null {
  let data: Uint8Array | null = null;
  try {
    data = archives.get(archive).read(resource);
  } catch {
    return null;
  }
  if (data === null || data.length < minBytes) return null;
  return data;
}

export async function loadRaw555Resource(
  archives: LoadedArchives,
  archive: ArchiveName,
  resource: number,
  width: number,
  height: number,
): Promise<ImageBitmap | null> {
  const img = readRaw555Resource(archives, archive, resource, width, height);
  return img === null ? null : createImageBitmap(img);
}

// ============================================================
//  小游戏整屏底图（財神接金幣 = Panel.mkf #92）
// ============================================================

/** 財神接金幣那屏的底图资源号 —— `Panel.mkf` **#92** @source VA 0x0041566b `push 0x5c` */
export const MINIGAME_BG_RES = 0x5c;
/** 財神接金幣那屏的底图尺寸 @source `Panel/0092.bin` = 614400 字节 = 640×480×2 */
export const MINIGAME_BG_WIDTH = 640;
export const MINIGAME_BG_HEIGHT = 480;

/**
 * 財神接金幣（`specialKind 8 = 喜從天降`）那一屏的底图 —— `Panel.mkf` **#92**。
 *
 * @source VA 0x0041566b `push 0x5c` → `read_mkf(Panel.mkf, 0x5c, 0, 0)`
 *   （入口 `_rich4_ui_game_xicongtianjiang` VA 0x004155fc），
 *   载入后存在 `[0x48bd38]`、每帧原样贴到整屏。见 `docs/deviations/T-042-044.md` 的 D-MINI-1。
 */
export function readMinigameBackground(archives: LoadedArchives): ImageData | null {
  return readRaw555Resource(
    archives,
    'Panel.mkf',
    MINIGAME_BG_RES,
    MINIGAME_BG_WIDTH,
    MINIGAME_BG_HEIGHT,
  );
}

/** 同上，直接给出 ImageBitmap */
export async function loadMinigameBackground(
  archives: LoadedArchives,
): Promise<ImageBitmap | null> {
  const img = readMinigameBackground(archives);
  return img === null ? null : createImageBitmap(img);
}

// ============================================================
//  小地圖底图
// ============================================================

/**
 * 小地圖底图所在资源段的起点 —— `map.mkf` 资源 `(地图号 + 0x10)`。
 *
 * @source `_rich4_load_map` 的载入段（VA 0x00407fc0 起，文件
 *   `rich4-re/asm/rich4_load_map.asm:96`）：
 * ```asm
 * movsx eax, word [0x4991b6]     ; 地图号高位
 * shl   eax, 2
 * movsx edx, word [0x4991b8]     ; 地图号低位
 * add   eax, edx                 ; eax = 地图号（= [0x4991b6]×4 + [0x4991b8]）
 * add   eax, 0x10                ; ★ 资源号 = 地图号 + 0x10
 * push  eax / push ebx(map.mkf) / call read_mkf
 * mov   [0x48badc], eax
 * ```
 * 上一条命令载入的是 `(地图号)×2` 的底图、再一条是 `(地图号)×2` 的结构数据，
 * 与 `readMapData`/`loadGround` 那对**同一套地图号编码**，故这里可直接用
 * `globalMapId`。
 *
 * ★ **原版的这两张不是现缩的**：它们是预先算好的成品图。
 *   · 图 0 = 200×200 → 侧栏右下角那块（VA 0x00416e78 画在 (440, 侧栏顶)）
 *   · 图 1 = 400×400 → 独立小地图窗口（VA 0x0040a87f 画在 (20, 60)）
 *   所以侧栏小地图**不该**拿 `.gnd` 底图现缩 —— 缩放比例、取景范围都不同。
 */
export const MINIMAP_BG_RESOURCE_BASE = 0x10;

/** 侧栏那块 200×200 用图 0 @source VA 0x00416e78 `add eax, 0xc` */
export const MINIMAP_BG_IMAGE = 0;

/** 独立小地图窗口那块 400×400 用图 1 @source VA 0x0040a87f `add eax, 0x18` */
export const MINIMAP_BG_IMAGE_WINDOW = 1;

/**
 * 解出小地圖底图。
 *
 * @param image 图号 —— 侧栏用 `MINIMAP_BG_IMAGE`，独立窗口用 `MINIMAP_BG_IMAGE_WINDOW`
 */
export function readMinimapBackground(
  archives: LoadedArchives,
  globalMapId: number,
  image: number = MINIMAP_BG_IMAGE,
): ImageData | null {
  let data: Uint8Array;
  try {
    data = archives.get('map.mkf').read(globalMapId + MINIMAP_BG_RESOURCE_BASE);
  } catch {
    return null;
  }
  const sheet = parseSpriteSheet(data);
  if (sheet === null || image >= sheet.images.length) return null;
  const img = decodeImage(sheet, data, image, { colorKeyBlack: true });
  if (img.width === 0 || img.height === 0) return null;
  return toImageData(img.width, img.height, img.rgba);
}

/** 同上，但直接给出 ImageBitmap */
export async function loadMinimapBackground(
  archives: LoadedArchives,
  globalMapId: number,
): Promise<ImageBitmap | null> {
  const img = readMinimapBackground(archives, globalMapId);
  return img === null ? null : createImageBitmap(img);
}

// ============================================================
//  角色美术
// ============================================================

/**
 * 12 个角色的棋子与头像分别在哪个资源。
 *
 * ★ 由**资源的图数规律**推出并逐一目视核对：
 *   `Panel.mkf` 从 27 号起，资源以「多张 / 1 张 / 多张」三连出现——
 *   27(5) 28(1) 29(5) ｜ 30(5) 31(1) 32(5) ｜ 33(5) 34(1) 35(5) ｜ …
 *   一直排到 62，恰好 12 组。中间那个**只有 1 张**的是站立姿，
 *   两侧多张的是行走动画。
 *
 *   把 12 组的站立姿排成一行，与 `map.mkf` 27..38 的 12 张头像
 *   **顺序完全一致**（阿土伯、沙隆巴斯、忍者、錢夫人…直到最后的寶寶），
 *   两处独立的资源段能对上，故这个映射是可信的。
 *
 *   所有棋子的锚点都在**底边中心**（如 58×64 的锚点是 (29,63)），
 *   正是放到格子上该有的对齐方式（C-AST-6）。
 */
export const CHARACTER_COUNT = 12;

/**
 * 棋子（地图上那个小人）的资源起点。
 *
 * @source 载入函数 VA 0x0040b93b：
 * ```asm
 * 0040b954  mov al, byte [player + 0x13]   ; character
 * 0040b95a  edi = al
 * 0040b95c  edi = edi*4 + al               ; 5c
 * 0040b961  edi = edi*4 + al               ; 21c
 * 0040b966  add edi, 0x80                  ; ★ 资源号 = 128 + 21×character
 * ...      call 0x450441([0x48a0e4], edi + k, 0, 0)   ; [0x48a0e4] = Data.mkf
 * ```
 * 每个角色占 **21 个连续资源**，12 个角色 → `Data.mkf` 128..379。
 *
 * ★ 每个资源的图数都是 **8 的倍数**，因为棋子有**八个朝向**：
 * ```asm
 * 00408810  eax = [精灵集 + 4]          ; 图数
 * 0040881a  sar eax, 3                  ; 图数 / 8 = 每个朝向的帧数
 * 00408822  dl = player.direction       ; 世界朝向 0..7
 * 0040882d  ecx = 8 - [0x499088]        ; ★ 减去当前视角旋转
 * 00408835  edx = (dl + ecx) & 7        ; 屏幕朝向
 * 0040883f  mul byte [esp+0x54]         ; al = 每向帧数 × 屏幕朝向
 * 00408849  add al, ch                  ; + 当前帧
 * ```
 * 即 **图号 = 屏幕朝向 × (图数 / 8) + 帧号**。
 *
 * ⚠️ 先前本引擎用的是 `Panel.mkf` 28 + 3×character 那一张**正面站姿**，
 *   所以不管往哪走，小人永远面朝镜头。那批图是别处用的（每组 5/1/5 张，
 *   连 8 都除不尽），不是棋子。
 */
export const CHARACTER_SPRITE_BASE = 0x80;
export const CHARACTER_SPRITE_STRIDE = 21;

/**
 * 21 个资源里已经认出来的几个。
 *
 * ⚠️ 只有 0/1 是目视确认过的（渲染出来就是站立与九帧行走）。其余按
 *   「站立 8 张 / 行走 N×8 张 / 拿骰子 N×8 张」三个一组的规律推断，
 *   **没有逐个对照汇编**，故只在这里记录，代码暂时只用 0 和 1。见 Q-CHAR-1。
 *
 * | +k | 角色 0 的图数 | 看上去是 |
 * |---|---|---|
 * | 0 | 8 | 走路・站 |
 * | 1 | 72 | 走路・行走（9 帧） |
 * | 2 | 72 | 走路・手持骰子 |
 * | 3..5 | 8/32/32 | 機車 |
 * | 6..8 | 8/24/32 | 另一种载具 |
 * | 9..12 | 8/16/32/40 | 工程车 |
 * | 13..15 | 8/24/32 | 飛行器 |
 * | 16..17 | 8/72 | 走路（另一套） |
 * | 18 | 8 | 出局／墓碑位（@source 0x0040b9b7 `edi + 0x12`） |
 * | 19 | 8 | 白衣（住院？） |
 * | 20 | 8 | 條紋囚衣（坐牢） |
 */
export const CHARACTER_POSE = { stand: 0, walk: 1, dice: 2 } as const;

/**
 * 某个角色、某种**交通方式**的图组基号 —— 该组三个资源依次是 **站 / 走 / 手持骰子**。
 *
 * @source `_rich4_update_player_sprite` VA 0x0040bbd8：
 * ```asm
 * mov al, byte [player + 0x11]     ; ★ traffic_method
 * and al, 3
 * … eax = 3 × 交通方式
 * add edi, eax                     ; edi = 0x80 + 角色×21 + 3t
 * read_mkf(data_mkf, edi)          ; 站
 * read_mkf(data_mkf, edi + 1)      ; 走
 * read_mkf(data_mkf, edi + 2)      ; 手持骰子
 * ```
 * 于是：0 走路 → k0..2、1 機車 → k3..5、2 汽車 → k6..8、**3 船 → k9..11**。
 *
 * ★ 先前这里按「角色+姿态」取图（`0x80 + 角色×21 + 姿态`），**载具那些姿态取不到**
 *   —— 表格里 k3..12 被目测成「機車/另一种载具/工程车」，其实是四种交通方式各三张。
 */
export function characterSetBase(character: number, traffic: number): number {
  return CHARACTER_SPRITE_BASE + character * CHARACTER_SPRITE_STRIDE + (traffic & 3) * 3;
}


/**
 * 世界朝向 → 屏幕朝向。
 * @source 0x0040882d `ecx = 8 - [0x499088]` / `edx = (dir + ecx) & 7`
 */
export function screenDirection(direction: number, view: number): number {
  return (direction + 8 - (view % 8)) & 7;
}

/**
 * 八向精灵里第几张图。
 * @source 0x0040883f `图号 = 屏幕朝向 × (图数 / 8) + 帧号`
 */
export function directionalImage(imageCount: number, screenDir: number, frame: number): number {
  const per = Math.max(1, imageCount >> 3);
  return screenDir * per + (frame % per);
}

/** 角色头像 —— `map.mkf` 资源号，7 张表情，取第 0 张即可 */
export function portraitResource(character: number): number {
  return 27 + character;
}

// ============================================================
//  開局設定屏（選角色／選地圖）—— 全部在 jump.mkf 里
// ============================================================

/**
 * 開局設定屏用到的资源（全部在 `jump.mkf`）。
 *
 * @source `_rich4_init_new_game` VA 0x00406e93 起：
 * ```asm
 * push "JUMP.MKF"                / call load_mkf            → [0x48a3b0]
 * read_mkf(jump, 舞台×4 + 地图)                              → 0x48a358（整屏场景）
 * read_mkf(jump, 8)                                          → 0x48a3b8（这一屏的拼件表）
 * read_mkf(Data, 2)                                          → 0x48a3c0（12 张头像）
 * ```
 * ★ **场景图号 = `舞台×4 + 地图`，与 `readMapData`/`loadGround` 同一套地图号编码**，
 *   所以两个舞台八张地图（TAIWAN/CHINA/JAPAN/U.S.A 与
 *   STAR/ANCIENT/DINOSAUR/ISLAND）在这里就是 `globalMapId` 本身。
 */
export function setupSceneResource(globalMapId: number): number {
  return globalMapId;
}

/** 開局設定屏那一批拼件所在的资源 —— `jump.mkf` 资源 8，共 22 张 */
export const SETUP_UI_RESOURCE = 8;

/**
 * 资源 8 里各张的用途（尺寸取自实解，用途取自 xref）。
 *
 * | 图 | 尺寸 | 用途 |
 * |---|---|---|
 * | 0 | 440×155 | 角色格底图（6×2 蓝黄交替格，格子带金边） |
 * | 1 / 21 | 192×461 | 右侧竖栏整图 —— **舞台 0 / 舞台 1** 各一张（地图名烧在图里） |
 * | 2 / 3 | 80×40 | `OK` / `EXIT` 两颗按钮的**按下图** |
 * | 4 | 24×25 | 下拉那条蓝三角的**按下图**（黄三角） |
 * | 5 | 42×71 | 三行下拉浮窗底图（遊戲人數／行進方式） |
 * | 6 | 67×140 | 六行下拉浮窗底图（總資金／土地權限／遊戲時間） |
 * | 7 | 87×140 | 六行下拉浮窗底图（勝利條件，数值最长） |
 * | 8 | 27×25 | ★ 地图行上那个**红勾**，锚点 (0,0) |
 * | 9 | 50×52 | 压在一个**头像**正中的红叉（锚点在正中），标记该角色已出局 |
 * | 10 | 27×27 | （本屏未用，锚点在正中） |
 *
 * ⚠️ **表项从 +0xc 起、每条 12 字节**，所以「图 n」= `a3b8 + 0xc + n×12`：
 * `a3b8 + 0x6c` = 图 **8**、`a3b8 + 0x3c` = 图 **4**、`a3b8 + 0x78` = 图 **9**。
 * 先前把 `0x6c` 当成「9×12」而取了图 9 —— 差一位，红勾于是落不到勾选框里。
 *
 * @source 竖栏整图 `VA 0x00406ff6`：`图号 = 舞台×20 + 1`（舞台 0→1、舞台 1→21）
 * @source 下拉浮窗底图 `VA 0x0046ccb8`：`[5, 6, 5, 6, 6, 7]`
 * @source 红勾 `VA 0x0040560d`、下拉三角 `VA 0x004054b5`、头像上的红叉 `VA 0x004042e0`
 */
export const SETUP_UI = {
  board: 0,
  okDown: 2,
  exitDown: 3,
  arrowDown: 4,
  popup3: 5,
  popup6: 6,
  popup6w: 7,
  tick: 8,
  characterOut: 9,
} as const;

/** 右侧竖栏整图的图号 —— 两个舞台各一张 @source VA 0x00406ff6 */
export function setupPanelImage(stage: number): number {
  return stage * 20 + 1;
}

/** 角色头像所在资源 @source `read_mkf(Data.mkf, 2)` VA 0x00406fcd */
export const SETUP_PORTRAIT_RESOURCE = 2;

/**
 * 开局设定屏里那个**侧视走动小人**的图号。
 *
 * @source `_rich4_select_nth_player` VA 0x00404d55：
 * ```asm
 * eax = 角色×3 + [0x46cb44]（行进方式）
 * read_mkf(jump, eax + 9)          ; ← 资源 9..44 = 12 角色 × 3 载具
 * ```
 * ★ 这一批**不是**棋盘上那个八向棋子（那是 `Data.mkf` 0x80+…），
 *   是 `jump.mkf` 9..44 的侧视图组，只在这一屏用。
 */
export function setupWalkResource(character: number, vehicle: number): number {
  return 9 + character * 3 + (vehicle & 3);
}

/**
 * 资源 9..44 各自的**帧数**（12 角色 × 3 载具，按 `角色×3 + 载具` 排）。
 *
 * 原版是从资源头里读图数（`mov eax, [资源+4]`，见 `VA 0x00405e5f`），
 * 这里由 `jump.mkf` 实解抄下来 —— 引擎的取图接口只给单帧，拿不到总数。
 */
export const SETUP_WALK_FRAMES: readonly number[] = [
  20, 10, 8, 20, 10, 8, 7, 11, 9, 20, 11, 11, 20, 10, 8, 11, 11, 11, 21, 11, 9, 20, 11, 11, 10,
  11, 11, 20, 11, 11, 20, 10, 8, 18, 11, 21,
];

/** 某个角色、某种行进方式的走动帧数 @source 同上表 */
export function setupWalkFrames(character: number, vehicle: number): number {
  return SETUP_WALK_FRAMES[character * 3 + (vehicle & 3)] ?? 1;
}

/** 开局设定屏那一整屏场景：**没有 SPR/SMP 头**，整块就是 640×480 的 RGB555 */
export const SETUP_SCENE_W = 640;
export const SETUP_SCENE_H = 480;
export const SETUP_SCENE_BYTES = SETUP_SCENE_W * SETUP_SCENE_H * 2;

/**
 * 解一屏开局设定屏的背景场景。
 *
 * @source `_rich4_init_new_game` VA 0x00406e93 起：
 * ```asm
 * read_mkf(jump, 舞台×4 + 地图, buf = 0x48a358)     ; 原始像素
 * fcn_004552b7(0x48a354, 0x48a358, 0x96000, -0x10)  ; ★ 逐像素过一遍换算表
 * ```
 * 那张表 @ 0x485d68 −16×32 = `[0,0,1,1,2,2,3,3,…]` —— 每个 5 位分量**除以 2**，
 * 也就是**整屏压到一半亮度**（否则上面那些面板字看不清）。
 * 换地图时同一段再跑一次（`VA 0x0040564d`）。
 */
export function decodeSetupScene(data: Uint8Array): Uint8ClampedArray | null {
  if (data.length < SETUP_SCENE_BYTES) return null;
  const count = SETUP_SCENE_W * SETUP_SCENE_H;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // 先把「除以 2」落到 5 位分量上，再交给管线那把裸 555 解码器展开 ——
  // 展开口径（`expand5`）与全项目一致，不另起一套。
  const halved = new Uint8Array(SETUP_SCENE_BYTES);
  const out = new DataView(halved.buffer);
  for (let p = 0; p < count; p++) {
    const v = view.getUint16(p * 2, true);
    const half = ((((v >> 10) & 31) >> 1) << 10) | ((((v >> 5) & 31) >> 1) << 5) | ((v & 31) >> 1);
    out.setUint16(p * 2, half, true);
  }
  return decodeRaw555(SETUP_SCENE_W, SETUP_SCENE_H, halved).rgba;
}

/** 读一屏开局设定屏的场景（解不出来返回 null） */
export async function loadSetupScene(
  archives: LoadedArchives,
  globalMapId: number,
): Promise<ImageBitmap | null> {
  let data: Uint8Array;
  try {
    data = archives.get('jump.mkf').read(setupSceneResource(globalMapId));
  } catch {
    return null;
  }
  const rgba = decodeSetupScene(data);
  if (rgba === null) return null;
  const image = new ImageData(SETUP_SCENE_W, SETUP_SCENE_H);
  image.data.set(rgba);
  return createImageBitmap(image);
}

// ============================================================
//  特殊格装饰
// ============================================================

/**
 * 特殊格的装饰图都在 `map.mkf` 资源 24（共 58 张）。
 *
 * ★ 节点的 `decorIndex` 就是**这 58 张里的 1 基下标**——
 *   全部八张地图上 `decorIndex` 的最大值恰好是 58，与图数严丝合缝。
 *
 *   图是**成对**排列的，**按 `decorIndex`（1 基）说**：
 *   **奇数是普通样式，偶数是外圈带粉色光环的样式**（`decorIndex − 1` 才是 0 基图号，
 *   所以「光环款」对应的图号反而是偶数）。
 *   —— ★ 2026-09-16 订正（Q13）：先前这里把奇偶写反了。判据：逐张渲染 58 张图目视 +
 *   八张地图的取值分布（地图 0/1/2/3/5/6/7 只用 0 与奇数=**无光环款**；
 *   星座图（地图 4）全部取偶数 4..34=**粉红光环款**）+ `map.mkf` 资源 24 的 SMP 头自洽
 *   （58 条 `gsize = w*h*2`、Σgsize == 文件尾）。见 `docs/map-format.md` §3.4
 *   与 `known-deviations.md` 的 Q-SPRITE-1。
 *   多数特殊格取 `decorIndex ∈ {种类×2−1, 种类×2}` 这一对中的一个，
 *   逐对对上了截图里的图案：
 *
 *   | 图对 | 图案 | 对应 specialKind |
 *   |---|---|---|
 *   | 0/1 | PARK | 1 公園 |
 *   | 2/3 | NEWS | 2 新聞 |
 *   | 4/5 | 藍色問號 | 3 命運 |
 *   | 6/7 | 鐵欄杆 | 4 監獄 |
 *   | 8/9 | 紅十字 | 5 醫院 |
 *   | 10..15 | 三种 GAME | 6/7/8 三个小游戏 |
 *   | 16/17 | 樂透彩球 | 9 樂透 |
 *   | 18..23 | $50 / $30 / $10 | 10/11/12 點數 |
 *   | 24/25 | CARD | 13 卡片 |
 *   | 26/27 | BANK | 14 銀行 |
 *   | 28/29 | On sale ITEM | 15 百貨公司 |
 *   | 30/31 | 六芒星 | 16 魔法屋 |
 *   | 37..57 | 行星与星座 | 12（星座/行星格与點數共用种类号） |
 *
 *   锚点在图**正中**（124×92 的锚点是 (62,46)），即对齐到格心。
 */
export const DECOR_RESOURCE = 24;

/** 节点的 `decorIndex` → 资源 24 里的图号；0 表示无装饰 */
export function decorImageIndex(decorIndex: number): number | null {
  return decorIndex > 0 ? decorIndex - 1 : null;
}

// ============================================================
//  地块建筑
// ============================================================

/**
 * 地块建筑的资源号与图号。
 *
 * ★ 完全来自原版：地图加载代码 VA 0x00407e0b 一次性载入 5 个等级的图集——
 * ```asm
 * esi = game_stage*4 + game_map          ; global_map_id
 * for (ebx = 0; ebx < 5; ebx++) {
 *     eax = esi*5 + ebx + 0x27           ; ★ = global_map_id*5 + 等级 + 39
 *     [0x48ae4c + ebx*4] = load(map.mkf, eax)
 * }
 * ```
 * 而地块绘制代码（VA 0x004091df）按等级取图集：
 * ```asm
 * cmp byte [land + 0x1a], 0     ; level
 * je  空地分支                   ; ★ 等级 0 不画建筑
 * …
 * eax = byte [land + 0x1a]
 * eax = [0x48ae48 + eax*4]      ; ★ 注意基址是 0x48ae48，比装载基址少 4
 * ```
 * 两处一联立即得：**等级 L（1..5）→ 资源号 `地图×5 + (L−1) + 39`**。
 * 这正好解释了先前观察到的「资源 39 起每 5 个一组、组内高度递增」
 * ——那是同一张地图的五级建筑（空地→店铺→楼→塔→摩天楼）。
 *
 * 图号则是**朝向**（VA 0x004091af）：
 * ```asm
 * al = byte [land + 0x1b]       ; 地块朝向
 * al += byte [0x499088]         ; 当前视角旋转
 * dl = 8 - al ; dl &= 7         ; → 图号 0..7
 * ```
 * 这解释了每个建筑资源为何恰好 8 张图。
 */
export const BUILDING_RESOURCE_BASE = 0x27; // 39
export const BUILDING_LEVELS = 5;

/** 某张地图某个等级的建筑资源号；等级 0（空地）没有建筑 */
export function buildingResource(globalMapId: number, level: number): number | null {
  if (level < 1 || level > BUILDING_LEVELS) return null;
  return globalMapId * BUILDING_LEVELS + (level - 1) + BUILDING_RESOURCE_BASE;
}

/**
 * 建筑朝向 → 图号。
 * @source `dl = 8 - (facing + rotation); dl &= 7`
 */
export function buildingImageIndex(facing: number, viewRotation = 0): number {
  return (8 - (facing + viewRotation)) & 7;
}

/**
 * **空地归属标记** —— 买了地还没盖房（等级 0）时，在格子上画该玩家的专属 logo。
 *
 * @source VA 0x0040920f（地块绘制的「等级 0」分支）：
 * ```asm
 * 0040920f  byte [esi + 0x48a852] = 0xff      ; 归属标记
 * 00409216  cmp  byte [ebp + 0x19], 0         ; land.owner == 0 ?
 * 0040921a  je   不画                          ; 无主就什么都不画
 * 0040921c  eax = [0x48aea8]                   ; ★ logo 所在的精灵档
 * 00409227  al  = land.owner
 * 0040922c  eax = (owner - 1) * 0x68           ; 玩家结构大小 0x68
 * 00409230  al  = byte [player + 0x13]         ; ★ 图号 = 该玩家的 character
 * ```
 * 而 `[0x48aea8]` 的来处在 `rich4_load_map.asm:477`：
 * ```asm
 * 00407f68  push 0x19 / push edi / call 0x450441   ; ★ 资源号 25，从 map.mkf 读
 * ```
 *
 * 实测 `map.mkf` 资源 25 是 **12 张 SPR**，正好一个角色一张，且与需求方举的例子
 * 逐一吻合：約翰喬=牛仔帽、沙隆巴斯=石油桶、錢夫人=钻石。
 */
export const EMPTY_LAND_LOGO_RESOURCE = 25;

/**
 * 「特殊类型」地块（`land.type != 0`，即连锁店）另有一张图集。
 * @source VA 0x00407e48：资源号 = `global_map_id + 0x4f`（79）
 */
export function chainStoreResource(globalMapId: number): number {
  return globalMapId + 0x4f;
}

/**
 * 上市企业与特殊景观的精灵：两者共用一套编号。
 *
 * @source 地图加载 VA 0x00407ee4（企业，索引在 `commercial + 0x20`）
 *         与 VA 0x00407f35（景观，索引在 `landscape + 0x1a`）：
 * ```asm
 * ax = word [记录 + 偏移]
 * test ax, ax / je 跳过        ; 0 表示没有图
 * load(map.mkf, ax + 0x26)     ; ★ 资源号 = 索引 + 38
 * ```
 * 实测八张地图的索引落在 134..255，对应资源 172..293，
 * 与建筑（39..86）不重叠。
 */
export const SCENERY_RESOURCE_BASE = 0x26; // 38

/** 企业/景观的精灵索引 → 资源号；索引 0 表示没有图 */
export function sceneryResource(spriteIndex: number): number | null {
  return spriteIndex > 0 ? spriteIndex + SCENERY_RESOURCE_BASE : null;
}

/**
 * 设施（機場/港口等）的精灵。
 *
 * @source 地图加载 VA 0x00407e71 载入 **17 个**资源到 `0x48ae64` 起的数组：
 * ```asm
 * if (game_stage == 0)  base = 0x57            ; 87
 * else                  base = game_map*17 + 0x68   ; 104 + 地图×17
 * for (i = 0; i < 0x11; i++) [0x48ae64 + i*4] = load(map.mkf, base + i)
 * ```
 * 绘制时按 `facility.type` 走一张 5 路跳转表（VA 0x00409412），
 * 把这 17 个槽分成三段：
 *
 * | type | 取槽 |
 * |---|---|
 * | 0 | 槽 0 |
 * | 1 | 槽 `level` |
 * | 2 | 槽 `5 + level` |
 * | 3 | 槽 11 |
 * | 4 | 槽 `11 + level` |
 *
 * 5 + 6 + 6 = 17，正好分完。
 *
 * ⚠️ 实测地图数据里 `facility.type` **恒为 0**（见 known-deviations 的
 *   Q-FAC-1），故目前只会用到槽 0。其余分支照抄备用。
 */
export function facilitySheetBase(gameStage: number, gameMap: number): number {
  return gameStage === 0 ? 0x57 : gameMap * 17 + 0x68;
}

/** 设施的槽号 —— 见 `facilitySheetBase` 的表 */
export function facilitySlot(type: number, level: number): number {
  switch (type) {
    case 1:
      return level;
    case 2:
      return 5 + level;
    case 3:
      return 11;
    case 4:
      return 11 + level;
    default:
      return 0;
  }
}

// ============================================================
//  顶部工具栏
// ============================================================

/**
 * 顶部工具栏在 `Panel.mkf` 资源 1。
 *
 * ★ 由资源形状认出来的，并与游戏截图逐个对上：
 *   - 图 0 是 **439×40 的底条**
 *   - 图 1..11 是 **11 个图标**（常态）
 *   - 图 12..22 是同样 11 个图标的**按下态**（尺寸略大）
 *
 *   顺序与截图完全一致：? / 電腦 / 燈泡 / 紅存檔 / 綠存檔 / 格子 /
 *   放大鏡 / 槌子 / CARD / SALE! / 走勢圖。
 *
 * ★ **十一颗按钮的功能已全部定死**（见 docs/original-screens.md 第 0 节）。
 *   前三颗由需求方直接给出（遊戲百科／遊戲設定／託管AI），其余由
 *   **实机截图 + 熱鍵表闭合验证**：
 *
 *   熱鍵表 `0x474abc` 下标 12..24 正好是十三条「开某一屏」的键；
 *   去掉其中两条「地圖向左／向右旋轉」（那两颗在**小地圖左上角**，
 *   不在工具列里），剩下**恰好十一条**，与十一颗按钮一一对上，
 *   顺序基本是热键表的倒序。十一比十一、无一多余。
 */
export const TOOLBAR_RESOURCE = 1;
export const TOOLBAR_STRIP_IMAGE = 0;
export const TOOLBAR_ICON_COUNT = 11;

/** 第 i 个图标的图号（常态 / 按下态） */
export function toolbarIconImage(i: number, pressed = false): number {
  return 1 + i + (pressed ? TOOLBAR_ICON_COUNT : 0);
}

/**
 * 各按钮的名字 —— **与熱鍵表 `HOTKEY_NAMES` 的同名条目是同一个功能**，
 * 故这里用熱鍵表的原文（那是 exe 里的字串），不再自己起名。
 */
export const TOOLBAR_LABELS: readonly string[] = [
  '遊戲百科',   // 黄底红问号   ← 熱鍵「輔助說明」
  '遊戲設定',   // 電腦顯示器   ← 熱鍵「系統」   （不是「電腦托管」）
  '託管AI',     // 黄燈泡       ← 熱鍵「託管」   （Data.mkf #77，入口 VA 0x0041e345）
  '讀取進度',   // 紅色磁碟片   ← 熱鍵「LOAD GAME」
  '儲存進度',   // 綠色磁碟片   ← 熱鍵「SAVE GAME」
  '大地圖',     // 黄色格子地圖 ← 熱鍵「地圖」
  '個人資產表', // 放大鏡       ← 熱鍵「查詢」
  '道具欄',     // 槌子         ← 熱鍵「道具」
  '卡片欄',     // CARD 三色卡  ← 熱鍵「卡片」
  '公佈欄',     // SALE? 房子   ← 熱鍵「交易」
  '股市',       // 走勢圖       ← 熱鍵「股市」
];

/**
 * 缓存淘汰下来的精灵的**延迟释放**队列（Q-PERF-1）。
 *
 * ## 为什么不能就地 `close()`
 *
 * `SpriteCache` 的 LRU 只把条目移出它自己那张表 —— 真正握着 `ImageBitmap`
 * 的是渲染器的 `#ready`（绘制时直接用 `sprite.bitmap`）。所以淘汰时必须有人
 * 把渲染器那份引用也丢掉，否则内存一点不降（这正是 Q-PERF-1 的症状）。
 *
 * 但**也不能在收到淘汰回调的那一刻就 close**：那个位图可能正被本帧画着，
 * `drawImage` 拿到已关闭的位图会画成空白。淘汰回调发生在**解码完成后的微任务**里
 * （`#sprites.get(...).then(...)`），也就是两帧之间 —— 于是安全的分界点很清楚：
 *
 *   · **淘汰发生时**：只从 `#ready` 摘掉引用并排进本队列 —— 下一帧起不再画它；
 *   · **下一帧的绘制开始时**（`BoardRenderer.draw` 的**第一件事**）：才真正 `close()`。
 *     此刻上一帧的 rAF 回调早已整个跑完（画布上的 `drawImage` 是同步落地的），
 *     队列里每一张都确定「不会再被任何一帧用到」。
 *
 * 反过来说：**只要 close 发生在 draw 之内或之前**（而不是之后），就一定安全；
 * 放在 draw 末尾同样安全，选开头只是因为那时语义最直白 ——「上一帧画完了」。
 */
export class DeferredSpriteClose {
  readonly #queue: Sprite[] = [];

  /**
   * 淘汰回调的落点：把这个精灵从持有者的表里摘掉并排队等帧边界。
   *
   * ★ 返回 0（**不排队**）也是一种正常结果：本渲染器「从没画过它」，
   *   说明它是**别的持有者**（`hud.ts` 也有一张 `#ready`）在用。那种精灵
   *   一律不动 —— 见 Q-PERF-1 的「还剩什么没解」。
   *
   * @returns 摘掉了几条缓存键（= 这个渲染器持有它的证据）
   */
  retire(ready: Map<string, Sprite | null>, sprite: Sprite): number {
    let removed = 0;
    for (const [key, held] of ready) {
      if (held === sprite) {
        ready.delete(key);
        removed++;
      }
    }
    if (removed > 0) this.#queue.push(sprite);
    return removed;
  }

  /** 帧边界：真正关掉位图。返回释放了几张 */
  drain(): number {
    const n = this.#queue.length;
    for (const sprite of this.#queue) sprite.bitmap.close();
    this.#queue.length = 0;
    return n;
  }

  /** 已摘掉引用、等着帧边界释放的张数（诊断用） */
  get pending(): number {
    return this.#queue.length;
  }
}
