/*
 * 落点交互
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 原版的各个场所（银行、百货、魔法屋、乐透、拍卖……）都是**模态 UI**：
 *   落地后弹窗，玩家在里面操作，操作完才继续回合。
 *
 *   按 C-ARC-2，这些界面不进 core。但「落在这格上会要求玩家做什么」
 *   **是规则**，必须由 core 说了算——否则 UI 和 AI 各自猜一套，
 *   联机时两端就会对不上。
 *
 *   故此处定义一个**待决交互**类型：core 判定「现在需要一个什么样的决定」，
 *   外部（人类 UI 或 AI）给出答案，再以 action 形式送回。
 *   这与卡片目标选择是同一套路子。
 */

import { SPECIAL_KIND } from '../loaders/map.ts';
import type { ConfinementKind } from './confinement.ts';
import type { AuctionSeatStatus } from './auction.ts';

/**
 * 落点要求玩家做的决定。
 *
 * `kind` 之外的字段是**做这个决定所需的信息**，由 core 算好给出——
 * UI 不该自己去翻规则。
 */
export type PendingInteraction =
  /** 无需交互，直接继续 */
  | { kind: 'none' }
  /** 无主地：买或不买 */
  /**
   * ★ `name` 不是多余的：原版的问句本身就是
   *   `'%s\n\n費用:%d元\n\n是否買下此地？'`（@source VA 0x004639e1），
   *   地名是这句话的一部分。让 UI 自己拿 landId 回地图里查，就等于把
   *   「这一格叫什么」这件事散到两处去（C-ARC-2）。
   */
  | { kind: 'buyLand'; landId: number; name: string; price: number }
  /** 自有地：盖或不盖 */
  | { kind: 'upgradeLand'; landId: number; name: string; cost: number }
  /**
   * 无主設施：买或不买。问句与買地共用同一条原文（@source 0x0041a8a5 push 0x4639e1）。
   * 价 = 地價 × 物價指數。
   */
  | { kind: 'buyFacility'; facilityId: number; name: string; price: number }
  /**
   * 自己的**空地**設施（等级 0）：选五种建筑之一并蓋第一级。
   *
   * @source 0x0041a1f2 `cmp level, 0 / jne 加蓋`；真人走 `0x440aac` 选种类，
   *   电脑 `rand() % 4 + 1`。价 = 地價 × 物價指數（与買地相同）。
   * `choices` 是 0..4 全部五种 —— 真人可以选公園，电脑抽不到而已。
   */
  | { kind: 'buildFacility'; facilityId: number; name: string; price: number; choices: readonly number[] }
  /** 自己的設施（等级 ≥ 1）：加蓋一级。价 = 房價 × 物價指數 */
  | { kind: 'upgradeFacility'; facilityId: number; name: string; cost: number; level: number }
  /**
   * 自己的**已建研究所**：落点收尾时选一个研發項目（1..等级）。
   * @source 0x0041b0b3..0x0041b109：落点结算末尾，`code ∈ 設施 && owner == 我 && 不在夢遊
   *   && type == 4 && level != 0 && (+0x1c & 0xf) == 0（没被查封）` → 开研究所面板 0x44101d；
   *   真人在面板里点（0x4402d7），电脑走 0x4411e7 直接选「等级」那一档。
   */
  | { kind: 'research'; facilityId: number; name: string; level: number; choices: readonly number[] }
  /**
   * 建設公司：选一处自己的地免费加蓋一级。
   * @source 0x0041acd1（别人的建設公司，之后付工程費）/ 0x0041aa3c（自家的，免费）。
   *   真人用 `0x446ae8` 点地图选，电脑走 `0x40b455`（reducer 里直接挑）。
   * `choices` 是可加蓋的实体编码（0x7d0 + 地块 / 0xfa0 + 設施）；`charge` 是选完要不要付工程費。
   */
  | { kind: 'chooseBuildTarget'; commercialId: number; name: string; choices: readonly number[]; charge: boolean }
  /**
   * 银行：存、取、借、还，外加董事長专属的特別融資。
   *
   * @source 落点 VA 0x00436668 —— 先查 `days_rejected_by_bank`，
   *   非 0 直接返回（拒绝往来期内连门都进不去）。
   *
   * ★ `specialFinance` 只有**董事長**才有（`null` = 不是董事長 ——
   *   原版那扇窗户里就看不见人）。见 places/special-finance.ts。
   */
  | {
      kind: 'bank';
      wealth: number;
      loanCapacity: number;
      specialFinance: { owed: number; available: number } | null;
    }
  /**
   * 樂透：挑一个没被买走的号码。
   * @source 落点 VA 0x004315cc
   *
   * ★ 只有**真人**收得到这个交互，而且**一次落点只买一注**：原版买中的那一下
   *   投注屏就自己关了（VA 0x0042ffd1 → `PostMessage(0x406,3,0)` → state 5）。
   *   电脑在原版里根本没有屏，落点当场买完 —— 见 `state/reduce.ts` 的
   *   `landOnLottery`。
   */
  | { kind: 'lottery'; available: number[]; price: number; owned: number }
  /**
   * 拍卖：竞价循环的**状态**。
   *
   * @source `run_auction` VA 0x0043bde5（入口/窗口过程 `fcn_0043a2dd`）
   *
   * ★ Q-AUC-1 定案（2026-09-15）：竞价循环归 core —— 原版那条 100ms 定时器
   *   刷新循环（轮到谁 → 真人点钮 / 电脑算一口 → `loc_0043b295` 复查）
   *   现在立在 `rules/auction.ts`，`state/reduce.ts` 的 `auctionBid`
   *   一个 action 走一口。表现层（`client/auction-screen.ts`）只负责
   *   **收集真人的那一口**并把 core 的每一口演出来。
   *
   * 之所以不能像别的交互那样整条留给表现层：`packages/server` 是**无头**跑
   * core 的（服务器权威），纯 AI 局也走同一条路 —— 没有屏可点，pending
   * 就永远答不掉（soak 卡死）。
   */
  | {
      kind: 'auction';
      entityId: number;
      /** 起拍价 `[0x48c488]` 的初值（= `auctionBasePrice` 的产物） */
      basePrice: number;
      /** 可以出价的玩家下标。core 已排除出局者与现任地主 */
      bidders: number[];
      /**
       * **卖家**的玩家下标（= 待拍实体的现主；无主地自拍时就是出卡人）。
       *
       * ★ 原版在座位表里给卖家写状态 **7**，出价循环因此永远跳过它
       *   （`loc_0043c110` 的 `cmp ebx, [esp+0xac]` 那一支 + `loc_0043b3c2` 的绕圈）。
       *   本引擎的 `status` 没有「7」这一档，故把卖家单列一个字段，让
       *   `auctionFirstSeat` / `auctionAdvanceSeat` 显式跳过他 ——
       *   否则无主地自拍（`bidders` 含卖家且他是 `'active'`）会把出价权
       *   交给卖家，屏上等他自己点（外部审查 A-3）。
       *   `-1` = 没有卖家要排除。
       */
      seller?: number;
      /** 設施拍卖（拍賣卡踏在設施格上时挂出） */
      facility?: boolean;
      /** 现价 `[0x48c488]`：每一口加价都改写它；还没人出价时 = `basePrice` */
      price: number;
      /** 当前最高出价者的**玩家下标**；-1 = 还没人出价 @source `[0x48c4a8]` */
      top: number;
      /**
       * 当前最高出价者**出那一口时的现金** @source `[0x48c438]` 之类的现场快照。
       * `loc_0043b183` 要拿「最高者的现金 + 500」当压价线，而最高者可能已经
       * PASS 离场，届时再读他的现金就不是当时那个数了 —— 故出价时记下来。
       * `top < 0` 时无意义。
       */
      topCash: number;
      /**
       * 轮到哪个座位（0..3）@source `[0x48c4a4] & 3`。
       * 座位按玩家下标排，故就是「轮到哪个玩家」。
       */
      seat: number;
      /**
       * 各座位的状态，下标 = 玩家下标 @source `[0x48c436 + 20i]`：
       * `'active'` = 0（还能出价）、`'passed'` = 1（已 PASS，★ 永久）、
       * `'givenUp'` = 4（按了「放棄」/ 出不起，同样永久）。
       */
      status: AuctionSeatStatus[];
      /**
       * 各座位的**心理价位**（下标 = 玩家下标）@source 座位 `+8` `[0x48c438]`。
       * 开拍时算一次就定住；真人座位是 0。
       */
      limits: number[];
    }
  /**
   * **开拍请求** —— 卡片等调用点能提供的那几项。
   *
   * 竞价循环要的其余字段（现价 / 最高者 / 座位状态 / 心理价位）由 core 在
   * 挂出 pending 时补齐（`state/reduce.ts` 的 `openAuction`）—— 因为
   * 「心理价位」要读全局随机状态，只有 reducer 手上有。
   */

  /**
   * 上市企业：买多少股。
   *
   * @source 落点 VA 0x0041d277：拿到股数后
   *   `buy_stock(玩家, commercial[+0x19], 股数, 0)`，末位 0 即「从企业买」。
   *
   * `unitPrice` = `企业资产额 ÷ 10000`（整数除），**从现金付**，
   * 与股市柜台那条（从存款付、按股价）是两回事。
   *
   * ★ `max` 是**通用填数窗的上限**，由 core 按原版 `fcn_0041d1a9` 算好
   *   （见 `places/company.ts` 的 `shareWindowLimit`）。UI 只许把它交给
   *   `AmountPage`，**不许自己再算一遍**（C-ARC-2）。
   */
  | {
      kind: 'buyShares';
      /** 1 基企业序号 */
      commercialId: number;
      /** 企业名，UI 直接用 */
      name: string;
      /** 对应股票下标 0..11 */
      stock: number;
      /** 每股价格 */
      unitPrice: number;
      /** 企业还剩多少股可卖 */
      available: number;
      /**
       * 通用填数窗的**上限** = `min(1000, 現金 ÷ 每股售價, available)`
       * —— 原版 `fcn_00453544(上限)` 吃到的就是这个数。
       *
       * ⚠️ 电脑那条（`_rich4_calculate_max_purchase_count`，VA 0x0041d839）
       *   **没有 1000 这层闸**，AI 策略层要买多少照旧用 `available` 自己算。
       */
      max: number;
      /** 买家现金 —— 只在题面上显示；能买多少股已经由 `max` 定死 */
      cash: number;
    }
  /**
   * 百貨公司：买卖卡片与道具，**花的是點數**。
   *
   * @source `_rich4_player_buy_card` / `_rich4_player_buy_tool`
   *   都从玩家 +0x30（點數）扣，不动现金。
   */
  | {
      kind: 'shop';
      /** 手上的點數 —— 买得起什么由 UI/AI 自己算 */
      points: number;
      /** 可买的卡片：编号与標價 */
      cards: { id: number; name: string; price: number }[];
      /** 可买的道具：编号、標價、全局库存（编号 > 8 不限量，给 null） */
      tools: { id: number; name: string; price: number; stock: number | null }[];
      /**
       * **自己手上**的卡片与道具 —— 这一屏能卖，退九成點數。
       *
       * ★ 需求方描述这一屏时说得很清楚：「右下侧是自己已有的卡片列表，
       *   点击可以卖出自己的卡片换得点数」。规则引擎里 `sellCard`/`sellTool`
       *   一直有，只是 `pending` 没把「你手上有什么」带出来，界面便无从显示。
       */
      owned: {
        cards: { id: number; name: string; refund: number }[];
        tools: { id: number; name: string; count: number; refund: number }[];
      };
    }
  /**
   * 小游戏：企鵝挖寶 / 七彩氣球 / 喜從天降。
   *
   * ★ 规则上只产出一笔點券。玩法本身是表现层的事，
   *   分数作为答复送回来（`minigameScore`）；不玩就按 50..69 抽一个。
   *
   * @source 落点跳表第 6/7/8 项，见 places/minigame.ts
   */
  | {
      kind: 'minigame';
      /** 6/7/8，见 `MINIGAME` */
      game: number;
      name: string;
      /** 分数上限 —— 超出会被夹回来 */
      maxScore: number;
    }
  /**
   * 探監／探病：花點券**保釋**里面的人。
   *
   * @source 監獄落点 0x0043d304 / 醫院落点 0x0043e9a4，见 rules/visit.ts
   */
  | {
      kind: 'bail';
      /** 'prison' | 'hospital' */
      place: ConfinementKind;
      candidates: {
        slot: number;
        player: number;
        name: string;
        cost: number;
        affordable: boolean;
      }[];
      /** 访客手上的點券 */
      points: number;
    }
  /**
   * 尚未实现的场所。
   *
   * ⚠️ 这一项存在的意义是**让缺口可见**：落在百货/魔法屋/小游戏上时，
   * 上层会收到一个明确的「这里还没做」，而不是悄无声息地什么都不发生。
   *
   * `options` 用来在「选项表已解出、效果还没做」时把缺口具体到条。
   * 魔法屋曾经是这种情况，现在已实现（见 places/magic-house.ts），
   * 故眼下没有场所在用它——留着是因为三个小游戏迟早会用上。
   */
  | { kind: 'unimplemented'; place: string; specialKind: number; options?: readonly string[] };

