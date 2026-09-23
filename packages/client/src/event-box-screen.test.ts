/*
 * 事件提示框屏（新聞 / 命運 / 抽卡）的素材、版面与演出帧序
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编抄（VA 见 `event-box-screen.ts` 的注释），钉住：
 *   ① **新聞**：`Panel#66` 图 0 落 (0,0) + 插画 `Data[0x1b9+id]`（388×251）落 (25,44)
 *      + 标题落 (24,8) + 说明落 (24,310)，停 2400ms（可跳过）；
 *   ② **命運**：同一套，外框换图 1、插画换 `Data[0x1dd+id]`、说明落 **(24,330)**
 *      （不是 310），停 1600ms + 800ms（**两段都可跳过**）；
 *   ③ **抽卡**：先播 `Data#0x218` 的 FLIC（落 208,180；**这一段原版点不掉**，
 *      `fcn_0045144f` 的 `flags=1` ⇒ `[0x48c880]=0`），亮牌时对话框皮 + 卡名
 *      （220,129，正中）落 + 卡面 `Data[卡号+0x23a]`（**165×256**，见 `CARD_FACE_SIZE`）落 (138,200)，停 1500ms（可跳过）；
 *   ④ **触发**：`lastEvent` 变了 → 新聞/命運；否则手牌变长 → 抽卡；正在播时不起新的。
 *      ★ 例外：这条 action 新写的 `notices` 里有 `god.gotCard`（福神得卡）⇒ **不出卡面**
 *      （原版 `fcn_0040ed8f` 那一段没有卡面演出；见文件末「福神得卡」那一组）。
 *   ⑤ **可跳过性**：`fcn_004544f6`（新聞 / 命運第一段）与 `fcn_004528b9`（命運第二段 /
 *      抽卡亮牌）都认 `0x202`/`0x205`/`0x101` ⇒ 这些段都能被抬手/右键/按键推进或关屏；
 *      抽卡第一段 FLIC 是 `fcn_0045144f` 且那一处跳过闸关着 ⇒ 点不掉
 *      （2026-09-19 按 `escalations.md` E-5 订正，见文件末「★ 可跳过性」那一组）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARDS, fortuneEvent, newsEvent } from '@rich4/data';
import type { GameState, Player } from '@rich4/core';
import {
  NEWS_SHARE_AT,
  NEWS_SHARE_PITCH,
  NEWS_SHARE_PORTRAIT_DY,
  NEWS_SHARE_PORTRAIT_IMAGE,
  NEWS_SHARE_PORTRAIT_X,
  newsShareLine,
  CARD_FACE_AT,
  CARD_FACE_BASE,
  CARD_FACE_SIZE,
  CARD_FLIC_AT,
  CARD_FLIC_FALLBACK_MS,
  CARD_FLIC_RESOURCE,
  CARD_FONT_SIZE,
  CARD_HOLD_MS,
  CARD_NAME_AT,
  CARD_SKIN_AT,
  EVENT_ART_AT,
  EVENT_ART_SIZE,
  EVENT_FONT_SIZE,
  EVENT_FORTUNE_FRAME,
  EVENT_NEWS_FRAME,
  EVENT_PANEL_RESOURCE,
  FORTUNE_ART_BASE,
  FORTUNE_HOLD_MS,
  FORTUNE_SECOND_HOLD_MS,
  FORTUNE_TEXT_AT,
  NEWS_ART_BASE,
  NEWS_HOLD_MS,
  NEWS_TEXT_AT,
  NEWS_TITLE_AT,
  NEWS_TITLE_INDEX,
  NEWS_TITLES,
  cardGained,
  cardView,
  drawEventBoxScreen,
  eventBoxDescription,
  eventBoxPlan,
  eventBoxPlaybackSkip,
  eventBoxPlaybackStart,
  eventBoxPlaybackTick,
  eventBoxScreen,
  eventBoxScreenState,
  fortuneView,
  newsTitle,
  newsView,
  resetEventBoxScreen,
  type EventBoxItem,
  type EventBoxPlan,
} from './event-box-screen.ts';
import { portraitResource, type LoadedFlic, type Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  素材与常量 @source
// ============================================================

describe('用到的素材 @source fcn_0044b6df / fcn_0044db81 / fcn_00441f73', () => {
  it('★ 新聞/命運外框 = `Panel.mkf` #66：新聞图 0、命運图 1', () => {
    // @source 0x0044b6e9 / 0x0044db9b `push 0x42`
    expect(EVENT_PANEL_RESOURCE).toBe(0x42);
    expect(EVENT_PANEL_RESOURCE).toBe(66);
    // @source 0x0044b727 `add edi,0xc`（图 0）/ 0x0044dbd9 `add eax,0x18`（图 1）
    expect(EVENT_NEWS_FRAME).toBe(0);
    expect(EVENT_FORTUNE_FRAME).toBe(1);
    expect(0x0c + 12 * EVENT_NEWS_FRAME).toBe(0x0c);
    expect(0x0c + 12 * EVENT_FORTUNE_FRAME).toBe(0x18);
  });

  it('★ 插画 = 无头 RGB555 388×251、落 (25,44) @source 0x00451a5a / 0x0044b78a', () => {
    expect(EVENT_ART_SIZE).toEqual({ w: 0x184, h: 0xfb });
    expect(EVENT_ART_SIZE.w * EVENT_ART_SIZE.h * 2).toBe(194776); // Data/0441.bin 的字节数
    expect(EVENT_ART_AT).toEqual({ x: 0x19, y: 0x2c });
    expect(EVENT_ART_AT).toEqual({ x: 25, y: 44 });
  });

  it('★ 插画资源基址：新聞 `0x1b9`、命運 `0x1dd` @source 0x0044b727 / 0x0044dc32', () => {
    expect(NEWS_ART_BASE).toBe(0x1b9);
    expect(NEWS_ART_BASE).toBe(441);
    expect(FORTUNE_ART_BASE).toBe(0x1dd);
    expect(FORTUNE_ART_BASE).toBe(477);
    // 新聞 36 项用完 441..476、命運 37 项从 477 起 —— 首尾相接
    expect(NEWS_ART_BASE + 36).toBe(FORTUNE_ART_BASE);
  });

  it('★ 文字的落点与等待 @source 0x0044b7a0 / 0x0044b870 / 0x0044dd0a / 0x0044dd10', () => {
    expect(NEWS_TITLE_AT).toEqual({ x: 0x18, y: 8 });
    expect(NEWS_TEXT_AT).toEqual({ x: 0x18, y: 0x136 });
    expect(NEWS_TEXT_AT.y).toBe(310);
    // ★ 命運的说明在 330，不是新聞那个 310 @source 例 fcn_0044be16 的 `push 0x14a`
    expect(FORTUNE_TEXT_AT).toEqual({ x: 0x18, y: 0x14a });
    expect(FORTUNE_TEXT_AT.y).toBe(330);
    expect(NEWS_HOLD_MS).toBe(0x960);
    expect(NEWS_HOLD_MS).toBe(2400);
    expect(FORTUNE_HOLD_MS).toBe(0x640);
    expect(FORTUNE_HOLD_MS).toBe(1600);
    expect(FORTUNE_SECOND_HOLD_MS).toBe(0x320);
    expect(FORTUNE_SECOND_HOLD_MS).toBe(800);
  });

  it('★ 抽卡：FLIC `Data#0x218` 落 (208,180)、卡面 `卡号+0x23a` **165×256** 落 (138,200)', () => {
    expect(CARD_FLIC_RESOURCE).toBe(0x218);
    expect(CARD_FLIC_AT).toEqual({ x: 0xd0, y: 0xb4 });
    expect(CARD_FLIC_AT).toEqual({ x: 208, y: 180 });
    expect(CARD_FACE_BASE).toBe(0x23a);
    expect(CARD_FACE_BASE).toBe(570);
    // ★ W-61 订正：先前那个 176×240 是**按文件大小猜的**（两个尺寸的 ×2 都是 84480，
    //   所以字节数对得上、**行宽错了** ⇒ 解码出来每行错位、整张卡是乱码）。
    //   真值来自 exe 的图头模板 `0x441204`（`u16 w = 0x00a5`、`u16 h = 0x0100`）。
    expect(CARD_FACE_SIZE).toEqual({ w: 165, h: 256 });
    expect(CARD_FACE_SIZE).toEqual({ w: 0xa5, h: 0x100 });
    expect(CARD_FACE_SIZE.w * CARD_FACE_SIZE.h * 2).toBe(84480); // Data/0571.bin 的字节数
    // ★ 反证：旧那个猜出来的尺寸**也**能整除 84480 —— 只对字节数是判不出来的
    expect(176 * 240 * 2).toBe(84480);
    expect(CARD_FACE_SIZE.w).not.toBe(176);
    expect(CARD_FACE_AT).toEqual({ x: 0x8a, y: 0xc8 });
    expect(CARD_FACE_AT).toEqual({ x: 138, y: 200 });
    // 对话框皮与卡名同一个落点：皮走锚点 → 左上 (97,28)，名是 flag 4 正中
    expect(CARD_SKIN_AT).toEqual({ x: 0xdc, y: 0x81 });
    expect(CARD_NAME_AT).toEqual(CARD_SKIN_AT);
    expect(CARD_NAME_AT).toEqual({ x: 220, y: 129 });
    expect(CARD_HOLD_MS).toBe(0x5dc);
    expect(CARD_HOLD_MS).toBe(1500);
    expect(CARD_FONT_SIZE).toBe(0x10);
    expect(EVENT_FONT_SIZE).toBe(0x1c);
  });

  it('★ 卡面资源：30 张卡正好用完 571..600', () => {
    expect(CARD_FACE_BASE + 1).toBe(571);
    expect(CARD_FACE_BASE + CARDS.length).toBe(600);
    for (const c of CARDS) {
      expect(CARD_FACE_BASE + c.id).toBeGreaterThanOrEqual(571);
      expect(CARD_FACE_BASE + c.id).toBeLessThanOrEqual(600);
    }
  });
});

// ============================================================
//  新聞标题表 @source VA 0x475eb4 / 0x475ed8
// ============================================================

describe('★ 新聞标题 @source byte 表 0x475eb4 + 串表 0x475ed8', () => {
  it('★ 六条标题', () => {
    expect(NEWS_TITLES).toEqual([
      '無責任新聞',
      '政府公告',
      '社會新聞',
      '路況報導',
      '氣象報導',
      '財經新聞',
    ]);
  });

  it('★ 下标表 36 字节 = 9 个 dword，逐字节摊平', () => {
    expect(NEWS_TITLE_INDEX).toHaveLength(36);
    // 表原样（`rich4_news.asm:4105` 的九个 dd）
    expect(NEWS_TITLE_INDEX.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(NEWS_TITLE_INDEX[14]).toBe(2);
    expect(NEWS_TITLE_INDEX[16]).toBe(3);
    expect(NEWS_TITLE_INDEX[18]).toBe(4);
    expect(NEWS_TITLE_INDEX[22]).toBe(5);
    expect(NEWS_TITLE_INDEX[35]).toBe(5);
    // 每一项都落在六条之内
    for (const at of NEWS_TITLE_INDEX) {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(NEWS_TITLES.length);
    }
  });

  it('★ 事件号 → 标题', () => {
    expect(newsTitle(0)).toBe('無責任新聞');
    expect(newsTitle(6)).toBe('政府公告');
    expect(newsTitle(14)).toBe('社會新聞');
    expect(newsTitle(17)).toBe('路況報導');
    expect(newsTitle(18)).toBe('氣象報導');
    expect(newsTitle(23)).toBe('財經新聞');
    // 越界：没有这一条
    expect(newsTitle(99)).toBe('');
  });
});

// ============================================================
//  说明文字（纯函数）
// ============================================================

describe('★ 事件说明文字：去编号 + 代入 %d/%s（近似）', () => {
  it('★ 取不到事件号时返回空串', () => {
    expect(eventBoxDescription(undefined, 1, '')).toBe('');
  });

  it('★ 用真表：新聞与命運各取一条', () => {
    // 新聞 5「#0154外星怪獸襲擊%s\n摧毀建築一棟」：%s 代入对象名
    const news5 = newsEvent(5);
    expect(news5?.text).toContain('%s');
    expect(eventBoxDescription(news5, 1, '錢夫人')).toBe('外星怪獸襲擊錢夫人\n摧毀建築一棟');
    // 命運 12「#0197掉進水溝就醫%d天」：literal = 3
    const f12 = fortuneEvent(12);
    expect(f12?.literal).toBe(3);
    expect(eventBoxDescription(f12, 5, '')).toBe('掉進水溝就醫3天');
    // 命運 14「行人闖越馬路罰款%d元」：factor = 3000 → 3000 × 物价
    const f14 = fortuneEvent(14);
    expect(f14?.factor).toBe(3000);
    expect(eventBoxDescription(f14, 2, '')).toBe('行人闖越馬路罰款6000元');
    // 两个都取不到时留 `？`（不为难玩家看 `%d`）
    expect(eventBoxDescription({ ...f12!, literal: null, factor: null }, 1, '')).toBe(
      '掉進水溝就醫？天',
    );
    // `%s` 取不到对象时也留 `？`
    expect(eventBoxDescription(news5, 1, '')).toBe('外星怪獸襲擊？\n摧毀建築一棟');
    // ★ 2026-09-17：新聞 1/3 的 literal 补成 3（汇编 `mov ecx, 3`）⇒ 不再显示「？天」
    const news1 = newsEvent(1);
    expect(news1?.literal).toBe(3);
    expect(eventBoxDescription(news1, 1, '')).toBe('獄中囚犯延長刑期3天');
    expect(eventBoxDescription(newsEvent(3), 1, '')).toBe('住院中病患延長住院3天');
  });
});

// ============================================================
//  抽卡：从手牌差集取
// ============================================================

function player(index: number, cards: number[]): Player {
  return {
    index,
    character: index,
    cards: [...cards],
    cash: 0,
    moneyInBank: 0,
  } as unknown as Player;
}

function stateOf(players: Player[], lastEvent: GameState['lastEvent'] = null): GameState {
  return {
    players,
    currentPlayer: 0,
    priceIndex: 1,
    lastEvent,
  } as unknown as GameState;
}

describe('★ 抽卡判据：手牌差集', () => {
  it('★ 多出来的那张就是刚抽到的（push 在尾部）', () => {
    const before = stateOf([player(0, [3, 7]), player(1, [])]);
    const after = stateOf([player(0, [3, 7, 12]), player(1, [])]);
    expect(cardGained(before, after)).toEqual({ player: 0, card: 12 });
  });

  it('★ 先拿掉一张、再加一张也认得出来', () => {
    const before = stateOf([player(0, [3, 7])]);
    const after = stateOf([player(0, [7, 3, 9])]);
    expect(cardGained(before, after)).toEqual({ player: 0, card: 9 });
  });

  it('★ 没变长 → null', () => {
    const s = stateOf([player(0, [3, 7])]);
    expect(cardGained(s, stateOf([player(0, [3, 7])]))).toBeNull();
    expect(cardGained(s, stateOf([player(0, [3])]))).toBeNull();
  });

  it('★ 两个人的手牌都变长时取 `players` 序里第一个', () => {
    const before = stateOf([player(0, []), player(1, [])]);
    const after = stateOf([player(0, []), player(1, [5])]);
    expect(cardGained(before, after)).toEqual({ player: 1, card: 5 });
  });
});

// ============================================================
//  绘制计划（纯函数）
// ============================================================

/** 计划里的贴图 */
function blitsOf(p: EventBoxPlan): Extract<EventBoxItem, { kind: 'blit' }>[] {
  return p.items.filter((i): i is Extract<EventBoxItem, { kind: 'blit' }> => i.kind === 'blit');
}

