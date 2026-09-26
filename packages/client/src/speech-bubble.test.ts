/*
 * 角色台词屏幕呈现 + 队列 —— 钉住原版 `_rich4_player_say` 的两步几何与时长
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 这一份测的是「**屏幕上出现什么**」：
 *   ① 白字字幕落点 / 行距 / 行数上限（`@source` VA 0x0044f140）；
 *   ② 金貝貝那张表情图的资源号与落点（`@source` VA 0x0044f0e2 / `rich4_load_map.asm:578`）；
 *   ③ 字幕文本**来自角色自己那一列**（不是所有人共用角色 0 的那一份）；
 *   ④ 队列逐段收（原版是一句演完再演下一句）。
 *
 * ⚠️ 真值表（324 条）的逐字校验在 `@rich4/data` 的 `speech.test.ts` 里；
 *   这里只用已经核对过的表来测「怎么显示」。
 */
import { describe, expect, it, vi } from 'vitest';
import { CHARACTERS, speechLine } from '@rich4/data';
import {
  SPEECH_BOX,
  SPEECH_EMOJI_AT,
  SPEECH_HOLD_MS,
  SPEECH_PANEL,
  SPEECH_PANEL_AT,
  SPEECH_PORTRAIT_AT,
  SPEECH_TEXT_AT,
  SPEECH_TEXT_LINE_HEIGHT,
  SPEECH_TEXT_FLAG,
  SpeechQueue,
  bubbleLines,
  drawSpeechBubble,
  speechBubbleOf,
  type SpeechBubble,
  type SpeechDrawEnv,
} from './speech-bubble.ts';
import { portraitResource } from './assets.ts';
import { characterName, speechBubblesFor } from './speech.ts';
import { makeGameState } from '@rich4/core';

/** 金貝貝 —— 唯一不说话的角色的下标 */
const JINBEIBEI = CHARACTERS.findIndex((c) => c.key === 'jinbeibei');

// ============================================================
//  几何
// ============================================================

describe('几何常量（逐条对 exe VA）', () => {
  it('字幕落点 = (200, 130) @source VA 0x0044f140 的 push 0x82 / push 0xc8', () => {
    expect(SPEECH_TEXT_AT).toEqual({ x: 0xc8, y: 0x82 });
    expect(SPEECH_TEXT_AT.x).toBe(200);
    expect(SPEECH_TEXT_AT.y).toBe(130);
  });

  it('表情落点 = (240, 130) @source VA 0x0044f0e2（与 speechEmojiImage 同源）', () => {
    expect(SPEECH_EMOJI_AT).toEqual({ x: 0xf0, y: 0x82 });
    expect(SPEECH_EMOJI_AT.x).toBe(240);
  });

  it('字幕的对齐码 = 5、行距 18（原版 16 像素字 + 2 像素空隙）', () => {
    // ★ W-64：那个 5 是 `_rich4_draw_text` 的对齐码（5 = 左对齐 + 垂直居中），
    //   不是「最多 5 行」—— 见 `SPEECH_TEXT_FLAG` 的注释。
    expect(SPEECH_TEXT_FLAG).toBe(5);
    expect(SPEECH_TEXT_LINE_HEIGHT).toBe(0x12);
  });

  it('★ 台词备份的矩形 = RECT(0, 40, 440, 220) @source VA 0x0044effa 的六个实参', () => {
    // `fcn_00451a97(dst, 源面, 源x, 源y, 宽, 高)`，调用点 0x0044effa 依次
    // `push 0xdc(高) / 0x1b8(宽) / 0x28(源y) / 0(源x) / 0(源面) / 0x46caec(dst)`
    // ⇒ 从棋盘面抠 `RECT(0,40,440,220)` 存到离屏面。
    //
    // ★ 这一块**只是「说完还原」的备份**，不是底板（W-50 的头号订正：
    //   `fd31598` 曾把它当底板用）。底图是 `SPEECH_PANEL` 那张气泡图。
    expect(SPEECH_BOX).toEqual({ x: 0, y: 0x28, w: 0x1b8, h: 0xdc });
    expect(SPEECH_BOX.w).toBe(440);
    expect(SPEECH_BOX.h).toBe(220);
    // 字幕与表情都必须落在这块矩形里（否则原版那一步「抠下来再贴回去」会裁掉它们）
    expect(SPEECH_TEXT_AT.x).toBeLessThan(SPEECH_BOX.x + SPEECH_BOX.w);
    expect(SPEECH_TEXT_AT.y).toBeGreaterThanOrEqual(SPEECH_BOX.y);
    expect(SPEECH_EMOJI_AT.y + 32).toBeLessThanOrEqual(SPEECH_BOX.y + SPEECH_BOX.h);
  });

  it('★ 气泡底图 = `Data.mkf #0x205` 图 6，落 (220,130) @source VA 0x0044f019..0x0044f033', () => {
    // `mov eax,[0x48bad8] / add eax,0x54` —— 资源头 0xc + 图 N×0xc ⇒ (0x54−0xc)/0xc = 6
    expect(SPEECH_PANEL).toEqual({ archive: 'Data.mkf', resource: 0x205, image: 6 });
    expect(SPEECH_PANEL_AT).toEqual({ x: 0xdc, y: 0x82 });
    expect(SPEECH_PANEL_AT.x).toBe(220);
    expect(SPEECH_PANEL_AT.y).toBe(130);
    // ★ 2026-09-23 订正：神明老虎机（0x004407a6 `add eax,0x48`）是图 **5**（棕色訊息框），
    //   **不是**这张 —— 全 exe 只有 player_say 用图 6（见 `dialog-templates.test.ts`）
    expect(SPEECH_PANEL.resource).toBe(0x205);
    expect(SPEECH_PANEL.image).toBe(6);
  });

  it('★ 头像落点 = (170,130) @source VA 0x0044f03b 的 `push 0x82 / push 0xaa`', () => {
    expect(SPEECH_PORTRAIT_AT).toEqual({ x: 0xaa, y: 0x82 });
    expect(SPEECH_PORTRAIT_AT.x).toBe(170);
  });

  it('显示时长 = 1000 ms @source `push 0x3e8 / call fcn_004544f6`', () => {
    expect(SPEECH_HOLD_MS).toBe(1000);
  });
});

