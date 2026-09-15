/*
 * T-021：託管AI 屏
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@rich4/core';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN, WHO_PLAYS_MASK } from '@rich4/core';
import {
  aiSettingsDraft,
  applyAiSettingsHit,
  AI_BTN_CANCEL,
  AI_BTN_OK,
  AI_DOT_AT,
  AI_DOT_X,
  AI_H,
  AI_LED_AT,
  AI_ORIGIN,
  AI_ROW_H,
  AI_ROW_PITCH,
  AI_SLIDERS,
  AI_TEXT,
  AI_W,
  drawAiSettings,
  hitAiSettings,
  ratioFromX,
  rowFlags,
  rowMatchesPlayer,
  rowY,
  type AiSettingRow,
  type AiSettingsHit,
} from './ai-settings.ts';
import type { Sprite } from './assets.ts';

/** 只填这一屏用得到的字段 */
function player(over: Partial<GameState['players'][number]> & { index: number }): GameState['players'][number] {
  return {
    character: over.index,
    whoPlays: WHO_PLAYS_HUMAN,
    aiFlags: 3,
    personality: 0,
    cashRatio: 50,
    stockRatio: 30,
    ...over,
  } as GameState['players'][number];
}

const stateOf = (players: GameState['players'][number][]): GameState => ({ players }) as GameState;

