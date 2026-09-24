/*
 * 降落伞落地那一段影片 —— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事（判据见 `landing-fx.ts` 的文件头）：
 *   ① **规格**：十二段 = `Data.mkf` 0x22f + 角色，帧数 / 440×440 / 42 ms 逐字节对资源头；
 *      调用点那几条 `push` / `add eax, 0x22f` 回 exe 钉住；
 *   ② **判据**：换人那条 action 里 before 没上盘、after 上了盘的那一位；开局那一刻补第 1 位；
 *   ③ **影片期间不画他**：只清坐标（棋子 / 小地图都认 `xpos == 0`），别的不动；
 *   ④ `main.ts` 的接线（原始码钉）：换人那条 action 起播、进棋盘那一刻补第 1 位、小地图同样藏、
 *      不吃「動畫過程」开关、不放音效。
 *
 * ★ 可证伪性：资源基数改 0x22e、帧数表错一格、flags / 落点改动、判据改成「after 上了盘」
 *   （不看 before）、藏人时顺手清了 whoPlays —— 都会当场红。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import { landAll, newGame, parseMap, reduce, WHO_PLAYS_COMPUTER, type GameState } from '@rich4/core';

import { boardFilmSkippable, boardFilmTotalMs } from './board-film.ts';
import {
  LANDING_FX_BASE,
  LANDING_FX_FLAGS,
  LANDING_FX_FRAMES,
  LANDING_FX_FRAME_MS,
  LANDING_FX_SOUND,
  LANDING_FX_X,
  LANDING_FX_Y,
  hideLandingPlayer,
  landingFilmSpec,
  landingTrigger,
  openingLandingPlayer,
} from './landing-fx.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const DATA_MKF = `${ROOT}/Rich4/Data.mkf`;
const EXE = `${ROOT}/Rich4/rich4.exe`;
const MAP = `${ROOT}/extracted/map/0001.bin`;
const runData = existsSync(DATA_MKF) ? it : it.skip;
const runExe = existsSync(EXE) ? it : it.skip;
const runMap = existsSync(MAP) ? it : it.skip;

/** `rich4.exe` 的 VA → 文件偏移（与 `tools/disasm.py` 的换算同一条）*/
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = va - 0x401000 + 1024;
  return [...d.subarray(off, off + n)];
}

const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const computers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ character: (i * 7) % 12, kind: 'computer' as const }));

describe('① 规格', () => {
  runData('★ 十二段的帧数 / 尺寸 / 每帧毫秒与 Data.mkf 的头逐字节一致', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (let ch = 0; ch < 12; ch++) {
      const spec = landingFilmSpec(ch);
      expect(spec.resource).toBe(0x22f + ch);
      const info = parseFlicInfo(a.read(spec.resource));
      expect(info, `资源 0x${spec.resource.toString(16)}`).not.toBeNull();
      expect(info!.frames, `角色 ${ch} 帧数`).toBe(spec.frames);
      expect(info!.width).toBe(440);
      expect(info!.height).toBe(440);
      expect(info!.frameMs).toBe(LANDING_FX_FRAME_MS);
    }
    // 下一格（0x23b）已不是 FLIC —— 十二段正好到头
    expect(parseFlicInfo(a.read(0x23b))).toBeNull();
  });

  runExe('★ 调用点字节：`add eax, 0x22f` 与 `push -1 / push 1 / push 0x28 / push 0 / push eax / call 0x45144f`', () => {
    // 00418c89  05 2f 02 00 00      add eax, 0x22f
    expect(exeBytes(0x418c89, 5)).toEqual([0x05, 0x2f, 0x02, 0x00, 0x00]);
    // 00418ca0  6a ff 6a 01 6a 28 6a 00 50 e8 …
    expect(exeBytes(0x418ca0, 10)).toEqual([0x6a, 0xff, 0x6a, 0x01, 0x6a, 0x28, 0x6a, 0x00, 0x50, 0xe8]);
    const rel = Buffer.from(exeBytes(0x418caa, 4)).readInt32LE(0);
    expect(0x418cae + rel).toBe(0x45144f);
    expect(LANDING_FX_BASE).toBe(0x22f);
    expect([LANDING_FX_X, LANDING_FX_Y, LANDING_FX_FLAGS, LANDING_FX_SOUND]).toEqual([0, 0x28, 1, -1]);
  });

  it('点不掉、不放音效；总长 = 帧数 × 42 ms', () => {
    for (let ch = 0; ch < 12; ch++) {
      const spec = landingFilmSpec(ch);
      expect(boardFilmSkippable(spec)).toBe(false);
      expect(spec.sound).toBe(-1);
      expect(boardFilmTotalMs(spec)).toBe((LANDING_FX_FRAMES[ch] ?? 0) * 42);
    }
    expect(LANDING_FX_FRAMES).toHaveLength(12);
  });
});

