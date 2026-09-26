/*
 * 道具欄 / 卡片欄 浮窗的网格与取数（T-024）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐标全部照 exe（VA 0x445c8f 的命中、VA 0x447cde 的绘制），
 * 把容易写错的几条钉住：格子是 5×3 的 80×56、原点 (19,135)；
 * 道具**紧排**且只列数量 > 0 的；卡片槽号就是数组下标。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeGameState, type GameState, type MapTopology } from '@rich4/core';
import {
  INV_BASE,
  INV_CELL,
  INV_ORIGIN,
  INV_RESOURCE,
  INV_SLOTS,
  INV_VEHICLE_IMAGE,
  TOOLS_NEEDING_TARGET,
  cardEntries,
  routeCardPick,
  hitInventory,
  invCellRect,
  toolEntries,
  toolIsDirect,
} from './inventory.ts';
import { TOOL_SELECT_PARAM } from './picking.ts';

describe('浮窗几何 @source VA 0x445c8f', () => {
  it('★ 底图是 Panel.mkf 资源 11，道具用图 1、卡片用图 0，落在 (14,130)', () => {
    expect(INV_RESOURCE).toBe(11);
    expect(INV_BASE).toEqual({ cards: 0, tools: 1 });
    expect(INV_ORIGIN).toEqual({ x: 14, y: 130 });
  });

  it('★ 5×3 = 15 格，格 80×56、原点 (19,135)；最后一格右下角正好落在 (419,303)', () => {
    expect(INV_SLOTS).toBe(15);
    expect(INV_CELL).toEqual({ x0: 19, y0: 135, w: 80, h: 56, cols: 5, rows: 3 });
    expect(invCellRect(0)).toEqual({ x: 19, y: 135, w: 80, h: 56 });
    expect(invCellRect(4)).toEqual({ x: 339, y: 135, w: 80, h: 56 });
    expect(invCellRect(5)).toEqual({ x: 19, y: 191, w: 80, h: 56 });
    expect(invCellRect(14)).toEqual({ x: 339, y: 247, w: 80, h: 56 });
  });

  it('★ 命中：每格中心命中自己，边界外不认', () => {
    for (let slot = 0; slot < INV_SLOTS; slot++) {
      const r = invCellRect(slot);
      expect(hitInventory(r.x + r.w / 2, r.y + r.h / 2)).toBe(slot);
      expect(hitInventory(r.x, r.y)).toBe(slot); // 左上边界算在内
    }
    expect(hitInventory(418, 302)).toBe(14); // 最后一个像素
    expect(hitInventory(419, 302)).toBeNull(); // 右边界不算
    expect(hitInventory(18, 200)).toBeNull();
    expect(hitInventory(100, 303)).toBeNull();
    expect(hitInventory(100, 134)).toBeNull();
  });
});

describe('格子内容（T-024）', () => {
  /** 只填这一屏用得到的字段 */
  const stateOf = (tools: number[], cards: number[] = []): GameState =>
    ({
      // 道具是**全局表**，步长 15
      tools,
      players: [{ index: 0, cards, trafficMethod: 0 }],
    }) as unknown as GameState;

  it('★ 道具緊排：数量为 0 的跳过且不占格（S8 截图证实 8 号排第 5 格）', () => {
    const tools = new Array<number>(30).fill(0);
    for (const id of [1, 2, 3, 4, 8, 9]) tools[id] = 1;
    const got = toolEntries(stateOf(tools), 0);
    expect(got.map((e) => e.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(got.map((e) => e.id)).toEqual([1, 2, 3, 4, 8, 9]);
    expect(got.every((e) => e.count === 1)).toBe(true);
  });

  it('★ 道具数量原样带出来（同一件可以有多个）', () => {
    const tools = new Array<number>(30).fill(0);
    tools[1] = 3;
    tools[5] = 7;
    expect(toolEntries(stateOf(tools), 0)).toEqual([
      { slot: 0, id: 1, count: 3 },
      { slot: 1, id: 5, count: 7 },
    ]);
  });

  it('★ 只取**当前玩家**那一行（道具表步长 15）', () => {
    const tools = new Array<number>(30).fill(0);
    tools[15 + 1] = 2; // 玩家 1 的道具 1
    expect(toolEntries(stateOf(tools), 0)).toEqual([]);
    expect(toolEntries(stateOf(tools), 1)).toEqual([{ slot: 0, id: 1, count: 2 }]);
  });

  it('★ 卡片槽号就是数组下标（原版两边都按 player_cards[玩家×15+下标] 取）', () => {
    expect(cardEntries(stateOf([], [3, 0, 7]), 0)).toEqual([
      { slot: 0, id: 3, count: 1 },
      { slot: 2, id: 7, count: 1 },
    ]);
    expect(cardEntries(stateOf([], []), 0)).toEqual([]);
  });
});

