# Q-TOOL-1 放置類道具（路障 / 地雷 / 定時炸彈）的表现层偏离登记

> 需求方 2026-09-16 原话：
> 「使用道具地雷/定时炸弹/路障的**提示音错误**，而且也**没有从人物身上丢到目标点的动效**，
>  另外**放置后目标点应该也要看到这3个道具的样子**才对」
>
> 三件道具的编号（对着 `packages/data/src/tools.ts` 核过）：
> **路障 = 2、地雷 = 3、定時炸彈 = 4**；落点都是**棋盘上的格子**
> （`core/state/preview.ts` 的 `canUseTool` + 拾取模式 T-026）。
> 它们对应的**地图物件种类**是 **16 / 17 / 18**（`core/rules/tool-effects.ts` 的
> `PLACEMENT_TOOLS`，@source 三个 `use_tool_*` 的 `push 0x10/0x11/0x12`）。

本文件按「① 音效 ② 投掷动效 ③ 棋盘上的图」三条给出取证与落码，
末尾列**本轮没解出/没做**的项。

---

## ① 提示音 —— 三个号，全是 `Effect.mkf` 的资源号

### 取证

三个 `use_tool_*` 在 **`place_object` → `animate_object` 之后**（即动画播完）
各放一声：

| 道具 | 调用点 | 表项 | `[表项]` |
|---|---|---|---|
| 路障(2) | VA **0x00446c58** `push 0x48236a` / 0x00446c5d `call 0x4542ce` | 10 | **33** |
| 地雷(3) | VA **0x00446d39** `push 0x482372` / 0x00446d3e `call 0x4542ce` | 11 | **34** |
| 定時炸彈(4) | VA **0x00446e1a** `push 0x48235a` / 0x00446e1f `call 0x4542ce` | 8 | **10** |

- `rich4_play_sound_effect`（VA 0x004542ce）在 **0x004542d8** 读 `[eax]`（eax = 传入的
  表项指针）当音效号 —— 所以 `0x48236x` 这种 `ref_` 就是**表项地址**，不是编号。
- 表基址 `0x48231a`，**8 字节一项**：`+0` = `Effect.mkf` 的资源号、`+4` = 运行时
  填进去的声音对象。后者由 `rich4_init_sound_effect_info`（VA **0x00454176**）填：
  `mov ecx,[ebx]` / `cmp ecx,-1 / je 结束` / `read_mkf(Effect.mkf, ecx)`（句柄在
  `[0x48a058]`）/ `mov [ebx+4], eax`。于是 `(addr − 0x48231a) / 8` 就是表项号，
  `[表项]` 就是音效号 —— 这同时把旧注释里「编号与 `Effect.mkf` 资源号是否直接相等
  **尚未验证**」那条**结案**：相等。
- 三件的号实测 = 33 / 34 连号，定時炸彈借用了 **10**（与掷骰同一号，
  `0x41962a` 也是 `push 0x48235a`）—— 这是原版的实际取值，不是抄错。
- 表里 0x482362（表项 9）= 32 也是「放置」类附近的一个号，但**没有**任何调用点
  指向它，故不采用。

### 现状为什么「听错了」

引擎在这条路上**一声都没放**：拾取目标那一下放的是「选中目标」音效 **2**
（`_rich4_select_instance_callback` VA 0x0044666a 的 `push 0x48232a`，这条本身是对的），
之后**没有**落地音。所以需求方听到的「提示音错误」= 少了这三个号。

### 落码

- `packages/assets-pipeline/src/audio.ts`：`SOUND_IDS` 加
  `PLACE_BARRIER: 33` / `PLACE_MINE: 34` / `PLACE_TIMEBOMB: 10`，
  另加 `PLACE_TOOL_SOUND`（道具号 → 音效号：2→33、3→34、4→10），全部带 `@source`。
- `packages/client/src/main.ts`：`startObjectFlight` 记下该放的号，
  **动画播完**才 `sound.play('Effect.mkf', id)`（原版顺序：动画 → 收尾停 100 ms → 音效，
  见 ② 的 `_rich4_animate_object`），与 exe 一致。
- 单测：`packages/assets-pipeline/src/audio.test.ts` 钉住三个号与映射表。

---

## ② 投掷动效 —— 从角色身上丢到目标格

### 取证（`_rich4_animate_object` VA 0x0040e669）

