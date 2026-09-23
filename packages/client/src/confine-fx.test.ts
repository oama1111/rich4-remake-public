/*
 * 「送進監獄／醫院」那一段影片 —— Q-ANIM-1
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事，判据全部回 exe（VA 见 `confine-fx.ts` 的文件头）：
 *   ① **规格**：Data.mkf 0x20c = 62 帧 / 440×74 / 100 ms / 音效 92；
 *      0x21a = 35 帧 / 440×440 / 71 ms / 音效 94（逐字节核过资源头）；
 *   ② **落点**：屏幕 (0,210) / (0,40)，尺寸 440×74 / 440×440，**点不掉**（flags bit1 = 0）；
 *   ③ **什么时候播**：占用表 0→1 或计数变大；「動畫過程」关掉不播（main.ts 那一道闸）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import { tickBlockingCounter } from '@rich4/core';

import { LAYOUT } from './stage.ts';
import { boardFilmWaitsForEventBox } from './board-film.ts';
import {
  CONFINE_FX_ARCHIVE,
  CONFINE_HOSPITAL,
  CONFINE_PRISON,
  beginConfineFx,
  confineAfterEventBox,
  confineClip,
  confineFxBitmap,
  confineFxDone,
  confineFxFrame,
  confineFxTrigger,
  confineFxTriggers,
  confineSkippable,
  confineTotalMs,
  type ConfineKind,
} from './confine-fx.ts';

const DATA_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/Data.mkf';
const hasData = existsSync(DATA_MKF);
const runData = hasData ? it : it.skip;
const EXE = (process.env.RICH4_WORKSPACE ?? '') + '/Rich4/rich4.exe';
const runExe = existsSync(EXE) ? it : it.skip;
/** `rich4.exe` 的 VA → 文件偏移（与 `tools/disasm.py` 的换算同一条）*/
function exeBytes(va: number, n: number): number[] {
  const d = readFileSync(EXE);
  const off = 1024 + (va - 0x401000);
  return [...d.subarray(off, off + n)];
}

/** 只有占用表/计数两个字段的最小状态 */
function st(over: {
  pris?: number[];
  hosp?: number[];
  inPrison?: number[];
  inHospital?: number[];
}): Parameters<typeof confineFxTrigger>[0] {
  const n = 4;
  return {
    prisonOccupancy: over.pris ?? new Array<number>(n).fill(0),
    hospitalOccupancy: over.hosp ?? new Array<number>(n).fill(0),
    players: Array.from({ length: n }, (_, i) => ({
      blocking: { inPrison: over.inPrison?.[i] ?? 0, inHospital: over.inHospital?.[i] ?? 0 },
    })),
  };
}

