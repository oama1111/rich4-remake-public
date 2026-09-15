/*
 * 銀行两屏的**动态部分**（Q-BANK-1 / T-029c）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里只钉**纯函数**：滑入的 y 序列、状态机每一步、ATM 的键盘/进度条/拖动。
 * 绘制本身不碰 canvas（与仓库里其它屏同一套口径）。
 */
import { describe, expect, it } from 'vitest';
import type { Sprite } from './assets.ts';
import {
  ATM_BAR,
  ATM_DIGIT_MAX,
  ATM_KEY_VK,
  ATM_PCT_SCALE,
  ATM_PCT_STEP,
  BANK_KEYED,
  BANK_RES,
  LOAN_BUBBLE,
  LOAN_BUBBLE_MS,
  LOAN_DATE_PANEL,
  LOAN_DATE_TEXT,
  LOAN_DUE_TEXT,
  LOAN_EXIT_IMAGE,
  LOAN_INFO_PANEL,
  LOAN_INFO_TEXT,
  LOAN_MONTH_SCENE,
  LOAN_MSG,
  LOAN_SLIDE,
  LOAN_ST,
  LOAN_TICK_MS,
  LOAN_WEEKDAY,
  atmApplyCode,
  atmBarWidth,
  atmCodeOfKey,
  atmDragToClick,
  atmPercent,
  atmPressedButton,
  atmPressedImage,
  atmSeekAmount,
  bankKeyed,
  bankSprite,
  drawLoanBubble,
  drawLoanPanels,
  drawLoanPressed,
  loanDueDays,
  loanPanelsVisible,
  loanSlideDone,
  loanSlideIn,
  loanSlideOut,
  loanSlideStep,
  loanStart,
  loanStep,
  type BankSprite,
  type LoanPanelsView,
  type LoanUi,
} from './bank-dynamic.ts';

describe('貸款屏滑入 @source loc_00435d48 / loc_004357a7', () => {
  it('★ 面板不是 280×200：玩家面板 200×280、日期面板 200×200', () => {
    expect(LOAN_INFO_PANEL).toEqual({ resource: 23, image: 15, x: 0, w: 200, h: 280 });
    expect(LOAN_DATE_PANEL).toEqual({ x: 280, w: 200, h: 200 });
    // 日期面板的季节图来自资源 2 的图 0..3
    expect(LOAN_MONTH_SCENE).toEqual([3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3]);
  });

  it('★ 进屏：y 640 → 440，每拍 −40，到位那拍就把 dy 归零', () => {
    let s = loanSlideIn();
    expect(s).toEqual({ y: 0x280, dy: -0x28 });
    const ys: number[] = [s.y];
    for (let i = 0; i < 10; i++) {
      s = loanSlideStep(s);
      ys.push(s.y);
      if (loanSlideDone(s)) break;
    }
    expect(ys).toEqual([640, 600, 560, 520, 480, 440]);
    expect(s).toEqual({ y: LOAN_SLIDE.shown, dy: 0 });
    // 停住之后不再动
    expect(loanSlideStep(s)).toEqual(s);
  });

  it('★ 收尾：y 440 → 640，每拍 +40', () => {
    let s = loanSlideOut();
    const ys: number[] = [s.y];
    for (let i = 0; i < 10; i++) {
      s = loanSlideStep(s);
      ys.push(s.y);
      if (loanSlideDone(s)) break;
    }
    expect(ys).toEqual([440, 480, 520, 560, 600, 640]);
    expect(s).toEqual({ y: LOAN_SLIDE.hidden, dy: 0 });
  });

  it('★ 有没有露出来看 y（贴屏的裁切口径）', () => {
    expect(loanPanelsVisible({ y: LOAN_SLIDE.hidden, dy: 0 })).toBe(false);
    expect(loanPanelsVisible({ y: LOAN_SLIDE.hidden - 1, dy: -LOAN_SLIDE.step })).toBe(true);
    expect(loanSlideDone({ y: 500, dy: -40 })).toBe(false);
  });

  it('★ 定时器 50ms 一拍（SetTimer 的 uElapse = 0x32）', () => {
    expect(LOAN_TICK_MS).toBe(50);
    expect(LOAN_BUBBLE_MS).toBe(2000);
  });

  it('★ 面板文字落点照 fcn_00433d6e / fcn_00433f24', () => {
    expect(LOAN_INFO_TEXT.avatar).toEqual({ x: 0x2a, y: 0x28 });
    expect(LOAN_INFO_TEXT.name).toEqual({ x: 0x52, y: 0x1c, size: 0x16 });
    expect(LOAN_INFO_TEXT.rows.map((r) => [r.labelY, r.valueY])).toEqual([
      [0x50, 0x64],
      [0x91, 0xa4],
      [0xd0, 0xe4],
    ]);
    expect(LOAN_INFO_TEXT.valueX).toBe(0xb4);
    expect(LOAN_DATE_TEXT.day).toEqual({ x: 0x3c, y: 0x60, size: 0x3c, flag: 2 });
    expect(LOAN_DATE_TEXT.week).toEqual({ x: 0x0e, y: 0x48, size: 0x10, flag: 3 });
    expect(LOAN_DATE_TEXT.year).toEqual({ x: 0x8c, y: 0x08, size: 0x18, flag: 0 });
    expect(LOAN_DATE_TEXT.month).toEqual({ x: 0x3c, y: 0x30, size: 0x1c, flag: 2 });
    expect(LOAN_DATE_TEXT.due).toEqual({ x: 0x14, y: 0xb0, size: 0x14, flag: 5 });
    expect(LOAN_DUE_TEXT).toBe('距還款日%d天');
    expect(LOAN_WEEKDAY).toHaveLength(7);
    expect(LOAN_WEEKDAY[0]).toBe('星期日');
    expect(LOAN_WEEKDAY[6]).toBe('星期六');
  });
});

