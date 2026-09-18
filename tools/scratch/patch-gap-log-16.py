# -*- coding: utf-8 -*-
"""把第 16 条修复写进 docs/gaps/README.md 的修复日志。

⚠️ 单独写成文件：本机 python3 从 **stdin** 读源码时不按 UTF-8 解码，
含中文的 heredoc 会直接 `SyntaxError: Non-UTF-8 code starting with '\\xe8'`。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

ANCHOR = "\n> ⚠️ **第 15 条的诚实边界（很重要）**"
assert ANCHOR in s, "锚点未命中"

ROW16 = (
    "| 16 | **簇 F：`mutateLand`/`mutateFacility` 的 mode 1 只清归属，不清等级/地契** —— "
    "原版 `0x0040abae`–`0x0040abc3` 是**一次清四项**且**无前置判据**："
    "`[+0x19]=0`(owner) `[+0x1a]=0`(**level**) `[+0x18]=0`(type) `[+0x30]=0`(flast)；"
    "設施支同形，但 `flast` 在 **`+0x34`**（与住宅不同）。remake 的 `MUTATE_CLEAR_OWNER` "
    "只写 `owner/type`（設施支漏 `flast`）⇒ 新聞 5/19 这类拆屋事件会留下"
    "**无主的「残楼」**（房子还在、地契没了），玩家直接可见 "
    "| `mutateLand` 补 `level: 0` 与 `flast: 0`；`mutateFacility` 补 `flast: 0`；"
    "并把两处 mode 1 的文档注释订正为「**完全清除**」 "
    "| `monster.test.ts` 强化旧断言（原测试**只查 owner/type、从不查 level** —— 这正是 bug 长期存活的原因）"
    "为四项全查，并补「无前置判据 ⇒ 恒返回 changed=true」一例；全套 4877 通过 "
    "| 04（news 5/19）、02（§三#8） |"
)

NOTE = (
    "> **第 16 条的教训**：这条 bug 能长期存活，**不是因为难点，而是因为旧测试查漏了字段** —— "
    "`expect(r.land.owner).toBe(0); expect(r.land.type).toBe(LAND_TYPE_HOUSE);` 看起来很到位，"
    "偏偏没查 `level`，而漏的正是 `level`。"
    "**写断言时要对着实现逐字段过一遍，不能只挑「看起来会变」的两个。**\n"
)

s = s.replace(ANCHOR, "\n" + ROW16 + "\n\n" + NOTE + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
