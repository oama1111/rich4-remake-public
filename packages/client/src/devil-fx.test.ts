/*
 * 「惡魔顯靈拆屋」那一段影片 —— 全部照 exe（W-55 行 4）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉四件事，判据全部回 exe / 资源头（VA 见 `devil-fx.ts` 的文件头）：
 *   ① **是哪一段**：`Data.mkf` **0x20e**（嵌入源路径 `D:\RICH4\FLCS\BOMB2.FLC`）；
 *   ② **规格**：8 帧 / **110×110** / 114 ms / 音效 95（`0x5f`）/ flags `0x30001`；
 *   ③ **落点**：目标格屏幕坐标 **−55**（`0x37`）= 110×110 居中盖在那一格；
 *   ④ **什么时候播**：`notices` 里**新出现** `god.demolish`（不是看等级变没变）。
 *
 * ★ 可证伪：把资源号改成 0x20b/0x214（别的影片）、把帧数/每帧毫秒改一位、
 *   把音效改成 0x5b/0x60、把落点偏移改成 0x28、把触发器改成「只要 after 里有
 *   god.demolish 就算」—— 每一条都会当场红（见下逐条）。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';

import { boardFilmSkippable, boardFilmTotalMs } from './board-film.ts';
import {
  DEVIL_DEMOLISH_FILM,
  DEVIL_DEMOLISH_FRAMES,
  DEVIL_DEMOLISH_FRAME_MS,
  DEVIL_FX_ARCHIVE,
  DEVIL_FX_FLAGS,
  DEVIL_FX_H,
  DEVIL_FX_HALF,
  DEVIL_FX_RESOURCE,
  DEVIL_FX_SOUND,
  DEVIL_FX_W,
  devilDemolishFilmAt,
  devilDemolishFxTrigger,
  devilDemolishTotalMs,
} from './devil-fx.ts';

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

/** 一步状态：只带 `notices` 的最小形状 */
function st(keys: readonly string[]): { notices: { key: string }[] } {
  return { notices: keys.map((key) => ({ key })) };
}

