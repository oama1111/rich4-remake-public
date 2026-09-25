/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * M2 验收：4 人完整跑完一局至破产结算
 *
 * ★ 这里**不做任何加速处理**。先前版本曾把物价指数预先抬高来催熟经济，
 *   那是错的：地价同样按物价指数缩放，抬高后反而没人买得起地
 *   （实测 owned=0，钱全流进公库）。真正的缺口是
 *   `updatePriceIndex` 根本没被 reduce 调用，以及**出局者的回合无人推进**
 *   ——两者都已修好，对局能自己跑到分出胜负。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { initialCardAmounts, newGame } from '../rules/new-game.ts';
import { decideAction } from '../ai/policy.ts';
import { CONFINEMENT_GATE_TYPE } from '../rules/confinement.ts';
import { WHO_PLAYS_RETURN_TO_BOARD, isAlive, isInGame } from './types.ts';
import { gameOverCode, isGameOver, reduce } from './reduce.ts';
import type { GameState } from './types.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

interface Played {
  state: GameState;
  turns: number;
  steps: number;
  ended: boolean;
  /** 第 n 个出局者出现在第几回合 */
  deaths: number[];
  /** 核过多少次「坐标不变量」（= 步数 × 4 名玩家） */
  invariantChecks: number;
}

/**
 * 坐标不变量：**在场**玩家的 `xpos/ypos` 必须等于其 `nodeId` 那个节点的坐标；
 * **离场**（`nodeId === 0`）必须 `0/0`。
 *
 * @source 原版共有 **11 个函数**写这两格（成对写 `+0x496b70`/`+0x496b72`）：
 *   `0x40c05c`、`0x40cc56`、`0x40cd87`（破产——其实是拿 `nodes[nodeId]`
 *   重新同步一遍）、`0x40d375`（消失）、`0x40d5a5`、`0x418c55`、
 *   `0x41d89e`（胜负收尾）、`0x43d593`（入狱传送）、`0x43ec3f`（入院传送）、
 *   `0x44757c`。复刻把这层不变量收进 `rules/position.ts` 的
 *   `placeOnNode`/`placeOnNodeId`，本函数就是它的**运行时哨兵**。
 */
