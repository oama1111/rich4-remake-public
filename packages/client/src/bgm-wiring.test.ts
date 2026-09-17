/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 按屏 BGM 的**接线点**（源码结构断言）
 *
 * ★ 为什么用源码断言：这几处都在 `main.ts` 的宿主代码里（起局 / 进银行 / …），
 *   没有可注入的 env，也没有现成的单测宿主。曲线做法是在 `uiEnv()` 里
 *   把 `music` 出口暴露给屏（那一半已有真测试：`monthly-screen.test.ts`），
 *   宿主自己那几处则用「源码里那行在不在」钉住 —— 与本仓 D-MONTHLY-5
 *   的音效断言同一手法。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('★ 按屏 BGM 的宿主接线点（原版 `fcn_004549cf(id)`）', () => {
  it('★★ 新局 / 銀行 / 月結三处都点了对应的那一首', () => {
    // new_game.asm:4009 `push 0x8001` ⇒ 掩旗标后 id 1 ⇒ MIDI02
    expect(src).toContain("void playTrackFile('midi02.mid')");
    // ui_bank.asm:3557 `push 4` ⇒ MIDI05
    expect(src).toContain("void playTrackFile('midi05.mid')");
    // 月結屏走 env.music（那一半在 monthly-screen.ts，已有真测试）
    expect(src).toContain('music: (file: string)');
    // 每处都带出处（便于下一处照抄）
    expect(src).toContain('new_game.asm:4009');
    expect(src).toContain('ui_bank.asm:3557');
  });

  it('★ 剩下的调用点仍有清单可查（不许悄悄漏掉）', () => {
    const audio = readFileSync(
      new URL('../../assets-pipeline/src/audio.ts', import.meta.url),
      'utf8',
    );
    // SCREEN_BGM 表里 22 处调用点逐处记着（含監獄/醫院那两处超表的）
    expect(audio).toContain('export const SCREEN_BGM');
    expect(audio).toContain('prison: 0xf');
    expect(audio).toContain('hospital: 0x10');
  });
});
