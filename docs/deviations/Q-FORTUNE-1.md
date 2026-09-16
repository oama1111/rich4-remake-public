# Q-FORTUNE-1：命运/新闻事件的**神明加持**与几条「规则译好了却没接线」的事件

SPDX-License-Identifier: GPL-3.0-or-later

> 2026-09-16 收口。两件事：
> ① 神明加持（財運 `+0x46` / 福運 `+0x48`）**规则早就译好了、却从来没接上** ——
>    命运事件一律按「无加持」算，等于「神明白拜了」；
> ② 命运事件 **8/9/10/11**（卖股票 / 变卖股票 / 座驾被偷 / 座驾撞毁）在我们的
>    端口里是 `unimplemented`，抽到就是「有文案、没效果」。
> 顺带查出一条**更隐蔽**的：`checkFortune` 的可行性判据喂的是**空数据**，
> 于是事件 0/1/8/9 **永远抽不到**。

## ① 神明加持：规则在哪、怎么接

施加阶段的第一步就是问一次 `fcn_0044b896`（VA 0x0044b896），返回值**不是布尔**
而是**档位** `0/1/2`（见 `rules/blessing.ts` 的头部表）。三种问法：

| 问法 | 压栈 | 读哪个字段 | 高值（>100） | 50..100 | 负值 |
|---|---|---|---|---|---|
| 獎金 `reward` | `(0,0)` | `+0x46` 財運 | **2** 加倍 | `rand()&1` × 2 | **1** 作废 |
| 罰金 `penalty` | `(0,1)` | `+0x46` 財運 | **1** 免付 | `rand()&1` | **2** 加倍 |
| 劫难 `misfortune` | `(1,1)` | `+0x48` 福運 | **1** 逃過 | `rand()&1` | **2** 加倍 |

★ 「高值」对奖金是加倍、对罚金是免付 —— 原版就是在两个分支里把 `mov ebx,1` 与
`mov ebx,2` 对调实现的，不是另算一套。

**哪条事件用哪种问法**（逐处读 `push ? / push ? / call 0x44b896` 得到，
已写进 `@rich4/data` 的 `EventEntry.blessing`）：

| 事件 | 问法 |
|---|---|
| 2 冒貸 · 3 支票跳票 · 8 股票違約交割 · 9 變賣所有股票 · 14/15 交通罰款 · 17 請客 | `penalty` |
| 6 強迫出國 · 7 被外星人綁架 · 10 機車被偷 · 11 汽車撞毀 · 12 掉進水溝 · 22 撿到錢 · 32 變賣卡片道具 · 33 酒醉坐牢 | `misfortune` |
| 19 小狗亂大小便罰款 | `reward` |
| 其余 19 条 | **不问** |

★ **整个 `rich4_news.asm` 一处都没问** —— 加持只作用于命运事件。

**接法**（`state/reduce.ts` 的 `drawAndApplyFortune`）：

```ts
const blessKind = fortuneEvent(effectiveId)?.blessing;
const rng = new WatcomRng(); rng.setState(withDeck.rngState);
const coinFlip = rng.next() & 1;                  // 50..100 那一档要掷一次
const blessLevel = blessKind === undefined ? 0
  : blessingLevelFor(blessingFieldOf(me, blessKind), coinFlip, blessKind);
```

`applyFortuneEffect` 里：
- 金额事件：`amount = 事件金额 × blessingMultiplier(档)`（2 → ×2、1 → ×0）；
- 坐牢/住院：`天数 × blessingMultiplier(档)`，档 1 ⇒ 直接 `cancelled`（不关人）；
- 卖股票 / 座驾那四条：**只看档是不是 1**（挡掉），档 2 与 0 同路 —— 照抄
  `cmp eax, 1 / jne 继续`，**不是** `blessingMultiplier`。

## ② 四条事件的效果（逐条 @source）

### 事件 8「股票違約交割損失股票%d％」`fcn_0044c7ef`

