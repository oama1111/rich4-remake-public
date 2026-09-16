# Q-SOUND-1 走子音效（`MOVE_SOUND`）的**时机与号** —— 一次订正 + 一个真缺口

> 需求方第 5 轮有一条「人物走子音效像**逐格**响」；上一轮接手的人查完把它读成
> 「exe 里是**一次移动只放一次**，本引擎逐格放是 bug」，写进 `Q-DOLL-1.md` 的
> **残留项②**，并只在 `known-deviations.md` 的 `Q-TURN-1 §5` 记了「已做」。
>
> 本轮回 exe 把这一套**从头读了一遍**（`fcn_0040d7c4` 的跳表逐项 + `fcn_0040dd1f`
> 的三支 + `fcn_0040c05c` 的全部 call），结论是：**原版就是逐格放**；
> 那条「一次移动只放一次」是**把 `fcn_0040d7c4` 跳表的 state 1 / state 2 读对调了**
> 造成的误读。本文件同时登记一个**真正**与 exe 不一致的缺口（同一段音频会叠加）。
>
> 代码落点：`packages/client/src/move-sound.ts`（本轮新增，纯函数）、
> `packages/client/src/main.ts` 的 `stepTick()` / `applyAction()`、
> `packages/client/src/audio.ts` 的 `SoundPlayer`、
> `packages/assets-pipeline/src/audio.ts` 的 `MOVE_SOUND`。

---

## 0. 一句话结论

**exe 的一次移动 = 「起步 Play 一次 + 每走完一格再 Play 一次 + 整趟走完 Stop」。**
号按 `traffic_method`（走路 44 / 機車 45 / 汽車 46 / 船 53），
`Stop` 用的就是**同一个索引** `[0x4749d4]`。
所以「走 5 格响 5 次」**不是** bug，原版一样响 5 次 —— 但原版**每一格都会把上一路
`Stop` 掉再 `Play`**，永远只有一路在响；本引擎的 `SoundPlayer.play()` 每次都新建
`BufferSource`、**从不停上一个**，汽車/機車那种 1.5 s / 2.7 s 的引擎声叠起来才是
听感上真正不对的地方（见 §4）。

---

## 1. 状态机全貌（★ 订正：上一轮把 state 1 / 2 对调了）

`fcn_0040d7c4`（VA 0x0040d7c4）每 tick 一次，跳表在 **VA 0x40d7b4**，4 项：

| `[0x498ea2]` | 跳表项 | 入口 | 干什么 |
|---|---|---|---|
| 0 | 0x0040d808 | `loc_0040d808` | **等待**：`[+5]` 倒计时（bit7 置位 = 本回合结束）|
| 1 | 0x0040d8d3 | `loc_0040d8d3` | **走子段**：`cmp [0x48baf8], 0 / jne →` 逐 tick `fcn_0040c05c()`；**剩 0 步时才 Stop** |
| 2 | 0x0040d975 | `loc_0040d975` | **掷骰段 + 每格移动音效**：数满走路帧 → 掷骰 → **Play** → `state = 1` |
| 3 | 0x0040da4b | `loc_0040da4b` | 落地事件 |

⚠️ `known-deviations.md` 的 **Q-TURN-1 §5** 写的是「走子段（state 1，VA 0x0040d8d3）」，
§3 写「掷骰段（state 2，VA 0x0040d975）」—— **这两句与跳表完全一致，没有错位，别改**。
错的是 `Q-DOLL-1.md` 残留项②里那句：「原版那个音效是**一次移动放一次**
（`fcn_0040d7c4` 的 state 1 → 掷完骰开始走那一下，走完 `Stop`）」——
它把 **state 1 的 `0x40d8dc` = Stop** 读成了「Play 那一下」，于是
「一次移动放一次」这个结论就跟着错了。
`Q-DOLL-1.md` 另一句「逐格那条音效（`fcn_0040d7c4` state 2，VA 0x0040d9f2）」
**是对的**（`0x40d9f2` 确实在 state 2，就是逐格那一下）。

跳表字节（`rich4.exe` 文件偏移 `0x400 + (0x40d7b4 − 0x401000) = 0xcbb4`，
与 `tools/disasm.py` 的 `SECTIONS` 同一套换算）：

```
0xcbb4  08 d8 40 00 | d3 d8 40 00 | 75 d9 40 00 | 4b da 40 00
        → 0x40d808    0x40d8d3      0x40d975      0x40da4b
```

---

## 2. Play / Stop 的**每一个**落点（VA 逐条）

先分清两个函数，上一轮的文件里混用过：

