# 差距清单 · 13 个道具与背包

> 生成方式：以 `rich4-spec/docs/systems/tools.md`（1644 行，权威）为基准，逐条核查 `rich4-remake` 实现。
> 原版侧证据一律给 `rich4.exe` 的 VA；凡本报告引用的 VA 都用
> `rich4-remake/tools/disasm.py va 0x…`（或 `callers`）回 exe 复核过，不是转抄规格。
> remake 侧证据给 `文件:行号`。
> **本轮只做分析，未改动任何代码**（唯一新建文件就是本报告）。
> `rich4-re/` 未被引用。

---

## 一、结论摘要

### 1.1 逐项计数

| 判定 | 数量 | 道具 |
|---|---|---|
| **1:1** | **2** | 9 機器工人、10 時光機 |
| **有差异** | **11** | 1 機器娃娃、2 路障、3 地雷、4 定時炸彈、5 機車、6 汽車、7 飛彈、8 遙控骰子、11 傳送機、12 工程車、13 核子飛彈 |
| **缺失** | **0** | ——（13 件的效果**全部**接上了；`tool-effects.ts:332` 的 `UNIMPLEMENTED_TOOLS` 确为**空数组**） |

### 1.2 最严重的 3 条

1. **使用 2/3/4/5/6 号道具会把全局商店库存加回去 —— 原版是「直接扣、不回池」。**
   remake 的放置类与交通工具分支走的是 `takeTool`（`reduce.ts:2743`、`reduce.ts:2758`），
   而 `takeTool` 对编号 ≤ 8 一律 `stock += 1`（`tools.ts:183-185`）。
   原版这 5 件的扣减是**就地 `dec` 玩家持有量**（2 路障 `@0x446c7e`、3 地雷 `@0x446d5f`、
   4 定時炸彈 `@0x446e40`、5 機車 `@0x446ef9`、6 汽車 `@0x446fb1`；12 工程車 `@0x447ac2` 同类），
   **不经过** `after_player_use_tool`；
   能回池的只有 1/7/8（>8 的 9/10/11/13 走 `after_player_use_tool` 但 `tool > 8` 不回池；
   12 编号 > 8，`takeTool` 也不回池 —— 所以 12 的消耗反而是对的）。
   后果：商店货架（只列 `remain_tool_amount > 0`，`shop.ts:272-276`）随每次用道具单向膨胀，
   玩家可观察。**类型「数值错」，严重度「严重」。**
2. **機器娃娃（1）扫掉的物件没有走 `release_object`。**
   原版在 `@0x41b529` 调 `0x40e14d`（`callers 0x40e14d` 已核）；remake 的
   `dollSweepNode`（`special-actors.ts:412-419`）直接把 `nodeId/state/attached` 清零，
   `runDoll`（`special-actors.ts:436-468`）与 `useToolAction`（`reduce.ts:2696-2705`）
   都不动 `toolStock`、不返回搭档 → **扫掉路障/地雷/炸彈不回库存**（原版 `@0x40e17f/0x40e18a/0x40e195`），
   **扫掉神明不触发搭档登场**（原版 `@0x40e275` 起，槽位 < 0x0c 才有搭档）。
   **类型「算法错」，严重度「严重」。**
3. **飛彈（7）/核子飛彈（13）不清地块的 `type`。**
   `fireMissile`（`reduce.ts:2275-2408`）只写 `landLevel` / `landOwner`，
   函数体内**根本没有 `landType`**（`grep landType` 只命中 `playCard` 那几处）；
   而 `blastLand`（`tool-effects.ts:287-309`）明明返回了 `type`，被丢掉。
   原版轻击「`type != 0` 时 `level = type = 0`」、重击「`owner = level = type = 0`」
   （`@0x40acdd` / `@0x40adaf` 分支，见 tools.md §6.5）。后果：連鎖店被炸后类型残留。
   **类型「算法错」，严重度「严重」。**

紧随其后的一条：**真人玩家在客户端里根本用不出 12 工程車**（`picking.ts:139-147` 没有 12，
而 `inventory.ts:198` 把 12 列进了 `TOOLS_NEEDING_TARGET` → 点它只打一行日志、什么都不发）。
这属于**已知偏离**（`docs/deviations/Q-TOOL-4.md` 残留项 7 已登记），但登记时
`picking.ts:137-138` 的注释仍写着「暂按和機器工人一样选一格」，**注释与实现不一致**。

### 1.3 顺带发现的**规格自身**需要回改的 3 处（本轮用 exe 复核过，remake 侧反而是对的）

| # | 规格原文 | 实测（exe） | 影响 |
|---|---|---|---|
| E1 | tools.md §6.2 末段「销毁类型 `0x10/0x11/0x12` 会**自动在地图远处随机补放一个同类对象**（槽号 ≥ 0x0c 时跳过）」 | `0x40e275 cmp edx,0xc / jge 0x40e29f` —— `0x40e29f` 就是 `pop esi / pop ebx / ret`。补放发生在**槽位 < 0x0c（神明）**那一支，放的是**搭档**（`ebx = objidx ± 1`），路障/地雷/炸彈（槽 16..45）**一律直接返回、不补放** | 规格这句自相矛盾（「槽号 ≥ 0x0c 时跳过」正好把三件道具全跳掉）。remake 的 `releaseObject`（`object-landing.ts:240-246`）行为与 exe 一致，**不要照规格去改** |
| E2 | tools.md §6.3.3「只转给**人类**玩家」（`0x41b7a2 cmp byte [eax+0x496b7d], 0 / je`） | 人类 = 1、电脑 = 2（`types.ts:31-36` 的 `WHO_PLAYS_*`，且 `@0x4079d0` 给 0 号玩家写 1），故该判据实为「**活着的玩家**」——电脑照样会接手炸弹 | remake 的 `passBomb`（`object-landing.ts:563-566`）用 `isAlive` 判定，与 exe 一致 |
| E3 | tools.md §6.1 `objects_info.+1` 记作「`fcn_00407a8c` 算出的**距离**（低字节）」 | `fcn_00407a8c` 是 `_rich4_calculate_direction`（Q-DOLL-1 已考），`0x408ee2` 把它当**图号/朝向**用；规格自己的 §8-⑦ 也承认用途未决 | 命名应为「朝向」，不是距离 |

