/*
 * 付费类落点的棕色訊息框（issue #18）—— 文案、时长、跳过、触发、队列
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉五件事：
 * ① 文案是**原版那一句**（格式串来自 `@rich4/data` 的 `messages.ts`，不是另写的），
 *    参数顺序就是 `sprintf` 的顺序；
 * ② 时长 = `0x5dc` = 1500 ms（@source 0x00419d50 / 0x0041aeaa / 0x0041a56f），
 *    得点格那三扇是 `0x3e8` = 1000 ms（@source 0x0041b1be / 0x0041b258 / 0x0041b2dc）；
 * ③ 三个出口（左抬 / 右抬 / 任意键）都能提前关掉（@source `fcn_004528b9` 的
 *    `PeekMessage` 认 `0x202` / `0x205` / `0x101`）；
 * ④ 触发只看 `notices` 的**引用**（core 每弹一次新建一个数组）；
 * ⑤ 同一 action 里的几扇**排队**一扇一扇放（原版 `0x00419d50` → `0x00419f16`）；
 * ⑥ W-69：起播前还有**一道闸**（過路費閃爍还没演完就先别弹框，原版那一段在
 *    `0x00419d5a call 0x440cac` 之前）—— 见 `setNoticeStartGate`。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { FACILITY_TOLL, MESSAGE_BOX, RENT } from '@rich4/data';
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
  setNoticeStartGate,
} from './notice-box-screen.ts';

// ============================================================
//  文案
// ============================================================

describe('文案：键 → 原版那一句', () => {
  it('★ 时长 = `0x5dc` = 1500 ms @source 0x00419d50', () => {
    expect(NOTICE_HOLD_MS).toBe(0x5dc);
    expect(NOTICE_HOLD_MS).toBe(1500);
  });

  it('★★ 每个键都直接引用 `messages.ts` 的格式串（不另写中文）', () => {
    expect(NOTICE_TEXT['rent.payOneOwner']).toBe(RENT.payOneOwner.text);
    expect(NOTICE_TEXT['rent.payTwoOwners']).toBe(RENT.payTwoOwners.text);
    expect(NOTICE_TEXT['rent.payChairman']).toBe(RENT.payChairman.text);
    expect(NOTICE_TEXT['rent.payBoss']).toBe(RENT.payBoss.text);
    // ★ 免收那一路：`0x41d559` 的**九种全部**
    expect(NOTICE_TEXT['rent.freeSealed']).toBe(RENT.freeSealed.text);
    expect(NOTICE_TEXT['rent.freeAllied']).toBe(RENT.freeAllied.text);
    expect(NOTICE_TEXT['rent.freeReaper']).toBe(RENT.freeReaper.text);
    expect(NOTICE_TEXT['rent.freeHotel']).toBe(RENT.freeHotel.text);
    expect(NOTICE_TEXT['rent.freeVanished']).toBe(RENT.freeVanished.text);
    expect(NOTICE_TEXT['rent.freePrison']).toBe(RENT.freePrison.text);
    expect(NOTICE_TEXT['rent.freeHospital']).toBe(RENT.freeHospital.text);
    expect(NOTICE_TEXT['rent.freeWinterSleep']).toBe(RENT.freeWinterSleep.text);
    expect(NOTICE_TEXT['rent.freeSleepwalk']).toBe(RENT.freeSleepwalk.text);
    expect(NOTICE_TEXT['rent.reaperPays']).toBe(RENT.reaperPays.text);
    // ★ 設施那三路
    expect(NOTICE_TEXT['facility.hotel']).toBe(FACILITY_TOLL.hotel.text);
    expect(NOTICE_TEXT['facility.mall']).toBe(FACILITY_TOLL.mall.text);
    expect(NOTICE_TEXT['facility.gasStation']).toBe(RENT.payChairman.text);
    // ★ 得点 / 抽卡 / 禮物 / 寶箱 / 乞丐 / 小偷
    expect(NOTICE_TEXT['points.50']).toBe(MESSAGE_BOX.points50.text);
    expect(NOTICE_TEXT['points.30']).toBe(MESSAGE_BOX.points30.text);
    expect(NOTICE_TEXT['points.10']).toBe(MESSAGE_BOX.points10.text);
    expect(NOTICE_TEXT['points.card']).toBe(MESSAGE_BOX.got.text);
    expect(NOTICE_TEXT['object.gift']).toBe(MESSAGE_BOX.got.text);
    expect(NOTICE_TEXT['object.treasure']).toBe(MESSAGE_BOX.got500Points.text);
    expect(NOTICE_TEXT['beggar.alms']).toBe(MESSAGE_BOX.alms.text);
    expect(NOTICE_TEXT['thief.loot']).toBe(MESSAGE_BOX.thiefLoot.text);
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

  it('★★ 免收：地主名 + 費名 两句 → 「○○坐牢中／免收過路費！」（@source 0x0041d645）', () => {
    expect(noticeText({ key: 'rent.freePrison', args: ['沙隆巴斯', '過路費'] })).toBe(
      '沙隆巴斯坐牢中\n\n免收過路費！',
    );
    expect(noticeText({ key: 'rent.freeHospital', args: ['錢夫人', '過路費'] })).toBe(
      '錢夫人住院中\n\n免收過路費！',
    );
    expect(noticeText({ key: 'rent.freeHotel', args: ['忍太郎', '過路費'] })).toBe(
      '忍太郎住宿中\n\n免收過路費！',
    );
    expect(noticeText({ key: 'rent.freeVanished', args: ['烏咪', '過路費'] })).toBe(
      '烏咪消失中\n\n免收過路費！',
    );
    expect(noticeText({ key: 'rent.freeWinterSleep', args: ['阿土伯', '過路費'] })).toBe(
      '阿土伯冬眠中\n\n免收過路費！',
    );
    expect(noticeText({ key: 'rent.freeSleepwalk', args: ['阿土伯', '過路費'] })).toBe(
      '阿土伯夢遊中\n\n免收過路費！',
    );
  });

  it('★★ 單 `%s` 那两条（查封 / 死神）：只有費名，名字不出现', () => {
    // @source 0x0041d59f `push 0x463bb8` / 0x0041d5fa `push 0x463be2` —— 都只推了費名
    expect(noticeText({ key: 'rent.freeSealed', args: ['過路費'] })).toBe('房屋查封中\n\n免收過路費！');
    expect(noticeText({ key: 'rent.freeReaper', args: ['過路費'] })).toBe('死神顯靈\n\n免收過路費！');
  });

  it('★★ 同盟：地主名 + 費名（第一个 `%s` 是**地主名**，@source 0x0041d5ce）', () => {
    expect(noticeText({ key: 'rent.freeAllied', args: ['沙隆巴斯', '過路費'] })).toBe(
      '與沙隆巴斯同盟中\n\n免收過路費！',
    );
  });

  it('★★ 死神顯靈由他人賠償：`由%s賠償%s`（@source 0x00419f04）', () => {
    expect(noticeText({ key: 'rent.reaperPays', args: ['忍太郎', '過路費'] })).toBe(
      '死神顯靈\n\n由忍太郎賠償過路費',
    );
  });

  it('★★ 設施：旅館 / 購物中心 / 加油站那三句', () => {
    // @source 0x0041a46e `push 0x4639ff`：%d#1 天数、%d#2 費用
    expect(noticeText({ key: 'facility.hotel', args: [3, 2100] })).toBe('休息3天\n\n費用2100元！');
    // @source 0x0041a4c4 `push 0x463a14`：%d#1 单价、%d#2 倍数、%d#3 总额
    expect(noticeText({ key: 'facility.mall', args: [500, 4, 2000] })).toBe(
      '您的消費金額為\n\n500x4倍=2000元',
    );
    // 加油站借的是「董事長」那一句，第一个 `%s` 是常量「加油站」
    expect(noticeText({ key: 'facility.gasStation', args: ['加油站', '沙隆巴斯', 2000, '加油費'] })).toBe(
      '加油站\n\n董事長沙隆巴斯\n\n請付2000元加油費',
    );
  });

  it('★★ 得点 / 抽卡 / 禮物 / 寶箱 / 乞丐 / 小偷 六句', () => {
    expect(noticeText({ key: 'points.50', args: [] })).toBe('得點券５０點');
    expect(noticeText({ key: 'points.30', args: [] })).toBe('得點券３０點');
    expect(noticeText({ key: 'points.10', args: [] })).toBe('得點券１０點');
    expect(noticeText({ key: 'points.card', args: ['怪獸卡'] })).toBe('得到怪獸卡！');
    expect(noticeText({ key: 'object.gift', args: ['地雷'] })).toBe('得到地雷！');
    expect(noticeText({ key: 'object.treasure', args: [] })).toBe('得到５００點券！');
    expect(noticeText({ key: 'beggar.alms', args: [3000] })).toBe('施捨給乞丐3000元');
    expect(noticeText({ key: 'thief.loot', args: ['寶箱', '錢夫人'] })).toBe('小偷偷得寶箱\n\n給錢夫人！');
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

  it('★★ `holdMs` 可覆盖默认时长（得点格是 1000 ms）', () => {
    const p = noticePlaybackStart('得點券５０點', 0, 0x3e8);
    expect(p.holdMs).toBe(0x3e8);
    expect(noticePlaybackTick(p, 0x3e8 - 1)).not.toBeNull();
    expect(noticePlaybackTick(p, 0x3e8)).toBeNull();
    // 默认仍然是 1500
    expect(noticePlaybackStart('甲', 0).holdMs).toBe(NOTICE_HOLD_MS);
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

function stateWith(notices: GameState['notices']): GameState {
  return makeGameState({
    players: [makePlayer({ index: 0 }), makePlayer({ index: 1 })],
    notices,
  });
}

const ONE_OWNER = { key: 'rent.payOneOwner' as const, args: ['測試地', '沙隆巴斯', 1200, '過路費'] };
/** 一 action 两扇：租金框 + 死神框 */
const RENT_THEN_REAPER = [
  { key: 'rent.payOneOwner' as const, args: ['測試地', '沙隆巴斯', 1200, '過路費'] },
  { key: 'rent.reaperPays' as const, args: ['忍太郎', '過路費'] },
];

