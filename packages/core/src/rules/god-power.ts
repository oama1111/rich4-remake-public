/*
 * 神明**附身那一刻的發威** —— 跳表 `ref_0040ea9b` 的语义
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`rich4_gods.asm` 全文（VA 见下）。
 *
 * `_rich4_attach_god`（VA 0x0040eac2 起）在写完三項修正
 *（`+0x44 衰運 / +0x46 財運 / +0x48 福運`，VA 0x0040ebcc..0x0040ebf0）之后：
 *
 * ```asm
 * 0040ebf0  lea edx, [esi - 1]                 ; esi = 神明種類（= objects[godInfo−1].type）
 * 0040ebf3  cmp edx, 0xe / ja 结束
 * 0040ebfa  jmp dword [edx*4 + ref_0040ea9b]   ; ★ 15 項跳表 = 各神的「發威」
 * ```
 *
 * 进门那道闸 `fcn_0040ea62` 的**放行集合 = {1..10, 12, 15}**
 *（11 惡犬、13 禮物、14 寶箱 不放行 —— 与 `client/src/god-fx.ts` 的 12 段影片同一个集合）。
 *
 * | 種類 | 神 | 發威（@source）|
 * |---|---|---|
 * | 1 | 小財神 | 金額**四位數**；**每個對手付給附身者**（現金）：`fcn_0041d2c6(對手, 附身者, 金額, 1)`（0x0040ec99）|
 * | 2 | 大財神 | 金額三位數；**附身者進帳**：`fcn_0041d3f4(附身者, 金額, 1)` → 現金 + `+0x60`（0x0040ed4c）|
 * | 3 | 小福神 | `_rich4_player_receive_random_card(附身者)` **得一張卡**（0x441e12，0x0040ede7）|
 * | 4 | 大福神 | **得两张**（同一函数连调两次，0x0040eea8 / 0x0040eeb5）|
 * | 5 | 小窮神 | 金額三位數；**附身者付給每個對手**（進對方**存款**）：`fcn_0041d2c6(附身者, 對手, 金額, 0)`（0x0040efd9）|
 * | 6 | 大窮神 | 金額三位數；**附身者付給銀行**：`fcn_0041d2c6(附身者, −1, 金額, 0)`（0x0040f076）|
 * | 7 | 小衰神 | `_rich4_player_drop_random_card(附身者)` 丢一张（0x441e77，0x0040f10c）|
 * | 8 | 大衰神 | `_rich4_player_drop_half_the_card(附身者)` 丢一半（0x441ece，0x0040f1de）|
 * | 9 | 天使 | **只演出**（影片 0x224 + 台詞），无状态改动 —— 效果是被動的（0x0040f205）|
 * | 10 | 惡魔 | 同上（影片 0x225，0x0040f258）|
 * | 12 | 土地公 | 同上（影片 0x226，0x0040f2a0）|
 * | 15 | 死神 | `_rich4_player_sell_all_tools` + `_rich4_player_sell_all_the_card`（0x445b3f / 0x441f21，0x0040f2eb）|
 *
 * ## 金額是那扇窗转出来的（C-DET：結果由 core 定）
 *
 * 上面四种「金額」型的神都 `call fcn_00440706(arg)` 开一扇**浮窗**
 *（`arg`：0 小財神 / 1 大財神 / 4 小窮神 / 5 大衰神……见 `Q-GOD-1`），
 * 窗里的 `fcn_0043f23e` 每 **10 tick** 重掷一次四个数字
 *（`[0x48c504+i] = rand() % 10 * 2 + 1`，WA 0x0040f2d7 那个循环），退出时拼成一个数：
 *
 * ```asm
 * ; VA 0x0043f66x（拼数）—— 四个字节分别是 [0x48c504..0x48c507]
 * edx  = (c6/2)*10                       ; shl 2 + add 自身 = ×5，再 ×2
 * edx += (c7/2)
 * edx += (c5/2)*100                      ; imul eax, eax, 0x64
 * [esp+0xac] = edx
 * if (arg == 0) [esp+0xac] += (c4/2)*1000  ; ★ 只有小財神加千位
 * ```
 * 即**四位十进制数**：`c4/2` 当千位、`c5/2` 百位、`c6/2` 十位、`c7/2` 个位；
 * `c_i/2` 是**算术右移**，对 `rand()%10*2+1` 正好等于 `rand()%10`。
 *
 * 重掷几次取决于**真人点击时机**（AI 那一路是 30 tick 定时推进）——
 * 按本仓库的 **D-003**（真人点击时机不復刻、結果由 core 定），
 * 这里用**一次**四个 `rand()%10` 当替身：分布相同（四位/三位均匀）、可复现、可联机。
 * 注意**四种金額型都取满 4 次**（原版那个循环恒 `ebx < 4`），
 * 于是随机数消耗与原版同形。
 *
 * ## 付款助手（§「金额」之外的语义）
 *
 * - `fcn_0041d2c6(付款人, 收款人, 金額, flags)`（VA 0x0041d2c6 =
 *   `rules/payment.ts` 的 `transferMoney`）：从付款人扣（現金不足先扣存款、再不夠就破产），
 *   加给收款人；`收款人 = −1` → **銀行**、`≥ 0x64` → **公司盈餘**、
 *   否则玩家（flags bit0 = 進**現金**，否則進**存款**）；
 * - `fcn_0041d3f4(玩家, 金額, flags)`（VA 0x0041d3f4 = `receiveMoney`）：纯进帳。
 *
 * ## 与原版的两处**有意近似**（登记在 `docs/known-deviations.md` 的 Q-GOD-2）
 *
 * 1. 重掷次数取 1 次（见上，D-003）；
 * 2. 原版是**阻塞**的模态窗（`Wait_0402_Message`），本引擎在 reduce 里一次算完，
 *    表现层的气泡窗单列 `Q-GOD-1`（未接）。
 */

