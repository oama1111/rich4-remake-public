# 差距清单 · 30 张卡片

> 生成方式：以 `rich4-spec/docs/systems/cards.md` 为权威，逐条核查 `rich4-remake` 实现。
> 本轮只做分析，未改动任何代码。
>
> 约定：
> - 原版证据 = `0xADDR`（VA），必要处附汇编要点；均可在 `rich4-spec/` 用
>   `python3 tools/rich4dis.py func 0xADDR` 复核。
> - remake 证据 = 以 `rich4-remake/` 为根的 `文件:行`。
> - 卡名一律照抄规格文档原文（`card_data[]` @ `0x47fdf2`，卡名串 @ `0x466ac2`）。
> - 本文件**不引用** `rich4-re/`（铁律 1）；凡发现实现文档以 `rich4-re/` 为 `@source`
>   的地方，在第 四 节单列。

---

## 一、结论摘要

**统计（30 张，一张不漏）**

| 判定 | 张数 | 卡号 |
|---|---|---|
| **1:1 实现** | **16** | 1、2、4、5、7、11、12、13、15、22、23、24、25、27、28、29 |
| **有差异** | **14** | 3、6、8、9、10、14、16、17、18、19、20、21、26、30 |
| **缺失**（整张未实现） | **0** | —— |

**卡名表与顺序（强制核对项）：完全一致。**
`packages/data/src/cards.ts:64-95` 的 30 项与规格 `§1.1.5`（`0x47fdf2`，30×8 字节）**逐项
同名、同序**，且 `initAmount`(b4)、`price`(b5)、`f6`(b6)、`f7`(b7) 四个数值字段**全部相同**
（含 `f6` 非零的 5 张 = 1/2/9/10/15，与规格一致）。`packages/data/src/card-registry.ts:64-106`
的 30 个函数 VA 与规格 `§1.2`（`card_functions[]` @ `0x475d5c`）逐项一致。

**AI 表（额外做了字节级复核）：完全一致。**
规格 `§1.3`（AI 表 @ `0x475324`）只点名 `[18..21]` 是空桩。本轮直接读 exe 的 30 个 dword，
实测空桩 `0x41e6e3`（`xor eax,eax; ret`）恰好出现在 **5、6、18、19、20、21** 六项——
与 `packages/core/src/ai/card-policy.ts:973` 的
`AI_NEVER_PLAYS = [5, 6, 18, 19, 20, 21]` **完全吻合**；其余 24 项的函数 VA 也与
`card-policy.ts` 注释里引的 `@source` 一致（如 11→`0x41f400`、12→`0x41f6a9`、30→`0x420970`）。

**最严重的三条**

1. **停留卡(14) 与烏龜卡(30) 在玩法上是空卡**：两张卡写的 `player+0x38` / `player+0x39`
   被正确写入、正确递减、正确存档，**但引擎里没有任何一处读它来决定「本回合不走」/「只走
   1 步」**。原版 `0x4012a7`（`+0x38 != 0 → return`）与 `0x40dd7e`（`+0x39 != 0 →
   步数 = 1`）这两条闸门在 remake 中没有落点；客户端只拿 `stopping` 换 GO 钮的「禁止通行」图
   （`packages/client/src/main.ts:5379-5386`），按下前進目标照样走满骰子。→ 玩家可观察的
   行为差异（严重度：阻断）。
2. **防御卡体系（18/19/20/21）在「有害卡」路径上大面积失真**：四张防御卡被命中后
   **一律不被消耗**（受害者的卡永不出手牌）；夢遊卡(16) **完全不查免罪卡(21) 与嫁禍卡(19)**；
   復仇卡(18) 的判定时机与反弹天数都与原版不符，且**在陷害卡(17) 侧完全没有接入**。
   → 一次持有即永久免疫（严重度：阻断）。
3. **查稅卡(26) 收上来的税金凭空消失**：原版把 `tax2` 从最终目标转给施卡者
   （`0x41d2c6(最终目标, 使用者, tax2, 0)`，进使用者**存款**），remake 只在目标的 `cash`
   上做减法（`packages/core/src/cards/tax.ts:80-82`），施卡者一分钱都拿不到。
   同一张卡还缺嫁禍卡(19) 分支与 `tax2` 重算。（严重度：阻断）

> 另有一条**已登记的偏离**必须点名：`ai/card-policy.ts` 的 7 处 `aiRoll`（卡 7/9/15/16/17/28/30）
> 与原版 `0x456f2d` 的 PRNG 不是同一条序列、且**不推进 `rngState`**。规格要求「随机数的消耗
> 次数与顺序必须与原版一致」，此处系统性不符——登记在 `docs/known-deviations.md:629` 的
> **D-004**（但 D-004 正文只写了 `policy.ts::gateRoll`，未逐条列出这 7 处）。

---

## 二、★ 卡片逐张对照表

> 「函数 VA」列取自规格 `§1.2`；「原版效果」列的 `0xADDR` 为该卡关键效果指令。
> 判定 ✅ = 1:1（含仅表现层/仅已登记偏离的差异），❌ = 有差异。