describe('★ 影片规格 @source 资源头 + 调用点', () => {
  it('两段都在 Data.mkf，资源号 0x20c / 0x21a', () => {
    expect(CONFINE_FX_ARCHIVE).toBe('Data.mkf');
    expect(CONFINE_HOSPITAL.resource).toBe(0x20c);
    expect(CONFINE_PRISON.resource).toBe(0x21a);
    expect(confineClip('hospital')).toBe(CONFINE_HOSPITAL);
    expect(confineClip('prison')).toBe(CONFINE_PRISON);
  });

  it('★ 落点 = 屏幕 (0,210) / (0,40)；尺寸 440×74 / 440×440', () => {
    // @source 医院 VA 0x0043ed4a `push 0x5c / 0x1e0001 / 0xd2 / 0`
    expect(CONFINE_HOSPITAL.x).toBe(0);
    expect(CONFINE_HOSPITAL.y).toBe(0xd2);
    expect(CONFINE_HOSPITAL.y).toBe(210);
    expect(CONFINE_HOSPITAL.width).toBe(440);
    expect(CONFINE_HOSPITAL.height).toBe(74);
    // @source 入獄 VA 0x0043d69e `push 0x5e / 0x120001 / 0x28 / 0`
    expect(CONFINE_PRISON.x).toBe(0);
    expect(CONFINE_PRISON.y).toBe(0x28);
    expect(CONFINE_PRISON.y).toBe(40);
    expect(CONFINE_PRISON.width).toBe(440);
    expect(CONFINE_PRISON.height).toBe(440);
    // 交给渲染器的那个 y 要减掉棋盘原点（棋盘离屏画布从屏幕 y=40 起）
    expect(CONFINE_HOSPITAL.y - LAYOUT.board.y).toBe(170);
    expect(CONFINE_PRISON.y - LAYOUT.board.y).toBe(0);
  });

  it('★ 音效 92 / 94；**两段都点不掉**（flags bit1 = 0）', () => {
    expect(CONFINE_HOSPITAL.sound).toBe(0x5c);
    expect(CONFINE_HOSPITAL.sound).toBe(92);
    expect(CONFINE_PRISON.sound).toBe(0x5e);
    expect(CONFINE_PRISON.sound).toBe(94);
    expect(CONFINE_HOSPITAL.flags).toBe(0x1e0001);
    expect(CONFINE_PRISON.flags).toBe(0x120001);
    // @source `fcn_0045144f` VA 0x004514d6：bit1 置位才认点击/按键跳过
    expect(confineSkippable('hospital')).toBe(false);
    expect(confineSkippable('prison')).toBe(false);
  });

  it('★ 总时长 = 帧数 × 每帧（住院 6.2 s、入獄 2.485 s）', () => {
    expect(confineTotalMs('hospital')).toBe(62 * 100);
    expect(confineTotalMs('hospital')).toBe(6200);
    expect(confineTotalMs('prison')).toBe(35 * 71);
    expect(confineTotalMs('prison')).toBe(2485);
  });

  runData('★ 帧数/尺寸/每帧毫秒与资源头逐字节一致', () => {
    const a = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (const clip of [CONFINE_HOSPITAL, CONFINE_PRISON]) {
      const info = parseFlicInfo(a.read(clip.resource));
      expect(info, `资源 ${clip.resource.toString(16)} 应当是标准 FLIC`).not.toBeNull();
      expect(info!.frames).toBe(clip.frames);
      expect(info!.width).toBe(clip.width);
      expect(info!.height).toBe(clip.height);
      expect(info!.frameMs).toBe(clip.frameMs);
    }
  });
});

describe('★ 帧序与收场 @source `fcn_0045144f` 主循环', () => {
  it('一帧等 `frameMs` 毫秒；播完钉在最后一帧', () => {
    const fx = beginConfineFx('prison', 0);
    expect(confineFxFrame(fx, 0)).toBe(0);
    expect(confineFxFrame(fx, 70)).toBe(0);
    expect(confineFxFrame(fx, 71)).toBe(1);
    expect(confineFxFrame(fx, 71 * 34)).toBe(34);
    // 到点之后一直是最后一帧（不循环）
    expect(confineFxFrame(fx, 999999)).toBe(34);
  });

  it('时间到就收场；差 1 ms 还不收', () => {
    const fx = beginConfineFx('hospital', 1000);
    expect(confineFxDone(fx, 1000 + 6200 - 1)).toBe(false);
    expect(confineFxDone(fx, 1000 + 6200)).toBe(true);
  });

  it('影片没到货 → 这一帧给 null（棋盘照画，下一帧会补）', () => {
    const fx = beginConfineFx('prison', 0);
    expect(confineFxBitmap(fx, 0, null)).toBeNull();
    expect(confineFxBitmap(fx, 0, undefined)).toBeNull();
    const fake = { frames: [{ id: 'f0' }, { id: 'f1' }] } as never;
    expect(confineFxBitmap(fx, 0, fake)).toMatchObject({ id: 'f0' });
    expect(confineFxBitmap(fx, 71, fake)).toMatchObject({ id: 'f1' });
  });
});