另：tools.md §4.1 说機器娃娃「让实体 8 做一次**骰子移动**」不准确 ——
`@0x40dd1f` 的 actor ≥ 4 分支走到 `@0x40deb9 mov esi, 9`，是**固定 9 步、不掷骰**。
remake 取 9（`special-actors.ts:255` `DOLL_STEPS = 9`）是对的。

---

## 二、★ 道具逐项对照表

> 「原版效果」列的口径来自 tools.md §二/§四，「证据 @source」是本轮实际反汇编核过的关键点。
> `文件:行` 一律指 `rich4-remake/packages/…` 下的路径（省略 `packages/`）。

| 道具号 | 道具名 | 原版效果（证据 @source） | remake 实现（文件:行） | 是否 1:1 | 差异说明 |
|---|---|---|---|---|---|
| 1 | 機器娃娃 | 先 `after_player_use_tool(cur,1)`（**无条件消耗**，`@0x446b05`）→ 把玩家复制成实体 8（`@0x446b3d-0x446b8e`）→ `[0x49910c]=8` → `call 0x40dd1f`；actor 8 那支**固定 9 步**（`@0x40deb9 mov esi,9`），沿途每格 `call 0x40fafd`（打飞动画）+ `call 0x40e14d`（**release_object**，`@0x41b519/0x41b529`） | `rules/special-actors.ts:255`（9 步）、`:300-314` `spawnDoll`、`:436-468` `runDoll`、`:412-419` `dollSweepNode`；`state/reduce.ts:2684-2706`；`ai/tool-policy.ts:181-209`（AI 判定 `@0x420efa`） | **否** | ① 扫物件**不走 `releaseObject`** → 不回库存、不触发搭档登场（见 §一.2）。② 消耗改成「替身生成成功才扣」（`reduce.ts:2686`），原版是无条件先扣；`p.nodeId<=0` 时行为不同（极端）。③ 不选目标、AI 走 `plain`，与原版一致 |
| 2 | 路障 | `place_object(0x10, 目标格, 0, 0)` → `animate_object`（`@0x446c08/0x446c4e`）→ 直接 `dec` 持有量（`@0x446c7e dec [eax+0x49915d]`，**不回池**）；槽 0x10..0x1a 共 **10** 个（`@0x40e059`）；踩到 → `release_object` → `remain[1] += 1`（`@0x40e17f`、`@0x41bd17`）→ 台词 `#0247`，无住院无罚钱 | 放置：`rules/tool-effects.ts:145-149` `PLACEMENT_TOOLS`、`rules/object-landing.ts:143-162` `placeObjectOfType`、`rules/objects.ts:134-149` `slotRangeForType`；落点：`object-landing.ts:585-592`；扣减：`state/reduce.ts:2753-2759` | **否** | ① **消耗回池**：`reduce.ts:2758` 用 `takeTool` → `stock[2] += 1`（原版不回池）。② 槽满时原版**仍扣 1 个**（`@0x40e084 jge 0x40e13f` 后照样 `dec`），remake `reduce.ts:2757` 直接 `return state`（不扣）—— 属已登记的同类口径，见 `Q-TOOL-4.md` 残留 2，但**未针对放置类单独登记**。③ 掩码 `1`（`@0x446be4`）与 `picking.ts:140` 一致 |
| 3 | 地雷 | 同路障骨架，对象类型 **`0x11`**（`@0x446c06` 一带的 `push 0x11`）、掩码 `0x10001`、扣减下标 `+2`（`@0x446c88` 函数内 `dec [eax+0x49915e]`）；槽 0x1a..0x24 共 10；踩到 → `remove_object` → **车辆报废**（`@0x41be9f call 0x40cd07`）+ 爆炸 + **住院 3 天**（`@0x41b8e6 push 3`） | `tool-effects.ts:148`（17）、`object-landing.ts:642-654`（落点）、`:72` `HOSPITAL_DAYS_HURT=3`、`:426-444` `wreckVehicle`；掩码 `picking.ts:141` | **否** | ① 同路障的**消耗回池**问题。② 槽满不消耗（同上）。③ 落点效果、车辆回**库存**（原版 `[0x497324/0x497325]`，`@0x40cd3b/0x40cd43`）已核对一致 |
| 4 | 定時炸彈 | 对象类型 **`0x12`**、掩码 `0x20001`、扣减下标 `+3`；槽 0x24..0x2e 共 10；落地时 `+4=+5=0`（无主，`@0x446d69` 函数内 `push 0; push 0`）；**第一个踩到的人把它挂上身**（`@0x41c001 [player+0x40]=槽号+1`、`@0x41c01e +5=cur+1`、`@0x41c025 +4=0x26`）；每走一格 `dec +4`（`@0x41b6c4`），中途**转嫁给同格玩家**（`@0x41b78b`）；归零 → `remove_object` + 拆房（`@0x41b71f call 0x40ab4a`）+ 报废 + `[0x48baf8]=0` + **住院 5 天**（`@0x41b775 push 5`） | `tool-effects.ts:149`（18）；`object-landing.ts:66` `BOMB_FUSE=0x26`、`:74` `HOSPITAL_DAYS_BOMB=5`、`:504-545` `tickCarriedBomb`、`:548-572` `passBomb`、`:656-673` 捡起；掩码 `picking.ts:142` | **否** | ① 同路障的**消耗回池**问题。② 槽满不消耗。③ 引信 38 / 转移 / 爆炸 / 住院天数 / 拆房均已接，逐条对过 exe。④ 「本格不再显示该物件」用 `attached != 0` 反查实现（`reduce.ts:1742`）替代原版清 `node+0x26` 字节 —— 等价实现，可接受 |
| 5 | 機車 | 已是機車 → 返回 0 **不消耗**（`@0x446e5a`）；原本是汽車则**退一台汽車回背包**（`@0x446e7f inc [eax+0x499161]` → 道具 **6**）；`traffic=1`、`ndices=2`（`@0x446e8c/0x446e93`）；直接 `dec [eax+0x499160]`（道具 5）**不回池**（`@0x446ef9`） | `rules/tool-effects.ts:38-42` `VEHICLE_DICE`、`:58-62` `VEHICLE_TOOLS`、`:65-68` `TRAFFIC_REFUND`、`:96-127` `useVehicleTool`；`state/reduce.ts:2740-2750` | **否** | ① **退回背包的编号已按修正后的语义实现**：`TRAFFIC_REFUND.get(2)=6`＝**汽車**（`tool-effects.ts:67`），与本轮实读的 `0x499161 = 0x49915c+5 → 道具 6` 一致 ✓。② 消耗走 `takeTool`（`reduce.ts:2743`）→ **错误回池 `stock[5]+=1`**。③ 工程車（`0x1f`）不退回，`TRAFFIC_REFUND` 无该键 ✓ 与原版只判 `== 2` 一致。④ 骰子数 2 ✓ |
| 6 | 汽車 | 镜像：已是汽車 → 返回 0 不消耗（`@0x446f15`）；原本是機車则退 **道具 5 機車**（`@0x446f37 inc [eax+0x499160]`）；`traffic=2`、`ndices=3`（`@0x446f44/0x446f4b`）；直接 `dec [eax+0x499161]`（道具 6）不回池（`@0x446fb1`） | 同上（`VEHICLE_DICE` 的 `[2,3]`、`TRAFFIC_REFUND.get(1)=5`） | **否** | ① 退回编号 ✓（本轮实读）。② 消耗**错误回池 `stock[6]+=1`**。③ 其余一致 |
| 7 | 飛彈 | 人类掩码 `0x300c0`（`@0x446ffb`）；先 `after_player_use_tool(cur,7)`（**回池**，`@0x447024`）；`mkf 0x210`；`damage_area(0x64, 0x26, 0, cur)`（`@0x447078`）；对带 `0x40` 旗标的玩家 `hostility += 90*物价`（`@0x4470c4` 的 `90p` 移位串）+ **住院 3 天**（`@0x4470dc push 3`）；轻击「`level--`；`type != 0` 时 `level=type=0`」、敌意 `30*物价` | `rules/tool-effects.ts:250-259`（半径/旗标/敌意）、`:287-309` `blastLand`；`state/reduce.ts:2732-2737`、`:2275-2408` `fireMissile`；掩码 `picking.ts:143` | **否** | ① **地块 `type` 没有写回**（`reduce.ts:2308-2313` 只写 `landLevel/landOwner`，`fireMissile` 体内无 `landType`）→ 連鎖店炸不平。② 施放者被显式排除（`reduce.ts:2368 if (i===currentPlayer && !heavy) continue`），原版玩家循环（`@0x4470a1` 起）**只按 `flags & 0x40`**、不做这种排除 → 多余实现（但原版几何范围本身未决，见 §五）。③ 消耗回池 ✓（7 ≤ 8）。④ 設施那一路（`flags & 4`）已补 ✓ |
| 8 | 遙控骰子 | 写 `[0x475dd8]`（`@0x447275`），掷骰前 `fcn_00447285` 读出并清零（`@0x447287/0x44728e`），`fcn_00419572` 见非 0 则 `ndices` 强改 1（`@0x4195ae`）；UI 六颗骰面 → 取值 **1..6**，工具函数与掷骰处**都不做范围检查**（C 级）；取消（返回 0）不消耗 | `tool-effects.ts:197-203`（`REMOTE_DICE_MIN=1` / `REMOTE_DICE_MAX=18` / `isValidRemoteDice`）；`reduce.ts:2709-2713`；`reduce.ts:922-943`（`forcedDice` 用完即消）；`rng/watcom.ts:108-125`；`client/dice-choose.ts:95-96,153-156` | **否** | ① 效果与「用完即消」✓。② **core 的上界被放大到 18**（原版无检查、可观察输入上限是 6）；真人 UI 仍只给 1..6（`dice-choose.ts:96 DICE_FACE_MAX=6`），故仅 AI / 内部路径可达 → 轻微。见 §四 |
| 9 | 機器工人 | `0x40b110(实例)`：住宅 `type==0 && level<5` → `level++`；連鎖店 `type==1 && level==0` → 1；設施 `level==0` → 定种类后 1，否则 `level < 表[0x474940+type]` 才 ++；到顶返回 `0x81` → 播 `mkf 0x20b`（`@0x40b138`-`@0x40b169`、`@0x44736d`） | `rules/tool-effects.ts:230-234` `buildOneLevel`；`state/reduce.ts:2715-2730`、`:4301-4351` `freeBuildFacility`；`client/build-fx.ts`（影片） | **是** | 规则逐条对上：「不花钱、不看归属、住宅上限 5、連鎖店只 0→1」。已登记偏离：**消耗时机**（`Q-TOOL-4.md` 残留 2：原版「选到就扣」，本引擎「生效才扣」）、**拾取命中是半径 24 圆的近似**（同残留 3）、`0x41d476` 强制镜头未接（`Q-TOOL-6` ⑤-2）。均不影响数值 |
| 10 | 時光機 | `restore_last_state`（`@0x448544`）→ 失败则**不消耗**（`@0x4473b9 test eax,eax / je`）→ 成功才 `after_player_use_tool(cur,10)`（`@0x447407`，>8 不回池）；快照写入点 `@0x40c97c` / `@0x40dd53` / `@0x4477c3`；`@0x4480a0 test byte [player+0x15],1` 只给真人存 | `rules/time-machine.ts:57-96`；`state/reduce.ts:2673-2681`、`:894`（回合开始存快照） | **是** | ① 快照时机 = 回合开始，与主调用点 `@0x40c97c`（回合流程函数 `0x40c912` 的开头，`callers` 为 `0x418c55/0x418e7f`）一致 ✓。② 失败不消耗 ✓、PRNG 不还原 ✓。③ remake 多守一条「快照本身不回滚」（`time-machine.ts:91-93`）—— 原版无此概念（快照区不在自己的清单里），属防死循环的自定规则，不可观察。④ 覆盖面上「整份 GameState」与原版「含地图原始缓冲」在**地产/設施**上一致（见 §三-24） |
| 11 | 傳送機 | 掩码 `0x1200036`（地/設施/实体），第三次选择 `0x2090001`；`v==0` 或三个子分支都失败 → `esi==0` → **不消耗**（`@0x4479b3`）；地產↔地產：搬 `+0x19/+0x1a/+0x18`，**搬 `+0x30`、清源 `+0x30` 并额外清源 `+0x2c`**（`@0x447528`-`@0x447553`）；設施↔設施：搬 `+0x19/+0x1a/+0x18/+0x34`，只清源 `+0x30`（`@0x4475d8`-`@0x44760f`）；实体那一路挑朝向 | `state/reduce.ts:2666-2671`、`:2627-2647` `teleportWith`；`rules/teleport.ts:135-150`（地產）、`:167-186`（設施）、`:194-221`（人）；掩码 `picking.ts:146` | **否** | ① **地產分支漏清源头的「上次過路費」**：原版 `@0x447553 mov dword [eax+0x2c], 0`，remake 的 `teleportLand` 没动 `state.landLastToll[from]`（`teleport.ts:135-150`）——而对設施分支**有**清（`teleport.ts:184`），两边不对称。② `+0x30` 地契：地產的对应物是 `flast`，地图文件里恒 0，可忽略；設施的到期日 `facilityTenure` 已搬 ✓。③ 第二次选择无类型校验、UI 位定义未破解 → 见 §五 |
| 12 | 工程車 | **不选目标**（函数内没有 `push …; call 0x446ae8`）；`traffic & 3 == 3` → 返回 0 不消耗（`@0x4479e2`）；原本機車 → 退**道具 5**（`@0x447a0e`）、原本汽車 → 退**道具 6**（`@0x447a34`）；备份原 `traffic → +0x64`、`ndices → +0x65`（`@0x447a49/0x447a55`）；`traffic=0x1f`、`ndices=1`；直接 `dec` 道具 12（`@0x447ac2`），不回池 | `tool-effects.ts:55`（`TRAFFIC_ENGINEERING=0x1f`）、`:119-124`（ndices `?? 1`）、`:65-68`（退款）、`useVehicleTool:96-127`；`state/reduce.ts:2740-2750` | **否** | ① 数值与退款**全部对**（含「已是工程車不消耗」「只判 1/2 两种旧车」）。② **真人用不出来**：`client/inventory.ts:198` 把 12 列入需目标，而 `client/picking.ts:139-147` 没有 12 → `main.ts:3933-3936` 查不到参数，只打一行日志（已登记 `Q-TOOL-4.md` 残留 7）。AI 走 `plain`（`ai/tool-policy.ts:495-498`）不受影响。③ `+0x64/+0x65` 备份未实现（回滚点未追到，C 级）→ §五 |
| 13 | 核子飛彈 | 同飛彈，掩码 `0x400c0`、`mkf 0x212`、`after_player_use_tool(cur,13)`；破坏调用 **`damage_area(-1, 0x26, 1, -1)`**（`@0x447b88`，−1 = 全图、mode 1 = 清空归属），敌意 `level*30*物价`，`owner/level/type` 与 `+0x30` 全清（tools.md §6.5）；玩家循环同飛彈 | `tool-effects.ts:251` `NUKE_RADIUS=-1`、`:287-309`；`state/reduce.ts:2275-2408`（`heavy` 分支） | **否** | ① **地块 `type` 未写回**（同 7 号，`reduce.ts:2308-2313`）。② 設施的 `type/level/owner/租期` 全清 ✓（`reduce.ts:2328-2340`），敌意按 `level*30*物价` ✓。③ 核彈打全图时**不**排除施放者（`reduce.ts:2368` 的 `!heavy` 条件）✓ 与原版一致 |