| 卡号 | 卡名 | 原版效果（证据 @source） | remake 实现（文件:行） | 是否 1:1 | 差异说明 |
|---|---|---|---|---|---|
| 1 | 均富卡 | 函数 `0x004420d8`；Σ`cash` ÷ 在局人数（`idiv` 向零，`0x44214d`）；`avg < cash` 时 `update_hostility(p,cur,(cash-avg)/100)`（`0x442173`–`0x442188`）；`cash=avg`（`0x442193`） | `packages/core/src/cards/average-cash.ts:64-92`；分发 `registry.ts:331-336` | ✅ | 在局人数为 0 时原版 `idiv` 除零异常，remake 早退（`average-cash.ts:75`，防御性加固）；`average-cash.ts:97-104` 遗留 `JUNPIN_CARD_TODO` 死常量（均贫卡早已实现） |
| 2 | 均貧卡 | 函数 `0x004421b4`；`avg=trunc((cash[cur]+cash[tgt])/2)`（`0x442257`）；两者同写；`avg<tgt.cash` 时记 `(cash-avg)/100`（`0x442267`）；掩码 0 → 返回 0 不扣卡（`0x4421e2`） | `packages/core/src/cards/average-poor.ts:51-86`；分发 `registry.ts:337-343` | ✅ | 自己为目标被 core 拒（`target.ts:328`）；原版函数体无此判定，但选框 `0xe0c0410` 的确认处理器禁自己（规格 §卡29 `0x00446448`），两者不可观察差异 |
| 3 | 購地卡 | 函数 `0x00442325`；价 `(level*house_price+land_price)*price_index`（`0x4423ae`）；`owner=cur+1`（`0x44243e`）；`pay_money`（`0x442479`）；**`flast=add_deed_date(今天,年限表[0x499110])`（`0x44246c`）** | `packages/core/src/cards/buy-land.ts:50-74`；`registry.ts:566-579` | ❌ | **未维护地契到期日**：只写 `owner`（`registry.ts:576`），`state.landTenure` 未更新；同一仓库的普通买地路径会写（`state/reduce.ts:1167-1168`）⇒ 購地卡买来的地沿用原地主到期日 / 0 |
| 4 | 換地卡 | 函数 `0x00442622`；只交换两块地 `owner`（`0x4427bb`、`0x4427c1`）；交换前**不检查有无主/是否自己** | `packages/core/src/cards/swap-and-stock.ts:40-56`（地块）/`:80-96`（設施）；`registry.ts:629-663` | ✅ | 两次 `0x456c0a`（把两块编号在地图数组里改成 `0xffff`）用途规格自身标未决；「不能选脚下那一格」由效果层 `ok:false` 代偿（`swap-and-stock.ts:47`、`registry.ts:639`），表现等价 |
| 5 | 換屋卡 | 函数 `0x00442b02`；助手 `0x40b4f8` 交换 `+0x1a`(level) 与 `+0x18`(type)（`0x40b6c5`–`0x40b6da`、設施 `0x40b8a1`） | `packages/core/src/cards/turn-and-house.ts:124-140`（地块）/`:158-173`（設施） | ✅ | AI 从不打（已字节级复核 `0x475324[5]` = 空桩，`ai/card-policy.ts:973`） |
| 6 | 轉向卡 | 函数 `0x00442f4d`；`0x40c78c` → `direction=(d+4)&7`（`0x40c7be`）**且把 `player[0x0e]` 重设为「当前节点的随机邻接节点（排除原值、排除封路）」**（`0x40c834` 的 `call 0x456f2d`） | `packages/core/src/cards/turn-and-house.ts:53-68`（玩家）/`:88-90`（替身） | ❌ | **缺 `player[0x0e]`（`lastNodeId`）重设**（`turn-and-house.ts:83-86` 自述 TODO）；且 `direction` 在下一步被位移重算覆盖（`state/reduce.ts:961-969`）⇒ 掉头对路径**无可观察影响**；原版此处消耗 1 次 `rand`，remake 完全不消耗 |
| 7 | 改建卡 | 函数 `0x0044309b`；地块 `type^=1` 且转非 0 时 level 截 1（`0x443128`–`0x443139`）；設施写入选定类别、类别 0/3 截 1（`0x4431e4`–`0x4431fe`） | `packages/core/src/cards/rebuild.ts:63-92`（地块）/`:154-191`（設施） | ✅ | `chosenType` 范围复核（`rebuild.ts:166-172`）在 `level==0` 判定之前，与汇编顺序不同但结果等价；AI 类别来自 `ai/card-policy.ts:369` 的 `aiRoll`（非原版 `rand()%4+1`） |
| 8 | 拍賣卡 | 函数 `0x00443225`；`0x43bde5` 开拍；未成交 → `owner=0`（`0x44335b`）**且 `flast=0`（`0x44335f` 住宅 `+0x30` / 商業 `+0x34`）** | `registry.ts:518-565`；`packages/core/src/rules/auction.ts:187-205`、`:216-235` | ❌ | **流拍只写 `owner: 0`，未清到期日**（`auction.ts:198`、`:233`）；`auction.ts:214-215` 的注释声称「清 +0x34 租期」但代码没有这一步；`state.landTenure` / `facilityTenure` 不动 |
| 9 | 天使卡 | 函数 `0x004434c0`；住宅同區批量 `level+=1`、上限 5（`0x443587`–`0x4435cb`）；商業单块走 `0x40b110`（`0x4436ad`）；两支都返回地产编号（`0x4436d9`） | `packages/core/src/cards/land-cards.ts:49-57`（地块）/`:265-281`（設施）；`registry.ts:664-679` | ❌ | 設施**满级**时 `applyAngelFacilityCard` 返回 `ok:false` → `registry.ts:671-672` 按 `noEffect` 处理 ⇒ **不扣卡**；原版仍返回地产编号 = 成功、卡片照扣 |
| 10 | 惡魔卡 | 函数 `0x004436e0`；住宅同區批量 `level=type=0`（`0x4437f8`）并按**原**等级记 `30×level×pi`（`0x4437bb`）；商業单块 + `0x40dffa` | `packages/core/src/cards/land-cards.ts:75-77`（地块）/`:298-315`（設施）；`registry.ts:680-707` | ❌ | 設施**0 级**（`mutateFacility` 返回 `changed:false`）时 `registry.ts:687` 按 `noEffect` ⇒ **不扣卡**（原版扣卡）；**缺 `0x40dffa`**（对每个 `+0x32 != 0` 的在局者写 `0x80`，`0x40e019`）；地块支无此问题 |
| 11 | 怪獸卡 | 函数 `0x00443917`；`0x40ab4a(code,2)` 只清 `level`/`type`、**保留 owner 与 flast**（`0x40aba4`–`0x40abd2`）；敌意 `30×level×pi`（`0x4439c9`）；拾取窗拒自己的/空地（跳表组 4 `loc_00446457`） | `packages/core/src/cards/monster.ts:105-124`/`:196-215`；`registry.ts:604-628`；闸门 `land-cards.ts:110-118` | ✅ | 缺 `0x40dffa`（同上，state 写入未落）；`monster.ts:102-103` 陈旧注释称「設施分支尚未实现」，与同文件 `:159`/`:196` 及 `monster.test.ts:100-151` 矛盾 |
| 12 | 拆除卡 | 函数 `0x00443b0f`；4A 住宅 `dec level`、`type≠0` 时清零（`0x443c10`–`0x443c1d`）；4B 商業（`0x443cdc`–`0x443ce9`）；4C `bit15` 拆地图物件、只放行 `0x10/0x11/0x12`（`0x443d22`、组 6 `0x00446528`）；敌意平坦 `30×pi` | `packages/core/src/cards/land-cards.ts:84-86`、`:166-176`、`:335-347`；`rules/land-mutation.ts:75-93`；`registry.ts:708-753` | ✅ | 缺 `0x40dffa`（4B 减到 0 时）；规格 §卡12 的卡名 VA 记作 `0x00466b0f`，与卡 11 重复（疑规格笔误，按 `card_data` 表 A 应为 `0x466b16`） |
| 13 | 搶奪卡 | 函数 `0x00443e3d`；掩码 → `ctz`（`0x40d293`）；`0x44192a` 抢一张（卡路径 `0x441343`+`0x4412e4`，道具路径 `0x445aa2`/`0x445a4d`）；敌意 = 被抢物在卡片表 `+5` 的价（`0x443f1a`）；满 15 张弃最便宜（`0x44128f`） | `packages/core/src/cards/rob.ts:131-159`（卡）/`:45-77`（道具）；`registry.ts:344-370` | ✅ | `0x49915b` / `0x49731f` 计数数组语义规格未决，未建模；抢道具时若目标该道具已满 9 个则「凭空消失」——原版两函数组合的行为，`rob.ts:35-38` 已说明并有用例 `rob.test.ts:78-96` |
| 14 | 停留卡 | 函数 `0x00443f80`；写 `+0x38`（自己 `0x80`、别人 `1`，`0x444097`/`0x4440cb`）；**`0x4012a7`：`byte[player+0x38]!=0 → 本回合不移动`**；伪玩家写 `0x498df6=1`（`0x4440dc`） | `packages/core/src/cards/stay.ts:64-83`（玩家）/`:99-101`（替身）；`registry.ts:386-399` | ❌ | **`blocking.stopping` 只被写/递减/存档/AI 读，无任何回合跳过判据读它**：`state/types.ts:752-761` 的 `isBlocked` 不含它，`rules/turn-start.ts:82,88` 只调 `isBlocked`；客户端仅用它换 GO 图（`packages/client/src/main.ts:5379-5386`）⇒ 目标照常行动 |
| 15 | 冬眠卡 | 函数 `0x004440ea`；跳过自己/出局者/`x==0`/`dword[+0x32]!=0`（`0x444136`–`0x44416e`）；`150×pi` 敌意（`0x444170`）；`+0x37=0`、`+0x36=5`、`+0x42+=5`（`0x444191`–`0x4441a1`）；`i≥4` 写 `+0x498df4=5`、`+0x498df5=0`，循环到 8（`0x444139`） | `packages/core/src/cards/hibernate.ts:112-142`/`:73-88`；`registry.ts:400-413` | ✅ | AI 用 `ai/card-policy.ts:607` 的 `aiRoll(...,15,4)===0`（原版 `0x41fe4e` 的 `rand()%4==0`）；`HIBERNATE_ACTOR_SLOTS=[0,1,2,3]` 正确排除機器娃娃（actor 8） |
| 16 | 夢遊卡 | 函数 `0x004441dc`；`150×pi` 敌意（`0x4442ea`）→ **免罪卡(21)**（`0x4442f5`）→ **嫁禍卡(19)**（`0x444313`）→ `days=4/5`（`0x44435e`）+ 交通退还；**未被嫁禍改写时**查復仇卡(18)（`0x4443ef` 的 `cmp ebx,ebp`），施卡者 **硬编码 5 天**（`0x44441d` `mov byte [eax+0x496b9f],5`） | `packages/core/src/cards/sleepwalk.ts:158-204`；`registry.ts:414-454` | ❌ | 六条：①**不查免罪卡/嫁禍卡**（`sleepwalk.ts:183` 只查 18；`sleepwalk.test.ts:97-103` 还显式断言「其他被动卡不反弹」）②復仇判定时机错（原版在防御卡**之后**，且条件是「最终目标 == 原始目标」而非「目标==施卡者」）③**反弹天数 4 ≠ 5**（`sleepwalk.ts:188`，测试 `sleepwalk.test.ts:84-88` 亦锁定 4）④復仇卡**不被消耗**（`0x444691` → `remove_card(player,18)`）⑤**缺 `150×pi` 敌意**（`sleepwalk.ts` 无 hostility）⑥**缺「目标已在冬眠 `+0x36!=0` → 不施加」闸门**（`0x4442be`/`0x4442c5`，原版卡已消耗） |
| 17 | 陷害卡 | 函数 `0x004444bf`；`150×pi` 敌意先记（`0x4445c1`）→ 免罪(21)（`0x4445cc`）→ 嫁禍(19)（`0x4445ea`）→ `43d593(目标, 目标==当前?4:5)`（`0x44460b`–`0x44461c`）；最终==原目标时查復仇(18)（`0x444652`）并给施卡者补 5 天（`0x444678`） | `packages/core/src/cards/frame.ts:89-154`；`registry.ts:487-495` | ❌ | ①**免罪卡/嫁禍卡命中后不被消耗**（`frame.ts:118-139` 只有 `playerHasCard` 读取；`0x444bb2`/`0x44476a` 内部各有 `remove_card`）②**缺復仇卡(18) 分支** ③目標 `≥4` 分支未实现（`frame.ts:83-84` 自述；选框 `0xe0c0710` 是否可达规格未决） |
| 18 | 復仇卡 | 函数 `0x004420d5`（2 字节空桩，**不可主动使用**）；处理函数 `0x00444691` = 展示+**消耗 18**（`0x4446f0`）+台词，**惩罚由调用方施加** | 常量 `packages/core/src/cards/passive.ts:51`；唯一触发 `cards/sleepwalk.ts:183`；`cards/frame.ts` 无 | ❌ | 仅夢遊卡接入，且天数（4）与触发条件都错；**陷害卡侧完全缺失**；**从不消耗**（`frame.ts:118,132`、`sleepwalk.ts:183`、`tax.ts:78` 全是只读 `playerHasCard`，`consumeCard` 全仓只有 `rob.ts:150`、`registry.ts:819`、`state/reduce.ts:1111/1113/4790`，后者只覆盖过路费与事件） |
| 19 | 嫁禍卡 | 函数 `0x004420d5` 空桩；处理函数 `0x0044476a(target,mode,?)` 返回新目标 / `-1`，内部消耗 19（`0x4449ef`）；被 16/17/26/过路费/事件查询 | `packages/core/src/cards/frame.ts:129-139`（陷害）；`packages/core/src/rules/toll-flow.ts:164-166`（过路费）；消耗点 `state/reduce.ts:1113`、`:4790` | ❌ | 夢遊卡(16) 与查稅卡(26) **未接入**；卡牌路径（陷害卡）命中后**不消耗**（`frame.ts:132-139`）；`checkDefensiveCards`（`passive.ts:74-80`）在生产代码**无调用点** |
| 20 | 免費卡 | 函数 `0x004420d5` 空桩；处理函数 `0x00444a60(target,payer,amount)`：AI 阈值 `(rand()%3000+3000)×pi`（`0x444a9b`），用卡则消耗 20（`0x444b30`）；被查稅/过路费/事件查询 | `packages/core/src/cards/tax.ts:78`（查稅，只读）；`packages/core/src/rules/toll-flow.ts:157-160`（过路费）；消耗点 `state/reduce.ts:1111` | ❌ | 查稅卡侧**不消耗**（`tax.ts:78` 只判 `playerHasCard`）；事件类（`0x41a611`、`0x41af0f`）未接入；真人自动决定已登记 **D-008**（`docs/known-deviations.md:738`） |
| 21 | 免罪卡 | 函数 `0x004420d5` 空桩；处理函数 `0x00444bb2(target)`：展示+**消耗 21**（`0x444c11`）+完全抵消；优先级最高（`0x441226`–`0x441236`）；也被 `0x441210` 用于事件 | `packages/core/src/cards/frame.ts:118-127`（陷害）；常量 `cards/passive.ts:55` | ❌ | 夢遊卡(16) **未接入**（规格要求 21→19 顺序）；陷害卡侧命中后**不消耗**；事件类（`0x441210` 的 5 个调用点）未接入 |
| 22 | 送神符 | 函数 `0x00444c45`；先 `+0x40`(f64) 无判定就送（`0x444c64`），再 `+0x3f`(god_info) 需类别 ∈ `{5,6,7,8,10,15}`（`0x444c9f`–`0x444cbb`）；一件没送走 → 返回 0 **不扣卡**（`0x444cd5`） | `packages/core/src/cards/dispel.ts:46-66`；`registry.ts:455-462`；物件回收 `state/reduce.ts:2862-2875` | ✅ | `0x40e32c`（带演出）与 `0x40e14d`（直拆）的区别属表现层；物件表回收由 registry/reduce 走 `releaseObject` 完成 |
| 23 | 請神符 | 函数 `0x00444e1a`；人类 `0x444d1a` **自动请最近的一尊**（无 UI），AI 读 `[0x48be58]`；`0x40ead7` 附身（旧神先送走 `0x40eb3e`、三项修正、`state` 13/7） | `packages/core/src/cards/summon.ts:190-200`；`packages/core/src/rules/object-landing.ts`（`attachGod`）；`registry.ts:463-478`；人类自动选 `packages/client/src/main.ts:4005-4012` | ✅ | — |
| 24 | 紅卡 | 函数 `0x00444f25`；`newsFlag(+0x07)=0x20`（`0x444f88`）并**紧接着** `0x429040` 重算当日价（`0x444f91`）；无敌意段 | `packages/core/src/cards/swap-and-stock.ts:136-138`；`registry.ts:780-808`（`:805` 调 `applyStockNews`） | ✅ | 多出 `marketClosed` / 停牌 `f6!=0` 两道护栏（`registry.ts:783-791`），源码自认「原版没有，已登记，非静默偏差」 |
| 25 | 黑卡 | 函数 `0x0044503f`；`newsFlag=2`（`0x4450f6`）并重算当日价；尾部敌意循环因 double 压栈被当 int 读而**恒为 0**（`0x4451b9`） | `packages/core/src/cards/swap-and-stock.ts:144-146`；`registry.ts:780-808` | ✅ | 同上护栏；不产敌意与原版一致（`swap-and-stock.ts:131-134` 有长注） |
| 26 | 查稅卡 | 函数 `0x004451f0`；`tax=trunc(0.2×cash)`（`0x4452d7`）、敌意 `tax/100`（`0x4452fa`）→ **免費卡(20)**（`0x445310`）→ **嫁禍卡(19)，税额 > 2000**（`0x44534e`/`0x445360`）→ 按最终目标**重算** `tax2`（`0x445391`）→ `0x41d2c6(最终目标, 使用者, tax2, 0)`（`0x4453a4`，**进使用者存款**） | `packages/core/src/cards/tax.ts:56-85`；`registry.ts:479-486` | ❌ | ①**税金只从目标现金扣除，从不转给施卡者**（`tax.ts:80-82`；`state/reduce.ts:2790-2886` 的合并只落 lands/facilities/players/tools/objects/market，无任何转账）②**无嫁禍卡(19) 分支**（`registry.ts:489` 的 `scapegoatPicker` 只给卡 17 用）③无 `tax2` 重算④**免費卡不消耗**⑤收款未入存款 |
| 27 | 漲價卡 | 函数 `0x0044542d`；住宅同區批量 `+0x17=0x50`（`0x4454ef`）、商業单块 `+0x1c=0x50`（`0x44553e`）；效果 = 过路费 ×2（`0x419b0f`） | `packages/core/src/cards/land-cards.ts:197-218`；`packages/core/src/rules/land-mutation.ts:26-32`、`:179-183`；`registry.ts:754-776` | ✅ | 住宅批量循环在原版从下标 **1** 起，remake 的 `lands` 也是 1 基（`loaders/map.ts:532-535`）⇒ 等价；`price_status` **高半字节 = 剩余天数** 属 remake 推断（`land-mutation.ts:161-178`），规格标未决 |
| 28 | 查封卡 | 函数 `0x00445593`；住宅同區批量 `+0x17=0x51`（`0x445659`）、商業单块 `+0x1c=0x51` 且 `type==4` 时另清 `+0x1e`（`0x4456cb`–`0x4456d5`）；住宅过路费**免收**（`0x41d599`） | `packages/core/src/cards/land-cards.ts:221-226`；`packages/core/src/rules/land-mutation.ts:122-131`；`registry.ts:754-767`；`rules/toll-flow.ts:41-42` | ✅ | 商業 `+0x1c` 非 0 究竟是「翻倍」还是「免收」，**规格自身标未决**（§卡28 未决 1）；remake 按免收处理 |
| 29 | 同盟卡 | 函数 `0x00445710`；双向解旧盟（`0x4457fb`、`0x445834`）、互指 1 基、`+0x3d=7`（`0x44587a`）；每回合互 `−20×pi` 好感并倒数、归零写 `0x80`（`0x41cbdc`–`0x41cc41`） | `packages/core/src/cards/alliance.ts:66-92`；`packages/core/src/rules/blocking.ts:169-187`；`state/reduce.ts:857-863`（`-20*priceIndex` 双向） | ✅ | `dissolve` 在 partner 越界时仍 push `dissolved`（`alliance.ts:48-53`），极端边界 |
| 30 | 烏龜卡 | 函数 `0x004458df`；自己 `+0x39=2`（`0x4459f6`）/ 别人 `3`（`0x445a2d`）/ 伪玩家 `3`（`0x445a41`）；**`+0x39 != 0 → 本回合步数强制 1`**（`0x40dd7e` 玩家 / `0x40de34` 伪玩家，正常为 `rand()%9+2` = 2..10，`0x40de50`） | `packages/core/src/cards/tortoise.ts:44-63`/`:78-80`；`registry.ts:502-515` | ❌ | **`blocking.tortoiseWalking` 只被写/递减/存档/AI 读，没有任何步数限制读它**（`rules/blocking.ts:164` 递减、`state/reduce.ts:932` 的 `rollDice(rng, player.ndices, ...)` 不查它）⇒ 目标照常走满骰子；客户端只用它换 GO 图（`client/src/main.ts:5383`） |