调用形状（三件逐字相同，只差物件种类 0x10/0x11/0x12 与音效号）：

```asm
00446c01  push 0 / push 0 / push ebx / push 0x10   ; place_object(种类, 目标格, 0, 0)
00446c08  call _rich4_place_object                  ; eax = 物件 handle（下标 + 1）
00446c12  push 0x64                                 ; arg6 = 100 ms 收尾停顿
00446c26  movsx edx, word [目标格 + 2] / push edx   ; arg5 = 目标格 y
00446c2b  movsx eax, word [目标格]     / push eax   ; arg4 = 目标格 x
00446c3f  push 玩家 y（player + 0xa）
00446c4c  push 玩家 x（player + 0x8）
00446c4d  push ecx（handle）
00446c4e  call _rich4_animate_object
```

函数本体（`rich4_animate_object.asm` / 本机反汇编逐条核过）：

| 规格 | 值 | @source |
|---|---|---|
| 两端点换算成屏幕坐标 | 各调一次 `fcn_00409a23`，**只做这一次** | 0x0040e6c4 起 |
| 帧数 | `trunc(√(Δx²+Δy²) × 0.125 + 1)`（常量 `0x46324c` = `0x3E000000` = 0.125f） | 0x0040e73c..0x0040e754 |
| 每帧时长 | **24 ms**（`timeGetTime` 补到 `0x18`） | 0x0040e987 / 0x0040e98c..0x0040e994 |
| 插值 | 屏幕坐标**线性等分**：`step = Δ/N`；首帧就是 `起点 + step`，**第 N 帧正好落在终点** | 0x0040e770/0x0040e780/0x0040e794/0x0040e7a8 + 0x0040e9a0..0x0040e9b8 |
| 画什么 | 物件自己那套图 `[type×4 + 0x49692c]`，图号 = `8 − 视角 + 朝向`（`& 7`） | 0x0040e682..0x0040e696 / 0x0040e699 / 0x0040e6a1 |
| 收尾 | `sleep(arg6 = 100 ms)`，**之后**调用方才放落地音、才 `refresh_screen` | 0x0040e9bd / 0x00446c58 起 |
| 叠放次序 | **不走绘制槽**（直接贴屏幕）⇒ 恒压在所有立体物之上 | 全函数无 `0x48a84c` 写入 |

★ 「第一帧已离起点一步、最后一帧正好在终点」是原版 `curX = fromX + stepX` 再进循环
造成的；`packages/client/src/tween.ts` 的 `framesFor` 是同一个公式（那边是走子）。
★ 与走子补间**不是**同一个函数：走子走 `fcn_0040c05c`，速度表 `[8,12,16,8]` 像素/tick、
**没有 +1**；`animate_object` 是道具专用（26 个调用点全在 0x442xxx~0x446xxx）。
（这一点 `tween.test.ts` 的文件头也记过。）

### 落码

- 新增 `packages/client/src/throw-fx.ts`（纯表现，**不进 `GameState`**，C-DET-4）：
  `throwFrameCount` / `throwFrameAt` / `throwTotalMs` / `makeObjectFlight` /
  `flightPosAt` / `flightDone` + ③ 的图集与朝向。
- `packages/client/src/render.ts`：`RenderInput.objectFlight`（可选）、
  `#drawObjectFlight` 画在**绘制槽排序之后**（照原版「恒在最上层」）；
  飞行期间把那一件从静态槽里**藏掉**（`objectTokens(..., hidden)`），
  模拟原版「动画期间棋盘不重绘 ⇒ 同一件不会同时出现在格子上」。
- `packages/client/src/main.ts`：`applyAction` 里识别「这一次 `useTool` 真的放下了一件」
  → `startObjectFlight`（两端点开播前换算成屏幕坐标、帧数定死一次）→
  `tickObjectFlight` 在 rAF 里逐帧续帧 → 播完 `finishObjectFlight` 放音。
  另外让 `holdForActorWalk` 在动效期间也挡住自动驱动（原版这一段是**阻塞**的）。
  ★ 退化情形照抄：**起点就是落点**（把路障放在自己脚下）时原版在 VA 0x0040e6f2
  直接返回（两轴位移都为 0）⇒ **一帧都不画、那 100 ms 也不停**，紧接着就放音；
  这一支也照做了。