---

## 三、机制层差距（携带上限 / 购买价格 / 使用时机 / 目标合法性 / 与其他系统交互）

| # | 条目 | 原版规格（证据） | remake 现状（证据） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 1 | 每人每种持有上限 = **9** | `@0x445a64 cmp byte [..], 9 / jae 放弃`（tools.md §3.3） | `rules/tools.ts:38` `MAX_TOOL_COUNT=9`；`giveTool:109-111` 先判上限再扣库存（顺序也对） | —— | —— | ✅ 一致 |
| 2 | 同类道具**叠加**、不同类各占一槽 | 存的是「数量」：`amount(player,tool)=byte[0x49915c+15p+(tool-1)]`，`+0x445a87 inc` | `tools.ts:28` 每玩家 15 槽、`:118` `+1`、`toolCount:123-125`、`toolsOf:133-140` | —— | —— | ✅ 一致（槽 0 与 14 不用，与原版 15 字节布局同构） |
| 3 | **使用后是否消耗 / 是否回池** | 只有 1/7/8（编号 ≤ 8，走 `after_player_use_tool`）回池；9/10/11/13 走 `after_player_use_tool` 但 `tool>8` **不回池**；**2/3/4/5/6/12 是直接 `dec`、完全不经过回池**。回池点：`@0x445ad3 inc [ecx+0x49731f]`；直接扣点（六处本轮全部实读）：`@0x446c7e dec [eax+0x49915d]`（2）、`@0x446d5f dec [eax+0x49915e]`（3）、`@0x446e40 dec [eax+0x49915f]`（4）、`@0x446ef9 dec [eax+0x499160]`（5）、`@0x446fb1 dec [eax+0x499161]`（6）、`@0x447ac2 dec [eax+0x499167]`（12） | `reduce.ts:2743`（交通工具）、`:2758`（放置类）都用 `takeTool`；`takeTool` 在 `tools.ts:183-185` 对 `toolId ≤ 8` 无条件 `stock += 1` | **数值错** | **严重** | 给「直接扣」的道具加一条只减持有量、不动库存的路径（例如 `takeToolNoRefund` 或在 `useToolAction` 里显式 `dec`），并把这条口径写成表（哪几件走 `after_player_use_tool`、哪几件直接扣），照 exe 的 9 个调用点钉住 |
| 4 | 放置类**槽位用尽**时仍消耗 | `@0x40e084 jge 0x40e13f`（不写槽、返回 `ebx+1`）→ 调用方照样 `dec` 持有量并播动画 | `reduce.ts:2757` `if (!r.ok) return state;` → **不消耗** | **时序错**（口径差异） | 轻微 | 已登记的同类口径见 `Q-TOOL-4.md` 残留 2（那是機器工人），本条是放置类；若要 1:1，应在 `placeObject` 失败时仍 `dec` 并返回「已消耗」 |
| 5 | 背包槽位数 | `amount` 步长 15、13 件道具用 1..13 | `tools.ts:28`/`emptyTools:128-130` | —— | —— | ✅ 一致 |
| 6 | 开局白送 | `@0x407281/0x40728c/0x407297/0x4072a2/0x4072ad/0x4072b8` 各一次 `give_tool`：**1、2、3、4、8、9** | `tools.ts:67` `STARTING_TOOLS=[1,2,3,4,8,9]`（已在 known-deviations「開局道具少发了两件」修正） | —— | —— | ✅ 一致 |
| 7 | 商店**可购买列表** = 1..8 号里库存 > 0 的**全部**，不随机 | `@0x42ec1a cmp eax,8 / jge`、`@0x42ec2a cmp byte [eax+0x497320],0`（tools.md §3.5、confirmed `0x42ec0b..0x42ecbb`） | `places/shop.ts:272-276` `toolShelf` 循环 1..8 且 `stock>0` | —— | —— | ✅ 一致（9..13 不上架，只能靠研究所，`facility.ts:124-126` `researchTool = project + 8`，`@0x41ce1b add eax,8`） |
| 8 | 商店**价格表**不随回合/地图变化 | 上架价直接读表项 `+5`：`@0x42ec78 mov al,[ebx*8+0x47fee7]`；`buy_tool` 也是原始价 `@0x42d290`。**不乘物价指数** | `places/shop.ts:50-52` `toolPrice` 直读 `@rich4/data` 静态表（`data/src/tools.ts:73-87` 与 tools.md §1.2 的 13 项**逐字段一致**）；`reduce.ts` 上架时也用同一函数 | —— | —— | ✅ 一致（物价指数只在公佈欄市價、租金等处使用） |
| 9 | 商店**AI 采购**顺序 | `@0x42f255` 循环 6 项，优先级表 `0x4755f0 = 07 01 06 00 03 02` → 道具 **8 遙控骰子 / 2 路障 / 7 飛彈 / 1 機器娃娃 / 4 定時炸彈 / 3 地雷**；每步判 `f7−個性 != 2`、`price <= 预算`、`stock > 0`、自己 < 9。预算初值 = `[0x47ff0f]`（= 道具 6 的价 150，`@0x42f226`） | `ai/policy.ts:456-478`：**只买 6 汽車、其次 5 機車**，两者都买不了就关门。既不看 `f7−個性`，也不看那张优先级表 | **算法错** | **严重** | 照 `0x4755f0` 的 6 项表 + `0x42f220`-`0x42f307` 的四个闸门重写 `decidePending` 的 shop 分支（AI 会去买車是移植版行为，原版 AI 从不买 5/6） |
| 10 | 商店买入的**点数检查** | 人类路径 `@0x42e47a` 只检查「自己已有 < 9」，**无余额检查**；`@0x42d25c sub word [player+0x30], bx` 是无符号回绕（是否可达未决，§8-⑪） | `places/shop.ts:135` `if (player.points < price) return fail('notEnoughPoints')`（`buyCard:89` 同） | **多余实现** | 轻微 | 保留（防负数刷点）；在 `known-deviations` 明写「规格 §8-⑪ 未决，本引擎主动加闸」即可 |
| 11 | 卖出折价 = **九成** | `fcn_0042d1b2`：`points += trunc(price*count*0.9)`，`stock += count`（`tool ≤ 8`） | `places/shop.ts:36-42` `resellValue`、`:190-229` `sellTool`（**先乘后取整** ✓、库存回补走 `takeTool` ✓） | —— | —— | ✅ 一致（`takeTool` 在这里用对了：卖出确实该回池） |
| 12 | 「變賣所有卡片道具」/破产清算 = **原价** | `@0x445b3f` `_rich4_player_sell_all_tools`：座驾先折回道具 5/6/12（`@0x445b66/0x445b81/0x445b89`），再逐件 `得 += price`、`≤8 回库存`、清零 | `rules/inventory.ts:61-65` `VEHICLE_TOOL`、`:82-116` `sellAllTools`、`:119-126` `toolPrice` | —— | —— | ✅ 一致（含「座驾先折回、于是那台车也会被卖掉」这条顺序） |
| 13 | **使用时机**（何时允许用道具） | 入口 `@0x447d97` 只判 `[player+0x15]==1`（人类）否则跳 AI 分支 `@0x447f82`；**没有阶段/剩余步数判据** | core 的 `useToolAction`（`reduce.ts:2649-2659`）只要求「是当前玩家、活着、持有该道具」，**无阶段闸门**；`case 'useTool'`（`reduce.ts:1313`）同样无闸门 | **无法判定** | 轻微 | 原版「走子途中能不能点道具」未取证（原版走子是阻塞循环）。若要收紧，应在客户端按 `phase` 挡，别写进 core |
| 14 | **目标合法性 / 掩码** | 路障 `1`、地雷 `0x10001`、炸彈 `0x20001`、飛彈 `0x300c0`、核彈 `0x400c0`、機器工人 `0x2090006`、傳送機 `0x2090001`（各工具函数 `push …; call 0x446ae8`） | `client/picking.ts:139-147` 掩码逐一对应；类别位解释在 `picking.ts:149-190`；命中近似（半径 24 圆 vs 原版 440×440 像素实例表）已登记 `Q-TOOL-4.md` 残留 3 | **接口不符**（表现层近似） | 轻微 | 掩码本身正确；命中精度属表现层取舍 |
| 15 | 与**研究所研發**的交互 | 完工发 `道具 = 項目 + 8`（`@0x41ce18 add eax,8`、`@0x41ce25 receive_tool`）；每项 5 回合；项目 ≤ 等级 | `rules/facility.ts:115-118` `startResearch`、`:124-126` `researchTool`、`:146-160` `tickResearch` | —— | —— | ✅ 一致 |
| 16 | 与**道具格（禮物）**的交互 | 類型 13：`@0x41b8f9` 要求已停下，`call 0x445ada receive_random_tool`（按库存加权抽 1..8），抽不到就什么都不做；`@0x41b936 push 0xd / call 0x40e14d` 收走该格物件 | `object-landing.ts:339-348` `drawGiftTool`（加权、空袋返回 0）、`:614-627`（停下才生效、抽不到即返回、`collect` 收走）；`reduce.ts:1811-1834` 的 `randConsumed` 保证 RNG 只在真用时推进 | —— | —— | ✅ 一致（含「抽到了但自己已满 9 个 → 道具凭空消失、物件照样收走」这条） |
| 17 | 与**神明/物件表**的交互 | `objects_info` 46×24（`@0x496d08`）；槽位按种类分区：0x0f→[0x0e,0x10)、0x10→[0x10,0x1a)、0x11→[0x1a,0x24)、0x12→[0x24,0x2e)、其余 = [type-1,type)（`@0x40e04d`-`@0x40e07d`） | `rules/objects.ts:16`、`:50-56` 类型表、`:134-149` `slotRangeForType`；`object-landing.ts:143-162` 只按槽位落、**不改 type** | —— | —— | ✅ 一致（这已是修过的版本，注释里记着「先前取第一个空槽」的错误） |
| 18 | `remove_object` 的**补放**行为 | 槽位 < 0x0c（神明）→ 取搭档 `objidx ± 1` 在新节点 `place_object`；**≥ 0x0c 直接返回**（`@0x40e275/0x40e284/0x40e29f`） | `object-landing.ts:240-246` `partnerSlot(i)` 只在 `i < 0x0c` 时非 −1；`objects.ts:234-239` | —— | —— | ✅ 一致（**规格 §6.2 那句「三件道具会自动补放」是错的**，见 §一.3 E1；**不要照规格改**） |
| 19 | 踩到**路障** | `@0x41bceb`：只 `remove_object` + 动画 + 台词 `#0247`，**无住院无罚钱**，然后跳分派出口（本格不再结算） | `object-landing.ts:585-592` | —— | —— | ✅ 一致 |
| 20 | 踩到**地雷** | `@0x41be5f`：停下才触发；`remove_object` → `call 0x40cd07` 报废车辆 → `mkf 0x20d` → 台词 → **住院 3 天**（`@0x41b8e6 push 3`） | `object-landing.ts:642-654`、`:426-444` | —— | —— | ✅ 一致 |
| 21 | **车辆报废**后车去哪 | `@0x40cd07`：`kind&3 == 1 → inc [0x497324]`（道具 5 库存）、`== 2 → inc [0x497325]`（道具 6 库存）；`traffic=0`、`ndices=1`；`0x1f` 不回；`+0x32` dword 非 0 就整个跳过 | `object-landing.ts:426-444`（`toolStock[5]/[6]`、`ndices=1`）；`+0x32` 用 `blocking.inHotel/disappearing/inPrison/inHospital` 复现（这 4 字节正是那个 dword） | —— | —— | ✅ 一致（与「換乘时退成**玩家**道具」方向不同，两边都对） |
| 22 | `objects_info.+1`（**朝向/图号**）与 `animate_object` 帧计算 | `place_object` 取节点 4 个邻接槽第一个非 0 的邻格 → `fcn_00407a8c(邻格, 本格)` 低字节写 `+1`（`@0x40e0e0`-`@0x40e11d`）；绘制图号 = `8 − 视角 + [+1] & 7`（`@0x408ee2`）；`animate_object @0x40e669`：帧数 = `trunc(√(Δx²+Δy²)×0.125 + 1)`、24 ms/帧、线性等分、`sleep(0x64)` | core **不存** `+1`（`cards/summon.ts` 的 `MapObject` 只有 type/nodeId/state/attached）；客户端渲染时现推（`Q-TOOL-1.md` 残留 6）；投掷插值在 `client/throw-fx.ts`（`Q-TOOL-1.md` ②、`Q-TOOL-5.md`） | —— | —— | 有意偏离，已登记。core 不存朝向是 C-ARC-2 的取舍；只要推法与 `place_object` 同规则，图号就一致 |
| 23 | 与**存档**的交互 | 存档块：`objects_info` 46×24、`player_tool_amount` 60、`remain_tool_amount` **8**（`@0x402bca/0x402bee/0x402c12`） | `loaders/save.ts:180`（`0x06ea`）、`:561-563`（8 字节）、`loaders/savegame.ts:314`（写进 `state.toolStock[道具号]`，1 基）、`:571` | —— | —— | ✅ 一致（存档里没有 9..13 的库存，本引擎那几格保持初始值，而 `giveTool` 对 >8 不查库存，故无影响） |
| 24 | **時光機快照的覆盖面** | 逐块 `memcpy`：玩家 416B（`0x496b68`）、特殊实体（`0x498e28`）、物件（`0x496d08`）、卡（`0x499120`）、道具（`0x49915c`）、卡/道具库存、股票（`0x4971a0`/`0x496980`/`0x497328`）、監獄/醫院占用（`0x496b30`/`0x496b60`）、日期（`0x497160`）…… 最后一块以 **地图原始缓冲 `[0x47493c]` 为源、`[0x498e94]`（`map_data_size`）为长度**（`@0x448507`-`@0x448539`；还原侧 `@0x448a14`-`@0x448a4b` 写回同一缓冲）。因为 `land_info_ptr=0x498e84` / `facility_info_ptr=0x498e88` **指向该缓冲内部**，所以**地产与設施记录的归属/等级/种类一并回滚** | `rules/time-machine.ts:57-96`（整份 `GameState` JSON 回滚，只排除 `snapshots` 与 `rngState`） | —— | —— | ✅ 在「地产/設施是否回滚」这个最容易搞错的点上一致（**原版确实回滚**，不是只回滚玩家/卡/道具）。逐块完全等价性见 §五 |
| 25 | **飛彈/核彈打設施** | `flags=0x26` 的第 2 位（`0x4`）走設施分支：轻击「`level--`，归零才清 type」、重击「owner/level/type/`+0x34` 全清」（`@0x40ad88`-`@0x40ae67`） | `reduce.ts:2316-2354`（含 `mutateFacility(MUTATE_DEMOLISH_ONE)` 与 heavy 全清） | —— | —— | ✅ 一致（known-deviations 也记着这是后来补的） |
| 26 | **公佈欄**市價 | 道具市價 = `標價 × 100 × 物價`（`@0x426af8`），买家该道具 ≥ 9 → 「道具欄已滿」 | `places/notice-board.ts`（`takeTool`/`giveTool` 在 `reduce.ts:4105` 一带） | —— | —— | 本轮未逐条核查（不在指定范围内）→ 见 §五 |