describe('卡片欄：选一张卡之后走哪条路（T-025）@source VA 0x441c22', () => {
  const topo = { nodes: [], lands: [], facilities: [], commercials: [] } as unknown as MapTopology;
  const stateOf = (cards: number[], over: Partial<GameState> = {}): GameState =>
    ({
      players: [{ index: 0, cards, cash: 0, moneyInBank: 0, loan: 0 }],
      tools: new Array<number>(30).fill(0),
      toolStock: new Array<number>(14).fill(0),
      objects: [],
      specialActors: [],
      holdings: [[]],
      market: { stocks: [] },
      commercialOwners: [],
      currentPlayer: 0,
      priceIndex: 1,
      ...over,
    }) as unknown as GameState;

  it('★ 手上没有的卡 → 走「用不成」（失败音 + 把弹窗开回来）', () => {
    // 均富卡（1，不需要目标）不在手上
    expect(routeCardPick(stateOf([]), topo, 1)).toEqual({ kind: 'cannot', needsOwnList: false });
  });

  it('★ 需要目标的卡 → 进拾取模式，类别与选择参数取自卡片表', () => {
    // 換屋卡（5）：selectionParam 0xe0c0202 → 类别 land
    const r = routeCardPick(stateOf([5]), topo, 5);
    expect(r).toEqual({ kind: 'pick', cls: 'land', param: 0xe0c0202 });
  });

  it('★ 紅卡（24，选股票）那类走**股市屏的选股模式**，不进拾取模式（Q-PICK-2）', () => {
    // @source 紅卡 VA 0x00444ff8 `push 1; call _rich4_ui_stock_entry`
    expect(routeCardPick(stateOf([24]), topo, 24)).toEqual({ kind: 'stockPick', mode: 1 });
    // @source 黑卡 VA 0x004450bc `push 2`
    expect(routeCardPick(stateOf([25]), topo, 25)).toEqual({ kind: 'stockPick', mode: 2 });
  });

  it('★ 請神符（23，选物件）不进拾取模式 —— 原版是**自动请最近的一尊**（Q-PICK-2）', () => {
    // @source VA 0x00444e2e `call 0x444d1a`（没有窗口、没有列表）
    expect(routeCardPick(stateOf([23]), topo, 23)).toEqual({ kind: 'objectAuto' });
  });

  it('★ 改建卡（7）站在等级 ≥ 1 的設施上 → 先过「請選擇設施類別」窗', () => {
    // @source 加蓋卡 VA 0x004431c8 `push 1 / call 0x440aac`；返回 −1 = 取消、卡不消耗
    const facTopo = {
      nodes: [{ id: 1, type: 0xfa0 + 1, ref: { kind: 'facility', id: 1 } }],
      lands: [],
      facilities: [{ id: 1, level: 2, type: 1 }],
      commercials: [],
    } as unknown as MapTopology;
    const st = stateOf([7], {
      players: [
        { index: 0, cards: [7], cash: 0, moneyInBank: 0, loan: 0, nodeId: 1 },
      ],
      facilityLevel: [0, 2],
      facilityType: [0, 1],
      facilityOwner: [0, 1],
      facilityPriceStatus: [0, 0],
    } as unknown as Partial<GameState>);
    expect(routeCardPick(st, facTopo, 7)).toEqual({ kind: 'facilityPick' });
    // 等级 0 的設施：原版不生效，走「用不成」
    const lv0 = stateOf([7], {
      players: [
        { index: 0, cards: [7], cash: 0, moneyInBank: 0, loan: 0, nodeId: 1 },
      ],
      facilityLevel: [0, 0],
      facilityType: [0, 1],
      facilityOwner: [0, 1],
      facilityPriceStatus: [0, 0],
    } as unknown as Partial<GameState>);
    expect(routeCardPick(lv0, facTopo, 7)).toEqual({ kind: 'cannot', needsOwnList: false });
    // 空地（地块等级 0）也走「用不成」—— 那条不需要选种类
    expect(routeCardPick(stateOf([7]), topo, 7)).toEqual({ kind: 'cannot', needsOwnList: false });
  });

  it('★ 不需要目标、且现在出得了的卡 → 直接发', () => {
    const base = makeGameState();
    const players = base.players.map((p, i) => ({
      ...p,
      cash: i === 1 ? 100000 : 0,
      cards: i === 0 ? [1] : [],
    }));
    expect(routeCardPick(makeGameState({ players }), topo, 1)).toEqual({ kind: 'use' });
  });
});

