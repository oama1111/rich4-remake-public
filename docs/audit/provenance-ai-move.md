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
| fixed | 9（台账行；对应 7 处修复，V-10/C-27b、V-19/C-12 各是同一修复的两面） |
| approx | 6 |
| follow-up | 5（FU-1..FU-5，列在「跟进」一节） |
| n/a | 2 |

**修复（均已提交，均改变对局状态 ⇒ 需协调方统一升 PROTOCOL_VERSION）：**

1. **漲價卡比例门槛** 0.5 → **0.66**（`0x0042056e fcomp qword [0x463d38]`，常数 dump = 0.66）— `aad6335`
2. **漲價卡設施一支**：「目前最高等级」被原版写成了 `esi`（`0x004205f6 mov [esp+4], esi`）⇒ 常见情形只选**第一栋**合格設施（旧：最后一栋）；进门 `esi` 为 0 时整支落空 — `aad6335`
3. **拆除卡**：可见清单**一趟**扫完、地块 / 設施 / 物件按屏幕行序混排、第一个命中即停（旧：先扫完地块再扫物件）；可见物件清单排除附身物件 — `aad6335`
4. **遙控骰子**逐格判的是**格上有惡人**（bits 12-15），不是有玩家 — `293b6ce`
5. **路障阶段一**的「空格」按运行位：关押 / 住店 / 消失的人不占格 — `293b6ce`
6. **嫁禍卡（电脑）**无人可嫁时照样掷门槛 `rand()`（旧：少掷一次，随机流错位）— `1b3c7eb`
7. **开着保釋窗被托管的真人**：删掉自拟的「挑最便宜同伴」，按关窗处理 — `0e14efc`

联机镜像测试：`packages/server/src/audit-ai-move-mp.test.ts`（漲價卡 esi 残值 / 保釋关窗，服务器 = 单机同一手、重放指纹一致）。

## 台账

