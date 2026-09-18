# -*- coding: utf-8 -*-
"""把第 21 条（stock 三块建模）追加进日志。"""
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
    "> **第 21 条（同日追加）：接上股票三块，状态块覆盖 75% 完全建模 / 84% 含部分**\n"
    "> · `0x06f6` **行情历史**（12 × 144 × f32 = **6,912 字节，状态块的 69%**）→ 完全建模\n"
    "> · `0x21f6` **各玩家持仓**（4 × 12 × 8 = 384 字节）→ 完全建模\n"
    "> · `0x2376` **12 支股票记录**（36 B/条 = 432 字节）→ **部分建模**"
    "（只差每条 `+0x00` 的 4 字节，`parsePlayer` 侧未读 ⇒ 走 carry）\n"
    ">\n"
    "> 量出来的进度（不是估计）：**状态块 10,055 字节里，完全建模 7,551（75%）、"
    "部分建模 848（8%）、走 carry 仅 1,656（16%）**；块数 19 完全 / 2 部分 / 共 42。\n"
    "> 新增的 `f32` 写入器用一个共享 `DataView`，避免每条记录新建对象。\n"
    ">\n"
    "> 至此「清零 carry 后仍逐字节相等」这条强断言覆盖了**四分之三个状态块** —— "
    "也就是说这 7,551 字节**确实是从 `GameState` 写出来的**，不是抄来的。\n"
    ">\n"
)

s = s.replace(ANCHOR, ADD + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
