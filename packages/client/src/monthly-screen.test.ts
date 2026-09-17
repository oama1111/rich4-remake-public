/*
 * 每月結算 + 頒獎屏的版面、摘要与演出帧序
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编抄（VA 见 `monthly-screen.ts` 的注释），把最容易
 * 写错的几条钉住：
 *   ① **结算屏那一行**（`loc_00439cd7`）：头像在 `x = 600`、`y = MONTHLY_SEAT_Y[行]`
 *      = `{60,180,300,420}`；四段文字（`存款：`/存款额/`利息：`/利息额）照原版
 *      图 `11+行` 的局部 `(4,6)`/`(0x9a,6)`/`(4,0x2e)`/`(0x9a,0x2e)` 排布；
 *      **没有**行底板（图 2）/ 3D 数字（图 6..10）/ 金币 blit；
 *   ② **摘要来自 before → after 的 diff**：利息 = 存款增量（= `trunc(存款×0.1)`）；
 *   ③ **頒獎判据**：`(最高 − 次高) / 最高 > 0.4`，且最高分或次高分为 0 时无人获奖；
 *   ④ **状态机**：结算屏先逐行点亮，确认后才进頒獎屏，頒獎屏叠完还要再一拍才关。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  applyMonthlyInterest,
  isAlive,
  newGame,
  parseMap,
  type GameState,
  type MapTopology,
  type Player,
} from '@rich4/core';
import {
  MONTHLY_AVATAR_FRAME,
  MONTHLY_AVATAR_STRIDE,
  MONTHLY_AWARD_PATCH,
  MONTHLY_BAR_FRAME,
  MONTHLY_BAR_X,
  MONTHLY_BAR_Y,
  MONTHLY_CHUNK,
  MONTHLY_CHAMPION,
  MONTHLY_CHAMPION_LABELS,
  MONTHLY_DETAIL_AT,
  MONTHLY_DETAIL_LABELS,
  MONTHLY_DETAIL_ROWS,
  MONTHLY_INTRO,
  MONTHLY_SKIP_TICKS,
  MONTHLY_TABLE_PLATE,
  MONTHLY_LABELS,
  MONTHLY_NO_AWARD,
  MONTHLY_PANEL_AT,
  MONTHLY_RESOURCE,
  MONTHLY_ROW_AT,
  MONTHLY_ROW_BLOCK_X,
  MONTHLY_SEAT_AVATAR_X,
  MONTHLY_SEAT_BASE_Y,
  MONTHLY_AWARD_SEAT_FRAME,
  MONTHLY_AWARD_SEAT_X,
  MONTHLY_SEAT_FRAME,
  MONTHLY_SEAT_X,
  MONTHLY_SEAT_Y,
  MONTHLY_SLOTS,
  MONTHLY_TRAGIC,
  awardScore,
  drawMonthlyScreen,
  monthlyAward,
  monthlyAwardStart,
  monthlyChampionLines,
  monthlyDetailLines,
  monthlyKeyedBlack,
  monthlyPlaybackStart,
  monthlyPlaybackTick,
  monthlyRowLayout,
  monthlyRowText,
  monthlyScreen,
  monthlyScreenState,
  monthlySummary,
  pickAward,
  resetMonthlyScreen,
  type MonthlyAward,
  type MonthlyPlayback,
  type MonthlyView,
  MONTHLY_BARS,
  MONTHLY_SOUND_CLOSE,
  MONTHLY_SOUND_DETAIL,
  MONTHLY_SOUND_STEP,
  drawMonthlyAwardFlic,
  monthlyAwardFlicResource,
  MONTHLY_AWARD_FLIC_DX,
  MONTHLY_FLIC_OFFSETS,
  monthlyAwardFlicOffset,
  monthlyChampionOf,
  monthlyConsolationWho,
} from './monthly-screen.ts';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';

// ============================================================
//  素材 @source `read_mkf(panel_mkf, 0x19, 0, 0)` VA 0x00439c04
// ============================================================

describe('用到的图 @source 0x00439c04 / 0x0043849e', () => {
  it('★ 全部素材都在 Panel.mkf 资源 25（83 张）', () => {
    expect(MONTHLY_RESOURCE).toBe(25);
    expect(MONTHLY_CHUNK.bg).toBe(0);
    expect(MONTHLY_CHUNK.bubble).toBe(1);
    expect(MONTHLY_CHUNK.plate).toBe(2);
  });

  it('★ 图 6..10（3D 数字 / 金币）**结算屏原版一个都没 blit** @source loc_00439cd7', () => {
    // 资源的图号仍然照实记下来（6..9 = 3D 的 1/2/3/4、10 = 金币），
    // 但 `loc_00439cd7` 里没有任何一处贴它们 —— 本轮已从绘制里删掉。
    expect(MONTHLY_CHUNK.digitFirst).toBe(6);
    expect(MONTHLY_CHUNK.digitFirst + 3).toBe(9);
    expect(MONTHLY_CHUNK.coin).toBe(10);
  });

  it('★ 4 块窄板 = 图 11..14、4 列竖栏 = 图 15..18 @source 0x0043849e / 0x004387f9', () => {
    expect(MONTHLY_CHUNK.barFirst).toBe(11);
    expect(MONTHLY_CHUNK.columnFirst).toBe(15);
    // 窄板与竖栏**首尾相接**：11..14 之后紧接着 15..18
    expect(MONTHLY_CHUNK.barFirst + MONTHLY_SLOTS).toBe(MONTHLY_CHUNK.columnFirst);
  });

  it('★ 头像 = 图 `3×角色 + 47`（12 角色 × 3 帧 = 47..82；本屏只取第 0 帧）@source 0x00437c9f', () => {
    expect(MONTHLY_CHUNK.avatarFirst).toBe(47);
    expect(MONTHLY_AVATAR_STRIDE).toBe(3);
    // 12 个角色、每角色 3 帧，正好用完 47..82 —— 包里共 83 张（0..82）
    expect(MONTHLY_CHUNK.avatarFirst + 12 * MONTHLY_AVATAR_STRIDE - 1).toBe(82);
  });

  it('★ 结算屏左侧面板 = 图 19（`0xf0 = 0xc + 12×19`）、落在 (24,70) 且**要抠黑**', () => {
    // @source 0x00439c3a `mov eax,[0x48c41c] / add eax,0xf0`：
    // 图素表第 0 项在 `[0x48c41c] + 0xc`，每项 12 字节 ⇒ 图号 = (0xf0−0xc)/12
    expect(MONTHLY_CHUNK.panel).toBe(19);
    expect(0x0c + 12 * MONTHLY_CHUNK.panel).toBe(0xf0);
    // @source 0x00439c5d `push 0x46`（y）/ 0x00439c5f `push 0x18`（x）
    expect(MONTHLY_PANEL_AT).toEqual({ x: 0x18, y: 0x46 });
    expect(MONTHLY_PANEL_AT.x).toBe(24);
    expect(MONTHLY_PANEL_AT.y).toBe(70);
    // @source 0x00439c73 `call 0x456418` = fcn_00456418 = 抠掉纯黑那份
    expect(monthlyKeyedBlack(MONTHLY_CHUNK.panel)).toBe(true);
    // 而整屏底图（图 0）走的是不透明那份 0x00439c55
    expect(monthlyKeyedBlack(MONTHLY_CHUNK.bg)).toBe(false);
  });

  it('★ 头像（图 47..82）一律抠黑 @source 0x00439d35 / 0x0043850d', () => {
    for (let c = 0; c < 12; c++) {
      expect(monthlyKeyedBlack(MONTHLY_CHUNK.avatarFirst + c * MONTHLY_AVATAR_STRIDE)).toBe(true);
    }
    expect(monthlyKeyedBlack(82)).toBe(true);
    // 越界/别的图不在这一族里
    expect(monthlyKeyedBlack(83)).toBe(false);
    expect(monthlyKeyedBlack(MONTHLY_CHUNK.bg)).toBe(false);
  });

  it('★ 頒獎屏 4 块窄板的帧与落点 x @source 0x475948 / 0x475960', () => {
    expect(MONTHLY_BAR_FRAME).toEqual([16, 17, 15, 16]);
    // 落点 x 是拿同一个「帧」再查那张 4 列网格表 —— 值就是 16/17/15/16
    expect(MONTHLY_BAR_X).toEqual([16, 17, 15, 16]);
    expect(MONTHLY_BAR_Y).toBe(0x11);
    // 表里第 0 项就是 16，所以「帧 → x」在槽 0 上是自指的
    expect(MONTHLY_BAR_X[0]).toBe(MONTHLY_BAR_FRAME[0]);
  });
});

// ============================================================
//  版面（layout 快照）
// ============================================================

/** 最少一个玩家的状态 —— 只喂 `players`，其余字段对齐 `newGame` 的形状 */
function playerOf(index: number, character: number): Player {
  return {
    index,
    character,
    whoPlays: 2,
    xpos: 0,
    ypos: 0,
    nodeId: 1,
    lastNodeId: 1,
    direction: 0,
    trafficMethod: 0,
    ndices: 1,
    isMale: true,
    aiFlags: 3,
    cashRatio: 50,
    loanRatio: 50,
    stockRatio: 50,
    personality: 1,
    cash: 0,
    moneyInBank: 0,
    loan: 0,
    specialFinance: 0,
    loanDueDate: 0,
    points: 0,
    blocking: {
      inHotel: 0,
      disappearing: 0,
      inPrison: 0,
      inHospital: 0,
      sleeping: 0,
      sleepWalking: 0,
      stopping: 0,
      tortoiseWalking: 0,
    },
    daysRejectedByBank: 0,
    bankFreezeDays: 0,
    godInfo: 0,
    f64: 0,
    cards: [],
    tools: [],
    totalWinterSleepDays: 0,
    alliedPlayer: 0,
    alliedDays: 0,
    insuranceDays: 0,
    savedTrafficMethod: 0,
    savedNdices: 1,
    misfortune: 0,
    fortune: 0,
    luck: 0,
    hostility: [0, 0, 0, 0],
    monthlyPaid: 0,
    monthlyReceived: 0,
  };
}

