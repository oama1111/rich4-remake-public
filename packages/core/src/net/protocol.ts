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

/**
 * 协议版本。双方不一致时直接拒绝连接，避免在半路才发现规则对不上。
 *
 * ★ Q-NET-1 加的 `resync`/`replay` **不动版本号**：这是纯增量消息，
 *   老客户端不认识 `replay` 会按 `default` 忽略（退回「只喊一声」的旧行为），
 *   老服务器不认识 `resync` 也只是不答——规则语义没变，不构成「规则对不上」。
 *   真改了 action 语义或指纹算法时才该 +1。
 */
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
  | { t: 'checksum'; seq: number; hash: string }
  /**
   * 请求**全量重放** —— 失步自愈（Q-NET-1）。
   *
   * ★ 只对**已经 `join` 过的那条连接**有意义：服务器只认 `join` 时绑在
   *   这条连接上的座位，消息里**不带座位也不带名字**——故拿不到别人的重放。
   *   权限上也不多给任何东西：这条连接本来就收得到每一条广播 action。
   */
  | { t: 'resync' }
  /**
   * ★ 大厅设置（Q-NET-2）：改**自己**座位的角色。
   *
   * ⚠️ 服务器**必须**校验，不能信客户端：
   *   · 没进房、或**已经开局** → 拒（角色在 `newGame` 里就固定了，
   *     开局后再改会和服务器镜像、其他客户端的局面都不一致）；
   *   · `character` 不是 `0..LOBBY_CHARACTER_COUNT-1` 的整数 → 拒；
   *   · 该角色已被**别的**座位选了 → 拒（同一房内角色唯一，不能撞车）。
   *
   * ★ 消息里**没有 `seat` 字段**是有意的：改的是哪个座位由服务器从**连接**
   *   上认，客户端连「改别人的角色」这件事都表达不出来 —— 权限不靠客户端自觉。
   *   服务器接受后广播 `{t:'room', room}`，所有人（含发起者）都照广播更新。
   */
  | { t: 'setCharacter'; character: number }
  /**
   * ★ 大厅设置（Q-NET-2）：换房间地图。
   *
   * ⚠️ 服务器**必须**校验：只有房主（0 号座）、且**未开局**才允许，
   *   并且服务器自己手上得真有这张地图的数据；任何一条不满足都拒。
   *   开局时用这份设置（而不是各客户端自己的本地设置）`newGame`。
   */
  | { t: 'setMap'; globalMapId: number };

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
  /**
   * 全量重放 —— 对 `resync` 的答复（失步自愈，Q-NET-1）。
   *
   * 连开局参数一起给：客户端据此 `newGame` 再从头 reduce 整串 action，
   * 走的是**与单机完全相同**的那条路，故得到的 `stateFingerprint` 与
   * 服务器镜像必然相等（C-DET-*）。刻意**不传状态快照**——快照要额外
   * 定义序列化格式，而确定性引擎只要 action 序列就够。
   *
   * `actions` 从 0 号起完整连续；`through` = 最后一条的 seq（日志为空则 -1），
   * 客户端把「下一条期待的序号」接成 `through + 1`。
   *
   * ⚠️ 只发给**发起 `resync` 的那条连接**，绝不广播。
   */
  | {
      t: 'replay';
      seed: number;
      globalMapId: number;
      seats: SeatInfo[];
      through: number;
      actions: { seq: number; action: Action }[];
    }
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
  /**
   * 房间地图（大厅设置，Q-NET-2）。开局前只有房主（0 号座）能改；
   * 开局时服务器用这一张 `newGame`，不再看各客户端的本地设置。
   *
   * ⚠️ **可选**是有意的：`RoomInfo` 是「房间快照」的通用形状，
   *   谁构造它都不该被迫填地图（旧测试、监控打印都只关心座位）。
   *   缺省按 `0` 读（`roomMapId`）。
   */
  globalMapId?: number;
}

/**
 * 大厅设置的可选范围 —— 与客户端的素材一一对应：
 * · 角色 12 个（`client/setup.ts` 的 12 张 72×72 头像，`Data.mkf` 资源 2）；
 * · 地图 8 张（两个舞台 × 四张，`globalMapId` 0..7）。
 *
 * ★ 放在 core 是**有意**的：这两个范围是服务器校验的判据，
 *   客户端与服务器必须用同一份数字；各写一份迟早会漂。
 */
export const LOBBY_CHARACTER_COUNT = 12;
export const LOBBY_MAP_COUNT = 8;

/** `character` 是不是合法的角色号（0..11 的整数） */
export function isLobbyCharacter(character: unknown): character is number {
  return (
    typeof character === 'number' &&
    Number.isInteger(character) &&
    character >= 0 &&
    character < LOBBY_CHARACTER_COUNT
  );
}

/** `globalMapId` 是不是合法的地图号（0..7 的整数） */
export function isLobbyMapId(globalMapId: unknown): globalMapId is number {
  return (
    typeof globalMapId === 'number' &&
    Number.isInteger(globalMapId) &&
    globalMapId >= 0 &&
    globalMapId < LOBBY_MAP_COUNT
  );
}

/**
 * 这个角色是不是已经被**别的**座位占了 —— 「角色不能撞车」的唯一判据。
 *
 * ★ `exceptSeat` 传自己的座位：改角色时「保持不变」不算撞车，
 *   否则每个人一进房就处在自撞状态。
 */
export function characterTaken(
  seats: readonly { seat: number; character: number }[],
  character: number,
  exceptSeat: number,
): boolean {
  return seats.some((s) => s.seat !== exceptSeat && s.character === character);
}

/** 房间快照里的地图号；服务器没给就按 0 读（旧快照兼容） */
export function roomMapId(room: RoomInfo | null | undefined): number {
  return room?.globalMapId ?? 0;
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
