/*
 * 绘制指令去重（第十九份：iPhone 发烫）—— 静止画面 0 帧、动画帧一帧不少、补放顺序与状态逐条对
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { DisplayList, markStaticSource } from './display-list.ts';

/** 记账用的假 2D 上下文：画的调用记进 `calls`，状态照真的存 */
class FakeCtx {
  readonly calls: string[] = [];
  readonly canvas = { width: 640, height: 480 };
  fillStyle: unknown = '#000';
  globalAlpha = 1;
  font = '10px sans-serif';
  #stack: { fillStyle: unknown; globalAlpha: number; font: string; tx: number }[] = [];
  tx = 0;

  drawImage(img: unknown, x: number, y: number): void {
    this.calls.push(`drawImage(${String((img as { id?: string }).id ?? '?')},${x},${y})@${this.tx}`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`fillRect(${x},${y},${w},${h}) ${String(this.fillStyle)} a=${this.globalAlpha}@${this.tx}`);
  }
  fillText(t: string, x: number, y: number): void {
    this.calls.push(`fillText(${t},${x},${y}) ${this.font}`);
  }
  save(): void {
    this.#stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, font: this.font, tx: this.tx });
  }
  restore(): void {
    const s = this.#stack.pop();
    if (s === undefined) return;
    this.fillStyle = s.fillStyle;
    this.globalAlpha = s.globalAlpha;
    this.font = s.font;
    this.tx = s.tx;
  }
  translate(x: number): void {
    this.tx += x;
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    return { a: 1, b: 0, c: 0, d: 1, e: this.tx, f: 0 };
  }
  setTransform(...a: unknown[]): void {
    this.tx = a.length >= 6 ? Number(a[4]) : (a[0] as { e: number }).e;
  }
  getLineDash(): number[] {
    return [];
  }
  setLineDash(): void {
    /* 不关心 */
  }
  measureText(t: string): { width: number } {
    // 宽度随字号变：验「压着不执行时排版照样量得准」
    const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 0);
    return { width: t.length * px };
  }
}

function setup(opts: { verify?: boolean } = {}) {
  const real = new FakeCtx();
  const board = new FakeCtx();
  const dl = new DisplayList({ ...opts, makeScratch: () => new FakeCtx() as unknown as CanvasRenderingContext2D });
  const ctx = dl.wrap(real as unknown as CanvasRenderingContext2D);
  const bctx = dl.wrap(board as unknown as CanvasRenderingContext2D);
  return { real, board, dl, ctx, bctx };
}

const SPRITE = { id: 'sprite' };
markStaticSource(SPRITE);

/** 一帧「静止画面」：铺黑、贴一张图、写一行字 */
function drawStatic(ctx: CanvasRenderingContext2D, x = 10): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 640, 480);
  ctx.save();
  ctx.translate(5, 0);
  ctx.drawImage(SPRITE as unknown as CanvasImageSource, x, 20);
  ctx.restore();
  ctx.font = '12px serif';
  ctx.fillText('GO', 1, 2);
}

