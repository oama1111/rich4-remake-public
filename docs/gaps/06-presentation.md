# 差距清单 · 渲染 / UI / 动效 / 台词语音 / 音效

> 生成方式：以 `rich4-spec/docs/systems/{render-api,ui,animation,dialogue-voice,sound-effects}.md` 为权威，
> 逐条核查 `rich4-remake` 实现。本轮只做分析，未改动任何代码。
> ⚠️ 画质升级与联网**不在本轮范围**（用户已明确延后），只核对"原版行为是否被 1:1 表达"。
>
> **取证纪律**：原版侧一律给 `0xADDR`（必要时附 `rich4-spec/gen/db.txt` 行号）；
> remake 侧一律给 `文件路径:行号`。证据不足写「无法判定」，不猜。
> `rich4-re/` 未被引用为论据。

---

## 一、结论摘要

1. **★ 阻断级 · `#NNNN` 语音码只播了 232/842 个。**
   解析语义本身**没写错**（未加偏移、未拒绝低编号），但 remake **不播低编号**：
   全 `client` 只有一处播 `Speaking.mkf`（`packages/client/src/main.ts:5093`），
   其取值只可能来自 `speechIndex(character, event)`（`packages/client/src/speech-bubble.ts:170`）
   = `1050 + 27×角色 + 事件`。据权威规格实测，文本里出现的 `#NNNN` 共 **842 个不同编号、
   范围 4..1373，其中 610 个低于 1050**（`rich4-spec/docs/systems/dialogue-voice.md:88-95`）
   —— 这 610 个**全部不出声**，只被剥掉前缀当普通文字画。
2. **★ 阻断级 · 金貝貝（角色 11）的 27 条配音被显式置 `null`。**
   `packages/client/src/speech-bubble.ts:170` 写的是 `voice: isEmoji ? null : speechIndex(...)`。
   而 `#NNNN@DD` 形态里 `#NNNN` **照样要播**：`rich4-spec/gen/db.txt:88409-88437`
   （`0044f0e8 cmp esi,5` → 解析 4 位 → `0044f136 call 0x45441a` = `play_speech`）。
   于是 **1347..1373 这 27 段语音永远不播**。
3. **★ 阻断级 · 地图视角旋转（`0x499088`）不进存档。**
   原版把该全局 `fwrite` 进存档（`rich4-spec/docs/systems/save-format.md:107,127` 的 `+0x2743`，4 字节）；
   remake 的 `camera.view` 是**客户端渲染态**（`packages/client/src/render.ts:200-213`），
   **不在 `GameState` 里**（`packages/core/src/state/types.ts:321` 起无 `view` 字段），
   自家存档只有 `{magic, version, state}`（`packages/core/src/loaders/savegame.ts:56-60`）；
   读原版存档时更**直接跳过这 4 字节**——`OFFSET.fortuneDeck = 0x271e`（37 项）之后
   直接接 `OFFSET.mapDataSize = 0x2747`（`packages/core/src/loaders/save.ts:269-271`）。
   读档后视角一律归零。
   ⚠️ **附带发现：登记表本身是错的。** `docs/known-deviations.md:5169` 把该存档块标为
   「❓ 未定」，而同一份 `known-deviations.md:1070-1071`（Q-LAYOUT-5）已认定
   `[0x499088] = camera.view` —— 两处自相矛盾，且都与规格 `animation.md:78,279` 冲突。
4. **严重 · 音效「按界面预载 / 离开即释放」这套结构整体缺失。**
   原版 19 张音效表（64 项、60 个编号）、`0xFFFFFFFF` 终结符、16 槽释放表
   （`rich4-spec/docs/systems/sound-effects.md` §一/§三/§三之二）在 remake 里**没有对应物**：
   `SoundPlayer` 只有三个 `Map`（`packages/client/src/audio.ts:25-26,39`），
   整档 `Effect.mkf` 开机常驻（`main.ts:7648-7655`），单个 WAV 首次 `play()` 才解码
   （`audio.ts:93-129`），解码结果**永不驱逐**，`stopAll()`（`audio.ts:164-166`）从未被调用。
   15 对 load/release **一对都没对齐**（见 §五 5.2）。
5. **严重 · 音效播放点数量与覆盖面明显不足。**
   原版 `play_sound_effect`（`0x4542ce`）**151 处**调用；remake 合计约 **74 处**
   （`main.ts` 51 处 + 10 个屏模块 23 处，另 1 处 `Speaking.mkf`）。
   规格 §四 列出的 10 个热点函数中，**≥4 个语境在 remake 里没有任何播放触发**：
   `0x00417e26`（總資產面板）、`0x0043ff56`、`0x00413248`、`0x00453745`（通用 YES/NO 框，
   5 处，且它**每次交互都触发**）。**6 个音效集的编号完全没有播放点**：
   股市 40/41、公司分红 61、樂透 31、開獎 57/58、`0x415872` 的 26、
   填数窗按键音 7（`stock-screen.ts` 与 `lottery-draw-screen.ts` **全文 0 处播放**）。
6. **严重 · 模态界面：42 个中 1:1 7 个、有差异 29 个、缺失 6 个**（逐项见 §二）。
   6 个缺失集中在**终局流程**（2 个）、**魔法屋玩家选择**、**贷款到期提醒**、
   **嫁禍卡选人**、**AVI/MCI 影片**：
   `0x4060e9`（终局颁奖屏）、`0x406b14`（终局结算模态）、`0x433088`（召喚死神問答）、
   `0x436034`（貸款到期提醒窗）、`0x43ff56`（玩家选择框／嫁禍卡选人）、`0x45156f`（AVI 播放窗）。
   其中两条**后果直接可见**：
   - `0x43ff56` 缺失 ⇒ `scapegoatPicker` 被硬编码为 `() => -1`
     （`packages/core/src/cards/frame.ts:94`、`packages/core/src/cards/passive.ts:186`）
     ⇒ **嫁禍卡永远只能「放弃转嫁」**；而字符串 `請選擇嫁禍對象...` 已在
     `packages/data/src/messages.ts:41`，只是没有任何窗用它。
   - `0x436034` 缺失 ⇒ 客户端无任何贷款到期提醒 UI，且 `loanDueDate` 在
     `packages/core/src/state/reduce.ts` 里 **0 引用** ⇒ **连规则层的到期检查也未落地**。
   架构上 remake **没有**原版的「模态嵌套深度 `0x46cad8` + 层级处理器数组 `0x48a010[depth]`」，
   改成「一个 `screen` 字符串状态机」（`packages/client/src/main.ts:3447-3449`）
   + 「优先级排序的整屏登记表」（`packages/client/src/screens.ts:37-76`）
   + 一张**扁平的**取消梯子（`packages/client/src/panel-cancel.ts:100-140`）。
   ✅ **单窗口铁律是遵守的**：前端只有一个 `<canvas id="board">`（`packages/client/index.html:53`），
   舞台/棋盘/HUD 三块都是**离屏 canvas**（`main.ts:3416,3426,3436`），不是窗口。
7. **严重 · 文字没有唯一入口。** 规格把 `drawText_colorcode`（`0x44fabc`）列为 **P0
   「所有文字的唯一入口」**（`rich4-spec/docs/systems/render-api.md:86-91,178`）；
   remake 有 **74 处** `ctx.fillText` 分散在各屏（如 `board-screen.ts:1335`、`saveload.ts:290`、
   `inventory.ts:301`），颜色各屏硬编码，`#NNNN` 由**四处各自** `slice(5)`
   （`lottery-screen.ts:587`、`magic-screen.ts:1182`、`lottery-draw-screen.ts:681`、
   `packages/data/src/event-table.ts:283`）。这既是接口差异，**也是 §四 V1 的成因**。
8. **轻微 · 鼠标是事件驱动，不是 `GetCursorPos` 轮询。**
   `ui.md` §八.2 明确要求「不要改成 `mousemove` 事件」；remake 用
   `e.clientX/clientY` + `getBoundingClientRect()` 现算（`main.ts:5313-5318,5986,7024,6811`），
   无 `0x475284`/`0x475288` 式全局光标缓存。浏览器平台下这是唯一做法，但采样时机与原版不同。
   ✅ 键盘失焦失效这一条**由平台天然满足**（浏览器只在文档获得焦点时派发 `keydown`），
   remake 无显式 `0x46cb01` 等价闸门（`main.ts:7097` 的 `window keydown` 是唯一入口）。
9. **文档级 · `#NNNN` 被误称为「颜色控制码」一处。**
   `packages/client/src/bank-dynamic.ts:548`：「串首的 `#00xx` 是 `draw_text` 的**颜色控制码**」。
   该处**代码行为正确**（`raw` 保留 / `text` 去掉，`bank-dynamic.ts:552-571`），
   所以**不是行为阻断**，但注释是错的，与本项目其它位置的正确表述
   （`packages/data/src/messages.ts:149`「插播语音的编号」）自相矛盾。
   全仓库**没有**任何把 `#NNNN` 当 hex 颜色解析的代码路径。
10. **规格侧待订正（实测反证，非猜测）· `Effect.mkf` 的计数差一。**
    规格 §五写「116 个资源」「64..80 是 0 字节占位（17 个）」「81..115 真实 WAV（35 个）」。
    实测 `extracted/Effect/`：**115 个 `.bin`**（余 1 个是 `meta.json`）、
    **0 字节的是 `0064..0079`（16 个）**、非空 **99 个**。
    即正确边界是 `64..79` 空、`80..114` 真实未引用。remake 侧的数字
    （`packages/assets-pipeline/src/audio.ts:6`「115 项」）与实测一致。

---

## 二、★ 模态界面逐项对照表

> 权威清单 = `rich4-spec/docs/systems/ui.md` §一之二 / §三之三 的 **42 行**
> （已机械核对：`ui.md` 中含「（宿主 `0x…`）」的行正好 **42** 行）。
>
> **重要**：表格里的「宿主函数」是**注册点所在函数**，第 1 列才是 `WndProc` 真正转交的
> **界面处理器**（`ui.md` §一之二 的 ⚠️ 已声明）。原版的「界面」就是这一列的函数指针。
>
> 判据说明：`1:1` = 该界面的版面／交互／收屏路径均按 exe 复刻且**当前无登记的偏离**；
> `有差异` = 界面存在但有可指出的偏离（含近似、未接线子项、架构层差异）；
> `缺失` = 找不到对应物。
>
> 「原版行为要点」栏只写**规格给出的身份/语境**；remake 各屏的逐控件取证在
> 「remake 现状」栏内随 `@source` 注释给出（每个屏模块头部都有 VA 表）。

