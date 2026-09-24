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
import { addPoints } from '../rules/points.ts';
// ★ 變賣类效果与破产清算、財神/死神共用**同一段**机器码（`0x445b3f` / `0x441f21`），
//   故这里直接调那两个已验证的纯函数，不再各抄一份 —— 抄一份就会各自漂移。
//   通道 2 证据：`rich4-spec/tests/test_sell_all.py`（35/35）。
import { sellAllCards, sellAllTools } from '../rules/inventory.ts';
import type { MapNode } from '../loaders/map.ts';
import { pickTurnBackNode } from '../cards/turn-and-house.ts';

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
 * ⚠️ **「并列全算」是对原版未定义行为的有意收敛，不是「原版如此」** ——
 *   原版那个「最大值槽」的**初值来自 `0x431842` 的第二个实参**，而该函数的
 *   **两个调用点都只压 1 个实参**（`0x432737` / `0x433923`：`push eax` +
 *   `add esp,4`）⇒ 原版读到的是**未初始化栈内容** ⇒ 并列时到底「全算」还是
 *   「只留最后一个」**在原版里不确定**。
 *   本引擎固定 `best = 0`（初值确定），于是并列**必定全算**。
 *   已登记 `docs/known-deviations.md` 的 **D-LEGACY-3**（与 D-LEGACY-1/2 同族）；
 *   取证见 `docs/gaps/README.md` §7.123 / §7.124。
 *   ★ **无并列（唯一最大）时行为完全确定**，与本实现逐位一致。
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
  /**
   * 地图节点表（下标 = 节点号 − 1），「向後轉」重挑来路用（`0x40c78c` 的 0x40c7c4..0x40c859）。
   * 缺省时只掉头、不重挑来路（老用例兼容）—— **引擎里的调用点一律要给**，否则掉头不生效。
   */
  nodes?: readonly MapNode[];
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

/**
 * 该玩家此刻能不能被「就地」类效果作用。
 * @source `cmp dword [player + 0x32], 0 / jne 跳过` —— 住宿/消失/坐牢/住院中免疫
 */
