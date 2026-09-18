#!/usr/bin/env python3
"""第 38 条文档更新：
① client/big-map-screen.ts：订正「xpos 恒为 0」的过期前提；
② cards/hibernate.ts：注明 xpos 现在由 nodeId 派生；
③ docs/deviations/T-086.md：D-086-1 的前提已解除；
④ rich4-spec save-scalars.md §2.17 新增 (d)：位置三元组；
⑤ rich4-remake docs/gaps/README.md：新增 §7.20。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT.parent / "rich4-spec"

# ── ① big-map-screen.ts ──────────────────────────────────────────────
P1 = ROOT / "packages/client/src/big-map-screen.ts"
src = P1.read_text(encoding="utf-8")
old = """ * ⚠️ **与原版判据的差别**（已登记 `docs/deviations/T-086.md`）：
 *   原版判的是 `player + 0x08`（世界 x 坐标 —— 不在场上/破产清空后它是 0），
 *   而本引擎的 `xpos` 只在传送与开局写过，**恒为 0**，拿它当判据会一枚都画不出。
 *   故改用 `isAlive()`（`whoPlays & 3 != 0`）—— 结算上与原版等价：
 *   八张地图**没有任何节点的世界坐标是 0**（实测 min x = 179、min y = 192），
 *   所以原版那条 `!= 0` 对真正在场的玩家永不成立为「假」。"""
new = """ * ⚠️ **与原版判据的差别**（已登记 `docs/deviations/T-086.md`）：
 *   原版判的是 `player + 0x08`（世界 x 坐标 —— 不在场上/破产清空后它是 0）。
 *   本引擎先前 `xpos` 恒为 0，故改用 `isAlive()`（`whoPlays & 3 != 0`）。
 *   ★ **2026-09-17（第 38 条）起前提已解除**：`core/src/rules/position.ts` 让
 *   `xpos/ypos` 跟着 `nodeId` 走（开局/走一步/传送/乞丐挪位四处都写），
 *   现在 `xpos != 0` 与原版**逐字同义**；本屏继续用 `isAlive()` 是**等价判据**
 *   （八张地图**没有任何节点的世界坐标是 0**：实测 min x = 179、min y = 192），
 *   因此**不改动**，只订正这段过期的前提说明。"""
assert src.count(old) == 1
P1.write_text(src.replace(old, new, 1), encoding="utf-8")
print("✓ big-map-screen.ts 注释订正")

# ── ② hibernate.ts ───────────────────────────────────────────────────
P2 = ROOT / "packages/core/src/cards/hibernate.ts"
src2 = P2.read_text(encoding="utf-8")
old2 = """    // @source cmp word [player+0x08], 0 / je skip
    if (p.xpos === 0) return p;"""
new2 = """    // @source cmp word [player+0x08], 0 / je skip
    //   ★ `xpos` 是「在不在盘上」的哨兵：它由 `nodeId` 派生（`rules/position.ts`），
    //     不在盘上时三项一起为 0，且实测**没有任何节点的世界坐标是 0**
    //     （5 张可解析地图 610 个节点，min x = 179 / min y = 192）⇒ 该判据与原版同义。
    if (p.xpos === 0) return p;"""
assert src2.count(old2) == 1
P2.write_text(src2.replace(old2, new2, 1), encoding="utf-8")
print("✓ hibernate.ts 注释补充")

# ── ③ T-086.md ───────────────────────────────────────────────────────
P3 = ROOT / "docs/deviations/T-086.md"
src3 = P3.read_text(encoding="utf-8")
old3 = """**本引擎为什么不能照抄**：`Player.xpos/ypos`（`core/src/state/types.ts` 的
`+0x08/+0x0a`）只在**传送**（`rules/teleport.ts`）与开局写过，开局那一下还写的是
`0`；走路位置在渲染器里（`render.ts` 的走子补间），**没有回写进状态**。照抄判据
会一枚标记都画不出来。"""
new3 = old3 + """

