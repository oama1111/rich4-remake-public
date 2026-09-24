/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 用道具接入 reduce
 */

import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce } from './reduce.ts';
import { canUseTool } from './preview.ts';
import type { GameState } from './types.ts';
import { TOOL_SLOTS_PER_PLAYER, toolCount } from '../rules/tools.ts';
import { TRAFFIC_CAR, TRAFFIC_MOTORCYCLE, TRAFFIC_WALK } from '../rules/tool-effects.ts';

const topo = { nodes: [makeNode({ id: 1, adjacent: [1] }), makeNode({ id: 2, adjacent: [1] })] };

/** 给玩家 0 发几个道具 */
function withTools(counts: Record<number, number>, over: Partial<GameState> = {}): GameState {
  const tools = new Array<number>(4 * TOOL_SLOTS_PER_PLAYER).fill(0);
  for (const [id, n] of Object.entries(counts)) tools[Number(id)] = n;
  return makeGameState({
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ index: i, character: i, nodeId: 1, trafficMethod: TRAFFIC_WALK, ndices: 1 }),
    ),
    tools,
    ...over,
  });
}

describe('★ 交通工具', () => {
  it('★ 用汽車：交通方式变 2、骰子变 3、道具被收走', () => {
    const s = withTools({ 6: 1 });
    const after = reduce(s, { type: 'useTool', toolId: 6 }, topo);
    expect(after.players[0]!.trafficMethod).toBe(TRAFFIC_CAR);
    expect(after.players[0]!.ndices).toBe(3);
    expect(toolCount(after.tools, 0, 6)).toBe(0);
  });

  it('★ 已经是同一种车时不消耗道具 —— 原版直接 jmp 结束，不走 take_tool', () => {
    const s = withTools({ 6: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, nodeId: 1, trafficMethod: TRAFFIC_CAR, ndices: 3 }),
      ),
    });
    expect(reduce(s, { type: 'useTool', toolId: 6 }, topo)).toBe(s);
  });

  it('★ 换车时旧车退还成道具', () => {
    const s = withTools({ 6: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, nodeId: 1, trafficMethod: TRAFFIC_MOTORCYCLE, ndices: 2 }),
      ),
    });
    const after = reduce(s, { type: 'useTool', toolId: 6 }, topo);
    expect(after.players[0]!.trafficMethod).toBe(TRAFFIC_CAR);
    // 機車（5）被退回来
    expect(toolCount(after.tools, 0, 5)).toBe(1);
  });

  it('没有这个道具就什么都不做', () => {
    const s = withTools({});
    expect(reduce(s, { type: 'useTool', toolId: 6 }, topo)).toBe(s);
  });
});

describe('★ 放置类道具', () => {
  it('★ 路障放到指定格上，占一个物件槽', () => {
    const s = withTools({ 2: 1 });
    const before = s.objects.filter((o) => o.nodeId !== 0).length;
    const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
    expect(after.objects.filter((o) => o.nodeId !== 0).length).toBe(before + 1);
    // 路障的物件种类是 16
    expect(after.objects.some((o) => o.nodeId === 2 && o.type === 16)).toBe(true);
    expect(toolCount(after.tools, 0, 2)).toBe(0);
  });

  it('地雷 17、定時炸彈 18', () => {
    for (const [tool, type] of [
      [3, 17],
      [4, 18],
    ] as const) {
      const s = withTools({ [tool]: 1 });
      const after = reduce(s, { type: 'useTool', toolId: tool, nodeId: 2 }, topo);
      expect(after.objects.some((o) => o.nodeId === 2 && o.type === type)).toBe(true);
    }
  });

  it('没给格子就不放', () => {
    const s = withTools({ 2: 1 });
    expect(reduce(s, { type: 'useTool', toolId: 2 }, topo)).toBe(s);
  });

  /*
   * ★★ 需求方 2026-09-22（第九份試玩回報 #4）拍板：
   *   「路障/炸弹/定时炸弹 我记得就是不能和神明重叠，按这个改」
   *
   * ★★ 2026-09-24 订正：这**不是**偏离 —— 原版拾取层就挡（`tools.md:496` 只看了效果函数）：
   *   真人拾取图 0x409b18 与电脑候选 0x409ef9 都 `test dword [node+0x24], 0xffff00 / jne 跳过`
   *   （0x00409bc0 / 0x00409f7c），有人 / 惡人 / 物件的格子都点不到、挑不到。
   *   这一组钉「神明」那一支；地雷叠地雷 / 站着人那几支见下一组。
   */
  describe('★★ 不许和神明（唯一物件）同格', () => {
    /** 把 0 号物件槽（小財神）摆到某一格上 */
    const withGodAt = (base: GameState, nodeId: number, attached = 0): GameState => ({
      ...base,
      objects: base.objects.map((o, i) =>
        i === 0 ? { ...o, type: 1, nodeId, state: 0, attached } : o,
      ),
    });

    it('★ 那一格有神明 ⇒ 路障(2)/地雷(3)/定時炸彈(4) 一个都放不下去，道具也不收走', () => {
      for (const tool of [2, 3, 4]) {
        const s = withGodAt(withTools({ [tool]: 1 }), 2);
        const after = reduce(s, { type: 'useTool', toolId: tool, nodeId: 2 }, topo);
        expect(after, `道具 ${tool} 不该生效`).toBe(s);
        expect(toolCount(after.tools, 0, tool), `道具 ${tool} 不该被收走`).toBe(1);
        expect(after.objects.some((o) => o.nodeId === 2 && o.type >= 16), '地上不该多一件').toBe(false);
      }
    });

    it('★ 神明在**别的**格子上不影响放置（不能一禁禁一片）', () => {
      const s = withGodAt(withTools({ 2: 1 }), 1);
      const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
      expect(after).not.toBe(s);
      expect(after.objects.some((o) => o.nodeId === 2 && o.type === 16)).toBe(true);
      expect(toolCount(after.tools, 0, 2)).toBe(0);
    });

    it('★ 已经**附身**的神明不算「站在这一格」（跟着主人走，不挡）', () => {
      const s = withGodAt(withTools({ 2: 1 }), 2, 1);
      const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
      expect(after.objects.some((o) => o.nodeId === 2 && o.type === 16)).toBe(true);
    });

    it('★ 客户端候选会自动跟着 core 走（`canUseTool` = `useToolAction(...) !== state`）', () => {
      // 这一条钉的是「不用另写一套客户端过滤」——`picking.ts` 靠的就是 `canUseTool`
      // （四个人都站在 1 号格上 ⇒ 1 号格本身就不空；「空的那一格」另开一个没人站的 3 号格）
      const topo3 = { nodes: [...topo.nodes, makeNode({ id: 3, adjacent: [1] })] };
      const s = withGodAt(withTools({ 2: 1 }), 2);
      expect(canUseTool(s, topo3, 2, 2), '有神明那一格 ⇒ 不是合法目标').toBe(false);
      expect(canUseTool(s, topo3, 2, 3), '空的那一格 ⇒ 合法').toBe(true);
    });
  });
});

