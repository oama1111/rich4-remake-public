#!/usr/bin/env python3
"""第 41 条：把 8 个「状态里有字段、写出器却没写」的块并进完全建模。

| 块 | 全局 | 状态字段 |
|---|---|---|
| 0x0008 | 0x4991b8 gameMap | `globalMapId % 4` |
| 0x000a | 0x4991b6 gameStage | `floor(globalMapId / 4)` |
| 0x0690 | 0x49915c toolAmount 4×15 | `state.tools[玩家*15 + 道具号]`（**1 基**）|
| 0x06ea | 0x497320 道具库存 8 | `state.toolStock[道具号]`（**1 基**）|
| 0x267e | 0x499110 土地權限档位 | `state.landTenureIndex` |
| 0x2682 | 0x49911c 勝利條件·天 | `state.winConditions.targetDays` |
| 0x2686 | 0x499108 勝利條件·資產 | `state.winConditions.targetWealth` |
| 0x268a | 0x49908c 開局資金档 | `state.initialFund` |

`0x0690`/`0x06ea` 的「下标基」先前只登记为「未对齐」；实测两份存档
**逐项吻合**（`state.tools[p*15+id]` == 存档 `p*15+(id-1)`；槽 13/14 恒 0；
`state.toolStock[id]` == `0x06ea+(id-1)`）。
"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "packages/core/src/loaders/save-writer.ts"

E = [
    (
        "MODELED 表补 8 项",
        """export const MODELED_BLOCK_OFFSETS: readonly number[] = [
  0x0004, // 游戏日期（day | month<<8 | year<<16）
  0x000c, // numPlayers""",
        """export const MODELED_BLOCK_OFFSETS: readonly number[] = [
  0x0004, // 游戏日期（day | month<<8 | year<<16）
  0x0008, // gameMap（= globalMapId % 4）
  0x000a, // gameStage（= floor(globalMapId / 4)）
  0x000c, // numPlayers""",
        1,
    ),
    (
        "MODELED 表补 tools/库存/档位/胜利条件",
        """  0x0654, // playerCards（4 × 15）
  0x06cc, // cardAmount（30）""",
        """  0x0654, // playerCards（4 × 15）
  0x0690, // toolAmount（4 × 15，槽序 = 道具号 − 1）
  0x06cc, // cardAmount（30）
  0x06ea, // 全局道具库存（8，下标 = 道具号 − 1）""",
        1,
    ),
    (
        "MODELED 表补标量",
        """  0x2676, // 当前玩家
  0x268e, // 物价指数 [0x4990e8]""",
        """  0x2676, // 当前玩家
  0x267e, // 土地權限档位 [0x499110]
  0x2682, // 勝利條件·天 [0x49911c]
  0x2686, // 勝利條件·資產 [0x499108]
  0x268a, // 開局資金档 [0x49908c]
  0x268e, // 物价指数 [0x4990e8]""",
        1,
    ),
    (
        "写出 gameMap/gameStage",
        """  u32(out, 0x0004, ((state.year << 16) | ((state.month & 0xff) << 8) | (state.day & 0xff)) >>> 0);""",
        """  u32(out, 0x0004, ((state.year << 16) | ((state.month & 0xff) << 8) | (state.day & 0xff)) >>> 0);
  // 地图档：`gameMap` / `gameStage` 是 `globalMapId` 的两位拆分
  //   @source `save.ts`：`globalMapId = gameStage * 4 + gameMap`
  u16(out, 0x0008, state.globalMapId % 4);
  u16(out, 0x000a, Math.floor(state.globalMapId / 4));""",
        1,
    ),
    (
        "写出 tools/toolStock",
        """  // ⚠️ `0x0690`（toolAmount 4×15）**暂不写**：`state.tools` 的下标基与存档的
  //   `player*15 + (道具号−1)` 尚未对齐（实测写出后 0x69f 起逐字节错位）⇒ 走 carry。""",
        """  // toolAmount（4 × 15）：存档槽序是 `player*15 + (道具号 − 1)`，
  //   而 `state.tools` 的下标是 `player*15 + 道具号`（**1 基**，槽 0 空置）
  //   @source `savegame.ts` 的 `tools[i*15 + id] = owned[id-1]`。
  //   实测两份存档逐项吻合（且每个玩家块的槽 13/14 恒 0）⇒ 加上 `-1` 即可。
  out.fill(0, 0x0690, 0x0690 + 60);
  for (const p of state.players) {
    for (let slot = 0; slot < 15; slot++) {
      u8(out, 0x0690 + p.index * 15 + slot, state.tools[p.index * 15 + slot + 1] ?? 0);
    }
  }""",
        1,
    ),
    (
        "写出 toolStock",
        """  // ⚠️ `0x06ea`（全局道具库存 8）**暂不写**：`state.toolStock` 的长度/基址与存档的
  //   8 项 `[道具号−1]` 尚未对齐（实测错位）⇒ 走 carry。""",
        """  // 全局道具库存（8）：存档下标 = **道具号 − 1**，`state.toolStock` 是 1 基
  //   @source `save.ts` 的 `toolStock: 0x06ea` 注释（`_rich4_remain_tool_amount`）。
  for (let k = 0; k < 8; k++) u8(out, 0x06ea + k, state.toolStock[k + 1] ?? 0);""",
        1,
    ),
    (
        "写出四个档位/条件标量",
        """  u32(out, 0x2676, state.currentPlayer); // [0x49910c]""",
        """  u32(out, 0x2676, state.currentPlayer); // [0x49910c]
  // 土地權限档位 @source [0x499110]（开局 `mov [0x499110], [0x46cb48]`，VA 0x00407373）
  //   買地时 `land.+0x30 = today + 年限表[本项]` ⇒ 它是**开局设定**，中途不变。
  u32(out, 0x267e, state.landTenureIndex);
  // 两条勝利條件 @source [0x49911c] / [0x499108]（开局写一次）
  u32(out, 0x2682, state.winConditions.targetDays);
  u32(out, 0x2686, state.winConditions.targetWealth);
  // 本局选中的開局資金档 @source [0x49908c] —— 它有**规则**作用
  //   （`update_price_index` 的除数 + AI 买地保留额基数），不只是"发多少钱"
  u32(out, 0x268a, state.initialFund);""",
        1,
    ),
]

src = P.read_text(encoding="utf-8")
for name, old, new, want in E:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [{name}] 期望 {want} 实际 {got}")
    src = src.replace(old, new, want)
    print(f"✓ {name}")
P.write_text(src, encoding="utf-8")
print("已写入")
