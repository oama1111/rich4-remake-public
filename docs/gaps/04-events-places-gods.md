# 差距清单 · 新闻 / 命运 / 特殊场所 / 神明 / 魔法屋

> 生成方式：以 `rich4-spec/docs/systems/{news,fortune,places,gods,magic-house}.md` 为权威，
> 逐条核查 `rich4-remake` 实现。本轮只做分析，未改动任何代码。
>
> 引用规格的版本（行数，本轮实际读到的）：`news.md` 1304 行、`fortune.md` 1130 行、
> `places.md` 1183 行、`gods.md` 822 行、`magic-house.md` 662 行。
>
> 约定：
> - 原版证据 = `0xADDR`（VA），必要处附汇编要点；凡标「本轮回读」的，都是用
>   `rich4-remake/tools/disasm.py va|callers 0xADDR` 或 `rich4-spec/tools/rich4dis.py func 0xADDR`
>   直接读 `Rich4/rich4.exe` 复核过的。
> - remake 证据 = 以 `rich4-remake/` 为根的 `文件:行`。
> - 本文件**不引用** `rich4-re/`（铁律 1）。凡实现文件把 `rich4-re/` 当 `@source` 的，在 §三 单列。
> - **类型列**：有差距的行只用规定的 7 种取值（缺失 / 数值错 / 算法错 / 时序错 / 接口不符 /
>   多余实现 / 无法判定）；**写 `—` 表示逐条回读后与原版一致，不构成差距**（不是新增类型）。
> - 已知偏离（`docs/known-deviations.md`、`docs/deviations/*.md`）不重复报为新发现，
>   只注明「已知偏离，见 xxx」，并**核实该记录本身是否正确** —— 本轮查出若干处规格/记录有误，
>   见 §四之二。

---

## 一、结论摘要

### 1.1 条目数与差距计数

| 子系统 | 覆盖条目 | 有差距 | 其中 阻断 | 其中 严重 | 其中 轻微 / 无法判定 | 已核对一致 |
|---|---|---|---|---|---|---|
| 新闻（36 项 + 8 条横向） | 44 | 16 | 6 | 6 | 4 | 28 |
| 命运（37 项 + 8 条横向） | 45 | 28 | 27 | 0 | 1 | 17 |
| 场所（监狱/医院/银行/乐透/特殊格） | 41 | 21 | 5 | 8 | 8 | 20 |
| 神明（gods.md §1–§8 全量 + 附 6 条） | 62 | 30 | 1 | 6 | 23 | 32 |
| 魔法屋（表 / 两转盘 / 12 动作 / 入口） | 43 | 23 | 0 | 10 | 13 | 20 |
| **合计** | **235** | **118** | **39** | **30** | **49** | **117** |

（计数口径：一条 = 规格里的一个可独立核对的结论；横向条目指跨 36/37 项的公共机制。
「无法判定」计入「有差距」列，因为当前无法证明一致。）

### 1.2 最严重的 3 条

1. **【阻断】出狱 / 出院永远不清占用表**（`rules/confinement.ts:128-135` 的 `release()` 全仓无调用者；
   `rules/blocking.ts:52-56` 返回的 `released` 在 `state/reduce.ts:1639` 被丢弃）。
   原版释放函数会 `mov byte [idx+0x496b30], 0`（`0x43d7d5`；医院 `0x43ee6e` 同构）。
   后果：`prisonOccupancy`/`hospitalOccupancy` 永久为 1 ⇒ 已出狱的人可被反复花 30 点券「保释」
   （`visit.ts:96-116`、`visit.ts:263-265`），新聞 0/2「大赦／提前出院」与 1/3「延长刑期」
   也会对有前科的人反复生效（`news-effects.ts:355-368` 以占用表为闸门）。
2. **【阻断】命运的神明加持表大范围失配，且每次都白掷一个随机数**。
   exe 全档只有 15 处 `call 0x44b896`（本轮回读 `callers`），经「跳进共享尾部」覆盖到 21 个事件号；
   remake 的 `EventEntry.blessing`（`data/src/event-table.ts:332-369`）有 **19 项不符**：
   13/16/18/20/21/23/24/25/26/27/28/29/30/31/34/35/36 完全没标（⇒ 完全不问加持）；
   **19 标成 `reward`（应为 `penalty`）、22 标成 `misfortune`（应为 `reward`）——语义整条反转**。
   另外 `reduce.ts:3293-3299` **无条件** `rng.next()`，而原版只在 `50 < 財運/福運 ≤ 100` 档才
   `call rand`（`0x44b8c1` 起的阈值阶梯）⇒ 每抽一次命运都让后续随机序列整体错位。
3. **【阻断】银行的 90 天贷款期限整体未接**：`loanDueDate` 全仓**只有读、清零与测试**，没有任何
   赋值（`places/bank.ts:96-113 borrow()` 不写；`0x433b7e` 的 `date+90` 与逐日跳过星期日/假日、
   `0x436a5a` 的到期强偿都不存在）⇒ 贷款永不到期，`stock-market.ts:592` 的 `loanSellPressure`
   永久 false。同级的「阻断」还有 news[4]/[29] 恒 `unimplemented`（外星人攻打地球、違法超貸
   两条入狱/入院来源零效果）、news[23] 儲金紅利缺 `loan==0` 门禁且错进现金、死神發威错误折抵點券。

---

## 二、★ 逐条对照表

### 2.1 新闻（`news_events`，36 项）

接线与公共机制（横向）：

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| N-A1 | 触发接线 | 落点跳表 `0x4197e9[2] = 0x41b11e → call 0x44b6df`（news.md §1.2） | `reduce.ts:3424` 的 settle 分支调 `drawAndApplyNews` | — | — | 无需修复 |
| N-A2 | 顺序表与洗牌 | `0x448b81` 生成 `news_order[36]`（`0x499090`）与游标 `0x4990e0`；算法＝逐轮 `rand()%剩余数` 线性挑空位，**恰好消耗 36 次 rand**（本轮回读 `0x448b97..0x448bd6`） | `deck.ts:47-66` 与 `0x448b81` 逐指令同构（`below(1)` 仍消耗一次 rand）；`new-game.ts:386-387` 先新闻后命运，与 `0x4074bf`/`0x4074c4` 同序 | — | — | 无需修复 |
| N-A3 | 抽取顺序与游标 | 游标对不可行事件也前进、到底回绕（`0x44b7c7..0x44b7e3`） | `deck.ts:104-122` `drawEvent` 同构 | — | — | 无需修复 |
| N-A4 | 两趟调用（pass 0 / pass 1） | 处理函数被调用两次，**19 项 pass 0 生效、17 项 pass 1 生效**（news.md §1.3） | 无 pass 结构，抽到即一次性施加（`reduce.ts:3424-3512`） | 接口不符 | 轻微 | 终局等价，只影响「面板显示的是改前还是改后」 |
| N-A5 | `check_news` 0/1/2/3 的判据 | `cmp dword [0x496b30],0` / `[0x496b60]` —— 一次比 4 个 byte，只覆盖玩家槽 0..3（`0x448c99`/`0x448cab`） | `news.ts:124-132`；reducer 传 `anyoneConfined(8 槽表)`（`reduce.ts:3434-3435`、`confinement.ts:38`） | 数值错 | 轻微 | 只在「仅 NPC 在押」时不同；改成只看槽 0..3 |
| N-A6 | 可行性上下文 | 逐 case 读真数据（news.md §2.1 全表） | `reduce.ts:3426-3437` 把 `facilities`、`stockAmount`、`commercials`、`stockF6`、`checkCommercialOwner` **全部写死空/false** | 算法错 | 严重 | 见 N10 / N13 / N28 / N29 / N35 |
| N-A7 | `#NNNN` 前缀 | `#NNNN` 是**语音控制码**：`0x44fabc` 见 `'#'`（`0x0044fb00 cmp ah,0x23`）解析并 `read_mkf(speaking, idx)`（取证链见 `packages/data/src/speech.ts:28-40`） | `event-table.ts:283-285` `stripEventCode` 只删前缀；事件框直接显示（`client/src/event-box-screen.ts:352`），**不播语音** | 缺失 | 轻微 | **不是**把 `#NNNN` 当颜色码（用户提示的那种阻断级错误不存在）；补「解析代号 → 播语音」 |
| N-A8 | 税款事件的全局闸 | news 11/12/13 的 pass 1 在 `byte[0x46caf8] != 0` 时整段跳过扣款（`0x449dad`、`0x449db4`） | 无此判断（`news-effects.ts:785-816`） | 无法判定 | 轻微 | `0x46caf8` 语义未决（news.md §5.3），需先定写入者 |

