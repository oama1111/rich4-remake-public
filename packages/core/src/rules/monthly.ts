/*
 * 每月结算与颁奖
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这是 Q5 扫描发现的**最大缺口**：整条「每月自动结算 → 存款利息 →
 * 月度奖项评选 → 颁奖」的链路，在 rich4-re 的已命名文件里完全没有，
 * 只存在于未拆分的 rich4.asm（fcn_00437c25 / 00437d1a / 00437dfe /
 * 00437e61 / 00439bfa，L16568–19256 约 2700 行）。
 *
 * @source rich4.asm:16656 fcn_00437d1a @ VA 0x00437d1a  奖项评分
 * @source rich4.asm:16763 fcn_00437dfe @ VA 0x00437dfe  首富评选
 * @source rich4.asm:16815 fcn_00437e61 @ VA 0x00437e61  结算主流程
 */

import type { Player } from '../state/types.ts';

// ============================================================
//  存款利息
// ============================================================

/**
 * 月息倍率的原始 double 位模式：`0x3ff199999999999a` = 1.1
 * @source rich4.asm 的 `fmul qword [ref_00464e88]`，常量 dd 0x9999999a / 0x3ff19999
 */
export const INTEREST_MULTIPLIER_BITS = 0x3ff199999999999an;

/**
 * 1.1 这个 double 的**精确**有理表示：尾数 / 2^52。
 *
 * 注意 1.1 无法用二进制精确表示，实际值略大于 1.1：
 *   1.10000000000000008881784197001252323389053344726562５
 * 原版乘的就是这个值，因此必须用它而非数学上的 11/10。
 */
// 2^52 (隐含位) + 尾数 0x199999999999A = 0x1199999999999A
const INTEREST_NUMERATOR = 0x1199999999999an;
const INTEREST_SHIFT = 52n;

/**
 * 计算月度存款利息后的余额。
 *
 * 原版：
 * ```asm
 * cmp dword [player + 36], 0   ; loan
 * jne skip                      ; ★ 有贷款则不发利息
 * fild dword [player + 32]      ; money_in_bank
 * fmul qword [0x464e88]         ; × 1.1
 * call __round_toward_zero
 * fistp dword [player + 32]     ; 向零取整写回
 * ```
 *
 * ⚠️ **关于浮点**：原版此处确实用了 x87 浮点（DEVELOPMENT_PLAN.md §5.2
 * C-DET-3 要求整数运算）。为兼顾保真与确定性，这里用 BigInt 精确展开
 * 那个 double 常量，得到与「无限精度乘法后向零取整」一致的结果——
 * 既不引入浮点的不确定性，又忠实于原版乘的那个具体数值。
 *
 * 已知风险：x87 内部用 80 位扩展精度，极端输入下其舍入可能与精确值
 * 相差 1。实测在合理金额区间（0 ~ 20 亿）内与 `Math.trunc(bank * 1.1)`
 * 完全一致，见 monthly.test.ts。
 */
export function applyMonthlyInterest(moneyInBank: number, loan: number): number {
  if (loan !== 0) return moneyInBank; // 有贷款不发利息
  if (moneyInBank === 0) return 0;

  const neg = moneyInBank < 0;
  const abs = BigInt(neg ? -moneyInBank : moneyInBank);
  // 向零取整 = 对绝对值向下取整后再恢复符号
  const scaled = (abs * INTEREST_NUMERATOR) >> INTEREST_SHIFT;
  const result = Number(scaled);
  return neg ? -result : result;
}

// ============================================================
//  月度奖项评分
// ============================================================

/**
 * 评分所需的月度累计字段。
 *
 * ⚠️ **`rich4-re/asm/rich4_player_info.h` 的 `uint32_t hostility[6]` 标注有误。**
 *
 * 该数组声明于 0x4C，占 0x4C..0x63。但评分函数取的是 `player[+92]`（0x5C）
 * 与 `player[+96]`（0x60），即所谓的 `hostility[4]` / `hostility[5]`。
 *
 * 实证（`Rich4/Save0.dat`，一局进行很久的存档）：
 * ```
 * hostility[0..3] = (0, 0, 0, 0)      ← 真正的敌意值，全为 0
 * +0x5C = 26000                        ← 明显是金额
 * +0x60 = 394432                       ← 明显是金额
 * ```
 * 游戏只有 4 个玩家，敌意值本就只需 4 项。结合颁奖界面的
 * 「本月意外之財：」「本月意外損失：」字样，可判定：
 *
 *   `hostility` 实为 4 项，0x5C 与 0x60 是两个独立的月度金额累加字段。
 *
 * 字段名按推断命名，但**语义仍标为待确认**（C-FID-2）。
 */
