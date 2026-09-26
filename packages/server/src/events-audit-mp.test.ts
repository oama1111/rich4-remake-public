/*
 * 联机：events 区 provenance 审计（2026-09-24）改动的几条 —— 服务器与镜像逐字节同一条（指纹相同）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * - 魔法屋「立刻坐牢三天」过免罪卡（`0x00431e54 call 0x441210`）
 * - 魔法屋「就地拆除房屋」拆設施（`0x0043234c call 0x40ab4a(type,0)`）
 * - 真人保釋：点券 ≥ 赎金、被保者敌意 −max(天,1)×100×物價（`0x0043d0d4` / `0x0043cf21..0x0043cf4d`）
 * - 踩新聞格抽到地價稅、付不起当场破产（`0x0044a1e7..0x0044a215` → `0x41d375 call 0x40cd87`）
 *
 * ★ 第二轮（2026-09-25，FU-1 台词阶梯的 `rand()` 收进 core）：
 * - 新聞 19 房主那句（`0x0044ab00 call 0x456f2d`）与規則共用全局流 ⇒ 两端同一条流、同一个值；
 * - 命運 5 真人寿星：选牌窗**最后一位答完**那一条才掷（`0x0044c5ad`），前一帧不掷；
 * - `lastSpeechRolls` 是纯表现瞬态：**不在** `stateFingerprint` 的字段表里（`net/protocol.ts`）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOBBY_DEFAULT_OPTIONS,
  NEWS_OWNER_SITE,
  SPECIAL_KIND,
  SPEECH_SITE,
  WatcomRng,
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
const topoOf = (map: Map0) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});
const seats = (): SeatInfo[] => [0, 1, 2, 3].map((i) => ({ seat: i, name: `P${i}`, character: i, kind: 'human' as const }));

/** 服务器吃下一条 action，镜像照同一条 reduce，两边指纹必须相同 */
function mirrorOnce(map: Map0, state: GameState, seat: number, action: Action, id: string) {
  const topo = topoOf(map);
  const room = new Room({ id, map, globalMapId: 0, seed: 5, seats: seats(), options: LOBBY_DEFAULT_OPTIONS, base: { state, snapshot: '' } });
  room.start();
  const r = room.submit(seat, action);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error('rejected');
  const mirror = reduce(state, r.broadcast.action, topo);
  expect(stateFingerprint(mirror)).toBe(room.fingerprint);
  return { room, mirror };
}

/**
 * 抹掉 / 换掉 `lastSpeechRolls` 的一份拷贝，用来钉「它不进指纹」。
 *
 * 先落成变量再传是**必须**的：`stateFingerprint` 的形参类型是一张**显式的字段白名单**
 * （`net/protocol.ts:798` 起），多带一个 `lastSpeechRolls` 的对象字面量连编译都过不了
 * —— TS 的多余属性检查（TS2353）本身就是「它不在指纹字段表里」的第一道证据，
 * 第二道是下面那两条「指纹不变」的断言。
 */
function withoutRolls(s: GameState, rolls: GameState['lastSpeechRolls'] = null): GameState {
  return { ...s, lastSpeechRolls: rolls };
}