describe('DisplayList（逐帧指令去重）', () => {
  it('静止画面：第一帧真画，之后每帧 0 次绘制调用、endFrame 报「没画」', () => {
    const { real, dl, ctx } = setup();
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(true);
    const first = [...real.calls];
    expect(first).toEqual([
      'fillRect(0,0,640,480) #000 a=1@0',
      'drawImage(sprite,10,20)@5',
      'fillText(GO,1,2) 12px serif',
    ]);
    for (let i = 0; i < 60; i++) {
      dl.beginFrame();
      drawStatic(ctx);
      expect(dl.endFrame()).toBe(false);
    }
    expect(real.calls).toEqual(first);
    expect(dl.stats).toMatchObject({ frames: 61, painted: 1, skipped: 60 });
  });

  it('动画：每帧有一处不同 ⇒ 每帧都画，且整帧按原顺序补放（前缀 + 其余）', () => {
    const { real, dl, ctx } = setup();
    for (let f = 0; f < 5; f++) {
      real.calls.length = 0;
      dl.beginFrame();
      drawStatic(ctx, 10 + f);
      expect(dl.endFrame()).toBe(true);
      expect(real.calls).toEqual([
        'fillRect(0,0,640,480) #000 a=1@0',
        `drawImage(sprite,${10 + f},20)@5`,
        'fillText(GO,1,2) 12px serif',
      ]);
    }
    expect(dl.stats.painted).toBe(5);
  });

  it('按节拍变的动画（一格停两帧）：变的那帧画、不变的那帧跳 —— 画出来的帧与逐帧直画一样多', () => {
    const { real, dl, ctx } = setup();
    const painted: boolean[] = [];
    for (let f = 0; f < 8; f++) {
      dl.beginFrame();
      drawStatic(ctx, Math.floor(f / 2));
      painted.push(dl.endFrame());
    }
    expect(painted).toEqual([true, false, true, false, true, false, true, false]);
    expect(real.calls.filter((c) => c.startsWith('drawImage'))).toEqual([
      'drawImage(sprite,0,20)@5',
      'drawImage(sprite,1,20)@5',
      'drawImage(sprite,2,20)@5',
      'drawImage(sprite,3,20)@5',
    ]);
  });

  it('这一帧比上一帧少画了东西（前缀相同）⇒ 照样重画', () => {
    const { real, dl, ctx } = setup();
    dl.beginFrame();
    drawStatic(ctx);
    dl.endFrame();
    real.calls.length = 0;
    dl.beginFrame();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 640, 480);
    expect(dl.endFrame()).toBe(true);
    expect(real.calls).toEqual(['fillRect(0,0,640,480) #000 a=1@0']);
  });

  it('可变的来源（没登记的画布 / 普通对象）一律当作每帧都变', () => {
    const { dl, ctx } = setup();
    const mutable = { id: 'offscreen' };
    for (let f = 0; f < 3; f++) {
      dl.beginFrame();
      ctx.drawImage(mutable as unknown as CanvasImageSource, 0, 0);
      expect(dl.endFrame()).toBe(true);
    }
  });

  it('被包的画布（棋盘）当来源：它自己的指令在同一张表里 ⇒ 没变就可以跳', () => {
    const { real, board, dl, ctx, bctx } = setup();
    const boardCanvas = bctx.canvas as unknown as { id?: string };
    boardCanvas.id = 'board';
    const frame = (x: number): boolean => {
      dl.beginFrame();
      bctx.fillRect(0, 0, 439, 440);
      bctx.drawImage(SPRITE as unknown as CanvasImageSource, x, 0);
      ctx.fillRect(0, 0, 640, 480);
      ctx.drawImage(bctx.canvas, 0, 40);
      return dl.endFrame();
    };
    expect(frame(1)).toBe(true);
    expect(frame(1)).toBe(false);
    // 只有棋盘里一格变了 ⇒ 两块都按原顺序补放
    real.calls.length = 0;
    board.calls.length = 0;
    expect(frame(2)).toBe(true);
    expect(board.calls).toEqual(['fillRect(0,0,439,440) #000 a=1@0', 'drawImage(sprite,2,0)@0']);
    expect(real.calls).toEqual(['fillRect(0,0,640,480) #000 a=1@0', 'drawImage(board,0,40)@0']);
  });

  it('帧外画过（输入回调里直接画）⇒ 当场画上去，并强制下一帧重画', () => {
    const { real, dl, ctx } = setup();
    dl.beginFrame();
    drawStatic(ctx);
    dl.endFrame();
    ctx.fillRect(1, 1, 2, 2);
    expect(real.calls.at(-1)).toBe('fillRect(1,1,2,2) #000 a=1@0');
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(true);
  });

  it('invalidate() ⇒ 下一帧照画（回到前台 / 画布被清）', () => {
    const { dl, ctx } = setup();
    dl.beginFrame();
    drawStatic(ctx);
    dl.endFrame();
    dl.invalidate();
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(true);
  });

  it('位图关掉之前：压着的前缀先补放（旧行为的顺序），下一帧强制重画', () => {
    const { real, dl, ctx } = setup();
    dl.beginFrame();
    drawStatic(ctx);
    dl.endFrame();
    real.calls.length = 0;
    dl.beginFrame();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 640, 480);
    expect(real.calls).toEqual([]); // 与上一帧一样 ⇒ 还压着
    dl.beforeBitmapClose();
    expect(real.calls).toEqual(['fillRect(0,0,640,480) #000 a=1@0']);
    ctx.save();
    expect(real.calls.length).toBe(1);
    dl.endFrame();
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(true);
  });

  it('★ W-80 §8：关掉的位图上一帧 / 这一帧都没画过 ⇒ 不强制重画（过场超分帧窗口换帧时关旧帧）', () => {
    const { dl, ctx } = setup();
    const OLD = { id: 'old' };
    for (let i = 0; i < 2; i++) {
      dl.beginFrame();
      drawStatic(ctx);
      if (i === 0) dl.beforeBitmapClose(OLD);
      dl.endFrame();
    }
    expect(dl.stats.skipped).toBe(1);
    // 画过的那一张关掉 ⇒ 照旧强制
    dl.beforeBitmapClose(SPRITE);
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(true);
  });

  it('压着不执行时 measureText 仍按本帧设的字体量（走镜像）', () => {
    const { dl, ctx } = setup();
    const widths: number[] = [];
    for (let f = 0; f < 3; f++) {
      dl.beginFrame();
      ctx.font = '12px serif';
      widths.push(ctx.measureText('ABCD').width);
      ctx.font = '20px serif';
      widths.push(ctx.measureText('ABCD').width);
      ctx.fillText('x', 0, 0);
      dl.endFrame();
    }
    expect(widths).toEqual([48, 80, 48, 80, 48, 80]);
    expect(ctx.font).toBe('20px serif');
  });

  it('漏了 restore 的帧被跳过之后：补放前把真上下文的状态对齐到镜像', () => {
    const { real, dl, ctx } = setup();
    // 每帧都「只 set 不 restore」一次透明度 —— 状态会跨帧带着走
    const frame = (x: number): boolean => {
      dl.beginFrame();
      ctx.fillRect(x, 0, 1, 1);
      ctx.globalAlpha = 0.5;
      return dl.endFrame();
    };
    expect(frame(0)).toBe(true);
    ctx.globalAlpha = 1; // 帧外改回 1（真、镜像都改）—— 与第一帧的起点相同
    // 指令与起点都相同 ⇒ 跳过；但这一帧「本该」把 alpha 留成 0.5，真上下文却还是 1
    expect(frame(0)).toBe(false);
    real.calls.length = 0;
    // 下一帧不同：补放前先把真上下文对齐到镜像的起点（alpha 0.5），与逐帧直画一致
    expect(frame(1)).toBe(true);
    expect(real.calls).toEqual(['fillRect(1,0,1,1) #000 a=0.5@0']);
  });

  it('状态镜像：变换 / save / restore 在压着不执行时也答得对，且不在任何画布上留记录', () => {
    const { real, dl, ctx } = setup();
    const scratch = new FakeCtx();
    const dl2 = new DisplayList({ makeScratch: () => scratch as unknown as CanvasRenderingContext2D });
    const c2 = dl2.wrap(new FakeCtx() as unknown as CanvasRenderingContext2D);
    for (const [list, c] of [[dl, ctx], [dl2, c2]] as const) {
      for (let f = 0; f < 2; f++) {
        list.beginFrame();
        c.save();
        c.translate(7, 3);
        c.translate(1, 1);
        expect(c.getTransform().e).toBe(8);
        expect(c.getTransform().f).toBe(4);
        c.globalAlpha = 0.25;
        c.restore();
        expect(c.getTransform().e).toBe(0);
        expect(c.globalAlpha).toBe(1);
        c.fillRect(0, 0, 1, 1);
        list.endFrame();
      }
    }
    expect(real.calls).toEqual(['fillRect(0,0,1,1) #000 a=1@0']);
    // 借来的上下文只用来规范化属性值 / 量字，从来不收绘制或 save/restore/变换
    expect(scratch.calls).toEqual([]);
    expect(scratch.tx).toBe(0);
  });

  it('自检模式：指令一律执行（不省），但仍按「本该跳过」计数', () => {
    const { real, dl, ctx } = setup({ verify: true });
    for (let i = 0; i < 3; i++) {
      dl.beginFrame();
      drawStatic(ctx);
      dl.endFrame();
    }
    expect(real.calls.filter((c) => c.startsWith('drawImage')).length).toBe(3);
    expect(dl.stats).toMatchObject({ painted: 1, skipped: 2, verifyMismatches: 0 });
  });
});

