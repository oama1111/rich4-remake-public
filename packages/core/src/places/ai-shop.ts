/*
 * 电脑逛百貨公司 —— `_rich4_ui_shop_entry` 的电脑那一支（不开窗、不摆货架）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★★ 第二十六份試玩回報（`20260924-234350490`，Charles，联机第 44 回合）：「约翰乔的汽车哪里来的」。
 *   重放：約翰喬（P1，电脑）在第 41 回合 `useTool 6`（汽車）换了车；那件汽車在起点快照（第 33 回合）里
 *   就已经在他道具欄里（全局库存 10 → 9，他的點券 0）⇒ 是更早在百貨公司**买**的。
 *   原版电脑确实会在店里买车（下面 `0x0042f211 push 6 / call 0x42d272`），**但条件与先前的复刻不同**：
 *   先前 `ai/policy.ts` 的 shop 分支是自拟的「车优先、全部點券都能花」—— 150 點就买汽車；原版只拿
 *   **一半**點券（向上取整）逛道具、先买機車、要**严格小于**预算、手里已有那种车就不买 ⇒ 常见局面
 *   （步行 + 手里没有機車）要 ≥ 461 點才轮得到汽車。
 *
 * ## 原版这一支（`0x0042ea2b cmp byte [player+0x15], 1 / jne 0x42ed8d`）
 *
 * 董事長赠礼（`0x0042e97d..0x0042ea28`）之后，**恰好** who_plays == 1 的真人才开商店窗；
 * 其余（电脑 / 托管）走 `0x0042ed8d`：**不抽货架**（货架那一段 `rand()%10+6` 在真人那一支里），
 * 直接对着牌堆 / 道具库存买卖，没有任何框、台词、音效。逐段：
 *
 * | 段 | VA | 做什么 |
 * |---|---|---|
 * | S1 | `0x0042ed8d..0x0042ee1d` | 手牌槽 i = 0..14（遇空槽停）：`[i*8 + 0x47fdf9]`（**第 i 张卡**的 f7，★ 用的是**槽号**不是卡号）− 個性 == 2 ⇒ 卖掉槽里那张（`0x42d145`），同一槽再看一遍 |
 * | S2 | `0x0042ee1d..0x0042eea4` | 道具 1..13：有货且 f7 − 個性 == 2 ⇒ 整种卖光（`0x42d1b2(p, id, 数量)`）|
 * | S3 | `0x0042eea4..0x0042f025` | 點券 < 100：卖最便宜的一张卡（严格 `<`，同价取先出现的）；每种道具多于 1 件的卖到剩 1；骑機車就卖掉手里的機車、开汽車就卖掉手里的汽車 |
 * | — | `0x0042f025` | 點券为 0 ⇒ 直接离店 |
 * | C | `0x0042f03c..0x0042f16c` | 卡预算 = 點券 >> 1；牌堆里每一张（按卡号、每种按剩余张数重复）价 ≤ 卡预算且 f7 − 個性 ≠ 2 的进候选；`qsort` 按价**降序**（比较器 `0x42d0ef`）；逐个：手牌满 15 就停，价 ≤ 剩余卡预算就买（`0x42d237`）|
 * | V | `0x0042f16c..0x0042f232` | 道具预算 = 點券 − (點券 >> 1)。**機車**：交通 ≠ 機車、手里没有機車、80 < 预算、库存有 ⇒ 买；**汽車**：交通 ≠ 汽車、手里没有汽車、150 < 预算、库存有 ⇒ 买 |
 * | T | `0x0042f232..0x0042f307` | 表 `0x4755f0` = 道具 8, 2, 7, 1, 4, 3：手里 < 9、f7 − 個性 ≠ 2、价 ≤ 预算、库存有 ⇒ 各买一件 |
 *
 * 买卖本身都是店里那几个函数（`places/shop.ts`）：卖价九成（`0x42d145` / `0x42d1b2`），
 * 卖卡把牌放回牌堆（`consume_card 0x441343` 的 `inc [卡号 + 0x499197]`），买卡从牌堆扣
 * （`receive_card 0x4412e4` 的 `dec [卡号 + 0x499197]`），买道具走 `receive_tool 0x445a4d`（扣库存）。
 *
 * ★ 买卡候选的次序照原版 Watcom `qsort`（`0x457e6c`，不稳定）逐条移植（`rules/watcom-qsort.ts`，
 *   与原版机器码逐位对过）—— 同价的卡谁先买由那套算法决定（先前按卡号升序当替身，D-006 已撤）。
 *
 * ★★ 2026-09-25 审计（L48）：这一支的营业额**也进企業帳**。原版两支在离店那一刻**汇合**到同一段
 *   （电脑支 `0x0042f23d..0x0042f24f cmp eax,6 / jge 0x42ed50` ⇒ 落到真人支的收尾），
 *   `ebp` 就是这一趟的累计额：每次买卖把那几个函数的**返回值**加进去 ——
 *   买卡/买道具 `0x42d237` / `0x42d272` 返回 **標價 × 10**
 *   （`0x0042d267..0x0042d26e`：`eax=價; eax=eax*4; eax+=edx; eax+=eax`；`0x42d272 jmp 0x42d25c` 同一尾巴），
 *   卖卡 `0x42d145` 返回 **標價**（`0x0042d1a5..0x0042d1b1`，★ 不是到手的那 0.9 倍），
 *   卖道具 `0x42d1b2` 返回 **標價 × 数量**（`0x0042d22f mov eax,ebx`，ebx = 價×数量）。
 *   收尾 `0x42ed50 mov ebx,[esp+0x148]`（= 本格的企業编码）→ `(0x1770,0x1f40)` 内 ⇒
 *   `0x42ed75 add [企業+0x28], ebp` / `0x42ed7e add [企業+0x2c], ebp`。
 *   见 `state/reduce.ts` 的 `shopRevenueTo`（真人支那一份，两支共用同一个落账）。
 *
 * 纯函数（C-DET-1/2）：不掷随机数、不读时钟。
 */

