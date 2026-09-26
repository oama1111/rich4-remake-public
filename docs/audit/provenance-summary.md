# 六区出处审计 · 协调方总账（2026-09-25）

> 任务书见 `/Volumes/Kingston/大富翁4重制版/wt28/AUDIT.md`。六个区各自一份台账（本目录 `provenance-*.md`），
> 每行都附 `rich4.exe` 的 VA 与（修复项的）提交号。**本文只做汇总**：口径、数字、改了什么、还剩什么。

## 一、为什么要做

近期试玩反复发现「从来没从原版 exe 推出来过」的规则：自拟的逻辑（电脑买车的 150 點、认购股数取现金一半、
连击屏来自一份配置笔记、台词恒取第一句）、漏掉的子步骤（掉头不重挑来路、月度评奖读清零后的计数）、
以及读错汇编（把帧数当热点、`+0x3d` 当 `+0x41`、双重偏移、坐标当格号）。**电脑分支（`who_plays != 1`）最严重**
—— 原版给电脑走的是另一段代码，过去常常靠猜填。既有测试比的是「我们对 exe 的读法」，所以抓不到这类错。

## 二、口径

- 分区：**ai-move**（电脑/託管的非经济决策）、**ai-econ**（电脑/託管的经济决策）、**cards**（30 张卡 / 13 件道具 /
  地图物件 / 库存与取得）、**econ**（与人机无关的钱与资产规则）、**events**（新聞 / 命運 / 神明 / 惡人乞丐敌意 /
  关押 / 特殊格 / 小游戏 core 侧）、**loop**（回合与游戏循环、走子、落点分派、日期推进、交互归属、胜负时机）。
- 每条决策点都**重新打开 exe** 核（`tools/disasm.py va|dump|callers|xref`），既有 `@source` 注释一律**不当真**；
  数据表逐字节 dump 比对（另有 ★ 项用 Unicorn 直接在原版机器码上跑当预言机）。
- 修不动的（> 半天或真有歧义）**不猜**，登记 `follow-up` 并附证据。
- 每个改状态的修复都要有**联机镜像用例**（`packages/server/src/*mp*.test.ts`）：服务器与单机走同一个 reducer，
  同一串 action 必须算出同一局面。

## 三、数字（各台账「摘要」表的最终值）

| 区 | 范围要点 | verified | fixed | approx | follow-up | n/a | 台账 |
|---|---|---|---|---|---|---|---|
| ai-move | 出牌 / 用道具 / 骰子数 / AI 调度 / 性格表 | 47 | 9 行（7 处修复） | 6 | 5 | 2 | `provenance-ai-move.md` |
| ai-econ | 买地盖房 / 拍卖 / 银行 / 股市 / 认购 / 百货 / 樂透 / 公佈欄 / 魔法屋 / 小游戏 | 43 | 19 行（16 处修复） | 4 | 4 | 1 | `provenance-ai-econ.md` |
| cards | 卡片 / 道具 / 物件 / 库存与取得 | 208 | 97 | 14 | 10 | 3 | `provenance-cards.md` |
| econ | 地价过路费 / `pay_money` 破产 / 拍賣 / 銀行 / 股市 / 樂透 / 月结 / 身家 / 胜负 | 204 条（90 行） | 44 条（39 行，21+9 项修复） | 11 | 5 | 8 | `provenance-econ.md` |
| events | 新聞 / 命運 / 神明 / 惡人乞丐敌意 / 关押 / 特殊格 / 小游戏 | 121 | 83 | 13 | 3 | 2 | `provenance-events.md` |
| loop | 回合循环 / 走子 / 落点 / 日期 / 交互 / 视角 / 胜负 / 随机数清单 | 64 | 19 行（16 处修复） | 1 | 0 | 4 | `provenance-loop.md` |

（各区「行」的粒度不同 —— cards / events 一行 = 一条规则，econ / loop 有的一行合并了同构的多条；
所以**不要把六个区直接相加**当一个精确总数看。）

## 四、改了什么（按性质，不是按区）