| 模态处理函数 VA | 界面名 | 原版行为要点（证据 @source） | remake 现状（文件:行） | 是否 1:1 | 差异 |
|---|---|---|---|---|---|
| `0x40257a` | 版本／標題屏 | 宿主 `0x004029fd` 引用 `V3.11`（`ui.md:161`；§三之三 `ui.md:485`） | `packages/client/src/title.ts:8`（引 VA `0x00402762`，落在该 774 字节函数区间内）、`:66-70`；`main.ts:4848` | 有差异 | ① **没画 `V3.11` 版本字串**（全 `client/src` grep 零命中）；② `title.ts:66-70` 另有一颗原版没有的 90 px「图未解完时的兜底命中框」。⚠️「`V3.11` 是否属于这一屏」规格未说明（U7′） |
| `0x40363a` | 存檔槽選擇（**SAVE**） | 宿主 `0x00403d74` 引用 `SAVE%d.DAT` / `AUTO` / `%d/%d`；底图 `Data.mkf #0x208`（图 0 = LOAD 六行、图 1 = SAVE 五行）、槽 0 只在 LOAD（`ui.md:162`） | `saveload.ts:7,43,262`；`main.ts:1245` | 有差异 | ① 存档载体不是 `SAVE%d.DAT` 二进制，而是带版本号的 JSON（`packages/core/src/loaders/savegame.ts:44-60`）；② 行右侧文字排版是**自定**的（`saveload.ts:36-38` 自陈）；③ LOAD 屏多一颗原版没有的「匯入原版存檔」钮（`known-deviations.md:5229-5239`、`saveload.ts:115-123`） |
| `0x4039c2` | 存檔槽選擇（**LOAD**） | 宿主 `0x00404165`（`ui.md:163`；`ai.md:134` 自记「推断」） | `saveload.ts:43`（`SAVELOAD_IMAGE.save`）；`main.ts:1748` | 有差异 | 与 LOAD 合并进**同一个** `saveload.ts`／同一个 `screen='saveload'`（原版是两个各自独立的窗口过程）；其余同上 |
| `0x404e44` | 新局設定屏（规格**未命名**该宿主） | 宿主 `0x00406ffe` 未直接引用 UI 串（`ui.md:164`）；规格 §七.3 自陈「剩余仍待定名」 | `setup.ts:1,552`；`main.ts:5816,4894` | 有差异 | remake 自认该屏仍有未接线/自定项（`docs/deviations/Q-SETUP-1.md:1`、`known-deviations.md:4360`）。⚠️ **身份只有 remake 侧文档支撑**（`docs/tasks/cards.md:3696`）→ 见 U1 |
| `0x4060e9` | **终局頒獎／名次屏**的「按一下繼續」窗 | 宿主 `0x004075c1`；§一之二 该宿主引用 `END.AVI/JUMP.MKF/OVER.AVI/THANKS.AVI`（`ui.md:165`）；`known-deviations.md:4425-4431` 判：`fcn_004075c1` 兼两用（名次没满 4 → 继续下一关；满 4 → 整局结束） | **无**（`grep gameOver packages/client/src` 0 命中） | **缺失** | `known-deviations.md:4430` 明写「终局的頒獎屏 `fcn_004075c1` **仍未接**」，理由见 `Q-SETUP-1.md:162-180`（依赖多关流程 `0x4991b6`/`0x4991b8` 与名次表 `0x4990f0`，本引擎是单关且无该表）⇒ **终局只是停在棋盘上** |
| `0x406b14` | 终局結算模態（只剩 1 人时的分支） | 宿主 `0x00407842`；`bank.md:624` 判为「只剩 1 人 → 游戏结束判定」；同文件 `:1103` 自记该函数精确语义**未逐行确认** | **无** | **缺失** | `known-deviations.md:4403`：「单人类局那支原版还会弹 `fcn_00407842` 的模态框、可能返回 `4`=读档屏，**未复刻**」。⚠️ 该屏**画什么**无法判定（U2′） |
| `0x40a801` | 大地圖彈窗（縮小地圖） | 400×400 浮窗贴 (20,60)，只 Blt `RECT(20,60,420,460)`，右侧栏照旧露出（`ui-screen.ts:134-136`） | `screens.ts:75`；`big-map-screen.ts:6,215-241` | 有差异 | `docs/deviations/T-086.md:15,48,63,74,82` 五条有意偏离：在世判据改 `isAlive()`、底下那帧重画而非「存回再贴」、右键走浏览器 `contextmenu`、键盘全吞的位置、删掉自造的视角切换 |
| `0x411122` | 設定屏 · **熱鍵頁** | 宿主 `0x00411a86`；功能名表 28 条（`ui.md:46-68`、`:167`） | `options-pages.ts:437`；`main.ts:2350` | 有差异 | 原版第二列会「改到下一行」、最下面那格**写坏相邻内存**；remake 复刻了差一（`options-pages.ts:39-43`），但**越界那一下直接忽略**（`known-deviations.md:2604-2606`） |
| `0x4103a3` | 設定屏 本體（OPTION） | 宿主 `0x00411b53`；16 项控件矩形表 `0x474b92` + 16 路跳表 `0x41034b`（`known-deviations.md:2506-2521`） | `options.ts:6,70-93`；`main.ts:2204,4942` | 有差异 | 「結束遊戲」原版是「存 CFG + 置退出标志」，remake 只 `screen='title'`（`known-deviations.md:2642`）；主面板 16 条控件表已照抄 |
| `0x414858` | 小遊戲 · 企鵝挖寶 | 宿主 `0x00415215` 引用「得點券%d點」（`ui.md:170`）；入口 `0x00415215`（`small-games.md:224`）；音效集 `0x475057`（11..18） | `screens.ts:69`；`minigame-screen.ts:11,26,33,212-227` | 有差异 | `T-042-044.md:88`（命中表 `Panel.mkf #81` 取不到 → 用 `0x474d7c` + 菱形几何绕开）、`:154`（**没有**原版的「不玩」支）、`:177`（走行/土堆整数格简化） |
| `0x414fcd` | 小遊戲 · 喜從天降＝財神接金幣 | 宿主 `0x004155fc`（`small-games.md:778`）；底图 `Panel.mkf #92`；音效集 `0x4750bf`（22,23,24,15） | `screens.ts:69`；`minigame-screen.ts:13,69,235-239` | 有差异 | `T-042-044.md:56`（底图 #92 无头 RGB555 另走 `readRaw555Resource`）、`:193`（接住判定按当前帧贴图量近似）、`:154`（无「不玩」支）；音效 23 未使用 |
| `0x41dda9` | AI 個性設定屏（託管） | 宿主 `0x0041e345` 引用「個 性／資金運用比例／使用卡片／使用道具／乖寶寶（`ui.md:172,235,273`）」 | `ai-settings.ts:5,45-47`；`main.ts:2796,4914` | 有差异 | `known-deviations.md:1264-1279`（Q-LAYOUT-1）：两张 116×86 亮/暗行图的**用法没跟到**，remake 自行决定「按行画 + 裁到 32 px」 |
| `0x423cf3` | 個人資產表 | 宿主 `0x00424492`＝工具栏跳表 `0x417d39[6]`；底图 `Panel.mkf #9`（`scenes.ts:10`） | `asset-sheet.ts:10,79-81`；`main.ts:3491-3499,4877` | **1:1** | 三个视图、页签、EXIT、下钻钮、道具/卡片欄均带 VA 逐条落码；无登记的界面级偏离（唯一全局差异是系统字体替代原点阵字）。⚠️ 但该屏在规格 §四属热点 `0x00417e26`（8 处音效），**音效全缺**（见 §五 5.3） |
| `0x4258c1` | 公佈欄屏内「賣股票 選物窗」（规格**未命名**该宿主） | 宿主 `0x00428296`（`ui.md:174`）；处理器即 `fcn_004258c1`（`board-screen.ts:17`）；底图 `Panel.mkf #73` 图 1（336×416，`board-screen.ts:25`） | `board-screen.ts:18,397,2142-2150` | 有差异 | ① 出价输入改用 `dialog.ts` 的 `AmountPage`，**不是**原版的数字键盘窗（`docs/deviations/T-033.md:37` D-BOARD-2）；② 界面名靠 remake 侧判定（U3′）；③ `board-screen.ts` **全文 0 处音效播放**（该屏在规格 §四热点 `0x00417e26` 内） |
| `0x427c21` | 规格名 = **持股明细屏**；remake 名 = **公佈欄屏主窗口过程** | 宿主 `0x004284be`（`ui.md:175`）；规格 §二 用 `EXIT/地點：/市價：/張數：/持有張數/總市價/等級：` 命名（`ui.md:233`）。⚠️ `rich4-spec/gen/string-xrefs.json` 显示 `0x004284be` 引用的正是**公佈欄详情框**（图 6/7/8）标签（`board-screen.ts:31-40`），而 `board-screen.ts:14` 记该函数为 `_rich4_ui_sale_entry` | `board-screen.ts:15,2142-2190`；`screens.ts:65`；右键逐层关（`Q-UI-8.md` §2.2） | 有差异 | ① **名称／功能归属分歧**：规格称持股明细屏、remake 称公佈欄屏（挂/撤/买/出价）。remake 的详情框也确实同时含 `地點：/市價：/張數：` ⇒ **哪个名称正确无法判定**（U4′），但**规格侧命名与自身字符串证据冲突**这一点是确定的；② 出价输入同上为 `AmountPage`（`T-033.md:37`）；③ `T-033.md:151` 记一处选物窗分类近似 |
| `0x429d65` | 上市公司資訊 详情卡 | 宿主 `0x0042b1ef`（`stocks.md:1249`）；右键 = 关详情卡回股市屏、不放音（`panel-cancel.ts:125`） | `stock-detail.ts:7,25,189`；`main.ts:4956` | **1:1** | 有/无上市公司两支、持股饼图（`Pie`/`Ellipse`）均已按 VA 落码。⚠️ `docs/deviations/Q-STOCK-6.md:186` 仍记「半年走势线 + 两个价签本轮没碰（上一轮已取证落地）」——属**未复核项**，非已知偏离（U10′） |
| `0x42b2ec` | 股市「**本日休市**」訊息框窗口过程 | 宿主 `0x0042b58f` 的 `0x42b731 push 0x42b2ec`；`stocks.md:642`：「休市那一屏没有表头、没有股票名、没有行情数字、**点哪儿都退屏**」 | `stock-screen.ts:83,263-264,693-699`；`main.ts:6445-6455` | **1:1** | 行为等价（只画底图 + 三颗钮字 + `本日休市`，任何一下左/右键退屏）。原版是**另开訊息框窗口过程**，remake 在股市屏内同一分支实现、**无独立模态层**（架构节）。core 另有一道 `marketOpenOn` 闸属规则层（`known-deviations.md:1565`） |
| `0x42aaff` | 股市屏本體（行情頁／持股頁） | 宿主同为 `0x0042b58f`（`cards.md:4531-4532`）；音效集 `0x475590`（40,41） | `stock-screen.ts:1-30,157-158,641-642`；`main.ts:1071` | **1:1** | 两页/标题反了照抄（`known-deviations.md:1525-1538`）、未上市行读 0 号格与「0 也要画」已订正（`Q-STOCK-7.md` 末尾两条为「已改／等价」）。⚠️ **该屏全文 0 处音效播放** ⇒ 40/41 未播（见 §五） |
| `0x42b3eb` | 公司分紅屏 | 宿主 `0x0042ba97` 引用「上市公司分紅／人名／公司／本月盈餘／紅 利」（`ui.md:179`）；音效集 `0x4755a8`（**1 项 = 61**） | `shares-screen.ts:93,688-692`；`screens.ts:43` | 有差异 | `docs/deviations/T-031.md:22`（**D-T031-1，差在 core**）：分红金额原版**截断**，而 `companyDividends()` 四舍五入。另 `shares-screen.ts:262` 的 `SHARES_SOUND={open:0,page:1,choice:2}` **全仓无使用**，把 1 项的表当 3 项下标 ⇒ **61 未播**（见 §五 S11） |
| `0x42d37f` | 百貨公司（卡片／道具商店） | 宿主 `0x0042e931`——规格 §三 把它明确列为「**待定（本批最大）**」（`ui.md:268`）；右键直接走人、不说道别语不放音（`Q-UI-8.md` §2.2） | `shop-screen.ts:8,53-58`；`main.ts:5154,5272` | **1:1** | 面板/老板娘/气泡/货架/两颗钮/點數底板全部带 VA 落码；`known-deviations.md:2063` Q-SHOP-1 已结案。⚠️ **宿主身份规格未定名**，靠 remake 侧判定（U5′） |
| `0x42f7fc` | 樂透投注屏 | 宿主 `0x004315cc`；底图 `Panel.mkf #12`（`scenes.ts:12`）；音效集 `0x47566b`（31）；右键 = `PostMessage(0x406,5,0)` 画「拜拜」再关（`Q-UI-8.md` §2.2） | `lottery-screen.ts:9,798-801`；`screens.ts:67` | 有差异 | `docs/deviations/T-035.md:13`（D-035-1 有意偏离：号格命中**不照抄**原版那两条越界边）、`:116`（「拜拜」那一拍自留）。另只播 4（`:943`）⇒ **31 未播**；`#0011..#0016` 六句语音全不播（`stripVoice`，`:587`） |
| `0x43010c` | 樂透開獎屏 | 宿主 `0x00431712`；底图 `Panel.mkf #15`（`scenes.ts:13`）；音效集 `0x47567b`（57,58） | `lottery-draw-screen.ts:10,1199-1202`；`screens.ts:44` | 有差异 | `docs/deviations/T-036.md:59`（D-036-1 **结构性近似**：中奖号只能从 `before→after` 反推）、`:76`、`:113`（脸/铭牌底框近似）。另全文 0 处播放 ⇒ **57/58 未播**；`#0017..#0036` 十余句语音全不播，`voiceOf()`（`:686`）**只在单测里被调用**（`lottery-draw-screen.test.ts:418`） |
| `0x4325c2` | 魔法屋 12 項轉盤窗 | 宿主 `0x0043380a`；底图 `Panel.mkf #18`（`scenes.ts:14`）；音效集 `0x4757e7`（39）；入口三句台詞 + `#0040`/`#0041`（`Q-ANIM-1.md` §1） | `magic-screen.ts:10,1409-1410`；`screens.ts:46` | 有差异 | `T-037.md:52`（D-MAGIC-3 **已解出**（第 101 条）：那个字段是**指针高亮框的图号**，不是帧数；图 11..21 仍无消费点）、`:162`（D-MAGIC-6 命中几何用角度，原版是逐像素掩膜）、`magic-screen.ts:21-27`（图 11..34 读数冲突，按成对读近似）。39 号音效**对位正确**（`:1113` 定义、`:1476` 播放）；但 `#0037/#0038/#0039`（`:391-395`）与 `#0040/#0041`（`:453,460`）**只剥前缀、不播语音**（`magicGreetText`，`:1182`） |
| `0x433088` | 魔法屋「要召喚死神嗎」問答窗 | 宿主 `0x004339d9`（`ui.md:184,283`；`magic-house.md:97`） | **无** | **缺失** | remake 魔法屋**全程自动**：`magic-screen.ts:5-8` 自述「这一屏在 core 里**没有待决交互**，两个转盘都是自己 `rand()` 转的，玩家一次也插不上手」；`packages/core/src/rules/interaction.ts:270` 记「魔法屋曾经是这种情况，现在已实现」指的只是**结算**，`PendingInteraction` 里**没有**该 kind ⇒ **玩家无法选死神目标** |
| `0x435062` | 銀行貸款屏（窗口过程） | 宿主 `0x00436668` 为「银行柜台窗口过程」（`ui.md:276`）；入口 `0x00436668`（`bank.md`）；右键 = 说再见 + 关屏 + 状态 `st=0xb`（`Q-UI-8.md` §2.2） | `bank-loan.ts:7,11-70`；`main.ts:4973-4995`；`panel-cancel.ts:139` 的 `loan` 层 | 有差异 | `docs/deviations/T-029.md:546`（Q-BANK-1d：三条数额那 113×117 **擦除块没实现**，有意）；`bank-loan.ts:254`（装饰性眨眼用 `Math.random`）、`bank-dynamic.ts:601`（两套气泡共用一处落点，登记为已知近似）。另「特別融資」子對話框**未复刻**（`Q-UI-8.md` §1.3 自陈；`T-029.md` 的 Q-BANK-1a） |
| `0x436034` | **貸款到期提醒窗**（三段消息） | 宿主 `0x0043695e`；入口链 `0x00436b01 call 0x43695e` → 若 `[p+0x496b7d]==1` 则开提醒窗 `0x436034`；三段：`0x464b43` 距貸款到期日還剩１天／`0x464b5c` 還剩２天／`0x464b2c` 強制執行（`bank.md:660-672`） | **无** | **缺失** | 客户端**无任何提醒 UI**（`grep 提醒 packages/client/src` 0 命中）；`loanDueDate` 在 `packages/core/src/state/reduce.ts` 里 **0 引用**（只在 `main.ts:968` 用来显示「距還款日%d天」）；原版三段提示串与 `距貸款到期日` **也不在** `packages/data/src/messages.ts` ⇒ **连规则层的到期检查也未落地** |
| `0x436ef8` | 銀行 ATM 窗口过程 | 宿主 `0x004379c9` 为「银行 ATM」（`ui.md:277`）；`bank.md:38`；ATM 有**自己的**数字键盘（`Panel.mkf #24`），不走通用填数窗（`Q-UI-8.md` §1.3） | `bank-screen.ts:6,16,64-89,265`；`main.ts:4833`；`panel-cancel.ts:107` 的 `atm` 层 | 有差异 | `docs/deviations/T-029.md:214`：金额栏那一片原版是**一整条拖动**，remake 不实现拖动，且命中表里**自加了一颗「取消」**；`:248` |
| `0x437e61` | 銀行月結／頒獎屏 | 宿主 `0x00439bfa` 引用「存款：／貸款中」（`ui.md:188`）；`bank.md:478`；`Q-ANIM-1.md` §2 订正为月結頒獎屏；音效集 `0x475b17`（27,28,60） | `monthly-screen.ts:58,1732-1733,1752,1787-1789`；`screens.ts:45` | 有差异 | `docs/deviations/T-041.md:189`（D-MONTHLY-3 **有意补写** `存款：`/`利息：` 两个标签）、`:185`（帧→落点近似）、`:327`（仍有「未接」项点名）。音效 27/28/60 **三条全部对位正确** |
| `0x43a2dd` | 拍賣屏 | 宿主 `0x0043c08d`；底图 `Panel.mkf #26`（`scenes.ts:17`）；音效集 `0x475bba`（29,63）；`rich4_ui_auction.asm` 全文无 `0x205`、不读 `[0x497159]`（`Q-UI-8.md` §2.3、`Q-ANIM-1.md` §1） | `auction-screen.ts:23,263,265,917,970-973,1040,1123,1127`；`screens.ts:66` | 有差异 | ① **架构差异**：竞价循环整条从表现层搬进 core（`known-deviations.md:4305`、`auction-screen.ts:9-20`），只余真人那一口由屏收；② `T-034.md:104`（D-T034-5 心理价位 `rand()` 换确定性序列）、`:156`（挥锤三帧自定）。音效 29/63 **对位正确** |
| `0x43caab` | 監獄保釋格 | 宿主 `0x0043d304` 引用「保釋%s」（`ui.md:190,476`；`places.md:495`）；`loc_0043d266` 右键 = 收定时器 + 关屏 + 返回 0 = 不保釋（`Q-UI-8.md` §2.2） | `bail-screen.ts:9,53-66,306`；`main.ts:3729,5159` | 有差异 | `bail-screen.ts:306`：「鼠标底下那格描一道（**本项目自己加的**：原版靠气泡，没有框）」；另右键语义按**監獄那一支**处理，醫院那一支「只读到一半」（`Q-UI-8.md` §四.1 自陈） |
| `0x43da27` | 醫院出院格 | 宿主 `0x0043e9a4` 引用「保釋%s」（`ui.md:191`）；`loc_0043e7c7`（`Q-UI-8.md` §2.2） | 同 `bail-screen.ts:9,66`（`HOSPITAL_SLOTS`），与監獄共用 | 有差异 | 同上（监/医两屏同构，共用同一段自加悬停描边）；醫院那一支的 `0x205` 未读全 |
| `0x43fae4` | 設施类别选择屏 | 宿主 `0x00440aac` 引用「請選擇設施類別」（`ui.md:192,477`）；`cards.md:1455`；共享 UI 图集 `Data.mkf #0x205` | `facility-picker.ts:8-9,23,50-52,360`；`screens.ts:58`（`windowed: true`） | 有差异 | `docs/deviations/Q-TOOL-4.md:340`：「命中仍是『半径 24 的圆 + 实例锚点』的近似，不是原版那张 440×440 的**像素级实例表**」（`0x40a9d7`） |
| `0x43ff56` | **玩家选择框**（嫁禍卡多候选：「請選擇嫁禍對象...」） | 宿主 `0x00440e1a`；`cards.md:2504` 该处理函数 `0x0044476a` 的**人类路径**「列出除自己外的所有在局玩家」（`0x004447a1 cmp [esi+0x496b7d],1`）；字符串 `請選擇嫁禍對象...` @ `0x46535d` | **无** | **缺失** | `packages/core/src/cards/frame.ts:94` 把 `scapegoatPicker` **默认硬编码为 `() => -1`**（`passive.ts:186` 同）；`state/preview.ts:27-28` 自述「UI 若要做『嫁祸时再选一次』，把选择器传进来即可」＝**UI 未做**。字符串已在 `packages/data/src/messages.ts:41`，但无任何窗用它 ⇒ **嫁禍卡永远只能放弃转嫁** |
| `0x4402d7` | 研究所開發菜單 | 宿主 `0x0044101d` 引用「請選擇欲開發道具」（`ui.md:194,478`）；`tools.md:1001` | `research-screen.ts:11,223-225,525-526,547,557,586`；`screens.ts:68` | 有差异 | `docs/deviations/T-040.md:28`（D-040-1 **有意偏离**：項目名只在悬停时画、位置固定）、`:162`（立绘板落点是假设）、`:169`（图号是否随地图/角色变**未解出**）、`:177`（去色块用 canvas 混合）。音效 3 处 ↔ 规格 §四的 3 处**数量对位** |
| `0x4413ec` | 搶奪卡「从对方手里挑一件」窗 | 宿主 `0x0044192a`；`cards.md:3030`；底图 `Panel.mkf #0xb`（`steal-picker.ts:67-69`） | `steal-picker.ts:22,67-69,305-306`；`screens.ts:63`（`windowed: true`） | 有差异 | `docs/deviations/T-053.md:104`：「**只剩近似，没有未做**」；`:116`（选中框**颜色**是近似的，原版走 `fcn_00451b9e` 改像素） |
| `0x4416f0` | 「請選擇卡片」面板 | 宿主 `0x00441baa` 引用「使用%s」（`ui.md:196,479`）；`ai.md:461-478`（该段使用者是**被托管模式下的真人／可操作玩家**，AI 另走 `0x441d00`） | `inventory.ts:8,14-27,54-56`；`main.ts:1785,3630,3987-4015,4878` | **1:1** | 面板（`Panel.mkf` 11 图 0）、5×3 格几何、卡名不画图标、失败重开窗全部按 VA 落码。⚠️ **托管支的触发路径无法判定**（U6′）：remake 在 core 把托管座位直接判为 AI（`packages/core/src/ai/policy.ts:102-104` `isAiTurn()` 覆盖 `isAiControlled`），客户端不再开面板 |
| `0x445e4d` | 目标拾取回调（`modal_card_dialog`） | 宿主 `0x00446ae8`；`cards.md:394`；紧邻 `0x00446c58`（路障落地）、`0x00446d39`、`0x00446e1a`（`assets-pipeline/audio.ts:165-167`） | `picking.ts:12,100,190,477`；`main.ts:3517,6041` | 有差异 | `known-deviations.md:3413-3427`：**移植版特有偏差** —— 舞台缩放后必须先把坐标 `Math.round()` 量化回 640×480 像素，否则 1280×720 等非整数倍缩放下「贴下边推镜头」整条失效；原版无这一层 |
| `0x445c14` | 道具欄 | 宿主 `0x00447d97` 引用「使用%s」（`ui.md:198`）；`tools.md:329` §3.6「使用道具的 UI 入口」 | `inventory.ts:8,20,54-56`；`main.ts:1781,3630,4878` | **1:1** | 与卡片欄同构；载具徽章（`traffic_method` 1/2 → 图 15/16）按 VA `0x447e08` 落码（`inventory.ts:20`） |
| `0x44e40b` | `help.mkf` 幫助屏（遊戲百科） | 宿主 `0x0044eb39` 引用 `help.mkf`（`ui.md:199`）；右键 = 放取消音 + 放掉图 + `Post(0)`（`Q-UI-8.md` §2.2） | `help-screen.ts:10,161-166,2319`；`screens.ts:71` | 有差异 | `docs/deviations/T-045.md:313`（D-045-5 **已知限制**：从設定屏推开时四周仍是纯黑）；`:78`（滚动单位的唯一开放问题）；`:353`（相邻条目 y 上故意重叠 35 px 照抄） |
| `0x45156f` | **AVI 影片播放窗**（MCI `avivideo`） | 宿主 `0x00451677`；引用 `open avivideo!%s alias vfw` / `play vfw window from 0 notify` / `stop vfw wait` / `close vfw wait`（`ui.md:200`）；`animation.md:271` | **无** | **缺失** | 全 client **没有任何 AVI／MCI 播放**（`grep -i "avivideo\|mciSend\|\.avi" packages/*/src` 只命中注释）。`intro.ts:10-27` 明确只实现 **MCI 打开失败后的回退分支**（`jump.mkf` 底图 + 跳伞/角色 FLIC），并自述 21 个 AVI 是残档、`IV41` 专有编码 ⇒ **AVI 那条路整体缺席**（回退分支属 `0x4060e9`/过场的另一条路） |
| `0x452c02` | 通用填數窗（計算器）窗口过程 | `fcn_00453544(max)`；区域 `(0x100,0x90)-(0x280,0x1e0)`；键表 `loc_00452e4b`（15 个 VK）；`H` = `trunc(上限×17/33)`（`Q-UI-8.md` §1.1、`Q-UI-9.md` §1） | `amount-window.ts:1-10,77-114,485`；`amount-keys.ts`；`dialog.ts:244,494`；`main.ts:668,2177,7140` | 有差异 | `Q-UI-9.md:285`：指针条的点击**故意不共用**（原版 `trunc(上限×17÷33)`，按下点窗内 x=0x40）；键盘表虽已补齐。另**按键音效 7 未播**（原版表 `0x48234a` 第 0 项 = 7，`amount-keys.ts:15` 自己记了这个 VA；`main.ts:2185-2196` 按键分支无播放） |
| `0x45367e` | 通用 YES/NO 訊息框窗口过程 | 外壳 `fcn_00453a32`；右键 = 放取消音 + 关窗 + 返回 0 = NO（`Q-UI-8.md` §2.2）；框 = `Data.mkf #0x205` 图 5（249×170，落点 (0xdc,0x8c)） | `options-pages.ts:819,828`；`dialog.ts:57-64`；`main.ts:532,1636,1666` | 有差异 | `known-deviations.md:2682-2686`：原版开框时会 `SetCursorPos(左上+0x16)` 把光标挪进框，remake **不挪用户光标**，改用「按下也记一次高亮」替代；`known-deviations.md:2641`（「認輸投降」单人局分支照原版什么都不做）。另**答是/否的 2/4 音效缺失**（规格 §四热点 `0x00453745` 有 5 处） |

