#!/usr/bin/env python3
"""第 39 条（续）：读档时补上設施的**研发进度**（`+0x1d` 项目 / `+0x1e` 天数）。

发现路径：`withLiveMapState` 的「合并前后应逐字节相同」用例在 Save0 上差 **1 字节**
（設施表 `+0x1ead`）—— 地图块里 2 号設施 `researchProject = 1`，而导入后的
`state.facilityResearchProject[2] = 0`。查下去：`savegame.ts` 把这两条数组
**一律填 0**（`facilityFieldFromMap(map, () => 0)`），从没读过地图块。
⇒ 读原版存档时，**正在研发的設施进度归零**。
"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/loaders/savegame.ts"

old = """    facilityResearchProject: facilityFieldFromMap(map, () => 0),
    facilityResearchDays: facilityFieldFromMap(map, () => 0),"""
new = """    // ★★ 研发进度要**从地图块读**（`+0x1d` 项目 / `+0x1e` 剩余天数）。
    //   先前一律填 0 ⇒ 读原版存档时**正在研发的設施进度归零**。
    //   这个坑是被 `withLiveMapState` 的「合并前后逐字节相同」用例揪出来的：
    //   Save0 的 2 号設施在地图块里 `researchProject = 1`，而导入后是 0。
    facilityResearchProject: facilityFieldFromMap(map, (f) => f.researchProject ?? 0),
    facilityResearchDays: facilityFieldFromMap(map, (f) => f.researchDays ?? 0),"""
src = P.read_text(encoding="utf-8")
assert src.count(old) == 1, src.count(old)
P.write_text(src.replace(old, new, 1), encoding="utf-8")
print("✓ savegame.ts 研发进度从地图块读")