describe('★ 影片规格 @source 资源头 + 调用点字节', () => {
  it('这一段在 Data.mkf、资源号 0x20e（**不是**神明那 12 段里的任何一段）', () => {
    expect(DEVIL_FX_ARCHIVE).toBe('Data.mkf');
    expect(DEVIL_FX_RESOURCE).toBe(0x20e);
    expect(DEVIL_DEMOLISH_FILM.resource).toBe(0x20e);
    expect(DEVIL_DEMOLISH_FILM.id).toBe('devil-demolish');
    // 反证：0x21c..0x227 是「神明降臨/發威」那 12 段，0x20b 是滿級烟花
    expect(DEVIL_FX_RESOURCE).not.toBe(0x20b);
    expect(DEVIL_FX_RESOURCE).not.toBe(0x214);
    expect(DEVIL_FX_RESOURCE).not.toBe(0x21c);
  });

  runExe('★ 回 exe 钉：惡魔那一支的 5 个立即数（资源/音效/flags/两个落点）', () => {
    // @source VA 0x0040f642 / 0x0040f657 / 0x0040f659 / 0x0040f665 / 0x0040f670
    const res = exeBytes(0x40f642, 5);
    expect(res.readUInt8(0)).toBe(0x68); // push imm32
    expect(res.readUInt32LE(1)).toBe(0x20e);
    const snd = exeBytes(0x40f657, 2);
    expect([...snd]).toEqual([0x6a, 0x5f]); // push 0x5f（音效 95）
    const flags = exeBytes(0x40f659, 5);
    expect(flags.readUInt8(0)).toBe(0x68);
    expect(flags.readUInt32LE(1)).toBe(0x30001);
    // 两个 `sub eax, 0x37`（arg3 = y、arg2 = x）—— 各 3 字节：83 e8 37
    expect([...exeBytes(0x40f665, 3)]).toEqual([0x83, 0xe8, 0x37]);
    expect([...exeBytes(0x40f670, 3)]).toEqual([0x83, 0xe8, 0x37]);
    // 先把影片解出来再播：read_mkf(Data.mkf, 0x20e) 在 0x40f642 之后
    const readMkf = exeBytes(0x40f647, 5);
    expect(readMkf.readUInt8(0)).toBe(0xa1); // mov eax, [0x48a0e4]
    expect(readMkf.readUInt32LE(1)).toBe(0x48a0e4);
  });

  it('★ 落点偏移 0x37 = 55 = **半个宽/半个高**（110×110 居中盖在那一格）', () => {
    expect(DEVIL_FX_HALF).toBe(0x37);
    expect(DEVIL_FX_HALF).toBe(55);
    expect(DEVIL_FX_W).toBe(110);
    expect(DEVIL_FX_H).toBe(110);
    expect(DEVIL_FX_HALF).toBe(DEVIL_FX_W / 2);
    expect(DEVIL_FX_HALF).toBe(DEVIL_FX_H / 2);
  });

  it('★ 落点 = 目标格屏幕坐标 − 55（**不是**整块棋盘的 (0,0x28)）', () => {
    const spec = devilDemolishFilmAt(300, 240);
    expect(spec.x).toBe(245);
    expect(spec.y).toBe(185);
    // 反证：dog-fx / god-fx 那一族是整块 440×440 贴 (0, 0x28)，这里不是
    expect(spec.width).toBe(110);
    expect(spec.height).toBe(110);
    expect(spec.y).not.toBe(0x28);
  });

  it('★ 音效 95（0x5f）；**不是**大锤 91 / 滿級 90 / 狗咬 85 / 救护车 93', () => {
    expect(DEVIL_FX_SOUND).toBe(0x5f);
    expect(DEVIL_FX_SOUND).toBe(95);
    for (const other of [0x5b, 0x5a, 0x55, 0x5d]) expect(DEVIL_FX_SOUND).not.toBe(other);
  });

  it('★ flags 0x30001 ⇒ bit1 = 0 ⇒ 原版这 0.912 秒**点不掉**', () => {
    expect(DEVIL_FX_FLAGS).toBe(0x30001);
    expect((DEVIL_FX_FLAGS & 2) === 0).toBe(true);
    expect(boardFilmSkippable(DEVIL_DEMOLISH_FILM)).toBe(false);
  });

  it('★ 总时长 = 8 × 114 = 912 ms（不循环、不重复）', () => {
    expect(DEVIL_DEMOLISH_FRAMES).toBe(8);
    expect(DEVIL_DEMOLISH_FRAME_MS).toBe(114);
    expect(devilDemolishTotalMs()).toBe(912);
    expect(boardFilmTotalMs(DEVIL_DEMOLISH_FILM)).toBe(912);
    // 「D:\RICH4\FLCS\BOMB2.FLC」那段影片，不是 440×440 的整块棋盘片
    expect(DEVIL_DEMOLISH_FILM.width).not.toBe(440);
  });

  runData('★ 帧数/尺寸/每帧毫秒与 Data.mkf 0x20e 头逐字节一致（不许写死）', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    const info = parseFlicInfo(a.read(DEVIL_DEMOLISH_FILM.resource));
    expect(info, '资源 0x20e 应当是标准 FLIC').not.toBeNull();
    expect(info!.frames).toBe(DEVIL_DEMOLISH_FRAMES);
    expect(info!.width).toBe(DEVIL_FX_W);
    expect(info!.height).toBe(DEVIL_FX_H);
    expect(info!.frameMs).toBe(DEVIL_DEMOLISH_FRAME_MS);
    // 与规格表逐项一致（规格表与资源头是两份独立来源，必须互相印证）
    expect(info!.frames).toBe(DEVIL_DEMOLISH_FILM.frames);
    expect(info!.frameMs).toBe(DEVIL_DEMOLISH_FILM.frameMs);
    // 半个宽 = 偏移 —— 资源头与调用点立即数在这里对上
    expect(info!.width / 2).toBe(DEVIL_FX_HALF);
  });

  runData('★ 嵌入源路径 = D:\\RICH4\\FLCS\\BOMB2.FLC —— 与神明那几段不同', () => {
    const raw = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x20e, 'none');
    const latin = new TextDecoder('latin1');
    const src =
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(raw.subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(src.toUpperCase()).toBe('D:\\RICH4\\FLCS\\BOMB2.FLC');
    // 反证：神明降臨那一段（0x21c）不是它
    const other = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF))).read(0x21c, 'none');
    const otherSrc =
      /\w:[\\/][\x20-\x7e]{4,}\.FL[CI]/.exec(latin.decode(other.subarray(0x80, 0x1200)))?.[0] ?? '';
    expect(otherSrc.toUpperCase()).not.toBe('D:\\RICH4\\FLCS\\BOMB2.FLC');
  });
});

