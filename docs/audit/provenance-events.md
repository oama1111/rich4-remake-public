# 出处审计台账 —— events 区

> 范围：新聞 / 命運（抽牌、可行性、每一条的目标 / 效果 / 金额 / 随机数）、神明（出场、附身、任期、离身、逐神效果、老虎机）、
> 四大惡人与乞丐 / 敌意、关押（監獄 / 醫院 / 旅館 / 消失 / 冬眠 / 夢遊 / 停留）、特殊格与场所（落点跳表、得点、抽卡、
> 魔法屋、探監保釋、傳送機、時光機、走回棋盘）、小游戏的 core 侧。AI 选择归 ai-move / ai-econ，銀行 / 股市 / 樂透金额归 econ。
>
> 方法：每一条逐个 VA 用 `tools/disasm.py` 重新读过（不信既有 `@source` 注释），按分支 / 常量 / 位宽 / 次序 / 读谁 / 随机数次数与先后核对；
> 不符的按原版改、加单测（先红后绿）、有状态变化的加联机镜像用例（`packages/server/src/events-audit-mp.test.ts`）。
>
> ★ **第二轮（2026-09-25）**：收尾第一轮留下的 FU-1 / FU-3 / FU-5 —— 台词阶梯里的 `rand()` 从客户端状态哈希
> 改成 core 在 exe 掷的那一刻掷（新增 `rules/speech-rand.ts` 的站点表 + `GameState.lastSpeechRolls`，
> 客户端 `speech-roll.ts` 查它），并补上三处联机镜像用例。逐站点见文末「台词随机」表；
> 它对随机数消耗与协议的影响见「状态变化 / 协议」。

## 摘要

| 状态 | 条数 |
|---|---|
| verified | 121 |
| fixed | 83 |
| approx | 13 |
| follow-up | 3 |
| n/a | 2 |
| **合计** | **222**（多条同构的规则合并成一行；第二轮新增「台词随机」15 行 —— 13 个站点 + 过路费三句 / 消失各一行） |

**第二轮（2026-09-25，FU-1 / FU-3 / FU-5 的收尾）后的变化**：`fixed` 58 → 83
（原有 5 条 `approx` + 5 条 `follow-up` 转 `fixed`，另加新增 15 行）；`approx` 18 → 13（少 N-owner-say / N-08s / G-10 / G-13a / C-30）；
`follow-up` 8 → 3（少 C-19 / F-mh / G-13b / T-05 / T-06，剩 G-06 / G-24 / P-37）。

### 修正清单（按提交）

- **d679e70 特殊格 / 魔法屋 / 探監 / 傳送機**：抽卡格与福神满手弃牌回牌堆（`0x004413a2`）；魔法屋坐牢 / 住院过免罪·嫁禍（`0x00431e54` / `0x0043240d`）；
  魔法屋就地拆除是 `0x40ab4a` mode 0 两支（連鎖店写回种类、設施拆到 0 清种类并放人）；魔法屋得卡按 `0x4412e4`；电脑保釋惡人要把他摆到门口（`0x0043d580 call 0x43d7bf`）；
  傳送機住宅搬到期日、清源头上次過路費（`0x00447546..0x00447553`），搬人后跟班同格（`0x00447844 call 0x40fc00`）。
- **d9843d6 命運**：1 徵收赔地价、收走地与地契（先前赔 0、地还归自己）；3 跳票看加持、字节回绕；4 挪用他人存款一成（先前什么都不发生）；
  5 电脑寿星牌堆记账、去掉借错出处的「搶得」框；6/7 已在外的人续期；12/13 住院前毁车。
- **88034b4 新聞**：挑牌后的随机流写回（新聞 7 开拍不再重掷挑地那一格）；11/12/13 付不起当场破产；24/25 当场改价；20 颱風走 damage_area 轻击内联；
  4 窗内惡人进醫院、地上物件放回；4/5/19 清地契；6/14 地价 16 位。
- **8644694 神明**：老虎机自动转 4 轮（电脑 / 託管 / 夢遊）；小財神一人破产后照收；大衰神弃半框；土地公強佔敌意求值次序；
  离身搭档参照附身者当前格；惡犬先挑搭档格再住院；福神代蓋空設施选完才掷台词 rand。
- **6706210 关押 / 保釋 / 住店 / 時光機**：放出当天冬眠·夢遊·龜行不走；加刑不写占用表；真人保釋点券够赎金即可、减被保者敌意；
  住店先清旧关押、记当前玩家敌意、死神换人住店走支 B；時光機快照点改到起步 / 被挡回合 / 搬自己。
- **757e7de 惡人 / 乞丐 / 敌意**：夢遊不偷；只小偷强盗偷；偷最低位且出局即止；流氓间谍只在停步那格；路障拦下后尾段照跑；惡犬咬惡人；
  老家看 +11、先偷后回；拆陷阱先回库存；夺卡记牌堆与满手弃牌；间谍取盈余由企业付；乞丐先破产后挪位、重算来路；敌意 32 位回绕。
- **ce08a41 cards 审计交来的跨区项**：首次关押倒霉台词 rand（命運 / 新聞 / 魔法屋 / 住店）、小偷禮物台词 rand、魔法屋拍卖流拍不清地主。
- **b0e23df / 350cfb1**：联机镜像用例；与 `ds/audit-provenance` 合并（同一修复取对方写法，各自独有的保留）。
- **5f14c39 第二轮 FU-1（台词随机全部收进 core）**：台词阶梯里的 `rand()` 原先由客户端对状态做哈希当硬币（`speech-coin.ts`）、
  **不推进** core 的随机流 ⇒ 每说一句，之后的随机事件就与原版错开一格。现在一律在 exe 掷的那一刻由 core 掷（推进 `rngState`），
  原值按先后记进纯表现瞬态 `lastSpeechRolls`；客户端 `speech-roll.ts` 按站点 + 说话人查它。13 个站点逐条见新表「台词随机」。
- **5f14c39 FU-3（魔法屋「抽取命運三張」遇真人寿星）**：抽到命運 5 而中签者是真人 ⇒ 原版那扇选牌窗是**模态**的，
  挑完才回到 `0x00431dbc` 的循环抽下一张。现在把剩余张数 / 收卡人 / 施法者挂进 `pending.birthdayCard`
  （`receiver` / `magicResume`），最后一位答完接着抽、接着演其余中签者，最后还原施法者。
- **5f14c39 FU-5（前半）**：大福神袋空 / 只剩一张时**照样**弹两卡名框、照样说那句（`0x0040eea8` 连调两次 `0x441e12`
  且不看返回值；卡号 0 的名字指针 `[0x47fdea]` 与點數价 `[0x47fdef]` 都是 0）。后半（老虎机窗显示金额）仍未改，见 FU-5 剩项。
- **d2e347c**：客户端那一侧改查 core 掷出来的值（`speech-coin` 退役 → `speech-roll`，附单测）；
  **467f899**：三处联机镜像用例（新聞 19 房主 / 命運 5 寿星 / 魔法屋 FU-3 续演）+ 拍卖用例换种子。

与 provenance 分支上其它区**重叠**的修正（合并时取了对方写法）：敌意回绕（cards）、龜行闸 / 時光機快照点 / 保險与研究所倒数挪到 0x41c84f（loop）、
傳送機地契与自搬（cards）、奪卡 / 福神 / 抽卡格牌堆守恒（cards 的 `conserveCardPool`）、乞丐占用位（cards 的 `occupantsOfNode`）、小財神破产后照收。

### 状态变化 / 协议

**改变游戏状态与随机数消耗**（需要 PROTOCOL_VERSION 升一次，本区未升）：新增可选字段 `SpecialActor.home`（存档 +11 读写）、
`pending{auction}.keepOwnerOnPass`、notice key `god.lostHalf`；随机流变化点：老虎机 16 次、新聞开拍接续、稅類 / 神明 / 施捨破产拍卖、
首次关押台词、小偷禮物台词、惡犬咬惡人后搭档登场、新聞 4 物件放回。

★★ **第二轮追加（同样要协调方那一次升版，本区仍未升）**：

- **随机数消耗变了（这是本区第二轮的主要影响）**：台词阶梯那 13 个站点先前在 core 里**一次都不掷**（客户端哈希当硬币），
  现在改成在 exe 的位置各掷一次 `rand()`（`0x0044f280` / `0x0044f312` / `0x0044f3d1` / `0x0044f4a7` / `0x0044f525` /
  `0x0044f5e1` / `0x0044f67b` / `0x0044bf86` / `0x0044c5ad` 与新聞 5/15/19/21 的 `0x004494b4` 等）。
  同一条 action 之后的所有随机事件因此与原版**对齐**，但与**旧客户端**（不掷那一格）重放会算出不同的 `rngState` ——
  `rngState` 在 `stateFingerprint` 里 ⇒ **不升 `PROTOCOL_VERSION` 会当场判失步**。
- **状态形状变了**：`GameState` 新增纯表现瞬态 `lastSpeechRolls`；`pending.birthdayCard` 新增可选 `receiver` / `magicResume`
  （`pending` 整个进指纹 ⇒ 这一项两端必须一起升级）；大福神袋空那一支的 `players` / `cardAmount` / notices 也与先前不同。