> ★ **2026-09-17 更新（第 38 条）：上面这条前提已解除。**
> `core/src/rules/position.ts` 现在把 `xpos/ypos` 定义为 `nodeId` 的派生量，
> 并在**开局 / 走一步 / 传送 / 乞丐挪位**四处一起写（三项原子更新）；
> 真实存档实测 8/8 也确认「站在格子上 ⇒ `xpos/ypos` == 该节点坐标」。
> ⇒ 原版判据 `player + 0x08 != 0` 现在**可以照抄**。
> 本屏的处置**保持 `isAlive()` 不变**（与它等价，且已在用例里钉住「节点坐标无 0」），
> 但下面「本引擎为什么不能照抄」的理由作废；`core/src/cards/hibernate.ts` 的
> `xpos === 0` 判据则**真的照抄了**（那是冬眠卡的效果条件，必须逐字对齐）。"""
assert src3.count(old3) == 1
P3.write_text(src3.replace(old3, new3, 1), encoding="utf-8")
print("✓ T-086.md D-086-1 更新")

# ── ④ 规格 save-scalars.md §2.17 新增 (d) ───────────────────────────
P4 = SPEC / "docs/systems/save-scalars.md"
NEW = """
#### (d) 位置是**三元组**：`+0x0c` `node_id`、`+0x08` `xpos`、`+0x0a` `ypos`

**实测（两份真实存档 8/8）**：站在格子上的玩家，`xpos/ypos` **精确等于该节点的 `x/y`**；
`node_id == 0`（不在盘上）的则 `xpos/ypos = 0/0`。

| 存档 | 玩家 | xpos/ypos | node(nodeId).x/y |
|---|---|---|---|
| Save0 | 0 | 1935/1039 | node(60) = 1935/1039 |
| Save0 | 1 | 1215/1120 | node(87) = 1215/1120 |
| Save0 | 2 | 600/959 | node(116) = 600/959 |
| Save0 | 3 | 1674/1300 | node(53) = 1674/1300 |
| SAVE1 | 0 | 404/1080 | node(4) = 404/1080 |
| SAVE1 | 1..3 | 0/0 | `node_id = 0` |

原版三处写它：`0x004477e2`（傳送機，`node_id` 与 `x/y` 一起写）、
`0x0040d5a5`（挪位/瞬移）、`fcn_0040c332`（走路时按浮点累加**逐帧**改写 ——
所以走子途中它是插值中的实时坐标，站定时才等于节点坐标）。

★ **有一批判据直接拿 `xpos != 0` 当「在不在盘上」的哨兵**：
`@source 0x0044415d`（冬眠卡 `cmp word [player+0x08], 0 / je skip`）、
`@source 0x0040a8b0`（大地图画标记）。这条判据**成立的前提**是
**没有任何节点的世界坐标是 0** —— 实测 5 张可解析地图共 610 个节点，
`min x = 179`、`min y = 192`，无一为 0。
⇒ 复刻里 `xpos/ypos` **必须**跟着 `node_id` 走；否则这些判据会把在场玩家当成不在场
（`rich4-remake` 先前正是如此：新局写 `xpos = 0` 且移动只改 `node_id`，
导致**新局里冬眠卡一个人也冻不住**，见该仓 `docs/gaps/README.md` §7.20）。

`@source` `VA 0x004477e2`、`VA 0x0040d5a5`、`VA 0x0040c332`、`VA 0x0044415d`、
`VA 0x0040a8b0`、`VA 0x0040d288`。

---
"""
anchor4 = """### 2.17 玩家记录里三个「派生 / 瞬时」字段"""
assert P4.read_text(encoding="utf-8").count(anchor4) == 1
# 追加到 §2.17 末尾（下一个 "### 2.18" 或 "---\n\n## 三" 之前）
src4 = P4.read_text(encoding="utf-8")
marker = "\n---\n\n## 三、仍未定名的"
assert src4.count(marker) == 1
src4 = src4.replace(marker, NEW + "\n## 三、仍未定名的", 1)
P4.write_text(src4, encoding="utf-8")
print("✓ save-scalars.md §2.17(d)")

