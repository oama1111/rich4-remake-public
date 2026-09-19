# 差距清单 · 主循环 / 小游戏 / AI / 随机数

> 生成方式：以 `rich4-spec/docs/systems/{game-loop,small-games,ai}.md` 为权威，
> 逐条核查 `rich4-remake` 实现。本轮只做分析，未改动任何代码。
>
> 约定：
> - 原版证据 = `0xADDR`（VA），必要处附汇编要点；均可在 `rich4-spec/` 用
>   `python3 tools/rich4dis.py func 0xADDR` / `python3 tools/r4dump.py 0xSTART 0xEND` 复核。
> - remake 证据 = 以 `rich4-remake/` 为根的 `文件:行`。
> - 本文件**不引用** `rich4-re/` 作为证据（铁律 1）。凡实现文件把 `rich4-re/` 当 `@source`
>   的地方，在第七节单列。
> - 落点跳表 `0x4197e9` 的 17 项已用 `rich4-spec/gen/jumptables.json` 逐项核对：
>   `{0x4198b9, 0x41b3d0, 0x41b11e, 0x41b128, 0x41b132, 0x41b13c, 0x41b146, 0x41b15e,
>   0x41b16c, 0x41b17a, 0x41b184, 0x41b21e, 0x41b2a3, 0x41b302, 0x41b396, 0x41b3b9,
>   0x41b3cb}`，与规格表一致。

---

## 一、结论摘要

### 1.1 ★ 落点分派（17 项）

全部 17 项在 remake 里都有接线的处理路径，**没有一项「缺失」**。

| 判定 | 项数 | type |
|---|---|---|
| **1:1** | **12** | 0、1、2、3、4、5、9、11、12、14、15、16 |
| **有差异** | **5** | 6、7、8（三个小游戏）、10（得點券 50 點）、13（抽到一張卡片） |
| **缺失** | **0** | —— |

### 1.2 随机数是否一致：**算法一致，消耗序列不一致**

- PRNG 本体**位级一致**（乘数 `0x41C64E6D`、增量 `0x3039`、`(state>>16)&0x7FFF`、uint32 截断，
  `packages/core/src/rng/watcom.ts:23-89`），与 `rich4-spec/tests/test_prng.py` 的机器码真值相符。
- **消耗次数/顺序至少有 6 类不一致**（第六节 6.3 逐处列出）：
  1. **移动选路 `0x40c196`**：原版「只要有候选就 `call rand`」——**1 个候选也掷**；
     remake `state/reduce.ts:657` 在 `candidates.length === 1` 时提前返回、**不掷**。
     正常路径上几乎每走一格就少掷一次，是最严重的一条；
  2. 小游戏「不玩」出口少掷 1 次（原版 `0x415457` + `0x4154b6` 共 2 次）；
  3. 得點券 50 點少掷 1 次（原版 `0x41b1f8` 的 `rand()&1` 选台词）；
  4. 抽卡格在卡价 51..100 时少掷 1 次（原版 `0x44f230` 内 `0x44f280`）；
  5. AI 决策链至少 6 类点用状态派生替身、**不推进 `rngState`**（D-004 的扩大版）；
  6. 银行 AI 两处**判据本身缺失**（`0x42bf14` 的 `rand()%3==0`、`0x436893` 的 `rand()%10==0`）。
- **播种策略的记录与代码不符**：D-001 称单机在「启动 / 读档后 / 每回合」三处重播种、且存档不写
  PRNG 状态；实测 `rng/policy.ts` **只被它自己的测试引用**，全仓没有任何地方派发 `{type:'reseed'}`，
  且 `serializeGame` 把整个 `state`（含 `rngState`）写进存档（6.2）。

### 1.3 最严重的 6 条（跨全部章节）

| # | 条目 | 位置 | 类型 | 严重度 |
|---|---|---|---|---|
| 1 | **`pickNextNode` 单候选不掷随机数**（原版 `0x40c196` 掷） | `state/reduce.ts:657-659` | 时序错 | 阻断 |
| ~~2~~ | ~~**阻碍/关押的释放链完全没接**~~ **✅ 已闭合**（簇 A 修复 + 第 83/84 条）：`released` 已接、`release()` 在用、占用表会清、刑满后走「走回棋盘」那一回合 | `state/reduce.ts` 的 `endTurn`/`startTurn`、`state/release-chain.test.ts`（9 例） | 已完成 | — |
| 3 | **企鵝挖寶「挖到炸彈立刻結束」缺失**（原版 `0x412b90/0x412b95`） | `client/src/minigame-screen.ts:526-538` | 缺失 | 阻断 |
| 4 | **七彩氣球少一条跑道**（原版 `0x41305e cmp ebx,0x280` ⇒ 8 条，含 x=600） | `client/src/minigame-screen.ts:645-646`（7 条） | 数值错 | 阻断 |
| 5 | **喜從天降炸彈起爆概率方向反了**（原版 `0x4137a1 jne` 跳过 ⇒ 30%，remake 70%） | `client/src/minigame-screen.ts:1179` | 算法错 | 阻断 |
| 6 | **月结缺累计字段清零**（原版 `0x439ec6-0x439ef2` 清 `+0x42/+0x5c/+0x60`），奖项评分自第 2 个月起用跨月累计值 | `rules/monthly.ts:216-219`、`client/src/monthly-screen.ts:855-862` | 缺失 | 严重 |

**次严重**：抽卡格满手牌口径错（`state/reduce.ts:1007` 是「满就不发」，原版 `0x4412e4` 是
「先丢最便宜的再收新卡」——同仓 `cards/rob.ts:101-112` 的 `giveCard` 才是正确口径）；
小游戏/点数格少掷随机数；银行 AI 两条判据缺失；`core` 缺 `[0x497159]` 与落点层 `+0x37` 两道闸。

### 1.4 主循环机制的核对结论

- 原版**没有**统一的时间驱动动画状态机，节奏由 24 处 `SetTimer`（`game-loop.md` §三）驱动；
  remake 用「action 流 + 每帧定时器轮询 UI 屏」等效（`client/src/main.ts:1443/3351`、
  `state/reduce.ts:3214-3227`），**没有固定帧节拍**。
- **消息 `0x3b9` 没有被当导航消息**：它在原版是 WndProc 的音乐开关
  （`0x4019f2 → 0x401b08`，`0x401b16 call 0x45174a` 暂停 / `0x401b1d call 0x454d2c` 恢复）。
  全仓唯一提到它的是 `client/src/speech-bubble.ts:105` 的一句注释，且注释里的数值换算有误
  （`0x3b9` = 953，不是 1000；超时常量是 `0x3e8`）。
- **模态嵌套**：原版是显式的「深度计数器 `0x46cad8` + 层级过滤器数组 `0x48a010[depth]`」
  （`0x4018e7`）；remake 是「有序屏表 + 各屏自报 `active()`」
  （`client/src/main.ts:4240-4246`、`client/src/screens.ts:37-76`），core 侧只有
  **单层** `pending: PendingInteraction | null`（`state/types.ts:656`）。
  结构不同（无深度值、无栈），是否逐屏等价**无法判定**（第八节 #3）。

---

## 二、★ 落点分派（landing type）逐项对照表

分派依据（原版）：`0x41982d` 取 `node = 0x498e80 + id*0x28`，`type = dword[node+0x24] & 0xff`，
`cmp ebx,0x10 / ja → 0x41b3d0`（>16 即无事件），`0x4198b2 jmp dword [ebx*4 + 0x4197e9]`。
remake 的等价取法是 `node.specialKind = flags & 0xff`（`packages/core/src/loaders/map.ts:526`），
边界 `MAX_SPECIAL_KIND = 0x10` + `handlerFor` 越界返回 `'none'`
（`packages/core/src/rules/special-square.ts:69-74`），分派在
`packages/core/src/state/reduce.ts:988-1047`（`case 'settle'`）。

| type | 原版语义（证据 @source） | 原版处理函数 | remake 现状（文件:行） | 是否 1:1 | 差异 |
|---|---|---|---|---|---|
| 0 | **地产 / 设施 / 企业落点结算**（买地、盖房、过路费）。`0x4198b9` 按 id 区间分派：`0x7d0..0xf9f` 住宅（`[0x498e84]`，stride `0x34`）、`0xfa0..0x176f` 商業（`[0x498e88]`，stride `0x38`）、`0x1770..0x1f3f` 設施（`[0x498e7c]`，stride `0x34`） | `0x004198b9` | `state/reduce.ts:1049-1138`（住宅 `landingOnLand` → 买/加盖/过路费；設施 `landOnFacility` @`4668`；企業 `landOnCompany` @`4479`） | 是 | remake 按 `node.ref.kind` / 地块索引分派，原版按 id 区间分派；**结果等价、形状不同**。`0x419873..0x41987e` 的 `玩家+0x37`（夢遊）二次闸门在 remake 由 `rules/turn-start.ts:95-97` 提前拦掉（相位 `-1`），落点根本不进，故不构成差异 |
| 1 | **普通格 / 无事件**。跳表直指共同尾码 `0x41b3d0`（`mov al,[esp+0xf4] / add esp,0xf8 / pop.../ ret`），所有桩都 `jmp` 到这里 | `0x0041b3d0` | `state/reduce.ts:1046` → `special-square.ts:132-139` 返回 `handler='noop'`；`needsInteraction(1)=false`（`rules/interaction.ts:329-341`）→ 无 pending，`phase='turnEnd'` | 是 | 无。remake 管它叫 `SPECIAL_KIND.PARK`（`loaders/map.ts:40`），语义同为「落地无效果」 |
| 2 | **新聞**。`0x41b11e call 0x44b6df` | `0x0044b6df` | `state/reduce.ts:1013-1018` → `drawAndApplyNews` @`3424`；牌堆 `events/deck.ts:47-76`、效果表 `events/news-effects.ts` | 是（分派层） | 抽事件的洗牌与原版同构：`0x448b81` 每轮 `rand()%剩余数` 再线性跳过已用槽，**恰好消耗 36 次**；remake `deck.ts:47-55` 同。洗牌时机也一致：原版在开局初始化段 `0x4074bf`（`r4scan` 唯一调用点），remake 在 `rules/new-game.ts:386`。效果覆盖（36/36）属新闻专题，本表不重复判定 |
| 3 | **命運**。`0x41b128 call 0x44db81` | `0x0044db81` | `state/reduce.ts:1019` → `drawAndApplyFortune` @`3261`；`events/fortune-effects.ts` | 是（分派层） | 牌堆 37 项，原版洗牌 `0x44baea` 由 `0x4074c4` 调用（紧接新闻之后）；remake `rules/new-game.ts:387`，**顺序一致** |
| 4 | **監獄格（保釋）**。`0x41b132 call 0x43d304`；占用表 `in_prison_flag[0..7]` 全 0 直接返回（`0x43d324`） | `0x0043d304` | `state/reduce.ts:1025-1030` → `enterVisit` @`2497` → `rules/visit.ts`（占用表全空即 `phase='turnEnd'`，`reduce.ts:2503`） | 是 | AI 路径的 3 个随机点逐一对应：`0x43d3d8 call rand`（50% 不管）、`0x43d44f call rand; idiv 3`（1/3 追加 NPC）、`0x43d4ac call rand; idiv esi`（选人）→ `rules/visit.ts:164-203` 的 `decideBail`，且用 `randomsUsed` 精确回写已用次数（`reduce.ts:2517-2520`） |
| 5 | **醫院格（出院）**。`0x41b13c call 0x43e9a4` | `0x0043e9a4` | 同 type 4（`reduce.ts:1025-1030`，`kind='hospital'`） | 是 | 同 type 4 |
| 6 | **小游戏：企鵝挖寶**。`0x41b146` → `imul ebx,[0x49910c],0x68` / `call 0x415215` / `0x41b152 add word [ebx+0x496b98], ax`（返回值只加到「點券」） | `0x00415215` | `state/reduce.ts:1023` → `enterMinigame` @`2441`；结算 `settleMinigame` @`2467`；常量 `places/minigame.ts:26-86` | **差异** | 「不玩」出口少掷 1 次 rand（见第六节 6.3）；真正玩法不进 core（有意，记 D-MINI-5 等） |
| 7 | **小游戏：七彩氣球**。`0x41b15e call 0x4154dc` → `jmp 0x41b152`（共用加點券尾） | `0x004154dc` | 同 type 6（`MINIGAME.BALLOON = 7`，`places/minigame.ts:30`） | **差异** | 同 type 6 |
| 8 | **小游戏：喜從天降**。`0x41b16c call 0x4155fc` → `jmp 0x41b152` | `0x004155fc` | 同 type 6（`MINIGAME.GIFT = 8`） | **差异** | 同 type 6 |
| 9 | **樂透**。`0x41b17a call 0x4315cc` | `0x004315cc` | `state/reduce.ts:1036` → `landOnLottery` @`3668` | 是 | 电脑当场买票 `rand()%空槽数`（原版 `0x4316db`）对应 `reduce.ts:3675-3679`（`aiBuyTicket`），一次 rand；真人 `pending kind='lottery'`（交互定义 `rules/interaction.ts:93`） |
| 10 | **得點券 50 點**。`0x41b184`：读图素 `0x219`、显示 `0x463a81`（1000 ms）、`0x41b1d7 add word [player+0x30], 0x32`、随后 **`0x41b1f8 call rand; and eax,1`** 选台词（`0x48084a + character*0x168 + eax*4`）→ `call 0x44ef41(player,0,text)` | `0x0041b184` | `state/reduce.ts:997-1001`（`pointsDelta`）+ `special-square.ts:82-86,141-142`（`POINTS_50: 0x32`） | **差异** | remake 只加 50 點券、**不掷那次 rand**（原版注释里那两次 `rand()` 只出现在 50 點这一档，30/10 檔没有）。见第六节 6.3 |
| 11 | **得點券 30 點**。`0x41b21e`：`0x41b271 add word [player+0x30], 0x1e`；收尾用**固定**台词 `0x480852 + character*108`（`0x41b28d`）`jmp 0x41b211`（复用 50 點桩的 `player_say` 尾），**无 rand** | `0x0041b21e` | 同 type 10（`POINTS_30: 0x1e`） | 是 | 原版无随机；remake 无随机，一致 |
| 12 | **得點券 10 點**。`0x41b2a3`：`0x41b2f5 add word [player+0x30], 0xa`，随后直接 `jmp 0x41b3d0`（**既无台词也无 rand**） | `0x0041b2a3` | 同 type 10（`POINTS_10: 0xa`） | 是 | 无 |
| 13 | **抽到一張卡片**。`0x41b302`：图素 `0x218`；`0x41b343 call 0x441e12(player)` → 卡号（1 基，0=不发）；卡名表 `[eax*8+0x47fdea]`；`sprintf` «得到%s！»（`0x463aa8`）；`0x41b373 call 0x441f73`（显示）；`0x41b37b mov al,[ebx*8+0x47fdef]`（卡价）→ `0x41b38c call 0x44f230(player, price)` | `0x0041b302` | `state/reduce.ts:1002-1009` + `special-square.ts:144-149` + 抽卡器 `rng/watcom.ts:140-149` | **差异** | ① 发牌口径错：原版 `0x441e12` 内部经 `0x4412e4(player, card)` 发牌——手牌满 15 张时**先丢最便宜的一张，再把新卡放进去**（`0x4412e4` 逐指令：`cmp eax,0xf / jne 找空槽` → `0x44128f` 取最便宜 → `0x441343` 删 → 找第一个空槽写入）；remake 在 type 13 是 `if (p.cards.length < 15) push`（`reduce.ts:1007`）——**满手牌时丢掉的是新卡**。同仓 `cards/rob.ts:101-112` 的 `giveCard` 才是正确口径，两个调用点各写一套。② 原版在卡价落在 `(0x32, 0x64]` 时 `0x44f230` 会 `call rand; and eax,1` 选台词（`0x44f27b..0x44f285`），remake 无该消耗 |
| 14 | **銀行**。`0x41b396 call 0x4379c9`（ATM 入口），`0x41b39b cmp byte [0x46caf8],0 / jne 出`，否则 `0x41b3af call 0x436668(word)`（柜台，实参 = `word[node+0x20]`） | `0x004379c9` + `0x00436668` | `state/reduce.ts:1041`（`rebalanceBankOnArrival` @`3721`，对应 `0x4379c9` 的非真人「按 `+0x19` 重分现金/存款」支）+ `pendingForSpecial` 的 `'bank'`（`reduce.ts:3768-3778`，对应柜台；`daysRejectedByBank != 0` 直接返回，对应 `0x43667b`） | 是（分派层） | 分派层 1:1；但是**柜台里的 AI 自动贷款**缺两条判据（`0x436893`/`0x4368bb`），详见第五节 #13 |
| 15 | **百貨公司**（⚠️ 规格表把这一项写成「企業格」，并多写了一个 `call 0x43380a`——**实测 `0x41b3b9` 只有 `push word[node+0x20]; call 0x42e931; jmp 0x41b3b4`，没有第二个调用点**；`0x42e931` 即 `_rich4_ui_shop_entry`，见 `known-deviations.md` 的 Q-SHOP-1 与 `places/shop.ts` 文件头） | `0x0042e931` | `state/reduce.ts:1033` → `enterShop` @`4144`；`pending kind='shop'`（`reduce.ts:3783-3811`）；`places/shop.ts` | 是 | 若按规格字面（「企業格」+ 两次调用）判定，则 remake 与之不符；按 `0x41b3b9` 的实际指令与 Q-SHOP-1，remake 的「百貨公司」判读才与机器码一致。**规格表此处应订正** |
| 16 | **魔法屋**。`0x41b3cb call 0x43380a`（12 项轉盤窗） | `0x0043380a` | `state/reduce.ts:1021` → `runMagicHouse` @`2087`；`places/magic-house.ts` | 是 | 转盘随机与原版一致（先 `rand()%12` 抽目标、名单含自己→效果固定 6、否则 `rand()%11` 且 `6→7`），见 `known-deviations.md` 的「两个转盘都已解出」一节 |

