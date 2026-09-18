/*
 * 原版存档「状态块」写出 —— 结构与往返验证
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSave } from './save.ts';
import { parseMap } from './map.ts';
import { importOriginalSave, importOriginalSaveWithSnapshots } from './savegame.ts';
import { restoreSnapshot } from '../rules/time-machine.ts';
import {
  MODELED_BLOCK_OFFSETS,
  SNAPSHOT_REGIONS,
  assertSnapshotRegionTable,
  writePlayerSnapshot,
  PARTIALLY_MODELED_BLOCK_OFFSETS,
  ORIGINAL_SAVE_BLOCKS,
  ORIGINAL_SAVE_HEADER,
  ORIGINAL_PLAYER_SNAPSHOT_SIZE,
  ORIGINAL_STATE_BLOCK_SIZE,
  assertSaveBlockTable,
  carriedBlocks,
  writeOriginalSaveFile,
  writeStateBlock,
} from './save-writer.ts';

const ROOT = '/Users/chenke/Documents/kimi/Workspaces/大富翁4重制版';
const MAP = `${ROOT}/extracted/map/0001.bin`;
const SAVES = [`${ROOT}/Rich4/Save0.dat`, `${ROOT}/Rich4/SAVE1.DAT`];

describe('★ 42 块表的结构自洽（不需要真实存档）', () => {
  it('恰好铺满 [0x0004, 0x274b)：无空洞、无重叠', () => {
    expect(() => assertSaveBlockTable()).not.toThrow();
  });

  it('块数 = 42，总字节 = 10,055，末块结束 = 状态块大小 10,059', () => {
    expect(ORIGINAL_SAVE_BLOCKS).toHaveLength(42);
    expect(ORIGINAL_SAVE_BLOCKS.reduce((s, b) => s + b.bytes, 0)).toBe(10_055);
    const last = ORIGINAL_SAVE_BLOCKS[ORIGINAL_SAVE_BLOCKS.length - 1]!;
    expect(last.offset + last.bytes).toBe(ORIGINAL_STATE_BLOCK_SIZE);
  });

  it('每块都满足 count × size = bytes', () => {
    for (const b of ORIGINAL_SAVE_BLOCKS) expect(b.count * b.size).toBe(b.bytes);
  });

  it('★ 写档顺序与规格「写侧 46 处」的配对一致：第 1 块 = 版本标识', () => {
    expect(ORIGINAL_SAVE_HEADER).toBe(0x26);
    expect(ORIGINAL_SAVE_BLOCKS[0]!.offset).toBe(0x0004); // 头 4 字节之后
  });

  it('已建模块都在表内，且并非全部（本模块是部分实现）', () => {
    const offsets = new Set(ORIGINAL_SAVE_BLOCKS.map((b) => b.offset));
    for (const o of MODELED_BLOCK_OFFSETS) expect(offsets.has(o), `0x${o.toString(16)}`).toBe(true);
    expect(carriedBlocks().length).toBeGreaterThan(0); // ★ 诚实地承认还有未建模块
    expect(PARTIALLY_MODELED_BLOCK_OFFSETS).toContain(0x0010); // 玩家块是部分建模
  });
});

describe('★ 对两份真实存档做逐字节往返', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：写出 carry 来源的状态块 = 原文件前 10,059 字节`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));

      const carry = bytes.subarray(0, ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry, mapDataSize: save.mapData.length });

      expect(out).toHaveLength(ORIGINAL_STATE_BLOCK_SIZE);
      // ★ 逐字节相等 —— 任何 offset/size 抄错都会在这里炸
      expect(Buffer.from(out).equals(Buffer.from(carry))).toBe(true);
    });

    t(`${path.split('/').pop()}：把 carry **清零**后，已建模块仍逐字节相等`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));

      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });

      // 这一条才是「这些块真的从 `GameState` 写出来」的证据。
      // ★ 只有**完全建模**的块能参加；**部分建模**的块（如玩家块 0x68）
      //   还有字段取自 carry，清零后必然不等 —— 那不是 bug，是"还没写完"，
      //   故单独列出、不在这里断言。
      for (const b of ORIGINAL_SAVE_BLOCKS) {
        if (!MODELED_BLOCK_OFFSETS.includes(b.offset)) continue;
        const want = bytes.subarray(b.offset, b.offset + b.bytes);        const got = out.subarray(b.offset, b.offset + b.bytes);
        expect(
          Buffer.from(got).equals(Buffer.from(want)),
          `块 @0x${b.offset.toString(16)} 未与原版一致`,
        ).toBe(true);
      }
    });
  }

  /**
   * ★★ 玩家块的 `+0x00`（名字串指针）与 `+0x04`（代表色）——
   * **不是状态，是角色表 `0x47e80c` 的常量**，所以它们**必须**能在
   * carry 清零的条件下被写出来。这条用例是**可证伪**的：
   * 若哪天有人把这两处退回 carry（或错写成 `SaveGame.PlayerState` 的值），
   * 一旦 carry 清零就会立刻红。
   *
   * 独立证据（不是循环论证）：
   *  · `@source 0x00402b9f`–`0x00402bae`：读档后原版用 `character` 重新推导 `+0x00`；
   *  · `+0x04` 的写者在全 exe 为空（只被读），两份存档 8/8 与角色表逐位相同。
   */
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：carry 清零后玩家块 +0x00/+0x04 仍与原文件相等`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      const playerBlock = ORIGINAL_SAVE_BLOCKS.find((b) => b.offset === 0x0010)!;

      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });

      const players = state.players.length;
      expect(players).toBeGreaterThan(0);
      for (let i = 0; i < players; i++) {
        const o = playerBlock.offset + i * 0x68;
        expect(
          Buffer.from(out.subarray(o, o + 8)).equals(Buffer.from(bytes.subarray(o, o + 8))),
          `玩家 ${i} 的 +0x00..+0x07（namePointer + color）未从角色表写出`,
        ).toBe(true);
      }
    });
  }
});

describe('★★ 整份存档文件的往返（头部 + 状态块 + 地图 + 4×快照/地图副本）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：写出的整份文件与原文件**逐字节相等**`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const map = parseMap(new Uint8Array(readFileSync(MAP)));
      const { state } = importOriginalSave(save, parseMap(save.mapData));

      const out = writeOriginalSaveFile({ state, map: parseMap(save.mapData), carry: bytes });

      expect(out).toHaveLength(bytes.length); // 「两个真实存档精确闭合」那条结论的直接复验
      expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
      void map;
    });
  }

  it('★ 长度公式与 expectedSaveLength 一致（闭合性再验一次）', () => {
    for (const path of SAVES) {
      if (!existsSync(path)) continue;
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      expect(bytes.length).toBe(
        ORIGINAL_STATE_BLOCK_SIZE +
          save.mapData.length +
          4 * (ORIGINAL_PLAYER_SNAPSHOT_SIZE + save.mapData.length),
      );
    }
  });
});

