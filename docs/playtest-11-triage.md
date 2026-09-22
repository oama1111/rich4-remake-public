# 第十一份試玩回報（2026-09-22 19:58–20:10，Charles，联机）—— 分診與進度

> 需求方：「我又在试玩中提交了一大堆反馈，请你逐条查看并修复」。
> 原始檔案在 `feedback/20260922-19*.json` ~ `feedback/20260922-20*.json`（19 份）。
> 狀態欄：⬜ 未開始 · 🔍 調研中 · 🔧 修復中 · ✅ 已修（附 PR）· ⛔ 按原版不改（附證據）

| # | 檔名（時:分:秒） | 回合 | 回報原文（逐字） | 歸屬 | 狀態 |
|---|---|---|---|---|---|
| 1 | 195857 | 0 | 多人模式无法设置房间人数和起始资金… | client+server（大廳設置） | ⏸ **需需求方拍板**（新功能，四层全缺） |
| 2 | 195941 | 4 | 人物扔完骰子开始行动时骰子应该就消失了 | client | ✅ 删掉走子期间重画 `state.dice` 的分支 |
| 3 | 200005 | 8 | NPC放置炸弹、定时炸弹时好像也有台词 | data+core+client（台詞通道） | ✅ 13 件道具的 `_tool_strings` 整条通道已接（含逐字節回 exe 核對） |
| 4 | 200144 | 24 | 天降鸿福小游戏开局不应该是黑屏，财神的活动范围不应该只有那么一点点 | client（小遊戲屏） | ✅ 两处：intro 先画底屏再叠 FLIC；转向条件 `<=` 写成 `>` |
| 5 | 200214 | 27 | 我名下没有房子的时候也会触发强制拆除房屋一栋吗？查下逻辑 | client（事件框误渲染） | ✅ 幻影：得點券格被当成命運 0；另修 lands 源 |
| 6 | 200253 | 28 | 小穷神的逻辑也是错的，应该是先触发动画，然后出现文案，然后才是付款金额的老虎机 | client（順序） | ✅ god-slot 加 `pendingCue`+起播闸（等影片/开场白） |
| 7 | 200346 | 32 | NPC走到建筑公司时…镜头应该转移到待修建的建筑为中心 | core（鏡頭） | ✅ 新增 `entityViewTarget`，补三处 `lastViewTarget` |
| 8 | 200422 | 36 | 开局默认是日月历模式，但是设置里打开默认是缩小地图模式 | client（設定預設值） | ✅ 開機由 cfg 初始化 `sidebarView` |
| 9 | 200443 | 39 | 机器娃娃清扫的语音应该是持续播放 | client（音效） | ✅ `loop=true` + 走完 `stop`（★ 原版是**音效**循环，不是语音） |
| 10 | 200505 | 39 | NPC触发魔法屋时不应该由玩家来选择 | client（魔法屋） | ✅ 补 `whoPlays !== 1 ⇒ 不铺场`（原版 0x0043381b） |
| 11 | 200544 | 50 | 角色踩到炸弹时动画有问题…而不是遗留一个角色模型 | client（影片窗口） | ✅ 首席裁定按原版呈現、撤回（見 `escalations.md`「待首席確認」表後）；stale-snapshot 泄漏已堵 |
| 12 | 200630 | 56 | 出狱时…而不是前一回合就出来了但是下一回合才能动 | core（回合游标） | ✅ E-41 首席裁定后已修（`ds/e41-release-turn`）：走回棋盘那一回合收尾不换人 |
| 13 | 200658 | 60 | 从监狱和医院出来时为什么都是背对着路倒退出来 | core（朝向） | ✅ `directionOf` 减法写反 + 订正 `gate-walk.test.ts` 钉错的值 |
| 14 | 200723 | 60 | 进入乐透购买模块没有触发正确的背景音乐和猫女台词语音 | data（語音前綴） | ✅ 14 条补回 `#NNNN`；**BGM 那半未找到问题** |
| 15 | 200825 | 64 | 踩到保险公司…才弹出金额应该付多少保险费 | client（屏序/闸） | ✅ `SCREENS` 挪序 + 訊息框起播闸追加「转盘/老虎机在播」 |
| 16 | 200854 | 68 | NPC走到百货公司时就不用触发语音了 | client（人機閘） | ✅ 抽出 `aiVenuePending` 给两条入口共用 |
| 17 | 200914 | 72 | 踩到卡片格子时应该有个提示音 | client（音效） | ✅ `SOUND_IDS` 加 43/48 + 按落点 `specialKind` 放 |
| 18 | 200941 | 76 | NPC踩到银行上时就不用一闪而过银行内部的页面了 | client（人機閘） | ✅ `drawBankLoan` 补 `isAiTurn` 闸 |
| 19 | 201036 | 80 | 同上 | client（事件框误渲染） | ✅ 同上；「感謝阿拉」本身是**得 50 點的好消息台词**，没错 |

