/*
 * 魔法屋
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 魔法屋是**两个转盘**：一个转「做什么」，一个转「对谁做」。
 *   先前只解出了功能名与摆位（`@rich4/data` 的 `MAGIC_HOUSE_OPTIONS`），
 *   效果与目标都留空。这次两张跳表都找到了：
 *
 * ```
 * 效果派发  jmp [option * 4 + 0x00431c7a]     12 项，VA 0x004320d6
 * 目标筛选  jmp [criterion * 4 + 0x00431812]  12 项，VA 0x00431860
 * ```
 *
 *   目标筛出来写进 `[0x48c380]`（最多 4 个，值为玩家下标 + 1，0 结束），
 *   效果函数再**对名单里的每个人逐一执行**（VA 0x004320aa 的循环）。
 *   所以「變賣所有卡片」不是卖自己的，是卖**被转盘点到的那些人**的。
 *
 * ⚠️ 本模块只做规则。转盘动画、选项高亮、`[0x48c3a2]` 那套窗口状态机
 *   一概不进 core（C-ARC-2）；两个转盘的结果作为参数传入。
 */

import type { Player } from '../state/types.ts';
import { isAlive } from '../state/types.ts';
import { CARDS, TOOLS } from '@rich4/data';
import { TOOL_SLOTS_PER_PLAYER } from '../rules/tools.ts';

// ============================================================
//  目标转盘
// ============================================================

/**
 * 十二个「对谁做」。
 *
 * @source 名称表 VA 0x004756b8，12 个指针。字符串带 `#NNNN` 前缀
 *   （语音资源号），原版显示前会 `cmp byte [eax], '#' / add eax, 5` 跳掉。
 */
export const MAGIC_TARGET_NAMES: readonly string[] = [
  '財產最多的人',
  '土地最多的人',
  '房屋最多的人',
  '現金最多的人',
  '存款最多的人',
  '點券最多的人',
  '走路的人',
  '騎機車的人',
  '開汽車的人',
  '神明附身的人',
  '所有男生',
  '所有女生',
];

export const MAGIC_TARGET_COUNT = MAGIC_TARGET_NAMES.length;

/** 目标名单最多几人 @source `cmp edi, 4 / jge 结束`（VA 0x004320ab） */
export const MAX_MAGIC_TARGETS = 4;

export interface MagicTargetContext {
  players: readonly Player[];
  /** 某人名下的地块 + 设施数（criterion 1） */
  landCountOf: (playerIndex: number) => number;
  /** 其中**已开发**（等级非 0）的数量（criterion 2） */
  houseCountOf: (playerIndex: number) => number;
  /** 身家（criterion 0） @source `0x004239b9` */
  wealthOf: (playerIndex: number) => number;
}

/**
 * 取最大值的那些人 —— **并列全算**。
 *
 * @source 前六个筛选器共用的模板，例如 VA 0x00431a23（現金最多）：
 * ```asm
 * best = 0 ; n = 0
 * for (p = 0; p < 人数; p++) {
 *     if (!alive(p)) continue
 *     v = 指标(p)
 *     if (v == 0) continue                 ; ★ 指标为 0 的直接不参选
 *     if (best < v) { best = v; if (n) { 清空名单; n = 0 } ; 收录 }
 *     else if (best == v) 收录              ; ★ 并列的一起收
 * }
 * ```
 *
 * ⚠️ 「財產最多的人」这一条**没有 `v == 0` 那句**（VA 0x00431867 里
 *   直接比较，不查零）。身家可以是负的，负得最少的也能被点到。
 */
function maxBy(
  players: readonly Player[],
  metric: (p: number) => number,
  skipZero: boolean,
): number[] {
  let best = 0;
  let out: number[] = [];
  for (const p of players) {
    if (!isAlive(p)) continue;
    const v = metric(p.index);
    // @source test ebp, ebp / je 跳过
    if (skipZero && v === 0) continue;
    if (out.length === 0 || v > best) {
      best = v;
      out = [p.index];
    } else if (v === best) {
      out.push(p.index);
    }
  }
  return out;
}

/** 满足条件的所有人 —— 后六条筛选器的模板，不比大小 */
function allWhere(players: readonly Player[], pred: (p: Player) => boolean): number[] {
  const out: number[] = [];
  for (const p of players) {
    if (!isAlive(p)) continue;
    if (pred(p)) out.push(p.index);
  }
  return out;
}

