/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 破产与终局接入 reducer —— M2 验收「完整跑完一局至破产结算」
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame as newGameRaw } from '../rules/new-game.ts';
import { landAll } from '../testing/factories.ts';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_DEAD, WHO_PLAYS_HUMAN, isAlive } from './types.ts';
import { applyBankruptcy, applyMagicRequest, gameOverCode, isGameOver, reduce } from './reduce.ts';
import { decideAction } from '../ai/policy.ts';
import { WatcomRng } from '../rng/watcom.ts';
import type { GameState } from './types.ts';

/**
 * 夹具：「第一輪已经过去」—— 这里测的不是开局，要的是大家都已在盘上
 * （`newGame` 只摆第 1 位，其余轮到自己才落地，见 `rules/start-placement.ts`）。
 */
const newGame = (o: Parameters<typeof newGameRaw>[0]): ReturnType<typeof newGameRaw> =>
  landAll(newGameRaw(o), o.map.nodes);

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
// ★ 2026-09-24 审计：0 号是真人。原版破产后数的是**在场真人**（`0x0040d029 test esi, esi`），
//   全电脑的局第一次破产就收局（码 1）—— 清算 / 拍卖那几条要在「还有真人在场」的局里测。
const players = (n = 4) =>
  Array.from({ length: n }, (_, i) => ({ character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) }));

const fresh = (n = 4): GameState => newGame({ map: loadMap(), players: players(n), seed: 1 });

describe('破产标记', () => {
  run('★★ 破产要腾出监狱/医院的床位（原版 `0x40ce22`/`0x40ce28`）', () => {
    // 1 号在狱（监狱表 1 号格）、2 号在医院（医院表 2 号格）
    const s: GameState = {
      ...fresh(),
      prisonOccupancy: [0, 1, 0, 0, 0, 0, 0, 0],
      hospitalOccupancy: [0, 0, 1, 0, 0, 0, 0, 0],
    };
    const after = applyBankruptcy(s, 1);
    expect(after.prisonOccupancy[1]).toBe(0);      // ★ 自己那格清掉
    expect(after.hospitalOccupancy[1]).toBe(0);    // ★ 两张都清（即便当时不在医院）
    expect(after.hospitalOccupancy[2]).toBe(1);    // 别人的床位不动
  });

  run('★★ 第十八份：破产先把贴图坐标按所在格重同步（住店时的旅館坐标不留下）@source 0x0040cdb0..0x0040cde4', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
    const base = fresh();
    const node = map.nodes.find((n) => n.id === base.players[1]!.nodeId)!;
    const s: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === 1 ? { ...p, xpos: node.x + 24, ypos: node.y + 71, blocking: { ...p.blocking, inHotel: 0x80 } } : p,
      ),
    };
    const after = applyBankruptcy(s, 1, topo);
    expect([after.players[1]!.xpos, after.players[1]!.ypos]).toEqual([node.x, node.y]);
    expect(after.players[1]!.blocking.inHotel).toBe(0);
  });

  run('出局者 whoPlays 归零、现金清空', () => {
    const s = applyBankruptcy(fresh(), 1);
    expect(isAlive(s.players[1]!)).toBe(false);
    expect(s.players[1]!.cash).toBe(0);
    expect(s.players[1]!.moneyInBank).toBe(0);
  });

  run('不影响其他玩家', () => {
    const before = fresh();
    const s = applyBankruptcy(before, 1);
    expect(s.players[0]!.cash).toBe(before.players[0]!.cash);
  });

  run('已出局者再破产不变', () => {
    const s = applyBankruptcy(fresh(), 1);
    expect(applyBankruptcy(s, 1)).toBe(s);
  });
});

describe('★ 樂透号码无论哪条路径都要释放', () => {
  run('名下号码被清空', () => {
    const base = fresh();
    const lottery = [...base.lottery];
    lottery[3] = 2; // 玩家1 持有
    lottery[9] = 1; // 玩家0 持有
    const s = applyBankruptcy({ ...base, lottery }, 1);
    expect(s.lottery[3]).toBe(0);
    expect(s.lottery[9]).toBe(1); // 别人的不动
  });
});

