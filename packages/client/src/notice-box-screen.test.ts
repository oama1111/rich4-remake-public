/*
 * 付费类落点的棕色訊息框（issue #18）—— 文案、时长、跳过、触发
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事：
 * ① 文案是**原版那一句**（格式串来自 `@rich4/data` 的 `messages.ts`，不是另写的），
 *    参数顺序就是 `sprintf` 的顺序；
 * ② 时长 = `0x5dc` = 1500 ms（@source 0x00419d50 / 0x0041aeaa）；
 * ③ 三个出口（左抬 / 右抬 / 任意键）都能提前关掉（@source `fcn_004528b9` 的
 *    `PeekMessage` 认 `0x202` / `0x205` / `0x101`）；
 * ④ 触发只看 `lastNotice` 的**引用**（core 每弹一次新建一个对象）。
 */
import { describe, expect, it } from 'vitest';
import { RENT } from '@rich4/data';
import { makeGameState, makePlayer, type GameState } from '@rich4/core';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv, UiKeyEvent } from './ui-screen.ts';
import {
  NOTICE_HOLD_MS,
  NOTICE_TEXT,
  noticeBoxScreen,
  noticeBoxScreenState,
  noticePlaybackStart,
  noticePlaybackTick,
  noticeText,
  noticeUi,
  resetNoticeBoxScreen,
} from './notice-box-screen.ts';

// ============================================================
//  文案
// ============================================================

describe('文案：键 → 原版那一句', () => {
  it('★ 时长 = `0x5dc` = 1500 ms @source 0x00419d50', () => {
    expect(NOTICE_HOLD_MS).toBe(0x5dc);
    expect(NOTICE_HOLD_MS).toBe(1500);
  });

  it('★★ 四个键都直接引用 `messages.ts` 的格式串（不另写中文）', () => {
    expect(NOTICE_TEXT['rent.payOneOwner']).toBe(RENT.payOneOwner.text);
    expect(NOTICE_TEXT['rent.payTwoOwners']).toBe(RENT.payTwoOwners.text);
    expect(NOTICE_TEXT['rent.payChairman']).toBe(RENT.payChairman.text);
    expect(NOTICE_TEXT['rent.payBoss']).toBe(RENT.payBoss.text);
  });

  it('★★ 无同盟：地名 / 地主 / 金额 / 費名 按顺序填', () => {
    expect(noticeText({ key: 'rent.payOneOwner', args: ['測試地', '沙隆巴斯', 1200, '過路費'] })).toBe(
      '測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費',
    );
  });

  it('★★ 有同盟：多一个同盟名，`%d` 落在第四个位置', () => {
    expect(
      noticeText({ key: 'rent.payTwoOwners', args: ['測試地', '沙隆巴斯', '忍太郎', 1700, '過路費'] }),
    ).toBe('測試地\n\n屬沙隆巴斯與忍太郎\n\n請付1700元過路費');
  });

  it('★★ 企業：董事長 / 幫主两句', () => {
    expect(noticeText({ key: 'rent.payChairman', args: ['測試公司', '錢夫人', 3000, '修車費'] })).toBe(
      '測試公司\n\n董事長錢夫人\n\n請付3000元修車費',
    );
    expect(noticeText({ key: 'rent.payBoss', args: ['測試公司', '錢夫人', 3000, '過路費'] })).toBe(
      '測試公司\n\n幫主錢夫人\n\n請付3000元過路費',
    );
  });

  it('参数不够时多余的占位符留空（`formatOriginal` 的口径），不印 undefined', () => {
    expect(noticeText({ key: 'rent.payOneOwner', args: ['測試地'] })).toBe('測試地\n\n此地屬\n\n請付元');
  });

  it('★ 交给 `dialog.ts` 的是一扇**没有标题、没有按钮**的框', () => {
    expect(noticeUi('甲\n\n乙')).toEqual({ title: '', detail: '甲\n\n乙', choices: [] });
  });
});

