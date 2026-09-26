/*
 * 大地圖彈窗（T-086）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉住四件事：
 *   · 图号从**表项偏移**算（表项从 +0xc 起、每条 12 字节）：0x18 → 图 1、0x48 → 图 5；
 *   · 标记落点 = `世界 × 89 ÷ 512`（`shl 7` + `sar 16`）再加 (20, 60)；
 *   · 谁是「在世」（原版判 `player+8 != 0`，本引擎用 `isAlive`，见偏离登记）；
 *   · 模态：左键什么都不做、右键（`contextmenu`）关、键盘一律吞掉。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState, Rich4Map } from '@rich4/core';
import { WHO_PLAYS_COMPUTER, WHO_PLAYS_DEAD, WHO_PLAYS_HUMAN } from '@rich4/core';
import type { UiScreenEnv } from './ui-screen.ts';
import { HOTKEY } from './hotkeys.ts';
import {
  BIG_MAP_AT,
  BIG_MAP_BG_IMAGE,
  BIG_MAP_MARKER_IMAGE,
  BIG_MAP_RESOURCE_BASE,
  BIG_MAP_SCALE_NUM,
  BIG_MAP_SCALE_SHIFT,
  BIG_MAP_SIZE,
  PORTRAIT_RESOURCE_BASE,
  BIG_MAP_ALLOWED_HOTKEYS,
  bigMapAt,
  bigMapMarkerResource,
  bigMapMarkers,
  bigMapOpen,
  bigMapResource,
  bigMapScreen,
  closeBigMap,
  openBigMap,
  resetBigMap,
} from './big-map-screen.ts';

/** 只填这一屏用得到的字段的假环境 */
function mkEnv(): {
  env: UiScreenEnv;
  renders: () => number;
  images: { archive: string; resource: number; index: number; colorKeyBlack: boolean }[];
  drawn: unknown[][];
} {
  let renders = 0;
  const images: { archive: string; resource: number; index: number; colorKeyBlack: boolean }[] = [];
  const drawn: unknown[][] = [];
  const env = {
    screen: 'game',
    now: 0,
    // 没有地块 ⇒ 没有归属色块（见下面「归属色块」那一组）
    topo: { nodes: [] },
    requestRender: () => {
      renders += 1;
    },
    log: () => undefined,
    flic: () => null,
    playEffect: () => undefined,
    sprite: (archive: string, resource: number, index: number, colorKeyBlack = false) => {
      images.push({ archive, resource, index, colorKeyBlack });
      // 假图：锚点 = 中心（与 `map.mkf` 那几张一致）
      return {
        bitmap: { width: 400, height: 400 } as unknown as ImageBitmap,
        width: 400,
        height: 400,
        anchorX: 15,
        anchorY: 13,
      };
    },
    stage: {
      drawImage: (...args: unknown[]) => {
        drawn.push(args);
      },
    },
  } as unknown as UiScreenEnv;
  return { env, renders: () => renders, images, drawn };
}

/** 一张只有 4 个节点的假地图（世界坐标取 map 0 的真实值）*/
function mkMap(nodes: { x: number; y: number }[]): Rich4Map {
  return { nodes: nodes.map((n, i) => ({ id: i + 1, x: n.x, y: n.y })) } as unknown as Rich4Map;
}

/** 4 节点假地图（世界坐标取 map 0 的真实值）—— `mkState` 缺省用它推 x/y */
const DEFAULT_MAP = mkMap([
  { x: 360, y: 239 },
  { x: 1752, y: 1871 },
  { x: 512, y: 512 },
  { x: 1024, y: 1024 },
]);

