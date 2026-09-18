#!/usr/bin/env python3
"""状态块审计：42 块表 vs `writeStateBlock` **实际写出的偏移**。

判据与地图块那次对账同一套（`map-format.md` 的「写出侧覆盖一览」）：
某块在表里存在、但写出器里没有任何一个字面偏移落在它的区间内 ⇒ 该块**整块走 carry**。
再对照 `GameState` 有没有对应字段，就能区分「漏做」与「状态里没有」。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TBL = (ROOT / "packages/core/src/loaders/save-block-table.ts").read_text(encoding="utf-8")
W = (ROOT / "packages/core/src/loaders/save-writer.ts").read_text(encoding="utf-8")

blocks = []
for m in re.finditer(
    r"\{ offset: (0x[0-9a-f]+), count: (\d+), size: (\d+), bytes: (\d+), global: (0x[0-9a-f]+) \}",
    TBL,
):
    blocks.append(dict(
        offset=int(m.group(1), 16), count=int(m.group(2)), size=int(m.group(3)),
        bytes=int(m.group(4)), global_=int(m.group(5), 16),
    ))

i = W.index("export function writeStateBlock")
body = W[i:W.index("\n}\n", i)]

writes = set()
for m in re.finditer(r"(?:u8|u16|u32|i16|i32|f32)\(out, (0x[0-9a-f]+)", body):
    writes.add(int(m.group(1), 16))
for m in re.finditer(r"out\[(0x[0-9a-f]+)", body):
    writes.add(int(m.group(1), 16))
for m in re.finditer(r"out\.fill\(0, (0x[0-9a-f]+)", body):
    writes.add(int(m.group(1), 16))
# 循环里的 `0x0654 + p.index * 15 + k` 这类：取基址
for m in re.finditer(r"(0x[0-9a-f]{4,}) \+ ", body):
    writes.add(int(m.group(1), 16))
# ⚠️ 助手调用里的字面偏移，例如 `writePlayerBlock(out, state, 0x0010)`
#    —— 第一版漏了这条，把玩家块误报成"整块走 carry"。
for m in re.finditer(r"\w+\(out, state, (0x[0-9a-f]+)", body):
    writes.add(int(m.group(1), 16))

carried = []
for b in blocks:
    hit = any(b["offset"] <= a < b["offset"] + b["bytes"] for a in writes)
    if not hit:
        carried.append(b)

print(f"42 块中，写出器**没有任何偏移落在区间内**的：{len(carried)} 块")
for b in carried:
    print(f"  0x{b['offset']:04x}  {b['bytes']:5d}B 全局 0x{b['global_']:06x}  count={b['count']} size={b['size']}")
print("\n其余块（有偏移落在区间内）：")
for b in blocks:
    if b in carried:
        continue
    inside = sorted(a for a in writes if b["offset"] <= a < b["offset"] + b["bytes"])
    print(f"  0x{b['offset']:04x}  {b['bytes']:5d}B  写了 {len(inside)} 处：{[hex(x) for x in inside][:8]}")
