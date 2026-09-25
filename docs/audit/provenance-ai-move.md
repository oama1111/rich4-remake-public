# 溯源审计 · ai-move（电脑 / 託管玩家的非经济决策）

范围：出牌（`ai/card-policy.ts` 30 张的判定、目标、個性闸门）、用道具（`ai/tool-policy.ts` 13 件）、
骰子数（`ai/dice-policy.ts`）、AI 顶层调度（`ai/policy.ts` 的 `decideAction` / `decideCard` /
`decideTool` / `decidePending` 非经济分支、`state/reduce.ts` 的 `aiAdvance`）、性格表（`ai/personality.ts`
与 `@rich4/data` 的角色 / 卡片 / 道具 f7 列）、免費卡 / 嫁禍卡的电脑判定（`rules/toll-flow.ts`）、
保釋（`rules/visit.ts` + `enterVisit`）、岔路选边。经济决策（买地 / 盖房 / 商店 / 股票 / 拍卖 / 借贷 / 樂透 / 認購）归 ai-econ，未审。

方法：逐个 VA 用 `tools/disasm.py` 重开、自己译成伪码再与 TS 逐行对（不采信既有 `@source`）；数据表用脚本
从 exe 逐字节 dump 对比（见 V-3）。

## 汇总

| 状态 | 条数 |
|---|---|
| verified | 47 |
| fixed | 11（台账行；对应 9 处修复，V-10/C-27b、V-19/C-12 各是同一修复的两面） |
| approx | 6 |
| follow-up | 4（FU-1 / FU-3 / FU-4 / FU-5，列在「跟进」一节；FU-2 已结项） |
| n/a | 2 |

**修复（均已提交，均改变对局状态 ⇒ 需协调方统一升 PROTOCOL_VERSION）：**

1. **漲價卡比例门槛** 0.5 → **0.66**（`0x0042056e fcomp qword [0x463d38]`，常数 dump = 0.66）— `aad6335`
2. **漲價卡設施一支**：「目前最高等级」被原版写成了 `esi`（`0x004205f6 mov [esp+4], esi`）⇒ 常见情形只选**第一栋**合格設施（旧：最后一栋）；进门 `esi` 为 0 时整支落空 — `aad6335`
3. **拆除卡**：可见清单**一趟**扫完、地块 / 設施 / 物件按屏幕行序混排、第一个命中即停（旧：先扫完地块再扫物件）；可见物件清单排除附身物件 — `aad6335`
4. **遙控骰子**逐格判的是**格上有惡人**（bits 12-15），不是有玩家 — `293b6ce`
5. **路障阶段一**的「空格」按运行位：关押 / 住店 / 消失的人不占格 — `293b6ce`
6. **嫁禍卡（电脑）**无人可嫁时照样掷门槛 `rand()`（旧：少掷一次，随机流错位）— `1b3c7eb`
7. **开着保釋窗被托管的真人**：删掉自拟的「挑最便宜同伴」，按关窗处理 — `0e14efc`
8. **FU-2：电脑 / 托管决策的随机数改吃全局序列**（见 V-21）—— 出牌起点 `0x441d4a`、個性闸门 `0x41e6ce`（且改成
   **只在差一档时掷**）、卡/道具判定里的 `%4`/`%n`、前瞻岔路 `0x40b221`/`0x40b343`、骰子数 `0x4221c0`；
   掷数由 reducer 在同一局面上复算写回（真人座位不补、被拒的 action 不补），骰子数那一步同时搬进
   `aiAdvance` 第 3 步 — `81e1940`
9. **AI 可见节点表的「并列次序」照原版屏幕行序**（本分支 F-2 手工并入；源提交 `ds/ai-visible-cell-order`
   的 `9bf8cbb` 落后 404 个提交、AI 区已被审计重写，逐条按**当前**代码并入并重跑 exe 取证）——
   路障阶段二 / 地雷 / 定時炸彈 / 傳送機 的候选表 `visibleNodeIds` 改由 `screenScanOrder` 收：
   `0x409ef9` 把节点按 `[0x499088]` 投影到 440×440 格表、`0x40a050` 行优先（先屏幕 Y 后屏幕 X）扫出，
   同像素后写覆盖；旧实现按世界 (y,x) 排。见 V-1a。**这条不改 `reduce`、也不改一次决策的掷数**
   （候选**集合**没变、`rand()%n` 仍是 1 次）—— 老客户端重放新服务器的 action 串照样得到同一局面
   ⇒ **不需要为「重放兼容」升协议**；是否搭协调方下一次批量 +1 只是版本记账口径，留给协调方定。
   ★ 但它让 AI 依 **`state.viewRotation`** 取景，而该字段**不在 `stateFingerprint`** 白名单里
   （net/protocol.ts 明写「每个客户端各自的镜头」）—— 见 FU-1 的确定性分析：`rotateView` 走
   `dispatch` → 定序器 → 全端重放，故两端始终同档；真分岔也会由它引起的 `rngState`/action 差异在指纹上现形。

