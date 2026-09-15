# Q-COMMERCIAL-1 —— 上市企業落点：**路过 vs 停留**、以及买股的「通用填数窗」

> 需求方原话（2026-09-15）：
> 「路过企业（IBM）后**直接触发问我要不要买股票**，应该是**只有停留在这个格子上才可以直接买**；
>  这里买股票应该**调用通用的那个计算器**而不是自己写个模块」
>
> 本文件登记这一轮的取证结论、改了什么、以及**没解出/有意不做**的。
> 代码落点：`packages/core/src/state/reduce.ts`、`packages/core/src/rules/interaction.ts`、
> `packages/core/src/places/company.ts`、`packages/client/src/interactions.ts`、
> `packages/client/src/stock-screen.ts`、`packages/client/src/main.ts`。

---

## 结论速览

| # | 需求方报的 | 结论 | 处置 |
|---|---|---|---|
| 1 | 路过上市企業也弹「要不要买股票」 | **在真浏览器里没复现** —— 路过（含 IBM 那两格）**不掉任何 pending**；停上去才掉 | 已加回归用例钉住（`commercial-landing.test.ts`）。见下「怎么复现」 |
| 2 | 买股票该用**通用计算器**、不是自己写个模块 | 两条路的**窗**本来就都是通用的 `AmountPage`；但**上限**是客户端自己算的（各算各的） | 上限收回 core（企業落点）/ 收进模块（股市柜台），界面只把上限交给同一扇窗 |

---

## 1. 「路过也弹框」—— 没复现，且引擎本来就不会

### 原版这一支是**落点**专属

踩到上市企業的那一段在 `_rich4_handle_player_land_on_node` 的落点函数里：

```asm
0041b067  push ebx
0041b068  mov  ebp, dword [_rich4_current_player]
0041b06b  push ebp
0041b070  call fcn_0041d1a9            ; ← 認購問句 + 通用填数窗
```

`fcn_0041d1a9` 只被这一处调用（`grep fcn_0041d1a9` 全库仅 1 个 caller）。而「路过」那一格
在原版走的是**另一支**（逐格 tick 的到达处理，只有物件/乞丐），与落点函数无关。

本引擎同构：`reduce.ts` 的 `case 'step'`（每走一格）只调 `applyArrival`（物件/乞丐那一套），
`landOnCompany` 只在 `case 'settle'` 里调：

```ts
// reduce.ts case 'settle'
const landIndex = landIndexAtPlayer(state, topo);
if (landIndex === null) {
  const fac = facilityAtPlayer(state, topo);
  if (fac !== null) return landOnFacility(state, topo, fac);
  if (node.ref.kind === 'commercial') return landOnCompany(state, topo, node);   // ← 只有这里
  return { ...state, phase: 'turnEnd' };
}
```

### 怎么复现（真浏览器，照做即可）

**⚠️ 先别看错地图**：`map.mkf` 的编号是 `globalMapId * 2 + 1`（`assets.ts` 的 `readMapData`），
所以**地图号 3 才是 `0007.bin`**（IBM 在 33、34 两格）；`?map=6` 打开的是 `0013.bin`，
那张图上 33/34 是 `special`，一开始就是这里把人绕进去的。

1. 起一个临时 dev server（看完关掉）：`cd packages/client && npx vite --port 5199 --strictPort`
2. 打开 `http://127.0.0.1:5199/?screen=game&map=3&seed=7`（IBM 那张图）
3. 用 DEV 钩子 `__rich4`（`import.meta.env.DEV` 下挂在 `globalThis`）摆好局面并逐步驱动 ——
   `__rich4.dispatch` 走的就是人点按钮同一条 `reduce` 路：

```js
const run = (from, prev, forced) => {
  const s0 = __rich4.state;
  s0.players[0].nodeId = from; s0.players[0].lastNodeId = prev;
  s0.pending = null; s0.phase = 'awaitingRoll';
  const log = [];
  __rich4.dispatch({ type: 'rollDice', forced });      // forced = 骰子点数
  for (let i = 0; i < 16; i++) {
    const s = __rich4.state;
    log.push([s.phase, s.stepsRemaining, s.players[0].nodeId, s.pending?.kind ?? null]);
    if (s.phase === 'moving') __rich4.dispatch({ type: 'step' });
    else if (s.phase === 'settling') __rich4.dispatch({ type: 'settle' });
    else break;
  }
  return log;
};
run(32, 31, 3);   // 32 → 33(IBM) → 34(IBM) → 35   路过两格企業
run(32, 31, 2);   // 32 → 33(IBM) → 34(IBM)         停在企業上
```

