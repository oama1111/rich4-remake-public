# Q-UI-8 偏离登记 —— 「同一个计算器」与「右键关面板」两条交互统一

> ⚠️ **编号说明**：任务书写的是 `docs/deviations/Q-UI-7.md`，但 **Q-UI-7 已被占用**
> —— `docs/known-deviations.md` 第 2577 行「~~Q-UI-7~~：走子的方向与脚步声」
> （已做，2026-09-15）。`Q-UI-1..7` 全部用过，故本轮顺延到下一个空闲号
> **Q-UI-8**。
>
> 本文件登记三件事：① 需求方两条各自的**全量清单 + 逐条 exe 取证**；
> ② 本轮改了什么、落在哪些文件；③ **没解出 / 有意没动**的几处。
>
> 需求方原话（2026-09-16）：
> > 「**游戏里所有涉及输入数字的应该调用的都是同一个计算器**」
> > 「**股市里购买股票应该也是调用那个通用计算器**」
> > 「**打开顶部的任意工具栏要取消打开的话，应该可以使用右键（和取消使用道具卡片的
> >   交互一样），而不是只能通过 ESC 关闭**」

---

## 一、第 1 条：数字输入 —— 全游戏只有**一个**通用填数窗

### 1.1 裁决手段

通用填数窗就是 `fcn_00453544`（VA 0x00453544，`rich4-re/asm/rich4.asm:27476`）。
它只有一个参数（上限），内部读 `Panel.mkf` 资源 0x15/0x16 当键盘与数字面、
开一块 `(0x100,0x90)-(0x280,0x1e0)` 的区域（VA 0x0045358x 的
`fcn_00451e7e({0x100,0x90,0x180,0x150})`），窗口过程是 `fcn_00452c02`。

**整份 exe 里 `call 0x453544` 一共 12 处**（`python3 tools/disasm.py callers 0x00453544`）：

| # | 调用点 VA | 在哪一屏 | 窗口过程 |
|---|---|---|---|
| 1 | 0x0041d25b | 上市企業落点「是否認購股份」 | `fcn_0041d1a9` |
| 2 | 0x0042af92 | 股市柜台 **買進** | `fcn_0042aaff`（`loc_0042af89`）|
| 3 | 0x0042b07e | 股市柜台 **賣出** | `fcn_0042aaff`（`loc_0042b05a`）|
| 4 | 0x00434671 | 特別融資 **借** | `fcn_00434492` |
| 5 | 0x004346c2 | 特別融資 **還** | `fcn_00434492` |
| 6 | 0x00435245 | 貸款屏 **借** | `fcn_00435062` |
| 7 | 0x00435367 | 貸款屏 **還** | `fcn_00435062` |
| 8 | 0x00425ee9 | 個人資產表 **賣股票** | `fcn_004258c1` |
| 9 | 0x00425f6b | 個人資產表 **賣股票**（另一支）| `fcn_004258c1` |
| 10 | 0x00426631 | 個人資產表 **賣地產** | `fcn_0042608f` |
| 11 | 0x00426b35 | 個人資產表 **賣道具** | `fcn_004267a4` |
| 12 | 0x00426f57 | 個人資產表 **賣卡片** | `fcn_00426c2e` |

★ 这张表**已经由单测直接扫 exe 复核**（`packages/client/src/amount-unity.test.ts`
的 `hitsOfGenericWindow()`，与 `disasm.py` 同一套 `call rel32` 反推算法）——
exe 多一处、本引擎少一条，那条测试就红。

> ⚠️ `callers` 只扫 `E8 rel32`（直接调用）。理论上还有「把 &fcn 当回调传」这条路；
> `grep -rn 453544 rich4-re/asm/` 全库除了 `extern`/`global`/定义之外只有这 12 处调用，
> 未发现任何 `push fcn_00453544`。此条按**直接调用 12 处**定案。

### 1.2 本引擎落点（全部走 `dialog.ts` 的那一套）

「同一个计算器」在本引擎里 = `AmountPage`（只有 `choice` / `value` 两个字段）
＋ `layoutDialog` / `hitDialog` / `drawDialog`。五处入口：

| exe 调用点 | 本引擎入口 | 文件 |
|---|---|---|
| 0x0041d25b | `interactions.ts` `case 'buyShares'` 的 `choices[0].amount` | `interactions.ts` |
| 0x0042af92 / 0x0042b07e | `stockAmountForm(buy/sell, name)` | **`amount-form.ts`**（本轮新建）|
| 0x00434671 / 0x004346c2 / 0x00435245 / 0x00435367 | `interactions.ts` `case 'bank'` 的 `borrow` / `repay` / `financeBorrow` / `financeRepay` | `interactions.ts` |
| 0x00425ee9…0x00426f57 | `boardPriceUi(kind, id, amount, market)` | `board-screen.ts` |