- 单测：`packages/client/src/throw-fx.test.ts`（帧数公式、线性等分、24 ms/100 ms 节拍、
  第一帧与末帧位置、播完判据）。

---

## ③ 放置后棋盘上那张图

### 取证

**图集**（`_rich4_load_map` VA 0x004080b2 起）：

```asm
xor ebx, ebx
loc_004080b2:
  lea eax, [ebx + 0x18c]              ; ★ 资源号 = 0x18c + i
  push eax / push [0x48a0e4]          ; [0x48a0e4] = Data.mkf 句柄
  call _read_mkf
  mov [ebx*4 + 0x496930], eax         ; ★ 存进物件图集表下标 i+1（表基址 0x49692c）
  inc ebx / cmp ebx, 0x14 / jl loc_004080b2
```

读图两处都按**物件种类**查同一张表：绘制槽 VA 0x00408f4b/0x00408f52、
投掷动画 VA 0x0040e699/0x0040e6a1 ⇒ **资源号 = `0x18c + 种类 − 1`**：

| 种类 | 道具 | `Data.mkf` 资源 | 目视 |
|---|---|---|---|
| 16 | 路障 | **411** (0x19b) | STOP 牌（8 向各 1 张：正面/两个侧面…）|
| 17 | 地雷 | **412** (0x19c) | 刺球 |
| 18 | 定時炸彈 | **413** (0x19d) | 带表的炸药捆 |

（读 `Data.mkf` 411/412/413 各解出 **8 张 SPR**，与「8 向各 1 帧」吻合；
锚点是 `graph_st` 自带的 `(x, y)`，例如 40×33 那张是 `(20, 22)` —— **不是**图心，
所以绘制必须减 `anchorX/anchorY`，不能自己按 width/2 算。
`assets-clean/manifest.json` 里这三条的 `anchorX/anchorY` 与 SPR 表头逐条相同。）

**什么时候画、画哪张**（`fcn_0040829d` 的物件那一段，VA 0x00408f78 起）：

```asm
00408f82  cmp word [objects_info[i] + 2], 0   ; nodeId == 0 → 不在地图上，跳过
00408f8c  cmp byte [objects_info[i] + 6], 0   ; 也不在「飞行中」→ 跳过（见 ③ 的未解项）
00408f95  mov dh, byte [objects_info[i] + 5]  ; attached（附身于谁）
00408f9f  test dh, dh / je loc_00408e0e       ; ★ 附身的走另一支：画在**主人身上**
loc_00408e0e（放在地上的）:
           esi/edi = 节点屏幕格；越出 0..0x1c（28）窗口 → 整条跳过
00408ee2  mov al, 8 / sub al, [0x499088] / add al, [objects_info[i] + 1] / and al, 7
           ; ★ 图号 = 8 − 视角 + 朝向（`objects_info[i] + 1` 由 place_object 写入）
00408f4b  mov al, byte [objects_info[i]]      ; 种类
00408f52  mov eax, [type*4 + 0x49692c]        ; ★ 图集
00408efd  edx = 屏幕Y << 4 / and 0xfff0 / + 槽号 << 16
           ; ★ **不 or 类别** ⇒ 与建筑同一档（`DRAW_CLASS.building`）
00408f60  mov byte [槽 + 0x48a852], 0xff       ; 不换归属色
```

朝向 `+1` 由 `_rich4_place_object` 写入（VA 0x0040e0e4..0x0040e10a）：
取节点**4 个邻接槽里第一个非 0** 的邻格，再 `fcn_00407a8c(邻格, 本格)`
= `rich4_calculate_direction(本格 − 邻格)` ⇒ **物件面朝来路**。
（`0x00454fb4` 与 core 的 `directionOf` 同源。）

### 现状为什么「看不到」

`packages/client/src/render.ts` 里此前**一处都没读 `state.objects`**
（`grep objects` 零命中）—— 棋盘上从来不画任何地图物件，不只是这三件道具。

### 落码

- `packages/client/src/render.ts` 新增纯函数 `objectTokens(state, nodes, view, hidden)`
  与 `ObjectToken` 类型，`#objectSlots` 把它转成绘制槽（类别 `DRAW_CLASS.building` = 0，
  与建筑同一条按屏幕 Y 排的清单），图号走 `objectImageIndex`（= `assets.ts` 的
  `screenDirection`，不写第二份），锚点减 `anchorX/anchorY`，资源从 `Data.mkf` 取。