1. **规则错了，按原版改**（数量最多）：过路费记敌意、設施与旅館收費、破产按在場**真人**数判终局、
   破產清别人对他的敌意、分紅、拍賣首拍席位与加价档位、建設公司真人选地窗、龜行只走一步、
   保險 / 研究所倒数挪回 `0x41c84f`、時光機快照时机、真人開局资金按角色减半、跨月重擺禮物 / 寶箱、
   工程車到期、牌堆守恒（弃牌回牌堆）、漲價卡比例门槛 0.5 → 0.66、拆除卡清單次序、
   遙控骰子查「格上有惡人」而非「有玩家」……
2. **随机流次序**（影响最大的一类）：台词阶梯那 13 处 `rand()` 从「客户端按状态哈希掷硬币、**不推进** RNG」
   改成 **core 在 exe 掷的那一刻掷**（`rules/speech-rand.ts` 的 `SPEECH_SITE` / `NEWS_OWNER_SITE`，原值记进
   纯表现瞬态 `lastSpeechRolls`，客户端 `speech-roll.ts` 按站点 + 说话人查）。此外老虎机自动转 4 轮、
   新聞开拍接着同一流、首次关押台词、小偷禮物台词、电脑买股 / 卖股进 reducer 掷全局 `rand()`、
   买卡候选与选股排名照 Watcom `qsort` 的真实次序、天使卡 0 级設施电脑支新增一次 `rand()`。
3. **局面形状**：`pending{auction}.resumePhase` / `.keepOwnerOnPass`、`pending.birthdayCard` 的
   `receiver` / `magicResume`、`SpecialActor.home`。
4. **新 action / 消息**：`stockScreen`（关股市屏收回特別融資）、`noticeBoard` 的 `open` / `close`。
5. **工具语义**：傳送機改成原版两段拾取（可搬惡人 / 地上物件 / 附身物件 ⇒ 搬附身者），`useTool` 改带精灵码；
   新增道具第 14 项「下車」。
6. **新功能补齐**：節日送卡、下車、傳送機两段拾取、真人持卡人那一问（嫁禍 / 免費卡确认框 + 效果挂起续跑）。

## 五、协议

**`PROTOCOL_VERSION` 10 → 11**（协调方对整批审计**一次性**升；六个区的分支都没有动版本号）。
理由：`rngState` 进指纹 ⇒ 少掷 / 多掷一次 `rand()` 之后每一步都不同；另有 `stateFingerprint` 纳入
`toolStock` / `cardAmount`（`5290899`，口径本身变了）、新 action、`pending` 新字段、`useTool` 编码变化。
完整分类写在 `packages/core/src/net/protocol.ts` 的 v11 注释块里。

## 六、门禁

`RICH4_WORKSPACE=/Volumes/Kingston/大富翁4重制版 pnpm check`（typecheck + lint + 全量 vitest）——
六区全部合入 `ds/audit-provenance` 之后跑，**0 skipped**。合并过程中由测试抓出并修掉的三条互踩见
`provenance-econ.md`：旅館多记 `費/100` 敌意、魔法屋二级判定漏记牌堆、`monthlyPaid += 2000×天×物價` 复活。

## 七、还没修的（有证据，未改）

- **events**：`FU-4` 住店走回棋盘那一回合的神明尾块（`0x418f25..0x418f59 call 0x40f381`，时序未逐拍核）；
  `FU-6` 惡人抢银行当场破产（`0x41d375`）；`FU-5` 剩项 —— 老虎机窗金额仍是客户端按钱差反推
  （应读 `lastGodPower.amount`，`0x43f68c`）。
- **econ**：`PAY-05` 破产清算早于收款人入账；`STK-57` 分紅破产当场清算；`AUC-43/AUC-48` 破产拍卖抽签与开拍
  交错；`BNK-17`；`FAC-15/PUR-16`（台词 rand 口径，见下）；`WLT-02` 身家 2^31 回绕。
