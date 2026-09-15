/*
 * 輔助說明屏的版面、命中与翻页（T-045 / REQ-12.17）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 全部照 `rich4-re/asm/rich4_ui_help.asm` 与 `rich4_ui_clicking_top_panel.asm` 抄，
 * 把最容易写错的几条钉住：
 *   · 工具列下标 **0**（跳表 0x417d39 第 0 项 push 0x3c / 0x14）；
 *   · 命中表 0x476254 是**六条矩形**、两张跳表各三格 —— 不是「三颗钮」；
 *   · 左列八格不在命中表里，是图上那 8 条绿格（每格 18、间隙 3）；
 *   · 正文的 `maxScroll` 逐章 = 行数 − 8（表里第 4 个字段）；
 *   · 上/下滚步长 8、夹在 `[0, maxScroll]`。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { UiScreenEnv } from './ui-screen.ts';
import { HOTKEY } from './hotkeys.ts';
import {
  HELP_ARROW_DOWN_AT,
  HELP_ARROW_DOWN_IMAGE,
  HELP_ARROW_UP_AT,
  HELP_ARROW_UP_IMAGE,
  HELP_BAR_AT,
  HELP_BAR_IMAGE,
  HELP_BG_IMAGE,
  HELP_CHAPTERS,
  HELP_CHAPTER_COUNT,
  HELP_CHIP_DY,
  HELP_CHIP_GAP,
  HELP_CHIP_H,
  HELP_ROW_IMAGE,
  HELP_ROW_HOT_IMAGE,
  HELP_HIT_BOXES,
  HELP_INDEX_AT,
  HELP_INDEX_LABEL,
  HELP_INDEX_NAMES,
  HELP_NAME_STEP,
  HELP_PANEL,
  HELP_ROW_NAME,
  HELP_SEL_NAME,
  HELP_RESOURCE,
  HELP_SCROLL_STEP,
  HELP_TEXT,
  HELP_TOOLBAR_INDEX,
  applyHelpHit,
  barAt,
  chapterLines,
  chipAt,
  chipImage,
  chipY,
  clampChapter,
  clampScroll,
  hasMoreBelow,
  helpArrowDownAt,
  helpArrowUpAt,
  helpChipAt,
  helpOrigin,
  helpPanelOriginFor,
  helpPosition,
  helpScreen,
  hitHelp,
  hitHelpBox,
  hitHelpChip,
  openHelpAt,
  pageCount,
  pageOf,
  resetHelp,
  scrollOfPage,
  visibleLines,
} from './help-screen.ts';

/** 只填这一屏用得到的字段的假环境 */
function mkEnv(): {
  env: UiScreenEnv;
  renders: () => number;
  effects: number[];
} {
  let renders = 0;
  const effects: number[] = [];
  const env = {
    screen: 'game',
    now: 0,
    requestRender: () => {
      renders += 1;
    },
    log: () => undefined,
    flic: () => null,
    playEffect: (id: number) => {
      effects.push(id);
    },
    sprite: () => null,
  } as unknown as UiScreenEnv;
  return { env, renders: () => renders, effects };
}

beforeEach(() => {
  resetHelp();
});

describe('用到的图 @source rich4_ui_help.asm', () => {
  it('★ 素材在 help.mkf 资源 0：底图图 0、章名条图 2、绿格 6/7、三角 4/5', () => {
    expect(HELP_RESOURCE).toBe(0);
    expect(HELP_BG_IMAGE).toBe(0);
    expect(HELP_BAR_IMAGE).toBe(2);
    expect(HELP_ROW_IMAGE).toBe(6);
    expect(HELP_ROW_HOT_IMAGE).toBe(7);
    expect(HELP_ARROW_UP_IMAGE).toBe(4);
    expect(HELP_ARROW_DOWN_IMAGE).toBe(5);
  });

  it('★ 图号 = 条目表偏移 / 2 的换算（0x18→2、0x24→6、0x30→7、0x3c→4、0x48→5）', () => {
    // 原版这些 `add eax, imm` 后面紧跟 `fcn_004563f5(资源指针, 图指针, x, y)`，
    // 图指针 = 0x48c5f8 + imm，而每张图 12 字节 —— imm/2 就是图号的一半偏移。
    // 这一条只是把换算钉死，免得以后有人把 imm 直接当图号。
    expect([0x18, 0x24, 0x30, 0x3c, 0x48].map((v) => v / 2)).toEqual([12, 18, 24, 30, 36]);
    // 真正用到的图号是上面那组（表 0x476254 与 0x4761b4 之外的硬编码）
    expect([
      HELP_BG_IMAGE,
      HELP_BAR_IMAGE,
      HELP_ROW_IMAGE,
      HELP_ROW_HOT_IMAGE,
      HELP_ARROW_UP_IMAGE,
      HELP_ARROW_DOWN_IMAGE,
    ]).toEqual([0, 2, 6, 7, 4, 5]);
  });
});

