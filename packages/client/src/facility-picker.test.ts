/*
 * 「請選擇設施類別」那扇窗 —— Q-TOOL-4
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事，判据全部回 exe（VA 见 `facility-picker.ts` 的文件头）：
 *   ① **版面**：面板 = Data#517 图 4 落 (43,279)、立绘板 = 图 5 落 (220,140)、
 *      标题 (220,122) flag 2、悬停名字 (220,154) flag 4、三圈黄框 0x44/0x42/0x40；
 *   ② **命中**：x∈[50,390)、y∈[286,354)、槽 = (x−50)/68、共 5 格；
 *   ③ **返回值**：槽号就是 `FACILITY_TYPE`（公園0/旅館1/購物中心2/加油站3/研究所4）；
 *      右键 = 取消（`null`）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Sprite } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';
import {
  PICKER_ARCHIVE,
  PICKER_BOARD,
  PICKER_FILL,
  PICKER_FONT_SIZE,
  PICKER_HIT,
  PICKER_HOVER_FRAMES,
  PICKER_NAME_AT,
  PICKER_NAMES,
  PICKER_PANEL,
  PICKER_RESOURCE,
  PICKER_SLOTS,
  PICKER_STRIDE,
  PICKER_TITLE,
  PICKER_TITLE_AT,
  PICKER_TYPES,
  PICKER_TOOL_ID,
  drawFacilityPicker,
  facilityPickerOpen,
  facilityPickerScreen,
  openFacilityPicker,
  pickerHoverRects,
  pickerKeyedBlack,
  pickerNameOf,
  pickerNeededFor,
  pickerShowsPrice,
  rebuildPickerNeeded,
  pickerSlotAt,
  pickerSlotX,
  pickerTypeOf,
  resetFacilityPicker,
} from './facility-picker.ts';

/** 假 sprite：按图号给不同尺寸/锚点，并记下被问过的图号 */
function fakeSprite(): {
  sprite: Parameters<typeof drawFacilityPicker>[1];
  asked: { chunk: number; keyed: boolean | undefined }[];
} {
  const asked: { chunk: number; keyed: boolean | undefined }[] = [];
  const sprite = (_a: 'Data.mkf', _r: number, chunk: number, keyed?: boolean) => {
    asked.push({ chunk, keyed });
    const size = chunk === PICKER_BOARD.chunk ? 249 : 400;
    return {
      bitmap: { chunk } as unknown as ImageBitmap,
      width: size,
      height: chunk === PICKER_BOARD.chunk ? 170 : 89,
      anchorX: 0,
      anchorY: 0,
    } as Sprite;
  };
  return { sprite: sprite as unknown as Parameters<typeof drawFacilityPicker>[1], asked };
}

function fakeCtx(): {
  ctx: CanvasRenderingContext2D;
  images: { chunk: number; x: number; y: number }[];
  texts: { t: string; x: number; y: number }[];
  rects: { x: number; y: number; w: number; h: number }[];
} {
  const images: { chunk: number; x: number; y: number }[] = [];
  const texts: { t: string; x: number; y: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    drawImage: (b: { chunk: number }, x: number, y: number) => images.push({ chunk: b.chunk, x, y }),
    strokeRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
    fillText: (t: string, x: number, y: number) => texts.push({ t, x, y }),
    strokeText: () => undefined,
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, images, texts, rects };
}

describe('★ 版面 @source `fcn_00440aac` / `loc_0043fc6f`', () => {
  it('面板 = Data#517 图 4 落 (43,279)；立绘板 = 图 5 落 (220,140)', () => {
    expect(PICKER_ARCHIVE).toBe('Data.mkf');
    expect(PICKER_RESOURCE).toBe(0x205);
    expect(PICKER_PANEL).toMatchObject({ chunk: 4, x: 0x2b, y: 0x117 });
    expect(PICKER_BOARD).toMatchObject({ chunk: 5, x: 0xdc, y: 0x8c });
    // 抠黑只对图 5（`fcn_00456418`）；面板走不透明的 `fcn_004563f5`
    expect(pickerKeyedBlack(PICKER_BOARD.chunk)).toBe(true);
    expect(pickerKeyedBlack(PICKER_PANEL.chunk)).toBe(false);
  });

  it('标题 `請選擇設施類別` 落 (220,122)；名字落 (220,154)', () => {
    expect(PICKER_TITLE).toBe('請選擇設施類別');
    expect(PICKER_TITLE_AT).toEqual({ x: 0xdc, y: 0x7a });
    expect(PICKER_TITLE_AT).toEqual({ x: 220, y: 122 });
    expect(PICKER_NAME_AT).toEqual({ x: 220, y: 154 });
    expect(PICKER_FONT_SIZE).toBe(0x10);
    expect(PICKER_FILL).toBe('#f0f0f0');
  });
});

