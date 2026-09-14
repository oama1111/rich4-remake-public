/*
 * Action 定义 —— 引擎的唯一输入
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * C-ARC-3：一切状态变更都必须经由 action。渲染层只读状态、派发 action，
 *          不得直接改写。
 * C-ARC-4：action **不携带「谁是本地玩家」**。本地玩家、远程玩家、AI
 *          产出的 action 在引擎看来完全一样，这是联机免改造的前提。
 * C-DET-2：引擎不读挂钟。需要真实时间的地方（单机重新播种）由宿主
 *          以 `reseed` action 显式注入，其值因此被记入 action 日志，
 *          单机局同样可完整回放。
 */

import type { CardTarget } from '../cards/target.ts';

export type Action =
  /**
   * 注入新的随机种子。
   * 单机在原版的三个时机由宿主注入（启动 / 读档后 / 回合推进）；
   * 联机仅开局一次，由服务器生成并记录。
   * @see rng/policy.ts
   */
  | { type: 'reseed'; seed: number }

  /** 开始当前玩家的回合。引擎据此判定可否行动（fcn_0040c912） */
  | { type: 'startTurn' }

  /**
   * 掷骰。
   * @param forced 遥控骰子的强制点数（1..6）；0 表示正常掷骰。
   *               强制时**不消耗随机数**且骰子数被压成 1。
   */
  | { type: 'rollDice'; forced?: number }

  /** 前进一步（逐格移动，便于与动画对齐） */
  | { type: 'step' }

  /**
   * 選擇骰子數 —— 有車的时候可以少掷几颗。
   *
   * ★ 原版把它做成一个热键（RICH4.CFG offset 0x20「選擇骰子數」）加 GO 鈕
   *   下面那三颗小骰子（`Panel.mkf` 资源 7 图 6..11）。上限由交通工具定：
   *   走路 1、機車 2、汽車 3（见 rules/tool-effects.ts 的 VEHICLE_DICE）。
   * @source 画的那段 VA 0x0041736a `dl = player.ndices − 1`，亮到第 ndices 颗
   */
  | { type: 'setDiceCount'; count: number }

  /** 结算落点 */
  | { type: 'settle' }

  /** 买下当前落点的无主地块 */
  | { type: 'buyLand' }

  /** 在当前落点的自有地块上盖房/升级一级 */
  | { type: 'upgradeLand' }

  /** 买下当前落点的无主設施 @source 0x0041a86b */
  | { type: 'buyFacility' }
  /**
   * 在自己的空地設施上选一种建筑蓋第一级。
   * @param facilityType 0 公園 / 1 旅館 / 2 購物中心 / 3 加油站 / 4 研究所
   */
  | { type: 'buildFacility'; facilityType: number }
  /** 给自己的設施加蓋一级 @source 0x0041a2b3 */
  | { type: 'upgradeFacility' }
  /**
   * 在自己的研究所上选一个研發項目（1..等级），5 天后得到道具 `項目 + 8`。
   * @source 对话框收尾 0x004411f8；电脑不走这条（reducer 在回合开始替它选）。
   */
  | { type: 'research'; facilityId: number; project: number }
  /** 建設公司：选中要免费加蓋的那处地（实体编码 0x7d0+地块 / 0xfa0+設施） */
  | { type: 'buildTarget'; entityId: number }

  /** 放弃当前的买地/盖房机会 */
  | { type: 'declineDecision' }

  /**
   * 买入股票。
   *
   * ★ 股市**不是一个落点**：原版的证券交易所是随时可开的 HUD 界面
   *   （买卖的三处调用点 0x0042afc6 / 0x0042c72d / 0x0042d033 都在
   *   UI 代码段，不在落点处理里）。故它不走 `pending` 那一套，
   *   而是当前玩家回合内的一个独立 action。
   *
   * @param stock  股票下标 0..11
   * @param shares 股数
   */
  | { type: 'buyStock'; stock: number; shares: number }

  /** 卖出股票 @param stock 股票下标 0..11 */
  | { type: 'sellStock'; stock: number; shares: number }

  /**
   * 落在上市企业上时买入其股份。
   *
   * ★ 与 `buyStock` 是**两条不同的路**：这一条按「企业资产额 ÷ 10000」
   *   定价、**从现金付**、扣的是企业自己的可售股数；
   *   `buyStock` 走股市柜台，按股价、从存款付、扣流通量。
   *   @source `buy_stock(…, 0)` 与 `buy_stock(…, 非0)` 两个分支
   */
  | { type: 'buyShares'; shares: number }

  /**
   * 出一张手牌。
   *
   * ★ 卡片的效果早就逐张实现好了（`cards/` 下 30 个模块），但一直
   *   **没有入口能从对局里打出来**——本 action 就是那个入口。
   *
   * `target` 由模态 UI 或 AI 给出（C-ARC-2：选人选地不进 core）。
   * 不需要目标的卡（购地/改建等）作用于玩家**当前所站地块**，
   * 传 `{ kind: 'none' }` 即可。
   */
  | { type: 'useCard'; cardId: number; target?: CardTarget }

  /**
   * 用一个道具。
   *
   * ★ 与卡片同病：道具效果（`rules/tool-effects.ts`）早就实现了，
   *   但一直没有入口能从对局里用出来。
   *
   * `nodeId` 只对**放置类**道具（路障/地雷/定時炸彈）有意义，
   * 由模态 UI 或 AI 选定（C-ARC-2）。
   */
  | {
      type: 'useTool';
      toolId: number;
      /** 放置类与飛彈的目标格；機器工人的目标地块也走这里 */
      nodeId?: number;
      /** 遙控骰子指定的点数 1..18 */
      value?: number;
    }

  /**
   * 在百貨公司买卖。
   *
   * ★ 花的是**點數**（地图上「得５０點」那类格子攒的），不是钱。
   *   商店是模态窗口，一次可买卖多样，关掉走 `declineDecision`。
   */
  /**
   * 公佈欄 —— 玩家之间的二级市场。
   *
   * - `list`：把自己的东西挂上去（`kind` 见 places/notice-board.ts 的 `LISTING`）
   * - `withdraw`：撤件
   * - `buy`：买下**别人**挂的那一件，付现金
   *
   * ★ 这是从汇编里解出来的一整套机制，先前引擎完全没有。
   */
  | {
      type: 'noticeBoard';
      op: 'list';
      kind: number;
      id: number;
      price: number;
      /** 只有股票用：股數 */
      amount?: number;
    }
  | { type: 'noticeBoard'; op: 'withdraw'; slot: number }
  | { type: 'noticeBoard'; op: 'buy'; seller: number; slot: number }

  | { type: 'shop'; op: 'buyCard' | 'sellCard'; id: number }
  | { type: 'shop'; op: 'buyTool' | 'sellTool'; id: number; count?: number }

  /** 结束当前玩家回合，轮转到下一位 */
  /**
   * 小游戏结算。
   *
   * ★ `score` 为 `null` 表示**没玩**（电脑玩家、或玩法未实现）——
   *   引擎按原版的「不玩」出口抽 50..69。玩了就把分数报上来，
   *   作为 action 参数进日志，重放时照样对得上（C-DET-4）。
   */
  /**
   * 银行柜台的四种操作。
   *
   * ★ 只在落点留下 `bank` 待决交互时有效。金额由上层给出
   *   （UI 的输入框、AI 的 `loanRatio`），规则一律在 `places/bank.ts`。
   */
  /**
   * 銀行柜台。
   *
   * ★ `financeBorrow` / `financeRepay` 是**特別融資**，只有銀行董事長
   *   （持有銀行股票最多的人）能用，且与一般貸款是两笔账 ——
   *   它不进 `loan`，所以 90 天到期、拒絕往來那一套都不适用。
   *   见 places/special-finance.ts。
   */
  | {
      type: 'bank';
      op: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'financeBorrow' | 'financeRepay';
      amount: number;
    }
  /** 保釋監獄/醫院里的某个槽位（0..3 玩家、4..7 NPC） */
  /**
   * 樂透：买一个号码。
   * ★ 就地扣现金 1000，**票钱进公库** —— 奖池就是开奖那刻的整个公库。
   */
  | { type: 'lottery'; number: number }
  /**
   * 拍卖落槌。
   *
   * ⚠️ 竞价过程是模态 UI（谁出到多少），按 C-ARC-2 不进 reducer；
   *   **结果**作为 action 参数送进来。`winner < 0` 表示流拍。
   */
  | { type: 'auction'; winner: number; price: number }
  | { type: 'bail'; slot: number }
  | { type: 'minigame'; score: number | null }
  /**
   * 电脑回合的调度步前进一格（见 GameState.aiStep）。只有当前玩家是电脑、
   * 且在 awaitingRoll 时合法；策略层在某一步「没事可做」时发它。
   */
  | { type: 'aiNext' }
  /**
   * 託管 / 取消託管（工具列「託管AI」，Data.mkf #77）：改一名玩家的 `whoPlays`。
   * 联机时由服务器在真人掉线超时后发（`WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT`），重连归还。
   * 只接受 1（真人）/ 2（電腦）/ 5（真人託管）三种值；出局者拒。
   */
  | { type: 'setAi'; player: number; whoPlays: number }
  | { type: 'endTurn' };

export type ActionType = Action['type'];
