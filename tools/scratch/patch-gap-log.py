# -*- coding: utf-8 -*-
"""把第 11/12 条修复写进 docs/gaps/README.md 的修复日志。

单独写成文件而不是 heredoc：本机 python3 从 stdin 读源码时不做 UTF-8 检测，
中文会直接 SyntaxError（`Non-UTF-8 code starting with '\\xe8'`）。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

ANCHOR = "\n> **教训（第 1 条就撞上）**"
assert ANCHOR in s, "锚点未命中"

ROW11 = (
    "| 11 | **簇 F：被动防御卡命中后不被消耗** —— 免罪(21)/嫁禍(19)/免費(20)/復仇(18) "
    "四个处理函数**内部各自 `remove_card`**（`0x444c11`/`0x4449ef`/`0x444b30`/`0x4446f0`，"
    "都是 `push 卡号 / push 持有者 / call 0x441343`），而 remake 四处**全是只读 `playerHasCard`** "
    "⇒ 同一张免罪卡可以**反复挡下每一次攻击**（受害者的卡永不出手牌） "
    "| 新增 `passive.applyDefensiveCards(target)`：命中时**同时**返回触发类型与**已扣卡**的持有者；"
    "`frame.ts` 的免罪/嫁祸两支改用它并把结果并回 `players`。顺带确认「免罪命中即止 ⇒ 嫁祸**不**被消耗」 "
    "| `frame.test.ts` 新增 3 例：免罪命中后被消耗（且不改原数组）、嫁祸命中后被消耗、"
    "**放弃转嫁时嫁祸照样被消耗**（原版在 `cmp eax,-1` **之前**就扣）；全套 4868 通过 | 02（§三#3） |"
)

ROW12 = (
    "| 12 | **簇 F：夢遊卡完全不查免罪/嫁祸，且復仇卡判定时机/天数/消耗都错** "
    "| 按原版 `0x004442f5 push 0x15` → `0x00444313 push 0x13` 接入 **21→19** 防御链"
    "（命中即消耗、免罪命中即止）；把復仇卡判定**移到防御卡与效果施加之后**并加"
    "「**最终目标 == 原始目标**（未被嫁祸改写）」条件（`0x004443ef cmp ebx,ebp`）；"
    "反弹天数改为**硬编码 5**（`0x0044441d`，不是「对自己 4 天」）；復仇卡命中后**消耗**"
    "（`0x4446f0`）；`scapegoatPicker` 从 registry 透传 "
    "| `sleepwalk.test.ts` 新增 7 例（防御链顺序、免罪/嫁祸消耗、被改写后不查復仇、放弃转嫁仍查復仇…）；"
    "**修正 3 条把错行为钉死的旧测试**：`registry.test.ts` 的「自己 4 天」应改为 5 且**目标照样中**、"
    "`sleepwalk.test.ts` 的「復仇后目标 0 天」应改为「两人都梦游」——因为原版 "
    "`0x004443e6 call 0x40b93b` **先**给最终目标施加主效果、**再**反弹给施卡者；全套 4868 通过 "
    "| 02（§三#4/5/6、#16/17/18） |"
)

NOTE = (
    "> ⚠️ **第 12 条的诚实边界**：夢遊卡还差两条未接 —— "
    "①**敌意增量 `150×price_index`**（`0x004442ea`，位置在防御卡判定**之前**、无论免疫与否都记）；"
    "②**「目标已在冬眠 `+0x36 != 0`」闸门**（`0x004442be`/`0x004442c5`，此时整个效果不施加、"
    "不记敌意、不查防御卡，但**卡已消耗**）。陷害卡一侧同样还差**復仇卡(18) 分支**"
    "（`0x00444652 cmp ebx,edi` → `0x00444678 0x43d593(current,5)`）。这三项已记入差距报告，本轮未做。\n"
)

s = s.replace(ANCHOR, "\n" + ROW11 + "\n" + ROW12 + "\n\n" + NOTE + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
