# -*- coding: utf-8 -*-
"""在 docs/gaps/README.md 末尾追加「续做指南」（可续工作的状态固化）。"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PATH = os.path.join(ROOT, "docs", "gaps", "README.md")

with io.open(PATH, encoding="utf-8") as f:
    s = f.read()

SECTION = """

## 七、★ 续做指南（阶段 3 的当前状态与下一步）

> 这一节的目的：**不必重读整个会话就能接着干**。数字都是实测的，命令都可直接跑。

### 7.1 各阶段状态

| 阶段 | 状态 | 证据 |
|---|---|---|
| **1 覆盖审计** | ✅ 完成 | `rich4-spec/docs/coverage-audit.md`；维度 A–K 全覆盖；规格 **27/27** 系统、**26,949 行**、9,071 个唯一 VA 引用；`lint_specs.py` **0 错误** |
| **2 差距清单** | ✅ 完成 | 本目录 7 份报告共 **2,855 行**，约 240 条差距 / 约 62 条阻断，归纳为 **6 个簇**（见 §四） |
| **3 按系统修复** | ⏳ **进行中** | 修复日志 §四之二 共 **22 条**，全部有 @source 依据 + 可证伪测试 |

### 7.2 门禁（每轮结束前必须全绿）

```bash
# rich4-spec 侧
cd rich4-spec
python3 tools/lint_specs.py            # 必须 0 错误
python3 tools/coverage.py              # 必须 27/27
bash run-all-checks.sh                 # 机械层可重建 + 4 个差分测试 59/59

# rich4-remake 侧
cd rich4-remake
pnpm test                              # 231 文件 / 4,887 测试
pnpm typecheck
pnpm lint                              # --max-warnings=0
```

**当前基线**：全部通过。

### 7.3 下一步的优先项（按"玩家可观察"排序）

| # | 事项 | 为什么优先 | 入手点 |
|---|---|---|---|
| 1 | **地图数据块写出** | 与状态块并列的**最后门槛**：没有它，remake 写出的存档原版读不了 | 规格 `map-format.md`（1,025 行，含 5 张表字段表）；方法同状态块：`parse → write → 逐字节比对` |
| 2 | **每玩家 10,008 字节快照 ×4** | 同上（時光機回滚块） | `OFFSET.mapData` 之后、`PLAYER_SNAPSHOT_SIZE = 0x2718` |
| 3 | **给 `GameState.Player` 补 `name` / `color`** | 收尾玩家块 + 那 472 字节 carry 的一部分 | 块内 `+0x00..0x02`、`+0x04`；实测值见 `save-writer.ts` 的「仍未写的字节」表 |
| 4 | **簇 C 剩余：AI 的 6 类 `aiRoll` 替身** | 影响确定性复现（联机地基） | `ai/policy.ts` 等处的 `aiRoll`；需先在 exe 里逐个确认调用次数 |
| 5 | **簇 F 剩余：夢遊卡的敌意 `150×pi` 与「已在冬眠」闸门** | 玩家可观察 | `@source 0x004442ea` / `0x004442be` |
| 6 | **查稅卡的嫁禍分支 + `tax2` 重算** | 玩家能算出"钱给错人" | `@source 0x0044534e`；照第 12 条对 `sleepwalk` 的做法给 `applyTaxCard` 加 `scapegoatPicker` |
| 7 | **`0x44f230` 其余 5 个调用点的条件性随机消耗** | 确定性复现 | 调用点：`0x40ee46`/`0x452753`/`0x42ea23`/`0x41b98b`/`0x41bafa` |

### 7.4 还没建的基础设施（不是代码问题，是验证能力问题）

- **通道 3 的原版预言机**：`tools/difftrace.py` 的比对逻辑已自检通过，但**原版侧**需要
  Wine + 调试器（或 Frida）跑真实 `rich4.exe` 并取状态指纹。**没有它，就无法做
  「remake 写 → 原版读」的终局验证**，也无法做全流程轨迹差分。
- **地图块/快照写出**（见 7.3 第 1、2 项）——有了它们才能开始上面那条终局验证。

### 7.5 几条踩出来的经验（省得重踩）

1. **旧测试会把 bug 钉死。** 本项目已撞上 **4 次**（大盘指数差 1、`pickNextNode` 不掷随机数、
   復仇卡 4 天、`mutateLand` mode 1 只清两项）。改实现前先看断言：它是**真值断言**
   还是**复述实现**？本目录日志里每条修复都注明了对应测试怎么改的。
2. **样本不可观测时，构造字节让断言可证伪。** 两份真实存档里 `flast`/`price_status`/`viewRotation`
   **全是 0**，SAVE1 甚至 `num_lands = 0`。凡是"结构上修对了但样本看不出"的，
   测试都写成**自己往字节里写非 0 值**再断言。
3. **别用百分比代替判断。** 例如 `objects_info` 只建模 5/24 字节，但那 5 个字节
   正是语义上全部有意义的字段；反过来 6,912 字节的 `history` 一眼看不出价值。
4. **一个公式对某个表成立，不代表对同符号的所有出现成立。** `#NNNN` 被这个坑害过
   （`1050+角色×27+事件` 只描述**角色台词表**，不是 `#NNNN` 的解析规则）。
5. **Python heredoc 别写中文**：本机 `python3` 从 stdin 读源码不按 UTF-8 解码，
   会直接 `SyntaxError: Non-UTF-8 code`。落成文件再跑（本目录 `tools/scratch/` 下的脚本都是这么做的）。
"""

s = s.rstrip() + SECTION
with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(s)
print("OK 已写入:", PATH)
