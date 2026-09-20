# W-60 系列 —— 第六份试玩回报（10 条）

> 制定：首席（Claude），2026-09-20。执行：DeepSeek。规则照 [`../WORKPLAN.md`](../WORKPLAN.md) §2 与 PR 模板。
> 基线分支：**`fix/playtest-5-camera-gods`**（`ea6de9c` 之后）。门禁基线：`pnpm check` = **271 files / 6013 tests，0 skipped**。
>
> **本文每一条的「根因」与「原版证据」都是首席已经回 `rich4.exe` 逐条读过、或在浏览器里复现过的结论。**
> 执行方只做「改法」里写的事：**不要重新解读汇编、不要换方案、不要顺手改别的**。
> 文里给的数字（坐标 / 图号 / 毫秒 / 概率）**逐字照抄**，写进代码时连同 `@source` 一起抄。
> 发现文里的说法与代码现状对不上（函数名变了、行号漂了、常量已被改过）⇒ 以**函数名 / 常量名**为准去找；
> 找不到 ⇒ 停手写 `escalations.md`，不要猜。
>
> 上一轮的教训（写进每个 PR 的自查）：
> 1. E-20 里执行方自己读汇编，把「初始化消息 `0x401`」读成了「取消」，结论整个反了。**这一轮严禁自己读控制流。**
> 2. E-21 里「脚本点 EXIT 313 次关不掉」被当成脚本缺口，其实是引擎真 bug。**「点了没反应」一律先当 bug 查。**

## 做的顺序（必须按这个顺序，一条一个 PR）

| 序 | 任务 | 对应回报 | 为什么排这儿 |
|---|---|---|---|
| 1 | **W-60** 回到棋盘后回合驱动不续 | 第 10 条（**阻断**）| 需求方现在没法继续试玩 |
| 2 | **W-61** 卡面尺寸 | 第 2 条 | 改两个数 |
| 3 | **W-62** 填数窗画偏 40px | 第 6 条 | 改一处坐标 |
| 4 | **W-63** 股票详情右键连退两层 | 第 7 条 | 改一个条件 |
| 5 | **W-64** 台词文字垂直居中 | 第 4 条 | 改一个对齐 |
| 6 | **W-65** 骰子数切换钮的排布 | 第 9 条 | 改一张表 |
| 7 | **W-66** 走子剩余步数 + 节拍 | 第 1 条 | |
| 8 | **W-67** 商店：董事長赠礼框 / 眨眼 / 语音 | 第 8 条 | |
| 9 | **W-68** 樂透開獎屏：持久表面 / 多余的对话框 / 卡顿 | 第 3 条 | 改动面最大，放后面 |
| 10 | **W-69** 过路费：同街连号高亮 | 第 5 条 | 规则没错，缺的是演出 |

---

## W-60（B）从任何一屏回到棋盘后，回合驱动不再续上 —— **阻断**

### 现象
人物走子途中点开「遊戲設定」改小地圖/日曆选项再关掉 ⇒ 棋子停在半路，GO 点不动、地也买不了，整局卡死。

### 根因（首席已读代码确认）
`main.ts` 的两条回合驱动在**排程入口**都有 `if (screen !== 'game') return;`
（`scheduleHumanTurn()` 与 `scheduleAi()`）。流程是：

1. 走子途中，上一拍排好的定时器还挂着；玩家此时打开設定 ⇒ `screen = 'options'`；
2. 定时器到点照常 `dispatch(step)`；`dispatch` 末尾再叫 `scheduleHumanTurn()` 续下一拍 ——
   此刻 `screen !== 'game'` ⇒ **直接 return，没人再排**；
3. 关掉設定时，所有「回棋盘」的出口都只写了 `screen = …; requestRender();`，**没有一处**叫 `resumeTurnDriver()`：
   `closeStock` / `closeSaveLoad` / `applyCancelLayer` 的 `'options'` 支 / `onOptionsUp` 的取消与確定两支 /
   `closeAiSettings` / `closeAssets` / `closeInventory`（另外 help、大地圖等整屏同理）。
   ⇒ 链条永远断着。（过场那条 `endIntro()` 早就踩过同一个坑，那里是手工补的两句。）

### 改法（只许这样改）
**不要**去每个出口各补一句（漏一个就又卡）。在**渲染回调里统一补**：

1. `main.ts` 新增模块级变量 `let lastFrameScreen: Screen = 'title';`（放在 `let renderQueued` 附近）。
2. 新建纯函数文件 `client/src/driver-resume.ts`：
   ```ts
   /** 这一帧要不要把回合驱动重新叫起来：刚从别的屏**回到**棋盘的那一帧 */
   export function shouldResumeDriver(prev: string, now: string): boolean {
     return now === 'game' && prev !== 'game';
   }
   ```
3. `requestRender()` 的 rAF 回调里、`resizeCanvas()` 之后**第一件事**：
   ```ts
   if (shouldResumeDriver(lastFrameScreen, screen)) resumeTurnDriver();
   lastFrameScreen = screen;
   ```
   （`resumeTurnDriver()` 已存在 = `scheduleAi(); scheduleHumanTurn();`，两者入口都会先清掉旧定时器，重复叫无害。）
4. `endIntro()` 里原有的那两句**保留**（不要删，删了改动面变大）。

### 禁止
- 不许删驱动入口的 `if (screen !== 'game') return;`（那是为了别在标题屏/过场里跑回合）。
- 不许改成「設定屏开着时也继续走子」—— 原版設定屏是模态的。

