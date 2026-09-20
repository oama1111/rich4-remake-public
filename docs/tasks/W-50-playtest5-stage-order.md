# W-50 系列 —— 第五份试玩回报：演出次序 / 台词底板 / 台词时机 / 镜头调度

> 制定：首席（Claude），2026-09-19。执行：DeepSeek。规则照 [`../WORKPLAN.md`](../WORKPLAN.md) §2（硬规则）与 PR 模板。
> 基线分支：**`fix/playtest-5-camera-gods`**（从它再切 `ds/w-5x-<slug>`）。门禁基线：`pnpm check` = **265 files / 5829 tests，0 skipped**。
> 本文里所有 `@source` 都是首席**已经回 exe 读过**的结论 —— 执行方**照做**，不要重新解读汇编；
> 发现与本文矛盾的证据 ⇒ 停手，写 `escalations.md`。

## 0. 首席已经做完的（不要重做）

| 提交 | 内容 |
|---|---|
| `e4f767d` | **镜头逐像素跟随**。根因：原版镜头中心是像素坐标（`[0x48b2ac]/[0x48b2b0]`，`fcn_0040829d`），本引擎按 `x >> 5` 整格吸附。`projectWorld` 改成 exe 原式；地面层亚格偏移此前从不生效（`setTransform` 顶掉了 `translate`，且符号反）|
| `516647e` | **神明落脚顯靈**（天使/惡魔/土地公 `fcn_0040f381`，落点尾块 `0x0041b077`）+ **福神加倍**（`fcn_0040f8be`）+ **死神不折點券**（G42）。「踩天使買房不加蓋」的根因 = 整支缺失（gaps/04 的 G45–G49）|
| `fix(client): 狗咬片被救护车片顶掉…` | **狗咬片被救护车片顶掉**：`startConfineFx` 直接覆写 `pendingBoardFilm`。改为 `enqueueBoardFilm` 排队。另附 `tools/speech-callsites.py` 与两张机械抽取表 |

两张底稿（**机械抽取，不要手改**；重新生成：`python3 tools/speech-callsites.py [VA]`）：

- [`speech-callsites.md`](speech-callsites.md) —— `player_say`（`0x0044ef41`）104 个调用点 × 前后相邻的演出调用 × 实参。
- [`view-to-callsites.md`](view-to-callsites.md) —— 镜头 `view_to`（`0x0041d476`）104 个调用点，同样的列。

⚠️ 两张表是**线性窗口**（前后各 45 条指令、不跨函数、**不解读跳转**）。它回答「这一句台词与哪段演出相邻、谁先谁后」，
回答不了「哪个分支才走到」。后者本文 §2 的表里已经由首席逐条裁定；表里没有的 ⇒ C 级上报。

---

## 1. W-50（B）台词的**底板与头像** —— 「人物说台词时的背景对话框也没有」

### 1.1 原版到底画了什么（首席已读，`fcn_0044ef41` 全文 235 条）

`client/src/speech-bubble.ts` 文件头那张「原版怎么显示」的表**有三处读错**，先订正它（注释），再改实现：

