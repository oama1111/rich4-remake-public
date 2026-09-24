/*
 * 联机客户端 —— 把「本地输入」变成意图，把「服务器广播」按序号施加
 * SPDX-License-Identifier: GPL-3.0-or-later
 * ★ 服务器权威（PRD MOD-14 / REQ-14.2）：本地**从不**直接 reduce 自己的 action；
 *   `submit()` 只发 `intent`，等服务器回 `action{seq}` 才由 `onAction` 施加。
 *   于是本地、远端、服务器代打的 action 走的是同一条路——与单机的 reduce 一模一样。
 * ★ 与传输无关：只要一个 `send(text)`；收到的文本交给 `receive(text)`。真跑用 WebSocket，
 *   测试用内存队列。乱序的广播先攒着，凑齐再按序施加。
 */

import {
  PROTOCOL_VERSION,
  type Action,
  type ClientMessage,
  type JoinMode,
  type RoomInfo,
  type LobbyOptions,
  type SeatInfo,
  type ServerMessage,
} from '@rich4/core';

/** 往服务器写文本的口子 */
export interface NetSocket {
  send(text: string): void;
}

export interface NetClientOptions {
  room: string;
  name: string;
  /**
   * ★ W-73：身份令牌（32 位十六进制）。断线重连**认回原座位**只认它，不认名字。
   *
   * 由门厅（`foyer.ts` 的 `loadClientId`）从 `localStorage` 取 / 首次生成；
   * 老的 `?ws=…&room=…&name=…` 调试入口也一样，从同一个地方取。
   */
  clientId: string;
  /**
   * ★ 房間列表（v5）：`'create'` = 建房（码必须还没人用）；`'join'` = 进一间**已有的**；
   *   不给 = 旧语义（有就进、没有就建）—— 见 core `protocol.ts` 的 `join.mode`。
   */
  mode?: JoinMode;
  /** ★ 聯機存檔（v6）：建房時從這份存檔繼續（只與 `mode: 'create'` 一起）*/
  fromSave?: string;
  /** ★ 聯機存檔（v6）：加入已開局的存檔房時認領這一座（只與 `mode: 'join'` 一起）*/
  claimSeat?: number;
  /** 重连：本地已施加到第几号（含） */
  since?: number;
  /** 每几号 action 上报一次校验和 @default 10 */
  checksumEvery?: number;
  /**
   * ★ 宿主**自己排队播**广播来的 action（第七份试玩回报第 1 条）时置真：
   *   `onAction` 只是「收下」，真正施加在之后 —— 校验和就不能在 `onAction` 返回那一刻算
   *   （那时本地状态还停在老地方，必然「失步」）。改由宿主在**真的施加完**之后调
   *   `noteApplied(seq)`，到了该报的序号才在那一刻取指纹。
   */
  deferChecksum?: boolean;
  /** 开局参数到了：建本地状态 */
  onStart(start: {
    seed: number;
    globalMapId: number;
    seats: SeatInfo[];
    /** ★ 第十一份試玩回報 #1：房間的開局選項（總人數 + 單機那五項）*/
    options: LobbyOptions;
    /** ★ 聯機存檔（v6）：起點局面（從存檔繼續的局才有）—— 見 `net-start.ts` */
    snapshot?: string;
    /** ★ v6：開局日期（服務器的今天）*/
    startDate?: { year: number; month: number; day: number };
    /**
     * ★ 第十二份試玩回報：进房那一刻服务器日志排到第几号（含；-1 = 空 / 旧服务器没带）。
     *   `> -1` 就说明这是**中途进房**（刷新 / 重连），见 `onCatchUp`。
     */
    through: number;
  }): void;
  /** 一条按序号到达的 action：施加到本地状态 */
  onAction(action: Action, seq: number): void;
  /**
   * ★★ 第十二份試玩回報（「断线重连后莫名其妙又进入魔法屋」「断线重连后所有文本提示又重新触发了一轮」）：
   *   中途进房时服务器补发的那一段（`start.through` 之前、含）**攒齐了一次交出来**，
   *   宿主应当**静默**追上（只 reduce、不起任何演出）—— 那些都是进房之前就已经发生的事，
   *   这台要么早就演过（刷新前），要么当时根本不在（断线期间）。
   *
   *   缺省（不给这个回调）⇒ 退回旧行为：补发的也逐条走 `onAction`。
   *   攒着的这一段**不报校验和**（与 `onResync` 同一口径：重建不是「施加完一条」）。
   */
  onCatchUp?(actions: { action: Action; seq: number }[]): void;
  /** 房间信息变化（有人进出、掉线） */
  onRoom?(room: RoomInfo): void;
  onJoined?(seat: number, room: RoomInfo): void;
  onError?(message: string): void;
  /** 服务器判定有人失步；`seat` 是谁的校验和不对 */
  onDesync?(info: { seq: number; expected: string; got: string; seat: number }): void;
  /**
   * ★ 失步自愈（Q-NET-1）：服务器把**完整** action 日志重放回来了。
   *
   * 本地必须以这份参数 `newGame` 再从头 reduce `actions` —— 是**整体替换**
   * 而不是继续增量施加；`NetClient` 已经把序号指针接成 `actions.length`。
   */
  onResync?(replay: {
    seed: number;
    globalMapId: number;
    seats: SeatInfo[];
    options: LobbyOptions;
    /** ★ 聯機存檔（v6）：起點局面 */
    snapshot?: string;
    startDate?: { year: number; month: number; day: number };
    actions: Action[];
  }): void;
  /**
   * ★ W-74：服务器广播了「这一回合还剩多久」。
   *
   * 发的是**剩余毫秒**（不是时刻）；`remainingMs < 0` 表示这一轮计时**作废**了
   * （有人交了 intent / 换人 / 该座位不再被等）。
   */
  onClock?(clock: { seat: number; remainingMs: number; hardRemainingMs: number }): void;
  /** ★ 聯機存檔（v6）：房主存了一份檔（廣播給全桌）*/
  onSaved?(name: string): void;
  /** 本地状态的指纹（发校验和用） */
  fingerprint(): string;
}