### 测试
- `driver-resume.test.ts`：`('options','game') → true`、`('game','game') → false`、`('game','options') → false`、`('intro','game') → true`。
- 浏览器复现脚本（贴进 PR）：`?screen=game&humans=1&ai=3&map=0&seed=7`，点 GO，棋子走到一半时
  `__rich4.toolbar(<設定那颗的下标>)` 开設定，1 秒后在設定屏发一次右键（`contextmenu`）关掉，
  断言 3 秒内 `state.phase` 离开 `'moving'`。**改前必须先跑一次确认它会卡住**（贴出改前/改后两段输出）。

### 验收
真人路径长跑（`tools/soak-browser.js`，标签页**前台**）60 回合，`stalls/busyStalls/humanStalls/exitStuck/errors` 全空。

---

## W-61（A）得卡时的卡面是乱码

### 根因
`event-box-screen.ts` 的 `CARD_FACE_SIZE = { w: 176, h: 240 }` 是当初**按文件大小猜的**（84480 字节）。
exe 的图头模板写的是 **165 × 256**（像素数同为 42240，所以大小对得上、行宽错了 ⇒ 每行错位成乱码）。

@source `fcn_00441f73`（得卡演出，4 个调用点：卡片格 `0x0041b302`、福神 `0x00441baa` 等共用）：
`0x00441f7e mov esi, 0x441204 / 0x00441f83..85 movsd×3` 把 12 字节图头模板拷到栈上，
模板 `0x441204` 的字节 = `a5 00 00 01 00 00 00 00 …` ⇒ `u16 宽 = 0x00a5 = 165`、`u16 高 = 0x0100 = 256`、锚点 (0,0)；
`0x00441fc6` 把 `read_mkf(Data, 卡号+0x23a)` 的返回值填进模板的数据指针；`0x00442046 push 0xc8 / push 0x8a` 落点 (138,200) 不变。
首席已用 165×256 把 `extracted/Data/0571.bin` 渲染出来，是一张完整的卡。

### 改法
1. `CARD_FACE_SIZE` 改成 `{ w: 0xa5, h: 0x100 }`，注释换成上面那段 `@source`（把「176×240」字样全删掉，包括文件头素材表里那一格和 `eventBoxPlan` 里那行注释）。
2. `event-box-screen.test.ts` 里 `expect(CARD_FACE_SIZE).toEqual({ w: 176, h: 240 })` 与标题里的「176×240」改成 165×256 ——
   这是**订正一个猜出来的数**，不是放宽断言；PR 里写明依据是模板 `0x441204`。
3. 新增一条测试：`CARD_FACE_SIZE.w * CARD_FACE_SIZE.h * 2 === 84480`（与资源字节数对账）。

### 验收
浏览器里 `__rich4.debug.patch` 给当前玩家 `godInfo = 3` 以外的办法太绕 —— 直接用卡片格：
`__rich4.warp(<specialKind === 13 的节点>)`，截图卡面是一张正常的画。附 PR。

---

## W-62（A）计算器：点 7 出 1、点 8 出 2、点 ↵ 变退格

### 根因
面板**画的位置**比**命中框**低了 40 px（= 棋盘区在舞台上的 y 偏移 `LAYOUT.board.y`）。
- 命中框：`dialog.ts` 用 `boardRect({ x: AMOUNT_WINDOW.x + r.x, y: AMOUNT_WINDOW.y + r.y, … })` —— 把**屏幕坐标**换成**棋盘画布坐标**，对的。
- 画：`amount-window.ts` 的 `drawAmountWindow()` 直接拿 `AMOUNT_WINDOW.x / .y`（屏幕坐标 (256,144)，@source `[0x48cab8]/[0x48cab6]`）
  画到**棋盘画布**上（`drawDialog` 的 `ctx` 原点在舞台 (0,40)）⇒ 整块面板落在屏幕 (256,184)。
- 于是玩家照着画面点「7」（面板内 y=119 那一排），实际落在命中框的 y=159..176 ⇒ 撞上「1 2 3」那一排（y=167）；
  点 ↵（y=63..88）的上半截撞上「C 0 ←」那一排的 ←。与回报逐条吻合。键→语义的两张表（`AMOUNT_SLOT_BY_ID` / `AMOUNT_KEY_BY_ID`）**没有错，不许动**。

### 改法
`drawAmountWindow()` 里把
```ts
const wx = AMOUNT_WINDOW.x;
const wy = AMOUNT_WINDOW.y;
```
改成用 `gameui.ts` 的 `boardRect` 换算后的原点：
```ts
const o = boardRect({ x: AMOUNT_WINDOW.x, y: AMOUNT_WINDOW.y, w: AMOUNT_WINDOW.w, h: AMOUNT_WINDOW.h });
const wx = o.x;
const wy = o.y;
```
并在函数头注释里写明「`ctx` 是**棋盘画布**（原点 = 舞台 (0,40)）；股市屏那条路在调用前 `translate(LAYOUT.board.x, LAYOUT.board.y)`，同样是棋盘坐标系」。
其它调用点不用动（全仓只有 `dialog.ts` 一处调它）。

### 测试
`amount-window.test.ts` 加一条：假 `ctx` 记录第一次 `drawImage(面板图, x, y)` ⇒ `x === AMOUNT_WINDOW.x - LAYOUT.board.x`、`y === AMOUNT_WINDOW.y - LAYOUT.board.y`；
再加一条「画的位置与命中框同源」：`layoutDialog(...)` 里序号 7（'7'）那颗钮的 `rect.y === wy + AMOUNT_KEY_RECTS[7].y`。