| 步 | 原版（**以此为准**） | @source |
|---|---|---|
| ① | 三道闸：`+0x33` 消失 / `+0x37` 夢遊 / `+0x36` 睡眠 任一非 0 ⇒ 整句不说 | `0x0044ef79` / `0x0044ef86` / `0x0044ef93` |
| ② | `view_to`：镜头先对到**说话的人** | `0x0044efbd call 0x41d476` |
| ③ | 备份棋盘区 `RECT(0,40)-(440,260)`（宽 `0x1b8`、高 `0xdc`）—— **只是为了说完还原，不是底板** | `0x0044effa..0x0044f00f call 0x451a97` |
| ④ | **气泡底图**：`Data.mkf #0x205` 的**图 6**（`[0x48bad8] + 0x54`，`(0x54−0xc)/0xc = 6`），带透明贴到 **(220, 130)** | `0x0044f019 push 0x82 / push 0xdc` … `0x0044f033 call 0x456418` |
| ⑤ | **说话人的表情头像**：`map.mkf #(0x1b + 角色号)` 的**图 `arg2 + 1`**，带透明贴到 **(170, 130)** | `0x0044f03b push 0x82 / push 0xaa`、`0x0044f045 imul eax,[esp+0x2c],0x34 / mov ecx,[eax+0x498eb0]`、`0x0044f050 mov edx,[esp+0x30] / inc edx`（×12 + 0xc）、`0x0044f06c call 0x456418`；资源装载 `0x00407faf..0x00407fc7`（`add eax,0x1b` → `[0x498eb0 + 槽*0x34]`）|
| ⑥ | 串以 `#NNNN` 开头 ⇒ 语音号；其后若是 `@DD` ⇒ 贴表情图 `[0x48bad4]` 的第 `DD−1` 张到 **(240, 130)**（不画字）；否则 `draw_text(串, 200, 130, 5)` | `0x0044f07c` / `0x0044f08d` / `0x0044f0b5..0x0044f0e0` / `0x0044f142..0x0044f14f call 0x44fabc` |
| ⑦ | Blt 到屏幕 → `fcn_004544f6(1000)`（等 1000 ms，可被按键/鼠标提前收）→ 用 ③ 的备份还原 | `0x0044f16c..0x0044f19e`、`0x0044f1a1 push 0x3e8`、`0x0044f1c4..0x0044f1e4` |

**两条要写进注释的订正**：

1. 「第 ④ 步把棋盘抠下来当底板」**是错的** —— 那是第 ③ 步的**备份**。原版的底板是第 ④ 步那张**气泡图**
   （与 `god-slot.ts` 用的 `Data#517 图 6` 是**同一张**，可以直接参考它怎么取图、怎么贴）。
   `fd31598` 加的「半透明深色底板 + 浅边」是据此错读做的等价替代 ⇒ **删掉**，换成 ④ + ⑤。
2. `rich4-spec/docs/systems/dialogue-voice.md` §二「第二个实参 `flag` 函数体里一次都没读」**是错的**：
   它 grep 的是 `esp + 0x28`，而读取点在两次 `push` 之后，偏移变成 `[esp+0x30]`（`0x0044f050`）。
   **`arg2` = 表情号**（头像图号 = `arg2 + 1`）。各调用点传的值见 `speech-callsites.md` 的「实参」列第 2 项（0/1/2/3 都有）。
   ⇒ 订正那一节（rich4-spec 仓库另开 PR）。

### 1.2 要做的

1. `speech.ts` 的 `SayEvent` 加字段 `expression: number`（= 调用点的 `arg2`）。每个探测器的取值**只许**从
   `speech-callsites.md` 里与该探测器 `@source` **同一个调用点 VA** 的那一行抄；对不上行的 ⇒ 上报，不许填 0 了事。
2. `speech-bubble.ts`：
   - `drawSpeechBubble` 按 ④→⑤→⑥ 的次序画；取图走现有 `BubbleSpriteFn`（`archive` 的联合类型要加 `'map.mkf'`）。
   - 贴图语义与 `shop-screen.ts` 同：`0x456418` = **抠黑 + 减掉图自带的裁切原点**（`to_left = x − src.x`）。
   - 头像资源号用现成的 `portraitResource(character)`（`assets.ts:907`，= `27 + 角色`）。
   - 删掉半透明底板那段与 `measureText` 依赖；`docs/deviations/T-052.md` / `Q-SPEECH-4` 里「名牌不贴」的登记改成已结案并写明订正原因。
3. 金貝貝（角色 11）只出 `@DD` 表情图、不出字 —— 现有逻辑保留，但**气泡与头像照画**（④⑤ 在 ⑥ 的判据之前）。

### 1.3 验收