/**
 * 转盘点到的那些人。
 *
 * @source 跳表 VA 0x00431812，每一项的判据：
 * | # | 名称 | 判据 |
 * |---|---|---|
 * | 0 | 財產最多的人 | max `0x4239b9(p)`，**不查零** |
 * | 1 | 土地最多的人 | max（地块 + 设施里 `owner == p+1` 的个数） |
 * | 2 | 房屋最多的人 | 同上，但还要 `level != 0` |
 * | 3 | 現金最多的人 | max `+0x1c` |
 * | 4 | 存款最多的人 | max `+0x20` |
 * | 5 | 點券最多的人 | max `+0x30` |
 * | 6 | 走路的人 | `traffic & 3 == 0` |
 * | 7 | 騎機車的人 | `traffic & 3 == 1` |
 * | 8 | 開汽車的人 | `traffic & 3 == 2` |
 * | 9 | 神明附身的人 | `god_info != 0` |
 * | 10 | 所有男生 | `sex != 0` |
 * | 11 | 所有女生 | `sex == 0` |
 *
 * ★ 最后两条**顺带钉死了 `sex` 字段的编码**：非 0 是男、0 是女。
 *   `@rich4/data` 的 `characters.ts` 早先按直觉把它翻成 `isFemale`
 *   并注明「原版 1 = 男，0 = 女」——这里从筛选器独立印证了一遍。
 *
 * ⚠️ 名单最多 4 人（`[0x48c380]` 只有 4 字节），超出的丢掉。
 */
export function magicTargets(criterion: number, ctx: MagicTargetContext): number[] {
  const ps = ctx.players;
  const pick = (): number[] => {
    switch (criterion) {
      case 0:
        return maxBy(ps, ctx.wealthOf, false);
      case 1:
        return maxBy(ps, ctx.landCountOf, true);
      case 2:
        return maxBy(ps, ctx.houseCountOf, true);
      case 3:
        return maxBy(ps, (i) => ps[i]?.cash ?? 0, true);
      case 4:
        return maxBy(ps, (i) => ps[i]?.moneyInBank ?? 0, true);
      case 5:
        return maxBy(ps, (i) => ps[i]?.points ?? 0, true);
      // @source test byte [+0x11], 3 / jne 跳过
      case 6:
        return allWhere(ps, (p) => (p.trafficMethod & 3) === 0);
      case 7:
        return allWhere(ps, (p) => (p.trafficMethod & 3) === 1);
      case 8:
        return allWhere(ps, (p) => (p.trafficMethod & 3) === 2);
      case 9:
        return allWhere(ps, (p) => p.godInfo !== 0);
      case 10:
        return allWhere(ps, (p) => p.isMale);
      case 11:
        return allWhere(ps, (p) => !p.isMale);
      default:
        return [];
    }
  };
  return pick().slice(0, MAX_MAGIC_TARGETS);
}

// ============================================================
//  效果转盘
// ============================================================

/** 坐牢／住院天数 @source `push 3 / call send_to_prison`（VA 0x00431e65、0x0043241e） */
export const MAGIC_CONFINE_DAYS = 3;

/**
 * 被抓去坐牢／住院时，对下令者的敌意增量。
 *
 * @source VA 0x00431e21 的移位串 `a → 4a → 3a → 6a → 96a → 90a`：
 * ```asm
 * ebx = pi ; shl 2 ; sub pi        ; 3pi
 * add ebx, ebx                     ; 6pi
 * eax = ebx ; shl ebx, 4           ; 96pi
 * sub ebx, eax                     ; ★ 90pi
 * ```
 */
export const MAGIC_HOSTILITY_FACTOR = 90;

/**
 * 向後轉的增量。
 * @source `add dl, 4 / and dl, 7`（VA 0x0040c7b8）—— 八个方向，掉头是 +4。
 */
export const REVERSE_DIRECTION_STEP = 4;
export const DIRECTION_MASK = 7;

export interface MagicNodeInfo {
  /** 节点 type 原值 */
  type: number;
  /** 是住宅还是设施 —— 两者都能加蓋/拆除/拍賣 */
  buildable: boolean;
}

