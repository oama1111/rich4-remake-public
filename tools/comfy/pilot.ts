#!/usr/bin/env node
/*
 * W-80 试点：用云端 ComfyUI 跑超分 / 重绘
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 用法（地址只走环境变量，**不进仓库**）：
 *   COMFY_URL=https://…:8188 node --experimental-strip-types tools/comfy/pilot.ts upload <本地目录> <远端子目录>
 *   COMFY_URL=…               node --experimental-strip-types tools/comfy/pilot.ts run <jobs.json> [只跑这些 id,…]
 *
 * ★ 与需求方已有工作流**互不干扰**：
 *   - 输入一律进 `input/rich4-pilot/…`、产物一律进 `output/rich4-pilot/…`；
 *   - 只用服务器上**已有**的本地模型（SeedVR2 7B / Qwen-Image 2.1），不下新模型、不改已有工作流；
 *   - 不用 ComfyUI 里的付费云端节点（Magnific / Topaz …）—— W-80 D2：素材不交给第三方。
 *
 * ★ 可复现：每个任务的模型文件名、种子、步数、倍率都写进 `<jobs>.log.json`，
 *   回填时（`upscale assemble <…> <model>`）以此为「配方」。
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../../packages/assets-pipeline/src/png.ts';

const BASE = (process.env['COMFY_URL'] ?? '').replace(/\/+$/, '');

/** 本批次在服务器上的根（输入与产物各一个子目录） */
export const REMOTE_ROOT = 'rich4-pilot';
/** 服务器上 ComfyUI 的输入目录绝对路径（按目录读帧的节点要它） */
export const REMOTE_INPUT_ABS = '/root/ComfyUI/input';

export const MODELS = {
  seedvr2: 'seedvr2_7b_int8_convrot.safetensors',
  seedvr2Vae: 'seedvr2_ema_vae_fp16.safetensors',
  qwen: 'qwen_image_2.1_bf16.safetensors',
  qwenClip: 'qwen3vl_8b_int8_convrot.safetensors',
  qwenVae: 'qwen_image_2.1_vae_bf16.safetensors',
} as const;

// ============================================================
//  任务
// ============================================================

interface JobBase {
  id: string;
  /** 产物落到本地哪（相对 jobs.json 所在目录）；视频任务是目录 */
  out: string;
  /** 目标像素尺寸 —— 最后一步强制缩放到它（管线要求倍率严格一致） */
  width: number;
  height: number;
  seed: number;
  /**
   * SeedVR2 的 VAE 分块边长（像素，默认 1024，与需求方的工作流一致）。
   * ⚠️ 试点实测：2304² 的地图底图用 1024 分块，拼接处有肉眼可见的矩形接缝（C-AST-7）；
   *   底图类整张不分块（或分块 ≥ 图边长）。
   */
  vaeTile?: number;
  /**
   * VAE 时间分块（帧，默认 4096 = 整段一次）。视频任务要小：
   * 20 帧 640×480 放 4× 整段解码在 24 GB 上爆显存（采样已过、死在 VAEDecodeTiled）。
   */
  vaeTemporal?: number;
  /**
   * 放大前先做一次极轻的高斯模糊（sigma，原图像素）。原版是 16 位色、带抖动噪点，
   * SeedVR2 会把噪点当细节锐化成颗粒纹理（过场立体字、标题屏上都看得到）。
   */
  preBlur?: number;
  /**
   * 取回后裁到左上角 `w×h`（像素）。配合「本地先把原图右/下边缘复制填充到 ×2 是 32 的倍数」
   * 的输入：重绘画布比例与原图严格一致，放大后再裁掉填充 —— 画面一点不拉伸（C-AST-3）。
   */
  crop?: { w: number; h: number };
}

