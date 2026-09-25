# 出处审计 —— loop（回合 / 游戏循环与走子）

分支 `ds/audit-loop`，2026-09-24。范围见 `wt28/AUDIT.md`（loop）：开局 / 回合开始 / 掷骰 / 走子 / 落点分派次序 /
回合收尾与游标 / 推日期与跨月的触发次序 / 交互归属 / 视角 / 胜负时机 / 随机数清单。
金额细节归 econ、卡片道具效果归 cards、事件归 events —— 这里只记接线与次序，跨区发现见文末。

每条都用 `tools/disasm.py` 重新开过 VA；表里「exe VA」是**这次亲自核过**的地址（现有注释里 VA 写错的已在备注里订正）。

## 摘要

台账 + 随机数清单共 86 行：

| 状态 | 行数 |
|---|---|
| verified | 64 |
| fixed | 18（15 处独立修正，含第二轮 F1/F2/F4/F5 与 startTurn 相位闸；R11/R17/L81 与台账行重复计入） |
| approx | 2 |
| follow-up | 0 行；下文 F3 一条（多行被挡框，纯表现） |
| n/a | 4 |

**修正清单**（全部改变规则态 ⇒ 需要协调方统一升 PROTOCOL_VERSION；本分支没有动它）：

1. **龜行（烏龜卡）对玩家是空卡** → 原版 `0x0040dd7e cmp [p+0x39],0 / jne 0x40dd40`：只走 **1 步、不进掷骰态、不 rand()**；遙控骰子留着；總步數沿用上一掷。
2. **龜行天数在关押期间照走** → `0x0041cafe jne 0x41cb6d` 与 `0x0041c965 jne 0x41ca8f` 两道闸都盖住 +0x39：关押中不走天、不清 0x80。
3. **释放那一天的冬眠 / 夢遊 / 龜行闸口径错** → 住宿 / 监狱 / 医院的释放 `0x40d6be` 不写计数（仍是 0x80，闸仍「关着」），只有消失 `0x40d4e5` 在 `0x40d52c` 清 0。
4. **保險期永不到期** → `0x0041cae3 test [p+0x3e],0x80 / mov [p+0x3e],0` 在 `0x0041cc4b` 递减之前 ⇒ `1 → 0x80 → 0`（先前只看了后半段）。
5. **保險期只在「可行动」的回合开头走** → 挪回 `0x41c84f`（同盟之后、神明任期之前），被挡的人也走。
6. **研究所倒数只在「可行动」的回合开头走** → 挪回 `0x41c84f` 末段 `0x0041cd8c..0x0041ce33`，被挡的業主也走。
7. **時光機快照拍在回合开头** → 原版只在起步 `0x0040dd53`（按 GO / 夢遊起步）、被挡的回合开头 `0x0040c97c`、傳送機传自己 `0x004477c3` 拍 ⇒ 時光機退回**上一次掷骰之前**；先前等于只能撤销本回合按 GO 之前的操作。
8. **真人开局资金按角色比例** → `0x004072ff test al,1 / je 0x4071d4`：真人 `现金 = 初始资金 >> 1`（`0x00407307`），只有电脑按 `+0x19` 比例。
9. **跨月不重摆禮物 / 寶箱（被拿走就永远消失）** → `0x0041d0a5..0x0041d0f6`：月結之后，禮物、寶箱各 `release_object` → `0x40aa6c(原格)` 远处挑格 → `place_object`。
10. **工程車永不到期** → `0x0041cca3..0x0041cd89`：`+0x11` 每天 −4，`(v & 0xfc)==0` 那天按 `+0x64/+0x65` 还原（没有就步行、1 颗骰）。写入 +0x64 那一侧归道具区（见跨区）。
11. **换人时清 `stepsTotal`** → `[0x48bafc]` 只在掷骰态 `0x0040d9b7` 写，龜行 / 传送落点的過路費乘数沿用上一掷。