describe('貸款屏状态机 @source fcn_00435062', () => {
  const press = (
    ui: LoanUi,
    btn: number,
    o: Partial<{ frozen: boolean; hasLoan: boolean; chairman: boolean; overLimit: boolean }> = {},
  ): LoanUi =>
    loanStep(ui, {
      kind: 'press',
      btn,
      frozen: o.frozen ?? false,
      hasLoan: o.hasLoan ?? false,
      chairman: o.chairman ?? false,
      overLimit: o.overLimit ?? false,
    }).ui;

  const step = (ui: LoanUi, ev: Parameters<typeof loanStep>[1]): ReturnType<typeof loanStep> =>
    loanStep(ui, ev);

  it('★ 0x401/0x405：进屏要么先说招呼（st=1），要么直接待命（st=3）', () => {
    const withGreet = loanStart(true);
    expect(withGreet.st).toBe(LOAN_ST.greet);
    expect(withGreet.bubble).toBe(LOAN_MSG.greet);
    expect(withGreet.slide).toEqual({ y: LOAN_SLIDE.hidden, dy: 0 });
    const quiet = loanStart(false);
    expect(quiet.st).toBe(LOAN_ST.menu);
    expect(quiet.bubble).toBeNull();
  });

  it('★ 0x113：招呼 → 3 + #0076 → 4；到 4 才受理点钮', () => {
    let ui = loanStart(true);
    expect(ui.st).toBe(LOAN_ST.greet);
    // st < 4 时点钮只收气泡、回 3
    ui = press(ui, 0);
    expect(ui.st).toBe(LOAN_ST.menu);
    expect(ui.bubble).toBeNull();
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    expect(ui.st).toBe(LOAN_ST.ready);
    // 4 才真的点得动
    ui = press(ui, 1);
    expect(ui.st).toBe(LOAN_ST.borrowIn);
  });

  it('★ 点「申請貸款」：滑入 + #0078；到额度时换 #0081', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    const ok = press(base, 1);
    expect(ok.st).toBe(LOAN_ST.borrowIn);
    expect(ok.bubble).toBe(LOAN_MSG.askBorrow);
    expect(ok.slide.dy).toBe(-LOAN_SLIDE.step);
    const over = press(base, 1, { overLimit: true });
    expect(over.st).toBe(LOAN_ST.borrowIn);
    expect(over.bubble).toBe(LOAN_MSG.overLimit);
  });

  it('★ 凍結时「申請貸款」不理 @source loc_00435d48 的 player+0x3c != 0', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    expect(press(base, 1, { frozen: true })).toEqual(base);
  });

  it('★ 点「償還貸款」：没欠款不理；有欠款滑入 + #0082', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    expect(press(base, 2, { hasLoan: false })).toEqual(base);
    const ui = press(base, 2, { hasLoan: true });
    expect(ui.st).toBe(LOAN_ST.repayIn);
    expect(ui.bubble).toBe(LOAN_MSG.askRepay);
  });

  it('★ 窗那颗只有董事長认，且它开的是特別融資子对话框', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    expect(press(base, 3, { chairman: false })).toEqual(base);
    const r = step(base, {
      kind: 'press',
      btn: 3,
      frozen: false,
      hasLoan: false,
      chairman: true,
      overLimit: false,
    });
    expect(r.effect).toEqual({ kind: 'openFinance' });
    expect(r.ui.st).toBe(LOAN_ST.repayAsk);
  });

  it('★ 借款全流程：5 →(气泡完) 6 + 开填数页 → 7 + #0079 → 8 + #0080 → 滑回去 4', () => {
    let ui = press({ ...loanStart(false), st: LOAN_ST.ready }, 1);
    expect(ui.st).toBe(LOAN_ST.borrowIn);
    const r1 = step(ui, { kind: 'bubbleEnd' });
    ui = r1.ui;
    expect(ui.st).toBe(LOAN_ST.borrowAsk);
    expect(r1.effect).toEqual({ kind: 'openForm', op: 'borrow' });
    ui = step(ui, { kind: 'formClosed', amount: 5000, cash: 0, deposit: 0 }).ui;
    expect(ui.st).toBe(LOAN_ST.borrowDone);
    expect(ui.bubble).toBe(LOAN_MSG.borrowDone);
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    expect(ui.st).toBe(LOAN_ST.settle);
    expect(ui.bubble).toBe(LOAN_MSG.borrowSettle);
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    expect(ui.st).toBe(LOAN_ST.ready);
    expect(ui.slide.dy).toBe(LOAN_SLIDE.step);
  });

  it('★ 借款填 0（没填）：st=8 且**不挂气泡** —— 下一拍照样滑回去', () => {
    let ui = press({ ...loanStart(false), st: LOAN_ST.ready }, 1);
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    ui = step(ui, { kind: 'formClosed', amount: 0, cash: 0, deposit: 0 }).ui;
    expect(ui.st).toBe(LOAN_ST.settle);
    expect(ui.bubble).toBeNull();
    // 原版的定时器在**没有气泡**时也走那张转换表（`fcn_0044ee18` 返回 1）
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    expect(ui.st).toBe(LOAN_ST.ready);
    expect(ui.slide).toEqual(loanSlideOut());
  });

  it('★ 还款全流程：9 →(气泡完) 0xa + 开填数页 → 8 + #0084 → 滑回去', () => {
    let ui = press({ ...loanStart(false), st: LOAN_ST.ready }, 2, { hasLoan: true });
    expect(ui.st).toBe(LOAN_ST.repayIn);
    const r = step(ui, { kind: 'bubbleEnd' });
    ui = r.ui;
    expect(ui.st).toBe(LOAN_ST.repayAsk);
    expect(r.effect).toEqual({ kind: 'openForm', op: 'repay' });
    ui = step(ui, { kind: 'formClosed', amount: 300, cash: 100, deposit: 300 }).ui;
    expect(ui.st).toBe(LOAN_ST.settle);
    expect(ui.bubble).toBe(LOAN_MSG.repayDone);
  });

  it('★ 还款金额超过手头现金 → 退回 9 + #0083 @source 0x40a', () => {
    let ui = press({ ...loanStart(false), st: LOAN_ST.ready }, 2, { hasLoan: true });
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    expect(ui.st).toBe(LOAN_ST.repayAsk);
    ui = step(ui, { kind: 'formClosed', amount: 500, cash: 100, deposit: 200 }).ui;
    expect(ui.st).toBe(LOAN_ST.repayIn);
    expect(ui.bubble).toBe(LOAN_MSG.noCash);
  });

  it('★ EXIT 在**抬手**才收场；右键一样 @source loc_00435ea2 / loc_00435f6d', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    const down = press(base, 0);
    expect(down.pressed).toBe(1);
    expect(down.st).toBe(LOAN_ST.ready); // 按下不退屏
    const up = step(down, { kind: 'release' }).ui;
    expect(up.st).toBe(LOAN_ST.bye);
    expect(up.bubble).toBe(LOAN_MSG.bye);
    expect(up.pressed).toBe(0);
    // 道别说完才关屏
    expect(step(up, { kind: 'bubbleEnd' }).effect).toEqual({ kind: 'close' });
    // 右键
    const cancel = step(base, { kind: 'cancel' }).ui;
    expect(cancel.st).toBe(LOAN_ST.bye);
    expect(cancel.bubble).toBe(LOAN_MSG.bye);
    // 已经在道别了就不再重复
    expect(step(cancel, { kind: 'cancel' }).ui).toBe(cancel);
  });

  it('★ 抬手而按的不是 EXIT 就只是清按下态', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready, pressed: 0 };
    const r = step(base, { kind: 'release' }).ui;
    expect(r.st).toBe(LOAN_ST.ready);
    expect(r.pressed).toBe(0);
  });

  it('★ 特別融資子对话框：确认 → 0xb（收场）；取消 → 回 4 @source loc_00435ddb', () => {
    const asking = { ...loanStart(false), st: LOAN_ST.repayAsk, pressed: 0 };
    const ok = step(asking, { kind: 'financeClosed', ok: true }).ui;
    expect(ok.st).toBe(LOAN_ST.bye);
    expect(ok.financeOk).toBe(true);
    const no = step(asking, { kind: 'financeClosed', ok: false }).ui;
    expect(no.st).toBe(LOAN_ST.ready);
  });

  it('★ 气泡串表照 exe dump（10 句，带串号）', () => {
    expect(LOAN_MSG.greet.id).toBe(0x75);
    expect(LOAN_MSG.bye.id).toBe(0x85);
    expect(LOAN_MSG.borrowSettle.text).toBe('請於三個月內\n還清貸款。');
    expect(LOAN_MSG.noCash.text).toBe('很抱歉！\n您的現金不足。');
    // 串首的 #00xx 是颜色控制码，不属于显示内容
    expect(LOAN_MSG.greet.text.startsWith('#')).toBe(false);
    expect(LOAN_MSG.greet.raw.startsWith('#0075')).toBe(true);
  });
});

