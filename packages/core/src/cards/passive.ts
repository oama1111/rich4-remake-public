/*
 * 被动卡机制
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 以原版 exe 反汇编为准。
 *
 * 复仇/嫁祸/免费/免罪四张卡**无法主动使用**——它们的 card_functions 项
 * 都指向同一个 2 字节空桩 `xor eax,eax; ret`（VA 0x004420d5）。
 *
 * 它们的真实触发方式是：**当有害卡命中某玩家时，施害卡会先检查
 * 目标是否持有相应的防御卡**，持有则触发防御并中止原效果。
 *
 * @source 梦游卡 VA 0x004442f2：
 * ```asm
 * push 0x15              ; 21 = 免罪卡
 * push ebx               ; 目标
 * call 0x4413ad          ; _rich4_player_has_card
 * cmp  eax, 1
 * jne  0x444310
 * push ebx / call 0x444bb2   ; 免罪卡生效 → 免疫，直接结束
 * jmp  end
 * 0x444310:
 * push 0x13              ; 19 = 嫁祸卡
 * push ebx
 * call 0x4413ad          ; 再查嫁祸卡
 * ```
 */

import type { Player } from '../state/types.ts';

/**
 * 每个玩家的手牌槽位数。
 * @source `_rich4_player_has_card`（VA 0x004413ad）的寻址：
 *   `eax = player*5; eax = eax*4 - eax` → player*15，
 *   循环上界 `cmp ecx, 0xf`（15）。
 *   全局数组 `rich4_player_cards[60]` = 4 玩家 × 15 槽，与存档布局一致。
 */
export const CARD_SLOTS_PER_PLAYER = 15;

/**
 * 玩家是否持有某张卡。
 * @source `_rich4_player_has_card(player, cardId)` VA 0x004413ad
 */
export function playerHasCard(player: Player, cardId: number): boolean {
  return player.cards.includes(cardId);
}

/** 防御性被动卡的编号 */
export const PASSIVE_CARDS = {
  /** 复仇卡 —— 反弹 */
  REVENGE: 18,
  /** 嫁祸卡 —— 转嫁给他人 */
  SCAPEGOAT: 19,
  /** 免费卡 —— 免付费用 */
  FREE: 20,
  /** 免罪卡 —— 免疫惩罚 */
  ABSOLUTION: 21,
} as const;

/** 被动卡的触发结果 */
export type PassiveTrigger =
  | { kind: 'none' }
  | { kind: 'absolution' }
  | { kind: 'scapegoat' };

/**
 * 检查有害卡命中目标时是否被防御卡拦下。
 *
 * ⚠️ **检查顺序按原版**：先免罪卡（21），再嫁祸卡（19）。
 * 免罪卡命中即直接免疫并中止，不再查嫁祸卡。
 *
 * @source 梦游卡 VA 0x004442f2 与 0x00444310 的两段连续检查
 */
export function checkDefensiveCards(target: Player): PassiveTrigger {
  // @source push 0x15 / call has_card / cmp eax,1 / jne 下一项
  if (playerHasCard(target, PASSIVE_CARDS.ABSOLUTION)) return { kind: 'absolution' };
  // @source push 0x13 / call has_card
  if (playerHasCard(target, PASSIVE_CARDS.SCAPEGOAT)) return { kind: 'scapegoat' };
  return { kind: 'none' };
}

/** 命中防御卡后的结果：触发类型 + **已扣除该卡**的持有者 */
export interface DefensiveApplied {
  trigger: PassiveTrigger;
  /** 命中时该持有者的牌已少一张；未命中则原样返回（同一引用） */
  player: Player;
}

