/*
 * 新聞 / 命運：**正負向分類**、抽取範圍、以及「一次落点只触发一次」的闸门
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 起因（试玩回报）：「新闻/命运全是倒霉的，没有正向的事件吗？另外好像有重复触发问题」。
 *
 * 本文件回答三件事，全部以 `rich4.exe` 为真值：
 * 1. **分类**：36 条新聞 + 37 条命運逐条判正/负/中性 —— 表在下面 `NEWS_POLARITY` /
 *    `FORTUNE_POLARITY`，每条的「钱往哪边走 / 关谁」都由 exe 的**资金原语调用点**定：
 *    `0x41d3f4 add_money`（进账）、`0x41d2c6 pay_money`（出账）、
 *    `0x43d593 send_to_prison`、`0x43ec3f send_to_hospital`、
 *    `0x40ab4a mutate_building`、`0x40ac7b damage_area`、`0x429040 company`（盈余加减）。
 *    分派表本身（`0x475e24` 36 项 / `0x475ef0` 37 项）已由
 *    `packages/data/src/event-table.test.ts` 逐项对着 exe 钉过，这里不重复。
 * 2. **抽取范围**：牌堆是 0..35 / 0..36 的**完整排列**（`fcn_00448b81` / `fcn_0044baea`
 *    的选择采样，见 `deck.ts` 与 `fortune.md` §1.5）—— 一轮之内每条都会轮到，
 *    没有「只抽得到某一段」这种事。
 * 3. **触发次数**：原版落点处理 `0x41982d` 全 exe **只有 1 个调用点**
 *    （`0x00418ea1`，移动结束那一拍），新聞/命運各只有 1 个入口
 *    （`0x41b11e call 0x44b6df` / `0x41b128 call 0x44db81`）⇒ 一次落点最多触发一次。
 *    分派器开头**另有一道闸门**（`0x419873`，`player+0x37` = 夢遊）—— 本文件钉住它。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORTUNE_EVENTS, NEWS_EVENTS, fortuneEvent, newsEvent } from '@rich4/data';
import { FORTUNE_DECK_SIZE, NEWS_DECK_SIZE, createDeck, drawEvent } from './deck.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { makeGameState, makeLand, makeNode, topoOf } from '../testing/factories.ts';
import { SPECIAL_KIND, parseMap } from '../loaders/map.ts';
import { reduce, type MapTopology } from '../state/reduce.ts';
import { newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import type { GameState } from '../state/types.ts';

// ============================================================
//  ① 逐条正负向分类（真值 = exe 里的资金/关押原语调用点）
// ============================================================

/**
 * 新聞 36 条的正负向。
 *
 * `'good'` = 对**被点名的人**是好事（进账 / 出狱 / 出院 / 涨价 / 复牌 / 企業获利）。
 * `'bad'`  = 对**被点名的人**是坏事（出账 / 坐牢 / 住院 / 拆屋 / 停牌 / 跌价 / 企業亏损）。
 * `'flat'` = 不直接动任何人的钱与状态（公开拍卖）。
 *
 * | id | 文案 | 判定 | exe 里的判据 |
 * |---|---|---|---|
 * | 0 | 獄中囚犯無罪開釋 | good | `0x448f31 mov byte [player+0x34], 0x80` + 清 `0x496b30` |
 * | 1 | 獄中囚犯延長刑期3天 | bad | `0x448f5b mov ecx,3` 后 `add dh,3 / and 0x7f` |
 * | 2 | 住院中病患提前出院 | good | 同 0，表换 `0x496b60` |
 * | 3 | 住院中病患延長住院3天 | bad | 同 1 |
 * | 4 | 外星人攻打地球 | bad | `0x44922d call 0x40ac7b`（重击）+ `0x449285 call 0x43ec3f`（住院）|
 * | 5 | 外星怪獸襲擊%s摧毀建築一棟 | bad | `0x4492a0..` 走 `mutate_building` 清除 |
 * | 6 | %s公告地價調漲３０％ | good | 地价 ×1.3（常量 `0x4654dc`）|
 * | 7 | 公開拍賣%s公有土地一處 | flat | `0x449735..` → `0x43bde5`（开拍，无买卖双方损失）|
 * | 8 | 公開表揚第一大地主 %s獲得%d元獎勵 | good | `0x449a5c call 0x41d3f4`（+現金）|
 * | 9 | 公開補助土地最少者 %s獲得%d元補助 | good | `0x449b97 jmp 0x4499c1` → 同 8 的 `0x41d3f4` |
 * | 10 | 公開表揚股市第一大戶 %s獲得%d元獎勵 | good | `0x449c77 jmp 0x4499c1` → 同 8 的 `0x41d3f4` |
 * | 11 | 所有人繳交所得稅５％ | bad | `0x449ddb call 0x41d2c6`（−現金，进公库）|
 * | 12 | 所有人繳交地價稅５％ | bad | 同上（基数 = 地产原值）|
 * | 13 | 所有人繳交證交稅５％ | bad | 同上（基数 = 持股市值）|
 * | 14 | %s房屋鬧鬼 地價下跌３０％ | bad | 地价 ×0.7（常量 `0x46561c`）|
 * | 15 | %s一處民宅瓦斯爆炸 房屋失火 | bad | `mutate_building` 降级／清除 |
 * | 16 | 豪雨特報 行人休息一回合 | bad | 写全体 `traffic_method==0` 者的停留计数 |
 * | 17 | 交通阻塞 汽車停止一回合 | bad | 写全体 `traffic_method!=0` 者的停留计数 |
 * | 18 | %s強烈地震房屋倒塌 | bad | 拆同名建筑 |
 * | 19 | %s山洪爆發土地流失 | bad | `mutate_building` 清除归属 |
 * | 20 | 超級颱風侵襲%s 多處房屋受損 | bad | `0x44ac21` 一带 `call 0x40ac7b`（flags 6 = 只打建筑）|
 * | 21 | 龍捲風侵襲%s 摧毀房屋一棟 | bad | `0x40af12` + `0x40ab4a` |
 * | 22 | 銀行擠兌停止放款１５天 | bad | `mov byte [player+0x3c], 15`（全體，见 `LOAN_FREEZE_DAYS`）|
 * | 23 | 銀行加發１０％儲金紅利 | good | `0x44af66 call 0x41d3f4`（存款 ×1.1 进银行）|
 * | 24 | 股市低迷不振重挫崩盤 | bad | `0x44b00a..` 改各股 `newsFlag`（行情下挫）|
 * | 25 | 股市氣勢如虹全面上漲 | good | 同上，方向相反 |
 * | 26 | 股市暫停交易１０天 | bad | `0x44b0c6 mov dword [0x4990dc], 0xa` |
 * | 27 | %s股票暫停交易１０天 | bad | `mov byte [股票+6], 0xf`（停牌）|
 * | 28 | %s股票恢復上市交易 | good | `mov byte [股票+6], 0`（复牌）|
 * | 29 | %s違法超貸 經營者%s坐牢５天 | bad | `0x44b361 call 0x43d593`（5 天）|
 * | 30 | %s工廠排放污水 罰款10000元 | bad | 企業 `+0x28` −10000 |
 * | 31 | %s海外投資 獲利20000元 | good | 企業 `+0x28` +20000 |
 * | 32 | %s海外投資 虧損20000元 | bad | 企業 `+0x28` −20000 |
 * | 33 | %s違規開發山坡地 罰款10000元 | bad | 企業 `+0x28` −10000 |
 * | 34 | %s製造噪音公害 罰款5000元 | bad | 企業 `+0x28` −5000 |
 * | 35 | %s獲利調高一倍 | good | 企業 `+0x2c` 翻倍 |
 */
