# Q-NUM-1 —— 原版 x87 取整 `__round_toward_zero`（VA 0x00457dbc）订正

> 本轮主题：上一轮报备的「`percentage.ts` / `rent.ts` 把 `x87Round` 当成就近取偶，
> 与 `0x457dbc` 的真实语义不符，所得税/租金在**恰好 .5** 时差 1」。
> 结论：**报备成立**，且波及面比报告里写的更大。已按 exe 取证订正一批、
> 另有一批**取证清楚但不属于取整范围**的（顺序 / 阈值 / 精度）如实登记在本文件。

---

## 0. 判据：0x457dbc 到底是哪种取整

```asm
; @source VA 0x00457dbc  （rich4-re/asm/rich4_misc_util.asm 的 __round_toward_zero）
00457dbc  push     eax
00457dbd  wait
00457dbe  fnstcw   word ptr [esp]        ; 取当前 x87 控制字（CW）
00457dc1  wait
00457dc2  push     dword ptr [esp]
00457dc5  mov      byte ptr [esp + 1], 0x1f   ; ★ 只改 CW 的**高字节**
00457dca  fldcw    word ptr [esp]        ; CW = 0x1f7f
00457dcd  frndint                        ; 按 RC 取整
00457dcf  fldcw    word ptr [esp + 4]    ; 还原原 CW
00457dd3  wait
00457dd4  lea      esp, [esp + 8]
00457dd8  ret
```

x87 控制字 bit10-11 = RC：

| RC | 语义 |
|---|---|
| `00` | 就近取偶（IEEE 默认；进程初值 CW = `0x037f`） |
| `01` | 向下（−∞） |
| `10` | 向上（+∞） |
| `11` | **向零** |

`0x1f7f` 的 bit10-11 = `11` ⇒ **`frndint` 向零截断**；bit8-9（PC）= `11` = 扩展精度
（与默认一致，没被动过）。

**所以：`1.5 → 1`、`2.5 → 2`、`7.5 → 7`、`−2.5 → −2`。**
对非负数等价于 `Math.trunc` / `Math.floor`；对负数只有 `Math.trunc` 对。

> ⚠️ 顺带订正两处旧注解：
> ① `auction.ts` 曾写「CW = 0x0033」—— 实际是 `0x1f7f`（0x1f 是高字节）；
> ② `npc-actions.ts` 的強盜搶銀行曾写「银行家舍入由 Watcom `__CHP` 做」——
> 该处就是 `call 0x457dbc`，与就近取偶/`__CHP` 无关。
> 两处结论（向零）都相同，只是理由写错了，已改。

`frndint` 之后紧跟的 `fistp dword [..]` 用的是**已还原**的 CW（就近取偶），
但 st(0) 此刻已是整数，`fistp` 精确，**不会**引入第二次取整。

**全项目唯一实现**：`packages/core/src/rules/rounding.ts` 的 `truncTowardZero()`。
`rules/auction.ts` 只做转出（`export { truncTowardZero } from './rounding.ts'`），
不再自留一份；`percentage.ts` 的 `x87Round()`（就近取偶）**已删除**。

---

## 1. 全部 89 个 `call 0x457dbc` 调用点

`python3 tools/disasm.py callers 0x457dbc` = **89 处**（下表逐一列出）。
★ 注意 `callers` 只找 `call`；新聞模組 0x0044a448 是 **`jmp 0x44970e`** 进同一段
公共尾巴的，故「用到该 helper 的地方 ≥ 89」。

**所有 89 处都调同一个函数 ⇒ 取整方式一律是「向零截断」**；
下面逐条列的是「这一处在算什么」，以及本仓库里对应/不对应的实现。

### 1.1 与本仓库 core 规则直接对应（本轮的落码对象）

