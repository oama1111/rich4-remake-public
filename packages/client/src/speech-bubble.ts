/*
 * 角色台词的**屏幕呈现** —— 「谁在说、说什么、说到什么时候」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 本文件与 `speech.ts`（触发点探测器：什么局面下谁说哪个槽位）分工不同：
 *   `speech.ts` → `SayEvent[]`（玩家下标 + 槽位号）
 *   本文件      → 把 `SayEvent` 补上**台词文本 / 表情图 / 语音号**，并管一段时长。
 *
 * ── 原版怎么显示（`_rich4_player_say`，VA 0x0044ef41）────────────────
 *
 * 原版这一段是**阻塞**的，整段只有 5 步（逐条 VA 见下表），画完 `fcn_004544f6(1000)`
 * 等 1 秒 —— 期间按任意键/鼠标还能提前收场（那 1000 ms 是「等消息」不是 `Sleep`）。
 *
 * | 步 | 原版做什么 | VA |
 * |---|---|---|
 * | ① | 在**棋盘表面**上 `_rich4_draw_text(串, 0xc8, 0x28, 5)` —— 白字 + 黑描边，落在 **(200, 40)**，最多 5 行 | 0x0044f140 |
 * | ② | 若串是 `@DD`：把 `Data.mkf #0x207` 的第 `3×十位+个位−1` 张图贴到 **(0xf0, 0x82) = (240, 130)** | 0x0044f08a |
 * | ③ | 若串带 `#NNNN`：`fcn_0045441a(NNNN)` 播 `Speaking.mkf` 的那一段语音 | 0x0044f20x |
 * | ④ | 用 `fcn_00451a97(0,0,0x28,0x1b8,0xdc, 0x46caec)` **从棋盘面上抠下** `RECT(0,40,200,220)` 存到离屏面 | 0x0044efb0 |
 * | ⑤ | 把角色**名牌**（`Data.mkf #0x205` 资源基址 `+0x54` = 图 7，400×89）贴到离屏面的 `(0xaa, 0x82)` | 0x0044f00x |
 * | ⑥ | 把离屏面 Blt 回 **(0, 40)**，再 `free` | 0x0044f157 起 |
 *
 * ★ 所以原版的观感是：**白字字幕压在棋盘上方**（第 ① 步直接画在棋盘上、不被第 ④ 步
 *   的抠图吃掉，因为抠图存的是离屏副本），然后一个**带角色名牌的截图方块**盖在
 *   左上角 200×220 那块 —— 方块里是发话前一瞬间的棋盘（像拍立得）。
 *
 * ── 本引擎怎么做（有意偏离，登记在 `docs/deviations/T-052.md`）──────────
 *
 * 原版那套「抠棋盘 + 贴名牌」依赖 `SelectObject` / Blt 那台**离屏 DirectDraw 表面**，
 * 本引擎的棋盘每帧整体重画、没有等价的可读回表面。于是：
 *   1. 名牌那一块**不贴**（原版那个 400×89 的名牌贴上去会把 200 宽的气泡整个盖住，
 *      而且它在 640 宽屏上必然溢出 —— 见偏离登记 Q-SPEECH-4）；
 *   2. 白字字幕（第 ① 步）**照原样**画，它是原版真正让玩家读到台词的那一步；
 *   3. 表情图（第 ② 步）**照原样**画在 (240, 130)；
 *   4. 时长取原版那个 1000 ms（`fcn_004544f6(0x3e8)`）。
 *
 * ⚠️ 本模块是**纯表现**：不读 DOM、不碰音频、不动 PRNG、不写 `GameState`（C-DET-1/2/4）。
 *   取图那一步交给调用方传进来的 `sprite` 出口（`main.ts` 的 `spriteNow`）。
 */
import { speechEmojiImage, speechIndex, speechLine, type SpeechLine } from '@rich4/data';
import type { Sprite } from './assets.ts';
import type { SayEvent } from './speech.ts';