const ROWS: AiSettingRow[] = [
  { player: 0, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
];

/** 每个矩形的中心 */
const center = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

// ============================================================
//  草稿：只列真人
// ============================================================

describe('aiSettingsDraft —— 只列真人座位', () => {
  it('★ 电脑座位不进列表（托管 = 把自己的座位交给 AI，不是调对手的 AI）', () => {
    const s = stateOf([
      player({ index: 0, whoPlays: WHO_PLAYS_HUMAN }),
      player({ index: 1, whoPlays: WHO_PLAYS_COMPUTER }),
      player({ index: 2, whoPlays: WHO_PLAYS_HUMAN }),
      player({ index: 3, whoPlays: WHO_PLAYS_COMPUTER }),
    ]);
    expect(aiSettingsDraft(s).map((r) => r.player)).toEqual([0, 2]);
  });

  it('已经托管中的真人**仍在列表里**（他是真人，只是交给 AI 了）', () => {
    const s = stateOf([player({ index: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT })]);
    const draft = aiSettingsDraft(s);
    expect(draft).toHaveLength(1);
    expect(draft[0]!.whoPlays & WHO_PLAYS_MASK).toBe(WHO_PLAYS_HUMAN);
    expect(draft[0]!.whoPlays & WHO_PLAYS_AUTOPILOT).not.toBe(0);
  });

  it('出局者不列（who_plays & 3 == 0）', () => {
    const s = stateOf([player({ index: 0, whoPlays: 0 }), player({ index: 1, whoPlays: WHO_PLAYS_HUMAN })]);
    expect(aiSettingsDraft(s).map((r) => r.player)).toEqual([1]);
  });

  it('把五个旋钮原样带过来', () => {
    const s = stateOf([player({ index: 0, aiFlags: 1, personality: 2, cashRatio: 80, stockRatio: 15 })]);
    expect(aiSettingsDraft(s)[0]).toEqual({
      player: 0,
      whoPlays: WHO_PLAYS_HUMAN,
      aiFlags: 1,
      personality: 2,
      cashRatio: 80,
      stockRatio: 15,
    });
  });

  it('rowMatchesPlayer：五项全同才算同', () => {
    const p = player({ index: 0 });
    expect(rowMatchesPlayer(ROWS[0]!, p)).toBe(true);
    expect(rowMatchesPlayer({ ...ROWS[0]!, cashRatio: 51 }, p)).toBe(false);
  });
});

// ============================================================
//  选项的亮/暗
// ============================================================

describe('rowFlags —— 五个选项各自的亮暗', () => {
  it('两个能力位各看一位；三个個性只有一个亮', () => {
    expect(rowFlags({ ...ROWS[0]!, aiFlags: 3, personality: 1 })).toEqual([true, true, false, true, false]);
    expect(rowFlags({ ...ROWS[0]!, aiFlags: 0, personality: 0 })).toEqual([false, false, true, false, false]);
    expect(rowFlags({ ...ROWS[0]!, aiFlags: 2, personality: 2 })).toEqual([false, true, false, false, true]);
  });
});

// ============================================================
//  应用命中
// ============================================================

describe('applyAiSettingsHit', () => {
  it('托管开关：真人 ↔ 真人+托管', () => {
    const on = applyAiSettingsHit(ROWS, { kind: 'autopilot', row: 0 });
    expect(on[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    const off = applyAiSettingsHit(on, { kind: 'autopilot', row: 0 });
    expect(off[0]!.whoPlays).toBe(WHO_PLAYS_HUMAN);
  });

  it('★ 托管开关**不会**把真人位抹掉（只翻 AUTOPILOT 那一位，来回都验）', () => {
    const on = applyAiSettingsHit(ROWS, { kind: 'autopilot', row: 0 })[0]!;
    expect(on.whoPlays & WHO_PLAYS_MASK).toBe(WHO_PLAYS_HUMAN);
    const off = applyAiSettingsHit([on], { kind: 'autopilot', row: 0 })[0]!;
    expect(off.whoPlays & WHO_PLAYS_MASK).toBe(WHO_PLAYS_HUMAN);
    expect(off.whoPlays).toBe(WHO_PLAYS_HUMAN);
  });

  it('能力位：bit0 会用卡、bit1 会用道具，各自独立翻', () => {
    const offCards = applyAiSettingsHit(ROWS, { kind: 'ability', row: 0, bit: 0 });
    expect(offCards[0]!.aiFlags).toBe(2);
    const bothOff = applyAiSettingsHit(offCards, { kind: 'ability', row: 0, bit: 1 });
    expect(bothOff[0]!.aiFlags).toBe(0);
    const backOn = applyAiSettingsHit(bothOff, { kind: 'ability', row: 0, bit: 0 });
    expect(backOn[0]!.aiFlags).toBe(1);
  });

  it('個性：三选一', () => {
    for (const v of [0, 1, 2]) {
      expect(applyAiSettingsHit(ROWS, { kind: 'personality', row: 0, value: v })[0]!.personality).toBe(v);
    }
  });

  it('两条比例各自独立', () => {
    const cash = applyAiSettingsHit(ROWS, { kind: 'ratio', row: 0, which: 'cash', value: 90 });
    expect(cash[0]!.cashRatio).toBe(90);
    expect(cash[0]!.stockRatio).toBe(30);
    const stock = applyAiSettingsHit(cash, { kind: 'ratio', row: 0, which: 'stock', value: 10 });
    expect(stock[0]!.stockRatio).toBe(10);
    expect(stock[0]!.cashRatio).toBe(90);
  });

  it('★ 不就地改传入的草稿', () => {
    const snapshot = JSON.parse(JSON.stringify(ROWS));
    applyAiSettingsHit(ROWS, { kind: 'personality', row: 0, value: 2 });
    applyAiSettingsHit(ROWS, { kind: 'ratio', row: 0, which: 'cash', value: 1 });
    expect(ROWS).toEqual(snapshot);
  });

  it('ok / cancel 不改草稿', () => {
    for (const kind of ['ok', 'cancel'] as const) {
      expect(applyAiSettingsHit(ROWS, { kind })[0]).toEqual(ROWS[0]);
    }
  });

  it('行号越界时原样返回（不抛）', () => {
    expect(applyAiSettingsHit(ROWS, { kind: 'personality', row: 9, value: 1 })).toEqual(ROWS);
  });
});

// ============================================================
//  比例换算
// ============================================================

describe('ratioFromX', () => {
  const r = { x: 100, w: 100 };
  it('★ 首尾两格恰好是 0 与 100（少一格就拖不出满档）', () => {
    expect(ratioFromX(100, r)).toBe(0); // 第 1 格
    expect(ratioFromX(199, r)).toBe(100); // 最后 1 格（199 = x+w-1）
    expect(ratioFromX(150, r)).toBe(51); // 中间
  });
  it('夹在 0..100（拖出滑槽也不越界）', () => {
    expect(ratioFromX(0, r)).toBe(0);
    expect(ratioFromX(999, r)).toBe(100);
  });
  it('宽度不足时不炸', () => {
    expect(ratioFromX(50, { x: 10, w: 0 })).toBe(0);
    expect(ratioFromX(50, { x: 10, w: 1 })).toBe(0);
  });
});

// ============================================================
//  命中
// ============================================================

describe('hitAiSettings', () => {
  const hit = (p: { x: number; y: number }) => hitAiSettings(p, ROWS, 0);

  it('★ 两颗按钮的中心各自命中自己', () => {
    expect(hit(center(AI_BTN_OK))).toEqual({ kind: 'ok' });
    expect(hit(center(AI_BTN_CANCEL))).toEqual({ kind: 'cancel' });
  });

  it('★ 托管 LED 命中（按行）', () => {
    expect(hit({ x: AI_LED_AT.x + 7, y: rowY(0) + 7 })).toEqual({ kind: 'autopilot', row: 0 });
  });

  it('★ 五个选项圆点各自命中（点圆点或右边文字都算）', () => {
    const want: AiSettingsHit[] = [
      { kind: 'ability', row: 0, bit: 0 },
      { kind: 'ability', row: 0, bit: 1 },
      { kind: 'personality', row: 0, value: 0 },
      { kind: 'personality', row: 0, value: 1 },
      { kind: 'personality', row: 0, value: 2 },
    ];
    AI_DOT_AT.forEach((dy, k) => {
      expect(hit({ x: AI_DOT_X, y: dy })).toEqual(want[k]);
      expect(hit({ x: AI_DOT_X + 50, y: dy })).toEqual(want[k]); // 文字那一段也算
    });
  });

  it('★ 滑槽按 x 换算成百分比（首格 0、末格 100）', () => {
    expect(hit({ x: AI_SLIDERS.cash.x, y: AI_SLIDERS.cash.y + 10 })).toEqual({
      kind: 'ratio',
      row: 0,
      which: 'cash',
      value: 0,
    });
    expect(hit({ x: AI_SLIDERS.cash.x + AI_SLIDERS.cash.w - 1, y: AI_SLIDERS.cash.y + 10 })).toEqual({
      kind: 'ratio',
      row: 0,
      which: 'cash',
      value: 100,
    });
    expect(hit({ x: AI_SLIDERS.stock.x + AI_SLIDERS.stock.w - 1, y: AI_SLIDERS.stock.y + 10 })).toEqual({
      kind: 'ratio',
      row: 0,
      which: 'stock',
      value: 100,
    });
  });

  it('★ 滑槽改的是「当前玩家」那一行，不是永远第一行', () => {
    const rows: AiSettingRow[] = [
      { player: 0, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
      { player: 2, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
    ];
    const p = { x: AI_SLIDERS.cash.x + 10, y: AI_SLIDERS.cash.y + 10 };
    expect(hitAiSettings(p, rows, 2)).toMatchObject({ kind: 'ratio', row: 1 });
    expect(hitAiSettings(p, rows, 0)).toMatchObject({ kind: 'ratio', row: 0 });
    // 当前玩家不可编辑（电脑）→ 退回第一行，不抛
    expect(hitAiSettings(p, rows, 1)).toMatchObject({ kind: 'ratio', row: 0 });
  });

  it('对话框外 → null', () => {
    expect(hit({ x: -50, y: -50 })).toBeNull();
    expect(hit({ x: AI_W + 20, y: AI_H + 20 })).toBeNull();
    // 左侧木纹条的空白处：不在 LED、不在圆点行、不在滑槽、不在按钮
    expect(hit({ x: 60, y: 340 })).toBeNull();
    // ⚠️ (20,20) 不算「外」—— LED 就在 (8,8) 起 15×15，那里正好是 LED
    expect(hit({ x: 20, y: 20 })).toEqual({ kind: 'autopilot', row: 0 });
  });

  it('★ 按钮优先于行区（不会被下面的行抢走）', () => {
    // 按钮区与行区在 x 上不重叠，这里断言的是判定顺序：先按钮
    expect(hit(center(AI_BTN_OK))!.kind).toBe('ok');
  });

  it('只有一行时，第二行的位置点不到东西', () => {
    expect(hit({ x: AI_LED_AT.x + 7, y: rowY(1) + 7 })).toBeNull();
  });
});

// ============================================================
//  摆位不变量（与项目里其它屏同一套断言）
// ============================================================

describe('摆位', () => {
  it('★ 对话框居中后完整落在 640×480 内', () => {
    expect(AI_ORIGIN.x).toBeGreaterThanOrEqual(0);
    expect(AI_ORIGIN.y).toBeGreaterThanOrEqual(0);
    expect(AI_ORIGIN.x + AI_W).toBeLessThanOrEqual(640);
    expect(AI_ORIGIN.y + AI_H).toBeLessThanOrEqual(480);
  });

  it('★ 五个圆点都在对话框内，且与文字锚点的 y 对得上（实测差 ≤2）', () => {
    // 圆点是从底图上量的、文字来自反汇编，两边独立；实测最大差 2 像素
    // （「大老奸」圆点 204 / 文字 206），故容差取 2 —— 再大就说明有一边量错了
    const textYs = [AI_TEXT.useCards.y, AI_TEXT.useTools.y, AI_TEXT.goodBoy.y, AI_TEXT.normal.y, AI_TEXT.villain.y];
    AI_DOT_AT.forEach((dy, k) => {
      expect(dy).toBeGreaterThan(0);
      expect(dy).toBeLessThan(AI_H);
      expect(Math.abs(dy - textYs[k]!)).toBeLessThanOrEqual(2);
    });
    expect(AI_DOT_X).toBeLessThan(AI_TEXT.useCards.x); // 圆点在文字左边
  });

  it('★ 相邻行的圆点间距正好是一行高，且行高一致', () => {
    for (const group of [[0, 1], [2, 3, 4]]) {
      for (let i = 1; i < group.length; i++) {
        expect(AI_DOT_AT[group[i]!]! - AI_DOT_AT[group[i - 1]!]!).toBe(AI_ROW_H);
      }
    }
  });

  it('★ 两颗按钮与两条滑槽都在对话框内且互不重叠', () => {
    const rects = [AI_BTN_OK, AI_BTN_CANCEL, AI_SLIDERS.cash, AI_SLIDERS.stock];
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(AI_W);
      expect(r.y + r.h).toBeLessThanOrEqual(AI_H);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!, b = rects[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect({ pair: `${i},${j}`, overlap }).toMatchObject({ overlap: false });
      }
    }
  });

  it('★ 滑槽落在「現金」与「存款」两个标签之间', () => {
    expect(AI_SLIDERS.cash.x).toBeGreaterThanOrEqual(AI_TEXT.cash.x);
    expect(AI_SLIDERS.cash.x + AI_SLIDERS.cash.w).toBeLessThanOrEqual(AI_TEXT.deposit.x);
    expect(AI_SLIDERS.stock.x).toBeGreaterThanOrEqual(AI_TEXT.stock.x);
    expect(AI_SLIDERS.stock.x + AI_SLIDERS.stock.w).toBeLessThanOrEqual(AI_TEXT.fund.x);
  });

  it('行距是汇编里的 0x53，首行 y 与 LED 对齐', () => {
    expect(AI_ROW_PITCH).toBe(0x53);
    expect(rowY(0)).toBe(8);
    expect(rowY(1)).toBe(91);
  });
});

// ============================================================
//  绘制（假 ctx，只查文字与调用次数）
// ============================================================

describe('drawAiSettings', () => {
  function fakeCtx() {
    const texts: string[] = [];
    let images = 0;
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      drawImage: () => {
        images++;
      },
      fillText: (t: string) => {
        texts.push(t);
      },
      strokeRect: () => undefined,
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, get images() { return images; } };
  }

  const sprite = (): Sprite => ({ bitmap: {} as ImageBitmap, width: 20, height: 20, anchorX: 0, anchorY: 0 });
  const s = stateOf([player({ index: 0 })]);

  it('★ 原版的字面写法照抄（「個 性」中间有空格）', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, ROWS, null, () => sprite());
    expect(f.texts).toContain('託管AI');
    expect(f.texts).toContain('個 性');
    expect(f.texts).toContain('資金運用比例');
    expect(f.texts).toContain('乖寶寶');
    expect(f.texts).toContain('大老奸');
    // 確定 / 取消 是**竖排**的，逐字画 —— 所以逐个字断言
    for (const ch of ['確', '定', '取', '消']) expect(f.texts).toContain(ch);
  });

  it('比例值画在滑槽上', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, [{ ...ROWS[0]!, cashRatio: 70, stockRatio: 15 }], null, () => sprite());
    expect(f.texts).toContain('70%');
    expect(f.texts).toContain('15%');
  });

  it('没有草稿（没人是真人）也画得出来', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, [], null, () => sprite());
    expect(f.texts).toContain('託管AI');
  });

  it('精灵全缺也不抛（底图没到就只剩文字）', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, ROWS, null, () => null);
    expect(f.texts).toContain('託管AI');
  });
});
