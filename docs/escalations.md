# 上报清单（C 级问题）

> 执行方遇到 [`WORKPLAN.md`](WORKPLAN.md) 里定义的 **C 级**问题、或触发「三次止损」时，在**文末**追加一条。
> 首席批量处理；处理完在条目标题前加 `✅` 并写结论，不删条目。

## 模板

```
### E-<序号>（<日期>）<一句话标题>
- 关联任务：W-xx
- 现象：（命令 + 输出原文 / 种子 + 回合 + 局面）
- 已试过：（做法与结果；没试过就写"无"）
- 我的怀疑：（可以没有；**不许把怀疑当结论写进代码**）
- 阻塞程度：阻塞 W-xx / 不阻塞
```

---

<!-- 在此线以下追加 -->

### E-1（2026-09-19）桌面包「冷启动 < 3 s」的**标题屏首帧**在本机量不到（缺权限）

- 关联任务：W-04（性能三条的第三条）
- 现象：
  - 能拿到的：`open "大富翁4 重制版.app"` → **窗口出现**，5 次 = 1.889 / 0.377 / 0.411 / 0.380 / 0.436 s，
    中位数 **0.411 s**（脚本 `tools/coldstart-probe.py`，pyobjc 直查 `CGWindowListCopyWindowInfo`）。
  - **拿不到的**：`窗口出现 → 标题屏画出来` 这一段。
    - `CGWindowListCreateImage` 抓到的窗口位图**全黑**（无「屏幕录制」权限），
      算「非黑像素占比」恒为 0，无法判断画面是否已出；
    - `osascript -e 'tell application "System Events" to count processes'` **卡在权限提示上**，
      实测 60 s 超时被杀（`[timed out after 60000ms]`）。
  - 已有的替代证据：网页版 `navigationStart → first-contentful-paint = 88 ms`，
    `DOMContentLoaded / load = 293 ms`（同一台机器，见 `docs/acceptance/perf-20260919.md` §3/§5）。
- 已试过：
  1. pyobjc `CGWindowListCopyWindowInfo` 轮询窗口出现 —— 成功（上表）；
  2. pyobjc `CGWindowListCreateImage` + 非黑像素占比判「画面出来了」—— 全黑，判不出来；
  3. `osascript` / `System Events` 查窗口 —— 卡权限提示，60 s 超时；
  4. `screencapture` —— 与 2 同因（无屏幕录制权限）。
- 我的怀疑：给终端/本 harness 进程**「屏幕录制」+「自动化」**权限即可自动量出
  `open → 标题屏`（法 2 就能用：判「窗口位图出现 ≥5% 非黑像素」）；否则只能真机秒表。
- 阻塞程度：**阻塞 W-04 的「冷启动 < 3 s」取证**（其余两条 —— 60 FPS / 内存 —— 已达标），
  不阻塞阶段 1 的其他任务。已按「未取证」记进 `docs/acceptance/perf-20260919.md`，**没有按达标算**。

### ✅ E-2（2026-09-19）联机：4 座（2 真人 + 2 电脑）时，拍賣**永久卡死** —— 修法要拍板

- 关联任务：W-40（已开 issue [#9](https://github.com/oama1111/rich4-remake/issues/9)）
- 现象：`--seats 4`、两个真人客户端 + 两个电脑座，打到**第 7 回合**硬卡死，90 秒不动：
  `phase='awaitingDecision'`、`currentPlayer=3`（电脑座）、
  `pending={kind:'auction', seat:0, ...}`（下一个该举牌的是**真人**座 0）。种子 `968029213`、地图 0。
  两端摘要仍然相等 —— **不是失步，是没人能出牌**。
- 已试过：读码定位到两条互锁的判据（不是猜）：
  1. `packages/core/src/net/sequencer.ts` 的 `submit()` 只收 `seat === currentSeat()` 的意图，
     而 `currentSeat = mirror.currentPlayer`（`packages/server/src/room.ts:94,103`）
     ⇒ **真人座 0 提交 `auctionBid` 会被判 `notYourTurn`**；
  2. `packages/server/src/hub.ts` 的 `#driveComputers()` 只在**当前座位**是电脑/托管时替它拿主意，
     而 `packages/core/src/ai/policy.ts` 的 `awaitingDecision` 分支在
     `kind === 'auction'` 且轮到**真人**举牌时**有意 `return null`**（那条路留给表现层）⇒ 服务器也不动。
  单机与 4 真人局都不受影响 —— 只有「回合主人是电脑/掉线托管座 + 下一个举牌者是真人」会死锁。
- 我的怀疑（**没有写进代码**）：放宽定序器，让竞价期间**`pending.seat` 那一端的连接**也能提交
  `auctionBid`；或者让服务器按 `pending.seat`（而不是 `currentPlayer`）判断该由谁驱动。
  两条都要改联机契约语义，且要配一局可复现的回归（4 座、2 真人 2 电脑、造一场 pending 拍卖）。
- 阻塞程度：**阻塞 W-40 的「4 座 50 回合指纹全等」**（2 座**全真人**局已通过，
  见 `docs/acceptance/net-20260919.md`）；不阻塞其余任务。
- **首席结论（2026-09-19，已修）**：定位是对的，两条互锁判据都属实。契约定为「**谁举牌谁提交**」——
  你提的两个方向里取第 2 个（竞价期间提交权归 `pending` 里轮到的那位），并补上你没提到的另一半：
  **回合主人是真人、轮到电脑举牌**时原先靠回合主人的客户端代发，现在也归服务器
  （否则「轮到的不是回合主人」这件事只修了一个方向）。判据只有 core 的 `actingSeat()` 一处。
  另查过 `birthdayCard`：`seats[0]` 是被挑牌的人，拿主意的仍是寿星 = 回合主人，不在此列。
  证据与 4 座实测见 `docs/acceptance/net-20260919.md` §4.1。