| 函数 | 语义 |
|---|---|
| **0x004542ce** | `rich4_play_sound_effect`（**放**）→ 取 `[表项]` 当 `Effect.mkf` 资源号 |
| **0x004542e9** | **停止**（`IDirectSoundBuffer::Stop`，vtable +0x48）|

索引全局 `[0x4749d4]`：**11 + traffic_method**（或 15 = 备用组，或 9 = 娃娃）。

### 2.1 号的来源（两处，算法相同）

```asm
; ── 掷骰段 state 2 尾（VA 0x0040d9bc 起）──
mov esi, [0x49910c]                 ; 当前玩家号
cmp byte [player34 + 0x498ea1], 0   ; 备用精灵组?
je  short loc_0040d9da
mov dword [0x4749d4], 0xf           ; → 索引 15
jmp 0x40d9f2
loc_0040d9da:
mov al, byte [player68 + 0x496b79]  ; ★ traffic_method = player + 0x11
and al, 3
add eax, 0xb                        ; → 11..14
mov [0x4749d4], eax
loc_0040d9f2:
push 1
eax = [0x4749d4] * 8 + 0x48234a     ; ★ 表 0x48234a，8 字节一项
push eax
call 0x4542ce                       ; ← rich4_play_sound_effect
```

`fcn_0040dd1f` 的 `state == 1` 支（VA 0x0040dda4..0x40dde1）是**同一段算法的复制**，
同样在 `0x40dde1` `call 0x4542ce`。

### 2.2 表 `0x48234a` 实测（`dump 0x48234a 120 4`，第一 dword = 资源号）

| 索引 | 表项 VA | 号 | 用处 |
|---|---|---|---|
| 2 | 0x48235a | **10** | 掷骰（`fcn_00419572` 的 `push 0x48235a`）|
| 3 | 0x482362 | **32** | 路障/取消那一路（`Q-DOLL-1` 里写作「另一个」）|
| **9** | 0x482392 | **38** | **機器娃娃**（`fcn_0040dd1f` 的 actor 8 支）|
| **11** | 0x4823a2 | **44** | **走路** |
| **12** | 0x4823aa | **45** | **機車** |
| **13** | 0x4823b2 | **46** | **汽車** |
| **14** | 0x4823ba | **53** | **船** |
| 15 | 0x4823c2 | **47** | 备用精灵组那一支 |

（`MOVE_SOUND = [44,45,46,53]` 与 `MOVE_SOUND_ALT = 47` 就在 `move-sound.ts`；
钉子单测直接开 exe 数据段读这 8 个 dword。）

### 2.3 全部 Play/Stop 落点

| VA | 放/停 | 触发条件 |
|---|---|---|
| **0x0040d9f2** | **Play** | state 2 尾，`[0x498ea3] == 每向帧数>>3` 那一 tick（= 一格走完/起步）|
| **0x0040dde1** | **Play** | `fcn_0040dd1f` 里 `state == 1` 的支（坐牢/被抱那一类也走路）|
| **0x0040d8dc** | **Stop** | state 1，`[0x48baf8] == 0`（**整趟走完**）|
| 0x0040d909 | Play | 同一支里紧跟 Stop 的 `push 0x482362`（**号 32**，不是移动声）|
| 0x0040b9de / 0x0040bb99 / 0x0040bd0e / 0x0040bec7 | Stop | `_rich4_update_player_sprite`（VA 0x0040b960）换精灵组 / 被阻挡时收声；0x0040bec7 那支随后 `[0x4749d4] = 0xb` 再播 **32** |
| 0x0041b44e | Stop | 落地事件那一路（`[0x48baf8] == 0` 才走到）|
| 0x0040deb9..0x0040dedc | Play | **機器娃娃**：`esi = 9` / `[0x48baf8] = 9` / `state = 1` / `[0x4749d4] = 9` / `eax = 0x48234a + 0x48` |

### 2.4 「逐格推进」本身**一个放音都没有**

`fcn_0040c05c`（VA 0x0040c05c）里 `call 0x4542ce` 的出现次数 = **0**。它全部的 call 是：
`0x456f2d`（随机）、`0x40fc00`、`0x40b93b`、`0x4582bc`（sqrt）、`0x457dbc`（截断）、
`0x407a8c`（算朝向）。这一条把「逐格音效从哪来」彻底钉住：
**它来自 `fcn_0040d7c4` state 2（掷骰段）尾，不是来自走子推进。**

---

## 3. → 行为规格（可以直接抄进代码）

一次移动（掷出 N 点 → 走 N 格）：

