/*
 * 四大惡人的走子循环
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 把 `rules/npc-actions.ts` 里那些**纯规则**接到棋盘上：一步一步走，
 *   每落一格查一次该做什么，直到步数走完、或他自己被送回監獄/醫院。
 *
 * ★ **为什么整段同步跑完**：原版把 `[0x49910c]` 切成 4..7，
 *   走完再切回玩家（機器娃娃那条同理，见 `runDoll`）。
 *   这期间没有任何玩家输入，所以对 core 来说它就是**一个动作**，
 *   不需要拆成待决交互。动画分帧是表现层的事（C-ARC-2）。
 *
 * ★ 落点行为**已全部实现**（2026-09-16 订正）：間諜的「取過路費」与「取盈餘」
 *   都在本文件里 —— 见 `spyTollAt`（读上一笔过路费）与取盈餘那一段
 *   （企業 `+0x28`，可为负、反向转账）；测试见 `facility-rules.test.ts` 与
 *   `company.test.ts`。先前这里写着「没做的两条」，是过期注释。
 */

import type { GameState, Player } from '../state/types.ts';
import type { FacilityInfo, LandInfo, MapNode } from '../loaders/map.ts';
import type { WatcomRng } from '../rng/watcom.ts';
import { isAlive } from '../state/types.ts';
import { addPoints } from './points.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { PAY_FLAG_CREDIT_TO_CASH, PAY_FLAG_DEBIT_FROM_BANK, transferMoney, type PendingCredit } from './payment.ts';
import { emptyOwnership, ownerOf } from '../places/commercial.ts';
import { OBJECT_TYPE_DOG } from '../cards/summon.ts';
import { companyParty } from './payment.ts';
import {
  OBJECT_TYPE_GIFT,
  OBJECT_TYPE_MINE,
  OBJECT_TYPE_ROADBLOCK,
  OBJECT_TYPE_TREASURE,
  OBJECT_TO_TOOL,
  TREASURE_POINTS,
  drawGiftTool,
  giftToolBagEmpty,
} from './object-landing.ts';
import { giveTool } from './tools.ts';
import { giveCard } from '../cards/rob.ts';
import { conserveCardPool, toolPrice } from './inventory.ts';
import { goodNewsSpeechDrawsRand, SPEECH_SITE, speechDraw } from './speech-rand.ts';
import {
  ACTOR_PLACE,
  idleActor,
  type SpecialActor,
} from './special-actors.ts';
import {
  NPC,
  NPC_HOME,
  NPC_HOME_LEFT,
  bankRobbery,
  npcHomeOf,
  pickCardToSteal,
  facilityProtectionFee,
  protectionFee,
  stealPoints,
  stealsCard,
  stealsPoints,
  thiefTakes,
} from './npc-actions.ts';

/**
 * 走子需要的地图静态数据。
 *
 * ★ 故意**不用** `MapTopology` —— 那个类型定义在 `state/reduce.ts` 里，
 *   而 reduce 要 import 本模块，直接引会绕成环。这里只列真正用得上的三样。
 */
export interface NpcMap {
  nodes: readonly MapNode[];
  lands?: readonly LandInfo[];
  facilities?: readonly FacilityInfo[];
}

/** 走一趟之后要落回状态的东西 */
export interface NpcWalk {
  actor: SpecialActor;
  /** 走过的节点，含起点 */
  path: number[];
  /** 这趟产生的每一笔动作，按发生顺序 —— 供 UI 播报与测试断言 */
  events: NpcEvent[];
  /**
   * `events` 里**还没落盘**的那一截 —— 给了 `settle` 时，付款那几笔（以及它们之前的事件）
   * 已经在付款那一刻应用过了，调用方走完这一趟只能再应用这一截（见 `runNpc` 的 `settle`）。
   * 没给 `settle` 时就是整个 `events`。
   */
  unapplied: NpcEvent[];
}

