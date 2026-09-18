# 差距清单 · 地产租金 / 金钱核算 / 银行 / 股市

> 生成方式：以 `rich4-spec/docs/systems/{land-rent,economy,bank,stocks}.md` 为权威，
> 逐条核查 `rich4-remake` 实现。本轮只做分析，未改动任何代码。
>
> **规格版本（本次阅读的行数）**：`land-rent.md` 306 行、`economy.md` 107 行、
> `bank.md` 1157 行、`stocks.md` 1313 行；差分测试 `tests/test_wealth.py`(262)/`test_toll.py`(127)。
> 补充佐证（非本主题指名规格）：`cards.md`（涨价位翻倍）、`places.md`（`0x499080` 即累積獎金）。
>
> 本报告的所有「原版侧」结论都给出 `@source VA`；带 **【本轮复核】** 的条目是本次用
> `rich4-remake/tools/disasm.py va <VA>` 或直读 `Rich4/rich4.exe` / `Rich4/*.DAT`
> 原始字节重新核对过的（不依赖 `rich4-re/`）。
> 「remake 侧」一律给 `文件路径:行号`。
> 规格自身有误之处单列在 §三末与各条备注里（不重复计为 remake 差距）。

---

## 一、结论摘要

| 分类 | 数量 |
|---|---|
| 已 1:1 实现（逐条核对通过，见文末附表） | **22** |
| 有差距 | **42**（严重度：阻断 **8** / 严重 **8** / 轻微 **26**） |
| 类型分布 | 缺失 **8** / 算法错 **9** / 数值错 **8** / 时序错 **4** / 接口不符 **2** / 多余实现 **4** / 无法判定 **7** |
| remake 多出或未见于原版规格的实现 | **11**（其中 2 项经复核属「规格漏记」） |
| 规格/记录本身有错（勘误，不计为 remake 差距） | **6** |

**最严重的三条**（都在「金钱核算/银行」一侧，会让玩家当场算出不同的数）：

1. **开局现金分配对真人算错**：原版**真人固定拿`初始资金/2`**、只有电脑按角色
   `init_cash_ratio` 分（`0x4072ff test al,1 / je 0x4071d4` + `0x407307 sar eax,1`；
   已用原版 `SAVE1.DAT` 实证）。remake 对**所有人**用 `initCashRatio`
   （`rules/setup.ts:100-106`）。默认 30 万下小丹尼（ratio 55）会拿到 165000 而非
   原版的 150000。
2. **银行贷款额度算错且被额外夹取**：额度快照用
   `calculatePlayerWealth(me, [], [])`（`state/reduce.ts:3771`）——地产、设施、股票
   全部漏掉，而原版 `0x48c3b0` 是**全式**净资产；随后 `borrow()` 又用
   `Math.min(amount, capacity)` 夹取（`places/bank.ts:101-102`），而原版输入框
   **可以超贷、无二次校验**（`0x453544` 不读 `0x48ca98`）。
3. **贷款没有还款日 ⇒ 90 天期限/到期强制扣款/因此破产整条链缺失**：
   `borrow()` 从不写 `loanDueDate`（`places/bank.ts:96-113`），全仓无写入点；
   原版 `0x433b7e` 在放款后写 `今天+90 天` 并逐日跳过星期日/假日，`0x436a5a`
   每回合检查、到期日 `0x433bd8` 强制扣款、扣不出就破产。

> 其余大额差距：柜台买入上限读错字段（`+0x08` 而非 `+0x0a`）、新局不初始化 `+0x0a`
> 导致首轮 AI 买不了股、新闻 24/25 缺即时跳价、AI 回补額度后漏调银行对账
> （`0x436b0a(1)`）、儲金紅利进错账户且缺 `loan≠0` 闸、月度累加器不清零。

---

## 二、差距明细

