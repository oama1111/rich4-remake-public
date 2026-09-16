# Q-TOOL-5 其余 23 个 `_rich4_animate_object` 调用点 + 附身物件的绘制

> 来源：`docs/deviations/Q-TOOL-1.md` 的「本轮**没解出 / 没做**的」第 **1** 条
> （附身于人画在主人身上）与第 **7** 条（另外 23 个 `animate_object` 调用点）。
> 上一轮 Q-TOOL-1 只接了路障/地雷/定時炸彈三件（VA 0x00446c4e / 0x00446d2f /
> 0x00446e10），并把纯函数（`throwFrameCount` / `makeObjectFlight` /
> `flightPosAt` …）留在 `packages/client/src/throw-fx.ts` 里。本轮**复用**那一套，
> 不另写第二份。
>
> ⚠️ **编号说明**：`Q-TOOL-1`（放置類道具的动效）、`Q-TOOL-2`（傳送機搬設施）、
> `Q-TOOL-3`（核子飛彈 AI 判定）、`Q-TOOL-4`（機器工人修房子）都已被占用
> （见 `known-deviations.md` 与同目录的 `Q-TOOL-*.md`），故本条为 **Q-TOOL-5**
> （`Q-TOOL-6` 是并行的另一位 agent 的機器工人建屋影片）。

取证一律用 `python3 tools/disasm.py`（全量反汇编在 `../rich4-re/asm/`），
每个常量带 `@source VA`。

---

## ① 把 23 个调用点列全

```
$ python3 tools/disasm.py callers 0x40e669
# call 0x0040e669 的调用点，共 26 处
```

26 个点 = **3 个放置類道具**（上一轮已接）+ **23 个**（本轮）。26 个点全部在
`0x004422xx..0x00446exx`，即**卡片函数**与**道具函数**，别处没有。

### 1.1 23 个点只有两种形状

**形状 A —— 卡片飞行（22 个点）**

```asm
imul eax, dword [0x49910c], 0x68        ; 出牌者
cmp  byte [eax + 0x496b7d], 1           ; who_plays == 1（纯人类）？
je   跳过整段                             ; ★ 人类不播
push 0x64                                ; arg6 = 100 ms 收尾停顿
push <目标 y> / push <目标 x>             ; arg5 / arg4
push <出牌者 y> / push <出牌者 x>          ; arg3 / arg2（eax + 0x496b72 / +0x496b70）
push 0                                   ; ★ arg1 = 0 ⇒ handle == 0
call 0x40e669
```

`arg1 = 0` 是关键：`_rich4_animate_object` 在 **VA 0x0040e6b9** 有一支专门处理它：

```asm
loc_0040e6b9:
  xor ebp, ebp                      ; ★ 帧号恒 0
  mov edi, dword [0x49697c]         ; ★ = 物件图集表下标 19 = 物件**种类 20**
  lea ebx, [edi + 0xc]              ; 第 0 帧的 graph_st
```

- `0x49697c = 0x49692c + 20*4`（读表那一侧是 `[type*4 + 0x49692c]`，VA 0x0040e6a1）
  ⇒ **种类 20**；`_rich4_load_map`（VA 0x004080b2）读的是 `0x18c + 19` = **415**。
- 实测 `assets-clean/Data/0415_000.png`：**20×26、只有 1 张**（一张卡片），
  锚点 `(10, 13)`（正中心）。⇒ 那些点画的就是「一张卡片从出牌者飞向目标」。
- `xref 0x49697c` 全 exe **只有 0x0040e6bb 一处** —— 这张图就是为这一支准备的。

**形状 B —— 神明飞回主人（1 个点，請神符 VA 0x00444efa）**