联机镜像测试：`packages/server/src/audit-ai-move-mp.test.ts`（漲價卡 esi 残值 / 保釋关窗 / ③ 出牌吃全局随机流：
服务器 = 旁观端重放、`rngState` 恰好前进决策掷数）；`packages/server/src/pt21-ai-mp.test.ts` ② 按新接线改
（骰子数由 reducer 第 3 步写，不再出 `setDiceCount`）；`packages/server/src/visible-cell-order-mp.test.ts`
（第 9 条：傳送機并列候选取屏幕行序先到者 —— 服务器 = 单机同一手、重放一致；转视角后两端镜像同档、AI 换格）。

## 台账

### V · 顶层调度、表、共用机制

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| V-1 | 「画面」可见集（候选**成员**） | `ai/card-policy.ts:146` `inView` / `:151` `visibleEntities` / `:166` `visibleRivals` / `:184` `visibleObjects`；`ai/tool-policy.ts` `visibleNodeIds` | 0x409ef9、0x40a45c、0x409de7、0x407a2c、投影表 0x46ccf0（旋转 [0x499088]）、镜头 [0x48b2ac]/[0x48b2b0] | approx | 原版成员 = 镜头 ±14 格 → 投影后落在屏幕 0..440 内、且 `+0x24 & 0xffff00` 无占用；精灵锚点：建筑 = 地块记录 (x,y)、玩家 = xpos/ypos、物件 = 节点，y−0x28。TS 用节点坐标 ±220 方窗（占用那道闸已按 `68be042` 补上）。**次序那一半已修，见 V-1a**；剩下的是成员口径，见 FU-1 |
| V-1a | 「画面」可见集的**次序**（并列取先到者） | `ai/tool-policy.ts` `screenScanOrder`（`visibleNodeIds` 用它） | 0x409ef9（填 440×440 格表：`0x409fde imul eax,[0x499088],0xd24` / `0x40a010 cmp ecx,0x1b8` / `0x40a046 mov word [buf+…],di`）、0x40a050（`0x40a073` 内层列 / `0x40a064` 外层行）、0x407a2c、0x474910、0x46ccf0 | fixed | 本分支 F-2（源提交 `9bf8cbb`）。四个消费点：路障阶段二 `0x4212b5`、地雷 `0x4213e8`、定時炸彈 `0x421597`、傳送機 `0x421cc1`（并列取先到：`cmp best,this / jge 跳过`）。真值 = Unicorn 测试台实跑 `0x409ef9`（复跑脚本 `tools/audit/visible-order-emu.py`）：① 四组构造盘面（x 递增行 / 同像素 / 15 块越窗 / 并列随视角翻转）逐条与 TS 一致；② **320 组随机盘面 × 8 视角 320/320 一致**（exe 序 = TS 序限制在 exe 可见集上；其中 **201/320** 与旧 (y,x) 序不同 ⇒ 这条改动真会改局）；③ 八张地图 × 每节点当镜头 × 8 视角 7,896 组的同像素重叠 **0 次**。`0x40a45c` 那一路（`visibleEntities`）收集也是同一张格表的行优先扫，但填表者 `0x409de7` 是**精灵遮罩**、锚点不同 ⇒ 不复用 `screenScanOrder`，仍 (y,x) |
| V-2 | 谁由 AI 出手（who_plays 分派） | `state/types.ts:1829` `isAiControlled`（掩码 6）；`ai/policy.ts:109` | 0x40c912 返回 who_plays → 跳表 0x418c3d：1 真人 / 2、5 电脑支 0x418dc6 / 3、4、>5 什么都不做 | verified | 2 与 5（真人+託管）都进 0x418dc6 ✓。`whoPlays = 3` 原版不动、TS 当电脑 —— 只有读档可达，见 FU-4 |
| V-3 | 性格表 / f7 表逐字节 | `packages/data/src/characters.ts:134-145`、`cards.ts`、`tools.ts` | 角色表 0x47e80c（步长 0x68，+0x11 +0x12 +0x16..+0x1a）；卡片 0x47fdea+id×8 的 +7；道具 0x47fee1+id×8 | verified | 脚本 dump 对比：12 角色 × 7 字节、30 张卡 f7、13 件道具 f7 全等 |
| V-4 | 能力位：会出牌 / 会用道具 | `ai/personality.ts:62,65`；`ai/policy.ts:248,346` | 0x00441d09 `test [+0x16],1`；0x00447f87 `test [+0x16],2`（其前 `test dl,6`） | verified | |
| V-5 | 個性闸门 f7 − 個性 | `ai/personality.ts` `personalityAllows` / `personalityAllowsLazy`；`ai/policy.ts` `gateRand` | 卡 0x41e69e（[0x47fdf1+id×8]）；道具 0x420e9a（[0x47fee1+id×8]）；≥2 不做、==1 `rand()%3==0` 才做 | verified | ★ 那次 `rand()%3` 现在吃全局流、且只在差一档时掷（V-21 / 81e1940） |
| V-6 | AI 回合调度顺序 | `ai/policy.ts:154-169`；`state/reduce.ts:6811` `aiAdvance` | 0x00418dc6：`test [+0x15],0x30` → 0x42bf03 买股 → 0x42c79f 卖股 → 0x436b0a(0) → [0x46caf8] 终局码 → 0x4284be 公佈欄 → `rand()&1`：1 卡 0x441baa / 0 道具 0x447d97 → 0x4221c0 → 0x40dd1f | verified | 随机数消费点见 V-21（已全部吃全局流） |
| V-7 | 用完卡/道具后被挡则不掷骰 | （无显式步骤） | 0x00418e36 `+0x32` dword / `+0x37` / `+0x36` 非 0 ⇒ 置 0x80 返回；0x00418e67 `[0x498ea2+cur×0x34]==1`（已在走）⇒ 跳过 | verified | 不可达：没有一张 AI 会出的卡/道具会把**自己**置进这几种状态；遙控骰子的「已在走」由 reducer 直接进 moving |
| V-8 | 出牌主循环 | `ai/card-policy.ts:1107` `cardsToConsider`；`ai/policy.ts:242` | 0x441262 数 15 格非空；0x00441d45 >8 张 `rand()%张数` 起环形、≤8 张从头；取 8 格、遇空停；第一张过闸即 `call [0x475d5c+id×4]` 后返回（一回合一张） | verified | |
| V-9 | 出牌前预演（`willWork`），接不住顺延 | `ai/policy.ts:262` | 原版 0x441e00 调效果后不看返回值直接结束 | approx | 既有偏差（同 Q-CARD-2 口径）：防活锁，见 FU-5 |
| V-10 | 填表后 `esi` 残值 | `ai/card-policy.ts:136` `cardLoopEsiAfterFill` | 0x00441d45..0x00441d96（≤8 张恒 8，>8 张 (起点+8)%张数）；0x441da2.. 不写 esi，闸门与判定函数保存 esi | fixed | aad6335（漲價卡用它，见 C-27b） |
| V-11 | 道具主循环 | `ai/tool-policy.ts:757` `toolsToConsider`；`ai/policy.ts:342` | 0x00447f90..0x00448085：13 格跳过槽 9（時光機）、>4 种 `rand()%种类` 起环形、最多试 4、遇空停、第一件过闸即执行 | verified | |
| V-12 | 用道具前预演（`toToolAction`） | `ai/policy.ts:393` | 原版过闸即 `call [0x475dd5+id×4]` | approx | 既有偏差：防活锁（同 V-9） |
| V-13 | 跳表缺席项 | `ai/card-policy.ts` `AI_NEVER_PLAYS`；`ai/tool-policy.ts` `AI_NEVER_USES` | 0x475324 第 5/6/18..21 项 = 0x41e6e3、第 40 项 = 0x420edf（`xor eax,eax; ret`） | verified | |
| V-14 | 前瞻 / 反瞻 | `ai/card-policy.ts:240` `lookahead`；`ai/tool-policy.ts:148` `backtrack`；`state/reduce.ts` `nextCandidates` | 0x40b221 / 0x40b343：n 封顶 8、邻接 4 槽跳 0 / 来路 / 封路位 0x40000000>>k；0 个回来路、1 个直走、>1 `rand()%n` 且置岔路 | verified | 岔路那次 rand 见 V-21（已吃全局流） |
| V-15 | 最恨的人 | `ai/card-policy.ts:83` `mostHated` | 0x40d2d3：who_plays≠0、非我、hostility 有符号严格大于（起点 0） | verified | |
| V-16 | 随机活跃对手 | `ai/tool-policy.ts:364` 内；`rules/toll-flow.ts:97` 内 | 0x40d31c：非我、who_plays≠0、`+0x32` dword == 0；空则 −1 且不掷 | verified | |
| V-17 | 值得拿 | `ai/card-policy.ts:295` `worthTaking` | 0x41e8e6 | verified | 同街扫 1..地块数，TS 地块本就 1 基 |
| V-18 | 同街住宅过路费 / 连锁店数 | `ai/card-policy.ts:215,230` | 0x419744（名字支，Σ租金[等级] × 物價 0x004197d8）；0x41970f | verified | 0x419744 名字为 0 的「连锁店×2000」支 AI 从不走（调用方都传名字） |
| V-19 | 可见物件排除附身物件 | `ai/card-policy.ts:184` | 0x00409e5b..0x00409e93（物件标记且 `+0x05`≠0 不画） | fixed | aad6335 |
| V-20 | 岔路选边 | `state/reduce.ts:824` `pickNextNode` | 0x0040c12c..0x0040c1a5：无 who_plays 分支，人机同一条 `rand()%候选` | verified | 归 loop；AI 无独立决策 |
| V-21 | **AI 决策的随机数来源 = 全局 `rand()`**（原 FU-2 / D-004 / D-007） | `ai/rand.ts` `aiRand`；`ai/policy.ts` 的 `AiContext.roll` / `localAiRoll`；`state/reduce.ts` 的 `aiDecisionRollAdvance`、`aiAdvance` 第 3 步；`personality.ts` 的 `personalityAllowsLazy` | 出牌起点 `0x00441d4a call 0x456f2d / idiv 张数`（只 >8 张掷）；個性闸门 `0x0041e6ce call 0x456f2d / idiv 3`（**只在 f7−個性==1 那一档**：`0x0041e6c1 cmp edx,2 / jl` → `0x0041e6c9 cmp edx,1 / jne`）；道具闸门同形 `0x00420eca`；卡/道具判定里的 `%n`（VA = `call 0x456f2d` 那一条）：改建 `0x0041eec4`、天使 `0x0041f172`、冬眠 `0x0041fe51`、夢遊/陷害 `0x0041ff48`、地雷/炸彈 `0x0042153e`、機車 `0x00421657` / 汽車 `0x0042168d`、飛彈随机对手 `0x0040d355`、工程車 `0x00421e43`、核彈 10 次 `0x0042216f`；道具环形起点 `0x00447ff5`；前瞻岔路 `0x0040b221` / `0x0040b343`；骰子数 `0x004222e1 rand()%2`（调用点 `0x00418e70`） | fixed | 81e1940（旧：`aiRoll` 的 `rngState ^ 盐` 替身，一个数都不推进）。`decideAction` 缺省自己从 `state.rngState` 播种；掷掉的数由 `reduce` 在同一局面、同一函数上复算写回（补掷的三手 = `aiNext`/`useCard`/`useTool`；真人座位不补、被拒的 action 不补）；骰子数一步搬进 `aiAdvance` 第 3 步「算一次、掷一次、写一次」；替身只留给直接单测判定函数的调用点 |

