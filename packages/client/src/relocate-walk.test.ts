/*
 * 審計 #17（住進旅館那一段位移 + 住滿走出來）/ #21（走回棋盤那一回合的換人停頓）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 原版（逐條讀過 rich4.exe）：
 * - 住店 `0x41a85e call 0x40d5a5` 支 A：`+0x15 |= 0x20`、朝向 = 設施 − 自己、`call 0x40dd1f`（剩 1 格、走姿）；
 *   走路例程 `0x40c05c` 的 `0x20` 支從旅館格走到設施坐標（`0x40c0ed..0x40c127`），半程清掉 0x20（`0x0040c3dc`）
 *   ⇒ 棋子繪製 `0x0040869a` 從此不畫 —— 人走進旅館**不見了**。
 * - 住滿：釋放 `0x40d6be` 置 0x10、朝向 = 格 − 設施；下一回合 `0x40c972 call 0x40dd1f` 走回來，
 *   半程清四個阻礙計數（`0x0040c3cf`）⇒ 之前不畫、之後才露面 —— 人從建築裡**走出來**（監獄 / 醫院同一段機器碼）。
 * - 兩種走完都是 `0x0040d92b` 倒數 5、再 `0x00418ead` 倒數 3，才 `0x418ebd` 換人（跳表 `0x40d7b4`）。
 *
 * 聯機：這幾個結論全是 before/after 兩份局面的純函數 —— 旁觀端重放同一條 action 得到同一份局面
 * （指紋一致由 `packages/server/src/relocate-walk-mp.test.ts` 釘住），於是演出與停頓逐位相同。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FACILITY_TYPE,
  FACILITY_TYPE_MIN,
  RELEASE_PENDING,
  WHO_PLAYS_RELOCATED,
  WHO_PLAYS_RETURN_TO_BOARD,
  directionOf,
  makeFacility,
  makeGameState,
  makeNode,
  makePlayer,
  reduce,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import { RELOCATE_WALK_PAUSE_TICKS, relocateWalkPauseTicks, turnEndPauseTicks } from './landing-pause.ts';
import { relocateToggleTick, relocateVisible, tweenTickCount, walkTweenFor } from './tween.ts';
import { BoardRenderer } from './render.ts';
import type { SpriteCache } from './assets.ts';

// ── 一個設施格的小圖（與 core `facility-rules.test.ts` 同一套）──
const FAC_ID = 1;
const FAC = { x: 700, y: 400 };
const topo: MapTopology = {
  nodes: [
    makeNode({ id: 1, adjacent: [2], x: 500, y: 500 }),
    makeNode({ id: 2, adjacent: [1, 3], x: 600, y: 520, type: FACILITY_TYPE_MIN + FAC_ID, ref: { kind: 'facility', index: FAC_ID } }),
    makeNode({ id: 3, adjacent: [2], x: 700, y: 540 }),
  ],
  lands: [],
  facilities: [
    makeFacility({ id: FAC_ID, ...FAC, landPrice: 3000, housePrice: 1500, rateByLevel: [1500, 1000, 2000, 4000, 8000, 16000] }),
  ],
};
const nodeAt = (id: number) => topo.nodes[id - 1];
const HOTEL_NODE = topo.nodes[1]!;

/** 0 號站在別人的旅館格上、等落點結算（`who` = 1 真人 / 2 電腦）*/
function atHotel(who: number): GameState {
  const base = makeGameState({
    players: [0, 1].map((i) =>
      makePlayer({
        index: i,
        nodeId: i === 0 ? 2 : 1,
        xpos: i === 0 ? HOTEL_NODE.x : 500,
        ypos: i === 0 ? HOTEL_NODE.y : 500,
        cash: 100_000,
        moneyInBank: 0,
        whoPlays: who,
      }),
    ),
    phase: 'settling',
    priceIndex: 1,
  });
  const owner = [...base.facilityOwner];
  const lv = [...base.facilityLevel];
  const ty = [...base.facilityType];
  owner[FAC_ID] = 2;
  lv[FAC_ID] = 1;
  ty[FAC_ID] = FACILITY_TYPE.hotel;
  return { ...base, facilityOwner: owner, facilityLevel: lv, facilityType: ty };
}