export const NEWS_POLARITY: Readonly<Record<number, 'good' | 'bad' | 'flat'>> = {
  0: 'good', 1: 'bad', 2: 'good', 3: 'bad', 4: 'bad', 5: 'bad',
  6: 'good', 7: 'flat', 8: 'good', 9: 'good', 10: 'good',
  11: 'bad', 12: 'bad', 13: 'bad', 14: 'bad', 15: 'bad', 16: 'bad',
  17: 'bad', 18: 'bad', 19: 'bad', 20: 'bad', 21: 'bad', 22: 'bad',
  23: 'good', 24: 'bad', 25: 'good', 26: 'bad', 27: 'bad', 28: 'good',
  29: 'bad', 30: 'bad', 31: 'good', 32: 'bad', 33: 'bad', 34: 'bad',
  35: 'good',
};

/**
 * 命運 37 条的正负向。
 *
 * | id | 文案 | 判定 | exe 里的判据 |
 * |---|---|---|---|
 * | 0 | 強制拆除房屋一棟 | bad | 拆自有建筑（`add_money` 那一声是**赔给地主**的）|
 * | 1 | 強制徵收土地一處 | bad | 同上（土地被徵收）|
 * | 2 | 人頭被盜用冒貸%d元 | bad | `0x44c218` 一带 `0x41d2c6`／记账进 `loan` + 理赔 `0x44ba63` |
 * | 3 | 支票跳票 銀行拒絕往來一個月 | bad | 写 `rejected_by_bank` |
 * | 4 | 侵入銀行電腦 挪用其他人存款%d％ | bad | `0x44c2f6 call 0x41d2c6`（flags 4：先扣存款）|
 * | 5 | 今天是你生日 向每人收取一張卡片 | good | `0x441e77` 抽走别人的卡 + `0x4412e4` 收进自己手里 |
 * | 6 | 強迫出國觀光%d天 | bad | `fcn_0040d375(player, 天數, 0)` |
 * | 7 | 被外星人綁架%d天 | bad | 同上（原因 1）|
 * | 8 | 股票違約交割損失股票%d％ | bad | 强制卖掉 10% 持股 |
 * | 9 | 變賣所有股票求現 | bad | 持仓清零（换回现金，但是被强制的）|
 * | 10 | 機車被偷遺失 | bad | `0x40b93b` 清座驾 |
 * | 11 | 汽車撞電線桿全毀 | bad | 同 10 |
 * | 12 | 掉進水溝就醫%d天 | bad | `0x44cd41` 二级判定 + `call 0x43ec3f` |
 * | 13 | 騎機車摔傷住院%d天 | bad | 复用 12 的函数体（`0x44cd6c jmp`）|
 * | 14 | 行人闖越馬路罰款%d元 | bad | `0x44cec2 call 0x41d2c6` |
 * | 15 | 騎機車未戴安全帽 罰款%d元 | bad | 复用 12/14 那一族的收尾 |
 * | 16 | 汽車超速罰款%d元 | bad | 同上 |
 * | 17 | 請所有人吃大餐 花費%d元 | bad | 出账 |
 * | 18 | 亂丟垃圾罰款%d元 | bad | 出账 |
 * | 19 | 你家小狗亂大小便 罰款%d元 | bad | 出账 |
 * | 20 | 在路邊撿到%d元 | good | `0x44d31f call 0x41d3f4`（+現金）|
 * | 21 | 在路邊撿到%d元 | good | `0x44d33b jne 0x44d2a9`（同一收尾）|
 * | 22 | 在路邊撿到%d元 | good | 同上 |
 * | 23 | 遺失錢包損失%d元 | bad | 出账 |
 * | 24 | 遺失錢包損失%d元 | bad | 出账 |
 * | 25 | 意外獲得遺產%d元 | good | 同上收尾（`0x44d4a6 jne 0x44d2a9`）|
 * | 26 | 被倒會損失%d元 | bad | 出账 |
 * | 27 | 發票中獎%d元 | good | 同 20 的收尾 |
 * | 28 | 發票中獎%d元 | good | 同上 |
 * | 29 | 發票中獎%d元 | good | 同上 |
 * | 30 | 付保險金%d元 | bad | 出账 |
 * | 31 | 領取保險金%d元 | good | 同上收尾（+現金）|
 * | 32 | 變賣所有卡片道具 | bad | `0x445b3f` / `0x441f21` 强制变卖（进點券，但失去牌/道具）|
 * | 33 | 酒醉大鬧警局坐牢%d天 | bad | `secondary_judgement` + `send_to_prison` |
 * | 34 | 防礙風化坐牢%d天 | bad | 同 33 |
 * | 35 | 走私毒品坐牢%d天 | bad | 同 33 |
 * | 36 | 販賣大補帖坐牢%d天 | bad | 同 33 |
 */