### C · 三十张卡（跳表 0x475324 第 1..30 项）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| C-1 | 均富卡 | `ai/card-policy.ts:320` | 0x41e6fe | verified | 平均 = Σ现金/在场数（idiv 截断）> 10×我、3000×物價 > 我 |
| C-2 | 均貧卡 | `:329` | 0x41e779 | verified | 最恨且在画面：>30000×物價 且 >2×我；否则**下标最大**的 >50000×物價 且 >3×我 |
| C-3 | 購地卡 | `:351` | 0x41e9e2 | verified | 地块 (+0x1c + +0x1e×级)×物價 < 现金；設施 (+0x22 + +0x24×级) |
| C-4 | 換地卡 | `:367` | 0x41eae2 | verified | |
| C-7 | 改建卡 | `:403` | 0x41ed3e（0x0041eec4 `rand()%4+1`；0x0041ef0c 写 0） | verified | |
| C-8 | 拍賣卡 | `:435` | 0x41ef26 | verified | |
| C-9 | 天使卡 | `:446` | 0x41f037（0x0041f172 `rand()%组数`） | verified | |
| C-10 | 惡魔卡 | `:466` | 0x41f1b3 | verified | 组内按主人累加等级 / 间数（字节） |
| C-11 | 怪獸卡 | `:504` | 0x41f400 | verified | 普通支循环写死 4 人 |
| C-12 | 拆除卡 | `:557` | 0x41f6a9（0x0041f6bf..0x0041f8f5 一趟三分支） | fixed | aad6335：旧实现两趟（先地块/設施、后物件） |
| C-13 | 搶奪卡 | `:600` | 0x41f901（价 = [0x47fdef+id×8]，f7 = [0x47fdf1+id×8]） | verified | |
| C-14 | 停留卡 | `:639` | 0x41facc（財運 = word [+0x46]） | verified | |
| C-15 | 冬眠卡 | `:685` | 0x41fe4e `rand()%4==0` | verified | |
| C-16/17 | 夢遊 / 陷害卡 | `:688` | 0x41fe6f（`+0x36`==0、`0x4413ad(c,18)`==0；最恨优先否则 `rand()%n`） | verified | |
| C-22 | 送神符 | `:699` | 0x41ff77（类型 ∈ {5,6,7,8,10,15}；否则 f64 物件 `+4` < 13） | verified | TS 用静态 `OBJECT_TYPE_TABLE`，与运行时 `+0` 相同（物件种类开局固定） |
| C-23 | 請神符 | `:713` | 0x41fff8 + 0x444d1a | approx | 距离起点原版是玩家 `xpos/ypos`（站定时 = 节点坐标），`sqrt` 存 float32、严格小于才换；TS 用节点坐标与 double —— 仅在两距离 float32 相等时次序可能不同 |
| C-24 | 紅卡 | `:753` | 0x420055（0x428d01 休市；市值 `fild×fmul` 向零；停牌 [0x496986+j×36]；0x4295ea==1 漲停） | verified | |
| C-25 | 黑卡 | `:771` | 0x4200ea（0x4295ea==3 跌停；word [0x496984+j×36]==0 无企業） | verified | |
| C-26 | 查稅卡 | `:809` | 0x4202d2 | verified | 兜底取下标最大者 |
| C-27a | 漲價卡：比例门槛 | `:851` `zhangjia` | 0x0042056e `fcomp qword [0x463d38]` = **0.66** | fixed | aad6335（旧 0.5，注释误读常数） |
| C-27b | 漲價卡：設施一支 | `:851` `zhangjia` | 0x004205f0 / 0x004205f6 `mov [esp+4], esi` / 0x00420610 | fixed | aad6335：常见情形只选第一栋；esi=0 时落空 |
| C-28 | 查封卡 | `:905` | 0x42062b（前瞻 6、同名跳过、我有地即跳过、对手等级和 ≥ 7；最恨的人 ≥3 级非公園設施） | verified | |
| C-29 | 同盟卡 | `:937` | 0x4207cc（`+0x41`≠我+1；地块+設施计数，严格大于） | verified | |
| C-30 | 烏龜卡 | `:965` | 0x420970（×1.5 = [0x463d40]；对别人 ≥ 10000×物價、≥ 2 格） | verified | |

