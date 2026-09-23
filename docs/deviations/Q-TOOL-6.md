# Q-TOOL-6 機器工人（9）的**表現層** + 研究所名牌第三行 —— 取証、落碼與殘留

> 上一轮把**规则**与**拾取落点**结了两条：
> - `docs/deviations/Q-TOOL-4.md` 残留项 ⑤-6：「**表現層未接**：大锤动画
>   （`data_mkf` 资源 `0x229`）、滿 5 级那一下（资源 `0x20b`、`0x40b0cd`）、
>   以及 `0x41d476` 的落点」；
> - `docs/deviations/Q-HOVER-1.md` 残留项 ①：「**研究所**（設施 type 4）第三行
>   『开发出来的东西』没画 —— 要 `facility+0x1e` / `+0x1d` 两个字节，
>   而 core 的 `FacilityInfo` 没收这两个字段」。
>
> 本轮把这两条做掉。
>
> ⚠️ **编号说明**：`Q-TOOL-1`（飛彈爆风近似）、`Q-TOOL-2`（傳送機搬設施，已结案）、
> `Q-TOOL-3`（核子飛彈 AI 判定不接线）、`Q-TOOL-4`（機器工人规则+拾取，已结案）
> 都被占用；开工时 **`Q-TOOL-5` / `Q-TOOL-6` 在 `docs/` 与 `docs/known-deviations.md`
> 里都没有引用**（`grep -rn "Q-TOOL-5\|Q-TOOL-6" docs/` 无命中），
> 故本条取 **Q-TOOL-6**，把 **5** 留给并行的另一位 agent ——
> 收工时 `docs/deviations/Q-TOOL-5.md` 确实已由卡片飞行那一位建好
> （它的文件头也写着「`Q-TOOL-6` 是并行的另一位 agent 的機器工人建屋影片」），**没有撞号**。

判据一律 `python3 tools/disasm.py`（全量反汇编在 `../rich4-re/asm/`），每条带 VA。

---

## ① 大锤动画：`read_mkf(data_mkf, 0x229)`

调用序列就是 `rich4_use_tool_jiqigongren`（**VA 0x00447295**）的后半段：

```asm
004472f2  push 9 / push 当前玩家 / call 0x445aa2       ; take_tool —— 先扣道具（0x004472fb）
0044730e  call 0x40af12                                ; 取该实例记录的坐标（给 0x41d476 的镜头用）
00447316  push 0 / push 0 / push 0x229                 ; ★ 大锤影片 = Data.mkf 资源 0x229
0044731f  mov ebp, [0x48a0e4] / push ebp / call 0x450441
          ; ★ read_mkf(Data.mkf, 0x229, 0, 0)
0044733c  call 0x41d476                                ; 镜头/落点（见 ④）
00447345  call 0x40b110                                ; ★ 效果本体：等级 +1 —— **在影片之前**
0044734d  mov dword [esp], eax                         ; ★ 存返回值（bit7 = 刚满 5 级）
00447350  push 0x5b / push 0x2c0001 / push 0x28 / push 0 / push esi / call 0x45144f
          ; ★ 播大锤：f(影片, x=0, y=0x28, flags=0x2c0001, 音效=0x5b)
0044736d  test byte [esp], 0x80 / je 0x447378
00447373  call 0x40b0cd                                ; ★ 刚盖到 5 级 → 再播一段
00447378  call 0x41d546                                ; refresh_screen
```

### 1.1 帧数 / 节拍 / 播多久 —— 全在**资源头**里

`Data.mkf` 的 0x229、0x20b 都是**标准 Autodesk FLIC（FLC）**，不是本引擎那套
SPR/SMP 精灵表。播放器 `fcn_0045144f`（VA 0x0045144f）这样读头：

