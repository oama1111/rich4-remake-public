/*
 * 「轉盤還沒停，台詞就出來了」的**可證偽回歸**（試玩回報，2026-09-19）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 回報原文：「动画的顺序也有问题，有时候上一个台词还没说完下一个NPC已经开始行动了，
 *   比如触发商场付费转盘，盘子还没停下来NPC的台词都触发了」。
 * 這裡盯兩半：**台詞不能早於演出**、**下一個行動不能早於台詞**。
 *
 * ## 原版的順序（逐條讀 exe，見 `wheel-screen.ts` 檔頭）
 *
 * 設施收費那一段（`0x0041a370` 起）的順序是**呼叫順序**定死的 —— 因為那幾個被呼叫者
 * 全是**阻塞**的：
 *
 * | 步 | 做什麼 | VA |
 * |---|---|---|
 * | ① | 轉盤 `fcn_0044090e`：狀態機跑到 `ebx=6` 才 `ret`，返回值 = 盤上那個數 | 呼叫 0x0041a458；迴圈 0x0043fab4 `cmp ebx,6 / jl`；`ret` 0x0043fae3 |
 * | ② | 費用訊息框（0x5dc ms） | 0x0041a579 |
 * | ③ | 收費 `0x40df69`（錢真的轉手） | 0x0041a5c0 |
 * | ④ | **付款人的台詞**（事件 9/10/11） | 0x0041a71e `call 0x44f42d` |
 * | ⑤ | 進帳／小額損失等後續 | 0x0041a735 / 0x0041a7e0 |
 *
 * ⇒ 原版**必定**是「盤停下來 → 訊息框 → 付款人的台詞」。
 *   而 `_rich4_player_say`（VA 0x0044ef41）自己也是阻塞的：
 *   `push 0x3e8 / call fcn_004544f6`（VA 0x0041a71e 那一路進去的 0x0044f1a6）等 1000 ms
 *   （那個函式是「等消息或到點」的迴圈：0x00454520 起 `PeekMessage`，
 *   超時才 0x0045459e `cmp eax,ecx / jae` → 0x004545b1 返回）。
 *
 * 本引擎的台詞是 action 落地時就派生出來的（非同步），所以 `main.ts` 補了兩條：
 *   ① `queueSpeech()`：演出接管整屏時**先押著**那幾句（`deferredSpeech`）；
 *   ② `speechTick()`：演出收屏之後才把它們放上台；
 *   ③ `holdForActorWalk()`：**等台詞演完**才派下一步。
 *
 * ## 本文件盯三件**會分別變紅**的事
 *
 * 1. 演出期間照樣 tick 佇列（= 回報的 bug）→ 第一段就紅；
 * 2. 「押後」那條閘被刪掉／`speechTick` 把押著的台詞放上台的時機不對 → 第二段就紅；
 * 3. 「等台詞」那條閘被刪掉 → 第二段第二條就紅；
 * 4. 轉盤整趟短過一句台詞（改圈數／改每格毫秒，變成瞬停）→ 第三段就紅。
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

/** 只夠 `wheelScreen` 用的假環境（本文件不畫圖，canvas 不碰） */
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
    owner: 2, // 玩家 1 的（1 基）—— 收費的是當前玩家 0
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

/** 付款人那一句（事件 9/10/11 之一）—— 文本/金額不重要，這裡只要「有一句在演」 */
function payerLine(): SpeechBubble {
  return {
    player: 0,
    character: 0,
    event: 9,
    speaker: '阿土伯',
    // ★ W-50：`SpeechBubble` 多了 `expression`（原版 `player_say` 的第 2 個實參）。
    //   這一條只驗佇列語意，表情號不重要 ⇒ 照 `speech.ts` 的缺省填 0。
    expression: 0,
    lines: ['這是我應得的！'],
    voice: 1234,
    emoji: null,
    textAt: { x: 0xc8, y: 0x82 },
    emojiAt: { x: 0xf0, y: 0x82 },
    holdMs: SPEECH_HOLD_MS,
  };
}

// ============================================================
//  ① 佇列語意：演出期間**不 tick**，那一段不會被跳掉的時間順手收掉
// ============================================================

describe('★ 台詞佇列：演出期間不上台 → 收屏後仍演滿 SPEECH_HOLD_MS @source 0x0044f1a6', () => {
  it('★ 演出期間若照樣 tick，那一段會被「跳掉的時間」直接收掉（= 回報裡的 bug）', () => {
    const buggy = new SpeechQueue();
    buggy.push([payerLine()], 0);
    // 轉盤演了 1500 ms，佇列卻照樣逐幀收 —— 台詞在盤還在轉時就演完了
    expect(buggy.tick(1500)).toBe(true);
    expect(buggy.length).toBe(0);
  });

  it('★ 押後（演出期間一次都不 tick）→ 收屏那一刻才從頭數 1000 ms', () => {
    const q = new SpeechQueue();
    // 演出期間（t < 3000）：那幾句**還沒入隊**（`queueSpeech` 押在 `deferredSpeech`）
    expect(q.length).toBe(0);
    // 收屏那一拍（t = 3000）才入隊／開始數 —— 這就是押後的效果
    const shownAt = 3000;
    expect(q.push([payerLine()], shownAt)).toBe(1);
    expect(q.tick(shownAt + SPEECH_HOLD_MS - 1)).toBe(false);
    expect(q.length).toBe(1);
    expect(q.tick(shownAt + SPEECH_HOLD_MS)).toBe(true);
    expect(q.length).toBe(0);
  });
});

