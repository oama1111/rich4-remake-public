/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 簇 A：阻碍/关押的**释放链**必须闭合。
 *
 * 原版（@source 0x0041c84f 的 `0x80` 分支）在刑满的**下一次**推进才放人，
 * 释放函数做两件事（以监狱为例，@source 0x0043d7bf）：
 *   ```asm
 *   0043d7cb  call 0x40d6be                       ; ① 回棋盘（置方向、登记节点占用）
 *   0043d7d5  mov byte ptr [ebx + 0x496b30], al   ; al=0 ② 清**占用表**
 *   ```
 * 本文件盯住**第 ② 件**（可独立验证的部分）：
 * 占用表不清零 ⇒ `anyoneConfined()` 恒为真 ⇒ 監獄／醫院落点永远认为"有人被关着"，
 * 已出狱者可以被**反复保释**（幽灵保释）。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMap, SPECIAL_KIND } from '../loaders/map.ts';
import { newGame } from '../rules/new-game.ts';
import { anyoneConfined } from '../rules/confinement.ts';
import { RELEASE_PENDING } from '../rules/blocking.ts';
import { reduce } from './reduce.ts';
import { WHO_PLAYS_RETURN_TO_BOARD, WHO_PLAYS_SPECIAL_MASK, type GameState } from './types.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const run = existsSync(MAP) ? it : it.skip;
const loadMap = () => parseMap(new Uint8Array(readFileSync(MAP)));

const topo = () => {
  const map = loadMap();
  return { map, topo: { nodes: map.nodes, lands: map.lands } };
};

/**
 * 造一个「**下一位**玩家（1 号）刑满待释放、占用表里还记着他」的回合边界局面。
 *
 * ★★ 第 84 条订正：原版 `0x418f95 inc esi` 先把游标 ++、`0x419039 call 0x41c84f`
 *   才递减 ⇒ 递减／释放作用于**即将行动的那位**（从 `currentPlayer = 0` 出发就是 1 号）。
 */
function pendingRelease(
  field: 'inPrison' | 'inHospital',
  occ: 'prisonOccupancy' | 'hospitalOccupancy',
): GameState {
  const { map } = topo();
  const s = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
  });
  return {
    ...s,
    phase: 'turnEnd',
    pendingNpcSlots: [],
    currentPlayer: 0,
    // ★ 占用表**整体清零**再只置槽 0：`newGame` 会按 `INITIAL_ACTOR_PLACE`
    //   把**特殊角色槽 4..7** 预先占上（实测开局 = [0,0,0,0,1,1,0,0]），
    //   那是另一回事（N-A5：新闻只看槽 0..3，落点看全 8 槽）。
    //   本测试要隔离"释放槽 1"这一件事，故把其余槽清干净。
    [occ]: s[occ].map((_v, i) => (i === 1 ? 1 : 0)),
    players: s.players.map((p, i) =>
      i === 1 ? { ...p, blocking: { ...p.blocking, [field]: RELEASE_PENDING } } : p,
    ),
  } as GameState;
}