/**
 * ★ 检查有害卡命中目标时是否被防御卡拦下，并**把命中的那张卡消耗掉**。
 *
 * @source 两个处理函数**内部各自 `remove_card`**，不是"只查不扣"：
 * ```asm
 * ; 免罪卡 0x00444bb2（target = esi）
 * 00444c07  push 0x15                  ; 21
 * 00444c10  push esi
 * 00444c11  call 0x441343              ; remove_card(target, 21)
 * ; 嫁祸卡 0x0044476a
 * 004449ec  push 0x13                  ; 19
 * 004449ee  push edi
 * 004449ef  call 0x441343              ; remove_card(target, 19)
 * ```
 * 此前 remake 只读 `playerHasCard`、**从不消耗**，于是受害者的防御卡
 * 永远留在手里 —— 同一张免罪卡可以反复挡下每一次攻击（**阻断级**）。
 *
 * ⚠️ 顺序仍是**免罪卡(21) 优先，命中即止**（不再查嫁祸卡）。
 */
export function applyDefensiveCards(target: Player): DefensiveApplied {
  if (playerHasCard(target, PASSIVE_CARDS.ABSOLUTION)) {
    return {
      trigger: { kind: 'absolution' },
      player: consumeCard(target, PASSIVE_CARDS.ABSOLUTION),
    };
  }
  if (playerHasCard(target, PASSIVE_CARDS.SCAPEGOAT)) {
    // ★★ 2026-09-19 订正（§7.140；通道 2 `test_passive_cards.py` 130/130 直证）：
    //   嫁禍卡(19) **不在这里扣**。原版 `0x44476a` 里
    //   `0x4449e7 cmp ebx,-1` / `0x4449ea je 0x444a53` 就在扣卡点
    //   `0x4449ef call 0x441343` **之前** —— 「放弃转嫁」或「无人可嫁」时
    //   **卡留在手里**；只有**真的改写了目标**才扣。
    //   故本函数只报「触发了嫁祸」，扣卡交给调用方在 `picked != -1` 之后做。
    //   ⚠️ README §四之二 第 11 条的括注（「放弃转嫁时嫁祸照样被消耗」）是**错的**。
    return { trigger: { kind: 'scapegoat' }, player: target };
  }
  return { trigger: { kind: 'none' }, player: target };
}

/**
 * 復仇卡(18) 生效时给**施害者**的天数 —— **硬编码 5**，不走
 * 「对自己 4 天 / 对别人 5 天」那条式子（那条只用于卡的主效果）。
 *
 * @source `0x0044441d`（夢遊卡的復仇支）：`mov byte ptr [eax + 0x496b9f], 5`
 *   （`eax` = `[0x49910c]` 的玩家结构 = 施卡者）；
 * @source `0x0044466f`（陷害卡的復仇支）：`push 5` / `push [0x49910c]` / `call 0x43d593`。
 */
export const REVENGE_DAYS = 5;

/** 从手牌中消耗一张卡（取第一张匹配的） */
export function consumeCard(player: Player, cardId: number): Player {
  const at = player.cards.indexOf(cardId);
  if (at < 0) return player;
  const cards = [...player.cards];
  cards.splice(at, 1);
  return { ...player, cards };
}

// ============================================================
//  ★ 第二个触发点：付过路费时
// ============================================================

/*
 * 被动卡有**两个互不相同的触发点**，卡的组合也不同，别混为一谈：
 *
 *   1. **有害卡命中目标**时 → 免罪卡(21) → 嫁祸卡(19)
 *      见上方 checkDefensiveCards。
 *
 *   2. **付过路费**时 → 免费卡(20) → 嫁祸卡(19)
 *      即本节。住宅（VA 0x00419e34）与设施（VA 0x0041a60e）两条路径
 *      结构完全相同。
 */

/**
 * 付过路费时触发被动卡的门槛。
 *
 * @source VA 0x00419e0c / 0x0041a5e6 的同一段移位序列：
 * ```asm
 * edx = price_index
 * eax = edx<<2        ; 4pi
 * eax = eax - edx     ; 3pi
 * eax = eax<<3        ; 24pi
 * eax = eax + edx     ; 25pi
 * eax = eax<<4        ; 400pi
 * edx2 = eax
 * eax = eax<<2        ; 1600pi
 * eax = eax + edx2    ; ★ 2000pi
 * ```
 */
