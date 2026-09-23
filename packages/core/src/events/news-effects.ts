/*
 * 新聞事件的效果
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 与命運事件同为两阶段结构（先公告、后施加），金额也同为
 * `物价指数 × factor`，故复用同一套方向语义。
 *
 * ⚠️ 与命運的**关键差别**：新聞事件大多**不作用于当前玩家**。
 * 文案里的 `%s` 是被点名的对象——「公開表揚第一大地主%s獲得%d元獎勵」
 * 的受益者是**地主**，不是抽到这张新闻的人。
 * 因此本模块的接口要求调用方**显式给出受影响的玩家**，
 * 不像命運那样默认取 `currentPlayer`。
 */

import type { Player } from '../state/types.ts';
import { NEWS_EVENTS, eventAmount, newsEvent } from '@rich4/data';
import { PARTY_POOL, receiveMoney, transferMoney } from '../rules/payment.ts';
import { CONFINEMENT_SLOTS, sendToConfinement } from '../rules/confinement.ts';
import type { MapNode, LandscapeInfo } from '../loaders/map.ts';
import type { MapObject } from '../cards/summon.ts';
import {
  HISTORY_DAYS,
  applyStockNews,
  type StockMarketState,
} from '../places/stock-market.ts';
import type { CommercialInfo } from '../loaders/map.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { WHO_PLAYS_HUMAN, isAlive } from '../state/types.ts';
/*
 * ★ 新聞 29 的「免罪(21) → 嫁禍(19)」二级判定**复用** `0x441210` 那一段的既有镜像
 *   —— `cards/passive.ts` 的 `applyDefensiveCards`（顺序、扣卡点都在那里钉过）。
 *   别在新闻这一支另写一份：`0x441210` 与夢遊卡/陷害卡/查稅卡撞的是同一个函数。
 */
import { PASSIVE_CARDS, applyDefensiveCards, consumeCard } from '../cards/passive.ts';
import { blessingMultiplier } from '../rules/blessing.ts';
import { bankDividend, incomeTax, propertyTax, stockTax } from '../rules/percentage.ts';
import type { LandInfo, FacilityInfo } from '../loaders/map.ts';
import { releaseConfinedPlayers } from '../rules/blocking.ts';
import {
  MUTATE_CLEAR_OWNER,
  MUTATE_DEMOLISH_ONE,
  mutateFacility,
  mutateLand,
} from '../cards/monster.ts';
// ★ 新聞 4 与飛彈/核彈/颱風走的是**同一个** `damage_area`（`0x40ac7b`），
//   逐块地的重击效果直接复用 `rules/tool-effects.ts` 的 `blastLand`。
import { blastLand } from '../rules/tool-effects.ts';
import { ESTATE_FACILITY_BASE, ESTATE_LAND_BASE } from '../places/notice-board.ts';

/**
 * 新聞拆屋类效果尾部的**全场释放** `0x0040dffa()`（见 `rules/blocking.ts`）。
 * 原版这一步在 `mutate_land`/`mutate_facility` 里，故凡是走这两个函数的新闻
 * （颱風 / 地震 / 拆屋 / 夷平）都要按 mutate 返回值决定是否放人。
 */
function applyRelease(players: Player[], flags: readonly boolean[]): Player[] {
  return flags.some(Boolean) ? releaseConfinedPlayers(players) : players;
}

export interface NewsEffectResult {
  players: Player[];
  /**
   * 物件表 —— **只有** `prison`/`hospital` 效果里首次关押会换掉它：
   * 跟班物件要跟着玩家搬进监狱／医院格（`@source 0x43d668 call 0x40fc00`）。
   */
  objects: MapObject[];
  pool: number;
  /**
   * 监狱占用表（`0x496b30`，8 槽）／医院占用表（`0x496b60`，8 槽）。
   *
   * ★ 2026-09-17 起**两张分开给**：先前的单一 `occupancy` 让调用方一律传
   *   `prisonOccupancy`，于是「住院中的人」会被记进**监狱**表。占用表就是原版
   *   那两张字节表（槽 0..3 玩家、4..7 物件），
   *   见 `rules/confinement.ts` 与 `docs/deviations/Q-CONFINE-1`。
   */
  prisonOccupancy: number[];
  hospitalOccupancy: number[];
  /**
   * 股市那边被改动后的行情（新聞 24/25/26 会改）；没碰就**不带**这个字段
   *   （调用方用 `out.market ?? 原值` 回写）。
   */
  market?: StockMarketState;
  /**
   * 被改过的新地价（新聞 6/14）—— **有序对列表**，只放改动过的那几条。
   *
   * ⚠️ 刻意不用 `Record` + `Object.keys/entries` 回写：那两样按 C-DET-5 属禁用
   *   （键序不保证）。这里用显式数组，顺序就是原版「逐块扫过去」的顺序。
   */
  landPrice?: readonly PriceChange[];
  facilityPrice?: readonly PriceChange[];
  /** 被 `mutate_land` 改过的地块（新聞 5/15/19/21）—— 同样是有序列表 */
  landMutations?: readonly LandMutation[];
  /** 同上，設施那一支 */
  facilityMutations?: readonly LandMutation[];
  /** 被改过盈余的企業（新聞 30..35）—— 有序列表，只放改动过的那几家 */
  companyMutations?: readonly CompanyMutation[];
  /**
   * 新聞 7：要**开一场拍卖**的那个实体。`applyNewsEffect` 只管挑，
   *   挂 `pending` 由 reducer 做（那里才有 `openAuction` 与竞价循环）。
   */
  publicAuction?: { entityId: number; facility: boolean };
  /**
   * ★ 百分比类那四条（11 所得稅 / 12 地價稅 / 13 證交稅 / 23 儲金紅利）的
   *   **「先算好」那一趟**的结果：每位在场玩家该缴/该领多少。
   *
   * @source `fcn_00449cce` 起那两支（`rich4_news.asm:1320` 与 `:1403`）的**两趟循环**：
   *   ```asm
   *   pass 1: for (i…) if (alive) { [0x48c59c+i*4] = trunc(基数 × 税率)
   *                                if (金额 != 0) 画一行「%s繳交%d元」+ 头像 }   ; 0x465592 格式串
   *   pass 2: for (i…) if (alive && 金额 != 0) pay_money(玩家, -1, 金额, 0)       ; :0x449da1
   *   ```
   *   ⇒ 顺序是「**先算好、画出来，第二趟才真收**」。表现层要按这个顺序逐行显示，
   *     所以引擎把这一趟的结果**带出来**（不是让 UI 自己再算一遍 —— 那等于把规则
   *     抄成两份，C-ARC-2）。
   *
   * 只在这四条上有值；其余事件不带这个字段。**含 0**（原版也会算出 0，只是不画那行）。
   */
  shares?: readonly { player: number; amount: number }[];
  /**
   * ★ 「随机挑一处建筑」那一族（5 / 15 / 19 / 20 / 21）**挑中的那一处**
   *   —— 实体编码 + 改之前的主人（1 基）。**挑中了就带**，与改没改动无关：
   *   原版 pass 0 就把名字填进訊息框、pass 1 照样移镜头、播影片（新聞 21 挑到
   *   一块空地时 `mutate_land` 什么都不改，但前后那几步一步不少）。
   *   纯表现（见 `GameState.lastEvent.place`）；规则只看 `landMutations` / `facilityMutations`。
   */
  place?: { entity: number; owner: number };
  /**
   * ★ 新聞 4：**被这发爆炸送进医院的玩家**（原版尾巴那个 `push 3 / call 0x43ec3f`
   *   的落点，VA 0x00449285）。排序 = 原版 `for (i = 0; i < num_players; i++)` 的下标序。
   *
   * ⚠️ 调用方要用它付**保險理賠**：原版 `0x43edf8 call 0x44ba63` 就在
   *   `send_to_hospital` **函数体内**（与飛彈那条同源），天数 `ALIEN_HOSPITAL_DAYS`。
   *   本模块拿不到 `topo`／`GameState`，故只能把名单交出来 —— 见
   *   `docs/gaps` 与报告里的「待接线」补丁。
   */
  blastedHospital?: readonly number[];
  /**
   * ★ 新聞 4：被 `0x40cd07` 毁掉的座驾要回**全局库存**（道具 5 機車 / 6 汽車）。
   *   与 `fortune-effects.ts` 的事件 10/11 同一个约定（`inc byte [0x497324]` /
   *   `[0x497325]`）：**给了 `ctx.toolStock` 才带这个字段**。
   */
  toolStock?: number[];
  amount: number;
  bankrupted: boolean;
  unimplemented: boolean;
  /**
   * ★ 新聞 29「違法超貸」这一趟关的是谁（原版 phase 0 抽中的目標 + phase 1 的最终受害者）。
   *
   * - `companyId` = 抽中的企業号（1 基，与原版候选表里存的就是这个）；
   * - `chairman` = `owner − 1`，phase 0 点名的**經營者**（玩家下标）；
   * - `victim` = 过了 `0x441210` 之后真正被关的人：持嫁禍卡(19) 且真的改写了目标
   *   ⇒ 被嫁祸的那位；否则就是 `chairman` 本人；
   * - `days` = `NEWS_CHAIRMAN_PRISON_DAYS`（5）。
   *
   * ⚠️ **免罪卡(21) 命中时整条作废**（`0x44b35a cmp eax,-1 / je`）⇒ 那时
   *   **不带这个字段**（`amount` 也是 0）。
   * ⚠️ 调用方要拿 `victim` 去走 `insureConfinement` —— 原版的保險理赔
   *   （`0x43edf8 call 0x44ba63`）在 `send_to_prison` **函数体内**，关谁赔谁。
   */
  chairmanPrison?: {
    companyId: number;
    chairman: number;
    victim: number;
    days: number;
  };
}