/** 计划里的文字 */
function textsOf(p: EventBoxPlan): Extract<EventBoxItem, { kind: 'text' }>[] {
  return p.items.filter((i): i is Extract<EventBoxItem, { kind: 'text' }> => i.kind === 'text');
}

describe('★ 新聞那一段的绘制计划 @source 0x0044b6df', () => {
  const plan = eventBoxPlan(newsView(3, 1, '約翰喬'));

  it('★ 外框图 0 落 (0,0)（不透明）、插画 `0x1b9+3` 落 (25,44)（不透明）', () => {
    const blits = blitsOf(plan);
    expect(blits).toHaveLength(2);
    expect(blits[0]).toMatchObject({
      archive: 'Panel.mkf',
      resource: EVENT_PANEL_RESOURCE,
      index: EVENT_NEWS_FRAME,
      size: null,
      keyed: false,
      at: { x: 0, y: 0 },
    });
    expect(blits[1]).toMatchObject({
      archive: 'Data.mkf',
      resource: NEWS_ART_BASE + 3,
      index: 0,
      size: EVENT_ART_SIZE,
      keyed: false, // ★ 整块 388×251 RGB555，**不抠黑**
      at: EVENT_ART_AT,
    });
  });

  it('★ 标题落 (24,8)、说明落 (24,310)，都是 flag 0（左上）、28 号、#f0f0f0', () => {
    const texts = textsOf(plan);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({
      text: newsTitle(3),
      at: NEWS_TITLE_AT,
      size: EVENT_FONT_SIZE,
      align: 'left',
      baseline: 'top',
      fill: '#f0f0f0',
      stroke: '#101010',
    });
    expect(texts[1]!.at).toEqual(NEWS_TEXT_AT);
  });

  it('★ 停 2400ms、没有第二段、没有 FLIC', () => {
    expect(plan.holdMs).toBe(2400);
    expect(plan.hold2Ms).toBe(0);
    expect(plan.flic).toBeNull();
    expect(plan.kind).toBe('news');
    expect(plan.id).toBe(3);
  });
});

