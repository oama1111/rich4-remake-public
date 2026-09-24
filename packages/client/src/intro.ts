/*
 * 開局跳傘過場 —— 逐段照原版 `fcn_00415872` 的「MCI 回退分支」實播
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2 / C-DET-4：過場是**純表現** —— 不派任何 action，
 *   結束後才讓引擎自己走 `startTurn`，與「有沒有看過過場」無關。
 *
 * ## 原版這條路（兩條，不是一條）
 *
 * `fcn_00415872`（VA 0x00415872）先 `fcn_00451677` 用 `mciSendStringA` 播
 * `AIRPLANE.AVI` / `FLYTW|FLYCHINA|FLYJP|FLYUS.AVI`；**MCI 開啟失敗就返回 0**，
 * 於是走**回退分支**（`test esi,esi / jne near loc_00415cad`）：
 *
 * ```asm
 * ; ── 裝載（回退分支與 AVI 分支共用）──
 * 0041588e  push 0x2d / call mkf_read_resource   ; ★ jump.mkf #0x2d = SMP，15 張圖
 * 004158a2  push 0x2e / call mkf_read_resource   ; ★ jump.mkf #0x2e = OPENDOOR.FLC
 * 0041588e… 每個玩家各一張跳傘 FLIC：
 * 004158db  imul eax, ebx, 0x68                  ; ebx = 玩家序號
 * 004158e0  mov  cl, byte [eax + 0x496b7b]       ; ★ cl = players[ebx].character
 * 004158e6  mov  eax, esi / shl 2 / sub eax,esi / shl 2   ; eax = sheet*12
 * 004158f0  add  eax, 0x2f / add eax, ecx        ; ★ 資源號 = 0x2f + sheet*12 + character
 * 004158f7  call mkf_read_resource               ; 存進 [0x48bd90 + sheet*16 + player*4]
 * ; ── 回退分支（esi = MCI 結果 = 0）──
 * 0041598b  blitRect([0x48a08c], 0x2d 的表 + 0xc, 0, 0)   ; ★ 底圖 = 第 0 張（(0,0)）
 * 004159e1  BltFast(主表面, 0, 0, 0x48a0e0, {0,0,640,480}, 0x10)
 * 004159f2  push -1 / push 3 / push 0x3c / push 0xb4       ; ★ 開門 FLIC 落 (180,60)
 * 00415a03  push [0x48bdb4] / call fcn_0045144f
 * 00415a14  movzx edi, byte [0x496b7b]                     ; players[0].character
 * 00415a1b  cmp esi, [0x499114] / jg 0x415bd3              ; ★ 迴圈跑 0..玩家數
 * 00415a5f  mov eax,[0x48bdb0] / add eax,0xc               ; ★ 第 0 張底圖
 * 00415a6d  call sub_004562cc                              ; 還原艙門那塊 (180,60,220×240)
 * 00415aa4  … 角色立繪 0x2d 表 +0xc +(角色+3)*12 → (270,220)
 * 00415ac7  … 門框邊  0x2d 表 +0x24（= 第 2 張）→ (150,60)
 * 00415b58  mov ebx,[esi*4 + 0x48bd8c]                     ; ★ 該玩家的 Jxx.FLC
 * 00415b60  call fcn_0045144f                              ;   落 (0,0)
 * 00415bfc  blitRect([0x48a08c], 0x2d 的表 + 0x18, 0, 0)   ; ★ 換第 1 張（天空）
 * 00415c48  BltFast(主表面, 0, 0, 0x48a0e0, {0,0,640,480}, 0x10)
 * 00415c76  mov edi,[esi*4 + 0x48bda0]                     ; ★ 該玩家的 Fxx.FLC（降落傘）
 * 00415c7e  call fcn_0045144f                              ;   落 (0,0)
 * ```
 *
 * ⚠️ 那 21 個 AVI **在原版安裝盤裡就是殘檔**（每個恰好 5112 位元組、`movi` 裡只有
 *   1 個 338 位元組的塊，卻在 `avih` 裡宣告 15 幀），編碼是專有 Indeo 4.1（`IV41`）。
 *   所以「照原版的回退分支」不是退而求其次，**它才是這份素材能走的唯一一條真路**。
 *
 * ## ★ 規格（全部實測自 `rich4-remake/assets/game/jump.mkf` 的資源頭）
 *
 * | 資源 | 檔案 | 尺寸 | 幀數 | ms/幀 | 落點 |
 * |---|---|---|---|---|---|
 * | `#0x2d` | SMP，15 張 | 圖 0 = 640×480 機身+艙門／圖 1 = 640×480 天空 | — | 靜態 | (0,0) |
 * | `#0x2e` | `D:\RICH4\PARA\OPENDOOR.FLC` | 220×240 | **15** | **71** | **(180,60)** |
 * | `#0x2f+角色` | `C:\MAKE\JUMP\J01..J12.FLC` | 640×480 | 見 `INTRO_JUMP_FRAMES` | **28** | (0,0) |
 * | `#0x3b+角色` | `D:\RICH4\JUMP\F01..F12.FLC` | 640×480 | 見 `INTRO_FALL_FRAMES` | 見 `INTRO_FALL_FRAME_MS` | (0,0) |
 *
 * 也就是說：**片頭是一段 13 秒左右的長鏡頭**（以 4 人局為例
 * `15×71 + Σ(J 幀×28) + Σ(F 幀×各自 ms) ≈ 12.98 s`），不是 1 秒。
 * 原版可跳過（`fcn_0045144f` 的 `[0x48c880]` = 旗標 bit1 → 點擊/按鍵即中斷）。
 *
 * ## ★ 為什麼「只畫底圖 + 一段 FLIC」不等於原版
 *
 * 原版有兩個表面（`0x401677` 起 `CreateSurface` 出來的主表面 `[0x48a0dc]`
 * 與 640×480 離屏面 `[0x48a0e0]`），畫面**只從主表面出來**：
 *
 * - `fcn_0045144f`（FLIC 播放器）**自己往主表面寫**（VA 0x00450f80 `Lock(主表面)`
 *   → `esi = [0x48a08c] + 位移`；`[0x48a08c]` = `[0x48a068 + 0x24]` = 鎖定到的
 *   像素指標，`0x48a068` 就是那張 `DDSURFACEDESC`）—— 所以三段 FLIC 都可見；
 * - 而迴圈裡畫的**角色立繪**（`0x2d` 表第 `3+角色` 張）與**門框邊**（第 2 張）
 *   只落在**離屏面**上，主表面那幾次 `BltFast` 只刷新 (320,400)-(640,480) 與
 *   (0,440)-(640,480) 兩塊 —— **立繪/門框邊在原版屏幕上從來沒露過面**。
 *   （實測：立繪落點 (174,102)-(309,259) 與那兩塊**不相交**。）
 *   故本模組**不畫**它們，只登記這條事實（`INTRO_FIGURE_IMAGE_BASE` /
 *   `INTRO_DOOR_EDGE_IMAGE`）—— 畫上去會憑空多出一個「第二個自己」。
 *
 * 四名角色「輪流出場」靠的是**每個角色各一張 Jxx.FLC**：J 段的**第 0 幀就是
 * 該角色站在艙門口的站姿**（實測 J01 第 0 幀非透明包圍盒 (224,122)-(358,279)，
 * 與立繪同一姿態、位置差 (50,20)），第 0 幀之後才跳出去。
 *
 * ⚠️ 原版 J 段的讀表是**錯開一格**的：迴圈跑到第 p 圈時
 * `mov ebx,[esi*4 + 0x48bd8c]` 取到的是 `T[0][p-1]`（`T` 基址其實是 `0x48bd90`），
 * 而那一圈畫的是 `players[p]` 的立繪 —— 因為立繪只進離屏面（見上），
 * **屏幕上看到的順序仍是 0,1,2,3**。本模組照「屏幕上看得到的順序」配對
 * （第 p 位角色 ↔ 第 p 張 Jxx.FLC）。⚠️ 本條**尚未**寫進 `docs/`（本次改動範圍不含
 *   `docs/**`），需要在 `docs/known-deviations.md` 補一條登記。
 */
