/*
 * 熱鍵
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 28 个功能、默认键位**全部取自原版的 `RICH4.CFG`**（游戏目录里那一份，
 *   72 字节，格式见 `rich4-re/docs/rich4_cfg.txt`）：从 offset 0x10 起
 *   每个功能两字节 —— 第一字节是 Windows 虚拟键码，第二字节是修饰键
 *   （0x11 = Ctrl）。原文件的这一段是：
 *
 * ```
 * 0x10: 26 00  27 00  28 00  25 00  0d 00  1b 00  09 00  09 00
 * 0x20: 59 00  4e 00  20 00  44 00  57 00  58 00  43 00  45 00
 * 0x30: 46 00  4d 00  bc 00  be 00  41 00  56 00  53 00  4c 00
 * 0x40: 48 00  21 00  22 00  51 11
 * ```
 *
 * 顺序与 exe 里的熱鍵名表一致（串表 `0x00474abc`，28 条，见 @rich4/data 的
 * `HOTKEY_NAMES`），所以两边能一一对上。
 *
 * ⚠️ **改键还没做**：原版的熱鍵設定屏（`Data.mkf` 资源 3 图 1）只解出了
 *   版式，没接（见 docs/known-deviations.md 的 Q-OPT-1）。这里只用默认键位。
 *
 * ⚠️ 有几个功能本引擎还没有对应的屏（股市/交易/卡片/道具/查詢/輔助說明），
 *   按了只记一条日志 —— 与工具栏上没实现的按钮一个待遇：**说出来**，
 *   不假装有反应。
 */

/** 功能编号 —— 下标与 `HOTKEY_NAMES` 一一对应 */
export const HOTKEY = {
  cursorUp: 0,
  cursorRight: 1,
  cursorDown: 2,
  cursorLeft: 3,
  confirm: 4,
  cancel: 5,
  switchOption: 6,
  switchWindowGroup: 7,
  yes: 8,
  no: 9,
  advance: 10,
  chooseDiceCount: 11,
  stockMarket: 12,
  trade: 13,
  cards: 14,
  tools: 15,
  query: 16,
  map: 17,
  rotateLeft: 18,
  rotateRight: 19,
  autoPlay: 20,
  system: 21,
  saveGame: 22,
  loadGame: 23,
  help: 24,
  pageUp: 25,
  pageDown: 26,
  quit: 27,
} as const;

export type HotkeyId = (typeof HOTKEY)[keyof typeof HOTKEY];

/** 一条键位：Windows 虚拟键码 + 修饰键 */
export interface KeyBinding {
  vk: number;
  /** 0x11 = Ctrl @source rich4_cfg.txt */
  mod: number;
}

export const MOD_CTRL = 0x11;

/** @source `Rich4/RICH4.CFG` 的 0x10..0x47 */
export const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  { vk: 0x26, mod: 0 }, // ↑
  { vk: 0x27, mod: 0 }, // →
  { vk: 0x28, mod: 0 }, // ↓
  { vk: 0x25, mod: 0 }, // ←
  { vk: 0x0d, mod: 0 }, // Enter
  { vk: 0x1b, mod: 0 }, // Esc
  { vk: 0x09, mod: 0 }, // Tab
  { vk: 0x09, mod: 0 }, // Tab（原文件里这两条确实一样）
  { vk: 0x59, mod: 0 }, // Y
  { vk: 0x4e, mod: 0 }, // N
  { vk: 0x20, mod: 0 }, // Space
  { vk: 0x44, mod: 0 }, // D
  { vk: 0x57, mod: 0 }, // W
  { vk: 0x58, mod: 0 }, // X
  { vk: 0x43, mod: 0 }, // C
  { vk: 0x45, mod: 0 }, // E
  { vk: 0x46, mod: 0 }, // F
  { vk: 0x4d, mod: 0 }, // M
  { vk: 0xbc, mod: 0 }, // ,  （VK_OEM_COMMA，键面上是 <）
  { vk: 0xbe, mod: 0 }, // .  （VK_OEM_PERIOD，键面上是 >）
  { vk: 0x41, mod: 0 }, // A
  { vk: 0x56, mod: 0 }, // V
  { vk: 0x53, mod: 0 }, // S
  { vk: 0x4c, mod: 0 }, // L
  { vk: 0x48, mod: 0 }, // H
  { vk: 0x21, mod: 0 }, // PgUp
  { vk: 0x22, mod: 0 }, // PgDn
  { vk: 0x51, mod: MOD_CTRL }, // Ctrl+Q
];

/**
 * 浏览器的 `KeyboardEvent` → Windows 虚拟键码。
 *
 * ⚠️ 只覆盖上面用到的那些键。`event.keyCode` 虽然正好就是 VK 码，但它
 *   已经废弃，而且在某些布局下不可靠；`event.code` 是**物理键位**，
 *   与键盘布局无关，正是我们要的。
 */
export function vkOf(e: KeyboardEvent): number | null {
  const c = e.code;
  if (c.startsWith('Key') && c.length === 4) return c.charCodeAt(3); // KeyA → 0x41
  switch (c) {
    case 'ArrowUp': return 0x26;
    case 'ArrowRight': return 0x27;
    case 'ArrowDown': return 0x28;
    case 'ArrowLeft': return 0x25;
    case 'Enter':
    case 'NumpadEnter': return 0x0d;
    case 'Escape': return 0x1b;
    case 'Tab': return 0x09;
    case 'Space': return 0x20;
    case 'Comma': return 0xbc;
    case 'Period': return 0xbe;
    case 'PageUp': return 0x21;
    case 'PageDown': return 0x22;
    default: return null;
  }
}

/**
 * 这一次按键对应哪个功能；没有对应返回 `null`。
 *
 * ⚠️ **带 Ctrl 的键位要先匹配**：`Ctrl+Q` 与单独的 `Q` 是两回事，
 *   而表里前面那些条目的 `mod` 都是 0，先来先得的话 Ctrl+Q 会被当成
 *   没绑定（因为 Q 本身没绑）。这里按「修饰键必须完全一致」来配。
 */
export function hotkeyOf(
  e: KeyboardEvent,
  bindings: readonly KeyBinding[] = DEFAULT_BINDINGS,
): number | null {
  const vk = vkOf(e);
  if (vk === null) return null;
  const wantCtrl = e.ctrlKey || e.metaKey;
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i]!;
    if (b.vk !== vk) continue;
    if ((b.mod === MOD_CTRL) !== wantCtrl) continue;
    return i;
  }
  return null;
}
