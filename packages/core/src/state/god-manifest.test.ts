/*
 * 神明**落脚顯靈**（落点尾块 `0x0041b077` → `fcn_0040f381`）与福神加倍（`fcn_0040f8be`）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 第五份回报第 2 条：「踩到天使后買房应该自动加蓋一层」。取证全文见 `rules/god-manifest.ts`。
 * 可证伪（已验证）：把 `reduce` 里那句 `landingTailDue(...) ? manifestGodOnLanding(...)` 短路掉，
 * 天使 / 惡魔 / 土地公三组带 ★ 的 7 条全部变红；福神那组挂在 `luckyGodBonus` 上
 * （★ 2026-09-22 订正：福神**不止**自己地升級那一支 —— 買地 / 買設施 / 付費首建 /
 * 付費加蓋也是同一个 `call fcn_0040f8be`，见下面福神那几组与 `god-manifest.ts` 的表）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { GOD_ANGEL, GOD_BIG_LUCK, GOD_DEVIL, GOD_EARTH, GOD_SMALL_WEALTH } from '../rules/god-power.ts';
import { manifestKindOf, seizeHostilityDelta } from '../rules/god-manifest.ts';
import { WatcomRng } from '../rng/watcom.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

function setup(kind: 'computer' | 'human' = 'computer') {
  const map = loadMap();
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
  // 第一块**住宅地**所在的普通格（类型 0）
  const landNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'land');
  if (landNode === undefined) throw new Error('地图里找不到住宅地格');
  // 第一处**設施**所在的普通格（类型 0）—— 福神買設施/首建/加蓋那三支要用
  const facNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'facility');
  if (facNode === undefined) throw new Error('地图里找不到設施格');
  return { state, topo, landNode, facNode };
}

/** 玩家 0 站到那一格、进入 `settling`，附上指定的神 */
function standing(state: GameState, nodeId: number, godInfo: number, over: Partial<GameState> = {}): GameState {
  return {
    ...state,
    ...over,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: state.players.map((p, i) =>
      i === 0 ? { ...p, nodeId, godInfo, cash: 500_000, moneyInBank: 0 } : { ...p, cash: 500_000 },
    ),
  };
}

function landIdAt(state: GameState, topo: ReturnType<typeof setup>['topo'], nodeId: number): number {
  const ref = topo.nodes[nodeId - 1]!.ref;
  if (ref.kind !== 'land') throw new Error('不是住宅地');
  return ref.index;
}

function facIdAt(state: GameState, topo: ReturnType<typeof setup>['topo'], nodeId: number): number {
  const ref = topo.nodes[nodeId - 1]!.ref;
  if (ref.kind !== 'facility') throw new Error('不是設施');
  return ref.index;
}

describe('manifestKindOf —— `fcn_0040f381` 的分派 @source 0x0040f3d7..0x0040f3ff', () => {
  it('只有 9 / 10 / 12 有落脚效果', () => {
    expect(manifestKindOf(GOD_ANGEL)).toBe('build');
    expect(manifestKindOf(GOD_DEVIL)).toBe('demolish');
    expect(manifestKindOf(GOD_EARTH)).toBe('seize');
    for (const g of [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 13, 14, 15, 16]) expect(manifestKindOf(g)).toBeNull();
  });
});

describe('seizeHostilityDelta —— double 被当 int 读的那个原版 bug @source 0x0040f6fc / 0x0040df97', () => {
  it('整除且 < 2^21 ⇒ double 的低 32 位全 0 ⇒ delta = 0', () => {
    expect(seizeHostilityDelta(1000, 1, 0)).toBe(0); // 400.0
    expect(seizeHostilityDelta(2500, 3, 3)).toBe(0); // 7500.0
  });
  it('不整除 ⇒ 尾数低位（0.4 → 0x9999999a 为负）', () => {
    // 1 × 1 × 2 / 5 = 0.4 = 0x3FD999999999999A
    expect(seizeHostilityDelta(1, 1, 0)).toBe(0x9999999a | 0);
  });
  it('≥ 2^21 的整数：低位非 0', () => {
    // 2^21 + 1 = 0x4140000080000000 ⇒ 低 32 位 0x80000000
    expect(seizeHostilityDelta(2 ** 21 + 1, 1, 3)).toBe(0x80000000 | 0); // ×(3+2)/5 = ×1
  });
});