import { FONT_FAMILY } from './font.ts';
import type { ArchiveName } from './assets.ts';
import { drawSprite } from './hd-stage.ts';

/** 過場整屏尺寸（原版主表面 640×480，`0x40163d` 的 `SetDisplayMode(0x280,0x1e0,0x10)`）*/
export const INTRO_SIZE = { w: 0x280, h: 0x1e0 } as const;

/** 資源號：`jump.mkf` 的 SMP 圖集（15 張：0/1 = 底圖、2 = 門框邊、3..14 = 12 個角色）*/
export const INTRO_SHEET_RESOURCE = 0x2d;
/** 機身 + 打開的艙門（640×480）—— 開場底圖 @source `add eax,0xc`（= 第 0 項）*/
export const INTRO_CABIN_IMAGE = 0;
/** 天空（640×480）—— 跳傘段底圖 @source `add eax,0x18`（= 第 1 項）*/
export const INTRO_SKY_IMAGE = 1;
/** 門框左緣（96×240）—— **只進離屏面**，原版屏幕上不露 @source `add eax,0x24`*/
export const INTRO_DOOR_EDGE_IMAGE = 2;
/** 角色立繪的圖號基數：圖號 = `3 + character` @source `lea edx,[edi+3]` + 12 位元組/項 */
export const INTRO_FIGURE_IMAGE_BASE = 3;