### T · 十三件道具（跳表 0x475324 第 31..43 项）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| T-1 | 機器娃娃 | `ai/tool-policy.ts:212` | 0x420efa（前瞻 4、物件位 0x3f0000、坏神/惡犬/我的地雷/别人路障且过路费 > 3000×物價、設施按 0x989680） | verified | |
| T-2a | 路障阶段一的「空格」 | `:194` `nodeClear` | 0x00421148 `test [node+0x24], 0x3fff00` | fixed | 293b6ce：bits 8-11 玩家只在站在盘上时置（住店 0x0040d5d2 / 关押 0x0043d61d / 消失 0x0040d444 清位） |
| T-2b | 路障判定 | `:253` | 0x42107f（阶段一：无主住宅 / 無主設施 / 百貨且點券 > 200；阶段二反瞻 6 ∩ 可见节点、> 6000×物價 且严格大于） | verified | |
| T-3/4 | 地雷 / 定時炸彈 | `:309` `mineLike` | 0x4213c5 / 0x421574（監獄/醫院格 `dword [0x496b30]/[0x496b60]` 直选；`rand()%候选`） | verified | |
| T-5/6 | 機車 / 汽車 | `:350,354` | 0x421644 / 0x421675（先看 `+0x11 & 3`，过了才掷 `rand()%4`） | verified | |
| T-7 | 飛彈 | `:364` | 0x421717（最恨 / 0x40d31c；须在画面；0x40a0b1(目标 xpos,ypos,100) 窗内有标记或我的地产 ⇒ 放弃） | approx | 爆风窗用节点方窗（Q-TOOL-1 / V-1）；`0x4216ab` 的「不是我的」出口返回调用方 `edx`，首项的 `edx` 来自 0x40a0b1 → 0x409b18 的残值，未能静态定值，见 FU-3 |
| T-8 | 遙控骰子 | `:413` | 0x421827（0x00421a12 `and edx,0xf000` = **惡人**；物件 {5,6,7,8,10,11,16,17,18}；×2.5 = [0x463d48]） | fixed | 293b6ce：旧实现查的是玩家 |
| T-9 | 機器工人 | `:473` | 0x421ba6（租金表 / 費率表 [+0x24+级×2]、上限表 0x474940） | verified | |
| T-10 | 時光機 | `AI_NEVER_USES` | 0x420edf 桩 + 主循环跳槽 9 | verified | |
| T-11 | 傳送機 | `:506` | 0x421cb6（无主 ≥3 级、房價×物價 < 现金、等级严格大于；钱闸在找到候选后） | verified | |
| T-12 | 工程車 | `:539` | 0x421e20（`&3==3` 不掷；否则 `rand()%15 <= 個性`） | verified | |
| T-13 | 核子飛彈 | `:619` | 0x421e62（候选地块/設施、10 次 `rand()%n`、0x40a0b1(x,y,−1)、两比值 < 1/(存活+2)） | approx | 窗口按「±14 格」建模，原版还要投影后落在 0..440 屏幕内（V-1）；`0x4216ab` 首项 `edx` 同 FU-3 |

