/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 联机：定序与一致性
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from '../state/reduce.ts';
import { decideAction } from '../ai/policy.ts';
import {
  fnv1a,
  isLobbySeatCount,
  LOBBY_DEFAULT_OPTIONS,
  LOBBY_MAX_SEATS,
  LOBBY_MIN_SEATS,
  LOBBY_OPTION_STEPS,
  LOBBY_VEHICLE_STEPS,
  lobbyOptionsError,
  PROTOCOL_VERSION,
  roomMapId,
  roomOptions,
  stateFingerprint,
  withLobbyDefaults,
  type ClientMessage,
  type LobbyOptions,
  type ServerMessage,
  isJoinMode,
  roomJoinability,
} from './protocol.ts';
import { Sequencer } from './sequencer.ts';
import { topoOf } from '../testing/factories.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const allComputer = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

describe('校验和', () => {
  it('FNV-1a 稳定且区分输入', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    expect(fnv1a('')).toHaveLength(8);
  });

  run('★ 同一状态指纹相同，任一规则量变化即不同', () => {
    const map = loadMap();
    const a = newGame({ map, players: allComputer(), seed: 5 });
    const b = newGame({ map, players: allComputer(), seed: 5 });
    expect(stateFingerprint(a)).toBe(stateFingerprint(b));

    const c = { ...a, players: a.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash + 1 } : p)) };
    expect(stateFingerprint(c)).not.toBe(stateFingerprint(a));
  });

  run('★ rngState 参与指纹——否则随机分歧发现不了', () => {
    const map = loadMap();
    const a = newGame({ map, players: allComputer(), seed: 5 });
    expect(stateFingerprint({ ...a, rngState: a.rngState + 1 })).not.toBe(stateFingerprint(a));
  });

  run('★ 规则相位的三项也参与指纹（第 50 条补：此前漏了）', () => {
    const map = loadMap();
    const a = newGame({ map, players: allComputer(), seed: 5 });
    // ① 惡人段游标
    expect(stateFingerprint({ ...a, pendingNpcSlots: [4] })).not.toBe(stateFingerprint(a));
    expect(stateFingerprint({ ...a, pendingNpcSlots: [4] })).toBe(
      stateFingerprint({ ...a, pendingNpcSlots: [4] }),
    );
    // ② 待决交互（落在特殊格上要求玩家做什么 —— 是规则，不是渲染）
    const buy = { kind: 'buyLand', landId: 3, name: 'X', price: 1000 };
    expect(stateFingerprint({ ...a, pending: buy })).not.toBe(stateFingerprint(a));
    expect(stateFingerprint({ ...a, pending: buy })).not.toBe(
      stateFingerprint({ ...a, pending: { ...buy, price: 1001 } }),
    );
    // ③ 排队的拍卖
    expect(stateFingerprint({ ...a, pendingQueue: [{ kind: 'auction', entityId: 1 }] })).not.toBe(
      stateFingerprint({ ...a, pendingQueue: [] }),
    );
  });

  run('★ 指纹对**键序**不敏感（C-DET-5：规范化 JSON）', () => {
    const map = loadMap();
    const a = newGame({ map, players: allComputer(), seed: 5 });
    // 同一对象，两组插入顺序不同 —— 规范化后必须同指纹
    const one = { kind: 'auction', entityId: 7, price: 100, bidders: [0, 2] };
    const two: Record<string, unknown> = {};
    for (const k of ['bidders', 'price', 'entityId', 'kind']) two[k] = (one as never)[k];
    expect(stateFingerprint({ ...a, pending: one })).toBe(stateFingerprint({ ...a, pending: two }));
    // 数组顺序**是**语义，不能规范化掉
    const three = { ...one, bidders: [2, 0] };
    expect(stateFingerprint({ ...a, pending: one })).not.toBe(
      stateFingerprint({ ...a, pending: three }),
    );
  });

  run('★★ `{ rng: false }`：与原版对轨迹时忽略 rngState，但其它分歧照抓', () => {
    const map = loadMap();
    const a = newGame({ map, players: allComputer(), seed: 5 });
    // rngState 分歧：默认抓得到，关掉后不抓
    const bent = { ...a, rngState: a.rngState + 999 };
    expect(stateFingerprint(bent)).not.toBe(stateFingerprint(a));
    expect(stateFingerprint(bent, { rng: false })).toBe(stateFingerprint(a, { rng: false }));
    // 但**规则量**的分歧在 rng:false 下依然要抓到
    const cash = { ...a, players: a.players.map((p, i) => (i === 0 ? { ...p, cash: p.cash + 1 } : p)) };
    expect(stateFingerprint(cash, { rng: false })).not.toBe(stateFingerprint(a, { rng: false }));
    const pending = { ...a, pending: { kind: 'buyLand', landId: 1 } };
    expect(stateFingerprint(pending, { rng: false })).not.toBe(stateFingerprint(a, { rng: false }));
  });

  run('★ 地产归属参与指纹', () => {
    const map = loadMap();
    const a = newGame({ map, players: allComputer(), seed: 5 });
    const owner = [...a.landOwner];
    owner[1] = 2;
    expect(stateFingerprint({ ...a, landOwner: owner })).not.toBe(stateFingerprint(a));
  });
});