```
fcn_0040dd1f:  state = 2                     ; 掷骰段（这期间不放移动声）
fcn_0040d7c4 每 tick: state 2 → 数走路帧(共 每向帧数>>3 tick)
                      数满 → 掷骰 → [0x4749d4] = 11+traffic
                                    Play([0x4749d4])     ← ①
                                    state = 1, [+3] = 0
                      以后每 tick: state 1 → fcn_0040c05c() 推进这一格的补间
                                    [0x498ea3]++ /== 每向帧数 → 归 0
同时 fcn_0040c05c 返回 1（这一格走完）→ [0x48baf8]--
                      [0x48baf8] != 0 → 下一格
                                    Play([0x4749d4])     ← ②（同一路，**不先 Stop**）
                      [0x48baf8] == 0 → Stop([0x4749d4])   ← ③
```

→ **Play 次数 = N**（起步 ① 算第 1 格，之后每换一格一次），**Stop 一次**。
N = 5 → 响 5 次，这是**原版的期望行为**。

**NPC / 機器娃娃**（actor ≥ 4）走的是 `fcn_0040dd1f` 的另一支：
- actor 4..7：`state = 1`（走路 / 被抱 `[+5] = 0x82`），**逐格音效不进入**
  （写 `state = 2` 的唯一一处在 actor < 4 支，VA 0x0040dd7e）
- actor 8（娃娃）：`0x40deb9` 起那条 —— 固定 9 步、**只放一声 38**、走完 Stop 同一个 9

**结论：逐格移动声只属于玩家 0..3。** 娃娃（38）与 NPC 一律不动。

---

## 4. ★ 真正与 exe 不一致的那一条：**同一段音频会叠加**

| | exe | 本引擎（`packages/client/src/audio.ts`）|
|---|---|---|
| 放 | `rich4_play_sound_effect` → 同一个 `IDirectSoundBuffer` | `#emit()` **每次新建一个 `BufferSource`**（第 111–120 行）|
| 停 | 下一格 `Play` 前/走完 `Stop` 同一路 | **没有任何 Stop 路径** |

一格 ≈ `WALK_SPEED[traffic]` 像素/tick、一格 36~49 px、24 ms/tick
（`Q-TURN-1 §5`）→ 一格约 **0.11~0.15 s**。而音效时长：

| 交通方式 | 号 | 时长（实测 `Effect.mkf`）| 一格耗时 | 会叠吗 |
|---|---|---|---|---|
| 走路 | 44 | 0.218 s | ~0.15 s | 轻微（原版也叠一点）|
| 機車 | 45 | 1.500 s | ~0.12 s | **叠十几路** |
| 汽車 | 46 | 2.720 s | ~0.09 s | **叠几十路** |
| 船 | 53 | 0.562 s | ~0.15 s | **叠三四路** |
| （備用組 47 / 娃娃 38）| 47 / 38 | 0.581 / 0.559 s | — | 同上口径 |

（时长是把 `Effect.mkf` 取出来解 RIFF 头算的：全是 22050 Hz / 1ch / 8bit。）

原版因为有 `Stop`，永远只有**一路**引擎声；本引擎是**每一格叠一路**。
需求方听到的「怎么响这么多次 / 一直在响」最可能就是这一条（引擎声那种连续轰鸣叠起来
非常明显），而**不是**「放了 N 次」本身。

### 处置（本轮已落）

- **新增** `packages/client/src/move-sound.ts`：把原版那一拍的**转移**算成一个纯函数
  `moveSoundStep(prev, { trafficMethod, cellId, moving })`
  → `'play' | 'stop' | null` + 该用的号 + 下一拍的状态。
  `'play'` 的语义是「**先 Stop 上一路，再 Play 这一路**」（对应 exe 的单路语义）。
- **新增** `packages/client/src/move-sound.test.ts`：15 项钉子 ——
  「走 5 格 = 5 次 play / 1 次 stop」「同一格连喂 10 拍只 play 1 次」
  「交通 0..3 → 44/45/46/53」「直接开 `rich4.exe` 数据段读表 `0x48234a` 的
  2/3/9/11..15 项 = 10/32/38/44/45/46/53/47」。
- **改** `packages/client/src/audio.ts` 的 `SoundPlayer`（**加法、不改签名**）：
  `play()` 起播前先把**同一路**还在响的 `BufferSource` 停掉，并新增
  `stop(archive, resource)` / `stopAll()`。这正是 exe 的 `Stop→Play`
  （@source VA 0x0040d9f2 → `fcn_004542e9`）。**这一改对既有调用点是等价的
  单路收敛，不改变任何「放几次」的时机。**
  钉子：**新增** `packages/client/src/sound-stop.test.ts`（5 项，用自带的假
  `AudioContext` + 真的 `Effect.mkf`）：同一路连播必须停掉前一个、不同号互不影响、
  显式 `stop` 认、自然播完的不会被误停、`stopAll` 收全部。
  ★ 反向验过：把 `play()` 里那句 `#stopKey` 拿掉，这一组立刻红 1 项。
