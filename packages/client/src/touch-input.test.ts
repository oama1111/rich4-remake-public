/*
 * 触屏的「右键」：长按状态机 / 「此刻右键有没有用」/ 「取消」钮的位置
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CancelSnapshot } from './panel-cancel.ts';
import {
  LONG_PRESS_MS,
  TAP_SLOP_PX,
  TouchGesture,
  cancelButtonPlacement,
  isTouchDevice,
  rightClickMeaningful,
  type RightClickSnapshot,
} from './touch-input.ts';
import { stageMetrics, SCREEN_H, SCREEN_W } from './stage.ts';

const kinds = (out: readonly { kind: string }[]): string[] => out.map((o) => o.kind);

describe('TouchGesture —— 长按 = 右键，点 / 拖照旧是左键', () => {
  it('点一下（< 500 ms、没挪）：抬手时派 移动 → 按下 → 抬起 → click，全在按下点', () => {
    const g = new TouchGesture();
    expect(g.start(1, 100, 200, 0)).toEqual([]);
    expect(g.deadline()).toBe(LONG_PRESS_MS);
    expect(g.due(LONG_PRESS_MS - 1)).toEqual([]);
    const out = g.end(1, 103, 202, 120);
    expect(kinds(out)).toEqual(['move', 'down', 'up', 'click']);
    for (const o of out) expect([o.x, o.y]).toEqual([100, 200]);
    expect(g.deadline()).toBeNull();
    expect(g.active()).toBe(false);
  });

  it('阈值以内的抖动不算拖：仍是点', () => {
    const g = new TouchGesture();
    g.start(1, 50, 50, 0);
    expect(g.move(1, 50 + TAP_SLOP_PX, 50, 40)).toEqual([]);
    expect(g.move(1, 50 + 6, 50 + 6, 80)).toEqual([]); // hypot ≈ 8.5
    expect(kinds(g.end(1, 56, 56, 200))).toEqual(['move', 'down', 'up', 'click']);
  });

  it('按住 500 ms 不动：定时器到点派一次右键；抬手什么都不派（后面那一下点被吞掉）', () => {
    const g = new TouchGesture();
    g.start(7, 300, 240, 1000);
    expect(g.due(1000 + LONG_PRESS_MS - 1)).toEqual([]);
    expect(g.due(1000 + LONG_PRESS_MS)).toEqual([{ kind: 'rightClick', x: 300, y: 240 }]);
    expect(g.deadline()).toBeNull();
    expect(g.due(1000 + 2 * LONG_PRESS_MS)).toEqual([]); // 只派一次
    expect(g.move(7, 360, 300, 1600)).toEqual([]); // 长按之后再挪也不算拖
    expect(g.end(7, 360, 300, 1700)).toEqual([]);
    expect(g.active()).toBe(false);
    // 下一下点完全正常
    g.start(8, 10, 10, 2000);
    expect(kinds(g.end(8, 10, 10, 2050))).toEqual(['move', 'down', 'up', 'click']);
  });

  it('定时器没赶上（抬手时已过 500 ms）：按长按算，不是点', () => {
    const g = new TouchGesture();
    g.start(1, 5, 6, 0);
    expect(g.end(1, 5, 6, LONG_PRESS_MS + 30)).toEqual([{ kind: 'rightClick', x: 5, y: 6 }]);
    // 同理：过了时限才来的第一拍移动也按长按算
    g.start(2, 5, 6, 10_000);
    expect(kinds(g.move(2, 80, 80, 10_000 + LONG_PRESS_MS))).toEqual(['rightClick']);
    expect(g.end(2, 80, 80, 10_000 + LONG_PRESS_MS + 10)).toEqual([]);
  });

  it('挪过阈值 = 拖：那一刻派 移动 → 按下(起点) → 移动；之后逐拍移动；抬手 抬起 → click；不会再变成长按', () => {
    const g = new TouchGesture();
    g.start(1, 100, 100, 0);
    const first = g.move(1, 100 + TAP_SLOP_PX + 1, 100, 50);
    expect(first).toEqual([
      { kind: 'move', x: 100, y: 100 },
      { kind: 'down', x: 100, y: 100 },
      { kind: 'move', x: 111, y: 100 },
    ]);
    expect(g.deadline()).toBeNull();
    expect(g.due(LONG_PRESS_MS * 3)).toEqual([]);
    expect(g.move(1, 180, 100, LONG_PRESS_MS * 3)).toEqual([{ kind: 'move', x: 180, y: 100 }]);
    expect(g.end(1, 190, 100, LONG_PRESS_MS * 4)).toEqual([
      { kind: 'up', x: 190, y: 100 },
      { kind: 'click', x: 190, y: 100 },
    ]);
  });

  it('多指：第二根手指在还没定性时落下 ⇒ 这一轮作废（不点、不长按），全部离开后恢复', () => {
    const g = new TouchGesture();
    g.start(1, 100, 100, 0);
    expect(g.start(2, 200, 100, 30)).toEqual([]);
    expect(g.deadline()).toBeNull();
    expect(g.due(LONG_PRESS_MS * 2)).toEqual([]);
    expect(g.move(1, 50, 100, 600)).toEqual([]);
    expect(g.end(1, 50, 100, 700)).toEqual([]);
    // 还剩一根手指：它也不算
    expect(g.move(2, 300, 100, 750)).toEqual([]);
    expect(g.end(2, 300, 100, 800)).toEqual([]);
    expect(g.active()).toBe(false);
    g.start(3, 1, 1, 1000);
    expect(kinds(g.end(3, 1, 1, 1010))).toEqual(['move', 'down', 'up', 'click']);
  });

  it('多指：拖着的时候多一根手指，多的那根一概不理，拖照常收尾', () => {
    const g = new TouchGesture();
    g.start(1, 0, 0, 0);
    g.move(1, 30, 0, 10);
    expect(g.start(2, 400, 400, 20)).toEqual([]);
    expect(g.move(2, 410, 400, 30)).toEqual([]);
    expect(g.end(2, 410, 400, 40)).toEqual([]);
    expect(g.move(1, 40, 0, 50)).toEqual([{ kind: 'move', x: 40, y: 0 }]);
    expect(kinds(g.end(1, 40, 0, 60))).toEqual(['up', 'click']);
  });

  it('多指：先抬起的若是后落的那根、另一根还在 ⇒ 仍作废，不会把剩下那根当成新的点', () => {
    const g = new TouchGesture();
    g.start(1, 0, 0, 0);
    g.start(2, 50, 0, 10);
    expect(g.end(2, 50, 0, 20)).toEqual([]);
    expect(g.end(1, 0, 0, 30)).toEqual([]);
  });

  it('系统收走触摸（touchcancel）：拖着的只派抬起、不派 click；没定性的什么都不派', () => {
    const g = new TouchGesture();
    g.start(1, 0, 0, 0);
    g.move(1, 20, 20, 10);
    expect(g.cancel(1)).toEqual([{ kind: 'up', x: 20, y: 20 }]);
    g.start(2, 0, 0, 100);
    expect(g.cancel(2)).toEqual([]);
    expect(g.due(100 + LONG_PRESS_MS)).toEqual([]);
    expect(g.active()).toBe(false);
  });
});

// ------------------------------------------------------------

const BASE: CancelSnapshot = {
  screen: 'game',
  overlay: false,
  pick: false,
  dicePick: false,
  atm: false,
  dialog: false,
  amountPage: false,
  optionsSub: false,
  stockPick: false,
  stockDetail: false,
  stockAmount: false,
  stockPage: 0,
  shop: false,
  bail: false,
  loan: false,
  loanReminder: false,
};
const snap = (over: Partial<Omit<RightClickSnapshot, 'cancel'>> & { cancel?: Partial<CancelSnapshot> } = {}): RightClickSnapshot => ({
  tollFlash: over.tollFlash ?? false,
  overlayContextmenu: over.overlayContextmenu ?? null,
  pickCancellable: over.pickCancellable ?? false,
  minimapMarker: over.minimapMarker ?? false,
  cancel: { ...BASE, ...over.cancel },
});

describe('rightClickMeaningful —— 与 contextmenu 处理同一串判据', () => {
  it('棋盘上什么都没开 ⇒ 没东西可取消', () => {
    expect(rightClickMeaningful(snap())).toBe(false);
  });

  it('卡片欄 / 道具欄开着（screen = inventory）⇒ 有', () => {
    expect(rightClickMeaningful(snap({ cancel: { screen: 'inventory' } }))).toBe(true);
  });

  it('目标拾取：可取消的 ⇒ 有；目标必选的（右键被吃掉但不动）⇒ 没有', () => {
    expect(rightClickMeaningful(snap({ cancel: { pick: true }, pickCancellable: true }))).toBe(true);
    expect(rightClickMeaningful(snap({ cancel: { pick: true }, pickCancellable: false }))).toBe(false);
  });

  it('魔法屋开场白（声明了 contextmenu 的整屏、此刻有反应）⇒ 有；念完之后 ⇒ 没有，且不再往下看梯子', () => {
    expect(rightClickMeaningful(snap({ overlayContextmenu: true, cancel: { overlay: true } }))).toBe(true);
    // 整屏在就只看它：底下那份对话框壳子不算（与 contextmenu 处理的「整屏先收、return」一致）
    expect(rightClickMeaningful(snap({ overlayContextmenu: false, cancel: { overlay: true, dialog: true } }))).toBe(false);
  });

  it('整屏在但**没**声明 contextmenu ⇒ 落到梯子（overlay 为真时棋盘对话框不算）', () => {
    expect(rightClickMeaningful(snap({ cancel: { overlay: true, dialog: true } }))).toBe(false);
    expect(rightClickMeaningful(snap({ cancel: { overlay: true, shop: true } }))).toBe(true);
  });

  it('棋盘上的訊息框 / 填数页 / 遙控骰子盘 / ATM ⇒ 有', () => {
    expect(rightClickMeaningful(snap({ cancel: { dialog: true } }))).toBe(true);
    expect(rightClickMeaningful(snap({ cancel: { dialog: true, amountPage: true } }))).toBe(true);
    expect(rightClickMeaningful(snap({ cancel: { dicePick: true } }))).toBe(true);
    expect(rightClickMeaningful(snap({ cancel: { atm: true } }))).toBe(true);
  });

  it('工具列开的各屏（設定 / 存讀檔 / 資產表 / 股市）⇒ 有', () => {
    for (const screen of ['options', 'aiSettings', 'saveload', 'assets', 'stock']) {
      expect(rightClickMeaningful(snap({ cancel: { screen } }))).toBe(true);
    }
  });

  it('過路費闪在播 ⇒ 有（右键跳过它）', () => {
    expect(rightClickMeaningful(snap({ tollFlash: true }))).toBe(true);
  });

  it('小地图标记：只在棋盘上算（梯子之外的最后一档）', () => {
    expect(rightClickMeaningful(snap({ minimapMarker: true }))).toBe(true);
    expect(rightClickMeaningful(snap({ minimapMarker: true, cancel: { screen: 'title' } }))).toBe(false);
  });

  it('標題 / 開局設定屏 ⇒ 没有', () => {
    expect(rightClickMeaningful(snap({ cancel: { screen: 'title' } }))).toBe(false);
    expect(rightClickMeaningful(snap({ cancel: { screen: 'setup' } }))).toBe(false);
  });
});

describe('isTouchDevice', () => {
  it('粗指针或有触点才算', () => {
    expect(isTouchDevice({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isTouchDevice({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 5 } })).toBe(true);
    expect(isTouchDevice({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 0 } })).toBe(false);
    expect(isTouchDevice({})).toBe(false);
  });
});

// ------------------------------------------------------------

/** 与 `main.ts` 同一套算术：画布占满视口，舞台按 `stageMetrics` 居中（dpr 约掉）*/
function layout(w: number, h: number) {
  const m = stageMetrics(w, h);
  const view = { left: 0, top: 0, width: w, height: h };
  const stage = { left: m.offsetX, top: m.offsetY, width: SCREEN_W * m.scale, height: SCREEN_H * m.scale };
  return { view, stage, at: cancelButtonPlacement(view, stage) };
}