describe('★ 命運那一段的绘制计划 @source 0x0044db81', () => {
  const plan = eventBoxPlan(fortuneView(12, 1, '糖糖'));

  it('★ 外框图 1、插画 `0x1dd+12` 落 (25,44)', () => {
    // ⚠️ 真表 `0x475fb4` 不是等差（id 20..36 有几项重复/走另一支），
    //   这里按任务书给的等价式钉；见 D-EVENT-6。
    const blits = blitsOf(plan);
    expect(blits[0]).toMatchObject({ index: EVENT_FORTUNE_FRAME, keyed: false, at: { x: 0, y: 0 } });
    expect(EVENT_FORTUNE_FRAME).toBe(1);
    expect(blits[1]).toMatchObject({
      archive: 'Data.mkf',
      resource: FORTUNE_ART_BASE + 12,
      size: EVENT_ART_SIZE,
      keyed: false,
      at: EVENT_ART_AT,
    });
  });

  it('★ **没有标题**（命運那张外框自带「？」），说明落 (24,330)', () => {
    const texts = textsOf(plan);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.at).toEqual(FORTUNE_TEXT_AT);
    expect(texts[0]!.at.y).toBe(330);
  });

  it('★ 1600ms + 800ms', () => {
    expect(plan.holdMs).toBe(1600);
    expect(plan.hold2Ms).toBe(800);
  });
});

describe('★ 抽卡那一段的绘制计划 @source 0x00441f73 / loc_0041b302', () => {
  const plan = eventBoxPlan(cardView(12));

  it('★ 三段：对话框皮（抠黑）→ 卡名（正中）→ 卡面（不透明）', () => {
    const items = plan.items;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      kind: 'blit',
      archive: 'Data.mkf',
      resource: 0x205, // 对话框皮：Data#517 图 5
      index: 5,
      keyed: true,
      at: CARD_SKIN_AT,
    });
    expect(items[1]).toMatchObject({
      kind: 'text',
      text: CARDS.find((c) => c.id === 12)!.name,
      at: CARD_NAME_AT,
      size: CARD_FONT_SIZE,
      align: 'center',
      baseline: 'middle', // flag 4 = 正中
    });
    expect(items[2]).toMatchObject({
      kind: 'blit',
      archive: 'Data.mkf',
      resource: CARD_FACE_BASE + 12,
      size: CARD_FACE_SIZE,
      keyed: false,
      at: CARD_FACE_AT,
    });
  });

  it('★ FLIC `#0x218` 落 (208,180)、停 1500ms', () => {
    expect(plan.flic).toEqual({
      archive: 'Data.mkf',
      resource: CARD_FLIC_RESOURCE,
      at: CARD_FLIC_AT,
    });
    expect(plan.holdMs).toBe(1500);
    expect(plan.hold2Ms).toBe(0);
    expect(plan.kind).toBe('card');
    expect(plan.id).toBe(12);
  });

  it('★ 卡名取自 `CARDS`；未知卡号时为空串', () => {
    expect(cardView(12).cardName).toBe('拆除卡');
    expect(textsOf(eventBoxPlan(cardView(12)))[0]!.text).toBe('拆除卡');
    expect(cardView(99).cardName).toBe('');
  });
});

// ============================================================
//  演出帧序（纯函数）
// ============================================================

describe('★ 演出帧序', () => {
  it('★ 新聞：起播即 show，2400ms 到点关屏，可跳过', () => {
    const p = eventBoxPlaybackStart(eventBoxPlan(newsView(0, 1, '')), 100);
    expect(p.phase).toBe('show');
    expect(eventBoxPlaybackTick(p, 100 + 2399, null)).not.toBeNull();
    expect(eventBoxPlaybackTick(p, 100 + 2400, null)).toBeNull();
    // 点一下（WM_LBUTTONUP）立刻关
    expect(eventBoxPlaybackSkip(p, 200)).toBeNull();
  });

  it('★ 命運：1600ms 进第二段、再过 800ms 才关；第二段也能点掉', () => {
    let p = eventBoxPlaybackStart(eventBoxPlan(fortuneView(0, 1, '')), 0);
    expect(eventBoxPlaybackTick(p, 1599, null)).toBe(p);
    p = eventBoxPlaybackTick(p, 1600, null)!;
    expect(p.secondAt).toBe(1600);
    expect(eventBoxPlaybackTick(p, 2399, null)).not.toBeNull();
    expect(eventBoxPlaybackTick(p, 2400, null)).toBeNull();
    // 第一段点一下 → 直接进第二段
    const q = eventBoxPlaybackSkip(eventBoxPlaybackStart(eventBoxPlan(fortuneView(0, 1, '')), 0), 500)!;
    expect(q.secondAt).toBe(500);
    // ★ 2026-09-19 订正：第二段走的是 `fcn_004528b9`（0x0044dd7b），它同样认
    //   `0x202`/`0x205`/`0x101` ⇒ 点一下就该关屏（旧断言 `toBe(q)` 是照
    //   「死等」那段错注释写的，见 `escalations.md` E-5）
    expect(eventBoxPlaybackSkip(q, 600)).toBeNull();
    // 不点的话仍然要等满第二段那 800ms
    expect(eventBoxPlaybackTick(q, 1299, null)).not.toBeNull();
    expect(eventBoxPlaybackTick(q, 1300, null)).toBeNull();
  });

  it('★ 抽卡：先 flic 段（按影片时长），再亮牌 1500ms', () => {
    let p = eventBoxPlaybackStart(eventBoxPlan(cardView(1)), 0);
    expect(p.phase).toBe('flic');
    // 影片还没解好：兜底时长
    expect(eventBoxPlaybackTick(p, 100, null)).toBe(p);
    p = eventBoxPlaybackTick(p, 1500, null)!;
    expect(p.phase).toBe('show');
    expect(eventBoxPlaybackTick(p, 1500 + CARD_HOLD_MS - 1, 900)).not.toBeNull();
    expect(eventBoxPlaybackTick(p, 1500 + CARD_HOLD_MS, 900)).toBeNull();
  });

  it('★ 抽卡：影片解好后按 frames×frameMs 走', () => {
    let p = eventBoxPlaybackStart(eventBoxPlan(cardView(1)), 0);
    expect(eventBoxPlaybackTick(p, 299, 300)).toBe(p);
    p = eventBoxPlaybackTick(p, 300, 300)!;
    expect(p.phase).toBe('show');
  });

  it('★ 抽卡：flic 段**点不掉**（`fcn_0045144f` 的跳过闸关着）、亮牌 1500ms 点得掉', () => {
    const p = eventBoxPlaybackStart(eventBoxPlan(cardView(1)), 0);
    // ★ 2026-09-19 订正：这一段是 `fcn_0045144f(img, 0xd0, 0xb4, 1, 0x63)`（0x0041b31b），
    //   flags=1 ⇒ `[0x48c880] = 1 & 2 = 0` ⇒ `0x004514d6` 的闸把它自己的
    //   `0x202/0x205/0x101` 检查整段跳过 ⇒ 原版这一段就不吃点击/按键。
    //   旧断言 `q.phase === 'show'` 是「替原版加了个它没有的跳过」，也一并订正。
    expect(eventBoxPlaybackSkip(p, 100)).toBe(p);
    // 影片走完（或兜底时长到）才进亮牌
    const q = eventBoxPlaybackTick(p, CARD_FLIC_FALLBACK_MS, null)!;
    expect(q.phase).toBe('show');
    // ★ 亮牌那段走 `fcn_004528b9(0x5dc)`（0x004420a6），它认这三种消息 ⇒ 点一下关屏
    expect(eventBoxPlaybackSkip(q, 200)).toBeNull();
  });
});

