/*
 * 用卡那一次「亮牌」（`fcn_00441f73(卡号, "使用%s")`）—— 第十二份試玩回報回歸
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回报（`wt12/20260923-015242569-manual-Charles.json`）：「莫名其妙被冬眠5天」。
 *
 * 重放轨迹第 47 条：`{"type":"useCard","cardId":15,"target":{"kind":"none"}}` —— **P3（电脑，
 * 角色 0）用了冬眠卡**，P1（金貝貝）与 P2（沙隆巴斯，回报人）`sleeping 0 → 5`；P4 在醫院
 * （`dword [+0x32] != 0`）被跳过。**规则与原版一致**（`cards.md` §卡 15 逐条、通道 2 21/21）。
 *
 * 缺的是**演出**：原版不分人机，卡片函数**之前**先亮牌 1500 ms ——
 * ```asm
 * ; 电脑 0x00441d00 起
 * 00441dc8  mov ecx, [eax*8 + 0x47fdea]    ; 卡名
 * 00441dd0  push 0x465305                  ; "使用%s"
 * 00441dda  call 0x457110                  ; sprintf
 * 00441def  call 0x441f73                  ; ★ 亮牌：对话框皮 + 卡面 + 「使用冬眠卡」+ 音效 62 + 等 1500 ms
 * 00441e00  call [eax*4 + 0x475d5c]        ; 然后才是卡片函数（冬眠卡 0x4440ea：台词 → 施加）
 * ; 真人 0x00441ca6 / 0x00441cb0 / 0x00441cbc → 0x00441cc6 同形
 * ```
 * 本引擎先前只有「抽到卡」那一路接了 `fcn_00441f73`；用卡那一路只落一条日志
 * （`main.ts` 的 `applyCardPick`）⇒ 电脑用冬眠卡时玩家什么都看不见，
 * 只在自己回合开始时弹「冬眠中」—— 这就是「莫名其妙」。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CARDS } from '@rich4/data';
import { makeGameState, makePlayer, reduce, type GameState } from '@rich4/core';

import {
  CARD_HOLD_MS,
  CARD_REVEAL_SOUND,
  CARD_USE_FORMAT,
  cardUsePopupActive,
  cardUseView,
  cardView,
  dropOwnCardUse,
  eventBoxPlan,
  eventBoxPlaybackSkip,
  eventBoxPlaybackStart,
  eventBoxPlaybackTick,
  eventBoxScreen,
  eventBoxScreenState,
  resetEventBoxScreen,
  startOwnCardUsePopup,
  startRemoteCardUsePopup,
} from './event-box-screen.ts';
import type { LoadedFlic } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

function fakeEnv(state: GameState, now = 0, sounds: number[] = [], flic: LoadedFlic | null = null): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [{ id: 61, name: '合肥' } as never], facilities: [] },
    map: { nodes: [], lands: [] } as never,
    now,
    stage: null as never,
    sprite: () => null,
    flic: () => flic,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: () => undefined,
    playEffect: (id: number) => {
      sounds.push(id);
    },
    stopEffect: () => undefined,
  };
}

const texts = () =>
  eventBoxScreenState()
    .playback!.plan.items.filter((i) => i.kind === 'text')
    .map((i) => (i as { text: string }).text);

describe('★ 用卡亮牌的 view / plan @source fcn_00441f73 + 串 0x465305', () => {
  it('★★ 文字 = 「使用冬眠卡」（`sprintf("使用%s", 卡名表[15])`）', () => {
    expect(CARD_USE_FORMAT).toBe('使用%s');
    expect(cardUseView(15).cardName).toBe('使用冬眠卡');
    expect(CARDS.find((c) => c.id === 15)?.name).toBe('冬眠卡');
  });

  it('★★ 没有 0x218 那段 FLIC（那是卡片格 0x0041b32b 自己播的）⇒ 直接进亮牌，停 1500 ms、可跳过', () => {
    const plan = eventBoxPlan(cardUseView(15));
    expect(plan.kind).toBe('card');
    expect(plan.flic).toBeNull();
    expect(plan.holdMs).toBe(CARD_HOLD_MS);
    expect(CARD_HOLD_MS).toBe(1500);
    const p = eventBoxPlaybackStart(plan, 0);
    expect(p.phase).toBe('show');
    expect(eventBoxPlaybackTick(p, 1499, null)).not.toBeNull();
    expect(eventBoxPlaybackTick(p, 1500, null)).toBeNull();
    // `fcn_004528b9(0x5dc)` 认 0x202/0x205/0x101 ⇒ 一点就收
    expect(eventBoxPlaybackSkip(p, 10)).toBeNull();
  });

  it('★ 卡面 / 对话框皮与「抽到卡」同一支（只差文字与 FLIC）', () => {
    const use = eventBoxPlan(cardUseView(15)).items.filter((i) => i.kind === 'blit');
    const got = eventBoxPlan(cardView(15)).items.filter((i) => i.kind === 'blit');
    expect(use).toEqual(got);
    expect(eventBoxPlan(cardView(15)).flic).not.toBeNull();
  });

  it('★ 亮牌音 = Effect.mkf 62（`0x00442097 push 0x482402` → 音效表第 29 项首 dword）', () => {
    expect(CARD_REVEAL_SOUND).toBe(62);
  });
});

describe('★ event 钩子：`lastCardPlay` 换了 ⇒ 亮牌（不分人机）', () => {
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));

  it('★★ 电脑用冬眠卡（回报现场）⇒ 起播「使用冬眠卡」、响 62、台上算「用卡亮牌」', () => {
    resetEventBoxScreen();
    const before = makeGameState({ players, currentPlayer: 2, lastCardPlay: null });
    const after = { ...before, lastCardPlay: { player: 2, cardId: 15 } };
    const sounds: number[] = [];
    eventBoxScreen.event!(before, after, fakeEnv(after, 0, sounds));
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreenState().playback!.plan.id).toBe(15);
    expect(texts()).toEqual(['使用冬眠卡']);
    expect(sounds).toEqual([62]);
    expect(cardUsePopupActive()).toBe(true);
    // 1500 ms 到点收屏
    eventBoxScreen.tick!(fakeEnv(after, 1500, sounds));
    expect(eventBoxScreenState().playing).toBe(false);
    expect(cardUsePopupActive()).toBe(false);
  });

  it('★ 同一次用卡（引用没变）⇒ 不重复亮牌', () => {
    resetEventBoxScreen();
    const play = { player: 2, cardId: 15 };
    const s = makeGameState({ players, lastCardPlay: play });
    eventBoxScreen.event!(s, { ...s, cash: 1 } as never, fakeEnv(s));
    expect(eventBoxScreenState().playing).toBe(false);
  });

  it('★ 「抽到卡」那一路不算用卡亮牌：先播 FLIC，进亮牌那一拍才响 62', () => {
    resetEventBoxScreen();
    const before = makeGameState({ players: players.map((p) => ({ ...p, cards: [] })) });
    const after = { ...before, players: before.players.map((p, i) => (i === 0 ? { ...p, cards: [12] } : p)) };
    const sounds: number[] = [];
    eventBoxScreen.event!(before, after, fakeEnv(after, 0, sounds));
    expect(eventBoxScreenState().playback!.phase).toBe('flic');
    expect(cardUsePopupActive()).toBe(false);
    expect(sounds).toEqual([]);
    // FLIC 取不到时走兜底时长（CARD_FLIC_FALLBACK_MS = 1200）后进亮牌
    eventBoxScreen.tick!(fakeEnv(after, 1200, sounds));
    expect(eventBoxScreenState().playback!.phase).toBe('show');
    expect(sounds).toEqual([62]);
    resetEventBoxScreen();
  });

  it('★★ 真 reduce：电脑出冬眠卡 ⇒ core 写新的 `lastCardPlay` ⇒ 亮牌（端到端）', () => {
    resetEventBoxScreen();
    const s0 = makeGameState({
      players: players.map((p, i) => ({ ...p, cards: i === 2 ? [15] : [], xpos: 100, whoPlays: i === 2 ? 2 : 1 })),
      currentPlayer: 2,
      phase: 'awaitingRoll',
      lastCardPlay: null,
    });
    const s1 = reduce(s0, { type: 'useCard', cardId: 15, target: { kind: 'none' } }, { nodes: [] });
    expect(s1.lastCardPlay).toEqual({ player: 2, cardId: 15 });
    // 除自己外都睡 5 天（规则本身没改，这里只确认现场的形状）
    expect(s1.players.map((p) => p.blocking.sleeping)).toEqual([5, 5, 0, 5]);
    eventBoxScreen.event!(s0, s1, fakeEnv(s1));
    expect(texts()).toEqual(['使用冬眠卡']);
    resetEventBoxScreen();
  });
});

describe('★ 新聞 `%s` = 地名（事件框那一屏，第十二份 #1 的另一半）', () => {
  it('★★ 新聞 21 带 `place` ⇒ 文案是「龍捲風侵襲合肥」而不是人名', () => {
    resetEventBoxScreen();
    const players = [0, 1].map((i) => makePlayer({ index: i, character: i }));
    const before = makeGameState({ players, lastEvent: null });
    const after = { ...before, lastEvent: { kind: 'news' as const, id: 21, place: { entity: 0x7d0 + 61, owner: 0 } } };
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(texts()).toContain('龍捲風侵襲合肥\n摧毀房屋一棟');
    resetEventBoxScreen();
  });
});

describe('★ main.ts 的接线：亮牌在卡片函数**之前**、阻塞（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★ 卡片飞行挂起，等亮牌收屏才起（`tickPendingCardFlight`）', () => {
    const at = src.indexOf('function startActionFx(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    // ★ 第 24 份：挂起时顺带记下「飞完那一声」（轉向卡 56，`cardLandSfx`）
    expect(body).toContain("if (action.type === 'useCard') pendingCardFlight = { before, action, landSfx: cardLandSfx(action.cardId, before, state) };");
    expect(body).not.toContain('startCardFlight(before, action)');
    expect(src).toContain('function tickPendingCardFlight(): void {');
    expect(src).toContain('if (screen === \'game\') tickPendingCardFlight();');
  });

  it('★ 卡片引出的棋盘影片 / 建屋片等亮牌收屏；挂起的飞行也算「台上还忙」', () => {
    expect(src).toContain('|| cardUsePopupActive()) {');
    const build = src.slice(src.indexOf('function tickBuildFx('), src.indexOf('function tickBuildFx(') + 2000);
    expect(build).toContain('if (cardUsePopupActive()) {');
    expect(src).toContain('objectFlight: objectFlight !== null || pendingCardFlight !== null,');
  });
});

/*
 * ★★ D-CARD-USE-1 第 3 条（需求方 2026-09-23 拍板「照原版次序」）：
 *   真人用卡 = 卡片欄选定 → **亮牌** → 卡片函数（里头才选目标）→ 生效；
 *   目标取消 ⇒ 卡片函数返回 0 ⇒ 失败音 3 + 卡片欄重开（卡不消耗），再选一张再亮一次。
 */