import { CARDS, TOOLS } from '@rich4/data';
import type { Player } from '../state/types.ts';
import { MAX_HAND_CARDS } from '../rules/special-square.ts';
import { giveTool, MAX_TOOL_COUNT, MAX_TOOL_ID, toolCount } from '../rules/tools.ts';
import { TRAFFIC_CAR, TRAFFIC_MOTORCYCLE } from '../rules/tool-effects.ts';
import { addPoints } from '../rules/points.ts';
import { cardPrice, sellCard, sellTool, toolPrice } from './shop.ts';
import { watcomQsort } from '../rules/watcom-qsort.ts';

/** 點券低于这个数才走「变卖」那一段 @source `0x0042eeab cmp word [player+0x30], 0x64 / jae` */
export const AI_SHOP_LOW_POINTS = 0x64;

/** 「个性差两档」= 这件太凶，乖的人不留也不买 @source `cmp ebx, 2`（0x0042edf2 / 0x0042ee82 / 0x0042f0b5 / 0x0042f2a7）*/
const TOO_FIERCE = 2;

/** 道具那一轮的顺序（道具号）@source 表 `0x4755f0` = `07 01 06 00 03 02`（0 基）*/
export const AI_SHOP_TOOL_ORDER: readonly number[] = [8, 2, 7, 1, 4, 3];

const MOTORCYCLE_TOOL = 5;
const CAR_TOOL = 6;

export interface AiShopWorld {
  player: Player;
  tools: readonly number[];
  toolStock: readonly number[];
  /** 牌堆剩余（下标 = 卡号 − 1）*/
  cardAmount: readonly number[];
}

export interface AiShopResult {
  player: Player;
  tools: number[];
  toolStock: number[];
  cardAmount: number[];
  /** 这一趟按次序做了什么（测试 / 日志用；不进状态）*/
  log: AiShopStep[];
  /**
   * 这一趟的**營業額**（原版 `ebp`）＝ Σ 每次买卖那几个函数的返回值：
   * 买卡 / 买道具 `標價 × 10`、卖卡 `標價`、卖道具 `標價 × 数量`。
   * 由调用方按本格的企業编码记进 `+0x28 / +0x2c`（`state/reduce.ts` 的 `shopRevenueTo`）。
   */
  revenue: number;
}

export type AiShopStep =
  | { op: 'sellCard'; id: number }
  | { op: 'sellTool'; id: number; count: number }
  | { op: 'buyCard'; id: number }
  | { op: 'buyTool'; id: number };

/** 第 i 张卡（0 基）的 f7 —— S1 读的就是这个（槽号当卡表下标）*/
function cardFerocityAt(index0: number): number {
  return CARDS[index0]?.f7 ?? 0;
}

function toolFerocity(toolId: number): number {
  return TOOLS.find((t) => t.id === toolId)?.f7 ?? 0;
}