**第二轮（协调方 2026-09-25 追加）**：

12. **联机可自选点数**（F1）→ 服务器 `Room.submit` / `submitSystem` 拒收带 `forced` 的 `rollDice`（`forcedDiceNotAllowed`）。原版点数只来自 `0x419572` 与遙控骰子 `[0x475dd8]`。commit 80c18ce。
13. **走回棋盘无条件清计数**（F4）→ 只在贴图位离格子 `dx²+dy² ≥ 1024` 时清（帧数 `trunc(d×0.125) ≥ 4`，`0x0040c276..0x0040c3cf`）。八张图实测最小 4356，实战恒清。commit 60ff4a7。
14. **住店前朝向不还原**（F2）→ `Player.savedFacing`（+0x1b）：住店存（`0x0040d61b` 自己 / `0x0040d68e` 当班者的），关押写 0xf（`0x0043d637`），走回棋盘收尾 `0x00418f2e` 还原；住店释放那一步朝向 = directionOf(格子 − 贴图位)（`0x40d6be` 同一支）。读存档接 +0x1b、+0x64/+0x65（开着工程車时 = `engineSaved*`），写档对称。commit 60ff4a7。
15. **停留 / 龜行也播预动作与滚骰**（F5，客户端）→ `requestRoll` 见 `rollsWithoutDice` 就当场 `rollDice`；`dice: []` 的回包收掉骰子动画（旁观端同一条路）。commit 9825930。
16. **`startTurn` 没有相位闸**（回放现形）→ 挂着落点问答 / 走子中再发 `startTurn` 会把回合从头再开（重掷）；联机当班座位可以利用。只在 `turnStart` 受理。commit b4af562。

另修一处**活性**（长局卡死，由修正 8/9 改变随机流后在 `full-game.test.ts` 种子 2024 现形）：落点付费付到破產时出口一律 `pending: null`，把破產清算开出的第一场下線拍卖丢了、队列却留着 ⇒ 之后 `awaitingDecision` 无人可答。改为出口保留拍卖（`bankruptLandingExit`）。归属见跨区。

测试：`state/loop-audit.test.ts`（10 例）、`server/src/loop-audit-mp.test.ts`（联机镜像 2 例）；按原版行为改写的旧测试：
`rules/time-machine.test.ts`（快照时机）、`places/insurance.test.ts` / `places/company.test.ts`（保險到期）、
`rules/facility-rules.test.ts`（研究所在交接时走）、`state/object-integration.test.ts`（禮物/寶箱会回来，只数唯一物件）、
`client/src/speech-coin.test.ts`（统计型断言：随机流变了，第二句占比 0.2→0.15、最长连 12→16 的界，意图不变）。

## 随机数清单（回合循环里每一次 `rand()`，按发生次序）