---

## 三、机制层差距（目标选择/合法性判定/结算顺序/互斥规则等）

> 类型取值：`缺失` / `数值错` / `算法错` / `时序错` / `接口不符` / `多余实现` / `无法判定`
> 严重度：`阻断`（玩家可观察的行为差异）/ `严重`（功能缺失或明显不同）/ `轻微`（表现层或极端边界）

| # | 条目 | 原版规格（证据） | remake 现状（证据） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 1 | **停留卡的状态无消费者** | `0x4012a7`：`cmp byte [player+0x38],0 / jne return`（本回合不移动） | `blocking.stopping` 全仓非测试引用只有写（`cards/stay.ts:79`、`places/magic-house.ts:338`、`events/news-effects.ts:691`）、递减（`rules/blocking.ts:165,179`）、清零、存档、客户端 GO 图（`packages/client/src/main.ts:5379-5386`）；`state/types.ts:752-761` 的 `isBlocked` 不含它，`rules/turn-start.ts:82,88` 只调 `isBlocked` | `缺失` | **阻断** | 把 `stopping != 0` 并入回合开始判定（或在移动结算前短路），使目标本回合不掷骰/不移动；`0x80` 与 `1` 的时序按规格 §卡14 未决 1 定 |
| 2 | **烏龜卡的状态无步数消费者** | `0x40dd7e`：`cmp byte [edx+0x496ba1],0 / jne → [0x48baf8]=1`；伪玩家 `0x40de34`；正常为 `rand()%9+2` | `blocking.tortoiseWalking` 只在 `cards/tortoise.ts:59` 写、`rules/blocking.ts:164` 递减、AI 判据读（`ai/card-policy.ts:573` 等）；`state/reduce.ts:932` 的步数只来自 `rollDice(rng, player.ndices, forced)` | `缺失` | **阻断** | 步数计算处加 `tortoiseWalking != 0 → 1 步`；伪玩家同理（`special-actors.ts` 的 `singleStep`） |
| 3 | **被动防御卡命中后不被消耗** | 免罪：`0x444bb2` 内 `push 0x15 / call 0x441343`（`0x444c11`）；嫁禍：`0x44476a` 内 `0x4449ef`；免費：`0x444a60` 内 `0x444b30`；復仇：`0x444691` 内 `0x4446f0` | `cards/frame.ts:118,132`、`cards/sleepwalk.ts:183`、`cards/tax.ts:78` 全部只有只读 `playerHasCard`；全仓 `consumeCard` 调用点仅 `rob.ts:150`、`registry.ts:819`（只消耗出牌者自己打出的牌）、`state/reduce.ts:1111/1113/4790`（过路费/事件） | `缺失` | **阻断** | 在防御卡命中的三个分支里显式 `consumeCard(受害者, 18/19/20/21)`；把消耗结果并回 `players` |
| 4 | **夢遊卡不查免罪卡(21)/嫁禍卡(19)** | `0x4442f5` `push 0x15` → `0x444bb2`；`0x444313` `push 0x13` → `0x44476a` | `cards/sleepwalk.ts:164-204` 全程不查；`registry.ts:414-454` 也不查；`cards/sleepwalk.test.ts:97-103` 显式断言「其他被动卡不反弹」 | `缺失` | **阻断** | 在 `applySleepwalkCard` 里按 21→19 顺序接入（可复用 `cards/passive.ts` 的 `checkDefensiveCards`，目前它是死代码） |
| 5 | 復仇卡(18) 的判定时机与条件 | `0x4443ef` `cmp ebx,ebp / jne 结束`：在免罪/嫁禍/施加**之后**，且仅当「最终目标 == 原始目标」（未被嫁禍改写）；`0x44440c` 调 `0x444691` 后 `0x44441d` 写施卡者 `+0x37` | `cards/sleepwalk.ts:183` 在读卡后的**第一件事**就无条件检查（早于任何防御卡判定，且不检查是否被嫁禍改写） | `时序错` | `严重` | 把復仇判定移到防御卡与效果施加之后，并加「最终目标 == 原始目标」条件 |
| 6 | 復仇反弹的天数 | `0x44441d` `mov byte [eax+0x496b9f], 5`（硬编码 **5**，`eax` = `0x49910c` 的玩家结构） | `cards/sleepwalk.ts:188` `days = victimIndex === currentPlayer ? 4 : 5` ⇒ 反弹时 **4** | `数值错` | `严重` | 反弹分支直接用常量 5，不走「对自己 4 天」的公式 |
| 7 | 夢遊卡的敌意增量 | `0x4442ea` `update_hostility(target, 施卡者, 150×price_index)`，位置在防御卡判定**之前**、无论免疫与否都记 | `cards/sleepwalk.ts` 无 `hostilityDeltas`；`registry.ts:414-454` 也未补 | `缺失` | `严重` | 在 `applySleepwalkCard` 里按 `priceIndex*150` 产出 delta（对齐 `cards/frame.ts:113-115` 的写法） |
| 8 | 夢遊卡缺「目标已在冬眠」闸门 | `0x4442be` `cmp byte [eax+0x496b9e],0 / jne 0x44449b`（`+0x36` 非 0 → 整个效果不施加、不记敌意、不查防御卡；**卡已消耗**） | `cards/sleepwalk.ts` 无此判定，只要目标存活就施加 | `算法错` | `严重` | 加 `blocking.sleeping !== 0 → noEffect`（并注意此时原版仍扣卡） |
| 9 | **查稅卡的税金没有收款方** | `0x445391` 重算 `tax2` → `0x4453a4` `0x41d2c6(最终目标, 使用者, tax2, 0)`；flags=0 ⇒ 付款方扣现金、**收款方 `+0x20` 存款增加**（`0x41d3c1`） | `cards/tax.ts:80-82` 只做 `cash: p.cash - tax`；`state/reduce.ts:2790-2886` 的合并循环没有任何金额转移 | `缺失` | **阻断** | 用 `rules/payment.ts` 的 `transferMoney(..., flags=0)` 从最终目标转给施卡者（对齐 `registry.ts:573` 购地卡的用法） |
| 10 | 查稅卡缺嫁禍卡(19) 分支与 `tax2` 重算 | `0x44534e` `cmp [esp+0x94],0x7d0 / jle 跳过`；`0x445360` `0x44476a(target, 2, 0)`；`0x445391` 按最终目标现金重算 `tax2` | `cards/tax.ts` 无；`registry.ts:479-486` 不用 `ctx.scapegoatPicker` | `缺失` | `严重` | 加「税额 > 2000 且目标持有 19 → 换目标」并重算金额；`applyTaxCard` 需接收 `scapegoatPicker` |
| 11 | 查稅卡的免費卡不消耗 | `0x444a60` 用卡时 `0x444b30` `push 0x14 / call 0x441343` | `cards/tax.ts:78` 只读；`registry.ts:483` 把 `defended` 回传后无人使用 | `缺失` | `严重` | 与第 3 条合并修 |
| 12 | 轉向卡缺 `last_node` 重设（玩家与替身两支） | `0x40c7be` 掉头**之后** `0x40c834` `call 0x456f2d / idiv ebx / mov word [esi+0x496b76], ax`（排除原值、排除封路槽）；替身支 `0x40c8e8` 同款 | `cards/turn-and-house.ts:37-39,53-68,88-90` 只改 `direction`；`turn-and-house.ts:83-86` 自述「待 last_node 语义进引擎时一并补」，但 `lastNodeId` 已存在并被走动使用（`state/reduce.ts:955`） | `算法错` | **阻断** | 在 `applyTurnCard`/`applyTurnCardToActor` 里重掷 `lastNodeId`（需 `topo` 与 rng），并把 rng 消耗纳入确定性序列 |
| 13 | 購地卡 / 拍賣流拍 未维护地契到期日 | 購地：`0x44246c` 住宅 `+0x30` / `0x4425e9` 商業 `+0x34` 写 `add_deed_date(今天, 年限表[[0x499110]])`；拍賣流拍：`0x44335b` `owner=0` **且** `0x44335f` `flast=0` | 購地：`registry.ts:576` 只写 `owner`；拍賣：`rules/auction.ts:198`、`:233` 只写 `owner: 0`（`:214-215` 注释声称清租期，代码没有）。对照：普通买地会写（`state/reduce.ts:1167-1168`、`:1188`） | `缺失` | `严重` | 两条路径都补 `landTenure[...] = tenureExpiry(packDate(state), state.landTenureIndex)` / 流拍时置 0 |
| 14 | 「无效果即不扣卡」的统一策略与原版偏置不符 | 天使卡两支都返回地产编号 = 成功（`0x4436d9 mov eax,ebp`）、惡魔卡同理；原版只在「目标值 == 0（取消）」时返回 0 | `registry.ts:671-672`（天使·設施满级）、`:687`（惡魔·設施 0 级）按 `noEffect` 返回失败 ⇒ **不扣卡**；而地块支（`:677`、`:694-704`）无条件成功 ⇒ 扣卡。同一张卡两条支路策略不一致 | `接口不符` | `严重` | 天使/惡魔的設施支改为「只要选中合法設施就成功（扣卡）」，把「是否变动」只用于返回值/音效档位 |
| 15 | `0x40dffa` 的状态写入缺失 | `0x40dffa`：对每个在局玩家，若 `player[0x32] != 0` 则置 `0x80`（`0x40e004`–`0x40e019`）；被惡魔卡商業支（`0x4438cc`）、拆除卡4B（`0x443ce9`）、`mutate` mode 0/2 設施支调用 | remake 明写「`0x40dffa` 是表现层刷新，core 无可落副作用」（`cards/land-cards.ts:296`、`cards/monster.ts:156`），未实现 | `缺失` | `轻微` | 落到 `blocking` 的对应字节（`+0x32` 语义规格未决，若确定是「阻碍」位可只做镜像写） |
| 16 | AI 随机数序列与消耗次数 | 跳表 `0x475324` 的 AI 函数会 `call 0x456f2d`：改建卡 `rand()%4+1`（`0x41eeab`）、冬眠卡 `rand()%4==0`（`0x41fe4e`）、天使/夢遊/陷害/查封/烏龜各自的挑選、以及个性闸门 `rand()%3`（`0x41e6c9`） | `ai/card-policy.ts:70-73` 的 `aiRoll` = `((rngState ^ imul(salt,0x9e3779b1)) >>> 0) % n`，纯派生、**不推进 `rngState`**；调用点 `:210`(lookahead)、`:369`(卡7)、`:406`(卡9)、`:607`(卡15)、`:617`(卡16/17)、`:790`(卡28)、`:853/:896`(卡30)；`ai/policy.ts:405-407` 的 `gateRoll` 同型 | `时序错` | `严重` | 已登记 **D-004**（`docs/known-deviations.md:629`）——但 D-004 正文只写了 `policy.ts::gateRoll`，card-policy 的 7 处 `aiRoll` 只在 `card-policy.ts:21-23` 以引用方式覆盖。若要确定性复现原版，须把 AI 决策搬进 reducer 并真实消耗 `rand()` |
| 17 | 夢遊卡/陷害卡对特殊棋子的准入不对称 | 两卡的选框参数**都是** `0xe0c0710`（规格 §卡16 与 §卡17 明确「与卡 16 相同」） | `registry.ts:292` 的 `allowActor` 白名单为 `cardId === 6 / 14 / 16 / 30` —— **含 16 不含 17**；两卡的 actor 分支在原版都存在（`0x44449b`、`0x44467a`） | `算法错` | `轻微` | 二者取同一条规则（同时开或同时关）；若按 `0xe0c0710` 的类别位（低字节 `0x10` = 只放行玩家）判定，则应同时关闭 |
| 18 | 換地/換屋「不能选脚下那一格」落在效果层而非合法性层 | 拾取跳表组 2 `0x00446427`：`cmp ecx, ebx / je 拒绝`（拒絕选中与脚下同格） | 設施支有显式判定（`registry.ts:639`）；**地块支没有**，靠 `swap-and-stock.ts:47` / `turn-and-house.ts:131` 在 A==B 时返回 `ok:false` 让 `canUseCard` 预演失败（`packages/client/src/picking.ts:284-286`） | `接口不符` | `轻微` | 表现等价，可不改；若要让 core 的 `validateTarget` 自洽，可把「同格」移进合法性判定并给出专属错误码 |
| 19 | `cards/passive.ts` 的两个「库函数」是死代码 | —— | `checkDefensiveCards`（`passive.ts:74-80`）与 `checkTollPassives`（`passive.ts:182-199`）在生产代码**零调用点**（全仓 grep 仅 `passive.test.ts`）；生产路径各自内联（`frame.ts:118,132`、`tax.ts:78`）或在 `rules/toll-flow.ts:145-168` 重写 | `多余实现` | `轻微` | 让 16/17/26 统一走 `checkDefensiveCards`，避免「库函数与生产路径两份实现互相漂移」——第 3/4 条正是这样漂移出来的 |
| 20 | `UseCardResult.defended` 无消费者 | —— | `registry.ts:109`（字段）/`:493`（赋值 `r.outcome?.kind === 'absolved'`）；`state/reduce.ts` 从不读取 | `多余实现` | `轻微` | 要么删除，要么用它驱动表现（免罪动画/日志） |
| 21 | `applySummonCard` 无生产调用者 | 請神符效果 `0x444e1a` → `0x40ead7` | `cards/summon.ts:181-187` 只被 `summon.test.ts:140` 引用；registry 走 `rules/object-landing.ts` 的 `attachGod`（`registry.ts:469`） | `多余实现` | `轻微` | 标注为「仅供测试/文档」，或让 registry 复用它 |
| 22 | 卡 24/25 的引擎护栏 | 原版卡函数只有「写 `newsFlag` + 重算」两条，无市场开闭/停牌判定 | `registry.ts:786` `marketClosed`、`:791` 停牌 `f6!=0`（源码 `:783-785` 自认「原版没有…已登记，非静默偏差」） | `多余实现` | `轻微` | 保持现状；已登记即可 |
| 23 | 抽卡函数的牌袋上限 | `0x441e12`：候选袋缓冲 128 字节（`0x499198[i] > 0` 时把 `i` 重复该值次 append，上限 `esp+0x80`），再 `rand() % 候选数` | `packages/core/src/rng/watcom.ts:140-151` 的 `drawRandomCard` 无上限（牌堆总量 `TOTAL_INITIAL_CARDS = 100`，`packages/data/src/cards.ts:98`） | `无法判定` | `轻微` | 规格未给出溢出时的确切行为，保持现状并登记 |
| 24 | 已知偏离登记的核实 | —— | **Q-CARD-1**（`docs/deviations/Q-CARD-1.md`）：本轮逐条复核，其全部断言与代码/原版汇编一致（含 `targetClassOf` 的 `standing` 入参、`applySwapFacilityCard` 只换 owner、换屋换 `type+level`、拆除卡物件支、`demolishLikeTargetAllowed` 的四条闸门）。**D-004**（`:629`）：结论正确，惟正文只覆盖 `gateRoll`（见第 16 条）。**D-005**（`:4091`）AI 视野/镜头钳位、**D-008**（`:738`）真人被动卡自动决定：均与代码一致。**Q-CARD-2**（`:3838`）：已标记为解决 | —— | —— | D-004 补记 card-policy 的 7 处 `aiRoll` |

