/*
 * 对话框：画出来的和点得到的必须是同一块
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这类 bug 最难发现：按钮明明画在那儿，点下去没反应，因为绘制与命中
 * 判定各算了一遍版式。`layoutDialog` 是唯一的版式来源，这里就钉住
 * 「每个按钮的正中一定命中它自己」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOX_SCREEN, DIALOG_ANCHOR, dialogRowMiddles, drawDialog, hitDialog, layoutDialog } from './dialog.ts';
import { DIALOG_ANCHOR_SCREEN, YESNO_CENTER_SCREEN, YESNO_SIZE } from './gameui.ts';
import type { InteractionUi } from './interactions.ts';
import { LAYOUT } from './stage.ts';

/**
 * 一个够用的假 2D 上下文。
 *
 * ⚠️ 只实现 `layoutDialog` 用到的两样：`font` 与 `measureText`。
 *   宽度按「一个字 14 像素」估——版式测的是**相对关系**（谁在谁下面、
 *   点得中点不中），不是像素级还原，用真字体反而让测试依赖环境。
 */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length * 14 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

const ui = (over: Partial<InteractionUi> = {}): InteractionUi => ({
  title: '',
  detail: '台東縣\n\n費用:500元\n\n是否買下此地？',
  choices: [
    { label: '確定', action: { type: 'buyLand' } },
    { label: '取消', action: { type: 'declineDecision' } },
  ],
  ...over,
});

describe('对话框版式', () => {
  it('★ 訊息框的位置由原版那两个常量倒推 —— @source VA 0x004191df', () => {
    // x0 = 0xdc − 图5.anchorX(123)，y0 = 0x8c − 图5.anchorY(101)
    expect(DIALOG_ANCHOR_SCREEN).toEqual({ x: 0xdc, y: 0x8c });
    expect(BOX_SCREEN).toEqual({ x: 97, y: 39, w: 249, h: 170 });
    // 换到棋盘区（原点在屏幕 (0,40)）后仍然摆在同一处
    const l = layoutDialog(fakeCtx(), ui(), null);
    expect(l.box).toEqual({ x: 97, y: -1, w: 249, h: 170 });
  });

  it('★ 訊息框横向落在棋盘那一栏里 —— 纵向顶边比棋盘高 1 像素，与原版一致', () => {
    const l = layoutDialog(fakeCtx(), ui(), null);
    expect(l.box.x).toBeGreaterThanOrEqual(0);
    expect(l.box.x + l.box.w).toBeLessThanOrEqual(LAYOUT.board.w);
    // 原版画在屏幕 y=39，而棋盘那一栏从 y=40 起 —— 差的那一行会被裁掉
    expect(l.box.y).toBe(-1);
    expect(l.box.y + l.box.h).toBeLessThanOrEqual(LAYOUT.board.h);
  });

  it('★ 两个选项走原版的 YES/NO 控件，位置是 exe 里那一点', () => {
    const l = layoutDialog(fakeCtx(), ui(), null);
    expect(l.yesNo).toBe(true);
    expect(l.buttons.map((b) => b.label)).toEqual(['YES', 'NO']);
    // 整块 96×48 居中于屏幕 (220,320) @source 0x00440c7e → 0x00453a69
    const x0 = YESNO_CENTER_SCREEN.x - YESNO_SIZE.w / 2;
    expect(l.buttons[0]!.rect.x).toBe(x0);
    expect(l.buttons[1]!.rect.x).toBe(x0 + YESNO_SIZE.w / 2);
    expect(l.buttons[0]!.rect.w + l.buttons[1]!.rect.w).toBe(YESNO_SIZE.w);
  });

  it('三个以上选项退回我们自己排的按钮列（原版那几屏还没做）', () => {
    const many = ui({
      choices: Array.from({ length: 5 }, (_, i) => ({
        label: `選項${i}`,
        action: { type: 'declineDecision' as const },
      })),
    });
    const l = layoutDialog(fakeCtx(), many, null);
    expect(l.yesNo).toBe(false);
    expect(l.buttons).toHaveLength(5);
    for (const b of l.buttons) {
      expect(b.rect.y).toBeGreaterThanOrEqual(0);
      expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(LAYOUT.board.h);
    }
  });

  it('每个按钮的正中都命中它自己', () => {
    const ctx = fakeCtx();
    const u = ui({
      choices: Array.from({ length: 9 }, (_, i) => ({
        label: `選項${i}`,
        action: { type: 'declineDecision' as const },
      })),
    });
    const l = layoutDialog(ctx, u, null);
    expect(l.buttons).toHaveLength(9);
    l.buttons.forEach((b, i) => {
      const hit = hitDialog(ctx, u, null, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2);
      expect(hit).toEqual({ kind: 'choice', index: i });
    });
  });

  it('按钮互不重叠', () => {
    const u = ui({
      choices: Array.from({ length: 9 }, (_, i) => ({
        label: `選項${i}`,
        action: { type: 'declineDecision' as const },
      })),
    });
    const bs = layoutDialog(fakeCtx(), u, null).buttons.map((b) => b.rect);
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!;
        const b = bs[j]!;
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    }
  });

  it('框内的空白也吃掉点击 —— 否则会穿透到棋盘上选格子', () => {
    const ctx = fakeCtx();
    const u = ui();
    const l = layoutDialog(ctx, u, null);
    expect(hitDialog(ctx, u, null, l.box.x + 2, l.box.y + 2)).toBe('inside');
    // 框外就该放行
    expect(hitDialog(ctx, u, null, l.box.x - 5, l.box.y - 5)).toBeNull();
  });

  it('★★ 填数页走**原版数字键盘窗**：15 号钮 + 取消（B-5(i)/B-6(i)）', () => {
    const ctx = fakeCtx();
    const u = ui({
      choices: [
        {
          label: '存款',
          action: { type: 'bank', op: 'deposit', amount: 0 },
          amount: {
            label: '存多少',
            max: 9000,
            step: 1000,
            fill: (n) => ({ type: 'bank', op: 'deposit', amount: n }),
          },
        },
      ],
    });
    const l = layoutDialog(ctx, u, { choice: 0, value: 3000 });
    // ★ 先前这里是自造的五钮条（`− step / + step / 最大 / 確定 / 取消`），
    //   本文件自己也注着「我们的做法，不是原版」。现在换成原版那扇窗的命中区：
    //   16 号钮（`AMOUNT_KEY_RECTS`）+ 一颗自加的「取消」（原版靠 ESC / 右键）。
    expect(l.amountWindow).toBe(true);
    expect(l.buttons).toHaveLength(15);
    expect(l.buttons[l.buttons.length - 1]!.hit).toEqual({ kind: 'amountCancel' });
    // 数字那几号走 `amountSlot`（与键盘那一路同一个出口）
    const slotHits = l.buttons.filter((b) => b.hit.kind === 'amountSlot');
    // 2..15 共 14 颗键盘钮（数字 / 退格 / C / M / Enter）都走 `amountSlot`
    expect(slotHits).toHaveLength(14);
    // ⚠️ 金额栏那两颗光标（序号 0/1）**故意不接**：矩形互相重叠、原版靠逐像素
    //   id 图分左右，本引擎给不出可靠命中区。
    expect(l.buttons.filter((b) => b.hit.kind === 'amountStep')).toHaveLength(0);
    // 当前值要显示出来，否则玩家不知道自己在填什么
    expect(l.lines.join('')).toContain('3,000');
  });
});