# ── ⑤ 缺口清单 §7.20 ────────────────────────────────────────────────
P5 = ROOT / "docs/gaps/README.md"
SECTION = '''### 7.20 ★ 第 38 条（本轮）：`xpos/ypos` 不跟着 `nodeId` 走 ⇒ **新局里冬眠卡一个人也冻不住**

#### 怎么发现的：把「谁在读每个玩家字段」机械过一遍

`tools/scratch/audit-player-fields.py` 对 `GameState.Player` 的 40 个字段逐个统计
「非写侧（装载/新建/写档/工厂）的引用文件」。40 个里**只有 `ypos` 一个没有任何读者**，
顺着它查下去就撞上了整条位置链 —— 这是**机械审计**，不是靠猜。

#### 根因：`nodeId` 与 `xpos/ypos` 脱钩

```ts
// new-game.ts（旧）：新局把坐标写 0，却给了 nodeId
xpos: 0, ypos: 0, nodeId: startNode, lastNodeId: startNode,
// reduce.ts 的主行走（旧）：只改 nodeId，坐标一个字都不动
p.lastNodeId = p.nodeId; p.nodeId = next; p.direction = facing;
```

而原版**有一批判据拿 `xpos != 0` 当「在不在盘上」的哨兵**：
`@source 0x0044415d`（冬眠卡）、`@source 0x0040a8b0`（大地图画标记）。
⇒ **实测**：新局四个人 `xpos` 全是 0，`applyHibernateCard` 的 `affected = []`
—— **冬眠卡（100 點券一张）在新局里完全无效**；只有读原版存档（xpos 非 0）时才"正常"。

**真值确认（两份真实存档 8/8）**：站在格子上的玩家，`xpos/ypos` **精确等于该节点的 `x/y`**；
`node_id == 0` 的则是 `0/0`：
```
Save0 玩家0: xpos/ypos=1935/1039  node(60).x/y=1935/1039
Save0 玩家1: xpos/ypos=1215/1120  node(87).x/y=1215/1120
SAVE1 玩家1..3: nodeId=0  ⇒ 0/0
```
并且**没有任何节点的世界坐标是 0**（5 张可解析地图 610 个节点，min x = 179 / min y = 192）
—— 这正是原版那条哨兵能成立的前提。

#### 修法：新增 `rules/position.ts`，把位置定义成 `nodeId` 的派生量

| 位置 | 改动 |
|---|---|
| `rules/position.ts`（新） | `placeOnNode` / `placeOnNodeId` / `isOnBoard`，并写明两条真值来源与哨兵前提 |
| `rules/new-game.ts` | 开局就按起始节点写三元组（`placeOnNodeId(base, nodes, startNode)`） |
| `state/reduce.ts` | 主行走写 `p.xpos/p.ypos = to.x/to.y`；乞丐挪位走 `placeOnNode` |
| `rules/teleport.ts` | 改用同一个助手（行为不变，原先就是对的） |
| `cards/hibernate.ts` | **判据照抄不动**（`xpos === 0`，与原版逐字同义），只补注释 |

⚠️ **没有**去改客户端：`client/big-map-screen.ts` 早就用 `isAlive()` + 节点坐标绕过了
同一个问题，与 `xpos != 0` 等价（地图无 0 坐标）⇒ 只订正了它那段**已过期**的前提说明，
并更新 `docs/deviations/T-086.md` 的 D-086-1（该偏离的理由已作废，处置保留）。

#### 验证（都可证伪）

`rules/position.test.ts` 8 例：
1. **真实存档**：两份各 4 名玩家的 `xpos/ypos == 节点 x/y`（`node_id == 0` ⇒ `0/0`）；
2. `placeOnNodeId`：0 / 负数 / 越界 ⇒ 三项一起清 0；合法节点 ⇒ 三项一起写；
3. **5 张地图 610 个节点的坐标全非 0**（哨兵前提，机械可复跑）；
4. **新局**：每个玩家的三元组自洽且 `xpos > 0`；**新局用冬眠卡 ⇒ `affected = [1,2,3]`**；
5. **走一步之后**：`rollDice` + `step` 三次，每个玩家的三元组仍自洽。

实测把 `newGame` 退回旧行为（`return base`）后，第 4、5 组共 3 条立刻红 ⇒ 断言真的在测这件事。

#### 门禁

`pnpm test` **236 文件 / 4,945 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`。

#### 诚实边界

- 原版走子途中的 `xpos/ypos` 是**插值中的实时坐标**（`fcn_0040c332` 逐帧浮点累加）；
  本引擎按节点移动，**只保证站定后相等**。模态弹窗/结算都只在等待输入时发生，
  稳态下两者一致；这一条与 `T-086` 的既有登记相同，未扩大。
- `lastNodeId` 未纳入三元组：原版它是「上一格」，本引擎已在各处维护，无需从坐标反推。

'''
src5 = P5.read_text(encoding="utf-8")
anchor5 = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
assert src5.count(anchor5) == 1
src5 = src5.replace(anchor5, SECTION + anchor5, 1)
src5 = src5.replace("# 234 文件 / 4,935 测试", "# 236 文件 / 4,945 测试")
src5 = src5.replace("`pnpm test` **234 文件 / 4,935 测试**", "`pnpm test` **236 文件 / 4,945 测试**")
P5.write_text(src5, encoding="utf-8")
print("✓ 缺口清单 §7.20")
