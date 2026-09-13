/*
 * 卡片实现清单 —— 每一项都由原版 exe 反汇编确认
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 数据来源：从 `rich4.exe` 的 `card_functions[]`（VA 0x475d5c）读出各卡
 *   效果函数地址，再逐个反汇编取其入口特征。
 *   复核方式：`python3 tools/disasm.py card <N>`
 *
 * ⚠️ 不采信 `csrc/cards.c`（2018 旧版）—— 已证实其均富卡公式有误
 *   （docs/reverse-engineering-audit.md 错误 #7）。
 */

/** 目标选择的调用方式 */
export type SelectionKind =
  /** 无需选择目标 */
  | 'none'
  /** 人类走鼠标选择 `0x446ae8`，电脑走 `0x41e6f2` */
  | 'ui'
  /** 仅电脑参数取值 `0x41e6f2` */
  | 'ai';

export interface CardImpl {
  /** 卡片编号（1 基），与 CARDS 表对应 */
  id: number;
  name: string;
  /** 效果函数在原版 exe 中的虚拟地址 */
  va: number;
  selection: SelectionKind;
  /**
   * 选择模式参数（传给 `0x446ae8` 的立即数）。
   * 形如 `0xe0c0XYZ`。**低 16 位的确切位含义待确认**，
   * 但已观察到明显分组，见 SELECTION_GROUPS。
   */
  selectionParam: number | null;
  /**
   * 被动卡：主动使用时函数为 `xor eax,eax; ret`（VA 0x004420d5）直接返回 0，
   * 实际效果在别处自动触发（`rich4_card_passive.asm`）。
   */
  passive: boolean;
  /** 本项目的实现状态 */
  status: 'done' | 'todo';
}

/** 被动卡的空桩地址 @source 反汇编 0x004420d5 = `xor eax, eax; ret` */
export const PASSIVE_STUB_VA = 0x004420d5;

/**
 * 观察到的选择模式分组。
 *
 * ⚠️ 位含义**未证实**，这里只登记实测到的取值与其对应卡片，
 * 供后续实现目标选择机制时参考。
 */
export const SELECTION_GROUPS: Readonly<Record<number, string>> = {
  0xe0c0010: '任意玩家（含自己）—— 转向/停留/乌龟',
  0xe0c0410: '玩家 —— 均贫/抢夺/查税/同盟',
  0xe0c0710: '玩家 —— 梦游/陷害',
  0xe0c0202: '地块 —— 换地/换屋',
  0xe0c0006: '地块 —— 天使/恶魔/涨价/查封',
  0xe0c0506: '地块 —— 怪兽',
  0xe0c0626: '地块 —— 拆除',
};