| # | 条目 | 原版规格（证据） | remake 现状（证据） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 1 | **开局现金分配：真人应固定 50/50** | `0x4072ff test al,1 / je 0x4071d4`（al = 人类=1 / 电脑=2，来自 `0x4072ec` 对 `[0x48a35c+12p]` 取符号）；`0x407307 sar eax,1` = `cash = 初始资金/2`；`0x4071d4` 才是 `trunc(ratio×资金/100)`。【本轮复核】原版 `Rich4/SAVE1.DAT` 实测 | `rules/setup.ts:100-106`，所有人按 `initCashRatio`；调用点 `rules/new-game.ts:224` | 数值错 | 阻断 | 真人走 `cash = trunc(初始资金/2)`（`0x407307`），只有 `+0x64==2` 的电脑按 ratio；并修 `known-deviations.md` F-001 |
| 2 | toll：`level > 5` 的越界读被改成 0 | `land-rent.md:241` / `0x419796` 无上界校验（越界读 `0x20+level*2`） | `rules/toll.ts:81` `land.rentByLevel[land.level] ?? 0` | 数值错 | 轻微 | 若要 1:1 需按 `0x20 + level*2` 读取相邻字段；否则保留 `?? 0` 并在 KD 登记为有意偏离 |
| 3 | toll 返回值无 32 位回绕 | `land-rent.md:219,242`：`imul`（`0x4197e0`）按补码回绕 | `rules/toll.ts:89` `base * priceIndex`（JS number） | 数值错 | 轻微 | 改用 32 位语义（`Math.imul` 或位或 0）并在 KD 登记；否则接受 2^31 量级才可见的差异 |
| 4 | **月结不清空月度累加器** | `bank.md:481-482`：`0x439ec6..0x439ef3` 把每人 `0x42`、`0x5c`(monthly_paid)、`0x60`(monthly_received) 清 0 | `state/reduce.ts:3136` 只调 `settleMonthlyBank`；`monthlyPaid/Received` 全仓无月结清零点（仅 `payment.ts:227,250,300` 累加） | 缺失 | 严重 | 月结里把 `totalWinterSleepDays / monthlyPaid / monthlyReceived` 清 0（对齐 `0x439ec6..0x439ef3`） |
| 5 | 破产时 `monthly_paid` 的累加时序 | `bank.md:§附A`：`0x41d375 call 0x40cd87`（先破产 memset）→ `0x41d381 add [+0x5c], ebx`（后累加）⇒ 破产者 `+0x5c` = 最后一笔实付 | `rules/payment.ts:227` 先累加 → 调用方 `applyBankruptcy` 再 memset 0（`bankruptcy.ts:148`）⇒ 为 0 | 时序错 | 轻微 | 把 `monthlyPaid` 的累加挪到 `applyBankruptcy` 之后（或破产路径保留该值），与 `0x41d381` 对齐 |
| 6 | **贷款额度被夹取** | `bank.md:145-151,430`：`0x453544` 不夹取、窗口过程 `0x452bc9` 不读 `0x48ca98` ⇒ 「输入 > 默认值 → 允许」 | `places/bank.ts:101-102` `Math.min(amount, capacity)`；测试固化 `bank.test.ts:73-77` | 算法错 | 阻断 | 去掉 `Math.min(amount, capacity)`：额度只作默认值，是否超贷交给输入层（原版不校验） |
| 7 | **银行额度快照漏掉地产/设施/股票** | `bank.md:204-219`：`0x48c3b0 = 0x4239b9(player)` 全式（现金+存款−贷款+Σ持股×股价+住宅+商業） | `state/reduce.ts:3771` `calculatePlayerWealth(me, [], [])`（lands/facilities 传空、stocks 缺省 `[]`）→ 只剩现金+存款−贷款；喂给 `3775` 的 `loanCapacity` 与 `1388` | 数值错 | 阻断 | `reduce.ts:3771` 改传 `allEffectiveLands/allEffectiveFacilities/valuationsOf`（与 `3057`/`panel.ts:124` 同源） |
| 8 | **贷款不设还款日** | `bank.md:224-245`：`0x433b7e`：`f44==0` 时 `0x45218f(今天,0x5a)`，`0x4523d5` 非营业日则 `0x452117` 逐日顺延 | `places/bank.ts:96-113` `borrow()` 不碰 `loanDueDate`；全仓 `loanDueDate:` 只有清零（`bank.ts:151`、`bankruptcy.ts:121`、`new-game.ts:245`）与读（`ai/stock-policy.ts:331`、`stock-market.ts:592`） | 缺失 | 阻断 | `borrow()` 成功后按 `0x433b7e` 写 `loanDueDate = 今天+90 天并跳过星期日/假日`（`rules/calendar.ts` 已有 `isHoliday`） |
| 9 | **到期检查/强制扣款/破产整条缺失** | `bank.md:649-663`：`0x436a5a` 跳表 `0x436a4a`（剩 3/2 天提示、0 天 `0x433bd8` 强执 → 扣不出 `0x40cd87` 破产） | 全仓无实现（`grep 貸款到期/即將到期/請不要忘記` 零命中）——因 #8 而恒不触发 | 缺失 | 阻断 | 补 `0x436a5a` 的每回合到期检查（3/2/1 天提示、当天 `0x433bd8` 强执 → 扣不出即破产） |
| 10 | 手动还款缺「现金不足」校验 | `bank.md:259-266,431`：`0x43538c cmp edx,ecx / jle`，超过 `cash+deposit` 报 `0x475850` 且**不扣款** | `places/bank.ts:133-153` 无校验；存款不足时 `cash += bank`（可为负）；只有表现层拦（`client/bank-dynamic.ts:915-918`） | 算法错 | 严重 | core 层加 `amount > cash + moneyInBank ⇒ 拒绝且不扣款`（`bank.ts:133`），不要只靠 client |
| 11 | 手动还款被夹到贷款余额 | `bank.md:274-275`：`0x4353cc sub edx,ebx`（可把 loan 变负，且归零判定用 `jne`） | `places/bank.ts:135` `Math.min(amount, player.loan)` | 数值错 | 轻微 | 去掉 `Math.min(amount, player.loan)`，按 `0x4353cc` 允许还成负数、只在恰好 0 时清到期日 |
| 12 | AI 提前还款整支缺失 | `bank.md:299-322`：`0x4367ab..0x43688e`（剩余 ≤6 天才考虑；`loan*1.1 > cash+deposit` 不还；`2*loan < 存款` 时无视 1.1 门槛直还） | `ai/policy.ts:506-513` 只有 `borrow`；全仓无 AI repay 分支 | 缺失 | 严重 | 补 `0x4367ab..0x43688e`：剩余 ≤6 天才考虑；`2*loan<存款` 直还，否则需 `cash+deposit ≥ loan*1.1` |
| 13 | AI 放款条件不全 / 赋值变累加 | `bank.md:323-344`：仅 `loan==0` 才走放款（`0x4367b2 je`），且须 `rand()%10==0` 或 `cash+deposit < 30000`（`0x4368a4/0x4368bb`）；`0x4368fc mov [loan], eax` 是**赋值** | `ai/policy.ts:511-512` 在柜台且 `want>0` 就借（无概率/贫困闸、`loan≠0` 也借）；`bank.ts:109` `loan + borrowed` 累加 | 算法错 | 阻断 | 加 `loan==0` 前置 + `rand()%10==0` 或 `cash+deposit<30000` 触发条件，并把 `loan=` 改成赋值语义 |
| 14 | **特別融資週轉被夹取** | `bank.md:408-409`：`0x434665..0x43468c` 无上限校验（【本轮复核】`0x434665` 段无 `cmp`） | `places/special-finance.ts:164-165` `Math.min(trunc(amount), room)` | 算法错 | 阻断 | 去掉 `Math.min(trunc(amount), room)`：原版週轉現金无上限校验（`0x434665`） |
| 15 | 特別融資多出「暫停放款」硬门禁 | `bank.md:897,1063`：`+0x3c` 的读点是 `0x4341e7`/`0x434313`（【本轮复核】那两处是 `cmp [p+0x3c],0` 后**画禁止章**），点击处理 `0x434665/0x4346bb` 无门禁 | `places/special-finance.ts:162-163` `bankFreezeDays !== 0 → null` | 多余实现 | 轻微 | 去掉 `borrowSpecial` 里的 `bankFreezeDays` 判据（原版 `+0x3c` 只画禁止章，不拦点击） |
| 16 | 歸還款項被夹到 `specialFinance` | `bank.md:384-394,409`：唯一校验是 `cash+deposit`（`0x4346e9`），`0x434727 sub [special_finance], edx` 不夹 | `places/special-finance.ts:184` `Math.min(trunc(amount), me.specialFinance)` | 数值错 | 轻微 | 只保留 `cash+deposit` 校验（`0x4346e9`），不要夹到 `specialFinance` |
| 17 | AI 比例重分后漏调银行对账 `0x436b0a(1)` | `bank.md:566,776`：`arg=1` 在 `0x43784f`（ATM 取款）**与 `0x437c14`（AI 重分）** | `state/reduce.ts:3721-3731` 只重分；`settleBankReserve` 唯一调用点 `reduce.ts:1380`（取款） | 缺失 | 严重 | `rebalanceBankOnArrival` 之后补 `settleBankReserve(state, topo)`（对齐 `0x437c14 push 1`） |
| 18 | **儲金紅利：缺 `loan≠0` 闸 + 入错账户** | `bank.md:513-519`：`0x44af36 mov ebp,[+0x8c] / test / jne 跳过`；`0x44af5c push ebp(=0)` → `0x41d3f4` **flags=0 = 进存款**（【本轮复核】`0x41d3f4 test byte [esp+0x10],1 / je → add [+0x20]`） | `events/news-effects.ts:198` `bankDividend(p)` 无 loan 闸；`785-805` 走 `receiveMoney(players, who, each)`（默认 `toCash=true` → **现金**）；测试固化 `news-effects.test.ts:149-160` | 算法错 | 严重 | 加 `loan!==0 → 0/跳过` 闸；入账改 `receiveMoney(players, who, each, false)`（进**存款**） |
| 19 | 拒絕往來/暫停放款的提示文案缺失 | `bank.md:862`：`0x464bed '銀行拒絕往來\n\n還剩%d天！'`、`0x464bd4 '銀行暫停放款\n\n還剩%d天！'` | core 直接 `return null` 不给原因（`reduce.ts:3768-3770`）；client 只有 ATM 禁止章（`client/bank-screen.ts:241`），主屏那句只在注释里 | 缺失 | 轻微 | `pending` 带上拒绝/冻结的原因与剩余天数，client 补 `0x464bed`/`0x464bd4` 两条串 |
| 20 | `rebalanceCashByRatio` 对 `total<=0` 提前返回 | `bank.md:766-771`：原版 `0/0=NaN` → 全线落入重分 → `fistp` 写 `0x80000000`，现金与存款双双变 INT_MIN | `places/bank.ts:282` `if (total <= 0) return player;`（代码注释声称已登记 Q-BANK-3，**实际未登记**） | 多余实现 | 轻微 | 要么复刻 NaN→INT_MIN 事故，要么在 KD 明写「主动避开」这条有意偏离（当前注释指向不存在的条目） |
| 21 | ATM「输入即夹取」vs「执行时夹取」 | `bank.md:83-89`：`0x4378d9` 输入超限**当场改写输入串** | `places/bank.ts:29,44` 在执行时 `Math.min`；金额结果一致、显示与提示不同 | 无法判定 | 轻微 | 若要 1:1，把夹取移到输入阶段（改写输入串并提示），而不是执行阶段静默夹取 |
| 22 | 月息用 BigInt 精确有理数替代 x87 | `bank.md:499-506`：`fild 存款 / fmul qword 1.1 / 0x457dbc / fistp`（x87 80 位中间积） | `rules/monthly.ts:60-70` 用 BigInt 精确展开 double 1.1；注释自认极端输入可能差 1 | 无法判定 | 轻微 | 补 `.5` 与大额边界差分用例；若发现分叉则改为显式 x87/双精度路径 |
| 23 | 月结的玩家集合 | `bank.md:495` 走 `0x48c418/0x48c420` 玩家列表（填充规则规格未给） | `state/reduce.ts:3136` 只对 `isAlive` 者结算（破产者存款已为 0，无可观察差异） | 无法判定 | 轻微 | 需 `0x439bfa` 填表汇编；若玩家列表含出局者则改掉 `isAlive` 过滤 |
| 24 | **柜台买入上限读错字段** | `stocks.md:779`：`0x42af43 mov cx, word [eax*4+0x49698a]` = **`+0x0a`**（可买余量）；【本轮复核】同址确认 | `state/reduce.ts:2575` `if (action.shares > stock.shares)`（`+0x08` 流通股）；`f10` 才是 `+0x0a`（`places/stock.ts:45-47`）；AI 那条反而用对（`ai/stock-policy.ts:352`） | 算法错 | 严重 | `reduce.ts:2575` 改用 `stock.f10`（`+0x0a`），与 `ai/stock-policy.ts:352` 统一口径 |
| 25 | 柜台买入存款上限算法 | `stocks.md:779`：`n ≤ trunc(存款/现价)`（`0x42af66 fdiv` + `0x457dbc`）后与 `+0x0a` 取 min | `state/reduce.ts:2576-2578` 用 `trunc(n×价) ≤ 存款` 反推（小数股价时可多买 1 股） | 算法错 | 轻微 | 改成 `n ≤ trunc(moneyInBank / price)` 再与 `+0x0a` 取 min（`0x42af66`） |
| 26 | **新局未初始化 `+0x0a`** | `stocks.md:812-824`：`0x42915a` 生成 `+0x0a`；【本轮复核】新局路径 `0x401ce1 call 0x407ad2` → `0x407dfe call 0x42915a`（`gen/db.txt:8257`） | `rules/new-game.ts:503` 只 `newStockMarket`（`stock-market.ts:215-216` 把 `f10` 直接取静态表的 0）；`refreshTradableShares` 唯一调用点是日推进 `reduce.ts:3094` | 时序错 | 阻断 | 建局时调 `refreshTradableShares`（对齐 `0x407dfe`），否则第一回合 `f10` 全 0 |
| 27 | `0x42915a` 的调用时机 | 【本轮复核】除建图 `0x407dfe` 外，`0x41c868 call 0x42915a` 在 `0x41c84f`（**每个玩家回合**，`bank.md:829`）内；规格 `stocks.md:§4.3` 只标「开局初始化」 | `reduce.ts:3094` 每天一次（注释写「@source 0041c868 —— 每日重算」） | 时序错 | 轻微 | 把刷新点移到每玩家回合开始（`0x41c84f` 的 `0x41c868`），并同步 rand 消耗顺序 |
| 28 | **新闻 24/25 缺即时跳价** | `stocks.md:485-488`：`0x44b04b`（新闻 24）、`0x44b096`（新闻 25）都 `call 0x429040`（±10% 当场改价 + 覆写前一格历史） | `events/news-effects.ts:706-712` 只把 12 支 `newsFlag` 写 0x1/0x10 就返回，未调 `applyStockNews`（27/28/30-35 都调了） | 缺失 | 严重 | 写完 `newsFlag` 后补 `applyStockNews(market, 0)`（`0x44b04b`/`0x44b096`） |
| 29 | AI 認購数量用自创策略 | `stocks.md:781`：`_rich4_calculate_max_purchase_count` = `min(前值, trunc((现金 − trunc(开局资金×0.3)×物价指数)/单价))`；【本轮复核】`0x41d267 push esi;push ecx;call 0x41d839`，`0x41d839` 内 `fild [0x49908c] / fmul qword 0x463cd0(=0.3) / 0x457dbc / imul [0x4990e8]` | `ai/policy.ts:548-555` `spendable = trunc(cash/2)`（源码自认是策略）；真人那条对（`places/company.ts:175-182` = `min(1000, trunc(cash/单价), 余量)`，与 `0x41d20a/0x41d216` 一致） | 算法错 | 严重 | AI 改用 `min(前值, trunc((cash − trunc(开局资金×0.3)×priceIndex)/单价))`（`0x41d839`） |
| 30 | 企业绑定：首个匹配 vs 最后一家赢；未命中置 0 vs 停在 1 | `stocks.md:216-218`：`0x428cb1` 循环命中后**不 break**（最后一家赢）；12 支都没企业指向时 `+0x04` **停在 1** | `places/stock-market.ts:190-191` `commercials.find(...)` + `?? 0`；测试固化 `stock-market.test.ts:394-395` | 算法错 | 轻微 | 按 `0x428cb1` 改成「不 break ⇒ 最后一家赢」；未命中时 `+0x04` 停在 1 而不是置 0 |
| 31 | 定价函数 `diff`/`rem` 的额外 f32 舍入 | `stocks.md:373-394`：`price` 落 f32（`0x428edc`）、`diff` **也落 f32**（【本轮复核】`0x428ef7 fstp dword [esp+8]`）、`fmod` 走 `fprem`（`0x45841c`，x87 扩展精度）、`fsubr qword` | `places/stock-market.ts:125-126` `Math.fround(raw-price)`（与 `0x428ef7` 一致）、`Math.fround(diff % tick)` 与末次加减再 fround（原版留在扩展精度） | 数值错 | 轻微 | 先按 §四 补 `0x428ec5` 的差分用例；若有分叉再取消 `diff % tick` 与末次加减的 `fround` |
| 32 | 下带 `0.85×锚点` 被钉成 f32 | `stocks.md:306`：`0x42931a fmul qword [0x463fdc]`（全函数唯一 qword 乘，双精度） | `places/stock-market.ts:262` `Math.fround(reference * underRatio)` | 数值错 | 轻微 | 该处去掉 `Math.fround`，用 double 值参与 `0x42931a` 的比较 |
| 33 | `+0x08`/`+0x0a` 无 u16 回绕 | `stocks.md:696-697,736-737`：`sub/add word` | `places/stock.ts:157,219` JS number（大额买入会让 `f10` 变负） | 接口不符 | 轻微 | `f10/shares` 用 `& 0xffff` 的 u16 语义（或登记为有意偏离） |
| 34 | 卖出「进公库」责任外移 | `stocks.md:742`：`0x428ea7 add [0x499080], eax` 在函数**内部** | `places/stock.ts:211-223` `'pool'` 分支不碰池，由调用方补账（`reduce.ts:4920`、`fortune-effects.ts:389-401`） | 接口不符 | 轻微 | 让 `sellStock` 自己写池，或加断言/类型约束防止新增调用点漏账 |
| 35 | 日推进缺 `0x428475` | `stocks.md:1187` 第 ⑤ 步 `0x41cfc4 call 0x428475` | `state/reduce.ts:3086-3103` 无此步；`places/notice-board.ts:40-60` 论证「只写不读」故不建模（已记录） | 缺失 | 轻微 | 保留不建模（`notice-board.ts:40-60` 已论证），在 KD 补一条登记 |
| 36 | 新闻 31 是否也即时跳价 | `stocks.md:485-488` 的调用点清单**不含** `0x44b419`（新闻 31） | `events/news-effects.ts:581-637` 30~35 一律调 `applyStockNews` | 无法判定 | 轻微 | 补 `0x44b3a0–0x44b470` 完整反汇编后再定 |
| 37 | 新闻强制方向支是否过均值回归 | `stocks.md:§8 未决#9` 只钉住「不加全市场漂移」，未给 `0x42923d` 的 jmp 终点 | `places/stock-market.ts:330-343` 新闻支跳过 `meanRevert` | 无法判定 | 轻微 | 补 `0x42923d` 之后的 jmp 目标后再定 |
| 38 | `0x429040` 是否跳过 `newsFlag==0` | `stocks.md:474-481` 摘录缺 `test dl,dl / je` | `places/stock-market.ts:392` 未标记的直接跳过（测试固化 `:267-270`） | 无法判定 | 轻微 | 补 `0x429040` 完整体（`0x429070–0x429080`）后再定 |
| 39 | `news_dir` 两个半字节是否各自递减 | `stocks.md:1208-1210` 摘录里 `dec dh` 的源寄存器与 `sub ch,0x10` 的源字段互相矛盾 | `places/stock-market.ts:441-446` 两半字节独立递减（测试固化 0x35→0x24） | 无法判定 | 轻微 | 补 `0x41d02b–0x41d064` 完整体后再定 |
| 40 | 行情随机源的墙钟重播种 | `stocks.md:410-446`：每日 `srand(GetTickCount())`（`0x41d066-0x41d06e`）⇒ 不可复现；规格允许「有意偏离」 | 已知偏离 D-001（`known-deviations.md:22-79`）；但 `rng/policy.ts:45` 的单机 reseed 策略**无生产调用者**（只有 `client/main.ts:5921` 开局播一次种），与 D-001「单机零偏离」的记载不符（**记录与实现不一致**，KD 未登记） | 时序错 | 轻微 | 接通 `rng/policy.ts` 的单机 reseed，或修正 D-001「单机零偏离」的记载 |
| 41 | `[0x499078]` 被建模成「大盘指数」 | `stocks.md:§8 未决#1`：只被存档写出、无逻辑读取 | `places/stock-market.ts:146,359` 建成 `index`，读档重算（`loaders/savegame.ts:246-252`） | 多余实现 | 轻微 | 保留并在 KD 补登「原版无逻辑读取」 |
| 42 | `holdingsCost`（自创持仓成本账） | `stocks.md:905-914`：原版不算已实现盈亏、均价只是 UI 一列 | `ai/stock-policy.ts:123-128` 用 `Math.round` 维护 `holdingsCost`（源码自认自造） | 多余实现 | 轻微 | 保留并汇总登记为「本引擎自造账目」 |

