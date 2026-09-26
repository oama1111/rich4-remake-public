/*
 * 神明附身那扇**老虎机窗**（Q-GOD-1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标与判据全部照汇编抄（VA 见 `god-slot.ts` 的文件头）：
 *   机体 = `Panel#67` 图 0（四位數）/ 图 1（三位數）落 (220,320)；
 *   摇杆 = 图 2 落 x = 317/298、y = 240；拉下去换**图 3**（4 格后换回图 2）；
 *   数字 = 图 `值 + 4`（偶 = 定格、奇 = 滚动中的过渡帧）落 x 表、y = 320；
 *   底框 = `Data#517` **图 5**（棕色訊息框，`0x004407a6 add eax,0x48`）落 (220,140)：
 *   转动时只有台詞模板，停稳后**只剩** `%d元`。
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
  GOD_SLOT_DONE_STATE,
  GOD_SLOT_FILL,
  GOD_SLOT_FONT_SIZE,
  GOD_SLOT_HOLD_TICKS,
  GOD_SLOT_LEVER_DOWN_IMAGE,
  GOD_SLOT_LEVER_DOWN_TICKS,
  GOD_SLOT_LEVER_IMAGE,
  GOD_SLOT_LEVER_SOUND,
  GOD_SLOT_LEVER_X,
  GOD_SLOT_LEVER_Y,
  GOD_SLOT_OUTLINE,
  GOD_SLOT_PANEL_IMAGE,
  GOD_SLOT_PANEL_AT,
  GOD_SLOT_RESOURCE,
  GOD_SLOT_REROLL_TICKS,
  GOD_SLOT_SPIN_SOUND,
  GOD_SLOT_STOP_GEAR,
  GOD_SLOT_TICK_MS,
  drawGodSlot,
  godSlotBubbleText,
  godSlotClick,
  godSlotCue,
  godSlotDigitX,
  godSlotDigits,
  godSlotDone,
  godSlotFrame,
  godSlotLeverX,
  godSlotPanelImage,
  godSlotReelAmount,
  godSlotReelImage,
  godSlotReelStep,
  godSlotStart,
  godSlotState,
  godSlotTick,
  godSlotVariant,
  godSlotScreen,
  resetGodSlot,
  type GodSlotCue,
  type GodSlotSpin,
} from './god-slot.ts';

describe('版面与素材 @source 0x00440714 / 0x004407ec / 0x00440811 / 0x0043f08d', () => {
  it('机体 = Panel#67 图 0（四位數）/ 1（三位數），落 (220,320)', () => {
    expect(GOD_SLOT_RESOURCE).toBe(0x43);
    expect(GOD_SLOT_PANEL_IMAGE).toEqual([0, 1]);
    expect(GOD_SLOT_PANEL_AT).toEqual({ x: 220, y: 320 });
    expect(godSlotPanelImage(0)).toBe(0);
    expect(godSlotPanelImage(1)).toBe(1);
  });

  it('★ 摇杆 = 图 2（`+0x24`）落 x = 317 / 298、y = 240；拉下去 = 图 3（`+0x30`），不是图 4（那是数字 0）', () => {
    // 图号 = (偏移 − 0xc) / 12：0x24 → 2、0x30 → 3（0x00440801 / 0x0043f3ec / 0x0043f506）
    expect(GOD_SLOT_LEVER_IMAGE).toBe((0x24 - 0xc) / 12);
    expect(GOD_SLOT_LEVER_DOWN_IMAGE).toBe((0x30 - 0xc) / 12);
    expect(GOD_SLOT_LEVER_DOWN_IMAGE).not.toBe(godSlotReelImage(0));
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

  it('★ 底框 = Data#517 图 5（棕色訊息框，`add eax,0x48` ⇒ (0x48−0xc)/12）落 (220,140)；字级 0x10、内文 0xf0f0f0、描边 0x101010', () => {
    // 2026-09-23 需求方：「神明那个对话框……原版用的是棕色那个」—— 先前误作图 6（player_say 的红云朵）
    expect(GOD_SLOT_BUBBLE).toEqual({ archive: 'Data.mkf', resource: 517, image: 5 });
    expect(GOD_SLOT_BUBBLE_AT).toEqual({ x: 220, y: 140 });
    expect(GOD_SLOT_FONT_SIZE).toBe(0x10);
    expect(GOD_SLOT_FILL).toBe('#f0f0f0');
    expect(GOD_SLOT_OUTLINE).toBe('#101010');
  });

  it('音效与节拍：循环 51、拉杆 1；一格 30 ms、每 10 格重掷、40 格拉杆、拉下 4 格、档 8 停、停后 40 格收', () => {
    expect(GOD_SLOT_SPIN_SOUND).toBe(51);
    expect(GOD_SLOT_LEVER_SOUND).toBe(1);
    expect(GOD_SLOT_TICK_MS).toBe(0x1e);
    expect(GOD_SLOT_REROLL_TICKS).toBe(10);
    expect(GOD_SLOT_AUTO_TICKS).toBe(0x28);
    expect(GOD_SLOT_LEVER_DOWN_TICKS).toBe(4);
    expect(GOD_SLOT_STOP_GEAR).toBe(8);
    expect(GOD_SLOT_HOLD_TICKS).toBe(0x28);
    expect(GOD_SLOT_DONE_STATE).toBe(10);
  });

  it('★ variant = (arg & 1) ^ 1，四个 arg 一一对上 @source 0x004407c0', () => {
    expect(GOD_SLOT_ARG).toEqual({ 1: 0, 2: 1, 5: 4, 6: 5 });
    expect(godSlotVariant(0)).toBe(1); // 小財神 → 三位數
    expect(godSlotVariant(1)).toBe(0); // 大財神 → 四位數
    expect(godSlotVariant(4)).toBe(1); // 小窮神 → 三位數
    expect(godSlotVariant(5)).toBe(0); // 大窮神 → 四位數
  });

  it('★ 转轮值 → 图号 = 值 + 4（偶 = 定格、奇 = 过渡帧）@source 0x0043f093', () => {
    expect(GOD_SLOT_DIGIT_FIRST).toBe(4);
    expect(godSlotReelImage(0)).toBe(4); // 数字 0
    expect(godSlotReelImage(18)).toBe(22); // 数字 9
    expect(godSlotReelImage(19)).toBe(23); // 9→0 的过渡帧
  });

  it('金額 → 每位数字（三位數机体不含千位）；转轮拼数 @source 0x0043f630..0x0043f685', () => {
    expect(godSlotDigits(3370, 0)).toEqual([3, 3, 7, 0]);
    expect(godSlotDigits(3370, 1)).toEqual([0, 3, 7, 0]);
    expect(godSlotDigits(7, 0)).toEqual([0, 0, 0, 7]);
    expect(godSlotReelAmount([6, 6, 14, 0], 0)).toBe(3370);
    // 三位數：`test ebp,ebp / jne` 跳过千位 —— 槽 0 是什么都不算
    expect(godSlotReelAmount([18, 6, 14, 0], 1)).toBe(370);
  });
});

// ============================================================
//  这一趟该演什么（金额 = core 交出来的 `lastGodPower.amount`）
// ============================================================

interface Mini {
  cash: number;
  bank: number;
}

/**
 * `before → after` 这一对。
 *
 * ★★ FU-5（2026-09-25）：金额不再是「钱 / 存款 / 公库的差额」，而是 core 在附身那一刻
 *   掷出来、记进 `GameState.lastGodPower` 的那一个（原版窗口里显示的就是它）。
 *   `amountHint` 给了才写一条**新的**提示（引用不相等 = 本 action 新写的）；
 *   不给就是「这条 action 没写新提示」。
 */