### D · 骰子数

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| D-1 | 电脑掷几颗（汽車/機車） | `ai/dice-policy.ts:71` | 0x4221c0（`+0x11` 整字节 2/1；默认 3/2；背炸彈引信 [idx×24+0x496d0c] < 15 ⇒ 1；否则前瞻 5 数「无主或我的」/「别人的」：全别人且 >2 ⇒ 汽車 `2+(rand()&1)` / 機車 2；≥2 块自己的且别人 ≤1 ⇒ 1） | verified | 地块区间 0x7d0<v<0xfa0、設施 0xfa0<v<0x1770（0 号永不计，与 `resolveNodeType` 同）；唯一调用点 0x00418e70 前的闸门同 V-7 |

### P · 非经济提示的应答

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| P-1 | 免費卡（电脑） | `rules/toll-flow.ts:85` | 0x00444a92 `cmp [+0x15],1 / je 真人`；0x00444a9b `(rand()%3000+3000)×物價`，費 > 现金或 > 门槛 ⇒ 用 | verified | 整字节：託管走电脑支 |
| P-2 | 嫁禍卡（电脑，mode 1） | `rules/toll-flow.ts:97` | 0x004448b0..0x00444973 | fixed | 1b3c7eb：候选空时仍掷门槛 rand |
| P-3 | 保釋（电脑） | `rules/visit.ts:165` `decideBail`；`state/reduce.ts:4666` | 監獄 0x0043d3d8..0x0043d4fd、醫院 0x0043ea9a 同构：`rand()&1` → 按個性 0/1/2 取槽（1 再 `rand()%3`）→ `rand()%n` → 玩家點券 > 30、犯人點券 ≥ 700 | verified | |
| P-4 | 开着保釋窗被托管 | `ai/policy.ts:551` | 窗 0x0043d33e..0x0043d3d3 模态、只给 who_plays==1 | fixed | 0e14efc：旧「挑最便宜同伴」无 VA |
| P-5 | 小游戏（托管的真人） | `ai/policy.ts:537` | 0x00415226 `cmp [+0x15],1 / jne 0x415457`（不玩：`rand()%20+50` 點券） | verified | 结算在 reducer（`settleMinigame(null)`） |
| P-6 | 魔法屋 / 免費卡 / 嫁禍卡窗被托管 | `ai/policy.ts:541,544,545` | 各自电脑支（魔法屋 0x0043381b；0x444a9b；0x4448b0） | n/a | 托管超时接管开着的窗是复刻独有；交给 reducer 按电脑支掷（不自拟） |
| P-7 | ATM / 还款提醒 / 商店窗被托管 | `ai/policy.ts:524,530,559` | 均为「恰好真人」才开的模态窗 | n/a | 复刻独有情形，按关窗 |