export type NpcEvent =
  /**
   * 小偷拿走一件东西。`tool` 是进主人道具栏的编号（0 = 不进道具栏）：
   * - 禮物(13) → `drawGiftTool` 抽一件（1..8，按库存加权）
   * - 寶箱(14) → 0，改为给主人 **500 點券**
   * - 路障(16)/地雷(17)/定時炸彈(18) → **原样回收**成道具 2/3/4
   */
  | { kind: 'loot'; node: number; object: number; objectType: number; tool: number }
  | { kind: 'points'; victim: number; amount: number }
  | { kind: 'card'; victim: number; card: number }
  | { kind: 'robBank'; from: number; amount: number }
  /**
   * 強盜搶完银行之后那一扇框「強盜搶奪銀行\n\n得款%d元\n\n給%s！」—— 纯表现，不动状态。
   * @source 0x0041c3ad 起：循环（`0x0041c34f`..`0x0041c3ab`，`edi += 每笔`）走完**无条件**弹框（`0x0041c415`），
   *   得款 = `edi`（各笔之和，可以是 0）。
   */
  | { kind: 'robBankDone'; total: number }
  | { kind: 'protection'; landlord: number; amount: number }
  /** 間諜取走過路費 —— 与 protection 同一入账口（`push 0` → 進存款） */
  | { kind: 'toll'; landlord: number; amount: number }
  /**
   * 間諜取走上市企業的累積盈餘：`amount` 有符号，负数 = 主人替企業主掏钱。
   * 取完**不清**公司盈餘（那段没有写回），照抄。
   */
  | { kind: 'surplus'; landlord: number; amount: number; company: number }
  /**
   * ★ 非小偷的三个惡人（5..7）**踩到陷阱** —— 原版他们走的是「玩家那一支」。
   *
   * @source 路障 `0x41bceb` / 地雷 `0x41be5f` 的玩家分支：
   *   两条开头都是 `cmp [0x49910c], 8 / jge 另一支` + `cmp …, 4 / je 另一支`，
   *   所以 actor 5..7 落到玩家分支：
   *   · **路障**：`cmp eax,4 / je` 只排掉小偷，5..7 照样 `remove_object(槽号)` +
   *     `[0x48baf8] = 0`（★ 不看剩余步数 ⇒ **半途也拦**），这趟就此收场；
   *   · **地雷**：先 `cmp [0x48baf8], 0 / jne` ⇒ **必须停在这一格才炸**，
   *     然后 `remove_object` + `0x43ec3f(actor, 3)`（住院 3 天）、这趟收场；
   *   · 两者都**不**毁座驾（`cmp ecx,4 / jge` 跳过）也**不**说台词（`cmp ebp,4 / jge`）。
   *
   *   陷阱都走 `remove_object` ⇒ 原样回**商店库存**（道具 2/3），**不进任何人**的道具栏。
   */
  | { kind: 'trap'; node: number; object: number; objectType: number; hospital: boolean }
  | { kind: 'home'; place: 'prison' | 'hospital'; node: number }
  /**
   * ★★ 2026-09-24（provenance 审计）：惡人（4..7，含小偷）停在惡犬那一格 —— 狗走（`0x40e14d`，土地公登场要 rand）、
   *   惡人进醫院 3 天（`0x43ec3f` NPC 支）。物件释放与搭档登场由调用方做（要整局状态与随机流）。
   */
  | { kind: 'dog'; node: number; object: number };

/**
 * 走子里的**付款落盘口** —— 由调用方给（`state/reduce.ts` 的 `settleWalkBatch`）。
 *
 * ★ 为什么必须存在：原版 `pay_money` 在**扣款与入账之间**就把付不出钱的人破产掉
 *   （VA 0x0041d375 `call 0x40cd87`，见 `state/reduce.ts` 的 `payInWalk`），
 *   而破产清算自己要掷 `rand()`（`release_object` 的搭档挑格、下線拍卖的挑 3 处）。
 *   不在这里落盘，破产就会拖到整趟走完，那几掷便排到了**后面几步**的随机数之后，
 *   而且后面几步还会看到一个**本该已经出局**的人（`0x0041c35a` / `0x0041c1d6`
 *   两处 `cmp byte [player+0x15], 0`）。
 *
 * ★ 第二个参数是本趟**此刻**的随机流：原版只有一条流，破产清算那几掷就接在
 *   走子掷出的数后面。落盘口返回的状态里的 `rngState` 会被写回本趟的 `rng`，
 *   后面的步子接着它往下掷（漏了这一步，破产清算会从**这一趟开头**的流重掷）。
 */
export type NpcSettle = (events: readonly NpcEvent[], rngState: number) => GameState;

/**
 * 走一趟。
 *
 * `advance` 由调用方给（`reduce.ts` 的 `pickNextNode`），与機器娃娃同理 ——
 * 本模块因此不依赖地图拓扑的具体形状。
 *
 * ★ **只算这趟走出去的每一格**，起点那一格不结算（他就是从那儿起步的）。
 *
 * ★ `settle` 给了就在**每一笔付款的那一刻**把「已产出但还没落盘的事件」交回去
 *   （见 `NpcSettle`）；返回的 `NpcWalk.unapplied` 是**还没落盘的那一截**，
 *   调用方走完这一趟之后再 `applyNpcEvents`。不给 `settle` 时 `unapplied` 就是全部事件
 *   （旧行为，单测里直接调 `runNpc` 的那些用例照旧）。
 */