function mkState(
  players: { character: number; whoPlays: number; nodeId: number }[],
  globalMapId = 0,
  /**
   * ★★ 第 86 条起标记位置读的是 `xpos/ypos`（原版 `player+0x08/+0x0a`），
   *   不再由 `nodeId` 现推 —— 所以这里按真实不变量把它们填上
   *   （在场玩家 = 所在格坐标；不在盘上 = 0/0）。缺省用 4 节点假地图。
   */
  map: Rich4Map = DEFAULT_MAP,
): GameState {
  return {
    globalMapId,
    players: players.map((p, i) => {
      const n = map.nodes[p.nodeId - 1];
      return { index: i, xpos: n?.x ?? 0, ypos: n?.y ?? 0, ...p };
    }),
  } as unknown as GameState;
}

beforeEach(() => {
  resetBigMap();
});

describe('图号与落点 @source rich4_ui_small_map.asm', () => {
  it('★ 表项从 +0xc 起、每条 12 字节：0x18 = 图 1（400×400 底图）、0x48 = 图 5（玩家标记）', () => {
    // 0x18 − 0xc = 0xc = 12 × 1；0x48 − 0xc = 0x3c = 12 × 5
    expect((0x18 - 0xc) / 12).toBe(BIG_MAP_BG_IMAGE);
    expect((0x48 - 0xc) / 12).toBe(BIG_MAP_MARKER_IMAGE);
    expect(BIG_MAP_BG_IMAGE).toBe(1);
    expect(BIG_MAP_MARKER_IMAGE).toBe(5);
  });

  it('★ 两个资源段：底图 = 地图号 + 0x10、标记 = 角色号 + 0x1b', () => {
    expect(bigMapResource(0)).toBe(0x10);
    expect(bigMapResource(3)).toBe(0x13);
    expect(bigMapMarkerResource(0)).toBe(0x1b);
    expect(bigMapMarkerResource(11)).toBe(0x26);
    expect(BIG_MAP_RESOURCE_BASE).toBe(0x10);
    expect(PORTRAIT_RESOURCE_BASE).toBe(0x1b);
  });

  it('★ 面板 = (20, 60)、400×400（= 脏矩形 0x14,0x3c,0x1a4,0x1cc）', () => {
    expect(BIG_MAP_AT).toEqual({ x: 20, y: 60 });
    expect(BIG_MAP_SIZE).toBe(400);
    expect(0x1a4 - 0x14).toBe(BIG_MAP_SIZE);
    expect(0x1cc - 0x3c).toBe(BIG_MAP_SIZE);
  });

  it('★ 定点换算 = 世界 × 89 ÷ 512（`shl 7` + `sar 16`），不是侧栏那套 ÷1024', () => {
    expect(BIG_MAP_SCALE_NUM).toBe(89);
    expect(BIG_MAP_SCALE_SHIFT).toBe(9);
    expect(bigMapAt(0)).toBe(0);
    expect(bigMapAt(512)).toBe(89); // 89/512 的定点：512 → 89
    // 世界宽 2304：÷512 → 400（÷1024 会得到 200，那是侧栏 200×200 那块）
    expect(bigMapAt(2304)).toBe(400);
    // 逐条对 map 0 真实节点的取整（向零取整与 `sar` 对非负数一致）
    expect(bigMapAt(360)).toBe(Math.trunc((360 * 89) / 512));
    expect(bigMapAt(360)).toBe(62);
    expect(bigMapAt(239)).toBe(41);
  });
});

