/*
 * 素材分类器验证 —— 每类至少两个样本（T-060）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  archiveName,
  byArchiveName,
  byFont,
  byFrames,
  byGroundSource,
  bySize,
  classifyAsset,
  isGroundSourced,
  type AssetEntry,
} from './classify.ts';

const entry = (over: Partial<AssetEntry> = {}): AssetEntry => ({
  archive: 'Data',
  index: 0,
  w: 64,
  h: 64,
  x: 0,
  y: 0,
  frames: 1,
  paletteKind: 'smp',
  ...over,
});

describe('归档名归一化', () => {
  it('去路径、去 .mkf、转小写', () => {
    expect(archiveName('Panel.mkf')).toBe('panel');
    expect(archiveName('Rich4/Panel.mkf')).toBe('panel');
    expect(archiveName('MAP.MKF')).toBe('map');
    expect(archiveName('Data')).toBe('data');
  });
});

describe('规则 1：档案名 → ui', () => {
  it('Panel 归档是 ui', () => {
    expect(byArchiveName(entry({ archive: 'Panel.mkf' }))).toBe('ui');
    expect(classifyAsset(entry({ archive: 'Panel', w: 200, h: 280 }))).toBe('ui');
  });

  it('★ 档案名优先于尺寸：Panel 里的 32×32 也算 ui', () => {
    expect(classifyAsset(entry({ archive: 'Panel.mkf', w: 32, h: 32, paletteKind: 'gnd' }))).toBe('ui');
  });

  it('非 UI 归档这条管不着', () => {
    expect(byArchiveName(entry({ archive: 'Data' }))).toBeNull();
  });
});

describe('规则 2：GND 来源 → tile（Q-GND-4 的整张底图）', () => {
  it('★ 整张 2304×2304 的底图仍是 tile，不是 background', () => {
    // 按尺寸它够 640×480 那一条，但底图是地形 —— 放大后必须过 T-064 的接缝检查
    expect(byGroundSource(entry({ archive: 'map', w: 2304, h: 2304, paletteKind: 'gnd' }))).toBe('tile');
    expect(classifyAsset(entry({ archive: 'map', w: 2304, h: 2304, paletteKind: 'gnd' }))).toBe('tile');
    // 对照：同样尺寸的普通大图还是 background
    expect(classifyAsset(entry({ archive: 'map', w: 2304, h: 2304, paletteKind: 'spr' }))).toBe(
      'background',
    );
  });

  it('不是 GND 来源这条就管不着', () => {
    expect(byGroundSource(entry({ paletteKind: 'smp' }))).toBeNull();
    expect(byGroundSource(entry({ archive: 'map', paletteKind: 'spr' }))).toBeNull();
  });

  it('★ 档案名优先：Panel 里的 GND 依然算 ui（规则 1 在前）', () => {
    expect(classifyAsset(entry({ archive: 'Panel.mkf', w: 2304, h: 2304, paletteKind: 'gnd' }))).toBe(
      'ui',
    );
  });
});

describe('规则 3：尺寸 → tile / background', () => {
  it('32×32 且 GND 来源 → tile', () => {
    expect(bySize(entry({ w: 32, h: 32, paletteKind: 'gnd' }))).toBe('tile');
    // map 归档也算 GND 来源
    expect(classifyAsset(entry({ archive: 'map', w: 32, h: 32, paletteKind: 'smp' }))).toBe('tile');
  });

  it('★ 32×32 但不是 GND 来源 → 不是 tile', () => {
    expect(bySize(entry({ w: 32, h: 32, paletteKind: 'smp' }))).toBeNull();
    expect(isGroundSourced(entry({ archive: 'Data', paletteKind: 'smp' }))).toBe(false);
  });

  it('≥ 640×480 → background', () => {
    expect(bySize(entry({ w: 640, h: 480 }))).toBe('background');
    expect(classifyAsset(entry({ archive: 'help', w: 640, h: 480 }))).toBe('background');
  });

  it('差一点都不算 background', () => {
    expect(bySize(entry({ w: 639, h: 480 }))).toBeNull();
    expect(bySize(entry({ w: 640, h: 479 }))).toBeNull();
  });
});

describe('规则 4：帧数 > 1 → sprite', () => {
  it('多帧 → sprite', () => {
    expect(byFrames(entry({ frames: 6 }))).toBe('sprite');
    expect(classifyAsset(entry({ archive: 'Data', w: 96, h: 96, frames: 8 }))).toBe('sprite');
  });

  it('单帧这条管不着', () => {
    expect(byFrames(entry({ frames: 1 }))).toBeNull();
  });

  it('★ 尺寸规则优先于帧数：多帧的 32×32 GND 仍是 tile', () => {
    expect(classifyAsset(entry({ w: 32, h: 32, paletteKind: 'gnd', frames: 4 }))).toBe('tile');
  });
});

describe('规则 5：字形 → font', () => {
  it('paletteKind 标了 font → font', () => {
    expect(byFont(entry({ paletteKind: 'font' }))).toBe('font');
    expect(classifyAsset(entry({ paletteKind: 'font', frames: 1 }))).toBe('font');
  });

  it('字形归档名 → font', () => {
    expect(classifyAsset(entry({ archive: 'font.mkf' }))).toBe('font');
  });

  it('★ 帧数规则优先于字形：多帧字形素材仍是 sprite（动画优先走超分）', () => {
    expect(classifyAsset(entry({ paletteKind: 'font', frames: 3 }))).toBe('sprite');
  });
});

describe('兜底：其余归 ui', () => {
  it('单帧小图、非 GND、非字形 → ui', () => {
    expect(classifyAsset(entry({ archive: 'Data', w: 27, h: 18 }))).toBe('ui');
    expect(classifyAsset(entry({ archive: 'jump', w: 100, h: 100, frames: 1 }))).toBe('ui');
  });
});
