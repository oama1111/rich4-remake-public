#!/usr/bin/env python3
"""给 save-writer.test.ts 追加：快照区表自洽 + 合成状态的可证伪一致性 + 真实存档 slot 0 的往返。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/loaders/save-writer.test.ts"

BLOCK = r'''
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
'''

src = P.read_text(encoding="utf-8")
src = src.rstrip("\n") + "\n" + BLOCK

# 补充 import
old_imp = """import {
  MODELED_BLOCK_OFFSETS,"""
new_imp = """import {
  MODELED_BLOCK_OFFSETS,
  SNAPSHOT_REGIONS,
  assertSnapshotRegionTable,
  writePlayerSnapshot,"""
assert src.count(old_imp) == 1
src = src.replace(old_imp, new_imp, 1)

P.write_text(src, encoding="utf-8")
print("已追加测试；文件行数 =", len(src.split(chr(10))))