describe('标记表 @source VA 0x0040a8a1 的循环', () => {
  // 位置现在读 `xpos/ypos`（第 86 条），`mkState` 用这张图把 x/y 填成"站在格上"的值
  const map = mkMap([
    { x: 360, y: 239 },
    { x: 1752, y: 1871 },
    { x: 512, y: 512 },
    { x: 1024, y: 1024 },
  ]);

  it('★ 在世玩家一枚：位置 = 节点世界坐标换算后 + (20, 60)', () => {
    const state = mkState(
      [
        { character: 0, whoPlays: WHO_PLAYS_HUMAN, nodeId: 1 },
        { character: 3, whoPlays: WHO_PLAYS_COMPUTER, nodeId: 2 },
      ],
      0,
      map,
    );
    expect(bigMapMarkers(state)).toEqual([
      { player: 0, character: 0, x: 20 + 62, y: 60 + 41 },
      { player: 1, character: 3, x: 20 + bigMapAt(1752), y: 60 + bigMapAt(1871) },
    ]);
  });

  it('★★ 被关押者画在**景观坐标**上（綠島/醫院大樓），不是監獄/醫院格', () => {
    // 原版 `0x40a8d4` 缩放的就是 `player+0x08/+0x0a`，而那两个字节在关押期间
    // 是特殊景观记录（監獄 → 记录 2「綠島」、醫院 → 记录 1）——见 `rules/confinement.ts`
    const p = { character: 0, whoPlays: WHO_PLAYS_HUMAN, nodeId: 1, xpos: 1817, ypos: 1960 };
    const state = mkState([p]);
    expect(bigMapMarkers(state)).toEqual([
      { player: 0, character: 0, x: 20 + bigMapAt(1817), y: 60 + bigMapAt(1960) },
    ]);
    // 而所在格是 1 号格 (360,239) —— 两者刻意不同，正是这条测试的意义
    expect(bigMapAt(1817)).not.toBe(bigMapAt(360));
  });

  it('★ 出局的座位（`whoPlays & 3 == 0`）不画 —— 原版那条判据的意义', () => {
    const state = mkState([
      { character: 0, whoPlays: WHO_PLAYS_DEAD, nodeId: 1 },
      { character: 1, whoPlays: WHO_PLAYS_HUMAN, nodeId: 3 },
      { character: 2, whoPlays: WHO_PLAYS_DEAD, nodeId: 4 },
    ]);
    expect(bigMapMarkers(state).map((m) => m.player)).toEqual([1]);
  });

  it('★ 节点号越界（0 或超过表长）不画，也不抛', () => {
    const state = mkState([
      { character: 0, whoPlays: WHO_PLAYS_HUMAN, nodeId: 0 },
      { character: 1, whoPlays: WHO_PLAYS_HUMAN, nodeId: 99 },
    ]);
    expect(bigMapMarkers(state)).toEqual([]);
  });
});

describe('模态开关：左键不关、右键关、键盘吞掉', () => {
  it('★ 开/关只有这两条路：`openBigMap` 与 `contextmenu`（右键）', () => {
    const { env, renders } = mkEnv();
    expect(bigMapOpen()).toBe(false);
    expect(bigMapScreen.active(env)).toBe(false);

    openBigMap(env);
    expect(bigMapOpen()).toBe(true);
    expect(bigMapScreen.active(env)).toBe(true);
    expect(renders()).toBe(1);

    // 左键按下 / 抬起**什么都不做**（原版 0x201 / 0x202 → DefWindowProc）
    bigMapScreen.down?.(100, 100, env);
    bigMapScreen.up?.(100, 100, env);
    expect(bigMapOpen()).toBe(true);
    expect(renders()).toBe(1);

    // 右键（= 原版 WM_RBUTTONUP 0x205）关窗
    bigMapScreen.contextmenu?.(100, 100, env);
    expect(bigMapOpen()).toBe(false);
    expect(renders()).toBe(2);

    // 关掉之后再右键不会重复关（也不会再多画一帧）
    bigMapScreen.contextmenu?.(100, 100, env);
    expect(renders()).toBe(2);
  });

  it('★ 开着的时候所有热键都吞掉（含「地圖」自己）；没开时不认领任何热键', () => {
    const { env } = mkEnv();
    expect(BIG_MAP_ALLOWED_HOTKEYS).toEqual([]);
    for (const fn of [HOTKEY.map, HOTKEY.cancel, HOTKEY.system, HOTKEY.query]) {
      expect(bigMapScreen.hotkey?.(fn, env)).toBe(false);
    }
    openBigMap(env);
    for (const fn of [HOTKEY.map, HOTKEY.cancel, HOTKEY.system, HOTKEY.query]) {
      expect(bigMapScreen.hotkey?.(fn, env)).toBe(true);
    }
    closeBigMap(env);
    expect(bigMapScreen.hotkey?.(HOTKEY.map, env)).toBe(false);
  });

  it('★ 重复开窗不叠加（原版 `_Wait_0402_Message` 是阻塞的，不可能套两层）', () => {
    const { env, renders } = mkEnv();
    openBigMap(env);
    openBigMap(env);
    expect(renders()).toBe(1);
  });
});