// ============================================================
//  ② 兩條閘真的在 `main.ts` 裡（且位置正確）
// ============================================================

/** 取 `function <name>(` 到它自己那一層的收尾 `}` 之間的文字（含行號） */
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

/** 從 `openAt` 那個 `{` 起取出整個大括號塊（配對到它自己的 `}`）*/
function braceBlock(text: string, openAt: number): string {
  expect(text[openAt]).toBe('{');
  let depth = 0;
  for (let i = openAt; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openAt, i + 1);
    }
  }
  throw new Error('大括號不配對');
}

function mainSource(): string | null {
  if (!existsSync(MAIN_SRC)) return null;
  return readFileSync(MAIN_SRC, 'utf8');
}

const runMain = mainSource() !== null ? it : it.skip;

describe('★ main.ts 的三條閘 @source 0x0041a458 / 0x0041a71e / 0x0044f1a6', () => {
  runMain('★ `queueSpeech`：演出在演就**押後**（不進佇列）', () => {
    const src = mainSource();
    if (src === null) return;
    const body = functionBody(src, 'queueSpeech').text;
    // W-51 起判據是**每一句自己的 `order`**：只有 `afterStage` 且台上忙才押後。
    // ★★ 死鎖自查的源碼面：押後決定**只**經過 `deferSpeech()`（它只對 `afterStage`
    //    返回 true）—— `beforeStage` 的句子於是**永不**進 `deferredSpeech`。
    expect(body).toContain('const busy = stageBusy(stageBusyFlags());');
    expect(body).toContain('if (deferSpeech(line.order, busy)) deferred.push(line.bubble);');
    expect(body).toContain('immediate.push(line.bubble);');
    // 立即的那幾句先上台（`speechQueue.push`），押後的才落在 `deferredSpeech`
    const pushAt = body.indexOf('speechQueue.push(immediate');
    const deferAt = body.indexOf('deferredSpeech = deferred;');
    expect(pushAt).toBeGreaterThanOrEqual(0);
    expect(deferAt).toBeGreaterThan(pushAt);
    // 兩支互斥：不可能同一句既押著又立刻上台（各走各的 `push`）
    expect(body).toContain('deferred.push(line.bubble)');
    expect(body).toContain('immediate.push(line.bubble)');
  });

  runMain('★ `speechTick`：演出在演 → 押後的**不上台**，但佇列照常推進（死鎖自查）', () => {
    const src = mainSource();
    if (src === null) return;
    const body = functionBody(src, 'speechTick').text;
    const guardOpen = body.indexOf('if (!stageBusy(stageBusyFlags())) {');
    expect(guardOpen).toBeGreaterThanOrEqual(0);
    const guard = braceBlock(body, body.indexOf('{', guardOpen));
    // 閘**裡面**才放行押後的那幾句（`deferredSpeech = null` → `speechQueue.push(held`）
    expect(guard).toContain('deferredSpeech = null;');
    expect(guard).toContain('speechQueue.push(held');
    // ★★ 但 `speechQueue.tick`（收尾）必須在閘的**外面** —— 佇列裡可能正躺著
    //    `beforeStage` 的句子，而影片正等它說完（`tickBoardFilm` 的起播閘）；
    //    兩邊都等就是死鎖（`stage-gate.test.ts` 有正反兩條用例）。
    expect(guard).not.toContain('speechQueue.tick(');
    expect(body.indexOf('speechQueue.tick(')).toBeGreaterThan(guardOpen + guard.length - 1);
  });

  runMain('★ `holdForActorWalk`：還有台詞（在演或押著）就不派下一步', () => {
    const src = mainSource();
    if (src === null) return;
    const body = functionBody(src, 'holdForActorWalk').text;
    // 閘要在**放行（最後那個 `return false`）之前**，否則等於沒有
    const gateAt = body.indexOf('speechQueue.length > 0 || deferredSpeech !== null');
    const releaseAt = body.lastIndexOf('return false');
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(gateAt).toBeLessThan(releaseAt);
    // 擋下時要 reschedule（不然兩個驅動從此不再回頭）
    expect(body.slice(gateAt, releaseAt)).toContain('reschedule()');
  });

  runMain('★ 演出期間續幀的條件也要認押後的那幾句（否則押著的台詞永不上台）', () => {
    const src = mainSource();
    if (src === null) return;
    // 幀尾只認 `speechQueue.length`：押後的那幾句不在佇列裡，演出收屏那一拍
    // 就沒人要下一幀，`speechTick` 也就不會再被調到 —— 台詞卡死
    const continued = /speechQueue\.length > 0 \|\|\s*\n?\s*deferredSpeech !== null/.test(src);
    expect(continued).toBe(true);
  });
});