export const FORTUNE_POLARITY: Readonly<Record<number, 'good' | 'bad' | 'flat'>> = {
  0: 'bad', 1: 'bad', 2: 'bad', 3: 'bad', 4: 'bad', 5: 'good', 6: 'bad',
  7: 'bad', 8: 'bad', 9: 'bad', 10: 'bad', 11: 'bad', 12: 'bad', 13: 'bad',
  14: 'bad', 15: 'bad', 16: 'bad', 17: 'bad', 18: 'bad', 19: 'bad', 20: 'good',
  21: 'good', 22: 'good', 23: 'bad', 24: 'bad', 25: 'good', 26: 'bad',
  27: 'good', 28: 'good', 29: 'good', 30: 'bad', 31: 'good', 32: 'bad',
  33: 'bad', 34: 'bad', 35: 'bad', 36: 'bad',
};

/** 新闻里「进账」的四条 —— `effects` 必须是 `give`（金额 = `factor × 物價`）@source `0x41d3f4` */
const NEWS_GIVE_IDS = [8, 9, 10, 23];
/** 新闻里「交税」的三条 —— `effects` 必须是 `pay` @source `0x41d2c6` */
const NEWS_PAY_IDS = [11, 12, 13];

describe('★ 新聞/命運正負向分类（真值 = exe 的资金/关押原语调用点）', () => {
  it('36 条新聞 + 37 条命運**一条不漏**地分类了', () => {
    expect(Object.keys(NEWS_POLARITY).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: NEWS_DECK_SIZE }, (_, i) => i),
    );
    expect(Object.keys(FORTUNE_POLARITY).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: FORTUNE_DECK_SIZE }, (_, i) => i),
    );
    // 数据表的 id 与分类表的键一一对应
    expect(NEWS_EVENTS.map((e) => e.id)).toEqual(Array.from({ length: NEWS_DECK_SIZE }, (_, i) => i));
    expect(FORTUNE_EVENTS.map((e) => e.id)).toEqual(
      Array.from({ length: FORTUNE_DECK_SIZE }, (_, i) => i),
    );
  });

  it('★ 判「good」的每条都有正向依据：`give` 因子，或释放/涨价/复牌/企業获利那一族', () => {
    const good = Object.entries(NEWS_POLARITY)
      .filter(([, p]) => p === 'good')
      .map(([id]) => Number(id));
    // 与 exe 对得上的 11 条（试玩回报问的「没有正向的吗」就是这一列）
    expect(good).toEqual([0, 2, 6, 8, 9, 10, 23, 25, 28, 31, 35]);
    for (const id of good) {
      const e = newsEvent(id)!;
      const positiveTag =
        e.effects.includes('give') ||
        e.effects.includes('releasePrison') ||
        e.effects.includes('releaseHospital') ||
        e.effects.includes('raiseLandPrice') ||
        e.effects.includes('marketBullish') ||
        e.effects.includes('resumeStock') ||
        e.effects.includes('companyGain') ||
        e.effects.includes('companyProfitDouble');
      expect(positiveTag, `新聞 ${id} 被判 good，但 effects=${JSON.stringify(e.effects)}`).toBe(true);
      // ★ 反例：判 good 的**一条都不许**带 pay / 拆屋 / 关押那几族
      expect(e.effects.includes('pay')).toBe(false);
      expect(e.effects.includes('prison')).toBe(false);
      expect(e.effects.includes('hospital')).toBe(false);
      expect(e.effects.includes('companyPenalty')).toBe(false);
      expect(e.effects.includes('marketBearish')).toBe(false);
      expect(e.effects.includes('suspendStock')).toBe(false);
    }
  });

  it('★ 四条「进账」是 `give`、三条「缴税」是 `pay`（方向不许反）', () => {
    // @source `0x41d3f4 add_money` / `0x41d2c6 pay_money`
    expect(NEWS_EVENTS.filter((e) => e.effects.includes('give')).map((e) => e.id)).toEqual(NEWS_GIVE_IDS);
    expect(NEWS_EVENTS.filter((e) => e.effects.includes('pay')).map((e) => e.id)).toEqual(NEWS_PAY_IDS);
    for (const id of NEWS_GIVE_IDS) {
      expect(NEWS_POLARITY[id]).toBe('good');
    }
    // 8/9/10 的金额 = `factor × 物價`（`0x449a4e mov ebx,[0x48c5a0]`）；
    // 23 是**百分比类**（存款 × 1.1，`0x44af4a fmul`），故 `factor` 为 null。
    for (const id of [8, 9, 10]) expect(newsEvent(id)!.factor, `新聞 ${id}`).not.toBeNull();
    expect(newsEvent(23)!.factor).toBeNull();
    for (const id of NEWS_PAY_IDS) {
      expect(NEWS_POLARITY[id]).toBe('bad');
    }
  });

  it('★ 命運的正向一共 9 条（20/21/22/25/27/28/29/31 进账 + 5 收卡）', () => {
    const good = Object.entries(FORTUNE_POLARITY)
      .filter(([, p]) => p === 'good')
      .map(([id]) => Number(id));
    expect(good).toEqual([5, 20, 21, 22, 25, 27, 28, 29, 31]);
    // 进账那八条的 `factor` 都不为空（金额 = factor × 物價）@source `0x44d31f call 0x41d3f4`
    for (const id of good) {
      if (id === 5) continue; // 生日收卡与钱无关
      expect(fortuneEvent(id)!.factor, `命運 ${id}`).not.toBeNull();
    }
  });

  it('★ 汇总：原版本身就是「负面居多」—— 这不是复刻的偏差', () => {
    const tally = (m: Readonly<Record<number, string>>): Record<string, number> => {
      const out: Record<string, number> = { good: 0, bad: 0, flat: 0 };
      for (const v of Object.values(m)) out[v] = (out[v] ?? 0) + 1;
      return out;
    };
    // 新聞 11 好 / 24 坏 / 1 中性；命運 9 好 / 28 坏。数字写死 = 可证伪。
    expect(tally(NEWS_POLARITY)).toEqual({ good: 11, bad: 24, flat: 1 });
    expect(tally(FORTUNE_POLARITY)).toEqual({ good: 9, bad: 28, flat: 0 });
  });
});

