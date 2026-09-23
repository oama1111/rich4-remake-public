/*
 * 銀行两屏的**动态部分**（Q-BANK-1 / T-029c）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这里只钉**纯函数**：滑入的 y 序列、状态机每一步、ATM 的键盘/进度条/拖动。
 * 绘制本身不碰 canvas（与仓库里其它屏同一套口径）。
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { setVoiceSink } from './voice-sink.ts';
import { FINANCE_BORROW, FINANCE_BYE, FINANCE_REPAY } from './bank-loan.ts';
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
  loanBubbleVoice,
  loanPanelsVisible,
  loanTickSlide,
  LOAN_TEXT_STYLE,
  verticalAdvance,
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
    // ★ 贴屏顶边：玩家面板 y = 0、日期面板 y = 0x118（0x43555a `add eax, 0x118` 加在 y 那个参数上）
    expect(LOAN_INFO_PANEL).toEqual({ resource: 23, image: 15, y: 0, w: 200, h: 280 });
    expect(LOAN_DATE_PANEL).toEqual({ y: 280, w: 200, h: 200 });
    // 两块叠起来正好占满右栏 480 高
    expect(LOAN_DATE_PANEL.y + LOAN_DATE_PANEL.h).toBe(480);
    // 到位 x = 440 时右边缘正好是 640（RECT.right = 0x280 @0x435503）
    expect(LOAN_SLIDE.shown + LOAN_INFO_PANEL.w).toBe(640);
    // 日期面板的季节图来自资源 2 的图 0..3
    expect(LOAN_MONTH_SCENE).toEqual([3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3]);
  });

  it('★ 进屏：x 640 → 440（从右边滑进来），每拍 −40，到位那拍就把 dx 归零', () => {
    let s = loanSlideIn();
    expect(s).toEqual({ x: 0x280, dx: -0x28 });
    const xs: number[] = [s.x];
    for (let i = 0; i < 10; i++) {
      s = loanSlideStep(s);
      xs.push(s.x);
      if (loanSlideDone(s)) break;
    }
    expect(xs).toEqual([640, 600, 560, 520, 480, 440]);
    expect(s).toEqual({ x: LOAN_SLIDE.shown, dx: 0 });
    // 停住之后不再动
    expect(loanSlideStep(s)).toEqual(s);
  });

  it('★ 收尾：x 440 → 640（往右退），每拍 +40', () => {
    let s = loanSlideOut();
    const xs: number[] = [s.x];
    for (let i = 0; i < 10; i++) {
      s = loanSlideStep(s);
      xs.push(s.x);
      if (loanSlideDone(s)) break;
    }
    expect(xs).toEqual([440, 480, 520, 560, 600, 640]);
    expect(s).toEqual({ x: LOAN_SLIDE.hidden, dx: 0 });
  });

  it('★ 有没有露出来看 x（贴屏的裁切口径）', () => {
    expect(loanPanelsVisible({ x: LOAN_SLIDE.hidden, dx: 0 })).toBe(false);
    expect(loanPanelsVisible({ x: LOAN_SLIDE.hidden - 1, dx: -LOAN_SLIDE.step })).toBe(true);
    expect(loanSlideDone({ x: 500, dx: -40 })).toBe(false);
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
    expect(withGreet.slide).toEqual({ x: LOAN_SLIDE.hidden, dx: 0 });
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
    expect(ok.slide.dx).toBe(-LOAN_SLIDE.step);
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

  it('★★ 窗那颗只有董事長认，且它开的是特別融資**子对话框**（不是填数页）', () => {
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
    // @source `loc_00435ddb`：状态 0xa + `Wait_0402_Message(fcn_00434492)`，
    // 子对话框自己那句招呼是 #0086；**没有** effect（填数页要等点小钮才开）
    expect(r.effect).toBeNull();
    expect(r.ui.financeOpen).toBe(true);
    expect(r.ui.bubble).toBe(LOAN_MSG.financeGreet);
    // 已经开着就不再开一次
    expect(step(r.ui, { kind: 'press', btn: 3, frozen: false, hasLoan: false, chairman: true, overLimit: false }).ui)
      .toBe(r.ui);
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
    expect(ui.slide.dx).toBe(LOAN_SLIDE.step);
  });

  /** 按原版一拍的次序：先滑入段、再气泡到点（这里气泡都算已到点）*/
  const tickUntilStill = (ui: LoanUi): LoanUi[] => {
    const seen: LoanUi[] = [];
    for (let i = 0; i < 10 && !loanSlideDone(ui.slide); i++) {
      ui = loanTickSlide(ui);
      seen.push(ui);
    }
    return seen;
  };

  it('★ 借到手 → #0079 → #0080 → 面板往右退净那一拍 st = 0xb、同拍关屏 @source 0x435348 / 0x43560b', () => {
    let ui = press({ ...loanStart(false), st: LOAN_ST.ready }, 1);
    // 滑入 5 拍到位；到位不关
    const inTicks = tickUntilStill(ui);
    expect(inTicks.map((u) => u.slide.x)).toEqual([600, 560, 520, 480, 440]);
    ui = inTicks.at(-1)!;
    expect(ui.st).toBe(LOAN_ST.borrowIn);
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    ui = step(ui, { kind: 'formClosed', amount: 5000, cash: 0, deposit: 0 }).ui;
    expect(ui.dealDone).toBe(true);
    ui = step(ui, { kind: 'bubbleEnd' }).ui; // 7 → 8 + #0080
    ui = step(ui, { kind: 'bubbleEnd' }).ui; // 8 → 滑回去，st = 4
    expect(ui.st).toBe(LOAN_ST.ready);
    const outTicks = tickUntilStill(ui);
    expect(outTicks.map((u) => u.slide.x)).toEqual([480, 520, 560, 600, 640]);
    // 前 4 拍还在 st = 4（可点钮），退净那一拍才转 0xb 且**不挂气泡**
    expect(outTicks.slice(0, -1).every((u) => u.st === LOAN_ST.ready)).toBe(true);
    ui = outTicks.at(-1)!;
    expect(ui.st).toBe(LOAN_ST.bye);
    expect(ui.bubble).toBeNull();
    // 同一拍 `0x44ee18` 没有气泡返回 1 → case 0xb → 关屏
    expect(step(ui, { kind: 'bubbleEnd' }).effect).toEqual({ kind: 'close' });
  });

  it('★ 还款办完、借款填 0：面板退净后**不**关屏（[0x48c3e2] 只在借到手时置 1）', () => {
    const base = press({ ...loanStart(false), st: LOAN_ST.ready }, 2, { hasLoan: true });
    let ui = step(base, { kind: 'bubbleEnd' }).ui;
    ui = step(ui, { kind: 'formClosed', amount: 100, cash: 1000, deposit: 0 }).ui;
    ui = step(ui, { kind: 'bubbleEnd' }).ui;
    expect(ui.dealDone).toBe(false);
    ui = tickUntilStill(ui).at(-1)!;
    expect(ui.slide).toEqual({ x: LOAN_SLIDE.hidden, dx: 0 });
    expect(ui.st).toBe(LOAN_ST.ready);
    // 静止时再走一拍什么都不变
    expect(loanTickSlide(ui)).toBe(ui);
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
    expect(ok.dealDone).toBe(true);
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
    expect(atmPressedImage(1)).toBe(1); // 提款（钮 0，左上）
    expect(atmPressedImage(2)).toBe(2); // 存款（钮 1，中间）
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
    slide: { x: LOAN_SLIDE.shown, dx: 0 },
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

  it('★ 面板没露出来（x = 640）就整块不画', () => {
    const f = fakeCtx();
    drawLoanPanels(f.ctx, spriteFn, view({ slide: { x: LOAN_SLIDE.hidden, dx: 0 } }));
    expect(f.images).toHaveLength(0);
    expect(f.texts).toHaveLength(0);
  });

  it('★ 玩家面板贴 (x,0)、日期面板贴 (x,280)；文字都在面板局部坐标 + (x, 面板顶) 上', () => {
    const f = fakeCtx();
    drawLoanPanels(f.ctx, spriteFn, view());
    // 玩家面板底图（图 15）带锚点 (0,0) → 落点就是 (440,0) @source 0x435552 fcn_004563f5(屏, [0x48c3b8], x, 0)
    expect(f.images[0]).toEqual({ dx: 440, dy: 0, w: undefined, h: undefined });
    // 头像要减锚点：落 (440 + 0x2a − 10, 0x28 − 20) = (472, 20)
    expect(f.images[1]).toEqual({ dx: 472, dy: 20, w: undefined, h: undefined });
    // 日期面板的季节底图贴 (440,280) @source 0x43557c fcn_004563f5(屏, [0x48c3b4], x, 0x118)
    expect(f.images[2]).toEqual({ dx: 440, dy: 280, w: undefined, h: undefined });
    // 正文那一遍是**最后**画的；字效 bit2（描边）时正文落在 (+1,+1) @source 0x44fe1e —— 两块面板的字全带 bit2
    const O = 1;
    const at = (t: string): { x: number; y: number } => {
      const hit = [...f.texts].reverse().find((e) => e.t === t);
      if (hit === undefined) throw new Error(`没画「${t}」`);
      return { x: hit.x, y: hit.y };
    };
    expect(at('阿土伯')).toEqual({ x: 440 + 0x52 + O, y: 0x1c + O });
    expect(at('現  金')).toEqual({ x: 440 + 0x0a + O, y: 0x50 + O });
    expect(at('存  款')).toEqual({ x: 440 + 0x0a + O, y: 0x91 + O });
    expect(at('貸  款')).toEqual({ x: 440 + 0x0a + O, y: 0xd0 + O });
    expect(at('$12,345')).toEqual({ x: 440 + 0xb4 + O, y: 0x64 + O });
    expect(at('$67,890')).toEqual({ x: 440 + 0xb4 + O, y: 0xa4 + O });
    expect(at('$1,000')).toEqual({ x: 440 + 0xb4 + O, y: 0xe4 + O });
    // 日期面板（y 都要 + 280）
    expect(at('5')).toEqual({ x: 440 + 0x3c + O, y: 280 + 0x60 + O });
    expect(at('1998')).toEqual({ x: 440 + 0x8c + O, y: 280 + 0x08 + O });
    expect(at('3月')).toEqual({ x: 440 + 0x3c + O, y: 280 + 0x30 + O });
    expect(at(LOAN_DUE_TEXT.replace('%d', '88'))).toEqual({ x: 440 + 0x14 + O, y: 280 + 0xb0 + O });
    // ★ 星期是 flag 3 = **竖排**：一字一行，整块以 (0x0e, 0x48) 为中心，
    //   字距 = 字号 16 + 字距 1 + 粗/描边 1 = 18 @source fcn_0044f7c7 0x44f7de..0x44f7f2
    expect(f.texts.some((e) => e.t === '星期四')).toBe(false);
    expect(at('星')).toEqual({ x: 440 + 0x0e + O, y: 280 + 0x48 - 18 + O });
    expect(at('期')).toEqual({ x: 440 + 0x0e + O, y: 280 + 0x48 + O });
    expect(at('四')).toEqual({ x: 440 + 0x0e + O, y: 280 + 0x48 + 18 + O });
    // ★ 到位时所有字都落在屏内（先前读成顶边 y 时，440 + 0xe4 早就出了 480）
    for (const e of f.texts) {
      expect(e.x).toBeGreaterThanOrEqual(440);
      expect(e.x).toBeLessThan(640);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThan(480);
    }
  });

  it('★ 字效照 create_font：玩家面板白字深描边、日期面板深字白描边（与棋盘右栏日曆同参）', () => {
    // @source 00433dba / 00433e26 / 00433fc0..00434116
    expect(LOAN_TEXT_STYLE.label).toEqual({ size: 12, color: '#ffffff', color2: '#101010', flags: 4, spacing: 0 });
    expect(LOAN_TEXT_STYLE.info).toEqual({ size: 22, color: '#ffffff', color2: '#101010', flags: 6, spacing: 0 });
    expect(LOAN_TEXT_STYLE.date(0x10)).toEqual({ size: 16, color: '#101010', color2: '#ffffff', flags: 6, spacing: 1 });
    expect(verticalAdvance(LOAN_TEXT_STYLE.date(0x10))).toBe(18);
  });

  it('★ 滑到一半（x = 520）：两块面板一起横移，y 不动', () => {
    const f = fakeCtx();
    drawLoanPanels(f.ctx, spriteFn, view({ slide: { x: 520, dx: -40 } }));
    expect(f.images[0]).toEqual({ dx: 520, dy: 0, w: undefined, h: undefined });
    expect(f.images[2]).toEqual({ dx: 520, dy: 280, w: undefined, h: undefined });
  });

  it('★ 有節日插画时整张盖掉季节底图（200×200 拉到面板上）', () => {
    const f = fakeCtx();
    const art = {} as ImageBitmap;
    drawLoanPanels(f.ctx, spriteFn, view({ holidayArt: art }));
    // 第 3 张图就是插画（0 = 玩家面板底、1 = 头像），按 200×200 画在 (440,280)
    expect(f.images[2]).toEqual({ dx: 440, dy: 280, w: 200, h: 200 });
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

// ============================================================
//  ★ Q-BANK-1a：董事長室三颗小钮 @source `fcn_00434492` 的 `0x202`
// ============================================================

describe('★ 特別融資子对话框的三颗小钮 @source `loc_00434da1`', () => {
  /**
   * 招呼说完 **且子对话框已开**那一刻（= 原版「按了窗、子对话框的状态 2」）。
   * 原版只有这一格受理那三颗小钮 —— 点「窗」之前它们根本不在。
   */
  const ready = (): ReturnType<typeof loanStart> => ({
    ...loanStart(false),
    st: LOAN_ST.ready,
    financeOpen: true,
  });
  const fin = (
    ui: ReturnType<typeof loanStart>,
    btn: number,
    canBorrow = true,
    canRepay = true,
  ): ReturnType<typeof loanStep> =>
    loanStep(ui, { kind: 'finance', btn, canBorrow, canRepay });

  it('★ 週轉現金 → 气泡 #0087 + 开**週轉**填数页（不是还款！）', () => {
    const r = fin(ready(), FINANCE_BORROW);
    expect(r.ui.bubble).toBe(LOAN_MSG.financeAskBorrow);
    expect(r.effect).toEqual({ kind: 'openForm', op: 'financeBorrow' });
  });

  it('★ 沒額度時週轉現金**什么都不做**（连气泡都不换）@source `jge` 那条', () => {
    const base = ready();
    expect(fin(base, FINANCE_BORROW, false, true)).toEqual({ ui: base, effect: null });
  });

  it('★ 歸還款項 → 气泡 #0089 + 开**還款**填数页', () => {
    const r = fin(ready(), FINANCE_REPAY);
    expect(r.ui.bubble).toBe(LOAN_MSG.financeAskRepay);
    expect(r.effect).toEqual({ kind: 'openForm', op: 'financeRepay' });
  });

  it('★ 沒欠款時歸還款項什么都不做 @source `cmp dword [eax+0x496b90], 0 / je`', () => {
    const base = ready();
    expect(fin(base, FINANCE_REPAY, true, false)).toEqual({ ui: base, effect: null });
  });

  it('★★ 第三颗 = 離開：**只收子对话框**、回银行贷款屏（返回标志 0）', () => {
    // @source `loc_00434f25`（子对话框状态 7 + 串 #0091）→ `loc_0043490f`
    //   `Post_0402_Message([0x48c3d0])`，而 `[0x48c3d0]` **没置 1** ⇒ 主屏
    //   `loc_00435e1d` 走 `[0x48c3dd] = 4`：回到银行屏、**不关屏**。
    const r = fin(ready(), FINANCE_BYE);
    expect(r.ui.st).toBe(LOAN_ST.ready);
    expect(r.ui.financeOpen).toBe(false);
    expect(r.ui.bubble).toBe(LOAN_MSG.financeBye);
    // 自己给自己发一条返回消息（原版 `Post_0402_Message`）
    expect(r.effect).toEqual({ kind: 'financeClosed', ok: false });
    // 主屏收到它之后仍在 `ready`（银行屏不关）
    const back = loanStep(r.ui, { kind: 'financeClosed', ok: false }).ui;
    expect(back.st).toBe(LOAN_ST.ready);
    expect(back.financeOpen).toBe(false);
    // 收完之后银行屏还在（不是 close）
    expect(loanStep(back, { kind: 'bubbleEnd' }).effect).toBeNull();
  });

  it('★★ 週轉成功 ⇒ 返回标志 1 + 收场（`loc_0043469a` 的 `[0x48c3d0] = 1`）', () => {
    // 走到「填数页开着」那一刻：週轉現金 → 开页 → 付款
    const ask = fin(ready(), FINANCE_BORROW).ui;
    const r = loanStep(
      { ...ask, st: LOAN_ST.borrowAsk },
      { kind: 'formClosed', amount: 5000, cash: 0, deposit: 0 },
    ).ui;
    expect(r.dealDone).toBe(true);
    expect(r.financeOpen).toBe(false);
    expect(r.st).toBe(LOAN_ST.bye); // 主屏状态 0xb = 收场
  });

  it('★★ 週轉额 = 0 ⇒ 子对话框留着（状态 2 / ready，不挂气泡）', () => {
    const ask = fin(ready(), FINANCE_BORROW).ui;
    const r = loanStep(
      { ...ask, st: LOAN_ST.borrowAsk },
      { kind: 'formClosed', amount: 0, cash: 0, deposit: 0 },
    ).ui;
    expect(r.st).toBe(LOAN_ST.ready);
    expect(r.financeOpen).toBe(true);
    expect(r.dealDone).toBe(false);
    expect(r.bubble).toBeNull();
  });

  it('★★ 子对话框那两颗**按下的下一拍**就开填数页（不再等气泡说完）', () => {
    const inBorrow = fin(ready(), FINANCE_BORROW);
    expect(inBorrow.ui.formOp).toBe('financeBorrow');
    expect(inBorrow.ui.st).toBe(LOAN_ST.borrowAsk);
    expect(inBorrow.effect).toEqual({ kind: 'openForm', op: 'financeBorrow' });
    // 气泡到点时**不要**再开一次（先前那版留在 borrowIn，于是气泡到点用
    // 写死的 'borrow' 把已经填了一半的那页冲掉 —— 真机上抓到的）
    expect(loanStep(inBorrow.ui, { kind: 'bubbleEnd' }).effect).toBeNull();
    const inRepay = fin(ready(), FINANCE_REPAY);
    expect(inRepay.ui.formOp).toBe('financeRepay');
    expect(inRepay.ui.st).toBe(LOAN_ST.repayAsk);
    expect(inRepay.effect).toEqual({ kind: 'openForm', op: 'financeRepay' });
    expect(loanStep(inRepay.ui, { kind: 'bubbleEnd' }).effect).toBeNull();
  });

  it('★ 一般貸款那两颗仍走 `borrowIn` → 气泡说完才开页（op 取自 `formOp`）', () => {
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    const normalBorrow = loanStep(base, {
      kind: 'press',
      btn: 1,
      frozen: false,
      hasLoan: false,
      chairman: false,
      overLimit: false,
    });
    expect(normalBorrow.ui.st).toBe(LOAN_ST.borrowIn);
    expect(normalBorrow.ui.formOp).toBe('borrow');
    expect(loanStep(normalBorrow.ui, { kind: 'bubbleEnd' }).effect).toEqual({
      kind: 'openForm',
      op: 'borrow',
    });
  });

  it('★★ 点「窗」之前那三颗小钮**点了没反应**（原版那时子对话框还没开）', () => {
    const closed = { ...loanStart(false), st: LOAN_ST.ready };
    for (const btn of [FINANCE_BORROW, FINANCE_REPAY, FINANCE_BYE]) {
      expect(fin(closed, btn), `btn=${btn}`).toEqual({ ui: closed, effect: null });
    }
  });

  it('★ **只有 `ready` 那一格受理**小钮（别的状态一律不动）', () => {
    for (const st of [LOAN_ST.menu, LOAN_ST.borrowIn, LOAN_ST.settle, LOAN_ST.bye]) {
      const base = { ...loanStart(false), st };
      for (const btn of [FINANCE_BORROW, FINANCE_REPAY, FINANCE_BYE]) {
        expect(fin(base, btn), `st=${st} btn=${btn}`).toEqual({ ui: base, effect: null });
      }
    }
  });

  it('未知钮号不动状态', () => {
    const base = ready();
    expect(fin(base, 99)).toEqual({ ui: base, effect: null });
  });

  it('★ 三颗小钮与主屏那四颗**互不干扰**：btn 号空间是分开的', () => {
    // 主屏 `press` 的 btn 0..3 与子对话框的 0..2 用**不同的事件种类**区分
    const base = ready();
    // `press btn 0` = EXIT 记按下（不改状态），而 `finance btn 0` = 週轉現金
    expect(loanStep(base, { kind: 'press', btn: 0, frozen: false, hasLoan: true, chairman: true, overLimit: false }).ui.st)
      .toBe(LOAN_ST.ready);
    // 子对话框那颗直接进 `borrowAsk`（原版按下的下一拍就开填数页）
    expect(fin(base, FINANCE_BORROW).ui.st).toBe(LOAN_ST.borrowAsk);
  });
});

// ============================================================
//  main.ts 的接线 —— 「動畫過程」管着招呼那一句（Q-ANIM-1）
// ============================================================

describe('★ 銀行招呼归「動畫過程」管（@source loc_00435200）', () => {
  it('main.ts 传 options.animation，不再写死 true', () => {
    // @source VA 0x00435200：`cmp byte [0x497159],0 / je → [0x48c3dd] = 3`
    //   （`[0x497159]` = `RICH4.CFG+1` = 动画开关）。关掉时**不说** #0075。
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('loanStart(options.animation)');
    expect(src).not.toContain('loanStart(true)');
  });

  it('loanStart(false) 直达 menu、没有气泡（与 exe 的 st = 3 一致）', () => {
    const quiet = loanStart(false);
    expect(quiet.st).toBe(LOAN_ST.menu);
    expect(quiet.bubble).toBeNull();
    expect(loanStart(true).st).toBe(LOAN_ST.greet);
  });
});

// ============================================================
//  ★ 进银行那一句招呼的**语音**（试玩回报：「进入银行没有触发语音」）
// ============================================================

describe('★ 貸款屏换一句台詞 → 语音出口（@source 0x435d8c → 0x44ecb6 → 0x44fabc → 0x45441a）', () => {
  afterEach(() => setVoiceSink(null));

  /** 记下每一次送到语音出口的编号 */
  const spy = (): number[] => {
    const played: number[] = [];
    setVoiceSink((v) => played.push(v));
    return played;
  };

  it('★ #0075 那一句 = `大富翁銀行！`，语号 **75**（十进制）—— 与 exe 串表 0x475830 逐字相同', () => {
    // @source VA 0x00475830 指向的串（BIG5）= `#0075歡迎光臨\n大富翁銀行！`
    // ★ 语号是**十进制**：`rich4_draw_text` 把 4 个 ASCII 数字按位拼成
    //   `d0*1000 + d1*100 + d2*10 + d3`（@source 0x0044fb07..0x0044fb4b），
    //   再 `0x0044fb4e call 0x45441a`（`play_speech`）。
    //   ⚠️ `LOAN_MSG.*.id` 用的是「把十进制数字写成 0x..」的旧记法（`id: 0x75`
    //   实际 = 117），只是标注；**真正送出去的号以 `raw` 的 `#NNNN` 为准**。
    expect(LOAN_MSG.greet.raw.startsWith('#0075')).toBe(true);
    expect(LOAN_MSG.greet.text).toBe('歡迎光臨\n大富翁銀行！');
    expect(Number(LOAN_MSG.greet.raw.slice(1, 5))).toBe(75);
  });

  it('★★ 进屏那一句真的会播：`loanBubbleVoice(null, greet)` → sink 收到 75', () => {
    const played = spy();
    const ok = loanBubbleVoice(null, LOAN_MSG.greet);
    expect(ok).toBe(true);
    expect(played).toEqual([75]);
  });

  it('★ 反例（falsification）：同一句连着来第二次**不再播**（原版只在换句那一拍调 0x44ecb6）', () => {
    const played = spy();
    expect(loanBubbleVoice(null, LOAN_MSG.greet)).toBe(true);
    expect(loanBubbleVoice(LOAN_MSG.greet, LOAN_MSG.greet)).toBe(false);
    expect(loanBubbleVoice(LOAN_MSG.greet, LOAN_MSG.greet)).toBe(false);
    expect(played).toEqual([75]); // ★ 一次，不是三次
  });

  it('★ 反例：不说（`null`）时一下都不播；动画关掉时（loanStart(false)）也没有可播的句子', () => {
    const played = spy();
    expect(loanBubbleVoice(null, null)).toBe(false);
    expect(loanBubbleVoice(LOAN_MSG.greet, null)).toBe(false);
    expect(played).toEqual([]);
    expect(loanBubbleVoice(null, loanStart(false).bubble)).toBe(false);
    expect(played).toEqual([]);
  });

  it('★ 16 句台词的语号逐个对上串表（`#NNNN` 的十进制值 = `id` 那一串数字）', () => {
    for (const msg of Object.values(LOAN_MSG)) {
      const fromRaw = msg.raw.slice(1, 5);
      // `id` 把同一串数字写成了十六进制字面量（`0x75` ↔ `#0075`）：逐句核这层对应
      expect(msg.id).toBe(Number.parseInt(fromRaw, 16));
      // 十进制读数就是原版 `play_speech` 会拿到的号（1..134 都在 `Speaking.mkf` 范围内）
      expect(Number(fromRaw)).toBe(Number.parseInt(fromRaw, 10));
    }
  });

  it('★★ 一条真路径：招呼 → #0076 → 就绪，语音正好两次（0x75、0x76），不是每拍一次', () => {
    const played = spy();
    // 这一小段就是 main.ts 的 `syncLoanUi` + `loanEffect` 那段接线（同一判据）
    let prev: (typeof LOAN_MSG)[keyof typeof LOAN_MSG] | null = null;
    let ui = loanStart(true);
    if (loanBubbleVoice(prev, ui.bubble)) prev = ui.bubble;
    expect(ui.st).toBe(LOAN_ST.greet);
    expect(ui.bubble).toBe(LOAN_MSG.greet);
    // 0x113 那一拍：招呼看完 → #0076
    ui = loanStep(ui, { kind: 'bubbleEnd' }).ui;
    if (loanBubbleVoice(prev, ui.bubble)) prev = ui.bubble;
    expect(ui.bubble).toBe(LOAN_MSG.menu);
    // 再看一拍：#0076 看完 → 就绪，没有新句子
    ui = loanStep(ui, { kind: 'bubbleEnd' }).ui;
    if (loanBubbleVoice(prev, ui.bubble)) prev = ui.bubble;
    expect(ui.st).toBe(LOAN_ST.ready);
    expect(ui.bubble).toBeNull();
    expect(played).toEqual([75, 76]);
  });

  it('★ 特別融資子对话框那六句也走同一条出口（@source 0x43465b call 0x44ecb6）', () => {
    const played = spy();
    // 进子对话框那一句 #0086（`0x434654 [0x47585c]` → `0x43465b call 0x44ecb6`）
    const base = { ...loanStart(false), st: LOAN_ST.ready };
    const r = loanStep(base, {
      kind: 'press',
      btn: 3,
      frozen: false,
      hasLoan: false,
      chairman: true,
      overLimit: false,
    });
    expect(r.ui.bubble).toBe(LOAN_MSG.financeGreet);
    expect(loanBubbleVoice(base.bubble, r.ui.bubble)).toBe(true);
    expect(played).toEqual([86]);
  });

  it('★ main.ts 的接线：进屏那一句 + 换句那一处，且**绘制链一处都不碰**', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('loanBubbleVoice(null, loanUi.bubble)');
    expect(main).toContain('loanBubbleVoice(hadBubble, ui.bubble)');
    // 绘制链（`drawLoanBubble`）每帧都跑 —— 那里绝不能有语音触发
    const dynamic = readFileSync(new URL('./bank-dynamic.ts', import.meta.url), 'utf8');
    expect(dynamic.match(/playVoiceCode\(/g)).toHaveLength(1);
  });
});