/**
 * 一段契约：**开拍请求** —— 调用点（拍賣卡等）能提供的那几项。
 *
 * 竞价循环要的其余字段（现价 / 最高者 / 座位状态 / 心理价位）由 core 在挂出
 * pending 时补齐（`state/reduce.ts` 的 `openAuction`）—— 因为「心理价位」
 * 要读全局随机状态与地图表，只有 reducer 手上有。
 */
export type AuctionRequest = Pick<
  Extract<PendingInteraction, { kind: 'auction' }>,
  'kind' | 'entityId' | 'basePrice' | 'bidders' | 'facility' | 'seller'
>;

/** `auction` 的**完整**形状（竞价循环进行中，字段一定齐） */
export type AuctionPending = Extract<PendingInteraction, { kind: 'auction' }>;

/** 各特殊格对应的场所名 —— 仅用于 `unimplemented` 的可读性 */const PLACE_NAMES: Readonly<Record<number, string>> = {
  // ★ **空的** —— 17 种特殊格已全部接上规则：
  //   公園/新聞/命運/監獄/醫院/三个小游戏/樂透/三种點數格/卡片/
  //   銀行/百貨公司/魔法屋。
  //   这张表与 `unimplemented` 那一路**保留不删**：往后要是解出新的
  //   特殊格类型、或者某条规则要临时退场，得有地方明确说「这里还没做」，
  //   而不是悄无声息地什么都不发生。
};