/** 只用 `players`（+ 首富估值要的 holdings / market）的假状态 */
function fakeState(players: readonly Player[]): GameState {
  return {
    players: [...players],
    holdings: [],
    // ★ 必须有 `priceIndex`：`awardScore` 里 `totalWinterSleepDays * priceIndex * 2500`
    //   一旦碰上 `undefined` 就是 NaN，`pickAward` 的 `max < v` 永远不成立 →
    //   **每次都是「无人获奖」**，这类夹具就测不出获奖那一支了。
    priceIndex: 0,
    market: { stocks: Array.from({ length: 12 }, () => ({ price: 0 })) },
  } as unknown as GameState;
}

describe('★ layout 快照：结算屏每行的摆位 @source 0x00439cd7 起', () => {
  const four = (): GameState =>
    fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);

  it('★ 结算屏行头像：**x = 600（常数）**、y = `MONTHLY_SEAT_Y[行]` = {60,180,300,420}', () => {
    // @source 0x00439cfe `push 0x258`（x = 600）/ 0x00439cf5 查表当 y
    expect(MONTHLY_SEAT_AVATAR_X).toBe(0x258);
    expect(MONTHLY_SEAT_AVATAR_X).toBe(600);
    expect(MONTHLY_SEAT_Y).toEqual([60, 180, 300, 420]);
    const state = four();
    for (let i = 0; i < MONTHLY_SLOTS; i++) {
      const at = monthlyRowLayout(state, i, 'settle');
      expect(at.screen).toBe('settle');
      expect(at.avatar.x).toBe(600);
      expect(MONTHLY_SEAT_Y).toContain(at.avatar.y);
      expect(at.avatar.y).toBe(MONTHLY_SEAT_Y[i]);
    }
    // 默认（不传第二个参数）就是结算屏
    expect(monthlyRowLayout(state, 0).avatar.x).toBe(600);
    expect(monthlyRowLayout(state, 0).avatar.y).toBe(60);
  });

  it('★★ 頒獎屏那 4 列的 x 是**按 (在榜人数, 名次) 查表** @source 0x475930', () => {
    // 行 = `[0x48c420]`（who_plays != 0 的人数，0x00439caa 数出来的）
    expect(MONTHLY_AWARD_SEAT_X[2]).toEqual([407, 490]);
    expect(MONTHLY_AWARD_SEAT_X[3]).toEqual([324, 407, 490]);
    expect(MONTHLY_AWARD_SEAT_X[4]).toEqual([324, 407, 490, 573]);
    // 四人局四列间距 83（旧读法那个 {60,180,300,420} 其实是**死数据**那一行）
    for (let i = 1; i < 4; i++) {
      expect(MONTHLY_AWARD_SEAT_X[4]![i]! - MONTHLY_AWARD_SEAT_X[4]![i - 1]!).toBe(83);
    }
    expect(MONTHLY_SEAT_BASE_Y).toBe(0x14a);
    expect(MONTHLY_SEAT_BASE_Y).toBe(330);
    const state = four();
    for (let i = 0; i < MONTHLY_SLOTS; i++) {
      const at = monthlyRowLayout(state, i, 'award');
      expect(at.screen).toBe('award');
      expect(at.avatar.x).toBe(MONTHLY_AWARD_SEAT_X[4]![i]);
      const size = MONTHLY_AVATAR_FRAME[at.avatar.bar]!;
      expect(at.avatar.y).toBe(330 - size.h + size.y);
      // 四帧的 height/y 都是 (72,36) → 四列同高，y = 294
      expect(at.avatar.y).toBe(294);
      // 竖栏图号也查同一形状的表（四人是 15/16/17/18）
      expect(at.avatar.bar).toBe(MONTHLY_AWARD_SEAT_FRAME[4]![i]);
    }
  });

  it('★★ 在榜人数决定用哪一行：两人局 x = {407,490}、竖栏 = {16,17}', () => {
    // 只留两个人（原版 `[0x48c420]` 就是数 who_plays != 0）
    const base = four();
    const two = {
      ...base,
      players: base.players.map((p, i) => (i >= 2 ? { ...p, whoPlays: 0 } : p)),
    };
    const a = monthlyRowLayout(two, 0, 'award');
    const b = monthlyRowLayout(two, 1, 'award');
    expect(a.avatar.x).toBe(407);
    expect(b.avatar.x).toBe(490);
    expect(a.avatar.bar).toBe(16);
    expect(b.avatar.bar).toBe(17);
  });

  it('★★ 頒獎屏的 y 吃**真立绘**的 height/锚点（D-MONTHLY-10 结案）@source 0x004384de/e2', () => {
    const state = fakeState([playerOf(0, 3), playerOf(1, 0), playerOf(2, 4), playerOf(3, 1)]);
    // 角色 3 的立绘在 Panel#25 里是 36×58、锚点 y=29（manifest 实测）
    const byCharacter: Record<number, { height: number; anchorY: number }> = {
      0: { height: 72, anchorY: 36 },
      1: { height: 68, anchorY: 34 },
      3: { height: 58, anchorY: 29 },
      4: { height: 66, anchorY: 33 },
    };
    for (let i = 0; i < 4; i++) {
      const ch = state.players[i]!.character;
      const face = byCharacter[ch]!;
      const at = monthlyRowLayout(state, i, 'award', face);
      expect(at.avatar.y, `角色 ${ch}`).toBe(330 - face.height + face.anchorY);
    }
    // 不给图素时退回近似表（三个兜底帧都是 (72,36) ⇒ 294）
    expect(monthlyRowLayout(state, 0, 'award').avatar.y).toBe(294);
    // 角色 3 那一列因此是 301 而不是 294
    expect(monthlyRowLayout(state, 0, 'award', byCharacter[3]!).avatar.y).toBe(301);
  });

  it('★ 旧常数 `MONTHLY_SEAT_X` 只服务结算屏的 y 表（同值），不再是頒獎屏的 x', () => {
    expect(MONTHLY_SEAT_X).toEqual([60, 180, 300, 420]);
    expect(MONTHLY_SEAT_FRAME).toEqual([16, 17, 15, 16]);
  });

  it('★ 头像图号 = 3×角色 + 47（**不加帧**）@source `lea edi, [eax + 0x2f]` 0x00439d23', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 5), playerOf(2, 11)]);
    expect(monthlyRowLayout(state, 0).avatar.chunk).toBe(3 * 0 + 47);
    expect(monthlyRowLayout(state, 1).avatar.chunk).toBe(3 * 5 + 47);
    expect(monthlyRowLayout(state, 2).avatar.chunk).toBe(3 * 11 + 47);
    // ★ 回归：先前多加了頒獎屏那张竖栏表的「帧」（15/16/17）⇒ 图号 62..98，
    //   越过资源 0..82 ⇒ sprite() 返回 null ⇒ 有些角色整块不画。
    const all = Array.from({ length: 12 }, (_, c) => fakeState([playerOf(0, c)]));
    for (let c = 0; c < 12; c++) {
      const chunk = monthlyRowLayout(all[c]!, 0).avatar.chunk;
      expect(chunk).toBeGreaterThanOrEqual(MONTHLY_CHUNK.avatarFirst);
      expect(chunk).toBeLessThanOrEqual(82);
      expect(monthlyKeyedBlack(chunk)).toBe(true);
    }
  });

  it('★ 那一行四段文字 = 原版图 `11+行` 的那四个局部偏移 @source 0x00439d3d 起', () => {
    expect(MONTHLY_ROW_AT).toEqual({
      bankLabel: { dx: 4, dy: 6 },
      bank: { dx: 0x9a, dy: 6 },
      interestLabel: { dx: 4, dy: 0x2e },
      interestValue: { dx: 0x9a, dy: 0x2e },
    });
    expect(MONTHLY_ROW_BLOCK_X).toBe(0xe0);
    const state = four();
    for (let i = 0; i < MONTHLY_SLOTS; i++) {
      const at = monthlyRowLayout(state, i);
      const b = at.block;
      expect(b).toEqual({ x: MONTHLY_ROW_BLOCK_X, y: at.avatar.y });
      expect(at.bankLabel).toEqual({ x: b.x + 4, y: b.y + 6 });
      expect(at.bank).toEqual({ x: b.x + 0x9a, y: b.y + 6 });
      expect(at.interestLabel).toEqual({ x: b.x + 4, y: b.y + 0x2e });
      expect(at.interestValue).toEqual({ x: b.x + 0x9a, y: b.y + 0x2e });
      // ① **不裁字**：四段文字的 x 都在屏内（≥ 0）
      for (const p of [at.bankLabel, at.bank, at.interestLabel, at.interestValue]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(640);
      }
      // ② **不压立绘**：(24,70) 那块 186×410
      expect(b.x).toBeGreaterThanOrEqual(MONTHLY_PANEL_AT.x + 186);
      // ③ **不碰右侧那列头像**（x = 600）
      expect(b.x + MONTHLY_ROW_AT.bank.dx).toBeLessThan(MONTHLY_SEAT_AVATAR_X);
      // ④ 相邻两行不叠（块高 71 < 行距 120）
      if (i > 0) {
        const prev = monthlyRowLayout(state, i - 1);
        expect(b.y - prev.block.y).toBeGreaterThan(71);
      }
    }
  });

  it('★ layout 里**没有**行底板 / 数字球 / 金币 / 现金 / 玩家名（原版这一屏一个都没画）', () => {
    const at = monthlyRowLayout(fakeState([playerOf(0, 0)]), 0) as unknown as Record<
      string,
      unknown
    >;
    for (const gone of ['plate', 'digit', 'coin', 'cash', 'name']) {
      expect(gone in at).toBe(false);
    }
  });

  it('★ 完整快照（4 人，角色 0/1/2/3）', () => {
    const state = fakeState([
      playerOf(0, 0),
      playerOf(1, 1),
      playerOf(2, 2),
      playerOf(3, 3),
    ]);
    expect(
      [0, 1, 2, 3].map((i) => monthlyRowLayout(state, i)),
    ).toMatchInlineSnapshot(`
      [
        {
          "avatar": {
            "bar": 15,
            "chunk": 47,
            "x": 600,
            "y": 60,
          },
          "bank": {
            "x": 378,
            "y": 66,
          },
          "bankLabel": {
            "x": 228,
            "y": 66,
          },
          "block": {
            "x": 224,
            "y": 60,
          },
          "index": 0,
          "interestLabel": {
            "x": 228,
            "y": 106,
          },
          "interestValue": {
            "x": 378,
            "y": 106,
          },
          "screen": "settle",
        },
        {
          "avatar": {
            "bar": 16,
            "chunk": 50,
            "x": 600,
            "y": 180,
          },
          "bank": {
            "x": 378,
            "y": 186,
          },
          "bankLabel": {
            "x": 228,
            "y": 186,
          },
          "block": {
            "x": 224,
            "y": 180,
          },
          "index": 1,
          "interestLabel": {
            "x": 228,
            "y": 226,
          },
          "interestValue": {
            "x": 378,
            "y": 226,
          },
          "screen": "settle",
        },
        {
          "avatar": {
            "bar": 17,
            "chunk": 53,
            "x": 600,
            "y": 300,
          },
          "bank": {
            "x": 378,
            "y": 306,
          },
          "bankLabel": {
            "x": 228,
            "y": 306,
          },
          "block": {
            "x": 224,
            "y": 300,
          },
          "index": 2,
          "interestLabel": {
            "x": 228,
            "y": 346,
          },
          "interestValue": {
            "x": 378,
            "y": 346,
          },
          "screen": "settle",
        },
        {
          "avatar": {
            "bar": 18,
            "chunk": 56,
            "x": 600,
            "y": 420,
          },
          "bank": {
            "x": 378,
            "y": 426,
          },
          "bankLabel": {
            "x": 228,
            "y": 426,
          },
          "block": {
            "x": 224,
            "y": 420,
          },
          "index": 3,
          "interestLabel": {
            "x": 228,
            "y": 466,
          },
          "interestValue": {
            "x": 378,
            "y": 466,
          },
          "screen": "settle",
        },
      ]
    `);
  });

  it('★ 頒獎屏状态 1 那一小块是**裁切拷贝**、不是缩放 @source 0x00437fff', () => {
    // `fcn_0045643d(dst, 图 1, x=0x46, y=0x18, x_move=0x19a, y_move=0xba, w=0x46, h=0x18)`
    expect(MONTHLY_AWARD_PATCH).toEqual({
      srcX: 0x46,
      srcY: 0x18,
      w: 0x46,
      h: 0x18,
      dstX: 0x18,
      dstY: 0x46,
    });
    // 拷贝尺寸 70×24 落在源图 290×201 之内
    expect(MONTHLY_AWARD_PATCH.srcX + MONTHLY_AWARD_PATCH.w).toBeLessThanOrEqual(290);
    expect(MONTHLY_AWARD_PATCH.srcY + MONTHLY_AWARD_PATCH.h).toBeLessThanOrEqual(201);
    // ⚠️ 目的地那两点（旧读法）已作废 —— 见 D-MONTHLY-8 的订正
  });
});

