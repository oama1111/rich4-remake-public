# -*- coding: utf-8 -*-
"""把第 19 条（玩家块 0x68 部分序列化）追加进第 18 条的日志块。"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

ANCHOR = "> ⚠️ **第 18 条的诚实边界（离「能用」还有多远）**"
assert ANCHOR in s

ADD = (
    "> **第 19 条（同日追加）：玩家块 `0x0010`（4 × 0x68）已部分建模** —— "
    "照 `save.ts` 的 `parsePlayer`（那份解析器逐字段带 @source）写出其逆，"
    "已接 **22 个字段**：`xpos/ypos/nodeId/lastNodeId/direction/trafficMethod/ndices/character/"
    "whoPlays/cash/moneyInBank/loan/specialFinance/loanDueDate/points/"
    "blocking(8 项)/daysRejectedByBank/totalWinterSleepDays/monthlyPaid/monthlyReceived`。"
    "往返测试立刻抓到一处**写宽错误**：`+0x08`/`+0x0c` 是 **u16**，用 `u32` 写会连带覆盖 "
    "`ypos` 与 `lastNodeId`（差异表现为 `0x1a/0x1b/0x1e` 等四字节一组）。修正后两份存档均通过。\n"
    ">\n"
    "> 顺带把「已建」分成两类，让断言与实现相符、不夸大：\n"
    "> · **完全建模**（21 块）→ 参加「清零 carry 后仍逐字节相等」的强断言；\n"
    "> · **部分建模**（1 块 = 玩家块）→ 只参加「carry=原文时逐字节相等」，"
    "因为 `color`/`isFemale`/六个人格字段/仇恨数组/神明·同盟 等**仍取自 carry**。\n"
    ">\n"
)

s = s.replace(ANCHOR, ADD + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
