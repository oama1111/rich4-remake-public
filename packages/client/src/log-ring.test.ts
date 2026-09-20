/*
 * F9 报告里的日志环
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { LOG_RING_MAX, LogRing } from './log-ring.ts';

describe('LogRing —— F9 报告里的「出事前那几行」', () => {
  it('顺序与时间一致（最老在前）', () => {
    const r = new LogRing();
    r.push('a');
    r.push('b');
    expect(r.toArray()).toEqual(['a', 'b']);
  });

  it('★ 长度恒定：超了就把最老的挤掉', () => {
    const r = new LogRing();
    for (let i = 0; i < LOG_RING_MAX + 25; i++) r.push(`線${i}`);
    expect(r.size).toBe(LOG_RING_MAX);
    expect(r.toArray()[0]).toBe('線25');
    expect(r.toArray().at(-1)).toBe(`線${LOG_RING_MAX + 24}`);
  });

  it('★ 不会把 `toArray()` 的返回值接到内部状态上（报告要快照）', () => {
    const r = new LogRing();
    r.push('a');
    const snap = r.toArray();
    snap.push('污染');
    expect(r.toArray()).toEqual(['a']);
  });

  it('clear() 之后为空（换局不把上一局的日志带进报告）', () => {
    const r = new LogRing();
    r.push('a');
    r.clear();
    expect(r.toArray()).toEqual([]);
  });
});