describe('★ 什么时候播（占用表 / 计数的一拍之差）', () => {
  it('占用表 0→1 → 住院 / 入獄各一次', () => {
    expect(confineFxTrigger(st({}), st({ hosp: [0, 1, 0, 0] }))).toBe('hospital');
    expect(confineFxTrigger(st({}), st({ pris: [0, 0, 0, 1] }))).toBe('prison');
  });

  // ★★ 2026-09-23 订正（第十四份試玩回報，协调方拍板照 exe）：先前这一条断言「加刑照样播
  //   （原版每次 `send_to_*` 都重播）」—— exe 里不是这样：
  //     send_to_prison    0x0043d5d4 mov dh, [计数] / 0x0043d5da test dh, dh / 0x0043d5dc jne 0x43d6bd
  //     send_to_hospital  0x0043ec80 mov dh, [计数] / 0x0043ec86 test dh, dh / 0x0043ec88 jne 0x43ed6c
  //   原计数非 0 ⇒ 直接跳去「加天数」，搬位置与 0x21a / 0x20c 那一次 `fcn_0045144f` 都被跳过。
  //   字节钉在下面 `runExe` 那一条（以及 core 的 `confine-view.test.ts`）。
  it('★ 本来就在里面（加刑）计数变大 → **不播**（@source 0x0043ec86 / 0x0043d5da `test dh,dh / jne` 跳过播片）', () => {
    const before = st({ hosp: [1, 0, 0, 0], inHospital: [2, 0, 0, 0] });
    const after = st({ hosp: [1, 0, 0, 0], inHospital: [5, 0, 0, 0] });
    expect(confineFxTrigger(before, after)).toBeNull();
    const b2 = st({ pris: [1, 0, 0, 0], inPrison: [1, 0, 0, 0] });
    const a2 = st({ pris: [1, 0, 0, 0], inPrison: [4, 0, 0, 0] });
    expect(confineFxTrigger(b2, a2)).toBeNull();
  });

  runExe('★ 回 exe 钉：加刑那一支的跳转在播片之前', () => {
    // 0x0043d5da test dh, dh / jne rel32 → 0x43d6bd（> 0x0043d6aa 那一次 call 0x45144f）
    expect(exeBytes(0x43d5da, 8)).toEqual([0x84, 0xf6, 0x0f, 0x85, 0xdb, 0x00, 0x00, 0x00]);
    expect(0x43d5da + 2 + 6 + 0xdb).toBe(0x43d6bd);
    expect(0x43d6bd).toBeGreaterThan(0x43d6aa);
    // 0x0043ec86 test dh, dh / jne rel32 → 0x43ed6c（> 0x0043ed59 那一次 call 0x45144f）
    expect(exeBytes(0x43ec86, 8)).toEqual([0x84, 0xf6, 0x0f, 0x85, 0xde, 0x00, 0x00, 0x00]);
    expect(0x43ec86 + 2 + 6 + 0xde).toBe(0x43ed6c);
    expect(0x43ed6c).toBeGreaterThan(0x43ed59);
  });

  it('放出来（1→0、计数变小）不播', () => {
    const before = st({ hosp: [1, 0, 0, 0], inHospital: [3, 0, 0, 0] });
    const after = st({ hosp: [0, 0, 0, 0], inHospital: [0, 0, 0, 0] });
    expect(confineFxTrigger(before, after)).toBeNull();
  });

  it('★★ 刑满待释放（1 → 0x80）**不算**「刚被送医」—— 不许重播救护车', () => {
    // 需求方第 5 条：「NPC 角色走动后…自动呼出了救护车抬人的动画」。
    // 0x80 不是「更多天数」，是 `@source 0x41c8ea or ch,0x80` 那个**待释放**状态位。
    // 旧代码整字节比大小 ⇒ 0x80 > 1 成立 ⇒ 每住一次院都多播一遍 6.2 秒的影片。
    // —— 真实引擎产出的这一步用 core 的 `tickBlockingCounter` 算，不手写魔数：
    const release = tickBlockingCounter(1);
    expect(release.value).toBe(0x80); // 1 → 0x80（挂待释放），value 由 core 给
    const before = st({ hosp: [1, 0, 0, 0], inHospital: [1, 0, 0, 0] });
    const after = st({ hosp: [1, 0, 0, 0], inHospital: [release.value, 0, 0, 0] });
    expect(confineFxTrigger(before, after)).toBeNull();
    // 监狱同一条：1 → 0x80 也不许播
    expect(
      confineFxTrigger(
        st({ pris: [1, 0, 0, 0], inPrison: [1, 0, 0, 0] }),
        st({ pris: [1, 0, 0, 0], inPrison: [tickBlockingCounter(1).value, 0, 0, 0] }),
      ),
    ).toBeNull();
  });

  it('★ 首次送入照样播；加刑 / 待释放期间又被送进去都不播（原计数字节非 0 ⇒ 加刑支）', () => {
    // 加刑：`confine()` 写的是 `(existing + days) & 0x7f` —— 走 0x0043ed6c，不播
    expect(
      confineFxTrigger(
        st({ hosp: [1, 0, 0, 0], inHospital: [3, 0, 0, 0] }),
        st({ hosp: [1, 0, 0, 0], inHospital: [5, 0, 0, 0] }),
      ),
    ).toBeNull();
    // 待释放期间**又被送进去**：计数字节 0x80 非 0 ⇒ 同样走加刑支（(0x80 + 3) & 0x7f = 3），不播
    expect(
      confineFxTrigger(
        st({ hosp: [1, 0, 0, 0], inHospital: [0x80, 0, 0, 0] }),
        st({ hosp: [1, 0, 0, 0], inHospital: [3, 0, 0, 0] }),
      ),
    ).toBeNull();
    // 首次送入（占用表 0→1）
    expect(confineFxTrigger(st({}), st({ hosp: [0, 1, 0, 0], inHospital: [0, 3, 0, 0] }))).toBe(
      'hospital',
    );
  });

  it('什么都没变 → 不播', () => {
    const same = st({ hosp: [1, 0, 0, 0], inHospital: [3, 0, 0, 0] });
    expect(confineFxTrigger(same, same)).toBeNull();
  });

  it('两边同时成立时取**医院**（原版是两次串行播放，本引擎一次只播一段）', () => {
    const before = st({});
    const after = st({ hosp: [1, 0, 0, 0], pris: [1, 0, 0, 0] });
    expect(confineFxTrigger(before, after)).toBe('hospital');
  });

  it('遍历到**任意一位**玩家（0..3）都能认出来', () => {
    for (let i = 0; i < 4; i++) {
      const hosp = [0, 0, 0, 0];
      hosp[i] = 1;
      expect(confineFxTrigger(st({}), st({ hosp })), `slot ${i}`).toBe('hospital');
    }
  });
});