| VA | 算什么 | 本仓库 | 处置 |
|---|---|---|---|
| `0x00449cfa` | **所得稅** = `trunc(现金(+0x1c) × 0.05)` | `rules/percentage.ts` `incomeTax` | ✅ 改（原来就近取偶） |
| `0x00449f28` | **地價稅** = `trunc(地产原值 × 0.05)` **再** `×物价指数` | `rules/percentage.ts` `propertyTax` | ✅ 取整与**顺序**都改了（D-QNUM-2 已结案）|
| `0x0044a122` | **證交稅** = `trunc(持股市值 × 0.05)` **再** `×物价指数` | `rules/percentage.ts` `stockTax` | ✅ 取整与顺序都改了（`stockTax` 收了 `priceIndex`，D-QNUM-2 已结案）；精度见 D-QNUM-3 |
| `0x0044af50` | **儲金紅利** = `trunc(存款(+0x20) × 0.1)` | `rules/percentage.ts` `bankDividend` | ✅ 改 |
| `0x00419f84` | **过路费同盟分账** = `trunc(实付总额 × (同盟份/总额)单精度)` | `rules/rent.ts` `allianceShareOf` | ✅ 改（原来 `Math.round`） |
| `0x0041c383` | **強盜搶銀行** = `trunc(存款 × 0.2)` | `rules/npc-actions.ts` `bankRobbery` | ✅ 改（原来 `Math.round`） |
| `0x0042bc9a` | **企業月中紅利** = `trunc(累積盈餘(+0x28) × (持股/总持股)单精度)` | `places/company.ts` `companyDividends` | ✅ 改 |
| `0x00425f2c` | **股票挂牌市價** = `trunc(股數 × 現價)` | `places/notice-board.ts` `stockListPrice` | ✅ 改 |
| `0x00428b77` | **挂牌股票单价判据** = `trunc(挂牌总价 / 股数)` | `places/notice-board.ts` `aiWantsListedStock` | ✅ 改 |
| `0x0042bff1` | **持仓市值** = 逐支 `trunc(累计 + 持股 × 股价)` | `ai/stock-policy.ts` `holdingsValue` | ✅ 改 |
| `0x0042c6ef` | **买股股数** = `trunc(可投 / 現價)` | `ai/stock-policy.ts` `decideStockTrade` | ✅ 改 |
| `0x0042ce42` `0x0042ceaf` `0x0042cf19` | **賣出打分**三段 `trunc(x+1)` | `ai/stock-policy.ts` `saleScoreRound` | ✅ 改（原 `roundHalf`）；阈值另有 D-QNUM-5 |
| `0x004200a0` | **AI 用卡的持仓市值** = `trunc(持股 × 均价)` | `ai/card-policy.ts` `holdingValue` | ✅ 改 |
| `0x00439ff7` `0x0043a032` `0x0043a0dd` `0x0043a118` | **拍賣 AI 心理价位** `v1`/`v2`（地块/設施两支） | `rules/auction.ts` `auctionAiLimit` | ✅ 本来就对（上一轮已订正） |
| `0x0043be74` `0x0043bfb8` | **拍賣起拍价** = `trunc(地价 × (1 + 等级×0.5))` | `rules/auction.ts` `auctionBasePrice` | ✅ 本来就对 |
| `0x0041d7e6` | **电脑买地保留额** = `trunc(开局资金 × 0.05)` | `rules/purchase.ts` `aiShouldPurchase`（用 `Math.trunc`） | ✅ 本来就对 |
| `0x0041d84c` | 另一支同类保留额（`initialFund × [0x463cd0]`，随后 `×物价`） | **未实现**（该分支本仓库没有） | ➖ 不涉 |
| `0x004452dd` `0x0044538c` | **查税卡** = `trunc(现金 × 0.2)`（随后 `idiv 100` 算敌意） | `cards/tax.ts`（用 `Math.trunc`，注释已引 `__round_toward_zero`） | ✅ 本来就对 |

### 1.2 新聞模組 `rich4_news.asm` 里的取整（地價/房价涨跌）

