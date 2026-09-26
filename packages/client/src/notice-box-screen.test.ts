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
import { FACILITY_TOLL, MAGIC_HOUSE_TEXT, MESSAGE_BOX, RENT } from '@rich4/data';
import { makeGameState, makePlayer, type GameState } from '@rich4/core';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv, UiKeyEvent } from './ui-screen.ts';
import { existsSync, readFileSync } from 'node:fs';
import {
  NOTICE_HOLD_MS,
  NOTICE_SHIFT_X,
  NOTICE_TEXT,
  queueLocalNotice,
  noticeBoxScreen,
  noticeBoxScreenState,
  noticeHoldsFilms,
  noticeKeyShowing,
  noticePlaybackStart,
  noticePlaybackTick,
  noticeText,
  noticeUi,
  noticeWaitingForSpeech,
  resetNoticeBoxScreen,
  setNoticeCardPopup,
  setNoticeOverlayGate,
  setNoticeSpeechGate,
  setNoticeStartGate,
} from './notice-box-screen.ts';
import { NOTICE_TIER } from './presentation-order.ts';
import { TOLL_FLASH_FULL_SCALE, TOLL_FLASH_TOTAL_MS, tollFlashLevel } from './toll-flash-fx.ts';
import { paintBrightness } from './sprite-brightness.ts';