---

## 四、remake 多出或未见于原版的实现

1. **市场/股票类护栏**：`registry.ts:786` 的 `marketClosed`、`:791` 的停牌 `stock.f6 !== 0`、`:789`/`:796` 的 `stockOutOfRange`。源码注释自认「原版卡片函数里没有」。
2. **改建卡 `facilityType` 的 0..4 范围复核**：`rebuild.ts:166-172`。源码注释自认「原版这一支不做范围检查」。
3. **`actorActive` 闸门**：`registry.ts:377`/`:391`/`:439`/`:507` —— 对停留/轉向/夢遊/烏龜卡的 actor 目标要求「在盘上（非監獄/醫院/未出场）」。原版按鼠标点得到谁就是谁（`registry.ts:437-438` 自述），因 picker 只画在场者，判为等价。
4. **均富卡 `|P| == 0` 的早期返回**：`average-cash.ts:75`；原版此处 `idiv ecx` 会除零异常。
5. **数量/范围校验：** `target.ts:233-242` 的 `facilityInRange`/`objectInRange`、`registry.ts:301` 的 `landNotFound`、`:609`/`:637` 等的 `facilityOutOfRange`。原版多处无边界检查（规格 §卡4/§卡11 等「无守卫」条）。
6. **死代码导出**：`cards/passive.ts:74-80` 的 `checkDefensiveCards`、`:182-199` 的 `checkTollPassives`（生产零调用）；`cards/summon.ts:181-187` 的 `applySummonCard`（生产零调用）。
7. **遗留常量**：`cards/average-cash.ts:97-104` 的 `JUNPIN_CARD_TODO`（均贫卡早已在 `average-poor.ts` 实现）。
8. **数据表的 `@source` 走 `rich4-re/`（铁律 1 违规，但取值经核验正确）**：
   - `packages/data/src/cards.ts:5` 写 `@source rich4-re/asm/rich4_card_table.c（与 rich4-re/csrc/cards.c:11-42 的 cards_table 完全一致）`；
   - `packages/data/src/source-fidelity.test.ts:38-60` 以 `rich4-re/asm/rich4_card_table.c` 为期望值逐字段比对。
   本轮已独立逐项核对规格 `§1.1.5`（`0x47fdf2`）与 remake 表：**30 项卡名/顺序/四个数值字段全部一致**，故未产生错误；但**证据链指向了非权威仓库**，应改为以 `0x47fdf2` 为 `@source`（`packages/data/src/binary-truth.test.ts:99-115` 已经是直读 exe 的正确做法）。
   - 另：`binary-truth.test.ts:28-29` 与 `source-fidelity.test.ts:16-18` 在缺 exe / 缺 `rich4-re` 时**静默 `describe.skip`**，即「与原版一致」的机器保证是**有条件**的。