```asm
00450d00  cmp word [eax + 4], 0xaf12      ; ★ FLIC 魔数
00450d10  mov dx, word [eax + 6] / mov [0x48c86c], edx   ; 帧数
00450d1c  mov dx, word [eax + 8] / mov [0x48c878], edx   ; 宽
00450d28  mov dx, word [eax + 0xa] / mov [0x48c87c], edx ; 高
00450d72  mov edx, [eax + 0x10] / mov [0x48c870], edx    ; ★ 每帧毫秒（speed）
00450d7b  add eax, 0x80                                  ; 帧数据起点
```

逐字节核过（`Rich4/Data.mkf`，资源号 0x229 = 553 / 0x20b = 523）：

| 资源 | 帧数（+6）| 宽×高（+8/+a）| 每帧（+0x10）| **总长** | 音效（arg5）|
|---|---|---|---|---|---|
| **0x229**（大锤）| **68** | 440×440 | **57 ms** | **3876 ms** | `Effect.mkf` **0x5b = 91** |
| **0x20b**（剛滿 5 級）| **66** | 440×440 | **42 ms** | **2772 ms** | `Effect.mkf` **0x5a = 90** |

帧的数据块类型也认得出：`0x0045103b..0x004510a6` 分派 `4 / 7 / 0xc / 0xf / 0x10`
= `FLI_COLOR256 / FLI_SS2 / FLI_LC / FLI_BRUN / FLI_COPY` —— 标准 FLIC 的块型。

### 1.2 落点与锚点：**整块 440×440 棋盘，不是那一格**

两段的 arg2/arg3 都是 `push 0x28`（y）+ `push 0`（x）→ **屏幕 (0, 40)**，
也就是棋盘左上角（`stage.ts` 的 `LAYOUT.board = {x:0, y:40, w:439, h:440}`），
在**棋盘局部坐标里就是 (0, 0)**：

```asm
00450d32  mov [0x48c830], edi     ; edi = arg2 = x
00450d38  mov [0x48c834], esi     ; esi = arg3 = y
00450d3e  [0x48c838] = x + 宽
00450d4d  [0x48c83c] = y + 高
00450e1f..00450e3c  [0x48c84c] = 2 × (440 × (y − 0x28) + x)
          ; ★ 后台面（640×480、16bpp、每行 1280 字节）里的**字节偏移**
```

所以影片**原地**盖在整块棋盘上，**锚点就是影片自己的左上角 (0,0)**
（帧是整幅 440×440）。被盖住的那块地盘靠 `fcn_0041d476`（VA 0x0041d476）
先把镜头对准选中的实例 —— **影片内容固定在画面里**，随镜头走的是它下面的棋盘。

### 1.3 节拍：一帧等 `speed` 毫秒，**播完就停**（不循环、不重复、也打断不了）

```asm
00451513  cmp esi, dword [0x48c870]    ; esi = 这一帧已经等了多久
00451519  jae 0x45151f                 ; 等够了 → 进下一帧
0045151b  test ebx, ebx / je 0x4514b7  ; 没被打断 → 继续重画这一帧
0045117d  edx = [0x48c874] / inc edx / mov [0x48c874], edx   ; ★ 帧号 +1（0 基）
0045118a  cmp edx, [0x48c86c]          ; == 帧数 → 收场
00451194  cmp byte [0x48c883], 0       ; flags bit2 = 循环？（这两段都是 0）
004511b1  [0x48c844] = (flags >> 8) & 0xff   ; 重复次数（这两段都是 0）
```

两段的 flags（arg4）分别是 `0x2c0001` 与 `1`，**低字节都是 0x01**：
bit1（`[0x48c880]` = 「按键/点击可打断」，认 `0x202`/`0x205`/`0x101`，
VA 0x004514d6）**为 0**，bit2（循环）、bit3、以及 byte1（重复次数）
也全 0。⇒ **两段都只看一遍，而且点不掉**（原版这 3.9 s + 2.8 s 是强制看完的）。

### 1.4 什么时候播

