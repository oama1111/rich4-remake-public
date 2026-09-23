/*
 * 夢遊卡生效期间的**行为限制** —— 系统接管，只保留「掷骰 + 走子」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-16 的原话：
 *   「夢遊卡就是相当于系统接管了角色只保留扔骰子走路功能直到效果结束，
 *     不会买地/升级/炒股等。」
 *
 * 这三条在原版 exe 里都有**各自的判据**，不是同一个闸门 —— 本文件把三条
 * 各自钉一条用例，免得日后谁把其中一条当成「统一的地方」而漏掉别的：
 *
 * | 限制 | 原版判据 | 本引擎落点 |
 * |---|---|---|
 * | 不买地（住宅） | `rich4.asm` 那块 `player+0x37 != 0 → 结束` | `rules/land.ts` `canPurchase` |
 * | 不升级（住宅） | 同上 | `rules/land.ts` `canUpgrade` |
 * | 不买/卖股 | `fcn_0041d1a9` 进门两道闸（`+0x37`／出局）| `reduce.ts` `pendingForCommercial` |
 * | 不建/不加蓋設施 | `0x0041a1de` / `0x0041a86b` 的 `cmp [+0x37]` | `reduce.ts` `landOnFacility` |
 * | 不问研究所研發 | `0x0041b0e6` 的 `cmp [+0x37], 0` | `reduce.ts` `afterOwnLab` |
 * | 收租**豁免**（走路时免付过路费）| `0x0041d559` | `rules/toll-flow.ts` `tollExemption` |
 *
 * ★ 梦游是**每回合自动走**的（原版 `evaluateTurnStart` 对 `+0x37 != 0` 直接
 *   `auto_move()` 并返回 −1），本引擎在 `reduce` 的 `startTurn` 里当场补一次
 *   `rollDice` —— 玩家在梦游期间压根没有「点按钮」的机会，这也正是
 *   「系统接管」那层意思。
 *
 * 与其他 sleepwalk 用例的分工：
 *   - `cards/sleepwalk.test.ts`：卡本身（天数、退道具、復仇卡反弹）；
 *   - `cards/registry.test.ts`：经统一入口的替身/玩家两条分支；
 *   - **本文件**：生效**之后**那几天里，玩家能做什么、不能做什么。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseMap } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { reduce } from './reduce.ts';
import type { GameState } from './types.ts';
import { canPurchase, canUpgrade, housingIndexOf } from '../rules/land.ts';
import { evaluateTurnStart } from '../rules/turn-start.ts';
import { tollExemption } from '../rules/toll-flow.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const have = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

function topoOf(map: ReturnType<typeof loadMap>) {
  return { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials };
}

/** 一局 4 个电脑、0 号座梦游 `days` 天 */
function sleepwalkingGame(days = 3): { state: GameState; topo: ReturnType<typeof topoOf> } {
  const map = loadMap();
  const topo = topoOf(map);
  const base = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 1,
  });
  return {
    state: {
      ...base,
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, sleepWalking: days } } : p,
      ),
    },
    topo,
  };
}

// ============================================================
//  ① 回合开始：自动掷骰，玩家没有插手的机会
// ============================================================

describe('★ 系统接管：梦游期间回合开局就自动掷骰', () => {
  have('`startTurn` 当场掷骰起步，之后只剩机械步（走 / 结算），走完真的挪了格', () => {
    const { state, topo } = sleepwalkingGame();
    const after = reduce({ ...state, phase: 'turnStart' }, { type: 'startTurn' }, topo);
    // 原版 `fcn_0040c912` 对 `+0x37 != 0` 是「立刻 `auto_move()`」并返回 −1，
    // 所以绝不会停在 `awaitingRoll` 等人（本引擎的 `awaitingRoll` = 等玩家点 GO）。
    expect(after.phase).not.toBe('awaitingRoll');
    // ★ 2026-09-23：先前 `turnController` 把 −1 归成 `skip` ⇒ 这里直接 `turnEnd`、**原地不动**，
    //   旧断言「一个 reduce 就到 turnEnd」恰好把这个缺陷钉住了。原版 −1 走 `ja 0x418e7a`，
    //   `auto_move` 已经在路上 ⇒ 这里是 `moving`、骰子已掷。
    expect(after.phase).toBe('moving');
    expect(after.dice.length).toBeGreaterThan(0);
    expect(after.stepsTotal).toBeGreaterThan(0);
    // 余下只有机械步（岔路不问人，见 `step`）—— 一路推到回合末
    let s = after;
    for (let i = 0; i < 200 && s.phase !== 'turnEnd'; i++) {
      if (s.phase === 'moving') s = reduce(s, { type: 'step' }, topo);
      else if (s.phase === 'settling') s = reduce(s, { type: 'settle' }, topo);
      else break;
    }
    expect(s.phase).toBe('turnEnd');
    expect(s.players[0]!.nodeId).not.toBe(state.players[0]!.nodeId);
    expect(s.players[0]!.blocking.sleepWalking).toBe(3); // 天数没被顺手清掉
  });

  have('回合开始判定如实报 `sleepWalk: true`（`raw = -1`）', () => {
    const { state } = sleepwalkingGame();
    const r = evaluateTurnStart(state.players[0]!);
    expect(r.sleepWalk).toBe(true);
    expect(r.canAct).toBe(false);
    expect(r.raw).toBe(-1);
  });

  have('没梦游的玩家照旧停在 `awaitingRoll`（对照组）', () => {
    const { state, topo } = sleepwalkingGame();
    const noSleep: GameState = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, sleepWalking: 0 } } : p,
      ),
    };
    const after = reduce({ ...noSleep, phase: 'turnStart' }, { type: 'startTurn' }, topo);
    expect(after.phase).toBe('awaitingRoll');
  });
});

