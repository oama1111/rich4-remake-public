/*
 * 联机：董事長踩到商店（第二十一份 `20260924-144217689`）—— 服务器与客户端镜像同一条路
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `_rich4_ui_shop_entry`（`fcn_0042e931`）：落点那家企業的董事長进门 →
 *   `0x0042e97d rand()&1` 选道具 / 卡片 → `0x0042ea14` 訊息框「歡迎董事長光臨 送您%s！」→
 *   `0x0042ea23 call 0x44f230` 台词 → `0x0042ea2b` 之后才判真人、开商店窗。
 *
 * 表现层的先后（框 → 台词 → 商店窗）钉在 `packages/client/src/shop-gift-order.test.ts`；
 * 这里钉住联机那一半：
 *   ① 真人座位（董事長）`settle` 进店 ⇒ 服务器镜像出 `pending{shop}` + 赠礼框 + 赠礼提示，
 *      客户端按广播重放逐条指纹一致（旁观者看到的是同一扇框、同一句台词的依据）；
 *   ② 服务器不替真人答商店（`decideForCurrent` 为 null）⇒ 不会在框还没演完时就把店关掉；
 *   ③ 赠礼提示（`lastShopGift`）是一次性的，下一条 action 就清掉（不会在旁观端重复说那句）；
 *   ④ 空袋那一支（道具 1..8 全 0）**也弹框、也掷台词那一拍**（原版框无条件走，名字别名到卡 30 烏龜卡）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  SPECIAL_KIND,
  newGame,
  parseMap,
  reduce,
  SPEECH_SITE,
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

/** 百貨那一行業（`places/shop.ts` 的 `STORE_INDUSTRY`）*/
const STORE_INDUSTRY = 10;

const seats = (): SeatInfo[] =>
  [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

function scene(map: Map0, seed: number): GameState {
  const base = newGame({
    map,
    players: seats().map((s) => ({ character: s.character, kind: s.kind })),
    seed,
    mode: 'multiplayer',
  });
  const shop = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.DEPARTMENT_STORE);
  const store = map.commercials?.find((c) => c.type === STORE_INDUSTRY);
  if (shop === undefined || store === undefined) throw new Error('地图里找不到百貨公司 / 百貨企業');
  const commercialOwners = base.commercialOwners.map((o, i) => (i === store.id ? { ...o, owner: 1 } : o));
  return {
    ...base,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    commercialOwners,
    // 开局还没「降落」的玩家 `whoPlays` 是 0 —— 照座位摆好（0 号真人 = 1、其余电脑 = 2）
    players: base.players.map((p, i) => (i === 0 ? { ...p, whoPlays: 1, nodeId: shop.id } : { ...p, whoPlays: 2 })),
  };
}

function roomFrom(map: Map0, state: GameState): Room {
  const room = new Room({
    id: 'SHOPMP',
    map,
    globalMapId: 0,
    seed: 7,
    seats: seats(),
    options: LOBBY_DEFAULT_OPTIONS,
    base: { state, snapshot: '' },
  });
  room.start();
  return room;
}

function submitBoth(room: Room, mirror: { s: GameState }, topo: ReturnType<typeof topoOf>, seat: number, action: Action) {
  const r = room.submit(seat, action);
  if (r.ok) {
    mirror.s = reduce(mirror.s, r.broadcast.action, topo);
    expect(stateFingerprint(mirror.s)).toBe(room.fingerprint);
  }
  return r;
}