| 时机 | 判据 |
|---|---|
| **先结算、后播片** | `0x00447345 call 0x40b110`（等级 +1）在 `0x0044735c call 0x45144f`（播大锤）**之前** |
| 大锤 `0x229` **恒播** | 只要选到了目标（`0x004472ea test ebx,ebx / je` 之后就是这一条）|
| `0x20b` 只在**刚满 5 级**时接 | `0x0044736d test byte [esp], 0x80` → `0x00447373 call 0x40b0cd` |
| bit7 **只有地块**那支置位 | `0040b169 cmp cl, 5 / jne / or al, 0x80`；設施那支 `0040b1f4 mov eax,1 / inc byte [ebx+0x1a]` **没有** `or al, 0x80` ⇒ 設施盖到满级**不播** `0x20b` |
| 两段**串行**、中间无缝 | `0x40b0cd` 在大锤**返回之后**才调（原版 `fcn_0045144f` 是阻塞的）|
| 全部播完才刷新屏幕 | `0x00447378 call 0x41d546` |

`fcn_0040b0cd`（VA 0x0040b0cd）全文：

```asm
0040b0ce  push 0 / push 0 / push 0x20b / push [0x48a0e4] / call 0x450441  ; read_mkf
0040b0e8  push 0 / push -1 / call 0x40829d      ; ★ 镜头复位到 (0, -1) 并重画棋盘
0040b0f4  push 0x5a / push 1 / push 0x28 / push 0 / push ebx / call 0x45144f
0040b105  push ebx / call 0x456e11              ; free
```

**答「`0x00447378` 的 `refresh_screen` 在本引擎对应什么」**：
`fcn_0041d546`（VA 0x0041d546）只做两件事 —— `[0x48be18] = 0`（清「要滚动」标记）
与 `fcn_0041906a(1)`；后者（VA 0x0041906a）往棋盘窗口发 **`WM_PAINT`（msg 0xf）**
强制重画。**在本引擎里就对应「下一帧 `requestAnimationFrame` 重绘」**：
棋盘本来就每帧整幅重画，不需要额外一拍，所以没有额外的代码。

### 1.5 音效

arg5 = `Effect.mkf` 的资源号（`0x454304` 从 `[0x48a058] = _rich4_effect_mkf`
读它，`0x45434f` 起播；实测两份都是 RIFF/WAVE）：

- 大锤 = **0x5b = 91** @source VA 0x00447350；
- 滿級 = **0x5a = 90** @source VA 0x0040b0f4。

播放起点是**每段影片的开头**（VA 0x004514ad 在首帧之前起播）。

---

## ② 研究所名牌第三行：`facility + 0x1d` / `+0x1e`

### 2.1 这两个字节是什么

**写入**（研究员开工那一下，VA 0x004411e9 附近，業主停在自己的研究所）：

```asm
004411e9  bl = byte [edi + 0x1a]        ; 研究所等级
004411ec  dec ebx / cmp ebx, -1 / je 0x43f212   ; 等级 0 → 跳过（盖不了）
004411f6  inc bl
004411f8  mov byte [edi + 0x1d], bl     ; ★ 研發項目 = 研究所等级（1..5）
004411fb  mov byte [edi + 0x1e], 5      ; ★ 倒计时 = 5 天
```

**每日推进 / 完工发货**（VA 0x0041cd8c..0x0041ce2f）：

```asm
0041cd97  ebx += 0x38 / cmp esi, num_facilities / jg 结束
0041cdaf  cmp byte [ebx + 0x18], 4 / jne 下一个        ; 只看研究所
0041cdb4  cl = byte [ebx + 0x1e] / test cl, cl / je 下一个  ; ★ 0 = 没在研發
0041cdc3  edx = byte [ebx + 0x19] / cmp edx, 当前玩家+1 / jne 下一个
0041cdca  al = byte [ebx + 0x1d] / cmp al, byte [ebx + 0x1a] / ja 作废
0041cdd6  设施.+0x1e = cl − 1 / jne 下一个
0041ce18  al = byte [ebx + 0x1d] / add eax, 8 / call _rich4_receive_tool
0041ce2f  作废: 设施.+0x1e = 0
```

