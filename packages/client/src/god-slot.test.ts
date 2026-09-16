/*
 * 神明附身那扇**老虎机窗**（Q-GOD-1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编抄（VA 见 `god-slot.ts` 的文件头）：
 *   机体 = `Panel#67` 图 0（四位數）/ 图 1（三位數）落 (220,320)；
 *   摇杆 = 图 2 落 x = 317/298、y = 240；拉下去叠图 4；
 *   数字 = 图 `值 + 4`（偶 = 定格、奇 = 滚动中的过渡帧）落 x 表、y = 320；
 *   气泡 = `Data#517` 图 6 落 (220,140)，台詞正中，金额填在中间那个空行。
 */
import { describe, expect, it } from 'vitest';
import { GOD_ATTACH } from '@rich4/data';
import type { GameState } from '@rich4/core';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';
import {
  GOD_SLOT_ARG,
  GOD_SLOT_AUTO_TICKS,
  GOD_SLOT_BUBBLE,
  GOD_SLOT_BUBBLE_AT,
  GOD_SLOT_DIGIT_FIRST,
  GOD_SLOT_DIGIT_X,
  GOD_SLOT_DIGIT_Y,
  GOD_SLOT_FILL,
  GOD_SLOT_FONT_SIZE,
  GOD_SLOT_HOLD_MS,
  GOD_SLOT_KNOB_IMAGE,
  GOD_SLOT_LEVER_IMAGE,
  GOD_SLOT_LEVER_SOUND,
  GOD_SLOT_LEVER_X,
  GOD_SLOT_LEVER_Y,
  GOD_SLOT_PANEL_IMAGE,
  GOD_SLOT_PANEL_AT,
  GOD_SLOT_RESOURCE,
  GOD_SLOT_REROLL_TICKS,
  GOD_SLOT_SETTLE_TICKS,
  GOD_SLOT_SPIN_SOUND,
  GOD_SLOT_TICK_MS,
  drawGodSlot,
  godSlotBubbleText,
  godSlotClick,
  godSlotCue,
  godSlotCurrentAmount,
  godSlotDigitImage,
  godSlotDigitX,
  godSlotDigits,
  godSlotDone,
  godSlotLeverX,
  godSlotPanelImage,
  godSlotRollImage,
  godSlotSlotDigit,
  godSlotSlotRolling,
  godSlotStart,
  godSlotState,
  godSlotTick,
  godSlotVariant,
  godSlotScreen,
  resetGodSlot,
} from './god-slot.ts';