/** SeedVR2 单张：忠实超分（lab 调色贴回原图） */
export interface SeedVr2ImageJob extends JobBase {
  kind: 'seedvr2-image';
  /** `input/` 下的相对路径 */
  input: string;
  color?: 'lab' | 'wavelet' | 'adain' | 'none';
}

/** SeedVR2 视频：一段等尺寸帧当视频放大，帧间一致 */
export interface SeedVr2VideoJob extends JobBase {
  kind: 'seedvr2-video';
  /** `input/` 下的相对目录，帧按文件名排序 */
  inputDir: string;
  frames: number;
  color?: 'lab' | 'wavelet' | 'adain' | 'none';
  /**
   * 按显存自动切时间段（`SeedVR2TemporalChunk` auto，段间重叠 `temporalOverlap` 个 latent 帧交叉淡化）。
   * 640×480 的过场 40–49 帧放到 4× 一次性进不了 24 GB 显存。
   */
  temporalChunk?: boolean;
  temporalOverlap?: number;
}

/** Qwen-Image 2.1 按指令重绘（补细节）→ SeedVR2 放大到目标尺寸 */
export interface QwenRepaintJob extends JobBase {
  kind: 'qwen-repaint';
  input: string;
  prompt: string;
  negative: string;
  /** 参考图/生成图的边长基准（Qwen 的 resolution 参数，32 的倍数）；给了 `repaintWidth/Height` 时不用 */
  resolution: number;
  steps: number;
  /**
   * 重绘时的精确画布（都要是 32 的倍数、**比例与原图一致**，如 640×480 → 1280×960）。
   * ⚠️ 只给 `resolution` 时 Qwen 按面积取 32 的倍数，比例会偏（640×480 出成 1472×1120，
   *   差 2%），缩回原尺寸画面就被拉伸 —— C-AST-3 不许。给了它就先把输入缩到这个尺寸、
   *   `resolution = 0`（「按参考图原尺寸」）出图。
   */
  repaintWidth?: number;
  repaintHeight?: number;
  /**
   * < 1 时走**图生图**：以原图（缩到重绘画布）编码的 latent 为起点、只去噪这么多。
   * 试点用于地图底图：全量重绘（1.0）会改字形、换纹理（色差均值 18），
   * 纯超分又把原版地砖之间的接缝放大出来 —— 低去噪介于两者之间。
   */
  denoise?: number;
}

export type Job = SeedVr2ImageJob | SeedVr2VideoJob | QwenRepaintJob;

