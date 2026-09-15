# 大富翁4 高清重制版 · 开发需求说明书（PRD）v1.0

> **本文是模块契约的唯一来源。** `DEVELOPMENT_PLAN.md` §11 说「做什么、做到哪了」，
> 本文说「每个模块**是什么、吃什么、吐什么、怎么算**」。两者冲突时以本文的接口定义为准，
> 以 §11 的进度为准。
>
> 读者：**没读过反汇编、没读过本仓库源码的初级程序员**。目标是：只看本文 + 对应源文件的
> 头注释，就能实现或修改一个模块，且知道怎么证明自己做对了。
>
> 版本：v1.0（2026-09-14）。快照：源码约 33k 行、测试 20k 行，**1928 项测试 / 125 个文件**全绿。

---

## 0. 怎么读这份文档

### 0.1 编号约定

| 前缀 | 含义 | 例 |
|---|---|---|
| `MOD-nn` | 模块（一个 pnpm 包或包内的一个目录） | `MOD-04 core/state` |
| `API-nn.m` | 模块 nn 对外暴露的第 m 个接口 | `API-04.1 reduce()` |
| `REQ-nn.m` | 模块 nn 的第 m 条需求（要做的事） | `REQ-12.7 股市屏` |
| `C-xxx-n` | 硬约束，定义在 `DEVELOPMENT_PLAN.md` §5 | `C-DET-1` |
| `Q-xxx-n` / `D-nnn` | 未决问题 / 有意偏差，登记在 `docs/known-deviations.md` | `D-004` |
| `P0-n / P1-n / P2-n` | `DEVELOPMENT_PLAN.md` §11 的待办编号 | `P2-7` |

### 0.2 证据等级（写任何数值/规则前先看这张表）

| 级 | 来源 | 可信度 | 用法 |
|---|---|---|---|
| **A** | `rich4.exe` 二进制（`tools/disasm.py`）+ 实机截图（`docs/original-screens.md`） | 最高 | 最终裁判 |
| **A′** | 需求方口述的原版行为（`docs/original-ui.md`） | 高 | 与 A 冲突时以 A 为准并记录 |
| **B** | 反汇编文本 `rich4-re/asm/*.asm` | 中 | 定位线索 |
| **C** | `rich4-re/csrc/*.c`（人工重写，**已知 8 处错误**） | 低 | 只当线索 |
| **D** | Fandom 百科（**只看大富翁4，4Fun 的规则不同，禁止参考**） | 低 | 提示去哪找 |

每条规则代码必须带 `@source VA 0x........`（A 级）或 `@source rich4-re/...:行号`（B/C 级）。

### 0.3 术语表

| 术语 | 含义 |
|---|---|
| 节点 / node | 棋盘格。`MapNode.id` 从 1 起；`topo.nodes[id-1]` |
| 地块 / land | 住宅或连锁店，`LandInfo.id` 从 1 起，与 `state.landOwner[id]` 对齐 |
| 設施 / facility | 公園(0)/旅館(1)/購物中心(2)/加油站(3)/研究所(4)，最高等级 `[1,5,5,1,5]` |
| 企業 / commercial | 上市企業，与股票一一对应（`stockIndex`），董事長 = 持股最多者 |
| 同區 / street | **同名**的地块视为同一條街（原版 `strcmp(name)`） |
| owner（1 基） | 地产归属字段：0 = 无主，`n` = 玩家下标 `n-1` |
| 物價 / PI | `state.priceIndex`，所有价格乘它 |
| 四大惡人 / NPC | 小偷(4)/強盜(5)/流氓(6)/間諜(7)，特殊棋子表下标 |
| 個性 | 玩家 `+0x17`：0 乖寶寶 / 1 普通人 / 2 大老奸 |
| f7 / 凶狠度 | 卡片表、道具表末列，0..2；AI 闸门 = f7 − 個性 |
| pending | `GameState.pending`，落点后等玩家决定的交互（买地、银行、商店…） |
| 视野 | AI 只考虑画面（以自己为中心 ±220px）内的目标，见 D-005 |

### 0.4 一条铁律

> **core 只算，不画；client 只画，不算。** 任何「这里加个 if 就好了」的规则代码若出现在
> `packages/client`，视为 bug（C-ARC-2/3）。

---

## 1. 目标与现状

### 1.1 三步目标（不变）

| 步骤 | 目标 | 验收口径 | 状态（2026-09-16 更新） |
|---|---|---|---|
| 1 | **完美移植**：画面、玩法、UI、动效、数值 1:1 | 同一局面每个数字与原版一致；UI/动画肉眼无差 | **M0 ✅ M1 ✅ M2 ✅ M3 ✅ M4 ✅**；**75 张任务卡全 done**（A 12 / B 4 / C 39 / D 7 / E 8 / F 5）。`pnpm check` 三绿：**180 文件 / 3351 项**测试 + `tsc -b` + `eslint --max-warnings=0`。仍未验收的是**不可在本机自动完成的那几条**，见 §1.3 |
| 2 | **画质升级**：外部 AI 超分 4×，构图/色调不变 | 4K 素材、无接缝、无彩边 | **管线全线打通**（D 组 7/7）；`assets/hd/` 仍为空 —— **批量超分没跑**（要外部 AI），且底图不在清单里（Q-GND-4）、LRU 释放未接（Q-PERF-1） |
| 3 | **联网对战**：4 人跨机、断线重连、AI 补位 | 联机数值与单机同种子逐字节一致 | **协议 + 序列器 + 房间 + 客户端 + 大厅都做了**（E 组 8/8）；缺 **desync 自愈**（Q-NET-1）与**大厅改角色/换地图**（Q-NET-2）。「4 台机器跨网跑完一局」未实机验 |

### 1.2 已完成的（不必再做，只需维护）

- 数据地基：mkf 解包/解压、SPR/SMP/GND 解码、8 张地图解析、原版存档解析、卡片/道具/角色/事件/股票表（全部带 `@source`）。
- 核心循环：回合/掷骰/走子/岔路（原版不问玩家，随机）、地产（买/盖/收租/同區加成）、物價、月結、破產、30 卡、13 道具、銀行/特別融資、股市（行情/漲跌停/休市/分紅）、樂透、拍賣、商店（货架）、魔法屋、神明/物件、監獄/醫院、四大惡人、設施（買/建/加蓋/轉盤/地契/研究所）、上市企業落点、公佈欄、新聞/命運、存读档（新格式 + 原版导入）。
- AI：買地/盖房、股票、公佈欄、保釋、研究所、個性闸门、**30 卡 + 13 道具的判定函数逐条移植**。
- 表现层：标题、開局设置、棋盘渲染（8 方位、小地图）、HUD 侧栏、对话框、场景底图、存读档屏、設定屏、熱鍵、音效/MIDI、Tauri 壳（素材随包，双击即跑）。
- 联机地基：`stateFingerprint`、`Sequencer`、`Room`。

### 1.3 还要做的（本文 §5 逐条给规格）

> **2026-09-16：下面这三行里的逻辑与 22 屏已经全部做完**（P0-11/12、P1-4/5/6、P2-1..22
> 对应的卡片都 `done`）。现在真正剩的是**验收类**与**登记在案的边角缺口**，逐条列在下面。

**A. 验收类（本机做不了 / 还没做，不是功能缺失）**
1. **M4 三条性能指标**：60 FPS、内存 <1.5GB、冷启动 <3s —— 要在 M1 Air 上实测。
2. **与原版录屏逐帧比对**：手边**没有原版录屏**，关键动画的「误差 <2 帧」未验。
3. **Windows / Linux 构建**：`.github/workflows/build.yml` 三平台矩阵已写，但**本机 macOS 打不出来**，
   要在 CI 真跑一次并验产物。
4. **多处界面需要「原版截图仲裁」**：见各 `docs/deviations/T-0xx.md` 的「需中央复核」一节。

**B. 已登记的功能缺口**（`docs/known-deviations.md` 正文 + `docs/deviations/T-*.md`）
- 表现层边角：Q-BANK-1（貸款屏滑入面板 / 状态机 / ATM 键盘）、Q-OPT-1（設定屏三个黄钮的副屏）、
  Q-PICK-2（紅卡/黑卡选股票、請神符选物件、遙控骰子的输入 UI）、Q-UI-6（GO 鈕拖动）、
  Q-SETUP-1（開局設定屏两条未接线）、Q-AUC-1（拍賣卡挂出的拍賣，电脑不出价）。
- 步骤 2：Q-GND-4（底图不在超分清单）、Q-PERF-1（LRU 的 `onEvict` 未接 + 桌面端 hd 路由）、
  以及**批量超分本身没跑**。
- 步骤 3：Q-NET-1（客户端 desync 自愈）、Q-NET-2（大厅改角色/换地图要协议）。
- 仍未解的数据/逆向条目：Q4（卡片 f6/f7 语义）、Q6（角色 color 字节序）、Q7（AVI 是空占位）、
  Q8（MIDI 软合成）、Q13（节点 `0x22`）、Q17（Save0 的物价指数）、Q18（胜负条件字段）。

---

## 2. 总体架构

