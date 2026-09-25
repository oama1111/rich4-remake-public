# 全项目遗留问题清单（2026-09-25 晚，交接给 DeepSeek）

> 作者：Claude（协调方）。**只记录问题与修复目标，本文没有改任何代码。**
> 基线：`ds/audit-provenance` @ `98f4daa`（线上 `index-Deqvkkj1.js`，`PROTOCOL_VERSION = 13`）。
> 门禁基线：`RICH4_WORKSPACE=/Volumes/Kingston/大富翁4重制版 pnpm check` ⇒ 414 files / 8685 tests / 0 skipped。

## 0. 读这份清单之前

**本清单怎么来的**（避免重复劳动）：
- 规则层已有六区出处审计（`docs/audit/provenance-*.md`，总账 `provenance-summary.md` §7 / §9）。
  那里 §9.1 列为「修掉的」、§9.2 列为「证伪的」**不再重复**；§9.3「仍未修」原样并入下文 C 节。
- 其余来源：
  - 最近 14 份需求方回报逐份对 `git log`；
  - `docs/escalations.md` 里仍是 ⏸ / 未收口的条目；
  - `docs/deviations/INDEX.md` 里状态为 `?` 且标题写着「近似 / 未解 / 未接」的条目，已**逐条到代码里核过现状**；
  - 源码里的 `还没接 / 尚未实现 / TODO / 近似` 标记，已逐个核过是否过期；
  - 我自己前几轮留下的待复测项。

**每一条都分了证据等级**：
- ✅已核 = 我在代码 / exe 里确认过现状；
- ⚠️待核 = 线索可靠，但修之前必须先回 exe 取证。

**干活规矩**（需求方长期指令，别违反）：
1. **一律按原版**。每条规则、时序都要引用**重新核过的 VA**（`python3 tools/disasm.py va|dump|callers|xref`，需 `RICH4_WORKSPACE=/Volumes/Kingston/大富翁4重制版`），不许猜。拿不准的写进 `docs/escalations.md` 问需求方。
2. **单机、联机两条路一起改**。改 core 规则要补 `packages/server/src/*-mp.test.ts` 镜像；动到 `GameState` 或随机序列要 bump `PROTOCOL_VERSION`，并在 `protocol.ts` 注释里写理由。
3. 浏览器 / e2e 测试一律**静音、无头**（URL 带 `?mute=1`，Playwright `--mute-audio`）。需求方在前台干别的事。
4. 修完跑全量门禁，再跑联机 e2e：自起 Vite `pnpm --filter @rich4/client dev --port 5374 --strictPort`，然后 `ROOT=$PWD VITE=5374 PORT=8796 SEATS=4 node tools/net-e2e-pw.mjs`。第 2/3/4 步偶发「快照时机」假失败，重跑并看 desync 日志行数为 0 才算过。
5. 只在一个工作区里改。别的会话可能也在同一个 checkout（见 §F-3），开工前先看 `git status` / `git log -3` / `git stash list`。
6. 回报的复现工具：`node --experimental-transform-types tools/replay-report.ts <回报> --trace [--until N] [--shot out.png]`。拉新回报用 `bash tools/pull-feedback.sh`。

---

## A. 需求方回报里还没处理的（优先级最高）

### A-1　iPhone Safari：「输入文字后画面显示不全」　【2026-09-25 晚复核：`a247124` 早已修过，只差真机确认】
- **回报**：`feedback/20260925-030128992-manual-Charles.json`
  - 联机，第 36 回合；
  - UA `iPhone OS 18_7 … Safari`，canvas 2496×1128 @dpr3，横屏。
- **现状 ❌本条有误 → ✅已核（2026-09-25 晚复核）**：原文写「没有任何提交处理过它」——**不对**。
  `a247124`（2026-09-24 23:15 -0400 = 这份回报提交后 **14 分钟**）就是修它的，标题一字不差：
  「fix(web): iPhone Safari 打完字画面显示不全」。它已在 `ds/audit-provenance` 里（是本清单基线的祖先），
  也已在线上 bundle `index-Deqvkkj1.js` 里（`packages/client/dist-web/index.html` 有那条 `!important`、
  bundle 里有 `maximum-scale`）。当时只按**回报文件名** grep 提交信息，而提交信息里没写文件名，于是漏了。
  回报截图是 canvas 自己的内容（正常），**看不到页面视口**，所以截图里看不出问题。