- **ai-move / ai-econ**：`ai/policy.ts` 里托管真人开着保釋窗仍走自拟分支（`bail` 要加 null 槽）；
  首建被衰神挡下时原版已写 `+0x18` 种类；离店时 `10×价` 记进企業 `+0x28/+0x2c` 未建模。
- **cards**：10 条，其中 `C23-1` 請神符真人「视野内最近」的物件（视野不在 core 状态里）、
  同一格多物件按最高槽位取（approx）。
- **loop**：0 条。

## 八、跨区收口与两条给下一轮的提醒

1. **AUC-45 归 econ 修掉了**（拍賣卡在掷骰前打出 ⇒ 落槌回原相位，不再白丢一掷），`cards` 不要重复修；
   `econ` 台账里已写明。反向地，events 的 `FU-2`（傳送機搬惡人 / 物件）由 cards 的 `5256fa6` 实现，
   events 台账记为 fixed-by-cards。
2. **`5256fa6` 的联机镜像已补**：`packages/server/src/teleport-mp.test.ts`（8 例：搬自己 / 搬惡人 / 搬地上物件 /
   附身物件 ⇒ 搬附身者 / 地產两段 / 三条拒收）。
3. **⚠️ 建议下一轮做的一件事：`stateFingerprint` 的字段白名单不全。**
   `packages/core/src/net/protocol.ts` 的 `stateFingerprint` 覆盖了 `players[].nodeId`，但**不含**
   `specialActors`（整张表）、玩家的 `xpos/ypos/direction/lastNodeId`、以及 `landTenure/landType/landLastToll`
   —— 而这些正是傳送機 / 走子会写的字段。补镜像用例时实测过：把服务器的 node 20 挪 137 px
   （`room.state.players[0].xpos = 1385` vs 镜像 `1248`），两边指纹**仍然相等**（`d2243728`）。
   即「指纹相等」目前**不能**证明惡人 / 坐标 / 到期日没有分叉。
   本轮**没有动它**（改白名单会让所有既有局面的校验和变化，超出「按原版改规则」的审计范围），
   但 `teleport-mp.test.ts` 里已改用「指纹 + 整份 `toEqual`」双保险。
   注意 `5290899` 已经开过这个口子（`toolStock` / `cardAmount` 进指纹），且旧回报 fixture 仍按不含这两格比对 ——
   要做的话建议与 fixture 口径一起处理，并同时 bump 协议号。

---

# 九、follow-up 收尾 + 第二次上线（2026-09-25 下午）

> 本节**取代**第五、七、八节里被它更新的条目（协议号、未修清单、指纹缺口）。

需求方指令：「继续做完查出来的问题并部署上线」。于是把第七节列的 follow-up 逐条做完，
**能修的修、能证伪的证伪、剩下的写清为什么不能修**，然后重新上线。

## 9.1 修掉的

