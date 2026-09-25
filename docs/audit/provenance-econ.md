# 出处审计 · econ（钱与资产规则：人和电脑共用的那部分）

分支 `ds/audit-econ`。范围：买地 / 盖房 / 设施、过路费（住宅、连锁店、同盟、神明、设施、免收、被动卡尾巴）、`pay_money` 与破产清算、
拍賣、銀行（ATM / 貸款 / 特別融資 / 準備）、股市（行情、柜台、分紅、企業）、樂透、月结、物价指数与身家、胜负、點券、地块状态每日扫描。
卡片 / 道具里挪钱的效果归 cards，新聞 / 命運的金额归 events：这里跳过，发现的问题写在「跨区」一节。

方法：每一条都重新用 `tools/disasm.py va|callers|xref|dump` 打开 exe 对过（已有的 `@source` 注释只作线索，不直接采信）。
股市 / 樂透 / 銀行·月结 / 拍賣四块由只读助手按同样口径逐条取证，修复由本分支统一落码。助手取证所得的结论我都抽查了
关键 VA（分紅 0x0042bc93、指数 0x004294bc、拍賣首座 0x0043af13、流拍 0x00443357 / 0x004324da、还款 0x0043538c、
柜台 0x0042af43、準備 0x00437c12、建設公司 0x0041adff），确认无误后才落码。

★ 2026-09-25 补：**follow-up 收尾**（分支 `ds/fu-econ`，基于 `ds/audit-provenance`）。审计留下的 6 条 follow-up 逐条重开：
4 条修掉（BNK-17 早已被 32ef122 修、FAC-15/PUR-16 早已由 events 区的台词随机收口修掉、PAY-05、STK-57、AUC-43、WLT-02 ——
其中 WLT-02 用原版真码（Unicorn）实测出越界语义），1 条仍未修（AUC-48，见下），1 条属别区实现细节（卡片那几条付款点付不起也破不了产）。
修掉的 5 条列在「后续修复」表的 F27..F31。

## 摘要

| 状态 | 行数 | 覆盖的规则条数（`X-a..b` 一行算多条） |
|---|---|---|
| verified | 90 | 204 |
| fixed | 46 | 51（其中「修复（commit）」表 F1..F21 = 21 行、两处「后续修复」表 F22..F31 = 10 行，共 31 行；其余 `fixed` 行见「另有六条…」那段与本轮复核的三条） |
| approx | 8 | 8 |
| follow-up | 1 | 1 |
| n/a | 7 | 8 |

（合计 **152 行 / 272 条规则**，与台账逐行数出来的结果一致 —— `grep -c '^| [A-Z]*-[0-9].*| <状态> |'`。）

★ 2026-09-25 follow-up 收尾（`ds/fu-econ`）后各状态的变化：`approx` 11 → 8（FAC-15 / PUR-16 / WLT-02 转为按原版实现）、
`follow-up` 5 → 1（BNK-17 / PAY-05 / STK-57 / AUC-43 转 `fixed`，只留 AUC-48）、`fixed` 39 → 46、`verified` 与 `n/a` 不动；
**行数不变（152）** —— 这一轮没有加/删台账行，只改状态与备注。

### 后续修复（合并 `ds/audit-provenance` 前后各一批）

| # | 原来 → 原版 | VA | commit |
|---|---|---|---|
| F22 | 旅館住店**多记**一笔 費/100 敌意（收費那句 `0x0041a5c0` 也被旅館走到） → 只有非旅館設施记 費/100；旅館只留落点那句 20×天×物價 | 0x0041a5d5 `cmp byte [設施+0x18],1 / je 0x41a63d` | 见「合并 `ds/audit-provenance`」那个提交 |
| F23 | 拍賣卡在掷骰前打出时用卡者**丢掉这一掷**（落槌一律 `turnEnd`） → 落槌回到出卡时的相位（`pending{auction}.resumePhase`） | 0x0044336b `mov ebx,1`、电脑支 0x00418e75 `call 0x40dd1f` | f6af0f1（AUC-45） |
| F24 | 拍賣出价时判真人的是 `& 6`（带 0x10/0x20 位的真人被当电脑等） → 整字节 `== 1`；現金 < 现价 的真人由 core 替他按「放棄」 | 0x0043b001 / 0x0043b06c..0x0043b085 | f4ed239（AUC-22 / AUC-23） |
| F25 | 全场不能出价但有最高出价者时判**流拍** → 按现价成交给最高出价者 | 0x0043b2cd → 0x0043b5ce `push [0x48c4a8]` | f4ed239（AUC-34） |
| F26 | 加价额收任意 > 0 且付得起的数（联机可伪造） → 只收档位表里的值 | 0x0043a49b `add eax,[ebx*4 + 0x475ba2]`、表 dump 0x475ba2 = 100/500/1000/5000/10000 | f4ed239（AUC-46） |
| F27 | 破产清算**先把 3 处抽完再排队开拍**（第 2、3 抽的 `rand()` 跑到第 1 场心理价位之前 ⇒ 整条随机流错位） → 抽一处就开一场，回来再抽下一处（`{kind:'bankruptcyDraw'}` 队列项） | 0x0040d1d7 `call 0x456f2d / idiv esi` ↔ 0x0040d1e3 `call 0x43bde5`（同一循环） | 见「follow-up 收尾」那个提交（AUC-43） |
| F28 | `pay_money` 先给收款人入账、再跑破产清算 ⇒ 清算拍卖里收款人的現金多了这一笔（出价上限偏高） → 入账排在**整条清算拍卖之后**（`{kind:'credit'}` 队列项） | 0x0041d376 `call 0x40cd87` 早于 0x0041d387 的收款分支 | 同上（PAY-05） |
| F29 | 分紅破产只提前放掉樂透号码，清算本身拖到推日期**全部走完**才做（開獎 / 月结 / 地契到期都跑在清算之前） → 分紅循环里当场清算，剩下的半段挂 `{kind:'dayRolloverTail'}` 等拍卖打完 | 0x0042beba `call 0x40cd87`（在 0x0041d094 開獎之前） | 同上（STK-57） |
| F30 | `endTurn` 的「惡人段停在 turnEnd」出口一律 `pending: null` ⇒ 惡人那一步把人榨破产时**丢掉清算拍卖**（队列里剩下的场次再也接不上、`afterDayRollover` 见队列非空却没有 pending ⇒ 卡死） → 是拍卖就留着（`phase:'awaitingDecision'`） | 0x0041c521 `call 0x41d2c6` → 0x0041d376 `call 0x40cd87` → 0x40d1e3（阻塞） | 同上（扫 `pending: null`） |
| F31 | 身家累加器用 JS 双精度（>2^31 不回绕、`fistp` 越界不落不确定值） → 32 位整数：口袋相加 `\|0`、股票每轮 `fistp dword`（越界 ⇒ `0x80000000`）、地块/設施 `add` 回绕 | 0x004239c7..0x004239db / 0x00423a17 / 0x00423a4a / 0x00423ac4；**原版真码实测**见 `rules/wealth.ts` 注释 | 见「follow-up 收尾（WLT-02）」那个提交（WLT-02） |

另有六条 follow-up 在本分支合并前后被自己修掉（行里已改标 `fixed`，规则条数一并从 follow-up 移过来）：
**STK-50** 建設公司真人选地窗（aac1ed5）、**BNK-22** 真人关股市屏强制收回特別融資（7993aef）、
**MON-16** 节日查找跳过 0x80 记录（32ef122）、**LOT-09** 現金 <1000 也开樂透投注屏（d286ade）、
以及 AUC-45 的相位那一条（f6af0f1，见 F23）。
★ 另有 **BNK-17**（电脑借款额身家为负照算，32ef122）与 **FAC-15 / PUR-16**（住店 / 街區台词的两处 `rand()` 由 core 掷，
events 区 5f14c39「FU-1 台词阶梯里的 rand 全部收进 core」）在本区合并前后已由别处修掉，本分支只**复核**后改标 `fixed`（见台账对应行）。

