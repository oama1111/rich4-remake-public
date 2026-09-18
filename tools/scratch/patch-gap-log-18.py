# -*- coding: utf-8 -*-
"""把第 18 条（原版存档写档器骨架）写进 docs/gaps/README.md 的修复日志。"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

ANCHOR = "\n> ⚠️ **第 17 条的诚实边界**"
assert ANCHOR in s

ROW = (
    "| 18 | **簇 B（阻断）：remake 没有「按原版格式写存档」的路径** —— 只写 JSON，"
    "「remake 写出的存档能被原版读」为 0 实现。本轮做**状态块**这一半并建立验证骨架 "
    "| ① `save-block-table.ts`：42 块表**从权威规格机械提取**（生成脚本可复跑，"
    "并断言 42 块 / 10,055 字节 / 末块结束于 `0x274b` = 状态块大小）；"
    "② `assertSaveBlockTable()` 断言 42 块**恰好铺满** `[0x0004, 0x274b)` —— "
    "任何 offset/size 抄写错误都会在这里炸；③ `writeStateBlock()`：**21 块**由 `GameState` 写出，"
    "其余走 `carry` 并在 `carriedBlocks()` 里**显式列出**（没人能误以为写档器已完整） "
    "| `save-writer.test.ts` 9 例：结构自洽 5 例 + 两份真实存档各 2 例。"
    "后两例是核心：① carry=原文件 → **逐字节相等**；② carry **清零**后，"
    "已建模块仍**逐字节相等**（这一条才是「真的从 `GameState` 写出来」的证据） "
    "| 07（阻断项 B） |"
)

FINDINGS = (
    "> **★ 这个骨架当天就抓到 3 个真实缺口**（都是往返比对逼出来的，不是猜的）：\n"
    ">\n"
    "> 1. **`[0x499084]`（月数计数器）存档里读了、导入时却硬置 0** —— `savegame.ts` 的 "
    "`totalMonths: 0`。后果：「土地现值 ÷ 月数」（`0x429f60 idiv`）与跨月计数读档后都错。"
    "**已修**（`save.ts` 加 `OFFSET.totalMonths = 0x2696`，导入改用 `save.totalMonths`；"
    "实测 Save0 = 9、SAVE1 = 0）。\n"
    "> 2. **`[0x499104]`（人类玩家数）的推导是错的** —— 按「`whoPlays == 1` 的人数」算得 1，"
    "而 Save0 原文是 **2**。⇒ 该块**退回 carry**，不写一个错的。\n"
    "> 3. **`state.tools` / `state.toolStock` 的下标基与存档布局未对齐** —— "
    "写出来的 `0x0690`（toolAmount）从 `0x69f` 起逐字节错位。⇒ 两块也退回 carry。\n"
    ">\n"
    "> 这三条都记在 `save-writer.ts` 末尾的「已知未建模块」表里，附具体症状。\n"
    "\n"
    "> ⚠️ **第 18 条的诚实边界（离「能用」还有多远）**：\n"
    "> · **只做了状态块**（10,059 字节）。**地图数据块**（原版地图格式的写出）与"
    "**每玩家的 10,008 字节快照 + 地图副本**（4 组）**都还没写** —— 没有这两部分，"
    "写出的文件原版**读不了**。\n"
    "> · 21/42 块已建；**17 块仍走 carry**（不是「没时间」，其中 4 块是**状态里根本没有**或在别处）。\n"
    "> · 需求侧的大件序列化器尚未编写：`player` 0x68、`specialActors` 16、"
    "`objects_info` 24、`market.stocks` 36、`holdings` 8、`history` 4。\n"
    "> · 因此**本轮没有让 remake 真的能写出可被原版读取的存档**；"
    "本轮的价值是**把地基（块表 + 往返验证）立起来并用它抓到了 3 个缺口**。\n"
)

s = s.replace(ANCHOR, "\n" + ROW + "\n\n" + FINDINGS + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