- 单测：`packages/client/src/render.test.ts` 新增 8 项 —— 三件道具的 411/412/413、
  用节点坐标、`nodeId==0` 不画、附身不画、飞行中藏起来、图号随视角回绕、
  越界跳过、神明（396..409）也在同一份清单里。

---

## 本轮**没解出 / 没做**的（如实登记）

| # | 项 | 现状 | 依据 / 下一步 |
|---|---|---|---|
| 1 | **附身于人**的物件（`attached != 0`）画在主人身上 | **已做（Q-TOOL-5 ②）**：新增纯函数 `attachedObjectTokens` + `#attachedObjectSlots`，`objectTokens` 那一行未动 | `fcn_0040829d` VA 0x00408f95..0x00408cd9 那一支用主人记录里的 `+8/+0xa` 当落点、并且主人 `+0x32` 那个 dword 非 0（住店/坐牢/住院/消失）时整个不画。偏移表 0x474951 / 0x474991、帧 = 图号 + 4 —— 全部落码并登记在 `Q-TOOL-5.md` |
| 2 | 「動畫過程」设定关掉时投掷动画播不播 | **恒播**（有意） | `_rich4_animate_object` 整支读过，**没有任何开关检查**，三个调用点也没有。走子补间那边原版是有关卡的（见 `tween.ts` 的 `enabled`），这条却找不到 ⇒ 按 exe 恒播。要改需要先找到 cfg offset 1 的读取点 |
| 3 | 「物件自己在飞」那套（`objects_info + 6` 计数 + `+8/+0xc` 浮点坐标 + `+0x10/+0x14` 步长） | **没做** | 它由 `fcn_0040fafd`（VA 0x0040fafd）起，**全 exe 只有一个调用点**：`rich4_player_core_actions.asm` 的 0x0041b519，条件是 `[0x49910c] == 8`（機器娃娃那一支），参数是 `special_players_state + 68/70`（= 機器娃娃 tool 开跑时存下的玩家**节点号 / 上一节点号**，@source `rich4_tool_jiqiwawa.asm` 0x00446b7x），飞完再 `remove_object`。与本轮三件道具**无关**（那三件走 `animate_object`）。将来做機器娃娃搬东西时再解 |
| 4 | 起点取的是**角色所在格心**，不是原版的**实时像素坐标** | 有意简化 | exe 读 `player + 0x8/+0xa`（走子补间中途是插值位置）。本引擎取 `map.nodes[player.nodeId−1]`；使用道具时角色就停在格上，两者相同。只有在**走子补间还没播完就点用道具**时才会差几十像素（而且那时下一个 dispatch 本来就被 `holdForActorWalk` 挡住）|
| 5 | 帧节拍用 rAF 按时间取帧，不是阻塞 sleep(24−已用时) | 等价实现 | exe 是阻塞主循环；浏览器里不能阻塞。`k = floor((now − start)/24) + 1` 与「每帧至少 24 ms」等价，收尾那 100 ms 也算在 `throwTotalMs` 里，故音效时刻一致 |
| 6 | `state` 里没有物件**朝向**字段，朝向是渲染时**当场推**的 | 有意 | core 不改规则（`MapObject` 只有 type/nodeId/state/attached）。推法与 `place_object` 逐条同规则（第一个非 0 邻接槽 → `directionOf(本格 − 邻格)`）。四个槽全 0 的孤立格原版算的是「从 0 号空节点出发」，无意义，这里退回 0 |
| 7 | 另外 23 个 `animate_object` 调用点（卡片/神明那一批飞行动画） | **已做 20 个（Q-TOOL-5 ①）**，3 个接不了（core 没有那种目标） | 23 个点逐条登记在 `throw-fx.ts` 的 `CARD_FLIGHT_SITES`（25 行 / 23 个 VA，每行带 VA、闸门、arg6、方向），`cardFlightPlan` 是纯判据。没接的 3 条与理由见 `Q-TOOL-5.md` 的 ⑤ |
| 8 | 原版动画期间的**脏矩形擦除**（`fcn_00456469` / `rich4_rect_union`） | 不需要 | 那是「直接往主表面画」才需要的；本引擎每帧整幅重绘 |