9. **陈旧注释**：`cards/monster.ts:102-103` 称設施分支「尚未实现」，与同文件 `:159`/`:196` 及 `monster.test.ts:100-151` 矛盾。

---

## 五、无法判定项

| # | 项 | 说明 |
|---|---|---|
| 1 | `0xe0c0XYZ` 选择参数的逐位含义 | 规格 §1.4/各卡「未决」明确「位域含义未决」；remake 的 `SELECTION_GROUPS`（`packages/data/src/card-registry.ts:53-61`）也自认「位含义未证实」，两边都只按实测分组。故第 17 条（allowActor 不对称）只能按分组现象报差异，不能判定「谁对」。 |
| 2 | 换地/换屋的两次 `0x456c0a` | 规格 §卡4 未决 2：「把两块地产编号改成 `0xffff` 的用途未决，两次调用之后没有再写回去」。remake 未实现，**无法判定**是否有可观察后果。 |
| 3 | `player[0x0e]`（`0x496b76`）的字段名与语义 | 规格 §卡6 未决 1 标为未决；remake 已有 `lastNodeId` 并用于走动（`state/reduce.ts:955`），但仍**无法判定**原版重掷 `last_node` 后的确切步进结果（需实机/拓扑验证）。第 12 条的「缺实现」是确定的，具体行为差异范围不确定。 |
| 4 | 拍賣函数 `0x43bde5` 的内部规则 | 规格 §卡8 未决 1：「谁可出价、AI 出价策略、最低价、成交价构成未逐条拆解」。remake 的 `rules/auction.ts` 细节**无法比对**。 |
| 5 | 商業（設施）`+0x1c` 非 0 时是「翻倍」还是「免收」 | 规格 §卡28 未决 1 自己标未决（`0x41a446`/`0x41a4a2` 是 `add ebx,ebx`，与住宅 `0x41d559` 不是同一段）。remake 按「免收」处理（`rules/toll-flow.ts:41-42`），**无法判定**。 |
| 6 | `price_status` 高半字节的语义 | 规格 §卡27 未决 2 标未决；remake 的 `sweepPriceStatus`（`rules/land-mutation.ts:161-183`）断言「高半字节 = 剩余天数（0x50 = 5 天）」并附 `0x41d114`/`0x41d160` 的引证，但该结论不在权威规格内，**无法判定**。 |
| 7 | **权威规格内部矛盾：卡16/卡17 復仇卡(18) 的触发条件** | 规格 §卡16 的 **汇编级注释**写 `cmp ebx, ebp` = 「最终目标 == 原始目标（未披嫁禍改写）」；同节的**散文标题与十二节汇总表**却写「目标==施卡者 / 自伤时」。本轮直接反汇编 `0x4441dc` 确认 `0x4442f5`→`0x444310`→`0x444334`→`0x4443ef` 的寄存器链：`ebp` 在 `0x444260` 取自 `ctz`（原始目标），只在 `0x444332` 改写 `ebx`（最终目标），故**汇编级注释正确、散文表述有误**。卡17 同形（`0x444652 cmp ebx, edi`）。<br>后果：第 5 条的「条件错」在两条读法下都成立（remake 两者都不满足），但**精确**的触发边界须以汇编为准。 |
| 8 | 规格 §卡12 的卡名 VA | 规格写 `0x00466b0f`（`"拆除卡"`），与卡 11 怪獸卡的卡名 VA 完全相同；按 `card_data` 表 A（`0x47fdf2`，每项 8 字节）推算应为 `0x466b16`（与 §卡13 的 `0x00466b16` 冲突，疑为规格文档两处笔误之一）。remake 的卡名取自 `packages/data/src/cards.ts:76`（`'拆除卡'`，与表 A 语义一致），**无法判定**规格字节地址的正确形式。 |
| 9 | `0x499198` 计数器语义、`0x49915b`/`0x49731f` 计数数组、`player[0x17]`、`player[0x32]`、`b6` | 规格 §1.4/§1.1.4/§卡10/§卡13 均标未决。remake 未建模对应数组（`rob.ts` 注释提及但无字段），**无法判定**其可观察后果。 |
| 10 | 抽卡袋 128 字节上限溢出行为 | 规格未给（见第三节第 23 条）。 |
| 11 | 拍賣卡「未成交」的 `flast=0` 是否等价于 `landTenure=0` | remake 用并行的 `state.landTenure[]`/`facilityTenure[]` 而非记录内 `+0x30/+0x34`（`loaders/map.ts:221`、`:551`）。二者语义映射在规格里没有直接说明，第 13 条的「缺失」按「未清理到期日」这一事实判定。 |
| 12 | 卡 23 请神符 AI 如何挑神 | 规格 §卡23 未决 2：「AI 路径下 `[0x48be58]` 由哪个函数写入未确认」。remake 的 `SUMMON_WANTED_OBJECTS = [1,2,3,4,12]`（`ai/card-policy.ts:632`）是自定策略，**无法比对**。 |

