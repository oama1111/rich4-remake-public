/*
 * 聯機開局過場的接線钉子（第九份試玩回報，2026-09-22）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回報（Charles，`feedback/20260922-122902811-manual-Charles.json`）：
 * 「多人模式开局没有机舱跳伞的过场动画」。
 * 過場本身一直在（`intro.ts`，單機一直在播）—— 是**聯機這條路沒接**：
 * `onStart` 先前直接 `screen = 'game'`。
 *
 * ⚠️ 為什麼用原始碼釘而不是行為測：這段活在 `main.ts` 的 websocket 回調裡，
 *   要真跑得整條 `connectOnline` + 一個伺服器。倉庫對這類接線的既定做法就是
 *   原始碼釘（見 `feedback-button.test.ts`）。`intro.ts` 自己的 5 條斷言仍由
 *   `intro.test.ts` 守著。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

/** 聯機收到伺服器 `start` 之後那一段 */
const onStart = main.slice(
  main.indexOf('onStart: (start) => {'),
  main.indexOf('// ★★ 第七份试玩回报第 1 条'),
);

/** `pumpNetInbox` 的那個 setTimeout 回調 */
const pump = main.slice(
  main.indexOf('function pumpNetInbox('),
  main.indexOf('function startNetTick('),
);

describe('聯機開局過場', () => {
  it('onStart 真的取到了（切片的兩端都還在）', () => {
    expect(onStart.length).toBeGreaterThan(500);
    expect(pump.length).toBeGreaterThan(200);
  });

  it('★ 剛開局 ⇒ 進過場（與單機 startGame 同一套四行）', () => {
    expect(onStart).toContain('if (roomJoinedUnstarted) {');
    expect(onStart).toContain('introStartedAt = performance.now();');
    expect(onStart).toContain('introSkipped = false;');
    expect(onStart).toContain('introSoundPlayed = false;');
    expect(onStart).toContain("screen = 'intro';");
  });

  it('★ 重連 / 刷新 ⇒ 直接進棋盤，不重播過場', () => {
    // 兩支都在（`if` / `else`），不是無條件進過場
    expect(onStart).toMatch(/if \(roomJoinedUnstarted\) \{[\s\S]*?\} else \{\s*screen = 'game';\s*\}/);
  });

  it('★ fresh 的判據來自 onJoined 的 `info.started`，不是 `since`', () => {
    expect(main).toContain('roomJoinedUnstarted = !info.started;');
    expect(main).toContain('let roomJoinedUnstarted = false;');
  });

  it('onStart 補齊了單機 startGame 的其餘開局動作', () => {
    for (const line of [
      'goButton.reset();',
      'holidayBgmDays = 0;',
      'playBoardBgm(1);',
      'ensureSpeakingArchive();',
      'speechQueue.push(openingSpeech(state), performance.now())',
      'setGround(null);',
    ]) {
      expect(onStart, `onStart 應含 ${line}`).toContain(line);
    }
    // 不再裸寫 `ground = null`（那會泄漏舊 bitmap）
    expect(onStart).not.toContain('ground = null;');
  });

  it('★ 過場期間不施加網絡 action（先跳過的人不該吞掉別人的第一回合演出）', () => {
    expect(pump).toContain("if (screen === 'intro') {");
    expect(pump).toContain('pumpNetInbox(RENDER_MS);');
  });

  it('重連的 early-return 把「過場中」也算成「已在這一局」', () => {
    expect(onStart).toContain("if (since !== undefined && (screen === 'game' || screen === 'intro')) return;");
  });
});