### 统计

| 判定 | 个数 | VA |
|---|---|---|
| **1:1** | **7** | `0x423cf3` `0x429d65` `0x42b2ec` `0x42aaff` `0x42d37f` `0x4416f0` `0x445c14` |
| **有差异** | **29** | `0x40257a` `0x40363a` `0x4039c2` `0x404e44` `0x40a801` `0x411122` `0x4103a3` `0x414858` `0x414fcd` `0x41dda9` `0x4258c1` `0x427c21` `0x42b3eb` `0x42f7fc` `0x43010c` `0x4325c2` `0x435062` `0x436ef8` `0x437e61` `0x43a2dd` `0x43caab` `0x43da27` `0x43fae4` `0x4402d7` `0x4413ec` `0x445e4d` `0x44e40b` `0x452c02` `0x45367e` |
| **缺失** | **6** | `0x4060e9`（终局頒獎／名次屏）`0x406b14`（终局結算模態）`0x433088`（召喚死神問答）`0x436034`（貸款到期提醒）`0x43ff56`（玩家选择框）`0x45156f`（AVI 播放窗） |
| 合计 | **42** | 与规格 §三之三 的 42 行一一对应，**无遗漏、无重复** |

> 6 个缺失集中在**终局流程**（2 个）、**魔法屋玩家选择**、**贷款到期提醒**、
> **嫁禍卡选人**、**AVI/MCI 影片**。
> 29 个「有差异」中，多数是**已登记的近似/有意偏离**（各 `docs/deviations/*.md`），
> 而非未做；若按「界面是否存在」口径，实际只有上述 **6 个是整屏缺席**。

### 架构差异（不是「漏了一个界面」，而是整套路由模型不同）

