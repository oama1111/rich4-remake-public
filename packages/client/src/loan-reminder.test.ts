/*
 * 还款提醒窗（`0x436034`）的演出状态机
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import {
  REMINDER_CANCEL_SOUND,
  REMINDER_CLICK_SOUND,
  REMINDER_ST,
  reminderCancel,
  reminderClick,
  reminderStart,
  reminderText,
  reminderTick,
} from './loan-reminder.ts';
import { noticeText } from './notice-box-screen.ts';

const NAME = '孫小美';

describe('还款提醒窗的三句 @source 0x464aee / [0x475878]=0x464a2d / [0x47587c]=0x464a4b', () => {
  it('逐字（原版 CP950 串）', () => {
    expect(reminderText(REMINDER_ST.greet, NAME)).toBe('孫小美您好');
    expect(reminderText(REMINDER_ST.dueSoon, NAME)).toBe('您向銀行借貸的\n貸款即將到期。');
    expect(reminderText(REMINDER_ST.dontForget, NAME)).toBe('請不要忘記喔！');
  });

  it('音效：左键 1（`[0x482322]`）、右键 4（`[0x482332]`）', () => {
    expect(REMINDER_CLICK_SOUND).toBe(1);
    expect(REMINDER_CANCEL_SOUND).toBe(4);
  });
});

describe('定时器 50 ms 一拍、每句 2000 ms（`0x44ee18` 的 `cmp eax, 0x7d0`）', () => {
  it('开窗挂第一句；不到 2000 ms 不换', () => {
    const ui = reminderStart(NAME, 0);
    expect(ui.st).toBe(1);
    expect(ui.text).toBe('孫小美您好');
    const t = reminderTick(ui, 1950, NAME);
    expect(t.close).toBe(false);
    expect(t.ui.st).toBe(1);
  });

  it('不到 50 ms 的那一拍原样返回（同一个对象）', () => {
    const ui = reminderStart(NAME, 0);
    expect(reminderTick(ui, 30, NAME).ui).toBe(ui);
  });

  it('一句挂满 ⇒ 下一拍换句：1 → 2 → 3 → 关窗', () => {
    let ui = reminderStart(NAME, 0);
    let t = reminderTick(ui, 2000, NAME);
    expect(t.ui.st).toBe(2);
    expect(t.ui.text).toBe('您向銀行借貸的\n貸款即將到期。');
    ui = t.ui;
    t = reminderTick(ui, 4000, NAME);
    expect(t.ui.st).toBe(3);
    expect(t.ui.text).toBe('請不要忘記喔！');
    t = reminderTick(t.ui, 6000, NAME);
    expect(t.close).toBe(true);
  });

  it('左键：这一句当场收掉（`push 1 / call 0x44ee18`），下一拍就换', () => {
    const ui = reminderClick(reminderStart(NAME, 0));
    expect(ui.text).toBeNull();
    const t = reminderTick(ui, 60, NAME);
    expect(t.ui.st).toBe(2);
  });

  it('右键：跳到第三档并收掉 ⇒ 下一拍关窗；第三句时右键不理（`jae`）', () => {
    const cut = reminderCancel(reminderStart(NAME, 0));
    expect(cut).not.toBeNull();
    expect(cut!.st).toBe(3);
    expect(reminderTick(cut!, 60, NAME).close).toBe(true);
    const third = reminderTick(reminderTick(reminderStart(NAME, 0), 2000, NAME).ui, 4000, NAME).ui;
    expect(reminderCancel(third)).toBeNull();
  });
});

describe('还款日那几扇訊息框的字 @source 0x464b2c / 0x464b43 / 0x464b5c / 0x464af5', () => {
  it('core 的 key → 屏上那一句', () => {
    expect(noticeText({ key: 'bank.loanDueForced', args: [] })).toBe('貸款到期日\n\n強制執行！');
    expect(noticeText({ key: 'bank.loanDueOneDay', args: [] })).toBe('距貸款到期日\n\n還剩１天！');
    expect(noticeText({ key: 'bank.loanDueTwoDays', args: [] })).toBe('距貸款到期日\n\n還剩２天！');
    expect(noticeText({ key: 'bank.aiRepay', args: ['約翰喬', 10_000] })).toBe('約翰喬\n\n償還銀行貸款\n\n10000元');
  });
});
