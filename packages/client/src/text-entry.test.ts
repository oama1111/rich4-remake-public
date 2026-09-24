import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTextEntryTarget } from './text-entry.ts';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('isTextEntryTarget（需求方 2026-09-24「输入昵称时有些字母输不进去」）', () => {
  it('文字类 input / textarea / select / contenteditable ⇒ 真', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'input', type: 'search' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });
  it('按钮 / 复选框 / 画布 / window ⇒ 假', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'button' } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget({} as EventTarget)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
  it('★ 全局 keydown：在 F9 之后、任何熱鍵 / 填数窗 / ATM 之前就放行输入框', () => {
    const at = main.indexOf("window.addEventListener('keydown', (e) => {");
    const body = main.slice(at, at + 6000);
    const guard = body.indexOf('if (isTextEntryTarget(e.target)) return;');
    expect(guard).toBeGreaterThan(body.indexOf("e.key === 'F9'"));
    expect(guard).toBeLessThan(body.indexOf('unlockAudio();'));
    expect(guard).toBeLessThan(body.indexOf('hotkeyOf(e,'));
  });
});
