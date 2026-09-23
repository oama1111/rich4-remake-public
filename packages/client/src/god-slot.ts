/*
 * 神明附身那一刻的**老虎机窗**（Q-GOD-1）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ C-ARC-2：本模块只算「画在哪、这一帧显示几」「什么时候自己收屏」，
 *   **一分钱都不动** —— 钱的去向在 `@rich4/core` 的 `rules/god-power.ts`
 *   （Q-GOD-2 已接）；这里只把 core 已经做完的那件事**画出来**。
 *
 * ## 出处（`fcn_00440706` = VA 0x00440706 开窗；`fcn_0043f23e` = VA 0x0043f23e 状态机）
 *
 * ```asm
 * ; ── 开窗
 * 00440706  read_mkf(Panel.mkf, 0x43) → [0x48c514]          ; ★ 老虎机素材 = Panel **#67**
 * 0044071d  create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)
 * 0044073e  fcn_00451e7e(rect (0,0x28)-(0x1b8,0x1e0))        ; ★ 浮窗：先存下这块
 * 004407a0  fcn_00456418(surface, Data#517 图 6, 0xdc, 0x8c) ; 气泡 = Data#517 图 6 落 (220,140)
 * 004407c7  ebx = (arg & 1) ^ 1
 * 004407d0  fcn_004563f5(surface, Panel#67 图 ebx, 0xdc, 0x140)
 *                    ; ★ 机体：图 0 = 四位數（193×183）、图 1 = 三位數（156×183），落 (220,320)
 * 004407f3  fcn_00456418(surface, Panel#67 图 2, [0x475ce0+ebx*4], 0xf0)
 *                    ; ★ 摇杆 = 图 2（31×108）落 x = **317**（ebx 0）/ **298**（ebx 1）、y = 240
 * 00440830..00440866  sprintf(buf, 四種模板[arg], _rich4_god_names[arg])
 * 00440873  draw_text(buf, 0xdc, 0x8c, flag 4)               ; 台詞画在气泡里（正中）
 * 004408a0  play_sound_effect(flags=1, &0x475d3c)            ; 音效 **51**（起循环）
 * 004408b2  fcn_004542e9(&0x475d3c)                          ; ★ 紧接着就**停**（听感上是静音）
 * 004408bc  ebx = fcn_0043f23e(ebx)                          ; ★ 9 状态机 → 返回值 = 金額
 * 004408e3  fcn_00454240(&0x475d3c)                          ; 释放
 * 004408f9  fcn_00451edb([0x48c51c], 0, 0x28)                ; 贴回浮窗
 * ```
 *
 * ## 状态机（`fcn_0043f23e`，每格 **0x1e = 30 ms**，`cmp ebx,0x1e / jb`）
 *
 * | 状态 | 干什么 | @source |
 * |---|---|---|
 * | 1 | `fcn_0043ef3e(variant, 0xf, 0)` —— 四位一起滚 | `loc_0043f33f` |
 * | 2 | 同上 + 画**拉杆**（`fcn_00456418(Panel#67 图 4)` 落在摇杆那一点）+ 音效 **1**（`0x482322`）→ 状态 3、计数清零 | `loc_0043f351` |
 * | 3 | 滚；计数到 **4** 才往下 | `loc_0043f45d` |
 * | 4..7 | **逐槽停**：`fcn_0043ef3e(variant, 0xf, 1)` → `(0xe, 2)` → `(0xc, 3)` → `(8, 4)`，每次都等它返回 1（= 那一槽停稳）再进下一状态 | `loc_0043f55f` / `0x43f57f` / `0x43f59f` / `0x43f5bd` |
 * | 8 | 停循环音（`fcn_004542e9`）→ 状态 9 | `loc_0043f5dd` |
 * | 9 | 收尾：把四个数字拼成 `c4*1000+c5*100+c6*10+c7` 当返回值 | `loc_0043f6fa` |
 *
 * 每格还会：`[0x48c504+i]` 每格 **+1**（`cmp ch,0x14 / jb`，0..19 循环）；
 * 状态 < 3 时每 **10** 格重掷一次 `rand()%10*2+1`（`loc_0043f2d7`）；
 * 真人（`whoPlays == 1` 且非夢遊）在**状态 1** 按一下（`0x202`/`0x205`/`0x101`）
 * 就把状态推到 2（`loc_0043f752`），计数到 **0x28 = 40** 格也会自动推 —— 与转盘同一套。
 *
 * ## 数字怎么画（`fcn_0043ef3e` = VA 0x0043ef3e）
 *
 * - 机体上那 4/3 格数字是**图**：`Panel#67 图 (值 + 4)`，38×36，**不透明**贴
 *   （`loc_0043f073` 的 `fcn_004563f5`）；
 * - 值 = `[0x48c504+槽]`：**偶数 = 定格的那一位**（`2d` → 图 `2d+4`），
 *   **奇数 = 滚动中的过渡帧**（图 5/7/9… 上半是 d、下半是 d+1，逐张看过）；
 * - 落点：`x = [0x475ce8 + variant*8 + 槽*2]`（word 表）、`y = 0x140 = 320`。
 *   四位盤 x = **145 / 182 / 219 / 256**、三位盤 x = **0 / 163 / 200 / 237**（槽 0 不用）；
 * - 每帧还会把**气泡与金额**重画一遍：`sprintf("%d元", 当前值)` 落 (220,140) ——
 *   正好盖在模板第二行**那个空行**上（`%s附身\n\n向所有對手收...`），这就是那个空行的用处。
 *
 * ## 与本引擎的接线
 *
 * 本屏**没有待決交互**：core 在附身那一刻就把钱/卡结算完了（`applyGodPowerOnAttach`），
 * 本屏只是 `event(before, after)` 里 diff 出「刚附身 + 是那四种金額型」，把**已经发生**
 * 的那笔钱用老虎机演出来（金額从**金钱差额**反推）。所以：
 * - **不掷随机数**（C-DET-4）：core 已经掷过那四个数字了，这里再掷会把随机数流错开；
 * - 滚动节奏取固定值（原版每槽停在哪一格取决于真人点击时机，见 D-003 同类处置）。
 */

