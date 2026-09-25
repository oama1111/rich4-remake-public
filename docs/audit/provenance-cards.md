# 出处审计台账 —— cards（卡片 / 道具 / 物件 / 库存与取得）

2026-09-24/25，分支 `ds/audit-cards`（已合并 `ds/audit-provenance`：loop + ai-move 的修正）。
每一行都重新开 exe（`tools/disasm.py`）核过 VA；`@source` 旧注释不当真。
状态：`verified` 已核对一致 / `fixed` 原来错、已按原版改（附提交）/ `approx` 有意近似 /
`follow-up` 不一致或未能核实、未改（附原因）/ `n/a` 纯表现或重制版专属。

## 汇总

| 状态 | 条数 |
|---|---|
| verified | 209 |
| fixed | 98（其中 10 条由 loop / ai-move 分支修，合并进来后复核；2026-09-25 复核时 19 条旧 `follow-up`/`approx` 转 `fixed`、新增 8 条；2026-09-25 第二轮 `ds/fu-cards` 再修 1 条（C23-1）、`follow-up`→`verified` 1 条（T09-2）） |
| approx | 14 |
| follow-up | 8 |
| n/a | 3 |
| 合计 | 332 |

### `ds/fu-cards` 分支（2026-09-25，收尾剩余 follow-up）

- `c8fe7c7` **O-37 结案**：同格多件的节点反向索引改成**按位或**（`0x0040e13c`
  `or dword [node+0x24], (槽+1)<<16`），不再取最大槽号。两者在 `1|17 = 17`、`17|27 = 27`
  这两对上恰好相同（所以先前看不出来），但死神（槽 14 ⇒ handle 15）压路障（槽 16 ⇒ handle 17）
  的 `15|17 = 31` 落在**槽 30**（`OBJECT_TYPE_TABLE[30] = 17` = 地雷）⇒ 那一格原版是**炸人**
  （住院 3 天），取最大只会当路障拦下。`objectHandleAt`（落地）与 `nodeObjectIndex`（娃娃扫格）
  两处同一口径；联机镜像 `packages/server/src/object-or-index-mp.test.ts`。
- `e35447d` **C23-1 结案**：請神符真人那一路的候选集本来就不是「全地图」——
  `0x00444d2b push -1 / call 0x40a45c` 摊平的是**屏幕空间**那张 id 图
  （`0x00409dea push 0x5e880` = 440×440×2、`0x00409e99`/`0x00409ea5` 把不在棋盘区里的实例剔掉、
  `0x00409ede` 每个实例只写一粒）⇒ 画不进画面的尊神**请不到**。现在出牌那端把当前镜头
  （含玩家拖过 / 贴边推过）投到 `LAYOUT.board` 筛一遍。
- `8dbf719` **T12-3 复核**：写侧（`useVehicleTool` 的 `engineSavedTraffic/Dice`）与到期侧
  （`tickEngineVehicle`）本分支复核**都已在**（`df14113` / loop），补一条**端到端**用例
  （`reduce(useTool 12)` → 第 8 次日结 → 骑回機車）。
- 本轮**没有**改 `PROTOCOL_VERSION`（协调方统一 bump）。

### 本分支的修正（提交）

- `e524c60` 牌堆守恒：出牌 / 被动卡触发 / 满手弃牌都回牌堆（`remove_card` 0x004413a2），`receive_card` 满手先弃（0x004412e4）；魔法屋 6、公佈欄卡片、小偷偷卡不再硬塞第 16 张。full-game 每步核「牌堆 + 手牌 ≡ 開局」。
- `4d50c54` 購地卡設施支（0x004424be..）+ 到期日重写（0x0044246c / 0x004425e9）；拍賣卡流拍清到期日（0x0044335f / 0x0044348a）；已出局者不能当卡片目标（0x004462d9）。
- `d69e009` 嫁禍卡（0x44476a 电脑支）在夢遊 / 陷害 / 查稅卡里生效（先前恒放弃）；查稅卡放弃转嫁不再白扣 19、嫁回自己不收税（0x00445375）；mode 2 门槛 `>=`；夢遊復仇反弹不加 `+0x42`。
- `fdeb399` 機器娃娃不能当卡片目标（拾取码 0）；陷害卡可关惡人（0x0043d760）；陷害入狱赔保險（0x0043d749）、首次关押 4..6 天掷一次台词随机数（0x44f2c2）；卡片路径补景观表；惡魔卡 0 级設施照放住店者。
- `c53cd65` 放置类 / 交通工具直接 `dec` 不回库存；遙控骰子 1..6；機器工人盖不成照扣。
- `df14113` 傳送機：搬自己拍快照并结束走子（0x004477bb..）、搬地带走到期日清上次過路費（0x00447546..）、目标须无主 0 级；工程車存原座驾（0x00447a49 / 0x00447a55）、`(traffic&3)==3` 判已在开；卡片 / 道具只能在按 GO 之前用。
- `879d5f7` 炸彈 / 乞丐按节点占位位挑人；身上神明 / 炸彈每步跟格（0x40fc00）；搭档在送醫院之前登场；小財神收破产一人后照收。
- `e677c67` 節日送卡（0x00452444，先前整段缺失）；禮物 / 福神 / 董事長赠礼的「好消息」台词随机数（0x44f230）。
- `946757e` 敌意 32 位回绕；紅 / 黑卡停牌股照写；購物中心 / 加油站過路費也问免費卡（0x0041a5d5 只跳旅館）。
- `cccb4a4` 飛彈 / 核彈把爆心的乞丐挪走（0x40cd7d → 0x40cc56）。
- `97dc964` 联机镜像测试（出牌回牌堆 / 走子中出牌被拒 / 路障不回库存）。
- `5290899`（net，已并入的 `ds/audit-provenance` 上）指紋加入道具庫存 `toolStock`（`[0x49731f+id]`）與牌堆 `cardAmount`（`[0x499197+卡號]`，`0x0044133b` / `0x004413a2` / `0x00441f54`）—— I-25 结案。
- `471ef9e` 夢遊 / 陷害 / 查稅卡打到**真人**持卡人時照原版問他：嫁禍卡確認框 / 選人窗（`0x44476a` 真人支 `0x004447a1` / `0x00444834` / `0x004448a1`）、查稅的免費卡確認框（`0x444a60` 真人支 `0x00444ad8`→`0x00444af4`）；卡片效果**掛起**、答完同卡同目標續跑（`CardPassiveTail`），`actingSeat` 歸持卡人（C16-7b / C19-1 / C20-2 结案）。
- `7b9d645` 卡片路徑裡被動卡的亮牌與訊息框 —— 免罪卡生效 `0x00444be8 push 0x46539d` / `0x00444bff call 0x441f73(0x15)`、復仇卡生效 `0x004446c7 push 0x46532c` / `0x004446de call 0x441f73(0x12)`、電腦嫁禍（`0x00444982` 亮牌 + `0x004449df`「嫁禍給%s！」）、電腦用免費卡（`0x00444b0e` 亮牌「使用%s」），聯機各端同一份 notices（CG-3 / C18-5 / C21-3 / C19-7 / C20-3 结案）。
- `5b5d6b9` 送神符送走神明時搭檔登場的參照格取出牌者此刻所在格（`0x00444cc4 call 0x40e32c` → `0x0040e356` / `0x0040e3cd..0x0040e3d4` → `0x40e14d`；炸彈那一支 `0x00444c4b` 直接 `0x40e14d` 不改格）；生日真人答覆的牌堆記賬補測試；先後表補卡片路徑被動卡亮牌。
- `d0b8fdd` 補「下車」（道具表第 14 項 `0x447c00`；道具欄末格載具徽章 = `0x00447e24 mov byte [0x48c556], 0xe`；只給真人 `0x00447dab`、只在騎機車 / 開汽車時出現 `0x00447dee..`）：機車退回道具 5 / 汽車退回道具 6、步行一顆骰子。
- `5256fa6` 真人傳送機照原版兩段拾取（先來源 `0x00447469 push 0x1200036`，再目標 `0x004474f5` / `0x00447598` / `0x00447653`），可搬惡人 / 地上物件 / 附身物件，來源不看歸屬；第二段取消 `0x00447506` / `0x004475a9` ⇒ `0x4479b3` 不扣道具。
- `c40f2f8` 天使卡打 0 級設施的首建種類照原版分電腦 / 真人（`0x004436ad call 0x40b110`：`0x0040b1ad test [+0x15],6` → 電腦 `0x0040b1c5 rand()%4+1` / 公園 0、真人 `0x0040b1e4 call 0x440aac(0)`）；不在棋盤上的惡人點不中（拾取精靈表 `0x00408b82..0x00408b8e` ⇒ 新錯誤 `actorOffBoard`）。

改过的旧测试（原来钉的是错的行为）：`tax.test.ts`（放弃转嫁也扣 19）、`notice.test.ts`（設施一律不问免費卡）、
`land-cards.test.ts`（惡魔卡 0 级設施「不生效」）、`registry.test.ts`（機器娃娃可选、拍賣 followUp 形状）、
`tool-effects.test.ts` / `use-tool.test.ts`（遙控骰子 1..18）、`reduce.test.ts` / `tool-landing.test.ts` /
`tool-robot-worker.test.ts`（機器工人盖不成不扣）、多处测试把出牌 / 用道具的相位改成 `awaitingRoll`。

2026-09-25 复核补的三处（同样是原来钉错了行为）：
- `c40f2f8`：`registry.test.ts` 两条「不在棋盘上的惡人 ⇒ 状态不动但**卡照扣**、判成功」（停留卡 14、夢遊卡 16）与
  `use-card.test.ts` 一条「对在監獄的惡人出停留卡 ⇒ 卡照样消失」—— 三条都改成「**点不中**（`actorOffBoard`）、卡不扣」：
  拾取精灵表只收 `+0x0a == 0` 的惡人（`0x00408b87 cmp byte [惡人+0x0a],0 / jne 跳过`），卡片函数根本走不到那一步。
- `5256fa6`：`teleport.test.ts` 两条 —— 「无主設施搬不动」（`teleportFacility(two(), 2, 5)` 由 `toBeNull()` 改成
  `not.toBeNull()`，来源不看归属）与「★ 設施那一路还没做 —— 不生效也不消耗道具（Q-TOOL-2）」（整条改成搬惡人 /
  地上物件 / 附身物件）。