**是否改动状态：是。** 几乎每一项修复都改变对局状态或随机流（敌意、付款去向、终局判定、分紅、拍賣首座、行情精度……）。
**需要协议号 +1**（本分支没有改 `PROTOCOL_VERSION`，由协调人统一改）。
★ follow-up 收尾这一批也改状态与随机流：AUC-43 改**抽签次序**（同一局面下抽到的地块不同）、
PAY-05 改**清算拍卖期间收款人的現金**（出价上限跟着变）、STK-57 改**分紅破产那一天的后续次序**、
扫 `pending: null` 只在「惡人段中间把人榨破产」时改状态（原先那条路会丢拍卖）、WLT-02 只在身家 >2^31 时改数值。

逐条回答协调人最关心的那一问（**改状态 / 改随机流**）：

| 修复 | 改状态？ | 改随机流？ | 说明 |
|---|---|---|---|
| F1..F21 | 是 | 部分是 | 敌意、付款去向、终局、分紅、拍賣首座；拍賣首座与心理价位顺序会改 `rand()` 的**归属**（次数不变） |
| F22 旅館不记 費/100 | 是 | 否 | 只少加一笔敌意，不掷 |
| F23 AUC-45 `resumePhase` | 是 | 否 | 相位从 `turnEnd` 变成 `awaitingRoll`；**不消耗随机数**（掷骰仍由后续 `rollDice` 那一条 action 掷） |
| F24 拍賣真人判据 | 是 | 否 | 分流不同 ⇒ 等不等真人点、谁被替按「放棄」；竞价里的 `rand()`（心理价位）在**开拍时**已掷完，不受影响 |
| F25 全堵有最高者成交 | 是 | 否 | 落槌判据 |
| F26 加价档位校验 | 是 | 否 | 只拒非法档位（正常对局本来就只发档位值） |
| `stockScreen`（BNK-22） | 是 | 否 | 新 action：真人关股市屏的那一条出口，先例同公佈欄 `open/close` |
| 魔法屋二级判定补记牌堆（跨区 events） | 是 | 否 | 只把用掉的免罪/嫁禍卡记回牌堆（守恒），不掷 |
| F27 AUC-43 抽签交错 | 是 | **是** | `rand()` 次数可能变（重抽次数随抽签次序变），抽到的地块也不同；同一 action 内就分岔 |
| F28 PAY-05 入账延后 | 是 | 否 | 只挪入账时点（`rand()` 一次不多不少）；清算拍卖里的出价上限/资格跟着变 |
| F29 STK-57 当场清算 | 是 | 部分 | `rand()` 次序变了（清算的两次抽签 + 每场心理价位挪到開獎之前）；出局者号码照旧不参加開獎 |
| F30 恶人段不丢拍卖 | 是 | 否 | 原先那条路**丢掉**拍卖（少掷清算的随机数）；现在照原版跑完 |
| F31 WLT-02 32 位身家 | 是 | 否 | 只在身家 >2^31 时数值不同（`fistp` 越界落 `0x80000000`）；不掷 |


### 修复（commit）

| # | 原来 → 原版 | VA | commit |
|---|---|---|---|
| F1 | 过路费不记敌意 → 付钱前 当前玩家→地主 += (调整后总额 − 同盟原始份)/100、→同盟 += 同盟原始份/100（无同盟：总额/100） | 0x00419d8e..0x00419df3 | 87cd1b2 |
| F2 | 同盟分账比例的分母用未翻倍的地主份 → 用涨价翻倍后的地主份 | 0x00419b0f → 0x00419cbd | 87cd1b2 |
| F3 | 同盟得 = trunc(fround(总额 × 比例)) → 乘积按扩展精度，不压回 float32（10、7:3 ⇒ 同盟得 6 不是 7） | 0x00419f7d / 0x00419f84 | 87cd1b2 |
| F4 | 神明把过路费抹成 0 仍走尾巴、把「上次过路费」写成 0 → 当场收尾 | 0x00419d7e je 0x41b077 | 87cd1b2 |
| F5 | 嫁禍 / 死神换成地主或地主的同盟时照样付钱（钱挪进他自己的存款、白记本月收支） → 整段跳过 | 0x00419f30 / 0x00419f40 | 87cd1b2 |
| F6 | 設施收费不记敌意 → 費/100；旅館另记 20×天×物價（★ 旅館**不**记 費/100，见 F22） | 0x0041a5c0 / 0x0041a7bc、0x0041a5d5 | 87cd1b2 |
| F7 | 設施一律不问免費卡 → 只有旅館跳过，購物中心 / 加油站照问 | 0x0041a5d5 je 0x41a63d | 87cd1b2 |
| F8 | 設施付款人换成主人自己时照付 → 不付、不记 `[+0x30]`，但旅館照住 | 0x0041a709 je 0x41a761 | 87cd1b2 |
| F9 | 住旅館额外把 2000×天×物價 记进本月支出（自拟） → 删掉；`+0x5c` 只有 pay_money 写 | xref 0x496bc4 | 87cd1b2 |
| F10 | 被嫁禍 / 死神点到的人在押时住店变成「坐牢 + 住店」 → 先 `0x40d761` 出獄（清占用表 + 四个计数） | 0x0041a7c5 / 0x0040d761 | 87cd1b2 |
| F11 | 破产后按在场总人数判终局 → 按在场**真人**数：真人全出局就收局（码 1），真人输给最后一家电脑不再报「真人胜」 | 0x0040cfdb..0x0040d039 | 442dd02 |
| F12 | 破产不清别人对他的敌意 → hostility[b][破产者] = 0 | 0x0040cf47..0x0040cf6b | 442dd02 |
| F13 | 企業分紅 / 大盘指数的乘积压回 float32；波动率按 double；拍賣心理价位两个系数按 double；物价指数身家合计不回绕 → 照 x87 / 32 位 | 0x0042bc93、0x004294bc、0x00429266、0x00439f3b / 0x00439fc7、0x00423af5 | 16790f5 |
| F14 | 分紅逐家企业结（负盈餘先扣穿存款、甚至误判破产） → 按人加总、每个在场玩家结一次；分紅破产者的樂透号码在开獎前释放 | 0x0042bce3 → 0x0042be6d..0x0042beba；0x0040d1a8 早于 0x0041d094 | 01e4bb9 |
| F15 | 别人的建設公司没地可蓋不收费 → 收 1000×物價 | 0x0041ad28 je 0x41adff | 01e4bb9 |
| F16 | 还款超过 現金+存款 照扣（現金可负） → 拒收 | 0x0043538c jle | 49b2897 |
| F17 | 柜台买入上限看流通股 +8、按「成本 ≤ 存款」 → min(今日可成交量 +0x0a, trunc(存款÷現價)) | 0x0042af43 / 0x0042af66 | 49b2897 |
| F18 | 拍賣开场席位 = 第一个在场座位 → **最后**一个（esi 缓存 −1 后不再更新） | 0x0043af13..0x0043af45 | a52570e |
| F19 | 流拍一律把地变无主 → 只有拍賣卡清归属并清到期日；魔法屋 / 新聞 7 / 破产丢掉返回值 | 0x00443357..0x0044335f / 0x0044348a；0x004324da | ab76320 |
| F20 | 电脑在銀行重分現金/存款后不查準備 → 模式 1 对账（董事長垫缺口）；路过銀行垫付分出胜负即收 | 0x00437c12；0x0041b5b0 | 9c1c8a8（ai-econ 也修了同一处，合并时取其注释） |
| F21 | 百貨格的营业额不进企業盈餘 → 买 標價×10、卖 標價(×个数) 进 `[企業+0x28/+0x2c]`；首建設施被衰神挡下时种类已写上 | 0x0042ed75 / 0x0042ed7e；0x0041a239 / 0x0041a257 → 0x0041a261 | ef0482c |

另：文档订正（不改状态）—— `D-LEGACY-1/2` 作废：`0x0041a805` / `0x0041b04f` 的 `push 0` 让 `[esp+0xd4]` 正好是 `[esp+0xd0]`（天数），
不是未初始化读（`docs/known-deviations.md`、`reduce.ts` 的 `insureConfinement` 注释）；物价指数是**日推进**调用（不是每回合）。