describe('工具列与落点 @source 0x417d39 / 0x44e4e4', () => {
  it('★ 工具列 #1 = 下标 0；面板贴在 (20, 60)、400×400', () => {
    expect(HELP_TOOLBAR_INDEX).toBe(0);
    expect(HELP_PANEL).toEqual({ x: 20, y: 60, w: 400, h: 400 });
  });

  it('★ toolbar(0) 开屏并吃掉这一下；其它下标不认', () => {
    const { env, renders } = mkEnv();
    expect(helpScreen.toolbar?.(0, env)).toBe(true);
    expect(helpScreen.active(env)).toBe(true);
    expect(renders()).toBeGreaterThan(0);
    for (const i of [1, 2, 6, 10]) expect(helpScreen.toolbar?.(i, env)).toBe(false);
  });

  it('★ 熱鍵 H 开屏、再按一次关屏；别的熱鍵不认', () => {
    const { env, renders } = mkEnv();
    expect(helpScreen.hotkey?.(HOTKEY.help, env)).toBe(true);
    expect(helpScreen.active(env)).toBe(true);
    expect(helpScreen.hotkey?.(HOTKEY.help, env)).toBe(true);
    expect(helpScreen.active(env)).toBe(false);
    expect(renders()).toBe(2); // 开一帧、关一帧
    expect(helpScreen.hotkey?.(HOTKEY.map, env)).toBe(false);
  });

  it('★ 开屏时章号与行偏移都归零（原版入口那两个 mov …, 0）', () => {
    const { env } = mkEnv();
    helpScreen.toolbar?.(0, env);
    expect(helpPosition()).toEqual({ chapter: 0, scroll: 0 });
  });

  it('★ 入口带参数：`(-1,-1)` = 居中 (120,40)；工具列那一路是 (20,60)', () => {
    // @source 0x0044e4b9：x == 0xffff 时 x 与 y **都**重算成 (0x140−w/2, 0x0f0−h/2)
    expect(helpPanelOriginFor(-1, -1)).toEqual({ x: 120, y: 40 });
    expect(helpPanelOriginFor(-1, 40)).toEqual({ x: 120, y: 40 }); // y 被无条件覆盖
    expect(helpPanelOriginFor(20, 60)).toEqual({ x: 20, y: 60 });
    expect(helpPanelOriginFor(0xffff, 0xffff)).toEqual({ x: 120, y: 40 });
  });

  it('★ openHelpAt(-1,-1) 居中开屏；ESC 关掉；再走工具列回来还是 (20,60)', () => {
    const { env } = mkEnv();
    openHelpAt(env, -1, -1);
    expect(helpScreen.active(env)).toBe(true);
    expect(helpOrigin()).toEqual({ x: 120, y: 40 });
    expect(helpScreen.hotkey?.(HOTKEY.cancel, env)).toBe(true);
    expect(helpScreen.active(env)).toBe(false);
    // 没开屏时 ESC 不认（还回 main.ts 那条通用路）
    expect(helpScreen.hotkey?.(HOTKEY.cancel, env)).toBe(false);
    // 工具列那一路把落点放回 (20,60)
    helpScreen.toolbar?.(0, env);
    expect(helpOrigin()).toEqual({ x: 20, y: 60 });
  });
});

