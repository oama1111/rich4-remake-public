# -*- coding: utf-8 -*-
"""从 rich4-spec 的 save-format.md **机械提取**存档状态块的 42 块表，生成 TS 模块的数据部分。

为什么不手抄：42 行的 offset/count/size 手抄一遍必错，而这张表是整个写档器的地基。
生成方式可复现：`python3 tools/scratch/gen-save-block-table.py`
"""
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SPEC = os.path.abspath(os.path.join(ROOT, "..", "rich4-spec", "docs", "systems", "save-format.md"))
OUT = os.path.join(ROOT, "packages", "core", "src", "loaders", "save-block-table.ts")

with io.open(SPEC, encoding="utf-8") as f:
    doc = f.read()

rows = []
for m in re.finditer(
    r"^\|\s*`\+0x([0-9a-fA-F]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*`(0x[0-9a-fA-F]+)`\s*\|\s*(\d+)\s*\|",
    doc,
    re.M,
):
    off, cnt, size, glob, byt = m.groups()
    rows.append((int(off, 16), int(cnt), int(size), int(glob, 16), int(byt)))

total = sum(r[4] for r in rows)
assert len(rows) == 42, f"期望 42 块，提取到 {len(rows)}"
assert total == 10055, f"期望 10055 字节，得到 {total}"
last_end = rows[-1][0] + rows[-1][4]
assert last_end == 0x274B, hex(last_end)

lines = []
lines.append("/*")
lines.append(" * 原版存档「状态块」的 42 个静态块 —— **机械提取，不要手改**")
lines.append(" * SPDX-License-Identifier: GPL-3.0-or-later")
lines.append(" *")
lines.append(" * @source `rich4-spec/docs/systems/save-format.md` §二「权威块序」")
lines.append(" *   该表由 `fread`/`fwrite` 序列的 `count × size` 逐行累加得出，")
lines.append(" *   并与两份真实存档的文件大小闭合（见该文档 §一）。")
lines.append(" *")
lines.append(" * 生成：`python3 tools/scratch/gen-save-block-table.py`（校验了 42 块 / 10,055 字节 /")
lines.append(" *   末块结束于 0x274b = 状态块大小 10,059）。")
lines.append(" */")
lines.append("")
lines.append("/** 版本标识的 4 字节 @source `0x00402fd7 mov dword [esp+0x28], 0x26` */")
lines.append("export const ORIGINAL_SAVE_HEADER = 0x26;")
lines.append("")
lines.append("/**")
lines.append(" * 状态块总长 = 10,059 字节（= 4 字节版本标识 + 42 个静态块 10,055 字节）。")
lines.append(" * @source `parseSave` 的 `OFFSET.mapData = 0x274b`，与本表末块结束位置**精确相等**。")
lines.append(" */")
lines.append("export const ORIGINAL_STATE_BLOCK_SIZE = 0x274b;")
lines.append("")
lines.append("/** 每玩家的「時光機」快照 @source `0x2718` */")
lines.append("export const ORIGINAL_PLAYER_SNAPSHOT_SIZE = 0x2718;")
lines.append("")
lines.append("export interface SaveBlock {")
lines.append("  /** 块在状态块内的偏移 */")
lines.append("  offset: number;")
lines.append("  /** `fread`/`fwrite` 的字面 count */")
lines.append("  count: number;")
lines.append("  /** `fread`/`fwrite` 的字面 size */")
lines.append("  size: number;")
lines.append("  /** 字节数 = count × size */")
lines.append("  bytes: number;")
lines.append("  /** 目标全局（`.bss`/DGROUP 地址），用于与其它规格交叉引用 */")
lines.append("  global: number;")
lines.append("}")
lines.append("")
lines.append("/** 42 个静态块，**按写档顺序**（与读档顺序逐项配对，见 save-format.md §二之二） */")
lines.append("export const ORIGINAL_SAVE_BLOCKS: readonly SaveBlock[] = [")
for off, cnt, size, glob, byt in rows:
    lines.append(
        "  { offset: 0x%04x, count: %d, size: %d, bytes: %d, global: 0x%08x },"
        % (off, cnt, size, byt, glob)
    )
lines.append("];")
lines.append("")

with io.open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("OK 已写入:", OUT, "块数", len(rows), "总字节", total, "末块结束", hex(last_end))
