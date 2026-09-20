/*
 * 「轉盤還沒停，台詞就出來了」的**可證偽回歸**（試玩回報，2026-09-19）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回報原文：「盘子还没停下来 NPC 的台词都触发了」。
 *
 * ## 原版的順序（逐條讀 exe，見 `wheel-screen.ts` 檔頭）
 *
 * 設施收費那一段（`0x0041a370` 起）的順序是**呼叫順序**定死的：
 *
 * | 步 | 做什麼 | VA |
 * |---|---|---|
 * | ① | 轉盤 `fcn_0044090e` —— **阻塞**：狀態機跑到 `ebx=6` 才 `ret`，返回值 = 盤上那個數 | 0x0041a458（呼叫）/ 0x0043fab4→0x0043fae3（迴圈與 `ret`） |
 * | ② | 費用訊息框（0x5dc ms） | 0x0041a579 |
 * | ③ | 收費 `0x40df69`（錢真的轉手） | 0x0041a5c0 |
 * | ④ | 付款人的台詞（事件 9/10/11） | 0x0041a71e `call 0x44f42d` |
 *
 * ⇒ 原版**必定**是「盤停下來 → 訊息框 → 付款人的台詞」。
 *   本引擎的台詞是 action 落地時就進了 `SpeechQueue`（非同步），所以
 *   `main.ts` 用兩條閘把它接回來：
 *   ① `speechTick()` 在**演出接管整屏期間整隊凍結**；
 *   ② `holdForActorWalk()` 等佇列排空才派下一步。
 *
 * ## 本文件盯三件**會分別變紅**的事
 *
 * 1. **台詞在盤停下來之前一格都不許走** —— 凍結那條閘若被刪掉／挪到
 *    `speechQueue.tick()` 之後，第三段就紅（佇列會在轉盤期間被收掉）；
 * 2. **「等台詞」那條閘若被刪掉**，第二段就紅 —— 那正是回報裡
 *    「下一個 NPC 已經開始行動」那一半；
 * 3. **轉盤本身不能被台詞打斷**：整趟的時長必須真的長過一句台詞的
 *    `SPEECH_HOLD_MS`，否則「先演完再說話」這件事無從測起 —— 若誰把
 *    `wheelSpinSteps` 改成 0 圈／0 格（變成瞬停），第四段就紅。
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FACILITY_TYPE,
  makeFacility,
  newGame,
  parseMap,
  reduce,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import type { LoadedFlic, Sprite } from './assets.ts';
import { SPEECH_HOLD_MS, SpeechQueue, type SpeechBubble } from './speech-bubble.ts';
import { wheelScreen, resetWheelScreen, wheelScreenState, wheelSpinSteps } from './wheel-screen.ts';
import type { UiScreenEnv } from './ui-screen.ts';

const MAP = (process.env.RICH4_WORKSPACE ?? '') + '/extracted/map/0001.bin';
const runMap = existsSync(MAP) ? it : it.skip;

// ============================================================
//  素材 / 環境（與 wheel-screen.test.ts 同一套最小替身）
// ============================================================

function fakeSprite(archive: string, resource: number, index: number): Sprite | null {
  return {
    bitmap: { archive, resource, index } as unknown as ImageBitmap,
    width: 164,
    height: 164,
    anchorX: 0,
    anchorY: 0,
  };
}

/** 只夠 `wheelScreen` 用的假環境：canvas 一個都不要真的（本文件不畫圖） */
function makeEnv(state: GameState, topo: MapTopology): UiScreenEnv & { now: number; renders: number } {
  const env = {
    screen: 'game',
    state,
    topo,
    map: {} as UiScreenEnv['map'],
    now: 0,
    stage: {} as CanvasRenderingContext2D,
    sprite: fakeSprite,
    flic: () => null as LoadedFlic | null,
    dispatch: () => undefined,
    requestRender: () => {
      env.renders += 1;
    },
    log: () => undefined,
    playEffect: () => undefined,
    stopEffect: () => undefined,
    renders: 0,
  };
  return env as unknown as UiScreenEnv & { now: number; renders: number };
}

// ============================================================
//  舞台：玩家 0 站在**別人的**旅館上（收費那一路）
// ============================================================

interface Scene {
  before: GameState;
  after: GameState;
  topo: MapTopology;
}

let cached: Scene | null | undefined;