describe('★ 日期与物价指数已并入「完全建模」（第 36 条）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：两个字段在样本里都非平凡（否则上面那条等价断言是空的）`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      // 日期：day | month<<8 | year<<16（@source save-scalars.md §2.15）
      expect(save.year).toBeGreaterThan(1990);
      expect(save.month).toBeGreaterThanOrEqual(1);
      expect(save.month).toBeLessThanOrEqual(12);
      expect(save.day).toBeGreaterThanOrEqual(1);
      // 物价指数：开局置 1、之后被抬升 ⇒ 1 与 >1 两种样本都有
      expect(save.priceIndex).toBeGreaterThanOrEqual(1);

      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });
      const u32 = (b: Uint8Array, o: number): number =>
        (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
      expect(u32(out, 0x0004)).toBe(u32(bytes, 0x0004)); // 日期
      expect(u32(out, 0x268e)).toBe(u32(bytes, 0x268e)); // 物价指数
    });
  }
});

describe('★★ 時光機快照：区表自洽 + 与状态块共用一套字段映射', () => {
  it('assertSnapshotRegionTable：28 区不重叠、恰好铺满 10,008（含标记/指针/5 字节填充）', () => {
    expect(() => assertSnapshotRegionTable()).not.toThrow();
    expect(SNAPSHOT_REGIONS).toHaveLength(28);
    const total = SNAPSHOT_REGIONS.reduce(
      (s, r) => s + ORIGINAL_SAVE_BLOCKS.find((b) => b.offset === r.stateBlockOffset)!.bytes,
      0,
    );
    expect(total + 4 + 4 + 5).toBe(ORIGINAL_PLAYER_SNAPSHOT_SIZE);
  });

  it('每个区都落在状态块表里，且快照偏移单调递增（无重复）', () => {
    const offsets = new Set<number>();
    let prev = -1;
    for (const r of SNAPSHOT_REGIONS) {
      expect(ORIGINAL_SAVE_BLOCKS.some((b) => b.offset === r.stateBlockOffset)).toBe(true);
      expect(r.snapshotOffset).toBeGreaterThan(prev);
      prev = r.snapshotOffset;
      offsets.add(r.snapshotOffset);
    }
    expect(offsets.size).toBe(SNAPSHOT_REGIONS.length);
  });

  /**
   * ★ 可证伪的核心性质：**同一个 `GameState` 写出的快照区，必须与写出的状态块区逐字节相同**。
   *   两边的偏移来自**两条独立提取**（状态块块序表 vs 快照 memcpy 表），
   *   所以任何一处偏移抄错都会在这里炸。
   */
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：快照的每个区 == 同名状态块区（同源字段映射）`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));

      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const block = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });
      const snap = writePlayerSnapshot({
        state,
        carry: new Uint8Array(ORIGINAL_PLAYER_SNAPSHOT_SIZE),
        mapDataSize: save.mapData.length,
      });

      expect(snap).toHaveLength(ORIGINAL_PLAYER_SNAPSHOT_SIZE);
      for (const r of SNAPSHOT_REGIONS) {
        const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
        const got = snap.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes);
        const want = block.subarray(b.offset, b.offset + b.bytes);
        expect(
          Buffer.from(got).equals(Buffer.from(want)),
          `快照区 +0x${r.snapshotOffset.toString(16)} ≠ 状态块 0x${b.offset.toString(16)}`,
        ).toBe(true);
      }
      // 两格非状态块
      const u32 = (o: number): number =>
        (snap[o]! | (snap[o + 1]! << 8) | (snap[o + 2]! << 16) | (snap[o + 3]! << 24)) >>> 0;
      expect(u32(0x0000)).toBe(1); // 有效标记
      expect(u32(0x2714)).toBe(0); // 地图副本指针（读档时被 malloc 覆盖 ⇒ 可写 0）
    });
  }
});

/**
 * ★★ 真实数据验证：把 Save0 的 **slot 0（一个真的历史快照）** 的 28 个区
 * 「按状态块偏移」贴回状态块，解析成 `GameState`，再写出快照 ——
 * 28 个区必须**逐字节还原**。
 *
 * 这条是「原版写出的历史快照 → 本引擎解析 → 本引擎写回」的真实往返，
 * 不是合成数据。carry 清零后再验一遍：**完全建模**的那些区必须**不靠 carry** 也相等
 * （部分建模的区——玩家/物件/特殊实体/股票/道具——本来就有已知的未建模字节，单独列出）。
 */
for (const path of SAVES) {
  const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
  t(`${path.split('/').pop()}：slot 0 的 28 个区经解析→写回逐字节还原`, () => {
    const bytes = new Uint8Array(readFileSync(path));
    const mapDataSize = (bytes[0x2747]! | (bytes[0x2748]! << 8) | (bytes[0x2749]! << 16) | (bytes[0x274a]! << 24)) >>> 0;
    const slot0 = ORIGINAL_STATE_BLOCK_SIZE + mapDataSize;
    const slot = bytes.subarray(slot0, slot0 + ORIGINAL_PLAYER_SNAPSHOT_SIZE);
    // 该样本的这个槽必须是**有效**的，否则没什么可验
    const flag = (slot[0]! | (slot[1]! << 8) | (slot[2]! << 16) | (slot[3]! << 24)) >>> 0;
    if (flag === 0) return; // SAVE1 全槽无效 —— 跳过（不是失败）

    // ① 把这些区贴回状态块偏移，其余块保持原档（模拟"只回滚这些区"）
    const patched = new Uint8Array(bytes);
    for (const r of SNAPSHOT_REGIONS) {
      const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
      patched.set(slot.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes), b.offset);
    }
    const save = parseSave(patched);
    const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));

    // ② carry = 该槽原文 → 28 个区全部还原
    const out = writePlayerSnapshot({ state, carry: slot, mapDataSize });
    for (const r of SNAPSHOT_REGIONS) {
      const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
      expect(
        Buffer.from(out.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes))
          .equals(Buffer.from(slot.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes))),
        `区 +0x${r.snapshotOffset.toString(16)} 未还原`,
      ).toBe(true);
    }

    // ③ carry 清零 → **完全建模**的区仍相等（证明它们真从 `GameState` 写出）
    const outZero = writePlayerSnapshot({
      state,
      carry: new Uint8Array(ORIGINAL_PLAYER_SNAPSHOT_SIZE),
      mapDataSize,
    });
    let checked = 0;
    for (const r of SNAPSHOT_REGIONS) {
      if (!MODELED_BLOCK_OFFSETS.includes(r.stateBlockOffset)) continue;
      const b = ORIGINAL_SAVE_BLOCKS.find((x) => x.offset === r.stateBlockOffset)!;
      checked++;
      expect(
        Buffer.from(outZero.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes))
          .equals(Buffer.from(slot.subarray(r.snapshotOffset, r.snapshotOffset + b.bytes))),
        `完全建模区 +0x${r.snapshotOffset.toString(16)} 未由 GameState 写出`,
      ).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(17); // 28 区里至少 17 个是完全建模块
  });
}

describe('★★ 整份文件：`snapshots` 给与不给的两种行为', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：不给 snapshots ⇒ 与从前完全一致（仍逐字节相等）`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(save.mapData));
      const out = writeOriginalSaveFile({
        state,
        map: parseMap(save.mapData),
        carry: bytes,
      });
      expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
    });

    t(`${path.split('/').pop()}：给 snapshots=[null×4] ⇒ 4 个槽全零、文件长度不变`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(save.mapData));
      const out = writeOriginalSaveFile({
        state,
        map: parseMap(save.mapData),
        carry: bytes,
        snapshots: [null, null, null, null],
      });
      expect(out).toHaveLength(bytes.length);
      const M = save.mapData.length;
      const snapStart = ORIGINAL_STATE_BLOCK_SIZE + M;
      for (let i = 0; i < 4; i++) {
        const slotOff = snapStart + i * (ORIGINAL_PLAYER_SNAPSHOT_SIZE + M);
        // 10,008 字节槽全零
        for (let k = 0; k < ORIGINAL_PLAYER_SNAPSHOT_SIZE; k++) {
          if (out[slotOff + k] !== 0) {
            throw new Error(`槽 ${i} 的 +0x${k.toString(16)} 不是 0 —— 应当全零`);
          }
        }
        // ⚠️ 地图副本仍是 carry（本轮的已知边界）
        expect(
          Buffer.from(out.subarray(slotOff + ORIGINAL_PLAYER_SNAPSHOT_SIZE, slotOff + ORIGINAL_PLAYER_SNAPSHOT_SIZE + M))
            .equals(Buffer.from(bytes.subarray(slotOff + ORIGINAL_PLAYER_SNAPSHOT_SIZE, slotOff + ORIGINAL_PLAYER_SNAPSHOT_SIZE + M))),
        ).toBe(true);
      }
    });
  }
});