- **`lastSpeechRolls` 是纯表现瞬态，不进指纹**：`stateFingerprint`（`packages/core/src/net/protocol.ts:798`）**显式列出**
  参与校验的字段（回合 / 日期 / 物价 / `rngState` / 玩家六项 / 地权 / 公库 / 樂透 / 道具 / 股市 / 持仓 / 物件 / 相位），
  里面**没有** `lastSpeechRolls`；`packages/server/src/events-audit-mp.test.ts` 有闸（抹掉 / 清空它指纹不变）。
  与 `lastGodLine` / `lastGainSays` 同一条口径：瞬态提示由最外层 `reduce` 出口整份覆写、不进存档 ——
  旁观端 / 断线重连端缺了这份提示不会被判失步，只是那一句按前一句（`speechCoin` 的 `null` ⇒ 0）。
- **旧存档**：`lastSpeechRolls` 缺省 `undefined`，客户端 `speechRand` 返回 `null` ⇒ 不说错话、不崩。

### follow-up（有证据、未改）

- **FU-1 台词随机（WP-3 口径）→ 已修（5f14c39 core / d2e347c 客户端）**：13 个站点全部收进 core，逐条见新表「台词随机」。
  无剩余项。
- **FU-2 傳送機搬惡人 / 物件 → cards 区已实现（`5256fa6`；本分支尚未合并，只记录引用）**：真人傳送機改成原版的两段拾取
  （先选来源：地塊 / 設施 / 玩家 / 惡人 / 物件，再选目标），新增 `teleportActorTo` / `teleportObjectTo`；
  来源拾取 `0x00447469 push 0x1200036`（类别 0x36、组字节 0 = 不设限）⇒ **源不看归属**，
  原先「空地（owner==0）不能搬」那条限制随之删掉；目标仍是子类 8（`0x004474f5 push 0x2090802` /
  `0x00447598 push 0x2090804` = 无主 0 级）；附身物件 ⇒ 改成搬它的附身者（`0x00447495..0x004474cd`）；
  第二段取消 `0x4479b3` 不扣道具。本分支只有引用，**未复核** cards 的实现与用例（跨区，不重复劳动）；
  另外 cards 那一提交没带 `packages/server` 的联机镜像用例 —— 见「跨区发现」。
- **FU-3 魔法屋「抽取命運三張」遇真人寿星 → 已修（5f14c39）**：见修正清单；镜像用例在
  `packages/server/src/events-audit-mp.test.ts`（挂 pending → 答完 → 接着抽两张 → 循环收尾）。
- **FU-4 住店走回棋盘那一回合的神明尾块**（`0x418f25..0x418f59 call 0x40f381`）：**仍是 follow-up**（本轮未动）；
  天使 / 惡魔 / 土地公在旅館格上生效；时序未逐拍核，信心中等。
- **FU-5 老虎机窗显示金额 → 剩项（后半）**：`0x43f68c` 那一半**仍未改** —— `client/src/god-slot.ts:292-315`
  依旧按「钱 / 存款 / 公库的差分」反推金额，没读 core 交出来的 `lastGodPower.amount`。
  「大福神袋空 / 1 张仍弹两卡名框」那一半已修（5f14c39）。
- **FU-6 惡人抢银行抢到破产**：**仍是 follow-up**（本轮未动）。原版在 `pay_money` 里当场破产（`0x41d375`），
  之后的步里对方已是出局者、破产拍卖的 rand 在后续步的 rand 之前；本引擎走完一趟再破产。

### 跨区发现

- **cards**：`answerBirthdayCard` → `applyRobCardCard` 的牌堆记账；送神符（`0x444cc4 call 0x40e32c`）离身参照格同 G-27；陷害 / 復仇卡关人不理赔（`0x43d749` 在 send_to_* 公共尾段）。
- **cards / 傳送機（`5256fa6`，第二轮核对时发现）**：那一提交**改了 core 规则**（新增 `teleportActorTo` / `teleportObjectTo`、
  源不再看归属、`teleportLand` / `teleportFacility` 删掉 `owner == 0` 的早退），但 `git show 5256fa6 --stat` 里
  **只有 `packages/client/src/*` 与 `packages/core/src/*`，没有 `packages/server/src/*mp*.test.ts`** ——
  按审计口径「改状态 / 改随机消耗的修复要有联机镜像用例」，这一条缺镜像；本区不代劳，转给 cards / 协调方。
- **econ / 破产**：破产清算拍卖流拍是否清地主（`0x40d1e3` 一带）未核；本区只给魔法屋那一场加了 `keepOwnerOnPass`。
- **stock**：命運 8 对 0 股持仓也调 `sell_stock`（跑 `0x4294d5`），本引擎跳过（无状态差，记录在案）。
- **文档**：`docs/deviations/Q-FORTUNE-1.md` 的神明加持表（19 应为罰金档、22 应为獎金档）；`state/types.ts:67`（命運 10/11 不走 `0x40cd07`，12/13 才走）；
  `fortune-effects.ts` 免付台词注释「(12/13/14)」应只有 14..；`docs/deviations/T-052.md:284`（关押那一处传的是天数不是金额）。
  ★ 第二轮：`docs/deviations/T-052.md` 的 **Q-SPEECH-3「新处置（WP-3，选项 b）」那一段已作废** ——
  那一段写着「不推进 `rngState`、旧回报重放指纹不变」「仍与原版不同的只剩掷出来是哪一面（取决于状态哈希）」，
  现在台词随机由 core 在 exe 的位置掷、推进 `rngState`（见新表「台词随机」）。
  该条末尾那条**全局结论**对**实时操作**那一半仍然成立（拍卖窗动画 4 处、小游戏玩法、老虎机、女巫窗动画按帧 / 按操作消耗 PRNG
  ⇒ 无头引擎不逐位对齐，见 MG-05 / M-05）；Q-SPEECH-3 的站点表本身与本表一致。
  ⚠️ **另外两处同源文字也随本轮变陈旧，本区不改（属 speech 区的文档）**：
  `docs/known-deviations.md:5041`（Q-SPEECH-3 摘要行：「客户端对进指纹的共享状态做哈希掷硬币（`speech-coin.ts`）… 不碰 core RNG」）
  与 `docs/audit/provenance-loop.md:52`（把 `client/src/speech-coin.test.ts` 列为「按原版行为改写的旧测试」—— 该文件已随本区退役，
  换成 `client/src/speech-roll.test.ts`）。请 speech 区 / 协调方一并订正。
- **全局**：`isAlive` 用 `whoPlays & 3`，原版各处 `cmp byte [+0x15],0` 整字节；只在高位（0x40 被炸）置位而低位为 0 时不同，目前不可达。