## 跟进（未修，附证据）

- **FU-1 画面投影**（V-1、T-7、T-13）—— **次序那一半已修（V-1a，本分支 F-2）；成员那一半未修，
  仍是「明确不做」**（>半天、且是纯保真度：差异只在屏幕边缘几格）。
  原版 AI 的候选集 = **投影到屏幕之后**落在 `0..0x1b8`（440）方窗里、且无运行时占用的东西
  （`0x409ef9` / `0x409de7` / `0x40a45c` / `0x40a0b1`），本引擎是「±220 像素方窗 + 占用掩码」。
  ⇒ 复刻的可见集**更大**（本轮随机对拍 320 组、采样故意偏边缘：**846/2128** 的候选节点
  落在原版 440×440 格表外），
  这些节点在原版根本不会成为候选；`screenScanOrder` 给它们的位次是对**格表内**节点相对次序的延伸
  （行优先键留了 2^16 的宽度，不与格内节点串行；投影表实测 |值| ≤ 715）。
  要复刻**成员**得搬进 core 的件（逐件都已定位）：
  1. 取景原点：视图扫描用**相机像素坐标** `[0x48b2ac]` / `[0x48b2b0]`（`0x409b44` / `0x409b4e`，
     随后 `0x409b5c sar ecx,5` 得格号）；窗口函数 `0x40a0b1(xpos, ypos, 半径)` 另取**当前玩家**的
     `xpos/ypos`（`0x40a125 mov dx,[eax+0x496b70]` = +0x08、`0x40a138 mov ax,[eax+0x496b72]` = +0x0a；
     其前 `0x40a117` 判 `+0x32` 起的阻碍四字节，挡下就不画自己的标记）。
  2. 格窗：`lea …,+0xe` / `cmp …,0x1c`（`0x409bd9` / `0x409bf0`、`0x40a326` / `0x40a341`）⇒
     ±14 格的 29×29 窗口；像素余量 `add [esp+0xc],0xdc`（+220）后只留 `0..0x1b8`（440）。
  3. **旋转** `[0x499088]`（4 档）→ 投影表 `0x46ccf0` 的基址：`0x40a186 imul eax,[0x499088],0xd24` /
     `0x40a190 imul edx,ebp,0x74`（4×29×29 个 (int16,int16)，本仓库已逐字节 dump）；
     `0x407a2c` 给的是「像素 → 投影格内偏移」。
  4. 精灵锚点：地块记录 `(x,y)`、玩家 `xpos/ypos`、物件取**节点**且 `y−0x28`（见 D-005）。
  5. 屏幕格 OR 合并（同一次调用里逐类写）：玩家 `0x40a1bb..0x40a202` 写 `cx = 0x8000 | 1<<当前玩家`
     （其前 `0x40a1cd` / `0x40a1d9` 判 0..0x1b8 越界）、地块 `0x40a2c8 add ecx,0x7d0`、
     設施 `0x40a3ba add ecx,0xfa0`；物件那一趟与 V-1 编码表一致（`(槽+1)<<8`）。
  影响 V-1 / T-1 / T-2a / T-7 / T-13 等约 20 个判定函数的候选**成员**（次序那半已按 V-1a 收口）。
  ⚠️ 确定性面：镜头位置可由行动者推出，旋转 `state.viewRotation` **已经在状态里**（`rotateView` 动作，
  原版存 `+0x2743`）—— 但它**不在 `stateFingerprint` 的白名单里**（`net/protocol.ts` 的 parts 只收
  turnCount/currentPlayer/日期/物价/rngState/玩家几项/地产/公库/樂透/道具/库存/牌堆/股市/持股/物件/
  pending），真要接投影的**成员**，**必须先把 `viewRotation` 纳入指纹**，否则一端转视角就能让 AI 的取舍
  分岔而对账看不见（协议注释里也写着这条前置）。
  ★ V-1a 之后 AI 的**次序**已经吃 `viewRotation`，那一条前置怎么办 —— 本轮核过：
  ① 联机里 `rotateView` 也是**动作**（`client/src/main.ts` 的 `rotateView` → `dispatch` → 定序器 →
  广播 → 全端重放），不是本地镜头；`Sequencer.submit` 只收当前回合那一座（`sequencer.ts:119`），
  被拒时本机状态也不动 ⇒ 两端**始终同档**（`visible-cell-order-mp.test.ts` ② 钉住这一点）。
  ② 万一哪天真分岔：次序变了 ⇒ AI 选到别的格 ⇒ action 串与 `rngState` 跟着变，而这两样**都在指纹里**
  ⇒ 会在那一拍现形（只是比「直接比 viewRotation」晚一拍）。故**没有**为此改指纹 / 升协议。
  真要把 `viewRotation` 也纳入指纹，得先回答「两个客户端各自转视角算不算合法」——那是需求方口径，
  见 `docs/escalations.md`。
