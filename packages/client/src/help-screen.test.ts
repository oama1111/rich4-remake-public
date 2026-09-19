/*
 * 輔助說明屏的版面、命中与翻页（T-045 / REQ-12.17）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 全部照 `rich4-re/asm/rich4_ui_help.asm` 与 `rich4_ui_clicking_top_panel.asm` 抄，
 * 把最容易写错的几条钉住：
 *   · 工具列下标 **0**（跳表 0x417d39 第 0 项 push 0x3c / 0x14）；
 *   · 命中表 0x476254 是**六条矩形**、两张跳表各三格 —— 不是「三颗钮」；
 *   · 左列八格不在命中表里，是图上那 8 条绿格（每格 18、间隙 3）；
 *   · **章 ↔ help.mkf 资源**：exe 条目表 0x4761b4 的 +0x08 / +0x0C 给出
 *     区间 `res .. res+resCount−1`（1,2,8,20,23,39,57,87 / 1,6,12,3,16,18,30,13），
 *     八章首尾相接；每章正文逐字对得上区间内的资源（见「章 ↔ help.mkf 资源」）；
 *   · 正文的 `maxScroll` 逐章 = 行数 − 8（本模块口径，exe 那个字段是资源数 − 8）；
 *   · 上/下滚步长 8、夹在 `[0, maxScroll]`。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
  HELP_CHAPTER_ITEMS,
  HELP_ITEM_LINES,
  itemTopOfLine,
  HELP_CHIP_AT,
  HELP_CHIP_H,
  HELP_CHIP_NAME_AT,
  HELP_CHIP_STEP,
  HELP_ROW_IMAGE,
  HELP_ROW_HOT_IMAGE,
  HELP_HIT_BOXES,
  HELP_INDEX_AT,
  HELP_INDEX_LABEL,
  HELP_INDEX_NAMES,
  HELP_LIST_ROWS,
  HELP_NAME_STEP,
  HELP_PANEL,
  HELP_ROW_NAME,
  HELP_SCROLL_DOWN_AT,
  HELP_SCROLL_DOWN_IMAGE,
  HELP_SCROLL_UP_AT,
  HELP_SCROLL_UP_IMAGE,
  HELP_SEL_NAME,
  HELP_SUB_INDEX_AT,
  HELP_RESOURCE,
  HELP_SCROLL_STEP,
  HELP_TEXT,
  HELP_TOOLBAR_INDEX,
  applyHelpHit,
  barAt,
  chapterHasItems,
  chapterItem,
  chapterItemCount,
  itemAt,
  chapterLines,
  chapterNameAt,
  chipAt,
  chipImage,
  chipImageAt,
  chipNameAt,
  chipY,
  clampChapter,
  clampScroll,
  drawHelpScreen,
  hasMoreBelow,
  helpArrowDownAt,
  helpArrowUpAt,
  helpChipAt,
  helpChipImageAt,
  helpChipNameAt,
  helpImagePlan,
  helpOrigin,
  helpPanelOriginFor,
  helpPosition,
  helpScreen,
  helpScrollDownAt,
  helpScrollUpAt,
  hitHelp,
  hitHelpBox,
  hitHelpChip,
  lineAt,
  openHelpAt,
  pageCount,
  pageOf,
  resetHelp,
  scrollDownAt,
  scrollOfPage,
  scrollUpAt,
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

// ============================================================
//  章 ↔ help.mkf 资源（T-045 的内容错位修复）
// ============================================================

/**
 * exe 条目表 **0x4761b4** 每项的 (起始资源 +0x08, 资源数 +0x0C)，以及该区间拼
 * 出来的正文首行 / 末行（从 `extracted/help/NNNN.bin` dump，CP950）。
 *
 * 八组区间首尾相接：`1 | 2..7 | 8..19 | 20..22 | 23..38 | 39..56 | 57..86 | 87..99`。
 * **不是**旧版的「一章一资源」—— 那样资源 3..7 会被错分到后面几章，第 2..7 章
 * 显示的都是别的章的文字（本次修复的就是它）。
 */
interface HelpChapterFact {
  readonly res: number;
  readonly resCount: number;
  readonly first: string;
  readonly last: string;
}

const CHAPTER_FACTS: readonly HelpChapterFact[] = [
  { res: 1, resCount: 1, first: '本遊戲的操作方法非常', last: '消鍵即可進行。' },
  { res: 2, resCount: 6, first: '遊戲中，每一個人物都', last: '即為您的總資產。' },
  { res: 8, resCount: 12, first: '讀取目前的遊戲進度。', last: '的功能啦！' },
  { res: 20, resCount: 3, first: '公司企業在地圖上指定', last: '輪盤決定消費金額。' },
  { res: 23, resCount: 16, first: '走到七彩氣球代表格時', last: '人的懲罰。' },
  { res: 39, resCount: 18, first: '在遊戲中途倒閉的角色', last: '盜領所有的累積紅利。' },
  { res: 57, resCount: 30, first: '功能：只要指定一棟建', last: '原價：20點' },
  { res: 87, resCount: 13, first: '功能：拆除房屋一個等', last: '之骰子數，擲點前進。' },
];

/** `help.mkf` 的正文资源（资源 0 是底图那一支，正文从 0001 起）*/
const HELP_DIR = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/help';
const runOnHelpAssets = existsSync(`${HELP_DIR}/0001.bin`) ? it : it.skip;