逐条（编号 = 事件号）：

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 0 | 獄中囚犯無罪開釋 | 在狱者 `days_in_prison=0x80` 且清 `0x496b30`；不查 `who_plays`（`0x448f31`、`0x448f3a`） | `news-effects.ts:340-372`：占用槽非 0 → `blocking.inPrison = 0x80`（`blocking.ts:29`）、槽清 0；循环 `who<4` | — | — | 无需修复 |
| 1 | 獄中囚犯延長刑期３天 | `(old + 3) & 0x7f`（`mov ecx,3` @`0x448f5b`；`0x448fe8`/`0x448ff5`） | `news-effects.ts:364-368` + `event-table.ts:290` `literal:3` | — | — | 无需修复 |
| 2 | 住院中病患提前出院 | 同 0，字段换 `0x496b60`/`+0x35`（`0x44906d`/`0x449076`） | `news-effects.ts:340-372`（对称分支） | — | — | 无需修复 |
| 3 | 住院中病患延長住院３天 | `(old+3)&0x7f`（`0x449122..0x449135`），与 news 1 共用尾部 | 同 1（`event-table.ts:292`） | — | — | 无需修复 |
| 4 | 外星人攻打地球 | 随机一处开 `damage_area`（本轮回读 `0x449227`：arg0=0x64 半径、arg1=0x26 flags、arg2=1、arg3=-1），并 `test byte [eax+0x496b7d],0x40` 过滤后 `add_hospital(p,3)`（`0x449279`/`0x449285`） | `event-table.ts:293` `literal:null`、reducer **不传 days**（`reduce.ts:3443-3464`）⇒ `news-effects.ts:821-823` 返回 `unimplemented`；`affected` 也取默认当前玩家（`reduce.ts:3637`） | 缺失 | 严重 | 传 `days=3`；`affected` 改为 `whoPlays & 0x40` 的全体（注：remake 把该位建模成 `WHO_PLAYS_SPECIAL_MASK=0x30`，`types.ts:42`，需先对齐位定义） |
| 5 | 外星怪獸襲擊，摧毀建築一棟 | 候选 = 地+设施中 `level!=0`（`0x4492d0`/`0x449308`），命中后 `0x40ab4a(id,1)`；mode 1 = `owner=0, level=0, type=0, flast=0`（本轮回读 `0x40abae..0x40abbd`） | `news-effects.ts:512-564` + `monster.ts:78-79` 的 `MUTATE_CLEAR_OWNER` **只置 `owner=0, type=0`，没有清 `level`** | 数值错 | 阻断 | `mutateLand` mode 1 补 `level:0, flast:0`（`mutateFacility` 的 mode 1 已正确） |
| 6 | %s 公告地價調漲３０％ | `rand()%(地+设施)` 挑一处；地块支逐块 `strcmp` 后 `price×1.3`（`0x449601..0x449680`）；**设施支无循环**，只改选中那处（`0x449682..0x449721`，本轮回读）；常量 `0x4654dc`=1.3 | `news-effects.ts:387-414`：地先设施后、同名地块全改、设施只改选中那处、`Math.trunc`（`0x457dbc` 本轮回读＝RC=11 的 `frndint`＝向零截断） | — | — | 无需修复（★ news.md §3 的「精确规则」把设施支也写成逐块 `strcmp`，与 exe 冲突，**exe 支持 remake**） |
| 7 | 公開拍賣公有土地一處 | 候选 = `owner==0` 的地+设施（`0x449766`/`0x449798`），pass 1 `auction_entry(id,-1,1)`（`0x4498a1`） | `news-effects.ts:644-657`；`reduce.ts:3495-3510` 以 `seller:-1` 开拍 | — | — | 无需修复 |
| 8 | 公開表揚第一大地主 | 按 `land.owner`+`facility.owner` 计数（`0x4498f5`/`0x44992c`）取最大（并列取首），奖 `10000*p` 进现金（`0x449994`） | `reduce.ts:3592-3622` `newsTargets` case 8；`receiveMoney` 默认 `toCash=true`（`payment.ts:290`） | — | — | 无需修复 |
| 9 | 公開補助土地最少者 | 同一套计数取最小（`best` 初值 `0x2710`、`<=` 不更新 ⇒ 并列取最后），奖 `5000*p`（`0x449b17`/`0x449b6a`） | `reduce.ts:3623-3628` case 9；`event-table.ts:298` factor 5000 | — | — | 无需修复 |
| 10 | 公開表揚股市第一大戶 | 累加 `dword[0x4971a0+p*0x60+i*8]`（持股数）取最大（`0x449be2`/`0x449bfd`），奖 `10000*p` | `newsTargets` **无 case 10** ⇒ 落 `default:[currentPlayer]`（`reduce.ts:3637-3638`）；可行性 `anyoneHoldsStock` 因传空数组恒 false（`reduce.ts:3431`、`news.ts:97-106`） | 算法错 | 阻断 | 补 case 10 的持股统计；可行性喂 `state.holdings` |
| 11 | 所有人繳交所得稅５％ | `trunc(现金(+0x1c) × 0.05)`（`0x4655a4`；`0x449cee`/`0x449cfa`），跳过 0，`pay_money(p,-1,tax,0)`；不乘物价 | `percentage.ts:73-75`；`news-effects.ts:785-816`；`reduce.ts:3632-3636` affected=全部在场 | — | — | 无需修复（缺 `0x46caf8` 闸见 N-A8） |
| 12 | 所有人繳交地價稅５％ | 基数 = Σ 地(`level*+0x1e + +0x1c`) + Σ 设施(`level*+0x24 + +0x22`)；`trunc(基数×0.05)` **之后**才 `imul price_index`（`0x449f1b..0x449f41`） | `percentage.ts:109-144`（顺序与 D-QNUM-2 订正一致） | — | — | 无需修复 |
| 13 | 所有人繳交證交稅５％ | 市值 = Σ `持股数 × 单精度股价(+0x14)`（`0x44a0e5`/`0x44a0f9`）；`trunc(市值×0.05) × p` | `percentage.ts:154-182`；但可行性 `anyoneHoldsStock` 恒 false ⇒ **该事件永不出现** | 缺失 | 严重 | 可行性喂真持股；单精度累加已登记 D-QNUM-3 |
| 14 | %s 房屋鬧鬼，地價下跌３０％ | 与 6 对称：候选池不过滤（`0x44a238`），同名地块 ×0.7、设施只改选中那处（`0x46561c`=0.7） | `news-effects.ts:387-414` | — | — | 无需修复（同 6 的规格文本冲突） |
| 15 | %s 一處民宅瓦斯爆炸 | 候选**只住宅**且 `level!=0`（`0x44a484`），`0x40ab4a(land_id,0)` | `news-effects.ts:524-547`（`landsOnly`+`builtOnly`）+ `monster.ts:71-77` | — | — | 无需修复 |
| 16 | 豪雨特報，行人休息一回合 | `who_plays!=0` 且 `traffic_method==0` 者 `+0x38 = 1`（赋值，`0x44a64a`） | `news-effects.ts:681-694` | — | — | 无需修复 |
| 17 | 交通阻塞，汽車停止一回合 | 同上取反（`0x44a657`） | `news-effects.ts:681-694` | — | — | 无需修复 |
| 18 | %s 強烈地震房屋倒塌 | 挑一处；同名地块全 `level-1`（`0x44a855`），商業用地 `level=0,type=0`（`0x44a862`）；设施只改选中那处、减到 0 才清 type（`0x44a8e9`） | `news-effects.ts:471-510` + `monster.ts:71-83` | — | — | 无需修复 |
| 19 | %s 山洪爆發土地流失 | 挑一处（地+设施，不过滤，`0x44a936`），`0x40ab4a(id,1)` 完全清除 | `news-effects.ts:512-564`（`clearOwnerAny`）+ `monster.ts:78-79` —— 同 5，`level` 未清零 | 数值错 | 阻断 | 同 5 |
| 20 | %s 超級颱風侵襲 | 本轮回读 `0x44ac3b`: `push -1 / push 0 / push 6 / push 0x64 / call 0x40ac7b`；cdecl 下 arg0=0x64（半径）、arg1=6（flags=住宅+设施、不打人）、arg2=0、arg3=-1；`0x40acd1` 分支会 `level-1` | `news-effects.ts:421-465` `typhoonBlast`（`TYPHOON_RADIUS=0x64`、flags 6、`mutateLand`/`mutateFacility`） | 无法判定 | 阻断 | ★ **规格与 exe 冲突**：news.md §3 news[20]「只播动画不改状态」只对函数体自身的直写成立，`call 0x40ac7b` 会改地产 —— exe 支持 remake，建议修订规格；范围口径（地图坐标方窗 vs 原版视图空间方窗）为已知近似 Q-TOOL-1 |
| 21 | %s 龍捲風侵襲 | 挑一处（不过滤），`0x40ab4a(id,0)`（`0x44adf5`） | `news-effects.ts:512-564`（`demolishAny`） | — | — | 无需修复 |
| 22 | 銀行擠兌停止放款１５天 | 全体 `who_plays!=0` 者 `+0x3c = 0xf`（`0x44aeb6`/`0x44aed2`）；唯一写入点 | `news-effects.ts:659-666`（`LOAN_FREEZE_DAYS=15`）；`blocking.ts:168` 递减 | — | — | 无需修复 |
| 23 | 銀行加發１０％儲金紅利 | **仅 `loan==0`**（`0x44af3c test ebp,ebp / jne 0x44b004`）；`bonus=trunc(存款×0.1)`（`0x465734`）；`0x41d3f4(p,bonus,0)` ⇒ 回**存款** | `news-effects.ts:198`+`785-816` 无 `loan!=0` 过滤；`receiveMoney` 默认 `toCash=true`（`payment.ts:290`）⇒ 进**现金** | 数值错 | 阻断 | 补 `p.loan!==0 → 跳过`；改成进存款（`toCash=false`） |
| 24 | 股市低迷不振重挫崩盤 | 12 支 `+7` 全写 1（`0x44b035`），随后 `call 0x429040(0)` **立刻重算股价**（`0x44b04b`） | `news-effects.ts:706-712` 只置 `newsFlag=1`，**没调 `applyStockNews(market,0)`**（对照 30..35 的 `:629`） | 缺失 | 严重 | 置 flag 后补 `applyStockNews`（stockId=0 = 全部） |
| 25 | 股市氣勢如虹全面上漲 | 12 支 `+7 = 0x10`（`0x44b07e`）+ `0x429040(0)` | 同上（flag 0x10），同样缺重算 | 缺失 | 严重 | 同 24 |
| 26 | 股市暫停交易１０天 | `dword[0x4990dc]=0xa`（`0x44b0c6`）；`fcn_00428d01` 只看 `!=0` ⇒ 实关门 11 天 | `news-effects.ts:718-722`；`stock-market.ts:470-474` 复刻「减到 0 置 0x80」 | — | — | 无需修复 |
| 27 | %s 股票暫停交易１０天 | `rand()%12`；`+6=0xf`（`0x44b154`）；`+0x14(现价) := +0x10(开盘价)`（`0x44b174`/`0x44b17b`）再把该价写进历史 `0x497328+i*0x240+day*4`（`0x44b193`）；`day=[0x499100]-1`，`-1→0x8f`（`0x44b15b..0x44b166`）。字段偏移见 `stocks.md:68-69` | `news-effects.ts:745-759`：`f6=0xf`、`price=openPrice`、`history[i][day]=新价`、`day=(market.day-1+144)%144` | — | — | 无需修复 |
| 28 | %s 股票恢復上市交易 | 候选 = `+6!=0` 的股票（`0x44b1ca`），`rand()%候选数`，`+6=0`（`0x44b24d`） | 效果已实现（`news-effects.ts:760-768`），但可行性 `stockF6` 传全 0（`reduce.ts:3431`）⇒ **永远抽不到** | 缺失 | 严重 | 可行性喂 `market.stocks[].f6` |
| 29 | %s 違法超貸，經營者坐牢５天 | 候选 = `on_map_commercial[+0x18]!=0` 且有可行动业主（`0x44b289`/`0x44b352`），`add_prison(owner,5)`（`0x44b361`） | `event-table.ts:319` `literal:null` + 不传 days ⇒ `unimplemented`（`news-effects.ts:821-823`）；`checkCommercialOwner` 写死 false（`reduce.ts:3436`）；`affected` 也会取错人 | 缺失 | 严重 | 传 `days=5`；可行性/目标改为「随机一家有主企业 → 其业主」 |
| 30 | %s 工廠排放污水，罰款10000元 | `rand()%num_commercial+1`；`+0x28 -= 0x2710`、`+0x2c -= 0x2710`；`+0x19<12` 时该股 `+7=3` 并 `0x429040(下标+1)`（`0x44b3d9..0x44b409`） | `news-effects.ts:571-638`（`companyPenalty` 10000、flag 3、`applyStockNews`） | — | — | 无需修复 |
| 31 | %s 海外投資，獲利20000元 | `add … 0x4e20` ×2；`+7=0x30`；`0x429040(下标+1)` | 同上（`companyGain`、flag 0x30） | — | — | 无需修复 |
| 32 | %s 海外投資，虧損20000元 | `sub … 0x4e20` ×2；`+7=4` | 同上（`companyLoss`、flag 4） | — | — | 无需修复 |
| 33 | %s 違規開發山坡地，罰款10000元 | `jmp 0x44b3ad` 完全复用 30（`0x44b53f`） | 同上（`companyPenalty` 10000） | — | — | 无需修复 |
| 34 | %s 製造噪音公害，罰款5000元 | `sub … 0x1388` ×2（`0x44b5e2`），`jmp 0x44b3e7` | 同上（`companyPenalty` 5000） | — | — | 无需修复 |
| 35 | %s 獲利調高一倍 | 候选只收 `+0x28>10000`（`0x44b623`）；`+0x28=2v`、`+0x2c += 2v`（`0x44b692`/`0x44b698`）；`0x44b6ad idiv 0x2710` 用**旧值 ebx**（`0x44b68f` 载入、`0x44b6a6 mov eax,ebx`），`shl 4` 后 `mov bl,al` | 数值算法一致（`news-effects.ts:616-621`：`(trunc(旧值/10000)<<4)&0xf0`，`&0xf0` 与 `&0xff` 对 `x<<4` 等价）；但 `commercials` 传空数组（`reduce.ts:3432`）⇒ 永不出现 | 缺失 | 严重 | 可行性喂 `topo.commercials` + `companyFunds`（★ news.md §3 写「(新值/10000)*16」，exe 是**旧值**，exe 支持 remake） |

### 2.2 命运（`fortune_events`，37 项）

接线与公共机制（横向）：

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| F-A1 | 触发接线 | 与新闻共用跳表 `0x4197e9[3] = 0x41b128 → call 0x44db81`；魔法屋「抽取命運三張」另有循环 `0x431dba..0x431dc5` | `reduce.ts:3261`；`applyMagicRequest({kind:'drawFortune'})` 循环 3 次（`reduce.ts:2177-2187`） | — | — | 无需修复 |
| F-A2 | 顺序表与洗牌 | `0x44baea` 写 `fortune_order[37]`（`0x496b38`）、清 `0x4990b4`；算法与新闻同、**37 次 rand**（本轮回读 `0x44baea..0x44bb45`） | `deck.ts:47-66` + `FORTUNE_DECK_SIZE=0x25`（`deck.ts:18`）；`new-game.ts:387` | — | — | 无需修复 |
| F-A3 | `fortune_check` 的重映射 | 10↔11、12↔13、14/15/16 → `14+traffic_method`，`tm>2` 不可行（`0x44bcb1`/`0x44bd35`/`0x44bda8`/`0x44bdd1`/`0x44bded`；case 15 的 `tm==0 → *v=14`） | `fortune.ts:87-147` 逐 case 同构，14/15/16 统一 `14+traffic` | — | — | 无需修复 |
| F-A4 | 可行性上下文 | 0/1 查住宅 `owner/level`；8/9 查持股；5 查他人手牌；33..36 查 `word[0x4991b6]==0`（`0x44bc12`/`0x44bc51`/`0x44bc84`/`0x44bc5e`/`0x44be03`） | `fortune.ts:94-146`；`reduce.ts:3270-3279` 喂真数据；`gameStage: 0` **写死**（`reduce.ts:3278`） | 无法判定 | 轻微 | `0x4991b6` 语义未决（fortune.md §5.3）⇒ 33..36 恒可行 |
| F-A5 | **加持的随机消耗** | `0x44b896` **只在 `50 < x ≤ 100` 时调 `rand()`**（`0x44b8c1` 的阈值阶梯；`x>100`/`x<0` 直接定档） | `reduce.ts:3293-3299` **无条件** `rng.next() & 1`，并 `rngState: rng.getState()` 无条件写回（`reduce.ts:3325`）⇒ 每抽一次命运多消耗 1 个随机数 | 时序错 | 阻断 | 只在 `50 < value ≤ 100` 档才 `next()`；否则原样写回 |
| F-A6 | **加持的三种问法（逐事件）** | 全 exe **15 处** `call 0x44b896`（本轮回读 `callers`）：`0x44c184`(2) `0x44c280`(3) `0x44c65c`(6) `0x44c771`(7) `0x44c874`(8) `0x44c97c`(9) `0x44caa3`(10) `0x44cbb0`(11) `0x44ccd8`(12/13 共用) `0x44ce39`(14) `0x44cfe3`(15、16 经 `0x44cfdf`) `0x44d176`(17/18/19/23/24/26/30 经 `0x44d172`) `0x44d2ad`(20/21/22/25/27/28/29/31 经 `0x44d2a9`) `0x44d6d4`(32) `0x44d80f`(33..36 经 `0x44d80b`)；后压=arg0：`1/0`=(0,1) 罰金、`1/1`=(1,1) 劫难、`0/0`=(0,0) 獎金 | `event-table.ts:332-369` 的 `blessing` **19 项与 exe 不符**（见下逐条）；`bankBan` 分支还不看倍率 | 算法错 | 阻断 | 见 F3 / F13 / F16 / F18~F31 / F34~F36 |
| F-A7 | 两趟调用 | 37 项全部 pass 1 生效（fortune.md §1.3） | 无 pass 结构（`reduce.ts:3261-3385`） | 接口不符 | 轻微 | 终局等价 |
| F-A8 | 资源索引表 | `0x475fb4` 49 项 uint16（fortune.md §6.3 与 csrc 逐项一致） | `fortune.ts:159-167` `FORTUNE_DATA_IDX` 49 项 | — | — | 无需修复 |