---

## 四、remake 多出或未见于原版的实现

| # | 位置 | 多出来的东西 | 评估 |
|---|---|---|---|
| 1 | `rules/tool-effects.ts:197-203` | `REMOTE_DICE_MAX = 18`（注释自称「与三颗骰子的上限一致」），`isValidRemoteDice` 接受 1..18 | 原版**没有范围检查**，可观察输入是 1..6。真人 UI 仍限 6（`client/dice-choose.ts:96`），AI 判定只给 1..6（`ai/tool-policy.ts:395/407/414/419` 的 `steps = i+1` ≤ 6）→ 当前不可达。建议**收紧到 6** 或把注释改成「内部防御性上界，真人不可达」；`state/use-tool.test.ts:114-120` 用 12 作断言，说明它是被当成契约钉住的 |
| 2 | `places/shop.ts:89,135` | 买入前的 `player.points < price` 检查（卡与道具都有） | 原版无（§8-⑪ 未决）。防御性实现，建议在 `known-deviations` 登记 |
| 3 | `state/reduce.ts:2368` | 飛彈把**施放者自己**排除在爆风之外（`if (i === state.currentPlayer && !heavy) continue`） | 原版玩家循环（`@0x4470a1` 起）只认 `flags & 0x40`，没有这一句。核彈（heavy）不排除。因为原版破坏几何本身是 C 级（`0x64` 是常量、窗口固定在地图中心，见 §五），这条的**可观察性未定**；但它是一条原版没有的规则 |
| 4 | `rules/time-machine.ts:91-93` | 「**快照本身不回滚**」 | 原版没有这一条，但原版的快照区也不在自己的块清单里，效果相同。属防死循环的显式化，无观察差异 |
| 5 | `rules/time-machine.ts:70-71` | 存快照判据写成 `whoPlays !== WHO_PLAYS_HUMAN`（即要求**恰好 == 1**） | exe 是 `test byte [player+0x15], 1`（**只看 bit0**），所以被托管的真人（`1|4 = 5`）在原版**会**存快照。因为托管时 AI 从不用時光機（`AI_NEVER_USES=[10,13]`），**不可观察**；但 `time-machine.ts:65`（`@source` 注释）与 known-deviations 的「快照只给 who_plays == 1 存」这句措辞与 exe 不符，建议改成「bit0 = 1」 |
| 6 | `state/reduce.ts:1739-1745` | `objectHandleAt` 用「`nodeId` 相同 **且 `attached === 0`**」反查，替代原版节点反向索引字节 `node+0x26` | 等价实现（原版 `place_object` 写 `+0x26 = 槽号+1`，`remove_object` 清 0）。已在 `object-landing.ts:667-670` 写明理由，可接受 |
| 7 | `rules/objects.ts:97` | `INITIAL_PLACED_OBJECTS = [1,3,5,7,9,11,13,14]`，注释写「开局随机放置到地图上的物件**下标**」 | 这 8 个数是**类型**（`@0x407d6a` 的 `place_object(type,…)`），对应的槽**下标**是 `[0,2,4,6,8,10,12,13]`。该常量在 `src/` 里**无任何引用**（只有 `client/src/render.test.ts:744` 的注释提到），与现役的 `INITIAL_OBJECT_TYPES`（`object-landing.ts:898`）重复。建议删掉或改注释 |
| 8 | `client/picking.ts:137-138` | 注释「工程車（12）…本引擎暂按『和機器工人一样选一格』处理并登记」 | 实现里**没有** 12 的条目（`picking.ts:139-147`），与注释矛盾；真实状态见 `Q-TOOL-4.md` 残留 7。建议改注释并补条目 |
| 9 | `client/inventory.ts:198,236-238` | `TOOLS_NEEDING_TARGET` 把 12 计入「需要目标」 | 原版工程車**不选目标**；把它移出该表即可让真人用出来（core 本来就忽略 `nodeId`，`reduce.ts:2740-2750`）——这是 §一.2 那条修复的最小改法 |

