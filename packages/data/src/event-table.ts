/*
 * 新聞／命運事件表 —— 结构与数值，**不含原文**
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 由 rich4.exe 的两张函数指针表提取：
 *   新聞 `events_calls_table[]`  @ VA 0x00475e24（36 项）
 *   命運 `fortune_call_table[]`  @ VA 0x00475ef0（37 项）
 *   复核：`python3 tools/disasm.py scan news all` / `scan fortune all`
 *
 * ⚠️ **本表刻意不收录事件文案。**
 *   那 73 句提示语是大宇／软星的著作权内容，按 C-LEG-2
 *   不得进入本仓库。此处只记录**结构性事实**：
 *   效果函数地址、金额系数、以及文案在 exe 中的位置。
 *   文案由程序在运行时从**玩家自备的原版目录**读取（C-LEG-3），
 *   与图素、音乐的处理方式一致。
 *
 * `factor` 的含义：该事件的金额 = `物价指数 × factor`。
 *   来源是各事件函数里那串 `shl/add/sub` 移位链——原版用移位凑乘法，
 *   没有现成的立即数可读，故由符号执行还原。
 *   `null` 表示该事件不涉及固定金额（可能是百分比、天数，或无金额）。
 */

/** 一条事件的结构信息 */
export interface EventEntry {
  id: number;
  /** 效果函数在原版 exe 中的虚拟地址 */
  va: number;
  /** 金额系数：金额 = 物价指数 × factor；null 表示不适用 */
  factor: number | null;
  /** 提示文案在 exe 数据段中的虚拟地址（**文本本身不入库**） */
  textVa: number;
}

/** 新聞事件，36 项 */
export const NEWS_EVENTS: readonly EventEntry[] = [
  { id: 0, va: 0x00448eca, factor: null, textVa: 0x465424 },
  { id: 1, va: 0x00448f45, factor: null, textVa: 0x46543a },
  { id: 2, va: 0x00449006, factor: null, textVa: 0x465454 },
  { id: 3, va: 0x00449081, factor: null, textVa: 0x46546c },
  { id: 4, va: 0x0044913d, factor: null, textVa: 0x465488 },
  { id: 5, va: 0x004492a0, factor: null, textVa: 0x46549c },
  { id: 6, va: 0x004494e0, factor: null, textVa: 0x4654bd },
  { id: 7, va: 0x00449735, factor: null, textVa: 0x4654e4 },
  { id: 8, va: 0x004498b3, factor: 10000, textVa: 0x465501 },
  { id: 9, va: 0x00449a8a, factor: 5000, textVa: 0x465528 },
  { id: 10, va: 0x00449b9c, factor: 10000, textVa: 0x46554f },
  { id: 11, va: 0x00449c7c, factor: null, textVa: 0x465578 },
  { id: 12, va: 0x00449de6, factor: null, textVa: 0x4655ac },
  { id: 13, va: 0x0044a029, factor: null, textVa: 0x4655d4 },
  { id: 14, va: 0x0044a220, factor: null, textVa: 0x4655fc },
  { id: 15, va: 0x0044a453, factor: null, textVa: 0x465624 },
  { id: 16, va: 0x0044a5d6, factor: null, textVa: 0x465645 },
  { id: 17, va: 0x0044a657, factor: null, textVa: 0x465662 },
  { id: 18, va: 0x0044a6e0, factor: null, textVa: 0x46567f },
  { id: 19, va: 0x0044a91e, factor: null, textVa: 0x465697 },
  { id: 20, va: 0x0044ab2c, factor: null, textVa: 0x4656af },
  { id: 21, va: 0x0044ac99, factor: null, textVa: 0x4656d0 },
  { id: 22, va: 0x0044ae89, factor: null, textVa: 0x4656ef },
  { id: 23, va: 0x0044aedb, factor: null, textVa: 0x46570b },
  { id: 24, va: 0x0044b00a, factor: null, textVa: 0x46573c },
  { id: 25, va: 0x0044b055, factor: null, textVa: 0x465756 },
  { id: 26, va: 0x0044b0a0, factor: null, textVa: 0x465770 },
  { id: 27, va: 0x0044b0d1, factor: null, textVa: 0x465788 },
  { id: 28, va: 0x0044b1a3, factor: null, textVa: 0x4657a2 },
  { id: 29, va: 0x0044b25b, factor: null, textVa: 0x4657ba },
  { id: 30, va: 0x0044b374, factor: null, textVa: 0x4657db },
  { id: 31, va: 0x0044b419, factor: null, textVa: 0x4657fb },
  { id: 32, va: 0x0044b4a8, factor: null, textVa: 0x465817 },
  { id: 33, va: 0x0044b53f, factor: null, textVa: 0x465833 },
  { id: 34, va: 0x0044b57d, factor: null, textVa: 0x465855 },
  { id: 35, va: 0x0044b5f5, factor: null, textVa: 0x465874 },
];

