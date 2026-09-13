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
import { MAGIC_HOUSE_OPTIONS } from '@rich4/data';

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
  | { kind: 'buyLand'; landId: number; price: number }
  /** 自有地：盖或不盖 */
  | { kind: 'upgradeLand'; landId: number; cost: number }
  /**
   * 银行：存、取、借、还。
   * @source 落点 VA 0x00436668 —— 先查 `days_rejected_by_bank`，
   *   非 0 直接返回（拒绝往来期内连门都进不去）。
   */
  | { kind: 'bank'; wealth: number; loanCapacity: number }
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
   * 尚未实现的场所。
   *
   * ⚠️ 这一项存在的意义是**让缺口可见**：落在百货/魔法屋/小游戏上时，
   * 上层会收到一个明确的「这里还没做」，而不是悄无声息地什么都不发生。
   *
   * `options` 在已经把原版选项表解出来（但效果还没实现）的场所上给出，
   * 让「差多少」具体到条——目前只有魔法屋是这种情况。
   */
  | { kind: 'unimplemented'; place: string; specialKind: number; options?: readonly string[] };

/** 各特殊格对应的场所名 —— 仅用于 `unimplemented` 的可读性 */
const PLACE_NAMES: Readonly<Record<number, string>> = {
  [SPECIAL_KIND.PENGUIN_DIG]: '企鵝挖寶',
  [SPECIAL_KIND.BALLOON]: '七彩氣球',
  [SPECIAL_KIND.GIFT_FROM_SKY]: '喜從天降',
  [SPECIAL_KIND.DEPARTMENT_STORE]: '百貨公司',
  [SPECIAL_KIND.MAGIC_HOUSE]: '魔法屋',
  [SPECIAL_KIND.PRISON]: '監獄',
  [SPECIAL_KIND.HOSPITAL]: '醫院',
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
  // ★ 魔法屋的 12 个选项名已从 exe 解出（@rich4/data 的 MAGIC_HOUSE_OPTIONS，
  //   VA 0x00475724），只是效果还没实现。把它们一并报上去，
  //   让「魔法屋没做」具体成「这 12 条没做」。
  if (specialKind === SPECIAL_KIND.MAGIC_HOUSE) {
    return { ...base, options: MAGIC_HOUSE_OPTIONS.map((o) => o.name) };
  }
  return base;
}

/** 玩家对待决交互给出的答复 */
export type InteractionResponse =
  | { kind: 'decline' }
  | { kind: 'buyLand' }
  | { kind: 'upgradeLand' }
  | { kind: 'bankDeposit'; amount: number }
  | { kind: 'bankWithdraw'; amount: number }
  | { kind: 'bankBorrow'; amount: number }
  | { kind: 'bankRepay'; amount: number }
  | { kind: 'lotteryBuy'; number: number }
  | { kind: 'auctionBid'; winner: number; price: number }
  | { kind: 'buyShares'; shares: number };

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
    case 'bank':
      return response.kind.startsWith('bank');
    case 'lottery':
      return response.kind === 'lotteryBuy';
    case 'auction':
      return response.kind === 'auctionBid';
    case 'buyShares':
      return response.kind === 'buyShares';
    default:
      return false;
  }
}