- 单测（`speech-bubble.test.ts`）：假 `ctx` 记录 `drawImage` 调用 ⇒ 断言**次序** = 气泡(220,130) → 头像(170,130) → 字/表情图；
  断言头像图号 = `expression + 1`；`expression` 改错一位测试要变红（PR 里写明验证过）。
- 浏览器截图（`?screen=game&humans=0&ai=4&map=0&seed=7`，`__rich4.options.saved.animation = true`）：
  回合开始那句「也該輪到我了！」带气泡 + 头像，附 PR。**截图只用来验证，不用来取证**（规则 4）。
- 若气泡图 6 的尺寸导致文字溢出：**不许**自行缩放/换行 —— 原版 `draw_text(…, 5)` 的折行规则在 `text-layout` 现有实现里，对不上就上报。

---

## 2. W-51（B）台词**时机** —— 「触发台词的时机也不对」

### 2.1 根因（首席已定位）

原版 `player_say` 是**同步阻塞**的，它与影片 / 訊息框 / 神明窗的先后 = 这些 `call` 在函数里的先后。
本引擎一条 action 把后果写完、演出事后补；`queueSpeech()`（`main.ts`）只在 **UI 整屏演出**
（`BLOCKING_PRESENTATIONS`：shares / lottery-draw / monthly / magic / eventBox / notice / wheel / god-slot）占屏时才押后。
**棋盘影片（`boardFilm` / `pendingBoardFilm` / `pendingBoardFilmAfter`）、建屋影片（`buildFx` / `pendingBuildFx`）、
物件/卡片飞行、走子补间都不在判据里** ⇒ 台词与影片同时起、甚至先于影片。

### 2.2 次序裁定表（首席逐条核过分支，**照抄**）

「段」= 本引擎这一条 action 派生的全部演出（影片 + 訊息框 + 神明窗）。

| 台词来源（`speech.ts` 探测器的 `@source`） | 原版次序 | `order` |
|---|---|---|
| 送醫院 `0x0043edcb`（含狗咬、地雷、飛彈…所有走 `0x43ec3f` 的） | 影片 `0x0043ed59` → 镜头 `0x0043eda0` → **台词** | `afterStage` |
| 送監獄 `0x0043d71c` | 影片 `0x0043d6aa` → 镜头 `0x0043d6f1` → **台词** | `afterStage` |
| 壞神附身：小窮 `0x0040ef44` / 大窮 `0x0040f00d` / 小衰 `0x0040f0ac` / 大衰 `0x0040f17e` / 死神 `0x0040f314` | **台词** → 影片 → 神明台词窗 →（轉盤窗）→ 付款 | `beforeStage` |
| 小財神 `0x0040ecde`（金额 > 700 才说） | 神明台词窗 → 轉盤窗 → 收款 → **台词** | `afterStage` |
| 土地公顯靈 `0x0040f8ab` | 镜头 → 訊息框 → **台词** | `afterStage` |
| 福神顯靈 `0x0040fa1e`（到 5 级那支）/ `0x0040fa5c`（没到 5 级，`rand()&1` 二选一） | 訊息框 → 音效 → 镜头 → **台词** →（到 5 级才有）0x20b 烟花 | `afterNotice`（见下）|
| 設施收費 `0x0041a71e` | 轉盤 → 訊息框 → 收費 → **台词**（已实现，保持） | `afterStage` |
| 回合开始那三句 `0x0040ca51` / `0x0040caca` / `0x0040cb4c` | 本回合第一件事；`0x0040cb4c` 之后才是 `0x0040cb98` 訊息框 | `beforeStage` |
| 表里没列的探测器 | 查 `speech-callsites.md` 同 VA 那一行：「之前」列有影片/訊息框而「之后」列没有 ⇒ `afterStage`；反之 ⇒ `beforeStage`；两边都有或都没有 ⇒ **C 级上报**，附那一行 | — |

`afterNotice`：台词排在訊息框之后、0x20b 之前。实现上 = `afterStage` 但 0x20b 那一段要再等台词说完（见 2.3 第 4 点）。
做不到就先按 `afterStage` 做并在 PR 里注明，首席再定。