describe('★ 五格 = 五种設施（名字表 0x475150）', () => {
  it('名字与顺序照表：公園 / 旅館 / 購物中心 / 加油站 / 研究所', () => {
    expect(PICKER_NAMES).toEqual(['公  園', '旅  館', '購物中心', '加油站', '研究所']);
    expect(PICKER_SLOTS).toBe(5);
  });

  it('★ 槽号就是 `FACILITY_TYPE`（park 0 / hotel 1 / mall 2 / gasStation 3 / lab 4）', () => {
    expect(PICKER_TYPES).toEqual([0, 1, 2, 3, 4]);
    for (let slot = 0; slot < PICKER_SLOTS; slot++) {
      expect(pickerTypeOf(slot)).toBe(slot);
      expect(pickerNameOf(slot)).toBe(PICKER_NAMES[slot]);
    }
    expect(pickerTypeOf(5)).toBeNull();
    expect(pickerTypeOf(-1)).toBeNull();
  });
});

describe('★ 命中带 @source `loc_0043fb76`', () => {
  it('x∈[50,390)、y∈[286,354)，槽 = (x−50)/68', () => {
    expect(PICKER_HIT).toEqual({ x0: 0x32, x1: 0x186, y0: 0x11e, y1: 0x162 });
    expect(PICKER_STRIDE).toBe(0x44);
    expect(PICKER_STRIDE).toBe(68);
    for (const [slot, x] of [[0, 50], [1, 117], [2, 185], [3, 253], [4, 321]] as const) {
      expect(pickerSlotAt(x + 1, 300), `slot ${slot}`).toBe(slot);
      expect(pickerSlotX(slot)).toBe(50 + slot * 68);
    }
  });

  it('四条边与越界', () => {
    expect(pickerSlotAt(49, 300)).toBeNull();
    expect(pickerSlotAt(390, 300)).toBeNull();
    expect(pickerSlotAt(100, 285)).toBeNull();
    expect(pickerSlotAt(100, 354)).toBeNull();
    // y 的两端都算「在里面」（原版是 `jl` / `jge` 两条）
    expect(pickerSlotAt(100, 286)).toBe(0);
    expect(pickerSlotAt(100, 353)).toBe(0);
  });

  it('三圈黄框：0x44/0x42/0x40，每圈 x/y 各 +1', () => {
    expect(PICKER_HOVER_FRAMES.map((f) => f.size)).toEqual([0x44, 0x42, 0x40]);
    expect(pickerHoverRects(1)).toEqual([
      { x: 118, y: 0x11e, size: 68 },
      { x: 119, y: 0x11f, size: 66 },
      { x: 120, y: 0x120, size: 64 },
    ]);
  });
});

describe('★ 绘制（假 ctx）', () => {
  it('没有悬停时只画面板 + 标题', () => {
    const f = fakeCtx();
    const s = fakeSprite();
    drawFacilityPicker(f.ctx, s.sprite, { hover: null });
    expect(f.images.map((i) => i.chunk)).toEqual([PICKER_PANEL.chunk]);
    expect(f.texts.map((t) => t.t)).toEqual([PICKER_TITLE]);
    expect(f.rects).toHaveLength(0);
  });

  it('悬停第 2 格：三圈黄框 + 立绘板 + 名字（在 (220,154)）', () => {
    const f = fakeCtx();
    const s = fakeSprite();
    drawFacilityPicker(f.ctx, s.sprite, { hover: 2 });
    expect(f.rects).toHaveLength(3);
    expect(f.rects[0]).toMatchObject({ x: pickerSlotX(2) + 0.5, y: PICKER_HIT.y0 + 0.5 });
    expect(f.images.map((i) => i.chunk)).toEqual([PICKER_PANEL.chunk, PICKER_BOARD.chunk]);
    expect(f.texts.map((t) => t.t)).toEqual([PICKER_TITLE, '購物中心']);
    expect(f.texts[1]).toMatchObject({ x: 220, y: 154 });
  });
});