- **FU-3 `0x4216ab` 的垃圾返回值**（T-7 / T-13）—— 未修，**静态定不出值**。
  追了一遍 `edx` 的来路：`0x4216ab` 只在「是我的」那支写 `mov edx,1`（`0x42170f`），
  「不是我的」直接落到 `0x421714 mov eax,edx / ret` ⇒ 返回的是**调用方手里那个 edx**。
  飛彈（`0x004217f9`）与核彈（`0x00421ff7`）对窗口清单第一项调用时，edx 最后一次被写是
  `0x40a0b1` 的收尾 —— `0x40a0a0 push 1 / call 0x409b18`（把那块窗口画到屏幕上）→ `0x40a0aa mov eax,esi`
  → `0x40a0ac jmp 0x40b33b`（只动 eax，**不动 edx**）⇒ edx = `0x409b18` 出口留下的值。
  `0x409b18` 有多条出口，而 `0x40a0a0` 压的实参是 1 ⇒ `0x409b3e` 那条「镜头没动就直接返回」的快路
  **走不到**；真正走的是 `0x409c61 / 0x409c70 / 0x409de2 → 0x40b33b`，而 edx 取决于循环**最后一次迭代**
  走的是 `0x409c97 je 0x409de1`（`mov dx,[...]` ⇒ 低 16 位 0）还是 `0x409dd9 call 0x456a1c`（画精灵 ⇒ 被调函数残值）。
  ⇒ 与运行时实体表 / 相机状态相关，**要真值只能在原版里跟一次**（Unicorn 或调试器）。
  影响面：只有「窗口第一件不是我的东西」那一次 `cmp eax,1`；若恰为 1，飛彈/核彈永不发射。
  本引擎按「不是我的就继续找、是我的才放弃」的**意图**做，与 FU-1 的窗口口径一起记 approx。