| 项 | 原版（证据） | remake（文件:行） | 类型 | 严重度 |
|---|---|---|---|---|
| 窗口数 | **只有 1 个**：`RegisterClassA` ×1 @ `0x401c05`、`CreateWindowExA` ×1 @ `0x401c41`（`rich4-spec/gen/db.txt:906,928`；`ui.md:107-115`） | 1 个 `<canvas id="board">`（`packages/client/index.html`）+ 3 块**离屏** canvas（`main.ts:3416,3426,3436`）；Tauri 单窗口 | 1:1 | — |
| 界面打开 | `modal_msg_pump(handler, arg)`：`0x48a010[depth] = handler`（`ui.md:137-147`）+ `PostMessageA(hwnd, 0x401, 0, arg)`；界面处理器是**裸函数指针**，签名同 `WndProc` | **两条并存的路**：① 一个 `let screen: Screen` 字符串状态机（`main.ts:3447-3449`，枚举 `'title'/'setup'/'options'/'saveload'/'lobby'/'aiSettings'/'intro'/'assets'/'inventory'/'stock'/'game'`），打开＝赋值、关闭＝赋回 `'game'`（如 `main.ts:1071,1250,2204,2796,3496,3630,5816`）；② `screens.ts:37-76` 的整屏登记表，每帧取第一个 `active()` 为真者（`main.ts:4237-4244` `activeUiScreen()`） | 接口不符 | 轻微 |
| 嵌套 | 深度整数 `0x46cad8` + 层级处理器数组 `0x48a010[]`；退出 `dec [0x46cad8]` 自动回退（`ui.md:487-492`）；「导航栈由 `0x46cad8` 这个整数维护，没有显式的栈结构」 | **没有可嵌套的载体**：① 返回上层靠 3 个**一深**的变量 `optionsReturn`（`main.ts:514,2199,2292`）／`saveLoadReturn`（`:1241,1247,1255`）／`aiReturn`（`:4116,2793,2810`）—— **同一时刻只能记住一个「从哪来」**；② 同屏内的「子层」只是布尔/对象字段（`optionsSub` `main.ts:566`、`amountPage` `:663`、`stockDetail` `:1006`、`stockPick`/`stockAmount` `panel-cancel.ts:146-165`），**彼此不能叠加**；③ 整屏之间也不能嵌套——`activeUiScreen()` 只返回第一个为真者，第二个 active 的屏**既不画也不 tick**（`main.ts:4803-4806`）；④ 替代「深度回退」的是 `panel-cancel.ts:186-209` 的**优先级梯子** `cancelLayerOf()`，它**按类型判断**（`if (s.pick) … if (s.screen==='stock') …`），不是按深度 | 接口不符 | 轻微 |
| `0x401` 重绘消息 | 消息泵自己投递，51 个函数处理（`ui.md:394-396`） | 无消息层；每屏 `tick`/`draw` 由 `requestAnimationFrame` 驱动（`ui-screen.ts:147-201` 是可选钩子 `move/down/up/contextmenu/key/tick/event/toolbar/hotkey`） | 接口不符 | 轻微 |
| 「打开＝阻塞到玩家操作完成」 | 每屏自己跑消息循环、**阻塞**返回（`ui.md:261-264`）；界面由 `Post_0402_Message` 逐层返回 | **非阻塞**：由 core 的 `state.pending: PendingInteraction \| null`（`packages/core/src/state/types.ts:656`，**单个字段、不是栈**）驱动，客户端只在 `currentDialog()`（`main.ts:2056-2064`）里把它翻译成一扇画布对话框；一次交互＝派一个 action | 接口不符 | 轻微 |
| 局部重绘 | `InvalidateRect` ×204 / 124 个函数（`render-api.md` §二链路 3）；明确规定「不要改成整屏重绘」 | 每帧 `stageCtx.fillRect(0,0,640,480)` 后整幅重画（`main.ts:4837-4839`），最后 `blitStage()` 整块贴（`:5300-5306`）；`ui-screen.ts:21-23` 把「第一屏 `draw()`、其余不画」写死为契约；`windowed: true` 的屏才先画一整帧棋盘再叠（`main.ts:4843-4846`） | 接口不符（**已知偏离**，见 `Q-TOOL-1.md:200`、`Q-TOOL-5.md:268`、`Q-TOOL-6.md:259`、`T-042-044.md:190-191`，**记录准确**） | 轻微 |
| 未注册处理器的回落 | 落到 `DefWindowProcA`（`ui.md:130,218`） | 无对应概念（登记表为空时画棋盘） | 接口不符 | 轻微 |
| 移植层额外差异 | 640×480 客户区、整数像素 | 舞台**缩放**到窗口，所有命中判定必须先 `toStage()` 量化（`known-deviations.md:3413-3427` 记了这一层带来的独有偏差）；文字用系统字体替代原点阵字（`asset-sheet.ts:83` 等） | 接口不符 | 轻微 |

> **这笔架构账的直接后果**：原版「深层覆盖浅层、退出自动回退」的语义**没有对应的可嵌套载体**
> —— 这正是 6 个缺失项里两个（终局流程、貸款到期提醒）无法自然挂上来的结构性原因之一。

---

## 三、渲染 / 动效差距

| # | 条目 | 原版规格（证据） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| **R1** | **视角旋转不进存档** | `0x499088` 是地图视角档位（0..7），**被写进存档**：`rich4-spec/docs/systems/save-format.md:107,127` 的 `+0x2743`（4 字节）；`animation.md:78,279` 明确「它被存进存档」「相位要存进存档，否则读档后视角归零」 | `camera.view` 在 `packages/client/src/render.ts:200-213`，是客户端模块变量；`GameState`（`packages/core/src/state/types.ts:321` 起）无 `view` 字段；自家存档只序列化 `GameState`（`saveload.ts:172-173` → `packages/core/src/loaders/savegame.ts:74-77`）；读档反而沿用当前会话视角（`main.ts:1304`、`:7382` 的 `camera?.view ?? 0`）；`packages/core/src/loaders/save.ts` 的 `OFFSET` 从 `fortuneDeck:0x271e` 直接跳到 `mapDataSize:0x2747`（`:269-271`），**跳过 `0x2743`** | 缺失 | **严重** | ① `GameState` 加 `viewRotation`（原版是全局状态，不是表现提示）；② `save.ts` 补 `OFFSET.viewRotation = 0x2743` 并解出/写回；③ **订正 `docs/known-deviations.md:5169` 的「❓ 未定」**（它与同仓 `:1070-1071` 及规格都冲突） |
| R2 | 视角热键 `<` / `>` | 热键表第 18/19 项 `0x49718c`/`0x49718e` = 地圖向左／向右旋轉，默认 `VK_OEM_COMMA`/`VK_OEM_PERIOD`（`ui.md:59-60`；`animation.md` §一 的 `dec`/`inc` 后 `& 7` @ `0x401394`/`0x4013d4`） | `packages/client/src/hotkeys.ts:44-101`（`rotateLeft:18`/`rotateRight:19`，vk `0xbc`/`0xbe`）；`vkOf` 把 `Comma`→`0xbc`、`Period`→`0xbe`（`:123-124`）；`main.ts:1715-1719` → `rotateView(±1)`（`:5512-5517`，`(view+delta+8)%8`） | 1:1 | — | — |
| R3 | 另一个视角写入点（小地图箭头） | `0x00418717`/`0x00418722`（条件 `[0x48be28]==1` 时 `dec` 后 `& 7`，`animation.md:22`） | `main.ts:7011-7015`（`@source VA 0x00418707`）「**抬起**才真的转」，按下只记账（`:6726`） | 1:1 | — | — |
| R4 | `0x499088` **不是**动画时钟 | `animation.md` §一（穷举 5 个写入点，**没有一处是定时器回调**） | 全仓无「全局相位时钟」；`packages/client/src/tick.ts` 无相位概念 | 1:1 | — | — |
| R5 | 物件帧公式 | `frame = (8 − [0x499088] + objects_info[idx].+1) & 7` @ `0x40e670-0x40e6b5`（`animation.md:93-129`） | `screenDirection = (dir + 8 − view%8) & 7`（`packages/client/src/assets.ts:893-895`）；物件用 `objectImageIndex`（`packages/client/src/throw-fx.ts:199-201`）@source `0x0040e6a1`/`0x00408ee2` | 1:1 | — | — |
| R6 | 建筑/地块的**另一套**公式 `8 − (facing + view)` | `al = land+0x1b; al += [0x499088]; dl = 8 − al; dl &= 7` @ `0x4091af`（规格 `animation.md` **未列**这一条；remake 自行取证） | `packages/client/src/assets.ts:1154-1158`（`buildingImageIndex`）；四类图均吃视角（`render.ts:1158` 注释、`:1128,1218,1233,1245`） | 1:1 | — | ✅ 两套公式**未混用** |
| R7 | 帧记录 `表 + 0xc + 帧号×12`，表头 12 字节 | `animation.md:113-115,277` | `parseSpriteSheet`：`t = 12 + i*12`（`packages/assets-pipeline/src/mkf.ts:176`） | 1:1 | — | — |
| R8 | `objects_info` **46 项 × 24 字节** | `animation.md:144`（基址 `0x496d08`） | `OBJECT_COUNT = 0x2e`、`OBJECT_ENTRY_SIZE = 24`（`packages/core/src/rules/objects.ts:12-14`） | 1:1 | — | — |
| R9 | **不给每个物件独立动画计时器** | `animation.md:134-135,195,276`（「不要给每个物件独立计时器」） | `packages/core/src/cards/summon.ts:45-56` 的 `MapObject` 无任何计时字段；`render.ts:921-953` 每帧按 view + 朝向现算图像 | 1:1 | — | — |
| R10 | 每帧重建渲染清单 + 排序 | `animation.md` §二之二（`0x408f10-0x408f72` 遍历 46 物件入列；`0x48a44c`/`0x48bac8`；步长 12） | `render.ts:1735-1752` 每帧重建 `DrawSlot[]` 并 `slots.sort`；`drawKey`（`:476-479`）`((screenY & 0xfff) << 4) \| klass`；`DRAW_CLASS`（`:436-460`）building `0x0` / npc `0x8` / player `0xc` / current `0xd` | 1:1 | — | — |
| R11 | 坐标是 **5 位定点（÷32）** | `0x48b2ac`/`0x48b2b0` 以 5 位小数存储，`sar 5` 还原像素（`animation.md:217,224-225`） | `tileX = x >> 5`、`sub = cx & 0x1f`（`render.ts:395,417-420`）；地砖投影 `((m[0]*subX) >> 5)`（`:1868-1873`） | 1:1 | — | — |
| R12 | 向零截断 | `0x457dbc`（`fnstcw` + RC=11 + `frndint`，`animation.md:218`） | `Math.trunc`（`packages/client/src/tween.ts:79-81`，注释 @source `0x0040c31f`） | 1:1 | — | — |
| R13 | 走子速度表 / 特殊态 | `WALK_SPEED = [8,12,16,8]` @ `0x4749d8`；`dist × 0.125` @ `0x4631dc` | `packages/client/src/tween.ts:39`（`WALK_SPEED_PX_PER_TICK`）、`:45`（`SPECIAL_SPEED_RECIP = 0.125`）；补间线性等分（`:92-104`） | 1:1 | — | ✅ 无自造缓动/弧线 |
| **R14** | **渲染帧节拍 = 按需单发 rAF，非原版 20 ms 多媒体定时器** | `SetTimer` 只有 50/100/250/500/1000 ms；`animation.md:246-247` 明确「把定时器周期改成每帧 16.7 ms 会改变动画速度与输入采样率，属于**行为偏离**而非实现细节」 | `requestAnimationFrame` 按需单发（`main.ts:4791-4794`）；tick 时长按 `RENDER_MS=20 × [6,4,2,0]` 折算（`packages/client/src/tick.ts:26,32,40-43`），推进靠 `setTimeout(humanDelay())`（`main.ts:1345,1443-1447`）；250/500 ms 两档用 `setInterval` 复现（`main.ts:2372,5360`） | 时序错 | 轻微 | 逐动画的 rAF 已被记为「等价实现」（`Q-TOOL-1.md:197`、`Q-TOOL-5.md:265`），但**全局帧率由显示器决定**这一条**没有登记** → 按新发现计。若要 1:1，改 20 ms 固定累加器 |
| **R15** | **文字没有唯一入口** | 全部文字经 `0x44fabc` 一个函数（`DrawTextA` ×6、`SetTextColor` ×3）；颜色来自全局（如 `0x4762e4`）；列为 **P0「所有文字的唯一入口」**（`render-api.md:86-91,178`） | **74 处** `ctx.fillText` 分散各屏（`board-screen.ts:1335`、`saveload.ts:290`、`inventory.ts:301`…），颜色各屏硬编码；7 路对齐跳表另行复刻（`hud.ts:86-118`、`board-screen.ts:1311` 的 `origText`）；`#NNNN` 由**四处各自** strip（`lottery-screen.ts:587`、`magic-screen.ts:1182`、`lottery-draw-screen.ts:681`、`packages/data/src/event-table.ts:283`） | 接口不符 | 严重 | 抽公共 `drawText(ctx, text, x, y, flag, size, fill, stroke)`，内含**统一的 `#NNNN` 解析→播放→剥离**与对齐表 —— 这一处同时修掉 §四 V1 |
| R16 | 鼠标是事件驱动，不是 `GetCursorPos` 轮询 | `ui.md:14`（`GetCursorPos` 轮询）、`:362-363`（光标位置是**全局缓存** `0x475284`/`0x475288`，不是每次 `hit_test` 现查）、`:567-568`（「复刻若改成 `mousemove` 事件，采样时机与原版不同，快速拖动时的手感会变」） | `main.ts:5313-5318`（`e.clientX/clientY` + `getBoundingClientRect()`）、`:5986`（`canvas mousemove`）、`:7024`（`window mousemove`）、`:6811`（`window mouseup`）；**无全局光标缓存** | 时序错 | 轻微 | 引入全局 cursor 缓存（`mousemove` 写入、需要处读），或每帧 rAF 首统一采样一次，避免同帧内多处读到不同坐标 |
| R17 | hit-test 只用 `IntersectRect`，宽高来自元素记录 `+0xc`/`+0xe` | `ui.md:296-336,355-363`（唯一 `hit_test` `0x4174cd`，**没有手写边界比较**；区域宽高由 `0x48bdd8`/`0x48bddc` 构造） | `packages/client/src/gameui.ts:181-183` 的 `inRect` 是手写**左闭右开**比较，全 client 34 处使用；各屏各写命中函数，**无「UI 元素记录」这一层** | 接口不符 | 轻微 | 1×1 光标点下与 `IntersectRect` 等价；**宽/高 > 1 时边界差 `w−1`/`h−1` px**。规格自己说「用等价的矩形包含判断即可」，故风险低；抽公共 `hitTest(rect)` 即可 |
| R18 | 键盘失焦完全失效 | `ui.md` §一：`0x40101f cmp [0x46cb01],0 / je 0x401537`，窗口未激活时**整个钩子直接返回**；「现代框架的默认行为通常是失焦后仍收到部分事件，需要显式加上这道闸门」 | 无显式闸门；`main.ts:7097` 是唯一的 `keydown` 入口 | 无法判定 | 轻微 | 浏览器只在文档获得焦点时派发 `keydown`，**平台天然满足**；多标签/iframe 场景需实机确认 |
| R19 | 数字输入窗的键表 | `Q-UI-9.md` §1.1 的 15 个 VK（含 `H` = `trunc(上限×17/33)`、`M` = 填上限、9 位上限） | `packages/client/src/amount-keys.ts`；`amount-keys.test.ts` 里有一颗「解释器」直接跑 exe 的 `cmp/jb/jbe/je/jmp` 树逐 VK 对账 | 1:1 | — | — |
| **R20** | **当前玩家脚下黄色光晕 + 同格 5 px 错开** | 原版没有这两样（登记自述「原版没有」，`C-FID-1/4` 禁改良） | `render.ts:2213`（`off = seen * Math.max(4, k*5)`）、`:2274`（`ctx.ellipse(..., 'rgba(255,236,120,0.55)')`） | 多余实现（**已知偏离**，`known-deviations.md:4595-4596`，**记录准确**） | 轻微 | 删除或改 debug-only |
| **R21** | **精灵未解码时退回自造色块兜底** | 原版 `read_mkf` 同步读入、绘制槽指针常驻非空，**不存在「没图可画」的中间态**（`walk-flicker.test.ts:37-49` 自述） | `render.ts:133`（`PLAYER_COLORS`）、`:2286-2298`（画圆 + 描边兜底） | 多余实现 | 轻微 | `T-047.md:331,346` 声称已由 `#spriteHeld` 消除「退回色块」，**但兜底分支仍在** → 记录与现状略有出入 |
| **R22** | **`animate_object`（`0x40e669`）的语义** | `animation.md` §二 称它「计算物件精灵帧、用于棋盘物件」，被调 26 处 | remake 在 `packages/client/src/tween.ts:9-11` 明确反驳：那 26 个调用点**全在 `0x442xxx`~`0x446xxx`**，是**道具飞行动画**。**独立复核：**`rich4-spec/gen/rel32-calls.json` 的 `0x0040e669` 键列出 26 个调用点，最小 `0x004422d6`、最大 `0x00446e10` —— **remake 的读法正确，规格 §二 的用途描述与自身调用点数据矛盾** | 无法判定（规格侧问题） | 轻微 | 规格 `animation.md` §二 应订正「用途」；帧公式本身已由 R5/R6 两条式子覆盖 |

