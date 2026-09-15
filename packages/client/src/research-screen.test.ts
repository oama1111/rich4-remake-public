/*
 * 研究所選項目屏的版面、命中与答复 —— T-040
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 `rich4.asm` 抄（窗口过程 `fcn_0044101d` VA 0x0044101d、
 * 鼠标 `fcn_004402d7` VA 0x004402d7），把最容易写错的几条钉住：
 *   * **两份资源**：立绘板/五格条 = `Data.mkf` **517** 图 5/7；項目图标 = `Panel.mkf` **11** 图 10..14；
 *   * 抠黑是**逐图**定的，写在 `RESEARCH_KEYED` 里；
 *   * 五个項目**横着一排**：图标锚点 (68+76k, 324)、去色块 (35+76k, 297) 66×54；
 *   * **去色块 = 命中框**（逐像素重合），格号 = `(x−35)/76`；
 *   * 选中在**抬手**（`0x202`），答复是 `{ type:'research', project }`。
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, PendingInteraction } from '@rich4/core';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';
import {
  RESEARCH_ARCHIVE,
  RESEARCH_FILL,
  RESEARCH_FONT_SIZE,
  RESEARCH_GRAY_H,
  RESEARCH_GRAY_LOCAL,
  RESEARCH_GRAY_W,
  RESEARCH_HIGHLIGHT,
  RESEARCH_HIT,
  RESEARCH_ICON_ARCHIVE,
  RESEARCH_ICON_FIRST,
  RESEARCH_ICON_LOCAL,
  RESEARCH_ICON_RESOURCE,
  RESEARCH_KEYED,
  RESEARCH_NAME_AT,
  RESEARCH_OUTLINE,
  RESEARCH_RESOURCE,
  RESEARCH_SOUND_HOVER,
  RESEARCH_SOUND_PICK,
  RESEARCH_STRIP_AT,
  RESEARCH_STRIP_CHUNK,
  RESEARCH_STRIDE,
  RESEARCH_TITLE_AT,
  RESEARCH_TITLE_CHUNK,
  RESEARCH_TITLE_CHUNK_AT,
  drawResearchScreen,
  hitResearch,
  isResearchPending,
  researchGrayRectAt,
  researchHighlightRect,
  researchHighlightRects,
  researchIconAt,
  researchKeyed,
  researchNameAt,
  researchOptionRect,
  researchOptions,
  researchScreen,
} from './research-screen.ts';

// ============================================================
//  用到的图 @source VA 0x0044101d / 0x004402d7
// ============================================================

describe('用到的图 @source fcn_0044101d', () => {
  it('★ 立绘板与五格条在 Data.mkf 517；图 5 / 图 7', () => {
    expect(RESEARCH_ARCHIVE).toBe('Data.mkf');
    expect(RESEARCH_RESOURCE).toBe(0x205);
    expect(RESEARCH_RESOURCE).toBe(517);
    // @source 0x00441157 `add eax, 0x48`（= 12 + 12×5）/ 0x0044117d 的 `+0x60`（= 12 + 12×7）
    expect(RESEARCH_TITLE_CHUNK).toBe(5);
    expect(RESEARCH_STRIP_CHUNK).toBe(7);
  });

  it('★ 項目图标在 Panel.mkf 11 图 10..14（不是 1..5）', () => {
    expect(RESEARCH_ICON_ARCHIVE).toBe('Panel.mkf');
    expect(RESEARCH_ICON_RESOURCE).toBe(0x0b);
    expect(RESEARCH_ICON_FIRST).toBe(10);
    // 5 个项目 → 图 10..14
    expect(Array.from({ length: 5 }, (_, k) => RESEARCH_ICON_FIRST + k)).toEqual([10, 11, 12, 13, 14]);
  });

  it('★ 抠黑表：板 5、条 7、图标 10..14 抠；别的图不抠', () => {
    expect(researchKeyed('Data.mkf', 517, 5)).toBe(true);
    expect(researchKeyed('Data.mkf', 517, 7)).toBe(true);
    for (const i of [10, 11, 12, 13, 14]) {
      expect(researchKeyed('Panel.mkf', 11, i)).toBe(true);
    }
    expect(RESEARCH_KEYED).toHaveLength(7);
    // 同资源里别的图（例如那两张 412×180 大格子图）**绝不能抠** —— 抠了会出大黑洞
    expect(researchKeyed('Panel.mkf', 11, 0)).toBe(false);
    expect(researchKeyed('Panel.mkf', 11, 1)).toBe(false);
    expect(researchKeyed('Data.mkf', 517, 6)).toBe(false);
  });
});

// ============================================================
//  版面 @source VA 0x0044101d / loc_00440377
// ============================================================

describe('版面 @source fcn_0044101d / loc_00440377', () => {
  it('★ 五格条落 (20,280)：400×89 的条，5 格', () => {
    expect(RESEARCH_STRIP_AT).toEqual({ x: 20, y: 280 });
  });

  it('★ 立绘板锚点 (220,140)（图 5 的锚点是 (123,101) → 实落 (97,39)）', () => {
    expect(RESEARCH_TITLE_CHUNK_AT).toEqual({ x: 220, y: 140 });
  });

  it('★ 标题串 (220,122)、項目名 (220,154)，都是 flag 2（正中）', () => {
    expect(RESEARCH_TITLE_AT).toEqual({ x: 220, y: 122 });
    expect(RESEARCH_NAME_AT).toEqual({ x: 220, y: 154 });
    expect(researchNameAt()).toEqual({ x: 220, y: 154 });
  });

  it('★ 行距 76；图标锚点 = (68 + 76k, 324)', () => {
    expect(RESEARCH_STRIDE).toBe(76);
    expect(RESEARCH_ICON_LOCAL).toEqual({ x: 48, y: 44 });
    expect(researchIconAt(0)).toEqual({ x: 68, y: 324 });
    expect(researchIconAt(1)).toEqual({ x: 68 + 76, y: 324 });
    expect(researchIconAt(4)).toEqual({ x: 68 + 76 * 4, y: 324 });
  });

  it('★ 去色块 66×54，格内局部 (15,17) → 屏幕 (35 + 76k, 297)', () => {
    expect(RESEARCH_GRAY_W).toBe(0x42);
    expect(RESEARCH_GRAY_H).toBe(0x36);
    expect(RESEARCH_GRAY_LOCAL).toEqual({ x: 15, y: 17 });
    expect(researchGrayRectAt(0)).toEqual({ x: 35, y: 297, w: 66, h: 54 });
    expect(researchGrayRectAt(2)).toEqual({ x: 35 + 152, y: 297, w: 66, h: 54 });
  });

  it('★★ 去色块就是那一格的命中区（这是这一屏最关键的一条）', () => {
    for (let k = 0; k < 5; k++) {
      const g = researchGrayRectAt(k);
      // 左上角与命中带**逐像素重合**（x 每格 +76、y 固定）
      expect(g.x).toBe(RESEARCH_HIT.x0 + k * RESEARCH_STRIDE);
      expect(g.y).toBe(RESEARCH_HIT.y0);
      // 整块都在命中带里
      expect(g.x + g.w - 1).toBeLessThanOrEqual(RESEARCH_HIT.x1);
      expect(g.y + g.h - 1).toBeLessThanOrEqual(RESEARCH_HIT.y1);
      // 这一块的四角都算这一格
      for (const [x, y] of [
        [g.x, g.y],
        [g.x + g.w - 1, g.y],
        [g.x, g.y + g.h - 1],
        [g.x + g.w - 1, g.y + g.h - 1],
      ]) {
        expect(hitResearch(x!, y!, 5)).toBe(k);
      }
    }
  });

  it('★ 命中带比 5 个去色块略微宽一点（右 2px、下 1px）—— 原版常量如此，照抄', () => {
    const last = researchGrayRectAt(4);
    expect(last.x + last.w - 1).toBe(404); // 末格右沿
    expect(RESEARCH_HIT.x1).toBe(406); // 带子右沿（宽 2px）
    expect(RESEARCH_HIT.y0 + RESEARCH_GRAY_H - 1).toBe(350); // 块的下沿
    expect(RESEARCH_HIT.y1).toBe(351); // 带子下沿（低 1px）
    // 多出来的那几像素仍归最后一格 / 本格
    expect(hitResearch(405, RESEARCH_HIT.y0, 5)).toBe(4);
    expect(hitResearch(406, RESEARCH_HIT.y0, 5)).toBe(4);
    expect(hitResearch(150, 351, 5)).toBe(1);
  });

  it('★ 字号 16、字色 #f0f0f0、描边 #101010 @source 0x004410f1 起', () => {
    expect(RESEARCH_FONT_SIZE).toBe(0x10);
    expect(RESEARCH_FILL).toBe('#f0f0f0');
    expect(RESEARCH_OUTLINE).toBe('#101010');
  });

  it('★ 悬停框：外 (32+76r, 294) 71×59、内 (33+76r, 295) 69×57', () => {
    expect(RESEARCH_HIGHLIGHT).toMatchObject({ x0: 0x20, y0: 0x126, w: 0x47, h: 0x3b, inset: 1 });
    expect(researchHighlightRect(0)).toEqual({ x0: 32, y0: 294, x1: 103, y1: 353 });
    expect(researchHighlightRect(1)).toEqual({ x0: 32 + 76, y0: 294, x1: 103 + 76, y1: 353 });
    expect(researchHighlightRects(0)).toEqual([
      { x0: 32, y0: 294, x1: 103, y1: 353 },
      { x0: 33, y0: 295, x1: 102, y1: 352 },
    ]);
  });

  it('★ 内框把去色块整个套住（框在格子外一圈，所以看到的是「描边」）', () => {
    for (let k = 0; k < 5; k++) {
      const inner = researchHighlightRects(k)[1]!;
      const g = researchGrayRectAt(k);
      expect(inner.x0).toBeLessThanOrEqual(g.x);
      expect(inner.y0).toBeLessThanOrEqual(g.y);
      expect(inner.x1).toBeGreaterThanOrEqual(g.x + g.w - 1);
      expect(inner.y1).toBeGreaterThanOrEqual(g.y + g.h - 1);
    }
  });

  it('★ 命中框 x∈[35,406]、y∈[297,351] @source loc_00440377', () => {
    expect(RESEARCH_HIT).toEqual({ x0: 35, x1: 0x196, y0: 0x129, y1: 0x15f });
    expect(RESEARCH_HIT.x1).toBe(406);
    expect(RESEARCH_HIT.y0).toBe(297);
    expect(RESEARCH_HIT.y1).toBe(351);
  });

  it('★ 音效：悬停 0、确认 1（`ref_0048231a` / `ref_00482322` 的表头 word）', () => {
    expect(RESEARCH_SOUND_HOVER).toBe(0);
    expect(RESEARCH_SOUND_PICK).toBe(1);
  });

  it('★ `researchOptionRect` 的框以格心为中心，且整个落在去色块里', () => {
    for (let k = 0; k < 5; k++) {
      const r = researchOptionRect(k);
      const g = researchGrayRectAt(k);
      const at = researchIconAt(k);
      expect(r.x + Math.floor(r.w / 2)).toBe(at.x);
      expect(r.y + Math.floor(r.h / 2)).toBe(at.y);
      // 图标（最宽 36、最高 40）夹在 66×54 的去色块里 —— 左右各留 15、上下各留 7
      expect(r.x).toBeGreaterThan(g.x);
      expect(r.x + r.w).toBeLessThan(g.x + g.w);
      expect(r.y).toBeGreaterThan(g.y);
      expect(r.y + r.h).toBeLessThan(g.y + g.h);
    }
  });
});

// ============================================================
//  命中 @source loc_00440377
// ============================================================

describe('命中 hitResearch @source loc_00440377', () => {
  it('★ 格号 = (x − 35) / 76 —— 五格横排，每一格的中心都落在自己那格', () => {
    for (let k = 0; k < 5; k++) {
      const at = researchIconAt(k);
      expect(hitResearch(at.x, at.y, 5)).toBe(k);
      expect(hitResearch(at.x - 30, at.y, 5)).toBe(k);
      expect(hitResearch(at.x + 30, at.y, 5)).toBe(k);
    }
  });

  it('★ 每一格的**四角**都命中自己（用去色块的四角试）', () => {
    for (let k = 0; k < 5; k++) {
      const g = researchGrayRectAt(k);
      for (const [x, y] of [
        [g.x, g.y],
        [g.x + g.w - 1, g.y],
        [g.x, g.y + g.h - 1],
        [g.x + g.w - 1, g.y + g.h - 1],
      ]) {
        expect(hitResearch(x!, y!, 5)).toBe(k);
      }
    }
  });

  it('★ 等级之外的格子点不到（level = 2 → 只有第 0、1 格）', () => {
    expect(hitResearch(researchIconAt(1).x, 320, 2)).toBe(1);
    expect(hitResearch(researchIconAt(2).x, 320, 2)).toBeNull();
    expect(hitResearch(researchIconAt(2).x, 320, 3)).toBe(2);
  });

  it('★ x 方向越界一像素就不认（左右各试一次）', () => {
    expect(hitResearch(RESEARCH_HIT.x0 - 1, 320, 5)).toBeNull();
    expect(hitResearch(RESEARCH_HIT.x1 + 1, 320, 5)).toBeNull();
    expect(hitResearch(RESEARCH_HIT.x0, 320, 5)).toBe(0);
    expect(hitResearch(RESEARCH_HIT.x1, 320, 5)).toBe(4);
  });

  it('★ y 只是「有没有落在这一条 54px 高的带里」—— 带上/下各差一像素都不认', () => {
    expect(hitResearch(150, RESEARCH_HIT.y0 - 1, 5)).toBeNull();
    expect(hitResearch(150, RESEARCH_HIT.y0, 5)).toBe(1);
    expect(hitResearch(150, RESEARCH_HIT.y1, 5)).toBe(1);
    expect(hitResearch(150, RESEARCH_HIT.y1 + 1, 5)).toBeNull();
  });

  it('★ 换成同一格里的别的 y 不改格号', () => {
    expect(hitResearch(150, 297, 5)).toBe(1);
    expect(hitResearch(150, 324, 5)).toBe(1);
    expect(hitResearch(150, 351, 5)).toBe(1);
  });

  it('★ level = 0 一律不认', () => {
    expect(hitResearch(100, 320, 0)).toBeNull();
  });
});

// ============================================================
//  項目表
// ============================================================

/** 只填这一屏用得到的字段 */
function mkState(over: { pending?: unknown; players?: unknown[] } = {}): GameState {
  return {
    pending: over.pending ?? null,
    currentPlayer: 0,
    players: over.players ?? [{ index: 0 }],
  } as unknown as GameState;
}

