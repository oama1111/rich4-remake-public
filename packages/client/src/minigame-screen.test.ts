/*
 * 三个小游戏的玩法状态机与计分（T-042 / T-043 / T-044）
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 这一份只测**纯函数**：格子几何、埋寶、计分公式、状态机推进。
 * 位置与数值全部从 `rich4-re/asm/rich4_small_games.asm` 抄来，每条断言都写 @source VA。
 * 画面部分（`draw`）不在这里测 —— 单测不碰 canvas。
 */
import { describe, expect, it } from 'vitest';
import { SPECIAL_KIND, WatcomRng } from '@rich4/core';
import { decodeRaw555 } from '@rich4/assets-pipeline';
import {
  MINIGAME_BG_HEIGHT,
  MINIGAME_BG_RES,
  MINIGAME_BG_WIDTH,
} from './assets.ts';
import {
  BALLOON_FREEZE_TICKS,
  BALLOON_HIT_HALF,
  BALLOON_IMAGE_FIRST,
  BALLOON_INTRO_TICKS,
  BALLOON_LANES,
  BALLOON_PLAY_TICKS,
  BALLOON_POP_IMAGE,
  BALLOON_POP_TICKS,
  BALLOON_RES,
  BALLOON_SLOTS,
  BALLOON_SPAWN_Y,
  BALLOON_SPEED,
  BALLOON_TICK_MS,
  GIFT_ACCEL_UNTIL_Y,
  GIFT_CATCHER_FRAMES,
  GIFT_CATCHER_RES_FIRST,
  GIFT_CATCH_DEADZONE,
  GIFT_CATCH_STEP,
  GIFT_CATCHER_Y,
  GIFT_GOD_RES,
  GIFT_GOD_X_MAX,
  GIFT_GOD_X_MIN,
  GIFT_GOD_Y,
  GIFT_INTRO_TICKS,
  GIFT_ITEM_RES,
  GIFT_ITEM_Y0,
  GIFT_PLAY_TICKS,
  GIFT_RES,
  GIFT_SCALE_SPAN,
  GIFT_SLOTS,
  GIFT_TICK_MS,
  GIFT_VALUE,
  GIFT_WARN_RES,
  GIFT_WARN_SPAN,
  GIFT_WARN_FRAMES,
  MINI_END_MS,
  MINI_FONT_RES,
  MINI_SCORE_CAP,
  PENGUIN_CELLS,
  PENGUIN_END_HI_SCORE,
  PENGUIN_END_LO_SCORE,
  PENGUIN_INTRO_TICKS,
  PENGUIN_LOOT_RES,
  PENGUIN_PLAY_TICKS,
  PENGUIN_RES,
  PENGUIN_TICK_MS,
  PENGUIN_TREASURE_COUNT,
  PENGUIN_VALID_CELLS,
  balloonClick,
  balloonHit,
  balloonOffscreen,
  balloonStart,
  balloonStep,
  catchBoxOf,
  giftCatcherImage,
  giftGodImage,
  giftScale,
  giftScore,
  giftStart,
  giftStep,
  minigameSeed,
  minigameTickMs,
  nextCellToward,
  penguinCellValid,
  penguinCellX,
  penguinCellY,
  penguinClick,
  penguinDir,
  penguinHitCell,
  penguinPlaceTreasures,
  penguinScore,
  penguinStart,
  penguinStep,
} from './minigame-screen.ts';