---

## 四、台词与语音差距

### 4.0 ★ 先回答必答项：`#NNNN` **有没有**被当成颜色码？

**行为上没有，文档上有一处。**

- ✅ 全仓库**没有**任何把 `#NNNN` 当 hex 颜色解析的代码路径。
- ✅ `#NNNN` 的**解析语义**也没写错：remake 没有对低编号加偏移、也没有拒绝低编号。
  角色台词表那条 `1050 + 27×角色 + 事件`（`packages/data/src/speech.ts:323-335` 的 `speechIndex`）
  是**表下标换算**，不是 `#NNNN` 的解析规则 —— 与更新后的规格
  （`rich4-spec/docs/systems/dialogue-voice.md:34-38`）一致。
- ✅ 多处注释写法正确：`packages/data/src/messages.ts:149`「**插播语音的编号**」、
  `packages/client/src/lottery-screen.ts:585`「语音由 `playEffect` 管」。
- ❌ **一处注释是错的**：`packages/client/src/bank-dynamic.ts:548`「串首的 `#00xx` 是
  `draw_text` 的**颜色控制码**」。该处**行为仍正确**（`raw` 保留前缀、`text` 去掉，
  `bank-dynamic.ts:552-571`），所以是**文档缺陷**而非阻断级行为错误。
- ⚠️ `packages/data/src/event-table.ts:280` 称它「原版的**格式码**」—— 措辞含糊，
  同一函数 `stripEventCode()`（`:283`）行为正确。
- 真正的颜色来自全局（规格 `VA 0x0044fcd5` 的 `mov esi,[0x4762e4]` → `SetTextColor`）；
  remake 各屏把颜色写成常量（如 `bank-dynamic.ts` 的 `LOAN_BUBBLE.color = '#101010'`），
  **与之无冲突**。

### 4.1 差距表

| # | 条目 | 原版规格（证据） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| **V1** | **`#NNNN` 低编号语音全部不播** | `drawText_colorcode`（`0x44fabc`）见到 `#` 就 `0x44fb05-0x44fb4b` 解析 4 位十进制 → `0x44fb4e call 0x45441a`（`play_speech`）→ `0x45443c` 用 `[0x48a054]`(`speaking.mkf`) `read_mkf`，**无任何偏移**；`0x44fb56 add ebx,5` 跳过前缀（`dialogue-voice.md:49-78`）。实测文本里 `#NNNN` 覆盖 **4..1373 共 842 个不同编号，其中 610 个 < 1050**（同文 `:88-95`） | 全 client **只有一处**播 `Speaking.mkf`：`packages/client/src/main.ts:5093`；取值只可能来自 `packages/client/src/speech-bubble.ts:170` 的 `speechIndex(character,event)`（= 1050..1373）。低编号只被**剥前缀**：`stripEventCode`（`packages/data/src/event-table.ts:283`）、`stripVoice`（`lottery-screen.ts:587`）、`bubbleLines`（`lottery-draw-screen.ts:681`）、`magicGreetText`（`magic-screen.ts:1182`）、`LOAN_MSG.*.text`（`bank-dynamic.ts:552-571`） | 缺失 | **阻断** | 把「解析 `#NNNN` → `play_speech(NNNN)`」做成**统一的文本绘制前置步骤**（等价于原版 `0x44fabc` 的 `0x44fb00` 那一段），而不是每个屏各自 `slice(5)`（见 R15）。remake 侧**已经**带 `#NNNN` 的字面量有 **165 个编号、其中 115 个 < 1050**，分布在 `event-table.ts`(73)、`bank-dynamic.ts`(17)、`monthly-screen.ts`(8)、`lottery-screen.ts`(7)、`magic-screen.ts`(5) 等 |
| **V2** | **金貝貝（角色 11）的 27 条配音被显式置 `null`** | `#NNNN@DD` 形态里 `#NNNN` **照样播**：`rich4-spec/gen/db.txt:88409` `0044f0e8 cmp esi,5`（有 `#` 前缀时 `esi=5`）→ `:88411-88436` 解析 4 位 → `:88437` `0044f136 call 0x45441a` = `play_speech`。即 `#1347@04` = **播 1347 号语音 + 画 04 号表情图**，两件事并行 | `packages/client/src/speech-bubble.ts:170`：`voice: isEmoji ? null : speechIndex(character, ev.event)` —— 表情串一律 `null` | 算法错 | **阻断** | 去掉 `isEmoji ? null :` 这一支；表情与语音**并行**，不是二选一。影响 1347..1373 共 27 段 |
| V3 | 金貝貝表情图算式与落点 | `图号 = 3×十位 + 个位 − 1`；基址 `[0x48bad4] + 0xc`；落点 `(0xf0,0x82)`；资源 `Data.mkf #0x207`（`dialogue-voice.md` §一；`packages/data/src/speech.ts:246-289`） | `speechEmojiImage(code) = 3*tens + ones − 1`（`packages/data/src/speech.ts:285-289`）；`SPEECH_EMOJI_RESOURCE = 0x207`（`:271`）；`SPEECH_EMOJI_AT = {x:0xf0,y:0x82}`（`:277`）；`speech-bubble.ts:311` 用 `colorKeyBlack=true` 取图 | 1:1 | — | — |
| V4 | 三个闸门（消失／梦游／睡眠不说话） | `player_say`（`0x44ef41`）开头 `cmp [player+0x496b9b],0 / jne 0x44f228`（+0x33 消失）、`+0x37` 梦游、`+0x36` 睡眠（`dialogue-voice.md:198-209`） | `packages/client/src/speech.ts` 的探测器**不做**这三个闸门；`detectDreamCard`（`:287`）在 `sleepWalking` 由 0 变非 0 时说事件 21，`detectTurnStartBlocked`（`:310-323`）在 `sleeping` 非 0 时说事件 21 | 无法判定 | 严重 | 原版这三句（19/20/21）本来就在「新判」时说一次，此时 `days_sleep_walking` 刚被置位；`player_say` 的闸门读的是 `+0x33/+0x37/+0x36`，**置位那一刻闸门是否已生效需回 exe 逐条比对时序**（U6）。**不要盲目加闸门** |
| V5 | 中间档 `rand() & 1` 被确定性化 | `fcn_0044f230` 的 `51..100` 档 `call rand15 / and eax,1`；`fcn_0044f2c2` 的 `4..6` 档同理（`dialogue-voice.md:93-95,132-134`）。⚠️ 规格明说「复刻若把它实现成固定事件 0 或 1，**随机序列会错位**」（同文 `:132-134`） | `packages/client/src/speech.ts:41-47` 文件头「有意偏离」1：一律取 `eax=0`；四处函数都注释「★ 原版此档 `rand&1` → 取 0」：`gainEventFor`（`:193-199`）、`payTierFor`（`:212-218`）、`smallGainTierFor`（`:225-230`）、`smallLossTierFor`（`:237-242`） | 算法错（已知偏离） | 轻微 | **已知偏离**（`docs/deviations/T-052.md`）；但「**随机序列会错位**」这一条**没有**在 `known-deviations.md` 的 Q-SPEECH 清单里单独登记 → 建议补记 |
| V6 | 事件 18 的 1/2 概率被确定性化 | `fcn_0044f4ed`：`if (find_most_hostile_player(payer) != payee) return 0; if (金额 < 5000×物價指數) return 0; if (!(rand() & 1)) return 0;`（`packages/client/src/speech.ts:440-448` 引同一段） | `speech.ts:472-478`：最敵對 + 金額 ≥ `5000×物價指數` 就**一定**说事件 18 | 算法错（已知偏离） | 轻微 | 已知偏离（文件头「有意偏离」1，「此处确定性取「说」」） |
| V7 | 事件 6..26 的选取路径 | `dialogue-voice.md:150-154`：6..26 不走阶梯，由其它调用点直接指定；**规格自陈「本轮未穷尽」** | `packages/client/src/speech.ts:547-559` 的 `DETECTORS` 接了 11 个探测器，覆盖事件 0..3/6/8/9..15/18/19..21/24/25；事件 **16/17/22/23/26 未接**（文件头「有意偏离」3，`:48`） | 缺失 | 严重 | 事件 16（大量地产）、17（称霸）、22（被背着）、23（恶梦结束）、26（重振旗鼓）无触发点。别名 `site` 已在 `packages/data/src/speech.ts` 的 `SPEECH_EVENTS[].sites` 给出（16: `0x0044f6d5`、17: `0x0044f6ab`、22: `0x0040ef2f/0x0040eff8/0x0040f097`、23: `0x0040e64a`、26: `0x00407946`），可直接接 |
| V8 | 台词文本**先画后播**、阻塞 1000 ms、气泡 + 头像 | `player_say` 七步（W-50 订正）：①三道闸 ②`view_to` ③**备份** `RECT(0,40,440,220)` @ `0x0044effa` ④**气泡图** `Data.mkf #0x205` 图 6 贴 (220,130) @ `0x0044f019` ⑤**说话人头像** `map.mkf #(角色+0x1b)` 图 `arg2+1` 贴 (170,130) @ `0x0044f03b` ⑥`draw_text(串,0xc8,0x82,5)` @ `0x0044f140` / `@DD` 表情图 @ `0x0044f0b5` ⑦Blt → `fcn_004544f6(0x3e8)` | `speech-bubble.ts` 的 `drawSpeechBubble` 按 **④→⑤→⑥** 画（`SPEECH_PANEL` / `SPEECH_PORTRAIT_AT` / `SPEECH_TEXT_AT = (0xc8,0x82)`、5 行、16px），头像图号 = `expression+1`；③+⑦那对「备份棋盘 → 说完贴回」**不做**（无可读回表面）；`SPEECH_HOLD_MS = 0x3e8`，并用 `SoundPlayer.durationOf` 撑长（`main.ts:5095`） | 轻微（只差棋盘不闪回） | 已知偏离 Q-SPEECH-9（2026-09-19 W-50 结案 + 大订正：原「名牌 400×89 不贴」是错读，那张图是 `Q-HOVER-1` 的浮标）；`SPEECH_BOX` 已订正为 440×**220** @(0,40) |
| V9 | 台词队列 | 原版 `player_say` 逐句**播完再返回** | `packages/client/src/speech-bubble.ts:189-264` 的 `SpeechQueue` 逐段演；`main.ts:5085-5098` 的 `speechTick` 换段才播语音 | 有差异（已知偏离） | 轻微 | 已知偏离 Q-SPEECH-6（已修） |
| V10 | `speaking.mkf` 资源数 = 1374 | `dialogue-voice.md:444`：解出 **1374**（编号 0..1373）；`extracted/Speaking/meta.json` 的 `nchunks = 1374` | `packages/data/src/speech.ts:102` `SPEAKING_CHUNK_COUNT = 1374`；`packages/assets-pipeline/src/audio.ts:6` | 1:1 | — | — |
| V11 | 语音 WAV 逐文件采样率 | 22050 Hz ×1184 + 44100 Hz ×190，必须按每个文件的 `fmt ` 块播（`dialogue-voice.md:358-372`） | `packages/client/src/audio.ts:119-120` 用 `decodeAudioData`，**不写死采样率**；全仓 `22050/44100` 只出现在测试夹具（`fake-webaudio.ts:120`、`sf2-fixture.ts:148`） | 1:1 | — | — |
| V12 | `play_speech` 的两个闸门：无声卡 / `cfg+3` 语音开关 | `0x45441c cmp [0x47e748],0 / je 0x454490`、`0x454425 cmp [0x49715b],0 / je 0x454490`（`dialogue-voice.md:222-230`） | `packages/client/src/audio.ts:86`（`#ctx === null` 时静默）、`:50-52` `setMuted`；CFG 音量档驱动 `sound.setMuted`（`main.ts:2836`） | 有差异 | 轻微 | 原版两个闸门是**静音但不阻断流程**，remake 行为等价；但 `ui.md:81` 说 `cfg+3` = 音效音量（`00..04`），`dialogue-voice.md:340` 说 `cfg+3` = **语音开关** —— **规格内部两处对同一偏移说法不同**（见 U7） |