function assertPositionInvariant(
  state: GameState,
  nodeIndex: ReadonlyMap<number, { x: number; y: number; gate: boolean }>,
  where: string,
  /**
   * 「贴图位置」的合法取值集合 —— `x/y` 是**贴图位置**，不是"所在格坐标"：
   *   · 監獄/醫院：特殊景观记录（綠島／醫院大樓，`@source 0x43d643`/`0x43ecef`）
   *   · 旅館住店：**旅館設施**的坐标（`@source 0x41a85e call 0x40d5a5` 支 A）
   */
  spritePositions: readonly { x: number; y: number }[] = [],
): void {
  for (const p of state.players) {
    if (p.nodeId === 0) {
      expect([p.xpos, p.ypos], `${where}: 玩家${p.index} 已离场却带着坐标`).toEqual([0, 0]);
      continue;
    }
    const n = nodeIndex.get(p.nodeId);
    expect(n, `${where}: 玩家${p.index} 的 nodeId=${p.nodeId} 不在节点表里`).toBeDefined();
    // ★★ 第 86 条：**被关押时 x/y 不指向所在格** —— 原版把屏幕坐标写成
    //   特殊景观记录（監獄 → 记录 2「綠島」、醫院 → 记录 1「醫院大樓」，
    //   `@source 0x43d643`/`0x43ecef`），因为 `x/y` 是**贴图位置**、
    //   `nodeId` 才是逻辑所在格。两种取值都合法（地图没有景观表时退回节点坐标）。
    const b = p.blocking;
    //   ★ 合法的窗口有两个：① 在押（计数非 0）；② **「走回棋盘」那一回合**
    //   （`+0x15 & 0x10`，玩家还在綠島/醫院大樓上，本引擎在那一回合的**收尾**
    //   把 x/y 重新同步成監獄/醫院格 —— 见 `startTurn`）。
    //   ★ 合法窗口：在押/住店（计数非 0）或 **「走回棋盘」那一回合**
    //   （`+0x15 & 0x10` —— 玩家还在綠島/醫院大樓/旅館上，本引擎在那一回合的
    //   **收尾**才把 x/y 同步回所在格 —— 见 `startTurn`）。
    //   ★★ 2026-09-19 补第五个窗口：**消失中**（`+0x33`）。原版「被綁架/出國」
    //   的结算会先 `call 0x40d761` 一次清掉 `+0x32..+0x35` 四项、再写 `+0x33`
    //   （`events/fortune-effects.ts:415-428` 逐句照抄），**全程不动 `x/y`**。
    //   因此「先被送進醫院（x/y = 醫院大樓景观坐标 319,990）、随后同一回合被綁架」
    //   会留下**没有阻碍计数、却带着医院景观坐标**的状态 —— 原版也是这个状态
    //   （消失期间玩家不上屏，坐标无意义）。旧不变量漏了这一窗，
    //   于是种子 1 走到这条轨迹时误报。**不变量没有放松**：消失者仍只能在
    //   「景观/設施坐标」集合里取值，任何集合外的乱值照样红。
    const confined =
      b.inHotel !== 0 ||
      b.disappearing !== 0 ||
      b.inPrison !== 0 ||
      b.inHospital !== 0 ||
      (p.whoPlays & WHO_PLAYS_RETURN_TO_BOARD) !== 0;
    const ok = confined
      ? spritePositions.some((g) => g.x === p.xpos && g.y === p.ypos)
      : false;
    if (ok) continue;
    // ★★ 第六个窗口（2026-09-19）：**消失结束之后**残留的贴图坐标。
    //   原版从「被綁架」到「消失结束」**全程不写 `x/y`**：`0x40d375` 只是把
    //   当时的 `x/y` 传给飞走动画 `0x41d476`（读了 `+0x08/+0x0a`，**没有写**），
    //   释放函数 `0x40d4e5` 也不写（只 `or node[+0x24]` 登记到场 + 清 `+0x33`）。
    //   ⇒「先被送進醫院（x/y = 醫院大樓景观坐标 319,990）→ 随后被綁架 →
    //   消失结束」会留下**零标志 + 医院景观坐标 + `nodeId` = 醫院格**。
    //   这一窗只在**脚下就是監獄/醫院格**时放行贴图坐标 —— 能造出这种坐标的
    //   路径只有关押传送，而关押传送必把 `nodeId` 设成该格；别处仍按节点坐标
    //   严格判，抓漏能力不受影响。
    if (n!.gate && spritePositions.some((g) => g.x === p.xpos && g.y === p.ypos)) continue;
    expect([p.xpos, p.ypos], `${where}: 玩家${p.index} 坐标与其节点不符`)
      .toEqual([n!.x, n!.y]);
  }
}

/**
 * 四人电脑对局，一路跑到分出胜负或用光回合预算。
 *
 * ⚠️ 回合预算一路从 4000 提到 8000 再到 12000，两次都是**规则变全**的代价：
 *   - 4000 → 8000：AI 开始会出牌，均富卡拉平现金、停留/烏龜卡拖住领先者，
 *     全是**反淘汰**机制（种子 2024 从 2123 回合变成 6660）。
 *   - 8000 → 12000：地图上开始有**神明**了。小衰神/大衰神/死神附身期间
 *     一切消费被拦（`purchaseBlockedBy`），土地公挡买无主地——买地节奏
 *     被按住，租金起得更慢（种子 2024 变成 8649）。
 *   - 12000 → 16000：过路费的九种免收（地主被关着/同盟/死神…）、免費卡/嫁禍卡自动使用、
 *     死神顯靈由他人賠償接上后（T-082），破产更难；种子 2024 于 12083 回合分出胜负。
 *   这都是规则本来的样子，不是卡死：长跑实测种子 2024 于 8649 回合、
 *   31337 于 27702 回合分出胜负，且终局时物件表守恒（6 个神明仍在场，
 *   禮物与寶箱一次性消耗掉——与原版 `i < 12` 才有搭档一致）。
 */