**计数**：1:1 = **12**（0/1/2/3/4/5/9/11/12/14/15/16）；有差异 = **5**（6/7/8/10/13）；缺失 = **0**。

---

## 三、回合流程差距（回合开始/移动/落点/结束/月度结算/胜负判定）

| # | 条目 | 原版规格（证据） | remake 现状（证据） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 1 | 主循环结构 | 无统一主循环；24 处 `SetTimer`（IAT `0x462324`）周期仅 50/100/250/500/1000 ms（`game-loop.md:33,101-134`）；另有多媒体定时器 `timeSetEvent(20,5,0x401f98,0,TIME_PERIODIC)` = 50 Hz 渲染，`0x401fad` 按 `[0x46cb20]={6,4,2,0}` 分频后 `0x401d88 if([0x46cafa]) call 0x40d7c4`（`known-deviations.md:2990-2993`）—— `game-loop.md` §三 只登记 5 档，与 Q-TURN-1 的 20 ms/分频记载**不一致** | 无帧节拍：状态推进＝「action 泵」逐条驱动 —— `client/src/main.ts:1443`（`scheduleHumanTurn` 单条 `dispatch`）、`:3351`（`scheduleAi`）、`:1343-1346 humanDelay()=max(tickMs(speed), renderer.lastWalkMs())`；引擎自推类由 `core/src/state/reduce.ts:3214 autoAction()` 负责（服务器无头跑同一条）；固定帧只用于渲染（`main.ts:1403 requestAnimationFrame`） | 接口不符 | 轻微 | 不改行为；要回答「同一帧多定时器到期」的顺序，须先补完 `game-loop.md` §六 待办 1（24 处 SetTimer 各自所属窗口/阶段） |
| 2 | 模态消息泵与导航栈（**嵌套语义**） | `0x4018e7`：`0x4018eb mov edx,[0x46cad8]; inc; mov [0x46cad8],edx`；`0x4018fa mov edx,[esp+0x24]`（第 1 参＝处理器）；`0x4018fe mov [eax*4+0x48a010],edx`；`0x401957 dec [0x46cad8]` —— **按深度入栈、退出即回退**（`game-loop.md:42-55`；`ui.md:118-153`，42 个注册点见 `ui.md:159-202`）。可证的深度 2 用例：收租模态里再弹「是否使用免費卡？」（`cards.md:4695`：`0x444a60 → 0x444ad8 确认框 / 0x444af4 call 0x440ba8`） | core 只有**单层**待决交互：`state/types.ts:656 pending: PendingInteraction \| null`（全仓仅此一处）；`rules/interaction.ts:27-293` 是 discriminated union。客户端另有分层取消栈 `client/src/panel-cancel.ts:100-140 CANCEL_LADDER`（pick/dialog/amountPage/shop/loan…，逐层带 `loc_*` 出处）——能表达堆叠 UI，但 core 无「深度」概念 | 缺失 | 严重 | 免费卡/嫁禍卡真人确认分支正是被放弃的那条（`rules/toll-flow.ts:141-149`「真人本应弹窗问…先按电脑规则替他决定，记 D-008」；`known-deviations.md:738`）。要复刻需把 `pending` 换成可嵌套栈（或给 `PendingInteraction` 带 parent），作答路由按层分发 |
| 3 | 消息 `0x3b9` | **不是导航消息，是音乐开关**：`0x4019f2 cmp eax,0x3b9 / je 0x401b08`；`0x401b0d cmp byte [0x46cb02],0 / je 0x401b1d`；`0x401b16 call 0x45174a`（清 `[0x46cb02]` + `PostMessage(hwnd,0x402,0,0)`，**暂停 BGM**）/ `0x401b1d call 0x454d2c`（恢复）。`ui.md:15,119` 亦只列为 `0x3b9` | ✅ 未当导航消息。`grep -rn "0x3b9" packages/` 仅两处注释：`client/src/speech-bubble.ts:105`（称某函数是「等消息或到点」的循环、`0x3b9`=1000 是超时）与构建产物 `client/dist/speech-bubble.d.ts:60`；音乐走 `main.ts:2937 MusicPlayer`、`:2838`/`:2845-2846`（`setVolume` / `next.music===0 → stop()`），与 `0x3b9` 无关 | — | 轻微 | 订正 `speech-bubble.ts:105` 注释：`0x3b9` 是 WndProc 的音乐开关消息，写成「1000 ms 超时」会误导接线 |
| 4 | 回合状态机 / 相位 | `0x40c912` 返回：`0`＝受困（住宿/消失/坐牢/住院，`0x40c94c cmp dword [eax+0x496b9a],0 / jne`）、`0xffffffff`＝夢遊跳過（`0x40cba5`）、否则 `who_plays`（`0x40cbba`）（`places.md:147-176`）。`0x418d78 cmp eax,5 / ja 0x418e7a`；跳表 `0x418c3d`＝`{0x418d88(相位 0：`call 0x418e7f` 置受困动画相位 `0x83` + `0x46cafb=1`), 0x418d99(1), 0x418dc6(2), 0x418e7a(3), 0x418e7a(4), 0x418dc6(5)}` | `rules/turn-start.ts:71-100 evaluateTurnStart` 保留原始码 `raw`（`turn-start.ts:25-34`）；`turn-start.ts:124-129 turnController`：`who&0x04`→'ai'、`who&3===1`→'human'、否则 'ai'（常量 `state/types.ts:31-42`）。`state/reduce.ts:881-890`：`'skip'` → **直接 `{...state, phase:'turnEnd'}`**；`reduce.ts:902-905`：夢遊 → 立刻 `rollDice`（整段跳过落点） | 接口不符 | 严重 | 相位 0 只剩「跳过」这一半：原版还置受困动画相位 `0x83` 与 `0x46cafb=1`，并于受困期显示 `0x46320a «%s坐牢中 還剩%d天»`／`0x46321f` 住院（`places.md:173-176`）。remake 无 `0x83` 等价物，且 `grep -rn "還剩" packages/core/src packages/data/src` **零命中** —— 没有原版那种「%s坐牢中／還剩 N 天」的回合提示（`rules/confinement.ts` 只算天数；客户端仅 `auction-screen.ts:275-276` 在拍賣座位状态表里有「坐牢中／住院中」两个标签） |
| 5 | 回合开始（turn-start）顺序 | 回合内前置三步顺序在 `0x418dc6`（**AI 支**）：`0x418de5 call 0x42bf03`（買股，函数头 `0x42bf14 call rand` → `idiv 3`）→ `0x418dee call 0x42c79f`（賣股）→ `0x418dfc call 0x436b0a`（特別融資收回）→ `0x418e06 cmp [0x46caf8],0 / jne 0x418e7a` → `0x418e13 call 0x4284be`（公佈欄）→ `0x418e18 call rand / test al,1` → 奇 `0x441baa`（用卡）/ 偶 `0x447d97`（用道具）（`game-loop.md:322-350`；`ai.md:150-164`） | `state/reduce.ts:894`（`aiStep=0, aiBranch=0`）；`aiAdvance @ reduce.ts:3837-3849`：跨进 `aiStep 2` 时依次 `sweepSpecialFinance`（`3865`）→ `aiNoticeBoardTurn`（`3843`）→ `const branch = rng.next() & 1`（`3846`，**消耗 1 次**）；分派 `ai/policy.ts:136`。`reduce.ts:896-898`（保险天数）、`:901`（研究所）；`reduce.ts:1705-1707` 清空 `pending`，不跨回合 | 时序错 | 严重 | D-007 已承认「公佈欄三道闸与 `rand()&1` 在跨进第 2 步时一次性掷」；顺序与原版不同：原版 `買股→賣股→（公佈欄）→rand`，remake 是 `sweep→公佈欄→rand`（買/賣股在 aiStep 0/1）。应对位到各自 aiStep 边界，或把「随机流错位」写进偏离单 |
| 6 | 移動（骰子/岔路/機器娃娃） | 骰子 `0x419572`：`0x41958b test ecx,ecx / jne 0x4195ae`；为零时 `0x419591 cmp ebx,esi(ndices)` 循环 `0x419595 call rand` → `idiv 6 / inc edx`（**每颗各 1 次**）；非零 `0x4195ae mov esi,1 / mov [esp+0x10],ecx`（**遥控骰压成 1 颗、不消耗 rand**）。岔路 `0x40c12c..0x40c1a9`：4 槽筛（空槽／回头路 `cmp edx,edi(0x496b76)`／封路位）→ `0x40c196 call rand / idiv esi` 单次。機器娃娃 `0x40deb9 mov esi,9`（固定 9 步、不掷骰） | `rng/watcom.ts:108-125 rollDice`：`forced!==0 → dice=[forced]`（1 颗、不调 rng）；否则 `for(i<diceCount) dice.push(rng.below(6)+1)`；注释 `watcom.ts:99-107` 三点与原版一致。`reduce.ts:922-943` 用 `state.forcedDice` 后写回 0。`reduce.ts:649-663 pickNextNode`：候选 0 → `prev!==0?prev:from`；**1 → 直接返回（不掷）**；多 → `rng.next()%len`。`rules/special-actors.ts:255 DOLL_STEPS=9`、`spawnDoll @ 300-313`，`reduce.ts:2686-2700` | **时序错** | **阻断** | ★ 见 6.3 #2：`pickNextNode` 在 1 个候选时也必须掷一次（`0x40c196` 的 `test esi,esi / jne` 只判「有没有候选」）。另：`actions.ts:25-46` 的 `rollDice.forced` 标 `1..6` 但 core **未校验范围**，客户端注入 >6 会直接变成步数，建议夹到 1..6 |
| 7 | 落点分派边界 | `0x41983c..0x4198b2`：`mov ebx,[eax+0x24]; and ebx,0xff`；`0x419889 cmp ebx,0x10 / ja` → `0x4198a9 cmp ebx,0x10 / ja 0x41b3d0` ⇒ 越界**按普通落点** | `loaders/map.ts:514-527`（`flags & 0xff`、`NODE_SIZE=0x28`）；`reduce.ts:989 if (node.specialKind !== 0)`；`rules/special-square.ts:69 MAX_SPECIAL_KIND=0x10`、`handlerFor @ 71-74`（`>0x10 → 'none'`）；`settleSpecialSquare @ 119-139` 对 `'none'/'land'/'noop'` 返回零增量 | — | 轻微 | 边界一致，无需改；建议补一条单测钉 `specialKind=17/255` 走普通格（当前未见） |
| 8 | 回合结束（一輪一天、四大惡人每輪走） | `0x418f93..0x41902e`：`xor ebx,ebx`；`0x418f9b inc esi; mov [0x49910c],esi`；`0x418fa2 cmp esi,[0x499114] / jne`；到 8 则 `[0x49910c]=0; ebx=1`；4..7 逐个 `cmp byte [eax+0x498df2],0 / jne 0x418f95`；`0x41902a test ebx,ebx / je 0x419033` → `0x41902e call 0x41cf67`（**只有绕回 0 才推日期**）→ `0x419033 mov eax,[0x49910c]`＋`0x419039 call 0x41c84f`（对**新的** `current_player` 递减阻碍计数） | `state/reduce.ts:1625-1714 endTurn`：`tickDailyCounters`（`1637`，作用于 `state.currentPlayer`）＋神明（`1647`）→ `next = nextAlivePlayer(...)`（`1661`）→ `wraps = next <= state.currentPlayer`（`1666`）→ 有惡人 `activeNpcSlots`（`1673`）＋`npcRoundStep`（`1675`）；无惡人 `advanceGameDay`（`1685`）→ `currentPlayer: next, phase:'turnStart', pending:null, turnCount+1`（`1689-1698`）。`npcRoundStep @ 789-826`：**一条 action 只走一个惡人**（`npcStepOnce @ 729-772`，步数＝停留 0/龜行 1/其余 `rand()%9+2`），队空才 `advanceGameDay`（`812`）；`autoAction @ 3219` 把 `npcStep` 排在 `endTurn` 之前 | — | 轻微 | 顺序核对一致（释放缺失见 #11）。仅存疑：`turnCount` 在**每个玩家回合** +1（`1711`）而非每輪（见 #13） |
| 9 | 日推进顺序 | `0x41cf67`：`0x41cfa1 call 0x452117`（日期++）→ `0x41cfab inc dword [0x4990e4]`（**總天數先 +1**）→ `0x41cfb1 call 0x41d89e`＋`0x41cfb6 cmp eax,1 / je 0x41d1a5`（**勝負判定：达标即整个日推进返回**）→ `0x41cfbf call 0x423acf`（物价指数）→ `0x41cfc9` 起 `[0x4990dc]` 计数 → `0x41d066 call GetTickCount / 0x41d06e call 0x456f50`（**srand 重播种**）→ `0x41d076 call 0x4291d6`（行情收盘）→ `0x41d07b call 0x452444` → `0x41d080 and eax,0xff; cmp eax,0xf / jne` → `0x41d08f call 0x42ba97`（分紅）＋`0x41d094 call 0x431712`（開獎）→ `0x41d099 cmp edi,1 / jne 0x41d0ff` → `0x41d09e call 0x439bfa`（月結）→ `0x41d0f9 add [0x499084],edi` → `0x41d0ff` 起每日扫地契/涨价 nibble（`0x41d114` 地块 / `0x41d160` 設施） | `state/reduce.ts:3040-3188 advanceGameDay`：`advanceDate`（`3045`）→ `totalDays = state.totalDays + 1`（`3053`，**先 +1**）→ `checkVictory(..., totalDays)`（`3067`，达标 `return {... phase:'gameOver'}` `3079`，**跳过后续全部**）→ `updatePriceIndex`（`3086`）→ `refreshTradableShares`（`3094`）＋`tickStockCountdowns`（`3096`）→ `marketOpenOn(...)` 才 `tickStockMarket`（`3101`）→ `date.day===DIVIDEND_DAY`（`3112`，`places/company.ts:326`=15）分红 → `date.day===LOTTERY_DRAW_DAY`（`3127`，`places/lottery.ts:233`=15）開獎 → `if (newMonth)` 月結（`3136`）→ `totalMonths + (newMonth?1:0)`（`3169`）→ 地契到期/nibble 每日（`3143-3161`）。`srand(GetTickCount())` **故意不复刻**（`reduce.ts:3032-3034` 注释） | 时序错 | 严重 | 顺序与条件**逐条对齐** ✅；两条差异需再核：① 原版 `0x41d076 call 0x4291d6` 是行情收盘，remake 只在 `marketOpenOn(...)` 为真才走（`reduce.ts:3098-3103` 把它等同休市日门控）——须确认 `0x4291d6` 内 `call 0x428d01 / cmp eax,1 / je 结束` 的确切语义；② 原版 `0x41cfc9` 起那段计数（`[0x4990dc]`）在 `advanceGameDay` **内部**、发生在 `0x423acf` 之后，remake 未见对应实现 |
| 10 | 月度结算 | `0x439bfa`：填 `0x48c418/0x48c420`（`0x439cae-0x439ccc` 按 `who_plays!=0`）→ `Wait_0402_Message(0x437e61,0)`（**嵌套消息泵**）→ 收尾 `0x439ec6-0x439ef2` 把每人 `+0xaa(+0x42)`、`+0xc4(+0x5c)`、`+0xc8(+0x60)` 清 0（`docs/deviations/T-041.md:9` 明写「最后把每人的 `+0x42/+0x5c/+0x60` 清零」）。利息 `0x43814a` 循环**全体在场玩家**：`0x4381f8 cmp dword [eax+0x496b8c],0 / jne` 跳过（有贷款不发）→ `fild` ＋ `fmul qword [0x464e88]`（double 1.1）→ `call 0x457dbc` 向零截断（`bank.md:448-521`）；**贷款利息不存在**（`bank.md:523-530`） | `rules/monthly.ts:216-219 settleMonthlyBank`＝`applyMonthlyInterest(bank, loan)`；调用点 `reduce.ts:3136 if (newMonth) players = players.map((p) => (isAlive(p)?settleMonthlyBank(p):p))`（全体在场、排除出局 ✅）；`monthly.ts:60-70` 用 BigInt 精确展开 1.1 的 double 位模式（`monthly.ts:25-36`）✅。**缺口**：`monthlyPaid`/`monthlyReceived`/`totalWinterSleepDays` 只在 `rules/new-game.ts:264/274/275` 与 `rules/bankruptcy.ts:137/148/149` 清零（开局/破产），**没有任何月结清零**；而评分直接读这三个累计值（`monthly.ts:130-137 monthlyScore`、`client/src/monthly-screen.ts:855-862 awardScore`） | 缺失 | 严重 | 补月结尾部清零（`totalWinterSleepDays=0`、`monthlyPaid=0`、`monthlyReceived=0`，对照 `0x439ec6-0x439ef2`）；并确认月结是否还要重算排行榜 |
| 11 | 回合边界计数与释放 | `0x41c84f`（唯一被 `0x419039` 调用，参数＝`[0x49910c]`）：`0x41c85f cmp ebx,4 / jge 0x41ce39`；前半 `+0x32..+0x35` 减到 0 **挂 0x80**（`0x41c8a5-0x41c8ed`，消失用 `&0x3f`）；后半 `0x41caf7 cmp dword [p+0x32],0 / jne 跳过冬眠梦游` → `+0x36 冬眠`（`0x41cb04`）→ `+0x37 梦游`（`0x41cb28`）→ **`+0x39 龜行`（`0x41cb4c`）→ `+0x38 停留`（`0x41cb70`）** → `+0x3b 拒貸`（`0x41cb94`）→ `+0x3c`（`0x41cbb8`）→ `+0x3d 同盟`（`0x41cbdc`）→ `+0x3e 保險`；释放段 `0x41c9a7-0x41caf4`（梦游 `0x41c9bc` 退交通工具；`+0x34/+0x35` 走 `0x43d7bf`/`0x43ee6e`）。已知记录 `known-deviations.md:4047`、`:4057` | `rules/blocking.ts:52-67 tickBlockingCounter`；`:75-80 TICKED_COUNTERS`（住宿 0xff／消失 0x3f／监狱／医院，**并列出各自的释放函数 `0x40d6be`/`0x40d4e5`/`0x43d7bf`/`0x43ee6e`**）；`blocking.ts:159-188 tickTurnCounters` 顺序＝住宿组→冬眠→梦游→**龜行→停留**→拒貸→`bankFreezeDays`→同盟（`reduce.ts:857-863` 对双方 `−20×物价`）→`insuranceDays` 在 `startTurn`（`reduce.ts:896-898`）；`bankFreezeDays` 真用于拒贷（`places/bank.ts:98`、`places/special-finance.ts:163`、`ai/policy.ts:510`）✅；计数归属 `reduce.ts:1637-1642`＝进位后的新玩家 ✅。**✅ 已闭合（第 83/84 条）**：`released` 已在 `reduce.ts` 的 `endTurn` 消费（清占用表 + 置 `WHO_PLAYS_RETURN_TO_BOARD`），`startTurn` 消费标记并清四个计数；递减对象已订正为**新**当前玩家（原版 `0x418f95` 先 ++ 游标）| 已完成 | — | 原版在 `0x80` 分支 `call 0x40d6be`（`or who_plays,0x10` ＋按朝向走回棋盘）与 `call 0x43d7bf`（`mov byte [ebx+0x496b30],0` 清占用表）。remake 既不清 `prisonOccupancy`/`hospitalOccupancy`、也不把 `nodeId/direction` 送回棋盘 ⇒ `rules/confinement.ts:138 anyoneConfined` 永为真 ⇒ `reduce.ts:3754-3766` 永远认为「有人在押」并挂 `bail`，刑满者永久停在监狱数据位置。应把 `released` 接进 `endTurn`（`reduce.ts:1637` 一带），并补覆盖占用表与回棋盘的测试 |
| 12 | 胜负判定 | `0x41d89e`：`0x41d8a4 cmp [0x49911c],0 / jne`＋`0x41d8ad cmp [0x499108],0 / jne` → 两者皆 0 返回 0；循环在场者取 `calculate_player_wealth(0x4239b9)` 最大（`0x41d8cc cmp byte [eax+0x496b7d],0 / je`、`0x41d8de cmp edi,eax / jge` 平手取先出现者）；`0x41d8e9 test edi,edi / je 0x41d8ff`（**首富资产 0 → 天数条件不生效**）；`0x41d8f7 cmp edx,[0x4990e4] / jle 0x41d915`（`目标 <= 已过天数`）；`0x41d90d cmp edi,[0x499108] / jl 0x41da5a`；收尾 `0x41d951` 循环把非赢家 `who_plays=0`；调用点 `0x41cfab inc [0x4990e4]` → `0x41cfb1 call`（**用加过之后的天数**） | `rules/victory.ts:98-139 checkVictory` 逐句对齐（早返回 `105`；取最大 `109-118`；`best!==0 && targetDays!==0 && targetDays<=elapsedDays` `121`；`best >= targetWealth` `130`）；资产口径 `rules/wealth.ts:51-88 calculatePlayerWealth`＝`cash+bank−loan`＋12 支股票（`wealth.ts:31 STOCK_COUNT`、`60-64` 逐支 `Math.trunc`）＋住宅/连锁店/设施；終局码 `victory.ts:158-163`、清场 `victory.ts:66-68 clearLosers`；调用与天数用加后值 `reduce.ts:3053/3067`；`totalDays` 开局 0（`rules/new-game.ts:462`） | 数值错 | 严重 | 判定公式本身 ✅，但**银行落点处的 wealth 口径错**：`reduce.ts:3771 const wealth = calculatePlayerWealth(me, [], [])`（stocks/lands/facilities 传空）⇒ 银行面板「您的贷款额度」快照（原版 `0x43668f call 0x4239b9 → [0x48c3b0]`，`bank.md:216,291`）少算股票与地产。应改传 `allEffectiveLands/allEffectiveFacilities/valuationsOf` |
| 13 | 破产/出局、上限、平局 | 破产 `0x40cd87`：`who_plays==0 → 直接返回`，否则 `+0x1c` 起 `0x68−0x1c` 字节清零 ＋ `who_plays=0` ＋ `[char+0x4990f4]=2`（`places.md:137`）。出局者不参评：胜负/物价只数 `+0x15 != 0` 者（`places.md:1118`）。**「回合数上限」终止条件**：`0x41d89e` 只读 `0x49911c`/`0x499108`，未见任何回合上限比较 | `rules/bankruptcy.ts:150` 注释明列保留 `index/character/nodeId/lastNodeId/direction/ndices`；`state/types.ts:733-735 isAlive`＝`(whoPlays&3)!==0`，胜负（`victory.ts:111`）与物价（`wealth.ts:139`）都过滤出局者 ✅。平局 `victory.ts:114 if (best < w)`（严格大于、平手取先出现者）✅。**上限**：未见以 `turnCount` 做终局判定 | 无法判定 | 轻微 | 原版侧**未找到**「回合数上限」终止条件（无 @source 可给）⇒ 整条无法判定；remake 的 `turnCount` 是每玩家回合 +1（`reduce.ts:1711`），语义也未对位。建议下一轮先在 exe 里找 `[0x4990e4]` 之外的天数/回合比较点再定案 |

