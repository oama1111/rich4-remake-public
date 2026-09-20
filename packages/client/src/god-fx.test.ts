/*
 * 神明降臨／發威那一段影片 —— Q-ANIM-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事，判据全部回 exe（VA 见 `god-fx.ts` 的文件头）：
 *   ① **派发表**：`_rich4_attach_god` VA 0x0040ea62 的跳表 `ref_0040ea9b`（15 项）
 *      —— `资源 = 0x21b + 名次`、`音效 = 101 + 名次`，编号 11/13/14 **没有影片**；
 *   ② **规格**：12 段全是 440×440 @(0,40)，帧数/每帧毫秒逐段核过资源头；
 *   ③ **什么时候播**：`player.godInfo` 刚变（附身那一刻）；「動畫過程」关掉不播。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import { boardFilmTotalMs, boardFilmSkippable } from './board-film.ts';
import {
  GOD_FX_ARCHIVE,
  GOD_FX_FRAME_MS,
  GOD_FX_FRAMES,
  GOD_FX_H,
  GOD_FX_IDS,
  GOD_FX_W,
  GOD_FX_X,
  GOD_FX_Y,
  godFilmRank,
  godFilmResource,
  godFilmSound,
  godFilmSpec,
  godFxTrigger,
} from './god-fx.ts';

const DATA_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Data.mkf';
const runData = existsSync(DATA_MKF) ? it : it.skip;

// ── 回 exe 取证那一块（素材不在就整块跳过）──
const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const CODE_VA = 0x401000;
const CODE_OFF = 1024;
const exeBuf = existsSync(EXE) ? readFileSync(EXE) : Buffer.alloc(0);
/** 代码段 VA → 文件偏移（与 `tools/disasm.py` 同式；这一块只读代码段）*/
const coff = (va: number): number => va - CODE_VA + CODE_OFF;

/** 只带 `godInfo` + 物件表的最小状态 */
function st(godInfos: number[], objects: { type: number }[] = []): Parameters<typeof godFxTrigger>[0] {
  return {
    players: godInfos.map((godInfo) => ({ godInfo })),
    objects: objects.length > 0 ? objects : Array.from({ length: 15 }, (_, i) => ({ type: i + 1 })),
  };
}