**关于需求方第 2 条（股市買股票）**：查证结果是**本来就已经**走通用那一套
（`main.ts` 的 `stockAmountUi()` → `stockAmountForm()` → `drawDialog` /
`hitDialog` / `AmountPage`），不是自绘的一页。本轮把它从 `main.ts` 里**搬进
`amount-form.ts`**，好让「它确实是同一个计算器」这件事**能被单测钉住**
（原先定义在 `main.ts` 里，`main.ts` 是有副作用的入口脚本，测试碰不到）。
结构断言见 `amount-unity.test.ts`：五处入口共用**同一个** `AmountPage` 对象，
排出来的都是那五颗钮（− `step` / ＋ `step` / 最大 / 確定 / 取消），
且 UI 壳子只允许有 `title` / `detail` / `choices` 三个键（多一个就是「自己一份」）。

### 1.3 原版**另有专窗**的数字输入（不许并进来）

| 屏 | 它自己的输入方式 | 取证（为什么不是 `fcn_00453544`）|
|---|---|---|
| 銀行 ATM（存款／取款）| `Panel.mkf` #24 面板 + 自带数字键盘 | `_rich4_ui_bank_atm_entry` / 窗口过程 `fcn_00436ef8`（0x100 分支在 `loc_004374ac`）；12 处调用点里没有它 |
| 貸款屏的「特別融資」子对话框 | 它**自己**是另开的窗，里面的两处数额才走通用填数窗 | `fcn_00434492` 的 0x434671 / 0x4346c2 两处 → 通用；子对话框本体（版面）本引擎未复刻（见 `T-029.md` Q-BANK-1a），只保留「开通用填数页」这一步 |
| 拍賣出價 | 七颗固定加价钮（PASS/+100/+500/+1000/+5000/+10000/放棄）| `rich4_ui_auction.asm` **全文没有** `0x453544` |
| 樂透投注 | 36 格号码盘（一次一注，价固定）| `rich4_ui_letou.asm` **全文没有** `0x453544` |
| 小游戏 | 游戏自己收鼠标/键盘 | `rich4_small_games.asm` **全文没有** `0x453544` |
| 設定屏「日期更改」| 日期頁自己的年月日钮 | `fcn_00410ac3`，没有 `call 0x453544` |
| 開局設定（人数等）| `_rich4_init_new_game_callback` | 同上 |

### 1.4 本轮**改掉**的第二条数字入口

`main.ts` 的 HTML 调试抽屉（`renderInteraction()`）原先用 `window.prompt` 收数字
—— 那是**第二条**数字入口（原版没有这种东西）。现在改成开画面上那一个通用填数页
（`amountPage = { choice: idx, value: max }`）；这一屏若由别的整屏接管输入，
则只记一条日志，不再另弹输入框。

---

## 二、第 3 条：右键关面板 —— **ESC 与右键在原版是同一条消息**

### 2.1 这是原版自己的架构（本轮最关键的取证）

```asm
; rich4_keyboard_hook.asm VA 0x004011c3（RICH4.CFG 的「取消」键 = cfg+26 被按下时）
004011c3  push 0
004011c5  push 0
004011c7  push 0x205              ; ★ WM_RBUTTONUP
004011cb  push [gWindowHandle]
004011d2  call PostMessageA
```

而这份 exe 的「模态窗口」不是真窗口，是 `windowCallbacks[]` 这个**栈**
（`Wait_0402_Message` 压栈、`Post_0402_Message(0x402)` 弹栈，
`rich4-re/asm/rich4_window_util.c`），主窗口过程把收到的**所有**消息交给栈顶：

```asm
; rich4_main.asm VA 0x00401b33
00401b33  ebx = callbackSize
00401b3a  cmp [windowCallbacks + ebx*4], 0
00401b59  je  → DefWindowProcA
00401b4f  call [windowCallbacks + ebx*4](hwnd, msg, wParam, lParam)
```

⇒ **ESC（取消键）与右键在原版是字面同一条消息**，每一屏的副作用当然也一样。
所以本轮把「取消这一拍」做成**一份梯子**（`packages/client/src/panel-cancel.ts`
的 `CANCEL_LADDER` + `cancelLayerOf()`），`main.ts` 的熱鍵 `HOTKEY.cancel` 与
`contextmenu` **只调它**；各整屏的两个钩子也指回自己同一支。

