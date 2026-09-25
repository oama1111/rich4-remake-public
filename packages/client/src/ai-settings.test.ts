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
  AI_ARROWS,
  AI_H,
  AI_LED_AT,
  AI_OPTION_ROWS,
  AI_ORIGIN,
  AI_PLATE_X,
  AI_PORTRAIT_AT,
  AI_RESOURCE,
  AI_ROW_OFF,
  AI_ROW_ON,
  AI_RATIO_STEP,
  AI_ROW_PITCH,
  AI_SEG,
  AI_SLIDERS,
  AI_TEXT,
  AI_W,
  drawAiSettings,
  aiCommitActions,
  aiInitialSelection,
  aiSettingsDown,
  aiSettingsDrag,
  aiSettingsUp,
  hitAiSettings,
  openAiSettingsModel,
  ratioFromX,
  rowFlags,
  rowMatchesPlayer,
  rowY,
  type AiSettingRow,
  type AiSettingsHit,
  type AiSettingsModel,
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

describe('ratioFromX —— (x − x0) / 8 × 10，只能取 10 的整数倍', () => {
  const r = AI_SLIDERS.cash;

  it('★ 首尾恰好 0 与 100：左端 x0、右端 x0+w', () => {
    expect(ratioFromX(r.x, r)).toBe(0);
    expect(ratioFromX(r.x + r.w, r)).toBe(100);
  });

  it('★ 只有 11 档 —— 原版没有 37% 这种值', () => {
    for (let k = 0; k <= 10; k++) {
      expect(ratioFromX(r.x + k * AI_SEG.pitch, r)).toBe(k * AI_RATIO_STEP);
      // 同一格内任意一点都给同一个值
      expect(ratioFromX(r.x + k * AI_SEG.pitch + AI_SEG.pitch - 1, r)).toBe(k * AI_RATIO_STEP);
    }
    expect(ratioFromX(r.x + 3, r)).toBe(0);
    expect(ratioFromX(r.x + 8, r)).toBe(10);
  });

  it('夹在 0..100（拖出滑槽也不越界）', () => {
    expect(ratioFromX(0, r)).toBe(0);
    expect(ratioFromX(999, r)).toBe(100);
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

  it('★ 玩家行 = 整块行底板，**开区间**（原版判的是 110 < x < 226、70+83n < y < 153+83n）', () => {
    // 底板相对放在 (8, 8)，116×83
    expect(AI_PLATE_X).toBe(8);
    expect(AI_ROW_PITCH).toBe(0x53);
    expect(hit({ x: AI_LED_AT.x + 7, y: rowY(0) + 7 })).toEqual({ kind: 'row', row: 0 });
    // 开区间的四个内角都算
    for (const [x, y] of [[9, 9], [123, 9], [9, 90], [123, 90]] as const) {
      expect({ x, y, hit: hit({ x, y }) }).toMatchObject({ hit: { kind: 'row', row: 0 } });
    }
    // @source 0x0041decd `cmp esi,0x6e / jle`、0x0041deda `cmp edi,ecx / jle`：边线本身不算
    expect(hit({ x: 8, y: 40 })).toBeNull();
    expect(hit({ x: 40, y: 8 })).toBeNull();
    expect(hit({ x: 124, y: 40 })).toBeNull();
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

  it('★ 滑槽按 x 换算成档位（首格 0、末格 100）', () => {
    expect(hit({ x: AI_SLIDERS.cash.x, y: AI_SLIDERS.cash.y + 10 })).toEqual({
      kind: 'ratio',
      row: 0,
      which: 'cash',
      value: 0,
    });
    expect(hit({ x: AI_SLIDERS.stock.x + AI_SLIDERS.stock.w - 1, y: AI_SLIDERS.stock.y + 10 })).toEqual({
      kind: 'ratio',
      row: 0,
      which: 'stock',
      value: 90,
    });
  });

  it('★ 拖动只到 90% —— 原版的拖动区两端都不含，100% 得按右箭头', () => {
    // 屏幕 rect (310,327,390,351)，判据是 x > x0 且 x < x1
    const last = AI_SLIDERS.cash.x + AI_SLIDERS.cash.w - 1;
    expect(ratioFromX(last, AI_SLIDERS.cash)).toBe(90);
    expect({ last, hit: hit({ x: last, y: AI_SLIDERS.cash.y + 10 }) }).toMatchObject({
      hit: { kind: 'ratio', value: 90 },
    });
    expect(hit({ x: AI_SLIDERS.cash.x + AI_SLIDERS.cash.w, y: AI_SLIDERS.cash.y + 10 })).toBeNull();
  });

  it('★ 滑槽两端的箭头是 ±10 的档位钮（100% 只能从这里来）', () => {
    for (const which of ['cash', 'stock'] as const) {
      const [left, right] = AI_ARROWS[which];
      expect(hit(center(left!))).toEqual({ kind: 'ratioStep', row: 0, which, delta: -10 });
      expect(hit(center(right!))).toEqual({ kind: 'ratioStep', row: 0, which, delta: 10 });
    }
    // 夹紧在两档之间：0 再减还是 0、100 再加还是 100
    const at100 = [{ ...ROWS[0]!, cashRatio: 100, stockRatio: 0 }];
    expect(applyAiSettingsHit(at100, { kind: 'ratioStep', row: 0, which: 'cash', delta: 10 })[0]!.cashRatio).toBe(100);
    expect(applyAiSettingsHit(at100, { kind: 'ratioStep', row: 0, which: 'stock', delta: -10 })[0]!.stockRatio).toBe(0);
    expect(applyAiSettingsHit(at100, { kind: 'ratioStep', row: 0, which: 'cash', delta: -10 })[0]!.cashRatio).toBe(90);
    expect(applyAiSettingsHit(at100, { kind: 'ratioStep', row: 0, which: 'stock', delta: 10 })[0]!.stockRatio).toBe(10);
  });

  it('★ 五个选项行用的是 exe 的矩形表，不是「圆点四周各扩 8」', () => {
    expect(AI_OPTION_ROWS).toHaveLength(5);
    // 全部 x ∈ [185, 281]（屏幕 287..383 减原点 102）
    for (const r of AI_OPTION_ROWS) {
      expect(r.x).toBe(185);
      expect(r.w).toBe(97);
      expect(r.h).toBe(19);
    }
    // y 依次 44/75/132/164/197（屏幕 106/137/194/226/259 减 62）
    expect(AI_OPTION_ROWS.map((r) => r.y)).toEqual([44, 75, 132, 164, 197]);
    // 每行都罩得住自己那颗圆点的中心
    AI_DOT_AT.forEach((dy, k) => {
      const r = AI_OPTION_ROWS[k]!;
      expect(dy).toBeGreaterThan(r.y);
      expect(dy).toBeLessThan(r.y + r.h);
    });
  });

  it('★ 选项与滑槽改的是**选中那一行**（`[0x48be4c]`），不是永远第一行', () => {
    const rows: AiSettingRow[] = [
      { player: 0, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
      { player: 2, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
    ];
    const p = { x: AI_SLIDERS.cash.x + 10, y: AI_SLIDERS.cash.y + 10 };
    expect(hitAiSettings(p, rows, 1)).toMatchObject({ kind: 'ratio', row: 1 });
    expect(hitAiSettings(p, rows, 0)).toMatchObject({ kind: 'ratio', row: 0 });
    expect(hitAiSettings({ x: AI_DOT_X, y: AI_DOT_AT[3] }, rows, 1)).toEqual({ kind: 'personality', row: 1, value: 1 });
    expect(hitAiSettings({ x: AI_DOT_X, y: AI_DOT_AT[0] }, rows, 1)).toEqual({ kind: 'ability', row: 1, bit: 0 });
  });

  it('对话框外 → null', () => {
    expect(hit({ x: -50, y: -50 })).toBeNull();
    expect(hit({ x: AI_W + 20, y: AI_H + 20 })).toBeNull();
    // 左侧木纹条的空白处：不在 LED、不在圆点行、不在滑槽、不在按钮
    expect(hit({ x: 60, y: 340 })).toBeNull();
    // ⚠️ (20,20) 不算「外」—— LED 就在 (8,8) 起 15×15，那里正好是 LED
    expect(hit({ x: 20, y: 20 })).toEqual({ kind: 'row', row: 0 });
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

  it('★ 相邻行的圆点间距是 32（组内一致）', () => {
    for (const group of [[0, 1], [2, 3, 4]]) {
      for (let i = 1; i < group.length; i++) {
        expect(AI_DOT_AT[group[i]!]! - AI_DOT_AT[group[i - 1]!]!).toBe(32);
      }
    }
  });

  it('★ 头像按锚点落在行底板里（先前不减锚点，于是压到右边去了）', () => {
    // 头像锚点约在图心（图 6 = 85×71 锚 (42,34)），
    // 故画在 (80, y+40) 后占 x ≈ 38..123、y ≈ y+6..y+77
    expect(AI_PORTRAIT_AT.x).toBe(0x50);
    expect(AI_PORTRAIT_AT.dy).toBe(0x28);
    const cx = AI_PORTRAIT_AT.x - 42;
    expect(cx).toBeGreaterThan(AI_PLATE_X); // 比底板左缘靠右
    expect(cx + 85).toBeLessThanOrEqual(AI_PLATE_X + 116); // 不越出底板
  });

  it('★ 比例条是「一格一格」的红色方块，不是一条连续绿条', () => {
    expect(AI_SEG.w).toBe(7);
    expect(AI_SEG.h).toBe(22);
    expect(AI_SEG.pitch).toBe(8);
    expect(AI_SEG.color).toBe('#ff0000');
    // 最后一格（第 10 格）的右缘仍在拖动区里
    expect(AI_SEG.dx + 9 * AI_SEG.pitch + AI_SEG.w).toBeLessThanOrEqual(
      AI_SLIDERS.cash.x + AI_SLIDERS.cash.w + 1,
    );
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
    const rects: { x: number; y: number; w: number; h: number }[] = [];
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
      fillRect: (x: number, y: number, w: number, h: number) => {
        rects.push({ x, y, w, h });
      },
      fillText: (t: string) => {
        texts.push(t);
      },
      strokeText: () => undefined,
      strokeRect: () => undefined,
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
    };
    return {
      ctx: ctx as unknown as CanvasRenderingContext2D,
      texts,
      rects,
      get images() {
        return images;
      },
    };
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

  it('★ 比例只画**填充**，不画数字（原版没有百分比文字，加数字属「改良」）', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, [{ ...ROWS[0]!, cashRatio: 70, stockRatio: 15 }], null, () => sprite());

    expect(f.texts.some((t) => t.includes('%'))).toBe(false);
    // ★ 格数 = [比例 / 10]：70 → 7 格，15 → 1 格（不是两条按比例的长条）
    expect(f.rects).toHaveLength(7 + 1);
    for (const r of f.rects) {
      expect({ w: r.w, h: r.h }).toEqual({ w: AI_SEG.w, h: AI_SEG.h });
    }
    // 每格的 x 依次 +8；两组的 y 各自贴着自己的滑槽
    const cash = f.rects.slice(0, 7);
    const stock = f.rects.slice(7);
    cash.forEach((r, k) => expect(r.x).toBe(AI_SEG.dx + k * AI_SEG.pitch));
    expect(cash[0]!.y).toBe(AI_SLIDERS.cash.y + AI_SEG.dy);
    expect(stock[0]!.y).toBe(AI_SLIDERS.stock.y + AI_SEG.dy);
  });

  it('★ 满档 = 10 格（不是 11 格，也不是「长度铺满」）', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, [{ ...ROWS[0]!, cashRatio: 100, stockRatio: 100 }], null, () => sprite());
    expect(f.rects).toHaveLength(20);
  });

  it('比例为 0 时不填（免得画出一条 0 宽的线）', () => {
    const f = fakeCtx();
    drawAiSettings(f.ctx, s, [{ ...ROWS[0]!, cashRatio: 0, stockRatio: 0 }], null, () => sprite());
    expect(f.rects).toHaveLength(0);
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

describe('★ gap-audit #20 / Q-LAYOUT-1 结案：图 1 / 图 2（116×86）盖的是**一位玩家那一行**，不是选项组', () => {
  // @source 入口 0x0041e61c..0x0041e62c：每位真人 `fcn_004562a5(图 2, 8, edi)`，edi 从 8 起、每行 +0x53；
  //   WM_PAINT loc_0041dbe0：`i == [0x48be4c]`（选中的那一行）才 `fcn_00456418(图 1, 0x6e, 0x46 + 0x53·i)`
  //   —— 屏幕 (0x6e, 0x46) − 对话框原点 (0x66, 0x3e) = 对话框内 (8, 8)，与图 2 同一块；整张贴，不裁。
  it('当前那一行贴图 1、其余贴图 2，都整张落在 (8, 8 + 83n)', () => {
    const draws: { res: number; index: number; x: number; y: number; n: number }[] = [];
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
      drawImage: (b: { res: number; index: number }, x: number, y: number, ...rest: number[]) => {
        draws.push({ ...b, x, y, n: rest.length });
      },
      fillRect: () => undefined,
      fillText: () => undefined,
      strokeText: () => undefined,
      strokeRect: () => undefined,
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
    } as unknown as CanvasRenderingContext2D;
    const sp = (_a: string, res: number, index: number): Sprite =>
      ({ bitmap: { res, index } as unknown as ImageBitmap, width: 116, height: 86, anchorX: 0, anchorY: 0 });
    const state = { players: [player({ index: 0 }), player({ index: 1 })], currentPlayer: 1 } as unknown as GameState;
    const rows: AiSettingRow[] = [
      { player: 0, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
      { player: 1, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
    ];
    drawAiSettings(ctx, state, rows, null, sp);
    const plates = draws.filter((d) => d.res === AI_RESOURCE && (d.index === AI_ROW_ON || d.index === AI_ROW_OFF));
    expect(plates).toEqual([
      { res: AI_RESOURCE, index: AI_ROW_OFF, x: AI_PLATE_X, y: rowY(0), n: 0 },
      { res: AI_RESOURCE, index: AI_ROW_ON, x: AI_PLATE_X, y: rowY(1), n: 0 },
    ]);
    expect([rowY(0), rowY(1)]).toEqual([8, 8 + 0x53]);
    expect(AI_ROW_PITCH).toBe(0x53);
  });
});

// ============================================================
//  pt26-input #1：原版的「先选中、再点一次才翻託管」
// ============================================================

describe('★ pt26 #1：玩家行 —— 点没选中的只选中，点已选中的才翻託管 @source loc_0041def4', () => {
  const H = WHO_PLAYS_HUMAN;
  const A = WHO_PLAYS_AUTOPILOT;
  const two = (): AiSettingRow[] => [
    { player: 0, whoPlays: H, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
    { player: 2, whoPlays: H, aiFlags: 1, personality: 2, cashRatio: 20, stockRatio: 70 },
  ];
  const model = (sel: number): AiSettingsModel => ({ rows: two(), sel, pressed: null });
  const rowPt = (n: number) => ({ x: AI_LED_AT.x + 7, y: rowY(n) + 7 });
  /** 一次完整的点：按下（命中按当时的选中行算）→ 抬手 */
  const click = (m: AiSettingsModel, p: { x: number; y: number }, editable?: (r: AiSettingRow) => boolean) => {
    const down = aiSettingsDown(m, hitAiSettings(p, m.rows, m.sel), editable);
    return aiSettingsUp(down, editable);
  };

  it('开屏选中「轮到的那位」那一行 @source 0x0041e5b3..0x0041e5be `if (i == [0x49910c]) [0x48be4c] = 行号`', () => {
    const s = { players: [player({ index: 0 }), player({ index: 1, whoPlays: WHO_PLAYS_COMPUTER }), player({ index: 2 })], currentPlayer: 2 } as unknown as GameState;
    expect(openAiSettingsModel(s, 2, 0)).toMatchObject({ sel: 1, pressed: null });
    expect(openAiSettingsModel(s, 0, 1)).toMatchObject({ sel: 0 });
  });

  it('★ 轮到的不是真人：沿用上一次的选中行（`[0x48be4c]` 不在入口的 memset 里）；越界才退回 0', () => {
    expect(aiInitialSelection(two(), 1, 1)).toBe(1);
    expect(aiInitialSelection(two(), 1, 0)).toBe(0);
    expect(aiInitialSelection(two(), 1, 5)).toBe(0);
    expect(aiInitialSelection(two(), null, 1)).toBe(1);
  });

  it('★ 单机·热座：点**没选中**的那一行 → 只选中，託管位不动', () => {
    const { model: m } = click(model(0), rowPt(1));
    expect(m.sel).toBe(1);
    expect(m.rows.map((r) => r.whoPlays)).toEqual([H, H]);
  });

  it('★ 单机·热座：点**已选中**的那一行 → 翻託管（再点一次翻回来）', () => {
    const once = click(model(1), rowPt(1)).model;
    expect(once.sel).toBe(1);
    expect(once.rows.map((r) => r.whoPlays)).toEqual([H, H | A]);
    const twice = click(once, rowPt(1)).model;
    expect(twice.rows.map((r) => r.whoPlays)).toEqual([H, H]);
  });

  it('★ 先选中、再点一次 = 原版的两下（第一下选中，第二下才翻）', () => {
    let m = model(0);
    m = click(m, rowPt(1)).model;
    expect(m.rows[1]!.whoPlays).toBe(H);
    m = click(m, rowPt(1)).model;
    expect(m.rows[1]!.whoPlays).toBe(H | A);
    // 第 0 行从头到尾没动过
    expect(m.rows[0]!.whoPlays).toBe(H);
  });

  it('★ 行上那一下在**按下**就办完（原版 0x201 那一支），抬手对它什么都不做', () => {
    const m = model(1);
    const down = aiSettingsDown(m, hitAiSettings(rowPt(1), m.rows, m.sel));
    expect(down.rows[1]!.whoPlays).toBe(H | A);
    expect(down.pressed).toEqual({ kind: 'row', row: 1 });
    const up = aiSettingsUp(down);
    expect(up.close).toBeNull();
    expect(up.model.pressed).toBeNull();
    expect(up.model.rows[1]!.whoPlays).toBe(H | A);
  });

  it('★ 选项在**抬手**才生效，且只认按下时那一颗（抬手坐标不看）@source loc_0041e0b1', () => {
    const m = model(1);
    const p = { x: AI_DOT_X, y: AI_DOT_AT[3] }; // 普通人
    const down = aiSettingsDown(m, hitAiSettings(p, m.rows, m.sel));
    expect(down.rows[1]!.personality).toBe(2); // 按下还没改
    const up = aiSettingsUp(down);
    expect(up.model.rows[1]!.personality).toBe(1); // 改的是选中那一行
    expect(up.model.rows[0]!.personality).toBe(0);
  });

  it('选项改的是选中行：切到另一行再点，改的就是那一行', () => {
    let m = click(model(1), rowPt(0)).model;
    expect(m.sel).toBe(0);
    m = click(m, { x: AI_DOT_X, y: AI_DOT_AT[0] }).model; // 使用卡片
    expect(m.rows[0]!.aiFlags).toBe(2);
    expect(m.rows[1]!.aiFlags).toBe(1);
  });

  it('滑槽按下就改、按住拖着改（`loc_0041de44` / `loc_0041de2e`），抬手不再改', () => {
    const m = model(0);
    const r = AI_SLIDERS.cash;
    const down = aiSettingsDown(m, hitAiSettings({ x: r.x + 3 * AI_SEG.pitch, y: r.y + 5 }, m.rows, m.sel));
    expect(down.rows[0]!.cashRatio).toBe(30);
    const dragged = aiSettingsDrag(down, { x: r.x + 6 * AI_SEG.pitch, y: 0 });
    expect(dragged.rows[0]!.cashRatio).toBe(60);
    const up = aiSettingsUp(dragged).model;
    expect(up.rows[0]!.cashRatio).toBe(60);
    // 松开之后再移动：不改
    expect(aiSettingsDrag(up, { x: r.x, y: r.y + 5 })).toBe(up);
  });

  it('確定 / 取消在抬手才关屏', () => {
    const m = model(0);
    const ok = aiSettingsDown(m, hitAiSettings(center(AI_BTN_OK), m.rows, m.sel));
    expect(aiSettingsUp(ok).close).toBe('ok');
    const cancel = aiSettingsDown(m, hitAiSettings(center(AI_BTN_CANCEL), m.rows, m.sel));
    expect(aiSettingsUp(cancel).close).toBe('cancel');
    // 按在空白处 → 抬手什么都不做
    const none = aiSettingsDown(m, hitAiSettings({ x: 60, y: 340 }, m.rows, m.sel));
    expect(aiSettingsUp(none)).toEqual({ model: { ...m, pressed: null }, close: null });
  });

  it('★ 联机：本机座位（2 号）那一行照原版选中 → 再点才翻；别人（0 号）那一行点得选中、翻不动、改不动', () => {
    const mine = (r: AiSettingRow) => r.player === 2;
    // 选中自己那一行，再点一次才翻
    let m = click(model(0), rowPt(1), mine).model;
    expect(m.sel).toBe(1);
    expect(m.rows[1]!.whoPlays).toBe(H);
    m = click(m, rowPt(1), mine).model;
    expect(m.rows[1]!.whoPlays).toBe(H | A);
    // 别人那一行：第一下选中（看得到他的设置）……
    m = click(m, rowPt(0), mine).model;
    expect(m.sel).toBe(0);
    // ……第二下不翻
    m = click(m, rowPt(0), mine).model;
    expect(m.rows[0]!.whoPlays).toBe(H);
    // 选项、箭头、滑槽也改不动他那一行
    m = click(m, { x: AI_DOT_X, y: AI_DOT_AT[4] }, mine).model;
    m = click(m, center(AI_ARROWS.cash[1]!), mine).model;
    const r = AI_SLIDERS.stock;
    m = click(m, { x: r.x + 2 * AI_SEG.pitch, y: r.y + 5 }, mine).model;
    expect(m.rows[0]).toEqual(two()[0]);
  });

  it('绘制：选项圆点与比例条画的是**选中那一行**（不是第一行、也不是每行叠画）', () => {
    const images: { x: number; y: number }[] = [];
    const rects: { x: number; y: number }[] = [];
    const ctx = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'top',
      save: () => undefined, restore: () => undefined, translate: () => undefined,
      drawImage: (b: { index: number }, x: number, y: number) => {
        if (b.index === 3) images.push({ x, y });
      },
      fillRect: (x: number, y: number) => rects.push({ x, y }),
      fillText: () => undefined, strokeText: () => undefined, strokeRect: () => undefined,
      measureText: (t: string) => ({ width: t.length * 14 }) as TextMetrics,
    } as unknown as CanvasRenderingContext2D;
    const sp = (_a: string, _res: number, index: number): Sprite =>
      ({ bitmap: { index } as unknown as ImageBitmap, width: 15, height: 15, anchorX: 0, anchorY: 0 });
    const state = { players: [player({ index: 0 }), player({ index: 1 }), player({ index: 2 })], currentPlayer: 0 } as unknown as GameState;
    drawAiSettings(ctx, state, two(), null, sp, 1);
    // 第 1 行：aiFlags 1（只亮「使用卡片」）+ 個性 2（大老奸）→ 两颗亮点，都在圆点列上
    const dots = images.filter((d) => d.x === AI_DOT_X - 7);
    expect(dots.map((d) => d.y + 7)).toEqual([AI_DOT_AT[0], AI_DOT_AT[4]]);
    // 比例条：現金 20 → 2 格、股票 70 → 7 格
    expect(rects).toHaveLength(2 + 7);
  });
});

describe('★ pt26 #1：確定只发变过的行；联机只发本机座位那一行', () => {
  const players = [player({ index: 0 }), player({ index: 1, whoPlays: WHO_PLAYS_COMPUTER }), player({ index: 2 })];
  const rows = (): AiSettingRow[] => [
    { player: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT, aiFlags: 3, personality: 0, cashRatio: 50, stockRatio: 30 },
    { player: 2, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 1, cashRatio: 50, stockRatio: 30 },
  ];
  it('单机：两行都变了 → 两条 setAi', () => {
    expect(aiCommitActions(rows(), players).map((a) => (a as { player: number }).player)).toEqual([0, 2]);
  });
  it('没变过的行不发', () => {
    expect(aiCommitActions(aiSettingsDraft({ players } as GameState), players)).toEqual([]);
  });
  it('★ 联机（本机 2 号座）：只发 2 号那一行', () => {
    const acts = aiCommitActions(rows(), players, (r) => r.player === 2);
    expect(acts).toEqual([
      { type: 'setAi', player: 2, whoPlays: WHO_PLAYS_HUMAN, aiFlags: 3, personality: 1, cashRatio: 50, stockRatio: 30 },
    ]);
  });
});
