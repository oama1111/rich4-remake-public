/*
 * 機器工人（道具 9）原地建屋动效 —— Q-TOOL-6
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 钉三件事，判据全部回 exe：
 *   ① **帧序/节拍**：一帧等资源头里的 `speed` 毫秒、播完就停；
 *   ② **落点**：整块棋盘 `(0, 0x28)` 屏幕 = 棋盘局部 `(0, 0)`、440×440、锚点左上；
 *   ③ **什么时候播**：大锤恒播；`0x20b` 只在地块刚盖到 5 级（bit7）时接在后面。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MkfArchive, parseFlicInfo } from '@rich4/assets-pipeline';
import type { BuildUpgradeHint } from '@rich4/core';
import {
  beginBuildFx,
  buildClip,
  buildFxBitmap,
  buildFxFrame,
  buildFxPlan,
  buildUpgradesOf,
  BUILD_FX_ARCHIVE,
  BUILD_FX_H,
  BUILD_FX_W,
  BUILD_FX_X,
  BUILD_FX_Y,
  BUILD_HAMMER,
  BUILD_HAMMER_RESOURCE,
  BUILD_HAMMER_SOUND,
  BUILD_MAX_LEVEL,
  BUILD_MAX_RESOURCE,
  BUILD_MAX_SOUND,
  BUILD_TOOL_ID,
  clipDone,
  clipTotalMs,
  stepBuildFx,
  type BuildFx,
} from './build-fx.ts';
import type { LoadedFlic } from './assets.ts';

/** 造一段假影片：`n` 帧 */
function fakeFlic(n: number, ms: number): LoadedFlic {
  return {
    frames: Array.from({ length: n }, () => ({}) as unknown as ImageBitmap),
    width: 440,
    height: 440,
    frameMs: ms,
    close: () => {},
  };
}

/** 真 `Data.mkf`（打包进 `assets/game/` 的那一份）*/
const DATA_MKF = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版/rich4-remake/assets/game/Data.mkf';
const run = existsSync(DATA_MKF) ? it : it.skip;

// ============================================================
//  出处与常量
// ============================================================

describe('两段影片的出处 @source VA 0x00447295 / 0x0040b0cd', () => {
  it('★ 道具号 9、影片在 Data.mkf、资源 0x229 与 0x20b', () => {
    expect(BUILD_TOOL_ID).toBe(9);
    expect(BUILD_FX_ARCHIVE).toBe('Data.mkf');
    expect(BUILD_HAMMER_RESOURCE).toBe(0x229);
    expect(BUILD_MAX_RESOURCE).toBe(0x20b);
    expect(BUILD_HAMMER.resource).toBe(0x229);
    expect(BUILD_MAX_LEVEL.resource).toBe(0x20b);
  });

  it('★ 落点 = 屏幕 (0, 0x28)（棋盘左上角），尺寸 = 整块棋盘 440×440', () => {
    expect(BUILD_FX_X).toBe(0);
    expect(BUILD_FX_Y).toBe(0x28);
    expect(BUILD_FX_Y).toBe(40);
    expect(BUILD_FX_W).toBe(440);
    expect(BUILD_FX_H).toBe(440);
    // 两段共用同一个落点（大锤 VA 0x00447357/0x00447359，滿級 VA 0x0040b0f8/0x0040b0fa）
    expect(buildClip('hammer').width).toBe(buildClip('maxLevel').width);
    expect(buildClip('hammer').height).toBe(buildClip('maxLevel').height);
  });

  it('★ 音效：大锤 Effect.mkf 0x5b(91)、滿級 0x5a(90) —— 随影片一起响', () => {
    expect(BUILD_HAMMER_SOUND).toBe(0x5b);
    expect(BUILD_MAX_SOUND).toBe(0x5a);
    expect(BUILD_HAMMER.sound).toBe(91);
    expect(BUILD_MAX_LEVEL.sound).toBe(90);
  });

  it('★ 帧数与节拍：大锤 68 帧 × 57 ms、滿級 66 帧 × 42 ms', () => {
    expect(BUILD_HAMMER.frames).toBe(68);
    expect(BUILD_HAMMER.frameMs).toBe(57);
    expect(clipTotalMs('hammer')).toBe(68 * 57);
    expect(clipTotalMs('hammer')).toBe(3876);
    expect(BUILD_MAX_LEVEL.frames).toBe(66);
    expect(BUILD_MAX_LEVEL.frameMs).toBe(42);
    expect(clipTotalMs('maxLevel')).toBe(66 * 42);
    expect(clipTotalMs('maxLevel')).toBe(2772);
  });

  // ★ 回到 `Rich4/Data.mkf` 本身核一遍 —— 上面那四个字面量就是这张表的投影。
  //   算法与 `@rich4/assets-pipeline` 的 `parseFlicInfo` 一致（资源头 +4 = 0xaf12）。
  run('★ 与真 Data.mkf 的资源头逐字节一致（不是抄来的常量）', () => {
    const ar = new MkfArchive(new Uint8Array(readFileSync(DATA_MKF)));
    for (const clip of [BUILD_HAMMER, BUILD_MAX_LEVEL]) {
      const info = parseFlicInfo(ar.read(clip.resource));
      expect(info).not.toBeNull();
      expect(info!.frames).toBe(clip.frames);
      expect(info!.width).toBe(clip.width);
      expect(info!.height).toBe(clip.height);
      expect(info!.frameMs).toBe(clip.frameMs);
    }
  });
});

