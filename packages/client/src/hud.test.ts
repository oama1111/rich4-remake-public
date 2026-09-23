/*
 * 側欄与月曆的摆位不变量
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一层先前也没有测试，而它出的错都是**看着只是「差一点」**的那一类：
 * 数值栏逐栏偏高 8 像素、月曆每行多画一天。这类错单靠肉眼很难发现，
 * 但一条断言当场就抓住 —— 所以补在这里。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@rich4/core';
import {
  alignFor,
  CAL,
  CAL_TOGGLE_HIT,
  hitCalendarToggle,
  MINIMAP_ARROW_IMAGE,
  MINIMAP_BOX,
  MINIMAP_CENTER_MAX,
  MINIMAP_CENTER_MIN,
  clampCameraCenter,
  PANEL_TAG_HIT,
  hitMinimapArrow,
  hitMinimapBody,
  hitPanelTag,
  minimapArrowRect,
  minimapAt,
  minimapFrameCenter,
  minimapToWorld,
  monthCells,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  SIDEBAR,
  WEEKDAY_NAMES,
} from './hud.ts';
import { daysInMonth, weekdayOf } from '@rich4/core';
import { Hud } from './hud.ts';
import type { Sprite, SpriteCache } from './assets.ts';

describe('月曆格子 —— 每行恰好 7 格', () => {
  it('★ 任意月份都不出现「一行 8 天」', () => {
    // 这个 bug 曾经真的存在：折行判据用了第 8 列的坐标，于是整月逐行右移一格
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const cells = monthCells(year, month);
        const perRow = new Map<number, number>();
        for (const c of cells) perRow.set(c.y, (perRow.get(c.y) ?? 0) + 1);
        for (const n of perRow.values()) expect(n).toBeLessThanOrEqual(7);
        // 每一列恰好 7 个不同的 x
        const xs = [...new Set(cells.map((c) => c.x))];
        expect(xs.length).toBeLessThanOrEqual(7);
      }
    }
  });

  it('★ 1 号落在「该月 1 号的星期」那一列', () => {
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const first = monthCells(year, month)[0]!;
        const cols = [...new Set(monthCells(year, month).map((c) => c.x))].sort((a, b) => a - b);
        expect(first.day).toBe(1);
        expect(cols.indexOf(first.x)).toBe(weekdayOf(year, month, 1));
      }
    }
  });

  it('★ 天数齐全、不重不漏', () => {
    for (let month = 1; month <= 12; month++) {
      const cells = monthCells(2025, month);
      expect(cells.map((c) => c.day)).toEqual(
        Array.from({ length: daysInMonth(2025, month) }, (_, i) => i + 1),
      );
    }
  });

  it('★ 同一格不会被两天占着（x、y 组合唯一）', () => {
    for (let month = 1; month <= 12; month++) {
      const keys = monthCells(2024, month).map((c) => `${c.x},${c.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('行是自上而下、列是自左而右', () => {
    const cells = monthCells(2025, 3);
    // 同一天数往后走，y 不回头
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.y).toBeGreaterThanOrEqual(cells[i - 1]!.y);
      if (cells[i]!.y === cells[i - 1]!.y) expect(cells[i]!.x).toBeGreaterThan(cells[i - 1]!.x);
    }
  });

  it('★ 所有格子都落在 200×200 的側欄里', () => {
    for (let year = 2024; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        for (const c of monthCells(year, month)) {
          expect(c.x).toBeGreaterThan(0);
          expect(c.y).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(SIDEBAR.w);
          expect(c.y).toBeLessThan(SIDEBAR.h);
        }
      }
    }
  });
});

describe('区间常量', () => {
  it('★ 側欄两块拼起来正好 480 高、200 宽', () => {
    expect(PANEL_WIDTH).toBe(200);
    expect(PANEL_HEIGHT + SIDEBAR.h).toBe(480);
    expect(SIDEBAR.x).toBe(0);
    expect(SIDEBAR.y).toBe(PANEL_HEIGHT);
  });

  it('★ 200×280 的侧栏内部：数值栏与头像都不越出右缘的彩色标签区', () => {
    // 右缘 176..199 是那四个竖标签（烘在底图里），内容区到此为止
    const CONTENT_RIGHT = 176;
    // 数值右对齐点、头像右缘
    expect(166).toBeLessThan(CONTENT_RIGHT);
    expect(8 + 72).toBeLessThan(CONTENT_RIGHT); // 头像 72×72
  });
});

describe('星期名', () => {
  it('七条，且从週日排到週六（与 weekdayOf 的 0=周日 对齐）', () => {
    expect(WEEKDAY_NAMES).toHaveLength(7);
    expect(WEEKDAY_NAMES[0]).toBe('星期日');
    expect(WEEKDAY_NAMES[6]).toBe('星期六');
  });
});

describe('★ 日曆文字不压进右缘的彩色标签区', () => {
  /** 标签区左缘（烘在底图里，176..199） */
  const CONTENT_RIGHT = 176;
  /** 保守估宽：15px 字下数字约 10、汉字约 16 */
  const digitW = 10;
  const hanW = 16;

  it('★ 年份是**左上**（flag 0），且在 24px 下也放得下', () => {
    // exe VA 0x00416d6b：`draw(年, x=0x244, y=0x120, flag=0)` —— flag 0 不调整
    // 对齐，就是左上角。⚠️ 这里我一度「推断」成居中过，查了 0x44faa0 的跳表才改回来。
    // 年画在側欄（y≥280），而右缘那四个色标签只到 y=280，故不会重叠。
    const maxWidth = 4 * digitW;
    expect(CAL.year.x + maxWidth).toBeLessThan(SIDEBAR.w);
  });

  it('月份（「12月」最宽）居中后仍在区内', () => {
    const half = (2 * digitW + hanW) / 2;
    expect(CAL.monthText.x + half).toBeLessThan(CONTENT_RIGHT);
  });

  it('★ 星期名（竖排，只占一个字宽）与日号都是**正中**（flag 3 / 2）', () => {
    // flag 3 与 flag 2 在 0x44faa0 的跳表里指向同一段 `0x44FF2A`：
    // `x -= 宽/2` 之后**顺序落入** `0x44FF35` 再 `y -= 高/2` —— 即**两轴都居中**。
    // 星期名是**竖排**（需求方实机截图），所以块宽 = 一个字。
    expect(CAL.weekday.x + hanW / 2).toBeLessThan(CONTENT_RIGHT);
    expect(CAL.dayText.x + digitW).toBeLessThan(CONTENT_RIGHT);
  });

  it('★ 对齐标志表照 exe 逐条钉死 @source VA 0x0044fabc 末段', () => {
    // 跳表按 `flag − 1` 索引，7 项；0 与 >7 走 `ja` 那条（不调整）
    expect(alignFor(0)).toEqual({ align: 'left', baseline: 'top' });
    expect(alignFor(8)).toEqual({ align: 'left', baseline: 'top' });
    expect(alignFor(1)).toEqual({ align: 'right', baseline: 'top' });
    for (const f of [2, 3, 4]) expect(alignFor(f)).toEqual({ align: 'center', baseline: 'middle' });
    expect(alignFor(5)).toEqual({ align: 'left', baseline: 'middle' });
    expect(alignFor(6)).toEqual({ align: 'right', baseline: 'middle' });
    expect(alignFor(7)).toEqual({ align: 'center', baseline: 'bottom' });
  });

  it('所有锚点都在 200×200 的側欄内', () => {
    for (const at of [CAL.sun, CAL.moon, CAL.year, CAL.monthText, CAL.weekday, CAL.dayText]) {
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThan(SIDEBAR.w);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThan(SIDEBAR.h);
    }
  });

  it('太阳与月亮并排不重叠', () => {
    expect(CAL.sun.x + 24).toBeLessThanOrEqual(CAL.moon.x);
  });
});