describe('ATM 进度条 @source fcn_00436d3a', () => {
  it('★ 比例常数是 34（不是 100），一格 6 像素', () => {
    expect(ATM_PCT_SCALE).toBe(34);
    expect(ATM_PCT_STEP).toBe(6);
    expect(ATM_BAR).toEqual({
      x: 0x76,
      y: 0xd2,
      w: 0xcc,
      h: 0x1a,
      fillImage: 4,
      emptySrcX: 0x3a,
      emptySrcY: 0x8b,
    });
  });

  it('★ pct = trunc(金额/上限 × 34)，条宽 = pct × 6（满格 204）', () => {
    expect(atmPercent(0, 1000)).toBe(0);
    expect(atmPercent(1000, 1000)).toBe(34);
    expect(atmPercent(500, 1000)).toBe(17);
    expect(atmPercent(1, 3)).toBe(11); // 0.333×34 = 11.33 → 11（向零取整）
    expect(atmPercent(100, 0)).toBe(0); // 上限 0：原版是 0/0，这里挡成空条
    expect(atmBarWidth(0)).toBe(0);
    expect(atmBarWidth(34)).toBe(204);
    expect(atmBarWidth(35)).toBe(204); // 夹住
    expect(atmBarWidth(-1)).toBe(0);
  });

  it('★ 拖到条上某处换算成金额 @source loc_00437413', () => {
    // 条内 x < 0 → 0；x >= 204 → 上限
    expect(atmSeekAmount(-1, 10_000)).toBe(0);
    expect(atmSeekAmount(204, 10_000)).toBe(10_000);
    // x = 0 → (0/6+1) × (10000/34+1) = 1 × 295 = 295
    expect(atmSeekAmount(0, 10_000)).toBe(295);
    // x = 6 → (1+1) × 295 = 590
    expect(atmSeekAmount(6, 10_000)).toBe(590);
    // 夹到上限
    expect(atmSeekAmount(203, 10)).toBe(10);
  });
});