**回合流程小结（最严重 3 条）**

1. ~~**阻碍/关押的释放链完全没接（#11，阻断）**~~ **✅ 已闭合**（第 83/84 条）：`tickBlocking` 的 `released` 已接、
   `confinement.ts:128 release()` 零调用、`anyoneConfined`（`confinement.ts:138`）读的占用表永不清零。
   后果不止「看不到人回棋盘」：**監獄/醫院落点会永久认为有人在押**（`reduce.ts:3754-3766`），
   每次踩到都挂 `bail`，可反复「保釋」幽灵；`who_plays |= 0x10`（原版 `0x40d6be` 的副作用）也没做。
2. **月结缺「累计字段清零」（#10，严重）**：`settleMonthlyBank`（`monthly.ts:216-219`）只做
   `trunc(bank×1.1)`，`monthlyScore`/`awardScore` 读的 `+0x5c/+0x60/+0x42` 从不按月清零
   ⇒ 第 2 个月起「本月意外之財／意外損失／倒楣天數」是跨月累加值，月度奖项失真。
   `deviations/T-041.md:9` 已记录该清零（**记录本身正确**），只是没落码。
3. **嵌套模态语义没保留（#2，严重）**：原版 `0x48a010[0x46cad8]` 是真栈；remake core 只有单个
   `pending`（`types.ts:656`）。最具体的深度 2 需求是**收租模态里再弹「是否使用免費卡？」**
   （`cards.md:4695`），remake 明确未实现该真人分支（`rules/toll-flow.ts:141-149`，D-008）。
   ⚠️ 未做动态插桩证明 `0x46cad8` 实际到 2，故「深度 2 可达」属**无法判定**；
   但「core 结构上无法表达嵌套」是确定的。

**对主循环机制的判断**

- **`0x3b9` 核对结果：无误**（详见 #3）：它只是 WndProc 的音乐开关，无任何把它当导航的代码。
- **消息泵嵌套**：原版栈式（`inc` 入栈→注册 `[0x48a010+depth*4]`→`dec` 出战）；
  remake 为单层 `pending` + 客户端取消梯子。规则层无法表达深度 2（#2）。
- **没有固定帧节拍**：状态推进＝「一条 action ＝ 一次 reduce」，顺序由 `autoAction`
  （`reduce.ts:3214-3227`）与 `mechanicalAction`（`main.ts:1455-1478`，惡人段优先于 `endTurn`）固定
  ⇒「同一帧多个定时器到期」在 remake 侧没有对应现象；原版侧这些定时器分属不同窗口/阶段、
  谁先到期取决于系统时序与窗口状态，**无法判定**其确定性顺序，要对齐必须先补完
  `game-loop.md` §六 待办 1。
- 附带：`state/types.ts:284-286` 把 `fcn_0040d7c4`（4 路跳表 `0x40d7b4`，state 0/1/2/3）当作
  `TurnPhase` 的等价物是**类比而非同一物** —— 那 4 个是**每 tick 的动画状态**
  （0 待机／1 走子／2 掷骰／3 落地事件，见 `known-deviations.md:2990-3005`），
  remake 的 `phase` 是动作泵相位。若要逐格对齐，应另建动画状态机而非复用 `TurnPhase`。

---

## 四、三个小游戏逐项对照