function mkEnv(
  pendingKind: string | null = null,
): { env: UiScreenEnv; effects: number[]; actions: unknown[]; renders: () => number } {
  const effects: number[] = [];
  const actions: unknown[] = [];
  let renders = 0;
  const env = {
    screen: 'game',
    state: { pending: pendingKind === null ? null : { kind: pendingKind } },
    stage: fakeCtx().ctx,
    sprite: fakeSprite().sprite,
    playEffect: (id: number) => effects.push(id),
    dispatch: (a: unknown) => actions.push(a),
    requestRender: () => {
      renders++;
    },
  } as unknown as UiScreenEnv;
  return { env, effects, actions, renders: () => renders };
}
describe('★ 整屏出口（浮窗）', () => {

  it('★ 是**浮窗**（原版先存下 (0,0x28)-(0x1b8,0x1e0) 那块再盖上去）', () => {
    expect(facilityPickerScreen.windowed).toBe(true);
    expect(facilityPickerScreen.id).toBe('facility-picker');
  });

  it('★ 开窗 → 悬停 → 抬手返回**类型**；右键返回 null（取消）', () => {
    resetFacilityPicker();
    const { env, effects } = mkEnv();
    expect(facilityPickerScreen.active(env)).toBe(false);

    const answers: (number | null)[] = [];
    openFacilityPicker((t) => answers.push(t));
    expect(facilityPickerOpen()).toBe(true);
    expect(facilityPickerScreen.active(env)).toBe(true);

    // 悬停第 4 格（研究所 = 4）：换格响 0
    facilityPickerScreen.move?.(pickerSlotX(4) + 5, 300, env);
    expect(effects).toEqual([0]);
    // 同格内移动不重复响
    facilityPickerScreen.move?.(pickerSlotX(4) + 9, 310, env);
    expect(effects).toHaveLength(1);
    facilityPickerScreen.up?.(pickerSlotX(4) + 5, 300, env);
    expect(answers).toEqual([4]);
    expect(facilityPickerOpen()).toBe(false);
    expect(facilityPickerScreen.active(env)).toBe(false);

    // 右键取消
    openFacilityPicker((t) => answers.push(t));
    facilityPickerScreen.contextmenu?.(100, 300, env);
    expect(answers).toEqual([4, null]);
  });

  it('★ 抬手时不在格子上 → 什么都不答（窗还开着）', () => {
    resetFacilityPicker();
    const { env } = mkEnv();
    const answers: (number | null)[] = [];
    openFacilityPicker((t) => answers.push(t));
    facilityPickerScreen.up?.(10, 10, env);
    expect(answers).toEqual([]);
    expect(facilityPickerOpen()).toBe(true);
  });

  it('键盘不归它（原版跳表只有 0xf/0x200/0x202/0x205/0x401）', () => {
    resetFacilityPicker();
    const { env } = mkEnv();
    openFacilityPicker(() => undefined);
    expect(facilityPickerScreen.key?.({ vk: 0x0d, code: 'Enter', ctrl: false, shift: false, alt: false }, env)).toBe(false);
  });
});

describe('★ `pickerNeededFor`：只有「機器工人打等级 0 的設施」才过窗', () => {
  const nodes = [
    { id: 1, type: 0x7d0 + 1 }, // 土地（住宅/連鎖店那段）
    { id: 2, type: 0xfa0 + 1 }, // 設施
  ] as never;
  const topo = { nodes, lands: [], facilities: [{ id: 1, level: 0, type: 0 }] } as never;

  it('土地那支不过窗（原版直接 `buildOneLevel`）', () => {
    const state = {
      currentPlayer: 0,
      players: [{ whoPlays: 1 }],
      facilityLevel: [0, 0],
      facilityType: [0, 0],
      facilityOwner: [0, 0],
      facilityPriceStatus: [0, 0],
    } as never;
    expect(pickerNeededFor(state, topo, 1)).toBe(false);
  });

  it('設施：等级 0 过窗、等级 ≥ 1 不过', () => {
    const lv0 = {
      currentPlayer: 0,
      players: [{ whoPlays: 1 }],
      facilityLevel: [0, 0],
      facilityType: [0, 0],
      facilityOwner: [0, 0],
      facilityPriceStatus: [0, 0],
    } as never;
    expect(pickerNeededFor(lv0, topo, 2)).toBe(true);
    const lv2 = {
      ...(lv0 as Record<string, unknown>),
      facilityLevel: [0, 2],
    } as never;
    expect(pickerNeededFor(lv2, topo, 2)).toBe(false);
  });

  it('道具号就是機器工人（9）', () => {
    expect(PICKER_TOOL_ID).toBe(9);
  });
});