// ============================================================
//  真的画一遍：结算屏这一帧贴了哪些图、字画在哪
// ============================================================

/** 记一笔 `drawImage` */
interface RecordedBlit {
  resource: number;
  index: number;
  keyed: boolean;
  x: number;
  y: number;
}

/** 记一笔 `strokeText` / `fillText` */
interface RecordedText {
  text: string;
  x: number;
  y: number;
  align: string;
}

/**
 * 最小假 ctx —— **只**实现本屏用到的那两个出口，把落点记下来。
 *
 * `anchorX/anchorY` 一律 0：本测试钉的是「布局给的落点」，
 * 锚点换算由真实 `Sprite` 带（`monthly-screen.ts` 的 `drawAnchored`）。
 */
function fakeCanvas(): {
  ctx: CanvasRenderingContext2D;
  blits: RecordedBlit[];
  texts: RecordedText[];
} {
  const blits: RecordedBlit[] = [];
  const texts: RecordedText[] = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    drawImage(bitmap: unknown, x: number, y: number): void {
      const b = bitmap as { resource?: number; index?: number; keyed?: boolean };
      blits.push({
        resource: b.resource ?? -1,
        index: b.index ?? -1,
        keyed: b.keyed === true,
        x,
        y,
      });
    },
    strokeText(text: string, x: number, y: number): void {
      texts.push({ text, x, y, align: String(this.textAlign) });
    },
    fillText(text: string, x: number, y: number): void {
      texts.push({ text, x, y, align: String(this.textAlign) });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, blits, texts };
}

/** 假 `sprite()`：按 (档案, 资源, 图号) 造一张可辨认的位图并记下请求 */
function fakeSpriteFn(): {
  sprite: (archive: string, resource: number, index: number, keyed?: boolean) => Sprite | null;
  asked: { archive: string; resource: number; index: number; keyed: boolean }[];
} {
  const asked: { archive: string; resource: number; index: number; keyed: boolean }[] = [];
  const sprite = (archive: string, resource: number, index: number, keyed = false): Sprite => {
    asked.push({ archive, resource, index, keyed });
    return {
      bitmap: { resource, index, keyed } as unknown as ImageBitmap,
      width: 66,
      height: 72,
      anchorX: 0,
      anchorY: 0,
    };
  };
  return { sprite, asked };
}

