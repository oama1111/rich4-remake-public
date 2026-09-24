/*
 * 設定「視 窗」三选一 —— 尤其是第三项「組合畫面」（第二十一份试玩回报）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方回报（Charles，`20260924-144046048-manual-Charles.json`，联机第 78 回合）：
 * 「设置里配置组合画面时和原版不符」—— 选了「組合畫面」（`cfg+5 = 2`）之后，右栏仍是
 * 整版四页面板 + 日曆，与「日、月曆」那一项一模一样。
 *
 * 原版（VA 0x00418bcd 的 WM_PAINT 三路分派）：組合畫面 = **200×80 窄版面板 + 小地图 @ y80 + 日曆 @ y280**。
 * 这里钉：
 *   ① exe 字节：版式表 `0x4752aa`、分派顺序、窄版面板的每个坐标、三道闸（PgUp/PgDn、点竖条、整版面板）；
 *   ② 纯函数：`sidebarLayout` / `hitMinimapArea`（小地图顶边随三态走）；
 *   ③ 真画一遍（假画布）：三态各画了哪几块、画在哪；
 *   ④ main.ts 接线：熱鍵「切換視窗組」轮 `cfg+5` 三态、组合画面下两道闸、单机/联机同一条绘制路。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { landAll, newGame, parseMap, sceneOfMonth, type GameState } from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import {
  COMPACT,
  Hud,
  MINIMAP_TOP_BY_VIEW,
  compactRows,
  hitMinimapArea,
  sidebarLayout,
  type CalendarPage,
  type HudInput,
} from './hud.ts';
import type { Sprite, SpriteCache } from './assets.ts';
import { currency } from './panel.ts';

const WS = process.env.RICH4_WORKSPACE ?? '';
const EXE = WS + '/Rich4/rich4.exe';
const runExe = existsSync(EXE) ? it : it.skip;
const MAP = WS + '/extracted/map/0001.bin';
const runMap = existsSync(MAP) ? it : it.skip;

/** VA → 文件偏移（与 `tools/disasm.py` 的 `SECTIONS` 同一套：代码段 / 数据段） */
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = va < 0x463000 ? 1024 + (va - 0x401000) : 398848 + (va - 0x463000);
  return [...d.subarray(off, off + n)];
}
const hex = (bytes: number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
/** `push 0 / call rel32`（`6a 00 e8 xx xx xx xx`）的调用目标 */
function callAfterPush0(va: number): number {
  const b = exeBytes(va, 7);
  expect(hex(b.slice(0, 3))).toBe('6a 00 e8');
  const rel = new DataView(Uint8Array.from(b.slice(3)).buffer).getInt32(0, true);
  return va + 7 + rel;
}

// ============================================================
//  ① exe 字节
// ============================================================
describe('① 回 exe 钉：組合畫面 = 窄版面板 + 小地图 @80 + 日曆 @280', () => {
  runExe('版式表 `0x4752aa` = [0, 280, 80]（小地图顶边，0 = 不画）', () => {
    const b = exeBytes(0x4752aa, 12);
    const dv = new DataView(Uint8Array.from(b).buffer);
    expect([0, 4, 8].map((o) => dv.getInt32(o, true))).toEqual([...MINIMAP_TOP_BY_VIEW]);
    expect([...MINIMAP_TOP_BY_VIEW]).toEqual([0, 280, 80]);
  });

  runExe('WM_PAINT `cfg+5 == 2` 那一支：窄版面板 → 小地图 → 日曆（0x00418c08 / 0c12 / 0c1c）', () => {
    expect(callAfterPush0(0x418c08)).toBe(0x4166f8);
    expect(callAfterPush0(0x418c12)).toBe(0x416e6d);
    expect(callAfterPush0(0x418c1c)).toBe(0x4169bc);
  });

  runExe('四道 `cmp byte [cfg+5], 2`：整版面板 ret / 窄版只在此态画 / PgUp·PgDn 吃掉 / 点竖条跳过', () => {
    const cmp2 = '80 3d 5d 71 49 00 02';
    for (const va of [0x415f83, 0x41670d, 0x4014b1, 0x4182fa]) expect(hex(exeBytes(va, 7)), va.toString(16)).toBe(cmp2);
  });

  runExe('窄版面板的底图 = `[0x48be0c]` + 0x3c ⇒ Panel.mkf 0 的**图 4**，贴在 (440, 0)', () => {
    // 6a 00 / 68 b8 01 00 00 / a1 0c be 48 00 / 83 c0 3c
    expect(hex(exeBytes(0x416748, 15))).toBe('6a 00 68 b8 01 00 00 a1 0c be 48 00 83 c0 3c');
    expect((0x3c - 0xc) / 12).toBe(COMPACT.image);
  });

  runExe('名牌色条（黑边 + 角色色）、头像、名字、現金、存款 —— 每个坐标都对得上 `COMPACT`', () => {
    // fill(0x211, 0x21, 0x6a, 4, 黑)
    expect(hex(exeBytes(0x4167fb, 13))).toBe('6a 00 6a 04 6a 6a 6a 21 68 11 02 00 00');
    expect(COMPACT.barShadow).toEqual({ x: 0x211 - 440, y: 0x21, w: 0x6a, h: 4 });
    // fill(0x210, 0x20, 0x6a, 4, 角色色)
    expect(hex(exeBytes(0x41681f, 11))).toBe('6a 04 6a 6a 6a 20 68 10 02 00 00');
    expect(COMPACT.bar).toEqual({ x: 0x210 - 440, y: 0x20, w: 0x6a, h: 4 });
    // 头像锚点 (0x1e2, 0x28)
    expect(hex(exeBytes(0x416837, 6))).toBe('6a 28 68 e2 01 00');
    expect(COMPACT.portrait).toEqual({ x: 0x1e2 - 440, y: 0x28 });
    // 名字：font(0x14) → draw(…, 0x246, 0x10, 2)
    expect(hex(exeBytes(0x416891, 7))).toBe('68 10 10 10 00 6a 14');
    expect(hex(exeBytes(0x4168a0, 9))).toBe('6a 02 6a 10 68 46 02 00 00');
    expect(COMPACT.name).toEqual({ x: 0x246 - 440, y: 0x10, size: 0x14 });
    // 数值：font(0xc) → draw(現金, 0x27a, 0x29, 1) / draw(存款, 0x27a, 0x3f, 1)
    expect(hex(exeBytes(0x4168c3, 7))).toBe('68 10 10 10 00 6a 0c');
    expect(hex(exeBytes(0x4168e6, 9))).toBe('6a 01 6a 29 68 7a 02 00 00');
    expect(hex(exeBytes(0x416912, 9))).toBe('6a 01 6a 3f 68 7a 02 00 00');
    expect(COMPACT.valueRight).toBe(0x27a - 440);
    expect([...COMPACT.valueY]).toEqual([0x29, 0x3f]);
    expect(COMPACT.valueSize).toBe(0xc);
  });

  runExe('两个标签是开局烙进图 4 的：「現  金」「存  款」去空格后画在 (90,40) / (90,62)', () => {
    // push 0x463920 ... push edi(0) / push 0x28 / push 0x5a
    expect(hex(exeBytes(0x418053, 5))).toBe('68 20 39 46 00');
    expect(hex(exeBytes(0x418065, 5))).toBe('57 6a 28 6a 5a');
    expect(hex(exeBytes(0x418080, 5))).toBe('68 27 39 46 00');
    expect(hex(exeBytes(0x418092, 5))).toBe('57 6a 3e 6a 5a');
    expect(COMPACT.labels).toEqual([
      { text: '現金', x: 0x5a, y: 0x28 },
      { text: '存款', x: 0x5a, y: 0x3e },
    ]);
    // 字号 12（`push 0xc`，0x00418049）
    expect(hex(exeBytes(0x418044, 7))).toBe('68 10 10 10 00 6a 0c');
    expect(COMPACT.labelSize).toBe(0xc);
  });

  runExe('熱鍵「切換視窗組」：`inc [cfg+5]`，到 3 归 0（0x0040122e..0x0040123f）', () => {
    expect(hex(exeBytes(0x40122e, 17))).toBe('8a 35 5d 71 49 00 fe c6 88 35 5d 71 49 00 80 fe 03');
  });
});

// ============================================================
//  ② 纯函数
// ============================================================
describe('② `sidebarLayout` / `hitMinimapArea`', () => {
  it('三态版式', () => {
    expect(sidebarLayout(0)).toEqual({ panel: 'full', minimapTop: null, calendar: true });
    expect(sidebarLayout(1)).toEqual({ panel: 'full', minimapTop: 280, calendar: false });
    expect(sidebarLayout(2)).toEqual({ panel: 'compact', minimapTop: 80, calendar: true });
    // 三块刚好铺满 480 高：80 + 200 + 200
    expect(COMPACT.h + 200 + 200).toBe(480);
    expect(sidebarLayout(2).minimapTop).toBe(COMPACT.h);
  });

  it('坏档值按「日、月曆」处理', () => {
    expect(sidebarLayout(7)).toEqual(sidebarLayout(0));
  });

  it('日、月曆那一态没有小地图 —— 哪里都点不中', () => {
    for (const y of [10, 100, 300, 470]) expect(hitMinimapArea(0, 50, y)).toBeNull();
  });

  it('縮小地圖：280 < y < 480 → 局部 y = y − 280', () => {
    expect(hitMinimapArea(1, 50, 290)).toEqual({ x: 50, y: 10 });
    expect(hitMinimapArea(1, 50, 280)).toBeNull(); // `jle`：顶边那一行不算
    expect(hitMinimapArea(1, 50, 200)).toBeNull();
  });

  it('組合畫面：80 < y < 280 → 局部 y = y − 80；窄版面板与日曆那两块不算', () => {
    expect(hitMinimapArea(2, 50, 81)).toEqual({ x: 50, y: 1 });
    expect(hitMinimapArea(2, 50, 279)).toEqual({ x: 50, y: 199 });
    expect(hitMinimapArea(2, 50, 80)).toBeNull();
    expect(hitMinimapArea(2, 50, 280)).toBeNull(); // `jge 顶+200`
    expect(hitMinimapArea(2, 50, 40)).toBeNull();
    expect(hitMinimapArea(2, 50, 400)).toBeNull();
    expect(hitMinimapArea(2, 0, 150)).toBeNull(); // `cmp esi, 0x1b8 / jle`
  });

  it('窄版两行 = 現金、存款，与整版「資金」页同一个格式', () => {
    expect(compactRows({ cash: 93849, moneyInBank: 179976 })).toEqual([currency(93849), currency(179976)]);
    expect(compactRows({ cash: 93849, moneyInBank: 0 })[0]).toBe('$93,849');
  });
});

// ============================================================
//  ③ 真画一遍（假画布）
// ============================================================

interface Call {
  op: string;
  args: unknown[];
}

/** 只记调用的假 2D 上下文 —— 属性写了就记着，方法一律记账 */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string, unknown> = { canvas: { width: 200, height: 480 } };
  const ctx = new Proxy(props, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push({ op: key, args });
        return { width: 10 };
      };
    },
    set(target, key: string, v) {
      target[key] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** 假缓存：立刻解码，位图上贴一张「我是谁」的标签 */
function fakeCache(): SpriteCache {
  return {
    addEvictListener: () => undefined,
    get: (archive: string, res: number, idx: number) =>
      Promise.resolve({
        bitmap: { tag: `${archive}:${res}:${idx}` },
        width: 10,
        height: 10,
        anchorX: 0,
        anchorY: 0,
      } as unknown as Sprite),
  } as unknown as SpriteCache;
}

const MINIMAP_BG = { tag: 'minimapBg', width: 200, height: 200 } as unknown as ImageBitmap;

function gameState(): { state: GameState; map: ReturnType<typeof parseMap> } {
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const s = landAll(
    newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })) }),
    map.nodes,
  );
  const state: GameState = {
    ...s,
    currentPlayer: 0,
    players: s.players.map((p, i) => (i === 0 ? { ...p, cash: 93849, moneyInBank: 179976 } : p)),
  };
  return { state, map };
}

