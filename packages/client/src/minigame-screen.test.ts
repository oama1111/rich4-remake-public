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
import { bgmAssetFileFor, bgmTrackIdOf, decodeRaw555, SCREEN_BGM } from '@rich4/assets-pipeline';
import type { GameState } from '@rich4/core';
import type { UiScreenEnv } from './ui-screen.ts';
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
  BALLOON_MISS_SOUND,
  BALLOON_PLAY_TICKS,
  BALLOON_POP_IMAGE,
  BALLOON_POP_SOUND,
  BALLOON_POP_TICKS,
  BALLOON_RES,
  BALLOON_SLOTS,
  BALLOON_SPAWN_SOUND,
  BALLOON_SPAWN_Y,
  BALLOON_SPEED,
  BALLOON_TICK_MS,
  GIFT_ACCEL_UNTIL_Y,
  GIFT_BOMB_LOOP_SOUND,
  GIFT_BOMB_SOUND,
  GIFT_BOOM_SOUND,
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
  MINI_BIG_CENTER_X,
  MINI_BIG_PITCH,
  MINI_BIG_Y,
  MINI_DIGIT_PITCH,
  MINI_END_MS,
  MINI_FONT_RES,
  MINI_SCORE_CAP,
  PENGUIN_ARRIVE_SOUND,
  PENGUIN_CELLS,
  PENGUIN_CURSOR,
  PENGUIN_END_LO_RES,
  PENGUIN_DIG_SOUND,
  PENGUIN_END_HI_SCORE,
  PENGUIN_END_HI_SOUND,
  PENGUIN_END_LO_SCORE,
  PENGUIN_END_LO_SOUND,
  PENGUIN_INTRO_TICKS,
  PENGUIN_LOOT_RES,
  PENGUIN_LOOT_SOUND,
  PENGUIN_PLAY_TICKS,
  PENGUIN_RES,
  PENGUIN_TICK_MS,
  PENGUIN_TREASURE_COUNT,
  PENGUIN_VALID_CELLS,
  BALLOON_CURSOR,
  balloonClick,
  balloonCursorShown,
  miniCursorWant,
  balloonHit,
  balloonShootable,
  balloonOffscreen,
  balloonStart,
  balloonStep,
  catchBoxOf,
  drawBigScore,
  drawNumber,
  giftCatcherImage,
  giftGodImage,
  giftScale,
  giftScore,
  giftStart,
  giftStep,
  introGateOpen,
  introPlayback,
  MINI_ARCHIVE,
  MINI_INTRO_FLIC_RES,
  MINI_INTRO_GIVE_UP_MS,
  minigameBgmFile,
  minigameIntroStage,
  minigameScreen,
  minigameSeed,
  minigameTickMs,
  nextCellToward,
  penguinCellValid,
  penguinCellX,
  penguinCellY,
  penguinClick,
  penguinCursorShown,
  penguinDir,
  penguinHitCell,
  penguinPlaceTreasures,
  penguinScore,
  penguinStart,
  penguinStep,
  playMiniSounds,
} from './minigame-screen.ts';
import {
  CURSOR_ARCHIVE,
  CURSOR_RESOURCE,
  CURSOR_TICK_MS,
  cursorImageAt,
  cursorShape,
  resolveCursor,
  type CursorFrame,
  type CursorWant,
} from './soft-cursor.ts';

