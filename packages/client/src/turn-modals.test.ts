/*
 * 本机模态窗跟着回合走（pt22「联机 ATM 窗关不掉」）—— 判据见 `turn-modals.ts`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 服务器那一半（「别处答掉」这条路真的存在、重放一致）在 `packages/server/src/atm-takeover-mp.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  SPECIAL_KIND,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  decideAction,
  newGame,
  parseMap,
  reduce,
  type GameState,
} from '@rich4/core';
import { staleLocalModals, type LocalModalsOpen } from './turn-modals.ts';
import { localTurn } from './soft-cursor.ts';
import { facilityPickerScreen, resetFacilityPicker, setFacilityPickerGate } from './facility-picker.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const NONE: LocalModalsOpen = {
  atm: false,
  pick: false,
  dicePick: false,
  stockPick: false,
  facilityPicker: false,
  stealPicker: false,
};
const ALL: LocalModalsOpen = { atm: true, pick: true, dicePick: true, stockPick: true, facilityPicker: true, stealPicker: true };

describe('★ `staleLocalModals`：ATM 只随本机回合里的 pending{atm} 活着；其余本机模态窗随本机回合', () => {
  it('★ 本机回合、pending{atm} 还挂着 ⇒ 什么都不收', () => {
    expect(staleLocalModals({ pendingKind: 'atm', localTurn: true }, ALL)).toEqual([]);
  });

  it('★★ pending{atm} 在别处答掉了（本机回合还在）⇒ 只收 ATM', () => {
    expect(staleLocalModals({ pendingKind: null, localTurn: true }, ALL)).toEqual(['atm']);
    // 落点銀行：ATM 答完 core 换成貸款屏（pending{bank}）—— ATM 面板也不该留着
    expect(staleLocalModals({ pendingKind: 'bank', localTurn: true }, { ...NONE, atm: true })).toEqual(['atm']);
  });

  it('★★ 回合离开本机真人（联机别的座位 / 计时託管 / 电脑）⇒ 全收', () => {
    expect(staleLocalModals({ pendingKind: 'atm', localTurn: false }, ALL)).toEqual([
      'atm',
      'pick',
      'dicePick',
      'stockPick',
      'facilityPicker',
      'stealPicker',
    ]);
    expect(staleLocalModals({ pendingKind: null, localTurn: false }, NONE)).toEqual([]);
  });
});

// ============================================================
//  联机现场：两端按同一串广播重放，逐条问「本机该不该收」
// ============================================================

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

describe('★★ 联机：0 号路过 / 落在銀行开了 ATM，1 号旁观；0 号被计时託管、AI 替他答掉', () => {
  run('★ 玩家端：託管那一拍就收 ATM；旁观端：从头到尾都不是本机回合（不开、有也收）', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP)));
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
    const bank = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.BANK)!;
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i <= 1 ? ('human' as const) : ('computer' as const) })),
      seed: 7,
      mode: 'multiplayer',
    });
    let s: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'settling',
      pending: null,
      stepsRemaining: 0,
      players: base.players.map((p, i) => ({ ...p, whoPlays: i <= 1 ? WHO_PLAYS_HUMAN : 2, nodeId: i === 0 ? bank.id : p.nodeId })),
    };
    // 两端各自的「本机 ATM 开着没有」—— 照 `syncAtmPending` 的开窗闸（本机回合 + pending{atm}）
    const ends = [
      { seat: 0, atm: false },
      { seat: 1, atm: false },
    ];
    const step = (): string[][] =>
      ends.map((e) => {
        const mine = localTurn({ state: s, localSeat: e.seat });
        if (!e.atm && mine && s.pending?.kind === 'atm') e.atm = true; // 开窗
        const stale = staleLocalModals({ pendingKind: s.pending?.kind ?? null, localTurn: mine }, { ...NONE, atm: e.atm });
        if (stale.includes('atm')) e.atm = false; // 收窗
        return stale;
      });

    s = reduce(s, { type: 'settle' }, topo);
    expect(s.pending?.kind).toBe('atm');
    expect(step()).toEqual([[], []]);
    expect(ends.map((e) => e.atm)).toEqual([true, false]); // 只有 0 号那一端开了窗

    // 回合计时 / 掉线託管（服务器 `setAi(0, HUMAN | AUTOPILOT)` 的广播）
    s = reduce(s, { type: 'setAi', player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT }, topo);
    expect(s.pending?.kind).toBe('atm');
    // ★ 回合已不在 0 号真人手里 ⇒ 0 号那一端当拍收掉 ATM；1 号从来没开
    expect(step()).toEqual([['atm'], []]);
    expect(ends.map((e) => e.atm)).toEqual([false, false]);

    // AI 替他答掉（与服务器 `decideForCurrent` 同一个函数）；之后一路都不会再开
    for (let i = 0; i < 5 && s.pending?.kind === 'atm'; i++) {
      const a = decideAction({ state: s, map });
      expect(a).not.toBeNull();
      s = reduce(s, a!, topo);
      expect(step()).toEqual([[], []]);
    }
    expect(s.pending?.kind).not.toBe('atm');
    expect(ends.map((e) => e.atm)).toEqual([false, false]);
  });
});

describe('★ 「請選擇設施類別」的待决交互那一支也过本机闸（旁观端 / 电脑不弹别人的窗）', () => {
  const env = { screen: 'game', state: { pending: { kind: 'buildFacility' } } } as unknown as UiScreenEnv;
  it('★ 闸开 ⇒ 开窗；闸关（联机旁观 / 电脑的回合）⇒ 不开', () => {
    resetFacilityPicker();
    setFacilityPickerGate(() => true);
    expect(facilityPickerScreen.active(env)).toBe(true);
    setFacilityPickerGate(() => false);
    expect(facilityPickerScreen.active(env)).toBe(false);
    setFacilityPickerGate(null);
    expect(facilityPickerScreen.active(env)).toBe(true);
  });
});
