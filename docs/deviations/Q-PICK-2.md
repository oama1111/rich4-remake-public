# Q-PICK-2 偏离登记（紅卡/黑卡选股、請神符选物件、遙控骰子的输入 UI）

> **本卡全部解出**，没有「卡在哪一步」的未决项。本文件登记三件事：
> ① 三类输入 UI 各读到什么（VA 取证）；② 落地在哪些文件；
> ③ 与**题面假设**不符的地方 + 本项目的选择（供汇总人并进 `known-deviations.md`）。
>
> 题面/`known-deviations.md` 原先那句「股票/物件两类各有自己的**列表 UI**」——
> **股票那条对、物件那条错**：請神符原版没有列表，是**自动请最近的一尊**（见下）。

## 一、三类各读到什么（全部来自 exe）

### 1. 紅卡(24)/黑卡(25) —— 就是**股市屏换个模式**

- 入口 `_rich4_ui_stock_entry`（VA 0x42b58f）的第一个参数就是**模式**：
  - 紅卡真人支 VA 0x00444fea：`push 1`
  - 黑卡真人支 VA 0x004450ae 起：`push 2`（VA 0x004450bc）
  - 工具栏第 11 颗「股市」传 0（买卖模式，T-030 已做）
- 模式经 `_Wait_0402_Message(fn, mode)` 的第 4 个参数进窗口过程 `fcn_0042aaff`，
  WM_CREATE（0x401）时存进 `[0x48c2ed]`（@source `loc_0042ab75`）。
- **模式 ≠ 0 时这一屏只剩两件事**：
  | 事件 | 行为 | @source |
  |---|---|---|
  | WM_MOUSEMOVE 悬停 | `y ∈ (80,464)` → 行 = `(y−80)/32`；画**整行白框** `fcn_0045620f(surface, 0xf, 32×行+0x30, 0x262, 0x20, 0xffffff)` | `loc_0042abbb` / `loc_0042ac9e` |
  | WM_LBUTTONUP 点行（选择号 ≥ 0xa） | `[0x48c2eb] = 选择号 − 0xa`；mode==1 → `newsFlag = 0x20`、否则 `= 2`；`call 0x429040(行)` **当场把价格算出来**；重画该页；`0x45285e(0x3e8)` **停 1 秒**；`Post_0402_Message(行)` | `loc_0042b0da` / `loc_0042b137` / `loc_0042b11e` |
  | WM_RBUTTONUP | page == 0 → `play_sound_effect(0x482332)` + `Post(0)` = **取消**（page ≠ 0 时先退回行情页）| `loc_0042b22f` |
- **选中的反馈**：`0x429040` 就是 core 的 `applyStockNews`（`fcn_00428ec5` 的
  `(pct+100)/100×价`，`newsFlag` 高位非 0 取 **+10%**、否则 **−10%**，
  并覆盖**当日**那一格历史）。所以点下去那一支**立刻**涨/跌 10%，屏上停 1 秒
  再把行号抛回卡函数。紅卡无敌意段；黑卡尾部那圈敌意是原版 bug（double 压栈被
  `0x40df69` 当 int 读，恒为 0），不落敌意。
- 抛回的是**行号**（1 基）＝股票号；返回 0（取消）时卡片欄会被再开回来
  （@source `loc_00441ce1` 的 `test esi,esi / je loc_00441c22`）。

### 2. 請神符(23) —— **没有列表、没有拾取窗口**，自动请最近的一尊

- 卡片本体 VA 0x00444e1a：
  ```asm
  cmp byte [player + 0x15], 1 / jne AI
  call 0x444d1a                     ; ★ 真人：只调这一个函数
  ```
- `fcn_00444d1a`（VA 0x00444d1a）从头到尾**不碰任何窗口**：把地图格表
  （`0x40a45c(-1)` 摊平进 `0x48b8c4`）扫一遍 → 取格值高字节为 handle →
  `0x40ea62(handle)==1`（种类可附身）→ `objects[handle−1].f5 == 0`（未附身）→
  用物件所在节点与当前玩家的坐标算 `d²`、开方 → **留下最接近的一件**，
  返回它的 handle（`ebp` 初值 0 = 一件都没有 ⇒ 卡不消耗）。
- 所以：**列什么、名字从哪张表来、命中在哪** —— 都不存在。没有列表，
  也没有对象名表被读（神明名只出现在 `player_say` 的台词里）。
- 本引擎照抄：`nearestSummonableObject(state, topo)` → handle；
  发 `useCard{cardId:23, target:{kind:'object', objectIndex:handle}}`。

### 3. 遙控骰子（道具 8）—— **六颗骰面的小盘**，选 1..6

- 真人支 **VA 0x004470f8** 起：`read_mkf(Panel.mkf, 0x48, …, 0)`（@source 0x00447117）
  → `draw_img` 贴到 **(92,300)**（@source 0x0044716c）
  → `_Wait_0402_Message(fcn_00446774)`。