export interface MonthlyAccumulators {
  /**
   * @source player +0x5C（原 h 文件误标为 `hostility[4]`）—— **本月意外損失**。
   *
   * ★★ 2026-09-19 订正（§7.140）：原版**自己的 UI 串**把它画在损失那一行 ——
   * `0x464def`「本月意外損失：」在 y=0x184（= `+0x5c` 行）、
   * `0x464dfe`「本月意外之財：」在 y=0x196（= `+0x60` 行）。
   * 先前这里两个字段的**名字与含义正好相反**（把 +0x5c 叫 windfall）。
   * 算式不变（仍是 `+0x5c − +0x60`，即「損失 − 之財」），但名字按 exe 的语义摆正。
   */
  unexpectedLoss: number;
  /** @source player +0x60（原 h 文件误标为 `hostility[5]`）—— **本月意外之財**（见上） */
  windfall: number;
  /** @source player +0x42 —— player_info.h 名为 total_winter_sleep_days（u8，零扩展） */
  f42: number;
  /** @source player +0x44 —— **有符号 16 位**（原版是 `movsx`，订正于 §7.140） */
  f68: number;
}

/**
 * 每个「本月倒楣天数」在评分中折算的金额。
 * @source rich4.asm:16680 `imul ebx, ebx, 0x9c4`（0x9c4 = 2500）
 */
export const UNLUCKY_DAY_WEIGHT = 0x9c4; // 2500

/**
 * `f68` 在评分中的权重。
 * @source rich4.asm:16684-16687 `edx = f68*4 + f68; edx += edx`（即 ×10）
 */
export const F68_WEIGHT = 10;

/**
 * 月度奖项评分（「本月悲情人物」分：越惨分越高）。
 *
 * @source rich4.asm:16668-16690
 * ```
 * score = (player[0x5C] - player[0x60])          ; 本月意外損失 − 本月意外之財
 *       + player[0x42] * price_index * 2500
 *       + (int16)player[0x44] * 10
 * ```
 *
 * ⚠️ **32 位回绕照抄**：原版全程用 32 位 `imul`/`add`/`lea`，**不留 64 位中间值**
 *   （差分实证：天=255 时物價 3369 ⇒ 原版 −2147229796；`+0x5c=0x7fffffff`、
 *   `+0x60=−1` ⇒ 原版 −2147483648）。故这里显式 `| 0` 截成 32 位有符号。
 *   见 `rich4-spec/tests/test_monthly_score.py`（331/331）。
 */
export function monthlyScore(acc: MonthlyAccumulators, priceIndex: number): number {
  return (
    (acc.unexpectedLoss -
      acc.windfall +
      acc.f42 * priceIndex * UNLUCKY_DAY_WEIGHT +
      acc.f68 * F68_WEIGHT) |
    0
  );
}

/**
 * 颁奖所需的最小领先幅度。
 *
 * @source rich4.asm:16745 `fcomp qword [ref_00464d58]`
 *   常量 dd 0x9999999a / 0x3fd99999 → double **0.4**
 *   随后 `jbe → 不颁奖`，故须**严格大于** 0.4。
 */
export const AWARD_MARGIN = 0.4;

/**
 * 评选月度奖项得主。
 *
 * 规则：取最高分者；若 `(最高分 − 次高分) / 最高分 <= 0.4`，则**无人获奖**。
 * 另有两个前置：最高分为 0、或次高分为 0 时，一律不颁奖。
 *
 * @source rich4.asm:16736-16752
 * @returns 得主在候选列表中的下标；无人获奖返回 -1
 */
export function pickAwardWinner(scores: readonly number[]): number {
  if (scores.length === 0) return -1;

  // 第一轮：找最高分
  let max = 0;
  let maxAt = 0;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i]!;
    if (max < v) {
      max = v;
      maxAt = i;
    }
  }

  // 第二轮：把最高分清零后再找最高，即次高分
  //   @source loc_00437d9d：遍历中遇到等于 max 的项就置 0，再取剩余最大
  let second = 0;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i] === max ? 0 : scores[i]!;
    if (second < v) second = v;
  }

  if (max === 0 || second === 0) return -1;

  // 原版此处用 x87 浮点：ratio = (max - second) / max，再与 0.4 比较，jbe 则不颁奖。
  // 这里改写为**完全等价的整数比较**，以满足 C-DET-3（禁止浮点参与金额运算）：
  //     (max - second) / max > 0.4
  //   ⟺ 10·(max - second) > 4·max        （max > 0）
  //   ⟺ 3·max > 5·second
  // 两者在 int32 量级内严格等价：原版比较的 0.4 是 double，比精确的 0.4
  // 大约 2.2e-17；要让某个 (max-second)/max 落进这条缝，max 需超过 4.5e16，
  // 而评分不可能达到该量级。
  return 3 * max > 5 * second ? maxAt : -1;
}

/**
 * 评选本月首富。
 *
 * 与奖项不同，**没有领先幅度门槛**，单纯取总资产最高者。
 * 平手时取先出现者（原版用 `jge` 跳过替换）。
 *
 * @source rich4.asm:16763 fcn_00437dfe
 * @param wealth 各候选玩家的总资产（由 `_rich4_calculate_player_wealth` 得出）
 * @returns 首富在候选列表中的下标；全部 <= 0 时返回 0
 */
export function pickRichest(wealth: readonly number[]): number {
  let best = 0;
  let at = 0;
  for (let i = 0; i < wealth.length; i++) {
    const w = wealth[i]!;
    if (best < w) {
      best = w;
      at = i;
    }
  }
  return at;
}