| VA | 算什么 |
|---|---|
| `0x00449668` | 住宅地价 `+0x1c` × **1.3**（`fmul [0x4654dc]`）→ 截断 → 写回 |
| `0x0044970e` | 設施地价 `+0x22` × **1.3**（公共尾巴；`0x0044a448` 也 `jmp` 到这里） |
| `0x0044a3a8` | 住宅地价 `+0x1c` × **0.7**（`fmul [0x46561c]`）→ 截断 → 写回 |
| （`0x0044a448`）| 設施地价 `+0x22` × **0.7**，然后 `jmp 0x44970e`（不是 `call`，故不在 89 里） |

这些是「地價上漲／下跌」新聞。本仓库的新聞效果层
（`events/news-effects.ts`）**尚未实现地价涨跌类事件**（文件里已注明
11/12/13/23 这类百分比事件未实现），故本轮无对应实现可改；将来实现时
**必须用 `truncTowardZero`**，且注意它是「截断后写回 `word`（16 位）」。

### 1.3 其余调用点（与 core 规则无关，但同样都是向零截断）

按模块归类（同一函数内多处调用的合并列出）：

| VA | 模块 / 大致用途 |
|---|---|
| `0x004071f2` `0x00407473` | `rich4_new_game.asm` —— 开局初始化（道具余量/地图数值） |
| `0x00408cec` `0x00408cfb` | `rich4.asm` fcn_0040829d —— `fld [ebp+0x496d10/14]`，全局浮点（相机/缩放一类） |
| `0x0040b589` `0x0040b624` `0x0040b638` `0x0040b64d` `0x0040b661` `0x0040b762` `0x0040b7fd` `0x0040b811` `0x0040b826` `0x0040b83a` | `rich4.asm` fcn_0040b4f8 —— 4 个 `fld [esp+0x20..0x2c]` + 两处 `fld1/faddp`，地图/坐标取整 |
| `0x0040c308` `0x0040c37d` `0x0040c397` `0x0040c654` `0x0040c6a8` `0x0040c6c2` | `rich4.asm` fcn_0040c05c —— 同上（`+0x498ea8` 全局坐标） |
| `0x0040e74f` `0x0040e820` `0x0040e82d` | `rich4_animate_object.asm` —— 行走补间的坐标 |
| `0x0041248e` `0x004132ed` `0x00413306` | `rich4_small_games.asm` —— 小游戏 |
| `0x004164e7` `0x00416523` | `rich4.asm` —— `fadd [esp+0xa4]` 累加（版式/坐标） |
| `0x00423438` `0x00423953` `0x00423a12` | 财富/资产表相关（`fmul [..+0x496994]` = 股价） |
| `0x00425688` `0x00425a94` `0x0042737b` | `rich4_ui_sale.asm` —— 公佈欄/买卖屏的股价计算 |
| `0x00428d5c` `0x00428dda` `0x00428e75` `0x004291bc` `0x004294c2` | `rich4_stocks.asm` —— 开盘/买卖股票的股价与股数 |
| `0x0042a4df` `0x0042a4fe` `0x0042a860` `0x0042a886` `0x0042a91b` `0x0042a982` `0x0042af72` | `rich4_ui_stock.asm` —— 行情屏（涨跌、股数） |
| `0x0042d191` `0x0042d1f7` | `rich4_shop.asm` —— 商店屏 |
| `0x00436d69` | `rich4_magic_house.asm` —— 魔法屋某支 |
| `0x00437bdf` | `rich4_ui_bank.asm` —— 銀行 ATM（金额显示） |
| `0x0043820d` | `rich4.asm` fcn_00437e61 |
| `0x00439e1c` | `rich4.asm` —— 拍賣入口一带的版式 |
| `0x0044c38b` `0x0044c8df` | `rich4_fortune.asm` —— 命運事件（金额按 factor/物价） |
| `0x004529c8` `0x00453484` | `rich4.asm` —— 字符串/版式一类 |
| `0x0045487e` `0x004548a3` `0x004548c8` | `rich4_media_music.asm` —— `fmul [0x466458/60/68]`，音量/混音比例 |