describe('cancelButtonPlacement —— 优先放舞台外的黑边', () => {
  it('iPhone 竖屏（390×844）：舞台下方黑边，贴右，整颗在黑边里', () => {
    const { view, stage, at } = layout(390, 844);
    expect(at.mode).toBe('bottom');
    expect(at.top).toBeGreaterThanOrEqual(stage.top + stage.height);
    expect(at.top + at.height).toBeLessThanOrEqual(view.height);
    expect(at.left + at.width).toBeLessThanOrEqual(stage.left + stage.width);
    expect(at.left).toBeGreaterThan(view.width / 2); // 右半边（左下角是「回報問題」）
    expect(at.height).toBeGreaterThanOrEqual(44);
  });

  it.each([
    [1180, 820],
    [1194, 834], // Playwright「iPad Pro 11 landscape」
    [1080, 740], // 4:3 iPad 横放、Safari 工具栏占掉一截
  ])('iPad 横放（%i×%i）：舞台右侧黑边，竖放，整颗在黑边里', (w, h) => {
    const { view, stage, at } = layout(w, h);
    expect(at.mode).toBe('side');
    expect(at.left).toBeGreaterThanOrEqual(stage.left + stage.width);
    expect(at.left + at.width).toBeLessThanOrEqual(view.width);
    expect(at.top + at.height).toBeLessThanOrEqual(stage.top + stage.height);
    expect(at.width).toBeGreaterThanOrEqual(30);
    expect(at.height).toBeGreaterThanOrEqual(44);
  });

  it('4:3 iPad 全屏（1080×810）：一点黑边都没有 ⇒ 压在棋盘角上', () => {
    expect(layout(1080, 810).at.mode).toBe('corner');
  });

  it('横放手机（844×390）：右侧黑边够宽 ⇒ 放侧边', () => {
    expect(layout(844, 390).at.mode).toBe('side');
  });

  it('没黑边（正好 640×480）：半透明小钮压在棋盘区右下角（不压小地图 / 側欄）', () => {
    const { stage, at } = layout(SCREEN_W, SCREEN_H);
    expect(at.mode).toBe('corner');
    expect(at.left).toBeGreaterThanOrEqual(stage.left);
    expect(at.left + at.width).toBeLessThanOrEqual(stage.left + 439);
    expect(at.top + at.height).toBeLessThanOrEqual(stage.top + stage.height);
  });
});