实测（2026-09-15，本机 Chromium + vite dev）：

```
passOverIBM: [moving,3,32,null] [moving,2,33,null] [moving,1,34,null] [settling,0,35,null] [awaitingDecision,0,35,"buyLand"]
stopOnIBM:   [moving,2,32,null] [moving,1,33,null] [settling,0,34,null] [turnEnd,0,34,"buyShares"]
```

即：**踩上 33、34 那一拍（`stepsRemaining` 还是 2 和 1）pending 一直是 `null`**；
只有 `settle` 停在 34 上才出现 `buyShares`。地图 0 那条走廊（21 公園 → 51、52 臺灣人壽两格
→ 20 樂透 → 53 台中市）同样如此。

### 剩下的两种可能解释（都不是「路过触发」）

1. **看到的是别的图**：`?map=6` 那一把我自己一开始就撞上了 —— 那张图 33/34 不是企業。
   若需求方报的是「IBM」而跑的不是地图 3，那他踩的其实不是 IBM 格。
2. **表现层时序**：填数页是在 `settle` 那一刻挂出来的，而 `settle` 由
   `scheduleHumanTurn` 的机械驱动派发，中间隔着 `holdForActorWalk`（等补间播完）。
   如果哪天这道闸失灵，画面会表现为「棋子还在 IBM 上滑行就弹了框」——
   那属于 `render.ts`（别的 agent 在动）的补间闸，**不是落点判据**。
   本文件不认领；要复现请看 `docs/deviations/T-047.md`。

---

## 2. 「买股票要用通用计算器」

### 原版两条路，**同一扇窗**

| | 入口 | 上限怎么来 | 填数窗 | 成交 |
|---|---|---|---|---|
| 上市企業落点 | `0x0041d24d` 訊息框 `fcn_00440ba8` | `fcn_0041d1a9` 自己算 | `0x0041d25b` `fcn_00453544(上限)` | `0x0041d281` `buy_stock(…, 0)` |
| 股市柜台 買進 | `loc_0042aee4` | `loc_0042af30` 自己算 | `0x0042af92` `fcn_00453544(上限)` | `0x0042afc6` `buy_stock(…, 1)` |

两条都**先把上限算好**再开窗（`push eax / call fcn_00453544`），窗子本身不含规则。

### 本引擎的对应物

「通用填数窗」= `packages/client/src/dialog.ts` 的 `AmountPage` +
`drawDialog` / `layoutDialog` / `hitDialog`（銀行、公佈欄、股市柜台、填数页**同一套**）。

- **上市企業**：`interactions.ts` 的 `case 'buyShares'` 给出 `choices[0].amount`
  → `main.ts` 的 `onDialogHit` 见 `amount` 就开通用填数页 → 「確定」派 `fill(n)`。
  这一步**本来就是通用的**（两个选项时还是原版的 YES/NO 訊息框）。
  真浏览器里点「YES」之后读到的按钮就是
  `["− 1","+ 1","最大","確定","取消"]` —— `dialog.ts` 那一套。
- **股市柜台**：`main.ts` 的 `stockTrade('buy')` 用 `stockAmountUi()` 合成一个「对话」
  交给同一个 `drawDialog`。窗也是通用的。

### ★ 真正的缺口：**上限是界面自己算的**

- 企業落点那条：`interactions.ts` 拿 `pending.available`（企業餘量）当上限，
  等于把原版的三道夹回**抄了半份**在界面上，而且抄少了：

```asm
; fcn_0041d1a9（VA 0x0041d857 起）
0041d845  mov  ecx, 0x2710            ; 10000
0041d857  mov  eax, [ebx + 0x24]      ; 企業資產額
0041d860  idiv ecx                    ; 每股售價 = 資產額 ÷ 10000
0041d86a  mov  edx, [esi + 0x496b84]  ; ★ 買家**現金**（player + 0x1c）
0041d88e  idiv ecx                    ; 現金 ÷ 每股售價
0041d85d  cmp  eax, 0x3e8
0041d863  jle  loc_0041d216
0041d865  mov  esi, 0x3e8             ; ★ 一律夹到 1000 股
0041d216  mov  eax, [ebx + 0x30]      ; 企業還剩多少股
0041d21c  cmp  esi, eax
0041d21e  mov  esi, eax               ; ★ 再夹到企業餘量
0041d21f  test esi, esi
0041d221  je   near loc_0041d2bb      ; ★ 算出来 0 → 連問都不問
```

  实测（IBM）：資產 4,000,000 → 單價 400；現金 100,000 → `現金 ÷ 單價 = 250`；
  企業餘量 5,000 ⇒ 原版上限 **250**，而改之前界面给的是 **5000**。

