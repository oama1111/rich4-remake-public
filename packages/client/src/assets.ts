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

  /**
   * 取一张精灵；资源或图号不存在时返回 null 而不是抛错。
   *
   * `colorKeyBlack` 用于叠在地图上的 SMP 图（特殊格装饰等）——
   * 见 assets-pipeline 的 `DecodeOptions`。
   */
  async get(
    archive: ArchiveName,
    resource: number,
    index: number,
    colorKeyBlack = false,
  ): Promise<Sprite | null> {
    const key = `${archive}:${resource}:${index}:${colorKeyBlack ? 'k' : ''}`;
    const hit = this.#sprites.get(key);
    if (hit !== undefined) return hit;

    const sheet = this.#sheetOf(archive, resource);
    const data = this.#bytesOf(archive, resource);
    if (sheet === null || data === null || index >= sheet.images.length) {
      this.#sprites.set(key, null);
      return null;
    }

    const img = decodeImage(sheet, data, index, { colorKeyBlack });
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

/** 角色的站立棋子 —— `Panel.mkf` 资源号 */
export function tokenResource(character: number): number {
  return 28 + character * 3;
}

/** 角色的行走动画 —— 两个方向各一组 */
export function walkResources(character: number): [number, number] {
  return [27 + character * 3, 29 + character * 3];
}

/** 角色头像 —— `map.mkf` 资源号，7 张表情，取第 0 张即可 */
export function portraitResource(character: number): number {
  return 27 + character;
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
 *   图是**成对**排列的：偶数号是普通样式，奇数号是外圈带粉色光环的样式。
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
 * ⚠️ 每个按钮**具体做什么**没有全部查证：名字是按图标外观叫的，
 *   只有几个能从别处推出来。故 UI 上点了没实现的只记一条日志，
 *   不假装有功能。
 */
export const TOOLBAR_RESOURCE = 1;
export const TOOLBAR_STRIP_IMAGE = 0;
export const TOOLBAR_ICON_COUNT = 11;

/** 第 i 个图标的图号（常态 / 按下态） */
export function toolbarIconImage(i: number, pressed = false): number {
  return 1 + i + (pressed ? TOOLBAR_ICON_COUNT : 0);
}

/**
 * 各按钮的名字。
 * ⚠️ 按图标外观命名，**不是**从 exe 里读到的字符串。
 */
export const TOOLBAR_LABELS: readonly string[] = [
  '說明',
  '電腦托管',
  '提示',
  '讀取進度',
  '儲存進度',
  '地圖',
  '查看',
  '設定',
  '卡片',
  '拍賣',
  '走勢圖',
];