describe('★ 终局路径会跳过清算 —— 地产原样留着', () => {
  run('只剩一人时破产者仍持有地产', () => {
    const base = fresh();
    // 先让两人出局，只剩玩家 0 与 1
    let s: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i >= 2 ? { ...p, whoPlays: WHO_PLAYS_DEAD } : p,
      ),
    };
    const landOwner = [...s.landOwner];
    landOwner[1] = 2; // 玩家1 有一块地
    s = { ...s, landOwner };

    const after = applyBankruptcy(s, 1);
    expect(after.phase).toBe('gameOver');
    // ★ 地产没有被清算——与 Save0.dat 的实证一致
    expect(after.landOwner[1]).toBe(2);
  });

  run('★ 非终局路径则正常清算', () => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    landOwner[1] = 2;
    const s = applyBankruptcy({ ...base, landOwner }, 1);
    expect(s.phase).not.toBe('gameOver');
    expect(s.landOwner[1]).toBe(0); // 被释放
  });
});

/**
 * 破产清算的**下線拍卖**。
 *
 * @source 破产处理 VA 0x0040d1c6..0x0040d20f（见 `state/reduce.ts` 的
 *   `queueBankruptcyAuctions`）。三条要点：只有释放 **> 3** 处才拍、
 *   只拍 **3** 场、地块与設施共用一张候选表。
 */
/**
 * 破产清算里**地产/設施的释放**（逐条对着汇编）。
 *
 * @source 破产处理 VA 0x0040d089..0x0040d137：
 * ```asm
 * 0040d0a2  mov dl, byte [eax + 0x19]      ; owner
 * 0040d0ad  cmp edx, 玩家+1
 * 0040d0b1  mov byte [eax + 0x19], 0       ; ★ 只清归属
 * 0040d0b5  mov dword [eax + 0x30], 0      ; ★ 地契到期日（4 字节）一并清零
 * 0040d0f2  mov byte [eax + 0x19], 0       ; 設施同形
 * 0040d0f6  mov dword [eax + 0x34], 0      ; ★ 設施的到期日在 +0x34
 * 0040d122  movzx edi, byte [eax + 0x18]   ; 企业：owner 字段在 +0x18
 * 0040d132  mov byte [eax + 0x18], 0
 * ```
 * ⚠️ 等级（`+0x1a`）**一个字都不动** —— 房子留在原地等着被拍卖。
 */
describe('★ 破产清算的地产释放', () => {
  const topo = () => {
    const map = loadMap();
    return { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
  };

  run('地块：归属清零、到期日清零、★等级保留', () => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    const landTenure = [...base.landTenure];
    const landLevel = [...base.landLevel];
    landOwner[3] = 2; // 玩家1
    landTenure[3] = 0x07e5_060f;
    landLevel[3] = 4;
    const s = applyBankruptcy({ ...base, landOwner, landTenure, landLevel }, 1, topo());
    expect(s.landOwner[3]).toBe(0);
    expect(s.landTenure[3], '地契到期日必须清').toBe(0);
    expect(s.landLevel[3], '★ 等级保留（房子等拍卖）').toBe(4);
  });

  run('設施：归属清零、到期日清零（+0x34）', () => {
    const base = fresh();
    const facilityOwner = [...base.facilityOwner];
    const facilityTenure = [...base.facilityTenure];
    facilityOwner[1] = 2;
    facilityTenure[1] = 0x07e5_060f;
    const s = applyBankruptcy({ ...base, facilityOwner, facilityTenure }, 1, topo());
    expect(s.facilityOwner[1]).toBe(0);
    expect(s.facilityTenure[1], '設施到期日在 +0x34，也要清').toBe(0);
  });

  run('只动破产者的资产', () => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    landOwner[1] = 1; // 玩家0
    landOwner[2] = 2; // 玩家1（破产）
    landOwner[3] = 3; // 玩家2
    const s = applyBankruptcy({ ...base, landOwner }, 1, topo());
    expect(s.landOwner.slice(1, 4)).toEqual([1, 0, 3]);
  });

  run('不原地修改入参', () => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    landOwner[1] = 2;
    const before = JSON.stringify(landOwner);
    applyBankruptcy({ ...base, landOwner }, 1, topo());
    expect(JSON.stringify(landOwner)).toBe(before);
  });
});