describe('★ 派发表 @source `ref_0040ea9b`（VA 0x0040ea9b，15 项）', () => {
  it('有影片的编号 = {1..10, 12, 15}（放行集合，按跳表顺序）', () => {
    expect(GOD_FX_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15]);
    // 跳表里第 11/13/14 项指向空壳 `fcn_0040ece6`
    expect(godFilmRank(11)).toBeNull();
    expect(godFilmRank(13)).toBeNull();
    expect(godFilmRank(14)).toBeNull();
    expect(godFilmRank(0)).toBeNull();
    expect(godFilmRank(16)).toBeNull();
  });

  it('★ 资源 = 0x21b + 名次、音效 = 101 + 名次', () => {
    for (let id = 1; id <= 10; id++) {
      expect(godFilmRank(id), `id ${id}`).toBe(id);
      expect(godFilmResource(id)).toBe(0x21b + id);
      // 音效 = 101 + 名次，但名次 10/11 在 exe 里是反的（见下面那一条）
      expect(godFilmSound(id)).toBe(id === 10 ? 112 : 101 + id);
    }
    expect(godFilmRank(12)).toBe(11);
    expect(godFilmResource(12)).toBe(0x226);
    expect(godFilmRank(15)).toBe(12);
    expect(godFilmResource(15)).toBe(0x227);
    expect(godFilmSound(15)).toBe(113);
    // 每尊一支，不重号
    const res = GOD_FX_IDS.map((id) => godFilmResource(id));
    expect(new Set(res).size).toBe(12);
    const snd = GOD_FX_IDS.map((id) => godFilmSound(id));
    // ★ 名次 10/11 的音效在 exe 里是**反的**（0x225→112、0x226→111），照抄
    expect(snd).toEqual([102, 103, 104, 105, 106, 107, 108, 109, 110, 112, 111, 113]);
    expect(godFilmSound(10)).toBe(112);
    expect(godFilmSound(12)).toBe(111);
  });

  it('★ 落点/尺寸/flags：全部 440×440 @(0,40)、`flags = 1` ⇒ 点不掉', () => {
    for (const id of GOD_FX_IDS) {
      const spec = godFilmSpec(id)!;
      expect(spec.archive, `id ${id}`).toBe(GOD_FX_ARCHIVE);
      expect(spec.x).toBe(GOD_FX_X);
      expect(spec.y).toBe(GOD_FX_Y);
      expect(spec.y).toBe(0x28);
      expect(spec.width).toBe(GOD_FX_W);
      expect(spec.height).toBe(GOD_FX_H);
      expect(spec.flags).toBe(1);
      expect(boardFilmSkippable(spec), `id ${id} 应当点不掉`).toBe(false);
    }
  });

  it('★ 帧数/每帧毫秒是**逐段**的（0x21e = 128 ms、0x226 = 71 ms，别用统一常量）', () => {
    expect(GOD_FX_FRAMES).toEqual([21, 21, 21, 35, 28, 30, 14, 19, 16, 12, 23, 15]);
    expect(GOD_FX_FRAME_MS[2]).toBe(128); // 名次 3 = 资源 0x21e
    expect(GOD_FX_FRAME_MS[10]).toBe(71); // 名次 11 = 资源 0x226
    // 名次 3 = 编号 3（0x21e）、名次 11 = 编号 **12**（0x226）、名次 12 = 编号 15
    expect(godFilmSpec(3)!.frameMs).toBe(128);
    expect(godFilmSpec(12)!.frameMs).toBe(71);
    expect(godFilmSpec(15)!.frameMs).toBe(100);
    // 总长（毫秒）—— 名次 3 与 11 与「统一 100」的差就是这两段的时长差
    expect(boardFilmTotalMs(godFilmSpec(3)!)).toBe(21 * 128);
    expect(boardFilmTotalMs(godFilmSpec(12)!)).toBe(23 * 71);
  });

  runData('★ 12 段与资源头逐字节一致（帧数/宽高/每帧毫秒）', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (const id of GOD_FX_IDS) {
      const spec = godFilmSpec(id)!;
      const info = parseFlicInfo(a.read(spec.resource));
      expect(info, `资源 ${spec.resource.toString(16)} 应当是标准 FLIC`).not.toBeNull();
      expect(info!.frames, `id ${id} 帧数`).toBe(spec.frames);
      expect(info!.width).toBe(spec.width);
      expect(info!.height).toBe(spec.height);
      expect(info!.frameMs, `id ${id} 每帧毫秒`).toBe(spec.frameMs);
    }
  });
});

describe.skipIf(exeBuf.length === 0)('★★ 回 exe 取证：派发表与头两尊的立即数', () => {
  it('★★ 跳表 15 项：指向 `fcn_0040ece6` 的正好是 11/13/14，其余 12 项就是那 12 段影片', () => {
    const table = Array.from({ length: 15 }, (_, i) =>
      exeBuf.readUInt32LE(coff(0x40ea9b) + i * 4),
    );
    // 空壳函数 VA（`fcn_0040ece6` 就是上面那个「什么都不做」的收尾标签）
    const NO_FILM = 0x0040ece6;
    const withFilm = table
      .map((target, i) => ({ id: i + 1, target }))
      .filter((e) => e.target !== NO_FILM)
      .map((e) => e.id);
    expect(withFilm).toEqual([...GOD_FX_IDS]);
    // 其余三项**全部**是空壳
    expect(table.filter((t) => t === NO_FILM)).toHaveLength(3);
    // 第一项就是 `fcn_0040ec14`（第 1 尊）
    expect(table[0]).toBe(0x0040ec14);
  });

  it('★★ 第 1 尊的函数体里那五个立即数：资源 0x21c / 音效 0x66 / y=0x28 / x=0 / flags=1', () => {
    const body = exeBuf.subarray(coff(0x40ec14), coff(0x40ec14) + 0x60);
    // `cmp byte [0x497159], 0`（動畫過程闸门）
    expect(body.includes(Buffer.from([0x80, 0x3d, 0x59, 0x71, 0x49, 0x00, 0x00]))).toBe(true);
    // `push 0x21c` / `push 0x66`（音效）/ `push 1`（flags）/ `push 0x28`（y）/ `push 0`（x）
    expect(body.includes(Buffer.from([0x68, 0x1c, 0x02, 0x00, 0x00]))).toBe(true);
    expect(body.includes(Buffer.from([0x6a, 0x66]))).toBe(true);
    expect(body.includes(Buffer.from([0x6a, 0x01]))).toBe(true);
    expect(body.includes(Buffer.from([0x6a, 0x28]))).toBe(true);
    // `call fcn_0045144f`（阻塞播放）
    expect(body.includes(Buffer.from([0xe8]))).toBe(true);
    // 与代码里的常量对齐
    expect(godFilmResource(1)).toBe(0x21c);
    expect(godFilmSound(1)).toBe(0x66);
    expect(godFilmSpec(1)!.y).toBe(0x28);
    expect(godFilmSpec(1)!.flags).toBe(1);
  });
});