### 4.0 共同触发层与奖罚

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 1 | 落点类型 6/7/8 分派 | 跳表 `0x4197e9`：`[6]=0x41b146→call 0x415215`、`[7]=0x41b15e→call 0x4154dc`、`[8]=0x41b16c→call 0x4155fc`（`small-games.md:101-105`、`game-loop.md:256-258`） | `SPECIAL_KIND.PENGUIN_DIG/BALLOON/GIFT_FROM_SKY = 6/7/8`（`loaders/map.ts:45-47`）；`state/reduce.ts:1023`；`places/minigame.ts:33-40` | 一致 | — | — |
| 2 | 进入闸门 `玩家+0x15 == 1` | `0x41560d cmp byte [eax+0x496b7d],1` / `0x415614 jne 0x415457`（三入口同构） | `enterMinigame` 判 `(whoPlays & WHO_PLAYS_MASK) === WHO_PLAYS_HUMAN`（`state/reduce.ts:2444-2446`）；`WHO_PLAYS_MASK=0x03/HUMAN=1/COMPUTER=2`（`state/types.ts:31-34,78`）；`rules/new-game.ts:228` 设 1/2 | 一致 | — | — |
| 3 | `whoPlays` 编码语义（`1` 到底是真人还是电脑） | 规格**自相矛盾**：`small-games.md:148` 表注「1=电脑」且 §一「真人不会进入任何小游戏」；同文件 `:846-847` 未决 2 又承认「`==1` 反而弹交互框」；`ai.md:1162-1166` 定案「`+0x15==1` 只说明该座位有人/未出局，AI 判据是 `& 6`」 | remake 采 `1=真人`，`rules/turn-start.ts:127` 用 `&0x04`（托管）/`&3==2` 判 AI，与 `&6` 口径自洽；但编码出典写的是**被禁引用的 `rich4-re/asm/rich4_player_info.h`**（`state/types.ts:28-29`） | 无法判定 | — | 把 `state/types.ts:28-29` 的出处换成规格可引证据（`ai.md` §八 或现场反汇编），并在规格里把 `1` 的语义定案 |
| 4 | ★cfg 开关 `[0x497159]`（動畫過程） | `0x41561a cmp byte [0x497159],0` / `0x415621 je 0x415457`（`small-games.md:142-143,149`）⇒ 关掉后**真人也走 50..69** | **core 完全没有这道闸**：`enterMinigame`（`state/reduce.ts:2441-2457`）不读任何配置；只有表现层拿 `env.animation` 挡入场 FLIC/BGM（`client/src/minigame-screen.ts:1690`、`:1737-1739 introGateOpen`、`:1774-1776`）；全 core 无 `animation` 字样 | 缺失 | 阻断 | 把「`[0x497159]`=0 → 真人也走 50..69」判据放进 core（作为 state 配置或 action），`enterMinigame` 前置 |
| 5 | 分派器额外闸门 `玩家+0x37` | `0x41986c imul eax,[0x49910c],0x68` / `0x419873 cmp byte [eax+0x496b9f],0` / `0x41987a je` / `0x41987c test ebx,ebx` / `0x41987e jne 0x41b3d0` ⇒ `+0x37!=0 && 类型!=0` 时**整格事件不执行** | `settle` 分派（`state/reduce.ts:980-1047`）**无**此闸；`sleepWalking` 模型在 `state/types.ts:67`，只在 `state/reduce.ts:2985`（商業买地）、`:4621`（研究所）、`:4688`（自有設施加盖）三处单独挡（`state/sleepwalk-behavior.test.ts:1-30` 自列「各自判据」表） | 缺失 | 阻断 | 在 `settle` 开头加 `player.blocking.sleepWalking !== 0 && node.specialKind !== 0 → turnEnd`（覆盖 6/7/8 与其余特殊格） |
| 6 | 闸门比较方式（整字节 vs 掩码） | 原版是**整字节** `cmp byte,1`（`0x41560d`），值 5（`1\|0x04` 托管）也走「不玩」 | remake `(whoPlays & 0x03) === 1`（`state/reduce.ts:2445`），而 `state/reduce.ts:569` 明确允许 `HUMAN\|AUTOPILOT = 5`（`client/src/ai-settings.ts:445` 会写入） | 接口不符 | 轻微 | 值 5 时 remake 会挂 pending，随后 `ai/policy.ts:491` 以 `score:null` 回答，点数同为 50..69，仅多一次往返；要 1:1 就改 `whoPlays === 1` |
| 7 | ★「不玩」得分 `50 + rand()%20` | `0x415457 call rand`、`0x41545e mov ebx,0x14`、`0x415466 idiv ebx`、`0x415468 add edx,0x32` | `places/minigame.ts:61-70`、`state/reduce.ts:2473 autoMinigameScore(rng.next())` | 一致 | — | — |
| 8 | ★★「不玩」**第二次 `rand()`**（选台词） | `0x4154b6 call 0x456f2d` / `0x4154bb and eax,1` / `0x4154be mov esi,[ebx+eax*4+0x48084a]` / `0x4154cf call 0x44ef41(player_say)` ⇒ 该路径（**含电脑玩家**）固定 **2 次** rand | **只掷 1 次**：`settleMinigame` 唯一一处 `rng.next()`（`state/reduce.ts:2468-2477`）；`autoMinigameScore` 全仓唯一调用点在此；客户端 `client/src/interactions.ts:311-331` 只 dispatch，小游戏屏无任何角色台词/`0x48084a` 实现；`state/places-integration.test.ts:275-289` 只断言「rngState 变了」，未钉次数 | 时序错 | **阻断** | `score===null` 支里掷**两次**（第二次 `&1` 用于台词，即使不显示也要掷），并补「掷 2 次」用例 |
| 9 | 真人玩完那条路的全局 rand 消耗 | 玩法本身消耗全局 `rand()`：埋寶 **28 次**（`0x41208f`）、氣球每 tick（`0x4131a5`/`0x413001`/`0x413083`）、財神（`0x4137a7`/`0x4138d2`/`0x413904`/`0x4139f9`/`0x4123ba`/`0x412400`）；`small-games.md:286` 亦自述「`rand()` 只在棋盘生成与不玩分支出现」 | 三屏随机数全走屏内独立 `WatcomRng`（`client/src/minigame-screen.ts:1627-1643` 种子、`:1862-1869` 推进），`state.rngState` 一次不动（`state/reduce.ts:2479`）；`state/places-integration.test.ts:271-272` 还把它钉成断言，注释写「与原版『真人那条路一次 `rand()` 都不调』一致」——**与原版相反** | 时序错 | 阻断 | 属**已知架构偏离**（`known-deviations.md:2033` 的 C-DET-4），可保留，但必须订正 `state/reduce.ts:2464-2465` 与 `state/places-integration.test.ts:271` 的措辞 |
| 10 | 结算口径：EAX 加到 `玩家+0x30`、不动现金、无负值 | `0x41b152 add word [ebx+0x496b98], ax`（三桩 `0x41b146/5e/6c` 均 `jmp 0x41b152`） | `state/reduce.ts:2478-2482` 只 `p.points = addPoints(p.points, gained)`，不触现金 | 一致 | — | — |
| 11 | 點券是 uint16 回绕 | `add word`（16 位） | `addPoints = (current+delta) & 0xffff`（`rules/special-square.ts:94-96`，`special-square.test.ts:81-82` 钉住） | 一致 | — | — |
| 12 | 999 上限的**适用范围** | `mov dword [0x48bcec], 0x3e7` 全 exe **只有一处** `0x414ef3` ⇒ 只有**七彩氣球**有夹子；企鵝（≤188）与財神原版**不夹** | 做成三屏通用：`places/minigame.ts:65 MINIGAME_MAX_SCORE=999`、`client/src/minigame-screen.ts:153 MINI_SCORE_CAP`、`:802`、`:1408`、`:79-84`；`known-deviations.md:1706` 也按三屏写 | 多余实现 | 轻微 | 保留（防联机伪造）但把注释/文档改成「氣球=原版，另两屏为引擎自加」，并注明玩家可观察路径只有伪造 action |
| 39 | `clampMinigameScore`（夹逼） | 原版**没有**夹逼：全 exe 仅 `0x414ef3` 一处 `0x3e7`，分数由玩法产生、**从不接外部数字** | `places/minigame.ts:79-84`（负数/NaN/Inf→0，>999→999），用于 `state/reduce.ts:2476`；玩家可观察路径＝通用对话框「報成績」（`client/src/interactions.ts:320-329`，`max=pending.maxScore=999`）可手填数字 | 多余实现 | 轻微 | 保留（联机防伪造），但注释已自认「不是原版有的」；注意它同时挡住了「真人报 >999」——原版这条路根本不存在 |

### 4.1 小游戏 A：企鵝挖寶（`0x415215`）

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 13 | 9×9 棋盘 / 64 有效格 | `0x474d7c` 每格 8 字节、`word[+0]==0` 即无效（`0x4120c6`、`0x41211c`）；`small-games.md:264-265` | `PENGUIN_CELL_XY`（`client/src/minigame-screen.ts:296-306`，索引 40 = 冰屋 `(0,0)`）、`penguinCellValid:346-348`、`PENGUIN_VALID_CELLS=64:312`；命中表改菱形几何（`:359-368`）＝**已知偏离 D-MINI-2**（`docs/deviations/T-042-044.md:88-113`，记录与代码一致） | 一致 | — | — |
| 14 | 件数模板与「模板项↔类型」映射 | `0x411fc8` 原始 dword = `(3,12,3,9,1)`；`0x412064-0x412073` 外层索引 `i=0..4` 与 `[esp+4+i*4]` 比较；`0x4120f5 mov edx,[esp+0x1c] / inc edx / 0x4120fa or word [cell],dx` ⇒ **存盘值 = i+1** ⇒ **type1↔template[0]=3、type2=12、type3=3、type4=9、type5=1**；计数自增在 `0x4129fc add dword [eax*4+0x48bbac], 1`（`eax` = 拾取类型）⇒ 权重对应 type2=5、type3=12、type4=8、type5=20 | `PENGUIN_TREASURE_COUNT=[3,12,3,9,1]`（`client/src/minigame-screen.ts:310`）、`penguinPlaceTreasures` 按层 `board[i]=level+1`（`:376-397`）、`PENGUIN_VALUE=[0,0,5,12,8,20]`（`:313-319`，注释已标 `[0x48bbac+类型*4] @0x4129fc`）；测试钉满分 **188**（`minigame-screen.test.ts:245`） | 数值错（**规格侧**） | 轻微 | 规格 `small-games.md:266-268`「类型 2 有 3 个…类型 1 有 1 个」与 `:342`「理论上限 363」是**错位一格的误读**，应更正为 type_i↔template[i−1]、满分 **188**。remake 与机器码一致 |
| 15 | ★「类型 1 = 炸彈，拾取即立刻結束」 | `0x41298e mov eax,[0x48bd6c]` / `cmp eax,1` / `je 0x4129ab`：`0x4129ab mov [0x48bccc],eax`(=1) + 音 15，且**不**走 `0x4129fc` 的计数；动作 1 动画 `0x4125e0` 走满 `0x412b90 and/ cmp eax,0xf` / `0x412b93 jne` → `0x412b95 mov byte [0x48bd58],1`（**游戏立即结束**） | **remake 没有任何炸彈/提前结束逻辑**：`penguinReveal`（`client/src/minigame-screen.ts:526-538`）对 type≠0 一律 `counts[type]+1` + 播动画；`penguinStep` 只在 `ticks<=0` 时离开 play（`:571-584`）；type1 权重为 0（`PENGUIN_VALUE:319`）故不影响分数 | 缺失 | **阻断** | 挖到 type1 时进入约 15 tick 的动画后置 `phase='end'`（分数照当前累计），并补测试 |
| 16 | 放置算法 `n = rand()*ebp>>15`，`ebp` 从 64 递减 | `0x41208f call rand` / `0x412094 imul eax,ebp` / `0x412097 sar eax,0xf` / `0x412108 dec ebp` | `randScale(takeRand(holder), free)`（`client/src/minigame-screen.ts:166-169`，`free` 初值 64，`:379,383,393`） | 一致 | — | — |
| 17 | 计分 `5c2+12c3+8c4+20c5` | `0x413d6a..0x413da6`（`[0x48bbc0]×20 + [0x48bbb8]×12 + [0x48bbbc]×8 + [0x48bbb4]×5`），类型 1 不计数（`0x41298e→0x4129ab`） | `PENGUIN_VALUE=[0,0,5,12,8,20]`、`penguinScore:400-404`；HUD 计数器类型序 `[5,3,4,2]`（`:1417-1424`） | 一致 | — | — |
| 18 | 唯一输入 = 鼠标左键；玩法中零随机 | `small-games.md:271-272,286`；WndProc 只映射 `0x401/0x0f/0x113/0x201/0x203/0x405` | 屏只实现 `down`（`:1910-1919` → `penguinClick:489-495`）与 `move`（`:1903-1908`，只写 `st.mx`）；无 `key()`（`client/src/ui-screen.ts:184` 为可选）；企鵝相关函数只有 `penguinPlaceTreasures:383` 用随机 | 一致 | — | — |
| 19 | 计时：100 ms / 主 150 tick / 入场 10 tick | `0x4148d9/0x4148e3 SetTimer(0x64)`、`0x4148ab [0x48bd2c]=0x96`、`0x4148b1 [0x48bd7c]=0xa`（`small-games.md:292-294`） | `PENGUIN_TICK_MS=100:321`、`PENGUIN_PLAY_TICKS=0x96:325`、`PENGUIN_INTRO_TICKS=10:323`；测试 `minigame-screen.test.ts:138-140,645` | 一致 | — | — |
| 20 | 收尾再给 **20 tick** | `0x414a1c mov byte [0x48bd58],2` / `0x414a23 mov dword [0x48bd2c],0x14`（=20） | 用「姿势帧数 × 4 轮」：`PENGUIN_END_FRAMES={hi:8,lo:6,mid:1}`、`PENGUIN_END_LOOPS=4`（`:454-457`），推进在 `:560-568` ⇒ 32/24/4 tick，代码里无 `20` 这个常数 | 时序错 | 轻微 | 结算演出时长按原版固定 20 tick（或把该偏离写进 `T-042-044.md`） |
| 21 | 结算姿势分数线 <40 / >55 | `0x4149c8 cmp ecx,0x28` / `0x4149e8 cmp ecx,0x37` | `PENGUIN_END_LO_SCORE=0x28 / HI=0x37`（`:326-328`）、选姿势 `:574-583` | 一致 | — | — |

### 4.2 小游戏 B：七彩氣球（`0x4154dc`）

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 22 | ★**8 条跑道** x=40..600 | `0x413027 mov ebx,0x28` / `0x41305b add ebx,0x50` / `0x41305e cmp ebx,0x280` / `0x413064 jge` ⇒ 道 = `0x28,0x78,…,0x258` 共 **8** 条（600 < 640）；`small-games.md:473` 也写 8 条 | `BALLOON_LANES = [0x28,0x78,0xc8,0x118,0x168,0x1b8,0x208]` **只有 7 条**（`client/src/minigame-screen.ts:645-646`，注释写「`< 0x280`」与数组自相矛盾）；测试把 7 条钉死（`minigame-screen.test.ts:326-328`）；`T-042-044.md:36` 也写「7 条道」 | 数值错 | **阻断** | 补 `0x258`(600) 并改测试与 `T-042-044.md` |
| 23 | 生成分流 `rand()%1000` → `%10` → `%跑道数` | `0x4131a5`（r<20 → `r>>2`）、`0x412ff8 cmp edx,0x1e`、`0x413001 rand%10` + `0x413014 [edx+0x475039]`、`0x413083 rand%条数`（`small-games.md:443-472`） | `client/src/minigame-screen.ts:827-840`：`randMod(1000)` → `<20` `roll>>2` / `<28` `((27-roll)>>1)+5` / `<30` `BALLOON_RARE_TYPES[randMod(10)]` / else 放弃；再筛空道、`randMod(free.length)` | 一致 | — | — |
| 24 | 特殊气球表 `0x475039` 与速度表 `0x475004` | 原始字节：`0x475039 = 09 09 0a 0a 0a 0a 0a 0b 0b 0b`；`0x475004 = 0f 0f 0f 0f 12 12 12 18 18 18 18 12`（**12 项**，规格只给 8 字节并标「推断」） | `BALLOON_RARE_TYPES:652`、`BALLOON_SPEED=[15,15,15,15,18,18,18,24,24,24,24,18]:650` ⇒ **逐字节一致**（比规格更完整） | 一致 | — | 规格 `small-games.md:491-492` 应把 12 字节补齐 |
| 25 | 道占用判据 `y > 0x12c` | `0x413046 cmp word [..+0x48bc46],0x12c` / `0x41304f jle`（≤300 继续）/ `0x413051 jmp`（>300 跳过该道） | `client/src/minigame-screen.ts:834-838` `busy = some(x===lane && y>BALLOON_LANE_BUSY_Y)`，常量 `0x12c:648` | 一致 | — | — |
| 26 | 点击得分与特殊气球效果 | `0x414ed6 inc eax`（类型+1）、`0x414ee5 cmp edx,0x3e8` → `0x414eed 0x3e7`；类型 9/10/11 见 `0x414e45`/`0x414e51`/`0x414e6c`；跳表 `0x414ba4` 实测 6 dword = `0x414e8d/e99/ea2/eae/eba/ebe`（时间=1 / 冻结 20 / 速度×2 / 速度÷2 / 归零 / ×2）（`small-games.md:498-532`） | `balloonClick`：`type9→×2`、`type10→÷2`、`type11→randMod(6)` 走 `BALLOON_RANDOM`（`:773-795`），`BALLOON_RANDOM={endSoon:0,freeze:1,speedUp:2,speedDown:3,zero:4,double:5}:675-682`；普通 `score += type+1:793`；夹 999 `:802` | 一致（999 见 #27/#12） | — | — |
| 27 | ×2 支也夹 999 | 原版 ×2 支（`0x414ebe`）**不夹**，HUD `%04d` 只画 4 位 | `client/src/minigame-screen.ts:797-802` 在所有加/倍支后统一夹；`known-deviations.md:5025-5032` D-MINI-12 已记，代码与记录一致 | 多余实现 | 轻微 | 已记录，可保留 |
| 28 | 爆开停留 tick 数 | 类型字 `0x3c`（`0x414ef7`）；`0x4130b6 test 0xf0` / `0x4130bf sub 0x10` / `0x4130c7 test` / `0x4130d0 置空` ⇒ `0x3c→0x2c→0x1c→0x0c`＝**停留 3 tick** | `BALLOON_POP_TICKS=2`（`client/src/minigame-screen.ts:685-686`）、递减 `:851-855` ⇒ 实际 2 tick（注释写「画 2 帧爆开图后消失」） | 数值错 | 轻微 | 改 3（或说明为何取 2） |
| 29 | 计时/结束：150 tick×100 ms，时间到等屏上清空 | `0x414c38 push 0x64`、`0x414c11 [0x48bd2c]=0x96`；`0x413a32 cmp byte [0x48bd58],1` / `jne` / `0x413a3b mov byte …,2`（公共尾 `0x413a2b`） | `BALLOON_TICK_MS=100:669`、`BALLOON_PLAY_TICKS=0x96:673`、`phase='ending'`→`!anyActive` 才进 `score`（`:819-872`）、`MINI_END_MS` 起算 `:874-885` | 一致 | — | — |

