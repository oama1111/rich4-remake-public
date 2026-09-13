/*
 * 运行时素材加载
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 复用 `@rich4/assets-pipeline` 的解码器。
 *   那几个模块（mkf / mkf-decompress / sprite）只操作 Uint8Array，
 *   不碰 node:fs，故浏览器里可以直接用——解包逻辑只有一份，
 *   不存在「Node 一套、浏览器一套」的漂移风险。
 */

import { MkfArchive, parseSpriteSheet, type SpriteSheet } from '@rich4/assets-pipeline';
import { decodeImage, decodeGround, isGround } from '@rich4/assets-pipeline';

/** 原版的资源档案 */
export const ARCHIVES = ['Data.mkf', 'Panel.mkf', 'map.mkf', 'jump.mkf'] as const;
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

/** 一张解码好、可直接 drawImage 的图 */
export interface Sprite {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** 绘制锚点 —— 原版精灵以此对齐，超分后需同步缩放（C-AST-6） */
  anchorX: number;
  anchorY: number;
}

/**
 * 精灵缓存。
 *
 * 一张地图上重复出现的图素（地块、建筑、装饰）成百上千，
 * 每次重绘都重新解码会直接拖垮帧率，故按 `档案:资源:图号` 缓存。
 */
export class SpriteCache {
  readonly #archives: LoadedArchives;
  readonly #sheets = new Map<string, SpriteSheet | null>();
  readonly #sprites = new Map<string, Sprite | null>();
  readonly #bytes = new Map<string, Uint8Array | null>();

  constructor(archives: LoadedArchives) {
    this.#archives = archives;
  }

  /** 资源解出的原始字节，按需缓存——解压不便宜 */
  #bytesOf(archive: ArchiveName, resource: number): Uint8Array | null {
    const key = `${archive}:${resource}`;
    const hit = this.#bytes.get(key);
    if (hit !== undefined) return hit;
    let data: Uint8Array | null = null;
    try {
      data = this.#archives.get(archive).read(resource);
    } catch {
      // 资源号越界或该槽为空——原版档案里空槽很常见，不是错误
      data = null;
    }
    this.#bytes.set(key, data);
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

  /** 取一张精灵；资源或图号不存在时返回 null 而不是抛错 */
  async get(archive: ArchiveName, resource: number, index: number): Promise<Sprite | null> {
    const key = `${archive}:${resource}:${index}`;
    const hit = this.#sprites.get(key);
    if (hit !== undefined) return hit;

    const sheet = this.#sheetOf(archive, resource);
    const data = this.#bytesOf(archive, resource);
    if (sheet === null || data === null || index >= sheet.images.length) {
      this.#sprites.set(key, null);
      return null;
    }

    const img = decodeImage(sheet, data, index);
    if (img.width === 0 || img.height === 0) {
      this.#sprites.set(key, null);
      return null;
    }

    // 先按尺寸建 ImageData 再 set —— 直接把解码出的数组传进构造函数
    // 会因 ArrayBufferLike 与 ImageDataArray 的类型差异被拒。
    const rgba = new ImageData(img.width, img.height);
    rgba.data.set(img.rgba);
    const sprite: Sprite = {
      bitmap: await createImageBitmap(rgba),
      width: img.width,
      height: img.height,
      anchorX: img.anchorX,
      anchorY: img.anchorY,
    };
    this.#sprites.set(key, sprite);
    return sprite;
  }

  /** 已缓存的精灵数——用于诊断 */
  get size(): number {
    return this.#sprites.size;
  }
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
