/*
 * WebSocket 适配器 —— 把 `ws` 的连接接到 RoomHub 上
 * SPDX-License-Identifier: GPL-3.0-or-later
 * ★ 集线器本身不依赖任何网络库（hub.ts）；`ws` 在这里**运行时动态 import**，
 *   所以没装 `ws` 也能编译、跑单元测试。要起真服务器：`pnpm --filter @rich4/server add ws`。
 * ★ C-LEG-5：私人小圈子用，不做公开大厅、不分发素材。
 */

import type { ClientMessage } from '@rich4/core';
import { RoomHub, type HubOptions } from './hub.ts';

/** `ws` 里我们用到的那一小截接口，避免把类型依赖钉死在包上 */
interface WsLike {
  on(event: 'message', cb: (data: { toString(): string }) => void): void;
  on(event: 'close', cb: () => void): void;
  send(data: string): void;
}
interface WsServerLike {
  on(event: 'connection', cb: (socket: WsLike) => void): void;
  close(): void;
}
type WsModule = { WebSocketServer: new (opts: { port: number }) => WsServerLike };

export interface WsServerOptions extends HubOptions {
  port: number;
  /** 掉线扫描周期（毫秒） @default 5000 */
  sweepEveryMs?: number;
  now?: () => number;
}

export interface RunningServer {
  hub: RoomHub;
  close(): void;
}

/** 起一个 WebSocket 服务器（需要已安装 `ws`） */
export async function startWsServer(opts: WsServerOptions): Promise<RunningServer> {
  // 模块名拼出来，免得 tsc 在没装 ws 时去找它的类型（运行时没装会在这里抛 ERR_MODULE_NOT_FOUND）
  const moduleName = 'ws';
  const mod = (await import(moduleName)) as unknown as WsModule;
  const hub = new RoomHub(opts);
  const now = opts.now ?? (() => Date.now());
  const server = new mod.WebSocketServer({ port: opts.port });
  server.on('connection', (socket) => {
    const handle = hub.connect({ send: (msg) => socket.send(JSON.stringify(msg)) });
    socket.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
      handle.onMessage(msg);
    });
    socket.on('close', () => handle.onClose(now()));
  });
  const timer = setInterval(() => hub.sweepDisconnected(now()), opts.sweepEveryMs ?? 5000);
  return {
    hub,
    close: () => {
      clearInterval(timer);
      server.close();
    },
  };
}