describe('★ 破产清算的下線拍卖', () => {
  /** 把 topo 摆成「玩家 1 名下有 n 块地，其余人还活着」 */
  const withLands = (n: number): GameState => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    for (let i = 1; i <= n; i++) landOwner[i] = 2; // 玩家1（下标 1）
    return { ...base, landOwner };
  };
  const topo = () => {
    const map = loadMap();
    return { nodes: map.nodes, lands: map.lands };
  };

  run('释放 ≤ 3 处：一场都不拍', () => {
    // @source cmp esi, 3 / jle 0x40d211
    for (const n of [1, 2, 3]) {
      const s = applyBankruptcy(withLands(n), 1, topo());
      expect(s.pending, `释放 ${n} 处不该开拍`).toBe(null);
      expect(s.pendingQueue).toEqual([]);
    }
  });

  run('释放 > 3 处：开拍，抽签与开拍交错（★ AUC-43：队列里只有「下一抽」）', () => {
    const s = applyBankruptcy(withLands(5), 1, topo());
    expect(s.pending?.kind).toBe('auction');
    // ★★ AUC-43（`0x0040d1d7` ↔ `0x0040d1e3`）：原版**抽一处就开一场**（开拍自己还要掷
    //   心理价位的 rand），那一场跑完才回来抽下一处。所以队列里不会有「已经抽好的下一场」，
    //   只有一个「下一抽」的待办 —— 它在前一场落槌后才真正掷 rand。
    expect(s.pendingQueue.length).toBe(1);
    expect(s.pendingQueue[0]?.kind).toBe('bankruptcyDraw');
    expect(s.phase).toBe('awaitingDecision');
    // 三场连打：每一场落槌后自动接上下一抽
    const first = s.pending;
    expect(first?.kind).toBe('auction');
    const opened: number[] = [first?.kind === 'auction' ? first.entityId : 0];
    let cur = s;
    for (let i = 0; i < 2; i++) {
      cur = reduce(cur, { type: 'auction', winner: 0, price: 0 }, topo());
      const p = cur.pending;
      expect(p?.kind).toBe('auction');
      opened.push(p?.kind === 'auction' ? p.entityId : 0);
    }
    expect(new Set(opened).size, '三场不重复（抽到就划掉）').toBe(3);
    cur = reduce(cur, { type: 'auction', winner: 0, price: 0 }, topo());
    expect(cur.pendingQueue).toEqual([]);
  });

  run('★★ AUC-43：抽签与原版同序 —— 每一抽都发生在**前一场开拍之后**', () => {
    // 夹具：0 号真人、1 号破产者（名下 5 块地）、2/3 号电脑。
    // 在座出价者里两位都是电脑 ⇒ **每场开拍正好掷四次** rand（`auctionAiLimit` 的
    // `rand()/32767` 与 `rand()/65536` 两个系数 × 两家，`0x439f0d` 那一段，每家两次）。
    const base = withLands(5);
    const s = applyBankruptcy(base, 1, topo());
    // 交错的模型（原版 0x40d1d7..0x40d20f）：抽一处（空槽重抽）→ 开拍（2×2 次 rand）→ 再抽
    const model = new WatcomRng();
    model.setState(base.rngState);
    const slots = [0, 1, 2, 3, 4];
    const picked: number[] = [];
    for (let round = 0; round < 3; round++) {
      let at = -1;
      do {
        at = model.next() % slots.length;
      } while (slots[at] === 0);
      slots[at] = 0;
      picked.push(at);
      // 开拍：在座的**每一位电脑**座位各掷两次（心理价位系数 + 缺地系数）
      for (let k = 0; k < 4; k++) model.next();
    }
    // 地块 id = 下标 + 1（`withLands` 铺的是 landOwner[1..5]）⇒ `pending.entityId` 就是那个 id
    const expected = picked.map((i) => i + 1);
    let cur = s;
    const opened: number[] = [];
    for (let round = 0; round < 3; round++) {
      expect(cur.pending?.kind).toBe('auction');
      opened.push(cur.pending?.kind === 'auction' ? cur.pending.entityId : -1);
      cur = reduce(cur, { type: 'auction', winner: -1, price: 0 }, topo());
    }
    expect(opened, '抽签次序 = 交错模型（旧「三抽在前」在这个夹具上是 2,5,3）').toEqual(expected);
    expect(cur.rngState, '整条随机流也逐位对上').toBe(model.getState());
  });

  run('★ 只拍 3 场 —— 剩下的地仍然无主', () => {
    const s = applyBankruptcy(withLands(6), 1, topo());
    // 逐场落槌（成交价 0，免得中标者付不起又触发另一轮破产）
    let cur = s;
    let auctions = 0;
    while (cur.pending !== null && cur.pending.kind === 'auction' && auctions < 10) {
      auctions++;
      cur = reduce(cur, { type: 'auction', winner: 0, price: 0 }, topo());
    }
    expect(auctions, '恰好 3 场').toBe(3);
    expect(cur.pendingQueue).toEqual([]);
    // 6 块里被抽中 3 块易主（归玩家 0），其余 3 块保持无主
    const owned = cur.landOwner.filter((v, i) => i >= 1 && i <= 6 && v === 1).length;
    const free = cur.landOwner.filter((v, i) => i >= 1 && i <= 6 && v === 0).length;
    expect(owned + free).toBe(6);
    expect(owned).toBe(3);
  });

  run('★ 成交款进公库（卖方 = -1）', () => {
    const s = applyBankruptcy(withLands(4), 1, topo());
    const before = s.pool;
    const cur = reduce(s, { type: 'auction', winner: 0, price: 1234 }, topo());
    expect(cur.pool).toBe(before + 1234);
  });

  run('拍卖流拍（无人出价）也算一场，队列照常接续', () => {
    const s = applyBankruptcy(withLands(4), 1, topo());
    expect(s.pending?.kind).toBe('auction');
    // winner = -1 即流拍：地产保持无主
    const cur = reduce(s, { type: 'auction', winner: -1, price: 0 }, topo());
    expect(cur.pending?.kind).toBe('auction'); // 第二场已自动接上
    expect(cur.pendingQueue.length).toBe(1);
  });
});