export function localizable(p: Player): boolean {
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
      // @source VA 0x00441f21：逐格回收手牌（15 个槽全清零），牌堆张数加回去，
      //   點券按**標價全额**入账（★ 不是商店那个九折）。
      case 0: {
        const sold = sellAllCards(p, cardAmount);
        cardAmount.splice(0, cardAmount.length, ...sold.cardAmount);
        p.cards = [];
        p.points = addPoints(p.points, sold.points); // ★ 16 位回绕
        log.push({ player: who, note: '變賣所有卡片', value: sold.points });
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
      // @source 0x00432160 闸 `[player+0x32]` → 0x00432174 `0x41906a(1)` → 訊息框 1500 ms（0x004321c1）
      //   → ★ 0x004321d0 `call 0x40c78c(当前玩家)` —— 与轉向卡（0x00443025）**同一个函数**：
      //   0x0040c79a 放音效 `[0x4823f2]` = 56；0x0040c7b8 `add dl,4 / and dl,7` 掉头；
      //   0x0040c7c4..0x0040c859 **重挑来路**（候选 = 邻接非 0、未封路、≠ 旧来路，有候选才 `rand()`）
      //   → 0x004321de `0x41d476(0,0,1)` 重画 → 0x004321e6 空等 500 ms。
      // ★★ 第 24 份试玩回报（「财产最多的人向后转没生效」）：先前这里**只改朝向**、没重挑来路 ——
      //   而走子只看 `lastNodeId`（`pickNextNode` 避开来路），于是被点到的人下一趟照原方向走。
      case 7: {
        if (!localizable(p)) break;
        p.direction = (p.direction + REVERSE_DIRECTION_STEP) & DIRECTION_MASK;
        if (ctx.nodes !== undefined) {
          const node = ctx.nodes[p.nodeId - 1];
          p.lastNodeId = node === undefined ? 0 : pickTurnBackNode(node, p.lastNodeId, ctx.nextRandom);
        }
        break;
      }

      // ── 8 變賣所有道具 ──
      // @source VA 0x00445b3f：★ **先把座驾折回道具栏**再一起卖
      //   （機車 → 5、汽車 → 6、工程車 → 12），然后徒步、骰子回 1。
      //   编号 ≤ 8 的还要把库存还回去，13 个槽全清零。點券按**標價全额**入账。
      case 8: {
        const sold = sellAllTools(p, tools, toolStock);
        tools.splice(0, tools.length, ...sold.tools);
        toolStock.splice(0, toolStock.length, ...sold.toolStock);
        p.trafficMethod = sold.player.trafficMethod;
        p.ndices = sold.player.ndices;
        p.points = addPoints(p.points, sold.points); // ★ 16 位回绕
        log.push({ player: who, note: '變賣所有道具', value: sold.points });
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
 *   ★★ 2026-09-23 订正（第十二份试玩回报）：上面那句只对**电脑那一支**成立。
 *   效果派发 `0x431caa` 确实只有一个调用点（0x004339c6），但**真人**走到那里时
 *   `esi` 不是 `rand() % 11`，而是**女巫窗口的返回值**（玩家点的那一格 − 1）：
 *   ```asm
 *   0043381b  cmp  byte [player + 0x15], 1     ; who_plays == 1（真人）
 *   00433822  jne  0x43390b                    ; 否则走本常量所在的随机支
 *   004338af  call 0x4018e7(0x4325c2)           ; ★ 女巫窗口（玩家点选）
 *   004338b7  mov  esi, eax                    ; ★ 效果号 = 窗口返回值
 *   00433906  jmp  0x4339c5                    ; → push esi / call 0x431caa
 *   ```
 *   ⇒ 真人可以点到**全部 12 项**（含 11「拍賣當格土地」与 6「得一張卡片」），
 *   见 `MAGIC_EFFECT_COUNT` 与 `rich4-spec/docs/systems/magic-house.md` §3.1(a)/§5.1。
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
 * 效果派发接受的效果号个数 —— 0..11。
 *
 * @source `0x004320cf cmp esi, 0xb / ja 跳过`（`0x431caa` 的逐人循环里）+
 *   跳表 `0x431c7a` 12 项。真人在女巫窗口里点的是 1..12 格，返回 `格号 − 1`
 *   （`0x00432a74 mov al,[0x48c3a1] / dec eax / call 0x401966`）。
 */
export const MAGIC_EFFECT_COUNT = 12;

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

/** 目标转盘的结果 */
export interface MagicCriterionRoll {
  criterion: number;
  targets: number[];
}

/**
 * **目标转盘**：`rand() % 12`，选不出人就重抽。
 *
 * ★ 电脑与真人**共用这一段**，只是地点不同：电脑在 `0x0043390b` 当场抽；
 *   真人在女巫窗口的状态 4 抽（`loc_00432719`：`rand() % 12` → `0x431842` →
 *   `test eax,eax / je loc_00432719` 再抽）—— 两处都是同一个 `rand` 流、同一个判据。
 */
export function rollMagicCriterion(
  ctx: MagicTargetContext,
  nextRandom: () => number,
): MagicCriterionRoll {
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
  return { criterion, targets };
}

/**
 * **效果转盘**（电脑那一支，`0x00433934..0x0043397e`）：名单里有自己 → 6；
 * 否则 `rand() % 11`，抽到 6 改 7。
 *
 * ⚠️ 真人**不走**这里 —— 他的效果号是自己在窗口里点的（见 `MAGIC_OPTION_MODULUS`
 *   的订正）。只有「真人被託管、由电脑替他答」时才借用这一支（`reduce.ts`）。
 */
export function rollMagicOption(
  targets: readonly number[],
  currentPlayer: number,
  nextRandom: () => number,
): { option: number; hitSelf: boolean } {
  // @source 名单里有自己 → mov esi, 6
  const hitSelf = targets.includes(currentPlayer);
  let option = MAGIC_OPTION_SELF_GIFT;
  if (!hitSelf) {
    option = nextRandom() % MAGIC_OPTION_MODULUS;
    // @source cmp edx, 6 / jne / lea esi, [edx + 1]
    if (option === MAGIC_OPTION_SELF_GIFT) option = MAGIC_OPTION_SELF_GIFT + 1;
  }
  return { option, hitSelf };
}

/** 电脑那一支：两个转盘连着转（`0x0043390b..0x0043397e`）*/
export function spinMagicHouse(
  ctx: MagicTargetContext,
  currentPlayer: number,
  nextRandom: () => number,
): MagicSpin {
  const { criterion, targets } = rollMagicCriterion(ctx, nextRandom);
  const { option, hitSelf } = rollMagicOption(targets, currentPlayer, nextRandom);
  return { criterion, targets, option, hitSelf };
}