- **最可能的触发点**：「一键回报」那个备注输入框。需求方写这条回报时本身就在里面打了字。
  其次是联机大厅的昵称框。
- **待核的两个原因**（两个都成立，都已被 `a247124` 按下列办法关掉）：
  1. iOS 对 `font-size < 16px` 的 `<input>` / `<textarea>` 聚焦时会自动放大页面，收起键盘后不复原；
  2. 收键盘后 `visualViewport` 变了，而舞台布局（`stage.ts` / `currentMetrics()`）没有重算，`window.scrollY` 也没归零 ⇒ 舞台被切掉一截。
- **已做的修复**（`a247124`，与上面三条修复目标逐条对上）：
  1. `text-entry.ts:33` 的 `TEXT_ENTRY_FONT_PX = 16`：门厅昵称（`foyer.ts:269`）、联机存档取名（`net-save.ts:44`）、
     回报备注框（`index.html:97-102`）都改 16px，`index.html:23-24` 再加一条 `!important` 兜底规则盖住后来的框；
  2. `viewport.ts:221` 的 `installTextEntryRecovery`：文字框 `focusout` / `orientationchange` 后
     0/120/350/700ms 各收拾一次（卷回原点、打字引起的放大用 meta 复位招夹回 1、重钉 body + 排一帧），
     `main.ts:802` 装上；`currentMetrics()`（`main.ts:9838`）本来就每次从 `canvas.width/height` 现算，
     `resizeCanvas()` 每帧开头都调（`main.ts:8811`）⇒ 舞台一定会跟着重算；
  3. iOS UA 下 meta viewport 常驻 `maximum-scale=1`（`main.ts:801` + `viewport.ts:158`）——
     这条是**只挡聚焦自动放大**的那一层，也是真机上唯一还没实测过的一条（见下面「待真机确认」）。
- **验收**：
  - Playwright WebKit + `devices['iPhone 13 landscape']`：打开回报框、输入、提交或关闭，然后对比 `canvas.getBoundingClientRect()` 与 `window.visualViewport`，比例与位置恢复原样、无页面滚动；
  - 昵称输入框同样测一遍；
  - 再请需求方真机复测。
- **验收结果（2026-09-25 晚补做，新工具 `tools/ios-text-pw.mjs`）**：上面三条**全过**（28 条断言 0 失败，见该文件头部的用法）。
  四个场景：回报框「取消」/「送出」、门厅昵称框、可视区真的伸缩一次；每个场景都断
  画布矩形 / body 矩形 / `visualViewport` 三者与进框前**逐字段相同**，且 `scrollX/Y = 0`。
  反向验过这个工具不是空跑的：把 `index.html` 的兜底规则改成 13px，两条字号断言立刻 failed。
  ⚠️ **桌面 WebKit 为什么验不到 iOS 那一半**：iOS 的「聚焦 `font-size < 16px` 文字框自动放大」是
  **iOS Safari 自己的**行为，Playwright 那份桌面 WebKit 里没有 —— 没有软键盘，`visualViewport`
  永远等于布局视口、`scale` 永远是 1，聚焦文字框不产生任何位移。所以这个工具断得了
  「引擎里那条路走完没留下位移」，断不了「iOS 压根不会放大」。后者只有真机能测。
- **⚠️ 这一节不算「全验过」—— 下面两条必须需求方真机点头才算收口**：
  1. 在备注框 / 昵称框打完字、收键盘后，画面是不是整块回来（原因 1 + 原因 2 的 iOS 那一半）；
  2. `maximum-scale=1` 会不会把**双指缩放**一起挡掉。`viewport.ts:131` 的注释按「iOS 10 起只挡聚焦放大、
     双指照旧」写，但这句**没有实测过**；棋盘本身已经 `touch-action: none`（`index.html:31`，手势全归
     `touch-input.ts`），所以就算真挡掉，玩家侧大概也看不出差别 —— 但要顺手问一句，别把注释当成事实。

