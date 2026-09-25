/*
 * 探監與探病 —— 落在監獄/醫院格上做什么
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 答案是**保釋**：花點券把里面的人放出来。
 *
 * @source 監獄落点 VA 0x0043d304、醫院落点 VA 0x0043e9a4。
 *   两段逐条同构，只差占用表（`0x496b30` / `0x496b60`）、
 *   计数字段（`+0x34` / `+0x35`）与赎金表（`0x475c44` / `0x475ca4`）——
 *   而那两张赎金表的数值**完全一样**。
 *
 * ```asm
 * if (占用表 8 槽全空) return                 ; 没人可探
 * if (player.who_plays == 1) 弹保釋 UI        ; 真人自己选
 * else {                                      ; 电脑
 *     if ((rand() & 1) == 0) return           ; ★ 一半概率根本不管
 *     候选 = 按 player[+0x17] 挑（见 BAIL_STYLE）
 *     if (候选空) return
 *     目标 = 候选[rand() % n]
 *     赎金 = 表[目标]
 *     if (目标 < 4) { if (點券 <= 赎金) return }
 *     else          { if (點券 < 700)   return }   ; ★ 门槛 700，收费仍是 300
 *     點券 -= 赎金
 *     放人
 * }
 * ```
 */

import type { Player } from '../state/types.ts';
import { OBJECT_SLOT_BASE, type ConfinementKind } from './confinement.ts';
import { addPoints } from './points.ts';

/**
 * 关在 4..7 号槽里的四个 NPC。
 *
 * @source `dword [slot*4 + 0x47ed5a]`——该表就是物件名表 0x47ed76 往前
 *   挪 28 字节，故下标 4..7 落在「小偷/強盜/流氓/間諜」这四个名字上。
 *
 * ★ **开局他们并不都在監獄：小偷(4)/強盜(5) 蹲監獄，流氓(6)/間諜(7) 躺醫院。**
 *   @source 0x00407351 四条 `mov byte [...], 1`，详见 rules/special-actors.ts
 *   的 `INITIAL_ACTOR_PLACE`。占用表由 `initialConfinement()` 播种，
 *   所以**开局第一次探監就能保釋到人**。
 *
 * ★ 保釋他们**不是**只把槽清零：他会当场从監獄/醫院那一格上路，
 *   走 `rand()%9+2` 步，主人记成保釋他的人（见 `releaseNpc`）。
 *   在路上踩到惡犬会被咬进醫院，且**不会自己出院**——只能再花 300 點券捞。
 *
 * ★ 落点行为**已全部实现**（2026-09-16 订正）：四大惡人走到各类格子上做什么
 *   都在 `rules/npc-walk.ts` 里，不再是「十八条里的十七条」。见 known-deviations
 *   的 Q-NPC-1 与 `npc-walk.ts` 的头注释。
 */
export const INMATE_NAMES: readonly string[] = ['小偷', '強盜', '流氓', '間諜'];

/**
 * 赎金，**花點券**。
 * @source 两张表 0x475c44（監獄）与 0x475ca4（醫院），内容相同：
 *   下标 0..3（玩家）都是 30，4..7（NPC）都是 300。
 */
export const BAIL_COST_PLAYER = 30;
export const BAIL_COST_INMATE = 300;

/**
 * 保釋 NPC 的**点券门槛**。
 * @source `cmp word [player + 0x30], 0x2bc / jb 放弃`
 *
 * ⚠️ 门槛是 700，但真正扣的是 300 —— 原版就是这么写的，不是笔误：
 *   玩家那条用 `cmp 點券, 赎金 / jg`（必须**严格大于**赎金），
 *   NPC 那条另起一个绝对门槛。两条判据的形状都不一样。
 */
export const BAIL_INMATE_POINTS_REQUIRED = 0x2bc;

/** 某个槽位的赎金 */
export function bailCost(slot: number): number {
  return slot < OBJECT_SLOT_BASE ? BAIL_COST_PLAYER : BAIL_COST_INMATE;
}

/**
 * 點券够不够保这个槽位。
 *
 * @param human 真人在保釋窗里点的那一支（默认 false = 电脑那一支）。
 *   ★★ 2026-09-24（provenance 审计）：两支判据**不一样** ——
 *   真人 `0x0043d0c3 mov ax,[点券] / 0x0043d0d4 cmp eax,[槽*4+0x475c44] / 0x0043d0da jl 不够`
 *   ⇒ **点券 ≥ 赎金**（30 / 300），没有 700 那道门槛；电脑那一支才是「> 30 / ≥ 700」。
 *   先前真人也套电脑的判据（有 30 點券保不了人、有 300~699 保不了惡人）。
 */
