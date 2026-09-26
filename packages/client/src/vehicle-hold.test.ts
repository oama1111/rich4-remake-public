/*
 * 第二十六份試玩回報（`20260924-234350490`，联机）「约翰乔的汽车哪里来的」—— 换车那一刻看得见
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版电脑用汽車：`0x00448070` 「使用汽車」框（1500 ms，底下还是旧图组）→ `0x0044807e` 道具函数：
 * `0x00446f3d` 交通 2 / 骰子 3 → `call 0x40b93b` 换图组 → 道具台词 `#0235`。取证全文见 `vehicle-hold.ts`。
 * 真人走道具欄（没有那扇框）⇒ 当场换图。单机 / 联机的 core 给出同一份 `before → after`，这里两种模式都跑。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newGame, parseMap, reduce, type GameState } from '@rich4/core';
import { characterSetBase } from './assets.ts';
import { AI_TOOL_NOTICE_KEY, applyVehicleHold, vehicleHoldOf } from './vehicle-hold.ts';
import { NOTICE_TIER } from './presentation-order.ts';
import { DETECTORS, TOOL_LINE_ORDER } from './speech.ts';
import { cardGained, shopVisitAction } from './event-box-screen.ts';
import { SPECIAL_KIND } from '@rich4/core';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;

const CAR = 6;

/** 0 号真人、其余电脑；`who` 手里有一辆汽車、还在步行，轮到他 */
function scene(mode: 'single' | 'multiplayer', who: number): { s: GameState; topo: Parameters<typeof reduce>[2] } {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
  const s0 = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: i === 0 ? ('human' as const) : ('computer' as const) })),
    seed: 7,
    mode,
  });
  const tools = [...s0.tools];
  tools[who * 15 + CAR] = 1;
  return {
    topo,
    s: {
      ...s0,
      currentPlayer: who,
      phase: 'awaitingRoll',
      pending: null,
      tools,
      players: s0.players.map((p) => ({ ...p, whoPlays: p.landingWhoPlays ?? p.whoPlays, trafficMethod: 0, ndices: 1 })),
    },
  };
}

describe('★★ 电脑换车：「使用汽車」框底下还是旧图组，框收了才换（单机 / 联机同一条路）', () => {
  for (const mode of ['single', 'multiplayer'] as const) {
    run(`★ ${mode}：电脑（約翰喬）用汽車 ⇒ 按住步行图组与 1 颗骰子；放开后才是汽車 / 3 颗`, () => {
      const { s, topo } = scene(mode, 1);
      const after = reduce(s, { type: 'useTool', toolId: CAR }, topo);
      expect(after.notices.some((n) => n.key === AI_TOOL_NOTICE_KEY)).toBe(true);
      const hold = vehicleHoldOf(s, after);
      expect(hold).toEqual({ player: 1, trafficMethod: 0, ndices: 1 });
      const shown = applyVehicleHold(after, hold);
      // 框底下：棋盘画的是步行那一组（`0x40bbd8`：0x80 + 角色×21 + 3×traffic）
      expect(characterSetBase(shown.players[1]!.character, shown.players[1]!.trafficMethod)).toBe(
        characterSetBase(s.players[1]!.character, 0),
      );
      expect(shown.players[1]!.ndices).toBe(1);
      // 别人一个字节不动；state 本身不被改（C-DET-4）
      expect(shown.players[0]).toBe(after.players[0]);
      expect(after.players[1]!.trafficMethod).toBe(2);
      // 框收掉 ⇒ 放开（宿主把 hold 置 null）⇒ 汽車那一组、3 颗骰子
      const released = applyVehicleHold(after, null);
      expect(released).toBe(after);
      expect(released.players[1]!.ndices).toBe(3);
    });
  }

  run('★ 真人用汽車（道具欄，没有「使用%s」框）⇒ 不按住，当场换图 —— 与原版 `0x447d97` 那一路一致', () => {
    const { s, topo } = scene('multiplayer', 0);
    const after = reduce(s, { type: 'useTool', toolId: CAR }, topo);
    expect(after.players[0]!.trafficMethod).toBe(2);
    expect(after.notices.some((n) => n.key === AI_TOOL_NOTICE_KEY)).toBe(false);
    expect(vehicleHoldOf(s, after)).toBeNull();
  });

  run('★ 同一条 action 的下一拍（提示已清 / 没换车）不再按住', () => {
    const { s, topo } = scene('multiplayer', 1);
    const after = reduce(s, { type: 'useTool', toolId: CAR }, topo);
    // 旁观端收到的下一条 action：`lastToolUsed` 引用没变 ⇒ 不是新的换车
    expect(vehicleHoldOf(after, after)).toBeNull();
  });

  it('★ 先后：框是 `lead` 档、道具台词是 `beforeStage` ⇒ 框 → 换图 → 「#0235 嗨！寶貝～一起去兜風吧！」', () => {
    expect(NOTICE_TIER['tool.aiUse']).toBe('lead');
    expect(TOOL_LINE_ORDER).toBe('beforeStage');
  });

  for (const mode of ['single', 'multiplayer'] as const) {
    run(`★ ${mode}：电脑进百貨当场买卡（不挂 pending）⇒ 仍认得出「在店里」，不起「抽到卡片」卡面（原版买卡零图形）`, () => {
      const map = parseMap(new Uint8Array(readFileSync(MAP)));
      const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
      const store = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.DEPARTMENT_STORE)!;
      const s0 = scene(mode, 1).s;
      const s: GameState = {
        ...s0,
        phase: 'settling',
        stepsRemaining: 0,
        players: s0.players.map((p, i) => (i === 1 ? { ...p, nodeId: store.id, points: 600, cards: [] } : p)),
      };
      const after = reduce(s, { type: 'settle' }, topo);
      expect(after.pending).toBeNull();
      expect(cardGained(s, after)).not.toBeNull(); // 手牌确实变长了
      expect(shopVisitAction(s, after, topo)).toBe(true); // ⇒ 事件框让开
      // 原版电脑那一支没有台词 / 框（非董事長）：一个探测器都不该响、也没有訊息框
      expect(DETECTORS.flatMap((d) => d.detect(s, after, topo))).toEqual([]);
      expect(after.notices).toEqual([]);
    });
  }

  it('★ main.ts 接线（原始码钉）：`startActionFx` 立、每帧 `tickVehicleHold` 在框收掉时放、棋盘那一份叠上按住', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // 单机（dispatch → applyAction）、联机广播（applyAction）、电脑直路（scheduleAi）都经 `startActionFx`
    const fx = main.slice(main.indexOf('function startActionFx('));
    expect(fx.slice(0, fx.indexOf('\n}\n'))).toContain('const vh = vehicleHoldOf(before, state);');
    expect(main).toContain('if (vehicleHold === null || noticeKeyShowing(AI_TOOL_NOTICE_KEY)) return;');
    expect(main).toContain('    tickVehicleHold();');
    expect(main).toContain('return applyVehicleHold(boardDrawStateHeld(), vehicleHold);');
  });
});