/**
 * 魔法屋的「拍賣」结果。
 *
 * @source 魔法屋 VA 0x0043242b..0x004324d5（见 `state/reduce.ts` 的
 *   `applyMagicRequest` 的 `case 'auction'`）：拍的是**中签者脚下那一格**的产业，
 *   卖方席位是他自己（成交款归他）。
 */
describe('★ 魔法屋「拍賣」结果真的开拍', () => {
  run('站在自己的地上 → 拍卖这块地，卖方是他自己', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const base = fresh();
    // 找一格是地块的节点，把玩家 2 摆上去、并把那块地判给他
    const node = map.nodes.find((n) => n.ref.kind === 'land');
    if (node === undefined) return;
    const landIndex = node.ref.kind === 'land' ? node.ref.index : 0;
    const players = base.players.map((p, i) => (i === 2 ? { ...p, nodeId: node.id } : p));
    const landOwner = [...base.landOwner];
    landOwner[landIndex] = 3; // 玩家2
    const s = applyMagicRequest({ ...base, players, landOwner }, topo, {
      player: 2,
      kind: 'auction',
      amount: 1,
    });
    expect(s.pending?.kind).toBe('auction');
    if (s.pending?.kind !== 'auction') return;
    expect(s.pending.entityId).toBe(landIndex);
    expect(s.pending.seller).toBe(2);
  });

  run('站在非产业格（如公園）→ 什么都不做', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const base = fresh();
    const park = map.nodes.find((n) => n.ref.kind !== 'land' && n.ref.kind !== 'facility');
    if (park === undefined) return;
    const players = base.players.map((p, i) => (i === 2 ? { ...p, nodeId: park.id } : p));
    const s = applyMagicRequest({ ...base, players }, topo, {
      player: 2,
      kind: 'auction',
      amount: 1,
    });
    expect(s.pending).toBe(null);
  });
});

