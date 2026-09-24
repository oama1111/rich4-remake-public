/*
 * 键盘事件是不是落在「正在打字的地方」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 需求方 2026-09-24：「输入昵称时有些字母输不进去」—— 全局 keydown 把熱鍵表里的字母
 * （S 存檔 / C / M / H …）当熱鍵吞掉了。凡是目标是文字输入框的按键，游戏一概不收。
 */

/**
 * 键盘事件的目标是不是一个**正在打字的地方**（`<input>` 文字类、`<textarea>`、`contenteditable`）。
 * 按钮 / 复选框这类 `<input>` 不算（它们不接字母）。
 */
export function isTextEntryTarget(t: EventTarget | null): boolean {
  if (t === null || typeof t !== 'object') return false;
  const el = t as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
}

