/*
 * 页面贴住可视区 —— iPad Safari 地址栏遮住工具栏（第十二份試玩回報）
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCREEN_H, SCREEN_W, stageMetrics } from './stage.ts';
import {
  SETTLE_DELAYS_MS,
  ZOOM_RESET_RESTORE_MS,
  applyBox,
  installTextEntryRecovery,
  installViewportFit,
  iosViewportContent,
  isIosWebKit,
  planSettle,
  visibleBox,
  zoomResetViewportContent,
  type VisualViewportLike,
} from './viewport.ts';
import { isTextEntryTarget } from './text-entry.ts';

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
    expect(main).toContain('const refitViewport = installViewportFit(window, document.body.style);');
    expect(main).toContain("window.visualViewport?.addEventListener('resize', requestRender);");
  });
});

// ============================================================
//  ★ 第二十七份：iPhone Safari「输入文字后画面显示不全」
// ============================================================

/** iPhone 横屏（回报：画布 2496×1128 @3x ⇒ 可视区 832×376 CSS） */
const IPHONE = { width: 832, height: 376 };

describe('meta viewport —— iOS 常驻 maximum-scale=1，复位用的内容一定不同', () => {
  it('isIosWebKit：iPhone / iPad / 伪装成 Mac 的 iPadOS 是；Android / 桌面 Mac 不是', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
    expect(isIosWebKit({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true);
    expect(isIosWebKit({ userAgent: mac, maxTouchPoints: 5 })).toBe(true); // iPadOS 桌面版网站
    expect(isIosWebKit({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
    expect(isIosWebKit({ userAgent: android, maxTouchPoints: 5 })).toBe(false);
  });

  it('iosViewportContent 加 maximum-scale=1；已有的上下限先去掉，不重复', () => {
    expect(iosViewportContent('width=device-width, initial-scale=1')).toBe('width=device-width, initial-scale=1, maximum-scale=1');
    expect(iosViewportContent('width=device-width, initial-scale=1, maximum-scale=5, user-scalable=no')).toBe(
      'width=device-width, initial-scale=1, maximum-scale=1',
    );
  });

  it('复位内容与常驻内容不同（iOS 只在内容变了时重新套用 ⇒ 才会把 scale 夹回 1）', () => {
    const base = 'width=device-width, initial-scale=1';
    const ios = iosViewportContent(base);
    expect(zoomResetViewportContent(base)).not.toBe(base);
    expect(zoomResetViewportContent(ios)).not.toBe(ios);
    expect(zoomResetViewportContent(ios)).toContain('maximum-scale=1');
    expect(zoomResetViewportContent(ios)).toContain('minimum-scale=1');
  });

  it('index.html 的 meta 本身不禁缩放（Android / 桌面照旧能双指放大）', () => {
    const meta = /<meta name="viewport" content="([^"]*)"/.exec(html)![1]!;
    expect(meta).not.toMatch(/maximum-scale|user-scalable/);
  });
});

describe('planSettle —— 一次收拾做什么', () => {
  const base = { typing: false, scrollX: 0, scrollY: 0, scale: 1, zoomSuspect: false };
  it('打完字：还卷着、还放大着 ⇒ 卷回 + 复位缩放', () => {
    expect(planSettle({ ...base, scrollY: 90, scale: 1.6, zoomSuspect: true })).toEqual({ scrollToOrigin: true, resetZoom: true });
  });
  it('焦点还在文字框（跳到下一个框 / 键盘又起来）⇒ 什么都不做', () => {
    expect(planSettle({ ...base, typing: true, scrollY: 90, scale: 1.6, zoomSuspect: true })).toEqual({
      scrollToOrigin: false,
      resetZoom: false,
    });
  });
  it('玩家自己双指放大（不是打字引起）⇒ 不复位', () => {
    expect(planSettle({ ...base, scale: 2, zoomSuspect: false }).resetZoom).toBe(false);
  });
  it('桌面 / Android：没卷、没放大 ⇒ 什么都不做', () => {
    expect(planSettle({ ...base, zoomSuspect: true })).toEqual({ scrollToOrigin: false, resetZoom: false });
    expect(planSettle({ ...base, scale: null, zoomSuspect: true })).toEqual({ scrollToOrigin: false, resetZoom: false });
  });
});

describe('installTextEntryRecovery —— 失焦 / 转向后收拾回整块舞台', () => {
  /** 同一事件可挂多个监听（installViewportFit 与恢复逻辑都挂 visualViewport 的 resize） */
  function multi() {
    const m = new Map<string, (() => void)[]>();
    return {
      add: (t: string, cb: () => void) => void m.set(t, [...(m.get(t) ?? []), cb]),
      get: (t: string) => () => (m.get(t) ?? []).forEach((cb) => cb()),
      has: (t: string) => m.has(t),
    };
  }

  /** 按 iOS Safari 的行为驱动的假窗口：meta 改成含 maximum-scale=1 的新内容 ⇒ scale 夹回 1 */
  function iosSim() {
    const vv = { width: IPHONE.width, height: IPHONE.height, offsetTop: 0, offsetLeft: 0, scale: 1 };
    const vvListeners = multi();
    const winListeners = multi();
    const docListeners = new Map<string, (e: { target: EventTarget | null }) => void>();
    const timers: { at: number; cb: () => void }[] = [];
    let now = 0;
    const scrolls: [number, number][] = [];
    let metaContent = 'width=device-width, initial-scale=1';
    const meta = {
      get content() {
        return metaContent;
      },
      set content(c: string) {
        const changed = c !== metaContent;
        metaContent = c;
        if (changed && /maximum-scale=1\b/.test(c) && vv.scale !== 1) {
          vv.scale = 1;
          vv.width = IPHONE.width;
          vv.height = IPHONE.height;
          vv.offsetLeft = 0;
          vv.offsetTop = 0;
          vvListeners.get('resize')();
        }
      },
    };
    const win = {
      scrollX: 0,
      scrollY: 0,
      visualViewport: Object.assign(vv, { addEventListener: vvListeners.add }),
      addEventListener: winListeners.add,
      scrollTo(x: number, y: number) {
        scrolls.push([x, y]);
        this.scrollX = x;
        this.scrollY = y;
      },
      setTimeout: (cb: () => void, ms: number) => timers.push({ at: now + ms, cb }),
    };
    const doc = {
      activeElement: null as unknown,
      addEventListener: (t: string, cb: (e: { target: EventTarget | null }) => void) => docListeners.set(t, cb),
    };
    const advance = (ms: number) => {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (next === undefined || next.at > end) break;
        timers.shift();
        now = next.at;
        next.cb();
      }
      now = end;
    };
    return { vv, win, doc, meta, scrolls, advance, vvListeners, winListeners, docListeners, getMeta: () => metaContent };
  }

  const textarea = { tagName: 'TEXTAREA' } as unknown as EventTarget;
  const canvas = { tagName: 'CANVAS' } as unknown as EventTarget;

  function install(sim: ReturnType<typeof iosSim>) {
    const style = { top: '', left: '', width: '', height: '' };
    let renders = 0;
    const refitBox = installViewportFit(sim.win, style);
    installTextEntryRecovery({
      win: sim.win,
      doc: sim.doc,
      meta: sim.meta,
      isTextEntry: (t) => isTextEntryTarget(t as EventTarget | null),
      refit: () => {
        refitBox();
        renders++;
      },
    });
    return { style, renders: () => renders };
  }

  /** 聚焦 13px 的框：iOS 放大 1.6×、键盘升起、文档卷上去 90px；失焦：键盘收起但 scale / 卷动都留着 */
  function typeAndBlur(sim: ReturnType<typeof iosSim>) {
    sim.doc.activeElement = textarea;
    Object.assign(sim.vv, { scale: 1.6, width: IPHONE.width / 1.6, height: (IPHONE.height - 150) / 1.6, offsetLeft: 7 });
    sim.win.scrollY = 90;
    sim.vvListeners.get('resize')();
    sim.doc.activeElement = canvas;
    sim.docListeners.get('focusout')!({ target: textarea });
    Object.assign(sim.vv, { width: IPHONE.width / 1.6, height: IPHONE.height / 1.6 });
    sim.vvListeners.get('resize')();
  }

  it('★ 回报的场景：打完字失焦 ⇒ 卷回原点、scale 夹回 1、页面重钉成整块 832×376、舞台整块看得见', () => {
    const sim = iosSim();
    const fit = install(sim);
    typeAndBlur(sim);
    // 修之前就停在这里：放大着 ⇒ visibleBox 不跟、页面矩形被清空
    expect(fit.style.width).toBe('');
    sim.advance(Math.max(...SETTLE_DELAYS_MS));
    expect(sim.scrolls).toContainEqual([0, 0]);
    expect(sim.win.scrollY).toBe(0);
    expect(sim.vv.scale).toBe(1);
    expect(fit.style).toEqual({ top: '0px', left: '0px', width: '832px', height: '376px' });
    expect(fit.renders()).toBeGreaterThanOrEqual(SETTLE_DELAYS_MS.length);
    const edges = stageEdges(IPHONE.width, IPHONE.height, 3);
    expect(edges.top).toBeGreaterThanOrEqual(0);
    expect(edges.bottom).toBeLessThanOrEqual(IPHONE.height);
    // meta 复位招过一会儿改回原样（Android / 桌面的双指缩放不被常驻禁掉）
    sim.advance(ZOOM_RESET_RESTORE_MS);
    expect(sim.getMeta()).toBe('width=device-width, initial-scale=1');
  });

  it('焦点跳到另一个文字框（门厅 → 下一个框）⇒ 不卷、不复位，键盘还升着就贴住缩小的可视区', () => {
    const sim = iosSim();
    const fit = install(sim);
    sim.doc.activeElement = textarea;
    Object.assign(sim.vv, { height: 226 });
    sim.win.scrollY = 40;
    sim.docListeners.get('focusout')!({ target: textarea }); // 焦点仍在（另一个）文字框
    sim.advance(1000);
    expect(sim.scrolls).toEqual([]);
    expect(fit.style.height).toBe('226px');
  });

  it('转向（横 → 竖 → 横）：没在打字 ⇒ 补几次重钉，最终按新可视区', () => {
    const sim = iosSim();
    const fit = install(sim);
    Object.assign(sim.vv, { width: 376, height: 832 });
    sim.winListeners.get('orientationchange')();
    // iOS 转向事件来时尺寸常常还是旧的，过一会儿才对
    Object.assign(sim.vv, { width: IPHONE.width, height: IPHONE.height });
    sim.advance(1000);
    expect(fit.style).toEqual({ top: '0px', left: '0px', width: '832px', height: '376px' });
  });

  it('打字放大后没失焦就转向（失焦的事件被吞了）：转向那几次也会复位', () => {
    const sim = iosSim();
    const fit = install(sim);
    typeAndBlur(sim);
    sim.winListeners.get('orientationchange')();
    sim.advance(1000);
    expect(sim.vv.scale).toBe(1);
    expect(fit.style.width).toBe('832px');
  });

  it('玩家自己双指放大（没有文字框失焦过）⇒ 转向也不复位、不卷', () => {
    const sim = iosSim();
    install(sim);
    Object.assign(sim.vv, { scale: 2, width: 416, height: 188 });
    sim.vvListeners.get('resize')();
    sim.winListeners.get('orientationchange')();
    sim.advance(1000);
    expect(sim.vv.scale).toBe(2);
    expect(sim.getMeta()).toBe('width=device-width, initial-scale=1');
  });

  it('键盘收着时可视区一变，残留的卷动归零；正在打字时不抢', () => {
    const sim = iosSim();
    install(sim);
    sim.doc.activeElement = textarea;
    sim.win.scrollY = 90;
    sim.vvListeners.get('resize')();
    expect(sim.scrolls).toEqual([]);
    sim.doc.activeElement = canvas;
    sim.vvListeners.get('resize')();
    expect(sim.scrolls).toEqual([[0, 0]]);
  });

  it('桌面：失焦只重钉一下，不卷、不动 meta', () => {
    const sim = iosSim();
    const fit = install(sim);
    sim.docListeners.get('focusout')!({ target: textarea });
    sim.advance(1000);
    expect(sim.scrolls).toEqual([]);
    expect(sim.getMeta()).toBe('width=device-width, initial-scale=1');
    expect(fit.style.width).toBe('832px');
  });

  it('接线：main.ts 装上恢复逻辑，iOS 上改 meta，refit 后排一帧', () => {
    expect(main).toContain('installTextEntryRecovery({');
    expect(main).toMatch(/isIosWebKit\(navigator\)\) viewportMeta\.content = iosViewportContent\(viewportMeta\.content\)/);
    const at = main.indexOf('installTextEntryRecovery({');
    expect(main.slice(at, at + 400)).toMatch(/refitViewport\(\);\s*requestRender\(\);/);
  });
});