/** 住店 → 住滿釋放 → 「走回棋盤」那一回合的 before / after */
function walkOut(checkedIn: GameState): { before: GameState; after: GameState } {
  const ready: GameState = {
    ...checkedIn,
    phase: 'turnEnd',
    currentPlayer: 1,
    players: checkedIn.players.map((p, i) =>
      i === 0 ? { ...p, whoPlays: p.whoPlays & ~WHO_PLAYS_RELOCATED, blocking: { ...p.blocking, inHotel: RELEASE_PENDING } } : p,
    ),
  };
  // 換到 0 號的那一次 endTurn 給他走一天：0x80 ⇒ 釋放 + 置 0x10
  const flagged = reduce(ready, { type: 'endTurn' }, topo);
  const before: GameState = { ...flagged, phase: 'turnStart', currentPlayer: 0 };
  return { before, after: reduce(before, { type: 'startTurn' }, topo) };
}

describe('★ 半程換顯隱 @source 0x0040c313 / 0x0040c3ba / 0x0040c3cf / 0x0040c3dc', () => {
  it('第一次「0 < 剩餘 < N>>1」的那一拍 = N − (N>>1) + 1；太短（N ≤ 3）整趟不換', () => {
    expect(relocateToggleTick(11)).toBe(7); // 醫院 11 拍：剩 4 < 5
    expect(relocateToggleTick(13)).toBe(8); // 監獄 13 拍：剩 5 < 6
    expect(relocateToggleTick(12)).toBe(7); // 剩 5 < 6
    expect(relocateToggleTick(4)).toBe(3); // 剩 1 < 2
    for (const n of [1, 2, 3]) expect(relocateToggleTick(n)).toBeNull(); // 末拍吸附不查半程（`0x0040c34a jle`）
  });

  it('走進去：過半之前畫、之後隱（含走完）；走出來反過來', () => {
    const n = 12;
    for (let k = 1; k <= n + 3; k++) {
      expect(relocateVisible('enter', n, k), `enter k=${k}`).toBe(k < 7);
      expect(relocateVisible('emerge', n, k), `emerge k=${k}`).toBe(k >= 7);
    }
    // 拍數太少：走進去一直畫、走出來一直不畫（原版半程那一支根本沒跑到）
    expect(relocateVisible('enter', 3, 9)).toBe(true);
    expect(relocateVisible('emerge', 3, 1)).toBe(false);
  });
});

describe('★★ 審計 #17：住進旅館那一趟（真跑 core 的落點結算）', () => {
  for (const who of [1, 2]) {
    it(`${who === 1 ? '真人' : '電腦'}：起「走進去」補間 —— 旅館格 → 設施坐標、特殊支、朝向 = 設施 − 自己`, () => {
      const before = atHotel(who);
      const after = reduce(before, { type: 'settle' }, topo);
      expect(after.players[0]!.whoPlays & WHO_PLAYS_RELOCATED).toBe(WHO_PLAYS_RELOCATED);
      const t = walkTweenFor('settle', before, after, nodeAt);
      expect(t).toEqual({
        player: 0,
        from: { x: HOTEL_NODE.x, y: HOTEL_NODE.y },
        to: FAC,
        special: true,
        relocate: { kind: 'enter', facing: directionOf(FAC.x - HOTEL_NODE.x, FAC.y - HOTEL_NODE.y) },
      });
      // 8 世界單位 / 拍（`0x0040c27a`），與交通方式無關
      expect(tweenTickCount(FAC.x - HOTEL_NODE.x, FAC.y - HOTEL_NODE.y, 2, true)).toBe(
        Math.trunc(Math.hypot(FAC.x - HOTEL_NODE.x, FAC.y - HOTEL_NODE.y) * 0.125),
      );
      // ★ 走完之後 5 + 3 tick 才換人（`0x0040d92b` 覆蓋落點例程返回的 0x88）
      expect(after.phase).toBe('turnEnd');
      expect(turnEndPauseTicks(before, after, topo)).toBe(RELOCATE_WALK_PAUSE_TICKS);
      expect(RELOCATE_WALK_PAUSE_TICKS).toBe(8);
    });
  }

  it('反例：付錢的不是當前玩家（支 B 瞬移）/ 沒有位移 ⇒ 不起', () => {
    const before = atHotel(2);
    const after = reduce(before, { type: 'settle' }, topo);
    // 把 0x20 挪到 1 號身上：當前玩家（0 號）身上沒有新出現的 0x20
    const other: GameState = {
      ...after,
      players: after.players.map((p, i) =>
        i === 0 ? { ...p, whoPlays: before.players[0]!.whoPlays } : { ...p, whoPlays: p.whoPlays | WHO_PLAYS_RELOCATED },
      ),
    };
    expect(walkTweenFor('settle', before, other, nodeAt)).toBeNull();
    expect(relocateWalkPauseTicks(before, other)).toBe(0);
    const still: GameState = {
      ...after,
      players: after.players.map((p, i) => (i === 0 ? { ...p, xpos: HOTEL_NODE.x, ypos: HOTEL_NODE.y } : p)),
    };
    expect(walkTweenFor('settle', before, still, nodeAt)).toBeNull();
  });
});