describe('★ 画一遍结算屏：贴的图与落点（缺陷 1/2/3/4 的回归）', () => {
  it('★ 只有 图0 / 图19 / 行头像 三类 blit，没有图 2、6..10、11..14', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);
    const view = monthlySummary(state, state);
    const { ctx, blits } = fakeCanvas();
    const { sprite, asked } = fakeSpriteFn();
    drawMonthlyScreen(
      ctx,
      sprite,
      state,
      { nodes: [], lands: [], facilities: [] },
      view,
      null,
      monthlyPlaybackStart(),
    );

    // `monthlySprite()` 一律问 `Panel.mkf` 资源 25，**图号**才区分是哪张
    const chunks = blits.filter((b) => b.resource === MONTHLY_RESOURCE).map((b) => b.index);
    // 底图 0（不透明）与立绘 19（抠黑）都在
    expect(chunks).toContain(0);
    expect(chunks).toContain(19);
    // ★ 缺陷 2/4 的回归：图 2（行底板）、6..10（3D 数字/金币）、11..14（窄板）一个都不许贴
    for (const gone of [2, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      expect(chunks).not.toContain(gone);
    }
    // 立绘抠黑、底图不抠
    const bg = blits.find((b) => b.index === 0)!;
    const portrait = blits.find((b) => b.index === 19)!;
    expect(bg.keyed).toBe(false);
    expect(portrait.keyed).toBe(true);
    expect(portrait.x).toBe(MONTHLY_PANEL_AT.x);
    expect(portrait.y).toBe(MONTHLY_PANEL_AT.y);
    // 立绘那一次请求一定带抠黑
    const askedPortrait = asked.find((a) => a.index === 19)!;
    expect(askedPortrait.keyed).toBe(true);
    expect(askedPortrait.archive).toBe('Panel.mkf');
  });

  it('★ 4 个头像落在 x=600、y ∈ {60,180,300,420}，且**没有**第 5 个', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);
    const view = monthlySummary(state, state);
    const { ctx, blits } = fakeCanvas();
    const { sprite } = fakeSpriteFn();
    drawMonthlyScreen(
      ctx,
      sprite,
      state,
      { nodes: [], lands: [], facilities: [] },
      view,
      null,
      { ...monthlyPlaybackStart(), revealed: 3 },
    );
    const avatars = blits.filter(
      (b) => b.index >= MONTHLY_CHUNK.avatarFirst && b.index <= 82,
    );
    expect(avatars.map((b) => b.x)).toEqual([600, 600, 600, 600]);
    expect(avatars.map((b) => b.y)).toEqual([...MONTHLY_SEAT_Y]);
    // 4 人局就 4 个（不是 5 个）
    expect(avatars).toHaveLength(MONTHLY_SLOTS);
  });

  it('★ 每一段字的 x 都 ≥ 0（缺陷 1/3 的回归），标签与数值不互相压', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);
    const view = monthlySummary(state, state);
    const { ctx, texts } = fakeCanvas();
    const { sprite } = fakeSpriteFn();
    drawMonthlyScreen(
      ctx,
      sprite,
      state,
      { nodes: [], lands: [], facilities: [] },
      view,
      null,
      { ...monthlyPlaybackStart(), revealed: 3 },
    );
    for (const t of texts) {
      expect(t.x, `${t.text} @ ${t.x}`).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(640);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(480);
    }
    // 标签左对齐在块内 +4、数值右对齐在块内 +0x9a ⇒ 天然错开
    const labels = texts.filter((t) => t.align === 'left').map((t) => t.x);
    const values = texts.filter((t) => t.align === 'right').map((t) => t.x);
    expect(Math.min(...labels)).toBe(MONTHLY_ROW_BLOCK_X + MONTHLY_ROW_AT.bankLabel.dx);
    expect(Math.max(...values)).toBe(MONTHLY_ROW_BLOCK_X + MONTHLY_ROW_AT.bank.dx);
    // 标签左边缘离数值的右边缘至少 0x40（值最宽 ≈70px，标签最长 54px）
    expect(Math.min(...labels)).toBeLessThan(Math.max(...values) - 0x40);
  });
});

// ============================================================
//  摘要：从 before → after 的 diff 取
// ============================================================

/** 造一份 「月结前 → 月结后」 的最小对 */
function settlePair(players: readonly Partial<Player>[]): {
  before: GameState;
  after: GameState;
} {
  const before = fakeState(
    players.map((p, i) => ({ ...playerOf(i, i), moneyInBank: 0, ...p })),
  );
  const after = fakeState(
    players.map((p, i) => {
      const b = before.players[i]!;
      return { ...b, moneyInBank: applyMonthlyInterest(b.moneyInBank, b.loan) };
    }),
  );
  return { before, after };
}

describe('★ 月结摘要 = before → after 的 diff', () => {
  it('★ 利息 = 存款增量 = `trunc(存款 × 0.1)`（有贷款则 0）', () => {
    const { before, after } = settlePair([
      { character: 0, moneyInBank: 100000 },
      { character: 1, moneyInBank: 5000 },
      { character: 2, moneyInBank: 100000, loan: 1 },
      { character: 3, moneyInBank: 0 },
    ]);
    const v = monthlySummary(before, after);
    expect(v.rows.map((r) => r.interest)).toEqual([10000, 500, 0, 0]);
    // 规则侧同一个函数算出来的差值，必须与摘要一致
    expect(v.rows[0]!.interest).toBe(
      applyMonthlyInterest(100000, 0) - 100000,
    );
  });

  it('★ 不在场的玩家（`whoPlays === 0`）不出现在摘要里 @source 0x00439c93', () => {
    const { before, after } = settlePair([
      { character: 0 },
      { character: 1, whoPlays: 0 },
      { character: 2 },
      { character: 3, whoPlays: 0 },
    ]);
    expect(monthlySummary(before, after).rows.map((r) => r.index)).toEqual([0, 2]);
  });

  it('★ 收入 / 支出两个本月累计照样带上（頒獎屏要用）', () => {
    const { before, after } = settlePair([
      { character: 0, monthlyPaid: 26000, monthlyReceived: 394432 },
    ]);
    const row = monthlySummary(before, after).rows[0]!;
    expect(row.monthlyPaid).toBe(26000);
    expect(row.monthlyReceived).toBe(394432);
  });

  it('★ 角色名取自 CHARACTERS', () => {
    const { before, after } = settlePair([{ character: 3 }]);
    expect(monthlySummary(before, after).rows[0]!.name).toBe('錢夫人');
  });

  it('★ 文字快照：有贷款画红字 `貸款中`', () => {
    const { before, after } = settlePair([
      { character: 0, cash: 12345, moneyInBank: 100000 },
      { character: 1, cash: -500, moneyInBank: 0, loan: 7000 },
    ]);
    const rows = monthlySummary(before, after).rows;
    expect(rows.map(monthlyRowText)).toMatchInlineSnapshot(`
      [
        {
          "bank": "$110,000",
          "bankLabel": "存款：",
          "cash": "$12,345",
          "interest": "$10,000",
          "interestLabel": "利息：",
          "loan": false,
          "name": "約翰喬",
        },
        {
          "bank": "$0",
          "bankLabel": "存款：",
          "cash": "$-500",
          "interest": "貸款中",
          "interestLabel": "利息：",
          "loan": true,
          "name": "沙隆巴斯",
        },
      ]
    `);
    expect(MONTHLY_LABELS.loan).toBe('貸款中');
  });
});

// ============================================================
//  頒獎判据 @source fcn_00437d1a
// ============================================================