describe('★ `rebuildPickerNeeded`：改建卡站在等级 ≥ 1 的設施上才过窗', () => {
  const topo = {
    nodes: [
      { id: 1, type: 0x7d0 + 1 }, // 土地
      { id: 2, type: 0xfa0 + 1 }, // 設施（下标 1）
      { id: 3, type: 0 },         // 路面
    ],
    lands: [],
    facilities: [{ id: 1, level: 2, type: 1 }],
  } as never;

  const stateAt = (nodeId: number, level = 2) => ({
    currentPlayer: 0,
    players: [{ nodeId }],
    facilityLevel: [0, level],
    facilityType: [0, 1],
    facilityOwner: [0, 1],
    facilityPriceStatus: [0, 0],
  } as never);

  it('★ 站在等级 ≥ 1 的設施上 → 过窗（VA 0x004431c8）', () => {
    expect(rebuildPickerNeeded(stateAt(2), topo)).toBe(true);
  });

  it('★ 等级 0 的設施 → 不过窗（原版 `cmp [ebx+0x1a],0 / je` 直接不生效）', () => {
    expect(rebuildPickerNeeded(stateAt(2, 0), topo)).toBe(false);
  });

  it('土地 / 路面 → 不过窗（那两支不需要种类）', () => {
    expect(rebuildPickerNeeded(stateAt(1), topo)).toBe(false);
    expect(rebuildPickerNeeded(stateAt(3), topo)).toBe(false);
  });

  it('节点号越界 / 没这个玩家 → 不过窗', () => {
    expect(rebuildPickerNeeded(stateAt(99), topo)).toBe(false);
    expect(rebuildPickerNeeded({ currentPlayer: 0, players: [] } as never, topo)).toBe(false);
  });
});

describe('★ 接线（源码钉子）', () => {
  it('main.ts：機器工人打等级 0 的設施 → 先开窗，选完带 `value` 派 action', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('source.toolId === PICKER_TOOL_ID && pickerNeededFor(state, topo, hit.nodeId)');
    expect(src).toContain('openFacilityPicker((type) => {');
    expect(src).toContain("dispatch({ type: 'useTool', toolId, nodeId, value: type });");
    // 取消（右键 → null）时什么都不派
    expect(src).toContain('if (type === null) return;');
  });

  it('screens.ts：登记了 `facility-picker`（且是浮窗）', () => {
    const src = readFileSync(new URL('./screens.ts', import.meta.url), 'utf8');
    expect(src).toContain('facilityPickerScreen');
  });

  it('main.ts / inventory.ts：改建卡（7）站在設施上 → 同一扇窗，选完带 `facilityType`', () => {
    // 卡片欄那条路（`selection: 'none'` 的卡本来不会进拾取，要先分出来）
    const inv = readFileSync(new URL('./inventory.ts', import.meta.url), 'utf8');
    expect(inv).toContain("if (cardId === REBUILD_CARD_ID && rebuildPickerNeeded(state, topo)) {");
    expect(inv).toContain("return { kind: 'facilityPick' };");
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain("if (route.kind === 'facilityPick') {");
    expect(src).toContain("dispatch({ type: 'useCard', cardId, target: { kind: 'none', facilityType: type } });");
    // 右键取消（−1）= 这张卡不消耗：失败音 + 卡片欄开回来（不派 action）
    expect(src).toContain('if (type === null) {');
  });
});