describe('★ event 钩子：`notices` 换了数组就起播', () => {
  it('从空 → 有 → 起播，画的是那一句', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(true);
    expect(noticeBoxScreenState().playback).toEqual({
      text: '測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費',
      at: 7,
      holdMs: NOTICE_HOLD_MS,
    });
    resetNoticeBoxScreen();
  });

  it('★★ **引用没变就不起播**（没弹框的 action 一路 `{...state}` 带过来）', () => {
    resetNoticeBoxScreen();
    const before = stateWith([{ ...ONE_OWNER }]);
    // 同一个引用（`reduce` 没改这个字段时的样子）
    const after = { ...before, turnCount: before.turnCount + 1 };
    expect(after.notices).toBe(before.notices);
    noticeBoxScreen.event!(before, after, fakeEnv(after));
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });

  it('空数组一路到空数组不起播', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([]);
    noticeBoxScreen.event!(before, after, fakeEnv(after));
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });

  it('★★★ 可证伪：正在播时**不丢**新的 —— 排到队尾，第一扇播完自动接上', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const first = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, first, fakeEnv(first, 0));
    const second = stateWith([{ key: 'rent.payBoss', args: ['公司', '甲', 1, '過路費'] }]);
    noticeBoxScreen.event!(first, second, fakeEnv(second, 10));
    // 第一扇还在播，第二扇排着（旧实现把它丢了 ⇒ 这里会是 0）
    expect(noticeBoxScreenState().playback?.text).toBe('測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費');
    expect(noticeBoxScreenState().queued).toBe(1);
    // 第一扇到点 → 立刻换成第二扇，且**从换扇那一刻**重新计时
    noticeBoxScreen.tick!(fakeEnv(second, NOTICE_HOLD_MS));
    expect(noticeBoxScreenState().playback?.text).toBe('公司\n\n幫主甲\n\n請付1元過路費');
    expect(noticeBoxScreenState().playback?.at).toBe(NOTICE_HOLD_MS);
    expect(noticeBoxScreenState().queued).toBe(0);
    resetNoticeBoxScreen();
  });

  it('★★★ 可证伪：同一 action 的两扇**按顺序**一条一条放（原版 `0x419d50` → `0x419f16`）', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith(RENT_THEN_REAPER.map((n) => ({ ...n })));
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    // 先租金
    expect(noticeBoxScreenState().playback?.text).toBe('測試地\n\n此地屬沙隆巴斯\n\n請付1200元過路費');
    expect(noticeBoxScreenState().queued).toBe(1);
    // 1500 ms 后换成死神那一扇
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS));
    expect(noticeBoxScreenState().playback?.text).toBe('死神顯靈\n\n由忍太郎賠償過路費');
    // 再 1500 ms 才关屏
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS * 2 - 1));
    expect(noticeBoxScreenState().playing).toBe(true);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS * 2));
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(noticeBoxScreenState().queued).toBe(0);
    resetNoticeBoxScreen();
  });

  it('★★★ 可证伪：第二扇的计时**从它自己起播时算**（不是跟着第一扇）', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith(RENT_THEN_REAPER.map((n) => ({ ...n })));
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    // 第一扇在第 1499 ms 时换不了
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS - 1));
    expect(noticeBoxScreenState().playback?.at).toBe(0);
    // 第 1500 ms 换扇，第二扇的 `at` = 1500
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS));
    expect(noticeBoxScreenState().playback?.at).toBe(NOTICE_HOLD_MS);
    // 若第二扇沿用第一扇的 `at=0`，这里就已经超时关屏了 ⇒ 红
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS + 1));
    expect(noticeBoxScreenState().playing).toBe(true);
    resetNoticeBoxScreen();
  });

  it('★ 得点格那三扇走 `holdMs` = 1000（不是 1500）', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ key: 'points.50' as const, args: [], holdMs: 0x3e8 }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    expect(noticeBoxScreenState().playback?.holdMs).toBe(0x3e8);
    noticeBoxScreen.tick!(fakeEnv(after, 0x3e8 - 1));
    expect(noticeBoxScreenState().playing).toBe(true);
    noticeBoxScreen.tick!(fakeEnv(after, 0x3e8));
    expect(noticeBoxScreenState().playing).toBe(false);
    resetNoticeBoxScreen();
  });
});