describe('未实现的道具', () => {
  it('★ 安静地什么都不做，也不消耗', () => {
    // 7 飛彈、10 時光機 都还没实现
    for (const id of [7, 10]) {
      const s = withTools({ [id]: 1 });
      expect(reduce(s, { type: 'useTool', toolId: id }, topo)).toBe(s);
    }
  });
});

describe('出局者', () => {
  it('不能用道具', () => {
    const s = withTools({ 6: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({ index: i, nodeId: 1, whoPlays: i === 0 ? 0 : 1 }),
      ),
    });
    expect(reduce(s, { type: 'useTool', toolId: 6 }, topo)).toBe(s);
  });
});

describe('★ 遙控骰子（8）', () => {
  it('指定点数 → 存进 forcedDice，道具被收走', () => {
    const s = withTools({ 8: 1 });
    const r = reduce(s, { type: 'useTool', toolId: 8, value: 12 }, topo);
    expect(r.forcedDice).toBe(12);
    expect(toolCount(r.tools, 0, 8)).toBe(0);
  });

  it('★ 下一次掷骰吃掉它，然后**用完即消**', () => {
    const s = withTools({ 8: 1 });
    const set = reduce(s, { type: 'useTool', toolId: 8, value: 7 }, topo);
    const rolled = reduce({ ...set, phase: 'awaitingRoll' }, { type: 'rollDice' }, topo);
    expect(rolled.dice).toEqual([7]);
    expect(rolled.stepsRemaining).toBe(7);
    // @source 0x00447285 读出来就把 [0x475dd8] 清零
    expect(rolled.forcedDice).toBe(0);
  });

  it('没给点数（或越界）就不消耗道具', () => {
    const s = withTools({ 8: 1 });
    expect(reduce(s, { type: 'useTool', toolId: 8 }, topo)).toBe(s);
    expect(reduce(s, { type: 'useTool', toolId: 8, value: 99 }, topo)).toBe(s);
  });
});

describe('★ 機器工人（9）与飛彈（7/13）需要地图，见 tool-landing.test.ts', () => {
  it('没有地块信息时机器工人不生效，也不消耗道具', () => {
    const s = withTools({ 9: 1 });
    expect(reduce(s, { type: 'useTool', toolId: 9, nodeId: 1 }, topo)).toBe(s);
  });
});

/*
 * ★★ 第十一份試玩回報 #3（`feedback/20260922-200005`「NPC放置炸弹、定时炸弹时好像也有台词」）：
 *   原版 13 件道具在用的那一下都 `player_say(角色, 0, _tool_strings[角色][道具号−1])`，
 *   而且**在 human/AI 分流之前**（所以电脑也说）。本引擎先前整条通道没接 ——
 *   现在由 `GameState.lastToolUsed` 这条瞬态提示交出去（规矩同 `lastCardPlay`）。
 */
