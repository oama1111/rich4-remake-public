/*
 * 房间集线器 —— 服务器的消息层，与传输无关
 * SPDX-License-Identifier: GPL-3.0-or-later
 * ★ 服务器权威（DEVELOPMENT_PLAN §6 步骤 3）：客户端只发**意图**，服务器用 `Room`
 *   （定序器 + core 镜像）校验、编号、广播；随机数只在镜像里消耗，客户端靠重放同步。
 * ★ 传输层抽象成 `Conn`（只有一个 `send`）：单元测试用内存连接，生产用 `ws` 适配器
 *   （见 index.ts）。这里不 import 任何网络库。
 * ★ 计时（掉线多久换电脑代打）由外部驱动：`sweepDisconnected(now)`；测试可以直接推时间。
 */

import {
  LOBBY_CHARACTER_COUNT,
  PRESENT_RATE,
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  characterTaken,
  defaultStartDate,
  deserializeGame,
  isInGame,
  isUnplaced,
  isClientId,
  isJoinMode,
  isPresentCue,
  isLobbyCharacter,
  isLobbyMapId,
  isLobbySeatCount,
  isRoomCode,
  LOBBY_DEFAULT_OPTIONS,
  lobbyOptionsError,
  sanitizeName,
  sanitizeSaveName,
  serializeGame,
  toolCount,
  withLobbyDefaults,
  type Action,
  type ClientMessage,
  type GameState,
  type LobbyOptions,
  type PresentCue,
  type Rich4Map,
  type RoomInfo,
  type RoomSummary,
  type SaveSummary,
  type SeatInfo,
  type ServerMessage,
} from '@rich4/core';
import { Room } from './room.ts';
import { SaveFullError, autoSaveId, isSaveId, type SaveStore, type StoredSave } from './saves.ts';

/** 一条到客户端的连接：集线器只会往里 send */
export interface Conn {
  send(msg: ServerMessage): void;
  /**
   * ★ W-73：服务端**主动断开**这条连接。
   *
   * 只有「加入信息不合法」那一条路会用到（任务书 W-73 §3：不合就回 `error` 并断开）。
   * 声明成可选的，是为了让只关心消息流的测试替身（`e2e.test.ts` 的 `Client`）
   * 不必为了这一个用途改写整个类。
   */
  close?(): void;
}

export interface HubOptions {
  map: Rich4Map;
  globalMapId: number;
  /** 种子由服务器生成——★ 客户端不得自取（C-DET / 反作弊） */
  seedFor: (roomId: string) => number;
  /** 一桌几个座位（原版 2..4） */
  seatCount?: number;
  /** 真人掉线多久（毫秒）交给电脑代打 @default 30000 */
  takeoverAfterMs?: number;
  /** 客户端每几号 action 上报一次校验和（对应客户端约定，仅用于文档） */
  checksumEvery?: number;
  /**
   * ★ Q-NET-2 换地图：按全局地图号取地图结构。
   *
   * 不给（测试的缺省）＝ 服务器只端得出 `globalMapId` 那一张，
   *   换别的图会被拒（错误信息是「伺服器沒有這張地圖」）。
   * 真服务器（`cli.ts`）给一份按需读 `map.mkf` 的实现。
   */
  mapFor?: (globalMapId: number) => Rich4Map | null;
  /**
   * ★ W-73 §4：同时存在的房间上限 @default 50。
   *
   * 满了之后**新建**回 `error`「伺服器房間已滿」；已经存在的房间照常进出
   * （否则一个人多了就得把别人踢出去）。
   */
  maxRooms?: number;
  /**
   * ★ W-73 §4：**全桌无人在线**超过这么久就把房间删掉 @default 600000（10 分钟）。
   *
   * 「无人在线」= 一个真人座位的 `conn` 都不在（含从没坐满的空房）。
   * 挂在本来的 `sweepDisconnected` 定时器上，不另起计时器。
   */
  roomIdleMs?: number;
  /**
   * ★ W-74：一个回合最长等多久（毫秒）。**0 = 关闭计时** @default 60000。
   *
   * 计时**只活在服务器**：到了点由服务器发 `setAi` 让电脑替这一回合，
   * 结果一律以**广播的 action** 落地 —— 各客户端不自己判超时，锁步不破。
   */
  turnMs?: number;
  /**
   * ★ W-74：广播之后这么久还没收到 `awaiting` 就**自己开始数** @default 45000。
   *
   * 兜底用：客户端卡死 / 标签页被浏览器挂起时，它永远报不出 `awaiting`
   * —— 没有这一条，那种桌子就永远卡在那个座位上。
   */
  awaitingFallbackMs?: number;
  /**
   * ★ W-74：每次 `alive` 把截止时刻往后延多少 @default 30000。
   * 延的是 `max(现值, now + 这个数)`，且**不许越过硬上限**。
   */
  aliveExtendMs?: number;
  /**
   * ★ W-74：硬上限 —— 从**开始数**那一刻起最多拖这么久 @default 180000。
   * 到了必超时，`alive` 也救不回来。
   */
  hardCapMs?: number;
  /**
   * ★ W-74：服务器读时钟的口子 @default `Date.now`。
   *
   * ⚠️ 计时类测试**必须注入**它（配合 `sweepDisconnected(now)`），
   *   一秒都不许真睡。
   */
  now?: () => number;
  /**
   * ★ v6：新局的開局日期 = 這個時刻的「今天」（`defaultStartDate`，與單機同一個函數）。
   * @default `new Date()` —— 服務器**真實**的今天（本機時區）。
   *   ⚠️ 刻意**不**跟 `now` 走：`now` 是測試用來推時間的假時鐘（常從 0 起算 = 1970 年），
   *   拿它當日曆會把開局日期鉗成 1998-01-01，與「真的今天」無關。
   *   測試可以注入固定日期；給 `null` = 用 core 缺省日期（舊行為）。
   */
  today?: (() => Date) | null;
  /**
   * ★ 聯機存檔（v6）：存檔倉庫。不給 = 不存（`listSaves` 回空、`save` 回 error）。
   * 生產：`cli.ts --saves <目錄>` 給一個 `FileSaveStore`。
   */
  saves?: SaveStore | null;
}

interface SeatSlot {
  info: SeatInfo;
  conn: Conn | null;
  /** 断线时刻（毫秒）；在线为 null */
  disconnectedAt: number | null;
  /** 掉线超时后由电脑代打；重连归还 */
  takenOver: boolean;
  /**
   * ★ W-73：这条座位的**身份令牌**（电脑座位是 `null`）。
   *
   * 认回原座位的判据从「名字相同」改成「`clientId` 相同」—— 两个朋友起同一个
   * 名字不会再串座。它**不进** `SeatInfo`（不广播给别人）。
   */
  clientId: string | null;
  /** ★ W-74：**连续**超时了几个回合（正常走完一回合或 `resume` 都清零） */
  strikes: number;
  /**
   * ★ W-74：这一回合是被**超时**託管的 —— 回合结束后要按 `strikes` 决定还不还。
   *
   * 掉线代打不走这一位（那条由 `takenOver` + 重连管）。
   */
  pendingRestore: boolean;
  /**
   * ★ W-74：他最近一次报的 `awaiting` 是哪个 `seq`（`NaN` = 没报过）。
   *
   * ⚠️ 为什么"报过"要存下来：**客户端可能比服务器先准备好**。
   *   重连那一刻，客户端手上有完整局面、立刻就能报 `awaiting`；
   *   而服务器要等下一次扫描（5 秒一次）才把表装上 —— 那一条 `awaiting`
   *   当时没有表可对，照旧版实现就被丢掉了，于是只能等 45 秒兜底，
   *   总时长变成 45+60=105 秒（实测就是这么卡在 90 秒窗口外的）。
   *   存下它，装表时若发现"他早就报过了"就**立刻起数**。
   */
  lastAwaitingSeq: number;
  /**
   * ★ 聯機存檔（v6）：存檔房裡**沒人坐**的真人座位（開局前可「這是我」；開局後電腦代打、可認領）。
   * 一般房間永遠是 `false`。
   */
  vacant: boolean;
  /** ★ 聯機存檔（v6）：存檔裡這一座原來是誰（「釋放」時還原成它）；一般房間是 `null` */
  saved: { clientId: string | null; name: string } | null;
}

/**
 * ★ W-74：一个房间的**回合计时器**。
 *
 * 两个相位：
 * · `startedAt === null` —— 广播出去了、还在等轮到的那个客户端报 `awaiting`；
 *   `deadline` 是**兜底**的起点（到点就自己开始数，不等它）。
 * · `startedAt !== null` —— 已经在数了；`deadline` 是本回合截止，`hardAt` 是硬上限。
 */
interface TableClock {
  seat: number;
  /** 装上表的时刻 */
  armedAt: number;
  /** 开始数的时刻；null = 还在等 `awaiting` */
  startedAt: number | null;
  /** 硬上限时刻；null = 还没开始数 */
  hardAt: number | null;
  /** 当前截止时刻（兜底相位时是「兜底起点」） */
  deadline: number;
}

interface Table {
  id: string;
  seats: SeatSlot[];
  room: Room | null;
  /**
   * ★ Q-NET-2 房间地图（大厅设置）。开局前只有房主能改；开局的 `newGame`
   *   用的就是它 —— **不看**任何客户端上报的本地设置。
   */
  globalMapId: number;
  /**
   * ★★ 第十一份試玩回報 #1（需求方 2026-09-23）：房间的**开局选项** ——
   *   总人数 + 起始资金/载具/地产期限/时间/胜利条件。
   *
   * 与 `globalMapId` 同一套契约：开局前只有房主能改，开局的 `newGame` **只看这一份**，
   * 不看任何客户端上报的本地设置。`seatCount` 是**总人数**（不足补电脑）。
   */
  options: LobbyOptions;
  /**
   * ★ W-73 §4：从哪一刻起**全桌无人在线**；只要有人在就为 `null`。
   *
   * 由 `sweepDisconnected` 维护（一看就改，没有别的地方写它）——
   * 挂在事件上容易漏（有人掉线的方式不止一种），放在扫描里最稳。
   */
  emptySince: number | null;
  /** ★ W-74：回合计时器；没在等任何人时为 `null` */
  clock: TableClock | null;
  /** ★ 房間列表（v5）：建房時刻（服務器時鐘），列表顯示「幾分鐘前」用 */
  createdAt: number;
  /**
   * ★ 聯機存檔（v6）：這間房從哪份存檔繼續；一般房間是 `null`。
   * 有它 ⇒ 地圖 / 角色 / 開局設定鎖定，開局用 `state` 當起點。
   */
  fromSave: { id: string; name: string; state: GameState; snapshot: string } | null;
  /**
   * ★ 聯機存檔（v6）：房主的 `clientId`。一般房間 = 0 號座（第一個進來的）；
   * 存檔房 = **建房的人**（他可能坐在任何一座，也可能還沒入座）。
   */
  hostClientId: string | null;
  /** ★ 聯機存檔（v6）：在房裡、**還沒入座**的連接（存檔房開局前，等著點「這是我」）*/
  guests: Set<Conn>;
  /** ★ 聯機存檔（v6）：這間房的自動存檔寫到哪一份（每過一天覆蓋）*/
  autoSaveId: string;
  /** ★ 聯機存檔（v6）：上一次看到的局面日期（`年-月-日`）—— 變了就自動存一次 */
  lastSavedDay: string | null;
  /**
   * ★ 房主交接（v6）：開局前房主從哪一刻起**不在**（斷線 / 還沒回來）。
   * 滿 `takeoverAfterMs` 還沒回來 ⇒ 房主交給下一位在線的真人；一個都沒有 ⇒ 關房。
   * （主動按「離開」的不等，當場交接。）
   */
  hostAwaySince: number | null;
}