const ROOT = process.env.RICH4_WORKSPACE ?? '';
const EXE = `${ROOT}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;
/** VA → 文件偏移（与 `tools/disasm.py` 同一条换算）*/
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}
/** `call rel32` / `jcc rel32` 的落点 */
function rel32Target(va: number, len: number, bytes: number[]): number {
  const b = bytes.slice(len - 4, len);
  const rel = (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) | 0;
  return va + len + rel;
}

describe('★ 真人用卡的次序 @source `_rich4_ui_use_card_entry`（回 exe 钉字节）', () => {
  runExe('★★ 卡片欄只有「取消」（卡号 0）绕过亮牌：`0x441c98 test ebx,ebx / je 0x441ce1`', () => {
    const b = exeBytes(0x441c98, 4);
    expect(b.slice(0, 2)).toEqual([0x85, 0xdb]); // test ebx, ebx
    expect(b[2]).toBe(0x74); // je rel8
    expect(0x441c9c + b[3]!).toBe(0x441ce1);
  });

  runExe('★★ 亮牌 `0x441cbc call 0x441f73` 在卡片函数 `0x441cc6 call [eax*4+0x475d5c]` 之前', () => {
    const popup = exeBytes(0x441cbc, 5);
    expect(popup[0]).toBe(0xe8);
    expect(rel32Target(0x441cbc, 5, popup)).toBe(0x441f73);
    expect(exeBytes(0x441cc6, 7)).toEqual([0xff, 0x14, 0x85, 0x5c, 0x5d, 0x47, 0x00]);
    expect(0x441cbc).toBeLessThan(0x441cc6);
  });

  runExe('★★ 卡片函数返回 0 ⇒ 失败音 `0x48233a`（= 3）+ `je 0x441c22` 回到卡片欄（循环体里又会亮牌）', () => {
    expect(exeBytes(0x441cd4, 5)).toEqual([0x68, 0x3a, 0x23, 0x48, 0x00]); // push 0x48233a
    const loop = exeBytes(0x441ce1, 8);
    expect(loop.slice(0, 2)).toEqual([0x85, 0xf6]); // test esi, esi
    expect(loop.slice(2, 4)).toEqual([0x0f, 0x84]); // je rel32
    expect(rel32Target(0x441ce1, 8, loop)).toBe(0x441c22);
    // 亮牌在循环体内（0x441c22 ≤ 0x441cbc < 0x441ce1）
    expect(0x441c22).toBeLessThan(0x441cbc);
  });

  runExe('★ 选目标在卡片函数**里**：均貧卡 `0x4421cd call 0x446ae8`，取消（0）⇒ `je 0x443069`（`mov eax, ebx` = 0）', () => {
    const sel = exeBytes(0x4421cd, 5);
    expect(sel[0]).toBe(0xe8);
    expect(rel32Target(0x4421cd, 5, sel)).toBe(0x446ae8);
    const bail = exeBytes(0x4421e0, 8);
    expect(bail.slice(0, 4)).toEqual([0x85, 0xdb, 0x0f, 0x84]);
    expect(rel32Target(0x4421e0, 8, bail)).toBe(0x443069);
  });
});

describe('★ 本机真人：选定即亮牌，`useCard` 落地时不亮第二遍', () => {
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));
  const base = makeGameState({ players, currentPlayer: 0, lastCardPlay: null, turnCount: 7 });

  it('★★ `startOwnCardUsePopup`：当场起播「使用均貧卡」、响 62、算「用卡亮牌」（挡住后续）', () => {
    resetEventBoxScreen();
    const sounds: number[] = [];
    startOwnCardUsePopup(2, 0, 7, fakeEnv(base, 0, sounds));
    expect(texts()).toEqual(['使用均貧卡']);
    expect(sounds).toEqual([62]);
    expect(cardUsePopupActive()).toBe(true);
    eventBoxScreen.tick!(fakeEnv(base, 1500, sounds));
    expect(cardUsePopupActive()).toBe(false);
    resetEventBoxScreen();
  });

  it('★★ 之后同一人、同一张、同一回合的 `lastCardPlay` ⇒ 不再亮（本机已亮过）；再下一次照亮', () => {
    resetEventBoxScreen();
    const sounds: number[] = [];
    startOwnCardUsePopup(2, 0, 7, fakeEnv(base, 0, sounds));
    eventBoxScreen.tick!(fakeEnv(base, 1500, sounds));
    const after = { ...base, lastCardPlay: { player: 0, cardId: 2 } };
    eventBoxScreen.event!(base, after, fakeEnv(after, 3000, sounds));
    expect(eventBoxScreenState().playing).toBe(false);
    expect(sounds).toEqual([62]);
    // 「已亮过」只抵一次：下一次用卡（比如电脑）照常亮
    const after2 = { ...after, currentPlayer: 1, lastCardPlay: { player: 1, cardId: 15 } };
    eventBoxScreen.event!(after, after2, fakeEnv(after2, 4000, sounds));
    expect(texts()).toEqual(['使用冬眠卡']);
    resetEventBoxScreen();
  });

  it('★ 联机旁观端（没有本机亮牌）⇒ `useCard` 到达时亮牌', () => {
    resetEventBoxScreen();
    const after = { ...base, lastCardPlay: { player: 0, cardId: 2 } };
    eventBoxScreen.event!(base, after, fakeEnv(after));
    expect(texts()).toEqual(['使用均貧卡']);
    resetEventBoxScreen();
  });

  it('★ 对不上（别人 / 别的卡 / 别的回合）⇒ 照亮；`dropOwnCardUse` 之后也照亮', () => {
    for (const play of [
      { player: 1, cardId: 2, turn: 7 },
      { player: 0, cardId: 4, turn: 7 },
      { player: 0, cardId: 2, turn: 8 },
    ]) {
      resetEventBoxScreen();
      startOwnCardUsePopup(2, 0, 7, fakeEnv(base));
      resetEventBoxScreenPlaybackOnly();
      const before = { ...base, turnCount: play.turn };
      const after = { ...before, lastCardPlay: { player: play.player, cardId: play.cardId } };
      eventBoxScreen.event!(before, after, fakeEnv(after));
      expect(eventBoxScreenState().playing).toBe(true);
    }
    resetEventBoxScreen();
    startOwnCardUsePopup(2, 0, 7, fakeEnv(base));
    resetEventBoxScreenPlaybackOnly();
    dropOwnCardUse();
    const after = { ...base, lastCardPlay: { player: 0, cardId: 2 } };
    eventBoxScreen.event!(base, after, fakeEnv(after));
    expect(texts()).toEqual(['使用均貧卡']);
    resetEventBoxScreen();
  });

  /** 只收掉台上那一段（跳过），不动「已亮过」那一格 —— 模拟亮牌播完 */
  function resetEventBoxScreenPlaybackOnly(): void {
    eventBoxScreen.tick!(fakeEnv(base, 1e9));
    expect(eventBoxScreenState().playing).toBe(false);
  }
});

describe('★ main.ts 的接线：亮牌在选目标**之前**（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const bodyOf = (sig: string): string => {
    const at = src.indexOf(sig);
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('\n}\n', at));
  };

  it('★★ 卡片欄选定 ⇒ 当场亮牌，只记下待走的那一张（不预演、不开拾取、不派 action）', () => {
    const body = bodyOf('function applyCardPick(cardId: number): void {');
    expect(body).toContain('startOwnCardUsePopup(cardId, state.currentPlayer, state.turnCount, uiEnv());');
    expect(body).toContain('pendingCardRoute = {');
    expect(body).not.toContain('routeCardPick(');
    expect(body).not.toContain('dispatch(');
    expect(body).not.toContain('startCardPick(');
  });

  it('★★ 亮牌收屏之后才走卡片函数那一段（`routeCardUse`：预演 / 选目标 / 派 `useCard`）', () => {
    const tick = bodyOf('function tickPendingCardRoute(): void {');
    expect(tick).toContain('if (cardUsePopupActive()) {');
    expect(tick).toContain('routeCardUse(p.cardId);');
    expect(src).toContain("if (screen === 'game') tickPendingCardRoute();");
    const route = bodyOf('function routeCardUse(cardId: number): void {');
    expect(route).toContain('routeCardPick(state, topo, cardId)');
    expect(route).toContain('startCardPick(cardId, route.cls, route.param);');
  });

  it('★★ 没用成（返回 0）= 失败音 3 + 卡片欄重开 + 忘掉「已亮过」', () => {
    const failed = bodyOf('function cardUseFailed(): void {');
    expect(failed).toContain('dropOwnCardUse();');
    expect(failed).toContain("sound.play('Effect.mkf', SOUND_CARD_FAILED);");
    expect(failed).toContain("openInventory('cards');");
  });

  it('★★ 各条「目标取消」都走 `cardUseFailed`：棋盘拾取右键 / 搶奪卡选牌窗 / 選股 / 改建卡選類別', () => {
    const cancel = bodyOf('function applyCancelLayer(layer: CancelLayer): boolean {');
    expect(cancel).toContain("if (source.kind === 'card') cardUseFailed();");
    expect(src).toContain('if (pick === null) {\n              cardUseFailed();\n              return;\n            }');
    expect(bodyOf('function cancelStockPick(playSound = true): void {')).toContain('cardUseFailed();');
    const route = bodyOf('function routeCardUse(cardId: number): void {');
    expect(route).toContain('if (type === null) {\n        cardUseFailed();');
  });

  it('★ 卡片欄只认左键抬手（右键取消后重开的卡片欄不被紧跟的右键抬手关掉）', () => {
    expect(src).toContain("if (screen === 'inventory') {\n      if (e.button !== 0) return;\n      // ★ 没按中任何一格");
  });
});

// ============================================================
//  ★ gap-audit #7（协议 v8）：联机旁观端跟着行动方的卡片欄亮牌 / 失败
// ============================================================

describe('★ gap-audit #7：旁观端收到 `present{cardReveal}` ⇒ 与行动方同一刻亮牌，`useCard` 落地时不亮第二遍', () => {
  const players = [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i }));
  // 行动方是 1 号（别的真人），本机只是旁观
  const base = makeGameState({ players, currentPlayer: 1, lastCardPlay: null, turnCount: 7 });

  it('★★ 亮牌（「使用均貧卡」+ 音 62）；随后那条 `useCard` 不再亮', () => {
    resetEventBoxScreen();
    const sounds: number[] = [];
    startRemoteCardUsePopup(2, 1, 7, fakeEnv(base, 0, sounds));
    expect(texts()).toEqual(['使用均貧卡']);
    expect(sounds).toEqual([62]);
    expect(cardUsePopupActive()).toBe(true);
    eventBoxScreen.tick!(fakeEnv(base, 1500, sounds));
    const after = { ...base, lastCardPlay: { player: 1, cardId: 2 } };
    eventBoxScreen.event!(base, after, fakeEnv(after, 3000, sounds));
    expect(eventBoxScreenState().playing).toBe(false);
    expect(sounds).toEqual([62]);
    resetEventBoxScreen();
  });

  it('★★ 目标取消（`present{cardFailed}` ⇒ `dropOwnCardUse`）之后再用：`useCard` 到达时照亮（原版再选一张会再亮一次）', () => {
    resetEventBoxScreen();
    const sounds: number[] = [];
    startRemoteCardUsePopup(2, 1, 7, fakeEnv(base, 0, sounds));
    eventBoxScreen.tick!(fakeEnv(base, 1500, sounds));
    dropOwnCardUse();
    const after = { ...base, lastCardPlay: { player: 1, cardId: 2 } };
    eventBoxScreen.event!(base, after, fakeEnv(after, 3000, sounds));
    expect(texts()).toEqual(['使用均貧卡']);
    expect(sounds).toEqual([62, 62]);
    resetEventBoxScreen();
  });
});

describe('★ gap-audit #7：main.ts 的接线（源码钉子）—— 单机不发、联机发；旁观端按收件箱次序演', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const bodyOf = (sig: string): string => {
    const at = src.indexOf(sig);
    expect(at).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('\n}\n', at));
  };

  it('★★ `presentToTable`：单机（`net === null`）什么都不做；联机只在轮到本机座位时发', () => {
    const body = bodyOf('function presentToTable(cue: PresentCue): void {');
    expect(body).toContain('if (client === null || client.seat === null || actingSeat(state) !== client.seat) return;');
    expect(body).toContain('client.present(cue);');
  });

  it('★★ 行动方：卡片欄选定 ⇒ `cardReveal`；没用成 ⇒ `cardFailed`；道具台词 ⇒ `toolLine`；选格 / 骰面盘取消 ⇒ `toolCancel`', () => {
    expect(bodyOf('function applyCardPick(cardId: number): void {')).toContain("presentToTable({ kind: 'cardReveal', cardId });");
    expect(bodyOf('function cardUseFailed(): void {')).toContain('presentCardFailed();');
    expect(bodyOf('function presentCardFailed(): void {')).toContain("presentToTable({ kind: 'cardFailed', cardId });");
    expect(bodyOf('function routeCardUse(cardId: number): void {')).toContain('presentCardFailed();');
    expect(bodyOf('function sayOwnToolLine(toolId: number, openPicker: () => void): void {')).toContain(
      "presentToTable({ kind: 'toolLine', toolId });",
    );
    expect(bodyOf('function cancelDicePick(): void {')).toContain("presentToTable({ kind: 'toolCancel', toolId: REMOTE_DICE_TOOL });");
    expect(bodyOf('function applyCancelLayer(layer: CancelLayer): boolean {')).toContain(
      "else if (source.kind === 'tool') presentToTable({ kind: 'toolCancel', toolId: source.toolId });",
    );
  });

  it('★★ 旁观端：`onPresent` 排进收件箱；轮到它时先跟行动方收场、再过节拍闸、才演（不 reduce）', () => {
    expect(src).toContain('onPresent: ({ seat, cue }) => {\n          netInbox.push({ cue, seat });\n          pumpNetInbox();');
    const pump = bodyOf('function pumpNetInbox(delay = 0): void {');
    // 队首是别人的提示 ⇒ 跟着收场（在节拍闸之前）；过了节拍闸才演
    const follow = pump.indexOf('!isNetAction(queuedHead) && queuedHead.seat !== (net?.seat ?? null)) followPresenter();');
    expect(follow).toBeGreaterThan(-1);
    expect(follow).toBeLessThan(pump.indexOf('holdForActorWalk('));
    expect(pump.indexOf('holdForActorWalk(')).toBeLessThan(pump.indexOf('applyNetCue(item.seat, item.cue);'));
    const apply = bodyOf('function applyNetCue(seat: number, cue: PresentCue): void {');
    expect(apply).toContain('startRemoteCardUsePopup(cue.cardId, seat, state.turnCount, uiEnv());');
    expect(apply).toContain('dropOwnCardUse();');
    expect(apply).toContain("sound.play('Effect.mkf', SOUND_CARD_FAILED);");
    expect(apply).toContain('ownToolLine = { player: seat, toolId: cue.toolId, turnCount: state.turnCount };');
    expect(apply).toContain("sound.play('Effect.mkf', CANCEL_SOUND);");
    expect(apply).not.toContain('reduce(');
    expect(apply).not.toContain('dispatch(');
  });

  it('★ 静默追上 / 回前台补施加 / 积压快进：演出提示一律不演', () => {
    expect(bodyOf('function catchUpSilently(')).toContain('if (!isNetAction(item)) continue;');
    expect(bodyOf('function catchUpNetAfterHidden(): void {')).toContain('if (!isNetAction(item)) continue;');
    expect(bodyOf('function pumpNetInbox(delay = 0): void {')).toContain('if (isNetAction(item)) applyNetAction(item);');
  });
});