// ============================================================
//  `SayEvent` → 段落
// ============================================================

describe('speechBubbleOf：一段台词', () => {
  it('普通角色：文本取自**自己那一列**，并且带语音号', () => {
    // 角色 3（錢夫人）事件 19 —— 台词表里是「放我出去！！！」那一档
    const b = speechBubbleOf({ player: 1, event: 19, order: 'afterStage' }, 3, '錢夫人');
    expect(b).not.toBeNull();
    expect(b!.lines).toEqual(bubbleLines(speechLine(3, 19)[1]));
    expect(b!.emoji).toBeNull();
    // 语音号 = 1050 + 27×角色 + 事件
    expect(b!.voice).toBe(1050 + 27 * 3 + 19);
    expect(b!.speaker).toBe('錢夫人');
  });

  it('★ 12 个角色同一槽位说**不同的话**（不是共用角色 0 那一列）', () => {
    const texts = CHARACTERS.map((_, c) => speechBubbleOf({ player: 0, event: 0, order: 'afterStage' }, c, 'x')!.lines.join(''));
    expect(new Set(texts).size).toBe(CHARACTERS.length);
    // 角色 0 与角色 3 的第 0 句原版就不同（「別忌妒我！」vs「今夜做夢也會笑∼」）
    expect(texts[0]).not.toBe(texts[3]);
  });

  it('多行台词按 `\\n` 拆成多行（原版逐行画）', () => {
    // 角色 0 事件 11 = 「拿去啦，\n不用找了∼」
    const b = speechBubbleOf({ player: 0, event: 11, order: 'afterStage' }, 0, '約翰喬')!;
    expect(b.lines).toEqual(['拿去啦，', '不用找了～']);
  });

  // ★ 订正（2026-09-17）：金貝貝**有语音** —— 原版是「播语音 **+** 画表情」两件事，
  //   不是二选一（`@source 0x0044f136 call 0x45441a` 在表情分支里照样执行）。
  //   它的语音号同样满足 `1050 + 27×11 + 事件`：事件 0 的原始串是 `#1347@04`，
  //   而 `1050 + 297 = 1347` ✓。此前这里断言 `voice` 为 null，把 bug 钉死了。
  it('★ 金貝貝（角色 11）：没有字幕，但有表情图**和语音**', () => {
    const b = speechBubbleOf({ player: 2, event: 0, order: 'afterStage' }, JINBEIBEI, '金貝貝')!;
    expect(b.emoji).not.toBeNull();
    expect(b.lines).toEqual([]);
    expect(b.voice).toBe(1050 + 27 * JINBEIBEI + 0); // ★ 不再为 null
    // 事件 0 的原始串是 `@04` ⇒ 图号 = 3×0 + 4 − 1 = 3
    expect(b.emoji).toBe(3);
    // 落点照原版
    expect(b.emojiAt).toEqual(SPEECH_EMOJI_AT);
  });

  it('金貝貝整列 27 条**全部**是表情（无文本），但**每条都有语音**', () => {
    for (let e = 0; e < 27; e++) {
      const b = speechBubbleOf({ player: 0, event: e, order: 'afterStage' }, JINBEIBEI, '金貝貝')!;
      expect(b.emoji, `事件 ${e}`).not.toBeNull();
      expect(b.lines, `事件 ${e}`).toEqual([]);
      // ★ 27 条**都**有语音（`#1347..#1373`）
      expect(b.voice, `事件 ${e}`).toBe(1050 + 27 * JINBEIBEI + e);
      expect(b.emoji!).toBeGreaterThanOrEqual(0);
      expect(b.emoji!).toBeLessThan(21);
    }
  });

  it('其余 11 个角色**一条表情都没有**（都是普通台词 + 语音）', () => {
    for (const [c] of CHARACTERS.entries()) {
      if (c === JINBEIBEI) continue;
      for (let e = 0; e < 27; e++) {
        const b = speechBubbleOf({ player: 0, event: e, order: 'afterStage' }, c, 'x')!;
        expect(b.emoji, `角色 ${c} 事件 ${e}`).toBeNull();
        expect(b.voice, `角色 ${c} 事件 ${e}`).toBe(1050 + 27 * c + e);
        expect(b.lines.length, `角色 ${c} 事件 ${e}`).toBeGreaterThan(0);
      }
    }
  });

  it('角色号 / 槽位越界 → null（表现层不许因为坏状态炸掉）', () => {
    expect(speechBubbleOf({ player: 0, event: 0, order: 'afterStage' }, 12, 'x')).toBeNull();
    expect(speechBubbleOf({ player: 0, event: 0, order: 'afterStage' }, -1, 'x')).toBeNull();
    expect(speechBubbleOf({ player: 0, event: 27, order: 'afterStage' }, 0, 'x')).toBeNull();
    expect(speechBubbleOf({ player: 0, event: -1, order: 'afterStage' }, 0, 'x')).toBeNull();
  });

  it('bubbleLines 丢掉空行（`\n` 结尾之类的串不该多画一行）', () => {
    expect(bubbleLines('a\nb')).toEqual(['a', 'b']);
    expect(bubbleLines('a\n\nb')).toEqual(['a', 'b']);
    expect(bubbleLines('')).toEqual([]);
  });
});