/**
 * ★ 破产清算开的拍卖必须**有人能答**，哪怕此刻的 `currentPlayer` 已经出局。
 *
 * 竞价轮转判的是 `pending.seat`（原版四家轮流举牌，整场挂在开拍那方的回合里），
 * 与「轮到谁」无关。先前 `decideAction` 把这一支放在了 `isAiTurn` 之后，
 * 于是「破产者已出局却还是 currentPlayer」时直接返回 null，
 * 整局**停在 awaitingDecision**（实测种子 42 第 1236 回合）。
 */
describe('★ 破产者的拍卖不会卡死', () => {
  run('currentPlayer 已出局，竞价照样由电脑玩家答出', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities };
    const base = fresh();
    // 玩家 0 出局（他正是 currentPlayer），玩家 1 名下有 4 块地 → 触发下線拍卖
    // 3 号换成**託管的真人**（1|4）：0 号（唯一的真人）出局后还得有真人在场，否则原版直接收局
    //   （0x0040d029 数的是 `who_plays & 1`，託管也算）；託管照样由 `decideAction` 替他举牌
    const players = base.players.map((p, i) =>
      i === 0 ? { ...p, whoPlays: WHO_PLAYS_DEAD } : i === 3 ? { ...p, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT } : p,
    );
    const landOwner = [...base.landOwner];
    for (let i = 1; i <= 4; i++) landOwner[i] = 2;
    const s = applyBankruptcy({ ...base, players, landOwner }, 1, topo);

    expect(s.currentPlayer).toBe(0);
    expect(isAlive(s.players[0]!)).toBe(false);
    expect(s.pending?.kind).toBe('auction');
    const a = decideAction({ state: s, map });
    expect(a?.type, '竞价不能因为「不是我的回合」就没人答').toBe('auctionBid');
  });
});

describe('★ 破产清算的企业归属', () => {
  run('名头挂着董事长、却一股不剩时也要清掉', () => {
    // @source 破产清算 0x40d10d..0x0040d137：只看 commercial+0x18 == 玩家+1，不看持股
    const base = fresh();
    const commercialOwners = base.commercialOwners.map((o, i) =>
      i === 1 ? { ...o, owner: 2 } : o,
    );
    const s = applyBankruptcy({ ...base, commercialOwners }, 1, {
      nodes: loadMap().nodes,
      lands: loadMap().lands,
    });
    const c = s.commercialOwners[1];
    // 一股不剩 ⇒ 没人接手重排，就停在原版清出来的 0
    expect(c?.owner, '破产者挂名的企业必须脱手').toBe(0);
    // 别的企业不动
    expect(s.commercialOwners[0]?.owner).toBe(base.commercialOwners[0]?.owner);
  });
});

describe('终局判定', () => {
  run('四人在场时未结束', () => {
    const s = fresh();
    expect(isGameOver(s)).toBe(false);
    expect(gameOverCode(s)).toBe(0);
  });

  run('★ 只剩一人即结束', () => {
    const base = fresh();
    const s: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? p : { ...p, whoPlays: WHO_PLAYS_DEAD })),
      phase: 'gameOver',
    };
    expect(isGameOver(s)).toBe(true);
    expect(gameOverCode(s)).toBe(2);
  });

  run('★ 全员出局给出终局码 1', () => {
    const base = fresh();
    const s: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, whoPlays: WHO_PLAYS_DEAD })),
      phase: 'gameOver',
    };
    expect(gameOverCode(s)).toBe(1);
  });
});