describe('★ main.ts 的接线（源码钉子）', () => {
  it('只在「動畫過程」开着时播；并且把回合驱动挡在影片后面', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    // @source 医院 VA 0x0043ed27 / 入獄 VA 0x0043d67b：`cmp [0x497159], 0 / je 跳过`
    expect(src).toContain('if (!options.animation) return;');
    // 起播与驱动闸
    expect(src).toContain('startConfineFx(before, state);');
    // 影片宿主那一道闸（住院/入獄/神明共用一份状态）—— W-51 起收在 `stageBusyFlags()`
    // 的**唯一一处定义**里，回合驱动（`holdForActorWalk`）与台词闸共用同一个纯函数
    expect(src).toContain('boardFilm: boardFilm !== null,');
    expect(src).toContain('pendingBoardFilm: pendingBoardFilm !== null,');
    expect(src).toContain('if (stageBusy(stageBusyFlags())) {');
    // 播完补一次回合驱动
    expect(src).toContain('resumeTurnDriver();');
    // 棋盘局部坐标（屏幕 y − 棋盘原点）
    expect(src).toContain('y: spec.y - LAYOUT.board.y');
  });

  it('渲染器按**棋盘局部**画建屋影片（先前直接用屏幕坐标 0x28，整体下移 40 px）', () => {
    const src = readFileSync(new URL('./render.ts', import.meta.url), 'utf8');
    expect(src).toContain('BUILD_FX_BOARD_Y');
    expect(src).not.toContain('BUILD_FX_Y, BUILD_FX_W');
  });
});

