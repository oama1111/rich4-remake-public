# Q-ANIM-1 「動畫過程」設定（`RICH4.CFG+1` / `[0x497159]`）到底管着哪些屏

> 起因：两处登记（`T-039` 的 D-WHEEL-3、`T-034` 的 D-T034-2）都写「原版这一屏受
> 『動畫過程』管辖，本引擎够不到」。逐字节核 exe 后**两处的前提都不成立** —— 真正
> 受管辖的是另外**一组**屏，而那一组里当时只有一处接了线。
>
> 复核命令：`cd rich4-remake && python3 tools/disasm.py va 0xXXXXXX`。
> 全 exe 搜索：`grep -rn "0x497159" rich4-re/asm/*.asm`。

---

## 0. 变量在哪

- `rich4_read_config()`（**VA 0x00411e8f**）把 72 字节的 `RICH4.CFG` 整份读进
  全局 `0x497158`（`push 0x38 / push 1 / push 0x497168` 读键位表那一段；
  前 16 字节落在 `0x497158`）。
- `+0` = `game_speed`（`0x497158`）、**`+1` = `animation`（`0x497159`）**、
  `+2` = `music`、`+3` = `sound_effect`…（结构见 `packages/client/src/config-file.ts`
  的文件头，逐字段与 `rich4_config_file.h` 对过）。
- 所以「動畫過程关掉」= **`cmp byte [0x497159], 0 / je …`**。
- 本引擎的对应物：`options.animation`（`packages/client/src/options.ts` 的
  `GameOptions.animation`，从 `config-file.ts` 的 `bytes[1] !== 0` 来），
  在整屏契约里就是 **`UiScreenEnv.animation`**（可选，省略按 `true`）。

## 1. 全 exe 的读点清单（12 个文件 / 24 处）

| 文件 | 处 | 代表性 VA | 管什么 | 本引擎现状 |
|---|---|---|---|---|
| `rich4_gods.asm` | 12 | `fcn_0040ec14` / `fcn_0040ecf1` / `fcn_0040ed8f` / `fcn_0040ee50`（各函数**开头**）| 神明降臨／發威的 FLIC（`Data.mkf` **0x21c..0x222** 一族）只在开时读+播；关掉直接跳去落结果 | ❌ 神明 FLIC 整支未做（另案） |
| `rich4_hospital_utils.asm` | 1 | `_rich4_add_player_days_in_hospital` 内（**VA 0x0043ed27**）| 住院演出 FLIC `Data.mkf` **0x20c** | ❌ 未做（落地直接改状态，没有演出）|
| `rich4_prison_utils.asm` | 1 | `_rich4_add_player_days_in_prison` 内（**VA 0x0043d67b**）| 入獄演出 FLIC `Data.mkf` **0x21a** | ❌ 未做 |
| `rich4_magic_house.asm` | 1（`[0x497159]`）+4（读标志 `[0x48c3a5]`）| `loc_00432647` 存 `[0x48c3a5] = !anim`；`loc_004326b9` / `loc_00432719` / `loc_00432951` / `loc_004329ef` 读 | 魔法屋：消息框 `fcn_0044ecb6`（`[0x475694]` 等串）**关掉就不弹**；节拍 1 拍 vs `0xa` 拍 | ❌ 本屏恒弹消息框（`magic-screen.ts`）|
| `rich4_shop.asm` | 1（存）+2（读）| `loc_0042d423` 存 `[0x48c349] = [0x48c34a] = !anim`；`loc_0042d56d` / `loc_0042d821` 读 | 商店：关掉时**跳过滑入 + 消息框**，直接 `PostMessage(0x40e)` | ❌ 未接（`shop-screen.ts`）|
| `rich4_small_games.asm` | 3 | `_rich4_ui_game_penguin_treasure` 等三个小游戏入口 | 进场 FLIC：关掉**整个进场段都不走** | ✅ **已接**（`minigame-screen.ts` 的 `animation === false → null`，2026-09-16）|
| `rich4_ui_bank.asm` | 1 | `loc_00435200`（銀行 `0x405` 那一拍）| `if (cfg[1] != 0) { st = 1; 气泡 #0075 } else st = 3` —— 「歡迎光臨大富翁銀行！」那一句 | ✅ **2026-09-16 已接**（`main.ts` 的 `loanStart(options.animation)`；先前写死 `true`）|
| `rich4_ui_letou.asm` | 2 | `loc_0042f8f6`（`0x401` 铺场尾）| 开时 `PostMessage(0x405, 1)` 走招呼；关时 **`[0x48c370] = 3`** = 直接到「可点号」那一段 | ✅ **2026-09-16 已接**（`lottery-screen.ts` 的 `resetUi(now, animate)`）|
| `rich4_ui_letou.asm` | — | `loc_004301b0` | 对獎窗（另一支窗口过程）：关掉时置 `[0x48c37b] = 1` 并**不弹** `[0x475610]` 那张框 | ❌ 未接（对獎演出那一支）|
| `rich4.asm` | 2 | `0x00437f32` / `0x00438254`（都在 **`fcn_00437e61`**）| 见下 §2 | ❌ 未接（`monthly-screen.ts` 那一族）|
| `rich4_ui_auction.asm` | **0** | — | 拍賣屏**整支不读** `[0x497159]`（全文件只读 `cfg+8` = 日期）| ✅ 恒开**就是**原版行为（D-T034-2 的前提已订正）|
| `fcn_0043f7c6` / `fcn_0044090e`（旅館／購物中心**轉盤**）| **0** | — | 转盘整支不读 `[0x497159]`；状态 `ebx` 的推进只受「真人」与「夢遊」两个判据影响 | ✅ 恒开**就是**原版行为（D-WHEEL-3 的前提已订正）|

