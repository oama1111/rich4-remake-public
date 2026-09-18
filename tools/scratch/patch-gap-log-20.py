# -*- coding: utf-8 -*-
"""把第 20 条（玩家块剩余字段映射）追加进日志。"""
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
    "> **第 20 条（同日追加）：玩家块映射推进到约 90%** —— 用「**假设 + 两份存档逐字节确认**」"
    "的方法又定了 5 个字段，全部在两份存档上同时对上，因此不再是猜测：\n"
    "> `+0x17` ← `personality`、`+0x1a` ← `stockRatio`、`+0x44` ← `misfortune`、"
    "`+0x46` ← `fortune`、`+0x48` ← `luck`；另确认 `+0x14` ← `isMale`（非 0 为男）。\n"
    "> 加上第 19 条那批，玩家块 0x68 里**已写 33 个字段**。\n"
    ">\n"
    "> 方法上值得一提：这不再是「读代码猜」，而是**提出映射假设 → 让两份独立样本逐字节裁决**。"
    "假设错就会在 diff 里留下痕迹，假设对则两处同时消失 —— 这是**可证伪**的，"
    "比在文档里找字段名可靠得多。\n"
    ">\n"
    "> **仍未映射的字节（用 diff 量出来的，不是估计）**：\n"
    "> `+0x00..0x02`（`parsePlayer` 未读，看着像 Big5 名字字节 —— "
    "但 `GameState.Player` **根本没有名字字段**）、`+0x04` `color`（`SaveGame.PlayerState` 有、"
    "`GameState.Player` 没有）、`+0x1b` `f27`、`+0x4a` `f74`、`+0x64` `f100`（后三个状态里无对应字段）。\n"
    "> 这条同时暴露一个**状态侧缺口**：`GameState.Player` 缺 `name` 与 `color` 两个字段 —— "
    "写档器要完整，得先给状态补字段（那是另一轮的事，已记下）。\n"
    ">\n"
)

s = s.replace(ANCHOR, ADD + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
