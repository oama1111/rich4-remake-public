/*
 * 神明顯靈加蓋那一扇框期间，棋盘上那一格**还是顯靈之前的等级** —— 纯表现
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ★ 第十三份試玩回報 #1（145729）：「我又踩到天使，又是我自己的地，应该是升级2次，
 *   让我看到空地变购物中心1级，然后变2级」。
 *
 * core 一条 action 就把「付费首建（0→1）」与「落点尾块天使顯靈加蓋（1→2）」一起写完，
 * 棋盘照 `state` 画就**直接跳到 2 级**，1 级那一拍根本没露面。原版是两次重画：
 *
 * ```asm
 * ; 付费首建設施（落点跳表，`0x0041a240` 一支）
 * 0041a27c  inc  byte [eax + 0x1a]            ; 等级 0 → 1
 * 0041a27f  call 0x41d476                      ; view_to(0,0,1) ⇒ 0x40829d 重画棋盘（1 级露面）
 * 0041a289  push 0x4823da / call 0x4542ce      ; 音效 Effect.mkf 50
 *           …→ 尾块 0x41b077 → call 0x40f381（天使顯靈）
 * ; 天使顯靈 `fcn_0040f381` 的加蓋支（种类 9）
 * 0040f427  call 0x41d476                      ; view_to(当前玩家)
 * 0040f493  call 0x40b110                      ; 等级 1 → 2（只改数据，**不重画**）
 * 0040f4d9  call 0x440cac                      ; 「天使顯靈\n\n加蓋房屋」框，阻塞 1500 ms —— 底下还是 1 级
 * 0040f4f8  push 0x4823da / call 0x4542ce      ; 音效 Effect.mkf 50（第二声）
 * 0040f506  call 0x41d476                      ; view_to(0,0,1) ⇒ 重画（2 级露面）
 * 0040f50e  test bh, 0x80 / je  → 0040f517 call 0x40b0cd   ; 刚满 5 级才接 0x20b
 * ```
 * 福神 `fcn_0040f8be` 同形：`0x0040f983 call 0x40b110` → `0x0040f9c9 call 0x440cac` →
 * `0x0040f9e1 call 0x4542ce`（音效 50）→ `0x0040f9ef call 0x41d476`（重画）→ `0x0040fa26 call 0x40b0cd`。
 *
 * ⇒ 两次加蓋都**没有**大锤片（`build-fx.ts` 的 `HAMMER_SOURCES`），可见的「动画」就是
 *   **两次重画 + 两声音效 50**，中间夹着那一扇顯靈框。
 *
 * 本模块只做一件事：认出「这一条 action 有顯靈加蓋、且弹了顯靈框」，框没收之前让棋盘上那几格
 * 少画顯靈加的那几级；框收掉那一拍放开（并由宿主补那第二声音效）。
 *
 * ★ C-ARC-2：不比等级、不算规则 —— `BuildUpgradeHint` 一条 = `0x40b110` 一次 = 一级
 *   （`0x0040b164 inc cl` / `0x0040b1f4 inc byte [ebx+0x1a]` / `0x0040b210 inc dl`，三支都是 +1），
 *   所以「少画几级」就是数 `source === 'godManifest'` 的提示条数。
 * ★ C-DET-4：只返回给渲染器看的副本，不写 `state`。
 * ★ 没弹框的顯靈加蓋（等级 0 的設施：`0x0040f47f` 先弹框、`0x800` 标记让 `0x0040f4ac` 不再弹第二扇，
 *   本引擎是 `pending.free` 那条 `buildFacility`）不按住，音效当场响 —— 那一扇框已经在上一条 action 弹过了。
 */

import { decodeEstate, type BuildUpgradeHint, type GameState } from '@rich4/core';

/** 顯靈框的文案键（`GOD_MANIFEST.build`，天使 `0x0040f4bd` / 福神同一串 `0x4634c0`）*/
export const MANIFEST_NOTICE_KEY = 'god.build';

export interface ManifestHold {
  /** 地块下标 → 少画几级 */
  land: ReadonlyMap<number, number>;
  /** 設施下标 → 少画几级 */
  facility: ReadonlyMap<number, number>;
  /** 顯靈这一次刚好盖到 5 级（之后要接 0x20b）*/
  reachedMaxLevel: boolean;
}

/**
 * 这一条 action 要不要按住。
 *
 * 判据两条都要：`lastBuildUpgrades` 里有 `godManifest`（引用换了 = 本 action 写的），
 * `notices` 里有顯靈框（引用换了 = 本 action 弹的）。
 */
export function manifestHoldOf(
  before: Pick<GameState, 'lastBuildUpgrades' | 'notices'>,
  after: Pick<GameState, 'lastBuildUpgrades' | 'notices'>,
): ManifestHold | null {
  const hints = after.lastBuildUpgrades ?? [];
  if (hints === (before.lastBuildUpgrades ?? [])) return null;
  if (after.notices === before.notices) return null;
  if (!after.notices.some((n) => n.key === MANIFEST_NOTICE_KEY)) return null;
  const land = new Map<number, number>();
  const facility = new Map<number, number>();
  let reachedMaxLevel = false;
  for (const h of hints) {
    if (h.source !== 'godManifest') continue;
    const e = decodeEstate(h.entity);
    const map = e.kind === 'land' ? land : facility;
    map.set(e.index, (map.get(e.index) ?? 0) + 1);
    reachedMaxLevel ||= h.reachedMaxLevel;
  }
  if (land.size === 0 && facility.size === 0) return null;
  return { land, facility, reachedMaxLevel };
}

/**
 * 当场该不该响音效 50（`build-fx.ts` 的 `MANIFEST_SOUND_SOURCES`）：按住的那几条顯靈加蓋
 * 挪到框收掉那一拍，剩下的（付费首建 / 自己的地升級 / 没弹框的顯靈）照旧当场响。
 */
export function immediateManifestHints(
  hints: readonly BuildUpgradeHint[],
  hold: ManifestHold | null,
): readonly BuildUpgradeHint[] {
  return hold === null ? hints : hints.filter((h) => h.source !== 'godManifest');
}

function lower(levels: number[], held: ReadonlyMap<number, number>, source: readonly number[]): number[] {
  if (held.size === 0) return levels;
  const out = [...levels];
  for (const [i, n] of held) {
    const v = source[i];
    if (v !== undefined) out[i] = Math.max(0, v - n);
  }
  return out;
}

/**
 * 按住：`view` 是棋盘本来要画的那一份，被按住的格一律取 `after` 的等级减去顯靈加的级数
 * （= 顯靈之前、框底下那一帧的等级）。
 */
export function applyManifestHold(
  view: GameState,
  after: Pick<GameState, 'landLevel' | 'facilityLevel'>,
  hold: ManifestHold | null,
): GameState {
  if (hold === null) return view;
  return {
    ...view,
    landLevel: lower(view.landLevel, hold.land, after.landLevel),
    facilityLevel: lower(view.facilityLevel, hold.facility, after.facilityLevel),
  };
}
