/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 魔法屋「就地加蓋房屋」对設施生效 @source 0x0040b110 的 0x0040b170 起（T-083 / Q-MAGIC-2）
 */
import { describe, expect, it } from 'vitest';
import { makeFacility, makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { applyMagicRequest, type MapTopology } from '../state/reduce.ts';
import { FACILITY_TYPE_MIN } from '../rules/land.ts';
import { FACILITY_TYPE } from '../rules/facility.ts';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_HUMAN } from '../state/types.ts';

const FAC = 1;
const topo: MapTopology = {
  nodes: [makeNode({ id: 1, adjacent: [1], type: FACILITY_TYPE_MIN + FAC, ref: { kind: 'facility', index: FAC } })],
  lands: [],
  facilities: [makeFacility({ id: FAC })],
};

function onFacility(who: number, owner: number, level: number, type: number) {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, whoPlays: who })),
    currentPlayer: 0,
  });
  const facilityOwner = [...s.facilityOwner];
  const facilityLevel = [...s.facilityLevel];
  const facilityType = [...s.facilityType];
  facilityOwner[FAC] = owner;
  facilityLevel[FAC] = level;
  facilityType[FAC] = type;
  return { ...s, facilityOwner, facilityLevel, facilityType };
}

describe('★ 就地加蓋對設施', () => {
  it('已建的旅館 +1 级；到上限不动', () => {
    const s = onFacility(WHO_PLAYS_COMPUTER, 1, 2, FACILITY_TYPE.hotel);
    const r = applyMagicRequest(s, topo, { player: 0, kind: 'build', amount: 1 });
    expect(r.facilityLevel[FAC]).toBe(3);
    const maxed = onFacility(WHO_PLAYS_COMPUTER, 1, 1, FACILITY_TYPE.park);
    expect(applyMagicRequest(maxed, topo, { player: 0, kind: 'build', amount: 1 })).toBe(maxed);
  });

  it('等级 0：電腦自己的 → rand()%4+1 建一级；别人的 → 公園', () => {
    const mine = applyMagicRequest(onFacility(WHO_PLAYS_COMPUTER, 1, 0, 0), topo, { player: 0, kind: 'build', amount: 1 });
    expect(mine.facilityLevel[FAC]).toBe(1);
    expect(mine.facilityType[FAC]).toBeGreaterThanOrEqual(1);
    expect(mine.facilityType[FAC]).toBeLessThanOrEqual(4);
    const others = applyMagicRequest(onFacility(WHO_PLAYS_COMPUTER, 2, 0, 0), topo, { player: 0, kind: 'build', amount: 1 });
    expect(others.facilityLevel[FAC]).toBe(1);
    expect(others.facilityType[FAC]).toBe(FACILITY_TYPE.park);
  });

  it('等级 0 且是真人：要选种类（0x440aac），本引擎没那一屏 → 不建', () => {
    const s = onFacility(WHO_PLAYS_HUMAN, 1, 0, 0);
    expect(applyMagicRequest(s, topo, { player: 0, kind: 'build', amount: 1 })).toBe(s);
  });
});