逐条：

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| 0 | 強制拆除房屋一棟 | 候选 = 自有且 `level!=0` 的住宅（`0x44be49`/`0x44be57`）；赔 `level × house_price(+0x1e)` 进现金；`level=0,type=0`，owner 不变 | `fortune-effects.ts:486`：`effects:['give']` 但 `factor===null` ⇒ 直接 `unimplemented`，**什么都没做** | 缺失 | 严重 | 按 0 号事件单独实现（选地→赔款→清 level/type） |
| 1 | 強制徵收土地一處 | 候选 = 自有且 `level==0` 的住宅（`0x44bff2`）；赔 `land_price(+0x1c)`；`owner=0`、`flast(+0x30)=0`（`0x44c0ba..0x44c0db`） | 同上，`unimplemented` | 缺失 | 严重 | 单独实现 |
| 2 | 人頭被盜用冒貸 %d 元 | `amount=10000*p`；`(0,1)`（`0x44c180`）；`r==1` 作废、`r==2` ×2；`loan(+0x24) += amount`（`0x44c1fa`）；再 `0x433b7e(cur)` 与保险理赔（`0x44c201`/`0x44c218`） | `event-table.ts:332` `'penalty'`；`fortune-effects.ts:353-360`；`reduce.ts:3369-3371` 有保险理赔 | — | — | 无需修复（缺 `0x433b7e` 到期日见 2.3 的 P10） |
| 3 | 支票跳票，銀行拒絕往來一個月 | `(0,1)`（`0x44c280`）；`r==1` 免（不加天数）；`r==2` 与 0 同；`add byte [+0x3b],0x1e`（`0x44c2ba`） | `fortune-effects.ts:477-484` 的 `bankBan` **完全不看 `ctx.multiplier`** ⇒ 「免付罰金」时仍加 30 天 | 算法错 | 阻断 | 该分支加 `multiplier===BLESSING_VOID → cancelled` |
| 4 | 侵入銀行電腦，挪用其他人存款 | 逐其他在场玩家 `v=trunc(存款×0.1)`（`0x4659a0`=100.0f），`pay_money(受害者, 当前玩家, v, flags=4)`（先从受害者存款扣、当前玩家进**存款**）（`0x44c357..0x44c3a3`）；**不问加持** | `event-table.ts:334` 标 `effects:['pay']`（方向也标错）且 `factor:null` ⇒ `unimplemented`（`fortune-effects.ts:486`） | 缺失 | 严重 | 单独实现（逐受害者 10% 从存款转给当前玩家） |
| 5 | 今天是你生日，向每人收取一張卡片 | 逐人筛；真人走 `0x44192a` 模态选牌、AI 走 `0x441e77` 随机夺牌（`0x44c462..0x44c51e`）；不问加持 | `fortune-effects.ts:285-325`（真人分帧 `pending.birthdayCard`，`reduce.ts:3375-3383`/`3399-3414`）；已登记 T-055 | — | — | 无需修复 |
| 6 | 強迫出國觀光 %d 天 | 天数 3（`0x44c5eb`）；`(1,1)`（`0x44c65c`）；`0x40d375(slot,days,0)` 写 `+0x33` 并移出当前格，同时 `0x44ba63(player, 2000*days*price_index, 0)` 收**保险理赔**（`0x40d400..0x40d425`） | `event-table.ts:336` `'misfortune'`；`fortune-effects.ts:332-349` 天数与倍率正确；**缺** `2000*days*p` 保险理赔（`reduce.ts:3364-3372` 只为 prison/hospital/loan/14 调保险），也缺位置/占用位处理 | 缺失 | 严重 | 补 `insurancePayoutTo(…, 2000*days*price_index)` 与位置处理 |
| 7 | 被外星人綁架 %d 天 | 同 6，`0x40d375(slot,days,1)`（`0x44c7e8 push 1`） | 同 6（reason=1） | 缺失 | 严重 | 同 6 |
| 8 | 股票違約交割損失股票 %d％ | `(0,1)`；`r==1` 取消；`shares=trunc(持仓×10/100.0f)`，`0x428e23(cur,i,shares,0)`（进公库）；尾 `push 0 / call 0x436b0a` | `event-table.ts:341` `'penalty'`；`fortune-effects.ts:377-419`（`destination='pool'`、`recallFinance`） | — | — | 无需修复（`amount==0` 的股票被跳过、原版不跳，但无副作用） |
| 9 | 變賣所有股票求現 | `(0,1)`；`r==1` 取消；逐支全卖 `0x428e23(cur,i,amount,1)`（进存款）；尾同 8 | 同上（`destination='bank'`，`reduce.ts:3313`） | — | — | 无需修复 |
| 10 | 機車被偷遺失 | `(1,1)`（`0x44caa3`）；`r==2` 与 0 同；`traffic_method=0`、`ndices=1`（`0x44cae4`/`0x44caea`）；`inc byte [0x497324]`（`0x44cb49`，本轮回读）= 道具库存 5 +1（表基址 `0x49731f`，`rules/tools.ts:44,86`） | `event-table.ts:343` `'misfortune'`；`fortune-effects.ts:434-445`（`trafficMethod=0`、`ndices=1`、`toolStock[5]++`） | — | — | 无需修复 |
| 11 | 汽車撞電線桿全毀 | 同 10，计数器 `0x497325`（`0x44cc49`）= 道具库存 6 | 同上（`toolStock[6]++`） | — | — | 无需修复 |
| 12 | 掉進水溝就醫 %d 天 | 天数 3（`0x44cc67`）；`(1,1)`（`0x44ccd8`）；`r==2` 天数 ×2；`0x43ec3f(slot,days)`（`0x44cd65`） | `event-table.ts:345` `'misfortune'`；`fortune-effects.ts:262-275` | — | — | 无需修复 |
| 13 | 騎機車摔傷住院 %d 天 | 跳板（`0x44cd6c`）：pass 1 `jne 0x44ccd4` 复用 fortune[12] 的**生效段**（含 (1,1) 与加倍） | `event-table.ts:346` **无 `blessing`** ⇒ 无加持（不逃过、不翻倍） | 缺失 | 阻断 | 补 `'misfortune'` |
| 14 | 行人闖越馬路罰款 %d 元 | `3000*p`（`0x44cdb1`）；`(0,1)`（`0x44ce39`）；`r==2` ×2；`pay_money(cur,-1,amount,0)`；随后 `0x44f42d` 与保险理赔（`0x44cf11`） | `event-table.ts:347` `'penalty'`；`reduce.ts:3369-3371` 对 `FORTUNE_JAYWALK_FINE` 调保险 | — | — | 无需修复 |
| 15 | 騎機車未戴安全帽，罰款 %d 元 | `3000*p`；`(0,1)`（`0x44cf55 jne 0x44cfdf`）；`tm==0` 时函数体自保转 fortune[12]（`0x44cf40`） | `event-table.ts:348` `'penalty'`；`fortune.ts:131-135` 把 14/15/16 重映射为 `14+traffic`，常规路径与 exe 一致 | — | — | 无需修复 |
| 16 | 汽車超速罰款 %d 元 | 结构同 15，`jne 0x44cfdf`（`0x44d0a4`）⇒ `(0,1)` 罰金域 | `event-table.ts:349` **无 `blessing`** ⇒ 无加持 | 缺失 | 阻断 | 补 `'penalty'` |
| 17 | 請所有人吃大餐，花費 %d 元 | `6000*p`（`0x44d0ee`）；`(0,1)`（`0x44d176`）；**只向当前玩家收，收款方=-1**（`0x44d057`） | `event-table.ts:350` `'penalty'`、factor 6000、`pay`→`PARTY_POOL` | — | — | 无需修复 |
| 18 | 亂丟垃圾罰款 %d 元 | `600*p`（`0x44d1b9`）；`jne 0x44d172`（`0x44d1b7`）⇒ `(0,1)` | `event-table.ts:351` **无 `blessing`** | 缺失 | 阻断 | 补 `'penalty'` |
| 19 | 你家小狗亂大小便，罰款 %d 元 | `1500*p`（`0x44d1f8`）；`jne 0x44d172`（`0x44d1f2`）⇒ **`(0,1)` 罰金域** | `event-table.ts:352` 标成 `'reward'` ⇒ 用獎金口吻：财运高时**把罚款加倍**（原版应「免付」） | 算法错 | 阻断 | 改成 `'penalty'` |
| 20 | 在路邊撿到 %d 元 | `1000*p`；`(0,0)`（`0x44d2ad`）；`r==1` 作废、`r==2` ×2；`0x41d3f4(cur,amount,1)` 进现金 | `event-table.ts:353` **无 `blessing`** | 缺失 | 阻断 | 补 `'reward'` |
| 21 | 在路邊撿到 %d 元 | `2000*p`；`jne 0x44d2a9`（`0x44d34c`）⇒ `(0,0)` | 同上，缺 `blessing` | 缺失 | 阻断 | 补 `'reward'` |
| 22 | 在路邊撿到 %d 元 | `3000*p`；`jne 0x44d2a9`（`0x44d3ec`，本轮回读）⇒ **`(0,0)` 獎金域** | `event-table.ts:355` 标成 `'misfortune'` ⇒ 读 `+0x48`，语义整条错位 | 算法错 | 阻断 | 改成 `'reward'` |
| 23 | 遺失錢包損失 %d 元 | `1000*p`；`jne 0x44d172`（`0x44d430`）⇒ `(0,1)` | `event-table.ts:356` 缺 `blessing` | 缺失 | 阻断 | 补 `'penalty'` |
| 24 | 遺失錢包損失 %d 元 | `2000*p`；`jne 0x44d172`（`0x44d474`）⇒ `(0,1)` | 同上 | 缺失 | 阻断 | 补 `'penalty'` |
| 25 | 意外獲得遺產 %d 元 | `10000*p`；`jne 0x44d2a9`（`0x44d4b7`）⇒ `(0,0)` | `event-table.ts:358` 缺 `blessing` | 缺失 | 阻断 | 补 `'reward'` |
| 26 | 被倒會損失 %d 元 | `8000*p`；`jne 0x44d172`（`0x44d4f9`）⇒ `(0,1)` | `event-table.ts:359` 缺 `blessing` | 缺失 | 阻断 | 补 `'penalty'` |
| 27 | 發票中獎 %d 元 | `4000*p`（`0x44d542`）；`jne 0x44d2a9`（本轮回读 `0x44d53c`）⇒ `(0,0)` | `event-table.ts:360` 缺 `blessing` | 缺失 | 阻断 | 补 `'reward'` |
| 28 | 發票中獎 %d 元 | `6000*p`；`jne 0x44d2a9`（本轮回读 `0x44d57f`）⇒ `(0,0)` | `event-table.ts:361` 缺 `blessing` | 缺失 | 阻断 | 补 `'reward'` |
| 29 | 發票中獎 %d 元 | `8000*p`；`jne 0x44d2a9`（本轮回读 `0x44d5c2`）⇒ `(0,0)` | `event-table.ts:362` 缺 `blessing` | 缺失 | 阻断 | 补 `'reward'` |
| 30 | 付保險金 %d 元 | `5000*p`；`jne 0x44d172`（`0x44d606`）⇒ `(0,1)`；`jmp 0x44cf82` ⇒ 付政府池（**不是**保险公司） | `event-table.ts:363` 缺 `blessing` | 缺失 | 阻断 | 补 `'penalty'` |
| 31 | 領取保險金 %d 元 | `5000*p`（`0x44d64d`）；`jne 0x44d2a9`（本轮回读 `0x44d647`）⇒ `(0,0)`；`jmp 0x44d379` 进现金 | `event-table.ts:364` 缺 `blessing` | 缺失 | 阻断 | 补 `'reward'` |
| 32 | 變賣所有卡片道具 | `(1,1)`（`0x44d6d4`）；`r==1` 逃过；两笔变卖价都 `add word [player+0x30],ax`（进點券） | `event-table.ts:365` `'misfortune'`；`fortune-effects.ts:457-473`；`reduce.ts:3345-3359` | — | — | 无需修复 |
| 33 | 酒醉大鬧警局坐牢 %d 天 | 天数 3（`0x44d797`）；`(1,1)`（`0x44d80f`）；`r==2` ×2；`0x43d593(slot,days)` | `event-table.ts:366` `literal:3`+`'misfortune'` | — | — | 无需修复 |
| 34 | 防礙風化坐牢 %d 天 | 跳板：天数 **5**（`0x44d8e7`），`jmp 0x44d7a8` 复用 33（含 (1,1) 与加倍） | `event-table.ts:367` `literal:5` 但缺 `blessing` | 缺失 | 阻断 | 补 `'misfortune'` |
| 35 | 走私毒品坐牢 %d 天 | 天数 **7**（`0x44d915`），复用 33 | `event-table.ts:368` `literal:7`，缺 `blessing` | 缺失 | 阻断 | 补 `'misfortune'` |
| 36 | 販賣大補帖坐牢 %d 天 | 天数 **9**（`0x44d943`），复用 33 | `event-table.ts:369` `literal:9`，缺 `blessing` | 缺失 | 阻断 | 补 `'misfortune'` |

> F-A6 小结：exe 的实际调用点覆盖 21 个事件号，与 fortune.md §3 的「气运判定」表**完全一致**；
> 而 `docs/deviations/Q-FORTUNE-1.md` 的表只统计「函数体自身含 `call`」的 12 项，漏掉了所有
> **跳进共享尾部**的项（18/19/23/24/26/30 → `0x44d172`；20/21/22/25/27/28/29/31 → `0x44d2a9`；
> 14/15/16 → `0x44cfdf`；13 → `0x44ccd4`；34/35/36 → `0x44d80b`）。
> 该记录的「其余 19 条不问」是错的，需一并修订（见 §四之二 R10）。