```asm
00444e92  eax = esi - 1                          ; esi = 神明 handle（下标+1）
00444e9e  edi = word [objects_info[eax] + 2]      ; 神明所在**节点号**
00444ea8  mov word [objects_info[eax] + 2], 0     ; ★ 先从地图上摘掉
00444ebe  push 0                                  ; ★ arg6 = 0（不是 0x64）
00444ec9  push <出牌者 y>                          ; arg5  ← ★ 终点是出牌者
00444ed1  push <出牌者 x>                          ; arg4
00444ef0  push <神明节点 y> / push <神明节点 x>     ; arg3 / arg2  ← ★ 起点是神明
00444ef9  push esi                                ; ★ arg1 = handle（不是 0）
00444efa  call 0x40e669
00444f02  mov word [objects_info[eax] + 2], edi   ; 写回节点号
00444f18  call 0x40ead7                           ; attach_object(出牌者, 节点, 神明)
```

⇒ 方向与原版其余各点**相反**：**神明从它所在的格飞到出牌者身上**，
飞完才附身；飞行期间它不在图上（`nodeId = 0`）。

### 1.2 逐点判断：哪张卡 / 什么目标 / 什么条件

**闸门**：22 个卡片点里 **20** 个带 `cmp byte [curplayer + 0x496b7d], 1 / je 跳过`。
「1 = 人类」不是猜的 —— 同一条函数**开头**就是这个字段的另一个用法：

```asm
; 拆除卡 VA 0x00443b1f（路障 VA 0x00446bd9 逐字相同）
00443b1f  cmp byte [eax + 0x496b7d], 1
00443b26  jne 0x443b34
00443b28  push 0xe0c0626 / call 0x446ae8   ; ★ 人类 → 弹「選目標」模态，用鼠标挑
00443b34  push edi / call 0x41e6f2          ; 非人类 → AI 参数
```

`rich4-re/asm/rich4_player_info.h:23` 也写着「低2比特 0: not alive, **1: human**,
2: computer；比特2为1表示被托管」。
⇒ **闸门 = 「出牌者是纯人类就不播」**，比的是**整字节**
（人类 + 被托管 = `0x05` ≠ 1 ⇒ **照播**）。本条**照抄**，不改良。

| # | 调用点 VA | 卡片 | 飞向 | `who_plays==1` 时 | arg6 | 本引擎接了吗 |
|---|---|---|---|---|---|---|
| 1 | 0x004422d6 | 2 均貧卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 2 | 0x004427b3 | 4 換地卡（打地块） | 那块**地** | 跳过 | 100 | ✅ |
| 3 | 0x00442a01 | 4 換地卡（打設施，`0xe0c0204`） | 那个**設施** | 跳过 | 100 | ❌ core 不收 |
| 4 | 0x00442c81 | 5 換屋卡（打地块） | 那块**地** | 跳过 | 100 | ✅ |
| 5 | 0x00442e9c | 5 換屋卡（打設施） | 那个**設施** | 跳过 | 100 | ❌ core 不收 |
| 6 | 0x0044301c | 6 轉向卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 7 | **0x0044360f** | 9 天使卡（打地块，同區批量） | 那块**地** | ★ **照播** | 100 | ✅ |
| 8 | 0x0044369f | 9 天使卡（打設施） | 那个**設施** | 跳过 | 100 | ✅ |
| 9 | 0x0044383b | 10 惡魔卡（打地块，同區批量） | 那块**地** | 跳过 | 100 | ✅ |
| 10 | 0x00443905 | 10 惡魔卡（打設施） | 那个**設施** | 跳过 | 100 | ✅ |
| 11 | 0x00443a6a | 11 怪獸卡（地块/設施**共用这一段**） | 那笔记录 | 跳过 | 100 | ✅ |
| 12 | 0x00443bf1 | 12 拆除卡（打地块，同區） | 那块**地** | 跳过 | 100 | ✅ |
| 13 | 0x00443cbd | 12 拆除卡（打設施） | 那个**設施** | 跳过 | 100 | ✅ |
| 14 | 0x00443d8f | 12 拆除卡（打**地圖物件**，`handle & 0x8000`） | 那件**物件** | 跳过 | 100 | ❌ core 不收 |
| 15 | 0x00443ef7 | 13 搶奪卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 16 | 0x00444050 | 14 停留卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 17 | 0x004442aa | 16 夢遊卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 18 | 0x00444591 | 17 陷害卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 19 | **0x00444efa** | 23 請神符 | **神明 → 出牌者**（反向） | ★ **照播** | **0** | ✅ |
| 20 | 0x004452c6 | 26 查稅卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 21 | 0x00445576 | 27 漲價卡（地块/設施**共用这一段**） | 那笔记录 | 跳过 | 100 | ✅ |
| 22 | 0x004457e0 | 29 同盟卡 | 目标**玩家** | 跳过 | 100 | ✅ |
| 23 | 0x004459af | 30 烏龜卡 | 目标**玩家** | 跳过 | 100 | ✅ |

