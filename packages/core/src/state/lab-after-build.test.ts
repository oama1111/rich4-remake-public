/*
 * 研究所蓋好当场就问研發項目（第十六份試玩回報：「研究所修完后是不是马上可以选择开始研究什么东西」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版：付費首建 `0x0041a25a` → `0x0041a2ae jmp 0x419a48`（福神 `call 0x40f8be`）→ `0x00419a4d jmp 0x41b074`
 *   → 尾块 `0x0041b077`：`0x0041b086 call 0x40f381`（顯靈）→ `0x0041b09d call 0x448a7e` →
 *   `0x0041b0b3..0x0041b102`（設施、我的、没夢遊、type == 4 且 level != 0、没被查封）→ `0x0041b109 call 0x44101d`。
 * ⇒ 首建成研究所那一下就开面板（真人点选；电脑 `0x4411e7` 当场开 項目 = 等级、5 天），
 *   且面板在顯靈**之后**（天使先加一层、惡魔先拆）。
 * 可证伪（已验证）：把 `reduce` 出口的 `labPanelTail` 短路掉，带 ★ 的全部变红。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { FACILITY_TYPE, RESEARCH_DAYS } from '../rules/facility.ts';
import { GOD_ANGEL, GOD_DEVIL, GOD_SMALL_LUCK } from '../rules/god-power.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

function setup(kind: 'computer' | 'human') {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
    landscapes: map.landscapes,
  };
  const state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i === 0 ? kind : ('computer' as const) })),
    seed: 7,
  });
  const facNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'facility');
  if (facNode === undefined || facNode.ref.kind !== 'facility') throw new Error('地图里找不到設施格');
  return { state, topo, nodeId: facNode.id, fac: facNode.ref.index };
}

/** 玩家 0 站在那处設施上、进 `settling`；設施归属 / 等级 / 种类与所附的神按参数摆好 */
function onFacility(
  base: GameState,
  nodeId: number,
  fac: number,
  opts: { owner: number; level: number; type: number; godInfo?: number; rngState?: number },
): GameState {
  const facilityOwner = [...base.facilityOwner];
  const facilityLevel = [...base.facilityLevel];
  const facilityType = [...base.facilityType];
  facilityOwner[fac] = opts.owner;
  facilityLevel[fac] = opts.level;
  facilityType[fac] = opts.type;
  return {
    ...base,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    facilityOwner,
    facilityLevel,
    facilityType,
    ...(opts.rngState === undefined ? {} : { rngState: opts.rngState }),
    players: base.players.map((p, i) =>
      i === 0 ? { ...p, nodeId, godInfo: opts.godInfo ?? 0, cash: 500_000, moneyInBank: 0 } : p,
    ),
  };
}