### A-2　「强制征收土地一处好像没生效」（命運事件 1）
- **回报**：`feedback/20260925-032752009-manual-Charles.json`
  - 单机，第 16 回合，awaitingRoll；
  - 日志末段是 `事件提示框：命運 #1（P3）`，即 `FORTUNE_CONFISCATE_LAND = 1`（`events/fortune-effects.ts:185`，`@source 0x0044bfb1`）。
- **现状 ⚠️待核**：`replay-report` 重放到第 13 回合就断了，指纹 `d3e2b94d ≠ 689b9d31`，报「有状态改写绕过了记录漏斗」⇒ 无法直接复现。
- **要查的三件事**：
  1. **规则**：对照 `0x0044bfb1` 逐字节核「挑哪一块」：只挑未开发的？受害者没有合格的地时原版怎么办（照弹框？什么都不说？）；神明闸 `fcn_0044b896` 挡掉时的那句「逃過此劫」有没有出。
  2. **表现**：
     - 镜头有没有移到被征收的那块地（`fortune-effects.ts:270` 那个「本次被拆 / 被征收的那一块地」字段），归属色块、侧栏地產页是否当场更新；
     - 倒霉台词的先后要按 `presentation-order.ts` 的表：框 → 镜头 → 台词？以 exe 为准；
     - 需求方的感受是「没生效」，很可能是**看不出变了哪一块**。
  3. **记录漏斗**：查重放为什么会分叉。这份回报早于本日若干协议变更，若只是旧协议造成的，写明即可；若确有状态改写不经 `dispatch`，那是真 bug，要修。
- **验收**：
  - 单测覆盖三种受害者：有多块未开发地 / 只有已开发地 / 没有地；
  - 浏览器里用 `__rich4.debug.patch` 造一个受害者，触发事件 1，截图能看出是哪块地被征收；
  - 两种模式都测一遍。

---

## B. 表现 / 时序：有证据、未收口

### B-1　影片窗口期间棋盘该画 before 还是 after（E-3 剩的两处）
- **出处**：`docs/escalations.md` E-3（首席以「无可见现象」为由关闭，没有证据说现状对）。
- **① 送醫院 / 監獄**（`client/src/confine-fx.ts`）：
  - 救护车影片只盖住棋盘中间 440×74；
  - 影片期间棋子已经在醫院 / 監獄格上画出来了；
  - 原版此时后台面有没有重画？要读 `fcn_0045144f` 的重绘时机，以及 `send_to_hospital 0x0043ec3f` / `send_to_prison 0x0043d593` 里 `0x41d476`（镜头）、写坐标、播片三者的先后。
- **② 請神符（卡 23）**：`startCardFlight` 与 `startGodFx` 同一拍起，神明影片会盖住还在飞的卡。要读 `0x00444d70` 那一支的播片先后。
- **修复目标**：取证后照原版。若原版播片前不重绘，就把 `nodeId / xpos / ypos / blocking` 一起按住（`deferred-board.ts`，只按 `blocking` 会更错，E-3 已写明）。

### B-2　樂透投注屏「猫女郎语音」（E-6）
- **出处**：E-6 ⏸。exe 的樂透窗口过程里找不到 `play_speech`，只有两处音效：`0x430030 push 0x47566b`（表值 31）与 `0x430044 push 0x482332`（取消音）。
- **修复目标 ⚠️待核**：
  - dump `0x47566b` 的结构，确认音效 31 落在哪个 mkf / 哪个资源。若它本身就是一段人声，就补上播放时机（开屏那一下）；
  - 否则在 E-6 里写明「原版无此语音」并结案。

### B-3　魔法屋转盘命中用的是角度近似，原版是逐像素掩膜（D-MAGIC-6）
- **出处**：`docs/deviations/T-037.md` D-MAGIC-6，代码 `client/src/magic-screen.ts:538`（`sectorAt` 楔形近似）。
- **修复目标 ⚠️待核**：
  - 企鵝挖寶已经找到过 `Panel.mkf #81` 这种 640×480 一字节命中表（`minigame-bg.ts` / `parsePenguinHitMask`）。照同一办法，从魔法屋窗口过程（`0x4338b7` 附近）的命中代码反查掩膜资源号，换成逐像素命中，楔形只留作素材缺席时的兜底；
  - 同文件的 D-MAGIC-1 / 2 / 4 / 7 / 8 / 10 / 11 一起复核：
    - D-MAGIC-8「转盘演出是我们加的」若属实，要按原版删掉或改；
    - D-MAGIC-11 绘制顺序要按原版。