function scene(): Scene | null {
  if (cached !== undefined) return cached;
  if (!existsSync(MAP)) {
    cached = null;
    return cached;
  }
  const map = parseMap(new Uint8Array(readFileSync(MAP)));
  const idx = map.nodes.findIndex((n) => n.type === 0x1f45 || n.type === 0x1f46);
  if (idx < 0) {
    cached = null;
    return cached;
  }
  const node = map.nodes[idx]!;
  const fac = makeFacility({
    id: idx,
    type: FACILITY_TYPE.hotel,
    owner: 2, // 玩家 1 的（1 基），收費的是玩家 0
    level: 1,
    priceStatus: 0,
    rateByLevel: [100, 200, 400, 800, 1600, 3200],
  });
  const base = newGame({
    map,
    players: [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const })),
    seed: 7,
  });
  const facilityOwner = [...base.facilityOwner];
  const facilityLevel = [...base.facilityLevel];
  const facilityType = [...base.facilityType];
  facilityOwner[idx] = fac.owner;
  facilityLevel[idx] = fac.level;
  facilityType[idx] = fac.type;
  const before: GameState = {
    ...base,
    players: base.players.map((p, i) => ({
      ...p,
      nodeId: i === 0 ? node.id : p.nodeId,
      cash: 100_000,
      moneyInBank: 0,
    })),
    facilityOwner,
    facilityLevel,
    facilityType,
    phase: 'settling',
  };
  const topo: MapTopology = { nodes: map.nodes, lands: map.lands, facilities: [fac] };
  cached = { before, after: reduce(before, { type: 'settle' }, topo), topo };
  return cached;
}

/** 一句台词（金額/文本不重要，這裡只要「有東西在演」與它的時長） */
function line(): SpeechBubble {
  return {
    player: 0,
    character: 0,
    event: 9,
    speaker: '阿土伯',
    lines: ['這是我應得的！'],
    voice: 1234,
    emoji: null,
    textAt: { x: 0xc8, y: 0x82 },
    emojiAt: { x: 0xf0, y: 0x82 },
    holdMs: SPEECH_HOLD_MS,
  };
}

// ============================================================
//  ① 佇列語意：凍結期間「一步都不走」，解凍後**整段** 1000 ms 才收
// ============================================================

describe('★ 台詞佇列：演出期間凍結 → 解凍後仍演滿 SPEECH_HOLD_MS', () => {
  it('★ 凍結期間不 tick：那一段不會被跳掉的時間順手收掉', () => {
    const q = new SpeechQueue();
    expect(q.push([line()], 0)).toBe(1);

    // ── 演出期間（t < 3000）：`main.ts` 的 `speechTick` 直接 return ⇒ 一次都不 tick。
    //    ★ 這正是關鍵：佇列裡沒有「凍結」旗標，時間軸是靠**不呼叫 tick** 凍住的，
    //      所以凍結期間流逝的 3000 ms 不算進這一段的 1000 ms。

    // ── 反面對照：若有人在演出期間照樣 tick（= 回報裡的 bug），
    //    t = 1500 就會把這一段收掉 —— 盤還在轉，台詞已經演完了：
    const buggy = new SpeechQueue();
    buggy.push([line()], 0);
    expect(buggy.tick(1500)).toBe(true);
    expect(buggy.length).toBe(0);

    // ── 真正的行為：解凍那一刻（t = 3000）佇列**原樣**，之後才重新數 1000 ms ──
    expect(q.tick(3000)).toBe(false);
    expect(q.length).toBe(1);
    expect(q.tick(3000 + SPEECH_HOLD_MS - 1)).toBe(false);
    expect(q.length).toBe(1);
    expect(q.tick(3000 + SPEECH_HOLD_MS)).toBe(true);
    expect(q.length).toBe(0);
  });
});

// ============================================================
//  ② 兩條閘真的在 `main.ts` 裡（且位置正確）
// ============================================================

/** 取 `function <name>(` 到它自己那一層的收尾 `}` 之間的行（含行號） */
function functionBody(src: string, name: string): { line: number; text: string } {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.includes(`function ${name}(`));
  if (start < 0) throw new Error(`main.ts 裡找不到 function ${name}`);
  let depth = 0;
  let started = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === '{') {
        depth += 1;
        started = true;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    if (started && depth === 0) {
      return { line: start + 1, text: lines.slice(start, i + 1).join('\n') };
    }
  }
  throw new Error(`function ${name} 的收尾大括號找不到`);
}

const MAIN_SRC = fileURLToPath(new URL('./main.ts', import.meta.url));

