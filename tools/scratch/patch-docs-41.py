#!/usr/bin/env python3
"""第 41 条收尾：① 加一条「42 块三分」结构断言；② 缺口清单 §7.23。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① 结构断言 ───────────────────────────────────────────────────────
P1 = ROOT / "packages/core/src/loaders/save-writer.test.ts"
BLOCK = r'''
/**
 * ★★ 42 块的三分**必须恰好铺满**（第 41 条）：
 *   完全建模 30 + 部分建模 4 + 走 carry 8 = 42。
 *
 * 这条断言的价值：任何「加了字段却忘了从 `MODELED_*` 里挪出来」「写了却没声明」
 * 的漂移都会在这里炸。第 41 条就是靠逐偏移对账发现 `0x2747`（地图块长度）
 * **写了却没声明**、以及 8 个「状态里有字段却没写」的块。
 */
describe('★ 42 块三分：完全建模 / 部分建模 / carry 恰好铺满', () => {
  it('三个集合互不相交，并集 = 42 块', () => {
    const all = ORIGINAL_SAVE_BLOCKS.map((b) => b.offset);
    const modeled = new Set(MODELED_BLOCK_OFFSETS);
    const partial = new Set(PARTIALLY_MODELED_BLOCK_OFFSETS);
    // 互不相交
    for (const o of modeled) expect(partial.has(o), `0x${o.toString(16)} 同时出现在两个表里`).toBe(false);
    // 声明的偏移都真实存在
    for (const o of [...modeled, ...partial]) {
      expect(all.includes(o), `0x${o.toString(16)} 不在 42 块表里`).toBe(true);
    }
    // 并集铺满
    const carried = all.filter((o) => !modeled.has(o) && !partial.has(o));
    expect(modeled.size + partial.size + carried.length).toBe(ORIGINAL_SAVE_BLOCKS.length);
    expect(modeled.size).toBe(30);
    expect(partial.size).toBe(4);
    expect(carried.length).toBe(8);
    expect(carried.map((o) => `0x${o.toString(16)}`)).toEqual([
      // 这 8 块的「为什么没写」见 `save-writer.ts` 末尾的表
      '0x1b0', '0x2526', '0x267a', '0x269a', '0x269e', '0x26a6', '0x26aa', '0x26ae',
    ]);
  });

  it('`carriedBlocks()` 与上面算出来的一致', () => {
    const offsets = carriedBlocks().map((b) => b.offset);
    expect(offsets).toEqual([0x01b0, 0x2526, 0x267a, 0x269a, 0x269e, 0x26a6, 0x26aa, 0x26ae]);
  });
});
'''
src = P1.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK
P1.write_text(src, encoding="utf-8")
print("✓ 结构断言")

# ── ② 缺口清单 ───────────────────────────────────────────────────────
P2 = ROOT / "docs/gaps/README.md"
SECTION = '''### 7.23 ★ 第 41 条（本轮）：把状态块也做一次逐偏移对账 —— 8 个「状态里有字段却没写」的块并进完全建模

第 40 条给地图块做了「解析侧 vs 写出侧」对账，本轮把同一套做法搬到**状态块**：
新增 `tools/scratch/audit-state-block.py`，把 42 块表与 `writeStateBlock` 里的
**字面偏移**取差集，打印每块落在区间内的写入点。

#### (1) 一次对账就揪出 8 个可写却没写的块

| 块 | 全局 | 状态字段 | 样本是否非平凡 |
|---|---|---|---|
| `0x0008` | `0x4991b8` gameMap | `globalMapId % 4` | ✅ Save0 = 3 / SAVE1 = 3 |
| `0x000a` | `0x4991b6` gameStage | `floor(globalMapId / 4)` | ✅ 0 / 1 |
| `0x0690` | `0x49915c` toolAmount 4×15 | `state.tools[玩家*15 + 道具号]`（**1 基**） | ✅ 多人有道具 |
| `0x06ea` | `0x497320` 道具库存 8 | `state.toolStock[道具号]`（**1 基**） | ✅ `[9,1,10,10,9,9,5,1]` |
| `0x267e` | `0x499110` 土地權限档位 | `state.landTenureIndex` | ❌ 恒 0 |
| `0x2682` | `0x49911c` 勝利條件·天 | `state.winConditions.targetDays` | ❌ 恒 0 |
| `0x2686` | `0x499108` 勝利條件·資產 | `state.winConditions.targetWealth` | ❌ 恒 0 |
| `0x268a` | `0x49908c` 開局資金档 | `state.initialFund` | ✅ **300000** |

★ 其中 `0x0690`/`0x06ea` 是**老账**：文档里一直挂着「下标基与存档未对齐（0x69f 起错位）」。
实测两份存档**逐项吻合** —— `state.tools[p*15+id]` == 存档 `p*15+(id-1)`（id 1..13）、
每个玩家块的槽 13/14 **恒 0**、`state.toolStock[id]` == `0x06ea+(id-1)`。
⇒ 只是**差一个 `-1` 的基址**，加上即可，不需要新的状态字段。

#### (2) 顺带发现一处「写了却没声明」

`0x2747`（地图块长度）**一直在写**，却没进 `MODELED_BLOCK_OFFSETS` ——
于是「42 块三分」的对账怎么都对不上（47 ≠ 42）。已补声明。

#### (3) 新增一条结构断言，防止再漂

`save-writer.test.ts` 新增：**完全建模 30 + 部分建模 4 + 走 carry 8 = 42**，
三个集合互不相交、声明的偏移都真实存在、carry 的 8 个偏移**逐个列出**。
任何「加了字段忘了挪表」「写了却没声明」的漂移都会在这里炸。

#### 验证强度

- 8 个新块里 **5 个在两个样本上本身就非零**（tools/toolStock/gameMap/gameStage/initialFund）
  ⇒ 既有的「carry 清零后仍逐字节相等」强断言**已经把「真的从 `GameState` 写出」证死了**；
- 剩下 3 个（`landTenureIndex` 与两条勝利條件）样本恒 0，新增**构造字节**用例
  （先断言样本里确实是 0，再写 3/300/2000000 后读回）⇒ 可证伪；
- `gameMap/gameStage` 另有「`globalMapId == gameStage*4 + gameMap`」的往返断言。

#### 门禁

`pnpm test` **237 文件 / 4,956 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`。

#### 诚实边界

- 剩下 8 块仍走 carry，且**原因各不相同**（已逐块写进 `save-writer.ts` 的表）：
  `0x01b0` 两条推导路都不通；`0x2526` 布局未定名且样本全 0；
  `0x267a`/`0x269a`/`0x26a6` 未定名；`0x269e` 是派生量；
  `0x26aa`/`0x26ae`（剧情通关标志 / 12 角色槽状态）**状态里根本没有对应字段**。
- 本轮**不新增**状态字段 —— 那要先回 exe 查清那几格语义（另开一轮）。

'''
anchor2 = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
src2 = P2.read_text(encoding="utf-8")
assert src2.count(anchor2) == 1
src2 = src2.replace(anchor2, SECTION + anchor2, 1)
src2 = src2.replace("# 237 文件 / 4,952 测试", "# 237 文件 / 4,956 测试")
src2 = src2.replace("**237 文件 / 4,952 测试**", "**237 文件 / 4,956 测试**")
P2.write_text(src2, encoding="utf-8")
print("✓ 缺口清单 §7.23")