> 说明：1.3 这些**没有**逐个反汇编归因到「具体是哪条规则」——它们不参与
> core 的任何金额/规则计算（多为坐标、坡度、音量、行情显示）。此处如实标注
> 「类别已定、细节未逐一归属」，不当成已解。若日后再有「某数值差 1」的
> 症状落在这些模块，按本文件的判据按 `truncTowardZero` 处理即可。

---

## 2. 本轮的落码

| 文件 | 改动 |
|---|---|
| `rules/rounding.ts` | **新增**：唯一的 `truncTowardZero()`（= 原版 `__round_toward_zero`），带完整反汇编判据 |
| `rules/auction.ts` | 删掉本地那份实现，改为从 `rounding.ts` 转出；订正「CW = 0x0033」为 `0x1f7f` |
| `rules/percentage.ts` | 删掉 `x87Round()`（就近取偶），`percentageOf = truncTowardZero(base × rate)`；注释与 `@source` 全部改成 0x457dbc 的精确 VA |
| `rules/rent.ts` | `allianceShareOf`：`Math.round` → `truncTowardZero` |
| `rules/npc-actions.ts` | `bankRobbery`：`Math.round` → `truncTowardZero`，删掉「`__CHP` 就近」的错注释 |
| `places/company.ts` | `companyDividends`：`Math.round` → `truncTowardZero` |
| `places/notice-board.ts` | `stockListPrice` / `aiWantsListedStock`：`Math.round` → `truncTowardZero` |
| `ai/stock-policy.ts` | `holdingsValue` / 买股股数 `/ roundHalf→saleScoreRound`：改向零截断；`holdingsCost` 有意保留 `Math.round`（见 D-QNUM-4） |
| `ai/card-policy.ts` | `holdingValue`：`Math.round` → `truncTowardZero` |
| `eslint.config.js` | C-DET-3 的裸除法白名单加上 `truncTowardZero(...)`（它语义就是 `Math.trunc`，是合格的「显式取整」写法；`Math.*` 那几种不受影响） |
| 测试 | `rules/rounding.test.ts`（新）、`percentage` / `rent` / `auction` / `npc-actions` / `company` / `notice-board-market` / `stock-policy` 的 `.test.ts` 补「恰好 .5」「负数方向」「与 `truncTowardZero` 一致」用例 |

**没有无脑全改**：`Math.round` 里凡是没有 exe 判据的（`ai/stock-policy.ts` 的
`holdingsCost`、`state/reduce.ts` 的 `directionOf` 八分圆量化）都**原样保留**并在
注释/本文件里写明理由。`state/reduce.ts` 的 `directionOf`（`Math.round(圈数×8)`）
对应的原版是 `atan2` 之后的方向量化，**没有** `call 0x457dbc`，故不属本轮范围。

---

## 3. 登记（取证清楚，但**不属取整范围**，本轮未改）

### D-QNUM-1 —— 已修：x87 取整误读为就近取偶
见上。本轮的全部改动都在此名下。

### ✅ D-QNUM-2 —— **已改（2026-09-16）**：`地價稅` / `證交稅` 的物价指数乘在截断**前**还是**后**

原版（`rich4_news.asm` 0x00449f1b 起、0x0044a115 起）：

```asm
00449f1b  fild  dword [esp + ebx + 0x94]   ; ★ 地产**原值**：Σ(地价 + 房价×等级)，**不含**物价指数
00449f22  fmul  qword [0x4655cc]           ; × 0.05
00449f28  call  0x457dbc                   ; 向零截断
00449f2d  fistp dword [esp + 0xa4]
00449f3b  mov   ebp, [0x4990e8]            ; 物价指数
00449f41  imul  eax, ebp                   ; ★ 截断**之后**才乘物价指数
00449f4b  mov   [ebx + 0x48c59c], eax      ; 该玩家的税额
```

即 **`trunc(原值 × 0.05) × 物价指数`**；本仓库现在是
`trunc(原值 × 物价指数 × 0.05)`（`propertyValue` 把物价指数乘在基数里）。
物价指数 ≠ 1 时两者会给不同的税：