export const TOLL_PASSIVE_THRESHOLD_FACTOR = 2000;

/**
 * 这笔过路费是否**贵到**足以触发被动卡。
 *
 * @source `cmp ebp, eax / jge 触发` 与
 *         `cmp ebp, cash+bank / jle 跳过`
 *
 * 两个条件**取或**：租金达到 `物价指数 × 2000`，**或者**
 * 付款方的现金加存款根本不够付。后者是「走投无路才掏底牌」的兜底。
 */
export function tollTriggersPassive(
  toll: number,
  payer: Player,
  priceIndex: number,
): boolean {
  if (toll >= priceIndex * TOLL_PASSIVE_THRESHOLD_FACTOR) return true;
  return toll > payer.cash + payer.moneyInBank;
}

/** 付过路费时被动卡的处理结果 */
export type TollPassiveOutcome =
  /** 没有触发，照常付 */
  | { kind: 'none' }
  /** 免费卡：租金归零 @source `xor ebp, ebp` */
  | { kind: 'free' }
  /** 嫁祸卡：**换一个付款人** @source `mov edi, eax` */
  | { kind: 'scapegoat'; newPayer: number };

/**
 * 付过路费时检查被动卡。
 *
 * 原版顺序（住宅 VA 0x00419e34 起，设施 0x0041a60e 起结构相同）：
 * ```asm
 * ; —— 免费卡 ——
 * if (toll >= pi*2000 || toll > cash + bank) {
 *     if (has_card(payer, 0x14)) {            ; 20 = 免费卡
 *         if (call 0x444a60(payer, owner, toll) == 1)
 *             ebp = 0;                         ; ★ 租金归零
 *     }
 * }
 * ; —— 嫁祸卡（同样的门槛再判一次）——
 * if (toll >= pi*2000 || toll > cash + bank) {
 *     if (has_card(payer, 0x13)) {            ; 19 = 嫁祸卡
 *         eax = call 0x44476a(payer, ?, toll);
 *         if (eax != -1) edi = eax;            ; ★ 换付款人，不是免单
 *     }
 * }
 * ```
 *
 * ⚠️ 两张卡的效果**根本不同**：免费卡把金额抹成 0，嫁祸卡金额照旧、
 * 只是换人来付。先前把它们笼统当作「防御卡」是不准确的。
 *
 * ⚠️ 门槛被**独立判断两次**。免费卡若把租金抹成 0，第二次判断时
 * `toll` 已是 0，两个条件都不成立，嫁祸卡自然不会再触发——
 * 这是原版的自然结果，不需要额外的互斥逻辑。
 *
 * @param scapegoatPicker 嫁祸目标由外部（UI/AI）给出，返回 -1 表示放弃。
 *                        目标选择是表现层职责（C-ARC-2），core 只用结果。
 */
export function checkTollPassives(
  toll: number,
  payer: Player,
  priceIndex: number,
  scapegoatPicker: () => number = () => -1,
): TollPassiveOutcome {
  if (tollTriggersPassive(toll, payer, priceIndex)) {
    if (playerHasCard(payer, PASSIVE_CARDS.FREE)) return { kind: 'free' };
  }
  // ★ 门槛重新判一次；若上一步已免单，这里的 toll 传进来就是 0
  if (tollTriggersPassive(toll, payer, priceIndex)) {
    if (playerHasCard(payer, PASSIVE_CARDS.SCAPEGOAT)) {
      const picked = scapegoatPicker();
      if (picked !== -1) return { kind: 'scapegoat', newPayer: picked };
    }
  }
  return { kind: 'none' };
}

// ============================================================
//  嫁禍卡 `0x44476a(持有者, mode, 参数)` 的**电脑支**
// ============================================================