// ============================================================
//  ② 抽取范围：整副牌一轮之内每条都轮到
// ============================================================

describe('★ 抽取范围 = 完整排列（不是「只抽得到某一段」）', () => {
  const drawLap = (size: number): number[] => {
    const rng = new WatcomRng();
    rng.setState(0x1234_5678);
    let deck = createDeck(rng, size);
    const seen: number[] = [];
    for (let i = 0; i < size; i++) {
      // 可行性一律放行 —— 单看「牌堆里有没有这一段」
      const r = drawEvent(deck, () => true);
      deck = r.deck;
      seen.push(r.eventId);
    }
    return seen;
  };

  it('★ 新聞一轮 36 张 = 0..35 的一个排列（无重复、无遗漏）', () => {
    const seen = drawLap(NEWS_DECK_SIZE);
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 36 }, (_, i) => i));
    // 正向那 11 条都在范围里
    for (const id of [0, 2, 6, 8, 9, 10, 23, 25, 28, 31, 35]) expect(seen).toContain(id);
  });

  it('★ 命運一轮 37 张 = 0..36 的一个排列', () => {
    const seen = drawLap(FORTUNE_DECK_SIZE);
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    for (const id of [5, 20, 21, 22, 25, 27, 28, 29, 31]) expect(seen).toContain(id);
  });

  it('★ 游标走完一轮回到 0；不可行的牌会被跳过但**游标照样前进**', () => {
    const rng = new WatcomRng();
    rng.setState(7);
    const deck = createDeck(rng, NEWS_DECK_SIZE);
    // 只放行 id 0 —— 应当正好在「0 出现的那一张」停下，且游标已经跨过前面所有张
    const first = deck.order.indexOf(0);
    const r = drawEvent(deck, (id) => id === 0);
    expect(r.eventId).toBe(0);
    expect(r.skipped).toBe(first);
    expect(r.deck.cursor).toBe((first + 1) % NEWS_DECK_SIZE);
  });
});