describe('版面与素材 @source 0x004407a0 / 0x004407d0 / 0x004407f3 / loc_0043f073', () => {
  it('机体 = Panel#67 图 0（四位數）/ 1（三位數），落 (220,320)', () => {
    expect(GOD_SLOT_RESOURCE).toBe(0x43);
    expect(GOD_SLOT_PANEL_IMAGE).toEqual([0, 1]);
    expect(GOD_SLOT_PANEL_AT).toEqual({ x: 220, y: 320 });
    expect(godSlotPanelImage(0)).toBe(0);
    expect(godSlotPanelImage(1)).toBe(1);
  });

  it('摇杆 = 图 2 落 x = 317 / 298、y = 240；拉杆圆头 = 图 4', () => {
    expect(GOD_SLOT_LEVER_IMAGE).toBe(2);
    expect(GOD_SLOT_KNOB_IMAGE).toBe(4);
    expect(GOD_SLOT_LEVER_X).toEqual([317, 298]);
    expect(GOD_SLOT_LEVER_Y).toBe(240);
    expect(godSlotLeverX(0)).toBe(317);
    expect(godSlotLeverX(1)).toBe(298);
  });

  it('数字 x 表 0x475ce8：四位 [145,182,219,256]、三位 [0,163,200,237]，y = 320', () => {
    expect(GOD_SLOT_DIGIT_X[0]).toEqual([145, 182, 219, 256]);
    expect(GOD_SLOT_DIGIT_X[1]).toEqual([0, 163, 200, 237]);
    expect(GOD_SLOT_DIGIT_Y).toBe(320);
    expect(godSlotDigitX(0, 3)).toBe(256);
    expect(godSlotDigitX(1, 0)).toBe(0); // 三位數机体槽 0 不画
  });

  it('气泡 = Data#517 图 6 落 (220,140)；字级 0x10、内文 0xf0f0f0', () => {
    expect(GOD_SLOT_BUBBLE).toEqual({ archive: 'Data.mkf', resource: 517, image: 6 });
    expect(GOD_SLOT_BUBBLE_AT).toEqual({ x: 220, y: 140 });
    expect(GOD_SLOT_FONT_SIZE).toBe(0x10);
    expect(GOD_SLOT_FILL).toBe('#f0f0f0');
  });

  it('音效：循环 51、拉杆那一下 1；一格 30 ms、每 10 格重掷、40 格自动拉杆', () => {
    expect(GOD_SLOT_SPIN_SOUND).toBe(51);
    expect(GOD_SLOT_LEVER_SOUND).toBe(1);
    expect(GOD_SLOT_TICK_MS).toBe(0x1e);
    expect(GOD_SLOT_REROLL_TICKS).toBe(10);
    expect(GOD_SLOT_AUTO_TICKS).toBe(0x28);
    expect(GOD_SLOT_SETTLE_TICKS).toBe(4);
  });

  it('★ variant = (arg & 1) ^ 1，四个 arg 一一对上 @source 0x004407c7', () => {
    expect(GOD_SLOT_ARG).toEqual({ 1: 0, 2: 1, 5: 4, 6: 5 });
    expect(godSlotVariant(0)).toBe(1); // 小財神 → 三位數
    expect(godSlotVariant(1)).toBe(0); // 大財神 → 四位數
    expect(godSlotVariant(4)).toBe(1); // 小窮神 → 三位數
    expect(godSlotVariant(5)).toBe(0); // 大窮神 → 四位數
  });

  it('★ 数字图号：定格 = 2d+4、滚动 = 2d+5 @source loc_0043f073', () => {
    expect(GOD_SLOT_DIGIT_FIRST).toBe(4);
    expect(godSlotDigitImage(0)).toBe(4);
    expect(godSlotDigitImage(1)).toBe(6);
    expect(godSlotDigitImage(9)).toBe(22);
    expect(godSlotRollImage(0)).toBe(5);
    expect(godSlotRollImage(9)).toBe(23);
  });

  it('金額 → 每位数字（三位數机体不含千位）', () => {
    expect(godSlotDigits(3370, 0)).toEqual([3, 3, 7, 0]);
    expect(godSlotDigits(3370, 1)).toEqual([0, 3, 7, 0]);
    expect(godSlotDigits(7, 0)).toEqual([0, 0, 0, 7]);
    expect(godSlotDigits(0, 1)).toEqual([0, 0, 0, 0]);
  });
});

// ============================================================
//  这一趟该演什么（从金钱差额反推）
// ============================================================

interface Mini {
  cash: number;
  bank: number;
}

function stateOf(
  players: Mini[],
  godType: number,
  host = 0,
  pool = 0,
  prevGod = 0,
  godHandle = 1,
): { before: GameState; after: GameState } {
  const mk = (p: Mini, god: number): unknown => ({
    cash: p.cash,
    moneyInBank: p.bank,
    godInfo: god,
    whoPlays: 2,
    blocking: { sleepWalking: 0 },
  });
  const before = {
    currentPlayer: host,
    pool,
    players: players.map((p) => mk(p, 0)),
    objects: [{ type: godType, nodeId: 3, attached: 0, state: 0 }],
  } as unknown as GameState;
  const after = {
    ...before,
    players: players.map((p, i) => mk(p, i === host ? godHandle : 0)),
  } as unknown as GameState;
  void prevGod;
  return { before, after };
}

