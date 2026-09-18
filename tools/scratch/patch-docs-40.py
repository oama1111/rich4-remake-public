#!/usr/bin/env python3
"""第 40 条文档：① 缺口清单 §7.22；② map-format.md 补「写出侧覆盖」一节。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT.parent / "rich4-spec"

# ── ① 缺口清单 ───────────────────────────────────────────────────────
P2 = ROOT / "docs/gaps/README.md"
SECTION = '''### 7.22 ★ 第 40 条（本轮）：企業表的运行时四项一直是 carry ⇒ 写出的存档里「企業金庫 / 可售股數 / 股東排名」是旧的

接着上一条的线：上一轮把 `LandInfo.flast` 那条审计线索追成了「地图块写的是装载值」。
本轮把**整张地图块的解析侧 vs 写出侧逐偏移对了一遍**（机械 diff，见下），
又抓到一处同类漏写。

#### (1) 企業表的四项运行时字段没写

`writeMapBlock` 的企業段原先只写 `owner(+0x18)`，而这四格**全部靠 carry**：

| 偏移 | 字段 | 实时值在 `GameState` 的 | 什么时候会变 |
|---|---|---|---|
| `+0x1c..0x1f` | 持股排名（4 字节，值 = 玩家下标 + 1） | `commercialOwners[id].ranking` | 每次买/卖股（`_rich4_update_commercial_owner`） |
| `+0x28` | 累積盈餘（**有符号** dword） | `companyFunds[id]` | 玩家踩到企業格缴费；每月 15 日分红后清零 |
| `+0x2c` | 累計盈餘（**有符号** dword） | `companyProfit[id]` | 同上，但**从不**清零 |
| `+0x30` | 自留股数（= `10000 − 流通股数`） | `commercialShares[id]` | 从企業买股时企业自己扣减「可售股数」 |

⇒ 玩过几步之后写出的存档里，**企業金庫、可售股数、股东排名都还是装载时的旧值**；
原版读这份存档会看到错的公司财务。修法：`writeMapBlock` 补写这四项，
`withLiveMapState` 把 `commercialOwners[].ranking` / `companyFunds` /
`companyProfit` / `commercialShares` 一并合并。

⚠️ 两个字段是**有符号**的（`+0x28/+0x2c` 实测 Save0：1 号 profit = **−30000**、
3 号 funds = 48000）。写出时用 `u32` 写负数是**正确**的（`>>>` 先转 uint32，
与解析侧的 `getInt32` 对称），测试里用 `u32(...) | 0` 读回来断言。

#### (2) 顺手做了一次「解析侧 vs 写出侧」的机械对账

对 `land` / `facility` / `commercial` / `node` / `landscape` 五张表，
把 `map.ts` 里**解析用到的每个偏移**与 `map-writer.ts` 里**写出的每个偏移**取差集：

```text
land:       解析 11 / 写出 11   唯一没写：+0x04 name
facility:   解析 13 / 写出 12   唯一没写：+0x04 name
commercial: 解析 13 / 写出 13   唯一没写：+0x04 name
node:       解析  4 / 写出  6   唯一没写：+0x04 name
landscape:  解析  5 / 写出  4   唯一没写：+0x04 name
```

⇒ **除 `name` 之外已全覆盖**。`name` 是 Big5 字节，浏览器端没有 Big5 编码器
（`map-writer.ts` 开头已写明）⇒ 只能走 carry；这是**技术性缺口**不是漏做，
且对「读原版存档再写回」与「用 `map.mkf` 的解包 `.bin` 当 carry」两条路都无影响。

#### 验证

`loaders/map-state.test.ts` 扩到 **7 例**，新增两条：
1. 企業四项改成「排名 `[2,3,0,0]` / funds 48000 / profit −30000 / shares 1234」后写出，
   **逐项从文件读回断言**（含**负号**那一格），并断言地图模板里本来不是这些值（非平凡）；
2. 对照：不合并时 `withLiveMapState` 的纯函数性 + 模板未被改。
实测把 `writeMapBlock` 的新增四行删掉，第 1 条立刻红 ⇒ 断言真的在测这件事。

#### 门禁

`pnpm test` **237 文件 / 4,952 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`。

#### 诚实边界

- 机械对账只覆盖**解析器读到的偏移**；地图格式里若有解析器没读的字节
  （如 `objects_info` 每条那 19 字节），写出侧同样不写 —— 那些一律走 carry，
  与既有的「部分建模」登记一致。
- `name` 的 Big5 缺口仍在（见上）。

'''
anchor2 = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
src2 = P2.read_text(encoding="utf-8")
assert src2.count(anchor2) == 1
src2 = src2.replace(anchor2, SECTION + anchor2, 1)
src2 = src2.replace("# 237 文件 / 4,950 测试", "# 237 文件 / 4,952 测试")
src2 = src2.replace("**237 文件 / 4,950 测试**", "**237 文件 / 4,952 测试**")
P2.write_text(src2, encoding="utf-8")
print("✓ 缺口清单 §7.22")

# ── ② map-format.md 补写出侧一览 ─────────────────────────────────────
P1 = SPEC / "docs/systems/map-format.md"
src1 = P1.read_text(encoding="utf-8")
ADD = """
## ★ 写出侧覆盖一览（2026-09-17 机械对账，第 40 条）

复刻的 `map-writer.ts` 是否把解析侧读到的每个偏移都写回去了？逐表取差集：

| 表 | 解析到的偏移 | 写出的偏移 | 唯一没写 |
|---|---|---|---|
| 住宅地 | 11 | 11 | `+0x04` `name`（Big5）|
| 設施 | 13 | 12 | `+0x04` `name` |
| 企業 | 13 | 13 | `+0x04` `name` |
| 节点 | 4 | 6 | `+0x04` `name` |
| 景观 | 5 | 4 | `+0x04` `name` |

⇒ **除名字串之外已全覆盖**。名字是 Big5 字节，浏览器端没有 Big5 编码器
（见 `rich4-remake/packages/core/src/loaders/map-writer.ts` 开头），故只能由调用方
以 `carry` 提供原始字节 —— 对「读原版存档再写回」与「拿 `map.mkf` 的解包 `.bin`
当 carry」两条路都无影响，属**技术性缺口**而非漏做。

★ **企業表那四项是运行时字段，别当成静态数据**：
`+0x1c..0x1f` 持股排名、`+0x28` 累積盈餘（有符号，月分红清零）、
`+0x2c` 累計盈餘（有符号，不清零）、`+0x30` 自留股数（= `10000 − 流通股数`；
**静态地图文件里恒为 0**，只有存档/地图块里才是真值）。
写档前必须从 `GameState` 合并，否则写出的公司财务是装载时的旧值
（`rich4-remake` 的 `docs/gaps/README.md` §7.22）。

"""
# 插到文件末尾之前（保持末尾的 @source 说明可见）
P1.write_text(src1.rstrip("\n") + "\n" + ADD, encoding="utf-8")
print("✓ map-format.md 写出侧覆盖一览")