// ============================================================
//  API 工作流（与需求方的「SeedVR2 任意图放大4K」同一套节点与参数）
// ============================================================

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** SeedVR2 那一段：输入节点 `src` → 放大到长边 `longSide` → 采样 → 调色贴回 → 缩到精确尺寸 → 存 */
function seedvr2Tail(
  g: Graph,
  src: [string, number],
  job: JobBase,
  color: string,
  prefix: string,
  chunk?: { overlap: number },
): void {
  const longSide = Math.max(job.width, job.height);
  let from = src;
  if (job.preBlur !== undefined && job.preBlur > 0) {
    g['99'] = { class_type: 'ImageBlur', inputs: { image: src, blur_radius: 1, sigma: job.preBlur } };
    from = ['99', 0];
  }
  g['101'] = { class_type: 'ImageScaleToMaxDimension', inputs: { image: from, upscale_method: 'lanczos', largest_size: longSide } };
  g['102'] = { class_type: 'SeedVR2Preprocess', inputs: { resized_images: ['101', 0] } };
  g['103'] = { class_type: 'VAELoader', inputs: { vae_name: MODELS.seedvr2Vae } };
  g['104'] = { class_type: 'UNETLoader', inputs: { unet_name: MODELS.seedvr2, weight_dtype: 'default' } };
  g['105'] = {
    class_type: 'VAEEncodeTiled',
    inputs: {
      pixels: ['102', 0],
      vae: ['103', 0],
      tile_size: job.vaeTile ?? 1024,
      overlap: 128,
      temporal_size: job.vaeTemporal ?? 4096,
      temporal_overlap: job.vaeTemporal === undefined ? 8 : 4,
    },
  };
  // 时间分块：之后的条件 / 采样对每一段各跑一遍（ComfyUI 的列表语义），再按重叠合回来
  const latent: [string, number] = chunk === undefined ? ['105', 0] : ['120', 0];
  if (chunk !== undefined) {
    g['120'] = {
      class_type: 'SeedVR2TemporalChunk',
      inputs: { latent: ['105', 0], temporal_overlap: chunk.overlap, chunking_mode: 'auto' },
    };
  }
  g['106'] = { class_type: 'SeedVR2Conditioning', inputs: { model: ['104', 0], vae_conditioning: latent } };
  g['107'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['104', 0],
      positive: ['106', 0],
      negative: ['106', 1],
      latent_image: latent,
      seed: job.seed,
      steps: 1,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
    },
  };
  if (chunk !== undefined) {
    g['121'] = { class_type: 'SeedVR2TemporalMerge', inputs: { latents: ['107', 0], temporal_overlap: ['120', 1] } };
  }
  g['108'] = {
    class_type: 'VAEDecodeTiled',
    inputs: {
      samples: chunk === undefined ? ['107', 0] : ['121', 0],
      vae: ['103', 0],
      tile_size: job.vaeTile ?? 1024,
      overlap: 128,
      temporal_size: job.vaeTemporal ?? 4096,
      temporal_overlap: job.vaeTemporal === undefined ? 8 : 4,
    },
  };
  g['109'] = {
    class_type: 'SeedVR2PostProcessing',
    inputs: { images: ['108', 0], original_resized_images: ['101', 0], color_correction_method: color },
  };
  // 长边对齐后另一边可能差 1 像素 —— 管线要求倍率严格一致，这里钉死
  g['110'] = { class_type: 'ImageScale', inputs: { image: ['109', 0], upscale_method: 'lanczos', width: job.width, height: job.height, crop: 'disabled' } };
  g['111'] = { class_type: 'SaveImage', inputs: { images: ['110', 0], filename_prefix: prefix } };
}

export function buildGraph(job: Job): Graph {
  const g: Graph = {};
  const prefix = `${REMOTE_ROOT}/${job.id}`;
  switch (job.kind) {
    case 'seedvr2-image':
      g['1'] = { class_type: 'LoadImage', inputs: { image: job.input } };
      seedvr2Tail(g, ['1', 0], job, job.color ?? 'lab', prefix);
      return g;
    case 'seedvr2-video':
      g['1'] = {
        class_type: 'VHS_LoadImagesPath',
        inputs: { directory: `${REMOTE_INPUT_ABS}/${job.inputDir}`, image_load_cap: 0, skip_first_images: 0, select_every_nth: 1 },
      };
      seedvr2Tail(g, ['1', 0], job, job.color ?? 'lab', prefix, job.temporalChunk === true ? { overlap: job.temporalOverlap ?? 2 } : undefined);
      return g;
    case 'qwen-repaint': {
      g['1'] = { class_type: 'LoadImage', inputs: { image: job.input } };
      const exact = job.repaintWidth !== undefined && job.repaintHeight !== undefined;
      if (exact) {
        g['12'] = {
          class_type: 'ImageScale',
          inputs: { image: ['1', 0], upscale_method: 'lanczos', width: job.repaintWidth, height: job.repaintHeight, crop: 'disabled' },
        };
      }
      g['2'] = { class_type: 'UNETLoader', inputs: { unet_name: MODELS.qwen, weight_dtype: 'default' } };
      g['3'] = { class_type: 'QwenImage21Cache', inputs: { model: ['2', 0], device: 'auto', dtype: 'default' } };
      g['4'] = { class_type: 'CLIPLoader', inputs: { clip_name: MODELS.qwenClip, type: 'qwen_image', device: 'default' } };
      g['5'] = { class_type: 'VAELoader', inputs: { vae_name: MODELS.qwenVae } };
      g['6'] = {
        class_type: 'TextEncodeQwenImage21',
        inputs: {
          clip: ['4', 0],
          prompt: job.prompt,
          negative_prompt: job.negative,
          resolution: exact ? 0 : job.resolution,
          'images.image_1': exact ? ['12', 0] : ['1', 0],
          vae: ['5', 0],
        },
      };
      const img2img = job.denoise !== undefined && job.denoise < 1;
      if (img2img) g['13'] = { class_type: 'VAEEncode', inputs: { pixels: exact ? ['12', 0] : ['1', 0], vae: ['5', 0] } };
      g['7'] = {
        class_type: 'KSampler',
        inputs: {
          model: ['3', 0],
          positive: ['6', 0],
          negative: ['6', 1],
          latent_image: img2img ? ['13', 0] : ['6', 2],
          seed: job.seed,
          steps: job.steps,
          cfg: 1,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: job.denoise ?? 1,
        },
      };
      g['8'] = { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['5', 0] } };
      // 重绘后的中间图也存一份：过审时要能看出「是重绘改的，还是放大改的」
      g['9'] = { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: `${prefix}-repaint` } };
      seedvr2Tail(g, ['8', 0], job, 'lab', prefix);
      return g;
    }
  }
}

