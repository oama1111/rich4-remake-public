# -*- coding: utf-8 -*-
"""把第 15 条修复写进 docs/gaps/README.md 的修复日志。

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

ANCHOR = "\n> ⚠️ **第 14 条的诚实边界**"
assert ANCHOR in s, "锚点未命中"

ROW15 = (
    "| 15 | **簇 E：地契到期日与涨价/查封倒计时导入时被硬填 0**（D-04/D-05）—— 原版把它们存在"
    "**地图块内**（住宅 `flast @ +0x30`、`price_status @ +0x17`；商業 `flast @ +0x34`"
    "（**与住宅不同**，`@source 0x004425e9`）、`price_status @ +0x1c`），而导入路径用的正是"
    "**存档自带的地图块** ⇒ 真值本就在手边，却被 `fill(0)` 丢掉 ⇒ 读档后 "
    "`sweepPriceStatus`（每日递减涨价/跌价/查封）与 `tenureExpiresToday`（地契到期归无主）**永不触发** "
    "| ① `map.ts` 的 `FacilityInfo` 补 `flast`（`u32(o + 0x34)`，附住宅/商業偏移不同的 @source）；"
    "② `new-game.ts` 新增 `landPriceStatusFromMap` / `landTenureFromMap`；"
    "③ `savegame.ts` 三处改用它（`landTenure` / `landPriceStatus` / `facilityTenure`） "
    "| `savegame.test.ts` 新增 1 例：**自己往存档地图块里写非 0 值**（1 号地 `flast=0x07e5060f`、"
    "`+0x17=0x30`；1 号設施 `+0x34=0x07e5060f`、`+0x1c=0x50`）再走完整导入路径，断言四项原样出来；"
    "全套 4876 通过 | 07（§3 D-04/D-05） |"
)

NOTE = (
    "> ⚠️ **第 15 条的诚实边界（很重要）**：**两份可得的真实存档里这几项恰好全为 0** —— "
    "我实测过 Save0 的 55 块地 / 8 处設施、SAVE1 的 0 块地 / 20 处設施，"
    "`price_status` 与 `flast` 的非 0 计数都是 **0**。"
    "（顺带一个新事实：**SAVE1 的 `num_lands` 真的是 0**，是一张没有住宅地的地图，"
    "所以它不能用来验证任何「地块」相关字段。）\n"
    ">\n"
    "> ⇒ 这条修复**无法用真实存档观测**。因此测试写成**自己往地图块里写非 0 值**再导入，"
    "这样断言是**可证伪**的：若导入路径回退成硬填 0，它会立刻失败。"
    "**「结构上修对了」与「样本能观测到差别」是两件事，后者在这里不成立，如实记下。**\n"
)

s = s.replace(ANCHOR, "\n" + ROW15 + "\n\n" + NOTE + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