- 资源 **Panel.mkf #72** 是 7 张图的 SMP（`parseSpriteSheet` 实测）：

  | 图 | 尺寸 | 是什么 |
  |---|---|---|
  | 0 | 256×55 | 整条盘子 —— **六颗骰面 1..6** 烘在里面 |
  | 1..6 | 30×29 | 第 i 颗的**点亮版**（悬停时盖上去）|

- 窗口过程 `fcn_00446774`：
  | 事件 | 行为 | @source |
  |---|---|---|
  | WM_CREATE(0x401) | `[0x48c598]=0`、`SetCursorPos(0x140,0xdc)`、显示鼠标 | `loc_004467cc` |
  | WM_MOUSEMOVE(0x200) | `y ∈ [0x13a,0x157)`、`x ∈ [0x68+0x28i, +0x1e)` → 高亮第 i 颗（`[0x48c598]=i`，把**图 i** 贴到那颗上）| `loc_00446800` / `loc_004468f4` |
  | WM_LBUTTONUP(0x201) | `[0x48c598] != 0` → `play_sound_effect(0x482322)` + `Post_0402_Message(选中的那颗)` | `loc_00446a2c` |
  | WM_RBUTTONUP(0x205) | `play_sound_effect(0x482332)` + `Post(0)` = **取消** | `loc_00446a66` |
  | 其它 | DefWindowProc（**没有 WM_KEYDOWN，ESC 不在这支**）| `loc_00446adb` |
- 「怎么加减」：**没有加减** —— 六个钮就是六颗骰面，点哪个是哪个。
- **上下限**：返回值写进 `[0x475dd8]`，掷骰处 `fcn_00419572(value)` 在
  `value != 0` 时 `mov esi,1`（**压成一颗骰子**）并把 value 当**总步数**
  （@source VA 0x004195ae / 0x004196d3 求和）。所以真人能指定的就是 **1..6**。

## 二、落地在哪

| 东西 | 文件 |
|---|---|
| 股屏选股模式（模式/字节/白框/1 秒/action） | `packages/client/src/stock-screen.ts`（+ `main.ts` 的 `openStockPick` / `stockPickChoose` / `cancelStockPick`）|
| 「请最近的一尊」 | `packages/client/src/object-pick.ts`（+ `main.ts` 的 `routeCardPick` 分支）|
| 六颗骰面盘 | `packages/client/src/dice-choose.ts`（+ `main.ts` 的 `openDicePick` / `dicePickChoose` / `cancelDicePick`）|
| 卡片欄路由新增两路 | `packages/client/src/inventory.ts` 的 `routeCardPick`（`stockPick` / `objectAuto`）|
| **core 缺的那一步** | `packages/core/src/cards/registry.ts` 的 24/25 分支补 `applyStockNews`（见 Q-PICK-2-c）|
| 测试 | `stock-screen.test.ts`、`dice-choose.test.ts`、`object-pick.test.ts`、`inventory.test.ts`、`core/cards/registry.test.ts` |

dispatch 的形状（与 core 已有的 action **逐字一致**，没有新增形状）：

```
紅卡/黑卡 → { type:'useCard', cardId:24|25, target:{ kind:'stock', index } }   // index 0 基 = hitStockRow 的返回值
請神符    → { type:'useCard', cardId:23,    target:{ kind:'object', objectIndex } } // handle = 下标 + 1
遙控骰子  → { type:'useTool', toolId:8, value:1..6 }
```

## 三、与题面不符 / 本项目的选择

### Q-PICK-2-a　「請神符有自己的列表 UI」—— **题面这一条不成立**

- **现象**：题面与 `known-deviations.md` 都把請神符写成「列表/选择 UI」。
- **取证**：VA 0x00444e2e 真人支只 `call 0x444d1a`；`0x444d1a` 全程没有窗口、
  没有 `_Wait_0402_Message`、没有 `draw_text`（详见 §一.2）。整支 exe 里
  `0x444d1a` 只有两个调用点（`0x420029` 的电脑路径与 `0x444e2e`），
  两支都只拿返回值当 handle。`rich4_card_songshenfu.asm`（送神符）同理：
  只是把身上那尊送走，也没有列表。
- **处置**：**照 exe 实现自动请最近的一尊**，不做列表 UI（做了就是改良）。
  原先 `picking.ts` 里那条「物件在棋盘上点选」的路子（case `'object'`）
  对請神符**不再使用**；函数本身留着（其它调用方与测试还在用）。

### Q-PICK-2-b　遙控骰子是 **1..6**，不是题面写的 1..18

- **现象**：题面说「要的是 1..18 的点数」；core 的 `REMOTE_DICE_MAX` 也是 18。
- **取证**：盘子只有**六颗骰面**（`Panel.mkf` #72 图 0 烘着 1..6，图 1..6 是
  它们的点亮版），窗口过程只有一个 6 次的循环（`cmp esi,6`），返回值 = 第几颗。
  18 那个上限来自「三颗骰子的总步数」——`fcn_00419572` 对非 0 入参
  `mov esi,1`（压成一颗）并把入参当总步数，**真人这条路上限就是 6**。
