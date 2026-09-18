/*
 * 换地卡 / 红卡 / 黑卡
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 */

import type { FacilityInfo, LandInfo } from '../loaders/map.ts';
import type { StockState } from '../places/stock.ts';
import { misalignedDoubleInt } from '../rules/hostility.ts';

// ============================================================
//  换地卡（4）
// ============================================================

/**
 * 换地卡的选择参数 —— 由**脚下那一格**决定用哪一个：
 *   脚下是地块 → `0xe0c0202`（@source VA 0x00442685）
 *   脚下是設施 → `0xe0c0204`（@source VA 0x004428cc）
 * 两者组号相同（2 = 换地/换屋的额外规则），只有类别位不同。
 */
export const SWAP_LAND_SELECTION_PARAM = 0xe0c0202;
export const SWAP_LAND_FACILITY_SELECTION_PARAM = 0xe0c0204;

export interface SwapLandResult {
  lands: LandInfo[];
  ok: boolean;
}

/**
 * 换地卡：**交换两块地的归属**。
 *
 * @source VA 0x004427bb:
 * ```asm
 * mov byte [esi + 0x19], bl     ; 地块A.owner = 原B的owner
 * mov byte [edi + 0x19], al     ; 地块B.owner = 原A的owner
 * ```
 *
 * 只换 `owner`，**等级与类型原地不动**——换过去的地连同上面的房子一起易主。
 */
export function applySwapLandCard(
  lands: readonly LandInfo[],
  landIdA: number,
  landIdB: number,
): SwapLandResult {
  const a = lands.find((l) => l.id === landIdA);
  const b = lands.find((l) => l.id === landIdB);
  if (a === undefined || b === undefined || landIdA === landIdB) {
    return { lands: [...lands], ok: false };
  }
  const next = lands.map((l) => {
    if (l.id === landIdA) return { ...l, owner: b.owner };
    if (l.id === landIdB) return { ...l, owner: a.owner };
    return l;
  });
  return { lands: next, ok: true };
}

export interface SwapFacilityResult {
  facilities: FacilityInfo[];
  ok: boolean;
}

/**
 * 换地卡对**設施**：与地块路径完全同形 —— **只换归属**。
 *
 * @source 换地卡設施分支 VA 0x00442a09（`edi` = 脚下設施、`esi` = 选中設施，
 *   `bl` = 脚下設施原主、`[esp]` = 选中設施原主）：
 * ```asm
 * mov byte [esi + 0x19], bl     ; 选中設施.owner = 脚下設施原主
 * mov al, byte [esp]
 * mov byte [edi + 0x19], al     ; 脚下設施.owner = 选中設施原主
 * ```
 *
 * 只写 `+0x19`（owner）：**等级 `+0x1a` 与种类 `+0x18` 原地不动**
 * （兩条路径各有一处 `animate_object`，纯表现，不落 core）。
 *
 * ⚠️ 與換屋卡（`applySwapHouseFacilityCard`）的区别同地块路径：
 *   換地換 owner、換屋換 `+0x18/+0x1a`。
 */
export function applySwapFacilityCard(
  facilities: readonly FacilityInfo[],
  facilityIdA: number,
  facilityIdB: number,
): SwapFacilityResult {
  const a = facilities.find((f) => f.id === facilityIdA);
  const b = facilities.find((f) => f.id === facilityIdB);
  if (a === undefined || b === undefined || facilityIdA === facilityIdB) {
    return { facilities: [...facilities], ok: false };
  }
  const next = facilities.map((f) => {
    if (f.id === facilityIdA) return { ...f, owner: b.owner };
    if (f.id === facilityIdB) return { ...f, owner: a.owner };
    return f;
  });
  return { facilities: next, ok: true };
}

// ============================================================
//  红卡（24）/ 黑卡（25）—— 操纵股票
// ============================================================

/**
 * 红卡与黑卡都写 `stock_info` 偏移 +7 的 **`newsFlag`**（旧称 f7）。
 *
 * `newsFlag` 是**两个 4 位计数器**：高半字节 = 利多还剩几天，
 * 低半字节 = 利空还剩几天。非 0 时当日趋势固定 ±10%（利多优先），
 * 每日两个半字节各减 1（VA 0x0041cff9，见 stock-market.ts 的
 * `tickStockCountdowns`）。
 *
 * @source 红卡 VA 0x00444f88 `mov byte [ebx + 0x496987], 0x20`
 *   → **利多 2 天**（`stocks_on_map` 基址 0x496980，故 0x496987 = +0x07）
 * @source 黑卡 VA 0x004450f6 `mov byte [eax*4 + 0x496987], 2`
 *   → **利空 2 天**
 *
 * ⚠️ 两卡都是**整字节覆盖**：紅卡会清掉残存的利空天数，黑卡反之。照搬原版。
 */
export const RED_CARD_NEWS_FLAG = 0x20;
export const BLACK_CARD_NEWS_FLAG = 0x02;

export interface StockNewsResult {
  /** 12 支股票（仅目标股的 newsFlag 被改写） */
  stocks: StockState[];
  /** 命中的股票下标；越界为 -1 */
  affected: number;
}