// ------------------------------------------------------------

describe('源码检查：桌面鼠标那一路不变', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const touch = readFileSync(new URL('./touch-input.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  /** 取出 `canvas.addEventListener('contextmenu', …)` 那一整段 */
  const ctxHandler = (() => {
    const at = main.indexOf("canvas.addEventListener('contextmenu', (e) => {");
    const end = main.indexOf('\n  });\n', at);
    return main.slice(at, end);
  })();

  it('右键处理仍是那四档、次序不变：過路費闪 → 声明了 contextmenu 的整屏 → cancelTopPanel 梯子 → 小地图标记', () => {
    expect(ctxHandler.length).toBeGreaterThan(0);
    const order = [
      'if (tollFlash !== null)',
      'overlay?.contextmenu !== undefined',
      'overlay.contextmenu(q.x, q.y, uiEnv())',
      'if (cancelTopPanel())',
      "if (screen !== 'game' || minimapMarker === null) return;",
    ].map((s) => ctxHandler.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // 右键处理本身不认触屏（触屏是**在它之前**把长按变成这一拍的）
    expect(ctxHandler).not.toMatch(/touch|Touch|pointer/);
  });

  it('桌面的 mousedown / mouseup / mousemove / contextmenu 监听不看 touch / pointer；主文件里只多一句 bindTouchGestures(canvas)', () => {
    const bind = main.slice(main.indexOf('function bindInput(): void {'), main.indexOf('\nfunction ', main.indexOf('function bindInput(): void {') + 10));
    expect(bind).not.toMatch(/touch|Touch|pointerType/);
    expect(main.match(/bindTouchGestures\(/g)?.length).toBe(1);
    expect(main).toContain('bindTouchGestures(canvas);');
  });

  it('触屏模块只听 touch* 事件（鼠标从来不发），contextmenu 那道闸只吞「手指在屏上时」系统自己发的那一个', () => {
    const listened = [...touch.matchAll(/addEventListener\(\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(listened.sort()).toEqual(['contextmenu', 'touchcancel', 'touchend', 'touchmove', 'touchstart']);
    expect(touch).toContain('if (synthetic.has(e)) return;');
    expect(touch).toContain('if (!g.active() && now() - lastTouchAt > 1_000) return; // 真鼠标的右键：照旧放行');
  });

  it('「取消」钮 = 在画布上派一次 contextmenu（同一条右键处理），只在触屏且右键有用时露出', () => {
    expect(main).toMatch(/touchCancelEl\.addEventListener\('click'[\s\S]{0,400}dispatchMouse\(canvas, 'contextmenu'/);
    expect(main).toContain('const show = isTouchDevice(window) && rightClickMeaningfulNow();');
    expect(html).toContain('<button id="touchcancel" type="button" hidden>取消</button>');
  });

  it('画布 CSS：不滚动/不缩放、长按不弹 iOS 菜单、不选字', () => {
    const board = html.slice(html.indexOf('#board {'), html.indexOf('}', html.indexOf('#board {')));
    expect(board).toContain('touch-action: none');
    expect(board).toContain('-webkit-touch-callout: none');
    expect(board).toContain('user-select: none');
  });
});

describe('magicScreen.contextmenuLive', () => {
  it('没开窗 ⇒ 右键没反应', async () => {
    const { magicScreen } = await import('./magic-screen.ts');
    expect(magicScreen.contextmenuLive?.({} as never)).toBe(false);
  });
});

// 防呆：舞台尺寸没被改（位置测试依赖 640×480）
it('舞台仍是 640×480', () => {
  expect([SCREEN_W, SCREEN_H]).toEqual([640, 480]);
});