改动了旧行为的测试：`rules/bankruptcy.test.ts`、`state/bankruptcy-integration.test.ts`（夹具 0 号改真人、终局码测试补 phase）、
`state/full-game.test.ts`（四人改託管真人，保留「打到只剩一人」的意图）、`rules/rent.test.ts`（分账不再 fround 乘积）、
`rules/toll-flow.test.ts`（敌意先记 ⇒ 电脑嫁禍会挑到地主；把「恨 2 号」调到 50）、`rules/facility-rules.test.ts`（旅館不再记本月损失）、
`state/notice.test.ts`（加油站问免費卡）、`places/stock-market.test.ts`（波动率 f32）、`rules/auction.test.ts`（首座、流拍按调用点）、
`cards/registry.test.ts`（拍賣卡请求带 `clearOnPassIn`）、股票夹具铺 `f10`（`testing/factories.ts` 的 `tradableMarket`）、
`server/auction-acting-seat.test.ts` 换种子（21 → 18）、`client/presentation-order.test.ts` 补一对先后。
服务器镜像：`packages/server/src/econ-audit-mp.test.ts`（收费敌意、真人全出局收局、分紅加总、百貨营业额、股市屏、
樂透投注屏、**AUC-45 拍賣卡两条**）。

★ 合并 `ds/audit-provenance`（其它区已并入）之后**又动过的测试**，逐条说明理由：
- `rules/facility-rules.test.ts`（旅館敌意）：F22 之后旅館不再记 費/100 ⇒ 断言从 `費/100 + 20×天` 改成 `20×天`（原版 VA 见 F22）。
- `state/confinement-audit.test.ts`（events 区的 C-29）与上一条同一个事实，同一个值 —— 两区对同一局面各有一条用例，
  现在都按原版断言；**不是**为了变绿放宽（改前 112、原版 80）。
- `events/event-balance.test.ts`：换种子 43 → 46（本区修复改了随机流，43 那局 **新聞 0** 掉出覆盖；
  重扫 13..120 只有 46 能同时补齐 0 / 2 / 28 / 35）—— 断言一个字没动。
- `state/full-game.test.ts`：**输入与断言都没换**（三个种子仍是 177 / 58 / 230），只更新了那行读数注释。
  它先前红是因为（a）本区把夹具的四位改成「真人 + 託管」（`0x0040d029` 数的是在场真人，见 F11），
  （b）合并进来的魔法屋二级判定漏记牌堆（见跨区 events 那条）—— (b) 修好后三个种子都恢复 3 人出局。
- `state/god-power.test.ts`（events 区）：小財神那两条「前面的人破产、后面的照付」用例，
  2/3 号位开局 `who_plays == 0`（惰性摆人）⇒ 先前收钱循环里**一个对手都没进**（`autoSlot` 掷 0 时还会整条 return）。
  现在把 2/3 号位摆成在场（真人档），用例才真的在验它标题写的那件事；断言本身没动。

---

## 台账

### 过路费（住宅 / 连锁店 / 同盟 / 神明）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| TOLL-01 | 住宅 = 同主人 + 同名 + 住宅 的每块 `rent[level]`（u16）相加 × 物價；遍历 1..num_lands | rules/toll.ts:96 | 0x00419744..0x004197a3、0x004197d8 | verified | 入口是 0x419744（rich4-re 记的 0x419750 在函数体中间） |
| TOLL-02 | 连锁店 = 同主人每家 2000 × 物價 | rules/toll.ts:96 | 0x004197a5..0x004197d6 | verified | |
| TOLL-03 | 涨价位非 0 ⇒ 只翻地主那份 | rules/rent.ts:186 | 0x00419b09 / 0x00419b0f | verified | |
| TOLL-04 | 同盟份 = 对地主的同盟者再算一次（`[地主+0x41]`） | rules/rent.ts:190 | 0x00419aa4 / 0x00419afa | verified | |
| TOLL-05 | 比例 = f32(同盟份 / (翻倍后地主份 + 同盟份)) | rules/rent.ts:226 | 0x00419cbd..0x00419cdd | fixed | 87cd1b2（F2） |
| TOLL-06 | 同盟得 = trunc(总额 × 比例)，扩展精度 | rules/rent.ts:102 | 0x00419f76..0x00419f89 | fixed | 87cd1b2（F3） |
| TOLL-07 | 先付地主、再付同盟；flags 0 ⇒ 进收款人存款 | rules/rent.ts:228 | 0x00419fb4 / 0x0041a003 | verified | |
| TOLL-08 | 神明调整跳表（1 ÷2、2 → 0、5 ×1.5、6 ×2、3/4 不变），32 位回绕 | rules/god-toll.ts:57 | 0x0041d709、表 0x0041d6f1 | verified | |
| TOLL-09 | 调整后为 0 ⇒ 当场收尾 | state/reduce.ts `case 'other'` | 0x00419d7c / 0x00419d7e | fixed | 87cd1b2（F4） |
| TOLL-10 | 收费记敌意 | rules/rent.ts:265 | 0x00419db1 / 0x00419df3 | fixed | 87cd1b2（F1） |
| TOLL-11 | 被动卡门槛：費 ≥ 2000×物價 或 費 > 現金+存款 | cards/passive.ts:189 | 0x00419e01..0x00419e32 / 0x00419e67..0x00419e98 | verified | 两道门槛各判一次（免費卡后用新金额） |
| TOLL-12 | 死神顯靈由他人賠償：第一个在场、god_info 0xe/0xf 的别人 | rules/toll-flow.ts:67 | 0x0040fbb8 | verified | |
| TOLL-13 | 付款人（嫁禍 / 死神之后）是地主或同盟 ⇒ 不付 | state/reduce.ts `finishToll` | 0x00419f30 / 0x00419f40 | fixed | 87cd1b2（F5） |
| TOLL-14 | `[land+0x2c]` = 这一笔（免費卡后为 0） | state/reduce.ts `finishToll` | 0x0041a00b | verified | |
| TOLL-15 | 九种免收（查封两个半字节、同盟、死神 0xf、+0x32..+0x37） | rules/toll-flow.ts:41 | 0x0041d559..0x0041d6e5 | verified | 偏移逐条对过 |
| TOLL-16 | 收费框金额 = 神明调整**前**的总额 | state/reduce.ts `case 'other'` | 0x00419d08 push ebp（在 0x00419d70 之前） | verified | |
| TOLL-17 | 「算进去的地」一起闪（>1 块才闪） | rules/toll.ts:58 | 0x00419b1b..0x00419c83 | verified | 表现 |
| TOLL-18 | 电脑是否用免費卡 / 嫁禍给谁 | rules/toll-flow.ts:85 / :97 | 0x00444a9b / 0x004448b0 | n/a | cards / ai 区，未重开 |

