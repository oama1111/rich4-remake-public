/*
 * 一键回报按钮（左下角）—— 接线钉子（需求方 2026-09-22）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const host = readFileSync(new URL('./host.ts', import.meta.url), 'utf8');

describe('一键回报按钮', () => {
  it('index.html 有按钮、面板、说明框与两颗钮', () => {
    for (const id of ['feedback', 'feedbackpanel', 'feedbacknote', 'feedbacksend', 'feedbackcancel']) {
      expect(html).toContain(`id="${id}"`);
    }
    // 面板缺省收起；按钮**不**缺省隐藏（任何一屏都要看得见）
    expect(html).toMatch(/<div id="feedbackpanel" hidden>/);
    expect(html).not.toMatch(/<button id="feedback"[^>]*hidden/);
  });

  it('送出 = 手动回报（带填的那句话），并把面板收起', () => {
    const wired = main.slice(main.indexOf("feedbackSendEl.addEventListener('click'"), main.indexOf("feedbackNoteEl.addEventListener('keydown'"));
    expect(wired).toContain("fileReport('manual', note)");
    expect(wired).toContain('feedbackPanelEl.hidden = true');
  });

  it('★ 网页版先上传（POST /api/feedback）；自动触发的（error / stall）上传不了**不**退回下载', () => {
    expect(host).toContain("fetch('/api/feedback'");
    expect(host).toContain("credentials: 'same-origin'");
    expect(main).toContain("{ fallbackDownload: reason === 'manual' }");
    // 停摆回报不再只限桌面壳
    expect(main).not.toContain("if (isDesktop()) fileReport('stall'");
  });

  it('报告 env 里带上玩家名（服务器拿它起文件名）', () => {
    expect(main).toContain("localStorage.getItem('rich4.name')");
  });
});
