# 出处审计 · ai-econ（电脑 / 託管的经济决策）

分支 `ds/audit-ai-econ`。范围：买地、盖房 / 加蓋（级数、設施种类）、钱不够时的处理、拍賣出价、銀行（存提 / 贷款 / 特別融資 / 还款）、
股市（买 / 卖 / 打分 / 排名）、上市企業認購、电脑百貨公司、樂透、公佈欄 AI、魔法屋 AI、小遊戲 AI、以及 `ai/policy.ts` 对应的部分
（含「窗开着被托管」的代答）。出牌 / 道具 / 走路 / 骰子数等非经济选择归 ai-move，不在本表。

每条都重新用 `tools/disasm.py` 打开 VA 对过；标 ★ 的另在 Unicorn 里执行了原版机器码当预言机（`rich4-spec/tools/emulate.py`）。

## 摘要

| 状态 | 条数 |
|---|---|
| verified | 43 |
| fixed | 23（明细行；合并成 20 项修复，见下表） |
| approx | 4 |
| follow-up | 0（原 4 条 L7 / L45 / L48 / L62 已全部结项，见下表 F17..F20） |
| n/a | 1 |

### 修复（commit）

| # | 原来 → 原版 | VA | commit |
|---|---|---|---|
| F1 | 电脑买卡候选同价按卡号升序 → Watcom `qsort` 的真实次序（逐条移植，★ 800 组随机用例与原版机器码逐位相同） | 0x0042f0e4 / 0x457e6c / 0x42d0ef | 0dcfe00 |
| F2 | 百貨公司变卖（电脑 S1–S3 / 真人退货）让侧栏说「得點」台词 → 变卖不调 `0x44f230`，不说话（client `speech.ts`） | 0x42d145 / 0x42d1b2；0x44f230 调用点表 | 0dcfe00 |
| F3 | 买股入口 `rand()%3` 用 `aiRoll` 替身、不推进全局流 → 每个电脑回合**必掷**一次全局 `rand()`（reducer） | 0x0042bf14 | da585fa |
| F4 | 选股排名同分按下标升序（D-006） → Watcom `qsort`（4 字节元素、枢轴拷贝那一型） | 0x0042c64e / 0x42bed0 | da585fa |
| F5 | 逐名 `rand()%24` 用替身 → 全局流，只给非 0 分的名次掷 | 0x0042c690 | da585fa |
| F6 | 电脑买股走柜台检查 + 「股数×价 > 存款就减」护栏 → 原版 `0x428d2a(...,1)` 直接落账、无检查 | 0x0042c72d | da585fa |
| F7 | 买股预算 `(总额×比例)/100` 用 f64 → `imul` 只留低 32 位（富翁局会绕成负 ⇒ 不买） | 0x0042c01f | da585fa |
| F8 | 卖股 `rand()%3`（无壓力）用替身 → 全局流 | 0x0042c802 | da585fa |
| F9 | 卖股持股比例 = 我÷全體 → **全體÷我**（`DE F1 fdivrp`，与 `0x428e02` 均价同形）⇒ 「>0.6」恒真、「<0.4」恒假 | 0x0042c8c9 | da585fa |
| F10 | 卖股無企業 +2 看波动系数 `+0x18` → 看**趋势 `+0x1c`** | 0x0042cd72 | da585fa |
| F11 | 壓力下回头再卖时每步重算壓力旗（卖到 貸款 ≤ 手头 < 1.1×貸款 就停、且丢了 +1/×2）→ 旗是入口那一份，一直卖到盖住 1.1 倍 | 0x0042c7eb / 0x0042d0de | da585fa |
| F12 | 公佈欄 AI：没有进门清理 → `0x42483e` 撤失效挂牌（含「撤过一件游标就钉住」的怪癖）；挂卡候选去重 → 逐对压入不去重；收尾漏一次特別融資收回 | 0x004284c5 / 0x004288a9 / 0x0042885c | 89ad2c1（收尾那行在 da585fa 的 `aiAdvance` 里） |
| F13 | 电脑到銀行按 `cashRatio` 重分后漏了準備金对账 → 重分后 `0x436b0a(1)`（董事長垫差额） | 0x00437c12 | 0e8a4b7 |
| F14 | 拍賣心理价位的随机系数 / 缺地系数 / 地價×物價按 f64 算 → 各过一趟 f32（★ 6 组边界与原版逐组相同，旧式逐组差 1） | 0x00439f3b / 0x00439fc7 / 0x0043a011 | 9b3ea27 |
| F16 | 真人从工具列开 / 关公佈欄（协调方追加）：原先只是客户端开屏 → 与电脑同一个函数：开窗先 `0x42483e` 清理、关窗后 `0x436b0a(0)` 收回特別融資（`noticeBoard` 新增 `open` / `close`，客户端只在会生效且本机是回合主人时才交；服务器定序、单机同一 reducer） | 0x00417dee / 0x004284c5 / 0x0042885c | 6274d16 |
| F15 | 选地窗 / 选種類窗开着时被托管：自拟「取第一个」「不蓋公園取最小非 0（恒旅館）」→ 电脑那一支（`0x40b455` 挑地；`rand()%4+1`，新增 `facilityType: null`） | 0x0041ad12 / 0x0041a23e / 0x0040b1c5 | 2719f64 |
| F17 | 首建設施被衰神 / 死神挡下时**种类已经写进 `+0x18`**（留下一块「0 级但有种类」的地）：两支都写、闸在后（真人 `0x0041a239 mov [設施+0x18],al` / 电脑 `0x0041a257 mov [設施+0x18],dl`，都在 `0x0041a261 call 0x40fa61` 之前）→ `withFacilityType` | 0x0041a239 / 0x0041a257 / 0x0041a261 | ef0482c |
| F18 | 别人的建設公司**挑不出地也照收 1000×物價**（电脑 `0x40b455` 返回 0 / 真人选地窗右键交回 0）：`0x0041ad28 test ebp,ebp / je 0x41adff` → `0x0041adff..0x0041ae18`（物價 ×3 ×8 ×8 ×… = ×1000）→ `0x0041ae1a call 0x41d546` 同一段收費 | 0x0041ad28 / 0x0041adff..0x0041ae1a | 01e4bb9 |
| F19 | 百貨公司那一趟的**營業額**进这家上市企業的 `+0x28 / +0x2c`（真人电脑两支共用）：电脑支把每次买卖的返回值累加在 `ebp`，T 段走完 `0x0042f24f cmp eax,6 / jge 0x42ed50` **跳进真人支的同一段收尾** → `0x0042ed75` / `0x0042ed7e` | 0x0042ed50..0x0042ed7e / 0x0042f24f / 0x0042d237 / 0x0042d272 / 0x0042d145 / 0x0042d1b2 | ef0482c（真人支）+ 63412d6（电脑支） |
| F20 | 开着保釋窗被托管的真人：自拟「救得起同伴就救」→ 原版保釋窗是模态窗（`0x0043d331 cmp byte [+0x15],1` 只给恰好真人开），按关窗处理 | 0x0043d331 / 0x0043d33e..0x0043d3d3 / 0x0043d3d8 | 0e14efc（ai-move 区修，本表结项） |

