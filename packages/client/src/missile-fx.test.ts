/*
 * 飛彈（7）/ 核彈（13）的爆炸影片 —— 单测
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事，判据全部回 exe（VA 见 `missile-fx.ts` 的文件头）：
 *   ① **规格**：0x210 = 19 帧 / 0x212 = 26 帧 / 都是 440×440 / 114 ms
 *      —— 逐字节读 `Data.mkf` 的资源头（`parseFlicInfo`），并**回 exe 钉住调用点那几条
 *      `push` 的字节**；
 *   ② **落点**：屏幕 (0, 0x28) = 棋盘左上角 —— **不是**逐格坐标（与 `devil-fx` 的
 *      110×110 那一段不同类）；
 *   ③ **判据**：道具号 7 / 13，别的一律 `null`；
 *   ④ `main.ts` 的接线：`startMissileFx` 必须排在 `startConfineFx` **之前**
 *      （原版：爆炸片在前、`damage_area` 里各次 `send_to_hospital` 的 0x20c 在后），
 *      且**不**吃 `options.animation`。
 *
 * ★ 可证伪性：把资源号改成 0x20e、帧数改成 18/25、音效改成 0x51/0x53 互换、
 *   落点改成逐格、把接线挪到 `startConfineFx` 之后 —— 都会当场红。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';

import { boardFilmSkippable, boardFilmTotalMs } from './board-film.ts';
import {
  MISSILE_EXPLOSION_FILM,
  MISSILE_FRAME_MS,
  MISSILE_FRAMES,
  MISSILE_FX_ARCHIVE,
  MISSILE_FX_FLAGS,
  MISSILE_FX_H,
  MISSILE_FX_RESOURCE,
  MISSILE_FX_SOUND,
  MISSILE_FX_W,
  MISSILE_FX_X,
  MISSILE_FX_Y,
  MISSILE_TOOL_ID,
  NUKE_EXPLOSION_FILM,
  NUKE_FRAMES,
  NUKE_FX_FLAGS,
  NUKE_FX_RESOURCE,
  NUKE_FX_SOUND,
  NUKE_TOOL_ID,
  missileFilmFor,
  missileTotalMs,
} from './missile-fx.ts';

const ROOT = process.env.RICH4_WORKSPACE ?? '';
const DATA_MKF = `${ROOT}/Rich4/Data.mkf`;
const EXE = `${ROOT}/Rich4/rich4.exe`;
const hasData = existsSync(DATA_MKF);
const hasExe = existsSync(EXE);
const runData = hasData ? it : it.skip;
const runExe = hasExe ? it : it.skip;

/** `rich4.exe` 的 VA → 文件偏移（与 `tools/disasm.py` 的换算同一条）*/
const CODE_VA = 0x401000;
const CODE_OFF = 1024;
function exeBytes(va: number, n: number): Buffer {
  const d = readFileSync(EXE);
  return d.subarray(CODE_OFF + (va - CODE_VA), CODE_OFF + (va - CODE_VA) + n);
}