import { GOD_ATTACH, formatOriginal, godNameOf } from '@rich4/data';
import {
  WHO_PLAYS_HUMAN,
  WHO_PLAYS_MASK,
  type GameState,
} from '@rich4/core';
import { FONT_FAMILY } from './font.ts';
import type { ArchiveName, Sprite } from './assets.ts';
import type { UiScreen, UiScreenEnv, UiKeyEvent } from './ui-screen.ts';

/** 取图（与 `main.ts` 的 `spriteNow` 同一个签名）*/
export type SlotSprite = (
  archive: ArchiveName,
  resource: number,
  index: number,
  colorKeyBlack?: boolean,
) => Sprite | null;

// ============================================================
//  素材与版面（全部照 exe）
// ============================================================

/** 老虎机素材在 `Panel.mkf` 的**资源号** @source 0x004407a0 `push 0x43` */
export const GOD_SLOT_ARCHIVE = 'Panel.mkf' as const;
export const GOD_SLOT_RESOURCE = 0x43;

/**
 * 气泡：`Data.mkf` 资源 **0x205 = 517 图 6**，落 (220,140) @source 0x004407a0
 * （与转盘那一屏同一个气泡图）。
 */
export const GOD_SLOT_BUBBLE = { archive: 'Data.mkf' as const, resource: 0x205, image: 6 };
export const GOD_SLOT_BUBBLE_AT = { x: 0xdc, y: 0x8c } as const;

/** 字级 0x10、内文 `0xf0f0f0`、阴影 `0x101010` @source 0x0044071d `rich4_create_font` */
export const GOD_SLOT_FONT_SIZE = 0x10;
export const GOD_SLOT_FILL = '#f0f0f0';
export const GOD_SLOT_SHADOW = '#101010';