### 2.3 场所（监狱 / 医院 / 银行 / 乐透 / 特殊格）

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| P1 | 自然出狱/出院不清占用表 | 释放函数 `0x43d7bf` 对玩家 `call 0x40d6be` 后 `mov byte [ebx+0x496b30], al`(al=0)；医院 `0x43ee6e` 同构 | `confinement.ts:128-135` 的 `release()` **全仓无调用者**；`blocking.ts:52-56` 返回的 `released` 在 `reduce.ts:1639` 被丢弃 ⇒ 占用表永远为 1 | 缺失 | 阻断 | `reduce.ts` 消费 `tickBlocking().released`（或直接调 `release()`）清表 |
| P2 | 占用表未清的可观察后果 | 占用表是落点/新闻的闸门（`0x43d310` 扫描、`0x448f31` 大赦、`0x449122` 延长） | 出狱者仍进 `bailCandidates`（`visit.ts:96-116`）、可被 30 点券「保释」（`applyBail` 写 0x80，`visit.ts:263-265`）；新闻 1/3 也 `(0+n)&0x7f` 把非囚犯重新关起来（`news-effects.ts:355-363`） | 算法错 | 阻断 | 同 P1 |
| P3 | 入狱不传送棋子 | 首次入狱把棋子传到监狱格 `mov ax,[0x48bae0]; mov [+0x74],ax` @`0x43d621..0x43d627`，清 `+0x0e`、写 `+0x13=0xf` | `reduce.ts:2188-2197` 只 `confine()`+`insureConfinement()`，**无 nodeId 改写**（`gateNodeOf` 只在保释用，`reduce.ts:2242`） | 缺失 | 严重 | 入狱/入院时把 `nodeId` 改为监狱/医院格 |
| P4 | 首次入狱不清 `dword[+0x32]` | 首次入狱先 `call 0x40d761`：清两旗标并 `0x40d7a9` 把 `dword[+0x32]=0`（住宿/消失/坐牢/住院四字节） | `confinement.ts:105-114` 只写 `blocking[field]`+占用表 ⇒ 住院中被判刑时 `inHospital`/医院表不消失，住宿中同理 | 缺失 | 严重 | 入狱/入院先把四项归零并清另一张表 |
| P5 | 递减时机 | `0x41c84f` 唯一调用点 `0x419039`（换人函数 `0x418ebd` 内、选定新玩家后立刻），**先 tick 后相位判定**（`0x41905f`；主循环 `0x401da3` 再 `0x418c55`→`0x40c912`） | `reduce.ts:1637-1642` 在 `endTurn`（自己回合**末**）tick；`startTurn`(`881-891`) 看的是 tick 前的值 | 时序错 | 严重 | 把阻碍递减搬到回合开始、并在相位判定之前 |
| P6 | 监狱格保释的人类路径数值 | `0x43cf21-0x43cf4d`：`days=(days_in_prison&0x7f)?:1`，`delta=-100*days*price_index`，`push 囚犯, 当前玩家, delta; call 0x40df69`（成对表 `hostility[囚犯][访客] -= 100×days×物價`，负数夹 0） | `visit.ts:237-269 applyBail()` 只扣点券+写 0x80+清占用；human 与 AI 共用同一函数，`reduce.ts:1484-1550` 无任何敌意写入 | 缺失 | 严重 | 人类保释路径补 `update_hostility(囚犯, 访客, -100*days*p)` |
| P7 | 陷害卡对 NPC 与復仇卡反制 | `0x444599 cmp ebx,4/jge 0x44467a`：目标≥4 **不记** 150×物價但 `push 5; push npc; call 0x43d593`；`0x444652..0x444656 push 0x12/call 0x4413ad` 目标持卡 18 ⇒ 弃卡并把**施卡者**关 5 天（`0x44466f..0x44467d`） | `cards/frame.ts:106` 非玩家目标一律 `fail('wrongTargetKind')`；`:117-139` 只查免罪卡(21)/嫁祸卡(19)，**无 REVENGE(18)**；`cards/registry.ts:487-495` case 17 无反弹分支 | 缺失 | 严重 | 放开 NPC 目标；补 18 号卡反制 |
| P8 | 新闻 4 / 29 的入狱入院天数 | news[4] `add_hospital(p,3)` @`0x449285`；news[29] `add_prison(x,5)` @`0x44b362` | `event-table.ts:293,319` `literal:null`；`news-effects.ts:821-822` 得 null ⇒ `unimplemented`；`reduce.ts:3443-3466` 从不传 days | 缺失 | 阻断 | 传 `days`（3 / 5） |
| P9 | 汽車（道具6）撞人住院 | `0x446f05` 尾部 `0x4470a1-0x4470e4`：逐玩家 `test byte [who_plays],0x40` → `update_hostility(150×物價)` + `push 3; call 0x43ec3f` | `rules/tool-effects.ts:92-110 useVehicleTool` 只改交通方式与退车，**无撞人**（核子弹那支已做：`tool-effects.ts:255`、`reduce.ts:2384`） | 缺失 | 严重 | 补道具 6 的撞人分支 |
| P10 | 90 天贷款到期与强偿 | `0x433b7e`：`到期日==0` 时 `push 0x5a; push date; call 0x45218f`（+90 天，逐日跳过星期日/假日表 `0x4523d5`）；`0x41c86d call 0x436a5a` 每回合判到期，余 0 ⇒ `0x433bd8(player,loan)` 强偿、`loan=0`、`+0x2c`=0 | **全仓无任何赋值**：`places/bank.ts:96-113 borrow()` 不写 `loanDueDate`；只有读（`stock-market.ts:592`、`ai/stock-policy.ts:331`）、清零（`bank.ts:151`、`bankruptcy.ts:121`、`new-game.ts:245`）与测试 | 缺失 | 阻断 | `borrow()` 写 `loanDueDate`（`date+90` 顺延）；补到期强偿 |
| P11 | 贷款输入无上限校验（可超贷） | `0x435228-0x435266`：`0x453544` 返回值**直接** `add [+0x20],edx` / `add [+0x24],edx`，不与 `wealth-loan` 比较 | `bank.ts:101-102` `Math.min(amount, loanCapacity(wealth,loan))`；`reduce.ts:1347-1349` 走同一函数 ⇒ 超贷被截断 | 数值错 | 轻微 | 按 C-FID-4 应去掉夹取，或登记为有意偏离 |
| P12 | AI 自动贷款是赋值而非累加 | `0x4368fc mov dword [ecx+0x496b8c], eax`（**赋值** loan = 額度%×總資產/100），紧接 `0x436906 add [+0x20],eax` | `ai/policy.ts:511` 取 `min(autoLoanAmount(...), loanCapacity)` 后进 `bank.ts:109 loan: player.loan + borrowed`（**累加**） | 算法错 | 严重 | 改成赋值语义 |
| P13 | AI 自动贷款是否死代码 | `player+0x18`(0x496b80) 机械扫描**无写入者** ⇒ 开局恒 0 ⇒ 该分支疑死代码（places.md §7.5 未决） | `ai/personality.ts:170 loanRatio: c.f24`（角色表）+ `new-game.ts:245` 开局拷入 ⇒ AI 真会按身家百分比借款（known-deviations Q3 记为已结案，但与 places.md 冲突） | 无法判定 | 严重 | 需裁定「角色表 f24 → +0x18」这条链是否有 exe 证据 |
| P14 | 储蓄红利缺 `loan==0` 门禁 | `0x44af36 mov ebp,[ebx+0x496b8c]; 0x44af3c test ebp,ebp; jne 0x44b004` ⇒ 有贷款者跳过 | `percentage.ts:78-80 bankDividend(p)` 无 loan 检查；`news-effects.ts:198`+`785-800` 逐人发放 | 算法错 | 阻断 | 同 2.1 的 N23 |
| P15 | 储蓄红利进现金而非存款 | `0x44af5c push ebp`(ebp=0) → `0x41d3f4(player,amount,0)` ⇒ **存款 +=** | `news-effects.ts:802` `receiveMoney(...)` 默认 `toCash=true`（`payment.ts:286`）⇒ **现金 +=**（`news-effects.test.ts:149-159` 把错值钉死） | 数值错 | 阻断 | 同 2.1 的 N23 |
| P16 | 特别融资借入无上限校验 | `0x434665`：`存款+=x; special_finance+=x`，**输入无上限校验**；仅按钮门禁 `0x434e73` | `special-finance.ts:165 take = Math.min(amount, room)` | 数值错 | 轻微 | 去掉夹取或登记偏离 |
| P17 | 暫停放款时 ATM 只给存款模式 | `0x436fdd`：`+0x3c != 0` 时 ATM 只开放存款模式 | `bank.ts:42-47 withdraw()` 无 `bankFreezeDays` 判断；`reduce.ts:1344-1346` 取款照做 | 缺失 | 轻微 | 冻结期内禁取款入口 |
| P18 | 银行格先 ATM 再柜台 | `0x41b396 call 0x4379c9`(ATM) → `0x41b39b cmp byte [0x46caf8],0 / jne` → `0x41b3af call 0x436668`（柜台） | `reduce.ts:1041` 只做 `rebalanceBankOnArrival`；`pendingForSpecial`(`3768-3778`) 把存取款与贷款/融资合成**一个** `kind:'bank'` 待决；`[0x46caf8]` 闸缺失 | 接口不符 | 轻微 | 分两段（ATM → 柜台） |
| P19 | 破产把其名下 NPC 送回监狱/医院 | `0x40ce86-0x40cefd`：`0x40ceb6`/`0x40cef3` 对该玩家的 NPC `call 0x43d593`/`0x43ec3f`（单实参，NPC 分支不读 days） | `reduce.ts:4844-4940 applyBankruptcy` 只释放神明物件、清结构、变卖持股/地/卡/道具；`rules/special-actors.ts` 无 owner 死亡处理 | 缺失 | 严重 | 破产时把该玩家的 NPC 归位 |
| P20 | 乐透投注点击无现金复核 | `0x42fff7-0x430018` 只有 `slot=玩家+1 / 现金-=1000 / 池+=1000`，**无现金判定**（可到 0/负）；屏等 `0x430022 PostMessage(hwnd,0x406,3,0)` 才关 | `lottery.ts:142 if (player.cash < 1000) return fail('notEnoughCash')`；因一屏一注（`reduce.ts:1408 pending:null`）几乎不可达 | 多余实现 | 轻微 | 若要 1:1 则去掉复核（或登记为有意改良） |
| P21 | 受困相位 3/4 直接返回 | 跳表 `0x418c3d`＝`{0x418d88,0x418d99,0x418dc6,0x418e7a,0x418e7a,0x418dc6}`：3/4 → 返回不动作 | `turn-start.ts:124-129 turnController`：`who=3`→'ai'、`who=4`→`WHO_PLAYS_AUTOPILOT(0x04)`→'ai' | 无法判定 | 轻微 | `who_plays` 相位 3/4 的含义（是否可达）未决 |
| P22 | 入狱入口语义 | 首次＝直接赋值（`0x43d65d`，不遮罩）；已在狱＝`(old+days)&0x7f`（`0x43d6c5`/`0x43d6d0`）；NPC 只写槽状态 | `confinement.ts:107-109` 完全一致（含首次 `days>=0x80` 立即待释放、`days==0` 立即恢复行动） | — | — | 无需修复 |
| P23 | 保释点券表与门槛 | `0x475c44`/`0x475ca4` = {30,30,30,30,300,300,300,300}；玩家用 `jg`（严格大于）、NPC 门槛 700 收 300 | `visit.ts:58-59`、`visit.ts:77-82` | — | — | 无需修复 |
| P24 | 保释 AI 路径 | `rand&1==0` 50% 不动、`+0x17` 三路选择器、`rand()` 挑人、只推进真正用掉的随机数 | `visit.ts:164-203`、`reduce.ts:2510-2521` | — | — | 无需修复 |
| P25 | 出狱判定与显示 | 判定 `days & 0x80`（`0x41c8fc`）；显示 `(v&0x7f)+1`（`0x40ca60`/`0x40cad9`） | `blocking.ts:54-56`、`:122-124` | — | — | 无需修复 |
| P26 | 保险理赔 | `days×2000×price_index`（`0x43d72c` 移位链 + `0x43d740 imul`），第一家行業別 4 的企業付、玩家进现金（`0x44ba63`/`0x41d2d6`）；首次与加刑都赔 | `reduce.ts:4414-4428`、`:2196`（无保险公司时不赔＝Q-INS-2） | — | — | 无需修复 |
| P27 | 受困闸门 | `dword[+0x32] != 0`（四字节一起比）+ `+0x36`（`0x40c94c`、`0x40c955`） | `types.ts:752-761 isBlocked`、`turn-start.ts:88-92` | — | — | 无需修复 |
| P28 | ATM 存取款 | 无手续费；超限输入被就地改写成上限（`0x4378d9`→`0x457d61`）；取款后 `0x436b0a(1)` | `bank.ts:27-47`、`reduce.ts:1380` | — | — | 无需修复 |
| P29 | cashRatio 重分配 | 只在 ATM 且 `who_plays≠1`（`0x437a18 cmp cl,1 / jne 0x437acd`）；`day≤7 ×1.5`、`day≥26 ×0.5`、夹 0.1–0.9、`±0.25` 带内不动（`0x437acd..0x437c14`） | `bank.ts:239-294`、`reduce.ts:3721-3734` | — | — | 无需修复 |
| P30 | 存款利息 | 每月 1 日、**仅 `loan==0`**、`trunc(bank × 1.1)`（`0x4381f8`/`0x438207`/`0x43820d`；常量 `0x464e88`） | `monthly.ts:25-70`、`:216-219`；`reduce.ts:3136` | — | — | 无需修复 |
| P31 | 贷款无利息 | 还款只扣本金；`1.1` 只用于 AI 负担判定（`0x464b24`） | `bank.ts` 还款只扣本金；`stock-market.ts:582` 用 1.1 只做卖股门槛 | — | — | 无需修复 |
| P32 | 拒绝往来 | `add byte [+0x3b],0x1e`（`0x44c2ba`）；门禁 `0x43667b`/`0x4379da`；每回合递减+bit7 | `fortune-effects.ts:52,475-486`；`bank.ts:76,98`；`blocking.ts:166,181` | — | — | 无需修复 |
| P33 | 特别融资 | 额度 = 他人存款和（`0x434593`）；借/还、超额垫付 `0x436b5c`；`arg==0` 强制收回并跳过董事長（本轮回读 `0x436c6d cmp ebx,edi / je`） | `special-finance.ts:132-195,238-257`、`reduce.ts:511-525,3865-3877,3837-3842` | — | — | 无需修复 |
| P34 | 破产清算 | `who_plays=0` + `memset(+0x1c,0x4c)`；终局跳过清算；乐透号码释放（`0x40d1a8`）；持股变卖进公库 | `bankruptcy.ts:111-154`、`reduce.ts:4844-4938` | — | — | 无需修复 |
| P35 | 乐透投注/开奖 | 36 槽、1000 元/张、票钱进 `0x499080`；AI `现金≤1000` 不买（`0x43169e jle`）、人类 `现金≥1000` 可进场（本轮回读 `0x42f8d7 jge`）；开奖每月 15 日（`0x41d08a cmp 0xf`）；`rand()%36` 或（有人>10 张）从已售票抽（`0x430b52`/`0x430b66`）；独得全池进现金（`0x430ad9`）；无人中奖全结转（`0x430ac9`） | `lottery.ts:19-59,130-197,281-331`；`reduce.ts:3127-3133,3668-3702` | — | — | 无需修复 |
| P36 | 奖金池语义 | `0x499080` = 所有 `payee==-1` 支出累计 + 票款；唯一清零点是派彩 | `payment.ts:233-234` + `lottery.ts:152` | — | — | 无需修复 |
| P37 | 特殊格得点 | 型别 10/11/12 = 50/30/10 點（`add word [player+0x30]`；本轮回读 `0x41b1d7 +0x32`、`0x41b271 +0x1e`、`0x41b2f5 +0xa`；`0x3e8` 是毫秒） | `special-square.ts:82-96`（`addPoints` 掩 0xffff）、`reduce.ts:997-1001` | — | — | 无需修复 |
| P38 | 型别 4/5/9/14 分派 | 跳表 `0x4197e9`：4→保释、5→出院、9→乐透、10→得点、14→银行 | `special-square.ts:38-63`、`reduce.ts:1021-1041` | — | — | 无需修复 |
| P39 | 命运文本 `0x465a7c` 的调用点 | places.md §7.4 标未决 | 已解：`event-table.ts:346` id 13（`va:0x0044cd6c`、hospital、literal 3）；本轮回读 `0x44cd84 mov eax,3 / mov [0x48c5b4],eax / push 0x465a7c` 确认 | — | — | 规格该「未决」可结案 |
| P40 | 上市公司分红 | 每月 15 日先分红（`0x42ba97`）后开奖（`0x431712`）；按持股比例、进存款 | `places/company.ts:278-304`、`reduce.ts:3112-3126`（DIVIDEND_DAY=15） | — | — | 无需修复 |
| P41 | 旧说法的残留检查 | places.md §8 的 11 条被推翻旧说法 | 全部**无残留**（住院费／踩监狱格入狱／出狱条件 `==0`／月初递减／`hostility[6]`／卡 17 命名／`0x440cac` 扣钱／贷款利息／存款利息全员／存取款可负）；唯「存取款无上限」反转为「贷款输入被夹」（P11） | — | — | 无需修复 |

### 2.4 神明

