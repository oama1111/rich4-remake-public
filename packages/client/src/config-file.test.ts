/*
 * `RICH4.CFG` 编解码 —— 直接对原版那 72 字节逐字节校验
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 真值 = 仓库里那份原版 `Rich4/RICH4.CFG`（72 字节，2001 年那份）。
 * `HOTKEY_DEFAULT_KEYS` 也是从它抄的，两条独立取证正好互相印证。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CONFIG_CALENDAR_OFFSET,
  CONFIG_DATE_OFFSET,
  CONFIG_FILE_SIZE,
  CONFIG_HOTKEY_COUNT,
  CONFIG_HOTKEY_OFFSET,
  CONFIG_MOD_CTRL,
  configHotkeyKeys,
  decodeConfig,
  encodeConfig,
  type Rich4Config,
} from './config-file.ts';
import { DEFAULT_BINDINGS } from './hotkeys.ts';
import { HOTKEY_DEFAULT_KEYS } from './options-pages.ts';

const CFG = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/RICH4.CFG';
const have = existsSync(CFG) ? it : it.skip;

describe('★ 结构常量 @source `rich4_config_file.h`', () => {
  it('文件 72 字节 = 16 字节设定 + 28×2 键位', () => {
    expect(CONFIG_FILE_SIZE).toBe(72);
    expect(CONFIG_HOTKEY_OFFSET).toBe(0x10);
    expect(CONFIG_HOTKEY_COUNT).toBe(28);
    expect(CONFIG_HOTKEY_OFFSET + CONFIG_HOTKEY_COUNT * 2).toBe(CONFIG_FILE_SIZE);
  });

  it('日期三个字节在 +8（day / month / year u16）', () => {
    expect(CONFIG_DATE_OFFSET).toBe(8);
  });

  it('`CONFIG_MOD_CTRL` 与 `hotkeys.ts` 的 `MOD_CTRL` 同值', () => {
    expect(CONFIG_MOD_CTRL).toBe(0x11);
  });
});

describe('★ 编解码往返', () => {
  const cfg: Rich4Config = {
    speed: 2,
    animation: false,
    music: 4,
    sound: 1,
    autoSave: true,
    view: 2,
    calendar: 1,
    year: 2002,
    month: 4,
    day: 14,
    hotkeys: Array.from({ length: 28 }, (_, i) => ({ vk: i + 1, mod: i === 27 ? 0x11 : 0 })),
  };

  it('`encode` → `decode` 逐字段还原', () => {
    expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg);
  });

  it('布尔字段写成 1/0（不是 true/false）', () => {
    const b = encodeConfig({ ...cfg, animation: true, autoSave: false });
    expect(b[1]).toBe(1);
    expect(b[4]).toBe(0);
  });

  it('日期按 u16 小端写回 +10..11', () => {
    const b = encodeConfig({ ...cfg, year: 0x1234 });
    expect(b[10]).toBe(0x34);
    expect(b[11]).toBe(0x12);
  });

  it('dummy 两段保持 0（原版不写）—— +12 是日/月曆，不算 dummy', () => {
    const b = encodeConfig(cfg);
    expect([...b.slice(6, 8)]).toEqual([0, 0]);
    expect([...b.slice(13, 16)]).toEqual([0, 0, 0]);
  });

  it('★ pt22 #12：+12 = 日曆 0 / 月曆 1（`[0x497164]`），编进去、读回来', () => {
    expect(CONFIG_CALENDAR_OFFSET).toBe(0x497164 - 0x497158);
    expect(encodeConfig({ ...cfg, calendar: 1 })[12]).toBe(1);
    expect(encodeConfig({ ...cfg, calendar: 0 })[12]).toBe(0);
    // 省略 = 0（出厂日曆）
    const { calendar: _drop, ...noCal } = cfg;
    void _drop;
    expect(encodeConfig(noCal)[12]).toBe(0);
    const raw = encodeConfig(cfg);
    raw[12] = 1;
    expect(decodeConfig(raw)!.calendar).toBe(1);
  });

  it('键位不足 28 条时后面补 0；多了丢掉', () => {
    const short = encodeConfig({ ...cfg, hotkeys: [{ vk: 0x41, mod: 0 }] });
    expect(short[CONFIG_HOTKEY_OFFSET]).toBe(0x41);
    expect([...short.slice(CONFIG_HOTKEY_OFFSET + 2, CONFIG_FILE_SIZE)]).toEqual(
      new Array((CONFIG_HOTKEY_COUNT - 1) * 2).fill(0),
    );
    const long = encodeConfig({ ...cfg, hotkeys: new Array(40).fill({ vk: 0x42, mod: 0 }) });
    expect(long.length).toBe(CONFIG_FILE_SIZE);
  });

  it('长度不够 / null ⇒ `decode` 返回 null（调用方退回默认）', () => {
    expect(decodeConfig(null)).toBeNull();
    expect(decodeConfig(undefined)).toBeNull();
    expect(decodeConfig(new Uint8Array(71))).toBeNull();
    expect(decodeConfig(new Uint8Array(0))).toBeNull();
    // 多出来的字节忽略（原版 fread 只读 sizeof）
    expect(decodeConfig(new Uint8Array(200))).not.toBeNull();
  });

  it('★ 越界值**照原样存**（原版不夹取，夹取属改良）', () => {
    const b = encodeConfig({ ...cfg, speed: 9, music: 200, view: 7 });
    expect(b[0]).toBe(9);
    expect(b[2]).toBe(200);
    expect(b[5]).toBe(7);
  });
});

describe('★ 直接对原版 `RICH4.CFG` 逐字节校验', () => {
  have('文件正好 72 字节', () => {
    expect(readFileSync(CFG).length).toBe(CONFIG_FILE_SIZE);
  });

  have('★★ `decode(整个文件)` 的 28 条键位 = `HOTKEY_DEFAULT_KEYS`（两条独立取证互证）', () => {
    const cfg = decodeConfig(new Uint8Array(readFileSync(CFG)))!;
    // ⚠️ `HOTKEY_DEFAULT_KEYS` 存的是**word**（低字节键、高字节修饰）——
    //   与原版键位表 0x47edc2 逐字节同形，所以按 word 比。
    const words = cfg.hotkeys.map((k) => ((k.mod & 0xff) << 8) | (k.vk & 0xff));
    expect(words).toEqual([...HOTKEY_DEFAULT_KEYS]);
    // 拆开看也是对的：末条是 Ctrl+Q
    expect(cfg.hotkeys[27]).toEqual({ vk: 0x51, mod: CONFIG_MOD_CTRL });
    expect(configHotkeyKeys(cfg).slice(0, 27)).toEqual(
      DEFAULT_BINDINGS.map((b) => b.vk).slice(0, 27),
    );
  });

  have('★ 设定六个字节：speed 2 / animation 关 / music 4 / sound 4 / autoSave 开 / view 1', () => {
    const raw = new Uint8Array(readFileSync(CFG));
    const cfg = decodeConfig(raw)!;
    expect(raw[0]).toBe(2);
    expect(raw[1]).toBe(0);
    expect(raw[2]).toBe(4);
    expect(raw[3]).toBe(4);
    expect(raw[4]).toBe(1);
    expect(raw[5]).toBe(1);
    expect(cfg.speed).toBe(2);
    expect(cfg.animation).toBe(false);
    expect(cfg.music).toBe(4);
    expect(cfg.sound).toBe(4);
    expect(cfg.autoSave).toBe(true);
    expect(cfg.view).toBe(1);
  });

  have('★ +12 = 0（那份文件存的是日曆）', () => {
    expect(decodeConfig(new Uint8Array(readFileSync(CFG)))!.calendar).toBe(0);
  });

  have('★ 日期 = 2002-04-14（`0e 04 d2 07`，与原版文件头一致）', () => {
    const cfg = decodeConfig(new Uint8Array(readFileSync(CFG)))!;
    expect([cfg.year, cfg.month, cfg.day]).toEqual([2002, 4, 14]);
  });

  have('★★ 把解出来的原样编回去 ⇒ **逐字节等于原文件**（无损往返）', () => {
    const raw = new Uint8Array(readFileSync(CFG));
    const back = encodeConfig(decodeConfig(raw)!);
    expect([...back]).toEqual([...raw]);
  });
});
