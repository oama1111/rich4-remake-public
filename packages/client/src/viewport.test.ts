/*
 * 页面贴住可视区 —— iPad Safari 地址栏遮住工具栏（第十二份試玩回報）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_H, SCREEN_W, stageMetrics } from './stage.ts';
import { applyBox, installViewportFit, visibleBox, type VisualViewportLike } from './viewport.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

/** iPad（横放）Safari：地址栏展开时看得见 1180×746；收起时 `100vh` = 1180×800 */
const IPAD_VISIBLE = { width: 1180, height: 746 };
const IPAD_100VH = 800;
const IPAD_DPR = 2;

/** 舞台在「看得见的那块」里的上下沿（CSS 像素）；画布高 `canvasCss`，从可视区顶端量起 */
function stageEdges(canvasCssW: number, canvasCssH: number, dpr: number): { top: number; bottom: number } {
  const m = stageMetrics(canvasCssW * dpr, canvasCssH * dpr);
  return { top: m.offsetY / dpr, bottom: (m.offsetY + SCREEN_H * m.scale) / dpr };
}

describe('visibleBox —— 看得见的那块', () => {
  it('没缩放 ⇒ 就是 visualViewport 那块矩形', () => {
    const vv: VisualViewportLike = { width: 1180, height: 746, offsetTop: 0, offsetLeft: 0, scale: 1 };
    expect(visibleBox(vv)).toEqual({ top: 0, left: 0, width: 1180, height: 746 });
  });

  it('可视区被卷过（软键盘推上去）⇒ 跟着 offsetTop 走', () => {
    const vv: VisualViewportLike = { width: 1180, height: 400, offsetTop: 346, offsetLeft: 0, scale: 1 };
    expect(visibleBox(vv)).toEqual({ top: 346, left: 0, width: 1180, height: 400 });
  });

  it('双指放大 ⇒ 不跟（交回 CSS 的 inset: 0）', () => {
    expect(visibleBox({ width: 590, height: 373, offsetTop: 100, offsetLeft: 50, scale: 2 })).toBeNull();
  });

  it('没有 visualViewport / 尺寸为 0 ⇒ 交回 CSS', () => {
    expect(visibleBox(null)).toBeNull();
    expect(visibleBox(undefined)).toBeNull();
    expect(visibleBox({ width: 0, height: 0, offsetTop: 0, offsetLeft: 0, scale: 1 })).toBeNull();
  });
});

describe('★ iPad Safari：整块 640×480 落在可视区里', () => {
  it('旧做法（画布 = 100vh）舞台跑出可视区；新做法（画布 = visualViewport）整块在里面', () => {
    // 旧：画布比可视区高 54px ⇒ 舞台下沿在可视区外（再被拖着卷上去，上沿的工具栏就进了地址栏底下）
    const before = stageEdges(IPAD_VISIBLE.width, IPAD_100VH, IPAD_DPR);
    expect(before.bottom).toBeGreaterThan(IPAD_VISIBLE.height);

    const box = visibleBox({ ...IPAD_VISIBLE, offsetTop: 0, offsetLeft: 0, scale: 1 });
    expect(box).not.toBeNull();
    const after = stageEdges(box!.width, box!.height, IPAD_DPR);
    expect(after.top).toBeGreaterThanOrEqual(0);
    expect(after.bottom).toBeLessThanOrEqual(IPAD_VISIBLE.height);
  });

  it('桌面（visualViewport = 窗口）不受影响：与直接按窗口算的一样', () => {
    const box = visibleBox({ width: 1440, height: 748, offsetTop: 0, offsetLeft: 0, scale: 1 })!;
    expect(stageMetrics(box.width * 2, box.height * 2)).toEqual(stageMetrics(2880, 1496));
    const m = stageMetrics(2880, 1496);
    expect(m.offsetY + SCREEN_H * m.scale).toBeLessThanOrEqual(1496);
    expect(m.offsetX + SCREEN_W * m.scale).toBeLessThanOrEqual(2880);
  });
});

describe('installViewportFit —— 立刻钉一次，可视区一变就重钉', () => {
  function fakeHost(vv: { width: number; height: number; offsetTop: number; offsetLeft: number; scale: number } | null) {
    const winListeners = new Map<string, () => void>();
    const vvListeners = new Map<string, () => void>();
    const visualViewport =
      vv === null ? null : Object.assign(vv, { addEventListener: (t: string, cb: () => void) => vvListeners.set(t, cb) });
    return {
      host: { visualViewport, addEventListener: (t: string, cb: () => void) => winListeners.set(t, cb) },
      vv: visualViewport,
      winListeners,
      vvListeners,
    };
  }

  it('装上就写进 style；地址栏收起（visualViewport resize）⇒ 重写并叫 onChange', () => {
    const f = fakeHost({ width: 1180, height: 746, offsetTop: 0, offsetLeft: 0, scale: 1 });
    const style = { top: '', left: '', width: '', height: '' };
    let changes = 0;
    installViewportFit(f.host, style, () => changes++);
    expect(style).toEqual({ top: '0px', left: '0px', width: '1180px', height: '746px' });
    expect(changes).toBe(0);

    f.vv!.height = 800;
    f.vvListeners.get('resize')!();
    expect(style.height).toBe('800px');
    expect(changes).toBe(1);

    // 可视区平移、窗口 resize、转向 —— 都挂上了
    expect([...f.vvListeners.keys()].sort()).toEqual(['resize', 'scroll']);
    expect([...f.winListeners.keys()].sort()).toEqual(['orientationchange', 'resize']);
  });

  it('双指放大后 ⇒ 清掉内联尺寸，退回样式表', () => {
    const f = fakeHost({ width: 1180, height: 746, offsetTop: 0, offsetLeft: 0, scale: 1 });
    const style = { top: '', left: '', width: '', height: '' };
    installViewportFit(f.host, style);
    f.vv!.scale = 2;
    f.vvListeners.get('scroll')!();
    expect(style).toEqual({ top: '', left: '', width: '', height: '' });
  });

  it('没有 visualViewport 的旧浏览器：只挂窗口事件，style 不动', () => {
    const f = fakeHost(null);
    const style = { top: '', left: '', width: '', height: '' };
    installViewportFit(f.host, style);
    expect(style).toEqual({ top: '', left: '', width: '', height: '' });
    expect(f.winListeners.has('resize')).toBe(true);
  });

  it('applyBox(null) 清空', () => {
    const style = { top: '1px', left: '2px', width: '3px', height: '4px' };
    applyBox(style, null);
    expect(style).toEqual({ top: '', left: '', width: '', height: '' });
  });
});

describe('接线钉子', () => {
  const bodyRule = html.slice(html.indexOf('      body {'), html.indexOf('}', html.indexOf('      body {')));

  it('★ body 不再用 100vh 定高，改为固定定位贴满视口', () => {
    expect(bodyRule).not.toMatch(/height:\s*100vh/);
    expect(bodyRule).toMatch(/position:\s*fixed/);
    expect(bodyRule).toMatch(/top:\s*0/);
    expect(bodyRule).toMatch(/bottom:\s*0/);
    // 整页任何地方都不该再有 100vh 定高
    expect(html).not.toMatch(/height:\s*100vh/);
  });

  it('main.ts 在模块顶层装上 installViewportFit，并在 visualViewport resize 时排一帧', () => {
    expect(main).toContain('installViewportFit(window, document.body.style);');
    expect(main).toContain("window.visualViewport?.addEventListener('resize', requestRender);");
  });
});