---

### 逐条说明

#### 1. 开局现金分配：真人应固定 50/50（阻断）

原版 `sub_00406de7`（新局初始化）在逐玩家循环里先 `memcpy(player, 角色表[id], 0x68)`
（`0x4072c3 push 0x68` / `0x407272 mov ebp,0x496b68` / `0x4072e4 call 0x456de8`），
然后按 `[0x48a35c+12*player]` 的**符号**定人类/电脑：

```asm
;【本轮复核】disasm.py va 0x004072e4 起
004072ec  mov  eax, dword [edi + 0x48a35c]
004072f2  sar  eax, 0x1f
004072f5  and  eax, 1
004072f8  inc  eax                       ; al = 1(人类) / 2(电脑)
004072f9  mov  byte [esi + 0x496bcc], al ; → player+0x64
004072ff  test al, 1
00407301  je   0x4071d4                  ; ★ 电脑 → trunc(ratio×资金/100)
00407307  mov  eax, [0x49908c]
0040730c  sar  eax, 1
0040730e  mov  [esi + 0x496b84], eax     ; ★ 人类 → 现金 = 初始资金/2
00407314  jmp  0x407210                  ;   存款 = 资金 − 现金
```

`0x4071d4` 才是 `bank.md §5(b)` 抄的那段 `fild ratio / fdiv 100.0f / trunc`。