describe('三个小游戏的出处与资源 @source rich4_small_games.asm', () => {
  it('★ specialKind 6/7/8 就是三屏 —— 第 8 项调的函数名就叫「喜從天降」', () => {
    // 落点跳表 `jmp dword [ebx*4 + 0x4197e9]`（调度点 0x004198b2）：
    //   第 6 项 0x41b146 → `call 0x415215`（企鵝）、第 7 项 0x41b15e → `call 0x4154dc`（氣球）、
    //   第 8 项 0x41b16c → `call 0x4155fc`（`_rich4_ui_game_xicongtianjiang`）
    expect(SPECIAL_KIND.PENGUIN_DIG).toBe(6);
    expect(SPECIAL_KIND.BALLOON).toBe(7);
    expect(SPECIAL_KIND.GIFT_FROM_SKY).toBe(8);
  });

  it('三屏用到的 Panel.mkf 资源号', () => {
    expect(MINI_FONT_RES).toBe(0x4f); // 79 数字表（三个入口都载）
    expect(PENGUIN_RES).toBe(0x50); // 80
    expect(PENGUIN_LOOT_RES).toEqual([0x56, 0x57, 0x58, 0x59, 0x5a]); // 86..90
    expect(BALLOON_RES).toBe(0x5b); // 91
    expect(GIFT_RES).toBe(0x5c); // 92 ★ 不是卡里写的 #22
    expect(GIFT_GOD_RES).toBe(0x5d); // 93
    expect(GIFT_WARN_RES).toBe(0x5e); // 94
    expect(GIFT_ITEM_RES).toEqual([0x5f, 0x60, 0x61, 0x62, 0x63]); // 95..99
    expect(GIFT_CATCHER_RES_FIRST).toBe(0x64); // 100 + 角色号 @0x00415705
  });

  it('★ 时限：企鵝/氣球 150 tick × 100ms，財神 360 tick × 50ms', () => {
    expect(PENGUIN_TICK_MS).toBe(100);
    expect(PENGUIN_PLAY_TICKS).toBe(0x96); // 150
    expect(BALLOON_TICK_MS).toBe(100);
    expect(BALLOON_PLAY_TICKS).toBe(0x96);
    expect(GIFT_TICK_MS).toBe(50);
    expect(GIFT_PLAY_TICKS).toBe(0x168); // 360
    expect(minigameTickMs(SPECIAL_KIND.GIFT_FROM_SKY)).toBe(GIFT_TICK_MS);
    expect(minigameTickMs(SPECIAL_KIND.PENGUIN_DIG)).toBe(PENGUIN_TICK_MS);
    expect(minigameTickMs(SPECIAL_KIND.BALLOON)).toBe(PENGUIN_TICK_MS);
    // 大号分数停留 2000ms @source `fcn_0045285e(0x7d0)`
    expect(MINI_END_MS).toBe(2000);
    // 上限 999 @source `mov dword [0x48bcec], 0x3e7`
    expect(MINI_SCORE_CAP).toBe(999);
  });
});

describe('企鵝挖寶：格子与命中 @source 0x474d7c / 0x00414abe', () => {
  it('★ 9×9 索引表里只有 64 格在棋盘上，正中那格是冰屋（无效）', () => {
    expect(PENGUIN_CELLS).toBe(81);
    let valid = 0;
    for (let i = 0; i < PENGUIN_CELLS; i++) if (penguinCellValid(i)) valid++;
    expect(valid).toBe(PENGUIN_VALID_CELLS);
    // 抽查表里的值（表在 exe 里是 `{int16 x, int16 y, …}` 每格 8 字节）
    expect([penguinCellX(3), penguinCellY(3)]).toEqual([80, 153]);
    expect([penguinCellX(70), penguinCellY(70)]).toEqual([608, 225]);
    expect([penguinCellX(71), penguinCellY(71)]).toEqual([0, 0]); // 菱形右下角那一格不在棋盘上
    expect([penguinCellX(74), penguinCellY(74)]).toEqual([416, 369]);
    // 40 = 第 5 行第 5 列的 (0,0)，正是菱形正中那格（原版画冰屋的地方）
    expect(penguinCellValid(40)).toBe(false);
    expect([penguinCellX(40), penguinCellY(40)]).toEqual([0, 0]);
  });

  it('★ 命中与命中表 #81 逐点一致（下表是 #81 的原始像素值）', () => {
    // 复核命令：`python3 -c "print(open('assets-clean/Panel/0081.bin','rb').read()[y*640+x])"`
    const samples: readonly (readonly [number, number, number])[] = [
      [80, 153, 3],
      [104, 161, 3],
      [128, 129, 4],
      [152, 161, 13],
      [320, 81, 16],
      [320, 100, 16],
      [80, 249, 19],
      [32, 225, 10],
      [100, 320, 36],
      [320, 321, 56],
      [320, 340, 56],
      [560, 297, 77],
      [608, 225, 70],
      [224, 369, 54],
      [416, 369, 74],
    ];
    for (const [x, y, cell] of samples) expect(penguinHitCell(x, y), `(${x},${y})`).toBe(cell);
  });

  it('★ 棋盘外与冰屋那格都打不中（#81 那里是 0）', () => {
    expect(penguinHitCell(10, 10)).toBeNull();
    expect(penguinHitCell(600, 460)).toBeNull();
    // 冰屋正中：四周四格的菱形都够不着它
    expect(penguinHitCell(320, 225)).toBeNull();
    expect(penguinHitCell(319, 224)).toBeNull();
    expect(penguinHitCell(321, 226)).toBeNull();
  });

  it('每一格都能被自己的格心打中', () => {
    for (let i = 0; i < PENGUIN_CELLS; i++) {
      if (!penguinCellValid(i)) continue;
      expect(penguinHitCell(penguinCellX(i), penguinCellY(i))).toBe(i);
    }
  });
});

