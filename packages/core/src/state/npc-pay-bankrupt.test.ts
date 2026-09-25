/*
 * FU-6：強盜踩銀行把人**抢到破产** —— 破产在 `pay_money` **里面**当场发生
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * @source `pay_money` VA 0x0041d2c6（`python3 tools/disasm.py va 0x41d2c6 80`）：
 * ```asm
 * 0041d32d  add  ebx, edx                 ; 两级级联掏空：实付额 = 剩下的（可为负）
 * 0041d337  jge  0x41d375
 * 0041d339  xor  ebx, ebx                 ; 负 ⇒ 实付 0
 * 0041d375  push esi / call 0x40cd87      ; ★★ **就在这里**破产（清算要 rand：搭档挑格 / 下線拍卖）
 * 0041d37e  add  [payer + 0x5c], ebx      ; 付款方累计实付
 * 0041d3af  …                             ; ★ 收款方**在破产之后**才入账
 * ```
 * 強盜那一段（VA 0x0041c330）对每个对手**逐个**调一次 `pay_money`（`0x0041c39b`），
 * 所以「谁被抢破产」在他自己那一笔付款的那一刻就定了：
 *   · 后面几步看到的是**已经出局**的他 —— 抢银行那圈下一圈 `0x0041c35a cmp byte [player+0x15],0`
 *     直接跳过，停在他那一格时 `0x0041c1d6` 同样跳过（不夺卡）；
 *   · 破产清算掷的 `rand()`（`release_object` 的搭档挑格 `0x40e297` / 下線拍卖 `0x40d1f7`）
 *     排在**后面几步**的随机数**之前**。
 *
 * 本引擎先前走完**整趟**才破产（`npcStepOnce` 末尾 `settleBankruptcies`），
 * 于是上面两件事都晚了一步 —— 这个用例就是那条次序的闸。
 */
import { describe, expect, it } from 'vitest';
import { makeGameState, makeNode, makePlayer } from '../testing/factories.ts';
import { reduce, type MapTopology } from './reduce.ts';
import { releaseNpc } from '../rules/special-actors.ts';
import { SPECIAL_KIND } from '../loaders/map.ts';
import { WatcomRng } from '../rng/watcom.ts';
import { objectNodeCandidates, pickObjectNodeDistant, runtimeOccupiedNodes } from '../rules/object-landing.ts';
import { isAlive, type GameState } from './types.ts';

/** 銀行格：第 2 步踩到 */
const BANK = 3;
/** 有牌的对手站这儿（第 4 步）—— 破产**之后**才轮到他被夺卡 */
const CARD_VICTIM = 5;
/** 破產者站这儿（第 3 步）—— 已经出局 ⇒ 不夺卡（第 1 个用例） */
const BROKE_NODE = 4;
const OWNER_NODE = 18;
const SEED = 5;

/**
 * 一条 20 格的直路，节点间距 400 像素。
 *
 * ★ 1/2/3 号格 `noObjects`：搭档挑格那一步（`0x40aa6c`）会把「有人站着的格」跳过，
 *   而**惡人自己当前站在哪一格**在两种写法下不同（原版走一格就更新他的记录，
 *   本引擎一趟走完才写回 `specialActors`）。把这三个格排除掉，
 *   两种写法挑格用的候选表就完全一样，用例只盯随机数**次序**。
 */
function line(): MapTopology {
  const nodes = Array.from({ length: 20 }, (_, i) =>
    makeNode({
      id: i + 1,
      x: (i + 1) * 400,
      y: 0,
      adjacent: i === 0 ? [2] : i === 19 ? [19] : [i, i + 2],
      specialKind: i + 1 === BANK ? SPECIAL_KIND.BANK : 0,
      noObjects: i + 1 <= BANK,
    }),
  );
  return { nodes, lands: [] };
}

interface Fixture {
  state: GameState;
  /** 破產者（1 号）被收走的那件小財神 */
  godSlot: number;
  /** 它的搭档（大財神）下标 —— 破产清算要给他挑一格登场 */
  partnerSlot: number;
  /** 2 号手上的牌（奪卡候選，按牌序） */
  cards: number[];
}

/**
 * 三个人：0 = 強盜的主人、1 = 存款为负的破產者（身上背着小財神）、2 = 手上有牌的对手。
 *
 * `brokeOnBoard` 为真时把 1 号摆在 `BROKE_NODE`（第 3 步那一格）。
 */
const CARDS_HAND = [11, 13, 17, 19];

function fixture(brokeOnBoard: boolean, rngState = SEED): Fixture {
  const cards = [...CARDS_HAND];
  const base = makeGameState({
    players: [
      makePlayer({ index: 0, nodeId: OWNER_NODE }),
      makePlayer({
        index: 1,
        // 存款 -50 / 现金 10 ⇒ 两成 = trunc(-50/5) = -10，两个口袋掏空也付不出 ⇒ 当场破产、实付 0
        nodeId: brokeOnBoard ? BROKE_NODE : 0,
        moneyInBank: -50,
        cash: 10,
        cards: [3, 5, 7],
        godInfo: 1,
      }),
      // 存款 0 ⇒ 抢不到（`bankRobbery` 跳过 0 额），只管第 4 步的奪卡
      makePlayer({ index: 2, nodeId: CARD_VICTIM, moneyInBank: 0, cards }),
    ],
    phase: 'turnEnd',
    currentPlayer: 0,
    rngState,
    // 这一条 action 只走槽 1（強盜 actor 5）；槽 2 留着 ⇒ 不推日期、不换人
    pendingNpcSlots: [1, 2],
  });
  const specialActors = base.specialActors.map((a) => ({ ...a }));
  specialActors[1] = releaseNpc(1, 0, 0);
  const objects = base.objects.map((o) => ({ ...o }));
  // 小財神附在 1 号身上（attached = 玩家下标 + 1），搭档（大財神）还没登场。
  // ★ 物件的格 = 附身者此刻的格（离身时 `0x40e3cd..0x40e3d4` 就是这么写的）：
  //   1 号不在盘上时是 0，搭档挑格因此不受「≥300 像素」那道重抽影响，一次就中。
  objects[0] = { ...objects[0]!, nodeId: brokeOnBoard ? BROKE_NODE : 0, state: 7, attached: 2 };
  objects[1] = { ...objects[1]!, nodeId: 0, state: 0, attached: 0 };
  return { state: { ...base, specialActors, objects }, godSlot: 0, partnerSlot: 1, cards };
}