/** 画两遍（第一遍把精灵排进解码，等它们落地再画第二遍），返回第二遍的调用 */
async function drawTwice(windowView: number, calendarPage: CalendarPage = 'calendar'): Promise<Call[]> {
  const { state, map } = gameState();
  const { ctx, calls } = fakeCtx();
  const hud = new Hud(ctx, fakeCache());
  const input: HudInput = {
    state,
    map,
    camera: { x: 0, y: 0, view: 0 } as unknown as HudInput['camera'],
    minimapBg: MINIMAP_BG,
    windowView,
    calendarPage,
    minimapMarker: null,
    pressedMinimapArrow: null,
    hotMinimapArrow: null,
    holidayArt: null,
    panelPage: 0,
    panelRows: ['$1', '$2', '$3'],
  };
  hud.draw(input);
  await new Promise((r) => setTimeout(r, 0));
  calls.length = 0;
  hud.draw(input);
  return calls;
}

const images = (calls: Call[]): { tag: string; x: unknown; y: unknown }[] =>
  calls
    .filter((c) => c.op === 'drawImage')
    .map((c) => ({ tag: (c.args[0] as { tag: string }).tag, x: c.args[1], y: c.args[2] }));
const texts = (calls: Call[]): { s: unknown; x: unknown; y: unknown }[] =>
  calls.filter((c) => c.op === 'fillText').map((c) => ({ s: c.args[0], x: c.args[1], y: c.args[2] }));