**接了几种**：23 个点里 **20 个接了**（共 22 行 —— 怪獸/漲價各一行服务两种目标），
3 个接不了（见 ⑤ 的 1/2/3 条）。

★ 「怪獸卡」「漲價卡」只有一个调用点：两条分支（地块 / 設施）**汇到同一段动画**，
`ebx`/`edi` 就是那笔记录 —— 所以表里给它们各登记两行、`va` 相同。

★ 「天使卡打地块」那一支**没有闸门**（VA 0x0044360f 之前只有选目标那次比较，
`xref 0x496b7d` 在本卡函数范围内只命中 0x004434d3 与 0x00443672 两处，
前者选目标、后者是**設施**那一支）。原版就是不对称的，照抄。

---

## ② 落码

- `packages/client/src/throw-fx.ts`（**纯函数**，全部带 `@source`）：
  - `CARD_FLIGHT_TYPE = 20` / `CARD_FLIGHT_IMAGE = 0` / `CARD_FLIGHT_NO_OBJECT = -1`；
  - `flightAllowed(whoPlays)` —— 那条闸门；
  - `CARD_FLIGHT_SITES` —— **25 行 / 23 个 VA** 的完整登记表（每行带 `va` /
    `humanSkips` / `settleMs` / `reversed` / `supported`）；
  - `cardFlightPlan(query)` —— `GameState` + `useCard` 的 target → 一段飞行的纯规格
    （起点/终点世界坐标、飞卡片还是飞神明、收尾停顿、要藏起来的那一件）；
  - `ObjectFlight` 新增可选的 `image`（卡片恒第 0 帧）与 `settleMs`
    （請神符是 0，其余 100）；`throwTotalMs(frames, settleMs?)` 的第二个参数有缺省值，
    原有调用点不受影响。
- `packages/client/src/render.ts`：
  - `#drawObjectFlight` 用 `flight.image ?? objectImageIndex(facing, view)`；
  - 新增纯函数 `attachedObjectTokens` 与私有 `#attachedObjectSlots`（见 ③）。
- `packages/client/src/main.ts`：
  - 把原来 `startObjectFlight` 的尾部抽成 `beginObjectFlight`（两端点换算 +
    「两点重合就一帧都不播」那一支，VA 0x0040e6f2），两条路共用；
  - 新增 `startCardFlight(before, action)`，挂在 `applyAction` 的 `useCard` 上；
  - ★ **同时挂到 `scheduleAi` 的直路**上：电脑那条是绕开 `applyAction` 自己
    `reduce` 的，而这条动效按 exe 恰恰**只在非人类时播** —— 不补这一句，
    单机里一次都看不见。

---

## ③ 附身于人（`objects[i].attached != 0`）画在主人身上

### 取证（`fcn_0040829d` 的物件段，VA 0x00408f95 起）

