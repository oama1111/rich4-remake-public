/*
 * 銀行 ATM 面板（T-029a）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 exe（面板落 (60,71)、18 颗钮的表 `0x475888`），
 * 这里把「容易写错、且错了很难看出来」的几条钉住：矩形是**面板局部**、
 * 图号 = 序号 + 1、金额从右往左一位一张数字图。
 */
import { describe, expect, it } from 'vitest';
import type { Sprite } from './assets.ts';
import {
  ATM_BAR_STEP,
  ATM_BUTTONS,
  ATM_DIGIT,
  ATM_KEYS,
  ATM_FROZEN_AT,
  ATM_FROZEN_MARK,
  ATM_ORIGIN,
  ATM_RESOURCE,
  atmAmount,
  atmButtonCenter,
  atmButtonRect,
  atmLimit,
  atmKeyOf,
  atmOp,
  atmOpen,
  atmPress,
  atmPressSound,
  ATM_MODE,
  drawAtmBar,
  hitAtmButton,
  type AtmState,
} from './bank-screen.ts';
import { ATM_BAR, ATM_PCT_SCALE } from './bank-dynamic.ts';

describe('ATM 面板几何 @source VA 0x4379c9 / 表 0x475888', () => {
  it('★ 面板是资源 24、落 (60,71)', () => {
    expect(ATM_RESOURCE).toBe(24);
    expect(ATM_ORIGIN).toEqual({ x: 60, y: 71 });
  });

  it('★ 18 颗钮的矩形照表 dump（面板局部）', () => {
    expect(ATM_BUTTONS).toHaveLength(18);
    // 提款（左上）/ 存款（中间）/ EXIT
    expect(ATM_BUTTONS[0]).toEqual({ x0: 57, y0: 49, x1: 137, y1: 90 });
    expect(ATM_BUTTONS[1]).toEqual({ x0: 139, y0: 49, x1: 219, y1: 90 });
    expect(ATM_BUTTONS[2]).toEqual({ x0: 221, y0: 49, x1: 264, y1: 90 });
    // 数字盘 4 行 × 3 列：行距 19、列距 39
    expect(ATM_BUTTONS[4]).toEqual({ x0: 58, y0: 211, x1: 91, y1: 228 });
    expect(ATM_BUTTONS[15]).toEqual({ x0: 136, y0: 268, x1: 169, y1: 285 });
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const b = ATM_BUTTONS[4 + r * 3 + c]!;
        expect(b.x0).toBe(58 + c * 39);
        expect(b.y0).toBe(211 + r * 19);
        expect(b.x1 - b.x0).toBe(33);
        expect(b.y1 - b.y0).toBe(17);
      }
    }
    // MAX / ↵
    expect(ATM_BUTTONS[16]).toEqual({ x0: 183, y0: 233, x1: 232, y1: 258 });
    expect(ATM_BUTTONS[17]).toEqual({ x0: 175, y0: 260, x1: 232, y1: 285 });
  });

  it('★ 金额栏底是序号 3（不是钮）；数字图 = 图 19..28', () => {
    expect(ATM_DIGIT.first).toBe(19);
    expect(ATM_DIGIT.first + 9).toBe(28); // '9'
    expect(ATM_DIGIT.step).toBe(20);
    expect(ATM_DIGIT.x).toBe(304);
    expect(ATM_DIGIT.y).toBe(172);
    expect(ATM_DIGIT.max).toBe(10);
    // 数字盘按下去的 12 个键（照图 5..16 上印的字）
    expect([...ATM_KEYS]).toEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'back']);
  });

  it('★ 命中：每颗钮的中心命中自己，面板外不认', () => {
    for (let i = 0; i < ATM_BUTTONS.length; i++) {
      const c = atmButtonCenter(i);
      expect(hitAtmButton(c.x, c.y)).toBe(i);
    }
    expect(hitAtmButton(50, 60)).toBeNull(); // 面板左上角之外
    expect(hitAtmButton(500, 500)).toBeNull();
  });

  it('★ 「銀行暫停放款」禁止章是图 29，盖在提款钮（钮 0，左上）中心 (157,141)', () => {
    expect(ATM_FROZEN_MARK).toBe(29);
    expect(ATM_FROZEN_AT).toEqual({ x: 157, y: 141 });
    expect(atmButtonCenter(0)).toEqual({ x: 157, y: 141 }); // 提款钮中心 ✓
    expect(atmButtonRect(0)).toEqual({ x: 117, y: 120, w: 81, h: 42 });
  });
});