export function runNpc(
  actor: number,
  start: SpecialActor,
  state: GameState,
  map: NpcMap,
  advance: (from: number, prev: number) => number,
  rng: WatcomRng,
  settle?: NpcSettle,
): NpcWalk {
  const nodes = map.nodes;
  const owner = start.owner;
  const events: NpcEvent[] = [];
  const path: number[] = [start.nodeId];

  /** 这一趟里**已经交给 `settle` 落盘**的事件条数（`events` 的前缀） */
  let settled = 0;
  /**
   * 付款那一刻落盘 —— 破产清算的随机数因此排在后面几步之前。
   *
   * ★ 落盘之后本函数的几处影子记账要一起复位：那些「已经产出但还没应用」的
   *   差额现在都在状态里了（被偷走的牌 / 點券、被拿走的物件、道具与库存）。
   */
  const settleNow = (): void => {
    if (settle === undefined || settled === events.length) return;
    live = settle(events.slice(settled), rng.getState());
    settled = events.length;
    // ★ 破产清算掷过的那几掷要接回本趟的流 —— 否则后面的步子会从这一趟开头的流重掷
    rng.setState(live.rngState);
    takenObjects.clear();
    pointsTaken.clear();
    cardsTaken.length = 0;
    tools = live.tools;
    stock = live.toolStock;
  };

  let cur = start.nodeId;
  let prev = start.lastNodeId;
  /** 当前状态 —— 付款落盘之后就是落定后的那一份（后面几步读的是它） */
  let live: GameState = state;
  // ★★ 2026-09-24（provenance 审计）：「回老家」看的是替身记录 **+11**（`home`），不是 actor 号 ——
  //   `0x0041c7b1 mov cl,[+0x0b] / and cl,0x7f / cmp cl,1`（監獄）/ `cmp cl,2`（醫院），
  //   这一字节只在保釋放人时写（`0x0043d84e` = 1、`0x0043eefd` = 2，门口那一格是監獄/醫院落点格才 |0x80）。
  //   ⇒ 从醫院保出来的強盜回的是**醫院**。老存档 / 老状态没有这一项：按 actor 号 + 已离开 兜底（旧行为）。
  let home = start.home ?? (npcHomeOf(actor) | NPC_HOME_LEFT);
  // ★★ 夢遊中的惡人（+13）：小偷不捡东西、惡人段（偷 / 搶 / 勒索 / 取款）整段跳过，只查老家
  //   @source 小偷五支 `cmp byte [+0x498df5],0 / jne 0x41c164`（0x0041b9a9 等）；尾段 `0x0041c187` 同一判据
  const sleepwalking = (start.sleepwalkDays ?? 0) !== 0;

  // 这趟里被拿走的物件下标 / 被偷的玩家，交给调用方落状态
  const takenObjects = new Set<number>();
  const pointsTaken = new Map<number, number>();
  const cardsTaken: { victim: number; card: number }[] = [];
  // 走这一趟时的道具表 / 库存（禮物抽签读的是**当时**的库存 —— 前一步拆回来的陷阱要算进去）
  let tools: readonly number[] = state.tools;
  let stock: readonly number[] = state.toolStock;

  const board = (): SpecialActor => ({
    ...start,
    nodeId: cur,
    lastNodeId: prev,
    stepsRemaining: 0,
    place: ACTOR_PLACE.board,
    home,
  });

  for (let step = 0; step < start.stepsRemaining; step++) {
    const next = advance(cur, prev);
    if (next <= 0 || next === cur) break;
    prev = cur;
    cur = next;
    path.push(cur);

    const node = nodes[cur - 1];
    const kind = node?.specialKind ?? 0;
    // `[0x48baf8] == 0` ⇔ 这一步是停下来的那一步（最后一步，或被路障拦下）
    let stopped = step === start.stepsRemaining - 1;
    /** 这一步之后这趟就结束（路障 / 地雷 / 惡犬 / 回老家） */
    let ends = false;
    /** 被送进醫院（地雷 / 惡犬）：`0x43ec3f` 的 NPC 支把 +10..+15 清掉 ⇒ 尾段整段跳过、+11 也没了 */
    let hospitalized = false;

    // ── ① 格子上的物件（跳表 0x41b3e5，按物件种类分派）──
    const at = live.objects.findIndex(
      (o, i) => o.nodeId === cur && o.attached === 0 && !takenObjects.has(i),
    );
    if (at !== -1) {
      const type = live.objects[at]!.type;
      if (actor === NPC.thief && thiefTakes(type)) {
        // @source 禮物 0x0041b995 / 寶箱 0x0041bb9d / 路障 0x0041bd65 / 地雷 0x0041bf16 / 炸彈 0x0041c072：
        //   `cmp [0x49910c],4 / jne` + `cmp byte [+0x498df5],0 / jne`（夢遊不拿），**每一步**都拿
        if (!sleepwalking) {
          takenObjects.add(at);
          const tool = lootTool(type, stock, rng);
          events.push({ kind: 'loot', node: cur, object: at, objectType: type, tool });
          // 同一趟后面的禮物抽签要看到这一次的库存变化（陷阱先回库存再发，见 `applyNpcEvents`）
          const trapTool = OBJECT_TO_TOOL.get(type);
          if (trapTool !== undefined) {
            const back = [...stock];
            back[trapTool] = (back[trapTool] ?? 0) + 1;
            stock = back;
          }
          if (tool > 0) {
            const r = giveTool(tools, stock, owner, tool);
            tools = r.tools;
            stock = r.stock;
            // ★★ 2026-09-25（cards 审计 cross-area (b)）：禮物那一支抽到东西后主人说一句
            //   `0x0041bafa call 0x44f230(主人, 道具價 [id*8+0x47fedf])` —— 价 50 < p ≤ 100 时掷一次 `rand()&1`
            //   （`0x0044f262 cmp edx,0x32 / jle` → `0x0044f280 call 0x456f2d`）。台词归表现层，随机数是规则态。
            if (type === OBJECT_TYPE_GIFT) {
              const price = toolPrice(tool);
              if (goodNewsSpeechDrawsRand(price)) speechDraw(rng, SPEECH_SITE.smallGain, owner);
            }
          }
        }
      } else if (actor !== NPC.thief && type === OBJECT_TYPE_ROADBLOCK) {
        // @source 0x0041bceb 玩家支：`remove_object` + `[0x48baf8] = 0`（半途也拦）→
        //   `0x0041bd3c cmp ebx,4 / jge 0x41c164` ⇒ **尾段照跑**（这一格算停下来的那一格）
        takenObjects.add(at);
        events.push({ kind: 'trap', node: cur, object: at, objectType: type, hospital: false });
        stopped = true;
        ends = true;
      } else if (actor !== NPC.thief && type === OBJECT_TYPE_MINE && stopped) {
        // @source 0x0041be5f：停在这一格才炸 → `remove_object` + `0x43ec3f(actor, 3)`
        takenObjects.add(at);
        events.push({ kind: 'trap', node: cur, object: at, objectType: type, hospital: true });
        ends = true;
        hospitalized = true;
      } else if (type === OBJECT_TYPE_DOG && stopped) {
        // ★★ 2026-09-24（provenance 审计）：惡犬也咬惡人（含小偷）——
        //   `0x0041b837 cmp [0x48baf8],0 / jne` → `0x0041b845 push 0xb / call 0x40e14d`（狗走、土地公登场）→
        //   `0x0041b855 cmp ebp,4 / jge 0x41b8a7`（惡人不说台词）→ `0x0041b8e0 [0x48baf8]=0` →
        //   `0x0041b8ef call 0x43ec3f(actor, 3)`。先前惡人走过惡犬什么都不发生。
        takenObjects.add(at);
        events.push({ kind: 'dog', node: cur, object: at });
        ends = true;
        hospitalized = true;
      }
    }

    // ── ② 尾段 0x41c164：`+10 != 0`（已被送走）或夢遊 ⇒ 直接跳到查老家 ──
    if (!hospitalized && !sleepwalking) {
      // ②a 同格有人 → 偷點券（小偷）/ 奪卡（強盜）—— 流氓 / 間諜**不偷**
      //   @source 0x0041c194 `cmp ebp,4 / je` · 0x0041c199 `cmp ebp,5 / jne 0x41c447`
      if (actor === NPC.thief || actor === NPC.robber) {
        const victim = victimAt(live, cur, owner);
        if (victim !== null) {
          if (stealsPoints(actor)) {
            const have = (live.players[victim]?.points ?? 0) - (pointsTaken.get(victim) ?? 0);
            const amount = stealPoints(have);
            // @source `test edi, edi / je 结束` —— 偷不到就什么也不发生
            if (amount > 0) {
              pointsTaken.set(victim, (pointsTaken.get(victim) ?? 0) + amount);
              events.push({ kind: 'points', victim, amount });
            }
          } else if (stealsCard(actor)) {
            // 前面这一趟已经从他手里拿走的，**每次只少一张**（`0x441343` 挪掉的是一个槽）
            const hand = [...(live.players[victim]?.cards ?? [])];
            for (const t of cardsTaken) {
              if (t.victim !== victim) continue;
              const k = hand.indexOf(t.card);
              if (k >= 0) hand.splice(k, 1);
            }
            const card = pickCardToSteal(hand, rng);
            if (card !== null) {
              cardsTaken.push({ victim, card });
              events.push({ kind: 'card', victim, card });
            }
          }
        }
      }

      // ②b 強盜踩銀行 → 抢所有对手的存款（每一步都抢，不看停没停）
      // @source 0x0041c330 `cmp [0x49910c], 5` + `cmp 格子, 0xe`
      if (actor === NPC.robber && kind === SPECIAL_KIND.BANK) {
        let total = 0;
        // ★★ 2026-09-24（provenance 审计）：逐人 `pay_money`（`0x0041c39b`），
        //   **每付一笔就落盘** —— 被抢破产的那位在 `pay_money` 里面就出局了（`0x0041d375`），
        //   破产清算的随机数也排在后面几步之前。金额表照原版一次算好：
        //   `0x41c377` 读的是**他自己**那一轮的存款，而付款只动付款方自己的口袋。
        for (const r of bankRobbery(live.players, owner, isAlive)) {
          events.push({ kind: 'robBank', from: r.from, amount: r.amount });
          total += r.amount;
          settleNow();
        }
        events.push({ kind: 'robBankDone', total });
      }

      // ②c 流氓 / 間諜：**只在停下来的那一格**做（`0x0041c447 cmp [0x48baf8],0 / jne 0x41c7a6`）
      //   ★★ 2026-09-24（provenance 审计）：先前每一步都勒索 / 取款。
      if (stopped && actor === NPC.thug && node !== undefined) {
        // @source 地產 0x0041c4df、設施 0x0041c64e
        const fee = thugFeeAt(live, map, node);
        if (fee !== null && fee.landlord !== owner && fee.amount > 0) {
          events.push({ kind: 'protection', landlord: fee.landlord, amount: fee.amount });
          // @source 0x0041c576 `call 0x41d2c6` —— 勒索款付不出照样当场破产
          settleNow();
        }
      }
      if (stopped && actor === NPC.spy && node !== undefined) {
        // @source 地產 0x0041c597 `edi = [land + 0x2c]`；設施 0x0041c6bd `edi = [設施 + 0x30]`（取完不清零）
        const t = spyTollAt(live, node);
        if (t !== null && t.landlord !== owner && t.amount > 0) {
          events.push({ kind: 'toll', landlord: t.landlord, amount: t.amount });
          // @source 0x0041c64e 那一支的 `call 0x41d2c6` 同理
          settleNow();
        }
        // @source 0x0041c6e6..0x0041c79e：企業有主（+0x18）、主人不是保釋人、盈餘 +0x28 ≠ 0 ⇒
        //   `pay_money(100 + 企業, 保釋人, 盈餘, 0)` —— ★ **企業自己**付（+0x28 / +0x2c 各减），不是企業主付
        if (node.ref.kind === 'commercial') {
          const cid = node.ref.index;
          const chairman = ownerOf(live.commercialOwners[cid] ?? emptyOwnership());
          const surplus = live.companyFunds[cid] ?? 0;
          if (chairman >= 0 && chairman !== owner && surplus !== 0) {
            events.push({ kind: 'surplus', landlord: chairman, amount: surplus, company: cid });
          }
        }
      }
    }

    // ── ③ 查老家（0x0041c7a6，尾段最后一块；送进醫院的 +11 已清 ⇒ 不回）──
    //   ★★ 2026-09-24（provenance 审计）：先前放在最前面（踩到老家就不偷不抢），且**第一次**踩到就回去。
    //   原版：+11 低 7 位 = 1 且这一格是監獄落点（4）/ = 2 且是醫院落点（5）时 ——
    //   bit7 已置 ⇒ `send_to_*(actor, 0)` 回去；没置 ⇒ **只把 bit7 置上**（`0x0041c7e9` / `0x0041c839`），
    //   下一次再踩到才回去（保釋门口是關押格、不是落点格时，第一次路过不回）。
    if (!hospitalized) {
      const low = home & 0x7f;
      const atHome = (low === NPC_HOME.prison && kind === 4) || (low === NPC_HOME.hospital && kind === 5);
      if (atHome) {
        if ((home & NPC_HOME_LEFT) !== 0) {
          const place = low === NPC_HOME.prison ? 'prison' : 'hospital';
          events.push({ kind: 'home', place, node: cur });
          return {
            actor: {
              ...idleActor(),
              owner,
              place: place === 'prison' ? ACTOR_PLACE.prison : ACTOR_PLACE.hospital,
            },
            path,
            events,
            unapplied: events.slice(settled),
          };
        }
        home |= NPC_HOME_LEFT;
      }
    }

    if (hospitalized) {
      return {
        actor: { ...idleActor(), owner, place: ACTOR_PLACE.hospital },
        path,
        events,
        unapplied: events.slice(settled),
      };
    }
    if (ends) return { actor: board(), path, events, unapplied: events.slice(settled) };
  }

  // ★ 走完**留在原地** —— 下一名行动者的选择（0x00418f93）每輪都会轮到棋盘上（+10 == 0）的惡人，
  //   他下一輪从这儿接着走；只有踩到老家（上面 ③）才回去。
  return { actor: board(), path, events, unapplied: events.slice(settled) };
}

