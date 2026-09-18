#!/usr/bin/env python3
"""第 39 条：地图块写出时先合并实时状态（`withLiveMapState`），
并把每玩家的地图副本也由该快照状态派生（round 28 遗留）。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/loaders/save-writer.ts"

E = [
    (
        "import",
        "import { writeMapBlock } from './map-writer.ts';",
        "import { writeMapBlock } from './map-writer.ts';\nimport { withLiveMapState } from './map-state.ts';",
        1,
    ),
    (
        "地图块用实时状态",
        """  const stateBlock = writeStateBlock({ state, carry, mapDataSize });
  const mapBlock = writeMapBlock(map, carry.subarray(ORIGINAL_STATE_BLOCK_SIZE, ORIGINAL_STATE_BLOCK_SIZE + mapDataSize));""",
        """  const stateBlock = writeStateBlock({ state, carry, mapDataSize });
  // ★★ 地图块的**归属/等级/种类/涨价档/地契**都存在地图块里，而实时值在 `GameState`
  //   —— 必须先合并再写，否则写出的永远是**装载时**的归属。
  //   （两份真实存档「读进来再写回去」逐字节相等，是因为那一刻两者恰好一致，
  //   实测 55 块地 / 8 处設施零处不一致 —— 所以这个坑一直没被测出来。）
  const mapBlock = writeMapBlock(
    withLiveMapState(map, state),
    carry.subarray(ORIGINAL_STATE_BLOCK_SIZE, ORIGINAL_STATE_BLOCK_SIZE + mapDataSize),
  );""",
        1,
    ),
    (
        "每玩家地图副本由快照状态派生",
        """    // ⚠️ 每玩家地图副本：仍是 carry（见 `snapshots` 的注释）
    out.set(
      carry.subarray(slotOff + SNAPSHOT_SIZE, slotOff + SNAPSHOT_SIZE + mapDataSize),
      slotOff + SNAPSHOT_SIZE,
    );""",
        """    // ★ 每玩家地图副本 = **那一刻的地图**：用快照状态合并后写出
    //   （`snapshots` 给定时才走这条；不给就整块走 carry）
    if (snap !== null && snap !== undefined) {
      out.set(
        writeMapBlock(
          withLiveMapState(map, snap),
          carry.subarray(slotOff + SNAPSHOT_SIZE, slotOff + SNAPSHOT_SIZE + mapDataSize),
        ),
        slotOff + SNAPSHOT_SIZE,
      );
    } else {
      // 没有快照 ⇒ 原版那份缓冲是 malloc 出来的零页（新局亦然）
      out.set(
        carry.subarray(slotOff + SNAPSHOT_SIZE, slotOff + SNAPSHOT_SIZE + mapDataSize),
        slotOff + SNAPSHOT_SIZE,
      );
    }""",
        1,
    ),
]

src = P.read_text(encoding="utf-8")
for name, old, new, want in E:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [{name}] 期望 {want} 实际 {got}")
    src = src.replace(old, new, want)
    print(f"✓ {name}")
P.write_text(src, encoding="utf-8")
print("已写入")
