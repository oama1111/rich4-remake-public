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
import { calculateLandToll, tollLands } from './toll.ts';
import { transferMoney, type Company } from './payment.ts';
import { adjustTollByGod } from './god-toll.ts';
import { truncTowardZero } from './rounding.ts';
import { updateHostility } from './hostility.ts';

/**
 * 住宅「請付…元」那一句最后那个 `%s`（费名）= **「過路費」**。
 *
 * @source 0x00419d2e / 0x00419d63 两处都是 `mov eax, dword [0x47517c]`
 *   —— 取的是那张 13 项费名指针表的**第 0 项**；`dump 0x47517c 4 4` 读出来
 *   是 `0x0046388a`，该地址上的串 =「過路費」（`dump 0x46388a 6 1`）。
 *
 * ⚠️ 与 `places/company.ts` 的 `FEE_NAMES[0]` 是**同一个串**（同一张表）。
 *   这里另立一个常量只是为了让 `rules/` 不必反向 import `places/`
 *   （`places/company.ts` 已经 import 了 `rules/facility.ts`，反过来会成环）。
 */
export const LAND_TOLL_FEE_NAME = '過路費';

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
  /**
   * 同盟者那一份的**原始**租金（`[esp+0xcc]`，第二次 `calculate_land_toll` 的结果；无同盟 = 0）。
   * 敌意那一步要用它：`0x00419d8e mov edi, [esp+0xcc] / sub edx, edi` —— 地主那份的敌意按
   * 「调整后总额 − 同盟原始份」算，同盟那份按「同盟原始份」算（见 `rentHostility`）。
   */
  allyToll: number;
  /**
   * ★ 第十四份：**地主那一份的应收额**（付款之前算的，不因付款人掏不出而截断）——
   *   原版 `0x00419f92 ebx = ebp − 同盟份` → `0x00419fa1 call 0x44f354(地主, ebx)`（有同盟）、
   *   `0x00419ff0 call 0x44f354(地主, ebp)`（无同盟）都在 `pay_money` **之前**。纯表现（進帳台词）。
   */
  ownerDue: number;
  /**
   * 「算进这笔过路费」的地块 **id**（含同盟那一份），照棋盘顺序。
   *
   * ★ W-69：原版在收费**之前**把这几块一起闪一遍（`0x00419b9e` 起把 id 图上的
   *   这些格标 `0xffff`）—— 需求方就是看不到这一段才以为「只触发当格」。
   *   只有 `counted.length > 1` 时表现层才放；单块地没有这段演出。
   */
  counted: number[];
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
 * ⚠️ `call 0x00457dbc` 是 `__round_toward_zero` —— **向零截断**，
 *   不是就近取偶、也不是 `Math.round`。比例 0.5 且实付为奇数时两者差 1
 *   （`allianceShareOf(1, 1, 1)`：原版给 0，`Math.round` 给 1）。
 *   判据见 `rules/rounding.ts`。
 *
 * ⚠️ **必须用 float32 而非精确有理数**。原版把比例存成 `dword`（单精度），
 *   再乘回总额取整。`Math.fround` 复现这一步精度损失——去掉它，
 *   在某些金额上会与原版差 1 块钱。
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
  // @source fild(总额) / fmul dword [比例] / call 0x457dbc（向零截断）/ fistp —— 乘回再截断。
  // ★ 2026-09-24 审计订正：乘积**不再**压回 float32。`fmul dword` 只是把单精度的比例装进
  //   x87 寄存器，乘法本身按控制字的精度（Watcom 默认 `0x037f`，PC=11 扩展精度；`0x457dbc`
  //   也只改 RC 不改 PC）算完就直接 `frndint` / `fistp`，中间没有 `fstp dword`。先前的
  //   `Math.fround(payable * ratio)` 会把 6.99999988 这类乘积舍成 7.0 再截断
  //   （总额 10、同盟 7：比例 fround(0.7)=0.699999988 ⇒ 原版同盟得 6，旧式给 7）。
  //   整数（< 2^29）× float32 的乘积在 double 里是精确的，与扩展精度一致。
  return truncTowardZero(payable * ratio);
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
  /**
   * ★ 第十四份：已经调好的实付总额（神明调整在当前玩家身上做过一次，`0x00419d70`）——
   *   嫁禍 / 死神换了付款人之后付的仍是那一笔 `ebp`，不按新付款人的神明再调。
   */
  settledTotal?: number,
): RentResult {
  const ownerIdx = land.owner - 1;
  const owner = players[ownerIdx];
  const none = (): RentResult => ({
    players: [...players],
    total: 0,
    baseTotal: 0,
    godAdjusted: false,
    shares: [],
    allyToll: 0,
    ownerDue: 0,
    bankrupted: false,
    counted: [],
  });
  if (land.owner === 0 || owner === undefined || ownerIdx === payer) return none();

  // 连锁店分支不按地块名分组 @source cmp byte [land+0x18], 0 / jne
  const districtName = land.type === 0 ? land.name : null;
  // ★ W-69：「算进去的每一块」的判据**与金额无关**（只管主人 + 同名 + 类型），
  //   所以先算出来，后面每条返回路径都带上它 —— 原版也是在金额还没定下来
  //   （神明调整、免費卡都在更后面）的时候就把这些格标进 id 图了。
  const memberIds = new Set<number>();
  for (const l of tollLands(lands, land.owner, districtName)) memberIds.add(l.id);
  const allyId0 = owner.alliedPlayer;
  if (allyId0 !== 0) for (const l of tollLands(lands, allyId0, districtName)) memberIds.add(l.id);
  const counted = lands.filter((l) => memberIds.has(l.id)).map((l) => l.id);
  const ownerToll = calculateLandToll(lands, land.owner, priceIndex, districtName);

  // @source 0x00419b09 `cmp byte [land+0x17], 0 / je 不翻 / add ebp, ebp`
  //   —— 落点地块带涨价/查封标记时，**地主那份**租金 ×2；
  //   翻倍只落在 ebp（地主租金）上，同盟那份不跟着翻。
  //   （查封情形在更上游的 0x41d559 九种免收里就拦下了，走不到这里。）
  const ownerPart = land.priceStatus !== 0 ? ownerToll + ownerToll : ownerToll;

  // @source mov al, byte [(owner)*0x68 + 0x496ba9] —— 地主的同盟对象
  const allyId = owner.alliedPlayer;
  const allyToll =
    allyId === 0 ? 0 : calculateLandToll(lands, allyId, priceIndex, districtName);

  const baseTotal = ownerPart + allyToll;
  if (baseTotal === 0) return { ...none(), allyToll, counted };

  // ★ 神明在**付款之前**调整金额（VA 0x0041d709），
  //   财神减免、穷神加成、福神不影响。
  const payerPlayer = players[payer];
  const god =
    settledTotal === undefined
      ? adjustTollByGod(baseTotal, payerPlayer?.godInfo ?? 0)
      : { toll: settledTotal, changed: false };
  const total = god.toll;
  if (total === 0) {
    // ★ 神明把金额抹成 0：钱不收，但「算进去的每一块」照给 —— 原版标地在调整之前
    return { ...none(), total: 0, baseTotal, godAdjusted: god.changed, allyToll, counted };
  }

  const shares: RentShare[] = [];
  let ownerDue = 0;
  let next = [...players];
  let bankrupted = false;

  if (allyId === 0) {
    // @source 无同盟分支 0x00419fcf → 单笔付全额
    const r = transferMoney(next, companies, 0, payer, ownerIdx, total, 0);
    next = r.players;
    bankrupted = r.bankrupted;
    shares.push({ payee: ownerIdx, amount: r.paid });
    ownerDue = total;
  } else {
    // 比例由两份租金决定，再套到（可能被神明改过的）实付总额上。
    // ★ 2026-09-24 审计订正：地主那份用**翻倍之后**的 `ownerPart` —— 原版 `0x00419b0f add ebp, ebp`
    //   （涨价位）在 `0x00419cbd add ebp, edx` / `fild ebp`（比例的分母）**之前**，
    //   分母 = 翻倍后的地主份 + 同盟份。先前传的是未翻倍的 `ownerToll`，涨价地 + 有同盟时比例偏大。
    const allyGets = allianceShareOf(ownerPart, allyToll, total);
    const ownerGets = total - allyGets;
    ownerDue = ownerGets;
    // ★ 顺序照搬：先付地主（0x00419fb4），再付同盟（0x0041a003）
    const r1 = transferMoney(next, companies, 0, payer, ownerIdx, ownerGets, 0);
    next = r1.players;
    shares.push({ payee: ownerIdx, amount: r1.paid });

    const r2 = transferMoney(next, companies, 0, payer, allyId - 1, allyGets, 0);
    next = r2.players;
    shares.push({ payee: allyId - 1, amount: r2.paid });

    bankrupted = r1.bankrupted || r2.bankrupted;
  }

  return { players: next, total, baseTotal, godAdjusted: god.changed, shares, allyToll, ownerDue, bankrupted, counted };
}