/**
 * 效果阶段需要的随机出口 —— 只暴露 `below(n)`（= 原版惯例 `rand() % n`，**保留模偏差**）。
 *   `WatcomRng` 天然满足这个形状，测试里也可以塞一个固定序列的假实现。
 */
/** 一条地价改动：`id` = 地块/設施 id，`price` = 改后的值 */
export interface PriceChange {
  id: number;
  price: number;
}

/** 一家企業的盈余改动：`id` = 企業 1 基序号，`funds` = `+0x28`、`profit` = `+0x2c` */
export interface CompanyMutation {
  id: number;
  funds: number;
  profit: number;
}

/** 一条地块/設施改造：只带**真正变了**的那几格 */
export interface LandMutation {
  id: number;
  level: number;
  type: number;
  owner: number;
}

export interface EffectRng {
  below(n: number): number;
}

/**
 * 新聞 29 的 chairman 持嫁禍卡(19) 时，原版 `0x44476a(chairman, 0, 0)` 挑谁替他坐牢。
 *
 * ★ 这里**只抄 mode 0**（新聞 29 传的第二参就是 0）那一条：
 * ```asm
 * 004447a1  cmp  byte ptr [esi + 0x496b7d], 1   ; who_plays == 1（真人）？
 * 004447a8  jne  0x4448b0                       ; ⇒ 电脑支
 * ; —— 电脑支 ——
 * 004448b1  call 0x40d2d3                       ; ① 最恨的人（hostility 最大且 > 0；跳过 who_plays==0）
 * 004448bb  cmp  eax, ebx / jne 0x4448ca        ;    命中就直接用（ebx = −1）
 * 004448c0  call 0x40d31c                       ; ② 没有 → 在场、非自己、`+0x32` 全 0 的人里随机
 * 004448ca  mov  edx, dword ptr [esp + 0xb8]    ; = 第二参 mode
 * 004448d4  jb   0x4448ef / 004448f1 jne 0x444973 / 004448f7 jmp 0x444971
 * 00444971  mov  ebx, ebp                       ; ★ mode 0：**不设门槛**，直接采纳候选
 * ```
 * ⇒ 与 `rules/toll-flow.ts` 的 `aiScapegoat` **不是同一条**：那个镜像的是同一函数的
 *   **mode 1** 分支 —— 多一道 `(rand()%4000 + 4000) × 物價` 的门槛，而且那道门槛
 *   **无条件再掷一次随机**（`0x4448fc call 0x456f2d`）。新聞 29 走 mode 0，
 *   多用它会让引擎的随机流多走一格，故这里不能直接复用 `aiScapegoat`。
 *   （`0x40d2d3` / `0x40d31c` 两步与 `ai/card-policy.ts` 的 `mostHated`、
 *    `aiScapegoat` 的对应两步同源；不 import 那两个是为了避开
 *    `events → ai/card-policy → state/reduce → events` 的循环依赖。）
 *
 * 真人那一条（`who_plays == 1`，`0x4447ae`）原版先建候选表，**只有一个候选时也要**
 * 弹一句「%s嫁禍給%s」确认框（`0x440ba8`），多个候选弹选人窗（`0x440e1a`）——
 * 本引擎没有这两个框，调用方按 D-003/D-008 的口径**一律放弃转嫁**，不走本函数。
 *
 * @returns 替死鬼的玩家下标；−1 = 没有可嫁祸的对象
 */
export function aiScapegoatTarget(
  players: readonly Player[],
  meIndex: number,
  rng: EffectRng,
): number {
  const me = players[meIndex];
  if (me === undefined) return -1;
  // ① 最恨的人 @source `0x0040d2d3`（`hostility[b]` 最大且 > 0；出局者跳过）
  let target = -1;
  let best = 0;
  for (let b = 0; b < players.length; b++) {
    const p = players[b];
    if (b === meIndex || p === undefined || !isAlive(p)) continue;
    const h = me.hostility[b] ?? 0;
    if (h > best) {
      best = h;
      target = b;
    }
  }
  if (target !== -1) return target;
  // ② 没有最恨的人 → 随机挑一个 @source `0x0040d31c`
  //    （在场、不是自己、`dword [+0x32] == 0` 即没住店/消失/坐牢/住院）
  const cands: number[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (i === meIndex || p === undefined || !isAlive(p)) continue;
    const bl = p.blocking;
    if ((bl.inHotel | bl.disappearing | bl.inPrison | bl.inHospital) !== 0) continue;
    cands.push(i);
  }
  if (cands.length === 0) return -1;
  // ★ **这一步掷一次随机**（原版 `0x40d355 call 0x456f2d`）
  return cands[rng.below(cands.length)]!;
}

/**
 * 「免罪卡(21) → 嫁禍卡(19)」二级判定的结果 —— **原版 `fcn_00441210` 的返回值语义**。
 *
 * - `absolution`：整条作废（`0x44122f mov eax,-1` 经 `cmp eax,-1 / je` 出去）
 *   ⇒ 调用方**什么都不做**；`players` 里免罪卡**已经**被扣掉；
 * - `scapegoat`：换目标，`victim` = 替死鬼的玩家下标（**一定 ≠ 被判定者**），
 *   `players` 里嫁祸卡**已经**被扣掉；
 * - `none`：没卡 / 真人放弃转嫁 / 嫁祸无人可嫁（`0x441259 je` 让 `eax = ebx = 本人`）
 *   ⇒ `victim` = 被判定者本人、**一张卡都不扣**。
 */
export interface SecondaryJudgement {
  kind: 'absolution' | 'scapegoat' | 'none';
  /** 真正挨罚的人（`absolution` 时无意义，调用方应直接整条作废） */
  victim: number;
  /**
   * 扣过卡之后的玩家表 —— 没扣卡时是**同一个引用**。
   * 免得调用方漏写回：`0x444bb2` / `0x441343` 都是直接改玩家结构的。
   */
  players: readonly Player[];
}

/**
 * ★★ 共享的**二级判定**：`fcn_00441210(player)`（82 B，全 exe **5 个调用点**）。
 *
 * ```asm
 * 00441210  push ebx / push esi
 * 00441212  mov  esi, [esp + 0xc]        ; = player（第一个参数）
 * 00441216  push 0x15 / push esi / call 0x4413ad   ; player_has_card(player, 21)
 * 00441221  cmp  eax, 1 / jne  0x441237
 * 00441226  push esi / call 0x444bb2     ; ★ 消耗免罪卡
 * 0044122f  mov  eax, 0xffffffff         ; ⇒ 返回 −1 = 「整条作废」
 * 00441237  mov  ebx, esi / push 0x13 / push esi / call 0x4413ad  ; has_card(player, 19)
 * 00441244  cmp  eax, 1 / jne  0x44125d
 * 00441249  push 0 / push 0 / push esi / call 0x44476a            ; ★ mode 恒为 0
 * 00441256  cmp  eax, -1 / je  0x44125d  ; 嫁祸失败 ⇒ 仍返回本人
 * 0044125b  mov  ebx, eax                ; 成功 ⇒ 返回替死鬼
 * 0044125d  mov  eax, ebx / pop esi / pop ebx / ret
 * ```
 *
 * 三条容易搞错的细节，全部按字节核对：
 * 1. **`0x44476a` 的第二参恒为 0** —— `push 0 / push 0 / push esi` 里，
 *    紧邻 `call` 的那个 `push 0` 是**第二参（mode）**、更早的那个才是第三参。
 *    mode 0 走 `0x444971 mov ebx,ebp`「不设门槛，直接采纳候选」，
 *    因此 `rules/toll-flow.ts` 的 `aiScapegoat`（镜像的是 **mode 1**，
 *    多一道 `(rand()%4000+4000)×物價` 的门槛）**不能**用在这里。
 * 2. **顺序**：先 21 后 19，命中 21 即止（不再查 19）。
 * 3. **扣卡点**：21 在 `0x444bb2` 内部扣；19 在 `0x44476a` 内部的
 *    `0x4449ef call 0x441343` 扣，且在 `0x4449e7 cmp ebx,-1 / je` **之后**
 *    ⇒ 「放弃转嫁／无人可嫁」时 19 **留在手里**（`cards/passive.ts` 已钉住）。
 *
 * 随机数消耗：只有 `0x44476a` 的**电脑支且没有最恨的人**那一条才走
 * `0x40d31c → 0x40d355 call 0x456f2d`（**恰好一格**）。真人那一支
 * （`0x4447ae`）建候选表后弹确认框/选人窗，**一个随机数都不掷** ——
 * 本引擎没有那两个框，按 D-003/D-008 的口径**一律放弃转嫁**（`−1`），
 * 因此也**不调用** `aiScapegoatTarget`（否则会凭空多走一格随机）。
 *
 * @param players 玩家表（**以调用方传进来的为准**，取状态里的版本）
 * @param meIndex 被判定者（= 事件原本的受害者目标）
 * @param rng     引擎随机出口；**只有电脑支真的落到「随机挑人」时才取一格**
 *                （「最恨的人」那一条 `0x40d2d3` 一个随机数都不掷；
 *                 真人那一条在 `0x4447ae` 就返回，同样不掷）。
 * @source 调用点：新聞 29（`0x44b352`）、命運 7/8（`0x44c6c5`/`0x44c7d7`）、
 *   命運 12（`0x44cd41`）、命運 33（`0x44d8a9`）。
 */