describe('★ 高清舞台换倍率（W-80 §8）：离屏画布被外部改了尺寸', () => {
  it('canvasResized：真上下文状态对齐回镜像，下一帧一定真画（不会拿一块清空的画布当成「与上一帧相同」）', () => {
    const { real, dl, ctx } = setup();
    for (let i = 0; i < 2; i++) {
      dl.beginFrame();
      drawStatic(ctx);
      dl.endFrame();
    }
    // 第二帧与第一帧相同 ⇒ 跳过
    expect(dl.stats.skipped).toBe(1);
    // 帧外改尺寸：`canvas.width = …` 清空像素、把真上下文的状态全部重置
    real.canvas.width = 1280;
    real.font = '10px sans-serif';
    real.fillStyle = '#000';
    real.calls.length = 0;
    dl.canvasResized(real.canvas);
    // 镜像记着的状态（上一帧留下的 12px serif）重新抄回真上下文
    expect(real.font).toBe('12px serif');
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(true);
    expect(real.calls.length).toBeGreaterThan(0);
    // 再下一帧恢复去重
    dl.beginFrame();
    drawStatic(ctx);
    expect(dl.endFrame()).toBe(false);
  });

  it('只动被改的那一块：别的画布的状态不碰', () => {
    const { real, board, dl, ctx, bctx } = setup();
    dl.beginFrame();
    drawStatic(ctx);
    drawStatic(bctx);
    dl.endFrame();
    board.font = 'changed';
    dl.canvasResized(real.canvas);
    expect(board.font).toBe('changed');
  });
});
