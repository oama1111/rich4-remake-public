/*
 * 夢遊中的棋子长什么样（第十九份試玩回報：「约翰乔梦游没有变色，也没有提示还剩几天」）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版（`rich4.exe`）：
 *   · 人物图换**睡衣那套**：`_rich4_update_player_sprite` `0x0040ba16 cmp byte [player+0x37],0` →
 *     站 `edi+0x10`（0x0040ba58）、走 `edi+0x11`（0x0040ba75）、掷骰 `edi+2`（0x0040ba91），edi = 0x80 + 角色×21。
 *   · 头上再贴一张「ZZZ」：`fcn_0040829d` `0x00408870 cmp byte [player+0x37],0` → `0x004088c7 mov eax,[0x496978]`
 *     （物件图集表下标 19 = `Data.mkf` 0x19e），类别 0xe / 0xf（`0x004088ab` / `0x004088b4`），
 *     帧号 `[+0x498ea4]` 只在夢遊着走子时一 tick 进一帧、数到 6 回零（`0x0040c455..0x0040c47e`）。
 *   · **不**变灰：去色（`_rich4_convert_sprite`）只认 `+0x36` 冬眠（`0x004087be`）。
 *   · 「還剩 N 天」框**没有**夢遊那一扇：回合开始 `fcn_0040c912` 只给 住宿/消失/坐牢/住院/冬眠 推串
 *     （`0x4631e0`/`0x4631f5`/`0x46320a`/`0x46321f`/`0x463234`），夢遊那支 `0x0040cba5` 直接 `call 0x40dd1f`
 *     掷骰走子、返回 −1；全 exe 的「夢遊」字面只有 `%s夢遊中 免收%s！`（过路费）、`夢遊中`（状态表 0x475b4c）、卡名。
 *
 * 可证伪（已验证）：把 `render.ts` 里的 `characterSleepwalkSprite` 换回 `characterSetBase(...) + pose`，
 *   或删掉 `#sleepwalkMarkSlot` 那两处 push，端到端那两条 ★ 变红。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoardRenderer,
  DRAW_CLASS,
  SLEEPWALK_MARK_FRAMES,
  SLEEPWALK_MARK_RESOURCE,
  nextSleepwalkMarkFrame,
  sleepwalkingKeys,
  type Camera,
} from './render.ts';
import {
  CHARACTER_POSE,
  CHARACTER_SLEEPWALK_OFFSET,
  SpriteCache,
  characterSetBase,
  characterSleepwalkSprite,
  type Sprite,
} from './assets.ts';
import { makeGameState, makeNode, makePlayer, type GameState, type Rich4Map } from '@rich4/core';

describe('★ 夢遊的人物图 = 睡衣那套（k16 站 / k17 走 / k2 掷骰）@source 0x0040ba16', () => {
  it('★ 约翰喬（角色 0）：站 0x90、走 0x91、掷骰 0x82 —— 不看交通方式', () => {
    expect(CHARACTER_SLEEPWALK_OFFSET).toBe(0x10);
    expect(characterSleepwalkSprite(0, CHARACTER_POSE.stand)).toBe(0x80 + 0x10);
    expect(characterSleepwalkSprite(0, CHARACTER_POSE.walk)).toBe(0x80 + 0x11);
    expect(characterSleepwalkSprite(0, CHARACTER_POSE.dice)).toBe(0x80 + 2);
    // 角色 3（錢夫人）：0x80 + 3×21 = 0xbf
    expect(characterSleepwalkSprite(3, CHARACTER_POSE.walk)).toBe(0xbf + 0x11);
    // 与常规那套（骑機車 = 交通方式 1）不同
    expect(characterSleepwalkSprite(0, CHARACTER_POSE.stand)).not.toBe(characterSetBase(0, 1));
  });

  it('「ZZZ」图 = 物件图集表下标 19 = Data.mkf 0x19e（`0x496978 = 0x49692c + 19×4`），6 帧', () => {
    expect(SLEEPWALK_MARK_RESOURCE).toBe(0x19e);
    expect(SLEEPWALK_MARK_FRAMES).toBe(6);
    expect(nextSleepwalkMarkFrame(0, 1)).toBe(1);
    expect(nextSleepwalkMarkFrame(5, 1)).toBe(0); // cmp bh,6 / jne / 归零
    expect(nextSleepwalkMarkFrame(4, 3)).toBe(1);
    expect(DRAW_CLASS.sleepwalkMark).toBe(0xe);
    expect(DRAW_CLASS.currentSleepwalkMark).toBe(0xf);
    // 压在棋子（0xc / 0xd）之上
    expect(DRAW_CLASS.sleepwalkMark).toBeGreaterThan(DRAW_CLASS.player);
    expect(DRAW_CLASS.currentSleepwalkMark).toBeGreaterThan(DRAW_CLASS.currentPlayer);
  });

  it('`sleepwalkingKeys`：玩家看 `blocking.sleepWalking`（+0x37），替身看记录 +13；冬眠不算', () => {
    const s = makeGameState();
    const players = s.players.map((p, i) =>
      i === 1
        ? { ...p, blocking: { ...p.blocking, sleepWalking: 3 } }
        : i === 2
          ? { ...p, blocking: { ...p.blocking, sleeping: 3 } }
          : p,
    );
    const specialActors = [...s.specialActors];
    specialActors[0] = { ...specialActors[0]!, sleepwalkDays: 5 };
    const keys = sleepwalkingKeys({ ...s, players, specialActors });
    expect([...keys].sort()).toEqual(['a0', 'p1']);
  });
});

// ============================================================
//  端到端：`draw()` 真的换了图、贴了 ZZZ、走子时 ZZZ 跟着换帧
// ============================================================

interface FakeBitmap {
  close: () => void;
  res: number;
  idx: number;
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; images: { bitmap: FakeBitmap; x: number; y: number }[] } {
  const images: { bitmap: FakeBitmap; x: number; y: number }[] = [];
  const noop = (): void => undefined;
  const ctx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    setTransform: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
    drawImage: (b: unknown, x: number, y: number) => {
      images.push({ bitmap: b as FakeBitmap, x, y });
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, images };
}

/** 假图集：「ZZZ」6 张，人物站姿 8 张、其余 72 张（= 8 向 × 9 帧） */
function fakeCache(): SpriteCache {
  const cache = new SpriteCache({ get: () => ({ read: () => new Uint8Array(0) }) } as never, {});
  vi.spyOn(cache, 'imageCount').mockImplementation((_a, res) => (res === SLEEPWALK_MARK_RESOURCE ? 6 : 72));
  vi.spyOn(cache, 'get').mockImplementation(async (_a, res, idx) => {
    return {
      bitmap: { close: () => undefined, res, idx },
      width: 16,
      height: 24,
      anchorX: 8,
      anchorY: 16,
    } as unknown as Sprite;
  });
  return cache;
}