describe('★ 反推这一趟：金额从金钱差额来、不重掷随机数', () => {
  it('1 小財神：对手的现金减少额（三位數机体）', () => {
    const { before, after } = stateOf(
      [
        { cash: 100, bank: 0 },
        { cash: 400, bank: 0 },
        { cash: 400, bank: 0 },
      ],
      1,
    );
    after.players[1]!.cash = 100; // 付了 300
    const cue = godSlotCue(before, after);
    expect(cue).not.toBeNull();
    expect(cue!.godType).toBe(1);
    expect(cue!.arg).toBe(0);
    expect(cue!.variant).toBe(1);
    expect(cue!.amount).toBe(300);
    expect(cue!.text).toBe('小財神附身\n\n向所有對手收...');
  });

  it('2 大財神：附身者的现金增加额（四位數机体）', () => {
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2);
    after.players[0]!.cash = 5199;
    const cue = godSlotCue(before, after);
    expect(cue!.variant).toBe(0);
    expect(cue!.amount).toBe(5099);
    expect(cue!.text).toBe('大財神附身\n\n送您...');
  });

  it('5 小窮神：对手的**存款**增加额', () => {
    const { before, after } = stateOf(
      [
        { cash: 100, bank: 0 },
        { cash: 100, bank: 10 },
      ],
      5,
    );
    after.players[1]!.moneyInBank = 260;
    const cue = godSlotCue(before, after);
    expect(cue!.variant).toBe(1);
    expect(cue!.amount).toBe(250);
    expect(cue!.text).toBe('小窮神附身\n\n付給每個人...');
  });

  it('6 大窮神：公库增加额（四位數机体）', () => {
    const { before, after } = stateOf([{ cash: 900, bank: 0 }], 6, 0, 0);
    after.pool = 1234;
    const cue = godSlotCue(before, after);
    expect(cue!.variant).toBe(0);
    expect(cue!.amount).toBe(1234);
    expect(cue!.text).toBe('大窮神附身\n\n損失...');
  });

  it('★ 不是那四种金額型（福神/衰神/死神）→ 不开这扇窗', () => {
    for (const type of [3, 4, 7, 8, 9, 10, 12, 15]) {
      const { before, after } = stateOf([{ cash: 100, bank: 0 }], type);
      expect(godSlotCue(before, after), `种类 ${type}`).toBeNull();
    }
  });

  it('没换神（godInfo 没变）→ 不开窗', () => {
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2);
    after.players[0]!.godInfo = 0;
    expect(godSlotCue(before, after)).toBeNull();
  });

  it('★ 金额填进模板中间那个空行 @source 0x0043f6b6', () => {
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2);
    after.players[0]!.cash = 1100;
    const cue = godSlotCue(before, after)!;
    expect(GOD_ATTACH.amount.text).toBe('%d元');
    expect(godSlotBubbleText(cue, 1000)).toBe('大財神附身\n1000元\n送您...');
  });
});

// ============================================================
//  演出（每格 30 ms）
// ============================================================