describe('★ 释放链：刑满后必须清掉占用表（簇 A）', () => {
  run('监狱：占用的玩家出狱后，`anyoneConfined` 变假', () => {
    const { topo: t } = topo();
    const before = pendingRelease('inPrison', 'prisonOccupancy');
    expect(anyoneConfined(before.prisonOccupancy)).toBe(true);

    const after = reduce(before, { type: 'endTurn' }, t);

    expect(after.prisonOccupancy[1]).toBe(0);
    expect(anyoneConfined(after.prisonOccupancy)).toBe(false);
    // 释放函数自己**不写**计数（`0x43d7bf` 只调 `0x40d6be` + 清占用表），
    // 计数由本次推进的 `tickBlockingCounter` 归零
    expect(after.players[1]!.blocking.inPrison).toBe(0);
  });

  run('医院：占用的玩家出院后，`anyoneConfined` 变假', () => {
    const { topo: t } = topo();
    const before = pendingRelease('inHospital', 'hospitalOccupancy');
    expect(anyoneConfined(before.hospitalOccupancy)).toBe(true);

    const after = reduce(before, { type: 'endTurn' }, t);

    expect(after.hospitalOccupancy[1]).toBe(0);
    expect(anyoneConfined(after.hospitalOccupancy)).toBe(false);
    expect(after.players[1]!.blocking.inHospital).toBe(0);
  });

  run('反向：只关着、还没刑满时**不许**清占用表', () => {
    const { topo: t } = topo();
    const s = pendingRelease('inPrison', 'prisonOccupancy');
    const before: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, blocking: { ...p.blocking, inPrison: 3 } } : p,
      ),
    };

    const after = reduce(before, { type: 'endTurn' }, t);

    // 3 → 2，仍在押，占用表保持 1
    expect(after.players[1]!.blocking.inPrison).toBe(2);
    expect(after.prisonOccupancy[1]).toBe(1);
    expect(anyoneConfined(after.prisonOccupancy)).toBe(true);
  });

  run('★ 回归：監獄落点不再对「已释放」的玩家开保释菜单', () => {
    const { map, topo: t } = topo();
    const node = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.PRISON);
    if (node === undefined) return; // 这张图没有监狱格

    // 先让刑满者出狱
    const released = reduce(pendingRelease('inPrison', 'prisonOccupancy'), { type: 'endTurn' }, t);
    expect(anyoneConfined(released.prisonOccupancy)).toBe(false);

    // 再让当前玩家踩到监狱格
    const standing: GameState = {
      ...released,
      phase: 'settling',
      players: released.players.map((p, i) => (i === released.currentPlayer ? { ...p, nodeId: node.id } : p)),
    };
    const r = reduce(standing, { type: 'settle' }, t);

    // 没人被关着 ⇒ 不出保释交互（原版：落点处理开头 `for(i<8) if(table[i]) break;` 全 0 即返回）
    expect(r.pending?.kind).not.toBe('bail');
  });
});

/**
 * ★★ 第 84 条：释放之后还要**白丢一回合**（「从綠島走回棋盘」那一回合）。
 *
 * @source
 * ```asm
 * ; ① 释放函数（住宿/监狱/医院共用）经 0x40d6be：
 * 0040d6d1  or   byte [player + 0x15], 0x10   ; 「走回棋盘」标记
 * ; ② 回合推进 0x418ebd：
 * 00418f07  test byte [player + 0x15], 0x30
 * 00418f0e  je   0x418f93                     ; 没有标记 → 正常开局
 * 00418f87  and  byte [player + 0x15], 0xf    ; 消费标记
 * 00418f8e  jmp  0x419058                     ; ★ 这一回合不掷骰、不走子
 * ; ③ 走路例程 0x40c05c 的 0x40c3cf：
 * 0040c3cf  mov  dword [player + 0x32], 0     ; 四个阻碍计数一次清光
 * ```
 * 通道 2 证据：`rich4-spec/tests/test_day_tick.py`（28/28；含「0x80 不会被
 * 递减掉、监狱/医院两支的释放函数**不清**计数」这两条）。
 */