export function secondaryJudgement(
  players: readonly Player[],
  meIndex: number,
  rng: EffectRng,
): SecondaryJudgement {
  const me = players[meIndex];
  if (me === undefined) return { kind: 'none', victim: meIndex, players };
  // 21 优先、命中即止（`applyDefensiveCards` 已扣掉命中的那张）
  const def = applyDefensiveCards(me);
  if (def.trigger.kind === 'absolution') {
    return {
      kind: 'absolution',
      victim: meIndex,
      players:
        def.player === me ? players : players.map((p, i) => (i === meIndex ? def.player : p)),
    };
  }
  if (def.trigger.kind !== 'scapegoat') return { kind: 'none', victim: meIndex, players };
  // ★ 真人那一支原版弹框；本引擎一律放弃转嫁（D-003/D-008）——**先返回、不挑人**，
  //   这样连 `aiScapegoatTarget` 都不进，随机流一格不动（与 `0x4447ae` 支一致）。
  if (me.whoPlays === WHO_PLAYS_HUMAN) return { kind: 'none', victim: meIndex, players };
  // `0x4448b1 call 0x40d2d3`（最恨的人）→ 没有才 `0x4448c0 call 0x40d31c`（随机）
  const picked = aiScapegoatTarget(players, meIndex, rng);
  // `0x4449e7 cmp ebx,-1 / je 0x444a53`：没人可嫁 ⇒ 19 不扣、还是本人被罚
  if (picked < 0 || picked >= players.length || picked === meIndex) {
    return { kind: 'none', victim: meIndex, players };
  }
  // `0x4449ec push 0x13 / push edi / call 0x441343`：**真的换人才扣 19**
  return {
    kind: 'scapegoat',
    victim: picked,
    players: players.map((p, i) => (i === meIndex ? consumeCard(p, PASSIVE_CARDS.SCAPEGOAT) : p)),
  };
}

export interface NewsEffectContext {
  players: readonly Player[];
  /**
   * 物件表 + 节点表 —— **只在 `prison`/`hospital` 效果里用**：原版
   * `send_to_prison`/`send_to_hospital` 的函数体内含「传送到监狱／医院格 +
   * 跟班搬家」（`@source 0x43d601`..`0x43d674`），首次关押时玩家会被挪走。
   * 缺省时**不传送**（只给不关心盘面位置的单元测试用）；`reduce.ts` 必须传。
   */
  objects?: readonly MapObject[];
  nodes?: readonly MapNode[];
  /** 特殊景观表（首次关押的屏幕坐标取它）—— 见 `rules/confinement.ts` */
  landscapes?: readonly LandscapeInfo[] | undefined;
  /**
   * ★ **受影响的玩家**，由调用方指定。
   *
   * 新聞事件的对象多半不是抽牌者，而是「第一大地主」「土地最少者」
   * 「股市第一大戶」这类由局面算出来的人。谁符合条件属于**选择**，
   * 按 C-ARC-2 由外部决定，core 只施加效果。
   */
  affected: readonly number[];
  priceIndex: number;
  /**
   * 地价税（新闻 12）要的两张表 —— 归属与等级取**运行时**（`landOwner`/`landLevel`
   * 已经并进这两张表的 `owner`/`level`，见 `allEffectiveLands`）。
   */
  lands?: readonly LandInfo[];
  facilities?: readonly FacilityInfo[];
  /** 證交稅（新闻 13）要的持股与现价 */
  holdings?: readonly (readonly number[])[];
  prices?: readonly number[];
  pool?: number;
  /** 监狱占用表（`0x496b30`）—— `prison` / `releasePrison` / `extendPrison` 效果用它 */
  prisonOccupancy?: readonly number[];
  /** 医院占用表（`0x496b60`）—— `hospital` / `releaseHospital` / `extendHospital` 效果用它 */
  hospitalOccupancy?: readonly number[];
  /** 行情 —— 新聞 24/25（改各股 `newsFlag`）、26（改 `closedDays`）、27/28（停牌）要它 */
  market?: StockMarketState;
  /** 上市企業表（取 `stockIndex`）与两张盈余表 —— 新聞 30..35 要它们 */
  commercials?: readonly CommercialInfo[];
  companyFunds?: readonly number[];
  companyProfit?: readonly number[];
  /**
   * PRNG —— **效果阶段**要用随机的那些事件（新聞 27/28 抽股票；地块/企业那批将来也要）。
   *
   * ★ 传进来的必须是**引擎那条流**（`state.rngState` → `WatcomRng`），不是
   *   `Math.random`：这样单机可完整复现、联机两端一致（C-DET-4），
   *   且与「演出不许碰引擎随机」那条规矩不冲突（这里是 core）。
   */
  rng?: EffectRng;
  /** 覆盖天数；通常取自事件表的 literal */
  days?: number;
  /** 神明加持倍率档位：2 加倍、1 归零、0 不变（见 rules/blessing.ts） */
  multiplier?: number;
  /**
   * ★ 全局道具库存（`0x4972xx` 那一排）—— 新聞 4 的爆炸会把被炸者的座驾
   *   「撞毁回库存」（`0x40cd07`：`inc byte [0x497324]`/`[0x497325]`，
   *   即道具 5 機車 / 6 汽車）。**不给这个字段就不写库存表**
   *   （座驾照样清零 —— 与 `fortune-effects.ts` 的 10/11 同一约定）。
   */
  toolStock?: readonly number[];
}

/**
 * 四条百分比事件的「每人多少钱」。
 *
 * | 事件 | 基数 | 税率 | 方向 | @source |
 * |---|---|---|---|---|
 * | 11 所得稅 | 现金 `+0x1c` | 5% | 缴公库 | `0x00449cce` |
 * | 12 地價稅 | 名下地产原值 | 5%×物價 | 缴公库 | `0x00449ede` |
 * | 13 證交稅 | 持股市值 | 5%×物價 | 缴公库 | `0x0044a0e5` |
 * | 23 儲金紅利 | 存款 `+0x20` | 10% | **发钱**（银行出）| `0x0044af3c` |
 *
 * ★ 11 与 23 不乘物价指数（`0x4990e8` 在这两支里一次都没出现），
 *   12/13 是「先 trunc 再乘指数」——规矩都在 `rules/percentage.ts` 里。
 */
export const PERCENT_NEWS: ReadonlyMap<
  number,
  (p: Player, who: number, ctx: NewsEffectContext) => number
> = new Map([
  [11, (p: Player) => incomeTax(p)],
  [
    12,
    (p: Player, who: number, ctx: NewsEffectContext) =>
      propertyTax(who, ctx.lands ?? [], ctx.facilities ?? [], ctx.priceIndex),
  ],
  [
    13,
    (p: Player, who: number, ctx: NewsEffectContext) =>
      stockTax(ctx.holdings?.[who] ?? [], ctx.prices ?? [], ctx.priceIndex),
  ],
  [23, (p: Player) => bankDividend(p)],
]);

/**
 * 本模块**已能施加效果**的新聞事件编号。
 *
 * 四类：
 * 1. 固定金额（`factor != null`）的 `pay`/`give`；
 * 2. 坐牢 / 住院；
 * 3. ★ **百分比类**（2026-09-16 接上）：11 所得稅 5%、12 地價稅 5%、
 *    13 證交稅 5%、23 儲金紅利 10% —— 金额逐人现算，见 `PERCENT_NEWS`
 *    与 `rules/percentage.ts`。这四条先前是「规则译好了但没人调用」，
 *    抽到只画文案、一分钱不动。
 *
 * ⚠️ 29 的文案里**没有 `%d`**（「坐牢５天」——5 是写死的全角字），故 `literal` 为 null。
 *   ★ 订正（2026-09 本轮）：先前它记作 `prison`，于是走「天数由调用方给」那条路，
 *   而 `drawAndApplyNews` 从来不传 `days` ⇒ **恒报 `unimplemented`、一次都不关人**。
 *   它其实是 `companyChairmanPrison`（随机抽一家有主企業的經營者、5 天写在
 *   `NEWS_CHAIRMAN_PRISON_DAYS` 里），**不要**再把它当成「缺 days 的 prison」。
 * ★ 新聞 4 的文案同样没有 `%d`（`literal` 也是 null），但它**不走**这条
 *   「天数由调用方给」的路 —— 它是 `alienBlast`（半径 100 的重击 + 送医 3 天，
 *   天数住在 `ALIEN_HOSPITAL_DAYS`）。先前表里把它记成 `hospital` 才导致
 *   它恒报 `unimplemented`。
 */
export const IMPLEMENTED_NEWS_IDS: readonly number[] = [
  ...NEWS_EVENTS.filter(
    (e) =>
      e.effects.includes('prison') ||
      e.effects.includes('hospital') ||
      // ★ 2026-09-17：四条「释放／延长」也在此列 —— 它们的 effects 先前是空的，
      //   于是抽到只画文案、一分钱一天都不动（见 docs/known-deviations.md）
      e.effects.includes('releasePrison') ||
      e.effects.includes('releaseHospital') ||
      e.effects.includes('extendPrison') ||
      e.effects.includes('extendHospital') ||
      e.effects.includes('loanFreeze') ||
      // ★ 2026-09-17：16/17（行人/車輛休息一回合）与 24/25/26（股市三连）
      e.effects.includes('stopPedestrians') ||
      e.effects.includes('stopVehicles') ||
      e.effects.includes('marketBearish') ||
      e.effects.includes('marketBullish') ||
      e.effects.includes('marketClose') ||
      e.effects.includes('suspendStock') ||
      e.effects.includes('resumeStock') ||
      e.effects.includes('raiseLandPrice') ||
      e.effects.includes('lowerLandPrice') ||
      e.effects.includes('demolishBuiltLand') ||
      e.effects.includes('clearOwnerBuilt') ||
      e.effects.includes('clearOwnerAny') ||
      e.effects.includes('demolishAny') ||
      e.effects.includes('demolishSameName') ||
      e.effects.includes('typhoonBlast') ||
      // ★ 2026-09 本轮：新聞 4 改记 `alienBlast`（先前误记 `hospital` ⇒ 恒
      //   `unimplemented`，一次爆炸都不打）。见 `ALIEN_BLAST_*`。
      e.effects.includes('alienBlast') ||
      e.effects.includes('companyPenalty') ||
      e.effects.includes('companyGain') ||
      e.effects.includes('companyLoss') ||
      e.effects.includes('companyProfitDouble') ||
      e.effects.includes('publicAuction') ||
      // ★ 2026-09 本轮：新聞 29 从 `prison` 改记 `companyChairmanPrison`（随机抽一家
      //   有主企業的經營者 + 免罪/嫁禍二级判定 + 5 天），见 `NewsEffectResult.chairmanPrison`
      e.effects.includes('companyChairmanPrison') ||
      (e.factor !== null && (e.effects.includes('pay') || e.effects.includes('give'))),
  ).map((e) => e.id),
  ...PERCENT_NEWS.keys(),
];