/** 開門 FLIC @source `mkf_read_resource(jump.mkf, 0x2e, 0, 0)` VA 0x004158a2 */
export const INTRO_DOOR_RESOURCE = 0x2e;
/** 跳出去 FLIC 的資源基數（+ 角色號）@source VA 0x004158f0 `add eax,0x2f` */
export const INTRO_JUMP_RESOURCE_BASE = 0x2f;
/** 降落傘 FLIC 的資源基數（+ 角色號）@source VA 0x00415c76 `[esi*4 + 0x48bda0]` */
export const INTRO_FALL_RESOURCE_BASE = 0x3b;

/** 開門 FLIC 落點 @source `push 0x3c` / `push 0xb4`（VA 0x004159f6/0x004159f8）*/
export const INTRO_DOOR_AT = { x: 0xb4, y: 0x3c } as const;
/** 角色立繪落點 @source `push 0xdc` / `push 0x10e`（VA 0x00415aac/0x00415ab1）*/
export const INTRO_FIGURE_AT = { x: 0x10e, y: 0xdc } as const;
/** 門框邊落點 @source `push 0x3c` / `push 0x96`（VA 0x00415acf/0x00415ad1）*/
export const INTRO_DOOR_EDGE_AT = { x: 0x96, y: 0x3c } as const;
/** 三支 FLIC 都貼在 (0,0) @source `push 0` / `push 0`（VA 0x00415b4d/0x00415c6e）*/
export const INTRO_FLIC_AT = { x: 0, y: 0 } as const;

/** 開門 FLIC 幀數／每幀毫秒 —— 讀自 `OPENDOOR.FLC` 自己的頭 */
export const INTRO_DOOR_FRAMES = 15;
export const INTRO_DOOR_FRAME_MS = 71;

/** J（跳出去）那 12 段的每幀毫秒 —— `J01..J12.FLC` 頭裡全是 28 */
export const INTRO_JUMP_FRAME_MS = 28;
/** J01..J12 的幀數（索引 = 角色號）*/
export const INTRO_JUMP_FRAMES: readonly number[] = [
  40, 48, 43, 48, 48, 48, 49, 45, 48, 44, 42, 48,
];

/** F01..F12 的幀數（索引 = 角色號）*/
export const INTRO_FALL_FRAMES: readonly number[] = [
  37, 42, 36, 42, 45, 43, 40, 41, 36, 43, 42, 43,
];
/** F01..F12 的每幀毫秒（索引 = 角色號）—— 只有 F10 是 71，其餘 42 */
export const INTRO_FALL_FRAME_MS: readonly number[] = [
  42, 42, 42, 42, 42, 42, 42, 42, 42, 71, 42, 42,
];