describe('★ 待决交互那一支：落点在等级 0 的設施上（`pending.buildFacility`）', () => {
  it('★ 认这个 pending：`active()` 为真（由 `screens.ts` 排在通用对话框之前接管）', () => {
    resetFacilityPicker();
    const { env } = mkEnv('buildFacility');
    expect(facilityPickerScreen.active(env)).toBe(true);
    // 别的 pending 不认
    expect(facilityPickerScreen.active(mkEnv('research').env)).toBe(false);
    expect(facilityPickerScreen.active(mkEnv(null).env)).toBe(false);
  });

  it('★ 选一格 → 派 `buildFacility`（带上类型）；右键 → `declineDecision`', () => {
    resetFacilityPicker();
    const { env, actions } = mkEnv('buildFacility');
    facilityPickerScreen.move?.(pickerSlotX(1) + 5, 300, env);
    facilityPickerScreen.up?.(pickerSlotX(1) + 5, 300, env);
    expect(actions).toEqual([{ type: 'buildFacility', facilityType: 1 }]);

    const second = mkEnv('buildFacility');
    facilityPickerScreen.contextmenu?.(100, 300, second.env);
    expect(second.actions).toEqual([{ type: 'declineDecision' }]);
  });

  it('★★ E-20：神明代蓋那一次（`pending.free`）右键**无效** —— 窗留着、什么都不派 @source 0x0043febb / 0x0040b1e2', () => {
    resetFacilityPicker();
    const { env, actions } = mkEnv('buildFacility');
    (env.state as unknown as { pending: { kind: string; free?: true } }).pending = { kind: 'buildFacility', free: true };
    facilityPickerScreen.contextmenu?.(100, 300, env);
    expect(actions).toEqual([]);
    expect(facilityPickerScreen.active(env)).toBe(true);
    // 选一格照常出得去
    facilityPickerScreen.move?.(pickerSlotX(2) + 5, 300, env);
    facilityPickerScreen.up?.(pickerSlotX(2) + 5, 300, env);
    expect(actions).toEqual([{ type: 'buildFacility', facilityType: 2 }]);
  });

  it('★ 两级来路互不串台：开了窗（道具那一路）时待决交互那一支不抢', () => {
    resetFacilityPicker();
    const { env, actions } = mkEnv('buildFacility');
    const answers: (number | null)[] = [];
    openFacilityPicker((t) => answers.push(t));
    facilityPickerScreen.up?.(pickerSlotX(3) + 5, 300, env);
    // 走的是回调那条路，不会自己派 action
    expect(answers).toEqual([3]);
    expect(actions).toEqual([]);
  });
});

// ============================================================
//  ★ W-55 行 9：真人 + 0 级設施 + 天使/福神（`pending.free`）
// ============================================================

describe('★★ W-55 行 9：`free` 那一次**不显示价钱**', () => {
  it('★★ `pickerShowsPrice`：`free` ⇒ false，普通首建 ⇒ true', () => {
    expect(pickerShowsPrice({ free: true })).toBe(false);
    expect(pickerShowsPrice({})).toBe(true);
    expect(pickerShowsPrice(null)).toBe(false);
  });

  /**
   * ★ 这条是**行为钉子**（不是注释钉子）：原版窗口过程（`fcn_0043fae4`）里
   *   一处拿价钱的绘制都没有 —— 面板图 4 / 三圈黄框 / 立绘板 5 / 标题 / 悬停名字。
   *   下面把「画出来的字符串」全抓下来，断言里面**一个数字/元/費用都没有**。
   *   谁日后往这扇窗里加一行价钱，这条会红。
   */
  it('★★ 画出来的字符串里**没有任何价钱**（数字 / 元 / 費用 / %d）', () => {
    const f = fakeCtx();
    const s = fakeSprite();
    for (const hover of [null, 0, 1, 2, 3, 4]) {
      drawFacilityPicker(f.ctx, s.sprite, { hover });
    }
    const texts = f.texts.map((t) => t.t);
    // 只有标题与五格名字（各出现一次）
    expect(new Set(texts)).toEqual(new Set([PICKER_TITLE, ...PICKER_NAMES]));
    for (const t of texts) {
      expect(/[0-9０-９]/.test(t), `「${t}」里不该有数字`).toBe(false);
      expect(/元|費用|價|价/.test(t), `「${t}」里不该有价钱字样`).toBe(false);
    }
  });

  it('★ 器件：`drawFacilityPicker` 的绘制调用里没有「价格」这个入参（源码钉子）', () => {
    const src = readFileSync(new URL('./facility-picker.ts', import.meta.url), 'utf8');
    // `PickerDraw` 只有 `hover` 一个字段 —— 要加价钱必须先改这张形状，改动会被看见
    expect(src).toContain('export interface PickerDraw {');
    expect(src).toMatch(/export interface PickerDraw \{[\s\S]*?hover: number \| null;[\s\S]*?\}/);
    expect(src).not.toMatch(/interface PickerDraw \{[\s\S]*?price[\s\S]*?\}/);
  });

  it('★ `free` 的 pending 走的还是同一条 `buildFacility` 动作（行为不变）', () => {
    resetFacilityPicker();
    const { env, actions } = mkEnv('buildFacility');
    // 带上 `free: true`（core 的 `godFreeBuild` 就是这么挂的）
    (env.state as { pending: unknown }).pending = { kind: 'buildFacility', free: true };
    facilityPickerScreen.move?.(pickerSlotX(2) + 5, 300, env);
    facilityPickerScreen.up?.(pickerSlotX(2) + 5, 300, env);
    expect(actions).toEqual([{ type: 'buildFacility', facilityType: 2 }]);
  });
});
