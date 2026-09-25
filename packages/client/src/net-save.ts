/*
 * 聯機存檔（v6）—— 遊戲內「儲存進度」在聯機時彈的**取名框**（DOM，本項目自己的界面）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 單機的存讀檔屏是復刻屏（寫本機瀏覽器的格子）；聯機時同一個熱鍵 / 工具列鈕改成
 *   「房主給這份存檔取個名字 → 存到伺服器」。為了能打中文名字用 DOM（canvas 接不了輸入法），
 *   復刻屏一個像素都不動。
 */

import { MAX_SAVE_NAME_CODE_POINTS, sanitizeSaveName } from '@rich4/core';
import { TEXT_ENTRY_FONT_PX } from './text-entry.ts';

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang TC', 'Microsoft JhengHei', sans-serif";

/** 預設的存檔名：「2010 年 3 月 5 日」 */
export function defaultSaveName(d: { year: number; month: number; day: number }): string {
  return `${d.year} 年 ${d.month} 月 ${d.day} 日`;
}

/**
 * 彈一個取名框；按「存檔」resolve 清洗過的名字，按「取消」/ Esc resolve `null`。
 */
export function promptSaveName(defaultName: string, doc: Document = document): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = doc.createElement('div');
    overlay.id = 'netsave';
    overlay.style.cssText = `position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font-family:${FONT};color:#e9eef7`;
    const card = doc.createElement('div');
    card.style.cssText =
      'width:320px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:18px;border-radius:12px;background:#17304f;border:1px solid #2b4a70;box-shadow:0 10px 34px rgba(0,0,0,.45)';
    const title = doc.createElement('div');
    title.textContent = '存到伺服器';
    title.style.cssText = 'font-size:17px;font-weight:700;letter-spacing:2px;color:#f3d27a';
    const hint = doc.createElement('div');
    hint.textContent = '大家之後可以從房間列表「建立房間 → 從存檔繼續」接著玩。';
    hint.style.cssText = 'margin:6px 0 12px;font-size:12px;color:#a9bcd4;line-height:1.5';
    const input = doc.createElement('input');
    input.id = 'netsave-name';
    input.type = 'text';
    input.maxLength = 48;
    input.value = defaultName;
    input.placeholder = `1~${MAX_SAVE_NAME_CODE_POINTS} 個字`;
    // ★ 第二十七份：≥ 16px，iOS Safari 聚焦不自动放大（见 text-entry.ts）
    input.style.cssText = `width:100%;box-sizing:border-box;padding:9px 10px;font:${TEXT_ENTRY_FONT_PX}px/1.4 ${FONT};border-radius:6px;border:1px solid #3a5a83;background:#0e2138;color:#e9eef7`;
    const err = doc.createElement('div');
    err.style.cssText = 'margin-top:6px;font-size:12px;color:#ff9d9d;min-height:1em';
    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px';
    const mk = (text: string, main: boolean): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = main
        ? `padding:9px 16px;font:600 14px ${FONT};border-radius:8px;border:1px solid #b08a2e;background:#7a5a14;color:#fff3d0;cursor:pointer`
        : `padding:9px 16px;font:600 14px ${FONT};border-radius:8px;border:1px solid #3a5a83;background:#22405f;color:#e9eef7;cursor:pointer`;
      return b;
    };
    const cancel = mk('取消', false);
    const ok = mk('存檔', true);
    ok.id = 'netsave-ok';
    row.append(cancel, ok);
    card.append(title, hint, input, err, row);
    overlay.append(card);
    doc.body.append(overlay);

    const done = (v: string | null): void => {
      overlay.remove();
      resolve(v);
    };
    const submit = (): void => {
      const name = sanitizeSaveName(input.value);
      if (name === null) {
        err.textContent = `名字要 1~${MAX_SAVE_NAME_CODE_POINTS} 個字`;
        input.focus();
        return;
      }
      done(name);
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => done(null));
    // ⚠️ 按鍵別冒泡到遊戲的熱鍵上（打字時「S」「L」會觸發存讀檔）
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') submit();
      else if (ev.key === 'Escape') done(null);
    });
    input.focus();
    input.select();
  });
}