## 2. 月結／頒獎屏的那两处（`fcn_00437e61`，VA 0x00437e61）

> ★ 2026-09-16 复核订正：`fcn_00437e61` **就是月結／頒獎屏的窗口过程**（T-041 那一屏）——
>   它的 `[0x48c41c]` 图集、`[0x48c42a]` 状态机、5→6→7→8→9 幻灯片链都与 T-041 记的同一套
>   （见 `docs/deviations/T-041.md` 的 D-MONTHLY-7/-12）。先前按「銀行月結算／利息屏」
>   单列，只是因为最显眼的两个串 `#0092/#0093` 是銀行利息那两句 ——
>   它们是**这一屏收尾**的内容，不是另一屏。

这一屏就是「各位客戶辛苦了！又到了每月銀行結算的日子。」——
串表 `0x464d60` = `#0092`、`0x464d92` = `#0093`（本仓库用 `cp950` 解码 exe 得到），
`0x401` 铺场时 `SetTimer(hwnd, id, 0x64, 0)`（**VA 0x00437ece**，100 ms）后
`PostMessage(0x405)`。

```asm
; ── 0x405 那一拍：VA 0x00437f32
00437f32  mov byte [0x48c42a], 1              ; 状态 = 1
00437f37  cmp byte [0x497159], 0
00437f3e  je  short loc_00437f23              ; ← 关掉：**不弹**消息框，直接收
00437f40  push 0x464d60 / call fcn_0044ecb6   ; 开：弹「各位客戶辛苦了！」
```

```asm
; ── 0x113（WM_TIMER）那一拍：VA 0x00438218
00438240  call 0x437d1a ; → [0x48c42f]  ; 谁得标/谁付息
0043824a  call 0x437dfe ; → [0x48c430]
00438254  cmp byte [0x497159], 0
0043825b  je  short loc_0043827e
0043825d  …（开）逐位比 [0x48c42f] / [0x48c430] → 状态置 0xf 或 5
0043827e  mov byte [0x48c42a], 0x16       ; ← 关：**直接跳状态 0x16**
00438285  mov dword [0x48c425], 0x1e      ;    并把计数置 0x1e（30 拍 = 3 秒）
```

即：**关掉动画 = 不逐位播报，直接落结果并停 30 拍**。我们的月結屏是单段回放，
没有这条分流，登记在此。

## 3. 结论 / 未接清单

- **已接**（2026-09-16）：小遊戲進場、銀行招呼、樂透开屏。
- **未接**：神明 FLIC 一族、住院／入獄 FLIC、魔法屋消息框与节拍、商店滑入、
  樂透对獎窗那一张框、月結／頒獎屏的两处（收到状态 `0xf`/`0x16` 之前那两拍）。
- **前提被推翻**：拍賣屏与旅館／購物中心轉盤**不受**这个设定管辖，
  见 `T-034.md` 的 D-T034-2 与 `T-039.md` 的 D-WHEEL-3（两节都已改写）。
  因此 `wheel-screen.ts` 的 `wheelFrameSequence(..., animate = false)` 那一支
  **没有任何 exe 调用点** —— 它只是本引擎的现成出口，留着备用（`wheel-screen.test.ts` 里那两条单测照旧），**不许**拿它去接 `env.animation`。