⚠️ **唯一的例外**：没有模态窗口时（`callbackSize == 1`）钩子不走 0x205 那一路，
而是置 `[0x46caff] = 1`（@source VA 0x004011af）—— 所以「右键清掉小地图标记」
（@source VA 0x00418893）这一条 `ESC` 不做，它留在梯子之外、只挂右键。

### 2.2 逐屏清单（收不收、收的时候什么副作用）

| 那一层 | 原版收 0x205 的那一支 | 副作用 | 本引擎 |
|---|---|---|---|
| 目标拾取模式 | `loc_004466b8`（`_rich4_select_instance_callback`）| 放取消音（4）+ 退回；`[0x48c594]` bit3 置位（目标必选）**不认** | 梯子 `pick` |
| 遙控骰子点数盘 | `loc_00446a66`（`fcn_00446774`）| 放取消音 + 关盘 | 梯子 `dicePick`（原有）|
| 銀行 ATM | `loc_0043791e`（`fcn_00436ef8`）| 关面板，**不放音** | 梯子 `atm`（**本轮补**）|
| 通用填数页 | `loc_004534a3`（`fcn_00452c02`）| 放取消音 + 关窗，`Post_0402_Message(0)` = **返回 0（没填）** | 梯子 `amountPage`（**本轮补**）|
| 通用訊息框（YES/NO）| `loc_004539a2`（`fcn_0045367e`）| 放取消音 + 关窗，返回 0 = **NO** | 梯子 `dialog`（**本轮补**）|
| 設定屏 · 日期頁 | `loc_0041104c`（`fcn_00410ac3`）| 关副屏，返回 −1 | 梯子 `optionsSub`（原有）|
| 設定屏 · 熱鍵頁 | `loc_00411915`（`fcn_00411122`）| 松开捕获 | 梯子 `optionsSub`（原有）|
| 設定屏本体 | `fcn_0041095b`（在 `fcn_004103a3` 里）| 关屏，返回 0（不放音）| 梯子 `options`（原有）|
| 託管AI | `loc_0041e2ba`（`fcn_0041dda9`）| 关屏 = **取消**（草稿不拷回），不放音 | 梯子 `aiSettings`（**本轮补：原先只有 ESC**）|
| 存讀檔 SAVE | `loc_00403934`（`fcn_0040363a`）| 放取消音 + 关屏，返回 **−1** | 梯子 `saveload`（**本轮补：原先只有 ESC**）|
| 存讀檔 LOAD | `loc_00403cf4`（`fcn_004039c2`）| 同上 | 同上 |
| 個人資產表 | `loc_00424409`（`fcn_00423cf3`）| 关屏，返回 0（不放音）| 梯子 `assets`（原有；**本轮补：ESC 也收**）|
| 卡片欄 | `loc_00441671` / `loc_004418b9`（`fcn_004413ec` / `fcn_004416f0`）| 关浮窗，返回 0（不放音）| 梯子 `inventory`（原有；**本轮补：ESC 也收**）|
| 道具欄 | `loc_00445dad`（`fcn_00445c14`）| 同上 | 同上 |
| 股市 · 選股模式 | `loc_0042b22f`（`[0x48c2ed] != 0`）| 放取消音 + 抛回 0 = **卡不消耗**（`_rich4_ui_use_card_entry` 见 0 把卡片欄开回来，`loc_00441ce1`）| 梯子 `stockPick`（原有）|
| 股市 · 上市公司資訊详情卡 | `loc_0042aa08`（`fcn_00429d65`）| 关卡回股市屏（不放音）| 梯子 `stockDetail`（原有）|
| 股市 · 填数页 | `loc_004534a3`（借股市屏开的同一个填数窗）| 放取消音 + 关填数页 | 梯子 `stockAmount`（原有；**本轮补取消音**）|
| 股市 · 持股页 | `loc_0042b22f`（`[0x48c2ec] != 0`）| 退回行情页 **+ 清掉选中行**（`[0x48c2eb] = 0`）| 梯子 `stockPage`（原有）|
| 股市屏 | `loc_0042b25a`（`[0x48c2ec] == 0`）| 放取消音 + 关屏 | 梯子 `stock`（原有；**本轮补：ESC 也收**）|
| 百貨公司（商店）| `fcn_0042d37f` 的 `loc_0042e888` | 直接 `Post_0402_Message` 走人（**不说道别语、不放音**）| 梯子 `shop`（原有）|
| 監獄／醫院保釋屏 | `loc_0043d266`（`_rich4_ui_prison_callback`）/ `loc_0043e7c7`（醫院那一支）| 收定时器 + 关屏，返回 0 = **不保釋** | 梯子 `bail`（**本轮补**）|
| 銀行貸款屏 | `loc_00435f6d`（`fcn_00435062`）| 放取消音 + 说再见 + 关屏（状态机 `st = 0xb`）| 梯子 `loan`（**本轮补**）|
| 遊戲百科（說明）| `loc_0044e546`（`_rich4_ui_help_callback`）| 放取消音 + 放掉那几张图 + `Post(0)` | `helpScreen.contextmenu`（**本轮补：原先从工具列开时只有 ESC**）|
| 公佈欄 | 详情框 `loc_00427b7d`（`fcn_0042704e`）/ 主屏 `loc_00428378`（`fcn_00427c21`）/ 选物窗 `loc_00425fca`·`loc_00426673`·`loc_00426b89`·`loc_00426fa4` | 逐层关（不放音）| `boardScreen.contextmenu`（**本轮补**）|
| 樂透投注 | `loc_0043003d`（`fcn_0042f7fc`）| 放取消音 + `PostMessage(0x406, 5, 0)` → 画「拜拜」气泡 + 状态 5 → 下一拍 `Post(0)`（= 没买）| `lotteryScreen.contextmenu`（**本轮补**）|
| 大地圖彈窗 | `loc_0040a854`（`fcn_0040a801`）| 关窗（它**唯一**的出口）| `bigMapScreen.contextmenu`（原有）|
| 棋盤（清小地图标记）| `fcn_00418893` | 清标记 + 镜头回当前玩家 | `main.ts` 右键尾段（**ESC 不做**，见上面 ⚠️）|

