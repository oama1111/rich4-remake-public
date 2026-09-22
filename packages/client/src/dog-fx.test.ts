/*
 * 「踩到惡犬」那两段影片 + 地雷／炸彈的爆炸片 —— 全部照 exe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉五件事，判据全部回 exe（VA 见 `dog-fx.ts` 的文件头）：
 *   ① **规格**：Data.mkf **0x214** = 38 帧 / 440×440 / 114 ms / **音效 93（0x5d）/ flags 0x30001**
 *      —— 逐字节核过资源头，并**回 exe 钉住调用点那几条 push 的字节**；
 *   ② **落点**：屏幕 (0, 40)，与其它棋盘影片一样贴着棋盘；
 *   ③ **什么时候播哪一段**：惡犬被踩掉 + 徒步者住院 ⇒ 0x214；惡犬被踩掉 + 没人住院 ⇒ 0x228；
 *      地雷被踩掉 / 炸彈炸了 + 住院 ⇒ 0x20d。**只**看住院计数变大会把踩地雷也播成狗咬 —— 这是订正前的 bug；
 *   ④ **乞丐造型**：`wreckedThisAction` 只认惡犬 / 地雷 / 炸彈那三条（`0x40cd07` 的调用点），卡片 / 新聞送醫院不算；
 *   ⑤ **次序**：`main.ts` 里 `startDogFx` 必须排在 `startConfineFx` **之前**（原版：先 0x214、后 0x20c）。
 *
 * ⚠️ 2026-09-22 订正：先前这里钉的是「音效 85 / flags 0x10001 / 落点 (0,0)」—— 那是有车那一支 0x228 的参数
 *   （`push edi / push edi` 是 `read_mkf` 的两个 0），错套到了 0x214 上；救护车的参数根本不在这一支里。
 *   佐证：`Effect.mkf` 93 长 4.4 s ≈ 38×114 ms；85 长 1.67 s ≈ 0x228 的 18×71 ms。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import { OBJECT_TYPE_BOMB, OBJECT_TYPE_DOG, OBJECT_TYPE_MINE } from '@rich4/core';

import { boardFilmSkippable, boardFilmTotalMs } from './board-film.ts';
import {
  DOG_BITE_FILM,
  DOG_FX_ARCHIVE,
  DOG_FX_RESOURCE,
  DOG_FX_X,
  DOG_FX_Y,
  DOG_SCARED_FILM,
  EXPLOSION_FILM,
  dogBiteFxTrigger,
  dogBiteTotalMs,
  dogBiteSkippable,
  wreckedThisAction,
  type WreckSnapshot,
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

/** 一拍状态：四位玩家 + 一个物件槽（默认空）*/
function st(over: {
  trafficMethod?: number;
  inHospital?: number;
  f64?: number;
  who?: number;
  object?: { type: number; nodeId: number; attached?: number };
}): WreckSnapshot {
  const who = over.who ?? 0;
  return {
    players: Array.from({ length: 4 }, (_, i) => ({
      trafficMethod: i === who ? (over.trafficMethod ?? 0) : 0,
      f64: i === who ? (over.f64 ?? 0) : 0,
      blocking: { inHospital: i === who ? (over.inHospital ?? 0) : 0 },
    })),
    objects: [over.object ? { type: over.object.type, nodeId: over.object.nodeId, attached: over.object.attached ?? 0 } : { type: OBJECT_TYPE_DOG, nodeId: 0, attached: 0 }],
  };
}