describe('★★ 联机：董事長進店的赠礼框 / 台词与单机同一条路', () => {
  run('★ ① 真人董事長 settle 进店 ⇒ 镜像出 pending{shop} + 赠礼框 + 赠礼提示，重放一致；② 服务器不代答；③ 提示一次性', () => {
    const map = loadMap();
    const topo = topoOf(map);
    // 赠礼要库存 / 牌堆有货；换几个种子保证至少一局真的送出去（`rand()&1` 两支都覆盖到更好）
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = scene(map, seed);
      const room = roomFrom(map, state);
      const mirror = { s: state };
      expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
      const s = room.state;
      expect(s.pending?.kind).toBe('shop');
      expect(s.notices.map((n) => n.key)).toEqual(['shop.chairmanGift']);
      expect(s.lastShopGift).not.toBeNull();
      kinds.add(s.lastShopGift!.kind);
      // ② 服务器的「替电脑走」拿不出主意 ⇒ 真人座位的商店不会被服务器自动关掉
      expect(room.decideForCurrent()).toBeNull();
      // ③ 离店（下一条 action）⇒ 赠礼提示清掉，旁观端不会再说一次
      expect(submitBoth(room, mirror, topo, 0, { type: 'declineDecision' }).ok).toBe(true);
      expect(room.state.pending).toBeNull();
      expect(room.state.lastShopGift ?? null).toBeNull();
    }
    expect(kinds.size).toBeGreaterThanOrEqual(1);
  });

  run('★ 非董事長进店 ⇒ 没有框、没有提示（原版 `0x0042e977 jne 0x42ea2b` 直接跳到开窗）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const state0 = scene(map, 3);
    const state: GameState = { ...state0, commercialOwners: state0.commercialOwners.map((o) => ({ ...o, owner: 0 })) };
    const room = roomFrom(map, state);
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
    expect(room.state.pending?.kind).toBe('shop');
    expect(room.state.notices).toEqual([]);
    expect(room.state.lastShopGift ?? null).toBeNull();
  });

  /*
   * ★★ 2026-09-25（本轮订正）：**空袋也照弹框**。
   *
   * @source `0x0042e99a mov ebp,[ebx + 0x47feda]` / `0x0042e9b1 mov bl,[ebx + 0x47fedf]`（ebx = id*8）：
   *   道具名表本体是 `0x47fee2 + (id−1)*8`（取证见 `packages/data/src/tools.ts`），
   *   故 id = 0 读到的那一位**不在道具表里** —— 两张名表在 DGROUP 里首尾相接
   *   （卡片名表 30 项 + 0 号空位 = `0x47fdea..0x47fee2`）⇒ 别名到**卡片表末项**：
   *   `dump 0x47feda` = {name 0x00466b89「烏龜卡」, init 3, price 70} = 卡 30。
   *   两支 `je`/`jmp`（`0x42e984` / `0x42e9b7`）只挑送什么，框在 `0x42e9ea` 汇合后无条件走
   *   ⇒ 空袋那一拍照弹「送您烏龜卡！」、台词按 70 走中档（`0x0044f280`，**掷一次 rand**），
   *     手里一件不多。（对照：禮物格那一路 `0x41b91f test eax,eax / je 0x41c164` **有**这一道闸，
   *     空袋连框都不弹 —— 商店这一路没有那道闸。）
   */
  run('★ 空袋（道具 1..8 全 0）⇒ 也照弹框、照掷台词那一拍，手里一件不多；服务器与镜像一致', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const base = scene(map, 12);
    const state: GameState = {
      ...base,
      rngState: 2111915288, // 夹具取值：这一支恰好 `rand()&1 == 1`（道具那一支）
      toolStock: new Array<number>(base.toolStock.length).fill(0),
    };
    const room = roomFrom(map, state);
    const mirror = { s: state };
    expect(submitBoth(room, mirror, topo, 0, { type: 'settle' }).ok).toBe(true);
    expect(room.state.notices).toContainEqual(
      expect.objectContaining({ key: 'shop.chairmanGift', args: ['烏龜卡'] }),
    );
    expect(room.state.lastShopGift).toEqual({ kind: 'tool', id: 0, points: 70 });
    expect((room.state.lastSpeechRolls ?? []).map((r) => r.site)).toEqual([SPEECH_SITE.smallGain]);
    // 谁都没拿到（开局发的那六件照旧）
    expect(room.state.tools).toEqual(base.tools);
    expect(mirror.s.rngState).toBe(room.state.rngState);
    expect(room.state.pending?.kind).toBe('shop');
  });
});