## 台账
### 新聞（news.ts / news-effects.ts / deck.ts / reduce.ts drawAndApplyNews）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| N-deck-1 | 牌堆 36 张，洗牌 `rand()%剩余` + 线性找未用槽，恰 36 次 rand | events/deck.ts:47-66 | 0x448b81..0x448bd2 | verified | |
| N-deck-2 | 洗完游标 = 0 | events/deck.ts:76 | 0x448bd6 | verified | |
| N-deck-3 | 只在新局洗，新聞先于命運 | rules/new-game.ts:402-403 | 0x4074bf / 0x4074c4 | verified | 全 exe 无重洗 |
| N-deck-4 | 抽牌：`deck[cursor]` → 判可行 → 可行才施加；游标 +1 回绕 36；直到可行 | events/deck.ts:104-118 | 0x44b718..0x44b7e3 | verified | |
| N-deck-5 | 整副不可行 | events/deck.ts:120 | 0x44b7e3 死循环 | n/a | 返回 −1 是安全替身，实战不可达 |
| N-deck-6 | 新聞格进可行性循环前不掷 rand | state/reduce.ts 新聞分派 | 0x44b6df..0x44b72b | verified | |
| N-deck-7 | pass 1 在等待 0x960 之后，等待不掷 rand | events/news-effects.ts | 0x44b862..0x44b875 | verified | 两阶段一次算完 |
| N-deck-8 | 挑牌那一次 rand 之后的随机流写回，开拍 / 破产接着掷 | state/reduce.ts drawAndApplyNews | 0x4497b7 → 0x4498a1 → 0x439f1c | fixed (88034b4) | 先前开拍重掷挑地那一格、结果又被外层 rng 覆盖 |
| N-feas-0/2 | 0/1 看 `dword [0x496b30]`；2/3 看 `dword [0x496b60]`（只槽 0..3） | events/news.ts:124-132 | 0x448c99 / 0x448cab | verified | |
| N-feas-4 | 4/5/15：有地块或設施 level≠0 | events/news.ts:134-137 | 0x448cb4..0x448d08 | verified | |
| N-feas-6 | 6/11/14/18..27/30..34 恒可行 | events/news.ts:170 | 0x448c75 / 0x448c24 | verified | |
| N-feas-7 | 7：有无主地块 / 設施 | events/news.ts:139 | 0x448d0a..0x448d52 | verified | |
| N-feas-8 | 8/9/12：有有主地块 / 設施 | events/news.ts:142-145 | 0x448d54..0x448da3 | verified | |
| N-feas-10 | 10/13：在场玩家有持股 | events/news.ts:147-149 | 0x448da5..0x448ded | verified | |
| N-feas-16/17 | 16 有徒步者 / 17 有乘车者（在场） | events/news.ts:151-154 | 0x448def..0x448e41 | verified | |
| N-feas-28 | 28：有停牌股（f6≠0） | events/news.ts:157 | 0x448e43..0x448e62 | verified | |
| N-feas-29 | 29：有主企業且 0x40d73f(主−1)（在场且 dword[+0x32]==0） | events/news.ts:161-164 | 0x448e64..0x448e9a, 0x40d73f | verified | 运行时归属 |
| N-feas-35 | 35：企業 `+0x28 > 10000`（有符号） | events/news.ts:166 | 0x448e9c..0x448ebb | verified | 运行时资金 |
| N-00/01 | 0 監獄全放（0x80、清占用）；1 在押者 (+3)&0x7f | news-effects.ts:675-701 | 0x448ef2..0x448ff5 | verified | |
| N-02/03 | 2/3 醫院同形（+0x35、0x496b60） | news-effects.ts:675-701 | 0x44903d..0x449135 | verified | |
| N-04a | 4：候选 = 有等级地块 + 有等级設施，`rand()%n` 挑爆心 | news-effects.ts 外星人支 | 0x44918d..0x4491e7 | verified | 空集原版除零，本引擎不动 |
| N-04b | 4：damage_area(0x64, 0x26, 重击, 攻击者 −1)，无敌意 | news-effects.ts | 0x449225..0x44922d | verified | |
| N-04c | 爆炸窗用地图坐标 | news-effects.ts | 0x40a45c | approx | 已登记 Q-TOOL-1 |
| N-04d | 重击住宅清 owner/level/type **与地契 +0x30** | news-effects.ts, reduce.ts applyMutations | 0x40ad6b..0x40ad77 | fixed (88034b4) | 先前地契不清 |
| N-04e | 重击設施清四项 + `0x40dffa` | news-effects.ts | 0x40ae45..0x40ae58 | fixed (88034b4) | 同上补 +0x34 |
| N-04f | 窗内玩家 0x40cd07（毁车、挂 0x40），之后逐人住院 3 天 + 理赔 | news-effects.ts, reduce.ts | 0x40cd07, 0x44926c..0x449285, 0x43edf8 | verified | |
| N-04g | 窗内惡人送醫院（0 天）、没附身物件 0x40e14d 放回（搭档登场要 rand） | reduce.ts alienBlastActorsAndObjects | 0x40aeb4..0x40aefc | fixed (88034b4) | 先前全缺 |
| N-05/15/19/21 | 挑一处（5/15 有等级、15 只地块、19/21 全部）`rand()%n` → mutate_land(1/0/1/0) | news-effects.ts:1100-1175 | 0x4492b8, 0x44a46b, 0x44a936, 0x44acb1 | verified | |
| N-05m | mode 1 清地契（住宅 +0x30 / 設施 +0x34） | news-effects.ts / reduce.ts | 0x40abba, 0x40ac46 | fixed (88034b4) | |
| N-15b | 15 可行性算設施、效果只挑地块 | news.ts:134 vs news-effects.ts | 0x448cb4 vs 0x44a49d | approx | 原版除零；本引擎不掷 |
| N-owner-say | 5/15/19/21 房主台词 `rand()&1` | reduce.ts drawAndApplyNewsInner（NEWS_OWNER_SITE）+ client speech-roll.ts | 0x004494b4, 0x0044a5b0, 0x0044ab00, 0x0044ae74 | fixed (5f14c39) | 见新表 SP-10..13；说话人 = 房主 − 1（`0x48c5a0`） |
| N-06/14 | 6/14 `rand()%(地+設施)`；地块支同名全改 ×1.3/×0.7 截断；設施只改挑中那一处 | news-effects.ts:805-830 | 0x4494f8..0x449721, 0x44a238.. | verified | |
| N-06w | 地价存回是 word（16 位回绕） | news-effects.ts | 0x44967b / 0x449721 | fixed (88034b4) | |
| N-07 | 7：挑无主地/設施 `rand()%n`，pass 1 `auction_entry(-1, 实体, 1)` 无卖家 | reduce.ts drawAndApplyNews | 0x44974c..0x4498a1 | verified | 拍卖内部属 auction 审计 |
| N-08/09/10 | 第一大地主 / 土地最少 / 股市大户：只在场、严格比较（并列取前）、金额 10000/5000/10000×物價进现金 | reduce.ts newsTargets | 0x4498df..0x449c61, 0x449a4c..0x449a5c | verified | |
| N-08s | 8/9/10 進帳台词（0x44f354 中间档 rand） | reduce.ts drawAndApplyNewsInner | 0x449a80 / 0x44f3d1 | fixed (5f14c39) | 见 SP-03；受奖人 = `affected[0]`、原额 = `out.amount` |
| N-11/12/13a | 先逐人算份额（所得 5% 现金 / 地價 5%×物價 / 證交 float32 累加 5%×物價） | percentage.ts, news-effects.ts | 0x449cee.., 0x449e6c.., 0x44a0dc.. | verified | |
| N-11/12/13b | 第二趟逐人 `pay_money(i,-1,份额,0)`，付不起**当场破产**，每人前查终局码 | reduce.ts drawAndApplyNews（NEWS_TAX_IDS） | 0x449dad..0x449ddb, 0x44a1e7..0x44a215, 0x41d375 | fixed (88034b4) | 先前只记旗、人不出局；拍卖阻塞次序见 approx 注 |
| N-16/17 | 徒步 / 乘车者 `+0x38 = 1` | news-effects.ts:1285-1298 | 0x44a604..0x44a6d3 | verified | |
| N-18 | 地震：`rand()%(地+設施)`；同名地块 mode 0；設施只它自己 | news-effects.ts:1045-1097 | 0x44a6f8..0x44a8ee | verified | |
| N-20 | 颱風：挑一处、damage_area(0x64, 6, 轻击, −1) | news-effects.ts typhoonBlast | 0x44ab43..0x44ac43 | verified | |
| N-20b | 轻击走 damage_area 内联：0 级設施也清种类并放人、0 级带种类地块也清种类 | news-effects.ts typhoonBlast | 0x40ad1c..0x40ad38, 0x40adf5..0x40ae0d | fixed (88034b4) | 先前用 mutate mode 0（0 级不动） |
| N-22 | 銀行擠兌：在场者 `+0x3c = 15` | news-effects.ts:1266-1270 | 0x44aeb4..0x44aed2 | verified | |
| N-23 | 儲金紅利：无贷款者 trunc(存款×0.1) 进存款 | reduce.ts / news-effects.ts | 0x44af36..0x44af66 | verified | |
| N-24/25a | 12 支股票 newsFlag = 1 / 0x10（赋值） | news-effects.ts | 0x44b031..0x44b092 | verified | |
| N-24/25b | 写完当场 `0x429040(0)` 重算今日价/趋势/当天历史 | news-effects.ts | 0x44b049 / 0x44b094 | fixed (88034b4) | |
| N-26 | 休市 10 天 | news-effects.ts | 0x44b0c6 | verified | |
| N-27/28 | 27 `rand()%12` 停牌 15 天、价=开盘；28 在停牌股里挑一支复牌 | news-effects.ts:1350-1372 | 0x44b0e7..0x44b24d | verified | |
| N-29 | 違法超貸：挑有主企業 `rand()%n` → 0x441210（免罪/嫁禍）→ 坐牢 5 天 + 理赔 | news-effects.ts:741-790 | 0x44b272..0x44b362, 0x441210 | verified | 真人持嫁禍一律放弃（D-003/D-008，approx） |
| N-30..35 | 企業罰款/投資/獲利加倍：金额、flag、`0x429040(股+1)` | news-effects.ts:1185-1242 | 0x44b389..0x44b6ce | verified | |
| N-dead | 新聞 prison/hospital 理赔循环 | reduce.ts drawAndApplyNews | — | n/a | 死代码（无 news 条目带该效果） |