**状态会变**（都进指纹：rngState、存款、持股、股价 / 流通量、公佈欄、董事長垫付、拍賣价位、`companyFunds`/`companyProfit`）
⇒ 需要协调方统一 bump `PROTOCOL_VERSION`。
（`companyFunds` / `companyProfit` 那一对在 `stateFingerprint` 里**没收**——F19 改的正是它们：真人 / 电脑进百貨都会动，
影响 15 日分紅与电脑选股打分里的月均盈餘。协调方若要在协议里对账这一项，得先把它加进 `net/protocol.ts` 的 parts。）
随改的测试（旧断言复述的是错行为）：`stock-policy.test.ts`（入口闸 / 排名 / 卖股两条 / 壓力循环）、`policy.test.ts`（0→1 步现在掷一次）、
`notice-audit.test.ts`（电脑买卖框改由调度步出）、`notice-board-market.test.ts`（候选成对）、`soak.test.ts`（账本把调度步里的卖股盈亏记进印钞机）、
换种子：`event-balance.test.ts` 43→46、`auction-acting-seat.test.ts` 14→12（意图不变，扫描记录在注释里）。

## 明细

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| L1 | 电脑买不买地 / 設施：`现金+存款−价 > min(trunc(開局×0.05),7000)×物價` | core/src/rules/purchase.ts:166 | 0x41d7d4（常量 f64 0x463cc8=0.05、0x1b58）；调用 0x41a089 / 0x41a8ca | verified | `jle` 有符号；存款只垫底 |
| L2 | 买地的闸：夢遊 +0x37 / 土地公 0xc / 价 ≤ 现金；价 = (地價+房價×等级)×物價 | core/src/rules/land.ts:112 | 0x41a01a..0x41a059 | verified | 电脑先决定再过衰神闸 0x41a0c7 |
| L3 | 买設施同一条判定，价 = +0x22×物價 | core/src/ai/policy.ts:564 | 0x41a86b..0x41a8ca | verified | |
| L4 | 自有地加蓋：电脑够钱就蓋一级，无保留额 | core/src/ai/policy.ts:623 | 0x419976 `test [+0x15],6 / jne` | verified | 每次落点一级 |
| L5 | 設施加蓋：电脑够钱就蓋，无保留额 | core/src/ai/policy.ts:571 | 0x41a30d | verified | |
| L6 | 設施首建：`who_plays != 1`（整字节）⇒ `rand()%4+1` | core/src/state/reduce.ts:8548、rules/facility.ts:407 | 0x41a21f / 0x41a23e | verified | 衰神闸之前掷（rng 照推进） |
| L7 | 首建被衰神挡下时原版已把 `+0x18` 种类写进去（两支都是） | core/src/state/reduce.ts 的 `withFacilityType`（`buildFacility` / `landOnFacility` 两条） | 0x41a257 / 0x41a239 → 0x41a261 | fixed | ef0482c。★ 0 级設施带种类的**读者逐个核过**：研究所 tick `0x41cda6` 只判 `type==4` 与 `+0x1e`（**不判 level**，与 `tickResearch` 的「项目 > 等级 ⇒ 作废」一致）；落点收費 `0x41a377 cmp [+0x1a],0 / je` 先分流；研究所面板 `0x41b0fc cmp [+0x1a],0 / je` 先分流；棋盘绘制 `0x4093f3` / 悬浮提示 `0x417999` 都是 level==0 先分流成「空地」；面板收费列 `0x424e06` 同；建設公司电脑挑地 `0x40b4db` 只比 `FACILITY_MAX_LEVEL[type]`、不排除 0 级；傳送機 `0x004475f2` 无条件搬 `+0x18`。均一致 |
| L8 | 钱不够时：没有「卖什么换钱」的电脑决策 —— `pay_money` 现金→存款→破產，唯一的 +0x15 读是重画 | core/src/rules/bankruptcy.ts:43 | 0x41d2c6（0x41d3dd 只重画） | verified | 破產清算的拍賣见 L9–L12 |
| L9 | 拍賣心理价位公式（两次 rand、v1/v2/现金取小） | core/src/rules/auction.ts:552 | 0x439f0d..0x43a149 | fixed | F14 |
| L10 | 谁算心理价位：座位非空、`& 6`、状态 0，座位序 | core/src/rules/auction.ts:912 | 0x43c5d0..0x43c61e | verified | |
| L11 | 出价：现价>现金 ⇒ 放棄(6)；五档；压到最高者现金+500；开场 1 座位压成 +100 | core/src/rules/auction.ts:638 / 1020 | 0x43b10c..0x43b22b | verified | 压价读最高者**实时**现金；拍賣中现金不变 ⇒ 快照等价 |
| L12 | 拍賣 AI 出价由 core 驱动、判 `pending.seat` | core/src/ai/policy.ts:472 | 0x43c4f5 循环 | verified | |
| L13 | 電腦銀行：有贷款 ⇒ 2×貸款 < 存款 或 (≤6 天且 手头 ≥ 1.1×貸款) 就全额还 | core/src/places/bank.ts:420 | 0x4367ab..0x436888（f64 0x464b24=1.1） | verified | 只清 +0x24 不清到期日 |
| L14 | 電腦銀行：没贷款 ⇒ `rand()%10==0` 或 手头 < 30000（**不乘物價**）；暫停放款 / 比例 0 不借 | core/src/places/bank.ts:441 | 0x436893..0x4368e3 | verified | |
| L15 | 借款额 = trunc(比例×身家快照/100)，`imul` 32 位，**赋值** | core/src/ai/personality.ts:94 | 0x4368e9..0x436906；快照 0x43668f | verified | `wealth<=0 ⇒ 0` 的护栏：该支 loan==0 ⇒ 身家 ≥ 0，等价 |
| L16 | 電腦 ATM：按 cashRatio 重分（月初×1.5 / 月末×0.5、夹 0.9/0.1、±0.25 带、现金 0 必分） | core/src/places/bank.ts:283 / 242 | 0x437acd..0x437c03 | verified | 现金÷总额 `DE F9 fdivp` |
| L17 | 重分之后 `0x436b0a(1)` 準備金对账 | core/src/state/reduce.ts:6681 | 0x437c12 | fixed | F13 |
| L18 | 貸款屏：恰好真人开窗，其余（含托管）当场电脑支；托管真人窗开着 ⇒ `op:auto` | core/src/ai/policy.ts:549、state/reduce.ts:6621 | 0x4366a3 | verified | |
| L19 | 电脑不碰特別融資 / ATM 窗 | core/src/state/reduce.ts:6621 | 0x4367ab 支无相关调用 | verified | |
| L20 | 调度步：特別融資收回 `0x436b0a(0)` | core/src/state/reduce.ts:6930 | 0x418dfe；0x436c6d..0x436d35 | verified | |
| L21 | 公佈欄收尾再收一次 `0x436b0a(0)` | core/src/state/reduce.ts:6804 | 0x0042885c | fixed | F12 |
| L22 | 调度顺序：买股 → 卖股 → 收回 → [终局码] → 公佈欄 → `rand()&1` | core/src/state/reduce.ts:6804 | 0x418dc6..0x418e2d | verified | `+0x15 & 0x30` 整段跳过（0x418dd8）本引擎走不到（0x10 在 startTurn 收、0x20 走路半程清）|
| L23 | 买股入口 `rand()%3` | core/src/ai/stock-policy.ts:349 | 0x42bf14 | fixed | F3 |
| L24 | 买股三闸：f26 / 休市 / 距還款日 < 15 | core/src/ai/stock-policy.ts:349 | 0x42bf30 / 0x42bf3d / 0x42bf65（0x4521aa = 到期−今天） | verified | |
| L25 | 持仓市值：整数累加器逐轮过 f32、向零截断 | core/src/ai/stock-policy.ts:92 | 0x42bf94..0x42bff6 | verified | |
| L26 | 预算：`imul` 32 位 / 100，封顶存款 | core/src/ai/personality.ts:121 | 0x42bfff..0x42c060 | fixed | F7 |
| L27 | 打分·有企業（20000×物價存款闸；S 三档；A×1.2 进场 + 董事長争夺 +1/+2；A×0.85 +3；A×0.7 +5） | core/src/ai/stock-policy.ts:216 | 0x42c5d8..0x42c34d；常量 0x46419c/a4/ac | verified | 5000/10000×物價由移位算，逐条核过 |
| L28 | 打分·無企業（30000×物價；avg24/avg6 环形 144、只算非 0；+2/+4/+2，趋势 `cmp int,0x40000000`） | core/src/ai/stock-policy.ts:216 / 153 | 0x42c352..0x42c557；常量 0x4641b4/bc/c4 | verified | |
| L29 | 停牌 / 漲停 / 可成交量 0 ⇒ 0 分 | core/src/ai/stock-policy.ts:216 | 0x42c5a6 / 0x42c5b0 / 0x42c5bd | verified | |
| L30 | 排名 `qsort` | core/src/ai/stock-policy.ts:306、rules/watcom-qsort.ts:55 | 0x42c64e / 0x457e6c / 0x42bed0 | fixed | F4（★） |
| L31 | 逐名 `rand()%24 <= 12−i` | core/src/ai/stock-policy.ts:317 | 0x42c690 | fixed | F5 |
| L32 | 股数 = trunc(预算/現價)，0 不买，夹可成交量；直接 `0x428d2a(...,1)` | core/src/ai/stock-policy.ts:349、state/reduce.ts:6835 | 0x42c6e2..0x42c72d | fixed | F6 |
| L33 | 电脑买 / 卖的框「買進 / 賣出%s%d張」 | core/src/state/reduce.ts:6835 / 6869 | 0x42c770 / 0x42d076 | verified | 随买卖挪进调度步 |
| L34 | 卖股壓力旗 = ≤6 天 且 手头 < 貸款 | core/src/places/stock-market.ts:617 | 0x42c7bc..0x42c7eb | verified | `loan<=0/due==0` 护栏：手头 ≥ 0 时等价 |
| L35 | 无壓力 `rand()%3` | core/src/state/reduce.ts:6869 | 0x42c802 | fixed | F8 |
| L36 | 持股比例 = 全體 ÷ 我 | core/src/ai/stock-policy.ts:508 | 0x42c8c9（DE F1） | fixed | F9 |
| L37 | 無企業 +2：gain>1.6 且 趋势 < 1.0 | core/src/ai/stock-policy.ts:508 | 0x42cd59 / 0x42cd72 | fixed | F10 |
| L38 | 其余卖股规则（深亏 +3、亏 6000 +2、A×2/A×3 +2、董事長争夺 +1、min×8、avg、gain≥2 段、手头紧两段、壓力 +1/×2） | core/src/ai/stock-policy.ts:508 | 0x42c8fa..0x42cf46；常量 0x464204..0x464234、0x4641dc..0x4641fc | verified | |
| L39 | 挑分最高（严格 >）、卖**全部**、`0x428e23(...,1)` 进存款 | core/src/ai/stock-policy.ts:563 / 582 | 0x42cf60 / 0x42d033 | verified | |
| L40 | 壓力下回头再卖（旗不重算） | core/src/state/reduce.ts:6869 | 0x42d0a2..0x42d0de | fixed | F11 |
| L41 | 均价 0 时 gain = 现价/0 | core/src/ai/stock-policy.ts:508 | 0x42cbc7 | approx | 原版 inf ⇒ `fistp` 不定值；本引擎给 0。只有「0 成本得股」才会碰到 |
| L42 | 認購上限 `min(1000, 现金÷單價, 企業餘量)`，真人电脑共用 | core/src/places/company.ts:207 | 0x41d1ea..0x41d221 | verified | pt27 的修复复核无误 |
| L43 | 电脑認購 `0x41d839`：d = 现金 − trunc(開局×0.30)×物價；≤0 不买；> 單價×上限 ⇒ 上限；否则 d÷單價 | core/src/places/company.ts:243、ai/policy.ts:595 | 0x41d839..0x41d896；0x41d267；0x41d273 | verified | 读的是 `[0x49910c]` 的现金（= 落点者） |
| L44 | 建設公司电脑挑地：自家住宅 <5 级取当前租金最高；設施取地價最高且 < 种类上限 | core/src/places/company.ts:293 | 0x40b455；表 0x474940 | verified | |
| L45 | 别人的建設公司、挑不出地 ⇒ 仍收 1000×物價 | core/src/state/reduce.ts `landOnCompany` 的 construction 支（电脑「target == 0」与真人「候选为空」两条） | 0x41ad28 / 0x41adff..0x41ae1a | fixed | 01e4bb9：电脑那支 `aiPickConstructionTarget` 返回 0 ⇒ 收 1000×物價；真人那支选地窗交回 0（`0x446ae8`）同样收 |
| L46 | 电脑百貨公司 S1（按**槽号**取 f7）/ S2 / S3 / 离店 / 半点卡半点道具 / 機車汽車 / 六件表 | core/src/places/ai-shop.ts:97 | 0x42ed8d..0x42f307；表 0x4755f0 | verified | pt26 的重写逐段复核无误（价表 0x47fdef / 0x47fedf） |
| L47 | 买卡候选排序 | core/src/places/ai-shop.ts:97 | 0x42f0e4 / 0x42d0ef | fixed | F1（★） |
| L48 | 离店时这趟买卖的營業額记进那家企業 `+0x28/+0x2c` | `state/reduce.ts` 的 `shopRevenueTo`（真人支逐笔 / 电脑支离店一次）；`places/ai-shop.ts` 的 `revenue` | 0x0042ed50..0x0042ed7e（两支汇合）；每笔返回值 0x0042d237 / 0x0042d272（標價×10）、0x0042d145（標價）、0x0042d1b2（標價×数量） | fixed | 真人支 ef0482c；**电脑支 63412d6**（原注释误以为电脑支不记，漏了 `0x0042f24f cmp eax,6 / jge 0x42ed50` 那句回跳）。影响 15 日分紅与电脑选股打分 |
| L49 | 托管真人开着商店窗 ⇒ 关窗 | core/src/ai/policy.ts:520 | —（原版窗模态，没有这回事） | approx | |
| L50 | 樂透：恰好真人才开屏；电脑现金 > 1000 且有空号 ⇒ `rand()%空号数` 买一注 | core/src/state/reduce.ts:6470、places/lottery.ts:182 | 0x4315da / 0x43169e..0x431700 | verified | |
| L51 | 公佈欄进门清理 `0x42483e` | core/src/state/reduce.ts:7055、places/notice-board.ts:394 | 0x42483e..0x4249b4；跳表 0x42482e；0x4413ad | fixed | F12；真人工具栏那一路见「跨区」 |
| L52 | 挂卡：1/15、手牌 > 12、成对候选 `rand()%n`、满栏先撤第 0 格、价 = 標價×100×物價；挂了卡就不看道具 | core/src/places/notice-board.ts:368、state/reduce.ts:6953 | 0x42886e..0x428953 | fixed | F12（成对计数） |
| L53 | 挂道具：数量 ≥3 或 (有且 f7−個性==2)、`rand()%n` | core/src/places/notice-board.ts:411 | 0x428958..0x428a2f | verified | |
| L54 | 1/3 重估自己挂的道具 / 卡价 | core/src/state/reduce.ts:6953 | 0x428a37..0x428ae6 | verified | |
| L55 | 1/4 买别人的：股票 trunc(總價/股數) < 現價；地產 3×估值 > 標價 且 现金 > 2×標價（估值用**现**等级）；成交一件即止 | core/src/places/notice-board.ts:429 / 435 | 0x428ae8..0x428ca9 | verified | 购买本体 0x4255da 与真人共用 |
| L56 | 魔法屋电脑：`rand()%12` 选对象（空就重抽）；名单有自己 ⇒ 6；否则 `rand()%11`，6→7 | core/src/places/magic-house.ts:549 / 592 | 0x43390b..0x43397e | verified | |
| L57 | 魔法屋重抽上限 32 次 | core/src/places/magic-house.ts:549 | 0x433932 `je 0x433910`（无上限） | approx | reducer 必须终止（C-DET-4） |
| L58 | 小遊戲：`who_plays != 1` 或开关关 ⇒ 不玩，`50 + rand()%20`，再 `rand()&1` 台词 | core/src/places/minigame.ts:68、ai/policy.ts:527 | 0x415226 / 0x415457 / 0x4154b6 | verified | |
| L59 | 托管真人开着认购窗 ⇒ 电脑那支 `0x41d839` | core/src/ai/policy.ts:595 | 0x41d267 | verified | |
| L60 | 托管真人开着选地窗 ⇒ 电脑那支 `0x40b455` | core/src/ai/policy.ts:576 | 0x41ad12 / 0x41aa3c | fixed | F15 |
| L61 | 托管真人开着选種類窗 ⇒ `rand()%4+1`（付费首建 / 神明代蓋两型） | core/src/ai/policy.ts:589、state/reduce.ts:2153 | 0x41a23e / 0x40b1c5 | fixed | F15 |
| L62 | 托管真人开着保釋窗 ⇒ 自拟「救得起同伴就救」 | core/src/ai/policy.ts 的 `decidePending`（`p.kind === 'bail'` ⇒ `declineDecision`） | 窗 `0x0043d331 cmp byte [+0x15],1 / jne 0x43d3d8`、`0x0043d33e..0x0043d3d3` 模态；电脑支 `0x0043d3d8..0x0043d4fd` | fixed | 0e14efc（ai-move 区）：模态窗里托管位冒不出来 ⇒ 与商店 / ATM 同口径按关窗处理；电脑 / 托管的保釋由 reducer 的 `enterVisit` 按电脑支掷（与 P-3 同一处） |
| L63 | 托管真人开着 ATM / 还款提醒窗 ⇒ 关窗 | core/src/ai/policy.ts:514 / 552 | 0x437a18 / 0x43695e 只给恰好真人开 | approx | 原版窗模态 |
| L64 | 设 `aiRoll` 替身的剩余用法（出牌 / 道具个性闸） | core/src/ai/policy.ts | 0x41e69e / 0x420e9a | n/a | 不在本区（ai-move），D-004 |
| L65 | 电脑百貨变卖 / 退货不说「得點」 | client/src/speech.ts（`soldInventory`） | 0x42d145 / 0x42d1b2；0x44f230 调用点 | fixed | F2（纯表现） |
| L66 | 小遊戲 / 魔法屋 / 保險：电脑经济逻辑里没有「保險永久」的假设 | core/src/ai/*、places/* | — | verified | 协调方所问：ai-econ 各函数都不读 `insuranceDays` |
| L67 | 電腦買地后 `0x40a4e1` / 土地權限到期日等落账细节 | core/src/state/reduce.ts | 0x41a0fe..0x41a128 | verified | 与真人同一段 |
| L68 | 拍賣起拍价 trunc(地價×(1+级×0.5))×物價 | core/src/rules/auction.ts:104 | 0x43be37..0x43be5b | verified | 规则，顺手复核 |
| L69 | 樂透现金判据 `jle`（=1000 不买）与真人 `jge`（=1000 可买）不同 | core/src/places/lottery.ts:45 | 0x43169e / 0x42f8ba | verified | |
| L70 | 电脑百貨董事長赠礼在分支之前（两支都送） | core/src/state/reduce.ts:7272 | 0x42e97d..0x42ea28 | verified | |
| L71 | 真人工具列开 / 关公佈欄：进门清理 + 收尾收回特別融資 | core/src/state/reduce.ts（`noticeBoardAction` 的 open/close）、client/src/board-screen.ts（`openBoard` / `closeAll`） | 0x00417dee / 0x004284c5 / 0x00428853..0x0042885e | fixed | F16；测试 `server/src/board-sweep-mp.test.ts`、`client/src/board-screen.test.ts` |

## 跨区（发现但不归本区，未改）

- ~~**company 区**：别人的建設公司，挑不出可加蓋的地时原版照收 **1000×物價** 工程費（`0x0041adff..0x0041ae1a`）~~ —— **已修**（F18 / `01e4bb9`，电脑与真人两支都收）。
- ~~**shop / company 区**：百貨公司离店把这趟买卖额加进那家企業的 `+0x28 / +0x2c`（`0x0042ed75` / `0x0042ed7e`）~~ —— **已修**（F19：真人支 `ef0482c`、电脑支 `63412d6`）。
- ~~**facility 区**：設施首建时种类字节在衰神闸之前就写了（`0x0041a239` / `0x0041a257`，闸在 `0x0041a261`）~~ —— **已修**（F17 / `ef0482c`）。
- ~~**notice-board / UI 区**：真人从工具栏打开公佈欄不清理、不收回~~ —— 协调方转回本区，已修（F16 / L71）。
- ~~**ai-move 区**：托管真人开着保釋窗时，`decidePending` 的「救得起同伴就救」是自拟的~~ —— **已修**（F20 / `0e14efc`；ai-move 区的 P-4，电脑支由 reducer 掷）。
- **client 区**（已顺手修，见 F2）：`detectPointsGained` 把百貨公司变卖当成 `0x44f230` 的「得點」台词。

## follow-up 汇总

**已全部结项（2026-09-25）**——原 4 条都不在 ai-econ 本区，由对应区修完、这里按协调方口径标记：

1. L7 設施首建种类先写后闸（facility 区）→ **fixed** `ef0482c`；本表另做了「0 级設施带种类的读者逐个核」（见 L7 行的 note）。
2. L45 建設公司无地可蓋仍收 1000×物價（company 区）→ **fixed** `01e4bb9`。
3. L48 百貨公司营业额进企業帐（shop / company 区）→ **fixed** 真人支 `ef0482c` + **电脑支 `63412d6`（本分支）**。
4. L62 托管真人的保釋代答（ai-move 区）→ **fixed** `0e14efc`。

（本表没有留下新的 follow-up；ai-econ 区自身 **71** 条明细全部 verified / fixed / approx / n/a：43 / 23 / 4 / 0 / 1。）

## 工具

- `tools/audit/qsort-oracle.py`：在 Unicorn 里跑原版 `0x457e6c`（配 `0x42d0ef` / `0x42bed0`），生成 `rules/watcom-qsort.test.ts` 的预言机用例；
  段寄存器 `push/pop es/fs/gs` 打成等长桩（平坦模式装不了段选择子）。
- 拍賣心理价位的 6 组边界用例用 `rich4-spec/tests/test_auction_limit.py` 的 `Fixture` 生成（`rules/auction.test.ts` 末尾）。