### 验收
浏览器：企業格認購股份 → YES → 截图，面板上的「7」正好压在序号 7 的命中框上（用 `__rich4.dialog()` 的按钮中心画十字叠图，或直接真鼠标点「7」断言金额出现 7）。

---

## W-63（A）股票详情卡右键一下退了两层

### 根因
右键会先后触发两个 DOM 事件：`mousedown(button=2)` → `contextmenu`。
`main.ts` 的 `mousedown` 里（`screen === 'stock'` 那一段）：
```ts
if (stockDetail !== null) {
  if (e.button === 0 || e.button === 2) closeStockDetail();   // ← 右键在这里已经把详情卡关了
  return;
}
```
随后 `contextmenu` 进 `cancelTopPanel()`：此时 `stockDetail` 已是 null ⇒ 梯子落到 `'stock'` 层 ⇒ `closeStock()`，整个股市屏也关了。
梯子上本来就有 `'stockDetail'` 这一层（`panel-cancel.ts`），右键交给它就够。

### 改法
1. 上面那一句改成 `if (e.button === 0) closeStockDetail();`，注释写「右键走 `contextmenu` → `cancelTopPanel()` 的 `stockDetail` 层；这里再关一次就连退两层」。
2. 同一段里紧挨着的**休市**那一支 `if (e.button === 0 || e.button === 2) { … closeStock() … }` 同理改成只认 `e.button === 0`，
   并确认 `cancelTopPanel()` 的 `'stock'` / `'stockPick'` 层能覆盖休市时的右键（能：休市屏就是 `screen === 'stock'`）。
3. 顺手全文件搜一遍 `e.button === 2`：凡是「`mousedown` 里处理右键、同时该屏又在取消梯子上」的，都属于同一类重复。
   **只列清单写进 PR，不要顺手改**（除上面两处）。

### 测试
纯逻辑在 `panel-cancel.test.ts` 已有（梯子顺序）。本条补一条浏览器断言（贴进 PR）：
开股市 → 点一行开详情 → 依次派 `mousedown{button:2}`、`contextmenu` ⇒ `screen === 'stock'` 且详情已关；再来一次右键 ⇒ 回到 `'game'`。

---

## W-64（A）人物台词的文字偏低

### 根因
`speech-bubble.ts` 把 `draw_text` 最后那个实参 **5** 读成了「最多 5 行」，其实它是**对齐方式**。

@source `0x0044f140 push 5 / 0x0044f142 push 0x82 / 0x0044f147 push 0xc8 / push 串 / push 0 / call 0x44fabc`。
`0x44fabc` 末段 `lea eax,[flag-1] / jmp [eax*4 + 0x44faa0]`（7 路跳表，语义表在 `hud.ts` 文件头，**已逐条实读**）：
**flag 5 = 水平左对齐、垂直居中** —— `y -= 文字块高 / 2`（`0x0044ff35 mov eax,ebx / sar eax,1 / sub [esp+0xb0],eax`，`ebx` = 整块文字高 + 1）。
⇒ `(200, 130)` 是文字块的**左边缘 + 垂直中心**，不是左上角。现在按左上角画，整块偏低半个块高。

### 改法
1. 删掉 `SPEECH_TEXT_MAX_LINES`（及所有用到它的 `Math.min(…)`），注释里说明「那个 5 是对齐 flag，不是行数上限」。
2. 新增常量 `export const SPEECH_TEXT_FLAG = 5;`，`@source` 抄上面那段。
3. `drawSpeechBubble` 画字那一段：
   ```ts
   const blockH = b.lines.length * SPEECH_TEXT_LINE_HEIGHT;
   const top = b.textAt.y - (blockH >> 1);          // flag 5：垂直居中（`sar eax,1` = 算术右移）
   // 第 i 行：y = top + i * SPEECH_TEXT_LINE_HEIGHT，textBaseline 仍是 'top'，textAlign 仍是 'left'
   ```
4. 行高 `SPEECH_TEXT_LINE_HEIGHT`、字号、x=200 都**不许动**。

### 测试
`speech-bubble.test.ts`：1 行 / 2 行 / 3 行各一条，断言首行 `y === 130 - ((n * LINE_HEIGHT) >> 1)`；断言任意行数下「首行顶 + 末行底」的中点 === 130（±1）。

---

## W-65（A）開汽車时骰子数切换钮排错、超出 GO 鈕

### 根因
`gameui.ts` 的 `DICE_TOGGLE_AT = { dx: 7, dy: 0x1a, pitch: 19 }` 把**单颗**那一支的 `dy` 和**機車**那一支的步距混成了一套。
原版按**交通方式**分三支（@source `0x004172fb jmp [eax*4 + 0x417181]`，`eax = traffic & 3`，表 = `[0x417302, 0x417353, 0x417401, 0x417302]`）：

| `traffic & 3` | 颗数 | 第 i 颗的 y（相对 GO 左上角）| @source |
|---|---|---|---|
| 0 步行 / 3 | 1 | `0x1a`（26）| `0x00417309 add eax, 0x1a` |
| 1 機車 | 2 | `0x10 + 19 × i`（16 / 35）| `0x0041737e..0x00417390`（`i*20 − i` 再 `+0x10`）|
| 2 汽車 | 3 | `9 + 16 × i`（9 / 25 / 41）| `0x0041742c mov eax,ebx / shl eax,4 / … / 0x00417437 add eax, 9` |