describe('★ 頒獎判据 @source 0x00437d1a / 0x00437dfe', () => {
  it('★ 分公式 = (支出 − 收入) + 冬眠天数×物价×2500 + 衰運×10', () => {
    const p: Player = {
      ...playerOf(0, 0),
      monthlyPaid: 26000,
      monthlyReceived: 1000,
      totalWinterSleepDays: 2,
      misfortune: 5,
    };
    expect(awardScore(p, 1)).toBe(26000 - 1000 + 2 * 1 * 2500 + 5 * 10);
    expect(awardScore(p, 3)).toBe(26000 - 1000 + 2 * 3 * 2500 + 50);
  });

  it('★ 领先 0.4 倍：`3×最高 > 5×次高` 才颁奖', () => {
    // 100 / 60：差值 40 → 40/100 = 0.4 → **不**颁奖（原版是 `jbe`）
    expect(pickAward([100, 60, 0, 0])).toBe(-1);
    // 100 / 59：0.41 → 颁奖
    expect(pickAward([100, 59, 0, 0])).toBe(0);
    // 最大者在第 2 位
    expect(pickAward([59, 100, 0, 0])).toBe(1);
  });

  it('★ 最高分为 0 或次高分为 0 → 无人获奖（只有一个人在场也一样）', () => {
    expect(pickAward([])).toBe(-1);
    expect(pickAward([0])).toBe(-1);
    expect(pickAward([1000])).toBe(-1); // 次高分 = 0
    expect(pickAward([0, 0, 0, 0])).toBe(-1);
    // 负分：最高仍是 0 → 不颁
    expect(pickAward([-5, -3])).toBe(-1);
  });

  it('★ 与「先取最高、把它清零后再取最高」的朴素实现逐例交叉验证', () => {
    /** core `pickAwardWinner` 用的那套朴素算法 */
    const naive = (scores: readonly number[]): number => {
      let max = 0;
      let at = 0;
      for (let i = 0; i < scores.length; i++) {
        if (max < scores[i]!) {
          max = scores[i]!;
          at = i;
        }
      }
      let second = 0;
      for (let i = 0; i < scores.length; i++) {
        const v = scores[i] === max ? 0 : scores[i]!;
        if (second < v) second = v;
      }
      if (max === 0 || second === 0) return -1;
      return 3 * max > 5 * second ? at : -1;
    };
    const vals = [-3, 0, 1, 4, 7];
    for (const a of vals) {
      for (const b of vals) {
        for (const c of vals) {
          for (const d of vals) {
            const s = [a, b, c, d];
            expect(pickAward(s)).toBe(naive(s));
          }
        }
      }
    }
  });

  it('★ 平手：两人同分时最高分者只有一个「最高」，次高 = 同分值 → 不颁', () => {
    // 100/100：朴素算法会把两个 100 都清零 → second = 0 → 不颁
    expect(pickAward([100, 100])).toBe(-1);
    // 100/100/10：清零两个 100 后 second = 10 → 90/100 = 0.9 > 0.4 → 颁给先出现的
    expect(pickAward([100, 100, 10])).toBe(0);
  });

  it('★ 无人获奖时 `winner = -1`，收尾那句换成「本月悲情人物是」', () => {
    const { before, after } = settlePair([{ character: 0 }, { character: 1 }]);
    const award = monthlyAward(before, after, {
      nodes: [],
      lands: [],
      facilities: [],
    } satisfies MapTopology);
    expect(award.winner).toBe(-1);
    expect(MONTHLY_TRAGIC).toBe('本月悲情人物是');
    expect(MONTHLY_CHAMPION).toBe('本月冠軍是');
    expect(MONTHLY_NO_AWARD).toBe('別灰心，再加油喔！');
  });

  it('★ 悲情那张表是**四行**、且损失/之财不许取反 @source 串 0x464de4 / 0x464def / 0x464dfe / 0x464e0d', () => {
    const { before, after } = settlePair([
      { character: 0, cash: 1000, monthlyPaid: 11, monthlyReceived: 22, totalWinterSleepDays: 3 },
      { character: 1, cash: 999999, monthlyPaid: 0, monthlyReceived: 0 },
    ]);
    const topo = { nodes: [], lands: [], facilities: [] } satisfies MapTopology;
    const award = monthlyAward(before, after, topo);
    const lines = monthlyDetailLines(after, topo, award);
    expect(MONTHLY_DETAIL_ROWS).toBe(4);
    expect(lines.map((l) => l.label)).toEqual([
      MONTHLY_DETAIL_LABELS.reason,
      MONTHLY_DETAIL_LABELS.unexpectedLoss,
      MONTHLY_DETAIL_LABELS.unexpectedGain,
      MONTHLY_DETAIL_LABELS.unluckyDays,
    ]);
    // 第 1 行原版**只画标签**（`loc_00438570` 里 `0x172` 那行后面没有取值/画值的代码）
    expect(lines[0]!.value).toBe('');
    // 1 号现金最多 → 首富是他；0 号支出 11 < 收入 22 → 悲情分负 → 无人获奖
    expect(award.winner).toBe(-1);
    // 无人获奖 ⇒ 后三行都按 0 画（但标签顺序不许乱）
    expect(lines[1]!.value).toBe('$0');
    expect(lines[2]!.value).toBe('$0');
    expect(lines[3]!.value).toBe('0天');
  });

  it('★ 损失/之财取的是悲情那位本人的月度收支 @source `player[+0x5c]` / `player[+0x60]`', () => {
    // 0 号本月支出巨大 → 他就是悲情人物；monthlyPaid → 意外損失，monthlyReceived → 意外之財
    // （1 号要给一个**正但较小**的分：`pickAward` 里「次高分为 0 → 无人获奖」会把 0/负分否掉）
    const { before, after } = settlePair([
      { character: 0, cash: 5000, monthlyPaid: 700, monthlyReceived: 30, totalWinterSleepDays: 9 },
      { character: 1, cash: 8000, monthlyPaid: 200, monthlyReceived: 0 },
    ]);
    const topo = { nodes: [], lands: [], facilities: [] } satisfies MapTopology;
    const award = monthlyAward(before, after, topo);
    expect(award.winner).toBe(0);
    const lines = monthlyDetailLines(after, topo, award);
    expect(lines[1]!.label).toBe('本月意外損失：');
    expect(lines[1]!.value).toBe('$700');
    expect(lines[2]!.label).toBe('本月意外之財：');
    expect(lines[2]!.value).toBe('$30');
    expect(lines[3]!.value).toBe('9天');
  });

  it('★ 冠军那张表：獲獎原因/現金/存款/總資產，都是**首富**的数 @source `loc_00438d40`', () => {
    // 存款 4000 → 月息 10% → 结息后 4400（`applyMonthlyInterest`），故断言用 after 的值
    const { before, after } = settlePair([
      { character: 0, cash: 5000, monthlyPaid: 900, monthlyReceived: 0 },
      { character: 1, cash: 1234, moneyInBank: 4000 },
    ]);
    const topo = { nodes: [], lands: [], facilities: [] } satisfies MapTopology;
    const award = monthlyAward(before, after, topo);
    const lines = monthlyChampionLines(after, topo, award);
    expect(MONTHLY_CHAMPION_LABELS.reason).toBe('獲獎原因：');
    expect(lines.map((l) => l.label)).toEqual([
      MONTHLY_CHAMPION_LABELS.reason,
      MONTHLY_CHAMPION_LABELS.cash,
      MONTHLY_CHAMPION_LABELS.bank,
      MONTHLY_CHAMPION_LABELS.assets,
    ]);
    expect(lines[0]!.value).toBe('');
    // 冠军 = 首富（`[0x48c430]`），不是悲情那位；他的现金/存款/总资产
    expect(award.richest).toBe(1);
    expect(after.players[1]!.moneyInBank).toBe(4400);
    expect(lines[1]!.value).toBe('$1,234');
    expect(lines[2]!.value).toBe('$4,400');
    expect(lines[3]!.value).toBe('$5,634');
  });

  it('★★ `#0092` 开屏串逐字节对照 exe @source 0x004d60 起（VA 0x00464d60）', () => {
    // ★ 2026-09-17 订正：先前那份转写是「月底快到了！⏎又到了每個月結算的日子。」
    //   —— 从 exe 里逐字节 dump 出来是**三行、两个换行**，而且开头不同：
    const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
    if (existsSync(EXE)) {
      const buf = readFileSync(EXE);
      const off = 398848 + (0x464d60 - 0x463000); // VA → 文件偏移（exe 专用换算）
      const end = buf.indexOf(0, off);
      const raw = buf.subarray(off, end).toString('latin1');
      // `#0092` 是消息号前缀，本模块的常量不带它
      const text = new TextDecoder('big5').decode(Buffer.from(raw.slice(5), 'latin1'));
      expect(MONTHLY_INTRO).toBe(text);
      expect(MONTHLY_INTRO).toBe('各位客戶辛苦了！\n又到了每月銀行\n結算的日子。');
      expect(MONTHLY_INTRO.split('\n')).toHaveLength(3);
    }
    // ★ 本模块**刻意不画它**：原版那句受「上一次开过的字框」这个脏全局管辖
    //   （`fcn_0044ecb6` 开头 `cmp [0x4762bc], 0 / je 返回`，而它从不清零）——
    //   见 `docs/known-deviations.md` 的「動畫過程」表末行。
    const src = readFileSync(new URL('./monthly-screen.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('monthlyText(ctx, MONTHLY_INTRO');
  });

  it('★ 四行的行距与落点 @source 0x00438570 的 `push 0x172` 起', () => {
    expect(MONTHLY_DETAIL_AT.y0).toBe(0x172);
    expect(MONTHLY_DETAIL_AT.step).toBe(0x12);
    expect(MONTHLY_DETAIL_AT.x).toBe(0x140);
    expect(MONTHLY_DETAIL_AT.valueX).toBe(0x230);
  });
});

// ============================================================
//  演出状态机
// ============================================================

describe('★ 演出状态机', () => {
  it('★ 结算屏：先逐行点亮，全亮后停在「等确认」', () => {
    let p = monthlyPlaybackStart();
    expect(p).toEqual({
      phase: 'settle',
      revealed: 0,
      bars: 0,
      seats: 0,
      details: 0,
      encourage: false,
      closing: false,
      skipTicks: 0,
    });
    // 4 行 → 3 拍点亮完
    p = monthlyPlaybackTick(p, 4)!;
    expect(p.revealed).toBe(1);
    p = monthlyPlaybackTick(p, 4)!;
    expect(p.revealed).toBe(2);
    p = monthlyPlaybackTick(p, 4)!;
    expect(p.revealed).toBe(3);
    // 全亮后再 tick 也不动（原版 `[0x48c42a]` 不变）
    expect(monthlyPlaybackTick(p, 4)).toEqual(p);
    expect(monthlyPlaybackTick(p, 4)!.phase).toBe('settle');
  });

  it('★ 只有 1 个人在场时第 0 拍就已经全亮', () => {
    const p = monthlyPlaybackStart();
    expect(monthlyPlaybackTick(p, 1)!.revealed).toBe(0);
  });

  it('★ 頒獎屏：铺 4 板 → 画 4 列 → 叠 4 条 → 悲情那一拍 → 再一拍才关', () => {
    let p: MonthlyPlayback = { ...monthlyPlaybackStart(), phase: 'award' };
    const seen: string[] = [];
    let guard = 0;
    while (guard++ < 40) {
      const next = monthlyPlaybackTick(p, 4);
      if (next === null) {
        seen.push('null');
        break;
      }
      p = next;
      seen.push(
        `${p.bars}/${p.seats}/${p.details}${p.encourage ? '/sad' : ''}${p.closing ? '/closing' : ''}`,
      );
    }
    expect(seen).toEqual([
      '1/0/0',
      '2/0/0',
      '3/0/0',
      '4/0/0',
      '4/1/0',
      '4/2/0',
      '4/3/0',
      '4/4/0',
      '4/4/1',
      '4/4/2',
      '4/4/3',
      '4/4/4',
      // ★ 详情叠完先走「本月悲情人物」那一拍（原版状态 9 的 `別灰心，再加油喔！`）
      '4/4/4/sad',
      '4/4/4/sad/closing',
      'null',
    ]);
  });
});

// ============================================================
//  event / tick 生命周期（真地图）
// ============================================================

const MAP_PATH = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const runMap = existsSync(MAP_PATH) ? it : it.skip;

/** 最小 `UiScreenEnv` —— 只填本屏读得到的几项 */
function fakeEnv(state: GameState, topo: MapTopology, logs: string[]): UiScreenEnv {
  return {
    screen: 'game',
    state,
    topo,
    map: { nodes: [], lands: [] } as never,
    now: 0,
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

describe('★ event 判据：`totalMonths` 增了才起播', () => {
  runMap('★★ 起播时**点一首 BGM**（`fcn_004549cf(9)` → midi10.mid）@source rich4.asm:19212', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP_PATH)));
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    resetMonthlyScreen();
    const logs: string[] = [];
    const played: string[] = [];
    const env = { ...fakeEnv(base, topo, logs), music: (f: string) => played.push(f) };
    const before: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, moneyInBank: 100000 })),
    };
    const after: GameState = {
      ...before,
      totalMonths: before.totalMonths + 1,
      players: before.players.map((p) => ({
        ...p,
        moneyInBank: applyMonthlyInterest(p.moneyInBank, p.loan),
      })),
    };
    monthlyScreen.event!(before, after, env);
    expect(played).toEqual(['midi10.mid']);
    resetMonthlyScreen();
  });

  runMap('★ 跨月 → 起播；没跨月 → 一次都不起播', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP_PATH)));
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    resetMonthlyScreen();
    const logs: string[] = [];
    const env = fakeEnv(base, topo, logs);

    // 没跨月：不起播
    monthlyScreen.event!(base, { ...base, totalDays: base.totalDays + 1 }, env);
    expect(monthlyScreenState().playing).toBe(false);

    // 跨月：起播（`totalMonths + 1`，存款也按 1.1 结算过）
    const before: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, moneyInBank: 100000 })),
    };
    const after: GameState = {
      ...before,
      totalMonths: before.totalMonths + 1,
      players: before.players.map((p) => ({
        ...p,
        moneyInBank: applyMonthlyInterest(p.moneyInBank, p.loan),
      })),
    };
    monthlyScreen.event!(before, after, env);
    expect(monthlyScreenState().playing).toBe(true);
    expect(monthlyScreen.active(env)).toBe(true);
    expect(monthlyScreenState().view?.rows).toHaveLength(
      after.players.filter((p) => isAlive(p)).length,
    );
    expect(monthlyScreenState().view?.rows.every((r) => r.interest === 10000)).toBe(true);

    // tick 到结算屏全亮
    for (let i = 0; i < 10; i++) monthlyScreen.tick!(env);
    expect(monthlyScreenState().playback?.phase).toBe('settle');
    expect(monthlyScreenState().playback?.revealed).toBe(
      (monthlyScreenState().view?.rows.length ?? 1) - 1,
    );

    // ★ 确认在**抬手**（`WM_LBUTTONUP` 0x202）：
    //   原版的分支表里**没有 `0x201`（按下）那一条**，故本屏根本不实现 `down`
    expect(monthlyScreen.down).toBeUndefined();
    expect(monthlyScreenState().playback?.phase).toBe('settle');
    monthlyScreen.up!(0, 0, env);
    expect(monthlyScreenState().playback?.phase).toBe('award');

    // 頒獎屏叠完之后还得再一拍才关屏（原版「等最后一次确认」那几步）
    const total = MONTHLY_SLOTS * 2 + MONTHLY_DETAIL_ROWS + 2; // 4 板 + 4 列 + 4 条详情 + closing + 收尾
    for (let i = 0; i < total - 1; i++) monthlyScreen.tick!(env);
    expect(monthlyScreenState().playback?.closing).toBe(true);
    expect(monthlyScreenState().playing).toBe(true);
    // 收尾也是抬手才关
    monthlyScreen.up!(0, 0, env);
    expect(monthlyScreenState().playing).toBe(false);
    expect(monthlyScreen.active(env)).toBe(false);
    resetMonthlyScreen();
  });

  it('★ 在场 0 人时不起播', () => {
    const dead = fakeState([{ ...playerOf(0, 0), whoPlays: 0 }]);
    resetMonthlyScreen();
    const env = fakeEnv(dead, { nodes: [], lands: [], facilities: [] }, []);
    monthlyScreen.event!(dead, { ...dead, totalMonths: 1 }, env);
    expect(monthlyScreenState().playing).toBe(false);
    resetMonthlyScreen();
  });

  runMap('★★ 「動畫過程」关掉 → 頒獎屏整段不走，停 0x1e 拍就关屏 @source `loc_0043827e`', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP_PATH)));
    const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const base = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    resetMonthlyScreen();
    const logs: string[] = [];
    const env = { ...fakeEnv(base, topo, logs), animation: false };
    const before: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, moneyInBank: 100000 })),
    };
    const after: GameState = {
      ...before,
      totalMonths: before.totalMonths + 1,
      players: before.players.map((p) => ({
        ...p,
        moneyInBank: applyMonthlyInterest(p.moneyInBank, p.loan),
      })),
    };
    monthlyScreen.event!(before, after, env);
    expect(monthlyScreenState().playing).toBe(true);
    // 结算屏照常（原版状态 1/2 那台「月結摘要」是**不受**这个开关管辖的）
    for (let i = 0; i < 10; i++) monthlyScreen.tick!(env);
    expect(monthlyScreenState().playback?.phase).toBe('settle');

    // 抬手 → 頒獎屏入口：原版状态 2 在动画关时 `[0x48c42a] = 0x16` + 计数 0x1e
    monthlyScreen.up!(0, 0, env);
    const p = monthlyScreenState().playback;
    expect(p?.phase).toBe('award');
    expect(p?.skipTicks).toBe(MONTHLY_SKIP_TICKS);
    expect(MONTHLY_SKIP_TICKS).toBe(0x1e);
    expect(p?.closing).toBe(true); // 0x16 也是「点一下」能提前关

    // 中途不画任何頒獎屏的东西（板/列/详情/字框全都不动）
    for (let i = 0; i < MONTHLY_SKIP_TICKS - 2; i++) {
      monthlyScreen.tick!(env);
      const q = monthlyScreenState().playback!;
      expect(q.bars).toBe(0);
      expect(q.seats).toBe(0);
      expect(q.details).toBe(0);
      expect(q.encourage).toBe(false);
    }
    expect(monthlyScreenState().playing).toBe(true);
    // 数到 0 自己关屏（不用抬手）
    monthlyScreen.tick!(env);
    expect(monthlyScreenState().playing).toBe(true);
    monthlyScreen.tick!(env);
    expect(monthlyScreenState().playing).toBe(false);
    expect(monthlyScreen.active(env)).toBe(false);
    resetMonthlyScreen();
  });
});