describe('★★ 審計 #17 / #21：住滿走出來 ——「走回棋盤」那一回合', () => {
  it('起「走出來」補間：設施坐標 → 旅館格，朝向 = 格 − 設施（`0x40d6be` 的 `0x0040d70f`）', () => {
    const { before, after } = walkOut(reduce(atHotel(2), { type: 'settle' }, topo));
    expect(before.players[0]!.whoPlays & WHO_PLAYS_RETURN_TO_BOARD).toBe(WHO_PLAYS_RETURN_TO_BOARD);
    expect([before.players[0]!.xpos, before.players[0]!.ypos]).toEqual([FAC.x, FAC.y]);
    const t = walkTweenFor('startTurn', before, after, nodeAt);
    expect(t).toEqual({
      player: 0,
      from: FAC,
      to: { x: HOTEL_NODE.x, y: HOTEL_NODE.y },
      special: true,
      relocate: { kind: 'emerge', facing: directionOf(HOTEL_NODE.x - FAC.x, HOTEL_NODE.y - FAC.y) },
    });
  });

  it('★ #21：走回棋盤那一回合，走完再停 5 + 3 = 8 tick（先前是 0）', () => {
    const { before, after } = walkOut(reduce(atHotel(2), { type: 'settle' }, topo));
    expect(after.phase).toBe('turnEnd');
    expect(turnEndPauseTicks(before, after, topo)).toBe(8);
    // 監獄 / 醫院同一支（判據只看 0x10，與設施種類無關）
    const jailed = (ph: string, who: number) =>
      ({ phase: ph, currentPlayer: 0, players: [{ nodeId: 3, whoPlays: who, blocking: {} }] }) as unknown as GameState;
    expect(relocateWalkPauseTicks(jailed('turnStart', 1 | WHO_PLAYS_RETURN_TO_BOARD), jailed('turnEnd', 1 | WHO_PLAYS_RETURN_TO_BOARD))).toBe(8);
    // 普通被擋（沒帶 0x10）仍是 0x83 那一檔，不歸這裡
    expect(relocateWalkPauseTicks(jailed('turnStart', 1), jailed('turnEnd', 1))).toBe(0);
  });
});

