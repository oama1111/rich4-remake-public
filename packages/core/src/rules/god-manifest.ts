/*
 * 神明的**落脚顯靈**：天使 / 惡魔 / 土地公（`fcn_0040f381`）与福神（`fcn_0040f8be`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准：`python3 tools/disasm.py va 0x0040f381 400`
 *
 * ## 这一支在回合里的位置（第五份回报第 2 条的根因）
 *
 * 落点例程 `0x0041982d` 的 17 路跳表 `0x4197e9` 里，**只有类型 0**（`0x004198b9`：
 * 住宅地 / 設施 / 企業格）会走到尾块 `0x0041b077`；其余 16 类特殊格一律
 * `jmp 0x41b3d0` 直接返回。类型 0 里**每一条**分支（買地 `0x0041a013`、升級 `0x00419911`、
 * 付过路费 `0x00419a67`、設施三路 …）收尾都汇到这里：
 *
 * ```asm
 * 0041b077  push [esp+0x10c] / push [0x49910c]
 * 0041b086  call 0x40f381            ; ★ 顯靈 —— 在買地/升級/收费**之后**
 * 0041b09d  call 0x448a7e
 * ```
 *
 * ⇒ 天使附身的人**买下**一块空地之后，天使再给它加蓋一层（買之前那块地是 0 级、
 *   買完回到尾块变 1 级）—— 「踩到天使后買房自动加蓋一层」。
 *   另一处调用点 `0x00418f59` 在「走回棋盘」那一回合，人站在監獄/醫院格
 *   （格值 `0x1f41/0x1f42` 不在 2001..5999）⇒ 三支都是空操作，不必接。
 *
 * ## 三支的判据（全部**不看归属**，除非下面写了）
 *
 * | god_info | 入口 | 做什么 |
 * |---|---|---|
 * | 9 天使 | `0x0040f3ff` | `0x40b110(格值)` 加蓋一级；成功才弹「%s顯靈 加蓋一層房屋！」|
 * | 10 惡魔 | `0x0040f521` | `level != 0` 才动：有主 ⇒ 地主对我敌意 `+30×物價`；`0x40ab4a(格值,0)` 拆一级 |
 * | 12 土地公 | `0x0040f68b` | 不是我的 ⇒ 归我（别人的先记一笔「敌意」，见 `seizeHostilityDelta`）|
 *
 * 共同前置（`0x0040f39e` / `0x0040f3ab`）：`byte [player+0x32] != 0`（住宿中）返回、
 * `byte [player+0x15] == 0`（出局）返回。
 *
 * 福神（3 / 4）不在 `0x40f381` 里：它在落点那些「花钱把地/設施拿到手或加盖」的分支收尾处
 * 再 `call 0x40f8be` 一次 —— 说明书那句「蓋房子投資加倍」。
 *
 * ★★ 2026-09-22 订正（第九份试玩回报第 2 条）：**不止「自己地升級成功」那一支**。
 *   旧结论（只 `0x00419a2b` → `0x00419a48`）漏了同一个入口的另外几个源 ——
 *   在 `rich4_player_core_actions.asm` 里搜 `loc_00419a48` / `loc_00419a39` 可见：
 *
 *   | 源 | 行 | 分支 |
 *   |---|---|---|
 *   | `jmp near loc_00419a48` | `:1079` | **買地**（`0x0041a013`：`:1041` 写 owner、`:1069` 扣钱） |
 *   | `jmp near loc_00419a48` | `:1169` | **付費首建設施**（`0x41a25a`：`inc [+0x1a]`、响 `0x4823da`） |
 *   | `jmp near loc_00419a39` | `:1218` | **付費加蓋設施**（`loc_0041a2b3`；到 5 级时 `cmp dh,5 / je 0x4199f1` 绕过） |
 *   | `jmp near loc_00419a48` | `:1726` | **買設施**（`loc_0041a97b`） |
 *   | 落入 `loc_00419a2b` | 自己地升級成功且没到 5 级（`0x419a26 jmp 0x41b077` 是满级那支） |
 *
 *   ⇒ 福神附身时，買地 / 買設施 / 付費首建 / 付費加蓋 / 自己地升級，**五条都白送一级**
 *   （复刻接入点见 `reduce.ts` 那五条 case 里的 `luckyGodBonus`）。
 */

import { GOD_ANGEL, GOD_BIG_LUCK, GOD_DEVIL, GOD_EARTH, GOD_SMALL_LUCK } from './god-power.ts';