/**
 * 付过路费时记下的**敌意**（付款人 → 地主 / 同盟）。
 *
 * ★ 2026-09-24 审计补（先前整段没接）：神明调整之后、免費卡 / 嫁禍卡之前，原版按付的钱记敌意。
 * @source 0x00419d7c `test eax, eax / je 0x41b077`（调整成 0 就连敌意都不记）之后：
 * ```asm
 * ; 有同盟（[esp+0xe4] != 0）：
 * 00419d8e  mov  edi, [esp + 0xcc]          ; 同盟那份（原始）
 * 00419d95  sub  edx, edi                   ; 调整后总额 − 同盟原始份
 * 00419da1  idiv ecx(=100)                  ; 有符号、向零
 * 00419db1  call 0x40df69(当前玩家, 地主, 商)
 * 00419dc5  idiv ecx(=100)                  ; 同盟原始份 / 100
 * 00419df3  call 0x40df69(当前玩家, 同盟 − 1, 商)
 * ; 无同盟：
 * 00419de2  idiv ecx(=100)                  ; 调整后总额 / 100
 * 00419df3  call 0x40df69(当前玩家, 地主, 商)
 * ```
 * 敌意的主语永远是**当前玩家**（`[0x49910c]`）—— 之后嫁禍 / 死神换了付款人也不改。
 * 小財神把总额减半后「总额 − 同盟份」可能为负 ⇒ 对地主的敌意**下降**，照抄。
 */
export function rentHostility(
  players: readonly Player[],
  payer: number,
  ownerIdx: number,
  allyId: number,
  total: number,
  allyToll: number,
): Player[] {
  if (allyId === 0) return updateHostility(players, payer, ownerIdx, Math.trunc(total / 100)).players;
  const next = updateHostility(players, payer, ownerIdx, Math.trunc((total - allyToll) / 100)).players;
  return updateHostility(next, payer, allyId - 1, Math.trunc(allyToll / 100)).players;
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