- **FU-4 `whoPlays == 3 / 4`**（V-2）—— 未修（会软锁，见下）。
  回合分派 `0x00418d6e push 0 / call 0x40c912` → `0x00418d78 cmp eax,5 / ja 0x418e7a` →
  跳表 `0x418c3d`：`[0] = 0x418d88`（who_plays 0 = 出局者推进游标）、`[1] = 0x4196f1`（真人）、
  `[2] = [5] = 0x418dc6`（电脑支）、**`[3] = [4] = 0x418e7a`（`pop ebp/edi/esi/ebx; ret`，什么都不做）**。
  而 `isAiControlled` 用的是**位掩码 6**（那是 `0x40b1ad` / `0x43c5fa` / `0x43d331` 这批
  「这个座位是不是电脑」的判据）⇒ `3`（真人|电脑）与 `4`（只托管）在两套口径下结论相反。
  不修的理由：照 `0x418e7a` 复刻 = 该座位这一回合**什么都不发生**、游标也不推进 —— 原版就此软锁；
  复刻禁止活锁（C-DET-4 与「AI 必须推进」的既有约定），要让它过去就得发明一条原版没有的推进规则。
  可达性：只有**读档**（`loaders/savegame.ts` 原样搬 `+0x15`）与复刻自己的「电脑行也点托管」
  （`client/src/ai-settings.ts:467` 把 2 变成 6）能造出来。
- **FU-5 预演顺延**（V-9 / V-12）—— 未修，附**可观测性实测**。
  原版 `0x441d98` 的 8 格循环：第一张过 `0x41e69e` 的卡**直接出**（`0x00441e00 call [0x475d5c+id*4]`，
  返回值不看，`0x441e07` 出栈返回）；本引擎先用 `canUseCard` 预演，不生效就试下一张。
  实测（`tools/audit/fu5-card-rehearsal-scan.ts`，seed 1..20 全电脑长局、每局 ≤4 万步）：
  判定函数肯出 **806** 次，预演挡下 **0** 次 ⇒ 合并后的 registry 已经能表达 AI 会选的每一个目标，
  这条偏差**当前不可观测**。
  真要修需要两样（都还没做）：① reducer 得能**非活锁地**收下一条「出了但没生效」的 AI 出牌
  （现在失败会让 AI 原样重提 ⇒ 活锁，这正是当初加预演的原因）；② 逐卡核 `consume_card(0x441343)`
  的 36 个调用点，确认原版在**失败分支之前**就扣卡（否则「失败也扣卡」会扣错）。

## 跨区发现（不属本区，未改）

- ~~**ai-econ**：`ai/policy.ts` 的 `chooseBuildTarget`「取第一个可选」/ `buildFacility`「不蓋公園、取最小非 0 种类」是自拟的~~
  —— **已修**（ai-econ 的 F15 / `2719f64`：托管走电脑支 `0x40b455` 挑地、`rand()%4+1` 定种类，`facilityType: null` 交 reducer 掷）。
- **文档**：`rich4-spec/tests/test_tool_dice_ai.py` 把 `+0x24` bits 12-15 注成「玩家占用」，实为惡人（玩家是 bits 8-11，`0x0043d59b`）；
  测试本身只铺位、不受影响。