/** 銀行擠兌的停放天数 @source 0x0044aeb6 `mov byte/word [player+0x3c], 15`（写死立即数） */
export const LOAN_FREEZE_DAYS = 15;

/**
 * 新聞 26「股市暫停交易１０天」写入的全股市休市天数
 * @source VA 0x0044b0c6 `mov dword [0x4990dc], 0xa`
 *   （文案的「１０」是全角字、没有 `%d`，所以 event-table 的 literal 是 null）
 */
export const MARKET_CLOSE_DAYS = 0xa;

/**
 * 新聞 27 停牌的天数 —— 汇编里是 `mov byte [股票+6], 0xf`。
 *   ★ 文案写「暫停交易１０天」，立即数却是 **15**；本引擎**照抄立即数**（C-FID）。
 */
export const STOCK_SUSPEND_DAYS = 0xf;

/**
 * 新聞 20「超級颱風」那发 `damage_area` 的半径
 * @source phase 2 的第一个实参 `push 0x64`（VA 0x0044ac21 附近）
 *   ★ 与飛彈同一个数（`MISSILE_RADIUS`），但**风向不是**：颱風 `flags = 6`
 *   （只打住宅与設施，不打人）、攻击者 `-1`（不记敌意）。
 */
export const TYPHOON_RADIUS = 0x64;

/**
 * 新聞 4「外星人攻打地球」那发 `damage_area` 的四个实参 + 送医天数。
 *
 * @source `fcn_0044913d` 的施加阶段（VA 0x00449225..0x0044922d）：
 * ```asm
 * 00449225  push -1        ; 攻击者 = 无 ⇒ damage_area 里两条 `cmp esi,-1 / je` 都跳过
 * 00449227  push 1         ; ★ heavy = 1（重击），**不是半径**
 * 00449229  push 0x26      ; flags = 0x20|0x4|0x2：住宅 + 設施 + 范围里的人
 * 0044922b  push 0x64      ; ★ 半径 = 100 —— 与核彈的 -1 完全不同，是方窗不是全图
 * 0044922d  call 0x40ac7b
 * ```
 * ★ 这五个常量**都是**从事件函数本体读出来的（不是从飛彈那支推的）：
 *   虽然数值恰好与飛彈的半径/flags 相同，但**重击位**与攻击者不同，
 *   且飛彈会记敌意、这一发全程不记。逐个钉住，别互相套用。
 */
export const ALIEN_BLAST_RADIUS = 0x64;
export const ALIEN_BLAST_FLAGS = 0x26;
/**
 * ★ 注解成 `number` 而不是字面量 `1`：下面要写 `ALIEN_BLAST_HEAVY !== 0` 把它
 *   映到 `blastLand` 的 boolean 形参上；若被收窄成字面量类型，那个比较会被
 *   TS 判成「恒真的无意义比较」（TS2367）。
 */
export const ALIEN_BLAST_HEAVY: number = 1;
export const ALIEN_BLAST_ATTACKER = -1;

/**
 * 新聞 4 把被炸到的人关几天 @source VA 0x00449282 `push 3 / call 0x43ec3f`
 *   （`0x43ec3f` = `send_to_hospital(玩家, 天数)`，与飛彈那条 `MISSILE_HOSPITAL_DAYS`
 *    是同一个立即数，但**各自**写在各自的调用点）。
 */
export const ALIEN_HOSPITAL_DAYS = 3;

/**
 * 新聞 29「違法超貸」phase 1 把实际受害者关几天 @source VA 0x0044b35f `push 5`
 *   （紧接 `0x44b361 push eax` / `0x44b362 call 0x43d593` = `send_to_prison(受害者, 5)`）。
 *
 * ★ 文案里「經營者%s坐牢５天」的「５」是**全角字、没有 `%d`** ⇒ 事件表的 `literal`
 *   保持 `null`（同 4/20/26 的先例），天数只能住在这个常量里。
 *   与 `event-table.ts` 的 `companyChairmanPrison` 长注释、以及
 *   `event-table.test.ts` 的「文案写５天」用例三处互证。
 */
export const NEWS_CHAIRMAN_PRISON_DAYS = 5;

/** 新聞 6 的地价倍率 @source 常量 `[0x4654dc]` = 1.3 */
export const LAND_PRICE_UP = 1.3;
/** 新聞 14 的地价倍率 @source 常量 `[0x46561c]` = 0.7 */
export const LAND_PRICE_DOWN = 0.7;

/**
 * 施加一个新聞事件的效果（第二阶段）。
 *
 * 方向与命運一致：
 * - `pay`  → `transferMoney(玩家, PARTY_POOL, 金额, 0)`，含级联与破产
 * - `give` → `receiveMoney(玩家, 金额)`，直接加现金
 * - `prison` / `hospital` → `confine`
 *
 * 对 `affected` 里的**每个**玩家各施加一次——税金类事件
 * （11/12/13「所有人繳交…」）正是对全体生效。
 */
