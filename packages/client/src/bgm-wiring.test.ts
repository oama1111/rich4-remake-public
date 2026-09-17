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
    // shop.asm:2196 `push 6` ⇒ MIDI07
    expect(src).toContain("void playTrackFile('midi07.mid')");
    expect(src).toContain('shop.asm:2196');
    // 月結屏走 env.music（那一半在 monthly-screen.ts，已有真测试）
    expect(src).toContain('music: (file: string)');
    // 每处都带出处（便于下一处照抄）
    expect(src).toContain('new_game.asm:4009');
    expect(src).toContain('ui_bank.asm:3557');
  });

  it('★★ 屏自己的两处（魔法屋 / 樂透投注）走 `env.music`，也带出处', () => {
    const magic = readFileSync(new URL('./magic-screen.ts', import.meta.url), 'utf8');
    expect(magic).toContain("env.music?.('midi08.mid')");
    expect(magic).toContain('magic_house.asm:2269');
    const lottery = readFileSync(new URL('./lottery-screen.ts', import.meta.url), 'utf8');
    expect(lottery).toContain("env.music?.('midi07.mid')");
    expect(lottery).toContain('ui_letou.asm:2938');
    // ⚠️ 只在**投注屏**那一支点歌（開獎屏是另一处 id 8），别在离开时也点一遍
    expect(lottery).toContain("after.pending?.kind === 'lottery'");
  });

  it('★★ 拍賣 / 樂透開獎两处（也是 `env.music`，各带出处）', () => {
    const auction = readFileSync(new URL('./auction-screen.ts', import.meta.url), 'utf8');
    expect(auction).toContain("env.music?.('midi06.mid')");
    expect(auction).toContain('ui_auction.asm:3139');
    const draw = readFileSync(new URL('./lottery-draw-screen.ts', import.meta.url), 'utf8');
    expect(draw).toContain("env.music?.('midi09.mid')");
    expect(draw).toContain('ui_letou.asm:3063');
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

  it('★★ 三个小游戏（0xc/0xb/0xa）接在 `ensureRun`，且与入场 FLIC 同一道闸门', () => {
    const mini = readFileSync(new URL('./minigame-screen.ts', import.meta.url), 'utf8');
    // 逐首点名，出处带 `small_games.asm` 的行号
    expect(mini).toContain('rich4_small_games.asm:4335/4481/4638');
    expect(mini).toContain("return 'midi13.mid'");
    expect(mini).toContain("return 'midi12.mid'");
    expect(mini).toContain("return 'midi11.mid'");
    // 闸门复用（不许另写一份条件）
    expect(mini).toContain('export function minigameBgmFile');
    expect(mini).toContain('if (me !== undefined && introGateOpen(me.whoPlays, env.animation))');
  });

  it('★★ 設定屏那处（`ui_options.asm:1365`）走 `applyOptions`：音量从 0 调起就补一首', () => {
    // @source `ui_options.asm:1354-1365` —— 確定写回 cfg 之后，
    //   `[0x49715a] != 0 && ebx == 0` 就 `push [0x47e772]; call fcn_004549cf`
    //   （`[0x47e772]` = 当前曲号，由 `fcn_004549cf` 自己写进去）。
    expect(src).toContain('if (next.music > 0 && !music.playing) void playTrack(next.track)');
    expect(src).toContain('if (next.music === 0) music.stop()');
    expect(src).toContain('VA 0x004109e2');
  });
});