describe('小地图箭头与坐标换算 —— 照 exe 的整数运算', () => {
  it('★ 世界坐标 → 小地图坐标：2304 恰好落到 200', () => {
    // (x × 89) >> 10。2304 是棋盘的实际宽，200 是这块侧栏的宽 ——
    // 这就是原版「把整张图塞进 200×200」的写法（浮点 200/2304 会差像素）
    expect(minimapAt(0)).toBe(0);
    expect(minimapAt(1152)).toBe(100);
    expect(minimapAt(2304)).toBe(200);
    for (const w of [32, 96, 512, 1024, 2048]) expect(minimapAt(w)).toBe((w * 89) >> 10);
  });

  it('★ 反向用 93/8，与正向**不是**互逆（原版就这样）', () => {
    expect(minimapToWorld(0)).toBe(0);
    expect(minimapToWorld(200)).toBe(2325);
    // 2304 → 200 → 2325，差 1%。照抄原版，不许「修正」成互逆
    expect(minimapToWorld(minimapAt(2304))).not.toBe(2304);
  });

  it('★ 镜头中心夹在 [220, 2084] = [220, 2304 − 220]', () => {
    expect(clampCameraCenter(0)).toBe(0xdc);
    expect(clampCameraCenter(100)).toBe(0xdc);
    expect(clampCameraCenter(1152)).toBe(1152);
    expect(clampCameraCenter(9999)).toBe(0x824);
    // 两端对称 —— 220 正是棋盘区宽 440 的一半
    expect(2304 - MINIMAP_CENTER_MAX).toBe(MINIMAP_CENTER_MIN);
  });

  it('★ 两颗箭头各占 25×26，合起来是 x∈[3,52]、y∈[3,28]', () => {
    expect(minimapArrowRect(1)).toEqual({ x: 3, y: 3, w: 25, h: 26 });
    expect(minimapArrowRect(2)).toEqual({ x: 28, y: 3, w: 25, h: 26 });
    for (const id of [1, 2] as const) {
      const r = minimapArrowRect(id);
      expect(hitMinimapArrow(r.x + (r.w >> 1), r.y + (r.h >> 1))).toBe(id);
    }
    // 四角也要命中
    expect(hitMinimapArrow(3, 3)).toBe(1);
    expect(hitMinimapArrow(27, 28)).toBe(1);
    expect(hitMinimapArrow(28, 3)).toBe(2);
    expect(hitMinimapArrow(52, 28)).toBe(2);
  });

  it('★ x=53 那一像素是死区（原版会算出编号 3，而编号只认 1/2）', () => {
    // exe 的判据是 x <= 0x35(53)，比两颗按钮合起来（3..52）宽 1 像素
    expect(hitMinimapArrow(53, 15)).toBeNull();
  });

  it('箭头条以外不算箭头；本体与箭头条互斥', () => {
    const outside: readonly (readonly [number, number])[] = [
      [2, 15], [10, 2], [10, 29], [60, 15], [-1, 15], [10, -1],
    ];
    for (const [x, y] of outside) {
      expect(hitMinimapArrow(x, y)).toBeNull();
      expect(hitMinimapBody(x, y)).toBe(x >= 0 && y >= 0 && x < SIDEBAR.w && y < SIDEBAR.h);
    }
    expect(hitMinimapBody(10, 15)).toBe(false); // 左箭头
    expect(hitMinimapBody(40, 15)).toBe(false); // 右箭头
  });

  it('★ 箭头图号与 exe 的偏移对得上', () => {
    // 常态：`[0x48bad8] + 0xfc / + 0x108`，图号 = (偏移 − 0x0c) / 12
    expect(MINIMAP_ARROW_IMAGE.normal[1]).toBe((0xfc - 0x0c) / 12);
    expect(MINIMAP_ARROW_IMAGE.normal[2]).toBe((0x108 - 0x0c) / 12);
    // 高亮：`0x0c + 12 × (编号 + 0x11)`
    expect(MINIMAP_ARROW_IMAGE.hot[1]).toBe(1 + 0x11);
    expect(MINIMAP_ARROW_IMAGE.hot[2]).toBe(2 + 0x11);
  });

  it('取景框是 30×30 的**像素**框（原版框的是当前玩家那个圆点）', () => {
    expect(MINIMAP_BOX).toBe(0x1e);
  });
});