x：**亮**的那张贴 `GO.x + 7`、**暗**的那张贴 `GO.x + 8`（`0x00417320 add eax,7` / `0x00417345 add eax,8`，三支相同）。
亮/暗判据：`i <= ndices − 1` **且** `player+0x38`（停留）== 0 ⇒ 亮（图 `2i + 7`），否则暗（图 `2i + 6`）—— 图号与现有 `DICE_TOGGLE_IMAGE` 一致。
命中（@source `0x00418228` 起，同一张交通方式分支）：機車 `y ∈ [19i + 0x10, 19i + 0x20]`、汽車 `y ∈ [16i + 9, 16i + 0x19]`（两端都含，后面的 i 覆盖前面的）。

### 改法
1. `gameui.ts`：删 `DICE_TOGGLE_AT`，换成
   ```ts
   /** 骰子数切换钮的纵向排布，按交通方式 @source 见 W-65 */
   export const DICE_TOGGLE_LAYOUT: readonly { dy: number; pitch: number }[] = [
     { dy: 0x1a, pitch: 0 },   // 0 步行：1 颗
     { dy: 0x10, pitch: 19 },  // 1 機車：2 颗
     { dy: 9, pitch: 16 },     // 2 汽車：3 颗
     { dy: 0x1a, pitch: 0 },   // 3：同步行
   ];
   export const DICE_TOGGLE_X = { lit: 7, dim: 8 } as const;
   ```
2. `dialog.ts`：`diceToggleRect(i, pos)` 加第三个参数 `traffic: number`，`y = GO.y + layout.dy + i * layout.pitch`；
   `hitDiceToggle` / `drawAdvance` 同样加 `traffic` 并传下去（`main.ts` 的调用点传 `me.trafficMethod & 3`）。
   画的时候亮图用 `DICE_TOGGLE_X.lit`、暗图用 `.dim`。
3. 停留中（`stopping !== 0`）三颗全画暗图 —— 若 `drawAdvance` 现在拿不到这个标志，就多传一个 `blocked: boolean`。

### 测试
`dialog.test.ts`（或现有对应测试）：三种交通方式 × 每颗的 `rect.y − GO.y` 逐个等于上表；
汽車第 3 颗的底边 `9 + 32 + 15 = 56 ≤ 67`（GO 高）⇒ 不超出。

---

## W-66（B）走子：剩余步数的大数字 + 节拍

### 66-a 剩余步数（原版有、本引擎没有）

@source 棋盘绘制例程 `0x00409937..0x004099fb`：
```asm
00409937  cmp byte [0x46cafb], 0 / je 跳过        ; 行动状态机在跑
00409944  cmp dword [0x48baf8], 0 / je 跳过       ; 剩余步数 != 0
00409951  eax = [0x49910c] ; cmp eax,4 / jge 直接画 ; 替身（4..7）不看下面两条
00409964  test byte [player+0x15], 0x30 / jne 跳过 ; 走回棋盘 / 被挪过 ⇒ 不画
00409971  cmp dword [player+0x32], 0 / jne 跳过    ; 住宿/消失/坐牢/住院 ⇒ 不画
0040998f  sprintf(buf, "%d", [0x48baf8])
004099a8  x = 0xf5 − (strlen × 0x32) / 2           ; 245 − 25×位数
004099c5  每一位：图 = Data.mkf #0x205 的第 (字符 − 0x28) 张（'0' → 图 8 … '9' → 图 17），
          带透明（fcn_00456418）贴到 (x, 0x190)；x += 0x32
```
`[0x48baf8]` 在**走完一格的那一拍**才减 1（`0x0040d950 call 0x40c05c` 返回 1 → `0x0040d960 dec`）。

⇒ 规格：
- 数字 = **还没走完的格数**：走第一格的途中显示掷出的点数，走到一格减 1，走完最后一格消失。
- 图：`Data.mkf` #`0x205` 图 `8 + 数字`（首席已在浏览器里核过：图 8..17 是 35×43 左右的数字，锚点在中心）。
- 落点（**屏幕**坐标）：第 k 位的锚点 = `(245 − 25×位数 + 50×k, 400)`；换到棋盘画布要减 `LAYOUT.board`（y − 40）。
- 贴图语义 = 抠黑 + 减锚点（与 `speech-bubble.ts` 里贴气泡同一支 `0x456418`）。

本引擎的 `state.stepsRemaining` 在 **`step` 这条 action 一派出去就减了**（补间才刚开始）⇒ 显示值要补回来：
```ts
// client/src/steps-counter.ts（新文件，纯函数）
export function stepsCounterValue(stepsRemaining: number, walking: boolean): number {
  return stepsRemaining + (walking ? 1 : 0);
}
```
`walking` = `!renderer.walkDone()` 且补间的是**玩家**（不是替身）。显示条件：值 > 0，且当前玩家 `blocking` 四项全 0、`whoPlays & 0x30 === 0`。
最后一格补间期间 `state.phase` 已经是 `'settling'`，所以**不要**拿 `phase === 'moving'` 当条件。
替身（娃娃/惡人）那一路原版也画，本轮**不做**，PR 里列进「没做」。