| # | 何时 | 次数 / 范围 | exe VA | 本引擎 | 状态 |
|---|---|---|---|---|---|
| R1 | 开局：新聞牌堆、命運牌堆洗牌 | 洗牌循环 | `0x004074bf` / `0x004074c4`（设定屏 OK 之后） | `newGame` → `createDeck` ×2 | verified |
| R2 | 开局：摆 8 件物件（1,3,5,7,9,11,13,14） | 每件 1 次 `% n` | `0x407d6a` 里 `0x40aa0f` | `newGame` 循环 | verified |
| R3 | 开局：可成交量 | 股本>1000 的每支 1 次 | `0x00407dfe call 0x42915a` | `refreshTradableShares` | verified |
| R4 | 开局：当天行情（非休市） | 见 econ | `0x00401ceb call 0x4291d6` | `tickStockMarket` | verified（次序） |
| R5 | 摆人（第 1 位开局、其余轮到时） | 2 次：起始格 `%n`、来路 `%邻格数` | `0x004082d9` / `0x00408328` | `drawStartPlacement` | verified |
| R6 | 每位玩家回合交接 `0x41c84f` 第一句 | 可成交量，每支 1 次 | `0x0041c868 call 0x42915a` | `beginActorTurn` | verified |
| R7 | 神明任期到期、搭档登场 | `0x40aa6c` 远处重抽（≥1 次） | `0x0041cc9b call 0x40e32c` | `tickGod` → `respawnPartner` | verified（次序）|
| R8 | 被挡的回合开头：坐牢 / 住院 / 冬眠台词 | 各 1 次 `&1`（冬眠要四项全 0） | `0x0040ca20` / `0x0040ca99` / `0x0040cb1b` | `rollBlockedSays` | verified |
| R9 | 电脑：公佈欄三道闸 | 见 ai-econ | `0x00418e13 call 0x4284be` | `aiNoticeBoardTurn` | verified（次序）|
| R10 | 电脑：用卡 / 用道具二选一 | 1 次 `&1` | `0x00418e18` | `aiAdvance` | verified |
| R11 | 掷骰 | `ndices` 次 `%6+1`（遙控骰子 / 龜行 / 停留 ⇒ 0 次） | `0x00419595`（`0x419572`） | `rollDice` → `rng/watcom.ts rollDice` | verified / **fixed**（龜行） |
| R12 | 每走一格选下一格 | 1 次 `% 候选数`（1 个候选也掷；0 个 ⇒ 不掷、回来路） | `0x0040c196` | `pickNextNode` | verified |
| R13 | 惡人一趟的步数 | 1 次 `%9+2`（停留 0 次、龜行 0 次） | `0x0040de50` | `npcTurnSteps` | verified |
| R14 | 惡人每走一格 | 同 R12 | `0x0040c52f` | `npcStepOnce` → `pickNextNode` | verified |
| R15 | 推日期：srand(GetTickCount) | 重播种 | `0x0041d066..0x0041d06e` | 宿主 `reseed`（`rng/host-reseed.ts`） | approx（不可复现的时钟，见 rng/policy.ts） |
| R16 | 推日期：行情 / 15 日開獎 | 见 econ | `0x0041d076` / `0x0041d094` | `advanceGameDay` | verified（次序） |
| R17 | 跨月：禮物、寶箱重摆 | 各 `0x40aa6c` ≥1 次 | `0x0041d0bb` / `0x0041d0e6` | `relocateMonthlyObjects` | **fixed** |

（落点 / 物件 / 事件 / 拍卖内部的 rand 归各自的区。）