- `471ef9e`：`reduce.test.ts` 里用機器工人的旧用例补上 `awaitingRoll` 相位（`canUseItemsNow` 的相位闸），
  不是规则断言本身变了。

**状态会变**：几乎每条修正都改规则态或随机数消耗 ⇒ 需要协调方统一 bump `PROTOCOL_VERSION`（本分支未动）。
2026-09-25 复核的逐条（含 `97dc964` 之后落在 `ds/audit-provenance` 上、已经并进来的三个提交）：

- `5b5d6b9` **改状态**（送神符送走神明时，附身物件的格 = 出牌者此刻所在格 ⇒ 搭档登场格不同）、**随机数消耗会变**
  （搭档挑格 `0x40aa6c`（`rand % n`）的候选集随参照格变 ⇒ 掷不掷 / 掷几次可能不同）。
- `d0b8fdd` **改状态**（`trafficMethod` → 0、`ndices` → 1、道具欄里機車 / 汽車 +1 件）；**不掷随机数**
  （`0x447c00` 里没有 `rand`，也没有台词）。
- `5256fa6` **改状态**（真人傳送機现在能搬惡人 / 地上物件 / 附身者、来源不看归属、目标格须空；
  `useTool` 的 `nodeId` / `value` 编码也换成精灵码 ⇒ 联机两端必须同版）；**不新增随机数**
  （`pickFacingAt` 与搬人都是确定性的，`0x447857..` 那一段没有 `rand`）。
- `c40f2f8` **改状态**（天使卡打 0 级設施的首建种类；不在盘上的惡人不再能点中 ⇒ 卡不再被白扣）、
  **改随机数消耗**（电脑 / 託管这一支**新增一次** `rand()`，`0x0040b1c5 call 0x456f2d`；此前一律取
  `buildType ?? 0`、一次都不掷）。
- `471ef9e` **改状态**（真人持卡人那一问：挂起时不落任何状态、答完同卡同目标重跑；`actingSeat` 归持卡人）；
  挂起那一问本身不掷随机数，续跑把同一手前面几步重放（真人局此前一律「放弃」，故后续分支会变）。
- `7b9d645` 只加 notices（`card.absolved` / `card.revenge` / `card.scapegoatOn` / `card.scapegoatTo` / `card.use`）
  ⇒ 不改规则态，但联机各端要认这些 key（`@rich4/data` 的 `PASSIVE_CARD_TEXT`）。
- `5290899` 指纹加入 `toolStock` / `cardAmount` ⇒ **校验和口径变了**（两侧不同版即判 desync；
  旧回报 fixture 仍按不含这两格的口径比）。

`cardAmount` / `toolStock` **已进** `stateFingerprint`（`net/protocol.ts:887-888`，I-25 结案）。
本分支仍**未动** `PROTOCOL_VERSION`。

### follow-up（未改，原因）

（2026-09-25 复核：原先这里的 C16-7b / C19-1 / C20-2 / C20-3、CG-3 / C18-5 / C21-3 / C19-7、C09-5、C06-4、
TX-1 / T14、T11-1 / T11-3 / T11-10 / T11-11 / T11-12、I-25 都已由 `471ef9e` / `7b9d645` / `5b5d6b9` /
`d0b8fdd` / `5256fa6` / `c40f2f8` / `5290899` 改掉或补齐，见下面的提交列表。2026-09-25 第二轮
（`ds/fu-cards`）：C23-1 已由 `e35447d` 修掉、T09-2 复核后转 `verified`（见下），O-37 的残余写在上面。）

- **T01-6 / T08-4** AI 用娃娃后再跑一遍起步前决策（ai-move）、电脑遙控骰子不说台词（表现）。
  本轮复核 T08-4 的 VA：`0x00447250 push 0 / call 0x420eee`（电脑取点数）与
  `0x0044723f` 真人那一支之间只差 `0x00447246 call 0x456e11`（把选中的骰面交给声音层），
  两支汇合后是 `0x0044725c test ebx,ebx / je` → `0x00447260 call 0x40dd1f` →
  `0x00447275 mov [0x475dd8], bl` —— 全程**没有** `player_say`/台词随机数，
  故这一条纯表现、不动随机数（仍留作 follow-up，属 ai-move / 表现）。
- **O-8 / O-38 / O-40 / O-41 / O-52** 只影响随机数条数（原版每天 `srand(GetTickCount())`，跨日本来对不齐）或需要再核 `0x41d2c6` 对破产付款方的行为。
- **O-53** 惡人踩惡犬（npc-walk，跨区）。
- **O-37 的残余**（2026-09-25）：OR 已经逐位复刻（`c8fe7c7`），但原版那一字节是**存下来的** ——
  `release_object`（`0x0040e243 mov byte [node+0x26], 0`）与 `attach_object`（`0x0040ebc7`）
  都把它**整字节清零**。⇒ 「同格两件、先收走一件」时原版那一格就空了（剩下那件虽然还在物件表里、
  `nodeId` 也没清，落地却看不见它），本引擎按现存物件重算 OR 仍看得见。要逐位复刻得在 state 里
  存这张反向索引（`docs/gaps/04-events-places-gods.md` G26），属独立一步、本轮未做。

### 跨区发现（未改，交给对应区）

- 首次关押 4..6 天那一次 `rand()`（`0x44f2c2`）：`sendToConfinement` 已加 `rng` 参数，命運（`events/fortune-effects.ts:519`）、新聞（`events/news-effects.ts` 三处）、魔法屋关人（`state/reduce.ts` magic `prison`/`hospital`）、旅館（`0x41a7e0`）还没传。
- 小偷拿禮物也有 `0x44f230` 台词随机数（`0x0041bafa`）；惡人停在惡犬格会被咬（`0x41b837`，`runNpc` 没这一支）。
- 电脑出卡 / 用道具的真实 `rand()` 门槛（`0x447ff5`、`0x420e9a`）用的是替身随机（ai-move）。
- `rollDice.forced` 由客户端传入、服务器不剥离 ⇒ 联机真人不用遙控骰子也能指定点数（`actions.ts` / `reduce.ts` rollDice）。
- 傳送機自搬之后企業收費读旧的 `stepsTotal`（`[0x48bafc]` 陈值，原版也是 —— 仅提示 toll 区知悉）。
- 魔法屋拍卖流拍：原版 `0x4324d5` 不看 `run_auction` 返回值 ⇒ 流拍**不**清地主；本引擎 `settleAuction` 一律清（places / events 区；拍賣卡那一支本分支已用 `fromCard` 区分到期日，地主清零仍共用）。
- 同一格多个物件时按**按位或**取（`objectHandleAt`，`c8fe7c7`；残余见上面 O-37）。
- ★★ **`Room.#topo` 少了 `landscapes`**（`packages/server/src/room.ts:106-111`；文件里那句「与客户端
  main.ts 的 topo 逐项一致」不成立 —— 客户端四处构造都带了 `landscapes`，如 `main.ts:10536`）。
  后果：**服务器**算出来的入監/入院者停在**格心**，而每个客户端把他挪到監獄／醫院**景观**坐标
  （`send_to_hospital` 的 `0x43ecef` 读景观记录 1、入監同理）⇒ 联机里 `xpos/ypos` 服务器与客户端
  不一致，而 `stateFingerprint` 不收 `xpos/ypos`（见 `provenance-summary.md` §八.3），**指纹照样相等**。
  本轮实测：`packages/server/src/object-or-index-mp.test.ts` 里同一条 `step`，镜像（带 landscapes）
  `xpos/ypos = 319/990`（醫院大樓）、服务器 `384/1056`（格心）。属 net / loop 区，未改。

## 台账