// ============================================================
//  演出状态机
// ============================================================

describe('演出：到点自己关', () => {
  it('1499 ms 还在、1500 ms 关掉', () => {
    const p = noticePlaybackStart('測試地', 0);
    expect(noticePlaybackTick(p, NOTICE_HOLD_MS - 1)).not.toBeNull();
    expect(noticePlaybackTick(p, NOTICE_HOLD_MS)).toBeNull();
  });

  it('起播记的是**起播时刻**，不是 0', () => {
    const p = noticePlaybackStart('測試地', 1000);
    expect(noticePlaybackTick(p, 1000 + NOTICE_HOLD_MS - 1)).not.toBeNull();
    expect(noticePlaybackTick(p, 1000 + NOTICE_HOLD_MS)).toBeNull();
  });
});

// ============================================================
//  触发（真 event 钩子）与三个跳过出口
// ============================================================

/** 最小 `UiScreenEnv` —— 只填本屏读得到的几项 */
function fakeEnv(state: GameState, now = 0, logs: string[] = []): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [], facilities: [] },
    map: { nodes: [], lands: [] } as never,
    now,
    stage: null as never,
    sprite: () => null,
    flic: () => null,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: (m: string) => logs.push(m),
    playEffect: () => undefined,
    stopEffect: () => undefined,
  };
}

function stateWith(notice: GameState['lastNotice']): GameState {
  return makeGameState({
    players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
    lastNotice: notice,
  });
}

const ONE_OWNER = { key: 'rent.payOneOwner' as const, args: ['測試地', '沙隆巴斯', 1200, '過路費'] };

describe('★ event 钩子：`lastNotice` 换了对象就起播', () => {
  it('从 null → 有 → 起播，画的是那一句', () => {
    resetNoticeBoxScreen();
    const before = stateWith(null);
    const after = stateWith({ ...ONE_OWNER });
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(true);
    expect(noticeBoxScreenState().playback).toEqual({
      text: '測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費',
      at: 7,
    });
    resetNoticeBoxScreen();
  });

  it('★★ **引用没变就不起播**（没弹框的 action 一路 `{...state}` 带过来）', () => {
    resetNoticeBoxScreen();
    const before = stateWith({ ...ONE_OWNER });
    // 同一个引用（`reduce` 没改这个字段时的样子）
    const after = { ...before, turnCount: before.turnCount + 1 };
    expect(after.lastNotice).toBe(before.lastNotice);
    noticeBoxScreen.event!(before, after, fakeEnv(after));
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });

  it('`null` 一路到 `null` 不起播', () => {
    resetNoticeBoxScreen();
    const before = stateWith(null);
    const after = stateWith(null);
    noticeBoxScreen.event!(before, after, fakeEnv(after));
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });

  it('正在播时不起新的（上一段没播完就丢掉新的一段）', () => {
    resetNoticeBoxScreen();
    const before = stateWith(null);
    const first = stateWith({ ...ONE_OWNER });
    noticeBoxScreen.event!(before, first, fakeEnv(first, 0));
    const second = stateWith({ key: 'rent.payBoss', args: ['公司', '甲', 1, '過路費'] });
    noticeBoxScreen.event!(first, second, fakeEnv(second, 10));
    expect(noticeBoxScreenState().playback?.text).toBe('測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費');
    resetNoticeBoxScreen();
  });
});