// ============================================================
//  ② 不买地 / 不升级（住宅）
// ============================================================

describe('★ 不买地、不升级（住宅）', () => {
  have('`canPurchase` 直接以 `sleepWalking` 为由拒绝', () => {
    const { state, topo } = sleepwalkingGame();
    const land = topo.lands.find((l) => l.owner === 0 && l.level === 0);
    if (land === undefined) throw new Error('地图 0 上没有无主空地');
    const r = canPurchase(land, { ...state.players[0]!, cash: 10_000_000 }, state.priceIndex);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sleepWalking');
  });

  have('`canUpgrade` 同样以 `sleepWalking` 为由拒绝', () => {
    const { state, topo } = sleepwalkingGame();
    const land = topo.lands[0]!;
    const owned = { ...land, owner: 1, level: 1 };
    const r = canUpgrade(owned, { ...state.players[0]!, cash: 10_000_000 }, state.priceIndex);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sleepWalking');
  });

  have('落到**无主**住宅上：不开「買」询价框，直接进 `turnEnd`', () => {
    const { state, topo } = sleepwalkingGame();
    const idx = topo.lands.findIndex((l) => l.owner === 0 && l.level === 0);
    if (idx < 0) throw new Error('地图 0 上没有无主空地');
    const land = topo.lands[idx]!;
    const node = topo.nodes.find((n) => n.ref.kind === 'land' && n.ref.index === land.id);
    if (node === undefined) throw new Error('找不到那块地的节点');
    const at: GameState = {
      ...state,
      phase: 'settling',
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: node.id, cash: 10_000_000 } : p,
      ),
    };
    const after = reduce(at, { type: 'settle' }, topo);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('turnEnd');
    // 钱一分没动
    expect(after.players[0]!.cash).toBe(10_000_000);
  });

  have('落到**自己的**住宅上：不开「加蓋」询价框', () => {
    const { state, topo } = sleepwalkingGame();
    const idx = topo.lands.findIndex((l) => l.owner === 0 || l.owner === 1);
    if (idx < 0) throw new Error('地图 0 上没有地');
    const land = topo.lands[idx]!;
    const node = topo.nodes.find((n) => n.ref.kind === 'land' && n.ref.index === land.id);
    if (node === undefined) throw new Error('找不到那块地的节点');
    // ★ 让 0 号座**拥有**这块地：本引擎的有效值是 `state.landOwner/landLevel`
    //   （`effectiveLand` 先读它们、再退回模板），owner 是 **1 基**
    //   （`owner === me + 1`，见 `landOnFacility` 的 `fac.owner === me + 1`）。
    const at: GameState = {
      ...state,
      landOwner: state.landOwner.map((o, i) => (i === land.id ? 1 : o)),
      landLevel: state.landLevel.map((l, i) => (i === land.id ? 1 : l)),
      phase: 'settling',
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: node.id, cash: 10_000_000 } : p,
      ),
    };
    const after = reduce(at, { type: 'settle' }, topo);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('turnEnd');
    expect(after.landLevel[land.id]).toBe(1); // 没加蓋（进去之前就是 1）
  });

  have('`housingIndexOf` 的前提还在（上面几条约束的是同一张表）', () => {
    const { topo } = sleepwalkingGame();
    const house = topo.lands.find((l) => housingIndexOf(l.type) !== null);
    if (house === undefined) return;
    expect(housingIndexOf(house.type)).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
//  ②b 不建/不加蓋設施
// ============================================================

describe('★ 不建、不加蓋設施 @source 0x0041a1de / 0x0041a86b 的 `cmp [+0x37]`', () => {

  have('落到**自己的**設施上（level 0，首建）：不开「建」框 @source `:1119` 的 `cmp [+0x37]`', () => {
    const { state, topo } = sleepwalkingGame();
    const fac = topo.facilities[0]!;
    const node = topo.nodes.find((n) => n.ref.kind === 'facility' && n.ref.index === fac.id);
    if (node === undefined) throw new Error('找不到那个設施的节点');
    const at: GameState = {
      ...state,
      // 「自己」= 1 基 owner（`fac.owner === me + 1`）
      facilityOwner: state.facilityOwner.map((o, i) => (i === fac.id ? 1 : o)),
      facilityLevel: state.facilityLevel.map((l, i) => (i === fac.id ? 0 : l)),
      phase: 'settling',
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: node.id, cash: 10_000_000 } : p,
      ),
    };
    const after = reduce(at, { type: 'settle' }, topo);
    expect(after.pending).toBeNull();
    expect(after.phase).toBe('turnEnd');
    expect(after.facilityLevel[fac.id]).toBe(0); // 没建
  });

  have('★ 无主設施：原版那里**没有** `+0x37` 那道闸，框照样开（照原版）', () => {
    // ── 核查（2026-09-16）────────────────────────────────────────
    // `rich4_player_core_actions.asm:1641` 的 `loc_0041a86b` 首条是
    // `cmp byte [eax + 0x496b9f], 0 / jne 结束`。`0x496b9f − 0x496b68 = 0x37`
    // **是 `days_sleep_walking`**，但这条路进来之前已经判过 `+55`
    // （= `0x496b9f`？不 —— `loc_0041a86b` 的入口判定链在 `:1105`
    //  `cmp byte [edx+0x19], 0 / je loc_0041a86b`，即**无主**那一支），
    // 而 `loc_0041a86b` 里**只有** `+55`（`disappearing`）与 `+63`（土地公）
    // 两条早退 —— 没有 `+0x37`。
    //
    // ⇒ 原版**夢遊中也会弹「要不要買」**。本引擎照此：`landOnFacility` 的
    //   「无主」分支不做夢遊判断，`pending` 会挂出来。
    //   ⚠️ 这一条先前我写成「原版没闸、故不接」又改成「原版有闸」——
    //   两遍都错。**定案：无主設施没有夢遊闸**（`loc_0041a1de` 那一条只覆盖
    //   「自己的設施」）。
    const { state, topo } = sleepwalkingGame();
    const fac = topo.facilities[0]!;
    const node = topo.nodes.find((n) => n.ref.kind === 'facility' && n.ref.index === fac.id);
    if (node === undefined) throw new Error('找不到那个設施的节点');
    const at: GameState = {
      ...state,
      phase: 'settling',
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: node.id, cash: 10_000_000 } : p,
      ),
    };
    const after = reduce(at, { type: 'settle' }, topo);
    expect(after.pending?.kind).toBe('buyFacility');
    // 地还是无主的（还没答）
    expect(after.facilityOwner[fac.id]).toBe(0);
  });
});