export class NetClient {
  readonly #socket: NetSocket;
  readonly #opts: NetClientOptions;
  readonly #pending = new Map<number, Action>();
  #expected: number;
  #seat: number | null = null;
  #room: RoomInfo | null = null;
  /** 已发出 `resync` 还没等到 `replay` —— 期间不再重复请求（desync 是广播，可能连发） */
  #resyncing = false;
  /**
   * ★ 第十二份試玩回報：这一段（含）之前的补发要静默追上（`start.through`）；-1 = 没有要追的。
   * 只在给了 `onCatchUp` 时生效。
   */
  #catchUpThrough = -1;
  /** 追赶期间攒着的补发（凑到 `#catchUpThrough` 那一号才一次交出） */
  readonly #catchUp: { action: Action; seq: number }[] = [];

  constructor(socket: NetSocket, opts: NetClientOptions) {
    this.#socket = socket;
    this.#opts = opts;
    this.#expected = opts.since === undefined ? 0 : opts.since + 1;
  }

  /** 我的座位；加入前为 null */
  get seat(): number | null {
    return this.#seat;
  }

  get room(): RoomInfo | null {
    return this.#room;
  }

  /** 下一条期待的序号 = 本地已施加的条数 */
  get expectedSeq(): number {
    return this.#expected;
  }

  /**
   * ★ 第十二份試玩回報：还在追「进房之前」那一段补发 —— 本地状态还没追上服务器，
   *   宿主此刻别拿它做任何决定（报 `awaiting`、替本机座位出手……）。
   */
  get catchingUp(): boolean {
    return this.#catchUpThrough >= 0 && this.#expected <= this.#catchUpThrough;
  }