### 66-b 节拍「偏慢」
首席复核：`tick.ts`（20 ms × 分频 `[6,4,2,0]`，@source `0x00401fad`）与 `tween.ts`（步速 `[8,12,16,8]` 世界单位/tick）与 exe **一致**，
地图 0 的格距 43–108 世界单位 ⇒ 默认速度下一格 0.4–1.0 秒，这是原版的数。
可疑的只剩**格与格之间的缝**：每一格走完后 `setTimeout(paceDelay)` → `holdForActorWalk` 可能再等一个 `RENDER_MS` → rAF 才起下一段补间，
而原版是**同一个 tick**里上一格收尾、下一格起步（`0x0040d936..0x0040d950`），缝是 0。

改法（先量后改）：
1. 先加一个只在 DEV 的量测：`renderer.startWalk` 时记 `performance.now()`，与「上一段补间的理论结束时刻」相减，累计进 `__rich4.walkGaps()`（数组）。
   跑 30 格，PR 里贴出 `中位数 / p95`。**中位数 ≤ 10 ms 就到此为止**，66-b 不再改，把数字写进 PR。
2. 中位数 > 10 ms 才改：`startWalk(..., now)` 的 `now` 传「上一段补间的**理论结束时刻**」（`prev.start + prev.ticks * prev.tickMs`），
   前提是它距当前时刻不超过 100 ms（超过说明中间真的停过，仍用 `performance.now()`）。这样缝不累积，整段路的总时长 = 各格 tick 数之和 × tickMs，与原版相等。
   **不许**改 `WALK_SPEED_PX_PER_TICK`、`TICK_DIVISOR`、`RENDER_MS` 任何一个数。

### 测试
`steps-counter.test.ts`：(3,true)→4、(3,false)→3、(0,true)→1、(0,false)→0。位数→x 的换算单独一条（1 位 220、2 位 195/245）。

---

## W-67（B）道具/卡片商店：董事長赠礼、眨眼太快、没有语音

### 67-a 董事長光臨（core 已经送了东西，但没有任何提示）
@source `_rich4_ui_shop_entry` `0x0042e97d..0x0042ea28`：
```asm
0042e97d  call rand / test al,1 / je 送卡
0042e98d  call 0x445ada          ; 送道具 → 名字 = [0x47feda + id*8]，点数 bl = byte [0x47fedf + id*8]
0042e9c0  call 0x441e12          ; 送卡   → 名字 = [0x47fdea + id*8]，点数 bl = byte [0x47fdef + id*8]
0042e9f8  sprintf(buf, 0x464378, 名字)      ; 「歡迎董事長光臨\n\n送您%s！」
0042ea0a  push 0x5dc / call 0x440cac        ; 棕色訊息框 1500 ms —— **在商店窗打开之前**
0042ea23  call 0x44f230(玩家, bl)           ; 「好消息」台词阶梯，入参 = 那件东西的**點數价**
```
改法：
1. `data/messages.ts` 加 `SHOP_CHAIRMAN_GIFT = t('歡迎董事長光臨\n\n送您%s！', 0x464378)`。
2. `core/state/types.ts` 的 `NoticeKey` 加 `'shop.chairmanGift'`；`client/notice-box-screen.ts` 的 `NOTICE_TEXT` 加映射。
3. `reduce.ts` 的 `enterShop()`：真的送出了东西（`toolId !== 0` 或 `cardId !== 0`）时，返回的 state 带
   `notices: [{ key: 'shop.chairmanGift', args: [名字] }]`（名字用现成的 `toolNameOf` / `cardNameOf`）。没送成（库存/牌堆空）不弹。
4. 商店窗要等这扇框收掉再开：`notice` 已在 `BLOCKING_PRESENTATIONS` 里；检查 `main.ts` 里开 `shopUi` 的那段（`syncShopUi` 或同名函数）——
   若它不看 `blockingPresentation()`，加一句「框还在就先不建 `shopUi`」。
5. 台词（`0x44f230`）：`speech.ts` 里已有 `pointsGained` 那条阶梯（同一支 `fcn_0044f230`，阈值 100/50）。新增探测器 `shopGift`：
   判据 = `after.notices` 新出现 `shop.chairmanGift`；入参值 = 那件东西的點數价（core 在 notice 之外再给一个瞬态字段
   `lastShopGift: { kind: 'tool' | 'card'; id: number; points: number } | null`，规矩同 `lastCardPlay`：不进指纹、不进存档、每条 action 入口清空）；
   `order: 'afterStage'`、`expression` 抄 `pointsGained` 那一行的值。

### 67-b 老板娘眨眼太快
现状：`shop-screen.ts` 的 `blinkStep()` **每 100 ms 无条件换一张脸**。原版是个带**空闲态**的状态机，平均 3 秒多才动一下。

@source `loc_0042d87e`（每隔一次 50 ms 定时器进来一次 = **100 ms 一拍**，`xor byte [0x48c348],1 / je 跳过`），
状态字 `S = [0x48c32f]`：低 4 位 = 模式，bit 4–7 = 帧计数，bit 8–11 = 当前脸号。跳表 `0x42d36b` 5 项：