### 2.3 原版**右键不关**的几屏（不许自己加）

| 屏 | 取证 |
|---|---|
| 拍賣 | `rich4_ui_auction.asm` **全文没有 `0x205`** |
| 小游戏 | `rich4_small_games.asm` **全文没有 `0x205`** |
| 樂透開獎 | `fcn_0043010c`（`rich4_ui_letou.asm`）没有 `0x205` 分支 |
| 設定屏的「遊戲說明」副屏 | 由 `helpScreen` 那一支收（同一个 `_rich4_ui_help_callback`）|

清单里没有的屏，本轮的 `panel-cancel.test.ts` 会**反过来**钉住它们
（`auction` / `minigame` / `lottery-draw` 三屏必须**没有** `contextmenu`）。

---

## 三、本轮改了哪些文件

| 文件 | 改了什么 |
|---|---|
| `packages/client/src/panel-cancel.ts` | **新建**：`CANCEL_LADDER`（逐层 VA + 副作用）与纯选择器 `cancelLayerOf()`；常量 `CANCEL_SOUND = 4` |
| `packages/client/src/amount-form.ts` | **新建**：`stockAmountForm()` —— 股市柜台填数页的壳（从 `main.ts` 搬出来，好单测）|
| `packages/client/src/main.ts` | ① `cancelTopPanel()` / `applyCancelLayer()` / `cancelDialogChoice()`：熱鍵 ESC 与 `contextmenu` **共用**；② 右键那一大段逐屏分支删掉、换成调梯子；③ 補 ATM / 填数页 / 訊息框 / 保釋屏 / 貸款屏；④ `stockAmountUi()` 变一行转调 `stockAmountForm()`；⑤ 调试抽屉的 `window.prompt` 改成开通用填数页 |
| `packages/client/src/help-screen.ts` | 新增 `contextmenu`（关屏 + 取消音），与它原有的 `hotkey(ESC)` 同一支 |
| `packages/client/src/board-screen.ts` | 抽出 `cancelBoardLayer()`，`hotkey(ESC)` 与新增的 `contextmenu` 共用 |
| `packages/client/src/lottery-screen.ts` | 新增 `contextmenu`（拜拜 + `declineDecision`）|
| `packages/client/src/panel-cancel.test.ts` | **新建**：梯子逐层一条、次序、登记的整屏、`main.ts` 两条路同源 |
| `packages/client/src/amount-unity.test.ts` | **新建**：12 处 `call 0x453544` 对账（**直接扫 exe**）、同一个 `AmountPage`、专窗清单 |

---

## 四、没解出 / 有意没动