// ============================================================
//  ③ 不炒股
// ============================================================

describe('★ 不炒股（上市企业落点连框都不开）', () => {
  have('梦游中落到上市企业上：`pending` 为 null', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const node = map.nodes.find((n) => n.ref.kind === 'commercial' && n.specialKind === 0);
    if (node === undefined) throw new Error('地图 0 上没有纯粹的上市企业格');
    const { state } = sleepwalkingGame();
    const at: GameState = {
      ...state,
      phase: 'settling',
      day: 5, // 非元旦（休市日会掩盖这一条）
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, nodeId: node.id, cash: 10_000_000 } : p,
      ),
    };
    expect(reduce(at, { type: 'settle' }, topo).pending).toBeNull();
  });

  have('★ 对照组：同一天、同一个格子、**不梦游**就会开框（证明上面那条不是别的原因）', () => {
    const map = loadMap();
    const topo = topoOf(map);
    const node = map.nodes.find((n) => n.ref.kind === 'commercial' && n.specialKind === 0);
    if (node === undefined) throw new Error('地图 0 上没有纯粹的上市企业格');
    const { state } = sleepwalkingGame();
    const awake: GameState = {
      ...state,
      blocking: undefined,
      phase: 'settling',
      day: 5,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, nodeId: node.id, cash: 10_000_000, blocking: { ...p.blocking, sleepWalking: 0 } }
          : p,
      ),
    } as GameState;
    const after = reduce(awake, { type: 'settle' }, topo);
    expect(after.pending?.kind).toBe('buyShares');
  });
});

// ============================================================
//  ④ 收租豁免：梦游中路过别人的地不付钱
// ============================================================

describe('★ 梦游中收租豁免 @source 0x0041d559', () => {
  have('`tollExemption` 判 `sleepWalking`', () => {
    const { state } = sleepwalkingGame();
    const b = state.players[1]!.blocking;
    expect(tollExemption({ ...state.players[1]!, blocking: { ...b, sleepWalking: 1 } }, 0, 0)).toBe(
      'sleepWalking',
    );
    expect(tollExemption({ ...state.players[1]!, blocking: { ...b, sleepWalking: 0 } }, 0, 0)).toBeNull();
  });
});