describe('企鵝挖寶：埋寶与计分 @source 0x00412014 / fcn_00413a4a', () => {
  it('★ 28 个寶物按 3/12/3/9/1 埋在有效格上', () => {
    expect(PENGUIN_TREASURE_COUNT).toEqual([3, 12, 3, 9, 1]);
    const { board } = penguinPlaceTreasures(12345);
    const counts = [0, 0, 0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < PENGUIN_CELLS; i++) {
      const t = board[i] ?? 0;
      if (t === 0) continue;
      expect(penguinCellValid(i), `第 ${i} 格必须是有效格`).toBe(true);
      counts[t] = (counts[t] ?? 0) + 1;
      total++;
    }
    expect(total).toBe(28);
    expect(counts.slice(1)).toEqual([3, 12, 3, 9, 1]);
  });

  it('同一个种子埋出来的完全一样（本屏自己的 PRNG 是确定性的）', () => {
    const a = penguinPlaceTreasures(987654321);
    const b = penguinPlaceTreasures(987654321);
    expect(Array.from(a.board)).toEqual(Array.from(b.board));
    expect(a.rngState).toBe(b.rngState);
    const c = penguinPlaceTreasures(987654322);
    expect(Array.from(c.board)).not.toEqual(Array.from(a.board));
  });

  it('★ 计分 = 类型5×20 + 类型3×12 + 类型4×8 + 类型2×5，类型 1 不计分', () => {
    // @source `fcn_00413a4a` @0x00413d6a；类型 1 走 0x004129ab（只播一个音）
    expect(penguinScore([0, 5, 0, 0, 0, 0])).toBe(0);
    expect(penguinScore([0, 0, 1, 0, 0, 0])).toBe(5);
    expect(penguinScore([0, 0, 0, 1, 0, 0])).toBe(12);
    expect(penguinScore([0, 0, 0, 0, 1, 0])).toBe(8);
    expect(penguinScore([0, 0, 0, 0, 0, 1])).toBe(20);
    // 全埋全挖 = 12×5 + 3×12 + 9×8 + 1×20 = 188
    expect(penguinScore([0, 3, 12, 3, 9, 1])).toBe(188);
  });

  it('★ 结算姿势按分数线挑 @source 0x00414986（<40 → 85 号、>55 → 84 号）', () => {
    const poseOf = (counts: number[]): string => {
      const st = penguinStart(7);
      const one: typeof st = { ...st, counts, phase: 'play', ticks: 1, intro: 0 };
      return penguinStep(one, 0).endPose;
    };
    expect(PENGUIN_END_LO_SCORE).toBe(0x28);
    expect(PENGUIN_END_HI_SCORE).toBe(0x37);
    expect(poseOf([0, 0, 0, 0, 0, 0])).toBe('lo'); // 0 分
    expect(poseOf([0, 0, 7, 0, 0, 0])).toBe('lo'); // 35 分
    expect(poseOf([0, 0, 8, 0, 0, 0])).toBe('mid'); // 40 分正好在界上（`jge` 就不再换 85 号）
    expect(poseOf([0, 0, 0, 0, 0, 2])).toBe('mid'); // 40
    expect(poseOf([0, 0, 0, 4, 0, 0])).toBe('mid'); // 48
    expect(poseOf([0, 0, 0, 0, 0, 4])).toBe('hi'); // 56
  });

  it('整局推进：10 tick 入场 → 150 tick 游戏 → 结算 → 大号分数', () => {
    let st = penguinStart(2024);
    expect(st.phase).toBe('intro');
    expect(st.intro).toBe(PENGUIN_INTRO_TICKS);
    for (let i = 0; i < PENGUIN_INTRO_TICKS; i++) st = penguinStep(st, 0);
    expect(st.phase).toBe('play');
    expect(st.ticks).toBe(PENGUIN_PLAY_TICKS);
    for (let i = 0; i < PENGUIN_PLAY_TICKS; i++) st = penguinStep(st, 0);
    expect(st.phase).toBe('end');
    expect(st.ticks).toBe(0);
    for (let i = 0; i < 64; i++) st = penguinStep(st, 1000);
    expect(st.phase).toBe('score');
    expect(st.scoreUntil).toBe(1000 + MINI_END_MS);
  });

  it('点一格 → 走过去 → 挖开：走一格 4 个 tick @0x00412651', () => {
    const base = penguinStart(5);
    const start: typeof base = { ...base, phase: 'play', intro: 0 };
    const from = start.cell;
    // 找一格与脚下相邻、能走到的
    const near = nextCellToward(from, start.cell + 9) ?? nextCellToward(from, start.cell + 1);
    expect(near).not.toBeNull();
    const target = near ?? from;
    const clicked = penguinClick(start, penguinCellX(target), penguinCellY(target));
    expect(clicked.target).toBe(target);
    expect(clicked.to).toBe(target);
    let st = clicked;
    for (let i = 0; i < 4; i++) st = penguinStep(st, 0);
    expect(st.cell).toBe(target);
    // 到了就开始挖：4 个 tick 之后见结果
    expect(st.dig).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) st = penguinStep(st, 0);
    expect(st.dig).toBe(0);
    expect(st.dug[target]).toBe(1);
    // 挖过的格土堆就不画了
    expect(st.mound[target]).toBe(0);
  });

  it('朝向按 @0x00412651 的四条分支算', () => {
    expect(penguinDir(1, 0)).toBe(3);
    expect(penguinDir(1, -1)).toBe(4);
    expect(penguinDir(0, 1)).toBe(1);
    expect(penguinDir(0, -1)).toBe(5);
    expect(penguinDir(-1, 0)).toBe(7);
    // 8 向都落在 0..7（原版高位当图号用，越界会读到别的图）
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const d = penguinDir(dc, dr);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(7);
      }
    }
  });

  it('0 个 tick 的整局不会崩，也不会自己动', () => {
    const st = penguinStart(1);
    expect(st.phase).toBe('intro');
    expect(penguinStep(st, 0).phase).toBe('intro');
  });
});