### 2.3 要做的

1. `SayEvent` 加 `order: 'beforeStage' | 'afterStage'`（缺省 **不许有** —— 每个探测器显式写，逼着逐条过表）。
2. `main.ts` 新增纯判据 `stageBusy()`（放进 `client/src/stage-gate.ts`，**纯函数 + 单测**，入参是一个布尔位的对象）：
   `blockingPresentation || boardFilm || pendingBoardFilm || pendingBoardFilmAfter || buildFx || pendingBuildFx || objectFlight || 卡片飞行（`startCardFlight` 写的那个状态变量，名字以 `main.ts` 为准）|| !walkDone || diceFx.active`。
   ⚠️ 这张清单以 `holdForActorWalk`（`main.ts:1485` 起）里**已经在等**的那些条件为准 —— 两边必须同一套；最好让 `holdForActorWalk` 也改用 `stageBusy()`，只此一处定义。
3. `queueSpeech()`：`afterStage` 的句子在 `stageBusy()` 为真时押进 `deferredSpeech`；`speechTick()` 的放行判据同步从
   `blockingPresentation()` 换成 `stageBusy()`。`beforeStage` 的句子立即入队，**并且**反过来挡住这一条 action 的影片起播：
   `tickBoardFilm` / `tickBuildFx` 起播前多等一条 `speechQueue.length === 0`（原版说完才播）。
4. 回合驱动的闸 `holdForActorWalk` 里已有 `speechQueue.length > 0 || deferredSpeech !== null`（`main.ts:1542`）—— 保留，别动。
5. ⚠️ **死锁自查**：`beforeStage` 等台词、台词又被 `stageBusy` 押着 ⇒ 互等。规则：`beforeStage` 的句子**永不**进 `deferredSpeech`。
   单测里专门立一条「坏神附身：台词 beforeStage + 影片 pending」断言 2 秒内两者都走完。

### 2.4 验收

- `stage-gate.test.ts`：每个布尔位各一条 + 死锁用例。
- `speech.test.ts`：每个探测器的 `order` 与 2.2 表逐条对（表驱动，一行一个 `it.each`）。
- 浏览器长跑：`node tools/soak-browser.js`（真人路径）60 回合，`humanStalls.length === 0`。**出现停摆 = 不合格**，不许靠加超时绕过。
- PR 里贴一段日志证明「送醫院：影片日志行在前、台词日志行在后」「小窮神：台词在前、影片在后」各一次。

---

## 3. W-52（B）狗咬那一段的**其余次序**

首席已修「狗咬片被顶掉」。还剩：

1. **镜头**：影片待播 / 在播期间棋盘按 `before` 画（`boardDrawState()`），但 `centerOnCurrentPlayer()` 读的是 `state`（after）
   ⇒ 补间走完到影片起播之间那几百毫秒，镜头已经切到醫院大樓（`cameraFollowTarget` 的 `confined` 支）。
   改：`centerOnCurrentPlayer` 取玩家时用 `boardDrawState()` 而不是 `state`。原版次序：`0x0041b8cd` 狗咬片（此时人还在原地）→
   `0x0043ec78 view_to`（对人）→ 搬到医院 → `0x0043ed59` 救护车 → `0x0043eda0 view_to`（对医院）→ 台词。
   单测：`camera-follow.test.ts` 加「影片窗口里按 before 的坐标」一条。
2. **台词**：走 W-51 的 `afterStage`（不要在这里单独处理）。
3. **狗先消失**：原版 `0x0041b847 call 0x40e14d`（狗离场）在影片**之前**；本引擎影片窗口里按 `before` 画 ⇒ 狗还在。
   影片是整幅 440×440 盖住棋盘的，观感无差 ⇒ **不改**，在 `dog-fx.ts` 头注释里记一句即可。