describe('★ 跳过：左抬 / 右抬 / 任意键', () => {
  function playing(): GameState {
    resetNoticeBoxScreen();
    const before = stateWith(null);
    const after = stateWith({ ...ONE_OWNER });
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    expect(noticeBoxScreenState().playing).toBe(true);
    return after;
  }

  it('`up`（WM_LBUTTONUP 0x202）提前关掉', () => {
    const after = playing();
    noticeBoxScreen.up!(0, 0, fakeEnv(after, 10));
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(false);
    resetNoticeBoxScreen();
  });

  it('`contextmenu`（WM_RBUTTONUP 0x205）提前关掉', () => {
    const after = playing();
    expect(noticeBoxScreen.contextmenu).toBeTypeOf('function');
    noticeBoxScreen.contextmenu!(0, 0, fakeEnv(after, 10));
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });

  it('`key`（WM_KEYDOWN 0x101）提前关掉，并消费这一拍（返回 true）', () => {
    const after = playing();
    const key: UiKeyEvent = { vk: 0x1b, code: 'Escape', ctrl: false, shift: false, alt: false };
    expect(noticeBoxScreen.key!(key, fakeEnv(after, 10))).toBe(true);
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });

  it('没在播时三个出口都不能炸', () => {
    resetNoticeBoxScreen();
    const after = stateWith(null);
    noticeBoxScreen.up!(0, 0, fakeEnv(after, 0));
    noticeBoxScreen.contextmenu!(0, 0, fakeEnv(after, 0));
    noticeBoxScreen.key!({ vk: null, code: 'Space', ctrl: false, shift: false, alt: false }, fakeEnv(after, 0));
    expect(noticeBoxScreenState().playing).toBe(false);
  });

  it('★ tick 到点自己关，并记一行日志', () => {
    const after = playing();
    const logs: string[] = [];
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS - 1, logs));
    expect(noticeBoxScreenState().playing).toBe(true);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS, logs));
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(logs.join('\n')).toMatch(/結束/);
    resetNoticeBoxScreen();
  });
});

// ============================================================
//  绘制：走的是 `dialog.ts` 的那张皮
// ============================================================

describe('★ draw 走通用訊息框的皮', () => {
  it('取的图就是 `Data.mkf` 的 `DIALOG_SKIN_*`，画的字是那一句', async () => {
    const { DIALOG_SKIN_IMAGE, DIALOG_SKIN_RESOURCE } = await import('./gameui.ts');
    const { LAYOUT } = await import('./stage.ts');
    const asked: string[] = [];
    const drawn: string[] = [];
    const translated: { x: number; y: number }[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      translate: (x: number, y: number) => translated.push({ x, y }),
      drawImage: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      fillText: (t: string) => drawn.push(t),
      strokeText: () => undefined,
      measureText: (s: string) => ({ width: s.length * 14 }) as TextMetrics,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const env: UiScreenEnv = {
      ...fakeEnv(stateWith({ ...ONE_OWNER }), 0),
      stage: ctx,
      sprite: (archive: string, resource: number, index: number) => {
        asked.push(`${archive}:${resource}:${index}`);
        return { bitmap: {} as never, width: 1, height: 1, anchorX: 0, anchorY: 0 } satisfies Sprite;
      },
    };

    resetNoticeBoxScreen();
    const before = stateWith(null);
    const after = stateWith({ ...ONE_OWNER });
    noticeBoxScreen.event!(before, after, env);
    noticeBoxScreen.draw(env);

    expect(asked[0]).toBe(`Data.mkf:${DIALOG_SKIN_RESOURCE}:${DIALOG_SKIN_IMAGE}`);
    // ★ 舞台是整块 640×480，而 `drawDialog` 排的是棋盘区坐标 —— 必须先平移
    //   （不平移框会落到屏幕 y = −1 上）
    expect(translated).toEqual([{ x: LAYOUT.board.x, y: LAYOUT.board.y }]);
    // 原版那一段是 `sprintf` 一句带 `\n\n` 的串，`dialog.ts` 自己按 `\n` 折行
    expect(drawn).toContain('測試地');
    expect(drawn).toContain('此地屬沙隆巴斯');
    expect(drawn).toContain('請付1200元過路費');
    // ★ 没有标题、没有按钮的字
    expect(drawn).not.toContain('確定');
    resetNoticeBoxScreen();
  });
});
