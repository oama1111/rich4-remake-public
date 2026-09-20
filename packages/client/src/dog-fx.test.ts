/*
 * 「踩到惡犬」那一段影片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事，判据全部回 exe（VA 见 `dog-fx.ts` 的文件头）：
 *   ① **规格**：Data.mkf **0x214** = 38 帧 / 440×440 / 114 ms / 音效 85 / flags 0x10001
 *      —— 逐字节核过资源头，并**回 exe 钉住调用点那几条 push 的字节**；
 *   ② **落点**：屏幕 (0,0)（原版那两个 `push edi` 压的都是 0，**不是** 0x28）；
 *   ③ **什么时候播**：踩到惡犬且**徒步**（`traffic_method == 0`）⇒ 住院计数变大；
 *   ④ **次序**：`main.ts` 里 `startDogFx` 必须排在 `startConfineFx` **之前**
 *      （原版：先 0x214、后 `send_to_hospital` 里的 0x20c）。
 *
 * ★ 可证伪性：下面每一条都写成「改坏实现就变红」的形状 ——
 *   把资源号改成 0x228（有车那一支的 `god-ok.FLC`）、把落点改成 0x28、
 *   把音效改成 0x5c/0x5d、把闸门取反、把 main.ts 里两条调用对调，都会当场红。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';

import { boardFilmSkippable, boardFilmTotalMs } from './board-film.ts';
import {
  DOG_BITE_FILM,
  DOG_FX_ARCHIVE,
  DOG_FX_RESOURCE,
  DOG_FX_X,
  DOG_FX_Y,
  dogBiteFxTrigger,
  dogBiteTotalMs,
  dogBiteSkippable,
} from './dog-fx.ts';
import { LAYOUT } from './stage.ts';

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

/** 一步状态：一位玩家 + 它的两个只读字段 */
function st(over: { trafficMethod?: number; inHospital?: number }): {
  players: { trafficMethod: number; blocking: { inHospital: number } }[];
} {
  return {
    players: [
      { trafficMethod: over.trafficMethod ?? 0, blocking: { inHospital: over.inHospital ?? 0 } },
    ],
  };
}