describe('★ 頒獎屏入口：动画关那条捷径 @source 0x0043827e', () => {
  it('`monthlyAwardStart(animate)` 的两支', () => {
    expect(monthlyAwardStart(true)).toEqual({ closing: false, skipTicks: 0 });
    expect(monthlyAwardStart(false)).toEqual({
      closing: true,
      skipTicks: MONTHLY_SKIP_TICKS,
    });
  });

  it('`skipTicks > 0` 时每拍只倒数、到 0 返回 `null`（关屏）', () => {
    let p: MonthlyPlayback = {
      ...monthlyPlaybackStart(),
      phase: 'award',
      closing: true,
      skipTicks: MONTHLY_SKIP_TICKS,
    };
    const seen: number[] = [];
    for (let i = 0; i < MONTHLY_SKIP_TICKS; i++) {
      const next = monthlyPlaybackTick(p, 4);
      if (next === null) break;
      p = next;
      seen.push(p.skipTicks);
    }
    expect(seen).toEqual(
      Array.from({ length: MONTHLY_SKIP_TICKS - 1 }, (_, i) => MONTHLY_SKIP_TICKS - 1 - i),
    );
    // 最后一拍返回 `null` = 该关屏了
    expect(monthlyPlaybackTick({ ...p, skipTicks: 1 }, 4)).toBeNull();
    // 而且这一路上**一个字都没写**（bars/seats/details 全程 0）
    expect(p.bars).toBe(0);
    expect(p.details).toBe(0);
  });
});

