/*
 * 旅館 / 購物中心轉盤的版面、幀序與「從狀態 diff 反推這次轉盤」
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 坐標與判據全部照彙編抄（VA 見 `wheel-screen.ts` 的註釋），把最容易寫錯的幾條釘住：
 *   圓盤素材是 `(轉盤 & 3) + 0x44`、第 `槽` 格畫**預轉好的圖 `槽 + 2`**；
 *   圓盤 (220,320)、天使 (265,230)、氣泡 (220,140)；
 *   起點是 `rand() % 12`（藏在 `before.rngState` 的第一次 rand 裡）、
 *   落點是「起點之後第一個非空格」—— 與 core 的 `spinWheel()` 是同一條；
 *   「動畫過程」關掉時只有落點那一幀。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  FACILITY_TYPE,
  WHEEL,
  WHEEL_BLANK,
  WHEEL_SLOTS,
  WHEEL_TABLE,
  WatcomRng,
  facilityIndexOf,
  makeFacility,
  newGame,
  parseMap,
  reduce,
  spinWheel,
  type FacilityInfo,
  type GameState,
  type MapTopology,
} from '@rich4/core';
import type { Sprite } from './assets.ts';
import type { LoadedFlic } from './assets.ts';
import type { UiScreenEnv } from './ui-screen.ts';
import {
  WHEEL_ANGEL_AT,
  WHEEL_BUBBLE,
  WHEEL_BUBBLE_AT,
  WHEEL_BUBBLE_FMT,
  WHEEL_CHUNK,
  WHEEL_DISC_AT,
  WHEEL_FAST_STEPS,
  WHEEL_FRAME_MS,
  WHEEL_HOLD_FRAMES,
  WHEEL_HOLD_MS,
  WHEEL_MAX_DELAY,
  WHEEL_REVOLUTIONS,
  WHEEL_RESOURCE_BASE,
  WHEEL_SLOW_EVERY,
  WHEEL_TEXT,
  WHEEL_TEXT_AT,
  drawWheelScreen,
  firstFilledSlot,
  resetWheelScreen,
  wheelAngelChunk,
  wheelBubbleText,
  wheelClickable,
  wheelCue,
  wheelDiscChunk,
  wheelFrameSequence,
  wheelResource,
  wheelScreen,
  wheelScreenState,
  wheelSlotAt,
  wheelSpinLanded,
  wheelSpinSkipToSlow,
  wheelSpinStart,
  wheelSpinSteps,
  wheelSpinTick,
  wheelSlowFrom,
  wheelStepDelay,
  wheelStepWait,
  wheelValueOf,
} from './wheel-screen.ts';

// ============================================================
//  素材與版面 @source fcn_0044090e / fcn_0043f7c6
// ============================================================

describe('用到的圖 @source 0x0044093a / 0x004409b5 / 0x0043f18d', () => {
  it('★ 四個轉盤各占 Panel.mkf 一個資源：(轉盤 & 3) + 0x44', () => {
    expect(WHEEL_RESOURCE_BASE).toBe(0x44);
    expect(wheelResource(0)).toBe(68); // 航空公司
    expect(wheelResource(WHEEL.hotel)).toBe(69); // 旅館
    expect(wheelResource(WHEEL.mall)).toBe(70); // 購物中心
    expect(wheelResource(3)).toBe(71); // 保險
  });

  it('★ 圖 0/1 是天使（常態 / 轉動）、圖 2..13 是圓盤的 12 張預轉幀', () => {
    expect(WHEEL_CHUNK).toEqual({ angelIdle: 0, angelSpin: 1, discFirst: 2 });
    expect(wheelDiscChunk(0)).toBe(2);
    expect(wheelDiscChunk(11)).toBe(13);
  });

  it('★ 氣泡是 Data.mkf 資源 0x205 = 517 的圖 6（271×199）', () => {
    expect(WHEEL_BUBBLE).toEqual({ archive: 'Data.mkf', resource: 517, image: 6 });
  });
});

describe('版面 @source 0x0043f17d / 0x0043f1bd / 0x004409d3 / 0x00440a35', () => {
  it('★ 圓盤 (0xdc,0x140)、天使 (0x109,0xe6)、氣泡 (0xdc,0x8c)', () => {
    expect(WHEEL_DISC_AT).toEqual({ x: 220, y: 320 });
    expect(WHEEL_ANGEL_AT).toEqual({ x: 265, y: 230 });
    expect(WHEEL_BUBBLE_AT).toEqual({ x: 220, y: 140 });
  });

  it('★ 氣泡裡的字畫在 (220,140)、flag 4 = 正中；字級 0x10、內文 0xf0f0f0、陰影 0x101010', () => {
    expect(WHEEL_TEXT_AT).toEqual({ x: 220, y: 140 });
    expect(WHEEL_TEXT.size).toBe(0x10);
    expect(WHEEL_TEXT.fill).toBe('#f0f0f0');
    expect(WHEEL_TEXT.shadow).toBe('#101010');
  });

  it('★ 氣泡文字表逐字照抄（`%s` = 業主名）@source 0x475cf8 → 0x465210..', () => {
    expect(WHEEL_BUBBLE_FMT[WHEEL.hotel]).toBe('%s的旅館\n\n請進來休息...');
    expect(WHEEL_BUBBLE_FMT[WHEEL.mall]).toBe('%s的購物中心\n\n您的消費倍數為...');
    expect(wheelBubbleText(WHEEL.hotel, '阿土伯')).toBe('阿土伯的旅館\n\n請進來休息...');
    expect(wheelBubbleText(WHEEL.mall, '錢夫人')).toBe('錢夫人的購物中心\n\n您的消費倍數為...');
  });
});

// ============================================================
//  幀序（純函式）
// ============================================================

describe('幀序 @source 0x0043f127 / 0x0043f9fa', () => {
  it('★ 起點 → 落點：最後一幀一定是落點，而且每幀順時針走一格', () => {
    const seq = wheelFrameSequence(3, 7);
    expect(seq[0]).toBe(3);
    expect(seq[seq.length - 1]).toBe(7);
    expect(seq).toHaveLength(wheelSpinSteps(3, 7) + 1);
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBe((seq[i - 1]! + 1) % WHEEL_SLOTS);
    }
  });

  it('★ 跨 0：從 10 走到 2 要經過 11、0、1', () => {
    const seq = wheelFrameSequence(10, 2);
    expect(seq[0]).toBe(10);
    expect(seq[seq.length - 1]).toBe(2);
    expect(seq).toContain(11);
    expect(seq).toContain(0);
    expect(seq).toContain(1);
    // 11 → 0 的那一步確實是模 12 的一步
    expect(wheelSlotAt(11, 1)).toBe(0);
  });

  it('★ 走幾格 = 4 圈 + 起點到落點的距離；stop === start 也要走滿一圈', () => {
    expect(wheelSpinSteps(3, 7)).toBe(WHEEL_SLOTS * WHEEL_REVOLUTIONS + 4);
    expect(wheelSpinSteps(3, 4)).toBe(WHEEL_SLOTS * WHEEL_REVOLUTIONS + 1);
    expect(wheelSpinSteps(3, 3)).toBe(WHEEL_SLOTS * (WHEEL_REVOLUTIONS + 1));
    expect(wheelSpinSteps(3, 2)).toBe(WHEEL_SLOTS * WHEEL_REVOLUTIONS + 11);
    // 走滿一圈回到自己
    expect(wheelFrameSequence(5, 5).filter((s) => s === 5).length).toBeGreaterThan(1);
  });

  it('★「動畫過程」關掉時只有落點那一幀', () => {
    expect(wheelFrameSequence(3, 7, false)).toEqual([7]);
    expect(wheelFrameSequence(0, 0, false)).toEqual([0]);
  });

  it('★ 一幀最短 36ms、快轉段 40 幀、停好之後再等 40 幀才關屏 @source 0x0043faab / 0x0043f84f / 0x0043fa19', () => {
    expect(WHEEL_FRAME_MS).toBe(0x24);
    expect(WHEEL_FAST_STEPS).toBe(0x28);
    expect(WHEEL_HOLD_FRAMES).toBe(0x28);
    expect(WHEEL_HOLD_MS).toBe(WHEEL_HOLD_FRAMES * WHEEL_FRAME_MS);
  });

  it('★ 減速段是「最後 12 格逐檔變慢，延遲 2..5，每檔 3 格」@source 0x0043f9c7', () => {
    const total = wheelSpinSteps(0, 5);
    expect(wheelStepWait(1, total)).toBe(WHEEL_FRAME_MS);
    expect(wheelStepDelay(total, total)).toBe(WHEEL_MAX_DELAY);
    expect(wheelStepWait(total, total)).toBe(WHEEL_FRAME_MS * WHEEL_MAX_DELAY);
    // 最後 WHEEL_SLOW_EVERY 格同一檔
    expect(wheelStepDelay(total - 1, total)).toBe(WHEEL_MAX_DELAY);
    // 延遲單調不減
    for (let s = 2; s <= total; s++) {
      expect(wheelStepDelay(s, total)).toBeGreaterThanOrEqual(wheelStepDelay(s - 1, total));
    }
    // 快轉段到 slowFrom 為止；slowFrom 之後每 3 格升一檔
    const slowFrom = wheelSlowFrom(total);
    expect(wheelStepDelay(slowFrom, total)).toBe(1);
    expect(wheelStepDelay(slowFrom + 1, total)).toBe(2);
    expect(wheelStepDelay(slowFrom + WHEEL_SLOW_EVERY + 1, total)).toBe(3);
    expect(wheelStepDelay(slowFrom + WHEEL_SLOW_EVERY * (WHEEL_MAX_DELAY - 2), total)).toBe(4);
    expect(wheelStepDelay(slowFrom + WHEEL_SLOW_EVERY * (WHEEL_MAX_DELAY - 1), total)).toBe(
      WHEEL_MAX_DELAY,
    );
    // 最後這幾格都是最慢那一檔
    expect(wheelStepDelay(total - 1, total)).toBe(WHEEL_MAX_DELAY);
  });

  it('★ 一幀的節拍：沒到時間不動，到了就走一格，走到最後就 landed', () => {
    const spin = wheelSpinStart(2, 9, 1000);
    expect(wheelSpinLanded(spin)).toBe(false);
    expect(wheelSpinTick(spin, 1000 + spin.wait - 1)).toBe(spin);
    const t1 = wheelSpinTick(spin, 1000 + spin.wait);
    expect(t1.step).toBe(1);
    const total = wheelSpinSteps(2, 9);
    let s = spin;
    let now = 1000;
    for (let i = 0; i < total + 5 && !wheelSpinLanded(s); i++) {
      now += s.wait + 1;
      s = wheelSpinTick(s, now);
    }
    expect(wheelSpinLanded(s)).toBe(true);
    expect(wheelSlotAt(s.start, s.step)).toBe(9);
    // 已經停了就不再動
    expect(wheelSpinTick(s, now + 100000)).toBe(s);
  });

  it('★ 天使：快轉段用常態那張，進減速段換成轉動那張 @source 0x0043f883(arg 0) / 0x0043f9b9(arg 1)', () => {
    const total = wheelSpinSteps(0, 5);
    expect(wheelAngelChunk(0, total)).toBe(WHEEL_CHUNK.angelIdle);
    expect(wheelAngelChunk(wheelSlowFrom(total) - 1, total)).toBe(
      WHEEL_CHUNK.angelIdle,
    );
    expect(wheelAngelChunk(total, total)).toBe(WHEEL_CHUNK.angelSpin);
  });

  it('★ 真人點一下 = 直接進減速段（AI 那一路自己走）', () => {
    const total = wheelSpinSteps(2, 9);
    const spin = wheelSpinStart(2, 9, 0);
    const skipped = wheelSpinSkipToSlow(spin, 500);
    expect(skipped.step).toBe(wheelSlowFrom(total));
    expect(wheelSpinSkipToSlow(skipped, 900)).toBe(skipped);
  });
});

// ============================================================
//  與 core 的 `spinWheel()` 是同一條走法
// ============================================================

describe('★ 落點 = 起點之後第一個非空格（與 core 的 spinWheel 同源）', () => {
  it('四個盤 × 十二個起點：核心算出來的值 = 表[firstFilledSlot]', () => {
    for (let wheel = 0; wheel < WHEEL_TABLE.length; wheel++) {
      const table = WHEEL_TABLE[wheel]!;
      for (let start = 0; start < WHEEL_SLOTS; start++) {
        const expectValue = spinWheel(wheel, start);
        expect(wheelValueOf(wheel, firstFilledSlot(wheel, start))).toBe(expectValue);
        // 落點那格一定不是空格
        expect(table[firstFilledSlot(wheel, start)]).not.toBe(WHEEL_BLANK);
      }
    }
  });

  it('★ 旅館的落點分佈：1 天 4/12、2 天 3/12、3 天 2/12、4 天 3/12', () => {
    const count = new Map<number, number>();
    for (let start = 0; start < WHEEL_SLOTS; start++) {
      const v = spinWheel(WHEEL.hotel, start);
      count.set(v, (count.get(v) ?? 0) + 1);
    }
    expect(count.get(1)).toBe(4);
    expect(count.get(2)).toBe(3);
    expect(count.get(3)).toBe(2);
    expect(count.get(4)).toBe(3);
  });
});

// ============================================================
//  從 before/after 反推（真地圖 + 真 reducer）
// ============================================================

const MAP_PATH = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/extracted/map/0001.bin';
const runMap = existsSync(MAP_PATH) ? it : it.skip;

const PLAYERS = (): { character: number; kind: 'computer' }[] =>
  [0, 1, 2, 3].map((i) => ({ character: i, kind: 'computer' as const }));

interface Scene {
  before: GameState;
  topo: MapTopology;
  fac: FacilityInfo;
  idx: number;
}

/** 造一個「玩家 0 站在一處別人的設施上」的局面（照 `facility-landing.test.ts`） */
function scene(over: Partial<FacilityInfo> = {}, extra: Partial<GameState> = {}): Scene | null {
  const map = parseMap(new Uint8Array(readFileSync(MAP_PATH)));
  const node = map.nodes.find((n) => n.specialKind === 0 && facilityIndexOf(n.type) !== null);
  if (node === undefined) return null;
  const idx = facilityIndexOf(node.type);
  if (idx === null) return null;
  const fac = makeFacility({
    id: idx,
    type: FACILITY_TYPE.hotel,
    owner: 2,
    level: 1,
    priceStatus: 0,
    rateByLevel: [100, 200, 400, 800, 1600, 3200],
    ...over,
  });
  const base = newGame({ map, players: PLAYERS(), seed: 7 });
  const facilityOwner = [...base.facilityOwner];
  const facilityLevel = [...base.facilityLevel];
  const facilityType = [...base.facilityType];
  facilityOwner[idx] = fac.owner;
  facilityLevel[idx] = fac.level;
  facilityType[idx] = fac.type;
  const before: GameState = {
    ...base,
    players: base.players.map((p, i) =>
      i === 0 ? { ...p, nodeId: node.id, cash: 100_000, moneyInBank: 0 } : { ...p, cash: 100_000, moneyInBank: 0 },
    ),
    facilityOwner,
    facilityLevel,
    facilityType,
    phase: 'settling',
    ...extra,
  };
  return { before, topo: { nodes: map.nodes, lands: map.lands, facilities: [fac] }, fac, idx };
}