/** 30 张卡片的实现清单 */
export const CARD_IMPLS: readonly CardImpl[] = [
  { id: 1,  name: '均富卡', va: 0x004420d8, selection: 'none', selectionParam: null,       passive: false, status: 'done' },
  { id: 2,  name: '均貧卡', va: 0x004421b4, selection: 'ui',   selectionParam: 0xe0c0410, passive: false, status: 'done' },
  { id: 3,  name: '購地卡', va: 0x00442325, selection: 'none', selectionParam: null,       passive: false, status: 'done' },
  { id: 4,  name: '換地卡', va: 0x00442622, selection: 'ui',   selectionParam: 0xe0c0202, passive: false, status: 'done' },
  { id: 5,  name: '換屋卡', va: 0x00442b02, selection: 'ui',   selectionParam: 0xe0c0202, passive: false, status: 'done' },
  { id: 6,  name: '轉向卡', va: 0x00442f4d, selection: 'ui',   selectionParam: 0xe0c0010, passive: false, status: 'done' },
  { id: 7,  name: '改建卡', va: 0x0044309b, selection: 'none', selectionParam: null,       passive: false, status: 'done' },
  { id: 8,  name: '拍賣卡', va: 0x00443225, selection: 'none', selectionParam: null,       passive: false, status: 'done' },
  { id: 9,  name: '天使卡', va: 0x004434c0, selection: 'ui',   selectionParam: 0xe0c0006, passive: false, status: 'done' },
  { id: 10, name: '惡魔卡', va: 0x004436e0, selection: 'ui',   selectionParam: 0xe0c0006, passive: false, status: 'done' },
  { id: 11, name: '怪獸卡', va: 0x00443917, selection: 'ui',   selectionParam: 0xe0c0506, passive: false, status: 'done' },
  { id: 12, name: '拆除卡', va: 0x00443b0f, selection: 'ui',   selectionParam: 0xe0c0626, passive: false, status: 'done' },
  { id: 13, name: '搶奪卡', va: 0x00443e3d, selection: 'ui',   selectionParam: 0xe0c0410, passive: false, status: 'done' },
  { id: 14, name: '停留卡', va: 0x00443f80, selection: 'ui',   selectionParam: 0xe0c0010, passive: false, status: 'done' },
  { id: 15, name: '冬眠卡', va: 0x004440ea, selection: 'none', selectionParam: null,       passive: false, status: 'done' },
  { id: 16, name: '夢遊卡', va: 0x004441dc, selection: 'ui',   selectionParam: 0xe0c0710, passive: false, status: 'done' },
  { id: 17, name: '陷害卡', va: 0x004444bf, selection: 'ui',   selectionParam: 0xe0c0710, passive: false, status: 'done' },
  // ── 以下四张为**被动卡**：主动使用直接返回 0 ──
  //
  // ★ 它们的 `status: 'done'` 指的是**触发机制已实现**，
  //   而不是「卡片函数已移植」——原版这四项都指向同一个空桩
  //   `xor eax,eax; ret`，本来就没有可移植的函数体。
  //   真正的效果分散在各个触发点：
  //     復仇18 → cards/sleepwalk.ts（有害卡反弹给出牌者）
  //     嫁禍19 → cards/frame.ts（改写目标）、cards/passive.ts（过路费换付款人）
  //     免費20 → cards/passive.ts（过路费归零）、cards/tax.ts
  //     免罪21 → cards/frame.ts（免疫并中止）
  //   两个触发点（有害卡命中 / 付过路费）见 cards/passive.ts 顶部说明。
  { id: 18, name: '復仇卡', va: PASSIVE_STUB_VA, selection: 'none', selectionParam: null, passive: true, status: 'done' },
  { id: 19, name: '嫁禍卡', va: PASSIVE_STUB_VA, selection: 'none', selectionParam: null, passive: true, status: 'done' },
  { id: 20, name: '免費卡', va: PASSIVE_STUB_VA, selection: 'none', selectionParam: null, passive: true, status: 'done' },
  { id: 21, name: '免罪卡', va: PASSIVE_STUB_VA, selection: 'none', selectionParam: null, passive: true, status: 'done' },
  { id: 22, name: '送神符', va: 0x00444c45, selection: 'none', selectionParam: null,       passive: false, status: 'done' },
  { id: 23, name: '請神符', va: 0x00444e1a, selection: 'ai',   selectionParam: null,       passive: false, status: 'done' },
  { id: 24, name: '紅卡',   va: 0x00444f25, selection: 'ai',   selectionParam: null,       passive: false, status: 'done' },
  { id: 25, name: '黑卡',   va: 0x0044503f, selection: 'ai',   selectionParam: null,       passive: false, status: 'done' },
  { id: 26, name: '查稅卡', va: 0x004451f0, selection: 'ui',   selectionParam: 0xe0c0410, passive: false, status: 'done' },
  { id: 27, name: '漲價卡', va: 0x0044542d, selection: 'ui',   selectionParam: 0xe0c0006, passive: false, status: 'done' },
  { id: 28, name: '查封卡', va: 0x00445593, selection: 'ui',   selectionParam: 0xe0c0006, passive: false, status: 'done' },
  { id: 29, name: '同盟卡', va: 0x00445710, selection: 'ui',   selectionParam: 0xe0c0410, passive: false, status: 'done' },
  { id: 30, name: '烏龜卡', va: 0x004458df, selection: 'ui',   selectionParam: 0xe0c0010, passive: false, status: 'done' },
] as const;

/** 被动卡的编号 */
export const PASSIVE_CARD_IDS: readonly number[] = CARD_IMPLS.filter((c) => c.passive).map((c) => c.id);

/** 无需目标选择的卡片编号（最容易实现的一批） */
export const NO_SELECTION_CARD_IDS: readonly number[] = CARD_IMPLS
  .filter((c) => !c.passive && c.selection === 'none')
  .map((c) => c.id);

export function cardImpl(id: number): CardImpl | undefined {
  return CARD_IMPLS.find((c) => c.id === id);
}