function stateOf(
  players: Mini[],
  godType: number,
  host = 0,
  pool = 0,
  prevGod = 0,
  godHandle = 1,
  amountHint?: number,
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
    lastGodPower: null,
  } as unknown as GameState;
  const after = {
    ...before,
    players: players.map((p, i) => mk(p, i === host ? godHandle : 0)),
    lastGodPower:
      amountHint === undefined ? null : { player: host, type: godType, amount: amountHint },
  } as unknown as GameState;
  void prevGod;
  return { before, after };
}

describe('★★ FU-5：金额直接读 core 的 `lastGodPower.amount`（0x43f68c 那一半）', () => {
  it('1 小財神：读提示里的数，三位數机体', () => {
    const { before, after } = stateOf(
      [
        { cash: 100, bank: 0 },
        { cash: 400, bank: 0 },
        { cash: 400, bank: 0 },
      ],
      1,
      0,
      0,
      0,
      1,
      300,
    );
    const cue = godSlotCue(before, after);
    expect(cue).not.toBeNull();
    expect(cue!.godType).toBe(1);
    expect(cue!.arg).toBe(0);
    expect(cue!.variant).toBe(1);
    expect(cue!.amount).toBe(300);
    expect(cue!.text).toBe('小財神附身\n\n向所有對手收...');
  });

  it('2 大財神：四位數机体', () => {
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2, 0, 0, 0, 1, 5099);
    const cue = godSlotCue(before, after);
    expect(cue!.variant).toBe(0);
    expect(cue!.amount).toBe(5099);
    expect(cue!.text).toBe('大財神附身\n\n送您...');
  });

  it('5 小窮神：三位數机体', () => {
    const { before, after } = stateOf(
      [
        { cash: 100, bank: 0 },
        { cash: 100, bank: 10 },
      ],
      5,
      0,
      0,
      0,
      1,
      250,
    );
    const cue = godSlotCue(before, after);
    expect(cue!.variant).toBe(1);
    expect(cue!.amount).toBe(250);
    expect(cue!.text).toBe('小窮神附身\n\n付給每個人...');
  });

  it('6 大窮神：四位數机体', () => {
    const { before, after } = stateOf([{ cash: 900, bank: 0 }], 6, 0, 0, 0, 1, 1234);
    const cue = godSlotCue(before, after);
    expect(cue!.variant).toBe(0);
    expect(cue!.amount).toBe(1234);
    expect(cue!.text).toBe('大窮神附身\n\n損失...');
  });

  it('★★ 金额**不**从金钱差额反推 —— 差额与提示不一致时按提示走', () => {
    // 小財神：对手实际只少了 300（`pay_money` 截断过），而掷出来的数是 700
    const { before, after } = stateOf(
      [
        { cash: 100, bank: 0 },
        { cash: 400, bank: 0 },
      ],
      1,
      0,
      0,
      0,
      1,
      700,
    );
    after.players[1]!.cash = 100; // 差额只有 300
    expect(godSlotCue(before, after)!.amount).toBe(700);

    // 大窮神：公库这一条 action 里另外还被别的事加过（差额 334），提示是 1234
    const g6 = stateOf([{ cash: 900, bank: 0 }], 6, 0, 900, 0, 1, 1234);
    g6.after.pool = 1234;
    expect(godSlotCue(g6.before, g6.after)!.amount).toBe(1234);
  });

  it('★ 这条 action 没写新提示（引用相等 / 缺字段）⇒ 不开窗', () => {
    const none = stateOf([{ cash: 100, bank: 0 }], 2);
    expect(godSlotCue(none.before, none.after)).toBeNull();
    // 同一份提示（引用相等）也不算「本 action 新写的」
    const stale = stateOf([{ cash: 100, bank: 0 }], 2, 0, 0, 0, 1, 900);
    const same = { ...stale.after, lastGodPower: stale.after.lastGodPower } as GameState;
    expect(godSlotCue(stale.after, same)).toBeNull();
    // 提示给的是别人 / 别种神 ⇒ 也不认
    const other = stateOf([{ cash: 100, bank: 0 }], 2, 0, 0, 0, 1, 900);
    other.after.lastGodPower = { player: 1, type: 2, amount: 900 };
    expect(godSlotCue(other.before, other.after)).toBeNull();
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

});

// ============================================================
//  状态机（逐格照抄 fcn_0043f23e / fcn_0043ef3e）
// ============================================================

function cueOf(amount: number, variant: number, human = false): GodSlotCue {
  return {
    godType: variant === 0 ? 2 : 1,
    arg: variant === 0 ? 1 : 0,
    variant,
    amount,
    host: 0,
    text: variant === 0 ? '大財神附身\n\n送您...' : '小財神附身\n\n向所有對手收...',
    human,
  };
}

/** 一格一格跑完，记下每一格的样子 */
function runAll(cue: GodSlotCue, clickAt: number | null = null): GodSlotSpin[] {
  let s = godSlotStart(cue, 0);
  const frames: GodSlotSpin[] = [];
  for (let i = 0; i < 2000 && !godSlotDone(s); i++) {
    if (clickAt !== null && i === clickAt) s = godSlotClick(s);
    s = godSlotFrame(s).spin;
    frames.push(s);
  }
  return frames;
}

describe('★ 转轮一步 `fcn_0043ef3e`（VA 0x0043ef3e）', () => {
  it('n = 0：mask 里的槽各 +1（mod 20）；三位數机体（variant 1）不碰槽 0', () => {
    expect(godSlotReelStep(0, [1, 3, 5, 19], [0, 0, 0], 0xf, 0).reels).toEqual([2, 4, 6, 0]);
    expect(godSlotReelStep(1, [1, 3, 5, 19], [0, 0, 0], 0xf, 0).reels).toEqual([1, 4, 6, 0]);
    // mask bit0 = 槽 3、bit3 = 槽 0
    expect(godSlotReelStep(0, [1, 1, 1, 1], [0, 0, 0], 0xe, 0).reels).toEqual([2, 2, 2, 1]);
    expect(godSlotReelStep(0, [1, 1, 1, 1], [0, 0, 0], 8, 0).reels).toEqual([2, 1, 1, 1]);
  });

  it('★ n = 1 停**个位**（槽 3）：偶数时不起步；奇数起步后再走 7 格停在偶数上，档 8 才返回 1', () => {
    // 偶数：不起步、照常走
    let r = godSlotReelStep(0, [0, 0, 0, 4], [0, 0, 0], 0xf, 1);
    expect(r.gear).toEqual([0, 0, 0]);
    expect(r.reels[3]).toBe(5);
    // 奇数：起步
    let reels = r.reels;
    let gear = r.gear;
    const seq: number[] = [];
    let frames = 0;
    for (;;) {
      r = godSlotReelStep(0, reels, gear, 0xf, 1);
      reels = r.reels;
      gear = r.gear;
      frames++;
      seq.push(reels[3]!);
      if (r.stopped) break;
    }
    expect(reels[3]).toBe((5 + 7) % 20);
    expect(reels[3]! % 2).toBe(0);
    // 档 1..7 各走一格、每档停 档 格：1 + (2+3+…+7) + 最后升到 8 那一格 = 29 格
    expect(frames).toBe(29);
    expect(gear).toEqual([0, 0, 1]);
    // 同一格里其余三槽照转
    expect(seq.length).toBe(29);
  });
});

describe('★ 状态机：滚 → 拉杆（图 3，4 格）→ 个位/十位/百位/千位逐槽停 → 只剩「%d元」→ 40 格收屏', () => {
  it('电脑：第 40 格拉杆（音效 1），之前每 10 格重掷一次（重掷值都是奇数）', () => {
    let s = godSlotStart(cueOf(3370, 0), 0);
    const pulledAt: number[] = [];
    for (let i = 1; i <= 45; i++) {
      const r = godSlotFrame(s);
      s = r.spin;
      if (r.events.pulled) pulledAt.push(i);
      if (i <= 39) expect(s.state, `第 ${i} 格`).toBe(1);
    }
    expect(pulledAt).toEqual([40]);
    // 重掷在计数 0/10/20/30 那四格；拉杆那一格判重掷时计数还是 39（`0x0043f2ff inc` 在判断之后）
    expect(s.rerolls).toBe(4);
  });

  it('★ 拉下去的摇杆（图 3）只停 4 格，然后换回图 2 进状态 4', () => {
    const frames = runAll(cueOf(3370, 0));
    const down = frames.map((f, i) => (f.leverDown ? i + 1 : 0)).filter((i) => i > 0);
    expect(down).toEqual([40, 41, 42, 43]);
    expect(frames[43]!.state).toBe(4);
    expect(frames[43]!.leverDown).toBe(false);
  });

  it('★ 停槽顺序：个位 → 十位 → 百位 → 千位（四位數）；三位數从状态 6 直接跳 8', () => {
    for (const variant of [0, 1]) {
      const frames = runAll(cueOf(variant === 0 ? 4821 : 821, variant));
      const states = frames.map((f) => f.state);
      const firstOf = (st: number): number => states.indexOf(st);
      expect(firstOf(5)).toBeGreaterThan(firstOf(4));
      expect(firstOf(6)).toBeGreaterThan(firstOf(5));
      if (variant === 0) {
        expect(firstOf(7)).toBeGreaterThan(firstOf(6));
        expect(firstOf(8)).toBeGreaterThan(firstOf(7));
      } else {
        expect(states).not.toContain(7);
      }
      // 状态 5 起个位不再动、状态 6 起十位不再动
      const s5 = frames[firstOf(5)]!;
      const s6 = frames[firstOf(6)]!;
      expect(frames.slice(firstOf(5)).every((f) => f.reels[3] === s5.reels[3])).toBe(true);
      expect(frames.slice(firstOf(6)).every((f) => f.reels[2] === s6.reels[2])).toBe(true);
    }
  });

  it('★ 停下来的四个转轮 = core 给的金额（各种金额 × 各种拉杆时机都对得上）', () => {
    const amounts0 = [0, 7, 90, 1000, 2013, 3370, 5099, 9999];
    const amounts1 = [0, 5, 60, 250, 300, 821, 999];
    for (const [variant, amounts] of [
      [0, amounts0],
      [1, amounts1],
    ] as const) {
      for (const amount of amounts) {
        for (const clickAt of [null, 0, 1, 5, 9, 10, 11, 23, 38]) {
          const frames = runAll(cueOf(amount, variant, true), clickAt);
          const last = frames[frames.length - 1]!;
          expect(godSlotDone(last)).toBe(true);
          expect(godSlotReelAmount(last.reels, variant), `${amount} / 点击 ${clickAt}`).toBe(amount);
          for (let slot = 3; slot >= variant; slot--) expect(last.reels[slot]! % 2).toBe(0);
        }
      }
    }
  });

  it('★ 停稳那一格（状态 8）之后再过 40 格才收屏（点击不能提前关）', () => {
    const frames = runAll(cueOf(999, 1, true));
    const landed = frames.findIndex((f) => f.state === 9);
    expect(frames.length - 1 - landed).toBe(GOD_SLOT_HOLD_TICKS);
    const hold = frames[landed + 5]!;
    expect(godSlotClick(hold)).toBe(hold);
  });

  it('★ 真人的点击只在状态 1 有用：推到状态 2，下一格拉杆', () => {
    let s = godSlotStart(cueOf(999, 1, true), 0);
    s = godSlotFrame(s).spin;
    s = godSlotClick(s);
    expect(s.state).toBe(2);
    const r = godSlotFrame(s);
    expect(r.events.pulled).toBe(true);
    expect(r.spin.state).toBe(3);
    // 电脑点了不算
    const ai = godSlotFrame(godSlotStart(cueOf(999, 1, false), 0)).spin;
    expect(godSlotClick(ai)).toBe(ai);
  });

  it('★ 气泡的字：转动时只有台詞模板（没有数字）；停稳后**只剩**「999元」@source 0x0043f618 / 0x0043f694', () => {
    expect(GOD_ATTACH.amount.text).toBe('%d元');
    const frames = runAll(cueOf(999, 1));
    const landed = frames.findIndex((f) => f.state === 9);
    for (const f of frames.slice(0, landed)) {
      expect(godSlotBubbleText(f)).toBe('小財神附身\n\n向所有對手收...');
    }
    for (const f of frames.slice(landed)) expect(godSlotBubbleText(f)).toBe('999元');
  });

  it('godSlotTick：没到点原样返回；到点走一格、下一格 +30 ms', () => {
    const s = godSlotStart(cueOf(999, 1), 1000);
    expect(s.at).toBe(1000);
    expect(godSlotTick(s, 999).spin).toBe(s);
    const r = godSlotTick(s, 1000);
    expect(r.spin.counter).toBe(1);
    expect(r.spin.at).toBe(1000 + GOD_SLOT_TICK_MS);
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
    // 字效 3 的阴影那一遍（第二色 #101010，`font.ts` 的 `drawGdiText`）不记 —— 只记正文
    fillText(this: { fillStyle: unknown }, t: string) {
      if (String(this.fillStyle) !== '#101010') texts.push(t);
    },
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
  const spinOf = (cue: GodSlotCue, over: Partial<GodSlotSpin> = {}): GodSlotSpin => ({
    ...godSlotStart(cue, 0),
    ...over,
  });

  it('四位數机体：图 0 落 (220,320)、摇杆图 2 落 (317,240)、四格数字落 x 表', () => {
    const { ctx, images, texts } = fakeCtx();
    drawGodSlot(ctx, fakeSprite, spinOf(cueOf(3370, 0), { reels: [0, 0, 2, 4] }));
    const panel = images.find((i) => i.index === 0 && i.resource === GOD_SLOT_RESOURCE);
    expect(panel).toMatchObject({ x: 220, y: 320 });
    const lever = images.find((i) => i.index === GOD_SLOT_LEVER_IMAGE);
    expect(lever).toMatchObject({ x: 317, y: 240 });
    const digits = images.filter((i) => i.index >= GOD_SLOT_DIGIT_FIRST && i.y === GOD_SLOT_DIGIT_Y);
    // 原版从槽 3 倒着贴到槽 0
    expect(digits.map((d) => d.x)).toEqual([256, 219, 182, 145]);
    expect(digits.map((d) => d.index)).toEqual([8, 6, 4, 4]);
    const bubble = images.find((i) => i.resource === GOD_SLOT_BUBBLE.resource);
    expect(bubble).toMatchObject({ x: 220, y: 140 });
    // 转动中：台詞两行，没有数字
    expect(texts).toEqual(['大財神附身', '送您...']);
  });

  it('三位數机体：图 1、摇杆 298、只画 3 格（槽 0 不画）', () => {
    const { ctx, images } = fakeCtx();
    drawGodSlot(ctx, fakeSprite, spinOf(cueOf(370, 1), { reels: [5, 4, 6, 8] }));
    expect(images.some((i) => i.index === 1 && i.resource === GOD_SLOT_RESOURCE)).toBe(true);
    expect(images.some((i) => i.index === GOD_SLOT_LEVER_IMAGE && i.x === 298)).toBe(true);
    const digits = images.filter((i) => i.index >= GOD_SLOT_DIGIT_FIRST && i.y === GOD_SLOT_DIGIT_Y);
    expect(digits.map((d) => d.x)).toEqual([237, 200, 163]);
  });

  it('★ 第十四份試玩回報：整趟演出里摇杆那一点**从不**贴数字图（先前拉杆后叠图 4 = 「0」）', () => {
    for (const variant of [0, 1]) {
      const lx = godSlotLeverX(variant);
      for (const f of runAll(cueOf(variant === 0 ? 1234 : 999, variant))) {
        const { ctx, images } = fakeCtx();
        drawGodSlot(ctx, fakeSprite, f);
        const atLever = images.filter((i) => i.resource === GOD_SLOT_RESOURCE && i.x === lx);
        expect(atLever.map((i) => i.index)).toEqual([f.leverDown ? GOD_SLOT_LEVER_DOWN_IMAGE : GOD_SLOT_LEVER_IMAGE]);
      }
    }
  });

  it('★ 停稳之后气泡里只有一行「999元」', () => {
    const frames = runAll(cueOf(999, 1));
    const { ctx, texts } = fakeCtx();
    drawGodSlot(ctx, fakeSprite, frames[frames.length - 1]!);
    expect(texts).toEqual(['999元']);
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

  it('★ 大財神附身 → 起播循环音 51（0x004408b2 起、0x004408bf 停、0x0043f2ab 再起 ⇒ 转动全程在响）', () => {
    resetGodSlot();
    const { env, effects, stops } = mkEnv();
    // ★ FU-5 起：金额由 core 的 `lastGodPower` 交出来（本用例只关心屏幕行为）
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2, 0, 0, 0, 1, 1000);
    after.players[0]!.cash = 1100;
    godSlotScreen.event?.(before, after, env);
    // ★ 2026-09-22（第十一份試玩回報 #6）：`event()` 现在只**记下** cue，要等
    //   `tick()` 那一拍（且起播闸开着）才真的起播 —— 原版次序是「影片 → 文案 → 老虎机」。
    //   闸默认是 null（`gated()` 为假），所以这里补一次 tick 即可。
    godSlotScreen.tick?.(env);
    expect(godSlotState().playing).toBe(true);
    expect(effects).toEqual([GOD_SLOT_SPIN_SOUND]);
    expect(stops).toEqual([]);
    expect(godSlotScreen.active(env)).toBe(true);
    // 跑到底：拉杆响 1、停稳才停 51、收屏
    let now = 0;
    for (let i = 0; i < 1000 && godSlotState().playing; i++) {
      now += GOD_SLOT_TICK_MS;
      (env as { now: number }).now = now;
      godSlotScreen.tick?.(env);
    }
    expect(godSlotState().playing).toBe(false);
    expect(effects).toEqual([GOD_SLOT_SPIN_SOUND, GOD_SLOT_LEVER_SOUND]);
    expect(stops[0]).toBe(GOD_SLOT_SPIN_SOUND);
    resetGodSlot();
  });
});

describe('★ 联机旁观：跟着行动者收场（`fastForward`）', () => {
  it('★ 在转 ⇒ 关窗并停掉 51', () => {
    resetGodSlot();
    const { env, stops } = mkEnv();
    // ★ FU-5 起：金额由 core 的 `lastGodPower` 交出来（本用例只关心屏幕行为）
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2, 0, 0, 0, 1, 1000);
    after.players[0]!.cash = 1100;
    godSlotScreen.event?.(before, after, env);
    godSlotScreen.tick?.(env);
    expect(godSlotState().playing).toBe(true);
    stops.length = 0;
    expect(godSlotScreen.fastForward!(env)).toBe(true);
    expect(godSlotScreen.active(env)).toBe(false);
    expect(stops).toEqual([GOD_SLOT_SPIN_SOUND]);
  });

  it('★ 还在等附身影片收场（`pendingCue`）的那一局也作废 —— 之后闸开了也不再起播', () => {
    resetGodSlot();
    const { env } = mkEnv();
    // ★ FU-5 起：金额由 core 的 `lastGodPower` 交出来（本用例只关心屏幕行为）
    const { before, after } = stateOf([{ cash: 100, bank: 0 }], 2, 0, 0, 0, 1, 1000);
    after.players[0]!.cash = 1100;
    godSlotScreen.event?.(before, after, env);
    expect(godSlotScreen.active(env)).toBe(true); // 押着，没起播
    expect(godSlotState().playing).toBe(false);
    expect(godSlotScreen.fastForward!(env)).toBe(true);
    expect(godSlotScreen.active(env)).toBe(false);
    godSlotScreen.tick?.(env);
    expect(godSlotState().playing).toBe(false);
  });

  it('没在演 ⇒ false', () => {
    resetGodSlot();
    expect(godSlotScreen.fastForward!(mkEnv().env)).toBe(false);
  });
});