/** 一條連接在 hub 裡的身分（v6 起登記在 `#members`，別的連接的操作也可能改它的座位）*/
interface Member {
  table: Table | null;
  seat: number | null;
  clientId: string | null;
  name: string;
}

/** ★ 房間列表（v5）：一條訂閱了列表的連接 */
interface ListWatcher {
  clientId: string;
  /** 上一次推給它的內容（去掉 `ageMs` 後的 JSON）—— 沒變就不推 */
  last: string;
}

/** 一个客户端连接在集线器里的句柄 */
export interface ClientHandle {
  /** 收到客户端一条消息（已解析为对象；解析失败的直接丢弃即可） */
  onMessage(msg: ClientMessage): void;
  /** 连接断开 */
  onClose(now: number): void;
  /** 加入后才有：房间号与座位号 */
  readonly roomId: string | null;
  readonly seat: number | null;
}

export class RoomHub {
  readonly #opts: Required<
    Pick<
      HubOptions,
      | 'seatCount'
      | 'takeoverAfterMs'
      | 'checksumEvery'
      | 'maxRooms'
      | 'roomIdleMs'
      | 'turnMs'
      | 'awaitingFallbackMs'
      | 'aliveExtendMs'
      | 'hardCapMs'
    >
  > &
    HubOptions;
  readonly #tables = new Map<string, Table>();
  readonly #nowFn: () => number;
  /** ★ 房間列表（v5）：訂閱了列表、還沒進房的連接 */
  readonly #watchers = new Map<Conn, ListWatcher>();
  /** ★ 聯機存檔（v6）：每條連接的「我在哪桌哪座」 */
  readonly #members = new Map<Conn, Member>();
  readonly #saves: SaveStore | null;
  readonly #today: (() => Date) | null;
  /** ★ v8：每条连接最近几条 `present` 的时刻（限速用，见 `#relayPresent`）*/
  readonly #presentLog = new WeakMap<Conn, number[]>();