// ============================================================
//  真的画一遍（假 ctx）
// ============================================================

/** 假 2D ctx：只记落点 */
function fakeCanvas(): {
  ctx: CanvasRenderingContext2D;
  draws: { key: string; x: number; y: number }[];
  texts: { text: string; x: number; y: number; align: string; baseline: string; size: string }[];
} {
  const draws: { key: string; x: number; y: number }[] = [];
  const texts: {
    text: string;
    x: number;
    y: number;
    align: string;
    baseline: string;
    size: string;
  }[] = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    drawImage(bitmap: unknown, x: number, y: number): void {
      const b = bitmap as { key?: string };
      draws.push({ key: b.key ?? '?', x, y });
    },
    // 描边那一遍与填充同一落点 —— 只记 fillText，免得每条字记两笔
    strokeText(): void {
      /* 不记 */
    },
    fillText(text: string, x: number, y: number): void {
      texts.push({
        text,
        x,
        y,
        align: String(this.textAlign),
        baseline: String(this.textBaseline),
        size: this.font,
      });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, texts };
}

/** 假 sprite / raw：按 (档案, 资源, 图号) 造可辨认的位图 */
function fakeAssets(): {
  sprite: (a: string, r: number, i: number, keyed?: boolean) => Sprite | null;
  raw: (a: string, r: number, w: number, h: number) => Sprite | null;
  seen: string[];
} {
  const seen: string[] = [];
  const mk = (key: string): Sprite => ({
    bitmap: { key } as unknown as ImageBitmap,
    width: 10,
    height: 10,
    anchorX: 0,
    anchorY: 0,
  });
  return {
    sprite: (a, r, i, keyed = false) => {
      seen.push(`sprite:${a}:${r}:${i}:${keyed ? 'k' : ''}`);
      return mk(`sprite:${a}:${r}:${i}:${keyed ? 'k' : ''}`);
    },
    raw: (a, r, w, h) => {
      seen.push(`raw:${a}:${r}:${w}x${h}`);
      return mk(`raw:${a}:${r}:${w}x${h}`);
    },
    seen,
  };
}

describe('★ 画一遍：落点与抠黑（照计划执行）', () => {
  it('★ 新聞：外框 → 插画 → 标题 → 说明，四条都落在原版那四点', () => {
    const { ctx, draws, texts } = fakeCanvas();
    const a = fakeAssets();
    const plan = eventBoxPlan(newsView(3, 1, '約翰喬'));
    drawEventBoxScreen(ctx, a.sprite, a.raw, plan, { phase: 'show', elapsed: 0, flic: null });
    expect(draws.map((d) => [d.key, d.x, d.y])).toEqual([
      ['sprite:Panel.mkf:66:0:', 0, 0],
      ['raw:Data.mkf:444:388x251', 25, 44],
    ]);
    expect(texts.map((t) => [t.x, t.y])).toEqual([
      [24, 8],
      [24, 310],
    ]);
    // 28 号宋体
    expect(texts[0]!.size.startsWith('28px')).toBe(true);
  });

  it('★ 命運：说明画在 (24,330) 而不是 (24,310)', () => {
    const { ctx, draws, texts } = fakeCanvas();
    const a = fakeAssets();
    drawEventBoxScreen(
      ctx,
      a.sprite,
      a.raw,
      eventBoxPlan(fortuneView(12, 1, '糖糖')),
      { phase: 'show', elapsed: 0, flic: null },
    );
    expect(draws.map((d) => d.key)).toEqual([
      'sprite:Panel.mkf:66:1:',
      'raw:Data.mkf:489:388x251',
    ]);
    expect(texts).toHaveLength(1);
    expect([texts[0]!.x, texts[0]!.y]).toEqual([24, 330]);
  });

  it('★ 抽卡亮牌：皮（抠黑）→ 卡名（正中）→ 卡面', () => {
    const { ctx, draws, texts } = fakeCanvas();
    const a = fakeAssets();
    // 真皮的锚点 (123,101)：落点 = (220−123, 129−101) = (97,28)
    const sprite = (ar: string, r: number, i: number, keyed?: boolean): Sprite => {
      a.sprite(ar, r, i, keyed);
      return {
        bitmap: { key: `sprite:${ar}:${r}:${i}` } as unknown as ImageBitmap,
        width: 249,
        height: 170,
        anchorX: 123,
        anchorY: 101,
      };
    };
    drawEventBoxScreen(ctx, sprite, a.raw, eventBoxPlan(cardView(12)), {
      phase: 'show',
      elapsed: 0,
      flic: null,
    });
    expect(draws.map((d) => [d.key, d.x, d.y])).toEqual([
      ['sprite:Data.mkf:517:5', 97, 28],
      ['raw:Data.mkf:582:165x256', 138, 200],
    ]);
    expect(texts.map((t) => [t.text, t.x, t.y, t.align, t.baseline])).toEqual([
      ['拆除卡', 220, 129, 'center', 'middle'],
    ]);
  });

  it('★ FLIC 段只画影片那一帧，不画皮/卡面', () => {
    const { ctx, draws } = fakeCanvas();
    const a = fakeAssets();
    const frames = [
      { key: 'f0' } as unknown as ImageBitmap,
      { key: 'f1' } as unknown as ImageBitmap,
    ];
    const film: LoadedFlic = {
      frames,
      width: 100,
      height: 80,
      frameMs: 50,
      close: () => undefined,
    };
    drawEventBoxScreen(ctx, a.sprite, a.raw, eventBoxPlan(cardView(12)), {
      phase: 'flic',
      elapsed: 120, // 第 2 帧（120/50 = 2 → clamp 到最后一帧）
      flic: film,
    });
    expect(draws.map((d) => [d.key, d.x, d.y])).toEqual([['f1', 208, 180]]);
    // 影片缺席时不抛错、也不画任何东西
    drawEventBoxScreen(ctx, a.sprite, a.raw, eventBoxPlan(cardView(12)), {
      phase: 'flic',
      elapsed: 0,
      flic: null,
    });
    expect(draws).toHaveLength(1);
  });

  it('★ 资源取不到（null）时安静跳过、不抛错', () => {
    const { ctx, draws, texts } = fakeCanvas();
    drawEventBoxScreen(ctx, () => null, () => null, eventBoxPlan(newsView(5, 1, '')), {
      phase: 'show',
      elapsed: 0,
      flic: null,
    });
    expect(draws).toHaveLength(0);
    // 文字还是会画（文字不依赖图）
    expect(texts.length).toBeGreaterThan(0);
  });
});

// ============================================================
//  触发（真 event 钩子）
// ============================================================