### 设施（旅館 / 購物中心 / 加油站）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| FAC-01 | 别人的設施：等级 0、公園(0)、类型 ≥4（研究所）不收 | state/reduce.ts `settleFacility` | 0x0041a370..0x0041a38f | verified | |
| FAC-02 | 旅館 / 購物中心单价 = `word[+0x24+lv*2]` × 物價，涨价位 ×2 | rules/facility.ts:197 | 0x0041a429..0x0041a44c / 0x0041a485..0x0041a4a8 | verified | |
| FAC-03 | 轉盤倍数（表 0x475d0c） | rules/facility.ts:304 | 0x0043f7da / 0x0043facb | approx | D-003：真人转盘步数与点击时机有关，统一用起点均匀的分布 |
| FAC-04 | 加油站 = 步数 × 500 × 2^((tm&3)−1) × 物價；无交通工具不收不弹 | rules/god-toll.ts:136 | 0x0041a4db..0x0041a529 | verified | 移位链 500k 自算一遍 |
| FAC-05 | 设施敌意 = 調整後費/100（**旅館除外**） | state/reduce.ts `settleFacility` | 0x0041a59e..0x0041a5c0；跳过它的是 0x0041a5d5 `cmp byte [設施+0x18],1 / je 0x41a63d` | fixed | 87cd1b2（F6）+ 合并时补的旅館闸（F22） |
| FAC-06 | 免費卡只有旅館跳过 | state/reduce.ts `settleFacility` | 0x0041a5d5 / 0x0041a5db..0x0041a63b | fixed | 87cd1b2（F7） |
| FAC-07 | 死神：費 != 0 或是旅館 | state/reduce.ts `finishToll` | 0x0041a692..0x0041a6a1 | verified | |
| FAC-08 | 付款人是主人 ⇒ 不付、不记，旅館照住 | state/reduce.ts `finishToll` | 0x0041a709 | fixed | 87cd1b2（F8） |
| FAC-09 | `[fac+0x30]` = 这一笔 | state/reduce.ts `finishToll` | 0x0041a75e | verified | |
| FAC-10 | 旅館敌意 20×天×物價（主语 = 当前玩家 = `c.payer`，对象 = 主人 −1） | state/reduce.ts `finishToll` | 0x0041a78f（天 → 20×天 → ×物價）→ 0x0041a7a8 `[設施+0x19]−1` → 0x0041a7b6 `[0x49910c]` → 0x0041a7bc `call 0x40df69` | fixed | 87cd1b2（F6）；旅館**只有**这一笔（F22） |
| FAC-11 | 住店前 `0x40d761`（出獄 / 出院、清 +0x32 dword） | state/reduce.ts `finishToll` | 0x0041a7c5、0x0040d761 | fixed | 87cd1b2（F10） |
| FAC-12 | `+0x32 = 天−1`（0 → 0x80）；`+0x42 += 天`（8 位） | state/reduce.ts `finishToll` | 0x0041a7e8..0x0041a7fe / 0x0041a83f | verified | |
| FAC-13 | 本月支出不另记住店损失 | state/reduce.ts `finishToll` | xref 0x496bc4（只有 0x0041d381 / 0x00439ee6） | fixed | 87cd1b2（F9） |
| FAC-14 | 保險理賠 2000×天×物價（`push 0` 之后的 `[esp+0xd4]` 就是天数） | state/reduce.ts `insureConfinement` | 0x0041a805..0x0041a82d、0x0044ba63 | verified | D-LEGACY-1 作废 |
| FAC-15 | 住店台词 `0x44f2c2`（4..6 天 `rand()&1`，付款人是当前玩家时） | state/reduce.ts `finishToll`（`who === meNow && 4 ≤ 天 ≤ 6` 处） | 0x0041a7e0（`0x0041a7d3 cmp edi,edx / jne` = 只有住店者**就是当前玩家**才说）→ `0x0044f2f4 cmp edx,3 / jle` → 0x0044f312 `call 0x456f2d` | fixed | ★ 2026-09-25 复核：已由 events 区 **5f14c39**（FU-1）收进 core —— 站点 `SPEECH_SITE.smallLoss`、在 `0x40d761` 之后、写 `+0x32` 之前掷，原值进 `lastSpeechRolls`；客户端只读不掷。**与 exe 逐点一致** |
| FAC-16 | 贴图挪到設施、`+0x15` 置 0x20 位 | state/reduce.ts `finishToll` | 0x0041a85e、0x0040d5a5 | verified | 既有取证 |

### 落点消费（买地 / 加蓋 / 買設施 / 首建 / 加蓋設施）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| PUR-01 | 买地价 = (地價 + 房價×等级) × 物價 | rules/land.ts:66 | 0x0041a034..0x0041a050 | verified | |
| PUR-02 | 买地闸：夢遊 → god_info 0xc → 價 > 現金（jg） | rules/land.ts:112 | 0x0041a013..0x0041a059 | verified | |
| PUR-03 | 电脑买不买：現金+存款−價 > min(trunc(開局×0.05),7000)×物價 | rules/purchase.ts:166 | 0x0041d7d4..0x0041d832 | verified | |
| PUR-04 | 真人问 YES/NO（who_plays==1），其余 `&6` 走电脑判定 | ai/policy.ts / reduce | 0x0041a078..0x0041a0ba | verified | |
| PUR-05 | 决定之后才过衰神闸（god 7/8/15），名字表按 god_info 直接取 | rules/purchase.ts:86 | 0x0040fa61..0x0040facc | verified | |
| PUR-06 | 买地：写 owner → 到期日 → 扣現金（不走 pay_money） | state/reduce.ts `case 'buyLand'` | 0x0041a0d7..0x0041a132 | verified | |
| PUR-07 | 买地 / 加蓋（未满 5 级）/ 首建 / 買設施 之后走福神 `0x40f8be` | state/reduce.ts `luckyGodBonus` | 0x00419a48 | verified | 既有取证抽查 |
| PUR-08 | 加蓋闸：等级 <5、住宅、没夢遊、房價×物價 ≤ 現金 | rules/land.ts:144 | 0x00419911..0x00419951 | verified | |
| PUR-09 | 电脑加蓋不判价值（`&6` 直接到衰神闸） | ai/policy.ts | 0x00419976 | verified | |
| PUR-10 | 剛到 5 级不走福神、播 0x20b | state/reduce.ts `case 'upgradeLand'` | 0x004199eb..0x00419a26 | verified | |
| PUR-11 | 買設施：價 = `+0x22`×物價，夢遊 / 0xc / 現金闸，电脑 0x41d7d4 | state/reduce.ts `landOnFacility` | 0x0041a86b..0x0041a984 | verified | |
| PUR-12 | 首建：價 = `+0x22`×物價；真人选种类，电脑 `rand()%4+1` | state/reduce.ts `landOnFacility` | 0x0041a1fc..0x0041a257 | verified | |
| PUR-13 | 首建被衰神挡：种类已写、等级与钱不动 | state/reduce.ts:3128 `withFacilityType` | 0x0041a239 / 0x0041a257 → 0x0041a261 | fixed | ef0482c（F21） |
| PUR-14 | 加蓋設施：價 = `+0x24`×物價；上限表 0x474940 = [1,5,5,1,5]；电脑不判 | rules/facility.ts:394 | 0x0041a2b3..0x0041a36b | verified | |
| PUR-15 | 只差現金 ⇒「您的現金不足！」1500 ms | state/reduce.ts `cashShortLanding` | 0x00419a52 / 0x0041a159 | verified | |
| PUR-16 | 街區台词 `0x44f627`（加蓋那支 `rand()%3`） | state/reduce.ts `case 'upgradeLand'` 的 `speechDrawOn(SPEECH_SITE.areaMonopoly, …)` | 调用点 0x00419a31 `push 1 / call 0x44f627`（在 `0x00419a48 call 0x40f8be` 福神之前）→ 同名地 ≥3 时 0x0044f67b `call 0x456f2d / idiv 3` | fixed | ★ 2026-09-25 复核：已由 events 区 **5f14c39**（FU-1）在 core 掷、且正好在福神那一步**之前**；`%3` 的判据仍在客户端（读原值），与 exe 的 `test edx,edx / jne` 同义 |

