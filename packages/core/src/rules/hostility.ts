/*
 * 敌意值
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py va 0x0040df69`
 *   原版签名：`void update_hostility(int a, int b, int delta)`
 *   —— 「玩家 a 对玩家 b 的敌意」增加 delta。
 *
 * 敌意驱动 AI 的针对性（打谁的卡、拒不交易等），是 M3 的必要前置。
 * 此前各张卡只是把敌意变化**记录**在结果里，本模块负责真正落到状态上。
 */

import type { Player } from '../state/types.ts';

/**
 * 敌意表在玩家结构体内的位置：`+0x4c`，**4 个 int**。
 *
 * @source `mov edi, dword [a*0x68 + b*4 + 0x496bb4]`
 *   （玩家数组基址 0x496b68，故 0x496bb4 = +0x4c）
 *
 * ★ 这从两侧共同证伪了 `rich4-re/asm/rich4_player_info.h` 的
 *   `hostility[6]`：本函数只按 `b*4` 寻址 4 个玩家，而紧随其后的
 *   +0x5c / +0x60 被 `pay_money` 当作本月支出/收入读写
 *   （见 rules/payment.ts）。两者相加恰好填满原先记成 6 项的空间。
 */
export const HOSTILITY_COUNT = 4;

export interface HostilityResult {
  players: Player[];
  /** 是否因敌意上升而解除了同盟 */
  allianceBroken: boolean;
}

/**
 * 更新「a 对 b」的敌意。
 *
 * 原版全文（VA 0x0040df69）：
 * ```asm
 * cmp edx, ebx / je end              ; ★ a == b 直接返回
 * cmp dword [esp+0x14], 0
 * jge 继续
 * cmp dword [a*0x68 + b*4 + 0x496bb4], 0
 * je  end                            ; ★ 负增量且当前已为 0 → 直接返回
 * 继续:
 * edi = hostility[a][b] + delta
 * hostility[a][b] = edi
 * test edi, edi / jge 跳过
 * hostility[a][b] = 0                ; ★ 下限 0
 * 跳过:
 * cmp dword [esp+0x14], 0 / jle end  ; 仅在**正增量**时继续
 * cl = byte [a + 0x41]               ; a 的同盟对象（下标 + 1）
 * cmp ecx, ebx + 1 / jne end
 * push edx / call 0x40cc1a           ; ★ 敌意上升会**解除同盟**
 * ```
 *
 * 那条「负增量且已为 0 就提前返回」的分支看似多余（下限逻辑本就会兜住），
 * 但它**跳过了同盟检查**——不过同盟检查只在正增量时才跑，所以两条路径
 * 结果一致。照搬是为了万一日后发现别的副作用。
 *
 * ★ 通道 2 差分已复核（`rich4-spec/tests/test_hostility_update.py`，22/22）：
 *   上面每一条都在 Unicorn 里逐条验过，另外两条**只能靠实测才知道**的事：
 *
 * 1. **`b` 没有上界检查**：原版 `b = 4` 会写到 `+0x5c`（= `monthlyPaid`），
 *    且是**在旧值上累加**（实测 `0x11111111 → 0x11111114`）。本函数加了
 *    `b >= HOSTILITY_COUNT` 护栏 ⇒ **有意偏离**（实际调用点都只遍历 0..3，
 *    构造上不可达；登记在 `docs/known-deviations.md`）。
 * 2. 「a 的盟友是自己」**不可能触发拆盟**：判据是 `alliedPlayer === b + 1`，
 *    要它等于 `a + 1` 就得 `b === a`，而 `a === b` 已先返回。
 */
export function updateHostility(
  players: readonly Player[],
  a: number,
  b: number,
  delta: number,
): HostilityResult {
  const next = [...players];
  const pa = next[a];
  // @source cmp edx, ebx / je end
  if (a === b || pa === undefined || b < 0 || b >= HOSTILITY_COUNT) {
    return { players: next, allianceBroken: false };
  }

  const current = pa.hostility[b] ?? 0;
  // @source 负增量且当前为 0 → 直接返回
  if (delta < 0 && current === 0) {
    return { players: next, allianceBroken: false };
  }

  // ★★ 2026-09-24（provenance 审计）：`0x0040dfa1 add edi, ecx` 是 **32 位有符号**加法，溢出会回绕成负
  //   （之后 `0x0040dfa9 test edi,edi / jge` ⇒ 清 0）。几张卡把 double 当 int 压栈（`misalignedDoubleInt`）
  //   一次就能加上 ~1.7e9，两次就溢出 —— JS 不回绕会存成 3.4e9。
  const raw = (current + delta) | 0;
  const hostility = [...pa.hostility];
  // @source test edi,edi / jge / 置 0 —— 下限 0，无上限
  hostility[b] = raw < 0 ? 0 : raw;
  next[a] = { ...pa, hostility };

  // @source cmp dword [esp+0x14], 0 / jle end —— 只有正增量才会解盟
  if (delta > 0 && pa.alliedPlayer === b + 1) {
    return { players: breakAlliance(next, a), allianceBroken: true };
  }
  return { players: next, allianceBroken: false };
}