describe('★ 影片规格 @source 资源头 + 调用点字节', () => {
  it('狗咬在 Data.mkf、资源号 0x214（有车那一支是 0x228、爆炸是 0x20d）', () => {
    expect(DOG_FX_ARCHIVE).toBe('Data.mkf');
    expect(DOG_FX_RESOURCE).toBe(0x214);
    expect(DOG_BITE_FILM.resource).toBe(0x214);
    expect(DOG_BITE_FILM.id).toBe('dog-bite');
    expect(DOG_SCARED_FILM.resource).toBe(0x228);
    expect(EXPLOSION_FILM.resource).toBe(0x20d);
  });

  runExe('★ 回 exe 钉：惡犬那一支两段影片各自的立即数（资源/音效/flags/x/y）', () => {
    // 有车那一支：
    //   0041b866  push edi / push edi / push 0x228   ; read_mkf(Data.mkf, 0x228, 0, 0)
    //   0041b87d  push 0x55 / push 0x10001 / push 0x28 / push edi
    const scared = exeBytes(0x41b866, 8);
    expect([...scared.subarray(0, 2)]).toEqual([0x57, 0x57]);
    expect(scared.readUInt8(2)).toBe(0x68);
    expect(scared.readUInt32LE(3)).toBe(0x228);
    const scaredArgs = exeBytes(0x41b87d, 12);
    expect([...scaredArgs.subarray(0, 2)]).toEqual([0x6a, 0x55]); // 音效 85
    expect(scaredArgs.readUInt8(2)).toBe(0x68);
    expect(scaredArgs.readUInt32LE(3)).toBe(0x10001); // flags
    expect([...scaredArgs.subarray(7, 9)]).toEqual([0x6a, 0x28]); // y = 40
    expect(scaredArgs.readUInt8(9)).toBe(0x57); // push edi（x = 0）
    expect(DOG_SCARED_FILM.sound).toBe(0x55);
    expect(DOG_SCARED_FILM.flags).toBe(0x10001);
    expect(DOG_SCARED_FILM.y).toBe(0x28);

    // 徒步那一支：
    //   0041b8ab  push 0x214                         ; read_mkf
    //   0041b8c1  push 0x5d / push 0x30001 / push 0x28 / push 0
    const res = exeBytes(0x41b8ab, 5);
    expect(res.readUInt8(0)).toBe(0x68);
    expect(res.readUInt32LE(1)).toBe(0x214);
    const bite = exeBytes(0x41b8c1, 12);
    expect([...bite.subarray(0, 2)]).toEqual([0x6a, 0x5d]); // ★ 音效 93
    expect(bite.readUInt8(2)).toBe(0x68);
    expect(bite.readUInt32LE(3)).toBe(0x30001); // ★ flags
    expect([...bite.subarray(7, 9)]).toEqual([0x6a, 0x28]); // ★ y = 40
    expect([...bite.subarray(9, 11)]).toEqual([0x6a, 0x00]); // x = 0
    expect(DOG_BITE_FILM.sound).toBe(0x5d);
    expect(DOG_BITE_FILM.flags).toBe(0x30001);

    // 毁车在影片之前、住院在影片之后：
    //   0041b89e  push ebp / call 0x40cd07
    //   0041b8de  xor edi, edi / mov dword [0x48baf8], edi
    //   0041b8e6  push 3 → send_to_hospital(player, 3)
    expect([...exeBytes(0x41b89e, 2)]).toEqual([0x55, 0xe8]);
    expect([...exeBytes(0x41b8de, 8)]).toEqual([0x31, 0xff, 0x89, 0x3d, 0xf8, 0xba, 0x48, 0x00]);
    expect([...exeBytes(0x41b8e6, 2)]).toEqual([0x6a, 0x03]);
    // 「動畫過程」闸门 `[0x497159]` **不在**这一支里
    const dogBranch = exeBytes(0x41b837, 0x41b8f9 - 0x41b837);
    expect(dogBranch.includes(Buffer.from([0x80, 0x3d, 0x59, 0x71, 0x49, 0x00, 0x00]))).toBe(false);
  });

  runExe('★ 回 exe 钉：地雷那一支的爆炸片参数 + `0x40cd07` 末尾 `or who_plays, 0x40`', () => {
    //   0041beac  push 0x20d
    //   0041bec2  push 0x52 / push 0x30001 / push 0x28 / push 0
    const res = exeBytes(0x41beac, 5);
    expect(res.readUInt8(0)).toBe(0x68);
    expect(res.readUInt32LE(1)).toBe(0x20d);
    const args = exeBytes(0x41bec2, 11);
    expect([...args.subarray(0, 2)]).toEqual([0x6a, 0x52]);
    expect(args.readUInt32LE(3)).toBe(0x30001);
    expect([...args.subarray(7, 9)]).toEqual([0x6a, 0x28]);
    expect(EXPLOSION_FILM.sound).toBe(0x52);
    expect(EXPLOSION_FILM.flags).toBe(0x30001);
    //   0040cd5e  or byte [eax + 0x496b7d], 0x40  → 80 88 7d 6b 49 00 40
    expect([...exeBytes(0x40cd5e, 7)]).toEqual([0x80, 0x88, 0x7d, 0x6b, 0x49, 0x00, 0x40]);
    //   0043ecad  and byte [ebx + 0x496b7d], 0xf   → 80 a3 7d 6b 49 00 0f
    expect([...exeBytes(0x43ecad, 7)]).toEqual([0x80, 0xa3, 0x7d, 0x6b, 0x49, 0x00, 0x0f]);
    //   0040b9b7  add edi, 0x12 → 83 c7 12
    expect([...exeBytes(0x40b9b7, 3)]).toEqual([0x83, 0xc7, 0x12]);
  });

  it('★ 落点 = 屏幕 (0, 40)；转成棋盘局部就是 0', () => {
    expect(DOG_FX_X).toBe(0);
    expect(DOG_FX_Y).toBe(0x28);
    expect(DOG_BITE_FILM.x).toBe(0);
    expect(DOG_BITE_FILM.y).toBe(0x28);
    expect(DOG_BITE_FILM.width).toBe(440);
    expect(DOG_BITE_FILM.height).toBe(440);
    expect(DOG_BITE_FILM.y - LAYOUT.board.y).toBe(0);
    expect(EXPLOSION_FILM.y).toBe(0x28);
  });

  it('★ 音效 93（0x5d）—— 4.4 s 的那条，不是有车那一支的 85、也不是救护车的 92', () => {
    expect(DOG_BITE_FILM.sound).toBe(0x5d);
    expect(DOG_BITE_FILM.sound).not.toBe(0x55);
    expect(DOG_BITE_FILM.sound).not.toBe(0x5c);
  });

  it('★ flags 0x30001 ⇒ bit1（值 2）= 0 ⇒ 这 4.332 秒**点不掉**（与惡魔拆房 0x20e 同一组 flags）', () => {
    expect(DOG_BITE_FILM.flags).toBe(0x30001);
    expect(dogBiteSkippable()).toBe(false);
    expect(boardFilmSkippable(DOG_BITE_FILM)).toBe(false);
    expect(boardFilmSkippable(DOG_SCARED_FILM)).toBe(false);
    expect(boardFilmSkippable(EXPLOSION_FILM)).toBe(false);
  });

  it('★ 总时长 = 38 × 114 = 4332 ms；爆炸 8 × 114 = 912；吓退 18 × 71 = 1278', () => {
    expect(DOG_BITE_FILM.frames).toBe(38);
    expect(DOG_BITE_FILM.frameMs).toBe(114);
    expect(dogBiteTotalMs()).toBe(4332);
    expect(boardFilmTotalMs(DOG_BITE_FILM)).toBe(4332);
    expect(boardFilmTotalMs(EXPLOSION_FILM)).toBe(912);
    expect(boardFilmTotalMs(DOG_SCARED_FILM)).toBe(1278);
  });

  runData('★ 三段的帧数/尺寸/每帧毫秒与 Data.mkf 头逐字节一致', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (const film of [DOG_BITE_FILM, DOG_SCARED_FILM, EXPLOSION_FILM]) {
      const info = parseFlicInfo(a.read(film.resource));
      expect(info, `资源 0x${film.resource.toString(16)} 应当是标准 FLIC`).not.toBeNull();
      expect(info!.frames).toBe(film.frames);
      expect(info!.width).toBe(film.width);
      expect(info!.height).toBe(film.height);
      expect(info!.frameMs).toBe(film.frameMs);
    }
  });

  runData('★ 嵌入源路径 = D:\\RICH4\\FLCS\\DOG.FLC —— 与有车那一支的 god-ok.FLC 不同', () => {
    const raw = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x214, 'none');
    const latin = new TextDecoder('latin1');
    const src =
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(raw.subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(src.toUpperCase()).toBe('D:\\RICH4\\FLCS\\DOG.FLC');
    const other = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x228, 'none');
    const otherSrc =
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(other.subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(otherSrc.toUpperCase()).toBe('D:\\GOD-OK.FLC');
  });
});