### 付款 / 破产 / 终局

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| PAY-01 | `pay_money`：企業付款不判破产；玩家两级级联，都空则削减实付并破产 | rules/payment.ts:149 / :188 | 0x0041d2c6..0x0041d37b | verified | |
| PAY-02 | flags bit0 进現金 / 否则进存款；bit2 先扣存款 | rules/payment.ts:188 | 0x0041d2f6 / 0x0041d3b2 | verified | |
| PAY-03 | 付款人 `+0x5c` += 实付，收款人 `+0x60` += 实付；公库 −1、企業 >100 | rules/payment.ts:188 | 0x0041d381 / 0x0041d3ca / 0x0041d38c / 0x0041d3a5 | verified | |
| PAY-04 | `give_money` 只加不扣 | rules/payment.ts:286 | 0x0041d3f4 | verified | |
| PAY-05 | 破产发生在**收款人入账之前**（清算拍卖期间收款人还没拿到这笔钱） | state/reduce.ts `settleTransferCredit(s)`（`{kind:'credit'}` 队列项）；`rent.ts` 的 `credits` / `npc-walk.ts` 的 `credits` | 0x0041d376 `call 0x40cd87` 早于 0x0041d387 的收款分支（`0x40d1e3 call 0x43bde5` 阻塞） | fixed | follow-up 收尾（见 F28）。`transferMoney` 新增 `deferCredit`（缺省关，只有能破产的调用点打开）；玩家收款方（过路费地主/同盟、設施主人、神明的对手、惡人主人）走延后入账；公库/企業收款在拍卖期间不可观测，仍即时入账（等效） |
| BKR-01 | 已出局再破产不做事 | state/reduce.ts:9156 | 0x0040cda6 | verified | |
| BKR-02 | 贴图坐标按所在格重同步；占用表两格清 | state/reduce.ts:9156 | 0x0040cdb0..0x0040ce28 | verified | |
| BKR-03 | 释放 +0x3f / +0x40 附着物件；解盟 | state/reduce.ts:9156 | 0x0040ce2e..0x0040ce7e | verified | |
| BKR-04 | memset +0x1c..0x67 | rules/bankruptcy.ts:95 | 0x0040cf20 | verified | |
| BKR-05 | 别人对破产者的敌意清零 | state/reduce.ts:9156 | 0x0040cf47..0x0040cf6b | fixed | 442dd02（F12） |
| BKR-06 | 单人类局真人出局 ⇒ 「輸了」框收局 | rules/bankruptcy.ts:198 | 0x0040cfdb..0x0040cff8 | fixed | 442dd02（F11）；框选「读档」返回 4 未复刻（同 victoryEndCode） |
| BKR-07 | 在场真人 = 0 ⇒ 码 1；只剩 1 人 ⇒ 2/3；否则清算 | rules/bankruptcy.ts:198 | 0x0040d008..0x0040d084 | fixed | 442dd02（F11） |
| BKR-08 | 清算：地块 / 設施 owner=0、到期日=0、等级留；企業名头清 | state/reduce.ts:9156 | 0x0040d089..0x0040d137 | verified | |
| BKR-09 | 持股全卖（进公库）、道具 / 卡变卖 | state/reduce.ts:9156 | 0x0040d143..0x0040d196 | verified | |
| BKR-10 | 樂透号码只在清算那条路释放 | state/reduce.ts:9156 | 0x0040d1a8..0x0040d1c4 | approx | 本引擎两条路都放；终局那条已结束对局，无可观测差别 |
| BKR-11 | 释放 >3 处才拍 3 场，`rand()%n` 抽到空槽重抽 | state/reduce.ts `drawBankruptcyAuction` | 0x0040d1c6 `cmp esi,3 / jle` / 0x0040d1f7 `call 0x456f2d / idiv esi` / `test dx,dx / je 0x40d1f7` | verified | 抽签与拍卖**交错**的次序见 AUC-43 |
| BKR-12 | 回合主人位置 0x498e30 的 4 条 NPC 记录（`0x43d593` / `0x43ec3f`） | — | 0x0040ce86..0x0040cefd | n/a | 探監 / 探病 NPC，不是钱的规则，交 loop / npc |
| VIC-01 | 两条都 0 不判；在场首富（严格大于才换） | rules/victory.ts:98 | 0x0041d8a4..0x0041d8e7 | verified | |
| VIC-02 | 首富资产为 0 时跳过天数条件；天数 `目标 <= 已过`；金额 `>=` | rules/victory.ts:98 | 0x0041d8e9..0x0041d90f | verified | |
| VIC-03 | 收尾只清 who_plays；终局码按开局真人数与赢家 bit0 | rules/victory.ts:66 / :159 | 0x0041d951..0x0041d9ad | verified | |

### 身家 / 物价指数 / 點券 / 取整 / 地块状态

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| WLT-01 | 身家 = 現金 + 存款 − 貸款 + Σ持股×f20（每支 trunc(市值 + f32(总)）) + 地产 + 設施 | rules/wealth.ts:68 | 0x004239b9..0x00423ac4 | verified | 连锁店加一份房價不乘等级 |
| WLT-02 | 身家 32 位整数（>2^31 回绕 / `fistp` 溢出落 `0x80000000`） | rules/wealth.ts:68（`\|0` 累加 + `fistpInt32`） | 0x004239c7..0x004239db（口袋 32 位加/减）、0x00423a17 `fistp dword [esp]`、0x00423a4a `add ebp,ecx`、0x00423ac4 `mov eax,[esp] / ret` | fixed | follow-up 收尾（见 F31）。越界 ⇒ `0x80000000` 由**原版真码**（Unicorn 跑 `0x4239db..0x423a20`）实测确认：`INT_MAX+1 → INT_MIN`、`1000×3e6 → INT_MIN`、`1000×2e6 → 2000000000` |
| IDX-01 | 物价指数 = (在场身家合计 idiv 人数) idiv 開局資金，只升不降，**每日**推进 | rules/wealth.ts:157 | 0x00423acf..0x00423b1b、调用 0x0041cfbf | verified | |
| IDX-02 | 合计 32 位回绕 | rules/wealth.ts:157 | 0x00423af5 add esi, eax | fixed | 16790f5（F13） |
| PTS-01 | 點券是 16 位字段 | rules/points.ts:39 | 0x0041b1d7 / 0x0042d25c / 0x0042d204 | verified | |
| RND-01 | `0x457dbc` 向零截断（RC=11、PC 不变） | rules/rounding.ts:70 | 0x00457dbc | verified | |
| LMU-01 | 涨价 / 查封高 nibble 每天 −0x10，到 0 清整字节 | rules/land-mutation.ts:158 | 0x0041d114..0x0041d129 / 0x0041d160..0x0041d175 | verified | |
| LMU-02 | 地契到期 == 今天 ⇒ 无主 + 清到期日（房子留着） | rules/facility.ts:364 | 0x0041d12d..0x0041d143 / 0x0041d179 | verified | |
| LMU-03 | 地契年限表 [0,0x20000,0x10000,0x600,0x300,0x100]、日期相加月进位 | rules/facility.ts:328 / :341 | dump 0x004751f0、0x004521cb | verified | |
| LMU-04 | 拆除 / 涨价 / 查封卡的写法 | rules/land-mutation.ts:75 / :111 | 0x00443c0c / 0x004454ef / 0x00445659 | n/a | cards 区（见跨区：拆除 0 级回绕） |
| PCT-01 | 新聞所得稅 / 地價稅 / 證交稅 / 儲金紅利 | rules/percentage.ts | 0x00449cfa / 0x00449f28 / 0x0044a122 / 0x0044af50 | n/a | events 区，未重开 |