// ============================================================
//  帧序（第几帧 / 多久）
// ============================================================

describe('帧序 —— 一帧等 speed 毫秒、播完钉在最后一帧', () => {
  const fx: BuildFx = beginBuildFx(1000, false);

  it('★ 大锤第 k 帧 = floor((now − 起播) / 57)，从 0 起', () => {
    expect(buildFxFrame(fx, 1000)).toBe(0);
    expect(buildFxFrame(fx, 1000 + 56)).toBe(0);
    expect(buildFxFrame(fx, 1000 + 57)).toBe(1); // @source VA 0x00451513 `cmp esi, [0x48c870]`
    expect(buildFxFrame(fx, 1000 + 57 * 2)).toBe(2);
    expect(buildFxFrame(fx, 1000 + 57 * 67)).toBe(67); // 最后一帧（帧数 − 1）
  });

  it('★ 走满 68 帧就到头，再多也只钉在最后一帧上（不循环、不回卷）', () => {
    // @source VA 0x0045117d..0x00451192：帧号 +1 到 == 帧数 就收场；
    //   flags bit2（[0x48c883]）与重复次数（flags>>8）都是 0 → 不循环
    expect(buildFxFrame(fx, 1000 + 57 * 68)).toBe(67);
    expect(buildFxFrame(fx, 1000 + 57 * 1000)).toBe(67);
  });

  it('★ 收场时刻 = 帧数 × 每帧（3876 ms），差 1 ms 都还没完', () => {
    expect(clipDone(fx, 1000 + 3876 - 1)).toBe(false);
    expect(clipDone(fx, 1000 + 3876)).toBe(true);
  });

  it('★ 起播时间之前（时钟回退 / 传 0）不出现负帧号', () => {
    expect(buildFxFrame(fx, 0)).toBe(0);
    expect(buildFxFrame(fx, Number.NaN)).toBe(0);
  });

  it('★ 滿級那一段按自己的 42 ms 走（两段的节拍不同）', () => {
    const max = beginBuildFx(0, true);
    const second = stepBuildFx(max, clipTotalMs('hammer'));
    expect(second).not.toBeNull();
    expect(second!.clip).toBe('maxLevel');
    expect(buildFxFrame(second!, 3876)).toBe(0);
    expect(buildFxFrame(second!, 3876 + 42)).toBe(1);
    expect(buildFxFrame(second!, 3876 + 42 * 65)).toBe(65);
  });
});

// ============================================================
//  什么时候播
// ============================================================