- **处置**：UI 只给 1..6；core 的 `isValidRemoteDice`（1..18）**不动** ——
  它同时服务 AI / 内部路径（`use-tool.test.ts` 里就有 value=12 的用例），
  改它才是改良。

### Q-PICK-2-c　紅/黑卡「当场改价」这一步原先**没接线**（已补）

- **现象**：core 的 24/25 分支只写了 `newsFlag`，于是当场看不到涨跌，
  那一秒反馈是空的（黑卡尾部若哪天要复刻价差也会是 0）。
- **取证**：原版**两路**都在写完 `newsFlag` 后紧跟一句 `call 0x429040(该股)`：
  真人那支在股市屏里（`loc_0042b137` / `loc_0042b11e` 之后）、
  AI 那支在卡函数里（写完 0x00444f88 / 0x004450f6 紧接着 `call 0x429040`，
  @source 0x00444f91 / 0x004450ff）。`0x429040` = core 的
  `applyStockNews`。
- **处置**：`registry.ts` 的 24/25 分支补 `market = applyStockNews(market, index+1)`，
  并加测试钉住「价格 = `applyPriceTick(开盘价, ±10)`、trend = ±10、其余股票不动」。
  ★ UI 不写行情（C-ARC-2），所以这一步**必须**在 core；股市屏那边只是
  「dispatch 后停 1 秒再收屏」把这一秒留出来给玩家看。

### Q-PICK-2-d　音效号：`0x48233a` 是 **3**，不是 4（顺带订正）

- **现象**：`main.ts` 的 `SOUND_CARD_FAILED` 标 `@source 0x48233a` 却写 4。
- **取证**：音效表自 `0x48231a` 起、**8 字节一项**（工具表 `0x48234a` 的
  `[0x4749d4]×8 + 0x48234a` 就是同一种步长），`play_sound_effect` 取 `[ptr]`
  （VA 0x004542d8）。逐个 dump：`0x48231a=0`、`0x482322=1`、`0x48232a=2`、
  `0x482332=4`、`0x48233a=3`、`0x482342=-1`。
  卡片函数返回 0 时播的是 **`0x48233a` = 3**；4 是**取消**（`0x482332`）。
- **处置**：改 `SOUND_CARD_FAILED = 3`（注释写明取证）；新增
  `STOCK_PICK_CANCEL_SOUND = 4`。本卡自己的两处音效照 exe：
  骰面点中 = 1（`0x482322`，与 `SOUND_IDS.TITLE_CLICK` 同值）、
  取消 = 4（`0x482332`）。

### Q-PICK-2-e　原版那 1 秒是**阻塞等待**，这里是定时器

- 原版 `0x45285e(0x3e8)` 是 GetTickCount + PeekMessage 的等待循环（阻塞 UI 线程）。
- 本项目不能阻塞渲染线程，改成：先 `dispatch`（那一支当场涨/跌好）→ 屏上留 1 秒
  → `closeStock()`。**玩家看到的顺序一致**；差别只在「这一秒里原版点不动，
  本引擎也点不动（`stockPickAt` 非空就忽略点击）」。

### Q-PICK-2-f　按下/抬手的拍子：本引擎与 exe 同拍（本卡这三处都照 exe）

- 三点都是 exe 在 **WM_LBUTTONUP** 上成立的：选股点行（`loc_0042b0da`，0x202）、
  骰面（`loc_00446a2c`，0x202）、拾取目标（T-026 已如此）。
  本卡的实现同样**在抬手才认**（按下只吞噬/记高亮），右键一律走 `contextmenu`
  （= WM_RBUTTONUP）。
- ⚠️ 仓库里**股市屏的买/卖/换页**那几颗是按下就发（T-030 的既有实现），
  与本卡无关、本轮未动 —— 记在这里免得后人对不上拍子。

### Q-PICK-2-g　未复刻的小事（有意）

- 骰子盘 WM_CREATE 的 `SetCursorPos(0x140, 0xdc)`（把鼠标挪到 (320,220)）：
  **不做** —— 浏览器不该替用户挪系统光标（也无法在无手势时挪）。
- 选股模式里那五块牌子（换页/買進/賣出/資訊/離開）在这一模式下**够不着**：
  原版点中一行就当场 `Post` 抛回、窗口随即消失，本引擎同样在 pick 时吃掉所有
  点击（只认行），这是**照抄**不是省略。
- 请神符等距时的取法：原版扫的是**地图格**（`0x474938` 那张 440 宽的格表，
  行序 = 先 y 后 x），本引擎按 `(y, x, handle)` 排序近似它。
  **格表 → 世界坐标的换算没有取证**，所以只有「两尊神恰好等距」时可能不同；
  该差异未再深挖（无可观测的游戏后果：都是一尊神）。