const EXE = `${process.env.RICH4_WORKSPACE ?? ''}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;
const exeAt = (va: number, n: number): number[] => {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
};

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
  /*
   * ★★ 需求方 2026-09-24「连着一条街收过路费时地块闪烁特效怎么没了」（iPhone）：
   *   整条演出线逐拍走一遍 —— 闪的起点 = 那条 action 落地（`noticeTollLands`），
   *   闸 = 「闪还在播」（`main.ts` 的 `setNoticeStartGate` 第一位），每一拍把地块**真的**画亮 / 画暗
   *   （`sprite-brightness.ts`，不靠 WebKit 不认的 `ctx.filter`），880 ms 之后框才起。
   * @source `fcn_00451985`（16 × 30 ms + 400 ms）→ `0x00419d5a call 0x440cac`
   */
  it('★★ 连街收费逐拍：0..880 ms 地块每拍都有叠层、框不起；880 ms 那一拍框才起', () => {
    const t0 = 1000;
    let now = t0;
    setNoticeStartGate(() => tollFlashLevel(now - t0) !== null);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, now));
    const overlays: string[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      drawImage: () => overlays.push(`${now - t0}`),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;
    const bitmap = {} as CanvasImageSource;
    const surface = () => ({
      canvas: {} as CanvasImageSource,
      ctx: { drawImage: () => undefined, fillRect: () => undefined } as unknown as CanvasRenderingContext2D,
    });
    let startedAt: number | null = null;
    for (; now <= t0 + TOLL_FLASH_TOTAL_MS + 60; now += 10) {
      const level = tollFlashLevel(now - t0);
      if (level !== null && level !== 0) {
        overlays.length = 0;
        paintBrightness(ctx, bitmap, 0, 0, 16, 24, level / TOLL_FLASH_FULL_SCALE, 16, 24, surface);
        expect(overlays, `${now - t0} ms：level ${level} 却一层都没叠`).toHaveLength(1);
      }
      noticeBoxScreen.tick!(fakeEnv(after, now));
      if (startedAt === null && noticeBoxScreenState().playing) startedAt = now - t0;
    }
    expect(startedAt).toBe(TOLL_FLASH_TOTAL_MS);
  });

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

describe('★ 联机旁观：跟着行动者收场（`fastForward`）', () => {
  it('正在播的那一扇 + 排队的几扇一起收，`active()` 变假', () => {
    setNoticeStartGate(null);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith(RENT_THEN_REAPER.map((n) => ({ ...n })));
    const logs: string[] = [];
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0, logs));
    expect(noticeBoxScreenState().queued).toBe(1);
    expect(noticeBoxScreen.fastForward!(fakeEnv(after, 10, logs))).toBe(true);
    expect(noticeBoxScreenState()).toMatchObject({ playing: false, queued: 0 });
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(false);
    expect(logs).toContain('付费訊息框：跟著行動者收場（2 扇）');
    // 之后 tick 不会再起第二扇
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS));
    expect(noticeBoxScreenState().playing).toBe(false);
  });

  it('★ 还押在闸后面、没起播的那几扇也收（它们同样属于已施加的 action）', () => {
    setNoticeStartGate(() => true);
    resetNoticeBoxScreen();
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(stateWith([]), after, fakeEnv(after));
    expect(noticeBoxScreenState()).toMatchObject({ playing: false, queued: 1 });
    expect(noticeBoxScreen.fastForward!(fakeEnv(after))).toBe(true);
    expect(noticeBoxScreen.active(fakeEnv(after))).toBe(false);
    setNoticeStartGate(null);
  });

  it('没在播 ⇒ false、什么都不动', () => {
    resetNoticeBoxScreen();
    const s = stateWith([]);
    expect(noticeBoxScreen.fastForward!(fakeEnv(s))).toBe(false);
  });
});

// ============================================================
//  魔法屋（2026-09-23）：文案 + 「框在影片之前」
// ============================================================

describe('★★ 魔法屋那几扇 @source `0x431caa` / `0x004339bd`', () => {
  afterEach(() => {
    resetNoticeBoxScreen();
    setNoticeStartGate(null);
  });

  it('★ 文案：「名字\\n\\n效果名」/「名字\\n\\n得到XX卡！」/「条件\\n\\n效果」', () => {
    // `sprintf("%s\n\n", 名字)` + `strcat(效果名)`（0x00431cee / 0x00431d11）
    expect(NOTICE_TEXT['magic.effect']).toBe(MAGIC_HOUSE_TEXT.nameHead.text + '%s');
    expect(noticeText({ key: 'magic.effect', args: ['金貝貝', '存入所有現金'] })).toBe('金貝貝\n\n存入所有現金');
    expect(noticeText({ key: 'magic.gotCard', args: ['金貝貝', '天使卡'] })).toBe('金貝貝\n\n得到天使卡！');
    expect(noticeText({ key: 'magic.spin', args: ['所有女生', '存入所有現金'] })).toBe('所有女生\n\n存入所有現金');
  });

  it('★★ 「排在影片之前」的框：不看起播闸；弹着 / 排在队头时 `noticeHoldsFilms()` 为真', () => {
    setNoticeStartGate(() => true); // 有影片挂着（通用口径：框等影片）
    const before = stateWith([]);
    const after = stateWith([{ key: 'magic.effect', args: ['金貝貝', '就地拆除房屋'], beforeFilms: true }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeHoldsFilms()).toBe(true);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS));
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(noticeHoldsFilms()).toBe(false);
  });

  it('★★ `afterMs`：框收掉（到点或被点掉）之后还**空等**那么久才接下一扇（`fcn_0045285e`，点不掉）', () => {
    const before = stateWith([]);
    const after = stateWith([
      { key: 'magic.effect', args: ['金貝貝', '存入所有現金'], beforeFilms: true, afterMs: 200 },
      { key: 'magic.effect', args: ['錢夫人', '存入所有現金'], beforeFilms: true, afterMs: 200 },
    ]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS));
    // 第一扇收掉了，但还在空等：不画、不起下一扇、仍接管、仍押影片
    expect(noticeBoxScreenState()).toMatchObject({ playing: false, queued: 1 });
    expect(noticeBoxScreen.active(fakeEnv(after, NOTICE_HOLD_MS))).toBe(true);
    expect(noticeHoldsFilms()).toBe(true);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS + 199));
    expect(noticeBoxScreenState().playing).toBe(false);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS + 200));
    expect(noticeBoxScreenState()).toMatchObject({ playing: true, queued: 0 });
    // 点掉第二扇：同样要空等，空等期间再点无效
    noticeBoxScreen.up!(0, 0, fakeEnv(after, NOTICE_HOLD_MS + 300));
    expect(noticeBoxScreen.active(fakeEnv(after, NOTICE_HOLD_MS + 300))).toBe(true);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS + 500));
    expect(noticeBoxScreen.active(fakeEnv(after, NOTICE_HOLD_MS + 500))).toBe(false);
    expect(noticeHoldsFilms()).toBe(false);
  });

  it('★★ `closeSfx`（魔法屋向後轉）：框收掉那一刻放一次 56（`0x40c78c` 开头 0x0040c79a），再空等 500 ms', () => {
    const played: number[] = [];
    const env = (s: GameState, now: number): UiScreenEnv => ({ ...fakeEnv(s, now), playEffect: (id: number) => played.push(id) });
    const before = stateWith([]);
    const after = stateWith([
      { key: 'magic.effect', args: ['宮本寶藏', '向後轉'], beforeFilms: true, afterMs: 500, closeSfx: 56 },
    ]);
    noticeBoxScreen.event!(before, after, env(after, 0));
    noticeBoxScreen.tick!(env(after, NOTICE_HOLD_MS - 1));
    expect(played).toEqual([]);
    noticeBoxScreen.tick!(env(after, NOTICE_HOLD_MS));
    expect(played).toEqual([56]);
    noticeBoxScreen.tick!(env(after, NOTICE_HOLD_MS + 250));
    expect(noticeBoxScreen.active(env(after, NOTICE_HOLD_MS + 250))).toBe(true);
    noticeBoxScreen.tick!(env(after, NOTICE_HOLD_MS + 500));
    expect(noticeBoxScreen.active(env(after, NOTICE_HOLD_MS + 500))).toBe(false);
    expect(played).toEqual([56]);
  });

  it('★ 普通的框照旧等闸、也不押影片', () => {
    setNoticeStartGate(() => true);
    const before = stateWith([]);
    const after = stateWith([ONE_OWNER]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(noticeHoldsFilms()).toBe(false);
  });
});

// ============================================================
//  ★ 第十三份試玩回報 #2：回合開始被阻那几扇框排在角色台词之后
// ============================================================

describe('★★ 第十三份試玩回報 #2：「住院中／還剩 N 天」等台词说完再弹（`fcn_0040c912`）', () => {
  afterEach(() => {
    setNoticeSpeechGate(null);
    setNoticeStartGate(null);
    resetNoticeBoxScreen();
  });

  const HOSPITAL = { key: 'confinement.hospital' as const, args: ['沙隆巴斯', 2] };

  it('★ 回合開始被阻那五扇排在台词之后（`0x0040caca call 0x44ef41` → `0x0040cb98 call 0x440cac`）：`stage` 档，台词是 `beforeStage`', () => {
    for (const k of ['confinement.hotel', 'confinement.disappearing', 'confinement.prison', 'confinement.hospital', 'confinement.sleeping'] as const) {
      expect(NOTICE_TIER[k]).toBe('stage');
    }
    // 過路費 `0x00419d5a` → 付款台词 `0x0041a71e`：框在前（付款台词是 `afterStage`，档更大）
    expect(NOTICE_TIER['rent.payOneOwner']).toBe('stage');
    expect(NOTICE_TIER['facility.mall']).toBe('stage');
    // 顯靈加蓋在落点尾块（`0x0041b086`），排在付款台词之后
    expect(NOTICE_TIER['god.build']).toBe('tail');
  });

  it('★★ 台词押在账上（宿主在 `event()` 之前 `holdSpeech`）⇒ 那一拍不起；台词在说就一直押着，说完才弹', () => {
    let speaking = true; // 「我不要打針！！」（`beforeStage`）已押上账
    const asked: string[] = [];
    setNoticeSpeechGate((tier) => {
      asked.push(tier);
      return speaking;
    });
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...HOSPITAL }]);
    const env = fakeEnv(after, 7);
    noticeBoxScreen.event!(before, after, env);
    expect(noticeBoxScreenState().playing).toBe(false);
    expect(noticeBoxScreen.active(env)).toBe(true);
    expect(asked).toContain('stage');
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(false);
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(false);
    speaking = false; // 台词收了
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeBoxScreenState().playback?.text).toContain('沙隆巴斯');
  });

  it('★ 没有台词（1/2 没抽中 / 住宿、消失本来就不说）⇒ 当场就弹', () => {
    setNoticeSpeechGate(() => false);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ key: 'confinement.hotel' as const, args: ['沙隆巴斯', 2] }]);
    const env = fakeEnv(after, 7);
    noticeBoxScreen.event!(before, after, env);
    expect(noticeBoxScreenState().playing).toBe(true);
  });

  it('★★ 第十五份：台词闸管**每一扇** —— 台上有气泡时過路費框也押着（原版 `player_say` 阻塞，气泡与框不同屏）', () => {
    let speaking = true;
    setNoticeSpeechGate(() => speaking);
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 7));
    expect(noticeBoxScreenState().playing).toBe(false);
    speaking = false;
    noticeBoxScreen.tick!(fakeEnv(after, 8));
    expect(noticeBoxScreenState().playing).toBe(true);
  });

  it('★★ 第十五份：电脑用道具「使用%s」是 `lead` 档（`0x00448070` 在道具函数 `0x0044807e` 之前）', () => {
    expect(NOTICE_TIER['tool.aiUse']).toBe('lead');
  });
});

describe('★ 第十三份試玩回報 #1：`noticeKeyShowing` —— 顯靈框还在不在', () => {
  afterEach(() => {
    setNoticeStartGate(null);
    resetNoticeBoxScreen();
  });

  it('正在弹 / 排在队里都算；收掉就不算', () => {
    resetNoticeBoxScreen();
    const before = stateWith([]);
    const after = stateWith([{ ...ONE_OWNER }, { key: 'god.build' as const, args: ['天使'] }]);
    const env = fakeEnv(after, 0);
    noticeBoxScreen.event!(before, after, env);
    expect(noticeKeyShowing('god.build')).toBe(true); // 排在過路費框后面
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS));
    expect(noticeKeyShowing('god.build')).toBe(true); // 正在弹
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS * 2));
    expect(noticeKeyShowing('god.build')).toBe(false);
  });
});

// ============================================================
//  ★★ 第十四份（需求方拍板照原版）：加持框 / 过路费神明框 / 理賠框
// ============================================================

describe('★★ 第十四份：新接的几扇框', () => {
  afterEach(() => {
    setNoticeSpeechGate(null);
    setNoticeOverlayGate(null);
    resetNoticeBoxScreen();
  });

  it('文案逐字（`%s` = 神明名 / 費名，`%d` = 理賠金）', () => {
    expect(noticeText({ key: 'blessing.penaltyVoid', args: ['小財神'] })).toBe('小財神保佑\n\n免付罰金！');
    expect(noticeText({ key: 'blessing.misfortuneDouble', args: ['大衰神'] })).toBe('大衰神作祟\n\n倒霉加倍！');
    expect(noticeText({ key: 'god.tollFree', args: ['過路費'] })).toBe('大財神顯靈\n\n免付過路費！');
    expect(noticeText({ key: 'god.tollPlusHalf', args: ['過路費'] })).toBe('小窮神顯靈\n\n過路費加付50％！');
    expect(noticeText({ key: 'insurance.payout', args: [5000] })).toBe('保險期間\n\n得到理賠金\n\n5000元');
  });

  it('★ 理賠框排在台词之后（六个调用点都是台词在前、`0x44ba63` 在后）⇒ `tail` 档', () => {
    expect(NOTICE_TIER['insurance.payout']).toBe('tail');
    expect(NOTICE_TIER['blessing.penaltyVoid']).toBe('stage');
    expect(NOTICE_TIER['god.tollFree']).toBe('stage');
  });

  it('★★ 只剩一扇等台词的框 ⇒ `noticeWaitingForSpeech` 为真（宿主据此不把它算成台上在演，免得与押后的台词互等）', () => {
    let speaking = true;
    setNoticeSpeechGate(() => speaking);
    const before = stateWith([]);
    const after = stateWith([{ key: 'insurance.payout' as const, args: [5000], holdMs: 2000 }]);
    const env = fakeEnv(after, 7);
    noticeBoxScreen.event!(before, after, env);
    expect(noticeWaitingForSpeech()).toBe(true);
    speaking = false;
    expect(noticeWaitingForSpeech()).toBe(false);
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(true);
    expect(noticeBoxScreenState().playback?.text).toContain('5000元');
  });

  it('★★ 事件提示框还在 ⇒ 连「排在影片之前」的加持框也押着（施加阶段在事件框收掉之后）', () => {
    let eventBox = true;
    setNoticeOverlayGate(() => eventBox);
    const before = stateWith([]);
    const after = stateWith([{ key: 'blessing.misfortuneVoid' as const, args: ['天使'], beforeFilms: true }]);
    const env = fakeEnv(after, 7);
    noticeBoxScreen.event!(before, after, env);
    expect(noticeBoxScreenState().playing).toBe(false);
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playing).toBe(false);
    eventBox = false;
    noticeBoxScreen.tick!(fakeEnv(after, 5000));
    expect(noticeBoxScreenState().playing).toBe(true);
    // 计时从起播那一刻算，不是入队那一刻（否则一出来就过期）
    expect(noticeBoxScreenState().playback).not.toBeNull();
  });
});

describe('★★ 第十四份：亮牌那一扇（`NoticeHint.card`）交给事件提示框，收了才接下一扇', () => {
  afterEach(() => {
    setNoticeCardPopup(null);
    resetNoticeBoxScreen();
  });

  it('收費框 → 亮牌（起播交出去、等它收）→ 下一扇', () => {
    const started: [number, string][] = [];
    let popup = false;
    setNoticeCardPopup(
      (cardId, text) => {
        started.push([cardId, text]);
        popup = true;
      },
      () => popup,
    );
    const before = stateWith([]);
    const after = stateWith([
      { ...ONE_OWNER },
      { key: 'card.use' as const, args: ['免費卡'], card: 20 },
      { key: 'rent.reaperPays' as const, args: ['X', '過路費'] },
    ]);
    noticeBoxScreen.event!(before, after, fakeEnv(after, 0));
    expect(started).toEqual([]);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS)); // 收費框到点 → 亮牌起
    expect(started).toEqual([[20, '使用免費卡']]);
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS * 3));
    expect(noticeKeyShowing('rent.reaperPays')).toBe(true); // 还排着：亮牌没收
    expect(noticeBoxScreenState().playback?.text).toBe('使用免費卡');
    popup = false;
    noticeBoxScreen.tick!(fakeEnv(after, NOTICE_HOLD_MS * 3 + 1));
    expect(noticeBoxScreenState().playback?.text).toContain('死神顯靈');
  });

  it('文案：嫁禍卡亮牌 / 电脑嫁禍之后那一扇', () => {
    expect(noticeText({ key: 'card.scapegoatOn', args: ['沙隆巴斯'] })).toBe('沙隆巴斯\n\n嫁禍卡生效！');
    expect(noticeText({ key: 'card.scapegoatTo', args: ['忍太郎'] })).toBe('嫁禍給忍太郎！');
  });

  it('★ 2026-09-23：小衰神丢卡那一扇（`0x0040f148 call 0x440cac`，串 `0x4633ab`）—— 串里自己写「小衰神」、排在「別鬧了！」之后', () => {
    expect(noticeText({ key: 'god.lostCard', args: ['路障卡'] })).toBe('小衰神附身\n\n遺失路障卡！');
    // 原版次序：台词 22（`0x0040f0ac call 0x44ef41`，`beforeStage`）→ 影片 → 开场白 → 丢卡 → 框（`stage` 档）
    expect(NOTICE_TIER['god.lostCard']).toBe('stage');
    expect(NOTICE_TIER['god.gotCard']).toBe('stage');
  });

  it('★ 2026-09-23：新补的那几扇文案逐字（格式串全在 `NOTICE_BOX`，逐字节对过 exe）', () => {
    expect(noticeText({ key: 'npc.robBank', args: [30000, '約翰喬'] })).toBe('強盜搶奪銀行\n\n得款30000元\n\n給約翰喬！');
    expect(noticeText({ key: 'stock.aiBuy', args: ['約翰喬', '中國信託', 100] })).toBe('約翰喬\n\n買進中國信託100張');
    expect(noticeText({ key: 'bank.loanFrozen', args: [3] })).toBe('銀行暫停放款\n\n還剩3天！');
    expect(noticeText({ key: 'bank.reserveShortfall', args: [30000, '沙隆巴斯'] })).toBe('銀行資金準備\n\n不足30000元\n\n由經營者沙隆巴斯墊付！');
    expect(noticeText({ key: 'card.taxed', args: ['忍太郎', 20000] })).toBe('抽取忍太郎\n\n20000元稅金！');
    expect(noticeText({ key: 'company.pickBuildSite', args: ['測試公司'] })).toBe('測試公司\n\n請選擇欲加蓋地點');
    expect(noticeText({ key: 'stock.limitUpNoBuy', args: [] })).toBe('漲停無法買進！');
    expect(noticeText({ key: 'stock.limitDownNoSell', args: [] })).toBe('跌停無法賣出！');
  });
});

describe('★ 2026-09-23：時長带 bit31 的那一种 —— 整扇右移 100 @source 0x00440cef..0x00440d01', () => {
  const recorder = (): { ctx: CanvasRenderingContext2D; translated: { x: number; y: number }[] } => {
    const translated: { x: number; y: number }[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      translate: (x: number, y: number) => translated.push({ x, y }),
      drawImage: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      fillText: () => undefined,
      strokeText: () => undefined,
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    return { ctx, translated };
  };

  it('core 交出来的 `shiftRight`（貸款屏的暫停放款）⇒ 平移多 100', async () => {
    const { LAYOUT } = await import('./stage.ts');
    const { ctx, translated } = recorder();
    resetNoticeBoxScreen();
    const env: UiScreenEnv = { ...fakeEnv(stateWith([]), 0), stage: ctx };
    noticeBoxScreen.event!(stateWith([]), stateWith([{ key: 'bank.loanFrozen', args: [3], shiftRight: true }]), env);
    noticeBoxScreen.draw(env);
    expect(NOTICE_SHIFT_X).toBe(100);
    expect(translated).toEqual([{ x: LAYOUT.board.x + 100, y: LAYOUT.board.y }]);
  });

  it('客户端自己弹的那一扇（股市柜台漲停）：`queueLocalNotice` 排进队、下一拍起播、1000 ms、右移', async () => {
    const { LAYOUT } = await import('./stage.ts');
    const { ctx, translated } = recorder();
    resetNoticeBoxScreen();
    queueLocalNotice({ key: 'stock.limitUpNoBuy', args: [], holdMs: 1000, shiftRight: true });
    const env: UiScreenEnv = { ...fakeEnv(stateWith([]), 5), stage: ctx };
    expect(noticeBoxScreen.active(env)).toBe(true);
    noticeBoxScreen.tick!(env);
    expect(noticeBoxScreenState().playback).toMatchObject({ text: '漲停無法買進！', holdMs: 1000, shiftRight: true });
    noticeBoxScreen.draw(env);
    expect(translated).toEqual([{ x: LAYOUT.board.x + 100, y: LAYOUT.board.y }]);
    resetNoticeBoxScreen();
  });

  runExe('exe：`0x0042af18 push 0x800003e8` / `0x0042b04b push 0x800003e8` / `0x004351ee push 0x800005dc`', () => {
    expect(exeAt(0x0042af18, 5)).toEqual([0x68, 0xe8, 0x03, 0x00, 0x80]);
    expect(exeAt(0x0042b04b, 5)).toEqual([0x68, 0xe8, 0x03, 0x00, 0x80]);
    expect(exeAt(0x004351ee, 5)).toEqual([0x68, 0xdc, 0x05, 0x00, 0x80]);
    // 0x440cfd add dword [esp], 0x64 / 0x440d01 add dword [esp+8], 0x64
    expect(exeAt(0x00440cfd, 4)).toEqual([0x83, 0x04, 0x24, 0x64]);
    expect(exeAt(0x00440d01, 5)).toEqual([0x83, 0x44, 0x24, 0x08, 0x64]);
  });
});