---

## 六、建议的修复顺序

> 原则：先修「状态写了但没人读」与「资源凭空消失/永不消耗」这两类结构性错误（它们会让整局
> 经济与防御体系失真），再修单卡数值/时序，最后处理表现层与登记项。

**P0 —— 阻断级，先修（5 条）**

1. **接上停留卡与烏龜卡的消费者**（第三节 1、2）：在回合开始判定与步数计算处读
   `blocking.stopping` / `blocking.tortoiseWalking`（含 `specialActors` 的 `halted`/`singleStep`）。
   这两条一改，卡 14、30 从「空卡」变成可用。
2. **防御卡消耗 + 夢遊卡接入免罪/嫁禍**（第三节 3、4）：统一走
   `cards/passive.ts::checkDefensiveCards`（目前是死代码），并在命中分支显式 `consumeCard`。
   修完卡 16、17、18、19、20、21 六张的「永久免疫」问题。
3. **查稅卡的收款方**（第三节 9、10、11）：改用 `rules/payment.ts::transferMoney` 完成
   `目标 → 施卡者（存款）` 的转账，并补「税 > 2000 → 嫁禍」与 `tax2` 重算、`免費卡` 消耗。
4. **轉向卡补 `lastNodeId` 重掷**（第三节 12）：需要 `topo` 与一次真实的 `rand()`；同时
   决定 `direction` 是否还有保留价值（目前每步被位移覆盖）。