describe('ATM 键盘 @source loc_004374ac（0x100）', () => {
  it('★ VK → 按下码（= 钮序号 + 1）逐条照跳表', () => {
    expect(atmCodeOfKey(0x37)).toBe(5); // '7'
    expect(atmCodeOfKey(0x38)).toBe(6); // '8'
    expect(atmCodeOfKey(0x39)).toBe(7); // '9'
    expect(atmCodeOfKey(0x34)).toBe(8); // '4'
    expect(atmCodeOfKey(0x35)).toBe(9);
    expect(atmCodeOfKey(0x36)).toBe(10);
    expect(atmCodeOfKey(0x31)).toBe(11); // '1'
    expect(atmCodeOfKey(0x32)).toBe(12);
    expect(atmCodeOfKey(0x33)).toBe(13);
    expect(atmCodeOfKey(0x30)).toBe(15); // '0'
    expect(atmCodeOfKey(0x43)).toBe(14); // C
    expect(atmCodeOfKey(0x08)).toBe(16); // Backspace
    expect(atmCodeOfKey(0x4d)).toBe(17); // M = MAX
    expect(atmCodeOfKey(0x0d)).toBe(18); // Enter
    expect(atmCodeOfKey(0x48)).toBe(4); // 合成一次金额栏点击
    expect(atmCodeOfKey(0x41)).toBeNull();
    // ★ 键盘这一支走的是**抬手**那套分发（原版 PostMessage(0x202)）
    expect(ATM_KEY_VK.size).toBe(15);
  });

  it('★ 数字一位一位接上去，超过上限就填成上限', () => {
    // 5 6 7 = 8 9 7 那三颗是图上的 7 8 9
    expect(atmApplyCode('', 5, 999)).toBe('7');
    expect(atmApplyCode('7', 6, 999)).toBe('78');
    expect(atmApplyCode('78', 7, 999)).toBe('789');
    expect(atmApplyCode('', 5, 3)).toBe('3'); // 7 > 3 → 截到上限
  });

  it('★ 前导 0 不攒；再按 0 什么都不做', () => {
    expect(atmApplyCode('', 15, 999)).toBe('');
    expect(atmApplyCode('0', 15, 999)).toBe('0');
    expect(atmApplyCode('5', 15, 999)).toBe('50');
  });

  it('★ C 清空、← 退格、MAX 填上限', () => {
    expect(atmApplyCode('123', 14, 999)).toBe('0'); // C
    expect(atmApplyCode('123', 16, 999)).toBe('12'); // ←
    expect(atmApplyCode('0', 16, 999)).toBe('0');
    expect(atmApplyCode('', 16, 999)).toBe('0');
    expect(atmApplyCode('12', 17, 999)).toBe('999'); // MAX
  });

  it('★ 最多 10 位；越界码不动', () => {
    let s = '';
    for (let i = 0; i < 20; i++) s = atmApplyCode(s, 5, 999_999_999_999);
    expect(s).toHaveLength(ATM_DIGIT_MAX);
    expect(atmApplyCode('12', 0, 100)).toBe('12'); // 模式钮不在这里处理
    expect(atmApplyCode('12', 4, 100)).toBe('12'); // 金额栏
    expect(atmApplyCode('12', 18, 100)).toBe('12'); // ↵
    expect(atmApplyCode('12', 99, 100)).toBe('12');
  });
});