### 2.1 分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  packages/desktop   Tauri 壳：开窗、把 Resources/ 里的 mkf 喂给前端      │
├──────────────────────────────────────────────────────────────────────┤
│  packages/client    渲染 + UI + 音频（Canvas 2D，640×480 逻辑舞台）      │
│    输入 → Action ──────────────────────────┐                          │
│    GameState ──→ render（只读）            │                          │
├────────────────────────────────────────────┼─────────────────────────┤
│  packages/server    WebSocket 房间：Sequencer + core 镜像（权威）        │
├────────────────────────────────────────────┼─────────────────────────┤
│  packages/core      ★ 纯 TS、零依赖、完全确定性                          │
│    state/  reduce(state, action, topo) → state                        │
│    rules/  cards/  places/  events/  ai/  rng/  loaders/  net/         │
├──────────────────────────────────────────────────────────────────────┤
│  packages/data      数值表（每条带 @source）                             │
│  packages/assets-pipeline   mkf/SPR/GND/WAV/MIDI 解码；超分队列与回填     │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 允许的依赖方向（违反即 lint 失败）

| 包 | 可以依赖 |
|---|---|
| `data` | 无 |
| `core` | `data` |
| `assets-pipeline` | 无（Node API 允许，仅 CLI 与 `node` 出口用） |
| `client` | `core`、`data`、`assets-pipeline`（**只能用浏览器安全出口**） |
| `server` | `core`、`data`、`ws` |
| `desktop` | `client`（构建产物） |

#### ★ `assets-pipeline` 有**两条出口**，前端只许用第一条

| 出口 | 内容 | 谁可以用 |
|---|---|---|
| `@rich4/assets-pipeline` | 纯 `Uint8Array` 运算：mkf 容器与解压、SPR/SMP 解码、GND 底图、WAV、MIDI、素材分类、切片与合并、锚点与清单、接缝、过审页 | **所有人**（含 client / server） |
| `@rich4/assets-pipeline/node` | 用了 `node:*` 的模块：PNG 编解码（`node:zlib`）、`assemble.ts` | **只有 CLI 与测试** |

**为什么要有这条规矩**：vite 会把 `node:` 换成「一访问就抛」的桩。只要前端 import 的
某个模块（哪怕间接）够得着 `node:`，**整个包加载即失败** —— 症状是页面永远停在
「载入中…」，而所有单测仍然全绿（它们跑在 Node 下，`node:zlib` 在那儿是真的），
类型检查与 lint 也看不出。这就是 Q-BUILD-1，从 `b99b459` 一直坏到本轮。

守卫：`packages/assets-pipeline/src/index.test.ts` 沿真实 import 走一遍图，
断言第一条出口够不着任何 `node:`（**间接路径也算**）。

### 2.3 唯一的数据流

```
用户点击/按键 ──► client 把它翻译成 Action
AI（core/ai）  ──► decideAction(ctx) → Action
网络（server） ──► 广播 {seq, action}
                    │
                    ▼
        state' = reduce(state, action, topo)      ← 唯一能改状态的地方
                    │
                    ▼
        client: requestRender(); playSoundFor(before, after); scheduleAi()
```

**三种来源的 Action 完全同构**（C-ARC-4）。core 不知道也不能知道谁是本地玩家。

### 2.4 硬约束速查（细则在 DEVELOPMENT_PLAN.md §5）

| 约束 | 一句话 | 谁来查 |
|---|---|---|
| C-DET-1/2 | core 里没有 `Math.random` / `Date` | eslint `no-restricted-syntax` |
| C-DET-3 | 金额全整数；除法必须包在 `Math.trunc/floor` 里并注明原版取整方式 | eslint |
| C-DET-4 | 只有 `reduce` 能改状态；同种子同序列逐字节相同 | `full-game.test.ts` 重放 |
| C-DET-5 | 不用 `Object.keys()` 顺序驱动逻辑 | code review |
| C-ARC-1 | core 零 import DOM/Node/第三方 | tsconfig `lib` + eslint |
| C-ARC-2/3 | 逻辑/表现分离；client 只读 state | code review |
| C-FID-1/4 | 数值带 `@source`；禁止「改良」 | `source-fidelity.test.ts` + review |
| C-ENG-4 | core 覆盖率 ≥ 80%；每卡每道具 ≥ 1 测试 | vitest |

### 2.5 完成定义（DoD，每个 REQ 都适用）

1. 规则代码带 `@source`；解不出的部分登记 `known-deviations.md`，**不静默**。
2. 单测钉住每条分支；涉及随机的写「同种子重放一致」测试。
3. `pnpm check`（typecheck + lint + test）三绿。
4. 文档同步：`DEVELOPMENT_PLAN.md` §11 打勾、§6 快照刷新；新解的字段回填 `docs/`。
5. 提交信息：Conventional Commits，数值类提交写明溯源。

---

## 3. 模块清单

> 每个模块按同一模板写：**职责 · 目录 · 输入 · 输出 · API · 核心逻辑（伪代码）· 测试 · 状态**。
> 「API」只列**别的模块会调用**的；包内私有函数看源码头注释。

### MOD-01 `packages/data` —— 数值表

- **职责**：把原版二进制里的常量表搬成 TS 常量。**不含任何逻辑**。
- **目录**：`cards.ts`（30 卡）、`tools.ts`（13 道具）、`characters.ts`（12 角色）、`stocks.ts`、`card-registry.ts`（每张卡的 VA/选择参数/被动标记）、`event-table.ts`（新聞/命運）、`magic-house.ts`、`messages.ts`（BIG5 → UTF-8 文案，带 `textVa`）、`lunar.ts`、`projection.ts`。
- **输入**：无（编译期常量）。**输出**：只读数组/对象。
- **API**
  - `API-01.1 CARDS: readonly CardDef[]` — `{ id, key, name, initAmount, price, f6, f7 }`；`f7` = 凶狠度 0..2。
  - `API-01.2 TOOLS: readonly ToolDef[]` — 同形，`id` 1..13。
  - `API-01.3 CHARACTERS` — 12 角色：`{ id, name, sex, color, f22(aiFlags), f23(個性), cashRatio, stockRatio, ... }`。
  - `API-01.4 CARD_REGISTRY` — `{ id, name, va, selection: 'none'|'ui'|'ai', selectionParam, passive }`；`selectionParam` 决定目标类别（见 MOD-06）。
  - `API-01.5 NEWS_TABLE / FORTUNE_TABLE` — 事件表；`API-01.6 MESSAGES` — 文案。
- **规则**：每个数值一行 `@source`。语义未明的字段保留原名 + `TODO: semantics unknown`（C-FID-2）。
- **测试**：`binary-truth.test.ts` 直接从 `rich4.exe` 读表比对；`source-fidelity.test.ts` 检查每条 `@source` 存在。
- **状态**：完成。新增字段走同一模式。

---

### MOD-02 `core/rng` —— 可种子化随机数

- **职责**：与原版 Watcom C `rand()` **位级一致**的 LCG；随机策略（单机/联机何时重播种）。
- **API**
  - `API-02.1 class WatcomRng { setState(s); getState(); next(): number }` — `next()` 返回 0..0x7fff，与 `rand()` 一致。
  - `API-02.2 policyFor(mode: 'single'|'multiplayer'): RngPolicy`；`needsReseed(policy, occasion)`；`serializeRng / deserializeRng`。
- **约定**：**随机只在 reducer 里消耗**（`state.rngState` 进、新值出）。策略层（AI）是纯函数，需要「掷一下」时用 `aiRoll(state, salt, n)`（MOD-09）的确定性替身，记 D-004。
- **伪代码**（LCG，`@source` Watcom `rand`）
  ```
  next():
    state = (state * 0x343FD + 0x269EC3) mod 2^32
    return (state >> 16) & 0x7fff
  ```
- **状态**：完成。

---

### MOD-03 `core/loaders` —— 地图与存档解析

- **职责**：把 `map.mkf` 的地图 bin、原版 `SAVE*.DAT`、本项目 JSON 存档解析成 TS 结构。**只解析，不解释规则**。
- **API**
  - `API-03.1 parseMap(bytes: Uint8Array): Rich4Map` — `{ nodes: MapNode[], lands: LandInfo[], facilities: FacilityInfo[], commercials: CommercialInfo[], landscapes, dataSize }`。
    - `MapNode`：`{ id, x, y, name, adjacent[], adjacentSlots[4], type, ref: NodeRef, decorIndex, flags, specialKind, noObjects, walkable }`；`ref.kind ∈ special|land|facility|commercial|landscape|unknown`。
    - `LandInfo`：`{ id, x, y, name, priceStatus, type(0 住宅/非 0 连锁店), owner, level, facing, landPrice, housePrice, rentByLevel[6], flast }`。
    - `FacilityInfo`：`{ id, x, y, name, type(0..4), owner, level, facing, priceStatus, landPrice, housePrice, rateByLevel[6] }`（`rateByLevel[0]` = housePrice 本身，原版寻址如此）。
    - `CommercialInfo`：`{ id, x, y, name, stockIndex, landPrice(+0x22), type(行業別), spriteIndex, assetValue, shares }`。
  - `API-03.2 parseSave(bytes): SaveGame`；`importOriginalSave(save, map): { state, gaps }` — 原版存档导入，导不进的字段列在 `gaps`。
  - `API-03.3 serializeGame(state): string` / `deserializeGame(text): GameState` — 本项目存档（`SAVE_MAGIC='RICH4-REMAKE'`，`SAVE_FORMAT_VERSION`），JSON，**含 `rngState`**，保证读档后重放一致。
- **测试**：8 张地图全量解析；`fixtures/` 里的原版存档逐字段对齐（C-FID-3）。
- **状态**：完成。存档落盘到文件系统属 client/desktop（REQ-12.21）。

