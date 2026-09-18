#!/usr/bin/env python3
"""修复「写了但读错/没读」的三个玩家字段（第 36 条，由快照历史数据暴露）。

1. `misfortune`/`fortune`/`luck`（+0x44/0x46/0x48）**从来不导入**（硬编码 0），
   而写侧一直在写 ⇒ 带神明附身的三项修正读档即丢失。
2. `savedTrafficMethod: p.f67` 读的是 **+0x43** —— 全 exe 无读无写的死字节；
   真值在 **+0x66**（`@source 0x4441dc` 夢遊卡写 `[+0x66] = [+0x11]`）。
3. `savedNdices: p.f68` 读的是 **+0x44**（= misfortune！）；真值在 **+0x67**。
   顺带：这两项**写侧从来没写** ⇒ 梦游中被存档再读回，`wakeFromSleepwalk`
   会把 trafficMethod/ndices 还原成 undefined。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── 1. savegame.ts：修正导入映射 ────────────────────────────────────
P1 = ROOT / "packages/core/src/loaders/savegame.ts"
E1 = [(
    "导入映射",
    """    savedTrafficMethod: p.f67,
    savedNdices: p.f68,
    misfortune: 0,
    fortune: 0,
    luck: 0,""",
    """    // ★★ 2026-09-17 订正（三个都是「写了但读错/没读」，由時光機快照的历史数据暴露）：
    //   · `+0x44/0x46/0x48` 是**神明附身的三项修正**（写侧一直对，读侧先前硬编码 0）——
    //     Save0 的 slot0 快照里玩家 0 是 `-100/60/60`，正是 `rules/objects.ts` 表里
    //     **天使** 的三项（`@source 0x40ead7` 附身时写、`0x40e14d` 送走时清）；
    //   · `savedTrafficMethod` 的真值在 **`+0x66`**、`savedNdices` 在 **`+0x67`**
    //     （`@source 0x4441dc` 夢遊卡：`mov dl,[+0x11] / mov [+0x66],dl`、
    //      `mov dl,[+0x12] / mov [+0x67],dl`）。
    //   ⚠️ 先前读的是 `f67`（`+0x43`，**全 exe 无读无写**）与 `f68`（`+0x44`，其实是
    //     misfortune）—— 两个样本这几格恰好全 0，所以逐字节往返测试**看不出来**。
    savedTrafficMethod: p.f102,
    savedNdices: p.f103,
    misfortune: p.f68,
    fortune: p.f70,
    luck: p.f72,""",
    1,
)]
src = P1.read_text(encoding="utf-8")
for name, old, new, want in E1:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [savegame.ts/{name}] 期望 {want} 实际 {got}")
    src = src.replace(old, new, want)
    print(f"✓ savegame.ts / {name}")
P1.write_text(src, encoding="utf-8")

# ── 2. save-writer.ts：补写 +0x66/+0x67，并订正文档表 ────────────────
P2 = ROOT / "packages/core/src/loaders/save-writer.ts"
E2 = [
    (
        "写 +0x66/+0x67",
        """    u16(out, o + 0x44, p.misfortune); // f68（候选）
    u16(out, o + 0x46, p.fortune); // f70（候选）
    u16(out, o + 0x48, p.luck); // f72（候选）""",
        """    // ★ 神明附身的三项修正（u16，可为负 ⇒ 写出的是补码）
    //   @source 0x40ead7（附身写）/ 0x40e14d（送走清）；三项值与 `rules/objects.ts`
    //   的 `GOD_MODIFIERS` 表逐项相同（快照实测「天使 = -100/60/60」已对上）。
    u16(out, o + 0x44, p.misfortune); // f68
    u16(out, o + 0x46, p.fortune); // f70
    u16(out, o + 0x48, p.luck); // f72
    // ★ 夢遊卡的「睡前的移动方式 / 骰子数」备份 —— 不写就会在
    //   「梦游中被存档 → 读回 → 醒来」时把这两项还原成 undefined。
    //   @source 0x4441dc：`mov dl,[+0x11] / mov [+0x66],dl`、`mov dl,[+0x12] / mov [+0x67],dl`
    out[o + 0x66] = p.savedTrafficMethod & 0xff;
    out[o + 0x67] = p.savedNdices & 0xff;""",
        1,
    ),
    (
        "文档表（未写字节）",
        """ * | `+0x1b` | `f27` | 非 0（仅 Save0）| 状态里无对应字段（写它的函数：`0x40d5a5`/`0x43d593`/`0x43ec3f`）|
 * | `+0x4a` (u16) | `f74` | 非 0（仅 Save0）| 状态里无对应字段（写它的函数：`0x40d5a5`）|
 * | `+0x64` | `f100` | 非 0（两份都有）| 状态里无对应字段（写它的函数：`0x406de7`）|""",
        """ * | `+0x1b` | `f27` | 非 0（仅 Save0）| **一次移动内的瞬时量**（移动前的朝向备份），原子移动的引擎里没有对应字段 |
 * | `+0x4a` (u16) | `f74` | 非 0（仅 Save0）| 同上（本次移动的目标节点，唯一读者是行走函数 `0x40c05c`）|
 * | `+0x43` | `f67` | 恒 0 | **全 exe 无读无写的死字节**（`0x496bab` 的读写点都为空）|
 * | `+0x64` | `f100` | 非 0（两份都有）| 写者只有 `0x406de7`（新局），但 Save0 的奇数个数与 `[0x499104]` 矛盾 ⇒ **未决** |
 * | `+0x65` | `f101` | 恒 0 | 只有 `0x41c84f` 读、无写者 ⇒ **未决** |""",
        1,
    ),
    (
        "文档表（已确认映射）",
        """ * ★ 已由**往返测试确认**的候选映射（两份存档都逐字节对上，故不再是猜测）：
 *   `+0x17` ← `personality`、`+0x1a` ← `stockRatio`、
 *   `+0x44` ← `misfortune`、`+0x46` ← `fortune`、`+0x48` ← `luck`。""",
        """ * ★ 已由**往返测试确认**的候选映射（两份存档都逐字节对上，故不再是猜测）：
 *   `+0x17` ← `personality`、`+0x1a` ← `stockRatio`。
 *   ⚠️ **反面教材**：`+0x44`/`+0x46`/`+0x48` 先前也被列进这一句，但两份样本**这三格全是 0**
 *   —— 「都是 0 == 都是 0」的逐字节相等是**空的**。真正把它们定下来的是
 *   **時光機快照里的历史数据**（Save0 slot0 的玩家 0 = `-100/60/60` = 天使三项修正，
 *   与 `rules/objects.ts` 的表逐项吻合）。**"两份样本都对上"只在样本非平凡时才算证据。**""",
        1,
    ),
]
src2 = P2.read_text(encoding="utf-8")
for name, old, new, want in E2:
    got = src2.count(old)
    if got != want:
        raise SystemExit(f"✗ [save-writer.ts/{name}] 期望 {want} 实际 {got}")
    src2 = src2.replace(old, new, want)
    print(f"✓ save-writer.ts / {name}")
