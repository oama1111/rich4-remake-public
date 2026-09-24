/*
 * 联机：新聞 18 地震 / 19 山洪的演出提示（gap-audit #6，第二十二份）—— 服务器与客户端镜像同一份
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * core 在 `settle` 里把「挑中那一处」（`lastEvent.place` → `lastViewTarget`，`view_to` @ 18 `0x0044a7ef` /
 * 19 `0x0044aa75`）与「一起闪的那几处」（`lastEvent.flashLots`，18 `0x0044a846` / 19 `0x0044aa9f`）交给表现层。
 * 联机时每一端按广播重放同一条 action ⇒ 两份必须逐字节相同（行动者与旁观者闪的是同几块地）；
 * 纯表现、不进指纹。表现层（事件框收屏 → 闪 → 重画 → 静置，单机 / 联机同一条 `startActionFx` 出口）
 * 钉在 `packages/client/src/news-flash-fx.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
  newGame,
  parseMap,
  reduce,
  stateFingerprint,
  type Action,
  type GameState,
  type SeatInfo,
} from '@rich4/core';
import { Room } from './room.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({ nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials });

const seats = (): SeatInfo[] => [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

function atNews(map: Map0, newsId: number): GameState {
  const s = newGame({ map, players: seats().map((x) => ({ character: x.character, kind: x.kind })), seed: 11, mode: 'multiplayer' });
  const news = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.NEWS)!;
  return {
    ...s,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: s.players.map((p) => ({ ...p, whoPlays: 1, nodeId: news.id })),
    // 全图地块都归 3 号、盖到 2 级 ⇒ 挑中哪一块都有东西可拆、可闪
    landOwner: s.landOwner.map((_, i) => (i === 0 ? 0 : 3)),
    landLevel: s.landLevel.map((_, i) => (i === 0 ? 0 : 2)),
    newsDeck: { order: [newsId, ...s.newsDeck.order.filter((x) => x !== newsId)], cursor: 0 },
  };
}

function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({ id: 'NEWSFX', map, globalMapId: 0, seed: 11, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
  room.start();
  return room;
}

describe('★★ 联机：新聞 18 / 19 的镜头目标与闪的地块两端一致', () => {
  for (const id of [18, 19]) {
    run(`新聞 ${id}：服务器与镜像的 \`lastEvent.place\` / \`flashLots\` / \`lastViewTarget\` 逐字段相同`, () => {
      const map = loadMap();
      const topo = topoOf(map);
      const state = atNews(map, id);
      const room = roomFrom(map, state);
      const mirror = { s: state };
      expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
      const ev = room.state.lastEvent!;
      expect(ev).toMatchObject({ kind: 'news', id });
      expect(ev.place).toBeDefined();
      expect(ev.flashLots?.length ?? 0).toBeGreaterThan(0);
      expect(ev.flashLots).toContain(ev.place!.entity);
      if (id === 19) expect(ev.flashLots).toEqual([ev.place!.entity]);
      expect(mirror.s.lastEvent).toEqual(ev);
      expect(room.state.lastViewTarget).not.toBeNull();
      expect(mirror.s.lastViewTarget).toEqual(room.state.lastViewTarget);
    });
  }
});