// ============================================================
//  队列
// ============================================================

function dummy(player: number): SpeechBubble {
  return speechBubbleOf({ player, event: 0, order: 'afterStage' }, 0, '約翰喬')!;
}

describe('SpeechQueue：一句演完再演下一句', () => {
  it('空队列', () => {
    const q = new SpeechQueue();
    expect(q.current()).toBeNull();
    expect(q.length).toBe(0);
    expect(q.tick(0)).toBe(false);
  });

  it('排入多段 → 只显示第一段，到点才换下一段', () => {
    const q = new SpeechQueue();
    expect(q.push([dummy(0), dummy(1)], 1000)).toBe(2);
    expect(q.length).toBe(2);
    expect(q.current()!.player).toBe(0);
    // 未到点：什么都不动
    expect(q.tick(1000 + SPEECH_HOLD_MS - 1)).toBe(false);
    expect(q.current()!.player).toBe(0);
    // 到点：收掉第一段
    expect(q.tick(1000 + SPEECH_HOLD_MS)).toBe(true);
    expect(q.current()!.player).toBe(1);
    expect(q.length).toBe(1);
    // 第二段以**收掉它的那一刻**为新起点（不是以排入时刻）
    expect(q.tick(1000 + SPEECH_HOLD_MS + SPEECH_HOLD_MS - 1)).toBe(false);
    expect(q.tick(1000 + 2 * SPEECH_HOLD_MS)).toBe(true);
    expect(q.current()).toBeNull();
    expect(q.tick(1e9)).toBe(false);
  });

  it('排入空数组不算「有话说」', () => {
    const q = new SpeechQueue();
    expect(q.push([], 0)).toBe(0);
    expect(q.current()).toBeNull();
  });

  it('★ 队列非空时被排空之前，`length` 一直 > 0（渲染循环靠它续帧）', () => {
    const q = new SpeechQueue();
    q.push([dummy(0)], 0);
    expect(q.length).toBe(1);
    q.tick(SPEECH_HOLD_MS);
    expect(q.length).toBe(0);
  });

  it('clear 清空', () => {
    const q = new SpeechQueue();
    q.push([dummy(0), dummy(1)], 0);
    q.clear();
    expect(q.current()).toBeNull();
    expect(q.length).toBe(0);
  });

  it('★ 中途补排不会打断正在演的那一段', () => {
    const q = new SpeechQueue();
    q.push([dummy(0)], 0);
    expect(q.tick(SPEECH_HOLD_MS - 1)).toBe(false);
    q.push([dummy(1)], SPEECH_HOLD_MS - 1);
    expect(q.current()!.player).toBe(0);
    expect(q.tick(SPEECH_HOLD_MS)).toBe(true);
    expect(q.current()!.player).toBe(1);
  });
});