### B-4　轉盤（T-039）四处近似
- D-WHEEL-4「这一趟转几格是我们定的」、D-WHEEL-6「真人点一下直接进减速段」、D-WHEEL-7「开场第一帧」、D-WHEEL-10 行距 +6。
- **修复目标**：回 exe 的转盘状态机取证，逐条按原版改。尤其 **D-WHEEL-4 / 6 属于「动画节奏是我们编的」**，正是需求方反复强调要照原版的那一类。

### B-5　樂透开奖屏 / 月結屏的未解项
- T-036：D-036-2（眨眼按帧号推，近似）、D-036-3（脸的推进周期没解出）、D-036-6（铭牌压暗用半透明黑，近似）。
- T-041：D-MONTHLY-9（结算屏四行文字，原版写进图 11..14，没有 blit）。
- **修复目标**：按各自 deviations 文档里留下的 VA 线索继续取证，能解的按原版改；解不出的保持现状，登记写清楚。

### B-6　過路費连街闪光 / 新闻闪光按精灵整张调亮，原版按 id 图逐像素加亮
- **出处**：Q-TOLL-FX-1、D-T047-4，代码 `toll-flash-fx.ts:72`、`news-flash-fx.ts:36`、`sprite-brightness.ts`。
- **现象**：没盖建筑的空地（只露地砖）不会闪；原版逐像素，空地也会亮。
- **修复目标**：
  - 离屏生成与棋盘同投影的「实例 id 图」（picking 已有实例概念，见 `picking.ts` 文件头 Q-TOOL-4 / `0x40a9d7`），按 id 做加法亮度；
  - 注意 WebKit 不认 `ctx.filter`（有测试守着），只能用合成模式或像素运算；
  - 性能要看 iPhone（见 D-2）。

### B-7　其它登记在案的纯画面近似（优先级低，按需处理）
- 地砖用仿射近似透视：`render.ts:2754`。
- 去色 `(R+G+B+40)>>2` 的色彩空间差：`render.ts:250`、`render.ts:3371`，D-T047-4。
- 对话框正文行距 16+6：D-DIALOG-1，`dialog.ts:86`。
- 事件框行距与逐事件 sprintf：`event-box-screen.ts:374`、`event-box-screen.ts:428`。
- 公佈欄地產选物窗的两处近似：D-BOARD-3、`board-screen.ts:502`。
- 有等级的地块缩略图缺两个全局：D-T034-3。
- 百科从設定屏推开时四周纯黑：D-045-5。
- 右键关窗依赖浏览器 `contextmenu` 时机：D-086-3。
- 銀行两套气泡共用落点：`bank-dynamic.ts:676`。
- 棋盘点击用「最近节点 + 阈值」，不是实例命中：`render.ts:472`。拾取模式已经用实例锚点，普通点击还没有。
- 配乐音色：Q-MUSIC-1，SoundFont 由用户自备。
- 開局跳伞过场画面：Q-INTRO-1，AVI 是残档，复刻不了，保持。

---

## C. 规则层：审计台账里仍未修的（原样转录 + 现状）

以下来自 `docs/audit/provenance-summary.md` §7 与 §9.3，已排除 §9.1 修掉的。