function mkPending(level = 5, choices?: number[], facilityId = 3): unknown {
  return {
    kind: 'research',
    facilityId,
    name: '研究所',
    level,
    choices: choices ?? Array.from({ length: level }, (_, i) => i + 1),
  };
}

describe('項目表 researchOptions', () => {
  it('★ 等级 3 → 3 个項目；名字是**研发出来的道具名**（道具号 = 項目号 + 8）', () => {
    const opts = researchOptions(mkState({ pending: mkPending(3) }));
    expect(opts.map((o) => o.project)).toEqual([1, 2, 3]);
    expect(opts.map((o) => o.toolId)).toEqual([9, 10, 11]);
    expect(opts.map((o) => o.name)).toEqual(['機器工人', '時光機', '傳送機']);
  });

  it('★ 等级 5 → 5 个項目，最后一个是核子飛彈', () => {
    const opts = researchOptions(mkState({ pending: mkPending(5) }));
    expect(opts).toHaveLength(5);
    expect(opts[4]).toEqual({ project: 5, toolId: 13, name: '核子飛彈' });
  });

  it('★ 等级 1 → 只有一个項目（機器工人）', () => {
    expect(researchOptions(mkState({ pending: mkPending(1) }))).toEqual([
      { project: 1, toolId: 9, name: '機器工人' },
    ]);
  });

  it('★ choices 缺了也能按 level 推出来（两条路结果一样）', () => {
    const byLevel = researchOptions(mkState({ pending: mkPending(4, []) }));
    expect(byLevel.map((o) => o.project)).toEqual([1, 2, 3, 4]);
  });

  it('★ 越界的項目丢掉：0 / 6 不进表，重复的只留一份', () => {
    const opts = researchOptions(mkState({ pending: mkPending(5, [0, 1, 1, 6, 3]) }));
    expect(opts.map((o) => o.project)).toEqual([1, 3]);
  });

  it('★ 不是研究所的待决交互 → 空表', () => {
    expect(researchOptions(mkState())).toEqual([]);
    expect(researchOptions(mkState({ pending: { kind: 'bank' } }))).toEqual([]);
    expect(isResearchPending({ kind: 'bank' } as PendingInteraction)).toBe(false);
    expect(isResearchPending(null)).toBe(false);
    expect(isResearchPending(undefined)).toBe(false);
    expect(isResearchPending(mkPending(1) as PendingInteraction)).toBe(true);
  });
});

