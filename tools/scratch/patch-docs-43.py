#!/usr/bin/env python3
"""第 43 条文档：缺口清单 §7.25 + gods.md 的「计时字节」补一句 + tools.md 收录第二批审计脚本。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT.parent / "rich4-spec"

# ── ① 缺口清单 ───────────────────────────────────────────────────────
P = ROOT / "docs/gaps/README.md"
SECTION = '''### 7.25 ★ 第 43 条（本轮）：替身的**四个**计时字节只走了两个 ⇒ 冬眠/梦游的灰化状态永不消失

第 42 条那套审计继续铺开（本轮扫了 `SpecialActor` / `Listing` / `CommercialOwnership` /
`EventDeck` / `StockState` / `StockMarketState`），第二条命中：

> ⚠️ `SpecialActor.sleepwalkDays` 非写侧引用只有 `client/render.ts`；
> `SpecialActor.hibernating` 只有 `render.ts` 与写它的那张卡。

顺着查下去发现两件事，**一件是 bug、一件其实是对的**。

#### (1) bug：`tickNpcCounters` 只走了四个字节里的两个

@source `tick_blocking` 的 actor 分支 `0x0041ce39`：`sub ebx,4` → `eax = ebx*16`
→ **依次处理四个字节**，每个都是同一套「`test ...,0x80` → 清零；否则 `dec`，到 0 `or 0x80`」：

```asm
0041ce4a  test byte [eax + 0x498e34], 0x80 / je 0041ce86   ; ① +12 hibernating 冬眠
0041ce8b  test byte [eax + 0x498e35], 0x80 / je 0041ce9c   ; ② +13 sleepwalkDays 梦游
0041cea1  test byte [eax + 0x498e36], 0x80 / je 0041ceb2   ; ③ +14 halted 停留
0041ceb7  test byte [eax + 0x498e37], 0x80 / je 0041cec8   ; ④ +15 singleStep 龜行
0041cecd / 0041cef3 / 0041cf19 / …                         ; 四个各自 dec
```

那四个字节正是替身记录（基址 `0x498e28`、步长 16）的 `+12..+15`，
与**玩家**的 `+0x36..+0x39`（`rules/blocking.ts` 的 `tickTurnCounters`）逐位对应。
复刻的 `tickNpcCounters` 先前**只走 ③④**。

**后果（玩家可见）**：冬眠卡/夢遊卡打在替身上之后，`+12`/`+13` **永不递减** ⇒
`client/render.ts` 的 `isActorAsleep` **永远**把那个替身画成灰的（梦游那支同理）。
已改为四项一起走。

#### (2) 顺带确认：「冬眠/梦游对替身**不闸门**」是**忠实的**，别"顺手补上"

步数判定在 `0x0040de09`：

```asm
0040de09  cmp edx, 8 / jge …
0040de14  eax = edx << 4                       ; 16 字节记录
0040de1a  cmp byte [eax + 0x498df6], 0 / je …   ; ★ 读的是该记录的 +2（= 停留）
0040de34  cmp byte [eax + 0x498df7], 0 / je …   ; ★ +3（= 龜行）
0040de50  call rand / … % 9 + 2                 ; 其余 rand()%9+2
```

**只读停留与龜行那两格** —— 冬眠/梦游对替身在原版里是**纯视觉的**：替身照样走。
⇒ 复刻「不闸门」的现状是对的，本轮**没有**加闸门，并写了一条测试把这件事钉住
（同一种子下，正常/冬眠/梦游三种状态算出的步数**完全相同**）。

#### 验证

`rules/special-actors.test.ts` 从 33 例扩到 **38 例**，新增：
1. 四项一起递减；
2. 冬眠/梦游到 0 挂 `0x80`、再走一天清零（与玩家的四项同一套）；
3. **走满 6 天后灰化状态消失**（按 `render.ts` 的判据 `(hibernating ?? 0) !== 0` 逐天断言）；
4. `0` 不会被弄成 `0x80`；
5. ★ 冬眠/梦游中与正常状态的步数**相同**（钉住"不闸门是有意的"）。

实测把新增的两行删掉（退回旧行为），第 1–3 条立刻红。

#### 门禁

`pnpm test` **238 文件 / 4,968 测试**；`pnpm typecheck`；`pnpm lint --max-warnings=0`。

#### 诚实边界

- **①（`0x498e34`）的释放支还多三句**：`0x0041ce61 and byte [turnrec+0x498ea0],0xbf`、
  `0x0041ce75 call 0x40b8d8(替身, turnrec+1)`、`0x0041ce7e call 0x40b93b(替身)`。
  本轮**未查清其语义**（看起来是表现层刷新），只做了四个计数，如实留着。
- **被关押/住院的替身在本引擎里计数不走一天**（`npcStepOnce` 先过 `actorActive`），
  而原版 `tick_blocking` 的 actor 分支**没有**这道闸门 —— 未改，登记为已知差异。
  影响面很窄（关押中的替身计数停住），但确与原文不同。
- 本轮的断言都是**行为/计数**层面的；「画面上灰化有没有及时褪掉」仍属表现层，
  由客户端自行读 `hibernating`，core 只保证计数正确。

'''
anchor = "## 七、★ 续做指南（阶段 3 的当前状态与下一步）"
src = P.read_text(encoding="utf-8")
assert src.count(anchor) == 1
src = src.replace(anchor, SECTION + anchor, 1)
src = src.replace("# 238 文件 / 4,963 测试", "# 238 文件 / 4,968 测试")
src = src.replace("**238 文件 / 4,963 测试**", "**238 文件 / 4,968 测试**")
P.write_text(src, encoding="utf-8")
print("✓ 缺口清单 §7.25")

# ── ② gods.md 补一句（替身计时字节） ────────────────────────────────
P2 = SPEC / "docs/systems/gods.md"
s2 = P2.read_text(encoding="utf-8")
old2 = "3. **天使/土地公/惡魔的顯靈已解（見 §4.3）**"
ADD = """2b. **替身（四大惡人／機器娃娃）的四個計時字節**（2026-09-17 補，第 43 條）：
   `tick_blocking` 的 actor 分支（`@source 0x0041ce39`）對替身記錄
   `0x498e28 + slot*16` 的 **`+12..+15`** 各走一天 ——
   `+12` 冬眠 / `+13` 夢遊 / `+14` 停留 / `+15` 龜行，
   與玩家 `+0x36..+0x39` 的四項**逐位對應**，語義同為
   「`test 0x80` → 清零；否則 `dec`，到 0 `or 0x80`」。
   ★ **但步數判定（`0x0040de09`）只讀 `+14`/`+15`** ⇒
   冬眠／夢遊卡打在替身上是**純視覺**的（替身照走 `rand()%9+2`）；
   玩家的冬眠／夢遊才會擋住行動。復刻時**不要**替替身補上閘門。