// ============================================================
//  ★ 第十三份試玩回報：「获得点券的文本提示框的文字应该上下居中，现在太偏上了」
//  原版 `draw_text(…, 0xdc, 0x8c, 4)`：flag 4 = 墨迹框**两轴**居中在框皮锚点上
// ============================================================
describe('★ 訊息框 / 询问框的字：整块竖直居中在锚点 (0xdc,0x8c) @source 0x00440dac / 0x00440c3f', () => {
  /** 记下每一次 fillText 的 (字, x, y) 与当时的对齐方式 */
  function recordingCtx(): {
    ctx: CanvasRenderingContext2D;
    texts: {
      text: string;
      x: number;
      y: number;
      baseline: string;
      align: string;
      font: string;
      fill: string;
      stroke: string;
    }[];
    shadows: {
      text: string;
      x: number;
      y: number;
      baseline: string;
      align: string;
      font: string;
      fill: string;
      stroke: string;
    }[];
  } {
    const texts: {
      text: string;
      x: number;
      y: number;
      baseline: string;
      align: string;
      font: string;
      fill: string;
      stroke: string;
    }[] = [];
    const shadows: typeof texts = [];
    const ctx = {
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      save: () => undefined,
      restore: () => undefined,
      drawImage: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      strokeText: () => undefined,
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
      fillText(this: CanvasRenderingContext2D, text: string, x: number, y: number) {
        // 阴影那一遍（第二色 #101010，`font.ts` 的 `drawGdiText`）单独记，正文才进 `texts`
        (String(this.fillStyle) === '#101010' ? shadows : texts).push({
          text,
          x,
          y,
          baseline: this.textBaseline,
          align: this.textAlign,
          font: this.font,
          fill: String(this.fillStyle),
          stroke: String(this.strokeStyle),
        });
      },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, texts, shadows };
  }

  it('★ 锚点就是框皮的锚点：屏幕 (220,140) → 棋盘区 (220,100)', () => {
    expect(DIALOG_ANCHOR).toEqual({ x: 0xdc, y: 0x8c - LAYOUT.board.y });
  });

  it('★★ 单行「得點券１０點」：字的中线就在锚点上（先前贴在框内顶边，y ≈ 锚点 − 45）', () => {
    const { ctx, texts } = recordingCtx();
    drawDialog(ctx, () => null, { title: '', detail: '得點券１０點', choices: [] }, null, null);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: '得點券１０點', x: DIALOG_ANCHOR.x, y: DIALOG_ANCHOR.y });
    expect(texts[0]!.baseline).toBe('middle');
    expect(texts[0]!.align).toBe('center');
  });

  it('★ 多行（`\\n\\n` 拆出空行）：首末两行关于锚点对称，行距不变', () => {
    const { ctx, texts } = recordingCtx();
    drawDialog(
      ctx,
      () => null,
      { title: '', detail: '測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費', choices: [] },
      null,
      null,
    );
    const inked = texts.filter((t) => t.text !== '');
    const ys = inked.map((t) => t.y);
    expect(inked.map((t) => t.text)).toEqual(['測試地', '此地屬沙隆巴斯', '請付1200元過路費']);
    expect(ys[0]! + ys[2]!).toBe(2 * DIALOG_ANCHOR.y);
    expect(ys[1]).toBe(DIALOG_ANCHOR.y);
    expect(ys[1]! - ys[0]!).toBe(ys[2]! - ys[1]!);
  });

  it('★ 两个选项的询问框（0x440ba8，同一个 draw_text 调用形态）也居中', () => {
    const { ctx, texts } = recordingCtx();
    drawDialog(ctx, () => null, ui(), null, null);
    const ys = texts.filter((t) => t.text !== '').map((t) => t.y);
    expect(ys[0]! + ys[ys.length - 1]!).toBe(2 * DIALOG_ANCHOR.y);
  });

  it('★ 字体照原版：16 号**粗体**、#f0f0f0 正文 + #101010 **右下 1 px 阴影**（`create_font(…, 3, 1)`：bit1 粗体 + bit0 阴影）；行距 22（字号 + 6，D-DIALOG-1）', () => {
    // 2026-09-23 订正：第 4 参 3 = 阴影 + 粗体，不是「描边」（描边是 bit2 = 4，见 `font.test.ts` 的逐字节取证）
    const { ctx, texts, shadows } = recordingCtx();
    drawDialog(ctx, () => null, { title: '', detail: '甲\n乙', choices: [] }, null, null);
    expect(texts).toHaveLength(2);
    expect(shadows).toHaveLength(2);
    texts.forEach((t, i) => {
      expect(t.font.startsWith('bold 16px ')).toBe(true);
      expect(t.fill).toBe('#f0f0f0');
      expect(shadows[i]).toMatchObject({ text: t.text, x: t.x + 1, y: t.y + 1, fill: '#101010' });
    });
    expect(texts[1]!.y - texts[0]!.y).toBe(22);
  });

  const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
  const run = existsSync(EXE) ? it : it.skip;
  run('exe：两扇框都是 `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)`；多行交给 DrawTextA（先 DT_CALCRECT 0x400）', () => {
    const d = readFileSync(EXE);
    const at = (va: number, n: number): string => d.subarray(1024 + (va - 0x401000), 1024 + (va - 0x401000) + n).toString('hex');
    // push 1 / push 3 / push 0x101010 / push 0xf0f0f0 / push 0x10
    expect(at(0x00440baf, 16)).toBe('6a016a03681010100068f0f0f0006a10'); // 询问框
    expect(at(0x00440d06, 16)).toBe('6a016a03681010100068f0f0f0006a10'); // 訊息框
    expect(at(0x0044fba9, 5)).toBe('6800040000'); // push 0x400 (DT_CALCRECT)
  });

  it('`dialogRowMiddles`：首尾空行不算墨迹；全空时原样返回', () => {
    const rows = [
      { h: 20, size: 14, blank: true },
      { h: 20, size: 14, blank: false },
      { h: 20, size: 14, blank: true },
    ];
    expect(dialogRowMiddles(rows, 100)).toEqual([80, 100, 120]);
    expect(dialogRowMiddles([{ h: 20, size: 14, blank: true }], 100)).toEqual([10]);
    // 标题行（24 高、16 号）+ 一行正文（20 高、14 号）：墨迹 [12−8, 34+7] 的中点落在锚点
    const m = dialogRowMiddles(
      [
        { h: 24, size: 16, blank: false },
        { h: 20, size: 14, blank: false },
      ],
      100,
    );
    expect(m[1]! - m[0]!).toBe(22);
    // 整数落点：与锚点至多差半个像素（原版 `sar` 也取整）
    expect(Math.abs((m[0]! - 8 + (m[1]! + 7)) / 2 - 100)).toBeLessThanOrEqual(0.5);
  });
});

