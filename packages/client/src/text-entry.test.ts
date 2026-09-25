import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEXT_ENTRY_FONT_PX, isTextEntryTarget } from './text-entry.ts';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const foyer = readFileSync(new URL('./foyer.ts', import.meta.url), 'utf8');
const netSave = readFileSync(new URL('./net-save.ts', import.meta.url), 'utf8');

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

describe('★ 第二十七份：文字框字号 ≥ 16px（iPhone Safari 聚焦自动放大、失焦不缩回 ⇒ 画面显示不全）', () => {
  it('常数就是 16', () => {
    expect(TEXT_ENTRY_FONT_PX).toBe(16);
  });
  it('门厅暱稱框、聯機存檔取名框用常数，不再写死 14px', () => {
    expect(foyer).toMatch(/const INPUT = `[^`]*font:\$\{TEXT_ENTRY_FONT_PX\}px/);
    expect(netSave).toMatch(/input\.style\.cssText = `[^`]*font:\$\{TEXT_ENTRY_FONT_PX\}px/);
  });
  it('回報說明框 16px，且有盖过内联样式的兜底规则（文字类 input / textarea / select）', () => {
    const rule = html.slice(html.indexOf('#feedbackpanel textarea {'), html.indexOf('}', html.indexOf('#feedbackpanel textarea {')));
    expect(rule).toMatch(/font-size:\s*16px/);
    expect(html).toMatch(/textarea, select \{ font-size: 16px !important; \}/);
    expect(html).toContain('input:not([type=checkbox]):not([type=radio])');
  });
  it('源码里再没有 < 16px 的文字框字号', () => {
    for (const src of [foyer, netSave]) {
      for (const m of src.matchAll(/(?:INPUT = |input\.style\.cssText = )`([^`]*)`/g)) {
        expect(m[1]).not.toMatch(/font:\s*1[0-5]px/);
      }
    }
  });
});