describe('★ 什么时候播（`godInfo` 的一拍之差）', () => {
  it('附身（0 → 非 0）→ 播那一尊', () => {
    expect(godFxTrigger(st([0, 0, 0, 0]), st([1, 0, 0, 0]))).toBe(1);
    expect(godFxTrigger(st([0, 0, 0, 0]), st([0, 12, 0, 0]))).toBe(12);
    expect(godFxTrigger(st([0, 0, 0, 0]), st([0, 0, 0, 15]))).toBe(15);
  });

  it('★ 换神（旧 → 新）也播 —— 原版 `_rich4_attach_god` 每次都播', () => {
    expect(godFxTrigger(st([1, 0, 0, 0]), st([2, 0, 0, 0]))).toBe(2);
  });

  it('送神（非 0 → 0）不播', () => {
    expect(godFxTrigger(st([1, 0, 0, 0]), st([0, 0, 0, 0]))).toBeNull();
  });

  it('没有影片的编号（11/13/14）不播', () => {
    expect(godFxTrigger(st([0, 0, 0, 0]), st([11, 0, 0, 0]))).toBeNull();
    expect(godFxTrigger(st([0, 0, 0, 0]), st([13, 0, 0, 0]))).toBeNull();
    expect(godFxTrigger(st([0, 0, 0, 0]), st([14, 0, 0, 0]))).toBeNull();
  });

  it('什么都没变 → 不播', () => {
    expect(godFxTrigger(st([3, 0, 0, 0]), st([3, 0, 0, 0]))).toBeNull();
    expect(godFxTrigger(st([0, 0, 0, 0]), st([0, 0, 0, 0]))).toBeNull();
  });

  it('★ 种类取自**物件表**（`objects[godInfo−1].type`），不是下标本身', () => {
    // 下标 0 的物件类型是 12（例如被替换过的槽位）—— 应当播 12 那一支
    const objects = [{ type: 12 }, { type: 7 }];
    expect(godFxTrigger(st([0, 0, 0, 0], objects), st([1, 0, 0, 0], objects))).toBe(12);
    expect(godFxTrigger(st([0, 0, 0, 0], objects), st([0, 2, 0, 0], objects))).toBe(7);
  });

  it('任意一位玩家附身都认（0..3）', () => {
    for (let i = 0; i < 4; i++) {
      const before = [0, 0, 0, 0];
      const after = [0, 0, 0, 0];
      after[i] = 5;
      expect(godFxTrigger(st(before), st(after)), `slot ${i}`).toBe(5);
    }
  });
});

describe('★ main.ts 接线（源码钉子）', () => {
  it('只在「動畫過程」开着时播，且与住院/入獄共用同一份影片宿主', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('startGodFx(before, state);');
    expect(src).toContain('const spec = godFilmSpec(id);');
    expect(src).toContain('startBoardFilm(spec);');
    // 同一道闸（住院/入獄/神明三条都从这里过）—— W-51 起收在 `stageBusyFlags()`
    // 的**唯一一处定义**里，回合驱动与台词闸共用同一个纯函数
    expect(src).toContain('boardFilm: boardFilm !== null,');
    expect(src).toContain('pendingBoardFilm: pendingBoardFilm !== null,');
    expect(src).toContain('if (stageBusy(stageBusyFlags())) {');
    // 棋盘局部坐标
    expect(src).toContain('y: spec.y - LAYOUT.board.y');
  });
});
