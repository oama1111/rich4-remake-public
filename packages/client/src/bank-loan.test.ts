/*
 * 銀行貸款屏（T-029b）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标照 exe（表 `0x4757f8`），门槛照那四支处理函数（`loc_00435c12` 起的跳表）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOAN_BUBBLE, LOAN_FINANCE_BUBBLE, LOAN_MSG } from './bank-dynamic.ts';
import {
  FINANCE_BORROW,
  FINANCE_BUTTONS,
  FINANCE_BYE,
  FINANCE_REPAY,
  LOAN_BLIND_WINDOW,
  LOAN_BUTTONS,
  LOAN_EXIT,
  LOAN_FINANCE,
  LOAN_FROZEN_MARK,
  LOAN_PRIMARY,
  LOAN_RESOURCE,
  LOAN_ROOM,
  LOAN_SECONDARY,
  hitFinanceButton,
  hitLoanButton,
  loanActionOf,
} from './bank-loan.ts';

describe('貸款屏几何 @source VA 0x436668 / 表 0x4757f8', () => {
  it('★ 底图是资源 23；两张房间 0 / 2；窗口那张是图 1', () => {
    expect(LOAN_RESOURCE).toBe(23);
    expect(LOAN_ROOM).toEqual({ normal: 0, chairman: 2 });
    expect(LOAN_BLIND_WINDOW).toEqual({ image: 1, x: 320, y: 240 });
    // 「申請貸款」的禁止章 = 图 23，落 (345,345)
    expect(LOAN_FROZEN_MARK).toEqual({ image: 23, x: 345, y: 345 });
  });

  it('★ 四颗钮的矩形照表 dump', () => {
    expect(LOAN_BUTTONS).toHaveLength(4);
    expect(LOAN_BUTTONS[LOAN_EXIT]).toEqual({ x0: 548, y0: 431, x1: 628, y1: 471 });
    expect(LOAN_BUTTONS[LOAN_PRIMARY]).toEqual({ x0: 282, y0: 324, x1: 408, y1: 366 });
    expect(LOAN_BUTTONS[LOAN_SECONDARY]).toEqual({ x0: 470, y0: 326, x1: 590, y1: 366 });
    // 窗口那颗最大 —— 所以命中要**最后**判它
    expect(LOAN_BUTTONS[LOAN_FINANCE]).toEqual({ x0: 268, y0: 51, x1: 591, y1: 273 });
  });

  it('★ 命中：四颗各中自己；两颗白单子与窗口不打架', () => {
    for (let i = 0; i < LOAN_BUTTONS.length; i++) {
      const b = LOAN_BUTTONS[i]!;
      expect(hitLoanButton(Math.floor((b.x0 + b.x1) / 2), Math.floor((b.y0 + b.y1) / 2))).toBe(i);
    }
    // 白单子在窗口那颗的**下面**（y 324/326 > 273）→ 不会被窗口抢走
    expect(hitLoanButton(345, 345)).toBe(LOAN_PRIMARY);
    expect(hitLoanButton(530, 345)).toBe(LOAN_SECONDARY);
    // 窗口本体
    expect(hitLoanButton(400, 150)).toBe(LOAN_FINANCE);
    expect(hitLoanButton(100, 150)).toBeNull(); // 窗外（店员那一侧）
  });
});

describe('四颗钮这一刻是什么意思 @source loc_00435c12 起的跳表', () => {
  it('★ 常态：申請貸款 / 償還貸款；董事長：週轉現金 / 歸還款項', () => {
    expect(loanActionOf(LOAN_PRIMARY, false, false, false)).toBe('borrow');
    expect(loanActionOf(LOAN_SECONDARY, false, false, true)).toBe('repay');
    expect(loanActionOf(LOAN_PRIMARY, true, false, false)).toBe('financeBorrow');
    expect(loanActionOf(LOAN_SECONDARY, true, false, true)).toBe('financeRepay');
  });

  it('★ 凍結时申請貸款不理（原版同时盖禁止章）', () => {
    expect(loanActionOf(LOAN_PRIMARY, false, true, false)).toBeNull();
    expect(loanActionOf(LOAN_PRIMARY, true, true, false)).toBeNull();
    // 償還不受凍結影响
    expect(loanActionOf(LOAN_SECONDARY, false, true, true)).toBe('repay');
  });

  it('★ 没欠款时償還不理', () => {
    expect(loanActionOf(LOAN_SECONDARY, false, false, false)).toBeNull();
    expect(loanActionOf(LOAN_SECONDARY, true, false, false)).toBeNull();
  });

  it('★ 窗口那颗只有董事長认', () => {
    expect(loanActionOf(LOAN_FINANCE, true, false, false)).toBe('financeBorrow');
    expect(loanActionOf(LOAN_FINANCE, false, false, false)).toBeNull();
  });

  it('★ EXIT 永远认；越界不认', () => {
    expect(loanActionOf(LOAN_EXIT, false, true, false)).toBe('exit');
    expect(loanActionOf(99, true, false, true)).toBeNull();
  });
});

// ============================================================
//  ★ Q-BANK-1a：董事長室左侧那三颗小钮的命中（表 `0x475818`）
//    @source `fcn_00434492` 的 `0x201` 分支（`rich4_ui_bank.asm:1506-1520`）
// ============================================================

describe('★ 特別融資子对话框：三颗小钮的命中矩形', () => {
  it('★★ 逐字节等于 `0x475818`（8 字节/项的有符号 16 位 x0,y0,x1,y1）', () => {
    expect(FINANCE_BUTTONS).toHaveLength(3);
    expect(FINANCE_BUTTONS[FINANCE_BORROW]).toEqual({ x0: 11, y0: 305, x1: 125, y1: 345 });
    expect(FINANCE_BUTTONS[FINANCE_REPAY]).toEqual({ x0: 11, y0: 362, x1: 125, y1: 402 });
    expect(FINANCE_BUTTONS[FINANCE_BYE]).toEqual({ x0: 11, y0: 419, x1: 91, y1: 459 });
    // 三颗的尺寸：前两颗 114×40，第三颗 80×40（与图 16/18 的尺寸一致）
    expect(FINANCE_BUTTONS[0]!.x1 - FINANCE_BUTTONS[0]!.x0).toBe(114);
    expect(FINANCE_BUTTONS[0]!.y1 - FINANCE_BUTTONS[0]!.y0).toBe(40);
    expect(FINANCE_BUTTONS[2]!.x1 - FINANCE_BUTTONS[2]!.x0).toBe(80);
  });

  it('★ 命中判据的**两端都闭**（原版 `jl` / `jg` 那四条）', () => {
    // 四角都算命中
    expect(hitFinanceButton(11, 305)).toBe(FINANCE_BORROW);
    expect(hitFinanceButton(125, 345)).toBe(FINANCE_BORROW);
    // 出界一格就不算
    expect(hitFinanceButton(10, 305)).toBeNull();
    expect(hitFinanceButton(126, 305)).toBeNull();
    expect(hitFinanceButton(11, 304)).toBeNull();
    expect(hitFinanceButton(11, 346)).toBeNull();
  });

  it('三颗各自的中心都命中自己', () => {
    expect(hitFinanceButton(68, 325)).toBe(FINANCE_BORROW);
    expect(hitFinanceButton(68, 382)).toBe(FINANCE_REPAY);
    expect(hitFinanceButton(51, 439)).toBe(FINANCE_BYE);
  });

  it('★ 三颗**互不重叠**（原版是「命中第一个就返回」）', () => {
    // 第一颗的 y 到 345，第二颗从 362 起 —— 中间 346..361 是空的
    expect(hitFinanceButton(68, 350)).toBeNull();
    expect(hitFinanceButton(68, 355)).toBeNull();
    // 第二颗到 402，第三颗从 419 起
    expect(hitFinanceButton(68, 410)).toBeNull();
  });

  it('★ 第三颗比前两颗**窄**（x 只到 91）：x 92..125 在第三颗那一行不算命中', () => {
    expect(hitFinanceButton(95, 439)).toBeNull();
    expect(hitFinanceButton(91, 439)).toBe(FINANCE_BYE);
    // 但那一段 x 在第一、二颗那一行是命中的
    expect(hitFinanceButton(95, 325)).toBe(FINANCE_BORROW);
    expect(hitFinanceButton(95, 382)).toBe(FINANCE_REPAY);
  });

  it('★ 与主屏那四颗（`0x4757f8`）不是同一张表 —— 各在各的矩形里', () => {
    // 主屏「窗」的矩形是 (268,51)-(591,273)，与小钮毫无重叠
    const win = LOAN_BUTTONS[LOAN_FINANCE]!;
    for (const b of FINANCE_BUTTONS) {
      const overlap = b.x0 <= win.x1 && win.x0 <= b.x1 && b.y0 <= win.y1 && win.y0 <= b.y1;
      expect(overlap).toBe(false);
    }
    // 而三颗小钮的中心**不**落在主屏任何一颗的矩形里（否则会被主屏抢走）
    for (const [x, y] of [[68, 325], [68, 382], [51, 439]] as const) {
      expect(hitFinanceButton(x, y)).not.toBeNull();
      expect(hitLoanButton(x, y)).toBeNull();
    }
  });

  it('★ 气泡落点是**图 22 @(214,50)**，不是主屏那张（图 21 @(240,80)）', () => {
    expect(LOAN_FINANCE_BUBBLE.image).toBe(22);
    expect([LOAN_FINANCE_BUBBLE.x, LOAN_FINANCE_BUBBLE.y]).toEqual([0xd6, 0x32]);
    expect(LOAN_FINANCE_BUBBLE.dy).toBe(-0x0a);
    // 与主屏那张确实不同
    expect(LOAN_FINANCE_BUBBLE.image).not.toBe(LOAN_BUBBLE.image);
    expect(LOAN_FINANCE_BUBBLE.x).not.toBe(LOAN_BUBBLE.x);
  });
});

describe('★ 特別融資子对话框：六句话 @source 串表 0x47585c..0x475870', () => {
  it('★ 逐条对上原版串号 0x86..0x91（缺 0x8a..0x8f 未用到）', () => {
    expect(LOAN_MSG.financeGreet.id).toBe(0x86);
    expect(LOAN_MSG.financeAskBorrow.id).toBe(0x87);
    expect(LOAN_MSG.financeNoCash.id).toBe(0x88);
    expect(LOAN_MSG.financeAskRepay.id).toBe(0x89);
    expect(LOAN_MSG.financeNoDebt.id).toBe(0x90);
    expect(LOAN_MSG.financeBye.id).toBe(0x91);
  });

  it('★ `#00xx` 是**颜色控制码**，显示文本要去掉它', () => {
    for (const m of [
      LOAN_MSG.financeGreet,
      LOAN_MSG.financeAskBorrow,
      LOAN_MSG.financeNoCash,
      LOAN_MSG.financeAskRepay,
      LOAN_MSG.financeNoDebt,
      LOAN_MSG.financeBye,
    ]) {
      expect(m.raw).toMatch(/^#[0-9a-f]{4}/);
      expect(m.text).not.toContain('#');
      expect(m.text.length).toBeGreaterThan(0);
    }
  });

  it('文本与原版一致（抽两条）', () => {
    expect(LOAN_MSG.financeGreet.text).toBe('董事長親自蒞臨\n不知有何指教？');
    expect(LOAN_MSG.financeBye.text).toBe('董事長慢走！');
    expect(LOAN_MSG.financeAskBorrow.text).toContain('週轉');
    expect(LOAN_MSG.financeAskRepay.text).toContain('還款');
  });
});

describe('★ 接线：`main.ts` 在董事長室里先接那三颗小钮', () => {
  const src = (): string => readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★ 只有当 `chairman` 为真时才试小钮（否则会抢走主屏那四颗）', () => {
    const s = src();
    const at = s.indexOf('const fb = hitFinanceButton(q.x, q.y);');
    expect(at).toBeGreaterThan(0);
    // 前面必须是 `if (loanNow.chairman) {`
    expect(s.slice(at - 120, at)).toContain('if (loanNow.chairman) {');
    // 小钮没中才轮到主屏那四颗
    const mainAt = s.indexOf('const btn = hitLoanButton(q.x, q.y);', at);
    expect(mainAt).toBeGreaterThan(at);
  });

  it('★ 前置判据照原版：`canBorrow` = 还有额度、`canRepay` = 还有欠款', () => {
    const s = src();
    const at = s.indexOf("loanSend({ kind: 'finance'");
    expect(at).toBeGreaterThan(0);
    const body = s.slice(at, at + 240);
    expect(body).toContain('canBorrow: room > 0');
    expect(body).toContain('canRepay: owed !== 0');
  });

  it('★★ `openForm` 的 op **直接透传**（否则 `financeBorrow` 会被当成 `repay`）', () => {
    const s = src();
    expect(s).toContain('openLoanAmount(effect.op);');
    expect(s).not.toContain("effect.op === 'borrow' ? 'borrow' : 'repay'");
  });
});