// ============================================================
//  绘制
// ============================================================

/**
 * 只记录调用、不真画的 2D 上下文替身。
 *
 * ★ W-50：`drawImage` 记录的是**最终落点**（`x − anchorX, y − anchorY`），
 *   与原版 `fcn_00456418` 的 `to_left = x − src->x` 同一套语义 —— 所以下面
 *   那些「落点 = (220,130)」的断言同时钉住了「减锚点」这一步。
 */
function fakeCtx(): CanvasRenderingContext2D & {
  calls: string[];
  /** ★ W-64：字幕**逐行的落点** —— 垂直居中要用到，`calls` 里只有文字没法断言 y */
  texts: { t: string; x: number; y: number }[];
} {
  const calls: string[] = [];
  const texts: { t: string; x: number; y: number }[] = [];
  const target = {
    calls,
    texts,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    strokeText: (t: string, x: number, y: number) => {
      calls.push(`stroke:${t}`);
      texts.push({ t, x, y });
    },
    fillText: (t: string, x: number, y: number) => {
      calls.push(`fill:${t}`);
      texts.push({ t, x, y });
    },
    // ⚠️ 只声明前两个参数：本实现只走 `drawImage(bitmap, x, y)` 那一支，
    //   多声明几个没用到的形参会被 lint 判 `no-unused-vars`。
    drawImage: (_b: unknown, a: number, b: number) => calls.push(`img:${a},${b}`),
  };
  return new Proxy(target, {
    get(t, k) {
      const v = (t as Record<string | symbol, unknown>)[k];
      if (v !== undefined) return v;
      return () => undefined; // 其余属性（font/fillStyle/…）随便赋值或读
    },
    set(t, k, v) {
      (t as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & {
    calls: string[];
    texts: { t: string; x: number; y: number }[];
  };
}

function drawEnv(ctx: CanvasRenderingContext2D, sprite = vi.fn(() => null)): SpeechDrawEnv & {
  sprite: ReturnType<typeof vi.fn>;
} {
  return { ctx, sprite, font: (size: number) => `${size}px test` } as SpeechDrawEnv & {
    sprite: ReturnType<typeof vi.fn>;
  };
}

/**
 * 一个**锚点非 0** 的假精灵 —— 复刻实测值（气泡图 271×199 锚 (127,92)、
 * 头像 40×34 锚 (20,17)）。用非 0 锚点是为了让下面的落点断言能同时证明
 * 「减掉了图自带的裁切原点」：不减就落错。
 */
function fakeSprite(
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
): {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
} {
  return {
    bitmap: { width, height } as unknown as ImageBitmap,
    width,
    height,
    anchorX,
    anchorY,
  };
}

const PANEL_SPRITE = fakeSprite(271, 199, 127, 92);
const PORTRAIT_SPRITE = fakeSprite(40, 34, 20, 17);
const EMOJI_SPRITE = fakeSprite(29, 30, 14, 15);

/** 按**档案**给不同的假精灵 —— 这三张图的锚点都非 0（实测值）*/
function mockSprites(env: SpeechDrawEnv & { sprite: ReturnType<typeof vi.fn> }): void {
  env.sprite.mockImplementation((archive: string, resource: number) => {
    if (archive === 'map.mkf') return PORTRAIT_SPRITE;
    return resource === 0x207 ? EMOJI_SPRITE : PANEL_SPRITE;
  });
}

/** 原版 `to_left = x − src->x` 之后的屏幕落点 */
function at(x: number, y: number, s: { anchorX: number; anchorY: number }): string {
  return `img:${x - s.anchorX},${y - s.anchorY}`;
}

describe('drawSpeechBubble', () => {
  it('★ 普通台词：次序 = 气泡(220,130) → 头像(170,130) → 字幕', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    mockSprites(env);
    const b = speechBubbleOf({ player: 0, event: 11, order: 'afterStage' }, 0, '約翰喬')!;
    drawSpeechBubble(b, env);
    // ④ 气泡、⑤ 头像各贴一次；⑥ 的字自己 save/restore
    expect(ctx.calls).toEqual([
      at(SPEECH_PANEL_AT.x, SPEECH_PANEL_AT.y, PANEL_SPRITE),
      at(SPEECH_PORTRAIT_AT.x, SPEECH_PORTRAIT_AT.y, PORTRAIT_SPRITE),
      'save',
      // ★ 2026-09-23：`create_font(0x10, 0x101010, 0, 2, 1)`（0x0044efd2）= 深色粗体、**无描边无阴影** ⇒ 每行只填一遍
      'fill:拿去啦，',
      'fill:不用找了～',
      'restore',
    ]);
    expect(ctx.calls.some((c) => c.startsWith('stroke:'))).toBe(false);
    // 落点 = (220,130) / (170,130) —— 实测量出来的锚点已经是 0 相减后的结果
    expect(ctx.calls[0]).toBe('img:93,38');
    expect(ctx.calls[1]).toBe('img:150,113');
    // 取图：气泡 = Data#0x205 图 6（抠黑）；头像 = map.mkf portraitResource(角色) 图 expression+1
    expect(env.sprite).toHaveBeenNthCalledWith(1, 'Data.mkf', 0x205, 6, true);
    expect(env.sprite).toHaveBeenNthCalledWith(
      2,
      'map.mkf',
      portraitResource(0),
      b.expression + 1,
      true,
    );
  });

  it('★ 头像图号 = `expression + 1`（原版 `0x0044f050 mov edx,[esp+0x30] / inc edx`）', () => {
    for (const expression of [0, 1, 2, 3]) {
      const ctx = fakeCtx();
      const env = drawEnv(ctx);
      mockSprites(env);
      const b: SpeechBubble = { ...dummy(0), expression };
      drawSpeechBubble(b, env);
      expect(env.sprite).toHaveBeenNthCalledWith(
        2,
        'map.mkf',
        portraitResource(b.character),
        expression + 1,
        true,
      );
    }
  });

  it('★ 图号少一位就变红（必须是 expression+1，不是 expression）', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    mockSprites(env);
    const b: SpeechBubble = { ...dummy(0), expression: 2 };
    drawSpeechBubble(b, env);
    const call = env.sprite.mock.calls[1]!;
    expect(call[2]).toBe(3);
    expect(call[2]).not.toBe(2); // ← 少了 `inc edx` 就是这一条抓到
    expect(call[1]).toBe(portraitResource(b.character));
  });

  it('★ 金貝貝：不画任何字，但仍**照画气泡与头像**，再贴 `Data.mkf #0x207` 表情图', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    mockSprites(env);
    const b = speechBubbleOf({ player: 1, event: 0, order: 'afterStage' }, JINBEIBEI, '金貝貝')!;
    drawSpeechBubble(b, env);
    // ④⑤ 在 ⑥ 的判据**之前** ⇒ 金貝貝那一句也有气泡与头像，次序照旧
    expect(ctx.calls).toEqual([
      at(SPEECH_PANEL_AT.x, SPEECH_PANEL_AT.y, PANEL_SPRITE),
      at(SPEECH_PORTRAIT_AT.x, SPEECH_PORTRAIT_AT.y, PORTRAIT_SPRITE),
      at(SPEECH_EMOJI_AT.x, SPEECH_EMOJI_AT.y, EMOJI_SPRITE),
    ]);
    // 三次取图的档案/资源号：Data#517 图6 → map.mkf 头像 → Data#0x207 表情
    expect(env.sprite.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['Data.mkf', 0x205],
      ['map.mkf', portraitResource(JINBEIBEI)],
      ['Data.mkf', 0x207],
    ]);
    expect(env.sprite).toHaveBeenCalledWith('map.mkf', portraitResource(JINBEIBEI), 1, true);
    // 一个「字」都没画
    expect(ctx.calls.filter((c) => c === 'save' || c === 'restore')).toEqual([]);
    expect(ctx.calls.filter((c) => c.startsWith('fill:'))).toEqual([]);
    expect(ctx.calls.filter((c) => c.startsWith('stroke:'))).toEqual([]);
  });

  it('★★ W-64：行数**不设上限** —— 那个 `push 5` 是**对齐码**，不是「最多 5 行」', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    mockSprites(env);
    const many: SpeechBubble = { ...dummy(0), lines: ['1', '2', '3', '4', '5', '6', '7'] };
    drawSpeechBubble(many, env);
    const fills = ctx.calls.filter((c) => c.startsWith('fill:'));
    expect(fills).toEqual(['fill:1', 'fill:2', 'fill:3', 'fill:4', 'fill:5', 'fill:6', 'fill:7']);
    expect(SPEECH_TEXT_FLAG).toBe(5); // 那个 5 仍然在，只是语义是「左对齐 + 垂直居中」
  });

  /*
   * ★★ W-64：`SPEECH_TEXT_AT = (200, 130)` 是文字块的**左边缘 + 垂直中心**
   *   （flag 5 = 水平左对齐、垂直居中；原版 `0x0044ff35 mov eax,ebx / sar eax,1 /
   *   sub [esp+0xb0],eax`）。先前按左上角画 ⇒ 整块**偏低半个块高**。
   */
  it.each([1, 2, 3, 4, 5])('★★ W-64：%i 行时首行的 y = 130 − ((n × 行距) >> 1)', (n) => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    mockSprites(env);
    const b: SpeechBubble = { ...dummy(0), lines: Array.from({ length: n }, (_, i) => `L${i + 1}`) };
    drawSpeechBubble(b, env);
    const expectedTop = SPEECH_TEXT_AT.y - ((n * SPEECH_TEXT_LINE_HEIGHT) >> 1);
    const fills = ctx.texts; // 每行只填一遍（无描边，见上）
    expect(fills.map((t) => t.y)).toEqual(
      Array.from({ length: n }, (_, i) => expectedTop + i * SPEECH_TEXT_LINE_HEIGHT),
    );
    // 每一行的 x 都还是 200（水平左对齐，flag 5 的另一半）
    for (const t of fills) expect(t.x).toBe(SPEECH_TEXT_AT.x);
  });

  it('★★ W-64：任意行数下「首行顶 + 末行底」的中点 === 130（±1）', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const ctx = fakeCtx();
      const env = drawEnv(ctx);
      mockSprites(env);
      const b: SpeechBubble = { ...dummy(0), lines: Array.from({ length: n }, (_, i) => `L${i + 1}`) };
      drawSpeechBubble(b, env);
      const fills = ctx.texts;
      const top = fills[0]!.y;
      const bottom = fills[fills.length - 1]!.y + SPEECH_TEXT_LINE_HEIGHT;
      expect(Math.abs((top + bottom) / 2 - SPEECH_TEXT_AT.y)).toBeLessThanOrEqual(1);
    }
  });

  it('图还没解码好（取到 null）时不画、也不炸', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx); // 默认 sprite 返回 null
    const b = speechBubbleOf({ player: 1, event: 0, order: 'afterStage' }, JINBEIBEI, '金貝貝')!;
    drawSpeechBubble(b, env);
    expect(ctx.calls).toEqual([]);
  });
});