describe('★ 审计订正：真人全出局即收局 @source 0x0040cfdb..0x0040d034', () => {
  run('单人类局：唯一的真人破产 ⇒ 当场终局（码 1），清算跳过 —— 电脑还剩 3 家也一样', () => {
    const base = fresh();
    const landOwner = [...base.landOwner];
    landOwner[1] = 1; // 真人 0 号有一块地
    const s = applyBankruptcy({ ...base, landOwner }, 0);
    expect(s.phase).toBe('gameOver');
    expect(gameOverCode(s)).toBe(1);
    expect(s.landOwner[1]).toBe(1); // 终局路径不清算
  });

  run('2 真人局：一个真人破产、另一个还在 ⇒ 照常清算；第二个也破产 ⇒ 收局', () => {
    const base = fresh();
    const two: GameState = {
      ...base,
      humanPlayers: 2,
      players: base.players.map((p, i) => (i === 1 ? { ...p, whoPlays: WHO_PLAYS_HUMAN } : p)),
    };
    const first = applyBankruptcy(two, 0);
    expect(first.phase).not.toBe('gameOver');
    const second = applyBankruptcy({ ...first, pending: null, pendingQueue: [] }, 1);
    expect(second.phase).toBe('gameOver');
    expect(gameOverCode(second)).toBe(1);
  });

  run('破产者被别人记着的敌意清零 @source 0x0040cf47..0x0040cf6b', () => {
    const base = fresh();
    const s0: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 2 ? { ...p, hostility: [5, 7, 0, 9] } : p)),
    };
    const s = applyBankruptcy(s0, 1);
    expect(s.players[2]!.hostility).toEqual([5, 0, 0, 9]);
  });
});

describe('★ 付不起过路费会真的破产', () => {
  run('身无分文踩到高级地产 → 出局', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    const base = fresh();

    const landNode = map.nodes.find((n) => n.ref.kind === 'land');
    if (landNode === undefined) return;
    const idx = landNode.ref.kind === 'land' ? landNode.ref.index : 0;

    const landOwner = [...base.landOwner];
    const landLevel = [...base.landLevel];
    landOwner[idx] = 2; // 归玩家1
    landLevel[idx] = 5; // 满级

    const s: GameState = {
      ...base,
      landOwner,
      landLevel,
      priceIndex: 50, // 把租金抬到必然付不起
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: landNode.id, cash: 1, moneyInBank: 0 } : p,
      ),
      phase: 'settling',
    };

    const r = reduce(s, { type: 'settle' }, topo);
    expect(isAlive(r.players[0]!)).toBe(false);
  });
});

/**
 * ★★ PAY-05：清算拍卖**跑完**才轮到收款人入账。
 *
 * @source `pay_money` VA 0x0041d2c6：
 * ```asm
 * 0041d375  push esi
 * 0041d376  call 0x40cd87        ; ★ 清算 + 下線拍卖（0x40d1e3 call 0x43bde5 是**阻塞**的）
 * 0041d37b  add  esp, 4
 * 0041d37e  imul eax, esi, 0x68
 * 0041d381  add  [eax + 0x496bc4], ebx     ; 本月支出
 * 0041d387  cmp  edi, -1                   ; ← 收款方分支在**清算之后**
 * ```
 * ⇒ 地主在清算拍卖期间**还没拿到**这笔过路费，他的現金不参与竞价。
 */