  /** 连上之后第一件事：加入房间 */
  join(): void {
    const msg: ClientMessage = {
      t: 'join',
      version: PROTOCOL_VERSION,
      room: this.#opts.room,
      name: this.#opts.name,
      clientId: this.#opts.clientId,
    };
    if (this.#opts.since !== undefined) msg.since = this.#opts.since;
    if (this.#opts.mode !== undefined) msg.mode = this.#opts.mode;
    if (this.#opts.fromSave !== undefined) msg.fromSave = this.#opts.fromSave;
    if (this.#opts.claimSeat !== undefined) msg.claimSeat = this.#opts.claimSeat;
    this.#send(msg);
  }

  /** 房主开局 */
  start(): void {
    this.#send({ t: 'start' });
  }

  /** 本地输入 → 意图。不施加、不回滚，等广播 */
  submit(action: Action): void {
    this.#send({ t: 'intent', action });
  }

  /**
   * ★ Q-NET-2 大厅设置：改**自己**座位的角色。
   *
   * 只是**请求**：消息里没有座位号（服务器从连接上认），也不会先改本地 ——
   * 服务器校验通过后广播 `room`，本地照广播更新座位板。
   * 角色撞车 / 已开局 / 号越界都由服务器拒绝，走 `onError`。
   */
  setCharacter(character: number): void {
    this.#send({ t: 'setCharacter', character });
  }

  /**
   * ★ Q-NET-2 大厅设置：换房间地图。
   *
   * 只有房主（0 号座）会被服务器接受；非房主发出去只会收到一条 `error`。
   * 同上：本地不等确认就改，等 `room` 广播回来才算数。
   */
  setMap(globalMapId: number): void {
    this.#send({ t: 'setMap', globalMapId });
  }

  /**
   * ★★ 第十一份試玩回報 #1：改房间的**开局选项**（总人数 + 单机那五项）。
   *
   * 只带要改的那几项（`Partial`）；服务器逐项校验、只有房主能在未开局时改，
   * 接受后广播 `{t:'room'}` —— 与 `setCharacter`/`setMap` 同一套。
   */
  setOptions(options: Partial<LobbyOptions>): void {
    this.#send({ t: 'setOptions', options });
  }

  /**
   * ★ Q-NET-1：请求**全量重放**。收到 `desync` 广播时自动调用；
   * 上层也可以手动再要一次（例如发现序号跳号且补发迟迟不到）。
   *
   * 同一条连接上只允许一个未决请求 —— `desync` 是广播，可能连着来。
   */
  requestResync(): void {
    if (this.#resyncing) return;
    this.#resyncing = true;
    this.#send({ t: 'resync' });
  }

  /** 是否正等着一份重放 */
  get resyncing(): boolean {
    return this.#resyncing;
  }

  /**
   * ★ W-74：**本机座位已经演完动画、停在等输入上了**。
   *
   * 服务器从这一刻起才数 60 秒 —— 不是从广播那一刻（那会把掷骰、走子、
   * 神明影片的演出时间也算到玩家头上）。
   *
   * @param seq **最新**那条广播的序号（`expectedSeq - 1`）。服务器只认最新的：
   *   演出期间又来了一条 action 的话，「画面停在等输入」这个判断已经不成立。
   */
  awaiting(seq: number): void {
    this.#send({ t: 'awaiting', seq });
  }

  /** ★ W-74：「我还在操作」（逛股市、百貨公司里挑东西）—— 把截止时刻往后延 */
  alive(): void {
    this.#send({ t: 'alive' });
  }

  /** ★ 聯機存檔（v6）：存檔房大廳裡「這是我」 */
  claim(seat: number): void {
    this.#send({ t: 'claim', seat });
  }

  /** ★ 聯機存檔（v6）：把一座放回「沒人坐」（房主：任何人的；其他人：自己的）*/
  unclaim(seat: number): void {
    this.#send({ t: 'unclaim', seat });
  }

  /** ★ 聯機存檔（v6）：房主存一份檔 */
  save(name: string): void {
    this.#send({ t: 'save', name });
  }

  /** ★ W-74：本机座位被超时託管了，玩家点一下画面 —— 把座位收回来 */
  resume(): void {
    this.#send({ t: 'resume' });
  }

  /** 收到服务器一条文本 */
  receive(text: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'joined':
        this.#seat = msg.seat;
        this.#room = msg.room;
        this.#opts.onJoined?.(msg.seat, msg.room);
        return;
      case 'room':
        this.#room = msg.room;
        this.#opts.onRoom?.(msg.room);
        return;
      case 'start': {
        // 网络来的东西不可信：不是非负整数就当没带（退回旧行为）
        const through =
          typeof msg.through === 'number' && Number.isInteger(msg.through) && msg.through >= 0 ? msg.through : -1;
        this.#catchUp.length = 0;
        this.#catchUpThrough = this.#opts.onCatchUp === undefined ? -1 : through;
        this.#opts.onStart({
          seed: msg.seed,
          globalMapId: msg.globalMapId,
          seats: msg.seats,
          options: msg.options,
          ...(typeof msg.snapshot === 'string' ? { snapshot: msg.snapshot } : {}),
          ...(isDate(msg.startDate) ? { startDate: msg.startDate } : {}),
          through,
        });
        return;
      }
      case 'action':
        this.#pending.set(msg.seq, msg.action);
        this.#flush();
        return;
      case 'desync':
        this.#opts.onDesync?.({ seq: msg.seq, expected: msg.expected, got: msg.got, seat: msg.seat });
        // ★ 自愈：失步的是谁都要重放一份 —— 同一条广播到各端时，
        //   本机状态也可能已经跟着漂了，只补别人的没有意义。
        this.requestResync();
        return;
      case 'replay': {
        // 网络来的东西不可信：形状不对就当没收到，别把序号指针弄成 NaN
        if (typeof msg.through !== 'number' || !Array.isArray(msg.actions)) {
          this.#resyncing = false;
          return;
        }
        // ★ 整体替换：攒着没来得及施加的旧广播一律作废（它们都在重放里了），
        //   序号指针接到重放末尾的下一号。
        this.#pending.clear();
        this.#expected = msg.through + 1;
        this.#resyncing = false;
        // 重放是整体替换：还没追完的那一段也一并作废（都在重放里了）
        this.#catchUp.length = 0;
        this.#catchUpThrough = -1;
        this.#opts.onResync?.({
          seed: msg.seed,
          globalMapId: msg.globalMapId,
          seats: msg.seats,
          options: msg.options,
          ...(typeof msg.snapshot === 'string' ? { snapshot: msg.snapshot } : {}),
          ...(isDate(msg.startDate) ? { startDate: msg.startDate } : {}),
          actions: msg.actions.map((a) => a.action),
        });
        return;
      }
      case 'saved':
        this.#opts.onSaved?.(msg.name);
        return;
      case 'clock':
        this.#opts.onClock?.({ seat: msg.seat, remainingMs: msg.remainingMs, hardRemainingMs: msg.hardRemainingMs });
        return;
      case 'error':
        // 请求被拒（例如还没开局）也要解锁，否则此后不再尝试自愈
        this.#resyncing = false;
        this.#opts.onError?.(msg.message);
        return;
      default:
        return;
    }
  }