**原版存档实证【本轮复核】**（`Rich4/SAVE1.DAT`，玩家区 `+0x10`、步长 `0x68`）：

| 槽 | 角色 | `+0x64` | `+0x15` | `cashRatio(+0x19)` | 现金/存款 | 按比例应为 |
|---|---|---|---|---|---|---|
| 0 | 小丹尼 | **1** | 1 | 55 | 150000/150000 | 165000 ✗ |
| 1 | 孫小美 | 2 | 0 | 50 | 150000/150000 | 150000 ✓ |
| 2 | 阿土伯 | 2 | 0 | 40 | 120000/180000 | 120000 ✓ |
| 3 | 金貝貝 | 2 | 0 | 80 | 240000/60000 | 240000 ✓ |

唯一的真人（`+0x64=1`，且 `SAVE1.DAT` 的 `numPlayers=4`）ratio=55 却拿到 50/50；
三个电脑精确等于各自 ratio ⇒ 规则确为「真人 50/50、电脑按 ratio」。

remake `rules/setup.ts:100-106` 的 `startingMoney()` 一律
`Math.trunc(initialFund × initCashRatio / 100)`，`rules/new-game.ts:224` 对每个玩家都调它
⇒ 真人玩家的开局现金/存款都错（默认 30 万下差最大 15%）。
附带：`known-deviations.md:126-147`（F-001）把「小丹尼 55 却是 50:50」解释成
「玩家 0 已行动、存了 15000」，**该解释是错的**（真因就是这条 human/computer 分支）。

#### 2–3. toll 的两个边界（轻微）

`rules/toll.ts:81` `land.rentByLevel[land.level] ?? 0`：原版 `0x419796` 无上界校验，
`level > 5` 会读到 `flast`（`land-rent.md:241,244-246` 记为原版行为、可达性未决）；
remake 用 `?? 0` 兜底 ⇒ 若可达则会少收租。`rules/toll.ts:89` 的 `base * priceIndex`
是 JS 双精度乘法，原版 `0x4197e0 imul` 是 32 位有符号回绕（`land-rent.md:242`）。
两者都需要极大的数值才可观察，故轻微。

#### 4–5. 月度累加器与破产时序（严重 / 轻微）