describe('ATM 悬停 / 拖动 / 按下态', () => {
  it('★ 0x200（loc_00437904）不是悬停高亮：只有按住金额栏才转发成点击', () => {
    expect(atmDragToClick(4)).toBe(4);
    for (const c of [null, 0, 1, 2, 3, 5, 17, 18]) {
      expect(atmDragToClick(c)).toBeNull();
    }
  });

  it('★ 按下图画哪张：图号 = 码（金额栏除外）@source loc_004371f9', () => {
    expect(atmPressedImage(1)).toBe(1); // 存款
    expect(atmPressedImage(2)).toBe(2); // 提款
    expect(atmPressedImage(3)).toBe(3); // EXIT
    expect(atmPressedImage(4)).toBeNull(); // 金额栏：原版贴满格图后立刻重画进度条
    expect(atmPressedImage(5)).toBe(5); // '7'
    expect(atmPressedImage(18)).toBe(18); // ↵
    expect(atmPressedImage(0)).toBeNull();
    expect(atmPressedImage(19)).toBeNull();
    expect(atmPressedButton(3)).toBe(2);
    expect(atmPressedButton(null)).toBeNull();
  });
});

describe('抠黑表 @source 各绘制点', () => {
  it('★ 逐图判定（资源 24 只有 0 与 29；资源 23 是 1/16/18/21/23）', () => {
    expect(BANK_RES).toEqual({ atm: 24, loan: 23, date: 2 });
    const atm = BANK_KEYED.get('Panel.mkf:24');
    expect([...(atm ?? [])].sort((a, b) => a - b)).toEqual([0, 29]);
    const loan = BANK_KEYED.get('Panel.mkf:23');
    expect([...(loan ?? [])].sort((a, b) => a - b)).toEqual([1, 16, 18, 21, 23]);
    expect(bankKeyed('Panel.mkf', 24, 0)).toBe(true);
    expect(bankKeyed('Panel.mkf', 24, 1)).toBe(false);
    expect(bankKeyed('Panel.mkf', 23, 15)).toBe(false); // 玩家面板是整块拷贝
    expect(bankKeyed('Panel.mkf', 2, 0)).toBe(false); // 季节底图拷进 surface
    expect(bankKeyed('map.mkf', 27, 0)).toBe(false); // 头像不在表里 → 由调用点自己传
  });
});