describe('② 判据', () => {
  runMap('换人那条 action：before 没上盘、after 上了盘的那一位（落在他自己的第一个回合）', () => {
    const map = loadMap();
    const topo = { nodes: map.nodes, lands: map.lands, facilities: map.facilities, commercials: map.commercials, landscapes: map.landscapes };
    const s0 = newGame({ map, players: computers(4), seed: 3 });
    // 把第 1 位的回合收尾：直接从 turnEnd 换人
    const before: GameState = { ...s0, phase: 'turnEnd', pendingNpcSlots: [] };
    const after = reduce(before, { type: 'endTurn' }, topo);
    expect(after.currentPlayer).toBe(1);
    expect(landingTrigger(before, after)).toBe(1);
    expect(after.players[1]!.whoPlays).toBe(WHO_PLAYS_COMPUTER);
    // 同一个局面自己比自己 / 已经都在盘上 ⇒ 没有人刚落地
    expect(landingTrigger(after, after)).toBeNull();
    const all = landAll(s0, map.nodes);
    expect(landingTrigger(all, all)).toBeNull();
    // 只看 after 不看 before 的写法会把「本来就在盘上的第 1 位」也算进来 —— 这里钉住不会
    expect(landingTrigger(s0, after)).toBe(1);
  });

  runMap('开局那一刻补第 1 位；走过一步 / 大家都已在盘上（读档）就不补', () => {
    const map = loadMap();
    const s0 = newGame({ map, players: computers(3), seed: 11 });
    expect(openingLandingPlayer(s0)).toBe(0);
    expect(openingLandingPlayer({ ...s0, turnCount: 1 })).toBeNull();
    expect(openingLandingPlayer(landAll(s0, map.nodes))).toBeNull();
  });
});

describe('③ 影片期间先别画他', () => {
  runMap('只清那一位的坐标（棋子 / 小地图都认 `xpos == 0`），who_plays / 节点 / 钱都不动', () => {
    const map = loadMap();
    const s = landAll(newGame({ map, players: computers(4), seed: 21 }), map.nodes);
    const h = hideLandingPlayer(s, 2);
    expect([h.players[2]!.xpos, h.players[2]!.ypos]).toEqual([0, 0]);
    expect(h.players[2]!.whoPlays).toBe(s.players[2]!.whoPlays);
    expect(h.players[2]!.nodeId).toBe(s.players[2]!.nodeId);
    expect(h.players[2]!.cash).toBe(s.players[2]!.cash);
    for (const i of [0, 1, 3]) expect(h.players[i]).toBe(s.players[i]);
    // 本来就没坐标 ⇒ 原样返回
    const u = newGame({ map, players: computers(4), seed: 21 });
    expect(hideLandingPlayer(u, 1)).toBe(u);
  });
});

describe('④ main.ts 接线（原始码钉）', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const fx = main.slice(main.indexOf('function startActionFx('), main.indexOf('function startActionFx(') + 2500);
  const intro = main.slice(main.indexOf('function endIntro('), main.indexOf('function endIntro(') + 1200);
  const start = main.slice(main.indexOf('function startLandingFx('), main.indexOf('function startLandingFx(') + 800);

  it('换人那条 action ⇒ 起播落地影片（不看「動畫過程」开关）', () => {
    expect(fx).toContain('const landed = landingTrigger(before, state);');
    expect(fx).toContain('if (landed !== null) startLandingFx(landed);');
    expect(start).toContain('queueBoardFilm(spec);');
    expect(start).not.toContain('options.animation');
    expect(start).not.toContain('sound.play');
    // 镜头直接居中到落点，不落小地图标记（摆人那次重画 `0x40829d` 不写 `[0x48be18]`）
    expect(start).toContain('camera = pixelCamera(me.xpos, me.ypos, camera.view);');
    expect(start).not.toContain('minimapMarker');
  });

  it('进棋盘那一刻补第 1 位', () => {
    expect(intro).toContain('const opener = openingLandingPlayer(state);');
    expect(intro).toContain('if (opener !== null) startLandingFx(opener);');
  });

  it('棋盘与小地图在影片期间都不画他', () => {
    expect(main).toContain('return withLandingHidden(boardDrawStateBase());');
    expect(main).toContain('state: withLandingHidden(hudState),');
  });
});