/**
 * 累加「本月倒楣天數」(`player + 0x42`)。
 *
 * ★ **字段名是误名**：`Player.totalWinterSleepDays` 沿自早期线索源，原版从没这么叫过。
 *   月结屏的读点给出真名——
 * ```asm
 * 004387a8  mov  al, byte ptr [0x48c42f]        ; 取本屏要显示的那一位
 * 004387ba  imul eax, eax, 0x68
 * 004387bd  mov  al, byte ptr [eax + 0x496baa]  ; ★ 读 +0x42
 * 00438798  mov  eax, 0x464e0d   "本月倒楣天數："
 * 004387c9  mov  eax, 0x464e1c   "%d天"
 * ```
 *   另一处是**月度奖项评分**（VA 0x00437d55，见 `monthlyScore`）：
 *   `分数 += 天数 × 物價指數 × 2500`（`imul ebx, 0x9c4`）。
 *
 * ★ 全 exe 共 **6 处** 8 位累加（自扫 `add byte ptr [… + 0x496baa]`）：
 *
 * | VA | 场景 |
 * |---|---|
 * | `0x0040d431` | 「消失」施加函数 `0x0040d375` —— 命运 6/7（出國觀光／被外星人綁架）与航空转盘 |
 * | `0x0041a83f` | 住宿（旅館過路费尾段 `0x0041a3be`） |
 * | `0x0043d755` | 送入監獄 `0x0043d593` 的**公共尾部**（新判与加刑都走这里） |
 * | `0x0043ee04` | 送入醫院 `0x0043ec3f` 的公共尾部 |
 * | `0x004441a1` | 冬眠卡（card 15，`dh = 5`） |
 * | `0x00444372` | 夢遊卡（card 16，字面量 5） |
 *
 * 外加 `0x00439ede`（月结清零，见 `clearMonthlyAccumulators`）。
 * ★ 六处**全是 8 位加法**（`add byte ptr`），故这里按 256 取模 —— 与存档里的
 *   单字节字段口径一致；不取模的话原版会回绕而本引擎不会。
 */
/**
 * 8 位累加本身 —— 供**就地修改**（`withPlayer` 风格）的调用点使用，
 * 避免把 `& 0xff` 这条口径抄成两份。
 */
export function misfortuneDaysAfter(current: number, days: number): number {
  return (current + days) & 0xff;
}

/** 不可变版本：返回带新值的新玩家对象 */
export function addMisfortuneDays(player: Player, days: number): Player {
  if (days === 0) return player;
  return { ...player, totalWinterSleepDays: misfortuneDaysAfter(player.totalWinterSleepDays, days) };
}

/**
 * 月结**收尾**：把三项月度累加器清零。
 *
 * @source `0x00439ec6`–`0x00439ef3`（月度结算函数 `0x00439bfa` 的**最后**一段）：
 * ```asm
 * 00439ec6  xor  eax, eax
 * 00439ec8  mov  al, byte ptr [0x48c420]        ; 参与人数（0x439bfa 里按 who_plays!=0 填充）
 * 00439ecd  cmp  ebx, eax
 * 00439ecf  jge  0x439ef5
 * 00439ed3  mov  al, byte ptr [ebx + 0x48c418]  ; 玩家 id 列表
 * 00439ed9  imul eax, eax, 0x68
 * 00439ede  mov  byte ptr [eax + 0x496baa], ch  ; ★ p+0x42 = 0  本月倒楣天數
 * 00439ee6  mov  dword ptr [eax + 0x496bc4], esi ; ★ p+0x5c = 0  monthlyPaid
 * 00439eec  mov  dword ptr [eax + 0x496bc8], esi ; ★ p+0x60 = 0  monthlyReceived
 * ```
 *
 * ★ 为什么必须做：月度奖项评分（`monthlyScore`）与月结屏的「本月意外之財／損失」
 *   **直接读这三个累计值**。不清零 ⇒ 从**第 2 个月起**它们变成跨月累计，
 *   奖项与显示全部失真。此前只有开局（`new-game`）与破产（`bankruptcy`）会清零，
 *   **月结路径一处都没有**。
 */
export function clearMonthlyAccumulators(player: Player): Player {
  if (
    player.totalWinterSleepDays === 0 &&
    player.monthlyPaid === 0 &&
    player.monthlyReceived === 0
  ) {
    return player;
  }
  return { ...player, totalWinterSleepDays: 0, monthlyPaid: 0, monthlyReceived: 0 };
}

/**
 * 对一名玩家执行月度结算。
 *
 * @source 月度结算函数 `0x00439bfa` —— 存款利息与「收尾清零」在**同一个函数**里，
 *   故这里合并成一个入口，避免调用方只做一半（那正是先前的缺陷）。
 */
export function settleMonthlyBank(player: Player): Player {
  const cleared = clearMonthlyAccumulators(player);
  const newBank = applyMonthlyInterest(cleared.moneyInBank, cleared.loan);
  return newBank === cleared.moneyInBank ? cleared : { ...cleared, moneyInBank: newBank };
}