`bank.md:481-482` 给出 `0x439ec6..0x439ef3` 把每名玩家的 `+0x42`、`+0x5c`、`+0x60`
清 0（A 级）。remake 的月结路径 `state/reduce.ts:3136` 只做
`settleMonthlyBank`，`monthlyPaid/monthlyReceived/totalWinterSleepDays` 全仓唯一写点
是 `payment.ts:227/250/300`、`reduce.ts:4811-4812` 的累加与 `new-game/bankruptcy` 的
初始化 ⇒ **从第二个月起，月结屏的「本月意外之財/損失」与颁奖评分
（`rules/monthly.ts:130-137`、`client/monthly-screen.ts:845-857`）用的是开局至今的累计值**。

再叠加一条时序差异：原版先 `call 0x40cd87`（memset）再 `add [+0x5c]`（`bank.md:§附A`），
remake 先累加再由调用方 memset（`bankruptcy.ts:148`）。

#### 6–9. 贷款四连（都属阻断）

- **额度夹取**：`places/bank.ts:101-102`。原版额度只是「建议默认值」
  （`bank.md:194-197`：`0x48ca98` 的读点只有两处画条代码），玩家可在数字键盘里输入
  任意金额；remake 直接 `Math.min`，玩家拿不到超额资金。
- **额度算错**：`state/reduce.ts:3771` 把 `lands/facilities` 传空、`stocks` 缺省，
  于是「總資產/可貸額度」在柜台里只剩 `现金+存款−贷款`。同文件 `3057`、`panel.ts:124`
  都传了真实资产 ⇒ 同一函数两套口径。AI 的 `autoLoanAmount(p.wealth, …)`
  （`ai/policy.ts:511`）吃的也是这个偏小的 `wealth`。
- **还款日**：`places/bank.ts:96-113` 不写 `loanDueDate`。`types.ts:157-172` 的注释
  完整描述了 `0x433b88` 的 90 天规则，`rules/calendar.ts` 也已备好
  `isHoliday`/`dayNumberSince1998`，但没有任何调用点 ⇒ 贷款永不到期。
- **到期链**：`0x436a5a` 的跳表（`bank.md:649-663`）无对应实现，界面「距還款日%d天」
  也无数据源。

#### 10–11. 手动还款（严重 / 轻微）

`places/bank.ts:133-153`：`repaid = min(amount, loan)`，随后 `bank = moneyInBank - repaid`，
不足则 `cash += bank`。原版 `0x43538c` 在扣款前有 `输入 > cash+deposit ⇒ 报
'很抱歉！您的現金不足。' 且不扣款`（`bank.md:259-266`）。remake 少了这道闸，core 层面
可以把 `cash` 扣成负数（只有 client `bank-dynamic.ts:915-918` 拦）。另外原版把
`loan -= 输入值`（不夹，可为负、且只有恰好 0 才清还款日），remake 夹到 `loan`。

#### 12–13. AI 的借与还（严重 / 阻断）

`ai/policy.ts:506-513` 是 remake 的整个银行 AI：落点、未冻结、`want>0` 就借，`want`
= `min(trunc(wealth×loanRatio/100), loanCapacity)`。原版（`bank.md:298-344`）是：

```
loan != 0 → 只剩 ≤6 天才考虑提前还：2*loan < 存款 就直接还；
            否则要 cash+deposit ≥ loan*1.1 才还（0x4367f6 fmul qword 0x464b24）
loan == 0 → 且 (rand()%10==0 或 cash+deposit < 30000) 且 ratio≠0 且未暫停
            loan = trunc(ratio × 净资产 / 100)   ← ★赋值
```
remake 两条都不同：既没有「概率/贫困」触发条件、也没有 `loan==0` 前置，且用累加。
其中**触发条件的缺失**最可观察：原版 AI 只在 1/10 概率或资金 < 3 万时放款。

> ⚠️ 但**「`+0x18` 是死代码」这一条规格结论是错的**，见 §三·勘误 A，因此
> remake 启用这条分支本身**不算**偏离。

#### 14–16. 特別融資（阻断 / 轻微 / 轻微）

- 週轉現金：`special-finance.ts:164-165` 夹到 `room`；原版 `0x434665` 把
  `其他玩家存款总额 − 我的特别融资` 只当**默认值**，输入多少给多少
  （`bank.md:408-409`，已复核无 `cmp`）。
- 冻结门禁：`special-finance.ts:162-163`。原版 `+0x3c` 只影响**画禁止章**
  （`0x4341e7`/`0x434313` 都是 `cmp [p+0x3c],0` 后调 `0x4562a5` 画章），点击处理函数
  里没有门禁 ⇒ 原版冻结期仍可週轉。
- 歸還款項：`special-finance.ts:184` 夹到已融资金额；原版只校验 `cash+deposit`
  （`bank.md:384-394`）。

#### 17. AI 重分后漏一次银行对账（严重）

`bank.md:566,776` 明列 `arg=1` 的两个调用点：ATM 取款 `0x43784f`、AI 重分 `0x437c14`。
remake 只在取款后调 `settleBankReserve`（`reduce.ts:1380`）；`rebalanceBankOnArrival`
（`3721-3731`）改完现金/存款就直接返回。后果：AI 把存款搬成现金后，「客戶存款總額」
跌破董事長已融資额时不会触发「由經營者墊付」，银行的垫付/破产链少了一条入口。

#### 18. 儲金紅利（严重）

两处错：① `events/news-effects.ts:198` 的 `bankDividend(p)` 没有 `loan != 0 → 0`
（原版 `0x44af3c jne 0x44b004`）；② `785-805` 走 `receiveMoney(...)`，缺省
`toCash=true` ⇒ 进**现金**，而原版 `0x41d3f4` 的 flags=0 ⇒ 进**存款**
（本轮已复核 `0x41d3f4`：`test byte [esp+0x10],1 / je → add [+0x20]`）。
`known-deviations.md:3882-3884` 只记「四条百分比事件已接线」，未记这两处。

#### 19–23. 银行表现层与未决（轻微）

提示文案（`0x464bed`/`0x464bd4`）在 core 无产出、client 也没有；`bank.ts:282` 主动避开
原版 `total=0` 的 INT_MIN 事故（代码注释声称登记在 Q-BANK-3，实际 KD 里没有——见 §三·勘误 F）；
ATM 的「输入即夹取」与 remake 的「执行时夹取」金额一致、仅显示不同；月息的 BigInt 实现与
x87 在极端输入下可能差 1（`monthly.ts:56-58` 自认）；月结只结算存活玩家与规格的玩家列表
口径未明，但破产者存款为 0，无观察差异。

#### 24–25. 柜台买入的两个上限（严重 / 轻微）

`state/reduce.ts:2575` 用 `stock.shares`（`+0x08`）而规格要的是 `stock.f10`（`+0x0a`）：

```asm
;【本轮复核】disasm.py va 0x0042af3a
0042af43  mov  cx, word ptr [eax*4 + 0x49698a]   ; ★ +0x0a
0042af66  fild dword ptr [eax + 0x496b88]        ; 存款
0042af6c  fdiv dword ptr [edx + 0x496994]        ; / 现价
0042af72  call 0x457dbc                          ; 向零截断
0042af7f  cmp  ecx, edi / … min
```
`+0x0a` 的初值只有 `+0x08` 的 10%~30%（`0x42915a`，见 #26），且随买卖滚动 ⇒ 读错字段等于
把可买量放大 3~10 倍。`ai/stock-policy.ts:352` 那条反而用的是 `f10`，同仓库两套口径。
#25 是 `trunc(n×价) ≤ 存款` 与 `n ≤ trunc(存款/价)` 在小数股价下的 1 股差。