/**
 * 一个资源文件里的行（NUL 分隔）。
 *
 * ★ 文件以 NUL 收尾，所以按 `\u0000` 切完要**丢掉末尾那个空元素**；中间的
 *   空串照留 —— **空串也是行**（占行号不画），这是 `maxScroll` 的口径。
 */
function resourceLines(res: number): string[] {
  const raw = readFileSync(`${HELP_DIR}/${String(res).padStart(4, '0')}.bin`);
  return new TextDecoder('big5').decode(raw).split('\u0000').slice(0, -1);
}

describe('章 ↔ help.mkf 资源 @source 0x4761b4（+0x08 起始资源 / +0x0C 资源数）', () => {
  it('★ 八章的区间首尾相接，且正好铺满资源 1..99', () => {
    let next = 1;
    for (let i = 0; i < CHAPTER_FACTS.length; i++) {
      const f = CHAPTER_FACTS[i]!;
      expect(HELP_CHAPTERS[i]!.res, `第 ${i} 章起始资源`).toBe(f.res);
      expect(HELP_CHAPTERS[i]!.resCount, `第 ${i} 章资源数`).toBe(f.resCount);
      // start[i] == start[i-1] + count[i-1]
      expect(HELP_CHAPTERS[i]!.res).toBe(next);
      next += HELP_CHAPTERS[i]!.resCount;
    }
    expect(next - 1).toBe(99); // 第 7 章 = 87..99，正好收在最后一号资源
  });

  for (let i = 0; i < CHAPTER_FACTS.length; i++) {
    const f = CHAPTER_FACTS[i]!;
    it(`★ 第 ${i} 章：资源 ${f.res}..${f.res + f.resCount - 1}，首行/末行对得上`, () => {
      const lines = chapterLines(i);
      expect(lines[0], `第 ${i} 章首行`).toBe(f.first);
      expect(lines[lines.length - 1], `第 ${i} 章末行`).toBe(f.last);
    });
  }

  runOnHelpAssets('★ 每章行数 = 区间内所有 NUL 行的总数（现算，不写死）', () => {
    for (let i = 0; i < CHAPTER_FACTS.length; i++) {
      const f = CHAPTER_FACTS[i]!;
      const expected: string[] = [];
      for (let res = f.res; res < f.res + f.resCount; res++) expected.push(...resourceLines(res));
      expect(chapterLines(i).length, `第 ${i} 章行数`).toBe(expected.length);
      // 行数对了还不够：逐字比一遍，正文内容也要就是这些资源拼出来的
      expect(chapterLines(i), `第 ${i} 章正文`).toEqual(expected);
    }
  });

  runOnHelpAssets('★ 反向：第 2 章不再是资源 3 的文本，资源 3 已归第 1 章', () => {
    const res3 = resourceLines(3);
    expect(res3[0]).toBe('土地：個人擁有土地的'); // 旧错片（= 资源 3）的证据
    expect(chapterLines(2)[0]).not.toBe(res3[0]);
    expect(chapterLines(2)).not.toEqual(res3);
    // 资源 2 占第 1 章前 30 行，资源 3 紧随其后
    expect(chapterLines(1).slice(30, 30 + res3.length)).toEqual(res3);
  });

  it('★ 反向（不依赖素材）：第 2 章的首行不是旧错片「土地：…」', () => {
    // 探针核过：把 HELP_CHAPTERS[2].res 改回 3，这一条与上面几条一起红
    expect(chapterLines(2)[0]).toBe(CHAPTER_FACTS[2]!.first);
    expect(chapterLines(2)[0]).not.toBe('土地：個人擁有土地的');
    expect(chapterLines(2)).not.toEqual([
      '土地：個人擁有土地的',
      '總筆數。',
      '',
      '連鎖店：個人擁有之連',
      '鎖店的總店數。',
      '',
      '設施：個人擁有之商業',
      '區的設施總數。',
    ]);
  });
});