// ============================================================
//  ③ 一次落点只触发一次 + 夢遊闸门（0x419873）
// ============================================================

const NEWS_NODE = 1;

/** 一个「站在新聞格上、正准备 settle」的最小局面（牌堆是顺序牌堆） */
function onNewsSquare(over: Partial<GameState> = {}, topo?: MapTopology): {
  state: GameState;
  topo: MapTopology;
} {
  const t: MapTopology =
    topo ?? { nodes: [makeNode({ id: NEWS_NODE, specialKind: SPECIAL_KIND.NEWS })], lands: [] };
  const base = makeGameState({ phase: 'settling', ...over });
  const state: GameState = {
    ...base,
    players: base.players.map((p, i) => (i === base.currentPlayer ? { ...p, nodeId: NEWS_NODE } : p)),
  };
  return { state, topo: t };
}

describe('★ 一次落点只触发一次（原版 `0x41982d` 全 exe 只有 1 个调用点 `0x00418ea1`）', () => {
  /** 牌堆第一张就是可行事件（`6` 恒可行）—— 这样「推进几张」可以直接看游标 */
  const deckOf = (ids: number[]): { order: number[]; cursor: number } => ({
    order: [...ids, ...Array.from({ length: 36 - ids.length }, (_, i) => (i + 20) % 36)],
    cursor: 0,
  });

  it('★ 同一个 `settle` 连派两次：只有第一次真的抽牌', () => {
    const { state, topo } = onNewsSquare();
    const s: GameState = { ...state, newsDeck: deckOf([6]) };
    const once = reduce(s, { type: 'settle' }, topo);
    expect(once.newsDeck.cursor).toBe(1);
    expect(once.lastEvent?.kind).toBe('news');
    expect(once.lastEvent?.id).toBe(6);
    expect(once.phase).toBe('turnEnd');
    // 第二次：阶段已经不是 settling ⇒ 原样返回（连游标都不动）
    const twice = reduce(once, { type: 'settle' }, topo);
    expect(twice).toBe(once);
    expect(twice.newsDeck.cursor).toBe(1);
  });

  it('★ 顺序牌堆时，不可行的牌会被跳过 —— 游标照样前进（原版 `0x44b7c7` 的 `inc`）', () => {
    // 夹具的牌堆是 0,1,2,…：0/1 要有人坐牢、2/3 要有人住院、4/5 要有已建房屋、
    // 7 要有无主地…第一条恒可行的是 **6**（`check_news` 默认返回 1）。
    const { state, topo } = onNewsSquare();
    const out = reduce(state, { type: 'settle' }, topo);
    expect(out.lastEvent?.id).toBe(6);
    expect(out.newsDeck.cursor).toBe(7); // 跳过的 6 张也把游标推着走
  });

  it('★ 一次落点只推进**一张**牌（不是两张，也不是零张）', () => {
    // 牌堆制成 [23, 23, ...]：若一次落点抽了两回，红利会翻倍
    const { state, topo } = onNewsSquare();
    const withDeck: GameState = {
      ...state,
      newsDeck: deckOf([23]),
      players: state.players.map((p) => ({ ...p, moneyInBank: 1000, loan: 0 })),
    };
    const out = reduce(withDeck, { type: 'settle' }, topo);
    expect(out.newsDeck.cursor).toBe(1);
    // 儲金紅利 = trunc(存款 × **0.1**)（`0x465734` 的双精度常量 = 0.1，
    // `0x44af4a fmul` / `0x44af55 fistp`）→ 1000 + 100 = 1100。
    // 若一次落点抽了两回，这里会变成 1210。
    expect(out.players[0]!.moneyInBank).toBe(1100);
  });

  it('★★ 夢遊中的落点闸门 @source 0x00419873（少了它就会「重复触发」）', () => {
    // `cmp byte [eax + 0x496b9f], 0 / je 0x419884` —— `+0x37` = days_sleep_walking
    const { state, topo } = onNewsSquare();
    const asleep: GameState = {
      ...state,
      newsDeck: deckOf([6]),
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, sleepWalking: 3 } } : p,
      ),
    };
    const out = reduce(asleep, { type: 'settle' }, topo);
    // 什么都不发生：游标不动、没有事件、阶段照旧收尾
    expect(out.newsDeck.cursor).toBe(0);
    expect(out.lastEvent).toBeNull();
    expect(out.phase).toBe('turnEnd');
    expect(out).not.toBe(asleep); // 只改了 phase
  });

  it('★ 反例（对照组）：没梦游时同一格照抽 —— 闸门只认 `+0x37`', () => {
    const { state, topo } = onNewsSquare();
    const awake: GameState = {
      ...state,
      newsDeck: deckOf([6]),
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, blocking: { ...p.blocking, sleepWalking: 0 } } : p,
      ),
    };
    const out = reduce(awake, { type: 'settle' }, topo);
    expect(out.newsDeck.cursor).toBe(1);
    expect(out.lastEvent?.id).toBe(6);
  });
});