---

### MOD-04 `core/state` —— 状态、指令、归约器（★ 全项目的心脏）

- **职责**：定义 `GameState`、`Action`，实现唯一的 `reduce`。所有规则在这里被**编排**（具体算法在 MOD-05~08）。
- **文件**：`types.ts`（状态与玩家结构，每个字段注明原版偏移）、`actions.ts`、`reduce.ts`（约 3.4k 行）。

#### 输入 / 输出

| 名称 | 类型 | 说明 |
|---|---|---|
| `state` | `GameState` | 不可变；`reduce` 从不原地改 |
| `action` | `Action` | 见 API-04.2 |
| `topo` | `MapTopology = { nodes, lands?, facilities?, commercials? }` | 地图静态数据；`Rich4Map` 结构兼容 |
| 返回 | `GameState` | 非法/无效 action → **返回原对象（`===`）**，这是「拒绝」的信号 |

#### `GameState` 字段速查（完整定义在 `types.ts`）

```
mode, rngState, globalMapId, year/month/day, totalDays, priceIndex, landTenureIndex
players: Player[]  currentPlayer  phase: TurnPhase  pending: PendingInteraction|null
dice[], stepsRemaining, stepsTotal, forcedDice
cardAmount[30]（牌堆）  tools[]/toolStock[]（道具持有/库存）
landOwner[]/landLevel[]/landType[]/landLastToll[]/landTenure[]
facilityOwner[]/facilityLevel[]/facilityType[]/facilityLastToll[]/facilityTenure[]/facilityResearchProject[]/facilityResearchDays[]
noticeBoard[玩家][槽]  specialActors[5]（四大惡人 + 機器娃娃）  objects[46]（神明/道具物件）
market: StockMarketState  holdings[玩家][12]  commercialShares[]  commercialOwners[]  companyFunds[]
newsDeck/fortuneDeck  pool（樂透獎池） lottery[]  prisonOccupancy[]/hospitalOccupancy[]
turnCount  snapshots[]（時光機）  lastEvent
```

`Player`：`index, character, whoPlays(0 出局/1 真人/2 电脑), nodeId, lastNodeId, direction, trafficMethod, ndices, aiFlags, personality, cashRatio, loanRatio, stockRatio, cash, moneyInBank, loan, specialFinance, loanDueDate, points, blocking{inHotel,disappearing,inPrison,inHospital,sleeping,sleepWalking,stopping,tortoiseWalking}, godInfo, f64, cards[], tools[], alliedPlayer, alliedDays, insuranceDays, misfortune/fortune/luck, hostility[4], monthlyPaid/Received`。

`aiFlags`(+0x16) / `personality`(+0x17) / `cashRatio`(+0x19) / `loanRatio`(+0x18) / `stockRatio`(+0x1a)
都由**託管AI 屏**（REQ-12.1）编辑。其中 `cashRatio` **目前没有任何规则读它**——原版拿它决定
「到银行时多少放存款」，本引擎未实现该行为（见 known-deviations 的 Q-BANK-3），故它现在
只是存取一个设置值，屏上调得动、存得住，但不影响 AI 决策。

#### 回合状态机

```
turnStart ──startTurn──► awaitingRoll ──rollDice──► moving ──step×n──► settling ──settle──►
   │                        │ (可先 useCard/useTool/buyStock/sellStock/noticeBoard)        │
   │                        │                                            ┌─────────────────┘
   │                        │                                            ▼
   │                        │                              awaitingDecision（pending ≠ null）
   │                        │                                 │ buyLand/upgradeLand/…/declineDecision
   │                        │                                 ▼
   └──（被阻：住院/坐牢/冬眠…）──────────────────────────► turnEnd ──endTurn──► 下一位 turnStart
                                                                          （跨日：advanceGameDay）
```

#### API

- `API-04.1 reduce(state, action, topo): GameState`
- `API-04.2 Action` 联合类型（全部）：`reseed, startTurn, rollDice{forced?}, step, setDiceCount{count}, settle, buyLand, upgradeLand, buyFacility, buildFacility{facilityType}, upgradeFacility, research{facilityId,project}, buildTarget{entityId}, declineDecision, buyStock/sellStock{stock,shares}, buyShares{shares}, useCard{cardId,target?}, useTool{toolId,nodeId?,target?}, noticeBoard{op:list|withdraw|buy|reprice…}, shop{op:buyCard|sellCard|buyTool|sellTool,id,count?}, lottery{number}, auction{winner,price}, bail{slot}, minigame{score}, bank{...}, setAi{player,…}, aiNext, endTurn`。
- `setAi{player, whoPlays?, aiFlags?, personality?, cashRatio?, stockRatio?}`：改一名玩家的託管设置，
  五个字段**都可选**（给哪个改哪个）。服务器掉线代打只发 `whoPlays`（`WHO_PLAYS_HUMAN|AUTOPILOT`）；
  **託管AI 屏**按「確定」时一次性发全部五项 —— 原版也是先编辑一份暂存表、確定时才拷回
  （`0x0041e577` 起，见 `docs/original-screens.md` S3）。任一字段越界即整条拒绝（返回原 state）。
- `API-04.3 autoAction(state): Action|null` — 出局者/被阻者的回合由引擎自动推进（不经策略）。
- `API-04.4 reduceAll(state, actions[], topo)` — 重放。
- `API-04.5 newGame(opts: NewGameOptions): GameState`（在 `rules/new-game.ts`）— `{ map, globalMapId, seed, players: PlayerSetup[], initialCash, landTenure, ... }`。
- `API-04.6 isGameOver(state)` / `gameOverCode(state)`；`nextCandidates(topo, from, prev)`、`pickNextNode(...)`（走子选路）；`allEffectiveLands/Facilities(state, topo)`（把状态里的归属/等级合到静态表上，给规则与 AI 用）。

#### 核心伪代码（`reduce` 的骨架）

```
reduce(state, action, topo):
  switch action.type:
    'startTurn':
      require phase == 'turnStart'
      s = startTurn(state)            // 阻塞倒数、AI 公佈欄/研發/保險 tick、月初/月結挂钩
      if 被阻: s.phase = 'turnEnd' else s.phase = 'awaitingRoll'
    'rollDice':
      require phase == 'awaitingRoll'
      dice = rngRoll(ndices)          // 每颗 rand()%6+1，顺序固定
      s.stepsRemaining = sum(dice); s.phase = 'moving'
    'step':
      require phase == 'moving'
      next = pickNextNode(topo, me.nodeId, me.lastNodeId, rng)   // 岔路随机
      move(me → next); stepsRemaining--
      经过格效果（路障/地雷/神明附身/銀行经过…）
      if stepsRemaining == 0: s.phase = 'settling'
    'settle':
      require phase == 'settling'
      switch topo.nodes[me.nodeId-1].ref.kind:
        land      → landOnLand(...)      // 无主→pending buyLand；自己→pending upgradeLand；别人→pay toll
        facility  → landOnFacility(...)  // 買/建/加蓋 pending 或 settleFacility（轉盤/收費/住店）
        commercial→ landOnCompany(...)   // 按行業收費/董事長好处
        special   → landOnSpecial(...)   // 銀行/股市/商店/樂透/魔法屋/監獄/醫院/新聞/命運…
      if s.pending: s.phase = 'awaitingDecision' else s.phase = 'turnEnd'
    'buyLand' | 'upgradeLand' | ... | 'declineDecision':
      require phase == 'awaitingDecision' && responseMatches(pending, action)
      apply; s.pending = null; s.phase = 'turnEnd'
    'useCard': playCard(...)   // 见 MOD-06；失败返回原 state
    'useTool': useTool(...)    // 见 MOD-05
    'endTurn':
      require phase == 'turnEnd'
      settleBankruptcies; if isGameOver: 结束
      s.currentPlayer = nextAlivePlayer; s.turnCount++
      if 轮到首位: advanceGameDay(s)   // 日期+1、地契到期、15 日分紅、行情（休市日不走）、月結
      s.phase = 'turnStart'
  return s === state ? state : Object.freeze-like 新对象
```

- **测试**：`full-game.test.ts`（4 AI 跑完整局 + 同种子重放逐字节一致 + 多种子 soak）、每个分支各自的 `*.test.ts`。
- **状态**：完成；P0-11/12 边角见 REQ-05.1/05.2。

---

### MOD-05 `core/rules` —— 规则库

> 一个文件一件事，全是**纯函数**，不碰 `GameState` 整体（只收它需要的切片）。reducer 负责拼装。