describe('七彩氣球 @source 0x004154dc', () => {
  it('16 个槽、7 条道、生成高度 420、入场 5 tick', () => {
    expect(BALLOON_SLOTS).toBe(16);
    expect(BALLOON_LANES).toEqual([0x28, 0x78, 0xc8, 0x118, 0x168, 0x1b8, 0x208]);
    expect(BALLOON_SPAWN_Y).toBe(0x1a4);
    expect(BALLOON_INTRO_TICKS).toBe(5);
    // 气球图 = 图 `类型 + 1` @source `loc_0041311b`
    expect(BALLOON_IMAGE_FIRST).toBe(1);
    expect(balloonStart(1).balloons).toHaveLength(BALLOON_SLOTS);
  });

  it('★ 生成出来的类型一定在 0..11，且落在道上', () => {
    let st = balloonStart(4242);
    st = { ...st, phase: 'play', intro: 0 };
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      st = balloonStep(st, i * BALLOON_TICK_MS);
      for (const b of st.balloons) {
        if (b.x === 0) continue;
        expect(BALLOON_LANES).toContain(b.x);
        expect(b.type).toBeGreaterThanOrEqual(0);
        expect(b.type).toBeLessThanOrEqual(11);
        seen.add(b.type);
      }
    }
    // 3% 的概率掷 400×16 次，0..11 里至少该见到好几种
    expect(seen.size).toBeGreaterThan(2);
    // 速度表的长度覆盖 0..11
    expect(BALLOON_SPEED).toHaveLength(12);
  });

  it('★ 点爆计分：普通 = 类型+1、9 = ×2、10 = ÷2 @0x00414dd2', () => {
    const make = (type: number): ReturnType<typeof balloonStart> => {
      const st = balloonStart(1);
      const balloons = st.balloons.map((b, i) =>
        i === 0 ? { x: 0x78, y: 200, type, popped: 0 } : { ...b },
      );
      return { ...st, balloons, phase: 'play', intro: 0, score: 7 };
    };
    expect(balloonClick(make(3), 0x78, 200).score).toBe(7 + 4);
    expect(balloonClick(make(9), 0x78, 200).score).toBe(14);
    expect(balloonClick(make(10), 0x78, 200).score).toBe(3); // sar 7 → 3
    expect(balloonClick(make(12), 0x78, 200).score).toBe(7 + 13);
    // 爆掉的那一格类型字写成 0x3c：画 2 帧爆开图
    const popped = balloonClick(make(3), 0x78, 200).balloons[0];
    expect(popped?.popped).toBe(BALLOON_POP_TICKS);
    expect(BALLOON_POP_IMAGE).toBe(13);
  });

  it('★ 类型 11 抽到哪一个效果，跟原版 `rand()%6` 的跳表对得上', () => {
    // 跳表 `ref_00414ba4`：0 = 时间剩 1、1 = 定住 20 tick、2 = 速度×2、3 = 速度÷2、4 = 清零、5 = ×2
    const base = balloonStart(31337);
    const rng = new WatcomRng(base.rngState);
    const roll = rng.next() % 6;
    const st = {
      ...base,
      balloons: base.balloons.map((b, i) => (i === 0 ? { x: 0x78, y: 200, type: 11, popped: 0 } : { ...b })),
      phase: 'play' as const,
      intro: 0,
      score: 9,
    };
    const after = balloonClick(st, 0x78, 200);
    if (roll === 0) expect(after.ticks).toBe(1);
    else if (roll === 1) expect(after.freeze).toBe(BALLOON_FREEZE_TICKS);
    else if (roll === 2) expect(after.speed).toBe(-1);
    else if (roll === 3) expect(after.speed).toBe(1);
    else if (roll === 4) expect(after.score).toBe(0);
    else expect(after.score).toBe(18);
    expect(after.rngState).not.toBe(st.rngState); // 抽过了，PRNG 往前走一格
  });

  it('★ 命中框：类型 < 6 用 ±22×±30、>= 6 用 ±18×±26 @0x00414f26', () => {
    expect(BALLOON_HIT_HALF.tall).toEqual({ x: 0x16, y: 0x1e });
    expect(BALLOON_HIT_HALF.short).toEqual({ x: 0x12, y: 0x1a });
    const tall = { x: 100, y: 200, type: 1, popped: 0 };
    const short = { x: 100, y: 200, type: 7, popped: 0 };
    expect(balloonHit(tall, 122, 200)).toBe(true);
    expect(balloonHit(tall, 123, 200)).toBe(false);
    expect(balloonHit(short, 118, 200)).toBe(true);
    expect(balloonHit(short, 119, 200)).toBe(false);
    // 爆掉的、空的都不再吃点击
    expect(balloonHit({ ...tall, popped: 1 }, 100, 200)).toBe(false);
    expect(balloonHit({ ...tall, x: 0 }, 0, 200)).toBe(false);
  });

  it('气球升出屏就置空（原版是「贴图一点都没画出来」@0x00413170）', () => {
    expect(balloonOffscreen({ x: 100, y: 420, type: 1, popped: 0 })).toBe(false);
    expect(balloonOffscreen({ x: 100, y: 200, type: 1, popped: 0 })).toBe(false);
    expect(balloonOffscreen({ x: 100, y: -111, type: 1, popped: 0 })).toBe(true);
    expect(balloonOffscreen({ x: 100, y: -90, type: 7, popped: 0 })).toBe(true);
  });

  it('时间到 + 屏上没气球 → 进结算，并起算 2000ms', () => {
    let st = balloonStart(8);
    st = { ...st, phase: 'play', intro: 0, ticks: 1 };
    st = balloonStep(st, 500);
    expect(st.phase).toBe('score');
    expect(st.scoreUntil).toBe(500 + MINI_END_MS);
  });

  it('时间到但屏上还有气球 → 先等着（`ending`）@0x00413229', () => {
    const base = balloonStart(8);
    const st = {
      ...base,
      phase: 'play' as const,
      intro: 0,
      ticks: 1,
      balloons: base.balloons.map((b, i) => (i === 0 ? { x: 0x78, y: 100, type: 1, popped: 0 } : { ...b })),
    };
    const after = balloonStep(st, 500);
    expect(after.phase).toBe('ending');
  });
});