```asm
call 0x44b896(0,1) / cmp [0x48c5b0],1 / je 取消      ; 神明挡掉
ratio  = [0x48c5b4] / [0x465a24]                     ; literal 10 / 100.0
for i in 0..11:
    shares = trunc(持仓[i] × ratio)
    rich4_sell_stock(player, i, shares, 0)            ; ★ 0 = 进**公库**
push 0 / call 0x436b0a                               ; ★ 收回特別融資
```

### 事件 9「變賣所有股票求現」`fcn_0044c91f`

```asm
call 0x44b896(0,1) / cmp [0x48c5b0],1 / je 取消
for i in 0..11:
    if (持仓[i] == 0) continue
    rich4_sell_stock(player, i, 持仓[i], 1)           ; ★ 1 = 进**存款**
push 0 / call 0x436b0a                               ; ★ 同样收回特別融資
```

★ 两处 `call 0x436b0a` 是**命运事件里唯一的两处**（`rich4_fortune.asm:974/1089`）；
`Q-FIN-2` 那条「真人回合的收回入口」由此**结案**：真人回合确实没有，
除了这两条命运事件。

### 事件 10「機車被偷遺失」/ 11「汽車撞電線桿全毀」`fcn_0044ca46` / `fcn_0044cb53`

```asm
call 0x44b896(1,1) / cmp [0x48c5b0],1 / je 取消
player+0x11 = 0        ; traffic_method → 徒步
player+0x12 = 1        ; ndices → 1
update_player_sprite
fcn_0041d476(...)      ; 10 用 (3,0,0)、11 用 (1,0,0)
player_say(...)        ; 10 是 rand()&1 二选一、11 固定第一句
inc byte [0x497324]    ; ★ 事件 10：機車（道具 5）回**商店库存**
inc byte [0x497325]    ; ★ 事件 11：汽車（道具 6）
```

**⚠️ 原版不看当前座驾是什么**：开着汽車抽到「機車被偷」照样把 `traffic_method`
清零、并把**機車**库存 +1（凭空多出一台機車可买）。这是原版的既定行为，
本引擎**照抄**，不"改正"。

## ③ 顺手查出的真 bug：可行性判据喂的是空数据

`drawAndApplyFortune` 建 `checkFortune` 的上下文时写死了：

```ts
lands: [] as never[],
stockAmount: new Array<number>(12).fill(0),
```

而 `checkFortune` 正是拿这两样判 0/1（拆屋 / 徵收）与 8/9（卖股票）：

```ts
case 0: return ctx.lands.some((l) => l.owner === ownerId && l.level !== 0) ? yes() : no;
case 8: case 9: return ctx.stockAmount.some((a) => a !== 0) ? yes() : no;
```

⇒ **这四条事件永远判为不可行**，牌堆直接跳过它们 —— 表现就是
「命运牌堆里 0/1/8/9 从没出现过」。现在喂真数据：归属与等级取运行时状态
（`state.landOwner` / `state.landLevel`，不是地图静态表），持股取 `state.holdings`。

## ④ 同一天顺手发现的另一条：新聞的四条**百分比**事件也没接线

`rules/percentage.ts` 把四条按比例算的事件逐条译好了（含 `trunc` 与物价指数的
**先后顺序**、D-QNUM-2 的订正），但**全仓库只有它自己的单测在调它**：

| 事件 | 基数 | 税率 | 方向 | @source |
|---|---|---|---|---|
| 11 所有人繳交所得稅５％ | 现金 `+0x1c` | 5%（不乘指数）| 缴公库 | `0x00449cce` |
| 12 所有人繳交地價稅５％ | 名下地产原值 | `trunc(原值×5%) × 物價` | 缴公库 | `0x00449ede` |
| 13 所有人繳交證交稅５％ | 持股市值 | 同上 | 缴公库 | `0x0044a0e5` |
| 23 銀行加發１０％儲金紅利 | 存款 `+0x20` | 10%（不乘指数）| **发钱** | `0x0044af3c` |

而 `applyNewsEffect` 对四条都走 `entry.factor === null → unimplemented` ——
**抽到只画文案、一分钱不动**（`IMPLEMENTED_NEWS_IDS` 里也没有它们）。

原版是**两趟循环**：

