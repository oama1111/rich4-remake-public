/*
 * 第十三份試玩回報 #1（145729）：天使附身、踩自己的空設施地 —— 「空地 → 購物中心 1 级 → 2 级」要看得见两步
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版（取证全文见 `manifest-hold.ts` 文件头）：
 *   付费首建 `0x0041a27c inc` → `0x0041a27f view_to(0,0,1)` 重画（1 级露面）→ 音效 50（`0x0041a289`）
 *   → 尾块天使 `0x0040f493 call 0x40b110`（→ 2 级，不重画）→ `0x0040f4d9` 顯靈框 1500 ms（底下还是 1 级）
 *   → 音效 50（`0x0040f4f8`）→ `0x0040f506 view_to(0,0,1)` 重画（2 级露面）。两次都没有大锤片。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeGameState, newGame, parseMap, reduce, type GameState } from '@rich4/core';
import { buildFxPlan, manifestSoundFor } from './build-fx.ts';
import { applyManifestHold, immediateManifestHints, manifestHoldOf, MANIFEST_NOTICE_KEY } from './manifest-hold.ts';

/** 天使的神明号（`core/rules/god-power.ts` 的 `GOD_ANGEL`）@source 0x0040f3ff `cmp al, 9` 那一支 = 加蓋 */
const GOD_ANGEL = 9;

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

/** 真人玩家 0 带着天使、站在自己名下的空設施格上（等级 0），落点结算问「蓋設施」 */
function angelOnOwnEmptyFacility(): { asked: GameState; topo: Parameters<typeof reduce>[2]; id: number } {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
  const state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) })),
    seed: 7,
  });
  const facNode = map.nodes.find((n) => n.specialKind === 0 && n.ref.kind === 'facility')!;
  if (facNode.ref.kind !== 'facility') throw new Error('地图里找不到設施格');
  const id = facNode.ref.index;
  const facilityOwner = [...state.facilityOwner];
  facilityOwner[id] = 1;
  const s0: GameState = {
    ...state,
    facilityOwner,
    currentPlayer: 0,
    phase: 'settling',
    pending: null,
    stepsRemaining: 0,
    players: state.players.map((p, i) => (i === 0 ? { ...p, nodeId: facNode.id, godInfo: GOD_ANGEL, cash: 500_000 } : p)),
  };
  const asked = reduce(s0, { type: 'settle' }, topo);
  return { asked, topo, id };
}

describe('★★ core：天使 + 自己的空設施地 ⇒ 付费首建 0→1、天使再蓋 1→2（共两级）', () => {
  run('两次 `0x40b110`：首建（`0x0041a27c`）+ 顯靈（`0x0040f493`），顯靈框一扇', () => {
    const { asked, topo, id } = angelOnOwnEmptyFacility();
    expect(asked.pending?.kind).toBe('buildFacility');
    expect(asked.facilityLevel[id] ?? 0).toBe(0);
    const built = reduce(asked, { type: 'buildFacility', facilityType: 2 }, topo); // 購物中心
    expect(built.facilityType[id]).toBe(2);
    expect(built.facilityLevel[id]).toBe(2);
    expect(built.lastBuildUpgrades?.map((h) => h.source)).toEqual(['facilityFirstBuild', 'godManifest']);
    expect(built.notices.map((n) => n.key)).toEqual([MANIFEST_NOTICE_KEY]);
    expect(built.notices[0]!.args).toEqual(['天使']);
    // 两次都没有大锤片、没到 5 级也没有 0x20b
    expect(buildFxPlan(built.lastBuildUpgrades ?? [])).toEqual({ hammer: false, maxLevel: false });
  });

  run('★★ 表现：框没收之前棋盘画 1 级（顯靈之前）；首建那一声当场响，顯靈那一声挪到框收掉', () => {
    const { asked, topo, id } = angelOnOwnEmptyFacility();
    const built = reduce(asked, { type: 'buildFacility', facilityType: 2 }, topo);
    const hold = manifestHoldOf(asked, built);
    expect(hold).not.toBeNull();
    expect([...hold!.facility]).toEqual([[id, 1]]);
    expect(hold!.reachedMaxLevel).toBe(false);
    // 框底下：1 级
    expect(applyManifestHold(built, built, hold).facilityLevel[id]).toBe(1);
    // 框收掉：2 级
    expect(applyManifestHold(built, built, null).facilityLevel[id]).toBe(2);
    // 当场只剩首建那一条（`0x0041a289` 音效 50）；顯靈那一声（`0x0040f4f8`）由宿主在框收掉时补
    const now = immediateManifestHints(built.lastBuildUpgrades ?? [], hold);
    expect(now.map((h) => h.source)).toEqual(['facilityFirstBuild']);
    expect(manifestSoundFor(now)).not.toBeNull();
  });
});

describe('manifestHoldOf —— 只认「本 action 的顯靈加蓋 + 本 action 的顯靈框」', () => {
  const base = makeGameState({});
  const hint = { entity: 0x7d0 + 3, reachedMaxLevel: false, source: 'godManifest' as const };

  it('没有顯靈框（等级 0 設施那一支框在上一条 action 已弹过，`0x800` 不再弹）⇒ 不按住，当场响', () => {
    const after = { ...base, lastBuildUpgrades: [hint] };
    expect(manifestHoldOf(base, after)).toBeNull();
    expect(immediateManifestHints([hint], null)).toEqual([hint]);
  });

  it('有框但不是这条 action 写的加蓋（引用没换）⇒ 不按住', () => {
    const b = { ...base, lastBuildUpgrades: [hint] };
    const a = { ...b, notices: [{ key: 'god.build' as const, args: ['天使'] }] };
    expect(manifestHoldOf(b, a)).toBeNull();
  });

  it('只数 `godManifest`：自己的地升級（`ownUpgrade`）那一级不按住（它在框之前就重画了，`0x004199d4`）', () => {
    const own = { entity: 0x7d0 + 3, reachedMaxLevel: false, source: 'ownUpgrade' as const };
    const a = { ...base, lastBuildUpgrades: [own, hint], notices: [{ key: 'god.build' as const, args: ['大福神'] }] };
    const hold = manifestHoldOf(base, a)!;
    expect([...hold.land]).toEqual([[3, 1]]);
    const landLevel = [...base.landLevel];
    landLevel[3] = 3; // 1 → 2（自己掏钱）→ 3（福神送）
    const shown = applyManifestHold({ ...a, landLevel }, { landLevel, facilityLevel: a.facilityLevel }, hold);
    expect(shown.landLevel[3]).toBe(2);
    expect(immediateManifestHints(a.lastBuildUpgrades, hold)).toEqual([own]);
  });

  it('盖到 5 级那一次记下 `reachedMaxLevel`（0x20b 排在框之后，`0x0040f517`）', () => {
    const a = {
      ...base,
      lastBuildUpgrades: [{ ...hint, reachedMaxLevel: true }],
      notices: [{ key: 'god.build' as const, args: ['天使'] }],
    };
    expect(manifestHoldOf(base, a)!.reachedMaxLevel).toBe(true);
  });
});
