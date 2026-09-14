/*
 * 对话框：画出来的和点得到的必须是同一块
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这类 bug 最难发现：按钮明明画在那儿，点下去没反应，因为绘制与命中
 * 判定各算了一遍版式。`layoutDialog` 是唯一的版式来源，这里就钉住
 * 「每个按钮的正中一定命中它自己」。
 */
import { describe, expect, it } from 'vitest';
import { BOX_SCREEN, hitDialog, layoutDialog } from './dialog.ts';
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

  it('填数页给出 −/+/最大/確定/取消 五个按钮，且各不相同', () => {
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
    expect(l.buttons.map((b) => b.hit)).toEqual([
      { kind: 'amountStep', delta: -1000 },
      { kind: 'amountStep', delta: 1000 },
      { kind: 'amountMax' },
      { kind: 'amountOk' },
      { kind: 'amountCancel' },
    ]);
    // 当前值要显示出来，否则玩家不知道自己在填什么
    expect(l.lines.join('')).toContain('3,000');
  });
});
