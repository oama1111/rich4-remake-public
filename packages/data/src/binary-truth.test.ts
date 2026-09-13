/*
 * ★ 二进制真值校验 —— 直接以 rich4.exe 为基准验证全部数值表
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 为什么需要这个：
 * 逆向项目 rich4-re 已被发现**至少 5 处错误**（见 docs/reverse-engineering-audit.md）。
 * 它是极有价值的线索来源，但**不是真值**。唯一的真值是原版可执行文件本身。
 *
 * 本测试从 `Rich4/rich4.exe` 的 DGROUP 段直接读出三张数值表，
 * 与 packages/data 的 TS 表逐字段比对。任何一处不符即失败。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { CARDS } from './cards.ts';
import { TOOLS } from './tools.ts';
import { CHARACTERS } from './characters.ts';

const EXE = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/rich4.exe';
const d = existsSync(EXE) ? describe : describe.skip;

/**
 * rich4.exe 的 DGROUP 段映射。
 *
 * ⚠️ 该 PE 的节表 VirtualSize 全为 0（老 Watcom 链接器的特点），
 * 因此必须用 SizeOfRawData 来判断 VA 归属，不能用 VirtualSize。
 */
const DGROUP_VA = 0x463000;
const DGROUP_OFF = 398848;
const DGROUP_SIZE = 158720;

/** 表在可执行文件中的虚拟地址（由特征字节序列唯一定位得出） */
const VA = {
  /** 30 项 × 8 字节 */
  cardsTable: 0x47fdf2,
  /** 13 项 × 8 字节，紧接卡片表之后（0x47fdf2 + 30*8 = 0x47fee2） */
  toolTable: 0x47fee2,
  /** 12 项 × 0x68 字节 @source rich4_player_info.h 的注释 */
  characterProfiles: 0x47e80c,
} as const;

function loadExe(): Buffer {
  return readFileSync(EXE);
}

function vaToOffset(va: number): number {
  if (va < DGROUP_VA || va >= DGROUP_VA + DGROUP_SIZE) {
    throw new RangeError(`VA 0x${va.toString(16)} 不在 DGROUP 内`);
  }
  return DGROUP_OFF + (va - DGROUP_VA);
}

const big5 = new TextDecoder('big5');

/** 按指针读取 BIG5 字符串，并去掉原版用于对齐的空格 */
function readStringAt(exe: Buffer, va: number): string {
  const off = vaToOffset(va);
  let end = off;
  while (end < exe.length && exe[end] !== 0) end++;
  return big5.decode(exe.subarray(off, end)).replace(/[ 　]/g, '');
}

d('★ 数值表以 rich4.exe 为基准校验', () => {
  it('PE 校验：确认是预期的可执行文件', () => {
    const exe = loadExe();
    expect(exe.length).toBe(602_112);
    const peOff = exe.readUInt32LE(0x3c);
    expect(exe.subarray(peOff, peOff + 4).toString('latin1')).toBe('PE\0\0');
    expect(exe.readUInt32LE(peOff + 24 + 28)).toBe(0x400000); // ImageBase
  });

  it('卡片表 30 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.cardsTable);
    expect(CARDS.length).toBe(30);

    for (let i = 0; i < 30; i++) {
      const o = base + i * 8;
      const card = CARDS[i]!;
      const namePtr = exe.readUInt32LE(o);
      expect(
        [exe[o + 4], exe[o + 5], exe[o + 6], exe[o + 7]],
        `第 ${i + 1} 张卡 ${card.name}`,
      ).toEqual([card.initAmount, card.price, card.f6, card.f7]);
      // 名称也要对上（繁体）
      expect(readStringAt(exe, namePtr), `第 ${i + 1} 张卡名称`).toBe(card.name);
    }
  });

  it('道具表 13 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.toolTable);
    expect(TOOLS.length).toBe(13);

    for (let i = 0; i < 13; i++) {
      const o = base + i * 8;
      const tool = TOOLS[i]!;
      expect(
        [exe[o + 4], exe[o + 5], exe[o + 6], exe[o + 7]],
        `第 ${i + 1} 个道具 ${tool.name}`,
      ).toEqual([tool.initAmount, tool.price, tool.f6, tool.f7]);
      expect(readStringAt(exe, exe.readUInt32LE(o)), `第 ${i + 1} 个道具名称`).toBe(tool.name);
    }
  });

  it('道具表紧接卡片表之后（布局自洽）', () => {
    expect(VA.cardsTable + 30 * 8).toBe(VA.toolTable);
  });

  it('角色表 12 项与二进制逐字段一致', () => {
    const exe = loadExe();
    const base = vaToOffset(VA.characterProfiles);
    expect(CHARACTERS.length).toBe(12);

    for (let i = 0; i < 12; i++) {
      const o = base + i * 0x68;
      const ch = CHARACTERS[i]!;
      expect(exe.readUInt32LE(o + 0x04), `${ch.name} color`).toBe(ch.color);
      expect(exe[o + 0x11], `${ch.name} trafficMethod`).toBe(ch.trafficMethod);
      expect(exe[o + 0x12], `${ch.name} ndices`).toBe(ch.ndices);
      expect(exe[o + 0x13], `${ch.name} 角色编号`).toBe(ch.id);
      // 原版 sex: 1 = 男, 0 = 女
      expect(exe[o + 0x14] === 0, `${ch.name} 性别`).toBe(ch.isFemale);
      expect(exe[o + 0x16], `${ch.name} f22`).toBe(ch.f22);
      expect(exe[o + 0x17], `${ch.name} f23`).toBe(ch.f23);
      expect(exe[o + 0x18], `${ch.name} f24`).toBe(ch.f24);
      expect(exe[o + 0x19], `${ch.name} initCashRatio`).toBe(ch.initCashRatio);
      expect(exe[o + 0x1a], `${ch.name} f26`).toBe(ch.f26);
      expect(readStringAt(exe, exe.readUInt32LE(o)), `${ch.name} 名称`).toBe(ch.name);
    }
  });

  it('★ 三张表全部来自同一可执行文件，无一字段依赖逆向项目的转录', () => {
    // 这条是声明性的：上面四项若全通过，即证明 packages/data 的数值
    // 完全独立于 rich4-re 的 .c 文件而成立。
    const exe = loadExe();
    expect(vaToOffset(VA.cardsTable)).toBeLessThan(exe.length);
    expect(vaToOffset(VA.toolTable)).toBeLessThan(exe.length);
    expect(vaToOffset(VA.characterProfiles)).toBeLessThan(exe.length);
  });
});