describe('★ 影片规格 @source 资源头 + 调用点字节', () => {
  it('两段都在 Data.mkf；资源号 0x210（飛彈）/ 0x212（核彈）', () => {
    expect(MISSILE_FX_ARCHIVE).toBe('Data.mkf');
    expect(MISSILE_FX_RESOURCE).toBe(0x210);
    expect(NUKE_FX_RESOURCE).toBe(0x212);
    expect(MISSILE_EXPLOSION_FILM.resource).toBe(0x210);
    expect(NUKE_EXPLOSION_FILM.resource).toBe(0x212);
    // 反证：别与相邻的几段混了（0x20e 惡魔拆屋 / 0x20b 滿級烟花 / 0x213 飛碟 / 0x214 狗咬）
    for (const other of [0x20b, 0x20e, 0x213, 0x214]) {
      expect(MISSILE_FX_RESOURCE).not.toBe(other);
      expect(NUKE_FX_RESOURCE).not.toBe(other);
    }
  });

  runExe('★ 回 exe 钉：飛彈那一支的立即数（资源/音效/flags/两个落点）', () => {
    // @source VA 0x00447043 / 0x00447082 / 0x00447084 / 0x00447089 / 0x0044708b
    const res = exeBytes(0x447043, 5);
    expect(res.readUInt8(0)).toBe(0x68); // push imm32
    expect(res.readUInt32LE(1)).toBe(0x210);
    const snd = exeBytes(0x447082, 2);
    expect([...snd]).toEqual([0x6a, 0x51]); // push 0x51（音效 81）
    const flags = exeBytes(0x447084, 5);
    expect(flags.readUInt8(0)).toBe(0x68);
    expect(flags.readUInt32LE(1)).toBe(0x90001);
    // 落点：`push 0x28`（y=40）+ `push 0`（x=0）—— 与住院/入獄/神明同一个落点
    expect([...exeBytes(0x447089, 2)]).toEqual([0x6a, 0x28]);
    expect([...exeBytes(0x44708b, 2)]).toEqual([0x6a, 0x00]);
  });

  runExe('★ 回 exe 钉：核彈那一支的立即数（资源/音效/flags/两个落点）', () => {
    // @source VA 0x00447b55 / 0x00447b94 / 0x00447b96 / 0x00447b9b / 0x00447b9d
    const res = exeBytes(0x447b55, 5);
    expect(res.readUInt8(0)).toBe(0x68);
    expect(res.readUInt32LE(1)).toBe(0x212);
    const snd = exeBytes(0x447b94, 2);
    expect([...snd]).toEqual([0x6a, 0x53]); // push 0x53（音效 83）
    const flags = exeBytes(0x447b96, 5);
    expect(flags.readUInt8(0)).toBe(0x68);
    expect(flags.readUInt32LE(1)).toBe(0x80090001);
    expect([...exeBytes(0x447b9b, 2)]).toEqual([0x6a, 0x28]);
    expect([...exeBytes(0x447b9d, 2)]).toEqual([0x6a, 0x00]);
  });

  runData('★ 帧数 / 尺寸 / 每帧毫秒与 Data.mkf 的头逐字节一致（不许写死）', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (const spec of [MISSILE_EXPLOSION_FILM, NUKE_EXPLOSION_FILM]) {
      const info = parseFlicInfo(a.read(spec.resource));
      expect(info, `资源 ${spec.resource.toString(16)} 解不出 FLIC 头`).not.toBeNull();
      expect(info!.frames, `资源 ${spec.resource.toString(16)} 帧数`).toBe(spec.frames);
      expect(info!.width).toBe(spec.width);
      expect(info!.height).toBe(spec.height);
      expect(info!.frameMs).toBe(spec.frameMs);
    }
  });

  it('★ 帧数与总时长：飛彈 19×114 = 2166 ms、核彈 26×114 = 2964 ms', () => {
    expect(MISSILE_FRAMES).toBe(19);
    expect(NUKE_FRAMES).toBe(26);
    expect(MISSILE_FRAME_MS).toBe(114);
    expect(boardFilmTotalMs(MISSILE_EXPLOSION_FILM)).toBe(2166);
    expect(boardFilmTotalMs(NUKE_EXPLOSION_FILM)).toBe(2964);
    expect(missileTotalMs(MISSILE_TOOL_ID)).toBe(2166);
    expect(missileTotalMs(NUKE_TOOL_ID)).toBe(2964);
  });

  it('★ 落点 = 屏幕 (0, 0x28)（整幅盖住棋盘）—— **不是**逐格坐标', () => {
    expect([MISSILE_FX_X, MISSILE_FX_Y]).toEqual([0, 0x28]);
    expect([MISSILE_EXPLOSION_FILM.x, MISSILE_EXPLOSION_FILM.y]).toEqual([0, 0x28]);
    expect([NUKE_EXPLOSION_FILM.x, NUKE_EXPLOSION_FILM.y]).toEqual([0, 0x28]);
    expect([MISSILE_FX_W, MISSILE_FX_H]).toEqual([440, 440]);
    // 反证：惡魔拆屋那段是 110×110 逐格居中（0x37 = 半个宽）—— 这两段不是
    expect(MISSILE_EXPLOSION_FILM.width).not.toBe(110);
  });

  it('★ 音效：飛彈 81（0x51）、核彈 83（0x53）—— 不是 85/93/95/90/91', () => {
    expect(MISSILE_FX_SOUND).toBe(0x51);
    expect(NUKE_FX_SOUND).toBe(0x53);
    expect(MISSILE_EXPLOSION_FILM.sound).toBe(81);
    expect(NUKE_EXPLOSION_FILM.sound).toBe(83);
    for (const other of [85, 93, 95, 90, 91]) {
      expect(MISSILE_EXPLOSION_FILM.sound).not.toBe(other);
      expect(NUKE_EXPLOSION_FILM.sound).not.toBe(other);
    }
  });

  it('★ flags 的 bit1 = 0 ⇒ 这 2.2 / 3.0 秒**点不掉**', () => {
    expect(MISSILE_FX_FLAGS & 2).toBe(0);
    expect(NUKE_FX_FLAGS & 2).toBe(0);
    expect(boardFilmSkippable(MISSILE_EXPLOSION_FILM)).toBe(false);
    expect(boardFilmSkippable(NUKE_EXPLOSION_FILM)).toBe(false);
  });
});

