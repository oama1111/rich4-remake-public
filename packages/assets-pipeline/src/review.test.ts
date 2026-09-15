/*
 * T-066：并排比对页
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { buildReviewRows, categoriesOf, renderReviewHtml, type ReviewRow } from './review.ts';
import { emptyManifest, planUpscale, recordResult, type AssetEntryLike, type UpscaleManifest } from './upscale.ts';

// ============================================================
//  夹具
// ============================================================

function entry(over: Partial<AssetEntryLike> = {}): AssetEntryLike {
  return {
    archive: 'Data',
    resource: 2,
    image: 0,
    file: 'Data/0002_000.png',
    width: 8,
    height: 8,
    anchorX: 4,
    anchorY: 3,
    format: 'SPR',
    ...over,
  };
}

/** 建一份清单，并把前 `done` 张标记为已有产物 */
function manifestWith(entries: AssetEntryLike[], done: number): UpscaleManifest {
  const tasks = planUpscale(entries);
  const m = emptyManifest(tasks);
  for (let i = 0; i < done; i++) {
    const t = tasks[i]!;
    m.results[t.id] = recordResult(t, {
      model: 'realesrgan-x4plus-anime',
      outWidth: t.srcWidth * 4,
      outHeight: t.srcHeight * 4,
      srcHash: 'in',
      outHash: `out-${i}`,
    });
  }
  return m;
}

const BASES = { hdBase: 'hd', cleanBase: '../assets-clean' };

// ============================================================
//  选行
// ============================================================

describe('buildReviewRows', () => {
  it('★ 只列有产物的条目（还在排队的不该出现在过审页里）', () => {
    const m = manifestWith([entry({ resource: 1 }), entry({ resource: 2 }), entry({ resource: 3 })], 2);
    const rows = buildReviewRows(m, BASES);
    expect(rows.map((r) => r.id)).toEqual(['Data/0001_000', 'Data/0002_000']);
  });

  it('保持清单里的原顺序', () => {
    const m = manifestWith([entry({ resource: 7 }), entry({ resource: 1 }), entry({ resource: 4 })], 3);
    expect(buildReviewRows(m, BASES).map((r) => r.id)).toEqual([
      'Data/0007_000',
      'Data/0001_000',
      'Data/0004_000',
    ]);
  });

  it('★ HD 那侧用 hdRelativePath 的命名（<资源>-<图>），原图那侧用素材清单的 input 名', () => {
    // 两套命名**本来就不一样**：extract 落的是 `<资源4位>_<图3位>.png`，
    // hd 落的是 `<资源>-<图>.png`。各自由写侧定死，这里只拼前缀。
    const m = manifestWith([entry({ resource: 23, image: 7, file: 'Data/0023_007.png' })], 1);
    const row = buildReviewRows(m, { hdBase: 'hd', cleanBase: '../assets-clean' })[0]!;
    expect(row.hdUrl).toBe('hd/Data/23-7.png');
    expect(row.originalUrl).toBe('../assets-clean/Data/0023_007.png');
  });

  it('原图路径取不到（input 为空）→ null，而不是拼出一个假地址', () => {
    const m = manifestWith([entry({ file: '' })], 1);
    expect(buildReviewRows(m, BASES)[0]!.originalUrl).toBeNull();
  });

  it('尺寸与模型带上，供人工判断「是不是只改了分辨率」', () => {
    const m = manifestWith([entry({ width: 12, height: 9 })], 1);
    const row = buildReviewRows(m, BASES)[0]!;
    expect({ sw: row.srcWidth, sh: row.srcHeight, ow: row.outWidth, oh: row.outHeight }).toEqual({
      sw: 12,
      sh: 9,
      ow: 48,
      oh: 36,
    });
    expect(row.model).toBe('realesrgan-x4plus-anime');
  });

  it('前缀末尾多余的斜杠被吃掉', () => {
    const m = manifestWith([entry({ resource: 5, file: 'Data/0005_000.png' })], 1);
    const row = buildReviewRows(m, { hdBase: 'hd/', cleanBase: 'clean/' })[0]!;
    expect(row.hdUrl).toBe('hd/Data/5-0.png');
    expect(row.originalUrl).toBe('clean/Data/0005_000.png');
  });
});