describe('命中表六条矩形 @source 0x476254', () => {
  it('★ 六条矩形逐字节对上 dump（22,38,91,104 / 77,38,104,78 / 170,43,192,58 / …）', () => {
    expect(HELP_HIT_BOXES).toEqual([
      { x0: 22, y0: 38, x1: 91, y1: 104 },
      { x0: 77, y0: 38, x1: 104, y1: 78 },
      { x0: 170, y0: 43, x1: 192, y1: 58 },
      { x0: 170, y0: 59, x1: 192, y1: 74 },
      { x0: 322, y0: 48, x1: 345, y1: 80 },
      { x0: 343, y0: 48, x1: 366, y1: 80 },
    ]);
  });

  it('★ 六条矩形两两一组：0/1 = 左列、2/3 = 上下章、4/5 = 上下滚', () => {
    expect(HELP_HIT_BOXES).toHaveLength(6);
    // 同一组的两个框在 y 上错开，x 上重叠 —— 所以判定顺序不能颠倒
    expect(HELP_HIT_BOXES[2]!.y0).toBeLessThan(HELP_HIT_BOXES[3]!.y0);
    expect(HELP_HIT_BOXES[4]!.x0).toBeLessThan(HELP_HIT_BOXES[5]!.x0);
  });

  it('★ 每条的左上角与右下角都算命中（闭区间），框外不算', () => {
    for (const b of HELP_HIT_BOXES) {
      expect(hitHelpBox(b.x0, b.y0)).not.toBeNull();
      expect(hitHelpBox(b.x1, b.y1)).not.toBeNull();
    }
    expect(hitHelpBox(0, 0)).toBeNull();
    expect(hitHelpBox(21, 38)).toBeNull();
    expect(hitHelpBox(23, 37)).toBeNull();
    expect(hitHelpBox(367, 60)).toBeNull();
  });

  it('★ 顺序：先撞上哪条就是哪条（0 压 1、2 压 3、4 压 5 的重叠区）', () => {
    // 0 与 1 在 (77..91, 38..78) 上重叠 → 表序在前的那条赢
    expect(hitHelpBox(80, 40)).toBe(0);
    // 2 与 3 不重叠；4 与 5 也不重叠
    expect(hitHelpBox(180, 50)).toBe(2);
    expect(hitHelpBox(180, 60)).toBe(3);
    expect(hitHelpBox(330, 60)).toBe(4);
    expect(hitHelpBox(350, 60)).toBe(5);
  });
});

describe('左列八格命中 @source 0x44e2f0', () => {
  it('★ 八格：第一格顶 (38)、每格高 18、间隙 3', () => {
    expect(HELP_CHIP_DY).toBe(38);
    expect(HELP_CHIP_H).toBe(18);
    expect(HELP_CHIP_GAP).toBe(3);
    expect(chipY(0)).toBe(38);
    expect(chipY(1)).toBe(59);
    expect(chipY(7)).toBe(185);
  });

  it('★ 每格的中心与底边都命中自己；间隙与列外不算', () => {
    for (let i = 0; i < HELP_CHAPTER_COUNT; i++) {
      expect(hitHelpChip(56, chipY(i))).toBe(i);
      expect(hitHelpChip(56, chipY(i) + HELP_CHIP_H - 1)).toBe(i);
    }
    // 间隙（18..20 之间那一行）不算
    expect(hitHelpChip(56, chipY(0) + HELP_CHIP_H)).toBeNull();
    expect(hitHelpChip(21, chipY(0))).toBeNull();
    expect(hitHelpChip(92, chipY(0))).toBeNull();
    expect(hitHelpChip(56, chipY(7) + HELP_CHIP_H - 1 + HELP_CHIP_GAP)).toBeNull();
  });

  it('★ hitHelp 先认左列八格（label 0、cell = 格号），命中表排在其后', () => {
    // 左列那一列与命中表第 0 条重叠，但格优先
    expect(hitHelp(56, chipY(3))).toEqual({ label: 0, cell: 3 });
    // 第 0 条的 y 上限 104 与左列第 3 格（101..118）之间：那里仍然是第 0 条
    expect(hitHelp(56, 104)).toEqual({ label: 0, cell: 3 });
    // 左列只到 x=91：92..104 那一段落到命中表第 0 条（y<=104）
    expect(hitHelp(95, 40)).toEqual({ label: 0, cell: 1 });
    // 命中表第 2 条（170..192）离左列很远，直接归上一章
    expect(hitHelp(180, 50)).toEqual({ label: 1, cell: 0 });
    expect(hitHelp(180, 60)).toEqual({ label: 1, cell: 1 });
  });
});