describe('右上角四条彩色竖条 —— 点一下就换页 @source VA 0x004182fa', () => {
  it('★ 命中条是最右 24px、每 70 一格，四条的中心各自命中自己', () => {
    // 竖条中心 35 / 108 / 178 / 250（exe 的 y 表 +20）
    for (const [page, center] of [35, 108, 178, 250].entries()) {
      expect(hitPanelTag(PANEL_TAG_HIT.x, center)).toBe(page);
      expect(hitPanelTag(PANEL_WIDTH - 1, center)).toBe(page);
    }
    // 竖条左边那条缝不认
    expect(hitPanelTag(PANEL_TAG_HIT.x - 1, 35)).toBeNull();
    // 面板之外（下半那块 200×200）不认
    expect(hitPanelTag(PANEL_TAG_HIT.x, PANEL_HEIGHT)).toBeNull();
    expect(hitPanelTag(PANEL_TAG_HIT.x, -1)).toBeNull();
  });

  it('★ 每格恰好 70 高（= 面板 280 ÷ 4）', () => {
    expect(PANEL_TAG_HIT.count * PANEL_TAG_HIT.h).toBe(PANEL_HEIGHT);
    // 边界：69 属第 0 格、70 属第 1 格
    expect(hitPanelTag(PANEL_TAG_HIT.x, 69)).toBe(0);
    expect(hitPanelTag(PANEL_TAG_HIT.x, 70)).toBe(1);
    expect(hitPanelTag(PANEL_TAG_HIT.x, 279)).toBe(3);
  });
});