describe('★ 释放后的「走回棋盘」回合（第 84 条）', () => {
  const t = () => topo().topo;

  run('监狱：刑满那一次 endTurn 要置「走回棋盘」标记', () => {
    const after = reduce(pendingRelease('inPrison', 'prisonOccupancy'), { type: 'endTurn' }, t());
    expect(after.players[1]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(
      WHO_PLAYS_RETURN_TO_BOARD,
    );
  });

  run('★ 标记让下一回合直接 skip（不掷骰），并在那一刻清四个计数', () => {
    // 刑满 → 标记
    const flagged = reduce(pendingRelease('inPrison', 'prisonOccupancy'), { type: 'endTurn' }, t());
    // 把那一位放回当前玩家、进 turnStart（模拟轮到他）
    const ready: GameState = { ...flagged, phase: 'turnStart', currentPlayer: 1 };
    const skipped = reduce(ready, { type: 'startTurn' }, t());
    expect(skipped.phase).toBe('turnEnd'); // ★ 整回合跳过
    // ★ E-41：标记留到这一回合的收尾（`0x418f87`）才消费，见下一条用例
    expect(skipped.players[1]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(WHO_PLAYS_RETURN_TO_BOARD);
    // ★ 原版这一清在走路例程里（`0x40c3cf mov dword [player+0x32], 0`），本引擎折叠到这里
    expect(skipped.players[1]!.blocking).toMatchObject({
      inHotel: 0,
      disappearing: 0,
      inPrison: 0,
      inHospital: 0,
    });
  });

  run('★★ E-41：「走回棋盘」那一回合收尾**不换人**、不走一天，同一位立刻正常开局', () => {
    const flagged = reduce(pendingRelease('inPrison', 'prisonOccupancy'), { type: 'endTurn' }, t());
    const walked = reduce({ ...flagged, phase: 'turnStart', currentPlayer: 1 }, { type: 'startTurn' }, t());
    const before = walked.turnCount;
    const again = reduce(walked, { type: 'endTurn' }, t());
    // @source 0x00418f8e `jmp 0x419058`：不 inc 游标
    expect(again.currentPlayer).toBe(1);
    expect(again.phase).toBe('turnStart');
    // `0x418f87 and 0xf`：0x10/0x20 一起消费
    expect(again.players[1]!.whoPlays & WHO_PLAYS_SPECIAL_MASK).toBe(0);
    // 客户端靠 turnCount 判「换回合」
    expect(again.turnCount).toBe(before + 1);
    // 不走一天（没 call 0x41c84f）⇒ 日期不动
    expect([again.year, again.month, again.day]).toEqual([walked.year, walked.month, walked.day]);
    // 接下来是真回合
    const play = reduce(again, { type: 'startTurn' }, t());
    expect(play.phase).toBe('awaitingRoll');
    expect(play.currentPlayer).toBe(1);
  });

  run('★ 医院同理', () => {
    const flagged = reduce(pendingRelease('inHospital', 'hospitalOccupancy'), { type: 'endTurn' }, t());
    const skipped = reduce(
      { ...flagged, phase: 'turnStart', currentPlayer: 1 },
      { type: 'startTurn' },
      t(),
    );
    expect(flagged.players[1]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(0x10);
    expect(skipped.phase).toBe('turnEnd');
    expect(skipped.players[1]!.blocking.inHospital).toBe(0);
  });

  run('★ 「走回棋盘」那一回合的收尾：x/y 从綠島/醫院大樓回到監獄/醫院格', () => {
    const { map, topo: t } = topo();
    const released = reduce(pendingRelease('inPrison', 'prisonOccupancy'), { type: 'endTurn' }, t);
    // 模拟"刚被释放、人还在綠島（景观记录 2）上"
    const prisonLand = map.landscapes[1]!;
    expect(prisonLand.name).toBe('綠島');
    // ★ 真实的在押状态是"nodeId = 監獄格、x/y = 綠島"（关押那一刻就是这么写的）
    const gate = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.PRISON)!;
    const onIsland: GameState = {
      ...released,
      phase: 'turnStart',
      currentPlayer: 1,
      players: released.players.map((p, i) =>
        i === 1 ? { ...p, nodeId: gate.id, xpos: prisonLand.x, ypos: prisonLand.y } : p,
      ),
    };
    const walkedBack = reduce(onIsland, { type: 'startTurn' }, t);
    // 原版这一回合边走边把 x/y 改回監獄格；本引擎原子移动 ⇒ 在这一回合的收尾一次落定
    expect([walkedBack.players[1]!.xpos, walkedBack.players[1]!.ypos]).toEqual([
      gate.x,
      gate.y,
    ]);
    expect(walkedBack.players[1]!.nodeId).toBe(gate.id);
  });

  run('★★ 释放落点 = **关押格**（`type` 0x1f42 = 綠島节点 1），不是落点特殊格 12', () => {
    const { map, topo: t } = topo();
    // 真实地图上这两个概念是**不同的节点**：关押格 1 @(1752,1871)、落点格 12 @(1248,1583)
    const gate = map.nodes.find((n) => n.type === 0x1f42)!;
    const landing = map.nodes.find((n) => n.specialKind === SPECIAL_KIND.PRISON)!;
    expect(gate.id).toBe(1);
    expect(landing.id).toBe(12);
    // 关押 → 人在監獄（`send_to_prison` 的字面行为，见 rules/confinement.ts）
    const released = reduce(pendingRelease('inPrison', 'prisonOccupancy'), { type: 'endTurn' }, t);
    const prisonLand = map.landscapes[1]!;
    const confined: GameState = {
      ...released,
      phase: 'turnStart',
      currentPlayer: 1,
      players: released.players.map((p, i) =>
        i === 1 ? { ...p, nodeId: gate.id, xpos: prisonLand.x, ypos: prisonLand.y } : p,
      ),
    };
    const out = reduce(confined, { type: 'startTurn' }, t);
    // ★★ 可证伪：旧实现把释放落点当落点特殊格 12 ⇒ 下面两条都会红
    expect(out.players[1]!.nodeId).toBe(1);
    expect(out.players[1]!.nodeId).not.toBe(12);
    expect([out.players[1]!.xpos, out.players[1]!.ypos]).toEqual([gate.x, gate.y]);
    expect([out.players[1]!.xpos, out.players[1]!.ypos]).not.toEqual([landing.x, landing.y]);
    // 这一回合照旧是白丢的（不掷骰、清四个计数）
    expect(out.phase).toBe('turnEnd');
  });

  run('★ 「消失」（出國／綁架）**不**丢这一回合：释放函数 `0x40d4e5` 不置 0x10', () => {
    const { map } = topo();
    const s = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    const before: GameState = {
      ...s,
      phase: 'turnEnd',
      pendingNpcSlots: [],
      currentPlayer: 0,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, blocking: { ...p.blocking, disappearing: RELEASE_PENDING } } : p,
      ),
    };
    const after = reduce(before, { type: 'endTurn' }, t());
    expect(after.players[1]!.blocking.disappearing).toBe(0);
    expect(after.players[1]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(0);
    // 计数已归零 ⇒ 下一回合可以正常行动（不会被 skip）
    expect(after.players[1]!.whoPlays & WHO_PLAYS_SPECIAL_MASK).toBe(0);
  });

  run('★ 逐步核对回合数：入狱 3 天 = 白丢 4 个回合（原版 N 天 → N+1）—— 真实轮转', () => {
    const { map, topo: tp } = topo();
    const s = newGame({
      map,
      players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    });
    // ★ E-41：先前这里是合成迴圈（每轮硬写 `currentPlayer: 1` / `0`），「走回棋盘」
    //   那一回合的离场者对不上。现在由 `endTurn` 自己轮转，别人的回合只是不掷骰直接收尾。
    let st: GameState = {
      ...s,
      phase: 'turnEnd',
      pendingNpcSlots: [],
      currentPlayer: 0,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, nodeId: 1, blocking: { ...p.blocking, inPrison: 3 } } : p,
      ),
    };
    // 1 号每次轮到时记一笔：1 = 这一回合不掷骰；0 = 正常开局
    const missed: number[] = [];
    // 1 号每两次开局之间，别人开局了几次
    const othersBetween: number[] = [];
    let others = 0;
    for (let guard = 0; guard < 200 && !missed.includes(0); guard++) {
      st = reduce(st, { type: 'endTurn' }, tp);
      while ((st.pendingNpcSlots ?? []).length > 0) st = reduce(st, { type: 'npcStep' }, tp);
      expect(st.phase).toBe('turnStart');
      const started = reduce(st, { type: 'startTurn' }, tp);
      if (st.currentPlayer === 1) {
        missed.push(started.phase === 'turnEnd' ? 1 : 0);
        othersBetween.push(others);
        others = 0;
      } else {
        others++;
      }
      st = { ...started, phase: 'turnEnd', pending: null };
    }
    // T1:3→2、T2:2→1、T3:1→0x80、T4:0x80→释放（「走回棋盘」）、T5 自由
    expect(missed).toEqual([1, 1, 1, 1, 0]);
    // ★★ E-41：T4 → T5 之间**没有别人**行动（原版 `0x418f8e` 不推进游标）
    expect(othersBetween[4]).toBe(0);
    expect(othersBetween.slice(1, 4).every((n) => n > 0)).toBe(true);
    expect(st.players[1]!.blocking.inPrison).toBe(0);
  });
});