describe('★ 真人：首建选了研究所，当场开研究所面板', () => {
  run('★ 自己的空地 → 选研究所 → 1 级 → research 待决（只有項目 1）@source 0x0041a2ae / 0x0041b109', () => {
    const { state, topo, nodeId, fac } = setup('human');
    const asked = reduce(onFacility(state, nodeId, fac, { owner: 1, level: 0, type: 0 }), { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buildFacility');
    const built = reduce(asked, { type: 'buildFacility', facilityType: FACILITY_TYPE.lab }, topo);
    expect(built.facilityType[fac]).toBe(FACILITY_TYPE.lab);
    expect(built.facilityLevel[fac]).toBe(1);
    expect(built.phase).toBe('awaitingDecision');
    expect(built.pending).toMatchObject({ kind: 'research', facilityId: fac, level: 1, choices: [1] });
    // 选了就开：5 天
    const chosen = reduce(built, { type: 'research', facilityId: fac, project: 1 }, topo);
    expect(chosen.phase).toBe('turnEnd');
    expect(chosen.pending).toBeNull();
    expect(chosen.facilityResearchProject[fac]).toBe(1);
    expect(chosen.facilityResearchDays[fac]).toBe(RESEARCH_DAYS);
  });

  run('首建别的种类不问研發', () => {
    const { state, topo, nodeId, fac } = setup('human');
    const asked = reduce(onFacility(state, nodeId, fac, { owner: 1, level: 0, type: 0 }), { type: 'settle' }, topo);
    const built = reduce(asked, { type: 'buildFacility', facilityType: FACILITY_TYPE.hotel }, topo);
    expect(built.phase).toBe('turnEnd');
    expect(built.pending).toBeNull();
  });

  run('★ 福神 + 買下空設施：免费选种类框里选研究所（福神蓋到 1 级）→ 接着问研發 @source 0x0041a993 / 0x0040f8be', () => {
    const { state, topo, nodeId, fac } = setup('human');
    const asked = reduce(
      onFacility(state, nodeId, fac, { owner: 0, level: 0, type: 0, godInfo: GOD_SMALL_LUCK }),
      { type: 'settle' },
      topo,
    );
    expect(asked.pending?.kind).toBe('buyFacility');
    const bought = reduce(asked, { type: 'buyFacility' }, topo);
    expect(bought.pending).toMatchObject({ kind: 'buildFacility', free: true });
    const chosen = reduce(bought, { type: 'buildFacility', facilityType: FACILITY_TYPE.lab }, topo);
    expect(chosen.facilityLevel[fac]).toBe(1);
    expect(chosen.pending).toMatchObject({ kind: 'research', facilityId: fac, level: 1, choices: [1] });
  });
});

describe('★ 面板在顯靈之后（`0x0041b086 call 0x40f381` 先于 `0x0041b109`）', () => {
  run('★ 天使：谢绝加蓋 → 天使先加一层 → 面板按新等级给項目', () => {
    const { state, topo, nodeId, fac } = setup('human');
    const asked = reduce(
      onFacility(state, nodeId, fac, { owner: 1, level: 2, type: FACILITY_TYPE.lab, godInfo: GOD_ANGEL }),
      { type: 'settle' },
      topo,
    );
    expect(asked.pending?.kind).toBe('upgradeFacility');
    const declined = reduce(asked, { type: 'declineDecision' }, topo);
    expect(declined.facilityLevel[fac]).toBe(3);
    expect(declined.pending).toMatchObject({ kind: 'research', level: 3, choices: [1, 2, 3] });
  });

  run('★ 惡魔：1 级研究所先被拆到 0 级 ⇒ 不问研發', () => {
    const { state, topo, nodeId, fac } = setup('human');
    const asked = reduce(
      onFacility(state, nodeId, fac, { owner: 1, level: 1, type: FACILITY_TYPE.lab, godInfo: GOD_DEVIL }),
      { type: 'settle' },
      topo,
    );
    const declined = reduce(asked, { type: 'declineDecision' }, topo);
    expect(declined.facilityLevel[fac]).toBe(0);
    expect(declined.pending).toBeNull();
    expect(declined.phase).toBe('turnEnd');
  });

  run('选完研發不再顯靈第二次（research 不是落点待决）', () => {
    const { state, topo, nodeId, fac } = setup('human');
    const asked = reduce(
      onFacility(state, nodeId, fac, { owner: 1, level: 2, type: FACILITY_TYPE.lab, godInfo: GOD_ANGEL }),
      { type: 'settle' },
      topo,
    );
    const declined = reduce(asked, { type: 'declineDecision' }, topo);
    const chosen = reduce(declined, { type: 'research', facilityId: fac, project: 3 }, topo);
    expect(chosen.facilityLevel[fac]).toBe(3);
    expect(chosen.phase).toBe('turnEnd');
  });
});

describe('★ 电脑：首建抽中研究所，当场开一项（`0x4411e7`：項目 = 等级、5 天）', () => {
  /** 找一个 `rand() % 4 + 1 === 4`（研究所）的种子 @source 0x0041a23e..0x0041a257 */
  function labSeed(): number {
    for (let seed = 1; seed < 1000; seed++) {
      const rng = new WatcomRng();
      rng.setState(seed);
      if ((rng.next() % 4) + 1 === FACILITY_TYPE.lab) return seed;
    }
    throw new Error('找不到种子');
  }

  run('★ 电脑首建研究所 ⇒ 同一次落点里研發已开始', () => {
    const { state, topo, nodeId, fac } = setup('computer');
    const s = onFacility(state, nodeId, fac, { owner: 1, level: 0, type: 0, rngState: labSeed() });
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.facilityType[fac]).toBe(FACILITY_TYPE.lab);
    expect(r.facilityLevel[fac]).toBe(1);
    expect(r.pending).toBeNull();
    expect(r.phase).toBe('turnEnd');
    expect(r.facilityResearchProject[fac]).toBe(1);
    expect(r.facilityResearchDays[fac]).toBe(RESEARCH_DAYS);
    // 付費首建的音效 50（`0x0041a289 push 0x4823da`）真人电脑共用
    expect(r.lastBuildUpgrades).toContainEqual({ entity: 0xfa0 + fac, reachedMaxLevel: false, source: 'facilityFirstBuild' });
  });

  run('★ 电脑首建也吃福神加倍（与真人在 `0x0041a25a` 汇合后同一段 `jmp 0x419a48`）', () => {
    const { state, topo, nodeId, fac } = setup('computer');
    const s = onFacility(state, nodeId, fac, { owner: 1, level: 0, type: 0, godInfo: GOD_SMALL_LUCK, rngState: labSeed() });
    const r = reduce(s, { type: 'settle' }, topo);
    expect(r.facilityType[fac]).toBe(FACILITY_TYPE.lab);
    expect(r.facilityLevel[fac]).toBe(2);
    // 面板在福神之后 ⇒ 按 2 级开項目 2
    expect(r.facilityResearchProject[fac]).toBe(2);
  });
});

/**
 * ★★ 第十九份試玩回報（联机，`20260924-105216869`）：「为什么研究所修好了还没有自动呼出研究清单」。
 *
 * 那一局的研究所是**機器工人**（道具 9）在掷骰**之前**蓋的（轨迹 #111 `useTool 9 node 79 value 4`），
 * 不是落点付費首建 ⇒ 原版**本来就不问**：
 *   · 面板 `0x44101d` 全 exe **只有一个**调用点 `0x0041b109`（落点尾块；`disasm.py callers 0x44101d`，
 *     `find 1d104400` 也没有函数指针表引用它）；
 *   · 機器工人 `0x00447295`：`0x00447345 call 0x40b110`（蓋一层；等级 0 时在里面 `0x0040b1e4 call 0x440aac`
 *     选种类）→ 大锤影片 → `0x00447378 call 0x41d546` → `ret` —— **没有** `call 0x44101d`。
 * ⇒ 下次**停在**自己的研究所上（落点尾块）才问。单机与联机同一条 core 路径。
 */
describe('★★ 機器工人蓋研究所：当场**不**问研發，下次停在上面才问（`0x44101d` 只在落点尾块）', () => {
  /** 0 号（真人）掷骰前、手里一件機器工人，那处設施是自己的空地 @source 道具表下标 = 玩家×15 + 道具号 */
  function beforeRoll(kind: 'computer' | 'human') {
    const { state, topo, nodeId, fac } = setup(kind);
    const s = onFacility(state, nodeId, fac, { owner: 1, level: 0, type: 0 });
    const tools = [...s.tools];
    tools[9] = 1;
    // 人站在别处（不在那处設施上）—— 回报现场就是这样：站 80 号、蓋 79 号
    const elsewhere = topo.nodes.find((n) => n.id !== nodeId && n.specialKind === 0)!.id;
    return {
      state: {
        ...s,
        phase: 'awaitingRoll' as const,
        tools,
        players: s.players.map((p, i) => (i === 0 ? { ...p, nodeId: elsewhere } : p)),
      },
      topo,
      nodeId,
      fac,
    };
  }

  run('★ 真人用機器工人把空地蓋成研究所 ⇒ 1 级研究所，**没有** research 待决，仍在掷骰前', () => {
    const { state, topo, nodeId, fac } = beforeRoll('human');
    const r = reduce(state, { type: 'useTool', toolId: 9, nodeId, value: FACILITY_TYPE.lab }, topo);
    expect(r).not.toBe(state);
    expect(r.facilityType[fac]).toBe(FACILITY_TYPE.lab);
    expect(r.facilityLevel[fac]).toBe(1);
    expect(r.pending).toBeNull();
    expect(r.phase).toBe('awaitingRoll');
    expect(r.facilityResearchDays[fac]).toBe(0);
  });

  run('★ 之后停在这处研究所上 ⇒ 落点尾块照常问研發（`0x0041b109`）', () => {
    const { state, topo, nodeId, fac } = beforeRoll('human');
    const built = reduce(state, { type: 'useTool', toolId: 9, nodeId, value: FACILITY_TYPE.lab }, topo);
    const landed: GameState = {
      ...built,
      phase: 'settling',
      players: built.players.map((p, i) => (i === 0 ? { ...p, nodeId } : p)),
    };
    const asked = reduce(landed, { type: 'settle' }, topo);
    // 自己的 1 级研究所：先问加蓋（钱够），谢绝后才轮到尾块的研究所面板
    const atPanel = asked.pending?.kind === 'upgradeFacility' ? reduce(asked, { type: 'declineDecision' }, topo) : asked;
    expect(atPanel.pending).toMatchObject({ kind: 'research', facilityId: fac, level: 1, choices: [1] });
  });

  run('电脑用機器工人蓋出研究所也不当场开研發（同一个 `0x447295`，没有 `0x4411e7` 那一支）', () => {
    const { state, topo, nodeId, fac } = beforeRoll('computer');
    for (let seed = 1; seed < 200; seed++) {
      const r = reduce({ ...state, rngState: seed }, { type: 'useTool', toolId: 9, nodeId }, topo);
      if (r.facilityType[fac] !== FACILITY_TYPE.lab) continue;
      expect(r.facilityLevel[fac]).toBe(1);
      expect(r.facilityResearchDays[fac]).toBe(0);
      expect(r.pending).toBeNull();
      return;
    }
    throw new Error('200 个种子里电脑没抽中研究所');
  });
});