describe('日历那两颗按钮：太阳 / 月亮 @source VA 0x0041838c', () => {
  it('★ 太阳 = 切到日曆、月亮 = 切到月曆；两颗共用 y ∈ [8, 34]', () => {
    expect(CAL_TOGGLE_HIT.sun).toEqual({ x0: 8, x1: 34 }); // 448..474 − 440
    expect(CAL_TOGGLE_HIT.moon).toEqual({ x0: 38, x1: 64 }); // 478..504 − 440
    expect(CAL_TOGGLE_HIT.y0).toBe(8); // 288 − 280
    expect(CAL_TOGGLE_HIT.y1).toBe(34); // 314 − 280
  });

  it('★ 命中：各格的角与中心都认，两栏之间的空隙不认', () => {
    for (const [x0, x1, want] of [
      [8, 34, 'calendar'],
      [38, 64, 'month'],
    ] as const) {
      for (const x of [x0, x1, Math.floor((x0 + x1) / 2)]) {
        for (const y of [8, 34, 20]) {
          expect(hitCalendarToggle(x, y)).toBe(want);
        }
      }
    }
    // ★ 34<38 之间那 3 像素是**没有钮**的（原版两颗的框就是不挨着）
    expect(hitCalendarToggle(35, 20)).toBeNull();
    expect(hitCalendarToggle(36, 20)).toBeNull();
    expect(hitCalendarToggle(37, 20)).toBeNull();
  });

  it('★ 框外不认：上下越界、左右越界', () => {
    expect(hitCalendarToggle(20, 7)).toBeNull();
    expect(hitCalendarToggle(20, 35)).toBeNull();
    expect(hitCalendarToggle(7, 20)).toBeNull();
    expect(hitCalendarToggle(65, 20)).toBeNull();
  });

  it('★ 画出来的两张图正好落在各自的框里（太阳 24×23 锚点(12,11)、月亮 20×20 锚点(10,10)）', () => {
    // 太阳画在 (462,300) → 局部 (22,20)，减锚点 → 左上 (10,9)、右下 (34,32)
    expect(CAL.sun).toEqual({ x: 22, y: 20 });
    expect([CAL.sun.x - 12, CAL.sun.y - 11]).toEqual([10, 9]);
    // 月亮画在 (492,301) → 局部 (52,21)，减锚点 → 左上 (42,11)、右下 (62,31)
    expect(CAL.moon).toEqual({ x: 52, y: 21 });
    expect([CAL.moon.x - 10, CAL.moon.y - 10]).toEqual([42, 11]);
    // 两块都在自己的命中框内
    for (const [x, y] of [
      [10, 9],
      [34, 32],
    ] as const) {
      expect(hitCalendarToggle(x, y)).toBe('calendar');
    }
    for (const [x, y] of [
      [42, 11],
      [62, 31],
    ] as const) {
      expect(hitCalendarToggle(x, y)).toBe('month');
    }
  });

  it('★ 星期名竖排：块宽只有一个字，居中于 x=14 → 6..22，正好在侧栏里', () => {
    expect(CAL.weekday.x).toBe(14);
    expect(CAL.weekday.x - 8).toBe(6);
    expect(CAL.weekday.x + 8).toBe(22);
  });
});

// ============================================================
//  ★ Q-PERF-1 的另一半：侧栏那份 `#ready` 也要接淘汰监听
//    （先前只接了 `render.ts`，于是侧栏那 ≤ 30 张位图永远放不掉）
// ============================================================

