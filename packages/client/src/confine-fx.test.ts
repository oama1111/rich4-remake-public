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
import {
  CONFINE_FX_ARCHIVE,
  CONFINE_HOSPITAL,
  CONFINE_PRISON,
  beginConfineFx,
  confineClip,
  confineFxBitmap,
  confineFxDone,
  confineFxFrame,
  confineFxTrigger,
  confineSkippable,
  confineTotalMs,
  type ConfineKind,
} from './confine-fx.ts';

const DATA_MKF = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/Rich4/Data.mkf';
const hasData = existsSync(DATA_MKF);
const runData = hasData ? it : it.skip;

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

  it('★ 本来就是 1（加刑）但计数变大 → 照样播（原版每次 `send_to_*` 都重播）', () => {
    const before = st({ hosp: [1, 0, 0, 0], inHospital: [2, 0, 0, 0] });
    const after = st({ hosp: [1, 0, 0, 0], inHospital: [5, 0, 0, 0] });
    expect(confineFxTrigger(before, after)).toBe('hospital');
    const b2 = st({ pris: [1, 0, 0, 0], inPrison: [1, 0, 0, 0] });
    const a2 = st({ pris: [1, 0, 0, 0], inPrison: [4, 0, 0, 0] });
    expect(confineFxTrigger(b2, a2)).toBe('prison');
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

  it('★ 但**真的**加刑 / 真的送入照样播（掩掉高位没把这两条一并吞掉）', () => {
    // 加刑：`confine()` 写的是 `(existing + days) & 0x7f`，低 7 位确实变大
    expect(
      confineFxTrigger(
        st({ hosp: [1, 0, 0, 0], inHospital: [3, 0, 0, 0] }),
        st({ hosp: [1, 0, 0, 0], inHospital: [5, 0, 0, 0] }),
      ),
    ).toBe('hospital');
    // 待释放期间**又被送进去**：core 的 `confine` 给出 (0x80 + 3) & 0x7f = 3
    expect(
      confineFxTrigger(
        st({ hosp: [1, 0, 0, 0], inHospital: [0x80, 0, 0, 0] }),
        st({ hosp: [1, 0, 0, 0], inHospital: [3, 0, 0, 0] }),
      ),
    ).toBe('hospital');
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
    // 影片宿主那一道闸（住院/入獄/神明共用一份状态）
    expect(src).toContain('if (boardFilm !== null || pendingBoardFilm !== null) {');
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

/** 类型检查用：`ConfineKind` 收两个值 */
const KINDS: ConfineKind[] = ['hospital', 'prison'];
void KINDS;