## 台账

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| **开局** |||||
| L01 | 人数 = 设定 + 2；游标 0 | `rules/new-game.ts` newGame | `0x00407157..0x0040716c` | verified | |
| L02 | 初始资金档表 300000/200000/100000/50000/30000/10000 | `rules/setup.ts` GAME_INITIAL_FUNDS | `0x00407177`，表 `0x46cb94` dump | verified | |
| L03 | 真人现金 = 资金 >> 1；电脑 = trunc(ratio × 资金/100.0) | `rules/setup.ts` startingMoney, `new-game.ts:208` | `0x004072ff` / `0x00407307` / `0x004071d4`，`[0x463190]=100.0f` | **fixed** | 先前不分人机 |
| L04 | 牌堆初值 = 卡片表 initAmount；道具库存 1..8 | `new-game.ts` initialCardAmounts / initialToolStock | `0x004071a5` / `0x004071ba` | verified | |
| L05 | 自帶載具：traffic = 设置、ndices = +1、每人扣一件库存 | `new-game.ts` | `0x00407219..0x00407241` | verified | |
| L06 | 开局道具 1,2,3,4,8,9 各一件 | `rules/tools.ts` STARTING_TOOLS | `0x00407281..0x004072bb` | verified | |
| L07 | 玩家记录抄角色表、`+0x64` = 1 人 / 2 电脑、`who_plays` = 0（没上盘） | `new-game.ts` makeInitialPlayer | `0x004072e4` / `0x004072f9` | verified | |
| L08 | 人类数只在开局数一次 | `new-game.ts` humanPlayers | `0x00407247..0x00407250` | verified | |
| L09 | 惡人表、监狱/医院初始占用（小偷强盗在押、流氓间谍住院） | `special-actors.ts` | `0x00407319..0x00407363` | verified | |
| L10 | 勝利條件 / 遊戲時間 / 土地權限 / 物價 1 | `setup.ts` winConditionsOf | `0x00407369..0x004073b4`，表 `0x46cbe8`/`0x46cc00` | verified | |
| L11 | 开局次序：洗牌 → 载图摆物件 → 可成交量 → 行情 → 第 1 位摆人 | `new-game.ts` newGame | `0x004074bf`→`0x00401ce1`(`0x407d6a`,`0x407dfe`)→`0x00401ceb`→`0x00401cfe` | verified | |
| L12 | 摆人：候选 = `test [node+0x24],0x80ffff00` 且非孤立；2 次 rand；朝向 = 来路→起始格 | `rules/start-placement.ts` | `0x0040829d`、`0x0040aa0f`（候选存 byte：地图 ≤144 格，不截断） | verified | |
| L13 | 轮到没上盘的人才摆、`who_plays ← +0x64` | `start-placement.ts` landUnplacedPlayer, `reduce.ts:1139` | `0x00418c59..0x00418d22` | verified | |
| **回合开始** |||||
| L20 | 回合判定 `0x40c912` 返回码 0 / who / −1（夢遊）；quiet 版 | `rules/turn-start.ts` | `0x0040c912..0x0040cc19` | verified | |
| L21 | 6 路跳表：0 结束、1 真人、2/5 电脑、3/4/>5 返回 | `turn-start.ts` turnController | `0x00418d78..0x00418d81`，表 `0x418c3d` | verified | |
| L22 | 被挡框「○○住院中還剩 N 天」、`(v&0x7f)+1`（消失 `&0x3f`） | `reduce.ts` confinementNotice | `0x0040c9a4..0x0040cb98` | approx | 原版多项同时成立时拼成一扇多行框；本引擎只取第一项（五项同时成立极罕见，住宿+坐牢才可能） |
| L23 | 被挡台词 R8 | `reduce.ts:1535` | 见 R8 | verified | |
| L24 | 被挡（非 0x30）的真人拍時光機快照 | `reduce.ts` startTurn skip 支 | `0x0040c97c call 0x44808a` | **fixed** | |
| L25 | 夢遊 ⇒ 立刻起步（−1） | `reduce.ts` startTurn → rollDice | `0x0040cba5..0x0040cbb3` | verified | |
| L26 | 「走回棋盘」(0x10) 那一回合：一步、跑落点、不推游标 | `reduce.ts` startTurn 0x10 支 / endTurn | `0x0040dd37..0x0040dd4a`，`0x00418f07..0x00418f8e` | verified | |
| L27 | 走回棋盘收尾：朝向还原 `+0x1b & 0xf`（≠0xf 时） | `reduce.ts` endTurn 0x10 支、`Player.savedFacing` | `0x00418f2e..0x00418f3c`，写 `0x0040d61b`/`0x0040d68e`/`0x0043d637` | **fixed** | 第二轮 F2 |
| L28 | 走回棋盘收尾调 `0x40f381` / `0x448a7e` | — | `0x00418f59` / `0x00418f78` | verified | 关押格 0x1f41/0x1f42 不在 2001..5999，两者都空操作 |
| L29 | 走回棋盘清四项计数：帧数 `trunc(d×0.125) ≥ 4` ⇔ `dx²+dy² ≥ 1024` | `reduce.ts` startTurn 0x10 支、`WALK_BACK_CLEAR_MIN_SQ` | `0x0040c249..0x0040c3cf`，`[0x4631dc]` = f32 0.125 | **fixed** | 第二轮 F4（旧注释「≥ 2×步长」不准：要剩余 < 半程，n ≥ 4） |
| **回合交接 `0x41c84f`** |||||
| L30 | 游标：玩家 → 4..7 惡人（不在盘上的跳过）→ 绕回 0 才推日期 | `reduce.ts` endTurn / npcRoundStep / activeNpcSlots | `0x00418f93..0x0041902e` | verified | |
| L31 | 出局（who==0 且 xpos≠0）跳过；没上盘的照轮 | `reduce.ts:5854` nextAlivePlayer, `types.ts` isUnplaced | `0x00418fee..0x00419006` | verified | |
| L32 | 交接次序：可成交量 → 还款日 → 出局 / 终局码闸 → 四项阻碍 → … | `reduce.ts:1089` beginActorTurn | `0x0041c868` / `0x0041c86d` / `0x0041c875` / `0x0041c882` | verified | `[0x46caf8]` 终局码闸 ≡ phase gameOver |
| L33 | 还款日：≤3 天才处理（有符号；从没借过为负） | `reduce.ts:1159` checkLoanDue | `0x00436a5a..0x00436a94`，表 `0x436a4a` | verified | 金额归 econ |
| L34 | 还款提醒窗只给 `who_plays == 1`（整字节） | checkLoanDue | `0x00436969 cmp byte [+0x15],1` | verified | |
| L35 | 四项阻碍：0x80 ⇒ 释放；否则 dec，到 0 挂 0x80（消失 `&0x3f`） | `rules/blocking.ts` tickBlocking | `0x0041c88f..0x0041c955` | verified | |
| L36 | 释放函数：住宿/监狱/医院 `0x40d6be` 置 0x10、不写计数；消失 `0x40d4e5` 清 +0x33 | `reduce.ts:1191` tickActorDay | `0x0040d6d1`，`0x0040d52c` | verified | |
| L37 | 冬眠 / 夢遊 / 龜行的 0x80 清与递减都在「四项全 0」闸内 | `blocking.ts` tickTurnCounters | `0x0041c95e..0x0041ca85`，`0x0041caf7..0x0041cb6d` | **fixed** | 龜行先前不受闸 |
| L38 | 该闸读释放**之后**的四项（住宿等仍 0x80） | `reduce.ts` tickActorDay `confined` | `0x0041c95e` 在 `0x0041c89b call 0x40d6be` 之后 | **fixed** | |
| L39 | 停留 / 拒貸 / 暂停放款：0x80 清、递减（不受闸） | tickTurnCounters | `0x0041ca8f..0x0041cab7`，`0x0041cb6d..0x0041cbd9` | verified | |
| L40 | 夢遊醒：按 +0x66 还交通工具（道具栏有才还，3 直接还） | `reduce.ts` tickDailyCounters | `0x0041c9bc..0x0041ca72` | verified | |
| L41 | 同盟：0x80 ⇒ 解除；否则双方各 −20×物價敌意再 dec | tickDailyCounters | `0x0041cace` / `0x0041cbdc..0x0041cc41` | verified | |
| L42 | 保險期：0x80 ⇒ 0；否则 dec，到 0 挂 0x80；不受闸 | tickDailyCounters, `blocking.ts` tickInsuranceDays | `0x0041cae3..0x0041caee`，`0x0041cc4b..0x0041cc66` | **fixed** | 先前永不到期、且只在可行动回合走 |
| L43 | 神明任期 | tickActorDay → tickGod | `0x0041cc6c..0x0041cca0` | verified | |
| L44 | 工程車 −4/天，到期按 +0x64/+0x65 还原 | `reduce.ts:1275` tickEngineVehicle | `0x0041cca3..0x0041cd89` | **fixed** | 暂存写入侧见跨区 |
| L45 | 研究所：業主 == 游标+1、项目>等级作废、否则 dec，到 0 发道具（项目+8） | `reduce.ts:8383` tickOwnResearch（由 tickActorDay 调） | `0x0041cd8c..0x0041ce33` | **fixed** | 先前只在可行动回合 |
| L46 | 惡人交接：四个字节 0x80 清 / dec | `special-actors.ts` tickNpcCounters | `0x0041ce39..0x0041cf57` | verified | |
| L47 | 推日期里开出拍卖 ⇒ 打完才交接 | `reduce.ts:1122` afterDayRollover | `0x0041902e` 阻塞调用 | verified | |
| **掷骰 / 起步 `0x40dd1f`** |||||
| L50 | 起步第一件：時光機快照（bit0） | `reduce.ts:1745` | `0x0040dd53` | **fixed** | |
| L51 | 停留 ⇒ 不走、回合结束，不 rand | `reduce.ts` rollDice | `0x0040dd64..0x0040dd7c` | verified | |
| L52 | 龜行 ⇒ 1 步、不掷骰 | `reduce.ts:1759` | `0x0040dd7e..0x0040dd85` | **fixed** | |
| L53 | 掷骰：ndices 次 `%6+1`；遙控骰子 ⇒ 1 颗 = 指定值、读后清 | `rng/watcom.ts` rollDice | `0x00419572..0x004195b3`，`0x00447285` | verified | |
| L54 | 總步數 `[0x48bafc]` 只在掷骰写 | `reduce.ts` rollDice（不再在换人时清） | `0x0040d9b7`（唯一写者） | **fixed** | |
| L55 | ndices 热键：機車 1↔2、汽車 1..3，停留时不理 | `reduce.ts` setDiceCount | `0x004012a7..0x004012ff` | verified | |
| L56 | `rollDice.forced`（客户端给点数） | `reduce.ts` rollDice；`server/src/room.ts` 拒收 | — | n/a | 单机开发钩子；联机拒收（第二轮 F1，**fixed**） |
| **走子** |||||
| L60 | 候选：非 0、非来路、非封路位（bit30>>slot） | `reduce.ts:802` nextCandidates | `0x0040c12c..0x0040c17a` | verified | 封路位在 node+0x24 |
| L61 | 0 候选回来路；≥1 候选 rand | `reduce.ts:825` pickNextNode | `0x0040c17c..0x0040c1a5` | verified | |
| L62 | 朝向 = 0x454fb4(新格 − 旧格)，(0,0)→2 | `rules/direction.ts` | `0x0040c437 call 0x407a8c` → `0x454fb4`，表 `0x482414` | verified | 注释里的 `0x40d639` 是住店那一支，真正的走子朝向是 `0x0040c437` |
| L63 | 步数到格才 −1，落在格上（剩余 0）走落点 | `reduce.ts` step / applyArrival | `0x0040d932..0x0040d960` | verified | |
| L64 | 每格到达处理次序：銀行路过（有步数、非夢遊、格上非路障）→ 乞丐（停下才施捨）→ 身上炸彈 → 格上物件 | `reduce.ts:3366` applyArrival | `0x0041b53f..0x0041b5ab`，`0x0041b5fd..0x0041b694`，`0x0041b697..`，`0x0041b7ef` | verified | 各项内容归 econ/cards |
| L65 | 跟班物件随人换格 | objects 按 godInfo 附着 | `0x0040c1cc call 0x40fc00` | verified | |
| L66 | 夢遊动画计数 | — | `0x0040c462..0x0040c47e` | n/a | 纯表现 |
| **落点 / 收尾** |||||
| L70 | 走完先问 quiet 回合判定，被挡整段落点不进 | `reduce.ts` settle | `0x00418e81..0x00418ead` | verified | |
| L71b | 回合开始只在游标推进后进一次（不能中途重开） | `reduce.ts` startTurn 相位闸 | `0x00418ebd` → `0x00418c55` | **fixed** | 第二轮，回放现形 |
| L71c | 停留 / 龜行不起预动作、不播滚骰 | `client/src/main.ts` requestRoll / applyAction，`dice-roll.ts` rollsWithoutDice | `0x0040dd64` / `0x0040dd7e`（不进 `0x0040d975` 掷骰态） | **fixed** | 第二轮 F5 |
| L71 | 落点分派：夢遊且 type≠0 ⇒ 全不跑；17 路跳表 | settle | `0x0041986c..0x004198b2`，表 `0x4197e9` | verified | |
| L72 | 类型 0 收尾块：顯靈 → `0x448a7e` → 研究所面板 | `reduce.ts` landingTailDue / labPanelTail | `0x0041b077..0x0041b109` | verified | |
| L73 | 电脑回合次序：买股 → 卖股 → 特別融資收回 → 终局闸 → 公佈欄 → 卡/道具二选一 → 被挡则结束 → 已在走子则返回 → 骰子数 → 起步 | `reduce.ts:6905` aiAdvance | `0x00418dc6..0x00418e75` | verified | 各步内容归 ai-* |
| L74 | 電腦分支里 0x30 的人直接起步 | startTurn 0x10 支 | `0x00418dd8` | verified | |
| L75 | 交互归属：`cmp [+0x15],1` 精确比较（託管 5 = 电脑）/ `test 6` 判电脑 / `test 1` 判拍快照 | `types.ts` isAiControlled、各 pending 构造 | `0x00436969`，`0x0043c5fa`，`0x004480a0` | verified | 抽查；逐条在各区 |
| L76 | 託管位由 `[0x46caff]` 在交接时清 0 号玩家 bit2 | `reduce.ts` setAi | `0x00419008..0x00419023` | approx | 原版是单机热键；本引擎走 setAi action |
| **推日期 `0x41cf67`** |||||
| L80 | 日期 +1、跨月返回 1；闰年只判 %4；月长表 | `rules/calendar.ts` | `0x00452117`，表 `0x47638f` | verified | |
| L81 | 總天數 +1 → 勝負判定（达成则当日全不走）→ 物價 → 公佈欄天龄（死数据）→ 暂停倒数 → 12 支倒数 → srand → 行情 → 節日配乐 → 15 日分紅/開獎 → 跨月（月結 → 禮物寶箱重摆 → 總月數）→ 地契/查封每日 | `reduce.ts:5583` advanceGameDay | `0x0041cfa1..0x0041d197` | verified / **fixed**（禮物寶箱） | |
| L82 | 跨月重摆禮物 / 寶箱 | `rules/monthly-objects.ts` | `0x0041d0a5..0x0041d0f6` | **fixed** | |
| L83 | `[0x46cb06]` 低 4 位倒数（音乐） | — | `0x0041cf6c..0x0041cf99` | n/a | 纯表现 |
| **胜负** |||||
| L90 | 只在推日期判；两条都 0 不判；首富只从在场者选、平手取先；资产 0 则天数条件不生效 | `rules/victory.ts` checkVictory | `0x0041d89e..0x0041d915` | verified | |
| L91 | 收尾：游标 = 赢家、其余 who=0、终局码 | victory.ts clearLosers / victoryEndCode | `0x0041d915..0x0041da55` | verified | 「单人类局电脑赢」读档框 = approx（Q-SETUP-1） |
| **视角** |||||
| L95 | 8 档、`&7` | `rules/view.ts` | `[0x499088]`（`0x004195c6` 取用） | verified | |