### 4.3 小游戏 C：喜從天降（`0x4155fc`）

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 30 | 鼠标横向差值驱动（死区 8 / 每帧 10 px） | `0x41364d`..`0x413661 cmp eax,8 / jle`、`0x413673 sub word [0x48bd4e],0xa`、`0x413688 add word …,0xa` | `GIFT_CATCH_DEADZONE=8 / GIFT_CATCH_STEP=0xa`（`client/src/minigame-screen.ts:919-921`）、`giftMoveCatcher:1193-1207` | 一致 | — | — |
| 31 | 財神状态机跳表 `0x413234`（5 项） | 实测 5 dword = `0x413886/0x413a2b/0x413934/0x413964/0x413986`；**state 1 的目标就是公共尾 `0x413a2b`**，写入者只置 0/2/3/4（`0x4138f2,0x41391a,0x413950,0x41397d,0x4139ee,0x413a11`）⇒ state 1 不可达 | `giftWalkGod:1114-1156` 实现 0/2/3/4（state 1 落进 else，永不发生）；警告侧判据 `:1173-1178` 与 `0x41375b cmp [0x48bd44],2 / jge`、`0x413770 cmp,3 / jle` 一致 | 一致 | — | — |
| 32 | 每帧 12 px、左界 110 / 中线 320 / 右界 530 | `0x4138ba add word [0x48bd4c],0xc`、`0x4139ba sub`、`0x4138c7 cmp …,0x140`、`0x4139e4 cmp …,0x6e`、`0x4138e7 cmp …,0x212` | `GIFT_GOD_STEP=0xc:917`、`X_MIN=0x6e/X_MAX=0x212/MID=0x140:913-916` | 一致 | — | — |
| 33 | 掉落物：16 槽 / 种类 `%20` / 速度表 `0x475010` | `0x4123e5` 找空槽、`cmp ebx,0x10`；`0x412400 rand%0x14` → `<9 type3 / <15 type2 / <18 type1 / else type0`；原始字节 `0x475010 = 18 12 0f 0c 0f` | `GIFT_SLOTS=16:1019`、`giftSpawn:1091-1111`（`<9→3`、`<15→2`、`<18→1`、else 0）、`GIFT_ITEM_SPEED=[0x18,0x12,0x0f,0x0c,0x0f]:932` | 一致 | — | — |
| 34 | 计分 / 360 tick×50 ms / HUD 时间 `/2` / 结算分级 | `0x4144a2..0x4144d3`（`10c0+5c1+3c2+c3`）、`0x41500f [0x48bd2c]=0x168` + `push 0x32`、`0x4141a0 sar eax,1`、`0x4150fe/0x41510e/0x41511e/0x41512c`（<40→1 / <50→2 / <60→0 / else 3） | `GIFT_VALUE=[10,5,3,1]:934`、`giftScore:1051-1055`、`GIFT_TICK_MS=50:959`、`GIFT_PLAY_TICKS=0x168:963`、HUD `st.ticks>>1:1561`、分级 `:1299-1303`（`GIFT_POSE_1/2/3=0x28/0x32/0x3c:965-967`） | 一致 | — | — |
| 35 | ★炸彈起爆概率（**方向反了**） | `0x41378d call 0x4123ba` / `0x413792 test eax,eax` / `0x413794 jne 0x413849`（跳到 `0x413849`，即**不起预警**的续行）；而 `0x4123ba` = `rand()%10` + `0x4123cb cmp edx,7` + `0x4123ce setl al` ⇒ 返回 1 当且仅当 `< 7`；故**只有 `rand()%10 >= 7`（30%）才起预警** | `giftWarn:1179` `if (start && randMod(holder,10) < GIFT_WARN_ODDS /*=7:957*/)` ⇒ remake 是 **70%** | 算法错 | **阻断** | 判据改 `>= GIFT_WARN_ODDS`；同时订正 `small-games.md:748`「70%」 |
| 36 | 爆炸 x = `rand()%140 + 160/360` | `0x4137a7 rand` / `0x4137ae ecx=0x8c` / `0x4137c1 movsx eax,[0x48bd4c]` / `sub eax,0x140` / `jle 0x4137e0` / `0x4137d1 add edx,0xa0` / `0x4137e0 add edx,0x168`（注意是 `>320` 才落左半） | `GIFT_WARN_SPAN=0x8c / LEFT0=0xa0 / RIGHT0=0x168:952-955`；`:1183` `st.warnX = st.godX > GIFT_MID_X ? LEFT0+r : RIGHT0+r` | 一致 | — | — |
| 37 | 炸彈命中/落地 | `0x4133d4 cmp edi,4`、`0x4133d9..ed 停 0x18 播 0x0f`、`0x41341d [0x48bd56]=4`、`0x41342e [0x48bd58]=1`；落地 `0x41351d dec [0x48bd54]` | `giftStep:1253-1280`：接到 type4 → 停 24 + 播 15 + `endPose=4` + `phase='ending'`；最后一颗落地停 24 | 一致 | — | — |

### 4.4 退出/收尾与文档核对

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 38 | 退出/收尾：KillTimer、暂停 2000 ms、`PostMessage(0x402)` | KillTimer `0x414941/0x414d22/0x4150de`；`0x41513f`/`0x414d38 push 0x7d0` | 2000 ms 有：`MINI_END_MS=2000`（`client/src/minigame-screen.ts:151`），三屏用于 `:565`/`:885`/`:1306`；KillTimer/消息泵由 `pending` + `finish()`（`:1805-1812`）+ core `turnEnd` 取代 | 接口不符 | 轻微 | 架构等价，补一句文档说明「`0x402` 消息泵 ≡ pending/finish」 |
| 40 | `known-deviations.md` Q-MINI-1 记录 | — | `known-deviations.md:1857` 标题已改「✅ 已实现（2026-09-16…）」，但正文 `:1863-1864` 仍写「眼下客户端没有实现它们，故真人也走『不玩』那条（报 `score: null`）」；实际 `client/src/minigame-screen.ts` 1900+ 行且 `finish()`（`:1806-1812`）报真分 | 记录错误 | 轻微 | 删掉/改写 `:1863-1864` 两句 |
| 41 | `docs/deviations/T-042-044.md` D-MINI-5 记录 | `0x41522e cmp byte [player+0x15],1 / jne`；`0x41523b cmp byte [0x497159],0 / je`（该文件自引） | 同一份 `T-042-044.md:168-169` 声称「这两条也已经在 **core** 覆盖」——`whoPlays` 那条成立，**cfg 那条不成立**（见 #4） | 记录错误 | 轻微 | 改成「whoPlays 已在 core；`[0x497159]` 只在表现层挡 FLIC/BGM，闸门未实现」 |
| 42 | 三个游戏是否都会在真实对局出现 | `small-games.md:857` 未决 11（类型 6/7/8 的地图分布来自地图数据，不在 exe） | 有 `SPECIAL_KIND` 与地图 loader（`loaders/map.ts:45-47`），地图是否含 6/7/8 **未核** | 无法判定 | — | 统计 `extracted/map/*.bin` 的 `specialKind` 6/7/8 出现率 |

**小游戏小结（最严重 4 条）**

1. **「不玩」分支少掷一次 `rand()`（#8，阻断）**：原版 `0x415457` + `0x4154b6` 固定 2 次
   （第二次选角色台词，表 `0x48084a`），remake `state/reduce.ts:2468-2477` 只有 1 次。
   电脑玩家（或关掉小游戏后）每落一次 6/7/8 格，后续随机序列就错位一次。
2. **企鵝「挖到炸彈立刻結束」完全缺失（#15，阻断）**：原版结束路径
   `0x41298e→0x4129ab` → 动画 `0x4125e0` 走满 `0x412b90 and/ cmp 0xf` → `0x412b95 [0x48bd58]=1`；
   remake `penguinReveal`（`:526-538`）把 type1 当普通 0 分寶物，玩法只剩「150 tick 到点结束」。
   附带：type1 实际有 **3 个**（`0x411fc8[0]=3`），规格说 1 个、说满分 363 都是错位误读（#14）。
3. **七彩氣球少一条跑道（#22，阻断）**：`0x41305e cmp ebx,0x280` 意为「<0x280 才继续」，
   道为 `0x28…0x258` 共 **8** 条（含 x=600）；remake `BALLOON_LANES:645-646` 只 7 条，
   x=600 永无气球，且 `minigame-screen.test.ts:326-328` 把错钉住。
4. **喜從天降炸彈概率方向反了（#35，阻断）**：`0x41378d` 的 `test eax,eax / jne 0x413849`
   （`0x4123ba` 返回「`rand()%10<7`」）意味着**只有 ≥7（30%）才起预警**，
   remake `:1179` 写的是 `< 7`（70%），炸彈密度约 2.3 倍；规格 `small-games.md:748` 的「70%」
   同样漏看了调用方 `jne` 的方向。

**已知偏离核对**：D-MINI-2 / 6 / 7 / 8 / 12 记录与代码一致
（`T-042-044.md:88-113/177-191/193-202/204-209`、`known-deviations.md:5025-5032`）；
D-MINI-1 一致（`minigame-screen.ts:894-897,1527-1532` + `minigame-bg.ts:20-53`）；
**D-MINI-5 部分不成立**（cfg 闸未进 core，#41）；**Q-MINI-1 正文过期**（#40）。
规格侧另有 3 处错误需回写规格：满分 363（应为 188，#14）、类型 1 只有 1 个（应为 3 个，#14）、
炸彈 70%（应为 30%，#35）。

---