export interface MagicEffectContext {
  players: readonly Player[];
  /** 牌堆各卡剩余张数，下标 = 卡片 id − 1 */
  cardAmount: readonly number[];
  tools: readonly number[];
  toolStock: readonly number[];
  priceIndex: number;
  /** 触发魔法屋的人 —— 敌意记在他头上 */
  initiator: number;
  /** 某人脚下那一格；不能加蓋/拆除/拍賣的格返回 null */
  nodeOf: (playerIndex: number) => MagicNodeInfo | null;
  /** `rand()`，只有「得一張卡片」会用 */
  nextRandom: () => number;
}

/** 效果要外层代办的事 */
export interface MagicRequest {
  player: number;
  kind:
    | 'drawFortune'
    | 'prison'
    | 'hospital'
    | 'build'
    | 'demolish'
    | 'auction';
  /** drawFortune 的张数、坐牢/住院的天数 */
  amount: number;
}

export interface MagicHostilityDelta {
  from: number;
  to: number;
  delta: number;
}

export interface MagicEffectResult {
  players: Player[];
  cardAmount: number[];
  tools: number[];
  toolStock: number[];
  hostilityDeltas: MagicHostilityDelta[];
  /** 跨子系统的动作，由 reduce 依次执行 */
  requests: MagicRequest[];
  /** 供表现层显示：谁得到了哪张卡 / 卖了多少點券 */
  log: { player: number; note: string; value: number }[];
}

/** 卡片標價 @source `byte [cardId*8 + 0x47fdef]` */
function cardPrice(cardId: number): number {
  return CARDS.find((c) => c.id === cardId)?.price ?? 0;
}
/** 道具標價 @source `byte [(toolId-1)*8 + 0x47fee7]`，与 `toolId*8 + 0x47fedf` 同址 */
function toolPrice(toolId: number): number {
  return TOOLS.find((t) => t.id === toolId)?.price ?? 0;
}

/**
 * 该玩家此刻能不能被「就地」类效果作用。
 * @source `cmp dword [player + 0x32], 0 / jne 跳过` —— 住宿/消失/坐牢/住院中免疫
 */
function localizable(p: Player): boolean {
  const b = p.blocking;
  return b.inHotel === 0 && b.disappearing === 0 && b.inPrison === 0 && b.inHospital === 0;
}

/**
 * 执行一次魔法屋。
 *
 * @param option 效果转盘的结果 0..11，对应 `MAGIC_HOUSE_OPTIONS`
 * @param targets 目标转盘筛出的名单（见 `magicTargets`）
 *
 * ⚠️ 效果**对名单里每个人逐一执行**，不是只对自己
 *   （@source VA 0x004320aa 的 `inc edi` 循环）。
 */
