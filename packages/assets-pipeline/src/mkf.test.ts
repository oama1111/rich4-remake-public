/*
 * mkf 解压验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ⚠️ 参考数据的可信范围
 * `extracted/` 是用 tools/dump_all（C 实现）解出来的，该工具在 arm64 上存在
 * 结构体布局缺陷（详见 docs/asset-extraction-bug.md）：对 SPR/SMP 资源，它以
 * 16 字节步长把 8 字节堆指针写进一张 12 字节步长的表，破坏图像描述表并殃及
 * 其后的部分像素数据。受污染范围 = [12, 12 + nImages*16)。
 *
 * 验证策略：
 *  - 非精灵资源 → 全文逐字节比对
 *  - 精灵资源   → 跳过受污染区间，比对其余部分（仍能证明解压算法正确）
 *  - 另加自洽性判据：Σgsize 必须恰好闭合到资源长度
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { MkfArchive, parseSpriteSheet } from './mkf.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const hasAssets = existsSync(`${ROOT}/Rich4/map.mkf`) && existsSync(`${ROOT}/extracted/map`);
const d = hasAssets ? describe : describe.skip;

const ARCHIVES = [
  ['help.mkf', 'help'],
  ['jump.mkf', 'jump'],
  ['Effect.mkf', 'Effect'],
  ['Panel.mkf', 'Panel'],
  ['map.mkf', 'map'],
] as const;

function loadArchive(file: string): MkfArchive {
  return new MkfArchive(new Uint8Array(readFileSync(`${ROOT}/Rich4/${file}`)));
}

function refChunk(dir: string, i: number): Uint8Array | null {
  const p = `${ROOT}/extracted/${dir}/${String(i).padStart(4, '0')}.bin`;
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
}

/**
 * dump_all 的指针污染在该偏移之后结束。
 * 实测边界为 `12 + n*16 + 4`（见 docs/asset-extraction-bug.md），此处取 +8 余量。
 */
function pollutionEnd(nImages: number): number {
  return 12 + nImages * 16 + 8;
}

d('mkf 容器', () => {
  it('资源数与 C 实现一致', () => {
    for (const [file, dir] of ARCHIVES) {
      const a = loadArchive(file);
      const n = readdirSync(`${ROOT}/extracted/${dir}`).filter((f) => f.endsWith('.bin')).length;
      expect(a.count, `${file} 资源数`).toBe(n);
    }
  });
});

d('解压算法与 C 实现一致', () => {
  it.each(ARCHIVES)('%s', (file, dir) => {
    const a = loadArchive(file);
    let full = 0;
    let partial = 0;
    let compressed = 0;

    for (let i = 0; i < a.count; i++) {
      const ref = refChunk(dir, i);
      if (ref === null) continue;
      const h = a.header(i);
      const mine = a.read(i, 'rgb565'); // dump_all 用 pixel_fmt=1
      expect(mine.length, `${file}#${i} 长度`).toBe(ref.length);

      const sheet = parseSpriteSheet(mine);
      const isCompressed = h.compressedSize !== h.uncompressedSize;

      if (sheet === null) {
        expect(Buffer.compare(Buffer.from(mine), Buffer.from(ref)), `${file}#${i}`).toBe(0);
        full++;
      } else {
        // 跳过受污染区间后比对其余部分
        const from = pollutionEnd(sheet.images.length);
        if (from >= mine.length) continue;
        expect(
          Buffer.compare(Buffer.from(mine.subarray(from)), Buffer.from(ref.subarray(from))),
          `${file}#${i} 污染区之后仍不一致`,
        ).toBe(0);
        partial++;
      }
      if (isCompressed) compressed++;
    }

    console.log(`  ${file}: 全文比对 ${full} 个, 跳污染区比对 ${partial} 个, 其中压缩资源 ${compressed} 个`);
    expect(full + partial, `${file} 应有可比对资源`).toBeGreaterThan(0);
  });

});

d('精灵表自洽性', () => {
  it.each(ARCHIVES)('%s 的 Σgsize 必须恰好闭合', (file) => {
    const a = loadArchive(file);
    let sheets = 0;
    for (let i = 0; i < a.count; i++) {
      const data = a.read(i, 'none');
      const sheet = parseSpriteSheet(data);
      if (sheet === null || sheet.images.length === 0) continue;
      const total = sheet.images.reduce((t, g) => t + g.gsize, 0);
      expect(sheet.images[0]!.dataOffset + total, `${file}#${i} Σgsize 未闭合`).toBe(data.length);
      sheets++;
    }
    // Effect.mkf 全是 RIFF 音频，没有精灵表
    if (file !== 'Effect.mkf') expect(sheets).toBeGreaterThan(0);
  });

  it('尺寸与锚点均为合理值（无负高度、无天文数字）', () => {
    for (const [file] of ARCHIVES) {
      const a = loadArchive(file);
      for (let i = 0; i < a.count; i++) {
        const sheet = parseSpriteSheet(a.read(i, 'none'));
        if (sheet === null) continue;
        for (const g of sheet.images) {
          expect(g.width, `${file}#${i} 宽`).toBeGreaterThan(0);
          expect(g.height, `${file}#${i} 高`).toBeGreaterThan(0);
          expect(g.width).toBeLessThan(8192);
          expect(g.height).toBeLessThan(8192);
          expect(g.gsize).toBeLessThan(1 << 26);
        }
      }
    }
  });

  it('SMP 为原始 16bpp 位图：w*h*2 === gsize', () => {
    const a = loadArchive('help.mkf');
    const sheet = parseSpriteSheet(a.read(0, 'none'))!;
    expect(sheet.signature).toBe('SMP');
    for (const g of sheet.images) {
      expect(g.width * g.height * 2).toBe(g.gsize);
    }
  });

  it('SPR 自带 512 字节调色板，且为未压缩 8bpp（gsize === w*h）', () => {
    const a = loadArchive('map.mkf');
    let sprs = 0;
    let smallerThanRaw = 0;
    let total = 0;
    for (let i = 0; i < a.count; i++) {
      const sheet = parseSpriteSheet(a.read(i, 'none'));
      if (sheet?.signature !== 'SPR') continue;
      expect(sheet.palette).not.toBeNull();
      expect(sheet.palette!.length).toBe(512); // C-AST-4
      sprs++;
      for (const g of sheet.images) {
        total++;
        // 实测：SPR 是未压缩 8bpp 调色板位图，恒等于 w*h
        if (g.gsize === g.width * g.height) smallerThanRaw++;
      }
    }
    expect(sprs).toBeGreaterThan(0);
    expect(smallerThanRaw).toBe(total);
  });
});

d('像素格式', () => {
  it('默认 none 保留原始 RGB555，与 rgb565 转换结果不同', () => {
    const a = loadArchive('Panel.mkf');
    let idx = -1;
    for (let i = 0; i < a.count; i++) {
      if (a.header(i).imageDataSize > 0) { idx = i; break; }
    }
    expect(idx).toBeGreaterThanOrEqual(0);
    const raw = a.read(idx, 'none');
    const conv = a.read(idx, 'rgb565');
    expect(raw.length).toBe(conv.length);
    expect(Buffer.compare(Buffer.from(raw), Buffer.from(conv))).not.toBe(0);
  });
});
