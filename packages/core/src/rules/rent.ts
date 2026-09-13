/*
 * 过路费的收取与同盟分账
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准，落点结算函数内 VA 0x00419a9d 起。
 *
 * 租金的**计算**在 `rules/toll.ts`；本模块负责**分账与收取**。
 * 两者分开是因为原版也分开：`calculate_land_toll`（VA 0x00419744）
 * 被调用**两次**——一次算地主的，一次算地主同盟者的。
 */

import type { Player } from '../state/types.ts';
import type { LandInfo } from '../loaders/map.ts';
import { calculateLandToll } from './toll.ts';
import { transferMoney, type Company } from './payment.ts';
import { adjustTollByGod } from './god-toll.ts';

export interface RentShare {
  /** 收款方玩家下标 */
  payee: number;
  /** 该方实收金额 */
  amount: number;
}

export interface RentResult {
  players: Player[];
  /** 租金总额（地主份 + 同盟份，且已按付款方身上的神明调整） */
  total: number;
  /** 神明调整**之前**的租金，用于对照与提示 */
  baseTotal: number;
  /** 是否被神明改过金额 */
  godAdjusted: boolean;
  /** 实际分账明细，无同盟时只有一项 */
  shares: RentShare[];
  /** 付款方是否因此破产 */
  bankrupted: boolean;
}

/**
 * 同盟分账比例。
 *
 * @source VA 0x00419cb6：
 * ```asm
 * mov  edx, [esp + 0xcc]       ; 同盟那一份
 * add  ebp, edx                ; ★ 总额 = 地主份 + 同盟份
 * fild (edx) / fild (ebp) / fdivp
 * fstp dword [esp + 0xc4]      ; ★ 比例 = 同盟份 / 总额（**float32**）
 * ```
 * 随后（VA 0x00419f76）：
 * ```asm
 * fild(总额) / fmul [esp+0xc4] / call 0x457dbc / fistp [esp+0xcc]
 * mov ebx, ebp / sub ebx, [esp+0xcc]    ; 地主得 = 总额 - 同盟得
 * ```
 *
 * ⚠️ **必须用 float32 而非精确有理数**。原版把比例存成 `dword`（单精度），
 * 再乘回总额取整。`Math.fround` 复现这一步精度损失——去掉它，
 * 在某些金额上会与原版差 1 块钱。
 *
 * 数学上 `总额 × (同盟份/总额)` 本该恰好等于同盟份，但单精度舍入
 * 会让结果偏离，**这个偏差是原版行为的一部分**（C-FID-2）。
 */
export function allianceShareOf(
  ownerToll: number,
  allyToll: number,
  payable: number = ownerToll + allyToll,
): number {
  const total = ownerToll + allyToll;
  if (total === 0) return 0;
  // @source fdivp 后 fstp dword —— 单精度（包在 Math.fround 里，C-DET-3 允许）
  const ratio = Math.fround(allyToll / total);
  // @source fild(总额) / fmul / call 0x457dbc / fistp —— 乘回再取整
  return Math.round(Math.fround(payable * ratio));
}

/**
 * 收取过路费。
 *
 * 原版流程（VA 0x00419a9d 起）：
 * 1. `ally = player[地主].allied_player`（0 表示无同盟）
 * 2. `ownerToll = calculate_land_toll(地主, 地块名)`
 * 3. 有同盟则 `allyToll = calculate_land_toll(同盟者, 地块名)`
 * 4. `total = ownerToll + allyToll`
 * 5. 有同盟：`pay_money(付款方, 地主, total - 同盟得, 0)`
 *            `pay_money(付款方, 同盟, 同盟得, 0)`
 *    无同盟：`pay_money(付款方, 地主, total, 0)`
 *
 * ★ 关键效果：**结盟后，盟友名下同名地块的租金会并入你的收租**，
 *   再按两份的比例分账。这是原版同盟的核心收益。
 *
 * ★ 与买地盖房的根本差别：付租金**走 `pay_money`**，
 *   现金不够会动用存款，两者都空则破产（见 rules/purchase.ts 的对比）。
 *
 * @param payer  付款方玩家下标
 * @param land   落点地块
 * @param lands  全部地块（算租金要扫同名地块群）
 */
export function collectRent(
  players: readonly Player[],
  lands: readonly LandInfo[],
  payer: number,
  land: LandInfo,
  priceIndex: number,
  companies: readonly Company[] = [],
): RentResult {
  const ownerIdx = land.owner - 1;
  const owner = players[ownerIdx];
  const none = (): RentResult => ({
    players: [...players],
    total: 0,
    baseTotal: 0,
    godAdjusted: false,
    shares: [],
    bankrupted: false,
  });
  if (land.owner === 0 || owner === undefined || ownerIdx === payer) return none();

  // 连锁店分支不按地块名分组 @source cmp byte [land+0x18], 0 / jne
  const districtName = land.type === 0 ? land.name : null;
  const ownerToll = calculateLandToll(lands, land.owner, priceIndex, districtName);

  // @source mov al, byte [(owner)*0x68 + 0x496ba9] —— 地主的同盟对象
  const allyId = owner.alliedPlayer;
  const allyToll =
    allyId === 0 ? 0 : calculateLandToll(lands, allyId, priceIndex, districtName);

  const baseTotal = ownerToll + allyToll;
  if (baseTotal === 0) return none();

  // ★ 神明在**付款之前**调整金额（VA 0x0041d709），
  //   财神减免、穷神加成、福神不影响。
  const payerPlayer = players[payer];
  const god = adjustTollByGod(baseTotal, payerPlayer?.godInfo ?? 0);
  const total = god.toll;
  if (total === 0) {
    return { ...none(), total: 0, baseTotal, godAdjusted: god.changed };
  }

  const shares: RentShare[] = [];
  let next = [...players];
  let bankrupted = false;

  if (allyId === 0) {
    // @source 无同盟分支 0x00419fcf → 单笔付全额
    const r = transferMoney(next, companies, 0, payer, ownerIdx, total, 0);
    next = r.players;
    bankrupted = r.bankrupted;
    shares.push({ payee: ownerIdx, amount: r.paid });
  } else {
    // 比例由两份**原始**租金决定，再套到（可能被神明改过的）实付总额上
    const allyGets = allianceShareOf(ownerToll, allyToll, total);
    const ownerGets = total - allyGets;
    // ★ 顺序照搬：先付地主（0x00419fb4），再付同盟（0x0041a003）
    const r1 = transferMoney(next, companies, 0, payer, ownerIdx, ownerGets, 0);
    next = r1.players;
    shares.push({ payee: ownerIdx, amount: r1.paid });

    const r2 = transferMoney(next, companies, 0, payer, allyId - 1, allyGets, 0);
    next = r2.players;
    shares.push({ payee: allyId - 1, amount: r2.paid });

    bankrupted = r1.bankrupted || r2.bankrupted;
  }

  return { players: next, total, baseTotal, godAdjusted: god.changed, shares, bankrupted };
}

/**
 * 触发地主台词的租金阈值 = 物价指数 × 9000。
 * @source `imul eax, dword [0x4990e8], 0x2328`（VA 0x0044f360）
 *
 * 表现层用，core 不依赖。
 */
export const LANDLORD_REMARK_THRESHOLD_FACTOR = 9000;

/**
 * 触发付款方台词的租金阈值 = 物价指数 × 5000。
 * @source VA 0x0044f505 的移位序列 `pi*5 → *8 → -pi → *16 → +pi → *8`
 */
export const PAYER_REMARK_THRESHOLD_FACTOR = 5000;