describe('★ 頒獎屏那两张 4 行表底下那块锦缎板（图 2 @ (440,405)，2026-09-17 定案）', () => {
  it('★ 表一出来就贴图 2 在 (440,405)、**不抠黑**（原版走 `fcn_004563f5`）', () => {
    // @source 状态 7 VA 0x0043866f / 状态 0x12 VA 0x00438deb：
    //   push 0x195 / push 0x1b8 / add eax, 0x24（= 图 2）/ call fcn_004563f5
    expect(MONTHLY_TABLE_PLATE).toEqual({ chunk: 2, x: 0x1b8, y: 0x195 });
    expect(MONTHLY_TABLE_PLATE.x).toBe(440);
    expect(MONTHLY_TABLE_PLATE.y).toBe(405);
    const state = fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);
    const view = monthlySummary(state, state);
    const award = monthlyAward(state, state, { nodes: [], lands: [], facilities: [] });
    const { sprite } = fakeSpriteFn();
    const sites: { beat: string; plate: RecordedBlit | undefined }[] = [];
    for (const [beat, p] of [
      ['还没有表', { ...monthlyPlaybackStart(), phase: 'award' as const, seats: MONTHLY_SLOTS }],
      [
        '第一行详情',
        {
          ...monthlyPlaybackStart(),
          phase: 'award' as const,
          bars: MONTHLY_SLOTS,
          seats: MONTHLY_SLOTS,
          details: 1,
        },
      ],
      [
        '收尾（冠军表）',
        {
          ...monthlyPlaybackStart(),
          phase: 'award' as const,
          bars: MONTHLY_SLOTS,
          seats: MONTHLY_SLOTS,
          details: MONTHLY_DETAIL_ROWS,
          closing: true,
        },
      ],
    ] as const) {
      const { ctx, blits } = fakeCanvas();
      drawMonthlyScreen(ctx, sprite, state, { nodes: [], lands: [], facilities: [] }, view, award, p);
      sites.push({ beat, plate: blits.find((b) => b.index === 2 && b.resource === MONTHLY_RESOURCE) });
    }
    // 表还没出来时**不该**有这块板……
    expect(sites[0]!.plate).toBeUndefined();
    // ……详情一出现就贴上，位置就是锚点 (440,405)，且不抠黑
    expect(sites[1]!.plate?.x).toBe(440);
    expect(sites[1]!.plate?.y).toBe(405);
    expect(sites[1]!.plate?.keyed).toBe(false);
    // 收尾切冠军那张表时，同一块板还在
    expect(sites[2]!.plate?.x).toBe(440);
    expect(sites[2]!.plate?.y).toBe(405);
  });

  it('★ 「動畫過程」关掉那条捷径里**连这块板也不贴**（原版状态 2 → 0x16 只倒数）', () => {
    const state = fakeState([playerOf(0, 0), playerOf(1, 1), playerOf(2, 2), playerOf(3, 3)]);
    const view = monthlySummary(state, state);
    const award = monthlyAward(state, state, { nodes: [], lands: [], facilities: [] });
    const { ctx, blits } = fakeCanvas();
    const { sprite } = fakeSpriteFn();
    drawMonthlyScreen(ctx, sprite, state, { nodes: [], lands: [], facilities: [] }, view, award, {
      ...monthlyPlaybackStart(),
      phase: 'award',
      closing: true,
      skipTicks: MONTHLY_SKIP_TICKS,
    });
    expect(blits.some((b) => b.index === 2)).toBe(false);
  });
});

describe('★ 頒獎屏的角色 FLIC（D-MONTHLY-6，2026-09-16 接线）', () => {
  it('★★ 资源号 = `Data.mkf` `0x1a1 + 2×角色` @source rich4.asm:17360-17364', () => {
    // 原版：玩家 +0x13（角色号）→ `add eax, eax`（×2）→ `add eax, 0x1a1`
    expect(monthlyAwardFlicResource(0)).toBe(0x1a1);
    expect(monthlyAwardFlicResource(1)).toBe(0x1a3);
    expect(monthlyAwardFlicResource(4)).toBe(0x1a9);
    // 12 个角色都得落在 Data.mkf 的这段资源里（0x1a1..0x1b8）
    for (let c = 0; c < 12; c++) {
      const r = monthlyAwardFlicResource(c);
      expect(r).toBeGreaterThanOrEqual(0x1a1);
      expect(r).toBeLessThanOrEqual(0x1b8);
      expect(r % 2).toBe(1); // 角色那一支全是奇数号
    }
    // 负角色号不许算出越界资源（防御性）
    expect(monthlyAwardFlicResource(-3)).toBe(0x1a1);
  });

  it('★ 只有「有人获奖 + 台上铺满」才播；没人获奖或还没铺满都不画', () => {
    // 四个玩家、0 号角色 0（角色号 = `player.character`）
    const baseState = fakeState([0, 1, 2, 3].map((i) => playerOf(i, i)));
    const baseView: MonthlyView = { rows: [0, 1, 2, 3].map((i) => ({
      index: i, character: i, name: `P${i}`, cash: 0, bank: 0, interest: 0, loan: 0,
      monthlyPaid: 0, monthlyReceived: 0,
    })) };
    const baseAward: MonthlyAward = {
      winner: 0, score: 0, second: 0, richest: 0, bars: MONTHLY_BARS,
    };
    const seatsFull: MonthlyPlayback = {
      phase: 'award', revealed: 0, bars: MONTHLY_SLOTS, seats: MONTHLY_SLOTS, details: 0,
      encourage: false, closing: false, skipTicks: 0,
    };
    const calls: string[] = [];
    const fakeFlic = (archive: string, resource: number) => {
      calls.push(`${archive}:${resource}`);
      return { frames: [{} as unknown as ImageBitmap], width: 156, height: 156, frameMs: 71, close: () => {} };
    };
    const fakeCtx = { drawImage: () => undefined } as unknown as CanvasRenderingContext2D;
    // 没人获奖 → 不画、也不问影片
    expect(drawMonthlyAwardFlic(fakeCtx, fakeFlic, baseState, baseView, { ...baseAward, winner: -1 }, seatsFull, 0)).toBe(false);
    expect(calls).toHaveLength(0);
    // 还没铺满 → 不画
    expect(drawMonthlyAwardFlic(fakeCtx, fakeFlic, baseState, baseView, baseAward, { ...seatsFull, seats: 1 }, 0)).toBe(false);
    expect(calls).toHaveLength(0);
    // 铺满 + 有获奖 → 问影片并画
    expect(drawMonthlyAwardFlic(fakeCtx, fakeFlic, baseState, baseView, baseAward, seatsFull, 142)).toBe(true);
    expect(calls).toEqual(['Data.mkf:417']); // 0x1a1 = 417，角色 0
    // 影片取不到（异步还没解好）→ 不画、不炸
    expect(drawMonthlyAwardFlic(fakeCtx, () => null, baseState, baseView, baseAward, seatsFull, 0)).toBe(false);
  });

  it('★★ 每角色落点表 = 12×24 字节，值逐条照 exe dump @source 0x4759f7', () => {
    expect(MONTHLY_FLIC_OFFSETS).toHaveLength(12);
    // 第 1 行（角色 0 約翰喬）与最后一行（角色 11 大老千）逐字对
    expect(MONTHLY_FLIC_OFFSETS[0]).toEqual([-50, -94, 1539, -77, -148, 3]);
    expect(MONTHLY_FLIC_OFFSETS[1]).toEqual([-48, -97, 1027, -48, -90, 1539]);
    expect(MONTHLY_FLIC_OFFSETS[11]).toEqual([-40, -75, 1027, -40, -75, 1027]);
    // 每行 6 个 dword，前三个是冠军奖座、后三个是悲情立绘
    for (const row of MONTHLY_FLIC_OFFSETS) expect(row).toHaveLength(6);
  });

  it('★ trophy 取第 1 组、sad 取第 2 组；角色越界夹到 0..11', () => {
    // @source 状态 0x12 用 `0x4759f7/0x4759fb/0x4759ff`（第 1 组）
    expect(monthlyAwardFlicOffset(0, 'trophy')).toEqual({ x: -50, y: -94, delay: 1539 });
    // @source 状态 7 用 `0x475a03/0x475a07/0x475a0b`（第 2 组）
    expect(monthlyAwardFlicOffset(0, 'sad')).toEqual({ x: -77, y: -148, delay: 3 });
    expect(monthlyAwardFlicOffset(-5, 'trophy')).toEqual(monthlyAwardFlicOffset(0, 'trophy'));
    expect(monthlyAwardFlicOffset(99, 'sad')).toEqual(monthlyAwardFlicOffset(11, 'sad'));
  });

  it('★★ 落点 = 竖栏 x + dx、0x14a + dy（**左上角**，不再是「列心 − 影片一半」）', () => {
    // @source 0x00438d40（冠军奖座）/ 0x00438570（悲情立绘）：
    //   `x = 0x475930[在榜人数][槽] + dx[角色]`、`y = 0x14a + dy[角色]`
    const baseState = fakeState([0, 1, 2, 3].map((i) => playerOf(i, i)));
    const baseView: MonthlyView = { rows: [0, 1, 2, 3].map((i) => ({
      index: i, character: i, name: `P${i}`, cash: 0, bank: 0, interest: 0, loan: 0,
      monthlyPaid: 0, monthlyReceived: 0,
    })) };
    const baseAward: MonthlyAward = { winner: 0, score: 0, second: 0, richest: 0, bars: MONTHLY_BARS };
    const seatsFull: MonthlyPlayback = {
      phase: 'award', revealed: 0, bars: MONTHLY_SLOTS, seats: MONTHLY_SLOTS, details: 0,
      encourage: false, closing: false, skipTicks: 0,
    };
    const drawn: { x: number; y: number }[] = [];
    const ctx = {
      drawImage: (_b: unknown, x: number, y: number) => drawn.push({ x, y }),
    } as unknown as CanvasRenderingContext2D;
    const flic = () => ({
      frames: [{} as unknown as ImageBitmap], width: 156, height: 156, frameMs: 71, close: () => {},
    });

    // 收尾那一拍 → 冠军的奖座（第 1 组）：冠军 = richest = 0 → 角色 0
    drawMonthlyAwardFlic(ctx, flic, baseState, baseView, baseAward, { ...seatsFull, closing: true }, 0);
    expect(drawn[0]).toEqual({
      x: MONTHLY_AWARD_SEAT_X[4]![0]! + monthlyAwardFlicOffset(0, 'trophy').x,
      y: MONTHLY_AWARD_FLIC_DX + monthlyAwardFlicOffset(0, 'trophy').y,
    });

    // 頒獎屏那一拍 → 悲情人物的立绘（第 2 组）：winner = 1 → 角色 1
    drawn.length = 0;
    drawMonthlyAwardFlic(ctx, flic, baseState, baseView, { ...baseAward, winner: 1 }, seatsFull, 0);
    expect(drawn[0]).toEqual({
      x: MONTHLY_AWARD_SEAT_X[4]![1]! + monthlyAwardFlicOffset(1, 'sad').x,
      y: MONTHLY_AWARD_FLIC_DX + monthlyAwardFlicOffset(1, 'sad').y,
    });
  });
});

