/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 过路费收取的「前处理」与「换人」——住宅与設施两条路共用
 *
 * ★ 两条路（住宅 0x00419a8a、設施 0x0041a3cc）都先调 `0x41d559(地主, 涨价位, 費名)`，
 *   它返回 0 就一分不收；然后各自算費，再走一段同构的尾巴：
 *   免費卡（只住宅）→ 嫁禍卡 → 死神顯靈由他人賠償 → pay_money。
 *   这些先前一条都没接（Q-FAC-2）；passive.ts 里早写好的 `checkTollPassives` 也没人调。
 */

import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { PASSIVE_CARDS, playerHasCard, tollTriggersPassive } from '../cards/passive.ts';

// ============================================================
//  0x41d559：九种免收
// ============================================================

export type TollExemption =
  | 'sealed'
  | 'ally'
  | 'reaper'
  | 'hotel'
  | 'disappearing'
  | 'prison'
  | 'hospital'
  | 'sleeping'
  | 'sleepWalking';

/**
 * 免收判定 @source VA 0x0041d559（返回 null = 照收）。串 0x463bb8 起的九句就是顺序：
 * ```asm
 * 0041d58d  涨价位 高低两个半字节都非 0        → 房屋查封中
 * 0041d5bd  地主.+0x41 同盟对象 == 当前 + 1     → 與%s同盟中
 * 0041d5f0  地主.+0x3f god_info == 0xf          → 死神顯靈（★ 只认物件下标 14，第二个死神槽不算）
 * 0041d601  地主.+0x32 住旅館                    → %s住宿中
 * 0041d61a  +0x33 消失中 / 0041d633 +0x34 坐牢中 / 0041d64c +0x35 住院中
 * 0041d668  +0x36 冬眠中 / 0041d684 +0x37 夢遊中
 * ```
 */
export function tollExemption(landlord: Player, payerIndex: number, priceStatus: number): TollExemption | null {
  if ((priceStatus & 0xf0) !== 0 && (priceStatus & 0x0f) !== 0) return 'sealed';
  if (landlord.alliedPlayer === payerIndex + 1) return 'ally';
  if (landlord.godInfo === REAPER_GOD_INFO) return 'reaper';
  const b = landlord.blocking;
  if (b.inHotel !== 0) return 'hotel';
  if (b.disappearing !== 0) return 'disappearing';
  if (b.inPrison !== 0) return 'prison';
  if (b.inHospital !== 0) return 'hospital';
  if (b.sleeping !== 0) return 'sleeping';
  if (b.sleepWalking !== 0) return 'sleepWalking';
  return null;
}

/** 死神：物件下标 14/15（种类 15）→ god_info 15/16；免收只认 15，賠償认 14/15（原版的两处写法） */
export const REAPER_GOD_INFO = 0xf;

// ============================================================
//  0x40fbb8：死神顯靈由他人賠償
// ============================================================

/**
 * 第一个**别的**在场玩家、身上 god_info 为 0xe 或 0xf 者 @source 0x0040fbb8；没有 → −1。
 * 住宅 0x00419ecc / 設施 0x0041a6a4：費 != 0（設施还多一条「或是旅館」）时调它，
 * 命中就由他来付这笔錢。
 */
export function reaperPayer(players: readonly Player[], payerIndex: number): number {
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (i === payerIndex || p === undefined || !isAlive(p)) continue;
    if (p.godInfo === 0xe || p.godInfo === 0xf) return i;
  }
  return -1;
}

// ============================================================
//  免費卡 / 嫁禍卡 的自动使用
// ============================================================

/**
 * 電腦用不用免費卡 @source 0x00444a9b（`0x444a60` 的 whoPlays != 1 分支）：
 * `門檻 = (rand()%3000 + 3000) × 物價；費 > 現金 || 費 > 門檻 → 用`。真人是问一句（0x444ad8）。
 * @param rand 那次 `rand()` 的值（调用方从 rngState 取）
 */
export function aiUsesFreeCard(toll: number, payer: Player, priceIndex: number, rand: number): boolean {
  const threshold = ((rand % 3000) + 3000) * priceIndex;
  return toll > payer.cash || threshold < toll;
}

/**
 * 電腦嫁禍给谁 @source 0x004448b0（`0x44476a` 的电脑分支，第二参数为 1）：
 * 候选 = 最恨的人（hostility 最大且 > 0），没有就随机挑一个在场且没被关着的；
 * `門檻 = (rand()%4000 + 4000) × 物價；費 > 現金 || 費 > 門檻 → 嫁禍给候选`，否则不用。
 * 返回 −1 = 不用。
 * @param rand 取随机数（只在真需要时才取：随机挑候选一次、門檻一次，顺序同原版）
 */
export function aiScapegoat(
  players: readonly Player[],
  payerIndex: number,
  toll: number,
  priceIndex: number,
  rand: () => number,
): number {
  const me = players[payerIndex];
  if (me === undefined) return -1;
  let target = -1;
  let best = 0;
  for (let b = 0; b < players.length; b++) {
    const p = players[b];
    if (b === payerIndex || p === undefined || !isAlive(p)) continue;
    const h = me.hostility[b] ?? 0;
    if (h > best) {
      best = h;
      target = b;
    }
  }
  if (target === -1) {
    // @source 0x0040d31c：在场、不是自己、+0x32 dword == 0（没被关着）的人里随机
    const cands: number[] = [];
    players.forEach((p, i) => {
      if (i === payerIndex || !isAlive(p)) return;
      const bl = p.blocking;
      if ((bl.inHotel | bl.disappearing | bl.inPrison | bl.inHospital) !== 0) return;
      cands.push(i);
    });
    if (cands.length === 0) return -1;
    target = cands[rand() % cands.length]!;
  }
  const threshold = ((rand() % 4000) + 4000) * priceIndex;
  return toll > me.cash || threshold < toll ? target : -1;
}

/** 付費前的尾巴要问的三件事，按原版顺序 */
export interface TollTail {
  /** 免費卡把費抹成 0 */
  free: boolean;
  /** 嫁禍卡换来的付款人；−1 = 没换 */
  scapegoat: number;
}

/**
 * 住宅那条尾巴的免費卡 + 嫁禍卡（0x00419e36..0x00419ec5）；設施那条没有免費卡（0x0041a648 起只有嫁禍）。
 * 真人本应弹窗问（0x444ad8 / 0x44476a 的真人分支），本引擎先按电脑规则替真人决定，记 D-008。
 */
export function tollPassiveTail(
  players: readonly Player[],
  payerIndex: number,
  toll: number,
  priceIndex: number,
  allowFree: boolean,
  rand: () => number,
): TollTail {
  const payer = players[payerIndex];
  if (payer === undefined) return { free: false, scapegoat: -1 };
  let t = toll;
  let free = false;
  if (allowFree && tollTriggersPassive(t, payer, priceIndex) && playerHasCard(payer, PASSIVE_CARDS.FREE)) {
    if (aiUsesFreeCard(t, payer, priceIndex, rand())) {
      free = true;
      t = 0;
    }
  }
  let scapegoat = -1;
  if (tollTriggersPassive(t, payer, priceIndex) && playerHasCard(payer, PASSIVE_CARDS.SCAPEGOAT)) {
    scapegoat = aiScapegoat(players, payerIndex, t, priceIndex, rand);
  }
  return { free, scapegoat };
}