⇒ 语义：

| 字节 | 名字 | 取值 |
|---|---|---|
| `+0x1d` | **研發項目下标** | `1..5`（= 开工时的研究所等级）；0 = 没在研發 |
| `+0x1e` | **剩余天数** | 开工写 **5**、每日 −1；**0 = 没在研發** |

**名牌浮标怎么用它们**（`fcn_00417559` 的 type 4 那一支，VA 0x00417a86）：

```asm
00417a86  push 2 / add ebx, 0x12 / 画 类别名（表 0x475150）      ; 第一行
00417aa4  push 2 / add ebx, 0x12 / 画 等级名（表 0x475164）      ; 第二行
00417ac2  cmp byte [edi + 0x1e], 0
00417ac6  je  0x417bfe                                          ; ★ 没在研發 → 只两行
00417ace  push 2 / add ebx, 0x12                                ; 第三行
00417ad3  mov al, byte [edi + 0x1d]
00417ad8  mov ebx, dword [eax*8 + 0x47ff1a]                     ; 名字（当普通串画）
00417adf  jmp 0x4179d9                                          ; 无格式串，flag 2 正中
```

### 2.2 名字表 `0x47ff1a` 其实是 `_tool_table + 56`

`0x47ff1a` **不是一个独立的名字表**，而是 `_tool_table`（0x47fee2）**从道具 8 起**
那 6 行（每行 8 字节 `{char *name; uint8 init; uint8 price; uint8 f6; uint8 f7}`）：

- `0x47fee2 + 8 × 7 = 0x47ff1a`；
- 实测那 6 个 dword 依次指向 `遙控骰子 / 機器工人 / 時光機 / 傳送機 / 工程車 / 核子飛彈`
  = **道具 8..13**（与 `0x0041ce18` 的 `add eax, 8` 严丝合缝）；
- 每项第二列不是指针，是 `{init, price, f6, f7}` 四个字节 ——
  遙控骰子那行 = `0x00011e0a` = `{10, 30, 1, 0}`，与
  `rich4-re/asm/rich4_tool_table.c` 的 `{ "\xbb\xbb...", 10, 30, 1, 0 }` 逐字对上。

⇒ 本引擎的 `FACILITY_DEV_NAMES` 就是 `TOOLS[7..12].name`，
`node-tip.test.ts` 有一条断言钉住它不会与 `@rich4/data` 漂移。

### 2.3 文本怎么拼、落点、字体

- **拼法**：没有格式串，第三行就是表里那个字符串本身（`jmp 0x4179d9` 直接当名字画）。
- **落点**：行距 `0x12`（与第一、二行同），即第三行 `dy = 0x12 × 3 = 0x36`；
  有主时业主名占 `dy = 0`，其余整体照排。横坐标与字体沿用名板那一套
  （`create_font(0x10, 0xf0f0f0, 0x101010, 3, 1)`，VA 0x00417722，flag 2 = 正中）。
- **画不画**只看 `+0x1e != 0`（**不看** `+0x1d` 是否合法）。

---

## ③ 改在哪

| 文件 | 内容 |
|---|---|
| `packages/core/src/loaders/map.ts` | `FacilityInfo` 加两个**选填**字段 `researchProject?` / `researchDays?`（照 `CommercialInfo.facing` 的写法），解析处从 `+0x1d`/`+0x1e` 填 |
| `packages/client/src/build-fx.ts`（新） | 纯函数：两段影片的规格、帧序、总长、「大锤→滿級」的推进、bit7 判据、取帧 |
| `packages/client/src/build-fx.test.ts`（新） | 17 项，含「与真 `Data.mkf` 资源头逐字节一致」 |
| `packages/client/src/main.ts` | `buildFx` 状态位 + `pendingBuildFx`（等解码）+ `buildFlicNow`（懒解，复用 `SpriteCache.getFlic`）+ `startBuildFx`（挂在 `useTool` 那条路上，联机广播与 AI 同路）+ `tickBuildFx`（挂在 `requestRender`；**解完才起时间轴**、翻片时放掉上一段）+ `holdForActorWalk` 期间等它播完 + 失步自愈时收摊 |
| `packages/client/src/render.ts` | `RenderInput.buildFx`（一张图）+ 画在绘制清单**最后**、常数落点 `(0, 0x28)`、440×440 |
| `packages/client/src/node-tip.ts` | 設施那一支改读 **state** 的归属/等级/种类（模板兜底）+ 研究所第三行 |
| `packages/client/src/node-tip.test.ts` | 施設那一条改成显式给 state；新增研究所 6 条 + 名字表一致性 1 条 |
| `packages/core/src/loaders/map.test.ts` | 2 条：`+0x1d/+0x1e` 被解析（8 张地图恒 0）与「与手算偏移一致」 |