## 五、AI 决策差距

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 1 | 决策时机：无独立 AI 主循环，嵌在相位跳表 `0x418c3d` 的第 2/5 相位 | 主循环 `0x401d8d..0x401db3` 的「待处理决策」标记 → `0x418c55` → `jmp [phase*4+0x418c3d]`；相位 2/5 = `0x418dc6`；相位 0 = `0x418e7f` 落点结算（`ai.md:41-58, 65-70, 90-101`） | 客户端每帧定时器 `decideAction`（`client/src/main.ts:3355`）+ 引擎 `autoAction`（`state/reduce.ts:3214`）+ `aiStep` 状态机（`state/types.ts:529-537`）；相位 0↔`settling`，相位 2/5↔`awaitingRoll`+`aiStep`（`ai/policy.ts:124-139`；reducer 侧 `state/reduce.ts:3837-3850`） | 等价实现 | 轻微 | 无需改；若要 1:1 可把 `aiStep` 命名成相位以便与规格对照 |
| 2 | 入口拦阻：`current_player >= 4` 与 `(+0x15 & 0x30)`（卧病/坐牢）不决策 | `0x418dcf jge 0x418e75`；`0x418dd8 test byte[+0x496b7d],0x30 / jne 0x418e75`（`ai.md:76-80`） | `ai/policy.ts:122 isAiTurn`；`0x30` 位语义在 `rules/turn-start.ts:79-91`（`WHO_PLAYS_SPECIAL_MASK` 在 `startTurn` 阶段拦成 `skip`，`state/reduce.ts:885-891`）。**remake 没有 ≥4 不决策的判据**（`isAiTurn` 只看 `whoPlays` 位），因 NPC actor 用独立数组（`specialActors`）而非高下标玩家 | 等价实现 | 轻微 | 现结构下不构成差异；若日后允许 >4 个玩家需补判据 |
| 3 | ★ 每回合一次 `rand() & 1` 决定用卡/用道具 | `0x418e18 call rand` / `0x418e1d test al,1` / 奇数 `0x418e21 call 0x441baa`、偶数 `0x418e28 call 0x447d97`（`ai.md:150-164`；`game-loop.md:328-346`） | `state/reduce.ts:3844-3847`（跨进 aiStep 2 时 `rng.next() & 1`，只掷一次，测试 `ai/policy.test.ts:233-252`）；分派 `ai/policy.ts:136` | 等价实现 | 轻微 | 无需改（次数 1 次、位置在公佈欄之后、用卡/道具仍互斥） |
| 4 | 個性闸门：`d=f7−個性`，`d>=2` 拒 / `d==1` 时 `rand()%3`（**消耗一次**）/ `d<=0` 放行 | `0x41e69e`；rand 调用点 **`0x41e6ce`**（`idiv ecx` `0x41e6dd`、`test` `0x41e6df`）；道具同型 `0x420e9a`，rand 在 **`0x420eca`**（`ai.md:272-335, 593`） | `ai/personality.ts:196-201`（纯函数，无 rand）；替身在 `ai/policy.ts:405-407` `gateRoll = (rngState ^ action*0x9e3779b1) % 3`，调用点 `ai/policy.ts:221`（卡）/ `:320`（道具，盐 `30+toolId`） | 算法错 | 严重 | 属 **D-004**（`known-deviations.md:629-635`）。**核实：记录描述大体准确**（纯函数/替身/不推进 rngState 都与代码一致），但地址写成 `0x0041e6c9`（那是 `cmp edx,1`）应订正为 `0x41e6ce`；且 D-004 只提卡片一侧，**未提道具侧 `0x420eca` 是同一问题的第二处**。修复：把 `personalityAllows` 的 roll 搬进 reducer，用真 `rng.next() % 3` 并由 reducer 写回 `rngState`（两个闸门各一次，且只在 `d==1` 时消耗） |
| 5 | AI 用卡：闸门 `(+0x15 & 6)`/`(+0x16 & 1)`；手牌槽 `0x499120+player*15`；候选 ≤8，仅 N>8 掷 `rand()%N` | `0x441d00 test dl,6`；`0x441d09 test byte[+0x496b7e],1`；`0x441d1d call 0x441262`；`0x441d31..0x441d3d memset(8)`；`0x441d45 cmp esi,8 / jle 0x441d5a`；`0x441d4a call rand` / `0x441d50 idiv esi`；逐张 `0x441db2 call 0x41e69e`（`ai.md:482-536, 543-558`） | `ai/policy.ts:201`（`aiCanUseCards`）、`:226`（`cardsToConsider(me.cards, aiRoll(state,0x441d4a,me.cards.length))`）、`ai/card-policy.ts:990-996`（`count>8` 才取 roll 起点、取 8 张）、逐张闸门 `ai/policy.ts:227-233` | 数值错 | 严重 | `+0x15 & 6` 由 `isAiControlled`（`state/types.ts:738-742`）近似；候选 8、环形、N>8 条件都在，但那次 rand 走 D-004 替身**不消耗**。同 #4 一并搬进 reducer |
| 6 | AI 用道具：闸门 `(+0x15 & 6)`/`(+0x16 & 2)`；槽 `0x49915c+player*15`（0..12）；候选 ≤4，count>4 时 `rand()%count`；**无条件跳过 i==9（時光機）**；`0x4753a0[40]=0x420edf` 空桩 | `0x447f82 test dl,6` / `0x447f87 test byte[+0x496b7e],2`；`0x447fd0` 槽读、`0x447fda cmp eax,9 / je 0x447fab`、`0x447fe9 inc esi`（候选数**不含**時光機）；`0x447ff0 cmp esi,4 / jle`、`0x447ff5 call rand`；跳表桩 `0x420edf`（`ai.md:621-643, 784-795`） | `ai/policy.ts:297`（`aiCanUseTools`）、`:300-305`（扫 13 格并 `if (id === TOOL_TIME_MACHINE) continue`，`TOOL_TIME_MACHINE=10` 见 `:334`）、`:323` + `ai/tool-policy.ts:543-550`（>4 才环形取 4） | 数值错 | 严重 | 结构、上限 4、「跳过時光機而且不计入候选数」都与原版逐字一致（原版 `0x447fd8` 同样跳过 `inc esi`，**不存在差一**）；差异只在 `0x447ff5` 那次 rand 用 D-004 替身不消耗 |
| 7 | 买地判据 `0x41d7d4`：`reserve=min(floor(開局資金[0x49908c]×0.05),7000)×price_index[0x4990e8]`；买 ⟺ `cash+bank−cost > reserve`；不看 hostility/owner/type | `0x41d7da fild [0x49908c]`、`0x41d7e0 fmul qword 0x463cc8`(=0.05)、`0x41d7ee cmp ..,0x1b58`(7000)、`0x41d807 imul eax,esi`、`0x41d81a add edx,[+0x496b88]`、`0x41d828 cmp/jle`；调用点 `0x41a0c0`（地块）/`0x41a8d1`（設施）（`ai.md:1038-1083`） | `rules/purchase.ts:166-175`（`aiShouldPurchase`，常量 `:131` `:133`）；调用 `ai/policy.ts:600`（地块，经 `:51-53`）、`:528`（設施） | 等价实现 | 轻微 | 实现正确。**Q-AI-3（`known-deviations.md:4322-4353`）判定描述准确，但文末「仍存的缺口」已过期** —— `GameState.initialFund` 已存在（`state/types.ts:356`），`updatePriceIndex` 已改读它（`state/reduce.ts:3086-3091`）。建议补记「缺口已闭合」 |
| 8 | 住宅加盖：`level<5 && type==0 && +0x37==0 && cost=地產+0x1e × price_index ≤ cash`；**此处无 rand** | `0x419911 cmp byte[esi+0x1a],5`、`0x41991b cmp byte[esi+0x18],0`、`0x419925 cmp byte[eax+0x496b9f],0`、`0x419939 movzx ebp,word[esi+0x1e]`、`0x41993d imul ebp,[0x4990e8]`、`0x41994b cmp ebp,[+0x496b84]`（`ai.md:931-965`） | `rules/land.ts:139-151`（`canUpgrade`：owner/level≥5/type≠0/sleepWalking/cost>cash）；决策 `ai/policy.ts:605`（够钱就盖，不留保留额） | 等价实现 | 轻微 | 无需改 |
| 9 | 商業用地：买地 `cost = word[+0x22] × price_index ≤ cash`；电脑**永远** `行業別 = rand()%4+1`（不弹面板）；加盖上限表 `0x474940[type]={1,5,5,1,5}` | 买地 `0x41a20d`/`0x41a210`；行業別 `0x41a21f cmp who_plays,1 / jne 0x41a23e` → `0x41a23e call rand` / `0x41a245 mov ecx,4` / `0x41a24d idiv` / `0x41a24f inc edx`；加盖 `0x41a2c2 cmp bl,[edx+0x474940]`、`0x41a2d5 word[+0x24]×物價`（`ai.md:967-1010, 1106-1110`） | 买地 `rules/facility.ts:379-381`（`facilityBuyPrice`）+`ai/policy.ts:528`；行業別 `state/reduce.ts:4692-4706`（非真人真 `rng.next()` → `rules/facility.ts:407-409` = `%4+1`，消耗 1 次）；上限表 `rules/facility.ts:53` = `[1,5,5,1,5]`；加盖 `rules/facility.ts:387-396`+`state/reduce.ts:4720-4729` | 等价实现 | 轻微 | 无需改（行業別 rand 的消耗点与次数都对） |
| 10 | 股票/公佈欄 AI 的入口标签 | `ai.md` 把 `0x4284be` 的 branch `0x42886e` 标为「股票交易 AI」，三道 `rand()%15`/`%3`/`%4` 为「股票 AI 闸门①②③」，并把完整判据列为 §七-4「未决」（`ai.md:1114-1119, 1135, 1159-1160`） | remake 按**持股明細屏/公佈欄**理解：`places/notice-board.ts:307-336`（1/15 挂、1/3 重估、1/4 买 + 判据）；`state/reduce.ts:3883-3976`（`aiNoticeBoardTurn`）；股票买卖另在 `ai/stock-policy.ts:318`/`:553`，调度 `ai/policy.ts:132-134` | 数值错（规格侧） | 严重 | 反汇编核实：**`ai.md` 这几处标签错了、remake 是对的**。`0x4284be` 在 `0x42886d ret` 收尾，分支内 `0x428890 call 0x441262`（数手牌）`0x42889a cmp eax,0xc`，与 remake「1/15、手牌>12 才挂卡」逐条吻合；`0x428a37`=1/3、`0x428ae8`=1/4、`0x4288fb`/`0x4289d3`=`rand()%候选`；且 `ui.md:175,233,269` 与 `docs/deviations/T-033.md:6` 都把 `0x4284be` 记为持股明细/公佈欄入口。⇒ **规格 §1.2b/§6.6/§七-4 需订正为「公佈欄 AI」，其判据其实已解**，真正的选股 rand 是 `0x42c690` |
| 11 | 股票买卖真正的入口与选股打分 | 与 `0x436b0a` 同链；`0x42bf03` 第一步 `rand()%3`（`0x42bf14`/`0x42bf23`/`0x42bf27`）；12 支打分 `0x42c690 call rand / idiv 0x18`（`rand()%24 ≤ 12−i`）；卖股 `0x42c79f` 非强制分支 `0x42c802 rand()%3` | 买股 `ai/stock-policy.ts:318-357`（闸一 `:323`、闸二 `:327`、闸三 `:331`、`rankStocks:290-294`、`pickRanked:302-313`）；卖股 `:553-558` | 时序错 | 轻微 | 12 支打分的**全部**阈值 remake 都已实现（`ai/stock-policy.ts:207-249` 与 `0x42c075..0x42c557` 对应）——不是「多余实现」，而是「规格标未决、remake 已译」。真正差异是 `0x42bf14`/`0x42c690`/`0x42c802` 三次 rand 走替身或不消耗（见 #17 汇总） |
| 12 | 银行 AI 第一步闸门 `rand()%3 == 0` | `0x42bf03` 起：`0x42bf14 call rand` / `0x42bf1b mov ecx,3` / `0x42bf23 idiv` / `0x42bf27 jne 0x42c794`（不中就走人） | **无对应判据**：`ai/stock-policy.ts:323` 只判 `stockRatio === 0`；`ai/policy.ts:132` 在 aiStep 0 无条件调 `decideStockTrade` | 缺失 | 严重 | 把 `0x42bf14` 的 `rand()%3==0` 作为买股前置闸门搬进 reducer（现在每回合都可能买股，原版只有 1/3 的回合往下走） |
| 13 | 银行「自动贷款」AI | `0x436893 call 0x456f2d` / `0x43689a mov ecx,0xa` / `0x4368a6 je 0x4368c7`（`rand()%10==0` 才放款）；`0x4368af/b5` 取 `cash+bank`、`0x4368bb cmp edx,0x7530`(30000) / `jge 0x436953`（**不中的话资产 ≥30000 就不放款**）；`0x4368db mov bh,[+0x496b80]`（+0x18 自动贷款比例）→ `0x4368e9 imul edx,[0x48c3b0]` / `idiv 100` / `[+0x496b8c] = loan`（`bank.md:320-340`） | `ai/policy.ts:506-513`（`pending.kind==='bank'` 时 `autoLoanAmount(p.wealth, me.loanRatio)`；`me.bankFreezeDays !== 0` 已按 `0x4368ce` 挡）；`loanRatio` = 角色表 f24（`loaders/savegame.ts:406`、`ai/personality.ts:170`） | 缺失 | 严重 | ① **`rand()%10==0` 与「(现金+存款) ≥ 30000 且 rand 不中就不放款」两条判据 remake 完全没有**（`places/bank.ts`、`rules/bank.ts` 全文件无 rng，纯函数，已逐一确认）；② 比例字段：remake 把 f24 接到 `+0x18`，与 `bank.md:333-338`「+0x18 = 自动贷款比例」「该字节无人写」自洽，但 `ai.md:279/315` 又写「`+0x17` = 個性」，**两处规格互相矛盾，remake 映射是否 1:1 无法判定**，需按 exe 现场复核 `0x4368db` 与角色表拷贝点 |
| 14 | 银行「主动存款/提款」AI | `ai.md` §七-3 / §6.6：「主動存款/提款 AI **未找到** → 未决」（`ai.md:1123, 1158`） | remake 同样没有：`decidePending` 只 `borrow`（`ai/policy.ts:506-513`）；`places/bank.ts` 的 deposit/withdraw 无 AI 分支 | 无法判定 | 轻微 | 与原版一致（都是「找不到」）。不要凭直觉补实现 |
| 15 | `_rich4_find_most_hostile_player` `0x40d2d3`：跳过自己与 `who_plays==0`；`cmp ecx,ebx / jge` ⇒ 严格大于才更新；全 0 返回 **−1** | `0x40d2e3..0x40d316` 逐条（`ai.md:808-861`） | `ai/card-policy.ts:83-98`（`mostHated`：`h > bestValue` 严格大于、first-wins、初值 `best=-1`/`bestValue=0` ⇒ 全 0 返回 −1、跳过自己与 `!isAlive`） | 等价实现 | 轻微 | 无需改 |
| 16 | 难度/性格：三档個性（0/1/2）+ 43 项 f7 表 | `0x496b7f` = 玩家+0x17 = 個性；取值 0 乖寶寶/1 普通人/2 大老奸（`ai.md:279, 316`）；f7 全 43 项表（`ai.md:682-736`） | `ai/personality.ts:196-201`（三档逻辑）；性格从 `CHARACTERS[i].f23` 取（`ai/personality.ts:162-173`、`loaders/savegame.ts:407`）；43 项数值逐项比对 **0 处不符**（`packages/data/src/cards.ts:65-94`、`packages/data/src/tools.ts:74-86`） | 多余实现 | 轻微 | f7/价格/权重三列与原版表 100% 一致。唯一「原版没有的维度」是 `ai/policy.ts:75-88` 的 `AiPersonality{aggression, cashReserve}` + `DEFAULT_PERSONALITY` + `AiContext.personality`（`:93`）——**全仓无调用方的死代码**，建议删除以免误读为难度旋钮 |
| 17 | 其余 `rand()` 消耗点（`ai.md` §五 1..18 与 §3.6 道具清单） | #1 `0x41e6ce`、#4 `0x41a23e`、#5 `0x418e18`、#6 `0x420eca`、#7 `0x447ff5`、#8 `0x42153e`、#9 `0x421657`/`0x42168d`、#10 `0x421e43`、#11 `0x42216f`、#12 `0x42bf14`、#13 `0x42c690`、#16 `0x4288fb`/`0x4289d3`、#17 `0x42c802`、#18 各卡效果函数内部 | 機車 `ai/tool-policy.ts:314-315`、汽車 `:318-319`（`%4==0` 语义正确）、工程車 `:495-498`（`%15<=個性`）、地雷/定時 `:277-308`（`0x42153e` 盐 `:307`）、核子飛彈 **已接线** `hedan`（盐 `0x42216f`，逐次 `salt+try`；`AI_NEVER_USES=[10]`）、改建卡 `ai/card-policy.ts:369`（`%4+1`，替身）；逐点差异见下表 | 算法错 | 严重 | 凡 `aiRoll`/`gateRoll` 都是**不消耗**替身，只有 `rng.next()` 真消耗；核子飛彈的不接线**不是**「缺失」而是基于未决结论（Q-TOOL-3）的保守处置 |
| 18 | 小游戏「不玩」出口的**两次** rand | 见第四节 #8（`0x415457` + `0x4154b6`） | 见第四节 #8（`state/reduce.ts:2468-2477` 只 1 次） | 缺失 | 阻断 | 见第四节 #8 |

**★ 随机数消费点差异汇总**（原版次数 vs remake 次数；「替身」= 有判定但不消耗状态）

| 原版点 | 位置/语义 | 原版 | remake | 现状 |
|---|---|---|---|---|
| `0x418e18` 硬币 | 用卡/用道具 50/50 | 1/回合 | 1（`state/reduce.ts:3846`） | ✅ 一致 |
| `0x41e6ce` 卡闸门 | `d==1` 时 1/3 | 仅 `d==1` 时 1 | 0（`ai/policy.ts:221` 替身） | ✖ 替身 |
| `0x420eca` 道具闸门 | 同上 | 仅 `d==1` 时 1 | 0（`ai/policy.ts:320` 替身） | ✖ 替身 |
| `0x441d4a` 手牌起点 | N>8 时 `%N` | N>8 时 1 | 0（`ai/policy.ts:226` 替身） | ✖ 替身 |
| `0x447ff5` 道具起点 | count>4 时 `%count` | count>4 时 1 | 0（`ai/policy.ts:323` 替身） | ✖ 替身 |
| `0x42bf14` 银行买股闸 | `%3==0` | 1/回合 | **无判定** | ✖ 缺失 |
| `0x436893` 自动贷款 | `%10==0` | 命中时 1 | **无判定**（`ai/policy.ts:506-513`） | ✖ 缺失 |
| `0x42c690` 选股 | `%24 ≤ 12−i` | 每个候选 1 | 0（`ai/stock-policy.ts:343` 替身） | ✖ 替身 |
| `0x42c802` 卖股闸 | `%3==0` | 1 | 0（`ai/stock-policy.ts:558` 替身） | ✖ 替身 |
| `0x41a23e` 行業別 | `%4+1` | 买地时 1 | 1（`state/reduce.ts:4696`，真 `rng.next()`） | ✅ 一致 |
| `0x42153e` 地雷/定時 | `%候选数` | 1 | 0（`ai/tool-policy.ts:307` 替身） | ✖ 替身 |
| `0x421657`/`0x42168d` 機車/汽車 | `%4==0` | 各 1 | 0（`ai/tool-policy.ts:315`/`:319`） | ✖ 替身 |
| `0x421e43` 工程車 | `%15<=個性` | 1 | 0（`ai/tool-policy.ts:497`） | ✖ 替身 |
| `0x42216f` 核子飛彈 | `%候选数`，最多 10 次 | 最多 10 | **已接线**（`ai/tool-policy.ts` 的 `hedan`，替身盐 `0x42216f+try`） | ✔ 替身（Q-TOOL-3 **已裁决：原版会放**，见第八节 #9） |
| `0x42886e`/`0x428a37`/`0x428ae8` 公佈欄 | `%15`/`%3`/`%4` | 各 1 | 各 1（`state/reduce.ts:3892/3927/3938`，真 `rng.next()`） | ✅ 一致 |
| `0x4288fb`/`0x4289d3` 公佈欄 | `rand()%候选` | 命中时各 1 | 命中时各 1（`state/reduce.ts:3899/3917`） | ✅ 一致 |
| `0x415457`+`0x4154b6` 小游戏不玩 | `%20` + `&1` | **2** | **1**（`state/reduce.ts:2473`） | ✖ 少 1 次 |
| 各卡效果内部 §五#18 | 天使/惡魔/怪獸/改建/冬眠/夢遊… | ≥6 处各 1 | 0（全走 `aiRoll`，如 `ai/card-policy.ts:369/406/607/617`） | ✖ 替身 |