/**
 * ★★ 黑卡尾部的敌意循环：`持股 × 价差 ÷ 200` 的 **double 低 32 位**才是写进关系值的数。
 *
 * @source VA 0x00445164–0x004451c7：
 * ```asm
 * 00445170  fld   dword ptr [esp + edx*4 + 0x7c]   ; 旧价快照（函数开头存的）
 * 00445174  fsub  dword ptr [eax*4 + 0x496994]     ; − 现价 ⇒ 价差（float32）
 * 0044517b  fstp  dword ptr [esp + 0xc4]
 * 0044519d  cmp   dword ptr [eax + 0x497198], 0    ; 持股 0 ⇒ 跳过
 * 004451a6  fild  dword ptr [eax + 0x497198]       ; 持股（int）
 * 004451ac  fmul  dword ptr [esp + 0xc4]           ; × 价差
 * 004451b3  fdiv  dword ptr [0x4653bc]             ; ÷ 200.0f
 * 004451b9  sub   esp, 8
 * 004451bc  fstp  qword ptr [esp]                  ; ★ 按 **double** 压栈（8 字节）
 * 004451c7  call  0x40df69                         ; update_hostility(p, cur, ?)
 * ```
 * 被调方 `0x40df69` 的序是 `(a, b, delta)`：它的 `mov ecx, [esp+0x14]`（prologue 两个 push
 * 之后）= 调用方 `[esp+0xc]` = **那个 double 的低 32 位**。故真正落库的是低 32 位，不是
 * `shares*delta/200` 本身。
 *
 * ★★ **实测（`rich4-spec/tests/test_stock_alliance_cards.py` 40/40，`0x40df69` 真跑）**：
 *   低 32 位**经常不是 0** —— 持股 10、价差 0.3 ⇒ **1717986918**；持股 3 ⇒ **−687194767**
 *   （负增量在关系值为 0 时被 `0x40df83` 提前返回，看不到）；持股 100、价差 0.3 恰好为 0；
 *   价差取整数档（10.0）时为 0。
 *
 *   ⚠️ **本节此前写着「priceDiff 恒为 0 / double 低 32 位所以恒为 0」——两条都错**：
 *   ① 价差不是 0：写 `newsFlag` 之后**紧接着**就调 `0x429040` 重算了价（见下面注释）；
 *   ② 低 32 位大多数情况下非 0。⇒ 黑卡**确实**会大幅改动受害者的关系值
 *   （进而影响「最敵對玩家」判定与同盟解除），复刻必须照做。
 *
 * @param holders 每个玩家的持股数（`holdings[p][stockIndex]`，原版 1-based 索引等价）
 * @param currentPlayer 出牌者（敌意的对象）
 * @returns 关系值增量列表（`from` = 持股者，`to` = 出牌者）
 */
export function blackCardHostilityDeltas(
  holders: readonly number[],
  currentPlayer: number,
  oldPrice: number,
  newPrice: number,
): { from: number; to: number; delta: number }[] {
  // ★ 两个价格都是**存在状态里的 float32**（`fld dword [旧]` / `fsub dword [现价]`），
  //   相减后 `fstp dword [esp+0xc4]` 再舍成 float32 ⇒ 必须先各自 fround、再对差 fround。
  //   （直接把两个 JS double 相减再 fround 会得到另一个 delta：100-99.7 的
  //    double 差是 0.30000000000000004 ⇒ fround = 0.30000001192092896，
  //    而原版是 fround(100 − fround(99.7)) = 0.3000030517578125。）
  const priceDiff = Math.fround(Math.fround(oldPrice) - Math.fround(newPrice));
  const out: { from: number; to: number; delta: number }[] = [];
  for (let p = 0; p < holders.length; p += 1) {
    const shares = holders[p] ?? 0;
    if (shares === 0) continue;
    // x87：`fild 持股 / fmul 价差 / fdiv 200.0f` ⇒ 扩展精度，最后 `fstp qword` 舍成 double
    // ⚠️ C-DET-3 的定向豁免：这一处要的是**位级复现**，不是账目金额 ——
    //   原版 `fdiv` 的商不落内存（直接进 x87 栈），`fstp qword` 才舍成 double；
    //   写成 `Math.trunc`/`Math.fround` 都会改掉「低 32 位」（本函数的全部意义所在）。
    // eslint-disable-next-line no-restricted-syntax
    const v = (shares * priceDiff) / 200;
    // ★ 取值统一走 `rules/hostility.ts` 的共享实现（三处同族调用点：卡 3/8/25）
    const low = misalignedDoubleInt(v);
    out.push({ from: p, to: currentPlayer, delta: low });
  }
  return out;
}

/**
 * 红卡：把指定股票的 `newsFlag` 置为 0x20（**利多 2 天**）。
 * @source VA 0x00444f25（AI 分支选股经 `0x41e6f2(0)`，写入点 0x00444f88）
 *
 * ⚠️ 红卡**没有**敌意段（黑卡有，见 `blackCardHostilityDeltas`）。
 */
export function applyRedCard(stocks: readonly StockState[], stockIndex: number): StockNewsResult {
  return writeNewsFlag(stocks, stockIndex, RED_CARD_NEWS_FLAG);
}

/**
 * 黑卡：把指定股票的 `newsFlag` 置为 0x02（**利空 2 天**）。
 * @source VA 0x0044503f（写入点 0x004450f6）
 */
export function applyBlackCard(stocks: readonly StockState[], stockIndex: number): StockNewsResult {
  return writeNewsFlag(stocks, stockIndex, BLACK_CARD_NEWS_FLAG);
}

/** @source `mov byte [stock*36 + 0x496987], imm` —— 整字节覆盖 */
function writeNewsFlag(
  stocks: readonly StockState[],
  stockIndex: number,
  value: number,
): StockNewsResult {
  const target = stocks[stockIndex];
  if (target === undefined) {
    return { stocks: [...stocks], affected: -1 };
  }
  const next = stocks.map((s, i) => (i === stockIndex ? { ...s, newsFlag: value } : s));
  return { stocks: next, affected: stockIndex };
}