  /** 按序号施加攒着的广播；重复的（seq < expected）直接丢 */
  #flush(): void {
    for (const seq of [...this.#pending.keys()]) if (seq < this.#expected) this.#pending.delete(seq);
    const every = this.#opts.checksumEvery ?? 10;
    while (this.#pending.has(this.#expected)) {
      const seq = this.#expected;
      const action = this.#pending.get(seq)!;
      this.#pending.delete(seq);
      this.#expected = seq + 1;
      // ★ 第十二份試玩回報：进房之前的那一段先攒着，凑齐了一次交给宿主静默追上
      if (seq <= this.#catchUpThrough) {
        this.#catchUp.push({ action, seq });
        if (seq === this.#catchUpThrough) {
          const batch = this.#catchUp.splice(0);
          this.#catchUpThrough = -1;
          this.#opts.onCatchUp?.(batch);
        }
        continue;
      }
      this.#opts.onAction(action, seq);
      if (this.#opts.deferChecksum !== true && every > 0 && (seq + 1) % every === 0) {
        this.#send({ t: 'checksum', seq, hash: this.#opts.fingerprint() });
      }
    }
  }

  /** `deferChecksum` 模式下：宿主把第 `seq` 号 action **真的施加完**了 —— 到点就报校验和 */
  noteApplied(seq: number): void {
    if (this.#opts.deferChecksum !== true) return;
    const every = this.#opts.checksumEvery ?? 10;
    if (every > 0 && (seq + 1) % every === 0) {
      this.#send({ t: 'checksum', seq, hash: this.#opts.fingerprint() });
    }
  }

  #send(msg: ClientMessage): void {
    this.#socket.send(JSON.stringify(msg));
  }
}

/** 网络来的日期：三个正整数才收（不然当没带，退回 core 缺省）*/
function isDate(v: unknown): v is { year: number; month: number; day: number } {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return [d.year, d.month, d.day].every((x) => typeof x === 'number' && Number.isInteger(x) && x > 0);
}

/** 从页面 URL 读联机参数：`?ws=ws://host:port&room=r1&name=小明`；缺 ws 就是单机 */
export function netParamsFrom(search: string): { url: string; room: string; name: string } | null {
  const q = new URLSearchParams(search);
  const url = q.get('ws');
  if (url === null || url === '') return null;
  return { url, room: q.get('room') ?? 'default', name: q.get('name') ?? `玩家${Math.floor(Math.random() * 1000)}` };
}

/**
 * ★ W-70 §6：网页版的**默认**联机地址 —— 朋友点邀请链接进来时地址栏里
 * 只有房间码，没有 `?ws=`，得从 `location` 推。
 *
 * 同源部署下 `wss://<host>/ws` 正好是 Caddy 反代进来的那一条（任务书 §2 的图），
 * 也是 `attachWebSocket` 钉死的端点。
 *
 * ⚠️ 收一个「像 `location` 的东西」而不是直接读全局：单测里能塞假值，
 * 也逼调用方写清这个值是从哪来的。
 */
export function defaultWsUrl(loc: { protocol: string; host: string }): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/ws`;
}