"""
assert s2.count(old2) == 1
P2.write_text(s2.replace(old2, ADD + old2, 1), encoding="utf-8")
print("✓ gods.md 补 §2b")

# ── ③ tools.md 收录第二批审计脚本 ───────────────────────────────────
P3 = SPEC / "docs/systems/tools.md"
BLOCK = """
### 9.z F 类审计：某结构的每个字段「谁在读」

```bash
cd rich4-remake
python3 tools/scratch/audit-state-fields.py            # GameState/MapObject/FacilityInfo/LandInfo/BlockingDays
python3 tools/scratch/audit-more-fields.py             # SpecialActor/Listing/CommercialOwnership/EventDeck/Stock*
python3 tools/scratch/audit-state-block.py             # 42 块表 vs writeStateBlock 实际写出的偏移
```

库房清单 §四 的 **F 类（状态写了但没人读）** 是最隐蔽的一类缺陷 ——
读实现或跑测试都发现不了，只有**机械对照**才能筛出来。三套脚本各管一段：

- `audit-*-fields.py`：对某接口的每个字段统计「**非写侧**（声明/新建/装载/写档/工厂/协议）
  的引用文件」，一个都没有的就是嫌疑。**已抓到**：`Player.ypos`（→ §7.20 位置三元组）、
  `GameState.viewRotation`（→ §7.24 视角档位没进状态）、
  `SpecialActor.hibernating/sleepwalkDays`（→ §7.25 四个计时字节只走两个）。
- `audit-state-block.py`：把 42 块表与写出器里的**字面偏移**取差集，
  并打印每块落在区间内的写入点。**已抓到**：8 个「状态里有字段却没写」的块 + `0x2747` 写了没声明（→ §7.23）。
- 同一套思路也用在**地图块**上（`map-format.md` 的「写出侧覆盖一览」，→ §7.22）。

⚠️ 两个坑：① 路径可能是相对的，`Path(p).relative_to(ROOT)` 前要归一化；
② 助手调用里的字面偏移（`writePlayerBlock(out, state, 0x0010)`）要单独抓，
否则会把玩家块误报成"整块走 carry"。
"""
P3.write_text(P3.read_text(encoding="utf-8").rstrip("\n") + "\n" + BLOCK, encoding="utf-8")
print("✓ tools.md 收录审计脚本")
