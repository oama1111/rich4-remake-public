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
import { fnv1a, stateFingerprint, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol.ts';
import { Sequencer } from './sequencer.ts';

const MAP = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
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
    const topo = { nodes: map.nodes, lands: map.lands };

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
    const topo = { nodes: map.nodes, lands: map.lands };
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
  it('版本号已定', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
