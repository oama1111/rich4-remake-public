# 第二十五份試玩回報（2026-09-24 22:32，單機）—— 分診與進度

回報檔：`feedback/20260924-223238961-manual-Charles.json`（iPhone Safari，單機，第 149 回合，
`phase=awaitingDecision / pending=auction / overlay=auction`）。上一批（第 24 份 = `181812507` / `182247766`）见提交 `1fe89be` / `135a304`。

| # | 來源 | 內容 | 狀態 |
|---|---|---|---|
| 1 | 223238（單機，第 149 回合） | 「为什么忽然出现拍卖」 | ✅ **规则是對的，缺的是原版那一刻的整屏演出**。現場：真人（阿土伯，P0）現金 0 + 存款 91（上一手把錢全買了 759 股），踩到 400 元過路費；他手上有免費卡（20）與嫁禍卡（19），兩問都答「不用」⇒ `pay_money` 兩個口袋都空 ⇒ 破產。破產清算隨機連拍 3 場（`0x40d1c6 cmp esi,3 / jle` ⇒ 只有被釋放的地產 > 3 處才拍），`seller = −1`、得標款進公庫 —— 與回報現場的 `pending` 逐字段吻合。原版在破產那一刻会**阻塞**播一段 `Data.mkf` 0x22b（碎裂的「破產」二字，10 帧 × 71 ms、440×440 @ (0,40)，+2000 ms 静置）并点曲 2（`MIDI03.MID`）+ 音效 100（`0x0040cf79` / `0x0040cfa4` / `0x0040cfbb`）；本引擎这一段整段缺失 ⇒ 屏上只有拍賣屏「忽然」冒出來。已实现为一条整屏（排在拍賣屏之前，`bankrupt-screen.ts`） |

## 現場復原（`tools/replay-report.ts`）

- 起點第 138 回合 → 終點第 149 回合，**138 条轨迹 0 条被拒**，指纹逐字节相等（`9f432e4b`）—— 現場完整復現。
- 關鍵那几步（`--trace`）：

```
#126 {"type":"settle"}                        → turn 149 awaitingDecision P0 pending=freeCard
#127 {"type":"answerFreeCard","use":false}    → pending=scapegoat
#128 {"type":"answerScapegoat","target":-1}   → pending=auction     ← 破产在这一步
#129+ {"type":"auctionBid", …}                （P1 / P3 轮流出价，P0 / P2 givenUp）
```

- `#127` 那一刻的状态：`pending.tail = { route: { path:'rent', landId:36 }, payer:0, toll:400 }`；
  P0 = `cash 0 / moneyInBank 91`（`400 > 0+91` ⇒ 触发免费卡那一问，与
  `0x00419e01` 的「`toll ≥ 2000×物價` 或 `toll > 现金+存款`」两道取或一致）；
  手上 6 張牌里就有 `20`（免費卡）与 `19`（嫁禍卡）。
- 终点 `pending.entityId = 41`，`landOwner[41] = 1`（= P0 自己的地）、`basePrice 1500`、
  `bidders [1,2,3]`、`seller −1`、`status[0] = givenUp` —— 正是破产清算那一条
  （`0x40d1e1 push −1` ⇒ 没有卖家席位、成交款进公库；`0x40d1c6` 那道闸决定拍几场）。
- 截圖（`--shot`）里右侧三位还在（43784 / 住院中 / 19691），**唯独回報者自己的头像不见了** ——
  人确实出局了，只是屏上什么都没说。

## 改動

| 檔案 | 內容 |
|---|---|
| `packages/client/src/bankrupt-screen.ts`（新） | 规格 `BANKRUPT_FILM`（逐字段带 `@source`）+ 判据 `bankruptFxTriggers` + 整屏 `bankruptScreen` |
| `packages/client/src/screens.ts` | `bankruptScreen` 登记在 `boardScreen` / `auctionScreen` **之前**（訊息框 / 事件框仍在前 —— 原版也是「框 → 影片 → 拍賣」） |
| `packages/client/src/presentation-host.ts` | `'bankrupt'` 进 `BLOCKING_PRESENTATIONS`（回合驅動 / 聯機收件箱據此等它） |
| `packages/client/src/stage-gate.ts` + `main.ts` | `StageFlags.bankruptFx` —— 事件 25「不過是運氣差了點～」是 `afterStage`，要等影片（它本来就**排在**破產函數尾聲 `0x0040d211`） |
| `packages/client/src/bankrupt-screen.test.ts`（新） | 规格 / 判据 / 时序（含「胜利结算不演」的反例）/ 接线顺序 |

为什么做成**整屏**而不是 `board-film` 的又一段：原版 `fcn_0045144f` 是阻塞的，
而本引擎一条 action 就把 `pending = auction` 写好了 —— 拍賣屏的 `active()` 只看 `pending`，
会在影片之前抢到整屏、把影片整段盖掉（有 overlay 就不画棋盘，影片跟着棋盘一起被跳过）。
排在拍賣屏之前 ⇒ 影片期间它接管、演完 `active()` 变假，拍賣屏才起播，与 exe 同序。

## 疑点 / 未做

- **事件 25 的时机仍有殘留偏差**：原版那句在**整段清算与三场拍卖之后**才说（`0x0040d211`），
  本引擎的探测器按「破产那一条 action」触发 ⇒ 现在它排在影片之后、拍賣屏**之前**。
  本次只把它挡到影片之后（至少不盖在「破產」两个大字上），要完全对齐得等拍卖链收尾才放行。
- 原版破产函数里还有 `0x0040cf85 push 1 / call 0x41906a`（镜头 `view_to` 破产者）——
  本引擎破产时的当前玩家通常就在镜头上，未单独补。
- 破產者那句台词在原版由**本人**说，而破产那一刻他的头像已被移出侧栏（回報截圖可見）。