#### 26–27. `+0x0a` 的初始化与刷新时机（阻断 / 轻微）

原版建图路径 `0x401ce1 call 0x407ad2`（地产/企业表 + 保留股份）末尾
`0x407dfe call 0x42915a`（【本轮复核】`gen/db.txt:8257`）会初始化 `+0x0a`；
`0x42915a` 另在每玩家回合 `0x41c84f` 内被 `0x41c868` 调用（【本轮复核】
`gen/db.txt:46126` 的函数头 + `0x41c868`；`bank.md:829` 已证 `0x41c84f` 是每玩家回合）。
remake 的 `refreshTradableShares`（`stock-market.ts:495-503`）只在**日推进**里调一次
（`reduce.ts:3094`），新局完全不调，而静态表 `+0x0a` 为 0（`data/src/stocks.ts` 各行
`f10: 0`，`binary-truth.test.ts:223` 与 exe 逐字段比对）⇒ **第一回合 AI 的可买量全 0**
（配合 #24 的柜台路径反而不受影响，这正说明两张表口径不一致是真的）。
`stocks.md:§4.3` 把 `0x42915a` 只标成「开局初始化」、`stocks.md:§7.1` 的日推进序列里
也没有它 —— 规格对**调用点**的记载不完整。

#### 28. 新闻 24/25 缺即时跳价（严重）

`stocks.md:485-488` 明确列出 `0x44b04b`（24 全面上涨）与 `0x44b096`（25 全面下跌）都调
`0x429040`。`events/news-effects.ts:706-712` 只写 `newsFlag` 就返回，`applyStockNews`
在 24/25 两条路径上没有被调（27/28/30-35 与红黑卡都调了）⇒ 「崩盤/气势如虹」当天价格不动、
要等隔日才吃到 ±10%，且不会覆写当日历史格。

#### 29. AI 認購数量（严重）

`ai/policy.ts:548-555` 用 `trunc(cash/2)`；原版 AI 走
`_rich4_calculate_max_purchase_count`（`0x41d839`，【本轮复核】函数体：
`fild [0x49908c] / fmul qword [0x463cd0](0.3) / 0x457dbc / imul [0x4990e8]`，
再从现金里减掉它除以单价、与前置上限取 min）。真人窗口那条 remake 是对的
（`company.ts:175-182` = `0x41d20a` 的 `min(1000, trunc(cash/单价), 企业余量)`）。

> 注：`stocks.md:781` 把真人闸（1000/余量）与 AI 的安全垫写在**同一行公式**里，
> 实际是两支；remake 的真人侧无需改。

#### 30–35. 股市的中小差异（轻微）

- 企业绑定：原版 `0x428cb1` 命中不 break（最后一家赢）、未命中时 `+0x04` 停在 1；
  remake 用 `find`（首个）+ `?? 0`（`stock-market.ts:190-191`）。8 图数据无重复指向，
  但「停在 1」与「置 0」会改变均值回归的锚点分支。
- 定价精度：`stock-market.ts:125` 的 `Math.fround(raw-price)` 与原版
  `0x428ef7 fstp dword [esp+8]` **一致**（本轮复核纠正了「原版 diff 是 double」的直觉）；
  残差只在 `Math.fround(diff % tick)` 与末次加减（原版 `fprem`/`fsubr qword` 留在 x87
  扩展精度）。`stocks.md:392` 警告的「fmod 必须双精度」remake 用 JS double 做 `%`、
  只是把结果 fround，比规格担心的单精度 fmod 更接近原版 ⇒ 定轻微。
- `0.85` 下带（`stock-market.ts:262`）被额外 fround；`+0x08/+0x0a` 无 u16 回绕
  （`stock.ts:157,219`）；卖出进池的责任外移（`stock.ts:211-223` + `reduce.ts:4920`）；
  日推进缺 `0x428475`（`notice-board.ts:40-60` 已论证故意不建模）。

#### 36–39. 四条「规格摘录不足」（无法判定）

`0x44b419`（新闻 31）是否也调 `0x429040`；`0x42923d` 的 jmp 终点（新闻支是否过均值回归）；
`0x429040` 内 `0x429070-0x429080` 是否有 `test dl,dl / je`；`0x41d02b-0x41d064` 的完整体
（`news_dir` 两半字节递减）。四条都需要补全对应函数的完整反汇编才能判定，
remake 目前各有一处实现 + 测试固化，方向上都自洽。

#### 40. 行情不可复现（轻微，已知偏离）

`stocks.md:439-441` 要求「每日 `srand(GetTickCount())` ⇒ 序列不可复现」，
remake 有意改成可注入 PRNG（`rng/watcom.ts` 的 LCG 与 exe 位级一致），
`known-deviations.md:22-79`（D-001）已登记为有意偏离。但 D-001 同时声称单机
reseed 时机「与原版三处 srand 逐点一致」，而 `rng/policy.ts:45` 的
`reseedOn: ['gameStart','afterLoad','turnAdvance']` 在生产代码里**没有调用者**
（`grep needsReseed|policyFor` 仅命中自身与测试）—— 记录与实现不一致。
另外日推进里额外的 `refreshTradableShares`（≤12 次 `rand()`）会让
「一天只消耗 `1+#{未停牌且 news_flag==0}` 次」这条对照断言不成立。

#### 41–42. 两个自创量（轻微）

`stock-market.ts:146,359` 把 `[0x499078]` 建成 `index` 并在读档重算
（`savegame.ts:246-252`）；`ai/stock-policy.ts:123-128` 维护 `holdingsCost`（用
`Math.round`）。两者在 `stocks.md` 里都记为「原版无逻辑读取 / 原版不算盈亏」，
属自造账目，源码注释均已自认，建议在 KD 里补一条汇总。

---

## 三、remake 多出或未见于原版的实现

1. **AI 自动贷款（`loanRatio` = 角色表 f24）—— 复核结论：remake 正确，是规格漏记。**
   `bank.md:438-442` 与 §附D#1 断定 `+0x18`「exe 内无任何写入、新开局为 0、自动放款是死代码」，
   依据是绝对地址 xref 只有 1 条读（`0x4368db`）。**但那句话被 `memcpy` 绕过了**：
   【本轮复核】新局初始化 `sub_00406de7` 在 `0x4072c3 push 0x68` /
   `0x407272 mov ebp,0x496b68`+`add ebp,esi` / `0x4072dd add eax,0x47e80c` /
   `0x4072e4 call 0x456de8`（= memcpy，与 `stocks.md:137` 同一函数）把**整条 0x68 字节
   角色记录**拷进玩家结构，而角色表 `+0x18` 就是 f24（`data/src/binary-truth.test.ts:203`
   逐字节比对 exe 已证）；设置屏的回写（`0x41e259`）只写 `+0x15/16/17/19/1a`，**跳过 +0x18**，
   所以 f24 会一直留着。**存档实证**：`Rich4/SAVE1.DAT` 四人 `+0x18` = 30/50/50/80，
   `Rich4/Save0.dat` = 75/50/80/100，与角色表 f24（小丹尼 30、孫小美 50、阿土伯 50、
   金貝貝 80、莎拉公主 75、錢夫人 100）**逐个精确吻合**。
   ⇒ `ai/personality.ts:170` 的 `loanRatio: c.f24` 与原版一致，#12/#13 才是真差距。
