/*
 * 事件牌堆：洗牌与选取
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 新聞与命運共用同一套机制：开局把事件编号洗成一副牌，用游标依次取用，
 * 遇到「当前局面下不可行」的事件就跳过、继续取下一张。
 *
 * @source rich4.asm:22369 fcn_00448b81 @ VA 0x00448b81  新聞洗牌（36 项）
 * @source rich4.asm       fcn_0044baea @ VA 0x0044baea  命運洗牌（37 项）
 * @source rich4-re/csrc/news.c news_events()            取用循环
 */

import type { WatcomRng } from '../rng/watcom.ts';

/** 新聞事件数 @source memset(buf, 0, 0x24) / cmp ebx, 0x24 */
export const NEWS_DECK_SIZE = 0x24; // 36
/** 命運事件数 @source fcn_0044baea 的 0x25 */
export const FORTUNE_DECK_SIZE = 0x25; // 37

/**
 * 洗牌。
 *
 * ⚠️ **不是标准 Fisher-Yates**，而是「选择采样」：
 * 每轮取 `rand() % 剩余数`，再从头线性扫描，跳过已用槽位，
 * 落在第 (r+1) 个未使用槽位上。
 *
 * 两者产出的排列分布相同，但**消耗的随机数序列不同**，
 * 故必须照原样实现，否则后续所有随机结果都会偏移。
 *
 * 恰好消耗 `size` 次 `rand()`。
 *
 * @source fcn_00448b81:
 * ```asm
 * used[0x24] = {0};  ebx = 0;  esi = 0x24
 * loop:
 *   edx = rand() % esi
 *   eax = 0
 *   scan: if (used[eax] == 0) edx--
 *         if (edx < 0) goto place
 *         if (++eax >= 0x24) goto place
 *         goto scan
 *   place: used[eax] = 1; deck[ebx] = eax; ebx++; esi--
 *   if (ebx < 0x24) goto loop
 * cursor = 0
 * ```
 */
export function shuffleDeck(rng: WatcomRng, size: number): number[] {
  const used = new Array<boolean>(size).fill(false);
  const deck: number[] = [];

  let remaining = size;
  for (let placed = 0; placed < size; placed++) {
    let countdown = rng.below(remaining);
    let at = 0;
    for (;;) {
      if (!used[at]) countdown--;
      if (countdown < 0) break;
      at++;
      if (at >= size) break; // 原版的边界保护，正常不会触发
    }
    used[at] = true;
    deck.push(at);
    remaining--;
  }
  return deck;
}

/** 牌堆状态。游标在取用时前进，到底后回绕。 */
export interface EventDeck {
  readonly order: readonly number[];
  readonly cursor: number;
}

export function createDeck(rng: WatcomRng, size: number): EventDeck {
  // @source 洗牌函数末尾 `mov dword [ref_004990e0], 0`
  return { order: shuffleDeck(rng, size), cursor: 0 };
}

export interface DrawResult {
  /** 选中的事件编号；全部不可行时为 -1 */
  eventId: number;
  /** 更新后的牌堆（游标已前进） */
  deck: EventDeck;
  /** 本次为找到可行事件而跳过的张数 */
  skipped: number;
}

/**
 * 从牌堆取一个**当前局面下可行**的事件。
 *
 * @source news.c news_events() 的 do-while：
 * ```c
 * do {
 *     id = deck[cursor];
 *     feasible = check_news(id);
 *     if (feasible) { ...执行... }
 *     cursor = (cursor + 1) % 36;
 * } while (!feasible);
 * ```
 * 注意游标**无论是否可行都会前进**，且到底回绕。
 *
 * @param isFeasible 可行性判定
 */
export function drawEvent(
  deck: EventDeck,
  isFeasible: (eventId: number) => boolean,
): DrawResult {
  const size = deck.order.length;
  let cursor = deck.cursor;

  for (let tried = 0; tried < size; tried++) {
    const eventId = deck.order[cursor] ?? -1;
    const feasible = eventId >= 0 && isFeasible(eventId);
    cursor = (cursor + 1) % size;
    if (feasible) {
      return { eventId, deck: { order: deck.order, cursor }, skipped: tried };
    }
  }

  // 整副牌都不可行 —— 原版此时会死循环，这里显式返回 -1
  return { eventId: -1, deck: { order: deck.order, cursor }, skipped: size };
}
