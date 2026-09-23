/*
 * 键盘入口的防御：浏览器自动填充派发的 `keydown` 没有 `code` / `key`
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 2026-09-23 Ruan 的自动回报：标题画面刚进站就抛
 * 「Cannot read properties of undefined (reading 'startsWith')」—— 栈在热键表的
 * `e.code.startsWith('Key')`。Chrome 自动填充账号/密码时派发的 `keydown` 不是 KeyboardEvent。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('window keydown 入口', () => {
  it('★ 第一句就丢掉没有 code/key 的「按键」（自动填充派发的那种）', () => {
    const at = main.indexOf("window.addEventListener('keydown', (e) => {");
    expect(at).toBeGreaterThan(0);
    const body = main.slice(at, at + 600);
    const guard = body.indexOf("if (typeof e.code !== 'string' || typeof e.key !== 'string') return;");
    expect(guard).toBeGreaterThan(0);
    // 必须在任何读 `e.key` / `e.code` 的分支之前
    expect(guard).toBeLessThan(body.indexOf("e.key === 'F9'"));
  });
});