| 编号 | 问题 | 修复目标 / 卡在哪 |
|---|---|---|
| Q-TOOL-1 + ai FU-1 | 飛彈 / 核彈 / 外星人新聞的爆炸范围、电脑出牌的「视野」都用**节点坐标方窗**（半径 100）近似。原版是 `0x40a45c` 在**屏幕空间 440×440 id 图**里取方窗，而 `damage_area 0x0040ac7b` 会**先把镜头移到目标**再取 | 镜头中心就是目标，所以范围只取决于**目标 + 视角**，在规则层可以确定性地算出来：用投影表（已逐项核过的 8×29×29 表）把候选实例投到以目标为中心的 440×440 窗里判。⚠️ 前提是 `state.viewRotation` 不在指纹里（每个客户端各自的镜头）：原版取窗用的是**当时的视角**，联机要先定一个共享口径（比如取窗时一律用视角 0 或行动者的视角），这一点要问需求方。改动面：`reduce.ts:5128` / `7597`、`tool-effects.ts:330`、`news-effects.ts:853/955/995`、`ai/card-policy.ts:562`。C23-1 的請神符已经按镜头筛过视野（§9.1），可以参考它的做法 |
| econ AUC-48 | 魔法屋多位中签者：原版逐人循环挂起，本引擎一次排好 | 只在第 2 场开拍时的心理价位上有可见差别。需要让 reducer 支持「挂起逐人循环」 |
| econ 嵌套清算 | 嵌套清算的拍卖按 FIFO 追加，原版嵌在外层第 1 场收官处 | 只改先后、不改钱数。按 `0x0040d1f7` ↔ `0x0040d1e3` 的嵌套口径改 `pendingQueue` 插入位置 |
| cards O-37 残余 | 同格两件物件、先收走一件：`release_object 0x0040e243` / `attach_object 0x0040ebc7` 整字节清零 | 要逐位复刻得在 state 里存每格反向索引（§9.1 已改为按位或取，残余只在「收走一件」这一步） |
| ai FU-5 | 电脑出牌的「预演顺延」 | 20 局实测不可观测（806 次肯出、0 次被挡）。**不建议现在修** |
| ai FU-3 | `0x421714 mov eax,edx` 的残值静态定不出 | 只能在原版里跟一次。**不修** |
| ai FU-4 | `whoPlays == 3` 照抄会软锁 | 只有读档可达。**不修**，保持登记 |
| ai-move（§7） | 托管真人开着保釋窗时仍走自拟分支（`bail` 要加 null 槽） | ⚠️待核：§9.1 没列它，先核是否已修；没修就按 `ai/policy.ts` 保釋那一支补 null 槽 |
| ai-econ（§7） | 首次建造被衰神挡下时，原版已经写了 `+0x18` 种类 | ⚠️待核同上：挡下后種類要留在 `facilityType` 里 |
| D-007 | 电脑回合的随机数消费点与原版不完全对齐 | §9.1 的 FU-2 已大面积改成吃全局序列。复核 D-007 正文里还剩哪几处，剩的逐条对 VA 改或结案 |

---

## D. 平台 / 体验遗留（前几轮留下的待复测项）

| # | 问题 | 现状 | 修复目标 / 验收 |
|---|---|---|---|
| D-1 | iPhone 进卡片商店时 BGM 有杂音 | 本机没复现过，等需求方真机复测（关掉音效再听一次，用来区分是 MIDI 还是音效叠加） | 若复现：检查进店时 `midi07.mid` 切换与 `Effect.mkf` 同时起播的 AudioContext 负载；看 `soundfont-voice.ts` 的包络瞬态（`setTargetAtTime` 近似，Q8） |
| D-2 | iPhone 玩久了发烫 | 已做过降负载（显示列表跳过重画等，`display-list.ts`），只在模拟器里量过 | `tools/perf-mobile-pw.mjs` 各场景（idle / ai / shop）量 CPU 与帧数；空闲时的 rAF / 定时器应降到接近 0。请需求方真机复测 |
| D-3 | 切出页面再回来，声音不恢复 | 待真机复测 | `visibilitychange` 时 resume AudioContext 并重排 BGM |
| D-4 | 全电脑开局：跳伞过场可能不结束 | 以前的遗留，从没修过。`perf-mobile-pw.mjs` 的 `ai` 场景能等到 `screen === 'game'`，说明**可能已经不复现** | `?screen=game&humans=0&ai=4&mute=1` 无头跑 10 个种子，确认都能进棋盘并推进回合；不复现就结案 |
| D-5 | 联机拍卖节奏与单机不同 | 已知、暂时保留 | 对照单机的出价间隔（`auction-screen.ts`），联机下电脑出价也走同一节拍（服务器补位的电脑） |
| D-6 | 改键屏没做 | `client/src/hotkeys.ts:20`：原版熱鍵設定屏 `Data.mkf` 资源 3 图 1 只解出了底图 | 取证窗口过程后复刻；原版若有「恢复默认」也要做 |
| D-7 | 桌面端打包缺 HD 资源 | `host.ts:67`：`tauri.conf.json` 的 `resources` 没带 `assets/hd` | 只影响桌面包，网页版不受影响 |
| D-8 | 网页版请求 `/assets/hd-manifest.json` 返回 404（E-26 📌） | ⚠️待核是否还在 | 看线上 network，还在就去掉这条请求或补上文件 |

