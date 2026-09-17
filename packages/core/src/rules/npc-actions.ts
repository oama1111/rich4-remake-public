/*
 * 四大惡人走到格子上做什么
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 需求方口述了四个人的行为，回 exe 逐条落实了 —— **那六句提示文字
 *   本身就是最好的索引**，它们连在一起摆在 0x00463ac0 起：
 *
 * ```
 * 0x00463ac0  小偷偷得%s\n\n給%s！          ← 小偷捡东西/拆陷阱
 * 0x00463ae4  偷取%s\n\n%d點點券！          ← 小偷偷點券
 * 0x00463af7  奪取%s%s！                    ← 奪卡
 * 0x00463b02  強盜搶奪銀行\n\n得款%d元\n\n給%s！
 * 0x00463b21  勒索%s\n\n%d元保護費！        ← 流氓
 * 0x00463b36  取走過路費\n\n%d元！          ← 間諜（地產/設施）
 * 0x00463b49  取走盈餘\n\n%d元！            ← 間諜（上市企業）
 * ```
 *
 *   顺着这七个串的 xref 就把整块 0x0041b995..0x0041c844 读下来了。
 *
 * ★ **贯穿全篇的一条**：所有进项都记到 `+8`（主人 = 保釋他的人）头上，
 *   取的方式一律是 `pay_money(受害者, 主人, 金额, 理由)`（VA 0x0041d2c6）。
 *
 * ⚠️ **与需求方口述不一致的两处**，本文件按 exe 走，两处都记在
 *   known-deviations 的 Q-NPC-1 里：
 *   1. 強盜搶銀行是**两成**不是一半（常量 `[0x463b60]` dump 出来是 `0.2`）。
 *   2. **奪卡不是強盜专属** —— 那一支是「actor != 4」，
 *      即 強盜/流氓/間諜 三个都会顺手抽走同格玩家一张牌。
 */

import type { Player } from '../state/types.ts';
import type { LandInfo } from '../loaders/map.ts';
import { truncTowardZero } from './rounding.ts';

// ============================================================
//  谁是谁
// ============================================================

/**
 * 四大惡人的 actor 号。分派处处都是**拿 actor 号直接比**，
 * 所以这四个常量就是原版的 `cmp dword [0x49910c], n`。
 */
export const NPC = {
  /** @source `cmp [0x49910c], 4`（0x0041c1fa 偷點券、0x0041b99b 捡东西） */
  thief: 4,
  /** @source `cmp [0x49910c], 5`（0x0041c330 搶銀行） */
  robber: 5,
  /** @source `cmp [0x49910c], 6`（0x0041c4df 勒索、0x0041c64e 勒索設施） */
  thug: 6,
  /** @source `cmp [0x49910c], 7`（0x0041c739 取盈餘） */
  spy: 7,
} as const;

// ============================================================
//  小偷：偷點券
// ============================================================

/**
 * 小偷走到有人的格子上 —— 偷**一半點券**交给主人。
 *
 * @source VA 0x0041c1a2：
 * ```asm
 * 0041c1aa  cl = [actor*16 + 0x498df0]        ; +8 主人
 * 0041c1b9  edi = 同格玩家位图 & ~(1 << 主人)  ; ★ 主人自己不被偷
 * 0041c1c2  if (edi == 0) 结束
 * 0041c1c9  esi = lowest_set_bit(edi)          ; ★ 只挑下标最小的那一个
 * 0041c1d6  if (受害者.who_plays == 0) 结束    ; 出局的不偷
 * 0041c1fa  if (actor != 4) goto 奪卡          ; ★ 只有小偷偷點券
 * 0041c209  di = 受害者.+0x30                  ; 點券
 * 0041c210  sar edi, 1                         ; ★ 一半（算术右移，向下取整）
 * 0041c212  if (di == 0) 结束
 * 0041c25d  受害者.+0x30 -= di
 * 0041c27a  主人.+0x30    += di                ; ★ 给主人
 * ```
 */
export function stealPoints(victimPoints: number): number {
  // @source `sar edi, 1` —— 算术右移一位
  return victimPoints >> 1;
}

// ============================================================
//  奪卡：強盜／流氓／間諜
// ============================================================

/**
 * 从同格玩家手里**随机**抽一张牌，交给主人。
 *
 * @source 取牌 VA 0x00441e77：
 * ```asm
 * 00441e80  n = card_count(受害者)
 * 00441e8c  if (n == 0) return 0
 * 00441e8e  i = rand() % n                     ; ★ 随机一张，不是第一张
 * 00441eae  cardId = hand[受害者*15 + i]
 * 00441ec1  remove_card(受害者, cardId)
 * ```
 * 随后 `0x004412e4(主人, cardId)` 发给主人。
 *
 * ⚠️ 这一支的判据是 `actor != 4`（0x0041c201 `jne`），
 *   所以**強盜、流氓、間諜三个都会奪卡**，不止強盜。
 */