/** 最小 `UiScreenEnv` —— 只填本屏读得到的几项 */
function fakeEnv(
  state: GameState,
  now = 0,
  flic: LoadedFlic | null = null,
  logs: string[] = [],
): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo: { nodes: [], lands: [], facilities: [] },
    map: { nodes: [], lands: [] } as never,
    now,
    stage: null as never,
    sprite: () => null,
    flic: () => flic,
    dispatch: () => undefined,
    requestRender: () => undefined,
    log: (m: string) => logs.push(m),
    playEffect: () => undefined,
    stopEffect: () => undefined,
  };
}

describe('★ event 钩子：lastEvent 变了 / 手牌变长', () => {
  it('★ 新聞：`lastEvent` 从 null 变成 news → 起播，落点 id 以 after 为准', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], null);
    const after = stateOf([player(0, [])], { kind: 'news', id: 3 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreen.active(fakeEnv(after))).toBe(true);
    expect(eventBoxScreenState().playback?.plan.kind).toBe('news');
    expect(eventBoxScreenState().playback?.plan.id).toBe(3);
    resetEventBoxScreen();
  });

  it('★ 命運：`lastEvent` 变成 fortune → 起播', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], { kind: 'news', id: 3 });
    const after = stateOf([player(0, [])], { kind: 'fortune', id: 12 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playback?.plan.kind).toBe('fortune');
    expect(eventBoxScreenState().playback?.plan.id).toBe(12);
    resetEventBoxScreen();
  });

  it('★ `lastEvent` 没变（同一 kind/id）→ 一次都不起播', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], { kind: 'news', id: 3 });
    const after = stateOf([player(0, [])], { kind: 'news', id: 3 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(false);
  });

  it('★ 抽卡：手牌变长 → 起播，卡名对得上', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [1])], null);
    const after = stateOf([player(0, [1, 12])], null);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(true);
    const plan = eventBoxScreenState().playback!.plan;
    expect(plan.kind).toBe('card');
    expect(plan.id).toBe(12);
    expect(textsOf(plan)[0]!.text).toBe('拆除卡');
    resetEventBoxScreen();
  });

  it('★ 手牌没长 / 状态对象没换 → 不起播', () => {
    resetEventBoxScreen();
    const s = stateOf([player(0, [1])], null);
    eventBoxScreen.event!(s, s, fakeEnv(s));
    expect(eventBoxScreenState().playing).toBe(false);
    eventBoxScreen.event!(s, stateOf([player(0, [1])], null), fakeEnv(s));
    expect(eventBoxScreenState().playing).toBe(false);
  });

  it('★ 正在播时不起新的（news 起播后手牌再变长也不换）', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [1])], null);
    const after = stateOf([player(0, [1, 5])], { kind: 'news', id: 0 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playback?.plan.kind).toBe('news');
    const grew = stateOf([player(0, [1, 5, 9])], { kind: 'news', id: 0 });
    eventBoxScreen.event!(after, grew, fakeEnv(grew));
    expect(eventBoxScreenState().playback?.plan.kind).toBe('news');
    expect(eventBoxScreenState().playback?.plan.id).toBe(0);
    resetEventBoxScreen();
  });

  it('★ tick / up 生命周期：到点自己关、点一下提前关', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], null);
    const after = stateOf([player(0, [])], { kind: 'news', id: 3 });
    const env0 = fakeEnv(after, 0);
    eventBoxScreen.event!(before, after, env0);
    expect(eventBoxScreenState().playing).toBe(true);
    // 还没到点
    eventBoxScreen.tick!(fakeEnv(after, NEWS_HOLD_MS - 1));
    expect(eventBoxScreenState().playing).toBe(true);
    // 到点自己关
    eventBoxScreen.tick!(fakeEnv(after, NEWS_HOLD_MS));
    expect(eventBoxScreenState().playing).toBe(false);

    // 再起一次，用 up 提前关
    eventBoxScreen.event!(before, after, env0);
    eventBoxScreen.up!(0, 0, fakeEnv(after, 10));
    expect(eventBoxScreenState().playing).toBe(false);
    expect(eventBoxScreen.active(fakeEnv(after))).toBe(false);
    resetEventBoxScreen();
  });

  it('★★ 右键（WM_RBUTTONUP / 0x205）与抬手同一条跳过出口 @source fcn_004544f6', () => {
    // 原版那两处等待是 `PeekMessage` 循环，`0x202`（左抬）与 `0x205`（右抬）
    // 都能提前结束 —— 只接 `up` 就漏了右键。`UiScreen.contextmenu` 收到的
    // 就是浏览器的 `WM_RBUTTONUP` 那一拍（见 `ui-screen.ts:117`）。
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], null);
    const after = stateOf([player(0, [])], { kind: 'news', id: 4 });
    const env0 = fakeEnv(after, 0);
    eventBoxScreen.event!(before, after, env0);
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreen.contextmenu).toBeTypeOf('function');
    eventBoxScreen.contextmenu!(0, 0, fakeEnv(after, 10));
    expect(eventBoxScreenState().playing).toBe(false);
    expect(eventBoxScreen.active(fakeEnv(after))).toBe(false);
    // ★ 没在播时右键也不能炸（原版那两处等待各有自己的窗口过程）
    eventBoxScreen.contextmenu!(0, 0, fakeEnv(after, 20));
    resetEventBoxScreen();
  });
});

// ============================================================
//  ★ 福神得卡不出卡面（第九份试玩回报第 1 条）
//
//  @source `fcn_0040ed8f`（`rich4_gods.asm:693-754`）的顺序：
//    0x21e 附身影片 → `0x40e2a2` 开场白（0x4632cc）→ `_rich4_player_receive_random_card`
//    → 訊息框 `0x4632fd`「%s附身 得到%s！」(0x5dc) → `0x44f230` 台词
//  **中间没有卡面** —— 卡面 `fcn_00441f73` / `Data.mkf 0x218` 是卡片格（`loc_0041b302`）
//  那一支的；`_rich4_receive_card` 纯状态、零图形。
//  core 在 `reduce.ts` 的 `case 'receiveCards'` 里 push `god.gotCard`（带 `cardId`），
//  `event()` 见到它就**让开** `cardGained`（否则手牌差集会让卡面与附身影片同时起播）。
//  反证：删掉 `event()` 里那句 `god.gotCard` 闸，下面第一条就变红。
// ============================================================

describe('★ 福神得卡：只有訊息框，不出卡面 @source fcn_0040ed8f', () => {
  /** `stateOf` + notices（`NoticeHint` 那一条就是 core `receiveCards` 交下来的形状） */
  const withNotices = (
    players: Player[],
    notices: GameState['notices'],
    lastEvent: GameState['lastEvent'] = null,
  ): GameState => ({ ...stateOf(players, lastEvent), notices });

  it('★★ 手牌变长 + `god.gotCard` ⇒ 不起播（卡面让开訊息框/台词）', () => {
    resetEventBoxScreen();
    const before = withNotices([player(0, [1])], []);
    const after = withNotices(
      [player(0, [1, 12])],
      [{ key: 'god.gotCard', args: ['大福神', '拆除卡'], holdMs: 1500, cardId: 12 }],
    );
    const env = fakeEnv(after);
    eventBoxScreen.event!(before, after, env);
    expect(eventBoxScreenState().playing).toBe(false);
    expect(eventBoxScreen.active(env)).toBe(false);
  });

  it('★★ 手牌变长 + 大福神那扇 `god.gotCardTwo`（一扇两卡名）⇒ 同样不起播', () => {
    // @source `fcn_0040ee50` 的 `0x0040eed7 push 0x463353`：大福神两张只弹**一扇**
    //   （`args` = 两张卡名，**不带神明名**、也不带 `cardId`）—— 闸口必须一并认它，
    //   否则这扇訊息框会被卡面盖住。
    resetEventBoxScreen();
    const before = withNotices([player(0, [1])], []);
    const after = withNotices(
      [player(0, [1, 12, 14])],
      [{ key: 'god.gotCardTwo', args: ['拆除卡', '停留卡'], holdMs: 1500 }],
    );
    const env = fakeEnv(after);
    eventBoxScreen.event!(before, after, env);
    expect(eventBoxScreenState().playing).toBe(false);
    expect(eventBoxScreen.active(env)).toBe(false);
  });

  it('★ 对照：同一条得卡（手牌变长）但 notices 里没有 `god.gotCard` ⇒ 照旧出卡面', () => {
    resetEventBoxScreen();
    const before = withNotices([player(0, [1])], []);
    const after = withNotices([player(0, [1, 12])], [{ key: 'god.build', args: ['大福神'] }]);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreenState().playback?.plan.kind).toBe('card');
    expect(eventBoxScreenState().playback?.plan.id).toBe(12);
    resetEventBoxScreen();
  });

  it('★ 没换过 `notices`（引用相同）时那条老 `god.gotCard` 不算数 ⇒ 照旧出卡面', () => {
    resetEventBoxScreen();
    const stale: GameState['notices'] = [
      { key: 'god.gotCard', args: ['大福神', '拆除卡'], holdMs: 1500, cardId: 12 },
    ];
    const before = withNotices([player(0, [1])], stale);
    const after = withNotices([player(0, [1, 12])], stale);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreenState().playback?.plan.kind).toBe('card');
    resetEventBoxScreen();
  });
});