describe('ATM 的按键逻辑（纯函数）', () => {
  const base: AtmState = { mode: 0, digits: '', limits: [50000, 20000] };

  it('★ 数字一位一位接上去，最多 10 位', () => {
    let st: AtmState = base;
    for (const btn of [4, 5, 6]) st = atmPress(st, btn)!; // 7 8 9
    expect(st.digits).toBe('789');
    for (let i = 0; i < 10; i++) st = atmPress(st, 14)!; // 一直按 '0'
    expect(st.digits).toHaveLength(ATM_DIGIT.max);
  });

  it('★ 前导 0 不攒', () => {
    expect(atmPress(base, 14)!.digits).toBe(''); // 第一个就按 '0'
    expect(atmPress({ ...base, digits: '5' }, 14)!.digits).toBe('50');
  });

  it('★ C 清空、← 退格', () => {
    const st = { ...base, digits: '123' };
    expect(atmPress(st, 13)!.digits).toBe(''); // C
    expect(atmPress(st, 15)!.digits).toBe('12'); // ←
    expect(atmPress(base, 15)!.digits).toBe(''); // 空串退格还是空
  });

  it('★ MAX 把金额填成**当前模式**的上限', () => {
    expect(atmPress(base, 16)!.digits).toBe('50000'); // 模式 0（提款）的上限
    expect(atmPress({ ...base, mode: 1 }, 16)!.digits).toBe('20000'); // 模式 1（存款）的上限
    expect(atmLimit(base)).toBe(50000);
    expect(atmLimit({ ...base, mode: 1 })).toBe(20000);
  });

  it('★ 模式钮：每按一次都把金额清掉 —— 点当前那件也一样', () => {
    // @source `0x004371ce cmp ebx,[0x48c3f0] / je 0x43738f` 只跳过重画高亮；之后照样写码，
    //   `0x004373ab`（码 1）/ `0x004373eb`（码 2）设模式与上限再 `call 0x436edb`（金额串 = "0"）
    //   （先前断言「点当前那件原样、连 digits 都留」是把那个 `je` 读成了整段跳过 —— 第十三份试玩回报复核订正）
    const withdraw: AtmState = { mode: 0, digits: '99', limits: [50000, 20000] };
    expect(atmPress(withdraw, 0)).toEqual({ ...withdraw, digits: '' }); // 已经是提款 → 模式不变、金额清掉
    const asDeposit = atmPress(withdraw, 1)!;
    expect(asDeposit.mode).toBe(1);
    expect(asDeposit.digits).toBe('');
  });

  it('★ 暫停放款时点「提款」（钮 0）当成点当前那件（原版改用当前模式）', () => {
    // @source `0x004371e5 cmp byte [+0x3c],0` / `0x004371ee mov ebx,[0x48c3f0]`
    const depositFirst: AtmState = { mode: 1, digits: '5', limits: [50000, 20000] };
    expect(atmPress(depositFirst, 0, true)).toEqual({ ...depositFirst, digits: '' }); // 暫停 → 仍是存款
    expect(atmPress(depositFirst, 0, false)!.mode).toBe(0); // 没暫停 → 切得过去
  });

  it('★ 按下那一声：模式钮 1、金额栏 9、其余 7；越界不放 @source `0x004373b5` / `0x00437415` / `0x0043749a` / `0x00437571`', () => {
    expect(atmPressSound(1)).toBe(1); // 提款
    expect(atmPressSound(2)).toBe(1); // 存款
    expect(atmPressSound(3)).toBe(7); // EXIT
    expect(atmPressSound(4)).toBe(9); // 金额栏（含拖动、键盘 H）
    for (let code = 5; code <= 18; code++) expect(atmPressSound(code)).toBe(7);
    expect(atmPressSound(0)).toBeNull();
    expect(atmPressSound(19)).toBeNull();
  });

  it('★ EXIT 返回 null（关面板）；↵ 不改状态（发 action 是调用方的事）', () => {
    expect(atmPress(base, 2)).toBeNull();
    expect(atmPress({ ...base, digits: '7' }, 17)!.digits).toBe('7');
  });

  it('★ 金额：空串算 0', () => {
    expect(atmAmount(base)).toBe(0);
    expect(atmAmount({ ...base, digits: '12345' })).toBe(12345);
  });

  it('★ 不是数字盘的序号（金额栏底、越界）按下去不变', () => {
    expect(atmKeyOf(3)).toBeNull();
    expect(atmKeyOf(17)).toBeNull();
    expect(atmKeyOf(18)).toBeNull();
    expect(atmPress(base, 3)).toEqual(base);
    expect(atmPress(base, 99)).toEqual(base);
  });
});

