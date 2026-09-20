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
import type { BuildUpgradeHint, BuildUpgradeSource, GameState, MapTopology } from '@rich4/core';
import { makeGameState, makeLand, makeNode, makePlayer, reduce } from '@rich4/core';
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
  HAMMER_SOURCES,
  MANIFEST_BUILD_SOUND,
  MANIFEST_SOUND_SOURCES,
  manifestSoundFor,
  playsHammer,
  playsManifestSound,
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
const DATA_MKF = (process.env.RICH4_WORKSPACE ?? '') + '/rich4-remake/assets/game/Data.mkf';
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
    source: BuildUpgradeSource,
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

  // ★★ 试玩回报第 4 份第 3 条：「走到归属自己的地块上选择升级房子时**不需要**再触发
  //    机器工人动画」。回 exe 取证（本次）：
  //    · 落点例程 `0x004198b9` 的自有地分支直接 `0x004199d1 inc byte [esi + 0x1a]`
  //      （不走 `0x40b110`），整段里**没有** `push 0x229`；
  //    · 等级剛好到 5 时 `0x004199eb cmp byte [esi + 0x1a], 5` →
  //      `0x00419a21 call 0x40b0cd` = **只播 0x20b**（放烟花，不是大锤施工）。
  //    · 大锤 `0x229` 的 `push` 全 exe 只有 4 处：
  //      `0x0041aab8` / `0x0041ad4d` / `0x00432028` / `0x0044731a`。
  it('★★★ 自己的地「升級房子」（落点 0x004198b9 自有地分支）：**绝不播大锤**，滿級只放 0x20b', () => {
    expect(buildFxPlan([hint('ownUpgrade', false)])).toEqual({ hammer: false, maxLevel: false });
    expect(buildFxPlan([hint('ownUpgrade', true)])).toEqual({ hammer: false, maxLevel: true });
    // 起播段序：ownUpgrade 恒从 0x20b 起，绝不从大锤起
    expect(playsHammer('ownUpgrade')).toBe(false);
    expect(beginBuildFx(0, true, playsHammer('ownUpgrade')).clip).toBe('maxLevel');
  });

  it('★★ 反例（可证伪）：判据必须是**正面表**，不是「除了天使卡都播大锤」', () => {
    // 旧判据 `h.source !== 'angelCard'` 会让**任何一个**别的 source 默认拿到大锤 ——
    // 上面那条 ownUpgrade 用例就是被这条旧判据害红的那一类。
    // 这里用一个「不在取证过的 4 个 push 点里」的 source 钉住：
    // 正面表 ⇒ 不播大锤；负判据 ⇒ 会播（本条当场红）。
    const unknown = { entity: 0x7d0 + 1, reachedMaxLevel: false, source: 'notAProvenSite' as BuildUpgradeSource };
    expect(buildFxPlan([unknown])).toEqual({ hammer: false, maxLevel: false });
    // 正面表恰好是取证过的三族（建設公司 / 魔法屋 / 機器工人）—— 多一个都算猜
    expect([...HAMMER_SOURCES]).toEqual(['robotWorker', 'magicHouse', 'companyBuild']);
    for (const s of HAMMER_SOURCES) expect(playsHammer(s)).toBe(true);
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

// ============================================================
//  ★★ 端到端：落点「升級房子」那一条**真 action** 不播大锤
//     （试玩回报第 4 份 #3；可证伪 —— 谁把判据退回「除了天使卡都播大锤」，
//      `4 → 5` 那条当场变红）
// ============================================================

describe('★★ 自己的地升級（走真 reduce）—— 绝不播机器工人大锤', () => {
  const topo: MapTopology = {
    nodes: [
      makeNode({ id: 1, type: 0x7d0 + 1, adjacent: [2], adjacentSlots: [2, 0, 0, 0], walkable: true }),
      makeNode({ id: 2, adjacent: [1], adjacentSlots: [1, 0, 0, 0], walkable: true }),
    ],
    // owner 是 1 基：1 = 玩家 0
    lands: [makeLand({ id: 1, name: '測試路', type: 0, owner: 1, level: 0, landPrice: 1000 })],
  };

  /** 玩家 0 站在自己的地块上、落点已经问出「升級房子」那一步 */
  const ownLandUpgrade = (level: number): GameState =>
    makeGameState({
      players: [
        makePlayer({ index: 0, nodeId: 1, cash: 500_000 }),
        makePlayer({ index: 1 }),
        makePlayer({ index: 2 }),
        makePlayer({ index: 3 }),
      ],
      currentPlayer: 0,
      phase: 'awaitingDecision',
      pending: { kind: 'upgradeLand', landId: 1, name: '測試路', cost: 200 },
      landOwner: [0, 1],
      landLevel: [0, level],
      landType: [0, 0],
    });

  it('4 → 5：段序 = **只有 0x20b**（不是「大锤 + 0x20b」）', () => {
    const before = ownLandUpgrade(4);
    const after = reduce(before, { type: 'upgradeLand' }, topo);
    expect(after.landLevel[1]).toBe(5);
    expect(buildFxPlan(buildUpgradesOf(after, before))).toEqual({ hammer: false, maxLevel: true });
  });

  it('2 → 3：一段都不播（原版 `cmp ...,5 / jne 0x419a2b`，没有 0x20b）', () => {
    const before = ownLandUpgrade(2);
    const after = reduce(before, { type: 'upgradeLand' }, topo);
    expect(after.landLevel[1]).toBe(3);
    expect(buildFxPlan(buildUpgradesOf(after, before))).toEqual({ hammer: false, maxLevel: false });
  });
});

// ============================================================
//  ★ W-55 行 3：顯靈／自己加蓋那一声音效（`Effect.mkf` 50）
// ============================================================

describe('★ 顯靈／自己加蓋的音效 —— 只有 `godManifest` / `ownUpgrade` 响', () => {
  const hint = (source: BuildUpgradeSource, reachedMaxLevel = false): BuildUpgradeHint => ({
    entity: 0x7d0 + 1,
    reachedMaxLevel,
    source,
  });

  it('★ 号码 = 50（`SOUND_IDS.GOD_MANIFEST`，表项 0x4823da）—— **不是** 49/51', () => {
    expect(MANIFEST_BUILD_SOUND).toBe(50);
    expect(MANIFEST_BUILD_SOUND).not.toBe(49);
    expect(MANIFEST_BUILD_SOUND).not.toBe(51);
    // 与建屋那两段的音效不是同一个号（0x5b=91 / 0x5a=90）
    expect(MANIFEST_BUILD_SOUND).not.toBe(BUILD_HAMMER_SOUND);
    expect(MANIFEST_BUILD_SOUND).not.toBe(BUILD_MAX_SOUND);
  });

  it('★ 正面表 = `godManifest` / `ownUpgrade`（恰两个，不多不少）', () => {
    expect([...MANIFEST_SOUND_SOURCES]).toEqual(['godManifest', 'ownUpgrade']);
    expect(playsManifestSound('godManifest')).toBe(true);
    expect(playsManifestSound('ownUpgrade')).toBe(true);
    // 反证：这四个各有自己的大锤/滿級音，不许再响 50
    for (const s of ['robotWorker', 'magicHouse', 'companyBuild', 'angelCard'] as const) {
      expect(playsManifestSound(s), s).toBe(false);
    }
  });

  it('★ 天使顯靈（`godManifest`，**没到 5 级**）⇒ 响；这时 `buildFxPlan` 是「一段都不播」', () => {
    const hints = [hint('godManifest', false)];
    // 这一条正是「不能挂在 plan 闸之后」的理由：plan 全 false，音效照样要响
    expect(buildFxPlan(hints)).toEqual({ hammer: false, maxLevel: false });
    expect(manifestSoundFor(hints)).toBe(MANIFEST_BUILD_SOUND);
  });

  it('★ 自己的地升級（`ownUpgrade`）⇒ 响；機器工人（`robotWorker`）⇒ **不响**（它自己的大锤音）', () => {
    expect(manifestSoundFor([hint('ownUpgrade')])).toBe(MANIFEST_BUILD_SOUND);
    expect(manifestSoundFor([hint('robotWorker')])).toBeNull();
    expect(manifestSoundFor([hint('angelCard', true)])).toBeNull();
  });

  it('★ 可证伪：同一条 action 里混着两种 source ⇒ 响（`some` 语义）', () => {
    expect(manifestSoundFor([hint('robotWorker'), hint('godManifest')])).toBe(MANIFEST_BUILD_SOUND);
  });

  it('★ 没有加蓋事件 ⇒ `null`（不许每条 action 都响）', () => {
    expect(manifestSoundFor([])).toBeNull();
  });

  it('★★ 源码钉子：这一声必须排在 `plan` 那道闸**之前**（否则「没到 5 级」时就不响了）', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const playAt = src.indexOf("if (manifestSound !== null) sound.play('Effect.mkf', manifestSound);");
    const gateAt = src.indexOf('if (!plan.hammer && !plan.maxLevel) return;', playAt - 400);
    expect(playAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(playAt).toBeLessThan(gateAt);
  });
});