/**
 * 惡人这一格偷谁 —— **节点占用位**里（被关 / 住店 / 消失的人那一位是清掉的）**下标最小**且不是保釋人的那一位；
 * 那一位已出局（乞丐）⇒ **谁都不偷**（不往下找）。
 *
 * @source `0x0041c1b9 and edi, ~(1 << 主人)` → `0x0041c1c9 call 0x40d293`（最低位）→
 *   `0x0041c1d6 cmp byte [victim+0x15],0 / je 0x41c330`。占用位：`runtimeOccupiedNodes` 同一口径
 *   （`0x0043d61d` / `0x0040d444` / `0x0040d5d2` 清位）。
 */
function victimAt(state: GameState, node: number, owner: number): number | null {
  for (let i = 0; i < state.players.length; i++) {
    if (i === owner) continue;
    const p = state.players[i]!;
    if (p.nodeId !== node) continue;
    const b = p.blocking;
    if (b.inPrison !== 0 || b.inHospital !== 0 || b.inHotel !== 0 || b.disappearing !== 0) continue;
    return isAlive(p) ? i : null;
  }
  return null;
}

/**
 * 流氓在这一格能勒索多少、勒索谁；勒索不到返回 `null`。
 *
 * ★ 地產与設施**算法不同**：地產把地主在**整片同名地区**的地價全加起来，
 *   設施只按那一处算。见 `npc-actions.ts` 的 `protectionFee`。
 */