### 命運（fortune.ts / fortune-effects.ts / reduce.ts drawAndApplyFortune）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| F-deck-1..5 | 37 张、洗牌同新聞、抽牌游标回绕 37 | events/deck.ts | 0x44baef, 0x44bb1a..0x44bb3f, 0x44dbba..0x44dcc6 | verified | |
| F-deck-6 | 整副不可行 | deck.ts:120 | 0x44dcc6 | approx | 不可达 |
| F-deck-7..12 | 重映射后的号施加；pass 0 只有 0/1 掷 rand；33..36 按 `[0x4991b8]` 跳板；命運格 / 魔法屋三张（cur = 中签者）；判定读当前玩家 | reduce.ts drawAndApplyFortune | 0x44dbfe, 0x44dc44/0x44dd5d, 0x44dc87, 0x41b128, 0x431dba, 0x44bb4b | verified | |
| F-chk | 0/1 地块 owner/level；5 他人手牌和；8/9 有持股；10..16 按交通重映射；33..36 `word[0x4991b6]==0`；其余可行 | events/fortune.ts:96-144 | 0x44bbe7..0x44be0f | verified | |
| F-bl-1..6 | 神明加持三档（獎/罰/劫）、中间档才 rand、各事件档位、2 档不提示集合 | rules/blessing.ts, fortune-effects.ts:98 | 0x44b8c1..0x44ba03 等 | verified | Q-FORTUNE-1 文档表过期（见 cross-area） |
| F-00 | 強制拆除：候选自己的有等级地块、`rand()%n`、赔 level×房价（u16，不乘物價）进现金、level/type=0 | fortune-effects.ts, reduce.ts | 0x44be2d..0x44bf42 | verified | 台词 rand 已进 core（SP-08，5f14c39） |
| F-01 | 強制徵收：赔**地价** word[+0x1c]（不乘物價）、清 **owner 与地契**，level/type 不动 | fortune-effects.ts, reduce.ts | 0x44c0b6..0x44c0d2 | fixed (d9843d6) | 先前赔 0、地还归自己 |
| F-02 | 冒貸 10000×物價、罰款档 1 作废 2 加倍、+0x24、到期日、理赔 | fortune-effects.ts, reduce.ts | 0x44c0fe..0x44c218, 0x433b7e | verified | |
| F-03 | 支票跳票：档 1 作废；`add byte` 30 | fortune-effects.ts bankBan | 0x44c28d, 0x44c2ba | fixed (d9843d6) | 先前不看加持、不回绕 |
| F-04 | 侵入銀行電腦：他人存款 trunc(×0.1f)，pay_money(他→我, flags 4) | fortune-effects.ts FORTUNE_BANK_HACK | 0x44c342..0x44c3a3 | fixed (d9843d6) | 先前 unimplemented（什么都不发生） |
| F-05a | 生日：合格 = 非自己、在场、有牌；真人分帧、电脑 `rand()%n` 拿一张 | fortune-effects.ts | 0x44c41b..0x44c486, 0x441e77 | verified | 真人窗口分帧 T-055（approx） |
| F-05b | 电脑那一支牌堆记账（0x441343 +1、0x4412e4 −1/弃牌 +1） | fortune-effects.ts | 0x441343, 0x4412e4 | fixed (d9843d6) | |
| F-05c | 电脑那一支**无**「搶得」框 | reduce.ts | 0x44c46d..0x44c486 | fixed (d9843d6) | 表现；台词判据改看合格人数（client speech.ts）；那一次 rand 已进 core（SP-09，5f14c39） |
| F-06/07a | 出國 / 綁架 3 天：劫难档、0x441210 后、首次清四项/占用、台词、理赔 2000×天×物價、+0x42、`+0x33 = 天 \| 原因<<6` | fortune-effects.ts, reduce.ts | 0x44c658..0x44c6e0, 0x40d375..0x40d43a | verified | |
| F-06/07b | 已在外 ⇒ 续期 `(旧&0x3f)+打包值`，不理赔不说 | fortune-effects.ts | 0x40d39e / 0x40d4c5..0x40d4d7 | fixed (d9843d6) | 先前跳过 |
| F-08/09 | 卖股（10%×float32 进公库 / 全部进存款）+ 0x436b0a(0) | fortune-effects.ts | 0x44c8aa..0x44ca38 | verified | 8 对 0 股也调 sell（approx，无状态差） |
| F-10/11 | 丢機車/汽車：档 1 作废、徒步一颗骰、库存 +1、台词（10 掷 rand） | fortune-effects.ts | 0x44cab0..0x44cc49 | verified | |
| F-12/13a | 就醫/住院 3 天：劫难档、0x441210、send_to_hospital + 理赔 | fortune-effects.ts | 0x44ccd4..0x44cd65 | verified | |
| F-12/13b | 住院前 `0x40cd07` 毁车 | fortune-effects.ts | 0x44cd54 | fixed (d9843d6) | |
| F-pay | 14..19/23/24/26/30 罰款：金额、罰款档、付公库（现金先）、破产跳过台词与理赔、理赔 | fortune-effects.ts, reduce.ts | 0x44cdb1..0x44d60c, 0x44cec2..0x44cf11 | verified | 付款台词 rand 已进 core（SP-04，5f14c39；神明免付 = SP-06） |
| F-give | 20..22/25/27..29/31 獎金：獎励档、进现金、+0x60、進帳台词 | fortune-effects.ts, reduce.ts | 0x44d237..0x44d334 | verified | 進帳台词 rand 已进 core（SP-03，5f14c39） |
| F-32 | 變賣卡片道具：劫难档 1 作废、卖道具再卖卡、點券 word | fortune-effects.ts | 0x44d6ef..0x44d76c | verified | |
| F-33..36 | 坐牢 3/5/7/9：0x441210 → send_to_prison、无毁车 | fortune-effects.ts | 0x44d797..0x44d8c2 | verified | |
| F-2j | 嫁禍挑人：电脑最恨的人否则随机 | news-effects.ts secondaryJudgement | 0x441210, 0x44476a | approx | 真人持 19 一律放弃（D-003/D-008） |
| F-mh | 魔法屋「抽取命運三張」遇真人寿星（生日分帧与后续两张次序、收卡人） | reduce.ts applyMagicHouse drawFortunes / answerBirthdayCard | 0x431dba..0x431dc5, 0x44c517..0x44c51e | fixed (5f14c39) | 剩余张数 / 收卡人 / 施法者挂 `pending.magicResume`；镜像是 `events-audit-mp.test.ts` |

### 神明（god-manifest.ts / god-power.ts / god-toll.ts / blessing.ts / object-landing.ts 神明部分）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| G-01..04 | 可附身种类、落点附身条件（actor<4、停下）、附身次序（先送旧神 → 写 god_info/节点/状态 7 或 13 → 三项修正） | cards/summon.ts, rules/object-landing.ts:324-362 | 0x40ea62..0x40ec0d, 0x41b807..0x41b82d | verified | |
| G-04a | 三张修正表 | rules/objects.ts | 0x4749e2 / 0x474a06 / 0x474a2a | verified | 逐字节 |
| G-05 | 老虎机：当前玩家 who_plays>1 或夢遊 ⇒ 自动转 **4 轮 16 次 rand**；真人按 1 轮 | rules/god-power.ts godPowerOf, reduce.ts applyGodPowerOnAttach | 0x43f2bc..0x43f327, 0x43f44a | fixed (8644694) | 真人点击时机 D-003（approx） |
| G-05a | 千位只给大財神/大窮神、digit 次序 | god-power.ts rollGodAmounts | 0x4407b9, 0x43f630..0x43f685 | verified | |
| G-06 | 老虎机窗显示的金额 | client god-slot.ts:292-315（仍按钱差反推） | 0x43f68c | follow-up | 表现；FU-5 **剩项**：应读 `lastGodPower.amount`，本轮未改 |
| G-07 | 發威跳表 1..15 | god-power.ts | 0x40ea9b | verified | |
| G-08 | 小財神：每个在场对手付附身者（现金），**一人破产后照轮下一位**（只在终局跳出） | reduce.ts applyGodPower | 0x40ec6a..0x40eca2 | fixed (8644694) | |
| G-09/11/12 | 大財神进现金；小窮神付对手存款；大窮神付公库 | reduce.ts | 0x40ed3b, 0x40efa2, 0x40f05f | verified | |
| G-10 | 大財神进帳台词 rand | reduce.ts applyGodPower('gain') | 0x40ed74 / 0x40ed85 → 0x44f354 / 0x44f3d1 | fixed (5f14c39) | 见 SP-03；`0x44f3b4` 是同一函数里的档位判定 |
| G-13 | 福神得 1/2 张：袋空不掷；满手弃牌回牌堆 | reduce.ts receiveCards | 0x441e12, 0x4412e4 | fixed (d679e70) | |
| G-13a | 福神台词 0x44f230 rand | reduce.ts receiveCards | 0x40ee46 → 0x44f280 | fixed (5f14c39) | 见 SP-01；大福神传两张之和（`0x40eefd..0x40ef0c`） |
| G-13b | 大福神 0/1 张时仍弹两卡名框 | reduce.ts receiveCards | 0x40eea8..0x40eef3, 0x40ef16 | fixed (5f14c39) | 袋空不再 `break`（只有小福神 `0x40edf9 je` 提前走）；框 `0x463353`、卡号 0 的名字 / 點數价都是 0 |
| G-14 | 小衰神丢一张（rand、按卡号首个匹配）+ 框 | reduce.ts dropCards | 0x441e77, 0x40f10c..0x40f148 | verified | |
| G-15 | 大衰神丢一半 + 框「大衰神附身 遺失一半卡片！」1500ms | reduce.ts dropCards, data/messages.ts | 0x441ece, 0x40f1de..0x40f200 | fixed (8644694) | 新 notice key god.lostHalf |
| G-16/17 | 死神没收；天使/惡魔/土地公附身只放影片 | reduce.ts / god-power.ts | 0x40f366, 0x40f205.. | verified | |
| G-18..21 | 落点尾块：闸、天使代蓋、惡魔拆一级（敌意 30×物價） | god-manifest.ts, reduce.ts | 0x40f381..0x40f61b, 0x40b110 | verified | |
| G-20 | 福神白送一级：只认本次写下的加蓋；真人空設施选种类后才掷台词 rand | reduce.ts luckyGodBonus / buildFacility(free) | 0x40f8be..0x40fa51 | fixed (8644694) | |
| G-22 | 土地公強佔敌意 = `A×((lvl+2)/5)` double 的低 32 位（求值次序） | rules/god-manifest.ts seizeHostilityDelta | 0x40f6c0..0x40f705 | fixed (8644694) | |
| G-23 | 土地公附身不能买无主地 | rules/land.ts | 0x41a027, 0x41a878 | verified | |
| G-24 | 住店走回棋盘那一回合的神明尾块（0x40f381 第二调用点） | reduce.ts endTurn 走回棋盘支 | 0x418f25..0x418f59 | follow-up | FU-4（本轮未动，信心中等） |
| G-25/26 | 衰神/死神拦消费；过路费按付款人 god_info 调整 | rules/purchase.ts, god-toll.ts | 0x40fa61, 0x41d709..0x41d7c9 | verified | |
| G-27 | 离身时搭档参照格 = 附身者当前格（未被关时） | rules/object-landing.ts withDispelNode | 0x40e356, 0x40e3cd..0x40e3d4 | fixed (8644694) | 送神符 0x444cc4 属 cards |
| G-28 | 任期在 0x41c84f 递减 | reduce.ts tickActorDay | 0x41cc6c..0x41cca0 | verified | |
| G-29 | 惡犬：搭档登场挑格在送醫院**之前** | reduce.ts applyArrival | 0x41b845 → 0x41b8ef | fixed (8644694) | |
| G-30..35 | 搭档对、固定槽、挑格（0x80ffff00、≥300 像素）、开局物件、加持、跟班进監獄 | rules/objects.ts, object-landing.ts | 0x40e275, 0x40aa6c, 0x407d6a, 0x44b896, 0x40fc00 | verified | 64 次上限 Q-OBJ-2（approx） |