export function applyNewsEffect(
  eventId: number,
  ctx: NewsEffectContext,
): NewsEffectResult {
  let players = [...ctx.players];
  let objects: MapObject[] = [...(ctx.objects ?? [])];
  let pool = ctx.pool ?? 0;
  let prisonOccupancy = [...(ctx.prisonOccupancy ?? new Array<number>(CONFINEMENT_SLOTS).fill(0))];
  let hospitalOccupancy = [
    ...(ctx.hospitalOccupancy ?? new Array<number>(CONFINEMENT_SLOTS).fill(0)),
  ];
  const base: NewsEffectResult = {
    players,
    objects,
    pool,
    prisonOccupancy,
    hospitalOccupancy,
    amount: 0,
    bankrupted: false,
    unimplemented: false,
  };

  const entry = newsEvent(eventId);
  if (entry === undefined || entry.effects.length === 0) {
    return { ...base, unimplemented: true };
  }

  const amount = eventAmount(entry, ctx.priceIndex) * blessingMultiplier(ctx.multiplier ?? 0);
  let total = 0;
  let bankrupted = false;

  // ── 新聞 0/2「無罪開釋／提前出院」与 1/3「延長刑期／延長住院」──────────
  //   ★ 这四条**不看 `affected`**：原版扫占用表，谁在里面就动谁。
  //     @source `rich4_news.asm` 四个函数各有一段同构的循环：
  //     ```asm
  //     xor ebx, ebx                   ; i = 0
  //     mov esi, 0x148                 ; 头像落点 y
  //     loop:
  //       cmp byte [ebx + 0x496b30], 0   ; ★ 监狱表（医院那两条是 0x496b60）
  //       je  next                       ; 不在里面 → 跳过
  //       … 在 (0x186, y) 画这个人 + 建筑图 …
  //       ; 释放：mov byte [player+0x34], 0x80 / mov byte [ebx+0x496b30], 0
  //       ; 延长：add dh, n / mov cl, dh / and cl, 0x7f   ⇒ (days + n) & 0x7f
  //       add esi, 0x2a
  //     next:
  //       inc ebx / cmp ebx, 4 / jl loop
  //     ```
  //   ★ 循环上界是 **4** ⇒ 只动玩家槽 0..3，地图物件槽 4..7 够不到。
  const kind: 'prison' | 'hospital' | null = entry.effects.includes('releasePrison') ||
    entry.effects.includes('extendPrison')
    ? 'prison'
    : entry.effects.includes('releaseHospital') || entry.effects.includes('extendHospital')
      ? 'hospital'
      : null;
  if (kind !== null) {
    const releasing =
      entry.effects.includes('releasePrison') || entry.effects.includes('releaseHospital');
    const table = kind === 'prison' ? prisonOccupancy : hospitalOccupancy;
    const field: 'inPrison' | 'inHospital' = kind === 'prison' ? 'inPrison' : 'inHospital';
    // 「延长 %d 天」的 n = 文案里的字面常量（`mov ecx, 3` ⇒ literal 3）
    const days = ctx.days ?? entry.literal ?? 0;
    const next = [...players];
    const nextTable = [...table];
    for (let who = 0; who < 4; who++) {
      const p = next[who];
      if (p === undefined) continue;
      // ★ 闸门是**占用表**（不是天数）
      if ((nextTable[who] ?? 0) === 0) continue;
      if (releasing) {
        // 释放 = 挂「待释放」位（下一次推进才真正走释放流程）+ 清占用槽
        next[who] = { ...p, blocking: { ...p.blocking, [field]: RELEASE_PENDING } };
        nextTable[who] = 0;
      } else {
        // 延长 = (当前 + n) & 0x7f —— ★ 掩码会把 0x80 抹掉
        const raw = ((p.blocking[field] as number) + days) & 0x7f;
        next[who] = { ...p, blocking: { ...p.blocking, [field]: raw } };
      }
    }
    if (kind === 'prison') prisonOccupancy = nextTable;
    else hospitalOccupancy = nextTable;
    return {
      players: next,
      objects,
      pool,
      prisonOccupancy,
      hospitalOccupancy,
      amount: days,
      bankrupted,
      unimplemented: false,
    };
  }

  // ── 新聞 29「%s違法超貸 經營者%s坐牢５天」──────────────────────────
  //   ★★ **两阶段契约的处理方式：在一次调用里完成**（不往状态里挂中间槽）。
  //
  //   原版 `fcn_0044b25b` 是两阶段的：phase 0（`[esp+0xd4] == 0`）抽目标、
  //   画公告、把 chairman 写进全局 `[0x48c59c]`；phase 1 才施加。两句之间隔着
  //   玩家点「確定」—— **不掷随机数、也不改任何规则状态**。
  //   本引擎的 `drawAndApplyNews` 本来就是「抽一张、当场施加」的一次调用，
  //   故把两段合在这里做完：抽中的目標由 `chairmanPrison` 带出去给表现层。
  //   为什么**不改变可观察行为**：
  //     · 随机流前进的格数与时机相同 —— 抽中这张新闻的那一刻恰好走一格
  //       （原版也是 phase 0 那一次 `0x44b29e call 0x456f2d`，中间没有第二次）；
  //     · phase 1 唯一的新增随机来自「嫁禍挑人」（`0x40d31c`），那只在 chairman
  //       持 19 且没有最恨的人时才发生，两支实现的是同一段；
  //     · 中间没有任何别的状态改动会与「玩家点確定」这一段时间发生交互
  //       （新闻公告是模态的，棋盘不推进）。
  //   逐行 @source 见 `@rich4/data` 的 `companyChairmanPrison` 注释。
  if (entry.effects.includes('companyChairmanPrison')) {
    const rng = ctx.rng;
    if (rng === undefined) return { ...base, unimplemented: true };
    // ① 候选 = 企業表里 `+0x18 != 0`（有主）的那些。
    //    ★ `ctx.commercials[].owner` 必须是**运行时**归属（`state.commercialOwners`），
    //      地图模板里的 `+0x18` 恒为 0 —— 见 `reduce.ts` 的接线与报告的「待主代理处理」。
    const cand = (ctx.commercials ?? []).filter((c) => c.owner !== 0);
    // ★ 候选为 0 时原版 `idiv ebx`（ebx = 0）除零崩 ⇒ 本引擎那一支**什么都不做、
    //   也不掷随机数**（与 5/18/19/21/28/35 同一处理）。
    if (cand.length === 0) return { ...base, amount: 0 };
    // ② `0x44b29e call 0x456f2d` + `0x44b2a8 idiv ebx`：**恰好一次** `rand()`
    const co = cand[rng.below(cand.length)]!;
    const chairman = co.owner - 1;
    const named = players[chairman];
    // 越界的 owner（存档被改过）⇒ 原版会去读别人的结构，本引擎不动
    if (named === undefined) return { ...base, amount: 0 };

    // ③ `0x44b351 call 0x441210(chairman)`：免罪(21) → 嫁禍(19)。
    //    ★ 2026-09-19 起与**命運那 4 个调用点**共用 `secondaryJudgement`
    //      （同一个 exe 函数、同一份 mode 0 挑人规则）—— 这一段的行为一个字没改，
    //      只是从"新闻独占的实现"提成了共享件（见该函数的 @source 块）。
    const judged = secondaryJudgement(players, chairman, rng);
    players = [...judged.players];
    if (judged.kind === 'absolution') {
      // `0x441210`：`call 0x444bb2` 已扣掉免罪卡，随后 `mov eax,-1` ⇒
      // `0x44b35a cmp eax,-1 / je 0x44b36a` **整条作废**（不动任何人的天数）。
      return { ...base, players, amount: 0 };
    }
    // `picked == -1`（真人放弃 / 无人可嫁）⇒ `0x441210` 的 `0x441259 je 0x44125d`
    //   让 `eax = ebx = 原目标` ⇒ **chairman 本人**被关（不是"什么都不发生"）。
    const victim = judged.victim;

    // ④ `0x44b35f push 5 / push eax / call 0x43d593`：`send_to_prison(受害者, 5)`
    //    函数体内含「传送到监狱格 + 跟班搬家 + 保險理赔」，故走 `sendToConfinement`。
    const days = NEWS_CHAIRMAN_PRISON_DAYS;
    const out = sendToConfinement(
      players,
      objects,
      ctx.nodes ?? [],
      prisonOccupancy,
      'prison',
      victim,
      days,
      hospitalOccupancy,
      ctx.landscapes,
    );
    return {
      ...base,
      players: out.players,
      objects: out.objects,
      // 首次关押时原版 `0x40d761` 会把"当前非 0 的那一张"清掉 ⇒ 医院那格也要回写
      prisonOccupancy: out.occupancy,
      hospitalOccupancy: out.otherOccupancy ?? hospitalOccupancy,
      amount: days,
      chairmanPrison: { companyId: co.id, chairman, victim, days },
    };
  }

  // ── 新聞 6 / 14「公告地價調漲／房屋鬧鬼地價下跌」─────────────────
  //   @source `fcn_004494e0`（×1.3）/ `fcn_0044a220`（×0.7），逐条见 event-table 的注释。
  //   ★ 两支都**不看 `affected`**：随机挑一块地/一处設施，然后
  //     地块那一支把**所有同名地块**的地价都乘上倍率（只改挑中那一处的是設施）。
  if (entry.effects.includes('raiseLandPrice') || entry.effects.includes('lowerLandPrice')) {
    const rng = ctx.rng;
    const lands = ctx.lands ?? [];
    const facilities = ctx.facilities ?? [];
    if (rng === undefined || lands.length + facilities.length === 0) {
      return { ...base, unimplemented: true };
    }
    const factor = entry.effects.includes('raiseLandPrice') ? LAND_PRICE_UP : LAND_PRICE_DOWN;
    const pick = rng.below(lands.length + facilities.length);
    if (pick < lands.length) {
      // ★ `rand() % (地+設施)` 的前半段是**地块**（1 基下标 = pick+1）
      const target = lands[pick]!;
      const landPrice: PriceChange[] = [];
      for (const l of lands) {
        // 同名的都改（原版逐块 `strcmp(name)`）；顺序 = 表序
        if (l.name !== target.name) continue;
        landPrice.push({ id: l.id, price: Math.trunc(l.landPrice * factor) });
      }
      const changed = landPrice.find((c) => c.id === target.id);
      return { ...base, amount: changed?.price ?? 0, landPrice };
    }
    const fac = facilities[pick - lands.length]!;
    return {
      ...base,
      amount: Math.trunc(fac.landPrice * factor),
      facilityPrice: [{ id: fac.id, price: Math.trunc(fac.landPrice * factor) }],
    };
  }

  // ── 新聞 20「超級颱風侵襲，多處房屋受損」────────────────────────
  //   挑一处 → 以它为心打一发 `damage_area(半径 100, flags 6, 轻重 0, 攻击者 -1)`：
  //   范围内的**住宅与設施**各拆一级，**不打人、不记敌意**。
  //   ⚠️ 范围口径沿用本引擎对 Q-TOOL-1 的近似：原版是 440×440 视图空间的方窗
  //     （要镜头与等距投影），这里改用**地图坐标**的方窗，半径同为 100。
  if (entry.effects.includes('typhoonBlast')) {
    const rng = ctx.rng;
    const lands = ctx.lands ?? [];
    const facilities = ctx.facilities ?? [];
    if (rng === undefined || lands.length + facilities.length === 0) {
      return { ...base, unimplemented: true };
    }
    const pick = rng.below(lands.length + facilities.length);
    const picked = pick < lands.length ? lands[pick]! : facilities[pick - lands.length]!;
    const origin = { x: picked.x, y: picked.y };
    // ★ 挑中的那一处（表现层：訊息框的地名 / 镜头）@source `fcn_0044ab2c`
    //   pass 0 `0x0044abbc strcpy(名字)` → pass 1 `0x0044ac19 0x40af12` + `0x0044ac33 view_to(x, y, 2)`
    const place = {
      entity: (pick < lands.length ? ESTATE_LAND_BASE : ESTATE_FACILITY_BASE) + picked.id,
      owner: picked.owner,
    };
    const inBlast = (e: { x: number; y: number }): boolean =>
      Math.abs(e.x - origin.x) <= TYPHOON_RADIUS && Math.abs(e.y - origin.y) <= TYPHOON_RADIUS;
    const landMutations: LandMutation[] = [];
    const releaseFlags: boolean[] = [];
    for (const l of lands) {
      if (!inBlast(l)) continue;
      const after = mutateLand(l, MUTATE_DEMOLISH_ONE);
      if (!after.changed) continue;
      releaseFlags.push(after.releasesConfined);
      landMutations.push({
        id: after.land.id,
        level: after.land.level,
        type: after.land.type,
        owner: after.land.owner,
      });
    }
    const facilityMutations: LandMutation[] = [];
    for (const f of facilities) {
      if (!inBlast(f)) continue;
      const after = mutateFacility(f, MUTATE_DEMOLISH_ONE);
      if (!after.changed) continue;
      releaseFlags.push(after.releasesConfined);
      facilityMutations.push({
        id: after.facility.id,
        level: after.facility.level,
        type: after.facility.type,
        owner: after.facility.owner,
      });
    }
    return {
      ...base,
      players: applyRelease(base.players, releaseFlags),
      amount: landMutations.length + facilityMutations.length,
      landMutations,
      facilityMutations,
      place,
    };
  }

  // ── 新聞 4「外星人攻打地球」──────────────────────────────────────
  //   @source `fcn_0044913d` 的施加阶段（VA 0x00449175..0x00449290）。三步：
  //
  //   ① 候选表 = 「`level != 0` 的地块」（id = i+0x7d0，先）+
  //      「`level != 0` 的設施」（id = i+0xfa0，后），`rand() % 数量` 挑一处当爆心：
  //      ```asm
  //      0044918d  cmp  byte [edx + eax + 0x1a], 0 / je 跳过   ; land.level != 0 才收
  //      004491c6  cmp  byte [edx + eax + 0x1a], 0 / je 跳过   ; facility.level != 0 才收
  //      004491dd  call 0x456f2d / idiv esi                    ; rand() % 候选数
  //      00449203  call 0x40af12                               ; 取挑中那一处的 (x, y)
  //      0044921d  call 0x41d476                               ; 移镜头（表现层）
  //      ```
  //   ② 以它为心打 `damage_area(0x64, 0x26, 1, -1)`：
  //      ```asm
  //      00449225  push -1            ; 攻击者 = 无
  //      00449227  push 1             ; ★ heavy = 1（重击）
  //      00449229  push 0x26          ; 住宅 | 設施 | 范围里的人
  //      0044922b  push 0x64          ; ★ 半径 = 100（**不是**核彈的 -1 全图）
  //      0044922d  call 0x40ac7b
  //      ```
  //      ★ `heavy` 与 `radius` 是**两列**：这一发是「半径 100 的窗 + 重击」。
  //        复刻里 `fireMissile` 把两者揉成了一个 `heavy`（heavy ⇒ 全图），
  //        故这里**不能**直接调 `fireMissile`，要自己算窗口 + 调 `blastLand`。
  //   ③ 扫玩家 0..num_players-1，凡被 `0x40cd07` 挂上「被炸」位（`+0x15 & 0x40`）的
  //      `send_to_hospital(玩家, 3)`（`0x43ec3f`，VA 0x00449285）。
  //   ★ 攻击者 `-1` ⇒ `damage_area` 里两条 `cmp esi,0xffffffff / je` 都跳过 ⇒
  //     **全程不记任何敌意**（与颱風同理；与飛彈/核彈不同）。
  //   ★ 候选集为空时原版 `idiv` 除零崩 ⇒ 本引擎什么都不做（与 5/18/19/21/28 同一处理）。
  if (entry.effects.includes('alienBlast')) {
    const rng = ctx.rng;
    const lands = ctx.lands ?? [];
    const facilities = ctx.facilities ?? [];
    if (rng === undefined) return { ...base, unimplemented: true };
    // ① 候选表：只收「盖了房子」的（`+0x1a` = level）
    const landCand = lands.filter((l) => l.level !== 0);
    const facCand = facilities.filter((f) => f.level !== 0);
    const totalCand = landCand.length + facCand.length;
    if (totalCand === 0) return { ...base, amount: 0 };
    const pick = rng.below(totalCand);
    const origin =
      pick < landCand.length
        ? { x: landCand[pick]!.x, y: landCand[pick]!.y }
        : { x: facCand[pick - landCand.length]!.x, y: facCand[pick - landCand.length]!.y };
    // ② 爆心方窗。⚠️ 范围口径沿用本引擎对 Q-TOOL-1 的近似：原版是 440×440
    //    **视图空间**的 ±半径（要镜头与等距投影），这里改用**地图坐标**的方窗，
    //    半径同为 0x64 —— 与 `typhoonBlast` 及飛彈那条完全同一口径。
    const inBlast = (e: { x: number; y: number }): boolean =>
      Math.abs(e.x - origin.x) <= ALIEN_BLAST_RADIUS &&
      Math.abs(e.y - origin.y) <= ALIEN_BLAST_RADIUS;

    // ②a 住宅：**重击**支 —— owner/level/type 全清（`blastLand` 的 heavy 支）。
    //     @source `damage_area` 0x0040ad3a..0x0040ad85：`+0x19/+0x1a/+0x18` 全写 0
    //     再写 `+0x30`(地契)。原版对窗内**每一块**都写这 4 项；全 0 的地块写了也一样，
    //     故只把**真变了**的那几格带出去（`LandMutation` 的约定）。
    //     ⚠️ `+0x30`（地契）本引擎的 `LandMutation` 带不了 —— 与已登记的 P4/#7 同一处。
    const landMutations: LandMutation[] = [];
    for (const l of lands) {
      if (!inBlast(l)) continue;
      const after = blastLand(l.owner, l.level, l.type, ctx.priceIndex, ALIEN_BLAST_HEAVY !== 0);
      if (after.owner === l.owner && after.level === l.level && after.type === l.type) continue;
      landMutations.push({ id: l.id, level: after.level, type: after.type, owner: after.owner });
    }

    // ②b 設施：重击支与 `mutate_land` 的 **mode 1** 逐字相同
    //     （`+0x19/+0x1a/+0x18/+0x34` 全清 **且** `call 0x40dffa` 放人，无 level 门控）
    //     @source `damage_area` 0x0040ae45..0x0040ae5d 对 `mutate_land` mode 1
    //     （见 `cards/monster.ts` 的 `mutateFacility`）：故直接复用。
    const facilityMutations: LandMutation[] = [];
    const releaseFlags: boolean[] = [];
    for (const f of facilities) {
      if (!inBlast(f)) continue;
      const after = mutateFacility(f, MUTATE_CLEAR_OWNER);
      releaseFlags.push(after.releasesConfined);
      facilityMutations.push({
        id: after.facility.id,
        level: after.facility.level,
        type: after.facility.type,
        owner: after.facility.owner,
      });
    }

    // ③ 范围里的人：`0x40cd07`（毁车 + 挂「被炸」位）→ `send_to_hospital(玩家, 3)`
    //    复刻对「谁在范围里」用的是既有的近似：玩家的**节点**落在爆心方窗内
    //    （与 `fireMissile` 的 `hitNodes` 同一条口径）。
    const nodes = ctx.nodes ?? [];
    const hitNodes = new Set<number>();
    for (const n of nodes) if (inBlast(n)) hitNodes.add(n.id);
    let nextPlayers = applyRelease(base.players, releaseFlags);
    let nextObjects = base.objects;
    let hospital = [...base.hospitalOccupancy];
    let prison = [...base.prisonOccupancy];
    const toolStock = [...(ctx.toolStock ?? [])];
    const blastedHospital: number[] = [];
    for (let i = 0; i < nextPlayers.length; i++) {
      const p = nextPlayers[i];
      if (p === undefined || !isAlive(p) || !hitNodes.has(p.nodeId)) continue;
      // @source `0x40cd07` 的第一道闸：`cmp dword [player+0x32], 0 / jne` ——
      //   已住店/消失/坐牢/住院者**不挂**那个 0x40 位，于是 ③ 的循环也扫不到他。
      //   ★ 只比 `+0x32` 那**四个**字节（`sleeping` 在 `+0x36`，不在这一比之内）。
      const b = p.blocking;
      if (b.inHotel !== 0 || b.disappearing !== 0 || b.inPrison !== 0 || b.inHospital !== 0) {
        continue;
      }
      // 毁车 @source `0x40cd07` 的 0x0040cd21..0x0040cd61：座驾清零 + 一颗骰子，
      //   车回全局库存（`+0x497324`/`0x497325` = 道具 5 機車 / 6 汽車）
      if (p.trafficMethod !== 0) {
        const kind = p.trafficMethod & 3;
        if (kind === 1) toolStock[5] = (toolStock[5] ?? 0) + 1;
        else if (kind === 2) toolStock[6] = (toolStock[6] ?? 0) + 1;
        nextPlayers[i] = { ...p, trafficMethod: 0, ndices: 1 };
      }
      // @source `0x43ec3f(玩家, 3)`：与飛彈那条同一个 `send_to_hospital`
      //   （函数体内含清另一张占用表、传送、跟班搬家、以及 `0x43edf8` 的保險理賠）
      const c = sendToConfinement(
        nextPlayers,
        nextObjects,
        nodes,
        hospital,
        'hospital',
        i,
        ALIEN_HOSPITAL_DAYS,
        prison,
        ctx.landscapes,
      );
      nextPlayers = c.players.map((q) => ({ ...q }));
      nextObjects = c.objects;
      hospital = c.occupancy;
      if (c.otherOccupancy !== undefined) prison = c.otherOccupancy;
      blastedHospital.push(i);
    }

    return {
      ...base,
      players: nextPlayers,
      objects: nextObjects,
      prisonOccupancy: prison,
      hospitalOccupancy: hospital,
      amount: landMutations.length + facilityMutations.length,
      landMutations,
      facilityMutations,
      ...(blastedHospital.length === 0 ? {} : { blastedHospital }),
      // 没给 `ctx.toolStock` 就不带这个字段（与 `fortune-effects.ts` 10/11 同一约定）
      ...(ctx.toolStock === undefined ? {} : { toolStock }),
    };
  }

  // ── 新聞 5/15/19/21「隨機拆一處建築／土地流失」────────────────────
  //   候选集与模式逐条见 event-table 的注释表；都**不看 `affected`**。
  //   ★ 候选集为空时原版 `idiv` 除零崩 ⇒ 本引擎什么都不做。
  // ── 新聞 18「地震」：挑一处，**同名地块全拆一级**（与 6/14 同一套结构）──
  if (entry.effects.includes('demolishSameName')) {
    const rng = ctx.rng;
    const lands = ctx.lands ?? [];
    const facilities = ctx.facilities ?? [];
    if (rng === undefined || lands.length + facilities.length === 0) {
      return { ...base, unimplemented: true };
    }
    const pick = rng.below(lands.length + facilities.length);
    if (pick < lands.length) {
      const name = lands[pick]!.name;
      const landMutations: LandMutation[] = [];
      const releaseFlags: boolean[] = [];
      for (const l of lands) {
        if (l.name !== name) continue;
        const after = mutateLand(l, MUTATE_DEMOLISH_ONE);
        if (!after.changed) continue;
        releaseFlags.push(after.releasesConfined);
        landMutations.push({
          id: after.land.id,
          level: after.land.level,
          type: after.land.type,
          owner: after.land.owner,
        });
      }
      return {
        ...base,
        players: applyRelease(base.players, releaseFlags),
        amount: landMutations.length,
        landMutations,
      };
    }
    const fac = facilities[pick - lands.length]!;
    const after = mutateFacility(fac, MUTATE_DEMOLISH_ONE);
    if (!after.changed) return { ...base, amount: 0 };
    return {
      ...base,
      players: applyRelease(base.players, [after.releasesConfined]),
      amount: 1,
      facilityMutations: [
        {
          id: after.facility.id,
          level: after.facility.level,
          type: after.facility.type,
          owner: after.facility.owner,
        },
      ],
    };
  }

  const razeMode = entry.effects.includes('demolishBuiltLand') ||
    entry.effects.includes('demolishAny')
    ? MUTATE_DEMOLISH_ONE
    : entry.effects.includes('clearOwnerBuilt') || entry.effects.includes('clearOwnerAny')
      ? MUTATE_CLEAR_OWNER
      : null;
  if (razeMode !== null) {
    const rng = ctx.rng;
    const lands = ctx.lands ?? [];
    const facilities = ctx.facilities ?? [];
    if (rng === undefined) return { ...base, unimplemented: true };
    // 候选集：`…Built…` 只挑 `level != 0`；`demolishBuiltLand` 再限定「只地块」
    const builtOnly =
      entry.effects.includes('demolishBuiltLand') ||
      entry.effects.includes('clearOwnerBuilt');
    const landsOnly = entry.effects.includes('demolishBuiltLand');
    const landCand = builtOnly ? lands.filter((l) => l.level !== 0) : lands;
    const facCand = landsOnly
      ? []
      : builtOnly
        ? facilities.filter((f) => f.level !== 0)
        : facilities;
    const total = landCand.length + facCand.length;
    if (total === 0) return { ...base, amount: 0 };
    const pick = rng.below(total);
    // ★ 挑中的那一处 —— **改没改动都带**（原版 pass 0 已把名字填进訊息框、
    //   pass 1 照样 `view_to` + 影片；新聞 21 挑到空地时 `mutate_land` 什么都不改）。
    //   `owner` 取**改之前**的值：原版 pass 0 就 `[0x48c5a0] = byte [实体 + 0x19]`
    //   （新聞 21 `0x0044ad70..0x0044ad79`；5 / 15 / 19 同形），房主台词看的是它。
    if (pick < landCand.length) {
      const before = landCand[pick]!;
      const place = { entity: ESTATE_LAND_BASE + before.id, owner: before.owner };
      const after = mutateLand(before, razeMode);
      if (!after.changed) return { ...base, amount: 0, place };
      return {
        ...base,
        players: applyRelease(base.players, [after.releasesConfined]),
        amount: 1,
        landMutations: [
          { id: after.land.id, level: after.land.level, type: after.land.type, owner: after.land.owner },
        ],
        place,
      };
    }
    const before = facCand[pick - landCand.length]!;
    const place = { entity: ESTATE_FACILITY_BASE + before.id, owner: before.owner };
    const after = mutateFacility(before, razeMode);
    if (!after.changed) return { ...base, amount: 0, place };
    return {
      ...base,
      place,
      players: applyRelease(base.players, [after.releasesConfined]),
      amount: 1,
      facilityMutations: [
        {
          id: after.facility.id,
          level: after.facility.level,
          type: after.facility.type,
          owner: after.facility.owner,
        },
      ],
    };
  }

  // ── 新聞 30..35「企業罰款／海外投資／獲利調高一倍」────────────────
  //   六条都是**不动 `affected`**：随机挑一家企業，直接改它的两张盈余表
  //   （`+0x28` 会分红清零、`+0x2c` 从不清，见 `GameState.companyFunds/companyProfit`），
  //   再按该企業对应的股票写 `newsFlag` 并**立刻重算当日价**（`0x429040`）。
  //   逐条数值与 flag 见 event-table 的注释表。
  const companyKind: 'penalty' | 'gain' | 'loss' | 'double' | null =
    entry.effects.includes('companyPenalty')
      ? 'penalty'
      : entry.effects.includes('companyGain')
        ? 'gain'
        : entry.effects.includes('companyLoss')
          ? 'loss'
          : entry.effects.includes('companyProfitDouble')
            ? 'double'
            : null;
  if (companyKind !== null) {
    const rng = ctx.rng;
    const commercials = ctx.commercials ?? [];
    const funds = ctx.companyFunds ?? [];
    const profit = ctx.companyProfit ?? [];
    if (rng === undefined || commercials.length === 0) {
      return { ...base, unimplemented: true };
    }
    // 新聞 35 的候选集**只收 `+0x28 > 10000` 的**；其余五条收全部
    const cand =
      companyKind === 'double'
        ? commercials.filter((c) => (funds[c.id] ?? 0) > 10000)
        : commercials;
    // ★ 候选为空时原版 `idiv` 除零崩 ⇒ 本引擎什么都不做
    if (cand.length === 0) return { ...base, amount: 0 };
    const co = cand[rng.below(cand.length)]!;
    const beforeFunds = funds[co.id] ?? 0;
    const beforeProfit = profit[co.id] ?? 0;
    const amount = entry.companyAmount ?? 0;
    let nextFunds = beforeFunds;
    let nextProfit = beforeProfit;
    /** 写进该股 `newsFlag` 的值（0 = 不写） */
    let flag = 0;
    if (companyKind === 'penalty') {
      nextFunds = beforeFunds - amount;
      nextProfit = beforeProfit - amount;
      flag = 3;
    } else if (companyKind === 'gain') {
      nextFunds = beforeFunds + amount;
      nextProfit = beforeProfit + amount;
      flag = 0x30;
    } else if (companyKind === 'loss') {
      nextFunds = beforeFunds - amount;
      nextProfit = beforeProfit - amount;
      flag = 4;
    } else {
      // 獲利調高一倍：`+0x28 = x*2`、`+0x2c += x*2`，flag 高位按获利规模
      nextFunds = beforeFunds * 2;
      nextProfit = beforeProfit + nextFunds;
      flag = (Math.trunc(beforeFunds / 10000) << 4) & 0xf0;
    }
    let market = ctx.market;
    // @source `cmp byte [ebx+0x19], 0xc / jae 跳过` —— `+0x19` 就是**股票下标**（0 基）
    if (market !== undefined && co.stockIndex < 12) {
      const stocks = [...market.stocks];
      const st = stocks[co.stockIndex];
      if (st !== undefined) {
        stocks[co.stockIndex] = { ...st, newsFlag: flag };
        market = applyStockNews({ ...market, stocks }, co.stockIndex + 1);
      }
    }
    return {
      ...base,
      amount,
      companyMutations: [{ id: co.id, funds: nextFunds, profit: nextProfit }],
      ...(market === undefined ? {} : { market }),
    };
  }

  // ── 新聞 7「公開拍賣公有土地一處」────────────────────────────────
  //   @source `fcn_00449735`：收 `owner == 0` 的地块与設施（两个循环），
  //   `rand() % 数量` 挑一个，phase 2 直接 `auction_entry(-1, target, 1)` 开拍。
  //   ★ 没有无主地时原版 `idiv` 除零崩 ⇒ 本引擎那一支什么都不做。
  if (entry.effects.includes('publicAuction')) {
    const rng = ctx.rng;
    const lands = (ctx.lands ?? []).filter((l) => l.owner === 0);
    const facilities = (ctx.facilities ?? []).filter((f) => f.owner === 0);
    if (rng === undefined) return { ...base, unimplemented: true };
    const total = lands.length + facilities.length;
    if (total === 0) return { ...base, amount: 0 };
    const pick = rng.below(total);
    const chosen =
      pick < lands.length
        ? { entityId: lands[pick]!.id, facility: false }
        : { entityId: facilities[pick - lands.length]!.id, facility: true };
    return { ...base, amount: 0, publicAuction: chosen };
  }

  // ★ 銀行擠兌：不看 affected，**所有在场玩家**的 +0x3c 都写成 15 @source 0x0044aeb6..0x0044aed8
  //   天数 15 是汇编里写死的立即数；文案的「１５」是全角字、没有 %d，
  //   故 event-table 的 literal 为 null（同 4/29 的既有先例），常数住在这里。
  if (entry.effects.includes('loanFreeze')) {
    const days = LOAN_FREEZE_DAYS;
    const next = players.map((p) => (isAlive(p) ? { ...p, bankFreezeDays: days } : p));
    return { ...base, players: next, amount: days };
  }

  // ── 新聞 16 / 17「行人／車輛休息一回合」────────────────────────
  //   ★ 也是**不看 `affected`**：原版逐人筛「在场 + 交通方式对得上」，命中就写
  //     `+0x38 (days_stopping) = 1`。
  //     @source `fcn_0044a5d6`（VA 0x0044a606 起）与 `fcn_0044a657`（0x0044a68b 起）：
  //     ```asm
  //     for (i = 0; i < [0x499114]; i++) {          ; num_players
  //       if (player[+0x15] == 0) continue;          ; 出局跳过
  //       if (player[+0x11] != 0) continue;          ; ★ 16：traffic_method != 0 → 跳过（只打行人）
  //       … 画头像 …
  //       player[+0x38] = 1                          ; days_stopping
  //     }
  //     ```
  //     17 的那一支把中间的判据反过来（`je skip`）⇒ 只打**非行人**。
  if (
    entry.effects.includes('stopPedestrians') ||
    entry.effects.includes('stopVehicles')
  ) {
    const wantPedestrian = entry.effects.includes('stopPedestrians');
    const next = players.map((p) => {
      if (!isAlive(p)) return p;
      // traffic_method 0 = 走路（行人）；非 0 = 有座驾
      const isPedestrian = p.trafficMethod === 0;
      if (isPedestrian !== wantPedestrian) return p;
      return { ...p, blocking: { ...p.blocking, stopping: 1 } };
    });
    return { ...base, players: next, amount: 1 };
  }

  // ── 新聞 24 / 25「股市崩盤／全面上漲」──────────────────────────
  //   @source VA 0x0044b035..0x0044b047（24）与 0x0044b080..0x0044b092（25）：
  //   ```asm
  //   for (edx = 0; edx < 0xc; edx++) {
  //     eax = edx*9                       ; 一支股票 36 字节 = 9 个 dword
  //     byte [eax*4 + 0x496987] = 1       ; 24：低半字节 1 = 利空 1 天
  //     byte [eax*4 + 0x496987] = 0x10    ; 25：高半字节 1 = 利多 1 天
  //   }
  //   ```
  //   ★ 是**赋值**不是置位 ⇒ 会把原有的剩余天数冲掉（两支都照抄）。
  if (entry.effects.includes('marketBearish') || entry.effects.includes('marketBullish')) {
    const flag = entry.effects.includes('marketBullish') ? 0x10 : 0x1;
    const market = ctx.market;
    if (market === undefined) return { ...base, unimplemented: true };
    const stocks = market.stocks.map((s) => ({ ...s, newsFlag: flag }));
    return { ...base, amount: 1, market: { ...market, stocks } };
  }

  // ── 新聞 26「股市暫停交易１０天」──────────────────────────────
  //   @source VA 0x0044b0c6 `mov dword [0x4990dc], 0xa` ⇒ `closedDays = 10`
  //   （文案说 10 天，但计数「减到 0 先置 0x80、隔天再清」⇒ 实际关门 11 天，见
  //    `stock-market.ts` 的 `tickMarketClosure`）。这四条**不看 `affected`**。
  if (entry.effects.includes('marketClose')) {
    const market = ctx.market;
    if (market === undefined) return { ...base, unimplemented: true };
    return { ...base, amount: MARKET_CLOSE_DAYS, market: { ...market, closedDays: MARKET_CLOSE_DAYS } };
  }

  // ── 新聞 27 / 28「某支股票暫停交易／恢復上市交易」────────────────
  //   @source `fcn_0044b0d1`（27）与 `fcn_0044b1a3`（28）：
  //   ```asm
  //   ; 27
  //   call rand / idiv 0xc            ; ★ 12 支里随机挑
  //   mov  byte [股票 + 6], 0xf       ; f6 = 15（文案说 10 天，立即数是 15）
  //   mov  ecx, [股票 + 0x10]         ; openPrice
  //   mov  [股票 + 0x14], ecx         ; price ← openPrice（当日冻结）
  //   day = [0x499100] - 1（< 0 → 0x8f）
  //   history[股票][day] = price
  //   ; 28
  //   收集所有 f6 != 0 的股票 → call rand / idiv 数量 → mov byte [股票 + 6], 0
  //   ```
  //   ★ 28 在「一支都没有」时原版 `idiv ebx`（ebx=0）会除零崩 —— 本引擎那一支直接不动。
  if (entry.effects.includes('suspendStock') || entry.effects.includes('resumeStock')) {
    const market = ctx.market;
    const rng = ctx.rng;
    if (market === undefined || rng === undefined || market.stocks.length === 0) {
      return { ...base, unimplemented: true };
    }
    const stocks = [...market.stocks];
    if (entry.effects.includes('suspendStock')) {
      const pick = rng.below(market.stocks.length);
      const target = stocks[pick]!;
      // price ← openPrice（原版把当日价冻结在开盘价）
      stocks[pick] = { ...target, f6: STOCK_SUSPEND_DAYS, price: target.openPrice };
      const day = (market.day - 1 + HISTORY_DAYS) % HISTORY_DAYS;
      const history = market.history.map((row, i) =>
        i === pick ? row.map((v, d) => (d === day ? stocks[pick]!.price : v)) : row,
      );
      return {
        ...base,
        amount: STOCK_SUSPEND_DAYS,
        market: { ...market, stocks, history },
      };
    }
    // 28：只在**已停牌**的那几支里挑（挑不到就什么都不做，不照抄除零崩）
    const suspended = market.stocks
      .map((s, i) => ({ s, i }))
      .filter((e) => e.s.f6 !== 0)
      .map((e) => e.i);
    if (suspended.length === 0) return { ...base, amount: 0 };
    const pick = suspended[rng.below(suspended.length)]!;
    stocks[pick] = { ...stocks[pick]!, f6: 0 };
    return { ...base, amount: 0, market: { ...market, stocks } };
  }

  // ── 百分比类（11/12/13/23）────────────────────────────────────
  // ★ 四条事件的 `factor` 都是 null，金额要**逐人现算**（见 rules/percentage.ts）：
  // ```asm
  // 00449cce  for (i = 0; i < num_players; i++) {
  //             if (player[i].who_plays == 0) continue      ; 出局跳过
  //             [0x48c59c + i*4] = trunc(基数 × 税率)        ; ★ 先算好存起来
  //             … 画那一行「%s 繳交 %d 元」…
  //           }
  // 00449da1  for (i = 0; i < num_players; i++) {          ; ★ 第二趟才真收钱
  //             if ([0x46caf8] != 0) break                  ; 终局码
  //             pay_money(player[i], -1, [0x48c59c + i*4], 0)
  //           }
  // ```
  // 地價稅 / 證交稅 / 儲金紅利三支同构，只有基数与税率不同。
  const perPlayer = PERCENT_NEWS.get(eventId);
  if (perPlayer !== undefined) {
    // ★ 「先算好」那一趟：金额逐人算出并**带出去**（`shares`），第二趟才真收/真发。
    const shares: { player: number; amount: number }[] = [];
    for (const who of ctx.affected) {
      const p = players[who];
      if (p === undefined || !isAlive(p)) continue;
      const each = perPlayer(p, who, ctx);
      shares.push({ player: who, amount: each });
      if (each <= 0) continue;
      if (entry.effects.includes('pay')) {
        const r = transferMoney(players, [], pool, who, PARTY_POOL, each, 0);
        players = r.players;
        pool = r.pool;
        total += r.paid;
        bankrupted = bankrupted || r.bankrupted;
      } else {
        // ★★ 2026-09-19 修：**儲金紅利（23）进的是「银行存款」，不是现金**。
        //   `@source` news[23] 的收尾 `fcn_0044aedb`：
        // ```asm
        // 0044af36  mov  ebp, dword ptr [ebx + 0x496b8c]   ; 有贷款就不发（ebp = loan）
        // 0044af3e  jne  跳过
        // 0044af44  fild dword ptr [ebx + 0x496b88]        ; ★ +0x20 = money_in_bank
        // 0044af4a  fmul qword ptr [0x465734]              ; = 0.1（dump 该 double：9a99…b93f）
        // 0044af50  call 0x457dbc                          ; 向零截断
        // 0044af5c  push ebp                               ; ★ flags = 0（ebp 此时必为 0）
        // 0044af65  call 0x41d3f4                           ; add_money(player, 金额, 0)
        // ```
        //   `0x41d3f4` 里 `test byte [esp+0x10], 1 / je 进存款` ⇒ flags=0 写 `+0x20`
        //   （存款），而 `receiveMoney` 的缺省 `toCash = true` 写的是 `+0x1c`（现金）。
        //   ⚠️ 其余百分比类（11/12/13）都是 `pay`，走不到这一支。
        players = receiveMoney(players, who, each, eventId !== 23);
        total += each;
      }
    }
    return {
      players,
      objects,
      pool,
      prisonOccupancy,
      hospitalOccupancy,
      amount: total,
      bankrupted,
      unimplemented: false,
      shares,
    };
  }

  for (const who of ctx.affected) {
    if (players[who] === undefined) continue;

    if (entry.effects.includes('prison') || entry.effects.includes('hospital')) {
      const days = ctx.days ?? entry.literal;
      if (days === null || days === undefined) return { ...base, unimplemented: true };
      const kind = entry.effects.includes('prison') ? 'prison' : 'hospital';
      // ★ 两张表各归各的（先前一律写监狱表，医院的人会记错地方）
      const table = kind === 'prison' ? prisonOccupancy : hospitalOccupancy;
      // ★★ 2026 本轮：还要把**另一张**交给 `confine` —— 首次关押时原版
      //   `0x40d761` 会把"当前非 0 的那一张"清掉（两道闸），
      //   否则「住院中被新聞关进监狱」会同时占着医院床位。
      //   差分证据：rich4-spec/tests/test_confinement_release.py（15/15）。
      const other = kind === 'prison' ? hospitalOccupancy : prisonOccupancy;
      // ★ 首次关押还要**传送到监狱／医院格 + 跟班搬家** —— 那是原版
      //   `send_to_prison`/`send_to_hospital` **函数体内**的事，故走
      //   `sendToConfinement`（见 rules/confinement.ts 的长注释）。
      const out = sendToConfinement(
        players,
        objects,
        ctx.nodes ?? [],
        table,
        kind,
        who,
        days,
        other,
        ctx.landscapes,
      );
      players = out.players;
      objects = out.objects;
      if (kind === 'prison') prisonOccupancy = out.occupancy;
      else hospitalOccupancy = out.occupancy;
      if (out.otherOccupancy !== undefined) {
        if (kind === 'prison') hospitalOccupancy = out.otherOccupancy;
        else prisonOccupancy = out.otherOccupancy;
      }
      total = days;
      continue;
    }

    if (entry.factor === null) return { ...base, unimplemented: true };

    if (entry.effects.includes('pay')) {
      const r = transferMoney(players, [], pool, who, PARTY_POOL, amount, 0);
      players = r.players;
      pool = r.pool;
      total += r.paid;
      bankrupted = bankrupted || r.bankrupted;
    } else if (entry.effects.includes('give')) {
      players = receiveMoney(players, who, amount);
      total += amount;
    }
  }

  return {
    players,
    objects,
    pool,
    prisonOccupancy,
    hospitalOccupancy,
    amount: total,
    bankrupted,
    unimplemented: false,
  };
}
