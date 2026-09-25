/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 回合循环的出处审计（2026-09-24，`docs/audit/provenance-loop.md`）—— 每条修正一组断言。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSave } from '../loaders/save.ts';
import { parseMap } from '../loaders/map.ts';
import { importOriginalSave } from '../loaders/savegame.ts';
import { ORIGINAL_STATE_BLOCK_SIZE, writeStateBlock } from '../loaders/save-writer.ts';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from './reduce.ts';
import { RELEASE_PENDING, tickTurnCounters } from '../rules/blocking.ts';
import { startingMoney } from '../rules/setup.ts';
import { relocateMonthlyObjects } from '../rules/monthly-objects.ts';
import { OBJECT_TYPE_GIFT, OBJECT_TYPE_TREASURE } from '../rules/object-landing.ts';
import { TOOL_SLOTS_PER_PLAYER, toolCount } from '../rules/tools.ts';
import { TRAFFIC_ENGINEERING, TRAFFIC_MOTORCYCLE, TRAFFIC_WALK } from '../rules/tool-effects.ts';
import { WHO_PLAYS_HUMAN, WHO_PLAYS_RETURN_TO_BOARD, type GameState, type Player } from './types.ts';
import { CONFINEMENT_GATE_TYPE, sendToConfinement } from '../rules/confinement.ts';

const ring: MapTopology = {
  nodes: [1, 2, 3, 4, 5, 6].map((id) =>
    makeNode({ id, x: id * 400, y: 0, adjacent: [id === 1 ? 6 : id - 1, id === 6 ? 1 : id + 1] }),
  ),
};

/** 0 号玩家；1 号当「上一位」—— endTurn 交接给 0 号 = 原版 `0x419039 call 0x41c84f(0)` */
function handoff(over: Partial<Player>, extra: Partial<GameState> = {}): GameState {
  const s = makeGameState({
    players: [0, 1].map((i) => makePlayer({ index: i, nodeId: 1, ...(i === 0 ? over : {}) })),
    phase: 'turnEnd',
    currentPlayer: 1,
    ...extra,
  });
  return reduce(s, { type: 'endTurn' }, ring);
}

const NO_BLOCK = { inHotel: 0, disappearing: 0, inPrison: 0, inHospital: 0, sleeping: 0, sleepWalking: 0, stopping: 0, tortoiseWalking: 0 };

describe('★ 龜行（烏龜卡）：只走一步、不掷骰 @source 0x0040dd7e', () => {
  it('rollDice：一步、不动 rng、不消耗遙控骰子、总步数沿用上一掷', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, lastNodeId: 6, blocking: { ...NO_BLOCK, tortoiseWalking: 2 } })],
      phase: 'awaitingRoll',
      forcedDice: 5,
      stepsTotal: 9,
    });
    const r = reduce(s, { type: 'rollDice' }, ring);
    expect(r.phase).toBe('moving');
    expect(r.stepsRemaining).toBe(1);
    expect(r.dice).toEqual([]);
    expect(r.rngState).toBe(s.rngState);
    expect(r.forcedDice).toBe(5);
    expect(r.stepsTotal).toBe(9);
  });

  it('停留优先于龜行（`0x0040dd64` 在 `0x0040dd7e` 之前）', () => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 1, blocking: { ...NO_BLOCK, stopping: 1, tortoiseWalking: 2 } })],
      phase: 'awaitingRoll',
    });
    expect(reduce(s, { type: 'rollDice' }, ring).phase).toBe('turnEnd');
  });

  it('关押期间龜行不走天（`0x0041cafe jne 0x41cb6d` 跳过 +0x39）', () => {
    const p = makePlayer({ blocking: { ...NO_BLOCK, inPrison: 3, tortoiseWalking: 2 } });
    expect(tickTurnCounters(p).player.blocking.tortoiseWalking).toBe(2);
    const free = makePlayer({ blocking: { ...NO_BLOCK, tortoiseWalking: 2 } });
    expect(tickTurnCounters(free).player.blocking.tortoiseWalking).toBe(1);
  });
});

describe('★ 释放那一天：住宿/监狱/医院仍算「关着」（`0x40d6be` 不写计数）', () => {
  it('刑满释放当天冬眠 / 龜行不走天；消失释放当天照走（`0x40d52c` 清 +0x33）', () => {
    const jailed = handoff({ blocking: { ...NO_BLOCK, inPrison: RELEASE_PENDING, sleeping: 3, tortoiseWalking: 3 } });
    expect(jailed.players[0]!.blocking).toMatchObject({ sleeping: 3, tortoiseWalking: 3 });
    const vanished = handoff({ blocking: { ...NO_BLOCK, disappearing: RELEASE_PENDING, sleeping: 3, tortoiseWalking: 3 } });
    expect(vanished.players[0]!.blocking).toMatchObject({ sleeping: 2, tortoiseWalking: 2 });
  });
});

