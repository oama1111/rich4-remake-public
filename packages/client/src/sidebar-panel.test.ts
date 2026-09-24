/*
 * 侧栏面板补全（pt22 WP-2：#2 惡人回合面板、#3 结盟小头像、#12 日/月曆存盘、#16 落地影片期间的侧栏）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事：
 *   ① exe 字节：两个面板开头「画谁」的判据、惡人那一支的底图 / 名字 / 小头像、结盟小头像、
 *      日/月曆那一格（`[0x497164]`）的出厂值与两处写入、换人之后那一次整窗重画的调用链；
 *   ② 纯函数：`panelSubject`（玩家 / 惡人 / 機器娃娃）、`allyPortraitPlayer`；
 *   ③ 真画一遍（假画布）：整版 / 窄版的惡人那一版、结盟小头像、落地影片期间画的是新玩家；
 *   ④ 单机与联机：同一条 action 在两份独立重放上得到同一组绘制调用（各端自己画，画的必须一样）。
 *
 * ★ 可证伪性：底图改回图 0 / 图 4、名字坐标差一格、小头像画成图 0 或画成当前玩家的、
 *   娃娃那一格画成惡人、结盟头像画成自己、落地期间侧栏停在上一位 —— 都会当场红。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MkfArchive, parseSpriteSheet } from '@rich4/assets-pipeline';
import {
  NPC_NAMES,
  landAll,
  newGame,
  parseMap,
  reduce,
  releaseNpc,
  type GameState,
} from '@rich4/core';
import { CHARACTERS } from '@rich4/data';
import {
  COMPACT,
  Hud,
  MINI_PORTRAIT,
  VILLAIN_PANEL,
  allyPortraitPlayer,
  panelSubject,
  type HudInput,
} from './hud.ts';
import { portraitResource, type Sprite, type SpriteCache } from './assets.ts';
import { hideLandingPlayer, landingTrigger } from './landing-fx.ts';

const WS = process.env.RICH4_WORKSPACE ?? '';
const EXE = WS + '/Rich4/rich4.exe';
const PANEL_MKF = WS + '/Rich4/Panel.mkf';
const MAP_MKF = WS + '/Rich4/map.mkf';
const MAP = WS + '/extracted/map/0001.bin';
const runExe = existsSync(EXE) ? it : it.skip;
const runPanel = existsSync(PANEL_MKF) && existsSync(MAP_MKF) ? it : it.skip;
const runMap = existsSync(MAP) ? it : it.skip;

/** VA → 文件偏移（与 `tools/disasm.py` 的 `SECTIONS` 同一套：代码段 / 数据段） */
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = va < 0x463000 ? 1024 + (va - 0x401000) : 398848 + (va - 0x463000);
  return [...d.subarray(off, off + n)];
}
const hex = (bytes: number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
/** `call rel32`（`e8 xx xx xx xx`）在 `va` 处的目标 */
function callTarget(va: number): number {
  const b = exeBytes(va, 5);
  expect(b[0]).toBe(0xe8);
  return va + 5 + new DataView(Uint8Array.from(b.slice(1)).buffer).getInt32(0, true);
}

// ============================================================
//  ① exe 字节
// ============================================================
describe('① 回 exe 钉', () => {
  runExe('#2 两个面板开头同一条判据：`[0x49910c] < [0x499114]` 或 `== 8` ⇒ 玩家，其余 ⇒ 惡人', () => {
    // 整版 00415fc1 mov eax,[0x49910c] / cmp eax,[0x499114] / jl / cmp eax,8 / je
    expect(hex(exeBytes(0x415fc1, 26))).toBe(
      'a1 0c 91 49 00 3b 05 14 91 49 00 0f 8c 3b 01 00 00 83 f8 08 0f 84 32 01 00 00',
    );
    // 窄版 00416767 同形（短跳）
    expect(hex(exeBytes(0x416767, 18))).toBe('a1 0c 91 49 00 3b 05 14 91 49 00 7c 75 83 f8 08 74 70');
    // 玩家那一支：8 ⇒ 画 `[0x498e70]`（替身记录 +8 主人）那位 @source 0x0041610d
    expect(hex(exeBytes(0x41610d, 18))).toBe('8b 1d 0c 91 49 00 83 fb 08 75 09 0f b6 35 70 8e 49 00');
  });

  runExe('#2 惡人那一支：底图 `[0x48be0c]+0x48` = 图 5；22 号字 (582,40) flag 2；主人图集 +0x18 @ (524,64)', () => {
    expect(hex(exeBytes(0x415fe2, 8))).toBe('a1 0c be 48 00 83 c0 48');
    expect((0x48 - 0xc) / 0xc).toBe(VILLAIN_PANEL.image);
    // push 0 / push 2 / push 0 / push 0x101010 / push 0x16 / call set_font
    expect(hex(exeBytes(0x415ff9, 13))).toBe('6a 00 6a 02 6a 00 68 10 10 10 00 6a 16');
    expect(VILLAIN_PANEL.name.size).toBe(0x16);
    // push 2 / push 0x28 / push 0x246 / 名字 = [actor*4 + 0x47ed5a]
    expect(hex(exeBytes(0x41600e, 21))).toBe('6a 02 6a 28 68 46 02 00 00 a1 0c 91 49 00 8b 14 85 5a ed 47 00');
    expect([VILLAIN_PANEL.name.x + 440, VILLAIN_PANEL.name.y]).toEqual([0x246, 0x28]);
    // push 0x40 / push 0x20c / byte [actor*16 + 0x498df0]（替身记录 +8 主人）×0x34 → [0x498eb0] + 0x18
    expect(hex(exeBytes(0x41602e, 37))).toBe(
      '6a 40 68 0c 02 00 00 a1 0c 91 49 00 c1 e0 04 8a 80 f0 8d 49 00 25 ff 00 00 00 6b c0 34 8b 80 b0 8e 49 00 83 c0',
    );
    expect(exeBytes(0x416053, 1)).toEqual([0x18]); // 00416051 add eax, 0x18
    expect([MINI_PORTRAIT.x + 440, MINI_PORTRAIT.y]).toEqual([0x20c, 0x40]);
    // 图集 +0xc 是图 0（大头像，0x00416244），+0x18 就是图 1
    expect((0x18 - 0xc) / 0xc).toBe(MINI_PORTRAIT.image);
  });

  runExe('#2 窄版惡人那一支：20 号字 (582,20)，同一张名字表、同一颗小头像', () => {
    expect(hex(exeBytes(0x416779, 13))).toBe('6a 00 6a 02 6a 00 68 10 10 10 00 6a 14');
    expect(hex(exeBytes(0x41678e, 21))).toBe('6a 02 6a 14 68 46 02 00 00 a1 0c 91 49 00 8b 3c 85 5a ed 47 00');
    expect([VILLAIN_PANEL.compactName.x + 440, VILLAIN_PANEL.compactName.y, VILLAIN_PANEL.compactName.size]).toEqual([
      0x246, 0x14, 0x14,
    ]);
    expect(hex(exeBytes(0x4167ae, 37))).toBe(
      '6a 40 68 0c 02 00 00 a1 0c 91 49 00 c1 e0 04 8a 80 f0 8d 49 00 25 ff 00 00 00 6b c0 34 8b 80 b0 8e 49 00 83 c0',
    );
  });

  runExe('#2 名字表 `0x47ed5a[4..7]` → 小偷 / 強盜 / 流氓 / 間諜（与 `NPC_NAMES` 同序）', () => {
    const b = exeBytes(0x47ed5a + 16, 16);
    const dv = new DataView(Uint8Array.from(b).buffer);
    const big5 = new TextDecoder('big5');
    const names = [0, 1, 2, 3].map((i) => {
      const at = dv.getUint32(i * 4, true);
      return big5.decode(Uint8Array.from(exeBytes(at, 4)));
    });
    expect(names).toEqual([...NPC_NAMES]);
  });

  runExe('#3 结盟小头像：`[p+0x41]`（0x496ba9 allied_player）≠ 0 ⇒ 盟友（值 − 1）图集 +0x18 @ (524,64)，两版同形', () => {
    // 整版 00416256 mov dl,[ebx+0x496ba9] / test dl,dl / je / push 0x40 / push 0x20c / … dec eax / imul 0x34 / +0x18
    expect(hex(exeBytes(0x416256, 36))).toBe(
      '8a 93 a9 6b 49 00 84 d2 74 28 6a 40 68 0c 02 00 00 31 c0 88 d0 48 6b c0 34 8b 80 b0 8e 49 00 83 c0 18 50 8b',
    );
    // 窄版 0041685a
    expect(hex(exeBytes(0x41685a, 35))).toBe(
      '8a b3 a9 6b 49 00 84 f6 74 27 6a 40 68 0c 02 00 00 31 c0 88 f0 48 6b c0 34 8b 80 b0 8e 49 00 83 c0 18 50',
    );
    // 玩家表基址 0x496b68（+0 名字、+4 颜色 0x496b6c、+8 xpos 0x496b70）⇒ 0x496ba9 = **+0x41 allied_player**
    //   （对方下标 + 1，`docs/player-struct.md`）= core 的 `alliedPlayer`；+0x3d 是天数（审计表把两格记混了）
    expect(0x496ba9 - 0x496b68).toBe(0x41);
  });

  runExe('#12 日/月曆那一格 `[0x497164]`：出厂 0、点太阳写 0、点月亮写 1（与 cfg 基址 0x497158 同一块）', () => {
    expect(hex(exeBytes(0x411f02, 8))).toBe('30 ed 88 2d 64 71 49 00'); // xor ch,ch / mov [0x497164],ch
    expect(hex(exeBytes(0x4183c4, 8))).toBe('30 db 88 1d 64 71 49 00'); // xor bl,bl / mov [0x497164],bl
    expect(hex(exeBytes(0x41840c, 7))).toBe('c6 05 64 71 49 00 01'); // mov byte [0x497164],1
  });

  runExe('#16 换人之后那一次整窗重画在**落地影片之前**：`0x41c84f` → `0x436a5a` → `0x41906a(1)` → WM_PAINT', () => {
    // 回合边界 0x41c84f 的第二句（没上盘的人也走到这里，`0x0041c875` 才提前返回）
    expect(callTarget(0x41c86d)).toBe(0x436a5a);
    // 0x436a5a：`还款日 − 今天 ≤ 3`（有符号 `jg`）就 `push 1 / call 0x41906a` ——
    //   没借过钱（+0x2c == 0）时差是负数，**必然**走这一句（跳表那一段才用无符号 `ja` 挡掉）
    expect(hex(exeBytes(0x436a7c, 11))).toBe('83 f8 03 0f 8f 81 00 00 00 6a 01');
    expect(callTarget(0x436a87)).toBe(0x41906a);
    // 0x41906a = 直接调窗口过程 0x417e26(hwnd, 0xf = WM_PAINT, 0, 0)
    expect(hex(exeBytes(0x41906e, 6))).toBe('6a 00 6a 00 6a 0f');
    expect(callTarget(0x41907b)).toBe(0x417e26);
    // WM_PAINT（0x418bb9）：先棋盘 0x415e70(0)（里头 0x40829d(0,0) 摆人、置 [0x475114]），再侧栏 0x415f69(0)
    expect(callTarget(0x418bc5)).toBe(0x415e70);
    expect(callTarget(0x418be4)).toBe(0x415f69);
    expect(callTarget(0x418bf7)).toBe(0x415f69);
    expect(callTarget(0x418c0a)).toBe(0x4166f8);
    // 换人 0x418ebd 里调 0x41c84f（0x00419039）在前；主循环随后才进 0x418c55 播落地影片（0x00418ca9）
    expect(callTarget(0x419039)).toBe(0x41c84f);
    expect(callTarget(0x418ca9)).toBe(0x45144f);
  });
});

describe('① 资源', () => {
  runPanel('`Panel.mkf` 资源 0 共 6 张：图 5 = 200×280（惡人那一版）；角色图集图 1 = 小头像', () => {
    const panel = new MkfArchive(new Uint8Array(readFileSync(PANEL_MKF)));
    const sheet = parseSpriteSheet(panel.read(0))!;
    expect(sheet.images).toHaveLength(6);
    expect([sheet.images[5]!.width, sheet.images[5]!.height]).toEqual([200, 280]);
    const map = new MkfArchive(new Uint8Array(readFileSync(MAP_MKF)));
    for (let ch = 0; ch < 12; ch++) {
      const atlas = parseSpriteSheet(map.read(portraitResource(ch)))!;
      // 图 1 是小头像（各角色 30..41 × 30..35 不等），比图 0 的大头像小一圈
      const [big, mini] = [atlas.images[0]!, atlas.images[1]!];
      expect(mini.width, `角色 ${ch}`).toBeLessThanOrEqual(48);
      expect(mini.height, `角色 ${ch}`).toBeLessThanOrEqual(48);
      expect(mini.width * mini.height, `角色 ${ch}`).toBeLessThan(big.width * big.height);
    }
  });
});

// ============================================================
//  ② 纯函数
// ============================================================
describe('② `panelSubject` / `allyPortraitPlayer`', () => {
  const state = (): GameState => {
    const s = newGame({
      map: { nodes: [], lands: [], facilities: [], commercials: [] } as never,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    const specialActors = [...s.specialActors];
    specialActors[1] = { ...specialActors[1]!, owner: 2 };
    return { ...s, currentPlayer: 3, specialActors };
  };

  it('没有替身在走 ⇒ 当前玩家', () => {
    expect(panelSubject(state(), null)).toEqual({ kind: 'player', player: 3 });
    expect(panelSubject(state(), undefined)).toEqual({ kind: 'player', player: 3 });
  });

  it('★ 惡人（槽 0..3 = actor 4..7）⇒ 惡人那一版：名字 + **主人**（替身记录 +8）', () => {
    expect(panelSubject(state(), 1)).toEqual({ kind: 'villain', actor: 5, name: '強盜', owner: 2 });
    expect(panelSubject(state(), 0)).toMatchObject({ kind: 'villain', actor: 4, name: '小偷' });
    expect(panelSubject(state(), 3)).toMatchObject({ kind: 'villain', actor: 7, name: '間諜' });
  });

  it('★ 機器娃娃（槽 4 = actor 8）⇒ 仍是玩家（用道具的那位 = 当前玩家）', () => {
    expect(panelSubject(state(), 4)).toEqual({ kind: 'player', player: 3 });
  });

  it('`alliedPlayer` = 玩家号 + 1；0 = 没有', () => {
    expect(allyPortraitPlayer({ alliedPlayer: 0 })).toBeNull();
    expect(allyPortraitPlayer({ alliedPlayer: 3 })).toBe(2);
    expect(allyPortraitPlayer(undefined)).toBeNull();
  });
});

// ============================================================
//  ③ 真画一遍（假画布）
// ============================================================

interface Call {
  op: string;
  args: unknown[];
}

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
      calls.push({ op: `set:${key}`, args: [v] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

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
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
type Map0 = ReturnType<typeof loadMap>;
const topoOf = (map: Map0) => ({
  nodes: map.nodes,
  lands: map.lands,
  facilities: map.facilities,
  commercials: map.commercials,
  landscapes: map.landscapes,
});

/** 画两遍（第一遍把精灵排进解码，等它们落地再画第二遍），返回第二遍的调用 */
async function drawTwice(
  state: GameState,
  map: Map0,
  windowView: number,
  npcSlot: number | null,
): Promise<Call[]> {
  const { ctx, calls } = fakeCtx();
  const hud = new Hud(ctx, fakeCache());
  const input: HudInput = {
    state,
    map,
    camera: { x: 0, y: 0, view: 0 } as unknown as HudInput['camera'],
    minimapBg: MINIMAP_BG,
    windowView,
    calendarPage: 'calendar',
    minimapMarker: null,
    npcFrame: null,
    npcSlot,
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

const images = (calls: Call[]): { tag: string; x: unknown; y: unknown; at: number }[] =>
  calls
    .map((c, at) => ({ c, at }))
    .filter(({ c }) => c.op === 'drawImage')
    .map(({ c, at }) => ({ tag: (c.args[0] as { tag: string }).tag, x: c.args[1], y: c.args[2], at }));
const texts = (calls: Call[]): { s: unknown; x: unknown; y: unknown; at: number }[] =>
  calls
    .map((c, at) => ({ c, at }))
    .filter(({ c }) => c.op === 'fillText')
    .map(({ c, at }) => ({ s: c.args[0], x: c.args[1], y: c.args[2], at }));
const strip = <T extends { at: number }>(xs: T[]): Omit<T, 'at'>[] =>
  xs.map((x) => {
    const r: Partial<T> = { ...x };
    delete r.at;
    return r as Omit<T, 'at'>;
  });

/** 四位都在盘上；强盜（槽 1）由 2 号玩家保釋出来在盘上 */
function villainScene(map: Map0): GameState {
  const s = landAll(
    newGame({ map, players: [0, 1, 2, 3].map((i) => ({ character: (i * 5) % 12, kind: 'computer' as const })) }),
    map.nodes,
  );
  const specialActors = [...s.specialActors];
  specialActors[1] = releaseNpc(map.nodes[10]!.id, 2, 0);
  return { ...s, currentPlayer: 0, specialActors };
}

describe('③ 惡人回合 —— 整版 / 窄版', () => {
  runMap('★ 整版：图 5 @ (0,0)、名字 (142,40)、**主人**的小头像 @ (84,64)；没有竖标签 / 数值 / 物價指數', async () => {
    const map = loadMap();
    const s = villainScene(map);
    const calls = await drawTwice(s, map, 1, 1);
    const img = strip(images(calls));
    expect(img).toContainEqual({ tag: `Panel.mkf:0:${VILLAIN_PANEL.image}`, x: 0, y: 0 });
    for (const page of [0, 1, 2, 3, 4]) expect(img.some((i) => i.tag === `Panel.mkf:0:${page}`)).toBe(false);
    const owner = s.players[2]!.character;
    expect(img).toContainEqual({ tag: `map.mkf:${portraitResource(owner)}:${MINI_PORTRAIT.image}`, x: 84, y: 64 });
    // 不画任何人的大头像（图 0）
    expect(img.some((i) => /^map\.mkf:\d+:0$/.test(i.tag))).toBe(false);
    const t = strip(texts(calls));
    expect(t).toContainEqual({ s: '強盜', x: 142, y: 40 });
    expect(t.some((x) => String(x.s).startsWith('物價指數'))).toBe(false);
    expect(t.some((x) => x.s === '$1' || x.s === '資' || x.s === '現  金')).toBe(false);
    expect(t.some((x) => x.s === CHARACTERS[s.players[0]!.character]!.name)).toBe(false);
    // 小地图照常画
    expect(img.some((i) => i.tag === 'minimapBg')).toBe(true);
  });

  runMap('★ 窄版：图 4、名字 (142,20) 20 号、标签还在（烙在图 4 上）、没有数与色条', async () => {
    const map = loadMap();
    const s = villainScene(map);
    const calls = await drawTwice(s, map, 2, 1);
    const img = strip(images(calls));
    expect(img).toContainEqual({ tag: `Panel.mkf:0:${COMPACT.image}`, x: 0, y: 0 });
    expect(img).toContainEqual({
      tag: `map.mkf:${portraitResource(s.players[2]!.character)}:${MINI_PORTRAIT.image}`,
      x: 84,
      y: 64,
    });
    const t = strip(texts(calls));
    expect(t).toContainEqual({ s: '強盜', x: 142, y: 20 });
    expect(t).toContainEqual({ s: '現金', x: 90, y: 40 });
    expect(t).toContainEqual({ s: '存款', x: 90, y: 62 });
    expect(t.some((x) => String(x.s).startsWith('$'))).toBe(false);
    const rects = calls.filter((c) => c.op === 'fillRect').map((c) => c.args);
    expect(rects).not.toContainEqual([88, 32, 106, 4]);
    expect(rects).not.toContainEqual([89, 33, 106, 4]);
  });

  runMap('機器娃娃（槽 4）那一趟 ⇒ 仍画当前玩家那一版（图 0、他的名字）', async () => {
    const map = loadMap();
    const s = villainScene(map);
    const calls = await drawTwice(s, map, 1, 4);
    const img = strip(images(calls));
    expect(img).toContainEqual({ tag: 'Panel.mkf:0:0', x: 0, y: 0 });
    expect(strip(texts(calls)).some((x) => x.s === CHARACTERS[s.players[0]!.character]!.name)).toBe(true);
  });
});

describe('③ 结盟小头像 —— 整版 / 窄版', () => {
  runMap('★ `alliedPlayer` ≠ 0 ⇒ 盟友图集图 1 @ (84,64)，在大头像之后、名字之前；0 ⇒ 不画', async () => {
    const map = loadMap();
    const base = villainScene(map);
    const s: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, alliedPlayer: 3, alliedDays: 7 } : p)),
    };
    const me = s.players[0]!;
    const ally = s.players[2]!;
    for (const view of [1, 2]) {
      const calls = await drawTwice(s, map, view, null);
      const img = images(calls);
      const mini = img.find((i) => i.tag === `map.mkf:${portraitResource(ally.character)}:${MINI_PORTRAIT.image}`);
      expect(mini, `視窗 ${view}`).toMatchObject({ x: 84, y: 64 });
      const face = img.find((i) => i.tag === `map.mkf:${portraitResource(me.character)}:0`)!;
      const name = texts(calls).find((x) => x.s === CHARACTERS[me.character]!.name)!;
      expect(face.at).toBeLessThan(mini!.at);
      expect(mini!.at).toBeLessThan(name.at);

      const plain = await drawTwice(base, map, view, null);
      expect(images(plain).some((i) => i.x === 84 && i.y === 64)).toBe(false);
    }
  });

  runMap('整版：色条在大头像**之前**画（0x004161f8 填色 → 0x0041624e 贴头像）', async () => {
    const map = loadMap();
    const s = villainScene(map);
    const calls = await drawTwice(s, map, 1, null);
    const bar = calls.findIndex((c) => c.op === 'fillRect' && c.args[0] === 0x20a - 440 && c.args[1] === 0x38);
    const face = images(calls).find((i) => i.tag === `map.mkf:${portraitResource(s.players[0]!.character)}:0`)!;
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(bar).toBeLessThan(face.at);
  });
});

// ============================================================
//  ④ 单机与联机：同一条 action、两份独立重放 ⇒ 同一组绘制调用
// ============================================================
describe('④ 单机 / 联机画的是同一个东西', () => {
  for (const mode of ['single', 'multiplayer'] as const) {
    runMap(`★ ${mode}：最后一位收回合、强盜走一趟 ⇒ 两端都画惡人那一版，调用逐条相同`, async () => {
      const map = loadMap();
      const topo = topoOf(map);
      const s0 = landAll(
        newGame({
          map,
          players: [0, 1, 2, 3].map((i) => ({ character: (i * 5) % 12, kind: 'computer' as const })),
          seed: 9,
          mode,
        }),
        map.nodes,
      );
      const specialActors = [...s0.specialActors];
      specialActors[1] = releaseNpc(map.nodes[10]!.id, 2, 0);
      const before: GameState = {
        ...s0,
        currentPlayer: 3,
        phase: 'turnEnd',
        pending: null,
        pendingNpcSlots: [],
        specialActors,
        players: s0.players.map((p, i) => (i === 1 ? { ...p, alliedPlayer: 4, alliedDays: 7 } : i === 3 ? { ...p, alliedPlayer: 2, alliedDays: 7 } : p)),
      };
      // 行动者一端与旁观者一端各自重放同一条 action（联机就是这样：服务器只转发 action）
      const host = reduce(before, { type: 'endTurn' }, topo);
      const remote = reduce(structuredClone(before), { type: 'endTurn' }, topo);
      const walk = host.lastNpcWalks.find((w) => w.slot === 1);
      expect(walk, '强盜这一趟交给了表现层').toBeTruthy();
      expect(remote.lastNpcWalks).toEqual(host.lastNpcWalks);
      expect(panelSubject(host, 1)).toEqual({ kind: 'villain', actor: 5, name: '強盜', owner: 2 });
      expect(panelSubject(remote, 1)).toEqual(panelSubject(host, 1));
      for (const view of [0, 1, 2]) {
        // 补间在走的那一段
        const a = await drawTwice(host, map, view, 1);
        const b = await drawTwice(remote, map, view, 1);
        expect(b).toEqual(a);
        // 补间走完 ⇒ 回到当前玩家（含结盟小头像）
        const c = await drawTwice(host, map, view, null);
        const d = await drawTwice(remote, map, view, null);
        expect(d).toEqual(c);
      }
    });
  }
});

// ============================================================
//  #16 落地影片期间侧栏已是新玩家（E-44 ①）
// ============================================================
describe('#16 落地影片期间：侧栏已是**新**玩家（原版在影片之前那次整窗重画就换了）', () => {
  for (const mode of ['single', 'multiplayer'] as const) {
    runMap(`${mode}：换人那条 action 让 1 号落地 ⇒ 影片期间（坐标藏着）侧栏画 1 号`, async () => {
      const map = loadMap();
      const topo = topoOf(map);
      const s0 = newGame({
        map,
        players: [0, 1, 2, 3].map((i) => ({ character: (i * 5) % 12, kind: 'computer' as const })),
        seed: 3,
        mode,
      });
      const before: GameState = { ...s0, phase: 'turnEnd', pendingNpcSlots: [] };
      const after = reduce(before, { type: 'endTurn' }, topo);
      expect(landingTrigger(before, after)).toBe(1);
      const filming = hideLandingPlayer(after, 1);
      expect(panelSubject(filming, null)).toEqual({ kind: 'player', player: 1 });
      const calls = await drawTwice(filming, map, 1, null);
      const t = strip(texts(calls));
      expect(t).toContainEqual({ s: CHARACTERS[after.players[1]!.character]!.name, x: 0x234 - 440, y: 0x28 });
      expect(t.some((x) => x.s === CHARACTERS[after.players[0]!.character]!.name)).toBe(false);
    });
  }

  it('main.ts：侧栏按 `hudState`（当前玩家）画，落地期间只藏坐标，不回退到上一位', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('state: withLandingHidden(hudState),');
    expect(main).toContain('panelPage: panelPages[hudState.currentPlayer] ?? 0,');
    expect(main).toContain('npcSlot: npcWalk?.slot ?? null,');
  });
});

// ============================================================
//  #12 main.ts 接线
// ============================================================
describe('#12 日/月曆存进 cfg+12（main.ts 接线）', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const at = (from: string, n: number): string => main.slice(main.indexOf(from), main.indexOf(from) + n);

  it('点太阳 / 月亮 ⇒ 改 `options.calendar` 并当场写回 cfg；已是这一面就不理', () => {
    const click = at('const to = hitCalendarToggle(', 900);
    expect(click).toContain('if (to !== null && to !== calendarPageOf(options)) {');
    expect(click).toContain("options = { ...options, calendar: to === 'month' ? 1 : 0 };");
    expect(click).toContain('saveConfigToStore();');
  });

  it('开机读回、存盘写出；侧栏每帧从 `options` 取', () => {
    expect(at('function loadConfigFromStore(): void {', 800)).toContain('calendar: cfg.calendar ?? 0,');
    expect(at('function saveConfigToStore(): void {', 800)).toContain('calendar: options.calendar,');
    expect(main).toContain('calendarPage: calendarPageOf(options),');
    expect(main).not.toMatch(/let calendarPage\b/);
  });
});