> 原值 30、物价指数 3 ⇒ 原版 `trunc(1.5)×3 = 3`；本仓库 `trunc(4.5) = 4`。

`0x0044a122`（證交稅）同形：`trunc(市值 × 0.05)` 之后才 `imul eax, [0x4990e8]`。

✅ **已结案 —— 完整取证、判决与落码见 §5.1**（本节保留当时的判决与建议原文）。

### D-QNUM-3 —— **未改**：持股市值是**单精度**累加

原版 0x0044a0e5 那一段是 `fild 持股 / fmul dword [股价] / fadd dword [esp+…] /
fstp dword [esp+…]` —— 逐支用**float32**累加；本仓库 `stockValue()` 用 JS 双精度
整数乘加。股价为常规整数时结果一致，行情带小数时可能差到最低位。
属精度建模问题，不在取整范围，先登记。

### D-QNUM-4 —— **有意保留**：`ai/stock-policy.ts` 的 `holdingsCost` 用 `Math.round`

`holdingsCost`（Σ 股数 × 均价）是**本引擎自造**的账目守恒工具
（`state/soak.test.ts` 的「关掉月息后总额只减不增」用它），**原版没有**
「持仓成本」这个概念，也就没有对应的 `call 0x457dbc`。故保留 `Math.round`，
不为了「统一」而乱改（C-FID-1：不许改良）。

### ✅ D-QNUM-5 —— **已改（2026-09-16）**：賣出打分的 `gainFloor` 读错常量（−2.0 应为 +2.0）

`ai/stock-policy.ts` 的 `SELL_RATIO.gainFloor = -2.0`、判据
`if (gain >= SELL_RATIO.gainFloor) score += …`；但 exe：

```asm
0042ce19  fld      dword [esp + 0xe4]        ; gain = 現價/成本
0042ce20  fcomp    dword [0x4641f4]          ; ★ 0x4641f4 = f32 **+2.0**
0042ce29  jb       0x42ce5c                  ; gain < 2.0 → 跳过
0042ce32  fadd     dword [0x4641f8]          ; ★ 0x4641f8 = f32 −2.0（这是**偏移量**）
0042ce38  fdiv     qword [0x4641fc]          ; / 0.5
0042ce3e  fld1 / 0042ce40 faddp st(1)
0042ce42  call     0x457dbc                  ; 向零截断
```

`0x4641f0` 起 4 个 dword = `f32 1.9 / f32 2.0 / f32 −2.0 / 0` ——
**判据阈值是 +2.0**，`−2.0` 是紧接着 `fadd` 的偏移量。旧代码把这两个弄反了，
于是 `gain ∈ [−2, 2)` 时本该「不加分」却加了 `trunc(2·gain − 3)`（负数）。

这是**常量读错**、不是取整问题，且会明显改变 AI 的卖出行为。

✅ **已结案 —— 完整取证、常量 dump 与落码见 §5.2**（本节保留当时的判决与建议原文）。

### D-QNUM-6 —— **未解**：1.3 表里那些调用点的逐条归属

见上。已定「模块 + 类别」，未逐条反汇编到「具体哪条规则」。
它们不参与 core 的金额计算，暂不影响规则保真。

---

## 4. 测试

- `rules/rounding.test.ts`（新）：`.5` 各符号、负数方向（≠ `floor`）、
  与「旧误读（就近取偶）」的分叉点表、以及和各规则模块结果的一致性。
- `rules/percentage.test.ts`：所得税 `cash = 20k+10`（150 → 7.5 → **7**，原来 8）；
  红利 `存款 = 10k+5`；地價稅 原值 30 → 1（原来 2）；證交稅 市值 30 → 1；
  逐点与 `truncTowardZero` 对照（含负数）。
- `rules/rent.test.ts`：`allianceShareOf(1,1,1)` = 0（`Math.round` 会给 1）、
  `(1,1,3)` = 1、`(1,1,5)` = 2，并与 `truncTowardZero` 对照。