1. **醫院那一支的 0x205 只读到一半**：`_rich4_ui_hospital_callback` 的 0x205 →
   `loc_0043e7c7`，那一段是**按状态分叉**的（先 `cmp byte [0x48c4f2], 2`），
   本轮只确认了「監獄那一支（`loc_0043d266`）是收定时器 + `Post(0)`」，
   醫院那条同构就**照監獄那一支**处理（本引擎两屏共用 `bail-screen.ts` 与
   同一个 `pending.kind === 'bail'`）。若日后发现醫院那一支另有副作用，改梯子的
   `bail` 那一条即可。
2. **保釋屏「不保釋」在本引擎走 `declineDecision`**：原版是 `Post_0402_Message(0)`
   （返回 0 → 落点流程继续）。本引擎 `pending.kind === 'bail'` 的「不了」就是
   `declineDecision`（`rules/interaction.ts` 的 `responseMatches` 认它），
   收尾是 `phase = 'turnEnd'`。**这条路的语义（落点剩余步骤会不会被跳过）
   没有逐条对过 exe 的落点流程**，本轮只保证「有出口、与原版同一拍」。
3. **樂透投注的右键 = `declineDecision`**：原版是 `PostMessage(0x406, 5, 0)`
   让`fcn_0042f7fc` 自己走「拜拜 → 关屏」，本引擎由 `lotteryScreen` 自己演
   「拜拜」那一拍并把 `pending` 交回引擎。演出节奏（100 ms）与原版一致，
   但「0x406 的 wParam=5 与其它 wParam 的分工」**没有逐条读完**
   （只读了 `loc_0042f974` 那一段）。
4. **12 处调用点的 `push` 参数只逐处核到「哪一个上限」**：上限的**算式**在
   `core` / `stock-screen.ts` / `board-screen.ts` 各自那一条里（都有 `@source`），
   本轮没有重算，只对账了「调用点 → 本引擎入口」。
5. ~~**`fcn_00453544` 的键盘表没有在浏览器里复刻**~~ ★★ **2026-09-19 订正：已接**。
   原版那扇窗收 `0x30..0x39`、`0x08`（退格）、`0x43`（C）、`0x4d`（M=最大）、
   `0x48`（拖金额栏）、`0x0d`（確定）—— 见 `loc_00452e4b` 起那段分派。
   本引擎的 `amount-keys.ts`（`amountKeyOfVk` / `AMOUNT_KEY_BY_ID`）+ `main.ts` 的
   `keydown` 分支已经**两条路都收**（`screen === 'game' || 'stock'`），
   与鼠标那条路共用 `onAmountKey`；`amount-keys.test.ts` / `amount-unity.test.ts`
   钉住键位到语义的映射。**鼠标与键盘都能用**（第四份试玩回报实测两者都可）。
   本轮**没做**这一条：它属于「同一个窗的输入方式」，但需求方两条说的是
   「调用同一个计算器」，且原版那扇窗的 ESC 自己**不认**（`loc_00452fa2` 直接返回；
   取消键是靠全局钩子补成 0x205 才关掉的）。**登记在此，未做**。
6. **`amount-form.ts` 只是搬运**：`stockAmountForm()` 的文案（`買進股數` /
   `賣出股數` / `股市`）是先前那一轮定的，**没有**回到 exe 核过它对应
   `Panel.mkf` #21/#22 上画的字（原版那扇窗上的字是烤在图里的）。
7. **调试抽屉少了一条「替电脑填数」的路**：`renderInteraction()` 原来用
   `window.prompt`，**电脑回合**也能从抽屉里强行派一个金额（调试用）。
   改成开通用填数页之后，`currentDialog()` 在电脑回合为 `null`（那一页也不画），
   于是那一下只记一条日志。这是「不许有第二条数字入口」的直接代价 ——
   若需求方要保留这条调试路，应该单独做一条**只给调试用**的通道，
   而不是把 `window.prompt` 放回游戏里。
8. **「頂部工具栏」之外的几屏没有逐条读完**：需求方第 3 条点的是工具列那几扇
   （已全部落实，见 2.2）。剩下这几屏**没有**逐支读完它们的 0x205：
   - 開局設定屏 `_rich4_init_new_game_callback`：0x205 → `loc_00405ab0`（还有
     `loc_00406969` / `loc_00406d60` 两支，像是一个多页面板各自的 0x205），
     `loc_00406d2e` 还会自己 `PostMessage(hwnd, 0x205)`（合成一次右键）——
     **本引擎的 `setup.ts` 本轮一条右键都没加**（它不在「顶部工具栏」里）。
   - 標題屏 / 大廳（`lobby`）：原版的 0x205 没查。
   - 樂透開獎屏：只确认了**没有** 0x205 分支。