## Follow-up

- ~~F1 联机自选点数~~ → 第二轮已修（服务器拒收）。
- ~~F2 住宿释放后朝向还原~~ → 第二轮已修。
- **F3 被挡框多行**（L22）：多个阻碍同时成立时原版一扇框拼多行（`0x457110` 追加）；目前只显示第一项。纯表现。
- ~~F4 走回棋盘清计数的条件~~ → 第二轮已修。
- ~~F5 客户端龜行 / 停留的滚骰动画~~ → 第二轮已修。
- **F6 回放报告**：见下一节。

## 回放报告复核（`rich4-remake/feedback/`，97 份，第二轮 F6）

做法：同一份 `base` + `trail`（逐条带宿主种子，`replayTrail`）分别用**审计前**（`ebf7854`）与**本分支**两套 core 重放，
逐条比较去掉纯表现字段（`last*` / `notices` / `snapshots` / `stepsTotal` / `savedFacing`）之后的整份状态，并核对终点指纹。

| 类别 | 份数 | 说明 |
|---|---|---|
| 审计前就能按指纹复现、本分支**逐条完全一致** | 11 | 20260922-122902811、20260922-195857499、20260923-023156297、20260923-161844067、20260924-021342002、20260924-105216869、20260924-143446983、20260924-143640603、20260924-144046048、20260924-144217689、20260924-234350490 |
| 审计前能复现、本分支终点指纹仍一致、中途有差 | 1 | 20260924-223238961：**只有** `insuranceDays` 不同（#11 起：保險期改在交接时走 + 次日到期），不进指纹、没有连带 —— **预期** |
| 审计前就对不上报告指纹（报告出自更早的版本，旧代码重放已有大量被拒 action） | 85 | 不能用来判断本分支；其中 6 份两套代码逐条一致 |