export function thugFeeAt(
  state: GameState,
  map: NpcMap,
  node: MapNode,
): { landlord: number; amount: number } | null {
  const ref = node.ref;
  if (ref.kind === 'land') {
    const lands = map.lands;
    if (lands === undefined) return null;
    const here = lands.find((l) => l.id === ref.index);
    if (here === undefined) return null;
    // 归属取**实时**的 landOwner（1 基，0 = 无主），不是地图模板里的
    const ownerOf = (id: number): number => state.landOwner[id] ?? 0;
    const landlord = ownerOf(here.id);
    if (landlord === 0) return null;
    const amount = protectionFee(lands, ownerOf, here, state.priceIndex);
    return { landlord: landlord - 1, amount };
  }
  if (ref.kind === 'facility') {
    const f = map.facilities?.find((x) => x.id === ref.index);
    if (f === undefined) return null;
    // 归属取**实时**的 facilityOwner，静态表里恒为 0
    const owner = state.facilityOwner[f.id] ?? 0;
    if (owner === 0) return null;
    return { landlord: owner - 1, amount: facilityProtectionFee(f.landPrice, state.priceIndex) };
  }
  return null;
}

/**
 * 間諜在这一格能取走多少、从谁那儿取；取不到返回 `null`。
 * 地產读 `landLastToll`，設施读 `facilityLastToll`；无主或没收过租的取不到。
 */