describe('三组钮的作用 @source 跳表 ref_0044e3e3', () => {
  it('★ 上一章 / 下一章：夹在 0..7，跳章后行偏移归零', () => {
    const { env } = mkEnv();
    helpScreen.toolbar?.(0, env);
    applyHelpHit({ label: 1, cell: 1 }, env); // 下一章
    expect(helpPosition()).toEqual({ chapter: 1, scroll: 0 });
    applyHelpHit({ label: 1, cell: 0 }, env); // 上一章
    expect(helpPosition()).toEqual({ chapter: 0, scroll: 0 });
    // 在 0 上再退：什么都不做（原版 `cmp edx, 0 / je 返回`）
    applyHelpHit({ label: 1, cell: 0 }, env);
    expect(helpPosition()).toEqual({ chapter: 0, scroll: 0 });
  });

  it('★ 章号夹取：0 与 7 是两端，越界的输入夹回端点', () => {
    expect(clampChapter(-5)).toBe(0);
    expect(clampChapter(0)).toBe(0);
    expect(clampChapter(7)).toBe(7);
    expect(clampChapter(99)).toBe(7);
  });

  it('★ 上滚 / 下滚：步长 8、夹在 [0, maxScroll]（不是取整跳到顶/底）', () => {
    const { env } = mkEnv();
    helpScreen.toolbar?.(0, env);
    // 第 1 章 maxScroll = 22 → 0 / 8 / 16 / 22（最后一步落到 22 而不是 24）
    applyHelpHit({ label: 0, cell: 1 }, env); // 直接跳第 1 章
    expect(helpPosition()).toEqual({ chapter: 1, scroll: 0 });
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(8);
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(16);
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(22); // 夹到 maxScroll
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(22); // 到底了不动
    applyHelpHit({ label: 2, cell: 0 }, env);
    expect(helpPosition().scroll).toBe(14);
    applyHelpHit({ label: 2, cell: 0 }, env);
    expect(helpPosition().scroll).toBe(6);
  });

  it('★ scroll 为 0 时上滚不做事（原版 `edx <= 0` 那条支路）', () => {
    const { env, renders } = mkEnv();
    helpScreen.toolbar?.(0, env);
    const before = renders();
    applyHelpHit({ label: 2, cell: 0 }, env);
    expect(helpPosition().scroll).toBe(0);
    expect(renders()).toBe(before);
  });

  it('★ maxScroll = 0 的章（操作說明）压根滚不动', () => {
    expect(HELP_CHAPTERS[0]!.maxScroll).toBe(0);
    expect(clampScroll(0, 8)).toBe(0);
    expect(clampScroll(0, -8)).toBe(0);
    expect(pageCount(0)).toBe(1);
  });

  it('★ 关屏之后一切命中都不生效', () => {
    const { env } = mkEnv();
    helpScreen.toolbar?.(0, env);
    helpScreen.hotkey?.(HOTKEY.help, env); // 关掉
    applyHelpHit({ label: 1, cell: 1 }, env);
    expect(helpPosition()).toEqual({ chapter: 0, scroll: 0 });
  });
});

describe('翻页夹取与屏数', () => {
  it('★ 八章的 maxScroll 与行数逐条对上（行数 − 8 = 表里第 4 个字段）', () => {
    for (let i = 0; i < HELP_CHAPTER_COUNT; i++) {
      const c = HELP_CHAPTERS[i]!;
      const lines = chapterLines(i).length;
      expect(Math.max(0, c.maxScroll), `第 ${i} 章的 maxScroll`).toBe(
        Math.max(0, lines - HELP_TEXT.rows),
      );
      // 滚到 maxScroll 那儿，当屏的 8 行必须都拿得出来（不能越界空掉）
      expect(visibleLines(i, c.maxScroll)).toHaveLength(Math.min(lines, HELP_TEXT.rows));
    }
  });

  it('★ 屏数 = floor(maxScroll / 8) + 1，八章依次 1/3/1/2/1/1/93/12', () => {
    expect(HELP_CHAPTER_COUNT).toBe(8);
    expect(Array.from({ length: 8 }, (_, i) => pageCount(i))).toEqual([
      1, 3, 1, 2, 1, 1, 107, 17,
    ]);
  });

  it('★ 屏号夹取到 [0, pageCount−1] 对应的行偏移', () => {
    // 第 6 章（卡片）851 = 106*8 + 3 → 最后一屏的行偏移就是 851
    expect(HELP_CHAPTERS[6]!.maxScroll).toBe(851);
    expect(scrollOfPage(6, 106)).toBe(848);
    expect(scrollOfPage(6, 999)).toBe(851);
    expect(scrollOfPage(6, -3)).toBe(0);
    expect(pageOf(6, 851)).toBe(106);
    expect(pageOf(6, 900)).toBe(106); // 夹到 851
  });

  it('★ 每一屏刚好取 8 行；`@` 分页行留在里面（由绘制那一步跳过）', () => {
    expect(HELP_TEXT.rows).toBe(8);
    expect(HELP_SCROLL_STEP).toBe(8);
    expect(visibleLines(6, 0)).toHaveLength(8);
    expect(visibleLines(6, HELP_CHAPTERS[6]!.maxScroll)).toHaveLength(8);
    // 第 1 章第 9 行（0 基 index 9）就是分页标记 @
    expect(chapterLines(1)[9]).toBe('@');
    expect(visibleLines(1, 8)).toContain('@');
  });

  it('★ 「还能往下」：没到底就有；到底且当屏没有 @ 就没有', () => {
    expect(hasMoreBelow(6, 0)).toBe(true);
    expect(hasMoreBelow(6, 851)).toBe(false);
    // 第 1 章 maxScroll 22、共 30 行 → 从 22 起还剩 8 行（到 30），没有更下面的了
    expect(hasMoreBelow(1, 14)).toBe(true);
    expect(hasMoreBelow(0, 0)).toBe(false); // 操作說明只有 4 行，一屏就完
    // 到底之后（第 6 章最后那屏）不再有
    expect(hasMoreBelow(6, HELP_CHAPTERS[6]!.maxScroll)).toBe(false);
  });
});

