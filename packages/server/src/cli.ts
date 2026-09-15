/*
 * 联机服务器命令行入口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   pnpm --filter @rich4/server start [--port 8787] [--map 0] [--seats 4] [--takeover 30000]
 *
 * ★ 地图结构从随包的 `assets/game/map.mkf` 读（资源号 = 全局地图号×2+1，与 client/assets.ts 同）。
 * ★ 种子由服务器取（C-DET-1 的唯一非确定性入口），客户端不得自取。
 * ★ C-LEG-5：私人小圈子用，不做公开大厅、不分发素材。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MkfArchive } from '@rich4/assets-pipeline';
import { parseMap } from '@rich4/core';
import { startWsServer } from './ws-server.ts';

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

const port = arg('port', 8787);
const globalMapId = arg('map', 0);
const seatCount = Math.max(2, Math.min(4, arg('seats', 4)));
const takeoverAfterMs = arg('takeover', 30_000);

const mapFile = fileURLToPath(new URL('../../../assets/game/map.mkf', import.meta.url));
const archive = new MkfArchive(new Uint8Array(readFileSync(mapFile)));
const map = parseMap(archive.read(globalMapId * 2 + 1));

/**
 * ★ Q-NET-2「换地图」：按需把某张地图读出来并缓存。
 *
 * 资源号 = 全局地图号×2+1（与 `client/assets.ts`、上面的默认图同一套）。
 * 读不出来（超出 0..7 / 资源缺失 / 解析失败）就返回 null —— hub 会据此
 * 拒绝这次换图，而不是等到开局时才发现手上没图。
 */
const mapCache = new Map<number, ReturnType<typeof parseMap>>();
const mapFor = (id: number): ReturnType<typeof parseMap> | null => {
  if (!Number.isInteger(id) || id < 0 || id >= 8) return null;
  const hit = mapCache.get(id);
  if (hit !== undefined) return hit;
  try {
    const m = parseMap(archive.read(id * 2 + 1));
    mapCache.set(id, m);
    return m;
  } catch {
    return null;
  }
};

const running = await startWsServer({
  port,
  map,
  globalMapId,
  mapFor,
  seatCount,
  takeoverAfterMs,
  seedFor: () => (Date.now() & 0x7fffffff) >>> 0,
});
console.log(`rich4 聯機伺服器：ws://localhost:${port}  地圖 ${globalMapId}（房主可在大廳換 0..7）  ${seatCount} 座  掉線 ${takeoverAfterMs / 1000}s 後電腦代打`);
console.log(`客戶端：http://localhost:5180/?ws=ws://localhost:${port}&room=r1&name=小明`);

process.on('SIGINT', () => {
  running.close();
  process.exit(0);
});