describe('★ 月結／頒獎屏的音效（D-MONTHLY-5，2026-09-16 接线）', () => {
  it('★★ 三个号是 27 / 60 / 28，不是旧条目写的「0」', () => {
    // @source `rich4.asm:41210-41230` 的三个 sound_info 结构首字节：
    //   `0x475b17 = 0x1b`(27)、`0x475b27 = 0x3c`(60)、`0x475b1f = 0x1c`(28)
    expect(MONTHLY_SOUND_STEP).toBe(27);
    expect(MONTHLY_SOUND_DETAIL).toBe(60);
    expect(MONTHLY_SOUND_CLOSE).toBe(28);
    expect(new Set([MONTHLY_SOUND_STEP, MONTHLY_SOUND_DETAIL, MONTHLY_SOUND_CLOSE]).size).toBe(3);
  });

  it('★ 结构断言：tick 里在**铺板/铺列/铺详情/收尾**四个转折点各响一声', () => {
    const src = readFileSync(new URL('./monthly-screen.ts', import.meta.url), 'utf8');
    // 不能每帧都响 —— 只在「比上一拍多」时响
    expect(src).toContain('next.bars > p.bars || next.seats > p.seats');
    expect(src).toContain('next.details > p.details');
    expect(src).toContain('next.closing && !p.closing');
    // 三个号都真的被用上
    for (const n of ['MONTHLY_SOUND_STEP', 'MONTHLY_SOUND_DETAIL', 'MONTHLY_SOUND_CLOSE']) {
      expect(src).toContain(`env.playEffect(${n})`);
    }
  });
});

describe('★ WM_KEYDOWN（0x101）也能推进結算/頒獎屏', () => {
  /*
   * @source 頒獎屏窗口过程 `fcn_00437e61`（VA 0x00437e61）的分支表：
   *   `0x202`（`WM_LBUTTONUP`）与 `0x205`（`WM_RBUTTONUP`）落到 `loc_00439b62`，
   *   `0x101`（`WM_KEYDOWN`）也**同族**（`Wait_0402_Message` 那几处一律只看消息号）。
   * ⚠️ 文档先前写「`0x101` 落到 `loc_00439b85`」—— 复核发现 `loc_00439b85`
   *   其实是 **`WM_PAINT` 那段**（`BeginPaint`/`EndPaint`），已订正。
   */
  it('★ `key` 与 `up` 走同一个出口（抬手能推进，按键也能）', () => {
    const src = readFileSync(new URL('./monthly-screen.ts', import.meta.url), 'utf8');
    const upAt = src.indexOf('  up(_x: number, _y: number, env: UiScreenEnv): void {');
    const keyAt = src.indexOf('  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {');
    expect(upAt).toBeGreaterThan(0);
    expect(keyAt).toBeGreaterThan(upAt);
    const upBody = src.slice(upAt, upAt + 200);
    const keyBody = src.slice(keyAt, keyAt + 200);
    expect(upBody).toContain('advance(env);');
    expect(keyBody).toContain('advance(env);');
    // 按键必须**消费**这一拍，否则会漏到别的熱鍵上
    expect(keyBody).toContain('return true;');
  });

  it('★ 声明了 `key` 的屏会在 main.ts 的 keydown 里**排在填数窗之前**收到', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const keyAt = src.indexOf('overlay?.key !== undefined');
    const amountAt = src.indexOf("if (amountPage !== null && screen === 'game') {");
    expect(keyAt).toBeGreaterThan(0);
    expect(amountAt).toBeGreaterThan(keyAt);
  });
});

// ============================================================
//  「本月冠軍」是首富、「本月悲情人物」才是悲情分最高者（D-MONTHLY-13）
// ============================================================

describe('★ 收尾那一句说的是**谁** @source 0x00438d04 / 0x004383a6 / 0x00438a31', () => {
  const award: MonthlyAward = {
    winner: 1, score: 900, second: 100, richest: 3, bars: MONTHLY_BARS,
  };

  it('★ 冠军 = 首富（`[0x48c430]` = `calculate_player_wealth` 最大者），不是悲情分得主', () => {
    // 先前把 `award.winner`（悲情分最高者）当成冠军写进收尾那一行 —— 两个函数弄反了
    expect(monthlyChampionOf(award)).toBe(3);
    expect(monthlyChampionOf(award)).not.toBe(award.winner);
  });

  it('★ 要安慰的是悲情分最高者（`[0x48c42f]`）；没人得悲情分则没有这一拍', () => {
    expect(monthlyConsolationWho(award)).toBe(1);
    expect(monthlyConsolationWho({ ...award, winner: -1 })).toBeNull();
  });

  it('★ 没有悲情人物时，頒獎屏不走那一拍（原版状态 2 直接跳收尾）', () => {
    let p: MonthlyPlayback = { ...monthlyPlaybackStart(), phase: 'award' };
    const seen: string[] = [];
    let guard = 0;
    while (guard++ < 40) {
      // `console = false` = 没有悲情人物
      const next = monthlyPlaybackTick(p, 4, false);
      if (next === null) break;
      p = next;
      if (p.encourage || p.closing) seen.push(`${p.encourage ? 'sad' : ''}${p.closing ? 'closing' : ''}`);
    }
    expect(seen).toEqual(['closing']);
  });

  it('★ 画面上：悲情那一拍写「本月悲情人物是…」+「別灰心，再加油喔！」，收尾写「本月冠軍是…」', () => {
    const texts: string[] = [];
    const ctx = {
      drawImage: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      fillText: (t: string) => texts.push(t),
      strokeText: () => undefined,
      beginPath: () => undefined,
      closePath: () => undefined,
      clip: () => undefined,
      rect: () => undefined,
      translate: () => undefined,
      setTransform: () => undefined,
      scale: () => undefined,
      set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
      set lineWidth(_v: number) {}, set strokeStyle(_v: string) {}, set fillStyle(_v: string) {},
      set filter(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const st = { players: [{ character: 0 }, { character: 5 }] } as never;
    const view: MonthlyView = { rows: [] } as never;
    const p: MonthlyPlayback = {
      phase: 'award', revealed: 0, bars: MONTHLY_SLOTS, seats: MONTHLY_SLOTS,
      details: MONTHLY_DETAIL_ROWS, encourage: true, closing: false, skipTicks: 0,
    };
    drawMonthlyScreen(ctx, () => null, st, {} as never, view, award, p);
    const sadText = texts.find((t) => t.startsWith(MONTHLY_TRAGIC));
    expect(sadText, '悲情那一拍要写「本月悲情人物是…」').toBeDefined();
    expect(texts).toContain(MONTHLY_NO_AWARD);
    // 悲情那张表（状态 8）—— 第 1 行只有标签、没有值
    expect(texts).toContain(MONTHLY_DETAIL_LABELS.reason);
    expect(texts).toContain(MONTHLY_DETAIL_LABELS.unluckyDays);

    texts.length = 0;
    drawMonthlyScreen(ctx, () => null, st, {} as never, view, award, { ...p, encourage: false, closing: true });
    const champText = texts.find((t) => t.startsWith(MONTHLY_CHAMPION));
    expect(champText, '收尾要写「本月冠軍是…」').toBeDefined();
    // 冠军是首富（下标 3）—— 本夹具只放两位玩家，故姓名取不到，这里只钉**不是**悲情那句
    expect(texts.some((t) => t.startsWith(MONTHLY_TRAGIC))).toBe(false);
    // ★ 收尾那一拍原版走状态 0x12：同一坐标**换成冠军那张表**（整表覆盖）
    expect(texts).toContain(MONTHLY_CHAMPION_LABELS.assets);
    expect(texts).not.toContain(MONTHLY_DETAIL_LABELS.unexpectedLoss);
  });
});
