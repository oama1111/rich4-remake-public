#!/usr/bin/env python3
"""第 39 条文档：① save-format.md §五 复刻要点加第 8 条（地图块=实时状态）；
② 缺口清单 §7.21 + 更新优先项 6c（快照地图副本已完成）。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT.parent / "rich4-spec"

# ── ① save-format.md §五 复刻要点 ────────────────────────────────────
P1 = SPEC / "docs/systems/save-format.md"
src = P1.read_text(encoding="utf-8")
anchor = """7. **`+0x2714` 之后紧跟每玩家的地图副本**"""
assert src.count(anchor) == 1
NEW7 = """8. **地图块里的地皮/設施/企業字段是「实时状态」，不是静态数据** ——
   这一点决定了读档与写档**各自**必须做什么，两边都容易漏：

   * **读档要导入**：`land.owner/level/type/priceStatus/flast(+0x30)`、
     `facility.owner/level/type/priceStatus/flast(+0x34)`、
     **`facility.researchProject(+0x1d)` / `researchDays(+0x1e)`**、企業 `owner(+0x18)`。
     ⚠️ 研发进度这两格极易漏（它们看着像"设施的静态属性"），漏了就会
     **读档时把正在研发的設施进度清零**（`rich4-remake` 正是如此，见其
     `docs/gaps/README.md` §7.21）。
   * **写档要先合并**：把 `GameState` 里的实时值覆盖回地图模板再交给写档器。
     否则写出的是**装载那一刻**的归属 —— 而"读进来再原样写回去"这条测试
     **恰好测不出来**（那一刻两者相同）。
   * 企業归属的实时值来自持股排名（`_rich4_update_commercial_owner`），
     不是持股本身的某个字段。

"""
P1.write_text(src.replace(anchor, NEW7 + anchor, 1), encoding="utf-8")
print("✓ save-format.md §五 第 8 条")

# ── ② 缺口清单 ───────────────────────────────────────────────────────
P2 = ROOT / "docs/gaps/README.md"
SECTION = '''### 7.21 ★ 第 39 条（本轮）：地图块的归属一直在写**装载时**的旧值；顺带揪出「研发进度读档清零」

上一轮那套「机械审计」换到 `GameState` / `MapObject` / `FacilityInfo` / `LandInfo`
上跑（`tools/scratch/audit-state-fields.py`），第一条命中是 `viewRotation`（已知的
D-06，客户端未接线），第二条命中 `LandInfo.flast` 只有客户端在读 —— 顺着它查出本轮两个真 bug。

#### (1) 写档：`writeMapBlock` 读的是静态地图模板，不是实时状态

原版把地皮/設施/企業的**归属、等级、种类、涨价档、地契到期日**都存在**地图块**里；
本引擎把实时值放在 `GameState` 的扁平数组（`landOwner` / `facilityLevel` / …），
`Rich4Map` 里那份只是装载初值。而 `writeMapBlock(map, …)` 直接读 `map.lands[i].owner`。

**为什么一直没被测出来**：两份真实存档「读进来再原样写回去」逐字节相等 ——
因为**那一刻 state 与 map 恰好一致**（实测 Save0 的 55 块地 / 8 处設施**零处不一致**）。
⇒ 必须**改动状态再写**才能暴露。实测：把 1 号地改成 2 号玩家所有再写档，
文件里那个字节**仍是 0**。

**修法**：新增 `loaders/map-state.ts` 的 `withLiveMapState(map, state)`，
`writeOriginalSaveFile` 先合并再交给 `writeMapBlock`。合并字段：

| 表 | 取 `GameState` 的 | 写回地图块 |
|---|---|---|
| 住宅地 | `landOwner/landLevel/landType/landPriceStatus/landTenure/landPrice` | `+0x19/+0x1a/+0x18/+0x17/+0x30/+0x1c` |
| 設施 | `facilityOwner/facilityLevel/facilityType/facilityPriceStatus/facilityTenure/facilityResearchProject/facilityResearchDays` | `+0x19/+0x1a/+0x18/+0x1c/+0x34/+0x1d/+0x1e` |
| 企業 | `commercialOwners[].owner` | `+0x18` |
| **不合并** | 节点表（坐标/邻接/装饰/`flags`）、景观、租率表 | 静态地图数据 |

#### (2) 读档：研發进度两格**从来没导入过** ⇒ 读档即清零

`withLiveMapState` 的「合并前后应逐字节相同」用例在 Save0 上差 **1 字节**
（設施表 `+0x1ead`）：地图块里 2 号設施 `researchProject = 1`，而导入后的
`state.facilityResearchProject[2] = 0`。查下去 —— `savegame.ts` 把两条数组
**一律填 0**（`facilityFieldFromMap(map, () => 0)`），从没读过地图块的 `+0x1d/+0x1e`。

⇒ **读一份"某設施正在研发中"的原版存档，那个研發进度会被清零**
（剩余天数与项目号都丢）。已改为从地图块读。

> ★ 两个 bug 是**互相咬合**的：正因为读档漏了这两格，写档时"合并"与"不合并"
> 才会在地圖块上产生差异 —— 而那个差异本身就是**发现漏读的探针**。
> 这类「写侧与读侧对同一组字段的覆盖不一致」值得每轮用**同一套字段表**互相校验。

#### 验证

`loaders/map-state.test.ts` 5 例：
1. 两份真实存档：state 与 map 的地皮/設施归属**零处不一致**（钉住"往返测不出坑"的前提）；
2. 改动 13 个字段（地块 6 + 設施 7 + 企業 1）后写出，**逐字段读回文件断言**；
3. **不合并时写出的是旧值**（对照，可证伪）＋ `withLiveMapState` 是纯函数；
4. 给 `snapshots` 时，**每玩家地图副本**由该快照状态合并写出（第 28 条遗留的
   「地图副本仍走 carry」**就此收口**）；没给快照的槽仍走 carry。

#### 门禁

`pnpm test` **237 文件 / 4,950 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`。

#### 诚实边界

- **快照的地图副本无法用真实存档验证**：它是"那一回合开始时"的地图，而文件里
  只有当前状态，重建不出来（第 27/28 条的结论不变）。本轮的断言只覆盖
  「用给定快照状态写出的副本符合该状态」。
- 节点表的 `flags`（运行时占用/封路）**有意不写回**：本引擎用 `objects` 与
  `state` 表示运行时占用（见 `ai/tool-policy.ts` 的说明），这是既有建模选择，
  不是本轮引入的差异；但它意味着**remake 写出的存档里节点占用位是装载值**，
  作为已知差异登记。

'''
anchor2 = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
src2 = P2.read_text(encoding="utf-8")
assert src2.count(anchor2) == 1
src2 = src2.replace(anchor2, SECTION + anchor2, 1)

old6c = src2[src2.index("| 6c |"):src2.index("\n", src2.index("| 6c |"))]
new6c = ("| 6c | ~~快照的每玩家地图副本~~ —— ✅ **已完成**（§7.21(4)：由该快照状态合并写出）；"
         "**剩读档导入快照** | ② 导入后 remake 的時光機在读原版存档后也能用（玩家可观察） | "
         "导入侧要同时解析「10008 槽 + 该玩家地图副本」并合成可回滚的 `GameState` |")
src2 = src2.replace(old6c, new6c, 1)
src2 = src2.replace("# 236 文件 / 4,945 测试", "# 237 文件 / 4,950 测试")
src2 = src2.replace("**236 文件 / 4,945 测试**", "**237 文件 / 4,950 测试**")
P2.write_text(src2, encoding="utf-8")
print("✓ 缺口清单 §7.21")