/** 起點槽一定是 `before.rngState` 的第一次 rand() % 12 @source 0x0043f7da */
function startOf(rngState: number): number {
  return new WatcomRng(rngState).next() % WHEEL_SLOTS;
}

describe('★ 反推這次轉盤 @source settleFacility + 0x0043f7da', () => {
  runMap('★ 旅館：反推的點數就是 core 真的住的天數', () => {
    const s = scene();
    if (s === null) return;
    const after = reduce(s.before, { type: 'settle' }, s.topo);
    const cue = wheelCue(s.before, after, s.topo);
    expect(cue).not.toBeNull();
    expect(cue?.wheel).toBe(WHEEL.hotel);
    expect(cue?.start).toBe(startOf(s.before.rngState));
    expect(cue?.stop).toBe(firstFilledSlot(WHEEL.hotel, cue!.start));
    // 真的住進去了：住的天數 = 反推出來的那個數
    const slept = after.players[0]!.totalWinterSleepDays - s.before.players[0]!.totalWinterSleepDays;
    expect(slept).toBe(cue?.value);
    expect(cue?.value).toBeGreaterThanOrEqual(1);
    expect(cue?.value).toBeLessThanOrEqual(4);
    // 住宿天數 − 1 落在 blocking 上（為 0 時掛 0x80，見 reduce.ts）
    expect(after.players[0]!.blocking.inHotel).toBe(cue!.value === 1 ? 0x80 : cue!.value - 1);
  });

  runMap('★ 購物中心：反推的倍數 × 單價 = 真的收的那筆費', () => {
    const s = scene({ type: FACILITY_TYPE.mall });
    if (s === null) return;
    const after = reduce(s.before, { type: 'settle' }, s.topo);
    const cue = wheelCue(s.before, after, s.topo);
    expect(cue?.wheel).toBe(WHEEL.mall);
    expect(cue?.value).toBeGreaterThanOrEqual(1);
    expect(cue?.value).toBeLessThanOrEqual(6);
    // 單價 = rateByLevel[level] × 物價指數（priceStatus 0 → 不翻倍）
    const unitPrice = 200 * s.before.priceIndex;
    expect(after.facilityLastToll[s.idx]).toBe(unitPrice * cue!.value);
  });

  runMap('★ 起點是隨機的：換一個 rngState 就換一個起點與落點', () => {
    const s = scene();
    if (s === null) return;
    const seen = new Set<number>();
    for (const rngState of [1, 12345, 999999, 42, 777]) {
      const before: GameState = { ...s.before, rngState };
      const after = reduce(before, { type: 'settle' }, s.topo);
      const cue = wheelCue(before, after, s.topo);
      expect(cue?.start).toBe(startOf(rngState));
      seen.add(cue!.start);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  runMap('★ 該不轉的一律不轉', () => {
    // ① 自己的設施 → 走「首建／加蓋」，不轉盤
    const own = scene({ owner: 1 });
    if (own === null) return;
    expect(wheelCue(own.before, reduce(own.before, { type: 'settle' }, own.topo), own.topo)).toBeNull();

    // ② 公園（type 0）在收費那一路一開頭就 return @source 0x0041a386
    const park = scene({ type: FACILITY_TYPE.park });
    if (park === null) return;
    expect(wheelCue(park.before, reduce(park.before, { type: 'settle' }, park.topo), park.topo)).toBeNull();

    // ③ 加油站（type 3）按步數收費，沒有轉盤 @source 0x0041a4b2 那條走的是另一路
    const gas = scene({ type: FACILITY_TYPE.gasStation });
    if (gas === null) return;
    expect(wheelCue(gas.before, reduce(gas.before, { type: 'settle' }, gas.topo), gas.topo)).toBeNull();

    // ④ 空地（level 0）不收費 @source 0x0041a377
    const empty = scene({ level: 0 });
    if (empty === null) return;
    expect(wheelCue(empty.before, reduce(empty.before, { type: 'settle' }, empty.topo), empty.topo)).toBeNull();

    // ⑤ 同盟免收：原版在轉盤**之前**就 return（0x0041a3cc），一個 rand() 都不取
    const ally = scene();
    if (ally === null) return;
    const allied: GameState = {
      ...ally.before,
      players: ally.before.players.map((p, i) => (i === 1 ? { ...p, alliedPlayer: 1 } : p)),
    };
    const afterAllied = reduce(allied, { type: 'settle' }, ally.topo);
    expect(afterAllied.rngState).toBe(allied.rngState);
    expect(wheelCue(allied, afterAllied, ally.topo)).toBeNull();
  });

  runMap('★ 不是「結算」那一步也不起播', () => {
    const s = scene();
    if (s === null) return;
    const after = reduce(s.before, { type: 'settle' }, s.topo);
    expect(wheelCue({ ...s.before, phase: 'awaitingRoll' }, after, s.topo)).toBeNull();
    // 同一份 state 沒變 → 不起播
    expect(wheelCue(s.before, s.before, s.topo)).toBeNull();
  });
});

// ============================================================
//  屏幕本體（event → tick → 關屏；點擊）
// ============================================================

interface Drawn {
  archive: string;
  resource: number;
  index: number;
  x: number;
  y: number;
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; images: Drawn[]; texts: string[] } {
  const images: Drawn[] = [];
  const texts: string[] = [];
  const ctx = {
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    drawImage: (b: Drawn, x: number, y: number) => {
      images.push({ archive: b.archive, resource: b.resource, index: b.index, x, y });
    },
    fillText: (t: string) => texts.push(t),
    strokeText: () => undefined,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images, texts };
}

/** 假精靈：錨點照 manifest（圓盤 82,82 / 天使 (−6,0) / (0,0) / 氣泡 127,92）*/
function fakeSprite(archive: string, resource: number, index: number): Sprite | null {
  const anchor =
    archive === 'Data.mkf'
      ? { x: 127, y: 92 }
      : index === 0
        ? { x: -6, y: 0 }
        : index === 1
          ? { x: 0, y: 0 }
          : { x: 82, y: 82 };
  return {
    bitmap: { archive, resource, index } as unknown as ImageBitmap,
    width: index <= 1 && archive === 'Panel.mkf' ? 75 : 164,
    height: index <= 1 && archive === 'Panel.mkf' ? 61 : 164,
    anchorX: anchor.x,
    anchorY: anchor.y,
  };
}

interface FakeEnv extends UiScreenEnv {
  now: number;
  logs: string[];
  renders: number;
}

function makeEnv(state: GameState, topo: MapTopology): FakeEnv {
  const env = {
    screen: 'game',
    state,
    topo,
    map: {} as UiScreenEnv['map'],
    now: 0,
    stage: fakeCtx().ctx,
    sprite: fakeSprite,
    flic: () => null as LoadedFlic | null,
    dispatch: () => undefined,
    requestRender: () => {
      env.renders += 1;
    },
    log: (m: string) => env.logs.push(m),
    playEffect: () => undefined,
    logs: [] as string[],
    renders: 0,
  };
  return env as unknown as FakeEnv;
}

describe('★ 屏幕：起播 → 走到落點 → 停一下關屏 @source 0x0043fa19', () => {
  runMap('★ 一次 settle 就起播，並在 WHEEL_HOLD_MS 之後關屏', () => {
    resetWheelScreen();
    const s = scene();
    if (s === null) return;
    const after = reduce(s.before, { type: 'settle' }, s.topo);
    const env = makeEnv(after, s.topo);
    expect(wheelScreen.active(env)).toBe(false);

    wheelScreen.event!(s.before, after, env);
    expect(wheelScreen.active(env)).toBe(true);
    const st = wheelScreenState();
    expect(st.cue?.wheel).toBe(WHEEL.hotel);
    expect(st.slot).toBe(st.cue?.start);

    // ★ 每一幀都要續幀（沒換格也要）—— `tick` 只在 requestRender 排的那一幀裡
    //   被調用，中間不續幀整趟動畫就會斷在半路（見 wheel-screen.ts 的註釋）
    const before = env.renders;
    wheelScreen.tick!(env);
    expect(env.renders).toBeGreaterThan(before);
    expect(wheelScreenState().slot).toBe(st.cue?.start); // 還沒到時間，不動

    // 一路推到落點
    let guard = 0;
    while (!wheelScreenState().landed && guard++ < 500) {
      env.now += 1000;
      wheelScreen.tick!(env);
    }
    expect(wheelScreenState().landed).toBe(true);
    expect(wheelScreenState().slot).toBe(st.cue?.stop);

    // 停完 WHEEL_HOLD_MS 關屏
    env.now += WHEEL_HOLD_MS;
    wheelScreen.tick!(env);
    expect(wheelScreen.active(env)).toBe(false);
    resetWheelScreen();
  });

  runMap('★ 真人點一下 → 直接進減速段；AI 點了不算 @source 0x0043fa66', () => {
    const s = scene();
    if (s === null) return;
    const after = reduce(s.before, { type: 'settle' }, s.topo);

    // core 的 `settle` 走的是 AI（kind: 'computer'），故 cue.human 為 false
    resetWheelScreen();
    const envAi = makeEnv(after, s.topo);
    wheelScreen.event!(s.before, after, envAi);
    const cue = wheelScreenState().cue!;
    expect(cue.human).toBe(false);
    expect(wheelClickable(cue)).toBe(false);
    wheelScreen.down!(10, 10, envAi);
    expect(wheelScreenState().landed).toBe(false); // AI 的點擊不算

    // 換成真人：`whoPlays` 就是 core 的 WHO_PLAYS_HUMAN
    resetWheelScreen();
    const human: GameState = {
      ...s.before,
      players: s.before.players.map((p, i) => (i === 0 ? { ...p, whoPlays: 1 } : p)),
    };
    const afterHuman = reduce(human, { type: 'settle' }, s.topo);
    const env = makeEnv(afterHuman, s.topo);
    wheelScreen.event!(human, afterHuman, env);
    const cueHuman = wheelScreenState().cue!;
    expect(cueHuman.human).toBe(true);
    expect(wheelClickable(cueHuman)).toBe(true);
    wheelScreen.down!(10, 10, env);
    // 進減速段：步數一下子跳到尾巴那 12 格之前
    expect(wheelScreenState().landed).toBe(false);
    expect(wheelScreenState().slot).toBe(
      wheelSlotAt(
        cueHuman.start,
        wheelSlowFrom(wheelSpinSteps(cueHuman.start, cueHuman.stop)),
      ),
    );
    resetWheelScreen();
  });
});

describe('★ 繪製：三張圖的落點與那一格圓盤', () => {
  runMap('★ 圓盤畫在 (220,320) 且用圖 槽+2；天使 idle → spin；氣泡帶字', () => {
    resetWheelScreen();
    const s = scene();
    if (s === null) return;
    const after = reduce(s.before, { type: 'settle' }, s.topo);
    const cue = wheelCue(s.before, after, s.topo)!;
    const ctx = fakeCtx();

    // 起點那一幀：天使還是常態那張
    drawWheelScreen(ctx.ctx, fakeSprite, {
      cue,
      slot: cue.start,
      angel: wheelAngelChunk(0, wheelSpinSteps(cue.start, cue.stop)),
      text: wheelBubbleText(cue.wheel, '阿土伯'),
    });

    const bubble = ctx.images.find((i) => i.archive === 'Data.mkf');
    expect(bubble).toMatchObject({ resource: 517, index: 6, x: 220 - 127, y: 140 - 92 });
    const disc = ctx.images.find((i) => i.resource === wheelResource(cue.wheel) && i.index >= 2);
    expect(disc).toMatchObject({ index: wheelDiscChunk(cue.start), x: 220 - 82, y: 320 - 82 });
    // 天使常態那張的錨點是 (−6,0) → 實際落點 (271,230)
    const angel = ctx.images.find((i) => i.index <= 1);
    expect(angel).toMatchObject({ index: 0, x: 271, y: 230 });
    expect(ctx.texts).toContain('阿土伯的旅館');
    expect(ctx.texts).toContain('請進來休息...');
    resetWheelScreen();
  });
});