describe('选中之后归谁管', () => {
  it('★ 機器娃娃 / 机車 / 汽車 / 時光機 / **工程車** 不用再问，直接发 useTool', () => {
    // 機器娃娃是自动的（原版 AI 那一支直接回 `PLAIN`，VA 0x420f4d 一带）
    expect(toolIsDirect(1)).toBe(true);
    expect(toolIsDirect(5)).toBe(true); // 機車
    expect(toolIsDirect(6)).toBe(true); // 汽車
    expect(toolIsDirect(10)).toBe(true); // 時光機（只需要快照，不需要目标）
    // ★ 工程車（12）：原版真人那一支拿到弹窗返回值就**直接** `call 道具函数表[12]`
    //   （@source 0x00447f51 `call dword ptr [eax*4 + 0x475dd5]`，eax = esi = 道具号；
    //    表项 12 = `0x4479d2` = `_rich4_use_tool_gongchengche`），
    //   那一支里**没有**拾取器 `call 0x446ae8` ⇒ 没有目标要选。
    expect(toolIsDirect(12)).toBe(true);
  });

  it('★ 其他的都要先选目标/点数 —— 那段属 T-026', () => {
    for (const id of [2, 3, 4, 7, 8, 9, 11, 13]) expect(toolIsDirect(id)).toBe(false);
  });

  it('★★ 工程車（12）不进拾取：它本来就没有拾取参数，兜底分支会把 action 吞掉', () => {
    // 这就是本次 bug 的**根因**：12 曾在 TOOLS_NEEDING_TARGET 里，却没有 TOOL_SELECT_PARAM 项
    // ⇒ `applyInventoryPick` 落进 `param === undefined` 的兜底分支（只写一条日志、**一个 action 都不发**）。
    expect(toolIsDirect(12)).toBe(true);
    expect(TOOL_SELECT_PARAM.has(12)).toBe(false);
  });

  it('★★ 不变量：凡是要选目标的道具，都必须有拾取参数（否则点击静默失效）', () => {
    // 对**任何**道具都成立 —— 改坏 TOOLS_NEEDING_TARGET 与 TOOL_SELECT_PARAM 的对应关系就变红。
    for (const id of TOOLS_NEEDING_TARGET) {
      expect(
        TOOL_SELECT_PARAM.has(id),
        `道具 ${id} 列在 TOOLS_NEEDING_TARGET 却没进 TOOL_SELECT_PARAM ⇒ 点击会静默失效`,
      ).toBe(true);
    }
  });

  it('★ 1..13 全部道具的归宿（没有遗漏、没有重复，别的道具一件都没被顺手拿掉）', () => {
    const direct = [1, 5, 6, 10, 12];
    const pick = [2, 3, 4, 7, 9, 11, 13];
    const dice = 8; // 遙控骰子：自己开点数盘，不进棋盘拾取
    expect([...direct, ...pick, dice].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    for (const id of direct) expect(toolIsDirect(id), `道具 ${id} 应直接发 useTool`).toBe(true);
    for (const id of pick) expect(toolIsDirect(id), `道具 ${id} 应先进拾取`).toBe(false);
    expect(toolIsDirect(dice), '遙控骰子走点数盘').toBe(false);
    expect([...TOOLS_NEEDING_TARGET].sort((a, b) => a - b)).toEqual(pick);
  });

  it('★★ main.ts：`toolIsDirect` 那一支就是发 `useTool`，且在拾取兜底**之前**（源码钉子）', () => {
    // 上面几条证明「12 直接发」，这一条钉住「直接发 = 发 useTool 且 return」这条路径本身
    // —— 与文件末尾「浮窗只认左键按下」同样的源码钉子做法。
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain(
      "if (toolIsDirect(id)) {\n    dispatch({ type: 'useTool', toolId: id });\n    return;\n  }",
    );
    const directAt = src.indexOf('if (toolIsDirect(id)) {');
    const pickAt = src.indexOf('const param = TOOL_SELECT_PARAM.get(id);');
    expect(directAt).toBeGreaterThan(-1);
    expect(pickAt).toBeGreaterThan(-1);
    expect(directAt, '直接发那一支必须排在拾取兜底之前，否则又会静默失效').toBeLessThan(pickAt);
  });

  it('★ 载具徽章：机車 = 图 15、汽車 = 图 16，其余（走路）没有', () => {
    expect(INV_VEHICLE_IMAGE.get(1)).toBe(15);
    expect(INV_VEHICLE_IMAGE.get(2)).toBe(16);
    expect(INV_VEHICLE_IMAGE.get(0)).toBeUndefined();
  });
});

/*
 * ★ 两扇浮窗的**鼠标消息**（卡片欄 `fcn_004416f0`、道具欄 `fcn_00445c14`，同形）：
 *   0x201 左键按下 → 命中格且非空才记选中 + 音效 1；0x202 左键抬手 → 有选中才抛回，**没有就什么都不做**；
 *   0x204 右键按下 → 缺省出口 `DefWindowProcA`（`[0x4622d8]`）；0x205 右键抬手 → 关窗抛回 0（不放音）。
 *   两扇都是 `0x4018e7` 的模态回调（整窗的消息都交给回调栈顶），格外的点击也由它们收。
 */
const ROOT = process.env.RICH4_WORKSPACE ?? '';
const EXE = `${ROOT}/Rich4/rich4.exe`;
const runExe = existsSync(EXE) ? it : it.skip;
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}
/** `jcc rel8` / `jcc rel32`（0f 8x）的落点 */
function jccTarget(va: number, b: number[]): number {
  if (b[0] === 0x0f) {
    const rel = (b[2]! | (b[3]! << 8) | (b[4]! << 16) | (b[5]! << 24)) | 0;
    return va + 6 + rel;
  }
  return va + 2 + ((b[1]! << 24) >> 24);
}

