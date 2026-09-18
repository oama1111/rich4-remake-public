# -*- coding: utf-8 -*-
"""把第 13/14 条修复写进 docs/gaps/README.md 的修复日志。

⚠️ 为什么单独写成文件：本机 python3 从 **stdin** 读源码时不按 UTF-8 解码，
含中文的 heredoc 会直接 `SyntaxError: Non-UTF-8 code starting with '\\xe8'`。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

ANCHOR = "\n> ⚠️ **第 12 条的诚实边界**"
assert ANCHOR in s, "锚点未命中"

ROW13 = (
    "| 13 | **簇 F：陷害卡缺復仇卡(18) 分支** —— 目标未被嫁祸改写且持復仇卡时，"
    "原版会把**施卡者也关 5 天**，remake 完全没有这一支 | 在 `frame.ts` 主效果 `confine` 之后补："
    "`!redirected && victimIndex === originalTarget` 且持有 18 ⇒ 先 `consumeCard(持有者,18)`，"
    "再 `confine(players, occ, 'prison', currentPlayer, REVENGE_DAYS)`。"
    "`REVENGE_DAYS` 从 `sleepwalk.ts` 挪到 `passive.ts`（它是被动卡的属性，两个调用方共用） "
    "| `frame.test.ts` 新增 3 例：反弹时**施卡者也进监狱 5 天**且占用表两边都置位、"
    "**被嫁祸改写后不查**復仇卡、无復仇卡则无反弹；全套 4875 通过 | 02（§三#6、#17） |"
)

ROW14 = (
    "| 14 | **簇 F：查稅卡的税金凭空消失** —— `tax.ts` 只做 `p.cash - tax`，"
    "施卡者一分拿不到；且 **免費卡(20) 命中后不被消耗** | 改用 `rules/payment.ts` 的 `transferMoney`"
    "（它已逐条镜像原版 `0x41d2c6`）：`0x004453a4` 是 `0x41d2c6(目标, 使用者, tax2, 0)`，"
    "旗标 0 ⇒ 目标**现金扣**（不够级联到存款）、施卡者**存款收**、且施卡者 `+0x60`(monthlyReceived) "
    "与目标 `+0x5c`(monthlyPaid) 都累加。免費卡命中则改为消耗（`0x444b30 push 0x14 / call 0x441343`） "
    "| `tax.test.ts` 新增 4 例：目标现金 −tax / 施卡者**存款** +tax / 施卡者本月收入 +tax / "
    "目标现金不足时级联到存款；免費卡免掉税金**且被扣掉**、敌意仍照记（`tax/100`）；全套 4875 通过 "
    "| 02（§三#3、#10、#26） |"
)

NOTE = (
    "> ⚠️ **第 14 条的诚实边界**：查稅卡还差**嫁禍卡(19) 分支与 `tax2` 重算** —— "
    "原版 `0x0044534e cmp [esp+0x94],0x7d0 / jle 跳过`（**税额 > 2000** 才查 19）、"
    "`0x00445360 call 0x44476a(target, 2, 0)`、`0x00445391` 按**最终目标**的现金重新算 `tax2`。"
    "remake 的 `applyTaxCard` 目前不接受 `scapegoatPicker`，需要连同 registry 一起改。\n"
)

s = s.replace(ANCHOR, "\n" + ROW13 + "\n" + ROW14 + "\n\n" + NOTE + ANCHOR, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)

print("OK 已写入:", PATH)