85 份不可复现报告里，两套代码的**首个分歧**只有三类（逐份跑 `both.ts` 看首个新出现的字段）：
① `players[*].insuranceDays`（保險时机 / 到期 —— 预期，20260922-2005xx..2010xx、20260924-0440xx、20260925-0300xx/0301xx）；
② `facilityResearchDays` / 研發道具早一拍到手（研究所改在交接时走 —— 预期，20260924-1818xx/1819xx、20260925-030128992）；
③ **`startTurn` 在非 `turnStart` 相位被受理**（旧代码把回合从头再开）—— 这是**真 bug**（这些已失步的轨迹里，旧代码把错位的 `startTurn` 当真执行），已修（上文第 16 条）。加了相位闸之后这些报告被拒的 action 数有增有减，属于已失步轨迹的正常表现。
没有发现别的分歧来源；能复现的 12 份里没有一份因本分支改变终点指纹。

## 跨区发现（不在本区修）

- **cards（道具 12 工程車）**：用工程車时原版把旧交通方式 / 骰子数存进 `+0x64 / +0x65`（`0x00447a49` / `0x00447a55`），并在 `0x004479e2` 用 `(traffic & 3) == 3` 判「已在开」。本引擎 `useVehicleTool` 没存（字段 `Player.engineSavedTraffic / engineSavedDice` 已加，到期还原与读写存档两侧已接）⇒ 在游戏里开的工程車到期一律还原成步行，本该骑回原来那辆。
- **cards（道具 11 傳送機）**：传自己时原版先拍時光機快照（`0x004477c3 call 0x44808a`），本引擎没拍。
- **econ（保險）**：理赔闸 `+0x3e != 0`（`0x0044ba74`）不变；本分支只改了到期（L42），金额与投保（`0x0041ac6e` `(v+天) & 0x7f`）照旧。econ 若有依赖「永久理赔」的测试 / 推理需要跟进。
- **econ（破產）**：落点付费付到破產的两处出口（`reduce.ts` 的 `companyExit` 与建設公司 `buildTarget` 那一支）先前 `pending: null` 丢拍卖 ⇒ 卡死；已改走 `bankruptLandingExit`（只修活性）。其它把 `pending` 清成 null 的出口是否也会吞掉清算拍卖，请 econ 过一遍（`grep "pending: null"`）。
- ~~存档 +0x64/+0x65~~：第二轮已接（开着工程車时读写 `engineSaved*`；`+0x65` 的写者是 `0x00447a55`，`save-writer.ts` 旧表里「无写者」已订正）。