describe('画法：底图在 (20,60)、标记减锚点', () => {
  it('★ 底图取 `map.mkf` 资源 `地图号+0x10` 图 1（不抠黑）；标记取角色头像资源图 5（抠黑）', () => {
    const { env, images, drawn } = mkEnv();
    const map = mkMap([{ x: 360, y: 239 }]);
    const state = mkState([{ character: 2, whoPlays: WHO_PLAYS_HUMAN, nodeId: 1 }], 5, map);
    openBigMap(env);
    bigMapScreen.draw({ ...env, state, map } as UiScreenEnv);

    expect(images).toEqual([
      { archive: 'map.mkf', resource: 0x15, index: 1, colorKeyBlack: false },
      { archive: 'map.mkf', resource: 0x1d, index: 5, colorKeyBlack: true },
    ]);
    // 假图锚点一律 (15,13)（真图：底图是 (0,0)、标记是中心）——
    // 两张都照原版 `draw_image_rect` 的规矩**减锚点**再贴
    expect(drawn.length).toBe(2);
    expect(drawn[0]?.slice(1)).toEqual([20 - 15, 60 - 13]);
    expect(drawn[1]?.slice(1)).toEqual([20 + 62 - 15, 60 + 41 - 13]);
  });
});

describe('★ 第十三份試玩回報：大地圖上烙归属色块 @source 0x0040a82d → fcn_0040a4e1(1)', () => {
  it('★ 底图之后、玩家标记之前：有主的地 / 設施 / 企業各一块（Data.mkf 517 图 26..29，抠黑），落点 = 世界×89>>9 + (20,60)', () => {
    const { env, images, drawn } = mkEnv();
    const map = mkMap([{ x: 360, y: 239 }]);
    const state = {
      ...mkState([{ character: 2, whoPlays: WHO_PLAYS_HUMAN, nodeId: 1 }], 0, map),
      landOwner: [0, 1, 0],
      facilityOwner: [0, 1],
      commercialOwners: [undefined, { owner: 1 }],
    } as unknown as GameState;
    const topo = {
      nodes: [],
      lands: [
        { id: 1, x: 1024, y: 512, facing: 3 },
        { id: 2, x: 600, y: 600, facing: 0 }, // 无主 ⇒ 不画
      ],
      facilities: [{ id: 1, x: 512, y: 1024, facing: 2 }],
      commercials: [{ id: 1, x: 2000, y: 100, facing: 1 }],
    };
    // 真浏览器里剪影要画在离屏画布上；单测环境没有 ⇒ 只核「取了哪几张图」
    openBigMap(env);
    bigMapScreen.draw({ ...env, state, map, topo } as unknown as UiScreenEnv);
    expect(images).toEqual([
      { archive: 'map.mkf', resource: 0x10, index: 1, colorKeyBlack: false },
      { archive: 'Data.mkf', resource: 0x205, index: 0x1a + 1, colorKeyBlack: true }, // 地，朝向 3 ⇒ 菱
      { archive: 'Data.mkf', resource: 0x205, index: 0x1c + 0, colorKeyBlack: true }, // 設施，朝向 2 ⇒ 方
      { archive: 'Data.mkf', resource: 0x205, index: 0x1c + 1, colorKeyBlack: true }, // 企業，朝向 1 ⇒ 菱
      { archive: 'map.mkf', resource: 0x1d, index: 5, colorKeyBlack: true },
    ]);
    expect(drawn.length).toBeGreaterThanOrEqual(2);
  });
});