describe('★ 什么时候播 —— `notices` 里**新出现** `god.demolish`', () => {
  it('★ 上一拍没有、这一拍有 ⇒ 播', () => {
    expect(devilDemolishFxTrigger(st([]), st(['god.demolish']))).toBe(true);
    expect(devilDemolishFxTrigger(st(['god.build']), st(['god.build', 'god.demolish']))).toBe(true);
  });

  it('★ 可证伪：`after` 里有、但 `before` 里**也有**（上一条 action 留下的）⇒ **不播**', () => {
    // 只看「数组里有没有」的实现会在这里红。
    expect(devilDemolishFxTrigger(st(['god.demolish']), st(['god.demolish']))).toBe(false);
    expect(devilDemolishFxTrigger(st(['god.demolish']), st(['god.demolish', 'god.build']))).toBe(
      false,
    );
  });

  it('★ 可证伪：别的訊息框（god.build / god.seize / 收租…）一律不播', () => {
    expect(devilDemolishFxTrigger(st([]), st(['god.build']))).toBe(false);
    expect(devilDemolishFxTrigger(st([]), st(['god.seize']))).toBe(false);
    expect(devilDemolishFxTrigger(st([]), st(['rent.payOneOwner']))).toBe(false);
    expect(devilDemolishFxTrigger(st([]), st([]))).toBe(false);
  });

  it('★ 同一条 action 里弹了两扇（拆 + 别的）也认得出', () => {
    expect(
      devilDemolishFxTrigger(st(['god.build']), st(['god.build', 'god.demolish', 'rent.x'])),
    ).toBe(true);
  });

  it('★ 计数语义：`god.demolish` 出现两次（两次都是本 action 弹的）⇒ 播（至少一次）', () => {
    expect(devilDemolishFxTrigger(st([]), st(['god.demolish', 'god.demolish']))).toBe(true);
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('★★ 这一段真的挂在 `startActionFx` 上（W-55 当时只做到模块，接线是收尾补的）', () => {
    expect(src).toContain('function startDevilFx(before: GameState, after: GameState): void {');
    expect(src).toContain('startDevilFx(before, state);');
    // 起播走的是**同一份**棋盘影片宿主（自动进 `stageBusy` 那道闸）
    expect(src).toContain('startBoardFilm(devilDemolishFilmAt(');
  });

  it('★★ 落点必须**逐格现算**，并加回棋盘原点（`worldToScreen` 给的是棋盘局部坐标）', () => {
    const at = src.indexOf('function startDevilFx(');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1400);
    expect(body).toContain('worldToScreen(node.x, node.y, camera,');
    expect(body).toContain('LAYOUT.board.w, h: LAYOUT.board.h');
    // ★ 少了 `+ LAYOUT.board.y` 就会整体上移 40 px（`currentBoardFilmFrame` 会再减回去）
    expect(body).toContain('p.x + LAYOUT.board.x');
    expect(body).toContain('p.y + LAYOUT.board.y');
  });

  it('★ 棋盘按 **after** 画（原版先拆、重画、再播；这一段只有 110×110，四周看得见）', () => {
    const at = src.indexOf('function startDevilFx(');
    const body = src.slice(at, at + 1400);
    expect(body).toContain('deferredBoardBefore = after;');
    expect(body).not.toContain('deferredBoardBefore = before;');
  });

  it('★ 判据用 `devilDemolishFxTrigger`（`notices` 计数），不是自己比等级', () => {
    const at = src.indexOf('function startDevilFx(');
    const body = src.slice(at, at + 1400);
    expect(body).toContain('if (!devilDemolishFxTrigger(before, after)) return;');
    expect(body).not.toContain('landLevel');
    expect(body).not.toContain('facilityLevel');
  });
});