- 股市柜台那条：算式写在 `main.ts` 的事件处理里（`Math.min(st.f10, trunc(存款 ÷ 股價))`），
  与企業那条**各写各的**。

### 改了什么（都带 `@source`）

1. **core 出上限**：`places/company.ts` 新增 `shareWindowLimit(unitPrice, cash, available)`
   = `min(MAX_SHARES_PER_PURCHASE(0x3e8), 現金 ÷ 單價, 企業餘量)`；`pendingForCommercial`
   把它放进 `pending.max`，**并且上限算出来是 0 时直接返回 `null`**（原版 `test esi,esi / je`：
   一股都买不起 / 企業售罄 → 訊息框都不开）。`rules/interaction.ts` 的 `buyShares`
   多了 `max` 字段。
   ⚠️ 电脑那条走的是**另一个**上限（`_rich4_calculate_max_purchase_count`，VA 0x0041d839：
   資產 × 物價当安全垫，**没有 1000 这层闸**），所以 `policy.ts` 照旧用 `available` 自己算，
   没有被 `max` 卡住。
2. **界面只读不算**：`interactions.ts` 的填数页 `max: pending.max`。
3. **柜台那条收进模块**：`stock-screen.ts` 新增 `stockCounterBuyMax(deposit, price, floating)`
   （`@source loc_0042af30`），`main.ts` 的 `stockTrade('buy')` 改成调它 —— 与企業那条并列，
   两条上限各有出处、都不在事件处理里现算。

### 测试

- `packages/core/src/state/commercial-landing.test.ts`
  - ★ 路过（21→51→52→20→53，踩过企業两格）**每一拍都没有 pending**，落点也不是 `buyShares`
  - ★ 停在 51 / 52 上才出现 `buyShares`
  - ★ 上限 = `min(1000, 現金 ÷ 單價, 餘量)`（IBM 那种 250、現金 1000 时 25）
  - ★ 現金 0 → **没有 pending**、阶段直接 `turnEnd`
- `packages/client/src/interactions.test.ts`（新建）
  - ★ 第一步是原版 YES/NO 訊息框；「買」带的是 `amount`（= 通用填数页）
  - ★ 填数页的版式/命中全部出自 `dialog.ts`（`− 1 / + 1 / 最大 / 確定 / 取消`）
  - ★ 上限就是 `pending.max`，界面不算
  - ★ `stockCounterBuyMax` 的三个边界
- `packages/core/src/places/company.test.ts` 的 `landing()` 夹具补了
  `commercialShares`（原先为空表 → 按原版就该「不问」，夹具漏了企業有股可卖这件事）。

---

## 3. 没解出 / 有意不做的

| 项 | 说明 |
|---|---|
| `pending.max` 只有 1000 这一层是**窗口上限**，`reduce` 不硬拦 | 原版 `buy_stock`（0x428d2a）对「从企业买」这条路**一个检查都没有**（直接 `sub [ecx+0x30]` / `sub [ebx+0x496b84]`），兜住它的就是填数窗。本引擎保留三道物理闸（`>0`、`≤ available`、`× 單價 ≤ 現金`）当护栏，但**没有**把 1000 写进 reducer —— 否则电脑那条（0x41d839，无 1000 闸）会被误伤 |
| 柜台那条的上限仍在**客户端** | 原版就是在 UI 窗口过程里算的（`loc_0042af30`），本引擎没有对应的 `pending`，故收进 `stock-screen.ts` 一个带 `@source` 的纯函数；若日后把股市屏也做成 `pending`，可再往 core 搬 |
| `fcn_0041d1a9` 进门还有两道闸**没接** | `cmp byte [esi+0x37], 0 / jne 结束`（**梦游中**不问）与 `who_plays == 0`（出局）—— 前者本引擎理论上可达（梦游时路过自家/别家企業），本轮没做，登记在此 |
| 建設公司董事長那条仍会先挂 `chooseBuildTarget` | 与原版同序（加蓋完才回到 `0x41b067` 问認購），不在本卡范围 |
| 「路过也弹框」若需求方仍能复现 | 按 §1 的配方录一份 `[phase, stepsRemaining, nodeId, pending.kind]` 轨迹（或一张截图）再回来，本文件就能定位到具体是哪一拍的 |
