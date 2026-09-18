#!/usr/bin/env python3
"""规格更新（第 36 条）：
① save-format.md §五 第 6 条：订正「17 处 memcpy」为 16 处 + 12 个标量，并给出精确分解；
② save-format.md §三：新增玩家记录里六个「易错字节」的映射表（含 @source 与实测值）；
③ save-scalars.md §2.17(c)：把 `+0x64` 的未决与 `+0x66/+0x67` 的正解接上。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2].parent / "rich4-spec"
P1 = ROOT / "docs/systems/save-format.md"
P2 = ROOT / "docs/systems/save-scalars.md"

# ── ① 订正 memcpy 计数与分解 ─────────────────────────────────────────
old1 = """   ⇒ 17 处 memcpy 合计 **9,947 字节**；其余约 61 字节是标量直写与对齐填充。
   复现脚本：`tools/scratch/snapshot_regions.py`（两个方向分别打印，逐项可对）。"""
new1 = """   ⇒ **16 处 memcpy 合计 9,947 字节**（第 17 处 memcpy 是**地图副本**，见第 7 条，
   它的目的地是 `+0x2714` 里的指针，不在本槽内）；
   另有 **12 个标量 dword = 48 字节**（日期、行情游标、`+0x266c`–`+0x2688` 的 8 个、
   两个牌堆游标），加**有效标记 4 + 地图指针 4 + 对齐填充 5**，
   恰好 `9,947 + 48 + 4 + 4 + 5 = 10,008`。
   ★ **可写出的区恰好 28 个**（16 memcpy + 12 标量），且**每一个都是状态块的某个块**
   （同一全局变量、只换了偏移）—— 这条对应关系已写成 `save-writer.ts` 的
   `SNAPSHOT_REGIONS` 并由 `assertSnapshotRegionTable()` 断言不重叠、恰好铺满。
   复现脚本：`tools/scratch/snapshot_regions.py`（memcpy 两方向对照）
   + `tools/scratch/snapshot_scalars.py`（不经 memcpy 的标量直写）。"""
assert P1.read_text(encoding="utf-8").count(old1) == 1
P1.write_text(P1.read_text(encoding="utf-8").replace(old1, new1, 1), encoding="utf-8")
print("✓ save-format.md 第 6 条分解订正")

# ── ② §三 新增玩家记录易错字节映射表 ────────────────────────────────
NEW_SECTION = """
### 三之二 玩家记录里六个**易错字节**（第 36 条，全部有 @source + 实测）

写档器与解析器在这几个字节上曾经不一致，而**两个样本恰好都是 0**，
所以「逐字节往返相等」这条断言在这里是**空的**。历史快照（`時光機` 槽）
与构造字节测试才把它们逼出来。

| 块内偏移 | 名称 | 类型 | 谁写 / 谁读（`@source`） | 实测 |
|---|---|---|---|---|
| `+0x43` | `f67` | u8 | **全 exe 无读无写**（`0x496bab` 的读写点都为空） | 恒 0 |
| `+0x44` | `misfortune` 衰運 | **i16** | 写 `0x40ead7`（神明附身）/ 清 `0x40e14d`；读 `0x437d1a`。月度评分写的是 `(int16)player[0x44]`（`rich4.asm:16680`） | Save0 slot0 玩家0 = **−100** |
| `+0x46` | `fortune` 財運 | **i16** | 同上；另被 `0x420970`/`0x42107f`/`0x421827`/`0x421cb6`/`0x44b896` 读 | 同槽 = **60** |
| `+0x48` | `luck` 福運 | **i16** | 同上；另被 `0x44b896` 读 | 同槽 = **60** |
| `+0x4a` | `f74` | u16 | 写 `0x40d5a5`（移动）；读 `0x40c05c`（行走）—— **一次移动内的瞬时量** | Save0 玩家1 = 7 |
| `+0x66` | `savedTrafficMethod` | u8 | **只由夢遊卡写**：`@source 0x4441dc` `mov dl,[+0x11] / mov [+0x66],dl`；读 `0x41c84f` | 0 |
| `+0x67` | `savedNdices` | u8 | 同上：`mov dl,[+0x12] / mov [+0x67],dl`；读 `0x41c84f` | 0 |
| `+0x64` | `f100` | u8 | 写 `0x406de7`（新局）；读 `0x407ad2`/`0x418c55`/`0x41c84f` | Save0 = `0,1,0,0`（与 `[0x499104]`=2 矛盾 ⇒ **未决**）|