describe('顺序与条件 @source VA 0x00447345 / 0x0044736d / 0x00447373', () => {
  it('★ 没盖到 5 级：只播大锤，播完就收（不进 0x20b）', () => {
    const fx = beginBuildFx(0, false);
    expect(fx.clip).toBe('hammer');
    expect(fx.thenMaxLevel).toBe(false);
    expect(stepBuildFx(fx, 3875)).toBe(fx); // 还在播
    expect(stepBuildFx(fx, 3876)).toBeNull(); // 收摊
  });

  it('★ 刚盖到 5 级：大锤**播完之后**紧接着 0x20b（不是同时）', () => {
    const fx = beginBuildFx(0, true);
    // 大锤期间不换片
    expect(stepBuildFx(fx, 0)!.clip).toBe('hammer');
    expect(stepBuildFx(fx, 3875)!.clip).toBe('hammer');
    const second = stepBuildFx(fx, 3876);
    expect(second!.clip).toBe('maxLevel');
    // ★ 第二段的起点是「第一段起点 + 第一段总长」，原版两段之间没有缝
    expect(second!.startedAt).toBe(3876);
    expect(second!.thenMaxLevel).toBe(false);
    // 两段合计 6648 ms
    expect(clipTotalMs('hammer') + clipTotalMs('maxLevel')).toBe(6648);
    expect(stepBuildFx(second!, 6648)).toBeNull();
  });

  it('★ 第二段不会再接第三段', () => {
    const fx = stepBuildFx(beginBuildFx(0, true), 3876)!;
    expect(stepBuildFx(fx, 6648)).toBeNull();
    expect(stepBuildFx(fx, 999999)).toBeNull();
  });

  it('★ 天使卡那一支（0x004434c0）**只播 0x20b**，不播大锤', () => {
    const fx = beginBuildFx(0, true, false);
    expect(fx.clip).toBe('maxLevel');
    expect(fx.thenMaxLevel).toBe(false);
    expect(stepBuildFx(fx, clipTotalMs('maxLevel') - 1)).toBe(fx);
    expect(stepBuildFx(fx, clipTotalMs('maxLevel'))).toBeNull();
  });

  it('★★ bit7 不再由客户端算 —— `reachedMaxLandLevel` 已删除（C-ARC-2）', async () => {
    // 先前这里是 `reachedMaxLandLevel(before, after, landId)`（客户端自己按
    // 「加之前 4、加之后 5」比等级），而且它附的注释把「設施支不置 bit7」写反了。
    // 现在这条契约只在 core：`rules/tool-effects.ts` 的 `reachdsMaxBuildLevel`
    // / `buildUpgradeBit7`（测试在 `tool-effects.test.ts`）+ `BuildUpgradeHint`。
    const mod = await import('./build-fx.ts');
    expect('reachedMaxLandLevel' in mod).toBe(false);
  });
});

// ============================================================
//  ★★ 段序：由 core 的 bit7 契约决定，客户端一个等级都不比（C-ARC-2）
// ============================================================