数据结构（gods.md §1）：

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G1 | objects_info 表 | 基址 `0x496d08`、步长 `0x18`（`0x40eb12`）、46 项（`0x407d3a` 的 `0x450`；`0x407d65 cmp 0x2e`） | `rules/objects.ts:16,18,33`；字段见 `cards/summon.ts:48-60` | — | — | 无需修复 |
| G2 | 字段偏移语义 | `+0x00 type`；`+0x02` 所在格/使用中（`0x40e097`）；`+0x04` 存活回合；`+0x05` 附身对象+1（`0x40eb8b`） | `type`/`nodeId`/`state`/`attached` | — | — | 无需修复 |
| G3 | `+0x01` 字段 | `0x40e11d` 写、`0x40fafd` 读。★ 2026-09-22：规格已解 —— `tools.md` §6.1 的表定为「`sub_00407a8c` 算出的**朝向**（方向码）」，`0x40fafd` 把它抄进 `+0x07` 给动画用 | **有意不建模**：core 的 `MapObject` 只留 type/nodeId/state/attached，朝向由渲染侧按同一条规则现推（`throw-fx.ts` 的 `objectFacing`，判据 `place_object` 的 `0x40e0ea` 取第一个非 0 邻接槽 → `directionOf(本格 − 邻格)`）| — | 轻微 | 无需修复（C-DET-4：朝向是表现层的事）|
| G4 | 槽位→种类表 `0x47ed3c` | 46 byte = 1..14,15,15,16×10,17×10,18×10（`0x407d50`） | `objects.ts:50-56` 逐字节一致；`:134-149 slotRangeForType` 与 `0x40e03e` 跳表一致 | — | — | 无需修复 |
| G5 | 种类→名称表 `0x47ed76` | `0x47ed76+4k`（k=1..16）；`0x40f951` 以 **god_info** 为索引；老虎机用 `0x47ed7a+4·arg` | `data/src/messages.ts:271-291`；`rules/purchase.ts:58-63`（`[16]='路障'`） | — | — | 无需修复 |
| G6 | `+0x3f god_info` | 物件 1 基槽位；写 `0x40eb66`、清 `0x40e1db` | `types.ts:184-190`；`object-landing.ts:302` | — | — | 无需修复 |
| G7 | `+0x40 f64` | 道具物件 1 基槽位；`0x41c001` 写、`0x40e1b2` 清 | `types.ts:191-196`；`object-landing.ts:660-671`、`:224-227` | — | — | 无需修复 |
| G8 | `+0x42` 本月倒楣天数 | `0x496baa`；加法点 6 处 xref（`0x40d431`/`0x41a83f`/`0x43d755`/`0x43ee04`/`0x4441a1`/`0x444372`），月底 `0x439ede` 清零 | `types.ts:207`；部分实现（`reduce.ts:4811`、`cards/sleepwalk.ts:128`、`cards/hibernate.ts:137`） | 无法判定 | 轻微 | 各加法点的触发 spec 未展开 |
| G9 | 修正 A/B/C（int16 有号） | `0x40ebdc`/`0x40ebeb`/`0x40ebfa` 加；`0x40e1f5`/`0x40e204`/`0x40e213` 减；`0x496bac` 仅 2 写 1 读 | `types.ts:224-258`；加减 `object-landing.ts:308-312`/`:233-236` | — | — | 无需修复 |
| G10 | `+0x5c/+0x60` 月度累计 | 本月意外損失/之財（`0x437d43`/`0x437d49`） | `types.ts:262-268`；`payment.ts:226`/`249` | — | — | 无需修复 |
| G11 | `+0x15` 存活旗标 | `0x496b7d`（`0x40ec8b`） | `types.ts:31-34`、`:733-735` | — | — | 无需修复 |

神明清单与修正表（gods.md §2）：

| # | 条目 | 原版规格 | remake 现状 | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G12 | 可附身判定 `0x40ea62` | `0x40ea83 cmp 0xc/jg`、`0x40ea88 cmp 0xb/jne`、`0x40ea8d cmp 0xf/jne` ⇒ {1..10,12,15} | `cards/summon.ts:75-78` | — | — | 无需修复 |
| G13 | 工具渲染缺陷 | gods.md 记 `0x40ea90` 被渲染错（应 `0x40ea97`） | 实测 `rich4-remake/tools/disasm.py` 渲染正确（该缺陷疑仅存于 `rich4-spec/tools/rich4dis.py`） | — | — | 无需修复（工具侧记录） |
| G14 | 12 位神明清单与名称 | 1小財神…15死神；非神明 11/13/14/16/17/18 | `rules/god-power.ts:91-102`；`messages.ts:271-291` | — | — | 无需修复 |
| G15 | 三张修正表数值 | `0x4749e2`/`0x474a06`/`0x474a2a` 各 18×int16（A 含 12=−500、15=+1000/−200/−200） | `objects.ts:191-210` 逐值相同 | — | — | 无需修复 |
| G16 | 表索引=种类 | `0x40ebd4 mov dx,[esi*2+0x4749e2]` | `objects.ts:212-214`；调用方传 `target.type` | — | — | 无需修复 |
| G17 | 修正 A 的唯一消费者 | xref `0x496bac` 仅 `0x437d6a`（月度评分内）×10 | 数值用法正确（`client/monthly-screen.ts:863`）；但 `types.ts:228-233`、`objects.ts:172-174` 描述成「进 AI 的身家估值」 | 接口不符 | 轻微 | 订正注释 |
| G18 | 非神明种类共用物件表 | 11/13/14/16/17/18 的 `0x40ea62` 回 0 | `cards/summon.ts:76` | — | — | 无需修复 |

附身 / 离开 / 送神符（gods.md §3、§5）：

| # | 条目 | 原版规格 | remake 现状 | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G19 | 开局生成 | `0x407d6a`/`0x407d87`（1,3,5,7,9,11）+ `0x407d9e`(0xd) + `0x407db7`(0xe) | `new-game.ts:426-432` 依 `INITIAL_OBJECT_TYPES`（`object-landing.ts:898`）同序 | — | — | 无需修复 |
| G20 | 重复未用表 | — | `objects.ts:97 INITIAL_PLACED_OBJECTS` 同值重复导出、**无调用者**、注释误称「物件下标」 | 多余实现 | 轻微 | 删或改名 |
| G21 | 接触神明图示 `0x41b7ef` | `0x41b7f6 dec/cmp 0x11/ja`；跳表 `0x41b3e5` 逐项 | `object-landing.ts:575-696`（default→attachGod:685、11:595、13:614、14:630、15:676、16:585、17:642、18:657） | — | — | 无需修复 |
| G22 | **魔法屋召唤死神** | `0x411b0a call 0x4339d9(player)`（模态问「你想召喚死神」→ 回传被诅玩家 1 基）→ `0x411b1e` 临时切 `[0x49910c]` → `0x411b35 push ebx/push 7/push 0/push 0xf/call 0x40e033`；`spawn_object` 内 `0x40e0d4 call 0x40ead7` | 缺失：`places/magic-house.ts` 无死神分支；`reduce.ts:1021`→`runMagicHouse`(`:2087-2168`) 不派发；`special-square.ts:63` 只登记 handler 名 | 缺失 | 严重 | 在魔法屋落点补 `0x4339d9` 问答 + spawn 死神(15) |
| G23 | 死神的「少于 2 人不开」「排除自己」 | `0x4339e5`→`0x4339f9 cmp ebx,ebp/je`→`0x4339fd inc edi`→`0x433a01 cmp edi,1/jg`，否则 `xor eax,eax/ret` | 随 G22 一起缺；`runMagicHouse` 无人数/自己检查（转盘入口 `0x43380a` 本身无此闸） | 缺失 | 严重 | 随 G22 |
| G24 | 請神符(23) | `0x444f02` 写所在格；`0x444f11-0x444f18 call 0x40ead7`；`0x444e47 push 0x17/consume_card` 在 attach 之前 | `cards/registry.ts:464-475`；卡先扣（`:819`）再發威（`reduce.ts:2883`），同序 | — | — | 无需修复 |
| G25 | god_activate 前置 | `0x40eaf1 call 0x40ea62`、`0x40eb23` 清 obj+2、`0x40eb35`→`0x40eb3f call 0x40e32c`、`0x40eb66` 写 god_info、`0x40eb84`/`0x40eb94`、`0x40eb9a-0x40eba8` 写 0xd/7、`0x40ebd4` 三表加、`0x40ec0d jmp [edx*4+0x40ea9b]` | `object-landing.ts:278-315 attachGod` | — | — | 无需修复 |
| G26 | 清该格 runtime 旗标 | `0x40ebaf-0x40ebcc`：arg2≠0 时 `[0x498e80+cell*40+0x26]=0` | 无对应（不镜像节点占用位） | 接口不符 | 轻微 | 架构差异，可登记 |
| G27 | god_activate 三个呼叫点 | `callers 0x40ead7` = 3 处：`0x40e0d4`、`0x41b82d`、`0x444f18` | 已接 `0x41b82d`（`object-landing.ts:685`）与 `0x444f18`（`registry.ts:469`）；`0x40e0d4` 随 G22 缺 | 缺失 | 严重 | 随 G22 |
| G28 | 舊神離場 `0x40e32c` | 读 type（`0x40e33a`）→ `0x40e35f call 0x40e14d`；`callers` 实测 **3 处**：`0x40eb3f`、`0x41cc9b`（任期 tick）、`0x444cc4` | `object-landing.ts:289-295`、`:758`；`cards/dispel.ts:57-60` | — | — | 无需修复（★ gods.md §3.3「只有两处呼叫点」漏了 `0x41cc9b`，remake 反而对了） |
| G29 | object_leave `0x40e14d` | type 16/17/18 → `[0x497321/22/23]++`（`0x40e166-0x40e178`）；type18 清 `[player+0x496ba8]`；清 god_info；减三表；清槽；`cmp edx,0xc/jge`+`test dl,1` 成对重生 | `object-landing.ts:209-247`（`OBJECT_TO_TOOL` 16/17/18→库存 2/3/4、type18 清 f64、清+减、`objects.ts:237-239 partnerSlot`） | — | — | 无需修复 |
| G30 | 成对重生规则 | (1,2)(3,4)(5,6)(7,8)(9,10)(11,12)；重生第 4 参 =0 不附身 | `objects.ts:234-239`；`reduce.ts:2055-2077` | — | — | 无需修复 |
| G31 | 送神符（卡 22） | f64 无类型判定先送；god 只放行 `{5,6,7,8,10,15}`（`0x444c9f-0x444cbb`）；`used==0` 不消耗卡（`0x444cd3`） | `cards/dispel.ts:46-66` + `objects.ts:79/91-94` + `registry.ts:455-461`/`:819` | — | — | 无需修复 |

15 项发威（gods.md §4）：

| # | 条目 | 原版规格 | remake 现状 | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G32 | 金额老虎机 `0x440706`+`0x43f23e` | `0x4407c0 and ebx,1/xor bl,1`；拼数 `100*d1+10*d2+d3`（arg==0 再 `+1000*d0`）；四轮 `rand()%10`（`0x43f2d7`）；呼叫点 4 处（`0x40ec60`/`0x40ed3d`/`0x40ef98`/`0x40f061`） | `god-power.ts:148-157`、`:166-194`、`:133`；偏差：原版重掷到真人点击为止，remake 只掷一次（已知偏离 D-003 / Q-GOD-2） | 时序错 | 轻微 | 已知偏离，见 Q-GOD-2 |
| G33 | 1 小財神 | `0x440706(0)`→三位数；跳 `[0x46caf8]≠0`/自己/出局者，`0x41d2c6(other,player,esi,1)`（`0x40ec94 push 1`=进现金）；`esi>0x2bc` 后说台词（`0x48086a+108*角色`） | `god-power.ts:169-170` + `reduce.ts:1909-1929`；**缺** `esi>700` 的台词分支 | 缺失 | 轻微 | 表现层补台词 |
| G34 | 2 大財神 | `0x440706(1)`→四位数；`0x41d3f4(player,esi,1)`；`esi>=5000×物價`（`0x40ed5a-0x40ed74` 的 `*625*8`）时额外台词 | `god-power.ts:172-173` + `reduce.ts:1932-1934`；**缺**额外台词 | 缺失 | 轻微 | 表现层补台词 |
| G35 | 3 小福神 | `0x441e12` 按库存加权抽 1 张、`0x4412e4` 发卡（满 15 先弃一张） | `god-power.ts:179-180` + `reduce.ts:1966-1977`；`rng/watcom.ts:140-149`、`cards/rob.ts:101-113` | — | — | 无需修复 |
| G36 | 4 大福神 | `0x441e12` 连调两次（`0x40eea8`/`0x40eeb5`）；无重复检查 | `god-power.ts:181-182`；`reduce.ts:1969-1975` | — | — | 无需修复 |
| G37 | 5 小窮神 | `0x440706(4)`→三位数；`0x41d2c6(player,other,esi,0)`（进对方**存款**） | `god-power.ts:174-175` + `reduce.ts:1936-1956`；`payment.ts:244-250` | — | — | 无需修复 |
| G38 | 6 大窮神 | `0x440706(5)`→四位数；`0x41d2c6(player,-1,esi,0)` → 公库 | `god-power.ts:177-178` + `reduce.ts:1958-1963` | — | — | 无需修复 |
| G39 | 7 小衰神 | `0x441e77`：`rand()%手牌数` 选一张丢弃 | `god-power.ts:183-184` + `reduce.ts:1986-1991` | — | — | 无需修复 |
| G40 | 8 大衰神 | `0x441ece`：`cmp eax,1/jle 结束`、`sar eax,1` 次循环丢卡 | `god-power.ts:185-186` + `reduce.ts:1992-2003`；边界：重复卡号时原版移除首个匹配、remake 移除当前下标 | 无法判定 | 轻微 | 换 `splice(首个匹配)` |
| G41 | 9 / 10 / 12 无立即效果 | `0x40f205`/`0x40f258`/`0x40f2a0` 只播台词 | `god-power.ts:99/101/191-192`；`reduce.ts:2011-2013` | — | — | 无需修复 |
| G42 | **15 死神不折抵點券** | `0x40f2eb`：`0x40f36d-0x40f373 call 0x445b3f`、`0x40f376-0x40f377 call 0x441f21`，**回传值全丢**（`0x40f37c jmp 0x40f250`）；对照魔法屋 `0x431d3d`/`0x431f62` 才 `add word [player+0x30],ax` | `reduce.ts:2019-2021` `addPoints(c.player.points, t.points+c.points)` 把卖出所得记进**點券**；错误期望被钉进 `state/god-power.test.ts:244-270`（标题写「所得進點券」）；`docs/known-deviations.md:1971` 把它当正解记录、**未标偏离（记录本身有误）** | 算法错 | 阻断 | 丢弃 `points`，只清空+回库存；同步改测试与偏离记录 |
| G43 | 11/13/14 不附身 | 跳表 idx 10/12/13 → `0x40ece6`；`0x40ea62` 对 11/13/14 回 0 | `god-power.ts:189-192` + `cards/summon.ts:76` | — | — | 无需修复 |
| G44 | 自我介绍台词表 | 1→`0x463250`、2→`0x463295`、3→`0x4632cc`、4→`0x46330e`、5→`0x46336c`、6→`0x463381`、7→`0x46338e`、8→`0x4633c0`、9→`0x4633f0`、10→`0x463419`、12→`0x46344e`、15→`0x463495` | core 不含台词（C-ARC-2）；表现层 `client/god-fx.ts`/`god-slot.ts`（Q-GOD-1/Q-GOD-2） | 无法判定 | 轻微 | 表现层已登记 |

显灵（gods.md §4.3）：