| 区 | 项 | 原来 → 按原版 |
|---|---|---|
| 全局 | **指纹字段不全** | `stateFingerprint` 只覆盖 `players[].nodeId` ⇒ 补上玩家的 `xpos/ypos/direction/lastNodeId`、`specialActors` 整表、`landTenure/landType/landLastToll`、企業的 `companyFunds/companyProfit/commercialShares/commercialOwners`。实测反例：服务器 `xpos` 1385 vs 镜像 1248，两边指纹都是 `d2243728`。`viewRotation` **刻意不进**（每个客户端各自的镜头），并用测试反向钉住 |
| 全局 | **服务器与客户端局面不一致** | `Room` 的 topo 补上 `landscapes`（`0x43ecef` 读景观记录）—— 入監 / 入院时服务器留**格心**、客户端摆**景观**；先前看不见是因为指纹不收坐标，补了坐标就会直接报失步 |
| events | FU-6 | 惡人抢银行把人抢破产改到 `pay_money` 里**当场**发生（`0x0041d375` 早于 `0x0041d37e` 收款）—— 先前整趟走完才收口，后面几步还看得见已出局的人、清算那几掷也排在后面 |
| events | FU-5 剩项 | 老虎机窗金额改读 `lastGodPower.amount`（`0x0043f68c` = 状态机返回值 `0x004408c8`），删掉「按钱差反推」 |
| econ | PAY-05 | 收款方入账挪到**整条清算拍卖链之后**（`0x0041d376` 早于 `0x0041d387`），新增队列项 `{kind:'credit'}` |
| econ | STK-57 | 分红当场清算（`0x0042beba` 早于開獎 `0x0041d094` / 月结 `0x0041d09e`）：`advanceGameDay` 拆成「分红逐人结」+「尾段」，尾段挂 `dayRolloverTail` |
| econ | AUC-43 | 破产拍卖「抽一处 → 开一场 → 再抽下一处」（`0x0040d1f7` ↔ `0x0040d1e3`），逐位对 `rngState` 钉住 |
| econ | WLT-02 | 身家是 32 位整数：**用 Unicorn 跑原版真码实测** `INT_MAX+1 → -2147483648`、`1000×3e6 → -2147483648` |
| econ | 扫 `pending: null`（45 处） | 1 处真错：`endTurn` 的惡人段出口会把清算拍卖丢掉 ⇒ 队列接不上、卡死；其余 44 处逐个核过是对的 |
| econ/ai | BNK-17 / FAC-15 / PUR-16 / L7 / L45 / L62 | **复核后确认早已修好**（台账文字过期），逐条重开 VA 验证并补测试，没有重复改代码 |
| ai | L48 | 电脑 / 托管逛百貨的營業額也记进企業帳 —— 旧注释「电脑那支不记」读漏了 `0x0042f24f cmp eax,6 / jge 0x42ed50`（两支共用 `0x42ed75/0x42ed7e`） |
| ai | FU-2 | 电脑 / 托管**每一次决策**的 `rand()` 改吃全局序列（出牌起点、个性闸门改懒求值、道具环形起点、判定里的 `%n`、前瞻岔路、骰子数）—— 这是本轮改动面最大的一条 |
| cards | 同格多件 | 节点反向索引按**位或**取（`0x0040e13c`），不是「最大槽号」：死神槽压路障槽 `15\|17=31` ⇒ 槽 30 的地雷 ⇒ 原版那一格**炸人住院 3 天** |
| cards | C23-1 | 請神符候选按**当前镜头**筛视野（`0x00444d2b` / `0x40a45c` 摊平的是屏幕空间 440×440 id 图）—— 先前「全地图最近」隔半张地图也请得到 |
| cards | 工程車 / 傳送機快照 | 复核确认已在 `df14113`，补端到端用例与镜像断言 |
| ai / events | **Q-TOOL-1 + ai FU-1** | 飛彈/核彈/颱風/外星人的爆炸范围与电脑出牌的视野，改成原版那张 440×440 **id 图的屏幕方窗**（新 `rules/board-window.ts`：投影表 + 锚点 + 半开区间；地块/設施用自己的 x/y；「没房子又没主」不进图）。★ 取窗**恒用视角 0**（需求方 2026-09-25 口径）—— `viewRotation` 刻意不进指纹（§八.3）；镜头钳位仍留。候选次序：`0x409ef9` 那张**节点**表已按屏幕行序收（`ds/oi-visible` 并入，V-1a），`0x40a45c` 的**实例**路径仍 (y,x)（见 D-005） |

## 9.2 复核后**证伪**的（不是缺陷，不改代码）

- **events FU-4**：住店走回棋盘那一回合的「神明尾块」看似会生效，实际 `0x40f381` 头一道闸
  `0x40f39e cmp byte [p+0x32],0 / jne` 在住店期间**恒为真**（`+0x32` 是 1..N-1 或 0x80）⇒ 天使 / 惡魔 / 土地公
  在旅館格上**零效果**；監獄 / 醫院那一条虽进得去，但那一格是 landscape、没有地块 / 設施句柄，三支同样直接返回。
  台账原先那句「在旅館格上生效」是**读反了**。
- **econ BNK-17 / FAC-15 / PUR-16、ai L7 / L45 / L62**：均已在更早的提交里修好（见 9.1 末两行）。