describe('ATM 进度条（Q-BANK-1 / T-029c）@source fcn_00436d3a', () => {
  /** 假 ctx：逐次记下 drawImage 的 (sx,sy,sw,sh,dx,dy) */
  const fakeCtx = (): { ctx: CanvasRenderingContext2D; calls: number[][] } => {
    const calls: number[][] = [];
    const ctx = {
      drawImage: (...args: unknown[]) => {
        // 九参形式：bitmap, sx, sy, sw, sh, dx, dy, dw, dh —— 取后面前 6 个就够定位
        calls.push((args.slice(1) as number[]).slice(0, 6));
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  };
  /** 所有图都当成 320×338、锚点 (0,0) */
  const sp = (): Sprite =>
    ({ bitmap: {} as ImageBitmap, width: 320, height: 338, anchorX: 0, anchorY: 0 }) as Sprite;

  it('★ 满格：只画填充（图 4 的 204×26 → (118,210)），不画空余', () => {
    const f = fakeCtx();
    drawAtmBar(f.ctx, sp, 9999, 9999);
    expect(f.calls).toEqual([[0, 0, ATM_BAR.w, ATM_BAR.h, ATM_BAR.x, ATM_BAR.y]]);
  });

  it('★ 一半：填充 + 从图 0 的 (58+w,139) 还原空余', () => {
    const f = fakeCtx();
    // limit = 3400 → pct = trunc(1700/3400×34) = 17 → w = 102
    drawAtmBar(f.ctx, sp, 1700, 3400);
    expect(f.calls).toEqual([
      [0, 0, 102, 26, 118, 210],
      [58 + 102, 139, 204 - 102, 26, 118 + 102, 210],
    ]);
  });

  it('★ 空条：只还原（整条从图 0 拷回来）', () => {
    const f = fakeCtx();
    drawAtmBar(f.ctx, sp, 0, 1000);
    expect(f.calls).toEqual([[58, 139, 204, 26, 118, 210]]);
  });

  it('★ 常数：比例 34、一格 6 像素（34×6 = 204 = 条宽）', () => {
    expect(ATM_PCT_SCALE).toBe(34);
    expect(ATM_BAR_STEP).toBe(6);
    expect(ATM_PCT_SCALE * ATM_BAR_STEP).toBe(ATM_BAR.w);
  });
});

describe('★ 第十三份试玩回报 #1：左上 = 提款、中间 = 存款（按 exe 数据流，不按看图）', () => {
  // @source `0x004373c4 mov [0x48c3f0],0` + `0x004373d1 mov eax,[player+0x496b88]`（码 1 = 钮 0 → 模式 0，上限 = 存款）
  //         `0x004373fa mov [0x48c3f0],1` + `0x0043740b mov eax,[player+0x496b84]`（码 2 = 钮 1 → 模式 1，上限 = 現金）
  //         `0x0043781e cmp [0x48c3f0],0 / 0x00437827 sub [+0x496b88] / 0x0043782d add [+0x496b84]`（模式 0 = 提款）
  it('★ 钮 0 在左上、钮 1 在它右边（中间）', () => {
    expect(ATM_BUTTONS[0]!.x0).toBeLessThan(ATM_BUTTONS[1]!.x0);
    expect(ATM_BUTTONS[0]!.y0).toBe(ATM_BUTTONS[1]!.y0);
  });

  it('★ 模式号 = 钮序号：钮 0 → 提款、钮 1 → 存款', () => {
    expect(ATM_MODE).toEqual({ withdraw: 0, deposit: 1 });
    const st = atmOpen(5000, 3000, false);
    expect(atmOp(atmPress(st, 0)!.mode)).toBe('withdraw');
    expect(atmOp(atmPress(st, 1)!.mode)).toBe('deposit');
  });

  it('★ 开窗：默认提款、上限 = 存款余额；换到存款后上限 = 現金 @source `0x0043705f` / `0x0043706c`', () => {
    const st = atmOpen(5000, 3000, false);
    expect(st.mode).toBe(ATM_MODE.withdraw);
    expect(atmLimit(st)).toBe(3000);
    expect(atmPress(st, 16)!.digits).toBe('3000'); // MAX = 存款余额
    const dep = atmPress(st, 1)!;
    expect(atmLimit(dep)).toBe(5000);
    expect(atmPress(dep, 16)!.digits).toBe('5000'); // MAX = 現金
  });

  it('★ 暫停放款时开窗：默认存款、上限 = 現金，提款钮点了不认 @source `0x00437028` / `0x00437039` / `0x004371ee`', () => {
    const st = atmOpen(5000, 3000, true);
    expect(st.mode).toBe(ATM_MODE.deposit);
    expect(atmLimit(st)).toBe(5000);
    expect(atmPress(st, 0, true)!.mode).toBe(ATM_MODE.deposit);
  });
});