/** 過場那一下音效 @source 回退分支的 `_rich4_play_sound_effect(&0x4750f8)` */
export const INTRO_SOUND = 25;

/** 底圖圖集的檔名（三段 FLIC 與 15 張圖都在這一份裡）*/
export const INTRO_ARCHIVE: ArchiveName = 'jump.mkf';

/**
 * 過場底下的那行提示。
 *
 * ★ **給玩家看的字，不許出現內部編號**（`Q-INTRO-1` / `T-xxx` 這類）。
 */
export const INTRO_HINT = '按任意鍵跳過';

/** 過場的一段 —— 螢幕上看得到的那些（順序 = 原版的貼圖順序）*/
export interface IntroSegment {
  /** `cabin`/`sky` = SMP 底圖；`door`/`jump`/`fall` = 三段 FLIC */
  kind: 'cabin' | 'door' | 'jump' | 'sky' | 'fall';
  /** `jump.mkf` 資源號 */
  resource: number;
  /** SMP 圖號（只有 `cabin`/`sky` 有）*/
  image: number;
  /** 落點（螢幕座標）*/
  at: { x: number; y: number };
  /** 這一幀序列有幾張 —— 靜態底圖是 1 */
  frames: number;
  /** 每幀停留多少毫秒 —— 靜態底圖是 0 */
  frameMs: number;
  /** 這一段畫的是哪一號角色（底圖是 -1）*/
  character: number;
}

/** 這一號角色的 J（跳出去）資源號 */
export function introJumpResource(character: number): number {
  return INTRO_JUMP_RESOURCE_BASE + character;
}

/** 這一號角色的 F（降落傘）資源號 */
export function introFallResource(character: number): number {
  return INTRO_FALL_RESOURCE_BASE + character;
}

/**
 * 整個片頭的**分段序列** —— 純函數、可單測。
 *
 * 順序完全照 `fcn_00415872` 的回退分支：
 * 底圖 0（機身+艙門）→ 開門 FLIC → 逐個玩家一段 Jxx.FLC → 底圖 1（天空）
 * → 逐個玩家一段 Fxx.FLC（背降落傘下降）。
 *
 * ★ 每個玩家**各有兩段**（J + F），資源號都由**該玩家的角色號**索引 ——
 *   這就是「NPC 角色也要出場」那條契約。
 */
export function introSegments(characters: readonly number[]): IntroSegment[] {
  const segs: IntroSegment[] = [
    {
      kind: 'cabin',
      resource: INTRO_SHEET_RESOURCE,
      image: INTRO_CABIN_IMAGE,
      at: { x: 0, y: 0 },
      frames: 1,
      frameMs: 0,
      character: -1,
    },
    {
      kind: 'door',
      resource: INTRO_DOOR_RESOURCE,
      image: -1,
      at: INTRO_DOOR_AT,
      frames: INTRO_DOOR_FRAMES,
      frameMs: INTRO_DOOR_FRAME_MS,
      character: -1,
    },
  ];
  for (const c of characters) {
    segs.push({
      kind: 'jump',
      resource: introJumpResource(c),
      image: -1,
      at: INTRO_FLIC_AT,
      frames: INTRO_JUMP_FRAMES[c] ?? INTRO_JUMP_FRAMES[0]!,
      frameMs: INTRO_JUMP_FRAME_MS,
      character: c,
    });
  }
  segs.push({
    kind: 'sky',
    resource: INTRO_SHEET_RESOURCE,
    image: INTRO_SKY_IMAGE,
    at: { x: 0, y: 0 },
    frames: 1,
    frameMs: 0,
    character: -1,
  });
  for (const c of characters) {
    segs.push({
      kind: 'fall',
      resource: introFallResource(c),
      image: -1,
      at: INTRO_FLIC_AT,
      frames: INTRO_FALL_FRAMES[c] ?? INTRO_FALL_FRAMES[0]!,
      frameMs: INTRO_FALL_FRAME_MS[c] ?? 42,
      character: c,
    });
  }
  return segs;
}

