/*
 * 并排比对页（T-066）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 生成一张**静态** HTML，左「原图最近邻放大 4×」右「HD 产物」，逐张对照，
 * 供人工过审。超分是外部工具干的活，好不好最终得人看——
 * 本模块只负责把该看的摆到一起，不做任何自动判定。
 *
 * ★ 原图那侧不预先处理成一张 4× 的图，而是直接在 HTML 里用
 *   `image-rendering: pixelated` + 撑到 HD 的尺寸 —— 浏览器放大就是最近邻，
 *   与「拿原图逐格放大」逐像素等价，却省掉一份 4× 中间产物（那是 16 倍体积）。
 *
 * ★ 报告只列**有产物**的条目（既在 tasks 又在 results）：还在排队的不该出现在
 *   过审页里，否则页面上大半是破图。
 *
 * ⚠️ 图片用**相对路径**引用，故这张 HTML 可以随便挪；但要整目录一起挪，
 *   或者用 `base` 参数指到图片所在的位置。
 */

import type { AssetCategory } from './classify.ts';
import { hdRelativePath } from './assemble.ts';
import type { UpscaleManifest } from './upscale.ts';

/** 一行对照 */
export interface ReviewRow {
  /** 稳定标识，如 `Data/0002_000` */
  id: string;
  archive: string;
  resource: number;
  image: number;
  category: AssetCategory;
  /** 原图；取不到就 null（页面上会标出来） */
  originalUrl: string | null;
  /** HD 产物 */
  hdUrl: string;
  srcWidth: number;
  srcHeight: number;
  outWidth: number;
  outHeight: number;
  model: string;
}

export interface ReviewRowOptions {
  /** HD 产物的 URL 前缀（相对 or 绝对）*/
  hdBase: string;
  /** 原图的 URL 前缀 */
  cleanBase: string;
}

/**
 * 由清单挑出可过审的行，**保持清单里的顺序**。
 *
 * `originalUrl` 用 `task.input`（素材清单里的相对路径，如 `Data/0002_000.png`），
 * 与 `hdRelativePath` 那套命名**不是一回事**：前者是 extract 的产出名，
 * 后者是 hd 的产出名。两者都由各自的写侧定死，这里只拼前缀。
 */
export function buildReviewRows(manifest: UpscaleManifest, opts: ReviewRowOptions): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const task of manifest.tasks) {
    const result = manifest.results[task.id];
    if (result === undefined) continue; // 还没产物，不进过审页
    rows.push({
      id: task.id,
      archive: task.archive,
      resource: task.resource,
      image: task.image,
      category: task.category,
      originalUrl: task.input === '' ? null : `${trimSlash(opts.cleanBase)}/${task.input.replace(/^\/+/, '')}`,
      hdUrl: `${trimSlash(opts.hdBase)}/${hdRelativePath(task.archive, task.resource, task.image)}`,
      srcWidth: task.srcWidth,
      srcHeight: task.srcHeight,
      outWidth: result.outWidth,
      outHeight: result.outHeight,
      model: result.model,
    });
  }
  return rows;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** HTML 转义 —— 数据虽是自己产的，但拼进 HTML 的东西一律按不可信处理 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 按类别汇总，用于页首的筛选下拉 */
export function categoriesOf(rows: readonly ReviewRow[]): { category: AssetCategory; count: number }[] {
  const counts = new Map<AssetCategory, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

export interface RenderOptions {
  title?: string;
  /** 缩放展示的上限（像素）。4× 后的图很大，缩到能一屏看几张 */
  maxWidth?: number;
}

/**
 * 生成静态 HTML。
 *
 * 每行两张图**等比**摆在一起：原图那侧用 `pixelated` 撑到 HD 的显示尺寸，
 * 于是两边逐像素对齐，色差与彩边一眼可见。
 */
export function renderReviewHtml(rows: readonly ReviewRow[], opts: RenderOptions = {}): string {
  const title = opts.title ?? 'HD 回填过审';
  const maxWidth = opts.maxWidth ?? 320;
  const cats = categoriesOf(rows);

  const options = cats
    .map((c) => `<option value="${esc(c.category)}">${esc(c.category)}（${c.count}）</option>`)
    .join('');

  const cards = rows
    .map((r) => {
      // 显示尺寸：按 HD 的宽高比缩到 maxWidth 以内
      const shownW = Math.min(r.outWidth, maxWidth);
      const scaleOfShown = r.outWidth === 0 ? 1 : shownW / r.outWidth;
      const shownH = Math.round(r.outHeight * scaleOfShown);
      const original = r.originalUrl === null
        ? '<div class="missing">原图缺失</div>'
        : // pixelated + 撑到同一显示尺寸 = 浏览器里的最近邻 4×
          `<img class="pixelated" src="${esc(r.originalUrl)}" width="${shownW}" height="${shownH}" alt="原图">`;
      return `<figure class="card" data-category="${esc(r.category)}">
  <figcaption>
    <code>${esc(r.id)}</code>
    <span class="dims">${r.srcWidth}×${r.srcHeight} → ${r.outWidth}×${r.outHeight}</span>
    <span class="model">${esc(r.model)}</span>
  </figcaption>
  <div class="pair">
    <div class="side">${original}<span class="tag">原图 ×4（最近邻）</span></div>
    <div class="side"><img src="${esc(r.hdUrl)}" width="${shownW}" height="${shownH}" alt="HD"><span class="tag">HD</span></div>
  </div>
</figure>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .summary { opacity: .75; margin-bottom: 16px; }
  .bar { position: sticky; top: 0; background: Canvas; padding: 8px 0; border-bottom: 1px solid rgba(128,128,128,.35); margin-bottom: 16px; }
  select { font: inherit; padding: 4px 8px; }
  .grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .card { margin: 0; padding: 8px; border: 1px solid rgba(128,128,128,.35); border-radius: 6px; background: rgba(128,128,128,.06); }
  figcaption { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; margin-bottom: 6px; }
  .dims, .model { opacity: .7; font-size: 12px; }
  .pair { display: flex; gap: 8px; }
  .side { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .tag { font-size: 11px; opacity: .65; }
  img { display: block; background:
      repeating-conic-gradient(rgba(128,128,128,.25) 0% 25%, transparent 0% 50%) 50% / 16px 16px; }
  .pixelated { image-rendering: pixelated; }
  .missing { display: grid; place-items: center; width: 120px; height: 80px; font-size: 12px; opacity: .6; border: 1px dashed rgba(128,128,128,.5); }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="summary">共 <strong>${rows.length}</strong> 张有产物。左侧是原图的最近邻 4×（浏览器放大，逐像素等价），右侧是超分产物 —— 构图、色调、透明形状应当一致。</p>
<div class="bar">
  <label>类别：<select id="filter"><option value="">全部（${rows.length}）</option>${options}</select></label>
</div>
<div class="grid" id="grid">
${cards}
</div>
<script>
  var sel = document.getElementById('filter');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  sel.addEventListener('change', function () {
    var want = sel.value;
    cards.forEach(function (c) {
      var show = want === '' || c.getAttribute('data-category') === want;
      c.classList.toggle('hidden', !show);
    });
  });
</script>
</body>
</html>
`;
}