  constructor(opts: HubOptions) {
    this.#opts = {
      seatCount: 4,
      takeoverAfterMs: 30_000,
      checksumEvery: 10,
      maxRooms: 50,
      roomIdleMs: 600_000,
      turnMs: 60_000,
      awaitingFallbackMs: 45_000,
      aliveExtendMs: 30_000,
      hardCapMs: 180_000,
      ...opts,
    };
    this.#nowFn = opts.now ?? (() => Date.now());
    this.#saves = opts.saves ?? null;
    this.#today = opts.today === undefined ? () => new Date() : opts.today;
  }

  /** 服务器时钟（W-74）—— 计时一律走它，测试注入同一个口 */
  #now(): number {
    return this.#nowFn();
  }

  /** 供测试/监控：房间信息 */
  roomInfo(roomId: string): RoomInfo | null {
    const t = this.#tables.get(roomId);
    return t === null || t === undefined ? null : this.#info(t);
  }

  /** 供测试/监控：房间的 core 镜像 */
  room(roomId: string): Room | null {
    return this.#tables.get(roomId)?.room ?? null;
  }

  /**
   * 供测试/监控：这个房间此刻**在等谁**、还剩多久（W-74）。
   *
   * 没有在等任何人（电脑的回合、掉线、`--turn-ms 0`）时返回 `null`。
   * `counting === false` 表示还在等客户端报 `awaiting`（`remainingMs` 是兜底倒计时）。
   */
  clockOf(roomId: string): {
    seat: number;
    remainingMs: number;
    hardRemainingMs: number;
    counting: boolean;
  } | null {
    const clock = this.#tables.get(roomId)?.clock ?? null;
    if (clock === null) return null;
    const now = this.#now();
    return {
      seat: clock.seat,
      remainingMs: clock.startedAt === null ? -1 : Math.max(0, clock.deadline - now),
      hardRemainingMs: clock.hardAt === null ? -1 : Math.max(0, clock.hardAt - now),
      counting: clock.startedAt !== null,
    };
  }

  /** 接一条新连接；之后把它收到的每条消息交给返回的句柄 */
  connect(conn: Conn): ClientHandle {
    // ★ 存檔房（v6）：座位會被**別人的操作**改（房主「釋放」某個座位）⇒ 這條連接的「我在哪桌哪座」
    //   不能只活在閉包裡，得登記在 `#members`，別的連接才改得到。
    const me: Member = { table: null, seat: null, clientId: null, name: '' };
    this.#members.set(conn, me);

    const handle: ClientHandle = {
      get roomId() {
        return me.table?.id ?? null;
      },
      get seat() {
        return me.seat;
      },
      onMessage: (msg: ClientMessage): void => {
        try {
          onMessage(msg);
        } finally {
          // ★ 房間列表（v5）：任何一條消息都可能改變列表（進房、開局、改人數、終局……）——
          //   統一在出口推一次（內容沒變就不發），比在十幾個分支上各掛一句可靠。
          //   ★ 聯機存檔（v6）：「過了一天就自動存」也掛在同一個出口
          this.#afterEvents();
        }
      },
      onClose: (now: number): void => {
        try {
          onClose(now);
        } finally {
          this.#watchers.delete(conn);
          this.#members.delete(conn);
          this.#afterEvents();
        }
      },
    };

    const onMessage = (msg: ClientMessage): void => {
      switch (msg.t) {
        case 'listRooms': {
          if (msg.version !== PROTOCOL_VERSION) {
            this.#sendTo(conn, { t: 'error', message: `协议版本不符：服务器 ${PROTOCOL_VERSION}，客户端 ${msg.version}` });
            return;
          }
          if (me.table !== null) return; // 已經進房了：列表對它沒意義
          if (!isClientId(msg.clientId)) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：clientId 必須是 32 位小寫十六進位' });
            conn.close?.();
            return;
          }
          this.#watchers.set(conn, { clientId: msg.clientId, last: '' });
          return; // 出口的 `#publishRooms` 會把第一份發出去
        }
        case 'listSaves': {
          if (msg.version !== PROTOCOL_VERSION) {
            this.#sendTo(conn, { t: 'error', message: `协议版本不符：服务器 ${PROTOCOL_VERSION}，客户端 ${msg.version}` });
            return;
          }
          if (!isClientId(msg.clientId)) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：clientId 必須是 32 位小寫十六進位' });
            conn.close?.();
            return;
          }
          this.#sendTo(conn, { t: 'saves', saves: this.listSaves(msg.clientId) });
          return;
        }
        // ★ 房主交接（v6）：大廳裡按「離開」—— 開局前當場讓出座位（房主則當場交接）
        case 'leave': {
          const t = me.table;
          if (t === null) return;
          if (t.guests.delete(conn)) {
            me.table = null;
            this.#broadcast(t, { t: 'room', room: this.#info(t) });
            return;
          }
          if (me.seat === null) return;
          const slot = t.seats[me.seat];
          if (slot === undefined || slot.conn !== conn) return;
          if (t.room !== null) return; // 開局後「離開」= 斷線，照舊走掉線代打
          me.table = null;
          me.seat = null;
          slot.conn = null;
          this.#leaveUnstarted(t, slot);
          // 存檔房：`#vacate` 會把人放進「還沒入座」—— 主動離開的不留
          t.guests.delete(conn);
          return;
        }
        // ★ 聯機存檔（v6）：刪一份存檔 —— 只有**存檔裡坐過**的人（按 clientId）
        case 'deleteSave': {
          if (msg.version !== PROTOCOL_VERSION) {
            this.#sendTo(conn, { t: 'error', message: `协议版本不符：服务器 ${PROTOCOL_VERSION}，客户端 ${msg.version}` });
            return;
          }
          if (!isClientId(msg.clientId)) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：clientId 必須是 32 位小寫十六進位' });
            conn.close?.();
            return;
          }
          const sv = isSaveId(msg.id) ? (this.#saves?.get(msg.id) ?? null) : null;
          if (sv === null) {
            this.#sendTo(conn, { t: 'error', message: '這份存檔不在了' });
          } else if (!sv.seats.some((st) => st.kind === 'human' && st.clientId === msg.clientId)) {
            this.#sendTo(conn, { t: 'error', message: '只有這份存檔裡的玩家能刪除它' });
          } else {
            this.#saves?.delete(sv.id);
          }
          this.#sendTo(conn, { t: 'saves', saves: this.listSaves(msg.clientId) });
          return;
        }
        // ★ 聯機存檔（v6）：存檔房開局前「這是我」
        case 'claim': {
          const t = me.table;
          if (t === null || me.clientId === null) return;
          if (t.fromSave === null || t.room !== null) {
            this.#sendTo(conn, { t: 'error', message: '只有還沒開局的存檔房能認領座位' });
            return;
          }
          if (me.seat !== null) {
            this.#sendTo(conn, { t: 'error', message: '你已經坐下了（要換位子先「離座」）' });
            return;
          }
          const slot = typeof msg.seat === 'number' ? t.seats[msg.seat] : undefined;
          if (slot === undefined || slot.info.kind !== 'human' || !slot.vacant || slot.conn !== null) {
            this.#sendTo(conn, { t: 'error', message: '這個座位不能認領（有人了，或是電腦）' });
            return;
          }
          slot.conn = conn;
          slot.clientId = me.clientId;
          slot.disconnectedAt = null;
          slot.vacant = false;
          slot.info.name = me.name;
          slot.info.connected = true;
          delete slot.info.vacant;
          t.guests.delete(conn);
          me.seat = slot.info.seat;
          this.#sendTo(conn, { t: 'joined', version: PROTOCOL_VERSION, seat: slot.info.seat, room: this.#info(t) });
          this.#broadcast(t, { t: 'room', room: this.#info(t) });
          return;
        }
        // ★ 聯機存檔（v6）：存檔房開局前把一個座位放回「沒人坐」（房主：任何人的；其他人：自己的）
        case 'unclaim': {
          const t = me.table;
          if (t === null || t.fromSave === null || t.room !== null) return;
          const slot = typeof msg.seat === 'number' ? t.seats[msg.seat] : undefined;
          if (slot === undefined || slot.info.kind !== 'human' || slot.vacant) return;
          const own = me.seat === slot.info.seat;
          if (!own && !this.#isHost(t, me)) {
            this.#sendTo(conn, { t: 'error', message: '只有房主能讓別人離座' });
            return;
          }
          this.#vacate(t, slot);
          this.#broadcast(t, { t: 'room', room: this.#info(t) });
          return;
        }
        // ★ 聯機存檔（v6）：房主手動存檔
        case 'save': {
          const t = me.table;
          if (t === null || me.seat === null || t.room === null) {
            this.#sendTo(conn, { t: 'error', message: '還沒開局，沒有東西可存' });
            return;
          }
          if (!this.#isHost(t, me)) {
            this.#sendTo(conn, { t: 'error', message: '只有房主能存檔' });
            return;
          }
          if (this.#saves === null) {
            this.#sendTo(conn, { t: 'error', message: '這台伺服器沒有開存檔（--saves）' });
            return;
          }
          const name = sanitizeSaveName(msg.name);
          if (name === null) {
            this.#sendTo(conn, { t: 'error', message: '存檔名要 1~24 個字' });
            return;
          }
          const now = this.#now();
          const id = `m-${now.toString(36)}-${t.id}`;
          const wrote = this.#writeSave(t, id, 'manual', name, now);
          if (wrote === 'full') {
            this.#sendTo(conn, { t: 'error', message: '存檔已滿，請先刪除舊存檔' });
            return;
          }
          if (wrote !== 'ok') {
            this.#sendTo(conn, { t: 'error', message: '存檔寫入失敗（伺服器那邊的磁碟 / 權限）' });
            return;
          }
          this.#broadcast(t, { t: 'saved', name });
          return;
        }
        case 'join': {
          if (msg.version !== PROTOCOL_VERSION) {
            this.#sendTo(conn, { t: 'error', message: `协议版本不符：服务器 ${PROTOCOL_VERSION}，客户端 ${msg.version}` });
            return;
          }
          if (me.table !== null) {
            this.#sendTo(conn, { t: 'error', message: '已经在房间里了' });
            return;
          }
          // ★ W-73 §3：三样都**服务器校验**，不信客户端；任何一样不合就
          //   `error` + **断开**（不是只回一句错误让它接着试）。
          if (!isClientId(msg.clientId)) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：clientId 必須是 32 位小寫十六進位' });
            conn.close?.();
            return;
          }
          const name = sanitizeName(msg.name);
          if (name === null) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：名字必須是 1–12 個字元（不含控制字元）' });
            conn.close?.();
            return;
          }
          if (!isRoomCode(msg.room)) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：房間碼必須是 6 位（字母去 I/O、數字去 0/1）' });
            conn.close?.();
            return;
          }
          if (msg.mode !== undefined && !isJoinMode(msg.mode)) {
            this.#sendTo(conn, { t: 'error', message: '拒絕：mode 只能是 create / join' });
            conn.close?.();
            return;
          }
          if (msg.fromSave !== undefined && msg.mode !== 'create') {
            this.#sendTo(conn, { t: 'error', message: '拒絕：fromSave 只能與 mode: create 一起用' });
            return;
          }
          // ★ 房間列表（v5）：建房要「還沒有」、從列表加入要「還在」—— 見 protocol.ts 的 `mode`
          const exists = this.#tables.has(msg.room);
          if (msg.mode === 'create' && exists) {
            this.#sendTo(conn, { t: 'error', message: '房間碼撞上了別人的房間，請再建一次' });
            return;
          }
          if (msg.mode === 'join' && !exists) {
            this.#sendTo(conn, { t: 'error', message: '這個房間已經不在了（可能剛解散）' });
            return;
          }
          // ★ 聯機存檔（v6）：從存檔建房
          let save: StoredSave | null = null;
          if (msg.fromSave !== undefined) {
            save = isSaveId(msg.fromSave) ? (this.#saves?.get(msg.fromSave) ?? null) : null;
            if (save === null) {
              this.#sendTo(conn, { t: 'error', message: '這份存檔不在了' });
              return;
            }
          }
          let base: { state: GameState; snapshot: string } | null = null;
          if (save !== null) {
            try {
              base = { state: deserializeGame(save.snapshot), snapshot: save.snapshot };
            } catch (err) {
              this.#sendTo(conn, { t: 'error', message: `存檔讀不出來：${err instanceof Error ? err.message : String(err)}` });
              return;
            }
          }
          const t = this.#tableFor(msg.room, msg.clientId, save, base);
          if (t === null) {
            this.#sendTo(conn, { t: 'error', message: '伺服器房間已滿' });
            return;
          }
          me.clientId = msg.clientId;
          me.name = name;
          const s = this.#assignSeat(t, name, msg.clientId, conn, msg.claimSeat);
          if (s === null) {
            this.#sendTo(conn, { t: 'error', message: '房间已满' });
            return;
          }
          t.emptySince = null;
          me.table = t;
          me.seat = s === 'guest' ? null : s;
          if (s === 'guest') t.guests.add(conn);
          // 進房了就不再看列表
          this.#watchers.delete(conn);
          this.#sendTo(conn, { t: 'joined', version: PROTOCOL_VERSION, seat: s === 'guest' ? -1 : s, room: this.#info(t) });
          this.#broadcast(t, { t: 'room', room: this.#info(t) });
          // 重连：补发开局参数与漏掉的 action
          if (t.room !== null) {
            this.#sendTo(conn, {
              t: 'start',
              seed: t.room.seed,
              globalMapId: t.room.globalMapId,
              seats: t.seats.map((x) => x.info),
              options: t.options,
              ...(t.room.startDate === null ? {} : { startDate: t.room.startDate }),
              ...(t.room.snapshot === null ? {} : { snapshot: t.room.snapshot }),
              // ★ 第十二份試玩回報：补发到第几号为止是「进房之前的事」—— 客户端静默追上，不重演
              through: t.room.sequenceLength - 1,
            });
            const from = msg.since === undefined ? 0 : msg.since + 1;
            for (const b of t.room.since(from)) this.#sendTo(conn, { t: 'action', seq: b.seq, action: b.action });
            // ★ 首席复核：这一桌可能正「停手等人」（见 `#anyonePresent`）—— 人回来了，接着走
            this.#driveComputers(t);
            this.#advance(t, this.#now());
          }
          return;
        }
        case 'start': {
          if (me.table === null || me.seat === null) return;
          if (!this.#isHost(me.table, me)) {
            this.#sendTo(conn, { t: 'error', message: '只有房主能開局' });
            return;
          }
          if (me.table.room !== null) return;
          this.#start(me.table);
          return;
        }
        case 'intent': {
          if (me.table === null || me.seat === null || me.table.room === null) {
            this.#sendTo(conn, { t: 'error', message: '还没开局' });
            return;
          }
          if (typeof msg.action !== 'object' || msg.action === null || typeof msg.action.type !== 'string') {
            this.#sendTo(conn, { t: 'error', message: '拒绝：action 格式不对' });
            return;
          }
          this.#submit(me.table, me.seat, msg.action, conn);
          return;
        }
        case 'checksum': {
          if (me.table === null || me.seat === null || me.table.room === null) return;
          const expected = me.table.room.fingerprintAt(msg.seq);
          if (expected !== null && expected !== msg.hash) {
            this.#broadcast(me.table, { t: 'desync', seq: msg.seq, expected, got: msg.hash, seat: me.seat });
          }
          return;
        }
        // ★ Q-NET-1 失步自愈：把**完整** action 日志重放给请求者。
        //   权限只认 `join` 时绑在这条连接上的座位（下面的所有权检查），
        //   消息体里没有任何座位/名字可填 —— 所以索取不到别人的重放。
        //   也谈不上额外泄密：这条连接本来就收得到每一条广播 action。
        case 'resync': {
          if (me.table === null || me.seat === null || me.table.room === null) {
            this.#sendTo(conn, { t: 'error', message: '還沒開局' });
            return;
          }
          if (me.table.seats[me.seat]?.conn !== conn) {
            // 掉线后沿用旧句柄、或别的连接想蹭同一个座位，都在这里挡住
            this.#sendTo(conn, { t: 'error', message: '拒絕：這條連接不是該座位' });
            return;
          }
          const log = me.table.room.since(0);
          // ⚠️ 只回请求者，不广播（重放是给一个人的）
          this.#sendTo(conn, {
            t: 'replay',
            seed: me.table.room.seed,
            globalMapId: me.table.room.globalMapId,
            seats: me.table.seats.map((s) => ({ ...s.info })),
            // ★ 第十一份試玩回報 #1：重放也要带开局选项 —— `onResync` 用它 `newGame`，
            //   少了它重建出来的局面与服务器镜像就不是同一局。
            options: me.table.options,
            ...(me.table.room.startDate === null ? {} : { startDate: me.table.room.startDate }),
            ...(me.table.room.snapshot === null ? {} : { snapshot: me.table.room.snapshot }),
            through: log.length === 0 ? -1 : log[log.length - 1]!.seq,
            actions: log.map((b) => ({ seq: b.seq, action: b.action })),
          });
          return;
        }
        // ★ Q-NET-2 大厅设置：改**自己**座位的角色。
        //   座位号取自 `join` 时绑在这条连接上的 `seat`，消息体里没有座位号 ——
        //   所以「改别人的角色」不是被拒绝，而是根本表达不出来。
        case 'setCharacter': {
          if (me.table === null || me.seat === null) {
            this.#sendTo(conn, { t: 'error', message: '還沒進房' });
            return;
          }
          this.#setCharacter(me.table, me.seat, msg.character, conn);
          return;
        }
        // ★ Q-NET-2 大厅设置：换房间地图。只有房主（0 号座）。
        case 'setMap': {
          if (me.table === null || me.seat === null) {
            this.#sendTo(conn, { t: 'error', message: '還沒進房' });
            return;
          }
          this.#setMap(me.table, this.#isHost(me.table, me) ? 0 : -1, msg.globalMapId, conn);
          return;
        }
        // ★★ 第十一份試玩回報 #1：大厅开局选项（总人数 + 单机那五项）。同一套权限。
        case 'setOptions': {
          if (me.table === null || me.seat === null) {
            this.#sendTo(conn, { t: 'error', message: '還沒進房' });
            return;
          }
          this.#setOptions(me.table, this.#isHost(me.table, me) ? 0 : -1, msg.options, conn);
          return;
        }
        // ★ W-74：本机座位**演完了、停在等输入上** —— 从这一刻起才开始数 60 秒。
        case 'awaiting': {
          if (me.table === null || me.seat === null || me.table.room === null) return;
          const slot = me.table.seats[me.seat];
          if (slot === undefined || slot.conn !== conn) return;
          // `seq` 必须是**最新**的那条广播：演出期间又来了一条 action 的话，
          // 「画面停在等输入」这个判断已经不成立
          if (msg.seq !== me.table.room.sequenceLength - 1) return;
          // ★ 先**记下来**（哪怕此刻表还没装上 —— 见 `lastAwaitingSeq` 的注释）
          slot.lastAwaitingSeq = msg.seq;
          const clock = me.table.clock;
          if (clock === null || clock.seat !== me.seat || clock.startedAt !== null) return;
          this.#startCounting(me.table, this.#now());
          return;
        }
        // ★ W-74：「我还在这儿，只是还在操作」—— 把截止时刻往后延（有硬上限）
        case 'alive': {
          if (me.table === null || me.seat === null) return;
          if (me.table.seats[me.seat]?.conn !== conn) return;
          const clock = me.table.clock;
          if (clock === null || clock.seat !== me.seat || clock.startedAt === null) return;
          const at = this.#now();
          const capped = clock.hardAt ?? clock.deadline;
          clock.deadline = Math.min(Math.max(clock.deadline, at + this.#opts.aliveExtendMs), capped);
          this.#broadcast(me.table, this.#clockMessage(clock, at));
          return;
        }
        // ★ W-74：被超时託管的玩家点一下画面 —— 把座位收回来
        case 'resume': {
          if (me.table === null || me.seat === null || me.table.room === null) return;
          const slot = me.table.seats[me.seat];
          if (slot === undefined || slot.conn !== conn) return;
          // 掉线代打不归这条管（那条是重连时归还）
          if (slot.info.autopilot !== 'idle') return;
          slot.strikes = 0;
          slot.pendingRestore = false;
          delete slot.info.autopilot;
          const r = me.table.room.submitSystem({ type: 'setAi', player: me.seat, whoPlays: WHO_PLAYS_HUMAN });
          if (r.ok) this.#broadcast(me.table, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
          this.#broadcast(me.table, { t: 'room', room: this.#info(me.table) });
          this.#driveComputers(me.table);
          this.#advance(me.table, this.#now());
          return;
        }
        // ★ v8（gap-audit #7）：纯演出提示 —— 校验、限速之后转给同桌其余各端（不进日志）
        case 'present': {
          if (me.table === null || me.seat === null) return;
          this.#relayPresent(me.table, me.seat, conn, msg.cue);
          return;
        }
        default:
          return;
      }
    };
    const onClose = (now: number): void => {
      if (me.table !== null && me.table.guests.delete(conn)) {
        this.#broadcast(me.table, { t: 'room', room: this.#info(me.table) });
      }
      if (me.table === null || me.seat === null) return;
      const slot = me.table.seats[me.seat];
      if (slot === undefined || slot.conn !== conn) return;
      slot.conn = null;
      slot.disconnectedAt = now;
      slot.info.connected = false;
      // ★ 聯機存檔（v6）：存檔房開局前走掉 ⇒ 這一座又可以被「這是我」了（他回來照樣憑 clientId 認回）
      if (me.table.fromSave !== null && me.table.room === null) {
        slot.vacant = true;
        slot.info.vacant = true;
      }
      // ★ W-74：他掉线了，这一回合不必再等他（`#advance` 会按新局面重装表）
      this.#clearClock(me.table);
      this.#broadcast(me.table, { t: 'room', room: this.#info(me.table) });
      this.#advance(me.table, now);
    };
    return handle;
  }

  // ------------------------------------------------------------
  //  房間列表（v5）
  // ------------------------------------------------------------

  /**
   * 供測試 / 監控：以 `clientId` 這個人的眼光看到的房間列表（與推給他的那份同一個函數）。
   *
   * 列哪些房間 —— **能對看列表的人有用**的才列：
   * · **終局的不列**（`phase === 'gameOver'`）：進去也只能看結算；
   * · **一個真人都沒入座的不列**（`join` 失敗留下的空殼）；
   * · **沒有一個真人在線的不列** —— 等著被回收的死房間；
   * · **還沒開局、房主（0 號座）不在線的不列** —— 只有房主能按開始，進去只會乾等；
   * 例外：你自己在這桌有**斷線中**的座位（`rejoin`）⇒ 上面後兩條不擋（終局照樣不列），
   *   好讓刷新 / 掉線的人從列表點「重新連線」回去。
   */
  listRooms(clientId: string | null, now: number = this.#now()): RoomSummary[] {
    const out: RoomSummary[] = [];
    for (const t of this.#tables.values()) {
      const s = this.#summary(t, clientId, now);
      if (s !== null) out.push(s);
    }
    return out;
  }

  #summary(t: Table, clientId: string | null, now: number): RoomSummary | null {
    if (t.room !== null && t.room.state.phase === 'gameOver') return null;
    const humans = t.seats.filter((s) => s.info.kind === 'human');
    if (humans.length === 0) return null;
    // ★ v6：存檔房裡「空座」上的 clientId 是存檔裡那個人的 —— 他看到的就是「重新連線」
    const rejoin = clientId !== null && humans.some((s) => s.clientId === clientId && s.conn === null);
    if (!rejoin) {
      if (!humans.some((s) => s.conn !== null) && t.guests.size === 0) return null;
      if (t.room === null && !this.#hostPresent(t)) return null;
    }
    const hostName =
      this.#hostName(t) ?? t.seats.find((s) => s.clientId === t.hostClientId)?.info.name ?? t.fromSave?.name ?? t.seats[0]?.info.name ?? '';
    const vacant =
      t.fromSave !== null && t.room !== null
        ? humans
            .filter((s) => s.vacant && s.conn === null && isInGame(t.room!.state.players[s.info.seat]!))
            .map((s) => ({ seat: s.info.seat, name: s.info.name, character: s.info.character }))
        : [];
    return {
      id: t.id,
      host: hostName,
      // 存檔房：人數 = 有人坐的真人座位 / 真人座位（電腦座位本來就不給人坐）
      humans: t.fromSave === null ? humans.length : humans.filter((s) => !s.vacant).length,
      // 開局後以實際座位數為準（= 開局那一刻的 `seatCount`）
      seatCount: t.fromSave !== null ? humans.length : t.room === null ? t.options.seatCount : t.seats.length,
      started: t.room !== null,
      globalMapId: t.globalMapId,
      ageMs: Math.max(0, now - t.createdAt),
      rejoin,
      ...(t.fromSave === null ? {} : { fromSave: true }),
      ...(vacant.length === 0 ? {} : { vacant }),
    };
  }

  /** 房主此刻在不在（坐著或還沒入座都算）*/
  #hostPresent(t: Table): boolean {
    for (const s of t.seats) if (s.conn !== null && s.clientId === t.hostClientId) return true;
    for (const g of t.guests) if (this.#members.get(g)?.clientId === t.hostClientId) return true;
    return false;
  }

  /** 存檔房房主的暱稱（坐著的座位名，或還沒入座時 join 報上來的名字）*/
  #hostName(t: Table): string | null {
    for (const s of t.seats) if (s.conn !== null && s.clientId === t.hostClientId) return s.info.name;
    for (const g of t.guests) {
      const m = this.#members.get(g);
      if (m?.clientId === t.hostClientId) return m.name;
    }
    return null;
  }

  /**
   * 把列表推給每一個訂閱者 —— **內容沒變就不推**（比較時去掉 `ageMs`，它每一刻都在變）。
   *
   * 在每條消息、每次斷線、每一拍掃描的出口各叫一次；沒有訂閱者時什麼都不算。
   */
  #publishRooms(): void {
    if (this.#watchers.size === 0) return;
    const now = this.#now();
    for (const [conn, w] of this.#watchers) {
      const rooms = this.listRooms(w.clientId, now);
      const key = JSON.stringify(rooms.map((r) => ({ ...r, ageMs: 0 })));
      if (key === w.last) continue;
      w.last = key;
      this.#sendTo(conn, { t: 'rooms', rooms });
    }
  }

  /**
   * 掉线超时的真人座位交给电脑代打（T-073）；顺带回收**空置太久**的房间（W-73 §4）。
   * 由适配器定时调用；返回本次接管的座位。
   *
   * 接管后若正轮到该座位，立刻让电脑把这一回合走完。
   */
  sweepDisconnected(now: number = this.#now()): { roomId: string; seat: number }[] {
    const out: { roomId: string; seat: number }[] = [];
    // ★ 先快照再遍历：下面会 `delete`，边删边遍历容易漏掉相邻的那一间
    for (const t of [...this.#tables.values()]) {
      // ── 房间回收（W-73 §4）：全桌无人在线满 `roomIdleMs` 就删 ──
      // ★ 判据放在**扫描里**而不是「有人掉线那一刻」：掉线的方式不止一种
      //   （连接关闭、从没坐满、join 失败留下空壳），一个个挂钩子必漏。
      if (t.seats.some((s) => s.info.kind === 'human' && s.conn !== null) || t.guests.size > 0) {
        t.emptySince = null;
      } else {
        t.emptySince ??= now;
        if (now - t.emptySince >= this.#opts.roomIdleMs) {
          this.#tables.delete(t.id);
          continue;
        }
      }
      if (t.room === null) {
        this.#sweepLobby(t, now);
        continue;
      }
      for (const slot of t.seats) {
        if (slot.info.kind !== 'human' || slot.conn !== null || slot.takenOver) continue;
        if (slot.disconnectedAt !== null && now - slot.disconnectedAt >= this.#opts.takeoverAfterMs) {
          // 託管：镜像里把他改成「真人 + 託管」，之后轮到他就由 core 的 AI 代打
          const r = t.room.submitSystem({ type: 'setAi', player: slot.info.seat, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
          if (!r.ok) continue;
          this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
          slot.takenOver = true;
          // ★ W-74：`autopilot` 随 `room` 广播给所有人看（掉线代打是 'offline'）
          slot.info.autopilot = 'offline';
          out.push({ roomId: t.id, seat: slot.info.seat });
        }
      }
      if (out.some((x) => x.roomId === t.id)) {
        this.#broadcast(t, { t: 'room', room: this.#info(t) });
        this.#driveComputers(t);
      }
      // ★ W-74：超时託管的结算 + 回合计时的推进。两件都放**扫描**里，
      //   与「掉线代打」「房间回收」共用一个定时器（不另起计时器）。
      this.#advance(t, now);
      this.#sweepClock(t, now);
    }
    // ★ 房間列表（v5）：回收、掉線代打、超時都可能改變列表；v6：超時代打也可能過了一天
    this.#afterEvents();
    return out;
  }

  /**
   * ★ 房主交接（v6）：開局前的大廳 —— 斷線超過 `takeoverAfterMs` 的座位讓出來（一般房間），
   * 房主不在超過同樣久 ⇒ 交接 / 關房。給刷新頁面、網路抖一下的人留足時間。
   */
  #sweepLobby(t: Table, now: number): void {
    if (!this.#tables.has(t.id)) return;
    if (t.fromSave === null) {
      for (const slot of [...t.seats]) {
        if (slot.info.kind !== 'human' || slot.conn !== null || slot.disconnectedAt === null) continue;
        if (now - slot.disconnectedAt < this.#opts.takeoverAfterMs) continue;
        this.#leaveUnstarted(t, slot, false);
        if (!this.#tables.has(t.id)) return;
      }
    }
    if (this.#hostPresent(t)) {
      t.hostAwaySince = null;
      return;
    }
    t.hostAwaySince ??= now;
    if (now - t.hostAwaySince >= this.#opts.takeoverAfterMs) this.#handOver(t, false);
  }

  // ------------------------------------------------------------
  //  回合计时（W-74）
  // ------------------------------------------------------------

  /**
   * 广播之后的**唯一**收尾动作：先看「超时託管该还了没」，再按新局面重新装表。
   *
   * 放在一处而不是每个广播点各叫一次：漏一个出口就是「那一格永远不还」。
   */
  #advance(t: Table, now: number): void {
    this.#settleTimeoutAutopilot(t);
    this.#armClock(t, now);
  }

  /** 这个座位此刻该不该被计时：真人、在线、且**没被电脑管着** */
  #shouldTime(t: Table, seat: number): boolean {
    const slot = t.seats[seat];
    if (slot === undefined) return false;
    if (slot.info.kind !== 'human' || slot.conn === null) return false;
    // 掉线代打与超时託管都是「电脑管着」—— 判据看镜像里的 `whoPlays`，
    // 不另记一个可能与它对不上的标志位
    const whoPlays = t.room?.state.players[seat]?.whoPlays ?? 0;
    return (whoPlays & WHO_PLAYS_AUTOPILOT) === 0;
  }

  /**
   * 按当前局面装表：等的是 `room.actingSeat`（**不另写一套判据** ——
   * 竞价时它是举牌者，平时是回合主人，见 issue #9 / E-2）。
   */
  #armClock(t: Table, now: number): void {
    const room = t.room;
    if (room === null) {
      t.clock = null;
      return;
    }
    const seat = room.actingSeat;
    // ★ `turnMs === 0` = 关闭计时（`cli.ts --turn-ms 0`），单机与不想计时的局都走这条
    if (this.#opts.turnMs === 0 || !this.#shouldTime(t, seat)) {
      this.#clearClock(t);
      return;
    }
    // 已经在等同一个座位 ⇒ **不动它**（重装会把 `alive` 挣来的延长抹掉）
    if (t.clock !== null && t.clock.seat === seat) return;
    this.#clearClock(t);
    t.clock = { seat, armedAt: now, startedAt: null, hardAt: null, deadline: now + this.#opts.awaitingFallbackMs };
    // ★ 他**早就报过** `awaiting` 了（比服务器装表还早，例如刚重连回来）⇒ 立刻起数，
    //   别再等那 45 秒兜底
    if (t.seats[seat]?.lastAwaitingSeq === room.sequenceLength - 1) this.#startCounting(t, now);
  }

  #clearClock(t: Table): void {
    const clock = t.clock;
    if (clock === null) return;
    t.clock = null;
    // 「作废」也要让所有人看见（`remainingMs: -1`）
    this.#broadcast(t, { t: 'clock', seat: clock.seat, remainingMs: -1, hardRemainingMs: -1 });
  }

  /** 开始数 60 秒（由客户端的 `awaiting` 触发，或 45 秒兜底到点） */
  #startCounting(t: Table, now: number): void {
    const clock = t.clock;
    if (clock === null || clock.startedAt !== null) return;
    if (!this.#shouldTime(t, clock.seat)) {
      this.#clearClock(t);
      return;
    }
    clock.startedAt = now;
    clock.hardAt = now + this.#opts.hardCapMs;
    clock.deadline = now + this.#opts.turnMs;
    this.#broadcast(t, this.#clockMessage(clock, now));
  }

  /** 发**剩余毫秒**，不发时间戳（各机时钟不准） */
  #clockMessage(clock: TableClock, now: number): ServerMessage {
    return {
      t: 'clock',
      seat: clock.seat,
      remainingMs: clock.startedAt === null ? -1 : Math.max(0, clock.deadline - now),
      hardRemainingMs: clock.hardAt === null ? -1 : Math.max(0, clock.hardAt - now),
    };
  }

  /** 每秒（其实是每次扫描）看一眼：兜底到点了没有 / 该超时了没有 */
  #sweepClock(t: Table, now: number): void {
    const clock = t.clock;
    if (clock === null || t.room === null) return;
    if (clock.startedAt === null) {
      // 兜底：广播后 `awaitingFallbackMs` 还没等到 `awaiting` ⇒ 自己开始数
      if (now >= clock.deadline) this.#startCounting(t, now);
      return;
    }
    const deadline = Math.min(clock.deadline, clock.hardAt ?? clock.deadline);
    if (now < deadline) return;
    this.#fireTimeout(t, now);
  }

  /**
   * ★ 超时（任务书 W-74 §74-d）：`setAi` 成「真人 + 託管」→ 广播 → 电脑把**这一回合**走完。
   *
   * 之后按 `strikes` 决定还不还：**连续两次**才长期託管（由
   * `#settleTimeoutAutopilot` 在他回合结束时结算）。
   */
  #fireTimeout(t: Table, now: number): void {
    const room = t.room;
    const clock = t.clock;
    if (room === null || clock === null) return;
    const seat = clock.seat;
    const slot = t.seats[seat];
    if (slot === undefined) {
      this.#clearClock(t);
      return;
    }
    t.clock = null;
    this.#broadcast(t, { t: 'clock', seat, remainingMs: -1, hardRemainingMs: -1 });

    const r = room.submitSystem({ type: 'setAi', player: seat, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT });
    if (!r.ok) return;
    this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
    slot.strikes += 1;
    slot.info.autopilot = 'idle';
    slot.pendingRestore = true;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
    // 电脑替他把这一回合走完（掷骰、买不买地、竞价一律由 core 的 AI 决定）
    this.#driveComputers(t);
    this.#advance(t, now);
  }

  /**
   * ★ 回合结束的结算（任务书 W-74 §74-d 第 2 条）：
   * `strikes < 2` ⇒ 自动改回 `HUMAN`；`strikes ≥ 2` ⇒ 保持託管。
   *
   * 判据「他的回合结束了」= 镜像里的 `currentPlayer` 已经**离开**他
   * （竞价期间 `actingSeat` 会换成举牌者，但那仍是他的回合 —— 所以看 `currentSeat`）。
   */
  #settleTimeoutAutopilot(t: Table): void {
    const room = t.room;
    for (const slot of t.seats) {
      if (!slot.pendingRestore) continue;
      if (room === null) {
        slot.pendingRestore = false;
        continue;
      }
      if (room.currentSeat === slot.info.seat) continue;
      slot.pendingRestore = false;
      if (slot.strikes >= 2) continue; // 连续两次：保持託管，`autopilot` 留在 'idle'
      const r = room.submitSystem({ type: 'setAi', player: slot.info.seat, whoPlays: WHO_PLAYS_HUMAN });
      if (!r.ok) continue;
      this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
      delete slot.info.autopilot;
      this.#broadcast(t, { t: 'room', room: this.#info(t) });
    }
  }

  // ------------------------------------------------------------
  //  内部
  // ------------------------------------------------------------

  /** 取房间；不存在就建一个 —— **但房间数已到上限时返回 `null`**（W-73 §4） */
  #tableFor(
    id: string,
    creator: string,
    save: StoredSave | null = null,
    base: { state: GameState; snapshot: string } | null = null,
  ): Table | null {
    const hit = this.#tables.get(id);
    if (hit !== undefined) return hit;
    if (this.#tables.size >= this.#opts.maxRooms) return null;
    if (save !== null && base !== null) return this.#tableFromSave(id, creator, save, base);
    // `emptySince` 初值 `null`：下一次扫描会把「此刻还全桌无人」的那一间记上时间戳。
    // 这里不填 `now`：「此刻是否无人」只由扫描判定（建房这一刻 join 还没坐下，填了反而是错的）。
    const t: Table = {
      id,
      seats: [],
      room: null,
      globalMapId: this.#opts.globalMapId,
      emptySince: null,
      clock: null,
      createdAt: this.#now(),
      fromSave: null,
      // 一般房間的房主 = 0 號座；第一個 join 的就是他（`#assignSeat` 裡坐下時才算數）
      hostClientId: creator,
      guests: new Set(),
      autoSaveId: autoSaveId(id),
      lastSavedDay: null,
      hostAwaySince: null,
      options: {
        ...LOBBY_DEFAULT_OPTIONS,
        // ★ 第十一份試玩回報 #1：`--seats` 从「服务器全局固定人数」降级成**新房间的初值** ——
        //   人数现在是**房间级**设置（房主在大厅改），开局只看房间那一份。
        //   保留它当初值，是为了 `--seats 2` 这种「这台机器就开双人房」的老用法还成立。
        //   ⚠️ 夹进合法区间：`RoomHub` 是公开 API，调用方传个 9 也不该造出打不开的房间。
        seatCount: isLobbySeatCount(this.#opts.seatCount)
          ? this.#opts.seatCount
          : LOBBY_DEFAULT_OPTIONS.seatCount,
      },
    };
    this.#tables.set(id, t);
    return t;
  }

  /**
   * ★ 聯機存檔（v6）：照存檔建一間房 —— 座位、地圖、開局設定全照存檔（鎖定），
   * 真人座位先**全部空著**（`vacant`），等人憑 `clientId` 自動坐回去或點「這是我」。
   */
  #tableFromSave(
    id: string,
    creator: string,
    save: StoredSave,
    base: { state: GameState; snapshot: string },
  ): Table {
    const seats: SeatSlot[] = save.seats.map((st) => ({
      info:
        st.kind === 'human'
          ? { seat: st.seat, name: st.name, character: st.character, kind: 'human', connected: false, vacant: true }
          : { seat: st.seat, name: st.name, character: st.character, kind: 'computer' },
      conn: null,
      disconnectedAt: null,
      takenOver: false,
      clientId: st.kind === 'human' ? st.clientId : null,
      strikes: 0,
      pendingRestore: false,
      lastAwaitingSeq: Number.NaN,
      vacant: st.kind === 'human',
      saved: st.kind === 'human' ? { clientId: st.clientId, name: st.name } : null,
    }));
    const t: Table = {
      id,
      seats,
      room: null,
      globalMapId: save.globalMapId,
      emptySince: null,
      clock: null,
      createdAt: this.#now(),
      fromSave: { id: save.id, name: save.name, state: base.state, snapshot: base.snapshot },
      hostClientId: creator,
      guests: new Set(),
      // 從自動存檔繼續 ⇒ 接著寫**同一份**自動存檔（一局一份，不越續越多）
      autoSaveId: save.kind === 'auto' ? save.id : autoSaveId(id),
      lastSavedDay: null,
      hostAwaySince: null,
      options: { ...save.options, seatCount: seats.length },
    };
    this.#tables.set(id, t);
    return t;
  }

  /** 這條連接是不是這間房的房主 */
  #isHost(t: Table, me: Member): boolean {
    // 一般房間按**座位**認（同一個瀏覽器開兩個分頁 = 同一個 clientId 坐兩座，只有第一座是房主）；
    // 存檔房按 clientId 認（房主可能還沒入座，也得能「請離座」）
    if (t.fromSave === null) return me.seat !== null && me.seat === this.#hostSeat(t);
    return me.clientId !== null && me.clientId === t.hostClientId;
  }

  /**
   * 房主坐在幾號座；還沒入座 = -1。
   * ★ 房主交接（v6）起一般房間的房主也不一定是 0 號座了 —— 一律按 `hostClientId` 找。
   */
  #hostSeat(t: Table): number {
    const slot = t.seats.find(
      (s) => s.info.kind === 'human' && !s.vacant && s.clientId !== null && s.clientId === t.hostClientId,
    );
    return slot?.info.seat ?? -1;
  }

  /**
   * ★ 房主交接（v6）：開局前房主走了 ⇒ 房主交給**下一位在線的真人**（座位號最小的那位）；
   * 一個都沒有 ⇒ 關房（還沒入座的人收到一句話、被斷開 —— 客戶端會回房間列表）。
   * 存檔房的存檔不動（它本來就在倉庫裡）。
   */
  #handOver(t: Table, closeIfEmpty: boolean): void {
    t.hostAwaySince = null;
    const next = t.seats.find((s) => s.info.kind === 'human' && !s.vacant && s.conn !== null && s.clientId !== null);
    if (next !== undefined) {
      t.hostClientId = next.clientId;
      this.#broadcast(t, { t: 'room', room: this.#info(t) });
      return;
    }
    // ★ 只有**主動離開**才當場關房；斷線（可能只是刷新 / 網路抖）一個人都沒剩時不關 ——
    //   交給原來那條「全桌無人滿 `roomIdleMs` 就回收」（W-73 §4），他回來還進得去
    if (closeIfEmpty) this.#closeTable(t, '房主離開了，房間已關閉');
    else this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  /** 關掉一間房：還在裡面的連接都收到 `message` 並被斷開 */
  #closeTable(t: Table, message: string): void {
    const conns = [...t.seats.flatMap((s) => (s.conn === null ? [] : [s.conn])), ...t.guests];
    this.#tables.delete(t.id);
    for (const c of conns) {
      const m = this.#members.get(c);
      if (m !== undefined) {
        m.table = null;
        m.seat = null;
      }
      this.#sendTo(c, { t: 'error', message });
      c.close?.();
    }
  }

  /**
   * ★ 房主交接（v6）：開局前**讓出一座**（主動「離開」、或斷線超過 `takeoverAfterMs`）。
   * · 存檔房：座位放回「沒人坐」（座位是存檔定的，不能少一座）；
   * · 一般房間：**拿掉這一座**，後面的人往前挪（開局前座位號只是順序，還沒燒進任何局面）——
   *   挪了座的人各收到一條新的 `joined`，照新座位號繼續。
   * 讓出的是房主 ⇒ 當場交接。
   */
  #leaveUnstarted(t: Table, slot: SeatSlot, closeIfEmpty = true): void {
    if (t.room !== null) return;
    const wasHost = slot.clientId !== null && slot.clientId === t.hostClientId && this.#hostSeat(t) === slot.info.seat;
    if (t.fromSave !== null) {
      this.#vacate(t, slot);
    } else {
      const idx = t.seats.indexOf(slot);
      if (idx < 0) return;
      t.seats.splice(idx, 1);
      t.seats.forEach((s, i) => {
        if (s.info.seat === i) return;
        s.info.seat = i;
        if (s.conn !== null) {
          const m = this.#members.get(s.conn);
          if (m !== undefined) m.seat = i;
        }
      });
      for (const s of t.seats) {
        if (s.conn !== null && s.info.seat >= idx) {
          this.#sendTo(s.conn, { t: 'joined', version: PROTOCOL_VERSION, seat: s.info.seat, room: this.#info(t) });
        }
      }
    }
    if (wasHost) {
      this.#handOver(t, closeIfEmpty);
      return;
    }
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  /**
   * ★ 聯機存檔（v6）：把一座放回「沒人坐」—— 坐在上面的連接退回「還沒入座」（`joined.seat = -1`）。
   * 身分還原成存檔裡原來那個人（他回來照樣憑 `clientId` 自動坐回去）。
   */
  #vacate(t: Table, slot: SeatSlot): void {
    const kicked = slot.conn;
    slot.conn = null;
    slot.vacant = true;
    slot.disconnectedAt = null;
    slot.info.vacant = true;
    slot.info.connected = false;
    slot.clientId = slot.saved?.clientId ?? null;
    slot.info.name = slot.saved?.name ?? slot.info.name;
    if (kicked !== null) {
      const m = this.#members.get(kicked);
      if (m !== undefined) m.seat = null;
      t.guests.add(kicked);
      this.#sendTo(kicked, { t: 'joined', version: PROTOCOL_VERSION, seat: -1, room: this.#info(t) });
    }
  }

  /**
   * ★ W-73：**认回原座位的判据是 `clientId`，不是名字**。
   *
   * 名字重复现在是**允许**的（显示时也不去重）—— 两个朋友起同名不再串座。
   * 顺序：先找「同 `clientId` 且断线中」的原座；找不到再占下一个空位；开局后不再放新人。
   */
  #assignSeat(
    t: Table,
    name: string,
    clientId: string,
    conn: Conn,
    claimSeat?: unknown,
  ): number | 'guest' | null {
    let back = t.seats.find((s) => s.info.kind === 'human' && s.clientId === clientId && s.conn === null);
    // ★ 聯機存檔（v6）：已開局的存檔房裡，從列表「認領座位」—— 只認**電腦代打中的空座**
    if (back === undefined && t.fromSave !== null && t.room !== null && typeof claimSeat === 'number') {
      const slot = t.seats[claimSeat];
      if (slot !== undefined && slot.info.kind === 'human' && slot.vacant && slot.conn === null) {
        slot.clientId = clientId;
        back = slot;
      }
    }
    if (back !== undefined) {
      back.vacant = false;
      delete back.info.vacant;
      back.conn = conn;
      back.disconnectedAt = null;
      back.info.connected = true;
      // 名字改了也认回 —— 名字只是显示用的
      back.info.name = name;
      // ★★ 首席复核续（DeepSeek）：**「超时託管」也要一并归还** —— 原先只处理了 `takenOver`。
      //
      //   超时託管（`autopilot === 'idle'` / `pendingRestore`）时镜像里那个 AUTOPILOT 位
      //   没人清：`#shouldTime` 从此不再给这个座位计时，而 `#driveComputers` 又认不出它
      //   （它只认 `takenOver` 与 `autopilot === 'idle'`）⇒ **这台座位从此没人驱动**。
      //   玩家「连续两次超时 → 刷新页面」回来正好撞上：服务器不催、他自己也点不动。
      //   实测复现（`hub.test.ts` 里那条「连续两次超时之后重连」）。
      if (t.room !== null && (back.takenOver || back.info.autopilot === 'idle' || back.pendingRestore)) {
        // 归还：镜像里把他从託管改回真人（也广播给所有人）
        const r = t.room.submitSystem({ type: 'setAi', player: back.info.seat, whoPlays: WHO_PLAYS_HUMAN });
        if (r.ok) this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
      }
      back.takenOver = false;
      back.pendingRestore = false;
      back.strikes = 0;
      back.lastAwaitingSeq = Number.NaN;
      delete back.info.autopilot;
      return back.info.seat;
    }
    if (t.room !== null) return null;
    // ★ 聯機存檔（v6）：存檔房的座位是存檔定的 —— 認不出來的人先「在房裡、還沒入座」
    if (t.fromSave !== null) return 'guest';
    // ★ 第十一份試玩回報 #1：入座上限跟**房间级**总人数（`--seats` 只当新房的初值）
    if (t.seats.length >= t.options.seatCount) return null;
    const seat = t.seats.length;
    t.seats.push({
      // ★ 角色不能再无脑取 `seat` 了（Q-NET-2）：前面进来的人可能已经把
      //   这个号改成别的，得挑一个**没人占**的；否则一开局就有人撞车。
      info: { seat, name, character: this.#freeCharacter(t.seats), kind: 'human', connected: true },
      conn,
      disconnectedAt: null,
      takenOver: false,
      clientId,
      strikes: 0,
      pendingRestore: false,
      lastAwaitingSeq: Number.NaN,
      vacant: false,
      saved: null,
    });
    return seat;
  }

  /**
   * 挑一个还没被占的角色号（Q-NET-2「角色不能撞车」）。
   *
   * ★ 取**最小空号**而不是随机：服务器是权威，同输入必须同结果 ——
   *   随机补角会让「同一房、同一串消息」在不同机器上补出不同角色。
   *   （单机那套 `fillComputerSeats` 用随机，是因为它没有联机一致性问题。）
   */
  #freeCharacter(seats: readonly SeatSlot[]): number {
    const used = new Set(seats.map((s) => s.info.character));
    for (let c = 0; c < LOBBY_CHARACTER_COUNT; c++) if (!used.has(c)) return c;
    // 座位数（≤4）远小于角色数（12），走不到这里；给个合法号别返回 undefined
    return seats.length % LOBBY_CHARACTER_COUNT;
  }

  #info(t: Table): RoomInfo {
    return {
      id: t.id,
      seats: t.seats.map((s) => ({ ...s.info })),
      started: t.room !== null,
      // ★ Q-NET-2：地图是房间级设置，跟着 `room` 广播一起同步给所有人
      globalMapId: t.globalMapId,
      // ★第十一份試玩回報 #1：开局选项同理（大厅要显示当前值）
      options: t.options,
      // ★ 聯機存檔（v6）
      ...(t.fromSave === null ? {} : { fromSave: { name: t.fromSave.name } }),
      hostSeat: this.#hostSeat(t),
    };
  }

  /** 按全局地图号取地图；没配 `mapFor` 就只认开局那一张 */
  #mapFor(globalMapId: number): Rich4Map | null {
    const { mapFor } = this.#opts;
    if (mapFor !== undefined) return mapFor(globalMapId) ?? null;
    return globalMapId === this.#opts.globalMapId ? this.#opts.map : null;
  }

  /**
   * Q-NET-2：改自己座位的角色。**服务器校验，不信客户端**。
   *
   * 三道闸，缺一不可：
   *   ① 未开局 —— 角色在 `newGame` 里就烧进局面了，开局后再改会让
   *      服务器镜像与各客户端当场分歧（而且没有任何 action 能表达这次改动）；
   *   ② 角色号合法（`isLobbyCharacter`）—— 越界号会在 `newGame` 里查出
   *      一张不存在的头像，甚至越界读角色表；
   *   ③ 不与别人撞车（`characterTaken`）—— 同房角色唯一。
   *
   * 只有「过闸」才改 `Table` 并广播；被拒时一个字都不动。
   */
  #setCharacter(t: Table, seat: number, character: unknown, conn: Conn): void {
    if (t.fromSave !== null) {
      this.#sendTo(conn, { t: 'error', message: '從存檔繼續的房間：角色照存檔，不能改' });
      return;
    }
    if (t.room !== null) {
      this.#sendTo(conn, { t: 'error', message: '已開局：角色不能再改' });
      return;
    }
    if (!isLobbyCharacter(character)) {
      this.#sendTo(conn, { t: 'error', message: '拒絕：角色編號不合法' });
      return;
    }
    if (characterTaken(t.seats.map((s) => s.info), character, seat)) {
      this.#sendTo(conn, { t: 'error', message: '拒絕：這個角色已經有人選了' });
      return;
    }
    const slot = t.seats[seat];
    // 座位必须还是这条连接的（掉线后旧句柄、或已被别人认回）
    if (slot === undefined || slot.conn !== conn) return;
    if (slot.info.character === character) return; // 幂等：没变就不广播
    slot.info.character = character;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  /**
   * Q-NET-2：换房间地图。**只有房主（0 号座）、只有未开局**，
   * 且服务器自己得真有这张图 —— 三条都过才改并广播。
   *
   * ⚠️ 地图是**房间级**设置（不是每人的本地设置）：服务器认下之后
   *   所有人下一次收到 `room` 就都看到新图，开局也照它 `newGame`。
   */
  #setMap(t: Table, seat: number, globalMapId: unknown, conn: Conn): void {
    if (t.fromSave !== null) {
      this.#sendTo(conn, { t: 'error', message: '從存檔繼續的房間：地圖照存檔，不能改' });
      return;
    }
    if (t.room !== null) {
      this.#sendTo(conn, { t: 'error', message: '已開局：地圖不能再改' });
      return;
    }
    // ★ v6：`seat` 在這裡是「是不是房主」（0 = 是）—— 房主交接之後不一定坐 0 號座
    if (seat !== 0) {
      this.#sendTo(conn, { t: 'error', message: '只有房主能換地圖' });
      return;
    }
    if (!isLobbyMapId(globalMapId)) {
      this.#sendTo(conn, { t: 'error', message: '拒絕：地圖編號不合法' });
      return;
    }
    if (this.#mapFor(globalMapId) === null) {
      this.#sendTo(conn, { t: 'error', message: `拒絕：伺服器沒有地圖 ${globalMapId}` });
      return;
    }
    if (t.globalMapId === globalMapId) return; // 幂等
    t.globalMapId = globalMapId;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  /**
   * 往**一条**连接发一句话。
   *
   * ★★ 首席复核续（DeepSeek）：`send` 是适配层给的（生产里是 `socket.send`），
   *   它**会抛** —— 而 hub 里有几条调用路径**没有**外层 catch（`sweepDisconnected`
   *   挂在 `setInterval` 上、`socket.on('close')`、以及各种事件回调）。
   *   一条发送失败的连接就够让整台服务器（= 所有房间）退出，实测复现
   *   （`hub-fuzz.test.ts` 的「一条坏连接不许把整台服务器带走」）。
   *
   * 这里统一吞掉：那条连接自己会被 `ws` 关掉、走到 `onClose`（掉线代打那条路接管），
   *   **别的座位照常收到**。
   */
  #sendTo(conn: Conn | null, msg: ServerMessage): void {
    if (conn === null) return;
    try {
      conn.send(msg);
    } catch {
      /* 只掐这一条：见上 */
    }
  }

  /**
   * 广播给这一桌的每一个在线座位。
   *
   * ★★ 首席复核续（DeepSeek）：**某一条连接发不出去不许影响别人，更不许把进程带走**。
   *   `send` 是适配层给的（生产里是 `socket.send`），它**会抛** —— 而本函数有两条调用
   *   路径**没有**外层 catch：`sweepDisconnected`（挂在 `setInterval` 上）与
   *   `socket.on('close')`。一条发送失败的连接就够让整台服务器（= 所有房间）退出。
   *   实测复现（`hub-fuzz.test.ts` 里那条「投递失败只掐那一条」）。
   *
   * 这里逐个兜住：那一条这次收不到就算了 —— 它自己会被 `ws` 关掉并走到 `onClose`
   *   （掉线代打那条路会接管），而**别的座位照常收到**。
   */
  #broadcast(t: Table, msg: ServerMessage): void {
    for (const s of t.seats) this.#sendTo(s.conn, msg);
    // ★ 聯機存檔（v6）：還沒入座的人也要看得到大廳的變化
    for (const g of t.guests) this.#sendTo(g, msg);
  }

  /**
   * ★★ 第十一份試玩回報 #1：改房间的开局选项。
   *
   * 三道闸与 `#setCharacter` / `#setMap` **逐条同形**：
   *   ① 未开局（开局后改会和服务器镜像、其他客户端的局面都不一致）；
   *   ② 只有房主（0 号座）；
   *   ③ 逐项取值合法（判据在 core 的 `lobbyOptionsError`，两端同一份）。
   * ★ 另加一道**只属于这一项**的闸：`seatCount` 不能小于**已经在座的真人**数
   *   （否则开局时那些座位会被无声地砍掉 —— 房主不能把人踢出局）。
   * 接受后广播 `{t:'room'}`，所有人（含发起者）照广播更新。
   */
  #setOptions(t: Table, seat: number, patch: Partial<LobbyOptions>, conn: Conn): void {
    if (t.fromSave !== null) {
      this.#sendTo(conn, { t: 'error', message: '從存檔繼續的房間：設定照存檔，不能改' });
      return;
    }
    if (t.room !== null) {
      this.#sendTo(conn, { t: 'error', message: '已經開局，不能再改房間設置' });
      this.#broadcast(t, { t: 'room', room: this.#info(t) });
      return;
    }
    if (seat !== 0) {
      this.#sendTo(conn, { t: 'error', message: '只有房主能改房間設置' });
      this.#broadcast(t, { t: 'room', room: this.#info(t) });
      return;
    }
    const bad = lobbyOptionsError(patch);
    if (bad !== null) {
      this.#sendTo(conn, { t: 'error', message: bad });
      this.#broadcast(t, { t: 'room', room: this.#info(t) });
      return;
    }
    const next = withLobbyDefaults({ ...t.options, ...patch });
    const humans = t.seats.length;
    if (next.seatCount < humans) {
      this.#sendTo(conn, { t: 'error', message: `房間人數不能少於已在座的 ${humans} 人` });
      this.#broadcast(t, { t: 'room', room: this.#info(t) });
      return;
    }
    t.options = next;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  /**
   * 开局：空座补电脑，建 Room，广播 start，然后若首位就是电脑就让它走。
   *
   * ★ Q-NET-2：这里的**每一个字段都取自服务器手上的大厅设置**
   *   （`t.seats` 的角色 + `t.globalMapId`），不读客户端任何本地设置。
   * ★★ 第十一份試玩回報 #1：**开局选项**（初始资金/载具/地产期限/时间/胜利条件）
   *   同样只看 `t.options` 这一份，并且座位补到 `t.options.seatCount`
   *   —— 需求方原话：「设置总人数4，只有2个真人，点开局后自动补2个NPC凑齐4人」。
   */
  #start(t: Table): void {
    // ★ 第十一份試玩回報 #1：补座位补到**房间级**的总人数（先前是服务器全局 `--seats`）
    while (t.seats.length < t.options.seatCount) {
      const seat = t.seats.length;
      t.seats.push({
        // 电脑也挑没人占的角色 —— 真人可能已经把 `seat` 号改掉了
        info: { seat, name: `電腦${seat + 1}`, character: this.#freeCharacter(t.seats), kind: 'computer' },
        conn: null,
        disconnectedAt: null,
        takenOver: false,
        clientId: null,
        strikes: 0,
        pendingRestore: false,
        lastAwaitingSeq: Number.NaN,
        vacant: false,
        saved: null,
      });
    }
    const map = this.#mapFor(t.globalMapId);
    if (map === null) {
      // `setMap` 已经拦过一道；这是「房间建好之后那张图才没了」的兜底
      this.#broadcast(t, { t: 'error', message: `伺服器沒有地圖 ${t.globalMapId}，無法開局` });
      return;
    }
    const seats = t.seats.map((s) => ({ ...s.info }));
    const room = new Room({
      id: t.id,
      map,
      globalMapId: t.globalMapId,
      seed: this.#opts.seedFor(t.id),
      seats,
      // ★ 第十一份試玩回報 #1：开局选项也进服务器镜像 —— 与客户端 `onStart` 必须**逐字段同源**，
      //   少一个字段 `stateFingerprint` 就对不上。
      options: t.options,
      ...(t.fromSave === null ? {} : { base: { state: t.fromSave.state, snapshot: t.fromSave.snapshot } }),
      // ★ v6：開局日期 = 服務器的今天（與單機 `startGame` 同一個 `defaultStartDate`）
      ...(t.fromSave === null && this.#today !== null ? { startDate: defaultStartDate(this.#today()) } : {}),
    });
    room.start();
    t.room = room;
    // ★ 聯機存檔（v6）：還沒入座的人進不了這一局 —— 告訴他（客戶端收到會回房間列表）
    for (const g of t.guests) {
      this.#sendTo(g, { t: 'error', message: '房主開局了，你沒有入座；可以從房間列表「認領座位」' });
      const m = this.#members.get(g);
      if (m !== undefined) m.table = null;
      g.close?.();
    }
    t.guests.clear();
    this.#broadcast(t, {
      t: 'start',
      seed: room.seed,
      globalMapId: room.globalMapId,
      seats,
      options: t.options,
      ...(room.startDate === null ? {} : { startDate: room.startDate }),
      ...(room.snapshot === null ? {} : { snapshot: room.snapshot }),
    });
    if (t.fromSave !== null) this.#settleSavedSeats(t);
    t.lastSavedDay = dayKey(room.state);
    this.#driveComputers(t);
    this.#advance(t, this.#now());
  }

  /**
   * ★ 聯機存檔（v6）：存檔局開局那一刻，把鏡像裡的「誰在打」對上**此刻**的座位：
   * · 有人坐的真人座位 ⇒ `HUMAN`（存檔時他若正被託管，清掉）；
   * · 沒人坐的真人座位 ⇒ `HUMAN | AUTOPILOT` 交給電腦（走「掉線代打」同一條路，
   *   `takenOver` + `autopilot: 'offline'`）—— 原來的人之後憑 `clientId` 回來、
   *   或別人從列表「認領座位」，走的也是重連那一段（`#assignSeat`）。
   * 都以系統 action 廣播出去（各客戶端照著施加，鏡像一致）。
   */
  #settleSavedSeats(t: Table): void {
    const room = t.room;
    if (room === null) return;
    const now = this.#now();
    for (const slot of t.seats) {
      if (slot.info.kind !== 'human') continue;
      const p = room.state.players[slot.info.seat];
      // ★ 还没上盘的座位（存檔是第一輪里存的）也算在局里 —— 落地时才生效的那一份见 `landingWhoPlays`
      if (p === undefined || !isInGame(p)) continue;
      const seated = slot.conn !== null;
      const want = seated ? WHO_PLAYS_HUMAN : WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT;
      if (!seated) {
        slot.takenOver = true;
        slot.disconnectedAt = now;
        slot.info.autopilot = 'offline';
        slot.info.connected = false;
      }
      if ((isUnplaced(p) ? p.landingWhoPlays : p.whoPlays) === want) continue;
      const r = room.submitSystem({ type: 'setAi', player: slot.info.seat, whoPlays: want });
      if (r.ok) this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
    }
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  // ------------------------------------------------------------
  //  聯機存檔（v6）
  // ------------------------------------------------------------

  /** 事件出口：自動存檔 + 推房間列表 */
  #afterEvents(): void {
    this.#autoSave();
    this.#publishRooms();
  }

  /** 每過一天（鏡像的日期變了）把這間房的自動存檔覆蓋一次 */
  #autoSave(): void {
    if (this.#saves === null) return;
    for (const t of this.#tables.values()) {
      const room = t.room;
      if (room === null || room.state.phase === 'gameOver') continue;
      const key = dayKey(room.state);
      if (key === t.lastSavedDay) continue;
      t.lastSavedDay = key;
      const host = t.seats.find((s) => s.clientId !== null && s.clientId === t.hostClientId)?.info.name;
      this.#writeSave(t, t.autoSaveId, 'auto', `${host ?? t.seats[0]?.info.name ?? '?'} 的房間`, this.#now());
    }
  }

  /** 把這一桌此刻的鏡像寫成一份存檔 */
  #writeSave(t: Table, id: string, kind: 'auto' | 'manual', name: string, now: number): 'ok' | 'full' | 'failed' {
    const room = t.room;
    if (room === null || this.#saves === null) return 'failed';
    const state = room.state;
    try {
      this.#saves.put({
        format: 1,
        id,
        kind,
        name,
        savedAt: now,
        globalMapId: room.globalMapId,
        options: { ...t.options },
        seats: t.seats.map((s) => ({
          seat: s.info.seat,
          name: s.info.name,
          character: s.info.character,
          kind: s.info.kind,
          clientId: s.info.kind === 'human' ? s.clientId : null,
        })),
        snapshot: serializeGame(state),
        meta: {
          year: state.year,
          month: state.month,
          day: state.day,
          turnCount: state.turnCount,
          alive: state.players.map((p) => isInGame(p)),
        },
      });
    } catch (err) {
      if (err instanceof SaveFullError) return 'full';
      // 寫不進去（磁碟滿、權限）不許把房間帶走 —— 留痕，下一天再試
      console.error(`[rich4] 存檔寫入失敗（${id}）：`, err);
      return 'failed';
    }
    return 'ok';
  }

  /**
   * 供測試 / 監控：以 `clientId` 這個人的眼光看到的存檔列表（新的在前）。
   * ⚠️ 只給 `mine`，**不給**任何 `clientId`。
   */
  listSaves(clientId: string | null, now: number = this.#now()): SaveSummary[] {
    if (this.#saves === null) return [];
    return this.#saves.list().map((sv) => ({
      id: sv.id,
      name: sv.name,
      kind: sv.kind,
      ageMs: Math.max(0, now - sv.savedAt),
      globalMapId: sv.globalMapId,
      year: sv.meta.year,
      month: sv.meta.month,
      day: sv.meta.day,
      turnCount: sv.meta.turnCount,
      seats: sv.seats.map((st) => ({
        seat: st.seat,
        name: st.name,
        character: st.character,
        kind: st.kind,
        mine: clientId !== null && st.clientId === clientId,
        alive: sv.meta.alive[st.seat] ?? true,
      })),
    }));
  }

  #submit(t: Table, seat: number, action: Action, from: Conn | null): void {
    const room = t.room;
    if (room === null) return;
    const r = room.submit(seat, action);
    if (!r.ok) {
      this.#sendTo(from, { t: 'error', message: `拒绝：${r.reason}` });
      return;
    }
    const now = this.#now();
    // ★ W-74：「该座位发来任何合法 intent ⇒ 当前计时作废」—— 先作废再按新局面重装
    this.#clearClock(t);
    if (seat >= 0 && seat < t.seats.length) t.seats[seat]!.strikes = 0;
    this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
    this.#driveComputers(t);
    this.#advance(t, now);
  }

  /**
   * ★ v8（gap-audit #7）：转发一条纯演出提示（亮牌 / 用卡失败 / 道具台词 / 选格取消）。
   *
   * 闸（任何一道不过就**静默丢弃** —— 这是演出，不回 error 免得刷屏）：
   *   ① 已开局、未终局，这条连接真坐在这一座；
   *   ② 这一座是**轮到的那一座**（`actingSeat`）且不是服务器在替它出手（掉线代打 / 超时託管 / 电脑）——
   *      原版这几件事只发生在真人自己的回合里（卡片欄 / 道具欄都是回合里的面板）；
   *   ③ 手里**真有**那张卡 / 那件道具（对服务器镜像查，不信客户端）；
   *   ④ 限速 `PRESENT_RATE`（每座每窗口至多几条）。
   *
   * ⚠️ 不 `submit`、不进日志、不进 `replay`、不碰指纹、不动回合计时 —— 局面一个字节都不变。
   *   不发回发起者（他自己那一端已经演了）。
   */
  #relayPresent(t: Table, seat: number, conn: Conn, cue: unknown): void {
    const room = t.room;
    if (room === null || room.state.phase === 'gameOver') return;
    const slot = t.seats[seat];
    if (slot === undefined || slot.conn !== conn) return;
    if (!isPresentCue(cue)) return;
    if (room.actingSeat !== seat) return;
    if (slot.info.kind !== 'human' || slot.takenOver || slot.info.autopilot === 'idle') return;
    const player = room.state.players[seat];
    if (player === undefined || !isInGame(player)) return;
    const holds =
      cue.kind === 'cardReveal' || cue.kind === 'cardFailed'
        ? player.cards.includes(cue.cardId)
        : toolCount(room.state.tools, seat, cue.toolId) > 0;
    if (!holds) return;
    const now = this.#now();
    const recent = (this.#presentLog.get(conn) ?? []).filter((at) => now - at < PRESENT_RATE.windowMs);
    if (recent.length >= PRESENT_RATE.max) {
      this.#presentLog.set(conn, recent);
      return;
    }
    recent.push(now);
    this.#presentLog.set(conn, recent);
    const msg: ServerMessage = { t: 'present', seat, after: room.sequenceLength - 1, cue: { ...cue } as PresentCue };
    for (const s of t.seats) if (s.conn !== conn) this.#sendTo(s.conn, msg);
    for (const g of t.guests) this.#sendTo(g, msg);
  }

  /**
   * 只要轮到电脑座位（含掉线代打的），就用 core 的 AI 替它把 action 一条条提交，直到轮到真人。
   *
   * ★ 「轮到谁」看 `room.actingSeat`，不是回合主人（issue #9）：拍賣期间四家轮流举牌，
   *   轮到 AI 控制的那位（电脑 / 掉线代打 / 自己开了託管）由这里替他出这一口 ——
   *   **哪怕回合主人是真人**；轮到真人则停手，等他自己的客户端提交（定序器此刻只收他的）。
   *   竞价里的 AI 出价**全部**归服务器，客户端联机时不发（`client/auction-screen.ts`）。
   */
  #driveComputers(t: Table): void {
    const room = t.room;
    if (room === null) return;
    for (let guard = 0; guard < 10_000; guard++) {
      // ★★ 首席复核（2026-09-20，实测复现）：**没有一个真人在场**（全掉线 / 全被超时託管）就**停手等人**。
      //   不然这一桌只剩电脑座位，本循环会在同一瞬间把**整局**打完 —— 人回来时棋已经下完了。
      //   有人重连 / `resume` 时那两条路会再调本函数，从停下的地方接着走。
      if (!this.#anyonePresent(t)) return;
      const seat = room.actingSeat;
      const slot = t.seats[seat];
      if (slot === undefined) return;
      // 竞价那一口：是不是 AI 控制由镜像说了算（`auctionNextBid` 自己判，真人返回 null）
      let action = room.decideAuctionBid();
      if (action === null) {
        // ★ W-74：超时託管也算「电脑管着」—— 但判据是 **`info.autopilot === 'idle'`**，
        //   不是镜像里那个 AUTOPILOT 位。
        //   为什么：`whoPlays` 的 AUTOPILOT 位**谁都能置**（`setAi` 是公开的 action），
        //   客户端自己把自己託管时那一位置上了，可他的回合仍由**他自己**推
        //   （`e2e.test.ts` 的 `scripted()` 就是这种玩法）。服务器只该接管
        //   「掉线」与「超时」这两种**由服务器判定**的託管。
        const computerControlled =
          slot.info.kind === 'computer' || slot.takenOver || slot.info.autopilot === 'idle';
        if (!computerControlled) return;
        action = room.decideForCurrent();
      }
      if (action === null) return;
      const r = room.submit(seat, action);
      if (!r.ok) return;
      this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
      // ★★ 首席复核：「他的回合一结束就把座位还给他」必须在**循环里**结算。
      //   原先只在循环**之后**（`#advance`）结算 —— 一桌只有他一个真人时，循环里下一位、再下一位
      //   全是电脑，转一圈又回到他（此刻仍是 `idle`）⇒ 永远停不下来：超时**一次**，服务器就在 0 秒内
      //   替所有人连打几十个回合（实测）。结算后他变回 HUMAN，轮回到他时上面 `computerControlled` 为假，循环收手。
      this.#settleTimeoutAutopilot(t);
    }
  }

  /**
   * 这一桌此刻有没有**真人在场**：在线、且没被**长期**超时託管（掉线的 `conn === null` 自然不算）。
   *
   * ⚠️ 「只超时了一次、电脑正替他走这一回合」的人**算在场**（`pendingRestore` 为真）——
   *   那一回合必须走完；走完当场还给他（`#settleTimeoutAutopilot`）。连续两次之后
   *   `pendingRestore` 落回假而 `autopilot` 仍是 `'idle'`，那才是「人不在」。
   */
  #anyonePresent(t: Table): boolean {
    return t.seats.some(
      (s) => s.info.kind === 'human' && s.conn !== null && (s.info.autopilot !== 'idle' || s.pendingRestore),
    );
  }
}

/** 局面的日期鍵（`年-月-日`）—— 自動存檔「過了一天」的判據 */
function dayKey(state: { year: number; month: number; day: number }): string {
  return `${state.year}-${state.month}-${state.day}`;
}