| 文件 | 职责 | 关键 API |
|---|---|---|
| `turn-start.ts` | 回合开始的阻塞判定与倒数 | `tickBlockingCounter(p)`, `isBlocked(p)` |
| `land.ts` / `purchase.ts` / `toll.ts` / `rent.ts` | 地价、盖房价、能否买/盖、过路费（同區加成、连锁店） | `landPurchasePrice(land, PI)`, `upgradeCost`, `canPurchase`, `canUpgrade`, `calculateToll(...)` |
| `facility.ts` | 設施类型/等级上限、買/建/加蓋价、轉盤表、地契年限、研究所 | `FACILITY_TYPE`, `FACILITY_MAX_LEVEL`, `facilityBuyPrice`, `spinWheel(wheel, rand)`, `tenureExpiry`, `startResearch/tickResearch` |
| `payment.ts` / `money-flow` | 付款（现金→存款→贷款→破產）；`monthlyPaid/Received` 累加 | `transferMoney(players, ..., flags)` |
| `bankruptcy.ts` | 破產清算：地产/設施/股票/道具全部释放 | `applyBankruptcy(state, i)`, `settleBankruptcies` |
| `monthly.ts` / `wealth.ts` | 月結（利息、貸款到期、頒獎）、資產估值 | `monthlySettlement`, `wealthOf` |
| `hostility.ts` | 敌意 `hostility[a][b]`（下限 0；上升解除同盟） | `updateHostility(players, a, b, delta)` |
| `tools.ts` / `tool-effects.ts` / `time-machine.ts` / `teleport.ts` | 道具持有/库存、13 道具效果 | `giveTool/takeTool`, `useToolEffect(...)`, `teleportFacility` |
| `objects.ts` / `god-toll.ts` / `blessing.ts` / `object-landing.ts` | 46 物件表、神明附身/离身、三项修正、踩到物件 | `objectTypeOf`, `GOD_MODIFIERS`, `attach/release` |
| `special-actors.ts` / `npc-actions.ts` / `npc-walk.ts` | 四大惡人 + 機器娃娃：安置、放行、逐格结算 | `initialSpecialActors`, `releaseNpc`, `runNpc`, `applyNpcEvents` |
| `confinement.ts` / `visit.ts` / `beggar.ts` / `auction.ts` / `blocking.ts` / `percentage.ts` | 监狱/医院、探监保釋、乞丐、拍賣、阻塞天数、百分比取整 | 见各文件头 |
| `interaction.ts` | `PendingInteraction` 与 `InteractionResponse` 的定义与匹配 | `responseMatches(pending, resp)`, `needsInteraction(kind)` |
| `new-game.ts` / `setup.ts` | 開局：起点抽签、初始现金/道具/牌堆、企業股份 | `newGame(opts)` |

**通用伪代码模板（以「落在别人的地」为例，`@source 0x0041a404` 附近）**

```
landOnLand(state, land):
  owner = state.landOwner[land.id]
  if owner == 0:                       return pending{buyLand, price = landPrice*PI}
  if owner == me+1:                    return level<5 ? pending{upgradeLand, cost = housePrice*PI} : none
  // 别人的地
  toll = calculateToll(land, sameStreetLandsOf(owner), level, PI, 神明修正, 免費卡?)
  state = transferMoney(state, me → owner-1, toll, flags=到银行)
  state.landLastToll[land.id] = toll   // 間諜「取過路費」读这里
  hostility[owner-1][me] 不变；hostility[me][owner-1] += 依表
  if 付不起 → applyBankruptcy(me); phase = 'turnEnd'
```

- **测试**：每个文件同名 `*.test.ts`；金额分支必须覆盖「付得起 / 付不起→破產」。
- **状态**：完成，除下列两条：
  - **REQ-05.1（P0-11）控制类卡/道具对四大惡人生效**：`useCard/useTool` 的目标允许 `{kind:'actor', actor: 4..8}`；停留/轉向/烏龜/路障对 `specialActors[actor-4]` 的 `direction/stepsRemaining/halted` 起作用；魔法屋男性效果不影响 NPC。**输入**：现有 `CardTarget` 扩一个 `actor` 变体；**输出**：`specialActors` 变化；**验收**：四张控制卡 × 四个 NPC 各一条测试。掩码语义待解（`0x446ae8/0x445e4d/0x446656`），解不出就按 A′ 口述实现并登记。
  - **REQ-05.2（P0-12）NPC `+14 halted / +15 single_step` 的写入点**：找到后接进 `runNpc`；找不到登记 Q-NPC-2 并保留现状。

---

### MOD-06 `core/cards` —— 30 张卡

- **职责**：每张卡一个文件（`applyXxxCard(...)` 纯函数）+ `registry.ts` 统一入口。
- **API**
  - `API-06.1 useCard(ctx: UseCardContext, cardId, target: CardTarget): UseCardResult`
    - `UseCardContext = { players, lands(有效), nodes, currentPlayer, priceIndex, scapegoatPicker }`
    - `CardTarget = {kind:'none'} | {kind:'player', index} | {kind:'entity', entityId}`（**REQ-06.1 要扩**）
    - `UseCardResult = { ok, error, players, lands, hostilityDeltas, defended, releasedObjects }`；**`ok=false` 时不扣卡**。
  - `API-06.2 targetClassOf(selectionParam)`：`0xe0c0010 → anyPlayer(含自己)`，`0xe0c0410/0710 → player`，`0xe0c0202/0006/0506/0626 → land`。
- **伪代码（registry）**
  ```
  useCard(ctx, id, target):
    impl = CARD_REGISTRY[id]; if impl.passive → fail('passiveCard')
    if !playerHasCard → fail('notInHand')
    validateTarget(targetClassOf(impl.selectionParam), target) else fail
    switch id: 调用 applyXxxCard，得到 players'/lands'/hostilityDeltas
    players'' = applyHostilityDeltas(players', deltas)     // 可能顺带解除同盟
    consumeCard(players''[cur], id)                          // ★ 效果生效后才扣卡
    return ok
  ```
- **状态**：19 张已接线（1,2,3,4,5,6,7,9,10,12,14,15,17,22,26,27,28,29,30）；4 张被动（18–21）。
- **REQ-06.1 接线剩余 7 张 + 扩目标类型**（新，来自 Q-CARD-2）：
  | 卡 | 现状 | 要做 |
  |---|---|---|
  | 8 拍賣卡 | 模块缺 | `applyAuctionCard`：把脚下地块/設施送入 `pending{auction}`（复用 `rules/auction.ts`） |
  | 11 怪獸卡 | `monster.ts` 有 | 目标扩 `facility`；效果：等级 −? 按 `0x00443917` |
  | 13 搶奪卡 | `rob.ts` 只有道具路径 | 加**卡片路径**（`0x441343` 取卡 + `0x4412e4` 给卡）；目标 `{kind:'player', index, steal: {kind:'card'|'tool', id}}` |
  | 16 夢遊卡 | `sleepwalk.ts` 有 | 接 registry |
  | 23 請神符 | `summon.ts` 有 | 目标 `{kind:'object', objectIndex}`；`attachObject` |
  | 24 紅卡 / 25 黑卡 | `swap-and-stock.ts` 有 | 目标 `{kind:'stock', index}`；改 `market.stocks[j].f6`（天数）与 `newsFlag` |
  | 地块类卡对**設施** | 只支持 land | `CardTarget` 加 `{kind:'facility', facilityId}`；9/10/12/27/28 按原版也作用于設施 |
  **验收**：`registry.test.ts` 30 张全有「能出 / 不能出」两条；AI 的 `toCardTarget` 不再返回 null。

---

### MOD-07 `core/places` —— 场所

| 文件 | 场所 | 关键 API / 规则 |
|---|---|---|
| `bank.ts` / `special-finance.ts` | 銀行：存/取/貸/還、利率、特別融資（銀行董事長） | `pending{bank}` + 响应 `bankDeposit/Withdraw/Borrow/Repay/FinanceBorrow/FinanceRepay{amount}` |
| `stock.ts` / `stock-market.ts` | 股市：12 支、行情（均值回归 + 趋势 + 冲击，`Math.fround` 单精度）、漲跌停 ±10%、休市 = `isHoliday`、停牌天数 | `tickStockMarket`, `applyPriceTick`, `isLimitUp/Down`, `marketOpenOn(mapId,y,m,d)` |
| `commercial.ts` / `company.ts` | 上市企業：持股排名→董事長、落点按行業收費、15 日分紅、保險期、建設免费加蓋 | `companyFeeOnLanding`, `companyDividends`, `chairmanEffect` |
| `shop.ts` | 百貨：货架 6..15 张卡加权不放回、道具 1..8、董事長進門有禮；买卖价 | `drawCardShelf(cardAmount, rng)`, `toolShelf(stock)` |
| `notice-board.ts` | 公佈欄：挂卡/道具/股票/地產，四种市價，AI 挂/重估/买 | `toolListPrice`, `stockListPrice`, `estateListPrice`, `aiWantsToListTool` |
| `lottery.ts` | 樂透：投注、獎池、開獎 | `pending{lottery}` |
| `magic-house.ts` | 魔法屋 12 功能 | `applyMagic(kind, ...)` |
| `minigame.ts` | 三个小游戏：core 只收分数 | `pending{minigame}` → `minigame{score}` |
| `calendar.ts` | 星期、節日表 | `weekdayOf`, `isHoliday(mapId, y, m, d)` |

- **状态**：完成。UI 屏在 MOD-12 的 REQ-12.x。

---

### MOD-08 `core/events` —— 新聞 / 命運

- `deck.ts`：牌堆游标（**无论事件是否可行游标都前进**）；`news.ts`/`fortune.ts`：可行性判定；`*-effects.ts`：效果。
- API：`drawEvent(deck, ctx) → { deck', event|null }`，`applyNewsEffect(state, id)`。
- 状态：完成。

---

### MOD-09 `core/ai` —— 电脑玩家