describe('「距還款日%d天」 @source fcn_004521aa', () => {
  const dayNumber = (y: number, m: number, d: number): number => {
    let n = 0;
    for (let yy = 1998; yy < y; yy++) n += yy % 4 === 0 ? 366 : 365;
    const len = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let mm = 1; mm < m; mm++) n += mm === 2 && y % 4 === 0 ? 29 : (len[mm] ?? 30);
    return n + (d - 1);
  };

  it('★ 就是两个日期的天号相减', () => {
    expect(loanDueDays({ year: 1998, month: 1, day: 1 }, { year: 1998, month: 1, day: 1 }, dayNumber)).toBe(0);
    expect(loanDueDays({ year: 1998, month: 1, day: 1 }, { year: 1998, month: 3, day: 31 }, dayNumber)).toBe(89);
  });
});

describe('贷款屏其它常量', () => {
  it('★ EXIT 的按下/复原图是 19/18', () => {
    expect(LOAN_EXIT_IMAGE).toEqual({ pressed: 19, normal: 18 });
  });
  it('★ 气泡：资源 23 图 21、落 (240,80)、字心偏移 +20、寿命 2000ms', () => {
    expect(LOAN_BUBBLE).toEqual({ image: 21, x: 240, y: 80, dx: 20, dy: 0, size: 20, color: '#101010' });
    expect(LOAN_BUBBLE_MS).toBe(2000);
  });
  it('★ 按下图画的是图 19、且只有 pressed == 1 才画 @source loc_00435cca', () => {
    const boom = (): never => {
      throw new Error('不该碰 ctx');
    };
    const ctx = new Proxy({}, { get: boom }) as unknown as CanvasRenderingContext2D;
    // 没按住 → 一次都不碰 ctx
    expect(() => drawLoanPressed(ctx, () => null, 0, { x0: 548, y0: 431 })).not.toThrow();
    // 按住了但图还没解码（sprite 给 null）→ 也不碰 ctx
    expect(() => drawLoanPressed(ctx, () => null, 1, { x0: 548, y0: 431 })).not.toThrow();
  });
  it('★ bankSprite 按表决定抠不抠黑（调用点不手写标志）', () => {
    const seen: (boolean | undefined)[] = [];
    const sp = (_a: unknown, _r: number, _i: number, key?: boolean): null => {
      seen.push(key);
      return null;
    };
    bankSprite(sp as never, 'Panel.mkf', 24, 0); // 面板底 → 抠
    bankSprite(sp as never, 'Panel.mkf', 24, 5); // 数字钮 → 不抠
    bankSprite(sp as never, 'Panel.mkf', 23, 21); // 气泡 → 抠
    bankSprite(sp as never, 'Panel.mkf', 23, 15); // 玩家面板 → 不抠
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe('两块滑入面板的绘制（假 ctx，只查落点）', () => {
  /** 假 ctx：记下每次 drawImage 与 fillText 的落点（与 `bail-screen.test.ts` 同一套）*/
  function fakeCtx(): {
    ctx: CanvasRenderingContext2D;
    images: { dx: number; dy: number; w: number | undefined; h: number | undefined }[];
    texts: { t: string; x: number; y: number; align: string }[];
  } {
    const images: { dx: number; dy: number; w: number | undefined; h: number | undefined }[] = [];
    const texts: { t: string; x: number; y: number; align: string }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
      save: () => undefined,
      restore: () => undefined,
      clip: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      drawImage: (
        _b: unknown,
        dx: number,
        dy: number,
        w?: number,
        h?: number,
      ) => {
        images.push({ dx, dy, w, h });
      },
      fillText: (t: string, x: number, y: number) => {
        texts.push({ t, x, y, align: String(ctx.textAlign) });
      },
      strokeText: () => undefined,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, images, texts };
  }

  /**
   * 假取图：`Panel.mkf` 的图锚点 (0,0)（原版资源 23 图 15 / 资源 2 的图都是 (0,0)）、
   * `map.mkf` 头像给 (10,20)，好把「头像要减锚点」也测出来。
   */
  const spriteFn: BankSprite = (archive) =>
    ({
      bitmap: {} as ImageBitmap,
      width: 200,
      height: 200,
      anchorX: archive === 'map.mkf' ? 10 : 0,
      anchorY: archive === 'map.mkf' ? 20 : 0,
    }) as Sprite;

  const view = (over: Partial<LoanPanelsView> = {}): LoanPanelsView => ({
    slide: { y: LOAN_SLIDE.shown, dy: 0 },
    character: 3,
    name: '阿土伯',
    money: [12_345, 67_890, 1000],
    date: { year: 1998, month: 3, day: 5 },
    weekday: 4,
    globalMapId: 0,
    holidayArt: null,
    dueDays: 88,
    ...over,
  });

  it('★ 面板没露出来（y = 640）就整块不画', () => {
    const f = fakeCtx();
    drawLoanPanels(f.ctx, spriteFn, view({ slide: { y: LOAN_SLIDE.hidden, dy: 0 } }));
    expect(f.images).toHaveLength(0);
    expect(f.texts).toHaveLength(0);
  });

  it('★ 玩家面板贴 (0,y)、日期面板贴 (280,y)；文字都在面板局部坐标 + y 上', () => {
    const f = fakeCtx();
    drawLoanPanels(f.ctx, spriteFn, view());
    // 玩家面板底图（图 15）带锚点 (0,0) → 落点就是 (0,440)
    expect(f.images[0]).toEqual({ dx: 0, dy: 440, w: undefined, h: undefined });
    // 头像要减锚点：落 (0x2a − 10, 440 + 0x28 − 20) = (32, 460)
    expect(f.images[1]).toEqual({ dx: 32, dy: 460, w: undefined, h: undefined });
    // 日期面板的季节底图贴 (280,440)
    expect(f.images[2]).toEqual({ dx: 280, dy: 440, w: undefined, h: undefined });
    const at = (t: string): { x: number; y: number } => {
      const hit = f.texts.find((e) => e.t === t);
      if (hit === undefined) throw new Error(`没画「${t}」`);
      return { x: hit.x, y: hit.y };
    };
    expect(at('阿土伯')).toEqual({ x: 0x52, y: 440 + 0x1c });
    expect(at('現  金')).toEqual({ x: 0x0a, y: 440 + 0x50 });
    expect(at('存  款')).toEqual({ x: 0x0a, y: 440 + 0x91 });
    expect(at('貸  款')).toEqual({ x: 0x0a, y: 440 + 0xd0 });
    expect(at('$12,345')).toEqual({ x: 0xb4, y: 440 + 0x64 });
    expect(at('$67,890')).toEqual({ x: 0xb4, y: 440 + 0xa4 });
    expect(at('$1,000')).toEqual({ x: 0xb4, y: 440 + 0xe4 });
    // 日期面板（x 都要 + 280）
    expect(at('5')).toEqual({ x: 280 + 0x3c, y: 440 + 0x60 });
    expect(at('星期四')).toEqual({ x: 280 + 0x0e, y: 440 + 0x48 });
    expect(at('1998')).toEqual({ x: 280 + 0x8c, y: 440 + 0x08 });
    expect(at('3月')).toEqual({ x: 280 + 0x3c, y: 440 + 0x30 });
    expect(at(LOAN_DUE_TEXT.replace('%d', '88'))).toEqual({ x: 280 + 0x14, y: 440 + 0xb0 });
  });

  it('★ 有節日插画时整张盖掉季节底图（200×200 拉到面板上）', () => {
    const f = fakeCtx();
    const art = {} as ImageBitmap;
    drawLoanPanels(f.ctx, spriteFn, view({ holidayArt: art }));
    // 第 3 张图就是插画（0 = 玩家面板底、1 = 头像），按 200×200 画在 (280,440)
    expect(f.images[2]).toEqual({ dx: 280, dy: 440, w: 200, h: 200 });
  });

  it('★ 距還款日那条不画（dueDays = null）', () => {
    const f = fakeCtx();
    drawLoanPanels(f.ctx, spriteFn, view({ dueDays: null }));
    expect(f.texts.some((e) => e.t.startsWith('距還款日'))).toBe(false);
  });

  it('★ 气泡：底图画在 (240,80)，字心 = (240+100+20, 80+100)（图 200×200 时）', () => {
    const f = fakeCtx();
    drawLoanBubble(f.ctx, spriteFn, '歡迎光臨\n大富翁銀行！');
    expect(f.images[0]).toEqual({ dx: 240, dy: 80, w: undefined, h: undefined });
    // sprite 的 width/height 都是 200 → 字心 (240 + 100 + 20, 80 + 100) = (360, 180)
    expect(f.texts.map((e) => [e.t, e.x, e.y])).toEqual([
      ['歡迎光臨', 360, 180 - 13],
      ['大富翁銀行！', 360, 180 + 13],
    ]);
  });
});