/** 台詞与金额都落 (220,140) flag 4（正中）@source 0x00440873 / 0x0043f6b6 */
export const GOD_SLOT_TEXT_AT = { x: 0xdc, y: 0x8c } as const;

/** 机体落点 (220,320) @source 0x004407d0（`push 0x140 / push 0xdc`）*/
export const GOD_SLOT_PANEL_AT = { x: 0xdc, y: 0x140 } as const;

/**
 * 机体图号：`(arg & 1) ^ 1`
 * - 0 = 193×183（**四位數**：小財神/大窮神那一支的 `arg` 是偶数 → 图 1？见下表）
 * - 1 = 156×183（**三位數**）
 *
 * | 神 | `arg` | `ebx` | 机体 | 金額位數 |
 * |---|---|---|---|---|
 * | 1 小財神 | 0 | 1 | 三位數 | 三位 |
 * | 2 大財神 | 1 | 0 | 四位數 | 四位 |
 * | 5 小窮神 | 4 | 1 | 三位數 | 三位 |
 * | 6 大窮神 | 5 | 0 | 四位數 | 四位 |
 */
export const GOD_SLOT_PANEL_IMAGE = [0, 1] as const;

/** 摇杆 = `Panel#67` 图 **2**（31×108），落 (x, 0xf0)；x 见表 @source 0x004407f3 */
export const GOD_SLOT_LEVER_IMAGE = 2;
/** 拉下去时叠在上面的圆头 = 图 **4**（38×36）@source 0x0043f3b8 那一支 */
export const GOD_SLOT_KNOB_IMAGE = 4;
/** 摇杆 x：`[0x475ce0]` = 317（四位數机体）/ `[0x475ce4]` = 298（三位數）*/
export const GOD_SLOT_LEVER_X = [0x13d, 0x12a] as const;
export const GOD_SLOT_LEVER_Y = 0xf0;

/** 数字图 = 图 `(值 + 4)`，38×36 @source loc_0043f073 */
export const GOD_SLOT_DIGIT_FIRST = 4;
/** 数字的 y（exe 里固定 0x140）@source loc_0043efb7 `mov dword [esp+4], 0x140` */
export const GOD_SLOT_DIGIT_Y = 0x140;
/**
 * 每一槽的 x —— 表 `0x475ce8`（word）：
 * 四位盤 `[145, 182, 219, 256]`、三位盤 `[0, 163, 200, 237]`（槽 0 = 0 ⇒ 不画）。
 * 槽号 = 十进制位：槽 0 = 千/百位、槽 3 = 个位。
 */
export const GOD_SLOT_DIGIT_X: readonly (readonly number[])[] = [
  [0x91, 0xb6, 0xdb, 0x100],
  [0, 0xa3, 0xc8, 0xed],
];

/** 循环音 = `Effect.mkf` **51** @source `0x475d3c` 第一格 dword */
export const GOD_SLOT_SPIN_SOUND = 51;
/** 拉杆那一下的一次性音 = **1** @source `0x482322`（与转盘落地同一颗）*/
export const GOD_SLOT_LEVER_SOUND = 1;
/** 一格 = 0x1e = 30 ms @source `loc_0043f709` 的 `cmp ebx,0x1e / jb` */
export const GOD_SLOT_TICK_MS = 0x1e;
/** 状态 < 3 时每 10 格重掷一次数字 @source loc_0043f2d7 的 `div 0xa` */
export const GOD_SLOT_REROLL_TICKS = 10;
/** 真人不动手时，计数到 0x28 = 40 格自动推进到「拉杆」@source loc_0043f318 */
export const GOD_SLOT_AUTO_TICKS = 0x28;
/** 每一槽停稳要几格（原版 state 3 的 `cmp [esp+0xb0], 4`）@source loc_0043f45d */
export const GOD_SLOT_SETTLE_TICKS = 4;
/** 全停之后停留多久才收屏（本引擎的收尾时长；原版靠「再点一下」）*/
export const GOD_SLOT_HOLD_MS = 1000;