| # | 条目 | 原版规格 | remake 现状 | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G45 | **显灵分派 `0x40f381`** | `0x40f39e cmp [+0x32],0/jne`；`0x40f3ab cmp [+0x15],0/je`；`0x40f3d7-0x40f3ff`：`<0xa`→只可能 9、`==0xa`→`0x40f521`、`==0xc`→`0x40f68b`；呼叫点全 exe 仅 `0x418f59`、`0x41b086` | **完全缺失**：core 全域无 `godInfo` 落点分支（`grep godInfo` 只剩 `reduce.ts:1888/4782/4861`、`toll-flow.ts:44/71`、`purchase.ts:87`、`land.ts:115`、`object-landing.ts:750`） | 缺失 | 严重 | 接在 `reduce.ts:1792 applyArrival` 尾 / `reduce.ts:4668 landOnFacility` |
| G46 | 天使顯靈 | `0x40f3ff-0x40f492`：`0xfa0<编号<0x1770` 且 `fac[+0x1a]==0` ⇒ 台词 `0x4634c0` + `0x40f492 call 0x40b110` 加盖一层 | 缺失 | 缺失 | 严重 | 随 G45 |
| G47 | 惡魔顯靈 + 敵意 | `0x40f521-0x40f642`：目标 `level≠0` 且 `owner≠0` ⇒ `0x40f54d-0x40f56a` 合成 **30×物價**，`call 0x40df69(地主,player,30pi)`；再 `0x40f61b 0x40ab4a(编号,0)` 拆一层 | 缺失；`land-mutation.ts:49/90` 的 30 只服务拆除卡/惡魔卡/飛彈 | 缺失 | 严重 | 随 G45 |
| G48 | 土地公顯靈 | `0x40f68b-0x40f8b0`：别人的先付 `地價×物價×(level+2)/5`（`0x40f6c0`/`0x40f6ca`/`0x40f6e7-0x40f705`）；银行格写 `land+0x30`/`fac+0x34`（`0x40f725-0x40f74b`）；`0x40f826` `owner=player+1` | 缺失；`+0x30/+0x34` 在 remake 是地契到期日（`rules/facility.ts:326`） | 缺失 | 严重 | 随 G45 |
| G49 | 显灵台词 | `0x4634c0`「%s顯靈 加蓋一層房屋！」、`0x4634d7`「小惡魔顯靈 拆毀一層房屋！」、`0x4634f2`「土地公顯靈 強佔土地！」 | 全缺 | 缺失 | 轻微 | 随 G45 |

槽位与月度评分（gods.md §6、§7）：

| # | 条目 | 原版规格 | remake 现状 | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G50 | 两套集合不混用 | `{5,6,7,8,10,15}` 只在 `0x444c9f-0x444cbb`；附身判定另为 `{1..10,12,15}` | `objects.ts:79` vs `cards/summon.ts:75-78` | — | — | 无需修复 |
| G51 | 种类 15 独占槽 {15,16} 陷阱 | `0x47ed76` 以 god_info 查名 ⇒ 槽 16 得「路障」；可达性未实测 | `objects.ts:50-56`、`slotRangeForType(15)={14,16}`；`purchase.ts:88` 复刻直查口径；因显灵缺失 + 第二个死神不可生成 ⇒ 不可观测 | — | — | 无需修复 |
| G52 | 槽 16 可达性 | 需两个死神同时存在 | 唯一 type-15 生成点是魔法屋召唤（缺失）；`placeObjectForType` 只占第一个空槽 14 | 无法判定 | 轻微 | 随 G22 后复评 |
| G53 | 月度倒楣值公式 `0x437d1a` | `0x437d43`/`0x437d49` ⇒ 損失−之財；`0x437d55` ×物價×`0x9c4`；`0x437d6a movsx`×10；`0x437d99-0x437df2` 取最大/次大、`fcomp [0x464d58]=0.4`、`jbe` 不颁奖 | ✅ live 在 client：`client/monthly-screen.ts:855-866`/`:878-896`/`:938-952`→`:1826` | — | — | 无需修复 |
| G54 | core 侧重复实现 | — | `core/rules/monthly.ts:130-137 monthlyScore` **无调用者**；`:97-106 MonthlyAccumulators` 字段名反向（`windfall` 标 `+0x5C` 却叫「意外之財」，`f68` 实为 `+0x44` 修正 A） | 接口不符 | 轻微 | 删副本或改为唯一实现 |
| G55 | 领先幅度门槛 | `0x464d58` double 0.4，`jbe` 不颁奖 | `client/monthly-screen.ts:894`（`3*max>5*second` 等价）；`core/monthly.ts:189` | — | — | 无需修复 |
| G56 | 最高/次高为 0 不颁奖 | `0x437dc9`/`0x437dcd` | `client/monthly-screen.ts:891`；`core/monthly.ts:179` | — | — | 无需修复 |
| G57 | 月底结算画面三栏位 | `0x4386fd`+`0x496bc4` 配 `0x464def`；`0x43875d`+`0x496bc8` 配 `0x464dfe`；`0x4387bd`+`0x496baa` 配 `0x464e0d`/`0x464e1c` | `client/monthly-screen.ts:620-633`/`:1134-1141`；`:1104-1105` 旧注释把 `+0x5C`/`+0x60` 写反（代码正确） | 无法判定 | 轻微 | 订正注释 |
| G58 | 倒楣天数累加 | 加法点 6 处 xref，月底 `0x439ede` 清零；触发条件 spec 标未决 | 部分（`reduce.ts:4811`、`cards/sleepwalk.ts:128`、`cards/hibernate.ts:137`） | 无法判定 | 轻微 | 需 spec 展开各点 |
| G59 | 神明只透过 A 表进评分 | `0x437d6a movsx` 有号 ×10（A 正=倒楣） | `client/monthly-screen.ts:863 p.misfortune*10` | — | — | 无需修复 |

gods.md §8 未决清单 + 附（gods.md 未载但属神明行为）：

| # | 条目 | 原版规格 | remake 现状 | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| G60 | `objects_info[+0x01]` | `0x40e11d` 写、`0x40fafd` 读；含义未知。★ 2026-09-22：同 G3 —— 规格定为**物件朝向**，娃娃「打飞」时它被抄进 `+0x07` 当取图用的朝向 | 同 G3（渲染侧现推，不进 state）| — | 轻微 | 无需修复 |
| G61 | B/C 修正的其他消费者 | B 读于 `0x41fb92`/`0x41fc9b`/`0x420c35`/`0x4210e6`/`0x421218`/`0x42187a`/`0x421e08`/`0x44b8c4`/`0x44b94e`；C 读于 `0x44b9d6`；落在租金/罚款/卡片金额区，spec 未展开 | 只覆盖 `0x44b896` 家族（`blessing.ts:81-89`/`128-147`） | 无法判定 | 轻微 | 需 spec 展开 |
| G62 | 同区其余几支 | `0x40f8be`（122 条，读 god_info 与 `0x47ed76`，呼叫点 `0x419a48`）、`0x40fa61`、`0x40fafd`、`0x40fbb8`；`0x40fc00` 已确认为同步所在格。★ 2026-09-22 补：`0x419a48` 的呼叫点不止升級一支 —— `rich4_player_core_actions.asm` 的 `:1079` 買地、`:1169` 付費首建、`:1218` 付費加蓋（jmp `0x419a39`）、`:1726` 買設施 | `0x40fa61` ✅`purchase.ts:30-55`；`0x40fbb8` ✅`toll-flow.ts:67-74`；实测 `0x40f8be` = `god_info∈{3,4}` + 设施 `level==0` → 加盖（福神显灵）**未实现**；`0x40fafd` ★ 2026-09-22 **已接** —— 它**只写物件表的 float 字段**（`+0x06..+0x14`）、不产生任何状态效果，故不进 core：機器娃娃「打飞」那一段由 `client/render.ts` 的 `objectKnockStart` / `objectKnockAt` / `sweptObjectFrameAt` + `#drawSweptFlights` 落码（判据与 13 条口径见 `docs/deviations/Q-TOOL-1.md` 本轮补的那一节）；★ 2026-09-22：上述四路均已接线（`reduce.ts` 五条 case 的 `luckyGodBonus`） | 缺失 | 轻微 | 随 G45 一并处理 |
| G63 | f64 生产者清单 | `0x41c001`（`0x41bfd2` 分支）、`0x41b7bd` | `0x41c001` ✅`object-landing.ts:660-671`；`0x41b7bd` 语义由 `passBomb`（`:548-572`）覆盖 | 无法判定 | 轻微 | 规格未决 |
| G64 | **`0x437d1a` 是否死码** | gods.md §8.5 称「全檔…找不到任何…指向它（死碼）」 | ❌**规格结论有误**：`callers 0x437d1a` 与字节搜索（`e8d5faffff`，文件偏移 226880）都确认唯一 `call` 在 `0x438240`，`0x438245` 写 `[0x48c42f]`（本月悲情人物），`0x43824a` 再 `call 0x437dfe` → `[0x48c430]`（首富）⇒ 不是死码；remake 已正确接线 | 无法判定 | 严重 | 修订规格；core 副本见 G54 |
| G65 | 神明图标落点/移动分派 | 只确认分派表 `0x41b3e5` 与 god_activate 三呼叫点 | `object-landing.ts` 的 `attachGod`（玩家 0..3）；**actor 4..7 的物件分支**在 `npc-walk.ts`（小偷拆陷阱 / 5..7 挨陷阱，第 99 条补齐，见 §7.81）；actor 8 在 `special-actors.ts` 的 `runDoll` | — | — | 无需修复 |
| G66 | 槽 16「路障顯靈」可达性 | 需两个死神同时存在；未实机确认 | 无法生成第二个死神 ⇒ 不可达 | 无法判定 | 轻微 | 随 G22 |
| G67 | 神明对过路费 `0x41d709` | `0x41d72f dec al/cmp 5/ja`；跳表：god1 `sar ebx,1`、god2 `xor ebx,esi`、god3/4 不变、god5 `sar/add`、god6 `lea ebx,[esi+esi]`；呼叫点 `0x419d70`/`0x41a58a`/`0x41aec5` | ✅`rules/god-toll.ts:57-86`；接线 `rules/rent.ts:144`、`reduce.ts:4782` | — | — | 无需修复 |
| G68 | 死神免收 / 他人代付 | `0x41d5f0 cmp god_info,0xf`（只认第一个死神槽）；`0x40fbb8 cmp 0xe/0xf` | ✅`toll-flow.ts:56/44/67-74`；`reduce.ts:1118`/`4794` | — | — | 无需修复 |
| G69 | 禁消费 | `0x40fa61` 的 `{7,8,15}`；`loc_0041a013 cmp god_info,0xc`（土地公挡买无主地） | ✅`purchase.ts:55/86-89`；`land.ts:91/115` | — | — | 无需修复 |
| G70 | blessing 三种用法 | `0x44b8b0`/`0x44b8bb` 两级分派：(0,0)/(0,1) 读 `+0x46`（1/2 对调）、(1,1) 读 `+0x48` | ✅`blessing.ts:81-89`/`128-147`；消费者 `reduce.ts:3299`、`fortune-effects.ts:260/269/335`、`news-effects.ts:319` | — | — | 无需修复（但事件表的**归类**错，见 F-A6） |
| G71 | 任期 tick `0x41cc6c` | `0x41cc88 dec dh`、`0x41cc98 jne`、`0x41cc9b call 0x40e32c`；调用点 `0x419039` | ✅`object-landing.ts:744-767 tickGod` + `reduce.ts:1647-1652` | — | — | 无需修复 |
| G72 | 证据纪律 | 项目口径：不得以 `rich4-re` 为证据 | `rules/objects.ts:75`（引 `rich4-re/docs`）、`rules/monthly.ts:79`（引 `rich4-re/asm/rich4_player_info.h`）、`rules/special-square.ts:5-6`（`@source rich4-re/asm/...`） | 无法判定 | 轻微 | 换成 exe VA 作为 `@source` |

### 2.5 魔法屋