/** 一段播多久（毫秒）= 幀數 × 每幀毫秒 @source `fcn_0045144f` 的節拍迴圈 */
export function introSegmentMs(seg: IntroSegment): number {
  return seg.frames * seg.frameMs;
}

/** 整段過場多長（毫秒）*/
export function introMs(characters: readonly number[]): number {
  return introSegments(characters).reduce((sum, s) => sum + introSegmentMs(s), 0);
}

/** 這一刻播到哪一段的第幾幀（純函數）*/
export interface IntroCursor {
  /** 第幾段（0 基）*/
  index: number;
  /** 這一段內已過去多少毫秒 */
  localMs: number;
  /** 這一段的第幾幀（0 基）*/
  frame: number;
}

/**
 * 把「過了多少毫秒」換算成「哪一段的第幾幀」。
 *
 * ★ 每段一小時鐘：靜態底圖（`frameMs === 0`）0 毫秒，FLIC 是「幀數 × 幀毫秒」。
 *   超過整段長度就停在最後一段的最後一幀。
 */
export function introCursorAt(
  segments: readonly IntroSegment[],
  elapsedMs: number,
): IntroCursor | null {
  if (segments.length === 0) return null;
  let t = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const dur = introSegmentMs(seg);
    if (elapsedMs < t + dur || i === segments.length - 1) {
      const local = Math.max(0, Math.min(elapsedMs - t, Math.max(0, dur - 1)));
      const frame = seg.frameMs > 0 ? Math.floor(local / seg.frameMs) : 0;
      return { index: i, localMs: Math.max(0, elapsedMs - t), frame: Math.min(frame, seg.frames - 1) };
    }
    t += dur;
  }
  /* istanbul ignore next —— 迴圈最後一圈必定 return */
  return null;
}

/**
 * 過場該結束了嗎 —— **放完**或**用戶跳過**都算。
 *
 * 原版是可跳過的（`fcn_0045144f` 每幀都看 `[0x48c880]`，點擊/按鍵就中斷，
 * 且整段片頭是四段 FLIC 串起來的，每段都能單獨跳過）；
 * 這裡把「跳過」抽成參數，於是這條判據是純函數、可測。
 */
export function introDone(
  startedAt: number,
  now: number,
  skipped: boolean,
  characters: readonly number[],
): boolean {
  return skipped || now - startedAt >= introMs(characters);
}

/** 取一張圖 —— 與 `UiScreenEnv.sprite` 同一個簽名（只用到這幾個欄位）*/
export type IntroSpriteFn = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => IntroSprite | null;