### 惡人 / 乞丐 / 敌意（npc-actions.ts / npc-walk.ts / special-actors.ts / beggar.ts / hostility.ts）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| P-01..07 | 开局位置、轮到哪些惡人、四计数递减、冬眠/停留不走、步数 rand()%9+2 / 龜行 1、岔路 rand、機器娃娃 | special-actors.ts, reduce.ts | 0x40731b.., 0x418f95.., 0x41ce39.., 0x40de1a..0x40de64, 0x40c4c9.. | verified | |
| P-08 | 小偷每一步拿禮物/寶箱/路障/地雷/炸彈 | npc-walk.ts runNpc | 0x41b995.., 0x41bb9d.., 0x41bd65.., 0x41bf16.., 0x41c072.. | verified | |
| P-09/17 | 夢遊（+13）：小偷不拿、尾段偷抢勒索整段跳过（只查老家） | npc-walk.ts runNpc | 0x41b9a9 等, 0x41c17a / 0x41c187 | fixed (757e7de) | |
| P-10 | 小偷拆陷阱：先回库存再发给主人 | npc-walk.ts applyNpcEvents | 0x40e17a..0x40e195, 0x445a4d | fixed (757e7de) | |
| P-11/12 | 禮物按库存加权（袋空不掷）；寶箱 +500 點券（word） | npc-walk.ts | 0x445ada..0x445b34, 0x41bcb6 | verified | 抽签读当趟实时库存（顺带修） |
| P-13/15 | 路障拦 5..7 回库存；地雷停步才炸、住院 3 天 | npc-walk.ts | 0x41bceb.., 0x41be5f.. | verified | |
| P-14 | 路障拦下后尾段照跑（算停步） | npc-walk.ts | 0x41bd3c | fixed (757e7de) | |
| P-16 | 惡犬咬惡人（停步），狗走、搭档登场、醫院 | npc-walk.ts, reduce.ts npcStepOnce | 0x41b837..0x41b8ef | fixed (757e7de) | |
| P-18 | 只有小偷偷點券、強盜奪卡；流氓間諜不偷 | npc-walk.ts | 0x41c194 / 0x41c199 | fixed (757e7de) | |
| P-19 | 受害者 = 占用位最低位（排主人、清掉被关者），出局即不偷 | npc-walk.ts victimAt | 0x41c1b9..0x41c1dd | fixed (757e7de) | |
| P-20/21 | 偷點券 >>1（16 位）；奪卡 `rand()%张数` | npc-actions.ts | 0x41c207..0x41c27a, 0x441e77 | verified | |
| P-22 | 同趟重复奪卡只少一张 | npc-walk.ts | 0x441343 | fixed (757e7de) | |
| P-23 | 奪来的卡按 0x4412e4（满手弃牌、牌堆记账） | npc-walk.ts applyNpcEvents | 0x4412e4, 0x441343 | fixed (757e7de) | |
| P-24..26 | 強盜踩銀行：每一步，trunc(存款×0.2)，flags 5，框无条件 | npc-actions.ts, npc-walk.ts | 0x41c330..0x41c415 | verified | 0 额也 pay_money（approx，无差） |
| P-27 | 流氓/間諜只在停步那一格 | npc-walk.ts | 0x41c447 | fixed (757e7de) | 旧用例（每步勒索）已改 |
| P-28..30 | 流氓地產按同名同主地价和×物價 / 設施 +0x22×物價；間諜取上一笔过路费 | npc-walk.ts thugFeeAt / spyTollAt | 0x41c4df.., 0x41c64e.., 0x41c597.., 0x41c6bd | verified | |
| P-31 | 間諜取企業盈餘：企業自己付（+0x28/+0x2c 同减），進保釋人存款 | npc-walk.ts applyNpcEvents | 0x41c6e6..0x41c79e, 0x41d2d6..0x41d2ee | fixed (757e7de) | |
| P-32 | 老家读 +11（放人时写 1/2，门口是落点格才 \|0x80）；第一次踩老家只置位 | special-actors.ts releaseNpc, npc-walk.ts | 0x41c7a6..0x41c83e, 0x43d84e, 0x43eefd | fixed (757e7de) | 新可选字段 SpecialActor.home（存档 +11 读写） |
| P-33 | 查老家在尾段最后（先偷抢再回） | npc-walk.ts | 0x41c7a6 | fixed (757e7de) | |
| P-34..36/38 | 送回 NPC 支、保釋放人、赎金、飛彈打惡人 | npc-walk.ts, reduce.ts | 0x43d760.., 0x43d7e0.., 0x43ee0f | verified | |
| P-37 | 惡人抢银行把人抢破产：破产在 pay_money 里当场发生（之后的 rand / 占用看出局者） | reduce.ts npcStepOnce（走完再破产） | 0x41d375 → 0x40cd87 | follow-up | FU-6（本轮未动） |
| P-39 | 若干惡人訊息框/影片 | client | 0x41bab8 等 | approx | 表现 |
| B-01/03/04 | 乞丐：最低位且已出局、停步才给；1000×物價给公库；挑远格 | beggar.ts, reduce.ts giveAlmsIfBeggar | 0x41b5fd..0x41b686, 0x40aa6c | verified | |
| B-02 | 占用位排除被关/住店/消失者 | beggar.ts beggarAt | 0x43d61d / 0x40d5d2 / 0x40d444 | fixed (757e7de) | |
| B-05 | 挪过去后来路 = 新格第一个非 0 邻居、朝向重算 | reduce.ts giveAlmsIfBeggar | 0x40ccb9..0x40ccfa | fixed (757e7de) | |
| B-06 | 施捨付不出先破产、再挪乞丐（两处都要 rand） | reduce.ts giveAlmsIfBeggar | 0x41b686 → 0x41b68f | fixed (757e7de) | |
| H-01/04/05/06 | update_hostility 语义；解盟；同盟每日 −20×物價；惡人代码不动敌意 | hostility.ts, reduce.ts | 0x40df69..0x40dfd9, 0x40cc1a, 0x41cbd9.. | verified | |
| H-02 | 加法 32 位有符号回绕后再判负清 0 | hostility.ts | 0x40dfa1 / 0x40dfa9 | fixed (757e7de) | |
| H-03 | b ≥ 4 护栏 | hostility.ts | 0x40df8d | approx | 已登记 |