/**
 * ★★ 第十五份試玩回報（Charles，`wt16/20260923-212047821-manual-Charles.json`）：
 * 「忍太郎刚刚进监狱的动画太快了，前一个事件的弹窗还没看清楚就触发」——
 * 那一局 P3 踩到新聞格，抽到 29「%s違法超貸 經營者%s坐牢５天」，经营者是忍太郎（P1）；
 * 日志：`事件提示框：新聞 #29` 紧接着就是 `影片：開始 prison`（同一拍），框还没停满警车就开了。
 */
describe('★★ 新聞 / 命運引出的入獄・住院：等事件提示框收掉再播', () => {
  const ev = (kind: string) => ({ lastEvent: { kind } });

  it('判据 = `lastEvent` 换了引用且是新聞 / 命運（与事件框起播同一条）', () => {
    const none = { lastEvent: null };
    expect(confineAfterEventBox(none, ev('news'))).toBe(true);
    expect(confineAfterEventBox(none, ev('fortune'))).toBe(true);
    // 同一个引用 = 这一拍没抽事件（例：陷害卡、踩到惡犬）
    const same = ev('news');
    expect(confineAfterEventBox(same, same)).toBe(false);
    // 魔法屋 / 小遊戲不玩那两条走的是别的屏
    expect(confineAfterEventBox(none, ev('magicHouse'))).toBe(false);
    expect(confineAfterEventBox(none, ev('minigameDecline'))).toBe(false);
    expect(confineAfterEventBox(none, none)).toBe(false);
  });

  it('`afterEventBox` 只在事件框还在时押着；普通那一段不受影响', () => {
    const held = { ...confineClip('prison'), afterEventBox: true };
    expect(boardFilmWaitsForEventBox(held, true)).toBe(true);
    expect(boardFilmWaitsForEventBox(held, false)).toBe(false);
    expect(boardFilmWaitsForEventBox(confineClip('prison'), true)).toBe(false);
  });

  runExe('★ 回 exe 钉：框先停满，pass 1 才调 `send_to_prison`（影片在它里面）', () => {
    // 新聞 fcn_0044b6df：0x0044b862 push 0x960 / call 0x4544f6（2400 ms）
    expect(exeBytes(0x44b862, 10)).toEqual([0x68, 0x60, 0x09, 0x00, 0x00, 0xe8, 0x8a, 0x8c, 0x00, 0x00]);
    expect(0x44b867 + 5 + 0x8c8a).toBe(0x4544f6);
    // 0x0044b86f mov eax,[esp+0x10] / push 1 / call [eax*4 + 0x475e24] —— pass 1 在等待之后
    expect(exeBytes(0x44b86f, 13)).toEqual([
      0x8b, 0x44, 0x24, 0x10, 0x6a, 0x01, 0xff, 0x14, 0x85, 0x24, 0x5e, 0x47, 0x00,
    ]);
    // 新聞 29 pass 1：0x0044b35f push 5 / push eax / call 0x43d593（send_to_prison）
    expect(exeBytes(0x44b35f, 8)).toEqual([0x6a, 0x05, 0x50, 0xe8, 0x2c, 0x22, 0xff, 0xff]);
    expect(0x44b362 + 5 + (0xffff222c | 0)).toBe(0x43d593);
    // 命運 fcn_0044db81：0x0044dd44 push 0x640 / call 0x4544f6（1600 ms）→ pass 1 → 0x0044dd7b 800 ms
    expect(exeBytes(0x44dd44, 10)).toEqual([0x68, 0x40, 0x06, 0x00, 0x00, 0xe8, 0xa8, 0x67, 0x00, 0x00]);
    expect(exeBytes(0x44dd6f, 9)).toEqual([0x6a, 0x01, 0xff, 0x94, 0x03, 0xf0, 0x5e, 0x47, 0x00]);
    expect(exeBytes(0x44dd7b, 10)).toEqual([0x68, 0x20, 0x03, 0x00, 0x00, 0xe8, 0x34, 0x4b, 0x00, 0x00]);
    // 命運 33 pass 1：0x0044d8c2 call 0x43d593
    expect(exeBytes(0x44d8c2, 5)).toEqual([0xe8, 0xcc, 0xfc, 0xfe, 0xff]);
    expect(0x44d8c2 + 5 + (0xfffefccc | 0)).toBe(0x43d593);
  });

  it('main.ts 接线：送进去那一拍按判据带上 `afterEventBox`，起播两处都问事件框', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('const afterBox = confineAfterEventBox(before, after);');
    expect(src).toContain('afterBox ? { ...confineClip(hit.kind), afterEventBox: true }');
    expect(src).toContain('if (boardFilmWaitsForEventBox(pending, eventBoxScreen.active(uiEnv()))) {');
    expect(src).toContain('!boardFilmWaitsForEventBox(after, eventBoxScreen.active(uiEnv()))');
  });
});