export function spyTollAt(
  state: GameState,
  node: MapNode,
): { landlord: number; amount: number } | null {
  const ref = node.ref;
  if (ref.kind === 'land') {
    const landlord = state.landOwner[ref.index] ?? 0;
    if (landlord === 0) return null;
    return { landlord: landlord - 1, amount: state.landLastToll[ref.index] ?? 0 };
  }
  if (ref.kind === 'facility') {
    const landlord = state.facilityOwner[ref.index] ?? 0;
    if (landlord === 0) return null;
    return { landlord: landlord - 1, amount: state.facilityLastToll[ref.index] ?? 0 };
  }
  return null;
}

/**
 * 把一趟走子的结果落进状态。
 *
 * ★ **进项一律记到主人头上**（`pay_money(受害者, 主人, …)`，见 `npc-actions.ts`）。
 *   钱走 `transferMoney`，所以**付款方可能因此破產** —— 由调用方收口
 *   （与过路费同一条路，见 `reduce.ts`）。
 */
export interface NpcSettlement {
  state: GameState;
  /** 这趟里被榨破产的玩家下标，按发生顺序；调用方要逐个走破产流程 */
  bankrupted: number[];
  /**
   * ★ PAY-05：付款人破产时**还没入账**的那几笔（收款人 = 惡人的主人，是玩家）。
   *   原版 `pay_money` 的 `0x0041d376 call 0x40cd87`（清算 + 拍卖，阻塞）在收款分支之前 ——
   *   调用方要把这几笔排到清算拍卖之后。
   */
  credits: PendingCredit[];
}