export function canAffordBail(points: number, slot: number, human = false): boolean {
  if (human) return points >= bailCost(slot);
  // @source 玩家：cmp eax, esi / jg 继续 —— **严格大于**
  if (slot < OBJECT_SLOT_BASE) return points > bailCost(slot);
  // @source NPC：cmp word [+0x30], 0x2bc / jb 放弃
  return points >= BAIL_INMATE_POINTS_REQUIRED;
}

export interface BailCandidate {
  /** 占用表槽位 0..7 */
  slot: number;
  /** 0..3 是玩家下标；NPC 为 -1 */
  player: number;
  name: string;
  cost: number;
  /** 当前这位访客付不付得起 */
  affordable: boolean;
}

/** 里面关着谁 */
export function bailCandidates(
  occupancy: readonly number[],
  players: readonly Player[],
  visitorPoints: number,
  nameOf: (playerIndex: number) => string,
  /** 候选名单只给真人的保釋窗用 ⇒ 缺省按真人判据 */
  human = true,
): BailCandidate[] {
  const out: BailCandidate[] = [];
  for (let slot = 0; slot < occupancy.length; slot++) {
    if ((occupancy[slot] ?? 0) === 0) continue;
    const isPlayer = slot < OBJECT_SLOT_BASE;
    out.push({
      slot,
      player: isPlayer ? slot : -1,
      name: isPlayer ? nameOf(slot) : (INMATE_NAMES[slot - OBJECT_SLOT_BASE] ?? `犯人${slot}`),
      cost: bailCost(slot),
      affordable: canAffordBail(visitorPoints, slot, human),
    });
  }
  void players;
  return out;
}

// ============================================================
//  电脑玩家怎么挑
// ============================================================

/**
 * 玩家 `+0x17` 的取值，决定电脑保釋谁。
 *
 * ★ 这解开了 `@rich4/data` 的 `characters.ts` 里那个
 *   「语义尚未确认」的 **`f23`**：它就是这个字段，取值恰为 0/1/2，
 *   而監獄与醫院两处落点各自对它做同一套三路判断
 *   （VA 0x0043d3ee 与 0x0043ea9a）。
 *
 * | 值 | 行为 | 哪些角色 |
 * |---|---|---|
 * | 0 | **只保釋玩家** | 糖糖、烏咪、孫小美 |
 * | 1 | 保釋玩家；再掷一次 `rand()%3`，为 0 时把 NPC 也算进候选 | 沙隆巴斯、阿土伯、莎拉公主、宮本寶藏、小丹尼 |
 * | 2 | **只保釋 NPC**（小偷/強盜/流氓/間諜） | 約翰喬、忍太郎、錢夫人、金貝貝 |
 *
 * 读起来是一条性格轴：0 是好人（只救人），2 是坏人（只放犯人），
 * 1 在中间。三个「只救人」的全是女角色，也说得通。
 */
export const BAIL_STYLE = {
  PLAYERS_ONLY: 0,
  PLAYERS_MAYBE_INMATES: 1,
  INMATES_ONLY: 2,
} as const;

/** 风格 1 掷的那一次 `rand()%3`，为 0 才把 NPC 算进来 */
export const BAIL_INMATE_CHANCE_MODULUS = 3;

export interface BailDecision {
  /** 选中的槽位；-1 表示不保釋 */
  slot: number;
  /** 用掉了几个随机数 —— 调用方据此推进 PRNG（C-DET-4） */
  randomsUsed: number;
}

/**
 * 电脑玩家的保釋决定。
 *
 * @param rolls 依次取用的 `rand()` 值
 *
 * ⚠️ 第一个随机数是**「管不管」**：`test al, 1 / je 返回`，
 *   也就是有一半的时候电脑站在监狱门口什么也不做。
 *   少了这一掷，AI 会比原版热心一倍。
 */
export function decideBail(
  style: number,
  occupancy: readonly number[],
  points: number,
  rolls: readonly number[],
): BailDecision {
  let used = 0;
  const next = (): number => rolls[used++] ?? 0;

  // @source call rand / test al, 1 / je 返回
  if ((next() & 1) === 0) return { slot: -1, randomsUsed: used };

  const occupied = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let i = from; i < to; i++) if ((occupancy[i] ?? 0) !== 0) out.push(i);
    return out;
  };

  let pool: number[] = [];
  if (style === BAIL_STYLE.PLAYERS_ONLY) {
    pool = occupied(0, OBJECT_SLOT_BASE);
  } else if (style === BAIL_STYLE.PLAYERS_MAYBE_INMATES) {
    pool = occupied(0, OBJECT_SLOT_BASE);
    // @source rand()%3 / test edx,edx / jne 跳过 NPC
    if (next() % BAIL_INMATE_CHANCE_MODULUS === 0) {
      pool = pool.concat(occupied(OBJECT_SLOT_BASE, occupancy.length));
    }
  } else if (style === BAIL_STYLE.INMATES_ONLY) {
    pool = occupied(OBJECT_SLOT_BASE, occupancy.length);
  }
  // @source default 分支什么也不加

  // @source test esi, esi / je 返回
  if (pool.length === 0) return { slot: -1, randomsUsed: used };

  // @source idiv esi —— 从候选里随机挑一个
  const slot = pool[next() % pool.length] ?? -1;
  if (slot < 0 || !canAffordBail(points, slot)) return { slot: -1, randomsUsed: used };
  return { slot, randomsUsed: used };
}