/** 嫁禍卡的调用模式（第二参）：0 = 夢遊/陷害卡/新聞；1 = 過路費；2 = 查稅卡 */
export type ScapegoatMode = 0 | 1 | 2;

/**
 * 卡片路径里「嫁禍給誰」的决定者：`(持有者, 当前局面, 模式) → 新目标 / −1（不嫁禍）`。
 * `now` 是**已经记过本张卡敌意**之后的玩家表（电脑支挑「最恨的人」读的就是它）。
 */
export type ScapegoatPicker = (holder: number, now: readonly Player[], mode: ScapegoatMode) => number;

/**
 * `0x44476a` 的电脑支（`who_plays != 1`，含託管）：先挑候选，再按模式过门槛。
 *
 * ```asm
 * 004447a1  cmp byte [持有者+0x15], 1 / jne 0x4448b0      ; 真人支另议（确认框 / 选人窗）
 * 004448b1  call 0x40d2d3   ; ① 最恨的人：在场（+0x15 整字节 ≠ 0）、非自己、hostility 严格最大且 > 0
 * 004448c0  call 0x40d31c   ; ② 没有 → 在场、非自己、dword [+0x32] == 0 的人里 rand() % n（**这一步掷随机**）
 * 004448ef  mode 0：0x00444971 mov ebx, ebp                 ; 不设门槛
 * 00444934  mode 2：fild [持有者+0x1c] × 0.2（0x465380）vs 4000×物價；0x0044496f jae ⇒ 不嫁禍
 * 004449e7  cmp ebx, -1 / je ⇒ 不扣 19；否则 0x004449ef remove_card(持有者, 19)
 * ```
 * ⚠️ 候选（及其随机数）在门槛**之前**就定了：mode 2 门槛不过也已经掷过那一次 `rand()`。
 * mode 1（過路費）另有 `rules/toll-flow.ts` 的 `aiScapegoat`，这里不接。
 */
export function aiScapegoatPick(
  players: readonly Player[],
  holder: number,
  mode: ScapegoatMode,
  priceIndex: number,
  rng: { next(): number },
): number {
  const me = players[holder];
  if (me === undefined) return -1;
  let cand = -1;
  let best = 0;
  for (let b = 0; b < players.length; b++) {
    const p = players[b];
    if (b === holder || p === undefined || (p.whoPlays & 0xff) === 0) continue;
    const h = me.hostility[b] ?? 0;
    // @source 0x0040d30b cmp ecx, ebx / jge 跳过 ⇒ 严格大于才换
    if (h > best) {
      best = h;
      cand = b;
    }
  }
  if (cand === -1) {
    const pool: number[] = [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (i === holder || p === undefined || (p.whoPlays & 0xff) === 0) continue;
      const bl = p.blocking;
      if ((bl.inHotel | bl.disappearing | bl.inPrison | bl.inHospital) !== 0) continue;
      pool.push(i);
    }
    // @source 0x0040d355 call rand / idiv esi（有候选才掷）
    if (pool.length > 0) cand = pool[rng.next() % pool.length]!;
  }
  if (cand === -1) return -1;
  if (mode === 2) {
    // @source 0x00444934 fild [持有者+0x1c] / 0x0044493a fmul qword [0x465380]（0.2 的 double，略大于 0.2）/
    //   0x0044496a fcompp（4000×物價）/ 0x0044496f jae ⇒ 不嫁禍。x87 是**扩展精度**（进程 CW = 0x037f，
    //   見 docs/deviations/Q-NUM-1.md）⇒ 现金恰为 20000×物價 时乘积比 4000×物價 大一点点 ⇒ **嫁禍**：
    //   整数等价式是 `现金 >= 20000×物價`（不是 `>`）。
    if (!(me.cash >= 20000 * priceIndex)) return -1;
  }
  return cand;
}