function mainSource(): string | null {
  if (!existsSync(MAIN_SRC)) return null;
  return readFileSync(MAIN_SRC, 'utf8');
}

const hasMain = mainSource() !== null && existsSync(MAP);
const runMain = hasMain ? it : it.skip;

describe('★ main.ts 的兩條閘 @source 0x0044f1a6（阻塞 0x3e8）+ 0x0041a458（轉盤先演）', () => {
  runMain('★ `holdForActorWalk` 必須等台詞佇列排空才放行（回報的「下一個 NPC 已經開始行動」）', () => {
    const src = mainSource();
    if (src === null) return;
    const body = functionBody(src, 'holdForActorWalk').text;
    // 閘要在**return false（放行）之前** —— 否則等於沒有
    const gateAt = body.indexOf('speechQueue.length > 0');
    const releaseAt = body.lastIndexOf('return false');
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(gateAt).toBeLessThan(releaseAt);
    // 而且擋下時要 reschedule（不然兩個驅動從此不再回頭）
    expect(body.slice(gateAt, releaseAt)).toContain('reschedule()');
  });

  runMain('★ `speechTick` 必須在 `speechQueue.tick()` **之前**就因演出而 return（回報的「盤還沒停台詞就出來」）', () => {
    const src = mainSource();
    if (src === null) return;
    const body = functionBody(src, 'speechTick').text;
    const freezeAt = body.indexOf('if (blockingPresentation()) return;');
    const tickAt = body.indexOf('speechQueue.tick(');
    expect(freezeAt).toBeGreaterThanOrEqual(0);
    expect(tickAt).toBeGreaterThanOrEqual(0);
    // ★ 順序是本條的全部：凍結若挪到 tick 之後，佇列在轉盤期間就被收了
    expect(freezeAt).toBeLessThan(tickAt);
  });
});

// ============================================================
//  ③ 整趟轉盤：台詞凍結期間「站著不動」，盤自己走完
// ============================================================

describe('★ 轉盤整趟不能被台詞打斷 @source 0x0043fab4 cmp ebx,6 / jl', () => {
  runMap('★ 一次 settle 起播後，凍結的台詞在盤停下來之前一格都不走', () => {
    resetWheelScreen();
    const s = scene();
    if (s === null) return;
    const q = new SpeechQueue();
    const env = makeEnv(s.after, s.topo);
    // action 落地那一刻：台詞排進佇列（`main.ts` 的 `playSoundFor`）
    q.push([line()], env.now);
    // 同一拍：轉盤起播（`wheelScreen.event`）
    wheelScreen.event!(s.before, s.after, env);
    expect(wheelScreen.active(env)).toBe(true);

    // ── 演出期間：`speechTick` 被凍結 ⇒ 一步都不 tick ──
    let guard = 0;
    while (!wheelScreenState().landed && guard++ < 1000) {
      env.now += 1000; // 大幅跳時間：佇列若沒凍結，早就被收了
      wheelScreen.tick!(env);
      expect(q.length).toBe(1); // ★ 盤還在轉 → 台詞還沒演（回報的那一條）
    }
    expect(wheelScreenState().landed).toBe(true);

    // 停完 WHEEL_HOLD_MS 關屏 → 這才是原版「盤停下來」的時刻
    env.now += 1000; // WHEEL_HOLD_MS 只有 1440 ms，這裡一步跨過去
    wheelScreen.tick!(env);
    expect(wheelScreen.active(env)).toBe(false);

    // ── 解凍：現在才輪到台詞，而且整段 1000 ms 一格不少 ──
    const thaw = env.now;
    expect(q.tick(thaw + SPEECH_HOLD_MS - 1)).toBe(false);
    expect(q.length).toBe(1);
    expect(q.tick(thaw + SPEECH_HOLD_MS)).toBe(true);
    expect(q.length).toBe(0);
    resetWheelScreen();
  });

  it('★ 整趟時長真的長過一句台詞（否則「先演完再說話」無從測起）', () => {
    // 起點 → 落點：至少一圈，且每一格最少 0x24 ms（@source 0x0043faab `cmp esi,0x24 / jb`）
    const steps = wheelSpinSteps(0, 1);
    expect(steps).toBeGreaterThan(0);
    expect(steps * 36 + 1440).toBeGreaterThan(SPEECH_HOLD_MS);
    // 這一條是「轉盤不會被打斷」的下界：改成 0 圈 / 0 格（瞬停）就紅
    expect(steps).toBeGreaterThanOrEqual(12);
  });
});
