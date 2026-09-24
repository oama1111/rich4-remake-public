/*
 * 審計 #15：全電腦對局的開局跳傘過場收不了場 —— 回歸釘子
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 復現（isolated headless Playwright，`?screen=game&humans=0&ai=4&mute=1`，改前）：
 * `__rich4.screen` 40 秒始終是 `'intro'`，而 `state.turnCount` 從 0 漲到 24 —— 電腦在過場底下全速開打，
 * 第一扇訊息框一開，渲染鏈走整屏分支，唯一的收場判據（寫在 `screen === 'intro'` 那一支裡）再也不跑。
 * 改後：過場 12.8 s 按時收場，之後才播首位的降落傘、才有第一次掷骰。
 *
 * 兩處根因各釘一條（接線活在 `main.ts` 的 rAF 回調 / 驅動入口裡，倉庫慣例是原始碼釘，見 `intro-net.test.ts`）：
 * ① 回合驅動在過場期間停著（`scheduleAi` 入口 + 節拍閘 `holdForActorWalkReason`）；
 * ② 收場判據在渲染鏈**之前**，不依賴「此刻沒有整屏接管」。
 * 聯機：收件箱本來就押著（`intro-net.test.ts`），這裡補「積壓快進」那一條也要等過場。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { driverParkedByScreen, shouldResumeDriver } from './driver-resume.ts';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const slice = (from: string, to: string): string => {
  const a = main.indexOf(from);
  const b = main.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? '' : main.slice(a, b);
};

const scheduleAi = slice('function scheduleAi(): void {', 'aiTimer = window.setTimeout(');
const holdReason = slice('function holdForActorWalkReason(): string | null {', 'if (stageBusy(stageBusyFlags()))');
const frame = slice('function requestRender(): void {', 'stageCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);');
const introBranch = slice("} else if (screen === 'intro') {", "} else if (screen === 'assets') {");
const pump = slice('function pumpNetInbox(', 'netPumpTimer = window.setTimeout(');

describe('★ 審計 #15 `driverParkedByScreen`', () => {
  it('過場期間停；棋盤與其它屏不在這裡判（那些屏有各自的閘）', () => {
    expect(driverParkedByScreen('intro')).toBe(true);
    expect(driverParkedByScreen('game')).toBe(false);
    expect(driverParkedByScreen('options')).toBe(false);
    expect(driverParkedByScreen('stock')).toBe(false);
  });

  it('過場放完那一幀照樣叫醒驅動（W-60 的邊沿判據）', () => {
    expect(shouldResumeDriver('intro', 'game')).toBe(true);
  });
});

describe('★ 審計 #15 main.ts 接線', () => {
  it('切片都取到了', () => {
    for (const s of [scheduleAi, holdReason, frame, introBranch, pump]) expect(s.length).toBeGreaterThan(40);
  });

  it('① `scheduleAi` 在排定時器**之前**就因過場返回（先前沒有屏號閘 ⇒ 電腦在過場底下開打）', () => {
    expect(scheduleAi).toContain('if (driverParkedByScreen(screen)) return;');
  });

  it('① 節拍閘在過場期間擋住（過場開始前就排好的那一拍也不派）', () => {
    const park = holdReason.indexOf("if (driverParkedByScreen(screen)) return 'intro';");
    expect(park).toBeGreaterThan(0);
    // 必須在「非棋盤屏一律放行」那一句之前，否則永遠輪不到
    expect(park).toBeLessThan(holdReason.indexOf("if (screen !== 'game') return null;"));
  });

  it('② 收場判據在渲染鏈之前（整屏接管開著也照樣按時收場）', () => {
    const end = frame.indexOf("if (screen === 'intro' && introDone(introStartedAt, performance.now(), introSkipped, introCast())) endIntro();");
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThan(frame.indexOf('if (shouldResumeDriver(lastFrameScreen, screen)) resumeTurnDriver();'));
    // 畫過場那一支只續幀，不再自己判收場
    expect(introBranch).toContain('drawIntro(');
    expect(introBranch).not.toContain('endIntro()');
  });

  it('聯機：積壓快進也等過場放完（快進施加出來的框會佔住整屏）', () => {
    expect(pump).toContain("if (netInbox.length > NET_INBOX_FAST_FORWARD && screen !== 'intro') {");
  });
});