/** 四种 `arg` —— 跳表 `0x4406ee` 的四个分支（其余神明不开这扇窗）*/
export const GOD_SLOT_ARG: Readonly<Record<number, number>> = { 1: 0, 2: 1, 5: 4, 6: 5 };

/** `arg` → 机体/摇杆的 variant `ebx = (arg & 1) ^ 1` @source 0x004407c7 */
export function godSlotVariant(arg: number): number {
  return (arg & 1) ^ 1;
}

/** 机体图号 */
export function godSlotPanelImage(variant: number): number {
  return GOD_SLOT_PANEL_IMAGE[variant] ?? 0;
}

/** 摇杆 x */
export function godSlotLeverX(variant: number): number {
  return GOD_SLOT_LEVER_X[variant] ?? GOD_SLOT_LEVER_X[0]!;
}

/** 这一槽画在哪（槽 0 在三位數机体上是 0 ⇒ 不画）*/
export function godSlotDigitX(variant: number, slot: number): number {
  return GOD_SLOT_DIGIT_X[variant]?.[slot] ?? 0;
}

/** 定格的那一位画哪张图：值 = `2d` → 图 `2d + 4` @source loc_0043f073 */
export function godSlotDigitImage(digit: number): number {
  return GOD_SLOT_DIGIT_FIRST + digit * 2;
}

/** 滚动中的过渡帧：值 = `2d+1` → 图 `2d + 5`（上半 d、下半 d+1）*/
export function godSlotRollImage(digit: number): number {
  return GOD_SLOT_DIGIT_FIRST + digit * 2 + 1;
}

/** 金額 → 每槽的十进制位（槽 0 = 最高位；三位數机体槽 0 不画）*/
export function godSlotDigits(amount: number, variant: number): number[] {
  const n = Math.max(0, Math.trunc(amount));
  const s = String(n).padStart(4, '0').slice(-4);
  const all = [Number(s[0]), Number(s[1]), Number(s[2]), Number(s[3])];
  // 三位數机体：千位那一槽不画（原版表里槽 0 的 x = 0）
  return variant === 1 ? [0, all[1]!, all[2]!, all[3]!] : all;
}

// ============================================================
//  这一趟该演什么（纯查 before / after）
// ============================================================

export interface GodSlotCue {
  /** 神明种类（1..15）*/
  godType: number;
  /** 跳表参数 0/1/4/5 */
  arg: number;
  /** `(arg & 1) ^ 1` —— 0 四位數机体 / 1 三位數机体 */
  variant: number;
  /** 这一趟的金额（从金钱差额反推，见文件头）*/
  amount: number;
  /** 附身的那位（玩家下标）*/
  host: number;
  /** 写进气泡的台詞（`%s` 已换成神明名）*/
  text: string;
  /** 附身的是不是真人（只有真人的点击能推状态机）*/
  human: boolean;
}

/**
 * 刚刚是不是「四种金額型的神明附身」？是的话把这一趟要演的东西解出来。
 *
 * 金额**从金钱差额反推**（不重掷随机数）：
 * - 1 小財神：取第一个对手的**现金**减少额；
 * - 2 大財神：附身者的**现金**增加额；
 * - 5 小窮神：第一个对手的**存款**增加额；
 * - 6 大窮神：**公库**增加额。
 *
 * ⚠️ 破产被截断时反推出来的是**实付额**（与屏幕上该显示的一致）。
 */