## 已知的相鄰項（本表第 19 與第 5 條同一事件）
- 第 5 條：`fortune.ts` 對事件 0 的**可行性判定**（原名下沒有 level≠0 的地 ⇒ 不該抽到）；
- 第 19 條：「NPC 觸發了還在『感謝阿拉』」= 事件 0 是**壞事**卻說了**好事**的台詞 ⇒ 台詞探測器歸屬錯。

---

# 進度（第三輪結束時）

| 狀態 | 條目 | 備註 |
|---|---|---|
| ✅ 已修 | #2 #3 #4 #5 #6 #7 #8 #9 #10 #13 #14 #15 #16 #17 #18 #19 | **16 / 19** |
| ⏸ 等需求方拍板 | #1 | 新功能；要定「房間人數語義」與「大廳版式」 |
| ◑ 部分 | #11 | 已堵 stale-snapshot 泄漏；**可見那半與原版同構**（原版救護車底下也是含角色的凍結畫面） |
| ✅ 已修 | #12 | 口徑已釘死（見 `escalations.md` E-41）：N 天 = 不擲骰 N+1 次，最後那次與下一個正常回合之間不換人 |

---

# 第二輪：剩餘條目的**精確修法**（全部已只讀調研完，帶 file:line 與 exe 證據）

> 調研報告的完整版在對話裡；下面是可直接施工的最小改動。
> 每條都已確認**不是猜測**（有 @source VA 或規格）。

