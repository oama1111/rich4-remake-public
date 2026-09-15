/*
 * 熱鍵：键位表就是原版 RICH4.CFG 里那一段
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_BINDINGS, HOTKEY, MOD_CTRL, hotkeyOf, vkOf } from './hotkeys.ts';
import { HOTKEY_NAMES } from './options.ts';

const CFG = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/RICH4.CFG';
const d = existsSync(CFG) ? describe : describe.skip;

/** 造一个够用的假 KeyboardEvent */
function key(code: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyboardEvent {
  return {
    code,
    ctrlKey: mods.ctrl ?? false,
    metaKey: false,
    shiftKey: mods.shift ?? false,
  } as KeyboardEvent;
}

d('键位表', () => {
  it('★ 28 条键位逐字节对上 RICH4.CFG 的 0x10..0x47', () => {
    const cfg = readFileSync(CFG);
    // @source rich4_cfg.txt：热键从 offset 0x10 起，每条两字节（虚拟键码, 修饰键）
    expect(DEFAULT_BINDINGS).toHaveLength(28);
    for (let i = 0; i < DEFAULT_BINDINGS.length; i++) {
      expect([cfg[0x10 + i * 2], cfg[0x10 + i * 2 + 1]], `第 ${i} 条`).toEqual([
        DEFAULT_BINDINGS[i]!.vk,
        DEFAULT_BINDINGS[i]!.mod,
      ]);
    }
    // 文件正好 72 字节（0x48）
    expect(cfg.length).toBe(72);
  });
});

describe('熱鍵', () => {
  it('功能编号与 exe 的名字表一一对应', () => {
    expect(HOTKEY_NAMES).toHaveLength(DEFAULT_BINDINGS.length);
    expect(HOTKEY_NAMES[HOTKEY.advance]).toBe('前進指令');
    expect(HOTKEY_NAMES[HOTKEY.saveGame]).toBe('SAVE GAME');
    expect(HOTKEY_NAMES[HOTKEY.loadGame]).toBe('LOAD GAME');
    expect(HOTKEY_NAMES[HOTKEY.quit]).toBe('結束程式');
  });

  it('字母键按**物理键位**认，与键盘布局无关', () => {
    expect(vkOf(key('KeyA'))).toBe(0x41);
    expect(vkOf(key('KeyZ'))).toBe(0x5a);
    expect(vkOf(key('Space'))).toBe(0x20);
    expect(vkOf(key('ArrowUp'))).toBe(0x26);
    expect(vkOf(key('Comma'))).toBe(0xbc);
    expect(vkOf(key('F1'))).toBeNull(); // 没绑的键
  });

  it('原版那几个键映到正确的功能', () => {
    expect(hotkeyOf(key('Space'))).toBe(HOTKEY.advance);
    expect(hotkeyOf(key('KeyM'))).toBe(HOTKEY.map);
    expect(hotkeyOf(key('KeyS'))).toBe(HOTKEY.saveGame);
    expect(hotkeyOf(key('KeyL'))).toBe(HOTKEY.loadGame);
    expect(hotkeyOf(key('KeyV'))).toBe(HOTKEY.system);
    expect(hotkeyOf(key('KeyA'))).toBe(HOTKEY.autoPlay);
    expect(hotkeyOf(key('KeyY'))).toBe(HOTKEY.yes);
    expect(hotkeyOf(key('KeyN'))).toBe(HOTKEY.no);
    expect(hotkeyOf(key('Comma'))).toBe(HOTKEY.rotateLeft);
    expect(hotkeyOf(key('Period'))).toBe(HOTKEY.rotateRight);
  });

  it('★ Ctrl+Q 与单独的 Q 是两回事', () => {
    // 表里只有 Ctrl+Q，没有裸 Q
    expect(DEFAULT_BINDINGS[HOTKEY.quit]).toEqual({ vk: 0x51, mod: MOD_CTRL });
    expect(hotkeyOf(key('KeyQ', { ctrl: true }))).toBe(HOTKEY.quit);
    expect(hotkeyOf(key('KeyQ'))).toBeNull();
    // 反过来：带 Ctrl 的字母键不该命中那些不要修饰键的条目
    expect(hotkeyOf(key('KeyS', { ctrl: true }))).toBeNull();
  });

  it('Tab 绑了两条（切換選項 / 切換視窗組）—— 取先出现的那条', () => {
    expect(DEFAULT_BINDINGS[HOTKEY.switchOption]!.vk).toBe(0x09);
    expect(DEFAULT_BINDINGS[HOTKEY.switchWindowGroup]!.vk).toBe(0x09);
    expect(hotkeyOf(key('Tab'))).toBe(HOTKEY.switchOption);
  });
});

describe('★ 四个熱鍵必须接到与工具列同一入口（2026-09-16）', () => {
  it('★ 股市/卡片/道具/查詢 不许再落进「尚未實作」', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // 那四个 case 都要有真入口
    for (const call of ['openStock()', "openInventory('cards')", "openInventory('tools')", 'openAssets()']) {
      expect(src, `熱鍵里应当调用 ${call}`).toContain(call);
    }
    // 熱鍵那条 switch 里不该再有「尚未實作」的兜底分支
    //   （工具列那边仍留着一条 default 日志作安全网，所以只查熱鍵这一段）
    const hk = src.slice(src.indexOf('function handleHotkey'), src.indexOf('function startStepTween'));
    expect(hk, '熱鍵里不该再有「尚未實作」').not.toContain('尚未實作');
  });
});