// ============================================================
//  绘制（假 ctx，只查落点 / 去色块 / 文字）
// ============================================================

describe('drawResearchScreen（假 ctx）', () => {
  function fakeCtx() {
    const images: { archive: string; dx: number; dy: number }[] = [];
    const textAt: { t: string; x: number; y: number }[] = [];
    const grays: { x: number; y: number; w: number; h: number }[] = [];
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'top' as CanvasTextBaseline,
      globalCompositeOperation: 'source-over',
      save: () => undefined,
      restore: () => undefined,
      drawImage: (_b: unknown, dx: number, dy: number) => {
        images.push({ archive: current!, dx, dy });
      },
      fillText: (t: string, x: number, y: number) => {
        textAt.push({ t, x, y });
      },
      strokeText: () => undefined,
      fillRect: (x: number, y: number, w: number, h: number) => {
        grays.push({ x, y, w, h });
      },
      strokeRect: (x: number, y: number, w: number, h: number) => {
        rects.push({ x, y, w, h });
      },
    };
    // 记录「这次取图用的是哪份档案」，好把两份资源的落点分开断言
    let current: string | null = null;
    const sprite: Parameters<typeof drawResearchScreen>[1] = (archive, resource, index) => {
      current = `${archive}#${resource}`;
      void index;
      return {
        bitmap: {} as ImageBitmap,
        width: 40,
        height: 44,
        anchorX: 10,
        anchorY: 20,
      } as Sprite;
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, sprite, images, textAt, grays, rects };
  }

  it('★ 落点：板 (220−锚点, 140−锚点)、条 (20,280)、图标 (68+76k, 324)−锚点', () => {
    const f = fakeCtx();
    drawResearchScreen(f.ctx, f.sprite, {
      options: researchOptions(mkState({ pending: mkPending(3) })),
      title: '研究所',
    });
    // 板 + 条 + 3 个图标
    expect(f.images).toHaveLength(5);
    expect(f.images[0]).toEqual({ archive: 'Data.mkf#517', dx: 220 - 10, dy: 140 - 20 });
    expect(f.images[1]).toEqual({ archive: 'Data.mkf#517', dx: 20 - 10, dy: 280 - 20 });
    expect(f.images[2]).toEqual({ archive: 'Panel.mkf#11', dx: 68 - 10, dy: 324 - 20 });
    expect(f.images[3]).toEqual({ archive: 'Panel.mkf#11', dx: 68 + 76 - 10, dy: 324 - 20 });
    expect(f.images[4]).toEqual({ archive: 'Panel.mkf#11', dx: 68 + 152 - 10, dy: 324 - 20 });
  });

  it('★ 每个項目都去色一块 66×54，位置就是它自己的命中框', () => {
    const f = fakeCtx();
    drawResearchScreen(f.ctx, f.sprite, {
      options: researchOptions(mkState({ pending: mkPending(3) })),
      title: '研究所',
    });
    expect(f.grays).toEqual([
      { x: 35, y: 297, w: 66, h: 54 },
      { x: 35 + 76, y: 297, w: 66, h: 54 },
      { x: 35 + 152, y: 297, w: 66, h: 54 },
    ]);
  });

  it('★ 只画 3 个項目时，第 4、5 格不去色（原版循环只到 level）', () => {
    const f = fakeCtx();
    drawResearchScreen(f.ctx, f.sprite, {
      options: researchOptions(mkState({ pending: mkPending(3) })),
      title: '研究所',
    });
    expect(f.grays).toHaveLength(3);
  });

  it('★ 标题总是画；項目名只在悬停时画，且**位置固定** (220,154)', () => {
    const opts = researchOptions(mkState({ pending: mkPending(3) }));
    const f = fakeCtx();
    drawResearchScreen(f.ctx, f.sprite, { options: opts, title: '研究所' });
    expect(f.textAt.map((t) => t.t)).toEqual(['研究所']);

    const g = fakeCtx();
    drawResearchScreen(g.ctx, g.sprite, { options: opts, hot: 2, title: '研究所' });
    expect(g.textAt.map((t) => t.t)).toEqual(['研究所', '傳送機']);
    expect(g.textAt[0]).toEqual({ t: '研究所', x: 220, y: 122 });
    expect(g.textAt[1]).toEqual({ t: '傳送機', x: 220, y: 154 });
  });

  it('★ 悬停画两道黄框，正好套住那一格的去色块', () => {
    const f = fakeCtx();
    drawResearchScreen(f.ctx, f.sprite, {
      options: researchOptions(mkState({ pending: mkPending(5) })),
      hot: 3,
      title: '研究所',
    });
    expect(f.rects).toHaveLength(2);
    // strokeRect 传的是 (x0+0.5, y0+0.5, w-1, h-1)
    expect(f.rects[0]!.x).toBe(32 + 76 * 3 + 0.5);
    expect(f.rects[0]!.y).toBe(294.5);
    expect(f.rects[1]!.x).toBe(33 + 76 * 3 + 0.5);
    expect(f.rects[1]!.y).toBe(295.5);
  });

  it('★ 没有項目时只画板与条（等级 0 不会出现，但别崩）', () => {
    const f = fakeCtx();
    drawResearchScreen(f.ctx, f.sprite, { options: [], title: '研究所' });
    expect(f.images).toHaveLength(2);
    expect(f.grays).toHaveLength(0);
  });

  it('★ 取不到图时只是少画，不抛异常', () => {
    const f = fakeCtx();
    const none = (() => null) as unknown as Parameters<typeof drawResearchScreen>[1];
    expect(() =>
      drawResearchScreen(f.ctx, none, {
        options: researchOptions(mkState({ pending: mkPending(3) })),
        title: '研究所',
      }),
    ).not.toThrow();
  });
});