5. **天使/惡魔設施支的扣卡策略**（第三节 14）：把「无变动」与「使用失败」分开，
   使 0 级/满级設施也照原版扣卡。

**P1 —— 严重级（5 条）**

6. **地契到期日**（第三节 13）：`購地卡` 买入与 `拍賣卡` 流拍两条路径补 `landTenure`。
7. **復仇卡(18) 的时机/天数/消耗**（第三节 5、6），并补 `陷害卡(17)` 侧的復仇分支。
8. **夢遊卡的敌意与「已在冬眠」闸门**（第三节 7、8）。
9. **AI 随机数序列**（第三节 16）：先在 `docs/known-deviations.md` 的 D-004 里补齐
   card-policy 的 7 处 `aiRoll`；若要做确定性复现，须把 AI 决策搬进 reducer 并真实消耗 `rand()`。
10. **`0x40dffa` 的状态写入**（第三节 15）：待 `player+0x32` 语义定论后一并落地。

**P2 —— 轻微 / 清理**

11. 换地/换屋同格判定归位（第三节 18）、`allowActor` 对 16/17 的不对称（第三节 17）。
12. 删除或收敛死代码与遗留常量（第三节 19、20、21；第四节 6、7）。
13. 把 `packages/data/src/cards.ts:5` 与 `source-fidelity.test.ts:38-60` 的 `@source`
    从 `rich4-re/` 改为 `0x47fdf2`（第四节 8），并让两个「真值」测试在文件缺失时**显式失败**
    而不是 `describe.skip`。
14. 修正陈旧注释：`cards/monster.ts:102-103`、`cards/average-cash.ts:97-104`；
    并核对 `sleepwalk.ts:242` / `registry.ts:432` 引用的 `D-T047-5` 编号是否指对条目。
15. 把本轮新发现的偏离（停留/烏龜无消费者、防御卡不消耗、夢遊不查免罪嫁禍、查稅税金消失、
    購地/拍賣不维护地契）补进 `docs/known-deviations.md`——**目前它们都不在登记表里**。