describe('★ 什么时候播哪一段', () => {
  const dogOn = { type: OBJECT_TYPE_DOG, nodeId: 7 };
  const dogGone = { type: OBJECT_TYPE_DOG, nodeId: 0 };
  const mineOn = { type: OBJECT_TYPE_MINE, nodeId: 7 };
  const mineGone = { type: OBJECT_TYPE_MINE, nodeId: 0 };

  it('惡犬被踩掉 + 徒步 + 住院 0→3 ⇒ 狗咬 0x214', () => {
    expect(dogBiteFxTrigger(st({ object: dogOn }), st({ inHospital: 3, object: dogGone }))).toBe(DOG_BITE_FILM);
  });

  it('★★ 本来就住着院（3→6，加刑）⇒ 照样播（原版每次 `send_to_hospital` 都重播）', () => {
    expect(dogBiteFxTrigger(st({ inHospital: 3, object: dogOn }), st({ inHospital: 6, object: dogGone }))).toBe(DOG_BITE_FILM);
  });

  it('★★ 有车（`traffic_method != 0`）⇒ 播 0x228「狗被车吓退」，不住院', () => {
    // @source VA 0x0041b85d `cmp byte [player + 0x11], 0` / `je 0x41b89e`
    expect(dogBiteFxTrigger(st({ trafficMethod: 2, object: dogOn }), st({ trafficMethod: 2, object: dogGone }))).toBe(DOG_SCARED_FILM);
  });

  it('★ 惡犬还在盘上（没被踩掉）⇒ 什么都不播 —— 别的住院不是狗咬', () => {
    expect(dogBiteFxTrigger(st({ object: dogOn }), st({ inHospital: 3, object: dogOn }))).toBeNull();
    expect(dogBiteFxTrigger(st({ object: dogGone }), st({ inHospital: 3, object: dogGone }))).toBeNull();
  });

  it('★ 附身在人身上的惡犬（attached ≠ 0）不算「盘上的」', () => {
    expect(dogBiteFxTrigger(st({ object: { ...dogOn, attached: 2 } }), st({ inHospital: 3, object: dogGone }))).toBeNull();
  });

  it('★ 地雷被踩掉 + 住院 ⇒ 爆炸 0x20d（先前会误播狗咬）', () => {
    expect(dogBiteFxTrigger(st({ object: mineOn }), st({ inHospital: 3, object: mineGone }))).toBe(EXPLOSION_FILM);
  });

  it('★ 背着的炸彈炸了（f64 → 0）+ 住院 ⇒ 爆炸 0x20d', () => {
    expect(dogBiteFxTrigger(st({ f64: 3 }), st({ f64: 0, inHospital: 5 }))).toBe(EXPLOSION_FILM);
  });

  it('★ 「刑满待释放」那一步（1 → 0x80）**不算**住院变大 —— 没物件被踩掉就什么都不播', () => {
    expect(dogBiteFxTrigger(st({ inHospital: 1, object: dogOn }), st({ inHospital: 0x80, object: dogOn }))).toBeNull();
    // 同一拍若真有惡犬被踩掉而没人住院，那是有车那一支（0x228）—— 计数 1 → 0x80 不算住院
    expect(dogBiteFxTrigger(st({ inHospital: 1, object: dogOn }), st({ inHospital: 0x80, object: dogGone }))).toBe(DOG_SCARED_FILM);
  });

  it('★ 遍历到**任意一位**玩家都能认出来', () => {
    for (let i = 0; i < 4; i++) {
      expect(
        dogBiteFxTrigger(st({ who: i, object: dogOn }), st({ who: i, inHospital: 3, object: dogGone })),
        `slot ${i}`,
      ).toBe(DOG_BITE_FILM);
    }
  });
});

