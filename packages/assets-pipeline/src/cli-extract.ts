#!/usr/bin/env node
/*
 * 素材解包 CLI —— 从玩家自备的原版目录解出全部素材
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法：
 *   node --experimental-strip-types cli-extract.ts <原版Rich4目录> <输出目录>
 *
 * 产出：
 *   <out>/<档案名>/<资源号>_<图号>.png      解码后的图像
 *   <out>/<档案名>/<资源号>.<ext>           非图像资源（原样导出）
 *   <out>/manifest.json                     全部素材清单（含锚点，供超分管线使用）
 *
 * ⚠️ 本工具取代 tools/dump_all —— 后者在 64 位构建下会破坏精灵表，
 *    详见 docs/asset-extraction-bug.md。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { MkfArchive, parseSpriteSheet } from './mkf.ts';
import { decodeImage } from './sprite.ts';
import { encodePng } from './png.ts';

/** 原版的资源档案。Effect.mkf 里是 RIFF 音效，非图像。 */
const ARCHIVES = ['Data.mkf', 'Panel.mkf', 'map.mkf', 'jump.mkf', 'Effect.mkf', 'help.mkf'];

export interface AssetEntry {
  archive: string;
  resource: number;
  image: number;
  file: string;
  width: number;
  height: number;
  /** 绘制锚点 —— 超分后必须同步 ×倍率（C-AST-6） */
  anchorX: number;
  anchorY: number;
  format: 'SPR' | 'SMP';
}

export interface RawEntry {
  archive: string;
  resource: number;
  file: string;
  size: number;
  signature: string;
}

/** 按数据开头的签名猜测扩展名 */
function guessExtension(data: Uint8Array): string {
  if (data.length >= 4) {
    const sig = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
    if (sig === 'RIFF') return 'wav';
    if (sig.startsWith('GND')) return 'gnd';
  }
  return 'bin';
}

export function extractAll(rich4Dir: string, outDir: string): {
  images: AssetEntry[];
  raw: RawEntry[];
} {
  const images: AssetEntry[] = [];
  const raw: RawEntry[] = [];

  for (const archive of ARCHIVES) {
    const path = join(rich4Dir, archive);
    if (!existsSync(path)) {
      console.warn(`  跳过（未找到）: ${archive}`);
      continue;
    }

    const name = basename(archive, '.mkf');
    const dir = join(outDir, name);
    mkdirSync(dir, { recursive: true });

    const mkf = new MkfArchive(new Uint8Array(readFileSync(path)));
    let imgCount = 0;
    let rawCount = 0;

    for (let i = 0; i < mkf.count; i++) {
      // 关键：用 'none' 保留原始 RGB555，不做 RGB565 转换
      const data = mkf.read(i, 'none');
      const sheet = parseSpriteSheet(data);

      if (sheet === null) {
        const ext = guessExtension(data);
        const file = `${String(i).padStart(4, '0')}.${ext}`;
        writeFileSync(join(dir, file), data);
        raw.push({
          archive: name,
          resource: i,
          file: `${name}/${file}`,
          size: data.length,
          signature: ext,
        });
        rawCount++;
        continue;
      }

      for (let k = 0; k < sheet.images.length; k++) {
        const img = decodeImage(sheet, data, k);
        const file = `${String(i).padStart(4, '0')}_${String(k).padStart(3, '0')}.png`;
        writeFileSync(join(dir, file), encodePng(img));
        images.push({
          archive: name,
          resource: i,
          image: k,
          file: `${name}/${file}`,
          width: img.width,
          height: img.height,
          anchorX: img.anchorX,
          anchorY: img.anchorY,
          format: sheet.signature,
        });
        imgCount++;
      }
    }
    console.log(`  ${archive.padEnd(12)} → 图像 ${String(imgCount).padStart(6)} 张, 其他资源 ${rawCount} 个`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify({ generatedBy: 'rich4-remake assets-pipeline', images, raw }, null, 2),
  );

  return { images, raw };
}

// 直接运行时执行
if (process.argv[1]?.endsWith('cli-extract.ts')) {
  const [, , rich4Dir, outDir] = process.argv;
  if (rich4Dir === undefined || outDir === undefined) {
    console.error('用法: cli-extract.ts <原版Rich4目录> <输出目录>');
    process.exit(1);
  }
  console.log(`从 ${rich4Dir} 解包到 ${outDir} ...`);
  const t0 = Date.now();
  const { images, raw } = extractAll(rich4Dir, outDir);
  console.log(
    `\n完成：${images.length} 张图像 + ${raw.length} 个其他资源，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(`清单已写入 ${join(outDir, 'manifest.json')}`);
}
