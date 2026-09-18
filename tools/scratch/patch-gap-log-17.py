# -*- coding: utf-8 -*-
"""把第 17 条修复写进 docs/gaps/README.md 的修复日志。"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

ANCHOR = "\n> **第 16 条的教训**"
assert ANCHOR in s

ROW17 = (
    "| 17 | **簇 E：地图视角旋转 `[0x499088]` 没有字段**（D-06）—— 原版由 `<` / `>` 两个热键改变，"
    "是**持久状态**（存进存档 `+0x2743`），remake 全仓无对应字段，导入后视角恒为 0 "
    "| **只做「状态 + 存档」这一半**：① `save.ts` 新增 `OFFSET.viewRotation = 0x2743` 与 "
    "`SaveGame.viewRotation`（解析时 `& 7` 夹到 0..7，对应原版只用低 3 位）；"
    "② `GameState` 新增 `viewRotation`（含 @source 与「渲染层怎么用它属表现层」的边界说明）；"
    "③ `importOriginalSave` 读入、`newGame` 初始化 0；④ JSON 存档因整对象序列化自动带上它 "
    "| `savegame.test.ts` 新增 1 例：**把 `+0x2743` 改成 5** 再走完整导入路径断言为 5，"
    "并断言 `0xff` 被夹成 7；全套 4878 通过 | 07（§2.1 序号 41、§3 D-06） |"
)

NOTE = (
    "> ⚠️ **第 17 条的诚实边界**：本轮只接了**状态与存档**。"
    "**渲染层如何使用这个视角档位仍是空的** —— remake 的 `map.ts` 按「朝向 + 固定基」画，"
    "没有可变的视角变量，`<` / `>` 热键也还没接。那属于表现层（画质/动效方向），"
    "记在这里以免误以为整条功能已完成。\n"
    "> 另一个共同点：**两个样本的 `+0x2743` 也都是 0**（与第 15 条同型），"
    "所以这条同样只能靠构造字节做可证伪验证。\n"
)

s = s.replace(ANCHOR, "\n" + ROW17 + "\n\n" + NOTE + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