export function pickCardToSteal(
  hand: readonly number[],
  /** 只要够 `next()` 就行 —— 命运事件那条路只拿得到结构化随机出口 */
  rng: { next(): number },
): number | null {
  if (hand.length === 0) return null;
  return hand[rng.next() % hand.length] ?? null;
}

// ============================================================
//  強盜：搶銀行
// ============================================================

/**
 * ★ 搶銀行拿走每个对手存款的**两成**，不是一半。
 *
 * @source `fmul qword [0x463b60]`（VA 0x0041c37d）。
 *   那 8 个字节 dump 出来是 IEEE-754 的 **0.2**。
 *   需求方记的是「50%」，以 exe 为准，见 Q-NPC-1。
 */
export const BANK_ROBBERY_RATIO_NUM = 1;
export const BANK_ROBBERY_RATIO_DEN = 5;

export interface Robbery {
  /** 被抢的玩家下标 */
  from: number;
  /** 金额 */
  amount: number;
}

/**
 * 強盜走到**銀行**格上。
 *
 * @source VA 0x0041c330：
 * ```asm
 * 0041c330  if (actor != 5) 结束                   ; ★ 只有強盜
 * 0041c33d  if (格子 specialKind != 0xe) 结束      ; 0xe = 14 = 銀行
 * 0041c34f  for (i = 0; i < 玩家数; i++) {
 * 0041c35a    if (player[i].who_plays == 0) continue
 * 0041c373    if (i == 主人) continue              ; ★ 主人自己不被抢
 * 0041c377    fild player[i].存款 / fmul 0.2
 * 0041c383    call 0x457dbc                        ; ★ __round_toward_zero = 向零截断
 * 0041c39b    pay_money(i, 主人, 金额, 5)
 *           }
 * 0041c3f9  msg("強盜搶奪銀行\n\n得款%d元\n\n給%s！", 合计, 主人名)
 * ```
 *
 * ⚠️ 金额**按存款算**，但付款走的是 `pay_money`（现金优先、不够动存款、
 *   再不够破產），不是「直接从存款划走」。这两件事在原版里是分开的。
 */
export function bankRobbery(
  players: readonly Player[],
  owner: number,
  isAlivePlayer: (p: Player) => boolean,
): Robbery[] {
  const out: Robbery[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p === undefined) continue;
    if (!isAlivePlayer(p)) continue;
    if (i === owner) continue;
    // @source 0x0041c377 `fild 存款` / 0x0041c37d `fmul qword [0x463b60]`(=0.2)
    //   / 0x0041c383 `call 0x457dbc`（`__round_toward_zero` = **向零截断**）。
    //   ⚠️ 老的注释说这里是 Watcom `__CHP` 的就近取整 —— 那是误读：
    //   0x457dbc 就是向零。存款为负时两者会分叉（-13 → 原版 -2、就近 -3）。
    const amount = truncTowardZero(
      (p.moneyInBank * BANK_ROBBERY_RATIO_NUM) / BANK_ROBBERY_RATIO_DEN,
    );
    if (amount === 0) continue;
    out.push({ from: i, amount });
  }
  return out;
}

// ============================================================
//  流氓：勒索保護費
// ============================================================

/**
 * 流氓走到**别人的地產**上 —— 按「整片地区」勒索。
 *
 * @source VA 0x0041c4df：
 * ```asm
 * 0041c4df  if (actor != 6) goto 間諜那一路        ; ★ 只有流氓
 * 0041c4f1  esi = 地块表[1]                        ; [0x498e84]，步长 0x34
 * 0041c4fc  for (i = 1; i <= 地块数; i++) {
 * 0041c504    if (esi.+0x19 != 落点地块.+0x19) continue   ; ★ 同一个地主
 * 0041c514    if (strcmp(esi+4, 落点地块+4) != 0) continue ; ★★ **同名**
 * 0041c520    合计 += esi.+0x1c (word)                     ; 地價
 *           }
 * 0041c542  合计 *= 物價指數
 * 0041c552  msg("勒索%s\n\n%d元保護費！", 地主名, 合计)
 * 0041c576  pay_money(地主, 主人, 合计, 0)
 * ```
 *
 * ★★ 那条 `strcmp(名字)` 是关键：原版的地块名是**按地区重复**的
 *   （一片地区里好几格同名），所以保護費不是按落点那一格算，而是
 *   **把地主在这一整片地区的地價全加起来**。需求方说「与地产的价值有关」，
 *   具体就是这条。
 *
 * ⚠️ 收上来的钱**同样 `pay_money(…, 主人, …)`** —— 需求方记的「不会直接交给
 *   保释人」与 exe 不符，见 Q-NPC-1。
 */