4. ⚠️ `dog-fx.ts` 头注释把 `0x0041b89e call 0x40cd07` 注成 `wreck_vehicle` —— 走到这一句的前提是 `traffic_method == 0`（徒步），
   语义存疑。**不要改代码**；把这条疑点追加到 `escalations.md` 的 E-15（有车那一支播 `0x228` 且不住院，仍是 C 级，等首席）。

---

## 4. W-53（A）开发用的**状态注入口**（W-50..52 的复现都要用）

现在 `__rich4` 只有 `state` 的 getter，复现「踩狗 / 天使買地 / 坏神附身」只能靠碰运气。

- `main.ts` 的 DEV 出口加 `__rich4.debug.patch(fn: (s: GameState) => GameState)`：`state = fn(state)` + `requestRender()`。
  **只在 `import.meta.env.DEV`**；**不进飞行记录仪的 action 流**，所以调用时在 `logRing` 里记一行 `[dev] state patched`，
  并把 `recorder` 标成 tainted（F9 回报里带 `devPatched: true`，`replay-report.ts` 见到它直接拒绝验指纹）。
- 配三个现成配方写进 `docs/handoff.md` §2：① 当前玩家脚下前一格摆惡犬（`objects` 里 type 11）；② 给当前玩家 `godInfo = 9`；③ `godInfo = 5` 的附身。
- 验收：三个配方各附一张截图 / 一段日志。

---

## 5. W-54（B）镜头 `view_to`（`fcn_0041d476`）—— 远处生效的卡/道具/事件，镜头不跟

### 5.1 语义（首席已读）

`view_to(x, y, flags)`（`0x0041d476`）：
- `flags & 1` ⇒ 只按上一次的中心重画（`0x40829d(-1, 0)`），不动镜头。表里实参是 `0, 0, 1` 的 38 处**全部属于这一类 ⇒ 忽略**。
- 否则：`(x, y)` == 当前行动者坐标 ⇒ 清标记 `[0x48be18] = 0`；不等 ⇒ `[0x48be18] = 1`、`[0x48be1c]/[0x48be20] = (x, y)`，
  然后 `fcn_00415e70` 居中（**有标记用标记**）。这个标记与小地图点选用的是**同一个**（本引擎的 `minimapMarker`）。
- `refresh_screen`（`0x0041d546`）一律把标记清 0 ⇒ 镜头回到行动者。

### 5.2 要做的

1. core 加瞬态提示 `GameState.lastViewTarget: { x: number; y: number } | null`（与 `lastCardPlay` 同一套规矩：不进指纹、不进存档、
   每条 action 由 `reduce` 入口清空）。**只接**下面这几类（都已有 `@source`，见 `rich4-spec/docs/systems/cards.md` 里 `0x41d476` 的 8 处命中与
   `view-to-callsites.md` 同 VA 行）：
   - 对**地块/設施**生效的卡（拆除/怪獸/天使/查封/漲價/改建/換地…）：目标地块坐标；
   - 对**玩家**生效的卡（`cards.md:2844`「把镜头移到该玩家」）：目标玩家坐标；
   - 飛彈/核彈：爆心；機器工人：被盖的那一格（`build-fx.ts` 头注释的 `0x0044733c`）。
   表里找不到对应行的 ⇒ **不接**，列进 PR 的「没做」。
2. 客户端：`applyAction` 后若 `state.lastViewTarget !== null` ⇒ `minimapMarker = 它`、`followPlayer` 不动；
   这一条 action 的演出全部收完（`stageBusy()` 由真转假，W-51 的那个判据）⇒ `minimapMarker = null`（= 原版 `refresh_screen`）。
3. 镜头一律 `pixelCamera`（首席已改），不要再出现 `>> 5`。

### 5.3 验收

- core 单测：每类一条「`lastViewTarget` = 目标坐标」+「下一条 action 清空」。
- 浏览器：AI 对远处地块用拆除卡 ⇒ 镜头切过去、演出完切回。附前后两张截图。

---

## 6. W-55（A/B）神明收尾（全面排查后的剩余项；首席核过的结论）

