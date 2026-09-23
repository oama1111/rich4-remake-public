/*
 * 「買地 / 買設施成功」那一声 —— 源码钉（需求方 2026-09-22）
 *
 * `playSoundFor` 住在 main.ts 里（碰 DOM / 音频 / 定时器），没法直接单测，
 * 故照 `feedback-button.test.ts` 的惯例读源码字符串钉住接线。
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOUND_IDS } from '@rich4/assets-pipeline';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const audio = readFileSync(new URL('../../assets-pipeline/src/audio.ts', import.meta.url), 'utf8');

/** 抠出 `playSoundFor` 的函数体（到「电脑玩家」那一节为止） */
const body = (() => {
  const start = main.indexOf('function playSoundFor');
  const end = main.indexOf('//  电脑玩家', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return main.slice(start, end);
})();

describe('★ 買地／買設施成功的音效 —— 49（Effect.mkf）', () => {
  it('★ `SOUND_IDS.BUY_PROPERTY` = 49，且与邻居 `GOD_MANIFEST` = 50 不同', () => {
    expect(SOUND_IDS.BUY_PROPERTY).toBe(49);
    expect(SOUND_IDS.BUY_PROPERTY).not.toBe(SOUND_IDS.GOD_MANIFEST);
  });

  it('★ `audio.ts` 里确实写着 `BUY_PROPERTY: 49`（不是注释里的口头约定）', () => {
    expect(audio).toContain('BUY_PROPERTY: 49');
    // 两个 @source VA 与表换算都留在注释里，方便日后复核
    expect(audio).toContain('0x0041a0f1');
    expect(audio).toContain('0x0041a939');
    expect(audio).toContain('0x4823d2');
  });

  it('★ `playSoundFor` 里接了 49：判据是 `buyLand` / `buyFacility` 且归属真的变了', () => {
    expect(body).toContain('SOUND_IDS.BUY_PROPERTY');
    expect(body).toContain("before.pending?.kind === 'buyLand'");
    expect(body).toContain("before.pending?.kind === 'buyFacility'");
    // 两列归属字段都要比对：地块看 landOwner、設施看 facilityOwner
    expect(body).toContain('after.landOwner[id]');
    expect(body).toContain('after.facilityOwner[id]');
    // 归属是「变成当前玩家 + 1」才算成功（0 = 无人）
    expect(body).toContain('after.currentPlayer + 1');
    // ★ 衰神／死神拦下时归属不变 ⇒ 这条 `!==` 是「不响」的关键半边
    expect(body).toContain('before.landOwner[id] !== after.currentPlayer + 1');
    expect(body).toContain('before.facilityOwner[id] !== after.currentPlayer + 1');
  });

  it('★ 前两条 `sound.play`（破产 / 娃娃）原样保留，49 排在它们之后', () => {
    const bankrupt = body.indexOf('SOUND_IDS.BANKRUPT');
    const doll = body.indexOf('SOUND_IDS.DOLL');
    const buy = body.indexOf('SOUND_IDS.BUY_PROPERTY');
    for (const [name, i] of [['BANKRUPT', bankrupt], ['DOLL', doll], ['BUY_PROPERTY', buy]] as const) {
      expect(i, `${name} 不在 playSoundFor 里`).toBeGreaterThan(-1);
    }
    expect(buy).toBeGreaterThan(doll);
  });

  it('★ 落在銀行**不**放 Effect.mkf 音效：`0x0043674d push 4` 是 `call 0x4549cf`（MIDI05）的参数', () => {
    // 那一句的配乐在 `syncLoanUi`（`midi05.mid`）—— 只在真人进貸款屏时放
    expect(body).not.toContain('SOUND_IDS.BANK)');
    expect((SOUND_IDS as Record<string, number>)['BANK']).toBeUndefined();
  });
});