| 模式 | 入口 | 行为（**逐字照做**）|
|---|---|---|
| 0 空闲 | `0x42d8ab` | `r = rand15() >> 10`（0..31）。`r == 0` **且** 当前脸号 ≠ 0 ⇒ 模式 = `页 + 1`（眨眼）；`r == 1` ⇒ `S = 页 + 3`（换脸；注意这一句把脸号与帧计数都清 0）；其余 30/32 什么都不做 |
| 1 卡片页眨眼 | `0x42d8ee` | 帧计数 == 4 ⇒ `S = 0x200`（回空闲，脸号记 2）；否则**不透明**贴图 `[7, 8, 7, 5][帧计数]`（表 `0x4755b8`）到 (0x195, 0x3c)，帧计数 +1 |
| 2 道具页眨眼 | `0x42d9a3` | 帧计数 == 4 ⇒ `S = 0x100`（回空闲，脸号记 1）；否则贴图 `[21, 22, 21, 23][帧计数]`（表 `0x4755bc`）到 (0x1a1, 0x32)，帧计数 +1 |
| 3 卡片页换脸 | `0x42da31` | `pick = ((rand15() * 3) >> 15) + 1`（1..3）；`pick ==` 当前脸号 ⇒ 这一拍不动（**模式不变，下一拍再抽**）；否则贴图 `pick + 3` 到 (0x195, 0x3c)，脸号 = pick，模式回 0 |
| 4 道具页换脸 | `0x42daf1` | `pick = (rand15() & 1) + 1`；同上，贴图 `pick + 0x16`（23/24）到 (0x1a1, 0x32) |

进店 / 换页时模式 = `页 + 3`（现有注释里那句 `loc_0042d5d8` 是对的）。第二处（嘴，`[0x48c314]` 倒数器）现有逻辑**不动**。

改法：把 `ShopBlink` 改成 `{ mode: number; frame: number; face: number; hold: number; at: number }`，`blinkStep` 按上表重写；
`rnd` 仍然注入（`rand15()>>10` 写成 `Math.floor(rnd() * 32)`，`(rand15()*3)>>15` 写成 `Math.floor(rnd() * 3)`）。
**不许消耗游戏的 `WatcomRng`**（这是表现层，C-DET-1）。

### 67-c 商店没有语音
exe 里那 11 句都带语音号，本引擎的 `SHOP_MSG` 把 `#NNNN` 剥掉了，而且第 0 句的换行也抄错了。
**逐字**换成（@source 指针表 `0x4755c0` 起，每页 6 项；首席已 dump）：

| 下标 | 串 |
|---|---|
| 0 | `#0000有什麼我能\n為你服務的嗎？` |
| 1 | `#0001請挑選你想要\n兌換的卡片。` |
| 2 | `#0002抱歉！\n你的點數不足！` |
| 3 | `#0003對不起！\n您的卡片欄已滿！` |
| 4 | `#0004歡迎下次再來！` |
| 5 | `#0005歡迎光臨\n道具店！` |
| 6 | `#0006您要兌換\n什麼道具？` |
| 7 | `#0007對不起，\n您的點券不夠！` |
| 8 | `#0008很抱歉！您的\n道具欄已滿！` |
| 9 | `#0009這個道具會員\n才能兌換！` |
| 10 | `#0010謝謝惠顧！` |

`main.ts` 的 `shopSay(ui, text, now)`：`ui.bubble.text = playVoiceCode(text)`（`voice-sink.ts` 现成的：播语音并返回剥掉 `#NNNN` 的串，`event-box-screen.ts` 就是这么用的）。
气泡时长：语音比 `SHOP_BUBBLE_MS` 长时撑到语音播完（仿 `speechTick` 里 `sound.durationOf` 那两行）。

### 测试
- `shop-screen.test.ts`：`blinkStep` 用固定 `rnd` 序列走完「空闲 30 拍不动 → r=0 眨眼四帧 [7,8,7,5] → 回空闲」「r=1 换脸，抽到同一张则下一拍重抽」。
  统计用例：10,000 拍里「有动作的拍数」占比在 5%–12% 之间（旧实现 ≈ 100%，这条必须能把旧实现判红）。
- `reduce` 测试：董事長进店 ⇒ `notices[0].key === 'shop.chairmanGift'` 且 `args[0]` 是刚到手那件的名字；非董事長不弹；库存与牌堆都空不弹。
- `SHOP_MSG` 11 条与上表逐字相等（一条 `it.each`）。

---

## W-68（B）樂透開獎屏：一进去四个空白对话框 / 牌子上没有奖金 / 卡顿

首席在浏览器里复现并读了 `fcn_0042f417`、`fcn_0042f6c3`。**三个毛病、三个独立根因：**

### 68-a 四个「空白对话框」= 多画了一张原版没有的图
`lottery-draw-screen.ts` 的 `drawTally()` 第 ② 步：
```ts
drawKeyed(ctx, sprite('Data.mkf', DRAW_PORTRAIT_RESOURCE, p, true), …);   // 「人像条」
```
`Data.mkf` #`0x205` 的图 0..3 **不是人像条**，是四个带尖角的**对话框底板**（189×116，锚点分别在四个角）。
原版 `fcn_0042f417`（`0x0042f417..0x0042f6ab`，首席通读）每个人只画三样：
① `fcn_004552e7(…, 0x128, 0x3c, −16)` 压暗 296×60；② `Panel#15` 图 `25 + 角色号` 徽章（`0x0042f4b1 mov al,[player+0x13] / lea edx,[eax+0x19]`）；③ 号码数字。**没有第四样。**