### 关押 / 保釋 / 住店 / 時光機（confinement.ts / confine-view.ts / blocking.ts / visit.ts / time-machine.ts）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| C-01..03 | 阻碍判据 dword[+0x32]/+0x36；日推进给新行动者；四计数 0x80 释放/递减/到 0 挂 0x80（消失掩码 0x3f） | types.ts, blocking.ts, reduce.ts tickActorDay | 0x40c94c, 0x419039, 0x41c88f..0x41c955 | verified | |
| C-04/05 | 冬眠·夢遊·**龜行**：在押期间与刚放出那天都不走（两道 dword 闸） | blocking.ts tickTurnCounters, reduce.ts | 0x41c95e, 0x41caf7, 0x41ca7e, 0x41cb4c | fixed (6706210) | |
| C-06 | 停留/拒貸/暫停放款/同盟不受闸 | blocking.ts | 0x41ca92.., 0x41cb70.. | verified | |
| C-09 | 夢遊醒来还车 | reduce.ts tickDailyCounters | 0x41c9b4..0x41ca72 | approx | 多清了 +0x66/+0x67（只影响存档字节） |
| C-11/12/14 | 回合开始判定、被挡台词 rand、框天数 | turn-start.ts, reduce.ts | 0x40c912..0x40cc0d | verified | 框取第一个（同结果，approx） |
| C-13 | 時光機快照在**起步掷骰**（0x40dd53）/ 被挡回合（0x40c97c）/ 傳送機搬自己（0x4477c3）拍 | reduce.ts rollDice / startTurn / teleportWith | 0x44808a 三个调用点 | fixed (6706210) | 先前在回合开头拍（同回合用時光機几乎无效） |
| C-15/17/20/21/23 | 首次关押（清四项/占用、传送关押格、景观坐标、跟班、+0x42）、关押格、释放回棋盘与朝向 | confinement.ts, reduce.ts | 0x43d5e7..0x43d674, 0x40803f, 0x40d6be | verified | |
| C-16 | 加刑那一支不写占用表 | confinement.ts confine | 0x43d6bd..0x43d6d6 | fixed (6706210) | |
| C-22 | 走回棋盘那一回合不推游标 | reduce.ts | 0x418f07..0x418f8e | verified | 清账时机 approx（已登记） |
| C-24 | 电脑保釋（rand&1、+0x17 三种风格、rand%3、rand%n、>30 / ≥700） | visit.ts decideBail | 0x43d3d8..0x43d4fd | verified | |
| C-25 | 真人保釋：点券 ≥ 赎金（无 700 门槛） | visit.ts canAffordBail(human) | 0x43d0d4 / 0x43e773 | fixed (6706210) | 客户端本来就这么判，core 先前拒收 |
| C-26 | 真人保釋玩家：被保者对保釋者敌意 −max(天,1)×100×物價 | reduce.ts case 'bail' | 0x43cf21..0x43cf4d, 0x43de5d.. | fixed (6706210) | |
| C-27 | 住店天数 −1（0 → 0x80）、+0x42、理赔、贴图到設施 | reduce.ts 設施支 | 0x41a7e8..0x41a85e | verified | |
| C-28 | 住店先 0x40d761 清旧关押/占用；死神换人付走 0x40d5a5 支 B（格/来路取当前玩家、不置 0x20、跟班同格） | reduce.ts 設施支 | 0x41a7c5, 0x40d5fc..0x40d6a2 | fixed (6706210) | |
| C-29 | 住店敌意：当前玩家对設施主人 +20×天×物價 | reduce.ts 設施支 | 0x41a78f..0x41a7bc | fixed (6706210) | |
| C-30 | 住店台词 rand | reduce.ts finishToll 旅館支（SPEECH_SITE.smallLoss） | 0x41a7d3 / 0x41a7e0 → 0x44f2c2 / 0x44f312 | fixed (5f14c39 / ce08a41) | 见 SP-02；T-052 的「台词随机不走引擎流」近似口径作废 |
| C-31/32/34..41/44/45 | 拆設施全场放住客；消失 0x40d375 首次/续期；消失释放；冬眠卡；免租顺序；飛彈；夢遊走子；占用判据；天数表；view；终局闸；託管走电脑支 | 各处 | 0x40dffa, 0x40d375.., 0x40d4e5, 0x444147.., 0x41d58d.., 0x4470a1.., 0x40dd1f.., 0x43d30e.., 0x41c882, 0x43d331 | verified | |
| C-19 | 首次关押 `0x44f2c2(idx, 天)` 天数 4..6 掷一次 rand | confinement.ts sendToConfinement（有 rng） | 0x43d5f9, 0x43eca5 → 0x44f312 | fixed (5f14c39 / ce08a41) | 见 SP-02（ce08a41 先接上、5f14c39 改记进 `lastSpeechRolls`） |
| C-42 | `0x498df3` 表驱动的 0 天送返（惡人以外？） | — | 0x41c7a6..0x41c844 | verified | 已查清：即惡人老家那一段（P-32） |
| C-43 | 释放后计数原版停在 0x80、本引擎清 0 | blocking.ts | 0x41c89a..0x41c8a3 | approx | 由 C-04 的「刚放出来」参数补齐差异 |