describe('★ 渲染器：顯隱 / 站位 / 朝向', () => {
  const renderer = (): BoardRenderer =>
    new BoardRenderer({} as CanvasRenderingContext2D, { addEvictListener: () => {} } as unknown as SpriteCache);
  const guest = (whoPlays: number, xpos = FAC.x, ypos = FAC.y) => ({ index: 0, whoPlays, nodeId: 2, xpos, ypos });

  it('走進去：前半程畫、過半隱；走完之後只要 core 還掛著 0x20 就一直隱，清掉後交回 `confinedPlayerDrawn`', () => {
    const r = renderer();
    const dx = FAC.x - HOTEL_NODE.x;
    const dy = FAC.y - HOTEL_NODE.y;
    const n = tweenTickCount(dx, dy, 0, true);
    const cut = relocateToggleTick(n)!;
    r.startWalk(0, HOTEL_NODE, FAC, 0, true, 40, 0, { kind: 'enter', facing: 3 });
    const p = guest(1 | WHO_PLAYS_RELOCATED);
    expect(r.relocateDrawn(p, HOTEL_NODE, 0)).toBe(true);
    expect(r.relocateDrawn(p, HOTEL_NODE, (cut - 2) * 40)).toBe(true);
    expect(r.relocateDrawn(p, HOTEL_NODE, (cut - 1) * 40)).toBe(false);
    expect(r.relocateDrawn(p, HOTEL_NODE, n * 40 + 999)).toBe(false); // 走完、0x20 還在
    expect(r.relocateFacing(p, 10)).toBe(3);
    expect(r.relocateDrawn(guest(1), HOTEL_NODE, n * 40 + 999)).toBeNull(); // endTurn 清了 0x20
    // 下一位起步之後，這一位仍按「已走進去」處理（0x20 還在的那段空檔）
    const r2 = renderer();
    r2.startWalk(0, HOTEL_NODE, FAC, 0, true, 40, 0, { kind: 'enter', facing: 3 });
    r2.startWalk(1, { x: 0, y: 0 }, { x: 80, y: 0 }, 0, false, 40, n * 40 + 10);
    expect(r2.relocateDrawn(p, HOTEL_NODE, n * 40 + 20)).toBe(false);
  });

  it('走出來：起步之前（0x10 掛著、還在設施坐標）不畫；前半程不畫、過半露面；朝向保持到 0x10 被清', () => {
    const r = renderer();
    const waiting = guest(1 | WHO_PLAYS_RETURN_TO_BOARD);
    expect(r.relocateDrawn(waiting, HOTEL_NODE, 0)).toBe(false);
    const n = tweenTickCount(HOTEL_NODE.x - FAC.x, HOTEL_NODE.y - FAC.y, 0, true);
    const cut = relocateToggleTick(n)!;
    r.startWalk(0, FAC, HOTEL_NODE, 0, true, 40, 1000, { kind: 'emerge', facing: 7 });
    const walking = guest(1 | WHO_PLAYS_RETURN_TO_BOARD, HOTEL_NODE.x, HOTEL_NODE.y); // core 已回填所在格
    expect(r.relocateDrawn(walking, HOTEL_NODE, 1000)).toBe(false);
    expect(r.relocateDrawn(walking, HOTEL_NODE, 1000 + (cut - 1) * 40)).toBe(true);
    expect(r.relocateDrawn(walking, HOTEL_NODE, 1000 + n * 40 + 50)).toBeNull(); // 走完照常
    expect(r.relocateFacing(walking, 1000 + n * 40 + 50)).toBe(7); // 停頓那 8 tick 仍朝外
    expect(r.relocateFacing(guest(1, HOTEL_NODE.x, HOTEL_NODE.y), 1000 + n * 40 + 50)).toBeNull();
  });

  it('等著走進去（parked）：站在旅館格上照畫，不被「走出來之前不畫」那條誤傷', () => {
    const r = renderer();
    r.parkPlayer(0, HOTEL_NODE);
    expect(r.relocateDrawn(guest(1 | WHO_PLAYS_RELOCATED), HOTEL_NODE, 0)).toBeNull();
    r.startWalk(0, HOTEL_NODE, FAC, 0, true, 40, 0, { kind: 'enter', facing: 3 });
    expect(r.relocateDrawn(guest(1 | WHO_PLAYS_RELOCATED), HOTEL_NODE, 0)).toBe(true);
  });
});

describe('★ main.ts 接線（源碼釘子）', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const hold = src.slice(src.indexOf('function holdForActorWalkReason('), src.indexOf('// ★★ 还有台词在演'));
  const tick = src.slice(src.indexOf('function tickPendingRelocateWalk('), src.indexOf('function tickPendingRelocateWalk(') + 900);

  it('走進去先原地站著，等台上全空了才起步；回合驅動 / 聯機收件箱單獨等它（不進 stageBusy ⇒ 不與住宿台詞互等）', () => {
    expect(src).toContain("if (t.relocate?.kind === 'enter') {");
    expect(src).toContain('renderer.parkPlayer(t.player, t.from);');
    expect(hold).toContain("if (pendingRelocateWalk !== null) {\n    return 'relocateWalk';");
    for (const gate of ['speechQueue.length > 0', 'heldSpeech.length > 0', 'activeUiScreen() !== null', 'stageBusy(stageBusyFlags())']) {
      expect(tick, gate).toContain(gate);
    }
    expect(src).toContain("if (screen === 'game') tickPendingRelocateWalk();");
    // 死鎖看門狗看得見它、第二級直接起步
    expect(src).toContain('pendingRelocateWalk !== null ||\n    (godAscend !== null && godAscend.start === null)');
    // `stageBusyFlags` 裡沒有它（否則押後的住宿台詞永遠等它）
    const flags = src.slice(src.indexOf('function stageBusyFlags('), src.indexOf('function holdForActorWalk('));
    expect(flags).not.toContain('pendingRelocateWalk');
  });

  it('電腦那條 reduce 直路也問（住店出在落點結算，不在 startTurn）', () => {
    expect(src).toContain("if (action.type !== 'step' && state !== before) tweenStepIfMoved(action, before);");
  });
});