```asm
00408f82  cmp word [objects_info[i] + 2], 0   ; nodeId == 0 → 不在地图上
00408f8c  cmp byte [objects_info[i] + 6], 0   ; 也不在「自己在飞」→ 跳过
00408f95  ebp = i * 24
00408f9f  dh = byte [objects_info[i] + 5]     ; attached
00408fa5  test dh, dh / je 0x408cd9           ; ★ == 0 → 走「放地上」那一支
          ; ── 以下是 attached != 0 的分支 ──
00408fad  eax = attached − 1                  ; 主人玩家下标
00408fb6  ownerBase = eax * 0x68
00408fbd  cmp dword [ownerBase + 0x496b9a], 0 ; ★ 主人 +0x32 起的**一个 dword**
00408fc4  jne 跳过                             ;   住宿/消失/坐牢/住院 任一非 0 → 不画
00408fc6  eax = word [ownerBase + 0x496b70]   ; ★ 落点 = 主人的 xpos/ypos（+0x8/+0xa）
00408fee  ecx = word [ownerBase + 0x496b72]
00408fd3  edx = eax >> 5 / sub edx, [esp+0x50] / lea esi, [edx+0xe]   ; 格列 − 镜头 + 14
00408fee  ecx = ecx >> 5 / sub ecx, [esp+0x4c] / lea edi, [ecx+0xe]   ; 格行 − 镜头 + 14
00408ff8..00409014  esi/edi 越出 0..0x1c（28）→ 跳过
00409026  call fcn_00407a2c                    ; 格内像素 → 屏幕坐标（与棋子本体同一套）
00409072  dl = byte [ownerBase + 0x496b78]    ; ★ 图号用**主人的**朝向（+0x10）
00409078  eax = 8 / sub eax, [0x499088] / add eax, edx / and eax, 7
00409088  [esp+0x54] = eax                    ; 图号（也是偏移表的下标）
0040908c  dl = 图号 / add dl, 4 / and dl, 7
004090a2  mov byte [槽 + 0x48a853], dl        ; ★ 槽 +7 = 真正贴的**帧号**
004090a9  cmp byte [objects_info[i]], 0x12    ; 种类 == 18 定時炸彈？
004090b0  jne 0x408c65
004090ba  cmp byte [ownerBase + 0x496ba7], 0  ; ★ 主人 +0x3f = god_info，非 0？
004090c1  je 0x408c65
004090cb  eax = dword [esi*8 + 0x474991]      ; → 换**外圈**那张偏移表
00408c69  eax = dword [esi*8 + 0x474951]      ; （普通）屏幕 Y += dy
00408c74  eax = dword [esi*8 + 0x474955]      ; 屏幕 X += dx
00408f4b  al = byte [objects_info[i]]         ; 图集 = [种类*4 + 0x49692c]，与放地上同一张表
```

**偏移表**（`python3 tools/disasm.py dump 0x474951 16 4`，每项 8 字节 = `{dy, dx}`）：

| 图号 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| dy | −10 | −22 | −22 | −10 | 10 | 22 | 22 | 10 |
| dx | −22 | −10 | 10 | 22 | 22 | 10 | −10 | −22 |

有神那张（0x474991，8 项之后）是同样的八边形、半径放大到 **18/44**。

**结论**（本轮实现的就是这一条）：附身物件
1. 落点 = **主人的**屏幕坐标（原版读 `+0x8/+0xa`，走子补间中途是插值位置）；
2. 再加 `表[图号]` 的屏幕偏移，**图号 = `8 − 视角 + 主人朝向`**（不是物件自己的朝向）；
3. 真正贴的**帧 = `(图号 + 4) & 7`**（神明**背对**主人 —— 偏移那一圈它站在主人
   面朝的方向上）。对照：放地上的物件写的是 `+7 = 图号`（VA 0x00408ef2），正好差 4；
4. `定時炸彈(18)` 且主人 `god_info != 0` → 换外圈那张表；
5. 主人 `+0x32` 那**四个字节**（住宿/消失/坐牢/住院）任一非 0 → 整个不画。
   ★ **冬眠（+0x36）不在那个 dword 里**，所以冬眠中的人身上照样画着神明
   —— 与 `isBlocked()` 不是同一条判据，实现时没有复用它。

### 落码

- `throw-fx.ts`：`ATTACHED_OFFSETS` / `ATTACHED_OFFSETS_WITH_GOD` /
  `attachedImageIndex` / `attachedFrameIndex` / `attachedOffset` / `attachedOwnerVisible`。
- `render.ts`：纯函数 `attachedObjectTokens(state, view, hidden)`（判据全在这里，
  逐条带 `@source`）+ `#attachedObjectSlots`（只摆位：用 `#walkScreen ?? worldToScreen`
  拿主人的屏幕点，再加偏移，与建筑同一档排序）。
