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
  PROTOCOL_VERSION,
  WHO_PLAYS_AUTOPILOT,
  WHO_PLAYS_HUMAN,
  characterTaken,
  isClientId,
  isLobbyCharacter,
  isLobbyMapId,
  isRoomCode,
  sanitizeName,
  type Action,
  type ClientMessage,
  type Rich4Map,
  type RoomInfo,
  type SeatInfo,
  type ServerMessage,
} from '@rich4/core';
import { Room } from './room.ts';

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
   * ★ W-73 §4：从哪一刻起**全桌无人在线**；只要有人在就为 `null`。
   *
   * 由 `sweepDisconnected` 维护（一看就改，没有别的地方写它）——
   * 挂在事件上容易漏（有人掉线的方式不止一种），放在扫描里最稳。
   */
  emptySince: number | null;
  /** ★ W-74：回合计时器；没在等任何人时为 `null` */
  clock: TableClock | null;
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
    let table: Table | null = null;
    let seat: number | null = null;

    const handle: ClientHandle = {
      get roomId() {
        return table?.id ?? null;
      },
      get seat() {
        return seat;
      },
      onMessage: (msg: ClientMessage): void => {
        switch (msg.t) {
          case 'join': {
            if (msg.version !== PROTOCOL_VERSION) {
              conn.send({ t: 'error', message: `协议版本不符：服务器 ${PROTOCOL_VERSION}，客户端 ${msg.version}` });
              return;
            }
            if (table !== null) {
              conn.send({ t: 'error', message: '已经在房间里了' });
              return;
            }
            // ★ W-73 §3：三样都**服务器校验**，不信客户端；任何一样不合就
            //   `error` + **断开**（不是只回一句错误让它接着试）。
            if (!isClientId(msg.clientId)) {
              conn.send({ t: 'error', message: '拒絕：clientId 必須是 32 位小寫十六進位' });
              conn.close?.();
              return;
            }
            const name = sanitizeName(msg.name);
            if (name === null) {
              conn.send({ t: 'error', message: '拒絕：名字必須是 1–12 個字元（不含控制字元）' });
              conn.close?.();
              return;
            }
            if (!isRoomCode(msg.room)) {
              conn.send({ t: 'error', message: '拒絕：房間碼必須是 6 位（字母去 I/O、數字去 0/1）' });
              conn.close?.();
              return;
            }
            const t = this.#tableFor(msg.room);
            if (t === null) {
              conn.send({ t: 'error', message: '伺服器房間已滿' });
              return;
            }
            const s = this.#assignSeat(t, name, msg.clientId, conn);
            if (s === null) {
              conn.send({ t: 'error', message: '房间已满' });
              return;
            }
            t.emptySince = null;
            table = t;
            seat = s;
            conn.send({ t: 'joined', version: PROTOCOL_VERSION, seat: s, room: this.#info(t) });
            this.#broadcast(t, { t: 'room', room: this.#info(t) });
            // 重连：补发开局参数与漏掉的 action
            if (t.room !== null) {
              conn.send({ t: 'start', seed: t.room.seed, globalMapId: t.room.globalMapId, seats: t.seats.map((x) => x.info) });
              const from = msg.since === undefined ? 0 : msg.since + 1;
              for (const b of t.room.since(from)) conn.send({ t: 'action', seq: b.seq, action: b.action });
              // ★ 首席复核：这一桌可能正「停手等人」（见 `#anyonePresent`）—— 人回来了，接着走
              this.#driveComputers(t);
              this.#advance(t, this.#now());
            }
            return;
          }
          case 'start': {
            if (table === null || seat === null) return;
            if (seat !== 0) {
              conn.send({ t: 'error', message: '只有房主（0 号座）能开局' });
              return;
            }
            if (table.room !== null) return;
            this.#start(table);
            return;
          }
          case 'intent': {
            if (table === null || seat === null || table.room === null) {
              conn.send({ t: 'error', message: '还没开局' });
              return;
            }
            if (typeof msg.action !== 'object' || msg.action === null || typeof msg.action.type !== 'string') {
              conn.send({ t: 'error', message: '拒绝：action 格式不对' });
              return;
            }
            this.#submit(table, seat, msg.action, conn);
            return;
          }
          case 'checksum': {
            if (table === null || seat === null || table.room === null) return;
            const expected = table.room.fingerprintAt(msg.seq);
            if (expected !== null && expected !== msg.hash) {
              this.#broadcast(table, { t: 'desync', seq: msg.seq, expected, got: msg.hash, seat });
            }
            return;
          }
          // ★ Q-NET-1 失步自愈：把**完整** action 日志重放给请求者。
          //   权限只认 `join` 时绑在这条连接上的座位（下面的所有权检查），
          //   消息体里没有任何座位/名字可填 —— 所以索取不到别人的重放。
          //   也谈不上额外泄密：这条连接本来就收得到每一条广播 action。
          case 'resync': {
            if (table === null || seat === null || table.room === null) {
              conn.send({ t: 'error', message: '還沒開局' });
              return;
            }
            if (table.seats[seat]?.conn !== conn) {
              // 掉线后沿用旧句柄、或别的连接想蹭同一个座位，都在这里挡住
              conn.send({ t: 'error', message: '拒絕：這條連接不是該座位' });
              return;
            }
            const log = table.room.since(0);
            // ⚠️ 只回请求者，不广播（重放是给一个人的）
            conn.send({
              t: 'replay',
              seed: table.room.seed,
              globalMapId: table.room.globalMapId,
              seats: table.seats.map((s) => ({ ...s.info })),
              through: log.length === 0 ? -1 : log[log.length - 1]!.seq,
              actions: log.map((b) => ({ seq: b.seq, action: b.action })),
            });
            return;
          }
          // ★ Q-NET-2 大厅设置：改**自己**座位的角色。
          //   座位号取自 `join` 时绑在这条连接上的 `seat`，消息体里没有座位号 ——
          //   所以「改别人的角色」不是被拒绝，而是根本表达不出来。
          case 'setCharacter': {
            if (table === null || seat === null) {
              conn.send({ t: 'error', message: '還沒進房' });
              return;
            }
            this.#setCharacter(table, seat, msg.character, conn);
            return;
          }
          // ★ Q-NET-2 大厅设置：换房间地图。只有房主（0 号座）。
          case 'setMap': {
            if (table === null || seat === null) {
              conn.send({ t: 'error', message: '還沒進房' });
              return;
            }
            this.#setMap(table, seat, msg.globalMapId, conn);
            return;
          }
          // ★ W-74：本机座位**演完了、停在等输入上** —— 从这一刻起才开始数 60 秒。
          case 'awaiting': {
            if (table === null || seat === null || table.room === null) return;
            const slot = table.seats[seat];
            if (slot === undefined || slot.conn !== conn) return;
            // `seq` 必须是**最新**的那条广播：演出期间又来了一条 action 的话，
            // 「画面停在等输入」这个判断已经不成立
            if (msg.seq !== table.room.sequenceLength - 1) return;
            // ★ 先**记下来**（哪怕此刻表还没装上 —— 见 `lastAwaitingSeq` 的注释）
            slot.lastAwaitingSeq = msg.seq;
            const clock = table.clock;
            if (clock === null || clock.seat !== seat || clock.startedAt !== null) return;
            this.#startCounting(table, this.#now());
            return;
          }
          // ★ W-74：「我还在这儿，只是还在操作」—— 把截止时刻往后延（有硬上限）
          case 'alive': {
            if (table === null || seat === null) return;
            if (table.seats[seat]?.conn !== conn) return;
            const clock = table.clock;
            if (clock === null || clock.seat !== seat || clock.startedAt === null) return;
            const at = this.#now();
            const capped = clock.hardAt ?? clock.deadline;
            clock.deadline = Math.min(Math.max(clock.deadline, at + this.#opts.aliveExtendMs), capped);
            this.#broadcast(table, this.#clockMessage(clock, at));
            return;
          }
          // ★ W-74：被超时託管的玩家点一下画面 —— 把座位收回来
          case 'resume': {
            if (table === null || seat === null || table.room === null) return;
            const slot = table.seats[seat];
            if (slot === undefined || slot.conn !== conn) return;
            // 掉线代打不归这条管（那条是重连时归还）
            if (slot.info.autopilot !== 'idle') return;
            slot.strikes = 0;
            slot.pendingRestore = false;
            delete slot.info.autopilot;
            const r = table.room.submitSystem({ type: 'setAi', player: seat, whoPlays: WHO_PLAYS_HUMAN });
            if (r.ok) this.#broadcast(table, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
            this.#broadcast(table, { t: 'room', room: this.#info(table) });
            this.#driveComputers(table);
            this.#advance(table, this.#now());
            return;
          }
          default:
            return;
        }
      },
      onClose: (now: number): void => {
        if (table === null || seat === null) return;
        const slot = table.seats[seat];
        if (slot === undefined || slot.conn !== conn) return;
        slot.conn = null;
        slot.disconnectedAt = now;
        slot.info.connected = false;
        // ★ W-74：他掉线了，这一回合不必再等他（`#advance` 会按新局面重装表）
        this.#clearClock(table);
        this.#broadcast(table, { t: 'room', room: this.#info(table) });
        this.#advance(table, now);
      },
    };
    return handle;
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
      if (t.seats.some((s) => s.info.kind === 'human' && s.conn !== null)) {
        t.emptySince = null;
      } else {
        t.emptySince ??= now;
        if (now - t.emptySince >= this.#opts.roomIdleMs) {
          this.#tables.delete(t.id);
          continue;
        }
      }
      if (t.room === null) continue;
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
    return out;
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
  #tableFor(id: string): Table | null {
    const hit = this.#tables.get(id);
    if (hit !== undefined) return hit;
    if (this.#tables.size >= this.#opts.maxRooms) return null;
    // `emptySince` 初值 `null`：下一次扫描会把「此刻还全桌无人」的那一间记上时间戳。
    // 这里不能填 `now`（集线器没有时钟，时间一律由外部注入 —— 那是同一条规矩）。
    const t: Table = {
      id,
      seats: [],
      room: null,
      globalMapId: this.#opts.globalMapId,
      emptySince: null,
      clock: null,
    };
    this.#tables.set(id, t);
    return t;
  }

  /**
   * ★ W-73：**认回原座位的判据是 `clientId`，不是名字**。
   *
   * 名字重复现在是**允许**的（显示时也不去重）—— 两个朋友起同名不再串座。
   * 顺序：先找「同 `clientId` 且断线中」的原座；找不到再占下一个空位；开局后不再放新人。
   */
  #assignSeat(t: Table, name: string, clientId: string, conn: Conn): number | null {
    const back = t.seats.find((s) => s.info.kind === 'human' && s.clientId === clientId && s.conn === null);
    if (back !== undefined) {
      back.conn = conn;
      back.disconnectedAt = null;
      back.info.connected = true;
      // 名字改了也认回 —— 名字只是显示用的
      back.info.name = name;
      if (back.takenOver && t.room !== null) {
        // 归还：镜像里把他从託管改回真人（也广播给所有人）
        const r = t.room.submitSystem({ type: 'setAi', player: back.info.seat, whoPlays: WHO_PLAYS_HUMAN });
        if (r.ok) this.#broadcast(t, { t: 'action', seq: r.broadcast.seq, action: r.broadcast.action });
      }
      back.takenOver = false;
      delete back.info.autopilot;
      return back.info.seat;
    }
    if (t.room !== null) return null;
    if (t.seats.length >= this.#opts.seatCount) return null;
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
    if (t.room !== null) {
      conn.send({ t: 'error', message: '已開局：角色不能再改' });
      return;
    }
    if (!isLobbyCharacter(character)) {
      conn.send({ t: 'error', message: '拒絕：角色編號不合法' });
      return;
    }
    if (characterTaken(t.seats.map((s) => s.info), character, seat)) {
      conn.send({ t: 'error', message: '拒絕：這個角色已經有人選了' });
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
    if (t.room !== null) {
      conn.send({ t: 'error', message: '已開局：地圖不能再改' });
      return;
    }
    if (seat !== 0) {
      conn.send({ t: 'error', message: '只有房主（0 號座）能換地圖' });
      return;
    }
    if (!isLobbyMapId(globalMapId)) {
      conn.send({ t: 'error', message: '拒絕：地圖編號不合法' });
      return;
    }
    if (this.#mapFor(globalMapId) === null) {
      conn.send({ t: 'error', message: `拒絕：伺服器沒有地圖 ${globalMapId}` });
      return;
    }
    if (t.globalMapId === globalMapId) return; // 幂等
    t.globalMapId = globalMapId;
    this.#broadcast(t, { t: 'room', room: this.#info(t) });
  }

  #broadcast(t: Table, msg: ServerMessage): void {
    for (const s of t.seats) s.conn?.send(msg);
  }

  /**
   * 开局：空座补电脑，建 Room，广播 start，然后若首位就是电脑就让它走。
   *
   * ★ Q-NET-2：这里的**每一个字段都取自服务器手上的大厅设置**
   *   （`t.seats` 的角色 + `t.globalMapId`），不读客户端任何本地设置。
   */
  #start(t: Table): void {
    while (t.seats.length < this.#opts.seatCount) {
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
    });
    room.start();
    t.room = room;
    this.#broadcast(t, { t: 'start', seed: room.seed, globalMapId: room.globalMapId, seats });
    this.#driveComputers(t);
    this.#advance(t, this.#now());
  }

  #submit(t: Table, seat: number, action: Action, from: Conn | null): void {
    const room = t.room;
    if (room === null) return;
    const r = room.submit(seat, action);
    if (!r.ok) {
      from?.send({ t: 'error', message: `拒绝：${r.reason}` });
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