describe('★ 状态机：滚 → 拉杆 → 逐槽停 → 停一会儿', () => {
  const cue = {
    godType: 2,
    arg: 1,
    variant: 0,
    amount: 3370,
    host: 0,
    text: '大財神附身\n\n送您...',
    human: true,
  };

  it('开演：tick 0、没拉杆、没停', () => {
    const s = godSlotStart(cue, 1000);
    expect(s.tick).toBe(0);
    expect(s.pulled).toBe(false);
    expect(s.settled).toBe(0);
    expect(s.at).toBe(1000 + GOD_SLOT_TICK_MS);
    expect(godSlotDone(s, 1000)).toBe(false);
  });

  it('前 40 格只滚不拉杆；第 40 格起拉杆', () => {
    let s = godSlotStart(cue, 0);
    let now = 0;
    for (let i = 0; i < GOD_SLOT_AUTO_TICKS - 1; i++) {
      now += GOD_SLOT_TICK_MS;
      s = godSlotTick(s, now);
    }
    expect(s.pulled).toBe(false);
    now += GOD_SLOT_TICK_MS;
    s = godSlotTick(s, now);
    expect(s.pulled).toBe(true);
  });

  it('★ 拉杆之后逐槽停：每 4 格停一槽，第 16 格全停', () => {
    let s = godSlotStart(cue, 0);
    let now = 0;
    const advance = () => {
      now += GOD_SLOT_TICK_MS;
      s = godSlotTick(s, now);
    };
    while (s.tick < GOD_SLOT_AUTO_TICKS) advance();
    expect(s.settled).toBe(0);
    // 拉杆那一格只拉杆不停槽；之后每 SETTLE_TICKS 格停一槽
    const seen: number[] = [];
    for (let i = 1; i <= 4 * GOD_SLOT_SETTLE_TICKS; i++) {
      advance();
      seen.push(s.settled);
    }
    expect(seen).toEqual([0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4]);
    expect(s.settled).toBe(4);
    expect(s.landedAt).not.toBeNull();
  });

  it('★ 停稳之后停 HOLD_MS 才收屏', () => {
    let s = godSlotStart(cue, 0);
    let now = 0;
    while (s.landedAt === null) {
      now += GOD_SLOT_TICK_MS;
      s = godSlotTick(s, now);
    }
    const landedAt = s.landedAt!;
    expect(godSlotDone(s, landedAt + GOD_SLOT_HOLD_MS - 1)).toBe(false);
    expect(godSlotDone(s, landedAt + GOD_SLOT_HOLD_MS)).toBe(true);
  });

  it('★ 真人点一下 = 立刻拉杆停稳；再点一下 = 收屏', () => {
    const s = godSlotStart(cue, 0);
    const clicked = godSlotClick(s, 500);
    expect(clicked.pulled).toBe(true);
    expect(clicked.settled).toBe(4);
    expect(clicked.landedAt).toBe(500);
    expect(godSlotDone(clicked, 500)).toBe(false);
    const again = godSlotClick(clicked, 600);
    expect(godSlotDone(again, 600 + GOD_SLOT_HOLD_MS)).toBe(true);
  });

  it('停稳的槽给定格值、没停的槽给滚动值', () => {
    const s = { ...godSlotStart(cue, 0), settled: 2, tick: 5 };
    expect(godSlotSlotRolling(s, 0)).toBe(false);
    expect(godSlotSlotRolling(s, 2)).toBe(true);
    expect(godSlotSlotDigit(s, 0)).toBe(3); // 3370 的千位
    expect(godSlotSlotDigit(s, 1)).toBe(3);
    expect(godSlotSlotDigit(s, 2)).toBe((5 + 2 * 3) % 10);
  });

  it('这一帧拼出来的金额：全停 = 目标金额', () => {
    const s = { ...godSlotStart(cue, 0), settled: 4 };
    expect(godSlotCurrentAmount(s)).toBe(3370);
    expect(godSlotCurrentAmount({ ...s, cue: { ...cue, variant: 1, amount: 370 } })).toBe(370);
  });
});

// ============================================================
//  绘制
// ============================================================

interface Drawn {
  archive: string;
  resource: number;
  index: number;
  x: number;
  y: number;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; images: Drawn[]; texts: string[] } {
  const images: Drawn[] = [];
  const texts: string[] = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    drawImage: (b: Drawn, x: number, y: number) => {
      images.push({ archive: b.archive, resource: b.resource, index: b.index, x, y });
    },
    fillText: (t: string) => texts.push(t),
    strokeText: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images, texts };
}

/** 假 sprite：锚点 0，图号原样回传 */
const fakeSprite = ((archive: string, resource: number, index: number): Sprite =>
  ({
    bitmap: { archive, resource, index } as unknown as ImageBitmap,
    width: 38,
    height: 36,
    anchorX: 0,
    anchorY: 0,
  }) as Sprite) as unknown as Parameters<typeof drawGodSlot>[1];

