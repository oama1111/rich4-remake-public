/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 魔法屋（真人）：效果是玩家**自己点**的，不是 core 掷的（第十二份试玩回报）。
 *
 * 回报原文：
 *   - 「我在魔法屋里选择所有女生存入现金，金贝贝不受影响，原版里她是女孩会受影响的」
 *   - 「为什么魔法屋默认就展示就地拆除房屋」
 *
 * 复现（回报 `20260923-013618309` 的轨迹第 67 条 `settle`）：沙隆巴斯（真人）进魔法屋，
 * 条件转到「所有女生」（名单 = [金貝貝]），屏上点了「存入所有現金」；core 却施加了
 * 自己掷出的「就地拆除房屋」（`lastEvent.id = 9`）—— 金貝貝站的不是地产格，什么都没发生。
 * **性别表没错**（金貝貝 `sex == 0`，`binary-truth.test.ts` 逐字节核过）。
 *
 * @source 入口 `0x0043380a`：
 * ```asm
 * 0043381b  cmp  byte [player + 0x15], 1   ; who_plays == 1？
 * 00433822  jne  0x43390b                  ; 否 → 电脑：两个转盘都 rand()
 * 004338af  call 0x4018e7(0x4325c2)         ; 是 → 女巫窗口
 * 004338b7  mov  esi, eax                  ; ★ 效果号 = 窗口返回值（玩家点的格号 − 1）
 * 004339c5  push esi / call 0x431caa        ; 逐人施加
 * ```
 * （`rich4-spec/docs/systems/magic-house.md` §3.1(a)、§3.3、§5.1）
 */

import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '@rich4/data';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { decideAction } from '../ai/policy.ts';
import { rollMagicCriterion, rollMagicOption, magicTargets } from '../places/magic-house.ts';
import { reduce } from './reduce.ts';
import type { MapTopology } from './reduce.ts';
import type { GameState } from './types.ts';
import { WHO_PLAYS_AUTOPILOT, WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from './types.ts';

/** 1 号节点 = 魔法屋；2 号节点 = 普通特殊格（非地产，就地类效果不作用） */
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2], specialKind: SPECIAL_KIND.MAGIC_HOUSE }),
    makeNode({ id: 2, adjacent: [1] }),
  ],
  lands: [],
};

/** 回报那一局的座位：0 金貝貝（真人）、1 沙隆巴斯（真人，触发者）、2 約翰喬、3 忍太郎（电脑） */
function reportTable(whoPlays1 = WHO_PLAYS_HUMAN): GameState {
  const seat = (index: number, character: number, whoPlays: number, cash: number) =>
    makePlayer({
      index,
      character,
      whoPlays,
      isMale: !(CHARACTERS[character]?.isFemale ?? false),
      cash,
      moneyInBank: 10_000,
      nodeId: index === 1 ? 1 : 2,
    });
  return makeGameState({
    rngState: 12345,
    currentPlayer: 1,
    phase: 'settling',
    players: [
      seat(0, 11, WHO_PLAYS_HUMAN, 234_600),
      seat(1, 1, whoPlays1, 112_000),
      seat(2, 0, WHO_PLAYS_COMPUTER, 75_000),
      seat(3, 2, WHO_PLAYS_COMPUTER, 202_200),
    ],
  });
}