// ============================================================
//  类别汇总
// ============================================================

describe('categoriesOf', () => {
  it('按类别计数并按名字排序', () => {
    const rows: ReviewRow[] = ['ui', 'sprite', 'ui', 'tile'].map((category, i) => ({
      id: `x/${i}`,
      archive: 'Data',
      resource: i,
      image: 0,
      category: category as ReviewRow['category'],
      originalUrl: null,
      hdUrl: 'h',
      srcWidth: 1,
      srcHeight: 1,
      outWidth: 4,
      outHeight: 4,
      model: 'm',
    }));
    expect(categoriesOf(rows)).toEqual([
      { category: 'sprite', count: 1 },
      { category: 'tile', count: 1 },
      { category: 'ui', count: 2 },
    ]);
  });
});

// ============================================================
//  生成 HTML
// ============================================================

describe('renderReviewHtml', () => {
  const rows = (): ReviewRow[] => buildReviewRows(manifestWith([entry({ resource: 1 }), entry({ resource: 2 })], 2), BASES);

  it('生成不抛错，且每行一张卡片、两张图', () => {
    const html = renderReviewHtml(rows());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.endsWith('</html>\n')).toBe(true);
    expect((html.match(/class="card"/g) ?? []).length).toBe(2);
    // 每行 <img 至少两张（原图 + HD）
    expect((html.match(/<img /g) ?? []).length).toBe(4);
  });

  it('★ 条目数一致：卡片数 == 行数 == 图数/2', () => {
    const r = rows();
    const html = renderReviewHtml(r);
    expect((html.match(/class="card"/g) ?? []).length).toBe(r.length);
    expect((html.match(/<img /g) ?? []).length).toBe(r.length * 2);
  });

  it('空清单也生成得出来（页面上明说 0 张）', () => {
    const html = renderReviewHtml([]);
    expect(html).toContain('共 <strong>0</strong> 张');
    expect(html).not.toContain('<figure');
  });

  it('★ 原图那侧标了 pixelated —— 浏览器放大即最近邻，与「拿原图逐格放大」等价', () => {
    const html = renderReviewHtml(rows());
    expect(html).toContain('.pixelated { image-rendering: pixelated; }');
    expect((html.match(/class="pixelated"/g) ?? []).length).toBe(2);
  });

  it('原图缺失时给出占位而不是破图', () => {
    const m = manifestWith([entry({ file: '' })], 1);
    const html = renderReviewHtml(buildReviewRows(m, BASES));
    expect(html).toContain('原图缺失');
    expect((html.match(/<img /g) ?? []).length).toBe(1); // 只剩 HD 那张
  });

  it('显示尺寸按 outWidth 缩到上限内，且保持宽高比', () => {
    const m = manifestWith([entry({ width: 100, height: 50 })], 1); // → 400×200
    const html = renderReviewHtml(buildReviewRows(m, BASES), { maxWidth: 160 });
    // 400 → 160，比例 0.4，高 200 → 80
    expect(html).toContain('width="160" height="80"');
  });

  it('★ 转义：id / URL 里的尖括号与引号不会逃出属性', () => {
    const m = manifestWith([entry({ archive: 'Da"ta<x>' })], 1);
    const html = renderReviewHtml(buildReviewRows(m, BASES));
    expect(html).not.toContain('<x>');
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('Da"ta');
  });

  it('类别筛选：下拉里每个类别一条，卡片带 data-category', () => {
    const html = renderReviewHtml(rows());
    expect(html).toContain('<option value="ui">');
    expect((html.match(/data-category="ui"/g) ?? []).length).toBe(2);
  });

  it('标题可覆盖', () => {
    expect(renderReviewHtml([], { title: '第一批回填' })).toContain('<title>第一批回填</title>');
  });
});