2. **`[0x499080]` 被当成樂透彩池** —— `places/lottery.ts:120,291,324`、
   `state/reduce.ts:3107,3128-3133`、破产清算入池 `reduce.ts:4920`。
   `stocks.md:§4.2/§8#2` 记为「无逻辑读取的消失池、用途未决」，**但同仓库
   `places.md:913` 已给出答案**：它就是 `累積獎金(jackpot)`，买单时
   `0x431711 add [+0x499080],0x3e8`，开奖时 `0x430acd mov edi,[0x499080]` 全额派出、
   `0x430ae0` 清零，UI 串 `0x4645d9`「累積獎金」。⇒ remake 的用法正确，
   `stocks.md` 的「未决」该更新。
3. 可注入、可复现的 PRNG 取代 `srand(GetTickCount())`（`rng/watcom.ts` + `reduce.ts:3041`），
   有意偏离，已登记 D-001。
4. `holdingsCost`（`ai/stock-policy.ts:123-128`，`Math.round`）—— 项目自造账目守恒工具。
5. AI 認購的 `trunc(cash/2)` 保守策略（`ai/policy.ts:548-555`）—— 即 #29，源码自认是策略。
6. 红/黑卡的 `marketClosed`/`noEffect` 护栏（`cards/registry.ts:780-786`）—— 原版卡函数内直调。
7. `stockStatus` 的 `openPrice<=0 → flat` 护栏（`stock-market.ts:533`）。
8. 读档对 `day` 的夹回与 `index` 的重算（`savegame.ts:229-252`）。
9. `[0x499078]` 建成 `index`（#41）与 `companyDividends` 按**企业**而非 12 支股票外循环
   （`company.ts:284-302` + `reduce.ts:3113-3125`；若同图两家企业指向同一支会重复派红）。
10. 破产用命名常量逐字段清代替 `memset(+0x1c,0,0x4c)`（`bankruptcy.ts:111-154`）—— 语义等价。
11. `whoPlays` 掩码写法 `(whoPlays & 0xff) === 1`（`reduce.ts:3727`）等价
    `cmp byte [+0x15],1`；`markPlayerBankrupt` 不清 `cashRatio(+0x19)`，与原版一致 ✓。

### 规格/记录本身的错误（勘误，不计为 remake 差距）

- **A. `+0x18` 无写入者 / 自动放款是死代码**（`bank.md:438-442,1095`）——**错**，
  见 §三·1（memcpy + 存档实证）。
- **B. 开局资金分配「人人按 init_cash_ratio」**（`known-deviations.md:126-147` F-001）——**错**，
  只有电脑按 ratio，真人固定 50/50（见 #1 的 asm + SAVE1 实证）；F-001 对「小丹尼 55 → 50:50」
  的解释（存了 15000）也不成立。
- **C. `stocks.md:§4.3` 的「`0x42915a` 开局初始化」**——不完整，它同时被每个玩家回合的
  `0x41c868` 调用（见 #26/#27），规格的日推进序列（`stocks.md:1183-1198`）也漏列了它。
- **D. `stocks.md:§4.3` 的認購公式**把真人闸（1000/企业余量，`0x41d20a/0x41d216`）与
  电脑安全垫（`0x41d839`）写在同一行 —— 实际是两支（见 #29）。
- **E. `stocks.md:§4.2/§8#2` 说 `[0x499080]` 无逻辑读取** —— 与 `places.md:913,942,1052-1065`
  冲突；后者（累積獎金、开奖读它）才是对的。
- **F. `places/bank.ts:269-276` 注释声称 NaN 事故「已登记在 Q-BANK-3」** ——
  `known-deviations.md:1276-1300` 里没有这段；反过来实现是**主动避开**了原版事故（#20），
  这条有意偏离本身也没登记。同类还有 `state/types.ts:115-118`（说 `cashRatio`「没有任何规则读它、
  本引擎未实现」——与已实现的 `rebalanceCashByRatio` 相反，注释过期）。

---

## 四、无法判定项（列出还需要什么证据才能判定）

> 与 §二 的对应：U1~U7 就是表里类型标为「无法判定」的 7 条（#36~#39、#22、#23、#21）；
> **U8（拍卖）、U9（`who_plays`）没有对应的表格行** —— 它们分别是「规格未覆盖」与
> 「越界但会影响本主题」的两项独立观察。

| # | 议题 | 缺什么证据 |
|---|---|---|
| U1 | 新闻 31（`0x44b419`）是否也调 `0x429040` 即时跳价 | `0x44b3a0–0x44b470` 的完整反汇编，确认 31 是否汇入 `0x44b409` 那个共用尾段 |
| U2 | 新闻强制方向支（`0x429229..0x42923d`）是否经过均值回归 | `0x42923d` 之后的 jmp 目标（是否汇入 `0x4292b7`） |
| U3 | `0x429040` 是否跳过 `newsFlag==0` 的股票 | `0x429040` 完整体（`0x429070–0x429080` 被规格摘录省略的指令） |
| U4 | `news_dir`（`+0x07`）两个半字节是否各自递减 | `0x41d02b–0x41d064` 完整体（规格摘录里 `dec dh` 的源寄存器与 `sub ch,0x10` 的源字段自相矛盾） |
| U5 | 月息 BigInt 精确解 vs x87 80 位中间积 | 需要一个覆盖「乘积极度接近整数」的差分用例（本仓 `monthly.test.ts` 只测到 20 亿） |
| U6 | 月结的玩家集合（`0x48c418`/`0x48c420` 的填充规则，是否含出局者） | `0x439bfa` 里填表的汇编（remake 用 `isAlive`，破产者存款为 0，预计无观察差异） |
| U7 | ATM「输入即夹取」的可见行为（`0x4378d9` 改写输入串）与 remake「执行时夹取」的差异 | 原版实机截图/录像（金额一致，只有提示与输入框内容不同） |
| U8 | **拍卖流程整体**（起拍价、心理价位、档宽、终局判据、成交后的产权转移） | 四份规格**未覆盖**拍卖（`bank.md`/`stocks.md` 只提 `0x43be74` 等常量）。`rules/auction.ts:82-124` 的公式由 remake 自己的注释给出（`0x43be74`、`0x43bfb8`、`0x439f0d`），需一份独立的拍卖规格才能逐条核 |
| U9 | `who_plays`（`+0x15`）语义与 `isAlive`（**越界观察，但影响本主题**） | 【本轮复核】原版 `SAVE1.DAT` 的三名电脑玩家 `+0x15 = 0`、`+0x64 = 2`（真人是 `1`/`1`）。remake 把 `+0x15` 当 whoPlays 且 `WHO_PLAYS_DEAD = 0`（`state/types.ts:32`、`loaders/save.ts:490`）⇒ 读原版存档时电脑会被判为出局；而 `stocks.md:§2.6`（物价指数的「在场人数」）与 `§6.4`（分红只发在场玩家）都依赖这个谓词。需 `who_plays`/`+0x64` 的专门规格或原版回合循环里对 `+0x15` 的写入链 |

---

