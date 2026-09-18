#!/usr/bin/env python3
"""rich4-remake/docs/gaps/README.md：新增 §7.17（第 35 条），并订正 §7.3 第 3 项。"""
from pathlib import Path

P = Path(__file__).resolve().parents[2] / "docs/gaps/README.md"

SECTION = '''### 7.17 ★ 第 35 条（本轮）：玩家块那五个「状态里没有」的字段，查清了三个 —— 两个**根本不该进状态**

续做指南第 3 项写的是「给 `GameState.Player` 补 `name` / `color` 两个字段」。
本轮把玩家块 `0x0010` 最后五个未写字节组逐个查完，结论是**那一项写反了方向**。

#### (1) `+0x00` / `+0x04` 不是状态，是**角色表 `0x47e80c` 的常量**

两条独立证据，都不是"看起来像"：

**证据 A（exe 行为）**：新局时原版**整条记录**从角色表拷来 ——
`@source 0x004072cf`–`0x004072e4`：
```asm
004072cf  mov  eax, [edi + 0x48a35c]   ; [0x48a35c + 玩家×12] = 角色选择记录
004072d5  and  eax, 0xff               ; 低字节 = 角色编号
004072dd  add  eax, 0x47e80c           ; &character_profiles[角色]
004072e4  call 0x456de8                ; memcpy(player, &profiles[ch], 0x68)
```
读档时 `+0x00` 又被**重新推导并覆盖**（`@source 0x00402b9f`–`0x00402bae`）——
即存档里存的是**存档那一刻的进程地址**，跨进程无意义。
`+0x04`（代表色）在全 exe 的绝对写者**为空**（只被四处读），来源同上那次 memcpy。

**证据 B（两份真实存档）**：Save0/SAVE1 × 4 名玩家 = **8/8 逐位吻合**角色表。

⇒ 修法：在 `@rich4/data` 的 `CharacterDef` 补 `namePointer`（12 个值，`binary-truth.test.ts`
逐项对 exe 校验，并额外用该指针解出名字串做交叉验证），写档器按 `character` 查表写
`+0x00`/`+0x04`。**`GameState.Player` 一个字段都不用加。**

新增守卫测试（可证伪）：`save-writer.test.ts`「carry 清零后玩家块 +0x00/+0x04 仍与原文件相等」。
若哪天有人把这两处退回 carry，或错写成 `SaveGame.PlayerState` 的值，这条会立刻红。

#### (2) `+0x1b` / `+0x4a` 是**一次移动内的瞬时量** ⇒ 复刻里没有对应字段（保持 carry）

- `+0x1b` = 移动前的朝向备份：`@source 0x0040d61b` 把 `+0x10`（朝向）存进 `+0x1b`，
  紧接着 `0x0040d643` 把 `+0x10` 改成朝目标的 `atan2`；瞬移支在 `0x0040d68e` 同写。
  被关押/住院路径写成 `0x0f`（`@source 0x0043d637` / `0x0043ece3`），读者只有 `0x00418f2e`。
- `+0x4a` = 本次移动的目标节点：唯一写者 `0x0040d6b3`，唯一读者是行走函数
  `0x0040c101`（`movsx edx, word [eax + 0x496bb2]`）。
- remake 的移动是**原子**的（没有"动画中途"这一状态），故这两者**没有对应的持久字段**；
  写档时保持 carry 是诚实做法，不是"没做完"。

#### (3) `+0x64` 未决，且**推翻了一个隐含假设**

`@source 0x004072ec` 的赋值式是 `((角色选择记录 >> 31) & 1) + 1`（**奇数 = 人类**），
`0x00407247 test al, 1` 正是用它数人类数。但实测：

| 存档 | `[0x499104]` | `+0x64` 各玩家 | 奇数个数 |
|---|---|---|---|
| Save0 | **2** | `0, 1, 0, 0` | **1** |
| SAVE1 | 1 | `1, 2, 2, 2` | 1 |

⇒ **Save0 上两者不一致**：要么游戏中途有人改过 `+0x64`（只有 `0x004072f9`
一处绝对写者；我又扫了 `[reg+0x64]` 形式的写，命中的 300+ 条全是 `call dword ptr`
虚调用，不是玩家记录），要么 `[0x499104]` 的设置路径不止新局那一次。**未决**。

⇒ 复刻**不写** `+0x64`；也**不允许**用 `+0x64` 去反推 `[0x499104]`
（`save-writer.ts` 里 `0x01b0` 退回 carry 的原因因此更充分了 —— 两条推导路都不通）。

#### 门禁

`pnpm test` **234 文件 / 4,921 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`；
rich4-spec 侧 `lint_specs.py` 0 错误。

#### 仍未做（诚实边界）

- `+0x64` 的真语义未定（见上）。它只影响「逐字节往返」里那 4 个字节/玩家。
- 玩家块仍是**部分建模**（`PARTIALLY_MODELED_BLOCK_OFFSETS` 里的 `0x0010`），
  因为 `+0x1b`/`+0x4a`/`+0x64` 取不到值 —— 前两者是瞬时量、后者未决，
  **不是"再找找就有了"**。
- 顺带确认的一条结构事实（已写进规格）：玩家记录 `0x68` 里凡是与角色表相同的字段
  都**不是状态**。以后遇到"玩家块写着值与原版不符"的字节，先查角色表再怀疑状态。

'''

src = P.read_text(encoding="utf-8")

anchor = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
assert src.count(anchor) == 1
src = src.replace(anchor, SECTION + anchor, 1)

old3 = "| 3 | **给 `GameState.Player` 补 `name` / `color`** | 收尾玩家块 + 那 472 字节 carry 的一部分 | 块内 `+0x00..0x02`、`+0x04`；实测值见 `save-writer.ts` 的「仍未写的字节」表 |"
new3 = ("| 3 | ~~给 `GameState.Player` 补 `name`/`color`~~ | **已结案：不需要加字段** —— "
        "`+0x00`/`+0x04` 是**角色表 `0x47e80c` 的常量**，按 `character` 查表写出即可（§7.17） | — |")
assert src.count(old3) == 1
src = src.replace(old3, new3, 1)

P.write_text(src, encoding="utf-8")
print("已写入", P)