export interface IntroSprite {
  bitmap: CanvasImageSource;
  /** 逻辑宽高（超分图的像素比它大，见 `hd-stage.ts`）*/
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

/** 取一段 FLIC —— 與 `UiScreenEnv.flic` 同一個簽名 */
export type IntroFlicFn = (archive: ArchiveName, resource: number) => IntroFlic | null;

export interface IntroFlic {
  frames: readonly CanvasImageSource[];
  frameMs: number;
  /** 逻辑宽高（超分帧位图更大，画时塞回这个框；见 `hd-stage.ts`）*/
  width: number;
  height: number;
}

/** 播過場要的外部句柄；不傳就退化成「只畫一行跳過提示」*/
export interface IntroDeps {
  sprite?: IntroSpriteFn;
  flic?: IntroFlicFn;
  playEffect?: (id: number) => void;
  /**
   * 這一局有哪些角色（`players[].character`，0..11）—— **每個角色兩段 FLIC**。
   * 不傳 = 沒有角色（只播底圖與開門那一段）。
   */
  characters?: readonly number[];
  /** 已經放過那一下音效沒有（呼叫方持有，避免每幀重放）*/
  soundPlayed?: boolean;
}

/**
 * 畫過場。
 *
 * ★ 2026-09-18：**按原版的回退分支逐段實播**，而且時間軸 = 各段真實時長。
 *   先前這裡把整段過場的長度當成 `Airplane.avi` 的 `avih`（15 幀 × 66.667 ms
 *   = 1 s），於是：開門那 15×71 ms = 1.065 s 被砍掉最後一幀，
 *   而四段 Jxx.FLC 與四段 Fxx.FLC（降落傘）**一幀都沒播**。
 *
 * 任何一張圖/影片沒解好都**靜默跳過那一步**（其餘照畫），最後永遠留一行
 * `INTRO_HINT` —— 玩家至少知道可以按任意鍵。
 */
export function drawIntro(
  ctx: CanvasRenderingContext2D,
  elapsedMs: number,
  deps: IntroDeps = {},
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const segments = introSegments(deps.characters ?? []);
  const cursor = introCursorAt(segments, elapsedMs);
  if (cursor === null) return;

  // ── 音效（只放一次）——原版就在鋪完底圖、起播 FLIC 之前 ──
  if (deps.soundPlayed !== true) deps.playEffect?.(INTRO_SOUND);

  /**
   * ★ 只從**最後一個已經開始的底圖**往後畫：底圖是 640×480 不透明整屏，
   *   它之前畫過的東西全被蓋掉（原版也是整面 `BltFast` 過去）——
   *   這樣整段 13 秒裡每幀的貼圖次數都壓在「1 張底圖 + 幾段 FLIC」。
   */
  let from = 0;
  for (let i = 0; i <= cursor.index; i++) {
    const k = segments[i]!.kind;
    if (k === 'cabin' || k === 'sky') from = i;
  }
  for (let i = from; i <= cursor.index; i++) {
    const seg = segments[i]!;
    const frame = i === cursor.index ? cursor.frame : seg.frames - 1;
    paintSegment(ctx, seg, frame, deps);
  }

  // ★ 預熱下一段 FLIC（解碼是異步的：不先叫，這一段開頭幾幀會是空的）
  const next = segments[cursor.index + 1];
  if (next !== undefined && next.frameMs > 0) deps.flic?.(INTRO_ARCHIVE, next.resource);

  // ── 「按任意鍵跳過」——永遠是最後一行 ──
  ctx.fillStyle = '#c8ccd4';
  ctx.font = `14px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(INTRO_HINT, width / 2, height - 12);

  // 素材沒接上時給個可見的落點，免得玩家對着一整屏黑
  const cabin = deps.sprite?.(INTRO_ARCHIVE, INTRO_SHEET_RESOURCE, INTRO_CABIN_IMAGE, false) ?? null;
  if (cabin === null) {
    const w = 320;
    const h = 200;
    const at = { x: (width - w) / 2, y: (height - h) / 2 };
    ctx.fillStyle = '#101820';
    ctx.fillRect(at.x, at.y, w, h);
    const total = introMs(deps.characters ?? []);
    const done = total > 0 ? Math.min(1, elapsedMs / total) : 1;
    ctx.fillStyle = '#5a6472';
    ctx.fillRect(at.x, at.y + h - 3, w * done, 3);
  }
}

/** 畫一段；沒解好就什麼都不畫 @source `fcn_0045144f` / `blitRect` */
function paintSegment(
  ctx: CanvasRenderingContext2D,
  seg: IntroSegment,
  frame: number,
  deps: IntroDeps,
): void {
  if (seg.frameMs === 0) {
    // 底圖：SMP 的一張，不透明鋪在落點（原版 `blitRect(surface, 表+0xc/0x18, 0, 0)`）
    const img = deps.sprite?.(INTRO_ARCHIVE, seg.resource, seg.image, false) ?? null;
    if (img !== null) drawSprite(ctx, img, seg.at.x, seg.at.y);
    return;
  }
  const flic = deps.flic?.(INTRO_ARCHIVE, seg.resource) ?? null;
  if (flic === null || flic.frames.length === 0) return;
  const i = Math.max(0, Math.min(frame, flic.frames.length - 1));
  const bmp = flic.frames[i];
  if (bmp === undefined) return;
  // FLIC 帧按影片的**逻辑**尺寸画：超分帧位图更大，塞回同一个框（`hd-stage.ts`）
  drawSprite(ctx, { bitmap: bmp, width: flic.width, height: flic.height }, seg.at.x, seg.at.y);
}