/**
 * 这一格是否需要交互。
 *
 * ⚠️ 監獄與醫院落点**并非总要交互**：原版先查占用表，
 * 无人在押时直接返回（即「探监」没人可探）。
 * 该判断需要占用表，故不在本函数内做——见 `rules/confinement.ts`
 * 的 `anyoneConfined`。
 */
export function needsInteraction(specialKind: number): boolean {
  switch (specialKind) {
    case SPECIAL_KIND.NONE:
    case SPECIAL_KIND.PARK:
    // 新聞/命運/點數/抽卡 都是**即时结算**，不需要玩家做决定
    case SPECIAL_KIND.NEWS:
    case SPECIAL_KIND.FORTUNE:
    case SPECIAL_KIND.POINTS_50:
    case SPECIAL_KIND.POINTS_30:
    case SPECIAL_KIND.POINTS_10:
    case SPECIAL_KIND.CARD:
      return false;
    default:
      return true;
  }
}

/** 该特殊格是否尚未实现 */
export function isUnimplementedPlace(specialKind: number): boolean {
  return specialKind in PLACE_NAMES;
}

/** 构造一个「尚未实现」的交互，带上可读的场所名 */
export function unimplementedPlace(specialKind: number): PendingInteraction {
  const base = {
    kind: 'unimplemented' as const,
    place: PLACE_NAMES[specialKind] ?? `特殊格${specialKind}`,
    specialKind,
  };
  return base;
}