export function applyMagicEffect(
  option: number,
  targets: readonly number[],
  ctx: MagicEffectContext,
): MagicEffectResult {
  const players = ctx.players.map((p) => ({ ...p, cards: [...p.cards] }));
  const cardAmount = [...ctx.cardAmount];
  const tools = [...ctx.tools];
  const toolStock = [...ctx.toolStock];
  const hostilityDeltas: MagicHostilityDelta[] = [];
  const requests: MagicRequest[] = [];
  const log: MagicEffectResult['log'] = [];

  for (const who of targets) {
    const p = players[who];
    if (p === undefined || !isAlive(p)) continue;

    switch (option) {
      // ── 0 變賣所有卡片 ──
      // @source VA 0x00441f21：逐格回收手牌，牌堆张数加回去，
      //   點券按**標價全额**入账（★ 不是商店那个九折）。
      case 0: {
        let gain = 0;
        for (const id of p.cards) {
          cardAmount[id - 1] = (cardAmount[id - 1] ?? 0) + 1;
          gain += cardPrice(id);
        }
        p.cards = [];
        p.points += gain;
        log.push({ player: who, note: '變賣所有卡片', value: gain });
        break;
      }

      // ── 1 抽取命運三張 ──
      // @source `for (ebx = 0; ebx < 3; ebx++) call 0x44db81`
      case 1:
        requests.push({ player: who, kind: 'drawFortune', amount: 3 });
        break;

      // ── 2 立刻坐牢三天 ──
      case 2:
        hostilityDeltas.push({
          from: who,
          to: ctx.initiator,
          delta: ctx.priceIndex * MAGIC_HOSTILITY_FACTOR,
        });
        requests.push({ player: who, kind: 'prison', amount: MAGIC_CONFINE_DAYS });
        break;

      // ── 3 原地停留一回合 ──
      // @source `inc dh / and cl, 0x7f` —— 累加一天，顺手清掉进位到的标志位
      case 3:
        p.blocking = { ...p.blocking, stopping: (p.blocking.stopping + 1) & 0x7f };
        break;

      // ── 4 存入所有現金 ──
      // @source `[+0x20] += [+0x1c] ; [+0x1c] = 0`
      case 4: {
        const moved = p.cash;
        p.moneyInBank += moved;
        p.cash = 0;
        log.push({ player: who, note: '存入所有現金', value: moved });
        break;
      }

      // ── 5 就地加蓋房屋 ──
      // @source VA 0x00431f67 → `0x40b110(type)`：
      //   住宅（land.type == 0）且 level < 5 可建；連鎖店（type == 1）只有
      //   level == 0 时可建。**免费**，不看钱也不看归属。
      case 5: {
        if (!localizable(p)) break;
        const node = ctx.nodeOf(who);
        if (node === null || !node.buildable) break;
        requests.push({ player: who, kind: 'build', amount: 1 });
        break;
      }

      // ── 6 得一張卡片 ──
      // @source VA 0x00441e12：按**牌堆剩余张数加权**抽一张（与禮物抽道具同构）
      case 6: {
        const bag: number[] = [];
        for (let id = 1; id <= cardAmount.length; id++) {
          const n = cardAmount[id - 1] ?? 0;
          for (let k = 0; k < n; k++) bag.push(id);
        }
        if (bag.length === 0) break;
        const id = bag[ctx.nextRandom() % bag.length] ?? 0;
        if (id === 0) break;
        cardAmount[id - 1] = (cardAmount[id - 1] ?? 0) - 1;
        p.cards = [...p.cards, id];
        log.push({ player: who, note: '得一張卡片', value: id });
        break;
      }

      // ── 7 向後轉 ──
      // @source `dl = direction + 4 ; dl &= 7`
      case 7: {
        if (!localizable(p)) break;
        p.direction = (p.direction + REVERSE_DIRECTION_STEP) & DIRECTION_MASK;
        break;
      }

      // ── 8 變賣所有道具 ──
      // @source VA 0x00445b3f：★ **先把座驾折回道具栏**再一起卖
      //   （機車 → 5、汽車 → 6、工程車 → 12），然后徒步、骰子回 1。
      //   编号 ≤ 8 的还要把库存还回去。點券同样按**標價全额**入账。
      case 8: {
        const base = who * TOOL_SLOTS_PER_PLAYER;
        const refund =
          (p.trafficMethod & 3) === 1
            ? 5
            : (p.trafficMethod & 3) === 2
              ? 6
              : (p.trafficMethod & 3) === 3
                ? 12
                : 0;
        if (p.trafficMethod !== 0) {
          if (refund !== 0) tools[base + refund] = (tools[base + refund] ?? 0) + 1;
          p.trafficMethod = 0;
          // @source mov byte [player + 0x12], 1
          p.ndices = 1;
        }
        let gain = 0;
        for (let toolId = 1; toolId <= TOOLS.length; toolId++) {
          const n = tools[base + toolId] ?? 0;
          if (n === 0) continue;
          // @source cmp eax, 8 / jge 跳过库存回收
          if (toolId <= 8) toolStock[toolId] = (toolStock[toolId] ?? 0) + n;
          gain += toolPrice(toolId) * n;
          tools[base + toolId] = 0;
        }
        p.points += gain;
        log.push({ player: who, note: '變賣所有道具', value: gain });
        break;
      }

      // ── 9 就地拆除房屋 ──
      // @source VA 0x00432259 → `0x40ab4a(type, 0)`，与拆除卡、炸彈同一套
      case 9: {
        if (!localizable(p)) break;
        const node = ctx.nodeOf(who);
        if (node === null || !node.buildable) break;
        requests.push({ player: who, kind: 'demolish', amount: 1 });
        break;
      }

      // ── 10 住院檢查三天 ──
      case 10:
        hostilityDeltas.push({
          from: who,
          to: ctx.initiator,
          delta: ctx.priceIndex * MAGIC_HOSTILITY_FACTOR,
        });
        requests.push({ player: who, kind: 'hospital', amount: MAGIC_CONFINE_DAYS });
        break;

      // ── 11 拍賣當格土地 ──
      // @source VA 0x0043242b → `run_auction(player, 1)`
      case 11: {
        if (!localizable(p)) break;
        const node = ctx.nodeOf(who);
        if (node === null || !node.buildable) break;
        requests.push({ player: who, kind: 'auction', amount: 1 });
        break;
      }

      default:
        break;
    }
  }

  return { players, cardAmount, tools, toolStock, hostilityDeltas, requests, log };
}