describe('定序器', () => {
  const make = (current = () => 0, seats = 4) => {
    const s = new Sequencer({ seats, currentSeat: current });
    s.start();
    return s;
  };

  it('未开始时拒绝一切', () => {
    const s = new Sequencer({ seats: 4, currentSeat: () => 0 });
    expect(s.submit(0, { type: 'startTurn' }).reason).toBe('notRunning');
  });

  it('★ 序号从 0 开始严格连续', () => {
    const s = make();
    const seqs = [0, 1, 2].map(() => s.submit(0, { type: 'step' }).sequenced?.seq);
    expect(seqs).toEqual([0, 1, 2]);
    expect(s.length).toBe(3);
  });

  it('★ 非当前座位的意图被拒', () => {
    const s = make(() => 2);
    expect(s.submit(1, { type: 'step' })).toMatchObject({ accepted: false, reason: 'notYourTurn' });
    expect(s.submit(2, { type: 'step' }).accepted).toBe(true);
  });

  it('★ 被拒的意图不占序号', () => {
    const s = make(() => 0);
    s.submit(1, { type: 'step' }); // 拒
    expect(s.submit(0, { type: 'step' }).sequenced?.seq).toBe(0);
  });

  it('非法座位号被拒', () => {
    const s = make();
    expect(s.submit(-1, { type: 'step' }).reason).toBe('badSeat');
    expect(s.submit(9, { type: 'step' }).reason).toBe('badSeat');
    expect(s.submit(1.5, { type: 'step' }).reason).toBe('badSeat');
  });

  it('服务器代打不做回合校验，座位记为 -1', () => {
    const s = make(() => 3);
    expect(s.submitAsServer({ type: 'step' })?.seat).toBe(-1);
  });

  it('★ since() 补发——重连只需要 action 序列，不需要状态快照', () => {
    const s = make();
    for (let i = 0; i < 5; i++) s.submit(0, { type: 'step' });
    expect(s.since(3).map((e) => e.seq)).toEqual([3, 4]);
    expect(s.since(0)).toHaveLength(5);
  });
});

describe('★ 端到端：两个客户端重放同一串 action 得到同一状态', () => {
  run('模拟一局联机，双方指纹逐步一致', () => {
    const map = loadMap();
    const topo = topoOf(map);

    // 服务器下发的开局参数
    const seed = 4242;
    const mk = () => newGame({ map, players: allComputer(), seed, mode: 'multiplayer' });

    let authority = mk(); // 用来产出 action 的「当前回合方」
    let clientA = mk();
    let clientB = mk();

    const seq = new Sequencer({ seats: 4, currentSeat: () => authority.currentPlayer });
    seq.start();

    for (let i = 0; i < 800; i++) {
      const action = decideAction({ state: authority, map });
      if (action === null) break;
      const r = seq.submit(authority.currentPlayer, action);
      expect(r.accepted, `第 ${i} 步被拒：${r.reason}`).toBe(true);

      authority = reduce(authority, action, topo);
      clientA = reduce(clientA, action, topo);
      clientB = reduce(clientB, action, topo);

      if (authority.turnCount >= 25) break;
    }

    expect(authority.turnCount).toBeGreaterThan(5);
    expect(stateFingerprint(clientA)).toBe(stateFingerprint(authority));
    expect(stateFingerprint(clientB)).toBe(stateFingerprint(authority));
  });

  run('★ 掉线重连：从零重放 action 日志能追上', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const seed = 777;
    let live = newGame({ map, players: allComputer(), seed, mode: 'multiplayer' });
    const seq = new Sequencer({ seats: 4, currentSeat: () => live.currentPlayer });
    seq.start();

    for (let i = 0; i < 600; i++) {
      const a = decideAction({ state: live, map });
      if (a === null) break;
      seq.submit(live.currentPlayer, a);
      live = reduce(live, a, topo);
      if (live.turnCount >= 20) break;
    }

    // 一个全新的客户端只拿到日志
    let rejoin = newGame({ map, players: allComputer(), seed, mode: 'multiplayer' });
    for (const e of seq.since(0)) rejoin = reduce(rejoin, e.action, topo);

    expect(stateFingerprint(rejoin)).toBe(stateFingerprint(live));
  });

  run('★ Q-NET-1 失步自愈：全量重放能把漂掉的本地状态整体拉回', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
    const seed = 913;
    const mk = () => newGame({ map, players: allComputer(), seed, mode: 'multiplayer' });

    let live = mk();
    const seq = new Sequencer({ seats: 4, currentSeat: () => live.currentPlayer });
    seq.start();
    for (let i = 0; i < 400 && live.turnCount < 12; i++) {
      const a = decideAction({ state: live, map });
      if (a === null) break;
      seq.submit(live.currentPlayer, a);
      live = reduce(live, a, topo);
    }
    const serverFp = stateFingerprint(live);

    // 客户端「漏了一半 action」（或实现漂了）—— 指纹立刻对不上
    let broken = mk();
    let i = 0;
    for (const e of seq.since(0)) {
      if (i++ % 2 === 0) broken = reduce(broken, e.action, topo);
    }
    expect(stateFingerprint(broken)).not.toBe(serverFp);

    // 服务器回的 `replay` 是**从头**的整串：客户端在空局上重建（不是在 broken 上补）
    let healed = mk();
    for (const e of seq.since(0)) healed = reduce(healed, e.action, topo);
    expect(stateFingerprint(healed)).toBe(serverFp);
  });
});