describe('★ 影片规格 @source 资源头 + 调用点字节', () => {
  it('这一段在 Data.mkf、资源号 0x214（**不是**有车那一支的 0x228）', () => {
    expect(DOG_FX_ARCHIVE).toBe('Data.mkf');
    expect(DOG_FX_RESOURCE).toBe(0x214);
    expect(DOG_BITE_FILM.resource).toBe(0x214);
    expect(DOG_BITE_FILM.id).toBe('dog-bite');
  });

  runExe('★ 回 exe 钉：惡犬那一支的 5 个立即数（资源/音效/flags/x/y）', () => {
    // @source VA 0x0041b866 起：
    //   0041b866  push edi            ; arg2 = x = 0（edi 在 0x41b83d 后恒为 0）
    //   0041b867  push edi            ; arg3 = y = 0
    //   0041b868  push 0x228          ; ← 有车那一支的 read_mkf（本模块不播它）
    //   0041b87d  push 0x55           ; 有车那一支的音效
    //   0041b87f  push 0x10001
    //   0041b8ab  push 0x214          ; ← ★ 本模块播的那一段的 read_mkf
    //   0041b8c1  push 0x5d           ; 救护车的音效（Effect.mkf 93）
    //   0041b8c3  push 0x30001
    //   0041b8c8  push 0x28           ; arg3 = y = 40
    //   0041b8ca  push 0             ; arg2 = x = 0
    //   0041b8de  mov dword [0x48baf8], 0
    //   0041b8e6  push 3             ; send_to_hospital(player, 3)
    const dog = exeBytes(0x41b866, 8);
    expect([...dog.subarray(0, 2)]).toEqual([0x57, 0x57]); // push edi / push edi ⇒ (x,y) = (0,0)
    expect(dog.readUInt8(2)).toBe(0x68); // push imm32
    expect(dog.readUInt32LE(3)).toBe(0x228);
    // 本模块的资源：0x0041b8ab `push 0x214`
    const res = exeBytes(0x41b8ab, 5);
    expect(res.readUInt8(0)).toBe(0x68);
    expect(res.readUInt32LE(1)).toBe(0x214);
    // 有车那一支的音效 = 0x55（**不**属于本模块）
    const biteSound = exeBytes(0x41b87d, 2);
    expect([...biteSound]).toEqual([0x6a, 0x55]);
    // 救护车那一支的四个参数
    const amb = exeBytes(0x41b8c1, 12);
    expect([...amb.subarray(0, 2)]).toEqual([0x6a, 0x5d]); // push 0x5d（音效 93）
    expect(amb.readUInt8(2)).toBe(0x68);
    expect(amb.readUInt32LE(3)).toBe(0x30001); // flags
    expect([...amb.subarray(7, 9)]).toEqual([0x6a, 0x28]); // y = 40
    expect([...amb.subarray(9, 11)]).toEqual([0x6a, 0x00]); // x = 0
    // 住院天数 3 + 剩余步数清零
    //   0041b8de  xor edi, edi / mov dword [0x48baf8], edi
    expect([...exeBytes(0x41b8de, 8)]).toEqual([0x31, 0xff, 0x89, 0x3d, 0xf8, 0xba, 0x48, 0x00]);
    const push3 = exeBytes(0x41b8e6, 2);
    expect([...push3]).toEqual([0x6a, 0x03]);
    // 「動畫過程」闸门 `[0x497159]` **不在**这一支里：整段 0x41b837..0x41b8f9 搜不到
    const dogBranch = exeBytes(0x41b837, 0x41b8f9 - 0x41b837);
    expect(dogBranch.includes(Buffer.from([0x80, 0x3d, 0x59, 0x71, 0x49, 0x00, 0x00]))).toBe(false);
  });

  it('★ 落点 = 屏幕 (0,0)；转成棋盘局部就是 0 − LAYOUT.board.y', () => {
    expect(DOG_FX_X).toBe(0);
    expect(DOG_FX_Y).toBe(0);
    expect(DOG_BITE_FILM.x).toBe(0);
    expect(DOG_BITE_FILM.y).toBe(0);
    // 与其它棋盘影片同尺寸
    expect(DOG_BITE_FILM.width).toBe(440);
    expect(DOG_BITE_FILM.height).toBe(440);
    expect(DOG_BITE_FILM.y - LAYOUT.board.y).toBe(-40);
  });

  it('★ 音效 85（0x55）；够不到那一支的 93 与救护车的 92 都不是它', () => {
    expect(DOG_BITE_FILM.sound).toBe(0x55);
    expect(DOG_BITE_FILM.sound).toBe(85);
    expect(DOG_BITE_FILM.sound).not.toBe(0x5c);
    expect(DOG_BITE_FILM.sound).not.toBe(0x5d);
  });

  it('★ flags 0x10001 ⇒ bit1 = 0 ⇒ 原版这 4.332 秒**点不掉**', () => {
    expect(DOG_BITE_FILM.flags).toBe(0x10001);
    expect(dogBiteSkippable()).toBe(false);
    expect(boardFilmSkippable(DOG_BITE_FILM)).toBe(false);
  });

  it('★ 总时长 = 38 × 114 = 4332 ms（不循环）', () => {
    expect(DOG_BITE_FILM.frames).toBe(38);
    expect(DOG_BITE_FILM.frameMs).toBe(114);
    expect(dogBiteTotalMs()).toBe(4332);
    expect(boardFilmTotalMs(DOG_BITE_FILM)).toBe(4332);
  });

  runData('★ 帧数/尺寸/每帧毫秒与 Data.mkf 0x214 头逐字节一致', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    const info = parseFlicInfo(a.read(DOG_BITE_FILM.resource));
    expect(info, '资源 0x214 应当是标准 FLIC').not.toBeNull();
    expect(info!.frames).toBe(DOG_BITE_FILM.frames);
    expect(info!.width).toBe(DOG_BITE_FILM.width);
    expect(info!.height).toBe(DOG_BITE_FILM.height);
    expect(info!.frameMs).toBe(DOG_BITE_FILM.frameMs);
  });

  runData('★ 嵌入源路径 = D:\\RICH4\\FLCS\\DOG.FLC —— 与有车那一支的 god-ok.FLC 不同', () => {
    const raw = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x214, 'none');
    const latin = new TextDecoder('latin1');
    const src =
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(raw.subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(src.toUpperCase()).toBe('D:\\RICH4\\FLCS\\DOG.FLC');
    // 反证：0x228 是神明歸位那一段，**不是**狗咬
    const other = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x228, 'none');
    const otherSrc =
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(other.subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(otherSrc.toUpperCase()).toBe('D:\\GOD-OK.FLC');
  });
});