describe('★ pt26 #3b：填数窗照 exe 的逐像素 id 图取号（Panel.mkf #0x16）@source 0x00452d38..0x00452d95', () => {
  // 延迟导入：这几样只这一段用
  const load = async () => {
    const d = await import('./dialog.ts');
    const w = await import('./amount-window.ts');
    const k = await import('./amount-keys.ts');
    return { ...d, ...w, ...k };
  };
  const amountUi = ui({
    choices: [
      {
        label: '存款',
        action: { type: 'bank', op: 'deposit', amount: 0 },
        amount: { label: '存多少', max: 9000, step: 1000, fill: (n) => ({ type: 'bank', op: 'deposit', amount: n }) },
      },
    ],
  });
  const page = { choice: 0, value: 3000 };
  /** 窗内坐标 → hitDialog 的棋盘坐标 */
  const at = (W: { x: number; y: number }, lx: number, ly: number) => ({ x: W.x + lx - LAYOUT.board.x, y: W.y + ly - LAYOUT.board.y });

  it('合成的 id 图：2..0xf = 钮（响 7、抬手办）；0 = 空白（响 7、抬手不办）；1 = 拖窗、0x10 = 金额栏（不响、不办）', async () => {
    const m = await load();
    const W = m.AMOUNT_WINDOW;
    const map = new Uint8Array(W.w * W.h);
    const paint = (x0: number, y0: number, id: number) => {
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) map[y * W.w + x] = id;
    };
    paint(10, 100, 0xb);
    paint(40, 100, 1);
    paint(70, 100, 0x10);
    // (100,100) 留 0
    m.setAmountHitMap(map);
    try {
      const ctx = fakeCtx();
      const hitAt = (lx: number, ly: number) => { const p = at(W, lx, ly); return m.hitDialog(ctx, amountUi, page, p.x, p.y); };
      expect(hitAt(11, 101)).toEqual({ kind: 'amountSlot', id: 0xb });
      expect(hitAt(41, 101)).toEqual({ kind: 'amountPad', id: 1 });
      expect(hitAt(71, 101)).toEqual({ kind: 'amountPad', id: 0x10 });
      expect(hitAt(101, 101)).toEqual({ kind: 'amountPad', id: 0 });
      // ★ 闭区间：lx = 0x80 仍在窗内（读下一行第 0 格），lx = 0x81 才出窗
      expect(hitAt(0x80, 5)).toEqual({ kind: 'amountPad', id: 0 });
      expect(hitAt(0x81, 5)).not.toMatchObject({ kind: 'amountPad' });

      const latch = new m.AmountPressLatch();
      const press = (lx: number, ly: number) => {
        const r = latch.down(hitAt(lx, ly));
        return { sound: r.sound, consumed: r.consumed, act: latch.up() };
      };
      expect(press(11, 101)).toEqual({ sound: 7, consumed: true, act: { kind: 'amountSlot', id: 0xb } });
      expect(press(101, 101)).toEqual({ sound: 7, consumed: true, act: null }); // 空白：响、不办
      expect(press(41, 101)).toEqual({ sound: null, consumed: true, act: null }); // 拖窗把手
      expect(press(71, 101)).toEqual({ sound: null, consumed: true, act: null }); // 金额栏
    } finally {
      m.setAmountHitMap(null);
    }
  });

  it('没载到 id 图：退回矩形表（钮照中）；窗里空白照真素材当 1（拖窗、不响），金额栏当 0x10', async () => {
    const m = await load();
    m.setAmountHitMap(null);
    const W = m.AMOUNT_WINDOW;
    const r = m.AMOUNT_KEY_RECTS[0xb]!;
    const ctx = fakeCtx();
    const p = at(W, r.x + 3, r.y + 3);
    expect(m.hitDialog(ctx, amountUi, page, p.x, p.y)).toEqual({ kind: 'amountSlot', id: 0xb });
    const q = at(W, 2, 2);
    const h = m.hitDialog(ctx, amountUi, page, q.x, q.y);
    expect(h).toEqual({ kind: 'amountPad', id: 1 });
    expect(new m.AmountPressLatch().down(h).sound).toBeNull();
    const b = at(W, m.AMOUNT_BAR_RECT.x + 3, m.AMOUNT_BAR_RECT.y + 3);
    expect(m.hitDialog(ctx, amountUi, page, b.x, b.y)).toEqual({ kind: 'amountPad', id: 0x10 });
  });

  const REAL = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/Panel/0022.bin';
  (existsSync(REAL) ? it : it.skip)('★ 真素材：窗底整片是 1（拖窗、不响），每颗钮取到自己的号，金额栏是 0x10', async () => {
    const m = await load();
    const map = m.parseAmountHitMap(new Uint8Array(readFileSync(REAL)));
    expect(map).not.toBeNull();
    m.setAmountHitMap(map);
    try {
      const W = m.AMOUNT_WINDOW;
      const ctx = fakeCtx();
      const hitAt = (lx: number, ly: number) => { const p = at(W, lx, ly); return m.hitDialog(ctx, amountUi, page, p.x, p.y); };
      expect(hitAt(2, 2)).toEqual({ kind: 'amountPad', id: 1 });
      expect(hitAt(W.w - 2, W.h - 2)).toEqual({ kind: 'amountPad', id: 1 });
      expect(hitAt(m.AMOUNT_BAR_RECT.x + 5, m.AMOUNT_BAR_RECT.y + 5)).toEqual({ kind: 'amountPad', id: 0x10 });
      for (let id = 2; id <= 0xf; id++) {
        const r = m.AMOUNT_KEY_RECTS[id]!;
        expect(hitAt(r.x + (r.w >> 1), r.y + (r.h >> 1)), `钮 ${id}`).toEqual({ kind: 'amountSlot', id });
      }
      // 素材里根本没有 0：点窗里任何空白都不会响
      expect(map!.includes(0)).toBe(false);
    } finally {
      m.setAmountHitMap(null);
    }
  });
});