**AI 小结（最严重 4 条）**

1. **随机数替身（D-004）覆盖整条 AI 决策链** —— `個性`闸门（`ai/policy.ts:405-407`）、
   手牌起点（`:226`）、道具起点（`:323`）、选股（`ai/stock-policy.ts:343`）、卖股（`:558`）、
   卡/道具效果内部十余处全部**不推进 `rngState`**。这不是「少掷几次」而是**序列错位**。
   D-004 只登记了闸门一处，实际范围至少 6 处。
2. **银行 AI 三处缺失**：`0x42bf14` 的 `rand()%3==0` 买股前置闸、`0x436893` 的 `rand()%10==0`
   放款闸与「资产 ≥30000 不放款」。属**判据缺失**而非替身，玩家可观察。
3. **`0x4284be` 被 `ai.md` 误标为「股票交易 AI」**，remake 按「公佈欄 AI」实现（1/15 挂、
   1/3 重估、1/4 买）；反汇编复核认定 **remake 正确、规格标签错**，
   且规格 §七-4「三道闸门判据未决」其实已解。
4. **`AiPersonality{aggression,cashReserve}` 是原版没有的维度**（`ai/policy.ts:75-88, 93`）
   —— 全仓无调用方的死代码。

**已知偏离复核**

- **D-004**（`known-deviations.md:629-635`）：描述与代码一致；**地址应由 `0x0041e6c9` 订正为
  `0x41e6ce`，且未覆盖道具侧 `0x420eca`**。建议扩容该条或拆条。
- **D-005**（`:4091-4098`）：与代码一致 —— `ai/card-policy.ts:80 VIEW_HALF=220`、
  `:121-123 inView` 以玩家为中心，无镜头钳位；`visibleEntities/visibleRivals/visibleObjects`
  与 `ai/tool-policy.ts:134-141` 共用。描述准确。
- **D-006**（`:4085-4089`）：与代码一致 —— `ai/stock-policy.ts:290-294 rankStocks` 用
  `b.score-a.score || a.stock-b.stock`，稳定、同分下标升序。描述准确。
- **D-007**（`:4063-4069`）：**方向正确但覆盖不全，第②点与代码不符**。① 准确，但漏了候选起点
  两处（`ai/policy.ts:226`、`:323`）、卡/道具效果内部十余处 `aiRoll`、以及小游戏少 1 次；
  ② 「公佈欄三道闸与 `rand()&1` 跨进第 2 步时一次性掷」**不是偏差** —— 公佈欄确实真掷
  （`state/reduce.ts:3892/3899/3917/3927/3938/3975`）且顺序与原版一致。
  **还差的消费点清单**：`0x41e6ce`、`0x420eca`、`0x441d4a`、`0x447ff5`、`0x42c690`、`0x42c802`、
  `0x42153e`、`0x421657`、`0x42168d`、`0x421e43`、`0x42216f`，外加**要新增** `0x42bf14`、`0x436893`
  两处「原版有、remake 连判定都没有」的缺失，以及小游戏 `0x4154b6`。

---

## 六、随机数一致性

### 6.1 PRNG 本体：位级一致 ✅

原版 `0x00456f2d`（`game-loop.md` §四）：

```asm
00456f37  imul edx, dword ptr [eax], 0x41c64e6d   ; state *= 1103515245
00456f3d  add  edx, 0x3039                        ; state += 12345
00456f43  mov  dword ptr [eax], edx
00456f45  mov  eax, edx
00456f47  shr  eax, 0x10
00456f4a  and  eax, 0x7fff
```

| 核对项 | 原版 | remake（`packages/core/src/rng/watcom.ts`） | 判定 |
|---|---|---|---|
| 乘数 | `0x41C64E6D`（`0x456f37`） | `MULTIPLIER = 0x41c64e6d`（`:24`） | ✅ |
| 增量 | `0x3039`（`0x456f3d`） | `INCREMENT = 0x3039`（`:26`） | ✅ |
| 状态宽度 | 32 位 dword（`mov dword [eax], edx`） | `>>> 0` 保持 uint32（`:73`） | ✅ |
| 溢出截断 | `imul`/`add` 的 32 位回绕 | `(Math.imul(s, M) + I) >>> 0`（`:73`，`Math.imul` 为 32 位回绕乘） | ✅ |
| 返回值取位 | `shr eax,0x10` 后 `and 0x7fff`（bit16..30，15 位） | `(this.#state >>> 16) & 0x7fff`（`:74`） | ✅ |
| 取模 | `call rand / mov edx,eax / sar edx,0x1f / idiv n`（有符号，但被除数恒 ≥ 0） | `next() % n`（`:88`） | ✅ 等价 |
| `srand` | `0x456f50`：`mov edx,[esp+4]; mov [eax],edx`（**直接赋值**，另有 null 检查 `test eax,eax / je`） | `seed(v){ this.#state = v >>> 0 }`（`:54-56`） | ✅（remake 无 null 分支，见第八节） |
| 默认种子 | CRT `__initthread` `0x45c8e3 mov dword [ebx+0xc],1` | `DEFAULT_SEED = 1`（`:33`） | ✅ |
| 状态块 | 线程数据块 `call [0x488f4c]; add eax,0xc`（`0x456f23`），全局唯一 | `GameState.rngState`（单值，各调用点 `setState`/`getState`） | ✅ 语义等价（但见 6.2 的存档后果） |

复核命令：`python3 tools/r4dump.py 0x456f23 0x456f60`、`python3 tools/r4dump.py 0x45c8d5 0x45c8f5`；
差分测试见 `rich4-spec/tests/test_prng.py`（5 种子 × 12 值 + 状态推进逐一比对）。
**结论：PRNG 本体无差异，没有沿用 `rich4-re/asm/mscrt.ld` 的错误重定向**（D-001 的 T-001 陷阱记录成立）。

### 6.2 种子来源与重播种：**记录与代码不符** ❌

| 项 | 原版 | remake | 判定 |
|---|---|---|---|
| 启动播种 | `0x0040170F` `srand(GetTickCount())` | `rules/new-game.ts:369,385`（`newGame({seed})`）+ `client/src/main.ts:5921,5931`（宿主给 `Date.now()`）；`state/reduce.ts:876-879` 的 `case 'reseed'` 也直接写 `rngState` | 大致对应（客户端用 `Date.now()` 而非 `GetTickCount()`，非零差异） |
| 读档后播种 | `0x00402FA1` `srand(GetTickCount())` | **没有**。存档整份 `JSON.stringify(state)`，**包含 `rngState`**（`loaders/savegame.ts:74-77`；写档点 `client/src/main.ts:1264`、`:1425`；`saveload.ts:172-174`）；读回即精确恢复 | ❌ 与 D-001 描述相反 |
| 每回合（每天）播种 | `0x0041D06E` `call GetTickCount(IAT 0x4623cc)` → `call 0x456f50`，**在 `0x41d076` 股市收盘之前**（`r4dump 0x41d060 0x41d0b0` 实测） | **没有**：全仓 `grep "'reseed'"` 只命中 `actions.ts`/`reduce.ts` 的定义，没有任何派发点（client/server/desktop 皆无） | ❌ 与 D-001 描述相反 |
| 策略模块 | —— | `rng/policy.ts`（`SINGLE_PLAYER_POLICY.reseedOn = ['gameStart','afterLoad','turnAdvance']`、`serializeRng`/`deserializeRng`）**只被 `rng/policy.test.ts` 引用**，生产路径一次都没调 | 死代码 |

⇒ `known-deviations.md:8-81`（D-001）的「单机：零偏离……三个播种时机与原版相同，存档不含 PRNG 状态，
故读档重开可刷结果」**与实现不符**：实际是「只在开局播一次种 + 存档带 `rngState`」，
即**原版「读档重开刷结果」与「每回合重新播种」两个可观察特性都没有了**。
这条应在报告第十节按「已知偏离，但记录本身不正确」处理。

### 6.3 消耗次数与顺序：逐处对照

「次数」= 该点实际 `call 0x456f2d` 的次数。`✅` = remake 真消耗且次数一致；`替身` = 有判定但用
状态派生值代替、**不消耗**；`少 N` = 真消耗但比原版少 N 次；`缺失` = 连判定都没有。

| # | 原版点 | 语义 | 原版次数 | remake | 判定 |
|---|---|---|---|---|---|
| 1 | `0x419572`（`0x419595 call rand`） | 掷骰：`ndices` 颗，逐颗 `rand()%6+1`；遥控骰（`ecx != 0`）不掷且强制 1 颗 | `ndices`（顺序按下标） | `rng/watcom.ts:108-125` `rollDice`，调用点 `state/reduce.ts:932` | ✅ |
| 2 | **`0x40c196`** | 走子选路：**只要有候选（`test esi,esi / jne`）就 `call rand / idiv esi`** —— 1 个候选也掷（余数恒 0） | 每步 1 次（候选 ≥ 1 时） | `state/reduce.ts:657`：`if (candidates.length === 1) return candidates[0]` **提前返回、不掷**；仅 `> 1` 才 `rng.next()%n`（`:659`） | ❌ **每步少 1 次**（正常路径几乎每步都命中） |
| 3 | `0x415457` + `0x4154b6` | 小游戏「不玩」：`50 + rand()%20` 得分，再 `rand()&1` 选角色台词 | **2** | `state/reduce.ts:2467-2483` 只 `rng.next()` 一次（`:2473`） | ❌ 少 1（三个小游戏共用） |
| 4 | `0x41b1f8` | 得點券 **50** 點：`call rand / and eax,1` 选台词 | 1 | 无（`reduce.ts:997-1001` 只加点数） | ❌ 少 1 |
| 5 | `0x41b343`（`0x441e12` 内 `0x441e4a call rand; idiv ebx`） | 抽卡格：按牌堆剩余量加权抽一张 | bag 非空时 1 | `rules/special-square.ts:147` → `rng/watcom.ts:147`（`bag[rng.below(bag.length)]`） | ✅ |
| 6 | `0x44f280`（`0x44f230` 内） | 抽卡格尾部台词：卡价 ∈ `(0x32,0x64]` 时 `rand()&1`（受影响卡号：11 怪獸 60、15 冬眠 100、30 烏龜 70） | 条件 1 | 无 | ❌ 条件性少 1 |
| 7 | `0x43d3d8` / `0x43d44f` / `0x43d4ac` | 监狱/医院保释（AI）：管不管 / 1/3 追加 NPC / 选人 | 0..3 | `rules/visit.ts:164-203`（`decideBail`，`randomsUsed` 回写 `reduce.ts:2517-2520`） | ✅ |
| 8 | `0x4316db` | AI 买乐透：`rand()%空槽数` | 命中时 1 | `state/reduce.ts:3675-3679` → `aiBuyTicket` | ✅ |
| 9 | `0x42e97d` / `0x42eb05` / `0x42eb61` | 百貨公司：董事長礼 `rand()&1`（+ 道具/卡片各 1）；货架件数 `rand()%10+6`；每件再 1 次加权抽 | 条件 1+1 或 1；`1+n` | `places/shop.ts:247-262`（`drawCardShelf` = 1 + n 次 `drawRandomCard`）+ `reduce.ts:4148-4172`（董事长礼） | ✅ |
| 10 | `0x418e18` | ★ 每回合 `rand()&1` 决定用卡/用道具 | 1/回合 | `state/reduce.ts:3844-3847`（跨进 `aiStep 2` 时一次） | ✅ |
| 11 | `0x41a23e` | 电脑买商業用地 → 行業別 `rand()%4+1` | 1 | `state/reduce.ts:4692-4706`（真 `rng.next()`）→ `rules/facility.ts:407-409` | ✅ |
| 12 | `0x42886e` / `0x428a37` / `0x428ae8` / `0x4288fb` / `0x4289d3`（+ `0x428a9c`…） | `0x4284be` 的**公佈欄 AI**（1/15 挂、1/3 重估、1/4 买；命中时再 `rand()%候选`） | 条件 3 + 命中 0..2 | `state/reduce.ts:3883-3976`（`aiNoticeBoardTurn`，真 `rng.next()`） | ✅ |
| 13 | `0x41e6ce`（卡）/ `0x420eca`（道具） | 個性闸门 `d==1` 时的 1/3 判定 | 仅 `d==1` 时 1 | `ai/policy.ts:405-407` `gateRoll`（调用 `:221`/`:320`） | ❌ 替身（D-004） |
| 14 | `0x441d4a` / `0x447ff5` | AI 候选起点（手牌 > 8 / 道具 > 4） | 条件 1 | `ai/policy.ts:226` / `:323` → `ai/card-policy.ts:72` `aiRoll` | ❌ 替身 |
| 15 | `0x42bf14` | 银行 AI 第一步：`rand()%3==0` 才继续（否则本回合不炒） | 1/回合 | **无判定**（`ai/stock-policy.ts:323` 只判 `stockRatio===0`） | ❌ 缺失 |
| 16 | `0x436893` | 银行自动放款：`rand()%10==0` | 命中时 1 | **无判定**（`ai/policy.ts:506-513`） | ❌ 缺失 |
| 17 | `0x42c690` / `0x42c802` | 选股 `rand()%24` / 卖股非强制 `rand()%3` | 各 1 | `ai/stock-policy.ts:343` / `:558`（`aiRoll`） | ❌ 替身 |
| 18 | `0x42153e` / `0x421657` / `0x42168d` / `0x421e43` / `0x42216f` | 地雷·定時炸彈选地块 / 機車 / 汽車 / 工程車 / 核子飛彈 | 各 1（核彈最多 10） | `ai/tool-policy.ts:307`/`:315`/`:319`/`:497` 替身；核彈 `hedan`（逐次盐） | ❌ 替身（不推全局流，D-004） |
| 19 | 各卡效果函数内部（`0x41e6fe..0x420970`） | 天使/惡魔/怪獸/改建/冬眠/夢遊… 各含 `rand()` | ≥6 处各 1 | `ai/card-policy.ts` 内十余处 `aiRoll`（如 `:369`/`:406`/`:607`/`:617`） | ❌ 替身 |
| 20 | `0x448b81` / `0x44baea`（由 `0x4074bf`/`0x4074c4` 调用） | 开局洗新闻 36 项 + 命运 37 项 | 36 + 37 | `rules/new-game.ts:386-387` → `events/deck.ts:47-55` | ✅（顺序亦同：新闻先、命运后） |

