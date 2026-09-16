/*
 * 開局跳伞过场 —— 按原版的 **MCI 回退分支**实播（见下）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2 / C-DET-4：过场是**纯表现** —— 不派任何 action，
 *   结束后才让引擎自己走 `startTurn`，与「有没有看过过场」无关。
 *
 * ## 原版这条路（两条，不是一条）
 *
 * `fcn_00415872`（VA 0x00415872）先 `fcn_00451677` 用 `mciSendStringA` 播
 * `AIRPLANE.AVI` / `FLYTW|FLYCHINA|FLYJP|FLYUS.AVI`；**MCI 打开失败就返回 0**，
 * 于是走**回退分支**（`test esi,esi / jne near loc_00415cad`）：
 *
 * ```asm
 * ; ── 回退：不用 AVI，用 jump.mkf 里的画面与 FLIC ──
 * read_mkf(jump.mkf, 0x2d)        ; 15 张 640×480 的底图
 * blit(#0x2d 的图 1, (0,0))       ; 整屏底
 * play_sound_effect(Effect.mkf #25)
 * fcn_0045144f(#0x2e, 0xb4, 0x3c, …)  ; FLIC：15 帧 220×240，落 (180,60)（= 0xb4/0x3c）
 * fcn_0045144f(#0x2f + 角色号, …)     ; 每个角色一段自己的 FLIC
 * ```
 *
 * ⚠️ 那 21 个 AVI **在原版安装盘里就是残档**（每个恰好 5112 字节、`movi` 里只有
 *   1 个 338 字节的块，却在 `avih` 里声明 15 帧），编码是专有 Indeo 4.1（`IV41`）。
 *   所以「照原版的回退分支」不是退而求其次，**它才是这份素材能走的唯一一条真路**。
 *   素材都在：`assets-clean/jump/0045_000..014.png`（资源 0x2d 的 15 张 640×480）、
 *   `0046.bin`（资源 0x2e 的 FLIC）、`0047.bin..0052.bin`（每个角色一段）。
 *
 * 本模块因此**不再画占位框**：有素材就实播回退分支，素材缺了就只留一行跳过提示。
 */
import { FONT_FAMILY } from './font.ts';
import type { ArchiveName } from './assets.ts';

/** 过场画面尺寸 @source `Airplane.avi` 的 `strf`：312 × 160（**仅 AVI 那一条路**）*/
export const INTRO_SIZE = { w: 0x138, h: 0xa0 } as const;

/** 帧数 @source `avih` 的 `dwTotalFrames` = 15（回退那支同样是 15 帧）*/
export const INTRO_FRAMES = 15;

/** 每帧多少微秒 @source `avih` 的 `dwMicroSecPerFrame` = 0x1046b = 66667（≈15 fps） */
export const INTRO_FRAME_US = 0x1046b;

/** 跳伞 FLIC（资源 0x2e）的落点 @source `fcn_0045144f` 的 `push 0xb4 / push 0x3c` */
export const INTRO_JUMP_AT = { x: 0xb4, y: 0x3c } as const;

/** 资源号：底图（15 张 640×480）、跳伞 FLIC、每个角色那段 FLIC 的基数 */
export const INTRO_BASE_RESOURCE = 0x2d;
export const INTRO_JUMP_RESOURCE = 0x2e;
export const INTRO_CHARACTER_RESOURCE = 0x2f;

/** 过场那一下音效 @source 回退分支的 `_rich4_play_sound_effect(&0x4750f8)` */
export const INTRO_SOUND = 25;

/** 整段过场多长（毫秒）—— 15 × 66.667 ≈ 1000 ms */
export function introMs(frames: number = INTRO_FRAMES): number {
  return Math.max(0, frames) * (INTRO_FRAME_US / 1000);
}

/**
 * 过场该结束了吗 —— **放完**或**用户跳过**都算。
 *
 * 原版是可跳过的（跳过就立刻进棋盘）；这里把「跳过」抽成参数，
 * 于是这条判据是纯函数、可测。
 */
export function introDone(
  startedAt: number,
  now: number,
  skipped: boolean,
  frames: number = INTRO_FRAMES,
): boolean {
  return skipped || now - startedAt >= introMs(frames);
}

/**
 * 过场底下的那行提示。
 *
 * ★ **给玩家看的字，不许出现内部编号**（`Q-INTRO-1` / `T-xxx` 这类）——
 *   先前这里写的是「開場動畫（原版為 AIRPLANE.AVI，見 Q-INTRO-1）—— 按任意鍵跳過」，
 *   把内部 issue 号漏到了玩家面前。现在只留这一句。
 *   画面本身仍拿不到（AVI 是残档 + 专有编码），见 `docs/known-deviations.md` Q-INTRO-1。
 */
export const INTRO_HINT = '按任意鍵跳過';