export function protectionFee(
  lands: readonly LandInfo[],
  ownerOf: (landId: number) => number,
  landedOn: LandInfo,
  priceIndex: number,
): number {
  const landlord = ownerOf(landedOn.id);
  if (landlord === 0) return 0;
  let total = 0;
  for (const l of lands) {
    if (ownerOf(l.id) !== landlord) continue;
    // @source `strcmp(esi + 4, ebp + 4)` —— 名字相同才算同一片地区
    if (l.name !== landedOn.name) continue;
    total += l.landPrice;
  }
  return total * priceIndex;
}

/**
 * 流氓走到**别人的設施**上 —— 只按那一处算，不聚合。
 *
 * @source VA 0x0041c64e：`edi = 設施.+0x22`（設施的地價）`× 物價指數`。
 *   設施表在 `[0x498e88]`、步长 0x38，编码段 `0xfa0..0x1770`
 *   （与傳送機同源，见 rules/teleport.ts）。
 */
export function facilityProtectionFee(facilityPrice: number, priceIndex: number): number {
  return facilityPrice * priceIndex;
}

// ============================================================
//  間諜：取走過路費／盈餘
// ============================================================

/**
 * 間諜取走**这块地累积收过的過路費**。
 *
 * @source VA 0x0041c597（地產）：`edi = 落点地块.+0x2c; if (edi == 0) 结束`
 * @source VA 0x0041c6bd（設施）：`edi = 設施.+0x30`
 *
 * ⚠️ **本引擎还没有这两个累加器**，故这条规则**没有接线**。
 *   `+0x2c` 落在 `rentByLevel`（0x20..0x2b）与 `flast`（0x30）之间，
 *   `loaders/map.ts` 从没解析过它 —— 因为它不是地图静态数据，
 *   是**运行时**每收一次租就累加的池子。要做得先：
 *   1. `GameState` 加 `landTollPool[]` / `facilityTollPool[]`；
 *   2. 在收租处累加（**原版的写入点尚未定位**，别照猜的地方加）。
 *   记在 Q-NPC-1。
 */
export const SPY_LAND_TOLL_OFFSET = 0x2c;
export const SPY_FACILITY_TOLL_OFFSET = 0x30;

/**
 * 間諜走到**别人的上市企業**上 —— 取走**累積盈餘**。
 *
 * @source VA 0x0041c6e6：
 * ```asm
 * 0041c6e6  if (di <= 0x1770 || di >= 0x1f40) 结束   ; 上市企業的编码段
 * 0041c701  edi = 企業表[(di - 0x1770)]              ; [0x498e7c]，步长 0x34
 * 0041c712  if (企業.+0x18 == 0) 结束                ; 无主
 * 0041c735  if (主人 == 企業主) 结束                 ; ★ 自家公司不动
 * 0041c739  if (actor != 7) 结束                     ; ★ 只有間諜
 * 0041c73e  edi = 企業.+0x28                         ; ★ 累積盈餘
 * 0041c741  if (edi == 0) 结束
 * 0041c75c  msg("取走盈餘\n\n%d元！", edi)
 * 0041c780  pay_money(企業主, 主人, edi, 0)
 * ```
 *
 * ★★ `+0x28` 是**有符号 dword**，而 `pay_money` 的金额也按有符号走：
 *   **公司亏损时这笔是负的，等于主人反过来替企業主掏钱**。
 *   需求方说的「若该公司亏损时保释人也需承担」就是这个 —— 不是特判，
 *   是同一条语句在负数下的自然结果。
 *
 * ⚠️ 同样**没接线**：本引擎的 `CommercialInfo` 没有累積盈餘字段
 *   （`ai/stock-policy.ts` 的文件头也提到过这个 `+0x2c`/`+0x28`）。见 Q-NPC-1。
 */
export const SPY_COMPANY_SURPLUS_OFFSET = 0x28;

// ============================================================
//  回監獄／回醫院
// ============================================================