describe('★ 段序 @source 三条消费点各自 read_mkf/播片序列', () => {
  const hint = (
    source: 'robotWorker' | 'magicHouse' | 'companyBuild' | 'angelCard',
    reachedMaxLevel: boolean,
  ): BuildUpgradeHint => ({ entity: 0x7d0 + 1, reachedMaxLevel, source });

  it('★★ 機器工人（0x00447295）：大锤 0x229 + （bit7 时）剛滿 5 級 0x20b', () => {
    expect(buildFxPlan([hint('robotWorker', false)])).toEqual({ hammer: true, maxLevel: false });
    expect(buildFxPlan([hint('robotWorker', true)])).toEqual({ hammer: true, maxLevel: true });
  });

  it('★★ 魔法屋「就地加蓋房屋」（0x00431f67，消费点 0x00432085）：与機器工人同构', () => {
    // @source 0x00432028 push 0x229 / 0x00432034 call 0x450441 / 0x00432074 call 0x45144f
    //   → 0x00432085 test byte [esp+0xa8], 0x80 → 0x0043208f call 0x40b0cd
    expect(buildFxPlan([hint('magicHouse', false)])).toEqual({ hammer: true, maxLevel: false });
    expect(buildFxPlan([hint('magicHouse', true)])).toEqual({ hammer: true, maxLevel: true });
  });

  it('★★ 建設公司（0x0041abde，消费点 0x0041adaa）：与機器工人同构（大锤 + 0x20b）', () => {
    // @source 0x0041ad7e call 0x40b110 → 0x0041ad99 call 0x45144f（大锤）
    //   → 0x0041adaa test byte [esp+0xbc], 0x80 → 0x0041adb4 call 0x40b0cd
    expect(buildFxPlan([hint('companyBuild', false)])).toEqual({ hammer: true, maxLevel: false });
    expect(buildFxPlan([hint('companyBuild', true)])).toEqual({ hammer: true, maxLevel: true });
  });

  it('★★ 天使卡（0x004434c0，消费点 0x004436b5）：**只有 0x20b**（函数体里没有 0x229）', () => {
    expect(buildFxPlan([hint('angelCard', false)])).toEqual({ hammer: false, maxLevel: false });
    expect(buildFxPlan([hint('angelCard', true)])).toEqual({ hammer: false, maxLevel: true });
  });

  it('★★ 一條 action 里多次加蓋 ⇒ 取**并集**：后面的「没满级」不能吃掉前面的 bit7', () => {
    // 魔法屋那一条 action 里每位中签者各跑一遍（0x004320aa inc edi / cmp edi,4）
    expect(buildFxPlan([hint('magicHouse', false), hint('magicHouse', true)]))
      .toEqual({ hammer: true, maxLevel: true });
    expect(buildFxPlan([hint('magicHouse', true), hint('magicHouse', false)]))
      .toEqual({ hammer: true, maxLevel: true });
  });

  it('★ 没有加蓋事件 ⇒ 什么都不播', () => {
    expect(buildFxPlan([])).toEqual({ hammer: false, maxLevel: false });
  });
});

describe('★ buildUpgradesOf —— 只认**本 action**的加蓋（引用相等，不看 action 种类）', () => {
  const first: BuildUpgradeHint = { entity: 0x7d1, reachedMaxLevel: true, source: 'robotWorker' };
  const second: BuildUpgradeHint = { entity: 0xfa1, reachedMaxLevel: true, source: 'magicHouse' };

  it('core 没换数组 ⇒ 那是上一条 action 留下的，不算', () => {
    const prev = [first];
    expect(buildUpgradesOf({ lastBuildUpgrades: prev }, { lastBuildUpgrades: prev })).toEqual([]);
  });

  it('两边都是 undefined（这个可选字段没被写过）⇒ 空', () => {
    expect(buildUpgradesOf({}, {})).toEqual([]);
  });

  it('core 换了一个新数组 ⇒ 就是本 action 的', () => {
    expect(buildUpgradesOf({ lastBuildUpgrades: [second] }, { lastBuildUpgrades: [first] }))
      .toEqual([second]);
  });

  it('新数组但为空（本 action 没加蓋）⇒ 空', () => {
    expect(buildUpgradesOf({ lastBuildUpgrades: [] }, { lastBuildUpgrades: [first] })).toEqual([]);
  });
});

// ============================================================
//  位图取帧
// ============================================================

describe('取当前帧的位图', () => {
  it('★ 影片没到货 → null（这一帧空着，下一帧补）', () => {
    const fx = beginBuildFx(0, false);
    expect(buildFxBitmap(fx, 0, {})).toBeNull();
    expect(buildFxBitmap(fx, 0, { hammer: null })).toBeNull();
  });

  it('★ 到货了 → 按帧号取，且以**真影片的帧数**为准钳位', () => {
    const fx = beginBuildFx(0, false);
    const two = fakeFlic(2, 57);
    expect(buildFxBitmap(fx, 0, { hammer: two })).toBe(two.frames[0]);
    expect(buildFxBitmap(fx, 57, { hammer: two })).toBe(two.frames[1]);
    expect(buildFxBitmap(fx, 57 * 99, { hammer: two })).toBe(two.frames[1]);
  });

  it('★ 空影片（0 帧）不炸', () => {
    const fx = beginBuildFx(0, false);
    expect(buildFxBitmap(fx, 0, { hammer: fakeFlic(0, 57) })).toBeNull();
  });
});