### V · 顶层调度、表、共用机制

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| V-1 | 「画面」可见集（候选成员与次序） | `ai/card-policy.ts:146` `inView` / `:151` `visibleEntities` / `:166` `visibleRivals` / `:184` `visibleObjects`；`ai/tool-policy.ts:160` `visibleNodeIds` | 0x409ef9、0x40a45c、0x409de7、0x407a2c、投影表 0x46ccf0（旋转 [0x499088]）、镜头 [0x48b2ac]/[0x48b2b0] | approx | 原版是**投影后的屏幕**：镜头 ±14 格 → 按旋转表投影 → 只留屏幕 0..440；次序 = 屏幕行序；精灵锚点：建筑 = 地块记录 (x,y)、玩家 = xpos/ypos、物件 = 节点，y−0x28。TS 用节点坐标 ±220 方窗、(y,x) 排序。D-005 已补写。见 FU-1 |
| V-2 | 谁由 AI 出手（who_plays 分派） | `state/types.ts:1829` `isAiControlled`（掩码 6）；`ai/policy.ts:109` | 0x40c912 返回 who_plays → 跳表 0x418c3d：1 真人 / 2、5 电脑支 0x418dc6 / 3、4、>5 什么都不做 | verified | 2 与 5（真人+託管）都进 0x418dc6 ✓。`whoPlays = 3` 原版不动、TS 当电脑 —— 只有读档可达，见 FU-4 |
| V-3 | 性格表 / f7 表逐字节 | `packages/data/src/characters.ts:134-145`、`cards.ts`、`tools.ts` | 角色表 0x47e80c（步长 0x68，+0x11 +0x12 +0x16..+0x1a）；卡片 0x47fdea+id×8 的 +7；道具 0x47fee1+id×8 | verified | 脚本 dump 对比：12 角色 × 7 字节、30 张卡 f7、13 件道具 f7 全等 |
| V-4 | 能力位：会出牌 / 会用道具 | `ai/personality.ts:62,65`；`ai/policy.ts:248,346` | 0x00441d09 `test [+0x16],1`；0x00447f87 `test [+0x16],2`（其前 `test dl,6`） | verified | |
| V-5 | 個性闸门 f7 − 個性 | `ai/personality.ts:198`；`ai/policy.ts:266,368`（`gateRoll`） | 卡 0x41e69e（[0x47fdf1+id×8]）；道具 0x420e9a（[0x47fee1+id×8]）；≥2 不做、==1 `rand()%3==0` 才做 | verified | 那次 `rand()%3` 用确定性替身（D-004，归 FU-2） |
| V-6 | AI 回合调度顺序 | `ai/policy.ts:154-169`；`state/reduce.ts:6811` `aiAdvance` | 0x00418dc6：`test [+0x15],0x30` → 0x42bf03 买股 → 0x42c79f 卖股 → 0x436b0a(0) → [0x46caf8] 终局码 → 0x4284be 公佈欄 → `rand()&1`：1 卡 0x441baa / 0 道具 0x447d97 → 0x4221c0 → 0x40dd1f | verified | 随机数消费点见 D-007 / FU-2 |
| V-7 | 用完卡/道具后被挡则不掷骰 | （无显式步骤） | 0x00418e36 `+0x32` dword / `+0x37` / `+0x36` 非 0 ⇒ 置 0x80 返回；0x00418e67 `[0x498ea2+cur×0x34]==1`（已在走）⇒ 跳过 | verified | 不可达：没有一张 AI 会出的卡/道具会把**自己**置进这几种状态；遙控骰子的「已在走」由 reducer 直接进 moving |
| V-8 | 出牌主循环 | `ai/card-policy.ts:1107` `cardsToConsider`；`ai/policy.ts:242` | 0x441262 数 15 格非空；0x00441d45 >8 张 `rand()%张数` 起环形、≤8 张从头；取 8 格、遇空停；第一张过闸即 `call [0x475d5c+id×4]` 后返回（一回合一张） | verified | |
| V-9 | 出牌前预演（`willWork`），接不住顺延 | `ai/policy.ts:262` | 原版 0x441e00 调效果后不看返回值直接结束 | approx | 既有偏差（同 Q-CARD-2 口径）：防活锁，见 FU-5 |
| V-10 | 填表后 `esi` 残值 | `ai/card-policy.ts:136` `cardLoopEsiAfterFill` | 0x00441d45..0x00441d96（≤8 张恒 8，>8 张 (起点+8)%张数）；0x441da2.. 不写 esi，闸门与判定函数保存 esi | fixed | aad6335（漲價卡用它，见 C-27b） |
| V-11 | 道具主循环 | `ai/tool-policy.ts:757` `toolsToConsider`；`ai/policy.ts:342` | 0x00447f90..0x00448085：13 格跳过槽 9（時光機）、>4 种 `rand()%种类` 起环形、最多试 4、遇空停、第一件过闸即执行 | verified | |
| V-12 | 用道具前预演（`toToolAction`） | `ai/policy.ts:393` | 原版过闸即 `call [0x475dd5+id×4]` | approx | 既有偏差：防活锁（同 V-9） |
| V-13 | 跳表缺席项 | `ai/card-policy.ts` `AI_NEVER_PLAYS`；`ai/tool-policy.ts` `AI_NEVER_USES` | 0x475324 第 5/6/18..21 项 = 0x41e6e3、第 40 项 = 0x420edf（`xor eax,eax; ret`） | verified | |
| V-14 | 前瞻 / 反瞻 | `ai/card-policy.ts:240` `lookahead`；`ai/tool-policy.ts:148` `backtrack`；`state/reduce.ts` `nextCandidates` | 0x40b221 / 0x40b343：n 封顶 8、邻接 4 槽跳 0 / 来路 / 封路位 0x40000000>>k；0 个回来路、1 个直走、>1 `rand()%n` 且置岔路 | verified | 岔路那次 rand 用替身（FU-2） |
| V-15 | 最恨的人 | `ai/card-policy.ts:83` `mostHated` | 0x40d2d3：who_plays≠0、非我、hostility 有符号严格大于（起点 0） | verified | |
| V-16 | 随机活跃对手 | `ai/tool-policy.ts:364` 内；`rules/toll-flow.ts:97` 内 | 0x40d31c：非我、who_plays≠0、`+0x32` dword == 0；空则 −1 且不掷 | verified | |
| V-17 | 值得拿 | `ai/card-policy.ts:295` `worthTaking` | 0x41e8e6 | verified | 同街扫 1..地块数，TS 地块本就 1 基 |
| V-18 | 同街住宅过路费 / 连锁店数 | `ai/card-policy.ts:215,230` | 0x419744（名字支，Σ租金[等级] × 物價 0x004197d8）；0x41970f | verified | 0x419744 名字为 0 的「连锁店×2000」支 AI 从不走（调用方都传名字） |
| V-19 | 可见物件排除附身物件 | `ai/card-policy.ts:184` | 0x00409e5b..0x00409e93（物件标记且 `+0x05`≠0 不画） | fixed | aad6335 |
| V-20 | 岔路选边 | `state/reduce.ts:824` `pickNextNode` | 0x0040c12c..0x0040c1a5：无 who_plays 分支，人机同一条 `rand()%候选` | verified | 归 loop；AI 无独立决策 |

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