/**
 * 解除玩家 a 的同盟（双向清空）。
 *
 * @source VA 0x0040cc1a：
 * ```asm
 * byte [a + 0x3d] = 0                ; a.allied_days
 * edx = byte [a + 0x41] - 1          ; 对方下标
 * byte [partner + 0x41] = 0
 * byte [partner + 0x3d] = 0
 * byte [a + 0x41] = 0
 * ```
 *
 * ★ 逐条差分实证（`rich4-spec/tests/test_alliance.py` 15/15）：
 *   1. 双向清四格；**不检查对方是否指回自己**（`a→b` 而 `b→c` 时 `b` 照样被清）；
 *   2. **不追链** —— 只清一层，`b` 的盟友 `c` 不动；
 *   3. 自指（`a.alliedPlayer == a+1`）无害：把自己清两遍。
 *
 * ⚠️⚠️ **有意偏离（护栏）**：`alliedPlayer == 0` 时原版**没有判断** ——
 *   `edx = 0 - 1` ⇒ 写到 `0x496ba9 - 0x68 = 0x496B41` 与 `0x496ba5 - 0x68 = 0x496B3D`，
 *   **越界清掉两格**（实测：这两格从 `0xAA`/`0xBB` 变 0）。
 *   那两格的语义 PRD 里没有。本函数加了 `alliedPlayer === 0` 提前返回 ⇒ 不复制这个越界。
 *   目前两个调用方都保证「有盟友才调」（`hostility.ts` 的 `alliedPlayer === b + 1` 判据、
 *   `reduce.ts` 的 `allianceExpired` 只在 `alliedDays` 递减到 0 的下一拍为真），
 *   所以这条偏离**不可达**；若将来有人放宽调用条件，要重新评估。
 */
export function breakAlliance(players: readonly Player[], a: number): Player[] {
  const next = [...players];
  const pa = next[a];
  if (pa === undefined || pa.alliedPlayer === 0) return next;

  const partnerIdx = pa.alliedPlayer - 1;
  const partner = next[partnerIdx];
  if (partner !== undefined) {
    next[partnerIdx] = { ...partner, alliedPlayer: 0, alliedDays: 0 };
  }
  next[a] = { ...pa, alliedPlayer: 0, alliedDays: 0 };
  return next;
}

/** 依次施加一组敌意变化（各卡产生的 hostilityDeltas） */
/**
 * ★★ 「**double 压栈、被调方按 int 读**」的取值 —— 取那个 double 位型的**低 32 位**。
 *
 * 原版有**三处**这样调 `update_hostility`（`0x40df69`）：購地卡（3）、拍賣卡（8）、
 * 黑卡（25）。三处都是 `sub esp,8 / fstp qword [esp]`，而被调方的
 * `mov ecx, [esp+0x14]`（prologue 两个 push 之后）= 调用方 `[esp+0xc]` = **低半**。
 *
 * ⚠️ 这不是"敌意值为 0"的等价物 —— 实测（`rich4-spec/tests/test_land_auction_cards.py`
 * 与 `tests/test_stock_alliance_cards.py`，两处都真跑原版 `0x40df69`）：
 *   - 購地卡 `(1001×1)×(2+2)/5 = 800.8` ⇒ 低 32 位 = **+1717986919**；
 *   - 黑卡「持股 10 × 价差 0.3 ÷ 200」⇒ **+1717986918**；
 *   - 而 `800.0` 这类"整齐"的 double 低 32 位恰为 **0**（地价是 100 的倍数时常见）。
 * 故本函数是**必需**的：漏掉它，原版会写而本引擎不写（或反之）。
 *
 * @param value 原版以 x87 算出的那个 double（调用方自己保证运算次序）
 */
export function misalignedDoubleInt(value: number): number {
  // 小端：Float64 位型的前 4 字节就是低半
  low32Buf[0] = value;
  return low32View[0]! | 0;
}

const low32Buf = new Float64Array(1);
const low32View = new Int32Array(low32Buf.buffer);

export function applyHostilityDeltas(
  players: readonly Player[],
  deltas: readonly { from: number; to: number; delta: number }[],
): Player[] {
  let next = [...players];
  for (const d of deltas) {
    next = updateHostility(next, d.from, d.to, d.delta).players;
  }
  return next;
}
