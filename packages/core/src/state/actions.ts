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

  /** 岔路口选择前进方向 —— 指定下一个节点号 */
  | { type: 'chooseDirection'; nodeId: number }

  /** 结算落点 */
  | { type: 'settle' }

  /** 买下当前落点的无主地块 */
  | { type: 'buyLand' }

  /** 在当前落点的自有地块上盖房/升级一级 */
  | { type: 'upgradeLand' }

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

  /** 结束当前玩家回合，轮转到下一位 */
  | { type: 'endTurn' };

export type ActionType = Action['type'];