/** 玩家对待决交互给出的答复 */
export type InteractionResponse =
  | { kind: 'decline' }
  | { kind: 'buyLand' }
  | { kind: 'upgradeLand' }
  | { kind: 'buyFacility' }
  | { kind: 'buildFacility'; facilityType: number }
  | { kind: 'upgradeFacility' }
  | { kind: 'research'; project: number }
  | { kind: 'buildTarget'; entityId: number }
  | { kind: 'bankDeposit'; amount: number }
  | { kind: 'bankWithdraw'; amount: number }
  | { kind: 'bankBorrow'; amount: number }
  | { kind: 'bankRepay'; amount: number }
  /** 特別融資：借 / 還。只有銀行董事長能用 */
  | { kind: 'bankFinanceBorrow'; amount: number }
  | { kind: 'bankFinanceRepay'; amount: number }
  | { kind: 'lotteryBuy'; number: number }
  /**
   * 拍賣的一口价 —— 由 core 的循环消费（`state/reduce.ts` 的 `auctionBid`）。
   *
   * ★ Q-AUC-1 之前这里是 `auctionBid{winner, price}`（终局），现已改成
   *   **一口价**：竞价过程本身归 core 了，终局由 core 自己判、自己落。
   */
  | { kind: 'auctionBid'; bidder: number; status: 'raise' | 'pass' | 'giveUp'; step: number }
  | { kind: 'buyShares'; shares: number }
  | { kind: 'shopBuyCard'; cardId: number }
  | { kind: 'shopBuyTool'; toolId: number }
  | { kind: 'shopSellCard'; cardId: number }
  | { kind: 'shopSellTool'; toolId: number; count: number }
  /** 小游戏玩完了，报上得分；`null` 表示没玩（按 50..69 抽） */
  | { kind: 'minigameScore'; score: number | null }
  /** 保釋某个槽位的人 */
  | { kind: 'bail'; slot: number };

/** 答复与待决交互是否配套——防止 UI 送回驴唇不对马嘴的 action */
export function responseMatches(
  pending: PendingInteraction,
  response: InteractionResponse,
): boolean {
  if (response.kind === 'decline') return true;
  switch (pending.kind) {
    case 'buyLand':
      return response.kind === 'buyLand';
    case 'upgradeLand':
      return response.kind === 'upgradeLand';
    case 'buyFacility':
      return response.kind === 'buyFacility';
    case 'buildFacility':
      return response.kind === 'buildFacility';
    case 'upgradeFacility':
      return response.kind === 'upgradeFacility';
    case 'research':
      return response.kind === 'research';
    case 'chooseBuildTarget':
      return response.kind === 'buildTarget';
    case 'bank':
      return response.kind.startsWith('bank');
    case 'lottery':
      return response.kind === 'lotteryBuy';
    case 'auction':
      return response.kind === 'auctionBid';
    case 'buyShares':
      return response.kind === 'buyShares';
    case 'shop':
      return response.kind.startsWith('shop');
    case 'minigame':
      return response.kind === 'minigameScore';
    case 'bail':
      return response.kind === 'bail';
    default:
      return false;
  }
}