// ============================================================
//  与服务器打交道
// ============================================================

function need(): string {
  if (BASE === '') throw new Error('先设 COMFY_URL（云端 ComfyUI 地址，不进仓库）');
  return BASE;
}

/**
 * 网络层偶发断连 / 吊死（云端隔着公网代理，实测有请求被代理挂住、永远不返回）：
 * 每次请求限时 `REQUEST_TIMEOUT_MS`，超时或断连重试 4 次；HTTP 错误不重试，直接报。
 * ⚠️ 没有超时的 fetch 会让整批任务无声地停在某一张上（全量第一次启动就这样卡了）。
 */
const REQUEST_TIMEOUT_MS = 180_000;
/** 轮询 / 排队这类小请求：代理挂住时别干等 3 分钟 */
const SMALL_TIMEOUT_MS = 20_000;

async function fetchRetry(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  for (let i = 0; ; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      // 响应体也可能读到一半被挂住 —— 在超时之内读完再交出去
      const body = await res.arrayBuffer();
      const ms = Date.now() - t0;
      if (ms > 5000) console.log(`  （慢请求 ${Math.round(ms / 1000)} s：${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}）`);
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      console.log(`  （请求失败 ${Math.round((Date.now() - t0) / 1000)} s，第 ${i + 1} 次：${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}）`);
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // 带文件的（上传）给长超时，其余一律按小请求
  const big = init?.body instanceof FormData;
  const res = await fetchRetry(`${need()}${path}`, init, big ? REQUEST_TIMEOUT_MS : SMALL_TIMEOUT_MS);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return (await res.json()) as T;
}

function listPngs(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.toLowerCase().endsWith('.png')) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

/** 整个目录原样传到 `input/rich4-pilot/<remoteSub>/…` */
export async function upload(localDir: string, remoteSub: string): Promise<void> {
  const files = listPngs(localDir);
  let n = 0;
  for (const f of files) {
    const rel = relative(localDir, f);
    const sub = [REMOTE_ROOT, remoteSub, dirname(rel)].filter((x) => x !== '' && x !== '.').join('/');
    const form = new FormData();
    form.append('image', new Blob([readFileSync(f)], { type: 'image/png' }), basename(f));
    form.append('subfolder', sub);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    await api('/upload/image', { method: 'POST', body: form });
    n++;
  }
  console.log(`上传 ${n} 张 → input/${REMOTE_ROOT}/${remoteSub}/`);
}

interface HistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}