/** 取图出口 —— 与 `main.ts` 的 `spriteNow` 同形（`ArchiveName` 里只用 `Data.mkf`）*/
export type BubbleSpriteFn = (
  archive: 'Data.mkf',
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  原版量出来的几何
// ============================================================

/**
 * 白字字幕的落点 @source VA 0x0044f140：
 * ```asm
 * 0044f140  push 5          ; 最多 5 行
 * 0044f142  push 0x82       ; y = 130
 * 0044f147  push 0xc8       ; x = 200
 * 0044f14c  push ebx        ; 串
 * 0044f14d  push 0          ; 对齐码 0
 * 0044f14e  call _rich4_draw_text
 * ```
 * ⚠️ 是 `push 0x82` 在前、`push 0xc8` 在后 ⇒ 按 `_rich4_draw_text(align, 串, x, y, 行数)`
 *   的形参顺序解出 **(x, y) = (200, 130)**。（同一个函数在 `fcn_0044f00x` 那条
 *   名牌分支里也用了 `0xaa / 0x82` 这对，交叉印证 y 是 0x82。）
 */
export const SPEECH_TEXT_AT = { x: 0xc8, y: 0x82 } as const;

/** 白字最多几行 @source 上面那条 `push 5` */
export const SPEECH_TEXT_MAX_LINES = 5;

/** 字幕的排版：字号 / 行距（原版 `_rich4_create_font(0x10, 0x101010, …)`，16 像素高）*/
export const SPEECH_TEXT_FONT_SIZE = 0x10;
export const SPEECH_TEXT_LINE_HEIGHT = 0x12;

/**
 * 表情图的落点 @source VA 0x0044f0e2 那两条 `push 0x82 / push 0xf0`
 * （`fcn_00456418(图, x, y, 表面)` —— x = 0xf0 = 240、y = 0x82 = 130）。
 */
export const SPEECH_EMOJI_AT = { x: 0xf0, y: 0x82 } as const;

/**
 * 气泡方块的矩形 @source VA 0x0044efb0 起的第 ④ 步。
 *
 * ```asm
 * mov dword [esp],     0      ; x
 * mov dword [esp + 4], 0x28   ; y = 40
 * mov dword [esp + 8], 0x1b8  ; w = 440
 * mov dword [esp + 0xc], 0x104; h = 260
 * call fcn_00451a97          ; 从棋盘面 (0,40) 抠 440×260 → 离屏面
 * ```
 *
 * ⚠️ **这里先前读错过一次**：`fcn_00451a97` 的形参是
 * `(目标缓冲, 源面, 源x, 源y, 宽, 高)`，所以 `0x1b8/0x104` 是**源矩形**的宽高，
 * 而它的落点是 `(0, 0x28)` —— 即 `RECT(0, 40, 440, 260)`，`x` 不是 0x1b8。
 * 早先按「200×220」记的那一版是把它当成 `_rich4_copy_screen_rect` 的别种形参序了。
 */
export const SPEECH_BOX = { x: 0, y: 0x28, w: 0x1b8, h: 0x104 } as const;

/**
 * 原版的静置时长（毫秒）@source VA 0x0044f19x：`push 0x3e8 / call fcn_004544f6`
 * （那个函数是「等消息或到点」的循环，`0x3b9` = 1000 就是超时）。
 */
export const SPEECH_HOLD_MS = 0x3e8;

// ============================================================
//  一段台词
// ============================================================

/** 一段**排好版**的台词 —— 可以直接画，也可以直接断言 */
export interface SpeechBubble {
  /** 玩家下标（0..3），仅用于诊断 */
  readonly player: number;
  /** 角色号（0..11） */
  readonly character: number;
  /** 槽位号（0..26） */
  readonly event: number;
  /** 说话人的**完整名字**（如「金貝貝」）*/
  readonly speaker: string;
  /** 字幕的行（已按 `\n` 拆好、去掉了空行）*/
  readonly lines: readonly string[];
  /** 语音号（`Speaking.mkf`）；金貝貝那种 `@DD` 串没有可播的语音时为 null */
  readonly voice: number | null;
  /** 表情图号（`Data.mkf #0x207`）；普通台词为 null */
  readonly emoji: number | null;
  /** 字幕落点 */
  readonly textAt: { readonly x: number; readonly y: number };
  /** 表情落点 */
  readonly emojiAt: { readonly x: number; readonly y: number };
  /** 显示多久（毫秒）*/
  readonly holdMs: number;
}

/** 把一段台词按 `\n` 拆成字幕行；丢掉空行（原版按行数上限逐行画）*/
export function bubbleLines(text: string): string[] {
  return text.split('\n').filter((l) => l !== '');
}

/**
 * 一条 `SayEvent` + 状态 → 一段可直接画的台词；角色号/槽位越界时返回 `null`。
 *
 * ⚠️ 越界**不抛**：`speechLine()`（`@rich4/data`）对越界抛 `RangeError`，
 *   那是给「表坏了」用的；表现层不该因为一份坏状态把整局炸掉（与
 *   `speech.ts` 的 `speechResourceFor` 同一条规矩）。
 */
export function speechBubbleOf(
  ev: SayEvent,
  character: number,
  speaker: string,
): SpeechBubble | null {
  let line: SpeechLine;
  try {
    line = speechLine(character, ev.event);
  } catch {
    return null;
  }
  const [emojiCode, text] = line;
  // 金貝貝那一列整列都是 `@DD` —— 文本字段就是那三个字符，没有可读的字幕
  const isEmoji = emojiCode !== null;
  return {
    player: ev.player,
    character,
    event: ev.event,
    speaker,
    lines: isEmoji ? [] : bubbleLines(text),
    // 语音号：普通台词 = `speechIndex()`（1050 + 27×角色 + 槽位）；表情串没有配音
    voice: isEmoji ? null : speechIndex(character, ev.event),
    emoji: isEmoji ? speechEmojiImage(emojiCode) : null,
    textAt: SPEECH_TEXT_AT,
    emojiAt: SPEECH_EMOJI_AT,
    holdMs: SPEECH_HOLD_MS,
  };
}

// ============================================================
//  队列（表现层状态，不进 GameState）
// ============================================================

/**
 * 台词队列 —— 原版 `_rich4_player_say` 是**一句播完再返回**，
 * 本引擎的 `playSoundFor` 一口气派出去，于是这里排队逐段演，不叠着显示。
 *
 * ★ 纯数据结构 + 纯函数：`push` / `tick` / `current` 都只碰自己这几个字段，
 *   时间由调用方传 `now` 进来（**不读 `performance.now()`**，故能单测）。
 */
export class SpeechQueue {
  private readonly items: SpeechBubble[] = [];
  private shownAt = 0;

  /** 排入若干段（保持顺序）；返回新排入的段数 */
  push(bubbles: readonly SpeechBubble[], now: number): number {
    if (bubbles.length === 0) return 0;
    const wasEmpty = this.items.length === 0;
    this.items.push(...bubbles);
    if (wasEmpty) this.shownAt = now;
    return bubbles.length;
  }

  /**
   * 到点就丢掉当前那段；返回「有没有东西变了」（调用方据此决定要不要重画）。
   *
   * ⚠️ 只丢**一段** —— 原版是 `fcn_004544f6` 一次一段地等，不是一次性清空。
   */
  tick(now: number): boolean {
    const head = this.items[0];
    if (head === undefined) return false;
    if (now - this.shownAt < head.holdMs) return false;
    this.items.shift();
    this.shownAt = now;
    return true;
  }

  /** 此刻该显示的那一段；队列空时为 null */
  current(): SpeechBubble | null {
    return this.items[0] ?? null;
  }

  /** 队列里还剩几段（含正在显示的那一段）*/
  get length(): number {
    return this.items.length;
  }

  /** 清空（换局 / 关屏）*/
  clear(): void {
    this.items.length = 0;
    this.shownAt = 0;
  }
}

// ============================================================
//  绘制
// ============================================================

export interface SpeechDrawEnv {
  readonly ctx: CanvasRenderingContext2D;
  /** 取图出口（`main.ts` 的 `spriteNow`）*/
  readonly sprite: BubbleSpriteFn;
  /** 画字的字体串（`main.ts` 的 `font()`）*/
  readonly font: (size: number) => string;
}

/**
 * 画一段台词：先字幕（原版第 ① 步），再表情图（第 ② 步）。
 *
 * ★ 调用方必须已经 `stageCtx.save()/translate()` 到**屏幕坐标**（棋盘原点），
 *   因为这两步在原版里用的就是屏幕坐标（0xc8/0x82、0xf0/0x82）。
 *
 * ⚠️ 表情图那张 `Data.mkf #0x207` 是**黑底**（原版用
 *   `_draw_non_zero_image_in_rect` = 透明色 0），所以取图时 `colorKeyBlack = true`。
 */
export function drawSpeechBubble(b: SpeechBubble, env: SpeechDrawEnv): void {
  const { ctx, sprite, font } = env;

  // ── ① 字幕：白字 + 黑描边（原版 `_rich4_create_font(0x10, 0x101010, …)`）──
  if (b.lines.length > 0) {
    ctx.save();
    ctx.font = font(SPEECH_TEXT_FONT_SIZE);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#ffffff';
    const max = Math.min(b.lines.length, SPEECH_TEXT_MAX_LINES);
    for (let i = 0; i < max; i++) {
      const y = b.textAt.y + i * SPEECH_TEXT_LINE_HEIGHT;
      const text = b.lines[i]!;
      ctx.strokeText(text, b.textAt.x, y);
      ctx.fillText(text, b.textAt.x, y);
    }
    ctx.restore();
  }

  // ── ② 表情图（金貝貝专用）──
  if (b.emoji !== null) {
    const img = sprite('Data.mkf', 0x207, b.emoji, true);
    if (img !== null) {
      ctx.drawImage(img.bitmap, b.emojiAt.x, b.emojiAt.y);
    }
  }
}
