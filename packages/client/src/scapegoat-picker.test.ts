/*
 * 嫁禍卡选人窗 —— 纯函数 + 答复 action（第十四份，D-008 收口）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makePlayer, type Action, type GameState } from '@rich4/core';
import {
  SCAPEGOAT_CELL_HEIGHT,
  SCAPEGOAT_CELL_STRIDE,
  resetScapegoatPicker,
  scapegoatCellAt,
  scapegoatFrameChunk,
  scapegoatOrigin,
  scapegoatPickerScreen,
  setScapegoatPickerGate,
} from './scapegoat-picker.ts';
import type { UiScreenEnv } from './ui-screen.ts';

describe('★ 几何（`fcn_00440e1a` / `fcn_0043ff56`）', () => {
  it('框用第 (候选数 − 2) 张；第一格 = (0xdc − x锚 + 0xc, 0x140 − y锚 + 0xc)', () => {
    expect(scapegoatFrameChunk(2)).toBe(0);
    expect(scapegoatFrameChunk(3)).toBe(1);
    expect(scapegoatOrigin({ anchorX: 130, anchorY: 48 })).toEqual({ x: 0xdc - 130 + 0xc, y: 0x140 - 48 + 0xc });
  });

  it('命中：x∈[ox, ox+80n)、y∈[oy, oy+0x48)，格号 = (x−ox)/80', () => {
    const o = { x: 100, y: 300 };
    expect(scapegoatCellAt(100, 300, o, 3)).toBe(0);
    expect(scapegoatCellAt(100 + SCAPEGOAT_CELL_STRIDE, 300, o, 3)).toBe(1);
    expect(scapegoatCellAt(100 + SCAPEGOAT_CELL_STRIDE * 3, 300, o, 3)).toBeNull();
    expect(scapegoatCellAt(100, 300 + SCAPEGOAT_CELL_HEIGHT, o, 3)).toBeNull();
    expect(scapegoatCellAt(99, 300, o, 3)).toBeNull();
  });
});

describe('★ 窗口：只在「真人、候选两位以上」时开；左键选、右键 −1', () => {
  const pendingState = (candidates: number[]): GameState => {
    const base = makeGameState({ players: [0, 1, 2, 3].map((i) => makePlayer({ index: i, character: i })) });
    return {
      ...base,
      phase: 'awaitingDecision',
      pending: {
        kind: 'scapegoat',
        candidates,
        names: candidates.map(String),
        tail: { route: { path: 'rent', landId: 1 }, payer: 0, who: 0, toll: 3000, feeName: '過路費', freeDone: true },
      },
    };
  };
  const env = (state: GameState, sent: Action[], sounds: number[]): UiScreenEnv =>
    ({
      state,
      now: 0,
      sprite: () => ({ bitmap: {} as ImageBitmap, width: 240, height: 96, anchorX: 120, anchorY: 48 }),
      dispatch: (a: Action) => sent.push(a),
      requestRender: () => undefined,
      playEffect: (id: number) => sounds.push(id),
      log: () => undefined,
    }) as unknown as UiScreenEnv;

  it('一位候选（走 YES/NO 框）/ 闸关着 ⇒ 不开', () => {
    setScapegoatPickerGate(() => true);
    expect(scapegoatPickerScreen.active(env(pendingState([2]), [], []))).toBe(false);
    setScapegoatPickerGate(() => false);
    expect(scapegoatPickerScreen.active(env(pendingState([1, 2]), [], []))).toBe(false);
    setScapegoatPickerGate(null);
  });

  it('★ 移到第二格（音效 0）→ 左键抬起（音效 1）⇒ `answerScapegoat{第二位}`；右键（音效 4）⇒ −1', () => {
    resetScapegoatPicker();
    setScapegoatPickerGate(() => true);
    const s = pendingState([1, 3]);
    const sent: Action[] = [];
    const sounds: number[] = [];
    const e = env(s, sent, sounds);
    expect(scapegoatPickerScreen.active(e)).toBe(true);
    const o = scapegoatOrigin({ anchorX: 120, anchorY: 48 });
    scapegoatPickerScreen.move!(o.x + SCAPEGOAT_CELL_STRIDE + 5, o.y + 5, e);
    scapegoatPickerScreen.up!(0, 0, e);
    expect(sent).toEqual([{ type: 'answerScapegoat', target: 3 }]);
    scapegoatPickerScreen.contextmenu!(0, 0, e);
    expect(sent.at(-1)).toEqual({ type: 'answerScapegoat', target: -1 });
    expect(sounds).toEqual([0, 1, 4]);
    setScapegoatPickerGate(null);
  });
});