改法：
1. 删掉 ② 那一行、删常量 `DRAW_PORTRAIT_RESOURCE`、把文件头「各人持号表」第 1 条「人像条」与素材表里 `Data.mkf 517` 那一行删掉，注明订正原因。
2. 徽章图号现在写的是 `ENTRY.badge + p`（**玩家下标**）—— 错，应是 `ENTRY.badge + 角色号`。`drawTally` 的入参加 `characters: readonly number[]`（`state.players.map(p => p.character)`）。
3. 铭牌序号与玩家下标**分开数**：原版出局的人（`player+0x15 == 0`）整个跳过、**不占铭牌**
   （`0x0042f46b cmp byte [player+0x15],0 / je 0x42f6a2`：只 `inc [esp+0x70]` 玩家号，不 `inc [esp+0x74]` 铭牌号）。
   `drawTally` 入参再加 `alive: readonly boolean[]`，循环里单独维护 `plate`。

### 68-b 牌子上没有奖金、开场主持人也不见 = 没有「持久表面」
原版整屏是**一块持久的离屏表面**：建屏时画一次（底图 + 两位主持人 + 「累積獎金」+ 金额 + 持号表），之后每个状态只在上面**擦一块、补一块**，前面画的都还在。
本引擎 `drawCeremony()` 每帧从底图重画，却**只画当前这一步**的 `blits / texts` ⇒ 建屏那一步（`CEREMONY_BASE`）画的主持人和奖金，到下一步就没了
（首席截图：状态 2 时台上没有主持人；状态 3 时左边那块板是空的）。

「累積獎金 / 金额」原版只在三处画（首席已核，坐标与 `TEXT` 表现值一致，**不用改数**）：
建屏 `0x0042f753`/`0x0042f787`（(77,193) / (77,228)）、中奖 `0x00430633`（(91,19) / (91,56)）、没人中 `0x00430867`（(77,193) / (77,228)）。

改法（**核心：加一块持久表面，别的表都不动**）：
1. `active` 里加 `surface: HTMLCanvasElement | OffscreenCanvas`（640×480）与 `applied: number`（已经烤进去的最后一步，初值 −1）。
2. 新函数 `applyStep(a, stepIndex, env): boolean` —— 把**这一步**的东西按现有顺序烤进 `surface`：
   `CEREMONY_ERASE[step] + step.patches`（擦）→ `step.blits + CEREMONY_BLIT[step]`（铺）→ `CEREMONY_BALLS[step]` 为真则两颗球 → `step.tally` 为真则 `drawTally` → `step.texts`。
   **先检查这一步要用的每一张 sprite 都已解好**（`sprite(...) !== null`）；有一张没好就**整步不烤**、返回 false，下一帧再试（不许烤一半）。
   第 −1 步（建屏）= 底图 + `CEREMONY_BASE`（`@rich4/core` 的 `places/lottery-ceremony.ts` 已经导出了它 —— 两位主持人、气泡底、`poolLabel`/`poolAmount`、`tally: true` 都在里面；
   客户端**至今从没用过它**，这正是开场主持人与奖金不见的直接原因。`lotteryCeremony()` 返回的 `steps[0]` 是「状态 1 开场白」，不含建屏）。
3. `drawCeremony()` 每帧：`while (a.applied < a.step && applyStep(a, a.applied + 1, env)) a.applied++;` →
   `ctx.drawImage(a.surface, 0, 0)` → 摇球/礼花 ANM 当前帧 → 脸贴片（现有闸 `!(state >= 4 && state <= 8)` 保留）→ 气泡。
4. `erase()` 改成只有一句 `ctx.drawImage(src.bitmap, c.sx, c.sy, c.w, c.h, c.dx, c.dy, c.w, c.h)`（画在 `surface` 上）——见 68-c。
5. 屏关掉时把 `surface` 置空。`CEREMONY_ERASE / CEREMONY_BLIT / CEREMONY_BALLS / TALLY_*` 这些表**一个数都不许改**。

### 68-c 卡顿
`erase()` 里有两句**纯空转**的像素回读：
```ts
const patch = ctx.getImageData(c.dx, c.dy, c.w, c.h);
ctx.putImageData(patch, c.dx, c.dy);
```
读出来又原样写回去，画面上什么都不改变，但每帧、每个擦除块都强制 GPU→CPU 同步回读一次。
Chromium 下还看不太出来，**桌面包的 WKWebView 下这是卡顿的主因**。删掉这两句与外面那层 `try/catch`（68-b 第 4 点）。
做完 68-b 之后擦除只在**进入某一步时**做一次，不再每帧做。

另：进屏那一下有一次 ≈1 秒的长帧（首席实测 `max 1001 ms`），是 `Panel#16/#17` 两段 ANM 在主线程一次解完。
处理：`lottery` 投注屏打开时（玩家第一次踩樂透格）就**预取**这两段（`env.flic('Panel.mkf', 0x10)`、`0x11` 各问一次，丢掉返回值）。只加这一处预取，不改解码器。

### 测试
- `lottery-draw-screen.test.ts`：假 `sprite` 记录调用 ⇒ 整场演出**一次都没取过** `Data.mkf #0x205`；徽章图号 = `25 + character`（用角色号 ≠ 下标的阵容，如 `[3, 0, 7, 5]`）；
  第 2 位出局时，第 3 位玩家画在**第 2 块**铭牌上。
- 持久表面：假 canvas 记录 `drawImage` ⇒ 建屏那一步的主持人贴图**只出现一次**（不是每帧一次）；走到状态 3 后再取 `surface`，建屏画的「累積獎金」那次 `fillText` 在它之前、且没有被重复。
- sprite 没解好时 `applyStep` 返回 false 且 `surface` 上**零**次绘制调用。
- 全文件 `grep -c getImageData` 必须为 0（写进测试：读源码字符串断言）。