describe('★★ 新聞 4：先飛碟，再每位受害者一辆救护车（不再被顶掉）', () => {
  it('`confineFxTriggers` 逐人列出（按玩家号；加刑的不列）', () => {
    const before = st({ inHospital: [0, 0, 2, 0] });
    const after = st({ hosp: [1, 1, 1, 1], inHospital: [3, 3, 5, 3] });
    expect(confineFxTriggers(before, after)).toEqual([
      { player: 0, kind: 'hospital' },
      { player: 1, kind: 'hospital' },
      { player: 3, kind: 'hospital' },
    ]);
    expect(confineFxTrigger(before, after)).toBe('hospital');
  });

  it('main.ts 接线：飛碟先排、救护车逐段排在后面（`fcn_0044913d`：0x0044925b 播 0x213 → 0x00449285 各次 0x20c）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const fx = src.slice(src.indexOf('function startActionFx('));
    expect(fx.indexOf('startAlienNewsFx(before, state);')).toBeLessThan(fx.indexOf('startConfineFx(before, state);'));
    const confine = src.slice(src.indexOf('function startConfineFx('), src.indexOf('function startGodFx('));
    expect(confine).toContain('for (const hit of hits) {');
    expect(confine).toContain('queueBoardFilm(clip);');
    const alien = src.slice(src.indexOf('function startAlienNewsFx('));
    expect(alien.slice(0, alien.indexOf('\n}\n'))).toContain('queueBoardFilm(spec);');
    expect(alien.slice(0, alien.indexOf('\n}\n'))).not.toContain('startBoardFilm(spec);');
    // 取走队头之后接下一段
    expect(src).toContain('pendingBoardFilmAfter = boardFilmQueueRest.shift() ?? null;');
  });

  runExe('★ 回 exe 钉：新聞 4 先播飛碟（0x0044925b call 0x45144f）、后逐人 `send_to_hospital`（0x00449285）', () => {
    expect(0x44925b).toBeLessThan(0x449285);
    const d = exeBytes(0x449285, 5);
    expect(d[0]).toBe(0xe8);
    const rel = (d[1]! | (d[2]! << 8) | (d[3]! << 16) | (d[4]! << 24)) | 0;
    expect(0x449285 + 5 + rel).toBe(0x43ec3f);
    const f = exeBytes(0x44925b, 5);
    const rel2 = (f[1]! | (f[2]! << 8) | (f[3]! << 16) | (f[4]! << 24)) | 0;
    expect(0x44925b + 5 + rel2).toBe(0x45144f);
  });
});

/** 类型检查用：`ConfineKind` 收两个值 */
const KINDS: ConfineKind[] = ['hospital', 'prison'];
void KINDS;