describe('★ 什么时候播 —— 判据是**道具号**', () => {
  it('★ 7（飛彈）⇒ 0x210；13（核彈）⇒ 0x212', () => {
    expect(missileFilmFor(MISSILE_TOOL_ID)?.resource).toBe(0x210);
    expect(missileFilmFor(NUKE_TOOL_ID)?.resource).toBe(0x212);
  });

  it('★ 可证伪：别的道具号一律 `null`（不许「随便播一段」）', () => {
    for (const id of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 0, -1]) {
      expect(missileFilmFor(id), `道具 ${id}`).toBeNull();
      expect(missileTotalMs(id), `道具 ${id}`).toBeNull();
    }
  });

  it('★ 两段影片的 `id` 不同（同一 action 里不会互相顶掉判据）', () => {
    expect(MISSILE_EXPLOSION_FILM.id).not.toBe(NUKE_EXPLOSION_FILM.id);
    expect(MISSILE_EXPLOSION_FILM.id).toContain('210');
    expect(NUKE_EXPLOSION_FILM.id).toContain('212');
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★★ `startMissileFx` 必须排在 `startConfineFx` **之前**', () => {
    // @source 原版次序：`view_to(爆心)` → `damage_area`（内部各次 `send_to_hospital`
    //   播 0x20c）→ 最后才播自己那一段（0x210 / 0x212）。
    //   两条调用对调 ⇒ 医院片先播、爆炸片被顶掉 ⇒ 红。
    const missile = src.indexOf('startMissileFx(action, before);');
    const confine = src.indexOf('startConfineFx(before, state);');
    expect(missile).toBeGreaterThan(-1);
    expect(confine).toBeGreaterThan(-1);
    expect(missile).toBeLessThan(confine);
  });

  it('★ 判据走 `missileFilmFor(action.toolId)`，不是自己比道具号', () => {
    const at = src.indexOf('function startMissileFx(');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1200);
    expect(body).toContain("if (action.type !== 'useTool') return;");
    expect(body).toContain('missileFilmFor(action.toolId)');
    expect(body).toContain('startBoardFilm(spec);');
    // 不许在宿主里再抄一遍道具号字面量（判据只有 `missile-fx.ts` 一处）
    expect(body).not.toContain('=== 7');
    expect(body).not.toContain('=== 13');
  });

  it('★ 这一段**不**吃 `options.animation`（原版那两支里没有 `cmp [0x497159], 0`）', () => {
    const at = src.indexOf('function startMissileFx(');
    const body = src.slice(at, at + 1200);
    expect(body).not.toContain('options.animation');
  });
});