### cards 审计交来的跨区项（2026-09-25）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| X-a | 首次关押 4..6 天的倒霉台词 rand 接进随机流：命運 / 新聞 / 魔法屋 / 住店（当前玩家本人住店） | fortune-effects.ts, news-effects.ts, reduce.ts magic prison/hospital、設施住店 | 0x43d5f9 / 0x43eca5 → 0x44f312；0x41a7d3 / 0x41a7e0 | fixed (ce08a41) | 新聞 29 用例的随机计数随之 +1；5f14c39 起同时记进 `lastSpeechRolls`（SP-02） |
| X-b | 小偷捡到禮物后主人那句台词的 rand（价 50<p≤100） | npc-walk.ts runNpc | 0x41bafa → 0x44f280 | fixed (ce08a41) | 5f14c39 起同时记进 `lastSpeechRolls`（SP-01） |
| X-c | 惡人停在惡犬格被咬 | npc-walk.ts / reduce.ts | 0x41b837..0x41b8ef | fixed (757e7de) | 即 P-16 |
| X-d | 魔法屋拍卖流拍不清地主 | reduce.ts settleAuctionExplicit（keepOwnerOnPass） | 0x4324d5 → 0x4324dd | fixed (ce08a41) | 新 pending 字段 keepOwnerOnPass |
### 特殊格 / 魔法屋 / 探監 / 傳送機 / 時光機 / 小游戏

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| S-01 | 落点 17 路跳表，索引 = `[node+0x24]&0xff`，>16 无效果 | rules/special-square.ts:38-83 | 0x004198a9..0x004198b2, 表 0x004197e9 | verified | 17 项逐项 dump 与 handler 名一致 |
| S-02 | 落点前「安静版」回合闸 0x40c912(1)：who&0x30 / dword[+0x32] / byte[+0x36] ⇒ 不进落点 | state/reduce.ts:1774, rules/turn-start.ts:68 | 0x00418e7f..0x00418ead, 0x0040cbc2..0x0040cbdb | verified | |
| S-03 | 夢遊中（+0x37≠0）踩 type≠0 的格整段不结算 | state/reduce.ts:1801 | 0x0041986c..0x0041987e | verified | |
| S-04 | 公園落地无效果 | rules/special-square.ts:42 | 表[1] = 0x0041b3d0（尾声） | verified | |
| S-05 | 得50點：+0x32（word 回绕）、弹框 1000ms、`rand()&1` 选台词 | rules/special-square.ts:160-181, reduce.ts:1817-1831 | 0x0041b1be..0x0041b1d7, 0x0041b1f8 | verified | |
| S-06 | 得30點：+0x1e、台词固定事件 2、不掷 | rules/special-square.ts:172 | 0x0041b258..0x0041b29e | verified | |
| S-07 | 得10點：+0x0a、无台词 | rules/special-square.ts:175 | 0x0041b2dc..0x0041b2fd | verified | |
| S-08 | 抽卡格：按牌堆剩余张数加权 `rand()%n`，袋空不掷 | rng/watcom.ts:140 drawRandomCard | 0x00441e12..0x00441e5a | verified | 袋 128 字节栈数组，正常牌堆不溢出 |
| S-09 | 抽卡格收卡：满 15 张弃最便宜（严格更小、同价取前）**弃牌回牌堆**，新卡 −1 | rules/receive-card.ts, reduce.ts:1833 | 0x004412e4, 0x0044128f, 0x00441343 尾 0x004413a2, 0x0044133b | fixed (d679e70) | 先前弃牌凭空消失 |
| S-10 | 抽卡格尾部台词：卡价 50<p≤100 才 `rand()&1` | reduce.ts:2060（SPEECH_SITE.smallGain） | 0x0041b37b..0x0041b38c, 0x0044f23f..0x0044f285 | verified | 这一处本来就在 core；5f14c39 起走站点表并记进 `lastSpeechRolls`（见 SP-01） |
| S-11 | 抽卡格弹框「得到%s！」卡名 | reduce.ts:1849 | 0x0041b355..0x0041b373 | verified | 表现 |
| S-12 | 新聞/命運/監獄/醫院/樂透/銀行/百貨/魔法屋 分派 | reduce.ts:1881-1921 | 0x0041b11e..0x0041b3cb | verified | 樂透/銀行/百貨规则属 econ |
| MG-01 | 小游戏：`who_plays != 1`（整字节）或動畫開關關 ⇒ 不玩 | reduce.ts:4587-4603 | 0x00415226/0x0041522d, 0x00415233（6/7/8 三入口同形 0x004154ed / 0x0041560d） | verified | 開關由客户端按设定报 `score:null` |
| MG-02 | 不玩：得分 = 50 + rand()%20，弹「得點券%d點」2000ms，再 `rand()&1` 选台词 | places/minigame.ts:61-70, reduce.ts:4613-4651 | 0x00415457..0x00415484, 0x004154b6 | verified | 两次 rand 顺序对 |
| MG-03 | 得分加到點券（word 回绕） | reduce.ts:4634 | 0x0041b152 `add word [ebx+0x496b98], ax` | verified | |
| MG-04 | 真人玩的得分上限 999 | places/minigame.ts:65,79 | 0x00414eed | approx | 夹逼是联机防刷，原版分数天然在范围内 |
| MG-05 | 真人玩小游戏期间原版会消耗全局 rand（玩法本身）| client minigame-screen.ts 用本屏自己的 WatcomRng | rand 调用点 0x0041208f..0x00414e6c | approx | 实时玩法消耗次数取决于操作时序，core 不可复现；联机确定性优先 |
| M-01 | 魔法屋入口：`who_plays == 1`（整字节）开女巫窗口，否则电脑两转盘 | reduce.ts:3792-3808 | 0x0043381b/0x00433822 | verified | |
| M-02 | 目标转盘 `rand()%12`，选不出人重抽（无上限） | places/magic-house.ts:549-566 | 0x00433910..0x00433932 | approx | 引擎给 32 次上限（纯函数必须终止） |
| M-03 | 名单有自己 ⇒ 效果 6；否则 `rand()%11`，6→7 | places/magic-house.ts:575-589 | 0x00433934..0x0043397e | verified | |
| M-04 | 真人效果 = 窗口返回值（0..11 全可点） | reduce.ts:3814-3837 | 0x004338af..0x004338b7, 0x00432a74 | verified | |
| M-05 | 真人女巫窗口动画期间消耗 rand（摆嘴型/闪框） | client magic-screen.ts | 0x00432a85, 0x00432acc, 0x00432b32 | approx | 时序相关，core 不复现 |
| M-06 | 12 个目标筛选（前 6 取最大值、0 不参选（財產除外）；后 6 条件） | places/magic-house.ts:100-191 | 表 0x00431812，0x00431867..0x00431c31 | verified | 并列全算见 D-LEGACY-3（原版未初始化栈） |
| M-07 | 逐人施加、`[0x49910c]` 临时 = 中签者，结束还原施法者 | reduce.ts:3860-4006 | 0x004320aa..0x004320d6, 0x004324fa | verified | |
| M-08 | 效果 0 變賣所有卡片：0x441f21，點券 word 累加 | places/magic-house.ts:318 | 0x00431d2b..0x00431d3d | verified | |
| M-09 | 效果 1 抽取命運三張：三次 0x44db81（主角 = 中签者） | reduce.ts:3948-3966 | 0x00431dba..0x00431dc5 | verified | |
| M-10 | 效果 2/10：敌意(中签者→施法者) +90×物價 | places/magic-house.ts:335,433 | 0x00431e21..0x00431e45, 0x004323d9..0x004323fe | verified | |
| M-11 | 效果 2/10：**过免罪/嫁禍二级判定**再关 3 天 | reduce.ts applyMagicRequest 'prison'/'hospital' | 0x00431e54..0x00431e68, 0x0043240d..0x00432421 | fixed (d679e70) | 先前直接关中签者 |
| M-12 | 效果 3 原地停留：`(stop+1)&0x7f` | places/magic-house.ts:345 | 0x00431eca..0x00431ee4 | verified | |
| M-13 | 效果 4 存入所有現金 | places/magic-house.ts:351 | 0x00431f44..0x00431f5b | verified | |
| M-14 | 效果 5 就地加蓋：闸 dword[+0x32]==0 且格型 (0x7d0,0x1770)；0x40b110 | places/magic-house.ts:363, reduce.ts:4110-4140 | 0x00431f67..0x00431fb0, 0x00432059, 0x0040b110 | verified | 真人空設施选种类窗口未实现（Q-CO-1，不建） |
| M-15 | 效果 6 得一張卡片：0x441e12（满手弃牌回牌堆） | places/magic-house.ts:373-390 | 0x004320ee, 0x004412e4 | fixed (d679e70) | 先前直接追加，手牌可超 15 |
| M-16 | 效果 7 向後轉：闸 +0x32，0x40c78c（掉头 + 重挑来路） | places/magic-house.ts:396-404 | 0x00432160..0x004321d0 | verified | |
| M-17 | 效果 8 變賣所有道具：0x445b3f | places/magic-house.ts:410 | 0x00432245..0x00432254 | verified | |
| M-18 | 效果 9 就地拆除：0x40ab4a mode 0（住宅连锁店写回种类；設施到 0 清种类 + 放人） | reduce.ts applyMagicRequest 'demolish' | 0x00432259..0x0043234c, 0x0040ab90..0x0040ac38 | fixed (d679e70) | 先前只认住宅、只写等级 |
| M-19 | 效果 11 拍賣當格土地：闸 +0x32 与格型，run_auction(中签者, type, 1) | reduce.ts:4153-4190 | 0x0043242b..0x004324d5 | verified | |
| M-20 | 名称/摆位表 16 字节 × 12 | data/src/magic-house.ts | 0x00475718 | verified | binary-truth.test.ts 已逐字节 |
| V-01 | 探監/探病：占用表全空直接返回 | reduce.ts:4672 | 0x0043d30e..0x0043d324 / 醫院同形 | verified | |
| V-02 | 真人（整字节 ==1）弹保釋窗 | reduce.ts:4675 | 0x0043d331/0x0043d338, 0x0043e9d1 | verified | |
| V-03 | 电脑：`rand()&1` 管不管 → 按 +0x17 挑候选（0 玩家/1 玩家+rand()%3==0 加惡人/2 惡人）→ `rand()%n` | rules/visit.ts:201-236 | 0x0043d3d8..0x0043d4ba, 0x0043ea84..0x0043eb50 | verified | |
| V-04 | 赎金玩家 30（點券严格大于）/惡人 300（门槛 ≥700） | rules/visit.ts:65-81 | 0x0043d4c1..0x0043d4fd, 表 0x00475c44/0x00475ca4 | verified | |
| V-05 | 扣點券 word；玩家目标 byte[+0x34/+0x35]=0x80 + 清占用 | rules/visit.ts:284-318 | 0x0043d55f..0x0043d577, 0x0043ec0b | verified | |
| V-06 | 电脑保釋惡人 ⇒ 0x43d7bf 摆到关押格、主人 = 当前玩家 | reduce.ts enterVisit | 0x0043d566..0x0043d580, 0x0043d7e0..0x0043d87d | fixed (d679e70) | 先前只清占用表，惡人再也不会出来 |
| T-01 | 傳送機住宅：owner/level/type 搬、源清零；**+0x30 到期日搬、+0x2c 上次過路費清源** | rules/teleport.ts teleportLand | 0x00447528..0x00447553 | fixed (d679e70) | |
| T-02 | 傳送機設施：+0x19/+0x1a/+0x18/+0x34 搬，+0x30 清源 | rules/teleport.ts teleportFacility | 0x004475d8..0x0044760f | verified | |
| T-03 | 傳送機搬人：候选邻居（非 0、未封）中朝向圆周距离最小者；来路 = 第一个不同的候选 | rules/teleport.ts pickFacingAt | 0x0044768f..0x004477ae | verified | |
| T-04 | 搬人后 0x40fc00：跟班物件同格 | rules/teleport.ts teleportPlayer | 0x00447844 | fixed (d679e70) | |
| T-05 | 傳送機搬惡人（槽 ≥4）/ 地上物件 | cards 区 `5256fa6`：rules/teleport.ts teleportActorTo / teleportObjectTo | 0x004476ef, 0x00447857..0x004478b5, 0x004478cb..0x004479ae | fixed (5256fa6，cards 区；本分支未合并) | 两段拾取；第二段取消 `0x4479b3` 不扣道具；本区只记录引用 |
| T-06 | 傳送機住宅空地不能搬（owner==0 返回 null） | cards 区 `5256fa6`：rules/teleport.ts teleportLand 删掉该限制 | 0x00447469 push 0x1200036（类别 0x36、组字节 0 = 不设限）；目标 0x004474f5 push 0x2090802 / 0x00447598 push 0x2090804（子类 8 = 无主 0 级） | fixed (5256fa6，cards 区；本分支未合并) | 源不看归属 ⇒「空地不能搬」是错的；子类 8 管的是**目标** |
| TM-01 | 時光機：回合开始只给 who_plays bit0 的人存快照 | rules/time-machine.ts:68 | 0x004480a0/0x004480a7 | verified | |
| TM-02 | 時光機还原：没快照不消耗道具 | reduce.ts useToolAction | 0x00448568, 0x004473b2 | verified | |
| TM-03 | 時光機还原的范围：原版逐块 memcpy（玩家/替身/物件/手牌/道具/牌堆/股市/地图/占用表/若干全局），rand 不还原 | rules/time-machine.ts:84 | 0x0044857d..0x00448a46 | approx | 引擎整局还原（除 rng/快照）；块清单已列在 VA 段，未逐字段比 |
| GW-01 | 走回棋盘几何（起终点/一格/trunc(dist×0.125) 拍） | rules/gate-walk.ts | 0x0040c0b4..0x0040c0e8, 0x0040dd37..0x0040dd4a, 0x0040c27a | verified | 纯表现几何，core 规则不读 |