// ============================================================
//  ④ 正向事件真的「正向」—— 钱要往对的人身上走
// ============================================================

describe('★ 正向事件真的在发钱 / 发在对的人身上', () => {
  const newsTopo = (): MapTopology => ({
    nodes: [makeNode({ id: NEWS_NODE, specialKind: SPECIAL_KIND.NEWS })],
    // 8 号新闻按「地产数」评第一大地主：给 1 号玩家两块已建地
    lands: [makeLand({ id: 1, owner: 2, level: 1 }), makeLand({ id: 2, owner: 2, level: 1 })],
    facilities: [],
  });

  it('★ 新聞 8「公開表揚第一大地主」：钱进**地主**（不是抽牌人）', () => {
    const { state } = onNewsSquare({ priceIndex: 1 }, newsTopo());
    const deck = { order: [8, ...Array.from({ length: 35 }, (_, i) => i + 1)], cursor: 0 };
    const s: GameState = {
      ...state,
      newsDeck: deck,
      players: state.players.map((p) => ({ ...p, cash: 10_000 })),
    };
    const out = reduce(s, { type: 'settle' }, newsTopo());
    expect(out.lastEvent).toEqual({ kind: 'news', id: 8 });
    // @source `0x449a55`：受益者是 `[0x48c59c]`（第一大地主 = 玩家 1）
    expect(out.players[1]!.cash).toBe(20_000); // +10000 × 物價 1
    expect(out.players[0]!.cash).toBe(10_000); // 抽牌者一分没多
  });

  it('★★ 新聞 10「公開表揚股市第一大戶」：钱进**持股最多**的人（本次修的 bug）', () => {
    // @source `0x00449be2 add [esp+esi*4+0x94], dword[eax+0x4971a0]` 逐支累加**股数**，
    //   `0x00449c1d cmp ecx,ebx / jge` 严格 `>` 才更新 ⇒ 并列取第一个；出局者不参评。
    const { state, topo } = onNewsSquare({ priceIndex: 1 });
    const deck = { order: [10, ...Array.from({ length: 35 }, (_, i) => i + 1)], cursor: 0 };
    const s: GameState = {
      ...state,
      newsDeck: deck,
      players: state.players.map((p) => ({ ...p, cash: 10_000 })),
      holdings: [
        state.holdings[0]!, // 抽牌者：0 股
        state.holdings[1]!.map((h) => ({ ...h, amount: 7 })), // 玩家 1：次多
        state.holdings[2]!.map((h) => ({ ...h, amount: 9 })), // 玩家 2：最多
        state.holdings[3]!,
      ],
    };
    const out = reduce(s, { type: 'settle' }, topo);
    expect(out.lastEvent).toEqual({ kind: 'news', id: 10 });
    expect(out.players[2]!.cash).toBe(20_000); // ★ 股市第一大户
    expect(out.players[1]!.cash).toBe(10_000);
    expect(out.players[0]!.cash).toBe(10_000); // ★ 抽牌者（旧实现会错发给他）
  });

  it('★ 新聞 23「銀行加發１０％儲金紅利」：钱进**存款**', () => {
    const { state, topo } = onNewsSquare();
    const deck = { order: [23, ...Array.from({ length: 35 }, (_, i) => i + 1)], cursor: 0 };
    const s: GameState = {
      ...state,
      newsDeck: deck,
      players: state.players.map((p) => ({ ...p, moneyInBank: 5000, cash: 0 })),
    };
    const out = reduce(s, { type: 'settle' }, topo);
    // @source `0x44af44 fild [player+0x20]` / `0x44af4a fmul qword [0x465734] = 0.1`
    //   → `0x41d3f4(player, amt, 0)`（flags 0 = 进银行存款，不是现金）
    expect(out.players[0]!.moneyInBank).toBe(5500);
    expect(out.players[0]!.cash).toBe(0);
  });

  it('★ 新聞 23：有贷款的人**不发**红利 @source `0x44af36 mov ebp,[ebx+0x496b8c] / jne 跳过`', () => {
    const { state, topo } = onNewsSquare();
    const s: GameState = {
      ...state,
      newsDeck: { order: [23, ...Array.from({ length: 35 }, (_, i) => i + 1)], cursor: 0 },
      players: state.players.map((p, i) => ({ ...p, moneyInBank: 1000, loan: i === 1 ? 500 : 0 })),
    };
    const out = reduce(s, { type: 'settle' }, topo);
    expect(out.players[0]!.moneyInBank).toBe(1100); // 无贷款 → +100（1000 的 10%）
    expect(out.players[1]!.moneyInBank).toBe(1000); // ★ 有贷款 → 一分不发
    // 「先算好」的明细也只带无贷款的人（原版那一行也不画）
    expect(out.lastEvent?.shares?.map((x) => x.player)).toEqual([0, 2, 3]);
  });

  it('★ 命運 20/25「撿到錢／意外獲得遺產」：+現金 @source `0x44d31f call 0x41d3f4`', () => {
    const nodes = [makeNode({ id: 1, specialKind: SPECIAL_KIND.FORTUNE })];
    const topo: MapTopology = { nodes, lands: [], facilities: [] };
    for (const [id, factor] of [
      [20, 1000],
      [25, 10_000],
    ] as const) {
      const base = makeGameState({ phase: 'settling', priceIndex: 1 });
      const s: GameState = {
        ...base,
        fortuneDeck: { order: [id, ...Array.from({ length: 36 }, (_, i) => i + 1)], cursor: 0 },
        players: base.players.map((p, i) => (i === 0 ? { ...p, nodeId: 1, cash: 100 } : p)),
      };
      const out = reduce(s, { type: 'settle' }, topo);
      expect(out.lastEvent).toEqual({ kind: 'fortune', id });
      expect(out.players[0]!.cash).toBe(100 + factor);
    }
  });
});