**为什么設施那一支要改成读 state**：设施种类/等级是**开局后盖出来的**，
地图模板里 `type` 恒 0、`level` 恒 0（实测八张地图**一处 type 4 都没有**），
照模板读永远落在「空  地」那一支 —— 研究所第三行根本到不了。
改法与 `board-screen.ts` 的 `state.facilityLevel[e.index] ?? f.level` 完全一致。

---

## ④ 测试

```
npx vitest run packages/client/src/node-tip.test.ts packages/core/src/loaders packages/client/src/build-fx.test.ts
npx tsc -b --pretty
npx eslint <改过的 .ts> --max-warnings=0
```

| 文件 | 项数 | 重点 |
|---|---|---|
| `build-fx.test.ts` | 17 | 资源号/落点/音效/帧数节拍；帧序（57 ms 一拍、钉在最后一帧）；总长 3876/2772；大锤→滿級的**串行**与第二段起点；bit7 判据；**与真 `Data.mkf` 的资源头逐字节一致** |
| `node-tip.test.ts` | 41 | 新增：研究所三行、`+0x1e == 0` 只两行、六个名字逐项、下标越界给空串、有主时整体下移、模板兜底、名字表 ≡ `TOOLS[7..12]` |
| `map.test.ts` | 31 | 新增 2 条：`+0x1d/+0x1e` 被解析、与手算偏移一致 |

---

## ⑤ 没解出 / 有意不做 / 仍存的偏离