// ============================================================
//  两个转盘怎么转
// ============================================================

export interface MagicSpin {
  /** 目标转盘的结果 0..11 */
  criterion: number;
  /** 筛出的名单 */
  targets: number[];
  /** 效果转盘的结果 0..11 */
  option: number;
  /** 名单里有没有触发者自己 —— 有的话效果被强制成「得一張卡片」 */
  hitSelf: boolean;
}

/**
 * 效果转盘的取模底数。
 *
 * ★ **是 11，不是 12**（`mov ecx, 0xb`，VA 0x0043396d），而且抽到 6
 *   还要改成 7。所以实际能转出来的只有
 *   `{0,1,2,3,4,5,7,8,9,10}` 十种 —— 第 11 条「拍賣當格土地」
 *   **在零售版里永远转不到**。
 *
 *   这不是推测：效果派发函数 `0x431caa` 全局**只有一个调用点**
 *   （0x004339c6，就是这段转盘），别无他路。它与
 *   `@rich4/data` 早先记下的另一条异常正好对上——第 11 项在
 *   `0x004757d4` 的那 16 字节不符合前十一项的字段模式。
 *   **它是留在包里没接线的内容。**
 */
export const MAGIC_OPTION_MODULUS = 11;

/**
 * 「得一張卡片」的专属位置。
 *
 * @source `mov esi, 6`（VA 0x0043395a）：目标名单里**有自己**时，
 *   效果直接定为 6，不再抽。转盘转到自己头上就送张卡——
 *   这也是 6 被从随机池里挖掉（`if (r == 6) r = 7`）的原因：
 *   它是自己人的专属奖励，不该随机砸到别人头上。
 */
export const MAGIC_OPTION_SELF_GIFT = 6;

/**
 * 转两个转盘。
 *
 * @source VA 0x0043390b：
 * ```asm
 * esi = -1
 * 再抽:
 *   criterion = rand() % 12
 *   if (select_players(criterion) 名单为空) goto 再抽      ; ★ 选不出人就重抽
 *   if (名单里有当前玩家) esi = 6
 *   if (esi == -1) { esi = rand() % 11 ; if (esi == 6) esi = 7 }
 * apply(esi)
 * ```
 *
 * ⚠️ 原版那个 `goto 再抽` **没有次数上限**。本引擎给了上限：
 *   reducer 必须是纯函数且必然终止（C-DET-4），不能把「实践中总能选出人」
 *   当成不变量。用尽次数就退回 criterion 0（財產最多，它永远选得出人）。
 */
export const MAGIC_SPIN_MAX_RETRIES = 32;

export function spinMagicHouse(
  ctx: MagicTargetContext,
  currentPlayer: number,
  nextRandom: () => number,
): MagicSpin {
  let criterion = 0;
  let targets: number[] = [];
  for (let tries = 0; tries < MAGIC_SPIN_MAX_RETRIES; tries++) {
    criterion = nextRandom() % MAGIC_TARGET_COUNT;
    targets = magicTargets(criterion, ctx);
    // @source test eax, eax / je 再抽
    if (targets.length > 0) break;
  }
  if (targets.length === 0) {
    criterion = 0;
    targets = magicTargets(0, ctx);
  }

  // @source 名单里有自己 → mov esi, 6
  const hitSelf = targets.includes(currentPlayer);
  let option = MAGIC_OPTION_SELF_GIFT;
  if (!hitSelf) {
    option = nextRandom() % MAGIC_OPTION_MODULUS;
    // @source cmp edx, 6 / jne / lea esi, [edx + 1]
    if (option === MAGIC_OPTION_SELF_GIFT) option = MAGIC_OPTION_SELF_GIFT + 1;
  }
  return { criterion, targets, option, hitSelf };
}