async function waitFor(promptId: string): Promise<Record<string, { images?: HistoryImage[] }>> {
  for (;;) {
    const h = await api<Record<string, { outputs?: Record<string, { images?: HistoryImage[] }>; status?: { status_str?: string; messages?: unknown[] } }>>(
      `/history/${promptId}`,
    );
    const e = h[promptId];
    if (e?.status?.status_str === 'error') throw new Error(`任务出错：${JSON.stringify(e.status.messages).slice(0, 1500)}`);
    if (e?.outputs !== undefined && e.status?.status_str === 'success') return e.outputs;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function download(img: HistoryImage, to: string): Promise<void> {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
  const res = await fetchRetry(`${need()}/view?${q.toString()}`);
  if (!res.ok) throw new Error(`下载 ${img.filename} → HTTP ${res.status}`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, new Uint8Array(await res.arrayBuffer()));
}

/** 就地裁到左上角 w×h */
function cropTopLeft(path: string, w: number, h: number): void {
  const img = decodePng(new Uint8Array(readFileSync(path)));
  if (img.width === w && img.height === h) return;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(img.rgba.subarray(y * img.width * 4, y * img.width * 4 + w * 4), y * w * 4);
  writeFileSync(path, encodePng({ width: w, height: h, anchorX: 0, anchorY: 0, rgba }));
}

/** 任务的本地产物是否已经在了（断点续跑：在就跳过） */
function done(root: string, job: Job): boolean {
  if (job.kind === 'seedvr2-video') {
    const dir = join(root, job.out);
    return existsSync(dir) && readdirSync(dir).filter((n) => n.endsWith('.png')).length >= job.frames;
  }
  return existsSync(join(root, job.out));
}

/** 任务要的输入若标了本地来源（`upload` / `uploadDir`），排队前先传上去 */
async function stageInputs(root: string, job: Job): Promise<void> {
  const j = job as Job & { upload?: string; uploadDir?: string };
  if (j.upload !== undefined && (job.kind === 'seedvr2-image' || job.kind === 'qwen-repaint')) {
    const sub = dirname(job.input);
    const form = new FormData();
    form.append('image', new Blob([readFileSync(join(root, j.upload))], { type: 'image/png' }), basename(job.input));
    form.append('subfolder', sub);
    form.append('type', 'input');
    form.append('overwrite', 'true');
    await api('/upload/image', { method: 'POST', body: form });
  }
  if (j.uploadDir !== undefined && job.kind === 'seedvr2-video') {
    for (const f of listPngs(join(root, j.uploadDir))) {
      const form = new FormData();
      form.append('image', new Blob([readFileSync(f)], { type: 'image/png' }), basename(f));
      form.append('subfolder', job.inputDir);
      form.append('type', 'input');
      form.append('overwrite', 'true');
      await api('/upload/image', { method: 'POST', body: form });
    }
  }
}

/**
 * 跑一批任务。
 *
 * ★ 流水线：同时最多 `ahead` 个任务在服务器上（一个在算、其余排队），本地同时在传下一张、
 *   取上一张 —— 全量批次十几个小时，传输不能占 GPU 的时间。
 * ★ 断点续跑：本地产物已在的任务跳过；单个任务出错只记进日志（`error`），不中断整批。
 */
export async function run(jobsFile: string, only: readonly string[], ahead = 3): Promise<void> {
  const root = dirname(jobsFile);
  const all = (JSON.parse(readFileSync(jobsFile, 'utf8')) as { jobs: Job[] }).jobs.filter(
    (j) => only.length === 0 || only.includes(j.id),
  );
  const jobs = all.filter((j) => !done(root, j));
  console.log(`共 ${all.length} 个任务，已完成 ${all.length - jobs.length}，本次跑 ${jobs.length}`);
  const logFile = jobsFile.replace(/\.json$/, '.log.json');
  const log: Record<string, unknown> = existsSync(logFile) ? (JSON.parse(readFileSync(logFile, 'utf8')) as Record<string, unknown>) : {};
  const saveLog = (): void => writeFileSync(logFile, `${JSON.stringify(log, null, 2)}\n`);
  const clientId = `rich4-pilot-${Date.now()}`;
  const t00 = Date.now();

  let next = 0;
  let finished = 0;
  /**
   * ★ `ahead` 个工人各自把一个任务走完整个生命周期（上传 → 排队 → 等 → 下载）。
   *   ComfyUI 那边本来就串行跑 GPU；我们这边并行，是为了让隔着公网代理的上传/下载
   *   （实测一张小图上传 7–25 s、取回 12 s）和 GPU 的计算叠在一起，而不是轮流等。
   */
  const worker = async (): Promise<void> => {
    for (;;) {
      const job = jobs[next++];
      if (job === undefined) return;
      const t0 = Date.now();
      try {
        await stageInputs(root, job);
        const { prompt_id } = await api<{ prompt_id: string }>('/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: buildGraph(job), client_id: clientId }),
        });
        const outputs = await waitFor(prompt_id);
        const main = outputs['111']?.images ?? [];
        const repaint = outputs['9']?.images ?? [];
        if (main.length === 0) throw new Error('没有产物');
        if (job.kind === 'seedvr2-video') {
          for (let i = 0; i < main.length; i++) await download(main[i]!, join(root, job.out, `${String(i).padStart(4, '0')}.png`));
        } else {
          await download(main[0]!, join(root, job.out));
          if (repaint[0] !== undefined) await download(repaint[0], join(root, job.out.replace(/\.png$/, '.repaint.png')));
          if (job.crop !== undefined) cropTopLeft(join(root, job.out), job.crop.w, job.crop.h);
        }
        log[job.id] = {
          kind: job.kind,
          models: job.kind === 'qwen-repaint' ? [MODELS.qwen, MODELS.seedvr2] : [MODELS.seedvr2],
          seed: job.seed,
          ...(job.kind === 'qwen-repaint'
            ? {
                steps: job.steps,
                resolution: job.resolution,
                repaint: `${job.repaintWidth ?? '-'}x${job.repaintHeight ?? '-'}`,
                denoise: job.denoise ?? 1,
                prompt: job.prompt,
                negative: job.negative,
              }
            : {}),
          target: `${job.width}x${job.height}`,
          vaeTile: job.vaeTile ?? 1024,
      vaeTemporal: job.vaeTemporal ?? 4096,
      preBlur: job.preBlur ?? 0,
          outputs: main.length,
          seconds: Math.round((Date.now() - t0) / 1000),
          at: new Date().toISOString(),
        };
      } catch (e) {
        log[job.id] = { error: String(e).slice(0, 800), at: new Date().toISOString() };
        console.log(`[${job.id}] 失败：${String(e).slice(0, 200)}`);
      }
      saveLog();
      finished++;
      const el = (Date.now() - t00) / 1000;
      const eta = (el / finished) * (jobs.length - finished);
      console.log(`[${finished}/${jobs.length}] ${job.id}  已用 ${Math.round(el / 60)} 分，预计还要 ${Math.round(eta / 60)} 分`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, ahead) }, () => worker()));
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === 'upload' && rest.length === 2) return upload(rest[0]!, rest[1]!);
  if (cmd === 'run' && rest.length >= 1) {
    const ahead = Number(process.env['COMFY_AHEAD'] ?? 3);
    return run(rest[0]!, (rest[1] ?? '').split(',').filter((x) => x !== ''), ahead);
  }
  console.log('用法: pilot.ts upload <本地目录> <远端子目录> | run <jobs.json> [id,…]（需 COMFY_URL）');
  process.exitCode = 1;
}

// ⚠️ 不能比 `file://${argv[1]}`：路径里有中文，import.meta.url 是转义过的
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