| # | 现象 | 取证 / 原因 | 处置 |
|---|---|---|---|
| 1 | 原版**选到目标就扣道具**，盖不动也照样播大锤（`0x004472fb` 在 `0x00447345` 之前）| 见 `Q-TOOL-4.md` ⑤-2 | 本引擎只在**真正生效**时收道具，于是「没生效」时**不播**。UI 不会把盖不动的地列成候选，观察不到差别 |
| 2 | `fcn_0041d476`（把镜头**对准选中的实例**）没接线 | VA 0x0041d476：把目标屏幕坐标与当前玩家坐标比对，不同就记下目标并 `fcn_00416e6d(0)`/`fcn_00415e70(0)` 重画 | 本引擎的相机是人控的（拖拽/跟随），没有「强制把目标挪到画面中央」这条路。影片本身画在**棋盘左上角**、内容是固定的，所以只影响影片**下面**的棋盘构图 |
| 3 | `0x40b0cd` 内部先 `0x40829d(0, -1)` 把镜头复位再播 `0x20b` | VA 0x0040b0e8；`0x40829d` 把 `[0x48b2ac]/[0x48b2b0]` 置成 `(0, -1)` 并重画棋盘 | 同 2，未接线。**不影响影片本身**（影片落点是常数）|
| 4 | 影片 440 宽，但棋盘的离屏画布只有 **439** 宽 | `stage.ts` 的 `LAYOUT.board.w = 439`（原版棋盘区 440）；`boardCanvas.width = 439`（main.ts:3019）| **第 440 列被裁掉 1 个像素**。这是既有的棋盘宽度取整，不在本轮范围 |
| 5 | `fcn_0045144f` 的 flags 高位与「存背景/贴回」两条路径没实现 | `[0x48c85c] = (flags>>16)&0xff`（VA 0x00450dd7）、`[0x48c868]/[0x48c860]` 存 440×440×2 的背景再贴回（VA 0x00450dfd..0x00450e3c）| ~~那是原版直接往主表面画时的脏矩形处理，用不上~~ ⚠️ **2026-09-23 订正（第十四份試玩回報）**：这是**片中重画**——计数到 `[0x48c85c]` 那一帧 `0x004512bf call 0x40829d(-1,0)` 按**当前状态**重画棋盘，`0x456b3e`/`0x456ba5` 用差值缓冲把影片像素保留、透明处换成新棋盘。已实现：`board-film.ts` 的 `boardFilmRedrawFrame`/`boardFilmRedrawn` + `main.ts` 的 `applyBoardFilmRedraw`（警车开过人就没了、狗咬烟尘散开狗就没了）|
| 6 | 原版播片期间**整块棋盘不再重绘**，本引擎照常每帧重绘 | `fcn_0045144f` 是阻塞消息循环 | 观感一致（影片把棋盘盖住），但影片**下面**的棋盘会继续动（走子补间等）。另外 `holdForActorWalk` 会让 **AI 的下一步**等影片播完（对齐原版的阻塞），**人的输入不拦** |
| 6b | 影片解码是异步的，原版 `read_mkf` 是同步的 | 播放器 `fcn_0045144f` 拿到的已是解开的缓冲；本引擎要过 `SpriteCache.getFlic` → FLIC 解码 → 逐帧 `ImageBitmap` | 首次用要解 68 帧（≈半秒），故**解完才起时间轴、才响音效**（`pendingBuildFx`，main.ts 的 `tickBuildFx` ①）；取不到素材就整段放弃（只少一段动画，不会把 AI 卡住）。两段**一段一段解**，播完即 `close()`（一段 ≈ 52 MB），照原版 `read_mkf` → 播 → `libc_free` 的节奏 |
| 7 | 名牌浮标读 `+0x1d` **不检查下标范围** | `mov al, byte [edi+0x1d]` → `[eax*8 + 0x47ff1a]`，表只有 6 项（VA 0x00417ad8）| 原版越界会读表外内存；本引擎 `FACILITY_DEV_NAMES[project] ?? ''` 给空串 |
| 8 | 浮标现在读 **state** 的 `facilityOwner/Level/Type`（原版读实时记录）| 见 ③ 的说明 | 顺带修正；地图模板只在 state 缺项时兜底 |
| 9 | `+0x1d`/`+0x1e` 的**模板值**在真地图里恒 0 | 八张地图逐张核过（`map.mkf` 资源 `id*2+1`，`fac=off+i*0x38`）| 解析照样填（字段一定在），浮标以 `GameState.facilityResearchProject/Days` 为准 |
| 10 | 原版名牌浮标的**节点/景觀/企业/地块**几支没重核 | 与本轮两处缺口无关 | 沿用 `Q-HOVER-1.md` |

---

## ★ 2026-09-16 订正：影片贴的是**棋盘局部** (0,0)，不是屏幕 (0,0x28)

`BUILD_FX_Y = 0x28`（= 40）是**屏幕**坐标（原版 `push 0x28 / push 0`），
而 `BoardRenderer` 的 ctx 是那块 **439×440 的棋盘离屏画布**
（`main.ts` 的 `boardCanvas`，最后 `stageCtx.drawImage(boardCanvas, 0, 40)`）。
先前渲染器直接把它当棋盘局部 y 用 ⇒ 整段 440×440 影片**下移 40 px、底部 40 px 被裁**。

现在渲染器用新常量 **`BUILD_FX_BOARD_Y = 0`**（= 0x28 − 40），
`confine-fx.test.ts` 的「渲染器按棋盘局部画建屋影片」与
`build-fx.test.ts` 的落点那条一起钉住两个坐标系的差。