- **职责**：给定 `GameState` 与地图，产出一个 `Action`。**纯函数、不掷骰、不改状态**。
- **文件**：`policy.ts`（总调度 + 落点决策）、`personality.ts`（f22 能力位、f23 個性闸门、貸款比例）、`card-policy.ts`（30 卡判定）、`tool-policy.ts`（13 道具判定）、`stock-policy.ts`。
- **API**
  - `API-09.1 decideAction(ctx: { state, map, personality? }): Action | null`
  - `API-09.2 personalityAllows(f7, 個性, roll): boolean` — `f7−個性 ≥ 2` 从不、`== 1` 三分之一、`≤ 0` 照做（`@source 0x0041e69e`）。
  - `API-09.3 aiCardChoice(cardId, view: CardAiView): AiCardChoice|null`；`aiToolChoice(toolId, view)`。
  - `API-09.4 aiRoll(state, salt, n)` — 纯策略层的 `rand()%n` 替身（D-004）。
- **调度伪代码（`decideAction`）**
  ```
  if auto = autoAction(state): return auto           // 出局/被阻由引擎推进
  if !isAiTurn(state): return null
  switch state.phase:
    turnStart        → {startTurn}
    awaitingRoll     → decideCard ?? decideTool ?? decideStockTrade ?? {rollDice}
    moving           → {step}
    settling         → {settle}
    awaitingDecision → decidePending(state) ?? decideAtLanding(state, map)
    turnEnd          → decidePending(state) ?? {endTurn}
  ```
  **REQ-09.2（P1-5）**：原版顺序是 `fcn_00418c55`：买股 → 卖股 → `fcn_00436b0a` → 买地/盖房 → `rand&1` → 用卡/用道具。核对并改成一致；每步一条测试。
- **出牌伪代码（`decideCard`，`@source 0x00441d09..0x00441e07`）**
  ```
  if !(aiFlags & 1): return null
  hand = cardsToConsider(me.cards, aiRoll(...))      // >8 张时从随机起点环形取 8 张
  for cardId in hand:
    if !personalityAllows(CARDS[cardId].f7, me.personality, gateRoll): continue
    choice = aiCardChoice(cardId, view)              // 跳表 0x475324[cardId]
    if !choice: continue
    target = toCardTarget(choice.target)             // 引擎接不住的目标 → null（Q-CARD-2）
    if target && useCard(...).ok: return {useCard, cardId, target}
  return null                                        // 一回合最多一张
  ```
  三条共用机制：**视野**（画面 ±220px，行序扫描，D-005）、**最恨的人**（`hostility` 最大且 >0）、**同區**（同名）。
- **REQ-09.1（P1-4）买哪一支股票**：翻译 `0x0042c075` 起的多指标打分（資產額 `+0x24`、累積盈餘 `+0x2c`、行情、持仓）。输入 `state.market`、`holdings`、`commercials`；输出 `stockIndex | -1`；验收：给定 3 个构造局面，打分排序与手算一致。
- **REQ-09.3（P1-6）AI 研發**：業主是 AI 时选项目：现有 `aiPickResearchProject(level) = level`，核对研究所 UI 的 AI 分支后定案。
- **状态**：P1-1/2/3 完成；P1-4/5/6 待做。

---

### MOD-10 `core/net` —— 协议与序列器（联机地基）

- `protocol.ts`：`PROTOCOL_VERSION=1`；`ClientMessage = join{version,room,name} | intent{action} | checksum{seq,hash}`；`ServerMessage = joined{seat,room} | room | start{seed,globalMapId,seats} | action{seq,action} | desync{seq,expected,got,seat} | error`；`stateFingerprint(state): string`（FNV-1a over 关键字段）。
- `sequencer.ts`：`class Sequencer { start(); stop(); submit(seat, action, apply?) → AcceptResult; log }` — **非法 action 不占序号**；`RejectReason = notYourTurn|badSeat|notRunning|illegalAction`。
- 状态：完成，服务器见 MOD-14。

---

### MOD-11 `packages/assets-pipeline` —— 素材管线

- **职责**：解码原版格式；超分队列与回填。**client 只用解码函数**。
- **API**
  - `API-11.1 mkfEntries(bytes) / mkfRead(bytes, index) → Uint8Array`；`mkfDecompress(src, outSize)`（自适应霍夫曼 + LZ77，与 C 逐字节一致）。
  - `API-11.2 decodeSprite(bytes) → { frames: { w, h, x, y, rgba }[] }`（SPR 8bpp 调色板 / SMP 16bpp RGB555，均无压缩）；`decodeGround(bytes) → GroundImage`（32×32 tile 布局）。
  - `API-11.3 readWaveInfo`, `parseMidi(bytes) → MidiSong`。
  - `API-11.5 出口`：上列 API 全在**浏览器安全**出口 `@rich4/assets-pipeline` 上。
    `decodePng`/`encodePng`（用 `node:zlib`）与 `assembleHd` 在 `@rich4/assets-pipeline/node` 上，
    **前端不得 import**（见 §2.2）。`hdRelativePath` 是例外中的关键：**写读两侧共用**
    （`assemble` 写、client 的 `SpriteCache` 读），故它住在浏览器安全的 `upscale.ts` 里。
    前端要读 PNG 走浏览器原生解码：`createImageBitmap(new Blob([bytes]))`。
  - `API-11.4 CLI`：`pnpm unpack`（`assets/game/` → `extracted/`，不入库）；`pnpm upscale plan|slice|merge|assemble|status|ingest`（`assets/hd-manifest.json` 记模型/参数/哈希）。
    完整交接链：`plan` 出清单 → `slice` 把待超分帧切进 `assets/upscale-queue/`（rgb/alpha 分开，C-AST-4/5）→ **[外部超分 4×]** → `merge` 校验（尺寸恰 4×、哈希未变即拒）并合并回 RGBA → `assemble` 按 `hdRelativePath` 落进 `assets/hd/`、锚点按**实际输出尺寸**重算（C-AST-6）、写 manifest 条目（幂等：产物哈希未变则不重写）。
    `ingest` 保留给「产物直接按原名放进 hd 目录」的旧路径。
- **REQ-11.1（步骤 2）批量超分与回填**：
  - 输入：`extracted/` 的 PNG + `meta.json`（w/h/x/y 锚点）。
  - 流程（每步一个可单测的纯函数）：分类 → 按帧切片 → 分离 Alpha → **[用户外部超分 4×]** → 合并 Alpha、去彩边（边缘 1px 内按 alpha 加权重采样）→ 重拼 → 锚点 ×4（C-AST-6）→ 接缝检查（相邻 tile 边缘色差 > 阈值即报）→ 写 `assets/hd/<档案>/<同名>`。
  - 输出：`assets/hd/` + `hd-manifest.json`；client 的 `SpriteCache` 优先读 hd，缺则回退原图（**按图回退，不是整包**）。
  - 验收：`ingest` 拒绝尺寸非 4× 的图；并排比对页；M1 Air 60FPS/内存 <1.5GB。

### MOD-12 `packages/client` —— 渲染、UI、音频

- **职责**：把 `GameState` 画到 640×480 逻辑舞台（等比缩放到窗口），把输入翻译成 `Action`，放音。**不含规则**。
- **技术**：Canvas 2D（PixiJS 方案已被实际实现替代；性能达标则不换）。所有坐标以 **640×480 舞台坐标**写死，来源是原版 `rich4_ui_*.asm` 的常量或实机截图。
- **文件与职责**

| 文件 | 职责 | 对外 API |
|---|---|---|
| `main.ts` | 装配：boot、`dispatch(action)`、AI 调度、渲染循环、输入绑定、工具列 | `dispatch(action)`（唯一改状态入口） |
| `stage.ts` | 640×480 → 窗口的等比缩放与坐标换算 | `stageMetrics(viewW, viewH)`, `toStage(e)`, `inRect` |
| `assets.ts` | 四个 mkf 归档的加载、`SpriteCache`（hd 优先回退原图）、角色精灵编号规则 | `SpriteCache.get(archive, resource, image)`, `characterSprite(character, pose)`, `readMapData(archives, mapId)` |
| `render.ts` | 棋盘：地形、节点、房子、棋子、物件、8 方位旋转、摄像机、拾取 | `class BoardRenderer.draw(input: RenderInput)`, `fitCamera`, `characterCamera`, `pickNodeAt` |
| `hud.ts` | 右侧 200×280 面板 + 200×200 侧栏（日历/月历/小地图三页） | `class Hud.draw(input: HudInput)`, `hitSidebar` |
| `dialog.ts` / `gameui.ts` | 通用对话框皮肤（`Data.mkf #0x205`）、是/否钮、GO 钮与骰子数切换、填数页 | `layoutDialog`, `hitDialog`, `drawDialog`, `drawAdvance`, `drawDice` |
| `scenes.ts` | `pending.kind → Panel.mkf 资源号` 的场景底图表 | `SCENE`, `sceneFor(pending)` |
| `interactions.ts` | `pending → InteractionUi{ title, lines, choices[] }`，每个 choice 对应一个 `Action` | `interactionUi(state, topo)` |
| `title.ts` / `setup.ts` / `saveload.ts` / `options.ts` | 标题、開局设置、存读档（6 槽 + 自动）、設定（速度/动画/音乐/音效/自动存档/熱鍵/視窗） | 各自 `hitXxx` / `drawXxx` |
| `hotkeys.ts` | 原版 `RICH4.CFG` 键位表 | `hotkeyOf(e, bindings)` |
| `audio.ts` / `music.ts` | `Effect.mkf` 音效、`Speaking.mkf` 語音、MIDI 软合成 25 首 | `SoundPlayer.play(archive, id)`, `MusicPlayer.play(track)` |
| `host.ts` | 桌面/浏览器差异：素材路径、文件选择、日志 | `isDesktop()`, `assetBase()`, `pickFile()` |

