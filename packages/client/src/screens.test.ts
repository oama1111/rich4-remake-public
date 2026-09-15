/*
 * 整屏登记表的自检
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这份表是**唯一**把各屏挂进 `main.ts` 的地方（契约见 `ui-screen.ts`），
 * 一行写错就是「某一屏永远不上屏」或「两屏抢同一颗钮」。这里只钉**表本身**
 * 的不变量，各屏自己的版式/命中由各自的 `*.test.ts` 钉。
 *
 * ⚠️ 往表里加屏时**不需要**改这里 —— 除非它违反下面某一条不变量
 *   （例如与别的屏共用同一个 `id`、或 `windowed` 与 `draw` 的约定不符）。
 */
import { describe, expect, it } from 'vitest';
import { SCREENS } from './screens.ts';
import { bigMapScreen } from './big-map-screen.ts';

describe('SCREENS 登记表', () => {
  it('`id` 不重复（日志与调试靠它认屏）', () => {
    const ids = SCREENS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  it('每一屏都实现了 `active` 与 `draw`，且 `active` 是纯查询（不抛）', () => {
    for (const s of SCREENS) {
      expect(typeof s.active).toBe('function');
      expect(typeof s.draw).toBe('function');
    }
  });

  it('★ 大地圖彈窗（T-086）在表里，并且声明了「浮窗 + 右键关」这两条契约', () => {
    // 它是一扇 400×400 贴 (20,60) 的**浮窗**（原版 fcn_0040a801 只 Blt 那块），
    // 不是整屏黑底 —— 少了 `windowed` 就会把棋盘与右侧栏涂黑，与实机截图 S6 不符。
    expect(SCREENS).toContain(bigMapScreen);
    expect(bigMapScreen.windowed).toBe(true);
    // 它唯一的出口是右键（原版 WM_RBUTTONUP 0x205）
    expect(typeof bigMapScreen.contextmenu).toBe('function');
    expect(typeof bigMapScreen.hotkey).toBe('function');
  });
});
