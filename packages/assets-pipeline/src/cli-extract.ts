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
 * ★ **地图底图（`.gnd`）也解成 PNG 进清单**（Q-GND-4）：它在 `map.mkf` 里是
 *   偶数号资源（`地图号 × 2`，与奇数号的结构数据成对），既不是 SPR/SMP 也不是 FLIC，
 *   先前整块原样落成 `map/0000.gnd`，于是**不在 `manifest.json` 的 `images` 里**，
 *   `planUpscale` 不为它建任务 —— T-063 的 hd 回填与 T-064 的接缝检查都没有真实输入。
 *   现在走 `decodeGround` 解成 2304×2304 的 PNG，作为**整张**一条进清单（路线取舍见
 *   `docs/deviations/Q-PERF-GND.md`）。
 *
 * ⚠️ 本工具取代 tools/dump_all —— 后者在 64 位构建下会破坏精灵表，
 *    详见 docs/asset-extraction-bug.md。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { MkfArchive, parseSpriteSheet } from './mkf.ts';
import { decodeFlic } from './flic.ts';
import { decodeImage } from './sprite.ts';
import { encodePng } from './png.ts';
import { decodeGround, groundRgba, isGround } from './ground.ts';

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
  /**
   * 素材格式。`FLIC` = `.FLI/.FLC` 影片的一帧（见 `flic.ts`）——
   * 全游戏 105 个动画（Panel 8 / Data 72 / jump 25）都是它，
   * 拖到现在才接进来，先前是当 `.bin` 原样落盘的。
   *
   * `GND` = 地图底图（`map.mkf` 偶数号资源，见 `ground.ts`）——
   * **一整张**进清单（2304×2304），不是 32×32 的 tile（Q-GND-4）。
   */
  format: 'SPR' | 'SMP' | 'FLIC' | 'GND';
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

/** 底图解码出来的一条清单产物 —— 图号固定 0（一张底图就是一整张图） */
export interface GroundAsset {
  /** 相对档案目录的文件名，如 `0000_000.png` */
  file: string;
  /** 编好的 PNG 字节 */
  png: Uint8Array;
  entry: AssetEntry;
}

/**
 * 把一段 `.gnd` 解成 PNG + 清单条目（Q-GND-4）。
 *
 * ★ **一整张**一条，不拆成 5184 个 32×32 的 tile —— 取舍与理由见
 *   `docs/deviations/Q-PERF-GND.md`。要点：32×32 对超分模型太小，
 *   逐块放大会把块内的质量换成一圈块间伪影，而块间伪影恰恰是最难修的。
 *
 * 锚点记 0/0：底图是**整幅贴**的，原版用节点的世界坐标直接取像素
 * （`GROUND_ORIGIN = (0,0)`，见 `ground.ts`），没有「以某点为原点」这回事。
 *
 * 纯函数（不碰文件系统），故可以用内存里的合成底图钉死。
 */
export function groundAsset(data: Uint8Array, archive: string, resource: number): GroundAsset {
  const g = decodeGround(data);
  const file = `${String(resource).padStart(4, '0')}_000.png`;
  return {
    file,
    png: encodePng({ width: g.width, height: g.height, anchorX: 0, anchorY: 0, rgba: groundRgba(g) }),
    entry: {
      archive,
      resource,
      image: 0,
      file: `${archive}/${file}`,
      width: g.width,
      height: g.height,
      anchorX: 0,
      anchorY: 0,
      format: 'GND',
    },
  };
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
    let flicCount = 0;
    let groundCount = 0;

    for (let i = 0; i < mkf.count; i++) {
      // 关键：用 'none' 保留原始 RGB555，不做 RGB565 转换
      const data = mkf.read(i, 'none');
      const sheet = parseSpriteSheet(data);

      if (sheet === null) {
        // ★ 地图底图：解成 PNG 进清单（Q-GND-4）。必须排在 FLIC 与「原样落盘」之前 ——
        //   先前它就是掉进最后那一条，于是 `.gnd` 不在 images 里、超分管线看不到它。
        if (isGround(data)) {
          const g = groundAsset(data, name, i);
          writeFileSync(join(dir, g.file), g.png);
          images.push(g.entry);
          imgCount++;
          groundCount++;
          continue;
        }
        // FLIC 影片：逐帧落 PNG（`Panel#4/5/6` 骰子、樂透那三块、jump 的过场…）
        const flic = decodeFlic(data);
        if (flic !== null) {
          for (let k = 0; k < flic.frames.length; k++) {
            const file = `${String(i).padStart(4, '0')}_${String(k).padStart(3, '0')}.png`;
            writeFileSync(
              join(dir, file),
              encodePng({
                width: flic.info.width,
                height: flic.info.height,
                // FLIC 没有自带锚点：原版是调用方给 (x,y)（见 flic.ts），故记 0
                anchorX: 0,
                anchorY: 0,
                rgba: flic.frames[k]!,
              }),
            );
            images.push({
              archive: name,
              resource: i,
              image: k,
              file: `${name}/${file}`,
              width: flic.info.width,
              height: flic.info.height,
              anchorX: 0,
              anchorY: 0,
              format: 'FLIC',
            });
            imgCount++;
          }
          flicCount++;
          continue;
        }
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
    console.log(
      `  ${archive.padEnd(12)} → 图像 ${String(imgCount).padStart(6)} 张` +
        `（其中影片 ${flicCount} 段、底图 ${groundCount} 张）, 其他资源 ${rawCount} 个`,
    );
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