describe('★★ 道具台词的提示字段（第十一份回报 #3）', () => {
  it('★ 真的用出去 ⇒ 写 `lastToolUsed`（谁、哪一件）', () => {
    const s = withTools({ 2: 1 });
    const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
    expect(after.lastToolUsed).toEqual({ player: 0, toolId: 2 });
  });

  it('★ 没生效（没这道具）⇒ **不写**（与 `lastCardPlay` 同一条规矩：用出去了才写）', () => {
    const s = withTools({});
    const after = reduce(s, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
    expect(after).toBe(s);
    expect(after.lastToolUsed).toBeNull();
  });

  it('★ 目标格被引擎拒（有神明）⇒ 也不写', () => {
    const base = withTools({ 2: 1 });
    const withGod = {
      ...base,
      objects: base.objects.map((o, i) => (i === 0 ? { ...o, type: 1, nodeId: 2, state: 0, attached: 0 } : o)),
    };
    const after = reduce(withGod, { type: 'useTool', toolId: 2, nodeId: 2 }, topo);
    expect(after.lastToolUsed).toBeNull();
  });

  it('★ 电脑也会写（原版这句在 human/AI 分流之前）', () => {
    const s = withTools({ 4: 1 });
    const after = reduce(s, { type: 'useTool', toolId: 4, nodeId: 2 }, topo);
    expect(after.lastToolUsed).toEqual({ player: 0, toolId: 4 });
  });
});

/*
 * ★★ 需求方 2026-09-24「Npc把地雷重叠放置了」（`20260924-025833909-manual-Charles.json` #108：
 *   3 号电脑把地雷放到 37 号格，那格 #3 已经有 1 号电脑放的地雷）。
 *
 * @source 0x00409bc0（真人拾取图 0x409b18）/ 0x00409f7c（电脑候选 0x409ef9）：
 *   `test dword [node+0x24], 0xffff00 / jne 跳过` —— bits 8..11 玩家、12..15 惡人、16..21 物件。
 */
describe('★★ 放置类道具：有人 / 惡人 / 任何物件的格子都放不上去（0xffff00）', () => {
  /** 1 号物件槽之后第一个空的放置类槽里摆一件地雷到某格 */
  const withMineAt = (base: GameState, nodeId: number): GameState => {
    const r = reduce(base, { type: 'useTool', toolId: 3, nodeId }, topo);
    expect(r.objects.some((o) => o.nodeId === nodeId && o.type === 17)).toBe(true);
    return r;
  };
  /** 四个人都挪到 1 号格之外（2 号格留空） */
  const onNode1 = (counts: Record<number, number>): GameState => withTools(counts);

  it('★★ 地雷叠地雷 / 路障叠地雷 / 定時炸彈叠地雷 —— 一个都放不下，道具不收走', () => {
    for (const tool of [2, 3, 4]) {
      const s = withMineAt(onNode1({ 3: 1, [tool]: tool === 3 ? 2 : 1 }), 2);
      const after = reduce(s, { type: 'useTool', toolId: tool, nodeId: 2 }, topo);
      expect(after, `道具 ${tool} 不该叠上去`).toBe(s);
      expect(after.objects.filter((o) => o.nodeId === 2 && o.attached === 0).length).toBe(1);
    }
  });

  it('★ 有人站着的格子（包括自己脚下）放不上去', () => {
    const s = onNode1({ 3: 1 });
    expect(reduce(s, { type: 'useTool', toolId: 3, nodeId: 1 }, topo)).toBe(s);
    expect(canUseTool(s, topo, 3, 1)).toBe(false);
  });

  it('★ 被关着的人不占位（0x0043d61d 清位不置）⇒ 关押格照样能放', () => {
    const s = withTools({ 3: 1 }, {
      players: [0, 1, 2, 3].map((i) =>
        makePlayer({
          index: i,
          character: i,
          nodeId: i === 1 ? 2 : 1,
          trafficMethod: TRAFFIC_WALK,
          ndices: 1,
          ...(i === 1 ? { blocking: { ...makePlayer({ index: 1 }).blocking, inPrison: 3 } } : {}),
        }),
      ),
    });
    const after = reduce(s, { type: 'useTool', toolId: 3, nodeId: 2 }, topo);
    expect(after.objects.some((o) => o.nodeId === 2 && o.type === 17)).toBe(true);
  });

  it('★ 惡人站在棋盘上的那一格放不上去', () => {
    const base = withTools({ 3: 1 });
    const actors = base.specialActors.map((a, i) => (i === 0 ? { ...a, nodeId: 2, place: 0 } : a));
    const s: GameState = { ...base, specialActors: actors as GameState['specialActors'] };
    expect(reduce(s, { type: 'useTool', toolId: 3, nodeId: 2 }, topo)).toBe(s);
  });
});