describe('★ 保險期在 0x41c84f 走（被挡的人也走）', () => {
  it('坐牢中也递减', () => {
    const r = handoff({ insuranceDays: 4, blocking: { ...NO_BLOCK, inPrison: 5 } });
    expect(r.players[0]!.insuranceDays).toBe(3);
  });
});

describe('★ 開局资金：真人对半、电脑按角色比例 @source 0x004072ff / 0x00407307', () => {
  it('阿土伯（ratio 40）：真人 150000/150000，电脑 120000/180000', () => {
    expect(startingMoney(1, 300_000, true)).toEqual({ cash: 150_000, moneyInBank: 150_000 });
    expect(startingMoney(1, 300_000, false)).toEqual({ cash: 120_000, moneyInBank: 180_000 });
  });
});

describe('★ 跨月重摆禮物 / 寶箱 @source 0x0041d0a5..0x0041d0f6', () => {
  const nodes = ring.nodes;
  it('被拿走的也重新登场；各抽签，按先禮物后寶箱', () => {
    const s = makeGameState({ players: [makePlayer({ index: 0, nodeId: 1 })] });
    const objects = s.objects.map((o) => ({ ...o }));
    // 禮物已被拿走（nodeId 0），寶箱在 3 号格
    objects[OBJECT_TYPE_TREASURE - 1]!.nodeId = 3;
    let n = 0;
    const draws = [0, 1, 2, 3, 4, 5, 6, 7];
    const r = relocateMonthlyObjects({ ...s, objects }, nodes, () => draws[n++]!);
    expect(r.objects[OBJECT_TYPE_GIFT - 1]!.nodeId).not.toBe(0);
    expect(r.objects[OBJECT_TYPE_TREASURE - 1]!.nodeId).not.toBe(0);
    // 两件不叠格、也不落在有人站的 1 号格
    expect(r.objects[OBJECT_TYPE_GIFT - 1]!.nodeId).not.toBe(r.objects[OBJECT_TYPE_TREASURE - 1]!.nodeId);
    expect([r.objects[OBJECT_TYPE_GIFT - 1]!.nodeId, r.objects[OBJECT_TYPE_TREASURE - 1]!.nodeId]).not.toContain(1);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('跨月那次日推进里真的跑到（1 月 31 日 → 2 月 1 日）', () => {
    const r = handoff({}, { year: 1998, month: 1, day: 31, currentPlayer: 1 });
    expect(r.month).toBe(2);
    expect(r.objects[OBJECT_TYPE_GIFT - 1]!.nodeId).not.toBe(0);
    expect(r.objects[OBJECT_TYPE_TREASURE - 1]!.nodeId).not.toBe(0);
  });
});

describe('★ 工程車到期 @source 0x0041cca3..0x0041cd89', () => {
  it('每天 −4，7 天后还原成步行（没有暂存的交通工具）', () => {
    let s = handoff({ trafficMethod: TRAFFIC_ENGINEERING, ndices: 1 });
    expect(s.players[0]!.trafficMethod).toBe(TRAFFIC_ENGINEERING - 4);
    for (let i = 0; i < 6; i++) {
      s = reduce({ ...s, currentPlayer: 1, phase: 'turnEnd', pending: null }, { type: 'endTurn' }, ring);
    }
    expect(s.players[0]!.trafficMethod).toBe(TRAFFIC_WALK);
    expect(s.players[0]!.ndices).toBe(1);
  });

  it('开之前骑機車且道具栏里还有機車 ⇒ 骑回去、機車 −1', () => {
    const base = makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, nodeId: 1, ...(i === 0 ? { trafficMethod: 7, ndices: 1, engineSavedTraffic: TRAFFIC_MOTORCYCLE, engineSavedDice: 2 } : {}) }),
      ),
      phase: 'turnEnd',
      currentPlayer: 1,
    });
    const tools = [...base.tools];
    tools[0 * TOOL_SLOTS_PER_PLAYER + 5] = 1;
    const r = reduce({ ...base, tools }, { type: 'endTurn' }, ring);
    expect(r.players[0]!.trafficMethod).toBe(TRAFFIC_MOTORCYCLE);
    expect(r.players[0]!.ndices).toBe(2);
    expect(toolCount(r.tools, 0, 5)).toBe(0);
  });
});