---

## 五、音效差距

### 5.1 结构与目录

| # | 条目 | 原版规格（证据） | remake 现状（文件:行） | 类型 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|
| S1 | 音效集结构：8 字节 `{uint32 mkf_resource_id; uint32 dsound_buffer;}`、`0xFFFFFFFF` 终结、步长 8 | `0x454186`（`cmp ecx,-1`/`je`、`mov [ebx+4],eax`、`add ebx,8`）（`sound-effects.md` §一） | 完全没有「集」概念：`SoundPlayer` 只有 `#archives`/`#buffers`/`#voices` 三个 Map（`packages/client/src/audio.ts:25-26,39`），`play()` 直接按 `${archive}:${resource}` 取值（`:85-91`） | 缺失 | 严重 | 引入「音效集 = 编号数组」的数据结构（即使底层仍按资源号播），终结符语义可保留为数组长度 |
| S2 | 16 槽释放表 `_rich4_effect_slot_table`（`0x48cae8`） | `0x4541c1`（`inc eax / cmp eax,0x10`） | 无槽表、无上限、无释放；`stopAll()`（`audio.ts:164-166`）只停正在响的 source，**从未被调用**；`#buffers` 里的解码结果永不驱逐（`:26,122`） | 缺失 | 严重 | 给「集」加引用计数/释放钩子 |
| S3 | 19 张音效表 / 64 项 / 60 个编号（最大 63） | `sound-effects.md` §三全表（`0x46ccd0`…`0x48234a`） | 无运行期目录；编号散落成常量：`packages/assets-pipeline/src/audio.ts:104-185`（`SOUND_IDS`）、`:226`（`MOVE_SOUND=[44,45,46,53]`）、`:234`（`DICE_SOUND=10`）、`:194-198`（`PLACE_TOOL_SOUND`）；`magic-screen.ts:1113-1115`(39/0/1)、`monthly-screen.ts:367-369`(27/60/28)、`auction-screen.ts:263,265`(29/63)、`research-screen.ts:223-225`(0/1/4)、`god-slot.ts:148,150`(51/1)、`wheel-screen.ts:180,183`(52)、`minigame-screen.ts:212-239`(11..24)、`intro.ts:52`(25)、`dice-roll.ts:36`(10)、`dice-choose.ts:109-110`(1/4)、`panel-cancel.ts:212`(4)、`amount-window.ts:203`(9) | 缺失（集合分组）／数值一致（编号本身） | 严重 | 「编号 = `Effect.mkf` 资源号」这条恒等映射**已保住**（`audio.ts:105` `arc.read(resource)`）；可直接按原版 19 张表补一张静态目录 |
| S4 | 编号 6/30/42/59 未被任何表引用 | `sound-effects.md` §三末 | 静态常量里也不含 6/30/42/59；但 `main.ts:4663`（`pending.sound`）与 `:4286/4359/4554` 的号来自 core 的动态数据，可携带任意号 | 无法判定 | 轻微 | 需穷尽 core 的 `sound` 赋值 |
| S5 | `Effect.mkf` 的 0 字节占位，播放不得炸 | `sound-effects.md` §五（写 64..80 共 17 项）；**实测是 64..79 共 16 项**（见 §一.10） | 空资源 → `read()` 返回长度 0（`packages/assets-pipeline/src/mkf.ts:89-94`）→ `isWave()` false（`packages/assets-pipeline/src/audio.ts:24-36` → `packages/client/src/audio.ts:110`）→ **负缓存 + 静默 no-op**（`:104-113`） | 1:1 | — | 行为正确；规格 §五 的计数需订正 |
| S6 | 音效无 per-play 音量参数，音量全局 | `sound-effects.md` §七.4 | `play(archive, resource, loop = false)` 无音量参（`audio.ts:85`）；全局 `volume`（`:44`）在 `#emit` 取用（`:189-190`） | 1:1 | — | — |
| S7 | CFG 音乐/音效音量 `0..04` | `ui.md:80-81`（`cfg+2`/`cfg+3`） | `packages/client/src/config-file.ts:19-20,93-94,128-129`；`options.ts:326-328`（`volumeOf = clamp(0,4)/4`）；`main.ts:2836-2838` | 有差异 | 轻微 | 规格只给范围、不给 `auxSetVolume`/`midiOutSetVolume` 的映射曲线；remake 用线性 + 音乐额外 ×0.25 —— **等价性无法判定**（U8） |
| S8 | 音乐走 MCI 命令字符串、音量走 `midiOutSetVolume`/`auxSetVolume`；「需对齐 MCI 命令字符串的语义」 | `render-api.md` §四（`mciSendStringA` ×37）+ §八 P1 | remake 无 MCI：自解析 SMF（`packages/assets-pipeline/src/midi.ts:150-234`）+ WebAudio 合成/采样（`packages/client/src/music.ts:243-304`、`soundfont.ts`、`soundfont-voice.ts:79-219`）；音量是 `GainNode`（`music.ts:166-169,189-190`；`main.ts:2838`） | 接口不符 | 严重 | 已登记为偏离（`known-deviations.md:1737` Q-MUSIC-1、`:1757` Q8），但**只记了「音色」**；规格 §四要求对齐的「播放时机/循环/音量」这一层**没有单独登记** → 建议补记 |
| S9 | `entry.dsound_buffer` 运行时填充、文件中恒 0；读表必须重建 buffer | `sound-effects.md` §七.3 | 对应物 `#buffers: Map<string, AudioBuffer\|null>`（`audio.ts:26`，写入 `:107,111,122,127`）与 `#voices`（`:39`）；键是 `archive:resource`，**没有「表」可持久化** | 缺失（结构对应物） | 轻微 | 若引入静态目录，注意 buffer 不入目录数据 |
| S10 | 缺失资源静默降级 | `sound-effects.md` §七.1/§七.2 精神 | 未解锁/静音/缺档/越界/非 WAVE/解码失败全部静默（`audio.ts:86,98,101,104-113,126-129`）；`durationOf` 未解码返回 `null`（`:157-161`）；`audio.test.ts:22-26` 钉住「不炸」 | 1:1 | — | — |

### 5.2 ★ 15 对 load/release 的对齐情况

**结论：15 对全部未对齐 —— remake 完全没有「按界面预载 / 离开即释放」这一层。**
唯一的「载入」是开机整档拉 `Effect.mkf`（`packages/client/src/main.ts:7648-7655`）；
唯一的「释放」是停正在响的 source（`audio.ts:141-166`）；解码缓存永不驱逐。

| 音效集表 | 原版 载入/释放 | 语境 | 集内编号 | remake 对应屏（文件:行） | 编号是否对位 | 预载/释放 |
|---|---|---|---|---|---|---|
| `0x48231a` | `0x40176e`/`0x40189d` | 启动 | 0,1,2,4,3 | `main.ts:1122,2245-2258,2405-2434,6090…` | ✅ 4 个号都在 | ❌ / ❌ |
| `0x46ccd0` | `0x406df3`/`0x4074ce` | 待定 | 5 | `SOUND_IDS.BANKRUPT=5` 用在 `main.ts:3281`；`SOUND_IDS.AUCTION=5`（`assets-pipeline/audio.ts:112`）**定义未用** | 部分 | ❌ / ❌ |
| `0x48234a` | `0x4080de`/`0x40822e` | 棋盘（24 项） | 7,9,10,… | `board-screen.ts` 全文 **0 处播放**；移动/骰子在 `main.ts:1841,1861` | 部分 | ❌ / ❌ |
| `0x475057` | `0x415245`/`0x4153bc` | 企鵝挖寶 | 11..18 | `minigame-screen.ts:212-227` | 部分（11/12 明确） | ❌ / ❌ |
| `0x4750bf` | `0x41562c`/`0x4157ed` | 喜從天降 | 22,23,24,15 | `minigame-screen.ts:235-239` | 部分（**23 未用**） | ❌ / ❌ |
| `0x4750f8` | `0x41595b`/`0x415cb2` | `0x415872` | 25,26 | 25 = `intro.ts:52`（`INTRO_SOUND`）；**26 未见** | 部分 | ❌ / ❌ |
| `0x475590` | `0x42b74a`/`0x42ba65` | 股市行情屏 | 40,41 | `stock-screen.ts` 全文 **0 处播放** | ❌ **未播** | ❌ / ❌ |
| `0x4755a8` | `0x42baa6`/`0x42be65` | 公司分红屏 | **61（1 项）** | `shares-screen.ts:262` 定义 `SHARES_SOUND={open:0,page:1,choice:2}` 且**全仓无使用** | ❌ **未播**，且把 1 项表当 3 项下标 | ❌ / ❌ |
| `0x47566b` | `0x4315ec`/`0x431691` | 樂透/開獎 `0x4315cc` | 31 | `lottery-screen.ts:943` 只播 4 | ❌ **未播** | ❌ / ❌ |
| `0x47567b` | `0x431737`/`0x431805` | 樂透/開獎 `0x431712` | 57,58 | `lottery-draw-screen.ts` 全文 **0 处播放** | ❌ **未播** | ❌ / ❌ |
| `0x4757e7` | `0x43382d`/`0x4338c3` | 魔法屋转盘 | 39 | `magic-screen.ts:1476`（`MAGIC_SOUND_RESULT=0x27`） | ✅ | ❌ / ❌ |
| `0x475b17` | `0x439c09`/`0x439efa` | 银行月结 | 27,28,60 | `monthly-screen.ts:1787-1789`（`STEP=27`/`DETAIL=60`/`CLOSE=28`） | ✅ 三条全对 | ❌ / ❌ |
| `0x475bba` | `0x43c6b8`/`0x43c70e` | `0x43c08d` | 29,63 | `auction-screen.ts:917,1040,1123,1127`（`DEAL=0x1d`=29、`BID=0x3f`=63） | ✅ | ❌ / ❌ |
| `0x475d3c` | `0x4408a3`/`0x4408d7` | `0x440830` | 51 | `god-slot.ts:554,574`（`GOD_SLOT_SPIN_SOUND=51`） | ✅ | ❌ / ❌ |
| `0x475d4c` | `0x440a66`/`0x440a85` | `0x44090e` | 52 | `wheel-screen.ts:780,803`（`WHEEL_SPIN_SOUND=52`，循环） | ✅ | ❌ / ❌ |

**另有 4 张「无静态载入点」的表**（`sound-effects.md` §三之二）：
remake 对 `0x47509f`（19,20,21）有播放（`minigame-screen.ts:229-233`）；
对 `0x46cce0`（8）只有**未使用**的常量 `SOUND_IDS.LOTTERY_DRAW=8`（`assets-pipeline/audio.ts:110`）；
`0x4754ba`/`0x4762ec`（0）与启动表的 0 同号，无法区分。

### 5.3 播放调用点数量与热点语境

| 项 | 原版 | remake | 差距 |
|---|---|---|---|
| `play_sound_effect` 调用点 | **151 处**（约 90 个函数，`sound-effects.md` §四） | 约 **74 处**（`main.ts` 51 + 10 个屏模块 23，另 1 处 `Speaking.mkf`） | 约少一半 |
| 规格 §四 10 个热点语境 | 见下表 | 见下表 | ≥4 个语境无任何触发 |

| 热点函数 | 规格语境 | remake 对位（文件:行） |
|---|---|---|
| `0x00417e26` (8) | 總資產面板 | **未对齐**：remake 的「個人資產表屏」块（`main.ts:6615` 起）**一处播放都没有**；`board-screen.ts` 全文 0 处。且该 VA 在 remake 文档里被当「棋盘窗口过程」（`node-tip.ts:7`）与「設施名/等級名显示」（`DEVELOPMENT_PLAN.md:731`）→ 语境本身有分歧（U11） |
| `0x00410668` (7) | 待定（設定屏 UI 动画） | **部分对齐**：`main.ts:2245`（音乐关 → 音效 3，注释引 `fcn_00410668` 的 `loc_004106b0`，见 `main.ts:2216`）+ `:2256-2258`、`:2405-2414`、`:2427-2434` |
| `0x0043ff56` (3) | 待定 | **无映射** → 无法判定（U2） |
| `0x004402d7` (3) | 研究所开发菜单 | **对齐（3↔3）**：`research-screen.ts:547,557,586` |
| `0x0040b93b` (3) | 梦游启动 | **无对应播放**：remake 把同一 VA 当「棋子素材载入函数」（`assets.ts:813`）；`Q-SOUND-1.md:127` 又把它列为逐格推进内的调用 —— 三处口径不一致 → 无法判定（U11） |
| `0x004125a3` (3) | 待定 | **疑似对齐**：`minigame-screen.ts:1452` 附近引该 VA，播出口在 `:252-253` |
| `0x00413248` (3) | 待定 | **无映射** → 无法判定（U2） |
| `0x00446baa` (3) | 路障放置 | **对齐**：`main.ts:4345`（`PLACE_TOOL_SOUND`）+ `:4359`/`:4286` 播 33/34/10（`assets-pipeline/audio.ts:182-198`） |
| `0x00446656` (3) | 机器娃娃 | **对齐**：`main.ts:3303` 播 `SOUND_IDS.DOLL`（38，`audio.ts:157`） |
| `0x00453745` (5) | 通用 YES/NO 框 | **缺失**：`main.ts:2552-2557`、`:2637-2647` 的抬手答复与 `:6143-6152` 的移动高亮**都不放音**；原版答「是」放 2、答「否」放 4（`known-deviations.md:2623`） |

