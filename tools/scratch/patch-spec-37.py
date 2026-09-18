#!/usr/bin/env python3
"""规格更新（第 37 条）：
① data-tables.md：事件表的 `blessing` 用法由 16 条补到 28 条（含共享尾机制）；
② gods.md §八：把「B/C 的消费者未逐条确认」那条未决**结案**（B/C 的三条用法 + 28 个事件）；
③ gods.md §八.5：把 `0x437d1a` 是否死码的未决写明「即使在原版也没人调用 ⇒ 复刻不接是对的」。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2].parent / "rich4-spec"
P1 = ROOT / "docs/systems/data-tables.md"
P2 = ROOT / "docs/systems/gods.md"

# ── ① data-tables.md：追加一节 ───────────────────────────────────────
NEW = """
### ★ 事件表的 `blessing` 字段：28 个事件带「神明加持」（2026-09-17 补，第 37 条）

`news.md` / `fortune.md` 的事件表在本仓的复刻里带一个 `blessing` 字段，取值
`reward` / `penalty` / `misfortune` —— 它对应 `_rich4_blessing_level`（`VA 0x44b896`）
的**三种用法**（三条独立的字符串与阈值链，见 `gods.md` §七）：

| 用法 | 压栈组合 `(arg0, arg1)` | 读哪个字段 | 高值 → | 低值 → | 提示语 |
|---|---|---|---|---|---|
| `reward` | `(0, 0)` | `player+0x46` 財運 | 2 加倍 | 1 作廢 | `%s保佑 獎金加倍！` / `%s作祟 獎金作廢！` |
| `penalty` | `(0, 1)` | `player+0x46` 財運 | 1 免付 | 2 加倍 | `%s保佑 免付罰金！` / `%s作祟 罰金加倍！` |
| `misfortune` | `(1, 1)` | `player+0x48` 福運 | 1 逃過 | 2 加倍 | `%s保佑 逃過此劫！` / `%s作祟 倒霉加倍！` |

★★ **怎么数出「哪些事件带加持」**：不能只看事件函数体里有没有 `call 0x44b896` ——
`0x0044d1e0`（事件 19）这类函数的函数体**一条 call 都没有**，它靠
`jne 0x44d172` 跳进**共享尾**；`0x44d3db`（事件 22）同形，跳 `jne 0x44d2a9`。

```asm
; penalty 尾 @source 0x0044d172 —— 17/18/19/23/24/26/30 都走这里
0044d172  push 1          ; arg1
0044d174  push 0          ; arg0      ⇒ (0,1)
0044d176  call 0x44b896
; reward 尾 @source 0x0044d2a9 —— 20/21/22/25/27/28/29/31 都走这里
0044d2a9  push 0
0044d2ab  push 0          ;           ⇒ (0,0)
0044d2ad  call 0x44b896
```

⇒ **共有 28 个命运事件带加持**（15 个直接调用 + 13 个经两条共享尾）。
`id 16`（汽車超速罰款3000元）是**原版就没接**的那一个（既无直接调用也不跳尾）。
复现脚本：`tools/scratch/blessing_callers.py`（打印每个调用点的压栈组合）。

⚠️ 复刻的事件表**先前只有 16 条**，且 `id 19` 记成 `reward`（实为 `penalty`）、
`id 22` 记成 `misfortune`（实为 `reward`）、`id 20/21/23..31` 共 12 条漏记 ——
即**12 个事件的金额完全不吃神明加持**，另 2 个读错字段（`+0x48` 与 `+0x46` 互换）。
现由「直接读 exe 调用点字节」的测试把 28 条钉住
（`rich4-remake/packages/data/src/event-table.test.ts`）。

`@source` `VA 0x44b896`、`VA 0x44d172`、`VA 0x44d176`、`VA 0x44d2a9`、`VA 0x44d2ad`。

---
"""
anchor = "## 六、"
src1 = P1.read_text(encoding="utf-8")
assert src1.count(anchor) >= 1, src1.count(anchor)
# 插到文件末尾（保持原有小节顺序不被打乱）
P1.write_text(src1.rstrip("\n") + "\n" + NEW, encoding="utf-8")
print("✓ data-tables.md 追加 §blessing")

# ── ② gods.md §八.2 结案 ────────────────────────────────────────────
old2 = """2. **神明修正 B（`+0x46`）、C（`+0x48`）的消費者未逐條確認**。
   B 被讀於 `0x41fb92, 0x41fc9b, 0x420c35, 0x4210e6, 0x421218, 0x42187a, 0x421e08,
   0x44b8c4, 0x44b94e`；C 被讀於 `0x44b9d6`。
   這些位址落在「租金/罰款/卡片的金額計算」區，**未逐一反編譯**，
   故 B/C 對金額的確切作用為未知。A 只用於 §七 的评分。"""
new2 = """2. ~~**神明修正 B（`+0x46`）、C（`+0x48`）的消費者未逐條確認**。~~
   **已於 2026-09-17 結案（第 37 條）** —— 全部讀點只有 **11 處**，分兩類：

   | 讀點 | 屬於 | 判據 |
   |---|---|---|
   | `0x41fb8f`、`0x41fc98`、`0x420c32`、`0x4210e3`、`0x421215`、`0x421877`、`0x421e05` | **AI 決策閘門** | 一律是 `cmp word [player+0x46], 0 / jl 跳過` ⇒ **財運為負就不做這個動作**；且都與 `現金+存款 > 10000` 串在一起 |
   | `0x44b8c1`、`0x44b94b`（讀 B）、`0x44b9d3`（讀 C） | **事件金額檔位** | 三條同構的閾值鏈（`>100` / `50..100` 擲 `rand&1` / `<0`），見本節 §7 與 `data-tables.md` 的 `blessing` 一節 |

   ⇒ B/C **不進任何金額公式**，只決定①AI 要不要動作、②事件金額的倍率檔位（0/1/2）。
   A（`+0x44`）仍只用於月度評分（且該評分函式在原版無人調用，見第 5 條）。"""
src2 = P2.read_text(encoding="utf-8")
assert src2.count(old2) == 1, src2.count(old2)
src2 = src2.replace(old2, new2, 1)

# ── ③ gods.md §八.5 补一句 ──────────────────────────────────────────
old3 = """5. **`0x437d1a` 是否為死碼**：全檔（含 `DGROUP`）找不到任何 4 位元組指標或相對呼叫指向它。
   `[未决]`：可能是被刪除的月結算功能殘留；但同一個「倒楣值」概念在結算畫面
   （`0x4386fd/0x43875d/0x4387bd`）確實被顯示，故其公式仍具參考價值。"""
new3 = old3 + """
   ★ **2026-09-17 補**：既然**原版自己也沒人調用它**，複刻裡 `monthlyScore()` 沒有生產
   調用點就是**忠實的**（不是「漏接」）。月結算畫面顯示的三項數值
   （本月意外損失／本月意外之財／本月倒楣天數）屬表現層，另計。
   注意 `+0x44`（A 表）**仍**是神明附身時加減的三項修正之一，
   只是它唯一的讀者是個死函式 ⇒ 目前**對玩法沒有影響**。"""
assert src2.count(old3) == 1, src2.count(old3)
src2 = src2.replace(old3, new3, 1)
P2.write_text(src2, encoding="utf-8")
print("✓ gods.md §八.2/.5 结案")