★ `+0x44/0x46/0x48` 三项与 `rules/objects.ts` 的 `GOD_MODIFIERS` **逐项吻合**：
Save0 slot0 玩家 0 的 `−100/60/60` 正是表里 **天使** 那一行 ——
这是「三项修正 = 神明附身修正」的**决定性**证据（两份存档的当前状态块里这三格都是 0）。

⚠️ **教训（已写进 `save-writer.ts` 的注释）**：把「两份样本都逐字节对上」
当作映射证据，只有**样本在该字段上非平凡**时才成立。这三格与 `+0x66/+0x67`
四个字段的「往返确认」都是空的 —— 修法是**构造字节**（`save-writer.test.ts` 里
带 `-100/60/60` 与 `2/3` 的那条用例），或去**历史快照**里找非零样本。

`@source` `VA 0x496bab`、`VA 0x496bac`、`VA 0x496bae`、`VA 0x496bb0`、
`VA 0x496bb2`、`VA 0x496bcc`、`VA 0x496bce`、`VA 0x496bcf`、`VA 0x40ead7`、
`VA 0x40e14d`、`VA 0x40d5a5`、`VA 0x40c05c`、`VA 0x4441dc`、`VA 0x406de7`、
`VA 0x437d1a`、`VA 0x420970`、`VA 0x42107f`、`VA 0x421827`、`VA 0x421cb6`、
`VA 0x44b896`、`VA 0x41c84f`。

"""
anchor = "## 四、未决（**不猜测**）"
src1 = P1.read_text(encoding="utf-8")
assert src1.count(anchor) == 1
P1.write_text(src1.replace(anchor, NEW_SECTION + anchor, 1), encoding="utf-8")
print("✓ save-format.md 新增 §三之二")

# ── ③ save-scalars §2.17(c)：接上正解 ───────────────────────────────
old3 = """⇒ **Save0 上两者不一致**（`[0x499104]`=2 而只有一个奇数）。只有 `0x4072f9`
一处绝对写者，扫描 `[reg+0x64]` 形式的写也未命中玩家记录，所以「谁在游戏中途改了它」
**未决**。⇒ 复刻**不写** `+0x64`（保持 carry），也不允许用 `+0x64` 反推 `[0x499104]`。"""
new3 = """⇒ **Save0 上两者不一致**（`[0x499104]`=2 而只有一个奇数）。只有 `0x4072f9`
一处绝对写者，扫描 `[reg+0x64]` 形式的写也未命中玩家记录，所以「谁在游戏中途改了它」
**未决**。⇒ 复刻**不写** `+0x64`（保持 carry），也不允许用 `+0x64` 反推 `[0x499104]`。

★ 顺带把**旁边两格**查清了（第 36 条，同一轮）：`+0x66`/`+0x67` 是
**夢遊卡的「睡前移动方式 / 骰子数」备份**（`@source 0x4441dc` 的两条
`mov dl,[+0x11] / mov [+0x66],dl`、`mov dl,[+0x12] / mov [+0x67],dl`，读侧 `0x41c84f`）。
复刻的 `savedTrafficMethod`/`savedNdices` 先前**读错了偏移**（读 `+0x43` 与 `+0x44`）且**写侧从来没写**，
已一并修好 —— 详见 `save-format.md` §三之二。"""
src2 = P2.read_text(encoding="utf-8")
assert src2.count(old3) == 1
P2.write_text(src2.replace(old3, new3, 1), encoding="utf-8")
print("✓ save-scalars.md §2.17(c) 接上正解")