- `rules/npc-actions.test.ts`：強盜正数存款与 `truncTowardZero` 逐点一致；
  **负数**存款 −13 → −2（`Math.round` 给 −3）。
- `places/company.test.ts`：盈餘 1 对半 = 0.5 → 0；3 → 1；5 → 2。
- `places/notice-board-market.test.ts`：`stockListPrice(3, 10.5)` = 31（原来 32）；
  `aiWantsListedStock(5, 2, 3)` = true（`Math.round` 会因 3.5→…→3 判 false）。
- `ai/stock-policy.test.ts`：`holdingsValue` 1×2.5 = 2、3×2.5 = 7（原来 3 / 8）。

---

## 5. 后续轮次追加：D-QNUM-2 与 D-QNUM-5 **已结案**（本轮落码）

> 本节**追加**，不改上面的段落；上面第 3 节里 D-QNUM-2 / D-QNUM-5 的
> 「未改」状态以本节为准。落码者：本轮规则 bug 修复轮。

### 5.1 D-QNUM-2 —— 已修：物价指数乘在截断**之后**

**复取证**（`python3 tools/disasm.py va 0x00449f1b` / `va 0x0044a115`）：

```asm
; 地價稅
00449f1b  fild  dword [esp + ebx + 0x94]   ; ★ fild 读的是**原值**（不含物价指数）
00449f22  fmul  qword [0x4655cc]           ; × 0.05（f64，见 5.3）
00449f28  call  0x457dbc                   ; 向零截断
00449f2d  fistp dword [esp + 0xa4]         ; ★ 先写回整数
00449f34  mov   eax, [esp + 0xa4]
00449f3b  mov   ebp, [0x4990e8]            ; 物价指数
00449f41  imul  eax, ebp                   ; ★ 截断**之后**才乘
00449f4b  mov   [ebx + 0x48c59c], eax
; 證交稅（同形）
0044a115  fld   dword [esp + esi + 0x94]
0044a11c  fmul  qword [0x4655f4]           ; × 0.05
0044a122  call  0x457dbc                   ; 向零截断
0044a127  fistp dword [esp + 0xa4]
0044a135  mov   edx, [0x4990e8]
0044a13b  imul  eax, edx                   ; ★ 截断之后才乘
```

判决：**`trunc(基数 × 0.05) × 物价指数`**。旧实现把物价指数乘进基数
（`trunc(基数 × 指数 × 0.05)`），指数 ≠ 1 且有截断损失时分叉：
原值 30、指数 3 ⇒ 原版 `trunc(1.5)×3 = 3`，旧式 `trunc(4.5) = 4`。

**落码**：
- `rules/percentage.ts::propertyValue(playerIndex, lands, facilities)` ——
  **语义变更**：删掉 `priceIndex` 入参，返回**原值**（与原版 `fild` 读到的
  同一个累加和）；旧签名 `propertyValue(…, priceIndex)` 的末行 `sum * priceIndex` 删除。
- `propertyTax(playerIndex, lands, facilities, priceIndex)`
  = `percentageOf(propertyValue(…), 0.05) * priceIndex`。
- `stockTax(holdings, prices, priceIndex)` —— **加 `priceIndex` 入参**，
  = `percentageOf(stockValue(…), 0.05) * priceIndex`（旧签名没有它，等于按指数 1 算）。
- 调用点普查：`propertyValue` / `stockTax` / `stockValue` 在整个仓库
  （`packages/*/src`）**只有 `rules/percentage.ts` + 自己的 `percentage.test.ts` 用到**，
  `src/index.ts` 只是 `export *`；`events/news-effects.ts` 里 11/12/13/23 仍是
  `unimplemented`（`entry.factor === null` 分支），没有生产调用点需要跟着改。
  `0x4990e8` 对应的状态字段是 `GameState.priceIndex`。

**顺手核的「别的税/费」**（同一「先取整再乘指数 / 先乘再取整」问题）：