describe('★ 天使：買地之后自动加蓋一层（尾块在買地分支**之后**）', () => {
  run('★ 空地 → 買下 → 天使再蓋到 1 级，并弹「天使顯靈 加蓋一層房屋！」', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const s0 = standing(state, landNode.id, GOD_ANGEL);
    const asked = reduce(s0, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buyLand');
    // 还没買 ⇒ 尾块没到 ⇒ 一级都没蓋
    expect(asked.landLevel[id] ?? 0).toBe(0);
    const bought = reduce(asked, { type: 'buyLand' }, topo);
    expect(bought.landOwner[id]).toBe(1);
    expect(bought.landLevel[id]).toBe(1);
    expect(bought.phase).toBe('turnEnd');
    expect(bought.notices.map((n) => n.key)).toEqual(['god.build']);
    expect(bought.notices[0]!.args).toEqual(['天使']);
    expect(bought.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + id, reachedMaxLevel: false, source: 'godManifest' },
    ]);
  });

  run('★ 不買也蓋 —— `0x40b110` 不看归属', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const asked = reduce(standing(state, landNode.id, GOD_ANGEL), { type: 'settle' }, topo);
    const passed = reduce(asked, { type: 'declineDecision' }, topo);
    expect(passed.landOwner[id] ?? 0).toBe(0);
    expect(passed.landLevel[id]).toBe(1);
  });

  run('★ 踩到别人的地：付完过路费再替他蓋一级；4 → 5 级置 bit7', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 2;
    landLevel[id] = 4;
    const out = reduce(standing(state, landNode.id, GOD_ANGEL, { landOwner, landLevel }), { type: 'settle' }, topo);
    expect(out.landLevel[id]).toBe(5);
    expect(out.landOwner[id]).toBe(2);
    // 先收费框、后顯靈框
    expect(out.notices[out.notices.length - 1]!.key).toBe('god.build');
    expect(out.notices.length).toBeGreaterThanOrEqual(2);
    expect(out.lastBuildUpgrades?.at(-1)).toEqual({ entity: 0x7d0 + id, reachedMaxLevel: true, source: 'godManifest' });
  });

  run('满级（5）⇒ 蓋不成 ⇒ 什么都不弹 @source 0x0040f4a2', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 5;
    const out = reduce(standing(state, landNode.id, GOD_ANGEL, { landOwner, landLevel }), { type: 'settle' }, topo);
    expect(out.landLevel[id]).toBe(5);
    expect(out.notices.some((n) => n.key === 'god.build')).toBe(false);
  });

  run('住宿中（+0x32 != 0）不顯靈 @source 0x0040f39e', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const base = standing(state, landNode.id, GOD_ANGEL);
    const s0: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, blocking: { ...p.blocking, inHotel: 2 } } : p)),
    };
    const asked = reduce(s0, { type: 'settle' }, topo);
    const done = asked.pending === null ? asked : reduce(asked, { type: 'declineDecision' }, topo);
    expect(done.landLevel[id] ?? 0).toBe(0);
  });

  run('没有神 / 别的神（小財神）落脚时什么都不做', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    for (const god of [0, GOD_SMALL_WEALTH]) {
      const asked = reduce(standing(state, landNode.id, god), { type: 'settle' }, topo);
      const bought = reduce(asked, { type: 'buyLand' }, topo);
      expect(bought.landLevel[id] ?? 0).toBe(0);
      expect(bought.notices.some((n) => n.key.startsWith('god.'))).toBe(false);
    }
  });
});

describe('★ 惡魔：落脚拆一级 + 地主记仇 30×物價 @source 0x0040f521', () => {
  run('★ 别人的 3 级房 → 2 级，地主对我敌意 +30×物價', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 2;
    landLevel[id] = 3;
    const s0 = standing(state, landNode.id, GOD_DEVIL, { landOwner, landLevel });
    const before = s0.players[1]!.hostility[0] ?? 0;
    const out = reduce(s0, { type: 'settle' }, topo);
    expect(out.landLevel[id]).toBe(2);
    expect(out.players[1]!.hostility[0]).toBe(before + 30 * s0.priceIndex);
    expect(out.notices.at(-1)!.key).toBe('god.demolish');
  });

  run('★ 自己的房也拆（不排除自己），不记仇', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 5; // 满级 ⇒ 不问升級，`settle` 直接到 turnEnd
    const out = reduce(standing(state, landNode.id, GOD_DEVIL, { landOwner, landLevel }), { type: 'settle' }, topo);
    expect(out.landLevel[id]).toBe(4);
    expect(out.notices.at(-1)!.key).toBe('god.demolish');
  });

  run('0 级（空地）不动、不弹 @source 0x0040f53c je 0x40f5d0', () => {
    const { state, topo, landNode } = setup();
    const asked = reduce(standing(state, landNode.id, GOD_DEVIL), { type: 'settle' }, topo);
    const done = asked.pending === null ? asked : reduce(asked, { type: 'declineDecision' }, topo);
    expect(done.notices.some((n) => n.key === 'god.demolish')).toBe(false);
  });
});

