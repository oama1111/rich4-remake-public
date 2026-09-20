/*
 * 联机服务器命令行入口
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   pnpm --filter @rich4/server start [--port 8787] [--host 127.0.0.1]
 *                                    [--web packages/client/dist-web] [--assets assets/game]
 *                                    [--map 0] [--seats 4] [--takeover 30000] [--seed N]
 *
 * ★ 一个进程、一个端口（任务书 §2）：静态站、原版素材、`/ws` 全在这一个
 *   `http.Server` 上。公网流量由 Caddy 反代进来，故 `--host` 缺省只听本机。
 * ★ 地图结构从随包的 `assets/game/map.mkf` 读（资源号 = 全局地图号×2+1，与 client/assets.ts 同）。
 * ★ 种子由服务器取（C-DET-1 的唯一非确定性入口），客户端不得自取。
 *   `--seed N` 只为**复现**（例：issue #9 的 968029213）；不给就照旧取时钟。
 * ★ C-LEG-5：私人小圈子用，不做公开大厅、不分发素材。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MkfArchive } from '@rich4/assets-pipeline';
import { parseMap } from '@rich4/core';
import { startHttpServer } from './http-server.ts';

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

/** 字符串参数；没给返回 `null`（好与「给了空串」区分开） */
function argStr(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? null : v;
}

const port = arg('port', 8787);
/** ★ 缺省只听本机：公网由 Caddy 反代（任务书 §2）*/
const host = argStr('host') ?? '127.0.0.1';
const globalMapId = arg('map', 0);
const seatCount = Math.max(2, Math.min(4, arg('seats', 4)));
const takeoverAfterMs = arg('takeover', 30_000);
/** 复现用的固定种子；−1 = 不固定（取时钟） */
const fixedSeed = arg('seed', -1);

/**
 * 素材目录。`--assets` 缺省是**仓库里的** `assets/game`（按本文件的位置算，
 * 与 cwd 无关）；显式给的相对路径按 cwd 解析。
 */
const defaultAssets = fileURLToPath(new URL('../../../assets/game', import.meta.url));
const assetsArg = argStr('assets');
const assetDir = assetsArg === null ? defaultAssets : resolve(assetsArg);

/** 静态站目录。**不给就不开静态服务**（只留 /robots.txt 与 /assets/game）*/
const webArg = argStr('web');
const webDir = webArg === null ? undefined : resolve(webArg);

// 地图档案与素材目录是两件事：地图结构服务器自己要用（`map.mkf`），
// 但它**端出去**的那份由 `--assets` 决定。
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

const running = await startHttpServer({
  port,
  host,
  assetDir,
  ...(webDir === undefined ? {} : { webDir }),
  map,
  globalMapId,
  mapFor,
  seatCount,
  takeoverAfterMs,
  seedFor: () => (fixedSeed >= 0 ? fixedSeed >>> 0 : (Date.now() & 0x7fffffff) >>> 0),
});
console.log(
  `rich4 聯機伺服器：${running.url}/  ws ${running.url.replace(/^http/, 'ws')}/ws  地圖 ${globalMapId}（房主可在大廳換 0..7）  ${seatCount} 座  掉線 ${takeoverAfterMs / 1000}s 後電腦代打`,
);
console.log(`素材目錄：${assetDir}`);
console.log(webDir === undefined ? '靜態站：未開（沒給 --web）' : `靜態站：${webDir}`);
console.log(`客戶端（開發）：http://localhost:5173/?ws=${running.url.replace(/^http/, 'ws')}/ws&room=r1&name=小明`);

process.on('SIGINT', () => {
  running.close();
  process.exit(0);
});