- 「放地上」那一路（上一轮的 `objectTokens`）**一行没动** —— 两条互斥
  （同一个 `attached` 判据的两面），不会画两遍。

---

## ④ 测试

```
npx vitest run packages/client/src/throw-fx.test.ts packages/client/src/render.test.ts
```

- `throw-fx.test.ts`：
  - **表不许缺项**：23 个 VA 一个不少一个不多（对着 `callers 0x40e669` 的 26 减 3），
    3 个道具点不在表里，只有 2 处没有闸门，只有請神符反向且 arg6 = 0，
    3 行标 `supported:false`；
  - **该起/不该起**逐种交互一条：9 张「打玩家」的卡（电脑播 / 人类不播）、
    7 张「打地块」、5 张「打設施」、天使卡打地块**人类也播**、
    請神符（人类也播 + 反向 + 停顿 0 + 藏哪一件）、3 支不支持的、
    `actor/stock/node/none` 一律不起、不需要目标的 13 张卡没有调用点、
    目标位置查不到就不起、两端点重合时**本函数照样给规格**（退化由 exe/调用方挡）；
  - 附身那两张偏移表、`图号 = 8−视角+主人朝向`、`帧 = 图号+4`、
    炸弹+有神 → 外圈、主人可见性那 4 个字节（冬眠不算）。
- `render.test.ts`：
  - `attachedObjectTokens` 的清单、资源号、**跟着主人走**（落点取主人的 nodeId，
    物件记录里的 nodeId 不参与；主人换格 ⇒ 跟着换，而 `objectTokens` 仍不画它）、
    帧号随视角/朝向、偏移随图号转、主人住店/坐牢等不画而冬眠照画、
    炸弹+有神换外圈、飞行中藏起来、`attached==0` / 主人越界 / 种类越界跳过。

---

## ⑤ 没做 / 有意偏离（逐条）