describe('★ 土地公：落脚強佔 @source 0x0040f68b', () => {
  run('★ 别人的地 → 归我（等级不变），弹「土地公顯靈 強佔土地！」', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 3;
    landLevel[id] = 2;
    const out = reduce(standing(state, landNode.id, GOD_EARTH, { landOwner, landLevel }), { type: 'settle' }, topo);
    expect(out.landOwner[id]).toBe(1);
    expect(out.landLevel[id]).toBe(2);
    expect(out.notices.at(-1)!.key).toBe('god.seize');
  });

  run('★ 无主地：不问買（`loc_0041a013` 土地公跳过買地），尾块直接占下', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const s0 = standing(state, landNode.id, GOD_EARTH);
    const out = reduce(s0, { type: 'settle' }, topo);
    expect(out.pending).toBeNull();
    expect(out.landOwner[id]).toBe(1);
    expect(out.players[0]!.cash).toBe(s0.players[0]!.cash); // 一分不花
  });

  run('已经是我的 ⇒ 不弹', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 5;
    const out = reduce(standing(state, landNode.id, GOD_EARTH, { landOwner, landLevel }), { type: 'settle' }, topo);
    expect(out.notices.some((n) => n.key === 'god.seize')).toBe(false);
  });
});

describe('★ 福神：自己地升級后再送一级（「蓋房子投資加倍」）@source 0x00419a48 → 0x0040f8be', () => {
  run('★ 1 → 2（自己掏钱）→ 3（福神送），只扣一次钱，多消费一次随机数（挑台词）', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 1;
    const s0 = standing(state, landNode.id, GOD_BIG_LUCK, { landOwner, landLevel });
    const asked = reduce(s0, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('upgradeLand');
    const cost = asked.pending?.kind === 'upgradeLand' ? asked.pending.cost : 0;
    const out = reduce(asked, { type: 'upgradeLand' }, topo);
    expect(out.landLevel[id]).toBe(3);
    expect(out.players[0]!.cash).toBe(s0.players[0]!.cash - cost);
    expect(out.notices.at(-1)).toEqual({ key: 'god.build', args: ['大福神'] });
    expect(out.lastBuildUpgrades?.map((h) => h.source)).toEqual(['ownUpgrade', 'godManifest']);
    expect(out.rngState).not.toBe(asked.rngState);
  });

  run('★ 自己升到 5 级那一支**绕过**福神 @source 0x00419a26 jmp 0x41b077', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 4;
    const asked = reduce(standing(state, landNode.id, GOD_BIG_LUCK, { landOwner, landLevel }), { type: 'settle' }, topo);
    const out = reduce(asked, { type: 'upgradeLand' }, topo);
    expect(out.landLevel[id]).toBe(5);
    expect(out.notices.some((n) => n.key === 'god.build')).toBe(false);
    expect(out.rngState).toBe(asked.rngState);
  });

  run('★ 3 → 4 → 5：福神那一级置 bit7（播 0x20b）且**不**再掷台词', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 3;
    const asked = reduce(standing(state, landNode.id, GOD_BIG_LUCK, { landOwner, landLevel }), { type: 'settle' }, topo);
    const out = reduce(asked, { type: 'upgradeLand' }, topo);
    expect(out.landLevel[id]).toBe(5);
    expect(out.lastBuildUpgrades?.at(-1)?.reachedMaxLevel).toBe(true);
    expect(out.rngState).toBe(asked.rngState);
  });
});