// ============================================================
//  ③ 整趟轉盤：押後的台詞在盤停下來之前一格都不上台
// ============================================================

describe('★ 轉盤整趟不能被台詞打斷 @source 0x0043fab4 `cmp ebx,6 / jl`', () => {
  runMap('★ 一次 settle 起播後：盤自己走完，押著的那一句一步都不走', () => {
    resetWheelScreen();
    const s = scene();
    if (s === null) return;
    /** 押後的台詞（`queueSpeech` 裡那一支的效果）—— 演出期間不在佇列裡 */
    const deferred: SpeechBubble[] = [payerLine()];
    const q = new SpeechQueue();
    const env = makeEnv(s.after, s.topo);
    // 同一拍：轉盤起播（`wheelScreen.event`）
    wheelScreen.event!(s.before, s.after, env);
    expect(wheelScreen.active(env)).toBe(true);

    // ── 演出期間：`speechTick` 直接 return ⇒ 押著的不入隊、佇列也不 tick ──
    let guard = 0;
    while (!wheelScreenState().landed && guard++ < 1000) {
      env.now += 1000; // 大幅跳時間：若有人在演出期間就放上台，早就演完了
      wheelScreen.tick!(env);
      expect(q.length).toBe(0); // ★ 盤還在轉 → 一句台詞都沒有（回報的那一條）
      expect(deferred.length).toBe(1);
    }
    expect(wheelScreenState().landed).toBe(true);

    // 停完 `WHEEL_HOLD_MS` 才關屏 —— 這才是原版「盤停下來」的時刻
    env.now += 10_000;
    wheelScreen.tick!(env);
    expect(wheelScreen.active(env)).toBe(false);

    // ── 收屏之後才輪到台詞：整段 1000 ms 一格不少 ──
    const shownAt = env.now;
    expect(q.push(deferred.splice(0), shownAt)).toBe(1);
    expect(deferred.length).toBe(0);
    expect(q.tick(shownAt + SPEECH_HOLD_MS - 1)).toBe(false);
    expect(q.length).toBe(1);
    expect(q.tick(shownAt + SPEECH_HOLD_MS)).toBe(true);
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

  runMap('★ 時序端到端：有押後閘 → 台詞上台不早於「盤停下來」；拆掉那道閘就早於', () => {
    resetWheelScreen();
    const s = scene();
    if (s === null) return;
    const env = makeEnv(s.after, s.topo);
    wheelScreen.event!(s.before, s.after, env);

    /** 同一段時間軸跑一次：`gate` = `main.ts` 的 `queueSpeech` 有沒有那道「演出在演就押後」 */
    const run = (gate: boolean): { landedAt: number; firstShownAt: number } => {
      resetWheelScreen();
      const e = makeEnv(s.after, s.topo);
      e.now = 0;
      wheelScreen.event!(s.before, s.after, e);
      const q = new SpeechQueue();
      const held: SpeechBubble[] = [payerLine()];
      let landedAt = -1;
      let firstShownAt = -1;
      for (let i = 0; i < 4000; i++) {
        e.now += 20; // 一個渲染週期
        wheelScreen.tick!(e);
        if (landedAt < 0 && wheelScreenState().landed) landedAt = e.now;
        // 演出期間還占著屏 —— `main.ts` 的 `speechTick` 在這一拍直接 return
        const playing = wheelScreen.active(e);
        if (!playing) {
          if (gate) {
            if (held.length > 0) q.push(held.splice(0), e.now);
          } else if (q.length === 0) {
            q.push([payerLine()], 0); // 沒有那道閘：台詞在 action 落地（t=0）就上台
          }
          q.tick(e.now);
          if (firstShownAt < 0 && q.current() !== null) firstShownAt = e.now;
        }
        if (!playing && q.length === 0 && firstShownAt >= 0) break;
      }
      return { landedAt, firstShownAt };
    };

    const gated = run(true);
    const ungated = run(false);
    // ★ 有閘：台詞一定**不早於**盤停下來（回報的那一條）
    expect(gated.landedAt).toBeGreaterThan(0);
    expect(gated.firstShownAt).toBeGreaterThanOrEqual(gated.landedAt);
    // ★ 沒有那道閘：台詞在盤還在轉的時候就在台上 —— 這正是回報的現象
    expect(ungated.firstShownAt).toBeLessThan(ungated.landedAt);
    resetWheelScreen();
  });
});