const CAM: Camera = { x: 0, y: 0, scale: 1, view: 0, tileX: 0, tileY: 0 };

function map2(): Rich4Map {
  return {
    nodes: [makeNode({ id: 1, x: 32, y: 32, adjacent: [2] }), makeNode({ id: 2, x: 96, y: 32, adjacent: [1] })],
    lands: [],
    facilities: [],
    commercials: [],
    landscapes: [],
    dataSize: 0,
  };
}

/** 只有 0 号在盘上（角色 0 = 約翰喬），站在 1 号格；`sleepWalking` / `sleeping` 按参数 */
function onlyJohn(b: { sleepWalking?: number; sleeping?: number }, current = 1): GameState {
  const s = makeGameState();
  const john = makePlayer({ index: 0, character: 0, nodeId: 1, xpos: 32, ypos: 32 });
  const players = s.players.map((p, i) =>
    i === 0
      ? { ...john, blocking: { ...john.blocking, sleepWalking: b.sleepWalking ?? 0, sleeping: b.sleeping ?? 0 } }
      : { ...p, xpos: 0, whoPlays: 0 },
  );
  return { ...s, players, currentPlayer: current, phase: 'awaitingRoll' };
}

async function drawSettled(renderer: BoardRenderer, state: GameState, images: { bitmap: FakeBitmap }[]): Promise<void> {
  const input = { map: map2(), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 }, tickMs: 20 };
  // 精灵异步解码落地：棋子那张先到，ZZZ 那张在棋子画得出来的那一帧才开始要 ⇒ 多等一轮
  for (let i = 0; i < 2; i++) {
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));
  }
  images.length = 0;
  renderer.draw(input);
}