- **渲染循环伪代码**
  ```
  dispatch(action):
    before = state; state = reduce(state, action, topo)
    if state !== before: history.push(action); playSoundFor(before, state); 关掉填数页
    requestRender(); renderPanel(); scheduleAi(); scheduleHumanTurn(); autosaveIfEnabled()

  scheduleAi():                      // 电脑回合
    if !isAiTurn(state) return
    setTimeout(() => dispatch(decideAction({state, map})), delayByOption(速度))

  frame():
    boardRenderer.draw({state, topo, camera, sprites, view})
    hud.draw({state, sidebarView})
    if pending: drawSceneStage(sceneFor(pending), interactionUi(state, topo))  // 场所整屏底图
    else drawAdvance(GO 钮) / drawDice(...)
    blitStage()                      // 640×480 → 窗口
  ```
- **每屏的规则**：**场所控件每屏各自去 `rich4_ui_*.asm` / exe 找坐标与行为，不得套一套通用面板**（需求方 2026-09-14 拍板）。下表是 22 屏的需求条目，格式：资源 · 读什么状态 · 派发什么 Action · 布局证据。

| REQ | 屏 | 资源 | 读 | 派发 | 布局证据 | 备注 |
|---|---|---|---|---|---|---|
| REQ-12.1 (P2-1) | 託管AI | ⚠️ **`Panel.mkf #77`**（先前误记为 Data.mkf） | `players[i].whoPlays/aiFlags/personality/cashRatio/stockRatio` | `setAi{player, …}`（五个字段都可选，確定时一次性发） | S3：14 条字串坐标 + 底图 435×355 | 三种個性名：乖寶寶/普通人/大老奸 |
| REQ-12.2 (P2-2) | 個人資產表 + 三清單 | `Panel.mkf #9` **资源 9 的图 0/1/2**（三个视图各一张 640×480） | `panelValues` + `assetCounts`（四条计数） | 无（只读）；顶栏页签换玩家、三颗钮换视图 | S7 | **字段名照原版：`現  金`/`點  卷`（不是「點券」）**；12 个字段标签只画在视图 0；视图 1/2 只画列名，数据行属 T-023 |
| REQ-12.3 (P2-3) | 道具欄（T-024 ✅）/ 卡片欄（**T-025 ✅**）| **`Panel.mkf` 资源 11**，图 1 = 道具欄（粉红）、图 0 = 卡片欄（灰绿）；**图 2..14 = 13 个道具图标**（图号 = 道具号 + 2）、图 15/16 = 載具徽章 | `state.tools` / `players[cur].cards` | `useTool`（**无目标的 4 件直发**：機器娃娃/機車/汽車/時光機；需要目标的那几件进 **T-026 拾取模式**，✅ 已做）| S8/S9 | 底图落 (14,130)；格原点 (19,135)、格 **80×56**、5×3 **紧排**；道具格画图标 + `×N`（右上）、**卡片格只画卡名**（居中，无图标）；道具欄**末格**盖 `traffic_method` 的載具徽章（1=機車图15 / 2=汽車图16）。★ 两栏**都不灰显** —— 点下去由 core 预演说了算，没成则播失败音（音效 4）并把弹窗开回来 |
| REQ-12.3b (T-026 ✅) | **目标拾取模式**（选玩家/地块/設施/物件/格子）| **`Data.mkf` 资源 0** = 指针图集（0/1/2 = 路障/地雷/定時炸彈、5 = 红叉、12 = 卡片、34..40 = 方向箭头）| `core/state/preview.ts` 的 `canUseCard` / `canUseTool`（**预演，不改状态**）| `useCard{cardId,target}` / `useTool{toolId,nodeId}` | — | ★ 反馈是**指针变形**（可选 → 那件道具自己的图标、不可选 → 红叉）；选择参数低 16 位 = 类别位（bit3 = 目标必选、右键不许取消）、高 16 位 = 指针图号 |
| REQ-12.4 (P2-4) | 側欄四页（**資金 / 地產 / 股票 / 其他**）| `Panel.mkf #0` 图 0..3 | `panelValues`（四页各三值）| 熱鍵 PgUp/PgDn 切页；**点右上角四条彩色竖条**也切（页号 = `y / 70`，VA 0x004182fa）；页号每玩家一份 | S6/S10–S12 | 底部固定一行「物價指數 N」；四页另有头像+名字+角色色长条。★ 地產页的「連鎖店」判据是**地块的 `type`（+0x18）≠0**，不是 `level` |
| REQ-12.5 (P2-5) | 小地圖旋转钮 | — | `view` | 熱鍵「地圖向左/右旋轉」 | S6 | `render.ts` 已有 8 方位 |
| REQ-12.6 (P2-6) | 銀行屏 | `#23` | `cash/moneyInBank/loan/specialFinance/loanDueDate` | `bank*{amount}` | U-3 | 白卡左申請/右償還；董事長多一条額度 ｜ ✅ 2026-09-15 完成（T-029）：★ 复习出原版是 **ATM（`#24`）+ 貸款（`#23`）两屏**，不是一屏；貸款屏只有 **4 个命中框**（表 `0x4757f8`） |
| REQ-12.7 (P2-7) | 股市屏 + 持股彙總 | `#75/#76` | `market`, `holdings`, `valuationsOf` | `buyStock/sellStock` | U-5 | 漲停/跌停/停牌提示 ｜ ✅ 2026-09-15 完成（T-030/T-030b/T-031）：`#76` 复习为**每月 15 日的「上市公司分紅」屏**（入口 VA 0x0041d08f），`buyShares` 走通用訊息框＋填数窗；见 `docs/deviations/T-031.md` |
| REQ-12.8 (P2-8) | 卡片/道具商店 | `#10` | `pending{shop}` 的货架 | `shop{op,id,count}` | U-2 | 右上三角切换；右下卖自己的 ｜ ✅ 2026-09-15 完成（T-032） |
| REQ-12.9 (P2-9) | 公佈欄屏 | `#73` | `noticeBoard` | `noticeBoard{op}` | S13 | 賣價由卖家输入 ｜ ✅ 2026-09-15 完成（T-033）：入口 = 熱鍵「交易」；挂牌格 `(104,114)` 起 72×72；SALE 选单**按住拖**才开选物窗 |
| REQ-12.10 (P2-10) | 拍賣屏 | `#26` | `pending{auction}` | `auction{winner,price}` | U-7 | PASS/+1000/+5000 钮；挥锤动画 ｜ ✅ 2026-09-15 完成（T-034）：七颗钮 `x=406`、`y=133+48i`、图 `2i+4`/`2i+3`；加价档表 `0x475ba2`；AI 出价补在 `rules/auction.ts` |
| REQ-12.11 (P2-11) | 樂透投注 + 開獎 | `#12/#15` | `pending{lottery}`, `pool` | `lottery{number}` | U-8 | 摇球动画 ｜ ✅ 2026-09-15 完成（T-035 投注 / T-036 開獎）：36 格号盘、红粉笔、跑馬燈；開獎十态演出（摇球 ANM 实为 **880 ms/帧**，不是 FLIC 头的 71 ms） |
| REQ-12.12 (P2-12) | 魔法屋 | `#18` | `pending{magic}` | 选项 | U-9 | 外圈悬停高亮 + 中央文字 + 音 ｜ ✅ 2026-09-15 完成（T-037）：命中不是算角度，是查 **`Panel#19` 的逐像素掩膜**（圆心 (320,238)、十二楔形 ±15°、外半径 241） |
| REQ-12.13 (P2-13) | 監獄/醫院保釋屏 | `#63/#65` | `prisonOccupancy/hospitalOccupancy`, `specialActors` | `bail{slot}` | — | 八个位子；四大惡人在列（300 點） ｜ ✅ 2026-09-15 完成（T-038）：槽位表 `0x475c04`/`0x475c64`、命中 `0x79×0x89` |
| REQ-12.14 (P2-14) | 轉盤 / 研究所选項目 | 待认素材 | `pending{buildFacility…}`, `facilityResearch*` | `research{facilityId,project}` | — | 轉盤只做表现，结果已在 state ｜ ✅ 2026-09-15 完成（T-039 轉盤 / T-040 研究所）：转盘 = 资源 `(转盘&3)+0x44` 图 `槽+2`、圆盘 (220,320)；研究所图标 = `Panel#11 图 10..14`、板/条 = `Data#517 图 5/7`、命中**横排** |
| REQ-12.15 (P2-15) | 每月結算 + 頒獎 | `#25` | 月結结果 | 无 | U-15 | — ｜ ✅ 2026-09-15 完成（T-041）：结算屏 `fcn_00439bfa` + 頒獎屏 `fcn_00437e61`；摘要全部由 `before→after` diff 得出（零 core 改动） |
| REQ-12.16 (P2-16) | 三个小游戏 | 企鵝 `#78/#79/#80..#8a`、氣球 `#78/#79/#91`、財神 `#78/#79/#92/#93/#94/#95..#99/#100+角色`（卡面旧写的 mkf 11/19/22 与 `#80`/`#91` 都不对） | `pending{minigame}` | `minigame{score}` | — | 玩法状态机在 client，分数进 core ｜ ✅ 2026-09-15 完成（T-042/043/044）：三屏合一份 `client/minigame-screen.ts`；玩法/计分/时限全部从 `rich4_small_games.asm` 读出；★ 素材号订正见备注 |
| REQ-12.17 (P2-17) | 輔助說明 | `help.mkf` | — | — | 工具列 #1 | 只读 ｜ ✅ 2026-09-15 完成（T-045）：窗口过程 VA 0x0044e40b、面板 (20,60) 400×400、条目表 `0x4761b4`、命中表 `0x476254` |
| REQ-12.18 (P2-18) | 走子补间与时序 | `jump.mkf` 72 组；`rich4_animate_object.asm` | `stepsRemaining`, `specialActors` | `step` 节拍 | 录屏逐帧 | 含四大惡人/機器娃娃棋子 ｜ ✅ 2026-09-15 完成（T-046/T-047）：替身图组 `Data 380/384/388/392`（站基号、走 +1）、機器娃娃 `0x209/0x20a`；`GameState.lastNpcWalks` 为纯表现提示（不进指纹） |
| REQ-12.19 (P2-19) | 開局跳伞、船、標題音效、地塊彩边、GO 钮态 | 各资源 | — | — | U-10/11/1/14 | 过场可跳过 ｜ ✅ 已做（T-048/049/050） |
| REQ-12.20 (P2-20) | 語音 | `Speaking.mkf` 1374 段 | 事件 | — | `rich4_player_say_on_events.asm` | 先解索引再接触发点 ｜ ✅ 2026-09-15 完成（T-051/T-052）：語音號 = `1050 + 27×角色 + 事件`（@VA 0x0048084a，全表 324 项无例外）；触发点接线 22 个槽位 |
| REQ-12.21 (P2-21) | 存档落文件 + 读原版 SAVE | Tauri fs | `serializeGame` | — | — | 6 槽 + 自动存档 ｜ ✅ 已完成（T-053/T-054） |
| REQ-12.22 (P2-22) | Windows / Linux 构建 | Tauri | — | — | — | CI 三平台 ｜ ✅ 已完成（T-055/T-056）；⚠️ 本机 macOS 打不出 Windows/Linux 包，真机验收要 CI 跑一次 |
| REQ-12.23 (T-085 ✅) | **開局設定屏（選角色／選地圖）** | **`jump.mkf` 资源 8（22 张拼件）+ 资源 `globalMapId`（整屏场景）+ `Data.mkf` 资源 2（12 张 72×72 头像）**；侧视走动画 = `jump.mkf` 资源 `9 + 角色×3 + 行進方式` | 开局参数：人数／资金／载具／土地權限 | `newGame({initialFund, startingVehicle, landTenure})` | S1 | 角色格 440×155@(4,10)、竖栏 192×461@(445,10)；**地图名/OK/EXIT/六个值框全烧在竖栏整图里**（舞台 0 图 1、舞台 1 图 21）；13 条控件表 @0x46cc18、六个浮窗表 @0x46cc88；场景横滚 + 半亮（换算表 −16 @0x485d68）；点角色=占座位，点 OK 后空座位由電腦随机补齐 |