/** 棋盘上什么别的都没开（小游戏那一拍：按过 GO，指针本来就藏着）*/
const BOARD_IDLE: CursorFrame = {
  screen: 'game',
  pick: null,
  dicePick: false,
  stockPick: false,
  amountWindow: false,
  atm: false,
  localInput: false,
  goPhase: false,
};

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
  it('16 个槽、8 条道、生成高度 420、入场 5 tick', () => {
    expect(BALLOON_SLOTS).toBe(16);
    // ★ `0x0041305e cmp ebx, 0x280 / jge 出圈` ⇒ 0x258(600) 也是一条道（先前漏了，右边那条永远空着）
    expect(BALLOON_LANES).toEqual([0x28, 0x78, 0xc8, 0x118, 0x168, 0x1b8, 0x208, 0x258]);
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
    // 爆掉的那一格类型字写成 0x3c：0x2c / 0x1c 两拍画爆开图、0x0c 那一拍置空
    const popped = balloonClick(make(3), 0x78, 200).balloons[0];
    expect(popped?.popped).toBe(BALLOON_POP_TICKS);
    expect(BALLOON_POP_TICKS).toBe(3);
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

// ============================================================
//  ★ 固定宽度数字 + 分数上限（D-MINI-12）
// ============================================================

/** 只数 `drawImage` 落点的最小假 canvas */
function digitCtx(): { ctx: CanvasRenderingContext2D; xs: number[] } {
  const xs: number[] = [];
  const ctx = {
    drawImage: (_b: unknown, x: number) => {
      xs.push(x);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, xs };
}

/** 记录画到第几张图（= 数字字符）的假精灵 */
function digitSprite(): { sprite: Parameters<typeof drawNumber>[1]; seen: number[] } {
  const seen: number[] = [];
  const sprite = ((_archive: string, _resource: number, index: number) => {
    seen.push(index);
    return { bitmap: {} as ImageBitmap, width: 15, height: 28, anchorX: 0, anchorY: 0 };
  }) as unknown as Parameters<typeof drawNumber>[1];
  return { sprite, seen };
}

describe('★ 固定宽度数字 —— 原版画固定位数（D-MINI-12）', () => {
  it('★ 企鵝時限就是 150 tick（「4 位數塞進 3 格」那条审计说法不成立）', () => {
    // PENGUIN_PLAY_TICKS = 0x96 = 150，`pad(st.ticks, 3)` 进 3 格，永远 ≤ 3 位数
    expect(PENGUIN_PLAY_TICKS).toBe(150);
    expect(PENGUIN_PLAY_TICKS).toBe(0x96);
  });

  it('★ `drawNumber` 只画前 `width` 个字符 —— 5 位数也画不过框', () => {
    const cases: readonly (readonly [string, number, number])[] = [
      ['150', 3, 3], // 企鵝时间
      ['000', 3, 3], // 0 分
      ['14730', 4, 4], // 5 位数 → 只画 4 位（原版 `fcn_00413f07` 的 `%04d`）
      ['14730', 3, 3],
      ['14730', 2, 2],
      ['7', 4, 1], // 短的不补
    ];
    for (const [text, width, want] of cases) {
      const { ctx, xs } = digitCtx();
      const { sprite, seen } = digitSprite();
      drawNumber(ctx, sprite, text, 0, 0, MINI_DIGIT_PITCH, 0, width);
      expect(xs, `text=${text} width=${width}`).toHaveLength(want);
      // 字距照旧，且**没有**第 `width` 个字之后的那一格
      for (let i = 0; i < xs.length; i++) expect(xs[i]).toBe(i * MINI_DIGIT_PITCH);
      expect(Math.max(...xs)).toBe((want - 1) * MINI_DIGIT_PITCH);
      // 图号 = 字符 − '0'
      expect(seen).toEqual([...text.slice(0, width)].map((c) => c.charCodeAt(0) - 0x30));
    }
  });
});

describe('★ 七彩氣球分數夾到 999（×2 那一支也要夾）@source 0x00414ece', () => {
  const make = (type: number, score: number): ReturnType<typeof balloonStart> => {
    const st = balloonStart(1);
    const balloons = st.balloons.map((b, i) =>
      i === 0 ? { x: 0x78, y: 200, type, popped: 0 } : { ...b },
    );
    return { ...st, balloons, phase: 'play', intro: 0, score };
  };

  it('★ 普通支照旧夹（996 + 4 → 999）', () => {
    expect(balloonClick(make(3, 996), 0x78, 200).score).toBe(MINI_SCORE_CAP);
  });

  it('★ ×2 那一支（类型 9）也夹到 999 —— 原版 `loc_00414ebe` 不夹（D-MINI-12）', () => {
    expect(balloonClick(make(9, 600), 0x78, 200).score).toBe(MINI_SCORE_CAP);
    expect(balloonClick(make(9, 500), 0x78, 200).score).toBe(MINI_SCORE_CAP);
    expect(balloonClick(make(9, 499), 0x78, 200).score).toBe(998); // 不到 1000 不夹
  });
});

// ============================================================
//  ★ 音效（编号 dump 自 exe 的 sound-info 结构）
// ============================================================

describe('★ 小游戏音效 @source rich4_small_games.asm 的 sound-info 表', () => {
  it('★ `playMiniSounds` 按顺序倒给出口并清空', () => {
    const calls: string[] = [];
    const env = {
      playEffect: (id: number, loop = false) => calls.push(loop ? `play:${id}:loop` : `play:${id}`),
      stopEffect: (id: number) => calls.push(`stop:${id}`),
    };
    const sfx = [
      { id: PENGUIN_DIG_SOUND, loop: true },
      { id: PENGUIN_ARRIVE_SOUND },
      { id: PENGUIN_DIG_SOUND, stop: true },
    ];
    playMiniSounds(env, sfx);
    expect(calls).toEqual([
      `play:${PENGUIN_DIG_SOUND}:loop`,
      `play:${PENGUIN_ARRIVE_SOUND}`,
      `stop:${PENGUIN_DIG_SOUND}`,
    ]);
    expect(sfx).toHaveLength(0);
  });

  it('★ 企鵝：走到定点起挖 → 12（到达）+ 11（挖掘循环）@source 0x004127ed / 0x00414b51', () => {
    const base = penguinStart(5);
    const start = { ...base, phase: 'play' as const, intro: 0 };
    const from = start.cell;
    const near = nextCellToward(from, from + 9) ?? nextCellToward(from, from + 1);
    expect(near).not.toBeNull();
    const target = near ?? from;
    let st = penguinClick(start, penguinCellX(target), penguinCellY(target));
    for (let i = 0; i < 4; i++) st = penguinStep(st, 0);
    expect(st.dig).toBeGreaterThan(0);
    expect(st.sfx).toContainEqual({ id: PENGUIN_ARRIVE_SOUND });
    expect(st.sfx).toContainEqual({ id: PENGUIN_DIG_SOUND, loop: true });
    expect(PENGUIN_ARRIVE_SOUND).toBe(12);
    expect(PENGUIN_DIG_SOUND).toBe(11);
  });

  it('★ 企鵝：挖到 → 停 11 + 按类型的音（类型 5 → 18）@source 0x004129ab / 0x475051', () => {
    const base = penguinStart(5);
    const cell = base.cell;
    const board = base.board.slice();
    board[cell] = 5;
    const st = { ...base, phase: 'play' as const, intro: 0, board, dig: 1 };
    const after = penguinStep(st, 0);
    expect(after.dig).toBe(0);
    expect(after.sfx).toContainEqual({ id: PENGUIN_DIG_SOUND, stop: true });
    expect(after.sfx).toContainEqual({ id: PENGUIN_LOOT_SOUND[5] });
    // 类型 1 → 15、2 → 16、3/4 → 17、5 → 18（类型 0 不放）
    expect(PENGUIN_LOOT_SOUND).toEqual([11, 15, 16, 17, 17, 18]);
  });

  it('★ 企鵝：结算姿势音 13（>55）/ 14（<40）是循环，动画放完停 @source 0x004149de / 0x004149e8', () => {
    const one = penguinStart(7);
    const hi = { ...one, phase: 'play' as const, intro: 0, ticks: 1, counts: [0, 0, 0, 0, 0, 4] };
    const hiAfter = penguinStep(hi, 0);
    expect(hiAfter.endPose).toBe('hi');
    expect(hiAfter.sfx).toContainEqual({ id: PENGUIN_END_HI_SOUND, loop: true });
    const lo = { ...one, phase: 'play' as const, intro: 0, ticks: 1, counts: [0, 0, 0, 0, 0, 0] };
    expect(penguinStep(lo, 0).sfx).toContainEqual({ id: PENGUIN_END_LO_SOUND, loop: true });
    // 姿势动画跑完 → 停
    const done = penguinStep({ ...hiAfter, phase: 'end' as const, endFrame: 999 }, 0);
    expect(done.phase).toBe('score');
    expect(done.sfx).toContainEqual({ id: PENGUIN_END_HI_SOUND, stop: true });
    expect(PENGUIN_END_HI_SOUND).toBe(13);
    expect(PENGUIN_END_LO_SOUND).toBe(14);
  });

  it('★ 氣球：点爆 21 / 点空 20 / 生成 19 @source 0x00414dd2 / 0x00414f0d / 0x00413077', () => {
    const mk = (type: number): ReturnType<typeof balloonStart> => {
      const st = balloonStart(1);
      const balloons = st.balloons.map((b, i) =>
        i === 0 ? { x: 0x78, y: 200, type, popped: 0 } : { ...b },
      );
      return { ...st, balloons, phase: 'play', intro: 0 };
    };
    expect(balloonClick(mk(3), 0x78, 200).sfx).toContainEqual({ id: BALLOON_POP_SOUND });
    expect(balloonClick(mk(3), 5, 5).sfx).toContainEqual({ id: BALLOON_MISS_SOUND });
    // 生成
    let st: ReturnType<typeof balloonStart> = { ...balloonStart(4242), phase: 'play', intro: 0 };
    let spawned = false;
    for (let i = 0; i < 400 && !spawned; i++) {
      st = balloonStep(st, i * BALLOON_TICK_MS);
      if (st.sfx.some((e) => e.id === BALLOON_SPAWN_SOUND)) spawned = true;
    }
    expect(spawned).toBe(true);
    expect(BALLOON_SPAWN_SOUND).toBe(19);
    expect(BALLOON_MISS_SOUND).toBe(20);
    expect(BALLOON_POP_SOUND).toBe(21);
  });

  it('★ 財神：落炸彈 22 + 24 循环；接到 → 停 24 + 爆炸 15 @source 0x00413809 / 0x00413436', () => {
    // 预警第 8 帧真的落炸彈
    const warn = { ...giftStart(1), phase: 'play' as const, intro: 0, warnFrame: 7, warnX: 200 };
    const after = giftStep(warn, 0, catchBoxOf(null, 320, GIFT_CATCHER_Y), 0);
    expect(after.sfx).toContainEqual({ id: GIFT_BOMB_SOUND });
    expect(after.sfx).toContainEqual({ id: GIFT_BOMB_LOOP_SOUND, loop: true });

    // 接到炸彈 → 停哨音 + 爆炸
    const bomb = {
      ...giftStart(1),
      phase: 'play' as const,
      intro: 0,
      catcherDir: 1,
      items: giftStart(1).items.map((it, i) =>
        i === 0 ? { x: 320, y: 300, type: 4, frame: 0, speed: 0 } : { ...it },
      ),
    };
    const box = { x0: 300, y0: 250, x1: 340, y1: 400 };
    // 鼠标放最左 → 玩家保持朝右（`catcherDir !== 0` 才判接住）
    const boom = giftStep(bomb, -1000, box, 0);
    expect(boom.endPose).toBe(4);
    // 屏上没别的掉落物 → 同一拍就直接进大号分数（`phase` 会是 'score'）
    expect(boom.sfx).toContainEqual({ id: GIFT_BOMB_LOOP_SOUND, stop: true });
    expect(boom.sfx).toContainEqual({ id: GIFT_BOOM_SOUND });
    expect(GIFT_BOMB_SOUND).toBe(22);
    expect(GIFT_BOMB_LOOP_SOUND).toBe(24);
    expect(GIFT_BOOM_SOUND).toBe(15);
  });
});

describe('★ 入场 FLIC 的闸门 @source rich4_small_games.asm:4230-4233（D-MINI-3）', () => {
  it('★★ 只有**真人**且「動畫過程」开着才播', () => {
    const now = 1000;
    // 真人 + 动画开 → 播，时长 = 帧数 × 每帧毫秒
    const on = introPlayback(1, true, 20, 14, now, SPECIAL_KIND.PENGUIN_DIG);
    expect(on).not.toBeNull();
    expect(on!.at).toBe(now);
    expect(on!.until).toBe(now + 20 * 14);
    // 动画**省略**也按「开」（与加这个出口之前的行为一致）
    expect(introPlayback(1, undefined, 20, 14, now, SPECIAL_KIND.PENGUIN_DIG)).not.toBeNull();
    // 電腦（whoPlays = 2）不播
    expect(introPlayback(2, true, 20, 14, now, SPECIAL_KIND.PENGUIN_DIG)).toBeNull();
    // 出局（0）不播
    expect(introPlayback(0, true, 20, 14, now, SPECIAL_KIND.PENGUIN_DIG)).toBeNull();
    // 「動畫過程」关掉不播
    expect(introPlayback(1, false, 20, 14, now, SPECIAL_KIND.PENGUIN_DIG)).toBeNull();
    // 影片还没解好（帧数 0）不播 —— 不能拿「空的」挡住整个小游戏
    expect(introPlayback(1, true, 0, 14, now, SPECIAL_KIND.PENGUIN_DIG)).toBeNull();
  });

  it('★ 每帧毫秒缺失时退回该小游戏自己的 tick（企鵝/氣球 100ms、財神 50ms）', () => {
    const a = introPlayback(1, true, 4, 0, 0, SPECIAL_KIND.PENGUIN_DIG)!;
    expect(a.until).toBe(4 * minigameTickMs(SPECIAL_KIND.PENGUIN_DIG));
    const b = introPlayback(1, true, 4, 0, 0, SPECIAL_KIND.GIFT_FROM_SKY)!;
    expect(b.until).toBe(4 * minigameTickMs(SPECIAL_KIND.GIFT_FROM_SKY));
    expect(minigameTickMs(SPECIAL_KIND.GIFT_FROM_SKY)).not.toBe(
      minigameTickMs(SPECIAL_KIND.PENGUIN_DIG),
    );
  });

  it('★ 入场那一支挂的是 `Panel.mkf` #0x4e', () => {
    expect(MINI_ARCHIVE).toBe('Panel.mkf');
    expect(MINI_INTRO_FLIC_RES).toBe(0x4e);
  });
});

describe('★ 入场影片**异步到手**也要能播（第一版被第一帧的 null 吞掉）', () => {
  it('★★ 闸门过了、影片还没解好 → 先不播但要**继续等**；等够久才认命', () => {
    // `env.flic` 的契约：第一次一定 null，解完会自己重画。
    // 所以 `ensureRun` 不能只在第一帧判一次 —— 那样整段演出永远不播。
    // 这里钉两条常量语义：放弃的阈值存在、且是个合理的等待窗口。
    expect(MINI_INTRO_GIVE_UP_MS).toBeGreaterThan(0);
    expect(MINI_INTRO_GIVE_UP_MS).toBeLessThanOrEqual(5000);
    // 闸门本身仍然照原版（真人 + 動畫過程）—— 与「影片没到手」是两件事
    expect(introPlayback(1, true, 20, 114, 0, SPECIAL_KIND.PENGUIN_DIG)).not.toBeNull();
    expect(introPlayback(2, true, 20, 114, 0, SPECIAL_KIND.PENGUIN_DIG)).toBeNull();
  });
});

// ============================================================
//  定曲（外部审查：三处小游戏各一首，`fcn_004549cf` 的 0xc/0xb/0xa）
// ============================================================

describe('★ 三处定曲 @source rich4_small_games.asm:4335/4481/4638', () => {
  it('★★ 曲号 → 文件名：企鵝 0xc→midi13 / 氣球 0xb→midi12 / 財神 0xa→midi11', () => {
    expect(SCREEN_BGM.minigamePenguin).toBe(0xc);
    expect(SCREEN_BGM.minigameBalloon).toBe(0xb);
    expect(SCREEN_BGM.minigameGift).toBe(0xa);
    expect(minigameBgmFile(SPECIAL_KIND.PENGUIN_DIG)).toBe('midi13.mid');
    expect(minigameBgmFile(SPECIAL_KIND.BALLOON)).toBe('midi12.mid');
    expect(minigameBgmFile(SPECIAL_KIND.GIFT_FROM_SKY)).toBe('midi11.mid');
    // 不认识的一律不点（不许瞎猜一首）
    expect(minigameBgmFile(0)).toBeNull();
    expect(minigameBgmFile(0x7fff)).toBeNull();
  });

  it('★★ 与 `SCREEN_BGM` / `bgmAssetFileFor` 那张表**逐项对得上**（两边不许各写一半）', () => {
    const pairs: readonly (readonly [number, number])[] = [
      [SPECIAL_KIND.PENGUIN_DIG, SCREEN_BGM.minigamePenguin as number],
      [SPECIAL_KIND.BALLOON, SCREEN_BGM.minigameBalloon as number],
      [SPECIAL_KIND.GIFT_FROM_SKY, SCREEN_BGM.minigameGift as number],
    ];
    for (const [game, raw] of pairs) {
      const id = bgmTrackIdOf(raw);
      expect(minigameBgmFile(game)).toBe(bgmAssetFileFor(id));
    }
  });

  it('★ 定曲与入场 FLIC 共用同一道闸门（AI 玩 / 動畫過程关掉 → 连曲都没有）', () => {
    expect(introGateOpen(1, true)).toBe(true);
    expect(introGateOpen(1, undefined)).toBe(true);
    expect(introGateOpen(2, true)).toBe(false);
    expect(introGateOpen(0, true)).toBe(false);
    expect(introGateOpen(1, false)).toBe(false);
  });

  it('★★ 真过一遍 `tick`：真人在玩 → 点一首，且**只点一次**', () => {
    // ★ 三个小游戏共用一条 `ensureRun`；同一局重复 tick 不许把曲子重头点。
    //   为了不看「上一个用例留下的 run」，三段各换一个小游戏（game 变了才会重开）。
    const played: string[] = [];
    const mk = (game: number, whoPlays: number, animation: boolean | undefined): UiScreenEnv => {
      const state = {
        pending: { kind: 'minigame', game },
        currentPlayer: 0,
        players: [{ whoPlays }],
        day: 3,
        month: 5,
        year: 1,
      } as unknown as GameState;
      return {
        screen: 'game',
        state,
        topo: { nodes: [], lands: [], facilities: [] } as never,
        map: null as never,
        now: 0,
        stage: null as never,
        sprite: () => null,
        flic: () => null,
        dispatch: () => undefined,
        requestRender: () => undefined,
        log: () => undefined,
        playEffect: () => undefined,
        stopEffect: () => undefined,
        // `exactOptionalPropertyTypes`：省略 = 「没给」，不能塞个显式 undefined
        ...(animation === undefined ? {} : { animation }),
        music: (f: string) => played.push(f),
      };
    };

    // ① 真人在玩 → 点 0xc
    minigameScreen.tick!(mk(SPECIAL_KIND.PENGUIN_DIG, 1, true));
    expect(played).toEqual(['midi13.mid']);
    // 同一局再来几帧 → 不再点（`introTried` 那一段每帧重试也点不着第二次）
    minigameScreen.tick!(mk(SPECIAL_KIND.PENGUIN_DIG, 1, true));
    minigameScreen.tick!(mk(SPECIAL_KIND.PENGUIN_DIG, 1, true));
    expect(played).toEqual(['midi13.mid']);

    // ② 电脑在玩 → 一声不响（原版整个分支被跳过）
    minigameScreen.tick!(mk(SPECIAL_KIND.BALLOON, 2, true));
    expect(played).toEqual(['midi13.mid']);

    // ③ 「動畫過程」关掉 → 也不点
    minigameScreen.tick!(mk(SPECIAL_KIND.GIFT_FROM_SKY, 1, false));
    expect(played).toEqual(['midi13.mid']);
  });
});

// ============================================================
//  ★★ 第十六份试玩回报（2026-09-24）：天降鴻福
// ============================================================

describe('★★ 天降鴻福：財神走满全场 @source loc_00413886..loc_00413a22（第十六份回报）', () => {
  const offBox = catchBoxOf(null, -5000, GIFT_CATCHER_Y);
  /** 跑一局真实时长（360 tick），记下每一拍的財神状态 */
  function run(seed: number, ticks = GIFT_PLAY_TICKS): ReturnType<typeof giftStart>[] {
    let st: ReturnType<typeof giftStart> = { ...giftStart(seed), phase: 'play', intro: 0, ticks: 100000 };
    const out = [st];
    for (let i = 0; i < ticks; i++) {
      st = giftStep(st, -5000, offBox, 0);
      out.push(st);
    }
    return out;
  }

  it('★ 拿主意那一拍的落点恒为 170+72k（往右）/ 470−72k（往左）—— 一趟 5 帧 + 1 拍 = 72px', () => {
    // `loc_004138fd` / `loc_004139f9` 贯穿进 `loc_00413926` / `loc_00413a22` 把帧清零 ⇒
    // 两次拿主意之间一定隔着 5 帧走行（各 ±12）+ 拿主意那一拍（±12）
    const right = new Set<number>();
    const left = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const trail = run(seed * 7919);
      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1]!;
        if (prev.godState === 0 && prev.godFrame === 5) right.add(prev.godX);
        if (prev.godState === 4 && prev.godFrame === 5) left.add(prev.godX);
        // 拿主意那一拍之后帧一定回到 0（不论转身还是继续走）
        if ((prev.godState === 0 || prev.godState === 4) && prev.godFrame === 5) {
          expect(trail[i]!.godFrame, `seed ${seed} tick ${i}`).toBe(0);
        }
      }
    }
    expect([...right].sort((a, b) => a - b)).toEqual([170, 242, 314, 386, 458, 530]);
    expect([...left].sort((a, b) => a - b)).toEqual([110, 182, 254, 326, 398, 470]);
  });

  it('★ 一局（360 tick）里两个端点 110 / 530 都走得到，且只在 [110, 530] 里、步距 12', () => {
    let hitMax = 0;
    let backToMin = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const xs = run(seed * 7919).map((s) => s.godX);
      if (xs.includes(GIFT_GOD_X_MAX)) hitMax++;
      // 起手就在 110（`[0x48bd4c] = 0x6e`），所以左端要看「离开之后又回来过」
      const firstLeave = xs.findIndex((x) => x !== GIFT_GOD_X_MIN);
      if (xs.slice(firstLeave).includes(GIFT_GOD_X_MIN)) backToMin++;
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(GIFT_GOD_X_MIN);
        expect(x).toBeLessThanOrEqual(GIFT_GOD_X_MAX);
        expect((x - GIFT_GOD_X_MIN) % 12).toBe(0);
      }
    }
    // 修后实测 40/40 到过 530、39/40 回到过 110；旧实现（帧不清零）只有 7/40 到过 530
    expect(hitMax).toBeGreaterThanOrEqual(36);
    expect(backToMin).toBeGreaterThanOrEqual(36);
  });

  it('★ 停留时间铺满全场，不再挤在中线两侧（旧实现 80% 时间在 [242, 398]）', () => {
    let inMiddle = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const s of run(seed * 7919)) {
        total++;
        if (s.godX >= 242 && s.godX <= 398) inMiddle++;
      }
    }
    // 修后实测 ≈ 44%；[242, 398] 占整段 [110, 530] 的 37%。旧实现（帧不清零）实测 ≈ 80%。
    expect(inMiddle / total).toBeLessThan(0.55);
  });

  it('★ 走行的每一趟（5 帧）撒且只撒一个幣 @0x00413899 / @0x0041399a', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const trail = run(seed * 104729);
      let walks = 0;
      let coins = 0;
      for (let i = 1; i < trail.length; i++) {
        const prev = trail[i - 1]!;
        const cur = trail[i]!;
        if ((prev.godState === 0 || prev.godState === 4) && prev.godFrame === 4) walks++;
        // 这一拍刚生成的：还停在起点、速度还是初速（已有的每拍都 +2，不会再是 −16）
        coins += cur.items.filter((it) => it.x !== 0 && it.type !== 4 && it.y === GIFT_ITEM_Y0 && it.speed === -16).length;
      }
      // 起手那一趟从帧 0 开始（状态 3 → 0 时清零），之后每趟都有一个撒幣帧；槽满（16 个）才会丢
      // 最后一拍可能停在一趟的半路：撒幣帧已过、那一趟还没走完
      expect(coins - walks, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(coins - walks, `seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('状态 1 原版跳表直接落 `loc_00413a2b`（什么都不做）', () => {
    const st = { ...giftStart(5), phase: 'play' as const, intro: 0, godState: 1, godFrame: 2, godX: 300 };
    const next = giftStep(st, -5000, offBox, 0);
    expect(next.godState).toBe(1);
    expect(next.godFrame).toBe(2);
    expect(next.godX).toBe(300);
  });
});

describe('★★ 结算大号分数：透明贴、按锚点贴 @source fcn_00414789 → 0x00414816 call fcn_00456418', () => {
  it('每个大字都要抠黑（`draw_non_zero_image_in_rect`）并减去图自带原点', () => {
    const calls: { index: number; keyed: boolean }[] = [];
    const sprite = ((_a: string, _r: number, index: number, keyed?: boolean) => {
      calls.push({ index, keyed: keyed === true });
      return { bitmap: {} as ImageBitmap, width: 60, height: 76, anchorX: 30, anchorY: 41 };
    }) as unknown as Parameters<typeof drawBigScore>[1];
    const at: [number, number][] = [];
    const ctx = {
      drawImage: (_b: unknown, x: number, y: number) => {
        at.push([x, y]);
      },
    } as unknown as CanvasRenderingContext2D;
    drawBigScore(ctx, sprite, 47);
    // 图号：大号从 10 起 @0x004147e5 `sub edx, 0x26`
    expect(calls.map((c) => c.index)).toEqual([14, 17]);
    expect(calls.every((c) => c.keyed)).toBe(true);
    // x0 = 0x161 − 33×位数；每字 +0x42；落点 = x − 锚点
    const x0 = MINI_BIG_CENTER_X - 33 * 2;
    expect(at).toEqual([
      [x0 - 30, MINI_BIG_Y - 41],
      [x0 + MINI_BIG_PITCH - 30, MINI_BIG_Y - 41],
    ]);
  });

  it('HUD 小号数字仍是不透明贴（`fcn_004563f5`）', () => {
    const keyed: boolean[] = [];
    const sprite = ((_a: string, _r: number, _i: number, k?: boolean) => {
      keyed.push(k === true);
      return { bitmap: {} as ImageBitmap, width: 15, height: 28, anchorX: 0, anchorY: 0 };
    }) as unknown as Parameters<typeof drawNumber>[1];
    const ctx = { drawImage: () => undefined } as unknown as CanvasRenderingContext2D;
    drawNumber(ctx, sprite, '123', 0, 0, MINI_DIGIT_PITCH, 0, 3);
    expect(keyed).toEqual([false, false, false]);
  });
});

// ============================================================
//  ★★ 第二十一份試玩回報（2026-09-24，联机第 12 回合）：
//  「打气球游戏时鼠标指针没换成瞄准镜，没有出现炸弹气球以及配套规则」
// ============================================================

describe('★★ 七彩氣球的准星 @source 0x00414d85..0x00414d95 `fcn_004021f8(9,3,5)` + `fcn_00402460(1)`', () => {
  it('★ 指针图是 `Data.mkf` #0 的图 9/10/11，每 20ms 一拍、每帧 5 拍 = 100ms 轮一张', () => {
    // 0x00402108..0x0040211a `read_mkf([0x48a0e4] = Data.mkf, 0)`；0x004021a3 `timeSetEvent(0x14, …)`
    expect(CURSOR_ARCHIVE).toBe('Data.mkf');
    expect(CURSOR_RESOURCE).toBe(0);
    expect(CURSOR_TICK_MS).toBe(20);
    expect(BALLOON_CURSOR).toEqual({ image: 9, frames: 3, ticks: 5 });
    expect(cursorImageAt(BALLOON_CURSOR, 0)).toBe(9);
    expect(cursorImageAt(BALLOON_CURSOR, 99)).toBe(9);
    expect(cursorImageAt(BALLOON_CURSOR, 100)).toBe(10);
    expect(cursorImageAt(BALLOON_CURSOR, 219)).toBe(11);
    expect(cursorImageAt(BALLOON_CURSOR, 300)).toBe(9); // 帧号 == 帧数 回 0（0x00402058）
    // 单帧的指针（例如收场换回的箭头 0x29）不动
    expect(cursorImageAt(cursorShape(0x29), 12345)).toBe(0x29);
  });

  it('★ 入场、结算没有指针；能打的两段（play / ending）才有准星', () => {
    const st = balloonStart(1);
    expect(balloonCursorShown(st)).toBe(false); // intro：0x405 还没来
    expect(balloonCursorShown({ ...st, phase: 'play' })).toBe(true);
    expect(balloonCursorShown({ ...st, phase: 'ending' })).toBe(true);
    // `[0x48bd58] == 2` 那一拍 0x00414d05 `fcn_00402460(0)` 收起，才画大号分数
    expect(balloonCursorShown({ ...st, phase: 'score' })).toBe(false);
  });

  it('★ 交给软件指针的请求：能打那几段要准星（触屏上也画）；旁观端、入场影片中、財神那屏都藏', () => {
    const balloon = { ...balloonStart(1), phase: 'play' as const };
    const base = { balloon, spectator: false, intro: null };
    // `touch: true` = 触屏上也画（跟着手指的点 / 拖走）—— 触屏上唯一画出来的指针
    expect(miniCursorWant(base)).toEqual({ shape: BALLOON_CURSOR, touch: true });
    expect(miniCursorWant({ ...base, spectator: true })).toBeNull();
    expect(miniCursorWant({ ...base, intro: { at: 0, until: 5000 } })).toBeNull();
    expect(miniCursorWant({ ...base, balloon: { ...balloon, phase: 'score' } })).toBeNull();
    // 財神接金幣（既不是氣球也不是企鵝）：整局藏着（#10）
    expect(miniCursorWant({ ...base, balloon: null })).toBeNull();
    expect(miniCursorWant(null)).toBeNull();
  });
});

describe('★★ 七彩氣球的规则细节（第二十一份回报追查时对 exe 逐条复核）', () => {
  const withBalloons = (
    list: { x: number; y: number; type: number; popped: number }[],
    over: Partial<ReturnType<typeof balloonStart>> = {},
  ): ReturnType<typeof balloonStart> => {
    const st = balloonStart(99);
    const balloons = st.balloons.map((b, i) => list[i] ?? { ...b });
    return { ...st, balloons, phase: 'play', intro: 0, ...over };
  };

  it('★ 时间到了、屏上还有气球（ending）照样能打 @source 0x00414d9f 只拦 `[0x48bd58] == 2`', () => {
    const st = withBalloons([{ x: 0x78, y: 200, type: 4, popped: 0 }], { phase: 'ending', ticks: 0, score: 10 });
    expect(balloonShootable(st)).toBe(true);
    expect(balloonClick(st, 0x78, 200).score).toBe(15);
    // 入场中 / 结算中不理
    expect(balloonClick({ ...st, phase: 'intro' }, 0x78, 200).score).toBe(10);
    expect(balloonClick({ ...st, phase: 'score' }, 0x78, 200).score).toBe(10);
  });

  it('★「?」先清掉上一个效果再抽 @source 0x00414e5c / 0x00414e64', () => {
    const st = withBalloons([{ x: 0x78, y: 200, type: 11, popped: 0 }], { freeze: 7, speed: -1, score: 9 });
    const roll = new WatcomRng(st.rngState).next() % 6;
    const after = balloonClick(st, 0x78, 200);
    // 没抽到「定住」就不该还定着；没抽到「变速」速度就回到 ×1
    expect(after.freeze).toBe(roll === 1 ? BALLOON_FREEZE_TICKS : 0);
    expect(after.speed).toBe(roll === 2 ? -1 : roll === 3 ? 1 : 0);
  });

  it('★ 已在爆的气球不吃点、也不放「点空」音 @source 0x00414f35 `test 0xf0 / jne 下一个`', () => {
    const st = withBalloons([
      { x: 0x78, y: 200, type: 1, popped: 2 },
      { x: 0xc8, y: 200, type: 1, popped: 0 },
    ]);
    const after = balloonClick({ ...st, sfx: [] }, 0x78, 200);
    // 只有第二个（没爆、没点中）放一声 20
    expect(after.sfx.map((s) => s.id)).toEqual([BALLOON_MISS_SOUND]);
    expect(after.score).toBe(0);
  });

  it('★ 爆开后第 3 个 tick 置空（0x3c → 0x2c → 0x1c → 0x0c）@source 0x004130b6..0x004130d2', () => {
    let st = balloonClick(withBalloons([{ x: 0x78, y: 200, type: 1, popped: 0 }], { ticks: 100 }), 0x78, 200);
    st = balloonStep(st, 0);
    expect(st.balloons[0]?.x).toBe(0x78); // 0x2c：还画爆开图
    st = balloonStep(st, 100);
    expect(st.balloons[0]?.x).toBe(0x78); // 0x1c：还画
    st = balloonStep(st, 200);
    expect(st.balloons[0]?.x).toBe(0); // 0x0c：置空
  });

  it('★ 收场前剩余时间照减（「?」抽到 0 把它改回 1，下一拍再归 0）@source 0x00414cc9..0x00414ce0', () => {
    const st = withBalloons([{ x: 0x78, y: 100, type: 1, popped: 0 }], { phase: 'ending', ticks: 1 });
    const after = balloonStep(st, 0);
    expect(after.ticks).toBe(0);
    expect(after.phase).toBe('ending'); // 屏上还有气球，接着等
  });

  it('★★ 没有「炸彈氣球」：生成出来的类型只有 0..11，12 种气球图（#91 图 1..12）+ 爆开图 13', () => {
    // 生成 @0x004131a5 / 0x00412fe1 / 0x00413014：r<20 → 0..4、r<28 → 5..8、r<30 → 表 0x475039 = 9/10/11
    let st: ReturnType<typeof balloonStart> = { ...balloonStart(20260924), phase: 'play', intro: 0, ticks: 100000 };
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      st = balloonStep(st, i * BALLOON_TICK_MS);
      for (const b of st.balloons) if (b.x !== 0 && b.popped === 0) seen.add(b.type);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // 八条道都用得上（x = 600 那条也有）
    expect(BALLOON_LANES).toContain(0x258);
  });
});

describe('★★ 七彩氣球整屏：本机在玩 vs 联机旁观', () => {
  interface Drawn {
    archive: string;
    res: number;
    index: number;
    x: number;
    y: number;
  }
  const mkEnv = (
    opts: { now: number; localSeat?: number | null | undefined; pending?: boolean },
    sink: { dispatched: unknown[]; effects: number[]; drawn: Drawn[] },
  ): UiScreenEnv => {
    const state = {
      pending: opts.pending === false ? null : { kind: 'minigame', game: SPECIAL_KIND.BALLOON },
      currentPlayer: 0,
      players: [{ whoPlays: 1, points: 0 }, { whoPlays: 1, points: 0 }],
      day: 1,
      month: 1,
      year: 1,
    } as unknown as GameState;
    let last: Drawn | null = null;
    const stage = {
      drawImage: (bmp: unknown, x: number, y: number) => {
        if (last !== null && bmp === last) sink.drawn.push({ ...(bmp as Drawn), x, y });
      },
    } as unknown as CanvasRenderingContext2D;
    return {
      screen: 'game',
      state,
      topo: { nodes: [], lands: [], facilities: [] } as never,
      map: null as never,
      now: opts.now,
      stage,
      animation: false, // 不播入场影片，直接进游戏
      sprite: (archive: string, res: number, index: number) => {
        const tag = { archive, res, index, x: 0, y: 0 };
        last = tag as Drawn;
        // 锚点照素材：准星 (15,14)，其余 (0,0)
        const anchor = archive === 'Data.mkf' ? { anchorX: 15, anchorY: 14 } : { anchorX: 0, anchorY: 0 };
        return { bitmap: tag as unknown as ImageBitmap, width: 31, height: 29, ...anchor };
      },
      flic: () => null,
      dispatch: (a) => sink.dispatched.push(a),
      requestRender: () => undefined,
      log: () => undefined,
      playEffect: (id: number) => sink.effects.push(id),
      stopEffect: () => undefined,
      ...(opts.localSeat === undefined ? {} : { localSeat: opts.localSeat }),
    };
  };

  /** 跑到屏上有气球为止（最多 60 拍），返回此刻的时间 */
  const playUntilBalloons = (localSeat: number | null | undefined, sink: { dispatched: unknown[]; effects: number[]; drawn: Drawn[] }): number => {
    // 先把上一个用例的那一局清掉（pending 没了 ⇒ run = null）
    minigameScreen.tick!(mkEnv({ now: 0, pending: false, localSeat }, sink));
    let now = 1000;
    minigameScreen.tick!(mkEnv({ now, localSeat }, sink));
    for (let i = 0; i < 60; i++) {
      now += BALLOON_TICK_MS;
      minigameScreen.tick!(mkEnv({ now, localSeat }, sink));
      sink.drawn.length = 0;
      minigameScreen.draw(mkEnv({ now, localSeat }, sink));
      if (sink.drawn.some((d) => d.archive === 'Panel.mkf' && d.res === BALLOON_RES && d.index >= 1 && d.index <= 12)) {
        return now;
      }
    }
    throw new Error('60 拍都没生成气球');
  };

  it('★★ 单机 / 联机的玩家本人：软件指针换成准星（触屏也画）、舞台上不另画、点空放 20、打完送分', () => {
    const sink = { dispatched: [] as unknown[], effects: [] as number[], drawn: [] as Drawn[] };
    for (const seat of [undefined, 0] as const) {
      sink.dispatched.length = 0;
      let now = playUntilBalloons(seat, sink);
      const env = mkEnv({ now, localSeat: seat }, sink);
      // 交给 `soft-cursor.ts` 的那一支：图 9 起 3 帧、每帧 5 拍；接管整屏时它就是最终那一支
      expect(minigameScreen.cursor!(env)).toEqual({ shape: BALLOON_CURSOR, touch: true });
      expect(resolveCursor({ ...BOARD_IDLE, overlay: minigameScreen.cursor!(env) })).toEqual({ shape: BALLOON_CURSOR, touch: true });
      // 准星由软件指针那一层画（盖在最上面），舞台上不再画 `Data.mkf` #0
      sink.drawn.length = 0;
      minigameScreen.draw(env);
      expect(sink.drawn.filter((d) => d.archive === 'Data.mkf')).toEqual([]);
      // 往左上角空处点一下：屏上的每个气球都放一声「点空」
      sink.effects.length = 0;
      minigameScreen.down!(2, 2, mkEnv({ now, localSeat: seat }, sink));
      expect(sink.effects.length).toBeGreaterThan(0);
      expect(new Set(sink.effects)).toEqual(new Set([BALLOON_MISS_SOUND]));
      // 打完：送一条 `minigame`
      for (let i = 0; i < 400 && sink.dispatched.length === 0; i++) {
        now += BALLOON_TICK_MS * 5;
        minigameScreen.tick!(mkEnv({ now, localSeat: seat }, sink));
      }
      expect(sink.dispatched).toEqual([{ type: 'minigame', score: 0 }]);
    }
  });

  it('★★ 联机旁观：没有准星（软件指针藏着）、点了不算、不送分、不亮自己那份 0 分', () => {
    const sink = { dispatched: [] as unknown[], effects: [] as number[], drawn: [] as Drawn[] };
    let now = playUntilBalloons(1, sink);
    // 旁观端不作答 ⇒ 不换准星、也不放箭头（别人那一屏的指针不归本机）
    expect(minigameScreen.cursor!(mkEnv({ now, localSeat: 1 }, sink))).toBeNull();
    expect(resolveCursor({ ...BOARD_IDLE, overlay: minigameScreen.cursor!(mkEnv({ now, localSeat: 1 }, sink)) })).toBeNull();
    sink.drawn.length = 0;
    minigameScreen.draw(mkEnv({ now, localSeat: 1 }, sink));
    expect(sink.drawn.filter((d) => d.archive === 'Data.mkf')).toEqual([]);
    sink.effects.length = 0;
    minigameScreen.down!(2, 2, mkEnv({ now, localSeat: 1 }, sink));
    expect(sink.effects).toEqual([]);
    for (let i = 0; i < 400; i++) {
      now += BALLOON_TICK_MS * 5;
      minigameScreen.tick!(mkEnv({ now, localSeat: 1 }, sink));
    }
    expect(sink.dispatched).toEqual([]);
    // 本机那一局早就演完了：画面停在空天上，不画大号分数（大号数字 = Panel #79 图 10..19）
    sink.drawn.length = 0;
    minigameScreen.draw(mkEnv({ now, localSeat: 1 }, sink));
    expect(sink.drawn.filter((d) => d.res === MINI_FONT_RES && d.index >= 10)).toEqual([]);
    // 玩家那台的分数广播到了 ⇒ pending 清掉 ⇒ 屏关、指针还原
    minigameScreen.tick!(mkEnv({ now, localSeat: 1, pending: false }, sink));
    expect(minigameScreen.active(mkEnv({ now, localSeat: 1, pending: false }, sink))).toBe(false);
  });
});

// ============================================================
//  ★★ 企鵝挖寶的指针（与七彩氣球同一套软件指针）：
//  入场演出后 0x00414a95 `fcn_004021f8(0x2a, 1, 0)` + 0x00414a9f `fcn_00402460(1)`；
//  `[0x48bd58]` 1 → 2 那一拍 0x00414a2f `fcn_00402460(0)` + 0x00414a3d `fcn_004021f8(0x29, 1, 0)`
// ============================================================

describe('★★ 企鵝挖寶的靶圈指针 @source 0x00414a8f..0x00414a9f / 0x00414a0f..0x00414a3d', () => {
  it('★ 指针图是 `Data.mkf` #0 的图 42（0x2a），单帧不动', () => {
    // 0x00414a8f `push 0` / 0x00414a91 `push 1` / 0x00414a93 `push 0x2a` = (图, 帧数, 每帧几拍)
    expect(PENGUIN_CURSOR).toEqual({ image: 42, frames: 1, ticks: 0 });
    expect(cursorImageAt(PENGUIN_CURSOR, 0)).toBe(42);
    expect(cursorImageAt(PENGUIN_CURSOR, 98765)).toBe(42);
  });

  it('★ 阶段对上 `[0x48bd58]`：intro 没有；play / end（都是 0）有；score（= 2）没有', () => {
    const st = penguinStart(1);
    // intro = `[0x48bd7c]` 还在倒数（0x00414957），0x405 还没来
    expect(st.phase).toBe('intro');
    expect(penguinCursorShown(st)).toBe(false);
    expect(penguinCursorShown({ ...st, phase: 'play' })).toBe(true);
    expect(penguinCursorShown({ ...st, phase: 'end' })).toBe(true);
    expect(penguinCursorShown({ ...st, phase: 'score' })).toBe(false);
  });

  it('★ 真跑一遍：时间到（0x00414986）进 end 指针还在；姿势放完（0x00412b95 置 1 → 0x00414a1c 置 2）当拍就收', () => {
    // 最后一拍：`[0x48bd2c]` 1 → 0，`jle loc_00414a0a` 那一支挑结算姿势 —— `[0x48bd58]` 仍是 0
    let st = penguinStep({ ...penguinStart(7), phase: 'play', intro: 0, ticks: 1 }, 0);
    expect(st.phase).toBe('end');
    expect(penguinCursorShown(st)).toBe(true);
    let n = 0;
    while (st.phase === 'end') {
      st = penguinStep(st, n * PENGUIN_TICK_MS);
      if (st.phase === 'end') expect(penguinCursorShown(st)).toBe(true);
      n++;
    }
    // `1` 留不到下一拍：姿势放完的那一次 `penguinStep` 直接就是 score，指针已收
    expect(st.phase).toBe('score');
    expect(penguinCursorShown(st)).toBe(false);
  });

  it('★ 交给软件指针的请求：play / end 要靶圈（触屏也画，跟着手指）；旁观端、入场影片中、intro / score 都藏', () => {
    const penguin = { ...penguinStart(1), phase: 'play' as const };
    const base = { balloon: null, penguin, spectator: false, intro: null };
    const target = { shape: PENGUIN_CURSOR, touch: true };
    expect(miniCursorWant(base)).toEqual(target);
    expect(miniCursorWant({ ...base, penguin: { ...penguin, phase: 'end' } })).toEqual(target);
    expect(miniCursorWant({ ...base, spectator: true })).toBeNull();
    expect(miniCursorWant({ ...base, intro: { at: 0, until: 5000 } })).toBeNull();
    expect(miniCursorWant({ ...base, penguin: { ...penguin, phase: 'score' } })).toBeNull();
    expect(miniCursorWant({ ...base, penguin: { ...penguin, phase: 'intro' } })).toBeNull();
  });
});

describe('★★ 企鵝挖寶整屏：本机在玩 vs 联机旁观', () => {
  interface Drawn {
    archive: string;
    res: number;
    index: number;
    x: number;
    y: number;
  }
  type Sink = { dispatched: unknown[]; drawn: Drawn[] };
  const mkEnv = (opts: { now: number; localSeat?: number | null | undefined; pending?: boolean }, sink: Sink): UiScreenEnv => {
    const state = {
      pending: opts.pending === false ? null : { kind: 'minigame', game: SPECIAL_KIND.PENGUIN_DIG },
      currentPlayer: 0,
      players: [{ whoPlays: 1, points: 0 }, { whoPlays: 1, points: 0 }],
      day: 1,
      month: 1,
      year: 1,
    } as unknown as GameState;
    let last: Drawn | null = null;
    const stage = {
      drawImage: (bmp: unknown, x: number, y: number) => {
        if (last !== null && bmp === last) sink.drawn.push({ ...(bmp as Drawn), x, y });
      },
    } as unknown as CanvasRenderingContext2D;
    return {
      screen: 'game',
      state,
      topo: { nodes: [], lands: [], facilities: [] } as never,
      map: null as never,
      now: opts.now,
      stage,
      animation: false, // 不播入场影片
      sprite: (archive: string, res: number, index: number) => {
        const tag = { archive, res, index, x: 0, y: 0 };
        last = tag as Drawn;
        // 锚点照素材：图 42 = 31×17、热点 (16,9)；其余 (0,0)
        const anchor = archive === 'Data.mkf' ? { anchorX: 16, anchorY: 9 } : { anchorX: 0, anchorY: 0 };
        return { bitmap: tag as unknown as ImageBitmap, width: 31, height: 17, ...anchor };
      },
      flic: () => null,
      dispatch: (a) => sink.dispatched.push(a),
      requestRender: () => undefined,
      log: () => undefined,
      playEffect: () => undefined,
      stopEffect: () => undefined,
      ...(opts.localSeat === undefined ? {} : { localSeat: opts.localSeat }),
    };
  };
  /** 这一帧交给软件指针的那一支（`null` = 藏着）；顺带钉住舞台上不再画 `Data.mkf` #0 */
  let lastCursor: CursorWant = null;
  const cursorOf = (sink: Sink): CursorWant => {
    expect(sink.drawn.filter((d) => d.archive === 'Data.mkf')).toEqual([]);
    return lastCursor;
  };
  const TARGET = { shape: PENGUIN_CURSOR, touch: true };
  const endPoseDrawn = (sink: Sink): boolean => sink.drawn.some((d) => d.res === PENGUIN_END_LO_RES);
  const bigScoreDrawn = (sink: Sink): boolean => sink.drawn.some((d) => d.res === MINI_FONT_RES && d.index >= 10);

  /** 推一拍再画一帧 */
  const frame = (now: number, localSeat: number | null | undefined, sink: Sink): void => {
    minigameScreen.tick!(mkEnv({ now, localSeat }, sink));
    sink.drawn.length = 0;
    minigameScreen.draw(mkEnv({ now, localSeat }, sink));
    // main.ts 每帧：接管整屏的那一屏要什么，就是最终那一支（`resolveCursor`）
    lastCursor = resolveCursor({ ...BOARD_IDLE, overlay: minigameScreen.cursor!(mkEnv({ now, localSeat }, sink)) });
  };

  it('★★ 单机 / 联机的玩家本人：入场无指针 → 挖宝与结算姿势换靶圈（软件指针，触屏也画）→ 大号分数前收起', () => {
    for (const seat of [undefined, 0] as const) {
      const sink: Sink = { dispatched: [], drawn: [] };
      minigameScreen.tick!(mkEnv({ now: 0, pending: false, localSeat: seat }, sink)); // 清掉上一局
      let now = 1000;
      frame(now, seat, sink);
      // 从按 GO 起指针就藏着（0x0040126f）；入场（`[0x48bd7c]` 倒数）还没换上靶圈
      expect(cursorOf(sink)).toBeNull();
      for (let i = 0; i <= PENGUIN_INTRO_TICKS; i++) frame((now += PENGUIN_TICK_MS), seat, sink);
      // play：0x405 之后 0x00414a95 `fcn_004021f8(0x2a, 1, 0)` + 0x00414a9f `fcn_00402460(1)`
      expect(cursorOf(sink)).toEqual(TARGET);
      // 时间到 → 结算姿势（0 分 ⇒ 资源 85）：`[0x48bd58]` 还是 0，靶圈照画
      for (let i = 0; i < PENGUIN_PLAY_TICKS + 5 && !endPoseDrawn(sink); i++) frame((now += PENGUIN_TICK_MS), seat, sink);
      expect(endPoseDrawn(sink)).toBe(true);
      expect(cursorOf(sink)).toEqual(TARGET);
      // 姿势放完 → 0x00414a2f 收起，才画大号分数；之后一直藏着（0x00414a3d 换回的箭头不放出来）
      for (let i = 0; i < 100 && !bigScoreDrawn(sink); i++) {
        frame((now += PENGUIN_TICK_MS), seat, sink);
        if (!bigScoreDrawn(sink)) expect(cursorOf(sink)).toEqual(TARGET);
      }
      expect(bigScoreDrawn(sink)).toBe(true);
      expect(cursorOf(sink)).toBeNull();
      // 停 2000ms 后送分
      for (let i = 0; i < 40 && sink.dispatched.length === 0; i++) frame((now += PENGUIN_TICK_MS), seat, sink);
      expect(sink.dispatched).toEqual([{ type: 'minigame', score: 0 }]);
    }
  });

  it('★★ 联机旁观：整局没有靶圈（软件指针藏着）、点了不算、不送分', () => {
    const sink: Sink = { dispatched: [], drawn: [] };
    minigameScreen.tick!(mkEnv({ now: 0, pending: false, localSeat: 1 }, sink));
    let now = 1000;
    frame(now, 1, sink);
    expect(cursorOf(sink)).toBeNull();
    for (let i = 0; i <= PENGUIN_INTRO_TICKS; i++) frame((now += PENGUIN_TICK_MS), 1, sink);
    expect(cursorOf(sink)).toBeNull();
    for (let i = 0; i < PENGUIN_PLAY_TICKS + 60; i++) {
      frame((now += PENGUIN_TICK_MS), 1, sink);
      expect(cursorOf(sink)).toBeNull();
    }
    expect(sink.dispatched).toEqual([]);
    // 玩家那台的分数广播到了 ⇒ pending 清掉 ⇒ 屏关
    minigameScreen.tick!(mkEnv({ now, localSeat: 1, pending: false }, sink));
    expect(minigameScreen.active(mkEnv({ now, localSeat: 1, pending: false }, sink))).toBe(false);
  });
});

describe('★ gap-audit #11：先在画好的舞台上数入场拍，归零（0x405）才放入场影片 @source 0x00414c93..0x00414ca9 / 0x00414d60', () => {
  const mk = (game: number, now: number, flicReady: { v: boolean }, opts: { pending?: boolean; localSeat?: number } = {}): UiScreenEnv => {
    const state = {
      pending: opts.pending === false ? null : { kind: 'minigame', game },
      currentPlayer: 0,
      players: [{ whoPlays: 1, points: 0 }, { whoPlays: 1, points: 0 }],
      day: 2,
      month: 3,
      year: 1,
    } as unknown as GameState;
    const frames = Array.from({ length: 20 }, () => ({}) as ImageBitmap);
    return {
      screen: 'game',
      state,
      topo: { nodes: [], lands: [], facilities: [] } as never,
      map: null as never,
      now,
      stage: { drawImage: () => undefined } as unknown as CanvasRenderingContext2D,
      animation: true,
      sprite: () => null,
      // 第一次问一定 null（后台在解），之后才到手 —— 与 `env.flic` 的契约一样
      flic: () => {
        if (!flicReady.v) {
          flicReady.v = true;
          return null;
        }
        return { frames, frameMs: 100 } as never;
      },
      dispatch: () => undefined,
      requestRender: () => undefined,
      log: () => undefined,
      playEffect: () => undefined,
      stopEffect: () => undefined,
      music: () => undefined,
      ...(opts.localSeat === undefined ? {} : { localSeat: opts.localSeat }),
    };
  };

  const cases: [string, number, number][] = [
    ['企鵝挖寶（10 × 100ms）', SPECIAL_KIND.PENGUIN_DIG, PENGUIN_INTRO_TICKS * 100],
    ['七彩氣球（5 × 100ms）', SPECIAL_KIND.BALLOON, BALLOON_INTRO_TICKS * 100],
    ['財神接金幣（10 × 50ms）', SPECIAL_KIND.GIFT_FROM_SKY, GIFT_INTRO_TICKS * 50],
  ];
  for (const localSeat of [undefined, 0, 1]) {
    for (const [name, game, entryMs] of cases) {
      it(`${name}：入场拍 → 影片（20 帧 × 100ms）→ 开玩${localSeat === undefined ? '（单机）' : localSeat === 0 ? '（联机·玩家）' : '（联机·旁观）'}`, () => {
        const ready = { v: false };
        const seat = localSeat === undefined ? {} : { localSeat };
        minigameScreen.tick!(mk(game, 0, ready, { pending: false, ...seat }));
        expect(minigameIntroStage()).toBeNull();
        const t0 = 10_000;
        const step = minigameTickMs(game);
        minigameScreen.tick!(mk(game, t0, ready, seat));
        // ① 一开场先数入场拍 —— 影片**还没**放（旧实现这里就在放影片）
        expect(minigameIntroStage()).toBe('entry');
        let now = t0;
        while (now < t0 + entryMs - step) {
          now += step;
          minigameScreen.tick!(mk(game, now, ready, seat));
          expect(minigameIntroStage(), `t=${now - t0}`).toBe('entry');
        }
        // ② 数到 0 的那一拍 = PostMessage 0x405 → 影片
        now += step;
        minigameScreen.tick!(mk(game, now, ready, seat));
        minigameScreen.draw!(mk(game, now, ready, seat));
        expect(minigameIntroStage()).toBe('film');
        // ③ 影片放完之前一直阻塞，放完才开玩
        now += 1900;
        minigameScreen.tick!(mk(game, now, ready, seat));
        expect(minigameIntroStage()).toBe('film');
        now += 200;
        minigameScreen.tick!(mk(game, now, ready, seat));
        expect(minigameIntroStage()).toBe('play');
      });
    }
  }

  it('影片阻塞放的时候点击不算（原版在 `fcn_0045144f` 里，收不到 WM_LBUTTONDOWN）', () => {
    const ready = { v: true };
    const game = SPECIAL_KIND.PENGUIN_DIG;
    minigameScreen.tick!(mk(game, 0, ready, { pending: false }));
    let now = 50_000;
    minigameScreen.tick!(mk(game, now, ready));
    for (let i = 0; i < PENGUIN_INTRO_TICKS; i++) {
      now += 100;
      minigameScreen.tick!(mk(game, now, ready));
    }
    minigameScreen.draw!(mk(game, now, ready));
    expect(minigameIntroStage()).toBe('film');
    minigameScreen.down!(penguinCellX(3), penguinCellY(3), mk(game, now, ready));
    expect(minigameIntroStage()).toBe('film');
  });
});