describe('★ 端到端：夢遊的約翰喬画成睡衣 + ZZZ（单机与联机同一条 —— 画面只读 state）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('★ 夢遊中：画 0x90（睡衣站姿）+ 0x19e（ZZZ），不画平时那套 0x80', async () => {
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    await drawSettled(renderer, onlyJohn({ sleepWalking: 3 }), images);
    const res = images.map((i) => i.bitmap.res);
    expect(res).toContain(0x80 + 0x10);
    expect(res).not.toContain(0x80);
    const zzz = images.filter((i) => i.bitmap.res === SLEEPWALK_MARK_RESOURCE);
    expect(zzz).toHaveLength(1);
    // ★ ZZZ 排在棋子**之后**画（类别 0xe > 0xc）
    expect(res.indexOf(SLEEPWALK_MARK_RESOURCE)).toBeGreaterThan(res.indexOf(0x80 + 0x10));
  });

  it('反例：没夢遊 ⇒ 平时那套 0x80、没有 ZZZ', async () => {
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    await drawSettled(renderer, onlyJohn({}), images);
    const res = images.map((i) => i.bitmap.res);
    expect(res).toContain(0x80);
    expect(res).not.toContain(SLEEPWALK_MARK_RESOURCE);
    expect(res).not.toContain(0x80 + 0x10);
  });

  it('反例：冬眠（+0x36）不换睡衣、不贴 ZZZ（冬眠是变灰那一条）', async () => {
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    await drawSettled(renderer, onlyJohn({ sleeping: 3 }), images);
    const res = images.map((i) => i.bitmap.res);
    expect(res).not.toContain(SLEEPWALK_MARK_RESOURCE);
    expect(res).not.toContain(0x80 + 0x10);
  });

  it('★ 夢遊着走子：ZZZ 一 tick 进一帧（`0x0040c465 inc`），站着不动就停在那一帧', async () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { ctx, images } = recordingCtx();
    const renderer = new BoardRenderer(ctx, fakeCache());
    const state = { ...onlyJohn({ sleepWalking: 3 }, 0), phase: 'moving' as const };
    const input = { map: map2(), state, camera: CAM, hoverNode: null, viewport: { w: 440, h: 440 }, tickMs: 20 };
    const zzzFrame = (): number | undefined =>
      images.filter((i) => i.bitmap.res === SLEEPWALK_MARK_RESOURCE).map((i) => i.bitmap.idx)[0];

    // 站着：ZZZ 停在第 0 帧
    for (let i = 0; i < 2; i++) {
      renderer.draw(input);
      await new Promise((r) => setTimeout(r, 0));
    }
    images.length = 0;
    renderer.draw(input);
    expect(zzzFrame()).toBe(0);

    // 起步：第一拍（k = 1）⇒ ZZZ 进到第 1 帧
    renderer.startWalk(0, { x: 32, y: 32 }, { x: 96, y: 32 }, 0, false, 20, clock);
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));
    images.length = 0;
    renderer.draw(input);
    expect(zzzFrame()).toBe(1);
    // 再走两拍 ⇒ 第 3 帧
    clock += 40;
    images.length = 0;
    renderer.draw(input);
    await new Promise((r) => setTimeout(r, 0));
    images.length = 0;
    renderer.draw(input);
    expect(zzzFrame()).toBe(3);
  });
});
