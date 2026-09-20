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
  SPEECH_TEXT_AT,
  SPEECH_TEXT_LINE_HEIGHT,
  SPEECH_TEXT_MAX_LINES,
  SpeechQueue,
  bubbleLines,
  drawSpeechBubble,
  speechBubbleOf,
  type SpeechBubble,
  type SpeechDrawEnv,
} from './speech-bubble.ts';
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

  it('字幕最多 5 行、行距 18（原版 16 像素字 + 2 像素空隙）', () => {
    expect(SPEECH_TEXT_MAX_LINES).toBe(5);
    expect(SPEECH_TEXT_LINE_HEIGHT).toBe(0x12);
  });

  it('★ 气泡方块 = RECT(0, 40, 440, 260) @source VA 0x0044efb0 的四个立即数', () => {
    // `fcn_00451a97(目标, 源面, 源x, 源y, 宽, 高)` ⇒ `0x1b8/0x104` 是**源矩形**的宽高，
    // 落点是 `(0, 0x28)`。先前记成「200×220 贴 (0,40)」是把形参序读错了。
    expect(SPEECH_BOX).toEqual({ x: 0, y: 0x28, w: 0x1b8, h: 0x104 });
    expect(SPEECH_BOX.w).toBe(440);
    expect(SPEECH_BOX.h).toBe(260);
    // 字幕与表情都必须落在这块方框里（否则原版那一步「抠下来再贴回去」会裁掉它们）
    expect(SPEECH_TEXT_AT.x).toBeLessThan(SPEECH_BOX.x + SPEECH_BOX.w);
    expect(SPEECH_TEXT_AT.y).toBeGreaterThanOrEqual(SPEECH_BOX.y);
    expect(SPEECH_EMOJI_AT.y + 32).toBeLessThanOrEqual(SPEECH_BOX.y + SPEECH_BOX.h);
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
    const b = speechBubbleOf({ player: 1, event: 19 }, 3, '錢夫人');
    expect(b).not.toBeNull();
    expect(b!.lines).toEqual(bubbleLines(speechLine(3, 19)[1]));
    expect(b!.emoji).toBeNull();
    // 语音号 = 1050 + 27×角色 + 事件
    expect(b!.voice).toBe(1050 + 27 * 3 + 19);
    expect(b!.speaker).toBe('錢夫人');
  });

  it('★ 12 个角色同一槽位说**不同的话**（不是共用角色 0 那一列）', () => {
    const texts = CHARACTERS.map((_, c) => speechBubbleOf({ player: 0, event: 0 }, c, 'x')!.lines.join(''));
    expect(new Set(texts).size).toBe(CHARACTERS.length);
    // 角色 0 与角色 3 的第 0 句原版就不同（「別忌妒我！」vs「今夜做夢也會笑∼」）
    expect(texts[0]).not.toBe(texts[3]);
  });

  it('多行台词按 `\\n` 拆成多行（原版逐行画）', () => {
    // 角色 0 事件 11 = 「拿去啦，\n不用找了∼」
    const b = speechBubbleOf({ player: 0, event: 11 }, 0, '約翰喬')!;
    expect(b.lines).toEqual(['拿去啦，', '不用找了～']);
  });

  // ★ 订正（2026-09-17）：金貝貝**有语音** —— 原版是「播语音 **+** 画表情」两件事，
  //   不是二选一（`@source 0x0044f136 call 0x45441a` 在表情分支里照样执行）。
  //   它的语音号同样满足 `1050 + 27×11 + 事件`：事件 0 的原始串是 `#1347@04`，
  //   而 `1050 + 297 = 1347` ✓。此前这里断言 `voice` 为 null，把 bug 钉死了。
  it('★ 金貝貝（角色 11）：没有字幕，但有表情图**和语音**', () => {
    const b = speechBubbleOf({ player: 2, event: 0 }, JINBEIBEI, '金貝貝')!;
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
      const b = speechBubbleOf({ player: 0, event: e }, JINBEIBEI, '金貝貝')!;
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
        const b = speechBubbleOf({ player: 0, event: e }, c, 'x')!;
        expect(b.emoji, `角色 ${c} 事件 ${e}`).toBeNull();
        expect(b.voice, `角色 ${c} 事件 ${e}`).toBe(1050 + 27 * c + e);
        expect(b.lines.length, `角色 ${c} 事件 ${e}`).toBeGreaterThan(0);
      }
    }
  });

  it('角色号 / 槽位越界 → null（表现层不许因为坏状态炸掉）', () => {
    expect(speechBubbleOf({ player: 0, event: 0 }, 12, 'x')).toBeNull();
    expect(speechBubbleOf({ player: 0, event: 0 }, -1, 'x')).toBeNull();
    expect(speechBubbleOf({ player: 0, event: 27 }, 0, 'x')).toBeNull();
    expect(speechBubbleOf({ player: 0, event: -1 }, 0, 'x')).toBeNull();
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
  return speechBubbleOf({ player, event: 0 }, 0, '約翰喬')!;
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

/** 只记录调用、不真画的 2D 上下文替身 */
function fakeCtx(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  const target = {
    calls,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    strokeText: (t: string) => calls.push(`stroke:${t}`),
    fillText: (t: string) => calls.push(`fill:${t}`),
    drawImage: (_b: unknown, x: number, y: number) => calls.push(`img:${x},${y}`),
    // ★ 2026-09-19：台词底板要按**实际字宽**算尺寸（见 `drawSpeechBubble`），
    //   所以这个替身得能回答 `measureText`。估法按 CJK 全宽 = 字号，够用。
    measureText: (t: string) => ({ width: t.length * 16 }),
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
  }) as unknown as CanvasRenderingContext2D & { calls: string[] };
}

function drawEnv(ctx: CanvasRenderingContext2D, sprite = vi.fn(() => null)): SpeechDrawEnv & {
  sprite: ReturnType<typeof vi.fn>;
} {
  return { ctx, sprite, font: (size: number) => `${size}px test` } as SpeechDrawEnv & {
    sprite: ReturnType<typeof vi.fn>;
  };
}

describe('drawSpeechBubble', () => {
  it('普通台词：每行描边 + 填白，落点按 SPEECH_TEXT_AT + i×行距', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    const b = speechBubbleOf({ player: 0, event: 11 }, 0, '約翰喬')!;
    drawSpeechBubble(b, env);
    // 字那一支自己 save/restore（改 font/lineWidth 后要还原）
    expect(ctx.calls).toEqual([
      'save',
      'stroke:拿去啦，',
      'fill:拿去啦，',
      'stroke:不用找了～',
      'fill:不用找了～',
      'restore',
    ]);
    // 没有表情 → 一次也不取图
    expect(env.sprite).not.toHaveBeenCalled();
  });

  it('超过 5 行的台词只画前 5 行（原版那条 `push 5`）', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    const many: SpeechBubble = { ...dummy(0), lines: ['1', '2', '3', '4', '5', '6', '7'] };
    drawSpeechBubble(many, env);
    const fills = ctx.calls.filter((c) => c.startsWith('fill:'));
    expect(fills).toEqual(['fill:1', 'fill:2', 'fill:3', 'fill:4', 'fill:5']);
  });

  it('★ 金貝貝：不画任何字，取 `Data.mkf #0x207` 的那张表情图贴到 (240, 130)', () => {
    const bitmap = { width: 27, height: 26 } as unknown as ImageBitmap;
    const ctx = fakeCtx();
    const env = drawEnv(ctx);
    env.sprite.mockReturnValue({ bitmap, width: 27, height: 26, anchorX: 0, anchorY: 0 });
    const b = speechBubbleOf({ player: 1, event: 0 }, JINBEIBEI, '金貝貝')!;
    drawSpeechBubble(b, env);
    expect(ctx.calls).toEqual([`img:${SPEECH_EMOJI_AT.x},${SPEECH_EMOJI_AT.y}`]);
    expect(env.sprite).toHaveBeenCalledWith('Data.mkf', 0x207, b.emoji, true);
  });

  it('表情图还没解码好（取到 null）时不画、也不炸', () => {
    const ctx = fakeCtx();
    const env = drawEnv(ctx); // 默认 sprite 返回 null
    const b = speechBubbleOf({ player: 1, event: 0 }, JINBEIBEI, '金貝貝')!;
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
    const out = speechBubblesFor({ ...state, players }, [{ player: 1, event: 19 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.character).toBe(3);
    expect(out[0]!.lines).toEqual(bubbleLines(speechLine(3, 19)[1]));
  });

  it('越界座位直接丢掉，不抛', () => {
    const state = makeGameState();
    expect(speechBubblesFor(state, [{ player: 99, event: 0 }])).toEqual([]);
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