/**
 * `+11`（记录的 state 字节）的含义 —— **两段代码互相印证**：
 *
 * ```asm
 * 0041c7b1  cl = [actor*16 + 0x498df3] & 0x7f
 * 0041c7ba  if (cl == 1 && 这一格 specialKind == 4) {   ; 監獄
 * 0041c7d2    if (cl & 0x80) send_to_prison(actor, 0)    ; ★ 回去蹲着
 * 0041c7e9    else           [+11] |= 0x80               ; 第一次只做标记
 *           }
 * 0041c80a  if (cl == 2 && 这一格 specialKind == 5) {   ; 醫院
 * 0041c822    if (cl & 0x80) { send_to_hospital(actor, 0); [0x48baf8] = 0 }
 * 0041c839    else            [+11] |= 0x80
 *           }
 * ```
 *
 * 即低 7 位记着**他是哪儿出来的**（1 監獄 / 2 醫院），bit7 是
 * **「已经离开过那一格」**。保釋时写 `+11 = 1`（或 2），
 * 而且因为人此刻就站在監獄/醫院那一格上，同时就把 0x80 置上了
 * （@source 0x0043d84e `if ((node.flags & 0xff) == 4) |= 0x80`）——
 * 所以**下一次踩到那一格就回去**，正是需求方说的
 * 「当再次经过监狱/医院格时会回到监狱/医院」。
 */
export const NPC_HOME = { prison: 1, hospital: 2 } as const;
export const NPC_HOME_LEFT = 0x80;

/** 这个 NPC 是哪儿出来的 —— 由 actor 号定死（4/5 監獄，6/7 醫院） */
export function npcHomeOf(actor: number): 1 | 2 {
  return actor === NPC.thief || actor === NPC.robber ? NPC_HOME.prison : NPC_HOME.hospital;
}

/**
 * 踩到自己「老家」那一格了吗 —— 踩到就回去。
 *
 * @param home    `+11` 的低 7 位
 * @param left    `+11` 的 bit7 是否已置
 * @param kind    这一格的 `specialKind`
 */
export function npcReturnsHome(home: number, left: boolean, kind: number): boolean {
  if (home === NPC_HOME.prison) return left && kind === 4;
  if (home === NPC_HOME.hospital) return left && kind === 5;
  return false;
}

// ============================================================
//  小偷的战利品
// ============================================================

/**
 * 小偷沿路会**捡走／拆掉**的五种物件 —— 全部交给主人。
 *
 * @source 五个分支都以 `cmp [0x49910c], 4 / jne 结束` 开头，
 *   都用同一条提示串 `0x00463ac0 "小偷偷得%s\n\n給%s！"`：
 *
 * | 物件 | 种类 | NPC 分支 |
 * |---|---|---|
 * | 禮物 | 13 | 0x0041b995 |
 * | 寶箱 | 14 | 0x0041bc22 附近 |
 * | 路障 | 16 | 0x0041bde1 附近 |
 * | 地雷 | 17 | 0x0041bf92 附近 |
 * | 定時炸彈 | 18 | 0x0041c0ed 附近 |
 *
 * ★ 这正是需求方说的「窃取路上的宝箱和礼物盒，以及拆除路上的
 *   定时炸弹、地雷、路障交付给保释人」—— 五种一件不多一件不少。
 *
 * ⚠️ 反过来说：**小偷不会被自己拆的东西伤到**（不炸、不中雷、不被路障拦），
 *   而另外三个会 —— 他们走的是玩家那一路。
 */
export const THIEF_LOOT_TYPES: readonly number[] = [13, 14, 16, 17, 18];

export function thiefTakes(objectType: number): boolean {
  return THIEF_LOOT_TYPES.includes(objectType);
}

// ============================================================
//  共通：挑受害者
// ============================================================

/**
 * 同格的玩家里谁遭殃。
 *
 * @source `edi = 位图 & ~(1 << 主人)` 之后 `call 0x40d293`（取最低位）。
 *   两条都不显然：
 *   - **主人被排除在外** —— 自己保釋出来的人不会回头咬自己；
 *   - **只挑下标最小的一个** —— 同格站三个人也只偷一个。
 */
export function pickVictim(
  occupants: readonly number[],
  owner: number,
  alive: (i: number) => boolean,
): number | null {
  const sorted = [...occupants].sort((a, b) => a - b);
  for (const i of sorted) {
    if (i === owner) continue;
    if (!alive(i)) continue;
    return i;
  }
  return null;
}

/** 这个 actor 会不会奪卡 —— `actor != 4` @source 0x0041c201 */
export function stealsCard(actor: number): boolean {
  return actor !== NPC.thief;
}

/** 这个 actor 会不会偷點券 —— `actor == 4` @source 0x0041c1fa */
export function stealsPoints(actor: number): boolean {
  return actor === NPC.thief;
}