// ============================================================
//  ★ 百貨公司裡得到的卡（董事長贈卡 / 貨架買卡）不出卡面
//  @source 贈卡 `0x0042e9c0 call 0x441e12`（rand + `receive_card`），買卡 `0x0042d242 call 0x4412e4`
//  —— 兩條都不經 `fcn_00441f73`（卡面）。第十二份試玩回報的日誌裡，進門贈卡與每一次買卡都起了
//  「事件提示框：抽到卡片」（`20260923-013753079` 的 #22、`20260923-014200829` 的 #12 / #13）。
//  反證：刪掉 `event()` 裡那句 `pending.shop` 閘，下面前兩條就變紅。
// ============================================================

describe('★ 百貨公司得卡：不出卡面 @source 0x0042e9c0 / 0x0042d242', () => {
  const shopPending = { kind: 'shop', points: 0, cards: [], tools: [], owned: { cards: [], tools: [] } } as unknown as GameState['pending'];
  const withPending = (players: Player[], pending: GameState['pending']): GameState => ({
    ...stateOf(players),
    pending,
  });

  it('★★ 進門那一條（settle → pending.shop）董事長贈卡 ⇒ 不起播', () => {
    resetEventBoxScreen();
    const before = withPending([player(0, [])], null);
    const after = withPending([player(0, [22])], shopPending);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(false);
  });

  it('★★ 商店裡買卡（shop → shop）⇒ 不起播', () => {
    resetEventBoxScreen();
    const before = withPending([player(0, [22])], shopPending);
    const after = withPending([player(0, [22, 12])], shopPending);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(false);
  });

  it('★ 对照：卡片格抽卡（前后都没有 pending.shop）⇒ 照旧出卡面', () => {
    resetEventBoxScreen();
    const before = withPending([player(0, [])], null);
    const after = withPending([player(0, [12])], null);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreenState().playback?.plan.kind).toBe('card');
    resetEventBoxScreen();
  });
});

// ============================================================
//  ★ D-EVENT-1 结案：`WM_KEYDOWN`（0x101）也能跳过
//    @source `fcn_004544f6`（`rich4_sound_effect.asm:915-960`）的 `PeekMessage`
//    认三种消息：`0x202`（左键抬起）/ `0x205`（右键）/ **`0x101`（按键）**，
//    任一命中就提前返回。`up`/`contextmenu` 早已接上，按键这一条原先没有出口
//    （`UiScreen.hotkey` 只送映射过的 28 个功能，收不到「任意键」）。
// ============================================================

describe('★ WM_KEYDOWN（0x101）跳过', () => {
  const keyEvent = (vk: number | null = 0x51) => ({
    vk,
    code: 'KeyQ',
    ctrl: false,
    shift: false,
    alt: false,
  });

  it('★ 新聞演出中按任意键 → 直接收掉这一屏', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], null);
    const after = stateOf([player(0, [])], { kind: 'news', id: 3 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreen.active(fakeEnv(after))).toBe(true);

    const handled = eventBoxScreen.key!(keyEvent(), fakeEnv(after, 10));
    expect(handled).toBe(true);
    // 跳过之后不再接管
    expect(eventBoxScreen.active(fakeEnv(after, 20))).toBe(false);
  });

  it('★ 不挑键：`vk = null`（认不出来的键）也照样跳过', () => {
    // 原版是 `cmp ecx,0x101 / jne 继续等` —— **只看消息号**，不看是哪个键。
    // ⚠️ 用新聞（一次演完）而不是命運：命運跳过第一段之后还有第二段
    //   （`fcn_004528b9(0x320)`），要按两次才关屏 —— 那是照抄原版的两段时序。
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], null);
    const after = stateOf([player(0, [])], { kind: 'news', id: 5 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreen.key!(keyEvent(null), fakeEnv(after, 10))).toBe(true);
    expect(eventBoxScreen.active(fakeEnv(after, 20))).toBe(false);
  });

  it('三条出口（抬手 / 右键 / 按键）落到**同一个**跳过 —— 行为一致', () => {
    const run = (fire: (env: UiScreenEnv) => void): boolean => {
      resetEventBoxScreen();
      const before = stateOf([player(0, [])], null);
      const after = stateOf([player(0, [])], { kind: 'news', id: 3 });
      eventBoxScreen.event!(before, after, fakeEnv(after));
      fire(fakeEnv(after, 10));
      return eventBoxScreen.active(fakeEnv(after, 20));
    };
    const byUp = run((env) => eventBoxScreen.up!(0, 0, env));
    const byRight = run((env) => eventBoxScreen.contextmenu!(0, 0, env));
    const byKey = run((env) => void eventBoxScreen.key!(keyEvent(), env));
    expect(byUp).toBe(false);
    expect(byRight).toBe(false);
    expect(byKey).toBe(false);
  });

  it('★ 没在演的时候按键是空操作（不返回 true，免得吞掉别的熱鍵）', () => {
    resetEventBoxScreen();
    const s = stateOf([player(0, [])], null);
    // 未起播：`key` 仍会被调到（屏不 active 时 main.ts 根本不会调），
    // 但直接调也不该抛、不该改状态
    expect(() => eventBoxScreen.key!(keyEvent(), fakeEnv(s))).not.toThrow();
  });
});