/** 命運事件，37 项 */
export const FORTUNE_EVENTS: readonly EventEntry[] = [
  { id: 0, va: 0x0044be16, factor: null, textVa: 0x465915 },
  { id: 1, va: 0x0044bfb1, factor: null, textVa: 0x46592b },
  { id: 2, va: 0x0044c0e8, factor: 10000, textVa: 0x465941 },
  { id: 3, va: 0x0044c229, factor: null, textVa: 0x465959 },
  { id: 4, va: 0x0044c2c2, factor: null, textVa: 0x46597a },
  { id: 5, va: 0x0044c3b7, factor: null, textVa: 0x4659a4 },
  { id: 6, va: 0x0044c5d8, factor: null, textVa: 0x4659d8 },
  { id: 7, va: 0x0044c6ed, factor: null, textVa: 0x4659ee },
  { id: 8, va: 0x0044c7ef, factor: null, textVa: 0x465a04 },
  { id: 9, va: 0x0044c91f, factor: null, textVa: 0x465a28 },
  { id: 10, va: 0x0044ca46, factor: null, textVa: 0x465a3e },
  { id: 11, va: 0x0044cb53, factor: null, textVa: 0x465a50 },
  { id: 12, va: 0x0044cc53, factor: null, textVa: 0x465a66 },
  { id: 13, va: 0x0044cd6c, factor: null, textVa: 0x465a7c },
  { id: 14, va: 0x0044cd99, factor: 3000, textVa: 0x465a94 },
  { id: 15, va: 0x0044cf1e, factor: 3000, textVa: 0x465aae },
  { id: 16, va: 0x0044d06d, factor: 3000, textVa: 0x465acd },
  { id: 17, va: 0x0044d0d6, factor: 6000, textVa: 0x465ae3 },
  { id: 18, va: 0x0044d1a5, factor: 600, textVa: 0x465b00 },
  { id: 19, va: 0x0044d1e0, factor: 1500, textVa: 0x465b16 },
  { id: 20, va: 0x0044d224, factor: 1000, textVa: 0x465b35 },
  { id: 21, va: 0x0044d33b, factor: 2000, textVa: 0x465b49 },
  { id: 22, va: 0x0044d3db, factor: 3000, textVa: 0x465b5d },
  { id: 23, va: 0x0044d41e, factor: 1000, textVa: 0x465b71 },
  { id: 24, va: 0x0044d462, factor: 2000, textVa: 0x465b87 },
  { id: 25, va: 0x0044d4a6, factor: 10000, textVa: 0x465b9d },
  { id: 26, va: 0x0044d4e7, factor: 8000, textVa: 0x465bb3 },
  { id: 27, va: 0x0044d52b, factor: 4000, textVa: 0x465bc7 },
  { id: 28, va: 0x0044d56e, factor: 6000, textVa: 0x465bd9 },
  { id: 29, va: 0x0044d5b1, factor: 8000, textVa: 0x465beb },
  { id: 30, va: 0x0044d5f4, factor: 5000, textVa: 0x465bfd },
  { id: 31, va: 0x0044d636, factor: 5000, textVa: 0x465c0f },
  { id: 32, va: 0x0044d677, factor: null, textVa: 0x465c23 },
  { id: 33, va: 0x0044d783, factor: null, textVa: 0x465c39 },
  { id: 34, va: 0x0044d8cf, factor: null, textVa: 0x465c53 },
  { id: 35, va: 0x0044d8fd, factor: null, textVa: 0x465c69 },
  { id: 36, va: 0x0044d92b, factor: null, textVa: 0x465c7f },
];

export function newsEvent(id: number): EventEntry | undefined {
  return NEWS_EVENTS.find((e) => e.id === id);
}

export function fortuneEvent(id: number): EventEntry | undefined {
  return FORTUNE_EVENTS.find((e) => e.id === id);
}

/** 金额 = 物价指数 × factor */
export function eventAmount(entry: EventEntry, priceIndex: number): number {
  return entry.factor === null ? 0 : entry.factor * priceIndex;
}
