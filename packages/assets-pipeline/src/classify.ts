/*
 * 素材分类器 —— UI / 地形 tile / 角色精灵 / 背景大图 / 字体
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 分类决定超分策略（DEVELOPMENT_PLAN §6 步骤 2「分类处理策略」，
 * 不可一刀切）：
 *
 * | 类型            | 方法                                   |
 * | 角色精灵/动画帧 | Real-ESRGAN anime 模型 4×              |
 * | 地形 tile/背景  | Real-ESRGAN 通用模型，tile 需接缝处理  |
 * | UI 面板/按钮    | 优先矢量重绘（SVG/CSS），效果远好于超分 |
 * | 中文字体        | 直接换高清字体，不做超分               |
 *
 * 每条规则是一个**纯函数**（`AssetEntry → AssetCategory | null`，
 * null 表示「这条管不着」），`classifyAsset` 按优先级取第一个
 * 非空结果，都不中则为 'ui'。
 */

/** 素材类别 —— 与开发计划分类表一一对应 */
export type AssetCategory = 'ui' | 'tile' | 'sprite' | 'background' | 'font';

/** 分类器的输入条目（REQ-11.1） */
export interface AssetEntry {
  /** 归档名（'Panel' 或 'Panel.mkf' 都行，内部归一化） */
  archive: string;
  /** 资源号（chunk 下标） */
  index: number;
  /** 图宽 / 图高 */
  w: number;
  h: number;
  /** 锚点（graph_info 的 x/y，仅记录，不参与分类） */
  x: number;
  y: number;
  /** 同一张 sprite sheet 的帧数（meta.json 的 nimages） */
  frames: number;
  /**
   * 调色板/来源种类：'spr'（8bpp 调色板）/ 'smp'（16bpp RGB555）/
   * 'gnd'（地形数据）/ 'font'（字形）。由解包侧按签名给出。
   */
  paletteKind: string;
}

/** 归一化归档名：去路径、去 .mkf 后缀、转小写 */
export function archiveName(archive: string): string {
  const base = archive.replace(/^.*[/\\]/, '').replace(/\.mkf$/i, '');
  return base.toLowerCase();
}

// ============================================================
//  规则 1：档案名 —— UI 面板归档直接归 ui
// ============================================================

/** UI 面板归档：按钮/边框/对话框皮肤全在这里 @source DEVELOPMENT_PLAN §6 */
export const UI_ARCHIVES: readonly string[] = ['panel'];

export function byArchiveName(e: AssetEntry): AssetCategory | null {
  return UI_ARCHIVES.includes(archiveName(e.archive)) ? 'ui' : null;
}

// ============================================================
//  规则 2：尺寸 —— GND 32×32 → tile；≥640×480 → background
// ============================================================

/** 地形 tile 的边长 @source ground.ts 的 GND 布局（32×32 tile） */
export const TILE_SIZE = 32;

/** 背景大图的判定尺寸（原版全屏图恰为 640×480） */
export const BACKGROUND_MIN_WIDTH = 640;
export const BACKGROUND_MIN_HEIGHT = 480;

/** 是否 GND（地形）来源：paletteKind 标了 'gnd'，或来自 map 归档 */
export function isGroundSourced(e: AssetEntry): boolean {
  return e.paletteKind === 'gnd' || archiveName(e.archive) === 'map';
}

export function bySize(e: AssetEntry): AssetCategory | null {
  // 32×32 且来自 GND → 地形 tile（超分后要做接缝检查）
  if (e.w === TILE_SIZE && e.h === TILE_SIZE && isGroundSourced(e)) return 'tile';
  // ≥ 640×480 → 全屏背景大图（倍率不宜再高，见 upscale.ts 的 large 批）
  if (e.w >= BACKGROUND_MIN_WIDTH && e.h >= BACKGROUND_MIN_HEIGHT) return 'background';
  return null;
}

// ============================================================
//  规则 3：帧数 > 1 → 角色精灵/动画帧
// ============================================================

export function byFrames(e: AssetEntry): AssetCategory | null {
  return e.frames > 1 ? 'sprite' : null;
}

// ============================================================
//  规则 4：字形 → font
// ============================================================

/** 字形归档名集合（本作的解包归档里没有独立字形档案，留作数据驱动） */
export const FONT_ARCHIVES: readonly string[] = ['font', 'fonts'];

export function byFont(e: AssetEntry): AssetCategory | null {
  if (e.paletteKind === 'font') return 'font';
  return FONT_ARCHIVES.includes(archiveName(e.archive)) ? 'font' : null;
}

// ============================================================
//  优先级链
// ============================================================

/** 规则链，按优先级排列；每条返回 null 表示「管不着」 */
export const CATEGORY_RULES: readonly ((e: AssetEntry) => AssetCategory | null)[] = [
  byArchiveName,
  bySize,
  byFrames,
  byFont,
];

/**
 * 给一张素材分类。都不命中时归 'ui' —— 小图标/元件按开发计划
 * 「人工检查，糊的手工修」，与 UI 同一处理路径。
 */
export function classifyAsset(e: AssetEntry): AssetCategory {
  for (const rule of CATEGORY_RULES) {
    const c = rule(e);
    if (c !== null) return c;
  }
  return 'ui';
}