describe('★ 新聞百分比类那四条：逐人明细行 @source rich4_news.asm:1320 起（格式串 0x465592）', () => {
  it('★★ 明细行 = `%s繳交%d元`，从 (0x18,0x15a) 起、行距 0x20，金额 0 的不画', () => {
    const plan = eventBoxPlan(
      newsView(11, 1, '', [
        { name: '小丹尼', amount: 5000, character: 0 },
        { name: '錢夫人', amount: 0, character: 3 }, // 原版 `test eax,eax / je` 跳过
        { name: '忍太郎', amount: 1200, character: 2 },
      ]),
    );
    // ★ 只挑「明细行」那种形状（`…繳交<数字>元`）—— 事件标题里也含「繳交」两个字
    const isShareLine = (t: string): boolean => /繳交\d+元$/.test(t);
    const lines = plan.items.filter(
      (i): i is Extract<typeof i, { kind: 'text' }> => i.kind === 'text' && isShareLine(i.text),
    );
    expect(lines.map((l) => l.text)).toEqual(['小丹尼繳交5000元', '忍太郎繳交1200元']);
    expect(lines.map((l) => [l.at.x, l.at.y])).toEqual([
      [NEWS_SHARE_AT.x, NEWS_SHARE_AT.y],
      [NEWS_SHARE_AT.x, NEWS_SHARE_AT.y + NEWS_SHARE_PITCH],
    ]);
    // 左上角对齐（flag 0），不是正中
    expect(lines[0]!.align).toBe('left');
    expect(lines[0]!.baseline).toBe('top');
    // ★ 每画一行明细，紧跟一张**角色头像**：`map.mkf` 资源 `角色+0x1b` 图 3、抠黑，
    //   落点 (0x186, 行 y + 0xc) —— 原版是 `fcn_004562a5`（= 抠黑那份）
    const faces = plan.items.filter(
      (i): i is Extract<typeof i, { kind: 'blit' }> => i.kind === 'blit' && i.archive === 'map.mkf',
    );
    expect(faces.map((f) => [f.resource, f.index, f.keyed])).toEqual([
      [portraitResource(0), NEWS_SHARE_PORTRAIT_IMAGE, true],
      [portraitResource(2), NEWS_SHARE_PORTRAIT_IMAGE, true],
    ]);
    expect(faces.map((f) => [f.at.x, f.at.y])).toEqual([
      [NEWS_SHARE_PORTRAIT_X, NEWS_SHARE_AT.y + NEWS_SHARE_PORTRAIT_DY],
      [NEWS_SHARE_PORTRAIT_X, NEWS_SHARE_AT.y + NEWS_SHARE_PITCH + NEWS_SHARE_PORTRAIT_DY],
    ]);
    expect(NEWS_SHARE_PORTRAIT_X).toBe(0x186);
    expect(NEWS_SHARE_PORTRAIT_DY).toBe(0xc);
    expect(NEWS_SHARE_PORTRAIT_IMAGE).toBe(3);
    // 常量本身也钉住（`%s繳交%d元` 的格式与 0x15a / 0x20）
    expect(NEWS_SHARE_AT).toEqual({ x: 0x18, y: 0x15a });
    expect(NEWS_SHARE_PITCH).toBe(0x20);
    expect(newsShareLine('甲', 7)).toBe('甲繳交7元');
  });

  it('★ 不传 `shares` 时一行都不多（其余新闻与命運照旧）', () => {
    const isShareLine = (t: string): boolean => /繳交\d+元$/.test(t);
    const plain = eventBoxPlan(newsView(16, 1, '約翰喬'));
    expect(plain.items.some((i) => i.kind === 'text' && isShareLine(i.text))).toBe(false);
    const fortune = eventBoxPlan({ ...newsView(11, 1, ''), kind: 'fortune', id: 3 });
    expect(fortune.items.some((i) => i.kind === 'text' && isShareLine(i.text))).toBe(false);
  });
});

describe('★ 明细行头像的素材确实存在 @source map.mkf 资源 角色+0x1b 图 3', () => {
  const DIR = (process.env.RICH4_WORKSPACE ?? '') + '/assets-clean/map';
  const has = existsSync(DIR);
  it('★★ 四个角色的头像表各 7 张，图 3 存在且是 39×35 那一档', () => {
    if (!has) return;
    for (let character = 0; character < 4; character++) {
      const res = portraitResource(character);
      expect(res).toBe(27 + character);
      const files = readdirSync(DIR).filter((f) => f.startsWith(`${String(res).padStart(4, '0')}_`));
      // 7 张表情（图 0 = HUD 那张大的 85×71，1..6 是小的；明细行取图 3）
      expect(files.length, `资源 ${res}`).toBe(7);
      expect(NEWS_SHARE_PORTRAIT_IMAGE).toBeLessThan(files.length);
    }
    // 图 3 的尺寸（与「行距 0x20、画在 y+0xc」这条版面自洽：高 35 略高于一行）
    const png = readFileSync(`${DIR}/0027_003.png`).subarray(16, 24);
    expect([png.readUInt32BE(0), png.readUInt32BE(4)]).toEqual([39, 35]);
  });
});

describe('★ `magicHouse` 借同一条通道但**不出框**', () => {
  it('★★ `lastEvent.kind === \'magicHouse\'` 不该弹出新聞/命運框（它归魔法屋屏）', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], { kind: 'news', id: 3 });
    const after = stateOf([player(0, [])], {
      kind: 'magicHouse',
      id: 5,
      criterion: 7,
      targets: [0],
    });
    const env = fakeEnv(after);
    eventBoxScreen.event!(before, after, env);
    expect(eventBoxScreenState().playing).toBe(false);
    expect(eventBoxScreen.active(env)).toBe(false);
  });

  it('★ 对照：同样「kind 变了」时新聞那一条照旧起播', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], { kind: 'fortune', id: 1 });
    const after = stateOf([player(0, [])], { kind: 'news', id: 3 });
    const env = fakeEnv(after);
    eventBoxScreen.event!(before, after, env);
    expect(eventBoxScreenState().playing).toBe(true);
    resetEventBoxScreen();
  });
});

// ============================================================
//  ★ 可跳过性（falsification）—— `escalations.md` E-5
//
//  @source `fcn_004528b9`（VA 0x004528b9）的 `PeekMessageA` 循环：
//    0x004528fd  mov edx, [esp+4]              ; MSG.message
//    0x00452901  cmp edx, 0x202 / je 0x452919  ; WM_LBUTTONUP
//    0x00452909  cmp edx, 0x205 / je 0x452919  ; WM_RBUTTONUP
//    0x00452911  cmp edx, 0x101 / jne 0x45291e ; WM_KEYDOWN
//    0x00452919  mov ebx, 1                    ; 置「跳过」
//    0x00452934  cmp esi, ebp / jae 0x45293c   ; 等满时长也退出
//    0x00452938  test ebx, ebx / je 0x4528da   ; 没跳过就接着等
//    0x0045293c  mov eax, ebx                  ; 返回「是否被跳过」
//  本屏那两处调用点：命運第二段 `0x0044dd7b push 0x320`、抽卡亮牌
//  `0x004420a6 push 0x5dc`；两处都是 `add esp,4` 丢掉返回值
//  ⇒ 「跳过」= 不等满、直接往下走（收尾照跑）。
//
//  ★ 唯一**不吃**这三种消息的是抽卡第一段那段 FLIC（`fcn_0045144f`，0x0041b32b）：
//    那一处 `flags = 1`（`0x0041b31e 6a 01`）⇒ `0x00450d95 and al,2` 写到
//    `[0x48c880]` 的值 = 0 ⇒ `0x004514d6 cmp byte [0x48c880],0 / je 0x4514fd`
//    把整段消息检查跳过 ⇒ 原版点不掉，本屏也**不许**替它加跳过。
//
//  ★ 这一组就是**证伪用例**：把 `eventBoxPlaybackSkip` 改回「第二段/亮牌点不动」
//    （旧实现 `return p`），前四条都会变红；反过来给它加个原版没有的
//    「FLIC 可跳过」，最后一条变红。
// ============================================================