```asm
00449cce  for (i = 0; i < num_players; i++) {
            if (player[i].who_plays == 0) continue    ; 出局跳过
            [0x48c59c + i*4] = trunc(基数 × 税率)      ; 先算好、画那一行
          }
00449da1  for (i = 0; i < num_players; i++) {        ; ★ 第二趟才真收钱
            if ([0x46caf8] != 0) break                ; 终局码
            pay_money(player[i], -1, [0x48c59c + i*4], 0)
          }
```

本引擎按同一口径接上：`news-effects.ts` 新增 `PERCENT_NEWS`（事件 → 每人金额的
算法），`affected` 取**全部在场玩家**（`newsTargets` 新增 11/12/13/23 四条），
`lands`/`facilities`/`holdings`/`prices` 由 reducer 喂真数据；
出局者跳过、付不起走既有的 `transferMoney`（级联 + 破产）。

**仍未做**：这四条原版是「先算好存进 `[0x48c59c + i*4]`、**第二趟**才收」——
表现层要按这个顺序把「每人缴多少」逐行画出来（我们目前只在结算后才有一句文案）。
属表现层，登记在此。

## ⑤ 事件 32「變賣所有卡片道具」—— 折价公式读出来了，并顺手补上破产那一支

**折价公式就是原价**（不打折、不乘物价指数）：

```asm
; fcn_0044d677 施加阶段
call 0x44b896(1,1) / cmp [0x48c5b0],1 / je 取消
call _rich4_player_sell_all_tools(player)      ; 返回 Σ 持有量 × 道具表 price
add word [player+0x30], ax                     ; ★ 进**點券**（+0x30）
call _rich4_player_sell_all_the_card(player)   ; 返回 Σ 1 × 卡片表 price
add word [player+0x30], ax                     ; ★ 两笔都进點券
```

`_rich4_player_sell_all_tools`（**VA 0x445b3f**，asm 树里没有这个函数的 dump，
本节是用 `tools/disasm.py va` 直读 exe 补的）：

| 步 | 做什么 | @source |
|---|---|---|
| ① | 座驾折回道具：`traffic & 3` = 1/2/3 → **道具 5 機車 / 6 汽車 / 12 工程車** +1；`traffic = 0`、`ndices = 1` | `0x445b49`..`0x445ba7` |
| ② | 逐件卖：`for (id = 1; id <= 13; id++)`，`得 += 持有量 × 道具表 price`，持有量清零 | `0x445bb0`..`0x445c0c` |
| ③ | **只有 id ≤ 8 的还回商店库存**（`cmp eax, 8 / jge 跳过`）| `0x445bd0` |

`_rich4_player_sell_all_the_card`（**VA 0x441f21**）：15 个手牌槽逐个卖，
每张 `卡片库存 += 1`、`得 += 卡片表 price`，手牌清零。

两者的「price」都读**表项 +5 那个字节**（`byte [eax*8 + 0x47fee7]` /
`byte [dl*8 + 0x47fdef]`），与 `@rich4/data` 的 `TOOLS[].price` /
`CARDS[].price` 一致（实测全部 ≤ 250，塞得进一个字节）。

**落码**：`rules/inventory.ts` 的 `sellAllTools` / `sellAllCards`（纯函数，
原样返回新表）。两个调用点：

1. 事件 32 —— 所得进**點券**；
2. ★ **破产清算**（`rich4_player_bankrupt.asm:412-417`，紧接变卖持股那一段）——
   `call` 两次但**把返回值丢掉**（人都出局了）。这一步先前**整个漏了**：
   `markPlayerBankrupt` 只 memset 玩家结构，碰不到手牌/道具那两张全局数组，
   于是出局者的卡与道具会永远留在表里（既不能被抢、也不回商店）。
   与持股清算一样，只在**非终局**路径上做（终局时最后出局者的手牌留着 ——
   这正是 `rules/bankruptcy.ts` 记的 `Save0.dat` 实证）。

## 仍未做

- 事件 0/1/5/6/7/13/18/20/21/23/24/26/30/31/34/35/36 等仍按事件表的
  `effects` 走既有实现或 `unimplemented`（多数是金额类，已实现）。