---

## E. 代码卫生（小、快，适合顺手做）

1. `packages/client/src/interactions.ts:131` 的注释写着「研究所面板先用按钮，画面属 P2」——**已过期**，`research-screen.ts` 早就做了。改注释。
2. `packages/core/src/cards/average-cash.ts:102-109` 的 `JUNPIN_CARD_TODO`「均贫卡待实现」——**已过期**，均貧卡在 `cards/registry.ts:490` 已实现，全仓库没人引用这个常量。删掉常量并改注释。
3. `packages/client/src/picking.ts:152-158` 写着「工程車（12）的目标还没跟，暂按機器工人处理」—— 工程車不在 `TOOL_SELECT_PARAM` 里，也不进拾取（`0x00447a49` 一支已在 `tool-effects.ts:105-129` 实现）。核实后删掉这段过期说明。
4. `packages/client/src/main.ts` 里两条兜底日志：
   - `6548`：道具「目标选择原版走的是另一套（还没接）」；
   - `6836`：卡片「那类选择界面还没做」。
   两条都要核一遍：现在还有没有道具 / 卡片能走到这里？没有就改成开发期断言（`console.error` + 测试守着）。有的话，它就是真缺口，按原版补界面。
5. `packages/data/src/stocks.ts:26-43` 有五个 `TODO: semantics unknown`（stock_info `+6 / +7 / +10 / +28 / +32`）。只做记录；有空时按 `xref` 查读写点定名。
6. `packages/core/src/cards/monster.ts:110 / 218`：「地图数组重算 `0x40a4e1` 复刻未实现」。先确认 `0x40a4e1` 重算的数组本引擎有没有对应的派生数据（比如节点占用 / 反向索引）。有的话要在同一时点刷新，没有就在注释里写明不需要。
7. `packages/core/src/rules/god-power.ts:84-86` 说 `Q-GOD-1` 气泡窗「未接」。后来已经做了老虎机 / 神明对话框，这条多半过期。核实后更新注释与 known-deviations。

---

## F. 仓库 / 分支状态

1. **`ds/audit-provenance` 还没开 PR**（本日所有 `ds/*` 修复都合进了它，已推到 origin）。需求方确认后开一个 PR 对准上一轮的分支。
2. **`ds/ai-visible-cell-order`（`9bf8cbb`）没合并**：「可見節點表照原版屏幕行序收 —— §7.139(6) 第 2 條『並列次序』收口」。worktree 在另一个会话的 scratchpad 里。要么复核后合进来（跑全门禁 + e2e），要么在台账里写明放弃。
3. **`ds/hd-stage`（`wt-hd`）属于另一个会话正在跑的画质升级任务（W-80），不要碰**，也不要在那个 worktree 里改代码。
4. `wt28/*` 下 17 个 worktree 的分支**都已合进** `ds/audit-provenance`，也都是干净的，可以清理：`git worktree remove`，然后 `git branch -d`。
5. 同一个 checkout 里曾有两个会话同时改代码：另一方合并时把对方未提交的修改 stash 走了。以后分工时，**每个会话用自己的 worktree**，主目录只做合并。

---

## 建议的处理顺序

1. **A-1、A-2**：需求方点名的回报，先做。
2. **E 节全部**：小而快，顺手清掉误导后来人的过期注释。
3. **B-1、B-4**：动画时序是我们编的，需求方最在意这一类。
4. **B-3、B-2、B-5、B-6**。
5. **C 节**：动 Q-TOOL-1 之前先就视角口径问需求方。
6. **D 节**：多数要真机，打包成一次「请需求方复测」的清单。