P2.write_text(src2, encoding="utf-8")

# ── 3. save.ts：给 +0x43 与 +0x66/+0x67 加注释 ───────────────────────
P3 = ROOT / "packages/core/src/loaders/save.ts"
E3 = [
    (
        "f67 注释",
        "  f67: number;",
        """  /**
   * `+0x43` —— ⚠️ **全 exe 无读无写的死字节**（`0x496bab` 的 `read_by`/`written_by` 都为空）。
   * 解析器留着它是为了逐字节往返；**不要**把它接到任何引擎字段上
   * （先前 `savedTrafficMethod: f67` 就是接错的，见 `savegame.ts` 的订正）。
   */
  f67: number;""",
        1,
    ),
    (
        "f102/f103 注释",
        """  f100: number;
  f101: number;
  f102: number;
  f103: number;""",
        """  f100: number;
  /** `+0x65` —— 只有 `0x41c84f` 读、**无写者** ⇒ 语义未决 */
  f101: number;
  /** ★ `+0x66` = **夢遊卡的「睡前移动方式」备份** @source `0x4441dc` `mov [+0x66],[+0x11]` */
  f102: number;
  /** ★ `+0x67` = **夢遊卡的「睡前骰子数」备份** @source `0x4441dc` `mov [+0x67],[+0x12]` */
  f103: number;""",
        1,
    ),
]
src3 = P3.read_text(encoding="utf-8")
for name, old, new, want in E3:
    got = src3.count(old)
    if got != want:
        raise SystemExit(f"✗ [save.ts/{name}] 期望 {want} 实际 {got}")
    src3 = src3.replace(old, new, want)
    print(f"✓ save.ts / {name}")
P3.write_text(src3, encoding="utf-8")
print("完成")