export function applyNpcEvents(
  state: GameState,
  owner: number,
  events: readonly NpcEvent[],
): NpcSettlement {
  let players = [...state.players];
  let objects = state.objects;
  let pool = state.pool;
  let tools = state.tools;
  let toolStock = state.toolStock;
  let companyFunds = state.companyFunds;
  let companyProfit = state.companyProfit;
  const bankrupted: number[] = [];
  const credits: PendingCredit[] = [];

  const give = (i: number, mut: (p: Player) => Player): void => {
    const p = players[i];
    if (p !== undefined) players[i] = mut(p);
  };

  for (const e of events) {
    switch (e.kind) {
      case 'loot': {
        objects = objects.map((o, i) =>
          i === e.object ? { ...o, nodeId: 0, state: 0, attached: 0 } : o,
        );
        if (e.objectType === OBJECT_TYPE_TREASURE) {
          // @source 0x0041bcb6 `add word [主人 + 0x30], 0x1f4` —— ★ 16 位回绕
          give(owner, (p) => ({ ...p, points: addPoints(p.points, TREASURE_POINTS) }));
          break;
        }
        // 禮物抽一件、陷阱原样回收 —— 两者都进**主人**的道具栏
        // ★★ 2026-09-24（provenance 审计）：陷阱是先 `0x40e14d` 放回（`0x0040e17a..0x0040e195` 库存 +1），
        //   再 `0x445a4d(主人, k)` 从库存里发（满 9 个 / 库存 0 就不发，那一件留在库存里）。先前少了 +1。
        const trapTool = OBJECT_TO_TOOL.get(e.objectType);
        if (trapTool !== undefined) {
          toolStock = [...toolStock];
          toolStock[trapTool] = (toolStock[trapTool] ?? 0) + 1;
        }
        const toolId = e.tool;
        if (toolId > 0) {
          const r = giveTool(tools, toolStock, owner, toolId);
          tools = r.tools;
          toolStock = r.stock;
        }
        break;
      }
      case 'trap': {
        // @source 0x40e14d —— 拆除走同一条 remove_object：陷阱**回商店库存**（道具 2/3），
        //   不进任何人的道具栏（与小偷那一支的 `give_tool(主人, k)` 差别就在这里）
        objects = objects.map((o, i) =>
          i === e.object ? { ...o, nodeId: 0, state: 0, attached: 0 } : o,
        );
        const toolId = OBJECT_TO_TOOL.get(e.objectType);
        if (toolId !== undefined) {
          toolStock = [...toolStock];
          toolStock[toolId] = (toolStock[toolId] ?? 0) + 1;
        }
        break;
      }
      case 'points': {
        // @source 0x0041c25d `sub word [受害者 + 0x30], di` / 0x0041c27a `add word [主人 + 0x30], di`
        //   —— ★ 一减一加都是 16 位（偷點券那一对）
        give(e.victim, (p) => ({ ...p, points: addPoints(p.points, -e.amount) }));
        give(owner, (p) => ({ ...p, points: addPoints(p.points, e.amount) }));
        break;
      }
      case 'card': {
        // ★★ 2026-09-24（provenance 审计）：`0x441e77` 用 `0x441343` 从受害者手里挪掉（那张**回牌堆** +1），
        //   再 `0x4412e4` 发给主人（牌堆 −1；主人满 15 张先弃最便宜的一张回牌堆）。先前直接追加、不记牌堆。
        let removed = false;
        give(e.victim, (p) => {
          const at = p.cards.indexOf(e.card);
          if (at === -1) return p;
          removed = true;
          const cards = [...p.cards];
          cards.splice(at, 1);
          return { ...p, cards };
        });
        if (!removed) break;
        // ★ `0x0041c307 call 0x4412e4`（receive_card）：主人满 15 张先弃最便宜的一张 —— 不是硬塞第 16 张
        give(owner, (p) => giveCard(p, e.card));
        break;
      }
      case 'robBank': {
        // @source `push 5` —— bit0 置位 = **進現金**
        const r = transferMoney(players, [], pool, e.from, owner, e.amount, ROB_BANK_FLAGS);
        players = [...r.players];
        pool = r.pool;
        if (r.bankrupted) bankrupted.push(e.from);
        break;
      }
      case 'surplus': {
        // ★★ 2026-09-24（provenance 审计）：付款方是**企業本身**（`0x0041c797 sub esi,0x170c` = 100 + 企業号），
        //   `pay_money` 的企業支 `0x0041d2e6 / 0x0041d2ea` 把 +0x28 / +0x2c 各减掉盈餘（+0x28 归 0），
        //   收款方保釋人進**存款**（flags 0）。盈餘为负 ⇒ 企業两栏反而增加、保釋人存款减少（收款方不做破产判定）。
        //   先前写成「企業主付给保釋人（负数反向）」、企業账不动。
        const companies = companyFunds.map((f, i) => ({ funds: f, fundsMirror: companyProfit[i] ?? 0 }));
        const r = transferMoney(players, companies, pool, companyParty(e.company), owner, e.amount, 0);
        players = [...r.players];
        pool = r.pool;
        companyFunds = r.companies.map((c) => c.funds);
        companyProfit = r.companies.map((c) => c.fundsMirror);
        break;
      }
      case 'protection':
      case 'toll': {
        // @source `push 0` —— bit0 未置 = **進存款**（0x0041c576 / 0x0041c5xx 两处同）
        // ★ PAY-05：`deferCredit` —— 地主付到破产时，主人这一笔等他的清算拍卖打完才入账
        const r = transferMoney(players, [], pool, e.landlord, owner, e.amount, 0, true);
        players = [...r.players];
        pool = r.pool;
        if (r.bankrupted) {
          bankrupted.push(e.landlord);
          if (r.deferred) credits.push(r.credit);
        }
        break;
      }
      case 'home':
      case 'dog':
        // 占用表 / 物件释放由调用方改 —— 要同时动占用表、物件表与随机流
        break;
      case 'robBankDone':
        // 只是那一扇框（`npcNotices`），不动状态
        break;
    }
  }

  // ★ 牌堆：偷卡是 `0x441e77`（受害者 remove_card +1）+ `0x4412e4`（主人收 −1、满手弃 +1）—— 按守恒记
  const cardAmount = conserveCardPool(state.cardAmount, state.players, state.cardAmount, players);
  return {
    state: { ...state, players, objects, pool, tools, toolStock, cardAmount, companyFunds, companyProfit },
    bankrupted,
    credits,
  };
}