| # | 条目 | 原版规格（证据 @source） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| M1 | 记录表基址/步长/字段 | 基址 **`0x47571C`**、步长 16、12 项；`+0` int32 x、`+4` int32 y、`+8` char* 名称、`+0xC` int32。本轮回读 dump：0=(208,167,`0x464794`,10)、1=(510,150,…)、…、11=(122,154,`0x46481d`,覆写)。取用式 `0x432d30 [edx+0x47570c]`、`0x432d3d [edx+0x475710]`、`0x432e20 [eax+0x475714]`（k=格号 1..12） | `data/src/magic-house.ts:6-11` 宣称基址 `0x475724`、struct `{name,frames,x,y}`；`data/src/binary-truth.test.ts:59` 按此断言；`docs/reverse-engineering-audit.md:139`、`DEVELOPMENT_PLAN.md:715` 同错 | 数值错 | 严重 | 基址改 `0x47571C`、字段序改 `{x,y,name,+0xC}` |
| M2 | 12 项 x/y | 本轮回读：0(208,167) 1(510,150) 2(545,88) 3(568,147) 4(550,234) 5(510,320) 6(422,320) 7(134,318) 8(92,250) 9(72,130) 10(77,85) 11(122,154) | `data/src/magic-house.ts:52-64` 的 x/y **整表差一记录**（id0=(510,150)、id10=(122,154)、id11=(0,0)） | 数值错 | 严重 | 按 M1 的字段序重取 |
| M3 | 转盘 1 图标坐标表 `0x4756E4` | 12 项 int16 对（k=1..12）：(322,91)(414,82)(453,157)(509,242)(458,314)(415,387)(322,394)(239,393)(188,316)(131,222)(184,161)(225,83)；`0x432cc0 [ecx*4+0x4756e4]`/`0x432ccf [+0x4756e6]` 算 ±0x20 的 0x40×0x40 图标框，`0x432d0e call 0x456418` 贴图 | **完全没有这张表**（grep `0x4756e4` 只出现在注释 `client/src/magic-screen.ts:46,279`）；12 个图标改用记录表 x/y 画：`magic-screen.ts:271-274 magicIconAt()` + `:1362 drawAnchored(...)` | 缺失 | 严重 | 补 `0x4756E4` 表；记录表 x/y 是悬停框/名称锚点 |
| M4 | `+0x0C` 字段语义 | 规格说「全档无读者」；**实测有读者**：`0x432dc4 mov edx,[eax+0x475708]`（=record(k−1)+0x0C）→ 当该格**悬停锦缎框图号**（`0x432de6 call 0x456418`，值域 6/7/9/10）。规格扫描区间 `[0x47570C,0x4757E4)` 漏掉基址 `0x475708` | 当「动画帧数」：`data/src/magic-house.ts:32-34`；`magic-screen.ts:341-342 frames===10?2:1`；且按 option i 取 record i 的 `+0xC`（原版 option i 取 record i−1） | 算法错 | 轻微 | 改名为悬停框图号并修正索引 |
| M5 | 互动路径（玩家点格选动作） | `0x43381b cmp byte[eax+0x496b7d],1 / jne 0x43390b`：==1 → `0x4338a8 0x4018e7(0x4325c2,0)` 开窗、`0x4338b7 mov esi,eax` 直接当动作 index；`0x432a74 dec eax/…/call 0x401966`(0x402) 回传 = 格号−1；点 1..12 格即选定（`0x432ea2..0x432f19`） | 只有随机路径：`reduce.ts:1021`→`runMagicHouse`(`:2087`)→`spinMagicHouse`(`:2120`) 永远 `rand()`；无 `whoPlays==1` 分流、无点选、无 pending（`places/magic-house.ts:521-547`） | 缺失 | 严重 | 补互动路径（`pending` + 12 格点选） |
| M6 | 「index 11 永远到不了」 | 只对非互动路径成立（`0x43396d..0x43397e`）；互动路径可到 11（规格 §5.1 已推翻旧说法） | 照抄旧说法并据以不做：`places/magic-house.ts:476-489`、`data/src/magic-house.ts:18-22`、`docs/known-deviations.md:1866-1884`、`DEVELOPMENT_PLAN.md:898`（P0-14） | 算法错 | 严重 | 修订结论；配合 M5 |
| M7 | 动作 11 拍賣當格土地 | `0x43242b..0x4324f5`：`cmp dword[player+0x32],0/jne`；格 `+0x20` 编号须 `2000<编号<6000`（`0x43245f`/`0x43246b`）；`0x4324cc push 1 / push ebx(编号) / push player / call 0x43bde5` | `reduce.ts:2228-2229 case 'auction': return state;`（空实现）；`places/magic-house.ts:443-449` 只发 request，注释漏了编号参数。Q-MAGIC-1 的理由已被规格推翻 | 缺失 | 严重 | 接 `startAuction`（估价/准入已有：`rules/auction.ts:81-90`、`:492`） |
| M8 | 死神召唤入口 `0x4339D9` | 唯一调用者 `0x411e6c → 0x411ae0`（`[0x499104]>1` 且 `0x40dfda()≠0`）；建窗 `0x12/0x14/2`、排受害者头像（`0x433aa3..0x433b19`）、`0x433b26 0x4018e7(0x433088,edi)`；回传 n → `0x411b1e dec eax/mov [0x49910c],eax` + `0x411b35 spawn_object(0xf,0,7,n)` | remake 无对应：`reduce.ts:1021` 只走 `runMagicHouse`；`client/src/main.ts:2662-2699` 把 outcome 2 实现成 `surrenderLocalSeat()`（= `known-deviations.md:2641` 的 setAi），**没有** #0042/#0043 问答、没有 spawn 死神 | 缺失 | 严重 | 同 G22 |
| M9 | 「少于 2 人不开」「排除自己」 | `0x4339e5`→`0x4339f9 cmp ebx,ebp/je`→`0x4339fd inc edi`→`0x433a01 cmp edi,1/jg`，否则回 0 | 随 M8 一起缺 | 缺失 | 严重 | 同 G22 |
| M10 | 动作 5 行动者用错 | `0x431f67` 只查 `dword[player+0x32]` 与格号区间，再 `0x432059 call 0x40b110(编号)`；`0x40b110` 读 `[0x49910c]`（`0x40b1a6`/`0x40b1bb`）——分派器 `0x4320c9 dec eax/mov [0x49910c],eax` 已把它设为**目标玩家** | `reduce.ts:2206 freeBuildFacilityById(state,topo,facIdx,-1)`，其内部 `reduce.ts:4322 const me = state.currentPlayer` 仍是**发起者**（`runMagicHouse` 只在 drawFortune 分支切 currentPlayer） | 算法错 | 严重 | 加蓋期间把「当前玩家」切成目标 |
| M11 | 动作 5 达上限回传 bit7 | `0x40b21a mov eax,0x81`（升到 5 级）；`0x432085 test byte[esp+0xa8],0x80` → `0x43208f call 0x40b0cd`（开 0x20b 框） | 丢弃回传（`reduce.ts:2202-2207`；`freeBuildFacilityById` `:4394-4397` 只回 state） | 缺失 | 轻微 | 表现层提示 |
| M12 | 动作 6 手牌上限 | `0x441e12` 抽牌后 `0x441e64 call 0x4412e4`；`0x4412e4` 内 `cmp 手牌数,0xf / jne` → 满 15 先弃最便宜的一张（`0x44128f`+`0x441343`） | `places/magic-house.ts:375 p.cards = [...p.cards, id]` **完全不看上限**（同仓 `cards/rob.ts:101 giveCard` 已实现该逻辑）⇒ 手牌可 >15，破坏 15 张不变式 | 算法错 | 严重 | 改用 `giveCard` |
| M13 | 动作 9 就地拆除：设施缺失 | `0x432259` 只查 `2000<编号<6000`，再 `0x43234c push 0 / push ebx / call 0x40ab4a`；`0x40ab4a` 地块段（`0x40ab8c`）与设施段（`0x40ac1c`）都实作 | `reduce.ts:2217-2223 case 'demolish'` 只 `landAtPlayer`（=`housingIndexOf`），站设施上直接 `return state` | 缺失 | 严重 | 补设施拆除（走 `mutateFacility`/`0x40ab4a`） |
| M14 | 动作 2/10 的 `0x441210` 闸 | `0x431e54 call 0x441210(玩家)` → `cmp eax,-1/je 结束` → `0x43d593(格,3)`；住院 `0x43240d` 同构；回传 −1 时整个不送（敌意已先加，`0x431e45`） | `reduce.ts:2180-2189` 不镜像格索引，改走 `confine(...)`+`insureConfinement`（无失败出口） | 接口不符 | 轻微 | `0x441210` 语义未决 |
| M15 | 等级 0 时设施种类判据 | `0x40b1ad test byte[player+0x15],6 / je 0x40b1e2`（&6==0 → `0x440aac(0)` 真人菜单）；否则地主==当前+1 → `rand()%4+1`、非地主 → 种类 0 | `reduce.ts:4331 (player.whoPlays & WHO_PLAYS_MASK) !== WHO_PLAYS_HUMAN`（MASK=0x03）判「电脑」；真人菜单 → 不建（Q-MAGIC-2 / Q-CO-1） | 无法判定 | 轻微 | `+0x15 & 6` 的真实语义未决 |
| M16 | 转盘 1 的 12 名称/顺序 | `0x4756B8` 12 指针，串带 `#00NN`（`0x43398c`/`add eax,5` 剥除） | `places/magic-house.ts:37-50 MAGIC_TARGET_NAMES` 逐项一致 | — | — | 无需修复 |
| M17 | 12 动作名称/顺序 | `0x433999 [edx+0x475724]` | `data/src/magic-house.ts:52-64` 名称列逐项一致（已抽查字符串池） | — | — | 无需修复 |
| M18 | 转盘 2 随机路径 | `rand()%11`（`0x43396d mov ecx,0xb`）+ `cmp edx,6/jne / lea esi,[edx+1]`（`0x433979-0x43397e`） | `places/magic-house.ts:489,543-545` | — | — | 无需修复 |
| M19 | 非互动路径 | `rand()%12`（`0x433917`）+ 名单空则重掷（`0x433932`）+ 命中自己强制 6（`0x43395a`） | `places/magic-house.ts:528-546` | — | — | 无需修复 |
| M20 | 目标名单上限 4 | `0x4320ab cmp edi,4/jge` + `0x4320b4 cmp byte[edi+0x48c380],0/je` | `MAX_MAGIC_TARGETS=4`（`places/magic-house.ts:55,175`） | — | — | 无需修复 |
| M21 | 条件 1/2（土地/房屋最多） | 同时扫 `0x498e84`(0x34) 与 `0x498e88`，`+0x19==player+1`，房屋额外 `+0x1a!=0`，`test edx,edx/je` 排除 0（`0x431938`/`0x4319b1`） | `places/magic-house.ts:149-151` + `reduce.ts:2093-2110` | — | — | 无需修复 |
| M22 | 条件 3/4/5 | `+0x1c`/`+0x20`/`+0x30`(word)，各自排除 0、取最大、并列全收 | `places/magic-house.ts:153-157` | — | — | 无需修复 |
| M23 | 条件 6/7/8/9/10/11 | `+0x11 & 3 == 0/1/2`（`0x431b4a`/`0x431b85`/`0x431bbb`）；`+0x3f != 0`；`+0x14 != 0` 男 / `== 0` 女 | `places/magic-house.ts:160-170`（`isMale` 与 `loaders/save.ts:488` 一致） | — | — | 无需修复 |
| M24 | 动作 0 變賣所有卡片 | `0x441f21`（15 槽、回牌堆 `inc byte[卡号+0x499197]`、`+= byte[卡号*8+0x47fdef]` 全额）；`0x431d3d add word[+0x496b98],ax` | `places/magic-house.ts:261-266,307-317`（已抽查卡价表前 10 项） | — | — | 无需修复 |
| M25 | 动作 1 抽取命運三張 | `0x431dbc call 0x44db81` ×3 | `places/magic-house.ts:321-323`；`reduce.ts:2177-2187` | — | — | 无需修复 |
| M26 | 动作 3 原地停留 | `+0x38 = (+0x38+1)&0x7f`（`0x431ed1..0x431ee4`） | `places/magic-house.ts:338` | — | — | 无需修复 |
| M27 | 动作 4 存入所有現金 | `+0x20 += +0x1c ; +0x1c = 0`（`0x431f4d..0x431f5b`） | `places/magic-house.ts:343-349` | — | — | 无需修复 |
| M28 | 动作 7 向後轉 | `+0x32!=0 跳过`；`0x40c78c` 的 `add dl,4/and dl,7`（`0x40c7b8`） | `places/magic-house.ts:202-203,382-386` | — | — | 无需修复 |
| M29 | 动作 8 變賣所有道具 | `0x445b3f`；座驾折回 = 偏移 4/5/11 → 道具 5/6/12；`cmp eax,8/jge` 才不回库存（`0x445bd0`）；`[+0x11]=0`/`[+0x12]=1`（`0x445b92-0x445b9a`）；全额标价 | `places/magic-house.ts:392-420` | — | — | 无需修复 |
| M30 | 动作 2/10 敌意 | `0x40df69(目标, 发起者, 90×物价)`（`0x40dfa3`）；b 取 `[esp+0xb4]`（=帧+0xB0，保存的原当前玩家） | `from:who, to:initiator, delta=priceIndex*90`（`places/magic-house.ts:326-333,432-440`） | — | — | 无需修复 |
| M31 | 建筑上限/名称表 | `0x474940=[1,5,5,1,5]`、`0x475150` 由**设施** `+0x18` 索引（`0x40b1f9`/`0x40b201`）；`land_info` 写死（type0→5 `0x40b13e`、type1→1 `0x40b151`） | `rules/facility.ts:53,376,394` + `reduce.ts:2209-2210`；`MAX_LAND_LEVEL=5` | — | — | 无需修复 |
| M32 | 差异汇总 #5（`+0x0C` 当倍数） | 无证据；唯一倍数是拍卖 `1+0.5×level` | remake 未当倍数（当 frames） | 无法判定 | 轻微 | — |
| M33 | 命中表 `0x48c394` | `0x432b73 shl eax,2/add/shl eax,7/add eax,ecx` = `640*y+x`；表内 0/13 为非格（`0x432cac`/`0x432cb4`） | `client/src/magic-screen.ts:308 magicSectorAt` 用角度近似 | 已偏离，见 T-037 D-MAGIC-6（记录准确） | 轻微 | 表现层，保持登记 |
| M34 | 表重叠 | 第 11 项 `+0x0C` 落 `0x4757D8` 被受害者坐标表（238,330）覆写；但第 11 项 x/y 仍是 (122,154) | 用 TS 数据不保留重叠；`data/src/magic-house.ts:64` 把 id11 x/y 置 (0,0) ⇒ 补上互动路径后拍賣框/字会落 (0,0) | 数值错 | 轻微 | 随 M2 / M7 |
| M35 | spin 重试上限 | `0x433932 je 0x433910` 无上限（理论可死循环） | `MAGIC_SPIN_MAX_RETRIES=32` + 兜底 criterion 0（`places/magic-house.ts:519,528-537`）；**未登记** | 多余实现 | 轻微 | 登记为有意偏离 |
| M36 | criterion 0「財產最多」语义 | best 初值 0（`0x43186b`）→ `0x431892 cmp eax,edx/jle 0x4318a7`+`jne 0x4318b4`：**v≤0 且 v≠0 者不入选**；身家含 `−loan`（`rules/wealth.ts:54`）可为负 | `places/magic-house.ts:97 if (out.length===0 || v>best)` —— 首个候选（即使为负）无条件入选；全员负身家时原版名单空→重掷，remake 选「负得最少的人」 | 算法错 | 轻微 | 复刻 `v≤0` 排除 |
| M37 | 动作 11 估价/准入 | 基准价 = `trunc(单价×(1+0.5×level))×物价`（`0x43be48 fmul [0x4650b0]=0.5f`、`0x457dbc`、`0x43be8a imul [0x4990e8]`）；可投 = 存活且 `现金>基准价`（`0x43c132 cmp eax,[0x48c488]/jg`） | `rules/auction.ts:81-90`、`:492 p.cash<=basePrice → givenUp` —— 与 exe 一致（★ magic-house.md §5.2 注「四捨五入」是规格笔误：实测 CW 高字节 0x1F ⇒ RC=11 向零） | 数值错 | 轻微 | 修订规格文本 |
| M38 | 拍卖模块位置 | — | 任务书列的 `places/auction.ts` 不存在，实作在 `core/src/rules/auction.ts` | 无法判定 | 轻微 | 仅路径差异 |

---

## 三、remake 多出或未见于原版的实现