describe('★ 浮窗鼠标消息分派 @source fcn_004416f0（卡片欄）/ fcn_00445c14（道具欄）', () => {
  for (const [name, h] of [
    ['卡片欄', { cmp202: 0x441703, jb: 0x441708, jbe202: 0x44170a, cmp205: 0x441710, jb205: 0x441715, jbe205: 0x44171b,
      up: 0x441889, upJe: 0x441890, upJeLen: 6, rup: 0x4418b9, deflt: 0x44191f, sel: 0x48c544 }],
    ['道具欄', { cmp202: 0x445c27, jb: 0x445c2c, jbe202: 0x445c2e, cmp205: 0x445c34, jb205: 0x445c39, jbe205: 0x445c3f,
      up: 0x445d84, upJe: 0x445d8b, upJeLen: 2, rup: 0x445dad, deflt: 0x445e13, sel: 0x48c560 }],
  ] as const) {
    runExe(`★★ ${name}：0x203/0x204（右键按下）落缺省出口；0x205 才是右键那一拍`, () => {
      expect(exeBytes(h.cmp202, 5)).toEqual([0x3d, 0x02, 0x02, 0x00, 0x00]); // cmp eax, 0x202
      expect(exeBytes(h.cmp205, 5)).toEqual([0x3d, 0x05, 0x02, 0x00, 0x00]); // cmp eax, 0x205
      const jb = exeBytes(h.jb205, 6);
      expect(jb.slice(0, 2)).toEqual([0x0f, 0x82]); // jb ⇒ 0x202 < msg < 0x205 走缺省
      expect(jccTarget(h.jb205, jb)).toBe(h.deflt);
      const jbe = exeBytes(h.jbe205, 6);
      expect(jbe.slice(0, 2)).toEqual([0x0f, 0x86]); // jbe ⇒ msg == 0x205
      expect(jccTarget(h.jbe205, jbe)).toBe(h.rup);
      // 0x205：`push 0 / call 0x402460 / add esp,4 / push 0` → Post(0) —— 没有 `0x4542ce`（不放音）
      expect(exeBytes(h.rup, 2)).toEqual([0x6a, 0x00]);
      expect(exeBytes(h.rup + 7, 5)).toEqual([0x83, 0xc4, 0x04, 0x6a, 0x00]);
    });

    runExe(`★★ ${name}：0x202（左键抬手）没有选中 ⇒ 直接返回，浮窗留着`, () => {
      const jbe = exeBytes(h.jbe202, 6);
      expect(jbe.slice(0, 2)).toEqual([0x0f, 0x86]);
      expect(jccTarget(h.jbe202, jbe)).toBe(h.up);
      const cmp = exeBytes(h.up, 7);
      expect(cmp.slice(0, 2)).toEqual([0x83, 0x3d]); // cmp dword [sel], 0
      expect(cmp[2]! | (cmp[3]! << 8) | (cmp[4]! << 16) | (cmp[5]! << 24)).toBe(h.sel);
      expect(cmp[6]).toBe(0);
      const je = exeBytes(h.upJe, h.upJeLen);
      expect(je[0] === 0x74 || (je[0] === 0x0f && je[1] === 0x84)).toBe(true);
      // 落点是本函数的「返回」那一段（不是 Post）：卡片欄 0x441579、道具欄 0x445d7d
      expect(jccTarget(h.upJe, je)).toBe(name === '卡片欄' ? 0x441579 : 0x445d7d);
    });
  }

  it('★★ main.ts：浮窗只认左键按下；左键抬手没有选中就不关窗（源码钉子）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain(
      "if (screen === 'inventory') {\n      if (e.button !== 0) return;\n      const q = eventToStage(e);",
    );
    expect(src).toContain(
      "if (screen === 'inventory') {\n      if (e.button !== 0) return;\n" +
        '      // ★ 没按中任何一格',
    );
    expect(src).toContain('      if (invPicked === null) return;\n      applyInventoryPick();');
  });
});