| 项 | VA | 结论 |
|---|---|---|
| 所得稅 | `0x00449cee..0x00449d12` | `fild [player+0x1c] / fmul 0.05 / call 0x457dbc / fistp`，**通篇没有 `[0x4990e8]`** ⇒ 不乘物价指数（本仓库 `incomeTax` 一致，无顺序问题） |
| 儲金紅利 | `0x0044af44..0x0044af5c` | 同上，`fild [player+0x20] / fmul 0.1 / call 0x457dbc`，**无指数** ⇒ `bankDividend` 一致 |
| 企業費（水費/電費/旅遊費/保險費/修車費/加油費/工程費/幫主費） | `0x0041ab6d` 起，见 `places/company.ts::companyFeeOnLanding` | 全是整数 `imul`，**中间不取整**，指数与其它因子同处一个乘积 ⇒ 不存在顺序分叉 |
| 拍賣起拍价 | `0x0043be74`（`rules/auction.ts::auctionBasePrice`） | **已经是** `trunc(地价 × 系数) × 物价指数`（上一轮已订正），与本轮同序 |

结论：同一族问题**只有地價稅与證交稅**两处，已全部订正。

**测试**（`rules/percentage.test.ts`，改了 2 条既有期望，逐条理由见文件内注释）：
- 旧 `propertyValue(0, lands, facs, 3) === 18_000` —— 旧期望建立在「基数含指数」
  的错读上。原版 `fild` 读到的原值是 6000，指数只在 `imul` 那一步出现；
  新断言改为 `propertyValue(...) === 6000` + `propertyTax(..., 3) === 900`。
  （这组数恰好无截断损失，新旧同值；真正的分叉点在下面。）
- 新增「指数 ≠ 1」：地價稅 原值 30、指数 3 → **3**（≠ 旧式 4）；
  證交稅 市值 30、指数 3 → **3**；並补「恰好 .5 又被指数放大」的边界
  （原值 10 → `trunc(0.5)=0` → ×5 = **0**，旧式 2；市值 10、指数 7 → **0**，旧式 3）。
- `stockTax` 全部调用点补上第三参 `priceIndex`（既有 `stockTax([3],[10])` 等
  改为 `stockTax([3],[10],1)`，指数 1 时数值不变，故这些期望本身没动）。

### 5.2 D-QNUM-5 —— 已修：`gainFloor` 是 **+2.0**，`−2.0` 是偏移量

**复取证**（`python3 tools/disasm.py va 0x0042ce19`）：

```asm
0042ce19  fld      dword [esp + 0xe4]        ; gain = 現價/成本（0x42cbc1 fld/fdiv/fstp 算出）
0042ce20  fcomp    dword [0x4641f4]          ; ★ 0x4641f4 = f32 +2.0
0042ce26  fnstsw   ax / sahf
0042ce29  jb       0x42ce5c                  ; ★ gain < 2.0 → 跳过整段
0042ce2b  fld      dword [esp + 0xe4]
0042ce32  fadd     dword [0x4641f8]          ; ★ 0x4641f8 = f32 −2.0（**偏移量**）
0042ce38  fdiv     qword [0x4641fc]          ; 0x4641fc = f64 0.5（步长）
0042ce3e  fld1 / 0042ce40 faddp st(1)        ; +1
0042ce42  call     0x457dbc                  ; 向零截断
0042ce47  fistp    dword [esp + 0xf4]
0042ce55  add      dword [esp + ebx*4 + 0x80], eax
```

常量逐一 dump（`read exe` 直读）：

| VA | 字节 | 值 |
|---|---|---|
| `0x4641f0` | `00 00 f4 3f` | f32 1.90625（上文另一段的系数） |
| `0x4641f4` | `00 00 00 40` | **f32 +2.0 ← 判据阈值** |
| `0x4641f8` | `00 00 00 c0` | **f32 −2.0 ← `fadd` 的偏移量** |
| `0x4641fc` | `00 00 00 00 00 00 e0 3f` | **f64 0.5 ← `fdiv` 的步长** |