describe('★★ PAY-05：破产清算跑完才给收款人入账', () => {
  run('踩到高级地产付不起 ⇒ 先清算拍卖，地主在拍卖期间拿不到钱，打完才到账', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands };
    // ★ 场上要有**两位真人**：只有一位时他一出局就收局，清算整段被跳过（`0x0040cfdb`，见 BKR-06）
    const base = newGame({
      map,
      players: [
        { character: 0, kind: 'human' as const },
        { character: 1, kind: 'computer' as const },
        { character: 2, kind: 'human' as const },
        { character: 3, kind: 'computer' as const },
      ],
      seed: 1,
    });
    const landNode = map.nodes.find((n) => n.ref.kind === 'land');
    if (landNode === undefined) return;
    const idx = landNode.ref.kind === 'land' ? landNode.ref.index : 0;
    // 玩家 0 名下另有 4 块地 ⇒ 破产清算要开 3 场拍卖（> 3 处）
    const landOwner = [...base.landOwner];
    landOwner[idx] = 2; // 落点这块归玩家1（地主）
    const spare = map.lands.filter((l) => l.id !== idx && l.id >= 1).slice(0, 4).map((l) => l.id);
    for (const id of spare) landOwner[id] = 1; // 归玩家0（破产者）
    const landLevel = [...base.landLevel];
    landLevel[idx] = 5; // 满级，租金必然付不起
    const s: GameState = {
      ...base,
      landOwner,
      landLevel,
      priceIndex: 50,
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: landNode.id, cash: 1, moneyInBank: 0 } : p,
      ),
      phase: 'settling',
    };
    const landlordBankBefore = s.players[1]!.moneyInBank;

    const after = reduce(s, { type: 'settle' }, topo);
    expect(isAlive(after.players[0]!)).toBe(false);
    expect(after.pending?.kind, '清算开出了拍卖').toBe('auction');
    expect(after.players[1]!.moneyInBank, '★ 拍卖期间地主还没拿到这笔钱').toBe(landlordBankBefore);
    expect(after.pendingQueue.some((q) => q.kind === 'credit')).toBe(true);

    // 把这场清算的三场拍卖打完（流拍，免得中标者又付不起）
    let cur = after;
    let auctions = 0;
    while (cur.pending?.kind === 'auction' && auctions < 10) {
      auctions++;
      cur = reduce(cur, { type: 'auction', winner: -1, price: 0 }, topo);
      if (cur.players[1]!.moneyInBank !== landlordBankBefore) break;
    }
    expect(auctions, '三场清算拍卖').toBe(3);
    expect(cur.pendingQueue, '队列清空').toEqual([]);
    expect(cur.players[1]!.moneyInBank, '★ 三场打完地主的入账才落地').toBe(landlordBankBefore + 1);
    expect(cur.players[1]!.monthlyReceived).toBe(s.players[1]!.monthlyReceived + 1);
  });
});

// ============================================================
//  ★ 变卖手牌与道具（2026-09-16 补）
//    @source `rich4_player_bankrupt.asm:412-417`：
//    `call _rich4_player_sell_all_tools` / `call _rich4_player_sell_all_the_card`
// ============================================================
describe('★ 破产清算会把出局者的手牌与道具**卖回商店**', () => {
  run('道具清空、编号 ≤ 8 的进商店库存、所得不进點券', () => {
    const base = fresh();
    const tools = [...base.tools];
    // 玩家 1 拿着 2 个地雷（id 3）与 1 个核子飛彈（id 13）
    tools[1 * 15 + 3] = 2;
    tools[1 * 15 + 13] = 1;
    const stock = [...base.toolStock];
    const points = base.players[1]!.points;
    const s = applyBankruptcy({ ...base, tools, toolStock: stock }, 1);
    expect(s.tools[1 * 15 + 3]).toBe(0);
    expect(s.tools[1 * 15 + 13]).toBe(0);
    // 地雷 ≤ 8 ⇒ 库存 +2；核子飛彈 ≥ 9 ⇒ 不回库存（本来也不限量）
    expect(s.toolStock[3]).toBe((stock[3] ?? 0) + 2);
    expect(s.toolStock[13]).toBe(stock[13] ?? 0);
    // ★ 人都出局了，變賣所得**不进他口袋**
    expect(s.players[1]!.points).toBe(points);
  });

  run('手牌全部回商店库存', () => {
    const base = fresh();
    const players2 = base.players.map((p, i) => (i === 1 ? { ...p, cards: [1, 1, 7] } : p));
    const before = [...base.cardAmount];
    const s = applyBankruptcy({ ...base, players: players2 }, 1);
    expect(s.players[1]!.cards).toEqual([]);
    expect(s.cardAmount[0]).toBe((before[0] ?? 0) + 2);
    expect(s.cardAmount[6]).toBe((before[6] ?? 0) + 1);
  });

  run('★ 终局路径**不卖** —— 最后出局者的手牌留着（存档实证）', () => {
    const base = fresh();
    // 只剩两人，弄掉一个就进终局
    const two = {
      ...base,
      players: base.players.map((p, i) => (i >= 2 ? { ...p, whoPlays: WHO_PLAYS_DEAD } : p)),
    };
    const withCards = {
      ...two,
      players: two.players.map((p, i) => (i === 1 ? { ...p, cards: [1, 2] } : p)),
    };
    const s = applyBankruptcy(withCards, 1);
    expect(s.phase).toBe('gameOver');
    expect(s.players[1]!.cards).toEqual([1, 2]);
  });
});