describe('★ 什么时候播 —— 只有「徒步踩到惡犬」那一支', () => {
  it('徒步 + 住院计数 0→3 ⇒ 播', () => {
    const spec = dogBiteFxTrigger(st({ trafficMethod: 0, inHospital: 0 }), st({ trafficMethod: 0, inHospital: 3 }));
    expect(spec).toBe(DOG_BITE_FILM);
  });

  it('★★ 徒步、本来就住着院（3→6，加刑）⇒ 照样播（原版每次 `send_to_hospital` 都重播）', () => {
    const spec = dogBiteFxTrigger(st({ trafficMethod: 0, inHospital: 3 }), st({ trafficMethod: 0, inHospital: 6 }));
    expect(spec).toBe(DOG_BITE_FILM);
  });

  it('★★ 有车（`traffic_method != 0`）⇒ **不播**（原版那一支走 0x228 且不住院）', () => {
    // @source VA 0x0041b85d `cmp byte [player + 0x496b79], 0` / `je 0x41b89e`
    //   —— 0x214 只在「等于 0」那一支里；本引擎 core 对 `trafficMethod != 0`
    //   返回 `hospitalDays = 0`，所以这里两个理由都指向不播。
    expect(
      dogBiteFxTrigger(st({ trafficMethod: 2, inHospital: 0 }), st({ trafficMethod: 0, inHospital: 3 })),
    ).toBeNull();
    expect(
      dogBiteFxTrigger(st({ trafficMethod: 1, inHospital: 0 }), st({ trafficMethod: 1, inHospital: 0 })),
    ).toBeNull();
  });

  it('★ 徒步但住院计数**没变大** ⇒ 不播（不是踩到狗的那一拍）', () => {
    expect(dogBiteFxTrigger(st({ inHospital: 0 }), st({ inHospital: 0 }))).toBeNull();
    expect(dogBiteFxTrigger(st({ inHospital: 3 }), st({ inHospital: 3 }))).toBeNull();
  });

  it('★ 「刑满待释放」那一步（1 → 0x80）**不算**住院变大 —— 不许误播狗咬', () => {
    // 0x80 的高位是「待释放」状态位（@source 0x41c8ea `or ch, 0x80`），掩掉它之后
    // 0x80 & 0x7f = 0 < 1 ⇒ 不播。与 `confine-fx.test.ts` 那条救护车用例同一口径。
    expect(dogBiteFxTrigger(st({ inHospital: 1 }), st({ inHospital: 0x80 }))).toBeNull();
  });

  it('★ 遍历到**任意一位**玩家都能认出来', () => {
    for (let i = 0; i < 4; i++) {
      const players = Array.from({ length: 4 }, () => ({
        trafficMethod: 0,
        blocking: { inHospital: 0 },
      }));
      const after = players.map((p, j) => (j === i ? { ...p, blocking: { inHospital: 3 } } : p));
      expect(
        dogBiteFxTrigger({ players }, { players: after }),
        `slot ${i}`,
      ).toBe(DOG_BITE_FILM);
    }
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★★ `startDogFx` 必须排在 `startConfineFx` **之前**（原版：先 0x214、后 0x20c）', () => {
    // @source VA 0x0041b837 那一支：`read_mkf(0x214)` → `fcn_0045144f` →
    //   `wreck_vehicle` → `send_to_hospital`（内部才 `read_mkf(0x20c)`）。
    //   把两条调用对调 ⇒ 救护车会顶掉狗咬（`startBoardFilm` 只保留一个待播）⇒ 红。
    const dog = src.indexOf('startDogFx(before, state);');
    const confine = src.indexOf('startConfineFx(before, state);');
    expect(dog).toBeGreaterThan(-1);
    expect(confine).toBeGreaterThan(-1);
    expect(dog).toBeLessThan(confine);
  });

  it('★ 狗咬那一段用**同一份**棋盘影片宿主（自动进 `holdForActorWalk` 那道闸）', () => {
    expect(src).toContain('function startDogFx(before: GameState, after: GameState): void {');
    expect(src).toContain('startBoardFilm(spec);');
    // ① 排队：狗咬播完接救护车（`startBoardFilm` 的第二个参数）
    expect(src).toContain('let pendingBoardFilmAfter: BoardFilmSpec | null = null;');
    // ② 闸：两段之间那一拍也要挡住回合驱动（W-51 起这一位收在 `stageBusyFlags()`，
    //    与 `holdForActorWalk` / 台词闸共用同一个纯函数）
    expect(src).toContain('pendingBoardFilmAfter: pendingBoardFilmAfter !== null,');
    expect(src).toContain('if (stageBusy(stageBusyFlags())) {');
    // ③ 只有两段都播完才放行
    expect(src).toContain('if (pendingBoardFilmAfter === null) resumeTurnDriver();');
  });

  it('★ 这一段**不**吃 `options.animation`（原版那一支没有 `cmp [0x497159], 0`）', () => {
    const at = src.indexOf('function startDogFx(before: GameState, after: GameState): void {');
    expect(at).toBeGreaterThan(-1);
    // 只看这个函数体那几十行（下一个函数（`startAlienNewsFx`）的注释里也写着
    //  `options.animation`，所以不能拿「到下一个 function」当边界）
    const body = src.slice(at, at + 320);
    expect(body).not.toContain('options.animation');
  });
});