describe('★ Q-NET-1 协议：resync / replay', () => {
  it('两条消息是协议的一部分（新增，不动 PROTOCOL_VERSION）', () => {
    const req: ClientMessage = { t: 'resync' };
    const rep: ServerMessage = {
      t: 'replay',
      options: LOBBY_DEFAULT_OPTIONS,
      seed: 1,
      globalMapId: 0,
      seats: [],
      through: -1,
      actions: [],
    };
    expect(req.t).toBe('resync');
    expect(rep.t).toBe('replay');
  });
});

describe('协议', () => {
  it('★ 版本号：W-73 +1、W-74 再 +1、第十一份回報 #1 再 +1、房間列表再 +1、聯機存檔再 +1', () => {
    // ⚠️ 这一条**不是**「为了变绿改断言」：任务书 W-73 §3 与 W-74 末尾各明写一次 `+1`。
    //    Q-NET-1 那次「加了消息但不动版本号」的理由（纯增量、语义没变）在这两次都不成立：
    //    · W-73：`join.clientId` 是**必填**，且「认回原座位」的判据从名字改成了它；
    //    · W-74：不发 `awaiting` 的老客户端，那一回合到点会被电脑接走 —— 推进方式变了。
    //    · 第十一份試玩回報 #1（大廳設置）：`start` 多带了 `options`（總人數/起始資金/載具/
    //      地產期限/時間/勝利條件），老客戶端不認識 ⇒ 會靜默吃下一局**規則不同**的對局。
    //    · 房間列表（2026-09-23）：多了 `listRooms`/`rooms`，`join` 多了 `mode` —— 老頁面拿著
    //      已解散的房間碼會把它重新建出來（自己當房主），得擋在門外。
    //    · 聯機存檔（2026-09-23）：`start`/`replay` 可能帶 `snapshot`（起點是存檔局面）與 `startDate`
    //      （服務器的今天）—— 老客戶端會照種子 / 缺省日期 `newGame`，第一條校驗和就失步。
    //    · 第十八份一批（2026-09-24）：商店貨架形狀、玩家延後落地、每回合可成交量、開局行情、
    //      拍賣資格 —— 同一串 action 新老客戶端算出不同局面，老頁面第一次落地 / 購物就失步。
    //    · gap-audit #7（2026-09-24）：多了纯演出的 `present`（亮牌 / 用卡失败 / 道具台词 / 选格取消）——
    //      老頁面不發也不認，同一桌新老頁面的用卡演出時序不同，得擋在門外。
    //    ⇒ 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
    expect(PROTOCOL_VERSION).toBe(8);
  });
});

// ============================================================
//  ★★ 第十一份試玩回報 #1：大廳的開局設定（人數 = 總人數）
// ============================================================