describe('★ 跳过：左抬 / 右抬 / 任意键', () => {
  function playing(): GameState {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
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
    const after = stateWith([]);
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
      ...fakeEnv(stateWith([{ ...ONE_OWNER }]), 0),
      stage: ctx,
      sprite: (archive: string, resource: number, index: number) => {
        asked.push(`${archive}:${resource}:${index}`);
        return { bitmap: {} as never, width: 1, height: 1, anchorX: 0, anchorY: 0 } satisfies Sprite;
      },
    };

    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
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

// ============================================================
//  ★ W-69：起播前的那道闸（過路費閃爍还没演完就先别弹框）
// ============================================================

describe('★★ W-69：`setNoticeStartGate` —— 起播前先等台上的演出', () => {
  afterEach(() => {
    setNoticeStartGate(null);
    resetNoticeBoxScreen();
  });

  it('★ 闸关着：帧进队列但**不起播**，而且本屏照样算「在接管」（否则没人来叫 tick）', () => {
    setNoticeStartGate(() => true);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(noticeBoxScreenState().queued).toBe(1);
    // ★ 关键：`active()` 必须为真，`main.ts` 才会把 `tick` 发给本屏
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(true);
  });

  it('★★ 闸**刚开**、还没起播的那一拍，本屏仍然算「在接管」（否则永远没人来起播）', () => {
    let open = false;
    setNoticeStartGate(() => !open);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(false);
    // 闸开了，但**还没 tick** —— `active()` 必须还是真，`main.ts` 才会叫 tick
    open = true;
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(true);
  });

  it('★ 闸开着：一帧都不押，照旧立刻起播', () => {
    setNoticeStartGate(() => false);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(true);
  });

  it('★★ 闸开的那一刻（tick 里）当场起播，且自己续帧', () => {
    let open = false;
    setNoticeStartGate(() => !open);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    const env = fakeEnv(after, 7);
    noticeBoxScreen.event!(before, after, env);
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(false);
    // 台下的演出演完了
    open = true;
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeBoxScreenState().playback?.text).toContain('過路費');
  });

  it('★ 两扇框排队时，闸一开只起第一扇（第二扇还排着）', () => {
    let open = false;
    setNoticeStartGate(() => !open);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith(RENT_THEN_REAPER);
    const env = fakeEnv(after, 7);
    noticeBoxScreen.event!(before, after, env);
    open = true;
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeBoxScreenState().queued).toBe(1);
  });

  it('★ 不设闸（`null`）时行为与加这个口子之前完全一致', () => {
    setNoticeStartGate(null);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(true);
  });
});