describe('★ pt26 #3c：拖窗 —— 按在 id 1 上按下起拖、移动跟着走、夹在 [0,0x200]×[0,0x120]、每次开窗回 (0x100,0x90) @source 0x00452d67 / 0x0045320b..0x0045329a / 0x0045359c', () => {
  const load = async () => ({ ...(await import('./dialog.ts')), ...(await import('./amount-window.ts')), ...(await import('./amount-keys.ts')) });
  const amountUi = ui({
    choices: [
      {
        label: '存款',
        action: { type: 'bank', op: 'deposit', amount: 0 },
        amount: { label: '存多少', max: 9000, step: 1000, fill: (n) => ({ type: 'bank', op: 'deposit', amount: n }) },
      },
    ],
  });
  const page = { choice: 0, value: 3000 };

  it('amountDragTo：光标 − 抓点，两轴各自夹紧', async () => {
    const m = await load();
    expect(m.AMOUNT_DRAG_MAX).toEqual({ x: 0x200, y: 0x120 });
    expect(m.amountDragTo({ x: 300, y: 200 }, { x: 10, y: 20 })).toEqual({ x: 290, y: 180 });
    expect(m.amountDragTo({ x: 5, y: 5 }, { x: 10, y: 20 })).toEqual({ x: 0, y: 0 });
    expect(m.amountDragTo({ x: 639, y: 479 }, { x: 2, y: 2 })).toEqual({ x: 0x200, y: 0x120 });
  });

  it('按在把手上拖：窗跟着走；钮的命中、取消钮、金额栏都跟着新落点；抬手就停；再开窗回初值', async () => {
    const m = await load();
    m.setAmountHitMap(null);
    m.resetAmountWindowPos();
    const ctx = fakeCtx();
    const hitStage = (sx: number, sy: number) => m.hitDialog(ctx, amountUi, page, sx - LAYOUT.board.x, sy - LAYOUT.board.y);
    try {
      const latch = new m.AmountPressLatch();
      const grab = { x: m.AMOUNT_WINDOW.x + 3, y: m.AMOUNT_WINDOW.y + 3 };
      expect(latch.down(hitStage(grab.x, grab.y), grab)).toEqual({ consumed: true, sound: null });
      expect(latch.dragging).toBe(true);
      expect(latch.drag({ x: grab.x - 100, y: grab.y + 50 })).toBe(true);
      expect(m.amountWindowPos()).toEqual({ x: 0x100 - 100, y: 0x90 + 50 });
      // 拖出边界：夹紧
      latch.drag({ x: 5000, y: -5000 });
      expect(m.amountWindowPos()).toEqual({ x: 0x200, y: 0 });
      latch.drag({ x: grab.x - 100, y: grab.y + 50 });
      // 抬手：停（原版 0x202 清 [0x48cac2]），再动不挪
      expect(latch.up()).toBeNull();
      expect(latch.drag({ x: 10, y: 10 })).toBe(false);
      const at = m.amountWindowPos();
      // 「5」那颗跟着窗
      const r = m.AMOUNT_KEY_RECTS[0xb]!;
      expect(hitStage(at.x + r.x + 3, at.y + r.y + 3)).toEqual({ kind: 'amountSlot', id: 0xb });
      expect(hitStage(m.AMOUNT_WINDOW.x + r.x + 3, m.AMOUNT_WINDOW.y + r.y + 3)).not.toEqual({ kind: 'amountSlot', id: 0xb });
      // 金额栏跟着窗
      expect(m.amountBarDragValue(at.x + m.AMOUNT_BAR_RECT.x + 50, at.y + m.AMOUNT_BAR_RECT.y + 3, 9000)).not.toBeNull();
      // 取消钮跟着窗（在窗下方）
      const l = m.layoutDialog(ctx, amountUi, page);
      const cancel = l.buttons.find((b) => b.hit.kind === 'amountCancel')!;
      expect(cancel.rect.x + LAYOUT.board.x).toBe(at.x);
      // 拖到最下面：取消钮挪到窗上方，仍在舞台内
      m.setAmountWindowPos(0, 0x120);
      const c2 = m.layoutDialog(ctx, amountUi, page).buttons.find((b) => b.hit.kind === 'amountCancel')!;
      expect(c2.rect.y + LAYOUT.board.y + c2.rect.h).toBeLessThanOrEqual(0x120);
      // 再开窗：回初值
      m.resetAmountWindowPos();
      expect(m.amountWindowPos()).toEqual({ x: 0x100, y: 0x90 });
    } finally {
      m.resetAmountWindowPos();
    }
  });

  it('按在钮 / 金额栏上不起拖；键盘按键会把拖到一半的窗停下（0x00452e4b 清 [0x48cac2]）', async () => {
    const m = await load();
    m.resetAmountWindowPos();
    try {
      const latch = new m.AmountPressLatch();
      latch.down({ kind: 'amountSlot', id: 0xb }, { x: 300, y: 300 });
      expect(latch.drag({ x: 10, y: 10 })).toBe(false);
      latch.down({ kind: 'amountPad', id: 0x10 }, { x: 300, y: 200 });
      expect(latch.dragging).toBe(false);
      latch.down({ kind: 'amountPad', id: 1 }, { x: 0x100 + 4, y: 0x90 + 4 });
      latch.stopDrag();
      expect(latch.drag({ x: 10, y: 10 })).toBe(false);
      expect(m.amountWindowPos()).toEqual({ x: 0x100, y: 0x90 });
    } finally {
      m.resetAmountWindowPos();
    }
  });

  it('★ 真素材：窗底整片 1 都能拖', async () => {
    const REAL = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/Panel/0022.bin';
    if (!existsSync(REAL)) return;
    const m = await load();
    m.resetAmountWindowPos();
    m.setAmountHitMap(m.parseAmountHitMap(new Uint8Array(readFileSync(REAL))));
    try {
      const ctx = fakeCtx();
      const p = { x: 0x100 + 120, y: 0x90 + 185 };
      const latch = new m.AmountPressLatch();
      latch.down(m.hitDialog(ctx, amountUi, page, p.x - LAYOUT.board.x, p.y - LAYOUT.board.y), p);
      expect(latch.dragging).toBe(true);
      latch.drag({ x: p.x - 200, y: p.y - 100 });
      expect(m.amountWindowPos()).toEqual({ x: 0x100 - 200, y: 0x90 - 100 });
    } finally {
      m.setAmountHitMap(null);
      m.resetAmountWindowPos();
    }
  });
});