describe('★ 绘制：机体/摇杆/数字/气泡的落点', () => {
  const cue = {
    godType: 2,
    arg: 1,
    variant: 0,
    amount: 3370,
    host: 0,
    text: '大財神附身\n\n送您...',
    human: true,
  };

  it('四位數机体：图 0 落 (220,320)、摇杆图 2 落 (317,240)、四格数字落 x 表', () => {
    const { ctx, images, texts } = fakeCtx();
    drawGodSlot(ctx, fakeSprite, {
      cue,
      amount: 3370,
      digitImages: [4, 4, 6, 8],
      pulled: false,
    });
    const panel = images.find((i) => i.index === 0 && i.resource === GOD_SLOT_RESOURCE);
    expect(panel).toMatchObject({ x: 220, y: 320 });
    const lever = images.find((i) => i.index === GOD_SLOT_LEVER_IMAGE);
    expect(lever).toMatchObject({ x: 317, y: 240 });
    const digits = images.filter((i) => i.index >= GOD_SLOT_DIGIT_FIRST && i.y === GOD_SLOT_DIGIT_Y);
    expect(digits.map((d) => d.x)).toEqual([145, 182, 219, 256]);
    expect(digits.map((d) => d.index)).toEqual([4, 4, 6, 8]);
    const bubble = images.find((i) => i.resource === GOD_SLOT_BUBBLE.resource);
    expect(bubble).toMatchObject({ x: 220, y: 140 });
    expect(texts.join('|')).toContain('3370元');
  });

  it('三位數机体：图 1、摇杆 298、只画 3 格（槽 0 的 x = 0 不画）', () => {
    const { ctx, images } = fakeCtx();
    drawGodSlot(ctx, fakeSprite, {
      cue: { ...cue, variant: 1, arg: 0, amount: 370 },
      amount: 370,
      digitImages: [5, 4, 6, 8],
      pulled: false,
    });
    expect(images.some((i) => i.index === 1 && i.resource === GOD_SLOT_RESOURCE)).toBe(true);
    expect(images.some((i) => i.index === GOD_SLOT_LEVER_IMAGE && i.x === 298)).toBe(true);
    const digits = images.filter((i) => i.index >= GOD_SLOT_DIGIT_FIRST && i.y === GOD_SLOT_DIGIT_Y);
    expect(digits.map((d) => d.x)).toEqual([163, 200, 237]);
  });

  it('拉杆拉下去时叠的是圆头图 4（不是图 2）', () => {
    const { ctx, images } = fakeCtx();
    drawGodSlot(ctx, fakeSprite, {
      cue,
      amount: 0,
      digitImages: [4, 4, 4, 4],
      pulled: true,
    });
    expect(images.some((i) => i.index === GOD_SLOT_KNOB_IMAGE)).toBe(true);
    expect(images.some((i) => i.index === GOD_SLOT_LEVER_IMAGE)).toBe(false);
  });
});

// ============================================================
//  屏幕本体（登记与整屏出口）
// ============================================================

function mkEnv(now = 0): { env: UiScreenEnv; effects: number[]; stops: number[] } {
  const effects: number[] = [];
  const stops: number[] = [];
  const env = {
    now,
    state: {} as GameState,
    topo: {} as UiScreenEnv['topo'],
    stage: {} as CanvasRenderingContext2D,
    sprite: (() => null) as unknown as UiScreenEnv['sprite'],
    requestRender: () => undefined,
    playEffect: (id: number) => effects.push(id),
    stopEffect: (id: number) => stops.push(id),
    log: () => undefined,
    dispatch: () => undefined,
    animation: true,
  } as unknown as UiScreenEnv;
  return { env, effects, stops };
}

describe('★ 屏幕本体', () => {
  it('登记为浮窗（原版存下 (0,0x28)-(0x1b8,0x1e0) 那块再贴回）', () => {
    expect(godSlotScreen.windowed).toBe(true);
    expect(godSlotScreen.id).toBe('god-slot');
  });

  it('没在演的时候 active() 为假', () => {
    resetGodSlot();
    const { env } = mkEnv();
    expect(godSlotScreen.active(env)).toBe(false);
    expect(godSlotState().playing).toBe(false);
  });

  it('★ 大財神附身 → 起播、放一次循环音 51 并立刻停掉（原版那一手照抄）', () => {
    resetGodSlot();
    const { env, effects, stops } = mkEnv();
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2);
    after.players[0]!.cash = 1100;
    godSlotScreen.event?.(before, after, env);
    expect(godSlotState().playing).toBe(true);
    expect(godSlotState().amount).toBe(1000);
    expect(effects).toEqual([GOD_SLOT_SPIN_SOUND]);
    expect(stops).toEqual([GOD_SLOT_SPIN_SOUND]);
    expect(godSlotScreen.active(env)).toBe(true);
    resetGodSlot();
  });
});