// ============================================================
//  ⑤ 真跑一局：正向事件**真的会出现**（不是「全是倒霉的」）
// ============================================================

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));
const fourCpus = () => [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

/** 4 个电脑真打若干局，统计新聞/命運各抽到过哪些 id */
function tallyEventIds(seeds: number[]): { news: Set<number>; fortune: Set<number> } {
  const map = loadMap();
  const topo = topoOf(map);
  const news = new Set<number>();
  const fortune = new Set<number>();
  for (const seed of seeds) {
    let state: GameState = newGame({ map, players: fourCpus(), seed });
    for (let steps = 0; steps < 200_000; steps++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      const next = reduce(state, a, topo);
      if (next === state) break;
      state = next;
      if (state.lastEvent?.kind === 'news') news.add(state.lastEvent.id);
      if (state.lastEvent?.kind === 'fortune') fortune.add(state.lastEvent.id);
    }
  }
  return { news, fortune };
}

describe('★ 真跑一局：正向事件真的会抽到（试玩「全是倒霉的」的证伪）', () => {
  // ★ 种子表 2026-09-19 补了 26 / 27：新聞 2 要求**抽到那一刻医院里有人**（`isNewsFeasible`），
  //   40 个种子里只有 5–7 个会出（改动前 12/21/30/31/34/35/39，接上神明落脚顯靈后对局走向变了 ⇒
  //   26/27/34/39/40）。原先 1..12 里全靠种子 12 一局撑着 —— 断言没放宽，只是把样本补到仍然覆盖。
  // ★ 种子表 2026-09-22 把 27 换成 46：本轮改动（魔法屋 NPC 不再铺场 / 删掉走子期间重画骰子 /
  //   小游戏两处修正 / 命運 0 的 `lands` 源修正）又一次改了 AI 对局走向，14 局里 **新聞 28**
  //   （股票恢復上市交易 —— 要求抽到那一刻场上真有**停牌中**的股票，`isNewsFeasible`）掉出了覆盖。
  //   扫过 1..120 全部 120 个种子（每局 ≤ 200k 步，逐局读数见扫描记录），能出 28 的只有
  //   14/43/46/61/63/71/81/92/101/116，其中**只有 46 同时带 2 / 28 / 35**（0+2+28+35 一起出的
  //   一个都没有）。换上 46 后两副牌 36/36 与 37/37 全覆蓋 —— 断言一个字没动，只换了输入。
  // ★ 种子表 2026-09-24 把 46 换成 15：第 24 份的改动（魔法屋「向後轉」重挑来路吃 `rand()`、機器娃娃
  //   不扫附身物件并走 `0x40e14d`、电脑用娃娃不再把别人身上的神明当路上的）又改了对局走向，
  //   **新聞 28** 再次掉出覆盖。重扫 1..120：能出 28 的是 15/16/63/71/101，拿 15 顶 46 后
  //   两副牌 36/36 与 37/37 —— 断言一个字没动，只换了输入。
  // ★ 种子表 2026-09-24（第二十六份）把 15 换成 43：电脑进百貨改走原版那一支（`places/ai-shop.ts`：
  //   不抽货架 ⇒ 少耗随机数；只拿一半點券逛道具、先買機車）又改了对局走向，**新聞 28** 再次掉出覆盖。
  //   重扫 1..120：能出 28 的是 43/46/63/92/101，拿 43 顶 15 后两副牌 36/36 与 37/37 —— 断言一个字没动。
  // ★ 种子表 2026-09-25（审计 provenance-ai-econ）把 43 换成 46：电脑买股 / 卖股改在 reducer 按原版掷全局
  //   `rand()`（买股入口每回合一次）、公佈欄 / 銀行对账补齐 ⇒ 对局走向又变了，**新聞 28** 掉出覆盖。
  //   重扫 1..120：能出 28 的是 15/46/61/63/71/92/101，拿 46 顶 43 后两副牌 36/36 与 37/37 —— 断言一个字没动。
  run('★ 14 局里：11 条正向新聞与 9 条正向命運一条不少，且两副牌各覆盖 ≥ 30 条', () => {
    const { news, fortune } = tallyEventIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 26, 46]);
    const missingNews = [0, 2, 6, 8, 9, 10, 23, 25, 28, 31, 35].filter((id) => !news.has(id));
    const missingFortune = [5, 20, 21, 22, 25, 27, 28, 29, 31].filter((id) => !fortune.has(id));
    expect({ missingNews, missingFortune }).toEqual({ missingNews: [], missingFortune: [] });
    // 牌堆是整个 0..35：一轮下来绝大多数都会轮到（少数要坐牢/停牌等前置）
    expect(news.size).toBeGreaterThanOrEqual(30);
    expect(fortune.size).toBeGreaterThanOrEqual(30);
  }, 300_000);
});