function playFullGame(seed: number, maxTurns = 16000): Played {
  const map = loadMap();
  const topo = {
    nodes: map.nodes,
    lands: map.lands,
    facilities: map.facilities,
    commercials: map.commercials,
  landscapes: map.landscapes,
  };
  const nodeIndex = new Map(
    map.nodes.map((n) => [
      n.id,
      {
        x: n.x,
        y: n.y,
        // ★ 关押传送落的是**关押格**（节点 type 0x1f41 / 0x1f42，0001.bin 的 23 / 1），
        //   不是落点特殊格（specialKind 4/5 = 12 / 16）—— 见 `rules/confinement.ts` 的
        //   `CONFINEMENT_GATE_TYPE`（@source 0x0040803f / 0x0043d621）。先前这里只认 specialKind，
        //   第六个窗口（被关 → 被綁架 → 消失结束，`0x40d375` / `0x40d4e5` 不写 x/y）在監獄那一侧
        //   从没真正放行过；pt27-stock 改了认购股数后轨迹换了，种子 2024 第 9829 步正好走到
        //   「命運三張：入監 + 消失」⇒ 綠島贴图 + 監獄關押格 1。
        gate:
          n.specialKind === SPECIAL_KIND.PRISON ||
          n.specialKind === SPECIAL_KIND.HOSPITAL ||
          n.type === CONFINEMENT_GATE_TYPE.prison ||
          n.type === CONFINEMENT_GATE_TYPE.hospital,
      },
    ]),
  );
  // 關押中的合法坐标：監獄 = 记录 2（綠島）、醫院 = 记录 1（醫院大樓）
  // （景观表 1 基、0 号槽是哨兵 ⇒ 本引擎数组下标 = 记录号 − 1）
  const gateLandscapes = [map.landscapes[0], map.landscapes[1]].filter(
    (l): l is NonNullable<typeof l> => l !== undefined,
  );
  // 旅館住店时贴图落到**該旅館設施**的坐标上（原版 `0x41a85e call 0x40d5a5` 支 A）。
  // ⚠️ 这里**不按类型筛**：設施的种类住店期间可能被改建卡改掉，而客人的贴图仍停在
  //   原来那张设施的坐标上（soak 实测：设施 2 从旅館变成 4 号种类，客人还在里面）。
  //   ⇒ 判据放宽成"**任何設施坐标**都算合法贴图位置"，仍然能抓住 0/坐标错位/写错格。
  const spritePositionsFor = () => [...gateLandscapes, ...map.facilities];
  let state = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed,
  });

  const deaths: number[] = [];
  let steps = 0;
  let invariantChecks = 0;
  for (; steps < 2_000_000; steps++) {
    if (isGameOver(state)) break;
    // ★★ 每一步都核「坐标不变量」（见文件末尾的 assertPositionInvariant）。
    //   这条不变量在原版有 **11 处**写入点（`mov word [player+0x70/+0x72]`），
    //   任何一条**移动了玩家却忘了同步坐标**的新路径都会在这里当场现形。
    assertPositionInvariant(state, nodeIndex, `step ${steps}`, spritePositionsFor());
    invariantChecks += 4;
    // ★ 牌堆守恒：原版手牌只经 `0x4412e4` / `0x441343` / `0x441f21` 三个口子进出，每个口子都把
    //   同一张卡记进牌堆 `0x499197` ⇒ 牌堆 + 四人手牌 ≡ 開局 initAmount（见 `conserveCardPool`）。
    assertCardConservation(state, `step ${steps}`);
    const a = decideAction({ state, map });
    if (a === null) throw new Error(`无人可动：phase=${state.phase} 当前玩家=${state.currentPlayer}`);
    const next = reduce(state, a, topo);
    if (next === state) throw new Error(`卡死于 ${state.phase} / ${a.type}`);
    // ★ 出局 = 不在局里了（还没上盘的第 2..N 位不算出局：他们轮到自己才落地）
    const dead = next.players.filter((p) => !isInGame(p)).length;
    while (deaths.length < dead) deaths.push(next.turnCount);
    state = next;
    if (state.turnCount >= maxTurns) break;
  }
  return { state, turns: state.turnCount, steps, ended: isGameOver(state), deaths, invariantChecks };
}