方向：`fcomp` → `fnstsw ax` → `sahf` → `jb`。x87 的 C0 位经 `sahf` 落到 CF，
`jb` 取 CF=1 ⇒ **`gain < 2.0` 时跳过**；即 `gain >= 2.0` 才加分。
加分式：`trunc((gain − 2)/0.5 + 1) = trunc(2·gain − 3)`。

**落码**（`ai/stock-policy.ts`）：
- `SELL_RATIO.gainFloor`：`-2.0` → **`2.0`**（附 +2.0 的完整判据注释）。
- 新增 `SELL_GAIN_SHIFT = -2.0`（`0x4641f8` 的偏移量），表达式改为
  `if (gain >= SELL_RATIO.gainFloor) score += saleScoreRound(2 * (gain + SELL_GAIN_SHIFT) + 1)`
  —— 形状与原版 `fadd(−2.0) → fdiv(0.5) → +1` 一一对应；
  `÷0.5` 用 `×2`（精确且避开 C-DET-3 的裸除法）。
- 另两段 `trunc(gain/0.5 + 1)`（`0x0042cea5` / `0x0042cf08`）本来就**没有偏移**、
  阈值是紧邻的 `liquid < 30000/16000 × 物价指数 && gain > 0`，与本次订正无关，
  仅补了 `@source` 注释。

**AI 行为会怎么变**：
- 旧代码在 `gain ∈ (0, 2)` 时把 `trunc(2·gain−3)`（**0 或负数**）加进卖出分：
  `gain ∈ (0, 0.5]` → −2、`(0.5, 1.25)` → −1、`[1.25, 1.5)` → 0、`[1.5, 2)` → 0。
  原版这一段是**整段跳过**（不加分，也不倒扣）。
- 后果：`pickForSale` 只挑**分 > 0** 的一支，旧代码会把「小赚 + 别的条款给了 +2」
  的持仓压回 0（甚至负数），那一回合 AI **不卖**；订正后被其它条款推到正分就会卖。
  另外多支竞价时，旧代码系统性压低低 `gain` 那支的排名，会改变卖哪一支。
- `gain >= 2.0` 的部分**新旧完全一致**（`trunc(2·gain−3)` 只在 `gain ≥ 1.5` 才非负，
  而新阈值 2.0 > 1.5），所以「大赚」行情的卖出行为不变。

**测试**（`ai/stock-policy.test.ts`，改了 1 条既有期望）：
- 旧 `scoreStockForSale(sellInput(), …) === -1`（gain = 10/10 = 1.0）——
  旧期望来自把 −2.0 当阈值。exe 里 `1.0 < 2.0` 直接 `jb` 跳过，原文就是 **0**；
  新断言改为 `0`。
- 新增边界：`gainFloor === 2.0`、`SELL_GAIN_SHIFT === -2.0`；
  恰好 2.0（price 20/cost 10）→ **+1**；19.99 → **0**；20.01 → **+1**；
  负边界 `gain = −2.0`（负成本构造的纯函数用例）→ **0**。
- 新增行为用例：`gain = 0.5` 且 `avg24 > avg6 && 現價 < 開盤`（+2）→ 新分 **2、
  会被卖**；旧式 2−2 = 0 ⇒ `pickForSale` 返回 −1（不卖）。

### 5.3 本轮仍未解 / 未动

- `0x0042ce38` 的 `fdiv qword [0x4641fc]` 是 **f64**，而 gain 是 f32；
  本仓库以 `Math.fround` 建模 gain、用双精度做 `2·(gain−2)+1`。
  两者在所有可构造的 f32 gain 上逐点相等（f32 尾数 24 位，`2·gain−3`
  要么在 Sterbenz 意义下精确、要么本身就是整数），故**未登记为新偏差**。
- D-QNUM-3（持股市值单精度累加）、D-QNUM-4（`holdingsCost` 的 `Math.round`）、
  D-QNUM-6（1.3 表调用点归属）本轮**未动**，仍以上文第 3 节为准。
