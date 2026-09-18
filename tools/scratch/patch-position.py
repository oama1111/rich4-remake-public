#!/usr/bin/env python3
"""第 38 条：让 `xpos/ypos` 跟着 `nodeId` 走（新模块 rules/position.ts）。

根因：新局把 xpos/ypos 写 0，而引擎的移动只改 nodeId
⇒ **新局里冬眠卡的 `xpos == 0` 哨兵把所有在场玩家都当成不在场**（实测 affected = []）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① new-game.ts ────────────────────────────────────────────────────
P1 = ROOT / "packages/core/src/rules/new-game.ts"
E1 = [
    (
        "MapNode import",
        "import type { Rich4Map } from '../loaders/map.ts';",
        "import type { MapNode, Rich4Map } from '../loaders/map.ts';",
        1,
    ),
    (
        "position import",
        "import { traitsOf } from '../ai/personality.ts';",
        "import { traitsOf } from '../ai/personality.ts';\nimport { placeOnNodeId } from './position.ts';",
        1,
    ),
    (
        "签名加 nodes",
        """function makeInitialPlayer(
  index: number,
  setup: PlayerSetup,
  fund: number,
  startNode: number,
  vehicle: number,
): Player {
  const money = startingMoney(setup.character, fund);
  return {""",
        """function makeInitialPlayer(
  index: number,
  setup: PlayerSetup,
  fund: number,
  startNode: number,
  vehicle: number,
  nodes: readonly MapNode[],
): Player {
  const money = startingMoney(setup.character, fund);
  const base: Player = {""",
        1,
    ),
    (
        "返回处应用三元组",
        """    hostility: [0, 0, 0, 0],
    monthlyPaid: 0,
    monthlyReceived: 0,
  };
}""",
        """    hostility: [0, 0, 0, 0],
    monthlyPaid: 0,
    monthlyReceived: 0,
  };
  // ★★ 位置是**三元组**：`nodeId` / `xpos` / `ypos` 一起写（见 rules/position.ts）。
  //   原版开局就把玩家放在起始格上、`xpos/ypos` = 该格坐标；而冬眠卡
  //   （`@source 0x0044415d` `cmp word [player+0x08], 0`）等判据用 `xpos != 0`
  //   当「在不在盘上」的哨兵 —— 先前这里写 0，于是**新局里冬眠卡一个人也冻不住**。
  return placeOnNodeId(base, nodes, startNode);
}""",
        1,
    ),
    (
        "调用点加 nodes",
        "      makeInitialPlayer(i, s, initialFund, startNodeId > 0 ? startNodeId : (startNodes[i] ?? 1), vehicle),",
        "      makeInitialPlayer(\n        i,\n        s,\n        initialFund,\n        startNodeId > 0 ? startNodeId : (startNodes[i] ?? 1),\n        vehicle,\n        map.nodes,\n      ),",
        1,
    ),
]
src = P1.read_text(encoding="utf-8")
for name, old, new, want in E1:
    got = src.count(old)
    if got != want:
        raise SystemExit(f"✗ [new-game/{name}] 期望 {want} 实际 {got}")
    src = src.replace(old, new, want)
    print(f"✓ new-game.ts / {name}")
P1.write_text(src, encoding="utf-8")

# ── ② reduce.ts：主行走 + 乞丐挪位 ───────────────────────────────────
P2 = ROOT / "packages/core/src/state/reduce.ts"
E2 = [
    (
        "import",
        "import { useCard } from '../cards/registry.ts';",
        "import { useCard } from '../cards/registry.ts';\nimport { placeOnNode } from '../rules/position.ts';",
        1,
    ),
    (
        "主行走写三元组",
        """      const moved = withPlayer(state, state.currentPlayer, (p) => {
        p.lastNodeId = p.nodeId;
        p.nodeId = next;
        p.direction = facing;
      });""",
        """      const moved = withPlayer(state, state.currentPlayer, (p) => {
        p.lastNodeId = p.nodeId;
        p.nodeId = next;
        p.direction = facing;
        // ★★ `xpos/ypos` 必须跟着 `node_id` 走（见 rules/position.ts）：
        //   冬眠卡的「在不在盘上」判据读的就是 `xpos`（`@source 0x0044415d`）。
        //   原版这里写的是**本步的位移方向**（`@source 0x0040d639` 的 atan2），
        //   本引擎按节点移动，故直接取目标格坐标。
        if (to !== undefined) {
          p.xpos = to.x;
          p.ypos = to.y;
        }
      });""",
        1,
    ),
    (
        "乞丐挪位写三元组",
        """  const players = r.players.map((p, i) =>
    i === who && moved !== 0 ? { ...p, lastNodeId: p.nodeId, nodeId: moved } : p,
  );""",
        """  const players = r.players.map((p, i) => {
    if (i !== who || moved === 0) return p;
    // ★ 位置三元组一起走（`@source 0x0040cc56` 把乞丐挪到另一格）
    return placeOnNode({ ...p, lastNodeId: p.nodeId }, topo.nodes[moved - 1]);
  });""",
        1,
    ),
]
src2 = P2.read_text(encoding="utf-8")
for name, old, new, want in E2:
    got = src2.count(old)
    if got != want:
        raise SystemExit(f"✗ [reduce/{name}] 期望 {want} 实际 {got}")
    src2 = src2.replace(old, new, want)
    print(f"✓ reduce.ts / {name}")
P2.write_text(src2, encoding="utf-8")

# ── ③ teleport.ts：改用同一个助手（行为不变） ────────────────────────
P3 = ROOT / "packages/core/src/rules/teleport.ts"
src3 = P3.read_text(encoding="utf-8")
old3 = """    players: state.players.map((x, i) =>
      i === playerIndex
        ? {
            ...x,
            nodeId: targetNodeId,
            lastNodeId: facing.from,
            direction: facing.direction,
            xpos: node.x,
            ypos: node.y,
          }
        : x,
    ),"""
new3 = """    players: state.players.map((x, i) =>
      i === playerIndex
        ? placeOnNode({ ...x, lastNodeId: facing.from, direction: facing.direction }, node)
        : x,
    ),"""
if src3.count(old3) != 1:
    raise SystemExit(f"✗ [teleport] 期望 1 处，实际 {src3.count(old3)}")
src3 = src3.replace(old3, new3, 1)
old3i = "import type { MapNode } from '../loaders/map.ts';"
if src3.count(old3i) == 1:
    src3 = src3.replace(old3i, old3i + "\nimport { placeOnNode } from './position.ts';", 1)
else:
    # 没有该 import 时挂到第一行 import 之后
    lines = src3.split("\n")
    for k, ln in enumerate(lines):
        if ln.startswith("import "):
            lines.insert(k + 1, "import { placeOnNode } from './position.ts';")
            break
    src3 = "\n".join(lines)
P3.write_text(src3, encoding="utf-8")
print("✓ teleport.ts / 改用 placeOnNode")