describe('★★ 联机：events 区审计改动两端一致', () => {
  run('魔法屋「立刻坐牢三天」点到持免罪卡的人 ⇒ 扣卡、不关；敌意照记', () => {
    const map = loadMap();
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const node = map.nodes.find((n) => n.walkable && n.adjacent.length === 2)!;
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 0, targets: [0] },
      players: base.players.map((p, i) => ({ ...p, whoPlays: 1, nodeId: node.id, cards: i === 0 ? [21] : [] })),
    };
    const { room, mirror } = mirrorOnce(map, state, 1, { type: 'magicHouse', option: 2 }, 'EVAUD1');
    expect(room.state.players[0]!.cards).toEqual([]);
    expect(room.state.players[0]!.blocking.inPrison).toBe(0);
    expect(room.state.players[0]!.hostility[1]).toBeGreaterThan(0);
    expect(mirror.players[0]).toEqual(room.state.players[0]);
  });

  run('魔法屋「就地拆除房屋」站在 1 级設施上 ⇒ 0 级、种类清 0', () => {
    const map = loadMap();
    const facNode = map.nodes.find((n) => n.ref.kind === 'facility')!;
    const fid = (facNode.ref as { index: number }).index;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const facilityOwner = [...base.facilityOwner];
    const facilityLevel = [...base.facilityLevel];
    const facilityType = [...base.facilityType];
    facilityOwner[fid] = 3;
    facilityLevel[fid] = 1;
    facilityType[fid] = 2;
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'turnEnd',
      facilityOwner,
      facilityLevel,
      facilityType,
      pending: { kind: 'magicHouse', criterion: 0, targets: [0] },
      players: base.players.map((p) => ({ ...p, whoPlays: 1, nodeId: facNode.id })),
    };
    const { room } = mirrorOnce(map, state, 1, { type: 'magicHouse', option: 9 }, 'EVAUD2');
    expect(room.state.facilityLevel[fid]).toBe(0);
    expect(room.state.facilityType[fid]).toBe(0);
  });

  run('真人保釋 1 号：30 點券够、1 号对我敌意 −天×100×物價', () => {
    const map = loadMap();
    const square = map.nodes.find((n) => n.specialKind === 4)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const occ = [...base.prisonOccupancy];
    occ[1] = 1;
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'awaitingDecision',
      prisonOccupancy: occ,
      pending: { kind: 'bail', place: 'prison', candidates: [], points: 30 },
      players: base.players.map((p, i) => {
        const q = { ...p, whoPlays: 1, nodeId: square.id, points: i === 0 ? 30 : p.points };
        if (i !== 1) return q;
        const hostility = [...q.hostility];
        hostility[0] = 5000;
        return { ...q, hostility, blocking: { ...q.blocking, inPrison: 2 } };
      }),
    };
    const { room } = mirrorOnce(map, state, 0, { type: 'bail', slot: 1 }, 'EVAUD3');
    expect(room.state.players[0]!.points).toBe(0);
    expect(room.state.players[1]!.hostility[0]).toBe(5000 - 2 * 100 * room.state.priceIndex);
  });

  run('踩新聞格抽到地價稅：没钱的地主当场破产（拍卖的随机流两端一致）', () => {
    const map = loadMap();
    const square = map.nodes.find((n) => n.specialKind === 2)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const landOwner = [...base.landOwner];
    // 1 号名下三块地；他身上一分钱没有
    for (const id of [1, 2, 3]) landOwner[id] = 2;
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'settling',
      landOwner,
      newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: 12 },
      players: base.players.map((p, i) => ({
        ...p,
        whoPlays: 1,
        nodeId: i === 0 ? square.id : p.nodeId || 1,
        cash: i === 1 ? 0 : 50_000,
        moneyInBank: 0,
      })),
    };
    const { room } = mirrorOnce(map, state, 0, { type: 'settle' }, 'EVAUD4');
    expect(room.state.lastEvent).toMatchObject({ kind: 'news', id: 12 });
    expect(room.state.players[1]!.whoPlays).toBe(0);
  });

  // ============================================================
  //  ★★ 第二轮（FU-1）：台词阶梯里的 `rand()` 收进 core
  // ============================================================

  run('★★ 新聞 19「山洪」挑中一处有主 ⇒ 房主那句 rand 由 core 掷：两端指纹相同、恰扣一步、不进指纹', () => {
    const map = loadMap();
    const square = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.NEWS)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    /**
     * 全部地块 / 設施都归 `owner`（1 基；0 = 无主）⇒ 新聞 19 的候选集与挑中的下标与 `owner` 无关
     * （候选是「全部」，`rand()%n` 那一次照样掷），**只有房主那句掷不掷**随它变 ——
     * 于是「有主」与「无主」两份局面差的恰好是那一次台词 `rand()`。
     */
    const scene = (owner: number): GameState => ({
      ...base,
      currentPlayer: 0,
      phase: 'settling',
      landOwner: base.landOwner.map(() => owner),
      facilityOwner: base.facilityOwner.map(() => owner),
      // 牌堆拨到「下一张就是 19」（19 恒可行，见 `isNewsFeasible`）
      newsDeck: { order: Array.from({ length: 36 }, (_, i) => i), cursor: 19 },
      players: base.players.map((p, i) => ({ ...p, whoPlays: 1, nodeId: i === 0 ? square.id : p.nodeId || 1 })),
    });
    const state = scene(2);
    const { room, mirror } = mirrorOnce(map, state, 0, { type: 'settle' }, 'EVAUD5');

    expect(room.state.lastEvent).toMatchObject({ kind: 'news', id: 19 });
    expect((room.state.lastEvent as { place?: { owner: number } }).place?.owner).toBe(2);
    // 房主 = 2（1 基）⇒ 说话人下标 1、站点 = 新聞 19 那一次 `call 0x456f2d`
    expect(room.state.lastSpeechRolls).toEqual([
      { site: NEWS_OWNER_SITE.get(19)!, player: 1, value: expect.any(Number) },
    ]);

    // ① 两端同一条流（`rngState` 在指纹里）、同一个值
    expect(mirror.rngState).toBe(room.state.rngState);
    expect(mirror.lastSpeechRolls).toEqual(room.state.lastSpeechRolls);

    // ② 这一步确实从全局流里扣掉了：房主改成 0（原版这一档不说，其余完全同路）
    const silent = reduce(scene(0), { type: 'settle' }, topoOf(map));
    expect(silent.lastSpeechRolls ?? null).toBeNull();
    const rng = new WatcomRng();
    rng.setState(silent.rngState);
    expect(rng.next()).toBe(room.state.lastSpeechRolls![0]!.value);
    expect(rng.getState()).toBe(room.state.rngState);

    // ③ 纯表现瞬态：`stateFingerprint`（`net/protocol.ts`）**显式列出**参与校验的字段，里面没有
    //    `lastSpeechRolls` —— 抹掉 / 换掉它指纹不变 ⇒ 旁观端、断线重连端缺了这份提示也不会被判失步。
    expect(stateFingerprint(withoutRolls(room.state))).toBe(room.fingerprint);
    expect(stateFingerprint(withoutRolls(room.state, []))).toBe(room.fingerprint);
  });

  run('★★ 命運 5 真人寿星：选牌窗最后一位答完那一条才掷台词 rand，三帧两端一致', () => {
    const map = loadMap();
    const square = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.FORTUNE)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const state: GameState = {
      ...base,
      currentPlayer: 0,
      phase: 'settling',
      pending: null,
      // 牌堆拨到「下一张就是 5」（他人手牌和 ≥ 1 ⇒ 可行）
      fortuneDeck: { order: [5, ...base.fortuneDeck.order.filter((x) => x !== 5)], cursor: 0 },
      players: base.players.map((p, i) => ({
        ...p,
        whoPlays: i === 3 ? 0 : 1, // 3 号出局 ⇒ 不合格
        nodeId: i === 0 ? square.id : p.nodeId || 1,
        cards: i === 1 ? [3, 7] : i === 2 ? [9] : [],
      })),
    };
    // 帧 1：抽到命運 5 ⇒ 真人寿星挂出选牌窗（一位都还没收）
    const f1 = mirrorOnce(map, state, 0, { type: 'settle' }, 'EVAUD6');
    expect(f1.room.state.lastEvent).toMatchObject({ kind: 'fortune', id: 5 });
    expect(f1.room.state.pending).toMatchObject({ kind: 'birthdayCard', seats: [1, 2] });
    expect(f1.room.state.lastSpeechRolls ?? null).toBeNull();
    // 帧 2：只收了一半，仍不说（`0x0044c57b` 那个 `edi` 还没数到最后一个）
    const f2 = mirrorOnce(map, f1.room.state, 0, { type: 'birthdayCard', seat: 1, cardId: 7 }, 'EVAUD6');
    expect(f2.room.state.pending).toMatchObject({ kind: 'birthdayCard', seats: [2] });
    expect(f2.room.state.lastSpeechRolls ?? null).toBeNull();
    // 帧 3：最后一位答完 ⇒ `0x0044c5ad call rand`，说话人 = 寿星 0
    const f3 = mirrorOnce(map, f2.room.state, 0, { type: 'birthdayCard', seat: 2, cardId: 9 }, 'EVAUD6');
    expect(f3.room.state.pending).toBeNull();
    expect(f3.room.state.lastSpeechRolls).toEqual([
      { site: SPEECH_SITE.birthday, player: 0, value: expect.any(Number) },
    ]);
    expect(f3.mirror.lastSpeechRolls).toEqual(f3.room.state.lastSpeechRolls);
    // 这一条 action 里就掷这一次（收卡 / 牌堆记账都不掷）⇒ 从帧 2 的流走一步恰好到帧 3 的流
    const rng = new WatcomRng();
    rng.setState(f2.room.state.rngState);
    expect(rng.next()).toBe(f3.room.state.lastSpeechRolls![0]!.value);
    expect(rng.getState()).toBe(f3.room.state.rngState);
    // 同上：不进指纹
    expect(stateFingerprint(withoutRolls(f3.room.state))).toBe(f3.room.fingerprint);
  });

  run('★★ 魔法屋「抽取命運三張」抽中真人寿星 ⇒ 选牌窗挂 pending、答完从原循环接着抽（FU-3 两端一致）', () => {
    const map = loadMap();
    const node = map.nodes.find((n) => n.walkable && n.adjacent.length === 2)!;
    const base = newGame({ map, players: seats().map((s) => ({ character: s.character, kind: s.kind })), seed: 5, mode: 'multiplayer' });
    const state: GameState = {
      ...base,
      currentPlayer: 1,
      phase: 'turnEnd',
      // 施法者 1 号点了「抽取命運三張」，中签者只有 0 号
      pending: { kind: 'magicHouse', criterion: 0, targets: [0] },
      fortuneDeck: { order: [5, ...base.fortuneDeck.order.filter((x) => x !== 5)], cursor: 0 },
      players: base.players.map((p, i) => ({
        ...p,
        whoPlays: i === 3 ? 0 : 1, // 3 号出局 ⇒ 不合格
        nodeId: node.id,
        cards: i === 1 ? [3, 7] : i === 2 ? [9] : [],
      })),
    };
    // 帧 1：第一张就抽到命運 5、中签者 0 是真人寿星 ⇒ 选牌窗挂出来，循环**停在**这里
    //   （`0x00431dbc` 的 `ebx` 还没走完；剩余张数与施法者挂在 pending 上）
    const f1 = mirrorOnce(map, state, 1, { type: 'magicHouse', option: 1 }, 'EVAUD7');
    expect(f1.room.state.pending).toMatchObject({
      kind: 'birthdayCard',
      seats: [1, 2],
      receiver: 0,
      magicResume: { caster: 1, criterion: 0, option: 1, targets: [0], drawsLeft: 2 },
    });
    expect(f1.room.state.currentPlayer).toBe(0);
    expect(f1.room.state.lastSpeechRolls ?? null).toBeNull();
    // 帧 2：最后一位答完 ⇒ 掷寿星那句，并**回到那个循环**把剩下两张抽完
    const f2 = mirrorOnce(map, f1.room.state, 0, { type: 'birthdayCard', seat: 1, cardId: 7 }, 'EVAUD7');
    const f3 = mirrorOnce(map, f2.room.state, 0, { type: 'birthdayCard', seat: 2, cardId: 9 }, 'EVAUD7');
    expect(f3.room.state.pending?.kind).not.toBe('birthdayCard');
    const rolls = f3.room.state.lastSpeechRolls ?? [];
    expect(rolls).toContainEqual({ site: SPEECH_SITE.birthday, player: 0, value: expect.any(Number) });
    expect(f3.mirror.lastSpeechRolls).toEqual(rolls);
    // 抽完两张 ⇒ 施法者的回合收尾，中签者不再被留在当前玩家位上（`0x004324fa` 还原施法者）
    expect(f3.room.state.phase).toBe('turnEnd');
    expect(f3.room.state.pending).toBeNull();
    // ★ 剩下那两张**确实接着抽了**（`0x00431dc1 inc ebx / cmp ebx,3`）：命運牌堆游标继续往前走
    //   （抽到不可行的会多跳几格，故只比大小；先前那一版答完就收尾，游标停在这里）
    expect(f1.room.state.fortuneDeck.cursor).toBe(1);
    expect(f3.room.state.fortuneDeck.cursor).toBeGreaterThan(f1.room.state.fortuneDeck.cursor);
    // 纯表现：整份瞬态不进指纹
    expect(stateFingerprint(withoutRolls(f3.room.state))).toBe(f3.room.fingerprint);
  });
});