describe('財神接金幣（喜從天降）@source 0x004155fc', () => {
  it('初始局面照 WM_CREATE 的那一串 @0x00415805', () => {
    const st = giftStart(1);
    expect(st.items).toHaveLength(GIFT_SLOTS);
    expect(st.godState).toBe(3);
    expect(st.godFrame).toBe(4);
    expect(st.godX).toBe(GIFT_GOD_X_MIN);
    expect(st.catcherX).toBe(0x140);
    expect(st.warnFrame).toBe(-1); // `[0x48bd42] = 0xffff`
    expect(st.phase).toBe('intro');
    expect(st.intro).toBe(GIFT_INTRO_TICKS);
    expect(st.ticks).toBe(GIFT_PLAY_TICKS);
  });

  it('★ 计分 = 类型0×10 + 类型1×5 + 类型2×3 + 类型3×1 @0x0041449e', () => {
    expect(GIFT_VALUE).toEqual([10, 5, 3, 1]);
    expect(giftScore([0, 0, 0, 0])).toBe(0);
    expect(giftScore([1, 0, 0, 0])).toBe(10);
    expect(giftScore([0, 1, 0, 0])).toBe(5);
    expect(giftScore([0, 0, 1, 0])).toBe(3);
    expect(giftScore([0, 0, 0, 1])).toBe(1);
    expect(giftScore([1, 2, 3, 4])).toBe(10 + 10 + 9 + 4);
  });

  it('★ 远近缩放：y=130 时 0.5、y=380 时 1.0 @0x004132bc', () => {
    expect(giftScale(100)).toBe(0.5); // y < 130 时按 0 算
    expect(giftScale(GIFT_ACCEL_UNTIL_Y)).toBe(0.5);
    expect(giftScale(GIFT_ACCEL_UNTIL_Y + GIFT_SCALE_SPAN)).toBe(1);
    expect(giftScale(200)).toBeCloseTo(0.64, 5); // 0.5 + 0.5 × 70/250（原版是 `32768×(1+(y−130)/250)`）
  });

  it('玩家追鼠标：差 > 8 才动、每 tick 10px @0x0041364d', () => {
    expect(GIFT_CATCH_DEADZONE).toBe(8);
    expect(GIFT_CATCH_STEP).toBe(0xa);
    const st = { ...giftStart(1), phase: 'play' as const, intro: 0 };
    const box = catchBoxOf(null, st.catcherX, GIFT_CATCHER_Y);
    // 鼠标在最左 → 自己往左追（`[0x48bd48] = 1`），每 tick 10px
    const left = giftStep(st, 0, box, 0);
    expect(left.catcherX).toBe(0x140 - GIFT_CATCH_STEP);
    expect(left.catcherDir).toBe(1);
    // 鼠标在最右 → 往右追（`[0x48bd48] = 2`）
    const right = giftStep(st, 639, box, 0);
    expect(right.catcherX).toBe(0x140 + GIFT_CATCH_STEP);
    expect(right.catcherDir).toBe(2);
    // 鼠标就在脚边（差 <= 8）→ 站住
    const still = giftStep(st, st.catcherX + 4, box, 0);
    expect(still.catcherDir).toBe(0);
    expect(still.catcherX).toBe(st.catcherX);
  });

  it('★ 掉落物从 y=100 起、速度 −16 每 tick +2（会先往上抬一下）@0x00412445', () => {
    expect(GIFT_ITEM_Y0).toBe(0x64);
    const base = giftStart(1);
    const st = {
      ...base,
      phase: 'play' as const,
      intro: 0,
      items: base.items.map((it, i) => (i === 0 ? { x: 200, y: GIFT_ITEM_Y0, type: 1, frame: 0, speed: -16 } : { ...it })),
    };
    const after = giftStep(st, -100, catchBoxOf(null, 320, GIFT_CATCHER_Y), 0);
    const it = after.items[0];
    // 速度 −16 + 2 = −14 → y 反而小了 14（原版那条 `jle 0x10` 是**有符号**比较）
    expect(it?.speed).toBe(-14);
    expect(it?.y).toBe(GIFT_ITEM_Y0 - 14);
  });

  it('★ 掉落物最终会落到 y > 380 然后置空 @0x004134f3', () => {
    const base = giftStart(1);
    let st: ReturnType<typeof giftStart> = {
      ...base,
      phase: 'play' as const,
      intro: 0,
      ticks: GIFT_PLAY_TICKS,
      items: base.items.map((it, i) => (i === 0 ? { x: 200, y: GIFT_ITEM_Y0, type: 1, frame: 0, speed: -16 } : { ...it })),
    };
    const box = catchBoxOf(null, 10, GIFT_CATCHER_Y); // 摆在最左边，接不到
    for (let i = 0; i < 200 && (st.items[0]?.x ?? 0) !== 0; i++) st = giftStep(st, -1000, box, 0);
    expect(st.items[0]?.x).toBe(0);
    expect(st.counts).toEqual([0, 0, 0, 0]);
  });

  it('財神的图号与玩家的图号都在自己那本图集里', () => {
    for (const godState of [0, 1, 2, 3, 4]) {
      for (let f = 0; f < 5; f++) {
        const img = giftGodImage({ ...giftStart(1), godState, godFrame: f });
        expect(img).toBeGreaterThanOrEqual(0);
        expect(img).toBeLessThan(19); // #93 有 19 张
      }
    }
    for (const dir of [0, 1, 2]) {
      const img = giftCatcherImage({ ...giftStart(1), catcherDir: dir, catcherFrame: 3 });
      expect(img).toBeGreaterThanOrEqual(0);
      expect(img).toBeLessThan(25); // 100+角色号 每本 25 张
    }
    // 走行：右 = 5..14、左 = 15..24 @source `(朝向−1)*10 + 5 + 帧`
    expect(giftCatcherImage({ ...giftStart(1), catcherDir: 1, catcherFrame: 0 })).toBe(5);
    expect(giftCatcherImage({ ...giftStart(1), catcherDir: 1, catcherFrame: 9 })).toBe(14);
    expect(giftCatcherImage({ ...giftStart(1), catcherDir: 2, catcherFrame: 0 })).toBe(15);
    expect(GIFT_CATCHER_FRAMES).toBe(10);
  });

  it('炸彈预警落在財神的**另一侧** @0x0041378d / @0x004137e8', () => {
    let st: ReturnType<typeof giftStart> = { ...giftStart(99), phase: 'play', intro: 0 };
    const box = catchBoxOf(null, -1000, GIFT_CATCHER_Y);
    let sawWarn = false;
    for (let i = 0; i < 400 && !sawWarn; i++) {
      const godX = st.godX;
      st = giftStep(st, -1000, box, 0);
      if (st.warnFrame >= 0 && godX > 0x140) {
        expect(st.warnX).toBeLessThan(0x140); // 財神在右半 → 炸彈落左半
        sawWarn = true;
      } else if (st.warnFrame >= 0) {
        expect(st.warnX).toBeGreaterThan(0x140);
        sawWarn = true;
      }
    }
    expect(sawWarn).toBe(true);
    // 预警区间：左 160 + rand%140、右 360 + rand%140 @0x0041378d
    expect(GIFT_WARN_SPAN).toBe(0x8c);
    expect(st.warnX).toBeGreaterThanOrEqual(0xa0);
    expect(st.warnX).toBeLessThan(0xa0 + 0x8c + 0x168);
    expect(GIFT_WARN_FRAMES).toBe(12);
  });

  it('整局 360 tick 跑完不崩，进结算后起算 2000ms', () => {
    let st: ReturnType<typeof giftStart> = { ...giftStart(20240915), phase: 'play', intro: 0 };
    const box = catchBoxOf(null, 320, GIFT_CATCHER_Y);
    for (let i = 0; i < GIFT_PLAY_TICKS + 200; i++) {
      st = giftStep(st, 320, box, i * GIFT_TICK_MS);
    }
    expect(st.ticks).toBe(0);
    expect(st.phase).toBe('score');
    expect(st.scoreUntil).toBeGreaterThan(0);
    expect(giftScore(st.counts)).toBeGreaterThanOrEqual(0);
    expect(giftScore(st.counts)).toBeLessThanOrEqual(MINI_SCORE_CAP);
  });

  it('各个落点常量与图集/时间轴对得上', () => {
    expect(GIFT_GOD_Y).toBe(0x7e);
    expect(GIFT_CATCHER_Y).toBe(0x17c);
    expect(GIFT_GOD_X_MIN).toBe(0x6e);
    expect(GIFT_GOD_X_MAX).toBe(0x212);
  });

  it('★ 底图 #92 是**无头** 640×480 RGB555 —— 字节数正好 640×480×2', () => {
    // @source `Panel/0092.bin` 614400 = 640×480×2（没有 SPR/SMP 头，尺寸由调用点定）：
    //   0041566b  push 0x5c          ; 资源号 92
    //   00415674  call 0x450441      ; read_mkf(Panel.mkf, 92, 0, 0)
    // 故不能走 `sprite()`（manifest 里没有它），只能走 `readRaw555Resource`（D-MINI-1）。
    expect(MINIGAME_BG_RES).toBe(GIFT_RES);
    expect(MINIGAME_BG_WIDTH).toBe(640);
    expect(MINIGAME_BG_HEIGHT).toBe(480);
    expect(MINIGAME_BG_WIDTH * MINIGAME_BG_HEIGHT * 2).toBe(614400);
    // 抽查 #92 头一个像素的 RGB555 → RGBA（0x2e35 → 90/140/173，不透明）
    expect(Array.from(decodeRaw555(1, 1, Uint8Array.from([0x35, 0x2e])).rgba)).toEqual([
      90, 140, 173, 255,
    ]);
  });
});

describe('屏幕自己的 PRNG 种子', () => {
  const state = { day: 3, month: 5, year: 2, currentPlayer: 1 };

  it('同输入同种子、不同输入不同种子', () => {
    expect(minigameSeed(state, 6, 1)).toBe(minigameSeed(state, 6, 1));
    expect(minigameSeed(state, 6, 1)).not.toBe(minigameSeed(state, 6, 2));
    expect(minigameSeed(state, 6, 1)).not.toBe(minigameSeed(state, 7, 1));
    expect(minigameSeed(state, 6, 1)).not.toBe(minigameSeed({ ...state, currentPlayer: 2 }, 6, 1));
  });

  it('种子是可用的 uint32', () => {
    for (const game of [6, 7, 8]) {
      const s = minigameSeed(state, game, 3);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