/**
 * ★★ 「写了但读错/没读」的三个字段 —— **只能靠构造字节验证**。
 *
 * 两个真实存档在 `player+0x43`、`+0x44/0x46/0x48`、`+0x66/+0x67` 上**全是 0**
 * （实测），所以「逐字节往返相等」在这里是**空的**。本用例往真档里写非 0 值再走
 * 完整导入→导出，因此是可证伪的：若哪天有人把映射退回
 * `savedTrafficMethod: f67` / `misfortune: 0`，它会立刻红。
 *
 * 三处修复（第 36 条）：
 *  1. `misfortune`/`fortune`/`luck` ← `+0x44/0x46/0x48`（**有符号**）：先前硬编码 0，
 *     而写侧一直在写 ⇒ 带神明附身的存档读回来三项修正全丢。
 *  2. `savedTrafficMethod` ← `+0x66`（先前读 `+0x43` —— 全 exe 无读无写的死字节）。
 *  3. `savedNdices` ← `+0x67`（先前读 `+0x44`，其实是 misfortune）。
 *     且这两项**写侧先前从来没写** ⇒ 「梦游中被存档→读回→醒来」会把
 *     trafficMethod/ndices 还原成 undefined。
 */
describe('★★ 神明三项修正 + 夢遊卡备份字段（构造字节验证）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：+0x44/46/48 与 +0x66/67 非 0 时能逐字节往返`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      // 构造：玩家 0 = 天使的三项修正（-100/60/60）+ 夢遊备份（2/3）
      const bent = new Uint8Array(bytes);
      const o = 0x0010;
      bent[o + 0x44] = 0x9c; bent[o + 0x45] = 0xff; // -100（i16 补码）
      bent[o + 0x46] = 0x3c; bent[o + 0x47] = 0x00; // 60
      bent[o + 0x48] = 0x3c; bent[o + 0x49] = 0x00; // 60
      bent[o + 0x66] = 2; // savedTrafficMethod
      bent[o + 0x67] = 3; // savedNdices

      const save = parseSave(bent);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      const p0 = state.players[0]!;
      // 1. 有符号导入（这正是 `rules/objects.ts` 里**天使**那一行）
      expect(p0.misfortune).toBe(-100);
      expect(p0.fortune).toBe(60);
      expect(p0.luck).toBe(60);
      // 2/3. 夢遊备份读的是 +0x66/+0x67
      expect(p0.savedTrafficMethod).toBe(2);
      expect(p0.savedNdices).toBe(3);

      // 写回：carry 清零也必须一致（证明这三项来自 GameState 而非 carry）
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });
      expect(Array.from(out.subarray(o + 0x44, o + 0x4a))).toEqual([0x9c, 0xff, 0x3c, 0x00, 0x3c, 0x00]);
      expect(Array.from(out.subarray(o + 0x66, o + 0x68))).toEqual([2, 3]);
    });
  }
});