### 5.4 其它音效缺口（不在 10 个热点里，但可确证）

| # | 原版 | remake | 类型 | 严重度 |
|---|---|---|---|---|
| S11 | 公司分红屏音效集 `0x4755a8` = **61**（1 项） | `shares-screen.ts:262` 定义 `SHARES_SOUND={open:0,page:1,choice:2}`（定义未用）；**61 未播** | 数值错 | 严重 |
| S12 | 通用填数窗按键音 = 表 `0x48234a` 第 0 项 = **7**（VA `0x00452f0e`，remake 自记于 `amount-keys.ts:15`） | `main.ts:2185-2196`（`onAmountKey`）与 `:2117-2138` 全程**无播放** | 缺失 | 轻微 |
| S13 | 股市屏 **40/41**、樂透 **31**、開獎 **57/58** | `stock-screen.ts`、`lottery-draw-screen.ts` 全文 0 处；`lottery-screen.ts:943` 只播 4 | 缺失 | 严重 |
| S14 | remake 播 **90/91**（`0x5a`/`0x5b`），**超出规格 §三「最大 63」** | `build-fx.ts:161,167`（`BUILD_HAMMER_SOUND=0x5b`、`BUILD_MAX_SOUND=0x5a`）→ `main.ts:4554` 播放 | 无法判定 | 轻微 |

### 5.5 已知偏离记录本身的核实

| 记录 | 是否准确 |
|---|---|
| `docs/deviations/Q-SOUND-1.md` §2.2/§2.3（号 10/32/38/44/45/46/53/47；`0x40d9f2` = Play、`0x40d8dc` = Stop） | ✅ 与 `audio.ts:157,226`、`move-sound.ts:38` 一致，**准确** |
| `Q-SOUND-1.md` §4「本引擎 `SoundPlayer.play()` 每次都新建 `BufferSource`、**没有任何 Stop 路径**」 | ❌ **已过期**：`audio.ts:91` 现已 `#stopKey(key)` 先停同路（该文档自己的「处置（本轮已落）」也记了这次修复），且新增了 `stop()`/`stopAll()` |
| `Q-SOUND-1.md` §6.4 引用的 `main.ts:1848`/`1869` | ⚠️ 行号已漂到 `main.ts:1861`/`1878` |
| `Q-SOUND-1.md` §6.3「听感没有实机比对」 | ✅ 如实自陈 |
| **总体** | 按「已知偏离，见 `docs/deviations/Q-SOUND-1.md`」处理；上列两处细节建议顺手订正，**不算新发现** |

---

## 六、remake 多出或未见于原版的实现

| # | 条目 | 证据（文件:行） | 类型 | 严重度 | 说明 |
|---|---|---|---|---|---|
| E1 | **HTML 调试侧栏 + 待决交互按钮**（原版全在画布内） | `packages/client/index.html` 的 `<aside id="panel">`；`main.ts:5546-5760`（`renderPanel`/`renderInteraction`/`renderActions`）；启动即 `document.body.classList.add('no-debug')`（`main.ts:7638`） | 多余实现 | 轻微 | 默认隐藏（`Ctrl+Shift+D` 开关，`main.ts:7196`）；但它是**第二条 UI 通路**（HTML `<button>` 也能答复 `pending`），与「原版所有界面画在同一块表面上」不同 |
| E2 | **联网 / 大厅** | `packages/client/src/net-client.ts`、`lobby.ts`、`packages/core/src/net/*`、`packages/server/` | 多余实现 | — | 用户已明确延后（不在本轮范围）；已登记 `known-deviations.md:12,61-63,1346`。`lobby.ts:257-259,339-340,388-389` 的 hover 属联机新增 |
| E3 | **SoundFont 2 播放路径 + 振荡器合成后端** | `soundfont.ts`（全文件）、`soundfont-voice.ts:79-219`、`music.ts:42-48,73-129`（打击乐通道整条跳过 `music.ts:91`） | 多余实现 | 轻微 | 原版无「音色库」概念；已记 `known-deviations.md:1757`（Q8）、`:1737`（Q-MUSIC-1） |
| E4 | **「選音色庫」UI + 桌面壳文件 IO** | `host.ts:289-351` | 多余实现 | 轻微 | 已记 `known-deviations.md:1813` |
| E5 | **用户手势解锁门控** | `audio.ts:64-72`、`music.ts:172-184` | 多余实现 | 轻微 | 浏览器限制，原版无 |
| E6 | **`durationOf()` + 字幕队列撑时长** | `audio.ts:157-161`；`main.ts:5095` | 多余实现 | 轻微 | 替代原版 `fcn_004544f6` 的阻塞等待 |
| E7 | **全局静音开关 `muted`** | `audio.ts:41,50-52` | 多余实现 | 轻微 | 原版靠音量 0 |
| E8 | **失败/空资源的负缓存** | `audio.ts:107,111,127` | 多余实现 | 轻微 | 原版是释放 buffer |
| E9 | **`stopAll()` 总收** | `audio.ts:164-166` | 多余实现 | 轻微 | 已定义**未调用**；原版按 16 槽逐个释放 |
| E10 | **`loop` 参数落到 `AudioBufferSourceNode.loop`** | `audio.ts:186-188`；`ui-screen.ts:83-86`；`wheel-screen.ts:803`、`god-slot.ts:574`、`minigame-screen.ts:581,614,1167` | 多余实现（推断） | 轻微 | 规格 `sound-effects.md` §六.4 明说原版第 2 参**语义未定**；remake 当 `DSBPLAY_LOOPING` 用，属有旁证的推断 |
| E11 | **SF2 专属机制**：`MAX_POLYPHONY=32` 抢占、`exclusiveClass` 互斥组、包络近似 | `soundfont-voice.ts:38,112-115,120-124,247-273` | 多余实现 | 轻微 | 原版不具备 |
| E12 | **`MIDI_PLAYLIST` 25 首整表** | `packages/assets-pipeline/src/audio.ts:360-386` | 多余实现 | 轻微 | 来源是游戏目录 `Midi.txt`，不在五份权威规格内 → 是否原版行为**无法判定**；并列的 `BGM_FILES`/`SCREEN_BGM`（`:278-330`）确为原版 `fcn_004549cf` 的 13 项表复刻 |
| E13 | **`SHARES_SOUND` 三项下标常量** | `shares-screen.ts:262` | 多余实现 | 轻微 | 对一张**只有 1 项**的表（`0x4755a8` = 61）定义 3 个下标，语义无出处（U10） |
| E14 | **自己的存档格式**（`RICH4-REMAKE` JSON + localStorage） | `packages/core/src/loaders/savegame.ts:44-60` | 多余实现 | 轻微 | 原版是 `SAVE%d.DAT` 二进制；已记 Q-SAVE-1 |
| E15 | **当前玩家脚下黄色光晕 + 同格 5 px 错开** | `render.ts:2213,2274` | 多余实现 | 轻微 | 已记 `known-deviations.md:4595-4596`，**记录准确**（见 R20） |
| E16 | **精灵未解码时自造色块兜底** | `render.ts:133,2286-2298` | 多余实现 | 轻微 | `T-047.md:331,346` 声称已由 `#spriteHeld` 消除，**实际兜底分支仍在**（R21） |
| E17 | **冬眠去色用 canvas `filter` 近似** | `render.ts:186`（`saturate(0) brightness(1.24)`） | 多余实现 | 轻微 | 已登记 D-T047-4 |
| E18 | **调试层：节点菱形描边 / 边线** | `render.ts:1785,1817`（`#drawNodes`）、`:1710`（`#drawEdges`，仅 `debugNodes` 为真时） | 多余实现 | 轻微 | 仅调试可见 |
| E19 | **`#spriteHeld`（退回本槽上一张图）** | `walk-flicker.test.ts:37-49` 自述 | 多余实现 | 轻微 | 浏览器异步解码的补丁；原版是常驻指针，无此中间态 |
| E20 | **画布整数倍放大 + `blitStage()` 整块贴** | `main.ts:5300-5306` | 多余实现 | 轻微 | 现代画布的等价物 |
| E21 | **`parseSave` 的布局注释引用了 `rich4-re/csrc/loadsave.c`** | `packages/core/src/loaders/save.ts:3-5` | 接口不符 | 轻微 | ⚠️ `rich4-re/` 是本任务明令**不得引用**的目录（已知 8+ 处错误）。该注释是历史遗留，建议改为引 `rich4-spec` 的 `save-format.md`。**实际偏移已与规格交叉验证过**（`save.ts` 多处注明实测锚点），不影响正确性 |
| E22 | **名牌浮标命中用「最近锚点 + 24 px 半径」近似** | `docs/deviations/Q-HOVER-1.md` §六.2 | 多余实现（已知偏离） | 轻微 | 原版是逐像素实例表 `0x474938`；remake 无该表。记录**准确**，但 ① §五 写 `node-tip.test.ts`「33 项」，实际 **41** 个 `it(`；② 该文件**没有被 `known-deviations.md` 索引**（grep 只命中 `Q-TOOL-6.md:7,265` 与文件自身），违反「所有有意偏离一律登记」 |
| E23 | **hover 高亮的状态量** | `known-deviations.md:3271`（`[0x48bde4]` 驱动工具栏 hover）；`main.ts:6157-6172`、`board-screen.ts:1925,2225-2227`、`magic-screen.ts:1440-1444` | 多余实现 | 轻微 | ⚠️ 规格 `ui.md` §六 明说「**无 hover 状态机可静态识别**」——remake 反而找到了，这是 remake **超出规格**的地方。建议规格侧补登（U20） |
| E24 | **文档/代码不一致（文档级瑕疵）** | `main.ts:5321-5327` 注释仍写「平滑逼近、系数 0.18」，实现已是瞬移（`main.ts:5348`） | 接口不符 | 轻微 | 无行为影响 |
| E25 | **`known-deviations.md` 的 Q-OPT-1「本引擎仍没有 CFG 的读写」已过期** | 实际已实现：`packages/client/src/config-file.ts:89-140`（`encodeConfig`/`decodeConfig`）、`host.ts:452-477`（`configStore`，桌面走 Tauri `read_config`）；`main.ts:593` 读、`:632` 写 | 接口不符 | 轻微 | `docs/deviations/Q-UI-8.md` 里也有同一句过期断言 |

---

## 七、无法判定项