### 企業落点 / 股市（助手 STK 取证 + 我抽查）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| STK-01 | 96×36 字节行情表 | data/stocks.ts:51 | 0x0047f072 | verified | 逐字节比过 |
| STK-02..03 | 每图 12 支；开局三个价同值、趋势/冲击 0 | places/stock-market.ts:215 | 0x428cbc / 0x40743a | verified | |
| STK-04 | 波动率是 float32 | places/stock-market.ts:234 | 0x00429266 | fixed | 16790f5（F13） |
| STK-05 | 股票绑企業（原版无 break、最后一个命中；8 张图都是一一对应） | places/stock-market.ts:196 | 0x00428caf | approx | 结果相同 |
| STK-06..07 | 企業保留股、每日可成交量 `rand()%2000+1000` | rules/new-game.ts:190、places/stock-market.ts:525 | 0x00407dce、0x0042915a..0x004291ce | verified | |
| STK-08..11 | 停牌 / 新聞 nibble / 休市计数；休市日不动价、不掷 rand | places/stock-market.ts:460..602 | 0x0041d003..0x0041d064、0x0041cfc9、0x004291e2 | verified | |
| STK-12..18 | 漂移、冲击、均值回归（3.0/0.85、8.0/0.5）、夹 ±10 | places/stock-market.ts:265..365 | 0x004291f0..0x0042940d | verified | |
| STK-20 | 价位档与步长、上下界 1..9999 | places/stock-market.ts:100..146 | 0x00428ec5..0x00429030 | approx | T-STOCK-1（fprem 精度）既有登记 |
| STK-22..25 | 144 日历史环、新聞改收盘、漲跌停状态 | places/stock-market.ts:373..570 | 0x0042944f..0x00429690 | verified | |
| STK-23 | 大盘指数 = trunc(Σ收盘×10)，乘积不压 f32 | places/stock-market.ts:382 | 0x004294b9..0x004294c7 | fixed | 16790f5（F13） |
| STK-26..32 | 柜台买（存款）/ 从企業认购（現金）、均价、卖（进存款或公库）、重排名次 | places/stock.ts:127..310、places/commercial.ts:78 | 0x00428d2a..0x00428eb7、0x004294d5 | verified | STK-30 卖超护栏是既有有意偏离（approx） |
| STK-33 | 柜台买入上限 min(f10, trunc(存款÷價)) | state/reduce.ts `tradeStock` | 0x0042af43 / 0x0042af66 | fixed | 49b2897（F17） |
| STK-34..37 | 停牌 / 漲停 / 跌停 / 休市不开柜台；无手续费 | state/reduce.ts `tradeStock` | 0x0042aef4..0x0042b6b4 | verified | |
| STK-39..42 | 企業认购闸与上限 min(1000, 現金÷單價, 餘量)、电脑股数、易主框 | places/company.ts:207..256 | 0x0041d1c6..0x0041d2aa、0x0041d839 | verified | |
| STK-43..44 | 各行業收费、费名表 | places/company.ts:49..152 | 0x0041ab6d..0x0041ae34、0x0047528e / 0x0047528b / 0x0047517c | verified | |
| STK-45 | 别人的建設公司没地可蓋 ⇒ 1000×物價 | state/reduce.ts `landOnCompany` | 0x0041adff..0x0041ae1a | fixed | 01e4bb9（F15） |
| STK-46..49 | 工程費 = 地價×物價；自家公司蓋两次；电脑挑地 | state/reduce.ts / places/company.ts:293 | 0x0041adb9、0x0041aae8 / 0x0041aafb、0x0040b455 | verified | |
| STK-50 | 真人选地窗的候选筛选（全图地块/設施）、右键取消交回 0、蓋不成也收工程費、选中等级 0 的設施先选种类 | state/reduce.ts `chooseBuildTarget` | 0x00446ae8(0x2090086) → 0x00445ee6；0x004466c6；0x0041ad28 je 0x41adff；0x0041ad7e call 0x40b110 | fixed | aac1ed5 |
| STK-51 | 保險 / 航空轉盤 | rules/facility.ts:304 | 0x0044090e | approx | D-003 |
| STK-52 | 企業费进企業（100+id），不是董事長 | state/reduce.ts `payCompany` | 0x0041b022 | verified | 收费尾巴与住宅同构（免費卡问地主 −1、嫁禍、死神）已对过 0x0041aec5..0x0041b022 |
| STK-53..55 | 分紅比例 f32、乘积不压 f32、有人持股才清盈餘 | places/company.ts:352 | 0x0042bc0a..0x0042bd42 | fixed | 16790f5（F13，乘积）；其余 verified |
| STK-56 | 分紅按人加总、每人结一次 | state/reduce.ts:5722 | 0x0042bce3、0x0042be6d..0x0042bec3 | fixed | 01e4bb9（F14） |
| STK-57 | 分紅破产当场清算（变卖进公库、拍卖），早于開獎 / 月结 / 地契到期 | state/reduce.ts `applyDividendLoop` + `finishDayRollover`（`{kind:'dayRolloverTail'}`） | 0x0042beba `call 0x40cd87`（在 0x0041d094 開獎 / 0x0041d09e 月結 / 0x0041d0ff 地契扫之前） | fixed | follow-up 收尾（见 F29）。推日期拆成「分紅逐人结 + 剩下半段」，清算挂出拍卖时把尾段挂进队列，由拍卖链收尾回调。回归：`day-advance.test.ts` 的 STK-57 两条 |
| STK-58..62 | 15 日分紅在開獎前；电脑还贷压力卖股；新局首日 tick；出局判据 `&3` | places/company.ts:400、places/stock-market.ts:617 | 0x0041d080..0x0041d094、0x0042c7bc | verified | STK-62 approx（可达值相同） |
| STK-63 | 百貨营业额进百貨企業盈餘 | state/reduce.ts:7615 | 0x0042ed57..0x0042ed7e | fixed | ef0482c（F21） |

### 樂透（助手 LOT 取证）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| LOT-01..08 | 36 个号、表存 下标+1、落点、夢遊跳过、真人判据 ==1、票价 1000 不乘物價、真人 現金 ≥1000 | places/lottery.ts:19..71 | 0x004316b1、0x0042fff0、0x004315da、0x0042f8d7 | verified | |
| LOT-09 | 真人現金 <1000 也开投注屏（說 #0015 / #0016 后关 = 不买） | state/reduce.ts `landOnLottery`、client `declineDecision` | 投注窗 0x004315e7..0x00431653 `call 0x4018e7` 先开；窗里 WM_CREATE 0x0042f8d7 `cmp [現金],0x3e8 / jge`，否则 0x0042f8e3 状态 4 → 0x0042fae5 状态 5 → 0x0042faf8 关窗（返回 0） | fixed | d286ade；服务器镜像见 `econ-audit-mp.test.ts` |
| LOT-10..20 | 只能买未售号、不限张数、直接扣現金进公库、一次一张；电脑 現金 >1000、`未售[rand()%n]` | places/lottery.ts:127..194 | 0x0042ff1d、0x0043000e、0x0043169e..0x00431700 | verified | |
| LOT-21..23 | 日期推进后的 15 日開獎；达标当天不開；顺序 行情→分紅→開獎→月结 | state/reduce.ts `advanceGameDay` | 0x0041cfa1、0x0041d080..0x0041d09e | verified | |
| LOT-24 | 分紅破产者的号码不参加当天開獎 | state/reduce.ts:5722 | 0x0042beba → 0x0040d1a8，早于 0x0041d094 | fixed | 01e4bb9（F14） |
| LOT-25..34 | 无人买不开、>10 张只在售出号里抽、`rand()%36`、奖池全给、赢了清表、没人中就滚存 | places/lottery.ts:297..328 | 0x00431716、0x00430b2a..0x00430b77、0x00430ac4..0x00430af3 | verified | |
| LOT-35..36 | 多人中奖 / 取整 | — | — | n/a | 一号一主，只有整数加法 |
| LOT-38..40 | 显示号码、开奖屏状态机、屏上奖池 | places/lottery-ceremony.ts | 0x00430b7a、表 0x004300d0 | verified | 表现 |
| LOT-41 | 原版关屏时才发奖 | state/reduce.ts | 0x00430ab5 | approx | 模态屏，中间没有别的东西变 |
| LOT-42 | `srand(GetTickCount)` 在行情 / 開獎之前 | rng/host-reseed.ts | 0x0041d06e | approx | 既有登记（重播口径） |
| LOT-43 | 两个樂透屏的表情动画按计时器调 `rand()` | — | 0x0042fb2a 等 | approx | 时序相关，不可复现 |

### 銀行 / 月结 / 日历（助手 BNK / MON 取证）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| BNK-1..6 | ATM 存 / 提、暫停放款只能存、拒絕往來框、路过与落点入口、真人判据 ==1 | places/bank.ts:30 / :45、state/reduce.ts `bankAtmEntry` | 0x00437856 / 0x00437827 / 0x00436fdd / 0x004379da / 0x0041b550..0x0041b5ab / 0x00437a18 | verified | BNK-1「输入 0 关窗」为 UI 流程（approx） |
| BNK-7..8 | 电脑重分目标比例（×1.5 / ×0.5 / 夹 0.1..0.9）、±0.25 带内不动 | places/bank.ts:242 / :283 | 0x00437ad3..0x00437c03 | verified | 总额 ≤0 提前返回（approx，Q-BANK-3） |
| BNK-9..10 | 貸款额度 = 进门身家快照 − 貸款；借到就定还款日 | places/bank.ts:68 / :99 | 0x0043668f、0x00435228..0x0043526d | verified | |
| BNK-11 | 还款超过 現金+存款 拒收 | places/bank.ts:136 | 0x0043537e..0x0043538e | fixed | 49b2897（F16） |
| BNK-12..16 | 还款日 +90 天避开周日节日、到期提醒 / 强制还款、电脑还款与借款闸 | places/bank.ts:305..441 | 0x00433b7e、0x00436a5a..0x00436b06、0x004367ab..0x004368e3 | verified | 貸款**不计息**（+0x24 全 exe 只有 6 处写） |
| BNK-17 | 电脑借款额 = imul32(比例, 身家)/100（只拦 **0**，负身家照算） | ai/personality.ts:94 | 0x004368e9..0x00436912：`imul edx,[0x48c3b0]` / `idiv 100` / `0x004368fc mov [+0x24],eax` / **0x00436902 `test eax,eax / je 0x436953`**（只拦 0）/ `0x00436906 add [+0x20],eax` | fixed | ★ 2026-09-25 复核：早已由 **32ef122** 修掉（`wealth <= 0` 那一拦删了）；本分支重开 VA 确认「只拦 0、负数照写进贷款与存款」，`autoLoanAmount` 与 `personality.test.ts` 的负数用例一致 |
| BNK-18..20 | 特別融資：董事長 = 銀行企業主、额度 = 别人存款合计、还款闸 | places/special-finance.ts:118..177 | 0x00436711、0x00434571..0x004346bb | verified | |
| BNK-21 | 電腦重分之后查準備（模式 1） | state/reduce.ts:6863 | 0x00437c12 | fixed | 9c1c8a8（F20） |
| BNK-22 | 真人关股市屏（三种模式）/ 关公佈欄后强制收回特別融資（模式 0） | state/reduce.ts `sweepSpecialFinance`、新增 action `stockScreen` | 0x0042b58f 三个入口 → 0x0042ba86 push 0 / 0x0042ba88 call 0x436b0a；0x0042885e | fixed | 7993aef（新 action `stockScreen`：协议变化，由协调人统一 +1） |
| MON-1..9 | 月结：存款 ×1.1 向零（有貸款不给）、悲情人物 / 冠軍评分与门槛、奖项不动钱、清 +0x42/+0x5c/+0x60 | rules/monthly.ts:60..302 | 0x004381f8..0x00438212、0x00437d43..0x00437e2e、0x00439ec4 | verified | |
| MON-11 | 物价指数 32 位合计、每日 | rules/wealth.ts:157 | 0x00423af5 | fixed | 同 IDX-02 |
| MON-12..15 | 月数、日期推进 / 闰年、星期、节日表（8 图逐字节） | rules/calendar.ts、places/calendar.ts | 0x00452117、0x00451f8c..0x004521aa、0x004523d5、0x0047ff4a | verified | |
| MON-16 | 节日查找跳过 bit 0x80 的记录 | places/calendar.ts:333 | 0x004523b3 `test byte [记录+0x47ff4a],0x80 / jne 0x452205` | fixed | 32ef122（地图 0 的 10/31 取 13 号） |
| MON-17 | 每月重摆禮物 / 寶箱 | rules/monthly-objects.ts | 0x0041d0a3..0x0041d0f6 | n/a | loop 区已在 ds/audit-provenance 修（9b59144），本分支合并得到 |
| MON-18 | 农历节日覆盖比较值 | places/calendar.ts:337 | 0x00452285 | verified | 各图都无影响 |

