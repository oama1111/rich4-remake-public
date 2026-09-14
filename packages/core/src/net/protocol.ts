/*
 * 联机协议
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 设计根基：引擎是**确定性**的（C-DET-*），且所有变更都表达为
 *   action（C-ARC-4）。因此联机**不需要同步状态**——只要所有人
 *   按同样的顺序重放同一串 action，就必然得到同样的状态。
 *
 *   服务器只做一件事：**给 action 定序**。它不算规则、不判胜负，
 *   甚至不需要持有完整的游戏状态。
 *
 * ★ C-LEG-5：仅限**各自拥有原版**的私人小圈子对战，
 *   不设公开服务器、不分发素材。
 */

import type { Action } from '../state/actions.ts';

/** 协议版本。双方不一致时直接拒绝连接，避免在半路才发现规则对不上 */
export const PROTOCOL_VERSION = 1;

// ============================================================
//  客户端 → 服务器
// ============================================================

export type ClientMessage =
  /** 加入房间 */
  | {
      t: 'join';
      version: number;
      room: string;
      /** 昵称，仅用于显示；断线重连靠它认回原座位 */
      name: string;
      /** 重连时：本地已施加到第几号 action（含），服务器从下一号补发；不带 = 全量补发 */
      since?: number;
    }
  /** 房主（0 号座）开局：空座由电脑补位，服务器广播 start */
  | { t: 'start' }
  /**
   * 提交一个意图。
   *
   * ⚠️ 叫「意图」而不是「动作」是有意的：客户端说的不算，
   * 服务器定序之后广播回来的才作数。客户端**不得**先本地施加再等确认——
   * 那样一旦被拒就要回滚，而确定性引擎最不该引入的就是回滚。
   */
  | { t: 'intent'; action: Action }
  /**
   * 状态校验和。
   *
   * 每回合上报一次，服务器比对。不一致说明有人的实现漂了
   * （或被改过），立刻能发现而不是等到对局后期才表现为诡异分歧。
   */
  | { t: 'checksum'; seq: number; hash: string };

// ============================================================
//  服务器 → 客户端
// ============================================================

export type ServerMessage =
  /** 加入成功，附带开局参数 */
  | {
      t: 'joined';
      version: number;
      /** 本客户端控制的玩家下标 */
      seat: number;
      room: RoomInfo;
    }
  /** 房间状态变化（有人进出、准备就绪） */
  | { t: 'room'; room: RoomInfo }
  /**
   * 开局。
   *
   * ★ `seed` 由**服务器**下发——这是联机确定性的关键：
   *   各客户端不得自行取随机数种子。
   */
  | { t: 'start'; seed: number; globalMapId: number; seats: SeatInfo[] }
  /**
   * 定序后的 action。
   *
   * `seq` 严格递增且连续；客户端必须按序号顺序施加，
   * 收到跳号就说明丢包，应请求补发而不是跳过。
   */
  | { t: 'action'; seq: number; action: Action }
  /** 校验和不一致 —— 指出是谁、在第几步 */
  | { t: 'desync'; seq: number; expected: string; got: string; seat: number }
  | { t: 'error'; message: string };

export interface SeatInfo {
  seat: number;
  name: string;
  character: number;
  /** 空座由电脑补位 */
  kind: 'human' | 'computer';
  /** 真人座位此刻是否在线（服务器维护；断线超时后由电脑代打，重连归还） */
  connected?: boolean;
}

export interface RoomInfo {
  id: string;
  seats: SeatInfo[];
  started: boolean;
}

// ============================================================
//  状态校验和
// ============================================================

/**
 * 对游戏状态取一个稳定的指纹。
 *
 * ⚠️ **不能直接 `JSON.stringify(state)`**：
 * 对象键的枚举顺序虽然在实践中稳定，但依赖它就等于把协议正确性
 * 押在引擎实现细节上（C-DET-5 明令禁止依赖 `Object.keys` 顺序）。
 * 故这里**显式列出**参与校验的字段并固定其顺序。
 *
 * 只取「规则可见」的量：钱、位置、归属、回合。不含渲染用的临时量。
 */
export function stateFingerprint(state: {
  turnCount: number;
  currentPlayer: number;
  day: number;
  month: number;
  year: number;
  priceIndex: number;
  rngState: number;
  players: readonly {
    index: number;
    cash: number;
    moneyInBank: number;
    loan: number;
    nodeId: number;
    whoPlays: number;
  }[];
  landOwner: readonly number[];
  landLevel: readonly number[];
  /** 公库 —— 樂透奖池与破产清算都汇到这里 */
  pool: number;
  /** 樂透号码表 */
  lottery: readonly number[];
  /** 道具持有表 */
  tools: readonly number[];
  /** 股市 —— 只取收盘价与流通量，历史不入指纹（144 天太长且可由价格推出） */
  market: { stocks: readonly { price: number; shares: number }[] };
  /** 各玩家持仓 */
  holdings: readonly (readonly { amount: number }[])[];
  /**
   * 地图物件表 —— 神明在谁身上、还剩几天，炸彈在谁手上、引信到哪了。
   *
   * ★ 这些**全是共享状态**：神明改事件金额倍率、拦消费，炸彈到点会
   *   炸房子送医院。不入指纹，两端就可能一边有神明一边没有，
   *   而校验和照样相等。
   */
  objects: readonly { type: number; nodeId: number; state: number; attached: number }[];
}): string {
  const parts: (string | number)[] = [
    state.turnCount,
    state.currentPlayer,
    state.day,
    state.month,
    state.year,
    state.priceIndex,
    state.rngState,
  ];
  for (const p of state.players) {
    parts.push(p.index, p.cash, p.moneyInBank, p.loan, p.nodeId, p.whoPlays);
  }
  parts.push('|', ...state.landOwner, '|', ...state.landLevel);
  // ★ 下面这几项是后来补进引擎的，一度不在指纹里——那意味着
  //   两端在公库、樂透、股市上分歧时**校验和照样相等**，
  //   desync 会一直拖到有人破产才暴露。指纹必须覆盖所有会变的共享状态。
  parts.push('|', state.pool);
  parts.push('|', ...state.lottery);
  parts.push('|', ...state.tools);
  parts.push('|');
  for (const st of state.market.stocks) parts.push(st.price, st.shares);
  parts.push('|');
  for (const row of state.holdings) for (const h of row) parts.push(h.amount);
  parts.push('|');
  for (const o of state.objects) parts.push(o.nodeId, o.state, o.attached);
  return fnv1a(parts.join(','));
}

/**
 * FNV-1a 32 位。
 *
 * 选它是因为**实现足够短**——协议两端各自实现时不容易写错，
 * 而校验和一旦两端算法不同，就会把「实现一致」误报成 desync。
 * 这里不需要抗碰撞，只需要能发现意外分歧。
 */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