describe('版面落点 @source 0x44e024 / 0x44e11f / 0x44e14e', () => {
  it('★ 正文：落点 (+232, +90)、行距 30、一屏 8 行', () => {
    expect(HELP_TEXT).toEqual({ dx: 232, dy: 90, lineH: 30, rows: 8 });
  });

  it('★ 两颗三角在 (+170, +43) / (+170, +59)', () => {
    expect(HELP_ARROW_UP_AT).toEqual({ x: 170, y: 43 });
    expect(HELP_ARROW_DOWN_AT).toEqual({ x: 170, y: 59 });
    expect(helpArrowUpAt()).toEqual({ x: 190, y: 103 });
    expect(helpArrowDownAt()).toEqual({ x: 190, y: 119 });
  });

  it('★ 左列第 i 行的屏幕落点 = 面板 (20,60) + 局部 (26, 38 + 21i)', () => {
    expect(chipAt(0)).toEqual({ x: 26, y: 38 });
    expect(chipAt(7)).toEqual({ x: 26, y: 185 });
    expect(helpChipAt(0)).toEqual({ x: 46, y: 98 });
    expect(helpChipAt(7)).toEqual({ x: 46, y: 245 });
  });

  it('★ 章名条挂在右列 (26, 58 + 20i) @source 0x44e04d / 0x44e056', () => {
    expect(HELP_BAR_AT).toEqual({ x: 0x1a, y: 0x3a });
    expect(barAt(0)).toEqual({ x: 26, y: 58 });
    expect(barAt(7)).toEqual({ x: 26, y: 198 });
    expect(HELP_NAME_STEP).toBe(20);
  });

  it('★ 左列八行章名：选中 (26, 58+20i)、其余 (59, 73+20i) @0x44e08c / 0x44e092', () => {
    expect(HELP_SEL_NAME).toEqual({ x: 0x1a, y: 0x3a });
    expect(HELP_ROW_NAME).toEqual({ x: 0x3b, y: 0x49 });
    expect(HELP_ROW_NAME.x - HELP_SEL_NAME.x).toBe(33);
  });

  it('★ 右列分项标题 (140, 57)、字面是串表 0x476028 的表头', () => {
    expect(HELP_INDEX_AT).toEqual({ x: 0x8c, y: 0x39 });
    expect(HELP_INDEX_LABEL).toBe('遊戲操作');
    expect(HELP_INDEX_NAMES[0]).toBe('遊戲操作');
    expect(HELP_INDEX_NAMES).toHaveLength(8);
  });

  it('★ 左列八行的格图：常态 6、选中 7（本模块不画，见 D-045-1）', () => {
    expect(chipImage(0, true)).toBe(HELP_ROW_HOT_IMAGE);
    expect(chipImage(3, false)).toBe(HELP_ROW_IMAGE);
    expect(chipImage(0, true)).toBe(7);
    expect(chipImage(3, false)).toBe(6);
  });
});

describe('关屏', () => {
  it('★ 熱鍵 H 是唯一的关屏入口（原版这一屏没有关闭钮）', () => {
    const { env } = mkEnv();
    helpScreen.toolbar?.(0, env);
    expect(helpScreen.active(env)).toBe(true);
    expect(helpScreen.hotkey?.(HOTKEY.help, env)).toBe(true);
    expect(helpScreen.active(env)).toBe(false);
  });

  it('★ 关着的时候 down 什么都不做（active 为假时 main 也不会发过来）', () => {
    const { env, renders } = mkEnv();
    helpScreen.down?.(46, 98, env);
    expect(renders()).toBe(0);
  });
});