export function godSlotCue(before: GameState, after: GameState): GodSlotCue | null {
  const host = after.currentPlayer;
  const was = before.players[host];
  const now = after.players[host];
  if (was === undefined || now === undefined) return null;
  if (now.godInfo === 0 || now.godInfo === was.godInfo) return null;
  const god = after.objects[now.godInfo - 1];
  if (god === undefined) return null;
  const arg = GOD_SLOT_ARG[god.type];
  if (arg === undefined) return null;

  let amount = 0;
  switch (god.type) {
    case 1: {
      for (let i = 0; i < before.players.length && amount === 0; i++) {
        if (i === host) continue;
        amount = Math.max(0, (before.players[i]?.cash ?? 0) - (after.players[i]?.cash ?? 0));
      }
      break;
    }
    case 2:
      amount = Math.max(0, now.cash - was.cash);
      break;
    case 5: {
      for (let i = 0; i < before.players.length && amount === 0; i++) {
        if (i === host) continue;
        amount = Math.max(
          0,
          (after.players[i]?.moneyInBank ?? 0) - (before.players[i]?.moneyInBank ?? 0),
        );
      }
      break;
    }
    case 6:
      amount = Math.max(0, after.pool - before.pool);
      break;
    default:
      return null;
  }

  const fmt =
    god.type === 1
      ? GOD_ATTACH.collect.text
      : god.type === 2
        ? GOD_ATTACH.give.text
        : god.type === 5
          ? GOD_ATTACH.payAll.text
          : GOD_ATTACH.loss.text;
  return {
    godType: god.type,
    arg,
    variant: godSlotVariant(arg),
    amount,
    host,
    text: formatOriginal(fmt, godNameOf(god.type)),
    human: (now.whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN && now.blocking.sleepWalking === 0,
  };
}

/** 气泡里那一整段（模板 + 金额填进中间那个空行）*/
export function godSlotBubbleText(cue: GodSlotCue, amount: number): string {
  return cue.text.replace('\n\n', `\n${formatOriginal(GOD_ATTACH.amount.text, amount)}\n`);
}

// ============================================================
//  演出（30 ms 一格；滚 → 逐槽停 → 停一会儿）
// ============================================================

export interface GodSlotSpin {
  cue: GodSlotCue;
  /** 已经演到第几格（30 ms 一格）*/
  tick: number;
  /** 下一格的时间点 */
  at: number;
  /** 已经停稳的槽数（0..3）*/
  settled: number;
  /** 拉杆拉下去了吗（状态 2 之后）*/
  pulled: boolean;
  /** 停稳的时刻；`null` = 还在演 */
  landedAt: number | null;
}

/** 开演 */
export function godSlotStart(cue: GodSlotCue, now: number): GodSlotSpin {
  return { cue, tick: 0, at: now + GOD_SLOT_TICK_MS, settled: 0, pulled: false, landedAt: null };
}

/** 这一格该显示哪一位（槽 `slot`）：停稳的槽给定格值，其余给滚动值 */
export function godSlotSlotDigit(spin: GodSlotSpin, slot: number): number {
  const target = godSlotDigits(spin.cue.amount, spin.cue.variant)[slot] ?? 0;
  if (slot < spin.settled) return target;
  // 滚动：每格换一个数字（取「值」的十进制位，画的时候再折成过渡帧）
  return (spin.tick + slot * 3) % 10;
}

/** 这一格要不要画成「滚动中的过渡帧」 */
export function godSlotSlotRolling(spin: GodSlotSpin, slot: number): boolean {
  return slot >= spin.settled;
}

/** 进一格；到点没到就原样返回（与转盘 `wheelSpinTick` 同一套）*/
export function godSlotTick(spin: GodSlotSpin, now: number): GodSlotSpin {
  if (spin.landedAt !== null) {
    if (now - spin.landedAt < GOD_SLOT_HOLD_MS) return spin;
    return { ...spin, at: now };
  }
  if (now < spin.at) return spin;
  const tick = spin.tick + 1;
  if (tick < GOD_SLOT_AUTO_TICKS) return { ...spin, tick, at: spin.at + GOD_SLOT_TICK_MS };
  if (!spin.pulled) {
    return { ...spin, tick, pulled: true, at: spin.at + GOD_SLOT_TICK_MS };
  }
  // 拉杆之后逐槽停：每 SETTLE_TICKS 格停一槽
  const since = tick - GOD_SLOT_AUTO_TICKS;
  const settled = Math.min(4, Math.floor(since / GOD_SLOT_SETTLE_TICKS));
  const landed = settled >= 4;
  return {
    ...spin,
    tick,
    settled,
    at: spin.at + GOD_SLOT_TICK_MS,
    landedAt: landed ? now : null,
  };
}

/** 这一趟演完了吗 */
export function godSlotDone(spin: GodSlotSpin, now: number): boolean {
  return spin.landedAt !== null && now - spin.landedAt >= GOD_SLOT_HOLD_MS;
}

/** 真人点一下：还在滚就立刻拉杆并停稳；停好了就收屏 */
export function godSlotClick(spin: GodSlotSpin, now: number): GodSlotSpin {
  if (spin.landedAt !== null) return { ...spin, landedAt: now - GOD_SLOT_HOLD_MS };
  const tick = Math.max(spin.tick, GOD_SLOT_AUTO_TICKS + GOD_SLOT_SETTLE_TICKS * 4);
  return { ...spin, tick, pulled: true, settled: 4, at: now + GOD_SLOT_TICK_MS, landedAt: now };
}

// ============================================================
//  绘制（纯 IO）
// ============================================================

/** 这一帧要画成什么 */
export interface GodSlotDraw {
  cue: GodSlotCue;
  /** 气泡里显示的金额（滚动时 = 当前四个数字拼出来的数）*/
  amount: number;
  /** 每槽的图号（已经折好过渡帧）*/
  digitImages: readonly number[];
  /** 摇杆拉下去了吗 */
  pulled: boolean;
}

function anchored(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/**
 * `fcn_004563f5` = **不透明**贴（机体与数字都走这条）。
 *
 * ⚠️ 与 `fcn_00456418` 的差别**只有抠不抠黑**：落点两边都走锚点
 *   （`to_left = x − src->x`，见 `monthly-screen.ts` 的同一句注）。
 *   「抠黑」在本引擎是取图时用 `sprite(..., keyed)` 做的，不在这里。
 */
function opaque(ctx: CanvasRenderingContext2D, s: Sprite | null, x: number, y: number): void {
  if (s === null) return;
  ctx.drawImage(s.bitmap, x - s.anchorX, y - s.anchorY);
}

/** 带描边的正中文字（原版 `_rich4_draw_text` 的阴影：右下 1px）*/
function centerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = `${GOD_SLOT_FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  const lineH = GOD_SLOT_FONT_SIZE + 6;
  const y0 = y - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    const ly = y0 + i * lineH;
    ctx.fillStyle = GOD_SLOT_SHADOW;
    ctx.fillText(line, x + 1, ly + 1);
    ctx.fillStyle = GOD_SLOT_FILL;
    ctx.fillText(line, x, ly);
  });
}

/**
 * 画整屏。
 *
 * 顺序照原版：气泡（0x004407a0）→ 机体（0x004407d0）→ 摇杆（0x004407f3）→
 * 台詞（0x00440873）；状态机每格再把**金额**重画一遍盖在模板第二行（那个空行）上。
 */
export function drawGodSlot(
  ctx: CanvasRenderingContext2D,
  sprite: SlotSprite,
  d: GodSlotDraw,
): void {
  const variant = d.cue.variant;
  // ① 气泡
  anchored(
    ctx,
    sprite(GOD_SLOT_BUBBLE.archive, GOD_SLOT_BUBBLE.resource, GOD_SLOT_BUBBLE.image, true),
    GOD_SLOT_BUBBLE_AT.x,
    GOD_SLOT_BUBBLE_AT.y,
  );
  // ② 机体（不透明）
  opaque(
    ctx,
    sprite(GOD_SLOT_ARCHIVE, GOD_SLOT_RESOURCE, godSlotPanelImage(variant), false),
    GOD_SLOT_PANEL_AT.x,
    GOD_SLOT_PANEL_AT.y,
  );
  // ③ 摇杆（拉下去时换成圆头叠在同一落点）
  const lx = godSlotLeverX(variant);
  if (d.pulled) {
    anchored(
      ctx,
      sprite(GOD_SLOT_ARCHIVE, GOD_SLOT_RESOURCE, GOD_SLOT_KNOB_IMAGE, true),
      lx,
      GOD_SLOT_LEVER_Y,
    );
  } else {
    anchored(
      ctx,
      sprite(GOD_SLOT_ARCHIVE, GOD_SLOT_RESOURCE, GOD_SLOT_LEVER_IMAGE, true),
      lx,
      GOD_SLOT_LEVER_Y,
    );
  }
  // ④ 四位/三位数字（不透明贴，槽 0 在三位盤上 x = 0 ⇒ 不画）
  for (let slot = 0; slot < 4; slot++) {
    const x = godSlotDigitX(variant, slot);
    const img = d.digitImages[slot];
    if (x === 0 || img === undefined) continue;
    opaque(ctx, sprite(GOD_SLOT_ARCHIVE, GOD_SLOT_RESOURCE, img, false), x, GOD_SLOT_DIGIT_Y);
  }
  // ⑤ 台詞 + 金额（金额填在中间那个空行）
  centerText(ctx, godSlotBubbleText(d.cue, d.amount), GOD_SLOT_TEXT_AT.x, GOD_SLOT_TEXT_AT.y);
}

// ============================================================
//  屏幕本体
// ============================================================

let playback: GodSlotSpin | null = null;
let playAmount = 0;
/**
 * 已 diff 出、但**还在等附身影片/开场白收场**的那一局（第十一份試玩回報 #6）。
 *
 * ★★ 原版次序（`fcn_0040ef1b`，小窮神）：
 *   抱怨台詞(`0x40ef44`) → **附身影片 0x220**(`0x40ef65/78`) → **白字文案**(`0x40ef8e`)
 *   → **金額老虎機** `fcn_00440706(4)`(`0x40ef98`) → 付款(`0x40efd9`)。
 *   先前这里是**同步**起播（`event()` 里直接 `godSlotStart`），而 `SCREENS` 的 `event` 派发与
 *   `startGodFx`/`startGodLine` 同一拍 ⇒ 老虎機搶在影片與文案**之前**出现（還把影片盖在下面）。
 */
let pendingCue: GodSlotCue | null = null;

/** 起播闸 —— 与 `notice-box-screen.ts` 的 `setNoticeStartGate` 同一个形状 */
let startGate: (() => boolean) | null = null;

export function setGodSlotStartGate(f: (() => boolean) | null): void {
  startGate = f;
}

function gated(): boolean {
  return startGate?.() === true;
}

/** 调试 / 单测用：把整屏关掉 */
export function resetGodSlot(): void {
  playback = null;
  playAmount = 0;
  pendingCue = null;
}

/** 给单测的只读视图 */
export function godSlotState(): { playing: boolean; spin: GodSlotSpin | null; amount: number } {
  return { playing: playback !== null, spin: playback, amount: playAmount };
}

/**
 * 这一帧四个数字拼出来的金额（停稳的槽定格、其余滚动）。
 * 三位數机体只有 3 格 ⇒ 从槽 1 开始拼（槽 0 不画）。
 */
export function godSlotCurrentAmount(spin: GodSlotSpin): number {
  const first = spin.cue.variant === 1 ? 1 : 0;
  let out = 0;
  for (let slot = first; slot < 4; slot++) out = out * 10 + godSlotSlotDigit(spin, slot);
  return out;
}

export const godSlotScreen: UiScreen = {
  id: 'god-slot',

  /**
   * ★ 浮窗：原版把 (0,0x28)-(0x1b8,0x1e0) 那块画在**棋盘之上**
   *   （`fcn_00451e7e` / `fcn_00451edb`，VA 0x0044073e / 0x004408f9）。
   */
  windowed: true,

  // ⚠️ **必须**把 `pendingCue` 算进来：`main.ts` 只把 `tick` 发给「此刻接管整屏」的那一屏，
  //   `active()` 为假就永远没人叫它起床（同 `notice-box-screen.ts` 那条注释的坑）。
  //   `draw()` 在 `playback === null` 时直接 return，所以押后期间不会画出东西。
  active: () => playback !== null || pendingCue !== null,

  draw(env: UiScreenEnv): void {
    const spin = playback;
    if (spin === null) return;
    const digits = [0, 1, 2, 3].map((slot) => {
      const d = godSlotSlotDigit(spin, slot);
      return godSlotSlotRolling(spin, slot) ? godSlotRollImage(d) : godSlotDigitImage(d);
    });
    drawGodSlot(env.stage, env.sprite, {
      cue: spin.cue,
      amount: playAmount,
      digitImages: digits,
      pulled: spin.pulled,
    });
  },

  up(_x: number, _y: number, env: UiScreenEnv): void {
    clickGodSlot(env);
  },

  key(_key: UiKeyEvent, env: UiScreenEnv): boolean {
    clickGodSlot(env);
    return true;
  },

  /**
   * 联机旁观：行动者那台已经收场（见 `ui-screen.ts` 的 `fastForward`）⇒ 直接关窗，
   * 连「还在等附身影片收场」的那一局（`pendingCue`）也一并作废（他那边早演完了）。
   */
  fastForward(env: UiScreenEnv): boolean {
    if (playback === null && pendingCue === null) return false;
    playback = null;
    pendingCue = null;
    playAmount = 0;
    env.stopEffect(GOD_SLOT_SPIN_SOUND);
    env.log('神明老虎机：跟著行動者收場');
    env.requestRender();
    return true;
  },

  tick(env: UiScreenEnv): void {
    // ── ① 已 diff 出、还在等附身影片/开场白收场 ──
    const pendingSpin = pendingCue;
    if (pendingSpin !== null) {
      if (gated()) return; // 闸没开：原样留着，`active()` 靠它继续叫我们
      pendingCue = null;
      playback = godSlotStart(pendingSpin, env.now);
      playAmount = pendingSpin.amount;
      // @source 0x004408a0 / 0x004408b2：原版起循环后**紧接着就停**
      env.playEffect(GOD_SLOT_SPIN_SOUND, true);
      env.stopEffect(GOD_SLOT_SPIN_SOUND);
      env.log(`神明老虎机：${pendingSpin.text.split('\n')[0]} ${pendingSpin.amount} 元`);
      env.requestRender();
      return;
    }
    const spin = playback;
    if (spin === null) return;
    if (godSlotDone(spin, env.now)) {
      playback = null;
      env.stopEffect(GOD_SLOT_SPIN_SOUND);
      env.log('神明老虎机：演出结束');
      env.requestRender();
      return;
    }
    const next = godSlotTick(spin, env.now);
    if (next !== spin) {
      playback = next;
      playAmount = godSlotCurrentAmount(next);
      if (next.pulled && !spin.pulled) env.playEffect(GOD_SLOT_LEVER_SOUND);
      if (next.landedAt !== null && spin.landedAt === null) {
        env.stopEffect(GOD_SLOT_SPIN_SOUND);
        env.log(`神明老虎机：停在 ${playAmount} 元`);
      }
    }
    env.requestRender();
  },

  /**
   * 刚附身那一位神明 → 开演（与 `wheel-screen.ts` 同一套路：diff `before/after`）。
   */
  event(before: GameState, after: GameState, env: UiScreenEnv): void {
    if (playback !== null) return;
    if (before === after) return;
    const cue = godSlotCue(before, after);
    if (cue === null) return;
    // ★ 第十一份試玩回報 #6：**先记下来**，等附身影片/开场白收场再起播（见 `pendingCue`）
    pendingCue = cue;
    env.requestRender();
  },
};

function clickGodSlot(env: UiScreenEnv): void {
  const spin = playback;
  if (spin === null) return;
  if (!spin.cue.human) return;
  const next = godSlotClick(spin, env.now);
  playback = next;
  playAmount = godSlotCurrentAmount(next);
  if (next.landedAt !== null) env.stopEffect(GOD_SLOT_SPIN_SOUND);
  env.requestRender();
}
