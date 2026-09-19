/*
 * 神明对过路费的加成与减免
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：VA 0x0041d709
 *   `int adjust_toll_by_god(int payer, int facility, int toll)`
 *
 * 入口是一张 **6 路跳表**（表在 VA 0x0041d6f1），按付款方的
 * `god_info`（+0x3f）取 1..6 分派；超出范围则原样返回。
 */

/**
 * 各神明对过路费的处理。
 *
 * @source 跳表 0x0041d6f1 的六个分支（`esi` = 原始租金，`ebx` = 调整后）：
 * ```asm
 * god 1 (0x41d741)  sar ebx, 1              ; ÷2
 * god 2 (0x41d758)  xor ebx, esi            ; ebx 初值即 esi → 结果 0
 * god 3 (0x41d79e)  —                       ; 不变
 * god 4 (0x41d79e)  —                       ; 不变
 * god 5 (0x41d76f)  sar ebx,1 / add ebx,esi ; ×1.5
 * god 6 (0x41d788)  lea ebx, [esi + esi]    ; ×2
 * ```
 *
 * 每个分支还会格式化一句提示，其文本正好印证了算式：
 * - 小財神「%s減免一半！」
 * - 大財神「免付%s！」
 * - 小窮神「%s加付50％！」
 * - 大窮神「加倍付%s！」
 *
 * ⚠️ 福神（3/4）**对过路费没有影响**——尽管名字听起来像有。
 *    这条容易想当然写错，故单独列出并有测试钉住。
 */
export const GOD_SMALL_FORTUNE = 1; // 小財神
export const GOD_BIG_FORTUNE = 2; // 大財神
export const GOD_SMALL_LUCK = 3; // 小福神
export const GOD_BIG_LUCK = 4; // 大福神
export const GOD_SMALL_POVERTY = 5; // 小窮神
export const GOD_BIG_POVERTY = 6; // 大窮神

export interface GodTollResult {
  /** 调整后的过路费 */
  toll: number;
  /** 是否真的改变了（原版据此决定要不要弹提示：`cmp ebx, esi / je 跳过`） */
  changed: boolean;
}

/**
 * 按付款方身上的神明调整过路费。
 *
 * ⚠️ `sar ebx, 1` 是**算术右移**，对正数等价于向下取整的 ÷2。
 * 小窮神的 ×1.5 因此是 `toll + floor(toll/2)`，奇数时**少收 1**
 * （例如 999 → 999 + 499 = 1498，而不是 1499）。这点必须照搬。
 *
 * @param godInfo 付款方的 `player.godInfo`（0 表示无附身）
 */
export function adjustTollByGod(toll: number, godInfo: number): GodTollResult {
  // @source dec al / cmp al, 5 / ja 原样返回 —— 只有 1..6 落入跳表
  if (godInfo < GOD_SMALL_FORTUNE || godInfo > GOD_BIG_POVERTY) {
    return { toll, changed: false };
  }

  let next = toll;
  switch (godInfo) {
    case GOD_SMALL_FORTUNE:
      next = toll >> 1; // @source sar ebx, 1（JS `>>` 本就是 32 位算术右移）
      break;
    case GOD_BIG_FORTUNE:
      next = 0; // @source xor ebx, esi（ebx 初值 = esi）
      break;
    case GOD_SMALL_LUCK:
    case GOD_BIG_LUCK:
      break; // ★ 福神不影响过路费
    case GOD_SMALL_POVERTY:
      // ★★ 2026-09-19 补（§7.142，通道 2 `test_god_toll_wheel.py` 352/352）：
      //   原版 `add ebx, esi` 只留低 32 位 ⇒ 显式 `| 0`。
      //   （例：toll=0x7fffffff ⇒ 原版 −1073741826，不回绕会得 3221225470。）
      next = ((toll >> 1) + toll) | 0; // @source sar ebx,1 / add ebx,esi
      break;
    case GOD_BIG_POVERTY:
      // @source lea ebx, [esi + esi] —— 同样是 32 位回绕
      next = (toll + toll) | 0;
      break;
    default:
      break;
  }

  // @source cmp ebx, esi / je 不弹提示
  return { toll: next, changed: next !== toll };
}

/**
 * 设施过路费的基数。
 * @source `mov eax, 1 / shl eax, cl` 后的移位链凑出 `500 × k`：
 * `k → 4k → 3k → 24k → 25k → 100k → 400k → 500k`
 */
export const FACILITY_TOLL_BASE = 500;

/**
 * 由 `traffic_method` 低 2 位得出的费率倍数 `k = 1 << ((tm & 3) - 1)`。
 *
 * @source VA 0x0041a4e4：
 * ```asm
 * mov  dh, byte [player + 0x11]   ; traffic_method
 * test dh, 3
 * je   0x41a581                   ; ★ 低 2 位为 0 → 跳过计算，ebp 仍是 0
 * mov  al, dh / and al, 3
 * cl = al - 1
 * mov eax, 1 / shl eax, cl        ; k = 1 << (tm&3 - 1) → 1 / 2 / 4
 * ```
 *
 * ⚠️ 费率取决于**付款方的交通工具**，不是设施本身的属性。
 * 低 2 位为 0（没有交通工具）时**完全不收费**。
 */
export function trafficMultiplier(trafficMethod: number): number {
  const low = trafficMethod & 3;
  if (low === 0) return 0; // @source test dh,3 / je → ebp 保持 xor 出来的 0
  return 1 << (low - 1);
}

/**
 * 设施过路费。
 *
 * @source VA 0x0041a520：
 * ```asm
 * mov  ebp, dword [0x48bafc]      ; ★ 本次掷骰总步数 steps_total
 * imul ebp, eax                   ; × 500k
 * imul ebp, dword [0x4990e8]      ; × 物价指数
 * ```
 *
 * 即 `步数 × 500 × k × 物价指数`。
 *
 * 这是设施与住宅的根本差别：住宅按**同区地块的等级租金之和**算，
 * 与怎么走到的无关；设施按**你这一掷走了多少步**、**坐什么交通工具**算。
 */
export function facilityToll(
  stepsTotal: number,
  trafficMethod: number,
  priceIndex: number,
): number {
  return stepsTotal * FACILITY_TOLL_BASE * trafficMultiplier(trafficMethod) * priceIndex;
}