| id | rule | our code (file:line) | exe VA(s) | status | note |
|---|---|---|---|---|---|
| C01-1 | 均富: remove_card at entry; no failure path, returns 1 | cards/registry.ts (consume at end) | 0x4420e4, 0x4421ab | verified | consume-at-end equivalent (hand not read during effect) |
| C01-2 | 均富: sum/count only who_plays byte != 0 | cards/average-cash.ts:70-76 | 0x442133-0x442142 | verified | isAlive &3 same since bankruptcy writes 0 |
| C01-3 | 均富: 32-bit sum, signed idiv trunc | cards/average-cash.ts:74,82 | 0x44213c, 0x442146-0x44214d | verified | |
| C01-4 | 均富: hostility (cash-avg)/100 when avg<cash, (i,cur,d) | cards/average-cash.ts:88-91 | 0x44216d-0x442188 | verified | self dropped by a==b in 0x40df73 |
| C01-5 | 均富: every alive player's cash = avg; bank untouched | cards/average-cash.ts:93 | 0x442193 | verified | |
| C01-6 | 均富: speech + panel refresh | lastCardPlay hint | 0x442118, 0x4421a3 | n/a | display |
| C02-1 | 均貧: human picker 0xe0c0410 / AI param; empty → return 0, card kept | cards/registry.ts, cards/target.ts | 0x4421bf-0x4421e2 | verified | |
| C02-2 | 均貧: target must be player 0..3, not self | cards/target.ts:318-329 | 0x446434-0x44644c | verified | |
| C02-3 | picker rejects who_plays==0 players | cards/registry.ts | 0x4462c6-0x4462e0 | fixed 4d50c54 | see CX-2 |
| C02-4 | 均貧: card removed after pick, before effect | cards/registry.ts | 0x4421f1 | verified | |
| C02-5 | 均貧: avg=(cur+tgt)/2 signed trunc | cards/average-poor.ts:69-71 | 0x442250-0x442259 | verified | |
| C02-6 | 均貧: only target gets hostility (cash-avg)/100 when avg<target cash | cards/average-poor.ts:75-82 | 0x442263-0x442280 | verified | |
| C02-7 | 均貧: both cash = avg | cards/average-poor.ts:84-86 | 0x44228f, 0x442298 | verified | |
| C02-8 | 均貧: AI-only cash animation; target line | — | 0x44229e-0x4422d6, 0x442313 | n/a | display |
| C03-1 | 購地: house land 0x7d0<code<0xfa0 | cards/buy-land.ts:57 | 0x442355-0x442365 | verified | |
| C03-2 | 購地: owner!=0 and owner!=cur+1 else 0 silently | cards/buy-land.ts:62-68 | 0x44237b-0x442393 | verified | chain stores buyable |
| C03-3 | 購地: price=(level*house+land)*pi; fail if price>cash (signed) | cards/buy-land.ts:70-71 | 0x442399-0x4423bb | verified | |
| C03-4 | 購地: cash short → 「現金不足」1500ms, card kept | state/reduce.ts playCard | 0x4425f1-0x442600 | verified | human+AI |
| C03-5 | 購地: hostility = low32 of double landPrice*pi*(level+2)/5 | cards/buy-land.ts:104-119 | 0x4423c4-0x4423fb; 0x46531c=2.0f 0x465320=5.0f | verified | constants dumped |
| C03-6 | 購地: owner=cur+1 | cards/registry.ts | 0x44243e | verified | |
| C03-7 | 購地: pay_money(cur, prevOwner, price, 0) cash→seller bank | cards/registry.ts | 0x44246f-0x442479 | verified | order vs hostility irrelevant |
| C03-8 | 購地: card removed only on success | cards/registry.ts | 0x442603-0x442610 | verified | |
| C03-9 | 購地: facility branch 0xfa0<code<0x1770 (owner checks, price (+0x22 + lvl*+0x24)*pi, cash check, hostility, owner, pay) | cards/registry.ts case 3, cards/buy-land.ts applyBuyFacilityCard | 0x4424be-0x4425ec | fixed 4d50c54 | was fail('notStandingOnLand') |
| C03-10 | 購地: tenure stamp +0x30/+0x34 when [0x499110]!=0 | state/reduce.ts playCard | 0x44244b-0x44246c, 0x4425c4-0x4425e9 | fixed 4d50c54 | kept previous owner's date |
| C04-1 | 換地: not on land/facility → return 0, no picker | cards/registry.ts | 0x44288c-0x44289e | verified | |
| C04-2 | 換地: picker param by footing (0xe0c0202 land / 0xe0c0204 fac); AI param | cards/target.ts:150-155 | 0x442685, 0x4428cc | verified | |
| C04-3 | 換地: same kind, not same square; no owner/level check | cards/swap-and-stock.ts:48 | 0x44639a-0x446429 | verified | |
| C04-4 | 換地: swap owner +0x19 only; level/type/tenure stay | cards/swap-and-stock.ts:51-55,91-95 | 0x4427bb/c1, 0x442a09/0f | verified | no hostility |
| C04-5 | 換地: card removed after swap | cards/registry.ts | 0x442ae2-0x442aeb | verified | |
| C05-1 | 換屋: same standing/picker rules as 換地 | cards/registry.ts | 0x442b38-0x442b85, 0x442d3a-0x442d9b | verified | |
| C05-2 | 換屋: 0x40b4f8 swaps level +0x1a and type +0x18 only | cards/turn-and-house.ts:174-224 | 0x40b6c5-0x40b6da, 0x40b89e-0x40b8b3 | verified | |
| C05-3 | 換屋: no hostility; consumed on success | cards/registry.ts | 0x442f2d-0x442f36 | verified | |
| C06-1 | 轉向: card removed right after pick (even no effect) | cards/registry.ts | 0x442f8a | verified | |
| C06-2 | 轉向: dir=(d+4)&7, no confinement check | cards/turn-and-house.ts:38-40,113-120 | 0x40c7b2-0x40c7be | verified | |
| C06-3 | 轉向: re-pick 来路: slots 0..3 non-0, not blocked, != old; rand()%n only if candidates | cards/turn-and-house.ts:71-88 | 0x40c7df-0x40c852 | verified | |
| C06-4 | 轉向 打不在盤上的惡人：卡片函數本身不查（`0x40c85e-0x40c903`），但拾取精靈表不收（`+0x0a != 0`）⇒ 點不中、卡不扣 | cards/registry.ts:528-536 | 0x40c85e-0x40c903, 0x00408b82-0x00408b8e | fixed c40f2f8 | 舊碼 `noEffect()`（卡照扣、判成功）；拾取層見 CX-4 |
| C06-5 | 轉向: self allowed | cards/target.ts | 0x44630a | verified | |
| C06-7 | 轉向/停留/夢遊/烏龜: actor 8 (doll) not pickable (doll pick code 0; CTZ of low byte) | cards/target.ts ACTOR_MAX | 0x00408a4a, 0x0040d297, 0x4462bc | fixed fdeb399 | ACTOR_MAX 8 → 7 |
| C07-1 | 改建 land: level 0 → return 0 | cards/rebuild.ts:72-74 | 0x4430e9 | verified | |
| C07-2 | 改建 land: type^=1; if !=0 and level>1 → 1; no owner check | cards/rebuild.ts:77-91 | 0x443128-0x443139 | verified | |
| C07-3 | 改建 facility: level 0 → 0; human type window (5), cancel keeps card; AI param | cards/rebuild.ts:154-177 | 0x443174, 0x4431b9-0x4431dc, 0x43fae4 | verified | |
| C07-4 | 改建 facility: type=chosen; type 0/3 and level>1 → 1 | cards/rebuild.ts:178-190 | 0x4431e4-0x4431fe | verified | |
| C07-5 | 改建: consumed on success | cards/registry.ts | 0x443213 | verified | |
| C08-1 | 拍賣: auctions footing land/facility any owner; else 0 | cards/registry.ts case 8 | 0x443256-0x443268, 0x443375-0x443387, 0x443492 | verified | |
| C08-2 | 拍賣: hostility owner-1→cur if owned; double low32 | cards/registry.ts, rules/auction.ts:138-156 | 0x443282-0x4432c6, 0x4433aa-0x4433ef | verified | |
| C08-3 | 拍賣: run_auction(seller=cur, entity, 1) | cards/registry.ts | 0x443345-0x44334f | verified | |
| C08-4 | 拍賣: no buyer → owner=0 | rules/auction.ts:280-290,342-350 | 0x44335b, 0x443486 | verified | |
| C08-5 | 拍賣: no buyer → tenure +0x30/+0x34 = 0 | state/reduce.ts settleAuctionExplicit | 0x44335f, 0x44348a | fixed 4d50c54 | fromCard flag |
| C08-6 | 拍賣: card removed after auction ends (we: at open) | cards/registry.ts | 0x44349f | approx | nothing during auction reads seller hand |
| CX-1 | failed use: state untouched, card kept | state/reduce.ts playCard | per-card | verified | |
| CX-2 | picker rejects who_plays==0 player targets | cards/registry.ts | 0x4462c6-0x4462e0 | fixed 4d50c54 | new 'targetNotAlive' |
| CX-3 | cards / tools only usable before GO (move state 0) | state/reduce.ts canUseItemsNow | 0x00417d65 / 0x0040defe, AI 0x00418e28 before 0x40dd1f | fixed df14113 | useCard/useTool accepted in any phase (online untrusted input) |
| CX-4 | actor 目標必須在棋盤上（拾取精靈表只收 `+0x0a == 0` 的惡人）：轉向 / 停留 / 夢遊 / 陷害 / 烏龜 對不在盤上的惡人 ⇒ **點不中、卡不扣** | cards/registry.ts:536, 555, 603, 691, 738 | 0x00408b82-0x00408b8e (`cmp byte [惡人+0x0a],0 / jne`) | fixed c40f2f8 | 新錯誤 `actorOffBoard`；registry.ts 內三處舊註釋仍寫「卡照扣」未清理（本輪不改源碼） |
| C09-1 | 天使: picker 0xe0c0006 / AI 0x41e6f2(0); 0 → card kept | cards/registry.ts, cards/target.ts:156-159 | 0x4434d3-0x4434f6 | verified | |
| C09-2 | 天使: consumed after pick | cards/registry.ts | 0x443505 | verified | |
| C09-3 | 天使 land: all same-name lands (strcmp +4) incl. unowned/others | cards/registry.ts | 0x443541-0x4435e4 | verified | |
| C09-4 | 天使 land: skip level>=5; house +1; chain 0→1 | cards/land-cards.ts:49-57 | 0x443593-0x4435cb | verified | |
| C09-5 | 天使 facility lvl0（`0x004436ad call 0x40b110`）：電腦（含託管）自己的設施 ⇒ `rand()%4+1`，別人的 ⇒ 公園 0；真人 ⇒ 選類別窗 `0x440aac(0)` 給的 `buildType` | cards/registry.ts:954-964, rules/facility.ts:407-409, client/main.ts:11786-11795 | 0x004436ad, 0x40b1ad, 0x40b1c5, 0x40b1dc, 0x40b1e4 | fixed c40f2f8 | 先前一律 `buildType ?? 0`：電腦不掷隨機、真人沒給也當公園；電腦新吃一次 rand |
| C09-6 | 天使 facility: upgrade while level < max table 0x474940=[1,5,5,1,5] | cards/land-cards.ts:278-285, rules/facility.ts:53 | 0x40b1f9-0x40b21a | verified | table dumped |
| C09-7 | 天使: at max → no change, consumed | cards/registry.ts | 0x4436d9 | verified | |
| C09-8 | 天使: no hostility / passives / gods | — | whole fn | verified | |
| C09-9 | 天使: reaching 5 → sound 0x40b0cd | state/reduce.ts | 0x4435da, 0x4436b5, 0x4436d4 | verified | presentation |
| C10-1 | 惡魔: own land valid target | cards/target.ts:156 | 0x4436f4 | verified | |
| C10-2 | 惡魔 land: same-name loop; hostility level*30*pi if owned; level=0,type=0; no release | cards/registry.ts, cards/land-cards.ts:75 | 0x4437a7-0x4437fc | verified | |
| C10-3 | 惡魔 facility: hostility if owned; ALWAYS level=0,type=0, 0x40dffa release | cards/land-cards.ts applyDevilFacilityCard | 0x004438c4-0x004438cc | fixed fdeb399 | level-0 facility skipped release |
| C10-4 | 惡魔: consumed even when nothing changed | cards/registry.ts | 0x44558c | verified | |
| C11-1 | 怪獸: picker 0x446457: not own, not level 0 | cards/land-cards.ts:110 | 0x446457-0x4464be | verified | |
| C11-2 | 怪獸: hostility level*30*pi before mutation, if owned | cards/monster.ts:160-169,281-290 | 0x4439b0-0x4439e3, 0x443a00-0x443a2f | verified | |
| C11-3 | 怪獸: mutate mode 2 land lvl0 type0 no release; facility + 0x40dffa | cards/monster.ts:122-130,244-251 | 0x40abc8, 0x40ac5e-0x40ac6c | verified | |
| C11-4 | 0x40dffa: hotel stays (+0x32) of in-game players → 0x80 | rules/blocking.ts:211 | 0x40dffa-0x40e021 | verified | |
| C12-1 | 拆除: picker 0xe0c0626 land/fac (not own, not lvl0) + objects 16/17/18 | cards/target.ts:160, cards/land-cards.ts | 0x4464c3-0x446564 | verified | |
| C12-2 | 拆除 land: level-1; chain → 0,type 0; flat 30*pi if owned | rules/land-mutation.ts:75-93 | 0x443c0c-0x443c47 | verified | |
| C12-3 | 拆除 facility: level-1; at 0 → type 0 + 0x40dffa; 30*pi | cards/land-cards.ts:352 | 0x443cd8-0x443d15 | verified | |
| C12-4 | 拆除 object: remove_object (tool stock +1 for 2/3/4; bomb clears carrier +0x40); no hostility | cards/land-cards.ts:171 | 0x443d22-0x443d98, 0x40e14d | verified | |
| C12-5 | 拆除 land level 8-bit dec | rules/land-mutation.ts:85 | 0x443c10 | approx | unreachable (picker rejects lvl 0) |
| C13-1 | 搶奪: picker players 0..3, not self, in game | cards/target.ts | 0x4462c6-0x4462e2, 0x446434 | fixed 4d50c54 | see CX-2 |
| C13-2 | 搶奪: human menu cards+tools; AI 0x41e6f2(1) card id; 0 → kept | cards/registry.ts | 0x441949-0x441a69, 0x441ab9 | verified | |
| C13-3 | 搶奪 tool path: take_tool+give_tool (cap 9, stock) | cards/rob.ts:45-77 | 0x441abd-0x441adb | verified | tool vanishes if robber capped |
| C13-4 | 搶奪 card path: remove_card victim, receive_card robber (full hand discards cheapest; 13 still in hand) | cards/rob.ts:108-166 | 0x441ae2-0x441af5, 0x4412e4 | verified | pool now conserved |
| C13-5 | 搶奪: hostility victim→user = card-table price of id (tool id reads card table too) | cards/registry.ts | 0x443f1a-0x443f2f | verified | table dumped |
| C13-6 | 搶奪: consumed after successful rob | cards/registry.ts | 0x443f40 | verified | |
| C13-7 | 搶奪 AI box 「搶得%s的\n\n%s」 1500ms, cards only | state/reduce.ts cardEffectNotice | 0x441a85-0x441ab1 | approx | tool case garbage name not reproduced |
| C14-1 | 停留: self allowed; NPC 4..7; doll never | cards/target.ts | 0x408a07-0x408a4c | fixed fdeb399 | actor 8 rejected |
| C14-2 | 停留: consumed after pick | cards/registry.ts | 0x443fca | verified | |
| C14-3 | 停留: +0x38 = 0x80 self / 1 others | cards/stay.ts:76 | 0x444064-0x4440cb | verified | |
| C14-4 | 停留 NPC: +14 = 1 | cards/stay.ts:99 | 0x4440d9 | verified | |
| C14-5 | 停留: no hostility / passives / confinement gate | — | — | verified | |
| C15-1 | 冬眠: consumed at entry | cards/registry.ts | 0x4440ed-0x4440f6 | verified | |
| C15-2 | 冬眠: skip self, out of game, x==0, dword +0x32 != 0 | cards/hibernate.ts:122-134 | 0x44414d-0x44416e | verified | |
| C15-3 | 冬眠: hostility 150*pi; +0x37=0; +0x36=5; +0x42 += 5 | cards/hibernate.ts:136-143 | 0x444170-0x4441a1 | verified | |
| C15-4 | 冬眠: no passives; sleepwalker vehicle not restored | — | — | verified | |
| C15-5 | 冬眠 NPC 4..7 with +10==0: +13=0,+12=5 | cards/hibernate.ts:74-89 | 0x4441a9-0x4441be | verified | |
| C16-1 | 夢遊: picker not self; NPC 4..7; doll never | cards/target.ts | 0x446569 | fixed fdeb399 | actor 8 |
| C16-2 | 夢遊: consumed after pick | — | 0x444219 | verified | |
| C16-3 | 夢遊 NPC: if +12==0 set +13=5 | cards/sleepwalk.ts:391 | 0x44449b-0x4444ac | verified | |
| C16-4 | 夢遊: target hibernating → nothing | cards/sleepwalk.ts:241 | 0x4442be-0x4442c5 | verified | |
| C16-5 | 夢遊: hostility 150*pi before passives | cards/sleepwalk.ts:257 | 0x4442cb-0x4442ea | verified | |
| C16-6 | 夢遊: 免罪 consumes 21, ends | cards/sleepwalk.ts:274-287 | 0x4442f2-0x44430b, 0x444c11 | verified | |
| C16-7 | 夢遊/陷害: 嫁禍 19 mode 0 via 0x44476a, computer holder (most hated after this card's hostility, else random) | state/reduce.ts playCard, cards/passive.ts aiScapegoatPick | 0x444310-0x444332, 0x4448b0-0x444971 | fixed d69e009 | was always declined |
| C16-7b | same, human holder: YES/NO box (1 candidate) or pick window; 問前亮牌；答 −1 ⇒ 不嫁禍、19 留著 | state/reduce.ts:5828-5872 (suspendCardPassive), state/reduce.ts:5519-5550 (resumeCardPassive), client/main.ts:3048-3059 | 0x004447ae..0x004448ab | fixed 471ef9e | 卡片效果掛起（不落任何狀態、卡不扣），答完同卡同目標重跑 |
| C16-8 | 夢遊: days 4 self/5 other → +0x37; +0x42+=5; save vehicle; refund tool 5/6 (no stock/cap) | cards/sleepwalk.ts:152-184 | 0x44435e-0x4443df | verified | |
| C16-9 | 夢遊 復仇 bounce: user +0x37=5, vehicle refund, NO +0x42 | cards/sleepwalk.ts:329 | 0x444414-0x444499 | fixed d69e009 | |
| C16-10 | 夢遊 復仇: only when final==original target and holds 18; 18 consumed; days 5 | cards/sleepwalk.ts:318-333 | 0x4443ef-0x44440c | verified | |
| C17-1 | 陷害: picker accepts NPC 4..7 | cards/registry.ts | 0x446569, 0x4462c6 | fixed fdeb399 | |
| C17-2 | 陷害 NPC: send_to_prison(actor,5) +10=1, occupancy | cards/registry.ts | 0x444599 → 0x44467a; 0x43d760-0x43d7b3 | fixed fdeb399 | |
| C17-3 | 陷害: hostility 150*pi before passives | cards/frame.ts:147 | 0x4445a2-0x4445c1 | verified | |
| C17-4 | 陷害: 免罪 → ends | cards/frame.ts:159-171 | 0x4445c9-0x4445e2 | verified | |
| C17-6 | 陷害: days 4 self / 5 other | cards/frame.ts:193 | 0x44460b-0x44461c | verified | |
| C17-7 | send_to_prison core | rules/confinement.ts:360 | 0x43d5d4-0x43d6d0 | verified | |
| C17-8 | first-time prison: 0x44f2c2 rand()&1 when 3<days<=6 | cards/frame.ts path | 0x43d5f9, 0x44f2f4-0x44f317 | fixed fdeb399 | sendToConfinement rng param |
| C17-9 | prison x/y from landscape record 2 | state/reduce.ts playCard ctx | 0x43d643-0x43d652 | fixed fdeb399 | pass landscapes |
| C17-10 | prison tail: insurance 0x44ba63(p, 2000*days*pi) | state/reduce.ts playCard | 0x43d724-0x43d755 | fixed fdeb399 | victim + revenge caster |
| C17-11 | 陷害 復仇: consume 18, send_to_prison(user,5) | cards/frame.ts:222-249 | 0x444652-0x444678 | verified | |
| C17-12 | 陷害: consumed after pick | — | 0x4444fc | verified | |
| CG-1 | hostility applied at end of useCard (exe immediately) | cards/registry.ts | 0x40df69 sites | approx | the scapegoat picker now sees hostility-applied players (d69e009) |
| CG-3 | passive popups 免罪卡生效 0x46539d / 復仇卡生效 0x46532c / 嫁禍 / 免費卡 in card paths | state/reduce.ts:5782-5803, state/types.ts:870-878, data/messages.ts:493-496 | 0x444bfd, 0x4446dc, 0x444999/0x4449df | fixed 7b9d645 | 卡片函數中段亮牌，按觸發次序（先前只做了收費那一段） |
| CG-4 | 「使用%s」 popup before card fn | client | 0x441ca6-0x441cbc | n/a | presentation |
| C18-1 | 18-21 → stub xor eax,eax; can't be played | cards/registry.ts | 0x4420d5 | verified | |
| C18-2 | 復仇 checked only from 16 and 17 | cards/sleepwalk.ts, cards/frame.ts | 0x4443fa, 0x444659 | verified | |
| C18-3 | 夢遊 revenge: after effect, final==original; 18 consumed; caster +0x37=5, vehicle refund, no +0x42 | cards/sleepwalk.ts | 0x4443ef-0x444492 | fixed d69e009 | (= C16-9) |
| C18-4 | 陷害 revenge: caster prison 5 days | cards/frame.ts | 0x444652-0x44467d | verified | |
| C18-5 | revenge flash 「%s\n\n復仇卡生效！」 0x46532c | state/reduce.ts:5789-5790 | 0x4446c0-0x444752 | fixed 7b9d645 | `card.revenge` notice（卡片路徑） |
| C19-1 | 0x44476a human branch: candidates who_plays!=0 and != holder; 1 → YES/NO, many → pick window; no threshold | state/reduce.ts:5828-5872（卡片路徑，471ef9e）, state/reduce.ts:5519-5550（續跑）, toll: runTollTail pending | 0x4447a1-0x4448ab | fixed 471ef9e | 卡片路徑（16/17/26）與收費同一支；問前亮牌 |
| C19-2 | computer pick: 0x40d2d3 most hated (>0, first max, who_plays!=0) else 0x40d31c random (dword +0x32==0) | cards/passive.ts aiScapegoatPick, rules/toll-flow.ts, events/news-effects.ts | 0x40d2d3, 0x40d31c | verified | |
| C19-3 | mode 0 (16,17,0x441210): take candidate, no threshold | cards/passive.ts + state/reduce.ts playCard | 0x444320 / 0x4445f7 → 0x444971 | fixed d69e009 | card paths never redirected |
| C19-4 | mode 1 (tolls): threshold rand drawn even when candidate −1 | rules/toll-flow.ts aiScapegoat | 0x4448fc-0x444932 | fixed (ai-move 1b3c7eb) | |
| C19-5 | mode 2 (tax): computer only; 0.2×cash > 4000×pi in x87 extended ⇒ cash >= 20000×pi | cards/passive.ts aiScapegoatPick | 0x444934-0x44496f | fixed d69e009 | was `>`, human branch had threshold too |
| C19-6 | 19 consumed only when ebx != -1 | cards/tax.ts | 0x4449e7/0x4449ef | fixed d69e009 | tax consumed 19 before the pick; test updated |
| C19-7 | computer redirect: 「%s\n\n嫁禍卡生效！」 + 「嫁禍給%s！」 1500ms | state/reduce.ts:5791-5794 | 0x444978-0x4449e4 | fixed 7b9d645 | 收費早已有；卡片路徑由 `passiveEvents` 補上 |
| C19-8 | tax asks 19 only if tax > 0x7d0; args (ebx, 2, 0) | cards/tax.ts | 0x44534e-0x445360 | verified | |
| C19-9 | 16/17/26: hostility before 21/19 checks; AI pick reads updated table | cards/frame.ts, sleepwalk.ts, tax.ts | 0x4442ea, 0x4445c1, 0x445305 | fixed d69e009 | |
| C19-10 | toll: new payer used for reaper check | state/reduce.ts finishToll | 0x419ec5, 0x41a690 | verified | |
| C20-1 | 0x444a60 computer: rand first, thr=(r%3000+3000)×pi; use iff amt>cash or thr<amt | rules/toll-flow.ts:85, cards/tax.ts | 0x444a9b-0x444ad3 | verified | |
| C20-2 | 免費 human: confirm box; not 1 ⇒ not used | state/reduce.ts:5616-5620 (humanFreeCard), cards/tax.ts:174,198, client/main.ts:3048-3059 | 0x444ad8-0x444b01 | fixed 471ef9e | 收費與卡片路徑（查稅）共用同一問 |
| C20-3 | on use: flash 「使用%s」, remove_card, speech | state/reduce.ts:5544-5548（續跑時）, state/reduce.ts:5795-5801（`passiveEvents`） | 0x444b07-0x444b98 | fixed 7b9d645 | 收費已有；卡片路徑的免費卡亮牌 471ef9e + 7b9d645 |
| C20-4 | toll gate amt >= 2000×pi or amt > cash+bank | cards/passive.ts:189 | 0x419e01-0x419e98, 0x41aed7-0x41af60 | verified | |
| C20-5 | facility toll: free card offered unless facility type == 1 (hotel) | state/reduce.ts toll facility path | 0x41a5d5 → 0x41a60e-0x41a63b | fixed 946757e | mall/gas station never offered; test updated |
| C20-6 | tax: has 20 → 0x444a60(target,cur,tax); ==1 ⇒ return | cards/tax.ts:185-196 | 0x44530d-0x445338 | verified | |
| C20-7 | remove_card pool +1 (toll passives) | state/reduce.ts runTollTail | 0x4413a2 | fixed e524c60 | |
| C21-1 | 16/17: 21 first; consumes, ends | cards/passive.ts | 0x4442f2, 0x4445c9 | verified | |
| C21-2 | 21 not checked by 26 / tolls | cards/tax.ts | xref | verified | |
| C21-3 | flash 「%s\n\n免罪卡生效！」 0x46539d | state/reduce.ts:5787-5788 | 0x444be1-0x444c3d | fixed 7b9d645 | `card.absolved` notice（卡片路徑） |
| C22-1 | 送神 f64 (+0x40) removed, no type check | cards/dispel.ts:52 | 0x444c4b-0x444c6c | verified | |
| C22-2 | 送神 god_info removed if type ∈ {5,6,7,8,10,15} | cards/dispel.ts:57 | 0x444c71-0x444ccc | verified | |
| C22-3 | nothing removed ⇒ 0, card kept | cards/dispel.ts:62 | 0x444cd3 | verified | |
| C22-4 | remove_object semantics | state/reduce.ts playCard releaseObject | 0x40e14d | verified | |
| C22-5 | no hostility; human = computer | — | 0x444cec-0x444d15 | verified | |
| C22-6 | 送神符送走神明時：搭檔登場的參照格 = **出牌者此刻所在格**（未被關 ⇒ 物件格改成附身者當前格）；炸彈那一支不改格 | state/reduce.ts:5758-5762, rules/object-landing.ts:310-320 (withDispelNode) | 0x00444cc4 → 0x40e32c → 0x40e356 / 0x40e3cd..0x40e3d4 → 0x40e14d；炸彈 0x00444c4b → 0x40e14d | fixed 5b5d6b9 | 先前用走路留下的舊格 ⇒ 搭檔挑格（`0x40aa6c`）候選集與原版不同 |
| C23-1 | 請神 human: nearest attachable object **visible in the view** (0x40a45c(-1) 扫屏幕空间 id 图 0x474938，440×440、每实例一粒), strict < | client/object-pick.ts:105-190（`BoardView` / `visibleInBoard`）, client/main.ts:6731-6745 | 0x444d1a-0x444e10, 0x40a45c-0x40a4e0, 0x409de7-0x409ef0, 0x408ea0-0x408f38 | fixed e35447d | 先前只做「全地图最近」⇒ 隔半张地图也请得到、一个都看不见时照样扣卡；视野 = 出牌那端**当前镜头**（原版 0x48c570/0x48c574 只在客户端）⇒ 客户端算，core 不动 |
| C23-2 | esi==0 ⇒ card kept; else consumed even if attach fails | cards/registry.ts | 0x444e41, 0x444e52 | approx | unreachable |
| C23-3 | attach sequence | rules/object-landing.ts attachGod | 0x40ead7-0x40ec0d | verified | partner respawn order low |
| C24-1 | 紅 newsFlag=0x20 / 黑 0x02 | cards/swap-and-stock.ts:118-119 | 0x444f88, 0x4450f6 | verified | |
| C24-2 | 0x429040 reprices ±10% no suspension check | places/stock-market.ts applyStockNews | 0x429040-0x4290d3 | verified | |
| C24-3 | computer box 「對%s使用%s！」 | state/reduce.ts cardEffectNotice | 0x444fbf, 0x445138 | verified | |
| C24-4 | suspended stock: exe writes flag and reprices anyway | cards/registry.ts | 0x444f88, 0x42b0da-0x42b13f | fixed 946757e | |
| C24-5 | market closed: no check in card fn | cards/registry.ts fail('marketClosed') | 0x444f25 | approx | documented engine guard |
| C25-1 | black-card hostility loop over holders, low32 double | cards/swap-and-stock.ts | 0x445164-0x4451d0 | verified | 200.0f |
| C25-2 | update_hostility 32-bit wrap then clamp <0 → 0 | rules/hostility.ts:89 | 0x40dfa1-0x40dfaf | fixed 946757e | |
| C26-1 | tax target alive | cards/registry.ts | 0x4462d9 | fixed 4d50c54 | CX-2 |
| C26-2 | consumed after selection | cards/registry.ts | 0x445233 | verified | |
| C26-3 | tax = trunc(cash × 0.2) | cards/tax.ts:176 | 0x4452ce-0x4452e2 | verified | |
| C26-4 | hostility tax/100 target→caster before free card | cards/tax.ts | 0x4452fa-0x445305 | verified | |
| C26-5 | tax2 from final target; pay(final, cur, tax2, 0) | cards/tax.ts | 0x44537d-0x4453a4 | verified | |
| C26-6 | final == caster ⇒ skip payment and box | cards/tax.ts | 0x445375 | fixed d69e009 | |
| C26-7 | box 「抽取%s\n\n%d元稅金！」 | state/reduce.ts | 0x4453d3-0x4453ef | verified | |
| C27-1 | 漲價 selection group 0: any land/facility | cards/target.ts | 0x446317 | verified | |
| C27-2 | 漲價 land same-name +0x17=0x50; facility +0x1c=0x50 | cards/land-cards.ts:202-223 | 0x4454aa-0x44553e | verified | |
| C27-3 | outside ranges ⇒ consumed, returns ebp | cards/registry.ts | 0x44558c | verified | |
| C28-1 | 查封 0x51; type 4 → +0x1e=0 | cards/land-cards.ts:226 | 0x445659, 0x4456cb-0x4456d5 | verified | |
| C28-2 | 查封 no hostility | — | scan 28 | verified | |
| C29-1 | 同盟 target alive, not self | cards/registry.ts | group 4 | fixed 4d50c54 | CX-2 |
| C29-2 | dissolve both alliances then link +0x41, +0x3d=7 | cards/alliance.ts:78-92 | 0x4457e8-0x445894 | verified | |
| C29-3 | daily −20×pi both ways, dec, 0→0x80 | rules/blocking.ts | 0x41cbe5-0x41cc41 | verified | |
| C30-1 | 烏龜 actors 4..7 only (u8 CTZ) | cards/target.ts | 0x4462b3, 0x40d293 | fixed fdeb399 | |
| C30-2 | self +0x39=2, other 3, actor +15=3 | cards/tortoise.ts:56-80 | 0x4459f6, 0x445a2d, 0x445a41 | verified | inactive actor approx |
| C30-3 | tortoise decrement skipped while confined (gate 0x41caf7) | rules/blocking.ts | 0x41cafe → 0x41cb6d | fixed (loop 9b59144, L37) | cards auditor's row said ungated; objects auditor + loop confirmed the gate |
| C30-4 | tortoise ⇒ exactly 1 step, no dice | state/reduce.ts rollDice | 0x40dd7e → 0x40dd40 | fixed (loop 9b59144, L52) | my duplicate removed in df14113 |
| TX-1 | dispatch 0x475dd5 ids 1..13 + id 14 下車 0x447c00 | rules/tool-effects.ts:432 (TOOL_GET_OFF), state/reduce.ts:5198 | 0x475dd5[14], 0x447e24, 0x447f51 | fixed d0b8fdd | id 14 已接通（先前整個缺失） |
| TX-2 | human menu only when byte[+0x15]==1; 託管 AI path | ai/policy.ts | 0x447dab | verified | |
| TX-3 | menu lists count>0 | state/reduce.ts useToolAction | 0x447cf3 | verified | |
| TX-4 | AI loop: skip 10; rand start n>4; 4 tries; notice 「使用%s」 before call | state/reduce.ts | 0x447f82-0x448085 | approx | AI choice → ai-move |
| TX-5 | tools only before GO | state/reduce.ts canUseItemsNow | 0x417d65/0x40defe, 0x418e28 | fixed df14113 | phase gate (cards too) |
| TX-6 | take_tool dec; stock +1 when id<=8 | rules/tools.ts:158 | 0x445aa2 | verified | |
| TX-7 | give_tool cap 9 before stock | rules/tools.ts:94 | 0x445a4d | verified | |
| TX-8 | consume via take_tool for 1,7,8,9,10,11,13; direct dec (no stock) for 2,3,4,5,6,12 | state/reduce.ts | 0x446c7e/0x446d5f/0x446e40/0x446ef9/0x446fb1/0x447ac2 | fixed c53cd65 | decTool |
| TX-9 | tool speech placement | state/reduce.ts | 0x44ef41 sites | approx | |
| T01-1 | doll take_tool(1) first | state/reduce.ts | 0x446b05 | verified | |
| T01-2 | doll copies x/y/node/last/dir; owner=cur | rules/special-actors.ts:300 | 0x446b3e-0x446b8e | verified | |
| T01-3 | doll 9 fixed steps | rules/special-actors.ts | 0x446b94, 0x40deb9 | verified | |
| T01-4 | doll arrival: release ground object only | rules/special-actors.ts:475 | 0x41b4e7-0x41b531 | verified | |
| T01-5 | end of walk: current=owner, place=3 | rules/special-actors.ts | 0x418ed3-0x418ee8 | verified | |
| T01-6 | AI owner may re-run pre-roll after doll | state/reduce.ts | 0x418ebd→0x419058 | follow-up | lead only (ai-move) |
| T02-1 | object types 0x10/0x11/0x12 | rules/tool-effects.ts:145 | 0x446c06/0x446ce7/0x446dc8 | verified | |
| T02-2 | slot ranges | rules/objects.ts:145 | 0x40e033 | verified | |
| T02-3 | legal cell: node (+0x24 & 0xffff00)==0; no distance limit | rules/object-landing.ts:961 | 0x409bc0, 0x445e4d | verified | |
| T02-4 | placing consumes by direct dec, no stock +1 | state/reduce.ts | 0x446c7e etc. | fixed c53cd65 | stock was counted twice |
| T02-5 | slot full: exe still consumes | state/reduce.ts | 0x40e13f, 0x446c0d | approx | unreachable after T02-4 |
| T02-6 | cancel → kept | state/reduce.ts | 0x446bfb | verified | |
| T05-1 | same vehicle → 0, kept | rules/tool-effects.ts:105 | 0x446e5a/0x446f15 | verified | |
| T05-2 | refund other vehicle direct inc | rules/tool-effects.ts:111 | 0x446e7f/0x446f37 | verified | |
| T05-3 | moto 1/2 dice; car 2/3 | rules/tool-effects.ts:38 | 0x446e8c/0x446f44 | verified | |
| T05-4 | vehicle consume direct dec | state/reduce.ts | 0x446ef9/0x446fb1 | fixed c53cd65 | |
| T05-5 | from engineering car → no refund | rules/tool-effects.ts:111 | 0x446e66 | verified | |
| T07-1 | missile pick, take_tool, view, film | state/reduce.ts | 0x447013-0x447065 | verified | |
| T07-2 | damage_area(0x64/−1, 0x26, heavy, attacker) | rules/tool-effects.ts:306 | 0x447074/0x447b86 | verified | |
| T07-3 | blast window view-space | state/reduce.ts | 0x40a45c, 0x409de7 | approx | Q-TOOL-1 |
| T07-4 | land light: 30pi if owned; level−1; chain → 0 | rules/tool-effects.ts:355 | 0x40acf2-0x40ad38 | verified | |
| T07-5 | land heavy: level·30·pi; clear owner/level/type/+0x30 | rules/tool-effects.ts | 0x40ad3a-0x40ad77 | verified | |
| T07-6 | facility light | state/reduce.ts | 0x40adcb-0x40ae0d | verified | |
| T07-7 | facility heavy | state/reduce.ts | 0x40ae14-0x40ae58 | verified | |
| T07-8 | player hit: skip who_plays==0 or dword+0x32; wreck; flag 0x40 | state/reduce.ts | 0x40cd07 | verified | |
| T07-9 | beggar in blast relocated via 0x40cc56 (rand) | state/reduce.ts fireMissile | 0x40cd70-0x40cd7d, 0x40cc56 | fixed cccb4a4 | |
| T07-10 | NPC → hospital | state/reduce.ts | 0x40aeb4-0x40aede | verified | |
| T07-11 | ground objects released | state/reduce.ts | 0x40aee0-0x40aefc | verified | |
| T07-12 | flagged players: hostility 90pi, hospital 3 incl attacker | state/reduce.ts | 0x44709f-0x4470e7 | verified | |
| T07-13 | send_to_hospital clears 0x40 flag | rules/confinement.ts | 0x43ecad | verified | |
| T13-1 | nuke = missile heavy, radius −1 | same | 0x447ace-0x447bfe | verified | |
| T08-1 | remote dice human dialog 1..6 | rules/tool-effects.ts:199 | 0x446814-0x446902, 0x44725c | fixed c53cd65 | was 18; tests updated |
| T08-2 | order 0x40dd1f → take_tool → store | state/reduce.ts | 0x447260-0x447275 | approx | |
| T08-3 | next roll 1 die = value, no rand | rng/watcom.ts:108 | 0x40d9a4, 0x419572 | verified | |
| T08-4 | AI remote dice no player_say | state/reduce.ts | 0x447250 | follow-up | presentation |
| T09-1 | robot worker take_tool before 0x40b110; consumed even when nothing built | state/reduce.ts | 0x4472fb, 0x447345 | fixed c53cd65 | tests updated |
| T09-2 | human picker 0x2090006 any land/facility（类别位 `0x6` = 地块\|設施，不看 owner/level；盖不成照样扣） | client/picking.ts:300-330（候选 = core 的 `canUseTool`）+ pick-anchor.test.ts | 0x44624e, 0x44627d, 0x4472fb / 0x447345 | verified | 2026-09-25 复核：候选集与那两位类别位**同一集合**（5 级地 / 0 级設施都在、路面与企業都不在），补 2 例钉住 |
| T09-3 | 0x40b110 rules | rules/tool-effects.ts:284 | 0x40b110-0x40b21f | verified | |
| T09-5 | bit7 → 0x20b | state/reduce.ts | 0x44736d | verified | |
| T10-1 | no snapshot → kept | rules/time-machine.ts:83 | 0x4473b9 | verified | |
| T10-2 | take_tool after restore | state/reduce.ts | 0x447407 | verified | |
| T10-3 | snapshot at 0x40dd1f (start of move), skipped turn 0x40c97c, self-teleport 0x4477c3; who_plays bit0 | state/reduce.ts startTurn | 0x40dd53, 0x40c97c, 0x4477c3, 0x4480a0 | fixed (loop L24/L50) + df14113 (self-teleport 0x4477c3) | |
| T10-4 | restored blocks list | rules/time-machine.ts | 0x448544 | approx | whole JSON |
| T10-5 | after restore back before GO; no re-tick | state/reduce.ts | — | fixed (loop L50) | snapshot now taken at GO |
| T10-6 | snapshot slot not cleared | rules/time-machine.ts:97 | 0x448544 | verified | |
| T11-1 | human teleport two-stage pick（第一段選來源、第二段選目標） | client/picking.ts:678-683, 691-740, client/main.ts:11808-11819 | 0x447469, 0x4474f5, 0x447598, 0x447653, 0x4478df | fixed 5256fa6 | 第二段取消 = 不扣道具；見 T11-15 |
| T11-2 | AI source self | ai/policy.ts | 0x447478 | verified | |
| T11-3 | attached-object source moves carrier | rules/teleport.ts:75-95 (decodeTeleportSource) | 0x00447495..0x004474cd | fixed 5256fa6 | 附身中 ⇒ `1 << (附身者−1) \| 0x8000` |
| T11-4 | land move carries +0x30 tenure; source +0x2c cleared | rules/teleport.ts | 0x447546-0x447553 | fixed df14113 | |
| T11-5 | target must be owner 0 & level 0 | rules/teleport.ts | 0x44657c-0x4465b4 | fixed df14113 | |
| T11-6 | unowned land/facility source allowed（來源不看歸屬） | rules/teleport.ts:213-215, 254-256 | 0x447469（`0x1200036` 組字節 0 = 不設限） | fixed 5256fa6 | 先前 `owner == 0` 直接拒收 |
| T11-7 | facility move | rules/teleport.ts:168 | 0x4475d8-0x44760f | verified | |
| T11-8 | facing circular distance | rules/teleport.ts:82 | 0x447705-0x4477a8 | verified | |
| T11-9 | self-teleport: snapshot, steps 0, stop processing, no roll | state/reduce.ts:5406-5413 | 0x4477bb-0x4477dc | fixed df14113 | 2026-09-25 复核：`0x004477c3 call 0x44808a` 快照已在（`snapshotForTimeMachine`）；联机镜像 teleport-mp.test.ts:151 钉住 `snapshots[0]` |
| T11-10 | NPC source | rules/teleport.ts:101-115 (teleportActorTo), state/reduce.ts:5163-5168 | 0x447857-0x4478b5 | fixed 5256fa6 | 寫 +4 所在格 / +6 來路 / +9 朝向 / 坐標 |
| T11-11 | ground object source | rules/teleport.ts:122-130 (teleportObjectTo), state/reduce.ts:5169-5172 | 0x4478cb-0x4479ae | fixed 5256fa6 | 寫 `[物件+2]` = 新格、新格置物件位（朝向那格不復刻） |
| T11-12 | player target node must be free | state/reduce.ts:5162 (placementBlockedAt), rules/teleport.ts 目標檢查 | 0x409bc0 | fixed 5256fa6 | 只對真人（拾取子類）；電腦走 `0x00447661 call 0x420eee(0)` 用策略給的格 |
| T11-13 | consume on success | state/reduce.ts | 0x4479b3 | verified | 第二段取消（`0x447506` / `0x4475a9` / `0x447673` / `0x4478f2 je 0x4479b3`）也走這裡 ⇒ 不扣 |
| T11-14 | 來源精靈碼：`0x8000 \| (1 << 下標)`（玩家 0..3 / 惡人 4..7）、`0x8000 \| ((槽+1) << 8)`（物件）、附身物件 ⇒ 附身者 | rules/teleport.ts:58-95 | 0x44761c, 0x447637, 0x4478cb, 0x00447495..0x004474cd | fixed 5256fa6 | 舊碼只認 `玩家下標 + 1`（電腦自搬那一路仍收） |
| T11-15 | 第二段參數按來源：地塊 `0x2090802` / 設施 `0x2090804` / 其餘 `0x2090001` | client/picking.ts:678-683 | 0x4474f5, 0x447598, 0x447653, 0x4478df | fixed 5256fa6 | 子類 8 = 目標須無主 0 級（`0x0044658c`） |
| T12-1 | refuse when (traffic&3)==3 | rules/tool-effects.ts:105 | 0x4479e2 | fixed df14113 | (traffic&3)==3 |
| T12-2 | refund moto/car | rules/tool-effects.ts:111 | 0x4479f1-0x447a34 | verified | |
| T12-3 | save previous traffic/dice +0x64/+0x65（在退车 inc 之后、写 0x1f 之前） | rules/tool-effects.ts:122-137 useVehicleTool, state/reduce.ts:1336-1352 tickEngineVehicle | 0x447a43-0x447a55, 0x41ccd0-0x41cd32 | fixed df14113 (+8dbf719 端到端用例) | 2026-09-25 复核：写侧与到期侧都在；补 `reduce(useTool 12)` → 第 8 次日结 → 骑回機車 的整条用例 |
| T12-4 | traffic 0x1f, 1 die, direct dec | rules/tool-effects.ts:55 | 0x447a5b, 0x447ac2 | verified | |
| T12-5 | daily −4; (t&0xfc)==0 → restore saved vehicle if owned else walk | — | 0x41cca3-0x41cd83 | fixed (loop L44) | |
| T14 | 下車（道具表第 14 項 `0x447c00`）：真人道具欄末格徽章 ⇒ 載具退回道具欄、步行一顆骰子 | rules/tool-effects.ts:432-450, state/reduce.ts:5197-5207, client/main.ts:11348-11352 | 0x447c00, 0x00447e24, 0x00447dab | fixed d0b8fdd | 子規則見 T14-1..T14-4 |
| T14-1 | 下車退款：`traffic == 1` ⇒ 道具 5 +1（`add [p*15+0x499160], dl`）、`== 2` ⇒ 道具 6 +1；直接加，不查 9 件上限、**不動庫存** `[0x49731f+id]` | rules/tool-effects.ts:443-449 | 0x447c1e/0x447c23, 0x447c2b/0x447c30 | fixed d0b8fdd | 與 TX-8 的「直接 dec」同一口徑（上車那一支同理） |
| T14-2 | 下車狀態：`+0x11`（traffic）→ 0、`+0x12`（ndices）→ 1 | rules/tool-effects.ts:449 | 0x447c3f, 0x447c45 | fixed d0b8fdd | 步行、一顆骰子 |
| T14-3 | 下車恒成功、**沒有台詞**（`jmp 0x446ba3` = `mov eax,1`） | state/reduce.ts:2538 | 0x447c69 | fixed d0b8fdd | 故不寫 `lastToolUsed` |
| T14-4 | 下車只給**恰好** who_plays == 1 的真人、只在 traffic 1/2 時出現（末格命中值 = 0xe）；工程車 0x1f 與電腦都不出現（電腦迴圈只掃 1..13） | state/reduce.ts:5198-5199, client/main.ts:11344-11352 | 0x447dab, 0x447dee..0x447e24, 0x447f82 | fixed d0b8fdd | 步行 / 工程車 ⇒ `getOffVehicle` 不 ok，狀態原樣 |
| O-1 | slot→type table 46 bytes | rules/objects.ts:50 | 0x47ed3c, 0x407d4e..68 | verified | dumped |
| O-2 | slot ranges per type (15/16/17/18 multi) | rules/objects.ts:145 | 0x40e03e..0x40e080, 0x40e023 | verified | |
| O-3 | place_object: first free slot; node/state/attached; OR slot+1 into node byte | rules/object-landing.ts:156 | 0x40e082..0x40e13c | verified | type15+attached→attach_god only from 0x411b35 (debug) n/a |
| O-4 | god modifier tables 3×18 words | rules/objects.ts:202 | 0x4749e2/0x474a06/0x474a2a | verified | dumped |
| O-5 | dispellable types {5,6,7,8,10,15} | rules/objects.ts:90 | 0x444c9f..0x444cbb | verified | |
| O-6 | partner slot (slot<12, odd −1 / even +1) | rules/objects.ts:248 | 0x40e275..0x40e297 | verified | |
| O-7 | release_object: 16/17/18 → stock 2/3/4; bomb clears carrier f64; gods clear god_info −modifiers; zero node/state/attached | rules/object-landing.ts:255 | 0x40e14d..0x40e26e | verified | |
| O-8 | partner pick 0x40aa6c (rand) runs before place_object checks the slot | state/reduce.ts respawnPartner | 0x40e28c → 0x40e297 | follow-up | RNG only; pairs normally keep one member live |
| O-9 | attach_god sequence | rules/object-landing.ts:324 | 0x40ead7..0x40ebfa | verified | |
| O-10 | god power after attach; displaced partner respawns before power | state/reduce.ts | 0x40eb3f, 0x40ec0d | verified | |
| O-11 | landing order ATM → beggar → bomb tick → object table | state/reduce.ts applyArrival | 0x41b53f/0x41b5fd/0x41b697/0x41b800 | verified | |
| O-12 | runs every step (steps already decremented) | state/reduce.ts step | 0x40d960 → 0x41b42d | verified | |
| O-13 | 18-entry type jump table | rules/object-landing.ts:637 | 0x41b3e5 | verified | dumped |
| O-14 | gods: actor<4 and stopped → attach | rules/object-landing.ts:749 | 0x41b807..0x41b82d | verified | |
| O-15 | dog: stopped; release 0xb; vehicle → anim only; on foot → wreck, steps 0, hospital 3 | rules/object-landing.ts:657 | 0x41b837..0x41b8ef | verified | |
| O-16 | dog partner respawn picked while player still on dog node (before hospital) | state/reduce.ts applyArrival | 0x41b847 before 0x41b8ef | fixed 879d5f7 | |
| O-17 | gift: weighted bag; empty → nothing; give, release 0xd, 「得到%s！」 1500ms | rules/object-landing.ts:676,385 | 0x41b8f9..0x41b972, 0x445ada | verified | full slot still consumes gift |
| O-18 | gift speech 0x44f230(p, price): rand()&1 when 50<price<=100 | state/reduce.ts | 0x41b97a..0x41b98b | fixed e677c67 | tools 5 (80), 7 (100) |
| O-19 | treasure: +500 16-bit, release 0xe, 1500ms | rules/object-landing.ts:692 | 0x41bb0c..0x41bb62 | verified | |
| O-20 | roadblock: any step, actor<8 and !=4; release; steps 0 | rules/object-landing.ts:647 | 0x41bceb..0x41bd30 | verified | |
| O-21 | mine: stopped; release; wreck; steps 0; hospital 3 | rules/object-landing.ts:709 | 0x41be5f..0x41bf11 | verified | |
| O-22 | bomb pickup: actor<4, f64==0, stopped; fuse 0x26 | rules/object-landing.ts:724 | 0x41bfd2..0x41c03a | verified | |
| O-23 | reaper square: nothing | rules/object-landing.ts:743 | 0x41c164 | verified | |
| O-24 | bomb tick: dec; 0 → release, demolish land, wreck, steps 0, hospital 5 | rules/object-landing.ts:566 | 0x41b697..0x41b786 | verified | |
| O-25 | first hospitalisation 0x44f2c2: rand()&1 when 3<days<=6 | rules/confinement.ts | 0x43eca5, 0x44f2f4..0x44f312 | fixed fdeb399 | sendToConfinement rng param; wired for bomb hospital + 陷害; fortune/news/magic-house callers = cross-area |
| O-26 | bomb pass target: node bitmask (confined/hotel/away cleared, beggars kept), lowest bit, then alive & f64==0 | state/reduce.ts applyArrival, rules/object-landing.ts passBomb | 0x41b5fd..0x41b613, 0x41b78b..0x41b7dc | fixed 879d5f7 | occupantsOfNode, also used by beggarAt |
| O-27 | wreck vehicle | rules/object-landing.ts:488 | 0x40cd07..0x40cd6f | verified | |
| O-28 | carried god/bomb nodeId follows player every step | state/reduce.ts step | 0x40c1cc → 0x40fc00 | fixed 879d5f7 | also teleport 0x447844；5b5d6b9 複核：`0x40fc23 mov [eax*8+0x496d0a], dx` 是**變址寫**（xref 掃不到），放出後走回棋盤 `0x40d6be` 那一下**不**同步 ⇒ 送神符另走 C22-6 |
| O-29 | god duration tick at holder turn start; 0 → dispel + partner | rules/object-landing.ts:811 | 0x41cc6c..0x41cc9b | verified | 7 days (reaper 13) |
| O-31 | placement candidates bit31 static + walkable | rules/object-landing.ts:869 | 0x40aac3..0x40aad6 | verified | |
| O-32 | occupied-node semantics | rules/object-landing.ts:921 | 0x43d59b, 0x40d5d2, 0x40ce0e, 0x40c1e9 | verified | |
| O-33 | pick = rand % n | rules/object-landing.ts:980 | 0x40aa53, 0x40aadf | verified | |
| O-34 | distant pick: either axis >= 300 | rules/object-landing.ts:1026 | 0x40ab08..0x40ab3b | approx | 64-try cap documented (Q-OBJ-2) |
| O-35 | initial placement types 1,3,5,7,9,11,13,14 | rules/new-game.ts:434 | 0x407d6a..0x407db9 | verified | |
| O-36 | monthly gift/treasure relocation | state/reduce.ts advanceGameDay | 0x41d0a3..0x41d0f6 | fixed (loop, monthly-objects.ts) | |
| O-37 | 同格多件：节点反向索引 = 各次放置的**按位或**（`or [node+0x24],(槽+1)<<16`），落地按 `objects[字节-1].type` 分派 | state/reduce.ts:3555-3600 objectHandleAt, rules/special-actors.ts:445-463 nodeObjectIndex | 0x40e13c（写）、0x41b4b4（读）、0x41b4ca-0x41b4db（查种类）、0x41b529（remove_object） | approx | c8fe7c7 把「最大槽号」改成逐位 OR（15\|17=31 ⇒ 槽 30 地雷）；残余：那一字节是**存下来**的，release/attach 整字节清零（0x40e243 / 0x40ebc7）⇒ 「同格两件先收走一件」仍近似 |
| O-44 | confinement counters 0x80 release / dec / &0x3f | rules/blocking.ts:74 | 0x41c88f..0x41c955 | verified | |
| O-45 | release day still counts as confined for +0x36/+0x37/+0x39 gate | rules/blocking.ts | 0x41c89b/0x41c902/0x41c936, 0x41c95e/0x41caf7 | fixed (loop L38) | |
| O-46 | tortoise +0x39 skipped while confined | rules/blocking.ts:261 | 0x41c965 → 0x41ca8f; 0x41cafe → 0x41cb6d | fixed (loop L37) | |
| O-47 | +0x36/+0x37 gated; sleepwalk wake restores vehicle | rules/blocking.ts:259 | 0x41c96b..0x41ca72 | verified | |
| O-48 | +0x38/+0x3b/+0x3c/+0x3d (alliance −20*pi, 0x40cc1a) | rules/blocking.ts:262-267 | 0x41ca8f..0x41cc41 | verified | |
| O-49 | insurance +0x3e: 0x80 → 0 in release pass; ticks even while confined | rules/blocking.ts:120 | 0x41cae3..0x41caee, 0x41cc4b | fixed (loop L42) | |
| O-50 | facility demolish releases hotel guests | rules/blocking.ts:211 | 0x40dffa | verified | |
| O-51 | gift: no choice UI; weighted draw for all | — | 0x41b914 | verified | |
| O-38 | god amount window: computer / sleepwalker = 4 rerolls (16 rand), last counts | rules/god-power.ts | 0x43f2bc..0x43f451 | follow-up | RNG count only; human = 1 reroll is documented D-003 |
| O-39 | 小財神: loop continues after an opponent goes bankrupt, stops only on game over | state/reduce.ts applyGodPower | 0x0040ec73..0x0040eca2 | fixed 879d5f7 | |
| O-40 | 小窮神: host bankrupt mid-loop, exe loop continues | state/reduce.ts payOpponents | 0x40efab..0x40efe2 | follow-up | needs 0x41d2c6 behaviour for bankrupt payer |
| O-41 | 大財神 speech 0x44f354: rand when 5000p ≤ amount < 9000p | state/reduce.ts | 0x40ed74, 0x44f396..0x44f3d6 | follow-up | RNG only (daily srand makes RNG parity moot) |
| O-42 | 福神 speech 0x44f230(price / sum) | state/reduce.ts receiveCards | 0x40ee39..0x40ee46, 0x40eefb..0x40ef16 | fixed e677c67 | |
| O-52 | thief taking a gift also calls 0x44f230 | rules/npc-walk.ts | 0x0041bafa | follow-up | NPC path (loop / ai-move area) |
| O-53 | NPC stopping on the dog is bitten (hospital, dog released) | rules/npc-walk.ts | 0x41b837 / 0x41b855 | follow-up | cross-area (NPC walk) |
| I-1 | hand writes only via receive_card / remove_card / sell_all; each moves the same card to/from pool ⇒ pool + hands ≡ initAmount | rules/inventory.ts conserveCardPool; state/full-game.test.ts assertCardConservation | xref 0x499197 (0x0044133b / 0x004413a2 / 0x00441f54), xref 0x499120 | fixed e524c60 | card play, passive consumes, full-hand discards never returned to pool |
| I-2 | card use returns card to pool (remove_card +1) | state/reduce.ts playCard | 0x004413a2 | fixed 4d50c54 | |
| I-3 | receive_card: hand 15 → remove cheapest (strict <, first slot wins) then append; pool −1 | cards/rob.ts giveCard + conserveCardPool | 0x004412e4, 0x0044128f (`cmp ebx,eax / jle`) | fixed e524c60 | discard now returned to pool at every caller |
| I-4 | remove_card: first matching slot, shift left, clear last, pool +1 | cards/passive.ts consumeCard | 0x00441343..0x004413a2 | verified | pool side see I-1 |
| I-5 | sell_all_tools: vehicle folded back (1→5, 2→6, 3→12) before selling; dice 1; ids ≤8 return to stock; price = table +5 | rules/inventory.ts sellAllTools | 0x00445b3f..0x00445c13 | verified | |
| I-6 | sell_all_the_card: every slot +1 pool, sum of card prices | rules/inventory.ts sellAllCards | 0x00441f21..0x00441f71 | verified | |
| I-7 | new game: hands memset, pool = init (0x47fdf6+i*8, 30 ids), tool stock = init for ids 1..8 | rules/new-game.ts initialCardAmounts, rules/tools.ts initialToolStock | 0x00407183..0x004071cb | verified | |
| I-8 | starting tools 1,2,3,4,8,9 via give_tool per seated player | rules/tools.ts STARTING_TOOLS | 0x00407281..0x004072bb | verified | |
| I-9 | starting vehicle option [0x46cb44]: stock of that vehicle −1 per player, dice +1 | rules/new-game.ts | 0x00407219..0x00407241 | verified | |
| I-10 | give_tool: count ≥ 9 (`jae`) → nothing; id ≤ 8 needs stock > 0 and decrements it | rules/tools.ts giveTool | 0x00445a4d..0x00445aa0 | verified | |
| I-11 | take_tool: have 0 → nothing; id ≤ 8 returns to stock | rules/tools.ts takeTool | 0x00445aa2..0x00445ad9 | verified | |
| I-12 | receive_random_card: bag by pool count in card-id order (128-byte buffer), rand % n only if bag non-empty, then receive_card | rng/watcom.ts drawRandomCard | 0x00441e12..0x00441e76 | verified | pool ≤ 100 by conservation, no byte overflow |
| I-13 | drop_random_card: rand % hand count, take that slot's id, remove first matching | rules/npc-actions.ts pickCardToSteal, state/reduce.ts dropCards | 0x00441e77..0x00441ec1 | verified | |
| I-14 | card square: any player, draws via 0x441e12, box 「得到%s！」, good-news speech rand | state/reduce.ts settle (cardDrawn) | 0x0041b302..0x0041b38c | verified | pool via conserveCardPool |
| I-15 | 福神 cards: small one draw, big two draws; speech 0x44f230(price / sum of prices) | state/reduce.ts receiveCards | 0x0040edef, 0x0040eeb0/0x0040eebb, 0x0040ee46, 0x0040eefd..0x0040ef0c | fixed e677c67 | speech rand was missing; discard pool e524c60 |
| I-16 | 董事長 gift: card/tool draw then speech 0x44f230(price) | state/reduce.ts enterShop | 0x0042e97d..0x0042ea23 | fixed e677c67 | speech rand missing |
| I-17 | magic house item 6: receive_random_card (full-hand discard) | places/magic-house.ts | 0x004320ee → 0x00441e64 | fixed e524c60 | pushed a 16th card |
| I-18 | notice-board card listing: remove from seller, receive_card to buyer | state/reduce.ts transferListing | 0x0042587a, 0x00425893 | fixed e524c60 | no full-hand discard before |
| I-19 | thief steals card: drop_random_card(victim) → receive_card(owner) | rules/npc-walk.ts applyNpcEvents | 0x0041c294, 0x0041c307 | fixed e524c60 | pushed a 16th card |
| I-20 | birthday (fortune 5) filter: not self, who_plays byte ≠ 0, hand non-empty; host who_plays ≤ 1 → human picker, else computer drop_random + receive | events/fortune-effects.ts, state/reduce.ts answerBirthdayCard | 0x0044c41f..0x0044c486 | verified | pool via fortune wrapper e524c60；真人答覆的牌堆記賬（`0x441343` +1 / `0x4412e4` −1、滿手棄最便宜 +1）補測試 5b5d6b9（use-card.test.ts） |
| I-21 | holiday card gift: holiday flags & 8 → each player with who_plays ≠ 0 gets receive_random_card; map-specific box; speech rand | state/reduce.ts advanceGameDay, places/calendar.ts holidayGivesCard | 0x0041d07b → 0x00452444, 0x00452637..0x00452753; table 0x0047ff4a | fixed e677c67 | was entirely missing |
| I-22 | good-news speech 0x44f230: rand when 50 < points ≤ 100 | rules/speech-rand.ts | 0x0044f23f..0x0044f280 | fixed e677c67 | wired: gift, 福神, 董事長, holiday (card square already) |
| I-23 | research lab grants tool project+8 via give_tool | state/reduce.ts tickOwnResearch | 0x0041ce1b..0x0041ce25 | verified (loop L45) | |
| I-24 | shop human buy/sell card pool ±1 | state/reduce.ts shopAction | 0x0042d242 / 0x0042d152 | verified | |
| I-25 | card/tool pool in stateFingerprint | net/protocol.ts:887-888 | — | fixed 5290899 | `toolStock` / `cardAmount` 缺席 = 不參與（舊回報 fixture 仍不含這兩格）；I-25 结案 |