### 拍賣（助手 AUC 取证）

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| AUC-01..04 | 五个调用点的 arg0（卡 = 用卡者、魔法屋 = 中签者、新聞 7 / 破产 = −1 进公库） | cards/registry.ts、state/reduce.ts | 0x0044334f / 0x00443476 / 0x004324d5 / 0x004498a1 / 0x0040d1e3 | verified | |
| AUC-05 | 起拍价 = trunc(地價×(1+等级×0.5))×物價 | rules/auction.ts | 0x0043be37..0x0043be8d | verified | |
| AUC-06..11 | 座位：出局 / 現金 ≤ 起拍 / 被关着 / 发起者 不上座；心理价位只给 `&6` 的在座者 | rules/auction.ts | 0x0043c11f..0x0043c23c、0x0043c5e3 | verified | |
| AUC-12..13 | 系数与缺地系数存成 f32 | rules/auction.ts:566 | 0x00439f3b / 0x00439fc7 | fixed | 16790f5（F13；ai-econ 同改） |
| AUC-14..19 | 同名数、v1/v2、取 min(v1,v2,現金)、每家两次 rand | rules/auction.ts:566 | 0x00439f72..0x0043a13f | verified | |
| AUC-20 | 开场席位 = 最后一个在座者 | rules/auction.ts:844 | 0x0043af13..0x0043af45 | fixed | a52570e（F18） |
| AUC-21 | `(座位+1)&3` 绕圈 | rules/auction.ts | 0x0043b3c2 | verified | |
| AUC-22 | 出价时真人判据是 `who_plays == 1`（带 0x10/0x20 的真人走电脑支） | rules/auction.ts `auctionSeatWaitsForHuman`（core / 拍賣屏 / 服务器共用） | 0x0043b001 `cmp byte [p+0x15],1 / jne 0x43b0a0` | fixed | f4ed239（F24） |
| AUC-23 | 真人現金 < 现价自动弃权 | rules/auction.ts `auctionSeatWaitsForHuman`、ai/policy.ts `auctionNextBid` | 0x0043b06c `/ jle 0x43b08a`，否则 0x0043b07a 按钮 6「放棄」 | fixed | f4ed239（F24） |
| AUC-24..33 | 电脑加价档、夹到最高者現金+500、只剩一席、真人加价闸、加价后全体复活、PASS / 弃权、落槌判据 | rules/auction.ts:640..1059、state/reduce.ts `auctionBid` | 0x0043b10c..0x0043b2fd、0x0043a426..0x0043a6c7、表 0x00475ba2 | verified | |
| AUC-34 | 全员不能出价但有最高者 ⇒ 成交 | rules/auction.ts `auctionOutcome` | 0x0043b2cd `push 0x465063`（只说「無人出價」）→ 状态 0xb（0x0043aee2）→ 0x0043b5ce `push [0x48c4a8] / call 0x401966` | fixed | f4ed239（F25）；正常对局只由外部塞进来的 pending 触发（README §「外部审查」同条） |
| AUC-35..39 | 窗口返回 −1 不写；得标者≠原主才写 owner；到期日三道闸；`pay_money(得标者, arg0, 价, 0)` | rules/auction.ts:283 | 0x0043c71d..0x0043c855 | verified | |
| AUC-40..42 | 流拍收尾按调用点 | rules/auction.ts:283、state/reduce.ts `settleAuctionExplicit` | 0x0044335b / 0x0044335f / 0x0044348a、0x004324da、0x004498a6、0x0040d1e8 | fixed | ab76320（F19） |
| AUC-43 | 破产拍卖：抽一处就开拍一场（拍卖里还要掷 rand），再抽下一处 | state/reduce.ts `drawBankruptcyAuction` / `chainQueuedAuction`（`{kind:'bankruptcyDraw'}`） | 0x0040d1f7 `call 0x456f2d / idiv esi` ↔ 0x0040d1e3 `call 0x43bde5` | fixed | follow-up 收尾（见 F27）。先前先抽 3 处再排队 ⇒ 随机流次序不同；现在第 1 抽当场做，第 2、3 抽挂成队列项、由前一场落槌后接上。回归：`bankruptcy-integration.test.ts` 的「抽签与原版同序」（拿交错模型逐位对 `rngState`，旧次序在该夹具上是 2,5,3 / 现为 2,4,5） |
| AUC-44 | 候选表：地块升序在前、設施升序在后 | state/reduce.ts:9156 | 0x0040d095..0x0040d109 | verified | |
| AUC-45 | 拍賣卡用完之后回合相位（卡返回 1，不结束回合） | state/reduce.ts `settleAuctionExplicit`（按 `pending.resumePhase`）、`playCard` | 卡尾 0x0044336b `mov ebx,1`（`jmp 0x443496` 那一条是**函数出口**，两条分支都汇到这里；成功/流拍只分 `0x00443357 test eax,eax / jne` → 0x0044335b 清地主）；电脑支 0x00418e21 `call 0x441baa` → 0x00418e75 `call 0x40dd1f`；真人支选卡面板 0x00441c90 起（`0x00441cc6 call [卡号*4+0x475d5c]`）→ 0x00441ce1 `test esi,esi`（返回非 0 才走、返回 0 回选卡屏）；回合函数 0x418ebd 对卡返回值**不做任何判断** | fixed | f6af0f1（F23）；服务器镜像见 `packages/server/src/econ-audit-mp.test.ts` |
| AUC-46 | 加价额只能是档位表里的值 | state/reduce.ts `auctionBid`（`AUCTION_RAISE_STEPS.includes`） | 0x0043a49b `add eax,[ebx*4 + 0x475ba2]`；表 dump 0x475ba2（40 字节）= 100 / 500 / 1000 / 5000 / 10000 | fixed | f4ed239（F26）；`rules/auction.test.ts` 已钉（300 被拒 / 500 收） |
| AUC-47 | 拍賣卡敌意 = double 压栈的低 dword | rules/auction.ts | 0x00443286..0x004432c6 | verified | |
| AUC-48 | 排队开拍在调用点之后才开（调用点之后若还掷 rand 会错位） | state/reduce.ts `chainQueuedAuction` | 0x0043bde5 阻塞 | follow-up | 未逐个调用点追；与 AUC-43 同源 |
| AUC-49 | `eligibleBidders` 的 seller === undefined 支 | rules/auction.ts | — | n/a | 死代码 |

---