| # | 条目 | remake 实现（文件:行） | 原版侧证据 / 说明 | 处置建议 |
|---|---|---|---|---|
| 1 | 新闻 20 的 `typhoonBlast` 真的改地产 | `news-effects.ts:421-465`（半径 100、flags 6） | news.md §3 说「只播动画」，但本轮回读 `0x44ac3b` 的 4 个 `push` 与 `0x40ac7b` 的 `level-1` 分支证明原版会拆房 ⇒ **exe 支持 remake**，规格需修订 | 保留实现，回写规格（R1） |
| 2 | `0x497324`/`0x497325` 当成道具库存 5/6 | `fortune-effects.ts:434-445`、`object-landing.ts:415-436`、`rules/tools.ts:44,86`（库存表基址 `0x49731f`） | news/fortune 两规格都把这两个字节列为「未决」；remake 用「`0x49731f + 道具号`」把它解出来了（`0x49731f+5 = 0x497324`） | 保留，回写规格结案 |
| 3 | 魔法屋 spin 重试上限 32 | `places/magic-house.ts:519,528-537` | 原版 `0x433932 je 0x433910` 无上限 | 登记为有意偏离（C-DET-4 需要可终止） |
| 4 | 乐透投注的现金复核 | `lottery.ts:142` | 原版点击处理无现金判定（`0x42fff7-0x430018`），理论可把现金打到负数 | 登记为有意偏离，或按其 1:1 复原 |
| 5 | 贷款额度的就地夹取 | `bank.ts:101-102`、`reduce.ts:1347-1349` | 原版人类输入**无**上限校验（`0x435228..0x435266`）⇒ 可超贷 | 同上（C-FID-4 倾向于复原） |
| 6 | 特别融资借入的额度夹取 | `special-finance.ts:165` | 原版无上限校验（`0x434665`） | 同上 |
| 7 | 土地公附身禁止购地 | `rules/land.ts:91,115`（`GOD_BLOCKS_PURCHASE=0x0c`） | 本轮回读 `0x41a027 cmp byte [player+0x496ba7],0xc / je skip` 确认存在 | 保留（gods.md 未载，属 land 规格） |
| 8 | `INITIAL_PLACED_OBJECTS` 重复表 | `rules/objects.ts:97`（无调用者，注释还把「种类」写成「物件下标」） | — | 删除或改为引用 `INITIAL_OBJECT_TYPES` |
| 9 | `core/rules/monthly.ts monthlyScore` 无调用者副本 | `rules/monthly.ts:130-137`（live 版在 `client/monthly-screen.ts:855-866`） | `0x437d1a` 是 live 代码（见 G64） | 二选一，避免双份规则 |
| 10 | 客户端复制魔法屋目标判据 | `client/src/magic-screen.ts:914 magicTargetsFor`（与 core `magicTargets` 同判据） | 违反 C-ARC-2 的「规则只一份」口径 | 改为消费 core 的 `lastEvent.criterion/targets`（`reduce.ts:2155-2160` 已带出） |
| 11 | 以 `rich4-re` 作为 `@source` | `rules/special-square.ts:5-6`、`rules/objects.ts:75`、`rules/monthly.ts:79` | 项目口径：`rich4-re` 不是权威 | 换成 exe VA |

---

## 四、无法判定项（列出还需要什么证据）

1. **`byte[0x46caf8]`**（新闻 11/12/13 的扣款总闸、银行格柜台的第二闸）：写入者与语义未决
   （news.md §5.3、places.md §1.7），remake 完全没建模。需要：找到写 `0x46caf8` 的指令并判定它
   在正常对局中何时非 0。
2. **`word[0x4991b6]`**（命运 33..36 的可行性闸）：`reduce.ts:3278` 把 `gameStage` 写死 0 ⇒ 33..36
   恒可行。需要：确认该全局是不是「关卡」以及它在 v3.11 的取值。
3. **`player+0x15 == 1` 的语义**（决定魔法屋走互动还是随机路径）：magic-house.md §7.1 明确静态无法
   裁决。需要：实机/动态追踪一次真人落魔法屋，看是否出现 12 格点选窗。
4. **魔法屋命中表 `0x48c394` 的内容**（索引式 `640*y+x` 已知，表本身未解出）：remake 用角度近似
   （T-037 D-MAGIC-6）。需要：dump 该表的尺寸与内容。
5. **`0x441210(player)` 的返回值语义**（坐牢/住院/消失的「取槽位」，`-1` 时整个动作不做）：
   magic-house.md §7.5 列未决；remake 不镜像格索引 ⇒ 无 `-1` 分支。需要：解出该函数内部
   （`0x4413ad(player,0x15)` 与 `0x444bb2`）。
6. **神明修正 B（`+0x46`）/C（`+0x48`）除 `0x44b896` 之外的 9 处消费者**（gods.md §8.2）：
   落在租金/罚款/卡片金额区，算式未展开；remake 只实现了 `0x44b896` 家族。
7. **`objects_info[+0x01]` 的语义**与 **`f64` 的完整道具生产者清单**（gods.md §8.1/§8.4）：
   spec 标未决，remake 未建模 / 由 `passBomb` 覆盖。需要：追 `0x407a8c` 与 `0x41b7bd`。
8. **`player+0x18`（AI 自动贷款额度百分比）的写入者**：places.md §7.5 说机械扫描无写入者、疑死代码；
   remake 用角色表 `f24` 拷入（`ai/personality.ts:170` + `new-game.ts:245`）。需要：确认
   `0x48be34+idx*6+3 → +0x18` 是否有更直接的 exe 证据（否则 remake 多了一条原版没有的行为）。
9. **`0x453544` 输入框的行为**（是否限制长度/非数字）：无法判定；remake 无等价对话框。
10. **乐透投注屏「每格显示哪个数字」的美术对应**（Q-LAYOUT-7）：规则侧已全，需实机截图。
11. **`0x44f2c2` 的台词分档逻辑**（按 `days > 6 / > 3` 选哪一句）：remake 未实现，各分支文本未 dump。
12. **命运/新闻的 pass 0 与 pass 1 的观感差异**：remake 无 pass 结构，终局状态等价，但「面板显示
    的是改前还是改后」这一条需表现层验证。
13. **`+0x15 & 6`（设施等级 0 时是否弹真人选单）与 `who_plays` 的 3/4 相位**：两处都需要 `+0x15`
    位域的完整定义；remake 用 `WHO_PLAYS_MASK=0x03` 近似（`reduce.ts:4331`）。
14. **`0x42ba97`（上市公司分红）的完整分配公式**：places.md §7.9 标未决；remake 已落
    `places/company.ts:278-304`，但「按持股比例」的细节未与 exe 逐条比对。

### 四之二、规格与既有偏离记录本身需要订正的条目（已用 exe 复核，非 remake 缺陷）

| # | 记录 | 原文 | 复核结论（证据） |
|---|---|---|---|
| R1 | `docs/systems/news.md` §3 news[20] | 「★ 复核结论：news[20] 是『只播动画、不改状态』的事件」 | **错**。本轮回读 `0x44ac3b..0x44ac43`：`push -1 / push 0 / push 6 / push 0x64 / call 0x40ac7b`；`0x40ac7b` 的 `test byte [esp+0x24],2`（flags=6 命中）分支 `0x40ad23 dec ch / mov [ebx+0x1a],ch` 会拆房。remake 的实现是对的 |
| R2 | `news.md` §3 news[6] 的「精确规则」 | 「对每一块 facility：若 `strcmp(fac.name, sel.name)==0` → ×1.3」 | **错**。本轮回读 `0x449682..0x449721`：设施支**无循环**，只改选中那一处。remake 与其事件表注释是对的 |
| R3 | `news.md` §3 news[35] 的「精确规则」 | 「`stock[+7] = ((2*v) / 10000 * 16) & 0xff`」 | **错**。本轮回读 `0x44b68f` 载入 ebx=旧值、`0x44b6a6 mov eax,ebx`，除法用的是**旧值**。remake 用旧值是对的 |
| R4 | `places.md` §5.7 | 「现金 ≤ 1000 不能进入投注（人类）」 | 该 `jle` 只是 **AI** 分支（`0x43169e`）；人类是 `0x42f8d7 cmp ..,0x3e8 / jge`（本轮回读）。remake 分了两条判据，与 exe 一致 |
| R5 | `places.md` §7.4 | 「命运文本 `0x465a7c` 的调用点未找到」 | **已可结案**：`0x44cd84 mov eax,3 / mov [0x48c5b4],eax / push 0x465a7c`（= fortune 13）。remake `event-table.ts:346` 正确 |
| R6 | `gods.md` §3.3 | 「（`0x40e32c`）呼叫点…全檔只有两处：`0x40eb3f` 与 `0x444cc4`」 | **不全**。`callers 0x40e32c` 实测 **3 处**，漏了 `0x41cc9b`（神明任期到期 tick）。remake 的 `tickGod` 覆盖了它 |
| R7 | `gods.md` §8.5 | 「`0x437d1a`…全檔找不到任何 4 位元組指標或相對呼叫指向它（死碼）」 | **错**。`callers 0x437d1a` 与字节搜索（`e8d5faffff` @ 文件偏移 226880）都指向唯一 `call` `0x438240`，返写 `[0x48c42f]`（本月悲情人物）。remake 接线是对的 |
| R8 | `magic-house.md` §4.1 / 差异汇总 #2 | 「`+0x0C` 全档无读者」 | **错**。`0x432dc4 mov edx,[eax+0x475708]`（=record(k−1)+0x0C）就是读者，用作悬停锦缎框图号。规格扫描区间漏了基址 `0x475708` |
| R9 | `magic-house.md` §5.2 注 | 「`call 0x457dbc`；四捨五入」 | **不准**。`0x457dbc` = `fnstcw / mov byte[esp+1],0x1f / fldcw / frndint` ⇒ RC=11 = **向零截断**。remake 的 trunc 是对的 |
| R10 | `docs/deviations/Q-FORTUNE-1.md` ① | 加持问法表只列 12 项 + 「其余 19 条不问」 | **错**。详见 F-A6：共享尾部入口使 21 个事件号都问加持；该表须按本报告 F-A6 重写 |
| R11 | `docs/known-deviations.md:1971`（死神發威） | 把「賣光道具+卡片**折點券**」当正解记录 | **错**。`0x40f36d..0x40f37c` 的两次回传值被丢弃；记录应改为「remake 多折了點券」的偏离 |
| R12 | `docs/known-deviations.md:2048-2062`（Q-MAGIC-1） | 理由「原版根本转不到（`rand()%11`）」 | **不成立**。规格 §5.1：随机路径转不到 11，但互动路径（玩家点格）可到 11。记录应改为「本引擎只实现了随机模型」 |
| R13 | `docs/deviations/T-037.md` D-MAGIC-8 / D-MAGIC-3 | 把「原版玩家点选 / remake 用随机」记为**演出**替代；D-MAGIC-3 说 frames 语义未解出 | 口径偏窄：前者是**规则级**偏离（真人动作不由玩家决定）；后者**已解**（第 101 条：字段是图号 `img`，x/y 也一并订正 —— 见 §7.84） |
| R14 | `docs/known-deviations.md:718-722`（Q-MAGIC-2） | 只记「就地加蓋对設施已生效」 | 描述正确，但**漏记**两条：动作 5 的行动者误用发起者（M10）、动作 9 拆除对設施无效（M13） |

---

## 五、建议的修复顺序

### P0 — 阻断级、改动面小（建议同一批做，先补差分测试种子）

1. **出狱/出院清占用表**（P1/P2）：`reduce.ts:1639` 消费 `tickBlocking().released`，对
   `inPrison`/`inHospital` 调 `release()` 清对应槽；顺带确认「大赦/提前出院」也一致。
2. **命运加持表 19 项订正**（F-A6）：按 §2.2 把 13/16/18/20/21/23～31/34～36 补齐、把 19 改
   `penalty`、22 改 `reward`；`bankBan` 分支改为看倍率（F3）；同步重写 `Q-FORTUNE-1`。
3. **加持随机消耗**（F-A5）：`reduce.ts:3293-3299` 只在 `50 < value ≤ 100` 时 `rng.next()`。
4. **news[4]/[29] 传天数**（P8）：reducer 传 `days`（3/5）；news[4] 的 `affected` 改为
   `whoPlays & 0x40`（先对齐位定义，见 §四.13）。
5. **news[23] 两条**（N23/P14/P15）：加 `loan !== 0 → 跳过`；收款改 `toCash=false`（进存款）；
   同步改 `news-effects.test.ts:149-159` 的错值期望。
6. **`mutateLand` mode 1**（N5/N19）：补 `level: 0`、`flast: 0`。
7. **贷款到期链**（P10）：`borrow()` 写 `loanDueDate = date + 90`（顺延星期日/假日表，表已在
   `places/calendar.ts:123-262`）；每回合判到期并强偿。
8. **死神不折點券**（G42）：丢弃 `points`，改 `god-power.test.ts:244-270` 与 `known-deviations.md:1971`。

### P1 — 严重（功能缺失 / 明显不同）

9. **显灵三支**（G45–G49）：在 `applyArrival` / `landOnFacility` 接 `0x40f381` 的 9/10/12 分支；
   一并做 `0x40f8be` 福神显灵（G62）。
10. **魔法屋**：数据表基址与 x/y 整表（M1/M2）+ 转盘 1 图标表（M3）；互动路径（M5/M6）；
    动作 11 接 `startAuction`（M7）；死神入口（M8/M9，与 G22 同一件事）；动作 6 用 `giveCard`
    守 15 张上限（M12）；动作 9 补设施（M13）；动作 5 的行动者切成目标（M10）。
11. **新闻 24/25 立刻重算股价**（N24/N25）：补 `applyStockNews(market, 0)`。
12. **新闻 10 的目标**（N10）+ **可行性上下文五处写死**（N-A6）：喂 `holdings`、`market.stocks[].f6`、
    `topo.commercials`、`companyFunds`、`checkCommercialOwner`、`facilities`。
13. **入狱/入院的传送与状态清理**（P3/P4）：改 `nodeId`、清 `dword[+0x32]` 四字节与另一张表。
14. **阻碍递减时机**（P5）：搬到回合开始、相位判定之前。
15. **监狱格人类保释的敌意**（P6）；**陷害卡的 NPC 目标与 18 号卡反制**（P7）；
    **汽车（道具 6）撞人**（P9）；**破产归位 NPC**（P19）；**AI 自动贷款赋值语义**（P12）。

### P2 — 轻微 / 表现层 / 记录

16. 新闻 `#NNNN` 播语音（N-A7）；命运 6/7 的保险理赔（F6/F7）与坐牢/住院台词分支（G33/G34）；
    魔法屋达上限提示（M11）；`criterion 0` 的 `v≤0` 排除（M36）。
17. `check_news` 0..3 只看槽 0..3（N-A5）；`0x441210`（M14）、`+0x15 & 6`（M15）、相位 3/4（P21）
    等待 §四 的规格补证。
18. 注释/文档订正：`types.ts:228-233`、`objects.ts:172-174`（G17）、`monthly.ts:97-106`（G54）、
    `monthly-screen.ts:1104-1105`（G57）、三处 `rich4-re` 引用（G72）、`objects.ts:97` 重复表（G20）、
    `core/rules/monthly.ts` 死副本（G54）、`client/src/magic-screen.ts:914` 判据重复（§三.10）。
19. 登记新增的有意偏离：魔法屋 spin 上限（M35）、乐透点击复核（P20）、贷款/融资额度夹取
    （P11/P16）、新闻 20 的范围近似（Q-TOOL-1 适用）；并回写 §四之二的 R1–R14。

| G63 | 神明**开场白文案与实际效果不符**（原版自己就不实） | `0x4632cc`（小福神「投資事半功倍」）、`0x46330e`（大福神「投資加倍順利、買地不用錢」）：代码里没有任何折扣/加倍，买地照扣钱（`rich4_player_core_actions.asm:1069 sub [player+0x496b84]`，紧接 `:1079 jmp` 才是福神白送一级） | 1:1 照抄，**不改**（需求方 2026-09-22 裁定「按原版呈现即可」）；注明在 `client/src/god-line.ts` 的 `GOD_LINES` 上方 | 有意保留 | 无 | 逐神明核对表见 `docs/audit-gods-text-vs-effect.md` |