describe('③ 三态各画了什么、画在哪', () => {
  runMap('★ 組合畫面：窄版面板（图 4）@0 → 小地图 @80 → 日曆 @280；**没有**四页整图', async () => {
    const calls = await drawTwice(2);
    const img = images(calls);
    const panel = img.findIndex((i) => i.tag === 'Panel.mkf:0:4');
    const mm = img.findIndex((i) => i.tag === 'minimapBg');
    const cal = img.findIndex((i) => i.tag.startsWith('Panel.mkf:2:'));
    expect(img[panel]).toMatchObject({ x: 0, y: 0 });
    expect(img[mm]).toMatchObject({ x: 0, y: 80 });
    expect(img[cal]).toMatchObject({ x: 0, y: 280 });
    // 顺序照 0x00418c08：面板 → 小地图 → 日曆
    expect(panel).toBeLessThan(mm);
    expect(mm).toBeLessThan(cal);
    for (const page of [0, 1, 2, 3]) expect(img.some((i) => i.tag === `Panel.mkf:0:${page}`)).toBe(false);

    const t = texts(calls);
    const name = CHARACTERS[0]!.name;
    expect(t).toContainEqual({ s: name, x: COMPACT.name.x, y: COMPACT.name.y });
    expect(t).toContainEqual({ s: '現金', x: 90, y: 40 });
    expect(t).toContainEqual({ s: '存款', x: 90, y: 62 });
    expect(t).toContainEqual({ s: '$93,849', x: 194, y: 41 });
    expect(t).toContainEqual({ s: '$179,976', x: 194, y: 63 });
    // 整版那几样都没有：物價指數、四个竖标签、三行数值
    expect(t.some((x) => String(x.s).startsWith('物價指數'))).toBe(false);
    expect(t.some((x) => x.s === '$1')).toBe(false);
    // 名牌色条 106×4
    const rects = calls.filter((c) => c.op === 'fillRect').map((c) => c.args);
    expect(rects).toContainEqual([89, 33, 106, 4]);
    expect(rects).toContainEqual([88, 32, 106, 4]);
  });

  runMap('組合畫面下月曆照样能切（日曆那一块在）', async () => {
    const { state } = gameState();
    const img = images(await drawTwice(2, 'month'));
    expect(img).toContainEqual({ tag: `Panel.mkf:2:${4 + sceneOfMonth(state.month)}`, x: 0, y: 280 });
    expect(img.some((i) => i.tag === 'minimapBg' && i.y === 80)).toBe(true);
  });

  runMap('日、月曆：整版面板 + 日曆，没有小地图', async () => {
    const img = images(await drawTwice(0));
    expect(img.some((i) => i.tag === 'Panel.mkf:0:0')).toBe(true);
    expect(img.some((i) => i.tag === 'Panel.mkf:0:4')).toBe(false);
    expect(img.some((i) => i.tag === 'minimapBg')).toBe(false);
    expect(img.some((i) => i.tag.startsWith('Panel.mkf:2:') && i.y === 280)).toBe(true);
  });

  runMap('縮小地圖：整版面板 + 小地图 @280，没有日曆', async () => {
    const img = images(await drawTwice(1));
    expect(img.some((i) => i.tag === 'Panel.mkf:0:0')).toBe(true);
    expect(img).toContainEqual({ tag: 'minimapBg', x: 0, y: 280 });
    expect(img.some((i) => i.tag.startsWith('Panel.mkf:2:'))).toBe(false);
  });
});