// ============================================================
//  整屏出口
// ============================================================

/** 收集 dispatch / requestRender / playEffect 的最小环境 */
function mkEnv(
  state: GameState,
  screen = 'game',
): { env: UiScreenEnv; actions: Action[]; effects: number[]; renders: () => number } {
  const actions: Action[] = [];
  const effects: number[] = [];
  let renders = 0;
  const env = {
    screen,
    state,
    now: 0,
    dispatch: (a: Action) => actions.push(a),
    playEffect: (id: number) => effects.push(id),
    requestRender: () => {
      renders++;
    },
  } as unknown as UiScreenEnv;
  return { env, actions, effects, renders: () => renders };
}

describe('整屏出口 @source 窗口过程 0x0044101d', () => {
  it('★ 只有 pending.kind === research 才接管整屏（且只在 game 屏）', () => {
    expect(researchScreen.active(mkEnv(mkState({ pending: mkPending(3) })).env)).toBe(true);
    expect(researchScreen.active(mkEnv(mkState()).env)).toBe(false);
    expect(researchScreen.active(mkEnv(mkState({ pending: { kind: 'bank' } })).env)).toBe(false);
    expect(researchScreen.active(mkEnv(mkState({ pending: mkPending(3) }), 'stock').env)).toBe(false);
  });

  it('★ 抬手才答复：down 只记账，up 才 dispatch(research{project})', () => {
    const { env, actions, effects } = mkEnv(mkState({ pending: mkPending(3) }));
    const x = researchIconAt(1).x;
    researchScreen.down?.(x, 320, env);
    expect(actions).toEqual([]);
    researchScreen.up?.(x, 320, env);
    expect(actions).toEqual([{ type: 'research', facilityId: 3, project: 2 }]);
    expect(effects).toEqual([RESEARCH_SOUND_PICK]);
  });

  it('★ 每一格都答复自己那个項目（五格逐一点一遍）', () => {
    for (let k = 0; k < 5; k++) {
      const { env, actions } = mkEnv(mkState({ pending: mkPending(5, undefined, 7) }));
      const x = researchIconAt(k).x;
      researchScreen.down?.(x, 320, env);
      researchScreen.up?.(x, 320, env);
      expect(actions).toEqual([{ type: 'research', facilityId: 7, project: k + 1 }]);
    }
  });

  it('★ 按下后移到**同一格**里别的点再抬手，仍然答复（原版看按下时记下的格号）', () => {
    const { env, actions } = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.down?.(150, 300, env);
    researchScreen.up?.(170, 345, env);
    expect(actions).toEqual([{ type: 'research', facilityId: 3, project: 2 }]);
  });

  it('★ 按下后**换一格**再抬手 → 什么都不答复', () => {
    const { env, actions } = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.down?.(researchIconAt(0).x, 320, env);
    researchScreen.up?.(researchIconAt(1).x, 320, env);
    expect(actions).toEqual([]);
  });

  it('★ 按下后移出命中带再抬手 → 什么都不答复', () => {
    const { env, actions } = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.down?.(researchIconAt(0).x, 320, env);
    researchScreen.up?.(researchIconAt(0).x, 200, env);
    expect(actions).toEqual([]);
  });

  it('★ 等级之外的格子按不下也答复不了', () => {
    const { env, actions } = mkEnv(mkState({ pending: mkPending(1) }));
    researchScreen.down?.(researchIconAt(1).x, 320, env);
    researchScreen.up?.(researchIconAt(1).x, 320, env);
    expect(actions).toEqual([]);
  });

  it('★ 没按过的抬手不答复', () => {
    const { env, actions } = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.up?.(researchIconAt(0).x, 320, env);
    expect(actions).toEqual([]);
  });

  it('★ 悬停换格响一声，同格内移动不重复响', () => {
    const { env, effects, renders } = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.move?.(researchIconAt(0).x, 320, env);
    expect(effects).toEqual([RESEARCH_SOUND_HOVER]);
    const once = renders();
    researchScreen.move?.(researchIconAt(0).x + 20, 340, env); // 同一格
    expect(effects).toHaveLength(1);
    expect(renders()).toBe(once);
    researchScreen.move?.(researchIconAt(1).x, 320, env); // 换格
    expect(effects).toHaveLength(2);
  });

  it('★ 移出命中带 → 取消悬停（不再亮），移回来再响一次', () => {
    const { env, effects } = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.move?.(researchIconAt(0).x, 320, env);
    researchScreen.move?.(researchIconAt(0).x, 200, env);
    researchScreen.move?.(researchIconAt(0).x, 320, env);
    expect(effects).toEqual([RESEARCH_SOUND_HOVER, RESEARCH_SOUND_HOVER]);
  });

  it('★ 屏不在了 tick 会把悬停/按下清掉', () => {
    const withScreen = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.move?.(researchIconAt(0).x, 320, withScreen.env);
    researchScreen.down?.(researchIconAt(0).x, 320, withScreen.env);
    researchScreen.tick?.(mkEnv(mkState()).env);
    const back = mkEnv(mkState({ pending: mkPending(3) }));
    researchScreen.up?.(researchIconAt(0).x, 320, back.env);
    expect(back.actions).toEqual([]);
  });
});