/**
 * 电脑（或托管）在百貨公司里的一整趟买卖 —— 见文件头的逐段表。
 */
export function aiShopVisit(world: AiShopWorld): AiShopResult {
  let player = world.player;
  let tools = [...world.tools];
  let toolStock = [...world.toolStock];
  const cardAmount = [...world.cardAmount];
  const log: AiShopStep[] = [];
  // ★ L48：这一趟的營業額（原版 `ebp`，逐笔累加、离店时一次性记进企業帳）
  let revenue = 0;
  const pers = player.personality;
  const me = player.index;

  const doSellCard = (id: number): void => {
    const r = sellCard(player, id);
    if (!r.ok) return;
    player = r.player;
    // @source consume_card `0x004413a2 inc byte [卡号 + 0x499197]` —— 卖掉的牌回牌堆
    cardAmount[id - 1] = (cardAmount[id - 1] ?? 0) + 1;
    // @source `0x42d145` 返回 **標價**（`0x0042d1a5 xor eax,eax / mov al,[卡*8+0x47fdef]`）
    revenue += cardPrice(id);
    log.push({ op: 'sellCard', id });
  };
  const doSellTool = (id: number, count: number): void => {
    const r = sellTool(player, tools, toolStock, id, count);
    if (!r.ok) return;
    player = r.player;
    tools = r.tools;
    toolStock = r.stock;
    // @source `0x42d1b2` 返回 **標價 × 数量**（`0x0042d1bf mov bl,[id*8+0x47fedf] / 0x0042d1c6 imul ebx,[数量]`
    //   → `0x0042d22f mov eax,ebx`）
    revenue += toolPrice(id) * count;
    log.push({ op: 'sellTool', id, count });
  };
  const doBuyTool = (id: number): void => {
    // @source `0x42d272`：receive_tool 之后 `sub word [+0x30], 價`；调用前各段已查过库存与上限
    const g = giveTool(tools, toolStock, me, id);
    if (!g.given) return;
    tools = g.tools;
    toolStock = g.stock;
    player = { ...player, points: addPoints(player.points, -toolPrice(id)) };
    // @source `0x42d272 jmp 0x42d25c` → 与买卡同一尾巴，返回 **標價 × 10**
    revenue += 10 * toolPrice(id);
    log.push({ op: 'buyTool', id });
  };

  // ── S1：太凶的卡卖掉（★ 按槽号取 f7）@source 0x0042ed8d..0x0042ee18 ──
  for (let i = 0; i < MAX_HAND_CARDS; i++) {
    const id = player.cards[i];
    if (id === undefined || id === 0) break;
    if (cardFerocityAt(i) - pers !== TOO_FIERCE) continue;
    doSellCard(id);
    i--; // @source 0x0042ee0e `lea esi, [edi-1]` —— 同一槽再看一遍
  }

  // ── S2：太凶的道具整种卖光 @source 0x0042ee1d..0x0042eea2 ──
  for (let id = 1; id <= MAX_TOOL_ID; id++) {
    const n = toolCount(tools, me, id);
    if (n === 0) continue;
    if (toolFerocity(id) - pers !== TOO_FIERCE) continue;
    doSellTool(id, n);
  }

  // ── S3：點券不够 100 就变卖 @source 0x0042eea4..0x0042f023 ──
  if (player.points < AI_SHOP_LOW_POINTS) {
    let cheapest = 0;
    let low = 0x2710; // @source 0x0042eec2 mov esi, 0x2710
    for (let i = 0; i < MAX_HAND_CARDS; i++) {
      const id = player.cards[i];
      if (id === undefined || id === 0) continue;
      const price = cardPrice(id);
      if (price < low) {
        low = price;
        cheapest = id;
      }
    }
    if (cheapest !== 0) doSellCard(cheapest);
    for (let id = 1; id <= MAX_TOOL_ID; id++) {
      const n = toolCount(tools, me, id);
      if (n > 1) doSellTool(id, n - 1); // @source 0x0042ef76 cmp cl, 1 / jbe
    }
    const moto = toolCount(tools, me, MOTORCYCLE_TOOL);
    if ((player.trafficMethod & 3) === TRAFFIC_MOTORCYCLE && moto !== 0) doSellTool(MOTORCYCLE_TOOL, moto);
    const car = toolCount(tools, me, CAR_TOOL);
    if ((player.trafficMethod & 3) === TRAFFIC_CAR && car !== 0) doSellTool(CAR_TOOL, car);
  }

  // @source 0x0042f033 test bx, bx / je 离店
  const points = player.points;
  if (points === 0) return { player, tools, toolStock, cardAmount, log, revenue };
  // @source 0x0042f043 `sar edi, 1`（卡预算）/ `sub eax, edi`（道具预算 = 另一半，向上取整）
  let cardBudget = points >> 1;
  let toolBudget = points - cardBudget;

  // ── C：买卡 @source 0x0042f050..0x0042f16a ──
  const candidates: number[] = [];
  for (let i = 0; i < CARDS.length; i++) {
    const card = CARDS[i]!;
    const left = cardAmount[card.id - 1] ?? 0;
    for (let k = 0; k < left; k++) {
      if (cardBudget < card.price) continue; // @source 0x0042f099 cmp edi, 價 / jl
      if (card.f7 - pers === TOO_FIERCE) continue;
      candidates.push(card.id);
    }
  }
  // @source `0x0042f0e4 call 0x457e6c(候选, n, 1, 0x42d0ef)`：1 字节元素（枢轴换到段首那一型）；
  //   比较器 `0x42d0ef` 比 `[卡*8 + 0x47fdf7]`（无符号字节价）：价高者在前，同价的次序照 Watcom 算法
  const sorted = watcomQsort(candidates, (a, b) => (cardPrice(a) > cardPrice(b) ? -1 : cardPrice(a) < cardPrice(b) ? 1 : 0), true);
  for (const id of sorted) {
    // @source 0x0042f105 call 0x441262 / cmp eax, 0xf / je 离开这一段
    if (player.cards.length >= MAX_HAND_CARDS) break;
    const price = cardPrice(id);
    if (cardBudget < price) continue;
    player = { ...player, cards: [...player.cards, id], points: addPoints(player.points, -price) };
    // @source receive_card `0x0044133b dec byte [卡号 + 0x499197]`
    cardAmount[id - 1] = (cardAmount[id - 1] ?? 0) - 1;
    cardBudget -= price;
    // @source `0x42f13b call 0x42d237` → 返回 **標價 × 10**，也进这一趟的 `ebp`
    revenue += 10 * price;
    log.push({ op: 'buyCard', id });
  }

  // ── V：交通工具 @source 0x0042f16c..0x0042f230 ──
  // 機車：`and al,3 / cmp al,1 / je 跳过`、`cmp byte [0x499160+..],0 / jne 跳过`、
  //       `cmp [0x47ff07]=80, 预算 / jge 跳过`、`cmp byte [0x497324],0 / je 跳过`
  if (
    (player.trafficMethod & 3) !== TRAFFIC_MOTORCYCLE &&
    toolCount(tools, me, MOTORCYCLE_TOOL) === 0 &&
    toolPrice(MOTORCYCLE_TOOL) < toolBudget &&
    (toolStock[MOTORCYCLE_TOOL] ?? 0) !== 0
  ) {
    doBuyTool(MOTORCYCLE_TOOL);
    toolBudget -= toolPrice(MOTORCYCLE_TOOL);
  }
  // 汽車：同形（`[0x499161]`、`[0x47ff0f]`=150、`[0x497325]`）@source 0x0042f1cc..0x0042f22b
  if (
    (player.trafficMethod & 3) !== TRAFFIC_CAR &&
    toolCount(tools, me, CAR_TOOL) === 0 &&
    toolPrice(CAR_TOOL) < toolBudget &&
    (toolStock[CAR_TOOL] ?? 0) !== 0
  ) {
    doBuyTool(CAR_TOOL);
    toolBudget -= toolPrice(CAR_TOOL);
  }

  // ── T：其余六件各买一件 @source 0x0042f232..0x0042f307 ──
  for (const id of AI_SHOP_TOOL_ORDER) {
    if (toolCount(tools, me, id) >= MAX_TOOL_COUNT) continue; // @source 0x0042f27a cmp …, 9 / jae
    if (toolFerocity(id) - pers === TOO_FIERCE) continue;
    const price = toolPrice(id);
    if (price > toolBudget) continue; // @source 0x0042f2bf cmp 價, 预算 / jg
    if ((toolStock[id] ?? 0) === 0) continue;
    doBuyTool(id);
    toolBudget -= price;
  }

  return { player, tools, toolStock, cardAmount, log, revenue };
}