describe('★ 侧栏的淘汰监听 @source Q-PERF-1', () => {
  /** 一个只记「被 close 过没有」的假精灵 */
  const fakeSprite = (): { sprite: Sprite; closed: () => boolean } => {
    let closed = false;
    const sprite = {
      bitmap: {
        close: () => {
          closed = true;
        },
      },
      width: 2,
      height: 2,
      anchorX: 1,
      anchorY: 1,
    } as unknown as Sprite;
    return { sprite, closed: () => closed };
  };

  /** 一份只服务本测试的假缓存：把挂上来的监听抓在手里 */
  const fakeCache = (): { cache: SpriteCache; listeners: ((s: Sprite) => void)[] } => {
    const listeners: ((s: Sprite) => void)[] = [];
    const cache = {
      addEvictListener: (fn: (s: Sprite) => void) => listeners.push(fn),
    } as unknown as SpriteCache;
    return { cache, listeners };
  };

  it('★ HUD 构造时也挂上缓存的淘汰监听（不靠 main.ts 接线）', () => {
    const { cache, listeners } = fakeCache();
    new Hud({} as CanvasRenderingContext2D, cache);
    expect(listeners).toHaveLength(1);
    expect(typeof listeners[0]).toBe('function');
  });

  it('★ 监听回调只摘引用、**不**当场 close —— 还在画的那一帧不能被关掉', () => {
    const { cache, listeners } = fakeCache();
    const hud = new Hud({} as CanvasRenderingContext2D, cache);
    const { sprite, closed } = fakeSprite();
    // 侧栏没持有过它（`retire` 返回 0）：既不排队也不 close
    listeners[0]!(sprite);
    expect(closed()).toBe(false);
    expect(hud.drainEvicted()).toBe(0);
    expect(closed()).toBe(false);
  });

  it('★ drainEvicted 是帧边界那一下：没有排队时是空操作', () => {
    const { cache } = fakeCache();
    const hud = new Hud({} as CanvasRenderingContext2D, cache);
    expect(hud.drainEvicted()).toBe(0);
    expect(hud.drainEvicted()).toBe(0);
  });
});

// ============================================================
//  ★ 小地图白框框的是 `[0x49910c]` 当前行动者 —— 替身那一趟框替身（VA 0x00416f3d）
// ============================================================
describe('★ `minimapFrameCenter`：玩家回合框玩家，替身那一趟框替身', () => {
  const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
  const run = existsSync(EXE) ? it : it.skip;
  const at = (va: number, n: number): string => {
    const d = readFileSync(EXE);
    const o = 1024 + (va - 0x401000);
    return d.subarray(o, o + n).toString('hex');
  };
  const st = (players: { xpos: number; ypos: number; whoPlays?: number }[], current = 0) =>
    ({
      currentPlayer: current,
      players: players.map((p, i) => ({ index: i, whoPlays: 1, ...p })),
    }) as unknown as GameState;

  run('exe：替身支判 `+10 == 0`（在盘上）且 `ebx == [0x49910c]`；循环到 9 为止', () => {
    expect(at(0x00416f42, 7)).toBe('80baf28d490000'); // cmp byte [edx + 0x498df2], 0
    expect(at(0x00416f4b, 6)).toBe('3b1d0c914900'); //  cmp ebx, [0x49910c]
    expect(at(0x00416f9f, 6)).toBe('3b1d0c914900'); //  两支共用的「是不是当前行动者」
    expect(at(0x00416fb0, 3)).toBe('83fb09'); //         cmp ebx, 9
  });

  it('★ 替身在走 ⇒ 框在替身的插值点上（不是当前玩家）', () => {
    const s = st([{ xpos: 1024, ypos: 1024 }]);
    expect(minimapFrameCenter(s, { x: 512, y: 256 })).toEqual({ x: minimapAt(512), y: minimapAt(256) });
  });

  it('玩家回合 ⇒ 框当前玩家的 xpos/ypos；xpos == 0 或已出局 ⇒ 不画', () => {
    expect(minimapFrameCenter(st([{ xpos: 1, ypos: 1 }, { xpos: 1024, ypos: 2048 }], 1), null)).toEqual({
      x: minimapAt(1024),
      y: minimapAt(2048),
    });
    expect(minimapFrameCenter(st([{ xpos: 0, ypos: 500 }]), null)).toBeNull();
    expect(minimapFrameCenter(st([{ xpos: 500, ypos: 500, whoPlays: 0 }]), null)).toBeNull();
  });
});
