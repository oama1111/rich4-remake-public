/*
 * 外来的未处理 rejection（扩展 / 注入脚本的消息桥）不当成本程序的错误
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isExternalRejection } from './external-rejection.ts';

describe('isExternalRejection', () => {
  it('2026-09-24 那份 iPhone 回报：「NoResponse: No response from target」、没有栈 ⇒ 外来', () => {
    expect(isExternalRejection('NoResponse: No response from target', null)).toBe(true);
  });

  it('Chrome 系扩展消息桥的三句、没有栈 ⇒ 外来', () => {
    expect(isExternalRejection('Could not establish connection. Receiving end does not exist.', null)).toBe(true);
    expect(isExternalRejection('The message port closed before a response was received.', null)).toBe(true);
    expect(isExternalRejection('Error: Extension context invalidated.', null)).toBe(true);
  });

  it('有栈就不算（本项目的 Error 一定有栈）—— 哪怕句子一样', () => {
    expect(isExternalRejection('NoResponse: No response from target', 'foo@https://rich4.locoko.com/assets/index.js:1:2')).toBe(false);
  });

  it('只认整句：沾边的、我们自己的错误一律照旧报', () => {
    expect(isExternalRejection('No response from target', null)).toBe(false);
    expect(isExternalRejection('NoResponse: No response from target (seat 2)', null)).toBe(false);
    expect(isExternalRejection('TypeError: Load failed', null)).toBe(false);
    expect(isExternalRejection('undefined', null)).toBe(false);
    expect(isExternalRejection('', null)).toBe(false);
  });

  it('跨 realm 的错误对象走 String(reason) —— 正是「名字: 消息」那一形', () => {
    // 模拟：别的 realm 造的 Error（本 realm 的 instanceof 认不出），main.ts 的总闸会取 String(r)
    const foreign = { name: 'NoResponse', message: 'No response from target', toString: Error.prototype.toString };
    expect(foreign instanceof Error).toBe(false);
    expect(isExternalRejection(String(foreign), null)).toBe(true);
  });
});

describe('源码检查：总闸在落回报之前先过这道滤网', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  it('unhandledrejection 那一支：外来的只记 note + 宿主日志，然后 return（不走 onUncaught）', () => {
    const at = main.indexOf("window.addEventListener('unhandledrejection', (e) => {");
    const body = main.slice(at, main.indexOf('\n  });\n', at));
    const filter = body.indexOf('if (isExternalRejection(message, stack)) {');
    expect(filter).toBeGreaterThan(0);
    expect(body.indexOf("kind: 'note'")).toBeGreaterThan(filter);
    expect(body.indexOf('return;')).toBeGreaterThan(filter);
    expect(body.indexOf("onUncaught('unhandledrejection', message, stack)")).toBeGreaterThan(body.indexOf('return;'));
  });
});