| # | 项 | 现状 | 依据 / 下一步 |
|---|---|---|---|
| 1 | **換地卡打設施**（VA 0x00442a01，`0xe0c0204`，与地块那一支互斥） | ✅ **已接**（2026-09-16，Q-CARD-1 那一轮）：`targetClassOf(0xe0c0202, standing='facility')` → `'facility'`；registry 的 `case 4:` 有設施分支，调 `applySwapFacilityCard`（只换 owner，@source VA 0x00442a09）| 用例：`swap-and-stock.test.ts` 的「换地卡 · 設施分支」（`:62`）。先前那句「core 的规则缺口」已过期 |
| 2 | **換屋卡打設施**（VA 0x00442e9c，同上） | ✅ **已接**（2026-09-16）：同一条分支的 `else` 调 `applySwapHouseFacilityCard`（换 type + level，@source 助手 `0x40b4f8` 設施分支 VA 0x0040b880）| 同上 |
| 3 | **拆除卡打地圖物件**（VA 0x00443d8f，`test byte [esp+1], 0x80` ⇒ `esi = (handle & 0x7f00) >> 8` = 物件下标，随后 `call 0x40e14d` = `remove_object`） | ✅ **已接**（2026-09-16）：`0xe0c0626` 归为 `'landFacilityOrObject'`，registry 的 `case 12:` 有 `target.kind === 'object'` 分支，调 `applyDemolishObjectCard`（只收 `DEMOLISHABLE_OBJECT_TYPES` = 路障/地雷/定時炸彈，@source VA 0x00446528）| 用例见 Q-CARD-1 §3 的 `land-cards.test.ts` / `registry.test.ts` |
| 4 | **控制类卡对特殊棋子**（轉向 6 / 停留 14 / 烏龜 30，目标 `{kind:'actor'}`） | **不起动效**（有意） | 原版这一段把 `0x40d293` 解出的位下标**当玩家下标**用（`imul edx,edx,0x68` + `player + 0x8`，VA 0x00442fe8 起）。actor = 4..8 时那是 `0x496b68 + 4*0x68 = 0x496d08` = **物件表**，读到的是「物件自己在飞」的那几个浮点字段 ⇒ 坐标无意义。原版是**越界读**，不复制 |
| 5 | **人类出牌不播这段动效** | **有意照抄 exe**（20/22 个卡片点如此） | 判据是 `cmp byte [curplayer + 0x496b7d], 1 / je`，而同一个字段在同一条函数开头被用来分「人类弹模态选目标 / AI 取参数」，1 = 人类两端互证。若要改成「人类也播」，那是**有意偏离**，改 `CARD_FLIGHT_SITES` 的 `humanSkips` 即可 —— 但本轮按铁律照 exe |
| 6 | 卡片图集的**朝向** | 不适用（有意） | `handle == 0` 那一支 `xor ebp, ebp`，恒第 0 帧；资源 415 也确实只有 1 张图。所以卡片没有「朝向」这一说 |
| 7 | 物件的**朝向字段** | 現推（有意） | 原版 `objects_info[i] + 1` 由 `place_object` 写入（VA 0x0040e0e4 起）。`MapObject` 里没有这个字段（core 不改规则），故按同一条规则当场推（`objectFacing`，与「放地上」那一路共用）。請神符飞行取的是**神明原节点**算出来的朝向 |
| 8 | 原版「**物件自己在飞**」那套（`objects_info + 6` 计数 + `+8/+0xc` 浮点坐标） | 仍未做 | 见 `Q-TOOL-1.md` 的第 3 条：全 exe 只有機器娃娃那一支用到，与本轮的卡片/請神符无关 |
| 9 | 動畫過程设定关掉时播不播 | **恒播**（有意，沿用 Q-TOOL-1 的结论） | `animate_object` 整支没有任何开关检查，这 23 个调用点也没有 |
| 10 | 帧节拍用 rAF 按时间取帧 | 等价实现（沿用 Q-TOOL-1） | exe 是阻塞 sleep；`k = floor((now − start)/24) + 1` 与「每帧至少 24 ms」等价。`settleMs` 已参数化，請神符的 0 也照做 |
| 11 | 附身物件的**同格错开** | 不加（有意） | 原版落点就是「主人的像素坐标 + 偏移表」；本引擎 `#playerSlots` 里那个 `seen * 5` 是渲染层自己的 hack，没有对应的 exe 行为，故**不进**附身物的落点 |
| 12 | 绘制槽 `+7`（帧号）之外的槽字段 | 不建模 | `+0x48a850/51`（`0x8000 | 槽号<<8`、`|= 0x40` 那个标志）是原版给排序/贴图用的，本引擎的 `DrawSlot` 只需「图集 + 帧号 + 位置」，照旧 |
| 13 | 原版动画期间的**脏矩形擦除**（`fcn_00456469` / `rich4_rect_union`） | 不需要 | 那是「直接往主表面画」才需要的；本引擎每帧整幅重绘 |
| 14 | **AI 直路**（`scheduleAi` 自己 `reduce`，绕开 `applyAction`） | 本轮在这一条路上**补了一句** hooks | 不补的话，这条按 exe「只在非人类时播」的动效在单机里永远看不到。★ 同一条路上 `startObjectFlight` / `startBuildFx` **仍然只有 `applyAction` 那个钩子**（放置類道具由人类放置，影响小；機器工人两种来源都有）—— 这是引擎的一处结构问题，不是本轮的偏离，记在这里供汇总人参考 |

---

## ⑥ `Q-TOOL-1.md` 里对应的两条

| Q-TOOL-1 的未解项 | 本轮结论 |
|---|---|
| #1 附身于人画在主人身上 | **已做**（见 ③）。VA 0x00408f95 那一支整支读完：落点 = 主人的 `+0x8/+0xa`、偏移表 0x474951/0x474991、帧 = 图号 + 4、主人住店那四个字节的判据 |
| #7 另外 23 个 `animate_object` 调用点 | **接了 20 个**（25 行登记），3 个接不了（core 没有那种目标，见 ⑤ 的 1/2/3）。全 23 个点的 VA / 卡片 / 目标 / 闸门 / arg6 都在 ① 的表里 |