- `main.ts` 的接线**本轮没动**（另一位 agent 正在改同一个文件的
  `amountPage` / `onAmountKey` 一带）。纯函数 + `SoundPlayer` 是那一头直接可用的成品；
  接线方式见 §6 第 4 条。

---

## 5. 订正清单（写回旧文件的那几条）

1. `Q-DOLL-1.md` **残留项②**：「原版那个音效是**一次移动放一次**」→ **错**。
   正确：**每格一次**；`fcn_0040d7c4` 的 state 2 尾 `0x40d9f2` 就是逐格那一下。
2. `known-deviations.md` **Q-TURN-1 §3 / §5** 的括注
   （「state 2，VA 0x0040d975」/「state 1，VA 0x0040d8d3」）**都对**，不用改。
   要改的只有一处：`Q-DOLL-1.md` 残留项②把 state 1 的 **Stop（0x40d8dc）**
   说成了「掷完骰开始走那一下（Play）」。订正为：**state 1 的 `0x40d8dc` 是 Stop**，
   Play 在 state 2 的 `0x40d9f2`（逐格）。
3. `docs/known-deviations.md` 里「实现：… `stepTick()` 在每次 step 时播」那段
   **行为描述本身是对的**（逐格），只是它被当成了 bug 来记 —— 补一句
   「✓ 与原版一致；差的是单路（Stop）」。见 §4。

---

## 6. ⚠️ 没解出 / 有意不做的

1. **`[0x498ea1]`（备用精灵组）的语义没查实** —— `!= 0` 时原版改播索引 15（**47**）。
   本引擎目前恒按 `false` 走（与 `move-sound.ts` 的 `altSlot` 参数一致）。
   谁能查实它什么时候非 0，就把 `altSlot` 接上；**在查实之前不接**（不许猜）。
2. **`fcn_0040dd1f` 的 `state == 1` 支与 state 2 尾会不会对同一趟各放一次**
   （即起步那一下是否被放两次）—— 只在「玩家走了 `fcn_0040dd1f` 的那一支」时才会发生，
   而**本引擎的回合驱动不区分这两支**（core 一次 `step` 一格，宿主按格喂）。
   本轮按「起步 = 第一格」处理（`moveSoundStep` 的 `moveSoundCell` 初值 0），
   与 state 2 那一支等价；**两支真正的关系（是否可能连放）没有实机可验**，
   登记在此，不做猜测性改动。
3. **听感没有实机比对** —— 授权里不许起 dev server（见任务边界）。上面全部结论是
   「照 exe 判据与资源号」得来的；§4 那张时长表是把 `Effect.mkf` 取出来解 RIFF 头
   **当场算的**（22050 Hz / 1ch / 8bit）。
4. ✅ **`main.ts` 的接线后来接上了（2026-09-16 复核）** —— 走的是更简单的一条：
   `stepTick()`（`main.ts:1848`）每走一格 `sound.play('Effect.mkf', moveSoundId(me.trafficMethod & 3))`
   并记进 `moveSoundPlaying`，整趟走完由 `syncMoveSound()`（`main.ts:1869`）
   `sound.stop('Effect.mkf', moveSoundPlaying)` 收掉 —— 与下面那份「照 `moveSoundStep()`
   接」的清单**语义相同**（每格 Play、整趟完 Stop），只是没走那个纯函数；
   `moveSoundStep()` 本身仍有单测（`move-sound.test.ts`）。
   ⚠️ 于是本条的「本轮没做」已过期，但**纯函数与宿主各写一份节拍**这件事仍在
   —— 若日后要合并，按下面这段接即可（留档）：
   - `moveSoundStep()` 的 `cellId` 用**玩家的 `nodeId`**、`moving` 用
     「这一帧玩家还在走」（= 补间在播 / `phase === 'moving'`）。
     `moveSoundCell` 的初值 0 让**起步那一拍**就 `play`（与 exe 的 state 2 尾一致）。
   - 拿到 `'play'` → `sound.play('Effect.mkf', id)`（`SoundPlayer.play()` 已经会
     自己把同一路的上一声停掉，**不必**先手动 `stop`）；
     拿到 `'stop'` → `sound.stop(...)`（或什么都不做 —— 本引擎下一格的 `play`
     会自动收上一路；`stop` 只在「整趟走完要立刻静音」时才必要）。
   - `stepTick()` 现有的「每个 `step` action 播一次」**不要改成「整趟只播一次」**：
     那与 §1/§2 的 6 处 VA 全部冲突。要动的只有「同路不叠」这一条（已在
     `audio.ts` 落地）。