// ============================================================
//  ④ main.ts 接线
// ============================================================
describe('④ main.ts：熱鍵、两道闸、单机/联机同一条绘制路', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const between = (from: string, to: string): string => {
    const a = main.indexOf(from);
    const b = main.indexOf(to, a + from.length);
    return a < 0 || b < 0 ? '' : main.slice(a, b);
  };

  it('熱鍵「切換視窗組」轮 `cfg+5` 三态（不再轮日曆/月曆/小地圖），只在棋盘上生效，并写回 cfg', () => {
    const block = between('case HOTKEY.switchWindowGroup:', 'case HOTKEY.query:');
    expect(block).toContain('options = { ...options, windowView: (options.windowView + 1) % 3 };');
    expect(block).toContain("if (screen !== 'game') return false;");
    expect(block).toContain('saveConfigToStore();');
    expect(block).not.toContain("'month'");
  });

  it('PgUp/PgDn：組合畫面下吃掉（资产表屏那一支不受影响）', () => {
    const block = between('case HOTKEY.pageDown:', 'cyclePanelPage(fn');
    expect(block.indexOf("if (screen === 'assets')")).toBeGreaterThan(0);
    expect(block).toContain("if (sidebarLayout(options.windowView).panel !== 'full') return true;");
  });

  it('点竖条换页：只有整版面板才判', () => {
    expect(main).toContain(
      "const tag = layout.panel === 'full' ? hitPanelTag(p.x - LAYOUT.panel.x, p.y - LAYOUT.panel.y) : null;",
    );
  });

  it('小地图的按下 / 悬停 / 拖动都按三态取顶边', () => {
    expect(main.match(/hitMinimapArea\(options\.windowView,/g)?.length).toBe(2);
    expect(main).toContain('(sidebarLayout(options.windowView).minimapTop ?? SIDEBAR.y)');
    // 旧写法（小地图只可能在 280）不许回来
    expect(main).not.toContain("sidebarView === 'map'");
  });

  it('★ 单机与联机同一条绘制路：只有一处 `hud.draw`，版式直读 `options.windowView`', () => {
    expect(main.match(/\bhud\.draw\(/g)?.length).toBe(1);
    const call = between('hud.draw({', '});');
    expect(call).toContain('windowView: options.windowView,');
    expect(call).toContain('calendarPage,');
    expect(call).not.toMatch(/\bnet\b/);
  });
});