/** 落脚顯靈的种类；`null` = 这位神明落脚时什么都不做 */
export type ManifestKind = 'build' | 'demolish' | 'seize';

/**
 * `fcn_0040f381` 的分派。
 *
 * @source `0x0040f3d7 mov al,[player+0x3f]`：`cmp al,0xa / jb → 0x40f3ff（cmp al,9 / jne 返回）`、
 *   `jbe → 0x40f521`（== 10）、`cmp al,0xc / je → 0x40f68b`，其余返回。
 *   ⚠️ 比的是 `god_info`（**槽位**）不是种类 —— 槽位 1..14 恒等于种类（`objects.ts`），
 *   死神的两个槽 15/16 都不在这三个值里，故按值直比与原版等价。
 */
export function manifestKindOf(godInfo: number): ManifestKind | null {
  if (godInfo === GOD_ANGEL) return 'build';
  if (godInfo === GOD_DEVIL) return 'demolish';
  if (godInfo === GOD_EARTH) return 'seize';
  return null;
}

/** 福神（小 3 / 大 4）—— `fcn_0040f8be` 的入口判据 @source `0x0040f8da cmp dl,3 / 0x0040f8df cmp dl,4` */
export function isLuckyGod(godInfo: number): boolean {
  return godInfo === GOD_SMALL_LUCK || godInfo === GOD_BIG_LUCK;
}

/** 惡魔拆屋：地主对我敌意的系数 @source `0x0040f54d..0x0040f559`（`eax+eax; shl 4; sub` = ×30）*/
export const DEVIL_HOSTILITY_FACTOR = 30;

/**
 * 土地公強佔别人的地时，传给 `update_hostility(地主, 我, delta)` 的 `delta`。
 *
 * ★★ **原版这里是个调用约定的 bug，照搬**：
 * ```asm
 * 0040f6c0  ax = word [land+0x1c]              ; 地價（設施是 +0x22）
 * 0040f6ca  imul eax, [0x4990e8]               ; × 物價指數
 * 0040f6d4  fild                                ; → st0
 * 0040f6e7  fild word [level] / fadd 2.0f / fdiv 5.0f / fmulp   ; × (level + 2) / 5
 * 0040f6fc  sub esp,8 / fstp qword [esp]       ; ★ 以 **double（8 字节）** 压栈
 * 0040f702  push ecx(我) / push edx(地主)
 * 0040f705  call 0x40df69
 * ```
 * 而 `0x40df69` 的第三个形参是 **int**（`mov ecx,[esp+0x14]`）⇒ 它读到的是那个 double 的
 * **低 32 位**：乘积恰为「小」整数时低 32 位全 0 ⇒ `delta = 0`；否则是尾数的低位（可正可负）。
 * ⚠️ 次序是 `地價×物價 × ((level+2)/5)`（见函数体），商多半不精确 ⇒ **常常不为 0**。
 *
 * ⚠️ x87 是 80 位中间精度、这里是 double 直算 —— 整除时两者逐位相同；
 *   不整除时理论上可能差最后一位（地價是 100 的倍数，构造上不可达）。
 */
export function seizeHostilityDelta(landPrice: number, priceIndex: number, level: number): number {
  // ★★ 2026-09-24（provenance 审计）订正**求值次序**：原版是 `A × ((level + 2) / 5)` ——
  //   `0x0040f6d4 fild A` 先压、`0x0040f6e7 fild level / fadd 2.0f / fdiv 5.0f` 在 st0 里先算完商、
  //   `0x0040f6fa fmulp` 最后才乘。`(level+2)/5` 多半不是精确二进制小数（1.4、0.4…）⇒ 乘积带尾数，
  //   低 32 位**常常不是 0**（700×1.4 = 979.9999999999999 ⇒ −1）。先前写成 `(A × (level+2)) / 5`
  //   （整除 ⇒ 恒 0），把「土地公強佔几乎恒不结仇」当成了结论。`A` 是 32 位 `imul`（0x0040f6ca）。
  // eslint-disable-next-line no-restricted-syntax -- C-DET-3 的定向豁免：原版这里就是 x87 浮点除（0x0040f6f4 fdiv），要的正是那个 double 的位型
  const value = Math.imul(landPrice, priceIndex) * ((level + 2) / 5);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return view.getInt32(0, true);
}