| 项 | 现状 | 级 | 做什么 |
|---|---|---|---|
| G45–G49 / G62 / G42 | ✅ 首席已做 | — | 把 `docs/gaps/04-events-places-gods.md` 这几行的「remake 现状 / 修复方向」改成已结案并指向 `516647e`；`known-deviations.md:1971` 那条「死神折點券」的错误记录订正 |
| `gods.md` §4.3 (a) | 规格写「条件：4000<编号<6000 且 level==0」—— 那只是**提前弹框**的条件（`0x800` 标记，防止弹两次）；`0x40b110` **无条件**调用，住宅地同样加蓋 | A | rich4-spec 仓库订正该小节（另开 PR）|
| 顯靈的**音效** | `0x0040f4f3 push 0x4823da / call 0x4542ce`（天使）、`0x0040f9dc`（福神）、`0x004199de`（自己升級）都播同一个音效表项 `0x4823da`；客户端三处都没接 | B | 音效表项 `0x4823da` 首字节 = **50**（首席已 `disasm.py dump 0x4823da 8 1` 读过；表项怎么换成 `Effect.mkf` 的资源号，照 `SOUND_IDS` 里已有的同表项做法，对不上就上报）；挂在 `lastBuildUpgrades` 起播处；`source ∈ {godManifest, ownUpgrade}` |
| 惡魔顯靈的**影片** | `0x0040f642 push 0x20e` + `0x0040f657 push 0x5f`（音效）→ `play_flic`：拆屋那一段，客户端没接 | B | 仿 `dog-fx.ts` 做 `devil-fx.ts`；判据 = `notices` 里新出现 `god.demolish`；帧数/帧时从 FLIC 头读，不许写死 |
| 顯靈前的 `view_to(玩家坐标)` | `0x0040f427` / `0x0040f5fe` / `0x0040f866` | — | 目标就是行动者自己 ⇒ 清标记；本引擎落点时标记本就为空 ⇒ **不用做** |
| 土地公 / 福神的**台词** | `0x0040f8ab`（`0x48084a` 表）/ `0x0040fa1e`（`0x480886`）/ `0x0040fa5c`（`0x48084a + (rand&1)*4`）；core 已经把那次 `rand()` 消费掉了但没把结果交出来 | B | `luckyGodBonus` 把 `rand & 1` 写进一个瞬态提示（如 `lastGodLine`）；`speech.ts` 加探测器；`order` 见 §2.2 |
| G22 / G23 魔法屋召喚死神 | 缺失（投降者才触发，`0x00411b0a call 0x4339d9`）| **C** | 不做。维持上报状态 |
| G33 / G34 財神的额外台词 | 小財神 `esi > 0x2bc`、大財神 `≥ 5000×物價` | B | 探测器 + `afterStage` |
| G40 大衰神丢卡的下标 | 原版 `consume_card(卡号)` 移除**首个匹配**，本引擎 `splice(i)` | B | 改成按卡号移除首个匹配；补「手牌有重复卡号」的用例 |
| 真人 + 0 级設施 + 天使/福神 | 首席做成了一条**免费**的 `buildFacility` 待决（`pending.free`）| B | 客户端 `facility-picker.ts` 在 `free` 时**不显示价钱**；`declineDecision` 在 `free` 时的原版行为未知（`0x440aac` 能不能取消）⇒ 现在是「不蓋」，登记到 `escalations.md` 等首席 |

---

## 7. 顺序与依赖

```
W-53（注入口） ──┬─→ W-50（底板/头像）
                 ├─→ W-51（时机） ──→ W-52（狗咬镜头） ──→ W-54（view_to，要用 stageBusy）
                 └─→ W-55（神明收尾，各项互相独立）
```

一任务一分支一 PR。W-51 是风险最高的一条（碰回合驱动的闸）：**先写 `stage-gate.ts` 的单测，再动 `main.ts`**；
三次止损规则照旧（WORKPLAN §2-8）。