import type { WatcomRng } from '../rng/watcom.ts';

/** 神明種類 —— 与 `rules/objects.ts` 的 `OBJECT_TYPE_TABLE` 同一套编码 */
export const GOD_SMALL_WEALTH = 1;
export const GOD_BIG_WEALTH = 2;
export const GOD_SMALL_LUCK = 3;
export const GOD_BIG_LUCK = 4;
export const GOD_SMALL_POVERTY = 5;
export const GOD_BIG_POVERTY = 6;
export const GOD_SMALL_MISFORTUNE = 7;
export const GOD_BIG_MISFORTUNE = 8;
export const GOD_ANGEL = 9;
export const GOD_DEVIL = 10;
export const GOD_EARTH = 12;
export const GOD_REAPER = 15;

/**
 * 附身那一刻要做什么。
 *
 * 金额一律是**已经掷好**的数（`godPowerOf` 里用 `WatcomRng` 掷），
 * 本模块不碰 `GameState`：落地/收卡由 `state/reduce.ts` 套 `transferMoney` /
 * `receiveMoney` / `giveCard` / `sellAll*` 执行（C-ARC-2）。
 */
export type GodPower =
  /** 只演出（天使／惡魔／土地公，以及不附身的 11/13/14）*/
  | { kind: 'none' }
  /** 小財神：每個對手付給附身者（**現金**）@source 0x0040ec99 */
  | { kind: 'collectFromOpponents'; amount: number }
  /** 大財神：附身者進帳（**現金**）@source 0x0040ed4c */
  | { kind: 'gain'; amount: number }
  /** 小窮神：附身者付給每個對手（進對方**存款**）@source 0x0040efd9 */
  | { kind: 'payOpponents'; amount: number }
  /** 大窮神：附身者付給**銀行** @source 0x0040f076 */
  | { kind: 'payBank'; amount: number }
  /** 福神：得 `count` 张随机卡（1 = 小福神 / 2 = 大福神）@source 0x0040ede7 / 0x0040eea8 */
  | { kind: 'receiveCards'; count: number }
  /** 衰神：丢卡（`one` = 随机一张 / `half` = 丢一半）@source 0x0040f10c / 0x0040f1de */
  | { kind: 'dropCards'; mode: 'one' | 'half' }
  /** 死神：賣光道具 + 卡片（都折成**點券**）@source 0x0040f2eb */
  | { kind: 'sellEverything' };

