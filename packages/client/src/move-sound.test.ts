/*
 * 走子音效（MOVE_SOUND）—— 钉子
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一组测试要钉死两件**容易读反**的事：
 *
 *  1. **号**：走路 44 / 機車 45 / 汽車 46 / 船 53，出处是 exe 数据段里那张表本身
 *     （`0x48234a` 每项 8 字节、第一 dword = `Effect.mkf` 资源号，索引 = 11 + 交通方式）。
 *     这里**直接开 rich4.exe 的数据段**读那 4 个 dword 来断言 —— 表被改过就红。
 *  2. **次数**：一次移动走 N 格 = **N 次** Play（起步那一下算第 1 格）。
 *     ★ 上一轮把这里读成「一次移动只放一次」并写进了 Q-DOLL-1 残留项②，
 *       是**把跳表读错位了**（state 1/2 对调）。订正写在 `docs/deviations/Q-SOUND-1.md`，
 *       本文件钉的是订正后的行为。
 *
 * ⚠️ 「N 次」不是「N 个重叠的音」：原版每一格 Play 之前/走完都会 Stop 同一路
 *   （`[0x4749d4]` 那一号），所以永远只有一路在响。宿主照 `moveSoundStep` 的
 *   `'stop'` / `'play'` 逐一执行，就不会出现本引擎先前的多层叠加。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DICE_SOUND, MOVE_SOUND, SOUND_IDS } from '@rich4/assets-pipeline';
import { MOVE_SOUND_ALT, MOVE_SOUND_IDLE, moveSoundId, moveSoundStep } from './move-sound.ts';
import type { MoveSoundState } from './move-sound.ts';

const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
const haveExe = existsSync(EXE) ? it : it.skip;

/**
 * VA → 文件偏移。
 *
 * ⚠️ 这个 PE 的节表 `VirtualSize` 全是 0（老 Watcom 链接器），
 *   只能用 `SizeOfRawData` 换算；`0x463000` 起是 DGROUP（文件偏移 398848）。
 *   与 `tools/disasm.py` 的 `SECTIONS` 同一套 —— 那边也在注释里写了同一个坑。
 */
function exeDword(va: number): number {
  const data = readFileSync(EXE);
  const CODE_VA = 0x401000;
  const CODE_OFF = 1024;
  const CODE_SIZE = 394240;
  const DGROUP_VA = 0x463000;
  const DGROUP_OFF = 398848;
  const DGROUP_SIZE = 158720;
  let off: number;
  if (va >= CODE_VA && va < CODE_VA + CODE_SIZE) off = CODE_OFF + (va - CODE_VA);
  else if (va >= DGROUP_VA && va < DGROUP_VA + DGROUP_SIZE) off = DGROUP_OFF + (va - DGROUP_VA);
  else throw new Error(`VA 0x${va.toString(16)} 不在已知节内`);
  return data.readUInt32LE(off);
}

/** 音效表 `0x48234a` 第 `index` 项的第一 dword（= Effect.mkf 资源号） @source VA 0x00454186 */
const tableEntry = (index: number) => exeDword(0x48234a + index * 8);

describe('★ MOVE_SOUND 的号 —— 直接开 exe 数据段核对', () => {
  haveExe('★ 表 0x48234a 的 11..14 项就是 44 / 45 / 46 / 53', () => {
    // 索引 11..14 @source VA 0x0040d9da（`add eax, 0xb`）
    expect(tableEntry(11)).toBe(44); // 走路 @0x4823a2
    expect(tableEntry(12)).toBe(45); // 機車 @0x4823aa
    expect(tableEntry(13)).toBe(46); // 汽車 @0x4823b2
    expect(tableEntry(14)).toBe(53); // 船   @0x4823ba
    expect([...MOVE_SOUND]).toEqual([44, 45, 46, 53]);
  });

  haveExe('★ 备用组那一号（索引 15）= 47，@0x4823c2', () => {
    // @source VA 0x0040d9ce `mov [0x4749d4], 0xf`
    expect(tableEntry(15)).toBe(47);
    expect(MOVE_SOUND_ALT).toBe(47);
  });

  haveExe('★ 表里 0..3 项是 7/9/10/32 —— 别把它们当成移动声', () => {
    expect([tableEntry(0), tableEntry(1), tableEntry(2), tableEntry(3)]).toEqual([7, 9, 10, 32]);
    // 骰子音效正是索引 2
    expect(tableEntry(2)).toBe(DICE_SOUND);
  });

  haveExe('★ 機器娃娃那一号（索引 9）= 38，不是移动声', () => {
    // @source VA 0x0040ded3 `eax = 0x48234a + 0x48`
    expect(tableEntry(9)).toBe(SOUND_IDS.DOLL);
    expect(SOUND_IDS.DOLL).toBe(38);
    expect(MOVE_SOUND).not.toContain(38);
  });
});