describe('★★ 大廳開局設定：範圍與補全', () => {
  it('★ 人數是 2..4 的整數（原版開局設定屏就只有 二人/三人/四人）', () => {
    expect(LOBBY_MIN_SEATS).toBe(2);
    expect(LOBBY_MAX_SEATS).toBe(4);
    for (const good of [2, 3, 4]) expect(isLobbySeatCount(good), String(good)).toBe(true);
    for (const bad of [0, 1, 5, 9, -1, 2.5, Number.NaN, '2', null, undefined]) {
      expect(isLobbySeatCount(bad), String(bad)).toBe(false);
    }
  });

  it('★ 逐項校验：一份全合法的 patch 過，任一項不合法就整份不過', () => {
    expect(lobbyOptionsError({})).toBeNull();
    expect(
      lobbyOptionsError({ seatCount: 3, fundIndex: 5, vehicle: 2, landTenure: 5, timeIndex: 5, victoryIndex: 5 }),
    ).toBeNull();

    // 一旦有一項坏掉，返回的是**那一条**的说明，而不是 null
    const bads: Partial<LobbyOptions>[] = [
      { seatCount: 1 },
      { seatCount: 5 },
      { fundIndex: -1 },
      { fundIndex: LOBBY_OPTION_STEPS },
      { vehicle: LOBBY_VEHICLE_STEPS },
      { vehicle: -1 },
      { landTenure: LOBBY_OPTION_STEPS },
      { timeIndex: LOBBY_OPTION_STEPS },
      { victoryIndex: LOBBY_OPTION_STEPS },
      { timeIndex: 1.5 },
    ];
    for (const bad of bads) {
      expect(typeof lobbyOptionsError(bad), JSON.stringify(bad)).toBe('string');
    }
  });

  it('★ 缺省值就是單機開局設定屏的初值（四人 / 30 萬 / 步行 / 無限期 / 不限時 / 無限）', () => {
    expect(LOBBY_DEFAULT_OPTIONS).toEqual({
      seatCount: 4,
      fundIndex: 0,
      vehicle: 0,
      landTenure: 0,
      timeIndex: 0,
      victoryIndex: 0,
    });
  });

  it('★ withLobbyDefaults 只補缺的，不覆盖给了的（半份 patch 不會被缺省值蓋掉）', () => {
    expect(withLobbyDefaults(undefined)).toEqual(LOBBY_DEFAULT_OPTIONS);
    expect(withLobbyDefaults({})).toEqual(LOBBY_DEFAULT_OPTIONS);
    expect(withLobbyDefaults({ seatCount: 2, fundIndex: 4 })).toEqual({
      ...LOBBY_DEFAULT_OPTIONS,
      seatCount: 2,
      fundIndex: 4,
    });
  });

  it('★ roomOptions / roomMapId：舊快照（沒有這兩個字段）照樣讀得出東西，不返回 undefined', () => {
    expect(roomOptions(null)).toEqual(LOBBY_DEFAULT_OPTIONS);
    expect(roomMapId(null)).toBe(0);
    const legacy = { id: 'r', seats: [], started: false };
    expect(roomOptions(legacy)).toEqual(LOBBY_DEFAULT_OPTIONS);
    expect(roomMapId(legacy)).toBe(0);

    const full = { ...legacy, globalMapId: 5, options: withLobbyDefaults({ seatCount: 3, victoryIndex: 2 }) };
    expect(roomOptions(full)).toEqual({ ...LOBBY_DEFAULT_OPTIONS, seatCount: 3, victoryIndex: 2 });
    expect(roomMapId(full)).toBe(5);
  });
});

describe('★ 房間列表（v5）：`join.mode` 與可加入判據', () => {
  it('`mode` 只認 create / join', () => {
    expect(isJoinMode('create')).toBe(true);
    expect(isJoinMode('join')).toBe(true);
    for (const bad of ['', 'Create', 'spectate', null, undefined, 1]) expect(isJoinMode(bad), String(bad)).toBe(false);
  });

  it('★ 重新連線優先於「已開局 / 已滿」；其次遊戲中；再其次已滿', () => {
    const base = { rejoin: false, started: false, humans: 1, seatCount: 4 };
    expect(roomJoinability(base)).toBe('join');
    expect(roomJoinability({ ...base, humans: 4 })).toBe('full');
    expect(roomJoinability({ ...base, humans: 5 })).toBe('full');
    expect(roomJoinability({ ...base, started: true })).toBe('playing');
    expect(roomJoinability({ ...base, started: true, humans: 4 })).toBe('playing');
    expect(roomJoinability({ ...base, rejoin: true, started: true, humans: 4 })).toBe('rejoin');
    expect(roomJoinability({ ...base, rejoin: true })).toBe('rejoin');
    // ★ v6：已開局的存檔房還有電腦代打的空座 ⇒ 認領；沒開局的不算（直接加入、進大廳點「這是我」）
    expect(roomJoinability({ ...base, started: true, vacant: [{}] })).toBe('claim');
    expect(roomJoinability({ ...base, started: false, vacant: [{}] })).toBe('join');
    expect(roomJoinability({ ...base, started: true, vacant: [{}], rejoin: true })).toBe('rejoin');
  });
});