// ============================================================
//  状态 → 段落（接线层）
// ============================================================

describe('speechBubblesFor：状态跃迁 → 段落', () => {
  it('用 `players[i].character` 取**那个角色自己**的台词', () => {
    const state = makeGameState();
    // 把 1 号座位换成一个会说话的角色，避免依赖默认选人
    const seat = { ...state.players[1]!, character: 3 };
    const players = [...state.players];
    players[1] = seat;
    const out = speechBubblesFor({ ...state, players }, [{ player: 1, event: 19, order: 'afterStage' }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.character).toBe(3);
    expect(out[0]!.lines).toEqual(bubbleLines(speechLine(3, 19)[1]));
  });

  it('越界座位直接丢掉，不抛', () => {
    const state = makeGameState();
    expect(speechBubblesFor(state, [{ player: 99, event: 0, order: 'afterStage' }])).toEqual([]);
  });

  it('characterName：12 个角色的名字都在，越界给占位', () => {
    for (const c of CHARACTERS) expect(characterName(c.id)).toBe(c.name);
    expect(characterName(99)).toBe('角色99');
  });
});

describe('★ 语音排队后的「撑长」—— 原版是「播完再等 1000 ms」（Q-SPEECH-6/9）', () => {
  it('`hold()` 默认就是 `holdMs`（=1000）', () => {
    const q = new SpeechQueue();
    q.push([dummy(0)], 0);
    expect(q.hold()).toBe(SPEECH_HOLD_MS);
  });

  it('★ `extend(voiceMs)` = **再等**它播完，总时长 = 1000 + voiceMs', () => {
    // 原版的收尾是「等声音停 → 再 `fcn_004544f6(0x3e8)` 等 1000 ms」，
    // 所以总时长是 语音时长 + 1000，不是 max(1000, 语音时长)。
    const q = new SpeechQueue();
    q.push([dummy(0)], 0);
    q.extend(2_400);
    expect(q.hold()).toBe(SPEECH_HOLD_MS + 2_400);
    expect(q.tick(SPEECH_HOLD_MS + 2_399)).toBe(false);
    expect(q.current()).not.toBeNull();
    expect(q.tick(SPEECH_HOLD_MS + 2_400)).toBe(true);
    expect(q.current()).toBeNull();
  });

  it('`extend` 只加不减，且小的值不会把大的盖掉', () => {
    const q = new SpeechQueue();
    q.push([dummy(0)], 0);
    q.extend(3_000);
    q.extend(1_000);
    expect(q.hold()).toBe(SPEECH_HOLD_MS + 3_000);
  });

  it('非法值（0 / 负 / NaN / Infinity）是空操作', () => {
    const q = new SpeechQueue();
    q.push([dummy(0)], 0);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) q.extend(bad);
    expect(q.hold()).toBe(SPEECH_HOLD_MS);
  });

  it('队列空时 `extend` 是空操作', () => {
    const q = new SpeechQueue();
    q.extend(9_999);
    expect(q.hold()).toBe(0);
  });

  it('★ 换段时额外时长归零（下一段重新按它自己的语音算）', () => {
    const q = new SpeechQueue();
    q.push([dummy(0), dummy(1)], 0);
    q.extend(5_000);
    expect(q.hold()).toBe(SPEECH_HOLD_MS + 5_000);
    q.tick(SPEECH_HOLD_MS + 5_000); // 收掉第一段
    expect(q.hold()).toBe(SPEECH_HOLD_MS); // 第二段回到默认
  });

  it('`elapsed(now)` 给「这一段已经演了多久」；空队列为 0', () => {
    const q = new SpeechQueue();
    expect(q.elapsed(123)).toBe(0);
    q.push([dummy(0)], 100);
    expect(q.elapsed(450)).toBe(350);
    expect(q.elapsed(50)).toBe(0); // 时钟回拨也不给负数
  });
});