- **每屏的统一实现步骤（初级程序员照做）**
  1. 用 `tools/disasm.py find "<屏上的一句文字>"` 找到字串 VA → `xref` → 那个 UI 函数的 VA；记进文件头 `@source`。
  2. 从该函数里抄出**每个控件的 (x, y, w, h) 与资源号**（`push x / push y / push 资源`）；不许目测。
  3. 在 `scenes.ts` 登记资源号；在 `interactions.ts` 把 `pending` 翻成 `InteractionUi`；在 `dialog.ts` 或新文件里画。
  4. 每个可点区域一个 `hitXxx(x, y)` 纯函数 + 单测；命中后只做一件事：`dispatch(action)`。
  5. 对照 `docs/original-screens.md` 的截图判读逐项核对，把差异写进 `docs/original-ui.md`。

- **状态**：约 65%；22 屏待做（P2 **最后做**）。

---

### MOD-13 `packages/desktop` —— Tauri 壳

- **职责**：开窗、把 `assets/game/` 的 mkf 与 25 首配乐打进 `.app/Resources/`、暴露文件读写给 client。**零规则**。
- **API（Tauri command）**：`read_asset(name) → bytes`、`read_save(slot) → string|null`、`write_save(slot, text)`、`list_saves()`；client 通过 `host.ts` 调用，浏览器模式下降级为 `fetch`/`localStorage`。
- **约束**：C-LEG-3 双击即跑；外部目录读取保留为兜底。C-PERF-3 冷启动 < 3s。
- **状态**：macOS arm64 可用；Windows/Linux 见 REQ-12.22。

---

### MOD-14 `packages/server` —— 联机服务器（步骤 3）

- **职责**：**服务器权威**。每个房间持有一份 core 镜像状态 + `Sequencer`；客户端只发**意图**（`intent{action}`），服务器校验后编号广播；随机数只在服务器消耗（客户端的 `rngState` 通过重放同步）。
- **已实现（2026-09-14，T-070..T-073）**：`hub.ts` `RoomHub`（与传输无关：`connect(conn) → ClientHandle{onMessage,onClose}`，`sweepDisconnected(now)`），`ws-server.ts` `startWsServer(opts)`（运行时动态 import `ws`）。协议新增 `join.since?`、`{t:'start'}`（房主开局，空座补电脑）、`SeatInfo.connected?`；`Sequencer.submitSystem` / `Room.submitSystem` 承载服务器发起的 `setAi`（掉线超时託管、重连归还）；`Room.fingerprintAt(seq)` 供 checksum 比对；轮到电脑座位时服务器用 core 的 `decideAction` 代打直到轮回真人。
- **现有 API（`room.ts`）**
  - `new Room({ id, map, globalMapId, seed, seats })`；`start()`；`submit(seat, action) → { ok, broadcast{seq, action} } | { ok:false, reason }`；`since(seq)`（重连补发）；`fingerprint`；`currentSeat`。
  - `submit` 的 `apply` 回调 = `reduce(mirror, action) !== mirror`，**非法 action 不占序号**。
- **REQ-14.1 WebSocket 服务（`index.ts`）**
  ```
  onConnection(ws):
    on 'join'{version, room, name}:
      if version != PROTOCOL_VERSION → error
      r = rooms.get(room) ?? create(room)
      seat = r.assignSeat(name)      // 重连：同名且断线中 → 复用原 seat
      send joined{seat, room: r.info()}; broadcast room{...}
      if r.started: for b in r.since(0): send action{b.seq, b.action}   // 全量重放即重连
    on 'intent'{action}:
      res = r.submit(seat, action)
      if !res.ok → send error{reason}
      else broadcast action{seq, action}
    on 'checksum'{seq, hash}:
      if hash != r.fingerprintAt(seq) → broadcast desync{seq, expected, got, seat}
    on close: r.markDisconnected(seat); startAiTakeoverTimer(seat, 30s)
  ```
- **REQ-14.2 客户端联机模式（client 侧，`net-client.ts` 新）**
  ```
  connect(url, room, name)
  onServer 'start'{seed, globalMapId, seats}: state = newGame({seed, map, players: seats})
  onServer 'action'{seq, action}:
    乱序 → 先攒着，凑齐再按序施加（WS 是可靠有序流，缺号只会来自重连，
                           而重连走 join{since} 补发，不必单独请求）
    seq == nextExpected 时 dispatchLocal(action)   // 与单机同一条 reduce
    every 10 seq: send checksum{seq, stateFingerprint(state)}
  本地输入: 不直接 dispatch；send intent{action}，等服务器回 action 再 dispatch（服务器权威）
  本地预测（可选）: 掷骰动画先播，结果以 action 为准
  ```
- **REQ-14.3 AI 补位**：掉线 30s 后服务器把该座位标 `kind:'computer'`，由服务器用 `decideAction` 为其产 action（走同一条 `submit`）；重连后归还。
- **REQ-14.4 大厅 UI**：建房/加房/座位/角色/地图/开始；断线提示与重连按钮。
- **验收**：4 台机器跑完整局；任意玩家断线重连状态一致（fingerprint 相同）；同种子联机与单机逐字节一致；延迟 < 200ms（同城）。
- **约束**：C-LEG-5 私人小圈子、不分发素材。

---

### MOD-15 `tools/` 与 `docs/` —— 逆向工具与知识库

- `tools/disasm.py`：`va <VA> <len>`（反汇编）、`dump <VA> <len>`（字节）、`find <hex>`、`xref <addr>`（谁引用）、`callers <VA>`。字符串用 `/tmp/strs.py`（BIG5，DELTA = 0x00463ac0 − 401600）。
- `docs/original-screens.md`（13 张实机截图判读，画面最终裁判）、`docs/original-ui.md`（需求方口述 U-1..U-19）、`docs/player-struct.md`（玩家结构 0x68 字节逐字段）、`docs/known-deviations.md`（Q/D 登记册）、`docs/reverse-engineering-audit.md`（rich4-re 的 8 处错误）、`docs/map-format.md`、`docs/money-flow.md`、`docs/assets.md`。
- **规则**：解出新字段 → 当次提交同步文档（C-ENG-6）。

---

## 4. 跨模块契约

### 4.1 `PendingInteraction` ↔ 响应 ↔ 场景