/**
 * ★★ 第 41 条并入完全建模的 8 个块 —— 其中 5 个在两个样本里**本身就非零**
 * （`tools` 多人有道具、`toolStock` = [9,1,10,10,9,9,5,1]、`gameMap/gameStage` = (3,0)/(3,1)、
 * `initialFund` = 300000），所以上面那条「carry 清零后仍逐字节相等」已经把
 * **它们真的从 `GameState` 写出来**证死了。
 *
 * 剩下三个（`landTenureIndex` `0x267e`、两条勝利條件 `0x2682/0x2686`）
 * 在两个样本里**恒为 0** ⇒ 只能**构造字节**来钉。
 */
describe('★★ 只在样本里恒 0 的三个块（构造字节验证，第 41 条）', () => {
  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：土地權限档位 + 两条勝利條件写出后能读回`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      // 先确认这三格在样本里确实是 0（否则这条用例就不是"构造"而是"复读"）
      const u32at = (b: Uint8Array, o: number): number =>
        (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
      expect(u32at(bytes, 0x267e)).toBe(0);
      expect(u32at(bytes, 0x2682)).toBe(0);
      expect(u32at(bytes, 0x2686)).toBe(0);

      const bent = {
        ...state,
        landTenureIndex: 3,
        winConditions: { targetDays: 300, targetWealth: 2_000_000 },
      };
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state: bent, carry: zeroed, mapDataSize: save.mapData.length });
      expect(u32at(out, 0x267e), '土地權限档位').toBe(3);
      expect(u32at(out, 0x2682), '勝利條件·天').toBe(300);
      expect(u32at(out, 0x2686), '勝利條件·資產').toBe(2_000_000);
    });
  }

  for (const path of SAVES) {
    const t = existsSync(path) && existsSync(MAP) ? it : it.skip;
    t(`${path.split('/').pop()}：gameMap/gameStage 是 globalMapId 的两位拆分`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const { state } = importOriginalSave(save, parseMap(new Uint8Array(readFileSync(MAP))));
      expect(state.globalMapId).toBe(save.gameStage * 4 + save.gameMap);
      const zeroed = new Uint8Array(ORIGINAL_STATE_BLOCK_SIZE);
      const out = writeStateBlock({ state, carry: zeroed, mapDataSize: save.mapData.length });
      expect(out[0x0008]! | (out[0x0009]! << 8)).toBe(save.gameMap);
      expect(out[0x000a]! | (out[0x000b]! << 8)).toBe(save.gameStage);
      // 非平凡：样本的 map/stage 不是 (0,0)
      expect(save.gameMap + save.gameStage).toBeGreaterThan(0);
    });
  }
});

/**
 * ★★ 42 块的三分**必须恰好铺满**（第 41 条）：
 *   完全建模 30 + 部分建模 5 + 走 carry 7 = 42。
 *
 * 这条断言的价值：任何「加了字段却忘了从 `MODELED_*` 里挪出来」「写了却没声明」
 * 的漂移都会在这里炸。第 41 条就是靠逐偏移对账发现 `0x2747`（地图块长度）
 * **写了却没声明**、以及 8 个「状态里有字段却没写」的块。
 */
describe('★ 42 块三分：完全建模 / 部分建模 / carry 恰好铺满', () => {
  it('三个集合互不相交，并集 = 42 块', () => {
    const all = ORIGINAL_SAVE_BLOCKS.map((b) => b.offset);
    const modeled = new Set(MODELED_BLOCK_OFFSETS);
    const partial = new Set(PARTIALLY_MODELED_BLOCK_OFFSETS);
    // 互不相交
    for (const o of modeled) expect(partial.has(o), `0x${o.toString(16)} 同时出现在两个表里`).toBe(false);
    // 声明的偏移都真实存在
    for (const o of [...modeled, ...partial]) {
      expect(all.includes(o), `0x${o.toString(16)} 不在 42 块表里`).toBe(true);
    }
    // 并集铺满
    const carried = all.filter((o) => !modeled.has(o) && !partial.has(o));
    expect(modeled.size + partial.size + carried.length).toBe(ORIGINAL_SAVE_BLOCKS.length);
    expect(modeled.size).toBe(31);
    expect(partial.size).toBe(5);
    expect(carried.length).toBe(6);
    expect(carried.map((o) => `0x${o.toString(16)}`)).toEqual([
      // 这 6 块的「为什么没写」见 `save-writer.ts` 末尾的表
      // （`0x2526` 公佈欄挂牌表已并入**部分建模** —— 第 52 条；
      //   `0x01b0` 人类玩家数已升为**完全建模** —— 第 61 条）
      '0x267a', '0x269a', '0x269e', '0x26a6', '0x26aa', '0x26ae',
    ]);
  });

  it('`carriedBlocks()` 与上面算出来的一致', () => {
    const offsets = carriedBlocks().map((b) => b.offset);
    expect(offsets).toEqual([0x267a, 0x269a, 0x269e, 0x26a6, 0x26aa, 0x26ae]);
  });
});

// ============================================================
//  ★★ 時光機快照的**读入**（原版读档后時光機照常能用）
// ============================================================

/** 原版存档里第 i 个快照槽的文件偏移 */
function snapshotOffsetOf(mapDataSize: number, i: number): number {
  return ORIGINAL_STATE_BLOCK_SIZE + mapDataSize + i * (ORIGINAL_PLAYER_SNAPSHOT_SIZE + mapDataSize);
}

describe('★★ 快照读入：从原版存档里把逐回合快照还原出来', () => {
  for (const path of SAVES) {
    const has = existsSync(path) && existsSync(MAP);
    const t = has ? it : it.skip;
    t(`${path.split('/').pop()}：有快照的槽能还原，空槽保持 null`, () => {
      const bytes = new Uint8Array(readFileSync(path));
      const save = parseSave(bytes);
      const imported = importOriginalSaveWithSnapshots(bytes, parseMap(save.mapData));
      const snapshots = imported.state.snapshots;
      expect(snapshots).toHaveLength(4);

      // 有效标记 = 快照 +0x0000（原版 `0x004480ce` 写 1）；只有真人槽有
      const flagged: number[] = [];
      for (let i = 0; i < 4; i++) {
        const at = snapshotOffsetOf(save.mapData.length, i);
        const flag = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
        expect(snapshots[i] === null, `槽 ${i}：有效标记=${flag}`).toBe(flag === 0);
        if (flag !== 0) flagged.push(i);
      }

      for (const i of flagged) {
        const back = restoreSnapshot({ ...imported.state, currentPlayer: i });
        expect(back, `槽 ${i} 应该能还原`).not.toBeNull();
        // ★★ 独立交叉验证：还原出来的日期必须等于**快照字节里**那个日期
        //    （快照 +0x0004 是日期，与状态块 +0x0004 同义）
        const at = snapshotOffsetOf(save.mapData.length, i);
        const u = (o: number): number =>
          ((bytes[at + o] ?? 0) |
            ((bytes[at + o + 1] ?? 0) << 8) |
            ((bytes[at + o + 2] ?? 0) << 16) |
            ((bytes[at + o + 3] ?? 0) << 24)) >>>
          0;
        const d = u(4);
        expect({
          year: back!.year,
          month: back!.month,
          day: back!.day,
        }).toEqual({ year: d >>> 16, month: (d >>> 8) & 0xff, day: d & 0xff });
      }
      // ★ 两个样本恰好互补，两条断言都不空：
      //   · Save0.dat（两名人类玩家）→ 有快照槽；
      //   · SAVE1.DAT → **四个槽全空**（有效标记全 0）⇒ 读入器不能凭空造快照。
      if (path.endsWith('Save0.dat')) {
        expect(flagged, 'Save0 应当有真人快照槽').toEqual([0, 1]);
      } else {
        expect(flagged, 'SAVE1 四个槽都是空的').toEqual([]);
        expect(snapshots).toEqual([null, null, null, null]);
      }
    });
  }

  it('★ 快照的日期早于当前局面（回合开始 vs 现在）—— 样本非平凡', () => {
    const path = SAVES[0]!;
    if (!existsSync(path)) return;
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const imported = importOriginalSaveWithSnapshots(bytes, parseMap(save.mapData));
    const back = restoreSnapshot({ ...imported.state, currentPlayer: 0 });
    expect(back).not.toBeNull();
    const key = (s: { year: number; month: number; day: number }): number =>
      s.year * 10_000 + s.month * 100 + s.day;
    expect(key(back!), '快照是**回合开始时**的状态，应当 <= 当前').toBeLessThanOrEqual(
      key(imported.state),
    );
  });
});

describe('★★ 快照往返：写出去再读回来，建模字段一致', () => {
  it('两份「掰过」的快照原样回来，空槽回来还是 null', () => {
    const path = SAVES[0]!;
    if (!existsSync(path)) return;
    const bytes = new Uint8Array(readFileSync(path));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    const { state } = importOriginalSave(save, map);

    const bent0: typeof state = {
      ...state,
      year: 1999,
      month: 5,
      day: 3,
      players: state.players.map((p, i) => (i === 0 ? { ...p, cash: 123_456 } : p)),
    };
    const bent2: typeof state = { ...state, year: 2001, month: 8, day: 7 };
    const out = writeOriginalSaveFile({
      state,
      map,
      carry: bytes,
      snapshots: [bent0, null, bent2, null],
    });
    const r = importOriginalSaveWithSnapshots(out, map);

    expect(r.state.snapshots[1], 'null 槽写全零 → 读回来还是 null').toBeNull();
    expect(r.state.snapshots[3]).toBeNull();

    const r0 = restoreSnapshot({ ...r.state, currentPlayer: 0 });
    expect(r0).not.toBeNull();
    expect({ y: r0!.year, m: r0!.month, d: r0!.day, cash: r0!.players[0]!.cash }).toEqual({
      y: 1999,
      m: 5,
      d: 3,
      cash: 123_456,
    });

    const r2 = restoreSnapshot({ ...r.state, currentPlayer: 2 });
    expect(r2).not.toBeNull();
    expect({ y: r2!.year, m: r2!.month, d: r2!.day }).toEqual({ y: 2001, m: 8, d: 7 });
  });
});

// ============================================================
//  ★★ 公佈欄挂牌表（块 0x2526）的**存档往返**
//    ★ 两个真实样本整块全 0 ⇒ 只能**构造字节**验证（老规矩）
// ============================================================

describe('★★ 公佈欄挂牌表：存档往返（先前整块走 carry ⇒ 挂牌会丢）', () => {
  const ROOT0 = `${ROOT}/Rich4/Save0.dat`;
  const readSave0 = (): { bytes: Uint8Array; map: ReturnType<typeof parseMap>; state: ReturnType<typeof importOriginalSave>['state'] } | null => {
    if (!existsSync(ROOT0) || !existsSync(MAP)) return null;
    const bytes = new Uint8Array(readFileSync(ROOT0));
    const save = parseSave(bytes);
    const map = parseMap(save.mapData);
    return { bytes, map, state: importOriginalSave(save, map).state };
  };

  it('★ 写出的块能按槽读回来（4 玩家 × 7 槽 × 12 字节）', () => {
    const ctx = readSave0();
    if (ctx === null) return;
    const listings = [
      { kind: 4 as const, id: 7, price: 1234, amount: 0 }, // 玩家0 槽0：卡片
      { kind: 1 as const, id: 3, price: 98_765, amount: 42 }, // 玩家0 槽2：股票（带股數）
      // 玩家1 槽1：地產 —— ★ 带類型/等級快照（槽 `+0xa`/`+0xb`）
      { kind: 2 as const, id: 2001, price: 33_000, amount: 0, estateType: 1, estateLevel: 4 },
      { kind: 3 as const, id: 11, price: 500, amount: 0 }, // 玩家2 槽6
    ];
    const board = ctx.state.noticeBoard.map((c) => [...c]);
    board[0]![0] = listings[0]!;
    board[0]![2] = listings[1]!;
    board[1]![1] = listings[2]!;
    board[2]![6] = listings[3]!;
    const state = { ...ctx.state, noticeBoard: board };

    const out = writeOriginalSaveFile({ state, map: ctx.map, carry: ctx.bytes });
    const back = parseSave(out).noticeBoard;
    expect(back).toHaveLength(28);
    // 槽 0 / 槽 2 玩家 0；槽 6 玩家 2
    expect(back[0]).toEqual({ kind: 4, id: 7, price: 1234, amount: 0, estateType: 0, estateLevel: 0 });
    expect(back[2]).toEqual({
      kind: 1,
      id: 3,
      price: 98_765,
      amount: 42,
      estateType: 0,
      estateLevel: 0,
    });
    expect(back[2 * 7 + 6]).toEqual({
      kind: 3,
      id: 11,
      price: 500,
      amount: 0,
      estateType: 0,
      estateLevel: 0,
    });
    // ★ 地產那一格：類型/等級快照原样回来（`+0xa` = 1、`+0xb` = 4）
    expect(back[1 * 7 + 1]).toEqual({
      kind: 2,
      id: 2001,
      price: 33_000,
      amount: 0,
      estateType: 1,
      estateLevel: 4,
    });
    // 空槽一律 kind = 0（原版撤件也是整格清零）
    expect(back[1]!.kind).toBe(0);
    expect(back[3]!.kind).toBe(0);
    expect(back[2 * 7 + 5]!.kind).toBe(0);
  });

  it('★ 读档侧：文件里的挂牌表能还原成 state.noticeBoard', () => {
    const ctx = readSave0();
    if (ctx === null) return;
    const board = ctx.state.noticeBoard.map((c) => [...c]);
    board[1]![3] = { kind: 2, id: 2003, price: 60_000, amount: 0, estateType: 0, estateLevel: 2 };
    const out = writeOriginalSaveFile({
      state: { ...ctx.state, noticeBoard: board },
      map: ctx.map,
      carry: ctx.bytes,
    });
    const save = parseSave(out);
    const reimported = importOriginalSave(save, parseMap(save.mapData)).state;
    expect(reimported.noticeBoard[1]?.[3]).toEqual({
      kind: 2,
      id: 2003,
      price: 60_000,
      amount: 0,
      estateType: 0,
      estateLevel: 2,
    });
    expect(reimported.noticeBoard[0]?.[0]).toBeNull();
    // 固定 7 槽（不是可变长）
    expect(reimported.noticeBoard[0]).toHaveLength(7);
  });

  it('★ 两个真实样本的挂牌表本来就是空的（所以上面必须构造字节）', () => {
    for (const path of SAVES) {
      if (!existsSync(path)) continue;
      const save = parseSave(new Uint8Array(readFileSync(path)));
      expect(
        save.noticeBoard.every((s) => s.kind === 0),
        `${path} 的挂牌表应当全 0`,
      ).toBe(true);
    }
  });
});
