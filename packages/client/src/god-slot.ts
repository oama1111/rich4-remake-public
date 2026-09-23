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
 * 00440714  read_mkf(Panel.mkf, 0x43) → [0x48c514]          ; ★ 老虎机素材 = Panel **#67**
 * 0044073a  create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)     ; 与訊息框同一句（flag 3 = 描边）
 * 00440774  fcn_00451e7e(rect (0,0x28)-(0x1b8,0x1e0))        ; ★ 浮窗：先存下这块
 * 004407b1  fcn_00456418(surface, Data#517 图 5, 0xdc, 0x8c) ; 底框 = Data#517 **图 5**（棕色訊息框）落 (220,140)
 *                    ;   `004407a6 add eax,0x48` ⇒ (0x48 − 0xc) / 12 = **5**（不是 6，见 `GOD_SLOT_BUBBLE`）
 * 004407c0  ebx = (arg & 1) ^ 1
 * 004407ec  fcn_004563f5(surface, Panel#67 图 ebx, 0xdc, 0x140)
 *                    ; ★ 机体：图 0 = 四位數（193×183）、图 1 = 三位數（156×183），落 (220,320)
 * 00440811  fcn_00456418(surface, Panel#67 图 2, [0x475ce0+ebx*4], 0xf0)
 *                    ; ★ 摇杆 = 图 2（31×108）落 x = **317**（ebx 0）/ **298**（ebx 1）、y = 240
 * 00440830..00440866  sprintf(buf, 四種模板[arg], _rich4_god_names[arg])
 * 00440886  draw_text(buf, 0xdc, 0x8c, flag 4)               ; 台詞画在气泡里（墨迹框正中）
 * 004408b2  play_sound_effect(&0x475d3c, 1)                  ; 音效 **51** 循环
 * 004408bf  fcn_004542e9(&0x475d3c)                          ; Stop ……
 * 004408c8  ebx = fcn_0043f23e(ebx)                          ; ★ 9 状态机 → 返回值 = 金額
 *   0043f2ab  play_sound_effect(&0x475d3c, 1)                ; …… ★ 状态机一进门**又起播** ⇒ 转动全程有循环音
 * 004408d7  fcn_00454240(&0x475d3c)                          ; 释放
 * 004408ea  fcn_00451edb([0x48c51c], 0, 0x28)                ; 贴回浮窗
 * ```
 *
 * ## 状态机（`fcn_0043f23e`，跳表 `0x43f21a`；每格至少 **0x1e = 30 ms**，`0x0043f78e cmp ebx,0x1e / jb`）
 *
 * 每一格先做：状态 < 3 且 `计数 % 10 == 0` ⇒ 四个转轮全部重掷成 `rand()%10*2+1`（**奇数** = 过渡帧，
 * `0x0043f2bc..0x0043f2f6`）；`计数++`（`0x0043f2ff`）；电脑 / 夢遊且计数 ≥ 0x28 且状态 1 ⇒ 状态 2
 * （`0x0043f306..0x0043f327`）。然后按状态：
 *
 * | 状态 | 干什么 | @source |
 * |---|---|---|
 * | 1 | `fcn_0043ef3e(variant, 0xf, 0)` —— 四位一起滚 | `0x0043f33f` |
 * | 2 | 同上；摇杆那块贴回底图、画**图 3**（拉下去的摇杆，31×72）；音效 **1**（`0x482322`）；→ 3、计数清零 | `0x0043f351..0x0043f458` |
 * | 3 | 滚；计数到 **4** 时摇杆换回**图 2** → 4 | `0x0043f45d..0x0043f555` |
 * | 4 | `fcn_0043ef3e(variant, 0xf, 1)` 返回 1 → 5（**个位**先停）| `0x0043f55f` |
 * | 5 | `(variant, 0xe, 2)` → 6（十位）| `0x0043f57f` |
 * | 6 | `(variant, 0xc, 3)` → **`7 + variant`**（百位；三位數机体直接跳过 7）| `0x0043f59f` / `0x0043f5b5 lea esi,[ebp+7]` |
 * | 7 | `(variant, 8, 4)` → 8（千位）| `0x0043f5bd` |
 * | 8 | → 9、计数清零；**停循环音**；**重画气泡**（把台詞整个盖掉）后只写 `"%d元"`（`0x465284`）于 (220,140) flag 4 | `0x0043f5dd..0x0043f6f8` |
 * | 9 | 计数到 **0x28 = 40** 格 → 10 = 收屏返回 | `0x0043f6fa` |
 *
 * 真人（`whoPlays == 1` 且非夢遊）的点击（`0x202`/`0x205`/`0x101`）**只在状态 1 有用**：推到状态 2
 * （`0x0043f752..0x0043f770`）；其余时候点了什么都不发生（消息被 `PeekMessage` 吃掉）。
 *
 * ## 转轮与逐槽减速（`fcn_0043ef3e(variant, mask, n)` = VA 0x0043ef3e）
 *
 * - 槽 `ebx` 从 **3 倒数到 `variant`**（`0x0043efdd mov ebx,3` / `0x0043eff2 cmp ebx,edi / jl`）——
 *   三位數机体根本不碰槽 0；mask 的 bit0 = 槽 3、bit3 = 槽 0；
 * - 在 mask 里的槽每格 `值 = (值 + 1) % 20`（`0x0043f022..0x0043f037`），再**不透明**贴
 *   `Panel#67 图 (值 + 4)`（38×36）于 `x = [0x475ce8 + variant*8 + 槽*2]`、`y = 0x140`；
 *   **偶数 = 定格的那一位**（`2d` → 图 `2d+4`），**奇数 = 过渡帧**（上半 d、下半 d+1）；
 * - `n ≠ 0` 时对槽 `4 − n` 减速：三个静态字节 `[0x475d5c]`（档）/`[0x475d5d]`（档内计数）/`[0x475d5e]`（上一次的 n）——
 *   `n` 头一回出现且那一槽正好是**奇数**才起步（档 = 1）；之后每格 `档 <= 档内计数` 就升一档，
 *   `档 > 档内计数` 的那一格该槽不走；**档到 8** 就返回 1（`0x0043f0fc`）。
 *   ⇒ 从起步那一格算，该槽再走 **7 格**（奇 + 7 = 偶，正好停在一个整数字上）。
 *
 * ## 与本引擎的接线
 *
 * 本屏**没有待決交互**：core 在附身那一刻就把钱/卡结算完了（`applyGodPowerOnAttach`），
 * 本屏只是 `event(before, after)` 里 diff 出「刚附身 + 是那四种金額型」，把**已经发生**
 * 的那笔钱用老虎机演出来（金額从**金钱差额**反推）。所以：
 * - **不掷随机数**（C-DET-4）：core 已经掷过那四个数字了；
 * - 状态机**逐格照抄**（上表），只有两处替身：
 *   ① 状态 1/2 的重掷值用确定性的奇数序列（原版是 `rand()`，表现层不许碰随机数流）；
 *   ② 拉杆那一格（状态 2，之后再没有重掷）按 core 的金额把四个转轮**各挪一个偶数**：
 *      之后的格数只取决于奇偶，挪偶数不改节奏，于是逐槽减速停下来**正好**是那个金额；
 * - 电脑那一路 40 格自动拉杆；真人原版要自己点才拉杆 —— 本引擎对真人也 40 格自动拉杆
 *   （与转盘同一处置，D-003「真人点击时机不复刻」），真人在状态 1 点一下可以提早拉。
 */

import { GOD_ATTACH, formatOriginal, godNameOf } from '@rich4/data';
import {
  WHO_PLAYS_HUMAN,
  type GameState,
} from '@rich4/core';
import { drawGdiText, type GdiTextStyle } from './font.ts';
import { DIALOG_LINE_H, dialogRowMiddles } from './dialog.ts';
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

/** 老虎机素材在 `Panel.mkf` 的**资源号** @source 0x00440714 `push 0x43` */
export const GOD_SLOT_ARCHIVE = 'Panel.mkf' as const;
export const GOD_SLOT_RESOURCE = 0x43;

/**
 * 底框：`Data.mkf` 资源 **0x205 = 517 图 5**（249×170、锚点 (123,101) 的**棕色金边訊息框**），
 * 落 (220,140) @source 0x004407a1 `mov eax,[0x48bad8]` / 0x004407a6 `add eax,0x48`
 * —— 精灵记录从 `+0x0c` 起每张 12 字节 ⇒ `(0x48 − 0x0c) / 12 = 5`；状态 8 再贴一次
 * （0x0043f618 / 0x0043f61d 同样 `add eax,0x48`）把台詞盖掉。
 * 与询问框 / 訊息框（`gameui.ts` 的 `DIALOG_SKIN_IMAGE`）、转盘（`WHEEL_BUBBLE`）是**同一张**。
 *
 * ★ 2026-09-23 需求方：「神明那个对话框不是这个模板……我记得用的是棕色那个」——
 *   先前这里写成**图 6**（271×199 的红边白底云朵，`+0x54`，只有 `player_say` 0x0044f028 用它），
 *   是把 `0x48 / 12` 直接当图号、漏减了 `0x0c` 的表头。`dialog-templates.test.ts` 逐字节钉住。
 */
export const GOD_SLOT_BUBBLE = { archive: 'Data.mkf' as const, resource: 0x205, image: 5 };
export const GOD_SLOT_BUBBLE_AT = { x: 0xdc, y: 0x8c } as const;

/**
 * 字级 0x10、内文 `0xf0f0f0`、第二色 `0x101010` @source 0x0044073a
 * `create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)` —— 与询问框/訊息框同一句：
 * **3 = 粗体 + 右下 1 px 阴影**（2026-09-23 订正，先前当成描边；见 `font.ts` 的 `BOX_TEXT_STYLE`）。
 */
export const GOD_SLOT_FONT_SIZE = 0x10;
export const GOD_SLOT_FILL = '#f0f0f0';
export const GOD_SLOT_OUTLINE = '#101010';
/** 画字用的整套样式 = 框模板那一句（`font.ts` 的 `BOX_TEXT_STYLE`）*/
export const GOD_SLOT_TEXT_STYLE: GdiTextStyle = {
  size: GOD_SLOT_FONT_SIZE,
  color: GOD_SLOT_FILL,
  color2: GOD_SLOT_OUTLINE,
  flags: 3,
  spacing: 1,
};

/** 台詞与金额都落 (220,140) flag 4（墨迹框正中）@source 0x00440886 / 0x0043f6b9 */
export const GOD_SLOT_TEXT_AT = { x: 0xdc, y: 0x8c } as const;

/** 机体落点 (220,320) @source 0x004407c6（`push 0x140 / push 0xdc`）*/
export const GOD_SLOT_PANEL_AT = { x: 0xdc, y: 0x140 } as const;

/**
 * 机体图号 = `ebx = (arg & 1) ^ 1`
 *
 * | 神 | `arg` | `ebx` | 机体 | 金額位數 |
 * |---|---|---|---|---|
 * | 1 小財神 | 0 | 1 | 三位數 | 三位 |
 * | 2 大財神 | 1 | 0 | 四位數 | 四位 |
 * | 5 小窮神 | 4 | 1 | 三位數 | 三位 |
 * | 6 大窮神 | 5 | 0 | 四位數 | 四位 |
 */
export const GOD_SLOT_PANEL_IMAGE = [0, 1] as const;

/** 摇杆（立着）= `Panel#67` 图 **2**（31×108），落 (x, 0xf0) @source 0x00440801 `[0x48c514]+0x24` */
export const GOD_SLOT_LEVER_IMAGE = 2;
/**
 * 摇杆（拉下去）= 图 **3**（31×72，锚点 (0,−35) ⇒ 往下挪 35）@source 0x0043f3ec `[0x48c514]+0x30`
 * —— `(0x30 − 0xc) / 12 = 3`。状态 3 计数到 4 时换回图 2（0x0043f506 `+0x24`）。
 *
 * ★ 第十四份試玩回報：先前这里当成「图 4 = 拉杆圆头」一直叠到收屏 —— 可图 4 是**数字 0**
 *   （`值 0 → 图 0 + 4`，与转轮同一套图）⇒ 摇杆上多出一个「0」。
 */
export const GOD_SLOT_LEVER_DOWN_IMAGE = 3;
/** 摇杆 x：`[0x475ce0]` = 317（四位數机体）/ `[0x475ce4]` = 298（三位數）*/
export const GOD_SLOT_LEVER_X = [0x13d, 0x12a] as const;
export const GOD_SLOT_LEVER_Y = 0xf0;

/** 数字图 = 图 `(值 + 4)`，38×36 @source 0x0043f08d..0x0043f0ab */
export const GOD_SLOT_DIGIT_FIRST = 4;
/** 数字的 y（exe 里固定 0x140）@source 0x0043efb7 `mov dword [esp+4], 0x140` */
export const GOD_SLOT_DIGIT_Y = 0x140;
/**
 * 每一槽的 x —— 表 `0x475ce8`（word）：
 * 四位盤 `[145, 182, 219, 256]`、三位盤 `[0, 163, 200, 237]`（槽 0 不画、也不转）。
 * 槽号 = 十进制位：槽 0 = 千位、槽 3 = 个位。
 */
export const GOD_SLOT_DIGIT_X: readonly (readonly number[])[] = [
  [0x91, 0xb6, 0xdb, 0x100],
  [0, 0xa3, 0xc8, 0xed],
];

/** 循环音 = `Effect.mkf` **51** @source `0x475d3c` 第一格 dword */
export const GOD_SLOT_SPIN_SOUND = 51;
/** 拉杆那一下的一次性音 = **1** @source 0x0043f43d `push 0x482322`（与转盘落地同一颗）*/
export const GOD_SLOT_LEVER_SOUND = 1;
/** 一格 = 0x1e = 30 ms @source 0x0043f78e `cmp ebx,0x1e / jb` */
export const GOD_SLOT_TICK_MS = 0x1e;
/** 状态 < 3 时每 10 格重掷一次数字 @source 0x0043f2c1 `mov ecx,0xa / div` */
export const GOD_SLOT_REROLL_TICKS = 10;
/** 计数到 0x28 = 40 格自动拉杆 @source 0x0043f318 `cmp [esp+0xb0], 0x28` */
export const GOD_SLOT_AUTO_TICKS = 0x28;
/** 摇杆拉下去停几格（状态 3 `cmp [esp+0xb0], 4`）@source 0x0043f46a */
export const GOD_SLOT_LEVER_DOWN_TICKS = 4;
/** 减速档到几就算停稳 @source 0x0043f0fc `cmp byte [0x475d5c], 8` */
export const GOD_SLOT_STOP_GEAR = 8;
/** 停稳之后再留几格才收屏（状态 9 `cmp [esp+0xb0], 0x28`）@source 0x0043f6fa */
export const GOD_SLOT_HOLD_TICKS = 0x28;
/** 收屏状态（`0x0043f797 cmp esi,0xa / jl`）*/
export const GOD_SLOT_DONE_STATE = 0xa;

/** 四种 `arg` —— 跳表 `0x4406ee` 的四个分支（其余神明不开这扇窗）*/
export const GOD_SLOT_ARG: Readonly<Record<number, number>> = { 1: 0, 2: 1, 5: 4, 6: 5 };

/** `arg` → 机体/摇杆的 variant `ebx = (arg & 1) ^ 1` @source 0x004407c0 */
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

/** 转轮值（0..19）画哪张图 @source 0x0043f093 `lea edx,[eax+4]` */
export function godSlotReelImage(value: number): number {
  return GOD_SLOT_DIGIT_FIRST + value;
}

/** 金額 → 每槽的十进制位（槽 0 = 千位；三位數机体槽 0 恒 0）*/
export function godSlotDigits(amount: number, variant: number): number[] {
  const n = Math.max(0, Math.trunc(amount));
  const s = String(n).padStart(4, '0').slice(-4);
  const all = [Number(s[0]), Number(s[1]), Number(s[2]), Number(s[3])];
  return variant === 1 ? [0, all[1]!, all[2]!, all[3]!] : all;
}

/**
 * 四个转轮拼出来的金额 @source 0x0043f630..0x0043f685：
 * `100*(c5>>1) + 10*(c6>>1) + (c7>>1)`，`variant == 0` 再加 `1000*(c4>>1)`。
 */
export function godSlotReelAmount(reels: readonly number[], variant: number): number {
  const d = (i: number): number => (reels[i] ?? 0) >> 1;
  const low = d(1) * 100 + d(2) * 10 + d(3);
  return variant === 0 ? low + d(0) * 1000 : low;
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
    // @source `0x0043f75e cmp byte [+0x15], 1 / jne` —— ★ 整字节：託管（1|4）不认点击（2026-09-23 订正）
    human: now.whoPlays === WHO_PLAYS_HUMAN && now.blocking.sleepWalking === 0,
  };
}

/**
 * 气泡里这一帧的字：状态 8 之前是台詞模板（`%s附身\n\n…`，**不带数字**），
 * 状态 8 重画气泡之后**只剩** `"%d元"` 一行 @source 0x0043f618 / 0x0043f694。
 *
 * ★ 第十四份試玩回報：先前把金额（还跟着转轮一起跳）塞进模板中间那个空行 ——
 *   原版转动时气泡里根本没有数字，停稳那一拍才把整块气泡换成「999元」。
 */
export function godSlotBubbleText(spin: GodSlotSpin): string {
  if (spin.state >= 9) {
    return formatOriginal(GOD_ATTACH.amount.text, godSlotReelAmount(spin.reels, spin.cue.variant));
  }
  return spin.cue.text;
}

// ============================================================
//  状态机（逐格照抄 `fcn_0043f23e` / `fcn_0043ef3e`）
// ============================================================

/** `[0x475d5c]` 档 / `[0x475d5d]` 档内计数 / `[0x475d5e]` 上一次的 n */
export type GodSlotGear = readonly [number, number, number];

export interface GodSlotSpin {
  cue: GodSlotCue;
  /** 状态机 `esi`（1..10；10 = 收屏）*/
  state: number;
  /** `[esp+0xb0]` */
  counter: number;
  /** 四个转轮 `[0x48c504..0x48c507]`，0..19（偶 = 定格、奇 = 过渡帧）*/
  reels: readonly number[];
  gear: GodSlotGear;
  /** 摇杆拉下去了（图 3）*/
  leverDown: boolean;
  /** 已经重掷过几次（替身序列用）*/
  rerolls: number;
  /** 下一格的时间点 */
  at: number;
}

/** 这一格发生了什么（给宿主放音效 / 记日志）*/
export interface GodSlotFrameEvents {
  /** 状态 2：拉杆（音效 1）*/
  pulled: boolean;
  /** 状态 8：停稳（停循环音）*/
  landed: boolean;
}

/**
 * `fcn_0043ef3e(variant, mask, n)` 一次：转一格，返回「槽 `4 − n` 停稳了没」。
 * 逐条对应见文件头「转轮与逐槽减速」。
 */
export function godSlotReelStep(
  variant: number,
  reels: readonly number[],
  gear: GodSlotGear,
  mask: number,
  n: number,
): { reels: number[]; gear: GodSlotGear; stopped: boolean } {
  let [c, d, e] = gear;
  const out = [...reels];
  if (n !== 0) {
    let slow = false;
    // @source 0x0043ef57..0x0043ef8a：n 头一回出现且那一槽是奇数 ⇒ 档 1 起步
    if (e !== n && ((out[4 - n] ?? 0) & 1) !== 0) {
      c = 1;
      d = 0;
      e = n;
      slow = true;
    } else if (c !== 0) {
      slow = true; // @source 0x0043ef8c
    }
    if (slow) {
      // @source 0x0043ef95..0x0043efb1
      if (c <= d) {
        d = 0;
        c += 1;
      }
      d += 1;
    }
  }
  for (let slot = 3, bit = 1; slot >= variant; slot--, bit <<= 1) {
    if ((mask & bit) === 0) continue;
    // @source 0x0043f004..0x0043f01c：正在减速的那一槽，档 > 档内计数的格不走
    if (4 - slot === n && c > d) continue;
    out[slot] = ((out[slot] ?? 0) + 1) % 20;
  }
  let stopped = false;
  // @source 0x0043f0fc：档到 8 ⇒ 清零、返回 1
  if (c === GOD_SLOT_STOP_GEAR) {
    c = 0;
    d = 0;
    stopped = true;
  }
  return { reels: out, gear: [c, d, e], stopped };
}

/** 状态 1/2 的重掷替身：确定性的奇数（原版 `rand()%10*2+1`，表现层不碰随机数流）*/
function rerollReels(cue: GodSlotCue, k: number): number[] {
  return [0, 1, 2, 3].map((slot) => ((cue.amount * 7 + k * 3 + slot * 5 + slot * k) % 10) * 2 + 1);
}

/** 状态 → 这一格的 `fcn_0043ef3e` 实参 @source 跳表 0x43f21a */
const STOP_STEPS: Readonly<Record<number, readonly [number, number]>> = {
  4: [0xf, 1],
  5: [0xe, 2],
  6: [0xc, 3],
  7: [8, 4],
};

/** 状态分派（`0x0043f32c` 之后那一段）；`aim` = 状态 2 那一格要不要按金额挪转轮 */
function dispatch(spin: GodSlotSpin, aim: boolean, ev: GodSlotFrameEvents): GodSlotSpin {
  const v = spin.cue.variant;
  const spinAll = (s: GodSlotSpin): GodSlotSpin => {
    const r = godSlotReelStep(v, s.reels, s.gear, 0xf, 0);
    return { ...s, reels: r.reels, gear: r.gear };
  };
  switch (spin.state) {
    case 1:
      return spinAll(spin);
    case 2: {
      const aimed = aim ? { ...spin, reels: aimReels(spin) } : spin;
      ev.pulled = true;
      return { ...spinAll(aimed), leverDown: true, state: 3, counter: 0 };
    }
    case 3: {
      const s = spinAll(spin);
      return s.counter === GOD_SLOT_LEVER_DOWN_TICKS ? { ...s, leverDown: false, state: 4 } : s;
    }
    case 4:
    case 5:
    case 6:
    case 7: {
      const [mask, n] = STOP_STEPS[spin.state]!;
      const r = godSlotReelStep(v, spin.reels, spin.gear, mask, n);
      const next = { ...spin, reels: r.reels, gear: r.gear };
      if (!r.stopped) return next;
      // @source 0x0043f5b5 `lea esi,[ebp+7]`：三位數机体从 6 直接跳到 8
      return { ...next, state: spin.state === 6 ? 7 + v : spin.state + 1 };
    }
    case 8:
      ev.landed = true;
      return { ...spin, state: 9, counter: 0 };
    case 9:
      return spin.counter === GOD_SLOT_HOLD_TICKS ? { ...spin, state: GOD_SLOT_DONE_STATE } : spin;
    default:
      return spin;
  }
}

/** 一格里分派之前那一段（重掷 / 计数 / 自动拉杆）@source 0x0043f2bc..0x0043f327 */
function prelude(spin: GodSlotSpin): GodSlotSpin {
  let s = spin;
  if (s.state < 3 && s.counter % GOD_SLOT_REROLL_TICKS === 0) {
    s = { ...s, reels: rerollReels(s.cue, s.rerolls), rerolls: s.rerolls + 1 };
  }
  const counter = s.counter + 1;
  // 原版只对电脑 / 夢遊自动拉杆；本引擎对真人也自动（D-003，见文件头）
  const state = counter >= GOD_SLOT_AUTO_TICKS && s.state === 1 ? 2 : s.state;
  return { ...s, counter, state };
}

/**
 * 拉杆那一格：把转轮各挪一个偶数，让之后逐槽停下来正好是 core 的金额。
 *
 * 之后再没有重掷（状态 ≥ 3），每一格走不走只看奇偶 ⇒ 先照原样空跑到状态 9 看落在哪，
 * 再把差值（必为偶数：同一次重掷出来的四个值奇偶相同、一起走）加回去。
 */
function aimReels(spin: GodSlotSpin): number[] {
  const ev: GodSlotFrameEvents = { pulled: false, landed: false };
  let sim = dispatch(spin, false, ev);
  for (let guard = 0; sim.state < 9 && guard < 10_000; guard++) sim = dispatch(prelude(sim), false, ev);
  const want = godSlotDigits(spin.cue.amount, spin.cue.variant);
  return spin.reels.map((r, slot) => {
    if (slot < spin.cue.variant) return r;
    const delta = (((want[slot]! * 2 - (sim.reels[slot] ?? 0)) % 20) + 20) % 20;
    return (r + delta) % 20;
  });
}

/** 开演 —— 状态 1、计数 0；第一格马上到（原版进门就转）*/
export function godSlotStart(cue: GodSlotCue, now: number): GodSlotSpin {
  return {
    cue,
    state: 1,
    counter: 0,
    reels: [1, 1, 1, 1],
    gear: [0, 0, 0],
    leverDown: false,
    rerolls: 0,
    at: now,
  };
}

/** 走一格（不看时间）*/
export function godSlotFrame(spin: GodSlotSpin): { spin: GodSlotSpin; events: GodSlotFrameEvents } {
  const events: GodSlotFrameEvents = { pulled: false, landed: false };
  if (spin.state >= GOD_SLOT_DONE_STATE) return { spin, events };
  return { spin: dispatch(prelude(spin), true, events), events };
}

/** 到点就走一格；没到点原样返回 */
export function godSlotTick(spin: GodSlotSpin, now: number): { spin: GodSlotSpin; events: GodSlotFrameEvents } {
  if (now < spin.at || spin.state >= GOD_SLOT_DONE_STATE) {
    return { spin, events: { pulled: false, landed: false } };
  }
  const r = godSlotFrame(spin);
  return { spin: { ...r.spin, at: spin.at + GOD_SLOT_TICK_MS }, events: r.events };
}

/** 这一趟演完了吗（状态 10）*/
export function godSlotDone(spin: GodSlotSpin): boolean {
  return spin.state >= GOD_SLOT_DONE_STATE;
}

/**
 * 真人点一下 @source 0x0043f752..0x0043f770：**只在状态 1** 把状态推到 2（下一格拉杆）；
 * 其余时候原样返回（原版的消息被吃掉，什么都不发生）。
 */
export function godSlotClick(spin: GodSlotSpin): GodSlotSpin {
  if (spin.state !== 1 || !spin.cue.human) return spin;
  return { ...spin, state: 2 };
}

// ============================================================
//  绘制（纯 IO）
// ============================================================

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

/**
 * `draw_text(…, 0xdc, 0x8c, flag 4)`：整块字的**墨迹框**以 (x,y) 为中心，粗体 + 1 px 阴影 ——
 * 与询问框/訊息框同一个画法（`dialog.ts` 的 `dialogRowMiddles` / `DIALOG_LINE_H`，D-DIALOG-1）。
 */
function centerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const lines = text.split('\n');
  const mids = dialogRowMiddles(
    lines.map((t) => ({ h: DIALOG_LINE_H, size: GOD_SLOT_FONT_SIZE, blank: t === '' })),
    y,
  );
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    if (line === '') return;
    const ly = mids[i] ?? y;
    drawGdiText(ctx, line, x, ly, GOD_SLOT_TEXT_STYLE);
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * 画整屏（这一格的样子）。
 *
 * 顺序照原版：气泡（0x004407b1）→ 机体（0x004407ec）→ 摇杆（0x00440811 / 状态 2、3 的换图）→
 * 转轮（`fcn_0043ef3e` 逐格贴）→ 气泡里的字（开窗时的台詞；状态 8 起换成 `"%d元"`）。
 */
export function drawGodSlot(ctx: CanvasRenderingContext2D, sprite: SlotSprite, spin: GodSlotSpin): void {
  const variant = spin.cue.variant;
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
  // ③ 摇杆：立着 = 图 2；拉下去（状态 2 起 4 格）= 图 3
  anchored(
    ctx,
    sprite(
      GOD_SLOT_ARCHIVE,
      GOD_SLOT_RESOURCE,
      spin.leverDown ? GOD_SLOT_LEVER_DOWN_IMAGE : GOD_SLOT_LEVER_IMAGE,
      true,
    ),
    godSlotLeverX(variant),
    GOD_SLOT_LEVER_Y,
  );
  // ④ 转轮（不透明贴；槽 3 倒数到 variant —— 三位數机体不碰槽 0）
  for (let slot = 3; slot >= variant; slot--) {
    const x = godSlotDigitX(variant, slot);
    const value = spin.reels[slot];
    if (x === 0 || value === undefined) continue;
    opaque(ctx, sprite(GOD_SLOT_ARCHIVE, GOD_SLOT_RESOURCE, godSlotReelImage(value), false), x, GOD_SLOT_DIGIT_Y);
  }
  // ⑤ 气泡里的字
  centerText(ctx, godSlotBubbleText(spin), GOD_SLOT_TEXT_AT.x, GOD_SLOT_TEXT_AT.y);
}

// ============================================================
//  屏幕本体
// ============================================================

let playback: GodSlotSpin | null = null;
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
  pendingCue = null;
}

/** 给单测 / 宿主的只读视图；`amount` = 这一格四个转轮拼出来的数 */
export function godSlotState(): { playing: boolean; spin: GodSlotSpin | null; amount: number } {
  return {
    playing: playback !== null,
    spin: playback,
    amount: playback === null ? 0 : godSlotReelAmount(playback.reels, playback.cue.variant),
  };
}

export const godSlotScreen: UiScreen = {
  id: 'god-slot',

  /**
   * ★ 浮窗：原版把 (0,0x28)-(0x1b8,0x1e0) 那块画在**棋盘之上**
   *   （`fcn_00451e7e` / `fcn_00451edb`，VA 0x00440774 / 0x004408ea）。
   */
  windowed: true,

  // ⚠️ **必须**把 `pendingCue` 算进来：`main.ts` 只把 `tick` 发给「此刻接管整屏」的那一屏，
  //   `active()` 为假就永远没人叫它起床（同 `notice-box-screen.ts` 那条注释的坑）。
  //   `draw()` 在 `playback === null` 时直接 return，所以押后期间不会画出东西。
  active: () => playback !== null || pendingCue !== null,

  draw(env: UiScreenEnv): void {
    const spin = playback;
    if (spin === null) return;
    drawGodSlot(env.stage, env.sprite, spin);
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
      // @source 0x004408b2 起播 → 0x004408bf 停 → 0x0043f2ab 状态机进门**再起播**：
      //   净效果 = 转动全程循环 51，状态 8（0x0043f5f0）才停
      env.playEffect(GOD_SLOT_SPIN_SOUND, true);
      env.log(`神明老虎机：${pendingSpin.text.split('\n')[0]} ${pendingSpin.amount} 元`);
      env.requestRender();
      return;
    }
    const spin = playback;
    if (spin === null) return;
    if (godSlotDone(spin)) {
      playback = null;
      env.stopEffect(GOD_SLOT_SPIN_SOUND);
      env.log('神明老虎机：演出结束');
      env.requestRender();
      return;
    }
    const { spin: next, events } = godSlotTick(spin, env.now);
    playback = next;
    if (events.pulled) env.playEffect(GOD_SLOT_LEVER_SOUND);
    if (events.landed) {
      env.stopEffect(GOD_SLOT_SPIN_SOUND);
      env.log(`神明老虎机：停在 ${godSlotReelAmount(next.reels, next.cue.variant)} 元`);
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
  const next = godSlotClick(spin);
  if (next === spin) return;
  playback = next;
  env.requestRender();
}