### 台词随机 —— FU-1 第二轮全部收进 core（2026-09-25，提交 5f14c39 core / d2e347c 客户端）

> 原版这些台词的 `rand()` 与规则**共用同一条**全局随机流（`call 0x456f2d` = `_libc_rand`），掷了之后所有随机事件往后挪一格。
> 先前（WP-3 选项 b）由客户端对状态做哈希当硬币、**不推进** core 的随机流 ⇒ 每说一句就与原版错开。
> 现在 core 在 exe 掷的那一刻掷、原值按先后记进 `lastSpeechRolls`（纯表现瞬态、不进指纹 / 不进存档），
> 客户端 `speech-roll.ts` 按**站点 + 说话人**查它（`speechRand` / `speechCoin`）。
> 站点常量与判定函数在 `packages/core/src/rules/speech-rand.ts`（`SPEECH_SITE:28` / `NEWS_OWNER_SITE:41` / `speechDraw:150`）。
> 上表各行的 status 变化见「修正清单」；本表逐站点列出「何时掷 / 谁掷 / 我们的代码 / 原版 VA」。

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| SP-01 | 好消息阶梯 `fcn_0044f230(玩家, 值)`：`50 < 值 ≤ 100` 掷一次 `rand()&1`，说事件 0\|1 | speech-rand.ts:60-62（判据）; reduce.ts:2060 抽卡格 / 3633 禮物格 / 3901 福神 / 6123 節日送卡 / 8073 百貨贈禮; npc-walk.ts:225 小偷禮物 | 0x0044f280 `call 0x456f2d` + `and eax,1` + 表 0x48084a；调用点 0x41b38c / 0x41b98b / 0x41bafa / 0x40ee46 / 0x42ea23 / 0x452753 | fixed (5f14c39) | 抽卡格那一处先前已在 core（S-10）；其余 5 处本轮接入。小偷禮物是 cards 区 ce08a41 接的（X-b） |
| SP-02 | 小额损失阶梯 `fcn_0044f2c2(玩家, 天)`：`3 < 天 ≤ 6` 掷一次 `rand()&1`，说事件 3\|4 | speech-rand.ts:65-67; confinement.ts:386-387 首次关押; reduce.ts:8955 旅館住店 / 9091 消失 | 0x0044f312 `call 0x456f2d` + `and eax,1` + 表 0x480856；判定 0x44f2d1 `cmp edx,6` / 0x44f2f4 `cmp edx,3` | fixed (5f14c39 / ce08a41) | 对应 C-19 / C-30 / X-a |
| SP-03 | 進帳阶梯 `fcn_0044f354(玩家, 金额)`：`5000×物價 ≤ 金额 < 9000×物價` 掷一次 `rand()&1`，说事件 6\|7 | speech-rand.ts:70-72; reduce.ts:3827 大財神 / 6623 命運獎金 / 6851 新聞 8/9/10 / 8846 过路费收款方 | 0x0044f3d1 `call 0x456f2d` + `and eax,1` + 表 0x480862；判定 0x44f36d / 0x44f3b0 | fixed (5f14c39) | 对应 G-10 / F-give / N-08s；收款方那一句的金额是**他那一份**（`out.ownerDue` / `god.toll`） |
| SP-04 | 付錢阶梯 `fcn_0044f42d(玩家, 金额)`：同档掷一次 `rand()&1`，说事件 9\|10 | speech-rand.ts:70-72; reduce.ts:6615 命運罰款 / 8603 企業付款 / 8845 过路费付款方 | 0x0044f4a7 `call 0x456f2d` + `and eax,1` + 表 0x48086e；判定 0x44f486 | fixed (5f14c39) | 对应 F-pay；企業付款只在**当前玩家自己付**时说（0x41b000 `cmp edi,[0x49910c] / jne`） |
| SP-05 | 最敵對玩家 `fcn_0044f4ed(付款人, 收款人, 金额)`：收款人 = 付款人最恨的人**且**金额 ≥ 5000×物價 ⇒ 掷一次，奇数说事件 18（顶替 9..11） | speech-rand.ts:78-113; reduce.ts:8842-8844 | 0x0044f525 `call 0x456f2d` / `test al,1`；闸 0x0044f4f7 `call 0x40d2d3` / 0x0044f51f `cmp eax,[esp+0x18] / jg` | fixed (5f14c39) | 最恨的人 = `hostility` 严格更大、并列取前（0x40d2e3..0x40d316） |
| SP-06 | 罰款免付 `fcn_0044f567(玩家, 原额)`：同中间档掷一次，说事件 12\|13 | reduce.ts:3259-3264（godReliefSpeechDraw，四个调用点 2261 / 6509 / 8671 / 9559） | 0x0044f5e1 `call 0x456f2d` + `and eax,1` + 表 0x48087a；判定 0x44f5c0 | fixed (5f14c39) | 金額用**没乘倍率**的原额（`0x0044d01b mov ebp,[0x48c5b4]`）；过路费那一处是 `0x41d7c1` |
| SP-07 | 街區獨佔 `fcn_0044f627(地名, 參數)`：同名地自己有 ≥ 3 块**且**第 2 参 ≠ 0 ⇒ 掷一次 `rand()%3`，余 0 才说事件 17 | reduce.ts:2529-2536（福神白送加蓋那一支） | 0x0044f67b `call 0x456f2d` / `idiv 3` / `0x0044f68c test edx,edx / jne` | fixed (5f14c39) | 客户端 `detectAreaMonopoly` 只认「掷过且余 0」（`speechRand` 为 `null` ⇒ 不说） |
| SP-08 | 命運 0/1「強制拆除 / 強制徵收」之后房主那一句：**无条件**掷一次 `rand()&1`，说事件 3\|4 | reduce.ts:6462-6463（`out.demolished !== null`） | 0x0044bf86 `call 0x456f2d` + `and eax,1` + 表 0x480856；1 在 0x0044c0e3 `jmp 0x44bf46` 汇进同一段 | fixed (5f14c39) | 说话人 = 当前玩家（抽牌人）；对应 F-00 |
| SP-09 | 命運 5「今天是你生日」：收完（`edi` = 合格人数 ≠ 0）之后掷一次 `rand()&1`，说事件 0\|1 | fortune-effects.ts:632（电脑寿星）; reduce.ts:6669-6672（真人寿星最后一位答完） | 0x0044c57b `test edi,edi / je` → 0x0044c5ad `call 0x456f2d` / `and eax,1` / `0x0044c5c5` | fixed (5f14c39) | 真人那一支分帧（T-055）：**最后一位答完**才掷，取消（`cardId=0`）也算问过；合格人数为 0 不掷 |
| SP-10 | 新聞 5「…」挑中那一处有主 ⇒ 房主掷一次，说事件 3\|4 | reduce.ts:6854-6856（`NEWS_OWNER_SITE.get(5)`） | 0x004494b4 `call 0x456f2d` + `and eax,1`；房主在 pass 0 就写进 `[0x48c5a0] = byte [实体+0x19]`（新聞 21 = 0x0044ad70..0x0044ad79，5/15/19 同形） | fixed (5f14c39) | 说话人 = 房主 − 1 |
| SP-11 | 新聞 15 同上 | reduce.ts:6854-6856 | 0x0044a5b0 `call 0x456f2d` + `and eax,1` | fixed (5f14c39) | |
| SP-12 | 新聞 19 同上 | reduce.ts:6854-6856 | 0x0044ab00 | fixed (5f14c39) | 镜像是 `packages/server/src/events-audit-mp.test.ts`（房主 0 / 无主 两份局面恰差这一步） |
| SP-13 | 新聞 21 同上 | reduce.ts:6854-6856 | 0x0044ae74 | fixed (5f14c39) | 空地上照样说（`mutate_land` 什么都没改也带 `place`） |
| SP-14 | 过路费那一刻的三句（付款方最敵對 18 / 付錢 9\|10、收款方進帳 6\|7），次序 = 最敵對 → 付錢 → 進帳，全在 `pay_money` **之前** | reduce.ts:8838-8847 tollSpeechDraws（住宅 8891 / 設施 8918） | 0x00419f59 / 0x00419fd2 / 0x0041a710 `call 0x44f4ed` → 0x00419f67 / 0x00419fe0 / 0x0041a71e `call 0x44f42d` → 0x00419fa1 / 0x00419ff0 / 0x0041a735 `call 0x44f354` | fixed (5f14c39) | 说了 18 就不再掷付錢那一句（`0x00419f63 / 0x00419fdc / 0x0041a71a test eax,eax / jne`）；设施那一支付款人是主人时整段跳过（`0x0041a70b je`） |
| SP-15 | 消失 / 旅館「走回棋盘」那几档天数（>3 ⇒ 3\|4） | reduce.ts:9091 disappearSay | 0x0044f312（同 SP-02 的阶梯） | fixed (5f14c39) | 这一处本来就在 core（`rng.next()`），本轮改记进 `lastSpeechRolls` 并走站点表 |
