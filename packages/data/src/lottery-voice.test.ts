/*
 * 樂透屏（投注屏 + 開獎屏）的語音碼前綴 —— 第十一份試玩回報 #14
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回報（`feedback/20260922-200723981-manual-Charles.json`，回合 60）：
 * 「进入乐透购买模块没有触发正确的背景音乐和猫女台词语音」。
 *
 * 查證結果（BGM 那一半**沒問題**：log 裡就是 `♪ midi07.mid`，exe 上 `0x47e793[6] = "MIDI07.MID"`，
 * 而且原版樂透投注站與百貨公司**共用同一首**）—— 有問題的是**語音**：
 * 這 14 條串在移植時把 `#NNNN` 語音碼**弄丟了**（只留在註解裡），
 * 而客戶端的語音只認**字面前綴**（`voice-sink.ts` 的 `parseVoiceCode` 要求 `#` + 4 位數字）
 * ⇒ 整屏靜音。
 *
 * 修法：`va` 從前綴**後一格**改指**前綴起點**（原值 − 5），`text` 補回 `#NNNN`
 * —— 這樣本檔的逐字節守衛（`messages.test.ts`）仍然成立。
 * 這條測試釘住「每條都有前綴、且號碼與 `va−5` 處的 exe 字節一致」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOTTERY } from './messages.ts';

const DGROUP_FILE_OFFSET = 398848;
const DGROUP_VA = 0x463000;
// ★ 与其余真值测试同一口径：从 `RICH4_WORKSPACE` 起算（`vitest.config.ts` 缺省 = 仓库上一级）。
//   先前按仓库相对路径 `../../../../Rich4` 找，在 git worktree（`wt12/<名>/`）里找不到 ⇒ 静默 skip。
const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';

const exists = (() => {
  try {
    readFileSync(EXE);
    return true;
  } catch {
    return false;
  }
})();
const run = exists ? it : it.skip;

/** 带语音的那 14 条（`poolLabel` 是開獎屏上的标签，原版就没有语音前缀） */
const VOICED = [
  'counterHello', 'counterPrice', 'counterPick', 'counterBye', 'counterNoCash', 'counterComeAgain',
  'drawIntro', 'drawRolling', 'drawWinnerIs', 'drawWinAll', 'drawNoWinner', 'drawCarryOver',
  'drawHopeNext', 'drawHurryUp',
] as const;

describe('★ 樂透語音碼', () => {
  it('★ 14 條带语音的都以 `#` + 4 位數字開頭（否則客戶端不會播語音）', () => {
    for (const name of VOICED) {
      expect(LOTTERY[name].text, `${name} 少了語音碼前綴`).toMatch(/^#\d{4}/);
    }
  });

  it('★ 那条标签**没有**前缀（钉住「别把标签也加上」）', () => {
    expect(LOTTERY.poolLabel.text).not.toMatch(/^#/);
  });

  run('★★ 前綴與 exe 的 `va−5` 處逐字節一致（14 條全部）', () => {
    const exe = readFileSync(EXE);
    for (const name of VOICED) {
      const entry = LOTTERY[name];
      const off = DGROUP_FILE_OFFSET + (entry.va - DGROUP_VA);
      const bytes = exe.subarray(off, off + 5).toString('latin1');
      expect(bytes, `${name}（va=0x${entry.va.toString(16)}）的 exe 前綴`).toBe(entry.text.slice(0, 5));
    }
  });

  // ★ `poolLabel` 的 exe 逐字節比對由 `messages.test.ts` 的 `ALL_TEXTS` 守衛負責
  //   （那條用 Big5 解，這裡不重複造一套；本檔只管「語音前綴」這一件事）。
});