## 五、建议的修复顺序

按「玩家能当场算出差额」→「影响 AI 经济」→「表现层」排序：

1. **#1 开局现金分配**（阻断，一行分支：真人走 `初始资金/2`）。同时修正
   `known-deviations.md` F-001。
2. **#7 + #6 银行额度**（阻断）：`reduce.ts:3771` 改传真 `lands/facilities/stocks`；
   去掉 `bank.ts:101-102` 的夹取，把「超额度」的判定留给输入层（原版本就不判）。
3. **#8 + #9 贷款期限链**（阻断）：`borrow()` 后按 `0x433b7e` 写 `loanDueDate`
   （`+90` 天 + `isHoliday` 顺延），再补 `0x436a5a` 的每回合到期检查与 `0x433bd8` 强执。
4. **#13 + #12 AI 借还**（阻断/严重）：补 `loan==0` 前置、`rand()%10`/资金 < 3 万的触发、
   赋值语义；再补 `0x4367ab` 的提前还款分支。
5. **#18 儲金紅利**（严重）：加 `loan≠0` 闸 + 改 `receiveMoney(..., false)`。
6. **#24 + #26 + #27 股市可买量**（严重/阻断）：柜台改用 `f10`，
   新局补 `refreshTradableShares`，并按原版把刷新点放回每玩家回合。
7. **#28 新闻 24/25 跳价**（严重）：写完 `newsFlag` 后补调 `applyStockNews(market, 0)`。
8. **#14 + #16 特別融資**（阻断/轻微）：去掉週轉的夹取；歸還只校验 `cash+deposit`。
9. **#17 银行对账**（严重）：`rebalanceBankOnArrival` 之后补 `settleBankReserve`。
10. **#4 月度累加器清零**（严重）：月结里把 `+0x42`/`monthlyPaid`/`monthlyReceived` 清 0，
    并把累加时序对齐 `0x41d381`。
11. **#10 + #11 手动还款**（严重/轻微）：补 `输入 > cash+deposit` 的拒绝分支；
    是否照抄「可把 loan 还成负数」建议在 KD 里显式表态。
12. **#29 AI 認購**（严重）：实现 `0x41d839` 的安全垫公式。
13. **#2/#3/#5/#19/#20/#21/#22/#23/#25/#30~#35/#40~#42**（轻微）：按表逐条收口，
    并同步更新 `known-deviations.md`（尤其：登记 `+0x18` 的真相、`[0x499080]` 是彩池、
    ATM `total<=0` 的有意偏离、rng reseed 未接线）。
14. **U8 拍卖 / U9 `who_plays`**：先立规格，再谈实现。

---

### 附：本次核对通过（1:1）的主要条目

| 条目 | 原版证据 | remake 证据 |
|---|---|---|
| `calculate_land_toll` 两互斥分支（住宅同名累加租金表 / 商業用地固定 2000×块数） | `land-rent.md:137-207`（`0x41974e/0x4197a5`） | `rules/toll.ts:75-86`；`test_toll.py` 用例语义一致 |
| 租金表 `+0x20` 6×u16、步长 `0x34`、下标 1 基、`owner` 1 基 | `land-rent.md:7-27,60-73` | `loaders/map.ts:17,502,533-552`（`id=i`，数组无 0 号槽）、`economy.md` 三表基准确认 |
| 同盟分账 = `trunc(实付总额 × (同盟份/总额)单精度)`，先地主后同盟 | `0x419cb6`/`0x419f76`/`0x419f84`（`cards.md`/`Q-NUM-1.md`） | `rules/rent.ts:68-79,154-174` |
| 涨价位 `!=0` ⇒ **地主份** ×2（同盟份不翻） | `0x419b09 add ebp,ebp`（`cards.md:3459`）【本轮复核】 | `rules/rent.ts:131-138` |
| 总资产 = 现金+存款−贷款 + Σ逐支截断(持股×现价) + 住宅三支 + 商業 `level×[+0x24]+[+0x22]`；`special_finance` 不计入 | `economy.md:20-28`、`0x4239b9` 全文 | `rules/wealth.ts:57-87`（唯一残差 #2） |
| 物价指数 = `max(旧, trunc(trunc(Σ在场资产/人数)/开局资金))`，两次 `idiv` 向零、只升不降 | `0x423acf-0x423b1b`、`stocks.md:513` | `rules/wealth.ts:130-150`、`reduce.ts:3086-3091` |
| 存/取款无手续费、夹到上限、0 = 不做 | `bank.md:120-131` | `places/bank.ts:27-47` |
| 取款后调银行对账、存款后不调 | `0x43784d push 1` vs `0x437870` | `reduce.ts:1380` vs `1342` |
| 贷款进**存款**、额度默认 = wealth−loan | `0x435260`、`0x43523e` | `places/bank.ts:108`、`reduce.ts:3775` |
| 还款先存款后现金、归零清还款日 | `0x4353a3..0x4353d6` | `places/bank.ts:137-151` |
| 月息只有存款、仅 `loan==0`、`trunc(×1.1)`、跨月一次 | `bank.md:489-508` | `rules/monthly.ts:60-70`、`reduce.ts:3136` |
| 贷款无利息 | `bank.md:523-530` | 全仓无按比例增大 loan 的写入 |
| 破产：付钱时两口袋都空 → memset `+0x1c..0x67`、出局、释放地产 | `bank.md:601-625` | `rules/payment.ts:149-172`、`bankruptcy.ts:111-154,234-259` |
| 特別融資額度 = 除自己外所有人的存款和；`+0x28` 不进 `loan` | `0x434593`、`0x434665` | `places/special-finance.ts:132-138,167-171` |
| `days_rejected_by_bank` +30（可叠加）/ `bank_suspend_lending` 全体=15；递减粒度 = 每玩家回合 −1、到 0 挂 `0x80` | `bank.md:812-849,901-914` | `events/fortune-effects.ts:480`、`news-effects.ts:664`、`rules/blocking.ts:159-188`（`reduce.ts:1633-1641` 在回合边界 `endTurn`） |
| 股市:无手续费无交易税；买卖 flag 语义；清仓清均价；`avg_cost` 是单精度 | `stocks.md:762-773,844-901` | `places/stock.ts:24-29,115-125,148-223`（无费率代码） |
| 每日行情：休市整天不跳价、开盘=昨收、动能累加、±10% 限幅、144 槽环形、逐项单精度累加 | `stocks.md:224-346` | `places/stock-market.ts:308-362`（残差 #31/#32） |
| 涨跌停价本身经 `apply_price_change` 量化、含等号 | `stocks.md:550-561` | `places/stock-market.ts:528-548` |
| 休市 = 计数非 0 或 `is_holiday`（**先判星期日**再查节日表）；新闻 26 实际关 11 天 | `stocks.md:563-630` | `places/calendar.ts:344-355`、`stock-market.ts:470-475` |
| 分红只发在场玩家、保留股份不参与、全体持股 0 时不清零、进存款 | `stocks.md:1113-1118` | `places/company.ts:278-302,326` |
| 控股 `owner = rank[0]`，**买入与卖出都重排** | `0x4294d5`、`0x428e14`、`0x428eb7` | `places/commercial.ts:78-122`、`reduce.ts:2580,2598` |
| 总资产不含企业资产额 | `stocks.md:949-951` | `rules/wealth.ts:51-88` |
