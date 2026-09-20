/*
 * WebSocket 适配器 —— 把 `ws` 的连接接到 RoomHub 上（W-70 起挂在已有的 http.Server 上）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 集线器本身不依赖任何网络库（hub.ts）；`ws` 在这里**运行时动态 import**，
 *   所以没装 `ws` 也能编译、跑单元测试。要起真服务器：`pnpm --filter @rich4/server add ws`。
 *
 * ★ W-70 的形态变化：以前这里自己 `new WebSocketServer({port})` 独占一个端口，
 *   现在**只负责挂到别人的 `http.Server` 上**（`attachWebSocket`），端点固定在
 *   `/ws`。理由见任务书 §2：静态站、素材、WebSocket 要落在**一个进程一个端口**里，
 *   公网流量由 Caddy 反代进来。
 *
 * ★ C-LEG-5：私人小圈子用，不做公开大厅、不分发素材。
 */

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ClientMessage } from '@rich4/core';
import { RoomHub, type HubOptions } from './hub.ts';

/** `ws` 里我们用到的那一小截接口，避免把类型依赖钉死在包上 */
interface WsLike {
  on(event: 'message', cb: (data: { toString(): string }) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  send(data: string): void;
  terminate(): void;
}
interface WsServerLike {
  on(event: 'connection', cb: (socket: WsLike, req: IncomingMessage) => void): void;
  emit(event: 'connection', socket: WsLike, req: IncomingMessage): void;
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (socket: WsLike) => void): void;
  close(): void;
}
type WsModule = { WebSocketServer: new (opts: { noServer: boolean; maxPayload: number }) => WsServerLike };

/**
 * 单条消息的上限（字节）。`ws` 的缺省是 100 MiB —— 本协议最大的一条（`intent`）也就几百字节，
 * 留 64 KiB 绰绰有余；超了 `ws` 会以 1009 关掉这条连接。
 */
export const WS_MAX_PAYLOAD = 64 * 1024;

/**
 * 多久扫一次（掉线代打 / 回合超时 / 空房回收）。
 *
 * ★ 首席复核：原先是 5000 —— 回合计时是靠这一扫落地的，于是客户端倒计时数到 0 之后
 *   还要干等最多 5 秒才真的超时（实测 3 秒的表 7.9 秒才响）。扫一遍只是遍历几张桌子，1 秒一次不值一提。
 */
export const SWEEP_EVERY_MS = 1000;

export interface WsServerOptions extends HubOptions {
  /** 掉线扫描周期（毫秒） @default 5000 */
  sweepEveryMs?: number;
  now?: () => number;
  /**
   * 升级前的闸 —— W-71 的访问密码在这里验 cookie。
   *
   * 返回 `false` 表示**已经**由钩子自己把响应（例如 401）写进 socket 并销毁了，
   * `attachWebSocket` 不再碰这个 socket。不给这个钩子 = 全放行（W-70 的形态）。
   */
  authorizeUpgrade?: (req: IncomingMessage, socket: Duplex) => boolean;
}

export interface WsEndpoint {
  hub: RoomHub;
  /** 清掉掉线扫描定时器、断开所有升级上来的 socket；**不**动宿主 http.Server */
  close(): void;
}

/** WebSocket 端点的路径（任务书 W-70 §2 的图里写死这一条）*/
export const WS_PATH = '/ws';

/**
 * 把 WebSocket 端点挂到一个已有的 `http.Server` 上。
 *
 * 用 `noServer` + 自己接 `upgrade` 事件（而不是 `new WebSocketServer({server, path})`）：
 * 路径判断、拒绝响应的**顺序**（先验路径再验门，W-71）都得自己拿，
 * 交给 `ws` 的 `path` 选项就只能二者取一。
 */
export async function attachWebSocket(
  server: Server,
  opts: WsServerOptions,
  path: string = WS_PATH,
): Promise<WsEndpoint> {
  // 模块名拼出来，免得 tsc 在没装 ws 时去找它的类型（运行时没装会在这里抛 ERR_MODULE_NOT_FOUND）
  const moduleName = 'ws';
  const mod = (await import(moduleName)) as unknown as WsModule;
  const hub = new RoomHub(opts);
  const now = opts.now ?? (() => Date.now());
  const wss = new mod.WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

  wss.on('connection', (socket) => {
    const handle = hub.connect({ send: (msg) => socket.send(JSON.stringify(msg)) });
    socket.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
      // ★ 首席复核：消息是**对方写的** —— 形状不对（缺字段 / 类型不对）让 hub 抛了，
      //   只掐这一条连接，**不许**把进程（= 所有房间）带走。
      try {
        handle.onMessage(msg);
      } catch {
        socket.terminate();
      }
    });
    // ★ `ws` 在协议错误 / 超 `maxPayload` 时发 'error'；没人听 = 未捕获异常 = 进程退出
    socket.on('error', () => socket.terminate());
    socket.on('close', () => handle.onClose(now()));
  });

  // 升级上来的 socket 不走 http.Server 的 closeAllConnections()，得自己收着
  const live = new Set<Duplex>();
  server.on('upgrade', (req, socket, head) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    // ★ 首席复核：升级口**没有** `createHttpHandler` 那层 `route().catch` —— 这里任何一处抛
    //   （实测：特制 cookie 让 `timingSafeEqual` 抛）都是未捕获异常。整段兜住，fail closed。
    socket.on('error', () => socket.destroy());
    try {
      upgrade(req, socket, head);
    } catch {
      socket.destroy();
    }
  });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(req.url) !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (opts.authorizeUpgrade !== undefined && !opts.authorizeUpgrade(req, socket)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };

  const timer = setInterval(() => hub.sweepDisconnected(now()), opts.sweepEveryMs ?? SWEEP_EVERY_MS);
  return {
    hub,
    close: () => {
      clearInterval(timer);
      for (const s of live) s.destroy();
      live.clear();
      wss.close();
    },
  };
}

/** 去掉 query 的请求路径 */
function pathOf(url: string | undefined): string {
  const raw = url ?? '/';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}