/**
 * 画过场。内容拿不到（Q-INTRO-1），故只画**原版那块画面的位置与尺寸**
 * （居中 312×160）与一行「跳过」提示 —— 不自己编内容。
 *
 * 画面位置与时长仍照原版 AVI（312×160、15 帧、66667 µs/帧），行为没变；
 * 只是提示文字不再带内部编号。
 */
/** 取一张图 —— 与 `UiScreenEnv.sprite` 同一个签名（只用到这几个字段）*/
export type IntroSpriteFn = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => IntroSprite | null;

export interface IntroSprite {
  bitmap: CanvasImageSource;
  anchorX: number;
  anchorY: number;
}

/** 当前播到第几帧 FLIC（`null` = 还没解好）*/
export type IntroFlicFn = (archive: ArchiveName, resource: number) => IntroFlic | null;

export interface IntroFlic {
  frames: readonly CanvasImageSource[];
  frameMs: number;
}

/** 播过场要的外部句柄；不传就退化成「只画一行跳过提示」*/
export interface IntroDeps {
  sprite?: IntroSpriteFn;
  flic?: IntroFlicFn;
  playEffect?: (id: number) => void;
  /** 用哪张角色 FLIC（`INTRO_CHARACTER_RESOURCE + character`）*/
  character?: number;
  /** 已经放过那一下音效没有（调用方持有，避免每帧重放）*/
  soundPlayed?: boolean;
}

/**
 * 画过场。
 *
 * ★ 2026-09-16：**按原版的回退分支实播**（不再是占位框）。
 *   顺序照 `fcn_00415872` 的回退支：底图（`jump.mkf` #0x2d 的图 1，整屏）→
 *   音效 `Effect.mkf` #25（只放一次）→ 跳伞 FLIC（#0x2e）落 (180,60) →
 *   角色 FLIC（#0x2f + 角色号）。
 *
 * 任何一张图/影片没解好都**静默跳过那一步**（其余照画），最后永远留一行
 * `INTRO_HINT` —— 玩家至少知道可以按任意键。
 */
export function drawIntro(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  frames: number = INTRO_FRAMES,
  deps: IntroDeps = {},
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const frame = Math.min(
    Math.max(1, frames),
    Math.floor(elapsedMs / (INTRO_FRAME_US / 1000)) + 1,
  );

  // ── ① 底图：`jump.mkf` #0x2d 的**图 1**，不透明铺满（原版的 640×480 底）──
  const base = deps.sprite?.('jump.mkf', INTRO_BASE_RESOURCE, 1, false) ?? null;
  if (base !== null) {
    ctx.drawImage(base.bitmap, 0, 0);
  }

  // ── ② 音效（只放一次）——原版就在贴完底图、起播 FLIC 之前 ──
  if (deps.soundPlayed !== true) deps.playEffect?.(INTRO_SOUND);

  // ── ③ 跳伞 FLIC：落 (180,60)，帧序按时间推 ──
  drawIntroFlic(ctx, deps.flic?.('jump.mkf', INTRO_JUMP_RESOURCE) ?? null, INTRO_JUMP_AT, elapsedMs);

  // ── ④ 角色 FLIC：`0x2f + 角色号`（原版随后就播它）──
  if (deps.character !== undefined) {
    drawIntroFlic(
      ctx,
      deps.flic?.('jump.mkf', INTRO_CHARACTER_RESOURCE + deps.character) ?? null,
      { x: 0, y: 0 },
      elapsedMs,
    );
  }

  // ── ⑤ 「按任意键跳过」——永远是最后一行 ──
  ctx.fillStyle = '#c8ccd4';
  ctx.font = `14px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(INTRO_HINT, width / 2, height - 12);

  // 素材没接上时给个可见的落点，免得玩家对着一整屏黑
  if (base === null) {
    const at = { x: (width - INTRO_SIZE.w) / 2, y: (height - INTRO_SIZE.h) / 2 };
    ctx.fillStyle = '#101820';
    ctx.fillRect(at.x, at.y, INTRO_SIZE.w, INTRO_SIZE.h);
    ctx.fillStyle = '#5a6472';
    ctx.fillRect(at.x, at.y + INTRO_SIZE.h - 3, (INTRO_SIZE.w * frame) / frames, 3);
  }
}

/** 按时间播一段 FLIC；没解好就什么都不画 @source `fcn_0045144f` */
function drawIntroFlic(
  ctx: CanvasRenderingContext2D,
  flic: IntroFlic | null,
  at: { x: number; y: number },
  elapsedMs: number,
): void {
  if (flic === null || flic.frames.length === 0) return;
  const ms = flic.frameMs > 0 ? flic.frameMs : INTRO_FRAME_US / 1000;
  const i = Math.min(flic.frames.length - 1, Math.floor(elapsedMs / ms));
  const bmp = flic.frames[i];
  if (bmp === undefined) return;
  ctx.drawImage(bmp, at.x, at.y);
}