| `pending.kind` | 产生于 | 合法响应（`InteractionResponse` / `Action`） | 场景资源（`scenes.ts`） |
|---|---|---|---|
| `buyLand{landId,name,price}` | 落在无主地 | `buyLand` / `declineDecision` | 通用对话框 |
| `upgradeLand{landId,cost}` | 落在自己的地 | `upgradeLand` / `declineDecision` | 通用对话框 |
| `buyFacility{facilityId,price}` | 无主設施 | `buyFacility` / `declineDecision` | 通用 |
| `buildFacility{facilityId,choices[]}` | 买下后首建 | `buildFacility{facilityType}` / `declineDecision` | 通用（REQ-12.14） |
| `upgradeFacility{facilityId,cost,level}` | 自己的設施 | `upgradeFacility` / `declineDecision` | 通用 |
| `chooseBuildTarget{commercialId,choices[],charge}` | 建設公司董事長 | `buildTarget{entityId}` | 通用 |
| `bank{...}` | 銀行 | 响应 `bankDeposit/Withdraw/Borrow/Repay/FinanceBorrow/FinanceRepay{amount}`，对应 Action `bank{op,amount}` / `decline` | `#23` |
| `lottery{available,price,owned}` | 樂透 | `lotteryBuy{number}` / `decline` | `#12` / `#15` |
| `auction{entityId,basePrice,bidders}` | 拍賣 | `auctionBid{winner,price}` | `#26` |
| `buyShares{...}` | 上市企業 | `buyShares{shares}` / `decline` | `#76` |
| `shop{cards[],tools[]}` | 百貨 | `shopBuyCard/BuyTool/SellCard/SellTool` / `decline` | `#10` |
| `minigame{kind}` | 三个小游戏格 | `minigameScore{score|null}` | `#80` / `#91` / mkf 11/19/22 |
| `bail{slots[]}` | 監獄/醫院 | `bail{slot}` / `decline` | `#63` / `#65` |
| `unimplemented{place,options?}` | 尚未实现的场所 | `decline` | — |

规则：**一个 pending 只接受表里列出的响应**（`responseMatches`），其他 action 返回原 state。

### 4.2 卡片/道具目标（`CardTarget`，REQ-06.1 扩后）

```
{ kind: 'none' }
{ kind: 'player',   index }                 // 0..3；anyPlayer 类含自己
{ kind: 'entity',   entityId }              // 地块 id（现状）
{ kind: 'facility', facilityId }            // 新
{ kind: 'stock',    index }                 // 新，紅/黑卡
{ kind: 'object',   objectIndex }           // 新，請神符（1 基）
{ kind: 'actor',    actor }                 // 新，4..8 四大惡人/機器娃娃（REQ-05.1）
{ kind: 'node',     nodeId }                // 放置类道具（路障/地雷/定時炸彈）
```

### 4.3 存档文件（MOD-03 `serializeGame`）

```json
{ "magic": "RICH4-REMAKE", "version": 1, "savedAt": "<外部注入，core 不读>",
  "state": { ...GameState 全量，含 rngState、pending、snapshots }, "history": [Action...] (可选) }
```
读档 = `deserializeGame` → 校验 magic/version → 直接作为 `state`。**不做迁移**：版本不同即拒绝（`SaveFormatError`），需要时再写 `migrate(v→v+1)`。

### 4.4 联机消息时序

```
C→S join{version,room,name}        S→C joined{seat,room}; S→all room{...}
房主 start                         S→all start{seed,globalMapId,seats}
C→S intent{action}                 S: room.submit → S→all action{seq,action}  |  S→C error{reason}
C→S checksum{seq,hash}（每 10 步）  S: 不一致 → S→all desync{seq,expected,got,seat}
断线重连：join 同名 → joined + 从 since(0) 全量重放（或 since(lastSeq)）
```

### 4.5 素材寻址

`SpriteCache.get(archive ∈ {Data.mkf, Panel.mkf, map.mkf, jump.mkf}, resource, image)`：
先查 `assets/hd/<archive>/<resource>-<image>.png`（锚点已 ×4），缺则解码原 mkf。角色精灵：`resource = 0x80 + character×21 + pose`，方位图 `directionalImage(count, screenDir, frame)`。

**hd 路径只有一处定义**：`@rich4/assets-pipeline` 导出的 `hdRelativePath(archive, resource, image)`
（写侧 `assemble.ts`、读侧 client 的 `SpriteCache` 共用，两边各写一份字符串迟早对不上）。
`<archive>` 是 mkf 主名（`Data`/`Panel`/`map`/`jump`），`<resource>`/`<image>` 均为**十进制、无前导零**。
产物由 T-063 的 `assemble` 步骤写出（`assets/hd/` 已 gitignore，不入库）。

---

## 5. 剩余需求总表（与 §11 一一对应）

| REQ | §11 | 模块 | 交付物 | 验收（可自动化的部分） |
|---|---|---|---|---|
| REQ-05.1 | P0-11 | core/rules, cards | `CardTarget{actor}`；控制卡/路障对 NPC | 4 卡 × 4 NPC 测试 |
| REQ-05.2 | P0-12 | core/rules | `+14/+15` 写入点 | 测试或 Q-NPC-2 登记 |
| REQ-06.1 | Q-CARD-2 | core/cards | 7 张卡接线 + 目标扩类 | 30 卡各两条测试 |
| REQ-09.1 | P1-4 | core/ai | 股票打分 | 3 局面手算一致 |
| REQ-09.2 | P1-5 | core/ai | 调度顺序复核 | 每步一条测试 |
| REQ-09.3 | P1-6 | core/ai | AI 研發 | 测试 |
| REQ-12.1..22 | P2-1..22 | client | 22 屏 | 每屏 hit 函数单测 + 截图核对 |
| REQ-11.1 | 步骤 2 | assets-pipeline | 批量超分回填 | ingest 校验；性能约束 |
| REQ-14.1..4 | 步骤 3 | server, client | WS 服务、联机客户端、AI 补位、大厅 | 4 机完整局；重连一致；同种子一致 |

**顺序**（需求方拍板）：REQ-05/06/09（逻辑） → REQ-12（画面，最后） ；REQ-11 与 REQ-14 可并行，但 REQ-11 等 REQ-12 定稿哪些图上屏。

---

## 6. 新人上手：从零实现一条规则的完整走法（示例：REQ-09.3 AI 研發）

1. **定位**：`python3 tools/disasm.py find "<研究所屏上的字串 BIG5 hex>"` → 得 VA → `xref` → UI 函数 → 找 `cmp byte [player+0x15], 2`（电脑分支）。
2. **读汇编，写伪代码**到函数头注释（带 VA），列出每个分支的条件与数值。
3. **写纯函数**：`rules/facility.ts` 里 `aiPickResearchProject(level, ...)`，只收需要的参数。
4. **接 reducer**：`reduce.ts` 的 `startTurn` 里已有 `aiStartResearch` 调用点，换成新函数。
5. **写测试**：每个分支一条；随机的写同种子重放一致。
6. `pnpm check` 三绿 → 更新 `DEVELOPMENT_PLAN.md` §11 打勾 → 提交（message 写 VA）。
7. 解不出的部分：`docs/known-deviations.md` 开一条 `Q-LAB-2`，写明看到了什么、卡在哪。

**禁忌**：在 client 里写 `if (level > 3)` 之类的规则；用 `Math.random`；用浮点算钱；靠 wiki 填数；把「顺延到下一张卡」之类的偏差静默吞掉。

---

## 7. 测试策略

| 层 | 工具 | 内容 | 门槛 |
|---|---|---|---|
| 数值 | `binary-truth.test.ts` | 表与 exe 逐字节比 | 全绿 |
| 单元 | 各 `*.test.ts` | 每条分支 | core 覆盖率 ≥ 80% |
| 契约 | `registry.test.ts`、`interaction` 测试 | 每卡/每道具/每 pending 的合法与非法响应 | 每卡每道具 ≥ 1 |
| 重放 | `full-game.test.ts` | 同种子同序列逐字节一致；soak 多种子跑完整局不卡死 | 1000 局 |
| 联机 | `room.test.ts` + 新 e2e | 非法不占序号；重连 fingerprint 一致 | 全绿 |
| 表现 | `hit*` 单测 + 截图人工核对 | 每屏可点区域 | 与 `original-screens.md` 一致 |

---

## 附录 A · 任务卡片

本文的每条 `REQ` 已拆成原子卡片：`docs/tasks/cards.yaml`（来源）/ `docs/tasks/cards.md`（可读版）。
卡片字段与用法见 `docs/tasks/README.md`；`python3 tools/task-cards.py next` 列出可开工的卡。

## 附录 B · 文件速查

| 想改什么 | 去哪 |
|---|---|
| 一张卡的效果 | `core/cards/<卡>.ts` + `registry.ts` 的 case |
| 一件道具 | `core/rules/tool-effects.ts` |
| 落点结算 | `core/state/reduce.ts` 的 `landOnLand/landOnFacility/landOnCompany/landOnSpecial` |
| 某场所的数值 | `core/places/<场所>.ts` |
| AI 出牌/用道具判定 | `core/ai/card-policy.ts` / `tool-policy.ts` |
| 一屏的布局 | `client/<屏>.ts`（坐标常量在文件头，带 @source） |
| 音效编号 | `assets-pipeline/src/audio.ts` 的 `SOUND_IDS` |
| 存档格式 | `core/loaders/savegame.ts` |
| 联机协议 | `core/net/protocol.ts` |

## 附录 C · 版本记录

- v1.0（2026-09-14）：首版。对应 `DEVELOPMENT_PLAN.md` v1.3。
- v1.1（2026-09-14）：附录 A 挂接原子任务卡片（`cards.yaml` 现 73 张）。
