/*
 * 特殊格结算验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { WatcomRng } from '../rng/watcom.ts';
import { readFileSync, existsSync } from 'node:fs';
import {
  handlerFor,
  settleSpecialSquare,
  addPoints,
  POINTS_AWARD,
  MAX_SPECIAL_KIND,
  SPECIAL_HANDLERS,
} from './special-square.ts';
import { SPECIAL_KIND, parseMap } from '../loaders/map.ts';
import { makePlayer } from '../testing/factories.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP0 = `${ROOT}/extracted/map/0001.bin`;
const d = existsSync(MAP0) ? describe : describe.skip;


describe('★ 得點券格的台词事件 —— 通道 2 钉住（test_points_squares.py 18/18）', () => {
  const rng0 = () => ({ state: 1 });

  it('★★ 30 點：固定交出**事件 2**、且**不掷**随机数', () => {
    // @source 0x0041b28d `esi = [0x480852 + 角色*0x6c]`（0x480852−0x48084a = 8 ⇒ 事件 2）
    //   同一条桩里**没有** `call rand`（对照 50 點 的 `0x0041b1f8`）
    const out = settleSpecialSquare(SPECIAL_KIND.POINTS_30, makePlayer(), [], 0x1234);
    expect(out.pointsDelta).toBe(0x1e);
    expect(out.phraseIndex).toBe(2);
    expect(out.rngState).toBe(0x1234); // 随机流一步没动
  });

  it('50 點：掷一次选事件 0/1（原有行为，护栏）', () => {
    const a = settleSpecialSquare(SPECIAL_KIND.POINTS_50, makePlayer(), [], 0x1234);
    expect(a.pointsDelta).toBe(0x32);
    expect(a.phraseIndex === 0 || a.phraseIndex === 1).toBe(true);
    expect(a.rngState).not.toBe(0x1234);
  });

  it('★ 10 點：**一句都不说**（`phraseIndex` 必须缺省）', () => {
    // @source 0x0041b2fd 直接 `jmp 0x41b3d0`（尾声），连 `player_say` 都不调
    const out = settleSpecialSquare(SPECIAL_KIND.POINTS_10, makePlayer(), [], 0x1234);
    expect(out.pointsDelta).toBe(0x0a);
    expect(out.phraseIndex).toBeUndefined();
    expect(out.rngState).toBe(0x1234);
  });
  void rng0;
});

describe('17 路跳表', () => {
  it('恰好覆盖 kind 0..16', () => {
    expect(MAX_SPECIAL_KIND).toBe(16);
    expect(Object.keys(SPECIAL_HANDLERS).length).toBe(17);
    for (let k = 0; k <= 16; k++) {
      expect(handlerFor(k), `kind ${k}`).not.toBe('none');
    }
  });

  it('超出上界的 kind 无效果（原版 cmp 0x10 / ja → end）', () => {
    expect(handlerFor(17)).toBe('none');
    expect(handlerFor(255)).toBe('none');
  });

  it('跳表映射与原版一致', () => {
    expect(handlerFor(SPECIAL_KIND.NONE)).toBe('land');
    expect(handlerFor(SPECIAL_KIND.PARK)).toBe('noop');
    expect(handlerFor(SPECIAL_KIND.NEWS)).toBe('news');
    expect(handlerFor(SPECIAL_KIND.FORTUNE)).toBe('fortune');
    expect(handlerFor(SPECIAL_KIND.PRISON)).toBe('prison');
    expect(handlerFor(SPECIAL_KIND.HOSPITAL)).toBe('hospital');
    expect(handlerFor(SPECIAL_KIND.LOTTERY)).toBe('lottery');
    expect(handlerFor(SPECIAL_KIND.CARD)).toBe('card');
    expect(handlerFor(SPECIAL_KIND.BANK)).toBe('bank');
    expect(handlerFor(SPECIAL_KIND.MAGIC_HOUSE)).toBe('magicHouse');
  });
});

describe('公園 —— 落地无任何效果', () => {
  it('这是原版行为，不是未实现', () => {
    const out = settleSpecialSquare(SPECIAL_KIND.PARK, makePlayer(), [], 123);
    expect(out.handler).toBe('noop');
    expect(out.unimplemented).toBe(false); // 关键：不是待办
    expect(out.pointsDelta).toBe(0);
    expect(out.cardDrawn).toBe(0);
    expect(out.rngState).toBe(123); // 不消耗随机数
  });
});

describe('得点格', () => {
  it('三档点数分别为 50 / 30 / 10', () => {
    expect(POINTS_AWARD[SPECIAL_KIND.POINTS_50]).toBe(50);
    expect(POINTS_AWARD[SPECIAL_KIND.POINTS_30]).toBe(30);
    expect(POINTS_AWARD[SPECIAL_KIND.POINTS_10]).toBe(10);
  });

  it.each([
    // ★ 第三列 = 该档是否消耗随机数。**只有 50 點**这一档掷
    //   （@source 0x0041b1f8 `call 0x456f2d` 选台词）；
    //   30 點 `0x0041b21e` 与 10 點 `0x0041b2a3` 两条桩里都没有 `call rand`。
    //   先前这里三档一律断言"不消耗随机数"，把 50 點那条写错了。
    [SPECIAL_KIND.POINTS_50, 50, true],
    [SPECIAL_KIND.POINTS_30, 30, false],
    [SPECIAL_KIND.POINTS_10, 10, false],
  ])('kind %i 给 %i 点（消耗随机数=%s）', (kind, pts, consumes) => {
    const out = settleSpecialSquare(kind, makePlayer(), [], 1);
    expect(out.pointsDelta).toBe(pts);
    if (consumes) expect(out.rngState).not.toBe(1);
    else expect(out.rngState).toBe(1);
  });

  it('★ points 是 uint16，溢出会回绕（原版行为，保留不修）', () => {
    // @source 原版用 add word，不做饱和处理
    expect(addPoints(65535, 1)).toBe(0);
    expect(addPoints(65530, 50)).toBe(44);
    expect(addPoints(100, 50)).toBe(150);
  });
});

// ★ 得５０點那一格**掷一次**随机数选台词（@source 0x0041b1f8 `call 0x456f2d`），
//   而 30 點（0x0041b21e）与 10 點（0x0041b2a3）两条桩里**没有** `call rand`。
describe('★ 得點格：只有 50 點消耗随机数', () => {
  const seed = 12345;

  it('POINTS_50 消耗一次，并交出 0/1 的台词下标', () => {
    const out = settleSpecialSquare(SPECIAL_KIND.POINTS_50, makePlayer(), [], seed);
    const probe = new WatcomRng();
    probe.setState(seed);
    const r = probe.next();
    expect(out.pointsDelta).toBe(50);
    expect(out.rngState).toBe(probe.getState()); // ★ 正好前进一次
    expect(out.phraseIndex).toBe(r & 1);
  });

  it('★ POINTS_30 / POINTS_10 都不消耗随机数', () => {
    for (const [kind, delta] of [
      [SPECIAL_KIND.POINTS_30, 30],
      [SPECIAL_KIND.POINTS_10, 10],
    ] as const) {
      const out = settleSpecialSquare(kind, makePlayer(), [], seed);
      expect(out.pointsDelta).toBe(delta);
      expect(out.rngState).toBe(seed); // ★ 原地不动
    }
  });

  it('★★ POINTS_30 交出**固定事件 2**（此前漏了这句台词）', () => {
    // ⚠️ 这条断言 2026-09-19 改过：旧版写「30 點 phraseIndex === undefined」——
    //   那是**旧实现的复述**。通道 2（`rich4-spec/tests/test_points_squares.py` 18/18）实测
    //   `0x0041b28d esi = [0x480852 + 角色*0x6c]`（= 事件 2）后照样 `player_say`。
    const out = settleSpecialSquare(SPECIAL_KIND.POINTS_30, makePlayer(), [], seed);
    expect(out.phraseIndex).toBe(2);
  });

  it('★ POINTS_10 不说台词（`0x0041b2fd` 直接跳尾声）', () => {
    const out = settleSpecialSquare(SPECIAL_KIND.POINTS_10, makePlayer(), [], seed);
    expect(out.phraseIndex).toBeUndefined();
  });
});

describe('卡片格', () => {
  it('按牌堆剩余量抽卡并推进 PRNG', () => {
    const amounts = new Array<number>(30).fill(0);
    amounts[6] = 5; // 只有改建卡
    const out = settleSpecialSquare(SPECIAL_KIND.CARD, makePlayer(), amounts, 1);
    expect(out.handler).toBe('card');
    expect(out.cardDrawn).toBe(7); // 1 基
    expect(out.rngState).not.toBe(1); // 消耗了随机数
  });

  it('牌堆为空时抽不到卡', () => {
    const out = settleSpecialSquare(SPECIAL_KIND.CARD, makePlayer(), new Array<number>(30).fill(0), 1);
    expect(out.cardDrawn).toBe(0);
  });
});

describe('尚未实现的格子被如实标记', () => {
  it.each([
    SPECIAL_KIND.NEWS,
    SPECIAL_KIND.FORTUNE,
    SPECIAL_KIND.PRISON,
    SPECIAL_KIND.HOSPITAL,
    SPECIAL_KIND.PENGUIN_DIG,
    SPECIAL_KIND.BALLOON,
    SPECIAL_KIND.GIFT_FROM_SKY,
    SPECIAL_KIND.LOTTERY,
    SPECIAL_KIND.BANK,
    SPECIAL_KIND.DEPARTMENT_STORE,
    SPECIAL_KIND.MAGIC_HOUSE,
  ])('kind %i 标记为 unimplemented', (kind) => {
    const out = settleSpecialSquare(kind, makePlayer(), [], 1);
    expect(out.unimplemented).toBe(true);
    // 未实现不等于「静默无效果」——状态不被悄悄改动
    expect(out.pointsDelta).toBe(0);
    expect(out.cardDrawn).toBe(0);
    expect(out.rngState).toBe(1);
  });
});

d('真实地图上的特殊格覆盖率', () => {
  it('地图0 的特殊格全部落在跳表范围内', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP0)));
    const kinds = new Map<number, number>();
    for (const n of map.nodes) {
      if (n.type !== 0) continue; // 只看特殊格
      kinds.set(n.specialKind, (kinds.get(n.specialKind) ?? 0) + 1);
    }
    for (const [kind] of kinds) {
      expect(kind).toBeLessThanOrEqual(MAX_SPECIAL_KIND);
      expect(handlerFor(kind)).not.toBe('none');
    }
    expect(kinds.size).toBeGreaterThan(5);
  });

  it('统计已实现 vs 待实现的格子占比', () => {
    const map = parseMap(new Uint8Array(readFileSync(MAP0)));
    let done = 0;
    let todo = 0;
    for (const n of map.nodes) {
      if (n.type !== 0) continue;
      const out = settleSpecialSquare(n.specialKind, makePlayer(), [], 1);
      if (out.unimplemented) todo++;
      else done++;
    }
    console.log(`  地图0 特殊格：已实现 ${done} 个，待实现 ${todo} 个`);
    expect(done).toBeGreaterThan(0);
  });
});