**小结**：算法级一致、**序列级不一致**。第 2 条（`pickNextNode`）是流量最大的一处；
第 3/4/6 条是落点/小游戏路径的固定漏掷；第 13~19 条是 AI 路径的替身/缺失。
（第 21 类「每日股市行情 / 樂透开奖的 rand」属股票专題；由于原版在 `0x41d06e` **每日重播种**，
这些点即使不同也不会跨日累错，但会影响**同一天之内**其后的抽取，故不列入本表的「1:1」。）

---

## 七、remake 多出或未见于原版的实现


| # | 位置 | 内容 | 原版对应物 | 判定 |
|---|---|---|---|---|
| 1 | `packages/core/src/places/minigame.ts:70-86` | `clampMinigameScore`：把外部报上来的分数夹到 `0..999`，非有限值归 0 | 原版分数由玩法自身产生，**没有任何夹逼**（唯一夹子在七彩氣球普通支 `0x414ef3`，且 `×2` 支不夹，见 D-MINI-12） | 多余实现（轻微）。它只在「真人报分」这条**原版不存在的接口**上生效 |
| 2 | `packages/client/src/interactions.ts:311-330` | `case 'minigame'` 给出的两个按钮：**「不玩，隨便給點」**与**「報成績」**（带填数窗） | 原版真人进了小游戏窗**必须玩完**（窗过程只有 `0x0f/0x113/0x201/0x203/0x401/0x405`；「不玩」只对 `+0x15 != 1` 或 cfg 关掉时成立） | 多余实现（已登记为 D-MINI-5）；「报成绩」是原版完全没有的输入面 |
| 3 | `packages/client/src/minigame-screen.ts:153`、`:802`、`:1408` | 999 上限做成三屏通用 | 原版只有七彩氣球有 `0x3e7` 夹子（`0x414ef3`）；企鵝上限 188、財神无夹子 | 多余实现（轻微）。见第四节 #12 |
| 4 | `packages/core/src/ai/policy.ts:75-88, 93` | `AiPersonality { aggression, cashReserve }` + `DEFAULT_PERSONALITY` + `AiContext.personality` | 原版没有「难度」维度；AI 参数只有 `個性(+0x17)`、`使用卡片(+0x16 bit0)`、`使用道具(bit1)`、`資金運用比例(+0x19)`、`自動貸款比例(+0x18)` | 多余实现（轻微）。**全仓只有 `ai/policy.test.ts` 引用**，生产路径无调用方 —— 死代码 |
| 5 | `packages/core/src/state/reduce.ts:1007`、`:4166` vs `packages/core/src/cards/rob.ts:101-112` | 「手牌满 15 就不收新卡」与「满 15 先丢最便宜的再收」**两套口径并存** | 原版 `0x4412e4`：满 15 → 先丢最便宜的、再收新卡 | 不是「多出」而是**口径错**（抽卡格与商店赠卡用了错的一支）。见第二节 type 13 |
| 6 | `packages/core/src/rng/policy.ts`（全文件） | 播种策略模块（`SINGLE_PLAYER_POLICY` / `MULTIPLAYER_POLICY` / `serializeRng` / `deserializeRng`） | 原版三处 `srand(GetTickCount())` 的真实时间是「启动 / 读档后 / 每日行情前」，且不是可通过 action 注入的纯函数 | 死代码（严重：它让 D-001 看起来已实施，实际未接线） |
| 7 | `packages/core/src/state/types.ts:28-29`、`rules/monthly.ts:1-13,22-70`、`rules/special-square.ts:5` 等 20+ 个 core/client 文件 | `@source` 直接写 `rich4-re/asm/...` 或 `rich4.asm:行号` | 铁律 1：应改引 `rich4-spec` 的 VA（如月结 `0x437d1a`/`0x437dfe`/`0x437e61`/`0x439bfa`，对照 `bank.md` §3、`gods.md` §七） | 溯源不合规（轻微）。`grep -rl "rich4-re" packages/core/src packages/client/src` 命中 20+ 文件；数值本身多数与规格一致 |
| 8 | `packages/client/src/speech-bubble.ts:105` | 注释「`0x3b9` = 1000 就是超时」 | `0x3b9` = 953，且是**自定义窗口消息（音乐开关，`0x4019f2`）**；超时常量是 `0x3e8` = 1000 | 仅注释错误（轻微）。**不是**把它当导航消息 |

---

## 八、无法判定项


1. **`0x456f32` 的状态块 null 分支**：原版 `call 0x456f23 / test eax,eax / jne 0x456f37 / ret`
   —— 状态块为空时**直接返回、`eax` 未定义**；remake 的 `next()` 无条件计算（`rng/watcom.ts:72-75`）。
   「原版在什么情况下会拿到 null 状态块」无法判定（推测与线程数据未初始化有关），
   故无法判定该分支是否可达、是否需要复刻。
2. **原版每日重播种后的序列**：`0x41d06e srand(GetTickCount())` 使「同一天内的随机流」依赖挂钟，
   所以**原版本身不可复现**。remake 不重播种。要说「remake 的随机流与原版一致」只能在同一挂钟
   种子下、且**只比较同一天之内**的消耗；跨日比较无意义。⇒ 6.3 表的判定口径仅在同日内成立，
   **无法给出「整局序列一致」的结论**。
3. **消息泵嵌套的等价性**：原版是「深度计数器 `0x46cad8` + 层级过滤器数组 `0x48a010[depth]`」
   （`0x4018e7`）；remake 是「有序屏表 + `active()` 自报」（`client/src/main.ts:4240-4246`、
   `client/src/screens.ts:37-76`）。**结构不同**（没有深度值、没有栈）。
   「多个模态嵌套」是否逐屏等价**无法判定**；且**未做动态插桩证明 `0x46cad8` 实际会到 2**
   （已知最深的具体需求是收租模态里再弹免費卡确认，而 remake 明确未实现该支，记 D-008）。
4. **每日股市行情 / 樂透开奖的 `rand()` 消耗次数**（`0x42915a`/`0x4291d6`/`0x431712` 及其内部）
   未逐点清点（属股票专题）。**无法判定**其与 remake（`state/reduce.ts:3094/3102/3128`）
   是否一致。
5. **`+0x15`（who_plays）的位定义**：规格自身矛盾（`places.md:161-176` 与 `small-games.md:148`
   把 `==1` 读作「电脑」，`ai.md:1162-1166` 与实测都把 `==1` 读作「走 UI 的真人」）。
   remake 取「1=真人、2=电脑、bit2=托管」（`state/types.ts:31-42`），与 `ai.md` §八 自洽，
   但**哪一种才是原版语义无法判定**。受影响的判据：小游戏闸门（`0x41560d`）、
   买商業用地（`0x41a21f`）、用卡/用道具驱动（`0x441bc1`）。
6. **小游戏真人的分数**：原版真人得分由 `rand()` 驱动的玩法产生（棋盘生成 `0x41208f`、
   气球生成 `0x4131a5`/`0x413001`/`0x413083`、財神状态机 `0x4138d2`/`0x413904`、
   掉落物 `0x412400`、爆炸 `0x4137a7`/`0x4123ba`…），其中一部分**取决于玩家的鼠标操作**。
   remake 客户端用 `minigameSeed(state, game, nonce)`（`client/src/minigame-screen.ts:1627`）
   派生种子，不消耗 `state.rngState`。**无法判定**「同一局同一操作下得分分布是否与原版一致」——
   原版那条路本身就不可复现（与 D-003 的真人轮盘同类）。
7. **`0x42e931`（落点 type 15）的语义边界**：`0x41b3b9` 只调它、无 `0x43380a`（实测），
   且它内部既做百貨公司货架（`0x42eaff` 起）又做企業盈餘累加（`0x42ed57` 起 `+0x28/+0x2c`）。
   规格 `game-loop.md` 表把 type 15 写成「企業格」并加了 `0x43380a`。
   **按机器码 remake 是对的**；但规格文档的表述是否需要订正（`stocks.md` 也把同一批
   `0x1770..0x1f3f` 记录称为「企業」）**无法判定**。
8. **银行自动贷款的比例字段**：`0x4368db mov bh,[+0x496b80]`（= 玩家 `+0x18`）究竟是角色表的
   f24 还是别的字段，`bank.md:333-338`（说 `+0x18` 是自动贷款比例且「无人写」）与
   `ai.md:279/315`（说 `+0x17` 是 `個性`）**互相矛盾**；remake 把 f24 接到 `+0x18`
   （`loaders/savegame.ts:406`、`ai/personality.ts:170`）。**无法判定**其映射是否 1:1，
   需按 exe 现场复核 `0x4368db` 与角色表拷贝点。
9. ~~**原版 AI 是否真的从不放核子飛彈**~~ **✅ 已裁决（2026-09-20，第 160 条）**：
   旧论据把 AI 侧的 `0x40a0b1(x, y, −1)` 与效果侧的 `0x40a45c(r)` 混为一谈。
   `0x40a0b1` 是「以 (x,y) 为中心**重建**实体图 + 再收集」，重建时**只写格距 ±14 格内的
   有主地块/設施**（`0x40a22d` 起），`−1` 只表示「扫这张刚建好的图」⇒
   中止判据的真实语义是「我的棋子落在候选 ±14 格（448px）内」，**可假** ⇒
   **原版会放核彈**。差分证据 `rich4-spec/tests/test_nuke_card_ai.py`（113 例）；
   复刻 = `ai/tool-policy.ts` 的 `hedan`，`AI_NEVER_USES = [10]`。
   详见 `known-deviations.md` 的 Q-TOOL-3（已标解决）。
10. **「回合数上限」终止条件**：`0x41d89e` 只读 `0x49911c`/`0x499108`，未见任何回合上限比较，
    原版侧**未找到**（无 @source 可给）⇒ 无法判定；remake 的 `turnCount` 是每玩家回合 +1
    （`state/reduce.ts:1711`），语义也未对位。
11. **三个小游戏是否都会在真实对局出现**（地图数据里 type 6/7/8 的分布）：来自地图文件，
    不在 exe 里（`small-games.md:857` 未决 11）。未统计 `extracted/map/*.bin`，**无法判定**。
12. **`0x40c196` 在「候选 = 1」时那次 `rand()` 的玩家可见性**：从指令看它必然消耗；
    但若原版在该路径上随后立即重播种（例如同一帧内有别的 `srand`），则差 1 次不可观察。
    本轮未找到支持这种可能的证据，故按「必然错位」记为差异；但**未做 emulator 差分**
    （需 Unicorn），「玩家可见」是推断而非实测。

---

## 九、建议的修复顺序

> 原则：先修「每一步/每一回合/每一局都发生」的错位，再修条件性的；先修一行能改的，
> 再修需要搬迁架构的；文档订正放最后，但必须做（否则后续轮次会按错标签施工）。

| 序 | 项 | 文件 | 理由 |
|---|---|---|---|
| 1 | **`pickNextNode`：候选数为 1 时也要消耗一次 `rand()`** | `packages/core/src/state/reduce.ts:657-659` | 影响面最大（几乎每走一格），一行可改；改完 6.3 表第 2 条归零 |
| ~~2~~ | ~~**接上阻碍/关押的释放链**~~ **✅ 已完成**（第 83/84 条）：消费 `tickBlocking().released`，清占用表 + `whoPlays \|= 0x10`（「走回棋盘」那一回合）| `packages/core/src/state/reduce.ts:1637-1642`、`rules/confinement.ts:128` | 玩家可直接观察（幽灵保释、刑满者不回棋盘）；已有 `release()` 实现，属接线 |
| 3 | **小游戏「不玩」补第二次 `rand()`**（角色台词） | `packages/core/src/state/reduce.ts:2467-2483` | 三个小游戏共用；补一次 `rng.next()` 即可 |
| 4 | **得點券 50 點补 `rand()&1`；抽卡格补条件性 `rand()&1`**（卡价 ∈(50,100]） | `packages/core/src/state/reduce.ts:997-1009`（或 `rules/special-square.ts`） | 与 3 同类，改动小；三处一起做，避免反复改同一条流 |
| 5 | **抽卡格满手牌改走 `giveCard`**（丢最便宜再收），商店赠卡同理 | `packages/core/src/state/reduce.ts:1007`、`:4166` | 消除同仓两套口径；`cards/rob.ts:101-112` 已有正确实现 |
| 6 | **小游戏玩法侧三处硬错**：企鵝炸彈结束、气球 8 条道、喜從天降炸彈概率取反 | `packages/client/src/minigame-screen.ts:526-538`、`:645-646`、`:1179`（+ 测试与文档） | 都是玩家可直接观察的差异，且各自是「一个常数/一个比较符」级别 |
| 7 | **AI 随机点搬进 reducer**：`個性`闸门（卡/道具两处）、手牌/道具候选起点、选股/卖股、地雷·定时·機車·汽車·工程車、各卡效果内部 | `ai/policy.ts`、`ai/card-policy.ts`、`ai/stock-policy.ts`、`ai/tool-policy.ts` | 工作量最大，但只有把「掷点」上移到 reducer（策略层收「已掷好的值」）才能同时满足 C-ARC-4 与 1:1；做这一步时**顺带撤销 D-004** |
| 8 | **补两条缺失判据**：银行 AI 的 `rand()%3==0` 买股闸、自动放款的 `rand()%10==0` +「(现金+存款) ≥ 30000 且 rand 不中就不放款」 | `ai/stock-policy.ts:318-331`、`ai/policy.ts:506-513` | 不是替身而是**判据缺失**，属玩家可观察差异 |
| 9 | **月结尾部清零** `totalWinterSleepDays/monthlyPaid/monthlyReceived` | `packages/core/src/rules/monthly.ts:216-219` 或 `state/reduce.ts:3136` 一带 | 第 2 个月起月度奖项失真；`deviations/T-041.md:9` 已写明该清零，只需落码 |
| 10 | **core 补两道闸**：`[0x497159]`（真人也走不玩）与落点层 `+0x37`（夢遊整格不结算） | `state/reduce.ts:2441-2457`、`:980-1047` | 前者是配置判据、后者是覆盖性闸门，都是数行改动 |
| 11 | **落实或撤销 D-001**：要么让宿主在 `afterLoad` / 每日行情前真的派发 `{type:'reseed'}` 并按模式决定是否把 `rngState` 写进存档，要么把 D-001 改成「已定为有意偏离（引擎确定性优先）」 | `rng/policy.ts`、`loaders/savegame.ts`、`client/src/main.ts` | 现状是**记录与实现不符**，比偏离本身更危险 |
| 12 | **文档订正（不改行为）**：`ai.md` 的 `0x4284be` 标签（→公佈欄 AI）、`game-loop.md` 表 type 15（去 `0x43380a`、语义改「百貨公司」）、`small-games.md` 的满分 363→188 / type1 个数 / 炸彈 70%→30% / `0x475004` 补 12 字节、D-004 地址订正为 `0x41e6ce` 并补道具侧 `0x420eca`、D-007 扩容消费点清单、`monthly.ts` 等 20+ 文件的 `@source` 改引 VA、Q-MINI-1 正文与 D-MINI-5 的过期/错误表述、`speech-bubble.ts:105` 注释 | 规格文档 + `known-deviations.md` + `docs/deviations/*` | 让后续轮次不再按错标签/错记录施工 |
| 13 | 清理死代码 | `ai/policy.ts:75-93`（`AiPersonality`）、`rng/policy.ts`（若第 11 步不接） | 防止后来人误以为「AI 有难度旋钮」「单机重播种已实现」 |