describe('★ 魔法屋（真人）：效果由玩家点选', () => {
  it('金貝貝是女生 —— 「所有女生」点得到她（性别表本身没错）', () => {
    const s = reportTable();
    const ctx = { players: s.players, landCountOf: () => 0, houseCountOf: () => 0, wealthOf: () => 0 };
    expect(CHARACTERS[11]?.name).toBe('金貝貝');
    expect(magicTargets(11, ctx)).toEqual([0]);
  });

  it('★ 落点只转**目标转盘**，挂 `pending{magicHouse}` 等玩家点；此刻谁都没被动', () => {
    const s = reportTable();
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.pending?.kind).toBe('magicHouse');
    expect(r.phase).toBe('turnEnd');
    // 效果还没施加：玩家字段一个没变、也没有 magicHouse 的 lastEvent
    expect(r.players).toEqual(s.players);
    expect(r.lastEvent).toBeNull();
    // 目标转盘与电脑那一支同一段（rand() % 12，选不出人重抽），随机流只推进这么多
    const rng = new WatcomRng();
    rng.setState(s.rngState);
    const ctx = { players: s.players, landCountOf: () => 0, houseCountOf: () => 0, wealthOf: () => 0 };
    const want = rollMagicCriterion(ctx, () => rng.next());
    if (r.pending?.kind !== 'magicHouse') throw new Error('unreachable');
    // （名单的「財產」一项要按真身家算，这里只核条件号与随机流 —— 名单另有 magicTargets 的单测）
    expect(r.pending.criterion).toBe(want.criterion);
    expect(r.pending.targets.length).toBeGreaterThan(0);
    expect(r.rngState).toBe(rng.getState());
  });

  it('★★ 回报现场：条件「所有女生」+ 点「存入所有現金」⇒ 金貝貝的现金全部进存款', () => {
    const s: GameState = {
      ...reportTable(),
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
    };
    const r = reduce(s, { type: 'magicHouse', option: 4 }, topo);
    expect(r.pending).toBeNull();
    expect(r.players[0]!.cash).toBe(0);
    expect(r.players[0]!.moneyInBank).toBe(10_000 + 234_600);
    // 其余三位不动
    for (const i of [1, 2, 3]) expect(r.players[i]).toEqual(s.players[i]);
    expect(r.lastEvent).toEqual({ kind: 'magicHouse', id: 4, criterion: 11, targets: [0] });
    // 真人这一支**不掷效果转盘**：存钱这一项不碰随机数
    expect(r.rngState).toBe(s.rngState);
  });

  it('★ 12 项全部点得到 —— 包括电脑永远转不到的 6「得一張卡片」与 11「拍賣當格土地」', () => {
    const base: GameState = {
      ...reportTable(),
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
    };
    for (let option = 0; option < 12; option++) {
      const r = reduce(base, { type: 'magicHouse', option }, topo);
      expect(r, `效果 ${option}`).not.toBe(base);
      expect(r.pending, `效果 ${option}`).toBeNull();
      // 1「抽取命運三張」之后 lastEvent 是最后那张命運，其余都是这一趟魔法屋
      if (option !== 1) expect(r.lastEvent?.id, `效果 ${option}`).toBe(option);
    }
  });

  it('★ 0..11 之外的效果号、以及没挂魔法屋时的答复一律原样退回', () => {
    const base: GameState = {
      ...reportTable(),
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
    };
    for (const option of [-1, 12, 1.5, Number.NaN]) {
      expect(reduce(base, { type: 'magicHouse', option }, topo)).toBe(base);
    }
    const idle = { ...base, pending: null };
    expect(reduce(idle, { type: 'magicHouse', option: 4 }, topo)).toBe(idle);
  });

  it('★ 名单里有自己时真人**照样自己选**（「命中自己 → 6」只属于电脑那一支）', () => {
    const s: GameState = {
      ...reportTable(),
      phase: 'turnEnd',
      // 「所有男生」= [1, 2, 3]，含触发者 1
      pending: { kind: 'magicHouse', criterion: 10, targets: [1, 2, 3] },
    };
    const r = reduce(s, { type: 'magicHouse', option: 4 }, topo);
    expect(r.lastEvent?.id).toBe(4);
    for (const i of [1, 2, 3]) expect(r.players[i]!.cash).toBe(0);
  });
});

describe('★ 電腦 / 託管：照旧两个转盘都 rand()', () => {
  it('电脑落点当场结算（`0x0043390b`），不挂交互', () => {
    const s = reportTable(WHO_PLAYS_COMPUTER);
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.pending).toBeNull();
    expect(r.lastEvent?.kind).toBe('magicHouse');
  });

  it('★ 判的是 `who_plays == 1` 整字节相等：带託管位的真人（1|4）走电脑那一支', () => {
    const s = reportTable(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT);
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.pending).toBeNull();
    expect(r.lastEvent?.kind).toBe('magicHouse');
  });

  it('★ 窗口挂出之后才被託管：AI 答 `option: null`，reducer 按电脑那一支掷效果', () => {
    const pendingState: GameState = {
      ...reportTable(WHO_PLAYS_HUMAN | WHO_PLAYS_AUTOPILOT),
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
    };
    const a = decideAction({ state: pendingState, map: { ...topo, facilities: [] } as never });
    expect(a).toEqual({ type: 'magicHouse', option: null });
    const r = reduce(pendingState, { type: 'magicHouse', option: null }, topo);
    const rng = new WatcomRng();
    rng.setState(pendingState.rngState);
    const want = rollMagicOption([0], 1, () => rng.next()).option;
    expect(r.pending).toBeNull();
    expect(r.lastEvent?.id).toBe(want);
  });

  it('★ 「不了」不能让这一趟什么都不发生 —— 与託管同一支', () => {
    const s: GameState = {
      ...reportTable(),
      phase: 'turnEnd',
      pending: { kind: 'magicHouse', criterion: 11, targets: [0] },
    };
    const a = reduce(s, { type: 'declineDecision' }, topo);
    const b = reduce(s, { type: 'magicHouse', option: null }, topo);
    expect(a).toEqual(b);
    expect(a.lastEvent?.kind).toBe('magicHouse');
  });
});
