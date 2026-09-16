# Q-FORTUNE-1：命运事件的**神明加持**与四条「只写不生效」的事件

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

## 仍未做

- **事件 32「變賣所有卡片道具」**（`fcn_0044d677`）：把所有卡片与道具折价卖掉。
  它与事件 9 的股票版同构，但卡片/道具的**折价公式**还没读（`fcn_00426af8`
  那一套市价是公佈欄的口径，未必同一支）—— 登记为 Q-FORTUNE-1 的尾巴。
- 事件 0/1/5/6/7/13/18/20/21/23/24/26/30/31/34/35/36 等仍按事件表的
  `effects` 走既有实现或 `unimplemented`（多数是金额类，已实现）。