describe('★ 可跳过性（falsification：这几条红了就说明又回到「死等」那套读法）', () => {
  const anyKey = (vk: number | null = 0x51) => ({
    vk,
    code: 'KeyQ',
    ctrl: false,
    shift: false,
    alt: false,
  });

  it('★★ 命運第二段（0x0044dd7b 的 `fcn_004528b9(0x320)`）必须点得掉', () => {
    const q = eventBoxPlaybackSkip(
      eventBoxPlaybackStart(eventBoxPlan(fortuneView(0, 1, '')), 0),
      500,
    )!;
    expect(q.secondAt).toBe(500);
    // 旧实现这里是 `toBe(q)`（把「不可跳过」写在断言里）—— 现在必须是 null
    expect(eventBoxPlaybackSkip(q, 600)).toBeNull();
  });

  it('★★ 抽卡亮牌（0x004420a6 的 `fcn_004528b9(0x5dc)`）必须点得掉', () => {
    let q = eventBoxPlaybackStart(eventBoxPlan(cardView(1)), 0);
    q = eventBoxPlaybackTick(q, CARD_FLIC_FALLBACK_MS, null)!; // FLIC 走完 → 亮牌
    expect(q.phase).toBe('show');
    expect(eventBoxPlaybackSkip(q, 60)).toBeNull();
  });

  it('★★ 命運全段：抬手跳过第一段 → 按键关掉第二段（屏幕真的不再接管）', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], { kind: 'news', id: 1 });
    const after = stateOf([player(0, [])], { kind: 'fortune', id: 12 });
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playback?.plan.kind).toBe('fortune');
    eventBoxScreen.up!(0, 0, fakeEnv(after, 10)); // 第一段 → 进第二段
    expect(eventBoxScreenState().playback?.secondAt).toBe(10);
    expect(eventBoxScreen.active(fakeEnv(after, 20))).toBe(true); // 第二段还在等
    eventBoxScreen.key!(anyKey(), fakeEnv(after, 30)); // 第二段 → 关屏
    expect(eventBoxScreen.active(fakeEnv(after, 40))).toBe(false);
    resetEventBoxScreen();
  });

  it('★★ 抽卡全段：FLIC 段点不动 → 影片走完进亮牌 → 亮牌右键关屏', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [1])], null);
    const after = stateOf([player(0, [1, 12])], null);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playback?.phase).toBe('flic');
    eventBoxScreen.up!(0, 0, fakeEnv(after, 10)); // ★ FLIC 段：原版点不动
    expect(eventBoxScreenState().playback?.phase).toBe('flic');
    expect(eventBoxScreen.active(fakeEnv(after, 20))).toBe(true);
    // 影片走完（影片解不出来时按兜底时长）→ 亮牌
    eventBoxScreen.tick!(fakeEnv(after, CARD_FLIC_FALLBACK_MS));
    expect(eventBoxScreenState().playback?.phase).toBe('show');
    eventBoxScreen.contextmenu!(0, 0, fakeEnv(after, CARD_FLIC_FALLBACK_MS + 10)); // 亮牌 → 关屏
    expect(eventBoxScreen.active(fakeEnv(after, CARD_FLIC_FALLBACK_MS + 20))).toBe(false);
    resetEventBoxScreen();
  });

  it('★ 三条出口（抬手 / 右键 / 按键）对命運第二段**都**有效', () => {
    const fire = (kind: 'up' | 'ctx' | 'key'): boolean => {
      resetEventBoxScreen();
      const before = stateOf([player(0, [])], { kind: 'news', id: 1 });
      const after = stateOf([player(0, [])], { kind: 'fortune', id: 12 });
      eventBoxScreen.event!(before, after, fakeEnv(after));
      eventBoxScreen.up!(0, 0, fakeEnv(after, 10)); // 先进第二段
      const env = fakeEnv(after, 20);
      if (kind === 'up') eventBoxScreen.up!(0, 0, env);
      else if (kind === 'ctx') eventBoxScreen.contextmenu!(0, 0, env);
      else eventBoxScreen.key!(anyKey(), env);
      return eventBoxScreen.active(fakeEnv(after, 30));
    };
    expect(fire('up')).toBe(false);
    expect(fire('ctx')).toBe(false);
    expect(fire('key')).toBe(false);
  });

  it('★ 不点的话各段仍按原时长自己走完（别修成「一 tick 就关」）', () => {
    // 命運：第二段要等满 800ms
    const q = eventBoxPlaybackSkip(
      eventBoxPlaybackStart(eventBoxPlan(fortuneView(0, 1, '')), 0),
      500,
    )!;
    expect(eventBoxPlaybackTick(q, 500 + FORTUNE_SECOND_HOLD_MS - 1, null)).toBe(q);
    expect(eventBoxPlaybackTick(q, 500 + FORTUNE_SECOND_HOLD_MS, null)).toBeNull();
    // 抽卡亮牌：要等满 1500ms
    let c = eventBoxPlaybackStart(eventBoxPlan(cardView(1)), 0);
    c = eventBoxPlaybackTick(c, CARD_FLIC_FALLBACK_MS, null)!; // → show，showAt = 兜底时刻
    expect(eventBoxPlaybackTick(c, CARD_FLIC_FALLBACK_MS + CARD_HOLD_MS - 1, null)).toBe(c);
    expect(eventBoxPlaybackTick(c, CARD_FLIC_FALLBACK_MS + CARD_HOLD_MS, null)).toBeNull();
  });

  it('★★ 反面：抽卡 FLIC 段**不许**被改得可跳过（原版 `flags=1` ⇒ `[0x48c880]=0`）', () => {
    // @source 0x0041b31c `push 0x63 / push 1 / push 0xb4 / push 0xd0`（0x0041b31e = `6a 01` ⇒ flags=1）
    // @source 0x004514d6 `cmp byte [0x48c880], 0 / je 0x4514fd`（闸关则整段消息检查跳过）
    // @source 0x00450d95 `and al, 2 / 0x00450d97 mov [0x48c880], al`
    const fire = (kind: 'up' | 'ctx' | 'key'): string | undefined => {
      resetEventBoxScreen();
      const before = stateOf([player(0, [1])], null);
      const after = stateOf([player(0, [1, 12])], null);
      eventBoxScreen.event!(before, after, fakeEnv(after));
      const env = fakeEnv(after, 10);
      if (kind === 'up') eventBoxScreen.up!(0, 0, env);
      else if (kind === 'ctx') eventBoxScreen.contextmenu!(0, 0, env);
      else eventBoxScreen.key!(anyKey(), env);
      return eventBoxScreenState().playback?.phase;
    };
    // 三条出口都推不动它，仍然停在 FLIC 段
    expect(fire('up')).toBe('flic');
    expect(fire('ctx')).toBe('flic');
    expect(fire('key')).toBe('flic');
    resetEventBoxScreen();
  });
});

/*
 * ★★ 第十一份試玩回報 #5/#19：得點券格（`lastEvent.kind === 'minigameDecline'`，`id` 恒为 0）
 *   先前会掉进 `fortuneView(0)`，弹出一张「**強制拆除房屋一棟**」的命運卡 ——
 *   玩家明明只是踩到得點券格拿 50 點，却以为触发了拆房事件。
 *   这一条用源码钉守住「这条共用通道必须用白名单，只认 news / fortune」。
 */
describe('★★ 事件框只认 news / fortune（别的 kind 借道不出框）', () => {
  const src = readFileSync(new URL('./event-box-screen.ts', import.meta.url), 'utf8');

  it('判据是白名单 `(ev.kind === \'news\' || ev.kind === \'fortune\')`', () => {
    expect(src).toContain("(ev.kind === 'news' || ev.kind === 'fortune')");
  });

  it('不许再出现「只排除 magicHouse」那种黑名单写法', () => {
    expect(src).not.toContain("ev.kind !== 'magicHouse'");
  });
});

describe('★ 联机旁观：跟着行动者收场（`fastForward`）', () => {
  it('★ 命運第一段 ⇒ 整段直接收（不像点一下那样停到第二段）', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [])], null);
    const after = stateOf([player(0, [])], { kind: 'fortune', id: 12 });
    const logs: string[] = [];
    eventBoxScreen.event!(before, after, fakeEnv(after, 0, null, logs));
    expect(eventBoxScreen.fastForward!(fakeEnv(after, 10, null, logs))).toBe(true);
    expect(eventBoxScreenState().playing).toBe(false);
    expect(eventBoxScreen.active(fakeEnv(after))).toBe(false);
    expect(logs).toContain('事件提示框：fortune 跟著行動者收場');
  });

  it('★ 抽卡第一段那段点不掉的 FLIC 也收（行动者那台早演完了）', () => {
    resetEventBoxScreen();
    const before = stateOf([player(0, [1])], null);
    const after = stateOf([player(0, [1, 12])], null);
    eventBoxScreen.event!(before, after, fakeEnv(after));
    expect(eventBoxScreenState().playback?.phase).toBe('flic');
    // 点一下不动（原版那一段的跳过闸是关的）
    eventBoxScreen.up!(0, 0, fakeEnv(after, 10));
    expect(eventBoxScreenState().playing).toBe(true);
    expect(eventBoxScreen.fastForward!(fakeEnv(after, 10))).toBe(true);
    expect(eventBoxScreenState().playing).toBe(false);
  });

  it('没在播 ⇒ false', () => {
    resetEventBoxScreen();
    const s = stateOf([player(0, [])], null);
    expect(eventBoxScreen.fastForward!(fakeEnv(s))).toBe(false);
  });
});