describe('FU-6 搶銀行把人抢破产：破产在 pay_money 里当场发生 @source 0x0041d375', () => {
  it('★ 出局者当场生效 —— 同一趟后一步停在他那一格也不夺卡（0x0041c1d6）', () => {
    const topo = line();
    const { state } = fixture(true);
    const after = reduce(state, { type: 'npcStep' }, topo);

    // 这一趟确实走到了 1 号站的那一格（第 4 步才够）
    const walk = after.lastNpcWalks[0]!;
    expect(walk.slot).toBe(1);
    expect(walk.steps).toBeGreaterThanOrEqual(4);
    expect(after.specialActors[1]!.nodeId).toBeGreaterThanOrEqual(CARD_VICTIM);

    // 1 号出局（原版 `mov byte [player+0x15], 0`，VA 0x0040ce13）
    expect(isAlive(after.players[1]!)).toBe(false);
    expect(after.players[1]!.godInfo).toBe(0);
    // ★ 1 号那三张牌一张都不在主人手上（清算把它们卖了）；
    //   主人手上只有第 4 步从 2 号那儿夺来的那**一张**
    const brokeHand = [3, 5, 7];
    expect(after.players[0]!.cards.filter((c) => brokeHand.includes(c))).toEqual([]);
    expect(after.players[0]!.cards).toHaveLength(1);
    const stolen = after.players[0]!.cards[0]!;
    expect(CARDS_HAND).toContain(stolen);
    expect(after.players[2]!.cards).toEqual(CARDS_HAND.filter((c) => c !== stolen));
  });

  it('★★ 破产的随机数排在**后面几步**之前：搭档挑格 → 后一步奪卡（次序逐次复算）', () => {
    const topo = line();
    const { state, partnerSlot, cards } = fixture(false);
    const after = reduce(state, { type: 'npcStep' }, topo);

    const steps = after.lastNpcWalks[0]!.steps;
    // 走不到第 4 步就换种子 —— 这场戏要「踩银行」和「再走一格夺卡」都发生
    expect(steps).toBeGreaterThanOrEqual(4);
    // 一开头「1 号被抢破产」这件事必须发生
    expect(isAlive(after.players[1]!)).toBe(false);

    // ── 按 exe 的次序把这一趟的随机数逐次复算一遍 ─────────────────────
    //   ① `0x40de50` 步数 `rand()%9+2`；② 每走一格 `0x40c196` 挑路一次（候选只有一个也照掷）；
    //   ③ 第 2 步（銀行格）里那一笔 `pay_money` 的破产清算：`release_object` 收走小財神 →
    //      `0x40e297` 给搭档（大財神）挑一格登场（`formerNode == 0` ⇒ 一次就中）；
    //   ④ 第 4 步 `0x441e77` 奪卡 `rand()%手牌数`。
    const r = new WatcomRng();
    r.setState(state.rngState);
    expect((r.next() % 9) + 2).toBe(steps);

    //   挑格的候选表 = 静态禁放位 + **付款那一刻**的运行时占用位：
    //   1..3 号格在本夹具里静态禁放（惡人自己站在銀行格上，位置不影响候选表）、
    //   被收走的那件神明已回库存、搭档自己还没登场 ⇒ 只剩两个玩家站着的格。
    const occupied = runtimeOccupiedNodes(
      after.players,
      after.objects.map((o, i) => (i === partnerSlot ? { ...o, nodeId: 0 } : o)),
      [],
    );
    const spots = objectNodeCandidates(topo.nodes).filter((n) => !occupied.has(n));
    const xy = (id: number): { x: number; y: number } | null => {
      const n = topo.nodes[id - 1];
      return n === undefined ? null : { x: n.x, y: n.y };
    };

    let spawn = 0;
    let stolen: number | null = null;
    expect(spots.length).toBeGreaterThan(1);
    expect(spots).not.toContain(CARD_VICTIM);
    for (let step = 1; step <= steps; step++) {
      r.next(); // 挑路
      const node = step + 1; // 直路：起点 1、第 i 步落在 i+1
      if (node === BANK) spawn = pickObjectNodeDistant(spots, 0, xy, () => r.next());
      if (node === CARD_VICTIM) stolen = cards[r.next() % cards.length]!;
    }

    // ★ 破产清算挑格吃的是**第 2 步那一格**的第一个随机数
    expect(spawn).toBeGreaterThan(0);
    expect(after.objects[partnerSlot]!.nodeId).toBe(spawn);
    // ★ 奪卡吃的是它**之后**那一个 —— 次序反了（破产拖到走完再算）这两个断言都过不去
    expect(stolen).not.toBeNull();
    expect(after.players[0]!.cards).toEqual([stolen]);
    expect(after.players[2]!.cards).toEqual(cards.filter((c) => c !== stolen));
  });
});