/*
 * ★★ 2026-09-22（第九份试玩回报第 2 条）：福神**不止**自己地升級那一支。
 *
 * 反证用的四个 exe 地址（`rich4_player_core_actions.asm`）—— 这些分支的收尾都不是
 * 回 `0x41b077`，而是直接跳进 `call fcn_0040f8be` 那个入口：
 *   `:1079` 買地（`0x0041a013`）→ `jmp near loc_00419a48`
 *   `:1169` 付費首建設施（`0x41a25a`）→ `jmp near loc_00419a48`
 *   `:1218` 付費加蓋設施（`loc_0041a2b3`）→ `jmp near loc_00419a39`
 *   `:1726` 買設施（`loc_0041a97b`）→ `jmp near loc_00419a48`
 * ⇒ `reduce.ts` 那五条 case 都接 `luckyGodBonus`（升级那一条是老早就有的）。
 */
describe('★★ 福神：買地 / 買設施 / 付費首建 / 付費加蓋 也白送一级（四个 `jmp loc_00419a4x`）', () => {
  run('★★ 買下空地之后自动加蓋到 1 级 @source `:1079 jmp near loc_00419a48`', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const s0 = standing(state, landNode.id, GOD_BIG_LUCK);
    const asked = reduce(s0, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buyLand');
    // 还没買 ⇒ 落点尾块没到 ⇒ 一级都没蓋
    expect(asked.landLevel[id] ?? 0).toBe(0);
    const bought = reduce(asked, { type: 'buyLand' }, topo);
    expect(bought.landOwner[id]).toBe(1);
    expect(bought.landLevel[id]).toBe(1);
    expect(bought.phase).toBe('turnEnd');
    expect(bought.lastBuildUpgrades).toEqual([
      { entity: 0x7d0 + id, reachedMaxLevel: false, source: 'godManifest' },
    ]);
    expect(bought.notices.map((n) => n.key)).toEqual(['god.build']);
    expect(bought.notices[0]!.args).toEqual(['大福神']);
  });

  run('★★ 買下无主設施之后自动加蓋到 1 级（电脑按 `0x40b1ad` 掷种类）@source `:1726`', () => {
    const { state, topo, facNode } = setup();
    const id = facIdAt(state, topo, facNode.id);
    const s0 = standing(state, facNode.id, GOD_BIG_LUCK);
    const asked = reduce(s0, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buyFacility');
    expect(asked.facilityLevel[id] ?? 0).toBe(0); // 買下只写归属，不加級
    const bought = reduce(asked, { type: 'buyFacility' }, topo);
    expect(bought.facilityOwner[id]).toBe(1);
    expect(bought.facilityLevel[id]).toBe(1);
    expect(bought.lastBuildUpgrades).toEqual([
      { entity: 0xfa0 + id, reachedMaxLevel: false, source: 'godManifest' },
    ]);
    expect(bought.notices.map((n) => n.key)).toEqual(['god.build']);
  });

  run('★★ 付費首建設施（0 → 1）之后再送一级到 2 @source `:1169 jmp near loc_00419a48`', () => {
    const { state, topo, facNode } = setup('human');
    const id = facIdAt(state, topo, facNode.id);
    const facilityOwner = [...state.facilityOwner];
    facilityOwner[id] = 1;
    const s0 = standing(state, facNode.id, GOD_BIG_LUCK, { facilityOwner });
    const asked = reduce(s0, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('buildFacility');
    const built = reduce(asked, { type: 'buildFacility', facilityType: 1 }, topo);
    expect(built.facilityType[id]).toBe(1);
    expect(built.facilityLevel[id]).toBe(2);
    expect(built.lastBuildUpgrades?.map((h) => h.source)).toEqual(['facilityFirstBuild', 'godManifest']);
    expect(built.lastBuildUpgrades?.at(-1)).toEqual({
      entity: 0xfa0 + id,
      reachedMaxLevel: false,
      source: 'godManifest',
    });
  });

  run('★★ 付費加蓋設施（1 → 2）之后再送一级到 3 @source `:1218 jmp near loc_00419a39`', () => {
    const { state, topo, facNode } = setup();
    const id = facIdAt(state, topo, facNode.id);
    const facilityOwner = [...state.facilityOwner];
    const facilityLevel = [...state.facilityLevel];
    const facilityType = [...state.facilityType];
    facilityOwner[id] = 1;
    facilityLevel[id] = 1;
    facilityType[id] = 1; // 旅館：上限 5，可加蓋
    const s0 = standing(state, facNode.id, GOD_BIG_LUCK, { facilityOwner, facilityLevel, facilityType });
    const asked = reduce(s0, { type: 'settle' }, topo);
    expect(asked.pending?.kind).toBe('upgradeFacility');
    const out = reduce(asked, { type: 'upgradeFacility' }, topo);
    expect(out.facilityLevel[id]).toBe(3);
    expect(out.lastBuildUpgrades?.at(-1)).toEqual({
      entity: 0xfa0 + id,
      reachedMaxLevel: false,
      source: 'godManifest',
    });
    expect(out.notices.map((n) => n.key)).toEqual(['god.build']);
  });

  run('★ 付費加蓋剛好到 5 级那一支同样**绕过**福神 @source `loc_0041a2b3 cmp dh,5 / je 0x4199f1`', () => {
    const { state, topo, facNode } = setup();
    const id = facIdAt(state, topo, facNode.id);
    const facilityOwner = [...state.facilityOwner];
    const facilityLevel = [...state.facilityLevel];
    const facilityType = [...state.facilityType];
    facilityOwner[id] = 1;
    facilityLevel[id] = 4;
    facilityType[id] = 1;
    const s0 = standing(state, facNode.id, GOD_BIG_LUCK, { facilityOwner, facilityLevel, facilityType });
    const asked = reduce(s0, { type: 'settle' }, topo);
    const out = reduce(asked, { type: 'upgradeFacility' }, topo);
    expect(out.facilityLevel[id]).toBe(5);
    expect(out.notices.some((n) => n.key === 'god.build')).toBe(false);
    expect(out.rngState).toBe(asked.rngState);
  });
});

describe('★ W-55 行 6：福神挑台词的那一次 `rand() & 1` 要交出来（`GameState.lastGodLine`）', () => {
  /** 福神 + 自己地 1 级，走到「升級房子」那一步（`luckyGodBonus` 会跑） */
  function luckyUpgradeFrom(level: number) {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = level;
    const s0 = standing(state, landNode.id, GOD_BIG_LUCK, { landOwner, landLevel });
    const asked = reduce(s0, { type: 'settle' }, topo);
    return { asked, out: reduce(asked, { type: 'upgradeLand' }, topo), id, topo };
  }

  run('★★ `lastGodLine` = { 说话人, 事件 = rand()&1 }，与那次多消费的随机数**同一个值**', () => {
    const { asked, out } = luckyUpgradeFrom(1);
    // 福神那一支多消费一次 rand()（原版 `0x0040fa49 call 0x456f2d`）
    expect(out.rngState).not.toBe(asked.rngState);
    const hint = out.lastGodLine;
    expect(hint, '福神送了一级 ⇒ 必须交出那句话').toBeTruthy();
    expect(hint!.player).toBe(0);
    // ★ 独立核对：拿 `asked.rngState` 走一次 `next()`，低一位就是台词槽位
    const probe = new WatcomRng(asked.rngState);
    const roll = probe.next();
    expect(hint!.event).toBe(roll & 1);
    // 槽位只能是 0 / 1（角色台词表的两句）
    expect([0, 1]).toContain(hint!.event);
    // ★ 与 `rngState` 是**同一次**消费：交出来的状态 = 消费之后的状态
    expect(probe.getState()).toBe(out.rngState);
  });

  run('★ 到 5 级那一支**不**写 `lastGodLine`（它绕过福神，一个字都不说）', () => {
    const { out } = luckyUpgradeFrom(4);
    expect(out.landLevel[1]).toBe(5);
    expect(out.lastGodLine ?? null).toBeNull();
  });

  run('★ 没有福神（普通升級）⇒ `lastGodLine` 不写', () => {
    const { state, topo, landNode } = setup();
    const id = landIdAt(state, topo, landNode.id);
    const landOwner = [...state.landOwner];
    const landLevel = [...state.landLevel];
    landOwner[id] = 1;
    landLevel[id] = 1;
    const asked = reduce(standing(state, landNode.id, 0, { landOwner, landLevel }), { type: 'settle' }, topo);
    const out = reduce(asked, { type: 'upgradeLand' }, topo);
    expect(out.landLevel[id]).toBe(2);
    expect(out.lastGodLine ?? null).toBeNull();
  });

  run('★ 只活一条 action：没新写它的下一条 action 会被清成 null（`reduce` 出口）', () => {
    const { asked, out, topo } = luckyUpgradeFrom(1);
    expect(out.lastGodLine).toBeTruthy();
    const after = reduce(out, { type: 'endTurn' }, topo);
    // `endTurn` 没碰这个字段 ⇒ 出口清掉（引用相等 = 上一条 action 留下的）
    expect(after.lastGodLine ?? null).toBeNull();
    expect(asked.lastGodLine ?? null).toBeNull();
  });
});