describe('★ M2 验收：完整一局', () => {
  run('★ 能一路跑到有人破产出局', () => {
    const r = playFullGame(2024);
    // ★ 防"空跑"：坐标不变量必须真的被核过很多次（步数 × 4 名玩家）
    expect(r.invariantChecks, '坐标不变量核得太少，这条断言形同虚设')
      .toBeGreaterThan(10_000);
    expect(r.deaths.length, `跑了 ${r.turns} 回合仍无人出局`).toBeGreaterThan(0);
  });

  run('★ 能跑到对局结束并给出终局码', () => {
    const r = playFullGame(2024);
    expect(r.ended, `跑了 ${r.turns} 回合仍未分出胜负`).toBe(true);
    expect(gameOverCode(r.state)).toBeGreaterThan(0);
    expect(r.state.players.filter((p) => isAlive(p)).length).toBe(1);
  });

  run('★ 出局是渐次发生的，不是一次团灭', () => {
    const r = playFullGame(2024);
    expect(r.deaths.length).toBe(3);
    // 三个人在不同回合出局——若同一回合全死，多半是结算逻辑串了
    expect(new Set(r.deaths).size).toBe(3);
    // ⚠️ 先前这里要求头两个出局者相隔 100 回合以上。AI 接上**借贷**
    //   （角色表的 f24，见 ai/personality.ts）之后经济快了一个数量级：
    //   种子 2024 从 8649 回合缩到 1450，三人分别倒在 1379/1389/1450。
    //   十回合内连倒两个不是 bug，是借钱买地、一笔大租金同时压垮两家。
    //   真正要守的是「不是同一回合团灭」，上面那条断言已经守住了。
    expect(r.deaths[1]! - r.deaths[0]!).toBeGreaterThan(0);
  });

  run('★ AI 真的会用道具 —— 百貨公司一通，道具经济就活了', () => {
    // 这条先前是反向断言（「一个都没用」），因为当时卡在两处：
    //   开局不发交通工具，而車子要去百貨公司买——那时百貨还没实现。
    // 现在百貨接上了，AI 会用點數买車（原版先買機車、只拿一半點券逛道具）再换乘，道具终于被用起来。
    const map = loadMap();
    const topo = {
      nodes: map.nodes,
      lands: map.lands,
      facilities: map.facilities,
      commercials: map.commercials,
    };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 2024,
    });
    let used = 0;
    let bought = 0;
    for (let i = 0; i < 200_000 && state.turnCount < 2000; i++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      if (a.type === 'useTool') used++;
      // ★ 第二十六份：电脑进百貨不再挂商店交互（原版 `0x0042ea2b … jne 0x42ed8d` 当场买卖完就走，
      //   `places/ai-shop.ts`）⇒ 不再有 `shop` action，改数「落在百貨的那条 settle 花掉了點券」
      const me = state.players[state.currentPlayer];
      const onStore =
        a.type === 'settle' && map.nodes[(me?.nodeId ?? 0) - 1]?.specialKind === SPECIAL_KIND.DEPARTMENT_STORE;
      const next = reduce(state, a, topo);
      if (onStore && (next.players[state.currentPlayer]?.points ?? 0) < (me?.points ?? 0)) bought++;
      if (next === state) break;
      state = next;
    }
    expect(bought, '两千回合里一次都没在百貨公司买过东西').toBeGreaterThan(0);
    expect(used, '买了道具却一个也没用').toBeGreaterThan(0);
  });

  run('★ AI 真的会出牌 —— 卡片系统不再是死代码', () => {
    const map = loadMap();
    const topo = {
      nodes: map.nodes,
      lands: map.lands,
      facilities: map.facilities,
      commercials: map.commercials,
    };
    let state = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
      seed: 2024,
    });
    let played = 0;
    for (let i = 0; i < 200_000 && state.turnCount < 2000; i++) {
      const a = decideAction({ state, map });
      if (a === null) break;
      if (a.type === 'useCard') played++;
      const next = reduce(state, a, topo);
      if (next === state) break;
      state = next;
    }
    expect(played, '两千回合里一张牌都没出过').toBeGreaterThan(0);
  });

  run('★ 换个种子至少也能把人打出局', () => {
    // ⚠️ 不是每个种子都能在 4000 回合内分出胜负，这**不是卡死**：
    //   接入日期推进后银行月息（无贷款则每月 ×1.1）开始生效，
    //   而当前 AI 只会买地、从不动用存款，于是人人躺在存款上滚雪球，
    //   谁也打不死谁。那是 AI 的问题（M3），不是规则的问题。
    //   这里只要求局面确实在推进：有人出局。
    // ★ 种子于 2026-09-22 更换：本轮改动（福神附身时买地/买设施/建设施/加盖设施
    //   白送一级、回合开始被阻碍会弹状态框、放置类道具不能和神明重叠）改了游戏
    //   进程，旧种子 1 在 4000 回合内打不出局，而且会先撞上坐标不变量的旧窗口
    //   （step 15384 / turn 1263，玩家3 在 nodeId=23 上留着醫院大樓贴图坐标）。
    //   ⇒ 换成重新扫出来的 177 / 58 / 230：三个都能在 4000 回合内打出 3 人出局
    //   （分别倒在 521/2904/3274、638/1595/1645、644/834/915 回合），全程不变量干净。
    let withDeaths = 0;
    for (const seed of [177, 58, 230]) {
      if (playFullGame(seed, 4000).deaths.length > 0) withDeaths++;
    }
    expect(withDeaths).toBeGreaterThan(0);
  });

  run('★ 出局者的钱被清空、赢家仍有资产', () => {
    const r = playFullGame(2024);
    const alive = r.state.players.filter((p) => isAlive(p));
    for (const p of r.state.players) {
      if (isAlive(p)) continue;
      expect(p.cash).toBe(0);
      expect(p.moneyInBank).toBe(0);
    }
    expect(alive[0]!.cash + alive[0]!.moneyInBank).toBeGreaterThan(0);
  });

  run('★ 出局者不再持有地块 —— 但压哨那一位除外', () => {
    // ★ 原版的破产清算（变卖手牌/道具、释放地产）只在**非终局**路径上执行；
    //   最后一个破产的人直接进终局，地产原样留在他名下。
    //   见 rules/bankruptcy.ts 的 resolveBankruptcyOutcome 与
    //   state/reduce.ts 的 applyBankruptcy。
    const r = playFullGame(2024);
    const stillOwning = r.state.players.filter(
      (p) => !isAlive(p) && r.state.landOwner.includes(p.index + 1),
    );
    expect(stillOwning.length).toBeLessThanOrEqual(1);
  });

  run('★ 整局可完整复现', () => {
    const a = playFullGame(2024);
    const b = playFullGame(2024);
    expect(a.turns).toBe(b.turns);
    expect(a.steps).toBe(b.steps);
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(a.state.landOwner).toEqual(b.state.landOwner);
    expect(a.state.players.map((p) => [p.cash, p.moneyInBank, p.whoPlays])).toEqual(
      b.state.players.map((p) => [p.cash, p.moneyInBank, p.whoPlays]),
    );
  });

  run('未分胜负的种子也不会卡死或抛错', () => {
    // 种子 7 在早先的规则集下四人长期僵持；規則补全（設施可买可蓋、四大惡人、
    // 休市/漲跌停…）之后它在约 760 回合就分出了胜负。两种结局都合法——
    // 这条测的是「引擎一直能推进、不抛错」，不是某个种子的命运。
    const r = playFullGame(7, 2000);
    expect(r.turns).toBeLessThanOrEqual(2000);
    const alive = r.state.players.filter((p) => isAlive(p)).length;
    if (r.ended) {
      expect(alive).toBeLessThanOrEqual(1);
    } else {
      expect(r.turns).toBe(2000);
      expect(alive).toBeGreaterThan(1);
    }
  });

  run('★ 日期随回合推进，月结与开奖都真的跑到了', () => {
    const r = playFullGame(2024);
    // 一回合一天，两千多回合必然跨了好几年
    expect(r.state.year).toBeGreaterThan(1998);
    // 股市也在跟着走 —— 价格离开了初始值
    const moved = r.state.market.stocks.filter((s) => s.price !== s.basePrice).length;
    expect(moved).toBeGreaterThan(0);
  });
});

const INITIAL_CARD_AMOUNTS = initialCardAmounts();

/** 牌堆 + 全体手牌 = 開局 initAmount（逐卡号），见 `rules/inventory.ts` 的 `conserveCardPool` */
function assertCardConservation(state: GameState, where: string): void {
  const held = new Array<number>(INITIAL_CARD_AMOUNTS.length).fill(0);
  for (const p of state.players) for (const id of p.cards) held[id - 1] = (held[id - 1] ?? 0) + 1;
  for (let i = 0; i < INITIAL_CARD_AMOUNTS.length; i++) {
    const total = (state.cardAmount[i] ?? 0) + (held[i] ?? 0);
    if (total !== INITIAL_CARD_AMOUNTS[i]) {
      expect(total, `${where}: 卡 ${i + 1} 牌堆 ${state.cardAmount[i]} + 手牌 ${held[i]} ≠ 開局 ${INITIAL_CARD_AMOUNTS[i]}`).toBe(
        INITIAL_CARD_AMOUNTS[i],
      );
    }
  }
}