---

## 五、无法判定项

以下各项**证据不足**，一律不做推测：

1. **工程車 `traffic = 0x1f` 的游戏效果** —— 已确认写点（`@0x447a5b`）、唯一识别式（`and 3 == 3`，`@0x4479df`）、`fcn_0040cd07` 对它不退回（`@0x40cd2b`-`@0x40cd49`），但**没有找到**任何「能否无视路障 / 能否拆建筑」的特判（tools.md §8-⑤ 同结论）。remake 只实现了数值与退款。
2. **工程車备份 `+0x64`/`+0x65` 的回滚点** —— 已确认写点（`@0x447a49`/`@0x447a55`，本轮实读），**未找到**唯一的消费点；remake 未实现备份（`reduce.ts:2740-2750` 只设 `trafficMethod`/`ndices`）。无法判定其是否可观察。
3. **飛彈（7）的破坏几何范围** —— `fcn_0040ac7b(0x64, …)` 的 `0x64` 是常量、与选中格无关（tools.md §8-②）。remake 用「以目标格为中心的节点坐标 ±100 方窗」（`reduce.ts:2284-2289`），已知为近似（`Q-TOOL-1`、known-deviations）。核彈的 −1 = 全图是精确的。
4. **遙控骰子越界值的可达性** —— 原版 UI 给 1..6、工具函数与 `fcn_00419572` 都无检查（tools.md §8-③）。判定不了 7..18 是否本来就不可能产生；remake 主动开到 18（§四.1）。
5. **傳送機第二次选择缺少类型校验** —— `@0x44750c` 之后直接 `imul edx, 0x34 / 0x38`，不校验返回值范围；UI 掩码 `0x2090802/0x2090804` 的位定义未破解（tools.md §8-④）。remake 的 `teleportWith`（`reduce.ts:2627-2647`）要求**同类**才搬，属主动收紧。
6. **商店是否已在别处过滤掉买不起的道具**（tools.md §8-⑪）—— 上架循环只看 `remain_tool_amount`（`@0x42ec23`），未确认 UI 层是否另有点数闸门。remake 自己加了闸（§四.2）。
7. **「使用道具」的时机闸门** —— 原版入口只判「人类/电脑」（`@0x447d9e`），走子是阻塞循环；「走子补间途中能否点道具按钮」未取证。remake 的 core 无阶段闸门（`reduce.ts:1313`/`2649-2659`）。
8. **時光機快照是否逐块等价** —— 已确认原版含 ~19 块、且**包含地图原始缓冲**（故地产/設施会回滚，见 §三-24）；remake 是整份 `GameState`（排除 `snapshots`/`rngState`）。原版清单里是否存在「本引擎会回滚、而原版故意不回滚」的字段（例如新闻/事件牌堆、某些本地 UI 状态）**本轮未逐块比对** → 无法判定。
9. **機器娃娃「除掉障礙物」这句台词的语义**（tools.md §8-①）—— 原版路障/地雷分派对 `current_player >= 8` 的分支最终什么都不做，未在 exe 找到「实体 8 清除 `objects_info`」的专门路径。remake 走的是「actor 8 落点先截住 → 见物件就 `remove_object`」（`object-landing.ts:25-34` + `special-actors.ts:391-419`），**这条路与 `@0x41b4e7`-`@0x41b531` 逐条对得上**；但「原版设计意图」本身未决，故本条只能记「实现与 exe 的机器码一致，设计意图未决」。
10. **公佈欄（notice board）里的道具交易** —— 市價 `標價×100×物價`（`@0x426af8`）、「买家已有 ≥ 9 → 道具欄已滿」这条与本主题相邻（`reduce.ts:4105` 一带也用 `takeTool`），但「挂卖/成交时该不该动全局库存」本轮未回 exe 取证，**不列为差距、也不做判定**。