## Follow-up（未修，附证据）

> 台账里 status = `follow-up` 的只有下面第 1 条（AUC-48）；第 2 条是实现层面的已知偏差，不是某条规则的读法分歧。

1. **AUC-48** 排队开拍与调用点之后的 `rand()` 次序：**魔法屋**那一条多中签者的路（`0x4324d5` 每位中签者一场）
   在 exe 里是 `0x43bde5` **阻塞**连打 —— 第 1 场打完才轮到第 2 位中签者的效果；本引擎一次只挂一场，
   第 2 位中签者的效果（以及它的 `rand()`）跑在第 1 场**开拍**之后、**落槌**之前。
   状态可见的差别：第 2 场开拍时的心理价位按「第 1 场**还没付款**」的現金算（`auctionAiLimit` 的最后一道夹
   `0x43a131 cmp/夹 [0x496b84]`），而 exe 里第 1 场的得标者已经付过钱。
   要修得让魔法屋的逐人中签循环**中途挂起**（把 `applyMagicHouse` 的 `ti` 游标、`beats/notices` 一起挂进
   `pendingQueue`），改动面与 STK-57 同量级但牵动表现层的分段演出 —— 这一轮先不动，等协调人定夺。
   ★ 单场调用点（拍賣卡 `0x0044334b`、新聞 7 `0x004498a1`、破产清算 `0x0040d1e3`）**没有**这个问题：
   调用点之后没有别的 `rand()`，而且清算那一串的抽签次序已按 AUC-43 修好。

2. **（实现备注，不是规则分歧）嵌套清算的下线拍卖次序**：一场清算拍卖的得标者若因付款当场破产
   （出价可以到「他出价时的現金 + 500」，见 AUC-24..33），exe 里那一串新拍卖**嵌在**外层第 1 场收官处、
   外层第 2、3 场**之前**（`0x43c855 call 0x41d2c6` → `0x40cd87` → 又一轮 `0x40d1e3`）；
   本引擎按 FIFO 追加到外层队列**之后**。触发面很窄（得标价必须超过他的現金，且他名下 >3 处产业），
   且不改变任何一方的钱数，只改两串拍卖的先后 ⇒ 登记为已知偏差，未修（要修得把队列改成栈语义，
   而「拍卖链」与「续办项」的优先级规则（F27/F28/F29）也要跟着重排）。

（AUC-43 / PAY-05 / STK-57 / WLT-02 / BNK-17 / FAC-15 / PUR-16，以及更早的 AUC-45、AUC-22 / AUC-23 / AUC-34 / AUC-46、
BNK-22、LOT-09、STK-50、MON-16 都已修掉，从本表移出，见上表对应行与「后续修复」表。）

## 跨区

- **cards**：拍賣卡（`cards/registry.ts`）为 F19 只加了一个 `clearOnPassIn: true` 标志。
  ★ **AUC-45（卡后相位）已由本区在协调人的集成分支上解决 —— 请 cards 不要重复修**：
  回合函数 `0x418ebd` 对卡返回值**不做任何判断**（电脑支 0x00418e75 `call 0x40dd1f` 在出牌循环之后无条件走；
  真人支选卡面板 `0x00441c90` 的返回只决定「回选卡屏还是往下走」，与回合相位无关），
  相位回跳由 core 的 `pending{auction}.resumePhase` 承担（f6af0f1）。相关 VA 见 AUC-45 行。
  拆除卡 `0x00443c0c dec byte [land+0x1a]` 无下限 ⇒ 0 级会绕成 255，`demolishLand` 夹在 0（调用方大概只挑 >0 的地，请确认）。
  设施免費卡现在在購物中心 / 加油站也会问（F7），真人那一问与电脑 `aiUsesFreeCard` 的判定仍归 cards。
- **ai / ai-econ**：BNK-17 已由 32ef122 修（本分支复核 VA 后改标 `fixed`，未再动码）；F17 之后柜台对**真人**多了 `trunc(存款÷價)` 一道，电脑那一支（`0x0042c716` 只夹 f10）不受影响。
  F20 与 ai-econ 修的是同一处，已合并。
- **loop / npc**：破产里 0x498e30 那 4 条记录（`0x43d593` / `0x43ec3f`）不在本区。
  ★ 2026-09-25：`endTurn` 惡人段那条出口（`state/reduce.ts`，loop 区的地盘）按本区的要求改成「是清算拍卖就留着」
  （F30）—— 触发它的正是本区的 `applyBankruptcy`（惡人收費 → `pay_money` → `0x40cd87`）。loop 区如另有安排请以此为准。
- **events**：`percentage.ts` 的四条新聞税额与 `fortune` 金额未重开。
  ★ 合并 `ds/audit-provenance` 时发现两区**互相踩到**，两处都在本分支按原版修掉（不在 events 区重复修）：
  （a）旅館的 費/100 敌意（F22，见 AUC-45 那一节与 FAC-05/FAC-10）：events 区的 C-29 用例
  `confinement-audit.test.ts` 期望 80、本区修前是 112 —— 原版 `0x0041a5d5 je 0x41a63d` 让旅館跳过那句，
  两个用例（C-29 与本区 `facility-rules.test.ts`）现在都按「旅館只有 20×天×物價」断言；
  （b）魔法屋的關押/住院两支过「免罪(21) → 嫁禍(19)」二级判定后**只改手牌**、
  没把用掉的卡记回牌堆（`conserveCardPool`）⇒ 长局的「牌堆 + 四人手牌 ≡ 開局」不变量会红
  （full-game.test.ts 的哨兵在 seed 177 的 step 8680 抓到）。已在 `reduce.ts` 的魔法屋出口按守恒补记。
  ★ 2026-09-25（follow-up 收尾）：FAC-15 / PUR-16 这两处台词 `rand()` 已由 events 区 5f14c39（FU-1）收进 core，
  本区复核后改标 `fixed`；**没有**再动 events 的代码。
- **cards**（follow-up 复核时顺手查的，**不是** bug，仅备查）：`cards/registry.ts` 的購地卡两条付款点与
  `cards/tax.ts` 的查稅卡付款点都**不看** `bankrupted`。逐一核过：购地卡闸是「價 > 現金 ⇒ 拒」（`0x004423b5`，
  `applyBuyLandCard` / `applyBuyFacilityCard` 同），查稅卡金额是 `trunc(現金 × 0.2)` ⇒ 付款方**不可能**被打穿
  （`rules/payment.ts` 的级联只在 `cash + bank < amount` 时才置 `bankrupted`）。故这三处**不需要** PAY-05 的延后入账。
  若日后 cards 改了这两道闸（或新增「付得起的上限不是現金」的挪钱效果），要一并接上 `deferCredit`。
- **全局**：单机 / 联机都走同一个 `reduce`；新增的服务器镜像见 `packages/server/src/econ-audit-mp.test.ts`
  （AUC-45 两条：成交与开拍即流拍，都断言服务器与镜像的 `stateFingerprint` 与 `actingSeat` 一致；
  follow-up 收尾再加三条：PAY-05+AUC-43 合一、STK-57、惡人段里破产）。

## 门禁

`pnpm typecheck && pnpm lint && RICH4_WORKSPACE=/Volumes/Kingston/大富翁4重制版 npx vitest run packages/core packages/server packages/client`
—— 全绿：**372 个测试文件 / 8065 条用例、0 skipped**（`RICH4_WORKSPACE` 已设，原版素材找得到）。
合并前本分支自己的基线是 7995 条（366 个文件），合并进来的其它区（ai-move / ai-econ / cards / events / loop）带来 70 条。
另：本区新增的服务器镜像 `econ-audit-mp.test.ts` 从 6 条加到 8 条（AUC-45 成交 / 开拍即流拍）。

★ 2026-09-25 follow-up 收尾（`ds/fu-econ`）后的门禁：同一串命令 **全绿：373 个测试文件 / 8100 条用例、0 skipped**
（比上一行多 1 个文件 / 35 条：本区新增 `day-advance` 的 STK-57 两条、`npc-round` 的惡人段破产一条、
`bankruptcy-integration` 的 AUC-43 同序与 PAY-05 各一条、`wealth-f32` 的 WLT-02 六条、`econ-audit-mp` 的三条联机镜像，
以及既有 `rent` / `bankruptcy-integration` 两条按原版改写的用例）。