/**
 * 轉盤窗每 10 tick 重掷的「數字」个数 —— 原版那个循环恒 `ebx < 4`（0x0040f2d7）。
 * 四种金額型的神都取满 4 次 `rand()`，故替身也取 4 次（随机数消耗同形）。
 */
export const GOD_POWER_DIGITS = 4;

export interface GodAmounts {
  /** 四位數：`d4*1000 + d5*100 + d6*10 + d7`（小財神）*/
  four: number;
  /** 三位數：`d5*100 + d6*10 + d7`（大財神 / 小窮神 / 大窮神）*/
  three: number;
}

/**
 * 掷一次「金額」：`GOD_POWER_DIGITS` 次 `rand() % 10`，按原版那个顺序
 * （`[0x48c504] → [0x48c505] → [0x48c506] → [0x48c507]`）当千/百/十/个位。
 *
 * @source 0x0040f2d7（`rand() % 10 * 2 + 1`）配 0x0043f66x（那份拼数）
 */
export function rollGodAmounts(rng: WatcomRng): GodAmounts {
  const digits: number[] = [];
  for (let i = 0; i < GOD_POWER_DIGITS; i++) {
    // @source mov edx,eax / sar edx,0x1f / idiv 0xa → rand() % 10；
    //   再 *2+1，退出时又 >>1 ⇒ 就是 rand()%10 本身
    digits.push(rng.below(10));
  }
  const [d4 = 0, d5 = 0, d6 = 0, d7 = 0] = digits;
  return { four: d4 * 1000 + d5 * 100 + d6 * 10 + d7, three: d5 * 100 + d6 * 10 + d7 };
}

/**
 * 「这个种类的神明附身时要做什么」。
 *
 * ⚠️ **只有金額型（1/2/5/6）会消耗随机数** —— 福神／衰神／死神在原版里
 *   **不**开那扇窗（`fcn_00440706` 的四个调用点就是 0/1/4/5），
 *   故这里也不能白抽（C-DET-4：不推进就没消耗）。
 */
export function godPowerOf(type: number, rng: WatcomRng): GodPower {
  switch (type) {
    case GOD_SMALL_WEALTH:
      return { kind: 'collectFromOpponents', amount: rollGodAmounts(rng).four };
    case GOD_BIG_WEALTH:
      return { kind: 'gain', amount: rollGodAmounts(rng).three };
    case GOD_SMALL_POVERTY:
      return { kind: 'payOpponents', amount: rollGodAmounts(rng).three };
    case GOD_BIG_POVERTY:
      return { kind: 'payBank', amount: rollGodAmounts(rng).three };
    case GOD_SMALL_LUCK:
      return { kind: 'receiveCards', count: 1 };
    case GOD_BIG_LUCK:
      return { kind: 'receiveCards', count: 2 };
    case GOD_SMALL_MISFORTUNE:
      return { kind: 'dropCards', mode: 'one' };
    case GOD_BIG_MISFORTUNE:
      return { kind: 'dropCards', mode: 'half' };
    case GOD_REAPER:
      return { kind: 'sellEverything' };
    // 9 天使 / 10 惡魔 / 12 土地公：影片 + 台詞，状态不动；
    // 11 惡犬 / 13 禮物 / 14 寶箱：本来就不附身。
    default:
      return { kind: 'none' };
  }
}

/**
 * 这一位神明会不会**真的动钱/动牌** —— 表现层据此决定要不要弹那扇气泡窗
 *（Q-GOD-1；原版那扇窗只在四个金額型 + 福神/衰神/死神的函数里被开）。
 */
export function godPowerHasEffect(power: GodPower): boolean {
  return power.kind !== 'none';
}