| # | 项 | 为什么无法判定 |
|---|---|---|
| U1 | 模态处理器 `0x404e44`（宿主 `0x00406ffe`）对应什么界面 | 规格 §一之二 第 3 列对该宿主是空的，§七.3 自陈「剩余仍待定名」。remake 侧 `docs/tasks/cards.md:3696` 记 `_rich4_init_new_game_callback` VA `0x00404e44`，且宿主落在 `_rich4_init_new_game`（`assets.ts:918` 记 VA `0x00406e93`）内，与「开局设定屏」自洽；但**规格无任何交叉证据** ⇒ 界面名本身无法判定 |
| U2 | `0x0043ff56` / `0x00413248`（规格 §四热点，语境栏即「待定」） | remake 无该 VA 的映射，规格也未给判据 → 无判据 |
| U3 | `0x004125a3` 与企鵝挖寶的精确对位 | 规格 §四语境栏是「待定」；remake 侧 `minigame-screen.ts:1452` 附近引该 VA、出口在 `:252-253` → 只能给「疑似」 |
| U4 | `animate_object`（`0x40e669`）的**用途** | 规格 §二 说是棋盘物件取帧，但其自身调用点数据（`gen/rel32-calls.json`，26 处全在 `0x442xxx`~`0x446xxx`）与 remake 的「道具飞行动画」读法一致。**规格内部矛盾**，本轮不裁决 |
| U5 | `0x48b2ac`/`0x48b2b0` 的完整语义 vs `Camera.tileX/tileY + subX/subY`；且实战 `characterCamera` 不设 `subX/subY`（`render.ts:394-396`），只有拾取贴边用 `pixelCamera`（`main.ts:3610`） | 规格未穷举这两个全局的读写点 |
| U6 | 「消失／梦游／睡眠三个闸门」与 remake 探测器（说话事件 19/20/21）是否冲突 | 原版闸门读 `+0x33/+0x37/+0x36`；remake 的 `detectDreamCard` 在 `sleepWalking` 由 0 变非 0 时说事件 21。置位那一刻闸门是否已生效，**需回 exe 逐条比对时序** |
| U7 | `cfg+3` 到底是「音效音量」还是「语音开关」 | `ui.md:81` 说 `0x03` = 音效音量（`00..04`）；`dialogue-voice.md:340` 说 `0x49715b`（= `cfg+3`）= **语音开关**。**规格内部对同一偏移有两种说法** |
| U8 | 0..4 音量档 → 实际增益的映射曲线 | 规格只给范围，不给 `auxSetVolume`/`midiOutSetVolume` 的换算；remake 用线性 + 音乐 ×0.25（`main.ts:2838`） |
| U9 | `play_sound_effect` 第 2 参语义 | 规格 `sound-effects.md` §六.4 明说未定；remake 当 `DSBPLAY_LOOPING`（`audio.ts:80-83,186-188`） |
| U10 | `SHARES_SOUND` 常量的语义 | `{open:0,page:1,choice:2}` 对规格「`0x4755a8` 只有 1 项 = 61」无意义 → 常量语义无法判定（「61 未播」则是确定的缺失，见 S11） |
| U11 | 编号 6/30/42/59 与 64..115 的动态路径；`0x0040b93b`、`0x00417e26`、`0x004125a3` 的精确语境 | remake 的 `main.ts:4663`（`pending.sound`）与 `:4286/4359/4554` 的号来自 core，未穷尽；`build-fx.ts:161,167` 播 90/91 超出规格「最大 63」；同一 VA 在规格与 remake 文档里挂的语境不同 |
| U12 | 15 对表最后两行（`0x440830`/`0x44090e`）的宿主函数 | `known-deviations.md:2003` 把 `0x440830` 当字符串模板地址用，与规格「宿主函数」冲突 |
| U13 | 观感：补间/缓动/blit 顺序/残影；各屏逐控件的像素坐标与尺寸 | 规格 `animation.md` §六 与 `ui.md` §六 明确「必须靠实机截图，不得由本文件推断」；本轮未做实机比对 |
| U14 | COM 虚表 `0x64`/`0x80` 的方法名 | 规格 `render-api.md` §二 标注为**未决**（本机无 DirectX SDK 头文件）→ remake 的 blit 是否等价于原版那两个方法，无判据 |
| U15 | 小游戏（企鵝挖寶／喜從天降）玩法是否 1:1 | 五份权威规格里没有 `small-games.md`；本轮只核到「整屏存在 + 底图 + 部分音效」 |
| U16 | 74 处文字颜色是否**逐处**等于原版全局色 | 只抽核了 `event-box-screen.ts:113-116`（`#f0f0f0`/`#101010`）；其余逐屏未核 |
| U17 | 同键并列时的绘制次序 | 原版 `qsort(0x48a44c, …, _compare_int16_lt)` **不稳定**且只比低 16 位；remake 用 JS **稳定**排序（`render.ts:1751`） |
| U18 | `objects_info.+1` 的取值路径 | remake 认为原版在 `place_object` 时算一次存入 `+1`（`throw-fx.ts:217-230` @source `0x0040e0dc..0x0040e10a`），而 core 无该字段、每帧现算 `objectFacing`（`render.ts:947`）。邻接表不变时等价，无法穷举 |
| U19 | 各屏 `performance.now()` 截止时刻与原版 SetTimer 50/100/250/500/1000 的**逐屏**对应 | 未逐屏核对（例如 50 ms 档在 remake 中是否有等价物） |
| U20 | 原版是否存在 hover 状态机 | 规格 `ui.md` §六 称「无 hover 状态机可静态识别」，但 remake 在工具栏/小地图箭头/魔法屋转盘/YES-NO 上都实现了 hover（各带 VA：`0x00418b0a`/`0x00418415`/`0x00433531`/`0x00453745`）→ 无法判定是否与原版逐点一致 |
| U21 | `Effect.mkf` 到底是 116 还是 115 项 | 规格 §五说 116；实测 `extracted/Effect/` = 115 个 `.bin` + 1 个 `meta.json`，**与规格差一**。规格是权威，但它与文件系统直接矛盾 → 建议规格侧复核后订正 |
| U2′ | `0x406b14`（宿主 `0x00407842`）画的是什么 | `bank.md:624` 判为「只剩 1 人 → 游戏结束判定」；同文件 `:1103` 自记该函数精确语义**未逐行确认**；remake `docs/deviations/Q-SETUP-1.md:117` 又把它读成「要读档吗」模态（返回 1/4）。**两种读法冲突** ⇒ 只能判定 remake 侧**没有**对应模态（`known-deviations.md:4403`），不能判定原版那一屏的画面 |
| U3′ | `0x4258c1` 的界面名 | 规格 §一之二/§三之三 只给宿主（`0x00428378`/`0x00428296`）与「未直接引用 UI 字符串」，**没有名字**。remake `board-screen.ts:18` 判为「賣股票 选物窗」，此身份无法用规格复核 |
| U4′ | `0x427c21` 该叫「持股明细屏」还是「公佈欄屏」 | 同一宿主 `0x004284be`；规格 `ui.md:233` 用 `EXIT/地點：/市價：/張數：` 命名为持股明细屏，remake `board-screen.ts:1-8` + `T-033.md:5-8` 用同一宿主命名为公佈欄屏。remake 的详情框**确实同时含** `地點：/市價：/張數：`（`board-screen.ts:31-40`）⇒ 哪个名称正确无法判定（但「规格命名与自身字符串证据冲突」是确定的） |
| U5′ | `0x42d37f` 的宿主 `0x0042e931` 是不是百貨公司 | 规格 §三 把 `0x0042e931` 明确列为「**待定（本批最大）**」（`ui.md:268`）。remake `shop-screen.ts:8` 认作百貨公司（`_rich4_ui_shop_entry`）并穷举了 `Panel.mkf #10` 全部图；**规格未给该宿主定名** ⇒ 身份无法用规格复核 |
| U6′ | `0x4416f0` / `0x445c14` 的「托管支」触发路径 | 面板本身已 1:1 落码；但 `ai.md:475-478` 说该段使用者是「**被托管模式下的真人／可操作玩家**」（AI 另走 `0x441d00`），而 remake 在 core 把托管座位直接判为 AI（`packages/core/src/ai/policy.ts:102-104` `isAiTurn()` 覆盖 `isAiControlled`），客户端不再开面板 ⇒ **原版托管玩家是否仍会弹这扇窗**无法判定 |
| U7′ | `V3.11` 是否属于 `0x40257a` 这一屏 | 规格只知「宿主 `0x004029fd` 引用 `V3.11`」，未说明它画在哪一屏；remake 标题屏不画任何版本串 ⇒ 「未画」是事实，但**归属**无法判定 |
| U8′ | `0x42b2ec` 的「訊息框」算不算一个独立模态层 | 原版它是 `Wait_0402_Message` 注册的独立窗口过程；remake 在股市屏内以同屏分支实现同样行为（`stock-screen.ts:693-699`、`main.ts:6445-6455`）⇒ 行为等价已确认，但「算不算被复刻的一个独立模态层」**取决于口径**；本表按行为口径判 1:1 并在此声明 |
| U9′ | `0x452c02` 的 12 处调用点是否全部换成同一个填数窗 | `Q-UI-8.md:28-52` 与 `amount-unity.test.ts` 声称已完成；本轮**未逐处核对** exe 的 12 个调用点与 remake 12 条入口的一一对应（需 `tools/disasm.py callers 0x00453544`）⇒ 该屏「1:1」的**完整性**无法判定；但已登记的指针条差异（`Q-UI-9.md:285`）足以定「有差异」 |
| U10′ | `0x429d65` 的半年走势线／两个价签是否真在 `stock-detail.ts` 落地 | `docs/deviations/Q-STOCK-6.md:186-188` 自记「本轮没碰」（同时说上一轮已取证落地）⇒ 按 1:1 判，但**本轮未复核**该细节 |
| U11′ | 終局／貸款到期这两条**规则层**是否也缺 | `0x4060e9`/`0x406b14` 两个终局模态缺的是 UI，而 `Q-SETUP-1.md` §5.3 说它们依赖多关流程全局量；`0x436034` 则连 `loanDueDate` 在 `reduce.ts` 里都 0 引用 ⇒ **UI 缺失与规则缺失的边界**（哪些 action 本该由这两屏答复）无法从现有规格判定 |

---

## 八、建议的修复顺序

| 顺序 | 项 | 理由 | 落点 |
|---|---|---|---|
| **1** | **§三 R15 + §四 V1 · 抽统一的文本绘制入口（含 `#NNNN` → `play_speech`）** | 唯一一条**玩家可观察且大面积**的阻断级差异（610/842 个语音号不出声）；一次修好樂透/銀行/新聞/命運/魔法屋五个屏，同时消掉「74 处各自 `fillText`」这个接口差异 | 新增 `drawText()` 公共入口（含对齐表 + `#NNNN` 解析→播放→剥离），被 `event-box-screen.ts`、`lottery-screen.ts`、`lottery-draw-screen.ts`、`bank-dynamic.ts`、`magic-screen.ts`、`shop-screen.ts` 共用；四处 `stripXxx` 收敛到它 |
| **2** | **V2 · 去掉 `isEmoji ? null :`** | 一行改动，修回 27 段语音；证据是逐指令的（`db.txt:88409-88437`） | `packages/client/src/speech-bubble.ts:170` |
| **3** | **§二 缺失 · `0x43ff56` 嫁禍卡选人窗 + `0x436034` 貸款到期提醒窗** | 两条**玩家可观察的行为缺失**：① 嫁禍卡永远只能「放弃转嫁」（`cards/frame.ts:94` 硬编码 `() => -1`），而字符串 `請選擇嫁禍對象...` 已在 `messages.ts:41`；② 贷款到期**连规则层检查都没有**（`loanDueDate` 在 `reduce.ts` 0 引用）。两条都不是「画得像不像」的问题 | ① 新增选人窗 + 把 `scapegoatPicker` 接上（`cards/frame.ts`、`cards/passive.ts`、`state/preview.ts:27-28`）；② 按 `bank.md:660-672` 的 `0x43695e`/`0x436a4a` 跳表补三段提醒 + core 的到期判定 |
| **4** | **R1 · 视角旋转进 `GameState` + 进存档 + 读原版 `0x2743`；并订正 `known-deviations.md:5169`** | 规格明说「否则读档后视角归零」；且是**存档接口缺陷**（读原版存档丢字段）；登记表当前自相矛盾 | `packages/core/src/state/types.ts`、`packages/core/src/loaders/save.ts:269-271`（补 `viewRotation: 0x2743`）、`packages/client/src/main.ts:5512`、`docs/known-deviations.md:5169` |
| **5** | **S11/S13 · 补 6 个完全没有播放点的音效集编号**（股市 40/41、分红 61、樂透 31、開獎 57/58、`0x415872` 的 26） | 这些是**能听出来**的缺失（`stock-screen.ts` 与 `lottery-draw-screen.ts` 全文 0 处播放）；比「预载/释放结构」优先级更高 | `stock-screen.ts`、`shares-screen.ts:262`、`lottery-screen.ts`、`lottery-draw-screen.ts` |
| **6** | **§五 5.3 · 补齐通用 YES/NO 框的 2/4 音效；S12 补填数窗按键音 7** | 这两处**每次交互都触发**，是最容易听出来的高频缺口（热点 `0x00453745` 有 5 处） | `main.ts:2552-2557,2637-2647,6143-6152`（2/4）、`:2185-2196`（7） |
| **7** | **S1/S2/S3 + 15 对 · 补音效集目录 + 按屏载入/释放** | 规格 §七.1 自认「行为上可能听不出差别」，但内存占用与首次延迟不同；且它同时是 #5 的容器 | 新增静态目录（19 张表）+ `SoundPlayer.loadSet/releaseSet` |
| **8** | **V5/V6 · 登记「中间档确定性化」对随机序列的影响** | 规格 §一之二 明确警告「随机序列会错位」；现有登记（T-052 文件头）没提这一条 | `docs/deviations/T-052.md` + `known-deviations.md` 的 Q-SPEECH 清单 |
| **9** | **V7 · 补事件 16/17/22/23/26 的触发点** | `sites` 已在 `@rich4/data` 给出，成本低 | `packages/client/src/speech.ts` 的 `DETECTORS` |
| **10** | **§二 缺失 · 终局两屏（`0x4060e9`/`0x406b14`）+ 魔法屋問答（`0x433088`）+ AVI 播放（`0x45156f`）** | 四条都**依赖额外前置**：终局两屏依赖原版的多关流程全局量（`Q-SETUP-1.md:162-180`）；魔法屋問答需要 core 新增一个 `PendingInteraction` kind（玩家选死神目标）；AVI 需要 MCI/AVI 解码通道（残档 + `IV41`） | `setup.ts`／新增终局屏；`packages/core/src/rules/interaction.ts` + `magic-screen.ts`；`intro.ts` + 新增 AVI 通道 |
| **11** | **文档订正（不改行为）** | 成本极低、防止后人照错的引路牌 | ① `bank-dynamic.ts:548`「颜色控制码」→「语音控制码」；② `event-table.ts:280`「格式码」措辞；③ `save.ts:3-5` 的 `rich4-re` 引用 → `rich4-spec`；④ `Q-SOUND-1.md` §4「没有任何 Stop 路径」标为已修 + §6.4 行号漂移；⑤ `Q-HOVER-1.md` §五「33 项」→ 41，并把该文件**索引进** `known-deviations.md`；⑥ `known-deviations.md` 的 Q-OPT-1「没有 CFG 读写」已过期；⑦ `main.ts:5321-5327` 注释与实现不符；⑧ `T-047.md:331,346` 声称色块兜底已消除，实际仍在；⑨ `known-deviations.md:5169` 对 `0x499088` 的「❓ 未定」与同仓 `:1070-1071` 冲突 |
| **12** | **规格侧待订正（回报 `rich4-spec`）** | 本轮发现 6 处规格内部问题，均以实测/机械抽取为据，不猜测 | ① `sound-effects.md` §五 的 `Effect.mkf` 计数差一（115 项 / `64..79` 空 / 99 非空，见 §一.10）；② `ui.md` §二 把 `0x004284be` 命名为「持股明细屏」，与自身字符串证据（公佈欄详情框标签）冲突（`board-screen.ts:14-40` + `gen/string-xrefs.json`）；③ `animation.md` §二 对 `animate_object` 用途的描述与自身调用点数据矛盾（26 处全在 `0x442xxx`~`0x446xxx`）；④ `ui.md:81` 与 `dialogue-voice.md:340` 对 `cfg+3` 的说法不同；⑤ `animation.md` §四 未登记 `timeSetEvent(20,…)` 那条 20 ms 渲染节拍（`tick.ts:5-9` 有 exe 证据）；⑥ `ui.md` §六 称「无 hover 状态机可静态识别」，但 remake 四处 hover 各带 VA —— 建议补登 |

---

### 附：本轮未改动任何文件

除本报告 `rich4-remake/docs/gaps/06-presentation.md` 外，未创建、修改或删除任何文件。
