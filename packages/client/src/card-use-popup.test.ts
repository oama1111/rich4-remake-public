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
import { readFileSync } from 'node:fs';
import { CARDS } from '@rich4/data';
import { makeGameState, makePlayer, reduce, type GameState } from '@rich4/core';

import {
  CARD_HOLD_MS,
  CARD_REVEAL_SOUND,
  CARD_USE_FORMAT,
  cardUsePopupActive,
  cardUseView,
  cardView,
  eventBoxPlan,
  eventBoxPlaybackSkip,
  eventBoxPlaybackStart,
  eventBoxPlaybackTick,
  eventBoxScreen,
  eventBoxScreenState,
  resetEventBoxScreen,
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
    expect(body).toContain("if (action.type === 'useCard') pendingCardFlight = { before, action };");
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