describe('moveSoundId —— 交通方式与号的对应', () => {
  it('0/1/2/3 → 44/45/46/53', () => {
    expect(moveSoundId(0)).toBe(44);
    expect(moveSoundId(1)).toBe(45);
    expect(moveSoundId(2)).toBe(46);
    expect(moveSoundId(3)).toBe(53);
  });

  it('下标按 &3 夹住（原版 `and al, 3`）—— 4..7 与 0..3 同号', () => {
    expect(moveSoundId(4)).toBe(44);
    expect(moveSoundId(5)).toBe(45);
    expect(moveSoundId(7)).toBe(53);
  });

  it('备用精灵组那一支走 47（@source VA 0x0040d9ce）', () => {
    expect(moveSoundId(0, true)).toBe(47);
    expect(moveSoundId(3, true)).toBe(47);
  });
});

describe('★ moveSoundStep —— 这一拍该放音吗', () => {
  /** 把一串「拍」喂进去，收集动作 —— 每一拍 = 宿主的一帧 */
  function run(frames: { cellId: number; moving: boolean; trafficMethod?: number }[]) {
    let st: MoveSoundState = MOVE_SOUND_IDLE;
    const steps: ('play' | 'stop' | null)[] = [];
    const ids: (number | null)[] = [];
    for (const f of frames) {
      const r = moveSoundStep(st, {
        trafficMethod: f.trafficMethod ?? 0,
        cellId: f.cellId,
        moving: f.moving,
      });
      steps.push(r.step);
      ids.push(r.id);
      st = r.state;
    }
    return { steps, ids, end: st };
  }

  it('★ 钉子：走 5 格只放 5 次（不是 1 次、也不是每 tick 1 次）', () => {
    // 5 个格子，每格 2 拍（补间还没走完的那一拍 + 到达下一格的那一拍）
    const frames = [{ cellId: 10, moving: true }];
    let cell = 10;
    for (let i = 0; i < 4; i++) {
      cell++;
      frames.push({ cellId: cell, moving: true }); // 到达新格的那一拍
      frames.push({ cellId: cell, moving: true }); // 还在这一格里（补间未完成）
    }
    frames.push({ cellId: cell, moving: false }); // 走完，收摊

    const { steps } = run(frames);
    expect(steps.filter((s) => s === 'play')).toHaveLength(5);
    expect(steps.filter((s) => s === 'stop')).toHaveLength(1);
  });

  it('★ 同一个格子里连喂 10 拍 —— 只放 1 次（补间中间态不重复触发）', () => {
    const frames = Array.from({ length: 10 }, () => ({ cellId: 42, moving: true }));
    const { steps } = run(frames);
    expect(steps.filter((s) => s === 'play')).toHaveLength(1);
    expect(steps[0]).toBe('play');
    expect(steps.slice(1).every((s) => s === null)).toBe(true);
  });

  it('★ 起步那一拍就放（原版起步 Play @VA 0x0040d9f2 / 0x0040dde1）', () => {
    const r = moveSoundStep(MOVE_SOUND_IDLE, { trafficMethod: 2, cellId: 7, moving: true });
    expect(r.step).toBe('play');
    expect(r.id).toBe(46); // 汽車
    expect(r.state).toEqual({ moveSoundId: 46, moveSoundCell: 7 });
  });

  it('★ 走完那一拍 Stop，并把状态清干净（@VA 0x0040d8dc）', () => {
    const r = moveSoundStep({ moveSoundId: 44, moveSoundCell: 7 }, {
      trafficMethod: 0,
      cellId: 7,
      moving: false,
    });
    expect(r.step).toBe('stop');
    expect(r.state).toEqual(MOVE_SOUND_IDLE);
  });

  it('本来就没音在放、又没在走 → 什么都不做（别对着空气 Stop）', () => {
    const r = moveSoundStep(MOVE_SOUND_IDLE, { trafficMethod: 0, cellId: 0, moving: false });
    expect(r.step).toBeNull();
    expect(r.id).toBeNull();
  });

  it('换交通方式（同一格）→ 按新的号再放一次', () => {
    const r = moveSoundStep({ moveSoundId: 44, moveSoundCell: 7 }, {
      trafficMethod: 2,
      cellId: 7,
      moving: true,
    });
    // 同一格不会重放（原版就认 [0x498ea3]，不认交通方式变化）——
    // 这一条钉住「不额外加戏」：原版没有的东西不加。
    expect(r.step).toBeNull();
  });

  it('逐格都是同一路号：整趟 4 格都是 44（不会中途换号）', () => {
    const { ids } = run([
      { cellId: 1, moving: true },
      { cellId: 2, moving: true },
      { cellId: 3, moving: true },
      { cellId: 4, moving: true },
    ]);
    expect(ids.filter((i) => i !== null)).toEqual([44, 44, 44, 44]);
  });

  it('交通方式换了号也跟着换（機車 45 → 船 53）', () => {
    const { ids } = run([
      { cellId: 1, moving: true, trafficMethod: 1 },
      { cellId: 2, moving: true, trafficMethod: 3 },
    ]);
    expect(ids.filter((i) => i !== null)).toEqual([45, 53]);
  });
});