// ============================================================
//  放人
// ============================================================

/**
 * 释放标志：写进天数字段的高位。
 *
 * @source `mov byte [target*0x68 + 0x496b9c], 0x80`（監獄）
 *   / `[0x496b9d]`（醫院）—— 正是 `rules/blocking.ts` 说的
 *   「减到 0 时挂 0x80 而非清零，下一次推进才执行释放流程」那个位。
 *   保釋等于**直接把它挂上**，不必等天数走完。
 */
export const RELEASE_FLAG = 0x80;

export interface BailResult {
  ok: boolean;
  players: Player[];
  occupancy: number[];
  /** 付掉的點券 */
  paid: number;
}

/**
 * 付钱放人。
 *
 * @source VA 0x0043d558 起：
 * ```asm
 * sub word [访客 + 0x30], 赎金          ; ★ 監獄这一条是 **16 位**减
 * if (目标 < 4) { byte [目标 + 0x34] = 0x80 ; 占用表[目标] = 0 }
 * else          release(目标)            ; 占用表由 release 自己清
 * ```
 *
 * ★★ 通道 2 补两条（2026-09-19 第 93 条，`rich4-spec/tests/test_bail.py` 37/37）：
 * ① **占用表的分工**：目标 < 4（玩家）时**本函数**清 `占用表[目标]`；
 *    目标 ≥ 4（替身）时本函数**一个字都不写**，清表在 `0x43d7bf`/`0x43ee6e` 里面。
 *    本引擎把「放人」折进 `bail` 这个 action，两支都由 `r.occupancy` 清掉 ⇒ 终态相同。
 * ② **两段的扣款都是 16 位**：監獄 `0x43d55f` 与醫院 `0x43ec0b` 都是 `66 29 b2 …`
 *    = `sub word [..+0x30], si`（逐字节同形）。
 *    ⚠️ 第 93 条曾把醫院那条误报成 `sub dword`（**起点错一格**：`0x43ec04` 的
 *    `imul edx, [0x49910c], 0x68` 正好 7 字节，`66` 在 `0x43ec0b`），并据此登记了
 *    不存在的原版瑕疵 Q-BAIL-1 —— 第 94 条已撤回。
 *
 * ★ 附：點券是 **16 位字段**（全 exe 38 处访问全是 `word`，机械普查
 *   `rich4-spec/tests/test_points_field.py`）⇒ 写點券一律走 `rules/points.ts` 的
 *   `addPoints`（`& 0xffff`）。本函数里的 `points: p.points - cost` 已带「付得起」前置，
 *   但下面 `applyBail` 仍走 `addPoints` 以保持同一条不变量。
 */
export function applyBail(
  players: readonly Player[],
  occupancy: readonly number[],
  kind: ConfinementKind,
  visitor: number,
  slot: number,
  /** 真人窗口那一支（判据见 `canAffordBail`） */
  human = false,
): BailResult {
  const fail: BailResult = {
    ok: false,
    players: [...players],
    occupancy: [...occupancy],
    paid: 0,
  };
  const me = players[visitor];
  if (me === undefined) return fail;
  if ((occupancy[slot] ?? 0) === 0) return fail;
  if (!canAffordBail(me.points, slot, human)) return fail;

  const cost = bailCost(slot);
  const nextOcc = [...occupancy];
  nextOcc[slot] = 0;

  const field = kind === 'prison' ? 'inPrison' : 'inHospital';
  const nextPlayers = players.map((p, i) => {
    // ★ 點券是 16 位字段 ⇒ 一律走 `addPoints`（回绕）。这里有「付得起」前置，
    //   故与直接相减在可达状态下等价，但保持同一条不变量。
    if (i === visitor) return { ...p, points: addPoints(p.points, -cost) };
    // @source byte [目标 + 0x34/0x35] = 0x80
    if (i === slot && slot < OBJECT_SLOT_BASE) {
      return { ...p, blocking: { ...p.blocking, [field]: RELEASE_FLAG } };
    }
    return p;
  });

  return { ok: true, players: nextPlayers, occupancy: nextOcc, paid: cost };
}