describe('★ 乞丐造型的判据 `wreckedThisAction`（= 走了 `0x40cd07` 那一道）', () => {
  it('惡犬 / 地雷 / 炸彈 ⇒ 是', () => {
    expect(wreckedThisAction(st({ object: { type: OBJECT_TYPE_DOG, nodeId: 7 } }), st({ inHospital: 3, object: { type: OBJECT_TYPE_DOG, nodeId: 0 } }), 0)).toBe(true);
    expect(wreckedThisAction(st({ object: { type: OBJECT_TYPE_MINE, nodeId: 7 } }), st({ inHospital: 3, object: { type: OBJECT_TYPE_MINE, nodeId: 0 } }), 0)).toBe(true);
    expect(wreckedThisAction(st({ f64: 2 }), st({ f64: 0, inHospital: 5 }), 0)).toBe(true);
  });

  it('卡片 / 新聞把人送进醫院（没有物件被踩掉）⇒ 不是', () => {
    expect(wreckedThisAction(st({}), st({ inHospital: 3 }), 0)).toBe(false);
  });

  it('只认**住院计数变大的那一位**', () => {
    const before = st({ who: 1, object: { type: OBJECT_TYPE_DOG, nodeId: 7 } });
    const after = st({ who: 1, inHospital: 3, object: { type: OBJECT_TYPE_DOG, nodeId: 0 } });
    expect(wreckedThisAction(before, after, 1)).toBe(true);
    expect(wreckedThisAction(before, after, 0)).toBe(false);
  });

  it('炸彈还背着（f64 没归零）⇒ 不是', () => {
    expect(wreckedThisAction(st({ f64: 2 }), st({ f64: 2, inHospital: 3 }), 0)).toBe(false);
    expect(OBJECT_TYPE_BOMB).toBe(18);
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★★ `startDogFx` 必须排在 `startConfineFx` **之前**（原版：先 0x214、后 0x20c）', () => {
    const dog = src.indexOf('startDogFx(before, state);');
    const confine = src.indexOf('startConfineFx(before, state);');
    expect(dog).toBeGreaterThan(-1);
    expect(confine).toBeGreaterThan(-1);
    expect(dog).toBeLessThan(confine);
  });

  it('★ 狗咬那一段用**同一份**棋盘影片宿主（自动进 `holdForActorWalk` 那道闸）', () => {
    expect(src).toContain('function startDogFx(before: GameState, after: GameState): void {');
    expect(src).toContain('startBoardFilm(spec);');
    expect(src).toContain('let pendingBoardFilmAfter: BoardFilmSpec | null = null;');
    expect(src).toContain('pendingBoardFilmAfter: pendingBoardFilmAfter !== null,');
    expect(src).toContain('if (stageBusy(stageBusyFlags())) {');
    expect(src).toContain('if (pendingBoardFilmAfter === null) resumeTurnDriver();');
  });
});