### 验收
`__rich4.lotteryDraw()` 起播，逐状态截图 6 张：开场两位主持人都在、左边板子上有「累積獎金 $5,000」、左下四块铭牌里只有徽章和号码、没有白色对话框。

---

## W-69（B）过路费：同一条街的连号地块

### 先说结论：**钱没算错**
首席写了用例实测：地图 0「台北市」4 块地同属 2 号玩家、各 1 级，0 号玩家踩上去 ⇒ 实付 **4800 = 1200 × 4**，訊息框也是 4800。
规则在 `core/rules/toll.ts` 的 `calculateLandToll()`（同名住宅逐块按各自等级查表相加 × 物價指數），与 `0x00419750` 一致，**不许动**。
需求方觉得「只触发当格」，是因为**原版那一段演出**没接：收费之前，把**算进这笔过路费的每一块地**一起闪一遍。

### 原版演出（首席已读 `0x00419b11..0x00419c88` 与 `fcn_00451985`）
1. 遍历全部地块，把「**算进去的那些**」在棋盘 id 图（`[0x474938]`，440×440）里标成 `0xffff`（`0x00419b9e` / `0x00419c1a` / `0x00419c61 call 0x456c0a`）。「算进去的」=
   住宅支：与落脚那块**同主人 + 同名 + 住宅**的每一块；連鎖店支：同主人的每一家連鎖店；**地主有同盟时，同盟者名下按同一判据的那些也算**（与 `collectRent` 里第二次 `calculateLandToll` 同一集合）。
2. **块数 > 1 才闪**（`0x00419c79 cmp [esp+0xe8],1 / jle 跳过`）—— 只有一块地时没有这段演出。
3. 闪 = `fcn_00451985`：16 帧、每帧 **30 ms**（`0x00451a37 push 0x1e`），第 k 帧给被标记的像素的亮度加 `LEVEL[k]`：
   `LEVEL = [4, 8, 12, 16, 12, 8, 4, 0, −4, −8, −12, −16, −12, −8, −4, 0]`（表 `0x476380`，int8；单位是 **5 位色分量**，16 = 半程）；
   16 帧后再停 **400 ms**（`0x00451a49 push 0x190`）。任意鼠标键可跳过（`fcn_004528b9` 返回非 0 即 break）。
4. 这段在**费用訊息框之前**（`0x00419c83` 在 `0x00419d5a call 0x440cac` 前面）。

### 改法
1. core：`collectRent()` 的返回值加 `counted: number[]`（算进去的地块 id，含同盟那一份）；`reduce` 在收费那条 action 里写进瞬态字段
   `lastTollLands: number[] | null`（规矩同 `lastCardPlay`；`counted.length > 1` 才写，否则 null）。
2. 客户端新文件 `client/src/toll-flash-fx.ts`（纯函数）：`tollFlashLevel(elapsedMs): number | null`
   —— `k = floor(elapsed / 30)`；`k < 16` 返回 `LEVEL[k]`；`16 ≤ … < 16×30 + 400` 返回 0；之后 null（播完）。
3. 渲染：`RenderInput` 加 `landFlash?: { lands: ReadonlySet<number>; level: number } | null`。画到这些地块的**建筑精灵 / 空地地皮**时
   套 `ctx.filter = brightness(1 + level/32)`（与 `ASLEEP_FILTER` 同一个套路），画完还原。
   ⚠️ 原版是按 id 图逐像素调亮，本引擎按精灵近似 —— 登记进 `docs/deviations/`（新开一条 `Q-TOLL-FX-1`）。
4. 时序：这段是「演出」，要进 `stageBusy()` 的判据（`stage-gate.ts` 加一位 `tollFlash`），费用訊息框（`notice`）要等它播完：
   `notice-box-screen.ts` 的起播处加一道「`tollFlash` 在播就先不起」（仿 `pending.afterOverlay` 的写法）。任意鼠标键跳过。
5. 镜头不动（原版这一段没有 `view_to`）。

### 测试
- core：4 块同街同主 ⇒ `lastTollLands` = 那 4 个 id；只有 1 块 ⇒ null；同盟者同街另有 2 块 ⇒ 6 个；連鎖店支 ⇒ 地主全部連鎖店。**外加一条金额回归**：上面那个 4800 的用例原样入库（防止以后有人「修」规则）。
- `toll-flash-fx.test.ts`：0 ms→4、90 ms→16、210 ms→0、**330 ms→−16**（第 11 帧）、450 ms→0、479 ms→0（第 15 帧）、480..879 ms→0、880 ms→null。
  （⚠️ 2026-09-20 订正：原先这里写的是「450 ms→−16」，是首席的算术笔误，见 `escalations.md` E-23。）
- `stage-gate.test.ts`：新位 `tollFlash` 为真 ⇒ busy。

---

## 每个 PR 的自查清单（照抄进 PR 描述末尾并逐条打勾）

- [ ] 我没有自己读汇编控制流；所有数字来自本文。
- [ ] 我没有改本文点名「不许动」的表 / 常量 / 函数。
- [ ] 改动前我先**复现**了问题（贴了改前的输出或截图）。
- [ ] 新测试在旧实现上是**红**的（贴了那次红的输出）。
- [ ] `pnpm check` 汇总行：`… passed`，`0 skipped`，测试总数没有变少。
- [ ] 需要浏览器验证的，我在**前台标签页**里跑了，并贴了结果。
- [ ] 「没做 / 不确定的」已写进 `escalations.md`（没有就写「无」）。