describe('★ 走回棋盘：清四项计数要走够 32 像素（loop F4）@source 0x0040c276..0x0040c3cf', () => {
  const walkBack = (xpos: number): GameState => {
    const s = makeGameState({
      players: [makePlayer({ index: 0, nodeId: 2, xpos, ypos: 0, whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_RETURN_TO_BOARD, blocking: { ...NO_BLOCK, inHotel: RELEASE_PENDING } })],
      phase: 'turnStart',
    });
    return reduce(s, { type: 'startTurn' }, ring);
  };
  it('贴图位离格子 ≥ 32（dx²+dy² ≥ 1024）⇒ 清；< 32 ⇒ 不清（仍 0x80）', () => {
    // 2 号格在 (800, 0)
    expect(walkBack(800 - 32).players[0]!.blocking.inHotel).toBe(0);
    expect(walkBack(800 - 31).players[0]!.blocking.inHotel).toBe(RELEASE_PENDING);
    expect(walkBack(800).players[0]!.blocking.inHotel).toBe(RELEASE_PENDING);
    // 两种都落定到格子坐标
    expect(walkBack(800 - 31).players[0]!.xpos).toBe(800);
  });
});

describe('★ 住店前的朝向（+0x1b）在走回棋盘收尾还原（loop F2）@source 0x00418f2e..0x00418f3c', () => {
  const ending = (savedFacing: number | undefined): GameState => {
    const s = makeGameState({
      players: [0, 1].map((i) =>
        makePlayer({ index: i, nodeId: 2, direction: 5, ...(i === 0 ? { whoPlays: WHO_PLAYS_HUMAN | WHO_PLAYS_RETURN_TO_BOARD, ...(savedFacing === undefined ? {} : { savedFacing }) } : {}) }),
      ),
      phase: 'turnEnd',
      currentPlayer: 0,
    });
    return reduce(s, { type: 'endTurn' }, ring);
  };
  it('存的是 3 ⇒ 还原成 3；哨兵 0xf / 缺省 ⇒ 不动；游标不推进', () => {
    const r = ending(3);
    expect(r.players[0]!.direction).toBe(3);
    expect(r.currentPlayer).toBe(0);
    expect(r.players[0]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(0);
    expect(ending(0xf).players[0]!.direction).toBe(5);
    expect(ending(undefined).players[0]!.direction).toBe(5);
  });
  it('关押写哨兵 0xf（`0x43d637`）', () => {
    const gate = makeNode({ id: 1, type: CONFINEMENT_GATE_TYPE.prison });
    const out = sendToConfinement([makePlayer({ index: 0, nodeId: 3, savedFacing: 4 })], [], [gate], new Array(8).fill(0), 'prison', 0, 3);
    expect(out.players[0]!.savedFacing).toBe(0xf);
  });
});

describe('★ 读原版存档：工程車暂存（+0x64/+0x65）与朝向后备（+0x1b）', () => {
  const ROOT = process.env.RICH4_WORKSPACE ?? '';
  const SAVE = `${ROOT}/Rich4/Save0.dat`;
  const MAP = `${ROOT}/extracted/map/0001.bin`;
  const t = existsSync(SAVE) && existsSync(MAP) ? it : it.skip;
  t('开着工程車的人：engineSaved* = +0x64/+0x65；写回逐字节一致', () => {
    const bytes = new Uint8Array(readFileSync(SAVE));
    const at = 0x10 + 1 * 0x68; // 玩家 1
    bytes[at + 0x11] = 0x1b; // 工程車还剩 6 天
    bytes[at + 0x64] = 2; // 開車前是汽車
    bytes[at + 0x65] = 3;
    bytes[at + 0x1b] = 6;
    const save = parseSave(bytes);
    const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
    const p = state.players[1]!;
    expect(p.engineSavedTraffic).toBe(2);
    expect(p.engineSavedDice).toBe(3);
    expect(p.savedFacing).toBe(6);
    const out = writeStateBlock({ state, carry: bytes.subarray(0, ORIGINAL_STATE_BLOCK_SIZE), mapDataSize: save.mapData.length });
    expect([out[at + 0x11], out[at + 0x64], out[at + 0x65], out[at + 0x1b]]).toEqual([0x1b, 2, 3, 6]);
  });
});