- **FU-1 画面投影**（V-1、T-7、T-13）：要复刻得把镜头位置、旋转 `[0x499088]`、投影表 `0x46ccf0`（4×29×29×(int16,int16)）、
  `0x407a2c` 的格内偏移、精灵锚点（地块记录坐标 / `xpos,ypos` / 节点，y−0x28）、屏幕 440×440 截取与格子 OR 合并都搬进 core，
  并决定联机时旋转/镜头怎样进入确定性状态（原版 AI 的取舍随玩家视角变）。影响约 20 个判定函数的候选成员与「第一个」次序。> 半天。
- **FU-2 AI 的随机数不消费全局序列**（D-004 / D-007）：個性闸门 `rand()%3`、手牌 >8 / 道具 >4 的起点、前瞻岔路、
  冬眠 `%4`、天使 `%组`、改建 `%4+1`、夢遊 `%n`、機車/汽車 `%4`、工程車 `%15`、地雷/炸彈 `%候选`、飛彈随机对手、核彈 10 次、
  骰子数 `rand()&1` —— 原版都走全局 `rand()`，本引擎用 `aiRoll` 替身 ⇒ 电脑回合之后随机流与原版不同步。
  要把 AI 出牌/用道具/骰子数整段搬进 reducer（掷真随机数）才能消掉。> 半天。
- **FU-3 `0x4216ab` 的垃圾返回值**：「不是我的」出口 `mov eax, edx` 返回调用方的 `edx`。飛彈（0x004217f9）与核彈（0x00421ff7）
  对清单**第一项**调用时 `edx` 是 `0x40a0b1 → 0x409b18` 出口留下的值；若恰为 1，整窗都被当成「我的」⇒ 永不发射。
  需用 Unicorn 跑 0x409b18 的出口路径定值。
- **FU-4 `whoPlays == 3`**：原版分派表 0x418c3d 第 3 项 = 0x418e7a（什么都不做），`isAiControlled` 当电脑。只有读档可达。
- **FU-5 预演顺延**（V-9 / V-12）：原版过闸即出、效果失败也算用过这一手；复刻预演不过就试下一张/件。改成「照出、失败即止」需 reducer 对失败 action 有非活锁的收口。

## 跨区发现（不属本区，未改）

- **ai-econ**：`ai/policy.ts:583` `chooseBuildTarget`（托管真人「取第一个可选」）与 `:588` `buildFacility`（「不蓋公園、取最小非 0 种类」）是自拟的，
  电脑支原版是 0x40b455 挑目标 / `rand()%4+1`（0x0041a23e / 0x0040b1ad）—— 与 P-4 同类，建议同样按关窗或交 reducer 按电脑支。
- **文档**：`rich4-spec/tests/test_tool_dice_ai.py` 把 `+0x24` bits 12-15 注成「玩家占用」，实为惡人（玩家是 bits 8-11，`0x0043d59b`）；
  测试本身只铺位、不受影响。