describe('用到的图 @source rich4_ui_help.asm', () => {
  it('★ 素材在 help.mkf 资源 0：底图 0、章名条 1、8 行格图 2/3、翻章三角 4/5、滚动三角 8/9', () => {
    expect(HELP_RESOURCE).toBe(0);
    expect(HELP_BG_IMAGE).toBe(0);
    expect(HELP_BAR_IMAGE).toBe(1);
    expect(HELP_ROW_IMAGE).toBe(2);
    expect(HELP_ROW_HOT_IMAGE).toBe(3);
    expect(HELP_ARROW_UP_IMAGE).toBe(4);
    expect(HELP_ARROW_DOWN_IMAGE).toBe(5);
    expect(HELP_SCROLL_UP_IMAGE).toBe(8);
    expect(HELP_SCROLL_DOWN_IMAGE).toBe(9);
  });

  it('★ 图号换算 = (条目表偏移 − 0xc) / 12，**不是** imm / 2', () => {
    // 原版这些 `add eax, imm` 后面紧跟 `fcn_004563f5(资源指针, 图指针, x, y)`，
    // 图指针 = 0x48c5f8 + imm，图像记录从 +0xc 起、每项 0xc 字节 ——
    // 所以 **index = (imm − 0xc) / 12**（`assets-pipeline/src/mkf.ts:176`、
    // `monthly-screen.ts:149` 是同一个结论）。
    // ★ 上一版写的是 `imm / 2`（得出 [12,18,24,30,36]），那一组**没有一个**是真图号 ——
    //   症状就是「章名条画成图 2、8 行格图用了不存在的图 6/7」。
    const conv = (imm: number): number => (imm - 0xc) / 12;
    expect([0x18, 0x24, 0x30, 0x3c, 0x48, 0x6c, 0x78].map(conv)).toEqual([1, 2, 3, 4, 5, 8, 9]);
    expect([
      HELP_BG_IMAGE,
      HELP_BAR_IMAGE,
      HELP_ROW_IMAGE,
      HELP_ROW_HOT_IMAGE,
      HELP_ARROW_UP_IMAGE,
      HELP_ARROW_DOWN_IMAGE,
      HELP_SCROLL_UP_IMAGE,
      HELP_SCROLL_DOWN_IMAGE,
    ]).toEqual([conv(0xc), conv(0x18), conv(0x24), conv(0x30), conv(0x3c), conv(0x48), conv(0x6c), conv(0x78)]);
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
  it('★ 六条矩形逐字节对上 dump（22,38,91,361 / 104,78,196,361 / 170,43,192,58 / …）', () => {
    // ★ 0 / 1 是**整列**（y1 = 361 罩到面板下沿）—— 上一版把它们读成
    //   `(77,38,104,78)`，那一组数在 exe 里不存在。
    expect(HELP_HIT_BOXES).toEqual([
      { x0: 22, y0: 38, x1: 91, y1: 361 },
      { x0: 104, y0: 78, x1: 196, y1: 361 },
      { x0: 170, y0: 43, x1: 192, y1: 58 },
      { x0: 170, y0: 59, x1: 192, y1: 74 },
      { x0: 322, y0: 48, x1: 345, y1: 80 },
      { x0: 343, y0: 48, x1: 366, y1: 80 },
    ]);
    // 三组：0 = 左列（整列）、1 = 右列 8 行格图（整段）、2/3 = 上下章、4/5 = 上下滚
    expect(HELP_HIT_BOXES[0]!.y1).toBe(361);
    expect(HELP_HIT_BOXES[1]!.x0).toBe(104);
    expect(HELP_HIT_BOXES[1]!.y0).toBe(HELP_CHIP_AT.y);
  });

  it('★ 六条矩形两两一组：2/3 = 上下章、4/5 = 上下滚（y 上错开、判定顺序不能颠倒）', () => {
    expect(HELP_HIT_BOXES).toHaveLength(6);
    expect(HELP_HIT_BOXES[2]!.y0).toBeLessThan(HELP_HIT_BOXES[3]!.y0);
    expect(HELP_HIT_BOXES[4]!.x0).toBeLessThan(HELP_HIT_BOXES[5]!.x0);
  });

  it('★ 每条的左上角与右下角都算命中（闭区间），框外不算', () => {
    for (const b of HELP_HIT_BOXES) {
      expect(hitHelpBox(b.x0, b.y0), `(${b.x0},${b.y0})`).not.toBeNull();
      expect(hitHelpBox(b.x1, b.y1), `(${b.x1},${b.y1})`).not.toBeNull();
    }
    expect(hitHelpBox(0, 0)).toBeNull();
    expect(hitHelpBox(21, 38)).toBeNull();
    expect(hitHelpBox(23, 37)).toBeNull();
    expect(hitHelpBox(367, 60)).toBeNull();
  });

  it('★ 顺序：先撞上哪条就是哪条（2 压 3、4 压 5）', () => {
    // 第 0 / 1 项是**整列** —— 用下沿验证它们罩到面板底
    expect(hitHelpBox(40, 100)).toBe(0);
    expect(hitHelpBox(40, 360)).toBe(0);
    expect(hitHelpBox(150, 100)).toBe(1);
    expect(hitHelpBox(150, 360)).toBe(1);
    // 2 与 3 不重叠；4 与 5 也不重叠
    expect(hitHelpBox(180, 50)).toBe(2);
    expect(hitHelpBox(180, 60)).toBe(3);
    expect(hitHelpBox(330, 60)).toBe(4);
    expect(hitHelpBox(350, 60)).toBe(5);
  });
});

describe('左列八行命中 @source loc_0044e621（逐行判据）', () => {
  it('★ 每行 = x [26,92) × 36 步：第一条 (26,58)、最后一条 (26,310)', () => {
    // @source 0x0044e621：`cmp esi, 0x1a` / `lea ecx, [36i + 0x3a]` / `cmp esi, 0x5c`
    expect(HELP_SEL_NAME).toEqual({ x: 0x1a, y: 0x3a });
    expect(HELP_NAME_STEP).toBe(36);
    expect(chipY(0)).toBe(58);
    expect(chipY(1)).toBe(94);
    expect(chipY(7)).toBe(310);
    // 章名条与章名同一行（条挂在选中那一行上）
    expect(barAt(0)).toEqual({ x: 26, y: 58 });
    expect(barAt(7)).toEqual({ x: 26, y: 310 });
  });

  it('★ 每行的中心都命中自己；x 出界、y 负数不算', () => {
    for (let i = 0; i < HELP_CHAPTER_COUNT; i++) {
      expect(hitHelpChip(56, chipY(i)), `第 ${i} 行`).toBe(i);
      // 每条高 72、步长 36 —— 中间那段（+36..+71）**归下一条**（x 上是 35 像素重叠区）
      expect(hitHelpChip(56, chipY(i) + 35), `第 ${i} 行中段`).toBe(i);
    }
    expect(hitHelpChip(25, chipY(0))).toBeNull(); // x < 26
    expect(hitHelpChip(92, chipY(0))).toBeNull(); // x >= 92
    expect(hitHelpChip(56, 57)).toBeNull(); // 面板上沿之上
    expect(hitHelpChip(56, 58 + 8 * 36)).toBeNull(); // 第 9 行不存在（只有 8 章）
  });

  it('★ hitHelp 先认左列八行（label 0、cell = 章号），命中表排在其后', () => {
    expect(hitHelp(56, chipY(3))).toEqual({ label: 0, cell: 3 });
    expect(hitHelp(56, 100)).toEqual({ label: 0, cell: 1 }); // y=100 在第二条带上
    // x 落在 26..91 之外、落进命中表第 1 项（右列格图整段）的归那张表
    expect(hitHelp(150, 100)).toEqual({ label: 0, cell: 1 });
    // 命中表第 2 条（170..192）离左列很远，直接归上一章
    expect(hitHelp(180, 50)).toEqual({ label: 1, cell: 0 });
    expect(hitHelp(180, 60)).toEqual({ label: 1, cell: 1 });
    // 上滚 / 下滚（4/5）在右列 x 322..366
    expect(hitHelp(330, 60)).toEqual({ label: 2, cell: 0 });
    expect(hitHelp(350, 60)).toEqual({ label: 2, cell: 1 });
  });
});

describe('右列那 8 行条目 @source loc_0044e301 / 0x44e2b2', () => {
  it('★ 格图 34 步在 (108, 78+34i)、分项名在 (150, 94+34i)', () => {
    // `shl eax, 4 / add eax, ebx / add eax, eax` = ×34
    expect(HELP_CHIP_STEP).toBe(34);
    expect(HELP_CHIP_AT).toEqual({ x: 0x6c, y: 0x4e });
    expect(HELP_CHIP_NAME_AT).toEqual({ x: 0x96, y: 0x5e });
    expect(chipImageAt(0)).toEqual({ x: 108, y: 78 });
    expect(chipImageAt(1)).toEqual({ x: 108, y: 112 });
    expect(chipImageAt(7)).toEqual({ x: 108, y: 316 });
    expect(chipNameAt(0)).toEqual({ x: 150, y: 94 });
    expect(chipNameAt(7)).toEqual({ x: 150, y: 332 });
    // 舞台坐标 = 面板 (20,60) + 局部
    expect(helpChipImageAt(0)).toEqual({ x: 128, y: 138 });
    expect(helpChipNameAt(0)).toEqual({ x: 170, y: 154 });
    // 行距是 34（**不是**左列那 36）—— 两套都在 exe 里
    expect(HELP_CHIP_STEP).not.toBe(HELP_NAME_STEP);
  });

  it('★ 分项名是**每章一张指针数组**（+0x04），不是一张固定表', () => {
    // 第 2 章（遊戲指令）那 8 项里没有一个「遊戲操作」
    expect(HELP_CHAPTER_ITEMS).toHaveLength(HELP_CHAPTER_COUNT);
    expect(chapterItem(0, 0)).toBe('遊戲操作');
    expect(chapterItem(2, 2)).toBe('卡片');
    expect(chapterItem(7, 0)).toBe('工程車');
    // `itemAt` 是绘制那一层用的同一个函数（名字不同是为了强调「已加过 scroll」）
    expect(itemAt(2, 2)).toBe(chapterItem(2, 2));
    expect(itemAt(2, 8)).toBe('查詢'); // ★ 第 2 章有 **12** 条（先前手抄成 8 条）
    expect(chapterItem(7, 7)).toBe('傳送機'); // 第 7 章 13 条
    expect(chapterItem(7, 12)).toBe('機器娃娃');
    expect(chapterItem(6, 29)).toBe('轉向卡'); // 第 6 章 30 条
    expect(chapterItem(6, 30)).toBe(''); // 越界
    expect(HELP_INDEX_NAMES).toEqual(HELP_CHAPTER_ITEMS[0]);
    // 序号越界给空串，不炸
    expect(chapterItem(0, 99)).toBe('');
    expect(chapterItem(0, 8)).toBe('');
    // 章号与别处同口径（`clampChapter` 夹到 0..7）
    expect(chapterItem(99, 0)).toBe(chapterItem(7, 0));
  });

  it('★ 行数 = min(一屏 14, **该章资源数**)：第 0 章（资源数 1）一行都不画', () => {
    // @source `loc_0044e301` 的 `cmp esi, [eax*4 + 0x4761c0] / jge 0x44e376`
    //   —— 比的是 entry+0x0C（该章占几个资源），不是分项表的长度。
    expect(chapterItemCount(0)).toBe(1);
    expect(HELP_CHAPTERS[0]!.resCount).toBe(1);
    expect(chapterHasItems(0)).toBe(false);
    expect(chapterHasItems(1)).toBe(false);
    expect(chapterHasItems(3)).toBe(false);
    expect(chapterHasItems(6)).toBe(true);
    // 资源数 1 / 6 / 3 —— 都 <= 8 → 那三章一行都不画
    expect(chapterItemCount(0)).toBe(1);
    expect(chapterItemCount(1)).toBe(6);
    expect(chapterItemCount(3)).toBe(3);
    expect(chapterItemCount(2)).toBe(12);
    expect(chapterItemCount(6)).toBe(30);
    // 两个循环都硬编码 8 行（与 `HELP_CHIP_STEP = 34` 配套）
    expect(HELP_LIST_ROWS).toBe(8);
    // 格图那一层：0/1/3 章 0 张，2 章 8 张（12 > 8），6/7 章也都是 8 张
    for (const [ch, want] of [[0, 0], [1, 0], [3, 0], [2, 8], [6, 8], [7, 8]] as const) {
      const n = helpImagePlan(ch, 0).filter((g) => g.why === 'chip' || g.why === 'chipHot').length;
      expect(n, `第 ${ch} 章的格图数`).toBe(want);
    }
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

  it('★ 上滚 / 下滚：步长 = 一屏 14 行、夹在 [0, maxScroll]（不是取整跳到顶/底）', () => {
    const { env } = mkEnv();
    helpScreen.toolbar?.(0, env);
    // 第 2 章 maxScroll = 88 → 0 / 14 / … / 70 / 84 / 88（最后一步落到 88 而不是 98）
    applyHelpHit({ label: 0, cell: 2 }, env); // 直接跳第 2 章
    expect(helpPosition()).toEqual({ chapter: 2, scroll: 0 });
    for (let k = 14; k <= 70; k += 14) {
      applyHelpHit({ label: 2, cell: 1 }, env);
      expect(helpPosition().scroll, `第 ${k / 14} 步`).toBe(k);
    }
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(84);
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(88); // 夹到 maxScroll
    applyHelpHit({ label: 2, cell: 1 }, env);
    expect(helpPosition().scroll).toBe(88); // 到底了不动
    applyHelpHit({ label: 2, cell: 0 }, env);
    expect(helpPosition().scroll).toBe(74);
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
  it('★ 八章的 maxScroll 与行数逐条对上（行数 − 一屏 14 行，本模块口径）', () => {
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

  it('★ 屏数 = floor(maxScroll / 14) + 1，八章依次 1/7/7/13/5/8/24/10', () => {
    expect(HELP_CHAPTER_COUNT).toBe(8);
    expect(Array.from({ length: 8 }, (_, i) => pageCount(i))).toEqual([
      1, 7, 7, 13, 5, 8, 24, 10,
    ]);
    for (let i = 0; i < HELP_CHAPTER_COUNT; i++) {
      const max = HELP_CHAPTERS[i]!.maxScroll;
      expect(pageCount(i)).toBe(Math.trunc(max / HELP_SCROLL_STEP) + 1);
    }
  });

  it('★ 屏号夹取到 [0, pageCount−1] 对应的行偏移', () => {
    // 第 2 章（遊戲指令）88 = 6×14 + 4 → 第 7 屏从 84 起，再往后夹到 88
    expect(HELP_CHAPTERS[2]!.maxScroll).toBe(88);
    expect(scrollOfPage(2, 6)).toBe(84);
    expect(scrollOfPage(2, 999)).toBe(88);
    expect(scrollOfPage(2, -3)).toBe(0);
    // 第 6 章（卡片）324 = 23*14 + 2 → 最后一屏从 322 起，再往后夹到 324
    expect(scrollOfPage(6, 23)).toBe(322);
    expect(pageOf(6, 324)).toBe(23);
    expect(pageOf(6, 900)).toBe(23); // 夹到 324
  });

  it('★ 每一屏刚好取 14 行；`@` 分页行留在里面（由绘制那一步跳过）', () => {
    expect(HELP_TEXT.rows).toBe(14);
    expect(HELP_SCROLL_STEP).toBe(14);
    expect(visibleLines(6, 0)).toHaveLength(14);
    expect(visibleLines(6, HELP_CHAPTERS[6]!.maxScroll)).toHaveLength(14);
    // 第 1 章第 10 行（0 基 index 9）就是分页标记 @，第 10 行起才看得见
    expect(chapterLines(1)[9]).toBe('@');
    // 第 1 章的 `@` 在 index 9 → 第 1 屏（0..13）里**看得见**它
    expect(chapterLines(1).slice(0, 14)).toContain('@');
    expect(visibleLines(1, 0)).toContain('@');
    // 第 3 章（房地產）的 `@` 在 26 / 202 → 第 1 屏里没有
    expect(chapterLines(3).slice(0, 14)).not.toContain('@');
  });

  it('★ 「还能往下」：没到底就有；到底且当屏没有 @ 就没有', () => {
    expect(hasMoreBelow(6, 0)).toBe(true);
    expect(hasMoreBelow(6, 324)).toBe(false);
    // 第 1 章 maxScroll 96、共 104 行 → 从 14 起还剩很多，当然还有
    expect(hasMoreBelow(1, 14)).toBe(true);
    expect(hasMoreBelow(0, 0)).toBe(false); // 操作說明只有 4 行，一屏就完
    // 第 2 章从 88 起只有 14 行、当屏没有 @（@ 在 index 9/23/…）→ 不再有
    expect(hasMoreBelow(2, 88)).toBe(false);
  });
});

describe('版面落点 @source 0x44e024 / 0x44e11f / 0x44e14e', () => {
  it('★ 正文：落点 (+232, +90)、行距 18、一屏 14 行', () => {
    // @source 0x44e1d1 / 0x44e1d7；`cmp ebx, 0xd` 那一步画完第 14 行就停
    expect(HELP_TEXT).toEqual({ dx: 232, dy: 90, lineH: 18, rows: 14 });
    expect(lineAt(0)).toEqual({ x: 232, y: 90 });
    expect(lineAt(13)).toEqual({ x: 232, y: 90 + 13 * 18 });
  });

  it('★ 两颗三角在 (+170, +43) / (+170, +59)', () => {
    expect(HELP_ARROW_UP_AT).toEqual({ x: 170, y: 43 });
    expect(HELP_ARROW_DOWN_AT).toEqual({ x: 170, y: 59 });
    expect(helpArrowUpAt()).toEqual({ x: 190, y: 103 });
    expect(helpArrowDownAt()).toEqual({ x: 190, y: 119 });
  });

  it('★ 左列第 i 行的屏幕落点 = 面板 (20,60) + 局部 (26, 58 + 36i)', () => {
    expect(chipAt(0)).toEqual({ x: 26, y: 58 });
    expect(chipAt(7)).toEqual({ x: 26, y: 310 });
    expect(helpChipAt(0)).toEqual({ x: 46, y: 118 });
    expect(helpChipAt(7)).toEqual({ x: 46, y: 370 });
  });

  it('★ 章名条挂在选中那一章那一行 (26, 58 + 36c) @source 0x44e04d / 0x44e056', () => {
    expect(HELP_BAR_AT).toEqual({ x: 0x1a, y: 0x3a });
    expect(HELP_NAME_STEP).toBe(36);
    expect(barAt(0)).toEqual({ x: 26, y: 58 });
    expect(barAt(7)).toEqual({ x: 26, y: 310 });
    expect(barAt(3)).toEqual({ x: 26, y: 58 + 36 * 3 });
  });

  it('★ 八行章名：选中 (26, 58+36c)、其余 (59, 73+36i) @0x44e08c / @0x44e092', () => {
    expect(HELP_SEL_NAME).toEqual({ x: 0x1a, y: 0x3a });
    expect(HELP_ROW_NAME).toEqual({ x: 0x3b, y: 0x49 });
    expect(HELP_ROW_NAME.x - HELP_SEL_NAME.x).toBe(33);
    expect(chapterNameAt(0, true)).toEqual({ x: 26, y: 58 });
    expect(chapterNameAt(0, false)).toEqual({ x: 59, y: 73 });
    expect(chapterNameAt(7, false)).toEqual({ x: 59, y: 73 + 36 * 7 });
  });

  it('★ 右列两行标题：(140, 57) 那一行 + 章内小标题 (270, 63)', () => {
    expect(HELP_INDEX_AT).toEqual({ x: 0x8c, y: 0x39 });
    expect(HELP_SUB_INDEX_AT).toEqual({ x: 0x10e, y: 0x3f });
    expect(HELP_SUB_INDEX_AT).toEqual({ x: 270, y: 63 });
    // 兜底字面是第 0 章那张分项表的表头
    expect(HELP_INDEX_LABEL).toBe('遊戲操作');
    expect(HELP_INDEX_NAMES[0]).toBe('遊戲操作');
    // ★ 第 0 章（操作說明）只有 **1** 条分项 —— 数组长度 = 该章资源数，不是写死的 8
    expect(HELP_INDEX_NAMES).toHaveLength(1);
  });

  it('★ 8 行格图：常态 2、选中 3（高度 33）@0x44e362 / @0x44e34a', () => {
    expect(chipImage(0, true)).toBe(HELP_ROW_HOT_IMAGE);
    expect(chipImage(3, false)).toBe(HELP_ROW_IMAGE);
    expect(chipImage(0, true)).toBe(3);
    expect(chipImage(3, false)).toBe(2);
    expect(HELP_CHIP_H).toBe(33); // 图 2 = 85×33 / 图 3 = 87×33
  });

  it('★ 右列上滚 / 下滚三角在 (322, 48) / (343, 48)，与命中框同点', () => {
    // @source 0x476294 / 0x4762a4 那两组数 —— **画与命中现在对得上**（D-045-3 作废）
    expect(HELP_SCROLL_UP_AT).toEqual({ x: 0x142, y: 0x30 });
    expect(HELP_SCROLL_DOWN_AT).toEqual({ x: 0x157, y: 0x30 });
    expect(scrollUpAt()).toEqual({ x: 322, y: 48 });
    expect(scrollDownAt()).toEqual({ x: 343, y: 48 });
    expect(helpScrollUpAt()).toEqual({ x: 342, y: 108 });
    expect(helpScrollDownAt()).toEqual({ x: 363, y: 108 });
    // 命中表第 4 / 5 项的左上角就是画点
    expect({ x: HELP_HIT_BOXES[4]!.x0, y: HELP_HIT_BOXES[4]!.y0 }).toEqual(scrollUpAt());
    expect({ x: HELP_HIT_BOXES[5]!.x0, y: HELP_HIT_BOXES[5]!.y0 }).toEqual(scrollDownAt());
  });
});

describe('★ 整屏登记 @source 回调 loc_0044e488 / loc_0044e546', () => {
  it('★ `windowed: true` —— 原版从不擦屏，靠存底/还原（fcn_00451e7e / fcn_00451edb）', () => {
    // 少了它 `main.ts` 不会先画棋盘，面板四周就是纯黑（本卡报的第 1 条）。
    expect(helpScreen.windowed).toBe(true);
    // @source 回调 WM_CREATE loc_0044e488 里 `call fcn_00451e7e`（存底）
    //         回调 WM_RBUTTONUP loc_0044e546 里 `call fcn_00451edb`（还原 + Post）
  });
});

describe('★ 图素计划 `helpImagePlan`（纯函数，绘制的唯一真源）', () => {
  it('★ 底图 (0,0) + 章名条 (26, 58+36c) —— 都在面板局部坐标', () => {
    const plan = helpImagePlan(3, 0);
    expect(plan[0]).toEqual({ image: HELP_BG_IMAGE, x: 0, y: 0, why: 'bg' });
    expect(plan[1]).toEqual({ image: HELP_BAR_IMAGE, x: 26, y: 58 + 36 * 3, why: 'bar' });
    // 第 0 章：条在第 0 行
    expect(helpImagePlan(0, 0)[1]).toEqual({ image: HELP_BAR_IMAGE, x: 26, y: 58, why: 'bar' });
  });

  it('★ 格图落在 (108, 78 + 34i)：当前那一条用图 3，其余用图 2', () => {
    // 第 6 章（卡片）资源数 30 > 8 → 铺 8 行（两轮都硬编码 8）
    const plan = helpImagePlan(6, 0);
    const chips = plan.filter((g) => g.why === 'chip' || g.why === 'chipHot');
    expect(chips).toHaveLength(8);
    expect(chips[0]).toEqual({ image: HELP_ROW_HOT_IMAGE, x: 108, y: 78, why: 'chipHot' });
    expect(chips[1]).toEqual({ image: HELP_ROW_IMAGE, x: 108, y: 112, why: 'chip' });
    expect(chips[7]).toEqual({ image: HELP_ROW_IMAGE, x: 108, y: 78 + 34 * 7, why: 'chip' });
    // 图片号就是 exe 那两个（3 = 选中、2 = 常态）
    expect(chips[0]!.image).toBe(3);
    expect(chips.slice(1).every((g) => g.image === 2)).toBe(true);
  });

  it('★ 滚到第 2 屏时选中标记跟着 `scroll` 走，格图坐标不变', () => {
    const plan = helpImagePlan(6, 14);
    const chips = plan.filter((g) => g.why === 'chip' || g.why === 'chipHot');
    expect(chips).toHaveLength(8);
    expect(chips[0]!.why).toBe('chipHot'); // `scroll + i === scroll` 那一条
    expect(chips[0]!.y).toBe(78); // 落点只与 i 有关
  });

  it('★ 第 0 章（操作說明，资源数 1）一行格图都不画', () => {
    const plan = helpImagePlan(0, 0);
    expect(plan.filter((g) => g.why === 'chip' || g.why === 'chipHot')).toEqual([]);
    // 第 0 章的 `@` 分页行不在前 14 行里，所以两条「还能往下」的三角都不该出现
    const arrows = plan.filter((g) => g.why === 'arrowUp' || g.why === 'arrowDown');
    expect(arrows).toEqual([]);
  });

  it('★ 上滚 / 下滚三角（图 8 / 9）在 (322,48) / (343,48)，与命中框同点', () => {
    // 第 6 章 scroll=0：上滚不画（scroll 为 0）、下滚画（还有内容）
    const at0 = helpImagePlan(6, 0);
    expect(at0.some((g) => g.why === 'scrollUp')).toBe(false);
    expect(at0.find((g) => g.why === 'scrollDown')).toEqual({
      image: HELP_SCROLL_DOWN_IMAGE, x: 322 + 21, y: 48, why: 'scrollDown',
    });
    // 滚到中间：两颗都画
    const mid = helpImagePlan(6, 14);
    expect(mid.find((g) => g.why === 'scrollUp')).toEqual({
      image: HELP_SCROLL_UP_IMAGE, x: 322, y: 48, why: 'scrollUp',
    });
    expect(mid.find((g) => g.why === 'scrollDown')).toEqual({
      image: HELP_SCROLL_DOWN_IMAGE, x: 343, y: 48, why: 'scrollDown',
    });
  });

  it('★ 中部「上一章 / 下一章」三角（图 4 / 5）在 (170,43) / (170,59)', () => {
    // scroll=0 → 上一章不画；第 6 章还有内容 → 下一章画
    const at0 = helpImagePlan(6, 0);
    expect(at0.some((g) => g.why === 'arrowUp')).toBe(false);
    expect(at0.find((g) => g.why === 'arrowDown')).toEqual({
      image: HELP_ARROW_DOWN_IMAGE, x: 170, y: 59, why: 'arrowDown',
    });
    const mid = helpImagePlan(6, 14);
    expect(mid.find((g) => g.why === 'arrowUp')).toEqual({
      image: HELP_ARROW_UP_IMAGE, x: 170, y: 43, why: 'arrowUp',
    });
  });

  it('★ `drawHelpScreen` 就是把计划铺上去（含面板偏移），并跳过缺图', () => {
    const ctx = {
      drawImage: (b: { image: number }, x: number, y: number) => {
        drawn.push({ image: b.image, x, y });
      },
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      strokeText: () => undefined,
      fillText: () => undefined,
    } as unknown as CanvasRenderingContext2D;
    const drawn: { image: number; x: number; y: number }[] = [];
    // 面板落点 (20,60) —— 图素要比计划多这一对偏移
    drawHelpScreen(ctx, (i) => ({ bitmap: { image: i } as unknown as ImageBitmap, anchorX: 0, anchorY: 0 }), {
      chapter: 6,
      scroll: 0,
      origin: { x: 20, y: 60 },
    });
    expect(drawn[0]).toEqual({ image: HELP_BG_IMAGE, x: 20, y: 60 });
    expect(drawn.find((d) => d.image === HELP_BAR_IMAGE)).toEqual({
      image: HELP_BAR_IMAGE, x: 20 + 26, y: 60 + 58 + 36 * 6,
    });
    expect(drawn.find((d) => d.image === HELP_ROW_HOT_IMAGE)).toEqual({
      image: HELP_ROW_HOT_IMAGE, x: 20 + 108, y: 60 + 78,
    });
    // 第 6 章资源数 30 > 8 → 8 张格图
    expect(drawn.filter((d) => d.image === HELP_ROW_IMAGE || d.image === HELP_ROW_HOT_IMAGE)).toHaveLength(8);
    // 缺图（sprite() 给 null）时静默跳过，不炸
    expect(() =>
      drawHelpScreen(ctx, () => null, { chapter: 0, scroll: 0, origin: { x: 20, y: 60 } }),
    ).not.toThrow();
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

// ============================================================
//  ★ 2026-09-16：分项名从 exe 生成（每章 = 该章**资源数**条，不是写死的 8 条）
//    以及「行偏移 → 条目号」的换算 —— 右列靠它才跟得上正文
// ============================================================

describe('★ 分项名与条目行数 @source `entry+0x04` / `+0x0C`', () => {
  it('★★ 每章的分项名条数 **= 该章资源数**（1/6/12/3/16/18/30/13）', () => {
    const want = [1, 6, 12, 3, 16, 18, 30, 13];
    for (let ch = 0; ch < 8; ch++) {
      expect(HELP_CHAPTER_ITEMS[ch as 0]!.length, `第 ${ch} 章`).toBe(want[ch]);
      // 与条目表那一路同口径（先前手抄成「每章 8 条」，第 8 条之后就是空的）
      expect(chapterItemCount(ch)).toBe(want[ch]);
    }
    // 第 6 章（卡片）有一条 **30** 项 —— 先前那一版只到第 8 项
    expect(chapterItem(6, 29)).toBe('轉向卡');
    expect(chapterItem(6, 8)).toBe('怪獸卡');
  });

  it('★★ 每章每条目几行（`HELP_ITEM_LINES`）之和 = 该章正文总行数', () => {
    for (let ch = 0; ch < 8; ch++) {
      const sum = (HELP_ITEM_LINES[ch as 0] ?? []).reduce((a, b) => a + b, 0);
      expect(sum, `第 ${ch} 章`).toBe(chapterLines(ch).length);
      // 条数也必须一致
      expect(HELP_ITEM_LINES[ch as 0]!.length).toBe(HELP_CHAPTER_ITEMS[ch as 0]!.length);
    }
  });

  it('★★ `itemTopOfLine`：行偏移落在第几条（右列窗口的基准）', () => {
    // 第 6 章（卡片）每条 9..14 行
    expect(itemTopOfLine(6, 0)).toBe(0);
    expect(itemTopOfLine(6, 11)).toBe(0); // 第 0 条 12 行 → 第 11 行还在第 0 条
    expect(itemTopOfLine(6, 12)).toBe(1); // 第 12 行 = 第 1 条的第一行
    expect(itemTopOfLine(6, 23)).toBe(2);
    // 越界先被 `clampScroll` 夹到 `maxScroll = 行数 − 14`，再换算成条目号
    //（第 6 章 338 行 → maxScroll 324，落在倒数第 2 条上，因为最后 14 行一起显示）
    expect(itemTopOfLine(6, 9999)).toBe(28);
    // 没分项的那几章（资源数 ≤ 8）也不炸：第 0 章只有 1 条
    expect(itemTopOfLine(0, 0)).toBe(0);
    expect(itemTopOfLine(0, 3)).toBe(0);
  });

  it('★ 右列那 8 行分项名跟着正文走（不再固定从第 scroll 条查）', () => {
    // `scroll` 是**行**偏移：第 6 章第 80 行落在第 k 条上，窗口就从第 k 条起
    const k = itemTopOfLine(6, 80);
    const namesAt80 = Array.from({ length: 8 }, (_, i) => itemAt(6, k + i));
    // 与「直接从 0 条起」明显不同（先前那一版就是后者，于是越滚越空）
    expect(namesAt80[0]).not.toBe(itemAt(6, 0));
    expect(namesAt80.every((n) => n !== '')).toBe(true);
  });
});