---

## 六、建议的修复顺序

按「玩家可观察的程度 × 改动量」排：

1. **消耗/回池口径**（§三-3）—— 影响每一次用道具，改动集中在 `state/reduce.ts:2740-2759` + `rules/tools.ts`。
   建议加一个显式表：`REFUND_ON_USE = {1,7,8}`（+ 9/10/11/13 走 `after` 但因 >8 不落地），
   其余 2/3/4/5/6/12 用「只减持有量」的路径；**照 exe 的 9 个 `0x445aa2` 调用点钉住**
   （`callers 0x445aa2` = `0x446b05`(1)、`0x447024`(7)、`0x44726d`(8)、`0x4472fb`(9)、
   `0x447407`(10)、`0x4479c0`(11)、`0x447b36`(13)，另两处非道具）。
2. **機器娃娃扫物件改走 `releaseObject`**（§一.2）—— `special-actors.ts:412-419` 改成返回 handle，
   由 `reduce.ts:2696-2705` 逐个 `releaseObject` + `respawnPartner`（`playCard` 里已有现成写法，`reduce.ts:2854-2871`）。
3. **飛彈/核彈写回 `landType`**（§一.3）—— `fireMissile` 里加 `landType` 数组并按 `out.type` 写回（`reduce.ts:2291-2314`）。
4. **工程車（12）真人可用**（§四.8/9）—— 把 12 从 `TOOLS_NEEDING_TARGET` 移出（`client/inventory.ts:198`），或给 `TOOL_SELECT_PARAM` 补一条；并删掉 `picking.ts:137-138` 的过时注释。
5. **商店 AI 采购**（§三-9）—— 照 `0x4755f0` 六项表 + 四个闸门重写 `ai/policy.ts:456-478`。
6. **傳送機地產分支清 `landLastToll[from]`**（§二 11 号）—— 一行，和設施分支对齐（`teleport.ts:184`）。
7. **放置类槽满时仍消耗**（§三-4）—— 与已登记口径对齐；改与不改都要在 `known-deviations` 明写。
8. **收尾清理**：`REMOTE_DICE_MAX` 收紧到 6 或改注释（§四.1）、删/改 `INITIAL_PLACED_OBJECTS`（§四.7）、
   把 §四 其余各条登记进 `known-deviations`；并把 §一.3 的 E1/E2/E3 三条**回改 `rich4-spec/docs/systems/tools.md`**。

---

*本报告所有「1:1」判定都经过两侧证据核对；凡证据不足者一律写在 §五，不用推测填充。*
