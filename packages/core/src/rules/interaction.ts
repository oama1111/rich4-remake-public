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
   */
  | { kind: 'lottery'; available: number[]; price: number; owned: number }
  /**
   * 拍卖：出价。
   * @source `run_auction` VA 0x0043bde5
   */
  | { kind: 'auction'; entityId: number; basePrice: number; bidders: number[] }
  /**
   * 上市企业：买多少股。
   *
   * @source 落点 VA 0x0041d277：拿到股数后
   *   `buy_stock(玩家, commercial[+0x19], 股数, 0)`，末位 0 即「从企业买」。
   *
   * `unitPrice` = `企业资产额 ÷ 10000`（整数除），**从现金付**，
   * 与股市柜台那条（从存款付、按股价）是两回事。
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
      /** 买家现金 —— 买得起多少股由 UI/AI 自己算 */
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

/** 各特殊格对应的场所名 —— 仅用于 `unimplemented` 的可读性 */
const PLACE_NAMES: Readonly<Record<number, string>> = {
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
  | { kind: 'bankDeposit'; amount: number }
  | { kind: 'bankWithdraw'; amount: number }
  | { kind: 'bankBorrow'; amount: number }
  | { kind: 'bankRepay'; amount: number }
  /** 特別融資：借 / 還。只有銀行董事長能用 */
  | { kind: 'bankFinanceBorrow'; amount: number }
  | { kind: 'bankFinanceRepay'; amount: number }
  | { kind: 'lotteryBuy'; number: number }
  | { kind: 'auctionBid'; winner: number; price: number }
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