## 9.3 仍未修（有证据、说清为什么）

- **ai FU-5 预演顺延**：写了实测工具（`tools/audit/fu5-card-rehearsal-scan.ts`）跑 20 局全电脑长局 ——
  判定肯出 **806** 次、预演挡下 **0** 次 ⇒ 这条偏差**当前不可观测**。要修需要 reducer 能非活锁地收下
  「出了但没生效」的 AI 出牌，并逐卡核 `consume_card`（`0x441343`）的 36 个调用点在失败分支之前还是之后。
- **ai FU-3**：`0x421714 mov eax,edx` 的 `edx` 来自 `0x409b18` 出口残值，取决于循环最后一次迭代走哪一支
  —— 与运行时实体表相关，**静态定不出**，只能原版跟一次。
- **ai FU-4（`whoPlays == 3`）**：分派表 `0x418c3d` 的 `[3]=[4]=0x418e7a`（什么都不做），照抄会让该座位
  这一回合不发生任何事、**游标不推进 = 软锁**；要跳过就得发明原版没有的规则。只有读档可达。
- ~~**ai FU-1 画面投影**：复刻镜头 / 旋转 / 投影表是一大块图形保真工作，本轮不做；台账已写到可施工粒度。~~
  **✅ 2026-09-25 已做（Q-TOOL-1 结项）**：窗口 = 原版那张 440×440 id 图的屏幕方窗，
  取窗**恒用视角 0**（需求方口径：「联机时的爆炸范围统一按视角0取值」）；`viewRotation` 刻意不进指纹
  这一点由此**不再挡路**（正是选视角 0 的理由）。仍未复刻：镜头钳位；候选次序里
  `0x409ef9` 的**节点**表已按屏幕行序收（`ds/oi-visible` 并入），`0x40a45c` 的**实例**路径
  （`visibleEntities` / `visibleRivals` / `visibleObjects`）仍按节点 (y,x) 近似 —— 见 D-005。
- **econ AUC-48**：魔法屋多位中签者那一条要把逐人循环挂起（状态可见差别只在第 2 场开拍时的心理价位）。
- **econ 嵌套清算的拍卖次序**：本引擎按 FIFO 追加，原版嵌在外层第 1 场收官处 —— 不改钱数，只改先后。
- **cards O-37 残余**：那一字节是**存下来**的，`release_object`（`0x0040e243`）与 `attach_object`（`0x0040ebc7`）
  整字节清零 ⇒「同格两件、先收走一件」这一种仍近似；要逐位复刻得在 state 里存每格反向索引。

## 9.4 协议与门禁

- **`PROTOCOL_VERSION` 11 → 12**（协调方对收尾批次一次性升）。理由四类：①指纹口径本身变了；
  ②服务器 topo 补 `landscapes` 改了服务器局面；③`pendingQueue` 的项扩成 `QueuedStep[]`
  （`bankruptcyDraw` / `credit` / `dayRolloverTail`）；④电脑决策改吃全局流、惡人抢破产当场发生等随机流次序变化。
- **门禁**：`RICH4_WORKSPACE=... pnpm check` ⇒ typecheck ✓ / lint ✓ / **412 个测试文件、8660 条用例全过、0 skipped**。

## 9.5 上线

- 本机构建 `pnpm --filter @rich4/client build` ⇒ `assets/index-DJTES4Ou.js`（上一版 `index-722CyCqV.js`）。
- `rsync` 源码（`packages/{core,data,assets-pipeline,server}`）+ `dist-web/`（`--delete`）到
  `root@<SERVER_IP>:/srv/rich4/rich4-remake`，`chown -R rich4:rich4`，`systemctl restart rich4`。
- 校验：`pnpm-lock.yaml` / `package.json` 与线上**逐字节一致** ⇒ 无需 `pnpm install`；
  服务 `active`；线上 `PROTOCOL_VERSION = 12`；`index.html` 指向新 bundle；站点 401 = 共享密码门（正常）。
- 需求方测试入口：<https://rich4.locoko.com>
