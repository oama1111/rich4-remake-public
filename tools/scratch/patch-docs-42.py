#!/usr/bin/env python3
"""第 42 条文档：缺口清单 §7.24 + 订正第 17 条的「诚实边界」+ 07 报告的 D-06 行。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── ① 缺口清单：§7.24 + 订正第 17 条 ─────────────────────────────────
P = ROOT / "docs/gaps/README.md"
SECTION = '''### 7.24 ★ 第 42 条（本轮）：地图视角档位接成**状态**（D-06 收口）；顺带订正一条**说错了的"诚实边界"**

第 33 条那套「按接口扫字段」的审计在本轮命中 `GameState.viewRotation`：
**非写侧引用：（无）** —— 于是顺着查，发现第 17 条留下的那条边界**写错了**。

#### (1) 订正：渲染与热键**早就有**，缺的是「存进状态 / 从状态还原」

第 17 条的「诚实边界」原文：

> ⚠️ **第 17 条的诚实边界**：本轮只接了**状态与存档**。**渲染层如何使用这个视角档位仍是空的**
> —— remake 的 `map.ts` 按「朝向 + 固定基」画，没有可变的视角变量，`<` / `>` 热键也还没接。

实测**不是这样**：

| 声称缺的 | 实际 |
|---|---|
| 「没有可变的视角变量」 | `render.ts` 的 `Camera` 早就有 `view` 字段，`projectCell(cam.view, …)`、`SUBTILE_MATRIX[cam.view % VIEW_COUNT]`、`assets.ts` 的 `buildingImageIndex(facing, viewRotation)` 全都按它算 —— **8 视角渲染是齐的** |
| 「`<` / `>` 热键还没接」 | `hotkeys.ts` 早有 `HOTKEY.rotateLeft/rotateRight`（原版 `RICH4.CFG` 的第 18/19 项），`main.ts` 的 `handleHotkey` 也早有 `case HOTKEY.rotateLeft: rotateView(-1)` |

**真正缺的**只有一环：`rotateView()` **只改自己的 `camera.view`，从不写回状态** ——
于是旋转过的视角既不会被存档带上、读档时也不会还原（原版 `[0x499088]` 是**进存档的全局**）。

#### (2) 修法：档位住在状态里，客户端只负责把按键翻成 action

| 位置 | 改动 |
|---|---|
| `core/src/rules/view.ts`（新） | `VIEW_ROTATION_COUNT = 8` 与 `rotateViewBy(current, delta)`（含取模、非法输入归 0）——把原版「`add`/`sub` 后取值方 `& 7`」显式化 |
| `state/actions.ts` | 新增 `{ type: 'rotateView'; delta: number }` |
| `state/reduce.ts` | `case 'rotateView'`：`viewRotation = rotateViewBy(...)`；**没变就不换对象**（沿用本仓 reducer 的引用稳定性约定）|
| `client/main.ts` | `rotateView()` 改成先 `dispatch({ type:'rotateView', delta })` 再把 `state.viewRotation` 同步给镜头；**四处镜头初始化**（开局/读档/重开）从 `camera?.view ?? 0` 改成取 `state.viewRotation` |

⇒ 现在 `viewRotation` 既有写者（reducer）也有读者（客户端渲染 + 存档写出），
审计里那行「非写侧引用：（无）」消失。

#### (3) 验证

`core/src/rules/view.test.ts` **5 例**：
1. 一个方向走 8 步回到原点（8 个起点 × 正负两向）；
2. 两向对称、负值不漏（`rotateViewBy(0,-1)=7`、`(0,-9)=7`、`(3,13)=0`）且结果恒在 `[0,8)`；
3. 非法输入（`NaN` / 小数）不抛、不漏 `NaN`；
4. reducer：`+1` 变对象且为 1、`delta=0` **返回原对象**、8 步回到 0、`-1` 得 7；
5. **存档往返**：转 5 步 → `carry` 清零写出，`+0x2743` 那个字节必须是 **5**；再把它塞进一份真存档副本走导入路径，读回 **5**。

#### 门禁

`pnpm test` **238 文件 / 4,963 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`。

#### 诚实边界

- **客户端那一环没有自动化测试**：本仓没有能启动 `main.ts`（7000+ 行、带副作用）的测试夹具，
  故「热键 → dispatch → 镜头同步」这条链只有 typecheck/lint + 审计（`viewRotation` 有了读者）作证。
  可被自动化验证的那一半（档位算术、reducer、存档字节）都在 core 里测了。
- 视角旋转**在联机下也会进状态**（原版 `[0x499088]` 本来就是共享的全局）；
  `dispatch` 在 `net !== null` 时会提交给服务器 —— 与其它 action 同一条路，未另做处理。
- 原版「侧栏小地图的箭头」也调同一支（`main.ts` 已经在用），本轮没有改变它的行为。

'''
anchor = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
src = P.read_text(encoding="utf-8")
assert src.count(anchor) == 1
src = src.replace(anchor, SECTION + anchor, 1)

# 订正第 17 条的诚实边界
old17 = """> ⚠️ **第 17 条的诚实边界**：本轮只接了**状态与存档**。**渲染层如何使用这个视角档位仍是空的** —— remake 的 `map.ts` 按「朝向 + 固定基」画，没有可变的视角变量，`<` / `>` 热键也还没接。那属于表现层（画质/动效方向），记在这里以免误以为整条功能已完成。"""
new17 = """> ⚠️ **第 17 条的诚实边界**：本轮只接了**状态与存档**。**渲染层如何使用这个视角档位仍是空的** —— remake 的 `map.ts` 按「朝向 + 固定基」画，没有可变的视角变量，`<` / `>` 热键也还没接。那属于表现层（画质/动效方向），记在这里以免误以为整条功能已完成。
>
> ★★ **2026-09-17 订正（第 42 条）：这段话里有两处说错了。** 实测渲染与热键**早就有** ——
> `Camera.view` + 8 视角投影 + `buildingImageIndex(facing, view)`，以及
> `HOTKEY.rotateLeft/rotateRight` 与 `handleHotkey` 的两条 `case`。
> **真正缺的**只有「写回状态 / 从状态还原」这一环。已接（见 **§7.24**）。
> 教训：**"某功能是空的"这种判断必须去看代码，不能从前一轮的结论里继承** ——
> 本条边界是从"我没在客户端搜到 `viewRotation`"推出来的，而客户端当时用的是自己的
> `camera.view`（**换个名字**），搜索自然搜不到。"""
assert src.count(old17) == 1
src = src.replace(old17, new17, 1)
src = src.replace("# 237 文件 / 4,958 测试", "# 238 文件 / 4,963 测试")
src = src.replace("**237 文件 / 4,958 测试**", "**238 文件 / 4,963 测试**")
P.write_text(src, encoding="utf-8")
print("✓ 缺口清单 §7.24 + 订正第 17 条")

# ── ② 07 报告的 D-06 行 ──────────────────────────────────────────────
P2 = ROOT / "docs/gaps/07-data-contracts.md"
s2 = P2.read_text(encoding="utf-8")
old2 = "| D-06 | 无 `GameState` 字段承载地图视角 | 全仓库 | 缺失 | 严重 | 原版 `0x499088` 是持久状态（存进档、`<`/`>` 可改）。remake 的渲染按「朝向 + 固定基」画（`map.ts:179-194` 的引文），没有可变的视角变量 ⇒ 旋转地图功能缺失 |"
new2 = "| D-06 | 无 `GameState` 字段承载地图视角 | 全仓库 | ~~缺失~~ **已接（§7.24）** | ~~严重~~ **关闭** | 原版 `0x499088` 是持久状态（存进档、`<`/`>` 可改）。★ 本行原先写「渲染按朝向 + 固定基画、没有可变的视角变量」——**说错了**：`Camera.view` + 8 视角投影 + `HOTKEY.rotateLeft/rotateRight` 一直都在，缺的只是「写回状态 / 从状态还原」。2026-09-17 已由 `rules/view.ts` + reducer action + 客户端 dispatch 接通 |"
assert s2.count(old2) == 1
P2.write_text(s2.replace(old2, new2, 1), encoding="utf-8")
print("✓ 07 报告 D-06 行订正")