/**
 * 小偷拿到的这件东西折成哪个道具编号（0 = 不折）。
 *
 * ★ **拆下来的陷阱原样回收**，与 `PLACEMENT_TOOLS`（道具 → 物件种类）互逆：
 * ```asm
 * 0041be1a  push 2            ; 路障  → 道具 2
 * 0041be30  call give_tool(主人, 2)
 * 0041bfcb  push 3 / jmp 0x41be1c   ; ★ 地雷直接跳进上面那段，只换了编号
 * 0041c126  push ebx          ; 定時炸彈 → 道具 4（同一形状）
 * ```
 * 那句 `jmp 0x41be1c` 是最好的证据：三条分支共用同一段发货代码。
 *
 * - **禮物(13)** 走 `drawGiftTool`（@source 0x00445ada：按**全局库存加权**
 *   从道具 1..8 里抽一件，抽不到就当没踩过），与玩家踩禮物同一条规则。
 * - **寶箱(14)** 不给道具，改为主人 +500 點券（@source 0x0041bcb6）。
 */
function lootTool(objectType: number, toolStock: readonly number[], rng: WatcomRng): number {
  // @source 0x00445ada —— 与玩家踩禮物走同一条抽签
  // ★★ 2026-09-19 修（§7.142）：原版是 `test ebx,ebx / je 返回0` **之后**才 `call rand`
  //   ⇒ 袋子空时**一次 rand 都不掷**。先前写成 `drawGiftTool(stock, rng.next())`
  //   （实参先求值）⇒ 库存全空时多掷一次，之后所有随机事件错开一步。
  if (objectType === OBJECT_TYPE_GIFT) {
    return giftToolBagEmpty(toolStock) ? 0 : drawGiftTool(toolStock, rng.next());
  }
  return TRAP_TO_TOOL[objectType] ?? 0;
}

const TRAP_TO_TOOL: Readonly<Record<number, number>> = { 16: 2, 17: 3, 18: 4 };

/**
 * 搶銀行那笔钱**進現金**，保護費那笔**進存款**。
 *
 * ★ 差别就在 `pay_money` 的第四个参数：搶銀行是 `push 5`（VA 0x0041c38f），
 *   保護費与間諜那两条是 `push 0`（0x0041c576 / 0x0041c780）。
 *   `bit0` 就是 `PAY_FLAG_CREDIT_TO_CASH`（见 rules/payment.ts）。
 *   这不是笔误——原版两处本来就走不同的入账口。
 */
export const ROB_BANK_FLAGS = PAY_FLAG_CREDIT_TO_CASH | PAY_FLAG_DEBIT_FROM_BANK;