| # | 一句話根因 | 精確修法 | 風險/注意 |
|---|---|---|---|
| 1 | 多人房間設置**四層全缺**（協議/服務器/Room/客戶端 UI） | 這是**新功能**：`protocol.ts` 加一條（v=N 要做 `setOptions` 一次改完，別一項一條消息）＋`RoomInfo`/`start` 帶字段；`hub.ts` 加 handler（三道閘照抄 `#setCharacter`）；`room.ts:86-92` 的 `newGame({...})` 逐項接上；`main.ts:9315-9321`（`onStart`）與 `9415-9421`（`onResync`）**必須與 room.ts 同源**否則指紋失步；`lobby.ts` 要新 UI（108..292 那段已滿，**版式需需求方拍板**） | ⚠️ 兩點要需求方先拍板：**房間人數語義**（總人數 vs 真人上限）、**勝利條件與資金档耦合**（`winConditionsOf(fundIndex,…)` 需要資金档，建議協議傳档位）。另需 +PROTOCOL_VERSION |
| 3 | 13 件道具的 `player_say` 台詞**整條通道沒接**（原版不分人機） | 資料層匯出 `_tool_strings`（`0x480d5a`，12 角色 × 26 條，行距 0x68，`rich4_tool_strings.c`）→ core 在 `useTool` 生效那幾支記一個瞬態提示（比照 `lastCardPlay`）→ `speech.ts` 加探測器（`order: 'beforeStage'`，原版在 `place_object` **之前**） | 路障 `0x446bcc`(+0x480d5e)、地雷 `0x446caa`(+0x480d62)、炸彈 `0x446d8b`(+0x480d66)；三處的 `cmp [who_plays],1` 都在 `player_say` **之後** ⇒ **電腦也說** |
| 6 | `godSlotScreen.event()` 沒有「等影片/等文案」的閘 ⇒ 老虎機搶在附身影片與開場白之前 | 照 `notice-box-screen.ts:205-239` 加 `pendingCue` + `startGate`；`active()` **必須含 pendingCue**（否則 `main.ts:6343-6345` 不會給它 tick）；`main.ts:5456` 旁接 `setGodSlotStartGate(() => boardFilm!==null \|\| pendingBoardFilm!==null \|\| godLine!==null \|\| pendingGodLine!==null)` | 原版次序：抱怨台詞(0x40ef44) → 影片 0x220(0x40ef65/78) → **文案**(0x40ef8e) → 老虎機 `fcn_00440706(4)`(0x40ef98) → 付款(0x40efd9)。老虎機不在 `stageBusy` 入參裡 ⇒ 不會互等（死鎖自查通過） |
| 7 | 建設公司三支（真人 `buildTarget` / 自家董事長 AI / 別家 AI）**都沒寫 `lastViewTarget`** | 加 `entityViewTarget(state,topo,entity)`（照 `0x40af12`：0x7d0+ → land.x/y、0xfa0+ → facility.x/y）；補在 `reduce.ts:1878`、`6486`、`6553` | 原版：`0x41aadf call 0x41d476`(view_to) → `0x41aae8` 加蓋 → `0x41ab10` 大錘 → `0x41ab5b` 台詞。**客戶端零改動**（`syncViewTarget` + `stageBusy` 含 `buildFx` 會自動「移過去→演→說→收回」） |
| 8 | `sidebarView` 硬編碼 `'calendar'`，開機 `loadConfigFromStore()` 不呼叫 `applyOptions` ⇒ 棋盤與設定屏不一致 | 開機讀完 cfg 後 `sidebarView = options.windowView === 1 ? 'map' : 'calendar'`（**不要**在開機跑 `applyOptions` 的音量/寫檔副作用） | 原版每次重畫都讀 `cfg+5`（`0x416e7d` / `0x4169cd`）⇒ 不存在「開機一套」的狀態。`windowView===2`（輪流）原版語義未查證，維持現行暫定 |
| 9 | 娃娃那一聲 `Effect.mkf` 38 **漏了 `loop=true`**、也沒有走完停掉 | `main.ts:4219` → `sound.play('Effect.mkf', SOUND_IDS.DOLL, true)`；在補間收攤時 `sound.stop('Effect.mkf', SOUND_IDS.DOLL)`（位置：`render.ts` 的 `#forgetActorWalk` 附近，或宿主側記旗標） | 原版 `0x40ded1 push 1` → `Play(dwFlags=DSBPLAY_LOOPING)`，走完 `0x40d8dc` → `Stop`。38 號只有 **0.56 秒** ⇒ 現在整趟只有開頭一聲。★ 原版**沒有**持續的 **Speaking** 語音（只有那一次性的「替我除掉障礙物！」，屬第 3 條） |
| 11 | 炸彈/地雷那一段救護車演的 6.2 秒裡，被炸者以乞丐造型**留在原地**（`deferred-board` 把 `inHospital` 在畫面上清掉），沒有中途放開點 | 給這一家加中途放開點（照大錘第 48 幀的形狀）：`boardFilm.spec.id === 'hospital'` 時就別再按住位置；並在片鏈收攤時 `deferredBoardBefore = null`；`startBuildFx` 改成**無條件**寫快照（`main.ts:6185` 去掉 `if (plan.hammer)`） | 原版「盤上不再有人」是在 `0x43ec3d` 之後那次 `0x41d476` 重畫才生效；replay 過的截圖**不能**證明「關窗後仍殘留」，可證的是那 7.1 秒窗口內。另有一條 stale-snapshot 復活路徑（`deferredBoardBefore` 從不在收攤時清） |
| 12 | 出獄/出院那一回合被當成**完整回合消費掉**，而 `endTurn` 無條件推進游標 ⇒ 要等一整輪才能動 | `startTurn` 的 RETURN_TO_BOARD 分支**別清 `0x10`**（留給 `endTurn`）；`endTurn` 見該位就**不換人**、回同一玩家的 `turnStart`，且不再 `beginActorTurn`；順手把那一回合的保險期/研究所遞減補上 | 原版 `0x418f07 test [player+0x15],0x30` → `0x418f87 and …,0xf` → `0x418f8e jmp loc_00419058` = **游標不前進**，同一玩家立刻再得一回合 |
| 13 | `reduce.ts:1258` 的 `directionOf(景觀 − 關押格)` **減法寫反** ⇒ 背對棋盤倒退 | 改成 `directionOf(gate.x - land.x, gate.y - land.y)`；**同步訂正** `gate-walk.test.ts:157-165` 的期望值為「監獄 **5**、醫院 **1**」並把描述改成與算式一致 | ⚠️ 這是「測試釘錯了值」不是「為變綠改斷言」——PR 要附 `@source 0x0040d6f9..0x0040d70b`（原版 `al = directionOf(關押格 − 景觀位)`）。現行測試的註解與算式自相矛盾 |
| 14 | 樂透那六條串**丟了 `#NNNN` 語音前綴**（只留在註解），而語音只認字面前綴 ⇒ 整屏靜音 | `packages/data/src/messages.ts:247-256` 的 `LOTTERY` 六條補回 `#0011..#0016`（開獎屏 `#0017..`），號碼照 exe dump：`0x464394="#0011"`…`0x46442e="#0016"` | `stripVoice`/`playVoiceCode` 會自動剝前綴＋播語音，`drawLotteryScreen` 零改動。補一條資料測試釘「每條都以 `#` 開頭且號碼與 VA 表一致」 |
| 15 | `screens.ts` 把 `noticeBoxScreen` 排在 `wheelScreen` **之前**，且保費框的閘不含轉盤 ⇒ 框先彈、**壓住轉盤並吃掉玩家的點擊** | `screens.ts` 把 `wheelScreen`/`godSlotScreen` 移到 `noticeBoxScreen` **之前**；`main.ts:5456` 的 `setNoticeStartGate` predicate 追加「轉盤/老虎機在播」 | 原版：轉盤 `fcn_0044090e(3)`(0x41ac3f，阻塞、玩家點停 0x43fa84) → 加保險期 → **保費框**(0x41aeaa) → 付款。★ 原版**沒有**「確認天數」的獨立畫面 ⇒ 若需求方要那個，屬新增需求 |
| 16 | `requestRender` 裡每幀的 `syncShopUi()`（W-67-a 補呼）**漏了 `aiVenue` 閘** ⇒ NPC 的店被鋪起來，放 `midi07` + 招呼語音 `#0000` | 把 `aiVenue` 抽成純函式，`main.ts:6329` 改成 `if (screen === 'game' && !aiVenuePending(state)) syncShopUi();`（或在 `syncShopUi` 內收口） | ⚠️ **不要**改 `detectShopGift`：原版那句「董事長贈禮」在 `0x42ea23`、在分人機（`0x42ea32`）**之前** ⇒ **NPC 說那句是對的** |
| 17 | 原版特殊格落點有**統一一聲**落地音，複刻只接了買地/神明那幾支 | `SOUND_IDS` 加 `SPECIAL_SQUARE: 43`（種類 2..9、14..16）與 `CARD_SQUARE: 48`（種類 10..13）；`playSoundFor` 按落點 `specialKind` 放（**只在「剛落上去」那條 action**） | `0x00419884..a1`：種類 2..16 → 下標表 `0x475299=[9,0,10,10,10,10,10,10,10,10,16,16,16,16,10,10,10]` → 移動音效表 `0x48234a`：idx10→**43**、idx16→**48**。**卡片格 = 種類 13 = 音效 48**。⚠️ `playSoundFor` 目前沒收 `action`，是唯一需要小改簽名的地方 |
| 18 | `drawBankLoan` 的開啟條件只看 `pending.kind==='bank'`、**不看人機** ⇒ NPC 的 bank pending 期間整張銀行內頁被畫出來 | `main.ts:6521` 條件補 `&& !isAiTurn(state)` | 原版 `0x004366a3 cmp [player+0x15],1 / jne 0x4367ab` ⇒ 電腦支直接借款、**全程不畫屏**。ATM 面板已有 `localSeatActive()` 判據，不受影響 |

## 已知的「未找到證據 / 需拍板」
- **#1** 房間人數語義、大廳 6 條設置的版式（原版**沒有**聯機大廳 ⇒ 無可對照，`known-deviations.md:1350-1360` 已取證）。
- **#14 的 BGM 那一半**：log 證明已正確放 `midi07.mid`（exe id 6 = MIDI07，且與百貨共用同一首）⇒ **未找到證據支持「BGM 起播錯誤」**，建議不改（若要樂透專屬曲 = 需求變更）。
- **#15** 原版沒有「確認天數」的獨立畫面（唯一輸入是轉盤上點一下）。
- **#11** 救護車那段「畫面上是不是一台救護車」無法從 asm 判定（全 repo 無 ambulance 字串）。
